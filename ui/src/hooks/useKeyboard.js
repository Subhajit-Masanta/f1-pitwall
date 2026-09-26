/**
 * 📄 useKeyboard.js — the shortcuts every replay tool has.
 *
 * Space to play, arrows to step. The app had no key handler at all, so the
 * only way through a race was the mouse, and stepping a single lap meant
 * dragging a scrubber 1/58th of its width.
 *
 * TWO RULES, and both are about not fighting the browser:
 *
 *   · anything typed into a control is the control's business. A focused
 *     button already takes Space as a click, a focused range already takes the
 *     arrows, and handling them again here would double-fire the first and
 *     fight the second.
 *   · a modifier means the shortcut belongs to the browser or the OS.
 *     Ctrl+R is a reload, not a restart.
 */
import { useEffect } from 'react';

/** Elements whose own keyboard behaviour must win. */
const INTERACTIVE = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'OPTION']);

/**
 * Which action a key event asks for, or null.
 *
 * Pure, so the mapping can be tested without a DOM: everything it needs is on
 * the event object.
 */
export const keyAction = (e) => {
    if (!e || e.altKey || e.ctrlKey || e.metaKey) return null;

    // ESCAPE IS THE EXCEPTION TO THE FOCUSED-CONTROL RULE, and it has to be:
    // the way you follow a driver is by clicking their row in the timing
    // tower, so the tower button is exactly what holds focus when you want
    // out. No control has its own Escape behaviour to protect, either.
    if (e.key === 'Escape' || e.key === 'Esc') return 'escape';

    // SO IS `?`, for the same reason and one more: it is the key that says
    // what the other keys are, so it is the one that most needs to work when
    // somebody is lost. It arrives as Shift+/ — shift is not a modifier that
    // belongs to the browser, which is why only alt/ctrl/meta are refused
    // above. Nothing here can be typed into: the app's only two inputs are
    // sliders, so a printable key has no text to interrupt.
    if (e.key === '?') return 'help';

    const el = e.target;
    if (el && (INTERACTIVE.has(el.tagName) || el.isContentEditable)) return null;

    switch (e.key) {
        // K is the video-player convention, and Space is everyone else's.
        case ' ':
        case 'Spacebar':            // older browsers name it this
        case 'k':
        case 'K':
            return 'toggle';
        case 'ArrowLeft':
            return 'prev';
        case 'ArrowRight':
            return 'next';
        case 'Home':
        case 'r':
        case 'R':
            return 'restart';
        // D for director — the camera cutting between shots by itself.
        case 'd':
        case 'D':
            return 'director';
        default:
            return null;
    }
};

/**
 * Wire the shortcuts to whatever this mode calls them.
 *
 * `actions` is an object of handlers keyed by the names above; anything it
 * leaves out simply does nothing, which is how a mode that cannot step a lap
 * keeps the arrows for the page.
 */
export const useKeyboard = (actions, enabled = true) => {
    useEffect(() => {
        if (!enabled) return undefined;
        const onKey = (e) => {
            const what = keyAction(e);
            const run = what && actions[what];
            if (!run) return;
            // Only now, once something is definitely going to happen: Space
            // scrolls the page otherwise, which throws the stage off screen
            // at the exact moment the viewer wants to watch it.
            e.preventDefault();
            run();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [actions, enabled]);
};
