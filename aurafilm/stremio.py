"""Stremio Addon Server."""

import logging
from fastapi import FastAPI
import uvicorn
import threading

logger = logging.getLogger(__name__)

addon_app = FastAPI(title="AuraFilm Stremio Addon")

@addon_app.get("/manifest.json")
def get_manifest():
    return {
        "id": "com.aurafilm.stremio",
        "version": "1.0.0",
        "name": "AuraFilm Streamer",
        "description": "Stream instantly from StreamingCommunity.",
        "resources": ["stream"],
        "types": ["movie", "series"],
        "catalogs": []
    }

@addon_app.get("/stream/{type}/{id}.json")
def get_stream(type: str, id: str):
    # Esempio ID da Stremio: tt1234567 (IMDb ID)
    # 1. Troviamo il film su TMDB tramite l'IMDB ID
    from aurafilm import config
    from aurafilm.source import site, domain
    import requests

    api_key = config.get().get("tmdb_api_key")
    if not api_key:
        logger.error("Nessuna API Key TMDB per Stremio")
        return {"streams": []}

    try:
        # TMDB find by external ID
        find_url = f"https://api.themoviedb.org/3/find/{id}?api_key={api_key}&external_source=imdb_id&language=it-IT"
        res = requests.get(find_url).json()
        
        movies = res.get("movie_results", [])
        if not movies:
            return {"streams": []}
            
        title = movies[0]["title"]
        
        # 2. Cerchiamo il titolo su StreamingCommunity
        cur_domain = domain.current()
        sc_results = site.search(cur_domain, title, media_type="movie")
        
        if not sc_results:
            return {"streams": []}
            
        sc_movie = sc_results[0]
        
        # 3. Restituiamo uno stream 'falso' o diretto
        # Stremio si aspetterà un link giocabile (m3u8 o mp4).
        # Per ora rimandiamo a un bridge interno.
        
        host = config.get().get("host", "127.0.0.1")
        port = config.get().get("port", 8080)
        
        # Stream fittizio di test che innesterà il download reale nel prossimo step
        return {
            "streams": [
                {
                    "name": "AuraFilm [HD]",
                    "title": f"Riproduci {title} da StreamingCommunity",
                    "url": f"http://{host}:{port}/api/stremio/play/{sc_movie['id']}/{sc_movie['slug']}"
                }
            ]
        }
    except Exception as e:
        logger.error("Errore Stremio resolve: %s", e)
        return {"streams": []}

def run_stremio_server():
    logger.info("Starting Stremio addon server on port 7000...")
    # uvicorn.run(addon_app, host="0.0.0.0", port=7000, log_level="warning")

def start():
    t = threading.Thread(target=run_stremio_server, daemon=True)
    t.start()
