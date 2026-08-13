// mem-compare.js — comparing one part of the machine's memory with another.
//
// Two ways to name a region, because on a 128K machine both are useful and they
// mean different things:
//
//   { mode: 'paged', addr }        the 64K the CPU sees right now, $0000-$FFFF —
//                                  which RAM bank that is depends on the paging
//                                  at the moment of reading
//   { mode: 'bank', bank, addr }   a RAM bank by number, $0000-$3FFF inside it,
//                                  whether or not it is currently paged in
//
// A 48K machine has one RAM block and no paging, so only 'paged' applies there.
//
// Pure: the readers are injected, so this tests without an emulator.

export const BANK_SIZE = 0x4000;
export const ADDR_SPACE = 0x10000;

// Human-readable name for a region's start, used in the diff listing
export function regionLabel(region) {
    const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');
    if (region.mode === 'bank') return `bank ${region.bank}:$${hex(region.addr & 0x3FFF, 4)}`;
    return `$${hex(region.addr & 0xFFFF, 4)}`;
}

// Address of byte `offset` within a region, formatted for display
export function regionAddress(region, offset) {
    const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');
    if (region.mode === 'bank') {
        return `${region.bank}:${hex((region.addr + offset) & 0x3FFF, 4)}`;
    }
    return hex((region.addr + offset) & 0xFFFF, 4);
}

// Reject what can't be read before anything is read, so the reason names the
// field the user got wrong rather than surfacing as an empty or short result.
export function validateRegion(region, { ramPages = 1 } = {}) {
    if (!region || (region.mode !== 'paged' && region.mode !== 'bank')) {
        return { ok: false, error: 'Choose an addressing mode' };
    }
    if (!Number.isInteger(region.addr) || region.addr < 0) {
        return { ok: false, error: 'Address is not a number' };
    }
    if (region.mode === 'paged') {
        if (region.addr > 0xFFFF) return { ok: false, error: 'Address is above $FFFF' };
        return { ok: true };
    }
    if (ramPages <= 1) {
        return { ok: false, error: 'This machine has no RAM banks' };
    }
    if (!Number.isInteger(region.bank) || region.bank < 0 || region.bank >= ramPages) {
        return { ok: false, error: `Bank must be 0-${ramPages - 1}` };
    }
    if (region.addr > 0x3FFF) return { ok: false, error: 'Bank offset is above $3FFF' };
    return { ok: true };
}

// How many bytes are actually available from this region's start
export function availableLength(region) {
    return region.mode === 'bank'
        ? BANK_SIZE - (region.addr & 0x3FFF)
        : ADDR_SPACE - (region.addr & 0xFFFF);
}

// Read `length` bytes. A run that would pass the end of the address space (or of
// a bank) is shortened rather than wrapped — wrapping would compare bytes the
// user never asked for and quietly report differences in them.
export function readRegion(region, length, { readPaged, readBank }) {
    const want = Math.max(0, Math.min(length, availableLength(region)));
    const out = new Uint8Array(want);
    if (region.mode === 'bank') {
        const ram = readBank(region.bank);
        if (!ram) return { bytes: new Uint8Array(0), length: 0, clamped: length > 0 };
        const base = region.addr & 0x3FFF;
        for (let i = 0; i < want; i++) out[i] = ram[base + i];
    } else {
        const base = region.addr & 0xFFFF;
        for (let i = 0; i < want; i++) out[i] = readPaged(base + i) & 0xFF;
    }
    return { bytes: out, length: want, clamped: want < length };
}

// Differing bytes, plus the runs they form. The runs are what the caller shows:
// "142 bytes differ in 3 blocks" says something quite different from 142 blocks.
export function diffRegions(a, b) {
    const len = Math.min(a.length, b.length);
    const blocks = [];
    let count = 0;
    let run = null;
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) {
            count++;
            if (run) run.length++;
            else { run = { offset: i, length: 1 }; blocks.push(run); }
        } else {
            run = null;
        }
    }
    return { count, blocks, compared: len, identical: count === 0 };
}

// Same region on both sides is almost always a mis-fill of the form, and it
// always reports "identical" — which reads as a result rather than a mistake.
export function sameRegion(a, b) {
    if (!a || !b || a.mode !== b.mode) return false;
    if (a.mode === 'bank') return a.bank === b.bank && (a.addr & 0x3FFF) === (b.addr & 0x3FFF);
    return (a.addr & 0xFFFF) === (b.addr & 0xFFFF);
}
