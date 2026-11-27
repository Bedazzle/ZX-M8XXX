// cmos.js — the MC146818 (DS12887) real-time clock with its 114 bytes of CMOS
// RAM, as the Gluk clock on a Pentagon and SMUC's clock on a Scorpion have it.
// Modelled on Xpeccy+ (libxpeccy/cmos.c): the time is the host's, read when a
// register is read; BCD unless register B bit 2 asks for binary.
//
//   $00 seconds  $02 minutes  $04 hours  $06 weekday (1-7, Sunday 1)
//   $07 day      $08 month    $09 year (00-99)
//   $01 $03 $05  alarms, kept as written
//   $0A register A (bit 7, update in progress, reads 0)
//   $0B register B (bit 2 binary, bit 1 24-hour)
//   $0C register C: bit 4 (UF) rises once a second, read clears it
//   $0D register D: bit 7, valid RAM and time
//   $0E-$7F      CMOS RAM, kept across sessions by the owner (onChange)

const toBcd = (v) => ((Math.floor(v / 10) << 4) | (v % 10)) & 0xFF;

export class Mc146818 {
    constructor() {
        this.adr = 0;
        this.data = new Uint8Array(128);
        this.data[0x0A] = 0x26;          // 32.768 kHz divider, 1024 Hz rate
        this.data[0x0B] = 0x02;          // 24-hour, BCD
        this.data[0x0D] = 0x80;
        this.fixedTime = null;           // a Date or ms, for tests; null = the host's clock
        this._sec = -1;
        this.onChange = null;            // (data) after a write to the CMOS RAM
    }

    _now() {
        return this.fixedTime !== null ? new Date(this.fixedTime) : new Date();
    }

    writeAddress(v) { this.adr = v & 0x7F; }

    readData() {
        const a = this.adr;
        if (a >= 0x0E) return this.data[a];
        const t = this._now();
        if (t.getSeconds() !== this._sec) {          // UF: a clock on screen redraws on it
            this._sec = t.getSeconds();
            this.data[0x0C] |= 0x10;
        }
        const bin = (this.data[0x0B] & 0x04) !== 0;
        const f = (v) => bin ? v : toBcd(v);
        switch (a) {
            case 0x00: return f(t.getSeconds());
            case 0x02: return f(t.getMinutes());
            case 0x04: {
                const h = t.getHours();
                if (this.data[0x0B] & 0x02) return f(h);
                const h12 = (h % 12) || 12;                // 12-hour: bit 7 = PM
                return f(h12) | (h >= 12 ? 0x80 : 0);
            }
            case 0x06: return t.getDay() + 1;
            case 0x07: return f(t.getDate());
            case 0x08: return f(t.getMonth() + 1);
            case 0x09: return f(t.getFullYear() % 100);
            case 0x0A: return this.data[0x0A] & 0x7F;
            case 0x0C: {
                const v = this.data[0x0C];
                this.data[0x0C] &= ~0x10;
                return v;
            }
            case 0x0D: return 0x80;
            default: return this.data[a];                // alarms, register B
        }
    }

    writeData(v) {
        const a = this.adr;
        if (a === 0x0C || a === 0x0D) return;            // read-only
        // the time itself stays the host's: a program setting the clock is
        // not followed (as in Xpeccy+)
        this.data[a] = v & 0xFF;
        if (a >= 0x0E && this.onChange) this.onChange(this.data);
    }

    /** The CMOS RAM ($0E-$7F) from a saved copy */
    loadRam(bytes) {
        if (!bytes) return;
        for (let i = 0x0E; i < 0x80 && i < bytes.length; i++) this.data[i] = bytes[i];
    }
}
