/**
 * 📄 StrategyChart.jsx — every driver's race on one row.
 *
 * The payload has carried tyre stints and pit stops since the race mode was
 * built, and the tower only ever showed the compound a driver is on RIGHT NOW.
 * That answers "what tyre is he on" and nothing else: not when he stopped, not
 * how many times, not whether the man behind is on fresher rubber — which is
 * the whole of race strategy.
 *
 * So: one row per driver in finishing order, the lap axis across the top, and
 * the stints drawn as blocks in the real compound colours. A stop sits on the
 * boundary between two blocks with the time the car was stationary, because
 * that is the number a viewer can compare between teams.
 *
 * Pure presentation. Every fact comes from `strategyRows`, which is tested.
 */
import React from 'react';
import { F1, MONO } from '../../theme';
import { strategyRows, lapAt, namedStop } from '../../lib/race';

/** The real F1 compound markings — the same map the tower uses. */
const COMPOUND = {
    SOFT: '#FF3B30',
    MEDIUM: '#FFD024',
    HARD: '#D7D7DE',
    INTERMEDIATE: '#22C55E',
    WET: '#3671C6',
};

/** Ink that stays readable on each of those. */
const INK = {
    SOFT: '#FFFFFF',
    MEDIUM: '#1A1400',
    HARD: '#0B0B0F',
    INTERMEDIATE: '#04140B',
    WET: '#FFFFFF',
};

const LABEL = {
    SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W',
};

// A red-flag change is still drawn as a tyre change, because it was one. It
// just never gets a number: see namedStop.
const realStop = (stop) => namedStop(stop.stopped, stop.redFlag) != null;

/** Lap ticks that land on round numbers and never crowd. */
const ticksFor = (total) => {
    const step = total > 60 ? 10 : total > 30 ? 5 : 2;
    const out = [1];
    for (let l = step; l <= total; l += step) if (l > 1) out.push(l);
    if (out[out.length - 1] !== total) out.push(total);
    return out;
};

const Stint = ({ stint, total, narrow }) => {
    const compound = stint.compound in COMPOUND ? stint.compound : null;
    // `from` and `to` are inclusive lap numbers, so a one-lap stint spans one
    // lap of width, not zero.
    const left = ((stint.from - 1) / total) * 100;
    const width = ((stint.to - stint.from + 1) / total) * 100;
    const laps = stint.to - stint.from + 1;
    const bg = compound ? COMPOUND[compound] : F1.faint;
    // A used set is the fact that decides an overtake; hatching says it
    // without spending another colour.
    const worn = stint.fresh === false;
    return (
        <div
            title={`${stint.compound} · laps ${stint.from}-${stint.to}`
                + (stint.life != null ? ` · ${worn ? 'used' : 'new'}, life ${stint.life}` : '')}
            style={{
                position: 'absolute', left: `${left}%`, width: `${width}%`,
                top: 0, bottom: 0, background: bg,
                backgroundImage: worn
                    ? 'repeating-linear-gradient(115deg, rgba(0,0,0,0.30) 0 3px,'
                      + ' rgba(0,0,0,0) 3px 7px)'
                    : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
            }}
        >
            {/* The letter needs about three laps of room before it reads as a
                letter rather than as a smudge. */}
            {laps / total > (narrow ? 0.09 : 0.05) && (
                <span style={{
                    fontFamily: MONO, fontSize: narrow ? 8 : 9, fontWeight: 800,
                    color: compound ? INK[compound] : F1.bg, letterSpacing: 0.5,
                }}>
                    {compound ? LABEL[compound] : '?'}{laps >= 8 ? ` ${laps}` : ''}
                </span>
            )}
        </div>
    );
};

/**
 * A stop is a tick on the boundary, and its time lives in the tooltip.
 *
 * Printing every stop's seconds along the row was the first draft, and with
 * twenty rows and fifty stops it produced a field of 8px numbers colliding
 * with the row above. Broadcast names ONE stop — the fastest of the race —
 * and that one is in the header.
 */
const Stop = ({ stop, total, best }) => {
    const left = ((stop.lap - 1) / total) * 100;
    const isBest = stop === best;
    return (
        <div
            title={stop.redFlag
                ? `Lap ${stop.lap} · tyres changed under a red flag`
                : `Lap ${stop.lap} · ${stop.stopped == null ? 'stop' : `${stop.stopped.toFixed(1)}s stationary`}`}
            style={{
                position: 'absolute', left: `${left}%`,
                top: isBest ? -3 : 0, bottom: isBest ? -3 : 0,
                width: isBest ? 3 : 2, marginLeft: -1,
                background: F1.bg,
                boxShadow: `0 0 0 1px ${stop.redFlag ? 'rgba(255,255,255,0.35)' : F1.text}`,
            }}
        />
    );
};

const StrategyChart = ({ race, narrow }) => {
    const rows = React.useMemo(() => strategyRows(race), [race]);
    const total = race.totalLaps || 1;
    const ticks = React.useMemo(() => ticksFor(total), [total]);

    // WHERE THE RACE STOPPED, once. Every car changes tyres under a red flag,
    // so marking it per car drew the same three events twenty times over — and
    // left a gap in the line wherever a driver was already out. It is one
    // thing that happened to the whole race, so it is drawn behind all of it.
    const redLaps = React.useMemo(
        () => (race.redSpans || []).map(([a]) => lapAt(race, a)),
        [race],
    );

    // The fastest stop of the race — the one number broadcast always names.
    const best = React.useMemo(() => {
        let stop = null, row = null;
        for (const r of rows) {
            for (const st of r.stops) {
                if (!realStop(st)) continue;
                if (!stop || st.stopped < stop.stopped) { stop = st; row = r; }
            }
        }
        return stop ? { stop, row } : null;
    }, [rows]);

    if (!rows.length) return null;
    const anyStint = rows.some((r) => r.stints.length);
    if (!anyStint) return null;

    const nameW = narrow ? 58 : 74;

    return (
        <div style={{
            padding: narrow ? '12px 12px 14px' : '14px 18px 18px',
            background: F1.panel, border: `1px solid ${F1.line}`,
        }}>
            <div style={{
                display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12,
                flexWrap: 'wrap',
            }}>
                <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: F1.text,
                }}>TYRE STRATEGY</span>
                <span style={{
                    fontFamily: MONO, fontSize: 10, color: F1.faint, letterSpacing: 0.6,
                }}>
                    {total} LAPS
                    {best && (
                        <>
                            {' · FASTEST STOP '}
                            <span style={{ color: F1.text }}>
                                {best.stop.stopped.toFixed(1)}s
                            </span>
                            {` ${best.row.code}, LAP ${best.stop.lap}`}
                        </>
                    )}
                </span>
                <div style={{
                    marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center',
                }}>
                    {Object.keys(COMPOUND).map((c) => (
                        <span key={c} style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            fontFamily: MONO, fontSize: 9, color: F1.dim,
                        }}>
                            <span style={{
                                width: 8, height: 8, background: COMPOUND[c], flex: '0 0 auto',
                            }} />
                            {narrow ? LABEL[c] : c}
                        </span>
                    ))}
                </div>
            </div>

            {/* lap axis */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: nameW, flex: '0 0 auto' }} />
                <div style={{ position: 'relative', flex: 1, height: 11 }}>
                    {ticks.map((l) => (
                        <span key={l} style={{
                            position: 'absolute', left: `${((l - 1) / total) * 100}%`,
                            fontFamily: MONO, fontSize: 8, color: F1.faint,
                            transform: l === total ? 'translateX(-100%)' : 'none',
                            fontVariantNumeric: 'tabular-nums',
                        }}>{l}</span>
                    ))}
                </div>
            </div>

            <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {rows.map((r) => (
                    <div key={r.number} style={{
                        display: 'flex', alignItems: 'center',
                        opacity: r.finish == null ? 0.55 : 1,
                    }}>
                        <span style={{
                            width: nameW, flex: '0 0 auto', display: 'flex',
                            alignItems: 'center', gap: 5,
                            fontFamily: MONO, fontSize: narrow ? 9 : 10,
                        }}>
                            <span style={{
                                width: 15, textAlign: 'right', color: F1.faint,
                                fontVariantNumeric: 'tabular-nums',
                            }}>{r.finish ?? '—'}</span>
                            <span style={{
                                width: 3, height: 11, background: r.color, flex: '0 0 auto',
                            }} />
                            <span style={{
                                fontWeight: 700, color: F1.text, letterSpacing: 0.4,
                            }}>{r.code}</span>
                        </span>
                        <div style={{
                            position: 'relative', flex: 1,
                            height: narrow ? 13 : 15,
                            background: 'rgba(255,255,255,0.03)',
                        }}>
                            {r.stints.map((s, k) => (
                                <Stint key={k} stint={s} total={total} narrow={narrow} />
                            ))}
                            {r.stops.map((s, k) => (
                                <Stop key={k} stop={s} total={total}
                                    best={best && best.stop} />
                            ))}
                        </div>
                    </div>
                ))}
                </div>
                {/* THE RED FLAGS, once, over the whole field. Behind it they
                    vanished under the stint blocks and survived only in the
                    gaps, which read as a rendering fault rather than a mark. */}
                <div style={{
                    position: 'absolute', left: nameW, right: 0, top: 0, bottom: 0,
                    pointerEvents: 'none',
                }}>
                    {redLaps.map((l, k) => (
                        <div key={k} style={{
                            position: 'absolute', top: -2, bottom: -2,
                            left: `${((l - 1) / total) * 100}%`,
                            width: 1, marginLeft: -0.5,
                            background: '#FF1E1E', opacity: 0.85,
                        }} />
                    ))}
                </div>
            </div>

            {redLaps.length > 0 && (
                <div style={{
                    marginTop: 9, display: 'flex', alignItems: 'center', gap: 6,
                    fontFamily: MONO, fontSize: 9, color: F1.faint, letterSpacing: 0.6,
                }}>
                    <span style={{
                        width: 2, height: 9, background: 'rgba(255,30,30,0.55)',
                    }} />
                    RED FLAG · LAP {redLaps.join(', ')}
                    <span style={{ marginLeft: 10 }}>
                        HATCHED = A USED SET
                    </span>
                </div>
            )}
        </div>
    );
};

export default React.memo(StrategyChart);
