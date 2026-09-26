/**
 * 📄 useAudio.js — one place that owns the sound.
 *
 * One <audio> element, one switch, one volume, remembered between visits.
 *
 * Shared through context rather than passed down, because the control sits in
 * the app header and nothing else in the tree needs to know about it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { TRACKS, loadPrefs, savePrefs } from './tracks';
import { AudioCtx } from './audioContext';

export const AudioProvider = ({ children }) => {
    const [prefs, setPrefs] = useState(loadPrefs);
    const audioRef = useRef(null);

    // One <audio> element for the lifetime of the app. Created here rather
    // than rendered so nothing can unmount it mid-track.
    if (!audioRef.current && typeof Audio !== 'undefined') {
        audioRef.current = new Audio();
        audioRef.current.loop = true;
        audioRef.current.preload = 'none';       // nothing downloads until asked
    }

    useEffect(() => { savePrefs(prefs); }, [prefs]);

    const track = TRACKS.find((t) => t.id === prefs.track) || TRACKS[0];

    // The music follows the switch.
    useEffect(() => {
        const el = audioRef.current;
        if (!el || !track) return;
        const want = prefs.on && prefs.music;
        const src = new URL(track.src, window.location.origin).href;
        if (el.src !== src) el.src = src;
        el.volume = prefs.volume;
        if (want) {
            // A browser refuses this until the page has been interacted with;
            // the toggle IS that interaction, so by the time it is true here
            // the promise resolves. Caught anyway — a rejected play() is an
            // unhandled rejection in the console otherwise.
            el.play().catch(() => {});
        } else {
            el.pause();
        }
    }, [prefs.on, prefs.music, prefs.volume, track]);

    useEffect(() => () => { audioRef.current?.pause(); }, []);

    const value = useMemo(() => ({
        prefs,
        track,
        tracks: TRACKS,
        set: (patch) => setPrefs((p) => ({ ...p, ...patch })),
        toggle: () => setPrefs((p) => ({ ...p, on: !p.on })),
    }), [prefs, track]);

    return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
};
