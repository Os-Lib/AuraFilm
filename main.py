"""AuraFilm entrypoint."""

import logging
import uvicorn
from aurafilm import config
from aurafilm.web.server import create_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

app = create_app()

if __name__ == "__main__":
    from aurafilm import __version__
    print(f"\n=======================================================")
    print(f"  AuraFilm v{__version__}")
    print(f"  Web Panel: http://{config.HOST}:{config.PORT}")
    print(f"=======================================================\n")
    try:
        uvicorn.run(app, host=config.HOST, port=config.PORT)
    except Exception as e:
        print(f"\n[ERRORE FATALE] Il server si è bloccato: {e}")
        input("Premi INVIO per uscire...")
