# StreamHarbor ⚓

A modern, lightweight self-hosted web panel to search and download movies and TV series into your media library.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python: 3.11+](https://img.shields.io/badge/python-3.11+-brightgreen.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com)

---

## Highlights

- 🧠 **Intelligent Domain Auto-Discovery**: Automatically discovers and validates active StreamingCommunity domains through multi-witness verification (canonical declarations, redirects, Telegram announcements, and link feeds) so the service keeps working seamlessly even when the domain rotates.
- 🌍 **Multilingual First-Run Setup**: Welcome wizard with built-in support for **English**, **Italiano**, **Español**, **Français**, **Deutsch**, and **Português**.
- ⚡ **High-Performance HLS Downloader**: Parallel chunk downloads with AES-128 CBC decryption, exponential backoff on CDN congestion, and automatic sequential retry for missing segments.
- 🎬 **Lossless Audio & Subtitle Remuxing**: Native stream copying into `.mkv` or `.mp4` via FFmpeg without re-encoding, preserving full video quality, multiple audio tracks, and embedded or external subtitles.
- 🖥️ **Modern Web Interface**: Responsive dark-mode dashboard with home shelves (trending, latest additions, top 10), live search, title details, season browser, real-time download progress (via Server-Sent Events), and integrated library file browser.
- 📦 **Zero-Config Setup**: Bundles FFmpeg fallback automatically on Windows and requires no external database.

---

## Screenshots & Interface

- **Home Shelves**: Browse trending titles and newest releases straight from the source.
- **Search & Detail View**: Synopsis, ratings, artwork, genre tags, and season/episode pickers.
- **Download Queue**: Live percentage, download speed, remaining time, and phase tracking (`resolving` → `video` → `audio` → `muxing` → `finished`).
- **Domain Status**: Visual indicator of domain health with one-click "Check & Heal Now".

---

## Quick Start

### Prerequisites
- Python 3.11 or newer
- FFmpeg (automatically detected if installed or on PATH; otherwise uses bundled binary)

### Running on Windows
Double-click `start.bat` or run:

```bat
# Clone the repository
git clone https://github.com/yourusername/StreamHarbor.git
cd StreamHarbor

# Run setup and start
start.bat
```

### Running from Terminal (Cross-Platform)

```bash
# 1. Clone repository
git clone https://github.com/yourusername/StreamHarbor.git
cd StreamHarbor

# 2. Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Start the server
python main.py
```

The web dashboard will be available at **`http://localhost:8080`**.

---

## How Smart Domain Discovery Works

Streaming services rotate domains regularly. StreamHarbor implements a robust multi-witness verification engine:

```
[ Domain Signals ]
   ├── Site Canonical Headers (Score: +6)
   ├── Historical Domain Redirects (Score: +5)
   ├── Official Telegram Channel Feed (Score: +3)
   ├── Updated Link Aggregators (Score: +3)
   └── TLD Resolution Sweep (Score: +1)
             │
             ▼
[ Security & Functional Verification ]
   ├── 1. Check shape & Second-Level Domain constraint
   ├── 2. Verify all DNS records point to public IP addresses
   ├── 3. Match backend fingerprint (Inertia props & version)
   └── 4. Perform functional test query
             │
             ▼
[ Ranked Best Candidate Applied / Self-Healed Automatically ]
```

---

## Output Structure

Files are organized in standard media server format (compatible with Jellyfin, Plex, and Emby):

```
downloads/
├── The Matrix (1999)/
│   ├── The Matrix (1999).mkv
│   └── The Matrix (1999).it.vtt
└── Breaking Bad (2008)/
    └── Season 01/
        ├── Breaking Bad S01E01 - Pilot.mkv
        └── Breaking Bad S01E02 - Cat's in the Bag....mkv
```

---

## Disclaimer

This software is provided for **educational and research purposes only**. It demonstrates HLS stream parsing, AES segment decryption, multi-track muxing, and web application architecture. It does not host, store, or distribute any media content. Users are responsible for complying with the laws of their jurisdiction.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
