/**
 * 📄 RaceControl.jsx — the message feed, the way a pitwall sees it.
 *
 * Race control sends 81 messages over a grand prix and 34 of them matter. The
 * stage has only ever shown the newest one, as a caption, and thrown the rest
 * away — so a penalty, an investigation or a sector going green existed for
 * one moment and then never happened.
 *
 * Broadcast keeps them as a list: newest at the top, each one stamped with the
 * lap it came on and flagged in its own colour, the older ones fading out of
 * the bottom rather than vanishing. That is what this is.
 *
 * It sits over the map on the right, where the circuit's bounding box almost
 * never reaches, and it is `pointer-events: none` throughout — a log must
 * never eat a click meant for the scrubber behind it.
 */
import React from 'react';
import { F1, MONO } from '../../theme';
import { messagesUpTo } from '../../lib/race';

/** How many stay on screen. Broadcast shows about this many. */
const SHOWN = 6;

/**
 * The colour of a message.
 *
 * Flags are their own colours for the same reason the flag overlay's are: a
 * yellow flag that is not yellow is not a yellow flag. Everything else is
 * deliberately plain, so that the two or three that matter carry.
 */
const tint = (m) => {
    const flag = String(m.flag || '').toUpperCase();
    if (flag.includes('RED')) return '#FF1E1E';
    if (flag.includes('YELLOW')) return '#FFD024';
    if (flag.includes('GREEN') || flag.includes('CLEAR')) return '#22C55E';
    if (flag.includes('CHEQUERED')) return F1.text;
    if (m.cat === 'SafetyCar') return '#FFD024';
    if (m.cat === 'Drs') return F1.drs;
    return F1.dim;
};

const RaceControl = ({ race, second, narrow }) => {
    const msgs = React.useMemo(
        () => messagesUpTo(race, second, SHOWN),
        [race, second],
    );

    if (narrow || !msgs.length) return null;

    return (
        <div style={{
            position: 'absolute', top: 6, right: 16, width: 262, zIndex: 12,
            pointerEvents: 'none',
            display: 'flex', flexDirection: 'column', gap: 4,
        }}>
            <div style={{
                fontFamily: MONO, fontSize: 8, fontWeight: 800, letterSpacing: 1.4,
                color: F1.faint, textAlign: 'right', marginBottom: 2,
            }}>RACE CONTROL</div>

            {msgs.map((m, i) => (
                <div
                    // Keyed on the message itself, so a new one mounts and the
                    // rest keep their place instead of the whole list flashing.
                    key={`${m.t}-${m.msg}`}
                    style={{
                        display: 'flex', gap: 7, alignItems: 'flex-start',
                        padding: '5px 8px',
                        background: 'rgba(11,11,15,0.82)',
                        borderLeft: `2px solid ${tint(m)}`,
                        // Older messages recede rather than disappearing, so
                        // the eye stays on the one that just arrived.
                        opacity: 1 - i * 0.14,
                        animation: i === 0 ? 'pw-rc-in 260ms ease-out both' : 'none',
                    }}
                >
                    <span style={{
                        fontFamily: MONO, fontSize: 9, color: F1.faint,
                        fontVariantNumeric: 'tabular-nums', flex: '0 0 auto',
                        paddingTop: 1,
                    }}>{m.lap != null ? `L${m.lap}` : '—'}</span>
                    <span style={{
                        fontFamily: MONO, fontSize: 9.5, lineHeight: 1.45,
                        letterSpacing: 0.3, color: i === 0 ? F1.text : F1.dim,
                    }}>{m.msg}</span>
                </div>
            ))}
        </div>
    );
};

export default React.memo(RaceControl);
