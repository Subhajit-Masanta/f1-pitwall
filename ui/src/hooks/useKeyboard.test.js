/**
 * The shortcut mapping, without a DOM.
 *
 * `keyAction` takes everything it needs off the event, so the rules can be
 * pinned as data — which is where the two that matter live: a control's own
 * keys stay the control's, and a modifier belongs to the browser.
 */
import { describe, it, expect } from 'vitest';
import { keyAction } from './useKeyboard';

const ev = (key, over = {}) => ({
    key,
    altKey: false, ctrlKey: false, metaKey: false,
    target: { tagName: 'DIV', isContentEditable: false },
    ...over,
});

describe('keyAction', () => {
    it('plays and pauses on space', () => {
        expect(keyAction(ev(' '))).toBe('toggle');
        expect(keyAction(ev('Spacebar'))).toBe('toggle');
    });

    it('takes K too, which is what every video player uses', () => {
        expect(keyAction(ev('k'))).toBe('toggle');
        expect(keyAction(ev('K'))).toBe('toggle');
    });

    it('steps with the arrows', () => {
        expect(keyAction(ev('ArrowLeft'))).toBe('prev');
        expect(keyAction(ev('ArrowRight'))).toBe('next');
    });

    it('goes back to the start on R or Home', () => {
        expect(keyAction(ev('r'))).toBe('restart');
        expect(keyAction(ev('Home'))).toBe('restart');
    });

    it('leaves a focused control its own keys', () => {
        // A focused button already takes Space as a click and a focused range
        // already takes the arrows. Handling them again double-fires the one
        // and fights the other.
        for (const tag of ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'OPTION']) {
            expect(keyAction(ev(' ', { target: { tagName: tag } }))).toBeNull();
            expect(keyAction(ev('ArrowLeft', { target: { tagName: tag } }))).toBeNull();
        }
    });

    it('leaves text being edited alone', () => {
        const target = { tagName: 'DIV', isContentEditable: true };
        expect(keyAction(ev(' ', { target }))).toBeNull();
    });

    it('gives a modified key back to the browser', () => {
        // Ctrl+R is a reload, not a restart.
        expect(keyAction(ev('r', { ctrlKey: true }))).toBeNull();
        expect(keyAction(ev('r', { metaKey: true }))).toBeNull();
        expect(keyAction(ev(' ', { altKey: true }))).toBeNull();
    });

    it('ignores everything else', () => {
        for (const k of ['a', 'Enter', 'Escape', 'Tab', '1', 'ArrowUp', 'ArrowDown']) {
            expect(keyAction(ev(k))).toBeNull();
        }
    });

    it('survives a malformed event', () => {
        expect(keyAction(null)).toBeNull();
        expect(keyAction(undefined)).toBeNull();
        expect(keyAction({ key: ' ' })).toBe('toggle');      // no target at all
    });
});
