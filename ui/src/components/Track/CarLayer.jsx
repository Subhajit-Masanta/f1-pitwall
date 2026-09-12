/**
 * 📄 CarLayer.jsx — the moving markers.
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
 */
import React, { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import { F1 } from '../../theme';

const Marker = ({ car, elRef }) => {
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
        </div>
    );
};

/**
 * @param cars  [{ id, color, shape: 'disc' | 'ring' }]
 *
 * Imperative handle:
 *   place(id, px, py)  move a car to a position in SCREEN pixels
 *   hide(id)           take a car off the track (retired, or not loaded yet)
 */
const CarLayer = forwardRef(({ cars = [] }, ref) => {
    const els = useRef({});

    const place = useCallback((id, px, py) => {
        const el = els.current[id];
        if (!el) return;
        if (px == null || !Number.isFinite(px) || !Number.isFinite(py)) {
            el.style.opacity = '0';
            return;
        }
        // NOTE: do NOT round beyond 3dp. A whole lap is squeezed into a few
        // hundred screen pixels, so at 1x a car advances ~0.06px per frame;
        // rounding to 0.1px turns that into visible steps. Sub-pixel transforms
        // are interpolated by the compositor, which is what we want.
        el.style.transform = `translate3d(${px.toFixed(3)}px, ${py.toFixed(3)}px, 0)`;
        el.style.opacity = '1';
    }, []);

    const hide = useCallback((id) => {
        const el = els.current[id];
        if (el) el.style.opacity = '0';
    }, []);

    useImperativeHandle(ref, () => ({ place, hide }), [place, hide]);

    return (
        <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
        }}>
            {cars.map((car) => (
                <Marker
                    key={car.id}
                    car={car}
                    elRef={(el) => { els.current[car.id] = el; }}
                />
            ))}
        </div>
    );
});

CarLayer.displayName = 'CarLayer';
export default React.memo(CarLayer);
