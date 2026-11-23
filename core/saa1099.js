/**
 * ZX-M8XXX - Philips SAA1099 (ZXM-SoundCard)
 * @license GPL-3.0-or-later
 *
 * Six tone channels, two noise and two envelope generators, in stereo, on an
 * 8 MHz clock. As on the ZXM-SoundCard, which is how Xpeccy and Unreal Speccy
 * offer it: port $01FF (A8 = 1) selects a register, $00FF (A8 = 0) writes it.
 *
 * The generators follow MAME's sound/saa1099.cpp (Juergen Buchmueller, Manuel
 * Abadia). What is taken from it is the behaviour it documents, not its code.
 * That file is BSD-3-Clause (https://opensource.org/license/bsd-3-clause) and
 * its copyright stays with its authors — a licence GPL-3.0-or-later admits
 * with the notice kept, so the credit stands however closely the two are read.
 *
 *   tone    half period (511 - f) << (8 - octave) clocks
 *   noise   an 18-bit LFSR (x^18 + x^11 + x), clocked at 31.25/15.6/7.8 kHz
 *           or by tone 0/3
 *   env     stepped on every half period of tone 1/4, or by an address write
 *           when external
 *
 * One place the sources disagree, and the data sheet decides it: the envelope
 * generators act on channels 2 and 5 ALONE, as the sheet and SAASound have it,
 * where MAME applies each to all three channels of its group.
 */

export const SAA_CLOCK = 8000000;

const ENVELOPE = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],                          // zero
    [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15],          // maximum
    [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],                    // single decay
    [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],                    // repetitive decay
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],                 // single triangular
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],                 // repetitive triangular
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],                    // single attack
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],                    // repetitive attack
];
const ENV_REPEATS = [false, true, false, true, false, true, false, true];

export class SAA1099 {
    constructor() { this.reset(); }

    reset() {
        this.reg = 0;
        this.amp = new Array(12).fill(0);          // [ch*2] left, [ch*2+1] right (0..15)
        this.freq = new Array(6).fill(0);
        this.octave = new Array(6).fill(0);
        this.toneOn = new Array(6).fill(false);
        this.noiseOn = new Array(6).fill(false);
        this.counter = new Array(6).fill(0);
        this.level = new Array(6).fill(0);
        this.noiseParam = [0, 0];
        this.noiseCounter = [0, 0];
        this.noiseLfsr = [0x3FFFF, 0x3FFFF];
        this.env = [this._env(), this._env()];
        this.enabled = false;                      // reg $1C bit 0
        this.sync = false;                         // reg $1C bit 1: generators held
    }

    _env() {
        return { on: false, mode: 0, invRight: false, bits3: false, ext: false, step: 0, done: false, pending: -1, l: 16, r: 16 };
    }

    _half(ch) { return (511 - this.freq[ch]) << (8 - this.octave[ch]); }

    /** Port $01FF: select a register (and the external envelope clock) */
    writeAddress(v) {
        this.reg = v & 0x1F;
        for (let i = 0; i < 2; i++) if (this.env[i].ext) this._envStep(i);
    }

    /** Port $00FF: write the selected register */
    writeData(v) {
        const r = this.reg;
        if (r <= 0x05) {
            this.amp[r * 2] = v & 0x0F;
            this.amp[r * 2 + 1] = (v >> 4) & 0x0F;
        } else if (r >= 0x08 && r <= 0x0D) {
            this.freq[r - 8] = v;
        } else if (r >= 0x10 && r <= 0x12) {
            const ch = (r - 0x10) * 2;
            this.octave[ch] = v & 7;
            this.octave[ch + 1] = (v >> 4) & 7;
        } else if (r === 0x14) {
            for (let ch = 0; ch < 6; ch++) this.toneOn[ch] = !!(v & (1 << ch));
        } else if (r === 0x15) {
            for (let ch = 0; ch < 6; ch++) this.noiseOn[ch] = !!(v & (1 << ch));
        } else if (r === 0x16) {
            this.noiseParam[0] = v & 3;
            this.noiseParam[1] = (v >> 4) & 3;
        } else if (r === 0x18 || r === 0x19) {
            // Data sheet: a running envelope takes new parameters only at the
            // end of its current period; one that is off or has finished (a
            // single form) takes them at once. Switching off is at once too.
            const e = this.env[r - 0x18];
            if (!e.on || e.done || !(v & 0x80)) this._envLoad(e, v);
            else e.pending = v;
        } else if (r === 0x1C) {
            this.enabled = !!(v & 1);
            this.sync = !!(v & 2);
            if (this.sync) {
                for (let ch = 0; ch < 6; ch++) { this.level[ch] = 0; this.counter[ch] = this._half(ch); }
            }
        }
    }

    _envLoad(e, v) {
        e.invRight = !!(v & 0x01);
        e.mode = (v >> 1) & 7;
        e.bits3 = !!(v & 0x10);
        e.ext = !!(v & 0x20);
        e.on = !!(v & 0x80);
        e.step = 0;
        e.done = false;
        e.pending = -1;
        this._envLevel(e);
    }

    _envLevel(e) {
        if (!e.on) { e.l = e.r = 16; return; }
        const form = ENVELOPE[e.mode];
        let v = form[Math.min(e.step, form.length - 1)];
        if (e.done && !ENV_REPEATS[e.mode]) v = (e.mode === 1) ? 15 : 0;
        const mask = e.bits3 ? 14 : 15;
        e.l = v & mask;
        e.r = (e.invRight ? 15 - v : v) & mask;
    }

    _envStep(i) {
        const e = this.env[i];
        if (!e.on) return;
        const len = ENVELOPE[e.mode].length;
        if (!e.done) {
            e.step++;
            if (e.step >= len) {
                // the end of a period: buffered parameters come in here
                if (e.pending >= 0) { this._envLoad(e, e.pending); return; }
                if (ENV_REPEATS[e.mode]) e.step = 0;
                else { e.step = len - 1; e.done = true; }
            }
        }
        this._envLevel(e);
    }

    /**
     * Run `clocks` cycles of the 8 MHz clock; returns [left, right], the
     * average output over them, each 0..1 (six channels at full volume = 1).
     */
    run(clocks) {
        if (!this.enabled) return [0, 0];
        const SUB = 32;
        let sumL = 0, sumR = 0, n = 0;
        for (let left = clocks; left > 0; left -= SUB) {
            const dt = left < SUB ? left : SUB;
            if (!this.sync) {
                for (let ch = 0; ch < 6; ch++) {
                    this.counter[ch] -= dt;
                    while (this.counter[ch] <= 0) {
                        this.counter[ch] += this._half(ch);
                        this.level[ch] ^= 1;
                        if (ch === 1 && !this.env[0].ext) this._envStep(0);
                        else if (ch === 4 && !this.env[1].ext) this._envStep(1);
                    }
                }
            }
            for (let g = 0; g < 2; g++) {
                this.noiseCounter[g] -= dt;
                while (this.noiseCounter[g] <= 0) {
                    const p = this.noiseParam[g];
                    this.noiseCounter[g] += p === 3 ? this._half(g * 3) : (256 << p);
                    const s = this.noiseLfsr[g];
                    const fb = ((s & 0x20000) === 0) !== ((s & 0x400) === 0);
                    this.noiseLfsr[g] = ((s << 1) | (fb ? 1 : 0)) & 0x3FFFF;
                }
            }
            let l = 0, r = 0;
            for (let ch = 0; ch < 6; ch++) {
                const tone = this.level[ch], noise = this.noiseLfsr[ch < 3 ? 0 : 1] & 1;
                let div = 0;                       // 0 off, 1 full, 2 half
                if (this.noiseOn[ch]) div = this.toneOn[ch] ? (noise ? tone << 1 : tone) : noise;
                else if (this.toneOn[ch]) div = tone;
                if (!div) continue;
                const e = ch === 2 ? this.env[0] : ch === 5 ? this.env[1] : null;
                const el = e ? e.l : 16, er = e ? e.r : 16;
                l += this.amp[ch * 2] * el / 16 / div;
                r += this.amp[ch * 2 + 1] * er / 16 / div;
            }
            sumL += l * dt; sumR += r * dt; n += dt;
        }
        return [sumL / n / 90, sumR / n / 90];
    }
}
