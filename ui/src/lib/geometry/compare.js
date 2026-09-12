/**
 * 📄 geometry/compare.js — head-to-head geometry.
 *
 * One pedal panel per driver plus the delta across the lap. Both drivers go
 * through the same builder and are plotted against their OWN lap fraction
 * rather than absolute metres: laps don't measure identically, and fraction is
 * what makes the final delta land exactly on the official gap.
 */
import { buildPedalGeom } from './traces';

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
