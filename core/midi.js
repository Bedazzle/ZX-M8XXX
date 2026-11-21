/**
 * ZX-M8XXX - Spectrum 128 MIDI out (AY register 14, bit 2)
 * @license GPL-3.0
 *
 * The 128K's RS232/MIDI socket is driven by I/O port A of the AY (register 14):
 * bit 2 is RS232 TXD and MIDI OUT. The ROM (PLAY with a "Y" MIDI channel, and
 * any program that does the same) bit-bangs bytes at 31250 baud: a start bit
 * (0), eight data bits LSB first, a stop bit (1); the line idles high.
 *
 * UartDecoder turns the level changes, each with its absolute T-state, back
 * into bytes by sampling every bit in its middle; MidiAssembler groups the
 * bytes into whole MIDI messages (running status, SysEx, real-time), which is
 * what Web MIDI's send() takes.
 */

export const MIDI_BAUD = 31250;
export const MIDI_TX_BIT = 0x04;      // AY R14 bit 2

export class UartDecoder {
    /**
     * @param {number} bitTStates T-states per bit (CPU clock / baud)
     * @param {function(number)} onByte
     */
    constructor(bitTStates, onByte) {
        this.bitT = bitTStates;
        this.onByte = onByte;
        this.level = 1;          // idle (mark)
        this.start = -1;         // T-state of the start bit's edge, -1 = idle
        this.bits = 0;
        this.n = 0;              // data bits sampled so far
        this.errors = 0;         // framing errors (stop bit low)
    }

    // Sample every bit whose middle is at or before t, at the current level
    _advance(t) {
        while (this.start >= 0) {
            const s = this.start + this.bitT * (this.n + 1.5);
            if (s > t) break;
            if (this.n < 8) {
                if (this.level) this.bits |= 1 << this.n;
                this.n++;
            } else {
                if (this.level) this.onByte(this.bits);
                else this.errors++;
                this.start = -1;
            }
        }
    }

    /** The line goes to `level` (0/1) at absolute T-state t */
    edge(t, level) {
        this._advance(t);
        if (this.start < 0 && this.level === 1 && level === 0) {
            this.start = t;
            this.bits = 0;
            this.n = 0;
        }
        this.level = level;
    }

    /** Time has reached t with no change: finish what can be finished */
    flush(t) { this._advance(t); }

    reset() {
        this.level = 1;
        this.start = -1;
    }
}

// Data bytes after a status byte
function dataLength(status) {
    const hi = status & 0xF0;
    if (hi === 0xC0 || hi === 0xD0) return 1;
    if (hi >= 0x80 && hi <= 0xE0) return 2;
    if (status === 0xF1 || status === 0xF3) return 1;
    if (status === 0xF2) return 2;
    return 0;
}

export class MidiAssembler {
    /** @param {function(number[])} onMessage a complete MIDI message */
    constructor(onMessage) {
        this.onMessage = onMessage;
        this.status = 0;
        this.buf = [];
        this.need = 0;
        this.sysex = null;
    }

    push(b) {
        b &= 0xFF;
        if (b >= 0xF8) { this.onMessage([b]); return; }          // real-time
        if (this.sysex) {
            this.sysex.push(b);
            if (b === 0xF7) { this.onMessage(this.sysex); this.sysex = null; }
            return;
        }
        if (b === 0xF0) { this.sysex = [b]; return; }
        if (b & 0x80) {
            this.need = dataLength(b);
            // system common cancels running status
            this.status = b < 0xF0 ? b : 0;
            this.buf = [b];
            if (this.need === 0) { this.onMessage(this.buf); this.buf = []; }
            return;
        }
        if (!this.buf.length) {
            if (!this.status) return;          // a data byte with no status
            this.buf = [this.status];          // running status
            this.need = dataLength(this.status);
        }
        this.buf.push(b);
        if (this.buf.length - 1 >= this.need) { this.onMessage(this.buf); this.buf = []; }
    }

    reset() { this.status = 0; this.buf = []; this.sysex = null; }
}
