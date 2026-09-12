/**
 * 📄 SectorCompare.jsx — both drivers' splits, laid out across the width.
 *
 * This deliberately does NOT live in the left rail. Stacking a two-driver table
 * there needed ~60px more column, and the column is subtracted from the map —
 * the one thing that should never shrink. Across the foot of the stage the same
 * information costs ~38px of height instead, and height is cheap because the
 * stage grows to fit rather than the map giving way.
 *
 * Three cells, one per sector: both times with the faster in green, and the gap
 * that sector produced. The running delta says how much is lost; this says
 * where.
 */
import React from 'react';
import { F1, MONO, fmtSector } from '../theme';

const SECTOR_COLOR = { 1: F1.s1, 2: F1.s2, 3: F1.s3 };

const SectorCompare = ({ compare, sectorTimes, currentSector, narrow }) => {
    if (!compare?.a || !compare?.b) return null;
    const { a, b } = compare;

    const num = {
        fontFamily: MONO, fontSize: narrow ? 11 : 13, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
    };

    return (
        <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: narrow ? 8 : 14,
        }}>
            {[1, 2, 3].map((n) => {
                const key = `s${n}`;
                // Revealed as the reference car crosses each boundary, so the
                // comparison unfolds with the lap instead of spoiling it.
                const revealed = sectorTimes?.[key] != null;
                const av = a.sectors?.[key];
                const bv = b.sectors?.[key];
                const both = revealed && av != null && bv != null;
                const gap = both ? bv - av : null;
                const aFaster = both && av < bv;
                const live = currentSector === n;

                return (
                    <div key={n} style={{
                        display: 'flex', alignItems: 'center', gap: narrow ? 7 : 10,
                        padding: narrow ? '5px 8px' : '6px 11px',
                        background: live ? 'rgba(255,255,255,0.035)' : 'transparent',
                        borderLeft: `2px solid ${live ? SECTOR_COLOR[n] : F1.line}`,
                        minWidth: 0,
                    }}>
                        <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: 1,
                            color: live ? SECTOR_COLOR[n] : F1.dim, flexShrink: 0,
                        }}>
                            S{n}
                        </span>

                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                            <span style={{ ...num, color: !both ? F1.faint : aFaster ? F1.green : F1.text }}>
                                {both ? fmtSector(av) : '--.---'}
                            </span>
                            <span style={{ fontSize: 9, color: a.color, fontWeight: 700 }}>{a.code}</span>
                        </span>

                        <span style={{ color: F1.faint, fontSize: 10 }}>/</span>

                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
                            <span style={{ ...num, color: !both ? F1.faint : !aFaster ? F1.green : F1.text }}>
                                {both ? fmtSector(bv) : '--.---'}
                            </span>
                            <span style={{ fontSize: 9, color: b.color, fontWeight: 700 }}>{b.code}</span>
                        </span>

                        <span style={{
                            ...num, fontSize: narrow ? 10 : 11, marginLeft: 'auto', flexShrink: 0,
                            color: gap == null ? F1.faint : gap > 0 ? F1.red : F1.green,
                        }}>
                            {gap == null ? '--' : (gap >= 0 ? '+' : '−') + Math.abs(gap).toFixed(3)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

export default React.memo(SectorCompare);
