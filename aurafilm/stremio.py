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

def run_stremio_server():
    logger.info("Starting Stremio addon server on port 7000...")
    # uvicorn.run(addon_app, host="0.0.0.0", port=7000, log_level="warning")

def start():
    t = threading.Thread(target=run_stremio_server, daemon=True)
    t.start()
