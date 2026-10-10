"""TMDB integration for scraping metadata and generating NFO files."""

import logging
import json
from pathlib import Path
from typing import Optional, Dict, Any

import requests

logger = logging.getLogger(__name__)

TMDB_API_URL = "https://api.themoviedb.org/3"

def search_media(query: str, api_key: str, is_tv: bool = False) -> Optional[Dict[str, Any]]:
    """Search TMDB for a movie or TV show."""
    if not api_key:
        return None
        
    endpoint = "/search/tv" if is_tv else "/search/movie"
    url = f"{TMDB_API_URL}{endpoint}"
    
    try:
        resp = requests.get(url, params={
            "api_key": api_key,
            "query": query,
            "language": "it-IT"
        }, timeout=10)
        
        if resp.status_code == 200:
            data = resp.json()
            if data.get("results"):
                return data["results"][0]
    except Exception as e:
        logger.warning(f"TMDB search failed: {e}")
        
    return None

def get_details(media_id: int, api_key: str, is_tv: bool = False) -> Optional[Dict[str, Any]]:
    """Get full details including credits."""
    if not api_key:
        return None
        
    endpoint = f"/tv/{media_id}" if is_tv else f"/movie/{media_id}"
    url = f"{TMDB_API_URL}{endpoint}"
    
    try:
        resp = requests.get(url, params={
            "api_key": api_key,
            "append_to_response": "credits",
            "language": "it-IT"
        }, timeout=10)
        
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        logger.warning(f"TMDB details failed: {e}")
        
    return None

def generate_nfo(metadata: Dict[str, Any], output_path: Path, is_tv: bool = False) -> None:
    """Generate a Kodi/Plex compatible NFO file."""
    if not metadata:
        return
        
    try:
        title = metadata.get("name" if is_tv else "title", "")
        original_title = metadata.get("original_name" if is_tv else "original_title", "")
        plot = metadata.get("overview", "")
        rating = metadata.get("vote_average", 0)
        year = metadata.get("first_air_date" if is_tv else "release_date", "")[:4]
        
        root_tag = "tvshow" if is_tv else "movie"
        
        nfo_content = f"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
        nfo_content += f"<{root_tag}>\n"
        nfo_content += f"  <title>{title}</title>\n"
        nfo_content += f"  <originaltitle>{original_title}</originaltitle>\n"
        nfo_content += f"  <rating>{rating}</rating>\n"
        nfo_content += f"  <year>{year}</year>\n"
        nfo_content += f"  <plot>{plot}</plot>\n"
        
        # Add cast
        credits = metadata.get("credits", {}).get("cast", [])
        for actor in credits[:10]:
            name = actor.get("name", "")
            role = actor.get("character", "")
            thumb = f"https://image.tmdb.org/t/p/w500{actor.get('profile_path')}" if actor.get("profile_path") else ""
            nfo_content += "  <actor>\n"
            nfo_content += f"    <name>{name}</name>\n"
            nfo_content += f"    <role>{role}</role>\n"
            if thumb:
                nfo_content += f"    <thumb>{thumb}</thumb>\n"
            nfo_content += "  </actor>\n"
            
        nfo_content += f"</{root_tag}>\n"
        
        output_path.write_text(nfo_content, encoding="utf-8")
        logger.info(f"NFO generated: {output_path.name}")
    except Exception as e:
        logger.error(f"Failed to write NFO: {e}")

def download_poster(metadata: Dict[str, Any], output_path: Path) -> None:
    """Download the poster image."""
    poster_path = metadata.get("poster_path")
    if not poster_path:
        return
        
    url = f"https://image.tmdb.org/t/p/original{poster_path}"
    try:
        resp = requests.get(url, stream=True, timeout=15)
        if resp.status_code == 200:
            with open(output_path, "wb") as f:
                for chunk in resp.iter_content(8192):
                    f.write(chunk)
            logger.info(f"Poster downloaded: {output_path.name}")
    except Exception as e:
        logger.error(f"Failed to download poster: {e}")
