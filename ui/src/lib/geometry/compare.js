/**
 * 📄 geometry/compare.js — head-to-head geometry.
 *
 * One pedal panel per driver plus the delta across the lap. Both drivers go
 * through the same builder and are plotted against their OWN lap fraction
 * rather than absolute metres: laps don't measure identically, and fraction is
 * what makes the final delta land exactly on the official gap.
 */
import { buildPedalGeom } from './traces';

/**
 * How many mini-sectors the lap is cut into for the dominance map.
 *
 * F1 uses marker-based mini-sectors, roughly this many on a normal circuit.
 * The number is a readability trade, not a measurement: too few and a lap
 * reads as three blocks, too many and every corner flickers between drivers
 * over a hundredth of a second.
 */
export const MINI_SECTORS = 24;

/**
 * Who was faster through each piece of the lap.
 *
 * The signature head-to-head graphic: the circuit coloured by whoever carried
 * more speed through each mini-sector, so a lap time becomes a map of WHERE it
 * was won rather than a single number at the flag.
 *
 * Measured in lap FRACTION, not metres, for the same reason the delta is: two
 * drivers' laps do not measure identically (1.2 m apart for Verstappen and
 * Leclerc at Bahrain), so comparing absolute distance compares subtly
 * different points. Each sector's time is the difference of the two drivers'
 * elapsed times at its ends, which is exactly what a mini-sector time is.
 *
 * `a` and `b` are anything with `timeAtFraction` — the reference lookup and
 * the ghost. Returns one entry per sector, in lap order.
 */
export const dominance = (a, b, count = MINI_SECTORS) => {
    if (!a?.timeAtFraction || !b?.timeAtFraction || count < 1) return [];
    const out = [];
    let prevA = a.timeAtFraction(0);
    let prevB = b.timeAtFraction(0);
    for (let i = 1; i <= count; i++) {
        const f = i / count;
        const ta = a.timeAtFraction(f);
        const tb = b.timeAtFraction(f);
        const dtA = ta - prevA;
        const dtB = tb - prevB;
        prevA = ta;
        prevB = tb;
        out.push({
            from: (i - 1) / count,
            to: f,
            // A dead heat to the millisecond is not a win for anybody; it is
            // also vanishingly rare, so it costs nothing to say so.
            winner: dtA === dtB ? null : (dtA < dtB ? 'a' : 'b'),
            gap: Math.abs(dtA - dtB),
        });
    }
    return out;
};

/** Sectors won each, for the caption. */
export const dominanceTally = (sectors) => sectors.reduce(
    (acc, s) => {
        if (s.winner === 'a') acc.a += 1;
        else if (s.winner === 'b') acc.b += 1;
        return acc;
    },
    { a: 0, b: 0 },
);

export const buildCompareTrace = ({ driver, ghost, refLookup, speedTrace }) => {
    if (!ghost?.arrays || !refLookup?.arrays || !speedTrace) return null;
    const { W } = speedTrace;

    // Both panels come from the SAME builder and the same channels, so
    // neither driver gets a different treatment.
    const a = buildPedalGeom(refLookup.arrays, W);
    const b = buildPedalGeom(ghost.arrays, W);
    if (!a || !b) return null;

    // Delta across the lap, sampled evenly in lap fraction.
    const N = 400;
    const vals = new Float64Array(N + 1);
    let deltaMax = 0;
    for (let i = 0; i <= N; i++) {
        const f = i / N;
        vals[i] = ghost.timeAtFraction(f) - refLookup.timeAtFraction(f);
        const m = Math.abs(vals[i]);
        if (m > deltaMax) deltaMax = m;
    }
    deltaMax = Math.max(0.1, Math.ceil(deltaMax * 10) / 10);

    const DH = 100, DPAD = 6;
    const half = DH / 2 - DPAD;
    const pts = [];
    for (let i = 0; i <= N; i++) {
        const x = ((i / N) * W).toFixed(1);
        // positive (the compared driver losing) rises above the centre line
        const y = (DH / 2 - (vals[i] / deltaMax) * half).toFixed(1);
        pts.push(`${x},${y}`);
    }
    const deltaPath = `M ${pts.join(' L ')}`;

    return {
        panels: [
            { code: driver?.code || 'REF', team: driver?.team, color: driver?.color || '#9E9E9E', geom: a },
            { code: ghost.code, team: ghost.team, color: ghost.color, geom: b },
        ],
        deltaPath,
        deltaArea: `${deltaPath} L ${W},${DH / 2} L 0,${DH / 2} Z`,
        deltaMax,
        DH,
        code: ghost.code,
        color: ghost.color,
    };
};
