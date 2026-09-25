import { useState, useEffect } from 'react';

/**
 * Where the stacked layout takes over from the desktop broadcast layout.
 *
 * 1000, not 720. The desktop layout needs ~1133px before the stage header fits
 * on one row, and below that it reserves a 224px timing column the map cannot
 * spare — measured on a tablet in portrait (768px), the track drew at roughly
 * a third of the stage while the driver pickers wrapped on top of the lap
 * clock. The stacked layout at the same width puts both pickers on one row and
 * gives the map about twice the area, so every common tablet portrait width
 * (768 / 820 / 834 / 912) belongs on that side of the line. 1024 — iPad Pro in
 * portrait — stays on the desktop layout, where it measures clean.
 */
export const STACKED_MAX = 1000;

/**
 * ...and only when the window is at least as tall as it is wide.
 *
 * The stacked layout spends height: it puts the map, the traces, the
 * transport and the HUD in one column, which is exactly right on a tablet
 * held upright and exactly wrong on a short, wide window. Measured at
 * 916 x 561 — a 1024x768 browser window, or a laptop window that is not
 * maximised — the stacked layout gave the map a band 869px wide and 170px
 * tall, so the track drew at about a fifth of the stage with empty space
 * either side of it. The desktop layout at the same size reserves its 224px
 * timing column and still leaves the map roughly three times the area.
 *
 * Every width quoted above is a portrait one, so none of them move.
 */
export const STACKED_SHAPE = '(max-aspect-ratio: 1/1)';

/**
 * True when the viewport is at or below `px` wide. Updates on resize.
 * Used to switch the replay stage between the desktop broadcast layout and a
 * stacked layout that fits a phone or a tablet held upright.
 */
export const useIsNarrow = (px = STACKED_MAX) => {
    const query = `(max-width: ${px}px) and ${STACKED_SHAPE}`;
    const [narrow, setNarrow] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(query).matches
    );

    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = (e) => setNarrow(e.matches);
        mq.addEventListener('change', onChange);
        setNarrow(mq.matches);
        return () => mq.removeEventListener('change', onChange);
    }, [query]);

    return narrow;
};
