/**
 * 📄 TrackMap.jsx — the broadcast replay stage (orchestrator).
 *
 * Wires the data hook to the animation loop, and fans each frame out to three
 * imperative children (car, HUD, timing) so playback never re-renders.
 */
import React, { useState, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';

import { useOfficialRaceData } from '../hooks/useOfficialRaceData';
import { useRaceLoop } from '../hooks/useRaceLoop';
import { useIsNarrow } from '../hooks/useResponsive';
import { F1 } from '../theme';

import MapControls from './Track/MapControls';
import TrackCanvas from './Track/TrackCanvas';
import TelemetryHUD from './TelemetryHUD';
import SectorTiming from './SectorTiming';
import StageMessage from './StageMessage';

const TrackMap = ({ year, round, session, raceName }) => {
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [loadingReplay, setLoadingReplay] = useState(false);
    const narrow = useIsNarrow(720);

    const trackRef = useRef(null);
    const hudRef = useRef(null);
    const timingRef = useRef(null);

    const {
        trackData, mapLayout, telemetry, loading, error, reload,
        loadReplay, replayError, sectorBoundaries, officialSectorTimes, driver,
    } = useOfficialRaceData(year, round, session);

    // Every animation frame — pure DOM writes, zero React.
    const onFrame = useCallback((fr) => {
        trackRef.current?.moveCar(fr.x, fr.y);
        hudRef.current?.update(fr);
        timingRef.current?.update(fr);
    }, []);

    const {
        isPlaying, play, pause, restart, currentSector, sectorTimes,
    } = useRaceLoop(telemetry, playbackSpeed, sectorBoundaries, officialSectorTimes, onFrame);

    const handleStart = useCallback(async () => {
        if (telemetry) { play(); return; }        // already loaded (resume/replay)
        setLoadingReplay(true);
        const ok = await loadReplay();
        setLoadingReplay(false);
        if (ok) play();
    }, [telemetry, loadReplay, play]);

    if (loading) {
        return <StageMessage variant="loading" title={raceName} />;
    }
    if (error) {
        return <StageMessage variant="error" title={raceName} message={error} onRetry={reload} />;
    }
    if (!mapLayout) return null;

    const started = !!telemetry;
    const finished = !isPlaying && sectorTimes.s3 != null;
    const drsCount = trackData?.drs_zones?.length || 0;

    const stage = {
        position: 'relative', width: '100%',
        height: narrow ? '68vh' : '78vh', minHeight: narrow ? 440 : 520,
        background: F1.bg, border: `1px solid ${F1.line}`,
        overflow: 'hidden', display: 'flex',
    };
    // Room to reserve for the bottom HUD strip.
    const hudSpace = narrow ? 180 : 150;

    return (
        <div style={stage}>
            {/* header */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, zIndex: 14,
                display: 'flex', alignItems: 'center', gap: narrow ? 8 : 14,
                flexWrap: 'wrap', padding: narrow ? '12px 14px' : '16px 22px',
            }}>
                <span style={{ width: 3, height: 16, background: F1.red }} />
                <span style={{
                    fontSize: narrow ? 11 : 13, fontWeight: 700,
                    letterSpacing: narrow ? 1.5 : 2.5, textTransform: 'uppercase',
                }}>
                    {raceName || trackData?.circuit}
                </span>
                {!narrow && (
                    <span style={{ fontSize: 10, color: F1.dim, letterSpacing: 2 }}>
                        {driver
                            ? `FASTEST LAP · ${driver.code} · ${driver.team}`.toUpperCase()
                            : 'FASTEST LAP OF THE SESSION'}
                    </span>
                )}
                <div style={{ marginLeft: 'auto' }}>
                    <MapControls playbackSpeed={playbackSpeed} setPlaybackSpeed={setPlaybackSpeed} />
                </div>
            </div>

            <SectorTiming
                ref={timingRef}
                sectorTimes={sectorTimes}
                currentSector={currentSector}
                visible={started}
                narrow={narrow}
            />

            {/* map + car — inset so nothing sits on top of the track */}
            <div style={{
                position: 'absolute', left: 0, right: 0,
                top: narrow ? 90 : 46, bottom: hudSpace,
            }}>
                <TrackCanvas ref={trackRef} mapLayout={mapLayout} />
            </div>

            {/* DRS legend — desktop only, it crowds a phone */}
            {drsCount > 0 && !narrow && (
                <div style={{
                    position: 'absolute', right: 22, top: 62, zIndex: 12,
                    display: 'flex', alignItems: 'center', gap: 8,
                }}>
                    <span style={{ width: 16, height: 2, background: F1.drs }} />
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.8, color: F1.dim }}>
                        DRS ZONE{drsCount > 1 ? `S · ${drsCount}` : ''}
                    </span>
                </div>
            )}

            <TelemetryHUD ref={hudRef} narrow={narrow} />

            {/* transport */}
            <div style={{
                position: 'absolute', bottom: hudSpace - 44, left: '50%',
                transform: 'translateX(-50%)', zIndex: 16,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}>
                {replayError && (
                    <div style={{
                        fontSize: 10, color: F1.red, letterSpacing: 0.5,
                        maxWidth: 260, textAlign: 'center',
                    }}>
                        {replayError}
                    </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                        onClick={isPlaying ? pause : handleStart}
                        disabled={loadingReplay}
                        style={{ ...btn, opacity: loadingReplay ? 0.6 : 1, cursor: loadingReplay ? 'wait' : 'pointer' }}
                    >
                        {loadingReplay
                            ? 'LOADING LAP…'
                            : isPlaying
                                ? <><Pause size={13} fill="currentColor" /> PAUSE</>
                                : <><Play size={13} fill="currentColor" /> {!started ? 'START LAP' : finished ? 'REPLAY' : 'RESUME'}</>}
                    </button>
                    {started && !isPlaying && !finished && (
                        <button onClick={restart} style={ghost} title="Restart lap">
                            <RotateCcw size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const btn = {
    display: 'flex', alignItems: 'center', gap: 8,
    background: F1.red, color: '#fff', border: 'none',
    padding: '9px 20px', cursor: 'pointer',
    fontSize: 11, fontWeight: 700, letterSpacing: 2,
};

const ghost = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 34, height: 34,
    background: 'transparent', color: F1.dim,
    border: `1px solid ${F1.line}`, cursor: 'pointer',
};

export default TrackMap;
