/**
 * 📄 useLapTiming.js — sector splits as the car crosses each boundary.
 *
 * Lap-specific, and deliberately separate from the clock: a race replay needs
 * the clock but counts laps rather than watching for two sector crossings.
 *
 * The official FastF1 splits are preferred over the elapsed replay time — they
 * are the authoritative numbers, and deriving them from interpolated frames
 * would drift by a few thousandths.
 */
import { useState, useRef, useCallback } from 'react';

const EMPTY_SECTORS = { s1: null, s2: null, s3: null };

export const useLapTiming = (sectorBoundaries, officialSectorTimes) => {
    const [currentSector, setCurrentSector] = useState(1);
    const [sectorTimes, setSectorTimes] = useState(EMPTY_SECTORS);

    const boundsRef = useRef(sectorBoundaries);
    const officialRef = useRef(officialSectorTimes);
    boundsRef.current = sectorBoundaries;
    officialRef.current = officialSectorTimes;

    const sectorRef = useRef(1);
    const sectorStartRef = useRef(0);

    const reset = useCallback(() => {
        sectorRef.current = 1;
        sectorStartRef.current = 0;
        setCurrentSector(1);
        setSectorTimes(EMPTY_SECTORS);
    }, []);

    /**
     * Called once per frame with where the car is and how long it has been out.
     * Returns the values the frame needs, so the caller doesn't read our refs.
     */
    const advance = useCallback((dist, elapsed) => {
        const bounds = boundsRef.current;
        const official = officialRef.current;

        if (bounds) {
            if (sectorRef.current === 1 && dist >= bounds.sector1_end) {
                const s1 = official?.s1 ?? (elapsed - sectorStartRef.current);
                sectorRef.current = 2;
                sectorStartRef.current = elapsed;
                setCurrentSector(2);
                setSectorTimes((prev) => ({ ...prev, s1 }));
            } else if (sectorRef.current === 2 && dist >= bounds.sector2_end) {
                const s2 = official?.s2 ?? (elapsed - sectorStartRef.current);
                sectorRef.current = 3;
                sectorStartRef.current = elapsed;
                setCurrentSector(3);
                setSectorTimes((prev) => ({ ...prev, s2 }));
            }
        }

        return {
            sector: sectorRef.current,
            sectorElapsed: elapsed - sectorStartRef.current,
        };
    }, []);

    /** The flag: close out the final sector if it hasn't been locked already. */
    const finish = useCallback((elapsed) => {
        const official = officialRef.current;
        setSectorTimes((prev) => (
            prev.s3 != null
                ? prev
                : { ...prev, s3: official?.s3 ?? (elapsed - sectorStartRef.current) }
        ));
    }, []);

    return { currentSector, sectorTimes, advance, finish, reset };
};
