"""
📄 lap_data.py — one driver's fastest lap, resampled for playback.

The heaviest payload in the app and the one the replay actually runs on: a
uniform 30 Hz timeline with position, speed, gear, RPM, DRS, pedals and
longitudinal g at every frame, plus the official sector times.

Cache access goes through `database.cache_get` / `database.cache_set` — see the
note in session_data.py.
"""
import numpy as np

import database
from services.payload import trim
from services.session_loader import CACHE_SCHEMA, load_session
from services.telemetry_math import racing_line, long_g, sector_ends

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
    hit = database.cache_get(key)
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

    result = trim({
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
    database.cache_set(key, result)
    return result
