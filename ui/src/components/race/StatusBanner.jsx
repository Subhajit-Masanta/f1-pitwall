/**
 * 📄 StatusBanner.jsx — safety car, VSC, red flag, yellow.
 *
 * Driven by the `track_status` timeline rather than by race-control messages,
 * because the two disagree in granularity: Australia 2023 has six SafetyCar
 * MESSAGES ("DEPLOYED", "IN THIS LAP") but three SafetyCar SPANS. The span is
 * the state; the message is the caption.
 *
 * Colours here are the flag colours and nothing else — they mean exactly what
 * a viewer already thinks they mean, which is the one case where the app's
 * "team colours carry the story" rule steps aside.
 */
import React from 'react';
import { F1, MONO } from '../../theme';

const LOOK = {
    '2': { bg: '#FFD024', fg: '#1A1400', label: 'YELLOW FLAG' },
    '4': { bg: '#FFD024', fg: '#1A1400', label: 'SAFETY CAR' },
    '5': { bg: '#FF3B30', fg: '#FFFFFF', label: 'RED FLAG' },
    '6': { bg: '#FFD024', fg: '#1A1400', label: 'VIRTUAL SAFETY CAR' },
    '7': { bg: '#22C55E', fg: '#04140B', label: 'VSC ENDING' },
};

const StatusBanner = ({ span, message }) => {
    // Green is the default state, and a banner that is always on screen stops
    // being a signal — so CLEAR renders nothing at all.
    const look = span ? LOOK[span.code] : null;
    if (!look && !message) return null;

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            minHeight: 24, pointerEvents: 'none',
        }}>
            {look && (
                <span style={{
                    padding: '4px 10px', background: look.bg, color: look.fg,
                    fontSize: 10, fontWeight: 800, letterSpacing: 1.4,
                    fontFamily: MONO, whiteSpace: 'nowrap',
                }}>
                    {look.label}
                </span>
            )}
            {message && (
                <span style={{
                    fontFamily: MONO, fontSize: 10, letterSpacing: 0.3,
                    color: F1.dim, whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                    {message}
                </span>
            )}
        </div>
    );
};

export default React.memo(StatusBanner);
