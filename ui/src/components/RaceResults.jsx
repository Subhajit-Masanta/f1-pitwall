/**
 * 📄 RaceResults.jsx — the Full Race section.
 *
 * Final classification for the selected Grand Prix. This is the groundwork for
 * the all-cars replay: the driver list, team colours and finishing order all
 * come from the same session the replay will use.
 */
import React, { useEffect, useState } from 'react';
import { raceService } from '../services/raceService';
import { F1, MONO } from '../theme';
import StageMessage from './StageMessage';

const Cell = ({ children, w, align = 'left', color = F1.text, mono = false, dim = false }) => (
    <div style={{
        width: w, textAlign: align, color: dim ? F1.dim : color,
        fontFamily: mono ? MONO : 'inherit',
        fontVariantNumeric: 'tabular-nums',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
        {children}
    </div>
);

const friendly = (e) => {
    if (e?.code === 'ECONNABORTED') return 'The server took too long — it may be waking up. Try again.';
    if (e && !e.response) return 'Can’t reach the server. Check your connection.';
    return e?.message || 'Something went wrong.';
};

const RaceResults = ({ year, round, raceName }) => {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null); setData(null);
        raceService.getResults(year, round, 'R')
            .then((d) => {
                if (cancelled) return;
                if (d.error || !d.standings?.length) {
                    setError(d.error || 'No classification available for this race yet.');
                } else {
                    setData(d);
                }
            })
            .catch((e) => { if (!cancelled) setError(friendly(e)); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [year, round, tick]);

    if (loading) {
        return <StageMessage variant="loading" title={raceName} />;
    }
    if (error) {
        return (
            <StageMessage
                variant="error"
                title={raceName}
                message={error}
                onRetry={() => setTick((t) => t + 1)}
            />
        );
    }

    return (
        <div style={{ border: `1px solid ${F1.line}`, background: F1.bg }}>
            {/* header */}

            <div style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '16px 22px',
                borderBottom: `1px solid ${F1.line}`,
            }}>
                <span style={{ width: 3, height: 16, background: F1.red }} />
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase' }}>
                    {raceName || data.race_name}
                </span>
                <span style={{ fontSize: 10, color: F1.dim, letterSpacing: 2 }}>
                    RACE CLASSIFICATION · {data.location}
                </span>
                <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: F1.dim }}>
                    {data.total_drivers} CARS
                </span>
            </div>

            <div style={{ overflowX: 'auto' }}>
            {/* column labels */}
            <div style={{
                display: 'flex', gap: 14, padding: '9px 22px', minWidth: 640,
                fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: F1.dim,
                borderBottom: `1px solid ${F1.hair}`,
            }}>
                <Cell w={34}>POS</Cell>
                <Cell w={30}>NO</Cell>
                <Cell w={56}>DRIVER</Cell>
                <Cell w={200}>TEAM</Cell>
                <Cell w={44} align="right">GRID</Cell>
                <Cell w={70} align="right">GAIN</Cell>
                <Cell w={130}>STATUS</Cell>
                <Cell w={50} align="right">PTS</Cell>
            </div>

            {/* rows */}
            {data.standings.map((s) => {
                const gain = s.grid != null && s.position != null ? s.grid - s.position : null;
                const gainColor = gain > 0 ? F1.drs : gain < 0 ? F1.red : F1.dim;
                return (
                    <div key={s.number} style={{
                        display: 'flex', gap: 14, alignItems: 'center', minWidth: 640,
                        padding: '9px 22px', fontSize: 12,
                        borderBottom: `1px solid ${F1.hair}`,
                    }}>
                        <Cell w={34} mono color={s.position <= 3 ? F1.text : F1.dim}>
                            {String(s.position).padStart(2, '0')}
                        </Cell>
                        <Cell w={30} mono dim>{s.number}</Cell>
                        <div style={{ width: 56, display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ width: 3, height: 14, background: s.color }} />
                            <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>{s.code}</span>
                        </div>
                        <Cell w={200} dim>{s.team}</Cell>
                        <Cell w={44} align="right" mono dim>{s.grid ?? '—'}</Cell>
                        <Cell w={70} align="right" mono color={gainColor}>
                            {gain == null ? '—' : gain > 0 ? `+${gain}` : gain === 0 ? '—' : `${gain}`}
                        </Cell>
                        <Cell w={130} dim>{s.status}</Cell>
                        <Cell w={50} align="right" mono color={s.points > 0 ? F1.text : F1.faint}>
                            {s.points ?? 0}
                        </Cell>
                    </div>
                );
            })}
            </div>

            {/* what's next */}
            <div style={{
                padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 10,
                fontSize: 11, color: F1.dim, letterSpacing: 0.5,
            }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: F1.faint }} />
                All-cars track replay for this race is in development — the driver list and team
                colours above are the data it will run on.
            </div>
        </div>
    );
};

export default RaceResults;
