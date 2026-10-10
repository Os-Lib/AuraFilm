"""Parallel HLS segment downloader with adaptive rate-limiting and byte concatenation."""

from __future__ import annotations

import logging
import os
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

import requests

from .. import net
from .decrypt import SegmentDecryptor, sequence_iv
from .playlist import MediaPlaylist

logger = logging.getLogger(__name__)


class DownloadCancelled(Exception):
    pass


class SegmentDownloadError(RuntimeError):
    pass


class DownloadProgress:
    def __init__(self, total_segments: int, on_progress: Callable[[dict], None] | None = None):
        self.total_segments = total_segments
        self.completed_segments = 0
        self.downloaded_bytes = 0
        self.start_time = time.time()
        self.last_update = 0.0
        self.on_progress = on_progress
        self._lock = threading.Lock()

    def update(self, count: int = 1, bytes_count: int = 0):
        with self._lock:
            self.completed_segments += count
            self.downloaded_bytes += bytes_count
            now = time.time()
            if now - self.last_update >= 0.5 or self.completed_segments >= self.total_segments:
                self.last_update = now
                elapsed = max(0.1, now - self.start_time)
                speed = self.downloaded_bytes / elapsed
                percent = round((self.completed_segments / max(1, self.total_segments)) * 100, 1)
                rem_segs = max(0, self.total_segments - self.completed_segments)
                eta = (rem_segs / (self.completed_segments / elapsed)) if self.completed_segments > 0 else 0
                if self.on_progress:
                    self.on_progress({
                        "completed": self.completed_segments,
                        "total": self.total_segments,
                        "percent": percent,
                        "bytes": self.downloaded_bytes,
                        "speed": speed,
                        "eta": int(eta),
                    })


def download_media(
    session: requests.Session,
    media: MediaPlaylist,
    output_path: Path | str,
    temp_dir: Path | str,
    key_bytes: bytes | None = None,
    referer: str | None = None,
    workers: int = 12,
    on_progress: Callable[[dict], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> Path:
    """Download all segments of a MediaPlaylist, decrypt them, and write a unified .ts stream."""
    temp_path = Path(temp_dir)
    temp_path.mkdir(parents=True, exist_ok=True)
    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    decryptor = None
    if key_bytes:
        default_iv = media.key.iv if media.key else None
        decryptor = SegmentDecryptor(key_bytes, default_iv=default_iv)

    total = len(media.segments)
    progress = DownloadProgress(total, on_progress=on_progress)
    failed_indices = set()
    failed_lock = threading.Lock()

    headers = {"Referer": referer} if referer else {}

    def fetch_one(idx: int, seg_url: str) -> None:
        if cancel_event and cancel_event.is_set():
            return
        dest = temp_path / f"{idx:05d}.ts"
        if dest.exists() and dest.stat().st_size > 0:
            progress.update(1, dest.stat().st_size)
            return

        iv = decryptor.default_iv if (decryptor and decryptor.default_iv) else sequence_iv(media.sequence_start + idx)

        for attempt in range(4):
            if cancel_event and cancel_event.is_set():
                return
            try:
                resp = session.get(seg_url, headers=headers, timeout=(10, 25))
                if resp.status_code == 200:
                    data = resp.content
                    if decryptor:
                        data = decryptor.decrypt(data, iv=iv)
                    dest.write_bytes(data)
                    progress.update(1, len(data))
                    return
                if resp.status_code in (408, 425, 429, 500, 502, 503, 504):
                    time.sleep(min(8, 2 ** attempt))
                    continue
                break
            except Exception as exc:
                logger.debug("Segment %d error: %s", idx, exc)
                time.sleep(min(8, 2 ** attempt))

        with failed_lock:
            failed_indices.add(idx)

    # Parallel download pass
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(fetch_one, i, url) for i, url in enumerate(media.segments)]
        for fut in as_completed(futures):
            if cancel_event and cancel_event.is_set():
                break
            try:
                fut.result()
            except Exception as e:
                logger.warning("Segment worker exception: %e", e)

    if cancel_event and cancel_event.is_set():
        raise DownloadCancelled("Download cancelled by user")

    # Sequential retry pass for any segments that were throttled
    if failed_indices:
        logger.info("Retrying %d failed segments sequentially...", len(failed_indices))
        retried_failed = set()
        for idx in sorted(failed_indices):
            if cancel_event and cancel_event.is_set():
                raise DownloadCancelled("Download cancelled by user")
            seg_url = media.segments[idx]
            dest = temp_path / f"{idx:05d}.ts"
            iv = decryptor.default_iv if (decryptor and decryptor.default_iv) else sequence_iv(media.sequence_start + idx)
            success = False
            for _ in range(5):
                try:
                    time.sleep(0.5)
                    resp = session.get(seg_url, headers=headers, timeout=20)
                    if resp.status_code == 200:
                        data = resp.content
                        if decryptor:
                            data = decryptor.decrypt(data, iv=iv)
                        dest.write_bytes(data)
                        progress.update(1, len(data))
                        success = True
                        break
                except Exception:
                    pass
            if not success:
                retried_failed.add(idx)

        if retried_failed:
            raise SegmentDownloadError(f"Failed to download {len(retried_failed)} segments after sequential retries")

    # Combine all segments into one continuous TS file
    logger.info("Concatenating %d segments into %s...", total, out_file.name)
    with out_file.open("wb") as out_fh:
        for idx in range(total):
            seg_file = temp_path / f"{idx:05d}.ts"
            if not seg_file.exists():
                raise SegmentDownloadError(f"Missing segment {idx} during concatenation")
            with seg_file.open("rb") as in_fh:
                shutil.copyfileobj(in_fh, out_fh)

    # Clean up temporary segments
    shutil.rmtree(temp_path, ignore_errors=True)
    return out_file
