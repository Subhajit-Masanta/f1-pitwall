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
import StrategyChart from './StrategyChart';
import RaceTrace from './RaceTrace';
import StatusBanner from './StatusBanner';
import FlagOverlay from './FlagOverlay';
import RaceControl from './RaceControl';
import LapScrubber from './LapScrubber';
import RaceCard from './RaceCard';
import RaceEnding from './RaceEnding';
import Shortcuts from '../Shortcuts';
import StageMessage from '../StageMessage';
import { useClock } from '../../playback/useClock';
import { useIsNarrow } from '../../hooks/useResponsive';
import { useKeyboard } from '../../hooks/useKeyboard';
import { raceService } from '../../services/raceService';
import { buildMapLayout } from '../../lib/geometry/track';
import {
    buildRace, carAt, statusAt, lapAt, messagesUpTo, weatherAt,
    standingsAt, safetyCarAt, gridSlots, GRID_BLEND_S,
} from '../../lib/race';
import { directorShot, SHOT_LABEL } from '../../lib/director';
import { cameraStep, isWide, FOCUS_ZOOM, WIDE_ZOOM } from '../../lib/camera';
import { F1, MONO, MAXW } from '../../theme';

const SPEEDS = [1, 2, 5, 10];

/** What `?` puts on screen. A race has the most of any mode. */
const KEYS = [
    { keys: ['SPACE', 'K'], what: 'Play or pause' },
    { keys: ['←', '→'], what: 'Previous or next lap' },
    { keys: ['R', 'HOME'], what: 'Back to lap 1' },
    { keys: ['D'], what: 'Director camera' },
    { keys: ['ESC'], what: 'Close, or stop following' },
    { keys: ['?'], what: 'This list' },
];

const RaceStage = ({ year, round, session = 'R', raceName }) => {
    const narrow = useIsNarrow();
    const [race, setRace] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [speed, setSpeed] = useState(10);
    // The card greets the race once. Pressing play is the only thing that
    // dismisses it, and nothing brings it back for this session.
    const [greeted, setGreeted] = useState(false);

    // Per-lap state: the tower and the banner only change on a crossing, so
    // these are the only things that re-render during playback.
    const [lap, setLap] = useState(1);
    const [status, setStatus] = useState(null);
    const [caption, setCaption] = useState(null);
    // Whole seconds of race time. The interval column is recomputed off this,
    // so it updates every second instead of freezing for a whole lap.
    const [second, setSecond] = useState(0);

    // --- the camera -------------------------------------------------------
    // Who the map is watching: a driver number, or null for the whole circuit.
    const [focus, setFocus] = useState(null);
    // Whether the director is choosing that driver for you.
    const [director, setDirector] = useState(false);
    // What the director is currently watching and why. Set only when it cuts,
    // not once a second — a new object every second is a render every second.
    const [shotOn, setShotOn] = useState(null);
    // The result on screen, and how it got there: 'flag' when the race just
    // finished and the chequered flag is worth throwing, 'sheet' when someone
    // asked for it mid-race and an announcement would be theatre.
    const [ended, setEnded] = useState(null);
    // The shortcut sheet. Owned here rather than by the app shell so that
    // Escape's ordering — sheet, then result, then camera — lives in one
    // place instead of being negotiated between two key handlers.
    const [help, setHelp] = useState(false);

    const trackRef = useRef(null);
    const clockLabelRef = useRef(null);
    const weatherRef = useRef(null);
    const statusCursor = useRef(0);

    // Read on the hot path, so they are refs as well as state: putting them in
    // onTick's dependencies would rebuild the tick callback on every click.
    const focusRef = useRef(null);
    const directorRef = useRef(false);
    const playingRef = useRef(false);
    focusRef.current = focus;
    directorRef.current = director;

    // The camera's own state. `cam` is where it is now, `shot` is the
    // director's current choice, `dirSec` is the last race-second the director
    // was asked — it runs once a second, not once a frame.
    const cam = useRef(null);
    const shot = useRef(null);
    const dirSec = useRef(-1);
    const lastWall = useRef(0);

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
    // WHO THE MAP IS WATCHING, whoever chose them. Everything downstream —
    // the name on the car, the tower's relative column, the chip — reads this
    // rather than `focus`, so a driver the director picked is as visible as
    // one the viewer picked by hand.
    const watched = focus || (director ? shotOn?.driver || null : null);

    const cars = useMemo(() => {
        const list = (race?.cars || []).map((c) => ({
            id: c.number, color: c.color, shape: 'disc',
            // THE CAR BEING FOLLOWED IS THE ONLY ONE WITH A NAME ON IT. All
            // twenty labelled stacks into a column of tags taller than the
            // circuit; identity otherwise lives in the tower. The one you
            // picked is the exception, because a zoomed map that does not say
            // whose car is in the middle of it is a puzzle.
            label: c.number === watched ? c.code : undefined,
        }));
        return [
            ...list.filter((c) => c.id !== watched),
            // The safety car is always in the list and simply hidden when it is
            // not out. Adding and removing it would rebuild every marker in the
            // layer, which drops the cars for a frame each time one is deployed.
            { id: 'sc', color: '#FFD024', shape: 'ring', label: 'SC' },
            // Drawn last, so the car being followed sits on top of the field
            // it is in the middle of.
            ...list.filter((c) => c.id === watched),
        ];
    }, [race, watched]);

    const grid = useMemo(() => (race ? gridSlots(race) : new Map()), [race]);

    const mapLayout = useMemo(
        () => (race ? buildMapLayout({ track_points: race.track }, null, race.pitLane) : null),
        [race],
    );

    // Where the camera sits when it is showing the whole circuit: the middle
    // of the viewBox, in the same track units the cars are moved in. Zoom
    // alone is not enough to go back to the wide shot — at k=1 with a stale
    // centre the circuit is still off to one side.
    const home = useMemo(() => {
        if (!mapLayout) return null;
        const [mx, my, vw, vh] = mapLayout.viewBox.split(' ').map(Number);
        return { cx: mx + vw / 2, cy: my + vh / 2 };
    }, [mapLayout]);

    // --- the hot path -----------------------------------------------------
    const onTick = useCallback((t) => {
        if (!race) return;

        // --- THE CAMERA, BEFORE ANY CAR IS MOVED ---------------------------
        // `move` projects through whatever the camera is looking at, so
        // pointing it afterwards draws the whole field through last frame's
        // camera and the grid visibly lags the circuit it is standing on.
        if (home) {
            // Wall time, not race time: how the motion feels is a property of
            // the screen, and the screen runs at 1x whether the replay is at
            // 1x or 10x.
            const nowMs = typeof performance !== 'undefined'
                ? performance.now() : Date.now();
            let dt = (nowMs - lastWall.current) / 1000;
            lastWall.current = nowMs;
            if (!(dt > 0) || dt > 1) dt = 1 / 60;

            let watch = focusRef.current;
            if (!watch && directorRef.current) {
                // Once a race-second. A shot that could change sixty times a
                // second would not be a shot, and the director's answer cannot
                // change meaningfully inside one anyway.
                const sec = Math.floor(t);
                if (sec !== dirSec.current) {
                    dirSec.current = sec;
                    const before = shot.current;
                    shot.current = directorShot(race, t, shot.current);
                    if (shot.current !== before) {
                        setShotOn({
                            reason: shot.current.reason,
                            driver: shot.current.driver,
                        });
                    }
                }
                watch = shot.current?.driver || null;
            }

            let target = { ...home, k: WIDE_ZOOM };
            if (watch) {
                const car = race.byNumber[watch];
                const p = car && carAt(car, race, t);
                // A car with no position this frame HOLDS the camera where it
                // is. Diving back to the middle of the circuit because the
                // data went quiet for half a second is the one move a camera
                // must never make.
                target = p && p.on ? { cx: p.x, cy: -p.y, k: FOCUS_ZOOM } : null;
            }

            // Cut rather than glide while the clock is stopped — a paused
            // replay produces no further frames to glide on. See cameraStep.
            cam.current = cameraStep(
                cam.current || { ...home, k: WIDE_ZOOM }, target, dt, playingRef.current,
            );
            // Once the pull-back has finished, stop transforming the map at
            // all — a track drawn through a scale of 1.0001 is still being
            // composited and still rounding every sub-pixel.
            if (!watch && isWide(cam.current)) trackRef.current?.look(null);
            else trackRef.current?.look(cam.current.cx, cam.current.cy, cam.current.k);
        }

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
            // `pit` rides along so the marker can shrink: a car being
            // serviced is not racing, and eighteen of them in a pit lane that
            // is 55px long need all the room they can be given.
            trackRef.current?.move(c.number, x, -y, p.pit);
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
    }, [race, grid, home]);

    const clock = useClock({
        duration: race?.duration || 0,
        speed,
        onTick,
        // The race now ENDS rather than simply stopping.
        onEnd: () => setEnded('flag'),
    });

    // Park every car at the start before the first play, and re-park whenever
    // a new race lands — otherwise the markers sit wherever the last one left
    // them until the clock runs.
    useEffect(() => {
        if (!race) return;
        clock.reset();
        statusCursor.current = 0;
        setLap(1);
        setEnded(null);
        // A new race is a new camera. Carrying the last one over points a
        // 3.2x zoom at a coordinate on a circuit that is no longer loaded.
        cam.current = null;
        shot.current = null;
        dirSec.current = -1;
        setFocus(null);
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
    // `focus` and `director` are here for the same reason: they are read off
    // refs on the hot path, so nothing else would repaint the map when one of
    // them changes while the replay is paused — which is exactly when someone
    // clicks a driver to look at them.
    useEffect(() => {
        if (race) onTick(clock.timeRef.current);
        // `clock.isPlaying` is here so that PAUSING settles the camera. Pause
        // in the middle of a zoom and the frames stop arriving mid-glide,
        // which left it parked between the two shots; one more tick with the
        // clock stopped cuts it the rest of the way.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [narrow, race, onTick, focus, director, clock.isPlaying]);

    // The hot path asks whether the replay is running, to decide whether the
    // camera glides or cuts.
    playingRef.current = clock.isPlaying;

    /** Jump to a lap. This is the primary way to move through a race. */
    const scrubTo = useCallback((targetLap) => {
        if (!race) return;
        const row = race.lapStarts.find(([l]) => l === targetLap);
        const t = row ? row[1] : 0;
        setEnded(null);
        clock.seek(t);
        onTick(t);
    }, [race, clock, onTick]);

    /** Follow a driver, or let them go if they are already being followed. */
    const pick = useCallback((num) => {
        setFocus((prev) => (prev === num ? null : num));
        // Picking a driver by hand takes the camera off the director. Leaving
        // both on means the director silently overrules the next cut and the
        // click looks broken.
        setDirector(false);
        setShotOn(null);
    }, []);

    const toggleDirector = useCallback(() => {
        setDirector((on) => {
            if (!on) { shot.current = null; dirSec.current = -1; setFocus(null); }
            else setShotOn(null);
            return !on;
        });
    }, []);

    // Space and the arrows. A lap is the unit a race is watched in, so that is
    // what an arrow moves — dragging a scrubber 1/58th of its width to see the
    // next lap is not a control, it is a dare.
    useKeyboard(useMemo(() => {
        // WHILE THE SHEET IS UP IT IS THE ONLY THING LISTENING. A modal that
        // lets Space through starts the race behind the page that is
        // explaining how to start the race.
        if (help) {
            const shut = () => setHelp(false);
            return { help: shut, escape: shut };
        }
        return ({
        toggle: () => {
            setGreeted(true);
            if (clock.isPlaying) clock.pause(); else clock.play();
        },
        prev: () => scrubTo(Math.max(1, lap - 1)),
        next: () => scrubTo(Math.min(race?.totalLaps ?? 1, lap + 1)),
        restart: () => scrubTo(1),
        director: toggleDirector,
        help: () => setHelp((h) => !h),
        // The way out of whatever is on top: the result first, since it
        // covers the stage, and otherwise the camera.
        escape: () => {
            if (ended) { setEnded(null); return; }
            setFocus(null); setDirector(false); setShotOn(null);
        },
        });
    }, [clock, scrubTo, lap, race, toggleDirector, ended, help]), !!race);

    if (loading) return <StageMessage variant="loading" title={raceName || 'Race'} />;
    if (error) {
        return <StageMessage variant="error" title={raceName || 'Race'} message={error} />;
    }
    if (!race || !mapLayout) return null;

    const towerWidth = narrow ? 0 : 232;

    // THE STAGE IS AS TALL AS THE CIRCUIT NEEDS IT TO BE.
    //
    // A fixed 80vh was fine while the page was 1200px wide, because the map
    // band came out at roughly the shape of a circuit. Widening the page to
    // 1680 made it 2.8:1 against Melbourne's 2.0:1, so the track went
    // height-bound and drew at 771px inside a 1366px box — 600px of dead
    // stage either side of it.
    //
    // So the height is derived instead: whatever makes the map band the same
    // shape as the track it has to draw, bounded above by the viewport and
    // below by the old minimum.
    //
    // The upper bound is 82vh rather than the whole of it because the page
    // header and the race picker sit above the stage: at 86 the scrubber —
    // the control this mode is actually driven by — landed four pixels under
    // the fold.
    //
    // All of it in CSS, because the only unknown is the stage width and that
    // is the page width, which is known: min(MAXW, 100vw - the page padding).
    const MAP_TOP = narrow ? 96 : 64;
    const MAP_BOTTOM = 92;
    const aspect = (() => {
        const [, , w, h] = (mapLayout?.viewBox || '0 0 1 1').split(' ').map(Number);
        return w > 0 && h > 0 ? w / h : 1.8;
    })();
    const pagePad = narrow ? 32 : 80;
    const stageW = `min(${MAXW}px, 100vw - ${pagePad}px)`;
    const mapW = `(${stageW} - ${towerWidth}px)`;
    const wanted = `calc(${mapW} / ${aspect.toFixed(3)} + ${MAP_TOP + MAP_BOTTOM}px)`;

    const stage = (
        <div style={{
            position: 'relative', width: '100%',
            height: `min(${wanted}, ${narrow ? 74 : 82}vh)`,
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
                    {/* A sprint weekend has two races and this replays either,
                        so the badge says which one is on screen. */}
                    {(race.session || 'Race').toUpperCase()}
                </span>
                <StatusBanner span={status} message={caption} />

                <div style={{
                    marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                    {/* WHAT THE CAMERA IS DOING, and the way out of it. A
                        zoomed map with no label is a map someone has to work
                        out; this says whose car is in the middle of it and
                        why, and the ✕ is the one control that always goes
                        back to the whole circuit. */}
                    {(focus || director) && (
                        <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '3px 4px 3px 8px',
                            background: 'rgba(255,255,255,0.07)',
                            fontFamily: MONO, fontSize: 9, fontWeight: 700,
                            letterSpacing: 1, color: F1.text, whiteSpace: 'nowrap',
                        }}>
                            <span style={{
                                width: 5, height: 5, borderRadius: '50%',
                                background: watched
                                    ? (race.byNumber[watched]?.color || F1.red) : F1.red,
                            }} />
                            {focus
                                ? `FOLLOWING ${race.byNumber[focus]?.code || ''}`
                                : ['DIRECTOR',
                                   shotOn && SHOT_LABEL[shotOn.reason],
                                   watched && race.byNumber[watched]?.code]
                                    .filter(Boolean).join(' · ')}
                            <button
                                type="button"
                                onClick={() => {
                                    setFocus(null); setDirector(false); setShotOn(null);
                                }}
                                title="Back to the whole circuit (Esc)"
                                style={{
                                    border: 'none', background: 'transparent',
                                    color: F1.faint, cursor: 'pointer',
                                    fontSize: 11, lineHeight: 1, padding: '0 3px',
                                }}
                            >✕</button>
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={(e) => { e.currentTarget.blur(); setHelp(true); }}
                        title="Keyboard shortcuts (?)"
                        aria-label="Keyboard shortcuts"
                        style={{
                            width: 26, height: 26, border: `1px solid ${F1.line}`,
                            background: 'transparent', color: F1.dim, cursor: 'pointer',
                            fontFamily: MONO, fontSize: 11, fontWeight: 700, lineHeight: 1,
                        }}
                    >?</button>
                    <button
                        type="button"
                        onClick={toggleDirector}
                        title="Let the camera find the story (D)"
                        style={{
                            padding: '5px 9px', fontSize: 10, fontWeight: 700,
                            fontFamily: MONO, letterSpacing: 1, cursor: 'pointer',
                            border: 'none',
                            background: director ? F1.red : 'transparent',
                            color: director ? '#fff' : F1.dim,
                        }}
                    >DIRECTOR</button>
                    <span style={{
                        width: 1, height: 14, background: F1.line, margin: '0 2px',
                    }} />
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

            {/* A SCRIM UNDER THE TOWER. At the wide shot a circuit's bounding
                box almost never reaches this column, which is why the tower
                never needed one. A camera at 3.2x fills the whole band, so the
                running order ended up printed over a brightly lit corner. The
                gradient fades out before the map proper, so it costs nothing
                at the wide shot. */}
            {!narrow && (
                <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: towerWidth + 24, zIndex: 11, pointerEvents: 'none',
                    background: 'linear-gradient(90deg,'
                        + ' rgba(11,11,15,0.94) 0%, rgba(11,11,15,0.88) 58%,'
                        + ' rgba(11,11,15,0) 100%)',
                }} />
            )}

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
                    <TimingTower race={race} lap={lap} second={second} status={status}
                        narrow={narrow} focus={watched} onPick={pick} />
                </div>
            )}

            {/* map */}
            <div style={{
                position: 'absolute', left: towerWidth, right: 0,
                top: MAP_TOP, bottom: MAP_BOTTOM,
            }}>
                {/* race control, over the top-right of the map — where a
                    circuit's bounding box almost never reaches */}
                <RaceControl race={race} second={second} narrow={narrow} />

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

            {/* The flag, across the whole stage. Sits above the map so the
                announcement reads, below the transport so controls stay live. */}
            <FlagOverlay span={status} />

            {/* The flag, and then the sheet. It goes over the stage rather
                than replacing it, because the map underneath is the last
                frame of the race. */}
            {help && <Shortcuts items={KEYS} onClose={() => setHelp(false)} />}

            {ended && (
                <RaceEnding
                    race={race} narrow={narrow} announce={ended === 'flag'}
                    onClose={() => setEnded(null)}
                    onReplay={() => { scrubTo(1); clock.play(); }}
                />
            )}

            {!greeted && (
                <RaceCard
                    race={race} byNumber={race.byNumber} narrow={narrow}
                    onStart={() => { setGreeted(true); clock.play(); }}
                />
            )}

            {/* transport + lap scrubber */}
            <div style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 13,
                padding: narrow ? '10px 14px 14px' : '12px 22px 16px',
                display: 'flex', flexDirection: 'column', gap: 9,
                background: 'linear-gradient(180deg, rgba(11,11,15,0) 0%, rgba(11,11,15,0.94) 40%)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                        onClick={() => {
                            setGreeted(true);
                            if (clock.isPlaying) clock.pause(); else clock.play();
                        }}
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
                    {/* THE RESULT, ON DEMAND. It used to exist for exactly as
                        long as it was on screen: close it and the only way
                        back was to watch the race again. It spoils the race,
                        which is why it is a labelled button and not something
                        that happens to you. */}
                    <button
                        onClick={() => setEnded('sheet')}
                        title="Final classification — this gives away the result"
                        style={{
                            height: 34, padding: '0 12px', background: 'transparent',
                            color: F1.dim, border: `1px solid ${F1.line}`, cursor: 'pointer',
                            fontFamily: MONO, fontSize: 10, fontWeight: 700,
                            letterSpacing: 1.2,
                        }}
                    >RESULT</button>
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
                <LapScrubber race={race} lap={lap} onScrub={scrubTo} />
            </div>
        </div>
    );

    // The strategy chart belongs to the race, not to the stage — it is the
    // whole race at once rather than one moment of it — so it sits underneath
    // in both layouts, reading from the payload the stage already has.
    const strategy = (
        <>
            <div style={{ marginTop: 10 }}>
                <RaceTrace race={race} lap={lap} narrow={narrow} />
            </div>
            <div style={{ marginTop: 10 }}>
                <StrategyChart race={race} lap={lap} narrow={narrow} />
            </div>
        </>
    );

    if (!narrow) {
        return (
            <>
                {stage}
                {strategy}
            </>
        );
    }

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
                    status={status} narrow={narrow} focus={watched} onPick={pick} />
            </div>
            {strategy}
        </>
    );
};

export default RaceStage;
