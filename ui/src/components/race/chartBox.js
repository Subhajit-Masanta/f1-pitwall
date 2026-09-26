/**
 * 📄 chartBox.js — the one plot box the race charts share.
 *
 * The race trace and the strategy chart are the same race told twice, one from
 * the position side and one from the tyre side, and they are stacked so that
 * reading down from a moment on one lands on the same moment on the other —
 * "he came out ahead because of the undercut" is a vertical glance.
 *
 * That only works if their lap axes are at the same x. Two components each
 * choosing their own gutters put lap 30 fifty-eight pixels apart, so the
 * numbers live here instead, where they cannot drift.
 */
export const chartBox = (narrow) => ({
    /** Left column: position and code on one, position and code on the other. */
    left: narrow ? 58 : 74,
    /** Right margin: room for the driver codes at the end of a trace line. */
    right: narrow ? 6 : 34,
});
