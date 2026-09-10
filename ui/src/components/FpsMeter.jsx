/**
 * 📄 FpsMeter.jsx
 *
 * 🩺 DEV-ONLY performance overlay.
 * Runs its own requestAnimationFrame loop and reports the real frame rate plus
 * how many frames in the last second were "slow" (took > 20ms ≈ below 50fps).
 * Only render this when import.meta.env.DEV is true.
 */
import { useEffect, useRef, useState } from 'react';

const FpsMeter = () => {
    const [fps, setFps] = useState(0);
    const [slow, setSlow] = useState(0);
    const frames = useRef(0);
    const slowFrames = useRef(0);
    const lastFrame = useRef(performance.now());
    const lastReport = useRef(performance.now());

    useEffect(() => {
        let raf;
        const tick = (now) => {
            const dt = now - lastFrame.current;
            lastFrame.current = now;

            frames.current += 1;
            if (dt > 20) slowFrames.current += 1; // slower than ~50fps

            if (now - lastReport.current >= 1000) {
                setFps(Math.round((frames.current * 1000) / (now - lastReport.current)));
                setSlow(slowFrames.current);
                frames.current = 0;
                slowFrames.current = 0;
                lastReport.current = now;
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    const color = fps >= 55 ? '#2ecc71' : fps >= 45 ? '#f1c40f' : '#e74c3c';

    return (
        <div style={{
            position: 'fixed',
            top: 8,
            right: 8,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.75)',
            color,
            font: '700 12px/1.3 monospace',
            padding: '6px 10px',
            borderRadius: 6,
            pointerEvents: 'none',
            whiteSpace: 'pre',
        }}>
            {`${fps} FPS\n${slow} slow/s`}
        </div>
    );
};

export default FpsMeter;
