"""FFmpeg discovery, stream mapping and remuxing for video, audio and subtitles."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List

from .playlist import LANGS, base_lang, short_lang

logger = logging.getLogger(__name__)


class MuxError(RuntimeError):
    pass


def find_ffmpeg() -> str:
    """Find FFmpeg executable from PATH, env, or imageio-ffmpeg."""
    custom = os.getenv("FFMPEG_PATH")
    if custom and Path(custom).is_file():
        return custom
    which = shutil.which("ffmpeg")
    if which:
        return which
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).is_file():
            return exe
    except Exception as exc:
        logger.debug("imageio_ffmpeg lookup: %s", exc)
    raise MuxError("FFmpeg not found. Please install FFmpeg or set FFMPEG_PATH.")


def mux_streams(
    video_ts: Path | str,
    output_file: Path | str,
    audio_tracks: List[Dict[str, str]] | None = None,      # [{"path": str, "language": str}]
    subtitle_tracks: List[Dict[str, str]] | None = None,   # [{"path": str, "language": str}]
    container: str = "mkv",                               # "mkv" | "mp4"
    subtitle_mode: str = "embed",                         # "embed" | "external"
) -> Path:
    """Remux video TS and optional extra audio/subtitles into a target video container."""
    ffmpeg_exe = find_ffmpeg()
    out_path = Path(output_file).with_suffix(f".{container.lower()}")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    staging_file = out_path.parent / f".tmp_{out_path.stem}.{container}"
    audio_tracks = audio_tracks or []
    subtitle_tracks = subtitle_tracks or []

    cmd = [ffmpeg_exe, "-y", "-i", str(video_ts)]

    # Additional audio inputs
    for a in audio_tracks:
        cmd.extend(["-i", str(a["path"])])

    # Additional subtitle inputs (if embedding)
    embed_subs = subtitle_tracks if subtitle_mode == "embed" else []
    for s in embed_subs:
        cmd.extend(["-i", str(s["path"])])

    # Map video stream from first input
    cmd.extend(["-map", "0:v:0"])

    # Map audio: if custom audio tracks were given, map each one; otherwise keep original audio from video_ts
    if audio_tracks:
        for i in range(len(audio_tracks)):
            cmd.extend(["-map", f"{i + 1}:a:0"])
    else:
        cmd.extend(["-map", "0:a?"])

    # Map subtitles
    if embed_subs:
        offset = 1 + len(audio_tracks)
        for i in range(len(embed_subs)):
            cmd.extend(["-map", f"{offset + i}:0"])

    # Codecs: copy audio and video without re-encoding
    cmd.extend(["-c:v", "copy", "-c:a", "copy"])

    # Subtitle codec
    if embed_subs:
        if container == "mp4":
            cmd.extend(["-c:s", "mov_text"])
        else:
            cmd.extend(["-c:s", "copy"])

    # Audio language metadata
    for i, a in enumerate(audio_tracks):
        lang, _ = base_lang(a.get("language"))
        cmd.extend([f"-metadata:s:a:{i}", f"language={lang}"])

    # Subtitle metadata
    for i, s in enumerate(embed_subs):
        lang, forced = base_lang(s.get("language"))
        title = LANGS.get(lang, (lang, lang.upper()))[1]
        if forced:
            title += " (Forced)"
        cmd.extend([f"-metadata:s:s:{i}", f"language={lang}"])
        cmd.extend([f"-metadata:s:s:{i}", f"title={title}"])
        cmd.extend([f"-disposition:s:{i}", "forced" if forced else "0"])

    # Container-specific options
    if container == "mp4":
        cmd.extend(["-movflags", "+faststart"])

    cmd.append(str(staging_file))

    logger.info("Running FFmpeg remux into %s...", out_path.name)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        if staging_file.exists():
            try:
                staging_file.unlink()
            except OSError:
                pass
        err_msg = (proc.stderr or "").strip()[-500:]
        raise MuxError(f"FFmpeg failed with code {proc.returncode}: {err_msg}")

    # Move staged file to target
    if out_path.exists():
        out_path.unlink()
    staging_file.replace(out_path)

    # If external subtitles, copy them next to the video
    if subtitle_mode == "external" and subtitle_tracks:
        for s in subtitle_tracks:
            sub_src = Path(s["path"])
            if sub_src.exists():
                lang_code = short_lang(s.get("language", "it"))
                target_sub = out_path.parent / f"{out_path.stem}.{lang_code}.vtt"
                try:
                    shutil.copy2(sub_src, target_sub)
                except OSError as exc:
                    logger.warning("Could not write external subtitle %s: %s", target_sub, exc)

    return out_path
