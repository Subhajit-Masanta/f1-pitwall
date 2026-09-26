/**
 * 📄 RaceTrace.jsx — the shape of the whole race, in one picture.
 *
 * Position against lap, one line per driver. It is the chart that answers the
 * questions a running order cannot: who climbed and who fell away, whether a
 * move stuck, where the safety car turned the race over. The strategy chart
 * underneath says what tyres they did it on, so the two read as one story from
 * either side.
 *
 * It fills in as the race runs, like the strategy chart and for the same
 * reason — a line that already reaches the flag has told you the result.
 *
 * TEXT IS HTML, LINES ARE SVG. The plot stretches to whatever width the page
 * gives it, which means `preserveAspectRatio="none"` and a viewBox in lap and
 * position units — lovely for the lines, ruinous for anything with a shape of
 * its own. At 1600px the same transform that fits the chart would draw every
 * driver code 60% too wide. So the labels sit outside the SVG, positioned in
 * percentages of the same box, and the strokes are told not to scale.
 *
 * Every fact comes from `traceRows`, which is tested. This draws it.
 */
import React from 'react';
import { F1, MONO } from '../../theme';
import { traceRows } from '../../lib/race';
import { chartBox } from './chartBox';

/** Position gridlines. Every row would be a cage; these are the landmarks. */
const ROWS = [1, 5, 10, 15, 20];

const ticksFor = (total) => {
    const step = total > 60 ? 10 : total > 30 ? 5 : 2;
    const out = [1];
    for (let l = step; l <= total; l += step) if (l > 1) out.push(l);
    if (out[out.length - 1] !== total) out.push(total);
    return out;
};

const RaceTrace = ({ race, lap, narrow }) => {
    const total = race.totalLaps || 1;
    const now = Math.max(1, Math.min(lap ?? total, total));
    const rows = React.useMemo(() => traceRows(race, now), [race, now]);
    const ticks = React.useMemo(() => ticksFor(total), [total]);

    if (!rows.length) return null;

    // Deepest position anyone has held — usually 20, but a sprint with a
    // retirement or an old season can be fewer, and an empty band at the
    // bottom of the chart is just wasted height.
    const deep = Math.max(...rows.map((r) => Math.max(...r.points.map(([, p]) => p))));
    const lines = ROWS.filter((p) => p <= deep);

    const H = narrow ? 190 : 250;
    const box = chartBox(narrow);

    // Everything is a percentage of the plot box, so the SVG and the HTML
    // labels agree without either knowing the pixel width.
    const fx = (l) => ((l - 1) / Math.max(1, total - 1)) * 100;
    const fy = (p) => ((p - 1) / Math.max(1, deep - 1)) * 100;

    return (
        <div style={{
            padding: narrow ? '12px 12px 14px' : '14px 18px 16px',
            background: F1.panel, border: `1px solid ${F1.line}`,
        }}>
            <div style={{
                display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10,
                flexWrap: 'wrap',
            }}>
                <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: F1.text,
                }}>RACE TRACE</span>
                <span style={{
                    fontFamily: MONO, fontSize: 10, color: F1.faint, letterSpacing: 0.6,
                }}>
                    POSITION BY LAP · LAP {now}<span style={{ opacity: 0.6 }}>/{total}</span>
                </span>
            </div>

            <div style={{ display: 'flex' }}>
                {/* position axis */}
                <div style={{
                    position: 'relative', width: box.left, height: H,
                    flex: '0 0 auto',
                }}>
                    {lines.map((p) => (
                        <span key={p} style={{
                            position: 'absolute', right: 4, top: `${fy(p)}%`,
                            transform: 'translateY(-50%)',
                            fontFamily: MONO, fontSize: 9, color: F1.faint,
                        }}>{p}</span>
                    ))}
                </div>

                {/* the plot */}
                <div style={{
                    position: 'relative', flex: 1, height: H,
                    marginRight: box.right,            // room for the codes
                }}>
                    <svg
                        width="100%" height="100%" viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
                    >
                        {lines.map((p) => (
                            <line
                                key={p} x1="0" x2="100" y1={fy(p)} y2={fy(p)}
                                stroke={F1.line} strokeWidth="1"
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        {rows.map((r) => (
                            <path
                                key={r.number}
                                d={r.points.map(([l, p], i) =>
                                    `${i ? 'L' : 'M'} ${fx(l).toFixed(3)},${fy(p).toFixed(3)}`).join(' ')}
                                fill="none" stroke={r.color} strokeWidth="2"
                                strokeLinecap="round" strokeLinejoin="round"
                                strokeOpacity="0.9"
                                vectorEffect="non-scaling-stroke"
                            >
                                <title>{r.code}</title>
                            </path>
                        ))}
                    </svg>

                    {/* where each line has got to, and whose it is — twenty
                        lines are only readable if they are named */}
                    {rows.map((r) => (
                        <div key={r.number} style={{
                            position: 'absolute',
                            left: `${fx(r.last[0])}%`, top: `${fy(r.last[1])}%`,
                            transform: 'translate(-50%, -50%)',
                            width: 5, height: 5, borderRadius: '50%',
                            background: r.color, pointerEvents: 'none',
                        }} />
                    ))}
                    {!narrow && rows.map((r) => (
                        <span key={r.number} style={{
                            position: 'absolute',
                            left: `calc(${fx(r.last[0])}% + 6px)`, top: `${fy(r.last[1])}%`,
                            transform: 'translateY(-50%)',
                            fontFamily: MONO, fontSize: 9, fontWeight: 700,
                            color: r.color, whiteSpace: 'nowrap', pointerEvents: 'none',
                        }}>{r.code}</span>
                    ))}
                </div>
            </div>

            {/* lap axis */}
            <div style={{ display: 'flex' }}>
                <span style={{ width: box.left, flex: '0 0 auto' }} />
                <div style={{
                    position: 'relative', flex: 1, height: 12,
                    marginRight: box.right,
                }}>
                    {ticks.map((l) => (
                        <span key={l} style={{
                            position: 'absolute', left: `${fx(l)}%`, top: 2,
                            transform: l === total ? 'translateX(-100%)' : 'translateX(-50%)',
                            fontFamily: MONO, fontSize: 9, color: F1.faint,
                        }}>{l}</span>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default React.memo(RaceTrace);
