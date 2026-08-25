/**
 * ZX-M8XXX - DISCiPLE/+D (MGT): image reader and WD1772 controller
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

import { TRDLoader } from './disk-beta.js';

    export class MGTLoader {
        /**
         * Check if data is an MGT file
         * Standard: 819200 bytes (80 tracks, 2 sides, 10 sectors, 512 bytes)
         * 40-track: 409600 bytes (40 tracks variant)
         */
        static isMGT(data) {
            const bytes = new Uint8Array(data);
            if (bytes.length !== 819200 && bytes.length !== 409600) return false;

            // Validate directory: check first few slots have valid file types
            // G+DOS types 1-11, SAMDOS types 16-20
            let validCount = 0;
            let emptyCount = 0;
            for (let i = 0; i < 20; i++) {
                const slotOffset = MGTLoader._slotOffset(i);
                if (slotOffset + 256 > bytes.length) break;
                const fileType = bytes[slotOffset];
                if (fileType === 0) {
                    emptyCount++;
                } else if ((fileType >= 1 && fileType <= 11) || (fileType >= 16 && fileType <= 20)) {
                    validCount++;
                } else {
                    // Invalid file type — not MGT
                    return false;
                }
            }
            // Need at least one valid file, or all empty (blank disk)
            return validCount > 0 || emptyCount >= 5;
        }

        /**
         * Calculate byte offset of directory slot N in the disk image.
         * Directory: tracks 0-1, both sides = 40 sectors × 512 bytes.
         * 2 entries per sector (256 bytes each).
         * Sector layout: T0S0 S0, T0S0 S1, T0S1 S0, T0S1 S1, ... interleaved.
         *
         * Slot N:
         *   sectorIndex = floor(N / 2)
         *   entryInSector = N % 2
         *   Track-side mapping: sectors 0-9 = T0/S0, 10-19 = T0/S1, 20-29 = T1/S0, 30-39 = T1/S1
         *   imageOffset = ((track * 2 + side) * 10 + sectorInTrack) * 512 + entryInSector * 256
         */
        static _slotOffset(slotIndex) {
            const sectorIndex = Math.floor(slotIndex / 2);
            const entryInSector = slotIndex % 2;
            // sectorIndex 0-9: track 0 side 0
            // sectorIndex 10-19: track 0 side 1
            // sectorIndex 20-29: track 1 side 0
            // sectorIndex 30-39: track 1 side 1
            return sectorIndex * 512 + entryInSector * 256;
        }

        /**
         * Calculate image offset for a given track/side/sector.
         * Track: physical cylinder (0-79), Side: 0 or 1, Sector: 1-10 (1-based).
         * If track has bit 7 set, it encodes side 1 (track 0x80 = cyl 0 side 1).
         * MGT image layout: cyl0/s0, cyl0/s1, cyl1/s0, cyl1/s1, ...
         */
        static getSectorOffset(track, side, sector) {
            const physTrack = track & 0x7F;
            const physSide = (track & 0x80) ? 1 : side;
            return ((physTrack * 2 + physSide) * 10 + (sector - 1)) * 512;
        }

        /**
         * Convert G+DOS track byte to image offset.
         * Directory entries (firstTrack), sector maps, and chain pointers
         * encode the track as: cylinder (bits 0-6), side (bit 7).
         *   track 0-79 = cylinder 0-79 side 0
         *   track 128-207 = cylinder 0-79 side 1
         * Sectors are 1-10 (1-based).
         * Image layout: cyl0/s0, cyl0/s1, cyl1/s0, cyl1/s1, ...
         */
        static logicalTrackOffset(track, sector) {
            const cyl = track & 0x7F;
            const side = (track >> 7) & 1;
            return ((cyl * 2 + side) * 10 + (sector - 1)) * 512;
        }

        /**
         * List files in MGT image
         * Returns array of {name, type, typeName, length, startAddress, sectors,
         *                    firstTrack, firstSector, sectorMap, autostart, bodyLength,
         *                    tapeType, slotIndex}
         */
        static listFiles(data) {
            const bytes = new Uint8Array(data);
            const files = [];
            const typeNames = {
                0: 'Erased', 1: 'BASIC', 2: 'Num array', 3: 'Str array',
                4: 'Code', 5: '48K Snap', 6: 'Microdrive', 7: 'SCREEN$',
                8: 'Special', 9: '128K Snap', 10: 'Opentype', 11: 'Execute',
                // SAMDOS (SAM Coupé) types — compatible MGT disk format
                16: 'BASIC', 17: 'Num array', 18: 'Str array',
                19: 'Code', 20: 'SCREEN$'
            };

            for (let i = 0; i < 80; i++) {
                const offset = MGTLoader._slotOffset(i);
                if (offset + 256 > bytes.length) break;

                const fileType = bytes[offset];
                if (fileType === 0) continue;  // Empty/erased slot
                // Valid types: 1-11 (G+DOS), 16-20 (SAMDOS/SAM Coupé)
                // Mixed disks exist (SAMDOS loader + G+DOS data files)
                if (fileType > 20 || (fileType > 11 && fileType < 16)) continue;

                // First sector location — validate before accepting
                const firstTrack = bytes[offset + 13];
                const firstSector = bytes[offset + 14];
                if (firstSector < 1 || firstSector > 10) continue;  // Invalid sector (1-10 only)
                const firstCyl = firstTrack & 0x7F;
                if (firstCyl >= 80) continue;                        // Invalid cylinder (0-79 only)
                // Directory occupies cylinders 0-1 (both sides); data never starts there
                if (firstCyl < 2) continue;

                // Sector count (big-endian at offsets 11-12)
                const sectors = (bytes[offset + 11] << 8) | bytes[offset + 12];
                if (sectors === 0) continue;  // Empty entry

                // Read filename (10 bytes, space-padded)
                let name = '';
                for (let j = 1; j <= 10; j++) {
                    const ch = bytes[offset + j];
                    if (ch >= 0x20 && ch < 0x80) {
                        name += String.fromCharCode(ch);
                    }
                }
                name = name.trimEnd();

                // Sector address map (bitmap): bytes 15-209 (1560-bit bitmap)
                const sectorMap = [];
                for (let j = 0; j < sectors && j < 97; j++) {
                    const mapOffset = offset + 15 + j * 2;
                    if (mapOffset + 1 < offset + 210) {
                        sectorMap.push({
                            track: bytes[mapOffset],
                            sector: bytes[mapOffset + 1]
                        });
                    }
                }

                let tapeType, length, param1, param2, param3;
                // Per-file SAMDOS detection: types 16-20 use SAMDOS metadata layout
                const isSAMDOS = fileType >= 16;

                if (isSAMDOS) {
                    // SAMDOS metadata at bytes 236-244 of directory entry
                    // Length: pages * 16384 + modulo (supports files > 64KB)
                    const pages = bytes[offset + 239];
                    const modLen = bytes[offset + 240] | (bytes[offset + 241] << 8);
                    length = pages * 16384 + modLen;

                    // Start address: page (byte 236 bits 0-4) + offset (bytes 237-238 LE)
                    // Page offset uses REL PAGE FORM encoding (section bits + offset)
                    const startPage = bytes[offset + 236] & 0x1F;
                    const pageOffset = bytes[offset + 237] | (bytes[offset + 238] << 8);
                    param1 = pageOffset; // Full REL PAGE FORM address for display

                    // Execution address / autostart (bytes 242-244)
                    const execPage = bytes[offset + 242];
                    const execOffset = bytes[offset + 243] | (bytes[offset + 244] << 8);
                    param3 = (execPage === 0xFF) ? 0xFFFF : execOffset;

                    // SAMDOS type → equivalent tape type for compatibility
                    tapeType = fileType - 16; // 16→0 BASIC, 17→1 NumArr, 18→2 StrArr, 19→3 Code
                    param2 = 0;

                    // For BASIC: program body length from FileTypeInfo (bytes 221-223)
                    if (fileType === 16) {
                        // 3-byte page-form triplet: byte 221 = pages, bytes 222-223 = offset
                        const bPages = bytes[offset + 221];
                        const bOff = bytes[offset + 222] | (bytes[offset + 223] << 8);
                        param2 = bPages * 16384 + (bOff & 0x3FFF);
                    }
                } else {
                    // G+DOS metadata at bytes 210-219
                    tapeType = bytes[offset + 211];
                    length = bytes[offset + 212] | (bytes[offset + 213] << 8);
                    param1 = bytes[offset + 214] | (bytes[offset + 215] << 8);
                    param2 = bytes[offset + 216] | (bytes[offset + 217] << 8);
                    param3 = bytes[offset + 218] | (bytes[offset + 219] << 8);
                }

                const typeName = typeNames[fileType] || `Type ${fileType}`;

                files.push({
                    name,
                    type: fileType,
                    typeName,
                    tapeType,
                    length,
                    startAddress: param1,
                    bodyLength: param2,
                    sectors,
                    firstTrack,
                    firstSector,
                    sectorMap,
                    autostart: (fileType === 1 || fileType === 16) ? param3 : null,
                    isSAMDOS,
                    slotIndex: i
                });
            }

            return files;
        }

        /**
         * Extract file data from MGT image by following sector chain.
         * Each sector stores 510 bytes of file data + 2-byte chain pointer
         * (track, sector of next sector) in the last 2 bytes.
         * Track numbers use G+DOS encoding: cylinder in bits 0-6, side in bit 7
         * (0-79 = side 0, 128-207 = side 1), matching directory and chain pointer format.
         * SPECIAL (type 8) files use contiguous 512-byte sectors without chain.
         * Non-SPECIAL files saved by G+DOS have a 9-byte file header prepended
         * (type + length + params, mirroring the Spectrum tape header);
         * some third-party utilities omit this header. The header is auto-detected
         * by checking if byte 0 matches the expected tape type and bytes 1-2
         * match the directory length — if valid, it is stripped.
         */
        static extractFile(data, fileInfo) {
            const bytes = new Uint8Array(data);
            const sectorSize = 512;
            const isContig = fileInfo.type === 8; // SPECIAL uses full 512-byte sectors
            const dataPerSector = isContig ? 512 : 510;
            const result = new Uint8Array(fileInfo.sectors * dataPerSector);
            let destPos = 0;

            let curTrack = fileInfo.firstTrack;
            let curSector = fileInfo.firstSector;

            for (let i = 0; i < fileInfo.sectors; i++) {
                // firstTrack and chain pointers use G+DOS track encoding (cyl | side<<7)
                const offset = MGTLoader.logicalTrackOffset(curTrack, curSector);

                if (offset >= 0 && offset + sectorSize <= bytes.length) {
                    result.set(bytes.slice(offset, offset + dataPerSector), destPos);

                    if (!isContig) {
                        // Last 2 bytes of sector = chain pointer (track, sector)
                        curTrack = bytes[offset + 510];
                        curSector = bytes[offset + 511];
                    }
                }
                destPos += dataPerSector;

                if (isContig) {
                    // Advance sequentially: sectors 1-10 side 0, then side 1, then next cylinder
                    curSector++;
                    if (curSector > 10) {
                        curSector = 1;
                        if ((curTrack & 0x80) === 0) {
                            curTrack |= 0x80; // switch to side 1 of same cylinder
                        } else {
                            curTrack = (curTrack & 0x7F) + 1; // next cylinder, side 0
                        }
                    }
                }
            }

            if (isContig) {
                return result.slice(0, fileInfo.length);
            }

            // SAMDOS files: 9-byte header with SAM-specific format
            // Byte 0: SAMDOS type (16-20), bytes 1-2: modulo length, byte 7: pages
            if (fileInfo.isSAMDOS) {
                if (result.length >= 9) {
                    const hdrType = result[0];
                    const hdrModLen = result[1] | (result[2] << 8);
                    const hdrPages = result[7];
                    const hdrLen = hdrPages * 16384 + hdrModLen;
                    if (hdrType === fileInfo.type && hdrLen === fileInfo.length) {
                        return result.slice(9, 9 + fileInfo.length);
                    }
                }
                return result.slice(0, fileInfo.length);
            }

            // Detect 9-byte file header: GDOS type → Spectrum tape type mapping
            // GDOS: 1=BASIC→0, 2=NumArr→1, 3=ChrArr→2, 4=Code→3, 7=SCREEN$→3
            const gdosToTape = { 1: 0, 2: 1, 3: 2, 4: 3, 7: 3 };
            const expectedTape = gdosToTape[fileInfo.type];
            if (expectedTape !== undefined && result.length >= 9) {
                const hdrType = result[0];
                const hdrLen = result[1] | (result[2] << 8);
                if (hdrType === expectedTape && hdrLen === fileInfo.length) {
                    return result.slice(9, 9 + fileInfo.length);
                }
            }
            // No valid header — return raw data trimmed to directory length
            return result.slice(0, fileInfo.length);
        }

        /**
         * Build an MGT (+D/DISCiPLE G+DOS) disk image from a list of files.
         * Uses the G+DOS chain format that extractFile expects (and real +D uses):
         * each 512-byte sector holds 510 data bytes + a 2-byte chain pointer
         * (next track | side<<7, next sector; 0,0 = end of chain).
         *
         * files: [{ name, mgtType (1-11/16-20) | type, tapeType, length,
         *           data (Uint8Array, first `length` bytes used), startAddress,
         *           bodyLength, autostart, deleted }]
         *
         * Directory occupies cylinders 0-1 (4 logical tracks, 80 slots); data
         * starts at cylinder 2 (matching the reader's `firstCyl >= 2` check).
         * The sector-allocation map (bytes 15-209) is written as a best-effort
         * 1560-bit bitmap over the data area — note: the reader follows the chain
         * and ignores this map, and the exact real-+D bit ordering is not
         * spec-verified, so it is informational for external tools only.
         */
        static buildMGT(files, diskLabel = '') {
            const img = new Uint8Array(819200); // 80 cyl x 2 sides x 10 sec x 512 (DS)
            let curCyl = 4, curSide = 0, curSec = 1; // data starts at cyl 4 (cyl 0-3 reserved), per real +D
            const advance = () => {
                // +D allocation order: fill side 0 of every cylinder (track byte 4,5,…,79) first,
                // then side 1 — matching real +D images (see tests/pristine/ref-mgt-80ds.mgt).
                if (++curSec > 10) { curSec = 1; if (++curCyl > 79) { curCyl = 4; curSide++; } }
            };

            let slot = 0;
            for (const f of (files || [])) {
                if (!f || f.deleted) continue;
                if (slot >= 80) break;
                const length = (f.length != null) ? f.length : (f.data ? f.data.length : 0);
                const raw = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data || 0);
                const mgtType = f.mgtType || f.type || 4;

                // File-type metadata, mirrored both in the directory (bytes 211-219) and in the
                // 9-byte header that prefixes the file DATA on real +D disks.
                const GDOS_TO_TAPE = { 1: 0, 2: 1, 3: 2, 4: 3, 7: 3 };
                const hdrTape = GDOS_TO_TAPE[mgtType];
                const tapeType = (f.tapeType != null) ? f.tapeType : (hdrTape != null ? hdrTape : 3);
                const startAddr = f.startAddress || 0;
                const isBASIC = mgtType === 1 || mgtType === 16;
                const param2 = isBASIC ? (f.bodyLength || length) : 0x8000;
                const autostart = isBASIC
                    ? ((f.autostart != null && f.autostart >= 0 && f.autostart < 0x8000) ? f.autostart : 0x8000)
                    : 0;

                // Real +D/G+DOS stores a 9-byte file header at the START of the data for standard
                // BASIC/array/CODE/SCREEN$ files (extractFile strips it on read). Re-add it here so
                // the saved image is readable by real +D and other tools. Other types (snapshots,
                // Opentype, …) carry no data header, so their content is written as-is.
                let payload = raw.subarray(0, length);
                if (hdrTape != null) {
                    const withHdr = new Uint8Array(9 + length);
                    withHdr[0] = hdrTape;
                    withHdr[1] = length & 0xFF; withHdr[2] = (length >> 8) & 0xFF;
                    withHdr[3] = startAddr & 0xFF; withHdr[4] = (startAddr >> 8) & 0xFF;
                    withHdr[5] = param2 & 0xFF; withHdr[6] = (param2 >> 8) & 0xFF;
                    withHdr[7] = autostart & 0xFF; withHdr[8] = (autostart >> 8) & 0xFF;
                    withHdr.set(raw.subarray(0, length), 9);
                    payload = withHdr;
                }
                const sectors = Math.max(1, Math.ceil(payload.length / 510));

                const firstCyl = curCyl, firstSide = curSide, firstSec = curSec;
                const used = [];
                let dataPos = 0;
                for (let s = 0; s < sectors; s++) {
                    const off = ((curCyl * 2 + curSide) * 10 + (curSec - 1)) * 512;
                    used.push({ cyl: curCyl, side: curSide, sector: curSec });
                    img.set(payload.subarray(dataPos, dataPos + 510), off);
                    dataPos += 510;
                    advance();
                    if (s < sectors - 1) {
                        img[off + 510] = (curCyl & 0x7F) | (curSide << 7); // next track (G+DOS encoding)
                        img[off + 511] = curSec;                           // next sector
                    } else {
                        img[off + 510] = 0; img[off + 511] = 0;            // end of chain
                    }
                }

                const dirOff = MGTLoader._slotOffset(slot);
                img[dirOff] = mgtType;
                const name = (f.name || '').toString();
                for (let c = 0; c < 10; c++) img[dirOff + 1 + c] = c < name.length ? (name.charCodeAt(c) & 0xFF) : 0x20;
                img[dirOff + 11] = (sectors >> 8) & 0xFF;   // sector count, big-endian
                img[dirOff + 12] = sectors & 0xFF;
                img[dirOff + 13] = (firstCyl & 0x7F) | (firstSide << 7);
                img[dirOff + 14] = firstSec;
                // best-effort allocation bitmap (informational; reader ignores it)
                for (const u of used) {
                    // Bitmap is indexed in allocation order: side-0 tracks (cyl 4-79) first, then
                    // side-1. bit0 = cyl4 side0 sec1. (76 = data cylinders per side, cyl 4-79.)
                    const ti = (u.side === 0) ? (u.cyl - 4) : (76 + (u.cyl - 4));
                    const bit = ti * 10 + (u.sector - 1);
                    if (bit >= 0 && bit < 1560) img[dirOff + 15 + (bit >> 3)] |= (1 << (bit & 7));
                }
                // G+DOS metadata copy (bytes 211-219)
                img[dirOff + 211] = tapeType;
                img[dirOff + 212] = length & 0xFF;
                img[dirOff + 213] = (length >> 8) & 0xFF;
                img[dirOff + 214] = startAddr & 0xFF;
                img[dirOff + 215] = (startAddr >> 8) & 0xFF;
                img[dirOff + 216] = param2 & 0xFF;
                img[dirOff + 217] = (param2 >> 8) & 0xFF;
                img[dirOff + 218] = autostart & 0xFF;
                img[dirOff + 219] = (autostart >> 8) & 0xFF;
                slot++;
            }
            return img;
        }

        /**
         * Convert MGT file to TAP format for loading
         */
        static fileToTAP(fileData, fileInfo) {
            // Reuse TRDLoader's TAP builder with mapped type info
            const mappedInfo = {
                name: fileInfo.name.substring(0, 10),
                type: fileInfo.type === 1 || fileInfo.type === 16 ? 'basic' :
                      fileInfo.type === 4 || fileInfo.type === 19 ? 'code' :
                      fileInfo.type === 7 || fileInfo.type === 20 ? 'code' :
                      fileInfo.type === 2 || fileInfo.type === 17 ? 'data' :
                      fileInfo.type === 3 || fileInfo.type === 18 ? 'data' : 'code',
                start: fileInfo.startAddress,
                length: fileInfo.length,
                fullName: fileInfo.name
            };
            return TRDLoader.fileToTAP(fileData, mappedInfo);
        }

        /**
         * Get disk statistics (total/used/free sectors)
         */
        static getDiskInfo(data) {
            const bytes = new Uint8Array(data);
            const totalSectors = (bytes.length / 512);
            // Directory occupies tracks 0-1 (both sides) = 4 track-sides × 10 sectors = 40 sectors
            const dirSectors = 40;
            let usedSectors = dirSectors;

            const files = MGTLoader.listFiles(data);
            for (const f of files) {
                usedSectors += f.sectors;
            }

            return {
                totalSectors,
                usedSectors,
                freeSectors: totalSectors - usedSectors,
                fileCount: files.length,
                maxFiles: 80,
                tracks: bytes.length === 819200 ? 80 : 40,
                sides: 2,
                sectorsPerTrack: 10,
                bytesPerSector: 512,
                totalSize: bytes.length
            };
        }
    }

    /**
     * +D WD1772 Floppy Disk Controller
     * DISCiPLE/+D interface: 2 drives, 80 tracks × 2 sides × 10 sectors × 512 bytes
     * Port addresses: 0xE3 (cmd/status), 0xEB (track), 0xF3 (sector),
     *                 0xFB (data), 0xEF (control), 0xE7 (paging)
     */
    export class PlusDDisk {
        constructor() {
            // Per-drive state: each drive has its own disk image and head position
            this.drives = [
                { diskData: null, diskType: null, headTrack: 0 },
                { diskData: null, diskType: null, headTrack: 0 }
            ];

            // WD1772 registers
            this.command = 0;
            this.status = 0;
            this.track = 0;
            this.sector = 1;       // Sectors are 1-based in MGT
            this.data = 0;

            // Disk activity callback: function(type, track, sector, side, drive)
            this.onDiskActivity = null;

            // Page-out callback: called when control register bit 6 set
            this.onPageOut = null;

            // Control register state
            this.drive = 0;        // Current drive (0-1)
            this.side = 0;         // Current side (0-1)

            // Disk geometry (standard MGT)
            this.sectorsPerTrack = 10;
            this.bytesPerSector = 512;
            this.tracks = 80;
            this.sides = 2;

            // Number of the first sector on a track. MGT numbers them from 1;
            // the Opus Discovery numbers them from 0, so OpusDisk sets this to 0
            // and the wrap checks below follow it rather than assuming 1.
            this.firstSector = 1;

            // Data transfer state
            this.dataBuffer = null;
            this.dataPos = 0;
            this.dataLen = 0;
            this.reading = false;
            this.writing = false;

            // Index pulse simulation
            this.indexCounter = 0;

            // Track last command type for status bit interpretation
            // WD1772: after power-on/reset, status register uses Type I format
            this.lastCmdType = 1;

            // Status bits (same as WD1793)
            this.BUSY = 0x01;
            this.INDEX = 0x02;
            this.DRQ = 0x02;
            this.TRACK0 = 0x04;
            this.LOST_DATA = 0x04;
            this.CRC_ERROR = 0x08;
            this.SEEK_ERROR = 0x10;
            this.RNF = 0x10;
            this.HEAD_LOADED = 0x20;
            this.RECORD_TYPE = 0x20;
            this.WRITE_PROTECT = 0x40;
            this.NOT_READY = 0x80;

            this.intrq = false;
            this.multiSector = false;
            this._sysReadsSinceData = 0;
        }

        // Load disk image into specified drive
        loadDisk(data, type, driveIndex = 0) {
            const drv = this.drives[driveIndex & 0x01];
            drv.diskData = new Uint8Array(data);
            drv.diskType = type || 'mgt';
            drv.headTrack = 0;
            if ((driveIndex & 0x01) === this.drive) {
                this.status = 0;
                this.track = 0;
                this.sector = this.firstSector;
            }
        }

        get currentDisk() {
            return this.drives[this.drive];
        }

        // Create and insert a blank MGT disk
        createBlankDisk(label = 'BLANK', driveIndex = 0) {
            const mgt = new Uint8Array(819200);
            mgt.fill(0);
            // Directory is all zeros = all empty slots (file type 0 = unused)
            // No disk info sector like TRD — directory structure IS the format

            const drv = this.drives[driveIndex & 0x01];
            drv.diskData = mgt;
            drv.diskType = 'mgt';
            drv.headTrack = 0;
            if ((driveIndex & 0x01) === this.drive) {
                this.status = 0;
                this.track = 0;
                this.sector = 1;
            }
            return true;
        }

        ejectDisk(driveIndex) {
            if (driveIndex !== undefined) {
                const drv = this.drives[driveIndex & 0x01];
                drv.diskData = null;
                drv.diskType = null;
                drv.headTrack = 0;
            } else {
                const drv = this.currentDisk;
                drv.diskData = null;
                drv.diskType = null;
                drv.headTrack = 0;
            }
            this.status = this.NOT_READY;
        }

        hasDisk(driveIndex) {
            if (driveIndex !== undefined) {
                return this.drives[driveIndex & 0x01].diskData !== null;
            }
            return this.currentDisk.diskData !== null;
        }

        hasAnyDisk() {
            return this.drives.some(d => d.diskData !== null);
        }

        // Calculate sector offset in disk image from physical cylinder, side, sector.
        // Used by WD1772 emulation (port read/write commands) where track = cylinder
        // and side comes from the control register.
        // MGT image layout: cyl0/s0, cyl0/s1, cyl1/s0, cyl1/s1, ...
        getSectorOffset(track, side, sector) {
            return ((track * this.sides + side) * this.sectorsPerTrack
                    + (sector - this.firstSector)) * this.bytesPerSector;
        }

        // One past the last sector number on a track — the multi-sector wrap point.
        get lastSectorPlusOne() {
            return this.firstSector + this.sectorsPerTrack;
        }

        // WD177x register read by register number: 0 = status, 1 = track,
        // 2 = sector, 3 = data. The +D decodes these from I/O ports and the Opus
        // Discovery from memory addresses, so the register behaviour lives here
        // and each interface only supplies the decode.
        readRegister(reg) {
            switch (reg & 0x03) {
                case 0: // Status register
                    if (!this.currentDisk.diskData) {
                        return this.NOT_READY;
                    }
                    {
                        let st = this.status;
                        if (this.reading && this.dataPos < this.dataLen) {
                            st |= this.DRQ;
                        }
                        if (this.lastCmdType === 1 && this.track === 0) {
                            st |= this.TRACK0;
                        }
                        if (this.lastCmdType === 1) {
                            this.indexCounter = (this.indexCounter + 1) % 16;
                            if (this.indexCounter === 0) {
                                st |= this.INDEX;
                            }
                        }
                        return st;
                    }

                case 1: // Track register
                    return this.track;

                case 2: // Sector register
                    return this.sector;

                case 3: // Data register
                    if (this.reading && this.dataBuffer && this.dataPos < this.dataLen) {
                        this._sysReadsSinceData = 0;
                        this.data = this.dataBuffer[this.dataPos++];
                        if (this.dataPos >= this.dataLen) {
                            if (this.multiSector) {
                                this.sector++;
                                if (this.sector >= this.lastSectorPlusOne) {
                                    this.reading = false;
                                    this.multiSector = false;
                                    this.status &= ~(this.BUSY | this.DRQ);
                                    this.intrq = true;
                                } else {
                                    this.readSector();
                                }
                            } else {
                                this.reading = false;
                                this.status &= ~(this.BUSY | this.DRQ);
                                this.intrq = true;
                            }
                        }
                    }
                    return this.data;
            }
            return 0xFF;
        }

        // Port read (port mapping per FUSE plusd.c)
        read(port) {
            const reg = port & 0xFF;

            switch (reg) {
                case 0xE3: return this.readRegister(0);  // Status
                case 0xEB: return this.readRegister(1);  // Track
                case 0xF3: return this.readRegister(2);  // Sector
                case 0xFB: return this.readRegister(3);  // Data

                case 0xEF: // Control register read: INTRQ/DRQ status
                    {
                        let ctrl = 0;
                        if (this.intrq) ctrl |= 0x80;
                        if (this.reading || this.writing) ctrl |= 0x40;
                        // Lost data simulation (same as BetaDisk system register)
                        if (this.reading && this.dataBuffer && this.dataPos < this.dataLen) {
                            this._sysReadsSinceData = (this._sysReadsSinceData || 0) + 1;
                            if (this._sysReadsSinceData >= 2) {
                                this.dataPos = this.dataLen;
                                this.status |= this.LOST_DATA;
                                if (this.multiSector) {
                                    this.sector++;
                                    if (this.sector >= this.lastSectorPlusOne) {
                                        this.reading = false;
                                        this.multiSector = false;
                                        this.status &= ~(this.BUSY | this.DRQ);
                                        this.intrq = true;
                                    } else {
                                        this.readSector();
                                    }
                                } else {
                                    this.reading = false;
                                    this.status &= ~(this.BUSY | this.DRQ);
                                    this.intrq = true;
                                }
                            }
                        }
                        return ctrl;
                    }

                default:
                    return 0xFF;
            }
        }

        // WD177x register write by register number — see readRegister.
        writeRegister(reg, value) {
            switch (reg & 0x03) {
                case 0: // Command register
                    this.executeCommand(value);
                    break;

                case 1: // Track register
                    this.track = value;
                    break;

                case 2: // Sector register
                    this.sector = value;
                    break;

                case 3: // Data register
                    this.data = value;
                    if (this.writing && this.dataBuffer && this.dataPos < this.dataLen) {
                        this.dataBuffer[this.dataPos++] = value;
                        if (this.dataPos >= this.dataLen) {
                            this.flushWriteBuffer();
                            // DRQ has to drop with BUSY at the end of a write, the
                            // way the read paths already do it. Leaving it asserted
                            // tells a polling ROM the chip still wants another byte
                            // for a command that has finished — MDOS reads that as
                            // an internal error and abandons the save after writing
                            // only its directory entry.
                            if (this.multiSector) {
                                this.sector++;
                                if (this.sector >= this.lastSectorPlusOne) {
                                    this.writing = false;
                                    this.multiSector = false;
                                    this.status &= ~(this.BUSY | this.DRQ);
                                    this.intrq = true;
                                } else {
                                    this.writeSector();
                                }
                            } else {
                                this.writing = false;
                                this.status &= ~(this.BUSY | this.DRQ);
                                this.intrq = true;
                            }
                        }
                    }
                    break;
            }
        }

        // Port write (port mapping per FUSE plusd.c)
        write(port, value) {
            const reg = port & 0xFF;

            switch (reg) {
                case 0xE3: this.writeRegister(0, value); break;  // Command
                case 0xEB: this.writeRegister(1, value); break;  // Track
                case 0xF3: this.writeRegister(2, value); break;  // Sector
                case 0xFB: this.writeRegister(3, value); break;  // Data

                case 0xEF: // Control register (per FUSE: bits 0-1=drive, bit 7=side, bit 6=printer)
                    this.drive = (value & 0x03) === 2 ? 1 : 0;  // Drive select (FUSE convention)
                    this.side = (value & 0x80) ? 1 : 0;  // Bit 7: side select
                    break;
            }
        }

        reset() {
            this.command = 0;
            this.status = 0;
            this.track = 0;
            this.sector = this.firstSector;
            this.reading = false;
            this.writing = false;
            this.dataBuffer = null;
            this.intrq = false;
            this._sysReadsSinceData = 0;
        }

        executeCommand(cmd) {
            this.command = cmd;
            this.status = 0;
            this.intrq = false;
            this._sysReadsSinceData = 0;

            if (!this.currentDisk.diskData) {
                this.status = this.NOT_READY;
                this.intrq = true;
                return;
            }

            // Type I commands (restore, seek, step)
            if ((cmd & 0x80) === 0) {
                this.lastCmdType = 1;
                this.status |= this.BUSY;

                if ((cmd & 0xF0) === 0x00) {
                    // Restore
                    this.track = 0;
                    this.currentDisk.headTrack = 0;
                    this.status |= this.TRACK0;
                } else if ((cmd & 0xF0) === 0x10) {
                    // Seek
                    this.track = this.data;
                    this.currentDisk.headTrack = this.data;
                    if (this.track === 0) this.status |= this.TRACK0;
                } else if ((cmd & 0xE0) === 0x40) {
                    // Step in — logical tracks 0-159 (80 cylinders × 2 sides)
                    if (this.track < 159) this.track++;
                    this.currentDisk.headTrack = this.track;
                } else if ((cmd & 0xE0) === 0x60) {
                    // Step out
                    if (this.track > 0) this.track--;
                    this.currentDisk.headTrack = this.track;
                    if (this.track === 0) this.status |= this.TRACK0;
                }

                this.status &= ~this.BUSY;
                this.status |= this.HEAD_LOADED;
                this.intrq = true;
                return;
            }

            // Type II commands (read/write sector)
            if ((cmd & 0xC0) === 0x80) {
                this.lastCmdType = 2;
                this.multiSector = !!(cmd & 0x10);
                this.status = this.BUSY;

                if ((cmd & 0x20) === 0) {
                    this.readSector();
                } else {
                    this.writeSector();
                }
                return;
            }

            // Type IV command (force interrupt)
            // WD1772: "rest of Status Register is updated according to Type I commands"
            if ((cmd & 0xF0) === 0xD0) {
                this.lastCmdType = 1;  // Status uses Type I format after Force Interrupt
                this.reading = false;
                this.writing = false;
                this.multiSector = false;
                this.status &= ~this.BUSY;
                this.status |= this.HEAD_LOADED;
                if (this.track === 0) this.status |= this.TRACK0;
                if (cmd & 0x08) this.intrq = true;
                return;
            }

            // Type III commands (read/write track, read address)
            if ((cmd & 0xC0) === 0xC0) {
                this.lastCmdType = 2;
                if ((cmd & 0xF0) === 0xC0) {
                    // Read address
                    this.dataBuffer = new Uint8Array([
                        this.currentDisk.headTrack, this.side, this.sector, 2, 0, 0
                    ]);  // size=2 for 512-byte sectors
                    this.dataPos = 0;
                    this.dataLen = 6;
                    this.reading = true;
                    this.status |= this.BUSY | this.DRQ;
                } else if ((cmd & 0xF0) === 0xE0) {
                    // Read Track — not implemented
                    this.status = 0;
                    this.intrq = true;
                } else if ((cmd & 0xF0) === 0xF0) {
                    // Write Track — not implemented
                    this.status = 0;
                    this.intrq = true;
                }
                return;
            }
        }

        readSector() {
            const drv = this.currentDisk;
            const offset = this.getSectorOffset(this.track, this.side, this.sector);

            if (this.onDiskActivity) {
                this.onDiskActivity('read', this.track, this.sector, this.side, this.drive);
            }

            if (offset + this.bytesPerSector > drv.diskData.length) {
                this.status |= this.RNF;
                this.status &= ~this.BUSY;
                this.intrq = true;
                return;
            }

            this.dataBuffer = drv.diskData.slice(offset, offset + this.bytesPerSector);
            this.dataPos = 0;
            this.dataLen = this.bytesPerSector;
            this.reading = true;
            this.status |= this.DRQ | this.BUSY;
        }

        writeSector() {
            const drv = this.currentDisk;
            const offset = this.getSectorOffset(this.track, this.side, this.sector);

            if (this.onDiskActivity) {
                this.onDiskActivity('write', this.track, this.sector, this.side, this.drive);
            }

            if (offset + this.bytesPerSector > drv.diskData.length) {
                this.status |= this.RNF;
                this.status &= ~this.BUSY;
                this.intrq = true;
                return;
            }

            this.writeOffset = offset;
            this.dataBuffer = new Uint8Array(this.bytesPerSector);
            this.dataPos = 0;
            this.dataLen = this.bytesPerSector;
            this.writing = true;
            this.status |= this.DRQ;
        }

        flushWriteBuffer() {
            if (this.writeOffset !== undefined && this.dataBuffer) {
                this.currentDisk.diskData.set(this.dataBuffer, this.writeOffset);
            }
        }

        getIntrq() {
            return this.intrq;
        }
    }

    /**
     * MDR Loader - Interface 1 Microdrive cartridge format
     * 254 sectors × 543 bytes + 1 write-protect flag = 137923 bytes
     */
