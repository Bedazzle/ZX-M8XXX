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

(function(global) {
    'use strict';

    // ========== DSKImage ==========
    // In-memory representation of a parsed DSK disk image

    class DSKImage {
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

    class DSKLoader {
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
         * List files from a +3DOS / CP/M directory on a DSK image
         * Reads directory sectors from the first track(s) and parses 32-byte CP/M entries.
         * @param {DSKImage} dskImage
         * @returns {Array} Array of {name, ext, size, user, extents}
         */
        static listFiles(dskImage) {
            // +3DOS uses CP/M-style directory on the first sectors of the disk.
            // Standard +3 geometry: 40 tracks, 1 side, 9 sectors/track, 512 bytes/sector.
            // Directory is in the first 4 allocation blocks (each 1024 bytes = 2 sectors).
            // Sector IDs typically start at 0xC1 (or 0x41 on some disks).
            // Read all sectors from track 0, side 0 to get directory data.

            const track = dskImage.getTrack(0, 0);
            if (!track || track.sectors.length === 0) return [];

            // Collect all directory data from track 0 (up to 2048 bytes for standard +3)
            // Sort sectors by ID to get correct order
            const sortedSectors = [...track.sectors].sort((a, b) => a.id - b.id);

            // Take first 4 sectors for directory (2048 bytes / 512 bytes per sector)
            const dirSectors = sortedSectors.slice(0, Math.min(4, sortedSectors.length));
            const dirData = new Uint8Array(dirSectors.length * 512);
            let pos = 0;
            for (const sec of dirSectors) {
                const len = Math.min(512, sec.data.length);
                dirData.set(sec.data.subarray(0, len), pos);
                pos += 512;
            }

            // Parse CP/M directory entries (32 bytes each)
            const files = new Map();  // filename -> {name, ext, size, user, blockCount}
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
                const bc = dirData[entryBase + 13];  // Byte count in last record (0 = full 128)
                const rc = dirData[entryBase + 15];  // Records used in this extent (128 bytes each)

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
                        totalBlocks: 0
                    });
                }

                const entry = files.get(key);
                entry.totalBlocks += blockCount;

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
                    blocks: entry.totalBlocks
                });
            }

            return result;
        }
    }

    // ========== UPD765 ==========
    // µPD765A Floppy Disk Controller emulation

    class UPD765 {
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
         * Check if any drive has a disk inserted
         * @returns {boolean}
         */
        hasDisk() {
            return this.drives.some(d => d.disk !== null);
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
                this.onDiskActivity('read', this.opCylinder, this.opSector, head);
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
                this.onDiskActivity('read', drive.track, this.opSector, head);
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
                this.onDiskActivity('write', r.physicalTrack, r.sectorStart, r.head);
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
                this.onDiskActivity('write', drive.track, 0, fi.head);
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

    // ========== Exports ==========

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { UPD765, DSKImage, DSKLoader };
    }
    if (typeof global !== 'undefined') {
        global.UPD765 = UPD765;
        global.DSKImage = DSKImage;
        global.DSKLoader = DSKLoader;
    }

})(typeof window !== 'undefined' ? window : this);
