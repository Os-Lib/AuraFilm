"""FastAPI REST and Server-Sent Events API."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List

import requests
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import config, events, i18n, net
from ..jobs import job_manager
from ..source import domain, site

logger = logging.getLogger(__name__)

router = APIRouter()


class SetupPayload(BaseModel):
    language: str
    domain: str | None = None


class DomainSetPayload(BaseModel):
    domain: str


class MovieDownloadPayload(BaseModel):
    title_id: int
    slug: str
    title_name: str
    year: str | None = None
    audio_languages: List[str] = ["ita"]
    subtitle_languages: List[str] = []


class EpisodeDownloadPayload(BaseModel):
    tv_id: int
    slug: str
    tv_name: str
    season: int
    episode_id: int
    episode_number: int
    episode_name: str | None = None
    year: str | None = None
    audio_languages: List[str] = ["ita"]
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

@router.get("/api/search/actor")
async def search_actor_movies(q: str = Query(..., min_length=2)):
    # Feature Idea #2: Actor/Director Deep Search via TMDB
    api_key = config.get().get("tmdb_api_key")
    if not api_key:
        raise HTTPException(status_code=400, detail="TMDB API Key missing in settings")
    try:
        # Search person
        resp = requests.get(f"https://api.themoviedb.org/3/search/person", params={"api_key": api_key, "query": q, "language": "it-IT"}).json()
        if not resp.get("results"):
            return {"results": []}
        person_id = resp["results"][0]["id"]
        # Get credits
        credits = requests.get(f"https://api.themoviedb.org/3/person/{person_id}/movie_credits", params={"api_key": api_key, "language": "it-IT"}).json()
        cast_movies = credits.get("cast", [])
        return {"person": resp["results"][0]["name"], "results": sorted(cast_movies, key=lambda x: x.get("popularity", 0), reverse=True)[:20]}
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
    if not cur:
        raise HTTPException(status_code=404, detail="No domain configured")
    session = net.new_session(pool_size=4)
    urls = [
        f"https://cdn.{cur}/images/{filename}",
        f"https://{cur}/images/{filename}",
    ]
    for url in urls:
        try:
            resp = await asyncio.to_thread(
                session.get, url, headers={"Referer": f"https://{cur}/"}, timeout=10
            )
            if resp.ok and resp.headers.get("Content-Type", "").startswith("image/"):
                return Response(
                    content=resp.content,
                    media_type=resp.headers.get("Content-Type"),
                    headers={"Cache-Control": "public, max-age=86400"},
                )
        except Exception:
            pass
    raise HTTPException(status_code=404, detail="Image not found")


# ── Downloads & Jobs ──────────────────────────────────────────────────────────

@router.get("/api/jobs")
async def list_jobs():
    return {"jobs": job_manager.list_jobs()}


@router.post("/api/jobs/movie")
async def download_movie(payload: MovieDownloadPayload):
    job = job_manager.enqueue(
        item_type="movie",
        title_id=payload.title_id,
        slug=payload.slug,
        title_name=payload.title_name,
        year=payload.year,
        audio_languages=payload.audio_languages,
        subtitle_languages=payload.subtitle_languages,
    )
    return {"status": "ok", "job": job.as_dict()}


@router.post("/api/jobs/episode")
async def download_episode(payload: EpisodeDownloadPayload):
    job = job_manager.enqueue(
        item_type="episode",
        title_id=payload.tv_id,
        slug=payload.slug,
        title_name=payload.tv_name,
        year=payload.year,
        season=payload.season,
        episode_id=payload.episode_id,
        episode_number=payload.episode_number,
        episode_name=payload.episode_name,
        audio_languages=payload.audio_languages,
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
                "path": str(rel),
                "name": p.name,
                "size_mb": round(sz / (1024 * 1024), 1),
                "modified": p.stat().st_mtime,
                "type": p.suffix[1:].lower(),
            })
    return {"files": results, "total_size_mb": round(total_bytes / (1024 * 1024), 1)}

@router.get("/api/files/download/{filename:path}")
async def download_file(filename: str):
    import os
    from fastapi.responses import FileResponse
    dl_dir = Path(config.value("download_dir"))
    file_path = (dl_dir / filename).resolve()
    
    # Security check: ensure path is within dl_dir
    if not str(file_path).startswith(str(dl_dir)):
        raise HTTPException(status_code=403, detail="Forbidden")
        
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
        
    return FileResponse(path=file_path, filename=file_path.name)


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
