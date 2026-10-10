"""Settings and filesystem locations.

Everything the app writes lives under one data directory (``SH_DATA_DIR``,
default ``./data``), so a Docker volume or a backup only has to cover one path.
Settings are a small JSON document guarded by a lock and written atomically:
a crash mid-write must never leave a half-written file that resets the setup.
"""

from __future__ import annotations

import copy
import json
import logging
import os
import tempfile
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.getenv("SH_DATA_DIR", "data")).resolve()
SETTINGS_FILE = DATA_DIR / "settings.json"
JOBS_FILE = DATA_DIR / "jobs.json"
TMP_DIR = Path(os.getenv("SH_TMP_DIR", str(DATA_DIR / "tmp"))).resolve()

HOST = os.getenv("SH_HOST", "127.0.0.1")
PORT = int(os.getenv("SH_PORT", "8080"))

DEFAULTS: dict = {
    # First-run wizard
    "setup_done": False,
    "language": "en",
    # Source
    "domain": "",
    "domain_history": [],          # [{"host": str, "last_ok": float}]
    "domain_auto_apply": True,     # adopt a verified new domain without asking
    "domain_check_minutes": 30,    # periodic health check
    "telegram_link": "",           # learned from the site itself
    # Downloads
    "download_dir": os.getenv("SH_DOWNLOAD_DIR", str(Path("downloads").resolve())),
    "max_parallel_jobs": 2,
    "max_segment_workers": 12,
    "max_quality": 1080,
    "audio_languages": ["ita"],
    "subtitle_languages": [],
    "output_format": "mkv",        # "mkv" | "mp4"
    "subtitle_mode": "embed",      # "embed" | "external" | "burn"
    "tmdb_api_key": "",
    "night_compression_h265": False,
    "telegram_bot_token": "",
}

_lock = threading.RLock()
_cache: dict | None = None


def _ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)


def _read() -> dict:
    _ensure_dirs()
    if not SETTINGS_FILE.exists():
        return {}
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        # Keep the broken file for inspection instead of overwriting it silently.
        backup = SETTINGS_FILE.with_suffix(".broken.json")
        logger.error("Settings file unreadable (%s); moved to %s", exc, backup)
        try:
            SETTINGS_FILE.replace(backup)
        except OSError:
            pass
        return {}


def _write(data: dict) -> None:
    _ensure_dirs()
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, prefix=".settings-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, SETTINGS_FILE)


def get() -> dict:
    """A copy of the full settings, defaults filled in."""
    global _cache
    with _lock:
        if _cache is None:
            _cache = {**copy.deepcopy(DEFAULTS), **_read()}
        return copy.deepcopy(_cache)


def value(key: str):
    return get().get(key, DEFAULTS.get(key))


def update(changes: dict) -> dict:
    """Merge ``changes`` into the settings and persist. Unknown keys are ignored."""
    global _cache
    with _lock:
        current = get()
        for key, val in changes.items():
            if key in DEFAULTS:
                current[key] = val
        _write({k: v for k, v in current.items() if k in DEFAULTS})
        _cache = current
        return copy.deepcopy(current)


def reload() -> None:
    global _cache
    with _lock:
        _cache = None
