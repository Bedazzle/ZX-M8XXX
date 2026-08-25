/**
 * ZX-M8XXX - Snapshots (SNA/Z80) and the format-detecting load dispatcher
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

import { SCLLoader, TRDLoader } from './disk-beta.js';
import { MGTLoader } from './disk-mgt.js';
import { OPDLoader } from './disk-opus.js';
import { DidaktikLoader } from './disk-didaktik.js';
import { MDRLoader } from './microdrive.js';
import { RZXLoader } from './rzx.js';
import { SZXLoader } from './szx.js';
import { TZXLoader, WAVLoader } from './tape.js';
import {
    PAGE_SIZE, SLOT1_START, SLOT2_START, SLOT3_START, SNA_HEADER_SIZE, SNA_48K_RAM, SNA_48K_SIZE, SNA_128K_EXT, SNA_128K_MIN, SNA_128K_SIZE, SNA_P1024_SIZE, P7FFD_RAM_MASK, P7FFD_SCREEN_BIT, P7FFD_ROM_BIT, P7FFD_LOCK_BIT
} from '../constants.js';
import { getMachineByZ80HwMode } from '../machines.js';

    export function decompressZ80Block(data, maxLen, compressed, isV1) {
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
            } else if (isV1 && data[srcIdx] === 0x00 && srcIdx + 3 < data.length &&
                       data[srcIdx + 1] === 0xED && data[srcIdx + 2] === 0xED &&
                       data[srcIdx + 3] === 0x00) {
                break;
            } else {
                result[dstIdx++] = data[srcIdx++];
            }
        }

        return result.slice(0, dstIdx);
    }

    export class SnapshotLoader {
        constructor() {
            this.machineType = '48k';
        }
        
        detectType(data, filename = '') {
            const ext = filename.toLowerCase().split('.').pop();
            if (ext === 'sna') return 'sna';
            if (ext === 'tap') return 'tap';
            if (ext === 'tzx') return 'tzx';
            if (ext === 'z80') return 'z80';
            if (ext === 'szx') return 'szx';
            if (ext === 'rzx') return 'rzx';
            if (ext === 'trd') return 'trd';
            if (ext === 'scl') return 'scl';
            if (ext === 'dsk') return 'dsk';
            if (ext === 'mgt' || ext === 'img') return 'mgt';
            if (ext === 'mdr') return 'mdr';
            if (ext === 'opd' || ext === 'opu') return 'opd';
            if (ext === 'wav') return 'wav';

            const bytes = new Uint8Array(data);

            // Check for DSK signature (before other checks)
            if (typeof DSKLoader !== 'undefined' && DSKLoader.isDSK(data)) return 'dsk';

            // Check for SZX signature
            if (SZXLoader.isSZX(data)) return 'szx';

            // Check for RZX signature
            if (RZXLoader.isRZX(data)) return 'rzx';

            // Check for TZX signature (must check before TAP)
            if (TZXLoader.isTZX(data)) return 'tzx';

            // Didaktik MDOS, by the "SDOS" marker in its boot sector. This has to
            // come before EVERY other disk check, because nothing else here is
            // specific enough to leave it alone: a blank D80 satisfies isTRD, and
            // it is exactly the same 737,280 bytes as a double-sided OPD. Detected
            // as TR-DOS it reached the boot-file injector, which is where the
            // "Cannot add boot" message came from.
            if (DidaktikLoader.hasSdosSignature(data)) return 'd80';

            // Check for SCL signature
            if (SCLLoader.isSCL(data)) return 'scl';

            // Check for TRD format
            if (TRDLoader.isTRD(data)) return 'trd';

            // Check for MDR format (Interface 1 Microdrive)
            if (MDRLoader.isMDR(data)) return 'mdr';

            // Check for MGT format
            if (MGTLoader.isMGT(data)) return 'mgt';

            // Check for OPD format (Opus Discovery)
            if (OPDLoader.isOPD(data)) return 'opd';

            // Didaktik without the signature — size plus a readable catalogue.
            // Last, because those sizes overlap MGT and OPD.
            if (DidaktikLoader.isDidaktik(data)) return 'd80';

            // Check for WAV format (RIFF/WAVE audio)
            if (WAVLoader.isWAV(data)) return 'wav';

            if (bytes.length === SNA_48K_SIZE || bytes.length === SNA_128K_SIZE || bytes.length === SNA_P1024_SIZE) return 'sna';
            if (bytes.length > 30 && (bytes[6] === 0 || bytes[6] === 0xff)) return 'z80';
            if (bytes.length > 2) {
                const len = bytes[0] | (bytes[1] << 8);
                if (len > 0 && len < bytes.length) return 'tap';
            }
            return null;
        }
        
        loadSNA48(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length < SNA_48K_SIZE) throw new Error('Invalid SNA file');

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

            // Reset CPU state flags not stored in SNA format
            cpu.halted = false;
            cpu.eiPending = false;

            for (let i = 0; i < SNA_48K_RAM; i++) {
                memory.write(SLOT1_START + i, bytes[SNA_HEADER_SIZE + i]);
            }

            cpu.pc = memory.read(cpu.sp) | (memory.read(cpu.sp + 1) << 8);
            cpu.sp = (cpu.sp + 2) & 0xffff;
            this.machineType = '48k';
            return { border, machineType: '48k' };
        }

        loadSNA128(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length < SNA_128K_MIN) return this.loadSNA48(data, cpu, memory);

            // For 128K, we need to set paging BEFORE loading 48KB section
            // Otherwise the wrong bank gets written at C000
            const offset = SNA_48K_SIZE;
            const pagingByte = bytes[offset + 2];
            const currentBank = pagingByte & P7FFD_RAM_MASK;

            // Reset paging lock before setting paging state from snapshot
            memory.pagingDisabled = false;
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

            // Reset CPU state flags not stored in SNA format
            cpu.halted = false;
            cpu.eiPending = false;

            // Now load 48KB section (banks 5, 2, and currently paged bank)
            for (let i = 0; i < SNA_48K_RAM; i++) {
                memory.write(SLOT1_START + i, bytes[SNA_HEADER_SIZE + i]);
            }

            // Load PC from 128K extension
            cpu.pc = bytes[offset] | (bytes[offset + 1] << 8);

            // Load remaining banks (excluding the current one which is in 48KB section)
            const banksToLoad = [0, 1, 3, 4, 6, 7].filter(b => b !== currentBank);
            // Only load as many banks as are present in the file (max 5)
            const availableBanks = Math.floor((bytes.length - offset - SNA_128K_EXT) / PAGE_SIZE);
            const banksToActuallyLoad = banksToLoad.slice(0, Math.min(banksToLoad.length, availableBanks));
            let bankOffset = offset + SNA_128K_EXT;
            for (const bankNum of banksToActuallyLoad) {
                if (bankOffset + PAGE_SIZE > bytes.length) break;
                const ramBank = memory.getRamBank(bankNum);
                ramBank.set(bytes.slice(bankOffset, bankOffset + PAGE_SIZE));
                bankOffset += PAGE_SIZE;
            }
            this.machineType = '128k';
            return { border, machineType: '128k' };
        }
        
        loadSNA(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length === SNA_48K_SIZE) return this.loadSNA48(data, cpu, memory);
            if (bytes.length > SNA_48K_SIZE) return this.loadSNA128(data, cpu, memory);
            throw new Error('Invalid SNA file');
        }
        
        createSNA(cpu, memory, border = 7) {
            const is128k = memory.profile.ramPages > 1;
            const size = is128k ? SNA_128K_SIZE : SNA_48K_SIZE;
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
            
            for (let i = 0; i < SNA_48K_RAM; i++) {
                bytes[SNA_HEADER_SIZE + i] = memory.read(SLOT1_START + i);
            }

            if (is128k) {
                const offset = SNA_48K_SIZE;
                bytes[offset] = cpu.pc & 0xff;
                bytes[offset + 1] = (cpu.pc >> 8) & 0xff;
                const ps = memory.getPagingState();
                bytes[offset + 2] = (ps.ramBank & P7FFD_RAM_MASK) | (ps.screenBank === 7 ? P7FFD_SCREEN_BIT : 0x00) |
                                    (ps.romBank ? P7FFD_ROM_BIT : 0x00) | (ps.pagingDisabled ? P7FFD_LOCK_BIT : 0x00);
                bytes[offset + 3] = 0;
                // Save remaining banks (excluding those in the 48KB section)
                // 48KB section always has: bank 5 (4000-7FFF), bank 2 (8000-BFFF), and current bank (C000-FFFF)
                const currentBank = ps.ramBank;
                // Banks 2 and 5 are always in 48KB, plus the current bank at C000
                // Only save banks from [0,1,3,4,6,7] that aren't the current bank
                const banksToSave = [0, 1, 3, 4, 6, 7].filter(b => b !== currentBank);
                // Limit to 5 banks max to fit in SNA_128K_SIZE format
                const banksToActuallySave = banksToSave.slice(0, 5);
                let bankOffset = offset + SNA_128K_EXT;
                for (const bankNum of banksToActuallySave) {
                    bytes.set(memory.getRamBank(bankNum), bankOffset);
                    bankOffset += PAGE_SIZE;
                }
            }
            return bytes;
        }

        // Z80 v3 format saver
        createZ80(cpu, memory, border = 7) {
            const is128k = memory.profile.ramPages > 1;
            const chunks = [];

            // Build v3 header (30 + 54 = 84 bytes header)
            const header = new Uint8Array(86);  // 30 + 2 (len) + 54

            // Standard header (bytes 0-29)
            header[0] = cpu.a;
            header[1] = cpu.f;
            header[2] = cpu.c; header[3] = cpu.b;
            header[4] = cpu.l; header[5] = cpu.h;
            header[6] = 0; header[7] = 0;  // PC=0 indicates v2/v3
            header[8] = cpu.sp & 0xff; header[9] = (cpu.sp >> 8) & 0xff;
            header[10] = cpu.i;
            header[11] = cpu.rFull & 0x7f;
            header[12] = ((cpu.rFull >> 7) & 0x01) | ((border & 0x07) << 1);
            header[13] = cpu.e; header[14] = cpu.d;
            header[15] = cpu.c_; header[16] = cpu.b_;
            header[17] = cpu.e_; header[18] = cpu.d_;
            header[19] = cpu.h_; header[20] = cpu.l_;
            header[21] = cpu.a_; header[22] = cpu.f_;
            header[23] = cpu.iy & 0xff; header[24] = (cpu.iy >> 8) & 0xff;
            header[25] = cpu.ix & 0xff; header[26] = (cpu.ix >> 8) & 0xff;
            header[27] = cpu.iff1 ? 1 : 0;
            header[28] = cpu.iff2 ? 1 : 0;
            header[29] = cpu.im & 0x03;

            // Extended header length (54 bytes for v3)
            header[30] = 54; header[31] = 0;

            // Extended header (bytes 32-85)
            header[32] = cpu.pc & 0xff; header[33] = (cpu.pc >> 8) & 0xff;
            // Hardware mode from profile (0=48k, 4=128k, 9=Pentagon, 12=+2, 13=+2A)
            header[34] = memory.profile.z80HwMode;

            // Port 7FFD for 128K
            if (is128k) {
                const ps = memory.getPagingState();
                header[35] = (ps.ramBank & 0x07) | (ps.screenBank === 7 ? 0x08 : 0x00) |
                             (ps.romBank ? 0x10 : 0x00) | (ps.pagingDisabled ? 0x20 : 0x00);
            } else {
                header[35] = 0;
            }
            header[36] = 0;  // Interface I paged (no)
            header[37] = memory.profile.ayDefault ? 0x04 : 0x00;  // Bit 2: AY sound in use
            header[38] = 0;  // Last OUT to port $FFFD (AY register)
            // Bytes 39-54: AY registers (16 bytes) - leave as 0 for now
            // Bytes 55-56: Low T-state counter, 57: Hi T-state counter
            // Leave at 0 (not critical for loading)

            chunks.push(header);

            // Save memory pages (uncompressed for maximum compatibility)
            if (is128k) {
                // 128K: save all 8 RAM banks as pages 3-10
                for (let bank = 0; bank < 8; bank++) {
                    const pageData = memory.getRamBank(bank);
                    // Use 0xFFFF to indicate uncompressed PAGE_SIZE bytes
                    const pageChunk = new Uint8Array(3 + PAGE_SIZE);
                    pageChunk[0] = 0xFF;
                    pageChunk[1] = 0xFF;
                    pageChunk[2] = bank + 3;  // Page number (3-10 for banks 0-7)
                    pageChunk.set(pageData.subarray(0, PAGE_SIZE), 3);
                    chunks.push(pageChunk);
                }
            } else {
                // 48K: save 3 pages (8, 4, 5 -> $4000, $8000, $C000)
                const pages = [
                    { num: 8, start: SLOT1_START },  // Slot 1
                    { num: 4, start: SLOT2_START },  // Slot 2
                    { num: 5, start: SLOT3_START }   // Slot 3
                ];
                for (const page of pages) {
                    const pageData = new Uint8Array(PAGE_SIZE);
                    for (let i = 0; i < PAGE_SIZE; i++) {
                        pageData[i] = memory.read(page.start + i);
                    }
                    // Use 0xFFFF to indicate uncompressed PAGE_SIZE bytes
                    const pageChunk = new Uint8Array(3 + PAGE_SIZE);
                    pageChunk[0] = 0xFF;
                    pageChunk[1] = 0xFF;
                    pageChunk[2] = page.num;
                    pageChunk.set(pageData, 3);
                    chunks.push(pageChunk);
                }
            }

            // Combine all chunks
            const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
            const result = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }
            return result;
        }

        // Z80 RLE compression (ED ED nn xx = repeat xx nn times)
        compressZ80Block(data) {
            const result = [];
            let i = 0;
            while (i < data.length) {
                // Look for runs of same byte
                let runLen = 1;
                while (i + runLen < data.length &&
                       data[i + runLen] === data[i] && runLen < 255) {
                    runLen++;
                }

                if (runLen >= 5 || (runLen >= 2 && data[i] === 0xED)) {
                    // Use RLE encoding: ED ED count byte
                    result.push(0xED, 0xED, runLen, data[i]);
                    i += runLen;
                } else {
                    // Output literal bytes, but escape ED ED sequences
                    if (data[i] === 0xED && i + 1 < data.length && data[i + 1] === 0xED) {
                        // Escape ED ED as ED ED 02 ED
                        result.push(0xED, 0xED, 0x02, 0xED);
                        i += 2;
                    } else {
                        result.push(data[i]);
                        i++;
                    }
                }
            }
            return new Uint8Array(result);
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
            // Compatibility: a byte-12 value of 255 must be treated as 1 (per the .z80
            // spec, for very old files). Affects R bit 7, border, and the "compressed" flag.
            let byte12 = bytes[12];
            if (byte12 === 255) byte12 = 1;
            cpu.rFull = (bytes[11] & 0x7f) | ((byte12 & 0x01) << 7);

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

            // Reset CPU state flags not stored in Z80 format
            cpu.halted = false;
            cpu.eiPending = false;

            // Determine version
            if (pc !== 0) {
                // Version 1 - 48K only
                cpu.pc = pc;
                const memData = this.decompressZ80Block(bytes.subarray(30), SNA_48K_RAM, compressed, true);
                for (let i = 0; i < memData.length; i++) {
                    memory.write(SLOT1_START + i, memData[i]);
                }
                this.machineType = '48k';
                return { border, machineType: '48k' };
            }
            
            // Version 2 or 3
            const extHeaderLen = bytes[30] | (bytes[31] << 8);
            cpu.pc = bytes[32] | (bytes[33] << 8);

            const hwMode = bytes[34];
            // Determine machine type from hardware mode using profile lookup
            let machineType = getMachineByZ80HwMode(hwMode, extHeaderLen);

            // Read 128K port 0x7FFD if applicable
            if (machineType !== '48k' && bytes.length > 35) {
                const port7FFD = bytes[35];
                // Reset paging lock before setting paging state from snapshot
                memory.pagingDisabled = false;
                // +2A/+3: restore port 0x1FFD before 0x7FFD. Byte 86 holds 1FFD only when
                // the extended-header length word (offset 30) is exactly 55 (per .z80 spec).
                if ((memory.machineType === '+2a' || memory.machineType === '+3') && extHeaderLen === 55) {
                    memory.write1FFD(bytes[86]);
                }
                memory.writePaging(port7FFD);
            }
            
            // Load memory pages
            let offset = 32 + extHeaderLen;
            while (offset < bytes.length - 3) {
                const blockLen = bytes[offset] | (bytes[offset + 1] << 8);
                const pageNum = bytes[offset + 2];
                offset += 3;
                
                if (offset + (blockLen === 0xffff ? PAGE_SIZE : blockLen) > bytes.length) break;

                const isCompressed = blockLen !== 0xffff;
                const rawLen = isCompressed ? blockLen : PAGE_SIZE;
                const blockData = bytes.subarray(offset, offset + rawLen);
                const pageData = isCompressed ?
                    this.decompressZ80Block(blockData, PAGE_SIZE, true, false) : blockData;
                
                this.loadZ80Page(pageNum, pageData, memory, machineType);
                offset += rawLen;
            }
            
            this.machineType = machineType;
            return { border, machineType };
        }
        
        decompressZ80Block(data, maxLen, compressed, isV1) {
            return decompressZ80Block(data, maxLen, compressed, isV1);
        }

        loadZ80Page(pageNum, data, memory, machineType) {
            // Map page numbers to memory addresses/banks
            // Page numbers differ between 48K and 128K modes
            if (machineType === '48k') {
                switch (pageNum) {
                    case 4: // Slot 2 (bank 2)
                        for (let i = 0; i < data.length && i < PAGE_SIZE; i++) {
                            memory.write(SLOT2_START + i, data[i]);
                        }
                        break;
                    case 5: // Slot 3 (bank 0)
                        for (let i = 0; i < data.length && i < PAGE_SIZE; i++) {
                            memory.write(SLOT3_START + i, data[i]);
                        }
                        break;
                    case 8: // Slot 1 (bank 5)
                        for (let i = 0; i < data.length && i < PAGE_SIZE; i++) {
                            memory.write(SLOT1_START + i, data[i]);
                        }
                        break;
                }
            } else {
                // 128K/Pentagon mode
                // Page numbers 3-10 map to RAM banks 0-7
                // Page 0 = 48K ROM (bank 1 for 128K/Pentagon)
                // Page 2 = 128K ROM (bank 0 for 128K/Pentagon)
                if (pageNum === 0) {
                    // 48K ROM modifications - load into ROM bank 1
                    const romBank = memory.rom[1];
                    if (romBank) {
                        romBank.set(data.subarray(0, Math.min(data.length, PAGE_SIZE)));
                    }
                } else if (pageNum === 2) {
                    // 128K ROM modifications - load into ROM bank 0
                    const romBank = memory.rom[0];
                    if (romBank) {
                        romBank.set(data.subarray(0, Math.min(data.length, PAGE_SIZE)));
                    }
                } else {
                    const bankNum = pageNum - 3;
                    const maxBanks = memory.profile ? memory.profile.ramPages : 8;
                    if (bankNum >= 0 && bankNum < maxBanks) {
                        const ramBank = memory.getRamBank(bankNum);
                        if (ramBank) {
                            ramBank.set(data.subarray(0, Math.min(data.length, PAGE_SIZE)));
                        }
                    }
                }
            }
        }
    }
