/**
 * ZX-M8XXX - µPD765 Floppy Disk Controller + DSK Format Support
 * @version 0.1.0
 * @license GPL-3.0
 *
 * Emulates the µPD765A FDC used in the ZX Spectrum +3.
 * Instant-completion model (no timing simulation), same approach as BetaDisk (WD1793).
 *
 * DSK format loader/image classes for standard and extended CPC DSK files.
 */

// ========== DSKImage ==========
// In-memory representation of a parsed DSK disk image

export class DSKImage {
    constructor() {
        this.tracks = [];       // Array of track objects (indexed as cylinder * numSides + side)
        this.numTracks = 0;
        this.numSides = 0;
        this.isExtended = false;
    }

    /**
     * Get a track object by cylinder and head
     * @param {number} cylinder - Track number (0-based)
     * @param {number} head - Side number (0 or 1)
     * @returns {object|null} Track object with sectors array, or null
     */
    getTrack(cylinder, head) {
        const idx = cylinder * this.numSides + head;
        return this.tracks[idx] || null;
    }

    /**
     * Read a sector by C/H/R addressing
     * @param {number} cylinder - Track number
     * @param {number} head - Side number
     * @param {number} sectorId - Sector ID (R value, e.g. 0xC1)
     * @returns {Uint8Array|null} Sector data or null if not found
     */
    readSector(cylinder, head, sectorId) {
        const track = this.getTrack(cylinder, head);
        if (!track) return null;
        for (const sector of track.sectors) {
            if (sector.id === sectorId) {
                return sector.data;
            }
        }
        return null;
    }

    /**
     * Write data to a sector by C/H/R addressing
     * @param {number} cylinder - Track number
     * @param {number} head - Side number
     * @param {number} sectorId - Sector ID (R value)
     * @param {Uint8Array} data - Data to write
     * @returns {boolean} true if sector found and written
     */
    writeSector(cylinder, head, sectorId, data) {
        const track = this.getTrack(cylinder, head);
        if (!track) return false;
        for (const sector of track.sectors) {
            if (sector.id === sectorId) {
                const len = Math.min(data.length, sector.data.length);
                sector.data.set(data.subarray(0, len));
                return true;
            }
        }
        return false;
    }

    /**
     * Get total number of tracks (cylinders * sides)
     */
    getTotalTracks() {
        return this.numTracks * this.numSides;
    }
}

// ========== DSKLoader ==========
// Parses standard and extended CPC DSK format files

export class DSKLoader {
    static STANDARD_SIGNATURE = 'MV - CPC';
    static EXTENDED_SIGNATURE = 'EXTENDED CPC DSK';

    /**
     * Check if data is a DSK file by signature
     * @param {ArrayBuffer|Uint8Array} data
     * @returns {boolean}
     */
    static isDSK(data) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (bytes.length < 0x100) return false;
        const sig = String.fromCharCode(...bytes.slice(0, 8));
        if (sig === DSKLoader.STANDARD_SIGNATURE) return true;
        const extSig = String.fromCharCode(...bytes.slice(0, 16));
        if (extSig === DSKLoader.EXTENDED_SIGNATURE) return true;
        return false;
    }

    /**
     * Parse a DSK file into a DSKImage
     * @param {ArrayBuffer|Uint8Array} data
     * @returns {DSKImage}
     */
    static parse(data) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (bytes.length < 0x100) {
            throw new Error('DSK file too small');
        }

        const sig = String.fromCharCode(...bytes.slice(0, 16));
        const isExtended = sig.startsWith(DSKLoader.EXTENDED_SIGNATURE);

        const image = new DSKImage();
        image.isExtended = isExtended;
        image.numTracks = bytes[0x30];
        image.numSides = bytes[0x31];

        if (image.numTracks === 0 || image.numSides === 0) {
            throw new Error('DSK: invalid track/side count');
        }

        if (isExtended) {
            DSKLoader._parseExtended(bytes, image);
        } else {
            DSKLoader._parseStandard(bytes, image);
        }

        return image;
    }

    /**
     * Parse standard DSK format (fixed track size)
     */
    static _parseStandard(bytes, image) {
        const trackSize = bytes[0x32] | (bytes[0x33] << 8);
        if (trackSize === 0) {
            throw new Error('DSK: zero track size');
        }

        const totalTracks = image.numTracks * image.numSides;
        let offset = 0x100; // Data starts after 256-byte disk header

        for (let t = 0; t < totalTracks; t++) {
            if (offset + trackSize > bytes.length) break;
            image.tracks[t] = DSKLoader._parseTrackInfo(bytes, offset, false);
            offset += trackSize;
        }
    }

    /**
     * Parse extended DSK format (variable track sizes)
     */
    static _parseExtended(bytes, image) {
        const totalTracks = image.numTracks * image.numSides;
        // Per-track size high bytes at offset 0x34
        const trackSizeTable = bytes.slice(0x34, 0x34 + totalTracks);

        let offset = 0x100;

        for (let t = 0; t < totalTracks; t++) {
            const trackSizeHigh = trackSizeTable[t];
            if (trackSizeHigh === 0) {
                // Unformatted track
                image.tracks[t] = { sectors: [] };
                continue;
            }
            const trackSize = trackSizeHigh * 256;
            if (offset + trackSize > bytes.length) break;
            image.tracks[t] = DSKLoader._parseTrackInfo(bytes, offset, true);
            offset += trackSize;
        }
    }

    /**
     * Parse a track info block (256-byte header + sector data)
     * @param {Uint8Array} bytes - Full file data
     * @param {number} offset - Start of track info block
     * @param {boolean} isExtended - Extended DSK format flag
     * @returns {object} Track object with sectors array
     */
    static _parseTrackInfo(bytes, offset, isExtended) {
        // Verify Track-Info signature
        const sig = String.fromCharCode(...bytes.slice(offset, offset + 12));
        if (!sig.startsWith('Track-Info')) {
            return { sectors: [] };
        }

        const sectorCount = bytes[offset + 0x15];
        const sectorSize = 128 << bytes[offset + 0x14]; // Default sector size from N value
        const track = { sectors: [] };

        // Sector info entries start at offset+0x18, 8 bytes each
        let dataOffset = offset + 0x100; // Sector data starts after 256-byte track header

        for (let s = 0; s < sectorCount; s++) {
            const infoBase = offset + 0x18 + (s * 8);
            const cylinder = bytes[infoBase];
            const head = bytes[infoBase + 1];
            const id = bytes[infoBase + 2];       // Sector ID (R)
            const sizeCode = bytes[infoBase + 3]; // N value

            const st1 = bytes[infoBase + 4];
            const st2 = bytes[infoBase + 5];

            // Actual data length
            let actualSize;
            if (isExtended) {
                // Extended format: actual data length stored in sector info
                // When actualLen is 0, fall back to default size from N (size code)
                actualSize = bytes[infoBase + 6] | (bytes[infoBase + 7] << 8);
                if (actualSize === 0) {
                    actualSize = sectorSize;
                }
            } else {
                // Standard format: all sectors same size
                actualSize = sectorSize;
            }

            // Read sector data, handling weak/random sectors (EDSK extension).
            // If actualSize > nominalSize and is an exact multiple, the sector
            // contains multiple copies of the data — bytes that differ between
            // copies are "weak" and should return random values on each read.
            const nominalSize = 128 << sizeCode;
            const rawData = new Uint8Array(actualSize);
            if (dataOffset + actualSize <= bytes.length) {
                rawData.set(bytes.slice(dataOffset, dataOffset + actualSize));
            }

            // Detect weak sectors: multiple copies stored
            let weakMap = null;
            let sectorData;
            if (actualSize > nominalSize && nominalSize > 0 && (actualSize % nominalSize) === 0) {
                // Weak sector: compare copies to find differing byte positions
                const numCopies = actualSize / nominalSize;
                sectorData = rawData.slice(0, nominalSize); // First copy as baseline
                weakMap = new Uint8Array(nominalSize); // 0 = stable, 1 = weak
                for (let i = 0; i < nominalSize; i++) {
                    for (let c = 1; c < numCopies; c++) {
                        if (rawData[i] !== rawData[c * nominalSize + i]) {
                            weakMap[i] = 1;
                            break;
                        }
                    }
                }
                // Check if any bytes are actually weak
                let hasWeak = false;
                for (let i = 0; i < nominalSize; i++) {
                    if (weakMap[i]) { hasWeak = true; break; }
                }
                if (!hasWeak) weakMap = null; // No differences found
            } else {
                sectorData = rawData;
            }

            track.sectors.push({
                cylinder,
                head,
                id,
                sizeCode,
                st1,
                st2,
                data: sectorData,
                weakMap  // null for normal sectors, Uint8Array for weak sectors
            });

            dataOffset += actualSize;
        }

        return track;
    }

    /**
     * Read the +3DOS disk specification from the boot sector (track 0).
     * Returns disk parameters including reserved tracks, block size, etc.
     * @param {DSKImage} dskImage
     * @returns {object} Disk spec with reservedTracks, blockSize, dirBlocks, etc.
     */
    static getDiskSpec(dskImage) {
        const track0 = dskImage.getTrack(0, 0);
        if (!track0 || track0.sectors.length === 0) {
            return { reservedTracks: 0, blockSize: 1024, dirBlocks: 2, valid: false };
        }

        const sorted = [...track0.sectors].sort((a, b) => a.id - b.id);
        const bootData = sorted[0].data;

        // +3DOS disk specification block (16 bytes at start of boot sector):
        // Byte 0: Disk type (0=PCW SS SD, 1=CPC system, 2=CPC data, 3=PCW/+3)
        // Byte 1: Sides - 1 (0=single, 1=double)
        // Byte 2: Tracks per side
        // Byte 3: Sectors per track
        // Byte 4: First sector number
        // Byte 5: Sector size log2 (2=512)
        // Byte 6: Reserved tracks
        // Byte 7: Block shift (BSH: 3=1K, 4=2K, 5=4K)
        // Byte 8: Directory blocks (allocation units)
        // Byte 9: R/W gap length
        // Byte 10: Format gap length
        // Bytes 11-14: Reserved (0)
        // Byte 15: Checksum (bytes 0-15 sum to 0 mod 256)
        if (bootData && bootData.length >= 16) {
            let checksum = 0;
            for (let i = 0; i < 16; i++) checksum = (checksum + bootData[i]) & 0xFF;

            if (checksum === 0) {
                const reservedTracks = bootData[6];
                const blockShift = bootData[7];
                // Validate: blockShift should be 3-5, reservedTracks 0-3
                if (blockShift >= 3 && blockShift <= 5 && reservedTracks <= 3) {
                    return {
                        diskType: bootData[0],
                        sides: (bootData[1] & 0x01) + 1,
                        tracksPerSide: bootData[2],
                        sectorsPerTrack: bootData[3],
                        firstSectorId: bootData[4],
                        sectorSizeLog: bootData[5],
                        sectorSize: 128 << bootData[5],
                        reservedTracks: reservedTracks,
                        blockShift: blockShift,
                        blockSize: 128 << blockShift,
                        dirBlocks: bootData[8],
                        valid: true
                    };
                }
            }
        }

        // Fallback: assume standard +3 format (1 reserved track)
        return {
            reservedTracks: 1,
            blockSize: 1024,
            blockShift: 3,
            dirBlocks: 2,
            sectorsPerTrack: sorted.length,
            sectorSize: sorted[0].data.length || 512,
            firstSectorId: sorted[0].id,
            valid: false
        };
    }

    /**
     * Read directory data from a DSK image, accounting for reserved tracks.
     * @param {DSKImage} dskImage
     * @param {object} spec - Disk specification from getDiskSpec()
     * @returns {object} { dirData, sortedSectors (from dir track) } or null
     */
    static _readDirectory(dskImage, spec) {
        // Directory is at the start of the data area (after reserved tracks)
        const dirTrackNum = spec.reservedTracks;
        const dirTrack = dskImage.getTrack(dirTrackNum, 0);
        if (!dirTrack || dirTrack.sectors.length === 0) return null;

        const sortedSectors = [...dirTrack.sectors].sort((a, b) => a.id - b.id);

        // Directory occupies dirBlocks allocation blocks
        const dirBlocks = spec.dirBlocks || 2;
        const totalDirBytes = dirBlocks * spec.blockSize;
        const dirData = new Uint8Array(totalDirBytes);
        let pos = 0;
        let currentTrack = dirTrackNum;
        let sectorIdx = 0;

        // Read sectors sequentially until we have enough directory data.
        // Sectors may be larger or smaller than the block size.
        while (pos < totalDirBytes) {
            const track = dskImage.getTrack(currentTrack, 0);
            if (!track || track.sectors.length === 0) break;
            const tSorted = [...track.sectors].sort((a, b) => a.id - b.id);
            if (sectorIdx >= tSorted.length) {
                currentTrack++;
                sectorIdx = 0;
                continue;
            }
            const sec = tSorted[sectorIdx];
            const copyLen = Math.min(sec.data.length, totalDirBytes - pos);
            dirData.set(sec.data.subarray(0, copyLen), pos);
            pos += sec.data.length;
            sectorIdx++;
        }

        return { dirData, sortedSectors };
    }

    /**
     * List files from a +3DOS / CP/M directory on a DSK image.
     * Reads disk specification from boot sector to determine reserved tracks,
     * then parses 32-byte CP/M directory entries.
     * @param {DSKImage} dskImage
     * @returns {Array} Array of {name, ext, size, user, blocks}
     */
    static listFiles(dskImage) {
        const spec = DSKLoader.getDiskSpec(dskImage);
        const dir = DSKLoader._readDirectory(dskImage, spec);
        if (!dir) return [];

        const { dirData, sortedSectors } = dir;
        const blockSize = spec.blockSize;
        // Use spec sectorSize (from boot track geometry) for block mapping.
        // Directory track sectors may differ in size from data tracks.
        const sectorSize = spec.sectorSize || 512;
        const sectorsPerBlock = Math.max(1, Math.round(blockSize / sectorSize));
        const sectorsPerTrack = spec.sectorsPerTrack || sortedSectors.length;
        const baseSectorId = spec.firstSectorId !== undefined ? spec.firstSectorId : sortedSectors[0].id;
        const reservedTracks = spec.reservedTracks;

        // Parse CP/M directory entries (32 bytes each)
        const files = new Map();
        const maxEntries = Math.floor(dirData.length / 32);

        for (let i = 0; i < maxEntries; i++) {
            const entryBase = i * 32;
            const user = dirData[entryBase];

            // Skip deleted entries (0xE5) and invalid users (>15)
            if (user === 0xE5 || user > 15) continue;

            // Filename: 8 bytes (high bits are flags, mask to 7-bit)
            let name = '';
            for (let j = 1; j <= 8; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) name += String.fromCharCode(ch);
            }
            name = name.trimEnd();

            // Extension: 3 bytes (high bit of byte 9 = read-only, byte 10 = system, byte 11 = archived)
            let ext = '';
            for (let j = 9; j <= 11; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) ext += String.fromCharCode(ch);
            }
            ext = ext.trimEnd();

            if (name.length === 0) continue;

            // Extent number (for multi-extent files)
            const extentLo = dirData[entryBase + 12];
            const extentHi = dirData[entryBase + 14];
            const extent = extentLo + (extentHi * 32);

            // Records count (BC = bytes count in last extent, RC = records count)
            const bc = dirData[entryBase + 13];
            const rc = dirData[entryBase + 15];

            // Allocation blocks (16 bytes at offset 16-31)
            let blockCount = 0;
            for (let j = 16; j < 32; j++) {
                if (dirData[entryBase + j] !== 0) blockCount++;
            }

            const key = `${user}:${name}.${ext}`;
            if (!files.has(key)) {
                files.set(key, {
                    name: name,
                    ext: ext,
                    user: user,
                    size: 0,
                    maxExtent: -1,
                    lastRc: 0,
                    lastBc: 0,
                    totalBlocks: 0,
                    firstBlock: undefined
                });
            }

            const entry = files.get(key);
            entry.totalBlocks += blockCount;

            // Save first allocation block number from extent 0
            if (extent === 0 && entry.firstBlock === undefined) {
                for (let j = 16; j < 32; j++) {
                    if (dirData[entryBase + j] !== 0) {
                        entry.firstBlock = dirData[entryBase + j];
                        break;
                    }
                }
            }

            // Track the highest extent to calculate total file size
            if (extent > entry.maxExtent) {
                entry.maxExtent = extent;
                entry.lastRc = rc;
                entry.lastBc = bc;
            }
        }

        // Calculate file sizes and build result array
        const result = [];
        for (const [, entry] of files) {
            // Size = (extents before last * 16384) + (rc * 128) + adjustment for bc
            // Each extent can hold 16K (128 records * 128 bytes)
            let size;
            if (entry.maxExtent === 0) {
                size = entry.lastRc * 128;
            } else {
                size = entry.maxExtent * 16384 + entry.lastRc * 128;
            }
            // If bc > 0, last record isn't full (subtract unused bytes)
            if (entry.lastBc > 0 && size > 0) {
                size = size - 128 + entry.lastBc;
            }

            result.push({
                name: entry.name,
                ext: entry.ext,
                user: entry.user,
                size: size,
                rawSize: size,  // CP/M record-level size (before +3DOS header correction)
                blocks: entry.totalBlocks,
                firstBlock: entry.firstBlock
            });
        }

        // Read +3DOS headers to get precise file sizes and type info.
        // +3DOS files have a 128-byte header: "PLUS3DOS" signature at bytes 0-7,
        // 0x1A at byte 8, file length (incl. header) at bytes 11-14,
        // file type at byte 15 (0=BASIC, 3=CODE), type-specific data at 16+.
        for (const file of result) {
            if (file.firstBlock === undefined) continue;

            // Read first sector of the file's first allocation block
            const absSector = file.firstBlock * sectorsPerBlock;
            const trackNum = reservedTracks + Math.floor(absSector / sectorsPerTrack);
            const sectorInTrack = absSector % sectorsPerTrack;
            const sectorId = baseSectorId + sectorInTrack;

            const sectorData = dskImage.readSector(trackNum, 0, sectorId);
            if (!sectorData || sectorData.length < 128) continue;

            // Check +3DOS signature
            if (sectorData[0] !== 0x50 || sectorData[1] !== 0x4C ||
                sectorData[2] !== 0x55 || sectorData[3] !== 0x53 ||
                sectorData[4] !== 0x33 || sectorData[5] !== 0x44 ||
                sectorData[6] !== 0x4F || sectorData[7] !== 0x53) continue;

            // Verify soft-EOF marker
            if (sectorData[8] !== 0x1A) continue;

            // File length includes the 128-byte header
            const totalLen = sectorData[11] | (sectorData[12] << 8) |
                             (sectorData[13] << 16) | (sectorData[14] << 24);
            const dataLen = totalLen - 128;

            if (dataLen > 0 && dataLen <= file.size) {
                file.size = dataLen;
            }

            // File type: 0=BASIC, 1=Number array, 2=Char array, 3=CODE
            file.plus3Type = sectorData[15];
            file.hasPlus3Header = true;

            if (file.plus3Type === 3) {
                // CODE: load address and data length
                file.loadAddress = sectorData[16] | (sectorData[17] << 8);
                file.dataLength = sectorData[18] | (sectorData[19] << 8);
            } else if (file.plus3Type === 0) {
                // BASIC: program length, autostart line
                file.dataLength = sectorData[16] | (sectorData[17] << 8);
                file.autostart = sectorData[18] | (sectorData[19] << 8);
            }
        }

        return result;
    }

    /**
     * Read file data from a DSK image by CP/M filename.
     * Reads allocation block numbers from all directory extents and
     * concatenates the corresponding sectors in order.
     * @param {DSKImage} dskImage
     * @param {string} fileName - 8-char name (trimmed)
     * @param {string} fileExt - 3-char extension (trimmed)
     * @param {number} fileUser - CP/M user number
     * @param {number} fileSize - Known file size (from listFiles)
     * @returns {Uint8Array|null} File data or null
     */
    static readFileData(dskImage, fileName, fileExt, fileUser, fileSize) {
        const spec = DSKLoader.getDiskSpec(dskImage);
        const dir = DSKLoader._readDirectory(dskImage, spec);
        if (!dir) return null;

        const { dirData, sortedSectors } = dir;
        const blockSize = spec.blockSize;
        // Use spec sectorSize (from boot track geometry) for block mapping.
        // Directory track sectors may differ in size from data tracks.
        const sectorSize = spec.sectorSize || 512;
        const sectorsPerBlock = Math.max(1, Math.round(blockSize / sectorSize));
        const sectorsPerTrack = spec.sectorsPerTrack || sortedSectors.length;
        const baseSectorId = spec.firstSectorId !== undefined ? spec.firstSectorId : sortedSectors[0].id;
        const reservedTracks = spec.reservedTracks;

        // Collect all extents for this file, sorted by extent number
        const extents = [];
        const maxEntries = Math.floor(dirData.length / 32);
        for (let i = 0; i < maxEntries; i++) {
            const entryBase = i * 32;
            const user = dirData[entryBase];
            if (user === 0xE5 || user > 15) continue;

            let name = '';
            for (let j = 1; j <= 8; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) name += String.fromCharCode(ch);
            }
            name = name.trimEnd();

            let ext = '';
            for (let j = 9; j <= 11; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) ext += String.fromCharCode(ch);
            }
            ext = ext.trimEnd();

            if (user !== fileUser || name !== fileName || ext !== fileExt) continue;

            const extentLo = dirData[entryBase + 12];
            const extentHi = dirData[entryBase + 14];
            const extentNum = extentLo + (extentHi * 32);

            // Allocation block numbers (single byte each for small disks)
            const blocks = [];
            for (let j = 16; j < 32; j++) {
                if (dirData[entryBase + j] !== 0) {
                    blocks.push(dirData[entryBase + j]);
                }
            }

            extents.push({ extentNum, blocks });
        }

        if (extents.length === 0) return null;

        // Sort by extent number
        extents.sort((a, b) => a.extentNum - b.extentNum);

        // Collect all allocation blocks in order
        const allBlocks = [];
        for (const ext of extents) {
            for (const b of ext.blocks) {
                allBlocks.push(b);
            }
        }

        // Read data from allocation blocks
        // Block 0 starts at the first track after reserved tracks.
        // Block N maps to absolute sector N * sectorsPerBlock from start of data area.
        const totalBytes = allBlocks.length * blockSize;
        const result = new Uint8Array(totalBytes);
        let writePos = 0;

        for (const blockNum of allBlocks) {
            const absoluteSector = blockNum * sectorsPerBlock;
            const trackNum = reservedTracks + Math.floor(absoluteSector / sectorsPerTrack);
            const sectorInTrack = absoluteSector % sectorsPerTrack;

            for (let s = 0; s < sectorsPerBlock; s++) {
                const curSectorInTrack = sectorInTrack + s;
                const curTrack = trackNum + Math.floor(curSectorInTrack / sectorsPerTrack);
                const curSector = curSectorInTrack % sectorsPerTrack;
                const sectorId = baseSectorId + curSector;

                const sectorData = dskImage.readSector(curTrack, 0, sectorId);
                if (sectorData) {
                    const copyLen = Math.min(sectorSize, result.length - writePos);
                    result.set(sectorData.subarray(0, copyLen), writePos);
                }
                writePos += sectorSize;
            }
        }

        // Trim to actual file size
        if (fileSize > 0 && fileSize < result.length) {
            return result.slice(0, fileSize);
        }
        return result.slice(0, Math.min(writePos, result.length));
    }
}

// ========== UPD765 ==========
// µPD765A Floppy Disk Controller emulation

export class UPD765 {
    constructor() {
        // 4 drives max (only drive 0 typically used on +3)
        this.drives = [];
        for (let i = 0; i < 4; i++) {
            this.drives.push({
                track: 0,
                disk: null,     // DSKImage or null
                motorOn: false
            });
        }

        // State machine phases
        this.PHASE_IDLE = 0;
        this.PHASE_COMMAND = 1;
        this.PHASE_EXECUTION = 2;
        this.PHASE_RESULT = 3;

        this.phase = this.PHASE_IDLE;

        // Command buffer
        this.commandBuffer = [];
        this.commandBytesExpected = 0;
        this.currentCommand = 0;

        // Result buffer
        this.resultBuffer = [];
        this.resultIndex = 0;

        // Execution data buffer (for Read/Write Data)
        this.dataBuffer = [];
        this.dataIndex = 0;
        this.dataDirection = 0;  // 0 = write (CPU→FDC), 1 = read (FDC→CPU)

        // Status registers
        this.st0 = 0;
        this.st1 = 0;
        this.st2 = 0;

        // Current operation parameters
        this.opCylinder = 0;
        this.opHead = 0;
        this.opSector = 0;
        this.opSectorEnd = 0;
        this.opSizeCode = 0;
        this.opDTL = 0;     // Data length when N=0
        this.opMultiTrack = false;
        this.opMFM = false;
        this.opSkipDeleted = false;

        // Interrupt pending (set by Seek/Recalibrate, cleared by Sense Interrupt Status)
        this.interruptPending = false;
        this.seekST0 = 0;
        this.seekTrack = 0;

        // Drive busy bits (MSR bits 0-3) — set by Seek/Recalibrate, cleared by Sense Interrupt Status
        this.driveBusy = 0;

        // Activity callback
        this.onDiskActivity = null;

        // Debug logging (set to true for FDC command tracing)
        this.debug = false;
    }

    /**
     * Reset the FDC to initial state
     */
    reset() {
        this.phase = this.PHASE_IDLE;
        this.commandBuffer = [];
        this.resultBuffer = [];
        this.resultIndex = 0;
        this.dataBuffer = [];
        this.dataIndex = 0;
        this.st0 = 0;
        this.st1 = 0;
        this.st2 = 0;
        this.interruptPending = false;
        this.driveBusy = 0;
        for (const drive of this.drives) {
            drive.track = 0;
        }
    }

    /**
     * Set motor state for all drives (controlled by port 0x1FFD bit 3)
     * @param {boolean} on
     */
    setMotor(on) {
        for (const drive of this.drives) {
            drive.motorOn = on;
        }
    }

    /**
     * Read Main Status Register (port 0x2FFD)
     * @returns {number} MSR byte
     */
    readMSR() {
        // Bit 7: RQM (Request for Master) — always 1 in instant-completion model
        // Bit 6: DIO — 0=CPU→FDC, 1=FDC→CPU
        // Bit 5: EXM — execution mode (non-DMA), set during execution phase
        // Bit 4: CB — command busy
        // Bits 0-3: drive busy (seeking), set by Seek/Recalibrate, cleared by SIS
        let msr = 0x80; // RQM always set

        if (this.phase === this.PHASE_RESULT) {
            msr |= 0x40; // DIO = 1 (FDC→CPU)
            msr |= 0x10; // CB = 1
        } else if (this.phase === this.PHASE_EXECUTION) {
            msr |= 0x20; // EXM = 1 (non-DMA execution mode active)
            msr |= 0x10; // CB = 1
            if (this.dataDirection === 1) {
                msr |= 0x40; // DIO = 1 (FDC→CPU for read)
            }
        } else if (this.phase === this.PHASE_COMMAND && this.commandBuffer.length > 0) {
            msr |= 0x10; // CB = 1 (accepting command parameters)
        }

        // Drive busy bits (set by Seek/Recalibrate, cleared by Sense Interrupt Status)
        msr |= (this.driveBusy & 0x0F);

        return msr;
    }

    /**
     * Read Data Register (port 0x3FFD)
     * @returns {number} data byte
     */
    readData() {
        if (this.phase === this.PHASE_RESULT) {
            if (this.resultIndex < this.resultBuffer.length) {
                const val = this.resultBuffer[this.resultIndex++];
                if (this.debug && this.resultIndex === 1) {
                    console.log(`[FDC] RESULT: [${this.resultBuffer.map(b => '0x' + b.toString(16).padStart(2,'0')).join(',')}]`);
                }
                if (this.resultIndex >= this.resultBuffer.length) {
                    // All results read, return to idle
                    if (this.debug) console.log('[FDC] → IDLE (all results read)');
                    this.phase = this.PHASE_IDLE;
                }
                return val;
            }
            this.phase = this.PHASE_IDLE;
            return 0xFF;
        }

        if (this.phase === this.PHASE_EXECUTION && this.dataDirection === 1) {
            // Read data from execution buffer
            if (this.dataIndex < this.dataBuffer.length) {
                const val = this.dataBuffer[this.dataIndex++];
                if (this.dataIndex >= this.dataBuffer.length) {
                    // Data transfer complete — move to result phase
                    if (this.debug) console.log(`[FDC] Data transfer complete (${this.dataBuffer.length} bytes read) → RESULT`);
                    this._finishDataTransfer();
                }
                return val;
            }
            this._finishDataTransfer();
            return 0xFF;
        }

        if (this.debug && this.phase !== this.PHASE_IDLE) {
            console.log(`[FDC] readData() in unexpected phase ${this.phase} dir=${this.dataDirection}`);
        }
        return 0xFF;
    }

    /**
     * Write Data Register (port 0x3FFD)
     * @param {number} val - byte written
     */
    writeData(val) {
        if (this.phase === this.PHASE_EXECUTION && this.dataDirection === 0) {
            // Write data to execution buffer
            if (this.dataIndex < this.dataBuffer.length) {
                this.dataBuffer[this.dataIndex++] = val;
                if (this.dataIndex >= this.dataBuffer.length) {
                    this._finishWriteTransfer();
                }
            }
            return;
        }

        if (this.phase === this.PHASE_RESULT) {
            // Write during result phase — some software does this to abort
            // Reset to idle to accept new commands
            if (this.debug) console.log(`[FDC] writeData(0x${val.toString(16).padStart(2,'0')}) during RESULT phase — resetting to IDLE`);
            this.phase = this.PHASE_IDLE;
            this.resultBuffer = [];
            this.resultIndex = 0;
            this._startCommand(val);
            return;
        }

        if (this.phase === this.PHASE_IDLE || this.phase === this.PHASE_COMMAND) {
            if (this.commandBuffer.length === 0) {
                // First byte of command — decode it
                this._startCommand(val);
            } else {
                // Subsequent command parameter byte
                this.commandBuffer.push(val);
                if (this.commandBuffer.length >= this.commandBytesExpected) {
                    this._executeCommand();
                }
            }
        }
    }

    /**
     * Check if a specific drive (or any drive) has a disk inserted
     * @param {number} [driveIndex] - Drive index (0-3). If omitted, checks any drive.
     * @returns {boolean}
     */
    hasDisk(driveIndex) {
        if (driveIndex !== undefined) {
            return this.drives[driveIndex & 0x03].disk !== null;
        }
        return this.drives.some(d => d.disk !== null);
    }

    /**
     * Eject disk from specified drive
     * @param {number} driveIndex - Drive index (0-3)
     */
    ejectDisk(driveIndex) {
        const drv = this.drives[driveIndex & 0x03];
        drv.disk = null;
        drv.track = 0;
        drv.motorOn = false;
    }

    // ========== Command Decoding ==========

    /**
     * Start a new command (first byte received)
     */
    _startCommand(val) {
        this.currentCommand = val & 0x1F;  // Command ID = bits 0-4
        this.opMultiTrack = !!(val & 0x80);   // MT flag
        this.opMFM = !!(val & 0x40);          // MF flag
        this.opSkipDeleted = !!(val & 0x20);  // SK flag

        this.commandBuffer = [val];
        this.phase = this.PHASE_COMMAND;

        // Determine expected parameter count by command
        switch (this.currentCommand) {
            case 0x03: // Specify
                this.commandBytesExpected = 3;
                break;
            case 0x02: // Read Track
                this.commandBytesExpected = 9;
                break;
            case 0x04: // Sense Drive Status
                this.commandBytesExpected = 2;
                break;
            case 0x05: // Write Data
            case 0x06: // Read Data
            case 0x09: // Write Deleted Data
            case 0x0C: // Read Deleted Data
                this.commandBytesExpected = 9;
                break;
            case 0x0A: // Read ID
                this.commandBytesExpected = 2;
                break;
            case 0x07: // Recalibrate
                this.commandBytesExpected = 2;
                break;
            case 0x08: // Sense Interrupt Status
                this.commandBytesExpected = 1;
                // Execute immediately (only 1 byte command)
                this._executeCommand();
                return;
            case 0x0D: // Format Track
                this.commandBytesExpected = 6;
                break;
            case 0x0F: // Seek
                this.commandBytesExpected = 3;
                break;
            case 0x11: // Scan Equal
            case 0x19: // Scan Low or Equal
            case 0x1D: // Scan High or Equal
                this.commandBytesExpected = 9;
                break;
            default:
                // Unknown/unsupported command — return invalid ST0
                if (this.debug) console.log(`[FDC] Unknown command 0x${(val & 0x1F).toString(16)} (raw=0x${val.toString(16)}) → RESULT(invalid)`);
                this.st0 = 0x80; // Invalid command
                this.resultBuffer = [this.st0];
                this.resultIndex = 0;
                this.phase = this.PHASE_RESULT;
                this.commandBuffer = [];
                return;
        }
    }

    /**
     * Execute a fully-received command
     */
    _executeCommand() {
        const cmd = this.currentCommand;
        const buf = this.commandBuffer;

        if (this.debug) {
            const cmdNames = {
                0x02: 'ReadTrack', 0x03: 'Specify', 0x04: 'SenseDriveStatus',
                0x05: 'WriteData', 0x06: 'ReadData', 0x07: 'Recalibrate',
                0x08: 'SenseInterrupt', 0x09: 'WriteDeleted', 0x0A: 'ReadID',
                0x0C: 'ReadDeleted', 0x0D: 'FormatTrack', 0x0F: 'Seek',
                0x11: 'ScanEqual', 0x19: 'ScanLowOrEqual', 0x1D: 'ScanHighOrEqual'
            };
            const name = cmdNames[cmd] || `Unknown(0x${cmd.toString(16)})`;
            console.log(`[FDC] CMD ${name} buf=[${buf.map(b => '0x' + b.toString(16).padStart(2,'0')).join(',')}] phase=${this.phase}`);
        }

        switch (cmd) {
            case 0x02: this._cmdReadTrack(buf); break;
            case 0x03: this._cmdSpecify(buf); break;
            case 0x04: this._cmdSenseDriveStatus(buf); break;
            case 0x05: this._cmdWriteData(buf, false); break;
            case 0x06: this._cmdReadData(buf, false); break;
            case 0x07: this._cmdRecalibrate(buf); break;
            case 0x08: this._cmdSenseInterruptStatus(); break;
            case 0x09: this._cmdWriteData(buf, true); break;  // Write Deleted
            case 0x0A: this._cmdReadID(buf); break;
            case 0x0C: this._cmdReadData(buf, true); break;   // Read Deleted
            case 0x0D: this._cmdFormatTrack(buf); break;
            case 0x0F: this._cmdSeek(buf); break;
            case 0x11: // Scan Equal (stub — not used on +3)
            case 0x19: // Scan Low or Equal
            case 0x1D: // Scan High or Equal
                this._cmdScanStub(buf); break;
            default:
                this.st0 = 0x80;
                this.resultBuffer = [this.st0];
                this.resultIndex = 0;
                this.phase = this.PHASE_RESULT;
                break;
        }

        this.commandBuffer = [];
    }

    // ========== Command Implementations ==========

    /**
     * Specify (0x03): Set step rate and head load/unload times
     * Accept and ignore (no timing simulation)
     */
    _cmdSpecify(buf) {
        // No result phase — command complete
        this.phase = this.PHASE_IDLE;
    }

    /**
     * Sense Drive Status (0x04): Return ST3
     */
    _cmdSenseDriveStatus(buf) {
        const driveNum = buf[1] & 0x01;
        const head = (buf[1] >> 2) & 0x01;
        const drive = this.drives[driveNum];

        let st3 = driveNum;
        st3 |= (head << 2);         // Head address
        if (drive.disk) {
            st3 |= 0x20; // Ready (RDY) — disk present
            if (drive.disk.numSides > 1) st3 |= 0x08; // Two Side (TS)
        } else {
            // No disk: not ready + write protected
            // +3 ROM uses this combination to detect missing drives
            st3 |= 0x40; // Write Protected (WP)
            // RDY (0x20) NOT set = not ready
        }
        if (drive.track === 0) st3 |= 0x10; // Track 0 (T0)

        this.resultBuffer = [st3];
        this.resultIndex = 0;
        this.phase = this.PHASE_RESULT;
    }

    /**
     * Read Data (0x06) / Read Deleted Data (0x0C)
     */
    _cmdReadData(buf, deleted) {
        const driveNum = buf[1] & 0x01;
        const head = (buf[1] >> 2) & 0x01;
        this.opCylinder = buf[2];
        this.opHead = buf[3];
        this.opSector = buf[4];
        this.opSizeCode = buf[5];
        this.opSectorEnd = buf[6]; // EOT — last sector to read
        // buf[7] = GPL (gap length), buf[8] = DTL (data length when N=0)
        this.opDTL = buf[8];

        const drive = this.drives[driveNum];
        if (!drive.disk) {
            // No disk — abnormal termination
            this._setResultNoData(driveNum, head, 0x48, 0x01, 0x00); // No address mark
            return;
        }

        // Buffer sectors from R to EOT. The +3 ROM sets EOT=R for single-sector
        // reads, while custom loaders set EOT to the last sector on the track for
        // multi-sector reads. We buffer all requested sectors so both work.
        // TC (Terminal Count) is not connected on the +3, so all data transfer
        // commands end with abnormal termination (ST0=0x40, ST1 EN=0x80).
        const sectorDataSize = this.opSizeCode === 0 ? this.opDTL : (128 << this.opSizeCode);

        // Collect sectors from R to EOT by scanning the physical track.
        // The µPD765 reads from whatever track the head is physically on (set by Seek/Recalibrate).
        // The C value in the command is for matching against sector ID headers, not for track selection.
        const track = drive.disk.getTrack(drive.track, head);
        if (!track) {
            this.st0 = 0x40 | driveNum | (head << 2);
            this.st1 = 0x04; // No data
            this.st2 = 0x00;
            this._setResult7(driveNum, head, this.opCylinder, this.opHead, this.opSector, this.opSizeCode);
            return;
        }

        // Build ordered list of sectors to read starting from R.
        // The µPD765 always reads at least sector R (the first sector), regardless of EOT.
        // EOT only controls when to stop reading ADDITIONAL sectors after the first.
        // When R > EOT, just sector R is read, then EN (end of track) is set.
        // Per-sector handling of data mark type (DAM vs DDAM) and SK flag:
        //   DSK ST2 bit 6 = sector has Deleted Data Address Mark (DDAM)
        //   SK=1: skip sectors whose mark type doesn't match the command
        //   SK=0: read mismatched sector but set CM flag and terminate after it
        const sectorsToRead = [];
        let cmFlag = false;   // Control Mark: set when mark type mismatches command
        let dskST1 = 0;      // Accumulated DSK error flags (CRC errors etc.)
        let dskST2 = 0;
        let lastSectorId = this.opSector;
        const scanEnd = Math.max(this.opSector, this.opSectorEnd);

        for (let sId = this.opSector; sId <= scanEnd; sId++) {
            let found = null;
            for (const sec of track.sectors) {
                if (sec.id === sId) {
                    found = sec;
                    break;
                }
            }
            if (!found) {
                // Sector not found — terminate with error at this sector
                this.st0 = 0x40 | driveNum | (head << 2);
                this.st1 = 0x04; // No data
                this.st2 = 0x00;
                this._setResult7(driveNum, head, this.opCylinder, this.opHead, sId, this.opSizeCode);
                return;
            }

            // Check data mark type: DSK ST2 bit 6 = DDAM
            const sectorIsDeleted = !!(found.st2 & 0x40);
            const markMismatch = (deleted !== sectorIsDeleted);

            if (markMismatch && this.opSkipDeleted) {
                // SK=1: skip this sector entirely (don't read data, don't report errors)
                if (this.debug) {
                    console.log(`[FDC]   SKIP sector R=${sId} (SK=1, mark mismatch: cmd=${deleted?'deleted':'normal'}, sector=${sectorIsDeleted?'DDAM':'DAM'})`);
                }
                lastSectorId = sId;
                continue;
            }

            // Sector will be read
            sectorsToRead.push(found);
            // Accumulate DSK error flags (bits 0-5 only; bit 6 is DDAM indicator, handled above)
            dskST1 |= (found.st1 || 0);
            dskST2 |= ((found.st2 || 0) & 0x3F);
            lastSectorId = sId;

            if (markMismatch) {
                // SK=0: read the sector but set CM flag and stop after this sector
                cmFlag = true;
                if (this.debug) {
                    console.log(`[FDC]   CM set for sector R=${sId} (SK=0, mark mismatch)`);
                }
                break; // Terminate after this sector
            }
        }

        if (this.debug) {
            console.log(`[FDC] ReadData: C=${this.opCylinder} H=${head} R=0x${this.opSector.toString(16)} N=${this.opSizeCode} EOT=0x${this.opSectorEnd.toString(16)} SK=${this.opSkipDeleted?1:0} del=${deleted?1:0} matched=${sectorsToRead.length} driveTrack=${drive.track} sectorDataSize=${sectorDataSize}`);
            for (const sec of sectorsToRead) {
                console.log(`[FDC]   sector R=${sec.id} dataLen=${sec.data.length} first4=[${sec.data[0]},${sec.data[1]},${sec.data[2]},${sec.data[3]}] st1=0x${(sec.st1||0).toString(16)} st2=0x${(sec.st2||0).toString(16)}`);
            }
        }

        if (sectorsToRead.length === 0) {
            // All sectors were skipped (SK=1, no matching mark type)
            // Return abnormal termination with EN flag, no data transferred
            this.st0 = 0x40 | driveNum | (head << 2);
            this.st1 = 0x80; // EN (end of track)
            this.st2 = 0x00;
            this._setResult7(driveNum, head, this.opCylinder, this.opHead,
                lastSectorId + 1, this.opSizeCode);
            if (this.debug) {
                console.log(`[FDC] ReadData: all sectors skipped → result ST0=0x${this.st0.toString(16)} ST1=0x${this.st1.toString(16)} ST2=0x${this.st2.toString(16)}`);
            }
            return;
        }

        // Build data buffer from matched sectors.
        // For weak sectors (copy-protection): randomize bytes at positions
        // marked in weakMap so each read returns different data.
        const totalSize = sectorDataSize * sectorsToRead.length;
        this.dataBuffer = new Uint8Array(totalSize);
        let writePos = 0;
        for (const sec of sectorsToRead) {
            const copyLen = Math.min(sec.data.length, sectorDataSize);
            this.dataBuffer.set(sec.data.subarray(0, copyLen), writePos);
            if (sec.weakMap) {
                // EDSK weak sector: randomize byte positions where copies differed
                for (let i = 0; i < copyLen; i++) {
                    if (sec.weakMap[i]) {
                        this.dataBuffer[writePos + i] = (Math.random() * 256) | 0;
                    }
                }
                if (this.debug) {
                    let weakCount = 0;
                    for (let i = 0; i < copyLen; i++) if (sec.weakMap[i]) weakCount++;
                    console.log(`[FDC]   WEAK sector R=${sec.id}: ${weakCount} weak bytes randomized`);
                }
            } else if (((sec.st1 || 0) & 0x20) && sec.data.length >= sectorDataSize) {
                // CRC error sector without EDSK weak data, where the stored data
                // fully covers the declared sector size. This indicates a genuine
                // CRC corruption (protection sector), not an oversized-sector technique.
                // Oversized sectors (e.g. N=6/8192 declared, 6144 actual) have
                // sec.data.length < sectorDataSize — their CRC error is because
                // the declared size exceeds the stored data, and the data is valid.
                // Randomize bytes from ~offset 256 onward to simulate unstable reads.
                const noiseStart = Math.min(256, copyLen);
                for (let i = noiseStart; i < copyLen; i++) {
                    this.dataBuffer[writePos + i] = (Math.random() * 256) | 0;
                }
                if (this.debug) {
                    console.log(`[FDC]   CRC-error sector R=${sec.id}: ${copyLen - noiseStart} bytes randomized (dataLen=${sec.data.length} >= sectorSize=${sectorDataSize})`);
                }
            }
            writePos += sectorDataSize;
        }
        this.dataIndex = 0;
        this.dataDirection = 1; // FDC→CPU

        const lastSector = sectorsToRead[sectorsToRead.length - 1];
        this.st0 = 0x40 | driveNum | (head << 2); // Abnormal termination
        // EN (0x80) = end of track: set when FDC completed all sectors R→EOT without
        // early termination. NOT set when terminated by CM (mark mismatch) or CRC error.
        // On the +3, TC is never asserted so EN is set for any normal R→EOT completion.
        const hasCRCError = (dskST1 & 0x20) !== 0; // DE flag from DSK
        const reachedEOT = !cmFlag && !hasCRCError && (lastSector.id >= this.opSectorEnd);
        // ST1: EN (conditional) + DSK error flags (e.g. DE=0x20 for CRC errors)
        this.st1 = (reachedEOT ? 0x80 : 0x00) | (dskST1 & 0x7F);
        // ST2: CM (0x40, mark type mismatch when SK=0) + DSK error flags (e.g. DD=0x20)
        this.st2 = (cmFlag ? 0x40 : 0x00) | (dskST2 & 0x3F);

        // Store result info for _finishDataTransfer
        this._pendingResult = {
            driveNum, head,
            cylinder: this.opCylinder,
            headAddr: this.opHead,
            sector: lastSector.id + 1,  // Points to next sector after last transferred
            sizeCode: this.opSizeCode
        };

        // Activity callback
        if (this.onDiskActivity) {
            this.onDiskActivity('read', this.opCylinder, this.opSector, head, driveNum);
        }

        this.phase = this.PHASE_EXECUTION;
    }

    /**
     * Write Data (0x05) / Write Deleted Data (0x09)
     */
    _cmdWriteData(buf, deleted) {
        const driveNum = buf[1] & 0x01;
        const head = (buf[1] >> 2) & 0x01;
        this.opCylinder = buf[2];
        this.opHead = buf[3];
        this.opSector = buf[4];
        this.opSizeCode = buf[5];
        this.opSectorEnd = buf[6];
        this.opDTL = buf[8];

        const drive = this.drives[driveNum];
        if (!drive.disk) {
            this._setResultNoData(driveNum, head, 0x48, 0x01, 0x00);
            return;
        }

        // Buffer sectors from R to EOT, matching Read Data approach.
        // +3 ROM sets EOT=R (one sector); custom loaders may set EOT > R.
        const sectorDataSize = this.opSizeCode === 0 ? this.opDTL : (128 << this.opSizeCode);
        const sectorCount = this.opSectorEnd - this.opSector + 1;
        const totalSize = sectorDataSize * sectorCount;

        if (this.debug) {
            console.log(`[FDC] WriteData: C=${this.opCylinder} H=${head} R=0x${this.opSector.toString(16)} N=${this.opSizeCode} EOT=0x${this.opSectorEnd.toString(16)} sectors=${sectorCount}`);
        }

        this.dataBuffer = new Uint8Array(totalSize);
        this.dataIndex = 0;
        this.dataDirection = 0; // CPU→FDC

        // Store metadata for write completion
        // Use physical drive.track for the actual write, not logical opCylinder
        this._writeDeleted = deleted;
        this._pendingResult = {
            driveNum, head,
            physicalTrack: drive.track,
            cylinder: this.opCylinder,
            headAddr: this.opHead,
            sectorStart: this.opSector,
            sectorEnd: this.opSectorEnd,
            sizeCode: this.opSizeCode,
            sectorDataSize: sectorDataSize
        };

        this.phase = this.PHASE_EXECUTION;
    }

    /**
     * Recalibrate (0x07): Seek to track 0
     */
    _cmdRecalibrate(buf) {
        const driveNum = buf[1] & 0x01;
        const drive = this.drives[driveNum];
        drive.track = 0;

        // Set interrupt pending (cleared by Sense Interrupt Status)
        this.interruptPending = true;
        this.seekST0 = 0x20 | driveNum; // Seek end, normal
        this.seekTrack = 0;
        // Set drive busy bit — cleared by Sense Interrupt Status
        this.driveBusy |= (1 << driveNum);

        this.phase = this.PHASE_IDLE;
    }

    /**
     * Sense Interrupt Status (0x08): Return status after Seek/Recalibrate
     */
    _cmdSenseInterruptStatus() {
        if (this.interruptPending) {
            this.resultBuffer = [this.seekST0, this.seekTrack];
            this.interruptPending = false;
            // Clear drive busy bit for the drive that completed seeking
            const driveNum = this.seekST0 & 0x03;
            this.driveBusy &= ~(1 << driveNum);
        } else {
            // No interrupt pending — invalid command
            this.resultBuffer = [0x80];
        }
        this.resultIndex = 0;
        this.phase = this.PHASE_RESULT;
    }

    /**
     * Read ID (0x0A): Return next sector header on current track
     */
    _cmdReadID(buf) {
        const driveNum = buf[1] & 0x01;
        const head = (buf[1] >> 2) & 0x01;
        const drive = this.drives[driveNum];

        if (!drive.disk) {
            this._setResultNoData(driveNum, head, 0x48, 0x01, 0x00);
            return;
        }

        const track = drive.disk.getTrack(drive.track, head);
        if (!track || track.sectors.length === 0) {
            this._setResultNoData(driveNum, head, 0x40, 0x05, 0x00);
            return;
        }

        // Return the first sector header on this track
        const sec = track.sectors[0];
        this.st0 = driveNum | (head << 2);
        this.st1 = 0;
        this.st2 = 0;
        this.resultBuffer = [
            this.st0, this.st1, this.st2,
            sec.cylinder, sec.head, sec.id, sec.sizeCode
        ];
        this.resultIndex = 0;
        this.phase = this.PHASE_RESULT;
    }

    /**
     * Format Track (0x0D): Write sector headers and fill data
     */
    _cmdFormatTrack(buf) {
        const driveNum = buf[1] & 0x01;
        const head = (buf[1] >> 2) & 0x01;
        const sizeCode = buf[2];
        const sectorsPerTrack = buf[3];
        const gapLength = buf[4];
        const fillByte = buf[5];

        const drive = this.drives[driveNum];
        if (!drive.disk) {
            this._setResultNoData(driveNum, head, 0x48, 0x01, 0x00);
            return;
        }

        // Accept format data (4 bytes per sector: C, H, R, N)
        const formatDataSize = sectorsPerTrack * 4;
        this.dataBuffer = new Uint8Array(formatDataSize);
        this.dataIndex = 0;
        this.dataDirection = 0; // CPU→FDC

        this._formatInfo = {
            driveNum, head, sizeCode, sectorsPerTrack, fillByte
        };
        this._pendingResult = {
            driveNum, head,
            cylinder: drive.track,
            headAddr: head,
            sector: sectorsPerTrack, // Last sector formatted
            sizeCode: sizeCode
        };

        this.phase = this.PHASE_EXECUTION;
    }

    /**
     * Seek (0x0F): Move head to specified track
     */
    _cmdSeek(buf) {
        const driveNum = buf[1] & 0x01;
        const newTrack = buf[2];
        const drive = this.drives[driveNum];
        drive.track = newTrack;

        // Set interrupt pending
        this.interruptPending = true;
        this.seekST0 = 0x20 | driveNum; // Seek end, normal
        this.seekTrack = newTrack;
        // Set drive busy bit — cleared by Sense Interrupt Status
        this.driveBusy |= (1 << driveNum);

        this.phase = this.PHASE_IDLE;
    }

    /**
     * Read Track (0x02): Read all sectors on current track in physical order
     * Used by copy-protection schemes to read raw track data.
     * Same parameter format as Read Data but ignores sector IDs — reads
     * sectors in the order they appear on the physical track.
     */
    _cmdReadTrack(buf) {
        const driveNum = buf[1] & 0x01;
        const head = (buf[1] >> 2) & 0x01;
        this.opCylinder = buf[2];
        this.opHead = buf[3];
        this.opSector = buf[4];      // Starting sector (for result reporting)
        this.opSizeCode = buf[5];
        this.opSectorEnd = buf[6];   // EOT
        this.opDTL = buf[8];

        const drive = this.drives[driveNum];
        if (!drive.disk) {
            this._setResultNoData(driveNum, head, 0x48, 0x01, 0x00);
            return;
        }

        const track = drive.disk.getTrack(drive.track, head);
        if (!track || track.sectors.length === 0) {
            this.st0 = 0x40 | driveNum | (head << 2);
            this.st1 = 0x04; // No data
            this.st2 = 0x00;
            this._setResult7(driveNum, head, this.opCylinder, this.opHead, this.opSector, this.opSizeCode);
            return;
        }

        // Read ALL sectors on the track in physical order (as they appear in DSK)
        const sectorDataSize = this.opSizeCode === 0 ? this.opDTL : (128 << this.opSizeCode);
        const sectorsToRead = track.sectors;
        const totalSize = sectorDataSize * sectorsToRead.length;

        if (this.debug) {
            console.log(`[FDC] ReadTrack: driveTrack=${drive.track} H=${head} N=${this.opSizeCode} sectors=${sectorsToRead.length} totalSize=${totalSize}`);
        }

        this.dataBuffer = new Uint8Array(totalSize);
        let writePos = 0;
        for (const sec of sectorsToRead) {
            const copyLen = Math.min(sec.data.length, sectorDataSize);
            this.dataBuffer.set(sec.data.subarray(0, copyLen), writePos);
            writePos += sectorDataSize;
        }
        this.dataIndex = 0;
        this.dataDirection = 1; // FDC→CPU

        // Abnormal termination + EN (TC not connected on +3)
        const lastSector = sectorsToRead[sectorsToRead.length - 1];
        this.st0 = 0x40 | driveNum | (head << 2);
        this.st1 = 0x80; // EN
        this.st2 = 0;

        this._pendingResult = {
            driveNum, head,
            cylinder: this.opCylinder,
            headAddr: this.opHead,
            sector: lastSector.id + 1,
            sizeCode: this.opSizeCode
        };

        if (this.onDiskActivity) {
            this.onDiskActivity('read', drive.track, this.opSector, head, driveNum);
        }

        this.phase = this.PHASE_EXECUTION;
    }

    /**
     * Scan Equal/Low/High (0x11/0x19/0x1D): Stub implementation
     * These commands compare disk data with CPU-supplied data.
     * Not used by +3 software — accept all 9 bytes and return
     * scan-not-satisfied result to prevent desync.
     */
    _cmdScanStub(buf) {
        const driveNum = buf[1] & 0x01;
        const head = (buf[1] >> 2) & 0x01;
        this.opCylinder = buf[2];
        this.opHead = buf[3];
        this.opSector = buf[4];
        this.opSizeCode = buf[5];
        this.opSectorEnd = buf[6];

        // Return abnormal termination — scan not satisfied (SN flag in ST2)
        this.st0 = 0x40 | driveNum | (head << 2);
        this.st1 = 0x00;
        this.st2 = 0x08; // SN (scan not satisfied)
        this._setResult7(driveNum, head, this.opCylinder, this.opHead, this.opSector, this.opSizeCode);
    }

    // ========== Data Transfer Completion ==========

    /**
     * Called when Read Data execution buffer is fully read by CPU
     */
    _finishDataTransfer() {
        const r = this._pendingResult;
        if (r) {
            this._setResult7(r.driveNum, r.head, r.cylinder, r.headAddr, r.sector, r.sizeCode);
        } else {
            this.phase = this.PHASE_IDLE;
        }
        this._pendingResult = null;
    }

    /**
     * Called when Write Data execution buffer is fully written by CPU
     */
    _finishWriteTransfer() {
        const r = this._pendingResult;
        if (!r) {
            this.phase = this.PHASE_IDLE;
            return;
        }

        const drive = this.drives[r.driveNum];
        if (!drive.disk) {
            this._setResultNoData(r.driveNum, r.head, 0x48, 0x01, 0x00);
            this._pendingResult = null;
            return;
        }

        // Check if this is a Format Track command
        if (this._formatInfo) {
            this._finishFormatTrack();
            return;
        }

        // Write all sectors from R to EOT to disk image
        // Use physical track position, not logical cylinder from command
        let bufPos = 0;
        for (let sId = r.sectorStart; sId <= r.sectorEnd; sId++) {
            const sectorData = this.dataBuffer.subarray(bufPos, bufPos + r.sectorDataSize);
            drive.disk.writeSector(r.physicalTrack, r.head, sId, sectorData);
            bufPos += r.sectorDataSize;
        }

        // Activity callback
        if (this.onDiskActivity) {
            this.onDiskActivity('write', r.physicalTrack, r.sectorStart, r.head, r.driveNum);
        }

        // Abnormal termination + EN (TC not connected on +3)
        this.st0 = 0x40 | r.driveNum | (r.head << 2);
        this.st1 = 0x80; // EN
        this.st2 = this._writeDeleted ? 0x40 : 0x00;
        this._setResult7(r.driveNum, r.head, r.cylinder, r.headAddr, r.sectorEnd + 1, r.sizeCode);
        this._pendingResult = null;
    }

    /**
     * Finish Format Track command after receiving format data
     */
    _finishFormatTrack() {
        const fi = this._formatInfo;
        const r = this._pendingResult;
        const drive = this.drives[fi.driveNum];

        if (!drive.disk) {
            this._setResultNoData(fi.driveNum, fi.head, 0x48, 0x01, 0x00);
            this._formatInfo = null;
            this._pendingResult = null;
            return;
        }

        // Create new track with sectors based on format data
        const sectorSize = 128 << fi.sizeCode;
        const trackIdx = drive.track * drive.disk.numSides + fi.head;
        const track = { sectors: [] };

        for (let s = 0; s < fi.sectorsPerTrack; s++) {
            const base = s * 4;
            const c = this.dataBuffer[base];
            const h = this.dataBuffer[base + 1];
            const id = this.dataBuffer[base + 2];
            const n = this.dataBuffer[base + 3];

            const data = new Uint8Array(sectorSize);
            data.fill(fi.fillByte);

            track.sectors.push({
                cylinder: c,
                head: h,
                id: id,
                sizeCode: n,
                st1: 0,
                st2: 0,
                data: data
            });
        }

        drive.disk.tracks[trackIdx] = track;

        if (this.onDiskActivity) {
            this.onDiskActivity('write', drive.track, 0, fi.head, fi.driveNum);
        }

        // Abnormal termination + EN (TC not connected on +3)
        this.st0 = 0x40 | fi.driveNum | (fi.head << 2);
        this.st1 = 0x80; // EN
        this.st2 = 0;
        this._setResult7(r.driveNum, r.head, r.cylinder, r.headAddr, r.sector, r.sizeCode);

        this._formatInfo = null;
        this._pendingResult = null;
    }

    // ========== Result Helpers ==========

    /**
     * Set 7-byte standard result (ST0, ST1, ST2, C, H, R, N)
     */
    _setResult7(driveNum, head, cylinder, headAddr, sector, sizeCode) {
        this.resultBuffer = [
            this.st0, this.st1, this.st2,
            cylinder, headAddr, sector, sizeCode
        ];
        this.resultIndex = 0;
        this.phase = this.PHASE_RESULT;
    }

    /**
     * Set result for error cases (no data transferred)
     */
    _setResultNoData(driveNum, head, st0Bits, st1, st2) {
        this.st0 = st0Bits | driveNum | (head << 2);
        this.st1 = st1;
        this.st2 = st2;
        this.resultBuffer = [
            this.st0, this.st1, this.st2,
            this.opCylinder, this.opHead, this.opSector, this.opSizeCode
        ];
        this.resultIndex = 0;
        this.phase = this.PHASE_RESULT;
    }
}
