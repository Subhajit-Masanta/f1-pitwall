/**
 * 📄 ghost.js — the second car in a head-to-head.
 *
 * Two different questions get asked of the same telemetry, and they need
 * different lookups:
 *
 *   · WHERE is the ghost right now?  → its position at the same elapsed TIME.
 *     Both cars start their lap together, so the gap you see on track is the
 *     real one.
 *
 *   · HOW FAR ahead or behind is it? → the time the ghost took to reach the
 *     leader's current DISTANCE, minus the leader's elapsed time. Positive
 *     means the ghost got there later, i.e. it is losing.
 *
 * That second one is why the true-Distance axis mattered: a delta is only
 * meaningful if both cars agree on what "the same point on the lap" means.
 *
 * Everything is flattened into typed arrays up front, so a frame costs one
 * interpolation and one binary search rather than an array scan.
 */

const bisect = (arr, v) => {
    // index of the last element <= v (clamped to [0, len-2])
    let lo = 0, hi = arr.length - 1;
    if (v <= arr[0]) return 0;
    if (v >= arr[hi]) return hi - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (arr[mid] <= v) lo = mid; else hi = mid - 1;
    }
    return lo;
};

const lerpAt = (xs, ys, v, i) => {
    const x0 = xs[i], x1 = xs[i + 1];
    const span = x1 - x0;
    const f = span > 0 ? (v - x0) / span : 0;
    return ys[i] + (ys[i + 1] - ys[i]) * f;
};

/**
 * @param telemetry rotated frames: { time, distance, x, y, speed }
 * @param meta      { code, name, team, color, lapTime }
 */
export const buildGhost = (telemetry, meta) => {
    const n = telemetry?.length || 0;
    if (n < 2) return null;

    const t = new Float64Array(n);
    const d = new Float64Array(n);
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    const spd = new Float64Array(n);
    const thr = new Float64Array(n);
    const brk = new Float64Array(n);      // FastF1's boolean pedal flag
    const gl = new Float64Array(n);       // longitudinal g (- = braking)

    for (let i = 0; i < n; i++) {
        const p = telemetry[i];
        t[i] = p.time;
        d[i] = p.distance;
        x[i] = p.x;
        // Same Y flip the main car gets in useRaceLoop — SVG grows downward.
        y[i] = -p.y;
        spd[i] = p.speed;
        thr[i] = p.throttle <= 1 ? p.throttle * 100 : p.throttle;
        brk[i] = (p.brake <= 1 ? p.brake * 100 : p.brake) > 50 ? 1 : 0;
        gl[i] = p.g ?? 0;
    }

    return {
        ...meta,
        n,
        totalTime: t[n - 1],
        totalDist: d[n - 1],
        // Raw channels, for drawing this driver's traces over the reference's.
        arrays: { t, d, x, y, spd, thr, brk, gl },

        /** Where the ghost is at elapsed time `tt`. */
        posAtTime(tt) {
            const i = bisect(t, tt);
            return {
                x: lerpAt(t, x, tt, i),
                y: lerpAt(t, y, tt, i),
                speed: lerpAt(t, spd, tt, i),
                dist: lerpAt(t, d, tt, i),
            };
        },

        /**
         * When the ghost reached the same PROPORTION of its lap, 0..1.
         *
         * Fraction rather than absolute metres because two drivers' laps don't
         * measure identically — different lines give slightly different totals
         * (1.2m apart for VER/LEC at Bahrain). Comparing absolute distance
         * therefore compares subtly different points and leaves the delta wrong
         * at the flag; comparing proportion makes the final delta land exactly
         * on the official lap-time gap.
         */
        timeAtFraction(f) {
            const dd = Math.max(0, Math.min(1, f)) * d[n - 1];
            const i = bisect(d, dd);
            return lerpAt(d, t, dd, i);
        },

        /** Has the ghost already finished by time `tt`? */
        finishedBy(tt) { return tt >= t[n - 1]; },
    };
};
