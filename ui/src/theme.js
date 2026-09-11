/**
 * 📄 theme.js — the F1-broadcast look, kept deliberately restrained.
 *
 * Rule of thumb: the track is neutral, the UI is monochrome, and colour is
 * reserved for things that actually mean something (DRS, sector state, red
 * accent). That's what makes it read as F1 TV rather than a dashboard.
 */
export const F1 = {
    red: '#E10600',
    bg: '#0B0B0F',
    panel: '#121218',
    line: '#22222C',
    hair: 'rgba(255,255,255,0.07)',

    text: '#FFFFFF',
    dim: '#909099',    // lifted for legibility on the near-black bg
    faint: '#4C4C58',

    track: '#4C4C58',
    drs: '#00E676',

    // sector identity (used for ticks + the timing rail, never the whole track)
    s1: '#E44FB2',
    s2: '#37C6FF',
    s3: '#FFC300',

    purple: '#B14BE0',
    green: '#00D26A',
};

export const MONO = "'Chivo Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/** shared page width so content doesn't stretch on wide monitors */
export const MAXW = 1200;

/** 90.4 -> "1:30.400" */
export const fmtLap = (t) => {
    if (t == null || Number.isNaN(t)) return '-:--.---';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.round((t % 1) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

/** 28.736 -> "28.736" */
export const fmtSector = (t) =>
    (t == null || Number.isNaN(t)) ? '--.---' : t.toFixed(3);

/**
 * Speed → colour ramp for the racing line.
 *
 * Deliberately avoids the palette's meaning-carrying colours (F1 red = the car,
 * DRS green = DRS zones) at the ends where they'd be confused. Indigo → cyan →
 * spring → amber → red reads as "slow to fast" instantly and every stop stays
 * bright enough to see on the near-black background.
 */
const SPEED_STOPS = [
    [0.00, [92, 76, 255]],    // indigo   — slowest corner
    [0.28, [0, 178, 255]],    // cyan
    [0.55, [0, 226, 160]],    // spring
    [0.78, [255, 208, 0]],    // amber
    [1.00, [255, 62, 48]],    // red      — top speed
];

/** t in 0..1 → "rgb(r,g,b)" */
export const speedColor = (t) => {
    const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    for (let i = 1; i < SPEED_STOPS.length; i++) {
        const [p1, c1] = SPEED_STOPS[i - 1];
        const [p2, c2] = SPEED_STOPS[i];
        if (x <= p2) {
            const f = p2 === p1 ? 0 : (x - p1) / (p2 - p1);
            const c = c1.map((v, j) => Math.round(v + (c2[j] - v) * f));
            return `rgb(${c[0]},${c[1]},${c[2]})`;
        }
    }
    const last = SPEED_STOPS[SPEED_STOPS.length - 1][1];
    return `rgb(${last[0]},${last[1]},${last[2]})`;
};

/** CSS gradient string for the speed legend. */
export const SPEED_GRADIENT = `linear-gradient(90deg, ${SPEED_STOPS
    .map(([p, c]) => `rgb(${c[0]},${c[1]},${c[2]}) ${(p * 100).toFixed(0)}%`)
    .join(', ')})`;
