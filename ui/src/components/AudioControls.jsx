/**
 * 📄 AudioControls.jsx — the sound switch, in the app header.
 *
 * One button, because that is the control anyone actually wants: sound on,
 * sound off. The rest — how loud, and which track once there is more than
 * one — opens from it, and stays closed until asked for.
 */
import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { F1, MONO } from '../theme';
import { useAudio } from '../audio/audioContext';

const row = {
    display: 'flex', alignItems: 'center', gap: 8,
    fontFamily: MONO, fontSize: 10, letterSpacing: 0.6, color: F1.dim,
};

const AudioControls = ({ narrow }) => {
    const { prefs, track, tracks, set, toggle } = useAudio();
    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);

    // Click anywhere else and the panel closes — the same behaviour the
    // driver pickers have, so it is not a new thing to learn.
    useEffect(() => {
        if (!open) return undefined;
        const away = (e) => {
            if (!boxRef.current?.contains(e.target)) setOpen(false);
        };
        window.addEventListener('mousedown', away);
        return () => window.removeEventListener('mousedown', away);
    }, [open]);

    if (!tracks.length) return null;

    return (
        <div ref={boxRef} style={{ position: 'relative' }}>
            <button
                type="button"
                aria-label={prefs.on ? 'Sound on' : 'Sound off'}
                title={prefs.on ? 'Sound on' : 'Sound off'}
                onClick={(e) => {
                    // The toggle is the gesture a browser needs before it will
                    // let anything make a sound, so it must BE the toggle —
                    // opening a panel first and switching on in there works
                    // too, but only because that click counts as well.
                    if (e.shiftKey) setOpen((v) => !v);
                    else toggle();
                }}
                onContextMenu={(e) => { e.preventDefault(); setOpen((v) => !v); }}
                style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    background: 'transparent',
                    border: `1px solid ${prefs.on ? F1.line : 'transparent'}`,
                    color: prefs.on ? F1.text : F1.faint,
                    padding: narrow ? '6px 8px' : '7px 11px', cursor: 'pointer',
                    fontSize: 10, fontWeight: 700, letterSpacing: 1.2,
                }}
            >
                {prefs.on ? <Volume2 size={13} /> : <VolumeX size={13} />}
                {!narrow && (prefs.on ? 'SOUND' : 'MUTED')}
            </button>

            {/* the details, one click further in */}
            <button
                type="button"
                aria-label="Sound options"
                onClick={() => setOpen((v) => !v)}
                style={{
                    position: 'absolute', right: -3, bottom: -3,
                    width: 12, height: 12, padding: 0, cursor: 'pointer',
                    background: 'transparent', border: 'none',
                    color: open ? F1.text : F1.faint, fontSize: 9, lineHeight: 1,
                }}
            >▾</button>

            {open && (
                <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
                    minWidth: 190, padding: '10px 12px 12px',
                    background: F1.panel, border: `1px solid ${F1.line}`,
                }}>
                    <div style={{ ...row, color: F1.faint, marginBottom: 8 }}>
                        VOLUME
                        <input
                            type="range" min="0" max="1" step="0.05"
                            value={prefs.volume}
                            onChange={(e) => set({ volume: Number(e.target.value) })}
                            style={{ flex: 1, accentColor: F1.red }}
                        />
                    </div>

                    {tracks.length > 1 && (
                        <div style={{ marginTop: 9, borderTop: `1px solid ${F1.line}`, paddingTop: 8 }}>
                            {tracks.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => set({ track: t.id, on: true, music: true })}
                                    style={{
                                        ...row, width: '100%', textAlign: 'left',
                                        background: 'transparent', border: 'none',
                                        cursor: 'pointer', padding: '3px 0',
                                        color: t.id === prefs.track ? F1.text : F1.faint,
                                    }}
                                >{t.title}</button>
                            ))}
                        </div>
                    )}

                    {track && (
                        <div style={{
                            marginTop: 9, fontFamily: MONO, fontSize: 9,
                            color: F1.faint, letterSpacing: 0.4, lineHeight: 1.5,
                        }}>
                            {track.title}
                            {track.artist ? ` · ${track.artist}` : ''}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AudioControls;
