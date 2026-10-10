"""Client for the source site.

The site is a Laravel + Inertia.js app. Every server-rendered page embeds its
data as JSON in ``<div id="app" data-page="...">``, and the same JSON is
returned directly when a request carries ``X-Inertia: true``. Reading that
payload means no HTML scraping: titles, seasons, images and metadata all
arrive as structured data.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup

from .. import net

logger = logging.getLogger(__name__)

LOCALE = "it"            # the catalogue (and its Italian dubs) lives under /it
RESULT_CAP = 60
SHELF_CAP = 30


class SourceError(RuntimeError):
    """The source answered, but not with what was expected."""


class SourceUnreachable(SourceError):
    """The configured host does not answer like the source (moved, down, parked)."""


@dataclass
class SiteInfo:
    host: str
    version: str
    app_url: str | None
    cdn_url: str | None
    telegram_link: str | None
    component: str | None


def _data_page(html: str) -> dict:
    node = BeautifulSoup(html, "lxml").find("div", {"id": "app"})
    raw = node.get("data-page") if node else None
    if not raw:
        raise SourceUnreachable("page carries no Inertia data-page payload")
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise SourceUnreachable(f"malformed data-page payload: {exc}") from exc


def _session() -> requests.Session:
    return net.new_session(pool_size=4)


def fetch_page(host: str, path: str, *, params: dict | None = None,
               session: requests.Session | None = None, timeout: int = 12) -> dict:
    """The full Inertia payload (component, props, version, url) of one page."""
    s = session or _session()
    try:
        r = net.get_with_retry(s, f"https://{host}{path}", params=params, attempts=2,
                               timeout=timeout, what=f"GET {host}{path}")
    except requests.RequestException as exc:
        raise SourceUnreachable(f"{host} unreachable: {type(exc).__name__}") from exc
    if not r.ok:
        raise SourceUnreachable(f"{host}{path} answered HTTP {r.status_code}")
    return _data_page(r.text)


def site_info(host: str, timeout: int = 10) -> SiteInfo:
    """Fingerprint a host. Raises SourceUnreachable unless it serves the source.

    The test is structural, not cosmetic: a parked domain, a lander or a clone
    with a different backend does not produce an Inertia payload carrying the
    source's own props (``scws_url`` pointing at the video host, ``sliders``).
    """
    page = fetch_page(host, f"/{LOCALE}", timeout=timeout)
    props = page.get("props") or {}
    if not page.get("version") or "scws_url" not in props or "sliders" not in props:
        raise SourceUnreachable(f"{host} serves an Inertia app, but not the source")
    return SiteInfo(
        host=host,
        version=str(page.get("version")),
        app_url=props.get("app_url"),
        cdn_url=props.get("cdn_url"),
        telegram_link=props.get("telegram_link"),
        component=page.get("component"),
    )


# ── Normalisation ─────────────────────────────────────────────────────────────

def _image(images: list | None, *kinds: str) -> str | None:
    for kind in kinds:
        for img in images or []:
            if img.get("type") == kind and img.get("filename"):
                return img["filename"]
    return None


def _year(raw: dict) -> str | None:
    date = raw.get("release_date") or (raw.get("last_air_date") if raw.get("type") == "movie" else None)
    date = str(date or "")[:4]
    return date if len(date) == 4 and date.isdigit() else None


def normalize_title(raw: dict) -> dict | None:
    if raw.get("id") is None or not str(raw.get("name") or "").strip():
        return None
    return {
        "id": raw["id"],
        "slug": raw.get("slug") or "",
        "name": raw["name"],
        "type": raw.get("type") or "movie",
        "score": raw.get("score"),
        "year": _year(raw) or (str(raw.get("last_air_date") or "")[:4] or None),
        "seasons_count": raw.get("seasons_count") or 0,
        "poster": _image(raw.get("images"), "poster"),
        "cover": _image(raw.get("images"), "cover", "background"),
    }


# ── Public API ────────────────────────────────────────────────────────────────

def search(host: str, query: str, *, page: int = 1, media_type: str | None = None) -> list[dict]:
    params = {"q": query}
    if page > 1:
        params["page"] = page
    props = fetch_page(host, f"/{LOCALE}/search", params=params).get("props") or {}
    titles = props.get("titles") or []
    if media_type:
        titles = [t for t in titles if t.get("type") == media_type]
    return [t for t in (normalize_title(x) for x in titles[:RESULT_CAP]) if t]


def home_shelves(host: str) -> list[dict]:
    props = fetch_page(host, f"/{LOCALE}").get("props") or {}
    shelves = []
    for slider in props.get("sliders") or []:
        items = [t for t in (normalize_title(x) for x in (slider.get("titles") or [])[:SHELF_CAP]) if t]
        if items:
            shelves.append({"key": slider.get("name") or slider.get("label"),
                            "label": slider.get("label"), "items": items})
    return shelves


class TitleSession:
    """A short-lived browsing session for one title page.

    The season endpoint wants the XSRF cookie the title page sets, so both
    requests go through one ``requests.Session``.
    """

    def __init__(self, host: str, title_id: int, slug: str):
        self.host = host
        self.title_id = int(title_id)
        self.slug = slug
        self.session = _session()
        self.version: str | None = None

    def _inertia(self, path: str, referer: str | None = None) -> dict:
        if self.version is None:
            page = fetch_page(self.host, f"/{LOCALE}/titles/{self.title_id}-{self.slug}",
                              session=self.session)
            self.version = str(page.get("version") or "")
            if path == f"/{LOCALE}/titles/{self.title_id}-{self.slug}":
                return page
        headers = {"X-Inertia": "true", "X-Inertia-Version": self.version,
                   "X-Requested-With": "XMLHttpRequest"}
        token = self.session.cookies.get("XSRF-TOKEN")
        if token:
            headers["X-XSRF-TOKEN"] = unquote(token)
        if referer:
            headers["Referer"] = referer
        r = net.get_with_retry(self.session, f"https://{self.host}{path}", headers=headers,
                               what=f"inertia {path}")
        if r.status_code == 409:  # asset version changed: Inertia asks for a full reload
            self.version = None
            return self._inertia(path, referer)
        if not r.ok:
            raise SourceError(f"{path} answered HTTP {r.status_code}")
        return r.json()

    def title(self) -> dict:
        props = self._inertia(f"/{LOCALE}/titles/{self.title_id}-{self.slug}").get("props") or {}
        t = props.get("title") or {}
        if not t:
            raise SourceError("title page carries no title")
        trailers = t.get("trailers") or []
        yt = trailers[0].get("youtube_id") if trailers else None
        score = t.get("score")
        return {
            **(normalize_title(t) or {}),
            "plot": t.get("plot") or None,
            "genres": [g.get("name") for g in t.get("genres") or [] if g.get("name")],
            "rating": round(float(score), 1) if score else None,
            "runtime": t.get("runtime"),
            "quality": t.get("quality"),
            "age": t.get("age"),
            "original_name": t.get("original_name"),
            "status": t.get("status"),
            "tmdb_id": t.get("tmdb_id"),
            "backdrop": _image(t.get("images"), "background", "cover"),
            "logo": _image(t.get("images"), "logo"),
            "trailer": f"https://www.youtube.com/watch?v={yt}" if yt else None,
            "cast": [p.get("name") for p in (t.get("main_actors") or [])[:15] if p.get("name")],
            "seasons": [{"number": s.get("number"), "episodes_count": s.get("episodes_count")}
                        for s in t.get("seasons") or []],
        }

    def season(self, number: int) -> list[dict]:
        base = f"/{LOCALE}/titles/{self.title_id}-{self.slug}"
        props = self._inertia(f"{base}/season-{int(number)}", referer=f"https://{self.host}{base}").get("props") or {}
        episodes = (props.get("loadedSeason") or {}).get("episodes") or []
        return [{
            "id": ep["id"],
            "number": ep.get("number"),
            "name": ep.get("name") or "",
            "plot": ep.get("plot") or None,
            "duration": ep.get("duration"),
            "still": _image(ep.get("images"), "cover", "still", "background"),
        } for ep in episodes if ep.get("id") is not None]


def image_urls(host: str, cdn_url: str | None, filename: str) -> list[str]:
    """Where an artwork file may be served from, best first."""
    urls = []
    if cdn_url:
        cdn_host = urlparse(cdn_url).hostname
        if cdn_host:
            urls.append(f"https://{cdn_host}/images/{filename}")
    urls += [f"https://cdn.{host}/images/{filename}", f"https://{host}/images/{filename}"]
    return list(dict.fromkeys(urls))
