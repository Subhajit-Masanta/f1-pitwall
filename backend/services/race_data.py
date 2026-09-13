"""
📄 race_data.py — a whole race, resampled for playback.

The heaviest payload in the app, and the reason it is built differently from a
qualifying lap: 20 cars for ~90 minutes instead of one car for 90 seconds.

WHY 2 Hz AND NOT 30. Measured on real races (see docs/phase-d-full-race.md):
a lap at 30 Hz is 340 KB for ONE car, so a race at 30 Hz would be ~3.4 million
points. At 2 Hz the whole race is 1.21 MB gzipped — under MongoDB's 16 MB
document limit, so this stays a single request with no chunking. At map scale a
car covers ~1 px per 100 ms and the frontend already interpolates between
frames, so 2 Hz is smooth. Bahrain (95 min) and Australia (153 min, three red
flags) both come out at ~1.2 MB: the extra time was cars standing still, which
compresses away.

Cache access goes through `database.cache_get` / `database.cache_set` — see the
note in session_data.py.
"""
import numpy as np

import database
from services.payload import trim
from services.session_loader import CACHE_SCHEMA, load_session
from services.telemetry_math import racing_line
from services import pit_geometry as pg

# Playback sample rate for a race. See the module docstring.
RACE_FPS = 2

# How long a car stays drawn after its final lap time.
RETIREMENT_GRACE_S = 4.0

# Points in the emitted track outline (matches TRACK_OUTLINE_POINTS in track_data).
OUTLINE_POINTS = 500

# FastF1 track-status codes, confirmed against Australia 2023 which hit every
# one of them. `3` has never been observed in any session we have loaded.
STATUS_NAMES = {
    "1": "CLEAR", "2": "YELLOW", "4": "SAFETY CAR",
    "5": "RED FLAG", "6": "VSC", "7": "VSC ENDING",
}


def _secs(v, t0_date=None):
    """
    Seconds into the session, from either kind of timestamp FastF1 hands out.

    `track_status.Time` and `weather_data.Time` are Timedeltas measured from
    session start, but `race_control_messages.Time` is an absolute Timestamp.
    Calling .total_seconds() on the latter raises, so both shapes are handled
    here rather than at three call sites.
    """
    if v is None or str(v) == "NaT":
        return None
    if hasattr(v, "total_seconds"):
        return float(v.total_seconds())
    if t0_date is not None:
        try:
            return float((v - t0_date).total_seconds())
        except Exception:
            return None
    return None


def _pair_pit_stops(laps):
    """
    Pit stops as (in, out) pairs.

    `PitInTime` and `PitOutTime` are NEVER on the same lap row — measured
    literally zero rows with both. A stop is PitIn on lap N paired with PitOut
    on lap N+1, so anything reading a single row finds nothing.
    """
    stops = []
    for num in laps["DriverNumber"].unique():
        rows = list(laps.pick_drivers(num).sort_values("LapNumber").itertuples())
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
                "compound": str(getattr(nxt, "Compound", "") or ""),
            })
    return stops


def _status_spans(session, t_end):
    """
    The SC / VSC / red-flag / yellow timeline, as spans rather than instants.

    Each track_status row is a CHANGE, so a span runs to the next row. The last
    span runs to the end of the session — and that is the edge case: the final
    row can be timestamped AFTER the last lap's time, which produced a negative
    duration (-62.8 s) on real data. Hence the clamp.
    """
    ts = session.track_status
    if ts is None or ts.empty:
        return []
    secs = ts["Time"].dt.total_seconds().to_numpy()
    end = max(float(t_end), float(secs[-1]))
    spans = []
    for i in range(len(ts)):
        start = float(secs[i])
        stop = float(secs[i + 1]) if i + 1 < len(secs) else end
        code = str(ts["Status"].iloc[i])
        spans.append({
            "code": code,
            "name": STATUS_NAMES.get(code, "UNKNOWN"),
            "start": round(start, 1),
            "end": round(max(stop, start), 1),
        })
    return spans


def _merge_stints(laps):
    """
    Tyre stints per driver, with red-flag artefacts merged away.

    A red-flag restart splits a stint in two on the SAME physical set — at
    Australia, Verstappen shows `SOFT laps 56-57 (life 5)` then
    `SOFT lap 58 (life 6)`. Trusting the stint number there draws a pit stop
    that never happened, so consecutive same-compound stints whose TyreLife
    continues are joined.
    """
    out = {}
    for num in laps["DriverNumber"].unique():
        dl = laps.pick_drivers(num).sort_values("LapNumber")
        runs = []
        for r in dl.itertuples():
            comp = str(r.Compound or "UNKNOWN")
            life = None if r.TyreLife is None or np.isnan(r.TyreLife) else int(r.TyreLife)
            lap = int(r.LapNumber)
            # Same compound AND the wear count carries on = the same physical
            # set, so the split is a stint-number artifact of a restart.
            #
            # The tolerance matters: FastF1 DECREMENTS TyreLife by one across a
            # red-flag restart rather than continuing it. Measured at Australia
            # 2023, Alonso reads SOFT life 5, 6, then 5 — a used tyre cannot
            # un-wear, so that is one set mis-numbered as two. A genuinely new
            # set resets the count outright (de Vries drops 9 -> 5), which is
            # well outside this window.
            prev_life = runs[-1]["life_end"] if runs else None
            same_set = (
                life is None or prev_life is None
                or (prev_life - 1) <= life <= (prev_life + 2)
            )
            if runs and runs[-1]["compound"] == comp and same_set:
                runs[-1]["to"] = lap
                runs[-1]["life_end"] = life
            else:
                runs.append({
                    "compound": comp, "from": lap, "to": lap,
                    "life_start": life, "life_end": life,
                    "fresh": bool(getattr(r, "FreshTyre", False)),
                })
        out[str(num)] = [
            {"compound": x["compound"], "from": x["from"], "to": x["to"],
             "fresh": x["fresh"], "life": x["life_start"]}
            for x in runs
        ]
    return out


def _pit_lane(session, lane_stops, line):
    """
    The derived pit lane, already amplified so it is visible on the map.

    Takes the FILTERED stop list: only representative stops shape the geometry.
    Returns (lane_points, box, xform) where `xform` is the (raw, amplified)
    path pair that CARS are displaced by — see pit_geometry.displace_like.
    `lane_points` is None when there were
    too few usable stops to average a path — a sprint, an abandoned race, a
    thin old season. Nothing is drawn rather than geometry being invented,
    because the pit ENTRY and EXIT come from the same traces and so are also
    unknown without them.
    """
    if len(lane_stops) < pg.MIN_STOPS_FOR_LANE:
        print(f"[RACE] only {len(lane_stops)} representative pit stops — "
              f"no pit lane drawn")
        return None, None, None

    traces, boxes = [], []
    for st in lane_stops:
        tr = _pit_trace(session, st, pad_s=PIT_TRACE_PAD_S)
        if tr is None:
            continue
        px, py, t = tr
        traces.append(np.column_stack([px, py]))
        b = pg.stationary_box(px, py, t)
        if b:
            boxes.append(b)

    path = pg.median_path(traces)
    if path is None:
        return None, None, None
    # Match the raw path to the circuit FIRST, sequentially, then use those
    # endpoints as the anchors. Anchoring before matching let a global nearest
    # pick the wrong side of the circuit at Monaco.
    j = pg.sequential_nearest(path[:, 0], path[:, 1], line)
    d = np.hypot(path[:, 0] - line[j, 0], path[:, 1] - line[j, 1])
    d_ref = float(np.median(d))
    path = pg.anchor_ends(path, line,
                          q0=(line[j[0], 0], line[j[0], 1]),
                          q1=(line[j[-1], 0], line[j[-1], 1]))
    amp = pg.amplify_path(path, line, d_ref)
    lane = [{"X": round(float(x), 1), "Y": round(float(y), 1)} for x, y in amp]

    box = None
    if boxes:
        bx = float(np.median([b[0] for b in boxes]))
        by = float(np.median([b[1] for b in boxes]))
        # Displaced like the lane, not re-amplified, so the box sits ON it.
        gx, gy = pg.displace_like([bx], [by], path, amp)
        box = {"X": round(float(gx[0]), 1), "Y": round(float(gy[0]), 1),
               "median_stop_s": round(float(np.median([b[2] for b in boxes])), 1)}

    print(f"[RACE] pit lane from {len(traces)} stops, d_ref={d_ref:.0f}, "
          f"{len(lane)} points")
    return lane, box, (path, amp)


# Seconds of ON-TRACK running to capture either side of a pit window when
# deriving the lane. PitInTime fires as the car crosses the pit ENTRY line, by
# which point it is already in the lane — so an unpadded trace never contains
# the car peeling off the track, never converges on the racing line, and the
# distance-keyed taper has nothing to taper. Measured result without padding:
# the drawn lane's ends sat 58 m from the track, exactly as far out as its
# middle, i.e. a detached loop floating beside the circuit.
PIT_TRACE_PAD_S = 4.0


def _pit_trace(session, st, pad_s=0.0):
    """Position samples inside one pit window, or None if too few."""
    pos = session.pos_data.get(st["driver"])
    if pos is None:
        return None
    t = pos["SessionTime"].dt.total_seconds().to_numpy()
    m = (t >= st["in_s"] - pad_s) & (t <= st["out_s"] + pad_s)
    if m.sum() < 8:
        return None
    return (pos["X"].to_numpy().astype(float)[m],
            pos["Y"].to_numpy().astype(float)[m],
            t[m])


def _pit_detail(session, stops, spans):
    """
    Every pit stop, annotated — including the ones excluded from the geometry.

    This is the correction to a bug worth recording. The filtered list that
    shapes the lane is NOT the list of stops that happened. At Australia 2023
    all three of Verstappen's stops ran 868-1857 s because a red flag fell
    while he was in the pits — a red flag is exactly when teams change tyres
    for free. Filtering those out of the lane geometry is right; filtering them
    out of the payload deleted his pit stops entirely and reported that he
    never pitted.

    So every window is reported, with two different durations:
      · `window`  — pit entry to pit exit, which a red flag inflates
      · `stopped` — time actually stationary in the box, i.e. the tyre change
    plus `red_flag` so the UI can say why a window was twenty minutes long.
    """
    reds = [(x["start"], x["end"]) for x in spans if str(x.get("code")) == "5"]
    out = []
    for st in stops:
        window = st["out_s"] - st["in_s"]
        under_red = any(st["in_s"] < b and st["out_s"] > a for a, b in reds)
        stopped = None
        tr = _pit_trace(session, st)
        if tr is not None:
            b = pg.stationary_box(*tr)
            if b:
                stopped = round(b[2], 1)
        out.append({
            "driver": st["driver"],
            "lap": st["lap"],
            "t": round(st["in_s"], 1),
            "window": round(window, 1),
            "stopped": stopped,
            "red_flag": under_red,
            "compound": st["compound"],
        })
    return out


def get_race_data(year: int, race_round: int, session_type: str = "R"):
    """
    Everything a full-race replay needs, in one cached document.
    """
    key = f"race:{CACHE_SCHEMA}:{year}:{race_round}:{session_type}"
    hit = database.cache_get(key)
    if hit is not None:
        print(f"[CACHE HIT] {key}")
        return hit

    print(f"[INFO] Building race payload for {year} R{race_round} ({session_type})...")
    session = load_session(year, race_round, session_type)
    laps = session.laps
    if laps is None or laps.empty:
        return {"error": "No laps in this session"}

    # --- the shared reference geometry ------------------------------------
    fastest = laps.pick_fastest()
    if fastest is None or (hasattr(fastest, "empty") and fastest.empty):
        return {"error": "No fastest lap available for this session"}
    tel = fastest.get_telemetry()
    s_grid, x_grid, y_grid, chans, _ = racing_line(tel)
    step = max(1, len(s_grid) // OUTLINE_POINTS)
    idx = list(range(0, len(s_grid), step))
    if idx[-1] != len(s_grid) - 1:
        idx.append(len(s_grid) - 1)
    track_points = [
        {"X": float(x_grid[i]), "Y": float(y_grid[i]), "D": float(chans["D"][i])}
        for i in idx
    ]
    # A coarser line for the nearest-point maths — brute force is O(points x line).
    line = np.column_stack([x_grid, y_grid])[::max(1, len(x_grid) // 600)]

    # --- the timeline -----------------------------------------------------
    t0 = float(laps["LapStartTime"].min().total_seconds())
    t_end = float(laps["Time"].max().total_seconds())
    grid = np.arange(t0, t_end, 1.0 / RACE_FPS)

    # --- events, needed before the pit lane (red flags filter the stops) --
    spans = _status_spans(session, t_end)
    stops_all = _pair_pit_stops(laps)
    # The lane's SHAPE comes from representative stops only; everything else
    # uses every stop that happened. See _pit_detail for why these differ.
    lane, box, xform = _pit_lane(session, pg.usable_stops(stops_all, spans), line)

    # --- who is still running, and until when ------------------------------
    # `pos_data.Status` is the obvious place to look and it is USELESS: measured
    # on Australia 2023 it reads ['OnTrack'] for all twenty cars for the whole
    # session, and the position stream runs 285 s past the chequered flag. So a
    # retired car never stopped being drawn — Leclerc crashed on lap 1 and his
    # marker sat parked beside the circuit for the remaining 150 minutes.
    #
    # `laps` is the signal that works: a driver's last lap Time is the last
    # moment they were on track.
    # Two signals, and the earlier one wins. A driver's last lap TIME looks
    # sufficient but a red flag corrupts it: Russell retired on lap 18 at
    # Australia 2023 and Magnussen on lap 53, yet both carry the identical
    # last-lap Time of 5869 s — a session stamp, not a lap completion. Using it
    # alone kept Russell on the map for another 25 laps.
    #
    # The lap NUMBER is reliable, so the moment the lap after their last one
    # began is the moment they were definitively gone. min() of the two is
    # robust: for a clean retirement or a finisher they agree.
    lap_begin = {}
    for lap_no, grp in laps.groupby("LapNumber"):
        tt = grp["LapStartTime"].min()
        if tt is not None and str(tt) != "NaT":
            lap_begin[int(lap_no)] = float(tt.total_seconds())

    out_at = {}
    for num in laps["DriverNumber"].unique():
        dl = laps.pick_drivers(num)
        cand = [t_end]
        lt = dl["Time"].max()
        if lt is not None and str(lt) != "NaT":
            cand.append(float(lt.total_seconds()))
        nxt = lap_begin.get(int(dl["LapNumber"].max()) + 1)
        if nxt is not None:
            cand.append(nxt)
        out_at[str(num)] = min(cand)

    results = getattr(session, "results", None)

    def _res(num, field, default=""):
        if results is None or results.empty:
            return default
        row = results.loc[results["DriverNumber"] == num, field]
        return row.iloc[0] if len(row) else default

    # --- driver identity --------------------------------------------------
    drivers = []
    for num in laps["DriverNumber"].unique():
        # NOT named `grid`: that is the playback timeline in this function, and
        # this loop runs before the car loop uses it. Shadowing it turned the
        # time array into an int and broke the on-track mask.
        grid_pos = _res(num, "GridPosition", None)
        try:
            grid_pos = int(grid_pos) if grid_pos is not None and not np.isnan(grid_pos) else None
        except (TypeError, ValueError):
            grid_pos = None
        try:
            info = session.get_driver(num)
            colour = str(info["TeamColor"] or "").strip().lstrip("#")
            drivers.append({
                "number": str(num),
                "code": str(info["Abbreviation"]),
                "name": str(info["FullName"]),
                "team": str(info["TeamName"]),
                "color": f"#{colour}" if colour else "#9E9E9E",
                "grid": grid_pos,
                "status": str(_res(num, "Status", "")),
            })
        except Exception:
            drivers.append({"number": str(num), "code": str(num), "name": str(num),
                            "team": "", "color": "#9E9E9E", "grid": grid_pos,
                            "status": str(_res(num, "Status", ""))})

    # --- car positions ----------------------------------------------------
    # Cars inside a pit window go through the SAME amplification as the lane
    # polyline. Transforming one and not the other is the single thing that
    # would make this look broken — the car would drive down the middle of the
    # track while the lane sat beside it.
    # Every window, not just the representative ones: a car parked in the pit
    # lane under a red flag really is in the pit lane, and should be drawn there.
    by_driver = {}
    for st in stops_all:
        by_driver.setdefault(st["driver"], []).append((st["in_s"], st["out_s"]))

    cars = {}
    for num in laps["DriverNumber"].unique():
        num = str(num)
        pos = session.pos_data.get(num)
        if pos is None:
            continue
        pt = pos["SessionTime"].dt.total_seconds().to_numpy()
        px = np.interp(grid, pt, pos["X"].to_numpy().astype(float))
        py = np.interp(grid, pt, pos["Y"].to_numpy().astype(float))
        # A few seconds of grace so a car that has just crossed the line for
        # the last time rolls out of shot rather than vanishing mid-corner.
        on = grid <= (out_at.get(num, t_end) + RETIREMENT_GRACE_S)

        # Two masks, on purpose. `in_pit` is the real window and drives the
        # PIT flag the UI shows. `shift` is that window PADDED by the same
        # amount the lane derivation used, and it is what gets displaced.
        #
        # Without the pad the transform switches on at PitInTime, by which
        # point the car is already ~14 m off the racing line — so its drawn
        # position stepped ~42 m sideways in a single frame and the car
        # visibly teleported into the pit lane. The padded window starts while
        # the car is still on track, where the lane's own on-track approach
        # gives a displacement of nearly zero, so it eases in instead.
        in_pit = np.zeros(len(grid), dtype=bool)
        shift = np.zeros(len(grid), dtype=bool)
        for a, b in by_driver.get(num, []):
            in_pit |= (grid >= a) & (grid <= b)
            shift |= (grid >= a - PIT_TRACE_PAD_S) & (grid <= b + PIT_TRACE_PAD_S)
        if xform is not None and shift.any():
            ax, ay = pg.displace_like(px[shift], py[shift], xform[0], xform[1])
            px[shift], py[shift] = ax, ay

        cars[num] = {
            "x": [round(float(v), 1) for v in px],
            "y": [round(float(v), 1) for v in py],
            "on": [int(v) for v in on],
            "pit": [int(v) for v in in_pit],
        }

    # --- running order, per lap ------------------------------------------
    order = [
        [int(r.LapNumber), str(r.DriverNumber), int(r.Position)]
        for r in laps[["LapNumber", "DriverNumber", "Position"]]
        .dropna(subset=["Position"]).itertuples()
    ]

    pit_detail = _pit_detail(session, stops_all, spans)

    # --- per-driver timing points, for the tower's interval column --------
    # SECTOR crossings, not lap crossings. `order` gives POSITION per lap but
    # no times, so a gap cannot come from it — and lap crossings alone are far
    # too coarse: one timing point per driver per lap left the interval column
    # frozen for a minute and a half at a time, and produced nothing at all for
    # the whole of lap one. Sectors give 2893 points instead of 1003, with the
    # first arriving 55 s into lap 1 rather than 98 s.
    #
    # `progress` is fractional laps: sector 2 of lap 4 is 3 + 2/3. The race
    # start is seeded as progress 0 so there is a reference from the moment the
    # lights go out, rather than a dead column until the first sector.
    crossings = {}
    for num in laps["DriverNumber"].unique():
        rows = [[0.0, t0]]
        for r in laps.pick_drivers(num).sort_values("LapNumber").itertuples():
            lap_no = int(r.LapNumber)
            for i in (1, 2, 3):
                v = getattr(r, f"Sector{i}SessionTime", None)
                if v is not None and str(v) != "NaT":
                    rows.append([round(lap_no - 1 + i / 3.0, 4),
                                 float(v.total_seconds())])
        # Sort by TIME and keep progress monotonic: a sector time that arrives
        # out of order (it happens around red flags) would otherwise make the
        # interpolation run backwards.
        rows.sort(key=lambda z: z[1])
        clean = []
        for prog, tt in rows:
            if clean and prog <= clean[-1][0]:
                continue
            clean.append([prog, tt])
        crossings[str(num)] = clean

    # --- when each lap began, for the leader ------------------------------
    # `order` carries no timestamps, so without this the frontend cannot tell
    # which lap a given moment belongs to — and it cannot be divided out of
    # elapsed time either: a race with 47 minutes of red flags has no fixed
    # seconds-per-lap. The earliest LapStartTime on a lap is by definition the
    # leader starting it.
    lap_starts = []
    for lap, grp in laps.groupby("LapNumber"):
        t = grp["LapStartTime"].min()
        if t is not None and str(t) != "NaT":
            lap_starts.append([int(lap), round(float(t.total_seconds()), 1)])
    lap_starts.sort()

    # --- race control captions -------------------------------------------
    rc = session.race_control_messages
    t0_date = getattr(session, "t0_date", None)
    messages = []
    if rc is not None and not rc.empty:
        for r in rc.itertuples():
            ts = _secs(getattr(r, "Time", None), t0_date)
            messages.append({
                "t": round(ts, 1) if ts is not None else None,
                "lap": int(r.Lap) if getattr(r, "Lap", None) is not None
                       and not np.isnan(r.Lap) else None,
                "cat": str(r.Category),
                "flag": str(getattr(r, "Flag", "") or ""),
                "scope": str(getattr(r, "Scope", "") or ""),
                "msg": str(r.Message),
            })

    # --- weather ----------------------------------------------------------
    w = session.weather_data
    weather = []
    if w is not None and not w.empty:
        for r in w.itertuples():
            wt = _secs(getattr(r, "Time", None), t0_date)
            weather.append({
                "t": round(wt, 1) if wt is not None else None,
                "air": round(float(r.AirTemp), 1),
                "track": round(float(r.TrackTemp), 1),
                "rain": bool(r.Rainfall),
            })

    # --- ONE TIME BASE ----------------------------------------------------
    # Everything leaves here in seconds since the race started, because the
    # payload otherwise mixes two: cars are frame-indexed from t0 (which was
    # 3736.9 s into the Australia session — the race began well after the
    # session did), while track_status, messages, weather and lap_starts are
    # absolute session time. Shipping both invites an off-by-t0 bug at every
    # single call site on the frontend. `session_t0` is kept for provenance.
    def sh(v):
        return None if v is None else round(v - t0, 1)

    spans = [
        {**sp, "start": max(0.0, sh(sp["start"])), "end": sh(sp["end"])}
        for sp in spans
        if sh(sp["end"]) is not None and sh(sp["end"]) > 0
    ]
    lap_starts = [[lap, max(0.0, sh(t))] for lap, t in lap_starts]
    crossings = {k: [[lap, sh(t)] for lap, t in v] for k, v in crossings.items()}
    for drv in drivers:
        drv["out_at"] = sh(out_at.get(drv["number"], t_end))
    # Both streams run past the chequered flag — the SESSION continues after
    # the race does. Anything outside the replay window can never be reached by
    # the clock, so it is dead weight in the payload and a trap for any code
    # that assumes t is in range.
    span_end = round(float(grid[-1] - t0), 1) if len(grid) else 0.0
    messages = [{**m, "t": sh(m["t"])} for m in messages
                if m["t"] is None or 0 <= sh(m["t"]) <= span_end]
    weather = [{**w, "t": sh(w["t"])} for w in weather
               if w["t"] is not None and 0 <= sh(w["t"]) <= span_end]
    pits = [{**q, "t": sh(q["t"])} for q in pit_detail]

    result = trim({
        "race": session.event.EventName,
        "circuit": session.event.Location,
        "session": session.name,
        "total_laps": int(laps["LapNumber"].max()),
        "rotation": _rotation(session),
        "session_t0": round(t0, 3),
        "t0": 0.0,
        "hz": RACE_FPS,
        "frames": int(len(grid)),
        "duration": round(float(grid[-1] - t0), 1) if len(grid) else 0,
        "track_points": track_points,
        "pit_lane": lane,
        "pit_box": box,
        "drivers": drivers,
        "cars": cars,
        "order": order,
        "lap_starts": lap_starts,
        "crossings": crossings,
        "stints": _merge_stints(laps),
        "pits": pits,
        "status": spans,
        "messages": messages,
        "weather": weather,
    })
    database.cache_set(key, result)
    return result


def _rotation(session):
    """Circuit rotation, or 0. Same source the lap endpoints use."""
    try:
        ci = session.get_circuit_info()
        return float(ci.rotation) if ci is not None else 0
    except Exception:
        return 0
