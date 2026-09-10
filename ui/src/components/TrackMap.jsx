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
import { F1 } from '../theme';

import MapControls from './Track/MapControls';
import TrackCanvas from './Track/TrackCanvas';
import TelemetryHUD from './TelemetryHUD';
import SectorTiming from './SectorTiming';

const TrackMap = ({ year, round, session, raceName }) => {
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    const trackRef = useRef(null);
    const hudRef = useRef(null);
    const timingRef = useRef(null);

    const {
        trackData, mapLayout, telemetry, loading,
        loadReplay, sectorBoundaries, officialSectorTimes, driver,
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

    const handleStart = useCallback(() => { loadReplay(); play(); }, [loadReplay, play]);

    if (loading) {
        return (
            <div style={stage}>
                <div style={{ margin: 'auto', color: F1.dim, fontSize: 12, letterSpacing: 3 }}>
                    LOADING CIRCUIT
                </div>
            </div>
        );
    }
    if (!mapLayout) return null;

    const started = !!telemetry;
    const finished = !isPlaying && sectorTimes.s3 != null;
    const drsCount = trackData?.drs_zones?.length || 0;

    return (
        <div style={stage}>
            {/* header */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, zIndex: 14,
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '16px 22px',
            }}>
                <span style={{ width: 3, height: 16, background: F1.red }} />
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase' }}>
                    {raceName || trackData?.circuit}
                </span>
                <span style={{ fontSize: 10, color: F1.dim, letterSpacing: 2 }}>
                    {driver
                        ? `FASTEST LAP · ${driver.code} · ${driver.team}`.toUpperCase()
                        : 'FASTEST LAP OF THE SESSION'}
                </span>
                <div style={{ marginLeft: 'auto' }}>
                    <MapControls playbackSpeed={playbackSpeed} setPlaybackSpeed={setPlaybackSpeed} />
                </div>
            </div>

            <SectorTiming
                ref={timingRef}
                sectorTimes={sectorTimes}
                currentSector={currentSector}
                visible={started}
            />

            {/* map + car — inset so nothing sits on top of the track */}
            <div style={{ position: 'absolute', top: 46, left: 0, right: 0, bottom: 150 }}>
                <TrackCanvas ref={trackRef} mapLayout={mapLayout} />
            </div>

            {/* DRS legend */}
            {drsCount > 0 && (
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

            <TelemetryHUD ref={hudRef} />

            {/* transport */}
            <div style={{
                position: 'absolute', bottom: 98, left: '50%', transform: 'translateX(-50%)',
                zIndex: 16, display: 'flex', gap: 8, alignItems: 'center',
            }}>
                <button onClick={isPlaying ? pause : handleStart} style={btn}>
                    {isPlaying
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
    );
};

const stage = {
    position: 'relative',
    width: '100%',
    height: '78vh',
    background: F1.bg,
    border: `1px solid ${F1.line}`,
    overflow: 'hidden',
    display: 'flex',
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
