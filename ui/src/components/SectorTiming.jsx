/**
 * 📄 SectorTiming.jsx — the timing rail.
 *
 * Deliberately typographic: a lap clock and three sector rows, no panels or
 * boxes. The live clock is written straight to the DOM via the `update()`
 * handle so it can tick every frame without re-rendering React.
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { F1, MONO, fmtLap, fmtSector } from '../theme';

const SECTOR_COLOR = { 1: F1.s1, 2: F1.s2, 3: F1.s3 };

const Row = ({ n, locked, active }) => (
    <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        padding: '5px 0',
        borderTop: `1px solid ${F1.hair}`,
    }}>
        <span style={{
            width: 3, alignSelf: 'stretch', borderRadius: 2,
            background: active ? SECTOR_COLOR[n] : 'transparent',
        }} />
        <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
            color: active ? SECTOR_COLOR[n] : F1.dim, width: 18,
        }}>
            S{n}
        </span>
        <span style={{
            fontFamily: MONO, fontSize: 15, fontWeight: 700,
            color: locked != null ? F1.text : F1.faint,
            fontVariantNumeric: 'tabular-nums',
        }}>
            {fmtSector(locked)}
        </span>
    </div>
);

const SectorTiming = forwardRef(({ sectorTimes, currentSector, visible }, ref) => {
    const clockRef = useRef(null);

    useImperativeHandle(ref, () => ({
        update(fr) {
            if (clockRef.current) clockRef.current.textContent = fmtLap(fr.time);
        },
    }), []);

    return (
        <div style={{
            position: 'absolute', top: 60, left: 22, zIndex: 12, width: 176,
            opacity: visible ? 1 : 0.45, transition: 'opacity .25s',
        }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2.4, color: F1.dim }}>
                LAP TIME
            </div>
            <div ref={clockRef} style={{
                fontFamily: MONO, fontSize: 27, fontWeight: 700, lineHeight: 1.25,
                color: F1.text, fontVariantNumeric: 'tabular-nums', marginBottom: 10,
            }}>
                {fmtLap(0)}
            </div>
            {[1, 2, 3].map((n) => (
                <Row key={n} n={n}
                    locked={sectorTimes?.[`s${n}`]}
                    active={visible && currentSector === n} />
            ))}
        </div>
    );
});

SectorTiming.displayName = 'SectorTiming';
export default React.memo(SectorTiming);
