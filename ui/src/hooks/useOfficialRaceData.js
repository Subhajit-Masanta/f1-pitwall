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

// x' = x·cosθ - y·sinθ ,  y' = x·sinθ + y·cosθ
const applyRotation = (x, y, angleDeg) => {
    const a = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
};

export const useOfficialRaceData = (year, round, session) => {
    const [trackData, setTrackData] = useState(null);
    const [telemetry, setTelemetry] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sectorBoundaries, setSectorBoundaries] = useState(null);
    const [officialSectorTimes, setOfficialSectorTimes] = useState(null);
    const [driver, setDriver] = useState(null);

    // 1. Fetch the track outline and pre-rotate it. The backend now also gives us
    //    the sector-boundary distances, so the coloured map works before playback.
    useEffect(() => {
        if (!year || !round) return;

        setTrackData(null);
        setTelemetry(null);
        setSectorBoundaries(null);
        setOfficialSectorTimes(null);
        setDriver(null);
        setLoading(true);

        let cancelled = false;
        (async () => {
            try {
                const data = await raceService.getTrackData(year, round, session || 'R');
                if (cancelled) return;

                const angle = data.rotation || 0;
                data.track_points = (data.track_points || []).map((p) => {
                    const r = applyRotation(p.X, p.Y, angle);
                    return { X: r.x, Y: r.y, D: p.D ?? 0 };
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
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [year, round, session]);

    // 2. Fetch the fastest-lap telemetry (on demand) and pre-rotate it.
    const loadReplay = useCallback(async () => {
        if (telemetry) return;
        try {
            // 'fastest' = whoever set the quickest lap of this session.
            const data = await raceService.getTelemetry(year, round, session || 'R', 'fastest');
            if (!data.telemetry) return;
            setDriver({
                code: data.driver_code,
                name: data.driver_name,
                team: data.team,
                lapTime: data.lap_time,
            });

            const angle = trackData?.rotation || 0;
            const rotated = data.telemetry.map((p) => {
                const r = applyRotation(p.x, p.y, angle);
                return { ...p, x: r.x, y: r.y };
            });

            setTelemetry(rotated);
            // Prefer the boundaries we already have from the track call; fall back
            // to the telemetry call's own analysis.
            if (!sectorBoundaries && data.sector_boundaries) setSectorBoundaries(data.sector_boundaries);
            if (data.sector_times) setOfficialSectorTimes(data.sector_times);
        } catch (err) {
            console.error('Failed to load telemetry', err);
        }
    }, [telemetry, trackData, sectorBoundaries, year, round, session]);

    // 3. Everything geometric the map needs, derived once per track.
    const mapLayout = useMemo(() => {
        if (!trackData?.track_points?.length) return null;

        const pts = trackData.track_points
            .filter((p) => Number.isFinite(p.X) && Number.isFinite(p.Y))
            .map((p) => ({ x: p.X, y: -p.Y, d: p.D })); // flip Y for SVG

        if (pts.length < 2) return null;

        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const width = maxX - minX;
        const height = maxY - minY;

        const pad = Math.max(width, height) * 0.07;
        const viewBox = `${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`;
        const mapSize = Math.hypot(width, height);

        const toPath = (arr) => (arr.length > 1
            ? `M ${arr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`
            : '');
        const d = `${toPath(pts)} Z`;

        const idxNearest = (dist) => {
            let bi = 0, bd = Infinity;
            for (let i = 0; i < pts.length; i++) {
                const g = Math.abs(pts[i].d - dist);
                if (g < bd) { bd = g; bi = i; }
            }
            return bi;
        };
        const nearest = (dist) => pts[idxNearest(dist)];

        // Unit tangent at a point index (for perpendicular tick marks).
        const tangentAt = (i) => {
            const a = pts[Math.max(0, i - 2)];
            const b2 = pts[Math.min(pts.length - 1, i + 2)];
            const dx = b2.x - a.x, dy = b2.y - a.y;
            const m = Math.hypot(dx, dy) || 1;
            return { x: dx / m, y: dy / m };
        };

        // A short line across the track at a given lap distance.
        const tickAt = (dist, len) => {
            const i = idxNearest(dist);
            const p = pts[i];
            const t = tangentAt(i);
            return {
                x1: p.x - t.y * len, y1: p.y + t.x * len,
                x2: p.x + t.y * len, y2: p.y - t.x * len,
                // label anchor, pushed to the outside of the track
                lx: p.x - t.y * len * 2.1, ly: p.y + t.x * len * 2.1,
            };
        };

        const tickLen = mapSize * 0.016;
        const b = sectorBoundaries;
        const ticks = { start: tickAt(0, tickLen * 1.15) };
        if (b) {
            ticks.s1 = tickAt(b.sector1_end, tickLen);
            ticks.s2 = tickAt(b.sector2_end, tickLen);
        }

        // DRS zones as their own overlay sub-paths.
        const drsPaths = (trackData.drs_zones || [])
            .map((z) => {
                const seg = pts.filter((p) => p.d >= z.start && p.d <= z.end);
                if (seg.length < 2) return null;
                const mid = seg[Math.floor(seg.length / 2)];
                return { d: toPath(seg), mid };
            })
            .filter(Boolean);

        // Corner numbers, pushed outward from the track centroid.
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const corners = (trackData.corners || []).map((c) => {
            const x = c.X, y = -c.Y;
            const vx = x - cx, vy = y - cy;
            const m = Math.hypot(vx, vy) || 1;
            const off = mapSize * 0.035;
            return { n: c.n, letter: c.letter, x, y, lx: x + (vx / m) * off, ly: y + (vy / m) * off };
        });

        return { viewBox, d, mapSize, ticks, drsPaths, corners, hasSectors: !!b };
    }, [trackData, sectorBoundaries]);

    return {
        trackData,
        mapLayout,
        telemetry,
        loading,
        loadReplay,
        sectorBoundaries,
        officialSectorTimes,
        driver,
    };
};
