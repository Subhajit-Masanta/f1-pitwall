/**
 * 📄 Landing.jsx — mode picker.
 *
 * Two ways into the data: one lap in detail, or a whole race. Kept to the same
 * minimal language as the replay stage — hairlines, mono numerals, one accent.
 */
import React from 'react';
import { ArrowRight } from 'lucide-react';
import { F1, MONO } from '../theme';

const MODES = [
    {
        id: 'quali',
        n: '01',
        title: 'Fastest Qualifying Lap',
        blurb: 'The quickest lap of the session, replayed from real telemetry — sector splits, DRS zones, corner-by-corner speed, gear and pedal traces.',
        state: 'available',
    },
    {
        id: 'race',
        n: '02',
        title: 'Full Race',
        blurb: 'Final classification, grid positions and points for any Grand Prix. The all-cars-on-track replay is the next thing being built.',
        state: 'partial',
    },
];

const Card = ({ mode, onPick }) => {
    const live = mode.state === 'available';
    return (
        <button
            onClick={() => onPick(mode.id)}
            style={{
                flex: '1 1 320px', minWidth: 300, textAlign: 'left', cursor: 'pointer',
                background: 'transparent', color: 'inherit',
                border: `1px solid ${F1.line}`, padding: '22px 24px 20px',
                display: 'flex', flexDirection: 'column', gap: 14,
                transition: 'border-color .15s, background .15s',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = F1.red;
                e.currentTarget.style.background = 'rgba(225,6,0,0.04)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = F1.line;
                e.currentTarget.style.background = 'transparent';
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 3, height: 13, background: F1.red }} />
                <span style={{ fontFamily: MONO, fontSize: 11, color: F1.dim, letterSpacing: 1 }}>
                    {mode.n}
                </span>
            </div>

            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                {mode.title}
            </div>

            <div style={{ fontSize: 12, lineHeight: 1.7, color: F1.dim, maxWidth: 380 }}>
                {mode.blurb}
            </div>

            <div style={{
                marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${F1.hair}`,
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 9, fontWeight: 700, letterSpacing: 2,
                color: live ? F1.drs : F1.dim,
            }}>
                <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: live ? F1.drs : F1.faint,
                }} />
                {live ? 'AVAILABLE' : 'RESULTS ONLY · REPLAY IN DEVELOPMENT'}
                <ArrowRight size={13} style={{ marginLeft: 'auto', color: F1.dim }} />
            </div>
        </button>
    );
};

const Landing = ({ onPick }) => (
    <div>
        <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 2.5, color: F1.dim,
            paddingBottom: 12, borderBottom: `1px solid ${F1.line}`, marginBottom: 20,
        }}>
            SELECT MODE
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {MODES.map((m) => <Card key={m.id} mode={m} onPick={onPick} />)}
        </div>

        <div style={{
            marginTop: 26, paddingTop: 14, borderTop: `1px solid ${F1.hair}`,
            fontSize: 11, color: F1.dim, letterSpacing: 0.5, lineHeight: 1.8,
        }}>
            Data from FastF1 · seasons <span style={{ fontFamily: MONO, color: F1.text }}>2018–2026</span>.
            {' '}Telemetry replay needs car position data, which is published from 2018 onward.
        </div>
    </div>
);

export default Landing;
