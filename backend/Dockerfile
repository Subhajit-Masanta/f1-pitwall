# F1 Race Replay — API
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# deps first so this layer caches across code changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# FastF1's own disk cache. On ephemeral hosts this is just a per-container
# scratch area — the durable cache is MongoDB (see database.py).
RUN mkdir -p /app/cache
ENV FASTF1_CACHE=/app/cache

EXPOSE 8000
# Render/Cloud Run inject $PORT; default to 8000 locally.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
