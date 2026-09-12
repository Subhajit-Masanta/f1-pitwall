/**
 * 📄 Landing.jsx — mode picker.
 *
 * Three ways into the data: one lap in detail, two laps against each other, or
 * a whole race. Each is its own route, so any of them can be linked to directly.
 * Kept to the same minimal language as the replay stage — hairlines, mono
 * numerals, one accent.
 */
import { ArrowRight } from 'lucide-react';
import { F1, MONO } from '../theme';

const MODES = [
    {
        id: 'lap',
        n: '01',
        title: 'Fastest Lap',
        blurb: 'The quickest lap of the session, replayed from real telemetry — sector splits, DRS zones, corner-by-corner speed, and the pedal and braking traces.',
        state: 'available',
    },
    {
        id: 'compare',
        n: '02',
        title: 'Head to Head',
        blurb: 'Two drivers on the same lap of track. A ghost car, both traces overlaid, and a live delta that lands exactly on the official gap at the flag.',
        state: 'available',
    },
    {
        id: 'race',
        n: '03',
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
                flex: '1 1 290px', minWidth: 268, textAlign: 'left', cursor: 'pointer',
                background: 'transparent', color: 'inherit',
                border: `1px solid ${F1.line}`, padding: '26px 28px 22px',
                display: 'flex', flexDirection: 'column', gap: 16,
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
                <span style={{ fontFamily: MONO, fontSize: 13, color: F1.dim, letterSpacing: 1 }}>
                    {mode.n}
                </span>
            </div>

            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                {mode.title}
            </div>

            <div style={{ fontSize: 14, lineHeight: 1.65, color: F1.dim, maxWidth: 440 }}>
                {mode.blurb}
            </div>

            <div style={{
                marginTop: 'auto', paddingTop: 12, borderTop: `1px solid ${F1.hair}`,
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
                color: live ? F1.drs : F1.dim,
            }}>
                <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: live ? F1.drs : F1.faint,
                }} />
                {live ? 'AVAILABLE' : 'RESULTS ONLY · IN DEVELOPMENT'}
                <ArrowRight size={15} style={{ marginLeft: 'auto', color: F1.dim }} />
            </div>
        </button>
    );
};

const Landing = ({ onPick }) => (
    <div>
        <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: F1.dim,
            paddingBottom: 14, borderBottom: `1px solid ${F1.line}`, marginBottom: 22,
        }}>
            SELECT MODE
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {MODES.map((m) => <Card key={m.id} mode={m} onPick={onPick} />)}
        </div>

        <div style={{
            marginTop: 28, paddingTop: 16, borderTop: `1px solid ${F1.hair}`,
            fontSize: 13, color: F1.dim, letterSpacing: 0.3, lineHeight: 1.8,
        }}>
            Data from FastF1 · seasons <span style={{ fontFamily: MONO, color: F1.text }}>2018–2026</span>.
            {' '}Telemetry replay needs car position data, which is published from 2018 onward.
        </div>
    </div>
);

export default Landing;
