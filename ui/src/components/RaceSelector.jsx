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

/**
 * Season + Grand Prix picker.
 *
 * The selection lives in the URL, not in here — `year` and `round` come down as
 * props and changes are reported back up. That keeps a link like
 * /compare/2023/1 authoritative: arriving on it selects the right race without
 * this component ever owning that decision.
 */
const RaceSelector = ({
    year, round, session, showSession,
    onYearChange, onSelectRound, onSelectSession, onRaceResolved,
}) => {
    const [races, setRaces] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [waking, setWaking] = useState(false);
    const [sessions, setSessions] = useState([]);

    useEffect(() => {
        setLoading(true);
        setError(null);
        setWaking(false);
        setRaces([]);
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
    }, [year]);

    // Which sessions this weekend actually ran. It varies: 2023 sprint weekends
    // had a "Sprint Shootout", 2024 renamed it "Sprint Qualifying", and the
    // running order differs — so it's read per round rather than assumed.
    useEffect(() => {
        setSessions([]);
        if (!round) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await raceService.getSessions(year, round);
                if (cancelled || data.error) return;
                setSessions(data.sessions || []);
            } catch (err) {
                console.warn('Session list unavailable', err);
            }
        })();
        return () => { cancelled = true; };
    }, [year, round]);

    // Tell the parent what the round in the URL actually refers to, so headers
    // can name the race. Display only — it never drives the route.
    const selected = races.find((r) => r.round === round) || null;
    useEffect(() => {
        onRaceResolved?.(selected);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected?.round, races.length]);

    return (
        <div style={{
            display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
        }}>
            <Calendar color={F1.red} size={18} />

            <select
                value={year}
                onChange={(e) => onYearChange(parseInt(e.target.value, 10))}
                style={selectStyle}
            >
                {Array.from(
                    { length: new Date().getFullYear() - 2018 + 1 },
                    (_, i) => new Date().getFullYear() - i
                ).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>

            <select
                value={selected ? String(selected.round) : ''}
                onChange={(e) => onSelectRound(e.target.value ? parseInt(e.target.value, 10) : null)}
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

            {showSession && selected && (
                <select
                    value={session || 'Q'}
                    onChange={(e) => onSelectSession?.(e.target.value)}
                    style={{ ...selectStyle, minWidth: 132 }}
                    disabled={sessions.length === 0}
                >
                    {sessions.length === 0
                        ? <option value={session || 'Q'}>Loading sessions…</option>
                        : sessions.map((s) => (
                            <option key={s.code} value={s.code}>{s.name}</option>
                        ))}
                </select>
            )}

            {selected && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: F1.dim, fontSize: 12, letterSpacing: 0.5 }}>
                    <MapPin size={14} />
                    {selected.location}
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
