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
import { standingsAt, aheadAt, stintAt, namedStop } from '../../lib/race';

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

/**
 * Which gap the column is showing.
 *
 * LEADER is the gap to the front of the race; INTERVAL is the gap to the car
 * immediately ahead. Broadcast carries both because they answer different
 * questions — "who is winning" against "is there a fight here" — and a tower
 * this narrow has room for one column at a time.
 */
const COLUMNS = [
    ['leader', 'LEADER'],
    ['ahead', 'INTERVAL'],
];

const TimingTower = ({ race, lap, second, status, narrow }) => {
    const [column, setColumn] = React.useState('leader');
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

    // The interval column is derived from the same standings, so the two views
    // can never disagree about who is where.
    const ahead = React.useMemo(
        () => (column === 'ahead' ? aheadAt(race, second) : null),
        [race, second, column],
    );

    // Retired cars keep their classification but drop to the bottom.
    const order = React.useMemo(
        () => [...live.filter((n) => !retired.has(n)),
               ...live.filter((n) => retired.has(n))],
        [live, retired],
    );

    const out = retired;

    // A stop is the time the car stood still — 2.7 s is a pit stop, and the
    // 24 s pit-lane window around it is what the stop COST. Under a red flag
    // it is neither: the field is parked, and Verstappen's three "stops" at
    // Australia were stationary for 905, 847 and 1839 seconds.
    const pitBadge = (p) => {
        if (p.red_flag) return 'RED';
        const s = namedStop(p.stopped, p.red_flag);
        return s == null ? 'PIT' : `PIT ${s.toFixed(1)}`;
    };

    // The leader has nobody ahead, so the interval column would leave the top
    // row blank. It says LEADER either way, which is the one thing about the
    // top of a timing screen nobody should have to work out.
    const cell = (num, i) => {
        if (out.has(num)) return 'OUT';
        if (i === 0) return 'LEADER';
        return fmtGap(column === 'ahead' ? ahead?.get(num) : gaps.get(num));
    };

    if (!order.length) return null;

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', gap: 1,
            fontFamily: MONO, fontSize: narrow ? 10 : 11,
        }}>
            {/* Which gap the numbers are. Unlabelled, a column of seconds is
                ambiguous — +9.0 to the leader and +9.0 to the car ahead are
                very different races. */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: narrow ? '0 5px 3px' : '0 7px 4px',
                fontSize: 8, fontWeight: 800, letterSpacing: 1,
            }}>
                <span style={{ flex: 1, color: F1.faint }}>GAP TO</span>
                {COLUMNS.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setColumn(id)}
                        style={{
                            border: 'none', cursor: 'pointer',
                            padding: '2px 5px', fontFamily: MONO,
                            fontSize: 8, fontWeight: 800, letterSpacing: 1,
                            background: column === id ? F1.dim : 'transparent',
                            color: column === id ? F1.bg : F1.faint,
                        }}
                    >{label}</button>
                ))}
            </div>
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
                                fontVariantNumeric: 'tabular-nums',
                            }}>
                                {pitBadge(pitting.get(num))}
                            </span>
                        )}
                        <span style={{
                            flex: 1, textAlign: 'right', color: i === 0 ? F1.text : F1.dim,
                            fontVariantNumeric: 'tabular-nums', letterSpacing: 0.2,
                            fontSize: narrow ? 9 : 10,
                        }}>{cell(num, i)}</span>
                    </div>
                );
            })}
        </div>
    );
};

export default React.memo(TimingTower);
