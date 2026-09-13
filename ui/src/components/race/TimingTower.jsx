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
import { standingsAt, stintAt } from '../../lib/race';

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

// The leader is whoever sits at the top of the order, not whoever happens to
// compute to exactly zero — an interpolated float lands on +0.000, not 0.
const fmtGap = (g) => (g == null ? '—' : `+${g.toFixed(3)}`);

const TimingTower = ({ race, lap, second, status, narrow }) => {
    // WHO IS IN THE PITS, BY TIME. This was keyed on the lap, and Australia
    // 2023 shows why that is wrong twice over: at lap 1 it badged five cars
    // PIT from lights-out because they pitted later in that lap, and at lap 8
    // the red flag gave every running car a pit window so all eighteen read
    // RED simultaneously. A car is in the pits when the clock is inside its
    // stop, and at no other time.
    const pitting = React.useMemo(() => {
        const red = status?.code === '5';
        const m = new Map();
        for (const p of race.pits) {
            if (p.t == null) continue;
            if (second < p.t || second > p.t + (p.window || 0)) continue;
            // A red-flag window runs until the car is RELEASED at the restart,
            // so it outlives the red flag by minutes. Badging on the window
            // alone lit up eighteen rows with RED on lap 9 while the banner
            // said nothing at all. The flag badge belongs to the flag.
            if (p.red_flag && !red) continue;
            m.set(p.driver, p);
        }
        return m;
    }, [race, second, status]);

    // WHO IS OUT, BY TIME. Membership of a lap's order is not retirement:
    // Leclerc crashed on lap 1 so he has no row for it, and the tower called
    // him OUT from the very first frame — thirty seconds before he actually
    // went off.
    const retired = React.useMemo(() => {
        const m = new Set();
        for (const c of race.cars) if (second > c.outAt) m.add(c.number);
        return m;
    }, [race, second]);

    // Order AND gaps from one calculation, keyed on the second. Keeping them
    // separate — rows from the last completed lap, gaps from the live clock —
    // meant the two disagreed constantly (718 measured samples where a lower
    // row showed a smaller gap than the one above it).
    const { order: live, gaps } = React.useMemo(
        () => standingsAt(race, second), [race, second],
    );

    // Retired cars keep their classification but drop to the bottom.
    const order = React.useMemo(
        () => [...live.filter((n) => !retired.has(n)),
               ...live.filter((n) => retired.has(n))],
        [live, retired],
    );

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
                        }}>{out.has(num) ? 'OUT' : i === 0 ? 'LEADER' : fmtGap(gaps.get(num))}</span>
                    </div>
                );
            })}
        </div>
    );
};

export default React.memo(TimingTower);
