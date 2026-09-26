/**
 * 📄 director.js — who the camera should be watching.
 *
 * A race replay with a following camera immediately raises the question the
 * viewer should not have to answer: follow WHO? Twenty cars, and the one worth
 * watching changes every thirty seconds. Broadcast solves this with a person
 * in a truck cutting between shots, and what that person is doing is mostly a
 * short list of rules — stay on the leader unless something better exists,
 * cut to a fight, cut to a pit stop, pull out for a flag.
 *
 * This is that list. It is deliberately pure and deliberately coarse: it runs
 * once a race-second, not once a frame, because a shot that changed sixty
 * times a second would not be a shot.
 *
 * THE ONE RULE THAT MAKES IT WATCHABLE is the minimum hold. Without it the
 * director sits on whichever pair happens to be closest this instant, and
 * since half a dozen pairs hover around a second apart for most of a race, the
 * camera hops between them continuously and the replay becomes unreadable. Six
 * seconds is about the shortest cut broadcast ever makes.
 */
import { standingsAt, statusAt, frameAt } from './race';

/** How long a shot is held before the director is allowed to cut again. */
export const SHOT_MIN_S = 12;

/** Cars closer than this START a fight worth cutting to. */
export const BATTLE_GAP_S = 1.0;

/**
 * ...and a fight already on screen stays one until it is wider than this.
 *
 * Two thresholds rather than one, for the same reason a thermostat has two:
 * with a single line at 1.0 s, a pair hovering either side of it is cut to and
 * away from every few seconds.
 */
export const BATTLE_KEEP_S = 1.6;

/**
 * What a place on the road is worth, in seconds of gap.
 *
 * Measured over Australia 2023, the closest pair on track at any instant is
 * almost never the pair worth watching: in a twenty-car field half a dozen
 * pairs sit within a second of each other all race, so "smallest gap" picked a
 * fight for fifteenth over a fight for the lead and changed its mind every six
 * seconds. Broadcast does not do this, because a fight for second is worth
 * more than a closer fight for fifteenth. A tenth of a second per place says
 * so: a 0.9 s fight for the lead beats a 0.3 s fight for tenth.
 */
export const POS_WEIGHT = 0.1;

/**
 * How much better a rival fight must score before the camera leaves the one it
 * is on. Without it the two best fights trade places on rounding.
 */
export const BATTLE_EDGE = 0.35;

/** How far down the order a pit stop still earns a cut. */
export const PIT_SHOT_TOP_N = 10;

/** Extra seconds held on a stop after the car starts moving again. */
export const PIT_SHOT_PAD_S = 1.5;

/** Is this car out of the race by now? */
const retiredAt = (race, num, t) => {
    const car = race.byNumber?.[num];
    return !car || t > car.outAt;
};

/** Is this car in the pit lane right now? */
const inPitAt = (race, num, t) => {
    const car = race.byNumber?.[num];
    if (!car?.pit) return false;
    return car.pit[frameAt(race, t)] === 1;
};

/**
 * The stop being serviced right now, if one is worth cutting to.
 *
 * Red-flag "stops" are excluded for the reason they are excluded everywhere
 * else in this app: the field parked on the grid for twenty minutes is not a
 * pit stop, and cutting to a stationary car for twenty minutes is not a shot.
 */
const stopAt = (race, t, order, prev = null) => {
    let best = null;
    for (const p of race.pits || []) {
        if (p.t == null || p.red_flag) continue;
        if (t < p.t || t > p.t + (p.stopped || 0) + PIT_SHOT_PAD_S) continue;
        const pos = order.indexOf(p.driver);
        if (pos < 0 || pos >= PIT_SHOT_TOP_N) continue;
        // A stop the camera is ALREADY on finishes on screen. Half the field
        // stops inside the same three laps, and re-picking the best-placed one
        // every second cuts away from a stop half way through it.
        if (prev?.reason === 'pit' && prev.driver === p.driver) return { driver: p.driver, pos };
        if (best == null || pos < best.pos) best = { driver: p.driver, pos };
    }
    return best;
};

/**
 * Every fight on track, best first.
 *
 * Consecutive pairs only — two cars a lap apart on the road are not racing
 * each other, however close the dots look. Cars in the pit lane are skipped
 * because their gap on the road is measured against a lane they are crawling
 * down; it goes to nothing and reads as the fight of the race.
 *
 * The camera follows the car BEHIND. It is the one that has to do something,
 * and framing it puts the car it is chasing in shot ahead of it for free.
 */
const battlesAt = (race, t, order, gaps) => {
    const out = [];
    let prevNum = null;
    let prevGap = null;
    let pos = 0;
    for (const num of order) {
        const g = gaps.get(num);
        if (g == null || retiredAt(race, num, t) || inPitAt(race, num, t)) {
            prevNum = null;
            prevGap = null;
            pos += 1;
            continue;
        }
        if (prevNum != null) {
            const d = g - prevGap;
            // `pos - 1` is where the car ahead is running: a fight for the
            // lead scores no penalty at all.
            if (d <= BATTLE_KEEP_S) {
                out.push({
                    driver: num, ahead: prevNum, gap: d,
                    score: d + POS_WEIGHT * (pos - 1),
                });
            }
        }
        prevNum = num;
        prevGap = g;
        pos += 1;
    }
    return out.sort((a, b) => a.score - b.score);
};

/**
 * Pick the shot for time `t`.
 *
 * @param prev  the shot currently on screen, or null
 * @returns { driver, reason, since }  — `driver` null means the wide shot
 *
 * `since` is the race time the shot was cut to, which is what the minimum hold
 * is measured against. It is carried forward unchanged while a shot continues,
 * so a leader shot that lasts twenty minutes has one `since`, not a thousand.
 */
export const directorShot = (race, t, prev = null) => {
    const shot = (driver, reason) => {
        // The same driver for the same reason is the SAME shot continuing.
        if (prev && prev.driver === driver && prev.reason === reason) return prev;
        return { driver, reason, since: t };
    };

    // A stopped race has nothing to follow: pull out and show the circuit.
    // This overrides the hold — the flag is the news.
    const span = statusAt(race, t).span;
    if (span?.code === '5') return shot(null, 'flag');

    const { order, gaps } = standingsAt(race, t);
    const running = order.filter((n) => !retiredAt(race, n, t));
    if (!running.length) return shot(null, 'flag');

    // A pit stop also overrides the hold. It is over in three seconds, so a
    // director that waited its turn would always miss it.
    const stop = stopAt(race, t, order, prev);
    if (stop) return shot(stop.driver, 'pit');

    // Everything below respects the hold. Scrubbing backwards past the current
    // shot's start is not a hold, it is a new race — hence the `held >= 0`.
    if (prev && prev.driver != null && !retiredAt(race, prev.driver, t)) {
        const held = t - prev.since;
        if (held >= 0 && held < SHOT_MIN_S) return prev;
    }

    const fights = battlesAt(race, t, order, gaps);
    // The fight already on screen, if it is still a fight at all.
    const keep = prev?.reason === 'battle'
        ? fights.find((f) => f.driver === prev.driver) : null;
    // The best fight that is close enough to cut TO. Sorted by score, so the
    // first qualifying one is the best one.
    const best = fights.find((f) => f.gap <= BATTLE_GAP_S) || null;

    // STAYING ON A FIGHT IS THE DEFAULT. A camera that re-picks the best pair
    // every time it is asked will hop between the five pairs that are all
    // within a second of each other, which is what a twenty-car field looks
    // like for most of a race.
    if (keep && (!best || best.score > keep.score - BATTLE_EDGE)) return prev;
    if (best) return shot(best.driver, 'battle');

    return shot(running[0], 'leader');
};

/** What the shot is called on screen. */
export const SHOT_LABEL = {
    leader: 'RACE LEAD',
    battle: 'BATTLE',
    pit: 'PIT STOP',
    flag: 'TRACK',
};
