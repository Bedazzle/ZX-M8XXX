/**
 * ZX-M8XXX - Timex FDD 3000 disk station
 * @license GPL-3.0-or-later
 *
 * Derived from the FUSE patch fdd3000e 0.2.1.1 by Sławomir Szczyrba
 * (sourceforge.net/projects/fdd3000e): fdd3000.c, ti397.c, fdd3boot.h and the
 * z80_ops.c hooks. Those files are LGPL-2.0-or-later ("version 2 of the
 * License, or (at your option) any later version"), Copyright (C) 2018 by
 * Sławomir Szczyrba, and the copyright stays with him; the "or later"
 * clause is what lets the work be carried into this GPL-3.0-or-later one.
 *
 * The FDD 3000 is a computer of its own: a Z80 with 64KB of RAM, a 2KB boot
 * ROM and a WD1770/1772, talking to the Spectrum through two byte latches.
 *
 * Spectrum side (the TI-397 interface board):
 *   - a 4KB ROM (fdd3stavi.rom for the Spectrum, fdd3timex.rom for the
 *     TC2068), mirrored over $0000-$1FFF, and 8KB of RAM at $2000-$3FFF;
 *   - paged IN when an opcode is fetched from $0000 or $0008, paged OUT once
 *     the instruction at $0604 (RET) has run;
 *   - port $xxEF: write = Spectrum -> station latch, read = station -> Spectrum.
 *
 * Station side (its own Z80, stepped once per Spectrum instruction and twice
 * every fifth, as in FUSE):
 *   - $0000-$07FF boot ROM while "paged" (after reset), RAM elsewhere; writes
 *     always go to RAM above $0800;
 *   - I/O by A7-A5: 1 ($20) out = station -> Spectrum latch, in = Spectrum ->
 *     station latch | DRQ (bit 7); 6 ($C0) = WD177x registers (A1-A0);
 *     7 ($E0) out = drive select / side / density / head (active low) and
 *     bit 6 = 1 pages the boot ROM out; 0, 2-5 are serial ports (not emulated);
 *   - the WD INTRQ drives the station Z80's INT.
 *
 * Disks: DSK images (TOS / CP/M: 40 tracks, 16 x 256-byte sectors numbered
 * 0-15), up to four drives.
 */

import { Z80 } from './z80.js';
import { DSKImage, DSKLoader } from './fdc.js';
import { PlusDDisk } from './loaders/disk-mgt.js';

export const FDD3000_ROM_SIZE = 4096;       // Spectrum-side interface ROM
export const FDD3000_RAM_SIZE = 8192;       // Spectrum-side interface RAM
export const FDD3000_BOOT_SIZE = 2048;      // station boot ROM
export const FDD3000_PAGE_IN = [0x0000, 0x0008];
export const FDD3000_PAGE_OUT = 0x0604;
// boot(): a station that has read port $20 this many times in a row, with no
// other I/O, is waiting for the Spectrum; and the most it may take to get there
export const FDD3000_IDLE_POLLS = 3000;
export const FDD3000_BOOT_MAX_STEPS = 8000000;
// Station instructions between a command ending and INTRQ rising (see Fdd3000Fdc)
export const FDD3000_INTRQ_DELAY = 64;

/**
 * The station's WD177x: the +D's model (instant completion, polled DRQ),
 * reading sectors by C/H/R from DSK images in four drives.
 */
export class Fdd3000Fdc extends PlusDDisk {
    constructor() {
        super();
        this.drives = [0, 1, 2, 3].map(() => ({ dsk: null, diskData: null, diskType: null, headTrack: 0, name: null }));
        this.firstSector = 0;
        this.sectorsPerTrack = 16;
        this.bytesPerSector = 256;
        this.selected = false;      // a drive is selected at all
        this._idIndex = 0;          // which ID a Read Address returns next
    }

    // INTRQ, delayed. The +D model completes a command the moment it is
    // written and raises INTRQ there and then; TOS writes a Seek, reads the
    // status (which clears INTRQ), does EI and only then waits for the
    // interrupt to end the command. So the line rises a few station
    // instructions after the model sets it (tick()), as the real chip's
    // would at the end of the command.
    get intrq() { return !!this._intrqLine; }
    set intrq(v) {
        if (v) {
            if (!this._intrqLine && !this._intrqDelay) this._intrqDelay = FDD3000_INTRQ_DELAY;
        } else {
            this._intrqLine = false;
            this._intrqDelay = 0;
        }
    }

    /** One station instruction has passed */
    tick() {
        if (this._intrqDelay && --this._intrqDelay === 0) this._intrqLine = true;
    }

    loadDisk(data, type, driveIndex = 0) {
        const drv = this.drives[driveIndex & 3];
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        drv.dsk = DSKLoader.parse(bytes);
        drv.diskData = bytes;           // hasDisk()/currentDisk checks look at this
        drv.diskType = 'dsk';
        drv.headTrack = 0;
    }

    ejectDisk(driveIndex) {
        const drv = this.drives[driveIndex & 3];
        drv.dsk = null; drv.diskData = null; drv.diskType = null; drv.name = null;
    }

    hasDisk(driveIndex) { return !!this.drives[driveIndex & 3].dsk; }
    hasAnyDisk() { return this.drives.some(d => d.dsk); }

    /** The disk as it is now (written sectors included), as an EDSK file. */
    getDiskImage(driveIndex) {
        const d = this.drives[driveIndex & 3].dsk;
        return d ? d.toBuffer() : null;
    }

    readRegister(reg) {
        // Reading the status register clears INTRQ (as FUSE's wd_fdc_sr_read)
        if ((reg & 3) === 0) {
            const st = this.selected ? super.readRegister(0) : this.NOT_READY;
            this._intrqLine = false;    // a command still running will raise it later
            return st;
        }
        return super.readRegister(reg);
    }

    executeCommand(cmd) {
        if (!this.selected && (cmd & 0xF0) !== 0xD0) {
            this.status = this.NOT_READY;
            this.intrq = true;
            return;
        }
        // Seek/step move the head of the selected drive; the +D model keeps the
        // track register and the head together, which is all a DSK needs.
        if ((cmd & 0xF0) === 0xC0) {
            // Read Address: the IDs of the current track, in turn
            const dsk = this.currentDisk.dsk;
            const t = dsk && dsk.getTrack(this.currentDisk.headTrack, this.side);
            this.lastCmdType = 3;
            this.intrq = false;
            if (!t || !t.sectors.length) {
                this.status = this.RNF;
                this.intrq = true;
                return;
            }
            const s = t.sectors[this._idIndex++ % t.sectors.length];
            this.dataBuffer = new Uint8Array([s.cylinder, s.head, s.id, s.sizeCode, 0, 0]);
            this.dataPos = 0;
            this.dataLen = 6;
            this.reading = true;
            this.status = this.BUSY | this.DRQ;
            // WD: the track address lands in the sector register
            this.sector = s.cylinder;
            return;
        }
        super.executeCommand(cmd);
    }

    _sector() {
        const drv = this.currentDisk;
        if (!drv.dsk) return null;
        const t = drv.dsk.getTrack(drv.headTrack, this.side);
        if (!t) return null;
        return t.sectors.find(s => s.id === this.sector && s.cylinder === this.track) ||
               t.sectors.find(s => s.id === this.sector) || null;
    }

    readSector() {
        if (this.onDiskActivity) this.onDiskActivity('read', this.track, this.sector, this.side, this.drive);
        const s = this._sector();
        if (!s) {
            this.status = (this.status | this.RNF) & ~this.BUSY;
            this.reading = false;
            this.intrq = true;
            return;
        }
        this.dataBuffer = s.data.slice();
        this.dataPos = 0;
        this.dataLen = s.data.length;
        this.reading = true;
        this.status |= this.DRQ | this.BUSY;
    }

    writeSector() {
        if (this.onDiskActivity) this.onDiskActivity('write', this.track, this.sector, this.side, this.drive);
        const s = this._sector();
        if (!s) {
            this.status = (this.status | this.RNF) & ~this.BUSY;
            this.writing = false;
            this.intrq = true;
            return;
        }
        this._writeTarget = s;
        this.dataBuffer = new Uint8Array(s.data.length);
        this.dataPos = 0;
        this.dataLen = s.data.length;
        this.writing = true;
        this.status |= this.DRQ | this.BUSY;
    }

    flushWriteBuffer() {
        if (this._writeTarget && this.dataBuffer) {
            this._writeTarget.data.set(this.dataBuffer.subarray(0, this._writeTarget.data.length));
            this.currentDisk.dirty = true;
        }
    }

    /** DRQ as the station sees it on port $20 bit 7 */
    get drq() {
        return (this.reading || this.writing) && this.dataBuffer && this.dataPos < this.dataLen;
    }
}

export class Fdd3000 {
    constructor() {
        this.rom = null;                                // 4KB interface ROM
        this.ram = new Uint8Array(FDD3000_RAM_SIZE);    // interface RAM
        this.bootRom = null;                            // 2KB station boot ROM
        this.stationRam = new Uint8Array(65536);
        this.fdc = new Fdd3000Fdc();
        this.ti2fdd = 0;        // Spectrum -> station
        this.fdd2ti = 0;        // station -> Spectrum
        this.bootPaged = true;
        this._counter = 0;
        this._idlePolls = 0;

        const self = this;
        this.cpu = new Z80({
            read(addr) {
                return (self.bootPaged && addr < FDD3000_BOOT_SIZE)
                    ? (self.bootRom ? self.bootRom[addr] : 0xFF)
                    : self.stationRam[addr];
            },
            write(addr, val) {
                // FUSE: Addr > 2048 — the byte at $0800 is only writable unpaged
                if (!self.bootPaged || addr > FDD3000_BOOT_SIZE) self.stationRam[addr] = val;
            }
        });
        this.cpu.portRead = (port) => this._stationIn(port);
        this.cpu.portWrite = (port, val) => this._stationOut(port, val);
    }

    loadRom(data) {
        if (data.length !== FDD3000_ROM_SIZE && data.length !== 2 * FDD3000_ROM_SIZE) {
            throw new Error(`FDD 3000 interface ROM must be 4KB, got ${data.length} bytes`);
        }
        this.rom = new Uint8Array(data.subarray ? data.subarray(0, FDD3000_ROM_SIZE) : data.slice(0, FDD3000_ROM_SIZE));
    }

    loadBootRom(data) {
        if (data.length !== FDD3000_BOOT_SIZE) {
            throw new Error(`FDD 3000 boot ROM must be 2KB, got ${data.length} bytes`);
        }
        this.bootRom = new Uint8Array(data);
    }

    hasRoms() { return !!(this.rom && this.bootRom); }

    /** Spectrum-side overlay read ($0000-$3FFF while paged) */
    readMemory(addr) {
        return addr < 0x2000 ? this.rom[addr & 0x0FFF] : this.ram[addr - 0x2000];
    }

    writeMemory(addr, val) {
        if (addr >= 0x2000) this.ram[addr - 0x2000] = val;
    }

    // Port $EF from the Spectrum
    portIn() { return this.fdd2ti; }
    portOut(val) { this.ti2fdd = val; }

    /**
     * Reset: the station's CPU, latches and controller (FUSE resets the
     * station only at power-on; a Spectrum reset with the hard flag does it
     * too). The interface RAM is cleared on a hard reset only.
     */
    reset(hard = true) {
        if (hard) this.ram.fill(0);
        this.cpu.reset();
        this.bootPaged = true;
        this.ti2fdd = 0;
        this.fdd2ti = 0;
        this._counter = 0;
        this.fdc.reset();
        this.fdc.selected = false;
    }

    /**
     * "FDD3000 reset" without the wait: restart the station and run it on its
     * own until it sits polling port $20 for the Spectrum (TOS or CP/M loaded,
     * or nothing to boot). The boot ROM's delay loops alone take some 3 million
     * instructions — seconds of real time otherwise. Returns the steps taken.
     */
    boot(maxSteps = FDD3000_BOOT_MAX_STEPS) {
        this.reset(false);
        this._idlePolls = 0;
        let n = 0;
        while (n < maxSteps && this._idlePolls < FDD3000_IDLE_POLLS) {
            this._stepOnce();
            n++;
        }
        return n;
    }

    /** Is the station waiting for the Spectrum (no disk or other I/O lately)? */
    isIdle() { return this._idlePolls >= FDD3000_IDLE_POLLS; }

    /**
     * What a DSK holds, by its boot sector (track 0, sector 0): 'tos' (TOS
     * system: 01 C3 00 60...), 'cpm' (CP/M boot: ED 56 = IM 1), or 'none'.
     */
    static diskKind(dsk) {
        const s = dsk && dsk.readSector(0, 0, 0);
        if (!s) return 'none';
        if (s[0] === 0x01 && s[1] === 0xC3) return 'tos';
        if (s[0] === 0xED && s[1] === 0x56) return 'cpm';
        return 'none';
    }

    /** A TOS disk carrying Monitor Emulator (the Spectrum's CP/M terminal) */
    static isMonitorDisk(dsk) {
        if (Fdd3000.diskKind(dsk) !== 'tos') return false;
        for (let s = 0; s < 16; s++) {
            const d = dsk.readSector(4, 0, s);
            if (d && String.fromCharCode(...d).includes('MONITOR')) return true;
        }
        return false;
    }

    /** Run the station for one Spectrum instruction (FUSE: 1, every 5th: 2). */
    step() {
        this._stepOnce();
        if (++this._counter >= 5) {
            this._counter = 0;
            this._stepOnce();
        }
    }

    _stepOnce() {
        const cpu = this.cpu;
        this.fdc.tick();
        if (this.fdc.intrq && cpu.iff1 && !cpu.eiPending) {
            cpu.interrupt();
        }
        if (cpu.halted) {
            if (cpu.eiPending) { cpu.eiPending = false; cpu.iff1 = cpu.iff2 = true; }
            cpu.tStates += 4;
            cpu.incR();
            return;
        }
        cpu.execute();
        // Nothing reads the station's clock; keep the counter from growing
        if (cpu.tStates > 0x40000000) cpu.tStates = 0;
    }

    _stationIn(port) {
        switch ((port & 0xFF) >> 5) {
            case 1: this._idlePolls++; return this.ti2fdd | (this.fdc.drq ? 0x80 : 0);
            case 6: this._idlePolls = 0; return this.fdc.readRegister(port & 3);
            default: return 0xFF;      // serial ports, write-only config
        }
    }

    _stationOut(port, val) {
        switch ((port & 0xFF) >> 5) {
            // not activity: the waiting loops toggle this ($00/$40) themselves
            case 1: this.fdd2ti = val; break;
            case 6: this._idlePolls = 0; this.fdc.writeRegister(port & 3, val); break;
            case 7: this._idlePolls = 0; this._writeConfig(val); break;
            default: break;            // serial ports: not emulated
        }
    }

    /**
     * Config latch (active low): bits 0-3 /select drive 0-3, bit 4 side,
     * bit 5 /DDEN, bit 6 = 1 boot ROM out, bit 7 /head up.
     */
    _writeConfig(value) {
        const v = (value ^ 0xFF) & 0xBF;
        const sel = v & 0x0F;
        const drive = sel & 1 ? 0 : sel & 2 ? 1 : sel & 4 ? 2 : sel & 8 ? 3 : -1;
        this.fdc.selected = drive >= 0 && !!this.fdc.drives[drive].dsk;
        if (drive >= 0) this.fdc.drive = drive;
        this.fdc.side = (v & 0x10) ? 1 : 0;
        this.bootPaged = !(value & 0x40);
    }
}
