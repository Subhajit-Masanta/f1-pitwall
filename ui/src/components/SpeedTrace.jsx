/**
 * 📄 SpeedTrace.jsx — speed against lap distance, with a playhead that tracks
 * the car.
 *
 * Same two-layer trick as the track map: the trace itself is a static SVG
 * promoted to its own compositor layer, and the playhead is a separate absolutely
 * positioned element moved with translate3d. Nothing re-renders in React while
 * the lap plays — the parent calls `update(frame)` and we write to the DOM.
 */
import React, {
    forwardRef, useImperativeHandle, useRef, useEffect, useCallback,
} from 'react';
import { F1, MONO } from '../theme';

const SpeedTrace = forwardRef(({ trace, narrow, height, pedalHeight }, ref) => {
    const wrapRef = useRef(null);
    const headRef = useRef(null);
    const dotRef = useRef(null);
    const pedalHeadRef = useRef(null);
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
            const h = height;
            const frac = Math.max(0, Math.min(1, fr.dist / trace.total));
            if (headRef.current) {
                headRef.current.style.transform = `translate3d(${(frac * w).toFixed(2)}px,0,0)`;
                headRef.current.style.opacity = '1';
            }
            if (dotRef.current) {
                const yPx = h - (Math.min(fr.speed, trace.maxS) / trace.maxS) * h;
                dotRef.current.style.transform =
                    `translate3d(${(frac * w).toFixed(2)}px, ${yPx.toFixed(2)}px, 0)`;
                dotRef.current.style.opacity = '1';
            }
            // pedal band shares the distance axis, so the same x carries over
            if (pedalHeadRef.current) {
                pedalHeadRef.current.style.transform = `translate3d(${(frac * w).toFixed(2)}px,0,0)`;
                pedalHeadRef.current.style.opacity = '1';
            }
        },
    }), [trace, height]);

    if (!trace) return null;
    const { line, area, W, H, sectorX, drsBars, brakePaths, maxS, pedal } = trace;

    return (
        <div style={{ width: '100%' }}>
            {/* label row — real layout space so nothing overlaps the chart */}
            <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                marginBottom: 5,
            }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.3, color: F1.dim }}>
                    SPEED
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {brakePaths?.length > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 12, height: 2, background: F1.red }} />
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: F1.dim }}>
                                BRAKING
                            </span>
                        </span>
                    )}
                    {drsBars?.length > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 12, height: 2, background: F1.drs }} />
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: F1.dim }}>
                                DRS
                            </span>
                        </span>
                    )}
                    <span style={{ fontFamily: MONO, fontSize: 10, color: F1.dim }}>
                        {Math.round(maxS)} km/h
                    </span>
                </div>
            </div>

            <div ref={wrapRef} style={{ position: 'relative', width: '100%', height }}>
                <svg
                    width="100%" height={height} viewBox={`0 0 ${W} ${H}`}
                    preserveAspectRatio="none"
                    style={{
                        position: 'absolute', inset: 0, display: 'block',
                        // rasterise once — the playhead moves on its own layer
                        willChange: 'transform', transform: 'translateZ(0)',
                    }}
                >
                    {/* DRS zones, as a band along the floor */}
                    {drsBars.map((z, i) => (
                        <rect key={i} x={z.x1} y={H - 3} width={z.x2 - z.x1} height={3}
                            fill={F1.drs} opacity="0.85" />
                    ))}

                    {/* sector divisions */}
                    {sectorX.map((sx, i) => (
                        <line key={i} x1={sx} y1={0} x2={sx} y2={H}
                            stroke={i === 0 ? F1.s1 : F1.s2} strokeOpacity="0.5"
                            strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    ))}

                    {/* the trace */}
                    <path d={area} fill={F1.text} opacity="0.05" />
                    <path d={line} fill="none" stroke={F1.text} strokeWidth={1.5}
                        strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

                    {/* braking — drawn last so it sits on top of the white line */}
                    {brakePaths?.map((d, i) => (
                        <path key={i} d={d} fill="none" stroke={F1.red} strokeWidth={2.5}
                            strokeLinecap="round" strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke" />
                    ))}
                </svg>

                {/* playhead — own layer, moved imperatively */}
                <div ref={headRef} style={{
                    position: 'absolute', left: 0, top: 0, width: 1, height: '100%',
                    background: F1.red, opacity: 0, willChange: 'transform',
                    pointerEvents: 'none',
                }} />
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

                {/* baseline */}
                <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: 0, height: 1,
                    background: F1.line, pointerEvents: 'none',
                }} />
            </div>

            {/* ---- pedals: throttle up, brake down, mirrored ---------------- */}
            {pedal && (
                <>
                    <div style={{
                        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                        marginTop: 7, marginBottom: 4,
                    }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.3, color: F1.dim }}>
                            PEDALS
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 12, height: 2, background: F1.drs }} />
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: F1.dim }}>
                                    THROTTLE
                                </span>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 12, height: 2, background: F1.red }} />
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: F1.dim }}>
                                    BRAKE · PEAK {pedal.peakG.toFixed(1)}G
                                </span>
                            </span>
                        </div>
                    </div>

                    <div style={{ position: 'relative', width: '100%', height: pedalHeight }}>
                        <svg
                            width="100%" height={pedalHeight}
                            viewBox={`0 0 ${pedal.W} ${pedal.H}`} preserveAspectRatio="none"
                            style={{
                                position: 'absolute', inset: 0, display: 'block',
                                willChange: 'transform', transform: 'translateZ(0)',
                            }}
                        >
                            {/* sector divisions, carried down so the two charts read as one */}
                            {pedal.sectorX.map((sx, i) => (
                                <line key={i} x1={sx} y1={0} x2={sx} y2={pedal.H}
                                    stroke={i === 0 ? F1.s1 : F1.s2} strokeOpacity="0.5"
                                    strokeWidth={1} vectorEffect="non-scaling-stroke" />
                            ))}

                            {/* Braking — filled, because it's zero for most of a lap,
                                so the fill reads as peaks rather than mass. The
                                spike-then-bleed shape inside each zone is the real
                                trail-braking profile, not a 100% block. */}
                            {pedal.brakeShapes.map((b, i) => (
                                <g key={i}>
                                    <path d={b.area} fill={F1.red} fillOpacity="0.30" />
                                    <path d={b.line} fill="none" stroke={F1.red}
                                        strokeWidth={1.75} strokeLinejoin="round"
                                        vectorEffect="non-scaling-stroke" />
                                </g>
                            ))}

                            {/* Throttle — line only, no fill. The trace sits at 100%
                                for ~70% of a qualifying lap, so ANY fill under it
                                covers most of a 60px band and reads as a slab. */}
                            <path d={pedal.throttleLine} fill="none" stroke={F1.drs}
                                strokeWidth={2} strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke" />
                        </svg>

                        {/* floor, matching the speed chart's baseline */}
                        <div style={{
                            position: 'absolute', left: 0, right: 0, bottom: 0, height: 1,
                            background: F1.line, pointerEvents: 'none',
                        }} />

                        <div ref={pedalHeadRef} style={{
                            position: 'absolute', left: 0, top: 0, width: 1, height: '100%',
                            background: F1.red, opacity: 0, willChange: 'transform',
                            pointerEvents: 'none',
                        }} />
                    </div>
                </>
            )}

            {/* sector labels under the axis */}
            {!narrow && sectorX.length === 2 && (
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
            )}
        </div>
    );
});

SpeedTrace.displayName = 'SpeedTrace';
export default React.memo(SpeedTrace);
