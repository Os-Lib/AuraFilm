FROM python:3.11-slim

# Install system dependencies (FFmpeg for video muxing and H.265 compression)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Expose Web Panel port
EXPOSE 8080

CMD ["python", "main.py"]
