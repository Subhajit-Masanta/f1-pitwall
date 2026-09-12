/**
 * 📄 TelemetryHUD.jsx — the onboard strip along the bottom.
 *
 * Renders its shell ONCE. Every value (speed, gear, throttle, brake, RPM, DRS)
 * is written straight to the DOM through the imperative `update()` handle, so a
 * lap at 60fps never triggers a React render here.
 *
 * Writes are also diffed against the previous frame: a lap is ~2700 frames and
 * most of them don't change the gear, the lit segment count or the DRS state,
 * so skipping unchanged writes keeps the compositor idle.
 */
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { F1, MONO } from '../theme';

const RPM_SEGMENTS = 15;

// Real shift lights, in the order a steering wheel runs them: GREEN while there
// is still revs in hand, RED as the shift point approaches, VIOLET at the top —
// then the whole strip flashes violet when it is time to pull the paddle. These
// are fractions of the lap's used rev range (see rpmLoRef below for why that is
// not 0..max).
const RPM_GREEN_TO = 0.45;
const RPM_RED_TO = 0.78;
// Above this the strip flashes, the way a real wheel warns you to shift. 0.88
// fires on 13 separate bursts over a Bahrain pole lap — one per upshift near
// the ceiling — without sitting on permanently.
const RPM_FLASH_AT = 0.88;
// Flash period in MILLISECONDS, not frames: a frame-counted blink would run at
// 14Hz on a 144Hz screen and 6Hz on a 60Hz one. Real shift lights blink ~6Hz.
const FLASH_MS = 80;

const Label = ({ children }) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: F1.dim, marginBottom: 3 }}>
        {children}
    </div>
);

const Pedal = ({ label, color, barRef, valRef, w, initial }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 28, fontSize: 10, fontWeight: 700, letterSpacing: 1, color: F1.dim }}>
            {label}
        </span>
        <div style={{ position: 'relative', width: w, height: 7, background: F1.line }}>
            <div ref={barRef} style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: '0%',
                background: color, willChange: 'width',
            }} />
        </div>
        <span ref={valRef} style={{
            width: 46, textAlign: 'right', fontFamily: MONO, fontSize: 11,
            color: F1.dim, fontVariantNumeric: 'tabular-nums',
        }}>{initial}</span>
    </div>
);

const TelemetryHUD = forwardRef(({ narrow = false }, ref) => {
    const speedRef = useRef(null);
    const gearRef = useRef(null);
    const thrRef = useRef(null);
    const brkRef = useRef(null);
    const thrValRef = useRef(null);
    const brkValRef = useRef(null);
    const drsRef = useRef(null);
    const rpmRefs = useRef([]);
    const rpmValRef = useRef(null);
    const segCountRef = useRef(RPM_SEGMENTS);

    // Lap's peak deceleration — the 100% mark on the brake meter.
    const peakGRef = useRef(5);
    // RPM strip range. An F1 engine never drops near zero on a flying lap (this
    // Bahrain pole lap stays between 5693 and 12099, median 10945), so a strip
    // scaled from zero is permanently ~85% lit and barely moves. Both ends come
    // from the lap's own data instead.
    const rpmLoRef = useRef(9000);
    const rpmHiRef = useRef(12000);

    // Last values written, so the DOM is only touched on a real change.
    const prev = useRef({
        speed: -1, gear: '', thr: -1, brk: -1, g: -1, rpm: -1, lit: -1, flash: undefined, drs: null,
    });

    useImperativeHandle(ref, () => ({
        setPeakG(g) { if (Number.isFinite(g) && g > 0) peakGRef.current = g; },
        setRpmRange(lo, hi) {
            if (Number.isFinite(hi) && hi > 0) {
                rpmHiRef.current = hi;
                rpmLoRef.current = (Number.isFinite(lo) && lo < hi) ? lo : hi * 0.75;
            }
        },
        update(fr) {
            const p = prev.current;

            const sp = Math.round(fr.speed);
            if (sp !== p.speed && speedRef.current) {
                speedRef.current.textContent = sp;
                p.speed = sp;
            }

            const gear = fr.gear <= 0 ? 'N' : String(fr.gear);
            if (gear !== p.gear && gearRef.current) {
                gearRef.current.textContent = gear;
                p.gear = gear;
            }

            // --- pedals ---------------------------------------------------
            const thr = Math.max(0, Math.min(100, fr.throttle <= 1 ? fr.throttle * 100 : fr.throttle));

            // FastF1's Brake channel is boolean — it says only WHETHER the pedal
            // is down. The force is real though: deceleration, gated by that flag
            // so a lift-and-coast doesn't register as braking. No minimum width:
            // a light brush of the pedal should look like one.
            const pressed = (fr.brake <= 1 ? fr.brake * 100 : fr.brake) > 50;
            const decel = pressed ? Math.max(0, -(fr.g ?? 0)) : 0;
            const brk = Math.min(100, (decel / (peakGRef.current || 5)) * 100);

            const thrR = Math.round(thr);
            if (thrR !== p.thr) {
                if (thrRef.current) thrRef.current.style.width = thrR + '%';
                if (thrValRef.current) {
                    thrValRef.current.textContent = thrR + '%';
                    thrValRef.current.style.color = thrR > 0 ? F1.text : F1.dim;
                }
                p.thr = thrR;
            }

            const brkR = Math.round(brk);
            if (brkR !== p.brk && brkRef.current) {
                brkRef.current.style.width = brkR + '%';
                p.brk = brkR;
            }

            const gR = Math.round(decel * 10) / 10;
            if (gR !== p.g && brkValRef.current) {
                brkValRef.current.textContent = gR.toFixed(1) + ' G';
                brkValRef.current.style.color = gR > 0 ? F1.text : F1.dim;
                p.g = gR;
            }

            // --- RPM shift lights -----------------------------------------
            const n = segCountRef.current;
            const lo = rpmLoRef.current;
            const hi = rpmHiRef.current;
            const frac = Math.max(0, Math.min(1, (fr.rpm - lo) / ((hi - lo) || 1)));
            const lit = Math.round(frac * n);

            const inFlash = frac >= RPM_FLASH_AT;
            const flashOn = inFlash
                ? (Math.floor(performance.now() / FLASH_MS) % 2 === 0)
                : null;

            if (lit !== p.lit || flashOn !== p.flash) {
                for (let i = 0; i < n; i++) {
                    const seg = rpmRefs.current[i];
                    if (!seg) continue;
                    let bg;
                    if (inFlash) {
                        // At the shift point the whole strip blinks violet.
                        bg = flashOn ? F1.shift : F1.line;
                    } else if (i < lit) {
                        const f = i / n;
                        bg = f < RPM_GREEN_TO ? F1.thr
                            : f < RPM_RED_TO ? F1.brk
                                : F1.shift;
                    } else {
                        bg = F1.line;
                    }
                    if (seg.style.background !== bg) seg.style.background = bg;
                }
                p.lit = lit;
                p.flash = flashOn;
            }

            const rpmR = Math.round(fr.rpm / 10) * 10;
            if (rpmR !== p.rpm && rpmValRef.current) {
                rpmValRef.current.textContent = rpmR.toLocaleString('en-US');
                p.rpm = rpmR;
            }

            // --- DRS ------------------------------------------------------
            const on = fr.drs >= 10; // fastf1 DRS codes 10/12/14 = open
            if (on !== p.drs && drsRef.current) {
                drsRef.current.style.color = on ? '#04140B' : F1.dim;
                drsRef.current.style.background = on ? F1.drs : 'transparent';
                drsRef.current.style.borderColor = on ? F1.drs : F1.line;
                p.drs = on;
            }
        },
    }), []);

    const bigNum = narrow ? 32 : 44;
    const pedalW = narrow ? 84 : 154;
    const segCount = narrow ? 11 : RPM_SEGMENTS;
    segCountRef.current = segCount;

    return (
        <div style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 12,
            display: 'flex', alignItems: 'center',
            gap: narrow ? 16 : 34, flexWrap: narrow ? 'wrap' : 'nowrap',
            padding: narrow ? '12px 14px 16px' : '16px 26px',
            // No top border: the strip belongs to the stage rather than sitting
            // on it as a separate card. The gradient alone separates it, which
            // is one less line on a page that had a box around everything.
            background: 'linear-gradient(180deg, rgba(11,11,15,0) 0%, rgba(11,11,15,0.92) 38%, rgba(11,11,15,0.97) 100%)',
        }}>
            <div style={{ minWidth: narrow ? 88 : 108 }}>
                <Label>SPEED</Label>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span ref={speedRef} style={{
                        fontFamily: MONO, fontSize: bigNum, fontWeight: 700, lineHeight: 1,
                        color: F1.text, fontVariantNumeric: 'tabular-nums',
                    }}>0</span>
                    <span style={{ fontSize: 11, color: F1.dim, letterSpacing: 0.8 }}>KM/H</span>
                </div>
            </div>

            <div style={{ minWidth: 40 }}>
                <Label>GEAR</Label>
                <span ref={gearRef} style={{
                    fontFamily: MONO, fontSize: bigNum, fontWeight: 700, lineHeight: 1, color: F1.text,
                }}>N</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {/* Green throttle, red brake: the F1 convention, readable without
                    a legend. Identity is carried elsewhere — the car, its tag,
                    the pickers and the delta are all team-coloured. */}
                <Pedal label="THR" color={F1.thr} barRef={thrRef} valRef={thrValRef}
                    w={pedalW} initial="0%" />
                <Pedal label="BRK" color={F1.brk} barRef={brkRef} valRef={brkValRef}
                    w={pedalW} initial="0.0 G" />
            </div>

            <div style={{ marginLeft: narrow ? 0 : 'auto' }}>
                <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    gap: 16, marginBottom: 2,
                }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: F1.dim }}>
                        RPM
                    </span>
                    <span ref={rpmValRef} style={{
                        fontFamily: MONO, fontSize: 12, color: F1.text,
                        fontVariantNumeric: 'tabular-nums',
                    }}>0</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, marginTop: 5 }}>
                    {Array.from({ length: segCount }).map((_, i) => (
                        <div key={i} ref={(el) => { rpmRefs.current[i] = el; }}
                            style={{
                                width: narrow ? 6 : 8,
                                // stepped up toward the shift point, like a real wheel's strip
                                height: Math.round((narrow ? 11 : 12) + (i / segCount) * (narrow ? 6 : 9)),
                                background: F1.line,
                            }} />
                    ))}
                </div>
            </div>

            <div ref={drsRef} style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 700, letterSpacing: 1.8,
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
