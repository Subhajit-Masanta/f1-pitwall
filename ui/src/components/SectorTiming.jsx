/**
 * 📄 SectorTiming.jsx — the timing rail.
 *
 * Typographic: a lap clock and three sector splits. The live clock is written
 * straight to the DOM via `update()` so it ticks every frame without a React
 * render. Desktop = a vertical rail at top-left; narrow = a horizontal strip
 * under the header so it never collides with the wrapped title.
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { F1, MONO, fmtLap, fmtSector } from '../theme';

const SECTOR_COLOR = { 1: F1.s1, 2: F1.s2, 3: F1.s3 };

const Split = ({ n, locked, active, narrow }) => (
    <div style={{
        display: 'flex', alignItems: 'baseline',
        flexDirection: narrow ? 'column' : 'row',
        gap: narrow ? 1 : 10,
        padding: narrow ? '0' : '5px 0',
        borderTop: narrow ? 'none' : `1px solid ${F1.hair}`,
        flex: narrow ? 1 : 'none',
    }}>
        {!narrow && (
            <span style={{
                width: 3, alignSelf: 'stretch', borderRadius: 2,
                background: active ? SECTOR_COLOR[n] : 'transparent',
            }} />
        )}
        <span style={{
            fontSize: narrow ? 10 : 11, fontWeight: 700, letterSpacing: 1.2,
            color: active ? SECTOR_COLOR[n] : F1.dim, width: narrow ? 'auto' : 20,
        }}>
            S{n}
        </span>
        <span style={{
            fontFamily: MONO, fontSize: narrow ? 13 : 16, fontWeight: 700,
            color: locked != null ? F1.text : F1.faint,
            fontVariantNumeric: 'tabular-nums',
        }}>
            {fmtSector(locked)}
        </span>
    </div>
);

const SectorTiming = forwardRef(({ sectorTimes, currentSector, visible, narrow }, ref) => {
    const clockRef = useRef(null);

    useImperativeHandle(ref, () => ({
        update(fr) {
            if (clockRef.current) clockRef.current.textContent = fmtLap(fr.time);
        },
    }), []);

    const splits = [1, 2, 3].map((n) => (
        <Split key={n} n={n} narrow={narrow}
            locked={sectorTimes?.[`s${n}`]}
            active={visible && currentSector === n} />
    ));

    if (narrow) {
        return (
            <div style={{
                position: 'absolute', top: 52, left: 14, right: 14, zIndex: 12,
                display: 'flex', alignItems: 'center', gap: 14,
                opacity: visible ? 1 : 0.5, transition: 'opacity .25s',
            }}>
                <div ref={clockRef} style={{
                    fontFamily: MONO, fontSize: 20, fontWeight: 700,
                    color: F1.text, fontVariantNumeric: 'tabular-nums',
                }}>
                    {fmtLap(0)}
                </div>
                <div style={{ display: 'flex', gap: 12, flex: 1 }}>{splits}</div>
            </div>
        );
    }

    return (
        <div style={{
            position: 'absolute', top: 62, left: 24, zIndex: 12, width: 190,
            opacity: visible ? 1 : 0.45, transition: 'opacity .25s',
        }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: F1.dim }}>
                LAP TIME
            </div>
            <div ref={clockRef} style={{
                fontFamily: MONO, fontSize: 30, fontWeight: 700, lineHeight: 1.25,
                color: F1.text, fontVariantNumeric: 'tabular-nums', marginBottom: 10,
            }}>
                {fmtLap(0)}
            </div>
            {splits}
        </div>
    );
});

SectorTiming.displayName = 'SectorTiming';
export default React.memo(SectorTiming);
