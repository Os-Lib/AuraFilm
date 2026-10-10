FROM python:3.11-slim

# Install system dependencies (FFmpeg for muxing/compression)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install (we simulate this for now)
# RUN pip install -r requirements.txt
# Since we don't have requirements.txt yet, we install what we know
RUN pip install --no-cache-dir fastapi uvicorn requests cryptography apscheduler

COPY . .

# Expose Web UI port and Stremio addon port
EXPOSE 8080
EXPOSE 7000

CMD ["python", "main.py"]
