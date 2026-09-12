/**
 * 📄 geometry/track.js — everything the map needs, derived once per circuit.
 *
 * The viewBox, the outline path, sector ticks, DRS overlays, corner-number
 * placement and the speed-coloured segments. Pure: track data in, geometry out.
 */
/**
 * @param pitLane  optional [{X, Y}] — the derived pit lane. It is drawn as its
 *                 own path AND folded into the bounds, because it sits outside
 *                 the circuit: measured 50-130 m beyond the outline once
 *                 amplified, which a viewBox fitted to the track alone clips
 *                 straight off.
 */
export const buildMapLayout = (trackData, sectorBoundaries, pitLane = null) => {
    if (!trackData?.track_points?.length) return null;

    const pts = trackData.track_points
        .filter((p) => Number.isFinite(p.X) && Number.isFinite(p.Y))
        .map((p) => ({ x: p.X, y: -p.Y, d: p.D, s: p.S })); // flip Y for SVG

    if (pts.length < 2) return null;

    const pit = (pitLane || [])
        .filter((p) => Number.isFinite(p.X) && Number.isFinite(p.Y))
        .map((p) => ({ x: p.X, y: -p.Y }));

    const bounds = pts.concat(pit);
    const xs = bounds.map((p) => p.x);
    const ys = bounds.map((p) => p.y);
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
    // Open path, not closed: a pit lane runs from entry to exit, it is not a loop.
    const pitPath = pit.length > 1 ? toPath(pit) : '';

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
        viewBox, d, pitPath, mapSize, ticks, drsPaths, corners,
        hasSectors: !!b, speedSegments, speedRange,
    };
};
