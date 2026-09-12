import { describe, it, expect } from 'vitest';
import { buildGhost } from './ghost';

/**
 * A synthetic lap at constant speed.
 * @param lapTime  seconds
 * @param dist     total metres
 */
const lap = (lapTime, dist, n = 200) => Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1);
    return {
        time: f * lapTime,
        distance: f * dist,
        x: f * dist,        // straight line, so geometry stays trivial
        y: 0,
        speed: (dist / lapTime) * 3.6,
        throttle: 100,
        brake: 0,
        g: 0,
    };
});

describe('buildGhost', () => {
    it('rejects a lap too short to interpolate', () => {
        expect(buildGhost([], {})).toBeNull();
        expect(buildGhost([{ time: 0, distance: 0, x: 0, y: 0, speed: 0 }], {})).toBeNull();
    });

    it('flips Y, because SVG grows downward', () => {
        const g = buildGhost(lap(90, 5000).map((p) => ({ ...p, y: 7 })), {});
        expect(g.arrays.y[0]).toBe(-7);
    });

    it('carries meta through', () => {
        const g = buildGhost(lap(90, 5000), { code: 'VER', color: '#3671C6' });
        expect(g.code).toBe('VER');
        expect(g.color).toBe('#3671C6');
    });

    describe('timeAtFraction', () => {
        it('returns 0 at the start and the lap time at the flag', () => {
            const g = buildGhost(lap(90, 5000), {});
            expect(g.timeAtFraction(0)).toBeCloseTo(0, 6);
            expect(g.timeAtFraction(1)).toBeCloseTo(90, 6);
        });

        it('is proportional on a constant-speed lap', () => {
            const g = buildGhost(lap(90, 5000), {});
            expect(g.timeAtFraction(0.5)).toBeCloseTo(45, 3);
        });

        it('clamps outside 0..1 instead of extrapolating', () => {
            const g = buildGhost(lap(90, 5000), {});
            expect(g.timeAtFraction(-5)).toBeCloseTo(0, 6);
            expect(g.timeAtFraction(9)).toBeCloseTo(90, 6);
        });
    });

    describe('the delta invariant', () => {
        /**
         * THE property the head-to-head rests on: at the flag, the delta must
         * equal the difference in lap times exactly.
         *
         * This is why the comparison is done by lap FRACTION and not absolute
         * metres — two drivers' laps don't measure identically, and comparing
         * absolute distance leaves the delta visibly wrong at the line.
         */
        it('lands exactly on the lap-time gap, even when the laps measure differently', () => {
            const a = buildGhost(lap(90.000, 5000.0), {});
            const b = buildGhost(lap(90.292, 5012.4), {});   // 12.4m longer line
            const delta = b.timeAtFraction(1) - a.timeAtFraction(1);
            expect(delta).toBeCloseTo(0.292, 6);
        });

        it('starts at zero', () => {
            const a = buildGhost(lap(90.0, 5000), {});
            const b = buildGhost(lap(90.3, 5000), {});
            expect(b.timeAtFraction(0) - a.timeAtFraction(0)).toBeCloseTo(0, 6);
        });

        it('is negative when the compared driver is ahead', () => {
            const a = buildGhost(lap(90.5, 5000), {});
            const b = buildGhost(lap(90.0, 5000), {});
            expect(b.timeAtFraction(1) - a.timeAtFraction(1)).toBeLessThan(0);
        });
    });

    describe('posAtTime', () => {
        it('is at the start at t=0 and the end at the flag', () => {
            const g = buildGhost(lap(90, 5000), {});
            expect(g.posAtTime(0).dist).toBeCloseTo(0, 3);
            expect(g.posAtTime(90).dist).toBeCloseTo(5000, 0);
        });

        it('interpolates between samples rather than snapping', () => {
            const g = buildGhost(lap(90, 5000), {});
            const a = g.posAtTime(45.0);
            const b = g.posAtTime(45.1);
            expect(b.dist).toBeGreaterThan(a.dist);
        });
    });

    it('knows when the lap is over', () => {
        const g = buildGhost(lap(90, 5000), {});
        expect(g.finishedBy(89.9)).toBe(false);
        expect(g.finishedBy(90.1)).toBe(true);
    });
});
