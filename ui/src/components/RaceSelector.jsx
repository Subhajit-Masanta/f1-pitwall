import { useState, useEffect } from 'react';
import { raceService } from '../services/raceService';
import { Calendar, MapPin } from 'lucide-react';
import { F1 } from '../theme';

const selectStyle = {
    padding: '9px 12px',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 0.3,
    background: F1.bg,
    color: F1.text,
    border: `1px solid ${F1.line}`,
    cursor: 'pointer',
};

const RaceSelector = ({ onSelectRace, year, onYearChange }) => {
    const [races, setRaces] = useState([]);
    const [selectedRaceId, setSelectedRaceId] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [waking, setWaking] = useState(false);

    useEffect(() => {
        setSelectedRaceId('');
        onSelectRace(null);
        setLoading(true);
        setError(null);
        setWaking(false);
        const wakeTimer = setTimeout(() => setWaking(true), 4000);

        // Guard against out-of-order responses: switching year while a slow
        // calendar request is still in flight would otherwise let the OLD
        // response land last and overwrite the new season's races.
        let cancelled = false;

        (async () => {
            try {
                const data = await raceService.getCalendar(year);
                if (cancelled) return;
                if (data.error) throw new Error(data.error);
                setRaces(data);
            } catch (err) {
                if (cancelled) return;
                console.error('Failed to load races', err);
                setError(
                    err.code === 'ECONNABORTED' || !err.response
                        ? 'Server is waking up or unreachable — retry in a moment.'
                        : (err.message || 'Failed to load the calendar.')
                );
            } finally {
                if (!cancelled) {
                    clearTimeout(wakeTimer);
                    setLoading(false);
                }
            }
        })();
        return () => { cancelled = true; clearTimeout(wakeTimer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [year]);

    const handleChange = (e) => {
        const raceId = e.target.value;
        setSelectedRaceId(raceId);
        onSelectRace(races.find((r) => r.round === parseInt(raceId, 10)) || null);
    };

    return (
        <div style={{
            display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        }}>
            <Calendar color={F1.red} size={18} />

            <select value={year} onChange={(e) => onYearChange(parseInt(e.target.value, 10))} style={selectStyle}>
                {Array.from(
                    { length: new Date().getFullYear() - 2018 + 1 },
                    (_, i) => new Date().getFullYear() - i
                ).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>

            <select
                value={selectedRaceId}
                onChange={handleChange}
                style={{ ...selectStyle, minWidth: 260, flex: '1 1 260px', maxWidth: 380 }}
                disabled={loading || !!error}
            >
                <option value="">
                    {loading
                        ? (waking ? 'Waking up the server…' : 'Loading calendar…')
                        : '— Select a Grand Prix —'}
                </option>
                {races.map((race) => (
                    <option key={race.round} value={race.round}>
                        R{race.round} · {race.name}
                    </option>
                ))}
            </select>

            {selectedRaceId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: F1.dim, fontSize: 12, letterSpacing: 0.5 }}>
                    <MapPin size={14} />
                    {races.find((r) => r.round === parseInt(selectedRaceId, 10))?.location}
                </div>
            )}

            {error && (
                <span style={{ color: F1.red, fontSize: 12, letterSpacing: 0.3 }}>
                    {error}
                </span>
            )}
        </div>
    );
};

export default RaceSelector;
