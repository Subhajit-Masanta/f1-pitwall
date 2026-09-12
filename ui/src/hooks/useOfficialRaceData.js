/**
 * 📄 useOfficialRaceData.js
 *
 * 📐 Loads the track layout + the driver's fastest-lap telemetry, applies the
 * official FastF1 circuit rotation to both, and derives everything the map
 * needs: the viewBox, the full track path, and the three sector-coloured
 * sub-paths (F1 TV style).
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { raceService } from '../services/raceService';
import { buildGhost } from '../lib/ghost';
import { applyRotation, rotateFrames } from '../lib/geometry/rotation';
import { buildMapLayout } from '../lib/geometry/track';
import { buildSpeedTrace } from '../lib/geometry/traces';
import { buildCompareTrace } from '../lib/geometry/compare';

/** Turn an axios failure into something a person can read. */
const friendlyError = (err) => {
    if (err?.code === 'ECONNABORTED') {
        return 'The server took too long to respond. It may be waking up from sleep — give it a moment and try again.';
    }
    if (err && !err.response) {
        return 'Can’t reach the server. Check your connection and try again.';
    }
    const status = err?.response?.status;
    if (status >= 500) return 'The server hit an error loading this session.';
    return err?.message || 'Something went wrong.';
};



export const useOfficialRaceData = (year, round, session, referenceDriver = null) => {
    const [trackData, setTrackData] = useState(null);
    const [telemetry, setTelemetry] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sectorBoundaries, setSectorBoundaries] = useState(null);
    const [officialSectorTimes, setOfficialSectorTimes] = useState(null);
    const [driver, setDriver] = useState(null);
    const [drivers, setDrivers] = useState([]);          // head-to-head picker
    const [ghost, setGhost] = useState(null);            // the compared driver
    const [ghostLoading, setGhostLoading] = useState(false);
    const [error, setError] = useState(null);        // track-load failure/empty
    const [replayError, setReplayError] = useState(null);  // telemetry-load failure/empty
    const [reloadKey, setReloadKey] = useState(0);

    // 1. Fetch the track outline and pre-rotate it. The backend now also gives us
    //    the sector-boundary distances, so the coloured map works before playback.
    useEffect(() => {
        if (!year || !round) return;

        setTrackData(null);
        setTelemetry(null);
        setSectorBoundaries(null);
        setOfficialSectorTimes(null);
        setDriver(null);
        setDrivers([]);
        setGhost(null);
        setError(null);
        setReplayError(null);
        setLoading(true);

        let cancelled = false;
        (async () => {
            try {
                const data = await raceService.getTrackData(year, round, session || 'R');
                if (cancelled) return;
                if (data.error || !(data.track_points || []).length) {
                    setError(data.error || 'No track data available for this session.');
                    return;
                }

                const angle = data.rotation || 0;
                data.track_points = (data.track_points || []).map((p) => {
                    const r = applyRotation(p.X, p.Y, angle);
                    // keep D (lap distance) and S (speed) — rotation only moves X/Y
                    return { X: r.x, Y: r.y, D: p.D ?? 0, S: p.S, T: p.T, A: p.A };
                });
                data.corners = (data.corners || []).map((c) => {
                    const r = applyRotation(c.X, c.Y, angle);
                    return { ...c, X: r.x, Y: r.y };
                });

                setTrackData(data);
                if (data.sector1_end != null && data.sector2_end != null) {
                    setSectorBoundaries({
                        sector1_end: data.sector1_end,
                        sector2_end: data.sector2_end,
                        total_distance: data.total_distance,
                    });
                }
            } catch (err) {
                console.error('Error loading track:', err);
                if (!cancelled) setError(friendlyError(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [year, round, session, reloadKey]);

    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    // 2. Fetch the fastest-lap telemetry (on demand) and pre-rotate it.
    const loadReplay = useCallback(async () => {
        if (telemetry) return true;
        // Rotation lives on trackData. Fetching before it lands silently yields
        // an UNROTATED lap — the car then drives a path rotated away from the
        // circuit and appears off-track. Refuse rather than produce that.
        if (!trackData) return false;
        setReplayError(null);
        try {
            // The reference is whoever was picked; 'fastest' (the session's
            // quickest) is the default when no one has been chosen yet.
            const data = await raceService.getTelemetry(
                year, round, session || 'R', referenceDriver || 'fastest',
            );
            if (data.error || !data.telemetry) {
                setReplayError(data.error || 'This session has no lap telemetry to replay.');
                return false;
            }
            setDriver({
                number: String(data.driver),
                code: data.driver_code,
                name: data.driver_name,
                team: data.team,
                color: data.team_color || '#9E9E9E',
                lapTime: data.lap_seconds,
            });

            setTelemetry(rotateFrames(data.telemetry, trackData.rotation || 0));
            // Prefer the boundaries we already have from the track call; fall back
            // to the telemetry call's own analysis.
            if (!sectorBoundaries && data.sector_boundaries) setSectorBoundaries(data.sector_boundaries);
            if (data.sector_times) setOfficialSectorTimes(data.sector_times);
            return true;
        } catch (err) {
            console.error('Failed to load telemetry', err);
            setReplayError(friendlyError(err));
            return false;
        }
    }, [telemetry, trackData, sectorBoundaries, year, round, session, referenceDriver]);

    // 2b. Who else was out there — fetched with the circuit so the picker is
    //     populated before anyone presses play.
    useEffect(() => {
        if (!year || !round) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await raceService.getDrivers(year, round, session || 'R');
                if (cancelled || data.error) return;
                setDrivers(data.drivers || []);
            } catch (err) {
                // A missing driver list only costs the compare picker, so it
                // must never take the replay down with it.
                console.warn('Driver list unavailable', err);
            }
        })();
        return () => { cancelled = true; };
    }, [year, round, session, reloadKey]);

    /**
     * Load (or clear) the driver being compared against. Pass null to clear.
     * The ghost is a plain object, not React state on the hot path — the loop
     * reads it every frame and never re-renders.
     */
    const loadGhost = useCallback(async (number) => {
        if (!number) { setGhost(null); return true; }
        if (!trackData) return false;      // same rotation dependency as above
        setGhostLoading(true);
        try {
            const data = await raceService.getTelemetry(year, round, session || 'R', number);
            if (data.error || !data.telemetry) {
                setGhost(null);
                return false;
            }
            const meta = drivers.find((d) => d.number === String(number));
            const built = buildGhost(
                rotateFrames(data.telemetry, trackData.rotation || 0),
                {
                    number: String(number),
                    code: data.driver_code,
                    name: data.driver_name,
                    team: data.team,
                    color: data.team_color || meta?.color || '#9E9E9E',
                    // lap_time is a formatted string; lap_seconds is the number
                    lapTime: data.lap_seconds,
                    gap: meta?.gap,
                    // official splits, so the rail can show both drivers' sectors
                    sectors: data.sector_times || null,
                },
            );
            setGhost(built);
            return !!built;
        } catch (err) {
            console.error('Failed to load comparison driver', err);
            setGhost(null);
            return false;
        } finally {
            setGhostLoading(false);
        }
    }, [year, round, session, trackData, drivers]);

    // 3. Everything geometric the map needs, derived once per track.
    const mapLayout = useMemo(
        () => buildMapLayout(trackData, sectorBoundaries),
        [trackData, sectorBoundaries],
    );

    // 4. Speed-vs-distance trace. Built from the track outline (which already
    //    carries D and S), so it's on screen as soon as the circuit loads rather
    //    than waiting for the telemetry fetch.
    //    Drawn in a fixed 1000x100 viewBox and stretched with
    //    preserveAspectRatio="none" — that makes distance→x a trivial ratio and
    //    keeps it resolution-independent.
    const speedTrace = useMemo(
        () => buildSpeedTrace(trackData, sectorBoundaries),
        [trackData, sectorBoundaries],
    );

    // 5. Head-to-head geometry: the ghost's traces drawn over the reference's,
    //    plus the delta across the whole lap.
    //
    //    Both drivers are plotted against their OWN lap fraction rather than
    //    absolute metres — their laps don't measure identically, and fraction is
    //    what makes the delta land on the official gap at the flag.
    const refLookup = useMemo(
        () => (telemetry?.length ? buildGhost(telemetry, {}) : null),
        [telemetry],
    );

    const compareTrace = useMemo(
        () => buildCompareTrace({ driver, ghost, refLookup, speedTrace }),
        [driver, ghost, refLookup, speedTrace],
    );

    return {
        trackData,
        mapLayout,
        speedTrace,
        compareTrace,
        telemetry,
        loading,
        error,
        reload,
        loadReplay,
        replayError,
        sectorBoundaries,
        officialSectorTimes,
        driver,
        drivers,
        ghost,
        ghostLoading,
        loadGhost,
    };
};
