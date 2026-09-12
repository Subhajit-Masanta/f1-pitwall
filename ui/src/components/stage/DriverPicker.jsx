/**
 * 📄 DriverPicker.jsx — one driver slot in a head-to-head.
 */
import { F1 } from '../../theme';

/**
 * One driver slot in a head-to-head. Both slots use this, so neither is
 * privileged — the "reference" is just whichever driver sits in slot A.
 */
const DriverPicker = ({
    slot, value, drivers, exclude, color, loading, placeholder, prefix, onChange,
}) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {prefix && (
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: F1.faint }}>
                {prefix}
            </span>
        )}
        <select
            value={value}
            onChange={(e) => onChange?.(slot, e.target.value || null)}
            disabled={loading || drivers.length === 0}
            style={{
                padding: '5px 8px', fontSize: 11, fontWeight: 600,
                letterSpacing: 0.4, background: F1.bg,
                color: value ? F1.text : F1.dim,
                // the select itself carries the driver's team colour
                border: `1px solid ${color || F1.line}`,
                cursor: loading ? 'wait' : 'pointer', maxWidth: 190,
            }}
        >
            <option value="">
                {drivers.length === 0
                    ? 'Loading drivers…'
                    : loading ? 'Loading driver…' : (placeholder || '— pick a driver —')}
            </option>
            {drivers
                // can't race a driver against himself
                .filter((d) => d.number !== exclude)
                .map((d) => (
                    <option key={d.number} value={d.number}>
                        {d.code} · {d.gap > 0 ? `+${d.gap.toFixed(3)}` : d.gap.toFixed(3)}
                    </option>
                ))}
        </select>
    </div>
);

export default DriverPicker;
