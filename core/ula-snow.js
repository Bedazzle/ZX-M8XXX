// ula-snow.js — the ULA "snow" effect (pure; the ULA calls it, tests don't need one).
//
// THE HARDWARE
//
// During the second half of an M1 cycle the Z80 drives the refresh address — R on
// the low byte, I on the high byte — and pulls MREQ. The 48K ULA watches MREQ
// alone (not RD/WR, not RFSH), so with I pointing into contended RAM the refresh
// looks like a memory access happening on top of the ULA's own display fetch, and
// the ULA reads the wrong address.
//
// THE MODEL
//
// Weiv measured it on hardware (Exact emulation of the Snow effect,
// hype.retroscene.org/blog/1089 — the basis of the Snow* test programs at
// github.com/redcode/ZXSpectrum/wiki/Tests) and states the rule as two overlaps of
// the M1 cycle with the ULA's 8-T-state one, and nothing else:
//
//   M1 T4 on the ULA cycle's 3rd T-state  SNOW    bits 6..0 of the pixels1 and
//                                                 attributes1 addresses come from R
//   M1 T4 on the ULA cycle's 5th T-state  DOUBLE  pixels2/attributes2 are never
//                                                 read; the previous bar's
//                                                 pixels1/attributes1 show again
//   any other overlap                     nothing
//
// Two triggers two T-states apart is what you would expect if the ULA takes the
// pair in two goes — pixels1+attributes1, then pixels2+attributes2 — rather than as
// four separate byte fetches, and it is `rule: 'weiv'`, the default.
//
// It has a consequence that looks like a bug and is not: the triggers share a
// parity, so a stream of equal-length 4-T-state instructions can hit one of them,
// or neither, for a whole frame. Measured here, a NOP loop on 48K produces no snow
// at all while the same loop on 128K produces plenty, because the two machines'
// paper starts have opposite parity. The Snow* test programs use 7-T-state
// instructions precisely so that every phase comes up.
//
// `rule: 'overlap'` is the alternative, and is ZXMAK2's shape
// (`SpectrumSnowRenderer.cs`: `Snow = 2` in `ReadMemM1` when `IsUlaFetch(Tact+3)`,
// consumed at each following fetch): four byte fetches in the cycle's first half,
// any of which a refresh can collide with, spoiling that one and the next. It
// cannot be dodged by any cadence, and it agrees better with a SpecEmu capture —
// IoU 0.638 against Weiv's 0.426. But SpecEmu is another emulator, not hardware, so
// that number measures agreement with someone else's reconstruction. Weiv's is a
// measurement, and it is what ships. Real hardware is what would settle it.
//
// What appears in a snowed cell is the display file read from the hijacked address,
// so snow is made of fragments of the picture. ZXMAK2 substitutes an LFSR byte
// instead — plausible-looking, but it cannot reproduce the stable patterns the test
// programs are built to show.
//
// WHICH MACHINES
//
// Weiv, again explicitly: "there is no snow/double effects on Amstrad's black
// machines (+2A/+2B/+3/...) and on any ZX Spectrum clones except maybe those that
// based on original ULA". So the gate is the profile's `hasSnow`, not
// `hasContention` — the +2A contends and does not snow.
//
// CALIBRATION
//
// `SnowCalibration` holds the three things measurement decides rather than argument.
// `m1T4` is swept against a SpecEmu capture of Woodmass's Snow Hold — corrupted-cell
// mask against corrupted-cell mask, each side diffed with its own clean render, so
// the two emulators' scales and palettes cancel. 3 wins clearly (IoU 0.638; the next
// candidate manages 0.462), and it puts all three of the reference's bands in the
// right place. Note that ZXMAK2 takes its refresh tact at `Tact + 3` against a cycle
// origin one T-state before the first pixel, which in our frame would be 4: the
// remaining T-state is presumably where in the fetch our `tStates` stands when the
// CPU calls `note()`, and the capture is what decides.

export const BITMAP_BYTES = 0x1800;
export const DISPLAY_BYTES = 0x1B00;
export const ATTR_BASE = BITMAP_BYTES;

//   m1T4     the refresh's T-state, counted from the start of the opcode fetch:
//            this is what pins our T-state phase against the ULA's 8-T cycle.
//   rOnBus   the Z80 increments R after putting the refresh address on the bus, so
//            the value the ULA sees is the one before the increment.
//   addrBits how many bits of the ULA's address R replaces. Seven, and this one is
//            derived rather than fitted: the 48K's lower 16K is 4116 DRAM, 16K x 1,
//            so its address arrives as a 7-bit row plus a 7-bit column, and during
//            refresh the Z80 drives R on A0-A6 — exactly the row. The row latched at
//            RAS is the Z80's, the column is still the ULA's counter, so the low
//            seven bits come from R and the rest survive. Weiv measured bits 6..0,
//            and the WoS 48K reference says "the lowest 7 bits, the R register, are
//            used for memory refresh". ZXMAK2 replaces the whole low byte, but its
//            substituted value is an LFSR rather than R, so the width means little
//            there. 8 is left settable for experiments only.
//
//            A 128K's banks are 4164 (64K x 1) with an 8-bit row, which predicts
//            EIGHT bits replaced there. Untested — no reference capture of a 128K
//            snow test exists yet, and no cell mask could see it anyway.
export const SnowCalibration = { m1T4: 3, rOnBus: -1, addrBits: 7, spendOn: 'all',
                                 rule: 'weiv' };

// Kept as names for the tests, which assert against the defaults
export const M1_T4_FROM_FETCH = SnowCalibration.m1T4;
export const R_ON_BUS = SnowCalibration.rOnBus;

// The ULA's four fetches occupy the first four T-states of its 8-T-state cycle
export const CYCLE_TSTATES = 8;
export const FETCH_SLOTS = 4;
// How many fetches one collision spoils (ZXMAK2's `Snow = 2`)
export const PENDING_FETCHES = 2;
// Weiv's two trigger offsets: the ULA cycle's 3rd and 5th T-states, 0-based
export const WEIV_SNOW_AT = 2;
export const WEIV_DOUBLE_AT = 4;

// Does I put the refresh address into contended RAM?
//
//   48K family: $40-$7F, i.e. $4000-$7FFF.
//   128K: also $C0-$FF, but only while an odd (contended) page sits at $C000.
export function snowRange(i, { pagedBankAtC000 = null } = {}) {
    const hi = i & 0xFF;
    if ((hi & 0xC0) === 0x40) return true;
    if (hi >= 0xC0 && pagedBankAtC000 !== null) return (pagedBankAtC000 & 1) === 1;
    return false;
}

export function snowActive({ enabled, hasSnow, i, pagedBankAtC000 = null }) {
    return !!enabled && !!hasSnow && snowRange(i, { pagedBankAtC000 });
}

// Display-file address of a cell's pixel byte (ZX layout) and attribute byte
export function bitmapOffset(x, y) {
    return ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | (x & 0x1F);
}

export function attrOffset(x, y) {
    return ATTR_BASE + ((y >> 3) * 32) + (x & 0x1F);
}

// The corrupted address: the one the ULA wanted, with its low bits replaced by R's.
export function corruptAddress(addr, r) {
    const mask = (1 << SnowCalibration.addrBits) - 1;
    return (addr & ~mask) | (r & mask);
}

/**
 * Build the display the ULA actually managed to put out this frame.
 *
 * @param out    Uint8Array(DISPLAY_BYTES), reused between frames
 * @param ram    the bank holding the display file
 * @param m1     M1Log of this frame's refreshes
 * @param paperT (screenLine) => T-state at which that line's first ULA cycle starts
 * @returns {snow, double} bytes taken from the hijacked address, and bytes that
 *          repeated the previously read one — the two outcomes, counted separately
 *          because they look different on screen and the debug readout shows both
 */
export function applySnow(out, ram, m1, paperT) {
    out.set(ram.subarray(0, DISPLAY_BYTES));
    let snow = 0, double = 0;
    for (let y = 0; y < 192; y++) {
        const counts = applySnowLine(out, ram, m1, paperT(y), y);
        snow += counts.snow;
        double += counts.double;
    }
    return { snow, double };
}

/**
 * One screen line. The renderer draws a line as the beam reaches it, and the log
 * only holds the refresh cycles that have happened by then — so snow is applied
 * line by line, at the moment that line is drawn, not once for the whole frame.
 */
export function applySnowLine(out, ram, m1, lineT, y, snowOk = null) {
    let snow = 0, double = 0;
    if (lineT === null || lineT === undefined || !m1) return { snow, double };

    const lineEnd = lineT + 16 * CYCLE_TSTATES;
    let i = m1.firstAtOrAfter(lineT);
    if (i >= m1.count || m1.ts[i] >= lineEnd) return { snow, double };

    if (SnowCalibration.rule === 'weiv') return weivLine(out, ram, m1, lineT, y, i, snowOk);

    let pending = 0, rBus = 0;
    // The last pixel byte and the last attribute byte the ULA managed to read, for
    // the repeat outcome below. Tracked at every fetch, spoiled or not. Seeded with
    // the line's own first cell so a repeat in the very first fetch of a line has
    // nothing spurious to show — the real latch holds whatever preceded the line.
    let prevPix = ram[bitmapOffset(0, y)], prevAttr = ram[attrOffset(0, y)];

    for (let pair = 0; pair < 16; pair++) {
        const cycleT = lineT + pair * CYCLE_TSTATES;
        const x1 = pair * 2;

        for (let slot = 0; slot < FETCH_SLOTS; slot++) {
            const t = cycleT + slot;

            // Refreshes in the cycle's idle half (offsets 4-7) never reach here, so
            // they are simply skipped — only a collision with a fetch arms anything.
            while (i < m1.count && m1.ts[i] < t) i++;
            if (i < m1.count && m1.ts[i] === t) {
                if (!snowOk || snowOk[m1.is[i]]) {
                    pending = PENDING_FETCHES;
                    rBus = m1.rs[i];
                }
                i++;
            }

            const second = slot >= 2;                 // slots 2/3 are the pair's second cell
            const isAttr = (slot & 1) !== 0;
            const addr = isAttr ? attrOffset(second ? x1 + 1 : x1, y)
                                : bitmapOffset(second ? x1 + 1 : x1, y);

            if (pending === 0) {
                if (isAttr) prevAttr = out[addr]; else prevPix = out[addr];
                continue;
            }
            // ZXMAK2 spends its two on bitmap fetches only, skipping the attribute
            // ones; Weiv has the cell's attribute corrupted too, and that is what we
            // do. Swept: `bitmap` scores 0.671 against `all`'s 0.638, which is not a
            // margin worth overturning a measurement for — the same rig separated
            // the real model change from its predecessor by 0.638 against 0.462.
            // Left as a knob with the numbers recorded rather than settled.
            if (SnowCalibration.spendOn === 'bitmap' && isAttr) {
                prevAttr = out[addr];
                continue;
            }
            pending--;

            // TWO OUTCOMES, and every source has both. The first spoiled fetch reads
            // the display file at the hijacked address — that is snow proper, made of
            // fragments of the picture. The ULA does not recover in time for the next
            // one, which shows the byte it read before instead: "the ULA … regularly
            // misses a screen byte; instead of the actual byte, the byte previously
            // read is used" (WoS 48K reference), Weiv's DOUBLE where the pair's second
            // cell repeats the first, and ZXMAK2's re-read of `addr - 1`.
            //
            // Which of the two spoiled fetches is which is the one degree of freedom
            // left here: substitute-then-repeat is the assignment that makes Weiv's
            // double fall on the second cell of the pair, as he describes it.
            if (pending === PENDING_FETCHES - 1) {
                out[addr] = ram[corruptAddress(addr, rBus)];
                snow++;
            } else {
                out[addr] = isAttr ? prevAttr : prevPix;
                double++;
            }
            if (isAttr) prevAttr = out[addr]; else prevPix = out[addr];
        }

        // A collision cannot carry past the end of the line: the next line's first
        // fetch is a fresh bus cycle, far later in time.
        if (pair === 15) pending = 0;
    }
    return { snow, double };
}

/**
 * Weiv's rule, as the article states it.
 *
 * The ULA takes the pair's two cells in two goes rather than four: pixels1 and
 * attributes1 together, then pixels2 and attributes2 two T-states later. Only two
 * overlaps do anything, which is exactly what that structure predicts —
 *
 *   M1 T4 on the ULA cycle's 3rd T-state  SNOW    bits 6..0 of the pixels1 and
 *                                                 attributes1 addresses come from R
 *   M1 T4 on the ULA cycle's 5th T-state  DOUBLE  pixels2/attributes2 are never
 *                                                 read; the previous bar's
 *                                                 pixels1/attributes1 show again
 *   anything else                         nothing
 *
 * A consequence worth knowing before calling it a bug: the two triggers are two
 * T-states apart, so a stream of equal-length 4-T-state instructions sits on one
 * parity and can hit one of them, or neither, for a whole frame. That is the
 * hardware's behaviour under that instruction stream, not a gap in the model.
 */
function weivLine(out, ram, m1, lineT, y, i, snowOk) {
    let snow = 0, double = 0;
    for (let pair = 0; pair < 16; pair++) {
        const cycleT = lineT + pair * CYCLE_TSTATES;
        const x1 = pair * 2, x2 = x1 + 1;

        while (i < m1.count && m1.ts[i] < cycleT + WEIV_SNOW_AT) i++;
        if (i < m1.count && m1.ts[i] === cycleT + WEIV_SNOW_AT &&
            (!snowOk || snowOk[m1.is[i]])) {
            const r = m1.rs[i++];
            const pix = bitmapOffset(x1, y), att = attrOffset(x1, y);
            out[pix] = ram[corruptAddress(pix, r)];
            out[att] = ram[corruptAddress(att, r)];
            snow += 2;
        }

        while (i < m1.count && m1.ts[i] < cycleT + WEIV_DOUBLE_AT) i++;
        if (i < m1.count && m1.ts[i] === cycleT + WEIV_DOUBLE_AT &&
            (!snowOk || snowOk[m1.is[i]])) {
            i++;
            out[bitmapOffset(x2, y)] = out[bitmapOffset(x1, y)];
            out[attrOffset(x2, y)] = out[attrOffset(x1, y)];
            double += 2;
        }
    }
    return { snow, double };
}

/**
 * The CPU's record of when its opcode fetches happened, and what R was on the bus.
 * Only kept while snow is switched on — `enabled` is false otherwise and `note()`
 * costs one test.
 *
 * Two parallel arrays rather than a Map: the collision test is "does a refresh fall
 * in this fetch slot", walked in time order alongside the ULA's cycles, so ordered
 * storage is what the reader wants. T-states only increase within a frame, and the
 * log is cleared at the frame boundary.
 */
export class M1Log {
    constructor(capacity = 80000) {
        this.enabled = false;
        this.ts = new Int32Array(capacity);
        this.rs = new Uint8Array(capacity);
        this.is = new Uint8Array(capacity);   // I at that refresh, not at frame end
        this.count = 0;
    }

    reset() {
        this.count = 0;
    }

    // tFetch: T-state at which the opcode fetch began; r: R *after* the increment;
    // i: the I register AT THAT MOMENT.
    //
    // I has to be recorded per refresh, not read once when the frame is drawn. A
    // program can move it mid-frame — snow-probe.tap holds I at $3F until the beam
    // is past its caption and only then arms the effect — and sampling it at the end
    // of the frame snowed the caption anyway, from refreshes that were harmless when
    // they happened.
    note(tFetch, r, i = 0) {
        if (this.count >= this.ts.length) return;      // absurdly long frame; drop
        this.ts[this.count] = tFetch + SnowCalibration.m1T4;
        this.rs[this.count] = (r + SnowCalibration.rOnBus) & 0x7F;
        this.is[this.count] = i & 0xFF;
        this.count++;
    }

    // Index of the first refresh at or after t (binary search — lines are drawn in
    // order, but a full-frame redraw may revisit any of them)
    firstAtOrAfter(t) {
        let lo = 0, hi = this.count;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this.ts[mid] < t) lo = mid + 1; else hi = mid;
        }
        return lo;
    }
}
