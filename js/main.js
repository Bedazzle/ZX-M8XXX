// ZX-M8XXX — main entry point
// Wires together all extracted modules and boots the emulator.
//
// Module layers (bottom-up):
//   core/       — Spectrum, Z80, ULA, AY, Memory, Disassembler, Loaders, FDC
//   sjasmplus/  — Assembler
//   data/       — z80-opcodes, region-types
//   utils/      — format, calculator, region-parser, text-scanner, snapshot-parser, media-constants
//   managers/   — Label, Region, Comment, OperandFormat, XRef, Subroutine, Fold, Undo, Trace
//   views/      — debugger-display, debugger-dialogs, panel-manager, compare-tool,
//                  explorer-tab, graphics-viewer, assembler-tab, frame-export, game-browser, rzx-recording
//   app/        — state, ui-framework, test-runner, rom-manager, emulator-control,
//                  input-handler, display-sound, media-io, project-io

const APP_VERSION = '0.9.27';

// ── Core ────────────────────────────────────────────────────────────
import { Spectrum } from './core/spectrum.js';
import { Disassembler } from './core/disasm.js';
import { RZXLoader, SZXLoader, ZipLoader } from './core/loaders.js';
import { DSKLoader } from './core/fdc.js';
import { getMachineProfile, getMachineTypes, MACHINE_PROFILES, DEFAULT_VISIBLE_MACHINES } from './core/machines.js';

// ── sjasmplus ───────────────────────────────────────────────────────
import { Assembler as SjASMPlus } from './sjasmplus/assembler.js';

// ── Data ────────────────────────────────────────────────────────────
import { REGION_TYPES, OPERAND_FORMATS } from './data/region-types.js';
import { renderOpcodes, applyOpcodeFilters } from './data/z80-opcodes.js';

// ── Utils ───────────────────────────────────────────────────────────
import {
    hex8, hex16, escapeHtml, escapeHtmlChar, downloadFile, downloadBinaryFile,
    arrayToBase64, arrayBufferToBase64, base64ToArrayBuffer, crc32
} from './utils/format.js';
import {
    calcUpdateDisplay, calcHandleKey, calcParseInput, calcRenderBits,
    calcUpdateDigitButtons, calcUpdateBaseSelectState, isCalcTabActive
} from './utils/calculator.js';
import {
    navPushHistory, navBack, navForward, updateNavButtons,
    setGoToAddressNoHistory,
    parseTextRegion, parseByteRegion, parseWordRegion
} from './utils/region-parser.js';
import { initTextScanner } from './utils/text-scanner.js';
import {
    AUTO_LOAD_ROM_WAIT, AUTO_LOAD_128K_WAIT,
    AUTO_LOAD_KEY_HOLD, AUTO_LOAD_KEY_GAP,
    TRD_SECTOR_SIZE, TRD_SECTOR9_OFFSET
} from './utils/media-constants.js';

// ── Managers ────────────────────────────────────────────────────────
import { LabelManager } from './managers/label-manager.js';
import { RegionManager } from './managers/region-manager.js';
import { CommentManager } from './managers/comment-manager.js';
import { OperandFormatManager } from './managers/operand-format-manager.js';
import { XRefManager } from './managers/xref-manager.js';
import { SubroutineManager } from './managers/subroutine-manager.js';
import { FoldManager } from './managers/fold-manager.js';
import { UndoManager } from './managers/undo-manager.js';
import { TraceManager } from './managers/trace-manager.js';

// ── Views ───────────────────────────────────────────────────────────
import {
    initDebuggerDisplay, updateDebugger, updateLabelsList,
    goToAddress, goToAddressNoHistory, goToMemoryAddress,
    goToLeftMemory, goToRightMemory, goToLeftDisasm, goToRightDisasm,
    goToLeftMemoryAddress, goToRightDisasmAddress,
    goToMemoryHere, goToMemoryOther, goToDisasmHere, goToDisasmOther,
    getDisasmViewAddress, setDisasmViewAddress,
    getTraceViewAddress, setTraceViewAddress,
    getIsEditingRegister, setIsEditingRegister,
    disassembleWithRegions
} from './views/debugger-display.js';
import {
    initDebuggerDialogs,
    showLabelDialog, showRegionDialog, showCommentDialog,
    showFoldDialog, closeLabelContextMenu
} from './views/debugger-dialogs.js';
import {
    initPanelManager,
    switchLeftPanelType, switchRightPanelType,
    updateLeftPanel, updateRightPanel,
    updateBookmarkButtons, setupBookmarkHandlers,
    doSearch, doSearchNext
} from './views/panel-manager.js';
import { initCompareTool } from './views/compare-tool.js';
import { initExplorerTab } from './views/explorer-tab.js';
import { initGraphicsViewer, updateGraphicsViewer } from './views/graphics-viewer.js';
import {
    initAssemblerTab, showTraceEntry, formatMnemonic
} from './views/assembler-tab.js';
import { initFrameExport } from './views/frame-export.js';
import { initGameBrowser } from './views/game-browser.js';
import { initRzxRecording } from './views/rzx-recording.js';

// ── App orchestration ───────────────────────────────────────────────
import { setState } from './app/state.js';
import { initUIFramework } from './app/ui-framework.js';
import { TestRunner } from './app/test-runner.js';
import {
    romData, getRomByType, setRomByType,
    tryLoadRomsFromDirectory, tryLoadRomLabels,
    populateMachineDropdown, buildMachineCheckboxes,
    setupDiskActivityCallback, updateRomStatus,
    loadRomFile, loadRomsForMachineType, applyRomsToEmulator,
    initializeEmulator, initRomModalHandlers,
    ROM_EXPECTED_SIZES, ROM_STATUS_IDS,
    getVisibleMachines, setVisibleMachines,
    setRomManagerDeps
} from './app/rom-manager.js';
import {
    showMessage, openDebuggerPanel,
    handleRegisterClick, initXRefTooltips
} from './app/emulator-control.js';
import { initInputHandler, updateMouseStatus, updateGamepadStatus } from './app/input-handler.js';
import {
    initAudioOnUserGesture, toggleSound, updateSoundButtons,
    toggleFullscreen, applyFullscreenScale, restoreCanvasSize,
    updateULAplusStatus, initULAplusPaletteGrid, loadPalettes, applyPalette,
    applyInvertDisplay, updateCanvasSize, setZoom, getCurrentZoom,
    getLoadedPalettes
} from './app/display-sound.js';
import {
    updateBetaDiskStatus, updateDriveSelector, getSelectedDriveIndex,
    updateMediaIndicator, handleDiskInserted, handleLoadResult,
    showZipSelection, quicksave, quickload,
    cancelAutoLoad, startAutoLoadTape, startAutoLoadDisk, startAutoLoadPlus3Disk,
    describeTapeBlock, getExportBaseName,
    processTrdWithBoot, loadBootTrdSettings, setBootTrdData,
    arrayBufferToBase64 as mediaArrayBufferToBase64,
    base64ToArrayBuffer as mediaBase64ToArrayBuffer
} from './app/media-io.js';
import { saveProject, loadProject } from './app/project-io.js';

// Navigation history arrays (shared between debugger-display and assembler-tab)
const leftNavHistory = [];
const rightNavHistory = [];

// Wire cross-module deps to break circular imports
setRomManagerDeps({ updateBetaDiskStatus });

// ═════════════════════════════════════════════════════════════════════
// 1. Create manager instances
// ═════════════════════════════════════════════════════════════════════

const regionManager       = new RegionManager();
const labelManager        = new LabelManager();
const commentManager      = new CommentManager();
const operandFormatManager = new OperandFormatManager();
const xrefManager         = new XRefManager();
const subroutineManager   = new SubroutineManager();
const foldManager         = new FoldManager();
const undoManager         = new UndoManager();
const traceManager        = new TraceManager();

// ═════════════════════════════════════════════════════════════════════
// 2. DOM element refs (toolbar + core)
// ═════════════════════════════════════════════════════════════════════

const canvas            = document.getElementById('screen');
const overlayCanvas     = document.getElementById('overlayCanvas');
const btnRun            = document.getElementById('btnRun');
const btnReset          = document.getElementById('btnReset');
const loadSelect        = document.getElementById('loadSelect');
const saveSelect        = document.getElementById('saveSelect');
const machineSelect     = document.getElementById('machineSelect');
const speedSelect       = document.getElementById('speedSelect');
const btnSound          = document.getElementById('btnSound');
const chkSound          = document.getElementById('chkSound');
const chkAY48k          = document.getElementById('chkAY48k');
const btnMute           = document.getElementById('btnMute');
const volumeSlider      = document.getElementById('volumeSlider');
const volumeValue       = document.getElementById('volumeValue');
const stereoMode        = document.getElementById('stereoMode');
const btnFullscreen     = document.getElementById('btnFullscreen');
const fullscreenMode    = document.getElementById('fullscreenMode');
const borderSizeSelect  = document.getElementById('borderSizeSelect');
const paletteSelect     = document.getElementById('paletteSelect');
const fileInput         = document.getElementById('fileInput');
const fpsEl             = document.getElementById('fps');
const dropZone          = document.getElementById('dropZone');
const projectFileInput  = document.getElementById('projectFileInput');

// RZX playback UI
const rzxInfo           = document.getElementById('rzxInfo');
const rzxStatus         = document.getElementById('rzxStatus');
const btnRzxStop        = document.getElementById('btnRzxStop');

// Debugger panel
const debuggerPanel     = document.getElementById('debuggerPanel');
const disassemblyView   = document.getElementById('disassemblyView');
const rightDisassemblyView = document.getElementById('rightDisassemblyView');

// Step buttons
const btnStepInto       = document.getElementById('btnStepInto');
const btnStepOver       = document.getElementById('btnStepOver');
const btnRunTo          = document.getElementById('btnRunTo');
const btnRunToInt       = document.getElementById('btnRunToInt');
const btnRunToRet       = document.getElementById('btnRunToRet');
const btnRunTstates     = document.getElementById('btnRunTstates');
const tstatesInput      = document.getElementById('tstatesInput');
const chkAutoComment    = document.getElementById('chkAutoComment');

// Right panel step buttons
const btnRightStepInto    = document.getElementById('btnRightStepInto');
const btnRightStepOver    = document.getElementById('btnRightStepOver');
const btnRightRunTo       = document.getElementById('btnRightRunTo');
const btnRightRunToInt    = document.getElementById('btnRightRunToInt');
const btnRightRunToRet    = document.getElementById('btnRightRunToRet');
const btnRightRunTstates  = document.getElementById('btnRightRunTstates');
const rightTstatesInput   = document.getElementById('rightTstatesInput');

// Trigger UI
const triggerList       = document.getElementById('triggerList');
const triggerType       = document.getElementById('triggerType');
const triggerAddrInput  = document.getElementById('triggerAddrInput');
const triggerCondInput  = document.getElementById('triggerCondInput');
const btnAddTrigger     = document.getElementById('btnAddTrigger');
const btnClearTriggers  = document.getElementById('btnClearTriggers');

// Labels panel
const labelsList        = document.getElementById('labelsList');
const labelFilterInput  = document.getElementById('labelFilterInput');
const btnAddLabel       = document.getElementById('btnAddLabel');
const btnExportLabels   = document.getElementById('btnExportLabels');
const btnImportLabels   = document.getElementById('btnImportLabels');
const btnClearLabels    = document.getElementById('btnClearLabels');
const labelFileInput    = document.getElementById('labelFileInput');
const chkShowRomLabels  = document.getElementById('chkShowRomLabels');

// Port I/O logging
const chkPortLog        = document.getElementById('chkPortLog');
const selPortLogFilter  = document.getElementById('selPortLogFilter');
const btnPortLogExport  = document.getElementById('btnPortLogExport');
const btnPortLogClear   = document.getElementById('btnPortLogClear');
const portLogStatus     = document.getElementById('portLogStatus');

// Port trace filter
const txtPortTraceFilter  = document.getElementById('txtPortTraceFilter');
const btnAddPortFilter    = document.getElementById('btnAddPortFilter');
const btnClearPortFilters = document.getElementById('btnClearPortFilters');
const portFilterStatus    = document.getElementById('portFilterStatus');
const portFilterList      = document.getElementById('portFilterList');

// Register editing panels
const mainRegisters     = document.getElementById('mainRegisters');
const altRegisters      = document.getElementById('altRegisters');
const ixiyRegisters     = document.getElementById('ixiyRegisters');
const indexRegisters    = document.getElementById('indexRegisters');
const flagsDisplay      = document.getElementById('flagsDisplay');
const statusRegisters   = document.getElementById('statusRegisters');
const pagesInfo         = document.getElementById('pagesInfo');

// Disk activity
const diskActivityEl    = document.getElementById('diskActivity');

// Media catalog
const tapeCatalogEl     = document.getElementById('tapeCatalog');
const diskCatalogEl     = document.getElementById('diskCatalog');
const mediaCatalogContainer = document.getElementById('mediaCatalogContainer');

// Watches
const watchesList       = document.getElementById('watchesList');
const watchAddrInput    = document.getElementById('watchAddrInput');
const watchNameInput    = document.getElementById('watchNameInput');
const btnWatchAdd       = document.getElementById('btnWatchAdd');
const btnWatchClear     = document.getElementById('btnWatchClear');

// Label display mode
const labelDisplayMode  = document.getElementById('labelDisplayMode');
const chkShowTstates    = document.getElementById('chkShowTstates');

// ═════════════════════════════════════════════════════════════════════
// 3. Create emulator
// ═════════════════════════════════════════════════════════════════════

const savedMachineType = localStorage.getItem('zx-machine-type') || '48k';
let spectrum = new Spectrum(canvas, {
    machineType: savedMachineType,
    tapeTrapsEnabled: true,
    overlayCanvas: overlayCanvas
});
window.spectrum = spectrum;

// Disassembler (created on first use or after machine type change)
let disasm = null;

// Run target address (set by clicking disassembly lines)
let runToTarget = null;
let runTargetAddress = null;  // Alias used by right panel

// ═════════════════════════════════════════════════════════════════════
// 4. Publish shared state
// ═════════════════════════════════════════════════════════════════════

setState({
    spectrum,
    disasm,
    labelManager,
    regionManager,
    commentManager,
    operandFormatManager,
    xrefManager,
    subroutineManager,
    foldManager,
    undoManager,
    traceManager,
    testRunner: null,  // set below after creation
    romData
});

// ═════════════════════════════════════════════════════════════════════
// 5. Formatting helpers (used as deps for debugger-display)
// ═════════════════════════════════════════════════════════════════════

const LABEL_MAX_CHARS = 12;

function formatAddrColumn(addr, mode) {
    const label = labelManager.get(addr);
    if (!label) return { html: hex16(addr), isLong: false, labelHtml: null };

    switch (mode) {
        case 'addr':
            return { html: hex16(addr), isLong: false, labelHtml: null };
        case 'label': {
            const isLong = label.name.length > LABEL_MAX_CHARS;
            return {
                html: isLong ? hex16(addr) : `<span class="label-name">${label.name}</span>`,
                isLong,
                labelHtml: isLong ? `<span class="label-name">${label.name}:</span>` : null
            };
        }
        case 'both': {
            const combined = `${hex16(addr)} ${label.name}`;
            const isLong = combined.length > LABEL_MAX_CHARS + 5;
            return {
                html: isLong ? hex16(addr) : `${hex16(addr)} <span class="label-name">${label.name}</span>`,
                isLong,
                labelHtml: isLong ? `<span class="label-name">${label.name}:</span>` : null
            };
        }
        default:
            return { html: hex16(addr), isLong: false, labelHtml: null };
    }
}

function applyOperandFormat(mnemonic, instrAddr) {
    const format = operandFormatManager.get(instrAddr);
    if (format === OPERAND_FORMATS.HEX) return mnemonic;

    let result = mnemonic.replace(/\b([0-9A-F]{4})h\b/gi, (match, hexVal) => {
        const val = parseInt(hexVal, 16);
        return operandFormatManager.formatValue(val, format, true);
    });
    result = result.replace(/\b([0-9A-F]{2})h\b/gi, (match, hexVal) => {
        const val = parseInt(hexVal, 16);
        return operandFormatManager.formatValue(val, format, false);
    });
    return result;
}

function replaceMnemonicAddresses(mnemonic, mode, instrAddr) {
    let processed = applyOperandFormat(mnemonic, instrAddr);

    processed = processed.replace(/\b([0-9A-F]{4})h\b/gi, (match, hexAddr) => {
        const addr = parseInt(hexAddr, 16);
        const label = labelManager.get(addr);
        if (mode === 'addr' || !label) {
            return `<span class="disasm-operand-addr" data-addr="${addr}">${match}</span>`;
        }
        return `<span class="disasm-label-operand disasm-operand-addr" data-addr="${addr}">${label.name}</span>`;
    });
    return processed;
}

// ═════════════════════════════════════════════════════════════════════
// 6. Wire navigation history
// ═════════════════════════════════════════════════════════════════════

setGoToAddressNoHistory(goToAddressNoHistory);

// ═════════════════════════════════════════════════════════════════════
// 7. Initialize UI framework (tabs, help modal)
// ═════════════════════════════════════════════════════════════════════

initUIFramework({
    getTestRunner: () => testRunner,
    updateGraphicsViewer,
    updateTraceList: () => window.updateTraceList?.()
});

// Initialize ULAplus palette grid (64 cells)
initULAplusPaletteGrid();

// ═════════════════════════════════════════════════════════════════════
// 8. Initialize opcode reference
// ═════════════════════════════════════════════════════════════════════

applyOpcodeFilters();

// ═════════════════════════════════════════════════════════════════════
// 9. Initialize view modules
// ═════════════════════════════════════════════════════════════════════

// Debugger display
initDebuggerDisplay({
    spectrum,
    Disassembler,
    regionManager,
    labelManager,
    foldManager,
    subroutineManager,
    commentManager,
    traceManager,
    xrefManager,
    operandFormatManager,
    undoManager,
    REGION_TYPES,
    formatAddrColumn,
    replaceMnemonicAddresses,
    formatMnemonic,
    parseTextRegion,
    parseByteRegion,
    parseWordRegion,
    navPushHistory,
    leftNavHistory,
    rightNavHistory,
    showMessage,
    updateBookmarkButtons,
    showLabelDialog,
    showRegionDialog,
    updateWatchValues: () => updateWatchValues(),
    getExportBaseName,
    disasm
});

// Debugger dialogs (label, region, fold, comment, context menu)
initDebuggerDialogs({
    spectrum,
    labelManager,
    regionManager,
    foldManager,
    commentManager,
    subroutineManager,
    xrefManager,
    operandFormatManager,
    undoManager,
    REGION_TYPES,
    OPERAND_FORMATS,
    showMessage,
    updateDebugger,
    updateLabelsList,
    goToLeftDisasm,
    goToRightDisasm,
    goToLeftMemory,
    goToRightMemory,
    disassemblyView,
    rightDisassemblyView
});

// Panel manager (dual-panel memory/disasm)
initPanelManager({
    spectrum,
    regionManager,
    labelManager,
    disasm,
    undoManager,
    showMessage,
    updateDebugger,
    updateDisassemblyView: updateDebugger,
    goToAddress,
    goToMemoryAddress,
    hex8,
    hex16,
    formatMnemonic,
    formatAddrColumn,
    replaceMnemonicAddresses,
    showLabelDialog,
    showRegionDialog,
    navPushHistory,
    navBack,
    navForward,
    escapeHtml,
    isFlowBreak: (mnemonic) => {
        const m = mnemonic.toUpperCase();
        return m.startsWith('RET') || m.startsWith('JP ') || m === 'JP' ||
               m.startsWith('JR ') || m === 'JR' || m === 'RETI' || m === 'RETN' ||
               m === 'HALT';
    },
    disassembleWithRegions,
    subroutineManager,
    foldManager,
    commentManager,
    operandFormatManager,
    REGION_TYPES
});

// Compare tool
initCompareTool({
    spectrum,
    RZXLoader,
    SZXLoader,
    showMessage
});

// Explorer tab
initExplorerTab({
    spectrum,
    SZXLoader,
    RZXLoader,
    DSKLoader,
    ZipLoader,
    Disassembler,
    hex8,
    hex16,
    showMessage,
    updateDriveSelector,
    updateMediaIndicator
});

// Graphics viewer
initGraphicsViewer({
    spectrum,
    regionManager,
    showMessage,
    goToAddress,
    goToMemoryAddress,
    updateDebugger,
    REGION_TYPES
});

// Assembler tab
initAssemblerTab({
    spectrum,
    showMessage,
    hex8,
    hex16,
    downloadFile,
    updateDebugger,
    goToAddress,
    labelManager,
    regionManager,
    subroutineManager,
    xrefManager,
    undoManager,
    REGION_TYPES,
    Disassembler,
    SjASMPlus,
    disasm,
    commentManager,
    parseTextRegion,
    parseWordRegion,
    parseByteRegion,
    APP_VERSION,
    traceManager,
    foldManager,
    operandFormatManager,
    navPushHistory,
    getDisasmViewAddress,
    setDisasmViewAddress,
    getLeftNavHistory: () => leftNavHistory,
    updateNavButtons
});

// Frame export
initFrameExport({
    spectrum,
    canvas,
    showMessage,
    getExportBaseName
});

// Game browser
initGameBrowser({
    escapeHtml
});

// RZX recording / PSG recording
initRzxRecording({
    spectrum,
    showMessage,
    getExportBaseName
});

// Text scanner
initTextScanner({
    spectrum,
    showMessage,
    goToAddress,
    goToMemoryAddress,
    updateDebugger
});

// XRef tooltips
initXRefTooltips(disassemblyView, xrefManager, labelManager);

// Calculator
calcUpdateDisplay();
calcUpdateBaseSelectState();

// ═════════════════════════════════════════════════════════════════════
// 10. Machine dropdown + ROM management
// ═════════════════════════════════════════════════════════════════════

populateMachineDropdown(machineSelect);
buildMachineCheckboxes(machineSelect);

// Set up boot TRD callback for injection during disk loading
spectrum.onBeforeTrdLoad = (data, filename) => processTrdWithBoot(data, filename);

// Set up disk activity LED
setupDiskActivityCallback(spectrum);

// Create test runner
const testRunner = new TestRunner(spectrum, {
    loadRomsForMachineType,
    updateULAplusStatus: () => updateULAplusStatus(spectrum),
    applyPalette: (id) => applyPalette(id, spectrum),
    updateCanvasSize: () => updateCanvasSize(spectrum),
    updateMediaIndicator: (name, type, driveIdx) => updateMediaIndicator(name, type, driveIdx, spectrum),
    resetDisasm: () => { disasm = null; }
});
setState({ testRunner });

// Initialize ROM modal event handlers
initRomModalHandlers({
    spectrum,
    showMessage,
    updateBetaDiskStatus,
    loadRomFile,
    initializeEmulator,
    updateRomStatus
});

// ═════════════════════════════════════════════════════════════════════
// 11. Input handler (gamepad, mouse, keyboard)
// ═════════════════════════════════════════════════════════════════════

initInputHandler(spectrum, showMessage);

// ═════════════════════════════════════════════════════════════════════
// 12. Watches
// ═════════════════════════════════════════════════════════════════════

const MAX_WATCHES = 10;
const WATCH_BYTES = 8;
let watches = [];

function loadWatches() {
    const saved = localStorage.getItem('zx_watches');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            watches = data.map(item => {
                if (typeof item === 'number') {
                    return { addr: item, name: '', page: null, prevBytes: new Uint8Array(WATCH_BYTES) };
                }
                return {
                    addr: item.addr,
                    name: item.name || '',
                    page: item.page !== undefined ? item.page : null,
                    prevBytes: new Uint8Array(WATCH_BYTES)
                };
            });
        } catch (e) { watches = []; }
    }
}

function saveWatches() {
    const data = watches.map(w => ({ addr: w.addr, name: w.name, page: w.page }));
    localStorage.setItem('zx_watches', JSON.stringify(data));
}

function readWatchByte(watch, offset) {
    const addr = (watch.addr + offset) & 0xFFFF;
    if (watch.page !== null && addr >= 0xC000 && spectrum.memory.machineType !== '48k') {
        const bank = spectrum.memory.getRamBank(watch.page);
        if (bank) return bank[addr - 0xC000] & 0xFF;
    }
    return spectrum.memory.read(addr) & 0xFF;
}

function getWatchDisplayName(watch) {
    const label = labelManager.get(watch.addr);
    if (label) return { text: label.name, isLabel: true };
    return { text: watch.name || '', isLabel: false };
}

function sortWatches() {
    watches.sort((a, b) => a.addr - b.addr);
}

function renderWatches() {
    watchesList.innerHTML = '';
    if (watches.length === 0) {
        watchesList.innerHTML = '<div class="no-breakpoints">No watches</div>';
        return;
    }
    sortWatches();
    watches.forEach((watch, index) => {
        const entry = document.createElement('div');
        entry.className = 'watch-entry';

        const addrSpan = document.createElement('span');
        addrSpan.className = 'watch-addr';
        const pagePrefix = watch.page !== null ? `${watch.page}:` : '';
        addrSpan.textContent = pagePrefix + watch.addr.toString(16).toUpperCase().padStart(4, '0');

        const nameSpan = document.createElement('span');
        nameSpan.dataset.index = index;
        const displayName = getWatchDisplayName(watch);
        nameSpan.className = 'watch-name' + (displayName.isLabel ? ' label' : '');
        nameSpan.textContent = displayName.text;
        nameSpan.title = displayName.isLabel ? 'Label: ' + displayName.text : (watch.name || 'No name');

        const bytesSpan = document.createElement('span');
        bytesSpan.className = 'watch-bytes';
        bytesSpan.dataset.index = index;
        bytesSpan.textContent = '-- -- -- -- -- -- -- --';

        const asciiSpan = document.createElement('span');
        asciiSpan.className = 'watch-ascii';
        asciiSpan.dataset.index = index;
        asciiSpan.textContent = '........';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'watch-remove';
        removeBtn.textContent = '\u00d7';
        removeBtn.title = 'Remove watch';
        removeBtn.addEventListener('click', () => {
            watches.splice(index, 1);
            saveWatches();
            renderWatches();
        });

        entry.appendChild(removeBtn);
        entry.appendChild(addrSpan);
        entry.appendChild(nameSpan);
        entry.appendChild(bytesSpan);
        entry.appendChild(asciiSpan);
        watchesList.appendChild(entry);
    });
    updateWatchValues();
}

function updateWatchValues() {
    if (!spectrum || !spectrum.memory) return;
    watches.forEach((watch, index) => {
        const bytesSpan = watchesList.querySelector(`.watch-bytes[data-index="${index}"]`);
        const asciiSpan = watchesList.querySelector(`.watch-ascii[data-index="${index}"]`);
        const nameSpan  = watchesList.querySelector(`.watch-name[data-index="${index}"]`);
        if (!bytesSpan || !asciiSpan) return;

        if (nameSpan) {
            const displayName = getWatchDisplayName(watch);
            nameSpan.className = 'watch-name' + (displayName.isLabel ? ' label' : '');
            nameSpan.textContent = displayName.text;
            nameSpan.title = displayName.isLabel ? 'Label: ' + displayName.text : (watch.name || 'No name');
        }

        let bytesHtml = '';
        let asciiStr = '';
        const currentBytes = new Uint8Array(WATCH_BYTES);

        for (let i = 0; i < WATCH_BYTES; i++) {
            const byte = readWatchByte(watch, i);
            currentBytes[i] = byte;
            const changed = watch.prevBytes[i] !== byte;
            const hx = byte.toString(16).toUpperCase().padStart(2, '0');
            bytesHtml += changed ? `<span class="changed">${hx}</span> ` : hx + ' ';
            asciiStr += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
        }

        bytesSpan.innerHTML = bytesHtml;
        asciiSpan.textContent = asciiStr;
        watch.prevBytes = currentBytes;
    });
}

if (btnWatchAdd) {
    btnWatchAdd.addEventListener('click', () => {
        if (watches.length >= MAX_WATCHES) {
            showMessage(`Maximum ${MAX_WATCHES} watches allowed`);
            return;
        }
        const addrStr = watchAddrInput.value.trim();
        if (!addrStr) { showMessage('Enter address', 'error'); watchAddrInput.focus(); return; }

        let addr, page = null;
        const parsed = spectrum.parseAddressSpec(addrStr);
        if (parsed) { addr = parsed.start; page = parsed.page; }
        else {
            addr = parseInt(addrStr, 16);
            if (isNaN(addr) || addr < 0 || addr > 0xFFFF) {
                showMessage('Invalid address', 'error'); watchAddrInput.focus(); return;
            }
        }

        const name = watchNameInput.value.trim();
        watches.push({ addr, name, page, prevBytes: new Uint8Array(WATCH_BYTES) });
        saveWatches();
        renderWatches();
        watchAddrInput.value = '';
        watchNameInput.value = '';
        const pageStr = page !== null ? `${page}:` : '';
        showMessage(`Watch added: ${pageStr}${addr.toString(16).toUpperCase().padStart(4, '0')}${name ? ' (' + name + ')' : ''}`);
    });
}

if (btnWatchClear) {
    btnWatchClear.addEventListener('click', () => {
        if (watches.length === 0) return;
        watches = [];
        saveWatches();
        renderWatches();
        showMessage('All watches cleared');
    });
}

loadWatches();
renderWatches();

// ═════════════════════════════════════════════════════════════════════
// 13. Status bar & RZX status
// ═════════════════════════════════════════════════════════════════════

function updateStatus() {
    fpsEl.textContent = spectrum.getFps();
    machineSelect.value = spectrum.machineType;
    btnRun.textContent = spectrum.isRunning() ? 'Pause' : 'Run';
    btnRun.disabled = !spectrum.romLoaded;

    if (debuggerPanel.classList.contains('open') || window.innerWidth >= 1400) {
        updateDebugger();
    }
    updateRZXStatus();
}

function updateRZXStatus() {
    if (spectrum.isRZXPlaying()) {
        rzxInfo.style.visibility = 'visible';
        const frame = spectrum.getRZXFrame();
        const total = spectrum.getRZXTotalFrames();
        const percent = Math.round((frame / total) * 100);
        rzxStatus.textContent = `${frame}/${total} (${percent}%)`;
    } else {
        rzxInfo.style.visibility = 'hidden';
    }
}

btnRzxStop.addEventListener('click', () => {
    spectrum.rzxStop();
    updateRZXStatus();
    showMessage('RZX playback stopped');
});

spectrum.onRZXEnd = () => {
    updateRZXStatus();
    showMessage('RZX playback finished');
};

setInterval(updateStatus, 500);

// ═════════════════════════════════════════════════════════════════════
// 14. Port I/O logging & trace filter
// ═════════════════════════════════════════════════════════════════════

function updatePortLogStatus() {
    const count = spectrum.getPortLogCount();
    portLogStatus.textContent = count > 0 ? `${count} entries` : '';
}

chkPortLog.addEventListener('change', () => {
    spectrum.setPortLogEnabled(chkPortLog.checked);
    updatePortLogStatus();
    if (chkPortLog.checked) showMessage('Port I/O logging enabled');
});

btnPortLogExport.addEventListener('click', () => {
    if (btnPortLogExport.dataset.exporting) return;
    btnPortLogExport.dataset.exporting = '1';
    try {
        const filter = selPortLogFilter.value;
        const result = spectrum.exportPortLog(filter);
        if (result.count === 0) { showMessage('No port log entries to export'); return; }
        const blob = new Blob([result.text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'port-io-log.txt';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showMessage(`Exported ${result.count} port log entries`);
    } finally {
        setTimeout(() => { delete btnPortLogExport.dataset.exporting; }, 500);
    }
});

btnPortLogClear.addEventListener('click', () => {
    spectrum.clearPortLog();
    updatePortLogStatus();
    showMessage('Port log cleared');
});

// Port trace filter
function updatePortFilterList() {
    const filters = spectrum.getPortTraceFilters();
    if (filters.length === 0) {
        portFilterList.innerHTML = '<div class="no-breakpoints">All ports (no filter)</div>';
        portFilterStatus.textContent = '';
    } else {
        const hx = v => v.toString(16).toUpperCase().padStart(v > 0xFF ? 4 : 2, '0');
        portFilterList.innerHTML = filters.map((f, i) => {
            const desc = hx(f.port) + '&' + hx(f.mask);
            return `<div class="trigger-item" data-index="${i}">
                <span class="trigger-icon port-filter" title="Port filter">P</span>
                <span class="trigger-desc">${desc}</span>
                <span class="trigger-remove" data-index="${i}" title="Remove">\u00d7</span>
            </div>`;
        }).join('');
        portFilterStatus.textContent = `${filters.length} filter${filters.length !== 1 ? 's' : ''}`;
    }
}

function addPortFilterFromInput() {
    const val = txtPortTraceFilter.value.trim();
    if (!val) return;
    const result = spectrum.addPortTraceFilter(val);
    if (!result) { showMessage('Invalid port spec (use hex: FE, 7FFD, FE&FF)'); return; }
    txtPortTraceFilter.value = '';
    updatePortFilterList();
}

btnAddPortFilter.addEventListener('click', addPortFilterFromInput);
txtPortTraceFilter.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPortFilterFromInput(); } });
btnClearPortFilters.addEventListener('click', () => { spectrum.clearPortTraceFilters(); updatePortFilterList(); showMessage('Port filters cleared \u2014 tracing all ports'); });
portFilterList.addEventListener('click', (e) => {
    if (e.target.classList.contains('trigger-remove')) {
        const index = parseInt(e.target.dataset.index);
        spectrum.removePortTraceFilter(index);
        updatePortFilterList();
    }
});

// ═════════════════════════════════════════════════════════════════════
// 15. Register editing (event delegation)
// ═════════════════════════════════════════════════════════════════════

const regClickHandler = (e) => handleRegisterClick(e, spectrum, updateDebugger);
mainRegisters.addEventListener('click', regClickHandler);
altRegisters.addEventListener('click', regClickHandler);
ixiyRegisters.addEventListener('click', regClickHandler);
indexRegisters.addEventListener('click', regClickHandler);
statusRegisters.addEventListener('click', regClickHandler);
pagesInfo.addEventListener('click', regClickHandler);

// Flag toggle
flagsDisplay.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('flag-item') && target.classList.contains('editable')) {
        const bit = parseInt(target.dataset.bit);
        if (!isNaN(bit) && spectrum.cpu) {
            spectrum.cpu.f ^= bit;
            updateDebugger();
        }
    }
});

// EXA/EXX buttons
ixiyRegisters.addEventListener('click', (e) => {
    if (!spectrum.cpu) return;
    const btn = e.target.closest('.reg-swap-btn');
    if (!btn) return;
    const cpu = spectrum.cpu;
    if (btn.id === 'btnEXA') {
        let tmp = cpu.a; cpu.a = cpu.a_; cpu.a_ = tmp;
        tmp = cpu.f; cpu.f = cpu.f_; cpu.f_ = tmp;
        updateDebugger();
    } else if (btn.id === 'btnEXX') {
        let tmp = cpu.b; cpu.b = cpu.b_; cpu.b_ = tmp;
        tmp = cpu.c; cpu.c = cpu.c_; cpu.c_ = tmp;
        tmp = cpu.d; cpu.d = cpu.d_; cpu.d_ = tmp;
        tmp = cpu.e; cpu.e = cpu.e_; cpu.e_ = tmp;
        tmp = cpu.h; cpu.h = cpu.h_; cpu.h_ = tmp;
        tmp = cpu.l; cpu.l = cpu.l_; cpu.l_ = tmp;
        updateDebugger();
    }
});

// ═════════════════════════════════════════════════════════════════════
// 16. Step/Run buttons
// ═════════════════════════════════════════════════════════════════════

btnRun.addEventListener('click', () => {
    if (!spectrum.romLoaded) { document.getElementById('romModal').classList.remove('hidden'); return; }
    spectrum.toggle();
    updateStatus();
});

function doStepInto() {
    if (!spectrum.romLoaded) { showMessage('ROM not loaded', 'error'); return; }
    if (spectrum.isRunning()) spectrum.stop();
    if (chkAutoComment.checked) {
        commentManager.set(spectrum.cpu.pc, { before: '--------------------' });
    }
    traceManager.goToLive();
    setTraceViewAddress(null);
    spectrum.stepInto();
    openDebuggerPanel();
    updateDebugger();
    updateStatus();
}

function doStepOver() {
    if (!spectrum.romLoaded) { showMessage('ROM not loaded', 'error'); return; }
    if (spectrum.isRunning()) spectrum.stop();
    traceManager.goToLive();
    setTraceViewAddress(null);
    spectrum.stepOver();
    openDebuggerPanel();
    updateDebugger();
    updateStatus();
}

btnStepInto.addEventListener('click', doStepInto);
btnStepOver.addEventListener('click', doStepOver);
btnRightStepInto.addEventListener('click', doStepInto);
btnRightStepOver.addEventListener('click', doStepOver);

btnRunTo.addEventListener('click', () => {
    if (!spectrum.romLoaded) return;
    if (runToTarget === null) { showMessage('Click a line in disassembly to set target', 'error'); return; }
    if (spectrum.isRunning()) spectrum.stop();
    traceManager.goToLive(); setTraceViewAddress(null);
    const reached = spectrum.runToAddress(runToTarget);
    showMessage(reached ? `Reached ${hex16(runToTarget)}` : 'Target not reached (max cycles)', reached ? 'success' : 'error');
    updateDebugger(); updateStatus();
});

btnRunToInt.addEventListener('click', () => {
    if (!spectrum.romLoaded) return;
    if (spectrum.isRunning()) spectrum.stop();
    traceManager.goToLive(); setTraceViewAddress(null);
    const reached = spectrum.runToInterrupt();
    showMessage(reached ? 'Interrupt reached' : 'Interrupt not reached (max cycles)', reached ? 'success' : 'error');
    updateDebugger(); updateStatus();
});

btnRunToRet.addEventListener('click', () => {
    if (!spectrum.romLoaded) return;
    if (spectrum.isRunning()) spectrum.stop();
    traceManager.goToLive(); setTraceViewAddress(null);
    const reached = spectrum.runToRet();
    showMessage(reached ? `RET at ${hex16(spectrum.cpu.pc)}` : 'RET not reached (max cycles)', reached ? 'success' : 'error');
    updateDebugger(); updateStatus();
});

btnRunTstates.addEventListener('click', () => {
    if (!spectrum.romLoaded) return;
    const ts = parseInt(tstatesInput.value, 10);
    if (isNaN(ts) || ts <= 0) { showMessage('Invalid T-states value', 'error'); return; }
    if (spectrum.isRunning()) spectrum.stop();
    traceManager.goToLive(); setTraceViewAddress(null);
    const executed = spectrum.runTstates(ts);
    if (chkAutoComment.checked) commentManager.set(spectrum.cpu.pc, { before: '--------------------' });
    showMessage(`Executed ${executed} T-states`);
    updateDebugger(); updateStatus();
});

// Right panel duplicates
btnRightRunTo.addEventListener('click', () => {
    if (!spectrum.romLoaded) return;
    if (runTargetAddress === null) { showMessage('Click on a disasm line to set cursor', 'error'); return; }
    if (spectrum.isRunning()) spectrum.stop();
    traceManager.goToLive(); setTraceViewAddress(null);
    const reached = spectrum.runTo(runTargetAddress);
    showMessage(reached ? `Reached ${hex16(runTargetAddress)}` : `Target ${hex16(runTargetAddress)} not reached (max cycles)`, reached ? 'success' : 'error');
    updateDebugger(); updateStatus();
});

btnRightRunToInt.addEventListener('click', () => {
    if (!spectrum.romLoaded) return;
    if (spectrum.isRunning()) spectrum.stop();
    traceManager.goToLive(); setTraceViewAddress(null);
    const reached = spectrum.runToInterrupt();
    showMessage(reached ? `Interrupt at ${hex16(spectrum.cpu.pc)}` : 'Interrupt not reached (max cycles)', reached ? 'success' : 'error');
    updateDebugger(); updateStatus();
});

btnRightRunToRet.addEventListener('click', () => {
    if (!spectrum.romLoaded) return;
    if (spectrum.isRunning()) spectrum.stop();
    traceManager.goToLive(); setTraceViewAddress(null);
    const reached = spectrum.runToRet();
    showMessage(reached ? `RET at ${hex16(spectrum.cpu.pc)}` : 'RET not reached (max cycles)', reached ? 'success' : 'error');
    updateDebugger(); updateStatus();
});

btnRightRunTstates.addEventListener('click', () => {
    if (!spectrum.romLoaded) return;
    const ts = parseInt(rightTstatesInput.value, 10);
    if (isNaN(ts) || ts <= 0) { showMessage('Invalid T-states value', 'error'); return; }
    if (spectrum.isRunning()) spectrum.stop();
    traceManager.goToLive(); setTraceViewAddress(null);
    const executed = spectrum.runTstates(ts);
    if (chkAutoComment.checked) commentManager.set(spectrum.cpu.pc, { before: '--------------------' });
    showMessage(`Executed ${executed} T-states`);
    updateDebugger(); updateStatus();
});

// ═════════════════════════════════════════════════════════════════════
// 17. Disassembly click handler (run-to target)
// ═════════════════════════════════════════════════════════════════════

disassemblyView.addEventListener('click', (e) => {
    const foldToggle = e.target.closest('.disasm-fold-toggle, .disasm-fold-summary');
    if (foldToggle) {
        const addr = parseInt(foldToggle.dataset.foldAddr, 10);
        if (!isNaN(addr)) { foldManager.toggle(addr); updateDebugger(); }
        return;
    }

    const bpMarker = e.target.closest('.disasm-bp');
    if (bpMarker) {
        const addr = parseInt(bpMarker.dataset.addr, 10);
        const isSet = spectrum.toggleBreakpoint(addr);
        showMessage(isSet ? `Breakpoint set at ${hex16(addr)}` : `Breakpoint removed at ${hex16(addr)}`);
        updateDebugger();
        return;
    }

    const addrSpan = e.target.closest('.disasm-addr');
    if (addrSpan) {
        const line = addrSpan.closest('.disasm-line');
        if (line) {
            const addr = parseInt(line.dataset.addr, 10);
            if (e.ctrlKey) { goToAddress(addr); updateDebugger(); showMessage(`Disasm: ${hex16(addr)}`); }
            else { goToMemoryAddress(addr); showMessage(`Memory: ${hex16(addr)}`); }
        }
        return;
    }

    const operandAddr = e.target.closest('.disasm-operand-addr');
    if (operandAddr) {
        const addr = parseInt(operandAddr.dataset.addr, 10);
        if (e.ctrlKey) { goToMemoryAddress(addr); showMessage(`Memory: ${hex16(addr)}`); }
        else { goToAddress(addr); updateDebugger(); showMessage(`Disasm: ${hex16(addr)}`); }
        return;
    }

    const line = e.target.closest('.disasm-line');
    if (line) {
        runToTarget = parseInt(line.dataset.addr, 10);
        disassemblyView.querySelectorAll('.disasm-line').forEach(el => el.classList.remove('target'));
        line.classList.add('target');
        showMessage(`Run target: ${hex16(runToTarget)}`);
    }
});

// ═════════════════════════════════════════════════════════════════════
// 18. Trigger UI
// ═════════════════════════════════════════════════════════════════════

triggerType.addEventListener('change', () => {
    triggerAddrInput.placeholder = triggerType.value.startsWith('port') ? 'PORT[&MASK]' : '[P:]ADDR[-END]';
});

btnAddTrigger.addEventListener('click', () => {
    const type = triggerType.value;
    const addrStr = triggerAddrInput.value.trim();
    if (!addrStr) return;
    const condition = triggerCondInput.value.trim();
    const skipCount = parseInt(document.getElementById('triggerSkipInput').value) || 0;

    let triggerSpec;
    if (type.startsWith('port')) {
        const parsed = spectrum.parsePortSpec(addrStr);
        if (!parsed) { showMessage('Invalid port address', 'error'); return; }
        triggerSpec = { type, start: parsed.port, end: parsed.port, mask: parsed.mask };
    } else {
        const parsed = spectrum.parseAddressSpec(addrStr);
        if (!parsed) { showMessage('Invalid address', 'error'); return; }
        triggerSpec = { type, start: parsed.start, end: parsed.end, page: parsed.page };
    }

    if (condition) triggerSpec.condition = condition;
    if (skipCount > 0) triggerSpec.skipCount = skipCount;

    if (spectrum.addTrigger(triggerSpec) < 0) { showMessage('Failed to add trigger', 'error'); return; }

    triggerAddrInput.value = '';
    triggerCondInput.value = '';
    document.getElementById('triggerSkipInput').value = '0';
    const typeLabel = spectrum.getTriggerLabel(type);
    let msg = `${typeLabel} trigger set: ${addrStr.toUpperCase()}`;
    if (condition) msg += ` if ${condition}`;
    if (skipCount > 0) msg += ` (skip ${skipCount})`;
    showMessage(msg);
    updateDebugger();
});

triggerAddrInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnAddTrigger.click(); });
triggerCondInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnAddTrigger.click(); });

btnClearTriggers.addEventListener('click', () => {
    const count = spectrum.getTriggers().length;
    if (count === 0) { showMessage('No triggers to clear', 'error'); return; }
    spectrum.clearTriggers();
    showMessage(`Cleared ${count} trigger(s)`);
    updateDebugger();
});

triggerList.addEventListener('click', (e) => {
    const index = parseInt(e.target.dataset.index, 10);
    if (isNaN(index)) return;
    if (e.target.classList.contains('trigger-remove')) {
        const triggers = spectrum.getTriggers();
        const t = triggers.find(tr => tr.index === index);
        spectrum.removeTrigger(index);
        showMessage(`Trigger removed: ${t ? spectrum.formatTrigger(t) : index}`);
        updateDebugger();
    } else if (e.target.classList.contains('trigger-toggle')) {
        const enabled = spectrum.toggleTrigger(index);
        showMessage(`Trigger ${enabled ? 'enabled' : 'disabled'}`);
        updateDebugger();
    } else if (e.target.classList.contains('trigger-desc')) {
        const triggers = spectrum.getTriggers();
        const t = triggers.find(tr => tr.index === index);
        if (t && !t.type.startsWith('port')) {
            goToAddress(t.start);
            goToMemoryAddress(t.start);
            updateDebugger();
        }
    }
});

// ═════════════════════════════════════════════════════════════════════
// 19. Breakpoint / Watchpoint / Port hit callbacks
// ═════════════════════════════════════════════════════════════════════

spectrum.onBreakpoint = (addr) => {
    showMessage(`Breakpoint hit at ${hex16(addr)}`);
    setDisasmViewAddress(null);
    openDebuggerPanel();
    updateDebugger();
    updateStatus();
};

spectrum.onWatchpoint = (wp) => {
    const typeStr = wp.type === 'read' ? 'Read' : 'Write';
    showMessage(`Watchpoint: ${typeStr} at ${hex16(wp.addr)} = ${hex8(wp.val)}`);
    setDisasmViewAddress(null);
    openDebuggerPanel();
    goToMemoryAddress(wp.addr);
    updateDebugger();
    updateStatus();
};

spectrum.onPortBreakpoint = (pb) => {
    const dirStr = pb.direction === 'in' ? 'IN' : 'OUT';
    const portHex = pb.port.toString(16).toUpperCase().padStart(4, '0');
    let msg = `Port breakpoint: ${dirStr} ${portHex}`;
    if (pb.val !== undefined) msg += ` = ${hex8(pb.val)}`;
    showMessage(msg);
    setDisasmViewAddress(null);
    openDebuggerPanel();
    updateDebugger();
    updateStatus();
};

spectrum.onTrigger = (info) => {
    setDisasmViewAddress(null);
    updateDebugger();
};

// ═════════════════════════════════════════════════════════════════════
// 20. Labels panel handlers
// ═════════════════════════════════════════════════════════════════════

labelFilterInput.addEventListener('input', () => updateLabelsList());

btnAddLabel.addEventListener('click', () => showLabelDialog(null, null));

btnClearLabels.addEventListener('click', () => {
    const count = labelManager.getAll().length;
    if (count === 0) { showMessage('No labels to clear', 'error'); return; }
    if (confirm(`Clear all ${count} label(s)?`)) {
        labelManager.labels.clear();
        labelManager._autoSave();
        showMessage(`Cleared ${count} label(s)`);
        updateLabelsList();
        updateDebugger();
    }
});

btnExportLabels.addEventListener('click', () => {
    const labels = labelManager.getAll();
    if (labels.length === 0) { showMessage('No labels to export', 'error'); return; }
    try {
        const json = labelManager.exportJSON();
        const blob = new Blob([json], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filename = labelManager.currentFile
            ? labelManager.currentFile.replace(/\.[^.]+$/, '') + '_labels.json'
            : 'labels.json';
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showMessage(`Exported ${labels.length} label(s)`);
    } catch (e) { showMessage('Export failed: ' + e.message, 'error'); }
});

btnImportLabels.addEventListener('click', () => labelFileInput.click());

labelFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const merge = labelManager.getAll().length > 0 &&
                          confirm('Merge with existing labels?\n(Cancel to replace all)');
            const count = labelManager.importJSON(event.target.result, merge);
            showMessage(`Imported ${count} label(s)${merge ? ' (merged)' : ''}`);
            updateLabelsList();
            updateDebugger();
        } catch (err) { showMessage('Invalid labels file: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
    labelFileInput.value = '';
});

labelsList.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.label-remove');
    if (removeBtn) {
        const addr = parseInt(removeBtn.dataset.addr, 10);
        const page = removeBtn.dataset.page === 'null' ? null : parseInt(removeBtn.dataset.page, 10);
        const oldLabel = labelManager.get(addr, page);
        if (!oldLabel) return;
        labelManager.remove(addr, page);
        undoManager.push({
            type: 'label',
            description: `Delete label "${oldLabel.name}"`,
            undo: () => { labelManager.add(oldLabel); updateLabelsList(); },
            redo: () => { labelManager.remove(addr, page); updateLabelsList(); }
        });
        showMessage(`Label removed: ${oldLabel.name}`);
        updateLabelsList();
        updateDebugger();
        return;
    }
    const editBtn = e.target.closest('.label-edit');
    if (editBtn) {
        const addr = parseInt(editBtn.dataset.addr, 10);
        const page = editBtn.dataset.page === 'null' ? null : parseInt(editBtn.dataset.page, 10);
        const label = labelManager.get(addr, page);
        showLabelDialog(addr, label);
        return;
    }
    const item = e.target.closest('.label-item');
    if (item) {
        const addr = parseInt(item.dataset.addr, 10);
        goToAddress(addr);
        updateDebugger();
    }
});

// ═════════════════════════════════════════════════════════════════════
// 21. Reset / Screenshot / Load-Save dropdowns
// ═════════════════════════════════════════════════════════════════════

btnReset.addEventListener('click', () => {
    if (!confirm('Reset machine? This will lose current state.')) return;
    cancelAutoLoad();
    spectrum.reset();
    diskActivityEl.style.display = 'none';
    document.getElementById('tapeInfo').style.display = 'none';
    document.getElementById('diskInfo').style.display = 'none';
    if (tapeCatalogEl) tapeCatalogEl.innerHTML = '';
    if (diskCatalogEl) diskCatalogEl.innerHTML = '';
    if (mediaCatalogContainer) mediaCatalogContainer.style.display = 'none';
    showMessage('Machine reset');
});

document.getElementById('btnScreenshot').addEventListener('click', () => {
    const format = document.getElementById('frameExportFormat').value;
    const baseName = getExportBaseName() || 'screenshot';
    const timestamp = Date.now();

    if (format === 'png') {
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${baseName}_${timestamp}.png`;
            a.click(); URL.revokeObjectURL(url);
            showMessage('Screenshot saved as PNG');
        }, 'image/png');
    } else if (format === 'scr') {
        let data, msg;
        if (spectrum.ula.ulaplus.enabled && spectrum.ula.ulaplus.paletteEnabled && spectrum.ula.ulaplus.paletteModified) {
            data = new Uint8Array(6912 + 64);
            for (let i = 0; i < 6912; i++) data[i] = spectrum.memory.read(0x4000 + i);
            data.set(spectrum.ula.ulaplus.palette, 6912);
            msg = 'SCR saved with ULAplus palette (6976 bytes)';
        } else {
            data = new Uint8Array(6912);
            for (let i = 0; i < 6912; i++) data[i] = spectrum.memory.read(0x4000 + i);
            msg = 'SCR saved (6912 bytes)';
        }
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${baseName}_${timestamp}.scr`;
        a.click(); URL.revokeObjectURL(url);
        showMessage(msg);
    } else {
        showMessage(`Use Start/Stop for ${format.toUpperCase()} format`, 'info');
    }
});

document.getElementById('btnScreenshotMain').addEventListener('click', () => {
    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `screenshot_${spectrum.machineType}_${Date.now()}.png`;
        a.click(); URL.revokeObjectURL(url);
        showMessage('Screenshot saved');
    }, 'image/png');
});

// Load dropdown
loadSelect.addEventListener('change', (e) => {
    const action = e.target.value;
    e.target.selectedIndex = 0;
    if (!action) return;
    if (action === 'file') fileInput.click();
    else if (action === 'browse') {
        document.getElementById('gameBrowserDialog').classList.remove('hidden');
        document.getElementById('gameBrowserSearch').focus();
    }
    else if (action === 'project') projectFileInput.click();
    else if (action === 'quick') quickload();
});

// Save dropdown
saveSelect.addEventListener('change', (e) => {
    const action = e.target.value;
    e.target.selectedIndex = 0;
    if (!action) return;
    if (action === 'project') saveProject({
        spectrum, labelManager, regionManager, commentManager,
        operandFormatManager, xrefManager, subroutineManager, foldManager,
        traceManager, getExportBaseName
    });
    else if (action === 'quick') quicksave();
    else {
        try {
            const profile = getMachineProfile(spectrum.machineType);
            if (action !== 'szx' && profile.ramPages > 8) {
                showMessage(`${action.toUpperCase()} format limited to 8 RAM pages \u2014 ${profile.ramPages - 8} pages will be lost. Use SZX for full save.`, 'warning');
            }
            const data = spectrum.saveSnapshot(action);
            const blob = new Blob([data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `snapshot_${spectrum.machineType}.${action}`;
            a.click(); URL.revokeObjectURL(url);
            showMessage(`Snapshot saved as ${action.toUpperCase()}`);
        } catch (err) { showMessage('Failed to save: ' + err.message, 'error'); }
    }
});

// Project file load
projectFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        loadProject(event.target.result, spectrum, {
            labelManager, regionManager, commentManager,
            operandFormatManager, xrefManager, subroutineManager, foldManager,
            traceManager, updateDebugger, updateLabelsList, showMessage,
            loadRomsForMachineType, applyRomsToEmulator,
            machineSelect, updateCanvasSize: () => updateCanvasSize(spectrum),
            updateBetaDiskStatus, setupDiskActivityCallback
        });
    };
    reader.readAsText(file);
    projectFileInput.value = '';
});

// ═════════════════════════════════════════════════════════════════════
// 22. Machine select + speed
// ═════════════════════════════════════════════════════════════════════

machineSelect.addEventListener('change', () => {
    cancelAutoLoad();
    const type = machineSelect.value;
    const profile = getMachineProfile(type);

    if (type !== '48k' && !romData[profile.romFile]) {
        showMessage(profile.name + ' ROM not loaded. Please select the ROM file.', 'error');
        machineSelect.value = spectrum.machineType;
        document.getElementById('btnCloseRomModal').classList.remove('hidden');
        document.getElementById('romModal').classList.remove('hidden');
        return;
    }

    const wasRunning = spectrum.isRunning();
    if (wasRunning) spectrum.stop();

    spectrum.setMachineType(type);
    localStorage.setItem('zx-machine-type', type);
    applyRomsToEmulator(spectrum);
    spectrum.ula.setBorderPreset(borderSizeSelect.value);
    spectrum.updateDisplayDimensions();
    updateCanvasSize(spectrum);
    applyPalette(paletteSelect?.value || 'default', spectrum);
    updateULAplusStatus(spectrum);
    spectrum.reset();
    disasm = null;

    if (profile.betaDiskDefault) spectrum.betaDiskEnabled = true;
    spectrum.updateBetaDiskPagingFlag();
    updateBetaDiskStatus(spectrum);
    setupDiskActivityCallback(spectrum);

    if (wasRunning) spectrum.start();
    else spectrum.runFrame();

    updateGraphicsViewer();
    showMessage(`Switched to ${type.toUpperCase()}`);
    updateStatus();
});

speedSelect.addEventListener('change', () => {
    const speed = parseInt(speedSelect.value, 10);
    spectrum.setSpeed(speed);
    showMessage(`Speed: ${speed === 0 ? 'Max' : speed + '%'}`);
});

// ═════════════════════════════════════════════════════════════════════
// 23. Audio controls
// ═════════════════════════════════════════════════════════════════════

btnSound.addEventListener('click', async () => {
    const enable = !(spectrum.audio && !spectrum.audio.muted);
    await toggleSound(enable, spectrum, showMessage);
});

btnMute.addEventListener('click', async () => {
    const enable = !(spectrum.audio && !spectrum.audio.muted);
    await toggleSound(enable, spectrum, showMessage);
});

chkSound.addEventListener('change', async () => {
    await toggleSound(chkSound.checked, spectrum, showMessage);
});

volumeSlider.addEventListener('input', async () => {
    volumeValue.textContent = volumeSlider.value;
    await initAudioOnUserGesture(spectrum);
    if (spectrum.audio) spectrum.audio.setVolume(volumeSlider.value / 100);
    localStorage.setItem('zx-volume', volumeSlider.value);
});

stereoMode.addEventListener('change', () => {
    if (spectrum.ay) {
        spectrum.ay.stereoMode = stereoMode.value;
        spectrum.ay.updateStereoPanning();
    }
    localStorage.setItem('zx-stereo-mode', stereoMode.value);
});

chkAY48k.addEventListener('change', () => {
    spectrum.ayEnabled48k = chkAY48k.checked;
    localStorage.setItem('zx-ay-48k', chkAY48k.checked);
    showMessage(chkAY48k.checked ? 'AY enabled in 48K mode' : 'AY disabled in 48K mode');
});

// ═════════════════════════════════════════════════════════════════════
// 24. Display controls
// ═════════════════════════════════════════════════════════════════════

borderSizeSelect.addEventListener('change', () => {
    spectrum.ula.setBorderPreset(borderSizeSelect.value);
    spectrum.updateDisplayDimensions();
    updateCanvasSize(spectrum);
    spectrum.renderToScreen();
    localStorage.setItem('zx-border-size', borderSizeSelect.value);
});

paletteSelect.addEventListener('change', () => {
    const paletteId = paletteSelect.value;
    applyPalette(paletteId, spectrum);
    localStorage.setItem('zxm8_palette', paletteId);
});

btnFullscreen.addEventListener('click', toggleFullscreen);

fullscreenMode.addEventListener('change', () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) applyFullscreenScale();
    localStorage.setItem('zx-fullscreen-mode', fullscreenMode.value);
});

document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) applyFullscreenScale();
    else restoreCanvasSize();
});
document.addEventListener('webkitfullscreenchange', () => {
    if (document.webkitFullscreenElement) applyFullscreenScale();
    else restoreCanvasSize();
});

// Zoom buttons
document.getElementById('zoom1').addEventListener('click', () => setZoom(1, spectrum));
document.getElementById('zoom2').addEventListener('click', () => setZoom(2, spectrum));
document.getElementById('zoom3').addEventListener('click', () => setZoom(3, spectrum));

// Invert display
const chkInvertDisplay = document.getElementById('chkInvertDisplay');
if (chkInvertDisplay) {
    chkInvertDisplay.addEventListener('change', () => {
        applyInvertDisplay(chkInvertDisplay.checked);
        localStorage.setItem('zx-invert-display', chkInvertDisplay.checked);
    });
}

// ═════════════════════════════════════════════════════════════════════
// 25. Global keyboard shortcuts
// ═════════════════════════════════════════════════════════════════════

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.target.isContentEditable || getIsEditingRegister()) return;

    // Ctrl+Z - Undo
    if (e.ctrlKey && e.key === 'z' && !spectrum.isRunning()) {
        e.preventDefault(); undoManager.undo(); return;
    }
    // Ctrl+Y - Redo
    if (e.ctrlKey && e.key === 'y' && !spectrum.isRunning()) {
        e.preventDefault(); undoManager.redo(); return;
    }

    // Alt+Left - Trace back
    if (e.altKey && e.key === 'ArrowLeft' && !spectrum.isRunning()) {
        e.preventDefault();
        const entry = traceManager.goBack();
        if (entry) showTraceEntry(entry);
        return;
    }
    // Alt+Right - Trace forward
    if (e.altKey && e.key === 'ArrowRight' && !spectrum.isRunning()) {
        e.preventDefault();
        const entry = traceManager.goForward();
        if (entry) showTraceEntry(entry);
        else {
            traceManager.goToLive();
            if (typeof window.updateTraceStatus === 'function') window.updateTraceStatus();
            if (typeof window.updateTraceList === 'function') window.updateTraceList();
            showMessage('Returned to live view');
        }
        return;
    }

    // F6 - Pause/Resume
    if (e.code === 'F6' || e.key === 'F6' || e.key === 'Pause') {
        e.preventDefault();
        if (spectrum.romLoaded) { spectrum.toggle(); updateStatus(); showMessage(spectrum.isRunning() ? 'Resumed' : 'Paused'); }
        return;
    }
    // F7 - Step Into
    if (e.code === 'F7' || e.key === 'F7') { e.preventDefault(); doStepInto(); return; }
    // F8 - Step Over
    if (e.code === 'F8' || e.key === 'F8') { e.preventDefault(); doStepOver(); return; }
    // F4 - Run to Cursor
    if (e.key === 'F4') {
        e.preventDefault();
        if (!spectrum.romLoaded) return;
        if (runToTarget === null) { showMessage('Click a disassembly line first', 'error'); return; }
        if (spectrum.isRunning()) spectrum.stop();
        traceManager.goToLive(); setTraceViewAddress(null);
        const reached = spectrum.runToAddress(runToTarget);
        showMessage(reached ? `Reached ${hex16(runToTarget)}` : 'Target not reached', reached ? 'success' : 'error');
        openDebuggerPanel(); updateDebugger(); updateStatus();
        return;
    }
    // F9 - Toggle Breakpoint at PC
    if (e.key === 'F9') {
        e.preventDefault();
        if (!spectrum.romLoaded) return;
        const pc = spectrum.cpu.pc;
        const isSet = spectrum.toggleBreakpoint(pc);
        showMessage(isSet ? `Breakpoint set at ${hex16(pc)}` : `Breakpoint removed at ${hex16(pc)}`);
        openDebuggerPanel(); updateDebugger();
        return;
    }
});

// ═════════════════════════════════════════════════════════════════════
// 26. File drop / file input
// ═════════════════════════════════════════════════════════════════════

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await initAudioOnUserGesture(spectrum);
    const data = await file.arrayBuffer();
    handleLoadResult(data, file.name, {
        spectrum, showMessage, updateDebugger, updateStatus,
        machineSelect, updateCanvasSize: () => updateCanvasSize(spectrum),
        applyRomsToEmulator, loadRomsForMachineType,
        updateBetaDiskStatus, setupDiskActivityCallback,
        applyPalette: (id) => applyPalette(id, spectrum),
        updateULAplusStatus: () => updateULAplusStatus(spectrum),
        updateGraphicsViewer, showZipSelection
    });
    fileInput.value = '';
});

// Drag and drop
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    await initAudioOnUserGesture(spectrum);
    const data = await file.arrayBuffer();
    handleLoadResult(data, file.name, {
        spectrum, showMessage, updateDebugger, updateStatus,
        machineSelect, updateCanvasSize: () => updateCanvasSize(spectrum),
        applyRomsToEmulator, loadRomsForMachineType,
        updateBetaDiskStatus, setupDiskActivityCallback,
        applyPalette: (id) => applyPalette(id, spectrum),
        updateULAplusStatus: () => updateULAplusStatus(spectrum),
        updateGraphicsViewer, showZipSelection
    });
});

// ═════════════════════════════════════════════════════════════════════
// 27. Restore saved settings
// ═════════════════════════════════════════════════════════════════════

// Restore volume
const savedVolume = localStorage.getItem('zx-volume');
if (savedVolume !== null) {
    volumeSlider.value = savedVolume;
    volumeValue.textContent = savedVolume;
}

// Restore sound enabled
const savedSoundEnabled = localStorage.getItem('zx-sound-enabled');
if (savedSoundEnabled !== null) {
    chkSound.checked = savedSoundEnabled === 'true';
    updateSoundButtons(chkSound.checked);
}

// Restore stereo mode
const savedStereo = localStorage.getItem('zx-stereo-mode');
if (savedStereo) stereoMode.value = savedStereo;

// Restore AY in 48K
const savedAY48k = localStorage.getItem('zx-ay-48k');
if (savedAY48k !== null) {
    chkAY48k.checked = savedAY48k === 'true';
    spectrum.ayEnabled48k = chkAY48k.checked;
}

// Restore border size
const savedBorder = localStorage.getItem('zx-border-size');
if (savedBorder) {
    borderSizeSelect.value = savedBorder;
    spectrum.ula.setBorderPreset(savedBorder);
    spectrum.updateDisplayDimensions();
}

// Restore fullscreen mode
const savedFsMode = localStorage.getItem('zx-fullscreen-mode');
if (savedFsMode) fullscreenMode.value = savedFsMode;

// Restore zoom (default 1)
const savedZoom = localStorage.getItem('zx-zoom') || '1';
setZoom(parseInt(savedZoom, 10), spectrum);

// Restore invert display
const savedInvert = localStorage.getItem('zx-invert-display');
if (savedInvert === 'true') {
    if (chkInvertDisplay) chkInvertDisplay.checked = true;
    applyInvertDisplay(true);
}

// Load palettes
loadPalettes(spectrum);

// Load boot TRD settings
loadBootTrdSettings();

// ═════════════════════════════════════════════════════════════════════
// 28. Boot
// ═════════════════════════════════════════════════════════════════════

// Initial black screen
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#000';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// Try to auto-load ROMs
tryLoadRomsFromDirectory(labelManager, updateRomStatus, () => initializeEmulator(spectrum, showMessage));

console.log('ZX-M8XXX v' + APP_VERSION);
console.log('');
console.log('Usage:');
console.log('1. Place ROMs in roms/ directory (48.rom, 128.rom, plus2.rom, plus2a.rom, pentagon.rom, scorpion.rom, trdos.rom)');
console.log('2. Or select ROM files in dialog if not found');
console.log('3. Load SNA/Z80/SZX snapshots, TAP/TZX tapes, or TRD/SCL disk images');
