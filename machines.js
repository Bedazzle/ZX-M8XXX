/**
 * ZX-M8XXX - Machine Profiles
 * @version 0.1.0
 * @license GPL-3.0
 *
 * Data-driven machine profile system. Each profile defines all hardware
 * parameters for a machine type, replacing scattered string checks.
 *
 * Loaded before all other module scripts (after is128kCompat helper).
 */

(function(global) {
    'use strict';

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
            hasContention: true,
            hasIOContention: true,          // IO ports are contended
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
            hasContention: true,
            hasIOContention: true,
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
            hasContention: true,
            hasIOContention: true,
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
            hasContention: true,
            hasIOContention: false,         // +2A ULA only contends on MREQ, not IO
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
            hasContention: false,
            hasIOContention: false,
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
            hasContention: true,
            hasIOContention: false,         // +3 ULA only contends on MREQ, not IO
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
            hasContention: false,
            hasIOContention: false,
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
    };

    // Helper: get profile by machine type ID (falls back to 48k)
    function getMachineProfile(type) {
        return MACHINE_PROFILES[type] || MACHINE_PROFILES['48k'];
    }

    // Helper: get all profile IDs
    function getMachineTypes() {
        return Object.keys(MACHINE_PROFILES);
    }

    // Helper: find machine type by Z80 snapshot hardware mode
    function getMachineByZ80HwMode(hwMode, extHeaderLen) {
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
    function getMachineBySzxId(szxId) {
        // Direct lookup by szxMachineId
        for (const [id, p] of Object.entries(MACHINE_PROFILES)) {
            if (p.szxMachineId === szxId) return id;
        }
        // Fallback for known IDs not in our profiles
        const fallback = { 0: '48k', 6: '128k' };
        return fallback[szxId] || 'unknown';
    }

    // Default machines visible in dropdown when no localStorage setting exists
    const DEFAULT_VISIBLE_MACHINES = ['48k', '128k', 'pentagon'];

    global.MACHINE_PROFILES = MACHINE_PROFILES;
    global.getMachineProfile = getMachineProfile;
    global.getMachineTypes = getMachineTypes;
    global.getMachineByZ80HwMode = getMachineByZ80HwMode;
    global.getMachineBySzxId = getMachineBySzxId;
    global.DEFAULT_VISIBLE_MACHINES = DEFAULT_VISIBLE_MACHINES;

})(typeof window !== 'undefined' ? window : this);
