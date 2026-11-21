/**
 * ZX-M8XXX - General Sound
 * @license GPL-3.0
 *
 * After Xpeccy's sound/gs.c (MIT, SAM style). General Sound is a computer of
 * its own: a Z80 at 12 MHz with a 32KB ROM (gs104 / gs105a / gs105b) and
 * 128KB, 512KB or 2MB of RAM, and four 8-bit DACs with 6-bit volumes.
 *
 * GS memory:
 *   $0000-$3FFF  ROM, first 16KB
 *   $4000-$7FFF  RAM $4000-$7FFF (the upper half of page 1), as in Unreal /
 *                Unreal-NG; the DAC sample buffers live there
 *   $8000-$FFFF  page n of internal port 0: 0 = the whole ROM, n = 32KB RAM
 *                page n-1, masked to the RAM fitted (incomplete decoding)
 * The DACs take the byte the Z80 reads from $6000-$7FFF: A9-A8 pick the
 * channel (the GS player reads its sample bytes there on each interrupt).
 *
 * GS ports (A3-A0):
 *   0 out  page        1 in  command from the Spectrum
 *   2 in   data from the Spectrum, clears status bit 7
 *   3 out  data to the Spectrum, sets bit 7     4 in  status
 *   5      clears status bit 0 (command taken)  6-9 out  volumes 1-4 (0-63)
 *   10     bit 7 = page bit 0 (inverted)       11     bit 0 = volume 1 bit 5
 *   INT every 320 T-states (37.5 kHz).
 *
 * Spectrum ports ((port & $F7) = $B3, and $33):
 *   $BB out = command (sets status bit 0), in = status (bit 7 data, bit 0 cmd)
 *   $B3 out = data to the GS (sets bit 7), in = data from the GS (clears bit 7)
 *   $33 out = control: bit 7 resets the card (the mailbox stays), bit 6 NMI
 * (Unreal-NG's soundchip_gs.cpp, GPL-3.0, for $33 and the memory map.)
 *
 * The GS runs behind the Spectrum and is brought up to time (syncTo) at every
 * access to its ports and at the end of each frame; the DAC output is kept as
 * a list of level changes in Spectrum frame T-states for the audio.
 */

import { Z80 } from './z80.js';

export const GS_CLOCK = 12000000;
export const GS_INT_PERIOD = 320;
export const GS_ROM_SIZE = 32768;
export const GS_RAM_SIZES = { 128: 131072, 512: 524288, 2048: 2097152 };

export class GeneralSound {
    constructor(ramKB = 512) {
        this.rom = null;
        this.setRamSize(ramKB);
        this.specClock = 3500000;
        this.vol = [0, 0, 0, 0];
        this.ch = [0x80, 0x80, 0x80, 0x80];
        const self = this;
        this.cpu = new Z80({
            read(addr) { return self._read(addr); },
            write(addr, val) { self._write(addr, val); }
        });
        this.cpu.portRead = (port) => this._in(port);
        this.cpu.portWrite = (port, val) => this._out(port, val);
        this.reset();
    }

    setRamSize(kb) {
        this.ramKB = GS_RAM_SIZES[kb] ? kb : 512;
        this.ram = new Uint8Array(GS_RAM_SIZES[this.ramKB]);
        this.pages = this.ram.length >> 15;              // 32KB pages
    }

    loadRom(data) {
        if (data.length !== GS_ROM_SIZE) throw new Error(`General Sound ROM must be 32KB, got ${data.length} bytes`);
        this.rom = new Uint8Array(data);
    }

    hasRom() { return !!this.rom; }

    /** Port $33 bit 7: the card's own reset (CPU and paging; the mailbox stays) */
    resetCard() {
        this.cpu.reset();
        this.page = 0;
        this._intCount = 0;
        this._intPending = false;
        this._nmiPending = false;
    }

    reset() {
        this.resetCard();
        this.cmd = 0;           // Spectrum -> GS command ($BB)
        this.dataIn = 0;        // Spectrum -> GS data ($B3)
        this.dataOut = 0;       // GS -> Spectrum data
        this.status = 0x7E;
        this.vol.fill(0);
        this.ch.fill(0x80);
        this.t = 0;             // GS time, in Spectrum T-states of this frame
        this._ended = false;
        this.changes = [];      // { t, l, r } in Spectrum frame T-states
        this.level = [0, 0];
        this.startLevel = [0, 0];
    }

    // ---- GS side ----
    _read(addr) {
        let v;
        if (addr < 0x4000) v = this.rom ? this.rom[addr] : 0xFF;
        else if (addr < 0x8000) v = this.ram[addr];
        else v = this._high(addr, null);
        if ((addr & 0xE000) === 0x6000) {
            const c = (addr >> 8) & 3;
            if (this.ch[c] !== v) { this.ch[c] = v; this._level(); }
        }
        return v;
    }

    _write(addr, val) {
        if (addr < 0x4000) return;
        if (addr < 0x8000) this.ram[addr] = val;
        else this._high(addr, val);
    }

    // $8000-$FFFF through the page: read when val is null
    _high(addr, val) {
        const p = this.page;
        if (p === 0) return val === null ? (this.rom ? this.rom[addr - 0x8000] : 0xFF) : undefined;
        const off = (((p - 1) & (this.pages - 1)) << 15) + (addr - 0x8000);
        if (val === null) return this.ram[off];
        this.ram[off] = val;
    }

    _in(port) {
        switch (port & 0x0F) {
            case 1: return this.cmd;
            case 2: this.status &= 0x7F; return this.dataIn;
            case 3: this.status |= 0x80; this.dataOut = 0xFF; return 0xFF;
            case 4: return this.status;
            case 5: this.status &= 0xFE; return 0xFF;
            case 10: if (this.page & 1) this.status &= 0x7F; else this.status |= 0x80; return 0xFF;
            case 11: if (this.vol[0] & 0x20) this.status |= 1; else this.status &= 0xFE; return 0xFF;
        }
        return 0xFF;
    }

    _out(port, val) {
        switch (port & 0x0F) {
            case 0: this.page = val; break;
            case 2: this.status &= 0x7F; break;
            case 3: this.status |= 0x80; this.dataOut = val; break;
            case 5: this.status &= 0xFE; break;
            case 6: case 7: case 8: case 9:
                this.vol[(port & 0x0F) - 6] = val & 0x3F;
                this._level();
                break;
            case 10: if (this.page & 1) this.status &= 0x7F; else this.status |= 0x80; break;
            case 11: if (this.vol[0] & 0x20) this.status |= 1; else this.status &= 0xFE; break;
        }
    }

    // Output: channels 1+2 left, 3+4 right, each -1..1
    _level() {
        const s = (c) => (this.ch[c] - 0x80) * this.vol[c] / (128 * 63);
        const l = (s(0) + s(1)) / 2, r = (s(2) + s(3)) / 2;
        if (l !== this.level[0] || r !== this.level[1]) {
            this.level = [l, r];
            this.changes.push({ t: this.t, l, r });
        }
    }

    /** Run the GS until Spectrum frame T-state `specT` */
    syncTo(specT) {
        if (!this.rom) { this.t = Math.max(this.t, specT); return; }
        const cpu = this.cpu, k = this.specClock / GS_CLOCK;
        while (this.t < specT) {
            if (this._nmiPending && !cpu.eiPending) {
                const before = cpu.tStates;
                cpu.nmi();
                this._nmiPending = false;
                this._advance(cpu.tStates - before, k);
                continue;
            }
            if (this._intPending && cpu.iff1 && !cpu.eiPending) {
                const before = cpu.tStates;
                cpu.interrupt();
                this._intPending = false;
                this._advance(cpu.tStates - before, k);
                continue;
            }
            const before = cpu.tStates;
            if (cpu.halted) {
                if (cpu.eiPending) { cpu.eiPending = false; cpu.iff1 = cpu.iff2 = true; }
                cpu.tStates += 4;
                cpu.incR();
            } else {
                cpu.execute();
            }
            this._advance(cpu.tStates - before, k);
            if (cpu.tStates > 0x40000000) cpu.tStates = 0;
        }
    }

    _advance(cycles, k) {
        this.t += cycles * k;
        this._intCount += cycles;
        if (this._intCount >= GS_INT_PERIOD) {
            this._intCount -= GS_INT_PERIOD;
            this._intPending = true;
        }
    }

    /** End of a Spectrum frame: up to its last T-state */
    endFrame(frameT) {
        this.syncTo(frameT);
        this._ended = true;
    }

    /** Start of the next frame: count from 0 again, a fresh list of changes */
    beginFrame(frameT) {
        if (this._ended) { this.t -= frameT; this._ended = false; }
        this.changes = [];
        this.startLevel = this.level.slice();
    }

    // ---- Spectrum side (the caller syncs first) ----
    isPort(port) { return (port & 0xF7) === 0xB3; }

    /** Port $33 */
    control(val) {
        if (val & 0x80) this.resetCard();
        else if (val & 0x40) this._nmiPending = true;
    }

    portIn(port) {
        if (port & 0x08) return this.status;
        this.status &= 0x7F;
        return this.dataOut;
    }

    portOut(port, val) {
        if (port & 0x08) { this.cmd = val; this.status |= 0x01; }
        else { this.dataIn = val; this.status |= 0x80; }
    }
}
