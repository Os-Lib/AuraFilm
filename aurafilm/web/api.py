"""FastAPI REST and Server-Sent Events API."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Dict, List

import requests
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import config, events, i18n, net
from ..hls import playlist
from ..jobs import job_manager
from ..source import domain, site, stream

logger = logging.getLogger(__name__)

router = APIRouter()
_image_session = net.new_session(pool_size=24)

_PLACEHOLDER_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">'
    '<rect width="300" height="450" fill="#161d2d"/>'
    '<text x="150" y="225" fill="#8c9cb8" font-family="sans-serif" font-size="18" '
    'font-weight="600" text-anchor="middle" dominant-baseline="middle">AuraFilm</text>'
    '</svg>'
).encode("utf-8")


class SetupPayload(BaseModel):
    language: str
    domain: str | None = None


class DomainSetPayload(BaseModel):
    domain: str


class MovieDownloadPayload(BaseModel):
    title_id: int | None = None
    id: int | None = None
    slug: str
    title_name: str | None = None
    name: str | None = None
    year: str | None = None
    audio_languages: List[str] | None = None
    audio: List[str] | None = None
    subtitle_languages: List[str] = []


class EpisodeDownloadPayload(BaseModel):
    tv_id: int | None = None
    id: int | None = None
    slug: str
    tv_name: str | None = None
    name: str | None = None
    season: int
    episode_id: int
    episode_number: int | None = None
    episode: int | None = None
    episode_name: str | None = None
    year: str | None = None
    audio_languages: List[str] | None = None
    audio: List[str] | None = None
    subtitle_languages: List[str] = []


class SeasonDownloadPayload(BaseModel):
    tv_id: int
    slug: str
    tv_name: str
    season: int
    episodes: List[Dict[str, Any]]
    year: str | None = None
    audio_languages: List[str] = ["ita"]
    subtitle_languages: List[str] = []


# ── System & Setup ────────────────────────────────────────────────────────────

@router.get("/api/status")
async def get_system_status():
    cfg = config.get()
    cur_domain = domain.current()
    return {
        "setup_done": cfg.get("setup_done", False),
        "language": cfg.get("language", "en"),
        "preferred_audio": cfg.get("preferred_audio", "ita"),
        "domain": cur_domain,
        "domain_auto_apply": cfg.get("domain_auto_apply", True),
        "download_dir": cfg.get("download_dir"),
        "active_jobs": len([j for j in job_manager.list_jobs() if j["status"] in ("queued", "running")]),
    }


@router.get("/api/languages")
async def get_languages():
    return i18n.SUPPORTED_LANGUAGES


@router.get("/api/i18n/{lang}")
async def get_i18n(lang: str):
    return i18n.get_strings(lang)


@router.post("/api/setup")
async def complete_setup(payload: SetupPayload):
    lang = payload.language if payload.language in i18n.SUPPORTED_LANGUAGES else "en"
    updates: Dict[str, Any] = {"setup_done": True, "language": lang}
    if payload.domain:
        norm = domain.normalize_host(payload.domain)
        updates["domain"] = norm
    config.update(updates)
    # If no domain given, trigger immediate background discovery
    if not payload.domain and not domain.current():
        asyncio.create_task(asyncio.to_thread(domain.check_and_heal, force=True))
    return {"status": "ok", "settings": config.get()}


# ── Domain Management ─────────────────────────────────────────────────────────

@router.get("/api/domain/status")
async def get_domain_status():
    report = domain.last_report()
    return {
        "current": domain.current(),
        "is_running": domain.is_running(),
        "pending": domain.pending(),
        "last_report": report,
    }


@router.post("/api/domain/check")
async def trigger_domain_check(force: bool = True):
    if domain.is_running():
        return {"status": "already_running"}
    asyncio.create_task(asyncio.to_thread(domain.check_and_heal, force=force))
    return {"status": "started"}


@router.post("/api/domain/set")
async def set_domain(payload: DomainSetPayload):
    try:
        res = await asyncio.to_thread(domain.apply, payload.domain)
        return {"status": "ok", **res}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ── Content Discovery ─────────────────────────────────────────────────────────

@router.get("/api/shelves")
async def get_shelves():
    cur = domain.current()
    if not cur:
        return {"shelves": [], "error": "No domain configured"}
    try:
        shelves = await asyncio.to_thread(site.home_shelves, cur)
        return {"shelves": shelves}
    except Exception as exc:
        logger.warning("Failed to fetch shelves: %s", exc)
        domain.on_source_failure()
        return {"shelves": [], "error": str(exc)}


@router.get("/api/search")
async def search_titles(q: str = Query(..., min_length=1), page: int = 1, type: str | None = None):
    cur = domain.current()
    if not cur:
        raise HTTPException(status_code=503, detail="No domain configured")
    try:
        titles = await asyncio.to_thread(site.search, cur, q, page=page, media_type=type)
        return {"results": titles, "page": page}
    except Exception as exc:
        domain.on_source_failure()
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/genre")
async def browse_by_genre(genre: str = Query(..., min_length=1), page: int = 1, type: str | None = None):
    cur = domain.current()
    if not cur:
        raise HTTPException(status_code=503, detail="No domain configured")
    try:
        titles = await asyncio.to_thread(site.browse_genre, cur, genre, page=page, media_type=type)
        return {"results": titles, "page": page, "genre": genre, "type": type}
    except Exception as exc:
        domain.on_source_failure()
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/search/actor")
async def search_actor_movies(q: str = Query(..., min_length=2)):
    api_key = (config.get().get("tmdb_api_key") or "").strip()
    try:
        def _fetch_actor_tmdb():
            if not api_key:
                return None
            r = requests.get(
                "https://api.themoviedb.org/3/search/person",
                params={"api_key": api_key, "query": q, "language": "it-IT"},
                timeout=10,
            )
            if not r.ok:
                return None
            resp = r.json()
            if not resp.get("results"):
                return {"results": []}
            person = resp["results"][0]
            c = requests.get(
                f"https://api.themoviedb.org/3/person/{person['id']}/combined_credits",
                params={"api_key": api_key, "language": "it-IT"},
                timeout=10,
            )
            if not c.ok:
                return None
            credits = c.json()
            items = credits.get("cast", [])
            items.sort(key=lambda x: x.get("popularity", 0), reverse=True)
            normalized = []
            seen_titles = set()
            for item in items:
                mtype = "tv" if item.get("media_type") == "tv" else "movie"
                name = item.get("title") or item.get("name")
                if not name or name.lower() in seen_titles:
                    continue
                seen_titles.add(name.lower())
                date = item.get("release_date") or item.get("first_air_date") or ""
                normalized.append({
                    "id": item.get("id"),
                    "tmdb_only": True,
                    "name": name,
                    "type": mtype,
                    "year": date[:4] if len(date) >= 4 else None,
                    "score": round(float(item["vote_average"]), 1) if item.get("vote_average") else None,
                    "poster_url": f"https://image.tmdb.org/t/p/w342{item['poster_path']}" if item.get("poster_path") else None,
                })
                if len(normalized) >= 24:
                    break
            return {"person": person["name"], "results": normalized}

        def _fetch_actor_wikidata():
            headers = {"User-Agent": "AuraFilm/1.1.1"}
            w_resp = requests.get(
                "https://www.wikidata.org/w/api.php",
                params={"action": "wbsearchentities", "search": q, "language": "en", "format": "json"},
                headers=headers,
                timeout=10,
            )
            if not w_resp.ok:
                return {"results": []}
            entities = w_resp.json().get("search", [])
            if not entities:
                return {"results": []}
            person = entities[0]
            qid = person.get("id", "")
            if not re.fullmatch(r"Q\d+", qid):
                return {"results": []}

            sparql = (
                "SELECT ?filmLabel (MIN(YEAR(?date)) AS ?year) (SAMPLE(?imdb) AS ?imdb_id) (MAX(?sitelinks) AS ?pop) "
                f"WHERE {{ ?film wdt:P161 wd:{qid} ; wikibase:sitelinks ?sitelinks ; rdfs:label ?filmLabel . "
                "FILTER(LANG(?filmLabel) = 'en') "
                "OPTIONAL { ?film wdt:P577 ?date } "
                "OPTIONAL { ?film wdt:P345 ?imdb } } "
                "GROUP BY ?filmLabel ORDER BY DESC(?pop) LIMIT 24"
            )
            sp_resp = requests.get(
                "https://query.wikidata.org/sparql",
                params={"query": sparql, "format": "json"},
                headers=headers,
                timeout=12,
            )
            if not sp_resp.ok:
                return {"results": []}
            bindings = sp_resp.json().get("results", {}).get("bindings", [])
            normalized = []
            seen_titles = set()
            for idx, b in enumerate(bindings):
                name = b.get("filmLabel", {}).get("value")
                if not name or name.lower() in seen_titles:
                    continue
                seen_titles.add(name.lower())
                year_val = b.get("year", {}).get("value")
                imdb_id = b.get("imdb_id", {}).get("value")
                normalized.append({
                    "id": idx + 1,
                    "tmdb_only": True,
                    "name": name,
                    "type": "movie",
                    "year": year_val[:4] if year_val and len(year_val) >= 4 else None,
                    "score": None,
                    "poster_url": f"https://images.metahub.space/poster/medium/{imdb_id}/img" if imdb_id else None,
                })
            return {"person": person.get("label", q), "results": normalized}

        def _fetch_actor():
            tmdb_res = _fetch_actor_tmdb()
            if tmdb_res is not None:
                return tmdb_res
            return _fetch_actor_wikidata()

        return await asyncio.to_thread(_fetch_actor)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/title/{title_id}/probe")
async def probe_title_stream(title_id: int, episode_id: int | None = None):
    cur = domain.current()
    if not cur:
        raise HTTPException(status_code=503, detail="No domain configured")
    try:
        def _probe():
            st = stream.resolve(cur, title_id, episode_id=episode_id)
            sess = net.new_session(pool_size=4)
            master = playlist.parse_master(sess, st.master_url, referer=st.referer)
            langs = master.languages()
            qualities = sorted({v.height for v in master.variants if v.height}, reverse=True)
            return {
                "audio": langs.get("audio", []),
                "subtitles": langs.get("subtitles", []),
                "qualities": qualities,
            }

        return await asyncio.to_thread(_probe)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/title/{title_id}/{slug}")
async def get_title_details(title_id: int, slug: str):
    cur = domain.current()
    if not cur:
        raise HTTPException(status_code=503, detail="No domain configured")
    try:
        sess = site.TitleSession(cur, title_id, slug)
        details = await asyncio.to_thread(sess.title)
        return {"title": details}
    except Exception as exc:
        domain.on_source_failure()
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/title/{title_id}/{slug}/season/{number}")
async def get_season_episodes(title_id: int, slug: str, number: int):
    cur = domain.current()
    if not cur:
        raise HTTPException(status_code=503, detail="No domain configured")
    try:
        sess = site.TitleSession(cur, title_id, slug)
        episodes = await asyncio.to_thread(sess.season, number)
        return {"season": number, "episodes": episodes}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/api/image/{filename:path}")
async def proxy_image(filename: str):
    cur = domain.current()
    if cur and filename:
        urls = [
            f"https://cdn.{cur}/images/{filename}",
            f"https://{cur}/images/{filename}",
        ]
        for url in urls:
            try:
                resp = await asyncio.to_thread(
                    _image_session.get, url, headers={"Referer": f"https://{cur}/"}, timeout=10
                )
                if resp.ok and resp.headers.get("Content-Type", "").startswith("image/"):
                    return Response(
                        content=resp.content,
                        media_type=resp.headers.get("Content-Type"),
                        headers={"Cache-Control": "public, max-age=86400"},
                    )
            except Exception:
                pass
    return Response(
        content=_PLACEHOLDER_SVG,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ── Downloads & Jobs ──────────────────────────────────────────────────────────

@router.get("/api/jobs")
async def list_jobs():
    return {"jobs": job_manager.list_jobs()}


@router.post("/api/jobs/movie")
async def download_movie(payload: MovieDownloadPayload):
    tid = payload.title_id if payload.title_id is not None else payload.id
    tname = payload.title_name or payload.name
    if tid is None or not tname:
        raise HTTPException(status_code=422, detail="title_id and title_name are required")
    audios = payload.audio_languages if payload.audio_languages is not None else payload.audio
    if not audios:
        audios = ["ita"]
    job = job_manager.enqueue(
        item_type="movie",
        title_id=tid,
        slug=payload.slug,
        title_name=tname,
        year=payload.year,
        audio_languages=audios,
        subtitle_languages=payload.subtitle_languages,
    )
    return {"status": "ok", "job": job.as_dict()}


@router.post("/api/jobs/episode")
async def download_episode(payload: EpisodeDownloadPayload):
    tv_id = payload.tv_id if payload.tv_id is not None else payload.id
    tv_name = payload.tv_name or payload.name
    ep_num = payload.episode_number if payload.episode_number is not None else payload.episode
    if tv_id is None or not tv_name or ep_num is None:
        raise HTTPException(status_code=422, detail="tv_id, tv_name and episode_number are required")
    audios = payload.audio_languages if payload.audio_languages is not None else payload.audio
    if not audios:
        audios = ["ita"]
    job = job_manager.enqueue(
        item_type="episode",
        title_id=tv_id,
        slug=payload.slug,
        title_name=tv_name,
        year=payload.year,
        season=payload.season,
        episode_id=payload.episode_id,
        episode_number=ep_num,
        episode_name=payload.episode_name,
        audio_languages=audios,
        subtitle_languages=payload.subtitle_languages,
    )
    return {"status": "ok", "job": job.as_dict()}


@router.post("/api/jobs/season")
async def download_season(payload: SeasonDownloadPayload):
    jobs = []
    for ep in payload.episodes:
        j = job_manager.enqueue(
            item_type="episode",
            title_id=payload.tv_id,
            slug=payload.slug,
            title_name=payload.tv_name,
            year=payload.year,
            season=payload.season,
            episode_id=ep["id"],
            episode_number=ep.get("number"),
            episode_name=ep.get("name"),
            audio_languages=payload.audio_languages,
            subtitle_languages=payload.subtitle_languages,
        )
        jobs.append(j.as_dict())
    return {"status": "ok", "jobs": jobs}


@router.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    ok = job_manager.cancel(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "ok"}


@router.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    ok = job_manager.remove(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "ok"}


@router.post("/api/jobs/clear")
async def clear_jobs():
    cleared = job_manager.clear_completed()
    return {"status": "ok", "cleared": cleared}


# ── Files & Settings ──────────────────────────────────────────────────────────

@router.get("/api/files")
async def list_files():
    dl_dir = Path(config.value("download_dir"))
    if not dl_dir.exists():
        return {"files": [], "total_size": 0}

    results = []
    total_bytes = 0
    for p in sorted(dl_dir.rglob("*"), key=lambda f: f.stat().st_mtime if f.is_file() else 0, reverse=True):
        if p.is_file() and p.suffix.lower() in (".mkv", ".mp4", ".vtt"):
            sz = p.stat().st_size
            total_bytes += sz
            rel = p.relative_to(dl_dir)
            results.append({
                "path": str(rel).replace("\\", "/"),
                "name": p.name,
                "size_mb": round(sz / (1024 * 1024), 1),
                "modified": p.stat().st_mtime,
                "type": p.suffix[1:].lower(),
            })
    return {"files": results, "total_size_mb": round(total_bytes / (1024 * 1024), 1)}

@router.api_route("/api/files/download/{filename:path}", methods=["GET", "HEAD"])
async def download_file(filename: str):
    from fastapi.responses import FileResponse
    dl_dir = Path(config.value("download_dir")).resolve()
    file_path = (dl_dir / filename).resolve()
    
    # Security check: ensure path is within dl_dir
    if not str(file_path).startswith(str(dl_dir)):
        raise HTTPException(status_code=403, detail="Forbidden")
        
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
        
    return FileResponse(path=file_path, filename=file_path.name)


@router.delete("/api/files/{filename:path}")
async def delete_file(filename: str):
    dl_dir = Path(config.value("download_dir")).resolve()
    file_path = (dl_dir / filename).resolve()

    if not str(file_path).startswith(str(dl_dir)):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        file_path.unlink()
        return {"status": "ok", "deleted": filename}
    except Exception as e:
        logger.error("Failed to delete file %s: %s", filename, e)
        raise HTTPException(status_code=500, detail=str(e))



@router.get("/api/settings")
async def get_settings():
    return config.get()


@router.post("/api/settings")
async def update_settings(payload: Dict[str, Any]):
    updated = config.update(payload)
    return {"status": "ok", "settings": updated}


# ── Server-Sent Events (Live Updates) ─────────────────────────────────────────

@router.get("/api/events")
async def sse_events(request: Request):
    loop, queue = events.subscribe()

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    # Keep-alive ping
                    yield ": ping\n\n"
        finally:
            events.unsubscribe((loop, queue))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

from fastapi.responses import StreamingResponse


@router.get("/api/stream/proxy/{id}/{slug}")
def stream_proxy_master(id: int, slug: str, episode_id: int | None = None):
    from aurafilm.source import stream, domain
    cur_domain = domain.current()
    try:
        st = stream.resolve(cur_domain, id, episode_id=episode_id)
        from fastapi.responses import RedirectResponse
        return RedirectResponse(st.master_url)
    except Exception as e:
        logger.error("Proxy error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ── Watchlist / Preferiti ──────────────────────────────────────────────────────

WATCHLIST_FILE = config.DATA_DIR / "watchlist.json"

def _load_watchlist() -> list:
    if not WATCHLIST_FILE.exists():
        return []
    try:
        with open(WATCHLIST_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def _save_watchlist(data: list):
    WATCHLIST_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(WATCHLIST_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

@router.get("/api/watchlist")
def get_watchlist():
    return {"watchlist": _load_watchlist()}

@router.post("/api/watchlist")
def toggle_watchlist(payload: dict):
    # payload: { "id": int, "name": str, "slug": str, "poster": str, "type": str }
    items = _load_watchlist()
    item_id = payload.get("id")
    exists = any(it.get("id") == item_id for it in items)
    if exists:
        items = [it for it in items if it.get("id") != item_id]
        _save_watchlist(items)
        return {"status": "removed", "id": item_id}
    else:
        items.insert(0, payload)
        _save_watchlist(items)
        return {"status": "added", "id": item_id}


# ── Cronologia & Continua a Guardare ──────────────────────────────────────────

HISTORY_FILE = config.DATA_DIR / "history.json"

def _load_history() -> list:
    if not HISTORY_FILE.exists():
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def _save_history(data: list):
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

@router.get("/api/history")
def get_history():
    return {"history": _load_history()}

@router.post("/api/history")
def update_history(payload: dict):
    # payload: { "id": int, "slug": str, "name": str, "poster": str, "type": str, "episode_id": int | None, "current_time": float, "duration": float }
    items = _load_history()
    key = f"{payload.get('id')}_{payload.get('episode_id') or ''}"
    items = [it for it in items if f"{it.get('id')}_{it.get('episode_id') or ''}" != key]
    payload["timestamp"] = time.time()
    items.insert(0, payload)
    _save_history(items[:50]) # Conserva gli ultimi 50
    return {"status": "ok"}

@router.post("/api/history/delete")
def delete_history_item(payload: dict):
    # payload: { "id": int, "episode_id": int | None }
    items = _load_history()
    key = f"{payload.get('id')}_{payload.get('episode_id') or ''}"
    items = [it for it in items if f"{it.get('id')}_{it.get('episode_id') or ''}" != key]
    _save_history(items)
    return {"status": "ok", "history": items}


# ── Statistiche Disco & Codec ────────────────────────────────────────────────

@router.get("/api/stats")
def get_system_stats():
    import shutil
    dl_dir = Path(config.value("download_dir"))
    
    total_b, used_b, free_b = shutil.disk_usage(str(dl_dir.parent if not dl_dir.exists() else dl_dir))
    
    total_files = 0
    total_size = 0
    formats = {}
    
    if dl_dir.exists():
        for p in dl_dir.rglob("*"):
            if p.is_file() and p.suffix.lower() in (".mkv", ".mp4", ".vtt"):
                total_files += 1
                sz = p.stat().st_size
                total_size += sz
                ext = p.suffix[1:].lower()
                formats[ext] = formats.get(ext, 0) + 1
                
    return {
        "disk": {
            "total_gb": round(total_b / (1024**3), 1),
            "used_gb": round(used_b / (1024**3), 1),
            "free_gb": round(free_b / (1024**3), 1),
            "used_percent": round((used_b / total_b) * 100, 1)
        },
        "library": {
            "total_files": total_files,
            "total_size_gb": round(total_size / (1024**3), 2),
            "formats": formats
        }
    }


# ── Calendario Uscite ────────────────────────────────────────────────────────

@router.get("/api/calendar")
def get_calendar():
    from aurafilm.source import site, domain
    cur = domain.current()
    if not cur:
        return {"releases": []}
    try:
        p = site.fetch_page(cur, f"/{site.LOCALE}")
        sliders = p.get("props", {}).get("sliders", [])
        recent_series = []
        for s in sliders:
            if "recente" in (s.get("label") or "").lower():
                for t in s.get("titles", []):
                    norm = site.normalize_title(t) or {}
                    if t.get("type") == "tv":
                        recent_series.append({
                            "id": t["id"],
                            "slug": t["slug"],
                            "name": t["name"],
                            "type": t.get("type", "tv"),
                            "score": t.get("score"),
                            "seasons_count": t.get("seasons_count") or 0,
                            "year": t.get("last_air_date_it") or t.get("last_air_date") or norm.get("year") or "",
                            "poster": norm.get("poster"),
                            "cover": norm.get("cover"),
                        })
        return {"releases": recent_series[:20]}
    except Exception as e:
        logger.warning("Calendar fetch error: %s", e)
        return {"releases": []}

