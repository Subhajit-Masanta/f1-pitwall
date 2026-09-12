"""
📄 session_loader.py — getting a FastF1 session, once.

Everything else in `services/` starts by asking for a session. This module owns
that: where FastF1's disk cache lives, how a session is loaded, and the schema
version that keys every processed payload.

NOTE ON async: the service layer is all plain `def`, not `async def`. FastF1
does blocking work (network + disk + heavy pandas), and FastAPI runs plain `def`
path operations in a worker thread — so a slow race load no longer freezes the
whole server for every other request.
"""
import gc
import threading
from pathlib import Path

import fastf1

# FastF1 downloads huge files; cache them so a server restart doesn't re-fetch
# everything. Pinned to an absolute path next to this file and created if
# missing, so it works no matter what folder the server is started from.
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE_DIR))


# Bump this whenever the SHAPE of a cached payload changes, so stale entries
# from an older schema are ignored instead of silently served.
#   v2 — added per-point speed ("S") to track_points for the speed-coloured line
#   v3 — added brake_zones (distance ranges where the driver was on the brakes)
#   v4 — added per-point throttle ("T") to track_points for the pedal trace
#   v5 — added longitudinal g ("A") + peak_decel_g: real braking magnitude,
#        because FastF1's Brake channel is boolean and has none
#   v6 — per-point D is now the TRUE Distance at that point on the line, not
#        arc-length scaled proportionally (they drift up to 33m apart)
#   v7 — invalidates v6: those entries were written while the car's position
#        mapping was briefly (and wrongly) inverted rather than pro-rata
#   v8 — added team_color to telemetry + the /drivers picker payload
#   v9 — the playback timeline now lands exactly on the lap time; np.arange
#        stopped up to one frame short, so every replay ended early
CACHE_SCHEMA = "v9"


# ---------------------------------------------------------------------------
# Shared session loading
# ---------------------------------------------------------------------------
# A single compare page asks for /track, /drivers and two /telemetry. Each used
# to call session.load() itself, so the SAME session was downloaded and parsed
# four times, concurrently — four times the network, the CPU and the memory, on
# a 512MB box whose FastF1 disk cache starts empty after every deploy. That is
# what made the live site time out on any session the Mongo cache had not been
# warmed for.
#
# The lock serialises callers asking for the same session; the one-entry memo
# means the others get the already-loaded object instead of re-reading it. Only
# the most recent session is held, so memory stays bounded to what a single
# request needed anyway.
_load_lock = threading.Lock()
_last_session = {"key": None, "session": None}


def load_session(year: int, race_round, session_type: str):
    """Load a FastF1 session, reusing it if someone just loaded the same one."""
    key = (year, str(race_round), str(session_type))
    with _load_lock:
        if _last_session["key"] == key and _last_session["session"] is not None:
            print(f"[SESSION REUSE] {key}")
            return _last_session["session"]

        # Drop the previous session BEFORE loading the next one. Holding both
        # at once is how a 512MB instance runs out of memory: a loaded session
        # with telemetry is well over a hundred megabytes.
        _last_session["key"] = None
        _last_session["session"] = None
        gc.collect()

        session = fastf1.get_session(year, race_round, session_type)
        session.load()
        _last_session["key"] = key
        _last_session["session"] = session
        return session


def pd_isna(v):
    try:
        import pandas as pd
        return bool(pd.isna(v))
    except Exception:
        return False
