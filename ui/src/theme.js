/**
 * 📄 theme.js — the F1-broadcast look, kept deliberately restrained.
 *
 * ONE RULE: saturated colour belongs to the drivers. Everything structural —
 * track, sectors, DRS, panels, type — is neutral.
 *
 * That rule replaced an earlier palette carrying seven accents (red, DRS green,
 * a pink/cyan/amber sector set, purple, green) on top of two team colours. With
 * eight hues on screen the brightest thing on a head-to-head was a DRS zone
 * rather than either car, which is exactly backwards: the cars are the subject.
 * Sectors now separate by VALUE instead of hue, DRS is a muted mint rather than
 * a glowing rope, and red is spent on one thing only — see below.
 */
export const F1 = {
    // The accent. Transport control and the app's own mark, nothing else. It
    // used to double as the solo car, S1 ticks and the delta text, which left
    // it meaning "important" in three unrelated ways, i.e. nothing.
    red: '#E10600',

    bg: '#0B0B0F',
    panel: '#121218',
    surface: '#16161D',   // one step up, for menus and lifted panels
    line: '#22222C',
    hair: 'rgba(255,255,255,0.07)',

    // Three tiers of presence, not three greys picked by eye.
    text: '#FFFFFF',
    dim: '#909099',
    faint: '#4C4C58',

    track: '#43434E',

    // --- the universal F1 signals -------------------------------------------
    // These are the exception to the one-rule above, and they earn it: green
    // throttle, red brake and green DRS are conventions an F1 viewer already
    // reads without a legend. They carry meaning, so they are not decoration.
    // What they must NOT do is shout over the cars, which is what the old
    // #00E676 DRS did — so they sit at broadcast saturation, not neon.
    drs: '#22C55E',       // DRS green
    thr: '#22C55E',       // throttle — same green: both mean "power on"
    brk: '#FF3B30',       // brake red. Clean and bright on purpose: the old
                          // #E10600 at low alpha over near-black went BROWN
                          // under an orange McLaren trace.

    // Shift lights run green -> red -> violet and flash violet at the limit,
    // the way a real steering wheel does. Violet exists for that and nothing
    // else — it is the top of a scale, not a palette colour.
    shift: '#B14BE0',

    // Sector identity as a VALUE ramp on one neutral. Hue carried no meaning
    // here — S1 was not "more pink" than S2 — so it was pure noise competing
    // with the team colours. Each step stays clear of the track line above.
    //
    // The ramp deliberately STOPS SHORT of white: the start/finish line is pure
    // white, and an S1 tick at #EDEDF5 was indistinguishable from it on the map.
    // White now means the lap boundary and nothing else.
    s1: '#D2D2DE',
    s2: '#9898A8',
    s3: '#68687A',

    // Sign, not identity: a gap closing or opening. Kept desaturated so a
    // delta readout never outshouts the cars it describes.
    gain: '#4BBF87',
    loss: '#D8564F',
};

/** The sector ramp in order, for anything that indexes sectors 1..3. */
export const SECTOR = [F1.s1, F1.s2, F1.s3];

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
