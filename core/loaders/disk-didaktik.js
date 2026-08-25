/**
 * ZX-M8XXX - Didaktik D40/D80: MDOS images
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

import { writeField } from './common.js';
import { PlusDDisk } from './disk-mgt.js';

    /**
     * Didaktik 40/80 MDOS disk loader (read-only).
     * D40/D80 images are raw, header-less sector dumps (sector N at offset
     * N*512). Algorithms ported from the zxspectrumutils tools d802tap.cpp /
     * dird80.c. Supported: list catalog, extract files.
     */
    export class DidaktikLoader {
        static get SECTOR_SIZE() { return 512; }
        static get FAT_OFFSET() { return 512; }          // FAT starts at sector 1
        static get FAT_ENTRIES_PER_SECTOR() { return 341; }
        // Directory occupies these physical sectors, in catalog order
        static get DIR_SECTORS() { return [6, 8, 10, 12, 7, 9, 11, 13]; }
        static get DIR_ENTRY_SIZE() { return 32; }
        static get TYPE_NAMES() {
            return { P: 'BASIC', B: 'Code', N: 'Num array', C: 'Char array', S: 'Snapshot', Q: 'Sequence' };
        }

        // Known raw image sizes (track × sides × sectors × 512)
        /**
         * The unambiguous half of isDidaktik: the "SDOS" identifier an MDOS boot
         * sector carries at offset 204. Format detection needs this on its own,
         * because a D80 and a double-sided OPD are both exactly 737,280 bytes and
         * a D40 is a plausible size for other formats too — so the size-plus-
         * catalogue fallback below cannot be allowed to run before those.
         */
        static hasSdosSignature(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            return bytes.length > 207 &&
                bytes[204] === 0x53 && bytes[205] === 0x44 &&
                bytes[206] === 0x4F && bytes[207] === 0x53;
        }

        static isDidaktik(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            if (bytes.length < 14 * 512) return false;
            // MDOS boot sector carries an "SDOS" identifier at offset 204
            if (bytes[204] === 0x53 && bytes[205] === 0x44 &&
                bytes[206] === 0x4F && bytes[207] === 0x53) {
                return true;
            }
            // Fallback: a plausible D40/D80 size with a sane-looking catalog
            const sizes = [184320, 368640, 409600, 737280, 819200];
            if (!sizes.includes(bytes.length)) return false;
            return DidaktikLoader.listFiles(bytes).length > 0;
        }

        // MDOS 12-bit FAT entry decode (own nibble packing, not standard FAT12)
        static getFATnum(bytes, sector) {
            const sec = sector % DidaktikLoader.FAT_ENTRIES_PER_SECTOR;
            const base = DidaktikLoader.FAT_OFFSET +
                Math.floor(sector / DidaktikLoader.FAT_ENTRIES_PER_SECTOR) * 512 +
                Math.floor(sec * 3 / 2);
            const b0 = bytes[base] || 0;
            const b1 = bytes[base + 1] || 0;
            return (sec % 2 === 0)
                ? (b0 | ((b1 >> 4) << 8))        // even entry
                : (b1 | ((b0 & 0x0F) << 8));     // odd entry
        }

        static _readName(bytes, off) {
            let name = '';
            for (let i = 0; i < 10; i++) {
                const ch = bytes[off + i];
                if (ch === 0 || ch === 0xE5) break;
                if (ch >= 0x20 && ch < 0x7F) name += String.fromCharCode(ch);
            }
            return name.trimEnd();
        }

        static listFiles(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const files = [];
            for (const physSec of DidaktikLoader.DIR_SECTORS) {
                const base = physSec * 512;
                if (base + 512 > bytes.length) break;
                for (let i = 0; i < 16; i++) {
                    const off = base + i * 32;
                    const t = bytes[off];
                    if (t === 0x00 || t === 0xE5) continue;   // empty / deleted
                    const typeChar = (t >= 0x20 && t < 0x7F) ? String.fromCharCode(t) : '?';
                    const name = DidaktikLoader._readName(bytes, off + 1);
                    if (!name) continue;
                    const length = bytes[off + 11] | (bytes[off + 12] << 8) | (bytes[off + 21] << 16);
                    const startAddr = bytes[off + 13] | (bytes[off + 14] << 8);
                    const basicLength = bytes[off + 15] | (bytes[off + 16] << 8);
                    const firstSec = bytes[off + 17] | (bytes[off + 18] << 8);
                    const attributes = bytes[off + 20];
                    files.push({
                        name,
                        type: typeChar,
                        typeName: DidaktikLoader.TYPE_NAMES[typeChar] || 'Unknown',
                        ext: typeChar,
                        length,
                        startAddr,
                        basicLength,
                        firstSec,
                        attributes,
                        fullName: `${name}.${typeChar}`
                    });
                }
            }
            return files;
        }

        /**
         * Extract a file's data by walking its FAT sector chain.
         * Returns Uint8Array, or null on a bad/unreadable chain.
         */
        static extractFile(data, fileInfo) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const sectors = [];
            let sec = fileInfo.firstSec;
            let endVal = 0;
            let guard = 0;
            const maxGuard = Math.floor(bytes.length / 512) + 4;
            while (guard++ < maxGuard) {
                sectors.push(sec);
                const nv = DidaktikLoader.getFATnum(bytes, sec);
                if (nv >= 0xC00) { endVal = nv; break; }
                sec = nv;
            }
            if ((endVal & 0xF00) === 0xD00) return null;   // bad/unavailable sector

            let total = (sectors.length - 1) * 512;
            if (endVal > 0xE00) {
                total += (endVal & 0x1FF);                 // bytes used in final sector
            } else if (endVal === 0xE00) {
                if (total < fileInfo.length) total += 512; // 0xE00-as-EOF workaround
            } else if (endVal === 0xC00) {
                // proper end marker — final sector's used bytes come from the
                // declared length (length mod 512, or a full sector)
                const rem = fileInfo.length - total;
                total += (rem > 0 && rem <= 512) ? rem : 512;
            }
            if (total <= 0) return new Uint8Array(0);

            const out = new Uint8Array(total);
            let pos = 0;
            for (const s of sectors) {
                if (pos >= total) break;
                const o = s * 512;
                const n = Math.min(512, total - pos, Math.max(0, bytes.length - o));
                if (n <= 0) break;
                out.set(bytes.subarray(o, o + n), pos);
                pos += n;
            }
            return out;
        }

        static getDiskInfo(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const hasBoot = bytes.length > 207;
            let diskLabel = '';
            if (hasBoot) {
                for (let i = 192; i < 202; i++) {
                    const ch = bytes[i];
                    if (ch >= 0x20 && ch < 0x7F) diskLabel += String.fromCharCode(ch);
                }
                diskLabel = diskLabel.trimEnd();
            }
            const tracksPerSide = hasBoot ? bytes[178] : 0;
            const sectorsPerTrack = hasBoot ? bytes[179] : 0;
            const doubleSided = hasBoot ? !!(bytes[177] & 0x10) : true;
            const files = DidaktikLoader.listFiles(bytes);
            return {
                diskLabel,
                tracks: tracksPerSide,
                sides: doubleSided ? 2 : 1,
                sectorsPerTrack,
                bytesPerSector: 512,
                totalSize: bytes.length,
                totalSectors: Math.floor(bytes.length / 512),
                fileCount: files.length
            };
        }

        /**
         * Write the 10-byte MDOS disk label into the boot sector (offset 192-201,
         * space-padded). Returns a new array; no-op if the disk has no boot sector.
         */
        static setDiskLabel(data, label) {
            const bytes = new Uint8Array(data);
            if (bytes.length <= 207) return bytes; // no boot sector → no label area
            writeField(bytes, 192, label || '', 10);
            return bytes;
        }

        /**
         * Fill a blank MDOS image's FAT + directory/data area (shared by D40/D80).
         * The directory (sectors 6-13) and data area (14..) get the 0xE5 format
         * byte; the FAT (image sectors 1..fatSectors) marks system sectors 0-13 and
         * the non-existent sectors past the disk (totalSectors..fatSectors*341-1) as
         * 0xDDD, leaving the data sectors free (0x000). The unused low nibble of each
         * FAT sector's last byte is forced to 0xD (→ 0x0D where the high nibble is a
         * free entry, 0xDD where it completes a 0xDDD non-existent entry).
         */
        static _writeMdosFatAndFill(bytes, totalSectors, fatSectors) {
            bytes.fill(0xE5, 6 * 512);
            for (let s = 0; s <= 13; s++) DidaktikLoader.setFATnum(bytes, s, 0xDDD);
            for (let s = totalSectors; s <= fatSectors * 341 - 1; s++) DidaktikLoader.setFATnum(bytes, s, 0xDDD);
            for (let s = 1; s <= fatSectors; s++) bytes[s * 512 + 511] = (bytes[s * 512 + 511] & 0xF0) | 0x0D;
        }

        /**
         * Build a blank, MDOS-formatted Didaktik D80 image — 80 track, double-sided,
         * 9 sectors/track, 512 B = 737280 B. Byte-reproduces a real greaseweazle/MDOS_2
         * format (tests/pristine/ref-d80-blank.d80), parameterised only by the label.
         * @param {string} label  up to 10 chars (null-padded, like a real format)
         * @returns {Uint8Array}
         */
        static createBlankD80(label = '') {
            const bytes = new Uint8Array(80 * 2 * 9 * 512);   // 737280
            DidaktikLoader._writeMdosFatAndFill(bytes, 80 * 2 * 9, 5);

            // Sector 0: MDOS boot/system descriptor (captured from a real MDOS_2
            // format). Parameter blocks at 0x80/0xB0 encode the geometry MDOS reads
            // back (byte 178=0x50 → 80 tracks, 179=0x09 → 9 sectors).
            const sig = 'Formated with MDOS_2 (MTs edition).';
            for (let i = 0; i < sig.length; i++) bytes[i] = sig.charCodeAt(i);
            const PARAM_80 = [0x01, 0x18, 0x28, 0x50, 0x00, 0x18, 0x50, 0x09, 0x00, 0x00, 0x00, 0x00,
                              0x81, 0x14, 0x50, 0x09, 0x00, 0x14, 0x50, 0x09];
            const PARAM_B0 = [0x81, 0x14, 0x50, 0x09, 0x00, 0x14, 0x50, 0x09];
            for (let i = 0; i < PARAM_80.length; i++) bytes[0x80 + i] = PARAM_80[i];
            for (let i = 0; i < PARAM_B0.length; i++) bytes[0xB0 + i] = PARAM_B0[i];
            writeField(bytes, 192, label || '', 10, 0x00);   // null-padded (real-format style)
            bytes[202] = 0x09; bytes[203] = 0x3A;             // format/serial word
            bytes[204] = 0x53; bytes[205] = 0x44;             // "SDOS" identifier (read by isDidaktik)
            bytes[206] = 0x4F; bytes[207] = 0x53;
            bytes[208] = 0x25;                                // '%'
            return bytes;
        }

        /**
         * Build a blank, MDOS-formatted Didaktik D40 image — 40 track, double-sided,
         * 9 sectors/track, 512 B = 368640 B (the standard 360K D40 per FlashFloppy
         * issue #335). Byte-reproduces a real D40 format (tests/pristine/ref-d40-blank.d40),
         * parameterised only by the label. (A different formatter than the D80 ref:
         * no signature string, its own parameter block and serial word.)
         * @param {string} label  up to 10 chars (null-padded)
         * @returns {Uint8Array}
         */
        static createBlankD40(label = '') {
            const bytes = new Uint8Array(40 * 2 * 9 * 512);   // 368640
            // FAT region is a fixed 5 image-sectors (1-5) as on D80; the
            // non-existent sectors past the disk (720..1704) are all marked 0xDDD.
            DidaktikLoader._writeMdosFatAndFill(bytes, 40 * 2 * 9, 5);

            // Sector 0: MDOS descriptor (no signature string for this formatter).
            // Parameter blocks at 0x80/0xB0 encode 40 tracks (0x28) / 9 sectors.
            const PARAM_80 = [0x81, 0x18, 0x28, 0x09, 0x00, 0x18, 0x28, 0x09, 0x00, 0x00, 0x00, 0x00,
                              0x01, 0x14, 0x50, 0x28, 0x00, 0x14, 0x28, 0x09];
            const PARAM_B0 = [0x81, 0x18, 0x28, 0x09, 0x00, 0x18, 0x28, 0x09];
            for (let i = 0; i < PARAM_80.length; i++) bytes[0x80 + i] = PARAM_80[i];
            for (let i = 0; i < PARAM_B0.length; i++) bytes[0xB0 + i] = PARAM_B0[i];
            writeField(bytes, 192, label || '', 10);  // space-padded (this formatter's style)
            bytes[202] = 0x51; bytes[203] = 0x79;             // format/serial word
            bytes[204] = 0x53; bytes[205] = 0x44;             // "SDOS" identifier
            bytes[206] = 0x4F; bytes[207] = 0x53;
            return bytes;
        }

        /**
         * Convert an extracted MDOS file to a TAP block pair (header + data).
         * BASIC (P) and Code (B) map to standard ZX header types.
         */
        static fileToTAP(fileData, fileInfo) {
            const header = new Uint8Array(21);
            header[0] = 0x00; // header flag
            // type byte: 0=BASIC, 3=CODE (others approximated as CODE)
            const tapType = fileInfo.type === 'P' ? 0 : fileInfo.type === 'N' ? 1
                : fileInfo.type === 'C' ? 2 : 3;
            header[1] = tapType;
            writeField(header, 2, fileInfo.name, 10);
            const len = fileData.length;
            header[12] = len & 0xFF; header[13] = (len >> 8) & 0xFF;
            const p1 = fileInfo.type === 'P' ? (fileInfo.basicLength || len) : fileInfo.startAddr;
            const p2 = fileInfo.type === 'P' ? (fileInfo.startAddr || 0x8000) : 0x8000;
            header[14] = p1 & 0xFF; header[15] = (p1 >> 8) & 0xFF;
            header[16] = p2 & 0xFF; header[17] = (p2 >> 8) & 0xFF;
            let parity = 0;
            for (let i = 0; i < 18; i++) parity ^= header[i];
            header[18] = parity;
            // (TAP block = 2-byte length + flag + payload + checksum)
            const mkBlock = (flag, payload) => {
                const blk = new Uint8Array(2 + 1 + payload.length + 1);
                const inner = 1 + payload.length + 1;
                blk[0] = inner & 0xFF; blk[1] = (inner >> 8) & 0xFF;
                blk[2] = flag;
                blk.set(payload, 3);
                let chk = flag;
                for (let i = 0; i < payload.length; i++) chk ^= payload[i];
                blk[blk.length - 1] = chk;
                return blk;
            };
            const hdrBlock = mkBlock(0x00, header.subarray(1, 18));
            const dataBlock = mkBlock(0xFF, fileData);
            const tap = new Uint8Array(hdrBlock.length + dataBlock.length);
            tap.set(hdrBlock, 0);
            tap.set(dataBlock, hdrBlock.length);
            return tap;
        }

        // ---- Write support (in-place edits; format per zxspectrumutils tap2d80.cpp) ----

        // Inverse of getFATnum: write a 12-bit FAT entry, preserving the shared nibble.
        static setFATnum(bytes, sector, value) {
            value &= 0xFFF;
            const sec = sector % DidaktikLoader.FAT_ENTRIES_PER_SECTOR;
            const base = DidaktikLoader.FAT_OFFSET +
                Math.floor(sector / DidaktikLoader.FAT_ENTRIES_PER_SECTOR) * 512 +
                Math.floor(sec * 3 / 2);
            if (sec % 2 === 0) {
                bytes[base] = value & 0xFF;
                bytes[base + 1] = (bytes[base + 1] & 0x0F) | (((value >> 8) & 0x0F) << 4);
            } else {
                bytes[base + 1] = value & 0xFF;
                bytes[base] = (bytes[base] & 0xF0) | ((value >> 8) & 0x0F);
            }
        }

        static _totalSectors(bytes) { return Math.floor(bytes.length / DidaktikLoader.SECTOR_SIZE); }

        // Free data sectors (FAT entry 0x000), data area starts at sector 14.
        static _freeSectors(bytes) {
            const total = DidaktikLoader._totalSectors(bytes);
            const free = [];
            for (let s = 14; s < total; s++) {
                if (DidaktikLoader.getFATnum(bytes, s) === 0x000) free.push(s);
            }
            return free;
        }

        // Find an empty directory slot offset, or -1 if the directory is full.
        static _findFreeDirEntry(bytes) {
            for (const physSec of DidaktikLoader.DIR_SECTORS) {
                const base = physSec * 512;
                if (base + 512 > bytes.length) break;
                for (let i = 0; i < 16; i++) {
                    const off = base + i * 32;
                    const t = bytes[off];
                    if (t === 0x00 || t === 0xE5) return off;
                }
            }
            return -1;
        }

        // Locate a file's directory entry by its (unique) first sector, or -1.
        static _findDirEntry(bytes, firstSec) {
            for (const physSec of DidaktikLoader.DIR_SECTORS) {
                const base = physSec * 512;
                if (base + 512 > bytes.length) break;
                for (let i = 0; i < 16; i++) {
                    const off = base + i * 32;
                    const t = bytes[off];
                    if (t === 0x00 || t === 0xE5) continue;
                    const fs = bytes[off + 17] | (bytes[off + 18] << 8);
                    if (fs === firstSec) return off;
                }
            }
            return -1;
        }

        /**
         * Add a file to a copy of the image. Returns the new Uint8Array.
         * file: { name, type ('P'/'B'/'N'/'C'/...), data:Uint8Array, startAddr, basicLength }
         * Throws on a full disk or full directory.
         */
        static addFile(data, file) {
            const bytes = new Uint8Array(data);
            const payload = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || 0);
            const len = payload.length;
            const numSec = Math.max(1, Math.ceil(len / 512));
            const free = DidaktikLoader._freeSectors(bytes);
            if (free.length < numSec) throw new Error(`Disk full (need ${numSec} sectors, ${free.length} free)`);
            const dirOff = DidaktikLoader._findFreeDirEntry(bytes);
            if (dirOff < 0) throw new Error('Directory full (max 128 files)');

            const chain = free.slice(0, numSec);
            // Write payload across the allocated sectors, zero-padding the final one.
            for (let i = 0; i < numSec; i++) {
                const o = chain[i] * 512;
                const start = i * 512;
                const end = Math.min(start + 512, len);
                bytes.set(payload.subarray(start, end), o);
                for (let p = end - start; p < 512; p++) bytes[o + p] = 0;
            }
            // FAT links + last-sector terminator (0xE00 + length%512, per tap2d80.cpp).
            for (let i = 0; i < numSec - 1; i++) DidaktikLoader.setFATnum(bytes, chain[i], chain[i + 1]);
            DidaktikLoader.setFATnum(bytes, chain[numSec - 1], 0xE00 | (len % 512));

            // Directory entry.
            const typeChar = (file.type || 'B').charAt(0);
            bytes[dirOff] = typeChar.charCodeAt(0);
            writeField(bytes, dirOff + 1, file.name || 'untitled', 10, 0x00);
            bytes[dirOff + 11] = len & 0xFF;
            bytes[dirOff + 12] = (len >> 8) & 0xFF;
            // bytes 13-14: P → autostart LINE, B/others → load address
            const startField = file.startAddr || 0;
            bytes[dirOff + 13] = startField & 0xFF;
            bytes[dirOff + 14] = (startField >> 8) & 0xFF;
            // bytes 15-16: P → BASIC program length, B/others → 0x8000 (per real disks)
            const bl = typeChar === 'P' ? (file.basicLength || len) : 0x8000;
            bytes[dirOff + 15] = bl & 0xFF;
            bytes[dirOff + 16] = (bl >> 8) & 0xFF;
            bytes[dirOff + 17] = chain[0] & 0xFF;
            bytes[dirOff + 18] = (chain[0] >> 8) & 0xFF;
            bytes[dirOff + 19] = 0x00;
            bytes[dirOff + 20] = 0x0F;                 // attributes (constant on real disks)
            bytes[dirOff + 21] = (len >> 16) & 0xFF;   // extended length (3rd byte)
            for (let i = 22; i < 32; i++) bytes[dirOff + i] = 0xE5;  // tail fill (matches tap2d80.cpp / real disks)
            return bytes;
        }

        /** Delete a file (free its FAT chain, clear the directory slot). Returns a new Uint8Array. */
        static deleteFile(data, fileInfo) {
            const bytes = new Uint8Array(data);
            const total = DidaktikLoader._totalSectors(bytes);
            let s = fileInfo.firstSec, guard = 0;
            const maxGuard = total + 4;
            while (guard++ < maxGuard && s >= 14 && s < total) {
                const nv = DidaktikLoader.getFATnum(bytes, s);
                DidaktikLoader.setFATnum(bytes, s, 0x000);
                if (nv >= 0xC00) break;
                s = nv;
            }
            const off = DidaktikLoader._findDirEntry(bytes, fileInfo.firstSec);
            if (off >= 0) bytes[off] = 0x00;
            return bytes;
        }

        /** Rename a file in place. Returns a new Uint8Array. */
        static renameFile(data, fileInfo, newName) {
            const bytes = new Uint8Array(data);
            const off = DidaktikLoader._findDirEntry(bytes, fileInfo.firstSec);
            if (off < 0) return bytes;
            writeField(bytes, off + 1, newName || '', 10, 0x00);
            return bytes;
        }

        /**
         * Update a file's start-address field (dir bytes 13-14) in place: the load
         * address for Code (B) files, or the autostart LINE for BASIC (P) files.
         * Returns a new Uint8Array.
         */
        static setStartAddr(data, firstSec, value) {
            const bytes = new Uint8Array(data);
            const off = DidaktikLoader._findDirEntry(bytes, firstSec);
            if (off < 0) return bytes;
            bytes[off + 13] = value & 0xFF;
            bytes[off + 14] = (value >> 8) & 0xFF;
            return bytes;
        }

        /**
         * Swap two files' 32-byte directory entries (located by their first sector),
         * changing catalog order without touching file data or the FAT. Returns a
         * new Uint8Array. Used to reorder files (Move Up/Down).
         */
        static swapDirEntries(data, firstSecA, firstSecB) {
            const bytes = new Uint8Array(data);
            const a = DidaktikLoader._findDirEntry(bytes, firstSecA);
            const b = DidaktikLoader._findDirEntry(bytes, firstSecB);
            if (a < 0 || b < 0 || a === b) return bytes;
            for (let i = 0; i < 32; i++) {
                const t = bytes[a + i];
                bytes[a + i] = bytes[b + i];
                bytes[b + i] = t;
            }
            return bytes;
        }
    }

    /**
     * Didaktik 80 disk controller: a WD2797 FDC on I/O ports, plus an aux
     * register that owns drive select, the motors, and — unusually — whether
     * the FDC's INTRQ and DRQ lines are allowed to pull the Z80's NMI.
     * Register behaviour follows FUSE's peripherals/disk/didaktik.c.
     *
     * Three things set it apart from the other interfaces here:
     *  - Its ROM is **14K**, not 8K: $0000-$37FF ROM, $3800-$3FFF RAM.
     *  - It pages in at **$0000**, so it takes over from the moment of reset.
     *  - The side is not in any control register. A WD2797 takes it from bit 1
     *    of the Type II/III command byte, so that is where this reads it.
     */
    export class DidaktikDisk extends PlusDDisk {
        // Aux register ($89) bits
        static get AUX_DRIVE_A()  { return 0x01; }
        static get AUX_DRIVE_B()  { return 0x02; }
        static get AUX_MOTOR_A()  { return 0x04; }
        static get AUX_MOTOR_B()  { return 0x08; }
        static get AUX_DATARQ_NMI() { return 0x40; }
        static get AUX_INTRQ_NMI()  { return 0x80; }

        constructor() {
            super();
            // MDOS geometry: 9 sectors of 512 bytes, numbered from 1, two sides
            this.sectorsPerTrack = 9;
            this.bytesPerSector = 512;
            this.firstSector = 1;
            this.tracks = 80;
            this.sides = 2;

            this.aux = 0;
            // Raised when the FDC wants a byte, or finishes a command — each
            // only if the matching aux bit lets it through. Spectrum turns these
            // into a Z80 NMI.
            this.onDataRequest = null;
            this.onIntRequest = null;
        }

        // 368640 = 40 tracks x 2 sides x 9 x 512, 737280 = 80 x 2 x 9 x 512
        loadDisk(data, type, driveIndex = 0) {
            const bytes = new Uint8Array(data);
            if (bytes.length === 80 * 2 * 9 * 512) { this.tracks = 80; this.sides = 2; }
            else if (bytes.length === 40 * 2 * 9 * 512) { this.tracks = 40; this.sides = 2; }
            super.loadDisk(bytes, type || 'd80', driveIndex);
        }

        createBlankDisk(label = 'BLANK', driveIndex = 0) {
            const img = this.tracks === 40
                ? DidaktikLoader.createBlankD40(label)
                : DidaktikLoader.createBlankD80(label);
            this.loadDisk(img, 'd80', driveIndex);
            return true;
        }

        writeAux(value) {
            this.aux = value & 0xFF;
            // Bit 1 picks drive B, otherwise drive A — the same test FUSE makes
            this.drive = (value & DidaktikDisk.AUX_DRIVE_B) ? 1 : 0;
        }

        executeCommand(cmd) {
            // WD2797: Type II (read/write sector) and Type III (read/write track,
            // read address) carry the side in bit 1 of the command. There is no
            // control register here to hold it.
            const typeII = (cmd & 0xC0) === 0x80;
            const typeIII = (cmd & 0xC0) === 0xC0 && (cmd & 0xF0) !== 0xD0;
            if (typeII || typeIII) this.side = (cmd >> 1) & 0x01;
            super.executeCommand(cmd);
            this._checkRequests(true);
        }

        // DRQ while a transfer has bytes left, otherwise INTRQ on completion.
        // Both are gated by the aux register: with neither bit set the interface
        // is in polled mode and must not interrupt at all.
        _checkRequests(first) {
            const transferring = (this.reading || this.writing) &&
                this.dataBuffer && this.dataPos < this.dataLen;
            if (transferring) {
                if ((this.aux & DidaktikDisk.AUX_DATARQ_NMI) && this.onDataRequest) {
                    this.onDataRequest(first);
                }
            } else if (this.intrq && (this.aux & DidaktikDisk.AUX_INTRQ_NMI) && this.onIntRequest) {
                this.onIntRequest();
            }
        }

        /**
         * Port read. The WD2797 sits at $81/$83/$85/$87; anything with bit 7
         * clear is the 8255 PPI, which FUSE stubs out as reading $FF.
         */
        read(port) {
            const low = port & 0xFF;
            if ((low & 0x80) === 0) return 0xFF;   // 8255 PPI — not wired up
            switch (low) {
                case 0x81: return this.readRegister(0);   // status
                case 0x83: return this.readRegister(1);   // track
                case 0x85: return this.readRegister(2);   // sector
                case 0x87: {                              // data
                    const value = this.readRegister(3);
                    this._checkRequests(false);
                    return value;
                }
            }
            return 0xFF;
        }

        write(port, value) {
            const low = port & 0xFF;
            if ((low & 0x80) === 0) return;        // 8255 PPI — not wired up
            // Aux is decoded with mask $F9, so $89/$8B/$8D/$8F all reach it
            if ((low & 0xF9) === 0x89) { this.writeAux(value); return; }
            switch (low) {
                case 0x81: this.executeCommand(value); break;   // command
                case 0x83: this.writeRegister(1, value); break; // track
                case 0x85: this.writeRegister(2, value); break; // sector
                case 0x87:                                      // data
                    this.writeRegister(3, value);
                    this._checkRequests(false);
                    break;
            }
        }

        reset() {
            super.reset();
            this.aux = 0;
            this.drive = 0;
            this.side = 0;
        }
    }

