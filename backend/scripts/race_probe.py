"""
Phase D preparation: measure what a full-race payload actually costs, and
enumerate every event channel we intend to show (SC / VSC / red flag / tyres /
pits / weather), from real data rather than from assumption.

Run from backend/:  .venv/Scripts/python.exe <this> <year> <round>
"""
import gzip
import json
import sys
import os

sys.path.insert(0, os.getcwd())

import numpy as np
import fastf1

fastf1.Cache.enable_cache("cache")

YEAR = int(sys.argv[1]) if len(sys.argv) > 1 else 2023
RND = int(sys.argv[2]) if len(sys.argv) > 2 else 3

s = fastf1.get_session(YEAR, RND, "R")
s.load(telemetry=True, weather=True, messages=True)
print(f"\n=== {s.event.EventName} {YEAR} — RACE ===", flush=True)

report = {"event": str(s.event.EventName), "year": YEAR, "round": RND}

# --------------------------------------------------------------------------
# 1. POSITION PAYLOAD SIZE — the constraint that decides the design
# --------------------------------------------------------------------------
laps = s.laps
drivers = sorted(laps["DriverNumber"].unique().tolist())
t0 = laps["LapStartTime"].min().total_seconds()
tEnd = (laps["Time"].max()).total_seconds()
duration = tEnd - t0
print(f"drivers={len(drivers)}  duration={duration/60:.1f} min", flush=True)
report["drivers"] = len(drivers)
report["duration_s"] = round(duration, 1)

sizes = {}
for hz in (1, 2, 4):
    grid = np.arange(t0, tEnd, 1.0 / hz)
    cars = {}
    for num in drivers:
        try:
            pos = s.pos_data[num]
        except KeyError:
            continue
        pt = pos["SessionTime"].dt.total_seconds().to_numpy()
        px = pos["X"].to_numpy().astype(float)
        py = pos["Y"].to_numpy().astype(float)
        st = pos["Status"].to_numpy()
        on = np.where(st == "OnTrack", 1, 0)
        cars[num] = {
            "x": [round(float(v), 1) for v in np.interp(grid, pt, px)],
            "y": [round(float(v), 1) for v in np.interp(grid, pt, py)],
            "on": [int(round(float(v))) for v in np.interp(grid, pt, on)],
        }
    blob = json.dumps({"t0": t0, "hz": hz, "n": len(grid), "cars": cars},
                      separators=(",", ":"))
    raw = len(blob.encode())
    gz = len(gzip.compress(blob.encode(), 6))
    sizes[hz] = {"frames": int(len(grid)), "raw_mb": round(raw / 1e6, 2),
                 "gzip_mb": round(gz / 1e6, 2)}
    print(f"  {hz}Hz: {len(grid):6d} frames/car  raw {raw/1e6:6.2f} MB  "
          f"gzip {gz/1e6:5.2f} MB", flush=True)
report["position_payload"] = sizes

# --------------------------------------------------------------------------
# 2. TRACK STATUS — SC / VSC / red flag, with real durations
# --------------------------------------------------------------------------
CODES = {"1": "AllClear", "2": "Yellow", "3": "Unknown3", "4": "SafetyCar",
         "5": "RedFlag", "6": "VSC", "7": "VSC_Ending"}
ts = s.track_status.copy()
ts["sec"] = ts["Time"].dt.total_seconds()
spans = []
for i, row in enumerate(ts.itertuples()):
    end = ts["sec"].iloc[i + 1] if i + 1 < len(ts) else tEnd
    spans.append({"code": str(row.Status), "name": CODES.get(str(row.Status), "?"),
                  "msg": str(row.Message), "start_s": round(row.sec, 1),
                  "dur_s": round(end - row.sec, 1)})
report["track_status_spans"] = spans
notable = [x for x in spans if x["code"] not in ("1",)]
print(f"\ntrack status: {len(spans)} spans, {len(notable)} non-green")
for x in notable:
    print(f"  {x['name']:10s} code={x['code']}  at {x['start_s']:7.1f}s  for {x['dur_s']:6.1f}s")
report["status_codes_seen"] = sorted(set(x["code"] for x in spans))

# --------------------------------------------------------------------------
# 3. RACE CONTROL MESSAGES
# --------------------------------------------------------------------------
rc = s.race_control_messages
report["rc_categories"] = rc["Category"].value_counts().to_dict()
print("\nrace control categories:", report["rc_categories"])
cols = [c for c in rc.columns]
report["rc_columns"] = cols
print("rc columns:", cols)
for cat in ("SafetyCar", "Flag", "Drs", "CarEvent"):
    sub = rc[rc["Category"] == cat]
    if len(sub):
        print(f"  --- {cat} ({len(sub)}) ---")
        for r in sub.head(6).itertuples():
            lap = getattr(r, "Lap", None)
            print(f"    lap {lap}  {str(r.Message)[:78]}")
report["rc_flag_values"] = sorted(set(str(x) for x in rc.get("Flag", []) if str(x) != "nan"))
print("flag values:", report["rc_flag_values"])

# --------------------------------------------------------------------------
# 4. TYRES / STINTS
# --------------------------------------------------------------------------
stints = (laps.groupby(["DriverNumber", "Stint", "Compound"])
          .agg(first=("LapNumber", "min"), last=("LapNumber", "max"),
               life=("TyreLife", "max"), fresh=("FreshTyre", "first"))
          .reset_index())
report["stint_count"] = int(len(stints))
report["compounds_used"] = sorted(set(stints["Compound"].dropna().tolist()))
print(f"\nstints: {len(stints)} across {len(drivers)} drivers")
print("compounds:", report["compounds_used"])
ex = stints[stints["DriverNumber"] == drivers[0]]
print(f"example driver {drivers[0]}:")
for r in ex.itertuples():
    print(f"    stint {int(r.Stint)}  {r.Compound:6s} laps {int(r.first)}-{int(r.last)} "
          f"(life {r.life}, fresh={r.fresh})")

# --------------------------------------------------------------------------
# 5. PIT STOPS
# --------------------------------------------------------------------------
pits = laps[laps["PitInTime"].notna()][["DriverNumber", "LapNumber", "PitInTime", "PitOutTime"]]
report["pit_stop_count"] = int(len(pits))
print(f"\npit stops: {len(pits)}")

# --------------------------------------------------------------------------
# 6. WEATHER
# --------------------------------------------------------------------------
w = s.weather_data
report["weather_rows"] = int(len(w))
report["weather_cols"] = list(w.columns)
report["rained"] = bool(w["Rainfall"].any())
print(f"weather: {len(w)} rows, rain={report['rained']}, "
      f"track {w['TrackTemp'].min():.0f}-{w['TrackTemp'].max():.0f}C")

# --------------------------------------------------------------------------
# 7. LEADERBOARD — position per lap
# --------------------------------------------------------------------------
lb = laps[["LapNumber", "DriverNumber", "Position", "Time"]].dropna(subset=["Position"])
report["leaderboard_rows"] = int(len(lb))
report["total_laps"] = int(laps["LapNumber"].max())
lbblob = json.dumps([[int(r.LapNumber), str(r.DriverNumber), int(r.Position)]
                     for r in lb.itertuples()], separators=(",", ":"))
report["leaderboard_gzip_kb"] = round(len(gzip.compress(lbblob.encode(), 6)) / 1024, 1)
print(f"leaderboard: {len(lb)} rows over {report['total_laps']} laps "
      f"({report['leaderboard_gzip_kb']} KB gzip)")

dest = sys.argv[3] if len(sys.argv) > 3 else "race_probe.json"
with open(dest, "w") as f:
    json.dump(report, f, indent=2, default=str)
print(f"\nwrote {dest}")
