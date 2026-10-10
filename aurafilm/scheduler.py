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
