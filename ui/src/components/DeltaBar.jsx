/**
 * 📄 DeltaBar.jsx — head-to-head readout.
 *
 * Shows the reference lap (the session's fastest) against the driver you picked,
 * and the live gap between them. Like everything else on the hot path it renders
 * its shell once and is driven imperatively via `update()`.
 *
 * Sign convention: POSITIVE means the compared driver is LOSING time — it
 * reached this point on the lap later than the reference did. That matches how
 * a timing screen reads, where +0.182 is a deficit.
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { F1, MONO } from '../theme';

/** Gap at which the bar is fully deflected to one side. */
const FULL_SCALE_S = 1.0;

const Plate = ({ code, team, color, dashed }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{
            width: 4, height: 22, flexShrink: 0, background: color,
            // Teammates share a team colour, so the compared driver gets a
            // broken bar to stay distinguishable in an intra-team battle.
            backgroundImage: dashed
                ? `repeating-linear-gradient(180deg, ${color} 0 4px, rgba(0,0,0,0.55) 4px 7px)`
                : 'none',
        }} />
        <div style={{ minWidth: 0 }}>
            <div style={{
                fontFamily: MONO, fontSize: 14, fontWeight: 700, color: F1.text,
                lineHeight: 1.1, letterSpacing: 0.5,
            }}>
                {code || '---'}
            </div>
            <div style={{
                fontSize: 9, letterSpacing: 0.8, color: F1.dim,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                maxWidth: 104,
            }}>
                {(team || '').toUpperCase()}
            </div>
        </div>
    </div>
);

const DeltaBar = forwardRef(({ reference, ghost, narrow }, ref) => {
    const valRef = useRef(null);
    const barRef = useRef(null);
    const prev = useRef({ txt: '', sign: 0 });

    useImperativeHandle(ref, () => ({
        update(fr) {
            if (!valRef.current) return;
            const d = fr.delta;
            if (d == null || Number.isNaN(d)) {
                if (prev.current.txt !== '--') {
                    valRef.current.textContent = '--.---';
                    valRef.current.style.color = F1.dim;
                    if (barRef.current) barRef.current.style.width = '0%';
                    prev.current = { txt: '--', sign: 0 };
                }
                return;
            }
            const txt = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3);
            if (txt !== prev.current.txt) {
                valRef.current.textContent = txt;
                prev.current.txt = txt;
            }
            // green = the compared driver is ahead, red = behind
            const sign = d > 0.0005 ? 1 : d < -0.0005 ? -1 : 0;
            if (sign !== prev.current.sign) {
                valRef.current.style.color = sign > 0 ? F1.red : sign < 0 ? F1.green : F1.text;
                prev.current.sign = sign;
            }
            if (barRef.current) {
                // The bar grows from the CENTRE, so a full deflection is half the
                // track — not the whole width. Using 100% here meant a gap of
                // 0.582s rendered as 50% + 58.2% = 108% and spilled out of the
                // panel entirely.
                const half = Math.min(50, (Math.abs(d) / FULL_SCALE_S) * 50);
                barRef.current.style.width = half.toFixed(1) + '%';
                barRef.current.style.marginLeft = (d >= 0 ? 50 : 50 - half).toFixed(1) + '%';
                barRef.current.style.background = sign > 0 ? F1.red : sign < 0 ? F1.green : F1.dim;
            }
        },
    }), []);

    if (!ghost) return null;

    const sameTeam = reference?.team && ghost.team && reference.team === ghost.team;

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', gap: 7,
            padding: narrow ? '8px 10px' : '10px 12px',
            boxSizing: 'border-box', overflow: 'hidden', maxWidth: '100%',
            background: 'rgba(18,18,24,0.72)',
            border: `1px solid ${F1.line}`,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Plate code={reference?.code} team={reference?.team}
                    color={reference?.color || F1.text} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.4, color: F1.faint }}>
                    VS
                </span>
                <Plate code={ghost.code} team={ghost.team} color={ghost.color} dashed={sameTeam} />
            </div>

            <div>
                <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.3, color: F1.dim }}>
                        DELTA
                    </span>
                    <span ref={valRef} style={{
                        fontFamily: MONO, fontSize: narrow ? 17 : 20, fontWeight: 700,
                        color: F1.dim, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
                        whiteSpace: 'nowrap',
                    }}>
                        --.---
                    </span>
                </div>
                {/* centre-anchored gap bar: left of centre = gaining */}
                <div style={{
                    position: 'relative', height: 3, background: F1.line, marginTop: 5,
                }}>
                    <div style={{
                        position: 'absolute', left: 0, top: -2, bottom: -2,
                        width: 1, marginLeft: '50%', background: F1.faint,
                    }} />
                    <div ref={barRef} style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: '0%', marginLeft: '50%', background: F1.dim,
                        willChange: 'width, margin-left',
                    }} />
                </div>
            </div>
        </div>
    );
});

DeltaBar.displayName = 'DeltaBar';
export default React.memo(DeltaBar);
