/**
 * 📄 TyreMark.jsx — the compound marking, as the tyre actually looks.
 *
 * The tower drew a coloured ring: right colour, but it reads as a dot rather
 * than as a tyre. The real marking is a black tyre with a coloured band around
 * the sidewall and the compound letter inside it.
 *
 * DRAWN, not an image. There are 50px PNGs of these marks about, and two
 * things are wrong with using one: it is Pirelli's artwork, and at the 11px
 * the tower renders it at a raster would be a smudge while this stays crisp at
 * any size and costs nothing to ship.
 *
 * The letter appears only once there is room for it. Below about 14px it is
 * two pixels of mush, and the band already carries the meaning.
 */
import React from 'react';
import { F1, MONO, COMPOUND, COMPOUND_LETTER } from '../../theme';

/** The rubber. Not pure black — it would vanish into the panel behind it. */
const RUBBER = '#17171C';

const TyreMark = ({ compound, size = 11, title }) => {
    const known = compound in COMPOUND;
    const band = known ? COMPOUND[compound] : F1.faint;
    const letter = known ? COMPOUND_LETTER[compound] : '?';
    const r = size / 2;
    // The band is the sidewall: a stroke just inside the edge, so the tyre
    // keeps a dark rim the way the real marking does.
    const bandW = Math.max(1.5, size * 0.18);

    return (
        <svg
            width={size} height={size} viewBox={`0 0 ${size} ${size}`}
            style={{ flex: '0 0 auto', display: 'block' }}
            aria-label={compound || 'unknown compound'}
        >
            <title>{title || compound || 'unknown'}</title>
            <circle cx={r} cy={r} r={r - 0.5} fill={RUBBER} />
            <circle
                cx={r} cy={r} r={r - bandW / 2 - 0.5}
                fill="none" stroke={band} strokeWidth={bandW}
            />
            {size >= 14 && (
                <text
                    x={r} y={r} fill={band}
                    fontFamily={MONO} fontSize={size * 0.46} fontWeight="700"
                    textAnchor="middle" dominantBaseline="central"
                >{letter}</text>
            )}
        </svg>
    );
};

export default React.memo(TyreMark);
