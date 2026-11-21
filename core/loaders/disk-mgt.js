/**
 * ZX-M8XXX - DISCiPLE/+D (MGT): image reader and WD1772 controller
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

import { TRDLoader } from './disk-beta.js';
import { TRACK_BYTES_MFM, parseTrackStream, buildTrackStream } from './mfm-track.js';
import { createRotationClock } from './disk-rotation.js';

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
        // How many times the host may look at the controller after opening a
        // Write Track, without having written a single byte to it, before the
        // track is counted as lost. See _formatPoll().
        static get FORMAT_POLL_LIMIT() { return 4096; }

        constructor() {
            // Per-drive state: each drive has its own disk image and head position
            // `headTrack` is where the head PHYSICALLY is; the track register is
            // only what the controller has been told. They are not the same
            // thing and a DOS may hold them apart on purpose — see _step().
            // `driveTracks` is how many cylinders the MECHANISM has, which no
            // disk image records; 160 keeps the +D's historical step limit.
            this.drives = [
                { diskData: null, diskType: null, headTrack: 0, addrIndex: 0, driveTracks: 160 },
                { diskData: null, diskType: null, headTrack: 0, addrIndex: 0, driveTracks: 160 }
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
            // A Write Track in progress. It is not just `writing`: the stream is
            // a whole track rather than one sector, so the end of the buffer
            // means "format finished", not "step to the next sector".
            this.formatting = false;
            // The earliest a DRQ for this transfer may be delivered, or 0 for
            // "no floor". A Write Track waits for the index pulse before it
            // writes anything, so the byte stream must not start before then
            // either; `Spectrum._drqDueAt` reads this. A controller with no
            // machine around it has no DRQ pacing and simply ignores it.
            this.drqNotBefore = 0;
            // What the last Write Track laid down — see finishWriteTrack().
            this.lastFormat = null;

            // Which way the last step went, for the bare Step command
            this.stepDir = 1;

            // Index pulse. The real one when a rotation clock has been given
            // (see setRotationClock); otherwise faked, one read in sixteen.
            this.rotation = null;
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

        /**
         * Give the controller the disk's own clock: a monotonic T-state count
         * and the length of one revolution, both read live so that a machine
         * change is picked up. Nothing in a controller can know what machine it
         * is in, so this is injected — `Spectrum` does it once per interface,
         * and the Opus and the Didaktik inherit it from here.
         *
         * Without it the controller keeps its untimed behaviour: a faked index
         * pulse, Read Address in round robin, and a Write Track ended by
         * counting register reads. That is the state every unit test which
         * constructs a bare controller runs in, and it stays supported on
         * purpose — a controller with no machine around it has no business
         * inventing a rotation it cannot see.
         */
        setRotationClock(nowFn, revFn) {
            this.rotation = createRotationClock(nowFn, revFn);
        }

        // Load disk image into specified drive
        loadDisk(data, type, driveIndex = 0) {
            const drv = this.drives[driveIndex & 0x01];
            drv.diskData = new Uint8Array(data);
            drv.diskType = type || 'mgt';
            drv.headTrack = 0;
            drv.addrIndex = 0;
            drv.addrSlot = -1;
            drv.modified = false;
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
            drv.addrIndex = 0;
            drv.addrSlot = -1;
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

        /**
         * One step of the mechanism is not always one track of the medium. A
         * 40-track disk written in an 80-track drive occupies every OTHER
         * cylinder, so a DOS that knows it has such a drive double-steps: its
         * track 1 is physical cylinder 2. Nothing in a raw sector dump says
         * which drive the disk is sitting in, so the drive's track count is
         * configuration, not something to detect.
         *
         * 1 everywhere except an Opus with an 80-track drive and a 40-track
         * disk; the +D and Didaktik keep the straight mapping they have always
         * had.
         */
        get stepFactor() { return 1; }

        /**
         * Which of the DISK's tracks is under the head — what the ID fields
         * written there say, and what a sector read must index by. A head parked
         * between two tracks of a double-stepped disk is over no ID field at
         * all, hence -1.
         */
        get mediumTrack() {
            const f = this.stepFactor;
            const physical = this.currentDisk.headTrack | 0;
            return (physical % f) === 0 ? (physical / f) : -1;
        }

        // The highest cylinder this drive's head can reach.
        get headLimit() {
            return Math.max(0, (this.currentDisk.driveTracks || 160) - 1);
        }

        // One step of the head. The U bit (bit 4) decides whether the TRACK
        // REGISTER follows: a Step without it moves the head and leaves the
        // register alone, which is exactly how a DOS double-steps — two steps
        // per track, the register counting tracks and the head counting
        // cylinders. Treating the register as the head position meant no DOS
        // could do that, and EXCOM 2.28 then stepped its way off the end of the
        // disk looking for track 158.
        _step(dir, cmd) {
            const drv = this.currentDisk;
            drv.headTrack = Math.max(0, Math.min(this.headLimit, (drv.headTrack | 0) + dir));
            if (cmd & 0x10) this.track = Math.max(0, Math.min(255, this.track + dir));
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

        // The size code a WD177x puts in an ID field for this geometry. 256-byte
        // sectors (Opus) are 1 and 512-byte ones (MGT) are 2, so a controller
        // that reported a fixed 2 told an Opus program its sectors were twice
        // the size they are.
        get sizeCode() {
            switch (this.bytesPerSector) {
                case 128: return 0;
                case 256: return 1;
                case 1024: return 3;
                default: return 2;
            }
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
                        this._formatPoll();
                        let st = this.status;
                        // Not ready for the next byte yet: the medium gives one
                        // 111.8 T-states and a polling host is faster than that.
                        if (this.formatting && this.rotation &&
                            this.rotation.now() < this._fmtByteDue) {
                            st &= ~this.DRQ;
                        }
                        if (this.reading && this.dataPos < this.dataLen) {
                            st |= this.DRQ;
                        }
                        if (this.lastCmdType === 1 &&
                            (this.currentDisk.headTrack | 0) === 0) {
                            st |= this.TRACK0;
                        }
                        // The real pulse with a rotation clock — 1.5 ms of each
                        // 200 ms revolution — and the old one-in-sixteen fake
                        // without one.
                        if (this.lastCmdType === 1) {
                            if (this.rotation) {
                                if (this.rotation.indexActive()) st |= this.INDEX;
                            } else {
                                this.indexCounter = (this.indexCounter + 1) % 16;
                                if (this.indexCounter === 0) {
                                    st |= this.INDEX;
                                }
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
                        this._formatPoll();
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
                        this._fmtPolls = 0;
                        if (this.formatting && this.rotation) {
                            this._fmtLastByte = this.rotation.now();
                            this._fmtByteDue = ++this._fmtBytesIn === 1
                                ? this._fmtStart
                                : this._fmtByteDue + this.rotation.byteTime();
                        }
                        if (this.dataPos >= this.dataLen) {
                            // A format fills a whole track, not a sector, and
                            // there is no next sector to step to afterwards.
                            if (this.formatting) { this.finishWriteTrack(); break; }
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
            this.formatting = false;
            this.drqNotBefore = 0;
            this.dataBuffer = null;
            this.intrq = false;
            this._sysReadsSinceData = 0;
        }

        executeCommand(cmd) {
            // A Write Track ends at the index pulse, 200 ms after it started —
            // the chip does not wait around for a host that stopped feeding it.
            // Nothing here models rotation, so the next command IS that
            // deadline: whatever was streamed is committed and the format is
            // over. Without this a ROM that issues Write Track and then changes
            // its mind leaves the controller waiting for 6250 bytes that never
            // come, with `writing` set, and every later transfer goes wrong.
            if (this.formatting) this.finishWriteTrack();
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
                    // Restore: step out to the stop. Both the head and the
                    // register end at zero, which is the one case where the
                    // controller knows where the head really is.
                    this.track = 0;
                    this.currentDisk.headTrack = 0;
                } else if ((cmd & 0xF0) === 0x10) {
                    // Seek: the data register holds the wanted track. A seek is
                    // a COUNT OF STEPS — the head moves by the difference
                    // between the register and the data, not to the data — so a
                    // DOS holding the two apart keeps the offset it chose.
                    const delta = (this.data & 0xFF) - (this.track & 0xFF);
                    const drv = this.currentDisk;
                    drv.headTrack = Math.max(0, Math.min(this.headLimit,
                                                         (drv.headTrack | 0) + delta));
                    this.track = this.data & 0xFF;
                } else if ((cmd & 0xE0) === 0x40) {
                    this.stepDir = 1;
                    this._step(1, cmd);          // step in
                } else if ((cmd & 0xE0) === 0x60) {
                    this.stepDir = -1;
                    this._step(-1, cmd);         // step out
                } else if ((cmd & 0xE0) === 0x20) {
                    this._step(this.stepDir, cmd);  // step, whichever way last time
                }

                // TRACK0 is a line from the drive: it says where the HEAD is,
                // not what the register holds.
                if ((this.currentDisk.headTrack | 0) === 0) this.status |= this.TRACK0;

                // The V bit: verify that the head really is over the track the
                // register names, by reading an ID field and comparing. It is
                // how a DOS finds out what it is dealing with — EXCOM 2.28 steps
                // in once more with V set and takes a Seek Error to mean the
                // drive is not the 80-track one it assumes.
                if (cmd & 0x04) {
                    const mt = this.mediumTrack;
                    if (mt < 0 || (this.track & 0xFF) !== mt) this.status |= this.SEEK_ERROR;
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
                // A formatter that stops short does so with a Force Interrupt —
                // the index pulse is what ends a Write Track on real hardware and
                // a ROM counting bytes will not reach 6250 of them. The track it
                // did write is still a formatted track, so commit before the
                // command state is torn down.
                if (this.formatting) this.finishWriteTrack();
                this.reading = false;
                this.writing = false;
                this.multiSector = false;
                this.status &= ~this.BUSY;
                this.status |= this.HEAD_LOADED;
                if ((this.currentDisk.headTrack | 0) === 0) this.status |= this.TRACK0;
                if (cmd & 0x08) this.intrq = true;
                return;
            }

            // Type III commands (read/write track, read address)
            if ((cmd & 0xC0) === 0xC0) {
                this.lastCmdType = 2;
                if ((cmd & 0xF0) === 0xC0) {
                    // READ ADDRESS: the ID field of the next sector to come
                    // under the head. These images are raw sector dumps with no
                    // ID fields in them, so the ID is synthesized — but from the
                    // GEOMETRY and advancing one sector per command, which is
                    // what lets a program walk a track (its sector numbering,
                    // its interleave, the size code). Handing back the sector
                    // register instead, as this did, told the program only what
                    // it had just written there, and always claimed 512-byte
                    // sectors.
                    const drv = this.currentDisk;
                    const n = this.sectorsPerTrack;
                    // Which ID to report. **Reading one costs the time to reach
                    // it**: the command waits for the next ID field to come round,
                    // so on real hardware two Read Addresses in a row report
                    // consecutive sectors rather than the same one twice. Commands
                    // here complete instantly, so the head is kept MONOTONE
                    // instead, in absolute slots rather than modulo a revolution:
                    // a command takes the next slot after the one it last
                    // reported, or wherever the disk has since turned to,
                    // whichever is further on. Never one the disk has passed.
                    // With no clock it is plain round robin, so a loader can still
                    // walk a track.
                    let idx;
                    if (this.rotation) {
                        const abs = Math.max(this.rotation.absoluteSlot(n),
                                             (drv.addrSlot ?? -1) + 1);
                        drv.addrSlot = abs;
                        idx = ((abs % n) + n) % n;
                    } else {
                        idx = (((drv.addrIndex || 0) % n) + n) % n;
                    }
                    drv.addrIndex = (idx + 1) % n;
                    // The ID says which of the DISK's tracks the head is over,
                    // not what the track register was last loaded with — a ROM
                    // writes that register freely ($FF before a Restore, for
                    // one). Parked between two tracks of a double-stepped disk
                    // there is no ID field to read, and the chip says so.
                    const idTrack = this.mediumTrack;
                    if (idTrack < 0) {
                        this.status = this.RNF;
                        this.intrq = true;
                        return;
                    }
                    this.dataBuffer = new Uint8Array([
                        idTrack, this.side, this.firstSector + idx, this.sizeCode, 0, 0
                    ]);
                    // The datasheet is explicit: the ID's track address is also
                    // loaded into the SECTOR register. A double-stepping ROM
                    // reads the logical track number back out of it.
                    this.sector = idTrack;
                    this.dataPos = 0;
                    this.dataLen = 6;
                    this.reading = true;
                    this.status |= this.BUSY | this.DRQ;
                } else if ((cmd & 0xF0) === 0xE0) {
                    this.readTrack();
                } else if ((cmd & 0xF0) === 0xF0) {
                    this.writeTrack();
                }
                return;
            }
        }

        /**
         * The ID field under the head, or -1 if it is not the one asked for.
         * A WD177x does not take the track register as an address: it reads the
         * ID fields going past and compares. A head left on the wrong cylinder
         * — or between two of them — finds nothing and the command fails with
         * Record Not Found, instead of quietly returning another track's data.
         */
        _idTrackForTransfer() {
            const mt = this.mediumTrack;
            if (mt < 0 || (this.track & 0xFF) !== mt) return -1;
            return mt;
        }

        readSector() {
            const drv = this.currentDisk;
            const mt = this._idTrackForTransfer();
            if (mt < 0) {
                this.status |= this.RNF;
                this.status &= ~this.BUSY;
                this.intrq = true;
                return;
            }
            const offset = this.getSectorOffset(mt, this.side, this.sector);

            if (this.onDiskActivity) {
                this.onDiskActivity('read', mt, this.sector, this.side, this.drive);
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
            const mt = this._idTrackForTransfer();
            if (mt < 0) {
                this.status |= this.RNF;
                this.status &= ~this.BUSY;
                this.intrq = true;
                return;
            }
            const offset = this.getSectorOffset(mt, this.side, this.sector);

            if (this.onDiskActivity) {
                this.onDiskActivity('write', mt, this.sector, this.side, this.drive);
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
                // Opus and Didaktik inherit this, so all three are covered here.
                this.currentDisk.modified = true;
            }
        }

        /**
         * READ TRACK: every byte between one index pulse and the next — gaps,
         * sync fields, address marks, IDs, data, CRCs.
         *
         * A raw sector dump has none of that in it, so the track is built from
         * the geometry and the sectors' contents: real `A1` marks and real CRCs,
         * because this reads the medium rather than instructing the chip. Two
         * things it cannot know and does not pretend to — the interleave (an
         * image like this records the sectors in ascending order, so that is the
         * order they are reported in) and the real gap lengths, which get the
         * IBM System 34 defaults.
         */
        readTrack() {
            const drv = this.currentDisk;
            if (!drv.diskData) {
                this.status = this.NOT_READY;
                this.intrq = true;
                return;
            }
            const mt = this.mediumTrack;
            if (mt < 0) {
                // Parked between two tracks of a double-stepped disk: there is
                // nothing under the head to read.
                this.status = this.RNF;
                this.intrq = true;
                return;
            }

            const sectors = [];
            for (let i = 0; i < this.sectorsPerTrack; i++) {
                const id = this.firstSector + i;
                const off = this.getSectorOffset(mt, this.side, id);
                if (off < 0 || off + this.bytesPerSector > drv.diskData.length) break;
                sectors.push({
                    cylinder: mt, head: this.side, sector: id,
                    sizeCode: this.sizeCode,
                    data: drv.diskData.subarray(off, off + this.bytesPerSector),
                });
            }
            if (!sectors.length) {
                this.status = this.RNF;
                this.intrq = true;
                return;
            }

            if (this.onDiskActivity) {
                this.onDiskActivity('read', mt, -1, this.side, this.drive);
            }

            this.dataBuffer = buildTrackStream({
                cylinder: mt, head: this.side, sectors, marks: 'medium',
            });
            this.dataPos = 0;
            this.dataLen = this.dataBuffer.length;
            this.reading = true;
            this.status |= this.BUSY | this.DRQ;
        }

        /**
         * WRITE TRACK: the format command, and the only way a disk is made.
         *
         * There is no "format a sector": the host streams a whole track at the
         * chip and the chip writes it between index pulses. So this takes the
         * stream — up to a track's worth of bytes — and `finishWriteTrack` works
         * out what was laid down. Without it an interface can edit a disk
         * somebody else made but cannot make one.
         */
        writeTrack() {
            const drv = this.currentDisk;
            if (!drv.diskData) {
                this.status = this.NOT_READY;
                this.intrq = true;
                return;
            }
            this.dataBuffer = new Uint8Array(TRACK_BYTES_MFM);
            this.dataPos = 0;
            this.dataLen = this.dataBuffer.length;
            this.writing = true;
            this.formatting = true;
            this._fmtPolls = 0;
            // A Write Track does not begin where the command was issued. The chip
            // asserts DRQ at once so the host can have its first byte ready, then
            // WAITS FOR THE INDEX PULSE and writes from there to the next one -- so
            // the command spans between one and two revolutions, and the write
            // itself spans exactly one. `_fmtStart` is that index, not now:
            // `lastFormat.revolutions` is the write, and `indexWait` the wait
            // before it. `drqNotBefore` holds the byte stream back to the same
            // instant for the interfaces whose DRQ Spectrum paces.
            this._fmtCommand = this.rotation ? this.rotation.now() : 0;
            // If the pulse is under the sensor right now there is nothing to wait
            // for -- the chip begins on the index, and it is on it.
            this._fmtStart = this.rotation
                ? (this.rotation.indexActive()
                    ? this.rotation.now() : this.rotation.nextIndex())
                : 0;
            this._fmtLastByte = this._fmtStart;
            this.drqNotBefore = this._fmtStart;
            // The polled interfaces have no Spectrum pacing their DRQ, so the
            // chip does it here: DRQ is cleared until the next byte is due.
            // Byte 1 is due at once -- it goes into the register while the chip
            // waits -- and byte 2 is due AT the index, where writing starts.
            this._fmtBytesIn = 0;
            this._fmtByteDue = 0;
            this.writeOffset = undefined;   // nothing for flushWriteBuffer to do
            this.status |= this.BUSY | this.DRQ;
        }

        /**
         * A Write Track ends at the index pulse — one revolution after it began,
         * whatever the host is doing. A host that opens a track and then waits
         * for an INTRQ without feeding anything is relying on exactly that; with
         * no pulse to end it the controller stays stuck in `writing`.
         *
         * With a rotation clock the deadline is the real one: a revolution of
         * silence, measured from the **last byte** rather than from the command.
         * A feed still arriving has not missed its index — the medium under the
         * head is being written, and the track ends when the buffer fills. No ROM
         * mid-format pauses for anything near a revolution (the slowest here goes
         * ~130 T between bytes, against 698880 for a revolution), so a real
         * format cannot be cut short, while one abandoned half way is closed and
         * what arrived is committed.
         *
         * Without a clock, the old stand-in: register reads counted, and only in
         * the case that cannot come good — a track opened and **not fed at all**.
         * The gate on `dataPos` is what makes that safe. MDOS polls the status a
         * long time before its first byte, and an earlier version that counted
         * between bytes aborted its format at track 2.
         *
         * Lost data is the honest status either way: the index came round before
         * the host had finished. The read paths end a stalled transfer the same
         * way.
         */
        _formatPoll() {
            if (!this.formatting) return;
            if (this.rotation) {
                if (this.rotation.revolutionsSince(this._fmtLastByte) < 1) return;
            } else {
                if (this.dataPos > 0) return;
                if (++this._fmtPolls < PlusDDisk.FORMAT_POLL_LIMIT) return;
            }
            this.finishWriteTrack();
            this.status |= this.LOST_DATA;
        }

        /**
         * The stream is over — either the track filled or a Force Interrupt cut
         * it short. Whatever sectors it laid down go into the image.
         *
         * Which track they go to is where the HEAD is, not what the ID fields in
         * the stream say. Write Track compares nothing: it writes where the head
         * is standing, and the cylinder byte in each ID is simply more data. On a
         * real disk the two can disagree — that is half of how copy protection
         * works — but a flat sector dump has nowhere to put a track whose IDs
         * claim to be somewhere else, so one that does is counted as skipped
         * rather than quietly filed under the number it claims.
         */
        finishWriteTrack() {
            const drv = this.currentDisk;
            const stream = this.dataBuffer
                ? this.dataBuffer.subarray(0, this.dataPos) : new Uint8Array(0);
            const { sectors } = parseTrackStream(stream);

            this.writing = false;
            this.formatting = false;
            this.drqNotBefore = 0;
            this.status &= ~(this.BUSY | this.DRQ);
            this.intrq = true;

            const mt = this.mediumTrack;
            let written = 0, skipped = 0;

            if (mt < 0 || !drv.diskData) {
                skipped = sectors.length;
            } else {
                for (const s of sectors) {
                    const idx = s.sector - this.firstSector;
                    if (s.sizeCode !== this.sizeCode ||
                        idx < 0 || idx >= this.sectorsPerTrack ||
                        s.cylinder !== mt) { skipped++; continue; }
                    const off = this.getSectorOffset(mt, this.side, s.sector);
                    if (off < 0 || off + this.bytesPerSector > drv.diskData.length) {
                        skipped++;
                        continue;
                    }
                    drv.diskData.set(s.data.subarray(0, this.bytesPerSector), off);
                    written++;
                }
                if (written) drv.modified = true;
            }

            // What a format did is worth being able to ask about: a DOS that
            // reports "disk error" after formatting has usually written a
            // geometry the image cannot hold, and the counts say so at once.
            this.lastFormat = {
                track: mt, side: this.side, drive: this.drive,
                found: sectors.length, written, skipped,
                // How long the host took, in revolutions. A real chip gives it
                // exactly one, so anything over 1.0 is a host whose feed loop is
                // slower than the medium — worth being able to ask about.
                // Zero rather than a negative figure if the command was cut
                // short before the index: the write window never opened, so the
                // write took no time at all. This cannot hide the bug a negative
                // once reported -- a feed that beat the medium and filled the
                // track before the window opened -- because the byte stream is
                // now held to the index and cannot start before it.
                revolutions: this.rotation
                    ? Math.max(0, (this.rotation.now() - this._fmtStart) /
                                  this.rotation.revolution())
                    : null,
                // And how much of a revolution the chip spent waiting for the
                // index before any of it: 0 to 1, wherever the command landed.
                indexWait: this.rotation
                    ? (this._fmtStart - this._fmtCommand) / this.rotation.revolution()
                    : null,
            };

            if (written && this.onDiskActivity) {
                this.onDiskActivity('write', mt, -1, this.side, this.drive);
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
