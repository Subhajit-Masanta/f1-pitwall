import { describe, it, expect } from 'vitest';
import {
    followStep, cameraStep, isWide, camProjection, TAU, FOCUS_ZOOM, WIDE_ZOOM,
} from './camera';

describe('followStep', () => {
    it('moves towards the target without overshooting it', () => {
        const v = followStep(0, 100, 1 / 60);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(100);
    });

    it('is frame-rate independent: two half-steps equal one whole one', () => {
        const dt = 1 / 30;
        const one = followStep(0, 100, dt);
        const two = followStep(followStep(0, 100, dt / 2), 100, dt / 2);
        expect(two).toBeCloseTo(one, 9);
    });

    it('covers ~63% of the distance in one time constant', () => {
        expect(followStep(0, 100, TAU)).toBeCloseTo(63.2, 1);
    });

    it('converges: a long run of frames arrives at the target', () => {
        let v = 0;
        for (let i = 0; i < 600; i++) v = followStep(v, 100, 1 / 60);
        expect(v).toBeCloseTo(100, 6);
    });

    it('treats a stall as a capped frame rather than a jump', () => {
        // A backgrounded tab hands back a five-second dt. Honouring it would
        // teleport the camera; the cap turns it into one catch-up frame.
        expect(followStep(0, 100, 5)).toBeLessThan(100);
        expect(followStep(0, 100, 5)).toBeCloseTo(followStep(0, 100, TAU * 2), 9);
    });

    it('caps above the time constant, not below it', () => {
        // A cap under tau would quietly become the time constant: no frame
        // could ever cover a full one.
        expect(followStep(0, 100, TAU)).toBeCloseTo(63.2, 1);
        expect(followStep(0, 100, TAU * 1.5)).toBeGreaterThan(followStep(0, 100, TAU));
    });

    it('holds still when no time has passed', () => {
        expect(followStep(7, 100, 0)).toBe(7);
    });

    it('survives a target that is not a number', () => {
        expect(followStep(7, NaN, 1 / 60)).toBe(7);
        expect(followStep(7, undefined, 1 / 60)).toBe(7);
    });

    it('adopts the target when the current value is not a number', () => {
        expect(followStep(NaN, 42, 1 / 60)).toBe(42);
    });
});

describe('cameraStep', () => {
    const cam = { cx: 0, cy: 0, k: 1 };

    it('approaches the target on all three axes', () => {
        const next = cameraStep(cam, { cx: 100, cy: -50, k: FOCUS_ZOOM }, 1 / 60);
        expect(next.cx).toBeGreaterThan(0);
        expect(next.cy).toBeLessThan(0);
        expect(next.k).toBeGreaterThan(1);
        expect(next.k).toBeLessThan(FOCUS_ZOOM);
    });

    it('HOLDS when the target is null', () => {
        // The followed car is off track for this frame. Diving to the origin
        // is the one thing the camera must never do.
        expect(cameraStep(cam, null, 1 / 60)).toBe(cam);
    });

    it('CUTS straight to the target when it is not animating', () => {
        // A paused replay produces no further frames, so a glide gets about
        // six percent of the way and stops — picking a driver crept inwards
        // and Escape left the map frozen half zoomed. Arriving is the point.
        const target = { cx: 100, cy: -50, k: FOCUS_ZOOM };
        expect(cameraStep(cam, target, 1 / 60, false)).toEqual(target);
    });

    it('still holds a null target when it is not animating', () => {
        // Cutting is about arriving at a target, not about inventing one.
        expect(cameraStep(cam, null, 1 / 60, false)).toBe(cam);
    });

    it('lands exactly on the wide shot when it cuts', () => {
        // Exactly, not nearly: `isWide` is what takes the transform off the
        // map altogether, and it was never reached from a glide that stopped
        // at k = 1.007.
        const wide = { cx: 0, cy: 0, k: WIDE_ZOOM };
        expect(isWide(cameraStep(cam, wide, 1 / 60, false))).toBe(true);
    });
});

describe('isWide', () => {
    it('is true for no camera at all', () => {
        expect(isWide(null)).toBe(true);
    });

    it('is true once the pull-back has visually finished', () => {
        expect(isWide({ cx: 0, cy: 0, k: WIDE_ZOOM })).toBe(true);
        expect(isWide({ cx: 0, cy: 0, k: 1.005 })).toBe(true);
    });

    it('is false while still zoomed in', () => {
        expect(isWide({ cx: 0, cy: 0, k: 1.2 })).toBe(false);
        expect(isWide({ cx: 0, cy: 0, k: FOCUS_ZOOM })).toBe(false);
    });
});

describe('camProjection', () => {
    const base = { scale: 0.37, offX: 118.5, offY: -42.25 };
    const W = 1254;
    const H = 583;
    // Real-ish track coordinates: Melbourne spans a few thousand units.
    const points = [[0, 0], [1200, -800], [-2400, 1500], [537.5, -91.25]];

    it('puts the camera centre in the middle of the box', () => {
        const cam = { cx: 1200, cy: -800, k: FOCUS_ZOOM };
        const p = camProjection(base, cam, W, H);
        expect(1200 * p.scale + p.offX).toBeCloseTo(W / 2, 9);
        expect(-800 * p.scale + p.offY).toBeCloseTo(H / 2, 9);
    });

    it('THE CARS AND THE TRACK LAND IN THE SAME PLACE', () => {
        // The one invariant that matters. The cars go through the returned
        // projection; the track goes through the returned viewBox, mapped the
        // way an SVG maps one onto its box. If these ever disagree the field
        // drives beside the circuit instead of on it.
        for (const k of [1, 1.4, FOCUS_ZOOM, 6]) {
            const cam = { cx: 537.5, cy: -91.25, k };
            const p = camProjection(base, cam, W, H);
            const [vx, vy, vw, vh] = p.vb;
            // Same shape as the box, so preserveAspectRatio has nothing to
            // letterbox and the mapping is a plain stretch.
            expect(vw / vh).toBeCloseTo(W / H, 9);
            for (const [x, y] of points) {
                const car = [x * p.scale + p.offX, y * p.scale + p.offY];
                const track = [(x - vx) * (W / vw), (y - vy) * (H / vh)];
                expect(track[0]).toBeCloseTo(car[0], 9);
                expect(track[1]).toBeCloseTo(car[1], 9);
            }
        }
    });

    it('frames the camera centre in the middle of the window', () => {
        const p = camProjection(base, { cx: 1200, cy: -800, k: FOCUS_ZOOM }, W, H);
        const [vx, vy, vw, vh] = p.vb;
        expect(vx + vw / 2).toBeCloseTo(1200, 9);
        expect(vy + vh / 2).toBeCloseTo(-800, 9);
    });

    it('shows less of the circuit the further it zooms in', () => {
        const near = camProjection(base, { cx: 0, cy: 0, k: 4 }, W, H).vb;
        const far = camProjection(base, { cx: 0, cy: 0, k: 2 }, W, H).vb;
        expect(near[2]).toBeCloseTo(far[2] / 2, 9);
    });

    it('is the untouched base projection when there is no camera', () => {
        const p = camProjection(base, null, W, H);
        expect(p).toMatchObject({ scale: base.scale, offX: base.offX, offY: base.offY });
        // No window at all, so the SVG keeps the viewBox it was authored with
        // and nothing is written to it.
        expect(p.vb).toBeNull();
    });

    it('refuses to build a viewBox out of a box with no size', () => {
        // The window a camera implies is viewW/scale, so a zero box gives a
        // viewBox of NaNs — and an SVG handed a viewBox of NaNs draws nothing
        // at all. A mid-resize frame should show the whole circuit, not an
        // empty stage.
        const cam = { cx: 100, cy: 100, k: FOCUS_ZOOM };
        for (const [w, h, b] of [[0, H, base], [W, 0, base], [W, H, { ...base, scale: 0 }]]) {
            const p = camProjection(b, cam, w, h);
            expect(p.vb).toBeNull();
            expect(Number.isFinite(p.scale)).toBe(true);
        }
    });

    it('scales the map by exactly the zoom factor', () => {
        const p = camProjection(base, { cx: 0, cy: 0, k: WIDE_ZOOM * 2 }, W, H);
        expect(p.scale).toBeCloseTo(base.scale * 2, 9);
    });
});
