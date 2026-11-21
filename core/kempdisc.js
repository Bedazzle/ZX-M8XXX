/**
 * ZX-M8XXX - Kempston Disc Interface (K-DOS)
 * @license GPL-3.0
 *
 * After MAME's bus/spectrum/kempdisc.cpp (BSD-3-Clause, MetalliC).
 * Abbeydale Designers 1985: a WD1770 and an 8KB ROM (K-DOS 2.0 / 2.1 / 2.1
 * Italian), up to four drives.
 *
 *   - ROM over $0000-$3FFF (8KB, mirrored), paged IN at reset and by OUT $FD,
 *     OUT by OUT $D7. K-DOS boots first, hooks stream #4 and pages itself
 *     out; its commands are PRINT #4: CAT / LOAD "name" / COPY / FORMAT.
 *   - WD1770 on $E5 (status/command), $E7 (track), $ED (sector), $EF (data):
 *     register = A1 | A3 << 1.
 *   - $DF out: bits 1-4 select drive 0-3 (the lowest set wins), bit 0 side;
 *     bits 5-7 unknown (MAME: probably /DDEN, /MR).
 *   - Low byte $FD is also the 128K's paging port ($7FFD, A1 = 0), so the
 *     stock interface is for a 48K.
 *
 * The 128A6 modification (Mario Prato; ROM "KDI DOS 2.1 128A6", CRC 69405CFB,
 * speccy4ever.speccy.org) makes it work on a 128K, as read from its ROM: the
 * register select moves from A1 to A6 and A1 is always 1, so nothing of the
 * interface answers the 128K's A1 = 0 paging port:
 *   - WD1770 on $A7 (status/command), $E7 (track), $AF (sector), $EF (data):
 *     register = A6 | A3 << 1;
 *   - the ROM pages in with OUT $BF (not $FD); $D7 out and $DF stay;
 *   - its ROM starts with OUT ($7FFD),$10 (48 BASIC ROM) and goes on as on a
 *     48K. The K128_* disks (and R-Type 2019) are for this board.
 * Confirmed by the board's schematic (KDI_128-A6_SCHEME: WD A0 = A6, A1 = A3;
 * "Port BF", "Port D7", "Port DF").
 * The 2.1J ROMs (Jane McKay): the sector write loop from the DISCiPLE ROM,
 * with twice the DRQ margin, for 128K contended banks; A1J for the stock
 * board (locks the 128K to 48K), A6J for the 128A6 one.
 *
 * Disks: DSK / EDSK (x128's .kdi are EDSK: 80 x 2 x 10 x 512), read by C/H/R.
 */

import { Fdd3000Fdc } from './fdd3000.js';

export const KEMPDISC_ROM_SIZE = 8192;
export const KEMPDISC_FDC_PORTS = [0xE5, 0xE7, 0xED, 0xEF];
export const KEMPDISC_A6_FDC_PORTS = [0xA7, 0xE7, 0xAF, 0xEF];
// The ROM files of the 128A6 board (see above); and those that go on a 128K
// (the A6 ones, and 2.1J for the stock board, which locks the 128K to 48K)
export const KEMPDISC_A6_ROMS = ['kdos21-128a6.rom', 'kdos21-a6j.rom'];
export const KEMPDISC_128_ROMS = [...KEMPDISC_A6_ROMS, 'kdos21-a1j.rom'];
// Status reads, with no ID byte taken, after which a Read Address is over
export const KEMPDISC_RA_POLLS = 32;

/** The FDD 3000's WD model (DSK by C/H/R, four drives), with INTRQ at once */
export class KempstonDiscFdc extends Fdd3000Fdc {
    get intrq() { return !!this._intrqLine; }
    set intrq(v) { this._intrqLine = !!v; }

    // K-DOS tests a drive with Read Address and only waits for BUSY to drop,
    // never taking the six ID bytes. A real WD finishes the command when the
    // ID field has gone by anyway, with Lost Data. Here: a Read Address whose
    // status is polled while no byte is taken completes that way.
    executeCommand(cmd) {
        this._raPolls = 0;
        super.executeCommand(cmd);
        this._readAddress = (cmd & 0xF0) === 0xC0 && this.reading;
    }

    readRegister(reg) {
        if ((reg & 3) === 3 && this._readAddress) this._raPolls = 0;
        if ((reg & 3) === 0 && this._readAddress && this.reading && ++this._raPolls > KEMPDISC_RA_POLLS) {
            this.reading = false;
            this._readAddress = false;
            this.status = (this.status & ~(this.BUSY | this.DRQ)) | 0x04;     // Lost Data
            this.intrq = true;
        }
        return super.readRegister(reg);
    }
}

export class KempstonDisc {
    constructor() {
        this.rom = null;
        this.fdc = new KempstonDiscFdc();
        this.active = true;         // ROM paged in (romcs)
        this.control = 0;
        this.a6 = false;            // the 128A6 modification (see above)
    }

    /** Stock (48K) or the 128A6 board */
    setA6(on) { this.a6 = !!on; }

    loadRom(data) {
        if (data.length !== KEMPDISC_ROM_SIZE) {
            throw new Error(`Kempston Disc ROM must be 8KB, got ${data.length} bytes`);
        }
        this.rom = new Uint8Array(data);
    }

    hasRom() { return !!this.rom; }

    reset() {
        this.active = true;
        this.control = 0;
        this.fdc.reset();
        this.fdc.selected = false;
    }

    readMemory(addr) { return this.rom ? this.rom[addr & 0x1FFF] : 0xFF; }

    fdcReg(low) { return ((this.a6 ? low >> 6 : low >> 1) & 1) | (((low >> 3) & 1) << 1); }

    isFdcPort(low) { return (this.a6 ? KEMPDISC_A6_FDC_PORTS : KEMPDISC_FDC_PORTS).includes(low); }

    portIn(low) { return this.fdc.readRegister(this.fdcReg(low)); }

    /** A Spectrum OUT; true when the port is the interface's */
    portOut(port, val) {
        const low = port & 0xFF;
        if (this.isFdcPort(low)) { this.fdc.writeRegister(this.fdcReg(low), val); return true; }
        if (low === 0xDF) { this._select(val); return true; }
        if (low === (this.a6 ? 0xBF : 0xFD)) { this.active = true; return true; }
        if (low === 0xD7) { this.active = false; return true; }
        return false;
    }

    _select(val) {
        this.control = val;
        let drive = -1;
        for (let i = 1; i < 5; i++) if (val & (1 << i)) { drive = i - 1; break; }
        this.fdc.selected = drive >= 0 && !!this.fdc.drives[drive].dsk;
        if (drive >= 0) this.fdc.drive = drive;
        this.fdc.side = val & 1;
    }
}
