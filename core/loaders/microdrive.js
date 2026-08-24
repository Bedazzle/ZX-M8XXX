/**
 * ZX-M8XXX - Interface 1 / Microdrive: MDR images and the drive hardware
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

import { writeField } from './common.js';
import { TRDLoader } from './disk-beta.js';

    export class MDRLoader {
        static get SECTOR_COUNT() { return 254; }
        static get SECTOR_SIZE() { return 543; }
        static get HEADER_SIZE() { return 15; }
        static get RECORD_SIZE() { return 528; }
        static get DATA_SIZE() { return 512; }
        static get IMAGE_SIZE() { return 254 * 543 + 1; }  // 137923
        static get IMAGE_SIZE_NO_WP() { return 254 * 543; } // 137922

        /**
         * Get number of sectors from data length.
         * Supports oversized MDR images (multi-cartridge compilations).
         * Standard cartridge: 254 sectors. Oversized: floor(length / 543).
         */
        static getSectorCount(data) {
            const len = data.length || data.byteLength || 0;
            return Math.floor(len / MDRLoader.SECTOR_SIZE);
        }

        /**
         * Check if data is an MDR file
         * Standard: 137923 bytes (254×543 + 1 write-protect flag)
         * Some images omit the write-protect byte: 137922 bytes
         */
        static isMDR(data) {
            const bytes = new Uint8Array(data);
            if (bytes.length !== MDRLoader.IMAGE_SIZE && bytes.length !== MDRLoader.IMAGE_SIZE_NO_WP) return false;

            // Validate: check a few sector headers have reasonable values
            let validCount = 0;
            let freeCount = 0;
            for (let i = 0; i < 10 && i < MDRLoader.SECTOR_COUNT; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                const hdflag = bytes[off];
                const hdnumb = bytes[off + 1];
                if (hdflag === 0 && bytes[off + 15] === 0) {
                    freeCount++;  // Free sector
                } else if ((hdflag & 0x01) === 1 && hdnumb >= 1 && hdnumb <= 254) {
                    validCount++;  // Valid header block
                }
            }
            return validCount > 0 || freeCount >= 3;
        }

        /**
         * Compute the Interface 1 sector checksum: the sum of the bytes modulo 255
         * (per the IF1 ROM — this can never produce 255). Used when writing/building
         * MDR images so the checksums match what real hardware / FUSE expect.
         */
        static mdrChecksum(data, start, len) {
            let sum = 0;
            for (let i = 0; i < len; i++) {
                sum += data[start + i];
            }
            return sum % 255;
        }

        /**
         * List files in MDR image
         * Groups sectors by RECNAM, sorts by RECNUM, calculates file sizes
         * Returns array of {name, length, sectors, sectorIndices, isPrint, type}
         */
        static listFiles(data) {
            const bytes = new Uint8Array(data);
            const sectorCount = MDRLoader.getSectorCount(bytes);
            // Collect all sectors grouped by filename
            // Each sector is tagged as active (RECFLG != 0) or stale (RECFLG == 0)
            const fileMap = new Map();  // name → [{recnum, reclen, recflg, sectorIdx}]

            for (let i = 0; i < sectorCount; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                const hdflag = bytes[off];

                // Skip sectors without a valid header
                if ((hdflag & 0x01) !== 1) continue;

                // Validate RECNAM — all 10 bytes must be printable ASCII or trailing spaces
                // Reject garbage sectors (e.g. format/init records with machine code in name field)
                let recnam = '';
                let validName = true;
                for (let j = 0; j < 10; j++) {
                    const ch = bytes[off + 19 + j];
                    if (ch >= 0x20 && ch < 0x80) {
                        recnam += String.fromCharCode(ch);
                    } else {
                        validName = false;
                        break;
                    }
                }
                if (!validName) continue;
                recnam = recnam.trimEnd();
                if (!recnam) continue;

                const recflg = bytes[off + 15];
                const recnum = bytes[off + 16];
                const reclen = bytes[off + 17] | (bytes[off + 18] << 8);

                if (!fileMap.has(recnam)) {
                    fileMap.set(recnam, []);
                }
                fileMap.get(recnam).push({
                    recnum,
                    reclen,
                    recflg,
                    sectorIdx: i
                });
            }

            // Build file list
            const files = [];
            for (const [name, sectors] of fileMap) {
                // Separate active sectors (RECFLG != 0) from stale/erased ones (RECFLG == 0)
                const activeSectors = sectors.filter(s => s.recflg !== 0);
                const deleted = activeSectors.length === 0;

                // Use active sectors for live files, all sectors for deleted files
                const fileSectors = deleted ? sectors : activeSectors;

                // Sort by record number; for duplicate recnums, prefer sectors with
                // RECFLG bit 2 set (standard SAVE records) over padding/PRINT sectors
                fileSectors.sort((a, b) => a.recnum - b.recnum || ((b.recflg & 0x04) - (a.recflg & 0x04)));

                // Calculate total data length
                let totalLen = 0;
                for (let j = 0; j < fileSectors.length; j++) {
                    const sec = fileSectors[j];
                    if (sec.recflg & 0x02) {
                        // EOF sector — use actual reclen
                        totalLen += sec.reclen;
                    } else {
                        totalLen += MDRLoader.DATA_SIZE;
                    }
                }

                // Check if ANY active sector has bit 2 set (non-PRINT/SAVE type)
                // Some MDR creation tools don't set bit 2 on all sectors
                const isPrint = !fileSectors.some(s => (s.recflg & 0x04) !== 0);

                files.push({
                    name,
                    length: totalLen,
                    sectors: fileSectors.length,
                    sectorIndices: fileSectors.map(s => s.sectorIdx),
                    isPrint,
                    type: isPrint ? 'Data' : 'File',
                    deleted
                });
            }

            // Active files first, deleted files at the end
            files.sort((a, b) => (a.deleted ? 1 : 0) - (b.deleted ? 1 : 0));

            return files;
        }

        /**
         * Extract file data from MDR image
         * Follows sector sequence, concatenates data, trims last sector to RECLEN
         */
        static extractFile(data, fileInfo) {
            const bytes = new Uint8Array(data);
            const result = new Uint8Array(fileInfo.length);
            let destPos = 0;

            for (const sectorIdx of fileInfo.sectorIndices) {
                const off = sectorIdx * MDRLoader.SECTOR_SIZE;
                const recflg = bytes[off + 15];
                const reclen = bytes[off + 17] | (bytes[off + 18] << 8);
                const dataStart = off + 30;  // Data starts at byte 30

                const copyLen = (recflg & 0x02) ? reclen : MDRLoader.DATA_SIZE;
                const actualCopy = Math.min(copyLen, result.length - destPos);
                if (actualCopy > 0) {
                    result.set(bytes.slice(dataStart, dataStart + actualCopy), destPos);
                    destPos += actualCopy;
                }
            }

            return result.slice(0, destPos);
        }

        /**
         * Get cartridge info: name, used/free sectors, file count
         */
        static getDiskInfo(data) {
            const bytes = new Uint8Array(data);
            const sectorCount = MDRLoader.getSectorCount(bytes);
            let cartridgeName = '';
            let usedSectors = 0;
            let freeSectors = 0;

            // Get cartridge name from first valid sector header
            for (let i = 0; i < sectorCount; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                const hdflag = bytes[off];
                if ((hdflag & 0x01) === 1) {
                    // Read HDNAME (10 bytes at offset 4)
                    for (let j = 0; j < 10; j++) {
                        const ch = bytes[off + 4 + j];
                        if (ch >= 0x20 && ch < 0x80) {
                            cartridgeName += String.fromCharCode(ch);
                        }
                    }
                    cartridgeName = cartridgeName.trimEnd();
                    break;
                }
            }

            const files = MDRLoader.listFiles(data);

            // Count used sectors from active (non-deleted) files only
            let deletedCount = 0;
            for (const f of files) {
                if (f.deleted) {
                    deletedCount++;
                } else {
                    usedSectors += f.sectors;
                }
            }
            freeSectors = sectorCount - usedSectors;
            const writeProtect = bytes.length >= MDRLoader.IMAGE_SIZE ? bytes[MDRLoader.IMAGE_SIZE - 1] : 0;

            return {
                cartridgeName,
                totalSectors: sectorCount,
                usedSectors,
                freeSectors,
                fileCount: files.length - deletedCount,
                deletedCount,
                writeProtect: writeProtect !== 0,
                totalSize: bytes.length
            };
        }

        /**
         * Convert MDR file to TAP format (reuses TRDLoader.fileToTAP)
         */
        static fileToTAP(fileData, fileInfo) {
            const mappedInfo = {
                name: fileInfo.name.substring(0, 10),
                type: fileInfo.isPrint ? 'data' : 'code',
                start: 0,
                length: fileInfo.length,
                fullName: fileInfo.name
            };
            return TRDLoader.fileToTAP(fileData, mappedInfo);
        }

        /**
         * Create a blank formatted MDR image
         * @param {string} cartridgeName - cartridge name (max 10 chars)
         * @param {number} sectorCount - number of sectors (default 254 = standard cartridge)
         */
        static createBlankMDR(cartridgeName = 'BLANK', sectorCount = MDRLoader.SECTOR_COUNT) {
            const imageSize = sectorCount * MDRLoader.SECTOR_SIZE + 1;
            const image = new Uint8Array(imageSize);
            image.fill(0);

            // Format each sector with proper header structure
            for (let i = 0; i < sectorCount; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                // HDFLAG = 1 (valid header block)
                image[off] = 0x01;
                // HDNUMB = sector number (wraps within 254-sector cartridge boundaries)
                image[off + 1] = (sectorCount <= MDRLoader.SECTOR_COUNT)
                    ? sectorCount - i
                    : MDRLoader.SECTOR_COUNT - (i % MDRLoader.SECTOR_COUNT);
                // HDNAME (10 bytes at offset 4)
                writeField(image, off + 4, cartridgeName, 10);
                // HDCHK — header checksum (bytes 0-13)
                image[off + 14] = MDRLoader.mdrChecksum(image, off, 14);
                // Record area: all zeros = free sector (RECFLG=0, RECNUM=0, etc.)
                // DESCHK — descriptor checksum (bytes 15-28)
                image[off + 29] = MDRLoader.mdrChecksum(image, off + 15, 14);
                // DCHK — data checksum (all zeros)
                image[off + 542] = MDRLoader.mdrChecksum(image, off + 30, 512);
            }
            // Write-protect flag (last byte): 0 = not write-protected
            image[imageSize - 1] = 0;
            return image;
        }

        /**
         * Build MDR image from file list
         * files: [{name, data, isPrint}]
         * @param {number} sectorCount - total sectors (default 254 = standard cartridge)
         */
        static buildMDR(files, cartridgeName = 'BLANK', sectorCount = MDRLoader.SECTOR_COUNT) {
            const image = MDRLoader.createBlankMDR(cartridgeName, sectorCount);
            let nextSector = 0;  // Next free sector to allocate

            for (const file of files) {
                const fileData = new Uint8Array(file.data);
                const numSectors = Math.ceil(fileData.length / MDRLoader.DATA_SIZE) || 1;

                if (nextSector + numSectors > sectorCount) {
                    break;  // No more room
                }


                for (let rec = 0; rec < numSectors; rec++) {
                    const secIdx = nextSector++;
                    const off = secIdx * MDRLoader.SECTOR_SIZE;
                    const dataStart = rec * MDRLoader.DATA_SIZE;
                    const isLast = (rec === numSectors - 1);
                    const chunkLen = isLast
                        ? fileData.length - dataStart
                        : MDRLoader.DATA_SIZE;

                    // Header is already formatted by createBlankMDR

                    // Record descriptor (bytes 15-28)
                    image[off + 15] = isLast ? 0x06 : 0x04;  // RECFLG: bit 2=regular file, bit 1=EOF
                    if (file.isPrint) {
                        image[off + 15] = isLast ? 0x02 : 0x00;  // PRINT file: bit 2=0
                    }
                    image[off + 16] = rec;  // RECNUM
                    image[off + 17] = chunkLen & 0xFF;  // RECLEN low
                    image[off + 18] = (chunkLen >> 8) & 0xFF;  // RECLEN high
                    // RECNAM (10 bytes)
                    writeField(image, off + 19, file.name, 10);
                    // DESCHK
                    image[off + 29] = MDRLoader.mdrChecksum(image, off + 15, 14);

                    // Data (512 bytes at offset 30)
                    const dataOff = off + 30;
                    for (let j = 0; j < MDRLoader.DATA_SIZE; j++) {
                        image[dataOff + j] = (dataStart + j < fileData.length) ? fileData[dataStart + j] : 0;
                    }
                    // DCHK
                    image[off + 542] = MDRLoader.mdrChecksum(image, off + 30, 512);
                }
            }

            // Sectors from nextSector on are left exactly as createBlankMDR made
            // them: a valid header (HDFLAG=1, HDNUMB, cartridge name, HDCHK) over
            // an empty record. A free sector is marked by RECFLG=0, NOT by wiping
            // the header — FORMAT writes a header to every block on the tape and
            // it stays there for the cartridge's life. Clearing HDFLAG here made
            // every cartridge M8XXX wrote unreadable by a real Interface 1, which
            // hunts block headers around the loop; both real cartridges and
            // Z80to's output carry HDFLAG=1 on all 254 blocks.
            return image;
        }
    }

    /**
     * Microdrive — Interface 1 Microdrive hardware emulation
     * Instant-completion model (same as BetaDisk/PlusDDisk).
     * Up to 8 Microdrives, each with its own cartridge image.
     * Port $E7: data register, Port $EF: status/control register.
     */
    export class Microdrive {
        constructor() {
            // 8 Microdrive slots, each with cartridge data and state
            this.drives = [];
            for (let i = 0; i < 8; i++) {
                this.drives.push({
                    cartridge: null,      // Uint8Array — raw MDR image (254×543 bytes)
                    writeProtect: false,
                    motorOn: false,
                    headPos: 0,           // Byte position within the cartridge tape
                    // Read/write state machine, after FUSE peripherals/if1.c. The
                    // IF1 ROM will not sync to a tape unless it sees a proper
                    // GAP → SYNC → block sequence, so the block boundaries and the
                    // "is this block formatted" flags have to be modelled; deriving
                    // the bits from headPos alone left the ROM hunting forever.
                    transfered: 0,        // bytes moved within the current block
                    maxBytes: MDRLoader.HEADER_SIZE,  // 15 for a header, 528 for a record
                    gap: 15,
                    sync: 15,
                    last: 0xFF,           // last byte read (held past the block end)
                    // One entry per block: 0..253 headers, 256..509 records.
                    // SYNC_OK marks a formatted block.
                    pream: new Uint8Array(512)
                });
            }

            // COMMS shift register for drive selection (8-bit)
            this.commsShiftReg = 0;
            this.commsData = 0;           // COMMS DATA line (bit 0 of control port write)
            this.commsClk = 0;            // COMMS CLK line (bit 1 — for rising edge detect)

            // Control state
            this.writing = false;
            this.erasing = false;

            // Disk activity callback: function(type, drive, pos)
            this.onDiskActivity = null;

            // Track gap state for status reads
            this._gapCounter = 0;
        }

        /**
         * Get the currently selected (motor-on) drive index, or -1 if none
         */
        get activeDrive() {
            for (let i = 0; i < 8; i++) {
                if ((this.commsShiftReg & (1 << i)) && this.drives[i].motorOn) {
                    return i;
                }
            }
            return -1;
        }

        /**
         * Get the currently active drive object, or null
         */
        get currentDrive() {
            const idx = this.activeDrive;
            return idx >= 0 ? this.drives[idx] : null;
        }

        /**
         * Read port $E7 — Microdrive data register
         * Returns next byte from selected drive's tape
         */
        readData() {
            const drv = this.currentDrive;
            if (!drv || !drv.cartridge) return 0xFF;

            // Only the bytes belonging to the current block are fetched; reads
            // past its end keep returning the last byte, as the real head does
            // until the status port realigns us (FUSE port_mdr_in).
            if (drv.transfered < drv.maxBytes) {
                drv.last = drv.cartridge[drv.headPos];
                this._incrementHead(drv);
            }
            drv.transfered++;

            if (this.onDiskActivity) {
                this.onDiskActivity('read', this.activeDrive, drv.headPos);
            }
            return drv.last;
        }

        // Advance one byte, wrapping at the end of the tape loop
        _incrementHead(drv) {
            const tapeLen = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;
            drv.headPos++;
            if (drv.headPos >= tapeLen) drv.headPos = 0;
        }

        // Wind on to the next block boundary — the start of a header (offset 0)
        // or of its record (offset 15) — and set up the counters for it. The IF1
        // ROM calls this implicitly by reading the status port between blocks
        // (FUSE microdrives_restart, called at the end of port_ctr_in).
        _restart() {
            for (const drv of this.drives) {
                if (!drv.cartridge) continue;
                let guard = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;
                while (guard-- > 0) {
                    const off = drv.headPos % MDRLoader.SECTOR_SIZE;
                    if (off === 0 || off === MDRLoader.HEADER_SIZE) break;
                    this._incrementHead(drv);
                }
                drv.transfered = 0;
                drv.maxBytes = (drv.headPos % MDRLoader.SECTOR_SIZE) === 0
                    ? MDRLoader.HEADER_SIZE
                    : MDRLoader.SECTOR_SIZE - MDRLoader.HEADER_SIZE;   // 528
            }
        }

        // Block index for the preamble table: headers 0.., records 256..
        _blockIndex(drv) {
            return Math.floor(drv.headPos / MDRLoader.SECTOR_SIZE) +
                (drv.maxBytes === MDRLoader.HEADER_SIZE ? 0 : 256);
        }

        /**
         * Write port $E7 — Microdrive data register
         * Writes byte to selected drive's tape
         */
        writeData(val) {
            const drv = this.currentDrive;
            if (!drv || !drv.cartridge || drv.writeProtect) return;

            // A block is written preamble first: ten $00 then two $FF. Counting
            // that sequence is how a block becomes "formatted", which is what
            // makes it readable afterwards (FUSE port_mdr_out).
            const block = this._blockIndex(drv);
            if (drv.transfered === 0 && val === 0x00) {
                drv.pream[block] = 1;
            } else if (drv.transfered > 0 && drv.transfered < 10 && val === 0x00) {
                drv.pream[block]++;
            } else if (drv.transfered > 9 && drv.transfered < 12 && val === 0xFF) {
                drv.pream[block]++;
            } else if (drv.transfered === 12 && drv.pream[block] === 12) {
                drv.pream[block] = Microdrive.SYNC_OK;
            }

            if (drv.transfered > 11 && drv.transfered < drv.maxBytes + 12) {
                drv.cartridge[drv.headPos] = val;
                this._incrementHead(drv);
                if (this.onDiskActivity) {
                    this.onDiskActivity('write', this.activeDrive, drv.headPos);
                }
            }
            drv.transfered++;
        }

        /**
         * Read port $EF — Status register
         * Bit 0: write protect (1=protected)
         * Bit 1: sync (1=sync pulse detected)
         * Bit 2: gap (1=in inter-record gap)
         * Bit 3: DTR (always 0 for Microdrive)
         * Bit 4: busy (1=no cartridge or no motor)
         * Bits 5-7: unused (1)
         */
        readStatus() {
            // Every line is active LOW: start all-ones and pull bits down. GAP
            // (bit 2) and SYNC (bit 1) go low together for a 15-read window, then
            // stay high for 15 — the cycle the IF1 ROM times its block reads
            // against (FUSE port_ctr_in). Reading this port is also what winds
            // the tape on to the next block, hence the _restart() below.
            let status = 0xFF;
            const drv = this.currentDrive;

            if (drv && drv.cartridge) {
                if (drv.pream[this._blockIndex(drv)] === Microdrive.SYNC_OK) {
                    if (drv.gap) {
                        drv.gap--;
                    } else {
                        status &= 0xF9;          // GAP + SYNC low
                        if (drv.sync) {
                            drv.sync--;
                        } else {
                            drv.gap = 15;
                            drv.sync = 15;
                        }
                    }
                }
                if (drv.writeProtect) status &= 0xFE;
            }

            this._restart();
            return status;
        }

        /**
         * Write port $EF — Control register
         * Bit 0: COMMS DATA
         * Bit 1: COMMS CLK (rising edge shifts data into shift register)
         * Bit 2: R/W mode (0=read, 1=write)
         * Bit 3: Erase (1=erase head active)
         * Bit 4: CTS (not used for Microdrive)
         * Bit 5: Wait (not emulated)
         */
        writeControl(val) {
            const newCommsData = val & 0x01;
            const newCommsClk = (val >> 1) & 0x01;

            // Shift the drive-select chain on the FALLING edge of COMMS CLK, and
            // note that COMMS DATA is active low: a 0 turns drive 1's motor ON
            // (FUSE peripherals/if1.c, port_ctr_out). Shifting on the rising edge
            // with the data taken at face value clocked the idle high line in as
            // a run of 1s, so several motors came on at once and the IF1 ROM
            // answered "Microdrive not present" with a cartridge sitting in drive 1.
            if (!newCommsClk && this.commsClk) {
                for (let i = 7; i > 0; i--) {
                    this.drives[i].motorOn = this.drives[i - 1].motorOn;
                }
                this.drives[0].motorOn = !newCommsData;

                // Keep the register as a mirror of the motor lines: it is what
                // activeDrive reads and what SZX saves.
                this.commsShiftReg = this.drives.reduce(
                    (reg, drv, i) => reg | (drv.motorOn ? (1 << i) : 0), 0);
            }

            this.commsData = newCommsData;
            this.commsClk = newCommsClk;

            // R/W mode
            this.writing = !!(val & 0x04);

            // Erase
            this.erasing = !!(val & 0x08);
        }

        /**
         * Load cartridge into specified drive
         */
        loadCartridge(data, driveIndex = 0) {
            const idx = driveIndex & 0x07;
            const bytes = new Uint8Array(data);
            const tapeLen = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;

            const drv = this.drives[idx];
            drv.cartridge = new Uint8Array(tapeLen);
            drv.cartridge.set(bytes.subarray(0, Math.min(bytes.length, tapeLen)));
            drv.writeProtect = bytes.length >= MDRLoader.IMAGE_SIZE ? bytes[MDRLoader.IMAGE_SIZE - 1] !== 0 : false;
            drv.headPos = 0;

            // An inserted cartridge is already formatted: mark every header and
            // every record as synced, or the status port would never assert
            // GAP/SYNC and the IF1 would hunt forever (FUSE if1_mdr_insert).
            drv.pream.fill(Microdrive.SYNC_NO);
            for (let i = 0; i < MDRLoader.SECTOR_COUNT; i++) {
                drv.pream[i] = Microdrive.SYNC_OK;
                drv.pream[256 + i] = Microdrive.SYNC_OK;
            }
            drv.transfered = 0;
            drv.maxBytes = MDRLoader.HEADER_SIZE;
            drv.gap = 15;
            drv.sync = 15;
            drv.last = 0xFF;
        }

        /**
         * Eject cartridge from specified drive
         */
        ejectCartridge(driveIndex = 0) {
            const idx = driveIndex & 0x07;
            this.drives[idx].cartridge = null;
            this.drives[idx].writeProtect = false;
            this.drives[idx].headPos = 0;
            this.drives[idx].motorOn = false;
        }

        /**
         * Check if specified drive has a cartridge
         */
        hasCartridge(driveIndex) {
            return this.drives[driveIndex & 0x07].cartridge !== null;
        }

        /**
         * Check if any drive has a cartridge
         */
        hasAnyCartridge() {
            return this.drives.some(d => d.cartridge !== null);
        }

        /**
         * Get cartridge data from specified drive (for project save)
         */
        getCartridgeData(driveIndex) {
            const drv = this.drives[driveIndex & 0x07];
            if (!drv.cartridge) return null;
            // Return full MDR image with write-protect flag
            const image = new Uint8Array(MDRLoader.IMAGE_SIZE);
            image.set(drv.cartridge);
            image[MDRLoader.IMAGE_SIZE - 1] = drv.writeProtect ? 1 : 0;
            return image;
        }

        /**
         * Reset all drives
         */
        reset() {
            this.commsShiftReg = 0;
            this.commsData = 0;
            this.commsClk = 0;
            this.writing = false;
            this.erasing = false;
            for (const drv of this.drives) {
                drv.motorOn = false;
                drv.headPos = 0;
                drv.transfered = 0;
                drv.maxBytes = MDRLoader.HEADER_SIZE;
                drv.gap = 15;
                drv.sync = 15;
                drv.last = 0xFF;
                // Cartridge data (and its formatted flags) persist across reset
            }
        }
    }

    // Preamble state for a block: whether the IF1 will find sync on it
    Microdrive.SYNC_NO = 0;
    Microdrive.SYNC_OK = 0xFF;

    /**
     * OPD Loader - Opus Discovery disk format
     * Raw sector dump: 40 tracks × 18 sectors × 256 bytes/sector
     * Single-sided: 184,320 bytes / Double-sided: 368,640 bytes
     */
