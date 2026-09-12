/**
 * 📄 Select.jsx — the app's dropdown.
 *
 * Replaces the native <select>. Five of them sit on the replay page (year,
 * round, session and two drivers) and every one rendered as an OS widget —
 * grey, chunky, differently shaped on Windows and macOS — inside a black
 * broadcast UI. Nothing else on the page looked as unfinished.
 *
 * A native select cannot be styled past its border: the popup is drawn by the
 * operating system, so a colour swatch beside a driver or a gap in mono digits
 * is simply not expressible. Hence a real listbox.
 *
 * What that buys has to be paid for in keyboard and focus behaviour, which the
 * native control gave away free — so this implements the listbox pattern:
 * Enter/Space/Arrow to open, arrows to move, Enter to choose, Escape to cancel,
 * Tab or an outside click to dismiss, and focus returns to the trigger.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { F1, MONO } from '../../theme';

// How long after closing the menu we will still put focus back on the trigger.
// Long enough to outlast the disabled spell while a lap loads (~250ms here),
// short enough that it never fights a user who has moved on.
const REFOCUS_WINDOW_MS = 2500;

/**
 * @param value     currently selected option value ('' = none)
 * @param options   [{ value, label, short?, sub?, color?, disabled? }]
 *                  `short` is what the closed trigger shows; `label`+`sub` the row.
 * @param onChange  (value) => void
 * @param accent    border/emphasis colour — the driver's team colour, usually
 */
const Select = ({
    value,
    options = [],
    onChange,
    placeholder = 'Select…',
    accent = null,
    disabled = false,
    loading = false,
    minWidth = 0,
    maxWidth = 260,
    mono = false,
    ariaLabel,
}) => {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);      // keyboard-highlighted row
    const [drop, setDrop] = useState('down');
    const rootRef = useRef(null);
    const listRef = useRef(null);
    const btnRef = useRef(null);

    const selectable = useMemo(() => options.filter((o) => !o.disabled), [options]);
    const current = options.find((o) => String(o.value) === String(value)) || null;
    const dead = disabled || loading || options.length === 0;

    // Focus cannot simply be restored on close, and "is it focused yet?" is the
    // wrong question to stop on. Measured: choosing a driver leaves this button
    // still focused for ~250ms, THEN the lap starts loading, the trigger goes
    // disabled, and the browser blurs it to <body> — where it stayed, because
    // the first check saw a focused button and considered the job done.
    //
    // So the intent is held for a short window instead, and honoured whenever
    // focus is sitting on <body> with the control live. Anything else — the
    // user clicking or tabbing somewhere real — drops it immediately, so this
    // can never yank focus back off them.
    const refocusUntil = useRef(0);

    const close = useCallback((refocus = true) => {
        setOpen(false);
        setActive(-1);
        if (refocus) refocusUntil.current = performance.now() + REFOCUS_WINDOW_MS;
    }, []);

    useEffect(() => {
        if (!refocusUntil.current) return;
        if (performance.now() > refocusUntil.current) { refocusUntil.current = 0; return; }
        const on = document.activeElement;
        if (on && on !== document.body && on !== btnRef.current) {
            refocusUntil.current = 0;          // the user moved on; leave them alone
            return;
        }
        if (!dead && on === document.body) btnRef.current?.focus();
    });

    const choose = useCallback((opt) => {
        if (!opt || opt.disabled) return;
        onChange?.(opt.value);
        close();
    }, [onChange, close]);

    // Outside click. `mousedown` rather than `click` so the menu is gone before
    // the click lands on whatever is underneath it.
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            if (!rootRef.current?.contains(e.target)) close(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open, close]);

    // Open upwards when there is not room below — a picker near the foot of the
    // stage would otherwise drop its menu off the bottom of the viewport.
    useEffect(() => {
        if (!open || !rootRef.current) return;
        const r = rootRef.current.getBoundingClientRect();
        setDrop(window.innerHeight - r.bottom < 240 && r.top > 240 ? 'up' : 'down');
        const i = options.findIndex((o) => String(o.value) === String(value));
        setActive(i >= 0 ? i : 0);
    }, [open, options, value]);

    // Keep the highlighted row in view while arrowing through a long list.
    useEffect(() => {
        if (!open || active < 0) return;
        listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
    }, [open, active]);

    const move = (dir) => {
        if (!selectable.length) return;
        setActive((prev) => {
            let i = prev;
            for (let n = 0; n < options.length; n++) {
                i = (i + dir + options.length) % options.length;
                if (!options[i].disabled) return i;
            }
            return prev;
        });
    };

    const onKeyDown = (e) => {
        if (dead) return;
        if (!open) {
            if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }
        switch (e.key) {
            case 'Escape': e.preventDefault(); close(); break;
            case 'Tab': close(false); break;
            case 'ArrowDown': e.preventDefault(); move(1); break;
            case 'ArrowUp': e.preventDefault(); move(-1); break;
            case 'Home': e.preventDefault(); setActive(0); break;
            case 'End': e.preventDefault(); setActive(options.length - 1); break;
            case 'Enter':
            case ' ': e.preventDefault(); choose(options[active]); break;
            default: break;
        }
    };

    const edge = accent || (open ? F1.dim : F1.line);

    return (
        <div ref={rootRef} style={{ position: 'relative', minWidth, maxWidth, flex: minWidth ? '1 1 auto' : undefined }}>
            <button
                ref={btnRef}
                type="button"
                role="combobox"
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-label={ariaLabel}
                disabled={dead}
                onKeyDown={onKeyDown}
                onClick={() => !dead && setOpen((o) => !o)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '7px 10px', boxSizing: 'border-box',
                    background: open ? F1.surface : 'transparent',
                    color: current ? F1.text : F1.dim,
                    border: `1px solid ${edge}`,
                    borderRadius: 2,
                    cursor: dead ? (loading ? 'wait' : 'not-allowed') : 'pointer',
                    fontSize: 12, fontWeight: 600, letterSpacing: 0.4,
                    fontFamily: mono ? MONO : 'inherit',
                    textAlign: 'left', opacity: dead && !loading ? 0.55 : 1,
                    transition: 'background .12s, border-color .12s',
                }}
            >
                {accent && <span style={{ width: 3, height: 13, background: accent, flex: '0 0 auto' }} />}
                <span style={{
                    flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                    {loading ? 'Loading…' : (current ? (current.short || current.label) : placeholder)}
                </span>
                <ChevronDown
                    size={13}
                    style={{
                        flex: '0 0 auto', color: F1.faint,
                        transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .14s',
                    }}
                />
            </button>

            {open && (
                <ul
                    ref={listRef}
                    role="listbox"
                    style={{
                        position: 'absolute', left: 0, right: 0, zIndex: 40,
                        [drop === 'up' ? 'bottom' : 'top']: 'calc(100% + 4px)',
                        margin: 0, padding: 4, listStyle: 'none',
                        maxHeight: 240, overflowY: 'auto',
                        background: F1.surface,
                        border: `1px solid ${F1.line}`,
                        boxShadow: '0 12px 28px rgba(0,0,0,0.6)',
                    }}
                >
                    {options.map((o, i) => {
                        const sel = String(o.value) === String(value);
                        return (
                            <li
                                key={`${o.value}-${i}`}
                                role="option"
                                aria-selected={sel}
                                onMouseEnter={() => setActive(i)}
                                onClick={() => choose(o)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '7px 9px',
                                    cursor: o.disabled ? 'default' : 'pointer',
                                    background: i === active && !o.disabled ? F1.line : 'transparent',
                                    color: o.disabled ? F1.faint : sel ? F1.text : F1.dim,
                                    fontSize: 12, fontWeight: sel ? 700 : 500, letterSpacing: 0.3,
                                    fontFamily: mono ? MONO : 'inherit',
                                }}
                            >
                                {o.color !== undefined && (
                                    <span style={{
                                        width: 3, height: 14, flex: '0 0 auto',
                                        background: o.color || 'transparent',
                                    }} />
                                )}
                                <span style={{
                                    flex: 1, whiteSpace: 'nowrap', overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}>
                                    {o.label}
                                </span>
                                {o.sub && (
                                    <span style={{
                                        fontFamily: MONO, fontSize: 11, color: F1.faint,
                                        fontVariantNumeric: 'tabular-nums', flex: '0 0 auto',
                                    }}>
                                        {o.sub}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

export default Select;
