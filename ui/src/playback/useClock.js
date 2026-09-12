/**
 * 📄 useClock.js — the replay clock.
 *
 * A virtual time that advances with requestAnimationFrame, scaled by a playback
 * speed, and stops at a duration. It knows nothing about laps, sectors, cars or
 * telemetry — which is the point: a race replay needs exactly this clock but
 * none of the lap-specific machinery that used to be welded to it.
 *
 * Time lives in a ref, not state, so a frame costs no React render. Only
 * isPlaying is state, and that changes a handful of times per session.
 */
import { useState, useRef, useEffect, useCallback } from 'react';

/** A frame gap longer than this means the tab was asleep, not that time jumped. */
const STALL_THRESHOLD_S = 0.25;

export const useClock = ({ duration, speed = 1, onTick, onEnd }) => {
    const [isPlaying, setIsPlaying] = useState(false);

    // Read live through refs so the loop is never torn down by a re-render.
    const speedRef = useRef(speed);
    const onTickRef = useRef(onTick);
    const onEndRef = useRef(onEnd);
    speedRef.current = speed;
    onTickRef.current = onTick;
    onEndRef.current = onEnd;

    const timeRef = useRef(0);
    const rafRef = useRef(null);
    const prevTsRef = useRef(0);

    const reset = useCallback(() => {
        timeRef.current = 0;
        prevTsRef.current = 0;
    }, []);

    useEffect(() => {
        if (!isPlaying || !duration) return;

        // Starting from the end means "play again".
        if (timeRef.current >= duration) reset();
        prevTsRef.current = 0;

        const frame = (ts) => {
            if (!prevTsRef.current) prevTsRef.current = ts;
            let dt = (ts - prevTsRef.current) / 1000;
            prevTsRef.current = ts;
            // A backgrounded tab throttles rAF; without this the clock would
            // leap forward by however long the tab was hidden.
            if (dt > STALL_THRESHOLD_S || dt < 0) dt = 1 / 60;

            timeRef.current += dt * speedRef.current;
            const t = Math.min(timeRef.current, duration);

            onTickRef.current?.(t);

            if (timeRef.current >= duration) {
                onEndRef.current?.(t);
                setIsPlaying(false);
                return;
            }
            rafRef.current = requestAnimationFrame(frame);
        };

        rafRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(rafRef.current);
    }, [isPlaying, duration, reset]);

    // Auto-pause when the tab is hidden — the browser throttles rAF to a crawl
    // for background tabs, so playback would otherwise silently stall.
    useEffect(() => {
        const onHide = () => { if (document.hidden) setIsPlaying(false); };
        document.addEventListener('visibilitychange', onHide);
        return () => document.removeEventListener('visibilitychange', onHide);
    }, []);

    const play = useCallback(() => setIsPlaying(true), []);
    const pause = useCallback(() => setIsPlaying(false), []);
    const restart = useCallback(() => { reset(); setIsPlaying(true); }, [reset]);

    /** Jump to a point in the lap without changing play state. */
    const seek = useCallback((t) => {
        timeRef.current = Math.max(0, t);
        prevTsRef.current = 0;
    }, []);

    return { isPlaying, setIsPlaying, play, pause, restart, reset, seek, timeRef };
};
