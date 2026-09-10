/**
 * 📄 MapControls.jsx — playback-speed selector.
 */
import React from 'react';
import { F1 } from '../../theme';

const SPEEDS = [1, 2, 5, 10];

const MapControls = ({ playbackSpeed, setPlaybackSpeed }) => (
    <div style={{ display: 'flex', gap: 1, background: F1.line }}>
        {SPEEDS.map((v) => {
            const on = playbackSpeed === v;
            return (
                <button
                    key={v}
                    onClick={() => setPlaybackSpeed(v)}
                    style={{
                        minWidth: 32, padding: '5px 0', border: 'none', cursor: 'pointer',
                        fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                        background: on ? F1.red : F1.bg,
                        color: on ? '#fff' : F1.dim,
                    }}
                >
                    {v}×
                </button>
            );
        })}
    </div>
);

export default React.memo(MapControls);
