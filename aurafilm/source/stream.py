"""From a title (or episode) id to a playable, decryptable HLS playlist.

Chain: ``/{locale}/iframe/{id}`` on the source -> an ``<iframe>`` pointing at
the video host's ``/embed/{video_id}`` page (behind Cloudflare, hence
cloudscraper) -> inline script declaring ``window.video`` and
``window.masterPlaylist`` -> the master playlist URL, signed with a token.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from dataclasses import dataclass
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from bs4 import BeautifulSoup

from .. import net
from . import site

logger = logging.getLogger(__name__)

_scraper = None
_scraper_lock = threading.Lock()


def _cf_session():
    global _scraper
    with _scraper_lock:
        if _scraper is None:
            try:
                import cloudscraper
                _scraper = cloudscraper.create_scraper(
                    browser={"browser": "firefox", "platform": "windows", "desktop": True})
            except ImportError:  # pragma: no cover
                _scraper = net.new_session()
        return _scraper


@dataclass
class Stream:
    master_url: str
    referer: str
    video_host: str     # e.g. vixcloud.co — the only host a key may be fetched from
    video_id: str


class StreamError(RuntimeError):
    pass


def _iframe_src(host: str, title_id: int, episode_id: int | None) -> str:
    session = net.new_session(pool_size=2)
    params = {"episode_id": episode_id, "next_episode": "1"} if episode_id else None
    last = None
    for path in (f"/{site.LOCALE}/iframe/{title_id}", f"/iframe/{title_id}"):
        headers = {"Referer": f"https://{host}/{site.LOCALE}/watch/{title_id}"
                   + (f"?e={episode_id}" if episode_id else "")}
        r = net.get_with_retry(session, f"https://{host}{path}", params=params, headers=headers,
                               what="iframe")
        last = r.status_code
        if r.ok:
            frame = BeautifulSoup(r.text, "lxml").find("iframe")
            if frame and frame.get("src"):
                return frame["src"]
    raise StreamError(f"no player iframe for title {title_id} (HTTP {last})")


def _js_object(script: str, name: str) -> str | None:
    """The text of ``window.<name> = { ... }`` with balanced braces."""
    m = re.search(rf"window\.{name}\s*=\s*\{{", script)
    if not m:
        return None
    depth, i = 0, m.end() - 1
    for j in range(i, len(script)):
        if script[j] == "{":
            depth += 1
        elif script[j] == "}":
            depth -= 1
            if depth == 0:
                return script[i:j + 1]
    return None


def _loose_json(obj: str) -> dict:
    """Parse a JS object literal with single quotes, bare keys, trailing commas."""
    s = re.sub(r"'([^'\\]*(?:\\.[^'\\]*)*)'", lambda m: json.dumps(m.group(1)), obj)
    s = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', s)
    s = re.sub(r",\s*([}\]])", r"\1", s)
    return json.loads(s)


def resolve(host: str, title_id: int, episode_id: int | None = None) -> Stream:
    embed_url = _iframe_src(host, title_id, episode_id)
    r = _cf_session().get(embed_url, headers={"Referer": f"https://{host}/"}, timeout=15)
    if r.status_code != 200:
        raise StreamError(f"video host refused the embed page (HTTP {r.status_code})")
    script = r.text

    video_obj = _js_object(script, "video")
    master_obj = _js_object(script, "masterPlaylist")
    if not master_obj:
        raise StreamError("embed page carries no masterPlaylist (title unavailable or blocked)")
    master = _loose_json(master_obj)
    params = master.get("params") or {}
    video_id = None
    if video_obj:
        m = re.search(r"\bid\s*:\s*['\"]?(\d+)", video_obj)
        video_id = m.group(1) if m else None

    base = urlparse(master.get("url") or "")
    if not base.scheme:
        raise StreamError("masterPlaylist has no url")
    query = {k: v[0] for k, v in parse_qs(base.query).items()}
    query["token"] = params.get("token", "")
    query["expires"] = params.get("expires", "")
    if params.get("asn"):
        query["asn"] = params["asn"]
    embed_q = {k: v[0] for k, v in parse_qs(urlparse(embed_url).query).items()}
    if re.search(r"window\.canPlayFHD\s*=\s*true", script) or embed_q.get("canPlayFHD"):
        query["h"] = "1"
    if embed_q.get("scz"):
        query["scz"] = "1"
    if embed_q.get("lang"):
        query["lang"] = embed_q["lang"]
    master_url = urlunparse(base._replace(query=urlencode(query)))
    logger.info("Resolved title %s%s -> video %s", title_id,
                f" ep {episode_id}" if episode_id else "", video_id)
    return Stream(master_url=master_url, referer=embed_url,
                  video_host=base.hostname or "", video_id=video_id or "")
