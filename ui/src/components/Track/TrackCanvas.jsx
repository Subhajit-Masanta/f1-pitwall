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
import { camProjection } from '../../lib/camera';
import CarLayer from './CarLayer';

/**
 * Tick thickness, in SCREEN pixels rather than track units.
 *
 * The road is meant to get thicker as the camera zooms in — that is what
 * being closer to it looks like. A sector tick is not road: it is a marker
 * drawn across one, and at 3.2x the start/finish line grew from a 13px line
 * into a 41px white block sitting on the circuit. `non-scaling-stroke` keeps
 * the thickness fixed while the LENGTH still scales, so the line goes on
 * spanning the road and stops turning into a slab.
 *
 * The values are what the old track-unit widths already rendered at on a
 * typical stage (measured: 12.9px and 8.0px at Melbourne), so the wide shot —
 * and every circuit in lap and compare mode, which have no camera at all —
 * looks as it did.
 */
const START_TICK_PX = 12;
const SECTOR_TICK_PX = 7;

const TrackCanvas = memo(forwardRef(({
    mapLayout, view = 'map', cars = [], pitBox = null, parkAtStart = true,
    dominance = null,
}, ref) => {
    const wrapRef = useRef(null);
    const layerRef = useRef(null);
    const svgRef = useRef(null);
    // The projection that fits the whole circuit in the box. Never changes
    // except on a resize.
    const base = useRef({ scale: 1, offX: 0, offY: 0 });
    // The projection actually in use: `base`, or `base` seen through a camera.
    const proj = useRef(base.current);
    // { cx, cy, k } in track units, or null for the whole circuit.
    const cam = useRef(null);
    // The viewBox last written, so an unchanged one is not written again.
    const lastVB = useRef(null);
    // Last position per car in TRACK units, so a resize can re-project them.
    // Without this a parked car keeps the pixel position from the old
    // projection and visibly drifts off the start/finish line whenever the
    // stage resizes (opening the trace, rotating a phone, any window change).
    const lastPos = useRef({});

    /**
     * Point the map at the camera.
     *
     * The projection and the matching viewBox both come from `camProjection`,
     * which is where the derivation and its test live — the cars are placed
     * through the projection and the track is framed by the viewBox, and
     * those two agreeing is the whole of "the field is on the circuit rather
     * than beside it".
     *
     * A viewBox rather than a CSS transform because a transform scales the
     * layer's BITMAP: the circuit came out soft at 3.2x next to the timing
     * tower's text. This redraws it as vectors, so it is sharp at any zoom.
     */
    const applyCam = useCallback(() => {
        const el = wrapRef.current;
        const svg = svgRef.current;
        if (!el) return;
        const p = camProjection(
            base.current, cam.current, el.clientWidth, el.clientHeight,
        );
        proj.current = { scale: p.scale, offX: p.offX, offY: p.offY };
        if (!svg) return;
        const next = p.vb
            ? p.vb.map((v) => v.toFixed(2)).join(' ')
            : mapLayout?.viewBox;
        // Writing an identical attribute still invalidates paint in some
        // engines, and at the wide shot this runs every frame for nothing.
        if (next && next !== lastVB.current) {
            svg.setAttribute('viewBox', next);
            lastVB.current = next;
        }
    }, [mapLayout]);

    const recompute = useCallback(() => {
        const el = wrapRef.current;
        if (!el || !mapLayout) return;
        const [mx, my, vw, vh] = mapLayout.viewBox.split(' ').map(Number);
        const scale = Math.min(el.clientWidth / vw, el.clientHeight / vh);
        base.current = {
            scale,
            offX: (el.clientWidth - vw * scale) / 2 - mx * scale,
            offY: (el.clientHeight - vh * scale) / 2 - my * scale,
        };
        applyCam();
    }, [mapLayout, applyCam]);

    /** Move a car, in TRACK units. The projection to pixels happens here. */
    const move = useCallback((id, x, y, inPit = false) => {
        if (x == null || !Number.isFinite(x) || !Number.isFinite(y)) {
            layerRef.current?.hide(id);
            return;
        }
        const { scale, offX, offY } = proj.current;
        lastPos.current[id] = { x, y };
        layerRef.current?.place(id, x * scale + offX, y * scale + offY, inPit);
    }, []);

    /**
     * Point the camera at a place on the circuit, or pass null to show all of
     * it. Track units, and `k` is the zoom factor.
     *
     * Call it BEFORE the cars are moved on a given frame: `move` reads the
     * projection this sets, so doing it the other way round places the field
     * with one frame's stale camera.
     */
    const look = useCallback((cx, cy, k = 1) => {
        cam.current = (cx == null || !Number.isFinite(cx) || !Number.isFinite(cy))
            ? null
            : { cx, cy, k };
        applyCam();
    }, [applyCam]);

    useImperativeHandle(ref, () => ({ move, look }), [move, look]);

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
    //
    // `parkAtStart` exists because this puts EVERY car on one coordinate — the
    // midpoint of the start line — which is right for a lap or a head-to-head
    // and wrong for a race. With twenty cars it stacked the whole field on a
    // single dot, and because this effect runs on [mapLayout, cars] it did so
    // AFTER the caller had placed them, silently overwriting a starting grid.
    // Race mode parks its own cars and opts out.
    useEffect(() => {
        if (!parkAtStart) return;
        const t = mapLayout?.ticks?.start;
        if (t) {
            recompute();
            cars.forEach((c) => move(c.id, (t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2));
        }
    }, [mapLayout, recompute, move, cars, parkAtStart]);

    if (!mapLayout) return null;

    const { viewBox, d, pitPath, mapSize, ticks, drsPaths, corners, speedSegments } = mapLayout;
    const lw = mapSize * 0.0055;          // track line: thin
    const label = mapSize * 0.017;
    const speedView = view === 'speed' && speedSegments?.length > 0;
    // Who was faster where. Drawn as the road itself rather than as a line on
    // top of it: the point is to read the circuit, not an annotation of it.
    const domView = view === 'dominance' && dominance?.length > 0;

    const Tick = ({ t, color, text, wide = false }) => !t ? null : (
        <g>
            <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
                stroke={color} strokeWidth={wide ? START_TICK_PX : SECTOR_TICK_PX}
                vectorEffect="non-scaling-stroke" strokeLinecap="round" />
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
                ref={svgRef}
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
                        {!domView && drsPaths.map((z, i) => (
                            <g key={i}>
                                <path d={z.d} fill="none" stroke={F1.drs} strokeOpacity="0.10"
                                    strokeWidth={lw * 2.2} strokeLinecap="round" />
                                <path d={z.d} fill="none" stroke={F1.drs} strokeOpacity="0.9"
                                    strokeWidth={lw} strokeLinecap="round" />
                            </g>
                        ))}
                    </>
                )}

                {/* THE PIT LANE, drawn at an exaggerated offset — see
                    pit_geometry.py for why an accurate one is invisible. Dashed
                    and dimmer than the track so it reads as a service road
                    rather than a second racing line. */}
                {domView && (
                    <g>
                        {dominance.map((seg, i) => (
                            <path key={i} d={seg.d} fill="none"
                                stroke={seg.color} strokeOpacity={seg.winner ? 0.95 : 0.35}
                                strokeWidth={lw * 1.9}
                                strokeLinecap="butt" strokeLinejoin="round" />
                        ))}
                    </g>
                )}

                {pitPath && (
                    <g>
                        <path d={pitPath} fill="none" stroke={F1.bg}
                            strokeWidth={lw * 2.4} strokeLinecap="round" />
                        <path d={pitPath} fill="none" stroke={F1.faint}
                            strokeWidth={lw * 0.85} strokeLinecap="round"
                            strokeDasharray={`${lw * 3} ${lw * 2}`} />
                        {pitBox && (
                            <circle cx={pitBox.X} cy={-pitBox.Y} r={mapSize * 0.006}
                                fill="none" stroke={F1.dim} strokeWidth={lw * 0.7} />
                        )}
                    </g>
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
