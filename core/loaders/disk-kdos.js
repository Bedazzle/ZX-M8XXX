/**
 * ZX-M8XXX - K-DOS (Kempston Disc Interface) file system on a DSK image
 * @license GPL-3.0-or-later
 *
 * Read off the x128 .kdi disks (Myth, R-Type 2019, ChaseHQ...) and the user's
 * blank references (kempston_dsdd.dsk, kempston_sssd.dsk):
 *   - 10 sectors of 512 bytes a track, sectors 0-9; 80 tracks x 2 sides
 *     (DS DD, 800 blocks) or 40 x 1 (SS, 200 blocks);
 *   - logical sector n: track n / (10 x sides), side (n / 10) % sides, sector
 *     n % 10 (both sides of a track before the next); a block is 1KB;
 *   - the directory: track 20 side 0 (block 200 on DS, 100 on SS), 5 blocks.
 *     Its sector 0:
 *       3-12    disk name
 *       $0D-$23 fixed bytes, among them $1D tracks, $1E sectors-1 (9),
 *               $1F sides-1, $22-$23 total blocks ($0320 / $00C8)
 *       $60-$FF the block map (LSB first, 1 = used; the blocks past the end
 *               are set)
 *       $100    one byte per directory slot: a hash of the name, 0 = free
 *               (AUTO is $93 on every disk). $A5 here = every slot taken,
 *               "Directory full"
 *     sectors 1-9: 144 entries of 32 bytes ($A5 = never used):
 *       0      0 = in use      1  0
 *       2      type, as a tape header: 0 BASIC, 1 num array, 2 char array, 3 CODE
 *       3-12   name
 *       13-14  length      15-16  param 1 (start / autostart line)
 *       17-18  param 2 (BASIC: program length)
 *       22     blocks      23-24  first block (the file's blocks are contiguous)
 * Agrees with the user's KDOS_format.md.
 */

import { DSKImage } from '../fdc.js';

export const KDOS_DIR_TRACK = 20;
export const KDOS_SECTORS = 10;
export const KDOS_TYPE_NAMES = ['BASIC', 'NumArr', 'ChrArr', 'CODE'];

export class KdosLoader {
    static _dir(dsk) { return dsk ? dsk.readSector(KDOS_DIR_TRACK, 0, 0) : null; }

    /** { tracks, sides, blocks } from the directory sector */
    static geometry(dsk) {
        const d = KdosLoader._dir(dsk);
        if (!d) return null;
        return { tracks: d[0x1D], sides: d[0x1F] + 1, blocks: d[0x22] | (d[0x23] << 8) };
    }

    static _sector(dsk, n, sides) {
        const perTrack = KDOS_SECTORS * sides;
        return dsk.readSector(Math.floor(n / perTrack), Math.floor(n / KDOS_SECTORS) % sides, n % KDOS_SECTORS);
    }

    /** Is this a K-DOS disk? (512-byte sectors 0-9, its directory sector on track 20) */
    static isKdos(dsk) {
        const d = KdosLoader._dir(dsk);
        if (!d || d.length !== 512 || !dsk.readSector(0, 0, 9) || dsk.readSector(0, 0, 10)) return false;
        const g = KdosLoader.geometry(dsk);
        return d[0x1E] === KDOS_SECTORS - 1 && (g.sides === 1 || g.sides === 2) &&
            g.blocks === g.tracks * g.sides * KDOS_SECTORS / 2;
    }

    static diskName(dsk) {
        const s = KdosLoader._dir(dsk);
        if (!s) return '';
        return String.fromCharCode(...s.subarray(3, 13)).replace(/[^\x20-\x7E]/g, '').trim();
    }

    /**
     * A blank K-DOS disk, as FORMAT leaves it (checked against the user's
     * kempston_dsdd.dsk / kempston_sssd.dsk): every sector $A5, the label and
     * the fixed bytes in the directory sector, the directory's five blocks
     * used, the slot bytes clear. DS DD 80 tracks (default) or SS 40.
     */
    static createBlank(label = 'BLANK', { tracks = 80, sides = 2 } = {}) {
        const dsk = new DSKImage();
        dsk.numTracks = tracks;
        dsk.numSides = sides;
        dsk.isExtended = true;
        for (let cyl = 0; cyl < tracks; cyl++) {
            for (let head = 0; head < sides; head++) {
                const sectors = [];
                for (let s = 0; s < KDOS_SECTORS; s++) {
                    sectors.push({ cylinder: cyl, head, id: s, sizeCode: 2, st1: 0, st2: 0,
                        data: new Uint8Array(512).fill(0xA5) });
                }
                dsk.tracks.push({ sectors });
            }
        }
        const blocks = tracks * sides * KDOS_SECTORS / 2;
        const dirBlock = KDOS_DIR_TRACK * sides * KDOS_SECTORS / 2;
        const d = dsk.readSector(KDOS_DIR_TRACK, 0, 0);
        d.fill(0, 0, 3);
        const name = String(label).slice(0, 10).padEnd(10, ' ');
        for (let i = 0; i < 10; i++) d[3 + i] = name.charCodeAt(i) & 0x7F;
        d.set([0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0xA5, 0x32, tracks, KDOS_SECTORS - 1, sides - 1, 0x00, 0x00, blocks & 0xFF, blocks >> 8], 13);
        d.fill(0, 0x60, 0x100);
        for (let b = blocks; b < 160 * 8; b++) d[0x60 + (b >> 3)] |= 1 << (b & 7);
        for (let b = dirBlock; b < dirBlock + 5; b++) d[0x60 + (b >> 3)] |= 1 << (b & 7);
        d.fill(0, 0x100, 0x200);
        return dsk;
    }

    /** Free 1KB blocks: the block map's clear bits up to the disk's size */
    static freeBlocks(dsk) {
        const s = KdosLoader._dir(dsk);
        if (!s) return 0;
        const g = KdosLoader.geometry(dsk);
        let free = 0;
        for (let b = 0; b < Math.min(g.blocks, 1280); b++) if (!((s[0x60 + (b >> 3)] >> (b & 7)) & 1)) free++;
        return free;
    }

    /** The directory: [{ name, type, typeName, length, param1, param2, startAddr, blocks, firstBlock }] */
    static listFiles(dsk) {
        const files = [];
        if (!KdosLoader.isKdos(dsk)) return files;
        for (let sec = 1; sec < KDOS_SECTORS; sec++) {
            const s = dsk.readSector(KDOS_DIR_TRACK, 0, sec);
            if (!s) break;
            for (let e = 0; e < 16; e++) {
                const d = s.subarray(e * 32, e * 32 + 32);
                if (d[0] !== 0 || d[2] > 3) continue;
                const name = String.fromCharCode(...d.subarray(3, 13));
                if (!/^[\x20-\x7E]+$/.test(name) || !name.trim()) continue;
                const length = d[13] | (d[14] << 8);
                const param1 = d[15] | (d[16] << 8);
                const param2 = d[17] | (d[18] << 8);
                files.push({
                    name: name.trimEnd(), type: d[2], typeName: KDOS_TYPE_NAMES[d[2]],
                    length, param1, param2, startAddr: d[2] === 3 ? param1 : 0,
                    blocks: d[22], firstBlock: d[23] | (d[24] << 8)
                });
            }
        }
        return files;
    }

    /**
     * The disk as the Explorer's MDOS (Didaktik) views take it: files with an
     * MDOS type letter (P BASIC, B code, N/C arrays) that read themselves.
     */
    static asExplorerDisk(dsk, size) {
        const files = KdosLoader.listFiles(dsk).map(f => ({
            name: f.name, type: ['P', 'N', 'C', 'B'][f.type], typeName: f.typeName,
            length: f.length, startAddr: f.param1,
            kdos: f, extract: () => KdosLoader.readFile(dsk, f)
        }));
        const g = KdosLoader.geometry(dsk);
        const info = {
            formatName: 'Kempston Disc (K-DOS) Disk Image', kdos: true,
            tracks: g.tracks, sides: g.sides, sectorsPerTrack: KDOS_SECTORS, bytesPerSector: 512,
            totalSectors: g.tracks * g.sides * KDOS_SECTORS,
            diskLabel: KdosLoader.diskName(dsk) + ` (${KdosLoader.freeBlocks(dsk)}K free of ${g.blocks}K)`,
            fileCount: files.length, size
        };
        return { type: 'didaktik', files, info, size, kdos: true };
    }

    // ---- writing (the Explorer's editor) ----

    /**
     * The slot byte at $100: K-DOS 2.1 $14D6 -- C = 0; for the 10 name bytes
     * C = RLCA(char XOR C); 0 becomes 1. (Checked on 67 names of 5 disks.)
     */
    static nameHash(name) {
        const n = String(name).slice(0, 10).padEnd(10, ' ');
        let c = 0;
        for (let i = 0; i < 10; i++) {
            const a = (n.charCodeAt(i) & 0xFF) ^ c;
            c = ((a << 1) | (a >> 7)) & 0xFF;
        }
        return c || 1;
    }

    static _slot(dsk, i) {
        const s = dsk.readSector(KDOS_DIR_TRACK, 0, 1 + (i >> 4));
        return s ? s.subarray((i & 15) * 32, (i & 15) * 32 + 32) : null;
    }

    /** The directory slot of a file (by its first block), or -1 */
    static _slotOf(dsk, firstBlock) {
        for (let i = 0; i < 144; i++) {
            const d = KdosLoader._slot(dsk, i);
            if (d && d[0] === 0 && d[2] <= 3 && (d[23] | (d[24] << 8)) === firstBlock) return i;
        }
        return -1;
    }

    static _setBlocks(dsk, first, count, used) {
        const m = KdosLoader._dir(dsk);
        for (let b = first; b < first + count; b++) {
            if (used) m[0x60 + (b >> 3)] |= 1 << (b & 7);
            else m[0x60 + (b >> 3)] &= ~(1 << (b & 7));
        }
    }

    static _writeName(d, name) {
        const n = String(name).slice(0, 10).padEnd(10, ' ');
        for (let i = 0; i < 10; i++) d[3 + i] = n.charCodeAt(i) & 0x7F;
    }

    /**
     * Add a file: { name, type 0-3, data, param1, param2 } -- contiguous
     * blocks from the first run that fits, a slot whose byte at $100 is 0,
     * the map bits and the slot byte set. Throws on a full disk / directory.
     */
    static addFile(dsk, file) {
        const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || 0);
        const g = KdosLoader.geometry(dsk);
        const m = KdosLoader._dir(dsk);
        const nblk = Math.max(1, Math.ceil(data.length / 1024));
        let first = -1;
        for (let b = 0, run = 0; b < g.blocks; b++) {
            if ((m[0x60 + (b >> 3)] >> (b & 7)) & 1) { run = 0; continue; }
            if (++run === nblk) { first = b - nblk + 1; break; }
        }
        if (first < 0) throw new Error(`Disk full (no ${nblk}K run free, ${KdosLoader.freeBlocks(dsk)}K free in all)`);
        let slot = -1;
        for (let i = 0; i < 144; i++) if (m[0x100 + i] === 0) { slot = i; break; }
        if (slot < 0) throw new Error('Directory full (144 files)');
        for (let i = 0; i < nblk * 2; i++) {
            const s = KdosLoader._sector(dsk, first * 2 + i, g.sides);
            const part = data.subarray(i * 512, Math.min(data.length, i * 512 + 512));
            s.fill(0);
            s.set(part);
        }
        const d = KdosLoader._slot(dsk, slot);
        d.fill(0);
        d[2] = file.type & 3;
        KdosLoader._writeName(d, file.name || 'untitled');
        const len = data.length;
        const p1 = file.param1 || 0, p2 = file.param2 != null ? file.param2 : (file.type === 0 ? len : 0);
        d[13] = len & 0xFF; d[14] = len >> 8;
        d[15] = p1 & 0xFF; d[16] = (p1 >> 8) & 0xFF;
        d[17] = p2 & 0xFF; d[18] = (p2 >> 8) & 0xFF;
        d[22] = nblk;
        d[23] = first & 0xFF; d[24] = first >> 8;
        KdosLoader._setBlocks(dsk, first, nblk, true);
        m[0x100 + slot] = KdosLoader.nameHash(file.name || 'untitled');
        return dsk;
    }

    /** Delete a file (by its first block): the map bits and the slot freed */
    static deleteFile(dsk, firstBlock) {
        const i = KdosLoader._slotOf(dsk, firstBlock);
        if (i < 0) return dsk;
        const d = KdosLoader._slot(dsk, i);
        KdosLoader._setBlocks(dsk, firstBlock, d[22], false);
        d.fill(0xA5);
        KdosLoader._dir(dsk)[0x100 + i] = 0;
        return dsk;
    }

    static renameFile(dsk, firstBlock, name) {
        const i = KdosLoader._slotOf(dsk, firstBlock);
        if (i < 0) return dsk;
        KdosLoader._writeName(KdosLoader._slot(dsk, i), name);
        KdosLoader._dir(dsk)[0x100 + i] = KdosLoader.nameHash(name);
        return dsk;
    }

    static setParam1(dsk, firstBlock, value) {
        const i = KdosLoader._slotOf(dsk, firstBlock);
        if (i >= 0) { const d = KdosLoader._slot(dsk, i); d[15] = value & 0xFF; d[16] = (value >> 8) & 0xFF; }
        return dsk;
    }

    /** Swap two files' directory slots (catalogue order), with their slot bytes */
    static swapFiles(dsk, firstA, firstB) {
        const a = KdosLoader._slotOf(dsk, firstA), b = KdosLoader._slotOf(dsk, firstB);
        if (a < 0 || b < 0 || a === b) return dsk;
        const da = KdosLoader._slot(dsk, a), db = KdosLoader._slot(dsk, b), t = da.slice();
        da.set(db); db.set(t);
        const m = KdosLoader._dir(dsk), h = m[0x100 + a];
        m[0x100 + a] = m[0x100 + b]; m[0x100 + b] = h;
        return dsk;
    }

    static setLabel(dsk, label) {
        KdosLoader._writeName(KdosLoader._dir(dsk), label);
        return dsk;
    }

    /** A file's bytes */
    static readFile(dsk, file) {
        const sides = KdosLoader.geometry(dsk).sides;
        const out = new Uint8Array(file.length);
        let pos = 0;
        for (let n = file.firstBlock * 2; pos < file.length; n++) {
            const s = KdosLoader._sector(dsk, n, sides);
            if (!s) break;
            const take = Math.min(s.length, file.length - pos);
            out.set(s.subarray(0, take), pos);
            pos += take;
        }
        return out;
    }
}
