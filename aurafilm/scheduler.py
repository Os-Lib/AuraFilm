"""Background scheduler for night downloads and subscriptions."""

import logging
import threading
import time
from typing import Callable, List, Dict, Any

logger = logging.getLogger(__name__)

class Scheduler:
    def __init__(self):
        self._tasks: List[Dict[str, Any]] = []
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

    def add_task(self, name: str, interval_seconds: int, func: Callable):
        with self._lock:
            self._tasks.append({
                "name": name,
                "interval": interval_seconds,
                "func": func,
                "last_run": 0
            })
        logger.info(f"Task '{name}' registered to run every {interval_seconds}s")

    def start(self):
        if self._thread is None or not self._thread.is_alive():
            self._stop_event.clear()
            self._thread = threading.Thread(target=self._loop, name="TaskScheduler", daemon=True)
            self._thread.start()

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _loop(self):
        logger.info("Scheduler started")
        while not self._stop_event.is_set():
            now = time.time()
            with self._lock:
                for task in self._tasks:
                    if now - task["last_run"] >= task["interval"]:
                        try:
                            task["func"]()
                        except Exception as e:
                            logger.error(f"Task {task['name']} failed: {e}")
                        task["last_run"] = time.time()
            time.sleep(10)

scheduler = Scheduler()

def night_compression_task():
    from aurafilm import config
    import subprocess
    from pathlib import Path
    import os
    
    cfg = config.get()
    if not cfg.get("night_compression_h265"):
        return
        
    start_hr = cfg.get("compression_start_hour", 2)
    end_hr = cfg.get("compression_end_hour", 6)
    
    current_hour = time.localtime().tm_hour
    if start_hr <= current_hour < end_hr:
        dl_dir = Path(cfg.get("download_dir", "downloads"))
        if not dl_dir.exists():
            return
            
        # Find uncompressed mkv files (we can tag compressed ones by adding .h265 in the name or storing a db of compressed files)
        # For simplicity, we'll assume any file containing "h265" is already compressed.
        for file_path in dl_dir.rglob("*.mkv"):
            if "h265" in file_path.name.lower():
                continue
            
            logger.info("Starting night compression on: %s", file_path.name)
            out_path = file_path.with_name(f"{file_path.stem}.h265.mkv")
            
            cmd = [
                "ffmpeg", "-y", "-i", str(file_path),
                "-c:v", "libx265", "-crf", "28", "-preset", "fast",
                "-c:a", "copy", "-c:s", "copy", str(out_path)
            ]
            try:
                subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                os.remove(file_path)
                logger.info("Successfully compressed %s", file_path.name)
            except Exception as e:
                logger.error("Compression failed for %s: %s", file_path.name, e)
                if out_path.exists():
                    os.remove(out_path)

scheduler.add_task("Nightly Compression", interval_seconds=3600, func=night_compression_task)
