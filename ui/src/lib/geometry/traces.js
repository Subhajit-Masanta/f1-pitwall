/**
 * 📄 geometry/traces.js — the distance-axis charts.
 *
 * Pure geometry: track data in, SVG path strings out. Everything is drawn in a
 * fixed 1000x100 viewBox and stretched with preserveAspectRatio="none", which
 * makes distance→x a trivial ratio and keeps it resolution-independent.
 */

/**
 * Pedal geometry for ONE driver, from their own telemetry channels.
 *
 * Both sides of a head-to-head go through this same function so neither gets a
 * flattering treatment: same sampling, same scales, same brake definition.
 *
 * Braking is deceleration gated by the pedal flag — FastF1's Brake channel is
 * boolean, so it says whether the pedal is down but not how hard; the g channel
 * supplies the magnitude that gives the spike-then-bleed shape.
 */
export const buildPedalGeom = (arrays, W) => {
    if (!arrays) return null;
    const { d, thr, brk, gl } = arrays;
    const n = d.length;
    if (n < 2) return null;

    const total = d[n - 1] || 1;
    const PH = 100, PAD = 2;
    const x = (i) => (d[i] / total) * W;
    const yT = (v) => PAD + (1 - Math.max(0, Math.min(100, v)) / 100) * (PH - PAD * 2);

    let peakG = 0;
    for (let i = 0; i < n; i++) {
        if (brk[i] && -gl[i] > peakG) peakG = -gl[i];
    }
    peakG = peakG || 5;

    const step = Math.max(1, Math.floor(n / 600));
    const tp = [];
    for (let i = 0; i < n; i += step) tp.push(`${x(i).toFixed(1)},${yT(thr[i]).toFixed(1)}`);
    const throttlePath = `M ${tp.join(' L ')}`;

    // one filled shape per braking event, so the fill reads as discrete peaks
    const shapes = [];
    let i = 0;
    while (i < n) {
        if (!brk[i]) { i++; continue; }
        let j = i;
        while (j + 1 < n && brk[j + 1]) j++;
        if (j - i >= 1) {
            const body = [];
            for (let k = i; k <= j; k++) {
                const inten = Math.min(1, Math.max(0, -gl[k]) / peakG);
                body.push(`${x(k).toFixed(1)},${yT(inten * 100).toFixed(1)}`);
            }
            const line = `M ${x(i).toFixed(1)},${PH} L ${body.join(' L ')} L ${x(j).toFixed(1)},${PH}`;
            shapes.push({ line, area: `${line} Z` });
        }
        i = j + 1;
    }

    return { throttlePath, brakeShapes: shapes, peakG, W, H: PH };
};


/**
 * Speed against lap distance, plus the pedal band beneath it.
 *
 * Built from the track outline (which carries D, S, T and A) rather than the
 * replay telemetry, so the charts are on screen as soon as the circuit loads
 * instead of waiting for a driver's lap to be fetched.
 */
export const buildSpeedTrace = (trackData, sectorBoundaries) => {
    const pts = (trackData?.track_points || [])
        .filter((p) => Number.isFinite(p.D) && Number.isFinite(p.S));
    if (pts.length < 2) return null;

    const W = 1000, H = 100;
    const total = trackData.total_distance || pts[pts.length - 1].D || 1;
    const maxS = Math.max(...pts.map((p) => p.S)) || 1;
    const minS = Math.min(...pts.map((p) => p.S));

    const x = (d) => (d / total) * W;
    const y = (sp) => H - (sp / maxS) * H;

    const line = `M ${pts.map((p) => `${x(p.D).toFixed(1)},${y(p.S).toFixed(1)}`).join(' L ')}`;
    const area = `${line} L ${W},${H} L 0,${H} Z`;

    const b = sectorBoundaries;
    const sectorX = b ? [x(b.sector1_end), x(b.sector2_end)] : [];
    const drsBars = (trackData.drs_zones || [])
        .map((z) => ({ x1: x(z.start), x2: x(z.end) }))
        .filter((z) => z.x2 > z.x1);

    // Braking: redraw just those stretches of the trace in red, on top of
    // the white line. Far more readable than another band of bars — you see
    // the brake point land exactly where the speed starts to fall off.
    const brakePaths = (trackData.brake_zones || [])
        .map((z) => {
            const seg = pts.filter((p) => p.D >= z.start && p.D <= z.end);
            if (seg.length < 2) return null;
            return `M ${seg.map((p) => `${x(p.D).toFixed(1)},${y(p.S).toFixed(1)}`).join(' L ')}`;
        })
        .filter(Boolean);

    // --- pedals ------------------------------------------------------
    // Throttle owns the FULL height of the band, not half of it. A quali
    // lap sits at 100% throttle ~70% of the time, so a half-height area
    // renders as a solid slab with notches — all ink, no information. Over
    // the full height each lift travels twice as far and the shape reads as
    // a trace again.
    //
    // Braking is a translucent column standing behind the trace rather than
    // a mirrored area below it: FastF1's Brake channel is boolean (on/off,
    // no pressure), so it has no magnitude to plot — what matters is WHERE
    // it is and how it overlaps the throttle coming back on.
    const PH = 100;                       // pedal viewBox height
    const PAD = 2;                        // keeps the stroke off both edges
    const tp = pts.filter((p) => Number.isFinite(p.T));
    let throttleArea = null, throttleLine = null;
    if (tp.length > 1) {
        const yT = (t) => PAD + (1 - Math.max(0, Math.min(100, t)) / 100) * (PH - PAD * 2);
        const seq = tp.map((p) => `${x(p.D).toFixed(1)},${yT(p.T).toFixed(1)}`).join(' L ');
        throttleLine = `M ${seq}`;
        throttleArea = `${throttleLine} L ${W},${PH} L 0,${PH} Z`;
    }
    // Braking, as actual magnitude rather than an on/off block.
    //
    // Two channels combined, each doing the job it can honestly do:
    //   · brake_zones says WHETHER the pedal is pressed (FastF1's Brake is
    //     boolean, so that is all it can tell us)
    //   · longitudinal g says HOW HARD, because deceleration is measured
    //
    // Gating the g trace by the zones means a lift-and-coast doesn't draw as
    // braking, and the shape inside a zone is the real one: a spike at the
    // brake point bleeding off into the apex. Filling THIS trace is safe
    // where filling throttle wasn't — braking is zero for most of a lap, so
    // the fill reads as discrete peaks instead of a slab.
    const peakG = trackData.peak_decel_g || 5;
    const zones = trackData.brake_zones || [];
    // One shape per zone rather than a single trace across the lap — a
    // continuous line would sit at zero between zones and draw a red hairline
    // along the floor for the whole lap.
    const yB = (v) => PAD + (1 - v) * (PH - PAD * 2);
    const brakeShapes = zones.map((z) => {
        const seg = pts.filter((p) => Number.isFinite(p.A) && p.D >= z.start && p.D <= z.end);
        if (seg.length < 2) return null;
        const xs = seg.map((p) => x(p.D));
        const body = seg.map((p, i) => {
            const inten = Math.min(1, Math.max(0, -p.A) / peakG);
            return `${xs[i].toFixed(1)},${yB(inten).toFixed(1)}`;
        }).join(' L ');
        // start and finish on the floor so each zone reads as its own peak
        const line = `M ${xs[0].toFixed(1)},${PH} L ${body} L ${xs[xs.length - 1].toFixed(1)},${PH}`;
        return { line, area: `${line} Z` };
    }).filter(Boolean);

    const pedal = throttleArea
        ? { throttleArea, throttleLine, brakeShapes, peakG,
            W, H: PH, top: PAD, sectorX }
        : null;

    return { line, area, W, H, total, maxS, minS, sectorX, drsBars, brakePaths, pedal };
};
