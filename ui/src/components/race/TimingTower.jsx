/**
 * 📄 TimingTower.jsx — the running order down the left of the stage.
 *
 * This is what finally fills the empty column the desktop layout has always
 * reserved. Twenty rows: position, team flash, code, tyre compound and the gap
 * to the leader.
 *
 * It re-renders once per LAP, not once per frame. The order and the gaps only
 * change when cars cross the line, so the parent passes `lap` and this reads
 * everything from it — twenty rows of DOM rebuilt 58 times over a race costs
 * nothing, whereas doing it per frame would be 36,000 rebuilds.
 */
import React from 'react';
import { F1, MONO } from '../../theme';
import { orderByLap, intervalsAt, stintAt } from '../../lib/race';

/** Tyre compound → its broadcast colour. These are the real F1 markings. */
const COMPOUND = {
    SOFT: '#FF3B30',
    MEDIUM: '#FFD024',
    HARD: '#EFEFEF',
    INTERMEDIATE: '#22C55E',
    WET: '#3671C6',
};

const Tyre = ({ compound }) => {
    const c = COMPOUND[compound] || F1.faint;
    return (
        <span
            title={compound || 'unknown'}
            style={{
                width: 11, height: 11, borderRadius: '50%', flex: '0 0 auto',
                border: `2px solid ${c}`, background: 'transparent',
            }}
        />
    );
};

const fmtGap = (g) => {
    if (g == null) return '—';
    if (g === 0) return 'LEADER';
    return `+${g.toFixed(3)}`;
};

const TimingTower = ({ race, lap, second, narrow }) => {
    // Memoised on the lap: these are O(drivers) scans, so recomputing them on
    // an unrelated re-render is wasteful but not dangerous.
    // Who is in the pits on this lap. Lap granularity, which is what the
    // tower updates at anyway — the car itself is visibly down the pit lane on
    // the map, which is the part that needed the derived geometry.
    const pitting = React.useMemo(() => {
        const m = new Map();
        for (const p of race.pits) if (p.lap === lap) m.set(p.driver, p);
        return m;
    }, [race, lap]);

    // Order changes at the line, so it is keyed on the lap. A retired driver
    // simply has no row for later laps, so they would silently disappear —
    // instead they are kept at the bottom, marked OUT, the way a broadcast
    // tower does. Eight of the twenty retired at Australia 2023; a tower that
    // just shrank from 20 rows to 12 tells you nothing about why.
    const { order, retired } = React.useMemo(() => {
        const byLap = orderByLap(race);
        let l = lap;
        while (l > 1 && !byLap.has(l)) l--;
        const running = byLap.get(l) || [];
        const live = new Set(running);
        const gone = race.cars
            .map((c) => c.number)
            .filter((n) => !live.has(n))
            .sort((a, b) => (race.byNumber[b].outAt || 0) - (race.byNumber[a].outAt || 0));
        return { order: [...running, ...gone], retired: new Set(gone) };
    }, [race, lap]);

    // Intervals are continuous, so they are keyed on the SECOND — recomputed
    // once per second of race time rather than once per lap, which is what
    // made the column sit still for a minute and a half at a time.
    const gaps = React.useMemo(() => intervalsAt(race, second), [race, second]);

    const out = retired;

    if (!order.length) return null;

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', gap: 1,
            fontFamily: MONO, fontSize: narrow ? 10 : 11,
        }}>
            {order.map((num, i) => {
                const car = race.byNumber[num];
                if (!car) return null;
                const stint = stintAt(race, num, lap);
                return (
                    <div key={num} style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: narrow ? '2px 5px' : '3px 7px',
                        background: i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)',
                        opacity: out.has(num) ? 0.4 : 1,
                    }}>
                        <span style={{
                            width: 15, textAlign: 'right', color: F1.dim,
                            fontVariantNumeric: 'tabular-nums',
                        }}>{i + 1}</span>
                        <span style={{
                            width: 3, height: 12, background: car.color, flex: '0 0 auto',
                        }} />
                        <span style={{
                            width: 32, fontWeight: 700, color: F1.text, letterSpacing: 0.4,
                        }}>{car.code}</span>
                        <Tyre compound={stint?.compound} />
                        {pitting.has(num) && (
                            <span style={{
                                padding: '1px 4px', fontSize: 8, fontWeight: 800,
                                letterSpacing: 0.8, background: F1.dim, color: F1.bg,
                            }}>
                                {pitting.get(num).red_flag ? 'RED' : 'PIT'}
                            </span>
                        )}
                        <span style={{
                            flex: 1, textAlign: 'right', color: i === 0 ? F1.text : F1.dim,
                            fontVariantNumeric: 'tabular-nums', letterSpacing: 0.2,
                            fontSize: narrow ? 9 : 10,
                        }}>{out.has(num) ? 'OUT' : fmtGap(gaps.get(num))}</span>
                    </div>
                );
            })}
        </div>
    );
};

export default React.memo(TimingTower);
