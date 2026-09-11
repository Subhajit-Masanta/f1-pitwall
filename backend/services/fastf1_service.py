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


def get_race_sessions(year: int, race_round: int):
    """
    Get the specific sessions (FP1, FP2, Quali, Race) for a race.
    """
    print(f"[INFO] Fetching sessions for {year} Round {race_round}...")

    event = fastf1.get_event(year, race_round)

    session_names = []
    for i in range(1, 6):
        try:
            session_name = getattr(event, f"Session{i}")
            if session_name:
                session_names.append(session_name)
        except Exception:
            pass

    return {
        "race": event.EventName,
        "location": event.Location,
        "sessions": session_names,
    }


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
CACHE_SCHEMA = "v7"

# How many points to send for the static track outline.
TRACK_OUTLINE_POINTS = 500
# How many points the smooth racing line is built from internally.
RACING_LINE_POINTS = 4000


def _racing_line(tel, smooth_window: int = 3):
    """
    Build a SMOOTH racing line from a lap's telemetry, parameterised by its own
    arc length.

    Why: FastF1's raw X/Y position stream is only ~3-4 Hz and noisy. Linearly
    interpolating it onto a playback timeline makes the car lurch and freeze
    (chords between sparse fixes, GPS jitter). Re-parameterising a lightly
    smoothed line by arc length, then driving that from the (clean, monotone)
    Distance channel, gives motion whose speed tracks the real telemetry speed
    to r > 0.99.

    Returns (s_grid, x_grid, y_grid, chans, total_length) — X/Y in FastF1 units
    (tenths of a metre), s_grid evenly spaced from 0 to total_length, and
    `chans` a dict of per-point driver channels resampled onto the same grid:
    "S" speed (km/h) and "T" throttle (0-100).
    """
    x = tel["X"].to_numpy().astype(float)
    y = tel["Y"].to_numpy().astype(float)
    spd = np.nan_to_num(tel["Speed"].to_numpy().astype(float))
    thr = np.nan_to_num(tel["Throttle"].to_numpy().astype(float))
    dist = tel["Distance"].to_numpy().astype(float)

    # Drop consecutive duplicate positions (car "parked" in the raw data).
    keep = np.r_[True, (np.diff(x) != 0) | (np.diff(y) != 0)]
    x, y, spd, thr, dist = x[keep], y[keep], spd[keep], thr[keep], dist[keep]

    # Light moving-average to take the edge off GPS jitter.
    w = smooth_window
    if w >= 2 and len(x) > w * 2:
        k = np.ones(w) / w

        def _sm(a):
            pad = np.r_[np.full(w, a[0]), a, np.full(w, a[-1])]
            return np.convolve(pad, k, mode="same")[w:-w]

        x, y = _sm(x), _sm(y)

    # Arc length along the line, then resample onto a uniform grid.
    # NOTE: only X/Y are smoothed — the driver channels are carried through raw
    # so the traces show the real profile, not a blurred one.
    seg = np.hypot(np.diff(x), np.diff(y))
    arc = np.r_[0.0, np.cumsum(seg)]
    total = float(arc[-1]) or 1.0
    s_grid = np.linspace(0.0, total, RACING_LINE_POINTS)
    chans = {
        "S": np.interp(s_grid, arc, spd),
        "T": np.interp(s_grid, arc, thr),
        # TRUE lap distance at each point, not arc-length scaled pro rata.
        # The smoothed line cuts corners, so arc length and the Distance channel
        # drift apart — up to 33m over a lap (measured: Bahrain 33.1m, Monaco
        # 29.3m, Monza 22.5m). Everything else on the trace (DRS zones, brake
        # zones, sector ends) is indexed by the real Distance, so scaling arc
        # instead put those markers up to 9px away from the feature they mark.
        "D": np.interp(s_grid, arc, dist),
    }
    return (
        s_grid,
        np.interp(s_grid, arc, x),
        np.interp(s_grid, arc, y),
        chans,
        total,
    )


def _long_g(tel, smooth_window: int = 5):
    """
    Longitudinal acceleration in g, against lap distance.

    Why this exists: FastF1's Brake channel is BOOLEAN — on or off, no pressure.
    Rendering it as a bar implies the driver holds 100% brake through the whole
    zone, which is not how anyone drives an F1 car: you hit peak pressure at the
    brake point and bleed it off into the apex, or you lock the fronts.

    Deceleration is the honest magnitude, and it is measured, not invented:
    a = dv/dt straight off the speed channel. On a Bahrain pole lap that gives
    ~5.7 g at the brake point at 305 km/h decaying to ~0.5 g at a 75 km/h apex —
    the trail-braking profile, recovered from real data.

    Returns (distance_m, g_signed) with + accelerating, - braking.
    """
    t = tel["Time"].dt.total_seconds().to_numpy().astype(float)
    v = np.nan_to_num(tel["Speed"].to_numpy().astype(float)) / 3.6      # m/s
    d = tel["Distance"].to_numpy().astype(float)

    # Duplicate timestamps would make the gradient blow up.
    keep = np.r_[True, np.diff(t) > 1e-6]
    t, v, d = t[keep], v[keep], d[keep]
    if len(t) < 3:
        return d, np.zeros_like(d)

    g = np.gradient(v, t) / 9.81

    w = smooth_window
    if w >= 2 and len(g) > w * 2:
        k = np.ones(w) / w
        pad = np.r_[np.full(w, g[0]), g, np.full(w, g[-1])]
        g = np.convolve(pad, k, mode="same")[w:-w]
    return d, g


def _sector_ends(fastest_lap, t_raw, d_raw, total_distance):
    """Distance (m) at which sectors 1 and 2 end, from official split times."""
    def _sec(key):
        val = fastest_lap[key]
        if val is None or np.isnan(val.total_seconds()):
            return None
        return val.total_seconds()

    s1, s2 = _sec("Sector1Time"), _sec("Sector2Time")
    sector1_end = float(np.interp(s1, t_raw, d_raw)) if s1 else total_distance * 0.33
    sector2_end = (float(np.interp(s1 + s2, t_raw, d_raw))
                   if (s1 and s2) else total_distance * 0.66)
    return sector1_end, sector2_end


def _drs_zones(tel, min_length_m: float = 120.0):
    """
    Distance ranges where DRS was open on this lap.

    FastF1 DRS codes: 0/1 = closed, 8 = eligible (past detection),
    10/12/14 = open. We merge contiguous "open" samples and drop blips.
    """
    return _mask_to_zones(tel["DRS"].to_numpy() >= 10, tel, min_length_m)


def _brake_zones(tel, min_length_m: float = 25.0):
    """
    Distance ranges where the driver was on the brakes.

    FastF1's Brake channel is boolean (on/off, no pressure). Threshold at 0.5
    so it survives the float round-trip. The minimum length is much shorter
    than the DRS one on purpose — a quick stab of the brakes into a chicane is
    only ~30 m but it is exactly the thing worth seeing on the trace.
    """
    brake = np.nan_to_num(tel["Brake"].to_numpy().astype(float))
    return _mask_to_zones(brake > 0.5, tel, min_length_m)


def _mask_to_zones(mask, tel, min_length_m: float):
    """Merge contiguous True samples into {start, end} distance ranges."""
    dist = tel["Distance"].to_numpy().astype(float)

    zones = []
    i = 0
    n = len(mask)
    while i < n:
        if not mask[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and mask[j + 1]:
            j += 1
        if dist[j] - dist[i] >= min_length_m:
            zones.append({"start": float(dist[i]), "end": float(dist[j])})
        i = j + 1
    return zones


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

    session = fastf1.get_session(year, race_round, session_type)
    session.load()

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
    s_grid, x_grid, y_grid, chans, line_len = _racing_line(telemetry)

    # Longitudinal g, resampled onto the same arc-length grid as everything else.
    g_dist, g_vals = _long_g(telemetry)
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

    sector1_end, sector2_end = _sector_ends(fastest_lap, t_raw, d_raw, total_distance)
    drs_zones = _drs_zones(telemetry)
    brake_zones = _brake_zones(telemetry)

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
        "drs_zones": drs_zones,
        "brake_zones": brake_zones,
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
    driven by the clean Distance channel - see `_racing_line` for why.
    """
    key = f"tel:{CACHE_SCHEMA}:{year}:{round_num}:{session_type}:{str(driver_id).lower()}"
    hit = cache_get(key)
    if hit is not None:
        print(f"[CACHE HIT] {key}")
        return hit

    print(f"[INFO] Fetching Telemetry for Driver {driver_id}...")
    session = fastf1.get_session(year, round_num, session_type)
    session.load()

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
    except Exception:
        driver_code, driver_name, team_name = str(driver_id), str(driver_id), ""

    tel = fastest.get_telemetry()
    lap_time = fastest["LapTime"].total_seconds()
    timeline = np.arange(0, lap_time, 1.0 / PLAYBACK_FPS)

    t_raw = tel["Time"].dt.total_seconds().to_numpy()
    d_raw = tel["Distance"].to_numpy().astype(float)
    total_distance = float(d_raw.max())

    # --- POSITION: smooth line, arc-length parameterised, driven by Distance ---
    s_grid, x_grid, y_grid, _chans, line_len = _racing_line(tel)
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
    g_dist, g_vals = _long_g(tel)
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
    sector1_end, sector2_end = _sector_ends(fastest, t_raw, d_raw, total_distance)

    if (final_sector_times["s1"] and final_sector_times["s2"]
            and not final_sector_times["s3"]):
        final_sector_times["s3"] = (
            lap_time - final_sector_times["s1"] - final_sector_times["s2"]
        )

    result = _trim({
        "driver": driver_id,
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
