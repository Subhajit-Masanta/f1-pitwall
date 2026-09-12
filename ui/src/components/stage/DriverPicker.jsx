/**
 * 📄 DriverPicker.jsx — one driver slot in a head-to-head.
 */
import Select from '../ui/Select';
import { F1 } from '../../theme';

/**
 * One driver slot in a head-to-head. Both slots use this, so neither is
 * privileged — the "reference" is just whichever driver sits in slot A.
 *
 * The gap to the session best is the `sub` column rather than part of the
 * label, so the codes line up down the left and the times down the right —
 * a timing sheet, which is the thing being read. A native <select> could not
 * do either that or the team-colour flash, since the OS draws the popup.
 */
const DriverPicker = ({
    slot, value, drivers, exclude, color, loading, placeholder, prefix, onChange,
}) => {
    const options = [
        {
            value: '',
            label: drivers.length === 0
                ? 'Loading drivers…'
                : loading ? 'Loading driver…' : (placeholder || 'Pick a driver'),
            color: null,
        },
        // can't race a driver against himself
        ...drivers
            .filter((d) => d.number !== exclude)
            .map((d) => {
                const gap = d.gap > 0 ? `+${d.gap.toFixed(3)}` : d.gap.toFixed(3);
                return {
                    value: d.number,
                    label: d.code,
                    short: `${d.code} · ${gap}`,
                    sub: gap,
                    color: d.color,
                };
            }),
    ];

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {prefix && (
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: F1.faint }}>
                    {prefix}
                </span>
            )}
            <Select
                ariaLabel={`Driver ${slot}`}
                value={value}
                options={options}
                accent={color}
                loading={loading}
                disabled={drivers.length === 0}
                minWidth={150}
                maxWidth={190}
                onChange={(v) => onChange?.(slot, v || null)}
            />
        </div>
    );
};

export default DriverPicker;
