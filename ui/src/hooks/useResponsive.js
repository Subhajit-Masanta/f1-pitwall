import { useState, useEffect } from 'react';

/**
 * True when the viewport is at or below `px` wide. Updates on resize.
 * Used to switch the replay stage between the desktop broadcast layout and a
 * stacked layout that fits a phone.
 */
export const useIsNarrow = (px = 720) => {
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
