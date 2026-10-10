"""HTTP plumbing shared by every module that talks to the network."""

from __future__ import annotations

import logging
import random
import time

import requests
from requests.adapters import HTTPAdapter

logger = logging.getLogger(__name__)

# A small pool of current desktop browsers. One is picked per session, never
# per request: thousands of different agents down one connection is exactly
# the pattern a CDN rate-limits.
_USER_AGENTS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/129.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.6 Safari/605.1.15",
)

TIMEOUT = 15


def user_agent() -> str:
    return random.choice(_USER_AGENTS)


def new_session(pool_size: int = 10, ua: str | None = None) -> requests.Session:
    """A keep-alive session with a pool sized for ``pool_size`` threads.

    urllib3's own retries stay off: callers own the retry policy, and two
    layers of retries silently multiply each other.
    """
    session = requests.Session()
    adapter = HTTPAdapter(pool_connections=pool_size, pool_maxsize=pool_size, max_retries=0)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers["User-Agent"] = ua or user_agent()
    session.headers["Accept-Language"] = "it-IT,it;q=0.9,en;q=0.8"
    return session


def retriable(status: int) -> bool:
    """4xx is a verdict; 408/425/429 and 5xx are the server asking for room."""
    return status in (408, 425, 429) or status >= 500


def get_with_retry(session: requests.Session, url: str, *, attempts: int = 4,
                   what: str = "request", **kwargs) -> requests.Response:
    """GET with exponential backoff on timeouts, dropped connections and 5xx.

    The first non-retriable response is returned as-is (``.ok`` or not): what a
    status means is the caller's decision. The last attempt's exception is
    re-raised unchanged so the log names the real cause.
    """
    kwargs.setdefault("timeout", TIMEOUT)
    for attempt in range(attempts):
        last = attempt == attempts - 1
        try:
            response = session.get(url, **kwargs)
        except (requests.Timeout, requests.ConnectionError) as exc:
            if last:
                raise
            reason = type(exc).__name__
        else:
            if not retriable(response.status_code) or last:
                return response
            reason = f"HTTP {response.status_code}"
        delay = 2 ** attempt * (0.75 + random.random() / 2)
        logger.warning("%s: %s, retrying in %.1fs (%d/%d)", what, reason, delay, attempt + 1, attempts)
        time.sleep(delay)
    raise AssertionError("unreachable")
