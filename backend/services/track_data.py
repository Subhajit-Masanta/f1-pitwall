"""
📄 track_data.py — the static track layout for a session.

One payload, sent once per session and then reused for every replay on it: the
smoothed racing line, the official rotation, sector boundaries, DRS and braking
zones, and the corner markers. Everything the map needs before a car moves.

Cache access goes through `database.cache_get` / `database.cache_set` — see the
note in session_data.py.
"""
import numpy as np

import database
from services.payload import trim
from services.session_loader import CACHE_SCHEMA, load_session
from services.telemetry_math import (
    racing_line,
    long_g,
    sector_ends,
    drs_zones,
    brake_zones,
)

# How many points to send for the static track outline.
TRACK_OUTLINE_POINTS = 500


def get_track_data(year: int, race_round: int, session_type: str):
    """
    Track layout (smooth X/Y line) from the fastest lap, plus the official
    rotation and sector-boundary distances so the frontend can colour it.
    """
    key = f"track:{CACHE_SCHEMA}:{year}:{race_round}:{session_type}"
    hit = database.cache_get(key)
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

    result = trim({
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
    database.cache_set(key, result)
    return result
