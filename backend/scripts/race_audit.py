"""
Race-mode data audit.

Every invariant the frontend relies on, checked against a real payload. Run it
on several races — a clean one, a chaotic one, and a sprint — because most of
the bugs found so far only appeared in one of those.

    .venv/Scripts/python.exe scripts/race_audit.py 2023 3 R
    .venv/Scripts/python.exe scripts/race_audit.py 2023 4 S
"""
import sys
import os
import json
import gzip

sys.path.insert(0, os.getcwd())

import numpy as np

import database
database.cache_get = lambda key: None          # always recompute
database.cache_set = lambda key, payload: None

from services.race_data import get_race_data          # noqa: E402
from services.pit_geometry import nearest_on_line     # noqa: E402

FAILS = []
WARNS = []


def check(ok, label, detail=""):
    (print(f"  [ok]   {label}") if ok
     else (FAILS.append(f"{label}: {detail}"), print(f"  [FAIL] {label}  {detail}")))


def warn(ok, label, detail=""):
    if not ok:
        WARNS.append(f"{label}: {detail}")
        print(f"  [warn] {label}  {detail}")


def audit(year, rnd, ses):
    d = get_race_data(year, rnd, ses)
    if "error" in d:
        print(f"ERROR: {d['error']}")
        return
    name = f"{d['race']} {year} [{ses}]"
    blob = json.dumps(d, separators=(",", ":"))
    gz = len(gzip.compress(blob.encode(), 6))
    print(f"\n=== {name} ===")
    print(f"  {d['frames']} frames @ {d['hz']}Hz, {d['duration']/60:.1f} min, "
          f"{len(d['cars'])} cars, {d['total_laps']} laps, {gz/1e6:.2f} MB gz")

    # ---- payload shape --------------------------------------------------
    print("\n  -- shape --")
    check(gz < 16e6, "under the MongoDB 16MB document limit", f"{gz/1e6:.2f} MB")
    check(all(len(c["x"]) == d["frames"] for c in d["cars"].values()),
          "every car has a full frame array")
    check(all(len(c["x"]) == len(c["y"]) == len(c["on"]) == len(c["pit"])
              for c in d["cars"].values()),
          "x/y/on/pit arrays are the same length")
    check(all(np.isfinite(c["x"]).all() and np.isfinite(c["y"]).all()
              for c in d["cars"].values()),
          "no NaN or Inf in any position")
    check(d["t0"] == 0.0, "times are on the race base", f"t0={d['t0']}")

    # ---- timeline -------------------------------------------------------
    print("\n  -- timeline --")
    ls = d["lap_starts"]
    check(len(ls) > 0, "lap_starts present")
    check(all(ls[i][1] <= ls[i + 1][1] for i in range(len(ls) - 1)),
          "lap_starts are monotonic in time")
    check(all(ls[i][0] < ls[i + 1][0] for i in range(len(ls) - 1)),
          "lap_starts are monotonic in lap number")
    check(ls[0][0] == 1, "lap_starts begin at lap 1", f"first={ls[0][0]}")
    check(ls[-1][0] == d["total_laps"], "lap_starts reach the final lap",
          f"last={ls[-1][0]} total={d['total_laps']}")
    check(all(0 <= t <= d["duration"] + 1 for _, t in ls),
          "every lap start is inside the replay window")

    # ---- status spans ---------------------------------------------------
    print("\n  -- status --")
    sp = d["status"]
    check(all(s["end"] >= s["start"] for s in sp), "no negative-length span")
    check(all(s["start"] >= 0 for s in sp), "no span starts before the race")
    check(all(sp[i]["end"] <= sp[i + 1]["start"] + 0.2 for i in range(len(sp) - 1)),
          "spans do not overlap")
    known = {"1", "2", "3", "4", "5", "6", "7"}
    bad = sorted({s["code"] for s in sp} - known)
    check(not bad, "all status codes are known", f"unknown={bad}")
    check(all(s["name"] != "UNKNOWN" for s in sp), "every span has a label")
    print(f"         codes present: {sorted({s['code'] for s in sp})}")

    # ---- crossings ------------------------------------------------------
    print("\n  -- timing points --")
    cr = d["crossings"]
    check(len(cr) == len(d["cars"]), "one timing series per car")
    check(all(all(v[i][0] < v[i + 1][0] for i in range(len(v) - 1)) for v in cr.values()),
          "progress is strictly increasing")
    check(all(all(v[i][1] <= v[i + 1][1] for i in range(len(v) - 1)) for v in cr.values()),
          "times are non-decreasing")
    check(all(v and v[0][0] == 0.0 for v in cr.values()),
          "every car is seeded at the race start")
    maxp = max((v[-1][0] for v in cr.values()), default=0)
    check(maxp <= d["total_laps"] + 0.01, "no progress beyond the final lap",
          f"max={maxp}")

    # ---- retirement -----------------------------------------------------
    print("\n  -- retirement --")
    for drv in d["drivers"]:
        c = d["cars"].get(drv["number"])
        if not c:
            continue
        on = np.array(c["on"])
        last_on = (np.where(on == 1)[0][-1] / d["hz"]) if on.any() else -1
        warn(abs(last_on - min(drv["out_at"] + 4, d["duration"])) < 2.0,
             f"{drv['code']} on-track window matches out_at",
             f"last_on={last_on:.0f} out_at={drv['out_at']:.0f}")
    fin = [v for v in d["drivers"] if "Finished" in v["status"] or "Lap" in v["status"]]
    check(all(v["out_at"] > d["duration"] * 0.9 for v in fin),
          "finishers stay on track to the end",
          f"{[v['code'] for v in fin if v['out_at'] <= d['duration']*0.9]}")
    # Zero is a PIT LANE START, not a missing value.
    check(all(v.get("grid") is not None and v["grid"] >= 0 for v in d["drivers"]),
          "every driver has a grid slot (0 = pit lane start)",
          f"{[v['code'] for v in d['drivers'] if v.get('grid') is None or v['grid'] < 0]}")
    grids = sorted(v["grid"] for v in d["drivers"] if v.get("grid"))
    check(len(set(grids)) == len(grids), "grid slots are unique", f"{grids}")

    # ---- pit stops ------------------------------------------------------
    print("\n  -- pit stops --")
    pits = d["pits"]
    normal = [p for p in pits if not p["red_flag"]]
    check(all(p["t"] is not None and 0 <= p["t"] <= d["duration"] for p in pits),
          "every stop is inside the replay window")
    check(all(p["window"] > 0 for p in pits), "no zero-length stop")
    if normal:
        st = [p["stopped"] for p in normal if p["stopped"] is not None]
        if st:
            warn(max(st) < 120, "no 'normal' stop is absurdly long",
                 f"max stationary {max(st)}s")
            print(f"         normal stops: {len(normal)}, stationary "
                  f"median {np.median(st):.1f}s min {min(st):.1f} max {max(st):.1f}")
    check(all(p["lap"] >= 1 for p in pits), "stop laps are valid")
    print(f"         total windows {len(pits)}, under red flag "
          f"{len(pits)-len(normal)}")

    # ---- stints ---------------------------------------------------------
    print("\n  -- tyres --")
    stints = d["stints"]
    check(len(stints) == len(d["cars"]), "one stint list per car")
    flat = [x for v in stints.values() for x in v]
    check(all(x["from"] <= x["to"] for x in flat), "stints are ordered")
    # THE invariant: a stint boundary means the tyres changed, and tyres only
    # change in the pit lane. So every boundary must line up with a pit window.
    #
    # Wear count is NOT the test. A driver can take a fresh set (life resets to
    # 1), a scrubbed set (life starts at 2-9, which is why Perez's HARD->HARD
    # reads 1 then 2), or keep the same set through a red-flag restart. Only
    # the presence of a stop separates a real change from a numbering artifact.
    pit_laps = {}
    for q in pits:
        pit_laps.setdefault(q["driver"], set()).add(q["lap"])
    orphan = []
    for k, v in stints.items():
        laps = pit_laps.get(k, set())
        for i in range(len(v) - 1):
            b = v[i]["to"]
            if not ({b - 1, b, b + 1} & laps):
                orphan.append((k, v[i]["compound"], b, v[i + 1]["compound"]))
    check(not orphan, "every stint boundary lines up with a pit stop",
          f"{orphan[:4]}")
    for k, v in stints.items():
        warn(all(v[i]["to"] + 1 == v[i + 1]["from"] for i in range(len(v) - 1)),
             f"car {k} stints are contiguous")
    print(f"         compounds: {sorted({x['compound'] for x in flat})}")

    # ---- pit lane geometry ----------------------------------------------
    print("\n  -- pit lane --")
    if d["pit_lane"]:
        tp = np.array([[p["X"], p["Y"]] for p in d["track_points"]])
        lane = np.array([[p["X"], p["Y"]] for p in d["pit_lane"]])
        _, _, off = nearest_on_line(lane[:, 0], lane[:, 1], tp)
        check(off[0] < 200 and off[-1] < 200,
              "both lane ends are welded to the circuit",
              f"ends {off[0]:.0f}/{off[-1]:.0f}")
        check(np.percentile(off, 75) > 150,
              "the lane body stands clear of the track",
              f"p75={np.percentile(off,75):.0f}")
        # cars flagged in-pit should be near the lane
        lanepts = lane
        bad = 0
        tot = 0
        for i in range(0, d["frames"], 11):
            for c in d["cars"].values():
                if not c["pit"][i]:
                    continue
                tot += 1
                dd = np.min(np.hypot(lanepts[:, 0] - c["x"][i],
                                     lanepts[:, 1] - c["y"][i]))
                if dd > 400:
                    bad += 1
        check(tot == 0 or bad / tot < 0.05,
              "cars flagged in-pit are drawn on the lane",
              f"{bad}/{tot} off it")
    else:
        print("         no pit lane derived (expected for a sprint)")
        check(d["pit_box"] is None, "no pit box either, when there is no lane")

    # ---- weather / messages ---------------------------------------------
    print("\n  -- misc --")
    w = d["weather"]
    check(all(w[i]["t"] <= w[i + 1]["t"] for i in range(len(w) - 1)),
          "weather samples are ordered")
    check(all(0 <= x["t"] <= d["duration"] + 1 for x in w),
          "weather samples are inside the window")
    check(all(-20 < x["air"] < 60 and -20 < x["track"] < 90 for x in w),
          "temperatures are physically plausible")
    msgs = [m for m in d["messages"] if m["t"] is not None]
    check(all(m["t"] >= 0 for m in msgs), "no message before the race")
    warn(all(m["t"] <= d["duration"] + 60 for m in msgs),
         "no message long after the race")
    print(f"         messages {len(d['messages'])}, categories "
          f"{sorted({m['cat'] for m in d['messages']})}")
    sectors = sorted({int(s) for m in d["messages"]
                      for s in [m.get("scope") and ""] if False})  # placeholder
    print(f"         order rows {len(d['order'])}, weather {len(w)}")


if __name__ == "__main__":
    year = int(sys.argv[1]) if len(sys.argv) > 1 else 2023
    rnd = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    ses = sys.argv[3] if len(sys.argv) > 3 else "R"
    audit(year, rnd, ses)
    print("\n" + "=" * 60)
    print(f"FAILURES: {len(FAILS)}")
    for f in FAILS:
        print("  -", f)
    print(f"WARNINGS: {len(WARNS)}")
    for w in WARNS[:12]:
        print("  -", w)
    sys.exit(1 if FAILS else 0)
