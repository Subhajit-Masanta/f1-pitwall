"""
📄 pit_geometry.py — where the pit lane is, and how to make it visible.

Pure numpy. No FastF1, no I/O, so every awkward case here is unit-testable.

FastF1 ships no pit-lane geometry, and the track outline we draw comes from a
fastest lap, which never enters the pits. So the lane is DERIVED from the
position traces of cars that actually pitted.

THE PROBLEM THAT SHAPES THIS MODULE. Measured across Bahrain, Monaco and
Austria, a pit lane sits only 15–33 m from the racing line. A 5.4 km lap is
drawn into roughly 700 px, so 1 px ≈ 8–10 m: an accurate pit lane lands 2–4 px
from the track and reads as a doubled line, not as a pit lane. So the offset is
amplified — real shape, real entry and exit, stylised gap.

The amplification is keyed on DISTANCE FROM THE TRACK, not on position along
the lane. That is what keeps the ends welded on: where the pit path converges
with the racing line (pit entry, pit exit) the offset is near zero, so the
multiplier is near 1 and those points barely move. No separate taper needed,
and it works for any point rather than only for points on the path — which
matters, because the same function has to move the CARS.
"""
import numpy as np

# How much further from the track the pit lane is drawn than it really is.
PIT_AMPLIFY = 4.0

# A stop longer than this was not a pit stop. Under a red flag every car is
# sent to the pit lane and parked nose-to-tail for many minutes; those traces
# have a completely different shape and would drag the averaged path toward
# wherever cars happened to queue. Measured: real stops run 15.9–51.1 s, while
# Australia 2023's red flags ran 602 s, 941 s and 1369 s. Nothing sits between.
MAX_STOP_S = 90.0

# Below this many usable stops there is not enough data to average a path, and
# the pit ENTRY/EXIT are unknown too (they are where the derived path meets the
# racing line). Draw nothing rather than invent geometry — see docs/phase-d.
MIN_STOPS_FOR_LANE = 5

# Points in the emitted pit-lane polyline.
PIT_LANE_POINTS = 90


def nearest_on_line(px, py, line):
    """
    For each (px, py), the nearest point on `line` and the distance to it.

    `line` is an (N, 2) array of track coordinates. Brute force over a
    downsampled line: N is a few hundred and this runs once per payload build,
    not per frame.

    Returns (qx, qy, dist).
    """
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    # (points, linepoints) distance matrix, chunked so a long race does not
    # allocate a multi-gigabyte intermediate.
    qx = np.empty(px.shape, dtype=float)
    qy = np.empty(px.shape, dtype=float)
    dist = np.empty(px.shape, dtype=float)
    CHUNK = 4096
    for s in range(0, len(px), CHUNK):
        e = min(s + CHUNK, len(px))
        dx = px[s:e, None] - line[None, :, 0]
        dy = py[s:e, None] - line[None, :, 1]
        d2 = dx * dx + dy * dy
        j = np.argmin(d2, axis=1)
        qx[s:e] = line[j, 0]
        qy[s:e] = line[j, 1]
        dist[s:e] = np.sqrt(d2[np.arange(e - s), j])
    return qx, qy, dist


def amplify_offset(px, py, line, d_ref, amp=PIT_AMPLIFY):
    """
    Push points away from the racing line so the pit lane is visible.

    P' = Q + (P - Q) * k(d),  where Q is the nearest point on the racing line,
    d = |P - Q|, and

        k(d) = 1 + (amp - 1) * min(d / d_ref, 1)

    k(0) == 1, so a point ON the racing line maps to itself and pit entry/exit
    stay attached. k saturates at `amp` once a point is a full pit-lane width
    away, so the lane keeps a constant exaggeration along its length instead of
    fanning out.

    `d_ref` is the reference offset — the median distance of the real pit path
    from the racing line — so the ramp is calibrated per circuit rather than in
    absolute metres.

    THIS IS THE SHARED TRANSFORM. It is applied to the lane polyline AND to the
    position of any car inside a pit window. Applying it to one and not the
    other is the single thing that would make this look broken: the lane would
    sit beside the track while the car drove down the middle of it.
    """
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    if len(px) == 0:
        return px, py
    qx, qy, d = nearest_on_line(px, py, line)
    ref = max(float(d_ref), 1e-6)
    k = 1.0 + (amp - 1.0) * np.minimum(d / ref, 1.0)
    return qx + (px - qx) * k, qy + (py - qy) * k


def resample_path(px, py, n):
    """
    Resample a polyline onto `n` points evenly spaced by ARC LENGTH.

    Arc length, not time: a car standing still in its pit box contributes no
    distance, so a 4-second stop does not swallow half the samples the way a
    time-based resample would.
    """
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    if len(px) < 2:
        return None
    seg = np.hypot(np.diff(px), np.diff(py))
    s = np.concatenate([[0.0], np.cumsum(seg)])
    if s[-1] <= 0:
        return None
    u = s / s[-1]
    g = np.linspace(0.0, 1.0, n)
    return np.column_stack([np.interp(g, u, px), np.interp(g, u, py)])


def despike(path, max_turn_deg=110.0, rounds=3):
    """
    Drop the points where a derived path doubles back on itself.

    A point-wise median across traces is not guaranteed to be monotone along
    the route: wherever the traces disagree about where the lane goes — around
    the boxes especially, since every team's is somewhere else — the median can
    land behind the previous point. Measured on Australia 2023 the worst such
    corner turned 176 degrees, a full reversal, which draws as a spike.

    Smoothing alone will not remove one; an average over a reversal leaves a
    dent. So the offending points are removed first and the resample closes the
    gap. Endpoints are never dropped: they are what welds the lane to the
    circuit.
    """
    p = np.asarray(path, dtype=float)
    for _ in range(int(rounds)):
        if len(p) < 4:
            break
        seg = np.diff(p, axis=0)
        ang = np.degrees(np.arctan2(seg[:, 1], seg[:, 0]))
        turn = np.abs((np.diff(ang) + 180.0) % 360.0 - 180.0)
        bad = np.where(turn > max_turn_deg)[0] + 1        # interior indices
        if not len(bad):
            break
        keep = np.ones(len(p), dtype=bool)
        keep[bad] = False
        keep[0] = keep[-1] = True
        if keep.all():
            break
        p = p[keep]
    return p


def smooth_path(path, window=5, iters=2):
    """
    Moving average along the path, with both ends held exactly in place.

    The ends are the whole reason for holding them: `anchor_ends` has put them
    on the racing line so the lane branches off the circuit, and letting a
    smoothing pass drift them by a few metres detaches it again.

    The padding repeats the endpoints rather than reflecting, which keeps the
    average near the ends close to where it started, so pinning them afterwards
    does not leave a kink.
    """
    p = np.asarray(path, dtype=float)
    k = int(window) // 2
    if len(p) < 3 or k < 1:
        return p.copy()
    first, last = p[0].copy(), p[-1].copy()
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    for _ in range(int(iters)):
        pad = np.vstack([np.repeat(p[:1], k, axis=0), p, np.repeat(p[-1:], k, axis=0)])
        p = np.column_stack([np.convolve(pad[:, 0], ker, mode="valid"),
                             np.convolve(pad[:, 1], ker, mode="valid")])
    p[0], p[-1] = first, last
    return p


def median_path(traces, n=PIT_LANE_POINTS):
    """
    One representative path from many traces of the same route.

    MEDIAN, not mean. Every team's pit box sits at a different point along the
    lane, so resampled traces do not align through the middle — measured spread
    about the mean was 8 m at the median but 30 m at p90 and 122 m at worst. A
    mean is dragged toward whichever teams pitted most often; a median is not.
    """
    res = [r for r in (resample_path(t[:, 0], t[:, 1], n) for t in traces) if r is not None]
    if not res:
        return None
    stack = np.array(res)                      # (traces, n, 2)
    return np.median(stack, axis=0)


def usable_stops(stops, status_spans=None, max_stop_s=MAX_STOP_S):
    """
    Drop the pit windows that are not pit stops.

    Two filters, deliberately overlapping:
      · duration — a genuine stop is 16–51 s; red-flag windows are 600–1400 s
      · red-flag overlap — the authoritative reason, from track_status code 5

    The duration filter alone is sufficient (nothing real is near 90 s), but
    the status spans are already parsed for the race banner, so cross-checking
    costs nothing and covers a session whose timing is odd for another reason.

    `stops` is a list of dicts with `in_s` and `out_s`.
    `status_spans` is a list of dicts with `code`, `start`, `end`.
    """
    reds = [(s["start"], s["end"]) for s in (status_spans or []) if str(s.get("code")) == "5"]
    out = []
    for st in stops:
        dur = st["out_s"] - st["in_s"]
        if not (0 < dur <= max_stop_s):
            continue
        if any(st["in_s"] < re_ and st["out_s"] > rs for rs, re_ in reds):
            continue
        out.append(st)
    return out


def stationary_box(px, py, t, speed_thresh=30.0):
    """
    Where a car stood still inside a pit window — the pit box.

    `speed_thresh` is in FastF1 position units per second (~0.1 m), so 30 is
    about 3 m/s: slower than a car ever moves down a pit lane under power.

    Returns (x, y, seconds_stationary) or None.
    """
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    t = np.asarray(t, dtype=float)
    if len(px) < 3:
        return None
    dt = np.maximum(np.diff(t), 1e-6)
    v = np.hypot(np.diff(px), np.diff(py)) / dt
    slow = np.where(v < speed_thresh)[0]
    if len(slow) < 2:
        return None
    # `slow` indexes the DIFFS, so the samples actually involved are i and i+1
    # for each slow step. Averaging px[slow] alone drops the final sample of
    # the stop and biases the box toward where the car entered it.
    idx = np.unique(np.concatenate([slow, slow + 1]))
    return float(px[idx].mean()), float(py[idx].mean()), float(t[idx[-1]] - t[idx[0]])


def anchor_ends(path, line, ramp=6, q0=None, q1=None):
    """
    Extend a derived path so both ends sit EXACTLY on the racing line.

    The taper in `amplify_offset` keys on distance from the track, so it only
    welds the lane on if the path actually reaches the track. A derived pit
    path does not: `PitInTime` fires as the car crosses the pit entry line,
    already in the lane. Padding the capture window helps but cannot be relied
    on — how much on-track running 4 seconds buys depends entirely on whether
    the car was at racing speed or crawling behind a safety car, so the traces
    misalign and the median at the ends lands somewhere in between. Measured
    with padding alone: one end welded at 22 m, the other still 50 m out.

    So the ends are anchored deterministically. A short ramp runs from the
    nearest racing-line point into the first captured point (and out of the
    last), giving offsets that fall smoothly to zero. `amplify_offset` then
    leaves those points where they are and the lane branches off the circuit
    instead of floating beside it.
    """
    path = np.asarray(path, dtype=float)
    if path is None or len(path) < 2:
        return path
    # `q0` / `q1` let the caller supply anchor points from the SEQUENTIAL match.
    # Falling back to a global nearest here reproduced the Monaco failure one
    # level up: the exit ramp was anchored to the wrong side of the circuit and
    # the drawn lane's tail ended up 137 m from the track.
    if q0 is None:
        gx, gy, _ = nearest_on_line([path[0, 0]], [path[0, 1]], line)
        q0 = (gx[0], gy[0])
    if q1 is None:
        gx, gy, _ = nearest_on_line([path[-1, 0]], [path[-1, 1]], line)
        q1 = (gx[0], gy[0])

    # A ramp shorter than the path's own point spacing is not a ramp, it is a
    # hook: measured at Bahrain the entry anchor landed 0.29 m from the first
    # captured point and slightly behind it, so the lane opened with a 176
    # degree reversal — invisible as a polyline, a little curl once the same
    # points are drawn as a curve. There is nothing to weld at that distance,
    # so the end is simply moved onto the line instead.
    body = np.array(path, dtype=float, copy=True)
    seg = np.hypot(np.diff(body[:, 0]), np.diff(body[:, 1]))
    eps = 0.25 * float(np.median(seg)) if len(seg) else 0.0

    parts = []
    if np.hypot(q0[0] - body[0, 0], q0[1] - body[0, 1]) > eps:
        parts.append(np.column_stack([
            np.linspace(q0[0], body[0, 0], ramp + 1)[:-1],
            np.linspace(q0[1], body[0, 1], ramp + 1)[:-1],
        ]))
    else:
        body[0] = q0
    parts.append(body)
    if np.hypot(q1[0] - body[-1, 0], q1[1] - body[-1, 1]) > eps:
        parts.append(np.column_stack([
            np.linspace(body[-1, 0], q1[0], ramp + 1)[1:],
            np.linspace(body[-1, 1], q1[1], ramp + 1)[1:],
        ]))
    else:
        body[-1] = q1
    return np.vstack(parts)


def approach_anchor(line, j, p0, p1, back=80):
    """
    A point on the racing line that the pit lane can be welded to WITHOUT the
    weld folding back on itself.

    The obvious anchor is the foot of the perpendicular — the racing-line point
    nearest where the lane begins. It is the wrong one. A pit lane peels away
    from the circuit gradually, so its first captured point is usually a little
    upstream of its own perpendicular foot: measured at Bahrain the foot sat
    2.5 m PAST the start of the lane, so the ramp ran backwards into it and the
    drawn lane opened with a 179 degree fold.

    A car joins the lane from behind, so the anchor has to be behind too. This
    walks back along the line — which is ordered around the lap — until it
    finds a point that is genuinely upstream of the lane's own first step.

    `j` is the matched index, `p0` and `p1` the first two points of the path
    (reversed, for the exit end: pass the last two).
    """
    line = np.asarray(line, dtype=float)
    p0 = np.asarray(p0, dtype=float)
    d = np.asarray(p1, dtype=float) - p0
    n = len(line)
    for k in range(0, int(back) + 1):
        q = line[(j - k) % n]
        if float(np.dot(p0 - q, d)) > 0:
            return (float(q[0]), float(q[1]))
    return (float(line[j % n, 0]), float(line[j % n, 1]))


def sequential_nearest(px, py, line, window=60, wrap=True):
    """
    Nearest index on `line` for each point of an ORDERED path, constrained to
    move only locally along the line from the previous match.

    A global nearest-point search breaks wherever a circuit passes close to
    itself. Monaco is the case that exposed it: the pit lane runs alongside the
    main straight, but samples there were matching to the tunnel exit or
    Rascasse instead, so the offset vector pointed across the circuit and
    amplifying it dragged the lane INTO the track. Measured: the drawn lane
    came out at 0.64x the real offset — nearer than reality, the opposite of
    the intent — while Bahrain and Australia were a correct ~4x.

    Because a pit path is ordered, the matching index can only progress a
    little between consecutive samples. Searching a window around the previous
    match enforces that.

    `wrap` is what the line IS: a circuit is a loop, so the window runs through
    the start/finish line, but a pit lane is an open route from entry to exit
    and wrapping there would let a car at the exit match the entry.
    """
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    n = len(line)
    out = np.empty(len(px), dtype=int)
    d2 = (px[0] - line[:, 0]) ** 2 + (py[0] - line[:, 1]) ** 2
    prev = int(np.argmin(d2))
    out[0] = prev
    for k in range(1, len(px)):
        if wrap:
            idx = np.arange(prev - window, prev + window + 1) % n
        else:
            idx = np.arange(max(0, prev - window), min(n, prev + window + 1))
        d2 = (px[k] - line[idx, 0]) ** 2 + (py[k] - line[idx, 1]) ** 2
        prev = int(idx[int(np.argmin(d2))])
        out[k] = prev
    return out


def project_index(px, py, path, window=40):
    """
    Where along `path` each point of an ORDERED trace sits, as a FRACTIONAL
    index: 12.4 means four tenths of the way from point 12 to point 13.

    The fraction is the whole point. A nearest-VERTEX answer is a staircase,
    and anything derived from it jumps by a whole step at a time — which is
    exactly how a car ended up moving 130 m sideways in a single frame.
    """
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    path = np.asarray(path, dtype=float)
    n = len(path)
    if n < 2 or len(px) == 0:
        return np.zeros(len(px))
    j = sequential_nearest(px, py, path, window=window, wrap=False)
    # The nearest vertex belongs to two segments; the point projects onto one
    # of them. Try both and keep the closer.
    best_u = np.full(len(px), np.nan)
    best_d = np.full(len(px), np.inf)
    for off in (-1, 0):
        a = np.clip(j + off, 0, n - 2)
        ax, ay = path[a, 0], path[a, 1]
        dx, dy = path[a + 1, 0] - ax, path[a + 1, 1] - ay
        den = dx * dx + dy * dy
        den = np.where(den <= 0, 1e-9, den)
        t = np.clip(((px - ax) * dx + (py - ay) * dy) / den, 0.0, 1.0)
        d2 = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2
        take = d2 < best_d
        best_d = np.where(take, d2, best_d)
        best_u = np.where(take, a + t, best_u)
    return best_u


def amplify_path(path, line, d_ref, amp=PIT_AMPLIFY, window=60):
    """
    `amplify_offset` for an ordered path, using the sequential match.

    Returns the amplified path. Use this for the lane polyline; use
    `displace_like` to move cars onto it so the two can never disagree.
    """
    path = np.asarray(path, dtype=float)
    if len(path) == 0:
        return path
    j = sequential_nearest(path[:, 0], path[:, 1], line, window)
    qx, qy = line[j, 0], line[j, 1]
    d = np.hypot(path[:, 0] - qx, path[:, 1] - qy)
    ref = max(float(d_ref), 1e-6)
    k = 1.0 + (amp - 1.0) * np.minimum(d / ref, 1.0)
    return np.column_stack([qx + (path[:, 0] - qx) * k, qy + (path[:, 1] - qy) * k])


def displace_like(px, py, raw_path, amp_path, window=40):
    """
    Move an ordered trace by whatever the lane itself was moved, right there.

    This is how CARS get onto the drawn lane. Re-deriving the transform for a
    car's own position would repeat the global-nearest problem above, and any
    disagreement between the two calculations shows up as the car driving
    beside the lane instead of down it. Reusing the lane's own displacement
    makes that impossible: a car sitting on the real lane lands on the drawn
    lane by construction.

    THE DISPLACEMENT IS INTERPOLATED, not looked up. Taking the nearest
    vertex's offset makes the field a staircase, so a car crossing from one
    vertex's territory to the next steps sideways by the difference between
    them — measured at up to 130 m in a single frame, which reads as the car
    teleporting across the pit lane. Blending between the two ends of the
    segment the car is actually on makes the field continuous, so the car
    moves as smoothly as its own telemetry does.

    `px`/`py` must be ONE ordered pass through the lane. Two separate stops
    concatenated would ask the sequential match to jump from the exit back to
    the entry; call this once per pit window.
    """
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    if len(px) == 0 or raw_path is None or len(raw_path) < 2:
        return px, py
    raw = np.asarray(raw_path, dtype=float)
    amp = np.asarray(amp_path, dtype=float)
    d = amp - raw
    u = project_index(px, py, raw, window=window)
    i = np.clip(u.astype(int), 0, len(raw) - 2)
    f = (u - i)[:, None]
    delta = d[i] * (1.0 - f) + d[i + 1] * f
    return px + delta[:, 0], py + delta[:, 1]
