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
 * True when the viewport is at or below `px` wide. Updates on resize.
 * Used to switch the replay stage between the desktop broadcast layout and a
 * stacked layout that fits a phone or a tablet held upright.
 */
export const useIsNarrow = (px = STACKED_MAX) => {
    const query = `(max-width: ${px}px)`;
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
