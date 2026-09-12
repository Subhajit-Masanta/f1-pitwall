#!/usr/bin/env python
"""
Pre-populate the MongoDB cache so visitors never wait on FastF1.

Run it after a race weekend and the new round is instant for everyone.

    python scripts/warm_cache.py                 # current season, races already run
    python scripts/warm_cache.py --year 2025     # a whole season
    python scripts/warm_cache.py --year 2026 --round 13
    python scripts/warm_cache.py --years 2023 2024 2025 2026 --sessions Q R
    python scripts/warm_cache.py --year 2023 --drivers 6   # head-to-head ready
    python scripts/warm_cache.py --recent 2      # only the last N completed rounds

Safe to re-run: anything already cached is skipped unless --force.
"""
import argparse
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import fastf1  # noqa: E402
from database import cache_get, cache_set, check_db_connection  # noqa: E402
from services.session_loader import CACHE_SCHEMA  # noqa: E402
from services.session_data import (  # noqa: E402
    get_race_results,
    get_race_sessions,
    get_session_drivers,
)
from services.track_data import get_track_data  # noqa: E402
from services.lap_data import get_lap_telemetry  # noqa: E402


def completed_rounds(year: int):
    """Rounds whose event date has passed."""
    sched = fastf1.get_event_schedule(year)
    today = datetime.now(timezone.utc).date()
    out = []
    for r in sched.itertuples():
        if r.RoundNumber and r.RoundNumber > 0 and r.EventDate.date() <= today:
            out.append((int(r.RoundNumber), r.EventName))
    return out


def warm_one(year, rnd, name, sessions, force, n_drivers=0):
    # The weekend's session list — one per round, not per session. Cheap, and
    # the session picker is blocked on it before anything else can be chosen.
    try:
        if force or cache_get(f"sessions:{CACHE_SCHEMA}:{year}:{rnd}") is None:
            get_race_sessions(year, rnd)
    except Exception as e:
        print(f"  WARN  {year} R{rnd} session list: {type(e).__name__}")

    for st in sessions:
        label = f"{year} R{rnd:<2} {st:<2} {name[:32]}"
        keys = [f"track:{CACHE_SCHEMA}:{year}:{rnd}:{st}",
                f"tel:{CACHE_SCHEMA}:{year}:{rnd}:{st}:fastest",
                f"drivers:{CACHE_SCHEMA}:{year}:{rnd}:{st}"]
        if not force and all(cache_get(k) is not None for k in keys) and not n_drivers:
            print(f"  SKIP  {label}  (cached)")
            continue
        t0 = time.time()
        try:
            track = get_track_data(year, rnd, st)
            if track.get("error"):
                print(f"  SKIP  {label}  ({track['error']})")
                continue
            get_lap_telemetry(year, rnd, st, "fastest")

            # The head-to-head picker needs this list before it can offer
            # anyone, and it is the first thing a compare page waits on.
            drivers = []
            try:
                dd = get_session_drivers(year, rnd, st)
                drivers = dd.get("drivers", []) if not dd.get("error") else []
            except Exception as e:
                print(f"  WARN  {label} drivers: {type(e).__name__}")

            # Compare mode loads a SECOND driver on demand. Warming the quickest
            # few covers the pairings anyone actually picks; warming all twenty
            # of every session would be ~50MB and over half an hour.
            warmed = 0
            for d in drivers[:n_drivers]:
                key = f"tel:{CACHE_SCHEMA}:{year}:{rnd}:{st}:{d['number'].lower()}"
                if not force and cache_get(key) is not None:
                    continue
                try:
                    get_lap_telemetry(year, rnd, st, d["number"])
                    warmed += 1
                except Exception:
                    pass

            try:
                res = get_race_results(year, rnd, st)
                cache_set(f"res:{CACHE_SCHEMA}:{year}:{rnd}:{st}", res)
            except Exception:
                pass

            extra = f"  +{warmed} drivers" if warmed else ""
            print(f"  OK    {label}  {time.time()-t0:5.1f}s{extra}")
        except Exception as e:
            print(f"  FAIL  {label}  {type(e).__name__}: {str(e)[:70]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int)
    ap.add_argument("--years", type=int, nargs="+")
    ap.add_argument("--round", type=int)
    ap.add_argument("--recent", type=int, help="only the last N completed rounds")
    ap.add_argument("--sessions", nargs="+", default=["Q", "R"],
                    help="session codes: Q R S SS SQ (default: Q R)")
    ap.add_argument("--drivers", type=int, default=0, metavar="N",
                    help="also warm the N quickest drivers' laps, for head-to-head")
    ap.add_argument("--force", action="store_true", help="re-fetch even if cached")
    a = ap.parse_args()

    if not check_db_connection():
        print("\n[FATAL] No cache connection — warming would be pointless.")
        print("        Set MONGODB_URI (see backend/.env.example) and retry.")
        sys.exit(1)

    years = a.years or ([a.year] if a.year else [datetime.now().year])
    total0 = time.time()

    for year in years:
        rounds = completed_rounds(year)
        if a.round:
            rounds = [r for r in rounds if r[0] == a.round]
        if a.recent:
            rounds = rounds[-a.recent:]
        print(f"\n=== {year}: {len(rounds)} round(s), sessions={a.sessions} ===")
        for rnd, name in rounds:
            warm_one(year, rnd, name, a.sessions, a.force, a.drivers)

    print(f"\nDone in {(time.time()-total0)/60:.1f} min.")


if __name__ == "__main__":
    main()
