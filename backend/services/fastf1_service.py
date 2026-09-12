import gc
import threading
from pathlib import Path

import fastf1
import numpy as np

from database import cache_get, cache_set

# 1. Setup Cache (Important!)
# FastF1 downloads huge files. We must cache them so we don't
# download them every time we restart the server.
# We pin the cache to an absolute path next to this file and create it
# if it does not exist yet, so it works no matter what folder the server
# is started from.
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE_DIR))


"""This is the Service Layer. It encapsulates all the complex business logic - like fetching data from the FastF1 library,
cleaning it, processing telemetry, and formatting it - so that the Controller (main.py) stays clean and simple.

NOTE ON async: every function here is a plain `def`, not `async def`.
FastF1 does blocking work (network + disk + heavy pandas). FastAPI automatically
runs plain `def` path operations in a worker thread, so a slow race load no
longer freezes the whole server for every other request.
"""


# Service / Business Logic Layer

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


def get_race_data_test():
    """
    Test function to download 2023 Bahrain Grand Prix Race data.
    """
    print("[INFO] Fetching session data... (this might take a minute)")

    session = fastf1.get_session(2023, "Bahrain", "R")
    session.load()

    fastest = session.laps.pick_fastest()
    print("[OK] Session Loaded!")

    return {
        "year": 2023,
        "circuit": "Bahrain",
        "session": "Race",
        "fastest_driver": fastest["Driver"],
        "fastest_time": str(fastest["LapTime"]),
    }


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


def pd_isna(v):
    try:
        import pandas as pd
        return bool(pd.isna(v))
    except Exception:
        return False


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
    hit = cache_get(key)
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
    cache_set(key, result)
    return result


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

# How many points to send for the static track outline.
TRACK_OUTLINE_POINTS = 500
# Signal processing lives in its own module — pure numpy, no I/O, testable.
from services.telemetry_math import (  # noqa: E402
    RACING_LINE_POINTS,  # noqa: F401  (re-exported for callers/tests)
    racing_line,
    long_g,
    sector_ends,
    drs_zones,
    brake_zones,
)


def _trim(payload):
    """
    Drop pointless float precision before caching / sending.

    Coordinates are in tenths of a metre and the whole lap renders into a few
    hundred screen pixels, so 1dp is far below anything visible — but it cuts
    the JSON roughly in half (485 KB -> 331 KB raw, 133 KB -> 55 KB gzipped).
    """
    for p in payload.get("telemetry", []):
        p["x"] = round(p["x"], 1)
        p["y"] = round(p["y"], 1)
        p["distance"] = round(p["distance"], 1)
        p["time"] = round(p["time"], 3)
        p["speed"] = round(p["speed"], 1)
        p["throttle"] = round(p["throttle"], 1)
        p["brake"] = round(p["brake"], 2)
        if "g" in p:
            p["g"] = round(p["g"], 2)
    for p in payload.get("track_points", []):
        p["X"] = round(p["X"], 1)
        p["Y"] = round(p["Y"], 1)
        p["D"] = round(p["D"], 1)
        if "S" in p:
            p["S"] = round(p["S"], 1)
        if "T" in p:
            p["T"] = round(p["T"], 1)
        if "A" in p:
            p["A"] = round(p["A"], 2)
    return payload


def get_session_drivers(year: int, race_round: int, session_type: str):
    """
    Everyone who set a lap in this session, ordered by their fastest one.

    This is the picker for head-to-head: code, team, team colour and the gap to
    the session-best, so the UI can show a real timing-sheet ordering rather
    than an arbitrary driver list.
    """
    key = f"drivers:{CACHE_SCHEMA}:{year}:{race_round}:{session_type}"
    hit = cache_get(key)
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
    cache_set(key, result)
    return result


def get_track_data(year: int, race_round: int, session_type: str):
    """
    Track layout (smooth X/Y line) from the fastest lap, plus the official
    rotation and sector-boundary distances so the frontend can colour it.
    """
    key = f"track:{CACHE_SCHEMA}:{year}:{race_round}:{session_type}"
    hit = cache_get(key)
    if hit is not None:
        print(f"[CACHE HIT] {key}")
        return hit

    print(f"[INFO] Fetching Track Data for {year} Round {race_round} ({session_type})...")

    session = load_session(year, race_round, session_type)

    fastest_lap = session.laps.pick_fastest()
    if fastest_lap is None or (hasattr(fastest_lap, "empty") and fastest_lap.empty):
        return {"error": "No fastest lap available for this session"}

    telemetry = fastest_lap.get_telemetry()
    t_raw = telemetry["Time"].dt.total_seconds().to_numpy()
    d_raw = telemetry["Distance"].to_numpy().astype(float)
    total_distance = float(d_raw.max())

    # Smooth arc-length line, downsampled for the SVG path. Arc length and
    # FastF1 Distance agree to within ~0.3% over a lap, so each point's "D" is
    # just its arc-length fraction scaled to the real lap distance - enough for
    # the frontend to split the path into sectors.
    s_grid, x_grid, y_grid, chans, line_len = racing_line(telemetry)

    # Longitudinal g, resampled onto the same arc-length grid as everything else.
    g_dist, g_vals = long_g(telemetry)
    g_at_point = np.interp(chans["D"], g_dist, g_vals)
    peak_decel_g = float(max(0.0, -g_at_point.min()))

    step = max(1, len(s_grid) // TRACK_OUTLINE_POINTS)
    idx = list(range(0, len(s_grid), step))
    if idx[-1] != len(s_grid) - 1:
        idx.append(len(s_grid) - 1)      # close the lap exactly
    track_data = [
        {
            "X": float(x_grid[i]),
            "Y": float(y_grid[i]),
            "D": float(chans["D"][i]),
            "S": float(chans["S"][i]),        # km/h at this point on the line
            "T": float(chans["T"][i]),        # throttle % at this point
            "A": float(g_at_point[i]),        # longitudinal g (+ accel, - braking)
        }
        for i in idx
    ]

    sector1_end, sector2_end = sector_ends(fastest_lap, t_raw, d_raw, total_distance)
    drs = drs_zones(telemetry)
    brakes = brake_zones(telemetry)

    rotation = 0
    corners = []
    try:
        circuit_info = session.get_circuit_info()
        if circuit_info is not None:
            rotation = circuit_info.rotation
            for c in circuit_info.corners.itertuples():
                corners.append({
                    "X": float(c.X),
                    "Y": float(c.Y),
                    "n": int(c.Number),
                    "letter": str(getattr(c, "Letter", "") or ""),
                    "D": float(c.Distance),
                })
    except Exception as e:
        print(f"[WARN] Circuit Info not valid for this track: {e}")

    result = _trim({
        "race": session.name,
        "circuit": session.event.Location,
        "rotation": rotation,
        "track_points": track_data,
        "total_distance": total_distance,
        "sector1_end": sector1_end,
        "sector2_end": sector2_end,
        "drs_zones": drs,
        "brake_zones": brakes,
        "peak_decel_g": peak_decel_g,
        "corners": corners,
    })
    cache_set(key, result)
    return result


# Playback sample rate. 30 Hz + the frontend's frame-to-frame interpolation is
# smoother than the eye can resolve.
PLAYBACK_FPS = 30


def get_lap_telemetry(year: int, round_num: int, session_type: str, driver_id: str):
    """
    Detailed telemetry for a driver's fastest lap, resampled onto a uniform
    30 Hz timeline. Position (x, y) comes from a smoothed arc-length racing line
    driven by the clean Distance channel - see `racing_line` for why.
    """
    key = f"tel:{CACHE_SCHEMA}:{year}:{round_num}:{session_type}:{str(driver_id).lower()}"
    hit = cache_get(key)
    if hit is not None:
        print(f"[CACHE HIT] {key}")
        return hit

    print(f"[INFO] Fetching Telemetry for Driver {driver_id}...")
    session = load_session(year, round_num, session_type)

    # "fastest" = whoever set the quickest lap of the session. Don't hard-code a
    # driver number: the fastest driver changes by season and by session.
    if str(driver_id).lower() == "fastest":
        fastest = session.laps.pick_fastest()
        if fastest is None or (hasattr(fastest, "empty") and fastest.empty):
            return {"error": "No laps in this session"}
        driver_id = str(fastest["DriverNumber"])
    else:
        laps = session.laps.pick_drivers(driver_id)
        if laps.empty:
            return {"error": "Driver not found"}
        fastest = laps.pick_fastest()

    if fastest is None or fastest["LapTime"] is None or np.isnan(fastest["LapTime"].total_seconds()):
        return {"error": "No valid fastest lap for this driver"}

    try:
        info = session.get_driver(driver_id)
        driver_code = str(info["Abbreviation"])
        driver_name = str(info["FullName"])
        team_name = str(info["TeamName"])
        colour = str(info["TeamColor"] or "").strip().lstrip("#")
        team_color = f"#{colour}" if colour else "#9E9E9E"
    except Exception:
        driver_code, driver_name, team_name = str(driver_id), str(driver_id), ""
        team_color = "#9E9E9E"

    tel = fastest.get_telemetry()
    lap_time = fastest["LapTime"].total_seconds()
    # np.arange stops BEFORE the endpoint, so the last frame landed up to one
    # frame (33ms) short of the real lap time — by a different amount for every
    # driver, since it depends where lap_time falls between samples. That made
    # the replay finish early and, worse, made a head-to-head delta wrong at the
    # flag by the difference between the two shortfalls. Pin the final instant.
    timeline = np.arange(0, lap_time, 1.0 / PLAYBACK_FPS)
    if timeline[-1] < lap_time:
        timeline = np.r_[timeline, lap_time]

    t_raw = tel["Time"].dt.total_seconds().to_numpy()
    d_raw = tel["Distance"].to_numpy().astype(float)
    total_distance = float(d_raw.max())

    # --- POSITION: smooth line, arc-length parameterised, driven by Distance ---
    s_grid, x_grid, y_grid, _chans, line_len = racing_line(tel)
    dist_t = np.interp(timeline, t_raw, d_raw)                       # clean, monotone
    # Pro-rata, deliberately. Inverting the exact distance->arc relation is more
    # accurate on paper but reintroduces the old stutter: the raw X/Y stream is
    # noisy, so LOCAL arc length is not a faithful proxy for travel (distance
    # advances 0.006m to 5.7m per uniform arc step). Inverting that noise gave
    # implied speeds of 3686 km/h and dropped speed correlation from 0.994 to
    # 0.31 — measured. Smoothing the correction first was also tested and barely
    # helped (32.3m -> 27.0m of error while making motion worse).
    #
    # The cost of pro-rata is that the car sits up to ~33m (0.6% of a lap) along
    # the track from its true distance. That is a few pixels on the map, and it
    # does NOT affect the graphs — those are plotted against each point's real
    # Distance ("D"), so the traces stay aligned with the zone markers.
    s_t = np.clip((dist_t - d_raw[0]) / (d_raw[-1] - d_raw[0]), 0, 1) * line_len
    x_interp = np.interp(s_t, s_grid, x_grid)
    y_interp = np.interp(s_t, s_grid, y_grid)

    # --- Other channels: plain time interpolation is fine (dense car data) ---
    speed_interp = np.interp(timeline, t_raw, tel["Speed"].to_numpy())
    gear_interp = np.interp(timeline, t_raw, tel["nGear"].to_numpy())
    rpm_interp = np.interp(timeline, t_raw, tel["RPM"].to_numpy())
    drs_interp = np.interp(timeline, t_raw, tel["DRS"].to_numpy())
    throttle_interp = np.interp(timeline, t_raw, tel["Throttle"].to_numpy())
    brake_interp = np.interp(timeline, t_raw, tel["Brake"].astype(float).to_numpy())

    # Real braking magnitude. "brake" above is FastF1's boolean — driving the HUD
    # bar from it pins the meter at 100% for the whole zone, which no driver does.
    # Deceleration is the measured quantity, so the bar can show the pressure
    # actually being bled off through the corner.
    g_dist, g_vals = long_g(tel)
    g_interp = np.interp(dist_t, g_dist, g_vals)
    peak_decel_g = float(max(0.0, -g_interp.min()))

    data = [
        {
            "time": float(timeline[i]),
            "x": float(x_interp[i]),
            "y": float(y_interp[i]),
            "speed": float(speed_interp[i]),
            "gear": int(round(gear_interp[i])),
            "rpm": int(round(rpm_interp[i])),
            "drs": int(round(drs_interp[i])),
            "throttle": float(throttle_interp[i]),
            "brake": float(brake_interp[i]),
            "g": float(g_interp[i]),
            "distance": float(dist_t[i]),
        }
        for i in range(len(timeline))
    ]

    print(f"[OK] Resampled Telemetry: {len(data)} points @ {PLAYBACK_FPS}Hz "
          f"(Duration: {data[-1]['time']:.2f}s / Official: {lap_time:.2f}s)")

    def _sector_seconds(key):
        val = fastest[key]
        return val.total_seconds() if val is not None and not np.isnan(val.total_seconds()) else None

    final_sector_times = {
        "s1": _sector_seconds("Sector1Time"),
        "s2": _sector_seconds("Sector2Time"),
        "s3": _sector_seconds("Sector3Time"),
    }
    sector1_end, sector2_end = sector_ends(fastest, t_raw, d_raw, total_distance)

    if (final_sector_times["s1"] and final_sector_times["s2"]
            and not final_sector_times["s3"]):
        final_sector_times["s3"] = (
            lap_time - final_sector_times["s1"] - final_sector_times["s2"]
        )

    result = _trim({
        "driver": driver_id,
        "team_color": team_color,
        "peak_decel_g": peak_decel_g,
        "driver_code": driver_code,
        "driver_name": driver_name,
        "team": team_name,
        "lap_number": int(fastest["LapNumber"]) if not np.isnan(fastest["LapNumber"]) else None,
        "lap_time": str(fastest["LapTime"]),
        "lap_seconds": float(fastest["LapTime"].total_seconds()),
        "telemetry": data,
        "sector_boundaries": {
            "sector1_end": sector1_end,
            "sector2_end": sector2_end,
            "total_distance": total_distance,
        },
        "sector_times": final_sector_times,
    })
    cache_set(key, result)
    return result
