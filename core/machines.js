/**
 * ZX-M8XXX - Machine Profiles
 * @version 0.1.0
 * @license GPL-3.0
 *
 * Data-driven machine profile system. Each profile defines all hardware
 * parameters for a machine type, replacing scattered string checks.
 */

const MACHINE_PROFILES = {
        '48k': {
            id: '48k',
            name: 'ZX Spectrum 48K',
            group: 'Sinclair',
            // Memory
            ramPages: 1,            // 1 = single 48K block (special case)
            romBanks: 1,
            romFile: '48.rom',
            romSize: 16384,
            basicRomBank: 0,
            // Paging
            pagingModel: 'none',    // 'none' | '128k' | '+2a' | 'pentagon1024'
            // ULA timing profile
            ulaProfile: '48k',     // '48k' | '128k' | 'pentagon'
            // Contention
            // ULA snow: the refresh address reaches the display fetch
            hasSnow: true,
            // Ink/paper edge skew: the Ferranti mux switches into ink late, so an
            // ink pixel is narrower than a paper one (see core/ula-inkskew.js).
            // 0.03 is measured off a real +2 running the Bright Miner test — the
            // figure sat 4.7/170 of the black-to-white range above the background.
            ulaInkSkew: 0.03,
            // 14 MHz crystal with a free-running subcarrier oscillator: nothing is
            // locked, hence the dot crawl and no stable artifact colour
            ulaSubcarrierLock: false,
            hasContention: true,
            hasIOContention: true,          // IO ports are contended
            hasFloatingBus: true,         // the ULA puts its screen fetch on the bus
            hasInternalContention: true,    // Internal cycles (no MREQ) are contended
            contentionPattern: '65432100',  // Delay pattern: (6,5,4,3,2,1,0,0)
            borderQuantization: true,
            // Interrupt
            intPulseDuration: 32,
            earlyIntTiming: true,
            // Sound
            ayDefault: false,
            ayClockHz: 1773400,
            // Peripherals
            betaDiskDefault: false,
            hasFDC: false,
            // Snapshot format IDs
            z80HwMode: 0,
            szxMachineId: 1,
            // Flags
            is128kCompat: false,
        },
        '128k': {
            id: '128k',
            name: 'ZX Spectrum 128K',
            group: 'Sinclair',
            ramPages: 8,
            romBanks: 2,
            romFile: '128.rom',
            romSize: 32768,
            basicRomBank: 1,
            pagingModel: '128k',
            ulaProfile: '128k',
            // ULA snow: the refresh address reaches the display fetch
            hasSnow: true,
            // Ink/paper edge skew: the Ferranti mux switches into ink late, so an
            // ink pixel is narrower than a paper one (see core/ula-inkskew.js).
            // 0.03 is measured off a real +2 running the Bright Miner test — the
            // figure sat 4.7/170 of the black-to-white range above the background.
            ulaInkSkew: 0.03,
            // Pixel clock locked to the PAL subcarrier (17.734475 MHz = 4x fsc),
            // so composite artifact colour stands still — see core/pal-composite.js
            ulaSubcarrierLock: true,
            hasContention: true,
            hasIOContention: true,
            hasFloatingBus: true,         // the ULA puts its screen fetch on the bus
            hasInternalContention: true,
            contentionPattern: '65432100',
            borderQuantization: true,
            intPulseDuration: 36,
            earlyIntTiming: false,
            ayDefault: true,
            ayClockHz: 1773400,
            betaDiskDefault: false,
            hasFDC: false,
            z80HwMode: 4,
            szxMachineId: 2,
            is128kCompat: true,
        },
        '+2': {
            id: '+2',
            name: 'ZX Spectrum +2',
            group: 'Sinclair',
            ramPages: 8,
            romBanks: 2,
            romFile: 'plus2.rom',
            romSize: 32768,
            basicRomBank: 1,
            pagingModel: '128k',
            ulaProfile: '128k',
            // ULA snow: the refresh address reaches the display fetch
            hasSnow: true,
            // Ink/paper edge skew: the Ferranti mux switches into ink late, so an
            // ink pixel is narrower than a paper one (see core/ula-inkskew.js).
            // 0.03 is measured off a real +2 running the Bright Miner test — the
            // figure sat 4.7/170 of the black-to-white range above the background.
            ulaInkSkew: 0.03,
            // Pixel clock locked to the PAL subcarrier (17.734475 MHz = 4x fsc),
            // so composite artifact colour stands still — see core/pal-composite.js
            ulaSubcarrierLock: true,
            hasContention: true,
            hasIOContention: true,
            hasFloatingBus: true,         // the ULA puts its screen fetch on the bus
            hasInternalContention: true,
            contentionPattern: '65432100',
            borderQuantization: true,
            intPulseDuration: 36,
            earlyIntTiming: false,
            ayDefault: true,
            ayClockHz: 1773400,
            betaDiskDefault: false,
            hasFDC: false,
            z80HwMode: 12,
            szxMachineId: 3,
            is128kCompat: true,
        },
        '+2a': {
            id: '+2a',
            name: 'ZX Spectrum +2A',
            group: 'Sinclair',
            ramPages: 8,
            romBanks: 4,
            romFile: 'plus2a.rom',
            romSize: 65536,
            basicRomBank: 3,
            pagingModel: '+2a',
            ulaProfile: '128k',
            // No snow: Amstrad's gate array and the clones do not do it
            hasSnow: false,
            ulaInkSkew: 0,             // nor the ink/paper edge skew
            // Pixel clock locked to the PAL subcarrier (17.734475 MHz = 4x fsc),
            // so composite artifact colour stands still — see core/pal-composite.js
            ulaSubcarrierLock: true,
            hasContention: true,
            hasIOContention: false,         // +2A ULA only contends on MREQ, not IO
            hasFloatingBus: false,        // gate array / clone: no
            hasInternalContention: false,   // No contention on internal (non-MREQ) cycles
            contentionPattern: '76543210',  // Delay pattern: (7,6,5,4,3,2,1,0)
            borderQuantization: true,
            intPulseDuration: 36,
            earlyIntTiming: false,
            ayDefault: true,
            ayClockHz: 1773400,
            betaDiskDefault: false,
            hasFDC: false,
            z80HwMode: 13,
            szxMachineId: 4,
            is128kCompat: true,
        },
        'pentagon': {
            id: 'pentagon',
            name: 'Pentagon 128K',
            group: 'Pentagon',
            ramPages: 8,
            romBanks: 2,
            romFile: 'pentagon.rom',
            romSize: 32768,
            basicRomBank: 1,
            pagingModel: '128k',
            ulaProfile: 'pentagon',
            // No snow: Amstrad's gate array and the clones do not do it
            hasSnow: false,
            ulaInkSkew: 0,             // nor the ink/paper edge skew
            // 14 MHz crystal with a free-running subcarrier oscillator: nothing is
            // locked, hence the dot crawl and no stable artifact colour
            ulaSubcarrierLock: false,
            hasContention: false,
            hasIOContention: false,
            hasFloatingBus: false,        // gate array / clone: no
            hasInternalContention: false,
            contentionPattern: 'none',
            borderQuantization: false,
            intPulseDuration: 36,
            earlyIntTiming: false,
            ayDefault: true,
            ayClockHz: 1750000,
            betaDiskDefault: true,
            z80HwMode: 9,
            szxMachineId: 7,
            hasFDC: false,
            is128kCompat: false,
        },
        '+3': {
            id: '+3',
            name: 'ZX Spectrum +3',
            group: 'Sinclair',
            ramPages: 8,
            romBanks: 4,
            romFile: 'plus3.rom',
            romSize: 65536,
            basicRomBank: 3,
            pagingModel: '+2a',      // Same memory banking as +2A
            ulaProfile: '128k',
            // No snow: Amstrad's gate array and the clones do not do it
            hasSnow: false,
            ulaInkSkew: 0,             // nor the ink/paper edge skew
            // Pixel clock locked to the PAL subcarrier (17.734475 MHz = 4x fsc),
            // so composite artifact colour stands still — see core/pal-composite.js
            ulaSubcarrierLock: true,
            hasContention: true,
            hasIOContention: false,         // +3 ULA only contends on MREQ, not IO
            hasFloatingBus: false,        // gate array / clone: no
            hasInternalContention: false,   // No contention on internal (non-MREQ) cycles
            contentionPattern: '76543210',  // Delay pattern: (7,6,5,4,3,2,1,0)
            borderQuantization: true,
            intPulseDuration: 36,
            earlyIntTiming: false,
            ayDefault: true,
            ayClockHz: 1773400,
            betaDiskDefault: false,
            hasFDC: true,
            z80HwMode: 7,
            szxMachineId: 5,
            is128kCompat: true,
        },
        'pentagon1024': {
            id: 'pentagon1024',
            name: 'Pentagon 1024K',
            group: 'Pentagon',
            ramPages: 64,
            romBanks: 2,
            romFile: 'pentagon.rom',  // Same ROM as Pentagon 128
            romSize: 32768,
            basicRomBank: 1,
            pagingModel: 'pentagon1024',  // Extended: 7FFD bits 5,6,7 + EFF7
            ulaProfile: 'pentagon',
            // No snow: Amstrad's gate array and the clones do not do it
            hasSnow: false,
            ulaInkSkew: 0,             // nor the ink/paper edge skew
            // 14 MHz crystal with a free-running subcarrier oscillator: nothing is
            // locked, hence the dot crawl and no stable artifact colour
            ulaSubcarrierLock: false,
            hasContention: false,
            hasIOContention: false,
            hasFloatingBus: false,        // gate array / clone: no
            hasInternalContention: false,
            contentionPattern: 'none',
            borderQuantization: false,
            intPulseDuration: 36,
            earlyIntTiming: false,
            ayDefault: true,
            ayClockHz: 1750000,
            betaDiskDefault: true,
            hasFDC: false,
            z80HwMode: 9,       // Same as Pentagon 128 in Z80 format
            szxMachineId: 7,    // Same as Pentagon 128 in SZX format
            is128kCompat: false,
        },
        'scorpion': {
            id: 'scorpion',
            name: 'Scorpion ZS 256',
            group: 'Scorpion',
            ramPages: 16,
            romBanks: 4,
            romFile: 'scorpion.rom',
            romSize: 65536,
            basicRomBank: 1,
            pagingModel: 'scorpion',
            ulaProfile: 'scorpion',
            // No snow: Amstrad's gate array and the clones do not do it
            hasSnow: false,
            ulaInkSkew: 0,             // nor the ink/paper edge skew
            // 14 MHz crystal with a free-running subcarrier oscillator: nothing is
            // locked, hence the dot crawl and no stable artifact colour
            ulaSubcarrierLock: false,
            hasContention: false,
            evenM1: true,              // opcode fetches from RAM start on an even T-state
            attrBusPorts: true,        // an unused port reads the attribute being fetched
            hasIOContention: false,
            hasFloatingBus: false,        // gate array / clone: no
            hasInternalContention: false,
            contentionPattern: 'none',
            borderQuantization: false,
            intPulseDuration: 36,
            earlyIntTiming: false,
            ayDefault: true,
            ayClockHz: 1750000,
            betaDiskDefault: true,
            hasFDC: false,
            z80HwMode: 9,
            szxMachineId: 8,
            is128kCompat: false,
            trdosInRom: true,
            trdosRomBank: 3,
        },
        // Romanian clone by ICE Felix (1985+). 64KB RAM, a 32KB ROM chip holding
        // BASIC (bank 0) and CP/M (bank 1), a config latch at $7E and a CP/M
        // memory map. Port of Alex Badea's FUSE hc2000.c (fuse-emulator-svn,
        // branch hc2000-v2); see Memory._hcRemap() for the map itself.
        'hc2000': {
            id: 'hc2000',
            name: 'HC-2000',
            group: 'Clones',
            // RAM uses the 128K bank numbers: 0 (under the ROM, CP/M), 5, 2, 7
            ramPages: 8,
            romBanks: 2,
            romFile: 'hc2000.rom',     // 32KB: hc2000-0.rom (BASIC) + hc2000-1.rom (CP/M)
            romSize: 32768,
            basicRomBank: 0,
            pagingModel: 'hc2000',
            // FUSE treats the HC as a 48K for the display: 224 T/line, 312 lines
            ulaProfile: '48k',
            hasSnow: false,
            ulaInkSkew: 0,
            ulaSubcarrierLock: false,
            hasContention: false,      // no contended RAM, no contended ports
            hasIOContention: false,
            hasFloatingBus: true,      // FUSE: spectrum_unattached_port
            hasInternalContention: false,
            contentionPattern: 'none',
            borderQuantization: true,
            intPulseDuration: 32,
            earlyIntTiming: true,
            ayDefault: false,
            ayClockHz: 1773400,
            betaDiskDefault: false,
            hasFDC: false,
            z80HwMode: 0,
            szxMachineId: 17,          // FUSE's SZX_MACHINE_HC2000
            is128kCompat: false,
        },
        // Timex Computer 2048 (Timex Portugal, 1984): a 48K with the SCLD in place
        // of the ULA. Port $FF (DEC) selects the display -- second screen at
        // $6000, 8x1 "hi-colour" attributes, 512x192 hi-res (64 columns) -- and
        // can mask the frame interrupt; port $F4 (HSR) maps DOCK/EXROM chunks,
        // empty here. No floating bus; Kempston built in. Port of FUSE's
        // machines/tc2048.c and peripherals/scld.c (see core/timex.js).
        'tc2048': {
            id: 'tc2048',
            name: 'Timex TC2048',
            group: 'Timex',
            ramPages: 1,               // one 48K block, as the 48K
            romBanks: 1,
            romFile: 'tc2048.rom',
            romSize: 16384,
            basicRomBank: 0,
            pagingModel: 'none',
            ulaProfile: '48k',         // FUSE: 224 T/line, 312 lines, 48K contention
            timex: true,               // SCLD ports and display modes
            hasSnow: false,            // not a Ferranti ULA
            ulaInkSkew: 0,
            ulaSubcarrierLock: false,
            hasContention: true,
            hasIOContention: true,
            hasFloatingBus: false,     // FUSE: spectrum_unattached_port_none
            hasInternalContention: true,
            contentionPattern: '65432100',
            borderQuantization: true,
            intPulseDuration: 32,
            earlyIntTiming: true,
            ayDefault: false,
            ayClockHz: 1773400,
            betaDiskDefault: false,
            hasFDC: false,
            z80HwMode: 14,             // .z80 v3: TC2048
            szxMachineId: 9,           // ZXSTMID_TC2048
            is128kCompat: false,
        },
        // Timex Computer 2068 (Timex Portugal, PAL): the TC2048's SCLD plus a
        // 24KB ROM -- 16KB HOME at $0000 and an 8KB EXROM (the 2068 BASIC
        // extension), which the HSR maps into any 8KB chunk with DEC bit 7
        // set; with it clear a chunk goes to the DOCK (cartridge slot, empty).
        // AY on ports $F5/$F6, register 14 the joystick port. Port of FUSE's
        // machines/tc2068.c; ROM tc2068.rom (24KB) or tc2068-0.rom + tc2068-1.rom.
        'tc2068': {
            id: 'tc2068',
            name: 'Timex TC2068',
            group: 'Timex',
            ramPages: 1,
            romBanks: 2,               // bank 0 HOME (16KB), bank 1 EXROM (8KB)
            romFile: 'tc2068.rom',
            romSize: 24576,
            basicRomBank: 0,
            pagingModel: 'none',
            ulaProfile: '48k',
            timex: true,
            timexAy: true,             // AY on $F5/$F6, not $FFFD/$BFFD
            // Its ROM is not the 48K's: the tape traps (LD-BYTES/SA-BYTES at the
            // 48K addresses, TR-DOS) would fire on other code. Tapes load in
            // real time instead.
            noRomTraps: true,
            hasSnow: false,
            ulaInkSkew: 0,
            ulaSubcarrierLock: false,
            hasContention: true,
            hasIOContention: true,
            hasFloatingBus: false,
            hasInternalContention: true,
            contentionPattern: '65432100',
            borderQuantization: true,
            intPulseDuration: 32,
            earlyIntTiming: true,
            ayDefault: true,
            ayClockHz: 1750000,        // 3.5 MHz / 2
            betaDiskDefault: false,
            hasFDC: false,
            z80HwMode: 15,             // .z80 v3: TC2068
            szxMachineId: 101,         // private id (no SZX support for it here yet)
            is128kCompat: false,
        },
        // Microdigital TK-90X (Microdigital, Brazil): a 48K clone. TK 90X Color Computer, 1985; MAME tk90x.rom (CRC 3e785f6f), v1/v3 ROMs load as well. Its ULA (the
        // Microdigital one) runs 228 T-states a line, 312 lines at 50 Hz -- 71136
        // a frame (ZEsarUX: "La ULA Microdigital emplea 228 T por linea"), with
        // the 48K contention pattern; the 48K ROM entry points are kept, so tape
        // traps work. 60 Hz (262 lines) is not offered yet.
        'tk90x': {
            id: 'tk90x',
            name: 'Microdigital TK-90X',
            group: 'Microdigital',
            ramPages: 1,
            romBanks: 1,
            romFile: 'tk90x.rom',
            romSize: 16384,
            basicRomBank: 0,
            pagingModel: 'none',
            ulaProfile: '48k',
            tstatesPerLine: 228,       // Microdigital ULA
            hasSnow: false,
            ulaInkSkew: 0,
            ulaSubcarrierLock: false,
            hasContention: true,
            hasIOContention: true,
            hasFloatingBus: false,     // MAME: unattached ports read $FF
            hasInternalContention: true,
            contentionPattern: '65432100',
            borderQuantization: true,
            intPulseDuration: 32,
            earlyIntTiming: true,
            ayDefault: false,
            ayClockHz: 1773400,
            betaDiskDefault: false,
            hasFDC: false,
            z80HwMode: 0,
            szxMachineId: 102,         // private id, not in the SZX spec
            is128kCompat: false,
        },
        // Microdigital TK-95 (Microdigital, Brazil): a 48K clone. TK 95 Color Computer, 1986, Spectrum+ style keyboard; MAME tk95.rom (CRC 17368e07). Its ULA (the
        // Microdigital one) runs 228 T-states a line, 312 lines at 50 Hz -- 71136
        // a frame (ZEsarUX: "La ULA Microdigital emplea 228 T por linea"), with
        // the 48K contention pattern; the 48K ROM entry points are kept, so tape
        // traps work. 60 Hz (262 lines) is not offered yet.
        'tk95': {
            id: 'tk95',
            name: 'Microdigital TK-95',
            group: 'Microdigital',
            ramPages: 1,
            romBanks: 1,
            romFile: 'tk95.rom',
            romSize: 16384,
            basicRomBank: 0,
            pagingModel: 'none',
            ulaProfile: '48k',
            tstatesPerLine: 228,       // Microdigital ULA
            hasSnow: false,
            ulaInkSkew: 0,
            ulaSubcarrierLock: false,
            hasContention: true,
            hasIOContention: true,
            hasFloatingBus: false,     // MAME: unattached ports read $FF
            hasInternalContention: true,
            contentionPattern: '65432100',
            borderQuantization: true,
            intPulseDuration: 32,
            earlyIntTiming: true,
            ayDefault: false,
            ayClockHz: 1773400,
            betaDiskDefault: false,
            hasFDC: false,
            z80HwMode: 0,
            szxMachineId: 103,         // private id, not in the SZX spec
            is128kCompat: false,
        },
        // Didaktik Gama (Didaktik Skalica, 1987-89): a 48K clone with 80KB RAM --
        // 16KB at $4000 (contended) and two 32KB banks at $8000-$FFFF, picked by
        // PC0 of its MHB8255 (ports $1F A, $3F B, $5F C, $7F control; PC0 is an
        // input after reset and pulled low: bank 0). After ZEsarUX's
        // machines/didaktikgama.c; MAME has the ROMs but no 80K. ROM dgama89.rom
        // (MAME CRC 45c29401); the '87 (43104909) and '88 (4ec7e078) load too.
        'dgama': {
            id: 'dgama',
            name: 'Didaktik Gama',
            group: 'Didaktik',
            ramPages: 1,
            romBanks: 1,
            romFile: 'dgama89.rom',
            romSize: 16384,
            basicRomBank: 0,
            pagingModel: 'none',
            ulaProfile: '48k',
            gama80k: true,             // second 32KB bank at $8000, 8255 PC0
            hasSnow: false,
            ulaInkSkew: 0,
            ulaSubcarrierLock: false,
            hasContention: true,
            hasIOContention: true,
            hasFloatingBus: false,     // MAME: a clone, unattached ports read $FF
            hasInternalContention: true,
            contentionPattern: '65432100',
            borderQuantization: true,
            intPulseDuration: 32,
            earlyIntTiming: true,
            ayDefault: false,
            ayClockHz: 1773400,
            betaDiskDefault: false,
            hasFDC: false,
            z80HwMode: 0,
            szxMachineId: 104,         // private id, not in the SZX spec
            is128kCompat: false,
        },
    };

    // Helper: get profile by machine type ID (falls back to 48k)
    export function getMachineProfile(type) {
        return MACHINE_PROFILES[type] || MACHINE_PROFILES['48k'];
    }

    // Helper: get all profile IDs
    export function getMachineTypes() {
        return Object.keys(MACHINE_PROFILES);
    }

    // Helper: find machine type by Z80 snapshot hardware mode
    export function getMachineByZ80HwMode(hwMode, extHeaderLen) {
        // Pentagon: hwMode=9 in both V2 and V3
        if (hwMode === 9) return 'pentagon';

        if (extHeaderLen === 23) {
            // Version 2: hwMode 3=128K, 4=128K+IF1
            if (hwMode === 3 || hwMode === 4) return '128k';
        } else {
            // Version 3: specific machine types
            if (hwMode === 7) return '+3';
            if (hwMode === 12) return '+2';
            if (hwMode === 13) return '+2a';
            if (hwMode === 4 || hwMode === 5 || hwMode === 6) return '128k';
        }
        return '48k';
    }

    // Helper: find machine type by SZX machine ID
    export function getMachineBySzxId(szxId) {
        // Direct lookup by szxMachineId
        for (const [id, p] of Object.entries(MACHINE_PROFILES)) {
            if (p.szxMachineId === szxId) return id;
        }
        // Fallback for known IDs not in our profiles
        const fallback = { 0: '48k', 6: '128k' };
        return fallback[szxId] || 'unknown';
    }

    // Default machines visible in dropdown when no localStorage setting exists
    export const DEFAULT_VISIBLE_MACHINES = ['48k', '128k', 'pentagon'];

    // 128K-compatible machine check (128K, +2, +2A, +3 share similar hardware)
    // Use this instead of machineType === '128k' for hardware checks (ULA timing, INT pulse, AY)
    export function is128kCompat(type) { return type === '128k' || type === '+2' || type === '+2a' || type === '+3'; }

    export { MACHINE_PROFILES };
