import { useState, useEffect } from 'react';
import { raceService } from '../services/raceService';
import { Calendar, MapPin } from 'lucide-react';
import { F1 } from '../theme';
import Select from './ui/Select';

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

            <Select
                ariaLabel="Season"
                value={year}
                options={Array.from(
                    { length: new Date().getFullYear() - 2018 + 1 },
                    (_, i) => new Date().getFullYear() - i
                ).map((y) => ({ value: y, label: String(y) }))}
                onChange={(v) => onYearChange(parseInt(v, 10))}
                minWidth={96}
                maxWidth={110}
                mono
            />

            <Select
                ariaLabel="Grand Prix"
                value={selected ? String(selected.round) : ''}
                placeholder={loading
                    ? (waking ? 'Waking up the server…' : 'Loading calendar…')
                    : 'Select a Grand Prix'}
                options={races.map((race) => ({
                    value: String(race.round),
                    label: race.name,
                    short: `R${race.round} · ${race.name}`,
                    sub: `R${race.round}`,
                }))}
                onChange={(v) => onSelectRound(v ? parseInt(v, 10) : null)}
                disabled={loading || !!error}
                minWidth={260}
                maxWidth={380}
            />

            {showSession && selected && (
                <Select
                    ariaLabel="Session"
                    value={session || 'Q'}
                    options={sessions.length === 0
                        ? [{ value: session || 'Q', label: 'Loading sessions…' }]
                        : sessions.map((sn) => ({ value: sn.code, label: sn.name }))}
                    onChange={(v) => onSelectSession?.(v)}
                    disabled={sessions.length === 0}
                    minWidth={132}
                    maxWidth={170}
                />
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
