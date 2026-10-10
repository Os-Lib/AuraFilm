"""Stremio Addon Router for AuraFilm."""

import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from urllib.parse import quote

from aurafilm import config
from aurafilm.source import site, domain, stream
import requests

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/stremio", tags=["stremio"])

@router.get("/manifest.json")
def get_manifest():
    return {
        "id": "com.aurafilm.stremio",
        "version": "1.0.0",
        "name": "AuraFilm",
        "description": "High-speed Italian and Multi-audio streaming from AuraFilm.",
        "resources": ["stream"],
        "types": ["movie", "series"],
        "catalogs": []
    }

@router.get("/stream/{media_type}/{item_id}.json")
def get_stream(media_type: str, item_id: str):
    """
    item_id for movies: tt1234567
    item_id for series: tt1234567:season:episode (e.g. tt1234567:1:2)
    """
    cur_domain = domain.current()
    host = config.get().get("host", "0.0.0.0")
    port = config.get().get("port", 8080)
    
    imdb_id = item_id
    season_idx = None
    episode_idx = None
    
    if ":" in item_id:
        parts = item_id.split(":")
        imdb_id = parts[0]
        if len(parts) >= 3:
            season_idx = int(parts[1])
            episode_idx = int(parts[2])

    api_key = config.get().get("tmdb_api_key")
    # If no TMDB API key is set, we use a public fallback key for external ID resolution
    fallback_key = "45dbdd5962d49d81337b597286377317"
    active_key = api_key or fallback_key

    try:
        find_url = f"https://api.themoviedb.org/3/find/{imdb_id}?api_key={active_key}&external_source=imdb_id&language=it-IT"
        res = requests.get(find_url, timeout=10).json()
        
        target_name = None
        if media_type == "movie":
            results = res.get("movie_results", [])
            if results:
                target_name = results[0].get("title")
        else:
            results = res.get("tv_results", [])
            if results:
                target_name = results[0].get("name")
                
        if not target_name:
            logger.warning("Stremio: TMDB could not resolve %s", imdb_id)
            return {"streams": []}

        # Search title on StreamingCommunity
        sc_results = site.search(cur_domain, target_name, media_type=media_type)
        if not sc_results:
            return {"streams": []}

        sc_item = sc_results[0]
        title_id = sc_item["id"]
        slug = sc_item["slug"]
        
        episode_id = None
        if media_type == "series" and season_idx is not None and episode_idx is not None:
            # Resolve specific episode ID
            ts = site.TitleSession(cur_domain, title_id, slug)
            season_data = ts.season(season_idx)
            episodes = season_data.get("episodes") or []
            matched_ep = next((e for e in episodes if e.get("number") == episode_idx), None)
            if matched_ep:
                episode_id = matched_ep.get("id")

        play_url = f"/api/stremio/play/{title_id}/{slug}" + (f"?episode_id={episode_id}" if episode_id else "")

        return {
            "streams": [
                {
                    "name": "AuraFilm [Full HD]",
                    "title": f"{target_name} (StreamingCommunity - Ita/Original)",
                    "url": play_url
                }
            ]
        }
    except Exception as e:
        logger.error("Stremio stream resolution error: %s", e)
        return {"streams": []}


@router.get("/play/{title_id}/{slug}")
def stremio_direct_play(title_id: int, slug: str, episode_id: int | None = None):
    cur_domain = domain.current()
    try:
        st = stream.resolve(cur_domain, title_id, episode_id=episode_id)
        return RedirectResponse(st.master_url)
    except Exception as e:
        logger.error("Direct play resolve error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
