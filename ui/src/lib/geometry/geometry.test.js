import { describe, it, expect } from 'vitest';
import { applyRotation, rotateFrames } from './rotation';
import { buildSpeedTrace, buildPedalGeom } from './traces';
import { dominance, dominanceTally, MINI_SECTORS } from './compare';
import { buildMapLayout } from './track';

// --- fixtures --------------------------------------------------------------

/** A circular circuit with a speed profile that dips once, like a corner. */
const trackData = (n = 300, total = 5000) => {
    const pts = Array.from({ length: n }, (_, i) => {
        const f = i / (n - 1);
        const th = f * 2 * Math.PI;
        const corner = Math.abs(f - 0.5) < 0.06;         // one slow section
        return {
            X: 1000 * Math.cos(th),
            Y: 1000 * Math.sin(th),
            D: f * total,
            S: corner ? 90 : 300,
            T: corner ? 0 : 100,
            A: corner ? -4.5 : 0.8,
        };
    });
    return {
        track_points: pts,
        total_distance: total,
        sector1_end: total * 0.33,
        sector2_end: total * 0.66,
        drs_zones: [{ start: total * 0.05, end: total * 0.2 }],
        brake_zones: [{ start: total * 0.44, end: total * 0.56 }],
        peak_decel_g: 4.5,
        corners: Array.from({ length: 10 }, (_, i) => {
            const th = (i / 10) * 2 * Math.PI;
            return { n: i + 1, letter: '', X: 1000 * Math.cos(th), Y: 1000 * Math.sin(th) };
        }),
        rotation: 0,
    };
};

const bounds = (t) => ({
    sector1_end: t.sector1_end,
    sector2_end: t.sector2_end,
    total_distance: t.total_distance,
});

// --- rotation --------------------------------------------------------------

describe('rotation', () => {
    it('is the identity at 0°', () => {
        expect(applyRotation(3, 4, 0).x).toBeCloseTo(3, 9);
        expect(applyRotation(3, 4, 0).y).toBeCloseTo(4, 9);
    });

    it('turns +x into +y at 90°', () => {
        const r = applyRotation(1, 0, 90);
        expect(r.x).toBeCloseTo(0, 9);
        expect(r.y).toBeCloseTo(1, 9);
    });

    it('preserves length', () => {
        const r = applyRotation(3, 4, 37);
        expect(Math.hypot(r.x, r.y)).toBeCloseTo(5, 9);
    });

    it('keeps every other channel on a frame', () => {
        // The bug this guards: rotation rebuilt frames and silently dropped the
        // speed / throttle / g channels, so traces came out blank.
        const [f] = rotateFrames([{ x: 1, y: 0, speed: 300, throttle: 100, g: -2, time: 5 }], 90);
        expect(f.speed).toBe(300);
        expect(f.throttle).toBe(100);
        expect(f.g).toBe(-2);
        expect(f.time).toBe(5);
    });
});

// --- speed trace -----------------------------------------------------------

describe('buildSpeedTrace', () => {
    const t = trackData();
    const trace = buildSpeedTrace(t, bounds(t));

    it('returns null without enough points', () => {
        expect(buildSpeedTrace({ track_points: [] }, null)).toBeNull();
    });

    it('spans the full viewBox width', () => {
        const xs = trace.line.replace('M ', '').split(' L ').map((p) => +p.split(',')[0]);
        expect(Math.min(...xs)).toBeCloseTo(0, 1);
        expect(Math.max(...xs)).toBeCloseTo(trace.W, 1);
    });

    it('reports the real speed range', () => {
        expect(trace.maxS).toBe(300);
        expect(trace.minS).toBe(90);
    });

    it('closes the area path back to the floor', () => {
        expect(trace.area.endsWith(`L ${trace.W},${trace.H} L 0,${trace.H} Z`)).toBe(true);
    });

    it('places sector dividers inside the chart', () => {
        expect(trace.sectorX).toHaveLength(2);
        trace.sectorX.forEach((x) => {
            expect(x).toBeGreaterThan(0);
            expect(x).toBeLessThan(trace.W);
        });
        expect(trace.sectorX[0]).toBeLessThan(trace.sectorX[1]);
    });

    it('keeps DRS bars inside the chart', () => {
        trace.drsBars.forEach((z) => {
            expect(z.x1).toBeGreaterThanOrEqual(0);
            expect(z.x2).toBeLessThanOrEqual(trace.W);
            expect(z.x2).toBeGreaterThan(z.x1);
        });
    });

    it('draws braking only where a brake zone exists', () => {
        expect(trace.brakePaths.length).toBe(1);
    });
});

// --- pedal geometry --------------------------------------------------------

describe('buildPedalGeom', () => {
    const n = 200;
    const arrays = {
        d: Float64Array.from({ length: n }, (_, i) => (i / (n - 1)) * 5000),
        thr: Float64Array.from({ length: n }, (_, i) => (i > 80 && i < 120 ? 0 : 100)),
        brk: Float64Array.from({ length: n }, (_, i) => (i > 80 && i < 120 ? 1 : 0)),
        gl: Float64Array.from({ length: n }, (_, i) => (i > 80 && i < 120 ? -4.2 : 1.0)),
    };

    it('returns null on empty input', () => {
        expect(buildPedalGeom(null, 1000)).toBeNull();
    });

    it('finds the braking event', () => {
        const g = buildPedalGeom(arrays, 1000);
        expect(g.brakeShapes).toHaveLength(1);
    });

    it('takes peak g from the braking phase only', () => {
        // 1.0g of acceleration must not be mistaken for braking effort
        const g = buildPedalGeom(arrays, 1000);
        expect(g.peakG).toBeCloseTo(4.2, 5);
    });

    it('ignores deceleration when the pedal is not pressed', () => {
        const coasting = { ...arrays, brk: new Float64Array(n) };  // never pressed
        const g = buildPedalGeom(coasting, 1000);
        expect(g.brakeShapes).toHaveLength(0);
    });

    it('spans the viewBox width', () => {
        const g = buildPedalGeom(arrays, 1000);
        const xs = g.throttlePath.replace('M ', '').split(' L ').map((p) => +p.split(',')[0]);
        expect(Math.max(...xs)).toBeCloseTo(1000, 1);
    });
});

// --- map layout ------------------------------------------------------------

describe('buildMapLayout', () => {
    const t = trackData();
    const layout = buildMapLayout(t, bounds(t));

    it('returns null without a track', () => {
        expect(buildMapLayout(null, null)).toBeNull();
        expect(buildMapLayout({ track_points: [] }, null)).toBeNull();
    });

    it('produces a closed outline', () => {
        expect(layout.d.startsWith('M ')).toBe(true);
        expect(layout.d.endsWith(' Z')).toBe(true);
    });

    it('gives a viewBox that contains the track', () => {
        const [, , w, h] = layout.viewBox.split(' ').map(Number);
        expect(w).toBeGreaterThan(0);
        expect(h).toBeGreaterThan(0);
    });

    it('places start and both sector ticks', () => {
        expect(layout.ticks.start).toBeTruthy();
        expect(layout.ticks.s1).toBeTruthy();
        expect(layout.ticks.s2).toBeTruthy();
        expect(layout.hasSectors).toBe(true);
    });

    it('labels every corner — none are dropped', () => {
        // An earlier de-collision scheme silently suppressed labels, so Monaco
        // lost turn 16 and Bahrain's turn 5 hid under the S1 marker.
        expect(layout.corners).toHaveLength(t.corners.length);
        expect(layout.corners.map((c) => c.n)).toEqual(t.corners.map((c) => c.n));
    });

    it('keeps corner labels clear of each other', () => {
        const gap = layout.mapSize * 0.030;
        for (let i = 0; i < layout.corners.length; i++) {
            for (let j = i + 1; j < layout.corners.length; j++) {
                const a = layout.corners[i], b = layout.corners[j];
                expect(Math.hypot(a.lx - b.lx, a.ly - b.ly)).toBeGreaterThan(gap * 0.5);
            }
        }
    });

    it('builds a DRS overlay for each zone', () => {
        expect(layout.drsPaths).toHaveLength(1);
    });

    it('draws a zone that crosses the line without cutting the circuit', () => {
        // `end` before `start` means the zone straddles the start/finish
        // line. Selecting those points with a plain filter orders them by
        // index — head of the lap first, tail second — so the overlay jumped
        // straight across the middle of the track between the two halves.
        const t = trackData();
        t.drs_zones = [{ start: t.total_distance * 0.9, end: t.total_distance * 0.1 }];
        const l = buildMapLayout(t, bounds(t));
        expect(l.drsPaths).toHaveLength(1);
        const pts = l.drsPaths[0].d.slice(2).split(' L ')
            .map((s) => s.split(',').map(Number));
        expect(pts.length).toBeGreaterThan(10);
        // No step in the overlay is longer than the circuit's own point gaps.
        const track = l.d.slice(2).replace(' Z', '').split(' L ')
            .map((s) => s.split(',').map(Number));
        let worstTrack = 0;
        for (let i = 1; i < track.length; i++) {
            worstTrack = Math.max(worstTrack,
                Math.hypot(track[i][0] - track[i - 1][0], track[i][1] - track[i - 1][1]));
        }
        for (let i = 1; i < pts.length; i++) {
            expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
                .toBeLessThan(worstTrack * 1.5);
        }
    });

    it('colours the speed segments across the whole range', () => {
        expect(layout.speedSegments.length).toBeGreaterThan(10);
        expect(layout.speedRange.min).toBe(90);
        expect(layout.speedRange.max).toBe(300);
        layout.speedSegments.forEach((s) => {
            expect(s.t).toBeGreaterThanOrEqual(0);
            expect(s.t).toBeLessThanOrEqual(1);
        });
    });
});


// --- dominance -------------------------------------------------------------

/** A driver whose elapsed time at lap fraction f is given by a function. */
const lap = (fn) => ({ timeAtFraction: (f) => fn(f) });

describe('dominance', () => {
    // 90 seconds flat for one, 92 for the other, both at constant pace.
    const steady = (total) => lap((f) => f * total);

    it('cuts the lap into mini-sectors that tile it exactly', () => {
        const secs = dominance(steady(90), steady(92));
        expect(secs).toHaveLength(MINI_SECTORS);
        expect(secs[0].from).toBe(0);
        expect(secs[secs.length - 1].to).toBe(1);
        for (let i = 1; i < secs.length; i++) {
            expect(secs[i].from).toBeCloseTo(secs[i - 1].to, 12);
        }
    });

    it('gives every sector to the driver who is quicker everywhere', () => {
        const secs = dominance(steady(90), steady(92));
        expect(secs.every((s) => s.winner === 'a')).toBe(true);
        expect(dominanceTally(secs)).toEqual({ a: MINI_SECTORS, b: 0 });
    });

    it('splits the lap where each driver is actually faster', () => {
        // A is quicker over the first half, B over the second, and they
        // finish level — which is the case a single lap time cannot show.
        const a = lap((f) => (f <= 0.5 ? f * 80 : 40 + (f - 0.5) * 100));
        const b = lap((f) => (f <= 0.5 ? f * 100 : 50 + (f - 0.5) * 80));
        const secs = dominance(a, b, 4);
        expect(secs.map((s) => s.winner)).toEqual(['a', 'a', 'b', 'b']);
        expect(dominanceTally(secs)).toEqual({ a: 2, b: 2 });
    });

    it('measures each sector on its own, not on the running total', () => {
        // B is 5 s down at the line but quicker through the final sector. A
        // cumulative comparison would hand that sector to A.
        const a = lap((f) => f * 90);
        const b = lap((f) => (f < 0.75 ? f * 100 : 75 + (f - 0.75) * 40));
        const secs = dominance(a, b, 4);
        expect(secs[3].winner).toBe('b');
        expect(secs.slice(0, 3).every((s) => s.winner === 'a')).toBe(true);
    });

    it('reports how much each sector was won by', () => {
        const secs = dominance(steady(90), steady(92), 2);
        for (const s of secs) expect(s.gap).toBeCloseTo(1, 9);
    });

    it('calls a dead heat nobody', () => {
        const secs = dominance(steady(90), steady(90), 3);
        expect(secs.every((s) => s.winner === null)).toBe(true);
        expect(dominanceTally(secs)).toEqual({ a: 0, b: 0 });
    });

    it('is safe before both laps have loaded', () => {
        expect(dominance(null, steady(90))).toEqual([]);
        expect(dominance(steady(90), undefined)).toEqual([]);
        expect(dominance(steady(90), steady(92), 0)).toEqual([]);
    });
});
