/**
 * 📄 Shortcuts.jsx — the keys, written down.
 *
 * There are six of them in a race replay now, and until this existed the only
 * place any were recorded was one line on the race card, which goes the moment
 * you press play and never comes back. A key you cannot find is a key that
 * does not exist.
 *
 * The LIST is per mode rather than global, because the modes genuinely differ:
 * a single lap has nothing to step through and no camera to release. Each
 * stage passes its own, and owns the sheet — which also keeps Escape's
 * ordering in one place per mode instead of split across components.
 *
 * `position: fixed` rather than absolute: the stages clip their own overlays
 * with `overflow: hidden`, and a help sheet that can be cropped by the thing
 * it is explaining is not much help.
 */
import React from 'react';
import { F1, MONO } from '../theme';

const Key = ({ children }) => (
    <kbd style={{
        display: 'inline-block', padding: '3px 7px', minWidth: 26,
        textAlign: 'center', background: 'rgba(255,255,255,0.07)',
        border: `1px solid ${F1.line}`, borderRadius: 3,
        fontFamily: MONO, fontSize: 10, fontWeight: 700, color: F1.text,
        letterSpacing: 0.6, lineHeight: 1.5,
    }}>{children}</kbd>
);

const Shortcuts = ({ items, onClose }) => (
    <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={onClose}
        style={{
            position: 'fixed', inset: 0, zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, background: 'rgba(8,8,12,0.86)',
        }}
    >
        <div
            // The panel is not the scrim: clicking a shortcut row should not
            // dismiss the thing you are reading.
            onClick={(e) => e.stopPropagation()}
            style={{
                width: '100%', maxWidth: 420, maxHeight: '100%', overflowY: 'auto',
                background: F1.panel, border: `1px solid ${F1.line}`,
                padding: '20px 22px', boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
            }}
        >
            <div style={{
                display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16,
            }}>
                <span style={{ width: 3, height: 13, background: F1.red }} />
                <span style={{
                    fontSize: 12, fontWeight: 700, letterSpacing: 1.8,
                    textTransform: 'uppercase', color: F1.text,
                }}>Keyboard</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {items.map((it) => (
                    <div key={it.what} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '6px 0',
                        borderBottom: `1px solid ${F1.hair}`,
                    }}>
                        <span style={{
                            flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                            {it.keys.map((k, i) => (
                                <React.Fragment key={k}>
                                    {i > 0 && (
                                        <span style={{ color: F1.faint, fontSize: 9 }}>or</span>
                                    )}
                                    <Key>{k}</Key>
                                </React.Fragment>
                            ))}
                        </span>
                        <span style={{
                            marginLeft: 'auto', textAlign: 'right',
                            fontSize: 12, color: F1.dim, letterSpacing: 0.2,
                        }}>{it.what}</span>
                    </div>
                ))}
            </div>

            <button
                type="button"
                onClick={onClose}
                style={{
                    marginTop: 16, width: '100%', padding: '9px 0',
                    background: 'transparent', color: F1.dim,
                    border: `1px solid ${F1.line}`, cursor: 'pointer',
                    fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: 1.2,
                }}
            >CLOSE</button>
        </div>
    </div>
);

export default React.memo(Shortcuts);
