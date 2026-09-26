/**
 * 📄 RaceEnding.jsx — the chequered flag, and what it decided.
 *
 * Until now the replay simply stopped. The clock hit the duration, the cars
 * froze wherever the last frame put them, and the one thing every race is for
 * — who won it — was left to be read off the top row of a timing tower that
 * had gone still. A race with an ending is a different thing to watch.
 *
 * So the flag falls, and then the sheet: the podium, the classification, the
 * fastest lap. It goes over the stage rather than replacing it, because the
 * map underneath is the last frame of the race and that is worth seeing behind
 * the result.
 *
 * Every number comes from `finalClassification`, which is tested, and in
 * particular the GAP is a difference between two crossings of the line rather
 * than a live interval — see the note there for why the obvious version
 * reports the runner-up three minutes behind.
 */
import React from 'react';
import { F1, MONO } from '../../theme';
import { finalClassification, fastestLapUpTo, resultText } from '../../lib/race';

/** How long the flag holds before the sheet arrives, in wall milliseconds. */
const FLAG_MS = 1500;

/** The podium, in the order it is built on: second, first, third. */
const PODIUM_ORDER = [1, 0, 2];
const PODIUM_H = [86, 124, 68];

const fmtLap = (t) => {
    if (t == null) return null;
    const m = Math.floor(t / 60);
    const s = (t - m * 60).toFixed(3).padStart(6, '0');
    return m ? `${m}:${s}` : s;
};

const Step = ({ row, h, narrow }) => {
    if (!row) return null;
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'flex-end', width: narrow ? 86 : 124,
        }}>
            <div style={{
                fontFamily: MONO, fontSize: narrow ? 15 : 19, fontWeight: 700,
                color: F1.text, letterSpacing: 1,
            }}>{row.code}</div>
            <div style={{
                marginTop: 2, marginBottom: 7, fontSize: 9, color: F1.faint,
                letterSpacing: 0.6, textAlign: 'center',
                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}>{row.team}</div>
            {/* The block itself. It grows out of the floor rather than fading
                in, which is the one bit of theatre this screen gets. */}
            <div style={{
                width: '100%', height: h,
                background: `linear-gradient(180deg, ${row.color} 0%, ${row.color}22 100%)`,
                borderTop: `2px solid ${row.color}`,
                display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                paddingTop: 8,
                transformOrigin: 'bottom',
                animation: 'pw-fin-rise 520ms cubic-bezier(.2,.8,.3,1) both',
            }}>
                <span style={{
                    fontFamily: MONO, fontSize: narrow ? 20 : 26, fontWeight: 700,
                    color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                }}>{row.pos}</span>
            </div>
        </div>
    );
};

const Row = ({ r, i }) => (
    <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        padding: '2px 6px',
        background: i % 2 ? 'transparent' : 'rgba(255,255,255,0.02)',
        opacity: r.finished ? 1 : 0.55,
    }}>
        <span style={{
            width: 16, textAlign: 'right', color: F1.dim,
            fontVariantNumeric: 'tabular-nums',
        }}>{r.pos ?? '—'}</span>
        <span style={{ width: 3, height: 11, background: r.color, flex: '0 0 auto' }} />
        <span style={{ width: 32, fontWeight: 700, color: F1.text }}>{r.code}</span>
        <span style={{
            flex: 1, textAlign: 'right', color: r.finished ? F1.dim : F1.faint,
            fontVariantNumeric: 'tabular-nums', fontSize: 9.5,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{resultText(r, i)}</span>
    </div>
);

/**
 * @param announce  throw the chequered flag first. True when the race has
 *                  just finished; false when someone asked for the result
 *                  from the transport, where an announcement would be
 *                  announcing something that did not just happen.
 */
const RaceEnding = ({ race, narrow, announce = true, onClose, onReplay }) => {
    const [phase, setPhase] = React.useState(announce ? 'flag' : 'sheet');

    React.useEffect(() => {
        if (!announce) return undefined;
        const id = setTimeout(() => setPhase('sheet'), FLAG_MS);
        return () => clearTimeout(id);
    }, [announce]);

    const rows = React.useMemo(() => finalClassification(race), [race]);
    const quick = React.useMemo(
        () => fastestLapUpTo(race, race.totalLaps), [race],
    );
    const who = quick && race.byNumber?.[quick.number];

    const podium = [rows[0], rows[1], rows[2]];
    const rest = rows.slice(3);
    // TWO COLUMNS AT EVERY WIDTH, split down the middle so each reads
    // top-to-bottom rather than left-to-right.
    //
    // One column on a narrow stage was the obvious choice and it did not fit:
    // seventeen rows came to 553px inside a 520px stage, which put WATCH
    // AGAIN and CLOSE below the fold of the overlay itself. A row needs about
    // 144px, so two of them clear a 380px stage with room to spare.
    const half = Math.ceil(rest.length / 2);
    const columns = [rest.slice(0, half), rest.slice(half)];

    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 19,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(70% 60% at 50% 45%,'
                + ' rgba(11,11,15,0.95) 0%, rgba(11,11,15,0.86) 100%)',
        }}>
            {/* THE FLAG. A real chequerboard, thrown over the stage and gone —
                conic gradients tile into squares without an image. */}
            {phase === 'flag' && (
                <div style={{
                    position: 'absolute', inset: 0, pointerEvents: 'none',
                    backgroundImage:
                        'repeating-conic-gradient(#fff 0% 25%, #111 0% 50%)',
                    backgroundSize: '56px 56px',
                    animation: `pw-chq ${FLAG_MS}ms ease-out both`,
                }} />
            )}

            {phase === 'flag' ? (
                <div style={{
                    fontSize: narrow ? 18 : 26, fontWeight: 700,
                    letterSpacing: 8, color: '#fff', zIndex: 1,
                    textShadow: '0 3px 18px rgba(0,0,0,0.9)',
                    animation: 'pw-fin-in 420ms ease-out both',
                }}>CHEQUERED FLAG</div>
            ) : (
                <div style={{
                    width: '100%', maxHeight: '100%', overflowY: 'auto',
                    padding: narrow ? '16px 14px' : '20px 26px',
                    animation: 'pw-fin-in 420ms ease-out both',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'baseline', gap: 10,
                        justifyContent: 'center', marginBottom: narrow ? 12 : 16,
                    }}>
                        <span style={{ width: 3, height: 13, background: F1.red }} />
                        <span style={{
                            fontSize: narrow ? 12 : 14, fontWeight: 700,
                            letterSpacing: narrow ? 1.2 : 2, textTransform: 'uppercase',
                            color: F1.text,
                        }}>{race.race}</span>
                        <span style={{
                            fontFamily: MONO, fontSize: 9, letterSpacing: 1.2,
                            color: F1.faint,
                        }}>FINAL CLASSIFICATION</span>
                    </div>

                    {/* podium */}
                    <div style={{
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                        gap: narrow ? 6 : 12, marginBottom: narrow ? 14 : 18,
                    }}>
                        {PODIUM_ORDER.map((p, i) => (
                            <Step key={p} row={podium[p]}
                                h={(narrow ? 0.62 : 1) * PODIUM_H[i]} narrow={narrow} />
                        ))}
                    </div>

                    {/* everyone else */}
                    <div style={{
                        display: 'flex', gap: narrow ? 8 : 18,
                        justifyContent: 'center',
                        fontFamily: MONO, fontSize: narrow ? 9.5 : 10.5,
                    }}>
                        {columns.map((col, ci) => (
                            <div key={ci} style={{
                                flex: '1 1 0', maxWidth: narrow ? 200 : 290,
                                display: 'flex', flexDirection: 'column', gap: 1,
                            }}>
                                {col.map((r) => (
                                    <Row key={r.num} r={r} i={rows.indexOf(r)} />
                                ))}
                            </div>
                        ))}
                    </div>

                    {quick && who && (
                        <div style={{
                            marginTop: 14, textAlign: 'center',
                            fontFamily: MONO, fontSize: 10, color: F1.faint,
                            letterSpacing: 0.6,
                        }}>
                            FASTEST LAP{' '}
                            <span style={{ color: F1.purple }}>
                                {who.code} {fmtLap(quick.time)}
                            </span>
                            {` · LAP ${quick.lap}`}
                        </div>
                    )}

                    <div style={{
                        marginTop: 16, display: 'flex', gap: 8,
                        justifyContent: 'center',
                    }}>
                        <button type="button" onClick={onReplay} style={{
                            background: F1.red, color: '#fff', border: 'none',
                            padding: '9px 20px', cursor: 'pointer',
                            fontSize: 11, fontWeight: 700, letterSpacing: 1.4,
                        }}>▶ WATCH AGAIN</button>
                        <button type="button" onClick={onClose} style={{
                            background: 'transparent', color: F1.dim,
                            border: `1px solid ${F1.line}`,
                            padding: '9px 18px', cursor: 'pointer',
                            fontSize: 11, fontWeight: 700, letterSpacing: 1.4,
                        }}>CLOSE</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(RaceEnding);
