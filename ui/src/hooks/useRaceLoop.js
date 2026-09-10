/**
 * 📄 useRaceLoop.js — the replay clock + interpolator.
 *
 * One requestAnimationFrame loop. Every frame it hands the caller an
 * interpolated snapshot of the car via `onFrame`, and the caller pushes those
 * values straight to the DOM (car transform, HUD numbers). The only React state
 * touched here is isPlaying, currentSector and sectorTimes — each changes a
 * handful of times per lap, never on the hot path.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

const EMPTY_SECTORS = { s1: null, s2: null, s3: null };

export const useRaceLoop = (telemetry, playbackSpeed, sectorBoundaries, officialSectorTimes, onFrame) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentSector, setCurrentSector] = useState(1);
    const [sectorTimes, setSectorTimes] = useState(EMPTY_SECTORS);

    // Live values the loop reads without being a useEffect dependency — this is
    // what stops the rAF loop from being torn down and rebuilt on every render.
    const telRef = useRef(telemetry);
    const boundsRef = useRef(sectorBoundaries);
    const officialRef = useRef(officialSectorTimes);
    const speedRef = useRef(playbackSpeed);
    const onFrameRef = useRef(onFrame);
    telRef.current = telemetry;
    boundsRef.current = sectorBoundaries;
    officialRef.current = officialSectorTimes;
    speedRef.current = playbackSpeed;
    onFrameRef.current = onFrame;

    const rafRef = useRef();
    const prevTelRef = useRef(null);
    const prevTsRef = useRef(0);
    const virtualTimeRef = useRef(0);
    const idxRef = useRef(0);
    const sectorRef = useRef(1);
    const sectorStartRef = useRef(0);

    const resetPlayhead = useCallback(() => {
        virtualTimeRef.current = 0;
        idxRef.current = 0;
        sectorRef.current = 1;
        sectorStartRef.current = 0;
        setCurrentSector(1);
        setSectorTimes(EMPTY_SECTORS);
    }, []);

    // Reset the playhead when the loaded lap changes. Only force a STOP when
    // swapping one lap for another — not on the first null -> data load, which
    // is exactly what happens when the user hits Start.
    useEffect(() => {
        if (prevTelRef.current && prevTelRef.current !== telemetry) setIsPlaying(false);
        prevTelRef.current = telemetry;
        resetPlayhead();
    }, [telemetry, resetPlayhead]);

    // The loop. Re-runs only when play starts/stops or the lap data first
    // arrives; the sector data and speed are read live through refs, so a
    // sector-crossing re-render never tears the loop down.
    useEffect(() => {
        if (!isPlaying) return;
        const tel = telRef.current;
        if (!Array.isArray(tel) || tel.length < 2) return;

        const lastTime = tel[tel.length - 1].time;
        if (virtualTimeRef.current >= lastTime) resetPlayhead();
        prevTsRef.current = 0;

        const frame = (ts) => {
            const t = telRef.current;
            if (!prevTsRef.current) prevTsRef.current = ts;
            let dt = (ts - prevTsRef.current) / 1000;
            prevTsRef.current = ts;
            if (dt > 0.25 || dt < 0) dt = 1 / 60; // tab was backgrounded

            virtualTimeRef.current += dt * speedRef.current;
            const elapsed = virtualTimeRef.current;

            let i = idxRef.current;
            if (i >= t.length - 1) i = t.length - 2;
            if (t[i].time > elapsed) i = 0; // rewound / restarted
            while (i < t.length - 1 && t[i + 1].time <= elapsed) i++;
            idxRef.current = i;

            const p1 = t[i];
            const p2 = t[i + 1] || p1;
            const span = p2.time - p1.time;
            const f = span > 0 ? Math.min(1, Math.max(0, (elapsed - p1.time) / span)) : 0;
            const lerp = (a, b) => a + (b - a) * f;
            const dist = lerp(p1.distance, p2.distance);

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

            onFrameRef.current?.({
                x: lerp(p1.x, p2.x),
                y: -lerp(p1.y, p2.y),
                dist,
                speed: lerp(p1.speed, p2.speed),
                rpm: lerp(p1.rpm, p2.rpm),
                gear: p2.gear,
                throttle: lerp(p1.throttle, p2.throttle),
                brake: lerp(p1.brake, p2.brake),
                drs: p2.drs,
                time: Math.min(elapsed, lastTime),
                sector: sectorRef.current,
                sectorElapsed: elapsed - sectorStartRef.current,
            });

            if (elapsed >= lastTime) {
                setSectorTimes((prev) =>
                    prev.s3 != null
                        ? prev
                        : { ...prev, s3: official?.s3 ?? (elapsed - sectorStartRef.current) }
                );
                setIsPlaying(false);
                return;
            }
            rafRef.current = requestAnimationFrame(frame);
        };

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
    }, [isPlaying, telemetry, resetPlayhead]);

    // Auto-pause when the tab is hidden — the browser throttles rAF to a crawl
    // for background tabs, so playback would otherwise silently stall.
    useEffect(() => {
        const onHide = () => { if (document.hidden) setIsPlaying(false); };
        document.addEventListener('visibilitychange', onHide);
        return () => document.removeEventListener('visibilitychange', onHide);
    }, []);

    const play = useCallback(() => setIsPlaying(true), []);
    const pause = useCallback(() => setIsPlaying(false), []);
    const restart = useCallback(() => { resetPlayhead(); setIsPlaying(true); }, [resetPlayhead]);

    return { isPlaying, play, pause, restart, setIsPlaying, currentSector, sectorTimes };
};
