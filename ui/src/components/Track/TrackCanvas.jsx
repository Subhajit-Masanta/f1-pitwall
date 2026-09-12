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
import {
    memo, forwardRef, useRef, useEffect, useCallback, useImperativeHandle,
} from 'react';
import { F1, MONO, speedColor } from '../../theme';
import CarLayer from './CarLayer';

const TrackCanvas = memo(forwardRef(({ mapLayout, view = 'map', cars = [] }, ref) => {
    const wrapRef = useRef(null);
    const layerRef = useRef(null);
    const proj = useRef({ scale: 1, offX: 0, offY: 0 });
    // Last position per car in TRACK units, so a resize can re-project them.
    // Without this a parked car keeps the pixel position from the old
    // projection and visibly drifts off the start/finish line whenever the
    // stage resizes (opening the trace, rotating a phone, any window change).
    const lastPos = useRef({});

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

    /** Move a car, in TRACK units. The projection to pixels happens here. */
    const move = useCallback((id, x, y) => {
        if (x == null || !Number.isFinite(x) || !Number.isFinite(y)) {
            layerRef.current?.hide(id);
            return;
        }
        const { scale, offX, offY } = proj.current;
        lastPos.current[id] = { x, y };
        layerRef.current?.place(id, x * scale + offX, y * scale + offY);
    }, []);

    useImperativeHandle(ref, () => ({ move }), [move]);

    useEffect(() => {
        const apply = () => {
            recompute();
            // Re-project every car where it already is. During playback the next
            // frame would fix it anyway, but while parked or paused nothing
            // else redraws them.
            for (const [id, p] of Object.entries(lastPos.current)) move(id, p.x, p.y);
        };
        apply();
        const ro = new ResizeObserver(apply);
        if (wrapRef.current) ro.observe(wrapRef.current);
        return () => ro.disconnect();
    }, [recompute, move]);

    // Park the car on the start/finish line until the lap begins.
    useEffect(() => {
        const t = mapLayout?.ticks?.start;
        if (t) {
            recompute();
            cars.forEach((c) => move(c.id, (t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2));
        }
    }, [mapLayout, recompute, move, cars]);

    if (!mapLayout) return null;

    const { viewBox, d, mapSize, ticks, drsPaths, corners, speedSegments } = mapLayout;
    const lw = mapSize * 0.0055;          // track line: thin
    const label = mapSize * 0.017;
    const speedView = view === 'speed' && speedSegments?.length > 0;

    const Tick = ({ t, color, text, wide = false }) => !t ? null : (
        <g>
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                stroke={color} strokeWidth={lw * (wide ? 2.4 : 1.5)} strokeLinecap="round" />
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
                style={{
                    position: 'absolute', inset: 0, display: 'block',
                    // Promote the static track to its own compositor layer. The
                    // speed view draws ~170 stroked paths; without this the
                    // browser re-rasterises all of them every time the car moves
                    // over them (measured: p99 frame 7.3ms -> 20.9ms).
                    willChange: 'transform',
                    transform: 'translateZ(0)',
                }}
            >
                {/* corner numbers, sitting behind everything */}
                {corners.map((c) => (
                    <text key={`${c.n}${c.letter}`} x={c.lx} y={c.ly}
                        // F1.faint is the same value as the track line, so the
                        // numbers used to disappear into it wherever they sat
                        // near the tarmac. Dim reads clearly without competing.
                        fill={F1.dim} fillOpacity="0.85"
                        fontSize={label * 0.82} fontFamily={MONO} fontWeight="600"
                        textAnchor="middle" dominantBaseline="central">
                        {c.n}{c.letter}
                    </text>
                ))}

                {speedView ? (
                    /* SPEED VIEW — the line itself carries the data.
                       Each short run is tinted by its mean speed. A dark casing
                       underneath keeps the thin colours readable on black. */
                    <>
                        <path d={d} fill="none" stroke="#000" strokeOpacity="0.85"
                            strokeWidth={lw * 2.6} strokeLinecap="round" strokeLinejoin="round" />
                        {speedSegments.map((seg, i) => (
                            <path key={i} d={seg.d} fill="none" stroke={speedColor(seg.t)}
                                strokeWidth={lw * 1.7} strokeLinecap="round" strokeLinejoin="round" />
                        ))}
                    </>
                ) : (
                    /* MAP VIEW — neutral line, DRS zones are the only colour. */
                    <>
                        <path d={d} fill="none" stroke={F1.track}
                            strokeWidth={lw} strokeLinecap="round" strokeLinejoin="round" />
                        {/* DRS reads as a brighter stretch OF the track, not a
                            rope laid on top of it. The old version was a 3.2x
                            glow under a 1.3x bright green line, which made a
                            DRS zone the loudest thing on a head-to-head — ahead
                            of both cars. */}
                        {drsPaths.map((z, i) => (
                            <g key={i}>
                                <path d={z.d} fill="none" stroke={F1.drs} strokeOpacity="0.10"
                                    strokeWidth={lw * 2.2} strokeLinecap="round" />
                                <path d={z.d} fill="none" stroke={F1.drs} strokeOpacity="0.9"
                                    strokeWidth={lw} strokeLinecap="round" />
                            </g>
                        ))}
                    </>
                )}

                {/* sector + start-finish ticks */}
                <Tick t={ticks.s1} color={F1.s1} text="S1" />
                <Tick t={ticks.s2} color={F1.s2} text="S2" />
                {/* the lap boundary: the only pure white on the map, and heavier
                    than a sector tick so the two never read as the same thing */}
                <Tick t={ticks.start} color="#FFFFFF" wide />
            </svg>

            <CarLayer ref={layerRef} cars={cars} />
        </div>
    );
}));

TrackCanvas.displayName = 'TrackCanvas';
export default TrackCanvas;
