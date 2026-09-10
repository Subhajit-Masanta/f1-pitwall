/**
 * 📄 StageMessage.jsx — what the replay stage shows while it has no map yet:
 * a staged loading readout, or an error with a retry.
 *
 * FastF1 gives us no real progress, so the loading steps are time-based — but
 * they're the actual phases, and the honest "this can take a minute" line at
 * the end stops people thinking it's broken. The bar creeps toward ~92% and
 * only completes when the data lands.
 */
import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { F1, MONO } from '../theme';

const STEPS = [
    [0, 'Contacting server'],
    [4, 'Loading session timing data'],
    [12, 'Processing 20 cars of telemetry'],
    [22, 'Building the racing line'],
    [38, 'Still working — a session’s first load can take up to a minute'],
];

const LoadingBody = ({ title }) => {
    const [elapsed, setElapsed] = useState(0);
    const t0 = useRef(Date.now());

    useEffect(() => {
        const id = setInterval(() => setElapsed((Date.now() - t0.current) / 1000), 250);
        return () => clearInterval(id);
    }, []);

    const step = STEPS.reduce((acc, [at, msg]) => (elapsed >= at ? msg : acc), STEPS[0][1]);
    const pct = Math.round((1 - Math.exp(-elapsed / 16)) * 92);

    return (
        <div style={{ margin: 'auto', width: 'min(360px, 78%)', textAlign: 'center' }}>
            {title && (
                <div style={{
                    fontSize: 12, fontWeight: 700, letterSpacing: 2.5,
                    textTransform: 'uppercase', marginBottom: 18,
                }}>
                    {title}
                </div>
            )}
            <div style={{ height: 2, background: F1.line, overflow: 'hidden' }}>
                <div style={{
                    height: '100%', width: `${pct}%`, background: F1.red,
                    transition: 'width .25s linear',
                }} />
            </div>
            <div style={{
                marginTop: 12, fontSize: 11, color: F1.dim, letterSpacing: 0.5,
                minHeight: 16,
            }}>
                {step}
            </div>
        </div>
    );
};

const ErrorBody = ({ title, message, onRetry }) => (
    <div style={{ margin: 'auto', width: 'min(380px, 82%)', textAlign: 'center' }}>
        {title && (
            <div style={{
                fontSize: 12, fontWeight: 700, letterSpacing: 2.5,
                textTransform: 'uppercase', marginBottom: 14,
            }}>
                {title}
            </div>
        )}
        <div style={{ fontSize: 12, lineHeight: 1.7, color: F1.dim, marginBottom: 18 }}>
            {message}
        </div>
        {onRetry && (
            <button
                onClick={onRetry}
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    background: 'transparent', color: F1.text,
                    border: `1px solid ${F1.line}`, padding: '10px 18px',
                    cursor: 'pointer', fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
                }}
            >
                <RotateCcw size={12} /> TRY AGAIN
            </button>
        )}
    </div>
);

const StageMessage = ({ variant, title, message, onRetry, style }) => (
    <div style={{
        position: 'relative', width: '100%', minHeight: 340,
        background: F1.bg, border: `1px solid ${F1.line}`,
        display: 'flex', padding: 20, fontFamily: MONO,
        ...style,
    }}>
        {variant === 'error'
            ? <ErrorBody title={title} message={message} onRetry={onRetry} />
            : <LoadingBody title={title} />}
    </div>
);

export default StageMessage;
