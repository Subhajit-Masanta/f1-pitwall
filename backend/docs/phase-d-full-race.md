# Phase D — Full Race replay

Preparation notes. Every number below was **measured** from real sessions in the
local FastF1 cache (2023 Australia and 2023 Bahrain), not estimated.

Probe script: `scratchpad/race_probe.py` (re-runnable: `python race_probe.py <year> <round>`).

---

## 1. The constraint that decides everything: payload size

A qualifying lap is 2,142 frames at 30 Hz ≈ **340 KB for one car**. A race is
~90 minutes with 20 cars. At 30 Hz that is ~3.4 million points — impossible.
So the sample rate is the first decision, and it sets the shape of everything else.

Measured, all 20 cars, X/Y + on-track flag, rounded to 1 dp, gzip level 6
(the same level `database.cache_set` uses):

| rate | frames/car | raw | **gzip** |
|------|-----------|------|------|
| 1 Hz | 5,728 | 1.83 MB | **0.61 MB** |
| 2 Hz | 11,456 | 3.65 MB | **1.21 MB** |
| 4 Hz | 22,912 | 7.31 MB | **2.40 MB** |

*(Bahrain, 95.5 min. Australia ran 152.8 min because of three red flags and
produced **the same** gzip sizes — the extra time was cars sitting still, which
compresses away. So ~1.2 MB at 2 Hz is stable across races, not a best case.)*

### Decision: 2 Hz

- At map scale a car moves ~1 px per 100 ms, and the frontend already
  interpolates between frames (`sampleTelemetry`), so 2 Hz is visually smooth.
- 1.21 MB gzip is far under MongoDB's **16 MB document limit** — no chunking
  needed, which keeps the endpoint a single request.
- Atlas M0 free tier is **512 MB total**; at ~1.2 MB/race a full season is
  ~29 MB. The cache currently holds 149 sessions in 4.6 MB, so there is room
  for several seasons of races.
- 4 Hz also fits (2.4 MB) and stays an option if 2 Hz looks stepped in practice.
  Decide by looking, not by arguing — the rate is one constant.

**Do not** reuse the 30 Hz lap pipeline for race mode. Different problem.

---

## 2. What FastF1 already gives us

No new data source is needed — this was checked against a loaded race session.
Everything below comes from `session.load(telemetry=True, weather=True, messages=True)`.

| feature | source | shape (2023 Australia) |
|---|---|---|
| car positions | `session.pos_data[num]` | X, Y, Z, Status, SessionTime per car |
| running order | `laps.Position` | 995 rows over 58 laps — **2 KB gzipped** |
| tyres / stints | `laps` Stint / Compound / TyreLife / FreshTyre | 85 stints, 20 drivers |
| pit stops | `laps` PitInTime / PitOutTime | 65 stops |
| SC / VSC / red flag | `session.track_status` | 23 spans, 15 non-green |
| flags & incidents | `session.race_control_messages` | 103 messages |
| weather | `session.weather_data` | 222 rows |

---

## 3. Event model — SC, VSC, red flag, yellow

`track_status` is the authoritative timeline. Codes confirmed against real data
(Australia 2023 hit **every** one of them, which makes it the test fixture):

| code | meaning | seen at Australia |
|---|---|---|
| `1` | AllClear | 8 spans |
| `2` | Yellow | 5 spans |
| `4` | **SafetyCar** | 3 spans (285 s, 158 s, 156 s) |
| `5` | **RedFlag** | 4 spans (941 s, 602 s, 1369 s …) |
| `6` | **VSC** | 1 span (122 s) |
| `7` | VSC ending | 1 span (14 s) |
| `3` | never observed | — |

`race_control_messages` carries the human detail, with columns
`Time, Category, Message, Status, Flag, Scope, Sector, RacingNumber, Lap`.

- Categories: `Flag`, `Other`, `SafetyCar`, `Drs`, `CarEvent`
- `Flag` values: `GREEN`, `YELLOW`, `DOUBLE YELLOW`, `CLEAR`, `RED`, `BLUE`, `CHEQUERED`
- `Scope` / `Sector` localise a yellow to part of the track — enough to tint
  only the affected sector on the map rather than the whole circuit
- `RacingNumber` ties an incident to a car (e.g. "CAR 1 (VER) OFF TRACK …")

**Use `track_status` for state, `race_control_messages` for captions.** They
disagree in granularity: Australia has 6 SafetyCar *messages* but 3 SafetyCar
*spans*, because "DEPLOYED" and "IN THIS LAP" are two messages for one span.

### ⚠ Edge case found in real data

The final `track_status` span can start **after** the last lap's `Time`, which
produced a **negative duration (−62.8 s)** in the probe. Clamp span ends to
`max(lastStatusTime, lastLapTime)` or the timeline will end up malformed.

---

## 4. Tyres and stints

`laps.groupby(['DriverNumber','Stint','Compound'])` gives a clean stint table:
first lap, last lap, `TyreLife`, `FreshTyre`. Compounds at Australia: HARD,
MEDIUM, SOFT (also expect INTERMEDIATE / WET, and `UNKNOWN` for older seasons).

### ⚠ Edge case found in real data

Red-flag restarts split stints oddly. Verstappen at Australia:

```
stint 1  MEDIUM  laps 1-8    (life 8,  fresh=True)
stint 2  HARD    laps 9-55   (life 47, fresh=True)
stint 3  SOFT    laps 56-57  (life 5,  fresh=False)   <- fitted under red flag
stint 4  SOFT    laps 58-58  (life 6,  fresh=False)   <- same tyres, new stint
```

Stints 3 and 4 are the *same physical set*. A strategy bar that trusts the
stint number will draw a phantom pit stop. Merge consecutive stints with the
same compound where `TyreLife` continues, and cross-check against `PitInTime`.

---

## 4b. The pit lane — measured, and the problem it creates

FastF1 ships **no pit-lane geometry**, and our track outline comes from a
fastest lap, which by definition never enters the pits. So the lane has to be
derived from position data captured while cars were pitting.

**It works.** Probe: `scripts/pit_probe.py`. At Bahrain 2023, 50 pit stops were
paired and their position traces resampled onto a common parameter:

- one averaged polyline, **~397 m long** (Bahrain's real pit lane is ~400 m)
- driver-to-driver spread about that mean: **median 8 m**, p90 30 m
- the p90/max outliers are not noise — each team's box sits at a different
  point along the lane, so arc-length parameterisation misaligns the stops

### ⚠ The problem: the pit lane is only 2–4 px away at map scale

Distance from the racing line, measured on three very different circuits:

| circuit | median | p90 | max |
|---|---|---|---|
| Bahrain | 15.5 m | 16.6 m | 19.5 m |
| Monaco | 16.6 m | 31.7 m | **33.1 m** |
| Austria | 16.6 m | 18.4 m | 20.9 m |

**No circuit's pit lane diverges more than ~33 m from the track.** A 5.4 km lap
is drawn into roughly 700 px, so 1 px ≈ 8–10 m — a geometrically accurate pit
lane would sit **2–4 px** from the track line and read as a slightly doubled
line, not as a pit lane. Drawing it "correctly" is the one option that does not
work. See §9 for the decision.

### The pit box is well defined

Stationary phases were detected in **50/50** stops by thresholding speed inside
the pit window:

| | Bahrain | Monaco | Austria |
|---|---|---|---|
| stationary (the tyre change) | 4.4 s | 4.1 s | 3.5 s |
| full pit transit, in → out | 25.3 s | 25.7 s | 21.7 s |
| box area spread along the lane | 70 m | 56 m | 63 m |

The centroid is stable (Monaco X = −7006 ± 187), so the pit box area can be
marked on the map as a zone, and a live stop timer is straightforward.

### ⚠ Implementation detail

`PitInTime` and `PitOutTime` are **never on the same lap row** — measured
literally 0 rows with both. A stop is `PitIn` on lap N paired with `PitOut` on
lap N+1. Any code that reads one row will find nothing.

## 5. Endpoint design

Split `race_data.py` out of the service layer (it is the `race_data.py` that
Phase C deliberately did **not** create, because there was nothing to put in it).

```
GET /race/{year}/{round}/{session}
```

One cached document, `CACHE_SCHEMA` bumped. Suggested payload:

```jsonc
{
  "race": "Australian Grand Prix", "total_laps": 58,
  "t0": 0.0, "hz": 2, "frames": 11456,
  "drivers": [ { "number":"1","code":"VER","team":"...","color":"#3671C6" } ],
  "cars":    { "1": { "x":[...], "y":[...], "on":[...] } },
  "order":   [ [lap, "1", 1], ... ],          // 2 KB — position per lap
  "stints":  { "1": [ {"compound":"MEDIUM","from":1,"to":8,"fresh":true} ] },
  "pits":    [ {"driver":"1","lap":8,"duration":22.4} ],
  "status":  [ {"code":"4","name":"SafetyCar","start":3805.8,"end":4091.0} ],
  "messages":[ {"t":..., "lap":1, "cat":"SafetyCar", "msg":"SAFETY CAR DEPLOYED"} ],
  "weather": [ {"t":..., "air":19.4, "track":35.1, "rain":false} ]
}
```

Reuse from Phase C: `load_session`, `CACHE_SCHEMA`, `payload.trim`,
`telemetry_math.racing_line` (for the track outline, already served by
`/track`), and the rotation the existing loaders apply.

**Reuse the rotation rule**: both replay loaders refuse to run before
`trackData` exists, because rotation defaults to 0 and silently produces an
unrotated track. Race mode must do the same.

---

## 6. Frontend plan

Already built for this — no rework needed:

- `CarLayer` takes `cars[]`, places N markers imperatively, and de-collides
  their name tags. It was written for a grid, not a pair.
- `useClock` is mode-agnostic — duration + speed + `onTick`, nothing lap-specific.
- `stageLayout` states bands in one place, so a timing tower is a new band.

New work:

1. **`useRaceTiming`** — the sibling of `useLapTiming`. Counts laps and tracks
   running order instead of watching for two sector crossings. This is the seam
   `useRaceLoop` was split for.
2. **`ReplayStage` / mode containers** — the split deferred in Phase B. It was
   deferred *because* two near-identical modes could not show where the seam
   belongs; race mode, with N cars, lap counting and no delta, is the third data
   point that can. Do it here, first, before RaceMode grows.
3. **Timing tower** — the left column that currently sits empty on desktop.
   Position, code, team flash, gap, tyre compound dot, pit indicator.
4. **Race status banner** — SC / VSC / RED, driven by the `status` timeline,
   plus the track tinting yellow only in the affected `Scope`/`Sector`.
5. **Strategy bar** — stints per driver across the lap axis (respecting the
   merge rule in §4).

---

## 7. Build order

1. `race_data.py` + `/race` endpoint; verify payload size on a real race
2. Warm the cache for one season; confirm Mongo growth matches the estimate
3. `ReplayStage` split (§6.2)
4. `useRaceTiming` + cars on track, nothing else — prove 20 cars at 60 fps
5. Timing tower
6. Status banner + flags
7. Tyres / strategy / weather

Test fixture throughout: **2023 Australia (round 3)**. It is the only race in
the local cache that exercises SC, VSC, VSC-ending, red flag and yellow in one
session, and it triggers both edge cases in §3 and §4.

---

## 8. Open questions

- **Retired cars.** `pos_data` Status is `OnTrack`/other; the probe interpolates
  it as 0/1 and rounds, which is crude. Decide how a retirement leaves the map.
- ~~Gaps in the tower~~ — decided, §9: interpolate between lap crossings.
- ~~Race length vs attention~~ — decided, §9: lap scrubber, speeds unchanged.
- ~~Pit lane with no stops~~ — decided, §9d.
- ~~Pit path under a red flag~~ — decided, §9d.

## 9. Decisions (agreed)

| question | decision |
|---|---|
| pit lane rendering | **Exaggerated offset (~4x)** — real shape, real entry/exit, stylised gap |
| car while pitting | **Drives the pit path**, stops in the box with a live stop timer |
| race navigation | **Keep 1x-10x**, add a lap scrubber as the primary way to move |
| tower gaps | **Interpolate between lap crossings** |

### 9a. Exaggerating the lane — two things that will break if missed

**1. The offset must taper to zero at both ends.** If every point is pushed out
by a flat 4x, the lane detaches from the circuit and floats beside it, with
visible gaps where it should join. The multiplier has to ramp 1x -> 4x -> 1x
across the lane's length so pit entry and exit stay welded to the racing line.

**2. Cars must be pushed through the SAME transform.** The measured position of
a pitting car is its real position, 12-30 m off the line. If the drawn lane is
exaggerated but the car is not, the car will drive along the track while the
lane sits beside it — the one thing that would make this look broken. So the
transform is a shared function:

    pitTransform(x, y) -> (x', y')

applied to the lane polyline at build time AND to any car whose position falls
inside its pit window at playback time. Put it in `telemetry_math.py` with the
other pure geometry, and unit-test it: a point on the racing line must map to
itself, and the taper must return the ends unchanged.

### 9b. Deriving the lane (backend, `race_data.py`)

1. Pair stops: `PitIn` lap N with `PitOut` lap N+1 (never the same row — §4b)
2. Slice `pos_data` for each stop between those times
3. Resample each trace to a common 0..1 arc-length parameter (N ~ 120)
4. Take the **median** per parameter point, not the mean — team boxes sit at
   different points along the lane, which drags a mean toward whichever teams
   pitted most (measured spread: median 8 m but p90 30 m, max 122 m)
5. Find entry/exit as the parameter values where the median path is nearest the
   racing line; those two points anchor the taper
6. Pit box zone = the centroid cluster of stationary phases (detected in 50/50
   stops at Bahrain)

### 9c. Navigation consequence, stated plainly

Keeping 1x-10x means a 90-minute race still takes **9 minutes at 10x**. The lap
scrubber therefore is not a convenience, it is the primary control, and it has
to be good: scrub to any lap, land on the lap start, and show the running order
and status (SC / VSC / flag) at that lap while scrubbing. If watching end-to-end
turns out to be tedious in practice, higher speeds are one constant away.

---

### 9d. Two ways the derived pit lane goes wrong

**Sessions with (almost) no pit stops — omit the lane entirely.**

The lane is averaged from real pit traces, and the pit ENTRY and EXIT points are
derived from the same traces: they are where the pit path meets the racing line.
So with no stops there is no lane *and no entry/exit* — "fall back to entry/exit
ticks" is not an available option, it would need a separate derivation.

Rule: **fewer than 5 usable stops -> draw no pit lane.** The map degrades to
exactly what it renders today. Nothing invented, nothing broken. Sprint races
(100 km, no mandatory stop) are the main case, plus abandoned races and thin
older seasons.

**Red-flag windows are not pit stops — filter them out before averaging.**

A stop is detected as `PitInTime` -> `PitOutTime`. Under a red flag those
timestamps exist too, but the car did not drive to its box and change tyres: it
drove in and queued nose-to-tail near the pit exit for twenty minutes. That path
has a completely different shape, and averaging it in drags the median line
toward wherever cars happened to park.

The durations separate the two cases by more than an order of magnitude:

| | real stop (in -> out) | red-flag window |
|---|---|---|
| Bahrain | 24.2 - 44.5 s | — |
| Monaco | 23.9 - 51.1 s | — |
| Austria | 15.9 - 31.8 s | — |
| Australia red flags | — | **602 s, 941 s, 1369 s** |

Rule: **discard any pit window longer than 90 s.** No genuine stop comes close
(worst measured: 51.1 s at Monaco). Cross-check against the `code == '5'` spans
in `track_status` as a second filter — those are already parsed for the race
status banner, so it costs nothing.
