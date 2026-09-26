/**
 * 📄 RaceCard.jsx — what you are about to watch.
 *
 * The moment a race finished loading you were looking at twenty dots on a grid
 * and a PLAY button, with nothing to say whether this was the one with three
 * red flags or a procession — which is the question you had when you picked it
 * out of a list of twenty-two names.
 *
 * So the arrival gets a card: the circuit, the distance, and the handful of
 * numbers that describe the race. It is over the stage, it goes the moment you
 * press play, and it never comes back for that race.
 *
 * Every number comes from `raceSummary`, which is tested.
 */
import React from 'react';
import { F1, MONO } from '../../theme';
import { raceSummary } from '../../lib/race';

const fmtLap = (t) => {
    if (t == null) return null;
    const m = Math.floor(t / 60);
    const s = (t - m * 60).toFixed(3).padStart(6, '0');
    return m ? `${m}:${s}` : s;
};

const Stat = ({ n, label, tone }) => (
    <div style={{ textAlign: 'center', minWidth: 62 }}>
        <div style={{
            fontFamily: MONO, fontSize: 26, fontWeight: 700, lineHeight: 1,
            color: tone || F1.text, fontVariantNumeric: 'tabular-nums',
        }}>{n}</div>
        <div style={{
            marginTop: 6, fontSize: 9, fontWeight: 700, letterSpacing: 1.2,
            color: F1.faint,
        }}>{label}</div>
    </div>
);

const RaceCard = ({ race, byNumber, narrow, onStart }) => {
    const s = React.useMemo(() => raceSummary(race), [race]);
    const quick = s.fastest;
    const who = quick && byNumber?.[quick.number];

    // A race with nothing to say about it gets no card. A procession is a
    // perfectly good race; it is just not one that needs announcing.
    const notable = s.redFlags || s.safetyCars || s.vsc || s.retirements > 2;
    if (!notable) return null;

    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'radial-gradient(60% 50% at 50% 50%,'
                + ' rgba(11,11,15,0.92) 0%, rgba(11,11,15,0.72) 100%)',
            animation: 'pw-rc-in 320ms ease-out both',
        }}>
            <div style={{
                padding: narrow ? '20px 22px' : '26px 34px',
                background: F1.panel, border: `1px solid ${F1.line}`,
                maxWidth: narrow ? '92%' : 560, textAlign: 'center',
                boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
            }}>
                <div style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: 1.6, color: F1.faint,
                }}>
                    {(race.session || 'RACE').toUpperCase()} · {race.circuit}
                </div>
                <div style={{
                    marginTop: 8, fontSize: narrow ? 17 : 21, fontWeight: 700,
                    letterSpacing: narrow ? 1 : 1.6, textTransform: 'uppercase',
                    color: F1.text,
                }}>{race.race}</div>

                <div style={{
                    marginTop: 20, display: 'flex', justifyContent: 'center',
                    gap: narrow ? 12 : 22, flexWrap: 'wrap',
                }}>
                    <Stat n={s.laps} label="LAPS" />
                    {s.redFlags > 0 && (
                        <Stat n={s.redFlags} label={s.redFlags === 1 ? 'RED FLAG' : 'RED FLAGS'}
                            tone="#FF1E1E" />
                    )}
                    {(s.safetyCars + s.vsc) > 0 && (
                        <Stat n={s.safetyCars + s.vsc} label="SAFETY CARS" tone="#FFD024" />
                    )}
                    <Stat n={s.leaders} label={s.leaders === 1 ? 'LEADER' : 'LEADERS'} />
                    <Stat n={s.stops} label="PIT STOPS" />
                    <Stat n={s.retirements} label="OUT" />
                </div>

                {quick && who && (
                    <div style={{
                        marginTop: 18, paddingTop: 14, borderTop: `1px solid ${F1.line}`,
                        fontFamily: MONO, fontSize: 10, color: F1.faint, letterSpacing: 0.6,
                    }}>
                        FASTEST LAP{' '}
                        <span style={{ color: F1.purple }}>
                            {who.code} {fmtLap(quick.time)}
                        </span>
                        {` · LAP ${quick.lap}`}
                    </div>
                )}

                <button
                    type="button"
                    onClick={onStart}
                    style={{
                        marginTop: 20, display: 'inline-flex', alignItems: 'center',
                        gap: 8, background: F1.red, color: '#fff', border: 'none',
                        padding: '11px 26px', cursor: 'pointer',
                        fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
                    }}
                >▶ START RACE</button>

                <div style={{
                    marginTop: 10, fontFamily: MONO, fontSize: 9, color: F1.faint,
                    letterSpacing: 0.4,
                }}>SPACE TO PLAY · ARROWS TO STEP A LAP</div>
            </div>
        </div>
    );
};

export default React.memo(RaceCard);
