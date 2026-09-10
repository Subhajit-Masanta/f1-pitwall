import { useState, useEffect } from 'react';
import { raceService } from '../services/raceService';
import { Calendar, MapPin } from 'lucide-react';
import { F1 } from '../theme';

const selectStyle = {
    padding: '8px 10px',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.5,
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

    useEffect(() => {
        setSelectedRaceId('');
        onSelectRace(null);
        setLoading(true);
        setError(null);

        (async () => {
            try {
                const data = await raceService.getCalendar(year);
                setRaces(data);
            } catch (err) {
                console.error('Failed to load races', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [year]);

    const handleChange = (e) => {
        const raceId = e.target.value;
        setSelectedRaceId(raceId);
        onSelectRace(races.find((r) => r.round === parseInt(raceId, 10)) || null);
    };

    return (
        <div style={{
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
            <Calendar color={F1.red} size={16} />

            <select value={year} onChange={(e) => onYearChange(parseInt(e.target.value, 10))} style={selectStyle}>
                {Array.from(
                    { length: new Date().getFullYear() - 2018 + 1 },
                    (_, i) => new Date().getFullYear() - i
                ).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>

            <select
                value={selectedRaceId}
                onChange={handleChange}
                style={{ ...selectStyle, minWidth: 260 }}
                disabled={loading || !!error}
            >
                <option value="">{loading ? 'Loading calendar…' : '— Select a Grand Prix —'}</option>
                {races.map((race) => (
                    <option key={race.round} value={race.round}>
                        R{race.round} · {race.name}
                    </option>
                ))}
            </select>

            {selectedRaceId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: F1.dim, fontSize: 11, letterSpacing: 1 }}>
                    <MapPin size={13} />
                    {races.find((r) => r.round === parseInt(selectedRaceId, 10))?.location}
                </div>
            )}

            {error && (
                <span style={{ color: F1.red, fontSize: 11 }}>
                    {error} — is the backend running?
                </span>
            )}
        </div>
    );
};

export default RaceSelector;
