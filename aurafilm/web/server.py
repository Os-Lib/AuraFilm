"""FastAPI Application assembly and lifespan management."""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .. import config
from ..jobs import job_manager
from ..source import domain
from .api import router as api_router

import sys

logger = logging.getLogger(__name__)

if getattr(sys, 'frozen', False):
    # Eseguibile compilato con PyInstaller
    base_dir = Path(sys._MEIPASS) / "aurafilm" / "web"
else:
    # Esecuzione da sorgente Python
    base_dir = Path(__file__).parent

STATIC_DIR = base_dir / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting AuraFilm service...")
    job_manager.start()

    stop_domain_watch = threading.Event()
    domain_thread = threading.Thread(
        target=domain.watch_loop, args=(stop_domain_watch,), name="DomainWatcher", daemon=True
    )
    domain_thread.start()

    yield

    # Shutdown
    logger.info("Shutting down AuraFilm service...")
    stop_domain_watch.set()
    job_manager.stop()


def create_app() -> FastAPI:
    app = FastAPI(
        title="AuraFilm",
        description="Self-hosted web panel to search and download films and TV series",
        version="0.1.0",
        lifespan=lifespan,
    )

    # API Routes
    app.include_router(api_router)

    # Static Assets
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    # Single Page App index
    @app.get("/")
    async def serve_index():
        return FileResponse(
            STATIC_DIR / "index.html", 
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )

    return app
