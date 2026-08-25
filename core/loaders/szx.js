/**
 * ZX-M8XXX - SZX snapshots
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

import {
    PAGE_SIZE, SLOT1_START, SLOT2_START, SLOT3_START, P7FFD_RAM_MASK, P7FFD_SCREEN_BIT, P7FFD_ROM_BIT, P7FFD_LOCK_BIT
} from '../constants.js';
import { getMachineBySzxId } from '../machines.js';

    /**
     * SZX Loader - Modern ZX Spectrum snapshot format
     * Used by Spectaculator, ZXSpin, Fuse, etc.
     */
    export class SZXLoader {
        static isSZX(data) {
            const bytes = new Uint8Array(data);
            return bytes.length >= 8 &&
                   bytes[0] === 0x5A && bytes[1] === 0x58 &&  // "ZX"
                   bytes[2] === 0x53 && bytes[3] === 0x54;    // "ST"
        }

        static getMachineType(machineId) {
            // Use profile-based lookup when available
            const profileType = getMachineBySzxId(machineId);
            if (profileType !== 'unknown') return profileType;
            // Fallback for IDs not in our profiles
            const types = {
                0: '16k', 5: '+3', 6: '+3e',
                8: 'scorpion', 9: 'didaktik', 10: '+2c', 11: '+2cs'
            };
            return types[machineId] || 'unknown';
        }

        /**
         * Parse SZX file and return structure info
         */
        static parse(data) {
            const bytes = new Uint8Array(data);
            if (!this.isSZX(data)) throw new Error('Not a valid SZX file');

            const info = {
                majorVersion: bytes[4],
                minorVersion: bytes[5],
                machineId: bytes[6],
                machineType: this.getMachineType(bytes[6]),
                flags: bytes[7],
                chunks: [],
                is128: bytes[6] >= 2 && bytes[6] <= 8
            };

            let offset = 8;
            while (offset < bytes.length - 8) {
                const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
                const size = bytes[offset + 4] | (bytes[offset + 5] << 8) |
                            (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);

                if (offset + 8 + size > bytes.length) break;

                info.chunks.push({
                    id: id,
                    offset: offset + 8,
                    size: size
                });

                offset += 8 + size;
            }

            return info;
        }

        /**
         * Decompress zlib data (requires pako)
         */
        static decompress(data) {
            if (typeof pako !== 'undefined') {
                return pako.inflate(data);
            }
            throw new Error('pako library required for SZX decompression');
        }

        /**
         * Extract RAM page from SZX (handles RAMP chunks)
         */
        static extractRAMPage(data, info, pageNum) {
            const bytes = new Uint8Array(data);

            for (const chunk of info.chunks) {
                if (chunk.id === 'RAMP') {
                    const flags = bytes[chunk.offset] | (bytes[chunk.offset + 1] << 8);
                    const page = bytes[chunk.offset + 2];

                    if (page === pageNum) {
                        const compressed = (flags & 1) !== 0;
                        const pageData = bytes.slice(chunk.offset + 3, chunk.offset + chunk.size);

                        if (compressed) {
                            return this.decompress(pageData);
                        }
                        return pageData;
                    }
                }
            }
            return null;
        }

        /**
         * Extract screen data (6912 bytes) from SZX
         */
        static extractScreen(data) {
            const info = this.parse(data);

            // Screen is in page 5 for 128K, or page 5 equivalent for 48K
            // In SZX, 48K uses pages 0,2,5 mapped to 16K-48K range
            // Page 5 is always at $4000-$7FFF
            const screenPage = info.is128 ? 5 : 5;
            const pageData = this.extractRAMPage(data, info, screenPage);

            if (pageData && pageData.length >= 6912) {
                return pageData.slice(0, 6912);
            }
            return null;
        }

        /**
         * Load SZX into emulator
         */
        static load(data, cpu, memory, ula, peripherals = null) {
            const bytes = new Uint8Array(data);
            const info = this.parse(data);

            // Determine machine type
            const machineType = info.is128 ? '128k' : '48k';

            // Peripherals: AY, Beta Disk, ULAplus. Absent chunks leave the current
            // state alone, so an old snapshot still loads.
            if (peripherals) {
                for (const chunk of info.chunks) {
                    const c = bytes.slice(chunk.offset, chunk.offset + chunk.size);
                    if (chunk.id === 'AY\0\0' && peripherals.ay && c.length >= 18) {
                        peripherals.ay.selectedRegister = c[1] & 0x0F;
                        for (let i = 0; i < 16; i++) {
                            if (peripherals.ay.writeRegister) {
                                peripherals.ay.selectedRegister = i;
                                peripherals.ay.writeRegister(c[2 + i]);
                            } else if (peripherals.ay.registers) {
                                peripherals.ay.registers[i] = c[2 + i];
                            }
                        }
                        peripherals.ay.selectedRegister = c[1] & 0x0F;
                    } else if (chunk.id === 'B128' && peripherals.betaDisk && c.length >= 10) {
                        const bd = peripherals.betaDisk;
                        const flags = c[0] | (c[1] << 8) | (c[2] << 16) | (c[3] << 24);
                        bd.systemReg = c[5];
                        bd.track = c[6];
                        bd.sector = c[7];
                        bd.data = c[8];
                        bd.status = c[9];
                        bd.seekLower = !!(flags & 0x10);
                        if (peripherals.setBetaDiskPaged) peripherals.setBetaDiskPaged(!!(flags & 0x04));
                    } else if (chunk.id === 'M8BD' && peripherals.setBetaDiskExtra && c.length >= 11) {
                        const len = c[9] | (c[10] << 8);
                        peripherals.setBetaDiskExtra({
                            command: c[0], drive: c[1], side: c[2],
                            headTracks: [c[3], c[4], c[5], c[6]],
                            dataPos: c[7] | (c[8] << 8),
                            dataBuffer: len ? c.slice(11, 11 + len) : null,
                        });
                    } else if (chunk.id === 'M8MP' && peripherals.setMedia && c.length) {
                        try {
                            peripherals.setMedia(JSON.parse(new TextDecoder().decode(c)));
                        } catch (e) {
                            // A corrupt media block must not stop the snapshot loading
                        }
                    } else if (chunk.id === 'M8UP' && peripherals.ulaPlus && c.length >= 66) {
                        const up = peripherals.ulaPlus;
                        up.setState(!!c[0], c[1], c.slice(2, 66));
                    }
                }
            }

            // Load Z80 registers (Z80R chunk)
            for (const chunk of info.chunks) {
                if (chunk.id === 'Z80R') {
                    const r = bytes.slice(chunk.offset, chunk.offset + chunk.size);
                    // Debug: log raw Z80R bytes for iff1/iff2/halted/tStates
                    const tStates = r[29] | (r[30] << 8) | (r[31] << 16) | (r[32] << 24);
                    cpu.f = r[0]; cpu.a = r[1];
                    cpu.c = r[2]; cpu.b = r[3];
                    cpu.e = r[4]; cpu.d = r[5];
                    cpu.l = r[6]; cpu.h = r[7];
                    cpu.f_ = r[8]; cpu.a_ = r[9];
                    cpu.c_ = r[10]; cpu.b_ = r[11];
                    cpu.e_ = r[12]; cpu.d_ = r[13];
                    cpu.l_ = r[14]; cpu.h_ = r[15];
                    cpu.ixl = r[16]; cpu.ixh = r[17];
                    cpu.iyl = r[18]; cpu.iyh = r[19];
                    cpu.sp = r[20] | (r[21] << 8);
                    cpu.pc = r[22] | (r[23] << 8);
                    cpu.i = r[24];
                    cpu.r = r[25];
                    cpu.iff1 = r[26] & 1;
                    cpu.iff2 = r[27] & 1;
                    cpu.im = r[28];
                    // r[29-32] are T-states
                    cpu.tStates = r[29] | (r[30] << 8) | (r[31] << 16) | (r[32] << 24);
                    // HALT state is ZXSTZF_HALTED (bit 1, 0x02) of chFlags at offset 34
                    // (offset 33 is chHoldIntReqCycles), per the SZX spec.
                    // Don't trust it if PC indicates interrupt-handler execution
                    // (PC=0x38 IM1 or PC=0x66 NMI means the CPU is in a handler, not halted).
                    const pc = cpu.pc;
                    if (r.length > 34 && (r[34] & 0x02) && pc !== 0x0038 && pc !== 0x0066) {
                        cpu.halted = true;
                    } else {
                        cpu.halted = false;
                    }
                    break;
                }
            }

            // Load Spectrum state (SPCR chunk)
            let port7FFD = 0;
            let port1FFD = 0;
            for (const chunk of info.chunks) {
                if (chunk.id === 'SPCR') {
                    const border = bytes[chunk.offset];
                    port7FFD = bytes[chunk.offset + 1];
                    // bytes[chunk.offset + 2] is port $FE (not needed)
                    port1FFD = bytes[chunk.offset + 3] || 0;  // Port 0x1FFD (+2A/+3)
                    if (ula) ula.setBorder(border);
                    break;
                }
            }

            // Load RAM pages
            if (info.is128) {
                // Load all RAM pages (8 for 128K, 16 for Scorpion, 64 for Pentagon 1024)
                const pageCount = memory.profile.ramPages;
                for (let page = 0; page < pageCount; page++) {
                    const pageData = this.extractRAMPage(data, info, page);
                    if (pageData) {
                        const bank = memory.getRamBank(page);
                        if (bank) bank.set(pageData.slice(0, PAGE_SIZE));
                    }
                }
                // Reset paging lock before setting paging state from snapshot
                // (otherwise writePaging returns early if previous program locked paging)
                memory.pagingDisabled = false;
                // Set paging state — apply secondary port before 0x7FFD so ROM bank combines correctly
                if (memory.profile.pagingModel === '+2a') {
                    memory.write1FFD(port1FFD);
                } else if (memory.profile.pagingModel === 'scorpion') {
                    memory.writeScorpion1FFD(port1FFD);
                } else if (memory.profile.pagingModel === 'pentagon1024') {
                    memory.writePortEFF7(port1FFD);
                }
                memory.writePaging(port7FFD);
            } else {
                // 48K: pages 0, 2, 5 map to $C000, $8000, $4000
                const page5 = this.extractRAMPage(data, info, 5);
                const page2 = this.extractRAMPage(data, info, 2);
                const page0 = this.extractRAMPage(data, info, 0);

                if (page5) memory.setBlock(SLOT1_START, page5.slice(0, PAGE_SIZE));
                if (page2) memory.setBlock(SLOT2_START, page2.slice(0, PAGE_SIZE));
                if (page0) memory.setBlock(SLOT3_START, page0.slice(0, PAGE_SIZE));
            }

            return { machineType, info };
        }

        /**
         * Create SZX snapshot
         */
        // `peripherals` carries the state that isn't CPU/RAM/paging: the AY chip and
        // the Beta Disk controller, plus ULAplus. Without it a restored snapshot
        // (quickload, a save slot, a rewind step) leaves the disk controller and the
        // sound chip where they were, which desyncs a TR-DOS operation in flight.
        //
        // Layouts are the documented ones (spectaculator.com/docs/zx-state):
        //   AY\0\0  chFlags, chCurrentRegister, chAyRegs[16]
        //   B128   dwFlags, chNumDrives, chSysReg, chTrackReg, chSectorReg,
        //          chDataReg, chStatusReg [, custom ROM]
        // ULAplus has no confirmed chunk layout available, so it goes in a private
        // 'M8UP' chunk: other emulators skip chunks they don't know, and inventing a
        // standard-looking one would produce files they'd misread.
        static create(cpu, memory, border = 7, peripherals = null) {
            const is128k = memory.machineType !== '48k';
            const chunks = [];

            // Header (8 bytes): "ZXST" + version + machine ID + flags
            const header = new Uint8Array(8);
            header[0] = 0x5A; header[1] = 0x58;  // "ZX"
            header[2] = 0x53; header[3] = 0x54;  // "ST"
            header[4] = 1;    // Major version
            header[5] = 4;    // Minor version
            header[6] = memory.profile.szxMachineId;  // Machine ID from profile
            header[7] = 0;    // Flags
            chunks.push(header);

            // Z80R chunk - CPU registers (37 bytes)
            const z80rData = new Uint8Array(37);
            z80rData[0] = cpu.f; z80rData[1] = cpu.a;
            z80rData[2] = cpu.c; z80rData[3] = cpu.b;
            z80rData[4] = cpu.e; z80rData[5] = cpu.d;
            z80rData[6] = cpu.l; z80rData[7] = cpu.h;
            z80rData[8] = cpu.f_; z80rData[9] = cpu.a_;
            z80rData[10] = cpu.c_; z80rData[11] = cpu.b_;
            z80rData[12] = cpu.e_; z80rData[13] = cpu.d_;
            z80rData[14] = cpu.l_; z80rData[15] = cpu.h_;
            z80rData[16] = cpu.ix & 0xff; z80rData[17] = (cpu.ix >> 8) & 0xff;
            z80rData[18] = cpu.iy & 0xff; z80rData[19] = (cpu.iy >> 8) & 0xff;
            z80rData[20] = cpu.sp & 0xff; z80rData[21] = (cpu.sp >> 8) & 0xff;
            z80rData[22] = cpu.pc & 0xff; z80rData[23] = (cpu.pc >> 8) & 0xff;
            z80rData[24] = cpu.i;
            z80rData[25] = cpu.rFull;
            z80rData[26] = cpu.iff1 ? 1 : 0;
            z80rData[27] = cpu.iff2 ? 1 : 0;
            z80rData[28] = cpu.im;
            // T-states (bytes 29-32) - leave as 0
            // byte 33 = chHoldIntReqCycles (not tracked → 0)
            // byte 34 = chFlags: ZXSTZF_HALTED is bit 1 (0x02), per the SZX spec
            z80rData[34] = cpu.halted ? 0x02 : 0;
            // bytes 35-36 = wMemPtr - leave as 0
            chunks.push(this.makeChunk('Z80R', z80rData));

            // SPCR chunk - Spectrum state (8 bytes)
            const spcrData = new Uint8Array(8);
            spcrData[0] = border & 0x07;
            if (is128k) {
                const ps = memory.getPagingState();
                // Byte 1: port 0x7FFD value — reconstruct from paging state
                let port7FFD = (ps.ramBank & P7FFD_RAM_MASK) | (ps.screenBank === 7 ? P7FFD_SCREEN_BIT : 0x00) |
                              ((ps.romBank & 1) ? P7FFD_ROM_BIT : 0x00) | (ps.pagingDisabled ? P7FFD_LOCK_BIT : 0x00);
                // Pentagon 1024: bits 6-7 carry RAM bank bits 3-4, bit 5 carries bit 5 in 1MB mode
                if (memory.profile.pagingModel === 'pentagon1024') {
                    port7FFD |= (ps.ramBank & 0x18) << 3;  // bits 3,4 → 6,7
                    if (ps.pentagon1024Mode) {
                        port7FFD |= (ps.ramBank & 0x20);   // bit 5 → 5
                    }
                }
                spcrData[1] = port7FFD;
            }
            spcrData[2] = border & 0x07;  // Port $FE
            // Byte 3: port 0x1FFD (+2A/+3/Scorpion) or portEFF7 (Pentagon 1024)
            if (memory.profile.pagingModel === '+2a') {
                spcrData[3] = memory.port1FFD || 0;
            } else if (memory.profile.pagingModel === 'scorpion') {
                spcrData[3] = memory.scorpionPort1FFD || 0;
            } else if (memory.profile.pagingModel === 'pentagon1024') {
                spcrData[3] = memory.portEFF7 || 0;
            }
            // Bytes 4-7: reserved
            chunks.push(this.makeChunk('SPCR', spcrData));

            // AY chunk — written whenever the machine has an AY, so restoring a
            // state doesn't leave the previous tune's registers playing.
            if (peripherals && peripherals.ay) {
                const ay = peripherals.ay;
                const ayData = new Uint8Array(18);
                ayData[0] = 0;                                   // chFlags: built-in AY
                ayData[1] = (ay.selectedRegister || 0) & 0x0F;
                for (let i = 0; i < 16; i++) ayData[2 + i] = (ay.registers && ay.registers[i]) || 0;
                chunks.push(this.makeChunk('AY\0\0', ayData));
            }

            // B128 chunk — the WD1793 registers. A rewind mid-load restores the CPU
            // to a point where it believes a command is in flight; without these the
            // controller would still be wherever it had got to.
            if (peripherals && peripherals.betaDisk) {
                const bd = peripherals.betaDisk;
                const b = new Uint8Array(10);
                let flags = 0x01;                                // CONNECTED
                if (peripherals.betaDiskPaged) flags |= 0x04;    // PAGED
                if (bd.seekLower) flags |= 0x10;                 // SEEKLOWER
                b[0] = flags & 0xFF; b[1] = (flags >> 8) & 0xFF;
                b[2] = (flags >> 16) & 0xFF; b[3] = (flags >> 24) & 0xFF;
                b[4] = bd.numDrives || 1;
                b[5] = bd.systemReg & 0xFF;
                b[6] = bd.track & 0xFF;
                b[7] = bd.sector & 0xFF;
                b[8] = bd.data & 0xFF;
                b[9] = bd.status & 0xFF;
                chunks.push(this.makeChunk('B128', b));
            }

            // Private: the Beta Disk state B128 has no field for (see above).
            if (peripherals && peripherals.betaDiskExtra) {
                const x = peripherals.betaDiskExtra;
                const buf = x.dataBuffer || new Uint8Array(0);
                const d = new Uint8Array(11 + buf.length);
                d[0] = x.command & 0xFF;
                d[1] = x.drive & 0xFF;
                d[2] = x.side & 0xFF;
                for (let i = 0; i < 4; i++) d[3 + i] = (x.headTracks[i] || 0) & 0xFF;
                d[7] = x.dataPos & 0xFF; d[8] = (x.dataPos >> 8) & 0xFF;
                d[9] = buf.length & 0xFF; d[10] = (buf.length >> 8) & 0xFF;
                d.set(buf, 11);
                chunks.push(this.makeChunk('M8BD', d));
            }

            // Private: media *position* — tape playback point, +D and Microdrive
            // seek state. JSON keeps it self-describing and it stays small (a few
            // hundred bytes); the media itself is never embedded.
            if (peripherals && peripherals.media) {
                const json = JSON.stringify(peripherals.media);
                const enc = new TextEncoder().encode(json);
                chunks.push(this.makeChunk('M8MP', enc));
            }

            // Private: ULAplus palette and mode (see note above).
            if (peripherals && peripherals.ulaPlus && peripherals.ulaPlus.palette) {
                const up = peripherals.ulaPlus;
                const u = new Uint8Array(2 + 64);
                u[0] = up.enabled ? 1 : 0;
                u[1] = (up.mode || 0) & 0xFF;
                for (let i = 0; i < 64; i++) u[2 + i] = up.palette[i] & 0xFF;
                chunks.push(this.makeChunk('M8UP', u));
            }

            // RAMP chunks - RAM pages
            if (is128k) {
                // Save all RAM pages (8 for 128K, 64 for Pentagon 1024, etc.)
                const pageCount = memory.profile.ramPages;
                for (let page = 0; page < pageCount; page++) {
                    const pageData = memory.getRamBank(page);
                    if (pageData) chunks.push(this.makeRAMPChunk(page, pageData));
                }
            } else {
                // 48K: save pages 5, 2, 0 (for slot 1, slot 2, slot 3)
                const pageMap = [
                    { page: 5, start: SLOT1_START },
                    { page: 2, start: SLOT2_START },
                    { page: 0, start: SLOT3_START }
                ];
                for (const { page, start } of pageMap) {
                    const pageData = new Uint8Array(PAGE_SIZE);
                    for (let i = 0; i < PAGE_SIZE; i++) {
                        pageData[i] = memory.read(start + i);
                    }
                    chunks.push(this.makeRAMPChunk(page, pageData));
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

        /**
         * Create a generic SZX chunk
         */
        static makeChunk(id, data) {
            const chunk = new Uint8Array(8 + data.length);
            // Chunk ID (4 bytes)
            for (let i = 0; i < 4; i++) {
                chunk[i] = id.charCodeAt(i);
            }
            // Size (4 bytes, little endian)
            chunk[4] = data.length & 0xff;
            chunk[5] = (data.length >> 8) & 0xff;
            chunk[6] = (data.length >> 16) & 0xff;
            chunk[7] = (data.length >> 24) & 0xff;
            // Data
            chunk.set(data, 8);
            return chunk;
        }

        /**
         * Create a RAMP (RAM Page) chunk with optional compression
         */
        static makeRAMPChunk(pageNum, pageData) {
            // Try to compress with pako if available
            let compressed = null;
            let useCompression = false;

            if (typeof pako !== 'undefined') {
                try {
                    compressed = pako.deflate(pageData);
                    // Only use compression if it actually saves space
                    if (compressed.length < pageData.length - 100) {
                        useCompression = true;
                    }
                } catch (e) {
                    // Compression failed, use uncompressed
                }
            }

            const data = useCompression ? compressed : pageData;
            const rampData = new Uint8Array(3 + data.length);

            // Flags (2 bytes): bit 0 = compressed
            rampData[0] = useCompression ? 1 : 0;
            rampData[1] = 0;
            // Page number
            rampData[2] = pageNum;
            // Page data
            rampData.set(data, 3);

            return this.makeChunk('RAMP', rampData);
        }
    }
