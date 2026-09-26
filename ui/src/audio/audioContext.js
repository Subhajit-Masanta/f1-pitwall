/**
 * 📄 audioContext.js — the handle on the sound.
 *
 * Split from the provider because a file that exports both a component and a
 * hook cannot be hot-reloaded, and this is the one both halves of the app
 * import.
 */
import { createContext, useContext } from 'react';

export const AudioCtx = createContext(null);

/**
 * Sound, or a set of no-ops.
 *
 * Returning stubs rather than null keeps every caller free of a null check for
 * something that is never absent in the app and only absent in a test.
 */
export const useAudio = () => useContext(AudioCtx) || {
    prefs: { on: false, music: false, volume: 0 },
    track: null,
    tracks: [],
    set: () => {},
    toggle: () => {},
};
