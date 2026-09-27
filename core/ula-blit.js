/**
 * ZX-M8XXX - one character cell, put on screen (pure)
 * @license GPL-3.0
 *
 * An attribute byte decides two colours; a pixel byte decides which of the two
 * each of eight pixels gets. That is the innermost thing the ULA does, and
 * core/ula.js had SEVEN copies of it -- in `_renderCatchUpPaper`, both paths of
 * `renderScanline`, both paths of `renderPaperLine`, `renderDeferredPaper` and
 * `renderFrame`. Each carried its own ULAplus branch, its own flash swap, its own
 * bright handling and its own eight writes, and each ended with the same call into
 * the ink-skew filter.
 *
 * That is the worst duplication in the emulator, because it is exactly where the
 * features keep landing: ULA snow, the Ferranti ink edge skew and PAL composite
 * all had to be threaded through every copy, and a copy that missed one would give
 * a bug visible on one rendering path only -- the same shape as the runFrame vs
 * runFrameHeadless HALT disagreement that has its own test suite.
 *
 * Rendering is the hot path, so this was measured rather than assumed: against the
 * loop written inline, on a synthetic 192x256 screen over 3000 iterations x 8
 * rounds with the order alternated (the timings drift downward through a run, so a
 * fixed order flatters whichever goes second), the call costs -1.2% plain and -4.2%
 * with ULAplus -- i.e. nothing outside the noise, V8 inlines it -- and both forms
 * produce identical pixels.
 */

import { applyInkSkew } from './ula-inkskew.js';

/**
 * One 8-pixel cell.
 *
 * `ctx` is built once per line (or per call) and holds what does not change from
 * column to column:
 *   fb32        the frame buffer
 *   pal32       the ordinary 16-entry palette
 *   ulaPal32    the ULAplus palette, or NULL when ULAplus is off -- so the
 *               presence of the array IS the flag, and there is no second one to
 *               get out of step with it
 *   flashActive whether the flash phase is currently swapping ink and paper
 *   inkSkew     the Ferranti edge-skew amount, 0 for none
 *
 * Returns the ink bit of the last pixel, which the next cell needs to know
 * whether an ink run is starting or continuing across the cell boundary. Callers
 * carry it in a `prevInkBit` local, as they did when this was written out by hand.
 */
export function renderCell(ctx, baseOffset, pixelByte, attr, prevInkBit) {
    const fb32 = ctx.fb32;
    const ulaPal32 = ctx.ulaPal32;

    let inkColor, paperColor;
    if (ulaPal32) {
        // ULAplus: CLUT from bits 7,6; ink from bits 2-0; paper from bits 5-3
        const clut = ((attr >> 6) & 0x03) << 4;
        inkColor = ulaPal32[clut + (attr & 0x07)];
        paperColor = ulaPal32[clut + 8 + ((attr >> 3) & 0x07)];
    } else {
        const pal32 = ctx.pal32;
        let ink = attr & 0x07;
        let paper = (attr >> 3) & 0x07;
        const bright = (attr & 0x40) ? 8 : 0;
        if ((attr & 0x80) && ctx.flashActive) {
            const tmp = ink; ink = paper; paper = tmp;
        }
        inkColor = pal32[ink + bright];
        paperColor = pal32[paper + bright];
    }

    fb32[baseOffset]     = (pixelByte & 0x80) ? inkColor : paperColor;
    fb32[baseOffset + 1] = (pixelByte & 0x40) ? inkColor : paperColor;
    fb32[baseOffset + 2] = (pixelByte & 0x20) ? inkColor : paperColor;
    fb32[baseOffset + 3] = (pixelByte & 0x10) ? inkColor : paperColor;
    fb32[baseOffset + 4] = (pixelByte & 0x08) ? inkColor : paperColor;
    fb32[baseOffset + 5] = (pixelByte & 0x04) ? inkColor : paperColor;
    fb32[baseOffset + 6] = (pixelByte & 0x02) ? inkColor : paperColor;
    fb32[baseOffset + 7] = (pixelByte & 0x01) ? inkColor : paperColor;

    // Ferranti ULA: an ink run loses a sliver of its leading edge (ula-inkskew.js)
    const inkSkew = ctx.inkSkew;
    if (inkSkew) {
        return applyInkSkew(fb32, baseOffset, pixelByte, inkColor, paperColor, prevInkBit, inkSkew);
    }
    // Handed straight back when there is no skew, exactly as `if (inkSkew)
    // prevInkBit = ...` left the caller's local alone. Nothing reads it in that
    // case, but returning the real last bit instead would be a difference this
    // refactor has no business introducing.
    return prevInkBit;
}

/**
 * The per-line context above. `ulaPal32` is passed already resolved, because which
 * ULAplus palette applies is a different question in each caller -- the live one,
 * a per-scanline one rebuilt for a raster effect, or a per-group one for HAM256 --
 * and that choice is not this module's business.
 */
export function cellContext(fb32, pal32, ulaPal32, flashActive, inkSkew) {
    return { fb32, pal32, ulaPal32: ulaPal32 || null, flashActive, inkSkew };
}
