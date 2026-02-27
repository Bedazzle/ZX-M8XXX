// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Output Formats - Generates raw binary, TAP, SNA, and TRD files

export const OutputFormats = {

    // ==================== TRD Format ====================

    // TRD disk image: 80 tracks x 2 sides x 16 sectors x 256 bytes = 655360 bytes
    // Directory: first 8 sectors (sector 0 = track 0, sector 1-8)
    // Sector 9 (index 8): disk info sector
    // Each directory entry: 16 bytes
    // Max 128 files (8 sectors x 256 bytes / 16 bytes per entry)

    TRD_SECTOR_SIZE: 256,
    TRD_SECTORS_PER_TRACK: 16,
    TRD_TRACKS: 80,
    TRD_SIDES: 2,
    TRD_TOTAL_SECTORS: 80 * 2 * 16,  // 2560 sectors
    TRD_IMAGE_SIZE: 80 * 2 * 16 * 256,  // 655360 bytes
    TRD_DIR_SECTORS: 8,  // Sectors 0-7 for directory
    TRD_INFO_SECTOR: 8,  // Sector 8 (9th sector) for disk info

    // Create empty TRD disk image
    emptyTRD(label) {
        const trd = new Uint8Array(this.TRD_IMAGE_SIZE);

        // Fill with 0x00 (already done by Uint8Array)

        // Initialize disk info sector (sector 8, offset 8*256 = 2048)
        const infoOffset = this.TRD_INFO_SECTOR * this.TRD_SECTOR_SIZE;

        // Byte 0xE1 (225): first free sector on first free track
        trd[infoOffset + 0xE1] = 0;  // First free sector = 0 on track 1
        // Byte 0xE2 (226): first free track
        trd[infoOffset + 0xE2] = 1;  // First free track = 1 (track 0 used by directory)
        // Byte 0xE3 (227): disk type: 0x16 = 80 tracks, double-sided
        trd[infoOffset + 0xE3] = 0x16;
        // Byte 0xE4 (228): number of files on disk
        trd[infoOffset + 0xE4] = 0;
        // Bytes 0xE5-0xE6 (229-230): number of free sectors (little-endian)
        const freeSectors = this.TRD_TOTAL_SECTORS - 16;  // Minus track 0 (16 sectors)
        trd[infoOffset + 0xE5] = freeSectors & 0xFF;
        trd[infoOffset + 0xE6] = (freeSectors >> 8) & 0xFF;
        // Byte 0xE7 (231): TR-DOS ID byte = 0x10
        trd[infoOffset + 0xE7] = 0x10;
        // Bytes 0xE8-0xE9 (232-233): reserved (0x00)
        trd[infoOffset + 0xE8] = 0x00;
        trd[infoOffset + 0xE9] = 0x00;
        // Bytes 0xEA-0xF4 (234-244): password (9 spaces)
        for (let i = 0xEA; i <= 0xF2; i++) {
            trd[infoOffset + i] = 0x20;
        }
        // Byte 0xF3 (243): reserved
        trd[infoOffset + 0xF3] = 0x00;
        // Byte 0xF4 (244): number of deleted files
        trd[infoOffset + 0xF4] = 0;
        // Bytes 0xF5-0xFC (245-252): disk label (8 chars, space-padded)
        const diskLabel = (label || '        ').substring(0, 8).padEnd(8, ' ');
        for (let i = 0; i < 8; i++) {
            trd[infoOffset + 0xF5 + i] = diskLabel.charCodeAt(i);
        }
        // Bytes 0xFD-0xFF (253-255): reserved
        trd[infoOffset + 0xFD] = 0x00;
        trd[infoOffset + 0xFE] = 0x00;
        trd[infoOffset + 0xFF] = 0x00;

        return trd;
    },

    // Add file to TRD disk image
    // trd: existing TRD image (Uint8Array)
    // filename: 8.1 format (8 char name + 1 char extension)
    // data: file content (Uint8Array)
    // startAddr: start address for CODE files
    // fileType: 'B' (BASIC), 'C' (CODE), 'D' (DATA), '#' (sequential)
    saveTRD(trd, filename, data, startAddr, fileType) {
        // Parse filename (max 8 chars + extension char)
        let name = filename.replace(/\.[^.]*$/, '');  // Remove extension
        let ext = fileType || 'C';  // Default to CODE

        // Check if filename has explicit extension like "file.B" or "file.C"
        const dotMatch = filename.match(/\.([BCDbc#])$/i);
        if (dotMatch) {
            ext = dotMatch[1].toUpperCase();
        }

        // Pad name to 8 chars
        name = name.substring(0, 8).padEnd(8, ' ');

        // Get disk info
        const infoOffset = this.TRD_INFO_SECTOR * this.TRD_SECTOR_SIZE;
        const fileCount = trd[infoOffset + 0xE4];
        const firstFreeSector = trd[infoOffset + 0xE1];
        const firstFreeTrack = trd[infoOffset + 0xE2];

        // Check if directory is full (max 128 files)
        if (fileCount >= 128) {
            throw new Error('TRD directory full (max 128 files)');
        }

        // Calculate sectors needed
        const sectorsNeeded = Math.ceil(data.length / this.TRD_SECTOR_SIZE);

        // Check free space
        const freeSectors = trd[infoOffset + 0xE5] | (trd[infoOffset + 0xE6] << 8);
        if (sectorsNeeded > freeSectors) {
            throw new Error(`TRD disk full: need ${sectorsNeeded} sectors, have ${freeSectors}`);
        }

        // Find directory slot
        const dirEntry = fileCount;
        const dirSector = Math.floor(dirEntry / 16);  // 16 entries per sector
        const dirOffset = (dirEntry % 16) * 16;  // 16 bytes per entry
        const entryOffset = dirSector * this.TRD_SECTOR_SIZE + dirOffset;

        // Write directory entry (16 bytes)
        // Bytes 0-7: filename (8 chars)
        for (let i = 0; i < 8; i++) {
            trd[entryOffset + i] = name.charCodeAt(i);
        }
        // Byte 8: extension/type
        trd[entryOffset + 8] = ext.charCodeAt(0);
        // Bytes 9-10: start address (little-endian)
        const addr = startAddr || 0;
        trd[entryOffset + 9] = addr & 0xFF;
        trd[entryOffset + 10] = (addr >> 8) & 0xFF;
        // Bytes 11-12: length in bytes (little-endian)
        trd[entryOffset + 11] = data.length & 0xFF;
        trd[entryOffset + 12] = (data.length >> 8) & 0xFF;
        // Byte 13: length in sectors
        trd[entryOffset + 13] = sectorsNeeded;
        // Byte 14: first sector
        trd[entryOffset + 14] = firstFreeSector;
        // Byte 15: first track
        trd[entryOffset + 15] = firstFreeTrack;

        // Write file data
        let dataOffset = 0;
        let currentTrack = firstFreeTrack;
        let currentSector = firstFreeSector;

        for (let s = 0; s < sectorsNeeded; s++) {
            // Calculate absolute sector position
            const absoluteSector = currentTrack * this.TRD_SECTORS_PER_TRACK + currentSector;
            const sectorOffset = absoluteSector * this.TRD_SECTOR_SIZE;

            // Write sector data (256 bytes or remaining)
            const remaining = data.length - dataOffset;
            const toWrite = Math.min(remaining, this.TRD_SECTOR_SIZE);

            for (let b = 0; b < toWrite; b++) {
                trd[sectorOffset + b] = data[dataOffset + b];
            }
            // Pad remaining sector with zeros (already 0)

            dataOffset += toWrite;

            // Move to next sector
            currentSector++;
            if (currentSector >= this.TRD_SECTORS_PER_TRACK) {
                currentSector = 0;
                currentTrack++;
            }
        }

        // Update disk info
        trd[infoOffset + 0xE1] = currentSector;  // Next free sector
        trd[infoOffset + 0xE2] = currentTrack;   // Next free track
        trd[infoOffset + 0xE4] = fileCount + 1;  // Increment file count

        // Update free sectors count
        const newFreeSectors = freeSectors - sectorsNeeded;
        trd[infoOffset + 0xE5] = newFreeSectors & 0xFF;
        trd[infoOffset + 0xE6] = (newFreeSectors >> 8) & 0xFF;

        return trd;
    },

    // ==================== Raw Binary ====================

    // Generate raw binary output
    raw(bytes, start, length) {
        if (bytes instanceof Uint8Array) {
            if (length !== undefined) {
                return bytes.slice(start || 0, (start || 0) + length);
            }
            return bytes;
        }
        return new Uint8Array(bytes);
    },

    // ==================== TAP Format ====================

    // TAP file structure:
    // Multiple blocks, each: [length_lo, length_hi, ...data...]
    // Data block: [flag, ...data..., checksum]
    // Flag: 0x00 = header, 0xFF = data

    // Calculate TAP checksum (XOR of all bytes)
    tapChecksum(bytes) {
        let checksum = 0;
        for (const byte of bytes) {
            checksum ^= byte;
        }
        return checksum;
    },

    // Create TAP header block
    // type: 0=program, 1=number array, 2=char array, 3=code
    tapHeader(name, type, length, param1, param2) {
        // Pad or truncate name to 10 chars
        const nameBytes = new Uint8Array(10);
        for (let i = 0; i < 10; i++) {
            nameBytes[i] = i < name.length ? name.charCodeAt(i) : 0x20;
        }

        const header = new Uint8Array(19);
        header[0] = 0x00;  // Header flag
        header[1] = type;
        header.set(nameBytes, 2);
        header[12] = length & 0xFF;
        header[13] = (length >> 8) & 0xFF;
        header[14] = param1 & 0xFF;
        header[15] = (param1 >> 8) & 0xFF;
        header[16] = param2 & 0xFF;
        header[17] = (param2 >> 8) & 0xFF;
        header[18] = this.tapChecksum(header.slice(0, 18));

        // Wrap in TAP block
        return this.tapBlock(header);
    },

    // Create TAP data block
    tapData(bytes) {
        const data = new Uint8Array(bytes.length + 2);
        data[0] = 0xFF;  // Data flag
        data.set(bytes, 1);
        data[data.length - 1] = this.tapChecksum(data.slice(0, data.length - 1));
        return this.tapBlock(data);
    },

    // Wrap data in TAP block (add length prefix)
    tapBlock(data) {
        const block = new Uint8Array(data.length + 2);
        block[0] = data.length & 0xFF;
        block[1] = (data.length >> 8) & 0xFF;
        block.set(data, 2);
        return block;
    },

    // Create complete TAP file for CODE block
    // param1 = start address, param2 = optional third param (usually 32768)
    tapCode(name, bytes, startAddr, param2) {
        const header = this.tapHeader(name, 3, bytes.length, startAddr, param2 || 32768);
        const data = this.tapData(bytes);

        const tap = new Uint8Array(header.length + data.length);
        tap.set(header, 0);
        tap.set(data, header.length);
        return tap;
    },

    // Create TAP BASIC program block (type 0)
    // param1 = autorun line (or >= 32768 for no autorun)
    // param2 = length without variables (usually same as length)
    tapBasicProgram(name, bytes, autorunLine, lengthWithoutVars) {
        const autorun = autorunLine || 32768;  // >= 32768 means no autorun
        const progLen = lengthWithoutVars || bytes.length;
        const header = this.tapHeader(name, 0, bytes.length, autorun, progLen);
        const data = this.tapData(bytes);

        const tap = new Uint8Array(header.length + data.length);
        tap.set(header, 0);
        tap.set(data, header.length);
        return tap;
    },

    // Create TAP number array block (type 1)
    // param1 = variable name (A-Z as single char code, e.g., 'A' = 65, stored as 65 | 0x80)
    tapNumbersArray(name, bytes, varLetter) {
        // Variable name stored as (letter | 0x80) in param1 low byte
        const varCode = (varLetter || 0x41) | 0x80;  // Default to 'A'
        const header = this.tapHeader(name, 1, bytes.length, varCode, 0);
        const data = this.tapData(bytes);

        const tap = new Uint8Array(header.length + data.length);
        tap.set(header, 0);
        tap.set(data, header.length);
        return tap;
    },

    // Create TAP character array block (type 2)
    // param1 = variable name (A-Z as single char code, stored as letter | 0xC0)
    tapCharsArray(name, bytes, varLetter) {
        // Variable name stored as (letter | 0xC0) in param1 low byte
        const varCode = (varLetter || 0x41) | 0xC0;  // Default to 'A'
        const header = this.tapHeader(name, 2, bytes.length, varCode, 0);
        const data = this.tapData(bytes);

        const tap = new Uint8Array(header.length + data.length);
        tap.set(header, 0);
        tap.set(data, header.length);
        return tap;
    },

    // Create TAP headerless data block
    // flag = custom block flag (default 0xFF for data)
    tapHeadless(bytes, flag) {
        const blockFlag = (flag !== undefined) ? flag : 0xFF;
        const data = new Uint8Array(bytes.length + 2);
        data[0] = blockFlag;
        data.set(bytes, 1);
        data[data.length - 1] = this.tapChecksum(data.slice(0, data.length - 1));
        return this.tapBlock(data);
    },

    // Create TAP file for BASIC program with loader
    tapBasicLoader(name, codeStart, codeLength, execAddr) {
        // Create a simple BASIC loader:
        // 10 CLEAR VAL "xxxxx": LOAD "" CODE: RANDOMIZE USR VAL "xxxxx"
        const clearAddr = codeStart - 1;

        // Build BASIC line
        const line = [];

        // Line number (10) - 2 bytes big endian
        line.push(0x00, 0x0A);

        // Line length placeholder
        const lenPos = line.length;
        line.push(0x00, 0x00);

        // CLEAR VAL "xxxxx"
        line.push(0xFD);  // CLEAR
        line.push(0xB0);  // VAL
        line.push(0x22);  // "
        const clearStr = clearAddr.toString();
        for (const ch of clearStr) line.push(ch.charCodeAt(0));
        line.push(0x22);  // "
        line.push(0x3A);  // :

        // LOAD "" CODE
        line.push(0xEF);  // LOAD
        line.push(0x22, 0x22);  // ""
        line.push(0xAF);  // CODE
        line.push(0x3A);  // :

        // RANDOMIZE USR VAL "xxxxx"
        line.push(0xF9);  // RANDOMIZE
        line.push(0xC0);  // USR
        line.push(0xB0);  // VAL
        line.push(0x22);  // "
        const execStr = (execAddr || codeStart).toString();
        for (const ch of execStr) line.push(ch.charCodeAt(0));
        line.push(0x22);  // "

        // End of line
        line.push(0x0D);

        // Fill in line length (excluding line number and length bytes)
        const lineLen = line.length - 4;
        line[lenPos] = lineLen & 0xFF;
        line[lenPos + 1] = (lineLen >> 8) & 0xFF;

        const basicBytes = new Uint8Array(line);

        // BASIC header: type 0, param1 = autostart line (10), param2 = program length
        const header = this.tapHeader(name, 0, basicBytes.length, 10, basicBytes.length);
        const data = this.tapData(basicBytes);

        const tap = new Uint8Array(header.length + data.length);
        tap.set(header, 0);
        tap.set(data, header.length);
        return tap;
    },

    // Combine multiple TAP blocks
    tapCombine(...blocks) {
        const totalLen = blocks.reduce((sum, b) => sum + b.length, 0);
        const result = new Uint8Array(totalLen);
        let offset = 0;
        for (const block of blocks) {
            result.set(block, offset);
            offset += block.length;
        }
        return result;
    },

    // ==================== SNA Format ====================

    // SNA 48K structure: 27 byte header + 48K RAM
    // SNA 128K: 27 byte header + 48K (pages 5,2,current) + 4 bytes + remaining pages

    // Spectrum ROM default system variables ($5C00-$5CFF)
    // These are the values after BASIC initialization
    SYSVARS_DEFAULTS: new Uint8Array([
        0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0x14, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x06, 0x00, 0x0b, 0x00, 0x01, 0x00, 0x01, 0x00, 0x06, 0x00, 0x10, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3c, 0x40, 0x00, 0xff, 0xcc, 0x01, 0x58, 0x5d, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x38, 0x00, 0x00, 0xcb, 0x5c, 0x00, 0x00, 0xb6,
        0x5c, 0xb6, 0x5c, 0xcb, 0x5c, 0x00, 0x00, 0xca, 0x5c, 0xcc, 0x5c, 0xcc, 0x5c, 0xcc, 0x5c, 0x00,
        0x00, 0xce, 0x5c, 0xce, 0x5c, 0xce, 0x5c, 0x00, 0x92, 0x5c, 0x10, 0x02, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x58, 0xff, 0x00, 0x00, 0x21,
        0x5b, 0x00, 0x21, 0x17, 0x00, 0x40, 0xe0, 0x50, 0x21, 0x18, 0x21, 0x17, 0x01, 0x38, 0x00, 0x38,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x5b, 0x5d, 0xff, 0xff, 0xf4, 0x09, 0xa8, 0x10, 0x4b, 0xf4, 0x09, 0xc4, 0x15, 0x53,
        0x81, 0x0f, 0xc4, 0x15, 0x52, 0xf4, 0x09, 0xc4, 0x15, 0x50, 0x80, 0x80, 0x0d, 0x80, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]),

    // Workspace area defaults ($5D00-$5D5F) - stack area after BASIC init
    // These bytes appear just above the default SP location at $5D56
    WORKSPACE_DEFAULTS: new Uint8Array([
        // $5D00-$5D0F
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // $5D10-$5D1F
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // $5D20-$5D2F
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // $5D30-$5D3F
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // $5D40-$5D4F
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // $5D50-$5D5F (SP at $5D56, bytes after SP location from ROM state)
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x13, 0x00, 0x3e, 0x00, 0x00, 0x00, 0x00
    ]),

    // UDG defaults ($FF58-$FFFF) - 21 user defined graphics (A-U character patterns)
    UDG_DEFAULTS: new Uint8Array([
        0x00, 0x3c, 0x42, 0x42, 0x7e, 0x42, 0x42, 0x00,  // A
        0x00, 0x7c, 0x42, 0x7c, 0x42, 0x42, 0x7c, 0x00,  // B
        0x00, 0x3c, 0x42, 0x40, 0x40, 0x42, 0x3c, 0x00,  // C
        0x00, 0x78, 0x44, 0x42, 0x42, 0x44, 0x78, 0x00,  // D
        0x00, 0x7e, 0x40, 0x7c, 0x40, 0x40, 0x7e, 0x00,  // E
        0x00, 0x7e, 0x40, 0x7c, 0x40, 0x40, 0x40, 0x00,  // F
        0x00, 0x3c, 0x42, 0x40, 0x4e, 0x42, 0x3c, 0x00,  // G
        0x00, 0x42, 0x42, 0x7e, 0x42, 0x42, 0x42, 0x00,  // H
        0x00, 0x3e, 0x08, 0x08, 0x08, 0x08, 0x3e, 0x00,  // I
        0x00, 0x02, 0x02, 0x02, 0x42, 0x42, 0x3c, 0x00,  // J
        0x00, 0x44, 0x48, 0x70, 0x48, 0x44, 0x42, 0x00,  // K
        0x00, 0x40, 0x40, 0x40, 0x40, 0x40, 0x7e, 0x00,  // L
        0x00, 0x42, 0x66, 0x5a, 0x42, 0x42, 0x42, 0x00,  // M
        0x00, 0x42, 0x62, 0x52, 0x4a, 0x46, 0x42, 0x00,  // N
        0x00, 0x3c, 0x42, 0x42, 0x42, 0x42, 0x3c, 0x00,  // O
        0x00, 0x7c, 0x42, 0x42, 0x7c, 0x40, 0x40, 0x00,  // P
        0x00, 0x3c, 0x42, 0x42, 0x52, 0x4a, 0x3c, 0x00,  // Q
        0x00, 0x7c, 0x42, 0x42, 0x7c, 0x44, 0x42, 0x00,  // R
        0x00, 0x3c, 0x40, 0x3c, 0x02, 0x42, 0x3c, 0x00,  // S
        0x00, 0xfe, 0x10, 0x10, 0x10, 0x10, 0x10, 0x00,  // T
        0x00, 0x42, 0x42, 0x42, 0x42, 0x42, 0x3c, 0x00   // U
    ]),

    sna48(memory, regs = {}) {
        const sna = new Uint8Array(27 + 0xC000);  // Header + 48K

        // Default register values - matching Spectrum ROM state after BASIC init
        const r = {
            I: 0x3F,
            HLalt: 0x2758, DEalt: 0x369B, BCalt: 0x0000, AFalt: 0x0044,
            HL: 0x2D2B, DE: 0x5CDC, BC: 0x8B20,
            IY: 0x5C3A, IX: 0xFF3C,
            IFF2: 0,  // bit 2 = IFF2
            R: 0,
            AF: 0x0054,
            SP: 0x5D56,  // Typical SP after BASIC init
            IM: 1,
            border: 7,
            PC: null,  // If set, push to stack
            initSysVars: false,  // Don't initialize system variables by default
            initUDG: false,      // Don't initialize UDG by default
            initScreenAttrs: true,  // Initialize screen attributes by default
            ...regs
        };

        // Header (27 bytes)
        let i = 0;
        sna[i++] = r.I;
        sna[i++] = r.HLalt & 0xFF; sna[i++] = (r.HLalt >> 8) & 0xFF;
        sna[i++] = r.DEalt & 0xFF; sna[i++] = (r.DEalt >> 8) & 0xFF;
        sna[i++] = r.BCalt & 0xFF; sna[i++] = (r.BCalt >> 8) & 0xFF;
        sna[i++] = r.AFalt & 0xFF; sna[i++] = (r.AFalt >> 8) & 0xFF;
        sna[i++] = r.HL & 0xFF; sna[i++] = (r.HL >> 8) & 0xFF;
        sna[i++] = r.DE & 0xFF; sna[i++] = (r.DE >> 8) & 0xFF;
        sna[i++] = r.BC & 0xFF; sna[i++] = (r.BC >> 8) & 0xFF;
        sna[i++] = r.IY & 0xFF; sna[i++] = (r.IY >> 8) & 0xFF;
        sna[i++] = r.IX & 0xFF; sna[i++] = (r.IX >> 8) & 0xFF;
        sna[i++] = r.IFF2 ? 0x04 : 0x00;
        sna[i++] = r.R;
        sna[i++] = r.AF & 0xFF; sna[i++] = (r.AF >> 8) & 0xFF;

        // RAM: 48K from $4000-$FFFF
        if (memory instanceof Uint8Array) {
            // Direct byte array - assume it's from $4000
            sna.set(memory.slice(0, 0xC000), 27);
        } else if (memory.getRange) {
            // Memory object
            const ram = memory.getRange(0x4000, 0xC000);
            sna.set(ram, 27);
        }

        // Initialize system variables only if explicitly requested
        // System variables at $5C00-$5CFF, SNA offset = 27 + ($5C00 - $4000) = 27 + 0x1C00
        if (r.initSysVars === true) {
            const sysVarsOffset = 27 + 0x1C00;
            sna.set(this.SYSVARS_DEFAULTS, sysVarsOffset);

            // Also initialize workspace area at $5D00-$5D5F
            const workspaceOffset = 27 + 0x1D00;
            sna.set(this.WORKSPACE_DEFAULTS, workspaceOffset);
        }

        // Initialize screen attributes to default (0x38 = white on black)
        // Screen attrs at $5800-$5AFF, SNA offset = 27 + ($5800 - $4000) = 27 + 0x1800
        if (r.initScreenAttrs !== false) {
            const attrOffset = 27 + 0x1800;
            for (let i = 0; i < 768; i++) {
                // Only initialize if not already set by code (check if zero)
                if (sna[attrOffset + i] === 0) {
                    sna[attrOffset + i] = 0x38;  // Default: white ink, black paper
                }
            }
        }

        // Initialize UDG area separately (can be disabled if code overlaps UDG region)
        if (r.initUDG === true) {
            // UDG area at $FF58-$FFFF, SNA offset = 27 + ($FF58 - $4000) = 27 + 0xBF58
            const udgOffset = 27 + 0xBF58;
            sna.set(this.UDG_DEFAULTS, udgOffset);
        }

        // Handle PC - SNA 48K stores PC at SP location (loader does RETN to jump there)
        let sp = r.SP;
        if (r.PC !== null && r.PC !== undefined) {
            // Write PC at SP location (no pre-decrement - SNA loader will RETN from SP)
            if (sp >= 0x4000 && sp < 0xFFFF) {
                // Write PC to RAM in SNA (offset 27 is $4000)
                const ramOffset = sp - 0x4000;
                sna[27 + ramOffset] = r.PC & 0xFF;
                sna[27 + ramOffset + 1] = (r.PC >> 8) & 0xFF;
            }
        }

        // Write SP to header (points to PC location)
        sna[23] = sp & 0xFF;
        sna[24] = (sp >> 8) & 0xFF;

        sna[25] = r.IM;
        sna[26] = r.border;

        return sna;
    },

    sna128(memory, regs = {}, port7FFD = 0) {
        // 128K SNA: header + 48K + extended header + remaining pages
        const headerSize = 27;
        const extHeaderSize = 4;
        const pageSize = 0x4000;

        // Start with 48K format header + initial RAM
        const mainPart = new Uint8Array(headerSize + 3 * pageSize + extHeaderSize + 5 * pageSize);

        // Default register values - matching Spectrum ROM state after BASIC init
        const r = {
            I: 0x3F,
            HLalt: 0x2758, DEalt: 0x369B, BCalt: 0x0000, AFalt: 0x0044,
            HL: 0x2D2B, DE: 0x5CDC, BC: 0x0000,
            IY: 0x5C3A, IX: 0xFF3C,
            IFF2: 0, R: 0,
            AF: 0x0054, SP: 0x5D58,
            IM: 1, border: 7,
            PC: 0,
            initSysVars: false,
            initUDG: false,
            initScreenAttrs: true,
            ...regs
        };

        let i = 0;
        mainPart[i++] = r.I;
        mainPart[i++] = r.HLalt & 0xFF; mainPart[i++] = (r.HLalt >> 8) & 0xFF;
        mainPart[i++] = r.DEalt & 0xFF; mainPart[i++] = (r.DEalt >> 8) & 0xFF;
        mainPart[i++] = r.BCalt & 0xFF; mainPart[i++] = (r.BCalt >> 8) & 0xFF;
        mainPart[i++] = r.AFalt & 0xFF; mainPart[i++] = (r.AFalt >> 8) & 0xFF;
        mainPart[i++] = r.HL & 0xFF; mainPart[i++] = (r.HL >> 8) & 0xFF;
        mainPart[i++] = r.DE & 0xFF; mainPart[i++] = (r.DE >> 8) & 0xFF;
        mainPart[i++] = r.BC & 0xFF; mainPart[i++] = (r.BC >> 8) & 0xFF;
        mainPart[i++] = r.IY & 0xFF; mainPart[i++] = (r.IY >> 8) & 0xFF;
        mainPart[i++] = r.IX & 0xFF; mainPart[i++] = (r.IX >> 8) & 0xFF;
        mainPart[i++] = r.IFF2 ? 0x04 : 0x00;
        mainPart[i++] = r.R;
        mainPart[i++] = r.AF & 0xFF; mainPart[i++] = (r.AF >> 8) & 0xFF;
        mainPart[i++] = r.SP & 0xFF; mainPart[i++] = (r.SP >> 8) & 0xFF;
        mainPart[i++] = r.IM;
        mainPart[i++] = r.border;

        // First 48K: pages 5, 2, and current page at $C000
        const currentPage = port7FFD & 0x07;
        let offset = headerSize;

        if (memory.getPage) {
            // Page 5 at $4000
            const page5 = memory.getPage(5);
            if (page5) mainPart.set(page5, offset);
            offset += pageSize;
            // Page 2 at $8000
            const page2 = memory.getPage(2);
            if (page2) mainPart.set(page2, offset);
            offset += pageSize;
            // Current page at $C000
            const pageCurrent = memory.getPage(currentPage);
            if (pageCurrent) mainPart.set(pageCurrent, offset);
            offset += pageSize;
        }

        // Initialize screen attributes to default (0x38 = white on black)
        // Screen attrs at $5800-$5AFF, which is offset $1800 within page 5
        // Page 5 starts at headerSize (27) in mainPart
        if (r.initScreenAttrs !== false) {
            const attrOffset = headerSize + 0x1800;
            for (let i = 0; i < 768; i++) {
                // Only initialize if not already set by code (check if zero)
                if (mainPart[attrOffset + i] === 0) {
                    mainPart[attrOffset + i] = 0x38;  // Default: white ink, black paper
                }
            }
        }

        // Initialize system variables at $5C00-$5CFF (offset $1C00 in page 5)
        if (r.initSysVars === true) {
            const sysVarsOffset = headerSize + 0x1C00;
            mainPart.set(this.SYSVARS_DEFAULTS, sysVarsOffset);

            // Also initialize workspace area at $5D00-$5D5F
            const workspaceOffset = headerSize + 0x1D00;
            mainPart.set(this.WORKSPACE_DEFAULTS, workspaceOffset);
        }

        // Initialize UDG area at $FF58-$FFFF
        // For 128K, UDG is in page 1 (upper 16K at $C000-$FFFF maps to pages)
        // But the initial 48K snapshot area has $FF58 at offset $BF58 in page 5 area
        // Actually for 128K, we need to handle this differently - UDG can be in different pages
        if (r.initUDG === true && memory.getPage) {
            // For now, skip UDG init in 128K mode as it's complex
            // The program likely initializes its own UDG
        }

        // Extended header
        mainPart[offset++] = r.PC & 0xFF;
        mainPart[offset++] = (r.PC >> 8) & 0xFF;
        mainPart[offset++] = port7FFD;
        mainPart[offset++] = 0;  // TR-DOS not paged

        // Remaining pages (0,1,3,4,6,7 - excluding 2,5,current)
        const pagesWritten = [2, 5, currentPage];
        for (let page = 0; page < 8; page++) {
            if (!pagesWritten.includes(page)) {
                if (memory.getPage) {
                    const pageData = memory.getPage(page);
                    if (pageData) mainPart.set(pageData, offset);
                }
                offset += pageSize;
            }
        }

        return mainPart.slice(0, offset);
    },

    // ==================== Utility ====================

    // Convert Uint8Array to downloadable blob
    toBlob(bytes, mimeType = 'application/octet-stream') {
        return new Blob([bytes], { type: mimeType });
    },

    // Create download URL
    toDownloadUrl(bytes, mimeType = 'application/octet-stream') {
        const blob = this.toBlob(bytes, mimeType);
        return URL.createObjectURL(blob);
    },

    // Trigger download in browser
    download(bytes, filename, mimeType = 'application/octet-stream') {
        const url = this.toDownloadUrl(bytes, mimeType);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
};
