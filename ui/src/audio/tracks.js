/**
 * 📄 tracks.js — the soundtrack.
 *
 * Add a file to `public/music/` and a line here; everything else picks it up.
 * With one track the picker stays hidden, with several it appears — so this
 * list is the only thing that has to change.
 *
 * Files are served from `public/`, so the path is absolute from the site root
 * and is NOT bundled: a five-megabyte import would land in the JS chunk and be
 * downloaded before the app could draw anything.
 */
export const TRACKS = [
    {
        id: 'f1-theme',
        title: 'F1 Theme',
        artist: 'Brian Tyler',
        src: '/music/f1_theme_brian_tyler.mp3',
    },
];

/** Where the listener's choices are kept between visits. */
export const AUDIO_PREFS = 'pitwall.audio';

/**
 * Read the saved preferences, or the defaults.
 *
 * SOUND IS OFF UNTIL ASKED FOR. A page that starts making noise on its own is
 * the fastest way to lose the person who opened it, and a replay is often
 * opened next to something else that is already playing.
 */
export const loadPrefs = () => {
    const fallback = { on: false, music: true, volume: 0.35, track: TRACKS[0]?.id };
    try {
        const raw = window.localStorage.getItem(AUDIO_PREFS);
        if (!raw) return fallback;
        const saved = JSON.parse(raw);
        return {
            ...fallback,
            ...saved,
            // A track that has since been removed from the list would leave
            // the player pointing at a 404.
            track: TRACKS.some((t) => t.id === saved.track) ? saved.track : fallback.track,
            volume: Math.min(1, Math.max(0, Number(saved.volume) || fallback.volume)),
        };
    } catch {
        // Private windows and blocked site data both throw here.
        return fallback;
    }
};

export const savePrefs = (prefs) => {
    try {
        window.localStorage.setItem(AUDIO_PREFS, JSON.stringify(prefs));
    } catch {
        // Nothing to do: the session still works, it just will not be
        // remembered.
    }
};
