"""A tiny in-process pub/sub used to push live updates to the browser (SSE).

Publishers call :func:`publish` from any thread. Each connected browser holds
a subscriber queue; slow or vanished subscribers are dropped rather than
allowed to grow without bound.
"""

from __future__ import annotations

import asyncio
import threading

_subscribers: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()
_lock = threading.Lock()
MAX_QUEUE = 500


def subscribe() -> tuple[asyncio.AbstractEventLoop, asyncio.Queue]:
    entry = (asyncio.get_running_loop(), asyncio.Queue(maxsize=MAX_QUEUE))
    with _lock:
        _subscribers.add(entry)
    return entry


def unsubscribe(entry) -> None:
    with _lock:
        _subscribers.discard(entry)


def _offer(queue: asyncio.Queue, event: dict) -> None:
    try:
        queue.put_nowait(event)
    except asyncio.QueueFull:
        pass


def publish(event: dict) -> None:
    with _lock:
        targets = list(_subscribers)
    for loop, queue in targets:
        if loop.is_closed():
            unsubscribe((loop, queue))
            continue
        loop.call_soon_threadsafe(_offer, queue, event)
