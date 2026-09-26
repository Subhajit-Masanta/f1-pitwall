"""
📄 database.py — MongoDB-backed cache for processed session data.

WHY THIS EXISTS
---------------
FastF1's own disk cache only stores the *raw* downloaded API responses. Even
with it fully warm, `session.load()` still re-parses all 20 drivers' timing
data through pandas on every request — measured at ~7s.

So we cache the *finished* JSON instead, gzipped, keyed by session. A hit
returns in tens of milliseconds rather than seconds, and because it lives in
Atlas rather than on local disk it survives container restarts — which is what
makes free ephemeral-disk hosts (Render, Cloud Run) viable.

Uses pymongo (sync) deliberately: the service layer is synchronous and FastAPI
runs those path operations in a worker thread.
"""
import gzip
import json
import os
from datetime import datetime, timezone

from dotenv import load_dotenv

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
DB_NAME = os.getenv("MONGODB_DB", "f1_replay")
CACHE_COLLECTION = os.getenv("MONGODB_CACHE_COLLECTION", "session_cache")
CACHE_ENABLED = os.getenv("CACHE_ENABLED", "1") not in ("0", "false", "False")

_client = None
_cache = None


def _connect():
    """Create the client lazily so import never fails on a bad/absent URI."""
    global _client, _cache
    if _client is not None or not MONGODB_URI or not CACHE_ENABLED:
        return
    try:
        from pymongo import MongoClient
        _client = MongoClient(
            MONGODB_URI,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            appname="f1-pitwall",
        )
        _cache = _client[DB_NAME][CACHE_COLLECTION]
    except Exception as e:
        print(f"[WARN] MongoDB client could not be created: {e}")
        _client, _cache = None, None


def check_db_connection():
    """Ping at startup. Never raises — the app works fine without a cache."""
    if not CACHE_ENABLED:
        print("[INFO] Cache disabled via CACHE_ENABLED=0")
        return False
    if not MONGODB_URI:
        print("[WARN] MONGODB_URI not set — running without a cache (every request will be slow).")
        return False
    _connect()
    if _cache is None:
        return False
    try:
        _client.admin.command("ping")
        n = _cache.estimated_document_count()
        print(f"[OK] MongoDB cache connected — {n} sessions cached.")
        return True
    except Exception as e:
        print(f"[ERROR] MongoDB unreachable, continuing without cache: {e}")
        return False


def cache_get(key: str):
    """Return the cached payload for `key`, or None on any miss/error."""
    if not CACHE_ENABLED:
        return None
    _connect()
    if _cache is None:
        return None
    try:
        doc = _cache.find_one({"_id": key}, {"gz": 1})
        if not doc or "gz" not in doc:
            return None
        return json.loads(gzip.decompress(bytes(doc["gz"])).decode("utf-8"))
    except Exception as e:
        print(f"[WARN] cache_get({key}) failed: {e}")
        return None


def _drop_older(key: str):
    """Remove other schema generations of the same logical key."""
    import re
    m = re.match(r"^([a-z]+):v\d+:(.*)$", key)
    if not m or _cache is None:
        return
    kind, rest = m.group(1), m.group(2)
    try:
        _cache.delete_many({
            "_id": {"$regex": f"^{re.escape(kind)}:v[0-9]+:{re.escape(rest)}$",
                    "$ne": key},
        })
    except Exception as e:
        print(f"[WARN] pruning older generations of {key} failed: {e}")


def cache_set(key: str, payload: dict):
    """Store `payload` gzipped. Best-effort — failures never break a request."""
    if not CACHE_ENABLED:
        return
    _connect()
    if _cache is None:
        return
    try:
        from bson.binary import Binary
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        blob = gzip.compress(raw, 6)
        _cache.replace_one(
            {"_id": key},
            {
                "_id": key,
                "gz": Binary(blob),
                "raw_bytes": len(raw),
                "gz_bytes": len(blob),
                "updated_at": datetime.now(timezone.utc),
            },
            upsert=True,
        )
        print(f"[CACHE] stored {key} ({len(blob)/1024:.0f} KB gz, from {len(raw)/1024:.0f} KB)")
        # The same payload from an older schema is now dead weight. Dropping
        # it here is what stops every bump leaving a whole generation behind:
        # `race:v19:2023:3:R` goes when `race:v20:2023:3:R` arrives.
        _drop_older(key)
    except Exception as e:
        print(f"[WARN] cache_set({key}) failed: {e}")


def cache_drop_stale(current_schema: str, dry_run: bool = True):
    """
    Delete cache documents from a superseded schema.

    Every key carries the schema it was built with — `race:v20:2023:3:R` — so a
    bump does not overwrite the old document, it writes a new one beside it and
    the old one is never read again. Measured before the first prune: 1,167
    documents, of which about 1,100 were generations v2 to v19, and a race
    payload is 1.2 MB.

    Nothing reads a stale key by construction, so this is safe; `dry_run` is
    the default anyway, because it is someone's live cache.

    Returns (kept, removed, bytes_freed).
    """
    _connect()
    if _cache is None:
        return (0, 0, 0)
    import re
    pattern = re.compile(r"^[a-z]+:(v\d+):")
    kept = removed = freed = 0
    stale = []
    for doc in _cache.find({}, {"_id": 1, "gz_bytes": 1}):
        m = pattern.match(str(doc["_id"]))
        # A key with no schema in it predates the scheme entirely, so it can
        # never be read either.
        if m and m.group(1) == current_schema:
            kept += 1
            continue
        removed += 1
        freed += int(doc.get("gz_bytes") or 0)
        stale.append(doc["_id"])
    if not dry_run and stale:
        for i in range(0, len(stale), 500):
            _cache.delete_many({"_id": {"$in": stale[i:i + 500]}})
    return (kept, removed, freed)


def cache_stats():
    """Small summary for the /health endpoint."""
    if not CACHE_ENABLED:
        return {"enabled": False}
    _connect()
    if _cache is None:
        return {"enabled": True, "connected": False}
    try:
        docs = list(_cache.find({}, {"gz_bytes": 1}))
        return {
            "enabled": True,
            "connected": True,
            "sessions": len(docs),
            "stored_kb": round(sum(d.get("gz_bytes", 0) for d in docs) / 1024, 1),
        }
    except Exception as e:
        return {"enabled": True, "connected": False, "error": str(e)}
