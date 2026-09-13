/**
 * 📄 RaceStage.jsx — the full-race replay.
 *
 * Deliberately a SIBLING of TrackMap rather than a mode inside it. TrackMap's
 * spine is single-lap-shaped all the way down — one telemetry array, two sector
 * crossings, a delta against a reference lap — and a race has twenty cars, lap
 * counting and no delta at all. Forcing it through the same component would
 * mean a prop for every difference.
 *
 * Building it separately first is also what makes the eventual ReplayStage
 * split honest: the seam between "shared stage" and "per-mode" can be read off
 * two real implementations instead of guessed from one.
 *
 * WHAT IS SHARED, and shared as code rather than copied: TrackCanvas and
 * CarLayer (which already took a list of cars and de-collides their name tags,
 * written for exactly this), useClock, Select, the theme.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';

import TrackCanvas from '../Track/TrackCanvas';
import TimingTower from './TimingTower';
import StatusBanner from './StatusBanner';
import StageMessage from '../StageMessage';
import { useClock } from '../../playback/useClock';
import { useIsNarrow } from '../../hooks/useResponsive';
import { raceService } from '../../services/raceService';
import { buildMapLayout } from '../../lib/geometry/track';
import {
    buildRace, carAt, statusAt, lapAt, messagesUpTo, weatherAt,
    standingsAt, safetyCarAt, gridSlots, GRID_BLEND_S,
} from '../../lib/race';
import { F1, MONO } from '../../theme';

const SPEEDS = [1, 2, 5, 10];

const RaceStage = ({ year, round, session = 'R', raceName }) => {
    const narrow = useIsNarrow();
    const [race, setRace] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [speed, setSpeed] = useState(10);

    // Per-lap state: the tower and the banner only change on a crossing, so
    // these are the only things that re-render during playback.
    const [lap, setLap] = useState(1);
    const [status, setStatus] = useState(null);
    const [caption, setCaption] = useState(null);
    // Whole seconds of race time. The interval column is recomputed off this,
    // so it updates every second instead of freezing for a whole lap.
    const [second, setSecond] = useState(0);

    const trackRef = useRef(null);
    const clockLabelRef = useRef(null);
    const weatherRef = useRef(null);
    const statusCursor = useRef(0);

    // --- load -------------------------------------------------------------
    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        raceService.getRace(year, round, session)
            .then((data) => {
                if (!alive) return;
                if (data?.error) { setError(data.error); return; }
                const built = buildRace(data);
                if (!built) { setError('Race data was unusable'); return; }
                setRace(built);
            })
            .catch((e) => alive && setError(e?.message || 'Could not load the race'))
            .finally(() => alive && setLoading(false));
        return () => { alive = false; };
    }, [year, round, session]);

    // --- the cars on track, as data (same contract as lap mode) -----------
    // No per-car name tags. CarLayer will happily label all twenty and
    // de-collide them, but on a grid that stacks into a column of tags taller
    // than the circuit. Identity lives in the tower; the map carries team
    // colour and position.
    const cars = useMemo(() => [
        ...(race || { cars: [] }).cars.map((c) => ({
            id: c.number, color: c.color, shape: 'disc',
        })),
        // The safety car is always in the list and simply hidden when it is not
        // out. Adding and removing it would rebuild every marker in the layer,
        // which drops the cars for a frame each time one is deployed.
        { id: 'sc', color: '#FFD024', shape: 'ring', label: 'SC' },
    ], [race]);

    const grid = useMemo(() => (race ? gridSlots(race) : new Map()), [race]);

    const mapLayout = useMemo(
        () => (race ? buildMapLayout({ track_points: race.track }, null, race.pitLane) : null),
        [race],
    );

    // --- the hot path -----------------------------------------------------
    const onTick = useCallback((t) => {
        if (!race) return;
        // NOTE THE MINUS ON Y. The SVG y axis grows downward, so the track
        // outline, the pit lane and the pit box are all drawn at -Y (see
        // buildMapLayout) and lap mode negates its car the same way. Race mode
        // did not, which mirrored every car vertically against the circuit and
        // parked the whole field in empty space beside the track. It was
        // invisible to a payload-space check, because there nothing is flipped.
        // For the first few seconds the cars sit on the exaggerated grid and
        // then dissolve into their measured positions, which reads as a start.
        // Without it twenty cars overlap in one blob, because a real grid is
        // 8 m between rows and that is under half a pixel here.
        const gk = t < GRID_BLEND_S ? Math.max(0, t) / GRID_BLEND_S : 1;

        for (const c of race.cars) {
            const p = carAt(c, race, t);
            if (!p.on) { trackRef.current?.move(c.number, null, null); continue; }
            let x = p.x, y = p.y;
            if (gk < 1) {
                const g = grid.get(c.number);
                if (g) { x = g.x + (p.x - g.x) * gk; y = g.y + (p.y - g.y) * gk; }
            }
            trackRef.current?.move(c.number, x, -y);
        }

        setSecond((prev) => {
            const sec = Math.floor(t);
            return prev === sec ? prev : sec;
        });

        if (clockLabelRef.current) {
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            clockLabelRef.current.textContent =
                `${m}:${String(s).padStart(2, '0')}`;
        }

        const L = lapAt(race, t);
        setLap((prev) => (prev === L ? prev : L));

        const { span, index } = statusAt(race, t, statusCursor.current);
        statusCursor.current = index;
        setStatus((prev) => (prev === span ? prev : span));

        // The safety car runs ahead of whoever is leading ON THE ROAD, which
        // is the same standings the tower shows — not the last lap's result.
        const sc = span?.code === '4'
            ? safetyCarAt(race, t, span, standingsAt(race, t).order[0])
            : null;
        if (sc) trackRef.current?.move('sc', sc.x, -sc.y);
        else trackRef.current?.move('sc', null, null);

        const msgs = messagesUpTo(race, t, 1);
        const top = msgs[0]?.msg || null;
        setCaption((prev) => (prev === top ? prev : top));

        if (weatherRef.current) {
            const w = weatherAt(race, t);
            weatherRef.current.textContent = w
                ? `${w.track.toFixed(0)}°C TRACK · ${w.air.toFixed(0)}°C AIR${w.rain ? ' · RAIN' : ''}`
                : '';
        }
    }, [race, grid]);

    const clock = useClock({
        duration: race?.duration || 0,
        speed,
        onTick,
    });

    // Park every car at the start before the first play, and re-park whenever
    // a new race lands — otherwise the markers sit wherever the last one left
    // them until the clock runs.
    useEffect(() => {
        if (!race) return;
        clock.reset();
        statusCursor.current = 0;
        setLap(1);
        // Park on the grid, not on the measured start positions.
        for (const c of race.cars) {
            const g = grid.get(c.number);
            if (g) trackRef.current?.move(c.number, g.x, -g.y);
            else trackRef.current?.move(c.number, c.x[0], -c.y[0]);
        }
        trackRef.current?.move('sc', null, null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [race, mapLayout, grid]);

    // The clock and weather readouts are written imperatively, so anything
    // that REMOUNTS them leaves the JSX defaults on screen until the next
    // tick — crossing the narrow/desktop breakpoint swaps the whole tower
    // block, which showed "0:00" beside lap 20. Repaint on those changes.
    useEffect(() => {
        if (race) onTick(clock.timeRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [narrow, race, onTick]);

    /** Jump to a lap. This is the primary way to move through a race. */
    const scrubTo = useCallback((targetLap) => {
        if (!race) return;
        const row = race.lapStarts.find(([l]) => l === targetLap);
        const t = row ? row[1] : 0;
        clock.seek(t);
        onTick(t);
    }, [race, clock, onTick]);

    if (loading) return <StageMessage variant="loading" title={raceName || 'Race'} />;
    if (error) {
        return <StageMessage variant="error" title={raceName || 'Race'} message={error} />;
    }
    if (!race || !mapLayout) return null;

    const towerWidth = narrow ? 0 : 232;

    const stage = (
        <div style={{
            position: 'relative', width: '100%',
            height: `calc(${narrow ? 74 : 80}vh)`,
            minHeight: narrow ? 520 : 580,
            background: `radial-gradient(120% 80% at 58% 46%, #15151C 0%, ${F1.bg} 62%)`,
            border: `1px solid ${F1.line}`,
            overflow: 'hidden', display: 'flex',
        }}>
            {/* header */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, zIndex: 14,
                display: 'flex', alignItems: 'center', gap: narrow ? 8 : 14,
                flexWrap: 'wrap', padding: narrow ? '12px 14px' : '16px 22px',
            }}>
                <span style={{ width: 3, height: 16, background: F1.red }} />
                <span style={{
                    fontSize: narrow ? 13 : 15, fontWeight: 700,
                    letterSpacing: narrow ? 1 : 1.8, textTransform: 'uppercase',
                }}>
                    {race.race}
                </span>
                <span style={{
                    padding: '3px 7px', fontSize: 9, fontWeight: 700,
                    letterSpacing: 1.2, color: F1.text, background: F1.line,
                    whiteSpace: 'nowrap',
                }}>
                    RACE
                </span>
                <StatusBanner span={status} message={caption} />

                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {SPEEDS.map((s) => (
                        <button key={s} onClick={() => setSpeed(s)} style={{
                            padding: '5px 9px', fontSize: 11, fontWeight: 700,
                            fontFamily: MONO, cursor: 'pointer', border: 'none',
                            background: s === speed ? F1.red : 'transparent',
                            color: s === speed ? '#fff' : F1.dim,
                        }}>{s}×</button>
                    ))}
                </div>
            </div>

            {/* timing tower */}
            {!narrow && (
                <div style={{
                    position: 'absolute', left: 18, top: 74, width: towerWidth - 36,
                    zIndex: 12,
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6,
                    }}>
                        <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: F1.dim,
                        }}>LAP</span>
                        <span style={{
                            fontFamily: MONO, fontSize: 18, fontWeight: 700, color: F1.text,
                            fontVariantNumeric: 'tabular-nums',
                        }}>
                            {lap}<span style={{ color: F1.faint, fontSize: 12 }}>/{race.totalLaps}</span>
                        </span>
                        <span ref={clockLabelRef} style={{
                            marginLeft: 'auto', fontFamily: MONO, fontSize: 11, color: F1.faint,
                            fontVariantNumeric: 'tabular-nums',
                        }}>0:00</span>
                    </div>
                    <TimingTower race={race} lap={lap} second={second} status={status} narrow={narrow} />
                </div>
            )}

            {/* map */}
            <div style={{
                position: 'absolute', left: towerWidth, right: 0,
                top: narrow ? 96 : 64, bottom: 92,
            }}>
                <TrackCanvas
                    ref={trackRef}
                    mapLayout={mapLayout}
                    cars={cars}
                    pitBox={race.pitBox}
                    // Race mode places its own cars on the starting grid; the
                    // shared default would stack all twenty on the start line.
                    parkAtStart={false}
                />
            </div>

            {/* transport + lap scrubber */}
            <div style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 13,
                padding: narrow ? '10px 14px 14px' : '12px 22px 16px',
                display: 'flex', flexDirection: 'column', gap: 9,
                background: 'linear-gradient(180deg, rgba(11,11,15,0) 0%, rgba(11,11,15,0.94) 40%)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                        onClick={clock.isPlaying ? clock.pause : clock.play}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: F1.red, color: '#fff', border: 'none',
                            padding: '10px 20px', cursor: 'pointer',
                            fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
                        }}
                    >
                        {clock.isPlaying
                            ? <><Pause size={13} fill="currentColor" />PAUSE</>
                            : <><Play size={13} fill="currentColor" />PLAY</>}
                    </button>
                    <button
                        onClick={() => scrubTo(1)}
                        title="Back to lap 1"
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: 34, height: 34, background: 'transparent',
                            color: F1.dim, border: `1px solid ${F1.line}`, cursor: 'pointer',
                        }}
                    >
                        <RotateCcw size={14} />
                    </button>
                    <span ref={weatherRef} style={{
                        fontFamily: MONO, fontSize: 10, letterSpacing: 0.4, color: F1.faint,
                    }} />
                    {narrow && (
                        <span style={{
                            marginLeft: 'auto', fontFamily: MONO, fontSize: 12, color: F1.text,
                        }}>{lap}/{race.totalLaps}</span>
                    )}
                </div>

                {/*
                    The lap scrubber is not a convenience here, it is the main
                    control: a 153-minute race still takes 15 minutes at 10x,
                    so moving by lap is how anyone actually watches this.
                */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color: F1.faint,
                    }}>LAP 1</span>
                    <input
                        type="range"
                        min={1}
                        max={race.totalLaps}
                        value={lap}
                        onChange={(e) => scrubTo(Number(e.target.value))}
                        aria-label="Jump to lap"
                        style={{ flex: 1, accentColor: F1.red, cursor: 'pointer' }}
                    />
                    <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: 1.2, color: F1.faint,
                    }}>{race.totalLaps}</span>
                </div>
            </div>
        </div>
    );

    if (!narrow) return stage;

    // On a narrow layout the tower cannot sit beside the map — there is no
    // column for it — but hiding it removed the running order altogether,
    // which is the whole point of a race replay. It goes underneath instead,
    // where it costs the map nothing.
    return (
        <>
            {stage}
            <div style={{
                marginTop: 10, padding: '10px 12px 12px',
                background: F1.panel, border: `1px solid ${F1.line}`,
            }}>
                <div style={{
                    display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7,
                }}>
                    <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: F1.dim,
                    }}>ORDER</span>
                    <span style={{
                        fontFamily: MONO, fontSize: 13, fontWeight: 700, color: F1.text,
                        fontVariantNumeric: 'tabular-nums',
                    }}>
                        LAP {lap}<span style={{ color: F1.faint }}>/{race.totalLaps}</span>
                    </span>
                </div>
                <TimingTower race={race} lap={lap} second={second}
                    status={status} narrow={narrow} />
            </div>
        </>
    );
};

export default RaceStage;
