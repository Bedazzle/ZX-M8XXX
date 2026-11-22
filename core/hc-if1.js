/**
 * ZX-M8XXX - HC IF1: the HC-2000's Interface 1 with a floppy controller
 * @license GPL-3.0-or-later
 *
 * Derived from if1_fdc.c by Alex Badea, in FUSE (the Free Unix Spectrum
 * Emulator), fuse-emulator-svn branch hc2000-v2. That file is
 * GPL-2.0-or-later and its copyright stays with its authors; the "or later"
 * clause is what lets it be carried into this GPL-3.0-or-later work.
 *
 * The HC IF1 is an Interface 1 whose microdrive was replaced by an i8272
 * (µPD765) floppy controller. It pages in exactly like an Interface 1
 * ($0008/$1708 in, $0700 out), but over 16KB instead of 8KB:
 *   $0000-$3FFF  16KB ROM (hc-if1.rom)
 *   $2800-$2FFF, $3800-$3FFF  1KB of static RAM, mirrored, over the ROM
 * The FDC is polled (no DMA, no interrupt) on its own ports, which are only
 * decoded when A4-A6 are all low — the microdrive/network ports keep A5-A7 high:
 *   $85        MSR (read)
 *   $87        data register (read/write)
 *   $05/$07    select latch (mask $FD):
 *     write: D0 = Terminal Count, D1 = drive 0, D2 = drive 1, D3 = armed,
 *            D4 = 0 resets the FDC. Disarming starts a 555 monostable that
 *            drops the motors about 1.7s later.
 *     read:  D0 = 0 while any drive motor turns, everything else 1.
 * TC is wired, unlike on the +3: the ROM reads one sector of R..EOT=16 and
 * pulses TC (see UPD765.terminalCount()).
 */

import { UPD765 } from './fdc.js';

export const HC_IF1_RAM_SIZE = 1024;
// 470 kOhm and 3.3 uF: about 1.7 seconds (FUSE uses 17/10 of a second)
const DESELECT_SECONDS = 1.7;

export class HcIf1 {
    constructor() {
        this.fdc = new UPD765();
        this.fdc.tcConnected = true;
        this.ram = new Uint8Array(HC_IF1_RAM_SIZE);
        this.armed = false;
        this.selected = [false, false];
        this.deselectAt = -1;           // absolute T-state when the 555 drops the motors
    }

    reset(hard = true) {
        this.fdc.reset();
        if (hard) this.ram.fill(0);
        this.armed = false;
        this.selected = [false, false];
        this.deselectAt = -1;
        this.fdc.setMotor(false);
    }

    /** True for the ports the HC IF1 decodes itself ($05/$07, $85, $87). */
    static isFdcPort(lowByte) {
        return (lowByte & 0x70) === 0 &&
            ((lowByte & 0xFD) === 0x05 || lowByte === 0x85 || lowByte === 0x87);
    }

    // The monostable is checked lazily: whoever asks about the motors brings
    // the time with them.
    _tick(now) {
        if (this.deselectAt >= 0 && now >= this.deselectAt) {
            this.deselectAt = -1;
            this.selected = [false, false];
            this.fdc.setMotor(false);
        }
    }

    /** IN from one of the FDC ports. `now` = absolute T-state count. */
    read(lowByte, now) {
        this._tick(now);
        if (lowByte === 0x85) return this.fdc.readMSR();
        if (lowByte === 0x87) return this.fdc.readData();
        // $05/$07: bit 0 low while a motor turns
        return this.fdc.drives.some(d => d.motorOn) ? 0xFE : 0xFF;
    }

    /** OUT to one of the FDC ports. */
    write(lowByte, val, now, cpuHz) {
        this._tick(now);
        if (lowByte === 0x87) { this.fdc.writeData(val); return; }
        if (lowByte === 0x85) return;               // MSR is read-only
        // $05/$07: the select latch
        if (!(val & 0x10)) this.fdc.reset();
        if (val & 0x01) this.fdc.terminalCount();
        this.armed = (val & 0x08) !== 0;
        if (this.armed) {
            this.deselectAt = -1;
            this.selected = [(val & 0x02) !== 0, (val & 0x04) !== 0];
            this.fdc.drives[0].motorOn = this.selected[0];
            this.fdc.drives[1].motorOn = this.selected[1];
        } else {
            this.deselectAt = now + Math.round(DESELECT_SECONDS * cpuHz);
        }
    }

    getState() {
        return {
            ram: Array.from(this.ram),
            armed: this.armed,
            selected: this.selected.slice(),
            deselectAt: this.deselectAt
        };
    }

    setState(s) {
        if (!s) return;
        if (Array.isArray(s.ram)) this.ram.set(s.ram.slice(0, HC_IF1_RAM_SIZE));
        this.armed = !!s.armed;
        this.selected = Array.isArray(s.selected) ? s.selected.slice(0, 2) : [false, false];
        this.deselectAt = typeof s.deselectAt === 'number' ? s.deselectAt : -1;
    }
}
