"""Telegram Bot remote control integration."""

import logging
import threading
import time
from urllib.parse import quote
import requests

from aurafilm import config
from aurafilm.jobs import job_manager
from aurafilm.source import site, domain

logger = logging.getLogger(__name__)

def send_message(token: str, chat_id: int, text: str):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        requests.post(url, json={"chat_id": chat_id, "text": text}, timeout=10)
    except Exception as e:
        logger.warning("Failed to send Telegram message: %s", e)

def handle_message(msg: dict, token: str):
    chat = msg.get("chat", {})
    chat_id = chat.get("id")
    text = msg.get("text", "").strip()

    if not chat_id or not text:
        return

    allowed_ids = config.get().get("telegram_allowed_ids", [])
    if allowed_ids and chat_id not in allowed_ids:
        send_message(token, chat_id, "Non sei autorizzato ad usare questo bot.")
        return

    # Basic Commands
    if text.startswith("/start"):
        send_message(token, chat_id, "Benvenuto in AuraFilm Bot.\nScrivi /cerca <nome film> per trovare un film, oppure usa l'interfaccia web.")
    
    elif text.startswith("/cerca"):
        query = text.replace("/cerca", "").strip()
        if not query:
            send_message(token, chat_id, "Devi specificare un titolo. Es: /cerca Il Gladiatore")
            return
            
        cur = domain.current()
        if not cur:
            send_message(token, chat_id, "Nessun dominio StreamingCommunity configurato.")
            return
            
        try:
            results = site.search(cur, query)
            if not results:
                send_message(token, chat_id, f"Nessun risultato trovato per '{query}'.")
                return
                
            resp_txt = "*Risultati Ricerca:*\n\n"
            for idx, r in enumerate(results[:5]):
                resp_txt += f"*{idx+1}. {r['name']}*\n"
                resp_txt += f"Scrivi: `/scarica {r['id']} {r['slug']}`\n\n"
            
            send_message(token, chat_id, resp_txt)
        except Exception as e:
            send_message(token, chat_id, f"Errore durante la ricerca: {e}")

    elif text.startswith("/scarica"):
        parts = text.split()
        if len(parts) < 3:
            send_message(token, chat_id, "Uso: /scarica <ID> <slug>")
            return
            
        title_id = parts[1]
        slug = parts[2]
        
        try:
            job_manager.enqueue(
                item_type="movie",
                title_id=int(title_id),
                slug=slug,
                title_name=slug.replace("-", " ").title()
            )
            send_message(token, chat_id, "Download avviato con successo.")
        except Exception as e:
            send_message(token, chat_id, f"Errore: {e}")
            
    elif text.startswith("/file"):
        # Fornisce un link di download diretto aggirando il limite di 50MB
        host = config.get().get("host", "127.0.0.1")
        port = config.get().get("port", 8080)
        
        # Example direct listing:
        url = f"http://{host}:{port}/"
        send_message(token, chat_id, f"I film completati sono scaricabili dalla web dashboard: {url}")

def _poll_telegram(token: str):
    logger.info("Telegram Bot polling started.")
    offset = 0
    while True:
        url = f"https://api.telegram.org/bot{token}/getUpdates?offset={offset}&timeout=30"
        try:
            resp = requests.get(url, timeout=35)
            if resp.status_code == 200:
                data = resp.json()
                for item in data.get("result", []):
                    offset = item["update_id"] + 1
                    msg = item.get("message")
                    if msg:
                        handle_message(msg, token)
        except requests.exceptions.RequestException:
            time.sleep(5)
        except Exception as e:
            logger.error("Telegram bot error: %s", e)
            time.sleep(5)
            
        time.sleep(1)

def start_bot():
    token = config.get().get("telegram_bot_token")
    if not token:
        logger.info("No Telegram bot token found. Bot disabled.")
        return

    t = threading.Thread(target=_poll_telegram, args=(token,), daemon=True)
    t.start()
