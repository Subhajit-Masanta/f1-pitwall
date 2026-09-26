/**
 * The URL is the app's only state that outlives a reload, and every link ever
 * shared has to keep working. These pin the shapes that matter.
 */
import { describe, it, expect } from 'vitest';
import {
    parseRoute, buildPath, MODES, MODE_LABEL, RACE_SESSIONS, RACE_DEFAULT,
} from './router';

describe('parseRoute', () => {
    it('reads a full lap URL', () => {
        expect(parseRoute('/lap/2023/3/Q', '')).toMatchObject({
            mode: 'lap', year: 2023, round: 3, session: 'Q',
        });
    });

    it('upper-cases the session segment', () => {
        expect(parseRoute('/lap/2023/3/ss', '').session).toBe('SS');
    });

    it('reads both drivers of a head-to-head', () => {
        expect(parseRoute('/compare/2023/3/Q', '?a=1&b=16'))
            .toMatchObject({ a: '1', b: '16' });
    });

    it('still honours the original ?vs= links', () => {
        expect(parseRoute('/compare/2023/3/Q', '?a=1&vs=44').b).toBe('44');
    });

    it('prefers b over vs when a link carries both', () => {
        expect(parseRoute('/compare/2023/3/Q', '?a=1&b=16&vs=44').b).toBe('16');
    });

    it('drops an opponent who is the reference driver', () => {
        // Two cars drawn on top of each other, labelled VER vs VER, with both
        // pickers blank — neither list offers the driver already chosen on the
        // other side. Nobody races themselves.
        expect(parseRoute('/compare/2023/3/Q', '?a=1&b=1').b).toBeNull();
        expect(parseRoute('/compare/2023/3/Q', '?a=1&vs=1').b).toBeNull();
    });

    it('treats an unknown first segment as no mode at all', () => {
        expect(parseRoute('/nonsense/2023', '')).toMatchObject({ mode: null });
    });

    it('survives a bare mode, and a trailing slash', () => {
        expect(parseRoute('/race', '')).toMatchObject({ mode: 'race', year: null });
        expect(parseRoute('/lap/2023/', '')).toMatchObject({ year: 2023, round: null });
    });

    it('refuses a year or round that is not a number', () => {
        expect(parseRoute('/lap/abc/xyz', '')).toMatchObject({ year: null, round: null });
    });
});

describe('buildPath', () => {
    it('round-trips a head-to-head', () => {
        const route = { mode: 'compare', year: 2023, round: 3, session: 'Q', a: '1', b: '16' };
        expect(parseRoute(...buildPath(route).split('?'))).toMatchObject(route);
    });

    it('carries the session on a race link, because a sprint weekend has two', () => {
        expect(buildPath({ mode: 'race', year: 2023, round: 4, session: 'S' }))
            .toBe('/race/2023/4/S');
        expect(buildPath({ mode: 'race', year: 2023, round: 3, session: 'R' }))
            .toBe('/race/2023/3');
    });

    it('stops at whatever is known so far', () => {
        expect(buildPath({ mode: 'lap' })).toBe('/lap');
        expect(buildPath({ mode: 'lap', year: 2023 })).toBe('/lap/2023');
        expect(buildPath({})).toBe('/');
    });

    it('omits an empty query rather than leaving a bare ?', () => {
        expect(buildPath({ mode: 'lap', year: 2023, round: 3, session: 'Q' }))
            .toBe('/lap/2023/3/Q');
    });
});

describe('a sprint weekend', () => {
    it('reads the sprint out of a race URL', () => {
        expect(parseRoute('/race/2023/4/S', '')).toMatchObject({
            mode: 'race', year: 2023, round: 4, session: 'S',
        });
    });

    it('still means the grand prix with no session segment', () => {
        // Every link shared before the sprint existed.
        expect(parseRoute('/race/2023/3', '').session).toBeNull();
        expect(RACE_DEFAULT).toBe('R');
    });

    it('round-trips both races of the weekend', () => {
        for (const ses of RACE_SESSIONS) {
            const route = { mode: 'race', year: 2023, round: 4, session: ses };
            const back = parseRoute(buildPath(route), '');
            expect(back.session || RACE_DEFAULT).toBe(ses);
            expect(back).toMatchObject({ mode: 'race', year: 2023, round: 4 });
        }
    });

    it('leaves a grand prix link exactly as it has always been', () => {
        // Anything shared before the sprint existed must not change shape.
        expect(buildPath({ mode: 'race', year: 2023, round: 3, session: 'R' }))
            .toBe('/race/2023/3');
    });

    it('only calls a race a race', () => {
        // Qualifying has no running order to replay car by car.
        expect(RACE_SESSIONS).toEqual(['R', 'S']);
        expect(RACE_SESSIONS).not.toContain('Q');
        expect(RACE_SESSIONS).not.toContain('SS');
    });
});

describe('the mode list', () => {
    it('labels every mode it offers', () => {
        for (const m of MODES) expect(MODE_LABEL[m]).toBeTruthy();
    });
});
