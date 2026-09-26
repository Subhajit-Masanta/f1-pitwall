import { describe, it, expect } from 'vitest';
import { buildRace } from './race';
import { directorShot, SHOT_MIN_S, BATTLE_GAP_S, BATTLE_KEEP_S } from './director';

const FRAMES = 301;                       // 1 Hz, five minutes
const arr = (fn) => Array.from({ length: FRAMES }, (_, i) => fn(i));

/** Five laps at a constant pace, as crossings. */
const laps = (pace) => [0, 1, 2, 3, 4, 5].map((l) => [l, l * pace]);

/**
 * A race whose only variable is how fast each car is. Constant pace means the
 * gaps are arithmetic and every expectation below can be worked out by hand.
 */
const build = ({ paces, out = {}, pits = [], status = null, lane = {} }) => buildRace({
    race: 'Director Grand Prix',
    circuit: 'Testville',
    total_laps: 5,
    rotation: 0,
    hz: 1,
    frames: FRAMES,
    duration: 300,
    track_points: [{ X: 0, Y: 0, D: 0 }, { X: 100, Y: 0, D: 100 }],
    drivers: Object.keys(paces).map((num, i) => ({
        number: num, code: `D${num}`, team: 'T', color: '#fff',
        grid: i + 1, finish: i + 1, status: 'Finished',
        out_at: out[num] ?? Infinity,
    })),
    cars: Object.fromEntries(Object.keys(paces).map((num) => [num, {
        x: arr((i) => i), y: arr(() => 0), on: arr(() => 1),
        // A car is IN THE LANE for much longer than it is stationary in its
        // box, so the two are described separately here.
        pit: arr((i) => {
            const [a, b] = lane[num] || [];
            if (a != null && i >= a && i <= b) return 1;
            return pits.some((p) => p.driver === num
                && i >= p.t && i <= p.t + (p.stopped || 0)) ? 1 : 0;
        }),
    }])),
    crossings: Object.fromEntries(
        Object.entries(paces).map(([num, pace]) => [num, laps(pace)]),
    ),
    lap_starts: [[1, 0], [2, 60], [3, 120], [4, 180], [5, 240]],
    order: [],
    stints: {},
    lap_times: {},
    pits,
    status: status || [{ code: '1', name: 'CLEAR', start: 0, end: 300 }],
    messages: [],
    weather: [],
});

/** Leader clear by three seconds; nobody within a second of anybody. */
const spread = () => build({ paces: { 1: 60, 16: 62, 44: 65, 11: 80 } });

/** Same race, but second place is four tenths off the lead. */
const fight = () => build({ paces: { 1: 60, 16: 60.4, 44: 65, 11: 80 } });

/**
 * A field posed at exactly the gaps you ask for, at t = 100.
 *
 * With constant pace a car's progress at time t is t/pace and the leader's
 * time at that progress is 60·t/pace, so its gap to the leader is
 * 100 − 6000/pace — which inverts to the pace that produces a wanted gap.
 * That makes a fixture readable as the thing under test: a list of gaps.
 */
const paceFor = (gap) => 6000 / (100 - gap);
const gapped = (gaps) => build({
    paces: Object.fromEntries(gaps.map((g, i) => [String(i + 1), paceFor(g)])),
});

describe('directorShot', () => {
    it('sits on the leader when the field is strung out', () => {
        const shot = directorShot(spread(), 100);
        expect(shot.driver).toBe('1');
        expect(shot.reason).toBe('leader');
        expect(shot.since).toBe(100);
    });

    it('cuts to the closest fight, and follows the car BEHIND', () => {
        const race = fight();
        // Sanity: the gap this is reacting to really is under the threshold.
        const shot = directorShot(race, 100);
        expect(shot.reason).toBe('battle');
        expect(shot.driver).toBe('16');
    });

    it('leaves a fight alone once it is wider than the threshold', () => {
        // 65 vs 60 is several seconds apart all race; only 60.4 is a battle.
        const shot = directorShot(build({ paces: { 1: 60, 44: 65 } }), 100);
        expect(shot.reason).toBe('leader');
        expect(BATTLE_GAP_S).toBe(1.0);
    });

    it('HOLDS the current shot for the minimum, whatever it would rather do', () => {
        const race = spread();
        const prev = { driver: '16', reason: 'battle', since: 98 };
        // The natural answer here is the leader, but the shot is 2s old.
        expect(directorShot(race, 100, prev)).toBe(prev);
    });

    it('cuts once the hold has expired', () => {
        const race = spread();
        const prev = { driver: '16', reason: 'battle', since: 100 - SHOT_MIN_S };
        const shot = directorShot(race, 100, prev);
        expect(shot.driver).toBe('1');
        expect(shot.reason).toBe('leader');
    });

    it('carries `since` forward while the same shot continues', () => {
        const race = spread();
        const first = directorShot(race, 100);
        const later = directorShot(race, 140, first);
        // Same shot, not a re-cut — otherwise every second would look like a
        // new one and the minimum hold would never be reached.
        expect(later).toBe(first);
        expect(later.since).toBe(100);
    });

    it('treats scrubbing backwards as a cut, not as a hold', () => {
        const race = spread();
        const prev = { driver: '16', reason: 'battle', since: 200 };
        const shot = directorShot(race, 100, prev);
        expect(shot).not.toBe(prev);
        expect(shot.driver).toBe('1');
    });

    it('cuts to a pit stop even inside the hold', () => {
        const race = build({
            paces: { 1: 60, 16: 62, 44: 65 },
            pits: [{ driver: '44', lap: 2, t: 130, window: 25, stopped: 3, red_flag: false }],
        });
        const prev = { driver: '1', reason: 'leader', since: 129 };
        const shot = directorShot(race, 131, prev);
        expect(shot.reason).toBe('pit');
        expect(shot.driver).toBe('44');
    });

    it('ignores a red-flag "stop" — the field is parked, not being serviced', () => {
        const race = build({
            paces: { 1: 60, 16: 62, 44: 65 },
            pits: [{ driver: '44', lap: 2, t: 130, window: 900, stopped: 880, red_flag: true }],
        });
        expect(directorShot(race, 200).reason).not.toBe('pit');
    });

    it('pulls out to the wide shot under a red flag', () => {
        const race = build({
            paces: { 1: 60, 16: 62 },
            status: [
                { code: '1', name: 'CLEAR', start: 0, end: 200 },
                { code: '5', name: 'RED', start: 200, end: 220 },
                { code: '1', name: 'CLEAR', start: 220, end: 300 },
            ],
        });
        const shot = directorShot(race, 210, { driver: '1', reason: 'leader', since: 209 });
        expect(shot.driver).toBe(null);
        expect(shot.reason).toBe('flag');
    });

    it('never follows a car that has retired', () => {
        const race = build({ paces: { 1: 60, 16: 62, 44: 65 }, out: { 1: 150 } });
        const shot = directorShot(race, 200);
        expect(shot.driver).toBe('16');
    });

    it('drops a held shot the moment its driver retires', () => {
        const race = build({ paces: { 1: 60, 16: 62, 44: 65 }, out: { 1: 150 } });
        const prev = { driver: '1', reason: 'leader', since: 199 };
        expect(directorShot(race, 200, prev).driver).toBe('16');
    });

    it('does not call a car crawling down the pit lane a battle', () => {
        // Its gap on the road collapses to nothing while it is in the lane,
        // which would otherwise read as the closest fight of the race.
        //
        // The car is in the LANE here but not being serviced, so the pit shot
        // cannot mask the thing under test: without the filter this comes back
        // as a battle with '16', which is a car nobody is racing.
        const race = build({
            paces: { 1: 60, 16: 60.4, 44: 65 },
            lane: { 16: [90, 120] },
        });
        const shot = directorShot(race, 100);
        expect(shot.driver).toBe('1');
        expect(shot.reason).toBe('leader');
    });

    it('prefers a fight at the FRONT to a closer one at the back', () => {
        // 0.9 s for the lead against 0.3 s for ninth. Smallest-gap-wins picks
        // the one nobody would put on television.
        const race = gapped([0, 0.9, 3, 5, 7, 9, 11, 13, 15, 15.3]);
        const shot = directorShot(race, 100);
        expect(shot.reason).toBe('battle');
        expect(shot.driver).toBe('2');
    });

    it('STAYS with the fight it is showing when a rival is only a little better', () => {
        // P5 is 0.5 s behind P4; P2 is 0.9 s behind P1. On score the midfield
        // pair wins, and with no shot on screen that is what it cuts to...
        const race = gapped([0, 0.9, 3, 5, 5.5, 8, 10, 12, 14, 16]);
        expect(directorShot(race, 100).driver).toBe('5');

        // ...but a camera already on the fight for the lead stays there. A
        // director that re-picked the best pair every second would hop between
        // the five pairs a twenty-car field always has within a second.
        const prev = { driver: '2', reason: 'battle', since: 50 };
        expect(directorShot(race, 100, prev)).toBe(prev);
    });

    it('lets a fight go once it has widened past the keep threshold', () => {
        const race = gapped([0, 2.0, 3.0, 3.5, 6, 8, 10, 12, 14, 16]);
        const prev = { driver: '2', reason: 'battle', since: 50 };
        const shot = directorShot(race, 100, prev);
        expect(shot).not.toBe(prev);
        expect(shot.driver).toBe('4');
        expect(BATTLE_KEEP_S).toBeGreaterThan(BATTLE_GAP_S);
    });

    it('does not cut to a pair that is close but not yet a fight', () => {
        // Between the two thresholds: near enough to keep, not near enough to
        // cut to. Nothing is on screen, so there is nothing to keep.
        const race = gapped([0, 1.3, 6, 9, 12, 15]);
        expect(directorShot(race, 100).reason).toBe('leader');
    });

    it('finishes a pit stop it is already showing', () => {
        // Half the field stops inside three laps; re-picking the best-placed
        // one every second cuts away half way through a stop.
        const race = build({
            paces: { 1: 60, 16: 62, 44: 65 },
            pits: [
                { driver: '44', lap: 2, t: 130, window: 25, stopped: 4, red_flag: false },
                { driver: '16', lap: 2, t: 131, window: 25, stopped: 4, red_flag: false },
            ],
        });
        const prev = { driver: '44', reason: 'pit', since: 130 };
        expect(directorShot(race, 132, prev)).toBe(prev);
    });
});
