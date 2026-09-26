/**
 * 📄 stageLayout.js — how the replay stage divides its space.
 *
 * A plain function, NOT a hook. It holds no state and calls nothing, and naming
 * it `use*` would drag in the rules-of-hooks ordering constraint for no reason —
 * it could then only be called above a component's early returns, which is
 * precisely the trap that has already produced two blank-page bugs here.
 *
 * Every band below the map (trace charts, transport, HUD) and the column beside
 * it (timing rail) is RESERVED rather than floated, and the stage grows to fit
 * them instead of the map giving way. That rule exists because both of the
 * layout bugs this app has had came from breaking it:
 *
 *   · the transport was floated over the map and landed on the speed chart,
 *     then on Monza's main straight
 *   · the timing rail overlapped the track at circuits whose bounding box
 *     reaches the top-left corner
 *
 * Gathering the arithmetic here means the next mode (a race replay, with a
 * timing tower instead of a sector rail) states its bands in one place rather
 * than threading numbers through a component.
 */

/**
 * @param narrow          phone-width layout
 * @param traceOpen       the chart stack is showing
 * @param hasPedal        the solo layout has a pedal band
 * @param comparePanels   per-driver pedal panels (0 in solo)
 * @param showDeltaTrace  the delta chart is showing
 * @param hasSectorRow    the two-driver sector row is showing
 * @param hasDeltaPanel   the delta readout panel is showing
 * @param headerH         MEASURED height of the stage header, in px
 * @param aspect          width/height of the circuit being drawn
 * @param maxw            the page's width cap, in px
 */
export const stageLayout = ({
    narrow,
    headerH = 0,
    traceOpen = false,
    hasPedal = false,
    comparePanels = 0,
    showDeltaTrace = false,
    hasSectorRow = false,
    hasDeltaPanel = false,
    aspect = 0,
    maxw = 1680,
}) => {
    // --- band heights ------------------------------------------------------
    const hudSpace = narrow ? 180 : 150;
    const traceH = narrow ? 56 : 76;
    const pedalH = narrow ? 46 : 60;      // full-height throttle needs the travel
    const deltaH = narrow ? 40 : 52;
    const labelRow = narrow ? 18 : 21;
    const sectorRow = hasSectorRow ? (narrow ? 34 : 40) : 0;
    const sectorGap = narrow ? 8 : 12;
    // chart heights + the two label rows + the sector labels underneath
    const traceChrome = narrow ? 52 : 70;

    // Compare drops the speed chart entirely and stacks a pedal panel per
    // driver, so the two layouts budget different things.
    const traceBlock = !traceOpen ? 0
        : comparePanels
            ? comparePanels * (pedalH + labelRow)
                + (showDeltaTrace ? deltaH + labelRow : 0)
                + (sectorRow ? sectorRow + sectorGap : 0)
                + (narrow ? 10 : 20)
            // traceChrome already covers the two label rows and sector labels
            : traceH + (hasPedal ? pedalH : 0) + traceChrome;

    const bottomSpace = hudSpace + traceBlock;

    // A reserved band for the transport. Floating it over the map meant it
    // landed on the track itself at circuits whose layout reaches the bottom of
    // the bounding box (Monza's main straight, for one).
    const transportSpace = narrow ? 52 : 58;
    const mapBottom = bottomSpace + transportSpace;

    // Reserved column for the timing rail. On desktop it is a vertical rail at
    // top-left (x 24..214) and the map used the full width underneath it, so a
    // circuit whose bounding box reaches that corner drew straight through the
    // lap clock — Monza's turn 6/7 loop did exactly that.
    //
    // Measured cost of reserving it: Bahrain and Monza lose NOTHING (both are
    // height-bound, so the narrower box changes nothing), Monaco loses 13% on
    // its unusually wide 2.12 aspect. A horizontal strip across the top instead
    // would have cost ~11% on every track, so this is the cheaper reservation.
    const timingSpace = narrow ? 0 : 224;

    // On desktop the delta panel lives in the reserved timing column, so it
    // costs nothing. Narrow has no such column, so it takes a band of its own
    // and the stage grows to match rather than the map shrinking.
    const deltaSpace = (hasDeltaPanel && narrow) ? 86 : 0;

    // The header is the one band whose height is not ours to choose: it wraps
    // when the circuit name is long or the window is narrow, and at 1024px it
    // is already TWO rows (98px) against the 46px that used to be reserved —
    // which is how the driver pickers ended up drawn over the lap clock on a
    // tablet in portrait. So it is measured, not assumed, and anything beyond
    // the one-row budget grows the stage rather than eating into the map.
    const headerBase = narrow ? 90 : 46;
    const headerExtra = Math.max(0, headerH - headerBase);

    const mapTop = headerBase + headerExtra + deltaSpace;

    // The stage GROWS by exactly what is open below it rather than the map
    // giving up space — so the track is the same size in every mode.
    const mapH = narrow ? 68 : 78;
    const grown = traceBlock + transportSpace + deltaSpace + headerExtra;

    // THE STAGE IS AS TALL AS THE CIRCUIT NEEDS IT TO BE.
    //
    // A fixed share of the viewport was fine while the page was 1200px wide,
    // because the map band came out roughly the shape of a circuit. On a wider
    // page it does not: measured at 1745px, Melbourne drew 683px wide inside a
    // 1374px band — half the stage empty either side of the track.
    //
    // So the height is derived from the shape of the thing being drawn. All in
    // CSS, because the only unknown is the stage width and that is the page
    // width: min(maxw, 100vw - the page padding).
    //
    //   floor   what it used to be, so nothing ever gets shorter
    //   wanted  the height that makes the map band the circuit's own shape
    //   cap     as tall as it can be with the transport still on screen.
    //           76, not 85: the page header and the race picker sit above the
    //           stage, and at 85 the START LAP button landed three pixels
    //           under the fold — you had to scroll to begin.
    const pagePad = narrow ? 32 : 80;
    const floor = `calc(${mapH}vh + ${grown}px)`;
    const height = aspect > 0
        ? `clamp(${floor},`
          + ` calc((min(${maxw}px, 100vw - ${pagePad}px) - ${timingSpace}px)`
          + ` / ${aspect.toFixed(3)} + ${mapTop + mapBottom}px),`
          + ` calc(76vh + ${bottomSpace}px))`
        : floor;

    return {
        hudSpace, traceH, pedalH, deltaH, labelRow, sectorRow, sectorGap,
        traceBlock, bottomSpace, transportSpace, timingSpace, deltaSpace,
        headerBase, headerExtra, mapTop, mapBottom,
        stage: {
            position: 'relative', width: '100%',
            height,
            minHeight: (narrow ? 440 : 520) + grown,
            overflow: 'hidden', display: 'flex',
        },
    };
};
