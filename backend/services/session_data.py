"""
📄 session_data.py — what exists, and who was in it.

The catalogue endpoints: the season calendar, a weekend's sessions, a session's
classification, and the driver picker. None of these produce replay payloads —
they answer "what can I watch, and who is in it" so the UI can build its menus.

Cache access goes through `database.cache_get` / `database.cache_set` rather
than importing the names directly. That keeps ONE patch point for tests that
need to bypass Mongo — see tests/test_replay_integration.py::no_cache.
"""
import fastf1
import numpy as np

import database
from services.session_loader import CACHE_SCHEMA, load_session, pd_isna


def get_race_calendar(year: int):
    """
    Get the full F1 schedule for a specific year.
    Returns: List of races with Round Number, Name, and Location.
    """
    print(f"[INFO] Fetching {year} Calendar...")
    schedule = fastf1.get_event_schedule(year)

    # Filter out "Testing" sessions (RoundNumber 0), we only want real races.
    races = []
    for row in schedule.itertuples():
        if row.RoundNumber > 0:
            races.append(
                {
                    "round": int(row.RoundNumber),
                    "name": row.EventName,
                    "location": row.Location,
                    "date": str(row.EventDate.date()),
                }
            )

    return races


def get_race_results(year: int, race_round: int, session_type: str = "R"):
    """
    Classification for a session: finishing order, team, grid, status, points.
    Works even where telemetry doesn't, since it only needs timing data.
    """
    print(f"[INFO] Fetching results for {year} R{race_round} ({session_type})...")
    # Deliberately NOT load_session(): this is a lighter load with telemetry
    # off. Sharing it would let a later caller pick up a session with no
    # telemetry and fail confusingly.
    session = fastf1.get_session(year, race_round, session_type)
    session.load(telemetry=False, weather=False, messages=False)

    def _num(v, cast=int, default=None):
        try:
            if v is None or (isinstance(v, float) and np.isnan(v)):
                return default
            return cast(v)
        except (TypeError, ValueError):
            return default

    standings = []
    for row in session.results.itertuples():
        lap_time = getattr(row, "Time", None)
        standings.append({
            "position": _num(row.Position),
            "number": str(row.DriverNumber),
            "code": row.Abbreviation,
            "name": row.FullName,
            "team": row.TeamName,
            "color": f"#{str(row.TeamColor).lstrip('#')}" if row.TeamColor else "#888888",
            "grid": _num(getattr(row, "GridPosition", None)),
            "points": _num(getattr(row, "Points", None), float, 0.0),
            "status": str(getattr(row, "Status", "") or ""),
            "time": str(lap_time) if lap_time is not None and not pd_isna(lap_time) else None,
        })

    standings = [s for s in standings if s["position"] is not None]
    standings.sort(key=lambda x: x["position"])

    return {
        "race_name": session.event.EventName,
        "session": session.name,
        "location": session.event.Location,
        "year": year,
        "round": race_round,
        "total_drivers": len(standings),
        "standings": standings,
    }


# Session name -> the short code FastF1 accepts and the URL carries.
# The names move around between seasons: 2023 sprint weekends ran a "Sprint
# Shootout", 2024 renamed it "Sprint Qualifying", and the running order differs
# too — so the list is read from the event rather than assumed.
SESSION_CODES = {
    "Qualifying": "Q",
    "Race": "R",
    "Sprint": "S",
    "Sprint Shootout": "SS",
    "Sprint Qualifying": "SQ",
}


def get_race_sessions(year: int, race_round: int):
    """
    The sessions of a race weekend worth replaying, in running order.

    Practice is deliberately left out: it is long, mostly not representative,
    and nobody comes here to watch FP2.
    """
    key = f"sessions:{CACHE_SCHEMA}:{year}:{race_round}"
    hit = database.cache_get(key)
    if hit is not None:
        return hit

    print(f"[INFO] Fetching sessions for {year} Round {race_round}...")
    event = fastf1.get_event(year, race_round)

    sessions = []
    for i in range(1, 6):
        try:
            name = getattr(event, f"Session{i}")
        except Exception:
            continue
        if not name:
            continue
        code = SESSION_CODES.get(str(name).strip())
        if code:
            sessions.append({"code": code, "name": str(name).strip()})

    result = {
        "race": event.EventName,
        "location": event.Location,
        "sessions": sessions,
    }
    database.cache_set(key, result)
    return result


def get_session_drivers(year: int, race_round: int, session_type: str):
    """
    Everyone who set a lap in this session, ordered by their fastest one.

    This is the picker for head-to-head: code, team, team colour and the gap to
    the session-best, so the UI can show a real timing-sheet ordering rather
    than an arbitrary driver list.
    """
    key = f"drivers:{CACHE_SCHEMA}:{year}:{race_round}:{session_type}"
    hit = database.cache_get(key)
    if hit is not None:
        print(f"[CACHE HIT] {key}")
        return hit

    session = load_session(year, race_round, session_type)

    laps = session.laps
    if laps is None or laps.empty:
        return {"error": "No laps in this session"}

    best = laps.groupby("DriverNumber")["LapTime"].min().sort_values()

    drivers = []
    pole = None
    for num, lap_time in best.items():
        if lap_time is None or np.isnan(lap_time.total_seconds()):
            continue
        secs = float(lap_time.total_seconds())
        if pole is None:
            pole = secs
        try:
            info = session.get_driver(num)
            code = str(info["Abbreviation"])
            name = str(info["FullName"])
            team = str(info["TeamName"])
            colour = str(info["TeamColor"] or "").strip().lstrip("#")
        except Exception:
            code, name, team, colour = str(num), str(num), "", ""
        drivers.append({
            "number": str(num),
            "code": code,
            "name": name,
            "team": team,
            # FastF1 gives the hex without the hash
            "color": f"#{colour}" if colour else "#9E9E9E",
            "lap_time": round(secs, 3),
            "gap": round(secs - pole, 3),
        })

    result = {"drivers": drivers, "session": session.name}
    database.cache_set(key, result)
    return result
