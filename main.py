"""StreamHarbor entrypoint."""

import logging
import uvicorn
from streamharbor import config
from streamharbor.web.server import create_app

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)

app = create_app()

if __name__ == "__main__":
    print(f"\n=======================================================")
    print(f"  StreamHarbor v0.1.0")
    print(f"  Web Panel: http://{config.HOST}:{config.PORT}")
    print(f"=======================================================\n")
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=False)
