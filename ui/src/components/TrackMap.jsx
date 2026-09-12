/**
 * 📄 TrackMap.jsx — the broadcast replay stage (orchestrator).
 *
 * Wires the data hook to the animation loop, and fans each frame out to three
 * imperative children (car, HUD, timing) so playback never re-renders.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Play, Pause, Activity } from 'lucide-react';

import { useOfficialRaceData } from '../hooks/useOfficialRaceData';
import { useRaceLoop } from '../hooks/useRaceLoop';
import { useIsNarrow } from '../hooks/useResponsive';
import { stageLayout } from './stage/stageLayout';
import { F1, MONO, SPEED_GRADIENT } from '../theme';
import { SESSION_LABEL } from '../lib/router';

import MapControls from './Track/MapControls';
import TrackCanvas from './Track/TrackCanvas';
import TelemetryHUD from './TelemetryHUD';
import SectorTiming from './SectorTiming';
import SpeedTrace from './SpeedTrace';
import DeltaBar from './DeltaBar';
import SectorCompare from './SectorCompare';
import StageMessage from './StageMessage';
import DriverPicker from './stage/DriverPicker';
import Transport from './stage/Transport';

const TrackMap = ({
    year, round, session, raceName,
    mode = 'lap',              // 'lap' | 'compare'
    referenceDriver = null,    // driver A, from the URL (null = session fastest)
    compareWith = null,        // driver B, from the URL
    onPickDriver,
}) => {
    const comparing = mode === 'compare';
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [loadingReplay, setLoadingReplay] = useState(false);
    // Whether playback has actually been started, as distinct from whether the
    // telemetry happens to be loaded — compare mode preloads it.
    const [hasPlayed, setHasPlayed] = useState(false);
    const [view, setView] = useState('map');   // 'map' | 'speed'
    // Trace open/closed, remembered between visits.
    const [showTrace, setShowTrace] = useState(() => {
        try { return localStorage.getItem('pitwall.trace') !== '0'; } catch { return true; }
    });
    const narrow = useIsNarrow(720);

    const trackRef = useRef(null);
    const hudRef = useRef(null);
    const timingRef = useRef(null);
    const traceRef = useRef(null);
    const deltaRef = useRef(null);

    const {
        trackData, mapLayout, speedTrace, telemetry, loading, error, reload,
        loadReplay, replayError, sectorBoundaries, officialSectorTimes, driver,
        drivers, ghost, ghostLoading, loadGhost, compareTrace,
    } = useOfficialRaceData(year, round, session, referenceDriver);

    // The loop reads the ghost through a ref, so picking a driver mid-lap never
    // rebuilds the rAF loop.
    const ghostRef = useRef(null);
    ghostRef.current = ghost;
    // Reference lap's own total distance — the denominator that turns the
    // leader's position into a lap fraction the ghost can be compared at.
    const refDistRef = useRef(1);
    refDistRef.current = telemetry?.length
        ? (telemetry[telemetry.length - 1].distance || 1)
        : 1;

    // Every animation frame — pure DOM writes, zero React.
    const onFrame = useCallback((fr) => {
        const g = ghostRef.current;
        if (g) {
            // Where the ghost is at the same elapsed time...
            const p = g.posAtTime(fr.time);
            trackRef.current?.move('ghost', p.x, p.y);
            // ...and how long IT took to reach where the reference car is now.
            // Positive = the ghost got here later, i.e. it is down on the lap.
            fr.delta = g.timeAtFraction(fr.dist / refDistRef.current) - fr.time;
        } else {
            trackRef.current?.move('ghost', null, null);
            fr.delta = null;
        }
        trackRef.current?.move('ref', fr.x, fr.y);
        hudRef.current?.update(fr);
        timingRef.current?.update(fr);
        traceRef.current?.update(fr);
        deltaRef.current?.update(fr);
    }, []);

    const {
        isPlaying, play, pause, restart, currentSector, sectorTimes,
    } = useRaceLoop(telemetry, playbackSpeed, sectorBoundaries, officialSectorTimes, onFrame);

    // The brake meter's 100% mark is this lap's peak deceleration, not a
    // boolean — hand it to the HUD as soon as the circuit's data lands.
    useEffect(() => {
        const g = speedTrace?.pedal?.peakG;
        if (g) hudRef.current?.setPeakG(g);
    }, [speedTrace]);

    // The compared driver comes from the URL, so /compare/2023/1?vs=16 opens
    // straight into that head-to-head and the link survives a refresh.
    useEffect(() => {
        if (!comparing) { loadGhost(null); return; }
        if (!trackData) return;            // rotation not known yet
        if ((compareWith || null) !== (ghost?.number || null)) loadGhost(compareWith);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [comparing, compareWith, trackData, drivers.length]);

    // Scale the shift lights to the revs this lap actually uses. An F1 engine
    // never comes near zero on a flying lap, so a 0-to-redline strip sits almost
    // fully lit and tells you nothing.
    useEffect(() => {
        if (!telemetry?.length) return;
        let hi = 0;
        for (const f of telemetry) if (f.rpm > hi) hi = f.rpm;
        if (hi > 0) hudRef.current?.setRpmRange(hi * 0.75, hi);
    }, [telemetry]);

    const toggleTrace = useCallback(() => {
        setShowTrace((v) => {
            const next = !v;
            try { localStorage.setItem('pitwall.trace', next ? '1' : '0'); } catch { /* private mode */ }
            return next;
        });
    }, []);

    // The cars on track, as data. One entry on /lap, two on /compare — a race
    // replay is the same list with twenty. Drawn in order, so the car you are
    // following goes last and stays on top.
    // Memoised: a fresh array every render would defeat CarLayer's memo and
    // rebuild the markers while the lap is playing.
    // Lifting the colours out keeps the memo honest: it depends on exactly what
    // it uses, so no suppression is needed and the markers are only rebuilt when
    // a colour actually changes — not every time a new lap object arrives.
    const ghostColor = (comparing && ghost) ? ghost.color : null;
    const refColor = comparing ? (driver?.color || F1.red) : F1.red;
    const ghostCode = (comparing && ghost) ? ghost.code : null;
    const refCode = driver?.code || null;
    const cars = useMemo(() => [
        ...(ghostColor ? [{ id: 'ghost', color: ghostColor, shape: 'ring', label: ghostCode }] : []),
        { id: 'ref', color: refColor, shape: 'disc', label: refCode },
    ], [ghostColor, refColor, ghostCode, refCode]);

    const handleStart = useCallback(async () => {
        setHasPlayed(true);
        if (telemetry) { play(); return; }        // already loaded (resume/replay)
        setLoadingReplay(true);
        const ok = await loadReplay();
        setLoadingReplay(false);
        if (ok) play();
    }, [telemetry, loadReplay, play]);

    // Comparing needs BOTH laps to draw the delta across the circuit, so the
    // reference lap is fetched up front rather than on first play — otherwise
    // the delta chart is blank until you press the button, which is exactly
    // when you least need it.
    useEffect(() => {
        // trackData carries the circuit rotation, so nothing may be fetched
        // before it lands or the lap comes back unrotated.
        if (comparing && trackData && !telemetry && !loadingReplay) {
            setLoadingReplay(true);
            loadReplay().finally(() => setLoadingReplay(false));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [comparing, trackData, telemetry]);

    if (loading) {
        return <StageMessage variant="loading" title={raceName} />;
    }
    if (error) {
        return <StageMessage variant="error" title={raceName} message={error} onRetry={reload} />;
    }
    if (!mapLayout) return null;

    const started = hasPlayed;
    const finished = !isPlaying && sectorTimes.s3 != null;
    const drsCount = trackData?.drs_zones?.length || 0;

    const traceOpen = !!speedTrace && showTrace;
    const comparePanels = comparing ? (compareTrace?.panels?.length || 0) : 0;
    const showDeltaTrace = comparing && !!compareTrace?.deltaPath;

    // Both drivers' splits, as a full-width row under the map. In the left rail
    // this cost ~60px of column, and the column comes straight off the map.
    const sectorCompare = (comparing && driver && ghost) ? {
        a: { code: driver.code, color: driver.color, sectors: officialSectorTimes },
        b: { code: ghost.code, color: ghost.color, sectors: ghost.sectors },
    } : null;

    const L = stageLayout({
        narrow,
        traceOpen,
        hasPedal: !!speedTrace?.pedal,
        comparePanels,
        showDeltaTrace,
        hasSectorRow: !!sectorCompare,
        hasDeltaPanel: comparing && !!ghost,
    });

    // A head-to-head can't start until BOTH laps are in hand: pressing play with
    // only one loaded would replay the reference against nothing, and loading
    // the second mid-lap is exactly the stutter this app exists to avoid.
    const waitingForPick = comparing && !ghost && !ghostLoading;
    const busy = loadingReplay || ghostLoading || (comparing && !telemetry);
    const transport = {
        busy,
        disabled: busy || waitingForPick,
        icon: (busy || waitingForPick) ? null
            : isPlaying ? <Pause size={13} fill="currentColor" />
                : <Play size={13} fill="currentColor" />,
        label: waitingForPick ? 'SELECT A DRIVER'
            : ghostLoading ? 'LOADING DRIVER…'
                : busy ? 'LOADING LAP…'
                    : isPlaying ? 'PAUSE'
                        : !started ? 'START LAP' : finished ? 'REPLAY' : 'RESUME',
    };

    return (
        <div style={{ ...L.stage, background: F1.bg, border: `1px solid ${F1.line}` }}>
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
                    {raceName || trackData?.circuit}
                </span>

                {/* Which session's lap this is. Without it "fastest lap" is
                    ambiguous — Monaco's qualifying best and race best are 4.3s
                    and a different driver apart. */}
                <span style={{
                    padding: '3px 7px', fontSize: 9, fontWeight: 700,
                    letterSpacing: 1.2, textTransform: 'uppercase',
                    color: F1.text, background: F1.line, whiteSpace: 'nowrap',
                }}>
                    {SESSION_LABEL[session] || session}
                </span>
                {!narrow && !comparing && (
                    <span style={{ fontSize: 11, color: F1.dim, letterSpacing: 1.2 }}>
                        {driver
                            ? `FASTEST ${SESSION_LABEL[session] || ''} LAP · ${driver.code} · ${driver.team}`.toUpperCase()
                            // the badge beside the title already names the
                            // session, so this stays plain rather than reading
                            // "FASTEST LAP OF RACE"
                            : 'FASTEST LAP OF THE SESSION'}
                    </span>
                )}

                {comparing && (
                    <DriverPicker
                        slot="a"
                        value={driver?.number || ''}
                        drivers={drivers}
                        exclude={ghost?.number}
                        color={driver?.color}
                        loading={!driver}
                        onChange={onPickDriver}
                    />
                )}

                {comparing && (
                    <DriverPicker
                        slot="b"
                        value={ghost?.number || ''}
                        drivers={drivers}
                        exclude={driver?.number}
                        color={ghost?.color}
                        loading={ghostLoading}
                        placeholder="— compare a driver —"
                        prefix="VS"
                        onChange={onPickDriver}
                    />
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                    {mapLayout.speedSegments?.length > 0 && (
                        <div style={{ display: 'flex', gap: 1, background: F1.line }}>
                            {[['map', 'MAP'], ['speed', 'SPEED']].map(([id, lbl]) => (
                                <button
                                    key={id}
                                    onClick={() => setView(id)}
                                    style={{
                                        padding: '6px 10px', border: 'none', cursor: 'pointer',
                                        fontSize: 10, fontWeight: 700, letterSpacing: 1,
                                        background: view === id ? F1.text : F1.bg,
                                        color: view === id ? F1.bg : F1.dim,
                                    }}
                                >
                                    {lbl}
                                </button>
                            ))}
                        </div>
                    )}
                    {speedTrace && (
                        <button
                            onClick={toggleTrace}
                            title={showTrace ? 'Hide the speed trace' : 'Show the speed trace'}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '6px 10px', cursor: 'pointer',
                                fontSize: 10, fontWeight: 700, letterSpacing: 1,
                                background: showTrace ? F1.text : F1.bg,
                                color: showTrace ? F1.bg : F1.dim,
                                border: `1px solid ${showTrace ? F1.text : F1.line}`,
                            }}
                        >
                            <Activity size={12} />
                            TRACE
                        </button>
                    )}
                    <MapControls playbackSpeed={playbackSpeed} setPlaybackSpeed={setPlaybackSpeed} />
                </div>
            </div>

            <SectorTiming
                ref={timingRef}
                sectorTimes={sectorTimes}
                currentSector={currentSector}
                visible={started}
                narrow={narrow}
                compare={sectorCompare}
            />

            {/* map + car — inset so nothing sits on top of the track */}
            <div style={{
                position: 'absolute', left: L.timingSpace, right: 0,
                top: L.mapTop, bottom: L.mapBottom,
            }}>
                <TrackCanvas ref={trackRef} mapLayout={mapLayout} view={view} cars={cars} />
            </div>

            {/* legend — desktop only, it crowds a phone */}
            {!narrow && view === 'speed' && mapLayout.speedRange && (
                <div style={{
                    position: 'absolute', right: 22, top: 60, zIndex: 12,
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5,
                }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.3, color: F1.dim }}>
                        SPEED
                    </span>
                    <div style={{ width: 132, height: 6, background: SPEED_GRADIENT }} />
                    <div style={{
                        width: 132, display: 'flex', justifyContent: 'space-between',
                        fontFamily: MONO, fontSize: 10, color: F1.dim,
                    }}>
                        <span>{Math.round(mapLayout.speedRange.min)}</span>
                        <span>{Math.round(mapLayout.speedRange.max)} km/h</span>
                    </div>
                </div>
            )}
            {!narrow && view === 'map' && drsCount > 0 && (
                <div style={{
                    position: 'absolute', right: 22, top: 62, zIndex: 12,
                    display: 'flex', alignItems: 'center', gap: 8,
                }}>
                    <span style={{ width: 16, height: 2, background: F1.drs }} />
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.3, color: F1.dim }}>
                        DRS ZONE{drsCount > 1 ? `S · ${drsCount}` : ''}
                    </span>
                </div>
            )}

            {traceOpen && (
                <div style={{
                    position: 'absolute', left: narrow ? 14 : 26, right: narrow ? 14 : 26,
                    bottom: L.hudSpace - (narrow ? 4 : 8), zIndex: 11,
                }}>
                    {L.sectorRow > 0 && (
                        <div style={{ marginBottom: L.sectorGap }}>
                            <SectorCompare
                                compare={sectorCompare}
                                sectorTimes={sectorTimes}
                                currentSector={currentSector}
                                narrow={narrow}
                            />
                        </div>
                    )}

                    <SpeedTrace
                        ref={traceRef} trace={speedTrace} narrow={narrow}
                        height={L.traceH} pedalHeight={L.pedalH}
                        compare={comparing ? compareTrace : null}
                        deltaHeight={showDeltaTrace ? L.deltaH : 0}
                    />
                </div>
            )}

            {comparing && ghost && (
                <div style={{
                    position: 'absolute', zIndex: 13,
                    ...(narrow
                        ? { top: 92, left: 14, right: 14 }
                        : { top: 244, left: 24, width: 190 }),
                }}>
                    <DeltaBar
                        ref={deltaRef}
                        reference={driver || null}
                        ghost={ghost}
                        narrow={narrow}
                    />
                </div>
            )}

            <TelemetryHUD ref={hudRef} narrow={narrow} />

            <Transport
                state={transport}
                bottom={L.bottomSpace + 8}
                error={replayError}
                isPlaying={isPlaying}
                onToggle={isPlaying ? pause : handleStart}
                onRestart={restart}
                canRestart={started && !finished}
            />
        </div>
    );
};


// NOTE: not `ghost` — that name is taken inside the component by the compared
// driver, which shadowed this style and was handed to the button as its CSS.

export default TrackMap;
