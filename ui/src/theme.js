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
