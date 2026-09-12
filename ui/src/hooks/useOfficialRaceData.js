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

/** Rotate a telemetry frame list onto the circuit's official orientation. */
const rotateFrames = (frames, angle) => frames.map((p) => {
    const r = applyRotation(p.x, p.y, angle);
    return { ...p, x: r.x, y: r.y };
});

/**
 * Pedal geometry for ONE driver, from their own telemetry channels.
 *
 * Both sides of a head-to-head go through this same function so neither gets a
 * flattering treatment: same sampling, same scales, same brake definition.
 *
 * Braking is deceleration gated by the pedal flag — FastF1's Brake channel is
 * boolean, so it says whether the pedal is down but not how hard; the g channel
 * supplies the magnitude that gives the spike-then-bleed shape.
 */
const buildPedalGeom = (arrays, W) => {
    if (!arrays) return null;
    const { d, thr, brk, gl } = arrays;
    const n = d.length;
    if (n < 2) return null;

    const total = d[n - 1] || 1;
    const PH = 100, PAD = 2;
    const x = (i) => (d[i] / total) * W;
    const yT = (v) => PAD + (1 - Math.max(0, Math.min(100, v)) / 100) * (PH - PAD * 2);

    let peakG = 0;
    for (let i = 0; i < n; i++) {
        if (brk[i] && -gl[i] > peakG) peakG = -gl[i];
    }
    peakG = peakG || 5;

    const step = Math.max(1, Math.floor(n / 600));
    const tp = [];
    for (let i = 0; i < n; i += step) tp.push(`${x(i).toFixed(1)},${yT(thr[i]).toFixed(1)}`);
    const throttlePath = `M ${tp.join(' L ')}`;

    // one filled shape per braking event, so the fill reads as discrete peaks
    const shapes = [];
    let i = 0;
    while (i < n) {
        if (!brk[i]) { i++; continue; }
        let j = i;
        while (j + 1 < n && brk[j + 1]) j++;
        if (j - i >= 1) {
            const body = [];
            for (let k = i; k <= j; k++) {
                const inten = Math.min(1, Math.max(0, -gl[k]) / peakG);
                body.push(`${x(k).toFixed(1)},${yT(inten * 100).toFixed(1)}`);
            }
            const line = `M ${x(i).toFixed(1)},${PH} L ${body.join(' L ')} L ${x(j).toFixed(1)},${PH}`;
            shapes.push({ line, area: `${line} Z` });
        }
        i = j + 1;
    }

    return { throttlePath, brakeShapes: shapes, peakG, W, H: PH };
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

    const compareTrace = useMemo(() => {
        if (!ghost?.arrays || !refLookup?.arrays || !speedTrace) return null;
        const { W } = speedTrace;

        // Both panels come from the SAME builder and the same channels, so
        // neither driver gets a different treatment.
        const a = buildPedalGeom(refLookup.arrays, W);
        const b = buildPedalGeom(ghost.arrays, W);
        if (!a || !b) return null;

        // Delta across the lap, sampled evenly in lap fraction.
        const N = 400;
        const vals = new Float64Array(N + 1);
        let deltaMax = 0;
        for (let i = 0; i <= N; i++) {
            const f = i / N;
            vals[i] = ghost.timeAtFraction(f) - refLookup.timeAtFraction(f);
            const m = Math.abs(vals[i]);
            if (m > deltaMax) deltaMax = m;
        }
        deltaMax = Math.max(0.1, Math.ceil(deltaMax * 10) / 10);

        const DH = 100, DPAD = 6;
        const half = DH / 2 - DPAD;
        const pts = [];
        for (let i = 0; i <= N; i++) {
            const x = ((i / N) * W).toFixed(1);
            // positive (the compared driver losing) rises above the centre line
            const y = (DH / 2 - (vals[i] / deltaMax) * half).toFixed(1);
            pts.push(`${x},${y}`);
        }
        const deltaPath = `M ${pts.join(' L ')}`;

        return {
            panels: [
                { code: driver?.code || 'REF', team: driver?.team, color: driver?.color || '#9E9E9E', geom: a },
                { code: ghost.code, team: ghost.team, color: ghost.color, geom: b },
            ],
            deltaPath,
            deltaArea: `${deltaPath} L ${W},${DH / 2} L 0,${DH / 2} Z`,
            deltaMax,
            DH,
            code: ghost.code,
            color: ghost.color,
        };
    }, [ghost, speedTrace, refLookup, driver]);

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
