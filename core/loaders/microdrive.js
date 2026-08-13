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

            // Mark remaining sectors as free (HDFLAG=0, RECFLG=0)
            for (let i = nextSector; i < sectorCount; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                // Keep sector number but clear HDFLAG to mark as free
                image[off] = 0x00;
                image[off + 15] = 0x00;
                image[off + 14] = MDRLoader.mdrChecksum(image, off, 14);
                image[off + 29] = MDRLoader.mdrChecksum(image, off + 15, 14);
                image[off + 542] = MDRLoader.mdrChecksum(image, off + 30, 512);
            }

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
                    headPos: 0            // Byte position within the cartridge tape
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

            const tapeLen = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;
            const val = drv.cartridge[drv.headPos % tapeLen];
            drv.headPos = (drv.headPos + 1) % tapeLen;

            if (this.onDiskActivity) {
                this.onDiskActivity('read', this.activeDrive, drv.headPos);
            }
            return val;
        }

        /**
         * Write port $E7 — Microdrive data register
         * Writes byte to selected drive's tape
         */
        writeData(val) {
            const drv = this.currentDrive;
            if (!drv || !drv.cartridge || drv.writeProtect) return;
            if (!this.writing && !this.erasing) return;

            const tapeLen = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;
            drv.cartridge[drv.headPos % tapeLen] = val;
            drv.headPos = (drv.headPos + 1) % tapeLen;

            if (this.onDiskActivity) {
                this.onDiskActivity('write', this.activeDrive, drv.headPos);
            }
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
            const drv = this.currentDrive;
            if (!drv || !drv.cartridge) {
                return 0xEF | 0x10;  // Not busy is wrong — if no drive, bit 4 = busy = 1... actually bit 4 = 0 means "ready"
                // Actually, when no drive: return $FF (all bits high, including busy)
            }

            let status = 0xE0;  // Bits 5-7 high (unused)

            // Bit 0: write protect
            if (drv.writeProtect) status |= 0x01;

            // Bit 4: not ready (no cartridge inserted or motor off)
            if (!drv.motorOn) {
                status |= 0x10;
                return status;
            }

            // Derive sync and gap from head position within sector
            const tapeLen = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;
            const posInSector = drv.headPos % MDRLoader.SECTOR_SIZE;

            // Gap between header and record (bytes 14-15 area)
            // Sync at the start of header (byte 0) and start of record (byte 15)
            if (posInSector === 0 || posInSector === MDRLoader.HEADER_SIZE) {
                status |= 0x02;  // Sync
            }
            if (posInSector >= MDRLoader.HEADER_SIZE - 1 && posInSector <= MDRLoader.HEADER_SIZE) {
                status |= 0x04;  // Gap
            }

            // Gap at end of sector (last few bytes before next sector)
            if (posInSector >= MDRLoader.SECTOR_SIZE - 2) {
                status |= 0x04;  // Gap
            }

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

            // Detect rising edge on COMMS CLK
            if (newCommsClk && !this.commsClk) {
                // Shift data bit into shift register (MSB first → LSB)
                this.commsShiftReg = ((this.commsShiftReg << 1) | newCommsData) & 0xFF;

                // Update motor state for all drives
                for (let i = 0; i < 8; i++) {
                    this.drives[i].motorOn = !!(this.commsShiftReg & (1 << i));
                }
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

            this.drives[idx].cartridge = new Uint8Array(tapeLen);
            this.drives[idx].cartridge.set(bytes.subarray(0, Math.min(bytes.length, tapeLen)));
            this.drives[idx].writeProtect = bytes.length >= MDRLoader.IMAGE_SIZE ? bytes[MDRLoader.IMAGE_SIZE - 1] !== 0 : false;
            this.drives[idx].headPos = 0;
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
                // Cartridge data persists across reset
            }
        }
    }

    /**
     * OPD Loader - Opus Discovery disk format
     * Raw sector dump: 40 tracks × 18 sectors × 256 bytes/sector
     * Single-sided: 184,320 bytes / Double-sided: 368,640 bytes
     */
