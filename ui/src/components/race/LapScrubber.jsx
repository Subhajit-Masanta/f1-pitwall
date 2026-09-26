/**
 * 📄 LapScrubber.jsx — the race, on the bar you drag.
 *
 * A 153-minute race is still 15 minutes at 10x, so this is not a convenience:
 * it is how anyone actually watches. Marked only 1 to 58 it said nothing about
 * the race it was scrubbing, and finding the restart meant dragging and
 * reading the clock until you overshot it. Now the bar carries what happened —
 * safety cars as bands, stoppages in red, every pit stop as a notch, the
 * fastest lap in purple — and finding the restart is a glance.
 *
 * THE NATIVE INPUT IS STILL THERE, transparent, on top. It brings the keyboard,
 * the focus ring, the screen-reader value and drag behaviour that a div with
 * click handlers would all have to reimplement badly; the decoration is
 * underneath it and `pointer-events: none`, so none of that is disturbed.
 */
import React, { useMemo, useRef, useState } from 'react';
import { F1, MONO } from '../../theme';
import { raceEvents, eventsAtLap } from '../../lib/race';

const TRACK_H = 6;          // the bar itself
const STOP_H = 5;           // pit notches, under it
const ROW_H = 26;           // the whole control

const BAND = {
    sc: { fill: 'rgba(255,208,36,0.85)' },
    vsc: { fill: 'rgba(255,208,36,0.45)' },
    red: { fill: 'rgba(255,30,30,0.95)' },
};

const LapScrubber = ({ race, lap, onScrub }) => {
    const total = race.totalLaps || 1;
    const events = useMemo(() => raceEvents(race), [race]);
    const [hover, setHover] = useState(null);
    const boxRef = useRef(null);

    // Lap 1 sits at 0% and the last lap at 100%, matching where the native
    // thumb puts itself — otherwise the marks drift from the handle.
    const fx = (l) => ((l - 1) / Math.max(1, total - 1)) * 100;

    const onMove = (e) => {
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return;
        const f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
        const at = Math.round(1 + f * (total - 1));
        setHover({ lap: at, x: f * 100, what: eventsAtLap(events, at) });
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color: F1.faint,
            }}>LAP 1</span>

            <div
                ref={boxRef}
                onMouseMove={onMove}
                onMouseLeave={() => setHover(null)}
                style={{ position: 'relative', flex: 1, height: ROW_H }}
            >
                {/* ---- the decoration, under the input ---- */}
                <div style={{
                    position: 'absolute', left: 0, right: 0, top: 10,
                    height: TRACK_H, pointerEvents: 'none',
                }}>
                    {/* the race, unrun */}
                    <div style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(255,255,255,0.10)',
                    }} />
                    {/* ...and run */}
                    <div style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: `${fx(lap)}%`, background: F1.red,
                    }} />

                    {/* neutralised periods sit ON the bar, because that is
                        what they are: a stretch of the race, not an event in
                        it */}
                    {events.bands.map((b, i) => (
                        <div key={i} style={{
                            position: 'absolute', top: -1, bottom: -1,
                            left: `${fx(b.from)}%`,
                            width: `${Math.max(fx(b.to) - fx(b.from), 0.8)}%`,
                            background: BAND[b.kind].fill,
                        }} />
                    ))}

                    {/* the purple lap */}
                    {events.fastest && (
                        <div style={{
                            position: 'absolute', top: -3, bottom: -3,
                            left: `${fx(events.fastest.lap)}%`,
                            width: 2, marginLeft: -1, background: F1.purple,
                        }} />
                    )}
                </div>

                {/* pit stops, below the bar — a row of notches whose density
                    IS the pit window */}
                <div style={{
                    position: 'absolute', left: 0, right: 0, top: 10 + TRACK_H + 2,
                    height: STOP_H, pointerEvents: 'none',
                }}>
                    {events.stops.map((s, i) => (
                        <div key={i} style={{
                            position: 'absolute', top: 0, height: '100%',
                            left: `${fx(s.lap)}%`, width: 1.5, marginLeft: -0.75,
                            background: F1.dim, opacity: 0.55,
                        }} />
                    ))}
                </div>

                {/* ---- the real control ---- */}
                <input
                    type="range"
                    min={1}
                    max={total}
                    value={lap}
                    onChange={(e) => onScrub(Number(e.target.value))}
                    aria-label="Jump to lap"
                    aria-valuetext={`Lap ${lap} of ${total}`}
                    style={{
                        position: 'absolute', inset: 0, width: '100%', height: '100%',
                        margin: 0, appearance: 'none', background: 'transparent',
                        cursor: 'pointer',
                    }}
                />

                {/* where the thumb is, drawn by us so it sits above the bands */}
                <div style={{
                    position: 'absolute', top: 10 + TRACK_H / 2,
                    left: `${fx(lap)}%`,
                    width: 11, height: 11, marginLeft: -5.5, marginTop: -5.5,
                    borderRadius: '50%', background: F1.red,
                    border: '2px solid #fff', pointerEvents: 'none',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.7)',
                }} />

                {/* what happened where the cursor is */}
                {hover && (hover.what.length > 0) && (
                    <div style={{
                        position: 'absolute', bottom: ROW_H + 2,
                        left: `${hover.x}%`, transform: 'translateX(-50%)',
                        padding: '3px 7px', whiteSpace: 'nowrap', pointerEvents: 'none',
                        background: F1.panel, border: `1px solid ${F1.line}`,
                        fontFamily: MONO, fontSize: 9, color: F1.text,
                        letterSpacing: 0.4, zIndex: 20,
                    }}>
                        LAP {hover.lap} · {hover.what.join(' · ')}
                    </div>
                )}
            </div>

            <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color: F1.faint,
            }}>{total}</span>
        </div>
    );
};

export default React.memo(LapScrubber);
