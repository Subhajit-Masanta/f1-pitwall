/**
 * 📄 useRaceLoop.js — one lap, played back.
 *
 * Composes the generic clock with lap timing and the telemetry interpolator.
 * Every frame it hands the caller an interpolated snapshot of the car via
 * `onFrame`, and the caller pushes those values straight to the DOM (car
 * transform, HUD numbers) — nothing here re-renders on the hot path.
 *
 * The three pieces are separate on purpose: a race replay reuses `useClock`
 * and the interpolator but counts laps instead of watching for two sector
 * crossings, so it wants `useLapTiming` swapped out rather than worked around.
 */
import { useRef, useEffect, useCallback } from 'react';
import { useClock } from '../playback/useClock';
import { useLapTiming } from '../playback/useLapTiming';

/**
 * Interpolate a telemetry frame list at `elapsed` seconds.
 * `cursor` is carried between calls so a lap costs one forward scan, not a
 * search per frame.
 */
export const sampleTelemetry = (t, elapsed, cursor = 0) => {
    let i = cursor;
    if (i >= t.length - 1) i = t.length - 2;
    if (t[i].time > elapsed) i = 0;                  // rewound / restarted
    while (i < t.length - 1 && t[i + 1].time <= elapsed) i++;

    const p1 = t[i];
    const p2 = t[i + 1] || p1;
    const span = p2.time - p1.time;
    const f = span > 0 ? Math.min(1, Math.max(0, (elapsed - p1.time) / span)) : 0;
    const lerp = (a, b) => a + (b - a) * f;

    return {
        index: i,
        frame: {
            x: lerp(p1.x, p2.x),
            y: -lerp(p1.y, p2.y),                    // SVG grows downward
            dist: lerp(p1.distance, p2.distance),
            speed: lerp(p1.speed, p2.speed),
            rpm: lerp(p1.rpm, p2.rpm),
            gear: p2.gear,
            throttle: lerp(p1.throttle, p2.throttle),
            brake: lerp(p1.brake, p2.brake),
            // Longitudinal g — the brake meter's magnitude. This object is an
            // explicit field list, so a new telemetry channel has to be added
            // here too or it silently never reaches the HUD.
            g: lerp(p1.g, p2.g),
            drs: p2.drs,
        },
    };
};

export const useRaceLoop = (telemetry, playbackSpeed, sectorBoundaries, officialSectorTimes, onFrame) => {
    const telRef = useRef(telemetry);
    const onFrameRef = useRef(onFrame);
    telRef.current = telemetry;
    onFrameRef.current = onFrame;

    const cursorRef = useRef(0);
    const timing = useLapTiming(sectorBoundaries, officialSectorTimes);

    const valid = Array.isArray(telemetry) && telemetry.length >= 2;
    const duration = valid ? telemetry[telemetry.length - 1].time : 0;

    const handleTick = useCallback((elapsed) => {
        const t = telRef.current;
        if (!Array.isArray(t) || t.length < 2) return;

        const { index, frame } = sampleTelemetry(t, elapsed, cursorRef.current);
        cursorRef.current = index;

        const { sector, sectorElapsed } = timing.advance(frame.dist, elapsed);

        onFrameRef.current?.({ ...frame, time: elapsed, sector, sectorElapsed });
    }, [timing]);

    const clock = useClock({
        duration,
        speed: playbackSpeed,
        onTick: handleTick,
        onEnd: timing.finish,
    });

    const { reset: resetClock, setIsPlaying } = clock;
    const { reset: resetTiming } = timing;

    const resetPlayhead = useCallback(() => {
        resetClock();
        resetTiming();
        cursorRef.current = 0;
    }, [resetClock, resetTiming]);

    // Reset the playhead when the loaded lap changes. Only force a STOP when
    // swapping one lap for another — not on the first null -> data load, which
    // is exactly what happens when the user hits Start.
    const prevTelRef = useRef(null);
    useEffect(() => {
        if (prevTelRef.current && prevTelRef.current !== telemetry) setIsPlaying(false);
        prevTelRef.current = telemetry;
        resetPlayhead();
    }, [telemetry, resetPlayhead, setIsPlaying]);

    const restart = useCallback(() => {
        resetPlayhead();
        setIsPlaying(true);
    }, [resetPlayhead, setIsPlaying]);

    /**
     * Pressing play at the flag means "replay". The clock rewinds itself, but
     * the SECTOR state has to rewind too — otherwise the second run keeps the
     * previous lap's splits and never leaves sector 3, because the crossings
     * have already been passed.
     */
    const play = useCallback(() => {
        if (duration && clock.timeRef.current >= duration) resetPlayhead();
        setIsPlaying(true);
    }, [duration, clock.timeRef, resetPlayhead, setIsPlaying]);

    return {
        isPlaying: clock.isPlaying,
        play,
        pause: clock.pause,
        restart,
        setIsPlaying,
        currentSector: timing.currentSector,
        sectorTimes: timing.sectorTimes,
    };
};
