/**
 * 📄 FlagOverlay.jsx — the flag, across the whole stage.
 *
 * A flag is the loudest thing that happens in a race, and a small chip in the
 * header does not read as one. Broadcast throws the colour across the screen,
 * holds it, and gets out of the way — so this does the same: a band sweeps the
 * stage, the name lands, then it clears to a persistent edge glow that lasts as
 * long as the condition does.
 *
 * It fires on a CHANGE of condition, not on its presence. A safety car period
 * runs for minutes; announcing it once is the point of an announcement.
 *
 * Everything animates transform and opacity only, on its own compositor layer,
 * so twenty cars keep their frame budget. `pointer-events: none` throughout —
 * the overlay must never eat a click meant for the map or the scrubber.
 */
import React, { useEffect, useRef, useState } from 'react';
import { MONO } from '../../theme';

/** How long the full-screen announcement lasts, in wall-clock milliseconds. */
const SWEEP_MS = 420;
const HOLD_MS = 1500;
const FADE_MS = 520;
const TOTAL_MS = SWEEP_MS + HOLD_MS + FADE_MS;

/**
 * The look of each condition. Colours here are the actual flags — the one
 * place the app's "team colours carry the story" rule steps aside, because a
 * yellow flag that is not yellow is not a yellow flag.
 */
const FLAGS = {
    '2': { label: 'YELLOW FLAG', tint: '#FFD024', ink: '#1A1400', glow: 0.30 },
    '4': { label: 'SAFETY CAR', tint: '#FFD024', ink: '#1A1400', glow: 0.34 },
    '5': { label: 'RED FLAG', tint: '#FF1E1E', ink: '#FFFFFF', glow: 0.52 },
    '6': { label: 'VIRTUAL SAFETY CAR', tint: '#FFD024', ink: '#1A1400', glow: 0.30 },
    '7': { label: 'VSC ENDING', tint: '#22C55E', ink: '#04140B', glow: 0.22 },
    '1': { label: 'TRACK CLEAR', tint: '#22C55E', ink: '#04140B', glow: 0 },
};

const KEYFRAMES = `
@keyframes pw-flag-sweep {
  0%   { transform: translate3d(-101%,0,0); }
  100% { transform: translate3d(0,0,0); }
}
@keyframes pw-flag-out {
  0%   { opacity: 1; transform: translate3d(0,0,0) scaleY(1); }
  100% { opacity: 0; transform: translate3d(0,0,0) scaleY(0.22); }
}
@keyframes pw-flag-text {
  0%   { opacity: 0; transform: translate3d(26px,0,0); letter-spacing: 14px; }
  100% { opacity: 1; transform: translate3d(0,0,0); letter-spacing: 6px; }
}
@keyframes pw-flag-pulse {
  0%, 100% { opacity: 0.55; }
  50%      { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  [data-pw-flag] * { animation: none !important; }
}
`;

let injected = false;
const useKeyframes = () => {
    useEffect(() => {
        if (injected) return;
        const el = document.createElement('style');
        el.textContent = KEYFRAMES;
        document.head.appendChild(el);
        injected = true;
    }, []);
};

const FlagOverlay = ({ span }) => {
    useKeyframes();
    const code = span?.code ?? null;
    const [shout, setShout] = useState(null);      // the announcement, or null
    const prev = useRef(null);
    const timer = useRef(null);

    useEffect(() => {
        if (code === prev.current) return;
        const was = prev.current;
        prev.current = code;
        // Nothing to announce on first paint, and "clear" is only worth saying
        // when it follows something that was not clear.
        if (was === null) return;
        if (code === '1' && (was === '1' || was === null)) return;
        const look = FLAGS[code];
        if (!look) return;

        setShout({ code, at: Date.now() });
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setShout(null), TOTAL_MS);
        return () => clearTimeout(timer.current);
    }, [code]);

    useEffect(() => () => clearTimeout(timer.current), []);

    const live = FLAGS[code];
    const persistent = live && live.glow > 0;
    const shoutLook = shout ? FLAGS[shout.code] : null;

    return (
        <div
            data-pw-flag=""
            style={{
                position: 'absolute', inset: 0, zIndex: 20,
                pointerEvents: 'none', overflow: 'hidden',
            }}
        >
            {/* While the condition lasts: an edge glow, not a wash — the map
                has to stay readable underneath it for minutes at a time. */}
            {persistent && (
                <div style={{
                    position: 'absolute', inset: 0,
                    boxShadow: `inset 0 0 90px 12px ${live.tint}${
                        Math.round(live.glow * 255).toString(16).padStart(2, '0')}`,
                    animation: code === '5'
                        ? 'pw-flag-pulse 1.6s ease-in-out infinite' : 'none',
                }} />
            )}

            {/* The announcement itself. */}
            {shoutLook && (
                <div
                    key={shout.at}
                    style={{
                        position: 'absolute', left: 0, right: 0,
                        top: '50%', height: 96, marginTop: -48,
                        background: shoutLook.tint,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transformOrigin: '50% 50%',
                        boxShadow: `0 0 60px 0 ${shoutLook.tint}88`,
                        animation: `pw-flag-sweep ${SWEEP_MS}ms cubic-bezier(.16,.84,.44,1) both,`
                            + ` pw-flag-out ${FADE_MS}ms ease-in ${SWEEP_MS + HOLD_MS}ms both`,
                    }}
                >
                    {/* Diagonal hatching, so a solid band reads as a flag. */}
                    <div style={{
                        position: 'absolute', inset: 0, opacity: 0.16,
                        background: 'repeating-linear-gradient(115deg,'
                            + ' rgba(0,0,0,0.9) 0 14px, rgba(0,0,0,0) 14px 34px)',
                    }} />
                    <span style={{
                        position: 'relative',
                        fontFamily: MONO, fontWeight: 800,
                        fontSize: 'clamp(20px, 4.2vw, 46px)',
                        color: shoutLook.ink, whiteSpace: 'nowrap',
                        animation: `pw-flag-text ${SWEEP_MS + 160}ms cubic-bezier(.16,.84,.44,1) both`,
                    }}>
                        {shoutLook.label}
                    </span>
                </div>
            )}
        </div>
    );
};

export default React.memo(FlagOverlay);
