// compare-tool.js — Snapshot/binary comparison tool (extracted from index.html)
import { SLOT1_START, SLOT2_START, SLOT3_START, SCREEN_BITMAP, SCREEN_AFTER } from '../core/constants.js';
import { hex8, hex16 } from '../core/utils.js';
import { parseSnapshotFile as parseSnapshot } from './snapshot-parse.js';

export function initCompareTool({ RZXLoader, SZXLoader, getEmulatorState }) {
    // ========== Compare Tool ==========
    const compareFileA = document.getElementById('compareFileA');
    const compareFileB = document.getElementById('compareFileB');
    const compareFileBContainer = document.getElementById('compareFileBContainer');
    const btnCompare = document.getElementById('btnCompare');
    const chkCompareShowEqual = document.getElementById('chkCompareShowEqual');
    const chkCompareHexDump = document.getElementById('chkCompareHexDump');
    const chkCompareExcludeScreen = document.getElementById('chkCompareExcludeScreen');
    const compareHeaderResults = document.getElementById('compareHeaderResults');
    const compareHeaderTable = document.getElementById('compareHeaderTable');
    const compareDataResults = document.getElementById('compareDataResults');
    const compareDataTitle = document.getElementById('compareDataTitle');
    const compareDiffCount = document.getElementById('compareDiffCount');
    const compareDataTable = document.getElementById('compareDataTable');
    const compareNoResults = document.getElementById('compareNoResults');
    const comparePagination = document.getElementById('comparePagination');
    const compareDiffCountNoPage = document.getElementById('compareDiffCountNoPage');
    const comparePrevPage = document.getElementById('comparePrevPage');
    const compareNextPage = document.getElementById('compareNextPage');
    const comparePageInfo = document.getElementById('comparePageInfo');
    const compareGoToPage = document.getElementById('compareGoToPage');
    const compareGoPage = document.getElementById('compareGoPage');
    const compareMemBinOptions = document.getElementById('compareMemBinOptions');
    const compareMemBinStart = document.getElementById('compareMemBinStart');

    let compareDataA = null;
    let compareDataB = null;

    // Pagination state
    const DIFFS_PER_PAGE = 50;  // Number of diff blocks per page
    let compareDiffsData = null;  // Stored diffs for pagination
    let compareCurrentPage = 1;
    let compareTotalPages = 1;
    let compareRenderOptions = {};  // Store render options for re-rendering

    // Detect snapshot type from data
    function detectSnapshotType(data) {
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

    // Decompress Z80 block
    // One byte as a printable character for a hex dump's ASCII column,
    // HTML-escaped so the dump can be built as markup
    function escapeHtmlChar(byte) {
        if (byte < 32 || byte > 126) return '.';
        const ch = String.fromCharCode(byte);
        if (ch === '&') return '&amp;';
        if (ch === '<') return '&lt;';
        if (ch === '>') return '&gt;';
        if (ch === '"') return '&quot;';
        return ch;
    }

    // Parse any snapshot file (shared with the emulator's own loader)
    function parseSnapshotFile(data) {
        const type = detectSnapshotType(data);
        if (!type.startsWith('sna') && !type.startsWith('z80')) return null;
        return parseSnapshot(data);
    }

    // Update mode UI
    document.querySelectorAll('input[name="compareMode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const mode = document.querySelector('input[name="compareMode"]:checked').value;
            if (mode === 'sna-emu' || mode === 'mem-bin') {
                compareFileBContainer.style.display = 'none';
            } else {
                compareFileBContainer.style.display = 'block';
            }
            compareMemBinOptions.style.display = mode === 'mem-bin' ? 'flex' : 'none';
            // Exclude screen only makes sense for snapshot comparisons
            const excludeScreenLabel = chkCompareExcludeScreen.parentElement;
            if (mode === 'bin-bin' || mode === 'mem-bin') {
                excludeScreenLabel.style.opacity = '0.4';
                chkCompareExcludeScreen.disabled = true;
            } else {
                excludeScreenLabel.style.opacity = '1';
                chkCompareExcludeScreen.disabled = false;
            }
            clearCompareResults();
        });
    });

    function clearCompareResults() {
        compareHeaderResults.style.display = 'none';
        compareDataResults.style.display = 'none';
        compareNoResults.style.display = 'none';
        comparePagination.style.display = 'none';
        compareDiffCountNoPage.style.display = 'none';
        compareDiffsData = null;
        compareCurrentPage = 1;
        compareTotalPages = 1;
    }

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

    // Extract data for comparison - handles RZX and SZX by extracting embedded snapshots
    async function extractCompareData(file) {
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

    btnCompare.addEventListener('click', () => {
        const mode = document.querySelector('input[name="compareMode"]:checked').value;
        clearCompareResults();

        if (mode === 'mem-bin') {
            if (!compareDataA) {
                alert('Please select a binary file');
                return;
            }
            compareMemoryVsBinary(compareDataA);
        } else if (mode === 'sna-emu') {
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

    function readWord(data, offset) {
        return data[offset] | (data[offset + 1] << 8);
    }

    function compareBinaryData(dataA, dataB, offsetA = 0, offsetB = 0, length = null, showEqual = false, showHexDump = true) {
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
                        hexA += `<span style="${diffStyle}">${a !== null ? hex8(a) : '--'}</span> `;
                        hexB += `<span style="${diffStyle}">${b !== null ? hex8(b) : '--'}</span> `;
                        const ascCharA = a !== null ? escapeHtmlChar(a) : '.';
                        const ascCharB = b !== null ? escapeHtmlChar(b) : '.';
                        ascA += `<span style="${diffStyle}">${ascCharA}</span>`;
                        ascB += `<span style="${diffStyle}">${ascCharB}</span>`;
                    }
                    rows.push(`<div style="white-space:nowrap">${hex16(lineStart)}: ${hexA}|${ascA}|</div>`);
                    rows.push(`<div style="white-space:nowrap;color:var(--cyan)">${hex16(lineStart)}: ${hexB}|${ascB}|</div>`);
                }
                html += rows.join('') + '<hr style="border-color:var(--border);margin:5px 0">';
                i = endI;
            }
            return { count: diffCount, html };
        } else {
            // Simple list
            const lines = diffs.slice(0, 500).map(d => {
                const color = d.isDiff ? 'color:#ff6b6b' : '';
                return `<div style="${color}">${hex16(d.offset)}: ${d.a !== null ? hex8(d.a) : '--'} vs ${d.b !== null ? hex8(d.b) : '--'}${d.isDiff ? ' ◄' : ''}</div>`;
            });
            if (diffs.length > 500) lines.push(`<div>... and ${diffs.length - 500} more</div>`);
            return { count: diffs.filter(d => d.isDiff).length, html: lines.join('') };
        }
    }

    function compareSnapshotFiles(dataA, dataB) {
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

        // Compare memory (SLOT1_START-0xFFFF range that both formats have)
        const result = compareMemoryData(snapA.memory, snapB.memory, SLOT1_START, 49152, showEqual, showHexDump, excludeScreen, snapA.is128K);
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

    // Compare registers from normalized snapshot format
    function compareSnapshotRegisters(snapA, snapB, showEqual, typeA, typeB) {
        // Helper to format a register comparison cell
        function regCell(name, a, b, is16bit) {
            if (a === undefined || b === undefined) return '';
            const isDiff = a !== b;
            const valA = is16bit ? hex16(a) : hex8(a);
            const valB = is16bit ? hex16(b) : hex8(b);
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
            html += `<div style="white-space:nowrap;${pageColor}">7FFD ${hex8(snapA.port7FFD)} ${hex8(snapB.port7FFD)}${pageMarker}</div>`;
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

    // Check if address is in screen memory area
    function isScreenAddress(addr, is128K) {
        // Main screen: SCREEN_BITMAP-SCREEN_AFTER (bitmap + attributes)
        if (addr >= SCREEN_BITMAP && addr < SCREEN_AFTER) return true;
        // 128K shadow screen in bank 7: $C000-$DAFF when bank 7 is paged
        // For comparison we check the logical address range
        if (is128K && addr >= SLOT3_START && addr < 0xDB00) return true;
        return false;
    }

    // Compare memory arrays
    function compareMemoryData(memA, memB, startAddr, length, showEqual, showHexDump, excludeScreen = false, is128K = false, labelB = 'File B') {
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

    // Render a specific page of diffs
    function renderComparePage(page) {
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
                        hexA += `<span style="${diffStyle}">${hex8(a)}</span> `;
                        hexB += `<span style="${diffStyle}">${hex8(b)}</span> `;
                        // ASCII - always wrap in span, with red for differences
                        const ascCharA = escapeHtmlChar(a);
                        const ascCharB = escapeHtmlChar(b);
                        ascA += `<span style="${diffStyle}">${ascCharA}</span>`;
                        ascB += `<span style="${diffStyle}">${ascCharB}</span>`;
                    }
                    linesA += `<div style="white-space:nowrap">${hex16(lineStart)}: ${hexA}|${ascA}|</div>`;
                    linesB += `<div style="white-space:nowrap">${hex16(lineStart)}: ${hexB}|${ascB}|</div>`;
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
                return `<div style="${color}">${hex16(d.offset)}: ${hex8(d.a)} vs ${hex8(d.b)}${d.isDiff ? ' ◄' : ''}</div>`;
            });
            return lines.join('');
        }
    }

    // Update pagination UI
    function updateComparePagination() {
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

    function compareBinaryFiles(dataA, dataB) {
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

    function compareSnapshotVsEmulator(snapData) {
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
        const emuState = getEmulatorState();
        const cpu = emuState.cpu;
        const paging = emuState.memory.getPagingState();
        const emuMemory = emuState.memory.getFullSnapshot();

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
            is128K: emuState.machineType !== '48k',
            border: emuState.borderColor,
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

        // Compare memory (SLOT1_START-0xFFFF)
        const is128K = snap.is128K || emuSnap.is128K;
        const result = compareMemoryData(snap.memory, emuSnap.memory, SLOT1_START, 49152, showEqual, showHexDump, excludeScreen, is128K, 'Emulator');
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

    function compareMemoryVsBinary(binData) {
        const showEqual = chkCompareShowEqual.checked;
        const showHexDump = chkCompareHexDump.checked;

        const startAddr = parseInt(compareMemBinStart.value, 16);
        if (isNaN(startAddr) || startAddr < 0 || startAddr > 0xFFFF) {
            alert('Invalid start address');
            return;
        }

        if (binData.length === 0) {
            alert('File is empty');
            return;
        }

        const length = Math.min(binData.length, 0x10000 - startAddr);

        // Read current emulator memory into an array
        const emuState = getEmulatorState();
        const emuMemory = new Uint8Array(0x10000);
        for (let i = 0; i < length; i++) {
            emuMemory[startAddr + i] = emuState.memory.read(startAddr + i);
        }

        // Build file array aligned to same address space
        const fileMemory = new Uint8Array(0x10000);
        for (let i = 0; i < length; i++) {
            fileMemory[startAddr + i] = binData[i];
        }

        const result = compareMemoryData(fileMemory, emuMemory, startAddr, length, showEqual, showHexDump, false, false, 'Memory');

        if (length < binData.length) {
            compareHeaderResults.style.display = 'block';
            compareHeaderTable.innerHTML = `<div style="color:var(--yellow)">File truncated: ${binData.length} bytes from $${hex16(startAddr)} would exceed $FFFF, comparing first ${length} bytes</div>`;
        }

        if (result.count === 0) {
            compareNoResults.style.display = 'block';
            comparePagination.style.display = 'none';
        } else {
            compareDataResults.style.display = 'block';
            const blocksNote = result.totalBlocks ? `, ${result.totalBlocks} blocks` : '';
            compareDiffCount.textContent = `${result.count} bytes differ${blocksNote} (${length} bytes from $${hex16(startAddr)})`;
            compareDataTable.innerHTML = result.html;
            updateComparePagination();
        }
    }
}
