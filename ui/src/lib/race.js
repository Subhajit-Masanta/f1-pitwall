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

    return {
        race: payload.race,
        circuit: payload.circuit,
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
        crossings: payload.crossings || {},
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

export const messagesUpTo = (race, t, limit = 4) => {
    const out = [];
    for (let i = race.messages.length - 1; i >= 0; i--) {
        const m = race.messages[i];
        if (m.t == null || m.t > t) continue;
        if (!SHOWN.has(m.cat)) continue;
        out.push(m);
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
export const safetyCarAt = (race, t, span, leaderNum) => {
    if (!span || span.code !== '4') return null;
    const leader = race.byNumber[leaderNum];
    if (!leader) return null;

    const ahead = carAt(leader, race, Math.min(t + SC_LEAD_S, race.duration));
    const exit = race.pitLane.length ? race.pitLane[race.pitLane.length - 1] : null;
    if (!exit) return { x: ahead.x, y: ahead.y };

    const blend = (k) => ({
        x: exit.X + (ahead.x - exit.X) * k,
        y: exit.Y + (ahead.y - exit.Y) * k,
    });

    const since = t - span.start;
    const until = span.end - t;
    if (since < SC_TRANSIT_S) return blend(Math.max(0, since) / SC_TRANSIT_S);
    if (until < SC_TRANSIT_S) return blend(Math.max(0, until) / SC_TRANSIT_S);
    return { x: ahead.x, y: ahead.y };
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
export const intervalsAt = (race, t) => {
    const prog = new Map();
    let leadRows = null;
    let best = -Infinity;
    for (const [num, rows] of Object.entries(race.crossings)) {
        const p = progressOf(rows, t);
        prog.set(num, p);
        if (p > best) { best = p; leadRows = rows; }
    }
    const out = new Map();
    for (const [num, rows] of Object.entries(race.crossings)) {
        // Before a driver has completed a lap there is no timing reference at
        // all, so there is no gap to report. Returning 0 there showed every
        // one of the twenty cars as LEADER for the whole of lap one.
        if (!rows.length || t < rows[0][1]) { out.set(num, null); continue; }
        const tl = leadRows ? timeAtProgress(leadRows, prog.get(num)) : null;
        out.set(num, tl == null ? null : Math.max(0, t - tl));
    }
    return out;
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

    for (const c of race.cars) {
        const g = c.grid;
        if (!g || g < 1) continue;
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
