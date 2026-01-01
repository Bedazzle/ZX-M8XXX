/**
 * ZX-M8XXX - File Loaders (TAP, SNA, Z80, TRD, SCL)
 * @version 0.6.4
 * @license GPL-3.0
 */

(function(global) {
    'use strict';

    const VERSION = '0.6.4';

    class TapeLoader {
        static get VERSION() { return VERSION; }
        
        constructor() {
            this.data = null;
            this.blocks = [];
            this.currentBlock = 0;
        }
        
        load(data) {
            this.data = new Uint8Array(data);
            this.blocks = [];
            this.currentBlock = 0;
            
            let offset = 0;
            while (offset < this.data.length - 1) {
                const length = this.data[offset] | (this.data[offset + 1] << 8);
                offset += 2;
                if (offset + length > this.data.length) break;
                this.blocks.push({
                    flag: this.data[offset],
                    data: this.data.slice(offset, offset + length),
                    length: length
                });
                offset += length;
            }
            return this.blocks.length > 0;
        }
        
        getNextBlock() {
            if (this.currentBlock >= this.blocks.length) return null;
            return this.blocks[this.currentBlock++];
        }
        
        rewind() { this.currentBlock = 0; }
        getBlockCount() { return this.blocks.length; }
        hasMoreBlocks() { return this.currentBlock < this.blocks.length; }
        getCurrentBlock() { return this.currentBlock; }
        setCurrentBlock(n) { this.currentBlock = Math.max(0, Math.min(n, this.blocks.length)); }
    }

    class SnapshotLoader {
        static get VERSION() { return VERSION; }
        
        constructor() {
            this.machineType = '48k';
        }
        
        detectType(data, filename = '') {
            const ext = filename.toLowerCase().split('.').pop();
            if (ext === 'sna') return 'sna';
            if (ext === 'tap') return 'tap';
            if (ext === 'z80') return 'z80';
            if (ext === 'rzx') return 'rzx';
            if (ext === 'trd') return 'trd';
            if (ext === 'scl') return 'scl';

            const bytes = new Uint8Array(data);

            // Check for RZX signature
            if (RZXLoader.isRZX(data)) return 'rzx';

            // Check for SCL signature
            if (SCLLoader.isSCL(data)) return 'scl';

            // Check for TRD format
            if (TRDLoader.isTRD(data)) return 'trd';

            if (bytes.length === 49179 || bytes.length === 131103 || bytes.length === 147487) return 'sna';
            if (bytes.length > 30 && (bytes[6] === 0 || bytes[6] === 0xff)) return 'z80';
            if (bytes.length > 2) {
                const len = bytes[0] | (bytes[1] << 8);
                if (len > 0 && len < bytes.length) return 'tap';
            }
            return null;
        }
        
        loadSNA48(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length < 49179) throw new Error('Invalid SNA file');
            
            cpu.i = bytes[0];
            cpu.l_ = bytes[1]; cpu.h_ = bytes[2];
            cpu.e_ = bytes[3]; cpu.d_ = bytes[4];
            cpu.c_ = bytes[5]; cpu.b_ = bytes[6];
            cpu.f_ = bytes[7]; cpu.a_ = bytes[8];
            cpu.l = bytes[9]; cpu.h = bytes[10];
            cpu.e = bytes[11]; cpu.d = bytes[12];
            cpu.c = bytes[13]; cpu.b = bytes[14];
            cpu.iy = bytes[15] | (bytes[16] << 8);
            cpu.ix = bytes[17] | (bytes[18] << 8);
            cpu.iff2 = (bytes[19] & 0x04) !== 0;
            cpu.iff1 = cpu.iff2;
            cpu.rFull = bytes[20];
            cpu.f = bytes[21]; cpu.a = bytes[22];
            cpu.sp = bytes[23] | (bytes[24] << 8);
            cpu.im = bytes[25];
            const border = bytes[26] & 0x07;
            
            for (let i = 0; i < 49152; i++) {
                memory.write(0x4000 + i, bytes[27 + i]);
            }
            
            cpu.pc = memory.read(cpu.sp) | (memory.read(cpu.sp + 1) << 8);
            cpu.sp = (cpu.sp + 2) & 0xffff;
            this.machineType = '48k';
            return { border, machineType: '48k' };
        }
        
        loadSNA128(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length < 49181) return this.loadSNA48(data, cpu, memory);

            // For 128K, we need to set paging BEFORE loading 48KB section
            // Otherwise the wrong bank gets written at C000
            const offset = 49179;
            const pagingByte = bytes[offset + 2];
            const currentBank = pagingByte & 0x07;

            // Apply paging first so 48KB section writes to correct banks
            memory.writePaging(pagingByte);

            // Load header (same as 48K)
            cpu.i = bytes[0];
            cpu.l_ = bytes[1]; cpu.h_ = bytes[2];
            cpu.e_ = bytes[3]; cpu.d_ = bytes[4];
            cpu.c_ = bytes[5]; cpu.b_ = bytes[6];
            cpu.f_ = bytes[7]; cpu.a_ = bytes[8];
            cpu.l = bytes[9]; cpu.h = bytes[10];
            cpu.e = bytes[11]; cpu.d = bytes[12];
            cpu.c = bytes[13]; cpu.b = bytes[14];
            cpu.iy = bytes[15] | (bytes[16] << 8);
            cpu.ix = bytes[17] | (bytes[18] << 8);
            cpu.iff2 = (bytes[19] & 0x04) !== 0;
            cpu.iff1 = cpu.iff2;
            cpu.rFull = bytes[20];
            cpu.f = bytes[21]; cpu.a = bytes[22];
            cpu.sp = bytes[23] | (bytes[24] << 8);
            cpu.im = bytes[25];
            const border = bytes[26] & 0x07;

            // Now load 48KB section (banks 5, 2, and currently paged bank)
            for (let i = 0; i < 49152; i++) {
                memory.write(0x4000 + i, bytes[27 + i]);
            }

            // Load PC from 128K extension
            cpu.pc = bytes[offset] | (bytes[offset + 1] << 8);

            // Load remaining banks (excluding the current one which is in 48KB section)
            const banksToLoad = [0, 1, 3, 4, 6, 7].filter(b => b !== currentBank);
            // Only load as many banks as are present in the file (max 5)
            const availableBanks = Math.floor((bytes.length - offset - 4) / 16384);
            const banksToActuallyLoad = banksToLoad.slice(0, Math.min(banksToLoad.length, availableBanks));
            let bankOffset = offset + 4;
            for (const bankNum of banksToActuallyLoad) {
                if (bankOffset + 16384 > bytes.length) break;
                const ramBank = memory.getRamBank(bankNum);
                ramBank.set(bytes.slice(bankOffset, bankOffset + 16384));
                bankOffset += 16384;
            }
            this.machineType = '128k';
            return { border, machineType: '128k' };
        }
        
        loadSNA(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length === 49179) return this.loadSNA48(data, cpu, memory);
            if (bytes.length > 49179) return this.loadSNA128(data, cpu, memory);
            throw new Error('Invalid SNA file');
        }
        
        createSNA(cpu, memory, border = 7) {
            const is128k = memory.machineType !== '48k';
            const size = is128k ? 131103 : 49179;
            const bytes = new Uint8Array(size);
            
            bytes[0] = cpu.i;
            bytes[1] = cpu.l_; bytes[2] = cpu.h_;
            bytes[3] = cpu.e_; bytes[4] = cpu.d_;
            bytes[5] = cpu.c_; bytes[6] = cpu.b_;
            bytes[7] = cpu.f_; bytes[8] = cpu.a_;
            bytes[9] = cpu.l; bytes[10] = cpu.h;
            bytes[11] = cpu.e; bytes[12] = cpu.d;
            bytes[13] = cpu.c; bytes[14] = cpu.b;
            bytes[15] = cpu.iy & 0xff; bytes[16] = (cpu.iy >> 8) & 0xff;
            bytes[17] = cpu.ix & 0xff; bytes[18] = (cpu.ix >> 8) & 0xff;
            bytes[19] = cpu.iff2 ? 0x04 : 0x00;
            bytes[20] = cpu.rFull;
            bytes[21] = cpu.f; bytes[22] = cpu.a;
            
            let sp = cpu.sp;
            if (!is128k) {
                sp = (sp - 2) & 0xffff;
                memory.write(sp, cpu.pc & 0xff);
                memory.write(sp + 1, (cpu.pc >> 8) & 0xff);
            }
            bytes[23] = sp & 0xff; bytes[24] = (sp >> 8) & 0xff;
            bytes[25] = cpu.im;
            bytes[26] = border & 0x07;
            
            for (let i = 0; i < 49152; i++) {
                bytes[27 + i] = memory.read(0x4000 + i);
            }
            
            if (is128k) {
                const offset = 49179;
                bytes[offset] = cpu.pc & 0xff;
                bytes[offset + 1] = (cpu.pc >> 8) & 0xff;
                const ps = memory.getPagingState();
                bytes[offset + 2] = (ps.ramBank & 0x07) | (ps.screenBank === 7 ? 0x08 : 0x00) |
                                    (ps.romBank ? 0x10 : 0x00) | (ps.pagingDisabled ? 0x20 : 0x00);
                bytes[offset + 3] = 0;
                // Save remaining banks (excluding those in the 48KB section)
                // 48KB section always has: bank 5 (4000-7FFF), bank 2 (8000-BFFF), and current bank (C000-FFFF)
                const currentBank = ps.ramBank;
                // Banks 2 and 5 are always in 48KB, plus the current bank at C000
                // Only save banks from [0,1,3,4,6,7] that aren't the current bank
                const banksToSave = [0, 1, 3, 4, 6, 7].filter(b => b !== currentBank);
                // Limit to 5 banks max to fit in 131103 byte format
                const banksToActuallySave = banksToSave.slice(0, 5);
                let bankOffset = offset + 4;
                for (const bankNum of banksToActuallySave) {
                    bytes.set(memory.getRamBank(bankNum), bankOffset);
                    bankOffset += 16384;
                }
            }
            return bytes;
        }
        
        // Z80 format loader
        loadZ80(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length < 30) throw new Error('Invalid Z80 file');
            
            // Read v1 header
            cpu.a = bytes[0];
            cpu.f = bytes[1];
            cpu.c = bytes[2]; cpu.b = bytes[3];
            cpu.l = bytes[4]; cpu.h = bytes[5];
            let pc = bytes[6] | (bytes[7] << 8);
            cpu.sp = bytes[8] | (bytes[9] << 8);
            cpu.i = bytes[10];
            cpu.rFull = (bytes[11] & 0x7f) | ((bytes[12] & 0x01) << 7);
            
            const byte12 = bytes[12];
            const border = (byte12 >> 1) & 0x07;
            const compressed = (byte12 & 0x20) !== 0;
            
            cpu.e = bytes[13]; cpu.d = bytes[14];
            cpu.c_ = bytes[15]; cpu.b_ = bytes[16];
            cpu.e_ = bytes[17]; cpu.d_ = bytes[18];
            cpu.h_ = bytes[19]; cpu.l_ = bytes[20];
            cpu.a_ = bytes[21]; cpu.f_ = bytes[22];
            cpu.iy = bytes[23] | (bytes[24] << 8);
            cpu.ix = bytes[25] | (bytes[26] << 8);
            cpu.iff1 = bytes[27] !== 0;
            cpu.iff2 = bytes[28] !== 0;
            cpu.im = bytes[29] & 0x03;
            
            // Determine version
            if (pc !== 0) {
                // Version 1 - 48K only
                cpu.pc = pc;
                const memData = this.decompressZ80Block(bytes.subarray(30), 49152, compressed);
                for (let i = 0; i < memData.length; i++) {
                    memory.write(0x4000 + i, memData[i]);
                }
                this.machineType = '48k';
                return { border, machineType: '48k' };
            }
            
            // Version 2 or 3
            const extHeaderLen = bytes[30] | (bytes[31] << 8);
            cpu.pc = bytes[32] | (bytes[33] << 8);
            
            const hwMode = bytes[34];
            let machineType = '48k';
            
            // Determine machine type from hardware mode
            if (extHeaderLen === 23) {
                // Version 2
                if (hwMode === 3 || hwMode === 4) machineType = '128k';
            } else {
                // Version 3
                if (hwMode === 4 || hwMode === 5 || hwMode === 6) machineType = '128k';
            }
            
            // Read 128K port 0x7FFD if applicable
            if (machineType === '128k' && bytes.length > 35) {
                memory.writePaging(bytes[35]);
            }
            
            // Load memory pages
            let offset = 32 + extHeaderLen;
            while (offset < bytes.length - 3) {
                const blockLen = bytes[offset] | (bytes[offset + 1] << 8);
                const pageNum = bytes[offset + 2];
                offset += 3;
                
                if (offset + (blockLen === 0xffff ? 16384 : blockLen) > bytes.length) break;
                
                const isCompressed = blockLen !== 0xffff;
                const rawLen = isCompressed ? blockLen : 16384;
                const blockData = bytes.subarray(offset, offset + rawLen);
                const pageData = isCompressed ? 
                    this.decompressZ80Block(blockData, 16384, true) : blockData;
                
                this.loadZ80Page(pageNum, pageData, memory, machineType);
                offset += rawLen;
            }
            
            this.machineType = machineType;
            return { border, machineType };
        }
        
        decompressZ80Block(data, maxLen, compressed) {
            if (!compressed) {
                return data.slice(0, maxLen);
            }
            
            const result = new Uint8Array(maxLen);
            let srcIdx = 0;
            let dstIdx = 0;
            
            while (srcIdx < data.length && dstIdx < maxLen) {
                if (srcIdx + 3 < data.length && 
                    data[srcIdx] === 0xED && data[srcIdx + 1] === 0xED) {
                    // ED ED nn xx = repeat byte xx nn times
                    const count = data[srcIdx + 2];
                    const value = data[srcIdx + 3];
                    for (let i = 0; i < count && dstIdx < maxLen; i++) {
                        result[dstIdx++] = value;
                    }
                    srcIdx += 4;
                } else if (data[srcIdx] === 0x00 && srcIdx + 3 < data.length &&
                           data[srcIdx + 1] === 0xED && data[srcIdx + 2] === 0xED &&
                           data[srcIdx + 3] === 0x00) {
                    // End marker (v1 only)
                    break;
                } else {
                    result[dstIdx++] = data[srcIdx++];
                }
            }
            
            return result.slice(0, dstIdx);
        }
        
        loadZ80Page(pageNum, data, memory, machineType) {
            // Map page numbers to memory addresses/banks
            // Page numbers differ between 48K and 128K modes
            if (machineType === '48k') {
                switch (pageNum) {
                    case 4: // 0x8000-0xBFFF
                        for (let i = 0; i < data.length && i < 16384; i++) {
                            memory.write(0x8000 + i, data[i]);
                        }
                        break;
                    case 5: // 0xC000-0xFFFF  
                        for (let i = 0; i < data.length && i < 16384; i++) {
                            memory.write(0xC000 + i, data[i]);
                        }
                        break;
                    case 8: // 0x4000-0x7FFF
                        for (let i = 0; i < data.length && i < 16384; i++) {
                            memory.write(0x4000 + i, data[i]);
                        }
                        break;
                }
            } else {
                // 128K mode - page numbers 3-10 map to RAM banks 0-7
                const bankNum = pageNum - 3;
                if (bankNum >= 0 && bankNum <= 7) {
                    const ramBank = memory.getRamBank(bankNum);
                    if (ramBank) {
                        ramBank.set(data.subarray(0, Math.min(data.length, 16384)));
                    }
                }
            }
        }
    }

    class TapeTrapHandler {
        static get VERSION() { return VERSION; }
        
        constructor(cpu, memory, tapeLoader) {
            this.cpu = cpu;
            this.memory = memory;
            this.tapeLoader = tapeLoader;
            this.enabled = true;
        }
        
        checkTrap() {
            if (!this.enabled || !this.tapeLoader) return false;
            const pc = this.cpu.pc;
            // LD-BYTES entry points in 48K ROM / 128K ROM1
            if (pc === 0x056c || pc === 0x0556) {
                return this.handleLoadTrap();
            }
            return false;
        }
        
        handleLoadTrap() {
            const block = this.tapeLoader.getNextBlock();
            if (!block) { this.cpu.f &= ~0x01; return true; }
            
            const dest = this.cpu.ix;
            const length = this.cpu.de;
            const expectedFlag = this.cpu.a;
            const isLoad = (this.cpu.f & 0x01) !== 0;
            
            if (block.flag !== expectedFlag) {
                this.cpu.f &= ~0x01;
                this.returnFromTrap();
                return true;
            }
            
            let checksum = 0;
            for (let i = 0; i < block.data.length; i++) checksum ^= block.data[i];
            if (checksum !== 0) {
                this.cpu.f &= ~0x01;
                this.returnFromTrap();
                return true;
            }
            
            if (isLoad) {
                const dataLength = Math.min(length, block.data.length - 2);
                for (let i = 0; i < dataLength; i++) {
                    this.memory.write(dest + i, block.data[1 + i]);
                }
                // Update IX to point past loaded data (as ROM does)
                this.cpu.ix = (dest + dataLength) & 0xffff;
                // Update DE to remaining bytes (should be 0 on success)
                this.cpu.de = (length - dataLength) & 0xffff;
            }
            this.cpu.f |= 0x01;
            this.returnFromTrap();
            return true;
        }
        
        returnFromTrap() {
            const retAddr = this.memory.read(this.cpu.sp) | (this.memory.read(this.cpu.sp + 1) << 8);
            this.cpu.sp = (this.cpu.sp + 2) & 0xffff;
            this.cpu.pc = retAddr;
        }
        
        setTape(tapeLoader) { this.tapeLoader = tapeLoader; }
        setEnabled(enabled) { this.enabled = enabled; }
    }

    /**
     * TR-DOS trap handler - intercepts TR-DOS ROM calls
     * Provides disk emulation without full Beta Disk hardware emulation
     */
    class TRDOSTrapHandler {
        static get VERSION() { return VERSION; }

        constructor(cpu, memory) {
            this.cpu = cpu;
            this.memory = memory;
            this.diskData = null;
            this.diskFiles = null;
            this.diskType = null;
            this.enabled = true;
            this.lastLoadedFile = null;
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

            // If TR-DOS ROM is loaded, don't trap - let real TR-DOS handle everything
            // The trap is only useful as a fallback when TR-DOS ROM isn't available
            if (this.memory.hasTrdosRom && this.memory.hasTrdosRom()) {
                return false;
            }

            // Only trigger trap when TR-DOS ROM is paged in (via automatic Beta Disk paging)
            // This prevents false triggers when main ROM is active
            if (this.memory.machineType !== '48k' && !this.memory.trdosActive) {
                return false;
            }

            const pc = this.cpu.pc;

            // TR-DOS entry point #3D13 (RANDOMIZE USR 15619)
            // This is called by BASIC when executing TR-DOS commands
            if (pc === 0x3D13) {
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
    class BetaDisk {
        static get VERSION() { return VERSION; }

        constructor() {
            this.diskData = null;      // Current disk image (Uint8Array)
            this.diskType = null;      // 'trd' or 'scl'

            // WD1793 registers
            this.command = 0;
            this.status = 0;
            this.track = 0;
            this.sector = 1;           // Sectors are 1-based in TR-DOS
            this.data = 0;

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

            // Index pulse simulation (for disk presence detection)
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
        }

        // Load disk image
        loadDisk(data, type) {
            if (type === 'scl') {
                // Convert SCL to TRD format
                this.diskData = this.sclToTrd(data);
            } else {
                this.diskData = new Uint8Array(data);
            }
            this.diskType = 'trd';
            this.status = 0;           // Disk ready
            this.track = 0;
            this.sector = 1;
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
            console.log(`[SCL->TRD] Converting SCL with ${fileCount} files, total size ${scl.length} bytes`);

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
                const nameStr = String.fromCharCode(...file.name).trim();
                const typeChar = String.fromCharCode(file.type);
                console.log(`[SCL] Header ${i}: "${nameStr}" type='${typeChar}' start=${file.start} len=${file.length} sectors=${file.sectorCount}`);
                headerOffset += 14;
            }

            // File data starts after all headers
            let dataOffset = headerOffset;
            console.log(`[SCL->TRD] Headers end at offset ${headerOffset}, data starts at offset ${dataOffset}`);

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

                // Log first 16 bytes of file data for verification
                const preview = Array.from(scl.slice(dataOffset, dataOffset + 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                console.log(`[SCL->TRD] File ${i} "${nameStr}": SCL[${dataOffset}] -> TRD[${trdDataOffset}] (logTrack=${logTrack} sector=${logSector}), first bytes: ${preview}`);

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
            const freeSectors = 2544 - trdSector;
            trd[sector9 + 0xE5] = freeSectors & 0xFF;
            trd[sector9 + 0xE6] = (freeSectors >> 8) & 0xFF;
            trd[sector9 + 0xE7] = 0x10;       // TR-DOS ID

            // Disk label at 0xF5-0xFC (8 bytes, space-padded)
            const label = "        ";  // 8 spaces
            for (let i = 0; i < 8; i++) {
                trd[sector9 + 0xF5 + i] = label.charCodeAt(i);
            }

            console.log(`[SCL->TRD] Conversion complete. ${files.length} files, next free at logTrack ${freeTrack} sector ${freeSector}`);

            return trd;
        }

        ejectDisk() {
            this.diskData = null;
            this.diskType = null;
            this.status = this.NOT_READY;
        }

        hasDisk() {
            return this.diskData !== null;
        }

        // Calculate sector offset in disk image
        getSectorOffset(track, side, sector) {
            // TRD layout: interleaved (track 0 side 0, track 0 side 1, track 1 side 0, ...)
            // Each track-side has 16 sectors of 256 bytes = 4096 bytes
            const logicalTrack = track * 2 + side;
            // WD1793 sectors are 1-16, convert to 0-based index
            const sectorIndex = (logicalTrack * this.sectorsPerTrack) + (sector - 1);
            // Handle sector 0 as invalid but don't crash
            if (sector < 1 || sector > 16) {
                console.warn(`[BetaDisk] Invalid sector ${sector} for track ${track}`);
            }
            return sectorIndex * this.bytesPerSector;
        }

        // Port read
        read(port) {
            const reg = port & 0xFF;

            switch (reg) {
                case 0x1F: // Status register
                    this.intrq = false;
                    if (!this.diskData) {
                        return this.NOT_READY;
                    }
                    let st = this.status;
                    if (this.reading && this.dataPos < this.dataLen) {
                        st |= this.DRQ;
                    }
                    // TRACK0 only applies to Type I commands
                    // For Type II/III, bit 2 is LOST_DATA (which should be 0 on success)
                    if (this.lastCmdType === 1 && this.track === 0) {
                        st |= this.TRACK0;
                    }
                    // Simulate INDEX pulse - ONLY for Type I commands!
                    // For Type II/III, bit 1 is DRQ (already handled above)
                    if (this.lastCmdType === 1) {
                        this.indexCounter = (this.indexCounter + 1) % 16;
                        if (this.indexCounter === 0) {
                            st |= this.INDEX;
                        }
                    }
                    return st;

                case 0x3F: // Track register
                    return this.track;

                case 0x5F: // Sector register
                    return this.sector;

                case 0x7F: // Data register
                    if (this.reading && this.dataBuffer && this.dataPos < this.dataLen) {
                        this.data = this.dataBuffer[this.dataPos++];
                        if (this.dataPos >= this.dataLen) {
                            this.reading = false;
                            this.status &= ~(this.BUSY | this.DRQ);  // Clear both BUSY and DRQ
                            this.intrq = true;
                        }
                    }
                    return this.data;

                case 0xFF: // System register
                    let sys = 0;
                    if (this.intrq) sys |= 0x80;        // INTRQ
                    if (this.reading || this.writing) sys |= 0x40;  // DRQ
                    return sys;

                default:
                    return 0xFF;
            }
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
                        if (this.dataPos >= this.dataLen) {
                            // Write buffer to disk
                            this.flushWriteBuffer();
                            this.writing = false;
                            this.status &= ~this.BUSY;
                            this.intrq = true;
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
            this.dataBuffer = null;
            this.intrq = false;
        }

        executeCommand(cmd) {
            this.command = cmd;
            this.status = 0;
            this.intrq = false;

            if (!this.diskData) {
                this.status = this.NOT_READY;
                this.intrq = true;
                return;
            }

            const cmdType = cmd >> 4;

            // Type I commands (restore, seek, step)
            if ((cmd & 0x80) === 0) {
                this.lastCmdType = 1;
                this.status |= this.BUSY;

                if ((cmd & 0xF0) === 0x00) {
                    // Restore (seek to track 0)
                    this.track = 0;
                    this.status |= this.TRACK0;
                } else if ((cmd & 0xF0) === 0x10) {
                    // Seek to track in data register
                    this.track = this.data;
                    if (this.track === 0) this.status |= this.TRACK0;
                } else if ((cmd & 0xE0) === 0x20) {
                    // Step (keep direction)
                    // Not commonly used, skip for now
                } else if ((cmd & 0xE0) === 0x40) {
                    // Step in
                    if (this.track < 79) this.track++;
                } else if ((cmd & 0xE0) === 0x60) {
                    // Step out
                    if (this.track > 0) this.track--;
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
                this.reading = false;
                this.writing = false;
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
                    // Read address - return track/side/sector/size
                    this.dataBuffer = new Uint8Array([
                        this.track, this.side, this.sector, 1, 0, 0
                    ]);
                    this.dataPos = 0;
                    this.dataLen = 6;
                    this.reading = true;
                    this.status |= this.BUSY | this.DRQ;
                } else if ((cmd & 0xF0) === 0xE0) {
                    // Read Track - not implemented, signal completion
                    this.status = 0;
                    this.intrq = true;
                } else if ((cmd & 0xF0) === 0xF0) {
                    // Write Track - not implemented, signal completion
                    this.status = 0;
                    this.intrq = true;
                }
                return;
            }
        }

        readSector() {
            const offset = this.getSectorOffset(this.track, this.side, this.sector);
            // Also compute what linear offset would be for comparison
            const linearOffset = (this.track * 16 + (this.sector - 1)) * 256;

            if (offset + this.bytesPerSector > this.diskData.length) {
                console.warn(`[BetaDisk] READ failed: offset ${offset} + ${this.bytesPerSector} > ${this.diskData.length}`);
                this.status |= this.RNF;
                this.status &= ~this.BUSY;
                this.intrq = true;
                return;
            }

            this.dataBuffer = this.diskData.slice(offset, offset + this.bytesPerSector);

            // Log sector read with first 16 bytes for debugging
            const preview = Array.from(this.dataBuffer.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            console.log(`[BetaDisk] READ track=${this.track}, side=${this.side}, sector=${this.sector} -> interleavedOffset=${offset}, linearOffset=${linearOffset}, first bytes: ${preview}`);

            this.dataPos = 0;
            this.dataLen = this.bytesPerSector;
            this.reading = true;
            this.status |= this.DRQ | this.BUSY;
        }

        writeSector() {
            const offset = this.getSectorOffset(this.track, this.side, this.sector);

            if (offset + this.bytesPerSector > this.diskData.length) {
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
                this.diskData.set(this.dataBuffer, this.writeOffset);
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
    class ZipLoader {
        static get VERSION() { return VERSION; }
        
        /**
         * Check if data is a ZIP file
         */
        static isZip(data) {
            const view = new Uint8Array(data);
            // ZIP signature: PK\x03\x04
            return view[0] === 0x50 && view[1] === 0x4B && 
                   view[2] === 0x03 && view[3] === 0x04;
        }
        
        /**
         * Extract files from ZIP archive
         * Returns array of {name, data} objects
         */
        static async extract(zipData) {
            const data = new Uint8Array(zipData);
            const files = [];

            // First, find the central directory to get accurate file sizes
            // (some ZIPs use data descriptors and have 0 in local header sizes)
            const centralDir = ZipLoader.findCentralDirectory(data);

            let offset = 0;

            while (offset < data.length - 4) {
                // Check for local file header signature
                if (data[offset] !== 0x50 || data[offset + 1] !== 0x4B ||
                    data[offset + 2] !== 0x03 || data[offset + 3] !== 0x04) {
                    break; // End of local file headers
                }

                // Parse local file header
                const gpFlag = data[offset + 6] | (data[offset + 7] << 8);
                const compression = data[offset + 8] | (data[offset + 9] << 8);
                let compressedSize = data[offset + 18] | (data[offset + 19] << 8) |
                                      (data[offset + 20] << 16) | (data[offset + 21] << 24);
                let uncompressedSize = data[offset + 22] | (data[offset + 23] << 8) |
                                        (data[offset + 24] << 16) | (data[offset + 25] << 24);
                const nameLength = data[offset + 26] | (data[offset + 27] << 8);
                const extraLength = data[offset + 28] | (data[offset + 29] << 8);

                // Get filename
                const nameBytes = data.slice(offset + 30, offset + 30 + nameLength);
                const name = new TextDecoder().decode(nameBytes);

                // If data descriptor flag is set (bit 3) and sizes are 0, get from central directory
                if ((gpFlag & 0x08) && (compressedSize === 0 || uncompressedSize === 0)) {
                    const cdEntry = centralDir.get(name);
                    if (cdEntry) {
                        compressedSize = cdEntry.compressedSize;
                        uncompressedSize = cdEntry.uncompressedSize;
                    }
                }

                // Get compressed data
                const dataStart = offset + 30 + nameLength + extraLength;
                const compressedData = data.slice(dataStart, dataStart + compressedSize);

                // Decompress if needed
                let fileData;
                if (compression === 0) {
                    // Stored (no compression)
                    fileData = compressedData;
                } else if (compression === 8) {
                    // Deflate
                    fileData = await ZipLoader.inflate(compressedData, uncompressedSize);
                } else {
                    console.warn(`Unsupported compression method ${compression} for ${name}`);
                    offset = dataStart + compressedSize;
                    continue;
                }

                // Skip directories
                if (!name.endsWith('/')) {
                    files.push({ name, data: fileData });
                }

                // Move past data, and data descriptor if present
                offset = dataStart + compressedSize;
                if (gpFlag & 0x08) {
                    // Skip data descriptor (may have optional signature + crc + sizes)
                    if (data[offset] === 0x50 && data[offset + 1] === 0x4B &&
                        data[offset + 2] === 0x07 && data[offset + 3] === 0x08) {
                        offset += 16;  // Signature + CRC + compressed + uncompressed
                    } else {
                        offset += 12;  // CRC + compressed + uncompressed (no signature)
                    }
                }
            }

            return files;
        }

        /**
         * Find and parse central directory for accurate file sizes
         */
        static findCentralDirectory(data) {
            const entries = new Map();

            // Find End of Central Directory (search from end)
            let eocdOffset = -1;
            for (let i = data.length - 22; i >= 0; i--) {
                if (data[i] === 0x50 && data[i + 1] === 0x4B &&
                    data[i + 2] === 0x05 && data[i + 3] === 0x06) {
                    eocdOffset = i;
                    break;
                }
            }

            if (eocdOffset < 0) return entries;

            // Get central directory offset
            const cdOffset = data[eocdOffset + 16] | (data[eocdOffset + 17] << 8) |
                            (data[eocdOffset + 18] << 16) | (data[eocdOffset + 19] << 24);
            const cdSize = data[eocdOffset + 12] | (data[eocdOffset + 13] << 8) |
                          (data[eocdOffset + 14] << 16) | (data[eocdOffset + 15] << 24);

            // Parse central directory entries
            let offset = cdOffset;
            while (offset < cdOffset + cdSize && offset < data.length - 4) {
                // Check for central directory signature
                if (data[offset] !== 0x50 || data[offset + 1] !== 0x4B ||
                    data[offset + 2] !== 0x01 || data[offset + 3] !== 0x02) {
                    break;
                }

                const compressedSize = data[offset + 20] | (data[offset + 21] << 8) |
                                      (data[offset + 22] << 16) | (data[offset + 23] << 24);
                const uncompressedSize = data[offset + 24] | (data[offset + 25] << 8) |
                                        (data[offset + 26] << 16) | (data[offset + 27] << 24);
                const nameLength = data[offset + 28] | (data[offset + 29] << 8);
                const extraLength = data[offset + 30] | (data[offset + 31] << 8);
                const commentLength = data[offset + 32] | (data[offset + 33] << 8);

                const nameBytes = data.slice(offset + 46, offset + 46 + nameLength);
                const name = new TextDecoder().decode(nameBytes);

                entries.set(name, { compressedSize, uncompressedSize });

                offset += 46 + nameLength + extraLength + commentLength;
            }

            return entries;
        }
        
        /**
         * Inflate (decompress) deflate data
         */
        static async inflate(compressedData, expectedSize) {
            // Try using DecompressionStream API (modern browsers)
            if (typeof DecompressionStream !== 'undefined') {
                try {
                    // ZIP uses raw deflate, so use 'deflate-raw'
                    const ds = new DecompressionStream('deflate-raw');
                    const writer = ds.writable.getWriter();
                    writer.write(compressedData);
                    writer.close();
                    
                    const reader = ds.readable.getReader();
                    const chunks = [];
                    let totalLength = 0;
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        totalLength += value.length;
                    }
                    
                    const result = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        result.set(chunk, offset);
                        offset += chunk.length;
                    }
                    return result;
                } catch (e) {
                    console.warn('DecompressionStream failed, trying fallback:', e);
                }
            }
            
            // Fallback: manual inflate (basic implementation)
            return ZipLoader.inflateRaw(compressedData, expectedSize);
        }
        
        /**
         * Basic raw inflate implementation for deflate data
         */
        static inflateRaw(data, expectedSize) {
            const output = new Uint8Array(expectedSize);
            let inPos = 0;
            let outPos = 0;
            let bitBuf = 0;
            let bitCount = 0;
            
            function readBits(n) {
                while (bitCount < n) {
                    if (inPos >= data.length) return 0;
                    bitBuf |= data[inPos++] << bitCount;
                    bitCount += 8;
                }
                const val = bitBuf & ((1 << n) - 1);
                bitBuf >>= n;
                bitCount -= n;
                return val;
            }
            
            // Fixed Huffman code lengths
            const fixedLitLen = new Uint8Array(288);
            for (let i = 0; i <= 143; i++) fixedLitLen[i] = 8;
            for (let i = 144; i <= 255; i++) fixedLitLen[i] = 9;
            for (let i = 256; i <= 279; i++) fixedLitLen[i] = 7;
            for (let i = 280; i <= 287; i++) fixedLitLen[i] = 8;
            
            const fixedDistLen = new Uint8Array(32);
            fixedDistLen.fill(5);
            
            function buildTree(lengths) {
                const maxLen = Math.max(...lengths);
                const counts = new Uint16Array(maxLen + 1);
                const nextCode = new Uint16Array(maxLen + 1);
                const tree = new Uint16Array(1 << maxLen);
                
                for (const len of lengths) if (len) counts[len]++;
                
                let code = 0;
                for (let i = 1; i <= maxLen; i++) {
                    code = (code + counts[i - 1]) << 1;
                    nextCode[i] = code;
                }
                
                for (let i = 0; i < lengths.length; i++) {
                    const len = lengths[i];
                    if (len) {
                        const c = nextCode[len]++;
                        const reversed = parseInt(c.toString(2).padStart(len, '0').split('').reverse().join(''), 2);
                        for (let j = reversed; j < (1 << maxLen); j += (1 << len)) {
                            tree[j] = (i << 4) | len;
                        }
                    }
                }
                return { tree, maxLen };
            }
            
            function readSymbol(huffTree) {
                const bits = readBits(huffTree.maxLen);
                const entry = huffTree.tree[bits];
                const len = entry & 0xF;
                const sym = entry >> 4;
                // Put back unused bits
                const unused = huffTree.maxLen - len;
                bitBuf = (bitBuf << unused) | (bits >> len);
                bitCount += unused;
                bitBuf &= (1 << bitCount) - 1;
                return sym;
            }
            
            const lenBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
            const lenExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
            const distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
            const distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
            
            while (inPos < data.length || bitCount > 0) {
                const bfinal = readBits(1);
                const btype = readBits(2);
                
                if (btype === 0) {
                    // Stored block
                    bitBuf = 0;
                    bitCount = 0;
                    const len = data[inPos] | (data[inPos + 1] << 8);
                    inPos += 4; // Skip len and nlen
                    for (let i = 0; i < len && outPos < expectedSize; i++) {
                        output[outPos++] = data[inPos++];
                    }
                } else {
                    // Compressed block
                    let litTree, distTree;
                    
                    if (btype === 1) {
                        // Fixed Huffman
                        litTree = buildTree(fixedLitLen);
                        distTree = buildTree(fixedDistLen);
                    } else {
                        // Dynamic Huffman - simplified, may not work for all files
                        const hlit = readBits(5) + 257;
                        const hdist = readBits(5) + 1;
                        const hclen = readBits(4) + 4;
                        
                        const codeLenOrder = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
                        const codeLens = new Uint8Array(19);
                        for (let i = 0; i < hclen; i++) {
                            codeLens[codeLenOrder[i]] = readBits(3);
                        }
                        const codeTree = buildTree(codeLens);
                        
                        const allLens = new Uint8Array(hlit + hdist);
                        let i = 0;
                        while (i < hlit + hdist) {
                            const sym = readSymbol(codeTree);
                            if (sym < 16) {
                                allLens[i++] = sym;
                            } else if (sym === 16) {
                                const repeat = readBits(2) + 3;
                                for (let j = 0; j < repeat; j++) allLens[i++] = allLens[i - 1];
                            } else if (sym === 17) {
                                i += readBits(3) + 3;
                            } else {
                                i += readBits(7) + 11;
                            }
                        }
                        
                        litTree = buildTree(allLens.slice(0, hlit));
                        distTree = buildTree(allLens.slice(hlit));
                    }
                    
                    // Decode symbols
                    while (outPos < expectedSize) {
                        const sym = readSymbol(litTree);
                        if (sym < 256) {
                            output[outPos++] = sym;
                        } else if (sym === 256) {
                            break; // End of block
                        } else {
                            // Length-distance pair
                            const lenIdx = sym - 257;
                            const length = lenBase[lenIdx] + readBits(lenExtra[lenIdx]);
                            const distSym = readSymbol(distTree);
                            const distance = distBase[distSym] + readBits(distExtra[distSym]);
                            
                            for (let i = 0; i < length && outPos < expectedSize; i++) {
                                output[outPos] = output[outPos - distance];
                                outPos++;
                            }
                        }
                    }
                }
                
                if (bfinal) break;
            }
            
            return output.slice(0, outPos);
        }
        
        /**
         * Find and extract first SNA/TAP file from ZIP
         */
        static async extractSpectrum(zipData) {
            const files = await ZipLoader.extract(zipData);

            // Look for SNA, TAP, Z80, or RZX files
            for (const file of files) {
                const name = file.name.toLowerCase();
                if (name.endsWith('.sna') || name.endsWith('.tap') || name.endsWith('.z80') || name.endsWith('.rzx')) {
                    return {
                        name: file.name,
                        data: file.data,  // Keep as Uint8Array, not .buffer (slice issue)
                        type: name.endsWith('.sna') ? 'sna' :
                              name.endsWith('.z80') ? 'z80' :
                              name.endsWith('.rzx') ? 'rzx' : 'tap'
                    };
                }
            }

            // If no supported files found, list what's in the archive
            const fileNames = files.map(f => f.name).join(', ');
            throw new Error(`No SNA, TAP, Z80, RZX, TRD, or SCL file found in ZIP. Contents: ${fileNames}`);
        }

        /**
         * Find all Spectrum files in ZIP
         * Returns array of {name, data, type} objects
         */
        static async findAllSpectrum(zipData) {
            const files = await ZipLoader.extract(zipData);
            const spectrumFiles = [];

            for (const file of files) {
                const name = file.name.toLowerCase();
                if (name.endsWith('.sna') || name.endsWith('.tap') || name.endsWith('.z80') ||
                    name.endsWith('.rzx') || name.endsWith('.trd') || name.endsWith('.scl')) {
                    let type;
                    if (name.endsWith('.sna')) type = 'sna';
                    else if (name.endsWith('.z80')) type = 'z80';
                    else if (name.endsWith('.rzx')) type = 'rzx';
                    else if (name.endsWith('.trd')) type = 'trd';
                    else if (name.endsWith('.scl')) type = 'scl';
                    else type = 'tap';

                    spectrumFiles.push({
                        name: file.name,
                        data: file.data,  // Keep as Uint8Array, not .buffer (slice issue)
                        type
                    });
                }
            }

            return spectrumFiles;
        }
    }

    /**
     * RZX file loader - handles RZX input recording format
     * RZX stores initial snapshot + frame-by-frame input recordings
     */
    class RZXLoader {
        constructor() {
            this.frames = [];           // [{fetchCount, inputs: [value, ...]}]
            this.snapshot = null;       // Uint8Array of embedded snapshot
            this.snapshotExt = null;    // 'z80' or 'sna'
            this.totalFrames = 0;
            this.creatorInfo = null;
        }

        static isRZX(data) {
            if (data.byteLength < 10) return false;
            const bytes = new Uint8Array(data);
            return bytes[0] === 0x52 && bytes[1] === 0x5A &&
                   bytes[2] === 0x58 && bytes[3] === 0x21; // "RZX!"
        }

        async parse(data) {
            const bytes = new Uint8Array(data);
            if (!RZXLoader.isRZX(data)) {
                throw new Error('Invalid RZX signature');
            }

            const view = new DataView(data);
            const majorVersion = bytes[4];
            const minorVersion = bytes[5];
            // const flags = view.getUint32(6, true);

            let offset = 10;
            this.frames = [];
            this.snapshot = null;

            while (offset < bytes.length - 5) {
                const blockId = bytes[offset];
                const blockLen = view.getUint32(offset + 1, true);

                // blockLen includes the 5-byte header (ID + length)
                if (blockLen < 5 || offset + blockLen > bytes.length) break;

                // Block data starts after the 5-byte header
                const blockData = bytes.slice(offset + 5, offset + blockLen);

                switch (blockId) {
                    case 0x10: // Creator info
                        this.parseCreatorBlock(blockData);
                        break;
                    case 0x30: // Snapshot block
                        await this.parseSnapshotBlock(blockData);
                        break;
                    case 0x80: // Input recording block
                        await this.parseInputBlock(blockData);
                        break;
                    // Other blocks (security, etc.) are skipped
                }

                offset += blockLen;
            }

            this.totalFrames = this.frames.length;
            return true;
        }

        parseCreatorBlock(data) {
            // Creator ID (20 bytes) + major/minor version (2 bytes)
            let name = '';
            for (let i = 0; i < 20 && data[i] !== 0; i++) {
                name += String.fromCharCode(data[i]);
            }
            this.creatorInfo = {
                name: name.trim(),
                majorVersion: data[20] || 0,
                minorVersion: data[21] || 0
            };
        }

        async parseSnapshotBlock(data) {
            if (data.length < 12) {
                throw new Error('Snapshot block too short');
            }

            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const flags = view.getUint32(0, true);
            const compressed = (flags & 0x02) !== 0;

            // Extension is 4 bytes at offset 4 (e.g., "z80\0" or "sna\0")
            let ext = '';
            for (let i = 0; i < 4 && data[4 + i] !== 0; i++) {
                ext += String.fromCharCode(data[4 + i]);
            }
            this.snapshotExt = ext.toLowerCase().replace('.', '') || 'z80';

            // Uncompressed length at offset 8
            const uncompLen = view.getUint32(8, true);

            // Snapshot data starts at offset 12
            const snapData = data.slice(12);

            if (compressed && snapData.length > 0) {
                this.snapshot = await this.decompress(snapData, uncompLen);
            } else {
                this.snapshot = new Uint8Array(snapData);
            }
        }

        async parseInputBlock(data) {
            if (data.length < 18) {
                console.warn('Input block too short, skipping');
                return;
            }

            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const numFrames = view.getUint32(0, true);
            // const reserved = data[4];
            // const tstatesPerInt = view.getUint32(5, true);
            const flags = view.getUint32(9, true);
            const compressed = (flags & 0x02) !== 0;

            let frameData;
            if (compressed) {
                // Uncompressed size not stored - decompress and see
                try {
                    frameData = await this.decompress(data.slice(13));
                } catch (e) {
                    // Try without decompression
                    frameData = data.slice(13);
                }
            } else {
                frameData = data.slice(13);
            }

            // Parse frame data
            let offset = 0;
            const frameView = new DataView(frameData.buffer, frameData.byteOffset, frameData.byteLength);
            let lastInputs = [];

            for (let i = 0; i < numFrames && offset < frameData.length; i++) {
                if (offset + 4 > frameData.length) break;

                const fetchCount = frameView.getUint16(offset, true);
                const inCount = frameView.getUint16(offset + 2, true);
                offset += 4;

                let inputs;
                if (inCount === 0xFFFF) {
                    // Repeat previous frame's inputs
                    inputs = lastInputs.slice();
                } else {
                    inputs = [];
                    for (let j = 0; j < inCount && offset < frameData.length; j++) {
                        inputs.push(frameData[offset++]);
                    }
                    lastInputs = inputs;
                }

                this.frames.push({
                    fetchCount,
                    inputs,
                    inputIndex: 0
                });
            }
        }

        async decompress(data, expectedSize) {
            // Prefer pako if available (more reliable error handling)
            if (typeof pako !== 'undefined') {
                // Try zlib format first (with header), then raw deflate
                try {
                    return pako.inflate(data);
                } catch (e1) {
                    try {
                        return pako.inflateRaw(data);
                    } catch (e2) {
                        // Both failed - throw combined error
                        throw new Error('Decompression failed');
                    }
                }
            }

            // Fallback to DecompressionStream (modern browsers without pako)
            if (typeof DecompressionStream !== 'undefined') {
                try {
                    const ds = new DecompressionStream('deflate-raw');
                    const writer = ds.writable.getWriter();
                    writer.write(data);
                    writer.close();

                    const reader = ds.readable.getReader();
                    const chunks = [];
                    let totalLen = 0;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        totalLen += value.length;
                    }

                    const result = new Uint8Array(totalLen);
                    let offset = 0;
                    for (const chunk of chunks) {
                        result.set(chunk, offset);
                        offset += chunk.length;
                    }
                    return result;
                } catch (e) {
                    throw new Error('Decompression failed');
                }
            }

            throw new Error('No decompression method available. Include pako.js for RZX support.');
        }

        getSnapshot() {
            return this.snapshot;
        }

        getSnapshotType() {
            return this.snapshotExt;
        }

        getFrameCount() {
            return this.totalFrames;
        }

        getFrame(frameNum) {
            if (frameNum < 0 || frameNum >= this.frames.length) return null;
            return this.frames[frameNum];
        }

        // Get next input for current frame
        getNextInput(frameNum) {
            const frame = this.frames[frameNum];
            if (!frame || frame.inputIndex >= frame.inputs.length) return null;
            return frame.inputs[frame.inputIndex++];
        }

        // Reset input index for a frame
        resetFrameInputs(frameNum) {
            const frame = this.frames[frameNum];
            if (frame) frame.inputIndex = 0;
        }

        // Reset all frames
        reset() {
            for (const frame of this.frames) {
                frame.inputIndex = 0;
            }
        }
    }

    /**
     * TRD file loader - TR-DOS disk image format
     * Used by Beta Disk interface (Pentagon, Scorpion, etc.)
     */
    class TRDLoader {
        static get VERSION() { return VERSION; }

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
         * List files in TRD image
         * Returns array of {name, ext, start, length, sectors, track, sector}
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

                // Start address or BASIC autostart line
                const start = bytes[offset + 9] | (bytes[offset + 10] << 8);
                // Length in bytes
                const length = bytes[offset + 11] | (bytes[offset + 12] << 8);
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
                for (let i = 0; i < 10; i++) {
                    header[2 + i] = i < fileInfo.name.length ? fileInfo.name.charCodeAt(i) : 0x20;
                }
                // Length
                header[12] = fileInfo.length & 0xFF;
                header[13] = (fileInfo.length >> 8) & 0xFF;
                // Autostart line
                header[14] = fileInfo.start & 0xFF;
                header[15] = (fileInfo.start >> 8) & 0xFF;
                // Program length (same as data length for BASIC)
                header[16] = fileInfo.length & 0xFF;
                header[17] = (fileInfo.length >> 8) & 0xFF;
                // Checksum
                let checksum = 0;
                for (let i = 0; i < 18; i++) checksum ^= header[i];
                header[18] = checksum;

                blocks.push(header);

                // Data block
                const dataBlock = new Uint8Array(fileData.length + 2);
                dataBlock[0] = 0xFF;  // Data flag
                dataBlock.set(fileData, 1);
                checksum = 0xFF;
                for (let i = 0; i < fileData.length; i++) checksum ^= fileData[i];
                dataBlock[dataBlock.length - 1] = checksum;

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
                let checksum = 0;
                for (let i = 0; i < 18; i++) checksum ^= header[i];
                header[18] = checksum;

                blocks.push(header);

                const dataBlock = new Uint8Array(fileData.length + 2);
                dataBlock[0] = 0xFF;
                dataBlock.set(fileData, 1);
                checksum = 0xFF;
                for (let i = 0; i < fileData.length; i++) checksum ^= fileData[i];
                dataBlock[dataBlock.length - 1] = checksum;

                blocks.push(dataBlock);
            } else {
                // Other types: just data block
                const dataBlock = new Uint8Array(fileData.length + 2);
                dataBlock[0] = 0xFF;
                dataBlock.set(fileData, 1);
                let checksum = 0xFF;
                for (let i = 0; i < fileData.length; i++) checksum ^= fileData[i];
                dataBlock[dataBlock.length - 1] = checksum;

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
    }

    /**
     * SCL file loader - TR-DOS file archive format
     * More compact than TRD - only stores files, not empty sectors
     */
    class SCLLoader {
        static get VERSION() { return VERSION; }

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

                const start = bytes[descOffset + 9] | (bytes[descOffset + 10] << 8);
                const length = bytes[descOffset + 11] | (bytes[descOffset + 12] << 8);
                const sectors = bytes[descOffset + 13];

                files.push({
                    name,
                    ext,
                    type,
                    start,
                    length,
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
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { TapeLoader, SnapshotLoader, TapeTrapHandler, TRDOSTrapHandler, BetaDisk, ZipLoader, RZXLoader, TRDLoader, SCLLoader };
    }
    if (typeof global !== 'undefined') {
        global.TapeLoader = TapeLoader;
        global.SnapshotLoader = SnapshotLoader;
        global.TapeTrapHandler = TapeTrapHandler;
        global.TRDOSTrapHandler = TRDOSTrapHandler;
        global.BetaDisk = BetaDisk;
        global.ZipLoader = ZipLoader;
        global.RZXLoader = RZXLoader;
        global.TRDLoader = TRDLoader;
        global.SCLLoader = SCLLoader;
    }

})(typeof window !== 'undefined' ? window : global);
