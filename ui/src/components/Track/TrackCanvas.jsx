/**
 * 📄 TrackCanvas.jsx
 *
 * Two layers that never interfere:
 *  1. A STATIC <svg> — neutral track line, DRS zones, sector ticks, corner
 *     numbers. Memoised; never repaints while the car moves.
 *  2. An HTML car marker moved with `transform: translate3d(...)` in screen
 *     pixels — its own GPU layer, so it costs no layout and no track repaint.
 *
 * The parent drives the car through the imperative `moveCar(x, y)` handle
 * (x, y in track/viewBox units; projected to pixels here).
 */
import React, {
    memo, forwardRef, useRef, useEffect, useCallback, useImperativeHandle,
} from 'react';
import { F1, MONO } from '../../theme';

const TrackCanvas = memo(forwardRef(({ mapLayout }, ref) => {
    const wrapRef = useRef(null);
    const carRef = useRef(null);
    const proj = useRef({ scale: 1, offX: 0, offY: 0 });

    const recompute = useCallback(() => {
        const el = wrapRef.current;
        if (!el || !mapLayout) return;
        const [mx, my, vw, vh] = mapLayout.viewBox.split(' ').map(Number);
        const scale = Math.min(el.clientWidth / vw, el.clientHeight / vh);
        proj.current = {
            scale,
            offX: (el.clientWidth - vw * scale) / 2 - mx * scale,
            offY: (el.clientHeight - vh * scale) / 2 - my * scale,
        };
    }, [mapLayout]);

    useEffect(() => {
        recompute();
        const ro = new ResizeObserver(recompute);
        if (wrapRef.current) ro.observe(wrapRef.current);
        return () => ro.disconnect();
    }, [recompute]);

    const placeCar = useCallback((x, y) => {
        const { scale, offX, offY } = proj.current;
        const car = carRef.current;
        if (!car || !Number.isFinite(x) || !Number.isFinite(y)) return;
        // NOTE: do NOT round here. A whole lap is squeezed into a few hundred
        // screen pixels, so at 1x the car advances ~0.06px per frame — rounding
        // to 0.1px quantises that into visible steps. Sub-pixel transforms are
        // interpolated by the compositor, which is exactly what we want.
        car.style.transform =
            `translate3d(${(x * scale + offX).toFixed(3)}px, ${(y * scale + offY).toFixed(3)}px, 0)`;
        car.style.opacity = '1';
    }, []);

    useImperativeHandle(ref, () => ({ moveCar: placeCar }), [placeCar]);

    // Park the car on the start/finish line until the lap begins.
    useEffect(() => {
        const t = mapLayout?.ticks?.start;
        if (t) {
            recompute();
            placeCar((t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2);
        }
    }, [mapLayout, recompute, placeCar]);

    if (!mapLayout) return null;

    const { viewBox, d, mapSize, ticks, drsPaths, corners } = mapLayout;
    const lw = mapSize * 0.0055;          // track line: thin
    const label = mapSize * 0.017;

    const Tick = ({ t, color, text }) => !t ? null : (
        <g>
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                stroke={color} strokeWidth={lw * 1.5} strokeLinecap="round" />
            {text && (
                <text x={t.lx} y={t.ly} fill={color} fontSize={label * 0.9}
                    fontFamily={MONO} fontWeight="700" letterSpacing={label * 0.05}
                    textAnchor="middle" dominantBaseline="central">{text}</text>
            )}
        </g>
    );

    return (
        <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
            <svg
                width="100%" height="100%" viewBox={viewBox}
                preserveAspectRatio="xMidYMid meet"
                style={{ position: 'absolute', inset: 0, display: 'block' }}
            >
                {/* corner numbers, sitting behind everything */}
                {corners.map((c) => (
                    <text key={c.n} x={c.lx} y={c.ly}
                        fill={F1.faint} fontSize={label * 0.85} fontFamily={MONO}
                        textAnchor="middle" dominantBaseline="central">
                        {c.n}{c.letter}
                    </text>
                ))}

                {/* the track */}
                <path d={d} fill="none" stroke={F1.track}
                    strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" />

                {/* DRS zones — the only colour on the map */}
                {drsPaths.map((z, i) => (
                    <g key={i}>
                        <path d={z.d} fill="none" stroke={F1.drs} strokeOpacity="0.16"
                            strokeWidth={lw * 3.2} strokeLinecap="round" />
                        <path d={z.d} fill="none" stroke={F1.drs}
                            strokeWidth={lw * 1.3} strokeLinecap="round" />
                    </g>
                ))}

                {/* sector + start-finish ticks */}
                <Tick t={ticks.s1} color={F1.s1} text="S1" />
                <Tick t={ticks.s2} color={F1.s2} text="S2" />
                <Tick t={ticks.start} color="#FFFFFF" />
            </svg>

            {/* moving car — own GPU layer */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
                <div ref={carRef} style={{
                    position: 'absolute', top: 0, left: 0, width: 0, height: 0,
                    willChange: 'transform', opacity: 0,
                }}>
                    <div style={{
                        position: 'absolute', left: 0, top: 0, transform: 'translate(-50%,-50%)',
                        width: 26, height: 26, borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(225,6,0,0.45) 0%, rgba(225,6,0,0) 70%)',
                    }} />
                    <div style={{
                        position: 'absolute', left: 0, top: 0, transform: 'translate(-50%,-50%)',
                        width: 11, height: 11, borderRadius: '50%',
                        background: F1.red, border: '1.5px solid #fff',
                    }} />
                </div>
            </div>
        </div>
    );
}));

TrackCanvas.displayName = 'TrackCanvas';
export default TrackCanvas;
