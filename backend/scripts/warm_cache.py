#!/usr/bin/env python
"""
Pre-populate the MongoDB cache so visitors never wait on FastF1.

Run it after a race weekend and the new round is instant for everyone.

    python scripts/warm_cache.py                 # current season, races already run
    python scripts/warm_cache.py --year 2025     # a whole season
    python scripts/warm_cache.py --year 2026 --round 13
    python scripts/warm_cache.py --years 2023 2024 2025 2026 --sessions Q R
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
from services.fastf1_service import (  # noqa: E402
    get_track_data,
    get_lap_telemetry,
    get_race_results,
)


def completed_rounds(year: int):
    """Rounds whose event date has passed."""
    sched = fastf1.get_event_schedule(year)
    today = datetime.now(timezone.utc).date()
    out = []
    for r in sched.itertuples():
        if r.RoundNumber and r.RoundNumber > 0 and r.EventDate.date() <= today:
            out.append((int(r.RoundNumber), r.EventName))
    return out


def warm_one(year, rnd, name, sessions, force):
    for st in sessions:
        label = f"{year} R{rnd:<2} {st}  {name[:34]}"
        keys = [f"track:{year}:{rnd}:{st}", f"tel:{year}:{rnd}:{st}:fastest"]
        if not force and all(cache_get(k) is not None for k in keys):
            print(f"  SKIP  {label}  (cached)")
            continue
        t0 = time.time()
        try:
            if force:
                # bypass the read-through cache by clearing first
                from database import _cache, _connect
                _connect()
            track = get_track_data(year, rnd, st)
            if track.get("error"):
                print(f"  SKIP  {label}  ({track['error']})")
                continue
            get_lap_telemetry(year, rnd, st, "fastest")
            # results are cheap but nice to have warm too
            try:
                res = get_race_results(year, rnd, st)
                cache_set(f"res:{year}:{rnd}:{st}", res)
            except Exception:
                pass
            print(f"  OK    {label}  {time.time()-t0:5.1f}s")
        except Exception as e:
            print(f"  FAIL  {label}  {type(e).__name__}: {str(e)[:70]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int)
    ap.add_argument("--years", type=int, nargs="+")
    ap.add_argument("--round", type=int)
    ap.add_argument("--recent", type=int, help="only the last N completed rounds")
    ap.add_argument("--sessions", nargs="+", default=["Q"],
                    help="session codes, e.g. Q R FP3 (default: Q)")
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
            warm_one(year, rnd, name, a.sessions, a.force)

    print(f"\nDone in {(time.time()-total0)/60:.1f} min.")


if __name__ == "__main__":
    main()
