// ========== Compare Tool ==========
// Extracted from index.html inline script (lines 14313-15252)
// Provides snapshot/binary comparison with pagination, header diffing, and memory comparison.

// External dependencies (set via init function)
let spectrum = null;
let RZXLoader = null;
let SZXLoader = null;

// Module-level state
let compareDataA = null;
let compareDataB = null;
const DIFFS_PER_PAGE = 50;  // Number of diff blocks per page
let compareDiffsData = null;  // Stored diffs for pagination
let compareCurrentPage = 1;
let compareTotalPages = 1;
let compareRenderOptions = {};  // Store render options for re-rendering

// DOM element references (set in initCompareTool)
let chkCompareShowEqual = null;
let chkCompareHexDump = null;
let chkCompareExcludeScreen = null;
let compareHeaderResults = null;
let compareHeaderTable = null;
let compareDataResults = null;
let compareDataTitle = null;
let compareDiffCount = null;
let compareDataTable = null;
let compareNoResults = null;
let comparePagination = null;
let compareDiffCountNoPage = null;
let comparePrevPage = null;
let compareNextPage = null;
let comparePageInfo = null;
let compareGoToPage = null;
let compareGoPage = null;

// SNA header field definitions
const SNA_HEADER_48K = [
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
const SNA_HEADER_128K = [
    ...SNA_HEADER_48K,
    { offset: 49179, size: 2, name: 'PC' },
    { offset: 49181, size: 1, name: 'Port 7FFD' },
    { offset: 49182, size: 1, name: 'TR-DOS ROM', format: v => v ? 'Yes' : 'No' }
];

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

export function parseSnapshotFile(data) {
    const type = detectSnapshotType(data);
    if (type.startsWith('sna')) return parseSnaFile(data);
    if (type.startsWith('z80')) return parseZ80File(data);
    return null;
}

export function clearCompareResults() {
    compareHeaderResults.style.display = 'none';
    compareDataResults.style.display = 'none';
    compareNoResults.style.display = 'none';
    comparePagination.style.display = 'none';
    compareDiffCountNoPage.style.display = 'none';
    compareDiffsData = null;
    compareCurrentPage = 1;
    compareTotalPages = 1;
}

export async function extractCompareData(file) {
    const data = new Uint8Array(await file.arrayBuffer());
    const ext = file.name.toLowerCase().split('.').pop();

    // RZX: extract embedded snapshot
    if (ext === 'rzx' || RZXLoader.isRZX(data.buffer)) {
        try {
            const rzxLoader = new RZXLoader();
            await rzxLoader.parse(data.buffer);
            const snapshot = rzxLoader.getSnapshot();
            if (snapshot) {
                return snapshot;
            }
        } catch (e) {
            console.error('RZX extraction failed:', e);
        }
    }

    // SZX: extract 48K memory view for comparison
    if (ext === 'szx' || SZXLoader.isSZX(data.buffer)) {
        try {
            const info = SZXLoader.parse(data.buffer);
            // Build a synthetic SNA-like structure for comparison
            const memory = new Uint8Array(49152);
            // Extract pages 5, 2, and the paged bank
            const page5 = SZXLoader.extractRAMPage(data.buffer, info, 5);
            const page2 = SZXLoader.extractRAMPage(data.buffer, info, 2);
            const page0 = SZXLoader.extractRAMPage(data.buffer, info, 0);
            if (page5) memory.set(page5.slice(0, 16384), 0);
            if (page2) memory.set(page2.slice(0, 16384), 16384);
            if (page0) memory.set(page0.slice(0, 16384), 32768);
            // Return as fake SNA (27-byte header + memory)
            const result = new Uint8Array(27 + 49152);
            result.set(memory, 27);
            return result;
        } catch (e) {
            console.error('SZX extraction failed:', e);
        }
    }

    return data;
}

export function formatHex8(v) { return v.toString(16).toUpperCase().padStart(2, '0'); }

export function formatHex16(v) { return v.toString(16).toUpperCase().padStart(4, '0'); }

export function readWord(data, offset) {
    return data[offset] | (data[offset + 1] << 8);
}

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

export function compareHeaders(headerA, headerB, showEqual) {
    const rows = [];
    const allKeys = new Set([...Object.keys(headerA), ...Object.keys(headerB)]);
    for (const key of allKeys) {
        const a = headerA[key];
        const b = headerB[key];
        if (!a || !b) continue;
        const valA = a.field.format ? a.field.format(a.value) : (a.field.size === 2 ? formatHex16(a.value) : formatHex8(a.value));
        const valB = b.field.format ? b.field.format(b.value) : (b.field.size === 2 ? formatHex16(b.value) : formatHex8(b.value));
        const isDiff = a.value !== b.value;
        if (isDiff || showEqual) {
            const color = isDiff ? 'color:var(--red)' : 'color:var(--text-secondary)';
            rows.push(`<div style="${color}">${key.padEnd(12)}: ${valA.padEnd(6)} vs ${valB}${isDiff ? ' ◄' : ''}</div>`);
        }
    }
    return rows.join('');
}

export function escapeHtmlChar(charCode) {
    if (charCode < 32 || charCode >= 127) return '.';
    if (charCode === 32) return '&nbsp;';  // space - use non-breaking space
    if (charCode === 60) return '&lt;';    // <
    if (charCode === 62) return '&gt;';    // >
    if (charCode === 38) return '&amp;';   // &
    return String.fromCharCode(charCode);
}

export function compareBinaryData(dataA, dataB, offsetA = 0, offsetB = 0, length = null, showEqual = false, showHexDump = true) {
    const len = length || Math.max(dataA.byteLength - offsetA, dataB.byteLength - offsetB);
    const diffs = [];

    for (let i = 0; i < len; i++) {
        const addrA = offsetA + i;
        const addrB = offsetB + i;
        const a = addrA < dataA.byteLength ? dataA[addrA] : null;
        const b = addrB < dataB.byteLength ? dataB[addrB] : null;
        const isDiff = a !== b;
        if (isDiff || showEqual) {
            diffs.push({ offset: i, addrA, addrB, a, b, isDiff });
        }
    }

    if (diffs.length === 0) return { count: 0, html: '' };

    // Group consecutive differences for hex dump
    let html = '';
    if (showHexDump && diffs.length > 0) {
        const diffCount = diffs.filter(d => d.isDiff).length;
        // Show in groups of 16 bytes
        let i = 0;
        while (i < diffs.length && i < 1000) { // Limit display
            const startOffset = diffs[i].offset & ~0xF; // Align to 16
            const rows = [];

            // Find range of diffs in this area
            let endI = i;
            while (endI < diffs.length && diffs[endI].offset < startOffset + 32) endI++;

            // Output one or two lines
            for (let lineStart = startOffset; lineStart < startOffset + 32 && i < endI; lineStart += 16) {
                let hexA = '', hexB = '', ascA = '', ascB = '';
                for (let j = 0; j < 16; j++) {
                    const off = lineStart + j;
                    const diff = diffs.find(d => d.offset === off);
                    const a = offsetA + off < dataA.byteLength ? dataA[offsetA + off] : null;
                    const b = offsetB + off < dataB.byteLength ? dataB[offsetB + off] : null;
                    const isDiff = diff && diff.isDiff;
                    const diffStyle = isDiff ? 'color:#ff6b6b;font-weight:bold' : '';
                    hexA += `<span style="${diffStyle}">${a !== null ? formatHex8(a) : '--'}</span> `;
                    hexB += `<span style="${diffStyle}">${b !== null ? formatHex8(b) : '--'}</span> `;
                    const ascCharA = a !== null ? escapeHtmlChar(a) : '.';
                    const ascCharB = b !== null ? escapeHtmlChar(b) : '.';
                    ascA += `<span style="${diffStyle}">${ascCharA}</span>`;
                    ascB += `<span style="${diffStyle}">${ascCharB}</span>`;
                }
                rows.push(`<div style="white-space:nowrap">${formatHex16(lineStart)}: ${hexA}|${ascA}|</div>`);
                rows.push(`<div style="white-space:nowrap;color:var(--cyan)">${formatHex16(lineStart)}: ${hexB}|${ascB}|</div>`);
            }
            html += rows.join('') + '<hr style="border-color:var(--border);margin:5px 0">';
            i = endI;
        }
        return { count: diffCount, html };
    } else {
        // Simple list
        const lines = diffs.slice(0, 500).map(d => {
            const color = d.isDiff ? 'color:#ff6b6b' : '';
            return `<div style="${color}">${formatHex16(d.offset)}: ${d.a !== null ? formatHex8(d.a) : '--'} vs ${d.b !== null ? formatHex8(d.b) : '--'}${d.isDiff ? ' ◄' : ''}</div>`;
        });
        if (diffs.length > 500) lines.push(`<div>... and ${diffs.length - 500} more</div>`);
        return { count: diffs.filter(d => d.isDiff).length, html: lines.join('') };
    }
}

export function compareSnapshotFiles(dataA, dataB) {
    const showEqual = chkCompareShowEqual.checked;
    const showHexDump = chkCompareHexDump.checked;
    const excludeScreen = chkCompareExcludeScreen.checked;

    // Parse both files into normalized format
    const typeA = detectSnapshotType(dataA);
    const typeB = detectSnapshotType(dataB);

    if (typeA === 'binary' || typeB === 'binary') {
        compareDataResults.style.display = 'block';
        compareDataTitle.textContent = 'Error';
        compareDiffCount.textContent = '';
        compareDataTable.innerHTML = '<div style="color:var(--red)">One or both files are not valid snapshot files (.SNA or .Z80)</div>';
        return;
    }

    const snapA = parseSnapshotFile(dataA);
    const snapB = parseSnapshotFile(dataB);

    if (!snapA || !snapB) {
        compareDataResults.style.display = 'block';
        compareDataTitle.textContent = 'Error';
        compareDiffCount.textContent = '';
        compareDataTable.innerHTML = '<div style="color:var(--red)">Failed to parse snapshot files</div>';
        return;
    }

    // Compare registers
    const headerHtml = compareSnapshotRegisters(snapA, snapB, showEqual, typeA, typeB);
    if (headerHtml) {
        compareHeaderResults.style.display = 'block';
        compareHeaderTable.innerHTML = headerHtml;
    }

    // Check for machine type mismatch
    if (snapA.is128K !== snapB.is128K) {
        compareDataResults.style.display = 'block';
        compareDataTitle.textContent = 'Memory Comparison';
        compareDiffCount.textContent = '(different machine types: 48K vs 128K)';
        compareDataTable.innerHTML = '<div style="color:var(--yellow)">Cannot compare 48K and 128K snapshots directly</div>';
        return;
    }

    // Compare memory (0x4000-0xFFFF range that both formats have)
    const result = compareMemoryData(snapA.memory, snapB.memory, 0x4000, 49152, showEqual, showHexDump, excludeScreen, snapA.is128K);
    if (result.count === 0 && !headerHtml) {
        compareNoResults.style.display = 'block';
        comparePagination.style.display = 'none';
    } else {
        compareDataResults.style.display = 'block';
        const blocksNote = result.totalBlocks ? `, ${result.totalBlocks} blocks` : '';
        compareDiffCount.textContent = `${result.count} bytes differ${blocksNote}`;
        compareDataTable.innerHTML = result.html || '<div style="color:var(--green)">Memory is identical</div>';
        updateComparePagination();
    }
}

export function compareSnapshotRegisters(snapA, snapB, showEqual, typeA, typeB) {
    // Helper to format a register comparison cell
    function regCell(name, a, b, is16bit) {
        if (a === undefined || b === undefined) return '';
        const isDiff = a !== b;
        const valA = is16bit ? formatHex16(a) : formatHex8(a);
        const valB = is16bit ? formatHex16(b) : formatHex8(b);
        const color = isDiff ? 'color:#ff6b6b;font-weight:bold' : '';
        const marker = isDiff ? ' ◄' : '';
        return `<span style="${color}">${name.padEnd(4)} ${valA} ${valB}${marker}</span>`;
    }

    // Main registers paired with alternate registers
    const pairs = [
        ['AF', "AF'"], ['BC', "BC'"], ['DE', "DE'"], ['HL', "HL'"]
    ];

    // Other register pairs
    const otherPairs = [
        ['PC', 'SP'], ['IX', 'IY']
    ];

    // 8-bit registers
    const reg8Pairs = [
        ['I', 'R'], ['IM', 'IFF1'], ['', 'IFF2']
    ];

    let html = '<div style="display:flex;gap:40px">';

    // Left column: main registers
    html += '<div>';
    for (const [main, alt] of pairs) {
        const mainCell = regCell(main, snapA.registers[main], snapB.registers[main], true);
        html += `<div style="white-space:nowrap">${mainCell}</div>`;
    }
    html += '<div style="height:8px"></div>';
    for (const [r1, r2] of otherPairs) {
        const cell = regCell(r1, snapA.registers[r1], snapB.registers[r1], true);
        html += `<div style="white-space:nowrap">${cell}</div>`;
    }
    html += '<div style="height:8px"></div>';
    for (const [r1, r2] of reg8Pairs) {
        if (r1) {
            const is16 = false;
            const cell = regCell(r1, snapA.registers[r1], snapB.registers[r1], is16);
            html += `<div style="white-space:nowrap">${cell}</div>`;
        }
    }
    // Border
    const borderDiff = snapA.border !== snapB.border;
    const borderColor = borderDiff ? 'color:#ff6b6b;font-weight:bold' : '';
    const borderMarker = borderDiff ? ' ◄' : '';
    html += `<div style="height:8px"></div>`;
    html += `<div style="white-space:nowrap;${borderColor}">Bord ${snapA.border}    ${snapB.border}${borderMarker}</div>`;
    // Port 7FFD for 128K
    if (snapA.is128K) {
        const pageDiff = snapA.port7FFD !== snapB.port7FFD;
        const pageColor = pageDiff ? 'color:#ff6b6b;font-weight:bold' : '';
        const pageMarker = pageDiff ? ' ◄' : '';
        html += `<div style="white-space:nowrap;${pageColor}">7FFD ${formatHex8(snapA.port7FFD)} ${formatHex8(snapB.port7FFD)}${pageMarker}</div>`;
    }
    html += '</div>';

    // Right column: alternate registers
    html += '<div>';
    for (const [main, alt] of pairs) {
        const altCell = regCell(alt, snapA.registers[alt], snapB.registers[alt], true);
        html += `<div style="white-space:nowrap">${altCell}</div>`;
    }
    html += '<div style="height:8px"></div>';
    for (const [r1, r2] of otherPairs) {
        const cell = regCell(r2, snapA.registers[r2], snapB.registers[r2], true);
        html += `<div style="white-space:nowrap">${cell}</div>`;
    }
    html += '<div style="height:8px"></div>';
    for (const [r1, r2] of reg8Pairs) {
        const is16 = false;
        const cell = regCell(r2, snapA.registers[r2], snapB.registers[r2], is16);
        html += `<div style="white-space:nowrap">${cell}</div>`;
    }
    html += '</div>';

    html += '</div>';
    return html;
}

export function isScreenAddress(addr, is128K) {
    // Main screen: $4000-$5AFF (6912 bytes: 6144 bitmap + 768 attrs)
    if (addr >= 0x4000 && addr < 0x5B00) return true;
    // 128K shadow screen in bank 7: $C000-$DAFF when bank 7 is paged
    // For comparison we check the logical address range
    if (is128K && addr >= 0xC000 && addr < 0xDB00) return true;
    return false;
}

export function compareMemoryData(memA, memB, startAddr, length, showEqual, showHexDump, excludeScreen = false, is128K = false, labelB = 'File B') {
    const diffs = [];
    for (let i = 0; i < length; i++) {
        const addr = startAddr + i;
        // Skip screen memory if requested
        if (excludeScreen && isScreenAddress(addr, is128K)) continue;
        const a = memA[addr];
        const b = memB[addr];
        const isDiff = a !== b;
        if (isDiff || showEqual) {
            diffs.push({ offset: addr, a, b, isDiff });
        }
    }

    if (diffs.length === 0) return { count: 0, html: '', paginated: false };

    const diffCount = diffs.filter(d => d.isDiff).length;

    // Group diffs into blocks (16-byte aligned)
    const blocks = [];
    let i = 0;
    while (i < diffs.length) {
        const startOffset = diffs[i].offset & ~0xF;
        let endI = i;
        while (endI < diffs.length && diffs[endI].offset < startOffset + 32) endI++;
        blocks.push({ startOffset, diffIndices: { start: i, end: endI } });
        i = endI;
    }

    // Store for pagination
    compareDiffsData = { diffs, blocks, memA, memB, startAddr, length, excludeScreen, is128K };
    compareRenderOptions = { showHexDump, labelB };
    compareTotalPages = Math.ceil(blocks.length / DIFFS_PER_PAGE);
    compareCurrentPage = 1;

    // Render first page
    const html = renderComparePage(1);
    const paginated = blocks.length > DIFFS_PER_PAGE;

    return { count: diffCount, html, paginated, totalBlocks: blocks.length };
}

export function renderComparePage(page) {
    if (!compareDiffsData) return '';

    const { diffs, blocks, memA, memB, startAddr, length, excludeScreen, is128K } = compareDiffsData;
    const { showHexDump, labelB } = compareRenderOptions;

    const startBlock = (page - 1) * DIFFS_PER_PAGE;
    const endBlock = Math.min(startBlock + DIFFS_PER_PAGE, blocks.length);

    if (showHexDump) {
        // Build content for both columns
        let linesA = '';
        let linesB = '';

        for (let bi = startBlock; bi < endBlock; bi++) {
            const block = blocks[bi];
            const startOffset = block.startOffset;

            for (let lineStart = startOffset; lineStart < startOffset + 32; lineStart += 16) {
                let hexA = '', hexB = '', ascA = '', ascB = '';
                for (let j = 0; j < 16; j++) {
                    const off = lineStart + j;
                    if (off < startAddr || off >= startAddr + length || (excludeScreen && isScreenAddress(off, is128K))) {
                        hexA += '<span style="color:var(--text-secondary)">--</span> ';
                        hexB += '<span style="color:var(--text-secondary)">--</span> ';
                        ascA += '<span> </span>';
                        ascB += '<span> </span>';
                        continue;
                    }
                    const diff = diffs.find(d => d.offset === off);
                    const a = memA[off];
                    const b = memB[off];
                    const isDiff = diff && diff.isDiff;
                    const diffStyle = isDiff ? 'color:#ff6b6b;font-weight:bold' : '';
                    hexA += `<span style="${diffStyle}">${formatHex8(a)}</span> `;
                    hexB += `<span style="${diffStyle}">${formatHex8(b)}</span> `;
                    // ASCII - always wrap in span, with red for differences
                    const ascCharA = escapeHtmlChar(a);
                    const ascCharB = escapeHtmlChar(b);
                    ascA += `<span style="${diffStyle}">${ascCharA}</span>`;
                    ascB += `<span style="${diffStyle}">${ascCharB}</span>`;
                }
                linesA += `<div style="white-space:nowrap">${formatHex16(lineStart)}: ${hexA}|${ascA}|</div>`;
                linesB += `<div style="white-space:nowrap">${formatHex16(lineStart)}: ${hexB}|${ascB}|</div>`;
            }
            linesA += '<hr style="border-color:var(--border);margin:3px 0">';
            linesB += '<hr style="border-color:var(--border);margin:3px 0">';
        }

        // Build side-by-side layout
        return `<div style="display:flex;gap:20px">
            <div style="flex:1;min-width:380px">
                <div style="color:var(--cyan);margin-bottom:5px">File A:</div>
                ${linesA}
            </div>
            <div style="flex:1;min-width:380px">
                <div style="color:var(--cyan);margin-bottom:5px">${labelB}:</div>
                ${linesB}
            </div>
        </div>`;
    } else {
        // Simple list mode - show diffs from blocks on this page
        const pageStart = blocks[startBlock].diffIndices.start;
        const pageEnd = blocks[endBlock - 1].diffIndices.end;
        const pageDiffs = diffs.slice(pageStart, pageEnd);

        const lines = pageDiffs.map(d => {
            const color = d.isDiff ? 'color:#ff6b6b' : '';
            return `<div style="${color}">${formatHex16(d.offset)}: ${formatHex8(d.a)} vs ${formatHex8(d.b)}${d.isDiff ? ' ◄' : ''}</div>`;
        });
        return lines.join('');
    }
}

export function updateComparePagination() {
    if (compareTotalPages > 1) {
        comparePagination.style.display = 'flex';
        compareDiffCountNoPage.style.display = 'none';
        comparePageInfo.textContent = `Page ${compareCurrentPage} / ${compareTotalPages}`;
        comparePrevPage.disabled = compareCurrentPage <= 1;
        compareNextPage.disabled = compareCurrentPage >= compareTotalPages;
        compareGoToPage.max = compareTotalPages;
        compareGoToPage.value = compareCurrentPage;
    } else {
        comparePagination.style.display = 'none';
        // Show diff count without pagination row
        compareDiffCountNoPage.style.display = 'block';
        compareDiffCountNoPage.textContent = compareDiffCount.textContent;
    }
}

// Keep old function as alias for backward compatibility
export function compareSnaFiles(dataA, dataB) {
    compareSnapshotFiles(dataA, dataB);
}

export function compareBinaryFiles(dataA, dataB) {
    const showEqual = chkCompareShowEqual.checked;
    const showHexDump = chkCompareHexDump.checked;

    const result = compareBinaryData(dataA, dataB, 0, 0, null, showEqual, showHexDump);

    if (result.count === 0) {
        compareNoResults.style.display = 'block';
    } else {
        compareDataResults.style.display = 'block';
        compareDiffCount.textContent = `${result.count} bytes differ (sizes: ${dataA.byteLength} vs ${dataB.byteLength})`;
        compareDiffCountNoPage.style.display = 'block';
        compareDiffCountNoPage.textContent = compareDiffCount.textContent;
        compareDataTable.innerHTML = result.html;
    }
}

export function compareSnapshotVsEmulator(snapData) {
    const showEqual = chkCompareShowEqual.checked;
    const showHexDump = chkCompareHexDump.checked;
    const excludeScreen = chkCompareExcludeScreen.checked;

    // Detect and parse snapshot file
    const snapType = detectSnapshotType(snapData);
    if (snapType === 'binary') {
        compareDataResults.style.display = 'block';
        compareDataTitle.textContent = 'Error';
        compareDiffCount.textContent = '';
        compareDataTable.innerHTML = '<div style="color:var(--red)">Not a valid snapshot file (.SNA or .Z80)</div>';
        return;
    }

    const snap = parseSnapshotFile(snapData);
    if (!snap) {
        compareDataResults.style.display = 'block';
        compareDataTitle.textContent = 'Error';
        compareDiffCount.textContent = '';
        compareDataTable.innerHTML = '<div style="color:var(--red)">Failed to parse snapshot file</div>';
        return;
    }

    // Get current emulator state as normalized format
    const cpu = spectrum.cpu;
    const paging = spectrum.memory.getPagingState();
    const emuMemory = spectrum.memory.getFullSnapshot();

    const emuSnap = {
        registers: {
            'I': cpu.i,
            "HL'": (cpu.h_ << 8) | cpu.l_,
            "DE'": (cpu.d_ << 8) | cpu.e_,
            "BC'": (cpu.b_ << 8) | cpu.c_,
            "AF'": (cpu.a_ << 8) | cpu.f_,
            'HL': (cpu.h << 8) | cpu.l,
            'DE': (cpu.d << 8) | cpu.e,
            'BC': (cpu.b << 8) | cpu.c,
            'IY': cpu.iy,
            'IX': cpu.ix,
            'IFF1': cpu.iff1 ? 1 : 0,
            'IFF2': cpu.iff2 ? 1 : 0,
            'R': cpu.r,
            'AF': (cpu.a << 8) | cpu.f,
            'A': cpu.a,
            'F': cpu.f,
            'SP': cpu.sp,
            'IM': cpu.im,
            'PC': cpu.pc
        },
        memory: emuMemory,
        is128K: spectrum.machineType !== '48k',
        border: spectrum.ula.borderColor,
        port7FFD: (paging.ramBank & 0x07) |
                  (paging.screenBank === 7 ? 0x08 : 0x00) |
                  (paging.romBank ? 0x10 : 0x00) |
                  (paging.pagingDisabled ? 0x20 : 0x00)
    };

    // Compare registers
    const headerHtml = compareSnapshotRegisters(snap, emuSnap, showEqual, snapType, 'emulator');
    if (headerHtml) {
        compareHeaderResults.style.display = 'block';
        compareHeaderTable.innerHTML = headerHtml;
    }

    // Compare memory (0x4000-0xFFFF)
    const is128K = snap.is128K || emuSnap.is128K;
    const result = compareMemoryData(snap.memory, emuSnap.memory, 0x4000, 49152, showEqual, showHexDump, excludeScreen, is128K, 'Emulator');
    const diffCount = result.count;

    if (diffCount === 0 && !headerHtml) {
        compareNoResults.style.display = 'block';
        comparePagination.style.display = 'none';
    } else {
        compareDataResults.style.display = 'block';
        const blocksNote = result.totalBlocks ? `, ${result.totalBlocks} blocks` : '';
        compareDiffCount.textContent = `${diffCount} bytes differ${blocksNote}`;
        compareDataTable.innerHTML = result.html || '<div style="color:var(--green)">Memory is identical</div>';
        updateComparePagination();
    }
}

// Keep old function as alias
export function compareSnaVsEmulator(data) {
    compareSnapshotVsEmulator(data);
}

/**
 * Initialize Compare Tool with dependencies and set up DOM event listeners.
 * @param {object} deps - { spectrum, RZXLoader, SZXLoader }
 */
export function initCompareTool(deps) {
    spectrum = deps.spectrum;
    RZXLoader = deps.RZXLoader;
    SZXLoader = deps.SZXLoader;

    const compareFileA = document.getElementById('compareFileA');
    const compareFileB = document.getElementById('compareFileB');
    const compareFileBContainer = document.getElementById('compareFileBContainer');
    const btnCompare = document.getElementById('btnCompare');

    // Assign module-level DOM references
    chkCompareShowEqual = document.getElementById('chkCompareShowEqual');
    chkCompareHexDump = document.getElementById('chkCompareHexDump');
    chkCompareExcludeScreen = document.getElementById('chkCompareExcludeScreen');
    compareHeaderResults = document.getElementById('compareHeaderResults');
    compareHeaderTable = document.getElementById('compareHeaderTable');
    compareDataResults = document.getElementById('compareDataResults');
    compareDataTitle = document.getElementById('compareDataTitle');
    compareDiffCount = document.getElementById('compareDiffCount');
    compareDataTable = document.getElementById('compareDataTable');
    compareNoResults = document.getElementById('compareNoResults');
    comparePagination = document.getElementById('comparePagination');
    compareDiffCountNoPage = document.getElementById('compareDiffCountNoPage');
    comparePrevPage = document.getElementById('comparePrevPage');
    compareNextPage = document.getElementById('compareNextPage');
    comparePageInfo = document.getElementById('comparePageInfo');
    compareGoToPage = document.getElementById('compareGoToPage');
    compareGoPage = document.getElementById('compareGoPage');

    // Update mode UI
    document.querySelectorAll('input[name="compareMode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const mode = document.querySelector('input[name="compareMode"]:checked').value;
            if (mode === 'sna-emu') {
                compareFileBContainer.style.display = 'none';
            } else {
                compareFileBContainer.style.display = 'block';
            }
            // Exclude screen only makes sense for snapshot comparisons
            const excludeScreenLabel = chkCompareExcludeScreen.parentElement;
            if (mode === 'bin-bin') {
                excludeScreenLabel.style.opacity = '0.4';
                chkCompareExcludeScreen.disabled = true;
            } else {
                excludeScreenLabel.style.opacity = '1';
                chkCompareExcludeScreen.disabled = false;
            }
            clearCompareResults();
        });
    });

    compareFileA.addEventListener('change', async (e) => {
        if (e.target.files[0]) {
            compareDataA = await extractCompareData(e.target.files[0]);
        }
    });

    compareFileB.addEventListener('change', async (e) => {
        if (e.target.files[0]) {
            compareDataB = await extractCompareData(e.target.files[0]);
        }
    });

    btnCompare.addEventListener('click', () => {
        const mode = document.querySelector('input[name="compareMode"]:checked').value;
        clearCompareResults();

        if (mode === 'sna-emu') {
            if (!compareDataA) {
                alert('Please select a snapshot file (.SNA or .Z80)');
                return;
            }
            compareSnapshotVsEmulator(compareDataA);
        } else if (mode === 'sna-sna') {
            if (!compareDataA || !compareDataB) {
                alert('Please select two snapshot files (.SNA or .Z80)');
                return;
            }
            compareSnapshotFiles(compareDataA, compareDataB);
        } else {
            if (!compareDataA || !compareDataB) {
                alert('Please select two files');
                return;
            }
            compareBinaryFiles(compareDataA, compareDataB);
        }
    });

    // Pagination event handlers
    comparePrevPage.addEventListener('click', () => {
        if (compareCurrentPage > 1) {
            compareCurrentPage--;
            compareDataTable.innerHTML = renderComparePage(compareCurrentPage);
            updateComparePagination();
            compareDataTable.scrollTop = 0;
        }
    });

    compareNextPage.addEventListener('click', () => {
        if (compareCurrentPage < compareTotalPages) {
            compareCurrentPage++;
            compareDataTable.innerHTML = renderComparePage(compareCurrentPage);
            updateComparePagination();
            compareDataTable.scrollTop = 0;
        }
    });

    compareGoPage.addEventListener('click', () => {
        const page = parseInt(compareGoToPage.value) || 1;
        if (page >= 1 && page <= compareTotalPages && page !== compareCurrentPage) {
            compareCurrentPage = page;
            compareDataTable.innerHTML = renderComparePage(compareCurrentPage);
            updateComparePagination();
            compareDataTable.scrollTop = 0;
        }
    });

    compareGoToPage.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') compareGoPage.click();
    });
}
