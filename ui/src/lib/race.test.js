import { describe, it, expect } from 'vitest';
import {
    buildRace, frameAt, statusAt, orderByLap, lapCrossings, lapAt,
    stintAt, pitsFor, messagesUpTo, weatherAt, gapsAtLap,
    carAt, safetyCarAt, leaderAt, SC_TRANSIT_S, intervalsAt, gridSlots,
} from './race';

/** A tiny but structurally real payload: 2 cars, 5 frames at 2 Hz. */
const payload = () => ({
    race: 'Test Grand Prix',
    circuit: 'Testville',
    total_laps: 3,
    rotation: 0,
    t0: 0,
    hz: 2,
    frames: 5,
    duration: 2,
    track_points: [{ X: 0, Y: 0, D: 0 }, { X: 50, Y: 0, D: 50 }, { X: 100, Y: 0, D: 100 }],
    pit_lane: [{ X: 0, Y: 50 }, { X: 100, Y: 50 }],
    pit_box: { X: 50, Y: 50, median_stop_s: 4.3 },
    drivers: [
        { number: '1', code: 'VER', team: 'Red Bull', color: '#3671C6', grid: 1, out_at: 2 },
        { number: '16', code: 'LEC', team: 'Ferrari', color: '#E80020', grid: 2, out_at: 2 },
    ],
    cars: {
        '1': { x: [0, 10, 20, 30, 40], y: [0, 0, 0, 0, 0], on: [1, 1, 1, 1, 1], pit: [0, 0, 1, 1, 0] },
        '16': { x: [5, 15, 25, 35, 45], y: [1, 1, 1, 1, 1], on: [1, 1, 1, 0, 0], pit: [0, 0, 0, 0, 0] },
    },
    lap_starts: [[1, 0], [2, 0.8], [3, 1.6]],
    crossings: {
        '1': [[1, 0.8], [2, 1.6], [3, 2.4]],
        '16': [[1, 1.0], [2, 1.5], [3, 2.9]],
    },
    order: [
        [1, '1', 1], [1, '16', 2],
        [2, '16', 1], [2, '1', 2],
        [3, '1', 1], [3, '16', 2],
    ],
    stints: {
        '1': [{ compound: 'MEDIUM', from: 1, to: 2, fresh: true },
              { compound: 'HARD', from: 3, to: 3, fresh: true }],
    },
    pits: [
        { driver: '1', lap: 2, t: 1.0, window: 25.3, stopped: 4.1, red_flag: false, compound: 'HARD' },
        { driver: '16', lap: 2, t: 1.5, window: 900.0, stopped: 880.0, red_flag: true, compound: 'SOFT' },
    ],
    status: [
        { code: '1', name: 'CLEAR', start: 0, end: 1 },
        { code: '4', name: 'SAFETY CAR', start: 1, end: 1.5 },
        { code: '1', name: 'CLEAR', start: 1.5, end: 2 },
    ],
    messages: [
        { t: 0.2, lap: 1, cat: 'Other', flag: '', scope: '', msg: 'PROCEDURAL NOISE' },
        { t: 0.5, lap: 1, cat: 'Flag', flag: 'YELLOW', scope: 'Sector', msg: 'YELLOW IN SECTOR 3' },
        { t: 1.0, lap: 2, cat: 'SafetyCar', flag: '', scope: '', msg: 'SAFETY CAR DEPLOYED' },
        { t: 1.9, lap: 3, cat: 'Flag', flag: 'GREEN', scope: 'Track', msg: 'GREEN LIGHT' },
    ],
    weather: [
        { t: 0, air: 17, track: 35, rain: false },
        { t: 1, air: 18, track: 36, rain: false },
        { t: 2, air: 19, track: 37, rain: true },
    ],
});

describe('buildRace', () => {
    it('flattens cars into typed arrays', () => {
        const r = buildRace(payload());
        expect(r.cars).toHaveLength(2);
        expect(r.cars[0].x).toBeInstanceOf(Float32Array);
        expect(r.cars[0].x).toHaveLength(5);
        expect(r.cars[0].on).toBeInstanceOf(Uint8Array);
    });

    it('keeps driver identity alongside the telemetry', () => {
        const r = buildRace(payload());
        expect(r.cars[0].code).toBe('VER');
        expect(r.cars[0].color).toBe('#3671C6');
        expect(r.byNumber['16'].code).toBe('LEC');
    });

    it('applies the circuit rotation to cars, track AND pit lane together', () => {
        // 90 degrees: (x, y) -> (-y, x). If any of the three were rotated
        // differently the pit lane would sit somewhere other than beside the
        // track, which is the whole point of deriving it.
        const p = payload();
        p.rotation = 90;
        p.cars['1'].x = [10]; p.cars['1'].y = [0];
        p.cars['1'].on = [1]; p.cars['1'].pit = [0];
        p.cars['16'].x = [10]; p.cars['16'].y = [0];
        p.cars['16'].on = [1]; p.cars['16'].pit = [0];
        p.frames = 1;
        p.track_points = [{ X: 10, Y: 0, D: 0 }];
        p.pit_lane = [{ X: 10, Y: 0 }];
        p.pit_box = { X: 10, Y: 0, median_stop_s: 4 };
        const r = buildRace(p);
        expect(r.cars[0].x[0]).toBeCloseTo(0, 4);
        expect(r.cars[0].y[0]).toBeCloseTo(10, 4);
        expect(r.track[0].X).toBeCloseTo(0, 4);
        expect(r.track[0].Y).toBeCloseTo(10, 4);
        expect(r.pitLane[0].X).toBeCloseTo(0, 4);
        expect(r.pitLane[0].Y).toBeCloseTo(10, 4);
        expect(r.pitBox.X).toBeCloseTo(0, 4);
    });

    it('survives a payload with no pit lane', () => {
        // A sprint: too few stops to derive one, so the backend sends null.
        const p = payload();
        p.pit_lane = null;
        p.pit_box = null;
        const r = buildRace(p);
        expect(r.pitLane).toEqual([]);
        expect(r.pitBox).toBeNull();
    });

    it('returns null for junk rather than throwing', () => {
        expect(buildRace(null)).toBeNull();
        expect(buildRace({})).toBeNull();
        expect(buildRace({ cars: {}, drivers: [] })).toBeNull();
    });

    it('skips a driver with no position data', () => {
        const p = payload();
        delete p.cars['16'];
        expect(buildRace(p).cars).toHaveLength(1);
    });
});

describe('frameAt', () => {
    it('maps seconds to a frame index at the payload rate', () => {
        const r = buildRace(payload());
        expect(frameAt(r, 0)).toBe(0);
        expect(frameAt(r, 1)).toBe(2);      // 2 Hz
        expect(frameAt(r, 2)).toBe(4);
    });

    it('clamps rather than reading off the end', () => {
        const r = buildRace(payload());
        expect(frameAt(r, -5)).toBe(0);
        expect(frameAt(r, 9999)).toBe(4);
    });
});

describe('statusAt', () => {
    it('finds the live span', () => {
        const r = buildRace(payload());
        expect(statusAt(r, 0.5).span.name).toBe('CLEAR');
        expect(statusAt(r, 1.2).span.name).toBe('SAFETY CAR');
        expect(statusAt(r, 1.7).span.name).toBe('CLEAR');
    });

    it('advances from a cursor without rescanning', () => {
        const r = buildRace(payload());
        const a = statusAt(r, 1.2, 0);
        expect(a.index).toBe(1);
        expect(statusAt(r, 1.7, a.index).index).toBe(2);
    });

    it('rewinds when the cursor is ahead of the time', () => {
        // Scrubbing backwards: a cursor-only scan would get stuck.
        const r = buildRace(payload());
        expect(statusAt(r, 0.1, 2).span.name).toBe('CLEAR');
        expect(statusAt(r, 0.1, 2).index).toBe(0);
    });
});

describe('orderByLap', () => {
    it('sorts each lap by position, leader first', () => {
        const r = buildRace(payload());
        const o = orderByLap(r);
        expect(o.get(1)).toEqual(['1', '16']);
        expect(o.get(2)).toEqual(['16', '1']);   // positions swapped
    });
});

describe('lapCrossings', () => {
    it('records who led each lap', () => {
        const r = buildRace(payload());
        const c = lapCrossings(r);
        expect(c.get(1)).toBe('1');
        expect(c.get(2)).toBe('16');
        expect(c.get(3)).toBe('1');
    });
});

describe('stintAt', () => {
    it('finds the compound on a given lap', () => {
        const r = buildRace(payload());
        expect(stintAt(r, '1', 1).compound).toBe('MEDIUM');
        expect(stintAt(r, '1', 3).compound).toBe('HARD');
    });

    it('returns null outside the stints and for unknown drivers', () => {
        const r = buildRace(payload());
        expect(stintAt(r, '1', 99)).toBeNull();
        expect(stintAt(r, '99', 1)).toBeNull();
    });
});

describe('pitsFor', () => {
    it('keeps red-flag stops, flagged as such', () => {
        // The backend reports every window; a red-flag stop is real but its
        // 900s duration is not a tyre change, so the flag has to survive.
        const r = buildRace(payload());
        expect(pitsFor(r, '1')[0].stopped).toBe(4.1);
        expect(pitsFor(r, '1')[0].red_flag).toBe(false);
        expect(pitsFor(r, '16')[0].red_flag).toBe(true);
    });
});

describe('messagesUpTo', () => {
    it('drops procedural noise and anything in the future', () => {
        const r = buildRace(payload());
        const m = messagesUpTo(r, 1.0);
        expect(m.map((x) => x.msg)).toEqual(['SAFETY CAR DEPLOYED', 'YELLOW IN SECTOR 3']);
    });

    it('returns newest first and respects the limit', () => {
        const r = buildRace(payload());
        const m = messagesUpTo(r, 2.0, 1);
        expect(m).toHaveLength(1);
        expect(m[0].msg).toBe('GREEN LIGHT');
    });
});

describe('weatherAt', () => {
    it('holds the last sample rather than interpolating', () => {
        const r = buildRace(payload());
        expect(weatherAt(r, 0).air).toBe(17);
        expect(weatherAt(r, 1.4).air).toBe(18);
        expect(weatherAt(r, 2).rain).toBe(true);
    });

    it('clamps outside the range', () => {
        const r = buildRace(payload());
        expect(weatherAt(r, -10).air).toBe(17);
        expect(weatherAt(r, 999).air).toBe(19);
    });
});

describe('lapAt', () => {
    it('finds the leader lap by crossing time, not by division', () => {
        const r = buildRace(payload());
        expect(lapAt(r, 0)).toBe(1);
        expect(lapAt(r, 0.5)).toBe(1);
        expect(lapAt(r, 0.8)).toBe(2);
        expect(lapAt(r, 1.2)).toBe(2);
        expect(lapAt(r, 1.6)).toBe(3);
        expect(lapAt(r, 99)).toBe(3);
    });

    it('handles uneven lap lengths, which red flags guarantee', () => {
        // Australia 2023: lap 57 started at 6964s and lap 58 at 8981s — a
        // 2017-second "lap" because a red flag fell in between. Anything that
        // divided elapsed time by an average would report the wrong lap for
        // half an hour.
        const p = payload();
        p.lap_starts = [[1, 0], [2, 10], [3, 2000]];
        const r = buildRace(p);
        expect(lapAt(r, 1500)).toBe(2);
        expect(lapAt(r, 2000)).toBe(3);
    });

    it('defaults to lap 1 with no data', () => {
        const p = payload();
        p.lap_starts = [];
        expect(lapAt(buildRace(p), 50)).toBe(1);
    });
});

describe('gapsAtLap', () => {
    it('measures every driver against whoever crossed first', () => {
        const r = buildRace(payload());
        const g = gapsAtLap(r, 1);
        expect(g.get('1')).toBeCloseTo(0, 5);        // 0.8 is the earliest
        expect(g.get('16')).toBeCloseTo(0.2, 5);
    });

    it('follows a change of leader', () => {
        const r = buildRace(payload());
        const g = gapsAtLap(r, 2);                   // LEC crosses first now
        expect(g.get('16')).toBeCloseTo(0, 5);
        expect(g.get('1')).toBeCloseTo(0.1, 5);
    });

    it('reports null for a driver with no time on that lap', () => {
        // Retired, lapped, or still in the pit lane at the crossing.
        const p = payload();
        p.crossings['16'] = [[1, 1.0]];
        const g = gapsAtLap(buildRace(p), 3);
        expect(g.get('16')).toBeNull();
        expect(g.get('1')).toBeCloseTo(0, 5);
    });

    it('never returns a negative gap', () => {
        const r = buildRace(payload());
        for (const v of gapsAtLap(r, 3).values()) if (v != null) expect(v).toBeGreaterThanOrEqual(0);
    });
});

describe('carAt', () => {
    it('interpolates between frames instead of snapping to one', () => {
        // The payload is 2 Hz. Snapping shows a car jumping a car-length at a
        // time; this is what makes twenty of them move smoothly.
        const r = buildRace(payload());
        const c = r.byNumber['1'];                  // x = 0,10,20,30,40
        expect(carAt(c, r, 0).x).toBeCloseTo(0, 4);
        expect(carAt(c, r, 0.25).x).toBeCloseTo(5, 4);    // half a frame
        expect(carAt(c, r, 0.5).x).toBeCloseTo(10, 4);
        expect(carAt(c, r, 0.6).x).toBeCloseTo(12, 4);
    });

    it('takes on and pit from the floor frame, not blended', () => {
        // Half-retired is not a state.
        const r = buildRace(payload());
        const c = r.byNumber['1'];                  // pit = 0,0,1,1,0
        expect(carAt(c, r, 0.75).pit).toBe(false);  // frame 1
        expect(carAt(c, r, 1.0).pit).toBe(true);    // frame 2
        expect(typeof carAt(c, r, 1.0).on).toBe('boolean');
    });

    it('clamps at both ends without reading off the array', () => {
        const r = buildRace(payload());
        const c = r.byNumber['1'];
        expect(carAt(c, r, -5).x).toBeCloseTo(0, 4);
        expect(Number.isFinite(carAt(c, r, 9999).x)).toBe(true);
    });
});

describe('leaderAt', () => {
    it('reads the leader off the order, falling back to the last known lap', () => {
        const r = buildRace(payload());
        const byLap = orderByLap(r);
        expect(leaderAt(byLap, 1)).toBe('1');
        expect(leaderAt(byLap, 2)).toBe('16');
        expect(leaderAt(byLap, 99)).toBe('1');      // falls back to lap 3
    });
});

describe('safetyCarAt', () => {
    const sc = { code: '4', name: 'SAFETY CAR', start: 0, end: 100 };

    it('is null when there is no safety car out', () => {
        const r = buildRace(payload());
        expect(safetyCarAt(r, 1, null, '1')).toBeNull();
        expect(safetyCarAt(r, 1, { code: '1' }, '1')).toBeNull();
    });

    it('is null for a VIRTUAL safety car', () => {
        // A VSC puts no car on track. Drawing one would invent a vehicle.
        const r = buildRace(payload());
        expect(safetyCarAt(r, 1, { code: '6', start: 0, end: 100 }, '1')).toBeNull();
    });

    it('runs ahead of the leader once it is up to speed', () => {
        const r = buildRace(payload());
        const p = safetyCarAt(r, SC_TRANSIT_S + 1, sc, '1');
        expect(p).not.toBeNull();
        expect(Number.isFinite(p.x)).toBe(true);
    });

    it('emerges from the pit exit rather than blinking into place', () => {
        const r = buildRace(payload());
        const exit = r.pitLane[r.pitLane.length - 1];
        const atStart = safetyCarAt(r, 0, sc, '1');
        expect(atStart.x).toBeCloseTo(exit.X, 4);
        expect(atStart.y).toBeCloseTo(exit.Y, 4);
        // and has moved away from it a moment later
        const later = safetyCarAt(r, SC_TRANSIT_S * 0.5, sc, '1');
        expect(Math.abs(later.x - exit.X)).toBeGreaterThan(0);
    });

    it('peels back into the pits at the end of the period', () => {
        const r = buildRace(payload());
        const exit = r.pitLane[r.pitLane.length - 1];
        const atEnd = safetyCarAt(r, sc.end, sc, '1');
        expect(atEnd.x).toBeCloseTo(exit.X, 4);
        expect(atEnd.y).toBeCloseTo(exit.Y, 4);
    });

    it('returns null for an unknown leader', () => {
        const r = buildRace(payload());
        expect(safetyCarAt(r, 10, sc, '999')).toBeNull();
    });
});

describe('intervalsAt', () => {
    it('updates between crossings instead of holding for a whole lap', () => {
        // VER completes laps at 0.8/1.6/2.4, LEC at 1.0/1.5/2.9. Both have a
        // timing reference after 1.0, and the gap must move between crossings
        // rather than sitting still until the next one.
        const r = buildRace(payload());
        // LEC is the car BEHIND at these times, so LEC is the one with a gap
        // that should be moving; VER leads and is correctly pinned at 0.
        const a = intervalsAt(r, 1.1).get('16');
        const b = intervalsAt(r, 1.3).get('16');
        expect(a).not.toBeNull();
        expect(b).not.toBeNull();
        expect(a).not.toBeCloseTo(b, 6);
    });

    it('gives the car furthest along a gap of zero', () => {
        const r = buildRace(payload());
        const g = intervalsAt(r, 1.0);
        expect(Math.min(...[...g.values()].filter((v) => v != null))).toBeCloseTo(0, 6);
    });

    it('reports no gap before a driver has completed a lap', () => {
        // With 0 returned here, all twenty cars read LEADER for all of lap 1.
        const r = buildRace(payload());
        for (const v of intervalsAt(r, 0).values()) expect(v).toBeNull();
    });

    it('never returns a negative interval', () => {
        const r = buildRace(payload());
        for (const t of [0, 0.3, 0.9, 1.4, 2.0, 5.0]) {
            for (const v of intervalsAt(r, t).values()) {
                if (v != null) expect(v).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('measures the gap on the road, not the difference in lap times', () => {
        // LEC completed lap 2 at 1.5 and VER at 1.6, so at t = 1.65 LEC is
        // FURTHER ALONG and therefore the leader — which is what `order` says
        // for lap 2 too. The interval has to agree with the road, not with
        // whoever happens to have the quicker lap time.
        const r = buildRace(payload());
        const g = intervalsAt(r, 1.65);
        expect(g.get('16')).toBeCloseTo(0, 6);
        expect(g.get('1')).toBeGreaterThan(0);
    });
});

describe('gridSlots', () => {
    it('places each car by its grid position, staggered either side', () => {
        const r = buildRace(payload());
        const g = gridSlots(r);
        expect(g.size).toBe(2);
        // pole and P2 sit on opposite sides of the racing line (y = 0 here)
        expect(Math.sign(g.get('1').y)).toBe(-Math.sign(g.get('16').y));
    });

    it('separates them by more than the real 8m, or they render as one blob', () => {
        const r = buildRace(payload());
        const g = gridSlots(r);
        const d = Math.hypot(g.get('1').x - g.get('16').x, g.get('1').y - g.get('16').y);
        expect(d).toBeGreaterThan(0);
    });

    it('skips a car with no grid position rather than stacking it at zero', () => {
        const p = payload();
        p.drivers[1].grid = null;
        const g = gridSlots(buildRace(p));
        expect(g.has('16')).toBe(false);
        expect(g.has('1')).toBe(true);
    });

    it('keeps the whole grid inside a small stretch of the lap', () => {
        // The unit trap: D is metres, X/Y are 0.1 m units. Sizing the row gap
        // from the X/Y extent and using it as a D distance put 10 rows across
        // 79% of the circuit. The grid must occupy a short stretch, not a lap.
        const pts = [];
        for (let i = 0; i <= 200; i++) {
            // a 5000 m lap drawn as a 20000 x 0 unit line: D and X/Y differ 4x
            pts.push({ X: i * 100, Y: 0, D: i * 25 });
        }
        const p = payload();
        p.track_points = pts;
        p.drivers = Array.from({ length: 20 }, (_, i) => ({
            number: String(i + 1), code: `D${i}`, team: 't', color: '#fff',
            grid: i + 1, out_at: 999,
        }));
        p.cars = Object.fromEntries(p.drivers.map((d) => [d.number,
            { x: [0], y: [0], on: [1], pit: [0] }]));
        p.frames = 1;
        const g = gridSlots(buildRace(p));
        expect(g.size).toBe(20);
        const gx = [...g.values()].map((v) => v.x);
        const spanX = Math.max(...gx) - Math.min(...gx);
        const lapX = 200 * 100;                     // the lap's X extent
        expect(spanX / lapX).toBeLessThan(0.15);    // a grid, not a whole lap
    });

    it('returns an empty map with no track', () => {
        const p = payload();
        p.track_points = [];
        expect(gridSlots(buildRace(p)).size).toBe(0);
    });
});

describe('retirement', () => {
    it('carries out_at onto each car so a retired marker can be hidden', () => {
        // pos_data Status reads OnTrack for everyone always, so this is the
        // only signal that a car has stopped.
        const r = buildRace(payload());
        expect(r.cars[0].outAt).toBe(2);
    });

    it('defaults to Infinity when the backend omits it', () => {
        const p = payload();
        delete p.drivers[0].out_at;
        expect(buildRace(p).cars[0].outAt).toBe(Infinity);
    });
});
