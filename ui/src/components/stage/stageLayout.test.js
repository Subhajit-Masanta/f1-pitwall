import { describe, it, expect } from 'vitest';
import { stageLayout } from './stageLayout';

const px = (v) => parseFloat(String(v).match(/([\d.]+)px/)?.[1] ?? 0);

describe('stageLayout', () => {
    it('reserves the one-row header budget when nothing is measured yet', () => {
        expect(stageLayout({ narrow: false }).mapTop).toBe(46);
        expect(stageLayout({ narrow: true }).mapTop).toBe(90);
    });

    it('ignores a header shorter than the budget', () => {
        const L = stageLayout({ narrow: false, headerH: 30 });
        expect(L.headerExtra).toBe(0);
        expect(L.mapTop).toBe(46);
    });

    // The tablet-portrait bug: the header wraps to two rows and the pickers
    // get drawn over the lap clock, because 46px was reserved for a 98px band.
    it('reserves a wrapped two-row header in full', () => {
        const L = stageLayout({ narrow: false, headerH: 98 });
        expect(L.headerExtra).toBe(52);
        expect(L.mapTop).toBe(98);
    });

    it('grows the stage by the extra header rather than shrinking the map', () => {
        const base = stageLayout({ narrow: false, traceOpen: true, hasPedal: true });
        const tall = stageLayout({ narrow: false, traceOpen: true, hasPedal: true, headerH: 98 });
        // the map band keeps its height: the stage got taller by exactly the
        // extra header, so the track is the same size in both
        const grew = px(tall.stage.height) - px(base.stage.height);
        expect(grew).toBe(52);
        expect(tall.stage.minHeight - base.stage.minHeight).toBe(52);
        // and the band below the map is untouched
        expect(tall.mapBottom).toBe(base.mapBottom);
    });

    it('stacks the header on top of the narrow delta band', () => {
        const L = stageLayout({ narrow: true, hasDeltaPanel: true, headerH: 120 });
        expect(L.deltaSpace).toBe(86);
        expect(L.mapTop).toBe(90 + 30 + 86);
    });

    it('keeps the timing column only on the desktop layout', () => {
        expect(stageLayout({ narrow: false }).timingSpace).toBe(224);
        expect(stageLayout({ narrow: true }).timingSpace).toBe(0);
    });

    it('charges the delta band only where there is no timing column', () => {
        expect(stageLayout({ narrow: false, hasDeltaPanel: true }).deltaSpace).toBe(0);
        expect(stageLayout({ narrow: true, hasDeltaPanel: true }).deltaSpace).toBe(86);
    });

    it('reserves nothing for a closed chart stack', () => {
        expect(stageLayout({ narrow: false, traceOpen: false, hasPedal: true }).traceBlock).toBe(0);
    });

    it('budgets one pedal panel per driver in compare', () => {
        const one = stageLayout({ narrow: false, traceOpen: true, comparePanels: 1 });
        const two = stageLayout({ narrow: false, traceOpen: true, comparePanels: 2 });
        expect(two.traceBlock - one.traceBlock).toBe(one.pedalH + one.labelRow);
    });
});
