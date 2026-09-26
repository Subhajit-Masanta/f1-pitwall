/**
 * 📄 race.js — the /race payload, turned into something playable.
 *
 * Pure functions, no React, so the awkward parts are testable: the running
 * order between lap crossings, which status is live at a given moment, and
 * where twenty cars are on a 2 Hz grid.
 *
 * The payload arrives as parallel arrays per car (x, y, on, pit) rather than an
 * array of objects — 20 cars x 18,331 frames is 366,000 points, and objects
 * would cost an allocation each. They are copied into typed arrays once here,
 * so a frame costs an index rather than a lookup.
 */

/** Rotate a point about the origin, in degrees. Same convention as the lap map. */
const rot = (x, y, deg) => {
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r), s = Math.sin(r);
    return [x * c - y * s, x * s + y * c];
};

/**
 * Flatten the payload into typed arrays, applying the circuit rotation once.
 *
 * Rotation is applied HERE and nowhere else. Doing it per frame was the source
 * of the "car off the map" bug in lap mode: a loader that ran before the track
 * data had landed rotated by 0 and silently produced an unrotated lap.
 */
/**
 * A clock that stops when the race does.
 *
 * Under a red flag the wall clock keeps running while every car stands still,
 * so any gap measured as "now minus when the leader was here" grows by one
 * second per second. Measured at Australia 2023: every car read +346 s and
 * climbing during the stoppage, and +437 to +496 s AFTER the restart, because
 * the 350-second hole is also sitting inside the leader's own timing series
 * and poisons the interpolation through it.
 *
 * Removing stopped time from the axis fixes both at once: the gap freezes
 * while the race is stopped, and the series either side of the hole joins up
 * cleanly so the numbers are sane again at the restart.
 */
/** A crossing-free stretch shorter than this is racing, not a stoppage. */
const MIN_DEAD_S = 45;

/**
 * The dead interval around one stoppage: [when timing went quiet, the green].
 *
 * BOTH ENDS ARE MEASURED, and each from a different source, because neither
 * source gets both right.
 *
 * The END is the green light, and only `session_status` knows it. The red-flag
 * TRACK status closes when the field is released to the grid, not when the
 * race resumes — at Australia 2023 the second span closes at 6472 s and the
 * next timing point of any kind is 368 s later. Guessing it from the timing
 * data instead (the first crossing after the hole) is just as wrong in the
 * other direction: that puts the green at the moment the FIRST car reached its
 * first sector marker, giving that car zero seconds to have driven there from
 * a standing start — which is exactly what read as Alonso leading Verstappen
 * by a third of a lap at the lap-58 restart.
 *
 * The START is not the flag instant either. Cars still have to finish the lap
 * and drive to the pits, and those sectors are real: Verstappen records three
 * crossings after the third red flag came out. Freezing from the flag collapsed
 * them onto one instant.
 *
 * Nor is it simply the last crossing before the green, because the field drives
 * out of the pit lane and across the line to form up on the grid — at the
 * second Australian stoppage that put a crossing 58 s before the green and left
 * 777 s of standing still on the clock. The field is at rest for the LONGEST
 * crossing-free stretch inside the stoppage, so the dead interval runs from
 * there to the green.
 */
const deadSpan = (a, b, times) => {
    let from = a;
    let prev = a;
    let best = 0;
    for (let i = 0; i <= times.length; i++) {
        const raw = i < times.length ? times[i] : b;
        if (raw <= a) continue;
        const t = Math.min(raw, b);
        if (t - prev > best) { best = t - prev; from = prev; }
        prev = t;
        if (raw >= b) break;
    }
    return [from, b];
};

/**
 * Put the whole field back on the grid at every restart.
 *
 * A red-flag restart is a standing start: the cars line up on the grid in
 * order, so at the green they are all at the same point on the circuit and
 * every gap is zero. The timing data does not say that. Each driver's last
 * point before the stoppage is wherever they happened to be when the flag
 * flew — spread over half a minute of road — and carrying that spread across
 * the restart is why the tower still showed the tail of the field 28 s adrift
 * of a leader they were sitting beside on the grid.
 *
 * So each stoppage gets one synthetic timing point per driver: at the line, at
 * the green. It is not invented data. It is the one moment in a race where
 * every car's position is known exactly without measuring anything.
 *
 * LAPPED CARS KEEP THEIR DEFICIT. They line up at the back of the grid still a
 * lap down, and erasing that would hand them a lap back. A driver further than
 * LAP_DOWN_CUT of a lap behind the furthest-along car is taken to be a lap
 * down — the cut sits well past any real on-road spread, which never comes
 * close to a full lap.
 */
const LAP_DOWN_CUT = 0.84;

/**
 * One grid slot, as a fraction of a lap. F1 grid boxes are 8 m apart and the
 * two columns are staggered, so a position is about 4 m of road; on a 5.3 km
 * circuit that is this. It matters because a grid where every car sits at
 * EXACTLY the same point leaves the tower with twenty identical +0.000 rows
 * and no order at all — measured at the Australian stoppage, the running order
 * came out scrambled for the whole twenty minutes. The spacing is real, it
 * restores the order, and it costs about a second across the whole field.
 */
const GRID_STEP = 0.00075;

const progAt = (rows, t) => {
    let p = null;
    for (const [prog, tt] of rows) { if (tt <= t) p = prog; else break; }
    return p;
};

/** When the car reached that last point — the tie-break for two cars on it. */
const timeAt = (rows, t) => {
    let at = -Infinity;
    for (const [, tt] of rows) { if (tt <= t) at = tt; else break; }
    return at;
};

const gridAnchor = (crossings, reds, toRacing) => {
    const rowsOf = Object.fromEntries(
        Object.entries(crossings).map(([num, rows]) => [num, rows.slice()]),
    );
    for (const [a] of reds) {
        const R = toRacing(a);
        let P = -Infinity;
        for (const rows of Object.values(rowsOf)) {
            const p = progAt(rows, R);
            if (p != null && p > P) P = p;
        }
        if (!Number.isFinite(P)) continue;

        // The grid forms in the order the field was running when the flag
        // flew — which is exactly what the FIA publishes as the restart order.
        // Sectors are coarse, so most of the field shares a progress value at
        // any instant; whoever reached it first is the one in front.
        const onGrid = Object.entries(rowsOf)
            .map(([num, rows]) => [num, rows, progAt(rows, R), timeAt(rows, R)])
            // No timing at all before the stoppage means the car never started
            // or was long gone; it has no place on the restart grid.
            .filter(([, , p]) => p != null)
            .sort((x, y) => (y[2] - x[2]) || (x[3] - y[3]));

        let slot = 0;
        let prevDown = null;
        for (const [num, rows, p] of onGrid) {
            const down = Math.max(0, Math.round((P - p) - LAP_DOWN_CUT + 0.5));
            if (down !== prevDown) { slot = 0; prevDown = down; }
            const at = P - down - slot * GRID_STEP;
            slot += 1;
            // Whatever the car had reached before it came to rest is now
            // superseded by where it actually is: on the grid. Keeping both
            // would run progress backwards and the anchor would be the one
            // thrown away, which puts that car back on the pre-flag clock.
            //
            // BACK IN TIME ORDER afterwards. The anchor belongs in the middle
            // of the race, not on the end of the array, and `progAt` reads
            // rows in the order it finds them: leaving it at the back made the
            // NEXT stoppage think every car was still on lap 8, judge them
            // forty laps down, and delete 129 of Magnussen's 154 crossings.
            const next = rows.filter(([prog, t]) => t > R || prog < at);
            next.push([at, R]);
            next.sort((m, n) => m[1] - n[1] || m[0] - n[0]);
            rowsOf[num] = next;
        }
    }

    // One row per instant, progress never running backwards. Two rows at one
    // time is a zero-length interval to divide by.
    const out = {};
    for (const [num, rows] of Object.entries(rowsOf)) {
        rows.sort((x, y) => x[1] - y[1] || x[0] - y[0]);
        const keep = [];
        for (const r of rows) {
            const last = keep[keep.length - 1];
            if (!last) { keep.push(r); continue; }
            if (r[1] <= last[1]) { if (r[0] >= last[0]) keep[keep.length - 1] = r; continue; }
            if (r[0] <= last[0]) continue;
            keep.push(r);
        }
        out[num] = keep;
    }
    return out;
};

const makeRacingClock = (status, rawCrossings, stoppages) => {
    // Authoritative when the payload carries it (session_status Aborted →
    // Started); the red-flag track status is the fallback for a cached payload
    // built before v16.
    const spans = (stoppages?.length ? stoppages : (status || [])
        .filter((s) => String(s.code) === '5')
        .map((s) => [s.start, s.end]))
        .map(([a, b]) => [a, b])
        .sort((x, y) => x[0] - y[0]);
    if (!spans.length) return { toRacing: (t) => t, reds: [] };

    const times = [];
    for (const rows of Object.values(rawCrossings || {})) {
        for (const [, t] of rows) times.push(t);
    }
    times.sort((a, b) => a - b);

    const dead = [];
    for (const [a, b] of spans) {
        const d = deadSpan(a, b, times);
        if (d[1] - d[0] >= MIN_DEAD_S) dead.push(d);
    }

    // Two flags close together can produce overlapping stretches.
    dead.sort((x, y) => x[0] - y[0]);
    const reds = [];
    for (const d of dead) {
        const last = reds[reds.length - 1];
        if (last && d[0] <= last[1]) last[1] = Math.max(last[1], d[1]);
        else reds.push([d[0], d[1]]);
    }

    if (!reds.length) return { toRacing: (t) => t, reds: [] };
    return {
        reds,
        toRacing: (t) => {
            let stopped = 0;
            for (const [a, b] of reds) {
                if (t <= a) break;
                stopped += Math.min(t, b) - a;
            }
            return t - stopped;
        },
    };
};

export const buildRace = (payload) => {
    if (!payload || !payload.cars || !payload.drivers?.length) return null;
    const deg = payload.rotation || 0;
    const frames = payload.frames;

    const cars = payload.drivers
        .filter((d) => payload.cars[d.number])
        .map((d) => {
            const src = payload.cars[d.number];
            const x = new Float32Array(frames);
            const y = new Float32Array(frames);
            for (let i = 0; i < frames; i++) {
                const [rx, ry] = rot(src.x[i], src.y[i], deg);
                x[i] = rx;
                y[i] = ry;
            }
            return {
                ...d,
                x,
                y,
                outAt: d.out_at ?? Infinity,
                on: Uint8Array.from(src.on),
                pit: Uint8Array.from(src.pit),
            };
        });

    const clock = makeRacingClock(payload.status, payload.crossings, payload.stoppages);

    // The outline and the pit lane are rotated the same way, so they line up.
    const track = (payload.track_points || []).map((p) => {
        const [x, y] = rot(p.X, p.Y, deg);
        return { X: x, Y: y, D: p.D };
    });
    const pitLane = (payload.pit_lane || []).map((p) => {
        const [x, y] = rot(p.X, p.Y, deg);
        return { X: x, Y: y };
    });
    let pitBox = null;
    if (payload.pit_box) {
        const [x, y] = rot(payload.pit_box.X, payload.pit_box.Y, deg);
        pitBox = { X: x, Y: y, medianStop: payload.pit_box.median_stop_s };
    }

    // Timing points live on the RACING clock, with the field put back on the
    // grid at every restart.
    const crossings = gridAnchor(
        Object.fromEntries(
            Object.entries(payload.crossings || {}).map(([num, rows]) => [
                num, rows.map(([prog, t]) => [prog, clock.toRacing(t)]),
            ]),
        ),
        clock.reds, clock.toRacing,
    );

    return {
        race: payload.race,
        circuit: payload.circuit,
        // Which race of the weekend this is — a sprint weekend has two.
        session: payload.session,
        totalLaps: payload.total_laps,
        hz: payload.hz,
        frames,
        duration: payload.duration,
        cars,
        track,
        pitLane,
        pitBox,
        order: payload.order || [],
        lapStarts: payload.lap_starts || [],
        // Timing points live on the RACING clock, so intervals never contain
        // time the field spent parked under a red flag.
        crossings,
        toRacing: clock.toRacing,
        redSpans: clock.reds,
        stints: payload.stints || {},
        pits: payload.pits || [],
        status: payload.status || [],
        messages: payload.messages || [],
        weather: payload.weather || [],
        byNumber: Object.fromEntries(cars.map((c) => [c.number, c])),
    };
};

/** Frame index for an elapsed time, clamped into range. Use for flags/lookups. */
export const frameAt = (race, elapsed) => {
    const i = Math.round(elapsed * race.hz);
    return i < 0 ? 0 : i >= race.frames ? race.frames - 1 : i;
};

/**
 * A car's position at `t`, INTERPOLATED between the two surrounding frames.
 *
 * This is what makes twenty cars move rather than teleport. The payload is
 * 2 Hz — one position every 500 ms — so snapping to the nearest frame (which
 * `frameAt` does, and which this replaces on the hot path) shows a car jumping
 * a car-length at a time. Lap mode has always interpolated its 30 Hz frames
 * for the same reason; at 2 Hz it matters twenty-five times more.
 *
 * `on` and `pit` are taken from the FLOOR frame, not blended: they are states,
 * not quantities, and half-retired is not a thing.
 */
export const carAt = (car, race, t) => {
    const f = t * race.hz;
    let i = Math.floor(f);
    if (i < 0) i = 0;
    if (i > race.frames - 2) i = Math.max(0, race.frames - 2);
    const a = f - i;
    const g = a < 0 ? 0 : a > 1 ? 1 : a;
    const j = Math.min(i + 1, race.frames - 1);
    return {
        x: car.x[i] + (car.x[j] - car.x[i]) * g,
        y: car.y[i] + (car.y[j] - car.y[i]) * g,
        on: car.on[i] === 1,
        pit: car.pit[i] === 1,
    };
};

/**
 * The track status live at `t`, as a span.
 *
 * Spans are ordered and contiguous, so this is a scan from a cursor rather
 * than a search — it is called once per frame.
 */
export const statusAt = (race, t, cursor = 0) => {
    const s = race.status;
    if (!s.length) return { span: null, index: 0 };
    let i = Math.min(Math.max(cursor, 0), s.length - 1);
    if (s[i].start > t) i = 0;
    while (i < s.length - 1 && s[i + 1].start <= t) i++;
    return { span: s[i], index: i };
};

/**
 * Running order at a lap, as an array of driver numbers, leader first.
 *
 * `order` is [lap, driver, position] triples — one row per driver per lap,
 * which is 995 rows for a race and 2 KB gzipped. Grouping happens once.
 */
export const orderByLap = (race) => {
    const byLap = new Map();
    for (const [lap, num, pos] of race.order) {
        if (!byLap.has(lap)) byLap.set(lap, []);
        byLap.get(lap).push([pos, num]);
    }
    const out = new Map();
    for (const [lap, rows] of byLap) {
        rows.sort((a, b) => a[0] - b[0]);
        out.set(lap, rows.map((r) => r[1]));
    }
    return out;
};

/**
 * Which lap the leader is on at time `t`.
 *
 * Binary search over `lapStarts`, not arithmetic on elapsed time: Australia
 * 2023 ran 58 laps across 153 minutes with three red flags, so there is no
 * seconds-per-lap to divide by. The backend supplies the leader's start time
 * for every lap because `order` carries no timestamps of its own.
 */
export const lapAt = (race, t) => {
    const ls = race.lapStarts;
    if (!ls.length) return 1;
    if (t <= ls[0][1]) return ls[0][0];
    let lo = 0, hi = ls.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ls[mid][1] <= t) lo = mid; else hi = mid - 1;
    }
    return ls[lo][0];
};

export const lapCrossings = (race) => {
    // The first row for each lap is the earliest anyone started it; the leader
    // is by definition the car that gets there first.
    const seen = new Map();
    for (const [lap, num, pos] of race.order) {
        if (pos === 1 && !seen.has(lap)) seen.set(lap, num);
    }
    return seen;
};

/** Stint covering `lap` for a driver, or null. */
export const stintAt = (race, num, lap) => {
    const runs = race.stints[num];
    if (!runs) return null;
    for (const r of runs) if (lap >= r.from && lap <= r.to) return r;
    return null;
};

/** Pit stops for a driver, in order. */
export const pitsFor = (race, num) => race.pits.filter((p) => p.driver === num);

/**
 * Messages worth showing, newest first, limited to those already in the past.
 *
 * Race control emits 103 messages over a race, most of them procedural
 * ("PINK HEAD PADDING MATERIAL MUST BE USED"). Only the categories that
 * describe the race state are kept.
 */
const SHOWN = new Set(['Flag', 'SafetyCar', 'Drs', 'CarEvent']);

// A blue flag is a courtesy to one backmarker, not a change in the state of
// the race — and there are a lot of them: 12 of the 21 flag messages at
// Australia 2023, each naming a car and an absolute wall-clock time. Left in,
// they dominate the caption and read as noise during a replay.
const NOISE_FLAGS = new Set(['BLUE']);

// "... TIMED AT 16:17:17" is the wall clock of the original session, which
// means nothing next to a replay clock showing 39:02.
const stripStamp = (msg) => String(msg || '').replace(/\s*TIMED AT\s+[\d:]+\s*$/i, '');

export const messagesUpTo = (race, t, limit = 4) => {
    const out = [];
    for (let i = race.messages.length - 1; i >= 0; i--) {
        const m = race.messages[i];
        if (m.t == null || m.t > t) continue;
        if (!SHOWN.has(m.cat)) continue;
        if (NOISE_FLAGS.has(m.flag)) continue;
        out.push({ ...m, msg: stripStamp(m.msg) });
        if (out.length >= limit) break;
    }
    return out;
};

/** Weather sample live at `t`. */
export const weatherAt = (race, t) => {
    const w = race.weather;
    if (!w.length) return null;
    let lo = 0, hi = w.length - 1;
    if (t <= w[0].t) return w[0];
    if (t >= w[hi].t) return w[hi];
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (w[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return w[lo];
};

/**
 * Gap to the leader for every driver at a given lap, in seconds.
 *
 * From each driver's own crossing time for that lap, which is why the backend
 * ships `crossings` — `order` has positions but no times, so no gap can be
 * derived from it. The value therefore updates once per lap, at the line,
 * exactly as a timing tower does.
 *
 * Returns a Map of driver number -> seconds behind the leader (0 for the
 * leader, null where that driver has no time for the lap: retired, lapped, or
 * still in the pits).
 */
export const gapsAtLap = (race, lap) => {
    const out = new Map();
    let best = Infinity;
    const at = new Map();
    for (const [num, rows] of Object.entries(race.crossings)) {
        // rows are ordered by lap, so index lap-1 is the usual case; fall back
        // to a scan when a driver has missing laps.
        let t = null;
        const guess = rows[lap - 1];
        if (guess && guess[0] === lap) t = guess[1];
        else for (const r of rows) if (r[0] === lap) { t = r[1]; break; }
        if (t != null) {
            at.set(num, t);
            if (t < best) best = t;
        }
    }
    for (const [num] of Object.entries(race.crossings)) {
        const t = at.get(num);
        out.set(num, t == null ? null : Math.max(0, t - best));
    }
    return out;
};

// --- the safety car -------------------------------------------------------
/** How far ahead of the leader the safety car runs, in seconds of track. */
export const SC_LEAD_S = 4;
/** How long it takes to come out of the pits, and to peel back in. */
export const SC_TRANSIT_S = 5;

/**
 * Where the safety car is at `t`, or null when it is not on track.
 *
 * HONESTY NOTE: FastF1 has no safety-car telemetry — it is not a driver in
 * `pos_data`, so there is no measured path for it. Its position here is
 * DERIVED: it runs where the leader will be `SC_LEAD_S` seconds from now,
 * which puts it on the racing line just ahead of the pack, exactly where it
 * actually is. The shape of the path is real (it is the leader's own), the
 * gap is a constant.
 *
 * It also comes and goes properly rather than blinking on: at deployment it
 * emerges from the pit exit and closes on the field over SC_TRANSIT_S, and at
 * the end it peels back in — which is what a safety car does.
 *
 * Only for code '4', a real safety car. A VIRTUAL safety car ('6') puts no
 * car on track at all; it is a delta every driver has to respect. Drawing one
 * would be inventing a vehicle that was never there.
 */
/** Index of the track point nearest (x, y). The outline is ~500 points. */
const nearestTrackIndex = (pts, x, y) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].X - x, dy = pts[i].Y - y;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = i; }
    }
    return bi;
};

export const safetyCarAt = (race, t, span, leaderNum) => {
    if (!span || span.code !== '4') return null;
    const leader = race.byNumber[leaderNum];
    if (!leader) return null;

    const ahead = carAt(leader, race, Math.min(t + SC_LEAD_S, race.duration));
    const pts = race.track;
    const exit = race.pitLane.length ? race.pitLane[race.pitLane.length - 1] : null;
    if (!pts?.length || !exit) return { x: ahead.x, y: ahead.y };

    const since = t - span.start;
    const until = span.end - t;
    let k = 1;
    if (since < SC_TRANSIT_S) k = Math.max(0, since) / SC_TRANSIT_S;
    else if (until < SC_TRANSIT_S) k = Math.max(0, until) / SC_TRANSIT_S;
    if (k >= 1) return { x: ahead.x, y: ahead.y };

    // ALONG THE TRACK, not across the map. Interpolating x/y straight from the
    // pit exit to the leader drew a chord through the middle of the circuit —
    // the safety car appeared in open space and flew across the infield, which
    // is what "coming out of nowhere" looked like. Both ends sit on the racing
    // line (the derived lane's ends measure 0 units from it), so walking the
    // outline between them keeps the car on the road the whole way out and the
    // whole way back in.
    const n = pts.length;
    const ei = nearestTrackIndex(pts, exit.X, exit.Y);
    const li = nearestTrackIndex(pts, ahead.x, ahead.y);
    const forward = (li - ei + n) % n;
    const p = pts[Math.round(ei + forward * k) % n];
    return { x: p.X, y: p.Y };
};

/** The driver number leading on `lap`, or null. */
export const leaderAt = (byLap, lap) => {
    let l = lap;
    while (l > 1 && !byLap.has(l)) l--;
    return byLap.get(l)?.[0] || null;
};

// --- continuous intervals -------------------------------------------------
/**
 * Fractional lap a driver has reached at time `t`, from their own crossings.
 * `rows` is [[lap, timeTheyCompletedIt], ...].
 */
const progressOf = (rows, t) => {
    if (!rows.length) return 0;
    const last = rows[rows.length - 1];
    if (t >= last[1]) return last[0];
    if (t <= rows[0][1]) return rows[0][0] * (t / Math.max(rows[0][1], 1e-6));
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (rows[mid][1] <= t) lo = mid; else hi = mid - 1;
    }
    const [l0, t0] = rows[lo];
    const [l1, t1] = rows[Math.min(lo + 1, rows.length - 1)];
    const f = (t - t0) / Math.max(t1 - t0, 1e-6);
    return l0 + (l1 - l0) * f;
};

/** When a driver reached fractional lap `p` — the inverse of progressOf. */
const timeAtProgress = (rows, p) => {
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    if (p >= last[0]) return last[1];
    if (p <= rows[0][0]) return rows[0][1] * (p / Math.max(rows[0][0], 1e-6));
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (rows[mid][0] <= p) lo = mid; else hi = mid - 1;
    }
    const [l0, t0] = rows[lo];
    const [l1, t1] = rows[Math.min(lo + 1, rows.length - 1)];
    const f = (p - l0) / Math.max(l1 - l0, 1e-6);
    return t0 + (t1 - t0) * f;
};

/**
 * Gap to the leader for every driver AT TIME t, updating continuously.
 *
 * `gapsAtLap` only changes when cars cross the line, so the tower froze for a
 * whole lap at a time. This is the proper question instead: how long ago did
 * the leader pass the point this driver has just reached? Each driver's
 * fractional lap comes from their own crossings, and the leader's time at that
 * same fractional lap is read back off the leader's — so the number means
 * "seconds behind on the road", which is what a timing tower shows.
 *
 * The leader is whoever has the most progress, not a lookup: that keeps the
 * reference self-consistent at the moment the lead changes.
 */
/**
 * The live classification AND the gaps behind it, from one pass.
 *
 * These have to come from the same calculation. Ordering rows by the last
 * COMPLETED lap while showing gaps computed per second put the two in
 * disagreement for most of the race — measured, 718 samples where a lower row
 * showed a smaller gap than the row above it, because a car had passed on the
 * road and the order would not catch up until the next time it crossed the
 * line. Position on the road is what a timing tower reports, so both come from
 * progress.
 */
export const standingsAt = (race, t) => {
    const gaps = intervalsAt(race, t);
    const order = Object.keys(race.crossings).sort((a, b) => {
        const ga = gaps.get(a), gb = gaps.get(b);
        if (ga == null && gb == null) {
            return (race.byNumber[a]?.grid || 99) - (race.byNumber[b]?.grid || 99);
        }
        if (ga == null) return 1;
        if (gb == null) return -1;
        return ga - gb;
    });
    return { order, gaps };
};

export const intervalsAt = (race, t) => {
    // Racing time, not wall time — see makeRacingClock.
    const rt = race.toRacing ? race.toRacing(t) : t;
    const prog = new Map();
    let leadRows = null;
    let best = -Infinity;
    for (const [num, rows] of Object.entries(race.crossings)) {
        const p = progressOf(rows, rt);
        prog.set(num, p);
        if (p > best) { best = p; leadRows = rows; }
    }
    const out = new Map();
    for (const [num, rows] of Object.entries(race.crossings)) {
        // Progress of zero means the car has not registered any timing yet —
        // at lights-out, or for a driver who never reached a sector marker.
        // Reporting 0 seconds there showed all twenty cars as LEADER.
        const p = prog.get(num);
        if (!rows.length || !(p > 0)) { out.set(num, null); continue; }
        const tl = leadRows ? timeAtProgress(leadRows, p) : null;
        out.set(num, tl == null ? null : Math.max(0, rt - tl));
    }
    return out;
};

/**
 * Seconds to the car AHEAD, per driver.
 *
 * The tower has always shown the gap to the leader, which is the wrong number
 * for most of a race: it says Alonso is 10 s behind Verstappen when what the
 * viewer wants to know is that he is 0.4 s behind Hamilton. Broadcast carries
 * both and lets you switch.
 *
 * It falls straight out of the leader gaps. Each one is "how long ago was the
 * leader standing where I am now", so the DIFFERENCE between two consecutive
 * cars is how long apart those two cars are — which stays true for a car a lap
 * down, because both numbers are measured against the same reference.
 */
export const aheadAt = (race, t) => {
    const { order, gaps } = standingsAt(race, t);
    const out = new Map();
    let prev = null;
    for (const num of order) {
        const g = gaps.get(num);
        if (g == null) { out.set(num, null); continue; }
        out.set(num, prev == null ? null : Math.max(0, g - prev));
        prev = g;
    }
    return out;
};

// --- pit stops ------------------------------------------------------------
/**
 * Longest a tyre change can be and still be reported as one, in seconds.
 *
 * Measured across four races, a real stop is 2.7-6 s stationary and the median
 * is 3.7. Past this it is a repair, a penalty being served, or a red-flag
 * window where the whole field is parked — Verstappen's three at Australia
 * were stationary for 905, 847 and 1839 seconds.
 */
export const STOP_MAX_S = 20;

/**
 * The seconds worth printing next to a stop, or null when there are none.
 *
 * One rule, in one place, because two screens show it: the tower badge while
 * a car is in the box, and the strategy chart's fastest-stop line. They must
 * agree about what counts, or the race has two different fastest stops.
 */
export const namedStop = (stopped, redFlag) => (
    !redFlag && stopped != null && stopped > 0 && stopped <= STOP_MAX_S
        ? stopped : null
);

// --- strategy -------------------------------------------------------------
/**
 * Every driver's race SO FAR: the tyres they have run, and where they stopped.
 *
 * `throughLap` is the whole point. Drawn complete from the first frame, the
 * chart is a spoiler — it shows the winner's three-stop and who retired while
 * the replay is still on lap two — and it is not what a strategy screen is
 * for. It fills in as the race runs, exactly like the one on television.
 *
 * Order is the order AT THAT LAP, not at the flag, for the same reason. Cars
 * that are out drop to the bottom, latest first, which keeps the running order
 * readable at the top where it is being watched.
 *
 * A CAR A LAP DOWN NEVER CROSSES THE LINE ON THE FINAL LAP, so its position
 * comes from the last lap it did complete rather than from the current one:
 * measured at Abu Dhabi 2023, Bottas and Magnussen both finished and both came
 * out as retirements when the final lap alone was read.
 *
 * AND AT THE FLAG THE CLASSIFICATION WINS. Per-lap positions are the order
 * DURING a lap, so the last one predates whatever happened on it: the same
 * race has Perez second on lap 58, because Leclerc and Russell both passed him
 * on it. The chart is drawn directly above the classification table and has to
 * agree with it.
 *
 * Stops carry the time the car was STATIONARY, not the pit-lane transit: 2.7 s
 * is a pit stop, the 24 s window around it is the time it cost. A red-flag
 * window is neither, so it is flagged rather than given a number, because
 * "905.2" against a driver's name is not a pit stop by any reading.
 */
export const strategyRows = (race, throughLap = race.totalLaps) => {
    const total = race.totalLaps || 1;
    const now = Math.max(1, Math.min(throughLap, total));
    const flag = now >= total;

    const seenTo = new Map();      // number -> last lap they appear on, so far
    const posAt = new Map();       // number -> position on that lap
    for (const [lap, num, pos] of race.order) {
        if (lap > now) continue;
        if (!seenTo.has(num) || lap > seenTo.get(num)) {
            seenTo.set(num, lap);
            posAt.set(num, pos);
        }
    }

    const rows = race.cars.map((c) => {
        // Out is asked of the lap, not the second, because this chart is drawn
        // in whole laps: a car that stops on lap 12 raced lap 12, and drops
        // out of the order from 13.
        const goneOn = Number.isFinite(c.outAt) ? lapAt(race, c.outAt) : Infinity;
        const out = goneOn < now;
        return {
            number: c.number,
            code: c.code,
            color: c.color,
            grid: c.grid ?? null,
            out,
            pos: flag && c.finish != null
                ? c.finish
                : (out ? null : (posAt.get(c.number) ?? null)),
            lastLap: seenTo.get(c.number) ?? 0,
            stints: (race.stints[c.number] || [])
                .filter((x) => x.from <= now)
                .map((x) => ({ ...x, to: Math.min(x.to, now) })),
            stops: pitsFor(race, c.number)
                .filter((p) => p.lap <= now)
                .map((p) => ({
                    lap: p.lap,
                    stopped: p.red_flag ? null : p.stopped,
                    redFlag: !!p.red_flag,
                })),
        };
    });

    rows.sort((a, b) => {
        if (a.pos != null && b.pos != null) return a.pos - b.pos;
        if (a.pos != null) return -1;
        if (b.pos != null) return 1;
        // Out latest, listed first — and where two cars went out on the same
        // lap, the one that was ahead when they did.
        return (b.lastLap - a.lastLap)
            || ((posAt.get(a.number) ?? 99) - (posAt.get(b.number) ?? 99));
    });
    return rows;
};

/**
 * Every driver's position, lap by lap — the race trace.
 *
 * The shape of the whole race in one picture: who climbed, who fell away,
 * where a safety car shuffled the pack. The strategy chart underneath says
 * what tyres they did it on, so the two read as one story from either side.
 *
 * Like the strategy chart it fills in as the race runs, and for the same
 * reason. A line that already reaches lap 58 has told you the result.
 *
 * A line simply STOPS where a driver does. Carrying it along the bottom would
 * draw a retirement as a car still circulating in last place, which is a
 * different thing that also happens.
 */
export const traceRows = (race, throughLap = race.totalLaps) => {
    const total = race.totalLaps || 1;
    const now = Math.max(1, Math.min(throughLap, total));

    const byNum = new Map();
    for (const [lap, num, pos] of race.order) {
        if (lap > now) continue;
        if (!byNum.has(num)) byNum.set(num, []);
        byNum.get(num).push([lap, pos]);
    }

    const rows = [];
    for (const c of race.cars) {
        const pts = byNum.get(c.number);
        if (!pts || pts.length < 1) continue;
        pts.sort((a, b) => a[0] - b[0]);
        rows.push({
            number: c.number,
            code: c.code,
            color: c.color,
            points: pts,
            last: pts[pts.length - 1],
        });
    }
    // Drawn in reverse order of their current position, so the leader's line
    // is painted last and stays on top where the eye goes.
    rows.sort((a, b) => b.last[1] - a.last[1]);
    return rows;
};

// --- the starting grid ----------------------------------------------------
/** How long the grid formation takes to dissolve into the real positions. */
export const GRID_BLEND_S = 3;

/**
 * Synthesised starting-grid slots, by driver number.
 *
 * At t = 0 the measured positions ARE the grid — but a real grid is 8 m
 * between rows, and at map scale that is under half a pixel, so twenty cars
 * render as one blob. Same problem as the pit lane, same answer: keep the
 * arrangement real (grid order, two staggered columns, on the racing line
 * behind the start) and exaggerate the spacing until it can be read.
 *
 * Offsets are a fraction of the circuit's own extent, so this works on any
 * track rather than being tuned in metres for one.
 */
export const gridSlots = (race) => {
    const pts = race.track;
    const out = new Map();
    if (!pts?.length) return out;

    // TWO DIFFERENT UNITS, and mixing them is the trap. `D` is lap distance in
    // METRES (0..5225 at Melbourne) while X/Y are FastF1 position units of
    // ~0.1 m (a 14710 x 17412 box). Sizing the row gap off the X/Y extent and
    // then using it as a D distance gave 410 m per row — 8% of the lap each,
    // so ten rows scattered the field around 79% of the circuit instead of
    // forming a grid.
    //
    // So: ROW is a fraction of the LAP (a D distance), LAT is a fraction of
    // the X/Y extent (a position offset).
    const xs = pts.map((p) => p.X);
    const ys = pts.map((p) => p.Y);
    const extent = Math.hypot(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
    );
    const total = Math.max(...pts.map((p) => p.D)) || 1;
    const ROW = total * 0.006;       // ~31 m per row: 10 rows over 6% of the lap
    const LAT = extent * 0.005;      // stagger either side of the racing line

    // Point and unit normal at a lap distance.
    const at = (dist) => {
        const d = ((dist % total) + total) % total;
        let bi = 0, bd = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const g = Math.abs(pts[i].D - d);
            if (g < bd) { bd = g; bi = i; }
        }
        const a = pts[Math.max(0, bi - 2)];
        const b = pts[Math.min(pts.length - 1, bi + 2)];
        const tx = b.X - a.X, ty = b.Y - a.Y;
        const m = Math.hypot(tx, ty) || 1;
        return { x: pts[bi].X, y: pts[bi].Y, nx: -ty / m, ny: tx / m };
    };

    // A GRID POSITION OF ZERO IS NOT MISSING DATA — it is a pit-lane start,
    // and F1 records it as 0. Treating it as falsy dropped Ocon out of the
    // Azerbaijan sprint grid entirely. He starts from the pit lane, so that is
    // where he is put; with no derived lane, he lines up behind the last row.
    const maxRow = Math.ceil(
        Math.max(1, ...race.cars.map((c) => c.grid || 0)) / 2,
    );
    for (const c of race.cars) {
        const g = c.grid;
        if (g == null || g < 0) continue;
        if (g === 0) {
            const lane = race.pitLane;
            if (lane?.length) {
                out.set(c.number, { x: lane[0].X, y: lane[0].Y });
            } else {
                const p = at(total - (maxRow + 1) * ROW);
                out.set(c.number, { x: p.x, y: p.y });
            }
            continue;
        }
        const row = Math.ceil(g / 2);
        const side = g % 2 === 1 ? -1 : 1;      // pole on one side, P2 the other
        const p = at(total - row * ROW);        // behind the start line
        out.set(c.number, {
            x: p.x + p.nx * side * LAT,
            y: p.y + p.ny * side * LAT,
        });
    }
    return out;
};
