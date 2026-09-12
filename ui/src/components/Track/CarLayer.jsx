/**
 * 📄 CarLayer.jsx — the moving markers and their driver tags.
 *
 * Takes a LIST of cars rather than a fixed pair, so the same component serves
 * one car on /lap, two on /compare, and a full grid on a race replay without
 * changing. Each marker lives on its own GPU layer and is moved by writing a
 * transform straight to the DOM — the layer never re-renders during playback.
 *
 * Cars are drawn in array order, so the last one sits on top; put the car you
 * are following last.
 *
 * Two shapes, because colour alone is not enough: team-mates share a team
 * colour, and a team colour can land on the same red as the reference car
 * (Ferrari is #F91536). A solid disc versus a hollow ring survives any pairing.
 *
 * THE TAG. Each car carries a small broadcast-style name tag. It is a CHILD of
 * the marker, so the one transform that moves the car moves the tag with it for
 * free — no second animation, and the name can never drift off its dot. The
 * tag's own transform carries only its offset from the dot, recomputed by
 * `relayout()` whenever a car moves, for two reasons a fixed offset cannot
 * handle:
 *
 *   · near the right-hand edge the tag would hang off the stage, so it flips
 *     to the other side of the dot;
 *   · two tags would sit on top of each other when the cars are close, which
 *     in a head-to-head is exactly the moment you need to read them, so they
 *     are pushed apart vertically.
 *
 * Track coordinates are rotated upstream, so the stage is never CSS-rotated
 * and the tags come out upright on every circuit for free.
 */
import React, {
    forwardRef, useImperativeHandle, useRef, useCallback, useEffect, useLayoutEffect,
} from 'react';
import { F1, MONO } from '../../theme';
import { layoutTags, TAG_H } from '../../lib/geometry/tags';

const Marker = ({ car, elRef, tagRef }) => {
    const color = car.color || F1.red;
    const ring = car.shape === 'ring';
    return (
        <div ref={elRef} style={{
            position: 'absolute', top: 0, left: 0, width: 0, height: 0,
            willChange: 'transform', opacity: 0,
        }}>
            {/* glow */}
            <div style={{
                position: 'absolute', left: 0, top: 0, transform: 'translate(-50%,-50%)',
                width: ring ? 22 : 26, height: ring ? 22 : 26, borderRadius: '50%',
                background: `radial-gradient(circle, ${color}55 0%, ${color}00 70%)`,
            }} />
            {ring ? (
                <div style={{
                    position: 'absolute', left: 0, top: 0, transform: 'translate(-50%,-50%)',
                    width: 13, height: 13, borderRadius: '50%',
                    background: 'rgba(11,11,15,0.55)',
                    border: `2.5px solid ${color}`,
                    boxShadow: '0 0 0 1px rgba(255,255,255,0.35)',
                }} />
            ) : (
                <div style={{
                    position: 'absolute', left: 0, top: 0, transform: 'translate(-50%,-50%)',
                    width: 11, height: 11, borderRadius: '50%',
                    background: color, border: '1.5px solid #fff',
                }} />
            )}

            {/* Name tag: dark plate, team-coloured flash and code.
                Colour on a near-black plate rather than a team-coloured fill —
                the grid runs from Ferrari red to Mercedes cyan and no single
                text colour stays readable across that range. Every real team
                colour clears 4:1 against this plate. */}
            {car.label && (
                <div ref={tagRef} style={{
                    position: 'absolute', left: 0, top: 0,
                    boxSizing: 'border-box', height: TAG_H,
                    display: 'flex', alignItems: 'stretch',
                    background: 'rgba(11,11,15,0.82)',
                    border: `1px solid ${color}66`,
                    borderRadius: 3, overflow: 'hidden',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.65)',
                    willChange: 'transform', whiteSpace: 'nowrap',
                }}>
                    <div style={{ width: 3, background: color, flex: '0 0 auto' }} />
                    <span style={{
                        padding: '0 5px', color,
                        fontFamily: MONO, fontSize: 9.5, fontWeight: 700,
                        letterSpacing: 0.8, lineHeight: `${TAG_H - 2}px`,
                    }}>{car.label}</span>
                </div>
            )}
        </div>
    );
};

/**
 * @param cars  [{ id, color, shape: 'disc' | 'ring', label?: 'VER' }]
 *
 * Imperative handle:
 *   place(id, px, py)  move a car to a position in SCREEN pixels
 *   hide(id)           take a car off the track (retired, or not loaded yet)
 */
const CarLayer = forwardRef(({ cars = [] }, ref) => {
    const rootRef = useRef(null);
    const els = useRef({});
    const tags = useRef({});
    const pos = useRef({});          // id -> { px, py, shown }
    const tagW = useRef({});         // id -> measured width, cached
    const lastTag = useRef({});      // id -> last transform written
    const size = useRef({ w: 0, h: 0 });

    const carsRef = useRef(cars);
    carsRef.current = cars;

    /**
     * Decide where each tag sits relative to its dot: which side, and how far
     * up or down once overlapping tags have been pushed apart.
     */
    const relayout = useCallback(() => {
        const { w: W, h: H } = size.current;
        if (!W || !H) return;

        const items = [];
        for (const car of carsRef.current) {
            const tag = tags.current[car.id];
            const p = pos.current[car.id];
            if (!tag || !car.label || !p || !p.shown) continue;

            // Measured once per label. offsetWidth forces a layout, so it is
            // never read again on the hot path after the first good read.
            let w = tagW.current[car.id];
            if (!w) {
                w = tag.offsetWidth;
                if (!w) continue;                 // not laid out yet; next frame
                tagW.current[car.id] = w;
            }
            items.push({ id: car.id, px: p.px, py: p.py, w });
        }

        for (const r of layoutTags(items, W, H)) {
            const t = `translate(${r.dx.toFixed(1)}px, ${r.dy.toFixed(1)}px)`;
            if (lastTag.current[r.id] !== t) {
                tags.current[r.id].style.transform = t;
                lastTag.current[r.id] = t;
            }
        }
    }, []);

    const place = useCallback((id, px, py) => {
        const el = els.current[id];
        if (!el) return;
        if (px == null || !Number.isFinite(px) || !Number.isFinite(py)) {
            el.style.opacity = '0';
            if (pos.current[id]) pos.current[id].shown = false;
            return;
        }
        // NOTE: do NOT round beyond 3dp. A whole lap is squeezed into a few
        // hundred screen pixels, so at 1x a car advances ~0.06px per frame;
        // rounding to 0.1px turns that into visible steps. Sub-pixel transforms
        // are interpolated by the compositor, which is what we want.
        el.style.transform = `translate3d(${px.toFixed(3)}px, ${py.toFixed(3)}px, 0)`;
        el.style.opacity = '1';
        pos.current[id] = { px, py, shown: true };
        relayout();
    }, [relayout]);

    const hide = useCallback((id) => {
        const el = els.current[id];
        if (el) el.style.opacity = '0';
        if (pos.current[id]) pos.current[id].shown = false;
        relayout();
    }, [relayout]);

    useImperativeHandle(ref, () => ({ place, hide }), [place, hide]);

    // Stage size drives both the edge flip and the vertical clamp.
    useLayoutEffect(() => {
        const el = rootRef.current;
        if (!el) return;
        const read = () => {
            size.current = { w: el.clientWidth, h: el.clientHeight };
            relayout();
        };
        read();
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, [relayout]);

    // A changed label is a different width, so the cache has to go with it.
    useEffect(() => {
        tagW.current = {};
        lastTag.current = {};
        relayout();
    }, [cars, relayout]);

    return (
        <div ref={rootRef} style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
        }}>
            {cars.map((car) => (
                <Marker
                    key={car.id}
                    car={car}
                    elRef={(el) => { els.current[car.id] = el; }}
                    tagRef={(el) => { tags.current[car.id] = el; }}
                />
            ))}
        </div>
    );
});

CarLayer.displayName = 'CarLayer';
export default React.memo(CarLayer);
