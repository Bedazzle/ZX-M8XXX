/**
 * ZX-M8XXX - Beta Disk (TR-DOS): WD1793 controller, TRD and SCL images
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

import { writeField, xorChecksum, sclChecksum } from './common.js';
import { TRACK_BYTES_MFM, parseTrackStream, buildTrackStream } from './mfm-track.js';
import { createRotationClock } from './disk-rotation.js';

    export class TRDOSTrapHandler {
        constructor(cpu, memory) {
            this.cpu = cpu;
            this.memory = memory;
            this.diskData = null;
            this.diskFiles = null;
            this.diskType = null;
            this.enabled = true;
            this.lastLoadedFile = null;
            this._hasTrdosRom = false;  // Cached flag to avoid hasTrdosRom() loop per instruction
        }

        // Update cached TR-DOS ROM flag - call when TR-DOS ROM is loaded/changed
        updateTrdosRomFlag() {
            this._hasTrdosRom = this.memory.hasTrdosRom ? this.memory.hasTrdosRom() : false;
        }

        setDisk(data, files, type) {
            this.diskData = data;
            this.diskFiles = files;
            this.diskType = type;
        }

        clearDisk() {
            this.diskData = null;
            this.diskFiles = null;
            this.diskType = null;
        }

        setEnabled(enabled) { this.enabled = enabled; }

        // Check for TR-DOS ROM traps
        // Returns true if trap was handled
        // NOTE: When real TR-DOS ROM is loaded, we let it handle everything
        // This trap is only for fallback when no TR-DOS ROM is available
        checkTrap() {
            if (!this.enabled) return false;
            if (!this.diskData) return false;
            // A Beta 48 runs its own TR-DOS 4.x: the 5.x entry points mean nothing
            if (this.memory.beta48On) return false;

            // If TR-DOS ROM is loaded, don't trap - let real TR-DOS handle everything
            // The trap is only useful as a fallback when TR-DOS ROM isn't available
            // Use cached flag to avoid expensive hasTrdosRom() check per instruction
            if (this._hasTrdosRom) {
                return false;
            }

            // Only trigger trap when TR-DOS ROM is paged in (via automatic Beta Disk paging)
            // This prevents false triggers when main ROM is active
            if (this.memory.machineType !== '48k' && !this.memory.trdosActive) {
                return false;
            }
            // …and never while another interface owns the bottom of the map: on a
            // +D or a Didaktik, $3D13 is their RAM, which they execute from. The
            // same mistake on the tape trap's $0556 broke the Opus.
            if (this.memory.plusDActive || this.memory.opusActive ||
                this.memory.if1Active || this.memory.didaktikActive) {
                return false;
            }

            // TR-DOS entry point #3D13 (RANDOMIZE USR 15619)
            // This is called by BASIC when executing TR-DOS commands
            if (this.cpu.pc === 0x3D13) {
                return this.handleTRDOSCommand();
            }

            return false;
        }

        // Handle TR-DOS command from BASIC (RANDOMIZE USR 15619: REM : command)
        handleTRDOSCommand() {
            // Try to parse command from current BASIC line
            // The command is typically after "REM :" or "REM:" in the current line
            const filename = this.parseFilenameFromBasicLine();

            if (filename) {
                // Find file on disk
                const file = this.findFile(filename);
                if (file) {
                    return this.loadFile(file);
                }
            }

            // If we can't parse the command, just return success
            // (some programs just use USR 15619 to enter TR-DOS)
            this.cpu.f |= 0x01;  // Success
            this.returnFromTrap();
            return true;
        }

        // Parse filename from current BASIC line
        // Looks for pattern: REM : LOAD "filename" or similar
        parseFilenameFromBasicLine() {
            // Get current BASIC line address from CH_ADD (0x5C5D) - current position in BASIC
            const chAdd = this.memory.read(0x5C5D) | (this.memory.read(0x5C5E) << 8);

            // Search backwards and forwards from CH_ADD for a quoted filename
            // TR-DOS command format: LOAD "filename" or RUN "filename"
            let searchStart = Math.max(0x5C00, chAdd - 50);
            let searchEnd = Math.min(0xFFFF, chAdd + 100);

            let inQuote = false;
            let filename = '';

            for (let addr = searchStart; addr < searchEnd; addr++) {
                const byte = this.memory.read(addr);

                if (byte === 0x22) {  // Quote character
                    if (inQuote) {
                        // End of filename
                        if (filename.length > 0) {
                            return filename.trim();
                        }
                        filename = '';
                    }
                    inQuote = !inQuote;
                } else if (inQuote && byte >= 0x20 && byte < 0x80) {
                    filename += String.fromCharCode(byte);
                } else if (byte === 0x0D) {  // End of line
                    break;
                }
            }

            return null;
        }

        // Load a file from disk into memory
        loadFile(fileInfo) {
            const Loader = this.diskType === 'trd' ? TRDLoader : SCLLoader;
            const fileData = Loader.extractFile(this.diskData, fileInfo);

            if (fileInfo.type === 'code') {
                // CODE file - load at specified address
                for (let i = 0; i < fileData.length; i++) {
                    this.memory.write(fileInfo.start + i, fileData[i]);
                }
                this.lastLoadedFile = fileInfo;
                this.cpu.f |= 0x01;  // Success
                this.returnFromTrap();
                return true;
            }

            if (fileInfo.type === 'basic') {
                // BASIC program - load into BASIC area
                // Read current PROG address from system variables (usually 0x5CCB = 23755)
                let progAddr = this.memory.read(0x5C53) | (this.memory.read(0x5C54) << 8);
                // Sanity check: PROG should be in RAM (>=0x5CCB and <0xFFFF)
                if (progAddr < 0x5CCB || progAddr > 0xFF00) {
                    progAddr = 0x5CCB;  // Use default PROG address
                }

                // Load BASIC program
                for (let i = 0; i < fileData.length; i++) {
                    this.memory.write(progAddr + i, fileData[i]);
                }

                // VARS points to end of program (start of variables)
                const varsAddr = progAddr + fileData.length;
                // Write end-of-variables marker (0x80)
                this.memory.write(varsAddr, 0x80);
                // E_LINE points after the marker
                const elineAddr = varsAddr + 1;
                // Write end-of-line marker for edit area
                this.memory.write(elineAddr, 0x0D);

                // Update BASIC system variables
                this.memory.write(0x5C4B, varsAddr & 0xFF);          // VARS low
                this.memory.write(0x5C4C, (varsAddr >> 8) & 0xFF);   // VARS high
                this.memory.write(0x5C59, elineAddr & 0xFF);         // E_LINE low
                this.memory.write(0x5C5A, (elineAddr >> 8) & 0xFF);  // E_LINE high

                // Set up autostart if specified (fileInfo.start is line number)
                if (fileInfo.start && fileInfo.start < 10000) {
                    this.memory.write(0x5C42, fileInfo.start & 0xFF);        // NEWPPC low
                    this.memory.write(0x5C43, (fileInfo.start >> 8) & 0xFF); // NEWPPC high
                    this.memory.write(0x5C44, 0x00);  // NSPPC = 0 triggers jump to NEWPPC
                }

                this.lastLoadedFile = fileInfo;
                this.cpu.f |= 0x01;  // Success
                this.returnFromTrap();
                return true;
            }

            // Unknown type - fail
            this.cpu.f &= ~0x01;
            this.returnFromTrap();
            return true;
        }

        // Find file by name (for LOAD "filename" operations)
        findFile(name) {
            if (!this.diskFiles) return null;
            const searchName = name.toLowerCase().trim();
            return this.diskFiles.find(f =>
                f.name.toLowerCase().trim() === searchName ||
                f.fullName.toLowerCase().trim() === searchName
            );
        }

        returnFromTrap() {
            const retAddr = this.memory.read(this.cpu.sp) | (this.memory.read(this.cpu.sp + 1) << 8);
            this.cpu.sp = (this.cpu.sp + 2) & 0xffff;
            this.cpu.pc = retAddr;
        }
    }

    /**
     * Beta Disk Interface emulation (WD1793 floppy controller)
     * Used by TR-DOS ROM for disk operations
     *
     * Ports:
     *   #1F - Command/Status register
     *   #3F - Track register
     *   #5F - Sector register
     *   #7F - Data register
     *   #FF - System register (active drive, side, etc.)
     */
    export class BetaDisk {
        // How many times the host may look at the controller after opening a
        // Write Track, without having written a single byte to it, before the
        // track is counted as lost. See _formatPoll().
        static get FORMAT_POLL_LIMIT() { return 4096; }

        constructor() {
            // Per-drive state: each drive has its own disk image and head position
            // WD1793 is a single controller — track/sector/side registers are shared
            // `trackImage` is the optional track-level view (from a UDI): the raw
            // track bytes and the sector records decoded out of them. When a drive
            // has one the controller reads from it instead of from `diskData`,
            // which stays as the flattened image the catalogue and project save use.
            this.drives = [
                { diskData: null, diskType: null, headTrack: 0, trackImage: null, addrIndex: 0 },
                { diskData: null, diskType: null, headTrack: 0, trackImage: null, addrIndex: 0 },
                { diskData: null, diskType: null, headTrack: 0, trackImage: null, addrIndex: 0 },
                { diskData: null, diskType: null, headTrack: 0, trackImage: null, addrIndex: 0 },
            ];

            // WD1793 registers
            this.command = 0;
            this.status = 0;
            this.track = 0;
            this.sector = 1;           // Sectors are 1-based in TR-DOS
            this.data = 0;

            // Disk activity callback: function(type, track, sector, side, drive)
            // type: 'read', 'write', 'seek', 'idle'
            this.onDiskActivity = null;

            // System register (#FF)
            this.system = 0x3F;        // Initial state: no disk, motor off
            this.drive = 0;            // Current drive (0-3)
            this.side = 0;             // Current side (0-1)

            // Disk geometry (standard TRD)
            this.sectorsPerTrack = 16;
            this.bytesPerSector = 256;
            this.tracks = 80;
            this.sides = 2;

            // Data transfer state
            this.dataBuffer = null;
            this.dataPos = 0;
            this.dataLen = 0;
            this.reading = false;
            this.writing = false;
            // A Write Track in progress. Not the same as `writing`: the stream is
            // a whole track, so the end of the buffer means "format finished",
            // not "step to the next sector".
            this.formatting = false;
            // The earliest a DRQ for this transfer may be delivered, or 0 for
            // "no floor". A Write Track waits for the index pulse before it
            // writes anything, so the byte stream must not start before then
            // either; `Spectrum._drqDueAt` reads this. A controller with no
            // machine around it has no DRQ pacing and simply ignores it.
            this.drqNotBefore = 0;
            // What the last Write Track laid down — see finishWriteTrack().
            this.lastFormat = null;

            // Index pulse. With a rotation clock it is the real thing, computed
            // from where the disk has got to; `indexCounter` is the fallback for
            // a controller with no machine attached, which fakes one pulse every
            // sixteenth status read so that a presence check still terminates.
            this.rotation = null;
            this.indexCounter = 0;

            // Track last command type for status bit interpretation
            this.lastCmdType = 0;  // 1=Type I, 2=Type II/III

            // Status bits
            this.BUSY = 0x01;
            this.INDEX = 0x02;         // Type I: index pulse / Type II-III: DRQ
            this.DRQ = 0x02;           // Data request
            this.TRACK0 = 0x04;        // Type I: track 0
            this.LOST_DATA = 0x04;     // Type II-III: lost data
            this.CRC_ERROR = 0x08;
            this.SEEK_ERROR = 0x10;    // Type I: seek error
            this.RNF = 0x10;           // Type II-III: record not found
            this.HEAD_LOADED = 0x20;   // Type I
            this.RECORD_TYPE = 0x20;   // Type II-III: deleted data mark
            this.WRITE_PROTECT = 0x40;
            this.NOT_READY = 0x80;

            this.intrq = false;        // Interrupt request
            this.multiSector = false;  // Multi-sector flag (m bit in Type II commands)
        }

        /**
         * Give the controller the disk's own clock: a monotonic T-state count
         * and the length of one revolution, both read live so that a machine
         * change is picked up. Nothing in a controller can know what machine it
         * is in, so this is injected — `Spectrum` does it once per interface.
         *
         * Without it the controller keeps its untimed behaviour: a faked index
         * pulse and a Write Track ended by counting register reads. That is the
         * state every unit test which constructs a bare controller runs in, and
         * it stays supported on purpose — a controller with no machine around it
         * has no business inventing a rotation it cannot see.
         */
        setRotationClock(nowFn, revFn) {
            this.rotation = createRotationClock(nowFn, revFn);
        }

        // Load disk image into specified drive (default: drive 0)
        loadDisk(data, type, driveIndex = 0) {
            const drv = this.drives[driveIndex & 0x03];
            if (type === 'scl') {
                // Convert SCL to TRD format
                drv.diskData = this.sclToTrd(data);
            } else {
                drv.diskData = new Uint8Array(data);
            }
            drv.diskType = 'trd';
            drv.headTrack = 0;
            // A plain image replaces any track-level view the drive was holding.
            drv.trackImage = null;
            drv.addrIndex = 0;
            drv.addrSlot = -1;
            drv.modified = false;
            // Reset WD1793 state only if loading into current drive
            if ((driveIndex & 0x03) === this.drive) {
                this.status = 0;           // Disk ready
                this.track = 0;
                this.sector = 1;
            }
        }

        // Convenience getter for current drive's state
        get currentDisk() {
            return this.drives[this.drive];
        }

        /**
         * Give a drive the track-level view of the disk already loaded into it.
         * Call AFTER loadDisk(), which clears it.
         */
        attachTrackImage(trackImage, driveIndex = 0) {
            const drv = this.drives[driveIndex & 0x03];
            drv.trackImage = trackImage || null;
            drv.addrIndex = 0;
            drv.addrSlot = -1;
        }

        /** The track record under the head, or null when there is no track image. */
        _trackAt(cylinder, side) {
            const ti = this.currentDisk.trackImage;
            if (!ti) return null;
            const idx = cylinder * ti.sides + (ti.sides > 1 ? (side & 1) : 0);
            return ti.tracks[idx] || null;
        }

        /**
         * The sector the WD1793 would find: one whose ID field carries BOTH the
         * sector number asked for and the cylinder in the track register.
         *
         * The cylinder comparison is not pedantry -- it is the oldest protection
         * there is. A track formatted with ID fields claiming some other cylinder
         * reads back as RECORD NOT FOUND unless the loader knows to lie to the
         * track register, which is exactly what the check is testing for. A
         * flattened image cannot fail that way, so it always "passed".
         *
         * The HEAD field is deliberately NOT compared: side compare is off in the
         * commands TR-DOS issues, and three of the five sample images write head=0
         * in every ID field on both sides, so comparing it would break real disks.
         */
        _findSectorRecord(track, side, sector) {
            const t = this._trackAt(track, side);
            if (!t) return null;
            for (const r of t.sectors) {
                if (r.sector === sector && r.cylinder === track && r.data) return r;
            }
            return null;
        }

        // Create and insert a blank formatted TRD disk into specified drive
        createBlankDisk(label = 'BLANK', driveIndex = 0) {
            // Create blank TRD image (640KB = 2560 sectors)
            const trd = new Uint8Array(655360);
            trd.fill(0);

            // Set up disk info sector (sector 9 of track 0, offset 0x800)
            const sector9 = 8 * 256;

            // First free position: track 1, sector 0 (after directory)
            trd[sector9 + 0xE1] = 0;     // First free sector (0)
            trd[sector9 + 0xE2] = 1;     // First free track (1)
            trd[sector9 + 0xE3] = 0x16;  // Disk type (80 tracks, double-sided)
            trd[sector9 + 0xE4] = 0;     // File count (0 = empty)
            // Free sectors: 2560 (total) - 16 (track 0) = 2544
            trd[sector9 + 0xE5] = 0xF0;  // Free sectors low (2544 & 0xFF)
            trd[sector9 + 0xE6] = 0x09;  // Free sectors high (2544 >> 8)
            trd[sector9 + 0xE7] = 0x10;  // TR-DOS ID

            // Disk label at 0xF5-0xFC (8 bytes, space-padded)
            writeField(trd, sector9 + 0xF5, label, 8, 0x20);

            // Load the blank disk into specified drive
            const drv = this.drives[driveIndex & 0x03];
            drv.diskData = trd;
            drv.diskType = 'trd';
            drv.headTrack = 0;
            // As loadDisk does: a new image replaces any track-level view the
            // drive was holding (a blank disk made in a drive that held a UDI
            // was still being read from the UDI's tracks), and a disk that has
            // just been made has not been written to.
            drv.trackImage = null;
            drv.addrIndex = 0;
            drv.addrSlot = -1;
            drv.modified = false;
            if ((driveIndex & 0x03) === this.drive) {
                this.status = 0;
                this.track = 0;
                this.sector = 1;
            }

            return true;
        }

        // Convert SCL to TRD format
        sclToTrd(sclData) {
            const scl = new Uint8Array(sclData);

            // Check SCL signature
            const sig = String.fromCharCode(...scl.slice(0, 8));
            if (sig !== 'SINCLAIR') {
                throw new Error('Invalid SCL signature');
            }

            // Create blank TRD image (640KB = 2560 sectors)
            const trd = new Uint8Array(655360);
            trd.fill(0);

            const fileCount = scl[8];

            // SCL format: signature(8) + count(1) + ALL headers(14*n) + ALL data
            // First pass: read all directory entries
            const files = [];
            let headerOffset = 9;  // After signature + file count
            for (let i = 0; i < fileCount && i < 128; i++) {
                const file = {
                    name: scl.slice(headerOffset, headerOffset + 8),
                    type: scl[headerOffset + 8],
                    start: scl[headerOffset + 9] | (scl[headerOffset + 10] << 8),
                    length: scl[headerOffset + 11] | (scl[headerOffset + 12] << 8),
                    sectorCount: scl[headerOffset + 13]
                };
                files.push(file);
                headerOffset += 14;
            }

            // File data starts after all headers
            let dataOffset = headerOffset;

            // First free data sector on TRD - start at logical track 1, sector 0
            // TR-DOS uses logical tracks 0-159 (each side is a separate logical track)
            // Track 0 = directory/system (physical track 0, side 0)
            // Track 1 = first data track (physical track 0, side 1)
            // Each logical track has 16 sectors (0-15)
            let trdSector = 16;  // = track 1 * 16 sectors + sector 0

            // Second pass: write TRD directory entries and copy file data
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const nameStr = String.fromCharCode(...file.name).trim();

                // Write TRD directory entry (16 bytes at track 0)
                const dirOffset = i * 16;
                trd.set(file.name, dirOffset);           // Filename (8 bytes)
                trd[dirOffset + 8] = file.type;          // File type
                trd[dirOffset + 9] = file.start & 0xFF;  // Start address low
                trd[dirOffset + 10] = (file.start >> 8) & 0xFF;
                trd[dirOffset + 11] = file.length & 0xFF; // Length low
                trd[dirOffset + 12] = (file.length >> 8) & 0xFF;
                trd[dirOffset + 13] = file.sectorCount;  // Sector count

                // Convert linear sector to logical track/sector for directory
                // TR-DOS uses logical tracks 0-159 (160 total: 80 physical tracks × 2 sides)
                // Sectors are 0-based (0-15) in directory entries
                const logTrack = Math.floor(trdSector / 16);  // 16 sectors per logical track
                const logSector = trdSector % 16;  // Sector 0-15

                trd[dirOffset + 14] = logSector;   // First sector (0-15)
                trd[dirOffset + 15] = logTrack;    // First logical track (0-159)

                // Copy file data from SCL to TRD
                // TRD uses interleaved format: linear sector number maps directly to byte offset
                const fileSize = file.sectorCount * 256;

                // Verify source data bounds
                if (dataOffset + fileSize > scl.length) {
                    console.error(`[SCL] ERROR: File "${nameStr}" data extends past SCL end! dataOffset=${dataOffset} fileSize=${fileSize} sclLen=${scl.length}`);
                }

                // In interleaved TRD, byte offset = linear sector * 256
                const trdDataOffset = trdSector * 256;
                trd.set(scl.slice(dataOffset, dataOffset + fileSize), trdDataOffset);

                dataOffset += fileSize;
                trdSector += file.sectorCount;
            }

            // Set up disk info sector (sector 9 of track 0)
            // Sector 9 starts at offset 8 * 256 = 2048
            const sector9 = 8 * 256;

            // Fill sector 9 with standard TR-DOS values
            // First free position: sector (0-15), logical track (0-159)
            const freeSector = trdSector % 16;                 // Sector 0-15
            const freeTrack = Math.floor(trdSector / 16);      // Logical track 0-159
            trd[sector9 + 0xE1] = freeSector;
            trd[sector9 + 0xE2] = freeTrack;
            trd[sector9 + 0xE3] = 0x16;       // Disk type (80 tracks, DS)
            trd[sector9 + 0xE4] = files.length;   // File count
            const freeSectors = 2560 - trdSector;
            trd[sector9 + 0xE5] = freeSectors & 0xFF;
            trd[sector9 + 0xE6] = (freeSectors >> 8) & 0xFF;
            trd[sector9 + 0xE7] = 0x10;       // TR-DOS ID

            // Disk label at 0xF5-0xFC (8 bytes, space-padded)
            const label = "        ";  // 8 spaces
            for (let i = 0; i < 8; i++) {
                trd[sector9 + 0xF5 + i] = label.charCodeAt(i);
            }

            return trd;
        }

        // Convert TRD back to SCL format (inverse of sclToTrd).
        // The first 14 bytes of a TRD directory entry (name 8, type 1, start 2,
        // length 2, sector count 1) have the same layout as an SCL header.
        // Deleted entries (first byte 0x01) are skipped: TR-DOS erase only marks
        // the entry and overwrites the name's first character, so including them
        // would resurrect files with corrupt names. End marker 0x00 stops the scan.
        trdToScl(trdData) {
            const trd = new Uint8Array(trdData);

            // Scan directory: track 0, sectors 0-7, 128 entries of 16 bytes
            const files = [];
            for (let i = 0; i < 128; i++) {
                const off = i * 16;
                if (off + 16 > trd.length) break;
                const firstByte = trd[off];
                if (firstByte === 0x00) break;     // End of directory
                if (firstByte === 0x01) continue;  // Deleted file — never include
                const sectorCount = trd[off + 13];
                const startSector = trd[off + 14];
                const startTrack = trd[off + 15];
                files.push({
                    header: trd.slice(off, off + 14),
                    dataOffset: (startTrack * 16 + startSector) * 256,
                    dataSize: sectorCount * 256
                });
            }

            let totalData = 0;
            for (const f of files) totalData += f.dataSize;

            // signature(8) + count(1) + headers(14*n) + data + checksum(4)
            const scl = new Uint8Array(9 + files.length * 14 + totalData + 4);
            const sig = 'SINCLAIR';
            for (let i = 0; i < 8; i++) scl[i] = sig.charCodeAt(i);
            scl[8] = files.length;

            let offset = 9;
            for (const f of files) {
                scl.set(f.header, offset);
                offset += 14;
            }
            for (const f of files) {
                const end = Math.min(f.dataOffset + f.dataSize, trd.length);
                if (f.dataOffset < end) {
                    scl.set(trd.subarray(f.dataOffset, end), offset);
                }
                offset += f.dataSize;  // Short reads stay zero-padded
            }

            // Trailing 32-bit little-endian checksum over all preceding bytes
            const sum = sclChecksum(scl, offset);
            scl[offset] = sum & 0xFF;
            scl[offset + 1] = (sum >> 8) & 0xFF;
            scl[offset + 2] = (sum >> 16) & 0xFF;
            scl[offset + 3] = (sum >>> 24) & 0xFF;

            return scl;
        }

        ejectDisk(driveIndex) {
            if (driveIndex !== undefined) {
                const drv = this.drives[driveIndex & 0x03];
                drv.diskData = null;
                drv.diskType = null;
                drv.headTrack = 0;
            } else {
                // Eject current drive
                const drv = this.currentDisk;
                drv.diskData = null;
                drv.diskType = null;
                drv.headTrack = 0;
            }
            this.status = this.NOT_READY;
        }

        hasDisk(driveIndex) {
            if (driveIndex !== undefined) {
                return this.drives[driveIndex & 0x03].diskData !== null;
            }
            // Check current drive (backward compat)
            return this.currentDisk.diskData !== null;
        }

        // Check if any drive has a disk inserted
        hasAnyDisk() {
            return this.drives.some(d => d.diskData !== null);
        }

        // Calculate sector offset in disk image
        getSectorOffset(track, side, sector) {
            // TRD layout: interleaved (track 0 side 0, track 0 side 1, track 1 side 0, ...)
            // Each track-side has 16 sectors of 256 bytes = 4096 bytes
            const logicalTrack = track * 2 + side;
            // WD1793 sectors are 1-16, convert to 0-based index
            const sectorIndex = (logicalTrack * this.sectorsPerTrack) + (sector - 1);
            // Sector range is 1-16 on TRD
            return sectorIndex * this.bytesPerSector;
        }

        // Port read
        read(port) {
            const reg = port & 0xFF;

            switch (reg) {
                case 0x1F: // Status register
                    // Note: on real WD1793, reading status clears INTRQ.
                    // But in our instant-completion model, clearing here causes
                    // TR-DOS to miss INTRQ when it reads status (error check)
                    // before polling port $FF. INTRQ is already cleared when
                    // a new command is issued (executeCommand), which is sufficient.
                    // ...but the line itself, as lines() shows it, does drop
                    if (this.intrq) this._intrqAcked = true;
                    if (!this.currentDisk.diskData) {
                        return this.NOT_READY;
                    }
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
                    // TRACK0 only applies to Type I commands
                    // For Type II/III, bit 2 is LOST_DATA (which should be 0 on success)
                    if (this.lastCmdType === 1 && this.track === 0) {
                        st |= this.TRACK0;
                    }
                    // INDEX - ONLY for Type I commands! For Type II/III, bit 1 is
                    // DRQ (already handled above). With a rotation clock this is
                    // the real pulse: 1.5 ms of each 200 ms revolution, asserted
                    // when the hole is actually under the sensor, so a ROM that
                    // times a revolution by it gets 200 ms. Without one, the old
                    // fake: one read in sixteen.
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

                case 0x3F: // Track register
                    return this.track;

                case 0x5F: // Sector register
                    return this.sector;

                case 0x7F: // Data register
                    if (this.reading && this.dataBuffer && this.dataPos < this.dataLen) {
                        this._sysReadsSinceData = 0;  // Reset lost data counter
                        this.data = this.dataBuffer[this.dataPos++];
                        if (this.dataPos >= this.dataLen) {
                            if (this.multiSector) {
                                // Multi-sector: advance to next sector and continue reading
                                this.sector++;
                                if (this.sector > this.sectorsPerTrack) {
                                    // Past last sector on this side — stop
                                    this.reading = false;
                                    this.multiSector = false;
                                    this.status &= ~(this.BUSY | this.DRQ);
                                    this.intrq = true;
                                } else {
                                    // Read next sector
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

                case 0xFF: // System register
                    // Lost Data simulation: On real WD1793, data bytes arrive at the
                    // disk rotation rate. If the CPU polls the system register instead
                    // of reading data from port $7F, bytes are "lost" and the sector
                    // eventually completes with INTRQ. In our instant-completion model,
                    // we detect this by tracking consecutive system register polls
                    // without any port $7F data reads. After enough polls without data
                    // reads, we auto-complete the sector. This handles games/loaders
                    // that issue Read Sector and only poll for INTRQ.
                    if (this.reading && this.dataBuffer && this.dataPos < this.dataLen) {
                        this._sysReadsSinceData = (this._sysReadsSinceData || 0) + 1;
                        // After 2+ consecutive system register reads without a data read,
                        // treat remaining bytes as lost and complete the sector.
                        // The threshold of 2 allows the normal read loop pattern
                        // (check $FF → read $7F → check $FF) to work correctly,
                        // while catching loops that only poll $FF without reading $7F.
                        if (this._sysReadsSinceData >= 2) {
                            // Complete current sector (lost data)
                            this.dataPos = this.dataLen;
                            this.status |= this.LOST_DATA;
                            if (this.multiSector) {
                                this.sector++;
                                if (this.sector > this.sectorsPerTrack) {
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
                    this._formatPoll();
                    let sys = 0;
                    if (this.intrq) sys |= 0x80;        // INTRQ
                    // This is the DRQ TR-DOS actually polls -- it reads $FF, not
                    // the status register -- so the byte pacing has to be here as
                    // well. The medium gives a byte 111.8 T-states; TR-DOS's feed
                    // loop comes round every 56.5, so without this it writes a
                    // whole track in half a revolution.
                    const notDue = this.formatting && this.rotation &&
                        this.rotation.now() < this._fmtByteDue;
                    if ((this.reading || this.writing) && !notDue) sys |= 0x40;  // DRQ
                    return sys;

                default:
                    return 0xFF;
            }
        }

        /**
         * The INTRQ and DRQ lines as bits 7 and 6, read without touching
         * anything (no lost-data counting, unlike the system register). INTRQ
         * drops once the status register has been read, as on the WD1793 —
         * TR-DOS always reads it after a command, so after a load the line is
         * low. The Scorpion wires both lines into its Kempston port (#1F with
         * the DOS off), where a game reads them along with the stick.
         */
        lines() {
            let v = (this.intrq && !this._intrqAcked) ? 0x80 : 0;
            const notDue = this.formatting && this.rotation &&
                this.rotation.now() < this._fmtByteDue;
            if ((this.reading || this.writing) && !notDue) v |= 0x40;
            return v;
        }

        // Port write
        write(port, value) {
            const reg = port & 0xFF;

            switch (reg) {
                case 0x1F: // Command register
                    this.executeCommand(value);
                    break;

                case 0x3F: // Track register
                    this.track = value;
                    break;

                case 0x5F: // Sector register
                    this.sector = value;
                    break;

                case 0x7F: // Data register
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
                            // Write buffer to disk
                            this.flushWriteBuffer();
                            if (this.multiSector) {
                                // Multi-sector: advance to next sector and continue writing
                                this.sector++;
                                if (this.sector > this.sectorsPerTrack) {
                                    this.writing = false;
                                    this.multiSector = false;
                                    // Clear DRQ along with BUSY: TR-DOS checks the final
                                    // status with AND 7Fh — a leftover DRQ bit reads as
                                    // a failed write ("Disc error")
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

                case 0xFF: // System register
                    this.system = value;
                    this.drive = value & 0x03;
                    // Side bit is active-low: bit 4 = 1 means side 0, bit 4 = 0 means side 1
                    this.side = (value & 0x10) ? 0 : 1;
                    // Bit 0x04 = reset (active low)
                    if (!(value & 0x04)) {
                        this.reset();
                    }
                    break;
            }
        }

        reset() {
            this.command = 0;
            this.status = 0;
            this.track = 0;
            this.sector = 1;
            this.reading = false;
            this.writing = false;
            this.formatting = false;
            this.drqNotBefore = 0;
            this.dataBuffer = null;
            this.intrq = false;
            this._intrqAcked = false;
        }

        executeCommand(cmd) {
            // A Write Track ends at the index pulse, 200 ms after it started —
            // the chip does not wait for a host that stopped feeding it. Nothing
            // here models rotation, so the next command IS that deadline:
            // whatever was streamed is committed and the format is over. Without
            // this a ROM that issues Write Track and then changes its mind leaves
            // the controller waiting for 6250 bytes that never come, with
            // `writing` still set, and every later transfer goes wrong.
            if (this.formatting) this.finishWriteTrack();
            this.command = cmd;
            this.status = 0;
            this.intrq = false;
            this._intrqAcked = false;
            this._sysReadsSinceData = 0;  // Reset lost data counter for new command

            if (!this.currentDisk.diskData) {
                this.status = this.NOT_READY;
                this.intrq = true;
                return;
            }

            const cmdType = cmd >> 4;

            // Type I commands (restore, seek, step)
            // Update both WD1793 track register AND per-drive headTrack
            if ((cmd & 0x80) === 0) {
                this.lastCmdType = 1;
                this.status |= this.BUSY;

                if ((cmd & 0xF0) === 0x00) {
                    // Restore (seek to track 0)
                    this.track = 0;
                    this.currentDisk.headTrack = 0;
                    this.status |= this.TRACK0;
                } else if ((cmd & 0xF0) === 0x10) {
                    // Seek to track in data register
                    this.track = this.data;
                    this.currentDisk.headTrack = this.data;
                    if (this.track === 0) this.status |= this.TRACK0;
                } else if ((cmd & 0xE0) === 0x20) {
                    // Step (keep direction)
                    // Not commonly used, skip for now
                } else if ((cmd & 0xE0) === 0x40) {
                    // Step in
                    if (this.track < 79) this.track++;
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
                this.multiSector = !!(cmd & 0x10);  // Bit 4 = multiple sectors
                this.status = this.BUSY;  // Clear all status bits except BUSY (no HEAD_LOADED for Type II)

                if ((cmd & 0x20) === 0) {
                    // Read sector
                    this.readSector();
                } else {
                    // Write sector
                    this.writeSector();
                }
                return;
            }

            // Type IV command (force interrupt) - check BEFORE Type III!
            if ((cmd & 0xF0) === 0xD0) {
                // Don't change lastCmdType - Force Interrupt preserves previous type
                // A formatter that stops short does so here: the index pulse ends
                // a Write Track on real hardware, and a ROM counting bytes will
                // not reach a full track's worth. What it did write is still a
                // formatted track, so commit before the state is torn down.
                if (this.formatting) this.finishWriteTrack();
                this.reading = false;
                this.writing = false;
                this.multiSector = false;
                this.status &= ~this.BUSY;
                this.status |= this.HEAD_LOADED;  // Head stays loaded
                if (this.track === 0) this.status |= this.TRACK0;
                if (cmd & 0x08) this.intrq = true;  // Immediate interrupt
                return;
            }

            // Type III commands (read/write track, read address)
            if ((cmd & 0xC0) === 0xC0) {
                this.lastCmdType = 2;
                if ((cmd & 0xF0) === 0xC0) {
                    // READ ADDRESS: hand back the next ID field to come under the
                    // head. With a track image these are the disk's real IDs, taken
                    // in order and wrapping, so a loader enumerating a track sees
                    // what was actually formatted -- the sector numbering, the size
                    // codes, a bad ID CRC. Without one there is nothing to report
                    // but the registers, which is the old fabricated answer.
                    const trk = this._trackAt(this.track, this.side);
                    if (trk && trk.sectors.length) {
                        const drv = this.currentDisk;
                        // Which ID to report. **Reading one costs the time to
                        // reach it**: the command waits for the next ID field to
                        // come round, so on real hardware two Read Addresses in a
                        // row report consecutive sectors rather than the same one
                        // twice. Commands here complete instantly, so the head is
                        // kept MONOTONE instead, in absolute slots rather than
                        // modulo a revolution: a command takes the next slot after
                        // the one it last reported, or wherever the disk has since
                        // turned to, whichever is further on. Never one the disk
                        // has passed. With no clock it is plain round robin, so a
                        // loader can still enumerate a track.
                        const n = trk.sectors.length;
                        let idx;
                        if (this.rotation) {
                            const abs = Math.max(this.rotation.absoluteSlot(n),
                                                 (drv.addrSlot ?? -1) + 1);
                            drv.addrSlot = abs;
                            idx = ((abs % n) + n) % n;
                        } else {
                            idx = drv.addrIndex % n;
                        }
                        const r = trk.sectors[idx];
                        drv.addrIndex = (idx + 1) % n;
                        this.dataBuffer = new Uint8Array([
                            r.cylinder, r.head, r.sector, r.sizeCode,
                            (r.idCrc >> 8) & 0xFF, r.idCrc & 0xFF
                        ]);
                        // The datasheet is explicit: the ID's track address is also
                        // loaded into the sector register. Protections rely on it.
                        this.sector = r.cylinder;
                        if (!r.idCrcOk) this.status |= this.CRC_ERROR;
                    } else {
                        this.dataBuffer = new Uint8Array([
                            this.currentDisk.headTrack, this.side, this.sector, 1, 0, 0
                        ]);
                    }
                    this.dataPos = 0;
                    this.dataLen = 6;
                    this.reading = true;
                    this.status |= this.BUSY | this.DRQ;
                } else if ((cmd & 0xF0) === 0xE0) {
                    // READ TRACK: every byte between index pulses, gaps and address
                    // marks included. A UDI is the only image here that HAS them.
                    const rt = this._trackAt(this.track, this.side);
                    if (rt && rt.raw && rt.raw.length) {
                        this.dataBuffer = rt.raw;
                        this.dataPos = 0;
                        this.dataLen = rt.raw.length;
                        this.reading = true;
                        this.status |= this.BUSY | this.DRQ;
                    } else {
                        // A flat .trd has no gaps, marks or CRCs in it, so the
                        // track is built from the geometry and what is in the
                        // sectors. See readTrackFromImage().
                        this.readTrackFromImage();
                    }
                } else if ((cmd & 0xF0) === 0xF0) {
                    this.writeTrack();
                }
                return;
            }
        }

        readSector() {
            if (this.currentDisk.trackImage) return this._readSectorFromTrack();

            const drv = this.currentDisk;
            const offset = this.getSectorOffset(this.track, this.side, this.sector);

            // Notify disk activity (include drive number)
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

        /**
         * Read a sector out of the raw track bytes.
         *
         * Everything a flattened image had to throw away is reported here: a
         * sector that is not on the track at all gives RECORD NOT FOUND instead of
         * whatever bytes happened to sit at that offset, a 512-byte sector
         * transfers 512 bytes, a deleted-data mark sets the record-type bit, and a
         * sector whose data CRC is wrong says so.
         *
         * One deliberate deviation from the datasheet: a real WD1793 raises CRC
         * ERROR at the END of the sector, as the CRC bytes go past the head. It is
         * set here at the start instead, because the controller completes the
         * transfer instantly rather than at rotation speed, so there is no "end"
         * to hang it on. A loader that reads the status mid-transfer therefore
         * sees the error early; one that checks after the transfer -- which is
         * what they all do -- sees exactly what the hardware would give it.
         */
        _readSectorFromTrack() {
            const rec = this._findSectorRecord(this.track, this.side, this.sector);

            if (this.onDiskActivity) {
                this.onDiskActivity('read', this.track, this.sector, this.side, this.drive);
            }

            if (!rec) {
                this.reading = false;
                this.status = (this.status & ~(this.BUSY | this.DRQ)) | this.RNF;
                this.intrq = true;
                return;
            }

            this.dataBuffer = rec.data;
            this.dataPos = 0;
            this.dataLen = rec.length;
            this.reading = true;
            this.status |= this.DRQ | this.BUSY;
            if (rec.deleted) this.status |= this.RECORD_TYPE;
            if (rec.dataCrcOk === false) this.status |= this.CRC_ERROR;
        }

        writeSector() {
            // A track image is read-only: there is no UDI writer, and one could not
            // be built from a sector write anyway -- the gaps, marks and CRCs that
            // make the track what it is are not reconstructible from 256 bytes. Say
            // write protected, which is a thing TR-DOS and every loader understands,
            // rather than accepting a write that goes nowhere.
            if (this.currentDisk.trackImage) {
                this.writing = false;
                this.status = (this.status & ~(this.BUSY | this.DRQ)) | this.WRITE_PROTECT;
                this.intrq = true;
                return;
            }

            const drv = this.currentDisk;
            const offset = this.getSectorOffset(this.track, this.side, this.sector);

            // Notify disk activity (include drive number)
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

        /**
         * READ TRACK off a flat image: there are no gaps, marks or CRCs in a
         * sector dump, so the track is built from the geometry and the sectors'
         * contents, with real `A1` marks and real CRCs — Read Track reads the
         * medium, so it reports what would be on it. Two things an image like
         * this cannot say: the interleave (the sectors are reported in ascending
         * order, which is the only order it records) and the real gap lengths,
         * which get the IBM System 34 defaults. A UDI has the actual bytes and is
         * handled before this is reached.
         */
        readTrackFromImage() {
            const drv = this.currentDisk;
            const sectors = [];
            for (let i = 0; i < this.sectorsPerTrack; i++) {
                const id = i + 1;        // TR-DOS numbers sectors from 1
                const off = this.getSectorOffset(this.track, this.side, id);
                if (off < 0 || off + this.bytesPerSector > drv.diskData.length) break;
                sectors.push({
                    cylinder: this.track, head: this.side, sector: id,
                    sizeCode: 1,         // 256-byte sectors
                    data: drv.diskData.subarray(off, off + this.bytesPerSector),
                });
            }
            if (!sectors.length) {
                this.status = this.RNF;
                this.intrq = true;
                return;
            }
            if (this.onDiskActivity) {
                this.onDiskActivity('read', this.track, -1, this.side, this.drive);
            }
            this.dataBuffer = buildTrackStream({
                cylinder: this.track, head: this.side, sectors, marks: 'medium',
            });
            this.dataPos = 0;
            this.dataLen = this.dataBuffer.length;
            this.reading = true;
            this.status |= this.BUSY | this.DRQ;
        }

        /**
         * WRITE TRACK: the format command, and the only way a disk is made.
         * There is no "format a sector" — the host streams a whole track at the
         * chip and the chip writes it between index pulses. TR-DOS `FORMAT`
         * cannot work without this.
         */
        writeTrack() {
            // A track image is read-only for the same reason a sector write is:
            // there is no UDI writer, and the gaps, marks and CRCs that make the
            // track what it is would be thrown away.
            if (this.currentDisk.trackImage) {
                this.status = this.WRITE_PROTECT;
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
         * for an INTRQ without feeding anything is relying on exactly that.
         *
         * **TR-DOS 5.03 does it on every SAVE**: it writes `$F8` to the command
         * register from its entry stub at `$3D9C` and then polls `$FF` for an
         * interrupt, feeding nothing. While Write Track was an unimplemented
         * no-op that cost nothing; implementing it hung every TR-DOS save until
         * a deadline put the interrupt back.
         *
         * With a rotation clock the deadline is the real one: a revolution of
         * silence. Measured from the **last byte**, not from the command, because
         * a feed that is still arriving has not missed its index — the medium
         * under the head is being written, and the track ends when the buffer
         * fills. A ROM mid-format never pauses for anything like a revolution
         * (the slowest here goes ~130 T between bytes against the 698880 of a
         * revolution), so this cannot cut a real format short, while a track
         * abandoned half way is still closed and committed.
         *
         * Without a clock, the old stand-in: count register reads and give up
         * after `FORMAT_POLL_LIMIT` of them with nothing fed at all. The gate on
         * `dataPos` matters there — a limit on the gap *between* bytes aborted
         * MDOS's format at track 2, because it polls far past 4096 times before
         * its first byte arrives.
         *
         * Lost data is the honest status either way: the index came round before
         * the host had finished. The read paths end a stalled transfer the same
         * way and for the same reason.
         */
        _formatPoll() {
            if (!this.formatting) return;
            if (this.rotation) {
                if (this.rotation.revolutionsSince(this._fmtLastByte) < 1) return;
            } else {
                if (this.dataPos > 0) return;
                if (++this._fmtPolls < BetaDisk.FORMAT_POLL_LIMIT) return;
            }
            this.finishWriteTrack();
            this.status |= this.LOST_DATA;
        }

        /**
         * The stream is over, either because the track filled or because a Force
         * Interrupt cut it short. Whatever sectors it laid down go into the
         * image, at the track the HEAD is over — Write Track compares nothing, so
         * the cylinder byte in each ID is just more data. On a real disk the two
         * can disagree, which is half of how copy protection works, but a flat
         * dump has nowhere to put a track whose IDs claim to be elsewhere, so one
         * that does is counted as skipped rather than filed under what it claims.
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

            let written = 0, skipped = 0;
            for (const s of sectors) {
                if (s.sizeCode !== 1 || s.cylinder !== (this.track & 0xFF) ||
                    s.sector < 1 || s.sector > this.sectorsPerTrack) {
                    skipped++;
                    continue;
                }
                const off = this.getSectorOffset(this.track, this.side, s.sector);
                if (off < 0 || !drv.diskData ||
                    off + this.bytesPerSector > drv.diskData.length) {
                    skipped++;
                    continue;
                }
                drv.diskData.set(s.data.subarray(0, this.bytesPerSector), off);
                written++;
            }
            if (written) drv.modified = true;

            // What a format did is worth being able to ask about: a DOS that
            // reports a disk error after formatting has usually written a
            // geometry the image cannot hold, and the counts say so at once.
            this.lastFormat = {
                track: this.track, side: this.side, drive: this.drive,
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
                this.onDiskActivity('write', this.track, -1, this.side, this.drive);
            }
        }

        flushWriteBuffer() {
            if (this.writeOffset !== undefined && this.dataBuffer) {
                this.currentDisk.diskData.set(this.dataBuffer, this.writeOffset);
                // The program has changed the disk. Nothing else can tell: the
                // image the file was loaded from is a separate buffer, so
                // comparing against it would mean keeping a second copy of every
                // disk just to answer "is there anything worth saving?".
                this.currentDisk.modified = true;
            }
        }

        // Get INTRQ state (directly accessible for memory mapping)
        getIntrq() {
            return this.intrq;
        }
    }

    /**
     * ZIP archive loader - extracts SNA/TAP files from ZIP archives
     */
    export class TRDLoader {
        /**
         * Check if data is a TRD file
         * TRD files are typically 640KB (80 tracks * 2 sides * 16 sectors * 256 bytes)
         * or 655360 bytes. Can also be 40-track single-sided (163840 bytes)
         */
        static isTRD(data) {
            const bytes = new Uint8Array(data);
            // Check common TRD sizes
            const validSizes = [163840, 327680, 655360, 640 * 1024];
            if (!validSizes.includes(bytes.length) && bytes.length < 163840) {
                return false;
            }
            // Check disk info sector (track 0, sector 8, offset 0x8E0)
            // Byte 0xE7 should be 0x10 (TR-DOS signature)
            if (bytes.length > 0x8E7 && bytes[0x8E7] === 0x10) {
                return true;
            }
            // Also accept if first file entry looks valid
            if (bytes.length > 16 && bytes[0] !== 0x00 && bytes[0] !== 0x01) {
                const firstChar = bytes[0];
                // First char should be printable ASCII or deleted marker (0x01)
                return firstChar >= 0x20 && firstChar < 0x80;
            }
            return false;
        }

        /**
         * Decode the start/length pair of a TR-DOS catalogue entry by file type.
         * BASIC (B, 0x42): bytes 9-10 = total length (program + variables),
         *   bytes 11-12 = program length (the offset where variables begin).
         * CODE/others: bytes 9-10 = start/load address, bytes 11-12 = data length.
         * (TR-DOS catalogue convention; Sinclair Wiki + Kaitai tr_dos_image spec.)
         * Returns { start, length, programLength }, where `length` is always the
         * number of data bytes to extract and `programLength` is null for non-BASIC.
         */
        static decodeEntryLen(extByte, w9, w11) {
            if (extByte === 0x42) return { start: 0, length: w9, programLength: w11 };
            return { start: w9, length: w11, programLength: null };
        }

        /**
         * Encode a TR-DOS catalogue entry's 9-10 / 11-12 words for a file being
         * written. Inverse of decodeEntryLen. For BASIC, `total` is the full data
         * length (program + variables) and `programLength` the variables offset
         * (defaults to total = "no variables"). For others, `start` is the load
         * address and `total` the data length.
         */
        static encodeEntryLen(extByte, total, start, programLength) {
            if (extByte === 0x42) return { w9: total, w11: (programLength != null ? programLength : total) };
            return { w9: start || 0, w11: total };
        }

        /**
         * List files in TRD image
         * Returns array of {name, ext, start, length, programLength, sectors, track, sector}
         */
        static listFiles(data) {
            const bytes = new Uint8Array(data);
            const files = [];

            // Directory is in track 0, sectors 0-7 (offsets 0x000-0x7FF)
            // Each entry is 16 bytes, max 128 entries
            for (let i = 0; i < 128; i++) {
                const offset = i * 16;
                if (offset + 16 > bytes.length) break;

                const firstByte = bytes[offset];
                // 0x00 = end of directory, 0x01 = deleted file
                if (firstByte === 0x00) break;
                if (firstByte === 0x01) continue;

                // Read filename (8 bytes, space-padded)
                let name = '';
                for (let j = 0; j < 8; j++) {
                    const ch = bytes[offset + j];
                    if (ch >= 0x20 && ch < 0x80) {
                        name += String.fromCharCode(ch);
                    }
                }
                name = name.trimEnd();

                // File extension/type
                const extByte = bytes[offset + 8];
                let ext = String.fromCharCode(extByte);
                let type = 'unknown';
                if (extByte === 0x42) type = 'basic';      // 'B'
                else if (extByte === 0x43) type = 'code';  // 'C'
                else if (extByte === 0x44) type = 'data';  // 'D'
                else if (extByte === 0x23) type = 'seq';   // '#'

                // BASIC: 9-10 = total length, 11-12 = program length; CODE: 9-10 =
                // load address, 11-12 = length. (see decodeEntryLen)
                const w9 = bytes[offset + 9] | (bytes[offset + 10] << 8);
                const w11 = bytes[offset + 11] | (bytes[offset + 12] << 8);
                const { start, length, programLength } = TRDLoader.decodeEntryLen(extByte, w9, w11);
                // Length in sectors
                const sectors = bytes[offset + 13];
                // Starting position
                const sector = bytes[offset + 14];
                const track = bytes[offset + 15];

                if (name && length > 0) {
                    files.push({
                        name,
                        ext,
                        type,
                        start,
                        length,
                        programLength,
                        sectors,
                        sector,
                        track,
                        fullName: `${name}.${ext}`
                    });
                }
            }

            return files;
        }

        /**
         * Extract file data from TRD image
         */
        static extractFile(data, fileInfo) {
            const bytes = new Uint8Array(data);
            const sectorSize = 256;
            const sectorsPerTrack = 16;

            // Calculate offset: track * 16 sectors * 256 + sector * 256
            const startOffset = (fileInfo.track * sectorsPerTrack + fileInfo.sector) * sectorSize;

            if (startOffset + fileInfo.length > bytes.length) {
                throw new Error(`File extends beyond disk image: ${fileInfo.fullName}`);
            }

            return bytes.slice(startOffset, startOffset + fileInfo.length);
        }

        /**
         * Convert TRD file to TAP format for loading
         */
        static fileToTAP(fileData, fileInfo) {
            const blocks = [];

            if (fileInfo.type === 'basic') {
                // BASIC program: header + data
                // Header block
                const header = new Uint8Array(19);
                header[0] = 0x00;  // Header flag
                header[1] = 0x00;  // Type: Program
                // Filename (10 bytes, space-padded)
                writeField(header, 2, fileInfo.name, 10, 0x20);
                // Data length = total (program + variables)
                header[12] = fileData.length & 0xFF;
                header[13] = (fileData.length >> 8) & 0xFF;
                // Autostart line — the TR-DOS catalogue has no autostart field, so
                // emit "no auto-run" (>= 32768) rather than a bogus line number.
                header[14] = 0x00;
                header[15] = 0x80;
                // Program length (param 2) = offset where variables begin; falls back
                // to the full length when no variables area is present.
                const progLen = (fileInfo.programLength != null) ? fileInfo.programLength : fileData.length;
                header[16] = progLen & 0xFF;
                header[17] = (progLen >> 8) & 0xFF;
                // Checksum
                header[18] = xorChecksum(header, 0, 18);

                blocks.push(header);

                // Data block
                const dataBlock = new Uint8Array(fileData.length + 2);
                dataBlock[0] = 0xFF;  // Data flag
                dataBlock.set(fileData, 1);
                dataBlock[dataBlock.length - 1] = xorChecksum(fileData, 0xFF);

                blocks.push(dataBlock);
            } else if (fileInfo.type === 'code') {
                // Code file: header + data
                const header = new Uint8Array(19);
                header[0] = 0x00;  // Header flag
                header[1] = 0x03;  // Type: Bytes
                for (let i = 0; i < 10; i++) {
                    header[2 + i] = i < fileInfo.name.length ? fileInfo.name.charCodeAt(i) : 0x20;
                }
                header[12] = fileInfo.length & 0xFF;
                header[13] = (fileInfo.length >> 8) & 0xFF;
                header[14] = fileInfo.start & 0xFF;
                header[15] = (fileInfo.start >> 8) & 0xFF;
                header[16] = 0x00;
                header[17] = 0x80;
                header[18] = xorChecksum(header, 0, 18);

                blocks.push(header);

                const dataBlock = new Uint8Array(fileData.length + 2);
                dataBlock[0] = 0xFF;
                dataBlock.set(fileData, 1);
                dataBlock[dataBlock.length - 1] = xorChecksum(fileData, 0xFF);

                blocks.push(dataBlock);
            } else {
                // Other types: just data block
                const dataBlock = new Uint8Array(fileData.length + 2);
                dataBlock[0] = 0xFF;
                dataBlock.set(fileData, 1);
                dataBlock[dataBlock.length - 1] = xorChecksum(fileData, 0xFF);

                blocks.push(dataBlock);
            }

            // Build TAP file
            let totalLen = 0;
            for (const block of blocks) totalLen += block.length + 2;

            const tap = new Uint8Array(totalLen);
            let offset = 0;
            for (const block of blocks) {
                tap[offset] = block.length & 0xFF;
                tap[offset + 1] = (block.length >> 8) & 0xFF;
                tap.set(block, offset + 2);
                offset += block.length + 2;
            }

            return tap;
        }

        /**
         * Build a 640KB TRD image from a file list. Files are written sequentially
         * from logical track 1 — so rebuilding from the surviving files after a delete
         * compacts the disk (reclaims the removed files' sectors). Each file:
         * { name, ext, length, startAddress, programLength, sectors, data, deleted }.
         * A `deleted` file keeps its slot/data but its dir entry is marked 0x01 and it
         * is excluded from the file count (TR-DOS soft delete).
         */
        // bannerNames: optional array of 8-byte name buffers, written as fake
        // zero-length catalogue entries BEFORE the real files — a SPECSCII
        // banner drawn by TR-DOS LIST (see core/specscii.js).
        static buildTRD(files, diskLabel = '', bannerNames = null) {
            const trd = new Uint8Array(655360);
            let trdSector = 16;          // data starts at logical track 1
            let activeFileCount = 0;
            let entryBase = 0;
            if (bannerNames) {
                for (const nm of bannerNames) {
                    const off = entryBase * 16;
                    for (let c = 0; c < 8; c++) trd[off + c] = nm[c];
                    trd[off + 8] = 0x20;   // type: space, like real banner disks
                    // length/start address/sectors/position stay zero
                    entryBase++;
                    activeFileCount++;     // counted like Deja Vu #0A does
                }
            }
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const off = (entryBase + i) * 16;
                writeField(trd, off, f.name || '', 8, 0x20);
                if (f.deleted) trd[off] = 0x01;
                else activeFileCount++;
                const extByte = (f.ext || 'C').charCodeAt(0);
                trd[off + 8] = extByte;
                const { w9, w11 } = TRDLoader.encodeEntryLen(extByte, f.length, f.startAddress, f.programLength);
                trd[off + 9] = w9 & 0xFF; trd[off + 10] = (w9 >> 8) & 0xFF;
                trd[off + 11] = w11 & 0xFF; trd[off + 12] = (w11 >> 8) & 0xFF;
                trd[off + 13] = f.sectors;
                trd[off + 14] = trdSector % 16;
                trd[off + 15] = Math.floor(trdSector / 16);
                trd.set(f.data.subarray(0, f.sectors * 256), trdSector * 256);
                trdSector += f.sectors;
            }
            const info = 0x800;          // sysinfo sector (track 0, sector 8)
            trd[info + 0xE1] = trdSector % 16;
            trd[info + 0xE2] = Math.floor(trdSector / 16);
            trd[info + 0xE3] = 0x16;     // 80-track DS
            trd[info + 0xE4] = activeFileCount;
            const freeSectors = 2560 - trdSector;
            trd[info + 0xE5] = freeSectors & 0xFF;
            trd[info + 0xE6] = (freeSectors >> 8) & 0xFF;
            trd[info + 0xE7] = 0x10;     // TR-DOS id
            for (let c = 0xEA; c <= 0xF2; c++) trd[info + c] = 0x20; // sysinfo: 9 spaces (per real TR-DOS)
            const label = (diskLabel || '') + '        ';
            for (let c = 0; c < 8; c++) trd[info + 0xF5 + c] = label.charCodeAt(c) || 0x20;
            return trd;
        }
    }

    /**
     * SCL file loader - TR-DOS file archive format
     * More compact than TRD - only stores files, not empty sectors
     */
    export class SCLLoader {
        /**
         * Check if data is an SCL file
         */
        static isSCL(data) {
            const bytes = new Uint8Array(data);
            if (bytes.length < 9) return false;
            // Check "SINCLAIR" signature
            const sig = String.fromCharCode(...bytes.slice(0, 8));
            return sig === 'SINCLAIR';
        }

        /**
         * List files in SCL archive
         */
        static listFiles(data) {
            const bytes = new Uint8Array(data);
            if (!SCLLoader.isSCL(data)) {
                throw new Error('Invalid SCL signature');
            }

            const numFiles = bytes[8];
            const files = [];
            let dataOffset = 9 + numFiles * 14;  // Header + descriptors

            for (let i = 0; i < numFiles; i++) {
                const descOffset = 9 + i * 14;

                // Read filename (8 bytes)
                let name = '';
                for (let j = 0; j < 8; j++) {
                    const ch = bytes[descOffset + j];
                    if (ch >= 0x20 && ch < 0x80) {
                        name += String.fromCharCode(ch);
                    }
                }
                name = name.trimEnd();

                const extByte = bytes[descOffset + 8];
                let ext = String.fromCharCode(extByte);
                let type = 'unknown';
                if (extByte === 0x42) type = 'basic';
                else if (extByte === 0x43) type = 'code';
                else if (extByte === 0x44) type = 'data';
                else if (extByte === 0x23) type = 'seq';

                // BASIC: 9-10 = total length, 11-12 = program length; CODE: 9-10 =
                // load address, 11-12 = length. (see TRDLoader.decodeEntryLen)
                const w9 = bytes[descOffset + 9] | (bytes[descOffset + 10] << 8);
                const w11 = bytes[descOffset + 11] | (bytes[descOffset + 12] << 8);
                const { start, length, programLength } = TRDLoader.decodeEntryLen(extByte, w9, w11);
                const sectors = bytes[descOffset + 13];

                files.push({
                    name,
                    ext,
                    type,
                    start,
                    length,
                    programLength,
                    sectors,
                    dataOffset,
                    fullName: `${name}.${ext}`
                });

                // Next file's data starts after this file's sectors
                dataOffset += sectors * 256;
            }

            return files;
        }

        /**
         * Extract file data from SCL archive
         */
        static extractFile(data, fileInfo) {
            const bytes = new Uint8Array(data);

            if (fileInfo.dataOffset + fileInfo.length > bytes.length) {
                throw new Error(`File extends beyond archive: ${fileInfo.fullName}`);
            }

            return bytes.slice(fileInfo.dataOffset, fileInfo.dataOffset + fileInfo.length);
        }

        /**
         * Convert SCL file to TAP format (reuse TRD logic)
         */
        static fileToTAP(fileData, fileInfo) {
            return TRDLoader.fileToTAP(fileData, fileInfo);
        }

        /**
         * Build an SCL archive from a file list (deleted files are dropped — SCL has no
         * erase marker, so rebuilding compacts). Same per-file fields as buildTRD; uses
         * the TR-DOS catalogue convention for the 9-10/11-12 words (BASIC-aware).
         */
        static buildSCL(files, bannerNames = null) {
            const active = files.filter(f => !f.deleted);
            const bannerCount = bannerNames ? bannerNames.length : 0;
            let totalData = 0;
            for (const f of active) totalData += f.sectors * 256;
            const scl = new Uint8Array(9 + (bannerCount + active.length) * 14 + totalData + 4);
            const sig = 'SINCLAIR';
            for (let i = 0; i < 8; i++) scl[i] = sig.charCodeAt(i);
            scl[8] = bannerCount + active.length;
            let offset = 9;
            if (bannerNames) {
                for (const nm of bannerNames) {
                    for (let c = 0; c < 8; c++) scl[offset + c] = nm[c];
                    scl[offset + 8] = 0x20; // fake banner entry: type space, no data
                    offset += 14;
                }
            }
            for (const f of active) {
                const name = ((f.name || '') + '        ').substring(0, 8);
                for (let c = 0; c < 8; c++) scl[offset + c] = name.charCodeAt(c) || 0x20;
                const extByte = (f.ext || 'C').charCodeAt(0);
                scl[offset + 8] = extByte;
                const { w9, w11 } = TRDLoader.encodeEntryLen(extByte, f.length, f.startAddress, f.programLength);
                scl[offset + 9] = w9 & 0xFF; scl[offset + 10] = (w9 >> 8) & 0xFF;
                scl[offset + 11] = w11 & 0xFF; scl[offset + 12] = (w11 >> 8) & 0xFF;
                scl[offset + 13] = f.sectors;
                offset += 14;
            }
            for (const f of active) { scl.set(f.data.subarray(0, f.sectors * 256), offset); offset += f.sectors * 256; }
            const sum = sclChecksum(scl, offset);
            scl[offset] = sum & 0xFF; scl[offset + 1] = (sum >> 8) & 0xFF;
            scl[offset + 2] = (sum >> 16) & 0xFF; scl[offset + 3] = (sum >>> 24) & 0xFF;
            return scl;
        }
    }

    /**
     * MGT file loader - DISCiPLE/+D disk image format
     * 80 tracks × 2 sides × 10 sectors/track × 512 bytes/sector = 819200 bytes
     * Directory in tracks 0-1 (both sides): 80 entries × 256 bytes
     */
