/**
 * 📄 TelemetryHUD.jsx — the onboard strip along the bottom.
 *
 * Renders its shell ONCE. Every value (speed, gear, throttle, brake, RPM, DRS)
 * is written straight to the DOM through the imperative `update()` handle, so a
 * lap at 60fps never triggers a React render here.
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { F1, MONO } from '../theme';

const RPM_SEGMENTS = 18;
const MAX_RPM = 12800;

const Label = ({ children }) => (
    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: F1.dim }}>
        {children}
    </div>
);

const Pedal = ({ label, color, barRef }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 26, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: F1.dim }}>
            {label}
        </span>
        <div style={{ position: 'relative', width: 176, height: 4, background: F1.line }}>
            <div ref={barRef} style={{
                position: 'absolute', inset: 0, width: '0%', background: color,
            }} />
        </div>
    </div>
);

const TelemetryHUD = forwardRef((_props, ref) => {
    const speedRef = useRef(null);
    const gearRef = useRef(null);
    const thrRef = useRef(null);
    const brkRef = useRef(null);
    const drsRef = useRef(null);
    const rpmRefs = useRef([]);

    useImperativeHandle(ref, () => ({
        update(fr) {
            if (speedRef.current) speedRef.current.textContent = Math.round(fr.speed);

            const g = fr.gear <= 0 ? 'N' : fr.gear;
            if (gearRef.current && gearRef.current.textContent !== String(g)) {
                gearRef.current.textContent = g;
            }

            const thr = Math.max(0, Math.min(100, fr.throttle <= 1 ? fr.throttle * 100 : fr.throttle));
            const brk = Math.max(0, Math.min(100, fr.brake <= 1 ? fr.brake * 100 : fr.brake));
            if (thrRef.current) thrRef.current.style.width = thr.toFixed(0) + '%';
            if (brkRef.current) brkRef.current.style.width = brk.toFixed(0) + '%';

            const lit = Math.round((Math.min(fr.rpm, MAX_RPM) / MAX_RPM) * RPM_SEGMENTS);
            for (let i = 0; i < RPM_SEGMENTS; i++) {
                const seg = rpmRefs.current[i];
                if (!seg) continue;
                seg.style.background = i < lit
                    ? (i < 11 ? F1.text : i < 15 ? F1.red : F1.purple)
                    : F1.line;
            }

            const on = fr.drs >= 10; // fastf1 DRS codes 10/12/14 = open
            if (drsRef.current) {
                drsRef.current.style.color = on ? '#04140B' : F1.dim;
                drsRef.current.style.background = on ? F1.drs : 'transparent';
                drsRef.current.style.borderColor = on ? F1.drs : F1.line;
            }
        },
    }), []);

    return (
        <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 12,
            display: 'flex', alignItems: 'center', gap: 40,
            padding: '16px 26px',
            borderTop: `1px solid ${F1.line}`,
            background: 'linear-gradient(180deg, rgba(11,11,15,0) 0%, rgba(11,11,15,0.96) 42%)',
        }}>
            {/* speed */}
            <div style={{ minWidth: 108 }}>
                <Label>SPEED</Label>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span ref={speedRef} style={{
                        fontFamily: MONO, fontSize: 40, fontWeight: 700, lineHeight: 1,
                        color: F1.text, fontVariantNumeric: 'tabular-nums',
                    }}>0</span>
                    <span style={{ fontSize: 10, color: F1.dim, letterSpacing: 1 }}>KM/H</span>
                </div>
            </div>

            {/* gear */}
            <div style={{ minWidth: 46 }}>
                <Label>GEAR</Label>
                <span ref={gearRef} style={{
                    fontFamily: MONO, fontSize: 40, fontWeight: 700, lineHeight: 1, color: F1.text,
                }}>N</span>
            </div>

            {/* pedals */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <Pedal label="THR" color={F1.green} barRef={thrRef} />
                <Pedal label="BRK" color={F1.red} barRef={brkRef} />
            </div>

            {/* rpm */}
            <div style={{ marginLeft: 'auto' }}>
                <Label>RPM</Label>
                <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
                    {Array.from({ length: RPM_SEGMENTS }).map((_, i) => (
                        <div key={i} ref={(el) => { rpmRefs.current[i] = el; }}
                            style={{ width: 7, height: 16, background: F1.line }} />
                    ))}
                </div>
            </div>

            {/* drs */}
            <div ref={drsRef} style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 700, letterSpacing: 2,
                border: `1px solid ${F1.line}`, color: F1.dim, background: 'transparent',
                transition: 'background .08s, color .08s',
            }}>
                DRS
            </div>
        </div>
    );
});

TelemetryHUD.displayName = 'TelemetryHUD';
export default React.memo(TelemetryHUD);
