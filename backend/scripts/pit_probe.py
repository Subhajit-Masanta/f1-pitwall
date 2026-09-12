"""
Phase D prep: can we draw the PIT LANE on the map?

FastF1 has no pit-lane geometry. The track outline we draw comes from a fastest
lap, which by definition never enters the pits. So the question is whether the
pit lane can be DERIVED from position data captured while cars were pitting.

Run from backend/:  .venv/Scripts/python.exe scripts/pit_probe.py <year> <round>
"""
import sys
import os
import json

sys.path.insert(0, os.getcwd())

import numpy as np
import fastf1

fastf1.Cache.enable_cache("cache")

YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 2023
RND = int(sys.argv[2]) if len(sys.argv) > 2 else 1

s = fastf1.get_session(YEAR, RND, "R")
s.load(telemetry=True, weather=False, messages=False)
print(f"\n=== {s.event.EventName} {YEAR} — PIT LANE PROBE ===", flush=True)

laps = s.laps

# --- the racing line, for "how far off the track is this point?" -----------
fastest = laps.pick_fastest()
tel = fastest.get_telemetry()
lx = tel["X"].to_numpy().astype(float)
ly = tel["Y"].to_numpy().astype(float)
line = np.column_stack([lx, ly])
# downsample the line for a cheap nearest-point test
step = max(1, len(line) // 1200)
line_s = line[::step]


def dist_to_line(px, py):
    """Nearest distance from each (px,py) to the racing line, in FastF1 units."""
    out = np.empty(len(px))
    for i in range(len(px)):
        d = np.hypot(line_s[:, 0] - px[i], line_s[:, 1] - py[i])
        out[i] = d.min()
    return out


# --- collect position samples inside every pit window ----------------------
pit_laps = laps[laps["PitInTime"].notna() & laps["PitOutTime"].notna()]
print(f"laps with BOTH PitIn and PitOut on the same row: {len(pit_laps)}")

# A real stop is PitIn on lap N and PitOut on lap N+1, so pair them up.
stops = []
for num in sorted(laps["DriverNumber"].unique()):
    dl = laps.pick_drivers(num).sort_values("LapNumber")
    rows = list(dl.itertuples())
    for i, r in enumerate(rows):
        if r.PitInTime is None or str(r.PitInTime) == "NaT":
            continue
        nxt = rows[i + 1] if i + 1 < len(rows) else None
        if nxt is None or str(nxt.PitOutTime) == "NaT":
            continue
        stops.append({
            "driver": str(num),
            "lap": int(r.LapNumber),
            "in_s": float(r.PitInTime.total_seconds()),
            "out_s": float(nxt.PitOutTime.total_seconds()),
        })
print(f"paired pit stops (PitIn lap N -> PitOut lap N+1): {len(stops)}")
if stops:
    durs = np.array([x["out_s"] - x["in_s"] for x in stops])
    print(f"  pit-lane transit incl. stop: min {durs.min():.1f}s  "
          f"median {np.median(durs):.1f}s  max {durs.max():.1f}s")

# --- extract pit-lane geometry --------------------------------------------
allx, ally, offs = [], [], []
per_driver = {}
for st in stops:
    try:
        pos = s.pos_data[st["driver"]]
    except KeyError:
        continue
    t = pos["SessionTime"].dt.total_seconds().to_numpy()
    m = (t >= st["in_s"]) & (t <= st["out_s"])
    if m.sum() < 5:
        continue
    px = pos["X"].to_numpy().astype(float)[m]
    py = pos["Y"].to_numpy().astype(float)[m]
    d = dist_to_line(px, py)
    allx.append(px); ally.append(py); offs.append(d)
    per_driver.setdefault(st["driver"], []).append(len(px))

if not allx:
    print("NO pit position samples found — stop here.")
    sys.exit(0)

X = np.concatenate(allx); Y = np.concatenate(ally); D = np.concatenate(offs)
print(f"\npit-window position samples: {len(X)} from {len(per_driver)} drivers")
print(f"  distance from racing line: median {np.median(D):.0f}  "
      f"p90 {np.percentile(D,90):.0f}  max {D.max():.0f} (FastF1 units, ~1/10 m)")

# How much of the pit window is actually OFF the racing line?
for thr in (200, 500, 1000, 2000):
    print(f"  {100*(D>thr).mean():5.1f}% of samples are >{thr} units "
          f"(~{thr/10:.0f} m) off the racing line")

# --- where is the car stationary? that is the pit box ----------------------
print("\nstationary detection (the pit box):")
box_pts = []
for st in stops[:60]:
    try:
        pos = s.pos_data[st["driver"]]
    except KeyError:
        continue
    t = pos["SessionTime"].dt.total_seconds().to_numpy()
    m = (t >= st["in_s"]) & (t <= st["out_s"])
    if m.sum() < 8:
        continue
    px = pos["X"].to_numpy().astype(float)[m]
    py = pos["Y"].to_numpy().astype(float)[m]
    tt = t[m]
    v = np.hypot(np.diff(px), np.diff(py)) / np.maximum(np.diff(tt), 1e-6)
    slow = v < 30      # units/s — essentially stopped
    if slow.sum() >= 2:
        idx = np.where(slow)[0]
        box_pts.append((px[idx].mean(), py[idx].mean(), tt[idx[-1]] - tt[idx[0]]))
if box_pts:
    bx = np.array([p[0] for p in box_pts]); by = np.array([p[1] for p in box_pts])
    bt = np.array([p[2] for p in box_pts])
    print(f"  found stationary phases in {len(box_pts)} stops")
    print(f"  pit box centroid: X={bx.mean():.0f} +/- {bx.std():.0f}, "
          f"Y={by.mean():.0f} +/- {by.std():.0f}")
    print(f"  stationary time: median {np.median(bt):.1f}s  max {bt.max():.1f}s")
    print(f"  box spread: {np.hypot(bx.std(), by.std()):.0f} units "
          f"(~{np.hypot(bx.std(), by.std())/10:.0f} m) — the length of the pit boxes")

# --- do different drivers trace the SAME pit lane? -------------------------
print("\nconsistency across drivers (can we average one pit-lane path?):")
far = D > 500
if far.sum() > 50:
    fx, fy = X[far], Y[far]
    print(f"  off-line cloud: {len(fx)} pts, "
          f"X {fx.min():.0f}..{fx.max():.0f}, Y {fy.min():.0f}..{fy.max():.0f}")
    # width of the cloud perpendicular to its own长 axis, via PCA
    pts = np.column_stack([fx - fx.mean(), fy - fy.mean()])
    cov = np.cov(pts.T)
    evals, evecs = np.linalg.eigh(cov)
    length = 2 * np.sqrt(evals[1])
    width = 2 * np.sqrt(evals[0])
    print(f"  cloud is ~{length:.0f} long x ~{width:.0f} wide "
          f"(~{length/10:.0f} m x ~{width/10:.0f} m)")
    print("  -> a narrow cloud means every driver takes the same path "
          "and it can be averaged into ONE pit-lane polyline")

out = {
    "event": str(s.event.EventName), "year": YEAR, "round": RND,
    "stops": len(stops),
    "median_transit_s": float(np.median(durs)) if stops else None,
    "samples": int(len(X)),
    "median_off_line": float(np.median(D)),
    "pct_off_500": float((D > 500).mean() * 100),
}
with open(sys.argv[3] if len(sys.argv) > 3 else "pit_probe.json", "w") as f:
    json.dump(out, f, indent=2)
print("\ndone")
