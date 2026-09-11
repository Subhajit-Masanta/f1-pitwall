/**
 * 📄 router.js — the three modes, as real URLs.
 *
 *   /                          mode picker
 *   /lap/:year/:round/:session      one driver's fastest lap
 *   /compare/:year/:round/:session  head-to-head, ?a=<driver>&b=<driver>
 *   /race/:year/:round              full race classification
 *
 * Deliberately no routing dependency. The whole surface is three fixed
 * segments plus one query parameter, and this project has already been bitten
 * once by a transitive install breaking the production build — so a few lines
 * here are cheaper than another package in the tree.
 *
 * NOTE: real paths need a server rewrite or a refresh on /compare/2023/1 is a
 * 404. See vercel.json.
 */
import { useState, useEffect } from 'react';

export const MODES = ['lap', 'compare', 'race'];

/** Session code -> the name to show. The list a weekend actually ran comes
 *  from the API; this is just for labelling what is on screen. */
export const SESSION_LABEL = {
    Q: 'Qualifying',
    R: 'Race',
    S: 'Sprint',
    SS: 'Sprint Shootout',
    SQ: 'Sprint Qualifying',
};

export const MODE_LABEL = {
    lap: 'Fastest Lap',
    compare: 'Head to Head',
    race: 'Full Race',
};

const num = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
};

/** "/compare/2023/1?a=1&b=16" → { mode, year, round, a, b } */
export const parseRoute = (pathname, search) => {
    const path = pathname ?? window.location.pathname;
    const qs = search ?? window.location.search;
    const parts = path.split('/').filter(Boolean);
    const mode = parts[0];
    if (!MODES.includes(mode)) {
        return { mode: null, year: null, round: null, session: null, a: null, b: null };
    }
    const q = new URLSearchParams(qs);
    return {
        mode,
        year: num(parts[1]),
        round: num(parts[2]),
        // Q / R / S / SS / SQ — which session of the weekend. Older links have
        // no segment here and default to qualifying, as they always showed.
        session: (parts[3] || '').toUpperCase() || null,
        a: q.get('a') || null,
        // `vs` was the original single-driver parameter; links already shared
        // with it still work and simply mean "pole versus this driver".
        b: q.get('b') || q.get('vs') || null,
    };
};

/** Build a path from parts, omitting anything not known yet. */
export const buildPath = ({ mode, year, round, session, a, b }) => {
    if (!mode) return '/';
    let p = `/${mode}`;
    if (year) p += `/${year}`;
    if (year && round) p += `/${round}`;
    // the race view is one session by definition, so it carries no segment
    if (year && round && session && mode !== 'race') p += `/${session}`;
    const q = new URLSearchParams();
    if (a) q.set('a', a);
    if (b) q.set('b', b);
    const qs = q.toString();
    return qs ? `${p}?${qs}` : p;
};

/** Push a new URL and tell the app about it. */
export const navigate = (to, { replace = false } = {}) => {
    const current = window.location.pathname + window.location.search;
    if (to === current) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
    // popstate doesn't fire for push/replace, so the app is notified explicitly.
    window.dispatchEvent(new Event('pitwall:route'));
};

/** Current route, kept in sync with back/forward and our own navigations. */
export const useRoute = () => {
    const [route, setRoute] = useState(() => parseRoute());

    useEffect(() => {
        const sync = () => setRoute(parseRoute());
        window.addEventListener('popstate', sync);
        window.addEventListener('pitwall:route', sync);
        return () => {
            window.removeEventListener('popstate', sync);
            window.removeEventListener('pitwall:route', sync);
        };
    }, []);

    return route;
};
