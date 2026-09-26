import { describe, it, expect } from 'vitest';
import {
    buildRace, frameAt, statusAt, orderByLap, lapCrossings, lapAt,
    stintAt, pitsFor, messagesUpTo, weatherAt, gapsAtLap,
    carAt, safetyCarAt, leaderAt, SC_TRANSIT_S, intervalsAt, gridSlots, standingsAt,
    aheadAt, strategyRows, namedStop, STOP_MAX_S, traceRows,
    lapTimeAt, bestLapUpTo, fastestLapUpTo,
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
        { number: '1', code: 'VER', team: 'Red Bull', color: '#3671C6', grid: 1, out_at: 2, finish: 1, status: 'Finished' },
        { number: '16', code: 'LEC', team: 'Ferrari', color: '#E80020', grid: 2, out_at: 2, finish: 2, status: 'Finished' },
    ],
    cars: {
        '1': { x: [0, 10, 20, 30, 40], y: [0, 0, 0, 0, 0], on: [1, 1, 1, 1, 1], pit: [0, 0, 1, 1, 0] },
        '16': { x: [5, 15, 25, 35, 45], y: [1, 1, 1, 1, 1], on: [1, 1, 1, 0, 0], pit: [0, 0, 0, 0, 0] },
    },
    lap_starts: [[1, 0], [2, 0.8], [3, 1.6]],
    crossings: {
        '1': [[0, 0], [1, 0.8], [2, 1.6], [3, 2.4]],
        '16': [[0, 0], [1, 1.0], [2, 1.5], [3, 2.9]],
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
    lap_times: {
        '1': [[1, 92.5], [2, 90.1], [3, 91.8]],
        '16': [[1, 93.0], [2, 89.4], [3, 90.6]],
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
        { t: 1.95, lap: 3, cat: 'Flag', flag: 'BLUE', scope: 'Driver',
          msg: 'WAVED BLUE FLAG FOR CAR 2 (SAR) TIMED AT 16:17:17' },
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

    it('drops blue flags, which are per-car courtesy, not race state', () => {
        // 12 of the 21 flag messages at Australia 2023 are blue flags; left in
        // they take over the caption line.
        const r = buildRace(payload());
        const m = messagesUpTo(r, 2.0, 4);
        expect(m.some((x) => x.flag === 'BLUE')).toBe(false);
    });

    it('strips the original wall-clock stamp from a caption', () => {
        const p = payload();
        p.messages.push({ t: 1.2, lap: 2, cat: 'CarEvent', flag: '', scope: '',
                          msg: 'CAR 1 (VER) OFF TRACK TIMED AT 16:17:17' });
        const m = messagesUpTo(buildRace(p), 1.3, 1);
        expect(m[0].msg).toBe('CAR 1 (VER) OFF TRACK');
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

    it('stays ON the track while coming out and going back in', () => {
        // The bug this pins: interpolating x/y from the pit exit to the leader
        // drew a straight chord across the infield, so the safety car appeared
        // in open space and flew over the middle of the circuit.
        //
        // The leader is placed on the OPPOSITE side of the ring from the pit
        // exit, which is where a chord is at its worst — it passes through the
        // centre, a full radius off the track. A leader near the exit would
        // let the chord hug the ring and prove nothing.
        const p = payload();
        const R = 100;
        const ring = [];
        for (let i = 0; i < 72; i++) {
            const a = (i / 72) * Math.PI * 2;
            ring.push({ X: Math.cos(a) * R, Y: Math.sin(a) * R, D: i * 10 });
        }
        p.track_points = ring;
        p.pit_lane = [{ X: 0, Y: R }, { X: R, Y: 0 }];        // exit at angle 0
        const opposite = Math.PI * 0.95;                       // leader far side
        p.cars['1'] = {
            x: [0, 1, 2, 3, 4].map((k) => Math.cos(opposite + k * 0.01) * R),
            y: [0, 1, 2, 3, 4].map((k) => Math.sin(opposite + k * 0.01) * R),
            on: [1, 1, 1, 1, 1], pit: [0, 0, 0, 0, 0],
        };
        const r = buildRace(p);
        const offRing = (q) => Math.abs(Math.hypot(q.x, q.y) - R);

        // Mid-transit is the moment a chord is furthest from the track.
        const mid = safetyCarAt(r, SC_TRANSIT_S / 2, sc, '1');
        expect(offRing(mid)).toBeLessThan(R * 0.1);

        for (const t of [0, 1, 2, 3, 4, 5, 20, 96, 98, 100]) {
            const q = safetyCarAt(r, t, sc, '1');
            if (q) expect(offRing(q)).toBeLessThan(R * 0.1);
        }
    });

    it('starts its run at the pit exit and ends back there', () => {
        const r = buildRace(payload());
        const exit = r.pitLane[r.pitLane.length - 1];
        const startD = Math.hypot(
            safetyCarAt(r, 0, sc, '1').x - exit.X,
            safetyCarAt(r, 0, sc, '1').y - exit.Y);
        const endD = Math.hypot(
            safetyCarAt(r, sc.end, sc, '1').x - exit.X,
            safetyCarAt(r, sc.end, sc, '1').y - exit.Y);
        const midD = Math.hypot(
            safetyCarAt(r, 40, sc, '1').x - exit.X,
            safetyCarAt(r, 40, sc, '1').y - exit.Y);
        expect(startD).toBeLessThan(midD + 1e-9);
        expect(endD).toBeLessThan(midD + 1e-9);
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

    it('reports no gap at lights-out, when nobody has moved', () => {
        // Progress is zero for everyone at t=0; returning 0 seconds there
        // showed all twenty cars as LEADER.
        const r = buildRace(payload());
        for (const v of intervalsAt(r, 0).values()) expect(v).toBeNull();
    });

    it('produces a gap DURING lap one, not only after it', () => {
        // The seeded start plus sector-resolution timing is what makes this
        // possible; with lap crossings alone the column was dead until 98s.
        const r = buildRace(payload());
        const g = intervalsAt(r, 0.4);
        expect([...g.values()].some((v) => v != null)).toBe(true);
    });

    it('gives no gap to a driver who never reached a timing point', () => {
        const p = payload();
        p.crossings['16'] = [[0, 0]];       // retired before any sector
        expect(intervalsAt(buildRace(p), 1.0).get('16')).toBeNull();
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

    it('places a grid-position-ZERO car in the pit lane, not nowhere', () => {
        // F1 records a pit-lane start as grid 0. Treating that as falsy
        // dropped Ocon out of the Azerbaijan sprint grid completely.
        const p = payload();
        p.drivers[1].grid = 0;
        const r = buildRace(p);
        const g = gridSlots(r);
        expect(g.has('16')).toBe(true);
        expect(g.get('16').x).toBeCloseTo(r.pitLane[0].X, 4);
        expect(g.get('16').y).toBeCloseTo(r.pitLane[0].Y, 4);
    });

    it('lines a grid-zero car up behind the field when there is no pit lane', () => {
        const p = payload();
        p.drivers[1].grid = 0;
        p.pit_lane = null;
        const g = gridSlots(buildRace(p));
        expect(g.has('16')).toBe(true);
        expect(Number.isFinite(g.get('16').x)).toBe(true);
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

describe('standingsAt', () => {
    it('orders by gap, so the tower can never contradict its own numbers', () => {
        // The bug: rows came from the last completed lap while gaps came from
        // the live clock, so a car that had passed on the road showed a
        // smaller gap from a lower row. 718 samples of that in one race.
        const r = buildRace(payload());
        for (const t of [0.4, 0.9, 1.2, 1.65, 2.0]) {
            const { order, gaps } = standingsAt(r, t);
            const vals = order.map((n) => gaps.get(n)).filter((v) => v != null);
            for (let i = 1; i < vals.length; i++) {
                expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1] - 1e-9);
            }
        }
    });

    it('puts the car furthest along at the top', () => {
        const r = buildRace(payload());
        // LEC completes lap 2 first, so just after that he leads on the road
        expect(standingsAt(r, 1.55).order[0]).toBe('16');
        // VER completes lap 3 first
        expect(standingsAt(r, 2.45).order[0]).toBe('1');
    });

    it('sorts cars with no timing yet to the bottom, by grid', () => {
        const p = payload();
        p.crossings['16'] = [[0, 0]];
        const { order } = standingsAt(buildRace(p), 1.0);
        expect(order[order.length - 1]).toBe('16');
    });
});

describe('the racing clock (red-flag stoppages)', () => {
    // Realistic magnitudes on purpose: a red flag is minutes, and the detector
    // ignores crossing-free stretches shorter than MIN_DEAD_S because those
    // are racing, not a stoppage.
    const stopped = () => {
        const p = payload();
        p.duration = 900;
        p.status = [
            { code: '1', name: 'CLEAR', start: 0, end: 100 },
            { code: '5', name: 'RED FLAG', start: 100, end: 400 },
            { code: '1', name: 'CLEAR', start: 400, end: 900 },
        ];
        // The track status clears at 400 — that is the field being released to
        // the grid. The GREEN is at 480, and only session_status knows it.
        p.stoppages = [[100, 480]];
        // Cars keep crossing until 130 (finishing the lap, driving to the
        // pits), then nothing until 520 — 40 s after the green, which is how
        // long it takes to reach the first sector marker from a standing
        // start. Those 40 s are racing and must survive.
        p.crossings = {
            '1': [[0, 0], [1, 80], [2, 130], [3, 520], [4, 600], [5, 700]],
            '16': [[0, 0], [1, 90], [2, 140], [3, 535], [4, 620], [5, 720]],
        };
        return buildRace(p);
    };

    it('removes only the stretch where nothing was recorded', () => {
        const r = stopped();
        // dead = [140, 520] — last crossing before the stop, first after it
        expect(r.redSpans).toHaveLength(1);
        expect(r.redSpans[0][0]).toBeCloseTo(140, 6);
        expect(r.redSpans[0][1]).toBeCloseTo(480, 6);
    });

    it('freezes the clock while the race is stopped', () => {
        const r = stopped();
        expect(r.toRacing(100)).toBeCloseTo(100, 6);
        expect(r.toRacing(140)).toBeCloseTo(140, 6);
        expect(r.toRacing(300)).toBeCloseTo(140, 6);   // mid-stoppage: frozen
        expect(r.toRacing(480)).toBeCloseTo(140, 6);   // the green
        expect(r.toRacing(520)).toBeCloseTo(180, 6);   // 40 s of racing kept
        expect(r.toRacing(600)).toBeCloseTo(260, 6);   // resumes after
    });

    it('never collapses two real crossings onto the same instant', () => {
        // The flag comes out before the field stops — cars finish the lap and
        // drive to the pits, recording sectors on the way. Freezing from the
        // flag instant mapped three of Verstappen's crossings to one racing
        // time and blew the gaps out to +164 and +308 s.
        const r = stopped();
        const ts = r.crossings['1'].map(([, t]) => t);
        expect(new Set(ts).size).toBe(ts.length);
        for (let i = 1; i < ts.length; i++) {
            expect(ts[i]).toBeGreaterThan(ts[i - 1]);
        }
    });

    it('does not let the gap grow while everyone is parked', () => {
        // The reported bug: every car read +346s and climbing under the flag.
        const r = stopped();
        const a = intervalsAt(r, 200).get('16');
        const b = intervalsAt(r, 390).get('16');
        expect(a).not.toBeNull();
        expect(a).toBeCloseTo(b, 6);
        expect(b).toBeLessThan(30);
    });

    it('keeps gaps sane AFTER the restart', () => {
        // And the worse half: +437 to +496 s once running again, because the
        // stoppage was also sitting inside the leader's own timing series.
        const r = stopped();
        // Sample only where both cars still have timing ahead of them: past
        // the last recorded crossing every car's progress pins to the final
        // lap and the "gap" is just elapsed time since it, which is a
        // property of the fixture ending, not of the clock.
        for (const t of [530, 600, 690]) {
            for (const v of intervalsAt(r, t).values()) {
                if (v != null) expect(v).toBeLessThan(30);
            }
        }
    });

    it('stores the timing points themselves on the racing clock', () => {
        // Pinned directly rather than inferred from gap sizes: a gap is fairly
        // insensitive to this (the distortion partly cancels between the two
        // series being compared), but PROGRESS is not.
        const r = stopped();
        const t1 = r.crossings['1'].map(([, t]) => t);
        expect(t1[1]).toBeCloseTo(80, 6);            // before the stop: untouched
        expect(t1[2]).toBeCloseTo(140, 6);           // the grid, at the instant of rest
        expect(t1[3]).toBeCloseTo(520 - 340, 6);     // 340s of dead time removed
    });

    it('puts the field back on the grid, so the restart starts level', () => {
        // What the stoppage is FOR, from the user's side: a standing restart
        // lines every car up on the grid, so at the green nobody is ahead of
        // anybody. Carrying the pre-flag spread across it had the tail of the
        // field 28 s down on a leader they were sitting beside.
        const r = stopped();
        for (const v of intervalsAt(r, 480).values()) {
            if (v != null) expect(v).toBeLessThan(0.5);
        }
        // And it is a restart, not a freeze: the gaps open up again after it.
        const after = [...intervalsAt(r, 600).values()].filter((v) => v != null);
        expect(Math.max(...after)).toBeGreaterThan(1);
    });

    it('survives a second stoppage with every crossing intact', () => {
        // Australia 2023 has three. The anchor from the first one was left on
        // the end of the array instead of in time order, so the second read
        // the wrong progress, judged the field forty laps down and deleted
        // 129 of Magnussen's 154 crossings — he sat at +2414 s from lap 9 on.
        const p = payload();
        p.duration = 2000;
        p.stoppages = [[100, 480], [900, 1300]];
        // '16' is the Magnussen case: running between the two stoppages, then
        // nothing after the second. With the anchor sitting on the end of his
        // array instead of in time order, reading his progress ran off the end
        // and came back with where he was at the FIRST restart.
        p.crossings = {
            '1': [[0, 0], [1, 80], [2, 130], [3, 520], [4, 600], [5, 700],
                  [6, 800], [7, 880], [8, 1340], [9, 1420], [10, 1500]],
            '16': [[0, 0], [1, 90], [2, 140], [3, 535], [4, 620], [5, 720],
                   [6, 820], [7, 890]],
        };
        const r = buildRace(p);
        for (const [num, raw] of Object.entries(p.crossings)) {
            const kept = r.crossings[num];
            // Every real point is still there, plus one anchor per stoppage.
            expect(kept.length).toBeGreaterThanOrEqual(raw.length);
            for (let i = 1; i < kept.length; i++) {
                expect(kept[i][0]).toBeGreaterThan(kept[i - 1][0]);
                expect(kept[i][1]).toBeGreaterThan(kept[i - 1][1]);
            }
            // Nobody is sent backwards. The tolerance is one grid slot: a car
            // lining up behind the leader really is a few metres back, and
            // that is what the restart anchor says. A lost LAP is what this is
            // watching for.
            const far = Math.max(...raw.map(([prog]) => prog));
            expect(kept[kept.length - 1][0]).toBeGreaterThan(far - 0.01);
        }
        // And the gaps stay sane the whole way through. Each car is only
        // checked while it still has timing ahead of it — past a car's last
        // crossing its progress pins and the "gap" is just elapsed time
        // since, which is what the tower shows as OUT rather than a number.
        const lastOf = Object.fromEntries(Object.entries(r.crossings)
            .map(([num, rows]) => [num, rows[rows.length - 1][1]]));
        for (let t = 5; t < 1480; t += 5) {
            const rt = r.toRacing(t);
            for (const [num, v] of intervalsAt(r, t)) {
                if (v != null && rt < lastOf[num]) expect(v).toBeLessThan(60);
            }
        }
    });

    it('takes the green from session_status, not the track status', () => {
        // The whole point of the stoppages field. Trusting the red-flag track
        // status would have resumed the clock at 400 and fed 80 s of standing
        // still into every interpolation through the restart.
        const r = stopped();
        expect(r.redSpans[0][1]).toBeCloseTo(480, 6);
        expect(r.toRacing(470)).toBeCloseTo(140, 6);
    });

    it('falls back to the red-flag track status without a stoppages field', () => {
        // Payloads cached before the backend learned to emit it.
        const p = payload();
        p.duration = 900;
        p.status = [{ code: '5', name: 'RED FLAG', start: 100, end: 400 }];
        p.crossings = {
            '1': [[0, 0], [1, 80], [2, 130], [3, 520], [4, 600]],
            '16': [[0, 0], [1, 90], [2, 140], [3, 535], [4, 620]],
        };
        const r = buildRace(p);
        expect(r.redSpans).toHaveLength(1);
        expect(r.redSpans[0]).toEqual([140, 400]);
    });

    it('ignores a short crossing-free stretch, which is just racing', () => {
        const p = payload();
        p.duration = 900;
        p.status = [{ code: '5', name: 'RED FLAG', start: 100, end: 120 }];
        p.crossings = { '1': [[0, 0], [1, 95], [2, 125]], '16': [[0, 0], [1, 99], [2, 130]] };
        expect(buildRace(p).redSpans).toEqual([]);
    });

    it('leaves a race with no red flag completely unchanged', () => {
        const r = buildRace(payload());
        expect(r.toRacing(12.34)).toBeCloseTo(12.34, 6);
        expect(r.redSpans).toEqual([]);
    });
});


describe('aheadAt', () => {
    // Three cars, evenly strung out: the leader, one 10 s back, one 25 s back.
    const strung = () => {
        const p = payload();
        p.total_laps = 4;
        p.duration = 400;
        p.drivers.push({ number: '4', code: 'NOR', team: 'McLaren', color: '#FF8000', grid: 3, out_at: 400, status: 'Finished' });
        p.cars['4'] = p.cars['16'];
        for (const d of p.drivers) d.out_at = 400;
        p.crossings = {
            '1': [[0, 0], [1, 100], [2, 200], [3, 300], [4, 400]],
            '16': [[0, 0], [1, 110], [2, 210], [3, 310], [4, 410]],
            '4': [[0, 0], [1, 125], [2, 225], [3, 325], [4, 425]],
        };
        p.order = [[1, '1', 1], [1, '16', 2], [1, '4', 3]];
        return buildRace(p);
    };

    it('reports the gap to the car in front, not to the leader', () => {
        const r = strung();
        const lead = intervalsAt(r, 250);
        const ahead = aheadAt(r, 250);
        // Third place is 25 s off the leader but only 15 s off second.
        expect(lead.get('4')).toBeCloseTo(25, 1);
        expect(ahead.get('4')).toBeCloseTo(15, 1);
        expect(ahead.get('16')).toBeCloseTo(10, 1);
    });

    it('gives the leader nothing to chase', () => {
        expect(aheadAt(strung(), 250).get('1')).toBeNull();
    });

    it('adds back up to the gap to the leader', () => {
        // The two columns are two views of one set of numbers; if they ever
        // disagree the tower is telling the viewer two different stories.
        const r = strung();
        for (const t of [150, 250, 350]) {
            const lead = intervalsAt(r, t);
            const ahead = aheadAt(r, t);
            const { order } = standingsAt(r, t);
            let sum = 0;
            for (const num of order) {
                const a = ahead.get(num);
                if (a == null) continue;
                sum += a;
                expect(sum).toBeCloseTo(lead.get(num), 6);
            }
        }
    });

    it('never reports a negative interval', () => {
        const r = strung();
        for (let t = 5; t < 400; t += 5) {
            for (const v of aheadAt(r, t).values()) {
                if (v != null) expect(v).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('says nothing for a car with no timing yet', () => {
        const r = strung();
        for (const v of aheadAt(r, 0).values()) expect(v).toBeNull();
    });
});

describe('strategyRows', () => {
    it('lists the field in finishing order', () => {
        const rows = strategyRows(buildRace(payload()));
        expect(rows.map((r) => r.code)).toEqual(['VER', 'LEC']);
        expect(rows[0].pos).toBe(1);
    });

    it('takes the order from the classification, not from the payload', () => {
        // The cars arrive in whatever order the payload lists them, which on
        // a real race is the order they qualified. A strategy chart in grid
        // order is a different chart.
        const p = payload();
        p.drivers[0].finish = 2;            // VER classified second
        p.drivers[1].finish = 1;            // LEC wins
        expect(strategyRows(buildRace(p)).map((r) => r.code)).toEqual(['LEC', 'VER']);
    });

    it('lets the classification beat the last lap at the flag', () => {
        // Per-lap positions are the order DURING a lap, so the last one
        // predates whatever happened on it. Abu Dhabi 2023 has Perez second on
        // lap 58 because Leclerc and Russell both passed him on it, and the
        // chart sits directly above the table that says he was fourth.
        const p = payload();
        p.order = [
            [1, '1', 1], [1, '16', 2],
            [3, '1', 1], [3, '16', 2],      // the lap column says VER leads
        ];
        p.drivers[0].finish = 2;
        p.drivers[1].finish = 1;            // the classification says LEC won
        const r = buildRace(p);
        // At the flag, the stewards.
        expect(strategyRows(r, 3).map((x) => x.code)).toEqual(['LEC', 'VER']);
        // Before it, the race — there is no classification yet.
        expect(strategyRows(r, 1).map((x) => x.code)).toEqual(['VER', 'LEC']);
        expect(strategyRows(r, 2).map((x) => x.code)).toEqual(['VER', 'LEC']);
    });

    it('classifies a retirement where the stewards did', () => {
        // The FIA ranks retirements too, and the table below shows them there.
        const p = payload();
        p.drivers.push({ number: '4', code: 'NOR', team: 'McLaren', color: '#FF8000', grid: 3, out_at: 1, finish: 3, status: 'Retired' });
        p.cars['4'] = p.cars['16'];
        p.order.push([1, '4', 3], [2, '4', 3]);
        const rows = strategyRows(buildRace(p));
        expect(rows.map((x) => x.code)).toEqual(['VER', 'LEC', 'NOR']);
        expect(rows[2]).toMatchObject({ pos: 3, out: true });
    });

    it('classifies a car that finished a lap down', () => {
        // A lapped car never crosses the line on the final lap, so reading the
        // order off that lap alone dropped it out of the classification: at
        // Abu Dhabi 2023 both Bottas and Magnussen finished and both came out
        // as retirements.
        const p = payload();
        p.drivers.push({ number: '4', code: 'NOR', team: 'McLaren', color: '#FF8000', grid: 3, out_at: 2, status: 'Lapped' });
        p.cars['4'] = p.cars['16'];
        p.order.push([1, '4', 3], [2, '4', 3]);      // never seen on lap 3
        const rows = strategyRows(buildRace(p));
        const nor = rows.find((r) => r.code === 'NOR');
        expect(nor.pos).toBe(3);                     // classified, not a dash
        expect(rows.map((r) => r.code)).toEqual(['VER', 'LEC', 'NOR']);
    });

    it('does not hand a retirement its classified place before the flag', () => {
        const p = payload();
        p.drivers.push({ number: '4', code: 'NOR', team: 'McLaren', color: '#FF8000', grid: 3, out_at: 1, finish: 3, status: 'Retired' });
        p.cars['4'] = p.cars['16'];
        p.order.push([1, '4', 3], [2, '4', 3]);
        expect(strategyRows(buildRace(p), 2).find((x) => x.code === 'NOR').pos)
            .toBe(3);                        // still running on lap 2
        const r3 = strategyRows(buildRace(p), 3).find((x) => x.code === 'NOR');
        expect(r3.out).toBe(true);
    });

    it('still calls a retirement a retirement', () => {
        const p = payload();
        p.drivers.push({ number: '4', code: 'NOR', team: 'McLaren', color: '#FF8000', grid: 3, out_at: 1, status: 'Retired' });
        p.cars['4'] = p.cars['16'];
        p.order.push([1, '4', 3], [2, '4', 3]);
        expect(strategyRows(buildRace(p)).find((r) => r.code === 'NOR').pos).toBeNull();
    });

    it('orders two retirements on the same lap by who was ahead', () => {
        const p = payload();
        for (const [num, code, pos] of [['4', 'NOR', 3], ['5', 'PIA', 4]]) {
            p.drivers.push({ number: num, code, team: 'McLaren', color: '#FF8000', grid: 5, out_at: 1, status: 'Retired' });
            p.cars[num] = p.cars['16'];
            p.order.push([1, num, pos], [2, num, pos]);
        }
        expect(strategyRows(buildRace(p)).map((r) => r.code))
            .toEqual(['VER', 'LEC', 'NOR', 'PIA']);
    });

    it('puts a retirement last, and the one who lasted longest first', () => {
        const p = payload();
        // LEC is classified on the final lap; a third car stops on lap 2.
        p.drivers.push({ number: '4', code: 'NOR', team: 'McLaren', color: '#FF8000', grid: 3, out_at: 1, status: 'Retired' });
        p.cars['4'] = p.cars['16'];
        p.order.push([1, '4', 3], [2, '4', 3]);
        const rows = strategyRows(buildRace(p));
        expect(rows.map((r) => r.code)).toEqual(['VER', 'LEC', 'NOR']);
        expect(rows[2].pos).toBeNull();
        expect(rows[2].lastLap).toBe(2);
    });

    it('carries the tyres each driver ran', () => {
        const rows = strategyRows(buildRace(payload()));
        expect(rows[0].stints.map((s) => s.compound)).toEqual(['MEDIUM', 'HARD']);
        expect(rows[0].stints[0]).toMatchObject({ from: 1, to: 2, fresh: true });
    });

    it('gives a stop its stationary time, not its pit-lane window', () => {
        // 4.1 s is a pit stop. The 25.3 s window around it is what the stop
        // COST, which is a different number and not the one on the label.
        const rows = strategyRows(buildRace(payload()));
        expect(rows[0].stops).toEqual([{ lap: 2, stopped: 4.1, redFlag: false }]);
    });

    it('refuses to call a red-flag window a pit stop', () => {
        // Australia 2023: every one of Verstappen's three stops was under a
        // red flag, stationary for 905, 847 and 1839 seconds. Printing that
        // next to a driver's name is not a pit stop by any reading.
        const rows = strategyRows(buildRace(payload()));
        const lec = rows.find((r) => r.code === 'LEC');
        expect(lec.stops).toEqual([{ lap: 2, stopped: null, redFlag: true }]);
    });

    it('stops at the lap it is asked for', () => {
        // The whole point: drawn complete from the first frame the chart gives
        // away the winner's strategy and every retirement on lap two.
        const r = buildRace(payload());
        const early = strategyRows(r, 1);
        const ver = early.find((x) => x.code === 'VER');
        expect(ver.stints.map((x) => x.compound)).toEqual(['MEDIUM']);
        expect(ver.stints[0].to).toBe(1);            // clipped, not lap 2
        expect(ver.stops).toEqual([]);               // he stops on lap 2
    });

    it('lets a stint grow as the race runs', () => {
        const r = buildRace(payload());
        const ver = (n) => strategyRows(r, n).find((x) => x.code === 'VER');
        expect(ver(1).stints[0].to).toBe(1);
        expect(ver(2).stints[0].to).toBe(2);
        expect(ver(3).stints).toHaveLength(2);
    });

    it('shows the stops that have happened, and no others', () => {
        const r = buildRace(payload());
        expect(strategyRows(r, 1).find((x) => x.code === 'VER').stops).toEqual([]);
        expect(strategyRows(r, 2).find((x) => x.code === 'VER').stops)
            .toEqual([{ lap: 2, stopped: 4.1, redFlag: false }]);
    });

    it('orders by the running order at that lap, not by the flag', () => {
        // Leclerc leads lap 2 and Verstappen wins. On lap 2 the chart says
        // Leclerc.
        const rows = strategyRows(buildRace(payload()), 2);
        expect(rows.map((x) => x.code)).toEqual(['LEC', 'VER']);
        expect(rows[0].pos).toBe(1);
        // and at the flag it says Verstappen
        expect(strategyRows(buildRace(payload())).map((x) => x.code))
            .toEqual(['VER', 'LEC']);
    });

    it('keeps a car that retires later in the running until it does', () => {
        const p = payload();
        p.drivers.push({ number: '4', code: 'NOR', team: 'McLaren', color: '#FF8000', grid: 3, out_at: 1, status: 'Retired' });
        p.cars['4'] = p.cars['16'];
        p.order.push([1, '4', 3], [2, '4', 3]);
        const r = buildRace(p);
        expect(strategyRows(r, 1).find((x) => x.code === 'NOR').out).toBe(false);
        expect(strategyRows(r, 3).find((x) => x.code === 'NOR').out).toBe(true);
    });

    it('defaults to the whole race, and never runs past it', () => {
        const r = buildRace(payload());
        expect(strategyRows(r)).toEqual(strategyRows(r, r.totalLaps));
        expect(strategyRows(r, 999)).toEqual(strategyRows(r, r.totalLaps));
        expect(strategyRows(r, 0)).toEqual(strategyRows(r, 1));
        expect(strategyRows(r, -5)).toEqual(strategyRows(r, 1));
    });

    it('is safe for a driver with no stints and no stops', () => {
        const p = payload();
        delete p.stints['1'];
        p.pits = [];
        const rows = strategyRows(buildRace(p));
        expect(rows.every((r) => Array.isArray(r.stints) && Array.isArray(r.stops))).toBe(true);
    });

    it('copies the stints rather than handing out the originals', () => {
        const race = buildRace(payload());
        strategyRows(race)[0].stints[0].compound = 'MUTATED';
        expect(race.stints['1'][0].compound).toBe('MEDIUM');
    });
});


describe('namedStop', () => {
    // One rule, because two screens print it: the tower badge while a car is
    // in the box, and the chart's fastest-stop line. If they disagreed, the
    // race would have two different fastest stops.
    it('reports a real tyre change', () => {
        expect(namedStop(2.7, false)).toBe(2.7);
        expect(namedStop(4.6, false)).toBe(4.6);
    });

    it('refuses a red-flag window', () => {
        // Australia 2023: Verstappen stationary for 905, 847 and 1839 s.
        expect(namedStop(905.2, true)).toBeNull();
        // Even a short one, because the field was parked, not serviced.
        expect(namedStop(3.0, true)).toBeNull();
    });

    it('refuses anything longer than a stop can be', () => {
        expect(namedStop(STOP_MAX_S + 0.1, false)).toBeNull();
        expect(namedStop(58.0, false)).toBeNull();
        expect(namedStop(STOP_MAX_S, false)).toBe(STOP_MAX_S);
    });

    it('refuses a stop it has no time for', () => {
        expect(namedStop(null, false)).toBeNull();
        expect(namedStop(undefined, false)).toBeNull();
        expect(namedStop(0, false)).toBeNull();
    });
});


describe('traceRows', () => {
    it('gives every driver their lap-by-lap position', () => {
        const rows = traceRows(buildRace(payload()));
        const ver = rows.find((r) => r.code === 'VER');
        expect(ver.points).toEqual([[1, 1], [2, 2], [3, 1]]);
    });

    it('stops at the lap it is asked for', () => {
        // A line that already reaches the flag has told you the result.
        const ver = traceRows(buildRace(payload()), 2).find((r) => r.code === 'VER');
        expect(ver.points).toEqual([[1, 1], [2, 2]]);
        expect(ver.last).toEqual([2, 2]);
    });

    it('draws the leader last, so their line sits on top', () => {
        const rows = traceRows(buildRace(payload()));
        expect(rows[rows.length - 1].code).toBe('VER');   // P1 on lap 3
    });

    it('lets a line simply stop where the driver did', () => {
        // Carried along the bottom instead, a retirement draws as a car still
        // circulating in last place — which is a different thing that also
        // happens.
        const p = payload();
        p.drivers.push({ number: '4', code: 'NOR', team: 'McLaren', color: '#FF8000', grid: 3, out_at: 1, status: 'Retired' });
        p.cars['4'] = p.cars['16'];
        p.order.push([1, '4', 3], [2, '4', 3]);
        const nor = traceRows(buildRace(p)).find((r) => r.code === 'NOR');
        expect(nor.points).toEqual([[1, 3], [2, 3]]);
        expect(nor.points.some(([lap]) => lap === 3)).toBe(false);
    });

    it('leaves out a driver who never took a position', () => {
        const p = payload();
        p.drivers.push({ number: '4', code: 'NOR', team: 'McLaren', color: '#FF8000', grid: 3, out_at: 0, status: 'Retired' });
        p.cars['4'] = p.cars['16'];
        expect(traceRows(buildRace(p)).some((r) => r.code === 'NOR')).toBe(false);
    });

    it('never runs past the race', () => {
        const r = buildRace(payload());
        expect(traceRows(r, 999)).toEqual(traceRows(r, r.totalLaps));
        expect(traceRows(r, 0)).toEqual(traceRows(r, 1));
    });

    it('returns the laps in order whatever order the payload lists them', () => {
        const p = payload();
        p.order = [[3, '1', 1], [1, '1', 1], [2, '1', 2], [1, '16', 2], [2, '16', 1], [3, '16', 2]];
        const ver = traceRows(buildRace(p)).find((r) => r.code === 'VER');
        expect(ver.points.map(([lap]) => lap)).toEqual([1, 2, 3]);
    });
});


describe('lap times', () => {
    it('reads a driver’s lap straight from the payload', () => {
        const r = buildRace(payload());
        expect(lapTimeAt(r, '1', 2)).toBe(90.1);
        expect(lapTimeAt(r, '16', 3)).toBe(90.6);
    });

    it('says nothing for a lap that was never completed', () => {
        const r = buildRace(payload());
        expect(lapTimeAt(r, '1', 9)).toBeNull();
        expect(lapTimeAt(r, 'nobody', 1)).toBeNull();
    });

    it('finds a lap even when a driver missed one', () => {
        // The index shortcut only works while nobody has skipped a lap.
        const p = payload();
        p.lap_times['1'] = [[1, 92.5], [3, 91.8]];
        const r = buildRace(p);
        expect(lapTimeAt(r, '1', 3)).toBe(91.8);
        expect(lapTimeAt(r, '1', 2)).toBeNull();
    });

    it('gives a best that is only as good as the race so far', () => {
        // A best-lap column that already knows about lap 3 on lap 1 is
        // showing the viewer the future.
        const r = buildRace(payload());
        expect(bestLapUpTo(r, '1', 1)).toBe(92.5);
        expect(bestLapUpTo(r, '1', 2)).toBe(90.1);
        expect(bestLapUpTo(r, '1', 3)).toBe(90.1);
        expect(bestLapUpTo(r, '1', 0)).toBeNull();
    });

    it('finds the purple lap of the race so far', () => {
        const r = buildRace(payload());
        expect(fastestLapUpTo(r, 1)).toMatchObject({ number: '1', lap: 1, time: 92.5 });
        // Leclerc goes quicker on lap 2 and takes it.
        expect(fastestLapUpTo(r, 2)).toMatchObject({ number: '16', lap: 2, time: 89.4 });
        expect(fastestLapUpTo(r, 3)).toMatchObject({ number: '16', lap: 2, time: 89.4 });
    });

    it('has no purple lap before anyone completes one', () => {
        expect(fastestLapUpTo(buildRace(payload()), 0)).toBeNull();
    });

    it('leaves a shared time with whoever set it first', () => {
        const p = payload();
        p.lap_times = { '1': [[2, 90.0]], '16': [[1, 90.0]] };
        expect(fastestLapUpTo(buildRace(p), 3)).toMatchObject({ number: '16', lap: 1 });
    });

    it('is safe on a payload with no lap times at all', () => {
        const p = payload();
        delete p.lap_times;
        const r = buildRace(p);
        expect(lapTimeAt(r, '1', 1)).toBeNull();
        expect(bestLapUpTo(r, '1', 3)).toBeNull();
        expect(fastestLapUpTo(r, 3)).toBeNull();
    });
});
