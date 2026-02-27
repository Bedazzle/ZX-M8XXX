// Extracted from index.html inline script, lines 14347-14552
// Pure functions for parsing ZX Spectrum snapshot files (.z80, .sna)

// Read a little-endian 16-bit word from data at offset
// Lines 14697-14699
export function readWord(data, offset) {
    return data[offset] | (data[offset + 1] << 8);
}

// Detect snapshot type from raw data
// Lines 14347-14371
export function detectSnapshotType(data) {
    const size = data.byteLength;
    // SNA sizes
    if (size === 49179) return 'sna48';
    if (size === 131103 || size === 147487) return 'sna128';
    // Z80 detection - check header structure
    if (size >= 30) {
        const pc = data[6] | (data[7] << 8);
        if (pc === 0 && size >= 55) {
            // V2 or V3 z80
            const extLen = data[30] | (data[31] << 8);
            if (extLen === 23 || extLen === 54 || extLen === 55) {
                const hwMode = data[34];
                if (extLen === 23) {
                    return (hwMode === 3 || hwMode === 4) ? 'z80-128' : 'z80-48';
                } else {
                    return (hwMode >= 4 && hwMode <= 6) ? 'z80-128' : 'z80-48';
                }
            }
        } else if (pc !== 0) {
            return 'z80-48'; // V1 z80
        }
    }
    return 'binary';
}

// Decompress a Z80-format compressed block
// Lines 14374-14392
export function decompressZ80Block(data, maxLen, compressed) {
    if (!compressed) return data.slice(0, maxLen);
    const result = new Uint8Array(maxLen);
    let srcIdx = 0, dstIdx = 0;
    while (srcIdx < data.length && dstIdx < maxLen) {
        if (srcIdx + 3 < data.length && data[srcIdx] === 0xED && data[srcIdx + 1] === 0xED) {
            const count = data[srcIdx + 2];
            const value = data[srcIdx + 3];
            for (let i = 0; i < count && dstIdx < maxLen; i++) result[dstIdx++] = value;
            srcIdx += 4;
        } else if (data[srcIdx] === 0x00 && srcIdx + 3 < data.length &&
                   data[srcIdx + 1] === 0xED && data[srcIdx + 2] === 0xED && data[srcIdx + 3] === 0x00) {
            break;
        } else {
            result[dstIdx++] = data[srcIdx++];
        }
    }
    return result.slice(0, dstIdx);
}

// Map Z80 page number to base address in 64K address space
// Lines 14481-14496
export function getZ80PageAddress(pageNum, is128K) {
    if (is128K) {
        // 128K: page 3=bank0, 4=bank1, 5=bank2, 6=bank3, 7=bank4, 8=bank5, 9=bank6, 10=bank7
        // Banks 5,2,paged map to 4000,8000,C000
        if (pageNum === 8) return 0x4000; // Bank 5
        if (pageNum === 4) return 0x8000; // Bank 2
        // For simplicity, we only support the main 48K view
        return -1;
    } else {
        // 48K: page 4=8000-BFFF, 5=C000-FFFF, 8=4000-7FFF
        if (pageNum === 8) return 0x4000;
        if (pageNum === 4) return 0x8000;
        if (pageNum === 5) return 0xC000;
    }
    return -1;
}

// Parse .z80 file into normalized format
// Lines 14395-14478
export function parseZ80File(data) {
    const bytes = data;
    if (bytes.length < 30) return null;

    const result = {
        registers: {},
        memory: new Uint8Array(65536),
        is128K: false,
        border: 0,
        port7FFD: 0
    };

    // Read header
    result.registers.A = bytes[0];
    result.registers.F = bytes[1];
    result.registers.BC = bytes[2] | (bytes[3] << 8);
    result.registers.HL = bytes[4] | (bytes[5] << 8);
    let pc = bytes[6] | (bytes[7] << 8);
    result.registers.SP = bytes[8] | (bytes[9] << 8);
    result.registers.I = bytes[10];
    result.registers.R = (bytes[11] & 0x7f) | ((bytes[12] & 0x01) << 7);

    const byte12 = bytes[12];
    result.border = (byte12 >> 1) & 0x07;
    const compressed = (byte12 & 0x20) !== 0;

    result.registers.DE = bytes[13] | (bytes[14] << 8);
    result.registers["BC'"] = bytes[15] | (bytes[16] << 8);
    result.registers["DE'"] = bytes[17] | (bytes[18] << 8);
    result.registers["HL'"] = bytes[19] | (bytes[20] << 8);
    result.registers["AF'"] = (bytes[21] << 8) | bytes[22];
    result.registers.IY = bytes[23] | (bytes[24] << 8);
    result.registers.IX = bytes[25] | (bytes[26] << 8);
    result.registers.IFF1 = bytes[27] !== 0 ? 1 : 0;
    result.registers.IFF2 = bytes[28] !== 0 ? 1 : 0;
    result.registers.IM = bytes[29] & 0x03;

    if (pc !== 0) {
        // Version 1 - 48K only
        result.registers.PC = pc;
        const memData = decompressZ80Block(bytes.subarray(30), 49152, compressed);
        for (let i = 0; i < memData.length; i++) result.memory[0x4000 + i] = memData[i];
        return result;
    }

    // Version 2 or 3
    const extHeaderLen = bytes[30] | (bytes[31] << 8);
    result.registers.PC = bytes[32] | (bytes[33] << 8);
    const hwMode = bytes[34];

    if (extHeaderLen === 23) {
        result.is128K = (hwMode === 3 || hwMode === 4);
    } else {
        result.is128K = (hwMode >= 4 && hwMode <= 6);
    }

    if (result.is128K && bytes.length > 35) {
        result.port7FFD = bytes[35];
    }

    // Load memory pages
    let offset = 32 + extHeaderLen;
    while (offset < bytes.length - 3) {
        const blockLen = bytes[offset] | (bytes[offset + 1] << 8);
        const pageNum = bytes[offset + 2];
        offset += 3;
        if (blockLen === 0xffff) {
            // Uncompressed
            for (let i = 0; i < 16384 && offset + i < bytes.length; i++) {
                const addr = getZ80PageAddress(pageNum, result.is128K);
                if (addr >= 0) result.memory[addr + i] = bytes[offset + i];
            }
            offset += 16384;
        } else {
            const blockData = bytes.subarray(offset, offset + blockLen);
            const pageData = decompressZ80Block(blockData, 16384, true);
            const addr = getZ80PageAddress(pageNum, result.is128K);
            if (addr >= 0) {
                for (let i = 0; i < pageData.length; i++) result.memory[addr + i] = pageData[i];
            }
            offset += blockLen;
        }
    }
    return result;
}

// Parse .sna file into normalized format
// Lines 14499-14544
export function parseSnaFile(data) {
    const is128K = data.byteLength > 49179;
    const result = {
        registers: {},
        memory: new Uint8Array(65536),
        is128K: is128K,
        border: data[26],
        port7FFD: is128K ? data[49181] : 0
    };

    result.registers.I = data[0];
    result.registers["HL'"] = data[1] | (data[2] << 8);
    result.registers["DE'"] = data[3] | (data[4] << 8);
    result.registers["BC'"] = data[5] | (data[6] << 8);
    result.registers["AF'"] = data[7] | (data[8] << 8);
    result.registers.HL = data[9] | (data[10] << 8);
    result.registers.DE = data[11] | (data[12] << 8);
    result.registers.BC = data[13] | (data[14] << 8);
    result.registers.IY = data[15] | (data[16] << 8);
    result.registers.IX = data[17] | (data[18] << 8);
    result.registers.IFF2 = (data[19] & 0x04) ? 1 : 0;
    result.registers.IFF1 = result.registers.IFF2;
    result.registers.R = data[20];
    result.registers.AF = data[21] | (data[22] << 8);
    result.registers.A = data[22];
    result.registers.F = data[21];
    result.registers.SP = data[23] | (data[24] << 8);
    result.registers.IM = data[25];

    // Copy memory (48K: 0x4000-0xFFFF)
    for (let i = 0; i < 49152 && 27 + i < data.length; i++) {
        result.memory[0x4000 + i] = data[27 + i];
    }

    // For 48K SNA, PC is on stack
    if (!is128K) {
        const sp = result.registers.SP;
        if (sp >= 0x4000 && sp < 0xFFFF) {
            result.registers.PC = result.memory[sp] | (result.memory[sp + 1] << 8);
        }
    } else {
        result.registers.PC = data[49179] | (data[49180] << 8);
    }

    return result;
}

// Parse any snapshot file (auto-detect type)
// Lines 14547-14552
export function parseSnapshotFile(data) {
    const type = detectSnapshotType(data);
    if (type.startsWith('sna')) return parseSnaFile(data);
    if (type.startsWith('z80')) return parseZ80File(data);
    return null;
}

// SNA header field definitions (used by tools compare view)
// Lines 14555-14578
export const SNA_HEADER_48K = [
    { offset: 0, size: 1, name: 'I' },
    { offset: 1, size: 2, name: "HL'" },
    { offset: 3, size: 2, name: "DE'" },
    { offset: 5, size: 2, name: "BC'" },
    { offset: 7, size: 2, name: "AF'" },
    { offset: 9, size: 2, name: 'HL' },
    { offset: 11, size: 2, name: 'DE' },
    { offset: 13, size: 2, name: 'BC' },
    { offset: 15, size: 2, name: 'IY' },
    { offset: 17, size: 2, name: 'IX' },
    { offset: 19, size: 1, name: 'IFF2', format: v => v & 0x04 ? '1' : '0' },
    { offset: 20, size: 1, name: 'R' },
    { offset: 21, size: 2, name: 'AF' },
    { offset: 23, size: 2, name: 'SP' },
    { offset: 25, size: 1, name: 'IM', format: v => v.toString() },
    { offset: 26, size: 1, name: 'Border', format: v => v.toString() }
];

export const SNA_HEADER_128K = [
    ...SNA_HEADER_48K,
    { offset: 49179, size: 2, name: 'PC' },
    { offset: 49181, size: 1, name: 'Port 7FFD' },
    { offset: 49182, size: 1, name: 'TR-DOS ROM', format: v => v ? 'Yes' : 'No' }
];

// Parse SNA header into key-value object with field metadata
// Lines 14701-14723
export function parseSnaHeader(data) {
    const is128K = data.byteLength > 49179;
    const fields = is128K ? SNA_HEADER_128K : SNA_HEADER_48K;
    const result = {};
    for (const field of fields) {
        let value;
        if (field.size === 1) {
            value = data[field.offset];
        } else {
            value = readWord(data, field.offset);
        }
        result[field.name] = { value, field };
    }
    // For 48K SNA, PC is on stack
    if (!is128K) {
        const sp = readWord(data, 23);
        const stackOffset = 27 + sp - 0x4000;
        if (stackOffset >= 27 && stackOffset < data.byteLength - 1) {
            result['PC (from stack)'] = { value: readWord(data, stackOffset), field: { size: 2 } };
        }
    }
    return result;
}
