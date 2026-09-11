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
        setReplayError(null);
        try {
            // 'fastest' = whoever set the quickest lap of this session.
            const data = await raceService.getTelemetry(year, round, session || 'R', 'fastest');
            if (data.error || !data.telemetry) {
                setReplayError(data.error || 'This session has no lap telemetry to replay.');
                return false;
            }
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
            return true;
        } catch (err) {
            console.error('Failed to load telemetry', err);
            setReplayError(friendlyError(err));
            return false;
        }
    }, [telemetry, trackData, sectorBoundaries, year, round, session]);

    // 3. Everything geometric the map needs, derived once per track.
    const mapLayout = useMemo(() => {
        if (!trackData?.track_points?.length) return null;

        const pts = trackData.track_points
            .filter((p) => Number.isFinite(p.X) && Number.isFinite(p.Y))
            .map((p) => ({ x: p.X, y: -p.Y, d: p.D, s: p.S })); // flip Y for SVG

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
        // Corner numbers.
        //
        // Pushing them away from the track CENTROID (the obvious approach) only
        // works on a roughly convex circuit. Monza is two long straights and a
        // couple of loops, so "away from the centre" points straight back across
        // the tarmac for half the corners — numbers landed on the racing line.
        //
        // Instead: take the track's tangent at the corner, step along its normal,
        // and pick whichever side is genuinely emptier by testing how far each
        // candidate sits from the nearest piece of track. Then nudge outward
        // (never drop) until it clears any label already placed.
        const off = mapSize * 0.038;
        const minGap = mapSize * 0.030;

        // distance from a point to the nearest track point
        const clearance = (px, py) => {
            let best = Infinity;
            for (let i = 0; i < pts.length; i += 2) {     // every 2nd point is plenty
                const dx = pts[i].x - px, dy = pts[i].y - py;
                const d2 = dx * dx + dy * dy;
                if (d2 < best) best = d2;
            }
            return Math.sqrt(best);
        };

        const nearestIdx = (px, py) => {
            let bi = 0, bd = Infinity;
            for (let i = 0; i < pts.length; i++) {
                const dx = pts[i].x - px, dy = pts[i].y - py;
                const d2 = dx * dx + dy * dy;
                if (d2 < bd) { bd = d2; bi = i; }
            }
            return bi;
        };

        // Seed the collision set with the sector-tick labels. They are drawn in
        // the same space as the corner numbers, so without this a corner can end
        // up hidden underneath "S1"/"S2" — Bahrain's turn 5 did exactly that.
        const placed = [];
        for (const t of [ticks.s1, ticks.s2, ticks.start]) {
            if (t) placed.push({ lx: t.lx, ly: t.ly });
        }

        const corners = (trackData.corners || []).map((c) => {
            const x = c.X, y = -c.Y;
            const i = nearestIdx(x, y);
            const t = tangentAt(i);
            const nx = -t.y, ny = t.x;             // unit normal to the track here

            // Walk outward from the corner, trying both sides at each step, and
            // take the first spot that clears both the track and every label
            // already placed. Nearest-acceptable, not furthest: maximising
            // clearance flings numbers into open infield far from the corner
            // they name. If nothing is ever clean, keep the least-bad option.
            const needClear = off * 0.75;
            let best = null, bestScore = -Infinity;
            outer:
            for (const mult of [1, 1.35, 1.75, 2.2]) {
                for (const sign of [1, -1]) {
                    const lx = x + nx * off * sign * mult;
                    const ly = y + ny * off * sign * mult;
                    const clear = clearance(lx, ly);
                    const crowded = placed.some((q) => Math.hypot(q.lx - lx, q.ly - ly) < minGap);
                    if (clear >= needClear && !crowded) { best = { lx, ly }; break outer; }
                    const score = clear - (crowded ? minGap * 2 : 0) - off * (mult - 1);
                    if (score > bestScore) { bestScore = score; best = { lx, ly }; }
                }
            }
            const bx = best.lx, by = best.ly;
            const pt = { n: c.n, letter: c.letter, x, y, lx: bx, ly: by };
            placed.push(pt);
            return pt;
        });

        // Speed-coloured racing line: chop the outline into short runs and give
        // each the colour of its mean speed. Segments overlap by one point so
        // there's no visible seam. Static — built once, never during playback.
        let speedSegments = [];
        let speedRange = null;
        const speeds = pts.map((p) => p.s).filter((v) => Number.isFinite(v));
        if (speeds.length === pts.length && speeds.length > 1) {
            const lo = Math.min(...speeds);
            const hi = Math.max(...speeds);
            const span = hi - lo || 1;
            speedRange = { min: lo, max: hi };

            const RUN = 3;
            for (let i = 0; i < pts.length - 1; i += RUN) {
                const chunk = pts.slice(i, Math.min(i + RUN + 1, pts.length));
                if (chunk.length < 2) continue;
                const mean = chunk.reduce((a, q) => a + q.s, 0) / chunk.length;
                speedSegments.push({ d: toPath(chunk), t: (mean - lo) / span });
            }
            // close the loop back to the start/finish point
            const tail = [pts[pts.length - 1], pts[0]];
            const meanTail = (tail[0].s + tail[1].s) / 2;
            speedSegments.push({ d: toPath(tail), t: (meanTail - lo) / span });
        }

        return {
            viewBox, d, mapSize, ticks, drsPaths, corners,
            hasSectors: !!b, speedSegments, speedRange,
        };
    }, [trackData, sectorBoundaries]);

    // 4. Speed-vs-distance trace. Built from the track outline (which already
    //    carries D and S), so it's on screen as soon as the circuit loads rather
    //    than waiting for the telemetry fetch.
    //    Drawn in a fixed 1000x100 viewBox and stretched with
    //    preserveAspectRatio="none" — that makes distance→x a trivial ratio and
    //    keeps it resolution-independent.
    const speedTrace = useMemo(() => {
        const pts = (trackData?.track_points || [])
            .filter((p) => Number.isFinite(p.D) && Number.isFinite(p.S));
        if (pts.length < 2) return null;

        const W = 1000, H = 100;
        const total = trackData.total_distance || pts[pts.length - 1].D || 1;
        const maxS = Math.max(...pts.map((p) => p.S)) || 1;
        const minS = Math.min(...pts.map((p) => p.S));

        const x = (d) => (d / total) * W;
        const y = (sp) => H - (sp / maxS) * H;

        const line = `M ${pts.map((p) => `${x(p.D).toFixed(1)},${y(p.S).toFixed(1)}`).join(' L ')}`;
        const area = `${line} L ${W},${H} L 0,${H} Z`;

        const b = sectorBoundaries;
        const sectorX = b ? [x(b.sector1_end), x(b.sector2_end)] : [];
        const drsBars = (trackData.drs_zones || [])
            .map((z) => ({ x1: x(z.start), x2: x(z.end) }))
            .filter((z) => z.x2 > z.x1);

        // Braking: redraw just those stretches of the trace in red, on top of
        // the white line. Far more readable than another band of bars — you see
        // the brake point land exactly where the speed starts to fall off.
        const brakePaths = (trackData.brake_zones || [])
            .map((z) => {
                const seg = pts.filter((p) => p.D >= z.start && p.D <= z.end);
                if (seg.length < 2) return null;
                return `M ${seg.map((p) => `${x(p.D).toFixed(1)},${y(p.S).toFixed(1)}`).join(' L ')}`;
            })
            .filter(Boolean);

        // --- pedals ------------------------------------------------------
        // Throttle owns the FULL height of the band, not half of it. A quali
        // lap sits at 100% throttle ~70% of the time, so a half-height area
        // renders as a solid slab with notches — all ink, no information. Over
        // the full height each lift travels twice as far and the shape reads as
        // a trace again.
        //
        // Braking is a translucent column standing behind the trace rather than
        // a mirrored area below it: FastF1's Brake channel is boolean (on/off,
        // no pressure), so it has no magnitude to plot — what matters is WHERE
        // it is and how it overlaps the throttle coming back on.
        const PH = 100;                       // pedal viewBox height
        const PAD = 2;                        // keeps the stroke off both edges
        const tp = pts.filter((p) => Number.isFinite(p.T));
        let throttleArea = null, throttleLine = null;
        if (tp.length > 1) {
            const yT = (t) => PAD + (1 - Math.max(0, Math.min(100, t)) / 100) * (PH - PAD * 2);
            const seq = tp.map((p) => `${x(p.D).toFixed(1)},${yT(p.T).toFixed(1)}`).join(' L ');
            throttleLine = `M ${seq}`;
            throttleArea = `${throttleLine} L ${W},${PH} L 0,${PH} Z`;
        }
        // Braking, as actual magnitude rather than an on/off block.
        //
        // Two channels combined, each doing the job it can honestly do:
        //   · brake_zones says WHETHER the pedal is pressed (FastF1's Brake is
        //     boolean, so that is all it can tell us)
        //   · longitudinal g says HOW HARD, because deceleration is measured
        //
        // Gating the g trace by the zones means a lift-and-coast doesn't draw as
        // braking, and the shape inside a zone is the real one: a spike at the
        // brake point bleeding off into the apex. Filling THIS trace is safe
        // where filling throttle wasn't — braking is zero for most of a lap, so
        // the fill reads as discrete peaks instead of a slab.
        const peakG = trackData.peak_decel_g || 5;
        const zones = trackData.brake_zones || [];
        const inZone = (d) => zones.some((z) => d >= z.start && d <= z.end);
        // One shape per zone rather than a single trace across the lap — a
        // continuous line would sit at zero between zones and draw a red hairline
        // along the floor for the whole lap.
        const yB = (v) => PAD + (1 - v) * (PH - PAD * 2);
        const brakeShapes = zones.map((z) => {
            const seg = pts.filter((p) => Number.isFinite(p.A) && p.D >= z.start && p.D <= z.end);
            if (seg.length < 2) return null;
            const xs = seg.map((p) => x(p.D));
            const body = seg.map((p, i) => {
                const inten = Math.min(1, Math.max(0, -p.A) / peakG);
                return `${xs[i].toFixed(1)},${yB(inten).toFixed(1)}`;
            }).join(' L ');
            // start and finish on the floor so each zone reads as its own peak
            const line = `M ${xs[0].toFixed(1)},${PH} L ${body} L ${xs[xs.length - 1].toFixed(1)},${PH}`;
            return { line, area: `${line} Z` };
        }).filter(Boolean);

        const pedal = throttleArea
            ? { throttleArea, throttleLine, brakeShapes, peakG,
                W, H: PH, top: PAD, sectorX }
            : null;

        return { line, area, W, H, total, maxS, minS, sectorX, drsBars, brakePaths, pedal };
    }, [trackData, sectorBoundaries]);

    return {
        trackData,
        mapLayout,
        speedTrace,
        telemetry,
        loading,
        error,
        reload,
        loadReplay,
        replayError,
        sectorBoundaries,
        officialSectorTimes,
        driver,
    };
};
