"""
📄 telemetry_math.py — the signal processing behind the replay.

Pure numpy: arrays in, arrays out. No FastF1 session loading, no cache, no HTTP.
That is the point — this is the part of the backend whose correctness actually
matters (a wrong racing line makes the car stutter, a wrong deceleration makes
the brake trace lie), and keeping it free of I/O is what makes it testable with
plain arrays.

Callers pass a FastF1 telemetry frame, which is used only as a source of named
columns (X, Y, Speed, Throttle, Distance, Time, Brake, DRS).
"""
import numpy as np


# How many points the smooth racing line is built from internally.
RACING_LINE_POINTS = 4000


def racing_line(tel, smooth_window: int = 3):
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


def long_g(tel, smooth_window: int = 5):
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


def sector_ends(fastest_lap, t_raw, d_raw, total_distance):
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


def drs_zones(tel, min_length_m: float = 120.0):
    """
    Distance ranges where DRS was open on this lap.

    FastF1 DRS codes: 0/1 = closed, 8 = eligible (past detection),
    10/12/14 = open. We merge contiguous "open" samples and drop blips.
    """
    return _mask_to_zones(tel["DRS"].to_numpy() >= 10, tel, min_length_m)


def brake_zones(tel, min_length_m: float = 25.0):
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
