// ========== Panel Manager ==========
// Extracted from index.html inline script (lines 17296-18286)
// Manages left/right panel switching (disasm/memdump/calc), memory views,
// bookmarks, memory search, and POKE search.

// External dependencies (set via init function)
let spectrum = null;
let regionManager = null;
let labelManager = null;
let disasm = null;
let undoManager = null;
let showMessage = null;
let updateDebugger = null;
let updateDisassemblyView = null;
let goToAddress = null;
let goToMemoryAddress = null;
let hex8 = null;
let hex16 = null;
let formatMnemonic = null;
let formatAddrColumn = null;
let replaceMnemonicAddresses = null;
let showLabelDialog = null;
let showRegionDialog = null;
let navPushHistory = null;
let navBack = null;
let navForward = null;
let escapeHtml = null;
let isFlowBreak = null;
let disassembleWithRegions = null;
let subroutineManager = null;
let foldManager = null;
let xrefManager = null;
let showXRefTooltip = null;
let hideXRefTooltip = null;
let REGION_TYPES = null;
let operandFormatManager = null;
let labelDisplayMode = null;
let updateMemoryView = null;

// Panel type state
let leftPanelType = 'disasm';
let rightPanelType = 'memdump';

// DOM element references (set in initPanelManager)
let leftPanelTypeSelect = null;
let rightPanelTypeSelect = null;
let leftMemAddressInput = null;
let leftMemoryView = null;
let rightDisasmAddressInput = null;
let rightDisassemblyView = null;
let disasmBookmarksBar = null;
let memoryBookmarksBar = null;
let btnMemorySnap = null;
let btnMemoryClearSnap = null;
let chkRomEdit = null;
let btnPokeSnap = null;
let pokeSearchMode = null;
let pokeSearchValue = null;
let btnPokeSearch = null;
let btnPokeReset = null;
let pokeStatus = null;
let pokeResults = null;
let memSearchInput = null;
let memSearchType = null;
let btnMemSearch = null;
let btnMemSearchNext = null;
let searchResults = null;
let chkSearchCase = null;
let chkSearch7bit = null;
let leftMemSearchInput = null;
let leftMemSearchType = null;
let btnLeftMemSearch = null;
let btnLeftMemSearchNext = null;
let leftSearchResults = null;
let chkLeftSearchCase = null;
let chkLeftSearch7bit = null;

// Module-level state
let leftMemoryViewAddress = 0;
let rightDisasmViewAddress = null;
let memorySnapshot = null;
let pokeSnapshot = null;
let pokeCandidates = null;
let searchPattern = null;
let searchResultAddrs = [];
let searchResultIndex = -1;
let leftSearchPattern = null;
let leftSearchResultAddrs = [];
let leftSearchResultIndex = -1;
let leftBookmarks = [null, null, null, null, null];
let rightBookmarks = [null, null, null, null, null];
let xrefTooltipTimeout = null;
let searchOptionsDiv = null;
let leftSearchOptionsDiv = null;

// Constants
const LEFT_MEMORY_LINES = 42;
const BYTES_PER_LINE = 16;
const DISASM_LINES = 48;

export function switchLeftPanelType(type) {
    leftPanelType = type;
    leftPanelTypeSelect.value = type;

    const disasmControls = document.querySelector('.left-disasm-controls');
    const memdumpControls = document.querySelector('.left-memdump-controls');
    const disasmView = document.getElementById('disassemblyView');
    const leftStepControls = document.querySelector('.left-debugger-controls');
    const leftSearch = document.querySelector('.left-memory-search');

    if (type === 'disasm') {
        disasmControls.style.display = '';
        memdumpControls.style.display = 'none';
        disasmView.style.display = '';
        leftMemoryView.style.display = 'none';
        if (leftStepControls) leftStepControls.style.display = '';
        if (leftSearch) leftSearch.style.display = 'none';
    } else {
        disasmControls.style.display = 'none';
        memdumpControls.style.display = '';
        disasmView.style.display = 'none';
        leftMemoryView.style.display = '';
        if (leftStepControls) leftStepControls.style.display = 'none';
        if (leftSearch) leftSearch.style.display = '';
    }

    updateLeftPanel();
    updateBookmarkButtons(disasmBookmarksBar, leftBookmarks, 'left');
}

export function switchRightPanelType(type) {
    rightPanelType = type;
    rightPanelTypeSelect.value = type;

    const memdumpControls = document.querySelector('.right-memdump-controls');
    const disasmControls = document.querySelector('.right-disasm-controls');
    const memView = document.getElementById('memoryView');
    const rightSearch = document.querySelector('.right-memory-search');
    const rightStepControls = document.querySelector('.right-debugger-controls');
    const calcView = document.getElementById('rightCalculatorView');
    const bookmarksBar = document.getElementById('memoryBookmarks');

    // Hide all views first
    memView.style.display = 'none';
    rightDisassemblyView.style.display = 'none';
    calcView.style.display = 'none';
    memdumpControls.style.display = 'none';
    disasmControls.style.display = 'none';
    if (rightSearch) rightSearch.style.display = 'none';
    if (rightStepControls) rightStepControls.style.display = 'none';

    if (type === 'memdump') {
        memdumpControls.style.display = '';
        memView.style.display = '';
        if (rightSearch) rightSearch.style.display = '';
        if (bookmarksBar) bookmarksBar.style.display = '';
    } else if (type === 'disasm') {
        disasmControls.style.display = '';
        rightDisassemblyView.style.display = '';
        if (rightStepControls) rightStepControls.style.display = '';
        if (bookmarksBar) bookmarksBar.style.display = '';
        // Initialize to current PC if not set
        if (rightDisasmViewAddress === null && spectrum.cpu) {
            rightDisasmViewAddress = spectrum.cpu.pc;
            rightDisasmAddressInput.value = hex16(rightDisasmViewAddress);
        }
    } else if (type === 'calc') {
        calcView.style.display = '';
        if (bookmarksBar) bookmarksBar.style.display = 'none';
    }

    updateRightPanel();
    if (type !== 'calc') {
        updateBookmarkButtons(memoryBookmarksBar, rightBookmarks, 'right');
    }
}

export function updateLeftPanel() {
    if (leftPanelType === 'disasm') {
        // Handled by existing updateDisassemblyView
    } else {
        updateLeftMemoryView();
    }
}

export function updateRightPanel() {
    if (rightPanelType === 'memdump') {
        updateMemoryView();
    } else {
        updateRightDisassemblyView();
    }
}

export function updateLeftMemoryView() {
    if (!spectrum.memory) {
        leftMemoryView.innerHTML = '<div class="memory-line">No memory</div>';
        return;
    }

    let html = '';
    for (let line = 0; line < LEFT_MEMORY_LINES; line++) {
        const lineAddr = (leftMemoryViewAddress + line * BYTES_PER_LINE) & 0xffff;

        // Address
        html += `<div class="memory-line"><span class="memory-addr" data-addr="${lineAddr}">${hex16(lineAddr)}</span>`;

        // Hex bytes
        html += '<span class="memory-hex">';
        for (let i = 0; i < BYTES_PER_LINE; i++) {
            const addr = (lineAddr + i) & 0xffff;
            const val = spectrum.memory.read(addr);
            let cls = 'memory-byte';
            // Check for memory regions
            const region = regionManager.get(addr);
            if (region && region.type !== REGION_TYPES.CODE) {
                cls += ` region-${region.type}`;
            }
            html += `<span class="${cls}" data-addr="${addr}">${hex8(val)}</span>`;
        }
        html += '</span>';

        // ASCII representation (styled like right panel)
        html += '<span class="memory-ascii">';
        for (let i = 0; i < BYTES_PER_LINE; i++) {
            const addr = (lineAddr + i) & 0xffff;
            const byte = spectrum.memory.read(addr);
            const isPrintable = byte >= 32 && byte < 127;
            const char = isPrintable ? String.fromCharCode(byte) : '.';
            const asciiRegion = regionManager.get(addr);
            let cls = isPrintable ? 'printable' : '';
            if (asciiRegion && asciiRegion.type === REGION_TYPES.TEXT) {
                cls += ' region-text';
            }
            html += `<span class="${cls.trim()}">${char}</span>`;
        }
        html += '</span></div>';
    }

    leftMemoryView.innerHTML = html;
}

export function updateRightDisassemblyView() {
    if (!spectrum.memory || !disasm) {
        rightDisassemblyView.innerHTML = '<div class="disasm-line">No code</div>';
        return;
    }

    // Right panel doesn't auto-follow - use set address or 0
    let viewAddr = rightDisasmViewAddress !== null ? rightDisasmViewAddress : 0;

    const pc = spectrum.cpu ? spectrum.cpu.pc : 0;
    const showTstates = document.getElementById('chkRightShowTstates')?.checked || false;
    const labelMode = labelDisplayMode.value;

    // Apply code folding with dynamic line fetching (same as main panel)
    function disassembleWithFoldingRight(startAddr, targetLines) {
        const result = [];
        let currentAddr = startAddr & 0xffff;
        const maxIterations = targetLines * 10;
        let iterations = 0;

        while (result.length < targetLines && currentAddr <= 0xffff && iterations < maxIterations) {
            iterations++;

            const sub = subroutineManager.get(currentAddr);
            if (sub && sub.endAddress !== null && foldManager.isCollapsed(currentAddr)) {
                const foldLines = disassembleWithRegions(currentAddr, 500);
                let byteCount = 0;
                let instrCount = 0;
                for (const fl of foldLines) {
                    if (fl.addr > sub.endAddress) break;
                    byteCount += fl.bytes.length;
                    instrCount++;
                }
                const subName = sub.name || labelManager.get(currentAddr)?.name || `sub_${hex16(currentAddr)}`;
                result.push({
                    addr: currentAddr,
                    bytes: [],
                    mnemonic: '',
                    isData: false,
                    isFoldSummary: true,
                    foldType: 'subroutine',
                    foldName: subName,
                    foldEnd: sub.endAddress,
                    byteCount: byteCount,
                    instrCount: instrCount
                });
                currentAddr = (sub.endAddress + 1) & 0xffff;
                continue;
            }

            const userFold = foldManager.getUserFold(currentAddr);
            if (userFold && foldManager.isCollapsed(currentAddr)) {
                const foldLines = disassembleWithRegions(currentAddr, 500);
                let byteCount = 0;
                let instrCount = 0;
                for (const fl of foldLines) {
                    if (fl.addr > userFold.endAddress) break;
                    byteCount += fl.bytes.length;
                    instrCount++;
                }
                const foldName = userFold.name || `fold_${hex16(currentAddr)}`;
                result.push({
                    addr: currentAddr,
                    bytes: [],
                    mnemonic: '',
                    isData: false,
                    isFoldSummary: true,
                    foldType: 'user',
                    foldName: foldName,
                    foldEnd: userFold.endAddress,
                    byteCount: byteCount,
                    instrCount: instrCount
                });
                currentAddr = (userFold.endAddress + 1) & 0xffff;
                continue;
            }

            const lineArr = disassembleWithRegions(currentAddr, 1);
            if (lineArr.length === 0) break;
            const line = lineArr[0];
            result.push(line);
            currentAddr = (currentAddr + line.bytes.length) & 0xffff;
        }

        return result;
    }

    const lines = disassembleWithFoldingRight(viewAddr, DISASM_LINES);

    rightDisassemblyView.innerHTML = lines.map((line, idx) => {
        // Handle fold summary lines
        if (line.isFoldSummary) {
            const icon = '\u25b8';
            const typeClass = line.foldType === 'user' ? 'user-fold' : '';
            return `<div class="disasm-fold-summary ${typeClass}" data-fold-addr="${line.addr}">
                <span class="disasm-fold-toggle" data-fold-addr="${line.addr}">${icon}</span>
                <span class="fold-name">${escapeHtml(line.foldName)}</span>
                <span class="fold-stats">(${line.byteCount} bytes)</span>
            </div>`;
        }

        const bytesStr = line.bytes.map(b => hex8(b)).join(' ');
        const isCurrent = line.addr === pc;
        const hasBp = spectrum.hasBreakpoint(line.addr);
        const classes = ['disasm-line'];
        if (isCurrent) classes.push('current');
        if (hasBp) classes.push('breakpoint');
        if (line.isData) classes.push('data-line');
        if (isFlowBreak(line.mnemonic)) classes.push('flow-break');

        const timing = (showTstates && !line.isData) ? disasm.getTiming(line.bytes) : '';
        const timingHtml = timing ? `<span class="disasm-tstates">${timing}</span>` : '';
        const addrInfo = formatAddrColumn(line.addr, labelMode);
        const mnemonicWithLabels = line.isData ? line.mnemonic : replaceMnemonicAddresses(line.mnemonic, labelMode, line.addr);

        return `<div class="${classes.join(' ')}" data-addr="${line.addr}">
            <span class="disasm-bp ${hasBp ? 'active' : ''}" data-addr="${line.addr}">\u2022</span>
            <span class="disasm-addr">${addrInfo.html}</span>
            <span class="disasm-bytes">${bytesStr}</span>
            ${timingHtml}
            <span class="disasm-mnemonic">${formatMnemonic(mnemonicWithLabels)}</span>
        </div>`;
    }).join('');
}

export function goToLeftMemoryAddress(addr) {
    leftMemoryViewAddress = addr & 0xffff;
    leftMemAddressInput.value = hex16(leftMemoryViewAddress);
    updateLeftMemoryView();
}

export function goToRightDisasmAddress(addr) {
    rightDisasmViewAddress = addr & 0xffff;
    rightDisasmAddressInput.value = hex16(rightDisasmViewAddress);
    updateRightDisassemblyView();
}

export function updateBookmarkButtons(bar, bookmarks, panelSide) {
    const buttons = bar.querySelectorAll('.bookmark-btn');
    const currentType = panelSide === 'left' ? leftPanelType : rightPanelType;
    // Emoji indicators: for disasm (code inspection), for memory (raw data)
    const typeEmoji = { disasm: '\ud83d\udd0d', memdump: '\ud83d\udce6' };
    buttons.forEach((btn, i) => {
        const bm = bookmarks[i];
        if (bm !== null && typeof bm === 'object') {
            // New format: {addr, type}
            const emoji = typeEmoji[bm.type] || '';
            btn.textContent = `${emoji}${hex16(bm.addr)}`;
            btn.classList.add('set');
            btn.classList.toggle('type-mismatch', bm.type !== currentType);
            btn.title = `${bm.type}: ${hex16(bm.addr)} (Click: go, Right-click: set)`;
        } else if (bm !== null) {
            // Legacy format: just address (assume current panel type)
            btn.textContent = hex16(bm);
            btn.classList.add('set');
            btn.classList.remove('type-mismatch');
        } else {
            btn.textContent = '-';
            btn.classList.remove('set');
            btn.classList.remove('type-mismatch');
        }
    });
}

export function setupBookmarkHandlers(bar, bookmarks, panelSide) {
    const buttons = bar.querySelectorAll('.bookmark-btn');
    buttons.forEach((btn) => {
        const idx = parseInt(btn.dataset.index);

        // Left click: navigate to bookmark (switch panel type if needed)
        btn.addEventListener('click', () => {
            const bm = bookmarks[idx];
            if (bm !== null) {
                const addr = typeof bm === 'object' ? bm.addr : bm;
                const type = typeof bm === 'object' ? bm.type : (panelSide === 'left' ? 'disasm' : 'memdump');

                if (panelSide === 'left') {
                    if (type !== leftPanelType) {
                        switchLeftPanelType(type);
                    }
                    if (leftPanelType === 'disasm') {
                        goToAddress(addr);
                    } else {
                        goToLeftMemoryAddress(addr);
                    }
                } else {
                    if (type !== rightPanelType) {
                        switchRightPanelType(type);
                    }
                    if (rightPanelType === 'memdump') {
                        goToMemoryAddress(addr);
                    } else {
                        goToRightDisasmAddress(addr);
                    }
                }
            }
        });

        // Right click: set bookmark to current address and type
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            let addr, type;

            if (panelSide === 'left') {
                type = leftPanelType;
                if (type === 'disasm') {
                    addr = disasmViewAddress !== null ? disasmViewAddress : (spectrum.cpu ? spectrum.cpu.pc : null);
                } else {
                    addr = leftMemoryViewAddress;
                }
            } else {
                type = rightPanelType;
                if (type === 'memdump') {
                    addr = memoryViewAddress;
                } else {
                    addr = rightDisasmViewAddress !== null ? rightDisasmViewAddress : (spectrum.cpu ? spectrum.cpu.pc : null);
                }
            }

            if (addr !== null) {
                const oldBm = bookmarks[idx];
                bookmarks[idx] = { addr, type };
                updateBookmarkButtons(bar, bookmarks, panelSide);

                undoManager.push({
                    type: 'bookmark',
                    description: oldBm !== null
                        ? `Update ${panelSide} bookmark ${idx + 1}`
                        : `Set ${panelSide} bookmark ${idx + 1}`,
                    undo: () => {
                        bookmarks[idx] = oldBm;
                        updateBookmarkButtons(bar, bookmarks, panelSide);
                    },
                    redo: () => {
                        bookmarks[idx] = { addr, type };
                        updateBookmarkButtons(bar, bookmarks, panelSide);
                    }
                });
            }
        });
    });
}

export function parseSearchPattern(input, type) {
    if (type === 'hex') {
        // Parse hex bytes like "CD 21 00" with wildcards ?? or **
        const tokens = input.trim().split(/\s+/).filter(s => s.length > 0);
        if (tokens.length === 0) return null;

        const pattern = [];
        const mask = [];

        for (const token of tokens) {
            if (token === '?' || token === '??' || token === '*' || token === '**') {
                // Wildcard - match any byte
                pattern.push(0);
                mask.push(0x00);
            } else if (/^[0-9A-Fa-f]{2}$/.test(token)) {
                // Single hex byte
                pattern.push(parseInt(token, 16));
                mask.push(0xFF);
            } else if (/^[0-9A-Fa-f]+$/.test(token) && token.length % 2 === 0) {
                // Concatenated hex bytes like "CD21" - split them
                for (let i = 0; i < token.length; i += 2) {
                    pattern.push(parseInt(token.substr(i, 2), 16));
                    mask.push(0xFF);
                }
            } else {
                return null; // Invalid token
            }
        }
        return pattern.length > 0 ? { pattern, mask } : null;
    } else if (type === 'dec') {
        // Parse decimal bytes like "205 33 0" or "205,33,0"
        const parts = input.split(/[\s,]+/).filter(s => s.length > 0);
        if (parts.length === 0) return null;
        const pattern = [];
        const mask = [];
        for (const part of parts) {
            const val = parseInt(part, 10);
            if (isNaN(val) || val < 0 || val > 255) return null;
            pattern.push(val);
            mask.push(0xFF);
        }
        return pattern.length > 0 ? { pattern, mask } : null;
    } else {
        // Text search - convert to bytes
        if (input.length === 0) return null;
        const pattern = Array.from(input).map(c => c.charCodeAt(0) & 0xff);
        const mask = pattern.map(() => 0xFF);
        return { pattern, mask };
    }
}

export function searchMemory(searchData, startAddr = 0, options = {}) {
    if (!spectrum.memory || !searchData) return [];

    // Support both old format (array) and new format ({pattern, mask})
    const pattern = Array.isArray(searchData) ? searchData : searchData.pattern;
    const mask = Array.isArray(searchData) ? null : searchData.mask;

    if (!pattern || pattern.length === 0) return [];

    const { caseInsensitive = false, lastChar7bit = false } = options;
    const results = [];
    const maxResults = 100;
    const memSize = 0x10000;
    const patternLen = pattern.length;

    // Prepare pattern for matching
    const matchPattern = caseInsensitive
        ? pattern.map(b => (b >= 0x41 && b <= 0x5a) ? b | 0x20 : (b >= 0x61 && b <= 0x7a) ? b : b)
        : pattern;

    for (let addr = startAddr; addr < memSize && results.length < maxResults; addr++) {
        let match = true;
        for (let i = 0; i < patternLen && match; i++) {
            // Skip wildcards (mask = 0x00)
            if (mask && mask[i] === 0x00) continue;

            let memByte = spectrum.memory.read((addr + i) & 0xffff);
            let patByte = matchPattern[i];

            // Last character with 7-bit set: match both normal and +128 versions
            if (lastChar7bit && i === patternLen - 1) {
                const memByteLow = memByte & 0x7f;
                if (caseInsensitive) {
                    const memLower = (memByteLow >= 0x41 && memByteLow <= 0x5a) ? memByteLow | 0x20 : memByteLow;
                    const patLower = (patByte >= 0x41 && patByte <= 0x5a) ? patByte | 0x20 : patByte;
                    if (memLower !== patLower) match = false;
                } else {
                    if (memByteLow !== patByte) match = false;
                }
            } else if (caseInsensitive) {
                // Case-insensitive: convert both to lowercase for comparison
                const memLower = (memByte >= 0x41 && memByte <= 0x5a) ? memByte | 0x20 : memByte;
                const patLower = (patByte >= 0x41 && patByte <= 0x5a) ? patByte | 0x20 : patByte;
                if (memLower !== patLower) match = false;
            } else {
                if (memByte !== patByte) match = false;
            }
        }
        if (match) {
            results.push(addr);
        }
    }
    return results;
}

export function displaySearchResults(results, searchData) {
    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-info">No results found</div>';
        return;
    }

    const patternLen = searchData.pattern ? searchData.pattern.length : searchData.length;
    searchResults.innerHTML = results.slice(0, 20).map((addr, idx) => {
        // Show preview of bytes at this address
        let preview = '';
        for (let i = 0; i < Math.min(8, patternLen + 4); i++) {
            preview += hex8(spectrum.memory.read((addr + i) & 0xffff)) + ' ';
        }
        return `<div class="search-result" data-addr="${addr}" data-idx="${idx}">
            <span class="addr">${hex16(addr)}</span>
            <span class="preview">${preview.trim()}</span>
        </div>`;
    }).join('') + (results.length > 20 ? `<div class="search-info">...and ${results.length - 20} more</div>` : '');
}

export function doSearch() {
    const input = memSearchInput.value.trim();
    if (!input) {
        searchResults.innerHTML = '';
        return;
    }

    searchPattern = parseSearchPattern(input, memSearchType.value);
    if (!searchPattern) {
        searchResults.innerHTML = '<div class="search-info">Invalid pattern (hex: use ? for wildcard)</div>';
        return;
    }

    const searchOptions = {
        caseInsensitive: chkSearchCase.checked,
        lastChar7bit: chkSearch7bit.checked
    };

    searchResultAddrs = searchMemory(searchPattern, 0, searchOptions);
    searchResultIndex = searchResultAddrs.length > 0 ? 0 : -1;

    displaySearchResults(searchResultAddrs, searchPattern);

    if (searchResultAddrs.length > 0) {
        goToMemoryAddress(searchResultAddrs[0]);
        showMessage(`Found ${searchResultAddrs.length} result(s)`);
    } else {
        showMessage('No results found', 'error');
    }
}

export function doSearchNext() {
    if (searchResultAddrs.length === 0) {
        doSearch();
        return;
    }

    searchResultIndex = (searchResultIndex + 1) % searchResultAddrs.length;
    goToMemoryAddress(searchResultAddrs[searchResultIndex]);
    showMessage(`Result ${searchResultIndex + 1} of ${searchResultAddrs.length}`);
}

export function updateSearchOptions() {
    const mode = memSearchType.value;
    if (searchOptionsDiv) searchOptionsDiv.style.display = mode === 'text' ? 'flex' : 'none';

    // Update placeholder and tooltip based on mode
    if (mode === 'hex') {
        memSearchInput.placeholder = 'CD ? 00...';
        memSearchInput.title = 'Hex bytes, use ? for wildcard';
    } else if (mode === 'dec') {
        memSearchInput.placeholder = '205 33 0...';
        memSearchInput.title = 'Decimal bytes (0-255)';
    } else {
        memSearchInput.placeholder = 'text...';
        memSearchInput.title = 'Text string to search';
    }
}

export function displayLeftSearchResults(results, pattern) {
    if (results.length === 0) {
        leftSearchResults.innerHTML = '<div class="search-info">No results</div>';
        return;
    }
    const patternLen = pattern.length;
    leftSearchResults.innerHTML = results.slice(0, 20).map((addr, idx) => {
        let preview = '';
        for (let i = 0; i < Math.min(8, patternLen + 4); i++) {
            preview += hex8(spectrum.memory.read((addr + i) & 0xffff)) + ' ';
        }
        return `<div class="search-result" data-addr="${addr}" data-idx="${idx}">
            <span class="addr">${hex16(addr)}</span>
            <span class="preview">${preview.trim()}</span>
        </div>`;
    }).join('') + (results.length > 20 ? `<div class="search-info">...and ${results.length - 20} more</div>` : '');
}

export function doLeftSearch() {
    const input = leftMemSearchInput.value.trim();
    if (!input) {
        leftSearchResults.innerHTML = '';
        return;
    }

    leftSearchPattern = parseSearchPattern(input, leftMemSearchType.value);
    if (!leftSearchPattern) {
        leftSearchResults.innerHTML = '<div class="search-info">Invalid pattern (hex: use ? for wildcard)</div>';
        return;
    }

    const searchOptions = {
        caseInsensitive: chkLeftSearchCase.checked,
        lastChar7bit: chkLeftSearch7bit.checked
    };

    leftSearchResultAddrs = searchMemory(leftSearchPattern, 0, searchOptions);
    leftSearchResultIndex = leftSearchResultAddrs.length > 0 ? 0 : -1;

    displayLeftSearchResults(leftSearchResultAddrs, leftSearchPattern);

    if (leftSearchResultAddrs.length > 0) {
        goToLeftMemoryAddress(leftSearchResultAddrs[0]);
        showMessage(`Found ${leftSearchResultAddrs.length} result(s)`);
    } else {
        showMessage('No results found', 'error');
    }
}

export function doLeftSearchNext() {
    if (leftSearchResultAddrs.length === 0) {
        doLeftSearch();
        return;
    }

    leftSearchResultIndex = (leftSearchResultIndex + 1) % leftSearchResultAddrs.length;
    goToLeftMemoryAddress(leftSearchResultAddrs[leftSearchResultIndex]);
    showMessage(`Result ${leftSearchResultIndex + 1} of ${leftSearchResultAddrs.length}`);
}

export function updateLeftSearchOptions() {
    const mode = leftMemSearchType.value;
    if (leftSearchOptionsDiv) leftSearchOptionsDiv.style.display = mode === 'text' ? 'flex' : 'none';

    if (mode === 'hex') {
        leftMemSearchInput.placeholder = 'CD ? 00...';
        leftMemSearchInput.title = 'Hex bytes, use ? for wildcard';
    } else if (mode === 'dec') {
        leftMemSearchInput.placeholder = '205 33 0...';
        leftMemSearchInput.title = 'Decimal bytes (0-255)';
    } else {
        leftMemSearchInput.placeholder = 'text...';
        leftMemSearchInput.title = 'Text string to search';
    }
}

export function updatePokeStatus() {
    if (pokeCandidates === null) {
        pokeStatus.textContent = pokeSnapshot ? '(snap taken)' : '';
    } else {
        pokeStatus.textContent = `(${pokeCandidates.size} candidates)`;
    }
}

export function updatePokeResults() {
    if (pokeCandidates === null || pokeCandidates.size === 0) {
        pokeResults.innerHTML = '';
        return;
    }
    // Show first 100 candidates
    const addrs = [...pokeCandidates].slice(0, 100);
    pokeResults.innerHTML = addrs.map(addr => {
        const val = spectrum.memory.read(addr);
        return `<span class="poke-result" data-addr="${addr}"><span class="addr">${hex16(addr)}</span><span class="val">${hex8(val)}</span></span>`;
    }).join('');
    if (pokeCandidates.size > 100) {
        pokeResults.innerHTML += `<span class="poke-status">...and ${pokeCandidates.size - 100} more</span>`;
    }
}


/**
 * Initialize Panel Manager with dependencies and set up DOM event listeners.
 * @param {object} deps - External dependencies object
 */
export function initPanelManager(deps) {
    spectrum = deps.spectrum;
    regionManager = deps.regionManager;
    labelManager = deps.labelManager;
    disasm = deps.disasm;
    undoManager = deps.undoManager;
    showMessage = deps.showMessage;
    updateDebugger = deps.updateDebugger;
    updateDisassemblyView = deps.updateDisassemblyView;
    goToAddress = deps.goToAddress;
    goToMemoryAddress = deps.goToMemoryAddress;
    hex8 = deps.hex8;
    hex16 = deps.hex16;
    formatMnemonic = deps.formatMnemonic;
    formatAddrColumn = deps.formatAddrColumn;
    replaceMnemonicAddresses = deps.replaceMnemonicAddresses;
    showLabelDialog = deps.showLabelDialog;
    showRegionDialog = deps.showRegionDialog;
    navPushHistory = deps.navPushHistory;
    navBack = deps.navBack;
    navForward = deps.navForward;
    escapeHtml = deps.escapeHtml;
    isFlowBreak = deps.isFlowBreak;
    disassembleWithRegions = deps.disassembleWithRegions;
    subroutineManager = deps.subroutineManager;
    foldManager = deps.foldManager;
    xrefManager = deps.xrefManager;
    showXRefTooltip = deps.showXRefTooltip;
    hideXRefTooltip = deps.hideXRefTooltip;
    REGION_TYPES = deps.REGION_TYPES;
    operandFormatManager = deps.operandFormatManager;
    labelDisplayMode = deps.labelDisplayMode;
    updateMemoryView = deps.updateMemoryView;

    // Also accept shared state references if provided
    if (deps.disasmViewAddress !== undefined) {
        // These are closured state from the main debugger; access via getter if needed
    }

    // DOM element references
    leftPanelTypeSelect = document.getElementById('leftPanelType');
    rightPanelTypeSelect = document.getElementById('rightPanelType');
    leftMemAddressInput = document.getElementById('leftMemAddress');
    leftMemoryView = document.getElementById('leftMemoryView');
    rightDisasmAddressInput = document.getElementById('rightDisasmAddress');
    rightDisassemblyView = document.getElementById('rightDisassemblyView');
    disasmBookmarksBar = document.getElementById('disasmBookmarks');
    memoryBookmarksBar = document.getElementById('memoryBookmarks');
    btnMemorySnap = document.getElementById('btnMemorySnap');
    btnMemoryClearSnap = document.getElementById('btnMemoryClearSnap');
    chkRomEdit = document.getElementById('chkRomEdit');
    btnPokeSnap = document.getElementById('btnPokeSnap');
    pokeSearchMode = document.getElementById('pokeSearchMode');
    pokeSearchValue = document.getElementById('pokeSearchValue');
    btnPokeSearch = document.getElementById('btnPokeSearch');
    btnPokeReset = document.getElementById('btnPokeReset');
    pokeStatus = document.getElementById('pokeStatus');
    pokeResults = document.getElementById('pokeResults');
    memSearchInput = document.getElementById('memSearchInput');
    memSearchType = document.getElementById('memSearchType');
    btnMemSearch = document.getElementById('btnMemSearch');
    btnMemSearchNext = document.getElementById('btnMemSearchNext');
    searchResults = document.getElementById('searchResults');
    chkSearchCase = document.getElementById('chkSearchCase');
    chkSearch7bit = document.getElementById('chkSearch7bit');
    leftMemSearchInput = document.getElementById('leftMemSearchInput');
    leftMemSearchType = document.getElementById('leftMemSearchType');
    btnLeftMemSearch = document.getElementById('btnLeftMemSearch');
    btnLeftMemSearchNext = document.getElementById('btnLeftMemSearchNext');
    leftSearchResults = document.getElementById('leftSearchResults');
    chkLeftSearchCase = document.getElementById('chkLeftSearchCase');
    chkLeftSearch7bit = document.getElementById('chkLeftSearch7bit');
    searchOptionsDiv = document.querySelector('.right-memory-search .search-options');
    leftSearchOptionsDiv = document.querySelector('.left-memory-search .search-options');

    // Panel type select event handlers
    leftPanelTypeSelect.addEventListener('change', (e) => {
        switchLeftPanelType(e.target.value);
    });

    rightPanelTypeSelect.addEventListener('change', (e) => {
        switchRightPanelType(e.target.value);
    });

    // Left panel memory controls
    document.getElementById('btnLeftMemGo')?.addEventListener('click', () => {
        const addr = parseInt(leftMemAddressInput.value, 16);
        if (!isNaN(addr)) goToLeftMemoryAddress(addr);
    });
    leftMemAddressInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const addr = parseInt(leftMemAddressInput.value, 16);
            if (!isNaN(addr)) goToLeftMemoryAddress(addr);
        }
    });
    document.getElementById('btnLeftMemPC')?.addEventListener('click', () => {
        if (spectrum.cpu) goToLeftMemoryAddress(spectrum.cpu.pc);
    });
    document.getElementById('btnLeftMemSP')?.addEventListener('click', () => {
        if (spectrum.cpu) goToLeftMemoryAddress(spectrum.cpu.sp);
    });
    document.getElementById('btnLeftMemHL')?.addEventListener('click', () => {
        if (spectrum.cpu) goToLeftMemoryAddress(spectrum.cpu.hl);
    });
    document.getElementById('btnLeftMemPgUp')?.addEventListener('click', () => {
        goToLeftMemoryAddress(leftMemoryViewAddress - LEFT_MEMORY_LINES * BYTES_PER_LINE);
    });
    document.getElementById('btnLeftMemPgDn')?.addEventListener('click', () => {
        goToLeftMemoryAddress(leftMemoryViewAddress + LEFT_MEMORY_LINES * BYTES_PER_LINE);
    });

    // Right panel disasm controls
    document.getElementById('btnRightDisasmGo')?.addEventListener('click', () => {
        const addr = parseInt(rightDisasmAddressInput.value, 16);
        if (!isNaN(addr)) goToRightDisasmAddress(addr);
    });
    rightDisasmAddressInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const addr = parseInt(rightDisasmAddressInput.value, 16);
            if (!isNaN(addr)) goToRightDisasmAddress(addr);
        }
    });
    document.getElementById('btnRightDisasmPC')?.addEventListener('click', () => {
        if (spectrum.cpu) goToRightDisasmAddress(spectrum.cpu.pc);
    });
    document.getElementById('btnRightDisasmPgUp')?.addEventListener('click', () => {
        navBack('right');
    });
    document.getElementById('btnRightDisasmPgDn')?.addEventListener('click', () => {
        navForward('right');
    });

    // Scroll wheel for left memory view
    leftMemoryView.addEventListener('wheel', (e) => {
        if (leftPanelType !== 'memdump') return;
        e.preventDefault();
        const scrollLines = e.deltaY > 0 ? 3 : -3;
        goToLeftMemoryAddress(leftMemoryViewAddress + scrollLines * BYTES_PER_LINE);
    }, { passive: false });

    // Scroll wheel for right disasm view
    rightDisassemblyView.addEventListener('wheel', (e) => {
        if (rightPanelType !== 'disasm') return;
        e.preventDefault();
        const scrollLines = e.deltaY > 0 ? 3 : -3;
        if (rightDisasmViewAddress !== null) {
            goToRightDisasmAddress(rightDisasmViewAddress + scrollLines * 3);
        }
    }, { passive: false });

    // Click handler for right disasm view - navigate on operand address click
    rightDisassemblyView.addEventListener('click', (e) => {
        if (rightPanelType !== 'disasm') return;

        // Check if clicking on fold toggle or fold summary
        const foldToggle = e.target.closest('.disasm-fold-toggle, .disasm-fold-summary');
        if (foldToggle) {
            const addr = parseInt(foldToggle.dataset.foldAddr, 10);
            if (!isNaN(addr)) {
                foldManager.toggle(addr);
                updateDebugger();
            }
            return;
        }

        // Check if clicking on operand address (e.g., JP 4000h)
        // Click = go to disasm in right panel, Ctrl+Click = go to memory
        const operandAddr = e.target.closest('.disasm-operand-addr');
        if (operandAddr) {
            const addr = parseInt(operandAddr.dataset.addr, 10);
            if (e.ctrlKey) {
                goToMemoryAddress(addr);
                showMessage(`Memory: ${hex16(addr)}`);
            } else {
                goToRightDisasmAddress(addr);
                showMessage(`Disasm: ${hex16(addr)}`);
            }
            return;
        }
    });

    // XRef tooltip handlers for right disasm view
    rightDisassemblyView.addEventListener('mouseover', (e) => {
        if (rightPanelType !== 'disasm') return;
        const operandAddr = e.target.closest('.disasm-operand-addr');
        if (!operandAddr) return;

        const addr = parseInt(operandAddr.dataset.addr, 10);
        if (isNaN(addr)) return;

        const refs = xrefManager.get(addr);
        if (refs.length === 0) return;

        if (xrefTooltipTimeout) clearTimeout(xrefTooltipTimeout);
        xrefTooltipTimeout = setTimeout(() => {
            showXRefTooltip(addr, refs, e.clientX, e.clientY);
        }, 300);
    });

    rightDisassemblyView.addEventListener('mouseout', (e) => {
        if (rightPanelType !== 'disasm') return;
        const operandAddr = e.target.closest('.disasm-operand-addr');
        if (operandAddr) {
            hideXRefTooltip();
        }
    });

    // Setup left panel bookmarks
    setupBookmarkHandlers(disasmBookmarksBar, leftBookmarks, 'left');

    // Setup right panel bookmarks
    setupBookmarkHandlers(memoryBookmarksBar, rightBookmarks, 'right');

    // Memory snapshot for diff
    btnMemorySnap.addEventListener('click', () => {
        if (!spectrum.memory) return;
        memorySnapshot = new Uint8Array(0x10000);
        for (let addr = 0; addr < 0x10000; addr++) {
            memorySnapshot[addr] = spectrum.memory.read(addr);
        }
        btnMemorySnap.style.display = 'none';
        btnMemoryClearSnap.style.display = '';
        showMessage('Memory snapshot taken');
        updateMemoryView();
    });

    btnMemoryClearSnap.addEventListener('click', () => {
        memorySnapshot = null;
        btnMemorySnap.style.display = '';
        btnMemoryClearSnap.style.display = 'none';
        showMessage('Snapshot cleared');
        updateMemoryView();
    });

    // ROM edit checkbox
    chkRomEdit.addEventListener('change', () => {
        if (spectrum.memory) {
            spectrum.memory.allowRomEdit = chkRomEdit.checked;
        }
    });

    // Memory search handlers
    btnMemSearch.addEventListener('click', doSearch);
    btnMemSearchNext.addEventListener('click', doSearchNext);

    memSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                doSearchNext();
            } else {
                doSearch();
            }
        }
    });

    // Show/hide text search options and update placeholder based on search type
    memSearchType.addEventListener('change', updateSearchOptions);
    updateSearchOptions(); // Initial state

    searchResults.addEventListener('click', (e) => {
        const resultEl = e.target.closest('.search-result');
        if (resultEl) {
            const addr = parseInt(resultEl.dataset.addr);
            const idx = parseInt(resultEl.dataset.idx);
            searchResultIndex = idx;
            goToMemoryAddress(addr);
        }
    });

    // Left panel search handlers
    btnLeftMemSearch.addEventListener('click', doLeftSearch);
    btnLeftMemSearchNext.addEventListener('click', doLeftSearchNext);

    leftMemSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                doLeftSearchNext();
            } else {
                doLeftSearch();
            }
        }
    });

    // Left panel search options update
    leftMemSearchType.addEventListener('change', updateLeftSearchOptions);
    updateLeftSearchOptions();

    leftSearchResults.addEventListener('click', (e) => {
        const resultEl = e.target.closest('.search-result');
        if (resultEl) {
            const addr = parseInt(resultEl.dataset.addr);
            const idx = parseInt(resultEl.dataset.idx);
            leftSearchResultIndex = idx;
            goToLeftMemoryAddress(addr);
        }
    });

    // POKE search handlers
    pokeSearchMode.addEventListener('change', () => {
        pokeSearchValue.style.display = pokeSearchMode.value === 'equals' ? '' : 'none';
    });

    btnPokeSnap.addEventListener('click', () => {
        if (!spectrum.memory) return;
        pokeSnapshot = new Uint8Array(0x10000);
        for (let addr = 0; addr < 0x10000; addr++) {
            pokeSnapshot[addr] = spectrum.memory.read(addr);
        }
        showMessage('POKE snapshot taken');
        updatePokeStatus();
    });

    btnPokeSearch.addEventListener('click', () => {
        if (!spectrum.memory || !pokeSnapshot) {
            showMessage('Take a snapshot first', 'error');
            return;
        }

        const mode = pokeSearchMode.value;
        let targetValue = 0;
        if (mode === 'equals') {
            const valStr = pokeSearchValue.value.trim();
            if (!/^[0-9A-Fa-f]{1,2}$/.test(valStr)) {
                showMessage('Enter hex value (00-FF)', 'error');
                return;
            }
            targetValue = parseInt(valStr, 16);
        }

        // Start with all RAM addresses or existing candidates
        const searchSet = pokeCandidates !== null ? pokeCandidates : new Set();
        if (pokeCandidates === null) {
            // First search: all RAM (0x4000-0xFFFF)
            for (let addr = 0x4000; addr < 0x10000; addr++) {
                searchSet.add(addr);
            }
        }

        const newCandidates = new Set();
        for (const addr of searchSet) {
            const oldVal = pokeSnapshot[addr];
            const newVal = spectrum.memory.read(addr);
            let match = false;

            switch (mode) {
                case 'dec1': match = newVal === ((oldVal - 1) & 0xff); break;
                case 'inc1': match = newVal === ((oldVal + 1) & 0xff); break;
                case 'decreased': match = newVal < oldVal; break;
                case 'increased': match = newVal > oldVal; break;
                case 'changed': match = newVal !== oldVal; break;
                case 'unchanged': match = newVal === oldVal; break;
                case 'equals': match = newVal === targetValue; break;
            }

            if (match) {
                newCandidates.add(addr);
            }
        }

        pokeCandidates = newCandidates;

        // Update snapshot to current state for next comparison
        for (let addr = 0; addr < 0x10000; addr++) {
            pokeSnapshot[addr] = spectrum.memory.read(addr);
        }

        showMessage(`${pokeCandidates.size} candidate(s) found`);
        updatePokeStatus();
        updatePokeResults();
    });

    btnPokeReset.addEventListener('click', () => {
        pokeSnapshot = null;
        pokeCandidates = null;
        pokeResults.innerHTML = '';
        updatePokeStatus();
        showMessage('POKE search reset');
    });

    pokeResults.addEventListener('click', (e) => {
        const resultEl = e.target.closest('.poke-result');
        if (resultEl) {
            const addr = parseInt(resultEl.dataset.addr);
            goToMemoryAddress(addr);
        }
    });
}
