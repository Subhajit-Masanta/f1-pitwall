/**
 * 📄 SpeedTrace.jsx — the chart stack under the map.
 *
 * Two layouts, one component:
 *
 *   SOLO     speed against distance, then the pedals.
 *   COMPARE  no speed chart at all — one pedal panel per driver in their own
 *            team colour, then the delta. Comparing is about what the two
 *            drivers DID with the car; a single shared speed line answered a
 *            different question and cost the room these panels need.
 *
 * Same two-layer trick throughout: every chart is a static SVG promoted to its
 * own compositor layer, and each playhead is a separate absolutely positioned
 * element moved with translate3d. Nothing re-renders in React while the lap
 * plays — the parent calls `update(frame)` and we write to the DOM.
 */
import React, {
    forwardRef, useImperativeHandle, useRef, useEffect, useCallback,
} from 'react';
import { F1, MONO } from '../theme';

const Row = ({ left, right, mt = 7, mb = 4 }) => (
    <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginTop: mt, marginBottom: mb, gap: 10,
    }}>
        {left}
        {right}
    </div>
);

const Label = ({ children }) => (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.3, color: F1.dim }}>
        {children}
    </span>
);

const Mono = ({ children }) => (
    <span style={{ fontFamily: MONO, fontSize: 10, color: F1.dim }}>{children}</span>
);

const Swatch = ({ color, label }) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ width: 12, height: 2, background: color }} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: F1.dim }}>
            {label}
        </span>
    </span>
);

const SectorLabels = ({ sectorX, W }) => (
    <div style={{
        position: 'relative', height: 14, marginTop: 3,
        fontSize: 9, fontWeight: 700, letterSpacing: 1, color: F1.dim,
    }}>
        {['S1', 'S2', 'S3'].map((lbl, i) => {
            const startPct = i === 0 ? 0 : (sectorX[i - 1] / W) * 100;
            return (
                <span key={lbl} style={{
                    position: 'absolute', left: `${startPct}%`, paddingLeft: 4,
                    color: [F1.s1, F1.s2, F1.s3][i],
                }}>
                    {lbl}
                </span>
            );
        })}
    </div>
);

const Playhead = ({ headRef }) => (
    <div ref={headRef} style={{
        position: 'absolute', left: 0, top: 0, width: 1, height: '100%',
        background: F1.red, opacity: 0, willChange: 'transform',
        pointerEvents: 'none',
    }} />
);

/** One driver's pedals: throttle line in their team colour, braking as peaks. */
const PedalPanel = ({ geom, title, subtitle, color, height, sectorX, headRef, first, dashed }) => {
    const { W, H } = geom;
    return (
        <>
            <Row
                mt={first ? 0 : 9}
                left={
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{
                            width: 3, height: 12, backgroundColor: color,
                            backgroundImage: dashed
                                ? `repeating-linear-gradient(180deg, ${color} 0 3px, rgba(0,0,0,0.6) 3px 5px)`
                                : 'none',
                        }} />
                        <span style={{
                            fontFamily: MONO, fontSize: 11, fontWeight: 700,
                            letterSpacing: 0.6, color: F1.text,
                        }}>
                            {title}
                        </span>
                        {subtitle && <Label>{subtitle.toUpperCase()}</Label>}
                    </span>
                }
                right={<Mono>PEAK {geom.peakG.toFixed(1)}G</Mono>}
            />

            <div style={{ position: 'relative', width: '100%', height }}>
                <svg
                    width="100%" height={height} viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    style={{
                        position: 'absolute', inset: 0, display: 'block',
                        willChange: 'transform', transform: 'translateZ(0)',
                    }}
                >
                    {sectorX.map((sx, i) => (
                        <line key={i} x1={sx} y1={0} x2={sx} y2={H}
                            stroke={i === 0 ? F1.s1 : F1.s2} strokeOpacity="0.5"
                            strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    ))}

                    {/* Brake red: the F1 convention, and it means the same thing
                        in both panels, so it is not the driver's colour. The red
                        itself is #FF3B30 rather than the old #E10600 — that one
                        at low alpha over near-black went BROWN under an orange
                        McLaren line, which is what made this look muddy.

                        It stays a FILLED MASS with no outline while throttle is
                        the only stroked line, so brake and throttle separate by
                        fill-versus-stroke, not by hue. That is what keeps it
                        readable against the red teams' own colour (Ferrari
                        #E80020, Alfa #C92D4B). */}
                    {geom.brakeShapes.map((b, i) => (
                        <path key={i} d={b.area} fill={F1.brk} fillOpacity="0.55" />
                    ))}

                    <path d={geom.throttlePath} fill="none" stroke={color}
                        strokeWidth={2.2} strokeLinejoin="round"
                        strokeDasharray={dashed ? '6 3' : undefined}
                        vectorEffect="non-scaling-stroke" />
                </svg>

                <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0, height: 1,
                    background: F1.line, pointerEvents: 'none',
                }} />
                <Playhead headRef={headRef} />
            </div>
        </>
    );
};

const SpeedTrace = forwardRef(({
    trace, narrow, height, pedalHeight, compare = null, deltaHeight = 0,
}, ref) => {
    const wrapRef = useRef(null);
    const headRef = useRef(null);
    const dotRef = useRef(null);
    const pedalHeadRef = useRef(null);
    const deltaHeadRef = useRef(null);
    const panelHeads = useRef([]);
    const widthRef = useRef(0);

    const measure = useCallback(() => {
        if (wrapRef.current) widthRef.current = wrapRef.current.clientWidth;
    }, []);

    useEffect(() => {
        measure();
        const ro = new ResizeObserver(measure);
        if (wrapRef.current) ro.observe(wrapRef.current);
        return () => ro.disconnect();
    }, [measure]);

    useImperativeHandle(ref, () => ({
        update(fr) {
            if (!trace) return;
            const w = widthRef.current;
            const frac = Math.max(0, Math.min(1, fr.dist / trace.total));
            const px = (frac * w).toFixed(2);

            // every chart shares the distance axis, so one x serves them all
            const move = (el) => {
                if (!el) return;
                el.style.transform = `translate3d(${px}px,0,0)`;
                el.style.opacity = '1';
            };

            if (compare?.panels) {
                panelHeads.current.forEach(move);
                move(deltaHeadRef.current);
                return;
            }

            move(headRef.current);
            move(pedalHeadRef.current);
            if (dotRef.current) {
                const yPx = height - (Math.min(fr.speed, trace.maxS) / trace.maxS) * height;
                dotRef.current.style.transform = `translate3d(${px}px, ${yPx.toFixed(2)}px, 0)`;
                dotRef.current.style.opacity = '1';
            }
        },
    }), [trace, height, compare]);

    if (!trace) return null;
    const { line, area, W, H, sectorX, drsBars, brakePaths, maxS, pedal } = trace;

    // ---- COMPARE: one pedal panel per driver, then the delta ---------------
    if (compare?.panels) {
        // The reference car's colour — the delta is drawn against it.
        const aColor = compare.panels[0]?.color || F1.dim;
        return (
            <div ref={wrapRef} style={{ width: '100%' }}>
                {compare.panels.map((p, i) => (
                    <PedalPanel
                        key={`${p.code}-${i}`}
                        geom={p.geom}
                        title={p.code}
                        subtitle={p.team}
                        color={p.color}
                        // Team-mates share a team colour (VER and PER are both
                        // #3671C6), so the second one is broken up to stay
                        // distinguishable in an intra-team battle.
                        dashed={i > 0 && p.color === compare.panels[0].color}
                        first={i === 0}
                        height={pedalHeight}
                        sectorX={sectorX}
                        headRef={(el) => { panelHeads.current[i] = el; }}
                    />
                ))}

                {deltaHeight > 0 && compare.deltaPath && (
                    <>
                        <Row
                            mt={9}
                            left={<Label>DELTA</Label>}
                            right={
                                <Mono>
                                    ±{compare.deltaMax.toFixed(1)}s · above{' '}
                                    <span style={{ color: aColor, fontWeight: 700 }}>
                                        {compare.panels[0].code}
                                    </span>{' '}ahead · below{' '}
                                    <span style={{ color: compare.color, fontWeight: 700 }}>
                                        {compare.code}
                                    </span>{' '}ahead
                                </Mono>
                            }
                        />
                        <div style={{ position: 'relative', width: '100%', height: deltaHeight }}>
                            <svg
                                width="100%" height={deltaHeight}
                                viewBox={`0 0 ${W} ${compare.DH}`} preserveAspectRatio="none"
                                style={{
                                    position: 'absolute', inset: 0, display: 'block',
                                    willChange: 'transform', transform: 'translateZ(0)',
                                }}
                            >
                                {sectorX.map((sx, i) => (
                                    <line key={i} x1={sx} y1={0} x2={sx} y2={compare.DH}
                                        stroke={i === 0 ? F1.s1 : F1.s2} strokeOpacity="0.28"
                                        strokeWidth={1} vectorEffect="non-scaling-stroke" />
                                ))}
                                {/* The fill is the readout. Above the zero line the
                                    reference is ahead, below it the ghost is — so each
                                    half carries that driver's team colour and the shape
                                    alone says who is winning which part of the lap. A
                                    single flat fill could not: it looked identical
                                    whoever was in front. The hard stop at 50% is the
                                    zero line, which is where the area path closes. */}
                                <defs>
                                    <linearGradient id="deltaFill" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={aColor} stopOpacity="0.42" />
                                        <stop offset="49.9%" stopColor={aColor} stopOpacity="0.12" />
                                        <stop offset="50.1%" stopColor={compare.color} stopOpacity="0.12" />
                                        <stop offset="100%" stopColor={compare.color} stopOpacity="0.42" />
                                    </linearGradient>
                                </defs>
                                <path d={compare.deltaArea} fill="url(#deltaFill)" />
                                <path d={compare.deltaPath} fill="none" stroke={compare.color}
                                    strokeWidth={1.75} strokeLinejoin="round"
                                    vectorEffect="non-scaling-stroke" />
                                <line x1={0} y1={compare.DH / 2} x2={W} y2={compare.DH / 2}
                                    stroke={F1.dim} strokeOpacity="0.55" strokeWidth={1}
                                    strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                            </svg>
                            <Playhead headRef={deltaHeadRef} />
                        </div>
                    </>
                )}

                {!narrow && sectorX.length === 2 && <SectorLabels sectorX={sectorX} W={W} />}
            </div>
        );
    }

    // ---- SOLO: speed, then pedals -----------------------------------------
    return (
        <div ref={wrapRef} style={{ width: '100%' }}>
            <Row
                mt={0} mb={5}
                left={<Label>SPEED</Label>}
                right={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {brakePaths?.length > 0 && <Swatch color={F1.brk} label="BRAKING" />}
                        {drsBars?.length > 0 && <Swatch color={F1.drs} label="DRS" />}
                        <Mono>{Math.round(maxS)} km/h</Mono>
                    </div>
                }
            />

            <div style={{ position: 'relative', width: '100%', height }}>
                <svg
                    width="100%" height={height} viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    style={{
                        position: 'absolute', inset: 0, display: 'block',
                        willChange: 'transform', transform: 'translateZ(0)',
                    }}
                >
                    {drsBars.map((z, i) => (
                        <rect key={i} x={z.x1} y={H - 3} width={z.x2 - z.x1} height={3}
                            fill={F1.drs} opacity="0.85" />
                    ))}
                    {sectorX.map((sx, i) => (
                        <line key={i} x1={sx} y1={0} x2={sx} y2={H}
                            stroke={i === 0 ? F1.s1 : F1.s2} strokeOpacity="0.5"
                            strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    ))}

                    <path d={area} fill={F1.text} opacity="0.05" />
                    <path d={line} fill="none" stroke={F1.text} strokeWidth={1.5}
                        strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

                    {brakePaths?.map((d, i) => (
                        <path key={i} d={d} fill="none" stroke={F1.brk} strokeWidth={2.5}
                            strokeLinecap="round" strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke" />
                    ))}
                </svg>

                <Playhead headRef={headRef} />
                <div ref={dotRef} style={{
                    position: 'absolute', left: 0, top: 0, width: 0, height: 0,
                    opacity: 0, willChange: 'transform', pointerEvents: 'none',
                }}>
                    <div style={{
                        position: 'absolute', left: 0, top: 0,
                        transform: 'translate(-50%,-50%)',
                        width: 7, height: 7, borderRadius: '50%',
                        background: F1.red, border: '1.5px solid #fff',
                    }} />
                </div>
                <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0, height: 1,
                    background: F1.line, pointerEvents: 'none',
                }} />
            </div>

            {pedal && (
                <PedalPanel
                    geom={{
                        W: pedal.W, H: pedal.H,
                        throttlePath: pedal.throttleLine,
                        brakeShapes: pedal.brakeShapes,
                        peakG: pedal.peakG,
                    }}
                    title="PEDALS"
                    // Solo: one car, so the throttle takes the convention green
                    // rather than an identity colour there is nobody to contrast with.
                    color={F1.thr}
                    height={pedalHeight}
                    sectorX={sectorX}
                    headRef={(el) => { pedalHeadRef.current = el; }}
                />
            )}

            {!narrow && sectorX.length === 2 && <SectorLabels sectorX={sectorX} W={W} />}
        </div>
    );
});

SpeedTrace.displayName = 'SpeedTrace';
export default React.memo(SpeedTrace);
