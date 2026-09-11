/**
 * 📄 router.js — the three modes, as real URLs.
 *
 *   /                          mode picker
 *   /lap/:year/:round          one driver's fastest lap
 *   /compare/:year/:round      head-to-head, ?a=<driver>&b=<driver>
 *   /race/:year/:round         full race classification
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
    if (!MODES.includes(mode)) return { mode: null, year: null, round: null, a: null, b: null };
    const q = new URLSearchParams(qs);
    return {
        mode,
        year: num(parts[1]),
        round: num(parts[2]),
        a: q.get('a') || null,
        // `vs` was the original single-driver parameter; links already shared
        // with it still work and simply mean "pole versus this driver".
        b: q.get('b') || q.get('vs') || null,
    };
};

/** Build a path from parts, omitting anything not known yet. */
export const buildPath = ({ mode, year, round, a, b }) => {
    if (!mode) return '/';
    let p = `/${mode}`;
    if (year) p += `/${year}`;
    if (year && round) p += `/${round}`;
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
