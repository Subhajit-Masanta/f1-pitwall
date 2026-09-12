import { describe, it, expect } from 'vitest';
import { layoutTags, TAG_H, TAG_GAP, TAG_SEP, EDGE } from './tags';

const W = 600, H = 400;
const TW = 34;                                   // a typical 3-letter tag
const car = (id, px, py, w = TW) => ({ id, px, py, w });
const box = (r, it) => ({ left: it.px + r.dx, top: it.py + r.dy });
const overlap = (a, b) =>
    Math.abs((a.top + TAG_H / 2) - (b.top + TAG_H / 2)) < TAG_H;

describe('layoutTags', () => {
    it('puts a lone tag to the right of the dot, vertically centred', () => {
        const [r] = layoutTags([car('a', 100, 200)], W, H);
        expect(r.side).toBe(1);
        expect(r.dx).toBe(TAG_GAP);
        expect(r.dy).toBe(-TAG_H / 2);
    });

    it('flips to the left when the tag would hang off the right edge', () => {
        const [r] = layoutTags([car('a', W - 20, 200)], W, H);
        expect(r.side).toBe(-1);
        // right edge of the tag sits TAG_GAP left of the dot
        expect(r.dx + TW).toBe(-TAG_GAP);
    });

    it('keeps a flipped tag fully inside the stage', () => {
        const [r] = layoutTags([car('a', W - 2, 200)], W, H);
        expect(box(r, car('a', W - 2, 200)).left).toBeGreaterThanOrEqual(0);
    });

    it('does not flip when there is exactly enough room', () => {
        const px = W - TAG_GAP - TW - EDGE;
        const [r] = layoutTags([car('a', px, 200)], W, H);
        expect(r.side).toBe(1);
    });

    // The head-to-head case: two cars nose to tail is precisely when the
    // names matter, and a naive fixed offset draws them on top of each other.
    it('separates two tags when the cars are on top of each other', () => {
        const a = car('a', 300, 200), b = car('b', 302, 201);
        const [ra, rb] = layoutTags([a, b], W, H);
        expect(overlap(box(ra, a), box(rb, b))).toBe(false);
        expect(Math.abs(box(ra, a).top - box(rb, b).top))
            .toBeGreaterThanOrEqual(TAG_H + TAG_SEP);
    });

    it('leaves well-separated cars centred on their own dots', () => {
        const a = car('a', 100, 60), b = car('b', 400, 300);
        const [ra, rb] = layoutTags([a, b], W, H);
        expect(ra.dy).toBe(-TAG_H / 2);
        expect(rb.dy).toBe(-TAG_H / 2);
    });

    it('keeps a stacked pair inside the bottom edge', () => {
        const a = car('a', 300, H - 2), b = car('b', 301, H - 1);
        const res = layoutTags([a, b], W, H);
        const boxes = [box(res[0], a), box(res[1], b)];
        for (const bx of boxes) {
            expect(bx.top).toBeGreaterThanOrEqual(0);
            expect(bx.top + TAG_H).toBeLessThanOrEqual(H);
        }
        expect(overlap(boxes[0], boxes[1])).toBe(false);
    });

    it('keeps a stacked pair inside the top edge', () => {
        const a = car('a', 300, 1), b = car('b', 301, 2);
        const res = layoutTags([a, b], W, H);
        const boxes = [box(res[0], a), box(res[1], b)];
        for (const bx of boxes) expect(bx.top).toBeGreaterThanOrEqual(0);
        expect(overlap(boxes[0], boxes[1])).toBe(false);
    });

    it('does not stack cars that ended up on opposite sides', () => {
        // same y, but one is jammed against the right edge so it flips
        const a = car('a', 100, 200), b = car('b', W - 5, 200);
        const [ra, rb] = layoutTags([a, b], W, H);
        expect(ra.side).toBe(1);
        expect(rb.side).toBe(-1);
        expect(ra.dy).toBe(-TAG_H / 2);        // neither had to move
        expect(rb.dy).toBe(-TAG_H / 2);
    });

    it('never overlaps for a full grid crowded into one corner', () => {
        const cars = Array.from({ length: 20 }, (_, i) => car(`c${i}`, 300 + i * 0.3, 200 + i * 0.4));
        const res = layoutTags(cars, W, H);
        const boxes = res.map((r, i) => box(r, cars[i]));
        for (let i = 0; i < boxes.length; i++) {
            expect(boxes[i].top).toBeGreaterThanOrEqual(0);
            for (let j = i + 1; j < boxes.length; j++) {
                if (res[i].side !== res[j].side) continue;
                expect(overlap(boxes[i], boxes[j])).toBe(false);
            }
        }
    });

    it('returns nothing before the stage has been measured', () => {
        expect(layoutTags([car('a', 10, 10)], 0, 0)).toEqual([]);
        expect(layoutTags([], W, H)).toEqual([]);
    });
});
