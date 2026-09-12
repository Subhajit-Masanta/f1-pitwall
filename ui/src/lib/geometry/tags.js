/**
 * 📄 tags.js — where a driver's name tag sits next to its dot.
 *
 * Pure geometry, kept out of CarLayer so the awkward cases can be tested
 * without a browser: a car against the right-hand edge, two cars nose to tail,
 * a pair pinned to the top or bottom of the stage.
 *
 * Coordinates are SCREEN pixels within the stage. The result is the offset to
 * apply to each tag relative to its own dot, which is what the DOM wants.
 */

export const TAG_H = 16;      // exact border-box height, so the stacking is exact
export const TAG_GAP = 12;    // dot centre -> nearest tag edge
export const TAG_SEP = 3;     // minimum clear space between two stacked tags
export const EDGE = 4;        // keep tags this far inside the stage

/**
 * @param items  [{ id, px, py, w }]   dot position + measured tag width
 * @param W,H    stage size in pixels
 * @returns      [{ id, dx, dy, side }] offset from the dot; side 1 = right
 */
export const layoutTags = (items, W, H) => {
    if (!W || !H || !items?.length) return [];

    // Side first: a tag that would hang off the right edge goes left instead.
    const placed = items.map((it) => ({
        ...it,
        side: (it.px + TAG_GAP + it.w + EDGE <= W) ? 1 : -1,
    }));

    for (const side of [1, -1]) {
        const group = placed.filter((i) => i.side === side).sort((a, b) => a.py - b.py);
        if (!group.length) continue;

        // Centre each tag on its dot, then push any overlap downwards.
        let prevBottom = -Infinity;
        for (const it of group) {
            let top = it.py - TAG_H / 2;
            if (top < prevBottom + TAG_SEP) top = prevBottom + TAG_SEP;
            it.top = top;
            prevBottom = top + TAG_H;
        }

        // Slide the whole group back inside the stage. Moving the group rather
        // than clamping each tag preserves the separation just established —
        // clamping individually would re-stack them against the edge.
        const over = (group[group.length - 1].top + TAG_H + EDGE) - H;
        if (over > 0) for (const it of group) it.top -= over;
        const under = EDGE - group[0].top;
        if (under > 0) for (const it of group) it.top += under;
    }

    return placed.map((it) => ({
        id: it.id,
        side: it.side,
        dx: it.side === 1 ? TAG_GAP : -(TAG_GAP + it.w),
        dy: it.top - it.py,
    }));
};
