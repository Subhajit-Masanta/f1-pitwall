/**
 * 📄 Transport.jsx — play / pause / restart.
 *
 * Sits in the band RESERVED for it above the chart stack. It used to float over
 * the map, which put it on top of the speed chart once the pedal band grew, and
 * then on Monza's main straight — hence the reservation.
 *
 * `state` is computed by the caller because what counts as "ready" differs per
 * mode: a head-to-head cannot start until BOTH laps are loaded.
 */
import { RotateCcw } from 'lucide-react';
import { F1 } from '../../theme';

const btn = {
    display: 'flex', alignItems: 'center', gap: 8,
    background: F1.red, color: '#fff', border: 'none',
    padding: '11px 24px', cursor: 'pointer',
    fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
};

// NOTE: not `ghost` — that name is taken by the compared driver wherever this
// is used, and it once shadowed this style and was handed to the button as CSS.
const iconBtn = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 34, height: 34,
    background: 'transparent', color: F1.dim,
    border: `1px solid ${F1.line}`, cursor: 'pointer',
};

const Transport = ({ state, bottom, error, isPlaying, onToggle, onRestart, canRestart }) => (
    <div style={{
        position: 'absolute', bottom, left: '50%',
        transform: 'translateX(-50%)', zIndex: 16,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    }}>
        {error && (
            <div style={{
                fontSize: 12, color: F1.red, letterSpacing: 0.3,
                maxWidth: 300, textAlign: 'center', lineHeight: 1.5,
            }}>
                {error}
            </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
                onClick={onToggle}
                disabled={state.disabled}
                style={{
                    ...btn,
                    opacity: state.disabled ? 0.55 : 1,
                    cursor: state.busy ? 'wait' : state.disabled ? 'not-allowed' : 'pointer',
                }}
            >
                {state.icon}{state.label}
            </button>
            {canRestart && !isPlaying && (
                <button onClick={onRestart} style={iconBtn} title="Restart lap">
                    <RotateCcw size={14} />
                </button>
            )}
        </div>
    </div>
);

export default Transport;
