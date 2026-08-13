// ULA ink/paper edge skew (pure)
//
// The Ferranti ULA's ink/paper multiplexer does not switch symmetrically: the
// transition *into* ink lags the transition back to paper, so an ink pixel comes
// out slightly narrower than its nominal width. On ordinary graphics this costs a
// long ink run a sliver of its leading edge and is invisible. On a one-pixel
// checkerboard every ink pixel *is* a leading edge, so the same pattern drawn as
// white-ink-on-black reads darker than the identical pattern drawn as
// black-ink-on-white — even though the two are bit-for-bit the same pixel stream.
//
// That difference is the entire content of the "Bright Miner" test, which paints
// Miner Willy purely as $AA/ink-white background against $55/paper-white sprite
// cells (attributes $07 vs $38 — an exact ink/paper swap). A pixel-exact renderer
// shows uniform grey; hardware with this skew shows the figure.
//
// The Amstrad 40077 gate array (+2A/+3) and the Pentagon/Scorpion clone ULAs are
// different silicon and do not do it — the same split as ULA snow, see
// core/ula-snow.js and the hasSnow / ulaInkSkew profile fields.

// Ink pixels that *begin* a run, i.e. the ones that lose width to the delay.
// `prevInkBit` is the previous cell's rightmost pixel (0 at the start of a line,
// where the ink run starts against the border).
export function leadingInkMask(pixelByte, prevInkBit) {
    const b = pixelByte & 0xFF;
    // bit 7 is the leftmost pixel, so a pixel's left neighbour is the bit above it;
    // bit 7's own comes from the cell before
    const prior = ((b >> 1) | ((prevInkBit & 1) << 7)) & 0xFF;
    return b & ~prior & 0xFF;
}

// Byte-wise lerp of two packed colours. Works for either endianness because it
// treats all four bytes alike and both operands carry the same alpha.
// `inkWeight` is 0..256 (256 = pure ink).
export function mix32(paper32, ink32, inkWeight) {
    const p = paper32 >>> 0, k = ink32 >>> 0;
    const w = inkWeight | 0, iw = 256 - w;
    const b0 = ((p & 0xFF) * iw + (k & 0xFF) * w) >> 8;
    const b1 = (((p >>> 8) & 0xFF) * iw + ((k >>> 8) & 0xFF) * w) >> 8;
    const b2 = (((p >>> 16) & 0xFF) * iw + ((k >>> 16) & 0xFF) * w) >> 8;
    const b3 = (((p >>> 24) & 0xFF) * iw + ((k >>> 24) & 0xFF) * w) >> 8;
    return (((b3 & 0xFF) << 24) | ((b2 & 0xFF) << 16) | ((b1 & 0xFF) << 8) | (b0 & 0xFF)) >>> 0;
}

// Re-tint the leading ink pixels of one already-rendered cell.
// Call it *after* the eight pixels have been stored — it only overwrites the few
// that start a run. Returns this cell's rightmost pixel, to be passed back in as
// `prevInkBit` for the next column.
export function applyInkSkew(fb32, baseOffset, pixelByte, ink32, paper32, prevInkBit, skew) {
    const lead = leadingInkMask(pixelByte, prevInkBit);
    if (lead) {
        const mixed = mix32(paper32, ink32, 256 - Math.round(skew * 256));
        if (lead & 0x80) fb32[baseOffset] = mixed;
        if (lead & 0x40) fb32[baseOffset + 1] = mixed;
        if (lead & 0x20) fb32[baseOffset + 2] = mixed;
        if (lead & 0x10) fb32[baseOffset + 3] = mixed;
        if (lead & 0x08) fb32[baseOffset + 4] = mixed;
        if (lead & 0x04) fb32[baseOffset + 5] = mixed;
        if (lead & 0x02) fb32[baseOffset + 6] = mixed;
        if (lead & 0x01) fb32[baseOffset + 7] = mixed;
    }
    return pixelByte & 1;
}

// How much of a row of pixel bytes ends up lit, as a fraction, when `whiteIsInk`
// says which of ink/paper is the bright one. This is what the Bright Miner test
// measures: the same bytes inverted and with ink/paper swapped give (1-skew)/2
// against (1+skew)/2 instead of the 1/2 that a pixel-exact renderer produces.
export function litCoverage(bytes, whiteIsInk, skew) {
    let lit = 0, prevInkBit = 0;
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i] & 0xFF;
        const lead = leadingInkMask(b, prevInkBit);
        for (let bit = 0; bit < 8; bit++) {
            const m = 0x80 >> bit;
            const isInk = (b & m) !== 0;
            // an ink pixel that starts a run covers (1 - skew) of its width;
            // the sliver it gives up shows paper
            const inkPart = isInk ? ((lead & m) ? 1 - skew : 1) : 0;
            lit += whiteIsInk ? inkPart : 1 - inkPart;
        }
        prevInkBit = b & 1;
    }
    return lit / (bytes.length * 8);
}

// The profile drives it, exactly as hasSnow does; an explicit override wins so
// the effect can be dialled or switched off per machine at runtime.
export function inkSkewFor(profile, override) {
    if (override !== undefined && override !== null) return Math.max(0, Math.min(1, override));
    return (profile && profile.ulaInkSkew) || 0;
}
