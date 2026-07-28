// snapshot-parse.js — read a .sna/.z80 into a plain, machine-independent view
//
// The Compare tool needs snapshot contents as data, not as a running machine, but
// it must not carry its own .sna/.z80 parser: a private copy silently drifts from
// the emulator's (its .z80 decompressor did, and mis-read compressed 128K pages).
// So this loads through the real SnapshotLoader into a real Memory and reads the
// result back out — one parser, exercised by every snapshot the emulator loads.

import { Memory } from '../core/memory.js';
import { SnapshotLoader } from '../core/loaders.js';
import { getMachineByZ80HwMode } from '../core/machines.js';

const SNA_48K_SIZE = 49179;

// Machine the snapshot describes — needed before loading, because page mapping
// depends on it.
function snapshotMachine(bytes, kind) {
    if (kind === 'sna') {
        return bytes.length > SNA_48K_SIZE ? '128k' : '48k';
    }
    const pc = bytes[6] | (bytes[7] << 8);
    if (pc !== 0) return '48k';                     // version 1 is 48K only
    const extHeaderLen = bytes[30] | (bytes[31] << 8);
    return getMachineByZ80HwMode(bytes[34], extHeaderLen) || '48k';
}

// Port 0x7FFD as stored in the file (0 for 48K snapshots)
function snapshotPaging(bytes, kind, machineType) {
    if (machineType === '48k') return 0;
    if (kind === 'sna') return bytes.length > 49181 ? bytes[49181] : 0;
    return bytes.length > 35 ? bytes[35] : 0;
}

function registersOf(cpu) {
    const pair = (hi, lo) => ((hi & 0xFF) << 8) | (lo & 0xFF);
    return {
        AF: pair(cpu.a, cpu.f),
        BC: pair(cpu.b, cpu.c),
        DE: pair(cpu.d, cpu.e),
        HL: pair(cpu.h, cpu.l),
        "AF'": pair(cpu.a_, cpu.f_),
        "BC'": pair(cpu.b_, cpu.c_),
        "DE'": pair(cpu.d_, cpu.e_),
        "HL'": pair(cpu.h_, cpu.l_),
        A: cpu.a & 0xFF,
        F: cpu.f & 0xFF,
        PC: cpu.pc & 0xFFFF,
        SP: cpu.sp & 0xFFFF,
        IX: cpu.ix & 0xFFFF,
        IY: cpu.iy & 0xFFFF,
        I: cpu.i & 0xFF,
        R: cpu.rFull & 0xFF,
        IM: cpu.im & 0x03,
        IFF1: cpu.iff1 ? 1 : 0,
        IFF2: cpu.iff2 ? 1 : 0,
    };
}

// Returns { registers, memory (64K as paged at snapshot time), is128K, border,
// port7FFD, machineType } — or null if the data isn't a snapshot we can read.
export function parseSnapshotFile(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let kind = null;
    if (bytes.length === SNA_48K_SIZE || bytes.length === 131103 || bytes.length === 147487) {
        kind = 'sna';
    } else if (bytes.length >= 30) {
        kind = 'z80';
    }
    if (!kind) return null;

    const machineType = snapshotMachine(bytes, kind);
    const memory = new Memory(machineType);
    const cpu = {};
    const loader = new SnapshotLoader();

    let border = 0;
    try {
        const res = kind === 'sna'
            ? loader.loadSNA(bytes, cpu, memory)
            : loader.loadZ80(bytes, cpu, memory);
        border = (res && res.border) || 0;
    } catch (e) {
        return null;
    }

    // Flat view of RAM as it was paged in. The ROM area is left at zero — a
    // snapshot doesn't carry it, and the tool only compares snapshots to snapshots.
    const flat = new Uint8Array(65536);
    for (let a = 0x4000; a < 0x10000; a++) flat[a] = memory.read(a);

    return {
        registers: registersOf(cpu),
        memory: flat,
        is128K: machineType !== '48k',
        machineType,
        border,
        port7FFD: snapshotPaging(bytes, kind, machineType),
    };
}
