/**
 * ZX-M8XXX - Opus Discovery: OPD images
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

import { writeField } from './common.js';
import { PlusDDisk } from './disk-mgt.js';
// A `.dsk` is a container, not a format, and the double-density Opus disks are
// only ever found in one -- see fromDSK. core/fdc.js imports nothing, so this
// is a leaf dependency.
import { DSKLoader } from '../fdc.js';

    export class OPDLoader {
        static get SECTORS_PER_TRACK() { return 18; }
        static get BYTES_PER_SECTOR() { return 256; }
        // Track count is derived from image size in getDiskInfo (SS = 40, DS DD = 80).
        static get SS_SIZE() { return 184320; }   // 40 × 18 × 256
        static get DS_SIZE() { return 737280; }   // 80 × 2 × 18 × 256 (real Opus DS DD)

        // Directory layout: sector 0 = disk descriptor, sectors 1-7 = directory (7 sectors)
        static get DIR_START_SECTOR() { return 1; }
        static get DIR_SECTORS() { return 7; }
        static get DIR_ENTRY_SIZE() { return 16; }
        static get MAX_DIR_ENTRIES() { return 112; }  // 7 * 256 / 16
        static get DATA_START_SECTOR() { return 8; }  // first data sector

        // File header (7 bytes at start of file data on disk)
        // Layout: type(1), length(2 LE), param1(2 LE), param2(2 LE)
        // BASIC: param1=autostart line, param2=program length (VARS-PROG)
        // CODE:  param1=start address, param2=32768
        static get FILE_HEADER_SIZE() { return 7; }

        static isOPD(data) {
            const len = data instanceof Uint8Array ? data.length : data.byteLength;
            if (len === OPDLoader.SS_SIZE || len === OPDLoader.DS_SIZE) return true;
            // A disk the Opus formatted states its own layout in the anchor
            // sector, so a size nobody has seen before is still an OPD when
            // that adds up — provided the sectors are the Opus's 18 × 256,
            // which keeps an 819,200-byte image an MGT one rather than a coin
            // toss.
            const g = OPDLoader.geometryFromAnchor(data);
            return !!g && g.sectorsPerTrack === OPDLoader.SECTORS_PER_TRACK &&
                   g.bytesPerSector === OPDLoader.BYTES_PER_SECTOR;
        }

        /**
         * The geometry a disk states in its own anchor sector (track 0, sector 0,
         * the first 256 bytes of the image): byte 2 is the track count, byte 3
         * the sectors per track, byte 4 a flags byte whose bits 7-6 are the
         * sector-size code and whose bit 4 says the disk is double sided. The
         * Opus writes it when it formats and its DOS reads it back to lay the
         * disk out, so this — not the file size — is what says how a disk is
         * organised. Two disks of the same size can disagree: 737,280 bytes is
         * 80 × 2 × 18 × 256 on a real DS/DD disk, and nothing but the anchor
         * distinguishes it from 160 single-sided tracks.
         *
         * Returned only when it accounts for every byte of the image; a disk
         * built elsewhere, or a blank file, gets null and the caller falls back
         * to the size-derived layout.
         */
        static geometryFromAnchor(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            if (bytes.length < OPDLoader.BYTES_PER_SECTOR) return null;
            const tracks = bytes[2];
            const sectorsPerTrack = bytes[3];
            const flags = bytes[4];
            if (!tracks || !sectorsPerTrack) return null;
            const sides = (flags & 0x10) ? 2 : 1;
            const bytesPerSector = 128 << ((flags >> 6) & 3);
            if (tracks * sides * sectorsPerTrack * bytesPerSector !== bytes.length) return null;
            return { tracks, sides, sectorsPerTrack, bytesPerSector };
        }

        static isDoubleSided(data) {
            const len = data instanceof Uint8Array ? data.length : data.byteLength;
            return len > OPDLoader.SS_SIZE;
        }

        /**
         * How a disk is laid out: its own anchor sector when that accounts for
         * the image, else the size-derived rule.
         *
         * Everything in the catalogue is counted in SECTORS — the directory is
         * sectors 1-7, and a directory entry's first/last blocks are sector
         * numbers — so the sector SIZE decides every offset here, and it is not
         * always 256. The double-density format is 10 × 512 per track, which
         * puts the directory at 512-3583 instead of 256-2047 and makes a block
         * twice the bytes. Reading one through the 256-byte layout gives a
         * catalogue of garbage.
         */
        static layoutOf(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const anchor = OPDLoader.geometryFromAnchor(bytes);
            if (anchor) return anchor;
            const sides = OPDLoader.isDoubleSided(bytes) ? 2 : 1;
            const sectorsPerTrack = OPDLoader.SECTORS_PER_TRACK;
            const bytesPerSector = OPDLoader.BYTES_PER_SECTOR;
            const tracks = Math.max(1, Math.floor(bytes.length / (sides * sectorsPerTrack * bytesPerSector)));
            return { tracks, sides, sectorsPerTrack, bytesPerSector };
        }

        /**
         * The flat Opus image inside a CPC-style `.dsk`, or null when that is
         * not what the container holds.
         *
         * Opus double-density disks are circulated as `.dsk` — the format has
         * 512-byte sectors, which is what a PC floppy controller can read, so
         * that is how they were imaged. The container says nothing about the
         * filesystem; the disk's own anchor sector does, and it only accounts
         * for the whole image when the image really is an Opus disk, so the
         * flattened sectors are the test.
         */
        static fromDSK(data) {
            const flat = DSKLoader.flatten(data);
            if (!flat) return null;
            const geom = OPDLoader.geometryFromAnchor(flat.data);
            if (!geom) return null;
            // The container's own idea of the geometry has to be the disk's, or
            // the sectors were flattened into the wrong grid.
            if (geom.tracks !== flat.tracks || geom.sides !== flat.sides ||
                geom.sectorsPerTrack !== flat.sectorsPerTrack ||
                geom.bytesPerSector !== flat.bytesPerSector) return null;
            return flat.data;
        }

        static getSectorOffset(track, side, sector, sides) {
            return ((track * sides + side) * OPDLoader.SECTORS_PER_TRACK + sector) * OPDLoader.BYTES_PER_SECTOR;
        }

        /**
         * Read a directory entry from the raw directory data.
         * Entry format (16 bytes): bytes_in_last_block(2), first_block(2), last_block(2), name(10)
         * All integers are little-endian.
         */
        static _readDirEntry(dirData, index) {
            const off = index * 16;
            const bytesInLast = dirData[off] | (dirData[off + 1] << 8);
            const firstBlock = dirData[off + 2] | (dirData[off + 3] << 8);
            const lastBlock = dirData[off + 4] | (dirData[off + 5] << 8);
            let name = '';
            for (let i = 0; i < 10; i++) {
                const ch = dirData[off + 6 + i];
                if (ch >= 0x20 && ch < 0x7F) name += String.fromCharCode(ch);
                else name += ' ';
            }
            return { bytesInLast, firstBlock, lastBlock, name };
        }

        /**
         * Read the 7-byte file header from the start of a file's data area.
         * Header: type(1), length(2 LE), param1(2 LE), param2(2 LE)
         * BASIC: param1=autostart line, param2=program length (VARS-PROG)
         * CODE:  param1=start address, param2=32768
         */
        static _readFileHeader(data, sectorOffset) {
            if (sectorOffset + 7 > data.length) return null;
            const type = data[sectorOffset];
            const length = data[sectorOffset + 1] | (data[sectorOffset + 2] << 8);
            const param1 = data[sectorOffset + 3] | (data[sectorOffset + 4] << 8);
            const param2 = data[sectorOffset + 5] | (data[sectorOffset + 6] << 8);
            return { type, length, param1, param2 };
        }

        static getDiskInfo(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            // The disk's own anchor sector first; only a disk that does not
            // state a layout accounting for its size falls back to deriving it
            // (SS = 40 tracks single-sided, DS DD = 80 double — the real Opus
            // DS is 80-track, not 40).
            const geom = OPDLoader.layoutOf(bytes);
            const { tracks, sides } = geom;
            const BPS = geom.bytesPerSector;
            const totalSectors = Math.floor(bytes.length / BPS);

            // Read directory to count used sectors and files properly
            const files = OPDLoader.listFiles(bytes);
            let usedDataSectors = 0;
            for (const f of files) {
                usedDataSectors += f.sectors;
            }
            // Sectors 0-7 are always "used" (descriptor + directory)
            const usedSectors = OPDLoader.DATA_START_SECTOR + usedDataSectors;

            // Disk label from directory entry 0
            const dirOffset = OPDLoader.DIR_START_SECTOR * BPS;
            const entry0 = OPDLoader._readDirEntry(bytes.subarray(dirOffset, dirOffset + OPDLoader.DIR_SECTORS * BPS), 0);
            const diskLabel = entry0.name.trim();

            return {
                tracks,
                sides,
                sectorsPerTrack: geom.sectorsPerTrack,
                bytesPerSector: BPS,
                totalSectors,
                usedSectors,
                freeSectors: totalSectors - usedSectors,
                totalSize: bytes.length,
                fileCount: files.length,
                diskLabel
            };
        }

        /**
         * Parse directory entries and return file list.
         * Directory is at sectors 1-7 (offset 256-2047).
         * Entry 0 = disk label, entries 1+ = files until last_block == 0xFFFF.
         */
        static listFiles(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            // The sector size is the disk's, not a constant: a double-density
            // disk counts in 512s. See layoutOf.
            const BPS = OPDLoader.layoutOf(bytes).bytesPerSector;
            if (bytes.length < OPDLoader.DATA_START_SECTOR * BPS) return [];

            const dirOffset = OPDLoader.DIR_START_SECTOR * BPS;
            const dirData = bytes.subarray(dirOffset, dirOffset + OPDLoader.DIR_SECTORS * BPS);
            const files = [];
            const maxEntries = Math.floor(dirData.length / OPDLoader.DIR_ENTRY_SIZE);

            // Skip entry 0 (disk label), iterate the rest
            for (let i = 1; i < maxEntries; i++) {
                const entry = OPDLoader._readDirEntry(dirData, i);

                // End of directory: last_block == 0xFFFF
                if (entry.lastBlock === 0xFFFF) break;

                // Skip empty entries (both blocks zero and no name)
                if (entry.firstBlock === 0 && entry.lastBlock === 0 && entry.bytesInLast === 0) continue;

                const sectors = entry.lastBlock - entry.firstBlock + 1;
                // bytesInLast: low 12 bits = bytes used in last sector minus 1 (per Opus manual)
                const rawLength = (entry.lastBlock - entry.firstBlock) * BPS + (entry.bytesInLast & 0x0FFF) + 1;
                // Block numbers in directory are 0-based from sector 1 (sector 0 is descriptor)
                // image_sector = block + 1, per EXTRACT.C: fseek(infile, (first_block + 1) * BPS, SEEK_SET)
                const dataOffset = (entry.firstBlock + 1) * BPS;

                // Read the 7-byte file header from the start of the file data
                const header = OPDLoader._readFileHeader(bytes, dataOffset);

                const typeNames = { 0: 'BASIC', 1: 'Num array', 2: 'Str array', 3: 'Code' };
                const extMap = { 0: 'B', 1: 'D', 2: 'D', 3: 'C' };

                files.push({
                    name: entry.name.replace(/\s+$/, ''),
                    dirIndex: i,
                    firstBlock: entry.firstBlock,
                    lastBlock: entry.lastBlock,
                    bytesInLast: entry.bytesInLast,
                    sectors,
                    rawLength,
                    length: header ? header.length : rawLength,
                    type: header ? header.type : -1,
                    typeName: header ? (typeNames[header.type] || 'Unknown') : 'Unknown',
                    ext: header ? (extMap[header.type] || 'C') : 'C',
                    startAddr: header ? (header.type === 0 ? 0 : header.param1) : 0,
                    autostart: header ? (header.type === 0 ? header.param1 : 0) : 0,
                    progLength: header && header.type === 0 ? header.param2 : null,
                    dataOffset
                });
            }

            return files;
        }

        /**
         * Extract file data from OPD image (without the 7-byte Opus file header).
         * Uses directory-derived rawLength rather than the header's length field,
         * which may not represent the total data size on real Opus disks.
         * Returns Uint8Array of file content, or null on error.
         */
        static extractFile(data, fileInfo) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const dataStart = fileInfo.dataOffset + OPDLoader.FILE_HEADER_SIZE;
            const dataLen = fileInfo.rawLength - OPDLoader.FILE_HEADER_SIZE;
            if (dataLen <= 0 || dataStart + dataLen > bytes.length) return null;
            return bytes.slice(dataStart, dataStart + dataLen);
        }

        /**
         * Convert an extracted Opus file to a TAP block (header + data).
         */
        static fileToTAP(fileData, fileInfo) {
            // Build a standard TAP: header block + data block
            const header = new Uint8Array(21);
            header[0] = 0x00; // header flag
            header[1] = fileInfo.type >= 0 ? fileInfo.type : 3; // file type
            writeField(header, 2, fileInfo.name, 10);
            const len = fileData.length;
            header[12] = len & 0xFF;
            header[13] = (len >> 8) & 0xFF;
            if (fileInfo.type === 0) {
                // BASIC: param1 = autostart, param2 = program length
                const autostart = fileInfo.autostart || 0x8000;
                header[14] = autostart & 0xFF;
                header[15] = (autostart >> 8) & 0xFF;
                header[16] = len & 0xFF;
                header[17] = (len >> 8) & 0xFF;
            } else {
                // CODE: param1 = start address, param2 = 32768
                header[14] = fileInfo.startAddr & 0xFF;
                header[15] = (fileInfo.startAddr >> 8) & 0xFF;
                header[16] = 0x00;
                header[17] = 0x80;
            }
            // Checksum
            let chk = 0;
            for (let i = 0; i < 18; i++) chk ^= header[i];
            header[18] = chk;

            // Data block
            const dataBlock = new Uint8Array(len + 2);
            dataBlock[0] = 0xFF; // data flag
            dataBlock.set(fileData, 1);
            chk = 0;
            for (let i = 0; i < len + 1; i++) chk ^= dataBlock[i];
            dataBlock[len + 1] = chk;

            // TAP: length word + header, length word + data
            const tap = new Uint8Array(4 + 19 + 2 + len + 2);
            tap[0] = 19; tap[1] = 0; // header block length
            tap.set(header.subarray(0, 19), 2);
            const dataLen = len + 2;
            tap[21] = dataLen & 0xFF; tap[22] = (dataLen >> 8) & 0xFF;
            tap.set(dataBlock, 23);
            return tap;
        }

        // Opus boot sector (sector 0), base64-encoded, keyed by total image size.
        // Captured from genuine blank Opus disks (geometry-specific). Real Opus tools
        // and hardware require a valid boot sector to recognise the disk; M8XXX's own
        // reader ignores sector 0, but strict readers (e.g. HCDisk) reject a disk
        // without it. 184320 = 40T SS, 737280 = 80T DS.
        static get OPD_BOOT_SECTORS() {
            return {
                184320: 'GAUoEkC6A37ddwAjft13Ad1+AuYvVyN+5tCy3XcCydXNYwh/ANoCCeEjZgYGPnHD5Q9GEkYSHACUHOUGIvcS8XfJzbIcd91OAt1GA91uBN1mBd1eBhYAyfUGJPcS8cnlzbIcd+HAw4AnKnhcERQA7VLYzVQVBiL3EjYBIzYDIRRA5QH3GE4MAAP1Af4BJwEAAQcBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BJwEAAQgBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BJwEAAQkBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BJwEAAQoBAQ==',
                737280: 'GAVQElAqDn7ddwAjft13Ad1+AuYvVyN+5tCy3XcCydXNYwh/ANoCCeEjZgYGPnHD5Q9GEkYSHACUHOUGIvcS8XfJzbIcd91OAt1GA91uBN1mBd1eBhYAyfUGJPcS8cnlzbIcd+HAw4AnKnhcERQA7VLYzVQVBiL3EjYBIzYDIRRA5QH3GE4MAAP1Af4BTwEAAQUBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BTwEAAQYBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BTwEAAQcBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BTwEAAQgBAQ==',
            };
        }

        // Write the Opus boot sector for this disk size into sector 0 (if available).
        static _writeOpdBoot(disk) {
            const b64 = OPDLoader.OPD_BOOT_SECTORS[disk.length];
            if (!b64) return false;
            const boot = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            disk.set(boot.subarray(0, OPDLoader.BYTES_PER_SECTOR), 0);
            return true;
        }

        // Write a 16-byte directory entry: bytesInLast/first/last (LE) + 10-char name.
        static _writeOpdDirEntry(disk, off, label, bytesInLast, first, last) {
            disk[off] = bytesInLast & 0xFF; disk[off + 1] = (bytesInLast >> 8) & 0xFF;
            disk[off + 2] = first & 0xFF; disk[off + 3] = (first >> 8) & 0xFF;
            disk[off + 4] = last & 0xFF; disk[off + 5] = (last >> 8) & 0xFF;
            writeField(disk, off + 6, label || '', 10);
        }

        static createBlankOPD(sides = 1) {
            const size = sides >= 2 ? OPDLoader.DS_SIZE : OPDLoader.SS_SIZE;
            const BPS = OPDLoader.BYTES_PER_SECTOR;
            const disk = new Uint8Array(size);
            OPDLoader._writeOpdBoot(disk);                                  // sector 0 (boot)
            const dirOffset = OPDLoader.DIR_START_SECTOR * BPS;
            disk.fill(0xE5, dirOffset);                                     // dir + data = formatted-empty
            const totalSectors = size / BPS;
            // entry 0 = disk label (occupies directory blocks 0..6); entry 1 = end marker
            OPDLoader._writeOpdDirEntry(disk, dirOffset, '', 0x00FF, 0, 6);
            OPDLoader._writeOpdDirEntry(disk, dirOffset + 16, '', 0x00FF, totalSectors - 1, 0xFFFF);
            return disk;
        }

        /**
         * Build an OPD image from a file list.
         * Each file must have: name, type, length, startAddr, autostart, data (Uint8Array).
         * @param {Array} files - File list
         * @param {string} diskName - Disk label (10 chars max)
         * @param {number} sides - 1 (SS) or 2 (DS)
         * @param {Uint8Array} [baseImage] - Original disk image to preserve sector 0 descriptor
         */
        static buildOPD(files, diskName, sides = 1, baseImage = null) {
            // An existing disk is rebuilt in ITS layout, not in the one the
            // single-density format has: a double-density disk counts in 512s,
            // and laying it out in 256s would not be an edit but a reformat
            // into a shorter image. A disk made from nothing has no layout to
            // keep, so `sides` chooses one.
            const geom = baseImage ? OPDLoader.layoutOf(baseImage) : null;
            const BPS = geom ? geom.bytesPerSector : OPDLoader.BYTES_PER_SECTOR;
            const size = baseImage ? baseImage.length
                                   : (sides >= 2 ? OPDLoader.DS_SIZE : OPDLoader.SS_SIZE);
            const totalSectors = Math.floor(size / BPS);
            const maxEntries = Math.floor(OPDLoader.DIR_SECTORS * BPS / OPDLoader.DIR_ENTRY_SIZE);
            const disk = new Uint8Array(size);
            if (baseImage) {
                // Editing an existing disk: preserve its real sector 0 (boot).
                disk.set(baseImage.subarray(0, Math.min(size, baseImage.length)));
            } else {
                // Creating from scratch: embed the Opus boot sector for this geometry.
                OPDLoader._writeOpdBoot(disk);
            }

            const dirOffset = OPDLoader.DIR_START_SECTOR * BPS;
            // Reset directory + data area to formatted-empty (0xE5), then rewrite.
            disk.fill(0xE5, dirOffset);
            // entry 0 = disk label (occupies directory blocks 0..6)
            OPDLoader._writeOpdDirEntry(disk, dirOffset, diskName, BPS - 1, 0, 6);

            // Allocate files into entries 1..N starting at the data area
            let nextSector = OPDLoader.DATA_START_SECTOR;
            let written = 0;
            for (let fi = 0; fi < files.length && fi < maxEntries - 2; fi++) {
                const f = files[fi];
                const fileData = f.data;
                const headerLen = OPDLoader.FILE_HEADER_SIZE;
                const totalBytes = headerLen + fileData.length;
                const sectorsNeeded = Math.ceil(totalBytes / BPS);

                if (nextSector + sectorsNeeded > totalSectors) break; // disk full

                // Block numbers: block = image_sector - 1
                // (per EXTRACT.C: fseek(infile, (first_block + 1) * BPS, SEEK_SET))
                const firstBlock = nextSector - 1;
                const lastBlock = nextSector + sectorsNeeded - 2;
                // bytesInLast stores (actual bytes in last sector) - 1
                const bytesInLast = totalBytes - (sectorsNeeded - 1) * BPS - 1;

                // Write directory entry (entry written+1, since entry 0 is the label)
                const entryOff = dirOffset + (written + 1) * 16;
                disk[entryOff + 0] = bytesInLast & 0xFF;
                disk[entryOff + 1] = (bytesInLast >> 8) & 0xFF;
                disk[entryOff + 2] = firstBlock & 0xFF;
                disk[entryOff + 3] = (firstBlock >> 8) & 0xFF;
                disk[entryOff + 4] = lastBlock & 0xFF;
                disk[entryOff + 5] = (lastBlock >> 8) & 0xFF;
                writeField(disk, entryOff + 6, f.name || '', 10);

                // Write file header (7 bytes) at the image sector
                // Layout: type(1), length(2 LE), param1(2 LE), param2(2 LE)
                const dataOff = nextSector * BPS;
                const ftype = f.type !== undefined ? f.type : 3; // default CODE
                disk[dataOff + 0] = ftype;
                // The header's length is not always how much data there is. An
                // Opus game is one catalogue entry: a short BASIC loader, whose
                // header declares only the loader, with the game glued after it
                // filling the rest of the allocation. Copying such a file has to
                // keep both — all the sectors, and the short length that makes
                // the ROM load it as a loader. A caller that does not say gets
                // the ordinary answer, and a declared length longer than the
                // data there is would be a lie, so it is clamped.
                const len = Math.min(
                    f.declaredLength != null ? f.declaredLength : fileData.length,
                    fileData.length);
                disk[dataOff + 1] = len & 0xFF;
                disk[dataOff + 2] = (len >> 8) & 0xFF;
                // BASIC: param1=autostart, param2=program length
                // CODE:  param1=start address, param2=32768
                const param1 = ftype === 0 ? (f.autostart || 0x8000) : (f.startAddr || 0);
                disk[dataOff + 3] = param1 & 0xFF;
                disk[dataOff + 4] = (param1 >> 8) & 0xFF;
                const param2 = ftype === 0 ? (f.progLength || len) : 0x8000;
                disk[dataOff + 5] = param2 & 0xFF;
                disk[dataOff + 6] = (param2 >> 8) & 0xFF;

                // Write file data
                disk.set(fileData, dataOff + headerLen);

                nextSector += sectorsNeeded;
                written++;
            }

            // End-of-directory terminator after the last file (last_block=0xFFFF;
            // free pointer = last block, matching a real blank Opus disk)
            OPDLoader._writeOpdDirEntry(disk, dirOffset + (written + 1) * 16, diskName, BPS - 1, totalSectors - 1, 0xFFFF);

            return disk;
        }
    }

    /**
     * Opus Discovery disk controller: a WD1770 FDC and an MC6821 PIA, both
     * reached through MEMORY addresses rather than I/O ports — the one thing
     * that makes this interface unlike every other one here.
     *
     * The FDC is the same chip family as the +D's WD1772, so the command
     * engine is inherited from PlusDDisk; only the decode, the geometry and
     * the PIA are Opus's own. Register behaviour follows FUSE's
     * peripherals/disk/opus.c (opus_read / opus_write / opus_6821_access).
     *
     * Geometry differs from MGT in every dimension: 18 sectors of 256 bytes
     * numbered from ZERO, where MGT has 10 of 512 numbered from one.
     */
    export class OpusDisk extends PlusDDisk {
        constructor() {
            super();

            this.sectorsPerTrack = OPDLoader.SECTORS_PER_TRACK;  // 18
            this.bytesPerSector = OPDLoader.BYTES_PER_SECTOR;    // 256
            this.firstSector = 0;
            this.tracks = 40;
            this.sides = 1;
            this.sector = 0;

            // The Discovery's own mechanism, per drive — see stepFactor.
            for (const drv of this.drives) drv.driveTracks = 40;

            // MC6821 PIA. Only port A is wired to anything: bit 1 selects the
            // drive and bit 4 the side. Control register bit 2 decides whether
            // a port A access reaches the data register or the direction
            // register — the classic 6821 shared-address trick.
            this.dataRegA = 0;
            this.dataDirA = 0;
            this.controlA = 0;
            this.dataRegB = 0;
            this.dataDirB = 0;
            this.controlB = 0;

            // Port B is the Centronics data port. Bit 6 of port A reads back
            // the printer's BUSY line, and reads HIGH when no printer is
            // attached — see pia(). We emulate no printer, so this stays
            // false; a printer emulation would set it and take the bytes
            // handed to onPrinterByte.
            this.printerConnected = false;
            this.onPrinterByte = null;

            // Raised when the FDC has a byte ready (or wants one) — see
            // _checkDataRequest. Spectrum turns this into a Z80 NMI.
            this.onDataRequest = null;
        }

        /**
         * Geometry belongs to the DISK, not to the controller. An Opus takes two
         * drives and the pair need not hold the same kind of disk: a 40-track
         * single-sided one in drive 1 and an 80-track double-sided one in drive
         * 2 is an ordinary setup, and reading either through the other's layout
         * lands on the wrong sector. It used to be one set of numbers per
         * controller, taken from whichever image was loaded last.
         *
         * Each disk states its layout in its anchor sector; a file that does not
         * (one built elsewhere, or a blank) falls back to the size-derived rule.
         */
        loadDisk(data, type, driveIndex = 0) {
            const bytes = new Uint8Array(data);
            super.loadDisk(bytes, type || 'opd', driveIndex);
            const drv = this.drives[driveIndex & 0x01];
            drv.geometry = OpusDisk.geometryFor(bytes);
        }

        static geometryFor(bytes) {
            return OPDLoader.layoutOf(bytes);
        }

        // The four geometry fields answer for the disk in the CURRENT drive, and
        // fall back to what the constructor set when that drive is empty. They
        // are writable because PlusDDisk's constructor assigns to them; a write
        // sets the fallback, never the disk's own stated layout.
        get sectorsPerTrack() { return this._diskGeom().sectorsPerTrack; }
        set sectorsPerTrack(v) { this._defaultGeom().sectorsPerTrack = v; }
        get bytesPerSector() { return this._diskGeom().bytesPerSector; }
        set bytesPerSector(v) { this._defaultGeom().bytesPerSector = v; }
        get tracks() { return this._diskGeom().tracks; }
        set tracks(v) { this._defaultGeom().tracks = v; }
        get sides() { return this._diskGeom().sides; }
        set sides(v) { this._defaultGeom().sides = v; }

        /**
         * A 40-track disk in an 80-track drive is written on every other
         * cylinder, so its DOS double-steps: track 1 of the disk is cylinder 2
         * of the drive. EXCOM 2.28 assumes the 80-track mechanism and does
         * exactly that; the stock ROMs assume the 40-track one and do not.
         * Nothing in a raw `.opd` says which drive it is sitting in, so the
         * drive's track count is a setting (Settings → Machines, beside the Opus
         * tick) and defaults to 40 — what every ROM but EXCOM expects.
         */
        get stepFactor() {
            const drv = this.currentDisk;
            if (!drv || !drv.diskData) return 1;
            return ((drv.driveTracks || 40) >= 80 && this.tracks <= 40) ? 2 : 1;
        }

        /** 40 or 80 cylinders, per drive. */
        setDriveTracks(driveIndex, tracks) {
            const drv = this.drives[driveIndex & 0x01];
            drv.driveTracks = tracks >= 80 ? 80 : 40;
            if ((drv.headTrack | 0) > drv.driveTracks - 1) drv.headTrack = 0;
        }

        _defaultGeom() {
            // Called from super()'s field assignments, before any field of ours
            // has been initialised, so it creates the object on first use.
            if (!this._geom) this._geom = {};
            return this._geom;
        }
        _diskGeom() {
            const drv = this.drives && this.drives[this.drive];
            // An ejected drive has no geometry — hence the diskData check, which
            // also means eject needs no bookkeeping of its own.
            return (drv && drv.diskData && drv.geometry) || this._defaultGeom();
        }

        createBlankDisk(label = 'BLANK', driveIndex = 0) {
            const opd = OPDLoader.createBlankOPD(this.sides);
            this.loadDisk(opd, 'opd', driveIndex);
            return true;
        }

        /**
         * MC6821 access. `dir` is 1 for a write, 0 for a read; on a read the
         * returned value matters, on a write it does not.
         *
         * Three read side-effects, all from FUSE's opus_6821_access:
         *
         * - Port A bit 6 is the parallel printer's BUSY line, and reads HIGH
         *   when the printer is busy **or not connected**. Getting this
         *   backwards (clearing it unconditionally, which is what FUSE does
         *   only when a printer IS attached) told every ROM that a printer was
         *   sitting there ready — and the v2.2, v2.22, EXCOM and QuickDOS ROMs
         *   then hung in their own output path, so `CAT 1` never reached the
         *   disk at all. v1.2 does not consult the bit, which is why it was
         *   the only ROM that could catalogue a disk.
         * - The port A CONTROL register always reads bit 6 set, to acknowledge
         *   parallel-port actions.
         * - Port B is the printer's data port: reads return the data or the
         *   direction register depending on control B bit 2, and control B
         *   reads back as written — NOT with bit 6 forced, unlike control A.
         */
        pia(reg, data, dir) {
            switch (reg & 0x03) {
                case 0: // Port A: data register or data direction register
                    if (dir) {
                        if (this.controlA & 0x04) {
                            this.dataRegA = data;
                            this.drive = (data & 0x02) ? 1 : 0;
                            this.side = (data & 0x10) ? 1 : 0;
                        } else {
                            this.dataDirA = data;
                        }
                    } else {
                        if (this.controlA & 0x04) {
                            if (this.printerConnected) this.dataRegA &= ~0x40;
                            else this.dataRegA |= 0x40;
                            return this.dataRegA;
                        }
                        return this.dataDirA;
                    }
                    break;

                case 1: // Port A control register
                    if (dir) {
                        this.controlA = data;
                    } else {
                        return this.controlA | 0x40;
                    }
                    break;

                case 2: // Port B: the Centronics data port
                    if (dir) {
                        if (this.controlB & 0x04) {
                            this.dataRegB = data;
                            if (this.onPrinterByte) this.onPrinterByte(data);
                        } else {
                            this.dataDirB = data;
                        }
                    } else {
                        return (this.controlB & 0x04) ? this.dataRegB : this.dataDirB;
                    }
                    break;

                case 3: // Port B control register
                    if (dir) {
                        this.controlB = data;
                    } else {
                        return this.controlB;
                    }
                    break;
            }
            return 0;
        }

        /**
         * The Opus wires the WD1770's DRQ to the Z80's NMI line — FUSE allocates
         * the chip with WD_FLAG_DRQ and its set_datarq handler raises an NMI.
         * So a sector is not transferred by polling the data register: every byte
         * the chip has ready interrupts the CPU, and the handler in the Opus ROM
         * at $0066 moves it. Without this a ROM that transfers by NMI simply
         * waits forever, having issued its read command and got no interrupt.
         *
         * The callback is set by Spectrum, which defers the actual NMI to the
         * next instruction boundary.
         */
        _checkDataRequest(first) {
            if (this.hasDataRequest() && this.onDataRequest) this.onDataRequest(first);
        }

        /**
         * Is DRQ asserted right now — does the chip still have a byte to give
         * or want one? The NMI is raised a couple of thousand T-states after
         * the request, and in that gap the transfer can finish (the last byte
         * of the sector was taken, or a Force Interrupt came in). DRQ is a
         * LEVEL on the real wire, not a pulse, so an NMI must not be delivered
         * for a request that has since gone away: Spectrum asks again before
         * firing.
         */
        hasDataRequest() {
            return !!((this.reading || this.writing) &&
                this.dataBuffer && this.dataPos < this.dataLen);
        }

        readRegister(reg) {
            const value = super.readRegister(reg);
            if ((reg & 0x03) === 3) this._checkDataRequest(false);
            return value;
        }

        writeRegister(reg, value) {
            super.writeRegister(reg, value);
            // A command may start a transfer, and a data write may leave room for
            // the next byte — both are edges where DRQ can go active. The command
            // case is the FIRST byte of a transfer and needs the longer delay:
            // the ROM has housekeeping to do before it can take an interrupt.
            const r = reg & 0x03;
            if (r === 0) this._checkDataRequest(true);
            else if (r === 3) this._checkDataRequest(false);
        }

        /**
         * Read through the Opus window. ROM ($0000-$1FFF) and RAM
         * ($2000-$27FF) are handled by the memory map, so only the register
         * space arrives here. Anything at $3800 and above is unmapped.
         */
        readMemory(address) {
            if (address >= 0x3800) return 0xFF;
            if (address >= 0x3000) return this.pia(address, 0, 0);
            if (address >= 0x2800) return this.readRegister(address);
            return 0xFF;
        }

        /**
         * The same decode with no side effects, for the debugger. Reading the
         * data register through readMemory advances the sector buffer and raises
         * a DRQ NMI, and reading port A clears its bit 6 — so a memory panel or a
         * watch left pointing at $2800 would drive the disk controller merely by
         * being on screen. Memory.peek routes inspection reads here.
         */
        peekMemory(address) {
            if (address >= 0x3800) return 0xFF;
            if (address >= 0x3000) {
                switch (address & 0x03) {
                    case 0:
                        if (!(this.controlA & 0x04)) return this.dataDirA;
                        // the same printer-busy bit pia() would report, without
                        // writing it back into the data register
                        return this.printerConnected ? (this.dataRegA & ~0x40)
                                                     : (this.dataRegA | 0x40);
                    case 1: return this.controlA | 0x40;
                    case 2: return (this.controlB & 0x04) ? this.dataRegB : this.dataDirB;
                    case 3: return this.controlB;
                }
                return 0;
            }
            if (address >= 0x2800) {
                switch (address & 0x03) {
                    case 0: return this.currentDisk.diskData ? this.status : this.NOT_READY;
                    case 1: return this.track;
                    case 2: return this.sector;
                    case 3: return this.data;
                }
            }
            return 0xFF;
        }

        writeMemory(address, value) {
            if (address < 0x2000 || address >= 0x3800) return;
            if (address >= 0x3000) {
                this.pia(address, value, 1);
            } else if (address >= 0x2800) {
                this.writeRegister(address, value);
            }
        }

        reset() {
            super.reset();
            this.dataRegA = 0;
            this.dataDirA = 0;
            this.controlA = 0;
            this.dataRegB = 0;
            this.dataDirB = 0;
            this.controlB = 0;
            this.drive = 0;
            this.side = 0;
        }
    }
