/**
 * ZX-M8XXX - Memory Management
 * @version 0.6.5
 * @license GPL-3.0
 *
 * Supports 48K, 128K, +2A, and Pentagon memory banking.
 * +2A adds port 0x1FFD with special all-RAM paging and 4 ROM banks.
 * Pentagon includes Beta Disk interface with separate TR-DOS ROM.
 */

import { getMachineProfile } from './machines.js';
import {
    PAGE_SIZE, BANK_MASK, SLOT1_START, SLOT2_START, SLOT3_START,
    DECODE_128K_MASK, DECODE_PLUS2A_MASK, DECODE_7FFD_PLUS2A,
    DECODE_PLUS2A_MASK2, DECODE_1FFD_PLUS2A,
    P7FFD_RAM_MASK, P7FFD_SCREEN_BIT, P7FFD_ROM_BIT, P7FFD_LOCK_BIT, P7FFD_P1024_EXT,
    DIDAKTIK_ROM_SIZE, DIDAKTIK_RAM_START
} from './constants.js';

// ProfROM plane switch (MAME scorpion.cpp prof_plane_map): indexed by
// (address & $0C) | current plane, for reads of $0100/$0104/$0108/$010C
const PROF_PLANE_MAP = [0, 1, 2, 3, 3, 3, 3, 2, 2, 2, 0, 1, 1, 0, 1, 0];

    export class Memory {
        constructor(machineType = '48k') {
            this.machineType = machineType;
            this.profile = getMachineProfile(machineType);
            this.rom = null;
            this.ram = null;
            this.trdosRom = null;      // Separate TR-DOS ROM (16KB) for Beta Disk
            this.trdosActive = false;  // True when TR-DOS ROM is paged in
            // Beta 48 (core/beta48.js): its ROM answers any access to $3C00-$3CFF,
            // and all of $0000-$3FFF while the latch (port $FF bit 7 = 0) is set.
            // No paging state of its own: it is decided access by access.
            this.beta48On = false;        // Beta 48 fitted (Spectrum.updateBetaDiskPagingFlag)
            this.beta48Rom = null;        // 16KB, bits straightened, 8KB ROMs doubled
            this.beta48Latch = false;     // ROM over the whole $0000-$3FFF
            this.beta48WindowOff = false; // CBI clones: master bit 6 = no $3Cxx window
            // TKMEM-128 II (github.com/lrrosa/tkmem128-ii): external 128K/512K RAM
            // for a 48K/TK90X. It replaces the host's $8000-$FFFF: $8000 is bank 2,
            // $C000 the bank in its 7FFD-style latch. $4000-$7FFF (screen) stays
            // the machine's own RAM, so there is no shadow screen. 48K only.
            this.tkmemRam = null;         // Uint8Array(128K or 512K) while fitted
            // Timex FDD 3000 interface (core/fdd3000.js): 4KB ROM mirrored over
            // $0000-$1FFF and 8KB RAM at $2000-$3FFF while paged in
            this.fdd3000 = null;          // the Fdd3000 (set by Spectrum)
            // Timex SCLD (TC2048): DEC (port $FF: display mode, INT mask, bank
            // select) and HSR (port $F4: 8KB chunks switched to DOCK/EXROM,
            // which are empty on a TC2048 -- they read $FF and ignore writes)
            this.timexDec = 0;
            this.timexHsr = 0;
            // DOCK / EXROM chunk overrides from a DCK cartridge: 8 entries each,
            // null or { data: Uint8Array(8KB), writable }. Set by Spectrum.
            this.timexDock = null;
            this.timexExrom = null;
            // Didaktik Gama: the second 32KB bank at $8000-$FFFF (bank 0 is the
            // ordinary 48K block), selected by gamaBank (its 8255's PC0)
            this.gamaBank1 = this.profile.gama80k ? new Uint8Array(32768) : null;
            this.gamaBank = 0;
            this.fdd3000Active = false;
            this.kempdiscActive = false;
            this.tkmem512 = false;        // JP3 closed: latch bits 6-7 = bank bits 3-4
            this.tkmemLatch = 0;          // last value latched
            this.tkmemBank = 0;           // bank at $C000
            this.tkmemLocked = false;     // bit 5: no more writes until reset
            this.pagingDisabled = false;
            this.currentRomBank = 0;
            this.currentRamBank = 0;
            this.screenBank = 5;
            this.contentionEnabled = false;
            this.allowRomEdit = false;

            // +2A-specific state
            this.port1FFD = 0;             // Last value written to port 0x1FFD
            this.specialPagingMode = false; // True when port 0x1FFD bit 0 is set
            this.specialBanks = [0, 1, 2, 3]; // RAM banks mapped to each 16K slot in special mode

            // Pentagon 1024-specific state
            this.portEFF7 = 0;              // Last value written to port 0xEFF7
            this.pentagon1024Mode = false;   // true = 1MB mode (bit 5 of 7FFD = bank bit)
            this.ramInRomMode = false;       // true = RAM page 0 mapped at 0x0000-0x3FFF

            // Scorpion ZS 256-specific state
            this.scorpionPort1FFD = 0;          // Last value written to port 0x1FFD
            this.scorpionPort7FFD = 0;          // Last value written to port 0x7FFD (for ROM bank fallback)
            this.scorpionRamInRomMode = false;  // true = RAM page 0 mapped at 0x0000-0x3FFF
            // Scorpion TURBO+ ProfROM: four 64KB planes of four 16KB ROMs each;
            // the ROM read is rom[plane * 4 + bank] (0 on every other machine)
            this.romPlane = 0;
            this.inspecting = false;   // peek(): a read without side effects

            // +D (DISCiPLE/+D) interface state
            this.plusDActive = false;     // True when +D ROM/RAM paged in at 0x0000-0x3FFF
            this.plusDRom = null;         // 8KB ROM (Uint8Array)
            this.plusDRam = new Uint8Array(8192); // 8KB RAM

            // DISCiPLE interface state. The ROM and the RAM share 0x0000-0x3FFF in
            // either order: after a reset (or IN 0x7B) the ROM is low and the RAM
            // at 0x2000; GDOS then OUTs 0x7B to put its RAM (the system file) low.
            this.discipleActive = false;  // True when DISCiPLE memory is paged in
            this.discipleRomLow = true;   // ROM at 0x0000 (true) or at 0x2000 (false)
            this.discipleRom = null;      // 8KB or 16KB ROM (16KB: bank = port 0x1F bit 3)
            this.discipleRomBank = 0;
            this.discipleRam = new Uint8Array(8192);

            // Interface 1 (Microdrive) state
            this.if1Active = false;      // True when IF1 ROM paged in at 0x0000-0x1FFF
            this.if1Rom = null;          // 8KB ROM (Uint8Array)

            // Opus Discovery state. Unlike every other interface here the Opus
            // puts its FDC and PIA in the MEMORY map rather than on I/O ports,
            // so reads and writes in $2800-$37FF have to reach the controller.
            this.opusActive = false;     // True when the Opus window is paged in
            this.opusRom = null;         // 8KB ROM (Uint8Array)
            this.opusRam = new Uint8Array(2048);  // 2KB RAM at 0x2000-0x27FF
            this.opusDisk = null;        // OpusDisk instance (register window)

            // Didaktik 80 state. Its ROM is 14KB, not 8KB like the others, and
            // it covers $0000-$37FF with 2KB of RAM above it — so the overlay
            // fills the whole bottom 16KB.
            this.didaktikActive = false;
            // The Didaktik 128K hardware patch hardwires ROM 1 (48K BASIC): the
            // interface's own ROM runs from reset and expects the 48K ROM under
            // it, so bank 0 -- the 128 editor -- must never be selected. Set by
            // Spectrum.updateBetaDiskPagingFlag(); false on every other machine.
            this.didaktikForceRom1 = false;
            this.didaktikRom = null;              // 14KB ROM (Uint8Array)
            this.didaktikRam = new Uint8Array(2048);  // 2KB RAM at 0x3800-0x3FFF

            // HC-2000 state (Romanian clone, see _hcRemap). RAM uses the 128K bank
            // numbers so the rest of the emulator needs no special case:
            // 0 = RAM under the ROM (CP/M), 5 = $4000, 2 = $8000, 7 = $C000.
            // The video page switch (CVS) is then exactly the 128K shadow screen.
            this.hcConfig = 0;           // Port $7E: D0 B/OL, D1 CPMPL, D2 lock, D3 CVS
            this.hcLocked = false;       // Set by D2: further $7E writes are ignored
            this.hcMemPort = 0xC5;       // Last of $C5/$C7 written: $C7 = CPM signal on
            this.hcR = null;             // 8 read views of 8KB, one per $2000 slot
            this.hcW = null;             // 8 write views (null = ROM, writes ignored)
            // HC IF1 (core/hc-if1.js): 16KB ROM paged in with if1Active, and 1KB of
            // RAM at $2800-$2FFF/$3800-$3FFF (mirrored). The RAM belongs to the
            // HcIf1 object so it survives a new Memory; Spectrum links it here.
            this.hcIf1Rom = null;
            this.hcIf1Ram = null;

            // Watchpoint callbacks
            this.onRead = null;  // function(addr, val) - called on read
            this.onWrite = null; // function(addr, val) - called on write

            this.init();
        }

        init() {
            const p = this.profile;
            // Allocate ROM banks
            this.rom = [];
            for (let i = 0; i < p.romBanks; i++) {
                this.rom.push(new Uint8Array(PAGE_SIZE));
            }
            // Allocate RAM
            if (p.ramPages === 1) {
                // 48K special case: single 48K block
                this.ram = [new Uint8Array(3 * PAGE_SIZE)];
            } else {
                this.ram = [];
                for (let i = 0; i < p.ramPages; i++) {
                    this.ram.push(new Uint8Array(PAGE_SIZE));
                }
            }
            // TR-DOS ROM (available for all machine types)
            this.trdosRom = new Uint8Array(PAGE_SIZE);
            this.reset();
        }

        reset() {
            if (this.profile.ramPages === 1) {
                this.ram[0].fill(0);
            } else {
                for (let bank of this.ram) {
                    bank.fill(0);
                }
            }
            this.pagingDisabled = false;
            this.fdd3000Active = false;
            this.kempdiscActive = false;
            this.timexDec = 0;
            this.timexHsr = 0;
            this.gamaBank = 0;
            if (this.gamaBank1) this.gamaBank1.fill(0);
            if (this.tkmemRam) this.tkmemRam.fill(0);
            this.tkmemLatch = 0;
            this.tkmemBank = 0;
            this.tkmemLocked = false;
            this.currentRomBank = this.didaktikForceRom1 ? 1 : 0;
            this.currentRamBank = 0;
            this.screenBank = 5;
            this.trdosActive = false;
            this.port1FFD = 0;
            this.specialPagingMode = false;
            this.specialBanks = [0, 1, 2, 3];
            this.portEFF7 = 0;
            this.pentagon1024Mode = false;
            this.ramInRomMode = false;
            this.scorpionPort1FFD = 0;
            this.scorpionPort7FFD = 0;
            this.scorpionRamInRomMode = false;
            this.romPlane = 0;
            this.plusDActive = false;
            this.plusDRam.fill(0);
            // DISCiPLE: the reset button sets the ROM low and pages out; the
            // static RAM keeps its contents (GDOS relies on that, see port 0x7B)
            this.discipleActive = false;
            this.discipleRomLow = true;
            this.discipleRomBank = 0;
            this.if1Active = false;
            this.opusActive = false;
            this.opusRam.fill(0);
            this.didaktikActive = false;
            this.didaktikRam.fill(0);
            if (this.profile.pagingModel === 'hc2000') {
                // Reset clears the config latch, its lock and the CPM signal
                this.hcConfig = 0;
                this.hcLocked = false;
                this.hcMemPort = 0xC5;
                this._hcRemap();
            }
        }

        /**
         * HC-2000 memory map (per Alex Badea's FUSE hc2000.c, branch hc2000-v2).
         *
         * Port $7E (decoded as A7=0, A0=0):
         *   D0 B/OL  - ROM select: 0 = BASIC, 1 = CP/M (A14 of the 32KB ROM chip)
         *   D1 CPMPL - CP/M decoding: RAM at $0000-$3FFF, and the upper 8KB of
         *              the selected ROM at $E000-$FFFF instead
         *   D2       - lock: further writes to $7E are ignored until reset
         *   D3 CVS   - video from $C000 instead of $4000
         * Ports $C5/$C7: writing $C7 raises CPM, $C5 (or reset) drops it. With CPM
         * the CPU sees the $E000 RAM at $C000-$DFFF as well (A13 pulled high).
         */
        _hcRemap() {
            const cfg = this.hcConfig;
            const romSel = cfg & 0x01;
            const cpmDecode = (cfg & 0x02) !== 0;
            const cpm = this.hcMemPort === 0xC7;
            const half = (arr, h) => arr.subarray(h * 0x2000, (h + 1) * 0x2000);
            const rom = this.rom[romSel] || this.rom[0];
            const r = new Array(8), w = new Array(8);
            if (cpmDecode) {
                r[0] = w[0] = half(this.ram[0], 0);
                r[1] = w[1] = half(this.ram[0], 1);
            } else {
                r[0] = half(rom, 0); w[0] = null;
                r[1] = half(rom, 1); w[1] = null;
            }
            r[2] = w[2] = half(this.ram[5], 0);
            r[3] = w[3] = half(this.ram[5], 1);
            r[4] = w[4] = half(this.ram[2], 0);
            r[5] = w[5] = half(this.ram[2], 1);
            r[6] = w[6] = half(this.ram[7], cpm ? 1 : 0);
            r[7] = w[7] = half(this.ram[7], 1);
            if (cpmDecode) {
                r[7] = half(rom, 1); w[7] = null;
            }
            this.hcR = r;
            this.hcW = w;
            this.currentRomBank = romSel;
            this.currentRamBank = 7;
            this.screenBank = (cfg & 0x08) ? 7 : 5;
        }

        /** HC-2000 port $7E write. Returns true if the screen bank changed. */
        writeHcConfig(val) {
            if (this.hcLocked) return false;
            const oldScreen = this.screenBank;
            this.hcConfig = val & 0xFF;
            this.hcLocked = (val & 0x04) !== 0;
            this._hcRemap();
            return this.screenBank !== oldScreen;
        }

        /** HC-2000 port $C5/$C7 write: the low byte of the port is the state. */
        writeHcMemPort(lowByte) {
            this.hcMemPort = lowByte;
            this._hcRemap();
        }

        /** True when the HC-2000 is in CP/M decoding (no /ROMCS overlays at $0000). */
        isHcCpmDecode() {
            return this.hcR !== null && (this.hcConfig & 0x02) !== 0;
        }

        loadRom(data, bank = 0) {
            if (bank < this.rom.length) {
                const src = new Uint8Array(data);
                this.rom[bank].set(src.subarray(0, Math.min(src.length, PAGE_SIZE)));
            }
        }

        // Beta 48 ROM: already prepared by core/beta48.js (16KB, bits straight)
        loadBeta48Rom(rom16k) {
            this.beta48Rom = new Uint8Array(16384);
            this.beta48Rom.set(rom16k.subarray(0, 16384));
        }

        hasBeta48Rom() {
            return this.beta48Rom !== null;
        }

        /** Is the Beta 48 ROM the one at `addr` right now? (debugger, isRomAt) */
        isBeta48RomAt(addr) {
            return this.beta48On && addr < SLOT1_START &&
                (this.beta48Latch || ((addr & 0xFF00) === 0x3C00 && !this.beta48WindowOff));
        }

        // Load TR-DOS ROM (separate 16KB ROM for Beta Disk interface)
        loadTrdosRom(data) {
            if (this.trdosRom) {
                const src = new Uint8Array(data);
                this.trdosRom.set(src.subarray(0, Math.min(src.length, PAGE_SIZE)));
            }
        }

        // Check if TR-DOS ROM is loaded
        hasTrdosRom() {
            // Scorpion: TR-DOS is in ROM bank 3 (not a separate chip)
            if (this.profile.trdosInRom) {
                const bank = this.rom[this.profile.trdosRomBank];
                if (!bank) return false;
                for (let i = 0; i < 256; i++) {
                    if (bank[i] !== 0) return true;
                }
                return false;
            }
            if (!this.trdosRom) {
                return false;
            }
            // Check if ROM has any non-zero content
            for (let i = 0; i < 256; i++) {
                if (this.trdosRom[i] !== 0) return true;
            }
            return false;
        }

        // Load +D ROM (8KB)
        loadPlusDRom(data) {
            this.plusDRom = new Uint8Array(8192);
            const src = new Uint8Array(data);
            this.plusDRom.set(src.subarray(0, Math.min(src.length, 8192)));
        }

        // Check if +D ROM is loaded
        hasPlusDRom() {
            if (!this.plusDRom) return false;
            for (let i = 0; i < 256; i++) {
                if (this.plusDRom[i] !== 0) return true;
            }
            return false;
        }

        // Load DISCiPLE ROM (8KB, or 16KB with two banks)
        loadDiscipleRom(data) {
            const src = new Uint8Array(data);
            this.discipleRom = new Uint8Array(src.length > 8192 ? 16384 : 8192);
            this.discipleRom.set(src.subarray(0, Math.min(src.length, this.discipleRom.length)));
        }

        hasDiscipleRom() {
            if (!this.discipleRom) return false;
            for (let i = 0; i < 256; i++) {
                if (this.discipleRom[i] !== 0) return true;
            }
            return false;
        }

        _discipleRomByte(off) {
            return this.discipleRom[(this.discipleRom.length > 8192 ? this.discipleRomBank * 8192 : 0) + off];
        }

        // Load the HC IF1 ROM (16KB). Only the HC-2000 has one.
        loadHcIf1Rom(data) {
            this.hcIf1Rom = new Uint8Array(16384);
            const src = new Uint8Array(data);
            this.hcIf1Rom.set(src.subarray(0, Math.min(src.length, 16384)));
        }

        hasHcIf1Rom() {
            if (!this.hcIf1Rom) return false;
            for (let i = 0; i < 256; i++) {
                if (this.hcIf1Rom[i] !== 0) return true;
            }
            return false;
        }

        // Is the HC IF1 overlay visible? Paged in, and not under CP/M decoding:
        // FUSE's hc2000_memory_map() skips /ROMCS while CPMPL is set.
        _hcIf1Visible(addr) {
            return addr < SLOT1_START && this.if1Active && this.hcIf1Rom !== null &&
                (this.hcConfig & 0x02) === 0;
        }

        // Load Interface 1 ROM (8KB)
        loadIF1Rom(data) {
            this.if1Rom = new Uint8Array(8192);
            const src = new Uint8Array(data);
            this.if1Rom.set(src.subarray(0, Math.min(src.length, 8192)));
        }

        // Check if Interface 1 ROM is loaded
        hasIF1Rom() {
            if (!this.if1Rom) return false;
            for (let i = 0; i < 256; i++) {
                if (this.if1Rom[i] !== 0) return true;
            }
            return false;
        }

        // Load Didaktik 80 ROM. The interface maps 14KB ($0000-$37FF); the dumps
        // in circulation are 14336 or 16384 bytes, so take the first 14336.
        loadDidaktikRom(data) {
            this.didaktikRom = new Uint8Array(DIDAKTIK_ROM_SIZE);
            const src = new Uint8Array(data);
            this.didaktikRom.set(src.subarray(0, Math.min(src.length, DIDAKTIK_ROM_SIZE)));
        }

        hasDidaktikRom() {
            if (!this.didaktikRom) return false;
            for (let i = 0; i < 256; i++) {
                if (this.didaktikRom[i] !== 0) return true;
            }
            return false;
        }

        // Load Opus Discovery ROM (8KB)
        loadOpusRom(data) {
            this.opusRom = new Uint8Array(8192);
            const src = new Uint8Array(data);
            this.opusRom.set(src.subarray(0, Math.min(src.length, 8192)));
        }

        // Check if Opus Discovery ROM is loaded
        hasOpusRom() {
            if (!this.opusRom) return false;
            for (let i = 0; i < 256; i++) {
                if (this.opusRom[i] !== 0) return true;
            }
            return false;
        }

        read(addr) {
            // Note: addr is pre-masked by caller (z80.js readByte)
            let val;

            // HC IF1 overlay: 16KB ROM with 1KB RAM at $2800/$3800 (mirrored)
            if (this.hcIf1Rom !== null && this._hcIf1Visible(addr)) {
                val = (addr & 0x2800) === 0x2800 ? this.hcIf1Ram[addr & 0x3FF] : this.hcIf1Rom[addr];
                if (this.onRead) this.onRead(addr, val);
                return val;
            }

            // Interface 1 ROM overlay: 0x0000-0x1FFF only (8KB shadow ROM)
            if (this.if1Active && addr < 0x2000 && this.if1Rom) {
                val = this.if1Rom[addr];
                if (this.onRead) this.onRead(addr, val);
                return val;
            }

            // Opus Discovery overlay: 0x0000-0x1FFF ROM, 0x2000-0x27FF RAM,
            // 0x2800-0x2FFF WD1770, 0x3000-0x37FF MC6821 PIA, 0x3800+ unmapped.
            // Priority sits between IF1 and +D, matching FUSE.
            if (this.opusActive && addr < SLOT1_START) {
                if (addr < 0x2000) {
                    val = this.opusRom ? this.opusRom[addr] : 0xFF;
                } else if (addr < 0x2800) {
                    val = this.opusRam[addr - 0x2000];
                } else {
                    // Register window — reads here have side effects on the FDC
                    val = this.opusDisk ? this.opusDisk.readMemory(addr) : 0xFF;
                }
                if (this.onRead) this.onRead(addr, val);
                return val;
            }

            // Didaktik 80 overlay: 0x0000-0x37FF = 14KB ROM, 0x3800-0x3FFF = 2KB RAM
            if (this.didaktikActive && addr < SLOT1_START) {
                if (addr < DIDAKTIK_RAM_START) {
                    val = this.didaktikRom ? this.didaktikRom[addr] : 0xFF;
                } else {
                    val = this.didaktikRam[addr - DIDAKTIK_RAM_START];
                }
                if (this.onRead) this.onRead(addr, val);
                return val;
            }

            // DISCiPLE ROM/RAM overlay, in either order (port 0x7B)
            if (this.discipleActive && addr < SLOT1_START) {
                const hi = addr >= 0x2000, off = addr & 0x1FFF;
                val = (hi !== this.discipleRomLow) ? this._discipleRomByte(off) : this.discipleRam[off];
                if (this.onRead) this.onRead(addr, val);
                return val;
            }

            // +D ROM/RAM overlay: 0x0000-0x1FFF = ROM, 0x2000-0x3FFF = RAM
            if (this.plusDActive && addr < SLOT1_START) {
                val = (addr < 0x2000) ? this.plusDRom[addr] : this.plusDRam[addr - 0x2000];
                if (this.onRead) this.onRead(addr, val);
                return val;
            }

            // Timex FDD 3000: interface ROM/RAM
            if (this.fdd3000Active && addr < SLOT1_START) {
                val = this.fdd3000.readMemory(addr);
                if (this.onRead) this.onRead(addr, val);
                return val;
            }

            // Kempston Disc: K-DOS ROM (8KB, mirrored) over $0000-$3FFF
            if (this.kempdiscActive && addr < SLOT1_START) {
                val = this.kempdisc.readMemory(addr);
                if (this.onRead) this.onRead(addr, val);
                return val;
            }

            // Beta 48: the $3Cxx window (any access) or the latch
            if (this.beta48On && addr < SLOT1_START &&
                (this.beta48Latch || ((addr & 0xFF00) === 0x3C00 && !this.beta48WindowOff))) {
                val = this.beta48Rom[addr];
                if (this.onRead) this.onRead(addr, val);
                return val;
            }

            if (this.hcR !== null) {
                // HC-2000: 8KB slots, see _hcRemap()
                val = this.hcR[addr >> 13][addr & 0x1FFF];
            } else if (this.timexHsr && ((this.timexHsr >> (addr >> 13)) & 1)) {
                // Timex: DOCK (empty: $FF) or, DEC bit 7 set, the EXROM -- the
                // TC2068's 8KB ROM bank 1 in every chunk (none on a TC2048)
                const chunk = addr >> 13;
                if (this.timexDec & 0x80) {
                    const c = this.timexExrom && this.timexExrom[chunk];
                    val = c ? c.data[addr & 0x1FFF]
                        : (this.profile.romBanks > 1 ? this.rom[1][addr & 0x1FFF] : 0xFF);
                } else {
                    const c = this.timexDock && this.timexDock[chunk];
                    val = c ? c.data[addr & 0x1FFF] : 0xFF;
                }
            } else if (this.profile.ramPages === 1) {
                if (addr < SLOT1_START) {
                    // When TR-DOS is active, read from TR-DOS ROM instead of main ROM
                    val = (this.trdosActive && this.trdosRom) ? this.trdosRom[addr] : this.rom[0][addr];
                } else if (this.gamaBank && addr >= SLOT2_START) {
                    val = this.gamaBank1[addr - SLOT2_START];       // Didaktik Gama bank 1
                } else if (this.tkmemRam && addr >= SLOT2_START) {
                    val = this.tkmemRam[((addr < SLOT3_START ? 2 : this.tkmemBank) << 14) | (addr & BANK_MASK)];
                } else {
                    val = this.ram[0][addr - SLOT1_START];  // 48K: contiguous 48KB array
                }
            } else if (this.specialPagingMode) {
                // +2A special paging: all 4 slots are RAM banks
                const slot = addr >> 14;
                val = this.ram[this.specialBanks[slot]][addr & BANK_MASK];
            } else {
                if (addr < SLOT1_START) {
                    if (this.profile.pagingModel === 'scorpion') {
                        val = this._scorpionRomRead(addr);
                    } else if (this.trdosActive) {
                        // TR-DOS ROM paged in: Scorpion uses ROM bank, others use separate chip
                        val = this.profile.trdosInRom
                            ? this.rom[this.profile.trdosRomBank][addr]
                            : this.trdosRom[addr];
                    } else if (this.ramInRomMode || this.scorpionRamInRomMode) {
                        // Pentagon 1024 / Scorpion: RAM page 0 mapped over ROM
                        val = this.ram[0][addr];
                    } else {
                        val = this.rom[this.currentRomBank][addr];
                    }
                }
                else if (addr < SLOT2_START) val = this.ram[5][addr & BANK_MASK];
                else if (addr < SLOT3_START) val = this.ram[2][addr & BANK_MASK];
                else val = this.ram[this.currentRamBank][addr & BANK_MASK];
            }
            if (this.onRead) this.onRead(addr, val);
            return val;
        }

        /**
         * Read for inspection — the debugger, watches, memory search, exporters.
         * Identical to read() everywhere except the Opus register window, which
         * has side effects: reading the WD1770 data register advances the sector
         * buffer and raises a DRQ NMI, and reading the PIA's port A clears bit 6.
         * A memory panel showing $2800 must not drive the disk controller.
         */
        peek(addr) {
            if (this.opusActive && this.opusDisk && addr >= 0x2800 && addr < SLOT1_START) {
                const val = this.opusDisk.peekMemory(addr);
                if (this.onRead) this.onRead(addr, val);
                return val;
            }
            this.inspecting = true;            // nor the ProfROM's plane switch
            const val = this.read(addr);
            this.inspecting = false;
            return val;
        }

        write(addr, val) {
            // Note: addr and val are pre-masked by caller (z80.js writeByte)
            if (this.onWrite) this.onWrite(addr, val);

            // HC IF1: its RAM takes the write, its ROM swallows it
            if (this.hcIf1Rom !== null && this._hcIf1Visible(addr)) {
                if ((addr & 0x2800) === 0x2800) this.hcIf1Ram[addr & 0x3FF] = val;
                return;
            }

            // Opus write: RAM at 0x2000-0x27FF, registers above it. The ROM at
            // 0x0000-0x1FFF ignores writes, as does 0x3800 and up.
            if (this.opusActive && addr < SLOT1_START) {
                if (addr >= 0x2000 && addr < 0x2800) {
                    this.opusRam[addr - 0x2000] = val;
                } else if (addr >= 0x2800 && this.opusDisk) {
                    this.opusDisk.writeMemory(addr, val);
                }
                return;
            }

            // Didaktik write: only its 2KB RAM at the top of the overlay takes it
            if (this.didaktikActive && addr < SLOT1_START) {
                if (addr >= DIDAKTIK_RAM_START) {
                    this.didaktikRam[addr - DIDAKTIK_RAM_START] = val;
                }
                return;
            }

            // DISCiPLE RAM write: whichever half the RAM occupies
            if (this.discipleActive && addr < SLOT1_START) {
                if ((addr >= 0x2000) === this.discipleRomLow) this.discipleRam[addr & 0x1FFF] = val;
                return;
            }

            // FDD 3000: its RAM at $2000-$3FFF; the ROM ignores writes
            if (this.fdd3000Active && addr < SLOT1_START) {
                this.fdd3000.writeMemory(addr, val);
                return;
            }

            // +D RAM write: 0x2000-0x3FFF is writable when +D is active
            if (this.plusDActive && addr >= 0x2000 && addr < SLOT1_START) {
                this.plusDRam[addr - 0x2000] = val;
                return;
            }

            if (this.hcW !== null) {
                // HC-2000: a null slot is ROM and ignores the write
                const w = this.hcW[addr >> 13];
                if (w) w[addr & 0x1FFF] = val;
                return;
            }

            if (this.specialPagingMode) {
                // +2A special paging: all 4 slots are writable RAM
                const slot = addr >> 14;
                this.ram[this.specialBanks[slot]][addr & BANK_MASK] = val;
                return;
            }

            if (addr < SLOT1_START) {
                // Pentagon 1024 / Scorpion: RAM page 0 mapped over ROM is writable
                if (this.ramInRomMode || this.scorpionRamInRomMode) {
                    this.ram[0][addr] = val;
                }
                return;
            }

            if (this.timexHsr && ((this.timexHsr >> (addr >> 13)) & 1)) {
                // Timex DOCK/EXROM: only a cartridge's RAM chunks take writes
                const bank = (this.timexDec & 0x80) ? this.timexExrom : this.timexDock;
                const c = bank && bank[addr >> 13];
                if (c && c.writable) c.data[addr & 0x1FFF] = val;
                return;
            }
            if (this.profile.ramPages === 1) {
                if (this.gamaBank && addr >= SLOT2_START) {
                    this.gamaBank1[addr - SLOT2_START] = val;          // Didaktik Gama bank 1
                    return;
                }
                if (this.tkmemRam && addr >= SLOT2_START) {
                    this.tkmemRam[((addr < SLOT3_START ? 2 : this.tkmemBank) << 14) | (addr & BANK_MASK)] = val;
                    return;
                }
                this.ram[0][addr - SLOT1_START] = val;  // 48K: contiguous 48KB array
                return;
            }
            if (addr < SLOT2_START) this.ram[5][addr & BANK_MASK] = val;
            else if (addr < SLOT3_START) this.ram[2][addr & BANK_MASK] = val;
            else this.ram[this.currentRamBank][addr & BANK_MASK] = val;
        }
        
        /**
         * Fit (size 128 or 512, in KB) or remove (0) a TKMEM-128 II. 48K only.
         * Its RAM starts empty, as after power-on.
         */
        setTkmem(sizeKB) {
            // a 48K, or the TK-90X/TK-95 the board was made for
            if (!['48k', 'tk90x', 'tk95'].includes(this.machineType) || !sizeKB) {
                this.tkmemRam = null;
                this.tkmem512 = false;
            } else {
                this.tkmemRam = new Uint8Array(sizeKB * 1024);
                this.tkmem512 = sizeKB >= 512;
            }
            this.tkmemLatch = 0;
            this.tkmemBank = 0;
            this.tkmemLocked = false;
        }

        // TKMEM-128 II latch write (port decode A15=0, A5=1, A1=0)
        writeTkmem(val) {
            if (!this.tkmemRam || this.tkmemLocked) return;
            this.tkmemLatch = val;
            this.tkmemBank = (val & 0x07) | (this.tkmem512 ? ((val >> 3) & 0x18) : 0);
            this.tkmemLocked = (val & 0x20) !== 0;
        }

        // Debug write - respects allowRomEdit flag
        writeDebug(addr, val) {
            addr &= 0xFFFF;
            val &= 0xFF;
            if (this.hcR !== null) {
                // HC-2000: ROM can sit at $0000 or $E000, so ask the slot map
                const slot = addr >> 13;
                if (this.hcW[slot]) {
                    this.write(addr, val);
                } else {
                    if (!this.allowRomEdit) return false;
                    this.hcR[slot][addr & 0x1FFF] = val;   // the view writes through to the ROM
                }
                return true;
            }
            if (addr < SLOT1_START) {
                if (!this.allowRomEdit) return false;
                if (this.profile.ramPages === 1) {
                    this.rom[0][addr] = val;
                } else {
                    this.rom[(this.romPlane << 2) | this.currentRomBank][addr] = val;
                }
                return true;
            }
            this.write(addr, val);
            return true;
        }
        
        writePaging(val) {
            if (this.profile.pagingModel === 'none' || this.pagingDisabled) return;
            if (this.profile.pagingModel === 'hc2000') return;   // no $7FFD on the HC-2000

            if (this.profile.pagingModel === 'scorpion') {
                // Scorpion ZS 256: RAM page from 1FFD bit 4 (high bit) + 7FFD bits 0-2 (low bits)
                // Per FUSE, ZXMAK2, UnrealSpeccy, and official Scorpion programmer's guide:
                // page = ((1FFD & 0x10) >> 1) | (7FFD & 0x07) → pages 0-15
                this.scorpionPort7FFD = val;  // Store for ROM bank fallback in writeScorpion1FFD
                this.currentRamBank = this._scorpionPage(this.scorpionPort1FFD, val);
                this.screenBank = (val & P7FFD_SCREEN_BIT) ? 7 : 5;
                // ROM bank selection (per FUSE): 1FFD bit 1 set → ROM 2; else 7FFD bit 4 → ROM 0/1
                if (this.scorpionPort1FFD & 0x02) {
                    this.currentRomBank = 2;
                } else {
                    this.currentRomBank = (val & P7FFD_ROM_BIT) ? 1 : 0;
                }
                if (val & P7FFD_LOCK_BIT) this.pagingDisabled = true;
                return;
            }

            if (this.profile.pagingModel === 'pentagon1024') {
                // Pentagon 1024: extended bank selection using bits 0-2, 5, 6, 7
                let page = val & P7FFD_RAM_MASK;              // bits 0-2
                page |= (val & P7FFD_P1024_EXT) >> 3;         // bits 6,7 → bank bits 3,4
                if (this.pentagon1024Mode) {
                    page |= (val & P7FFD_LOCK_BIT);            // bit 5 → bank bit 5 (value 32)
                }
                this.currentRamBank = page % this.profile.ramPages;
                this.screenBank = (val & P7FFD_SCREEN_BIT) ? 7 : 5;
                this.currentRomBank = (val & P7FFD_ROM_BIT) ? 1 : 0;
                // Bit 5 only locks paging in 128K mode (not in 1MB mode)
                if (!this.pentagon1024Mode && (val & P7FFD_LOCK_BIT)) {
                    this.pagingDisabled = true;
                }
                return;
            }

            this.currentRamBank = val & P7FFD_RAM_MASK;
            this.screenBank = (val & P7FFD_SCREEN_BIT) ? 7 : 5;
            if (this.profile.pagingModel === '+2a') {
                // +2A: ROM bank = ((port1FFD >> 2) & 1) << 1 | ((port7FFD >> 4) & 1)
                this.currentRomBank = ((this.port1FFD >> 2) & 1) << 1 | ((val >> 4) & 1);
            } else {
                this.currentRomBank = (val & P7FFD_ROM_BIT) ? 1 : 0;
            }
            if (this.didaktikForceRom1) this.currentRomBank = 1;
            if (val & P7FFD_LOCK_BIT) this.pagingDisabled = true;
        }
        
        getPagingState() {
            const state = {
                ramBank: this.currentRamBank,
                romBank: this.currentRomBank,
                screenBank: this.screenBank,
                pagingDisabled: this.pagingDisabled
            };
            if (this.profile.pagingModel === '+2a') {
                state.port1FFD = this.port1FFD;
                state.specialPagingMode = this.specialPagingMode;
                state.specialBanks = this.specialBanks.slice();
            }
            if (this.profile.pagingModel === 'pentagon1024') {
                state.portEFF7 = this.portEFF7;
                state.pentagon1024Mode = this.pentagon1024Mode;
                state.ramInRomMode = this.ramInRomMode;
            }
            if (this.profile.pagingModel === 'scorpion') {
                state.scorpionPort1FFD = this.scorpionPort1FFD;
                state.scorpionPort7FFD = this.scorpionPort7FFD;
                state.scorpionRamInRomMode = this.scorpionRamInRomMode;
                state.romPlane = this.romPlane;
            }
            if (this.profile.pagingModel === 'hc2000') {
                state.hcConfig = this.hcConfig;
                state.hcLocked = this.hcLocked;
                state.hcMemPort = this.hcMemPort;
            }
            return state;
        }

        setPagingState(state) {
            this.currentRamBank = state.ramBank || 0;
            this.currentRomBank = state.romBank || 0;
            this.screenBank = state.screenBank || 5;
            this.pagingDisabled = state.pagingDisabled || false;
            if (this.profile.pagingModel === '+2a') {
                this.port1FFD = state.port1FFD || 0;
                this.specialPagingMode = state.specialPagingMode || false;
                this.specialBanks = state.specialBanks ? state.specialBanks.slice() : [0, 1, 2, 3];
            }
            if (this.profile.pagingModel === 'pentagon1024') {
                this.portEFF7 = state.portEFF7 || 0;
                this.pentagon1024Mode = state.pentagon1024Mode || false;
                this.ramInRomMode = state.ramInRomMode || false;
            }
            if (this.profile.pagingModel === 'scorpion') {
                this.scorpionPort1FFD = state.scorpionPort1FFD || 0;
                this.scorpionPort7FFD = state.scorpionPort7FFD || 0;
                this.scorpionRamInRomMode = state.scorpionRamInRomMode || false;
                this.romPlane = state.romPlane || 0;
            }
            if (this.profile.pagingModel === 'hc2000') {
                this.hcConfig = state.hcConfig || 0;
                this.hcLocked = state.hcLocked || false;
                this.hcMemPort = state.hcMemPort || 0xC5;
                this._hcRemap();
            }
        }

        // Port 0xEFF7 handler for Pentagon 1024
        // Bit 2: 0 = 1MB mode (extended paging), 1 = 128K compatibility mode
        // Bit 3: 1 = RAM page 0 mapped at 0x0000-0x3FFF instead of ROM
        writePortEFF7(val) {
            this.portEFF7 = val;
            this.pentagon1024Mode = !(val & 0x04);  // bit 2 = 0 means 1MB mode
            this.ramInRomMode = !!(val & 0x08);     // bit 3 = 1 means RAM replaces ROM
        }

        // Port 0x1FFD handler for Scorpion ZS 256
        // Bit 0: RAM page 0 over ROM at 0x0000-0x3FFF
        // Bit 1: ROM select → ROM 2 (when set); else ROM 0/1 via 7FFD bit 4
        // Bit 4: RAM page high bit (+8)
        writeScorpion1FFD(val) {
            if (this.pagingDisabled) return;
            this.scorpionPort1FFD = val;
            this.scorpionRamInRomMode = !!(val & 0x01);  // bit 0
            // Recalculate ROM bank (per FUSE): bit 1 set → ROM 2; else 7FFD bit 4 → ROM 0/1
            if (val & 0x02) {
                this.currentRomBank = 2;
            } else {
                // Use stored 7FFD bit 4 for ROM 0/1 selection (matches FUSE: (last_byte & 0x10) >> 4)
                this.currentRomBank = (this.scorpionPort7FFD & P7FFD_ROM_BIT) ? 1 : 0;
            }
            // Recalculate RAM page: 1FFD bit 4 (high bit) + 7FFD bits 0-2 (low bits)
            this.currentRamBank = this._scorpionPage(val, this.scorpionPort7FFD);
        }

        /**
         * Scorpion $0000-$3FFF, as MAME's scorpion_update_memory: 1FFD bit 0
         * puts RAM page 0 there before anything else; 1FFD bit 1 the service
         * ROM (2) even while the DOS is on, as the ProfROM runs its disk code
         * from there; else the DOS gives TR-DOS (3); else 7FFD bit 4 picks 0 / 1.
         */
        _scorpionRomRead(addr) {
            if (this.scorpionRamInRomMode) return this.ram[0][addr];
            let bank;
            if (this.scorpionPort1FFD & 0x02) bank = 2;
            else if (this.trdosActive) bank = 3;
            else bank = this.currentRomBank;
            const val = this.rom[(this.romPlane << 2) | bank][addr];
            // ProfROM: reading $0100/$0104/$0108/$010C in the service ROM
            // moves to another plane (MAME scorpiontb read tap)
            if (bank === 2 && this.profile.profRomPlanes && (addr & 0xFFF3) === 0x0100 && !this.inspecting) {
                this.romPlane = PROF_PLANE_MAP[(addr & 0x0C) | this.romPlane];
            }
            return val;
        }

        // Scorpion RAM page at $C000: 7FFD bits 0-2, 1FFD bit 4 as bit 3 and,
        // with 1MB, 1FFD bits 6-7 as bits 4-5 (MAME scorpion_update_memory)
        _scorpionPage(p1ffd, p7ffd) {
            let page = ((p1ffd & 0x10) >> 1) | (p7ffd & P7FFD_RAM_MASK);
            if (this.profile.ramPages > 16) page |= (p1ffd & 0xC0) >> 2;
            return page % this.profile.ramPages;
        }

        // Port 0x1FFD handler for +2A
        // Bit 0: special paging mode (1=all-RAM, 0=normal)
        // Bits 1-2: special paging config (when bit 0 set)
        // Bit 2: ROM bank high bit (when bit 0 clear)
        write1FFD(val) {
            if (this.profile.pagingModel !== '+2a' || this.pagingDisabled) return;
            this.port1FFD = val;

            if (val & 0x01) {
                // Special paging mode: all 4 slots are RAM
                this.specialPagingMode = true;
                const config = (val >> 1) & 0x03;
                // Config 0: banks 0,1,2,3
                // Config 1: banks 4,5,6,7
                // Config 2: banks 4,5,6,3
                // Config 3: banks 4,7,6,3
                switch (config) {
                    case 0: this.specialBanks = [0, 1, 2, 3]; break;
                    case 1: this.specialBanks = [4, 5, 6, 7]; break;
                    case 2: this.specialBanks = [4, 5, 6, 3]; break;
                    case 3: this.specialBanks = [4, 7, 6, 3]; break;
                }
            } else {
                // Normal paging mode
                this.specialPagingMode = false;
                // Update ROM bank: high bit from 0x1FFD bit 2, low bit from 0x7FFD bit 4
                this.currentRomBank = ((val >> 2) & 1) << 1 | (this.currentRomBank & 1);
            }
        }

        // Individual paging setters for debugger
        setRamBank(bank) {
            if (this.profile.pagingModel === 'none' || this.profile.pagingModel === 'hc2000') return;
            this.currentRamBank = bank % this.profile.ramPages;
        }

        setRomBank(bank) {
            if (this.profile.pagingModel === 'none') return;
            if (this.profile.pagingModel === 'hc2000') {
                this.hcConfig = (this.hcConfig & ~0x01) | (bank & 0x01);
                this._hcRemap();
                return;
            }
            this.currentRomBank = bank % this.profile.romBanks;
        }

        setScreenBank(bank) {
            if (this.profile.pagingModel === 'none') return;
            if (this.profile.pagingModel === 'hc2000') {
                this.hcConfig = (this.hcConfig & ~0x08) | (bank === 7 ? 0x08 : 0);
                this._hcRemap();
                return;
            }
            this.screenBank = (bank === 5 || bank === 7) ? bank : 5;
        }

        setPagingDisabled(disabled) {
            if (this.profile.pagingModel === 'none') return;
            this.pagingDisabled = !!disabled;
        }

        // Port I/O for 128K/+2A/Scorpion paging
        writePort(port, val) {
            // 128K paging port
            // +2A use stricter +3-style decode (A15=0, A14=1, A1=0)
            // Scorpion: loose decode (A15=0, A1=0), excluding 1FFD range
            // 128K/+2/Pentagon use loose decode (A15=0, A1=0)
            const is7FFD = this.profile.pagingModel === '+2a'
                ? (port & DECODE_PLUS2A_MASK) === DECODE_7FFD_PLUS2A
                : (this.profile.pagingModel === 'scorpion'
                    ? (port & DECODE_128K_MASK) === 0 && (port & DECODE_PLUS2A_MASK2) !== DECODE_1FFD_PLUS2A
                    : (port & DECODE_128K_MASK) === 0);
            if (is7FFD) {
                this.writePaging(val);
            }
            // +2A port 0x1FFD - responds to any port with A1=0, A12=1, A13=0, A14=0, A15=0
            // Decoding: bits 15,14,13 = 0, bit 12 = 1, bit 1 = 0
            if (this.profile.pagingModel === '+2a' && (port & DECODE_PLUS2A_MASK2) === DECODE_1FFD_PLUS2A) {
                this.write1FFD(val);
            }
            // Scorpion port 0x1FFD - +3-style decode (per FUSE)
            if (this.profile.pagingModel === 'scorpion' && (port & DECODE_PLUS2A_MASK2) === DECODE_1FFD_PLUS2A) {
                this.writeScorpion1FFD(val);
            }
        }
        
        readPort(port) {
            // Memory doesn't handle port reads directly
            return 0xFF;
        }
        
        getScreenBase() {
            if (this.profile.ramPages === 1) return { ram: this.ram[0], offset: 0 };
            return { ram: this.ram[this.screenBank], offset: 0 };
        }

        getRamBank(bank) {
            if (this.profile.ramPages === 1) return this.ram[0];
            if (bank >= 0 && bank < this.ram.length) return this.ram[bank];
            return null;
        }
        
        // Is this address ROM as the CPU currently sees it? Only slot 0 can be,
        // and even there a Scorpion or Pentagon 1024 may have RAM mapped over it.
        // The Scorpion needs this: Even M1 applies to fetches from RAM, not ROM.
        isRomAt(addr) {
            if (this.hcW !== null) return this.hcW[(addr & 0xFFFF) >> 13] === null;
            if ((addr & 0xFFFF) >= SLOT1_START) return false;
            if (this.trdosActive) return true;              // TR-DOS, in ROM either way
            return !(this.ramInRomMode || this.scorpionRamInRomMode);
        }

        isContended(addr) {
            if (!this.contentionEnabled) return false;
            if (!this.profile.hasContention) return false;
            if (this.profile.ramPages === 1) return addr >= SLOT1_START && addr < SLOT2_START;
            if (this.profile.pagingModel === '+2a') {
                if (this.specialPagingMode) {
                    const slot = addr >> 14;
                    return this.specialBanks[slot] >= 4;
                }
                if (addr >= SLOT1_START && addr < SLOT2_START) return true;  // Bank 5 (contended)
                if (addr >= SLOT3_START) return this.currentRamBank >= 4;
                return false;
            }
            if (addr >= SLOT1_START && addr < SLOT2_START) return true;
            if (addr >= SLOT3_START) return (this.currentRamBank & 1) === 1;
            return false;
        }
        
        setBlock(startAddr, data) {
            for (let i = 0; i < data.length; i++) {
                this.write(startAddr + i, data[i]);
            }
        }
        
        getBlock(startAddr, length) {
            const result = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
                result[i] = this.read(startAddr + i);
            }
            return result;
        }

        // Get full memory snapshot (current 64K view for export)
        getFullSnapshot() {
            const snapshot = new Uint8Array(0x10000);
            for (let addr = 0; addr < 0x10000; addr++) {
                snapshot[addr] = this.read(addr);
            }
            return snapshot;
        }

        // Get full state including all banks (for complete snapshots)
        getFullState() {
            const state = {
                machineType: this.machineType,
                currentRomBank: this.currentRomBank,
                currentRamBank: this.currentRamBank,
                screenBank: this.screenBank,
                pagingDisabled: this.pagingDisabled,
                trdosActive: this.trdosActive,
                port1FFD: this.port1FFD,
                specialPagingMode: this.specialPagingMode,
                specialBanks: this.specialBanks.slice()
            };

            // Pentagon 1024 state
            if (this.profile.pagingModel === 'pentagon1024') {
                state.portEFF7 = this.portEFF7;
                state.pentagon1024Mode = this.pentagon1024Mode;
                state.ramInRomMode = this.ramInRomMode;
            }

            // Scorpion state
            if (this.profile.pagingModel === 'scorpion') {
                state.scorpionPort1FFD = this.scorpionPort1FFD;
                state.scorpionRamInRomMode = this.scorpionRamInRomMode;
                state.romPlane = this.romPlane;
            }

            // HC-2000 state
            if (this.profile.pagingModel === 'hc2000') {
                state.hcConfig = this.hcConfig;
                state.hcLocked = this.hcLocked;
                state.hcMemPort = this.hcMemPort;
            }

            // Copy ROM banks
            state.rom = this.rom.map(bank => new Uint8Array(bank));

            // Copy RAM banks
            state.ram = this.ram.map(bank => new Uint8Array(bank));

            // Copy TR-DOS ROM if present
            if (this.trdosRom) {
                state.trdosRom = new Uint8Array(this.trdosRom);
            }

            return state;
        }
    }

