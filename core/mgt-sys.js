// mgt-sys.js — the G+DOS system file of a +D disk (MGT).
//
// The +D's ROM is only a bootstrap: RUN loads G+DOS from the disk, from the
// file whose name begins "+SYS" (wherever it sits in the directory; tried on
// the emulator: moved to slot 5 it boots, renamed "XSYS" it does not). A disk
// without one cannot start, so the player adds one (data/boot/plusd.sys).
//
// The .sys file is the directory entry (256 bytes) followed by the file's
// data, 510 bytes per sector, as a G+DOS sector holds it.

import { MGTLoader } from './loaders/disk-mgt.js';

const SLOTS = 80, ENTRY = 256, DATA = 510;

// Image offset of track (cylinder | side << 7) / sector (1-10)
function sectorOffset(track, sector) {
    return (((track & 0x7F) * 2 + (track >> 7)) * 10 + (sector - 1)) * 512;
}
// Bit of the entry's sector map: side 0 cylinders 4-79, then side 1
function mapBit(track, sector) {
    return ((track & 0x7F) - 4 + (track & 0x80 ? 76 : 0)) * 10 + (sector - 1);
}
function entryName(bytes, o) {
    return String.fromCharCode(...bytes.subarray(o + 1, o + 11)).trim();
}

export function hasPlusDSystem(data) {
    const b = new Uint8Array(data);
    for (let i = 0; i < SLOTS; i++) {
        const o = MGTLoader._slotOffset(i);
        if (o + ENTRY > b.length) break;
        if (b[o] !== 0 && entryName(b, o).toUpperCase().startsWith('+SYS')) return true;
    }
    return false;
}

// The system file of a disk, in the .sys layout, or null
export function extractPlusDSystem(data) {
    const b = new Uint8Array(data);
    for (let i = 0; i < SLOTS; i++) {
        const o = MGTLoader._slotOffset(i);
        if (b[o] === 0 || !entryName(b, o).toUpperCase().startsWith('+SYS')) continue;
        const n = (b[o + 11] << 8) | b[o + 12];
        const out = new Uint8Array(ENTRY + n * DATA);
        out.set(b.subarray(o, o + ENTRY), 0);
        let t = b[o + 13], s = b[o + 14];
        for (let k = 0; k < n && (t || s); k++) {
            const x = sectorOffset(t, s);
            out.set(b.subarray(x, x + DATA), ENTRY + k * DATA);
            t = b[x + 510]; s = b[x + 511];
        }
        return out;
    }
    return null;
}

// A BASIC program as a G+DOS file in the .sys layout (directory entry, then
// the data with its 9-byte header), ready for addPlusDSystem / addMgtFile
export function mgtBasicFile(name, prog, autostart = 0x8000) {
    const len = prog.length;
    const payload = new Uint8Array(9 + len);
    payload.set([0, len & 0xFF, len >> 8, 0xCB, 0x5C, len & 0xFF, len >> 8, autostart & 0xFF, autostart >> 8], 0);
    payload.set(prog, 9);
    const n = Math.max(1, Math.ceil(payload.length / DATA));
    const out = new Uint8Array(ENTRY + n * DATA);
    out[0] = 1;                                           // BASIC
    for (let c = 0; c < 10; c++) out[1 + c] = c < name.length ? name.charCodeAt(c) : 0x20;
    out[11] = n >> 8; out[12] = n & 0xFF;
    out.set(payload.subarray(0, 9), 211);                 // the header, mirrored in the entry
    out.set(payload, ENTRY);
    return out;
}

// A copy of the disk with the system file added: into a free directory slot
// and free sectors (the union of every entry's sector map), the rest left as
// it was. Throws when there is no room.
export function addPlusDSystem(data, sys) { return addMgtFile(data, sys); }

export function addMgtFile(data, sys) {
    const b = new Uint8Array(data).slice();
    const n = (sys.length - ENTRY) / DATA;
    let slot = -1;
    const used = new Uint8Array(195);
    for (let i = 0; i < SLOTS; i++) {
        const o = MGTLoader._slotOffset(i);
        if (b[o] === 0) { if (slot < 0) slot = i; continue; }
        for (let k = 0; k < 195; k++) used[k] |= b[o + 15 + k];
    }
    if (slot < 0) throw new Error('the directory is full');
    const sides = b.length >= 819200 ? 2 : 1;
    const free = [];
    for (let side = 0; side < sides && free.length < n; side++) {
        for (let cyl = 4; cyl < 80 && free.length < n; cyl++) {
            for (let sec = 1; sec <= 10 && free.length < n; sec++) {
                const t = cyl | (side << 7), bit = mapBit(t, sec);
                if (!(used[bit >> 3] & (1 << (bit & 7))) && sectorOffset(t, sec) + 512 <= b.length) free.push([t, sec]);
            }
        }
    }
    if (free.length < n) throw new Error('not enough free space on the disk');
    const o = MGTLoader._slotOffset(slot);
    b.set(sys.subarray(0, ENTRY), o);
    b[o + 13] = free[0][0]; b[o + 14] = free[0][1];
    b.fill(0, o + 15, o + 210);
    free.forEach(([t, s], k) => {
        const x = sectorOffset(t, s);
        b.set(sys.subarray(ENTRY + k * DATA, ENTRY + (k + 1) * DATA), x);
        const next = free[k + 1] || [0, 0];
        b[x + 510] = next[0]; b[x + 511] = next[1];
        const bit = mapBit(t, s);
        b[o + 15 + (bit >> 3)] |= 1 << (bit & 7);
    });
    return b;
}
