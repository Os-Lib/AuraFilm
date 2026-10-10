"""Download job queue and pipeline orchestrator."""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List

import requests

from . import config, events, net
from .hls import decrypt, downloader, mux, playlist
from .source import domain, site, stream, tmdb

logger = logging.getLogger(__name__)


@dataclass
class Job:
    id: str
    item_type: str                   # "movie" | "episode"
    title_id: int
    slug: str
    title_name: str
    year: str | None = None
    season: int | None = None
    episode_id: int | None = None
    episode_number: int | None = None
    episode_name: str | None = None
    audio_languages: List[str] = field(default_factory=lambda: ["ita"])
    subtitle_languages: List[str] = field(default_factory=list)
    status: str = "queued"          # queued | running | completed | failed | cancelled
    phase: str = "pending"          # pending | resolving | video | audio | subtitles | muxing | finished
    percent: float = 0.0
    speed: float = 0.0
    eta: int = 0
    bytes_downloaded: int = 0
    error: str | None = None
    output_path: str | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


class JobManager:
    def __init__(self):
        self._jobs: Dict[str, Job] = {}
        self._cancel_events: Dict[str, threading.Event] = {}
        self._lock = threading.RLock()
        self._worker_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._load_jobs()

    def _jobs_file(self) -> Path:
        return config.JOBS_FILE

    def _load_jobs(self):
        f = self._jobs_file()
        if not f.exists():
            return
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            for j in data:
                # Mark interrupted running jobs as failed on load
                if j.get("status") == "running":
                    j["status"] = "failed"
                    j["error"] = "Interrupted by shutdown"
                job = Job(**j)
                self._jobs[job.id] = job
        except Exception as exc:
            logger.warning("Could not load jobs from %s: %s", f, exc)

    def _save_jobs(self):
        f = self._jobs_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        try:
            with self._lock:
                serialized = [j.as_dict() for j in list(self._jobs.values())[-100:]]
            tmp = f.with_suffix(".tmp")
            tmp.write_text(json.dumps(serialized, indent=2), encoding="utf-8")
            tmp.replace(f)
        except Exception as exc:
            logger.warning("Could not save jobs: %s", exc)

    def list_jobs(self) -> List[Dict[str, Any]]:
        with self._lock:
            return sorted([j.as_dict() for j in self._jobs.values()], key=lambda x: x["created_at"], reverse=True)

    def get_job(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def enqueue(
        self,
        item_type: str,
        title_id: int,
        slug: str,
        title_name: str,
        year: str | None = None,
        season: int | None = None,
        episode_id: int | None = None,
        episode_number: int | None = None,
        episode_name: str | None = None,
        audio_languages: List[str] | None = None,
        subtitle_languages: List[str] | None = None,
    ) -> Job:
        job_id = str(uuid.uuid4())[:8]
        cfg = config.get()
        audios = audio_languages if audio_languages is not None else cfg.get("audio_languages", ["ita"])
        subs = subtitle_languages if subtitle_languages is not None else cfg.get("subtitle_languages", [])

        job = Job(
            id=job_id,
            item_type=item_type,
            title_id=title_id,
            slug=slug,
            title_name=title_name,
            year=year,
            season=season,
            episode_id=episode_id,
            episode_number=episode_number,
            episode_name=episode_name,
            audio_languages=audios,
            subtitle_languages=subs,
        )
        with self._lock:
            self._jobs[job_id] = job
            self._cancel_events[job_id] = threading.Event()
            self._save_jobs()

        events.publish({"type": "job_created", "job": job.as_dict()})
        logger.info("Enqueued %s job: %s (%s)", item_type, title_name, job_id)
        return job

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            if job.status in ("completed", "failed", "cancelled"):
                return True
            job.status = "cancelled"
            job.finished_at = time.time()
            if job_id in self._cancel_events:
                self._cancel_events[job_id].set()
            self._save_jobs()
            events.publish({"type": "job_updated", "job": job.as_dict()})
            return True

    def remove(self, job_id: str) -> bool:
        with self._lock:
            if job_id in self._jobs:
                del self._jobs[job_id]
                self._cancel_events.pop(job_id, None)
                self._save_jobs()
                events.publish({"type": "job_removed", "job_id": job_id})
                return True
        return False

    def clear_completed(self) -> int:
        count = 0
        with self._lock:
            to_del = [jid for jid, j in self._jobs.items() if j.status in ("completed", "failed", "cancelled")]
            for jid in to_del:
                del self._jobs[jid]
                self._cancel_events.pop(jid, None)
                count += 1
            if count:
                self._save_jobs()
                events.publish({"type": "jobs_cleared"})
        return count

    def start(self):
        if self._worker_thread is None or not self._worker_thread.is_alive():
            self._stop_event.clear()
            self._worker_thread = threading.Thread(target=self._run_loop, name="JobWorker", daemon=True)
            self._worker_thread.start()

    def stop(self):
        self._stop_event.set()

    def _run_loop(self):
        while not self._stop_event.is_set():
            next_job = None
            with self._lock:
                queued = [j for j in self._jobs.values() if j.status == "queued"]
                if queued:
                    next_job = queued[0]
                    next_job.status = "running"
                    self._save_jobs()

            if next_job:
                events.publish({"type": "job_updated", "job": next_job.as_dict()})
                self._process_job(next_job)
                with self._lock:
                    self._save_jobs()
                events.publish({"type": "job_updated", "job": next_job.as_dict()})
            else:
                self._stop_event.wait(1.0)

    def _process_job(self, job: Job):
        cancel_evt = self._cancel_events.get(job.id) or threading.Event()
        tmp_base = config.TMP_DIR / job.id
        tmp_base.mkdir(parents=True, exist_ok=True)

        try:
            cfg = config.get()
            host = domain.current()
            if not host:
                domain.check_and_heal()
                host = domain.current()
            if not host:
                raise RuntimeError("No streaming source domain configured or reachable")

            job.phase = "resolving"
            events.publish({"type": "job_updated", "job": job.as_dict()})

            session = net.new_session(pool_size=cfg.get("max_segment_workers", 12))

            # 1. Resolve Stream
            stream_info = stream.resolve(host, job.title_id, job.episode_id)
            if cancel_evt.is_set():
                raise downloader.DownloadCancelled()

            # 2. Parse Master Playlist
            master = playlist.parse_master(session, stream_info.master_url, referer=stream_info.referer)
            variant = master.best_variant(max_height=cfg.get("max_quality", 1080))
            if not variant:
                raise RuntimeError("No playable video stream found in playlist")

            # 3. Media Playlist & Key
            media = playlist.parse_media(session, variant.uri, referer=stream_info.referer)
            key_bytes = None
            if media.key and media.key.uri:
                key_bytes = decrypt.fetch_key(session, media.key.uri, referer=stream_info.referer)

            # 4. Target destination naming
            dl_dir = Path(cfg.get("download_dir", "downloads"))
            safe_title = "".join(c for c in job.title_name if c not in '<>:"/\\|?*').strip()

            if job.item_type == "movie":
                subfolder = dl_dir / f"{safe_title}{f' ({job.year})' if job.year else ''}"
                file_stem = f"{safe_title}{f' ({job.year})' if job.year else ''}"
            else:
                s_num = job.season or 1
                e_num = job.episode_number or 1
                subfolder = dl_dir / f"{safe_title}{f' ({job.year})' if job.year else ''}" / f"Season {s_num:02d}"
                file_stem = f"{safe_title} S{s_num:02d}E{e_num:02d}{f' - {job.episode_name}' if job.episode_name else ''}"

            subfolder.mkdir(parents=True, exist_ok=True)
            video_ts = tmp_base / "video.ts"

            # 5. Download Video Segments
            job.phase = "video"
            events.publish({"type": "job_updated", "job": job.as_dict()})

            def on_progress(p: dict):
                job.percent = p.get("percent", 0.0)
                job.speed = p.get("speed", 0.0)
                job.eta = p.get("eta", 0)
                job.bytes_downloaded = p.get("bytes", 0)
                events.publish({"type": "job_updated", "job": job.as_dict()})

            downloader.download_media(
                session=session,
                media=media,
                output_path=video_ts,
                temp_dir=tmp_base / "seg_video",
                key_bytes=key_bytes,
                referer=stream_info.referer,
                workers=cfg.get("max_segment_workers", 12),
                on_progress=on_progress,
                cancel_event=cancel_evt,
            )

            # 6. Audio Tracks
            audio_files: List[Dict[str, str]] = []
            audio_renditions = playlist.pick_audio(master, job.audio_languages)
            if audio_renditions:
                job.phase = "audio"
                events.publish({"type": "job_updated", "job": job.as_dict()})
                for idx, a_rend in enumerate(audio_renditions):
                    if cancel_evt.is_set():
                        raise downloader.DownloadCancelled()
                    a_media = playlist.parse_media(session, a_rend.uri, referer=stream_info.referer)
                    a_key = None
                    if a_media.key and a_media.key.uri:
                        a_key = decrypt.fetch_key(session, a_media.key.uri, referer=stream_info.referer)
                    a_ts = tmp_base / f"audio_{idx}.ts"
                    downloader.download_media(
                        session=session,
                        media=a_media,
                        output_path=a_ts,
                        temp_dir=tmp_base / f"seg_audio_{idx}",
                        key_bytes=a_key,
                        referer=stream_info.referer,
                        workers=cfg.get("max_segment_workers", 12),
                        on_progress=on_progress,
                        cancel_event=cancel_evt,
                    )
                    audio_files.append({"path": str(a_ts), "language": a_rend.language})

            # 7. Subtitles
            sub_files: List[Dict[str, str]] = []
            found_langs = set()
            sub_renditions = playlist.pick_subtitles(master, job.subtitle_languages)
            if sub_renditions:
                job.phase = "subtitles"
                events.publish({"type": "job_updated", "job": job.as_dict()})
                for idx, s_rend in enumerate(sub_renditions):
                    try:
                        s_media = playlist.parse_media(session, s_rend.uri, referer=stream_info.referer)
                        if s_media.segments:
                            resp = session.get(s_media.segments[0], headers={"Referer": stream_info.referer}, timeout=15)
                            if resp.ok:
                                s_vtt = tmp_base / f"sub_{idx}.vtt"
                                s_vtt.write_bytes(resp.content)
                                sub_files.append({"path": str(s_vtt), "language": s_rend.language})
                                found_langs.add(s_rend.language[:2].lower())
                    except Exception as exc:
                        logger.warning("Subtitle %s failed: %s", s_rend.language, exc)

            # 7.5 AI Subtitle Generation (Whisper) Fallback
            if audio_files:
                base_audio = Path(audio_files[0]["path"])
                for idx, req_lang in enumerate(job.subtitle_languages):
                    # Check if the requested language (e.g. 'ita') was not found in the official stream
                    if req_lang[:2].lower() not in found_langs:
                        logger.info("Subtitle %s missing, triggering Whisper AI generation...", req_lang)
                        ai_vtt = tmp_base / f"ai_sub_{idx}.vtt"
                        from aurafilm import whisper_ai
                        if whisper_ai.generate_subtitles(base_audio, ai_vtt, req_lang):
                            sub_files.append({"path": str(ai_vtt), "language": f"{req_lang} (AI generated)"})

            # 8. Mux with FFmpeg
            job.phase = "muxing"
            job.percent = 99.0
            events.publish({"type": "job_updated", "job": job.as_dict()})

            final_out = subfolder / file_stem
            container = cfg.get("output_format", "mkv")
            sub_mode = cfg.get("subtitle_mode", "embed")

            result_path = mux.mux_streams(
                video_ts=video_ts,
                output_file=final_out,
                audio_tracks=audio_files,
                subtitle_tracks=sub_files,
                container=container,
                subtitle_mode=sub_mode,
            )

            # 9. TMDB Metadata Integration
            api_key = cfg.get("tmdb_api_key", "")
            if api_key:
                job.phase = "metadata"
                events.publish({"type": "job_updated", "job": job.as_dict()})
                try:
                    is_tv = job.item_type == "episode"
                    search_q = f"{job.title_name} {job.year}" if job.year else job.title_name
                    found = tmdb.search_media(search_q, api_key, is_tv=is_tv)
                    if found:
                        details = tmdb.get_details(found.get("id"), api_key, is_tv=is_tv)
                        if details:
                            nfo_path = subfolder / f"{file_stem}.nfo"
                            poster_path = subfolder / "poster.jpg"
                            tmdb.generate_nfo(details, nfo_path, is_tv=is_tv)
                            if not poster_path.exists():
                                tmdb.download_poster(details, poster_path)
                except Exception as exc:
                    logger.warning("Failed to fetch TMDB metadata: %s", exc)

            job.status = "completed"
            job.phase = "finished"
            job.percent = 100.0
            job.output_path = str(result_path)
            job.finished_at = time.time()
            logger.info("Job %s completed -> %s", job.id, result_path)

        except downloader.DownloadCancelled:
            job.status = "cancelled"
            job.finished_at = time.time()
            logger.info("Job %s cancelled", job.id)
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)
            job.finished_at = time.time()
            logger.exception("Job %s failed: %s", job.id, exc)
            # If request failed with network error, prompt domain recovery
            domain.on_source_failure()
        finally:
            import shutil
            shutil.rmtree(tmp_base, ignore_errors=True)


job_manager = JobManager()
