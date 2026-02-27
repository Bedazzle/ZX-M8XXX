// Extracted from index.html inline script
// Core debugger rendering: registers, disassembly, memory, stack, breakpoints, labels
// Lines ~15933-17639

import { hex8, hex16, escapeHtml, downloadFile } from '../utils/format.js';

// ── DOM references ──────────────────────────────────────────────────
const debuggerPanel   = document.getElementById('debuggerPanel');
const mainRegisters   = document.getElementById('mainRegisters');
const altRegisters    = document.getElementById('altRegisters');
const ixiyRegisters   = document.getElementById('ixiyRegisters');
const indexRegisters  = document.getElementById('indexRegisters');
const flagsDisplay    = document.getElementById('flagsDisplay');
const statusRegisters = document.getElementById('statusRegisters');
const stackView       = document.getElementById('stackView');
const pagesGroup      = document.getElementById('pagesGroup');
const pagesInfo       = document.getElementById('pagesInfo');
const disassemblyView = document.getElementById('disassemblyView');
const triggerList     = document.getElementById('triggerList');
const labelsList      = document.getElementById('labelsList');
const labelFilterInput = document.getElementById('labelFilterInput');
const memoryView      = document.getElementById('memoryView');
const memoryAddressInput = document.getElementById('memoryAddress');
const btnMemoryGo     = document.getElementById('btnMemoryGo');
const btnMemoryPC     = document.getElementById('btnMemoryPC');
const btnMemorySP     = document.getElementById('btnMemorySP');
const btnMemoryHL     = document.getElementById('btnMemoryHL');
const btnMemoryPgUp   = document.getElementById('btnMemoryPgUp');
const btnMemoryPgDn   = document.getElementById('btnMemoryPgDn');
const chkShowTstates  = document.getElementById('chkShowTstates');
const labelDisplayMode = document.getElementById('labelDisplayMode');
const disasmAddressInput = document.getElementById('disasmAddress');
const leftMemAddressInput = document.getElementById('leftMemAddress');
const leftMemoryView  = document.getElementById('leftMemoryView');
const rightDisasmAddressInput = document.getElementById('rightDisasmAddress');
const rightDisassemblyView   = document.getElementById('rightDisassemblyView');
const leftPanelTypeSelect  = document.getElementById('leftPanelType');
const rightPanelTypeSelect = document.getElementById('rightPanelType');
const disasmBookmarksBar   = document.getElementById('disasmBookmarks');
const memoryBookmarksBar   = document.getElementById('memoryBookmarks');
const tabContainer         = document.getElementById('tabContainer');

// ── Mutable state ───────────────────────────────────────────────────
let isEditingRegister    = false;
let memorySnapshot       = null;
let leftPanelType        = 'disasm';     // 'disasm' or 'memdump'
let rightPanelType       = 'memdump';    // 'disasm', 'memdump', or 'calc'
let leftMemoryViewAddress  = 0;
let rightDisasmViewAddress = null;
let memoryViewAddress      = 0;
let memoryEditingAddr      = null;
let disasmViewAddress      = null;       // null = follow PC
let disasmLastLineAddr     = 0;
let traceViewAddress       = null;       // Address being viewed in trace history
let leftBookmarks  = [null, null, null, null, null];
let rightBookmarks = [null, null, null, null, null];
let activeEditInput = null;
let previousSP = null;
let previousStackValues = {};
let stackContextMenu = null;
let memSelectionStart = null;
let memSelectionEnd = null;
let memIsSelecting = false;
let memContextMenu = null;
let leftMemContextMenu = null;

// ── Constants ───────────────────────────────────────────────────────
const MEMORY_LINES      = 32;
const LEFT_MEMORY_LINES = 42;
const BYTES_PER_LINE    = 16;
const DISASM_LINES      = 48;
const DISASM_PC_POSITION = 4;  // Show PC at 5th line (0-indexed)

// ── External references (set via initDebuggerDisplay) ───────────────
// These are set by the main init module to wire up cross-module dependencies.
let spectrum, disasm, Disassembler;
let regionManager, labelManager, foldManager, subroutineManager, commentManager;
let traceManager, xrefManager, operandFormatManager, undoManager;
let REGION_TYPES;
let formatAddrColumn, replaceMnemonicAddresses, formatMnemonic;
let parseTextRegion, parseByteRegion, parseWordRegion;
let navPushHistory, leftNavHistory, rightNavHistory;
let showMessage;
let updateBookmarkButtons;
let showLabelDialog, showRegionDialog;
let updateWatchValues;
let switchLeftPanelType_fn, switchRightPanelType_fn;
let getExportBaseName;

// ── Public state accessors ──────────────────────────────────────────
// Expose mutable state so other modules can read/write it.
export function getDisasmViewAddress()    { return disasmViewAddress; }
export function setDisasmViewAddress(v)   { disasmViewAddress = v; }
export function getMemoryViewAddress()    { return memoryViewAddress; }
export function setMemoryViewAddress(v)   { memoryViewAddress = v; }
export function getLeftMemoryViewAddress(){ return leftMemoryViewAddress; }
export function setLeftMemoryViewAddress(v){ leftMemoryViewAddress = v; }
export function getRightDisasmViewAddress(){ return rightDisasmViewAddress; }
export function setRightDisasmViewAddress(v){ rightDisasmViewAddress = v; }
export function getDisasmLastLineAddr()   { return disasmLastLineAddr; }
export function getTraceViewAddress()     { return traceViewAddress; }
export function setTraceViewAddress(v)    { traceViewAddress = v; }
export function getLeftPanelType()        { return leftPanelType; }
export function getRightPanelType()       { return rightPanelType; }
export function getIsEditingRegister()    { return isEditingRegister; }
export function setIsEditingRegister(v)   { isEditingRegister = v; }
export function getMemorySnapshot()       { return memorySnapshot; }
export function setMemorySnapshot(v)      { memorySnapshot = v; }
export function getMemoryEditingAddr()    { return memoryEditingAddr; }
export function setMemoryEditingAddr(v)   { memoryEditingAddr = v; }
export function getLeftBookmarks()        { return leftBookmarks; }
export function setLeftBookmarks(v)       { leftBookmarks = v; }
export function getRightBookmarks()       { return rightBookmarks; }
export function setRightBookmarks(v)      { rightBookmarks = v; }
export function getMemSelectionStart()    { return memSelectionStart; }
export function getMemSelectionEnd()      { return memSelectionEnd; }
export function getDisasm()               { return disasm; }
export function setDisasm(v)              { disasm = v; }

// Expose constants
export { MEMORY_LINES, LEFT_MEMORY_LINES, BYTES_PER_LINE, DISASM_LINES, DISASM_PC_POSITION };

// Expose DOM elements that other modules need
export {
    debuggerPanel, disassemblyView, memoryView, leftMemoryView,
    rightDisassemblyView, stackView, triggerList, labelsList,
    labelFilterInput, memoryAddressInput, disasmAddressInput,
    leftMemAddressInput, rightDisasmAddressInput,
    leftPanelTypeSelect, rightPanelTypeSelect,
    disasmBookmarksBar, memoryBookmarksBar, tabContainer,
    chkShowTstates, labelDisplayMode
};

// ── Initialisation ──────────────────────────────────────────────────
export function initDebuggerDisplay(deps) {
    spectrum           = deps.spectrum;
    Disassembler       = deps.Disassembler;
    regionManager      = deps.regionManager;
    labelManager       = deps.labelManager;
    foldManager        = deps.foldManager;
    subroutineManager  = deps.subroutineManager;
    commentManager     = deps.commentManager;
    traceManager       = deps.traceManager;
    xrefManager        = deps.xrefManager;
    operandFormatManager = deps.operandFormatManager;
    undoManager        = deps.undoManager;
    REGION_TYPES       = deps.REGION_TYPES;
    formatAddrColumn   = deps.formatAddrColumn;
    replaceMnemonicAddresses = deps.replaceMnemonicAddresses;
    formatMnemonic     = deps.formatMnemonic;
    parseTextRegion    = deps.parseTextRegion;
    parseByteRegion    = deps.parseByteRegion;
    parseWordRegion    = deps.parseWordRegion;
    navPushHistory     = deps.navPushHistory;
    leftNavHistory     = deps.leftNavHistory;
    rightNavHistory    = deps.rightNavHistory;
    showMessage        = deps.showMessage;
    updateBookmarkButtons = deps.updateBookmarkButtons;
    showLabelDialog    = deps.showLabelDialog;
    showRegionDialog   = deps.showRegionDialog;
    updateWatchValues  = deps.updateWatchValues;
    getExportBaseName  = deps.getExportBaseName;

    // Set initial disasm if provided
    if (deps.disasm) disasm = deps.disasm;

    // Wire up event listeners
    _initEventListeners();

    // Check landscape mode on load
    checkLandscapeMode();
    window.addEventListener('resize', checkLandscapeMode);
}

// ── Layout helpers ──────────────────────────────────────────────────

export function isLandscapeMode() {
    return window.innerWidth >= 1400;
}

export function isDebuggerVisible() {
    return debuggerPanel.classList.contains('open') || isLandscapeMode();
}

export function checkLandscapeMode() {
    if (isLandscapeMode() && tabContainer.classList.contains('collapsed')) {
        tabContainer.classList.remove('collapsed');
    }
}

// ── Flow-break detection ────────────────────────────────────────────

function isFlowBreak(mnemonic) {
    const mn = mnemonic.replace(/<[^>]+>/g, '').toUpperCase();
    return mn.startsWith('JP') || mn.startsWith('JR') ||
           mn.startsWith('RET') || mn.startsWith('DJNZ') ||
           mn.startsWith('RST') || mn.startsWith('CALL') ||
           mn === 'HALT';
}

// ── Register rendering ──────────────────────────────────────────────

export function createRegisterItem(name, value, editable = null, bits = 16) {
    const editClass = editable ? ' editable' : '';
    const dataAttr = editable ? ` data-reg="${editable}" data-bits="${bits}"` : '';
    return `<div class="register-item"><span class="register-name">${name}</span><br><span class="register-value${editClass}"${dataAttr}>${value}</span></div>`;
}

// ── Disassembly with regions ────────────────────────────────────────

export function disassembleWithRegions(startAddr, numLines) {
    if (!disasm || !spectrum.memory) return [];

    const lines = [];
    let addr = startAddr & 0xffff;

    while (lines.length < numLines && addr <= 0xffff) {
        const region = regionManager.get(addr);
        const lineAddr = addr;

        if (!region || region.type === REGION_TYPES.CODE || region.type === REGION_TYPES.SMC) {
            const instr = disasm.disassemble(addr);
            lines.push({
                addr: addr,
                bytes: instr.bytes,
                mnemonic: instr.mnemonic,
                isData: false
            });
            addr = (addr + instr.bytes.length) & 0xffff;
        } else if (region.type === REGION_TYPES.TEXT) {
            const result = parseTextRegion(spectrum.memory, addr, region.end);
            if (result.singleByte) {
                lines.push({
                    addr: lineAddr,
                    bytes: result.bytes,
                    mnemonic: `DB $${hex8(result.bytes[0])}`,
                    isData: true
                });
            } else if (result.text.length > 0) {
                const suffix = result.bit7Terminated ? '+$80' : '';
                lines.push({
                    addr: lineAddr,
                    bytes: result.bytes,
                    mnemonic: `DB "${result.text}"${suffix}`,
                    isData: true
                });
            }
            addr = result.nextAddr & 0xffff;
        } else if (region.type === REGION_TYPES.DW) {
            const result = parseWordRegion(spectrum.memory, addr, region.end);
            if (result.wordStrs.length > 0) {
                lines.push({
                    addr: lineAddr,
                    bytes: result.bytes,
                    mnemonic: `DW ${result.wordStrs.join(', ')}`,
                    isData: true
                });
            }
            addr = result.nextAddr & 0xffff;
        } else if (region.type === REGION_TYPES.DB || region.type === REGION_TYPES.GRAPHICS) {
            const result = parseByteRegion(spectrum.memory, addr, region.end);
            if (result.byteStrs.length > 0) {
                lines.push({
                    addr: lineAddr,
                    bytes: result.bytes,
                    mnemonic: `DB ${result.byteStrs.join(', ')}`,
                    isData: true
                });
            }
            addr = result.nextAddr & 0xffff;
        } else {
            const instr = disasm.disassemble(addr);
            lines.push({
                addr: addr,
                bytes: instr.bytes,
                mnemonic: instr.mnemonic,
                isData: false
            });
            addr = (addr + instr.bytes.length) & 0xffff;
        }

        if (lines.length > 1000) break;
    }

    return lines;
}

// ── Main debugger update ────────────────────────────────────────────

export function updateDebugger() {
    if (!spectrum.cpu) return;
    if (isEditingRegister) return;
    const cpu = spectrum.cpu;

    // Check if viewing trace history
    const tracePos = traceManager.getCurrentPosition();
    const traceEntry = tracePos >= 0 ? traceManager.getEntry(tracePos) : null;

    // Use trace entry values if viewing history, otherwise use current CPU state
    const regAF = traceEntry ? traceEntry.af : cpu.af;
    const regBC = traceEntry ? traceEntry.bc : cpu.bc;
    const regDE = traceEntry ? traceEntry.de : cpu.de;
    const regHL = traceEntry ? traceEntry.hl : cpu.hl;
    const regIX = traceEntry ? traceEntry.ix : cpu.ix;
    const regIY = traceEntry ? traceEntry.iy : cpu.iy;
    const regSP = traceEntry ? traceEntry.sp : cpu.sp;
    const regPC = traceEntry ? traceEntry.pc : cpu.pc;
    const regI = traceEntry ? traceEntry.i : cpu.i;
    const regR = traceEntry ? traceEntry.r : cpu.rFull;
    const regIM = traceEntry ? traceEntry.im : cpu.im;
    const regIFF1 = traceEntry ? traceEntry.iff1 : cpu.iff1;
    const regIFF2 = traceEntry ? traceEntry.iff2 : cpu.iff2;
    const regTstates = traceEntry ? traceEntry.tStates : cpu.tStates;
    const regAF_ = traceEntry ? traceEntry.af_ : (cpu.a_ << 8) | cpu.f_;
    const regBC_ = traceEntry ? traceEntry.bc_ : (cpu.b_ << 8) | cpu.c_;
    const regDE_ = traceEntry ? traceEntry.de_ : (cpu.d_ << 8) | cpu.e_;
    const regHL_ = traceEntry ? traceEntry.hl_ : (cpu.h_ << 8) | cpu.l_;

    const canEdit = !traceEntry;
    mainRegisters.innerHTML =
        createRegisterItem('AF', hex16(regAF), canEdit ? 'af' : null) +
        createRegisterItem('BC', hex16(regBC), canEdit ? 'bc' : null) +
        createRegisterItem('DE', hex16(regDE), canEdit ? 'de' : null) +
        createRegisterItem('HL', hex16(regHL), canEdit ? 'hl' : null);

    altRegisters.innerHTML =
        createRegisterItem("AF'", hex16(regAF_), canEdit ? 'af_' : null) +
        createRegisterItem("BC'", hex16(regBC_), canEdit ? 'bc_' : null) +
        createRegisterItem("DE'", hex16(regDE_), canEdit ? 'de_' : null) +
        createRegisterItem("HL'", hex16(regHL_), canEdit ? 'hl_' : null);

    ixiyRegisters.innerHTML =
        createRegisterItem('IX', hex16(regIX), canEdit ? 'ix' : null) +
        createRegisterItem('IY', hex16(regIY), canEdit ? 'iy' : null) +
        `<button class="reg-swap-btn" id="btnEXA" title="EX AF,AF'">exa</button>` +
        `<button class="reg-swap-btn" id="btnEXX" title="EXX">exx</button>`;

    indexRegisters.innerHTML =
        createRegisterItem('SP', hex16(regSP), canEdit ? 'sp' : null) +
        createRegisterItem('PC', hex16(regPC), canEdit ? 'pc' : null) +
        createRegisterItem('T-st', regTstates.toString(), canEdit ? 'tstates' : null, 17);

    // Flags
    const f = regAF & 0xFF;
    const flags = [
        { name: 'S', bit: 0x80, desc: 'Sign' },
        { name: 'Z', bit: 0x40, desc: 'Zero' },
        { name: 'y', bit: 0x20, desc: 'Undocumented (bit 5)' },
        { name: 'H', bit: 0x10, desc: 'Half Carry' },
        { name: 'x', bit: 0x08, desc: 'Undocumented (bit 3)' },
        { name: 'P/V', bit: 0x04, desc: 'Parity/Overflow' },
        { name: 'N', bit: 0x02, desc: 'Subtract' },
        { name: 'C', bit: 0x01, desc: 'Carry' }
    ];
    flagsDisplay.innerHTML = flags.map(flag =>
        `<div class="flag-item ${(f & flag.bit) ? 'set' : ''}${canEdit ? ' editable' : ''}" title="${flag.desc} (click to toggle)" data-bit="${flag.bit}">${flag.name}</div>`
    ).join('');

    // Status registers
    statusRegisters.innerHTML =
        createRegisterItem('I', hex8(regI), canEdit ? 'i' : null, 8) +
        createRegisterItem('R', hex8(regR), canEdit ? 'r' : null, 8) +
        createRegisterItem('IM', regIM.toString(), canEdit ? 'im' : null, 2) +
        createRegisterItem('IFF', (regIFF1 ? '1' : '0') + '/' + (regIFF2 ? '1' : '0'), canEdit ? 'iff' : null, 2);

    // Paging info (128K/Pentagon only)
    if (spectrum.memory.machineType !== '48k') {
        pagesGroup.style.display = '';
        const paging = spectrum.memory.getPagingState();
        const screenNum = paging.screenBank === 5 ? '0' : '1';
        pagesInfo.innerHTML =
            createRegisterItem('C000', paging.ramBank.toString(), canEdit ? 'rambank' : null, 3) +
            createRegisterItem('Scr', screenNum, canEdit ? 'scrbank' : null, 1) +
            createRegisterItem('ROM', paging.romBank.toString(), canEdit ? 'rombank' : null, 1) +
            (paging.pagingDisabled ? createRegisterItem('Lock', '1', canEdit ? 'paginglock' : null, 1) : '');
    } else {
        pagesGroup.style.display = 'none';
    }

    // Disassembly view
    if (!disasm) {
        disasm = new Disassembler(spectrum.memory);
    }

    const pc = cpu.pc;

    // Auto-expand fold if PC is inside collapsed range
    const pcFold = foldManager.getCollapsedRangeContaining(pc);
    if (pcFold) foldManager.expand(pcFold.start);

    let viewAddr;
    const chkFollowPC = document.getElementById('chkFollowPC');

    if (chkFollowPC.checked) {
        viewAddr = disasm.findStartForPosition(pc, DISASM_PC_POSITION, DISASM_LINES);
        disasmViewAddress = null;
    } else if (disasmViewAddress !== null) {
        viewAddr = disasmViewAddress;
    } else {
        viewAddr = disasm.findStartForPosition(pc, DISASM_PC_POSITION, DISASM_LINES);
        disasmViewAddress = viewAddr;
    }

    // Disassemble with code folding
    function disassembleWithFolding(startAddr, targetLines) {
        const result = [];
        let currentAddr = startAddr & 0xffff;
        const maxIterations = targetLines * 10;
        let iterations = 0;

        while (result.length < targetLines && currentAddr <= 0xffff && iterations < maxIterations) {
            iterations++;

            const sub = subroutineManager.get(currentAddr);
            if (sub && sub.endAddress !== null && foldManager.isCollapsed(currentAddr)) {
                const byteCount = sub.endAddress - currentAddr + 1;
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
                    instrCount: null
                });
                currentAddr = (sub.endAddress + 1) & 0xffff;
                continue;
            }

            const userFold = foldManager.getUserFold(currentAddr);
            if (userFold && foldManager.isCollapsed(currentAddr)) {
                const byteCount = userFold.endAddress - currentAddr + 1;
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
                    instrCount: null
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

    const lines = disassembleWithFolding(viewAddr, DISASM_LINES);

    // Store last line address for page down
    if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        disasmLastLineAddr = lastLine.isFoldSummary ? lastLine.foldEnd : lastLine.addr;
    }

    const showTstates = chkShowTstates.checked;
    const labelMode = labelDisplayMode.value;

    disassemblyView.innerHTML = lines.map((line, idx) => {
        // Handle fold summary lines
        if (line.isFoldSummary) {
            const icon = '\u25B8';
            const typeClass = line.foldType === 'user' ? 'user-fold' : '';
            return `<div class="disasm-fold-summary ${typeClass}" data-fold-addr="${line.addr}">
                <span class="disasm-fold-toggle" data-fold-addr="${line.addr}">${icon}</span>
                <span class="fold-name">${escapeHtml(line.foldName)}</span>
                <span class="fold-stats">(${line.byteCount} bytes)</span>
            </div>`;
        }

        const bytesStr = line.bytes.map(b => hex8(b)).join(' ');
        const isCurrent = line.addr === pc;
        const isTrace = traceViewAddress !== null && line.addr === traceViewAddress;
        const hasBp = spectrum.hasBreakpoint(line.addr);
        const classes = ['disasm-line'];
        if (isCurrent) classes.push('current');
        if (isTrace) classes.push('trace');
        if (hasBp) classes.push('breakpoint');
        if (line.isData) classes.push('data-line');

        if (isFlowBreak(line.mnemonic)) {
            classes.push('flow-break');
        }

        const timing = (showTstates && !line.isData) ? disasm.getTiming(line.bytes) : '';
        const timingHtml = timing ? `<span class="disasm-tstates">${timing}</span>` : '';

        const addrInfo = formatAddrColumn(line.addr, labelMode);
        const mnemonicWithLabels = line.isData ? line.mnemonic : replaceMnemonicAddresses(line.mnemonic, labelMode, line.addr);

        const region = regionManager.get(line.addr);
        let regionMarker = '';
        if (region && region.type !== REGION_TYPES.CODE) {
            const markers = {
                [REGION_TYPES.DB]: 'B',
                [REGION_TYPES.DW]: 'W',
                [REGION_TYPES.TEXT]: 'T',
                [REGION_TYPES.GRAPHICS]: 'G',
                [REGION_TYPES.SMC]: 'S'
            };
            const marker = markers[region.type] || '?';
            regionMarker = `<span class="disasm-region region-type-${region.type}" title="${region.type.toUpperCase()}${region.comment ? ': ' + region.comment : ''}">${marker}</span>`;
        }

        const comment = commentManager.get(line.addr);
        let beforeHtml = '';
        let inlineHtml = '';
        let afterHtml = '';

        // Subroutine separator
        const sub = subroutineManager.get(line.addr);
        if (sub) {
            const subName = sub.name || labelManager.get(line.addr)?.name || `sub_${hex16(line.addr)}`;
            const canFold = sub.endAddress !== null;
            const foldIcon = canFold ? `<span class="disasm-fold-toggle" data-fold-addr="${line.addr}" title="Click to collapse">\u25BE</span>` : '';
            beforeHtml += `<span class="disasm-sub-separator">; \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`;
            beforeHtml += `<span class="disasm-sub-name">; ${foldIcon}${subName}</span>`;
            if (sub.comment) {
                beforeHtml += `<span class="disasm-sub-comment">; ${escapeHtml(sub.comment)}</span>`;
            }
            beforeHtml += `<span class="disasm-sub-separator">; \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</span>`;
        }

        // User fold start marker
        const userFold = foldManager.getUserFold(line.addr);
        if (userFold) {
            const foldName = userFold.name || `fold_${hex16(line.addr)}`;
            const foldIcon = `<span class="disasm-fold-toggle" data-fold-addr="${line.addr}" title="Click to collapse">\u25BE</span>`;
            beforeHtml += `<span class="disasm-user-fold-start">; \u250C\u2500\u2500\u2500 ${foldIcon}${escapeHtml(foldName)} \u2500\u2500\u2500</span>`;
        }

        if (comment) {
            if (comment.separator) {
                beforeHtml += `<span class="disasm-separator">; ----------</span>`;
            }
            if (comment.before) {
                const beforeLines = comment.before.split('\n').map(l => `; ${l}`).join('\n');
                beforeHtml += `<span class="disasm-comment-line">${escapeHtml(beforeLines)}</span>`;
            }
            if (comment.inline) {
                inlineHtml = `<span class="disasm-inline-comment">; ${escapeHtml(comment.inline)}</span>`;
            }
            if (comment.after) {
                const afterLines = comment.after.split('\n').map(l => `; ${l}`).join('\n');
                afterHtml = `<span class="disasm-comment-line">${escapeHtml(afterLines)}</span>`;
            }
        }

        // Subroutine end marker
        const endingSubs = subroutineManager.getAllEndingAt(line.addr);
        if (endingSubs.length > 0) {
            for (const endingSub of endingSubs) {
                const subName = endingSub.name || labelManager.get(endingSub.address)?.name || `sub_${hex16(endingSub.address)}`;
                afterHtml += `<span class="disasm-sub-end">; end of ${subName}</span>`;
            }
            afterHtml += `<span class="disasm-sub-separator">; \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550</span>`;
        }

        // User fold end marker
        for (const [foldAddr, foldData] of foldManager.userFolds) {
            if (foldData.endAddress === line.addr) {
                const foldName = foldData.name || `fold_${hex16(foldAddr)}`;
                afterHtml += `<span class="disasm-user-fold-end">; \u2514\u2500\u2500\u2500 end of ${escapeHtml(foldName)} \u2500\u2500\u2500</span>`;
            }
        }

        if (addrInfo.isLong) {
            classes.push('has-long-label');
            return `${beforeHtml}<div class="${classes.join(' ')}" data-addr="${line.addr}">
                <div class="disasm-label-row">${addrInfo.labelHtml}</div>
                <span class="disasm-bp ${hasBp ? 'active' : ''}" data-addr="${line.addr}" title="Toggle breakpoint">\u2022</span>
                ${regionMarker}
                <span class="disasm-addr">${addrInfo.html}</span>
                <span class="disasm-bytes">${bytesStr}</span>
                ${timingHtml}
                <span class="disasm-mnemonic">${formatMnemonic(mnemonicWithLabels)}</span>${inlineHtml}
            </div>${afterHtml}`;
        }

        return `${beforeHtml}<div class="${classes.join(' ')}" data-addr="${line.addr}">
            <span class="disasm-bp ${hasBp ? 'active' : ''}" data-addr="${line.addr}" title="Toggle breakpoint">\u2022</span>
            ${regionMarker}
            <span class="disasm-addr">${addrInfo.html}</span>
            <span class="disasm-bytes">${bytesStr}</span>
            ${timingHtml}
            <span class="disasm-mnemonic">${formatMnemonic(mnemonicWithLabels)}</span>${inlineHtml}
        </div>${afterHtml}`;
    }).join('');

    // Update breakpoint list
    updateBreakpointList();

    // Update watchpoint list
    updateWatchpointList();

    // Update port breakpoint list
    updatePortBreakpointList();

    // Update labels list
    updateLabelsList();

    // Update panels based on their types
    if (leftPanelType === 'memdump') {
        updateLeftMemoryView();
    }
    if (rightPanelType === 'memdump') {
        updateMemoryView();
    } else {
        updateRightDisassemblyView();
    }

    // Update stack view
    updateStackView();

    // Update trace status
    if (typeof window.updateTraceStatus === 'function') {
        window.updateTraceStatus();
        window.updateTraceList();
    }

    // Update watches
    if (typeof updateWatchValues === 'function') {
        updateWatchValues();
    }
}

// Alias for compatibility - some code calls updateDisassemblyView()
export const updateDisassemblyView = updateDebugger;

// ── Stack view ──────────────────────────────────────────────────────

export function updateStackView() {
    if (!spectrum.cpu) {
        stackView.innerHTML = '<div class="stack-entry">No CPU</div>';
        return;
    }

    const tracePos = traceManager.getCurrentPosition();
    const traceEntry = tracePos >= 0 ? traceManager.getEntry(tracePos) : null;
    const sp = traceEntry ? traceEntry.sp : spectrum.cpu.sp;
    const spChanged = previousSP !== null && previousSP !== sp;

    let html = '';
    for (let offset = -6; offset <= 6; offset += 2) {
        const addr = (sp + offset) & 0xffff;
        const lo = spectrum.memory.read(addr);
        const hi = spectrum.memory.read((addr + 1) & 0xffff);
        const value = lo | (hi << 8);

        const isCurrent = offset === 0;
        const valueKey = addr.toString();
        const valueChanged = previousStackValues[valueKey] !== undefined &&
                            previousStackValues[valueKey] !== value;

        let classes = 'stack-entry';
        if (isCurrent) classes += ' current';
        if (valueChanged && !spChanged) classes += ' changed';

        const pointer = isCurrent ? '<span class="stack-pointer">\u25C4</span>' : '';

        html += `<div class="${classes}" data-addr="${addr}" data-value="${value}">` +
                `<span class="stack-addr">${hex16(addr)}</span>` +
                `<span class="stack-value">${hex16(value)}</span>` +
                `${pointer}</div>`;

        previousStackValues[valueKey] = value;
    }

    stackView.innerHTML = html;
    previousSP = sp;
}

// ── Trigger / breakpoint / watchpoint / label lists ─────────────────

export function updateTriggerList() {
    const triggers = spectrum.getTriggers();
    if (triggers.length === 0) {
        triggerList.innerHTML = '<div class="no-breakpoints">No breakpoints</div>';
    } else {
        triggerList.innerHTML = triggers.map(t => {
            const icon = spectrum.getTriggerIcon(t.type);
            const label = spectrum.getTriggerLabel(t.type);
            const desc = spectrum.formatTrigger(t);
            const disabledClass = t.enabled ? '' : ' disabled';
            const iconClass = t.type.startsWith('port') ? 'port' : t.type;
            const skipInfo = t.skipCount > 0 ? ` <span class="trigger-skip" title="Hit ${t.hitCount}/${t.skipCount + 1}">[${t.hitCount}/${t.skipCount + 1}]</span>` : '';
            return `<div class="trigger-item${disabledClass}" data-index="${t.index}">
                <span class="trigger-icon ${iconClass}" title="${label}">${icon}</span>
                <span class="trigger-toggle" data-index="${t.index}" title="${t.enabled ? 'Disable' : 'Enable'}">\u23FB</span>
                <span class="trigger-desc" data-index="${t.index}">${desc}${skipInfo}</span>
                <span class="trigger-remove" data-index="${t.index}" title="Remove">\u00D7</span>
            </div>`;
        }).join('');
    }
}

export function updateBreakpointList() { updateTriggerList(); }
export function updateWatchpointList() { updateTriggerList(); }
export function updatePortBreakpointList() { updateTriggerList(); }

export function updateLabelsList() {
    const filter = labelFilterInput.value.toLowerCase().trim();

    const userLabels = labelManager.getAll().map(l => ({ ...l, isRom: false }));

    let romLabels = [];
    if (labelManager.showRomLabels) {
        for (const label of labelManager.romLabels.values()) {
            if (!labelManager.labels.has(labelManager._key(label.address, label.page))) {
                romLabels.push({ ...label, isRom: true });
            }
        }
    }

    const allLabels = [...userLabels, ...romLabels].sort((a, b) => a.address - b.address);

    const labels = filter
        ? allLabels.filter(l => l.name.toLowerCase().includes(filter) ||
                                (l.comment && l.comment.toLowerCase().includes(filter)))
        : allLabels;

    if (labels.length === 0) {
        labelsList.innerHTML = filter
            ? '<div class="no-breakpoints">No matching labels</div>'
            : '<div class="no-breakpoints">No labels</div>';
        return;
    }

    labelsList.innerHTML = labels.map(label => {
        const addrStr = label.page !== null ? `${label.page}:${hex16(label.address)}` : hex16(label.address);
        const commentHtml = label.comment ? `<span class="label-comment">${escapeHtml(label.comment)}</span>` : '';
        const itemClass = label.isRom ? 'label-item rom-label' : 'label-item';
        const actionsHtml = label.isRom ? '' : `
            <div class="label-actions">
                <button class="label-btn label-edit" data-addr="${label.address}" data-page="${label.page}" title="Edit">\u270E</button>
                <button class="label-btn label-remove" data-addr="${label.address}" data-page="${label.page}" title="Remove">\u00D7</button>
            </div>`;
        return `<div class="${itemClass}" data-addr="${label.address}" data-page="${label.page}">
            <div class="label-info">
                <span class="label-addr">${addrStr}</span>
                <span class="label-item-name">${escapeHtml(label.name)}</span>
                ${commentHtml}
            </div>
            ${actionsHtml}
        </div>`;
    }).join('');
}

// ── Memory view (right panel) ───────────────────────────────────────

export function updateMemoryView() {
    if (!spectrum.memory || memoryEditingAddr !== null) return;

    let html = '';
    for (let line = 0; line < MEMORY_LINES; line++) {
        const lineAddr = (memoryViewAddress + line * BYTES_PER_LINE) & 0xffff;

        html += `<div class="memory-line"><span class="memory-addr" data-addr="${lineAddr}">${hex16(lineAddr)}</span>`;

        html += '<span class="memory-hex">';
        for (let i = 0; i < BYTES_PER_LINE; i++) {
            const addr = (lineAddr + i) & 0xffff;
            const byte = spectrum.memory.read(addr);
            const changed = memorySnapshot && memorySnapshot[addr] !== byte;
            let cls = changed ? 'memory-byte changed' : 'memory-byte';
            if (spectrum.hasBreakpointAt(addr)) {
                cls += ' has-bp';
            }
            const wps = spectrum.getWatchpoints();
            for (const wp of wps) {
                if (addr >= wp.start && addr <= wp.end) {
                    if (wp.read && wp.write) cls += ' has-wp';
                    else if (wp.read) cls += ' has-wp-r';
                    else if (wp.write) cls += ' has-wp-w';
                    break;
                }
            }
            const region = regionManager.get(addr);
            if (region && region.type !== REGION_TYPES.CODE) {
                cls += ` region-${region.type}`;
            }
            const lowByte = byte & 0x7F;
            const isPrintableLow = lowByte >= 32 && lowByte < 127;
            let asciiChar = '';
            if (byte >= 32 && byte < 127) {
                asciiChar = ` '${String.fromCharCode(byte)}'`;
            } else if ((byte & 0x80) && isPrintableLow) {
                asciiChar = ` '${String.fromCharCode(lowByte)}'+$80`;
            }
            let tip = `Addr: ${hex16(addr)} (${addr})\nValue: ${hex8(byte)} (${byte})${asciiChar}`;
            if (region && region.type !== REGION_TYPES.CODE) {
                tip += `\nRegion: ${region.type}${region.comment ? ' - ' + region.comment : ''}`;
            }
            if (disasm) {
                const instr = disasm.disassemble(addr);
                const bytes = instr.bytes.map(b => hex8(b)).join(' ');
                tip += `\n${instr.mnemonic} [${bytes}]`;
            }
            html += `<span class="${cls}" data-addr="${addr}" title="${tip}">${hex8(byte)}</span>`;
        }
        html += '</span>';

        html += '<span class="memory-ascii">';
        for (let i = 0; i < BYTES_PER_LINE; i++) {
            const addr = (lineAddr + i) & 0xffff;
            const byte = spectrum.memory.read(addr);
            const isPrintable = byte >= 32 && byte < 127;
            const char = isPrintable ? String.fromCharCode(byte) : '.';
            const changed = memorySnapshot && memorySnapshot[addr] !== byte;
            const asciiRegion = regionManager.get(addr);
            let cls = isPrintable ? 'printable' : '';
            if (changed) cls += ' changed';
            if (asciiRegion && asciiRegion.type === REGION_TYPES.TEXT) {
                cls += ' region-text';
            }
            html += `<span class="${cls.trim()}">${char}</span>`;
        }
        html += '</span></div>';
    }

    memoryView.innerHTML = html;

    if (memSelectionStart !== null) {
        updateMemSelection();
    }
}

// ── Left memory view ────────────────────────────────────────────────

export function updateLeftMemoryView() {
    if (!spectrum.memory) {
        leftMemoryView.innerHTML = '<div class="memory-line">No memory</div>';
        return;
    }

    let html = '';
    for (let line = 0; line < LEFT_MEMORY_LINES; line++) {
        const lineAddr = (leftMemoryViewAddress + line * BYTES_PER_LINE) & 0xffff;

        html += `<div class="memory-line"><span class="memory-addr" data-addr="${lineAddr}">${hex16(lineAddr)}</span>`;

        html += '<span class="memory-hex">';
        for (let i = 0; i < BYTES_PER_LINE; i++) {
            const addr = (lineAddr + i) & 0xffff;
            const val = spectrum.memory.read(addr);
            let cls = 'memory-byte';
            const region = regionManager.get(addr);
            if (region && region.type !== REGION_TYPES.CODE) {
                cls += ` region-${region.type}`;
            }
            html += `<span class="${cls}" data-addr="${addr}">${hex8(val)}</span>`;
        }
        html += '</span>';

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

// ── Right disassembly view ──────────────────────────────────────────

export function updateRightDisassemblyView() {
    if (!spectrum.memory || !disasm) {
        rightDisassemblyView.innerHTML = '<div class="disasm-line">No code</div>';
        return;
    }

    let viewAddr = rightDisasmViewAddress !== null ? rightDisasmViewAddress : 0;

    const pc = spectrum.cpu ? spectrum.cpu.pc : 0;
    const showTstates = document.getElementById('chkRightShowTstates')?.checked || false;
    const labelMode = labelDisplayMode.value;

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
        if (line.isFoldSummary) {
            const icon = '\u25B8';
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

// ── Panel navigation ────────────────────────────────────────────────

export function goToLeftMemory(addr) {
    addr = addr & 0xffff;
    switchLeftPanelType('memdump');
    leftMemoryViewAddress = addr;
    leftMemAddressInput.value = hex16(addr);
    updateLeftMemoryView();
}

export function goToRightMemory(addr) {
    addr = addr & 0xffff;
    switchRightPanelType('memdump');
    memoryViewAddress = addr;
    memoryAddressInput.value = hex16(addr);
    updateMemoryView();
}

export function goToLeftDisasm(addr) {
    addr = addr & 0xffff;
    switchLeftPanelType('disasm');
    if (leftNavHistory.length === 0) {
        if (disasmViewAddress !== null) {
            navPushHistory(disasmViewAddress, 'left');
        } else if (spectrum && spectrum.cpu) {
            navPushHistory(spectrum.cpu.pc, 'left');
        }
    }
    navPushHistory(addr, 'left');
    if (disasm) {
        disasmViewAddress = disasm.findStartForPosition(addr, DISASM_PC_POSITION, DISASM_LINES);
    } else {
        disasmViewAddress = addr;
    }
    disasmAddressInput.value = hex16(addr);
    updateDebugger();
}

export function goToRightDisasm(addr) {
    addr = addr & 0xffff;
    switchRightPanelType('disasm');
    if (rightNavHistory.length === 0) {
        if (rightDisasmViewAddress !== null) {
            navPushHistory(rightDisasmViewAddress, 'right');
        } else if (spectrum && spectrum.cpu) {
            navPushHistory(spectrum.cpu.pc, 'right');
        }
    }
    navPushHistory(addr, 'right');
    rightDisasmViewAddress = addr;
    rightDisasmAddressInput.value = hex16(addr);
    updateRightDisassemblyView();
}

export function goToMemoryHere(addr, panelSide) {
    if (panelSide === 'left') goToLeftMemory(addr);
    else goToRightMemory(addr);
}

export function goToMemoryOther(addr, panelSide) {
    if (panelSide === 'left') goToRightMemory(addr);
    else goToLeftMemory(addr);
}

export function goToDisasmHere(addr, panelSide) {
    if (panelSide === 'left') goToLeftDisasm(addr);
    else goToRightDisasm(addr);
}

export function goToDisasmOther(addr, panelSide) {
    if (panelSide === 'left') goToRightDisasm(addr);
    else goToLeftDisasm(addr);
}

export function goToMemoryAddress(addr) {
    if (rightPanelType === 'memdump') {
        goToRightMemory(addr);
    } else if (leftPanelType === 'memdump') {
        goToLeftMemory(addr);
    } else {
        goToRightMemory(addr);
    }
}

export function goToAddressNoHistory(addr, panel = 'left') {
    addr = addr & 0xffff;
    if (panel === 'right') {
        rightDisasmViewAddress = addr;
        rightDisasmAddressInput.value = hex16(addr);
        updateRightDisassemblyView();
    } else {
        if (disasm) {
            disasmViewAddress = disasm.findStartForPosition(addr, DISASM_PC_POSITION, DISASM_LINES);
        } else {
            disasmViewAddress = addr;
        }
        disasmAddressInput.value = hex16(addr);
        updateDebugger();
    }
}

export function goToAddress(addr) {
    if (leftPanelType === 'disasm') {
        goToLeftDisasm(addr);
    } else if (rightPanelType === 'disasm') {
        goToRightDisasm(addr);
    } else {
        goToLeftDisasm(addr);
    }
}

// ── Byte editing ────────────────────────────────────────────────────

export function finishCurrentEdit(save = true) {
    if (activeEditInput && memoryEditingAddr !== null) {
        if (save) {
            const newValue = parseInt(activeEditInput.value, 16);
            if (!isNaN(newValue) && newValue >= 0 && newValue <= 255) {
                spectrum.memory.writeDebug(memoryEditingAddr, newValue);
            }
        }
        activeEditInput = null;
        memoryEditingAddr = null;
        updateDebugger();
    }
}

export function startByteEdit(byteElement) {
    finishCurrentEdit(true);

    const addr = parseInt(byteElement.dataset.addr);
    memoryEditingAddr = addr;
    const currentValue = spectrum.memory.read(addr);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'memory-edit-input';
    input.value = hex8(currentValue);
    input.maxLength = 2;
    activeEditInput = input;

    byteElement.textContent = '';
    byteElement.appendChild(input);

    setTimeout(() => {
        input.focus();
        input.select();
    }, 0);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishCurrentEdit(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            finishCurrentEdit(false);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const nextAddr = e.shiftKey ? (addr - 1) & 0xffff : (addr + 1) & 0xffff;
            finishCurrentEdit(true);
            setTimeout(() => {
                const nextByte = memoryView.querySelector(`[data-addr="${nextAddr}"]`);
                if (nextByte) startByteEdit(nextByte);
            }, 0);
        }
    });
}

// ── Memory selection ────────────────────────────────────────────────

export function clearMemSelection() {
    memSelectionStart = null;
    memSelectionEnd = null;
    memIsSelecting = false;
    memoryView.querySelectorAll('.memory-byte.selected').forEach(el => {
        el.classList.remove('selected');
    });
}

export function updateMemSelection() {
    if (memSelectionStart === null) return;

    const start = Math.min(memSelectionStart, memSelectionEnd ?? memSelectionStart);
    const end = Math.max(memSelectionStart, memSelectionEnd ?? memSelectionStart);

    memoryView.querySelectorAll('.memory-byte').forEach(el => {
        const addr = parseInt(el.dataset.addr, 10);
        if (addr >= start && addr <= end) {
            el.classList.add('selected');
        } else {
            el.classList.remove('selected');
        }
    });
}

// ── Panel type switching ────────────────────────────────────────────

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
        // Handled by existing updateDebugger
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

// ── Additional navigation helpers ───────────────────────────────────

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

// ── Close context menus ─────────────────────────────────────────────

function closeMemContextMenu() {
    if (memContextMenu) {
        memContextMenu.remove();
        memContextMenu = null;
    }
}

function closeLeftMemContextMenu() {
    if (leftMemContextMenu) {
        leftMemContextMenu.remove();
        leftMemContextMenu = null;
    }
}

// ── Event listeners (wired up in init) ──────────────────────────────

function _initEventListeners() {
    // Stack view context menu
    stackView.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const entry = e.target.closest('.stack-entry');
        if (!entry) return;

        const addr = parseInt(entry.dataset.addr, 10);
        const value = parseInt(entry.dataset.value, 10);

        if (stackContextMenu) {
            stackContextMenu.remove();
        }

        stackContextMenu = document.createElement('div');
        stackContextMenu.className = 'stack-context-menu';
        stackContextMenu.innerHTML = `
            <div data-action="disasm-addr">Disassembly \u2192 ${hex16(addr)}</div>
            <div data-action="disasm-value">Disassembly \u2192 ${hex16(value)}</div>
            <div data-action="memory-addr">Memory \u2192 ${hex16(addr)}</div>
            <div data-action="memory-value">Memory \u2192 ${hex16(value)}</div>
        `;
        stackContextMenu.style.left = e.clientX + 'px';
        stackContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(stackContextMenu);

        stackContextMenu.addEventListener('click', (ev) => {
            const action = ev.target.dataset.action;
            if (action === 'disasm-addr') {
                disasmViewAddress = addr;
                updateDebugger();
            } else if (action === 'disasm-value') {
                disasmViewAddress = value;
                updateDebugger();
            } else if (action === 'memory-addr') {
                goToMemoryAddress(addr);
            } else if (action === 'memory-value') {
                goToMemoryAddress(value);
            }
            stackContextMenu.remove();
            stackContextMenu = null;
        });
    });

    document.addEventListener('click', (e) => {
        if (stackContextMenu && !stackContextMenu.contains(e.target)) {
            stackContextMenu.remove();
            stackContextMenu = null;
        }
    });

    // Memory view mouse selection
    memoryView.addEventListener('mousedown', (e) => {
        const byteEl = e.target.closest('.memory-byte');
        if (byteEl && !e.target.classList.contains('memory-edit-input')) {
            if (e.button === 2) return;

            if (e.button === 0) {
                e.preventDefault();
                const addr = parseInt(byteEl.dataset.addr, 10);
                memSelectionStart = addr;
                memSelectionEnd = addr;
                memIsSelecting = true;
                updateMemSelection();
            }
        }
    });

    memoryView.addEventListener('mousemove', (e) => {
        if (!memIsSelecting) return;
        const byteEl = e.target.closest('.memory-byte');
        if (byteEl) {
            const addr = parseInt(byteEl.dataset.addr, 10);
            memSelectionEnd = addr;
            updateMemSelection();
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (memIsSelecting) {
            memIsSelecting = false;
            if (memSelectionStart === memSelectionEnd && e.button === 0) {
                const byteEl = memoryView.querySelector(`[data-addr="${memSelectionStart}"]`);
                if (byteEl && !e.target.classList.contains('memory-edit-input')) {
                    clearMemSelection();
                    startByteEdit(byteEl);
                }
            }
        }
    });

    // Memory view context menu (right panel)
    memoryView.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        closeMemContextMenu();

        const byteEl = e.target.closest('.memory-byte') || e.target.closest('.memory-addr');
        if (!byteEl || !byteEl.dataset.addr) return;

        const clickedAddr = parseInt(byteEl.dataset.addr, 10);

        let hasSelection = memSelectionStart !== null && memSelectionEnd !== null &&
                           memSelectionStart !== memSelectionEnd;
        let selStart, selEnd;

        if (hasSelection) {
            selStart = Math.min(memSelectionStart, memSelectionEnd);
            selEnd = Math.max(memSelectionStart, memSelectionEnd);
            if (clickedAddr < selStart || clickedAddr > selEnd) {
                hasSelection = false;
            }
        }

        const addr = hasSelection ? selStart : clickedAddr;
        const endAddr = hasSelection ? selEnd : null;
        const existingLabel = labelManager.get(addr);
        const existingRegion = regionManager.get(addr);

        memContextMenu = document.createElement('div');
        memContextMenu.className = 'label-context-menu';

        let menuHtml = `<div class="menu-header">Address ${hex16(addr)}</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="disasm-left">Disasm left</div>`;
        menuHtml += `<div data-action="disasm-right">Disasm right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="mem-left">Memory left</div>`;
        menuHtml += `<div data-action="mem-right">Memory right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        if (existingLabel) {
            menuHtml += `<div data-action="edit-label">Edit label "${existingLabel.name}"</div>`;
            menuHtml += `<div data-action="delete-label" class="danger">Delete label</div>`;
        } else {
            menuHtml += `<div data-action="add-label">Add label</div>`;
        }
        menuHtml += `<div class="menu-separator"></div>`;

        const rangeText = hasSelection ?
            `${hex16(selStart)}-${hex16(selEnd)} (${selEnd - selStart + 1} bytes)` :
            '';
        menuHtml += `<div class="menu-submenu">Mark as...${rangeText ? ' ' + rangeText : ''}
            <div class="menu-submenu-items">
                <div data-action="mark-code">Code</div>
                <div data-action="mark-db">DB (bytes)</div>
                <div data-action="mark-dw">DW (words)</div>
                <div data-action="mark-text">Text (ASCII)</div>
                <div data-action="mark-gfx">Graphics</div>
                <div data-action="mark-smc">SMC (self-mod)</div>
            </div>
        </div>`;
        if (existingRegion) {
            menuHtml += `<div data-action="remove-region" class="danger">Remove region mark</div>`;
        }
        memContextMenu.innerHTML = menuHtml;

        memContextMenu.style.left = e.clientX + 'px';
        memContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(memContextMenu);

        // Adjust submenu position if it would overflow viewport
        const submenu = memContextMenu.querySelector('.menu-submenu');
        if (submenu) {
            const menuRect = memContextMenu.getBoundingClientRect();
            const submenuItems = submenu.querySelector('.menu-submenu-items');
            if (submenuItems) {
                submenuItems.style.display = 'block';
                const subRect = submenuItems.getBoundingClientRect();
                submenuItems.style.display = '';

                if (menuRect.right + subRect.width > window.innerWidth) {
                    submenu.classList.add('submenu-left');
                }
                if (menuRect.top + subRect.height > window.innerHeight) {
                    submenu.classList.add('submenu-up');
                }
            }
        }

        memContextMenu.addEventListener('click', (menuE) => {
            const action = menuE.target.dataset.action;
            if (action === 'disasm-left') {
                goToLeftDisasm(addr);
            } else if (action === 'disasm-right') {
                goToRightDisasm(addr);
            } else if (action === 'mem-left') {
                goToLeftMemory(addr);
            } else if (action === 'mem-right') {
                goToRightMemory(addr);
            } else if (action === 'add-label') {
                showLabelDialog(addr);
            } else if (action === 'edit-label') {
                showLabelDialog(addr, existingLabel);
            } else if (action === 'delete-label') {
                const oldLabel = existingLabel;
                labelManager.remove(addr);
                undoManager.push({
                    type: 'label',
                    description: `Delete label "${oldLabel.name}"`,
                    undo: () => {
                        labelManager.add(oldLabel);
                        updateLabelsList();
                    },
                    redo: () => {
                        labelManager.remove(addr);
                        updateLabelsList();
                    }
                });
                showMessage(`Label "${existingLabel.name}" deleted`);
                updateDebugger();
            } else if (action === 'mark-code') {
                showRegionDialog(addr, REGION_TYPES.CODE, endAddr);
            } else if (action === 'mark-db') {
                showRegionDialog(addr, REGION_TYPES.DB, endAddr);
            } else if (action === 'mark-dw') {
                showRegionDialog(addr, REGION_TYPES.DW, endAddr);
            } else if (action === 'mark-text') {
                showRegionDialog(addr, REGION_TYPES.TEXT, endAddr);
            } else if (action === 'mark-gfx') {
                showRegionDialog(addr, REGION_TYPES.GRAPHICS, endAddr);
            } else if (action === 'mark-smc') {
                showRegionDialog(addr, REGION_TYPES.SMC, endAddr);
            } else if (action === 'remove-region') {
                const oldRegion = regionManager.get(addr);
                if (oldRegion) {
                    regionManager.remove(addr);
                    undoManager.push({
                        type: 'region',
                        description: `Remove region ${hex16(oldRegion.start)}-${hex16(oldRegion.end)}`,
                        undo: () => {
                            regionManager.add(oldRegion, true);
                        },
                        redo: () => {
                            regionManager.remove(addr);
                        }
                    });
                    showMessage('Region mark removed');
                    updateDebugger();
                }
            }
            clearMemSelection();
            closeMemContextMenu();
        });
    });

    // Left memory panel context menu
    leftMemoryView.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        closeLeftMemContextMenu();

        const byteEl = e.target.closest('.memory-byte') || e.target.closest('.memory-addr');
        if (!byteEl || !byteEl.dataset.addr) return;

        const addr = parseInt(byteEl.dataset.addr, 10);
        const existingLabel = labelManager.get(addr);
        const existingRegion = regionManager.get(addr);

        leftMemContextMenu = document.createElement('div');
        leftMemContextMenu.className = 'label-context-menu';

        let menuHtml = `<div class="menu-header">Address ${hex16(addr)}</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="disasm-left">Disasm left</div>`;
        menuHtml += `<div data-action="disasm-right">Disasm right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="mem-left">Memory left</div>`;
        menuHtml += `<div data-action="mem-right">Memory right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        if (existingLabel) {
            menuHtml += `<div data-action="edit-label">Edit label "${existingLabel.name}"</div>`;
            menuHtml += `<div data-action="delete-label" class="danger">Delete label</div>`;
        } else {
            menuHtml += `<div data-action="add-label">Add label</div>`;
        }
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div class="menu-submenu">Mark as...
            <div class="menu-submenu-items">
                <div data-action="mark-code">Code</div>
                <div data-action="mark-db">DB (bytes)</div>
                <div data-action="mark-dw">DW (words)</div>
                <div data-action="mark-text">Text (ASCII)</div>
                <div data-action="mark-gfx">Graphics</div>
                <div data-action="mark-smc">SMC (self-mod)</div>
            </div>
        </div>`;
        if (existingRegion) {
            menuHtml += `<div data-action="remove-region" class="danger">Remove region mark</div>`;
        }
        leftMemContextMenu.innerHTML = menuHtml;

        leftMemContextMenu.style.left = e.clientX + 'px';
        leftMemContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(leftMemContextMenu);

        leftMemContextMenu.addEventListener('click', (menuE) => {
            const action = menuE.target.dataset.action;
            if (action === 'disasm-left') {
                goToLeftDisasm(addr);
            } else if (action === 'disasm-right') {
                goToRightDisasm(addr);
            } else if (action === 'mem-left') {
                goToLeftMemory(addr);
            } else if (action === 'mem-right') {
                goToRightMemory(addr);
            } else if (action === 'add-label') {
                showLabelDialog(addr);
            } else if (action === 'edit-label') {
                showLabelDialog(addr, existingLabel);
            } else if (action === 'delete-label') {
                labelManager.remove(addr);
                showMessage(`Label "${existingLabel.name}" deleted`);
                updateDebugger();
            } else if (action === 'mark-code') {
                showRegionDialog(addr, REGION_TYPES.CODE);
            } else if (action === 'mark-db') {
                showRegionDialog(addr, REGION_TYPES.DB);
            } else if (action === 'mark-dw') {
                showRegionDialog(addr, REGION_TYPES.DW);
            } else if (action === 'mark-text') {
                showRegionDialog(addr, REGION_TYPES.TEXT);
            } else if (action === 'mark-gfx') {
                showRegionDialog(addr, REGION_TYPES.GRAPHICS);
            } else if (action === 'mark-smc') {
                showRegionDialog(addr, REGION_TYPES.SMC);
            } else if (action === 'remove-region') {
                regionManager.remove(addr);
                showMessage('Region mark removed');
                updateDebugger();
            }
            closeLeftMemContextMenu();
        });
    });

    // Close context menus on click elsewhere
    document.addEventListener('click', (e) => {
        if (leftMemContextMenu && !leftMemContextMenu.contains(e.target)) {
            closeLeftMemContextMenu();
        }
        if (memContextMenu && !memContextMenu.contains(e.target)) {
            closeMemContextMenu();
        }
        if (memSelectionStart !== null && !memoryView.contains(e.target) &&
            (!memContextMenu || !memContextMenu.contains(e.target))) {
            clearMemSelection();
        }
    });

    // Finish edit when clicking outside memory view
    document.addEventListener('mousedown', (e) => {
        if (memoryEditingAddr !== null && !memoryView.contains(e.target)) {
            finishCurrentEdit(true);
        }
    });

    // Memory address bar buttons
    btnMemoryGo.addEventListener('click', () => {
        const addr = parseInt(memoryAddressInput.value, 16);
        if (!isNaN(addr)) goToMemoryAddress(addr);
    });

    memoryAddressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const addr = parseInt(memoryAddressInput.value, 16);
            if (!isNaN(addr)) goToMemoryAddress(addr);
        }
    });

    btnMemoryPC.addEventListener('click', () => {
        if (spectrum.cpu) goToMemoryAddress(spectrum.cpu.pc);
    });

    btnMemorySP.addEventListener('click', () => {
        if (spectrum.cpu) goToMemoryAddress(spectrum.cpu.sp);
    });

    btnMemoryHL.addEventListener('click', () => {
        if (spectrum.cpu) goToMemoryAddress(spectrum.cpu.hl);
    });

    btnMemoryPgUp.addEventListener('click', () => {
        goToMemoryAddress(memoryViewAddress - MEMORY_LINES * BYTES_PER_LINE);
    });

    btnMemoryPgDn.addEventListener('click', () => {
        goToMemoryAddress(memoryViewAddress + MEMORY_LINES * BYTES_PER_LINE);
    });

    // Memory scroll wheel navigation
    memoryView.addEventListener('wheel', (e) => {
        e.preventDefault();
        const scrollLines = e.deltaY > 0 ? 3 : -3;
        goToMemoryAddress(memoryViewAddress + scrollLines * BYTES_PER_LINE);
    }, { passive: false });

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
        if (rightDisasmViewAddress !== null) {
            goToRightDisasmAddress(rightDisasmViewAddress - DISASM_LINES);
        }
    });
    document.getElementById('btnRightDisasmPgDn')?.addEventListener('click', () => {
        if (rightDisasmViewAddress !== null) {
            goToRightDisasmAddress(rightDisasmViewAddress + DISASM_LINES);
        }
    });

    // Left memory scroll wheel
    leftMemoryView.addEventListener('wheel', (e) => {
        e.preventDefault();
        const scrollLines = e.deltaY > 0 ? 3 : -3;
        goToLeftMemoryAddress(leftMemoryViewAddress + scrollLines * BYTES_PER_LINE);
    }, { passive: false });
}
