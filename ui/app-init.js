// app-init.js — the application itself: wiring, main loop, and the glue that
// binds every ui/ module to the DOM in index.html.
//
// This was ~3,000 lines inlined in index.html. Same module, same deferred
// execution order, just in a file so it can be read, diffed and imported.
// Note: URLs passed to fetch() resolve against the *document*, not this file,
// so paths like 'roms/48.rom' stay as they were.

import { MACHINE_PROFILES, getMachineProfile, getMachineTypes, DEFAULT_VISIBLE_MACHINES, is128kCompat } from '../core/machines.js';
import { Spectrum } from '../core/spectrum.js';
import { createRewindBuffer } from '../core/rewind.js';
import { Disassembler } from '../core/disasm.js';
import { DSKLoader } from '../core/fdc.js';
import { TapeTrapHandler, RZXLoader, ZipLoader, SZXLoader, TRDLoader, SCLLoader } from '../core/loaders.js';
import { Assembler } from '../sjasmplus/assembler.js';
import { VFS } from '../sjasmplus/vfs.js';
import { ErrorCollector } from '../sjasmplus/errors.js';
import { AsmMemory } from '../sjasmplus/memory.js';
import { MD5 } from '../sjasmplus/md5.js';
import { REGION_TYPES, OPERAND_FORMATS, LabelManager, RegionManager, CommentManager, OperandFormatManager } from '../debug/managers.js';
import { hex8, hex16, escapeHtml, downloadFile, arrayToBase64, storageGet, storageSet } from '../core/utils.js';
import { XRefManager } from '../debug/xref-manager.js';
import { SubroutineManager } from '../debug/subroutine-manager.js';
import { FoldManager } from '../debug/fold-manager.js';
import { UndoManager } from '../debug/undo-manager.js';
import { TraceManager } from '../debug/trace-manager.js';
import { GameMapper } from '../tools/game-mapper.js';
import { SignaturePackManager } from '../debug/signature-pack-manager.js';
import { TestRunner } from '../tools/test-runner.js';
import { initCalculator } from './calculator.js';
import { initCompareTool } from './compare-tool.js';
import { initExplorer } from './explorer.js';
import { initTextScanner } from './text-scanner.js';
import { initTableScanner } from './table-scanner.js';
import { initDiffRun } from './diff-run.js';
import { initWatches } from './watches.js';
import { initFrameExport } from './frame-export.js';
import { initGameBrowser } from './game-browser.js';
import { initPokeManager } from './poke-manager.js';
import { initPokeSearch } from './poke-search.js';
import { initMemorySearch } from './memory-search.js';
import { initProfilerUI } from './profiler-ui.js';
import { initStructMapper } from './struct-mapper.js';
import { initCallGraph } from './call-graph.js';
import { initCodePath } from './codepath.js';
import { initMapperUI } from './mapper-ui.js';
import { initGamepad } from './gamepad.js';
import { initMemoryMap } from './memory-map.js';
import { buildRanges, buildRangesFromBits, buildRangesFromPagedBits, exportCtl, exportGhidraCsv, exportSym, exportIndirectCsv,
         findSmcRanges, exportSmcCsv, exportCallGraphCsv } from '../core/map-export.js';
import { initExportAsm } from './export-asm.js';
import { initAnalysisTools } from './analysis-tools.js';
import { initDisplaySettings } from './display-settings.js';
import { initAssemblerUI } from './assembler-ui.js';
import { initAsmSnippets } from './asm-snippets.js';
import { initVirtualKeyboard } from './virtual-keyboard.js';
import { initSignaturePacksUI } from './signature-packs-ui.js';
import { initBootManager } from './boot-manager.js';
import { initAutoLoader } from './auto-loader.js';
import { initMediaCatalog } from './media-catalog.js';
import { initScreenInfo } from './screen-info.js';
import { initPortLogging } from './port-logging.js';
import { initRegisterEditor } from './register-editor.js';
import { initStackView } from './stack-view.js';
import { initLabelsTriggers } from './labels-triggers.js';
import { initAssemblyOutput } from './assembly-output.js';
import { parseTextRegion, parseByteRegion, parseWordRegion, REGION_MAX_TEXT, REGION_MAX_BYTES, REGION_MAX_WORDS } from './region-helpers.js';
import { formatMnemonic } from './mnemonic-format.js';
import { initNavHistory } from './nav-history.js';
import { initTraceDisplay } from './trace-display.js';
import { initDialogs } from './dialogs.js';
import { initDisasmContext } from './disasm-context.js';
import { initMemContext } from './mem-context.js';
import { initHelpModal } from './help-modal.js';
import { initTabSystem } from './tab-system.js';
import { initLayoutHelpers } from './layout-helpers.js';
import { initStatusDisplay } from './status-display.js';
import { initCanvasZoom } from './canvas-zoom.js';
import { initRzxRecorder } from './rzx-recorder.js';
import { initRomSelector } from './rom-selector.js';
import { initMachineSelector } from './machine-selector.js';
import { initProjectIO } from './project-io.js';
import { initKeyboardShortcuts } from './keyboard-shortcuts.js';
import { initGotoPalette } from './goto-palette.js';
import { initImportForeign } from './import-foreign.js';
import { initBookmarks } from './bookmarks.js';
import { initInputSettings } from './input-settings.js';
import { initAutofire } from './autofire.js';
import { initFileLoader } from './file-loader.js';
import { initDisasmFormatter, LABEL_MAX_CHARS } from './disasm-formatter.js';
import { initDisasmGenerator } from './disasm-generator.js';
import { initPanelNavigator } from './panel-navigator.js';
import { initDiskActivity } from './disk-activity.js';
import { initMemoryView } from './memory-view.js';
import { initRightDisasmView } from './right-disasm-view.js';
import { initDebuggerDisplay } from './debugger-display.js';
import { initTriggerHandlers } from './trigger-handlers.js';
import { initStepControls } from './step-controls.js';
import { initDisasmNavigation } from './disasm-navigation.js';
import { initLabelsPanel } from './labels-panel.js';
import { initPsgPlayer } from './psg-player.js';
import { initBasicEditor } from './basic-editor.js';
import { searchEncoded, searchNibblePacked, decodeAt, ENCODINGS } from '../core/encoded-search.js';
import { findKeyScanTables, findCharTables, findWordTables,
         byValue as tableByValue, outliers as tableOutliers } from '../core/table-scan.js';
import { compareRuns, firstDivergence, divergenceContext,
         diffMemoryImages, diffRegisters } from '../core/divergence.js';
import { API, API_VERSION, API_CATEGORIES, buildCapabilities, checkRequired } from '../core/api-manifest.js';
    const APP_VERSION = '0.15.32';

    // A static deploy has no hashed filenames, so a browser can serve a fresh
    // index.html with cached JavaScript: the title shows the new version while the
    // code is last week's, and nothing errors. The document carries the version it
    // was built with; if the two disagree, say so instead of leaving the user to
    // wonder why a feature is missing. (.htaccess sets no-cache to prevent it.)
    (function checkForStaleModules() {
        const meta = document.querySelector('meta[name="zxm8-version"]');
        const docVersion = meta && meta.getAttribute('content');
        if (docVersion && docVersion !== APP_VERSION) {
            const msg = `Stale files: the page is v${docVersion} but the scripts are ` +
                        `v${APP_VERSION}. Reload with Ctrl+Shift+R (or clear the cache).`;
            console.warn('[ZX-M8XXX] ' + msg);
            document.addEventListener('DOMContentLoaded', () => {
                const bar = document.createElement('div');
                bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
                    'background:#a33;color:#fff;font:13px/1.6 monospace;padding:6px 12px;text-align:center';
                bar.textContent = msg;
                document.body.appendChild(bar);
            });
        }
    })();
    console.log('ZX-M8XXX v' + APP_VERSION);


    // Help modal (extracted to ui/help-modal.js)
    initHelpModal();

    // Tab System (extracted to ui/tab-system.js)
    const tabContainer = document.getElementById('tabContainer');
    const { openDebuggerPanel } = initTabSystem({
        getTestRunner: () => testRunner,
        getEnsureGraphicsViewer: () => ensureGraphicsViewer,
        getEnsureInfoPanel: () => ensureInfoPanel,
        getEnsureTextRipper: () => ensureTextRipper,
        getUpdateTraceList: () => updateTraceList
    });

    // Programmer Calculator (extracted to calculator.js)
    const calculatorAPI = initCalculator();

    // Game Browser (extracted to game-browser.js)
    const gameBrowserAPI = initGameBrowser();

    // Info Panel (lazy-loaded from ui/info-panel.js)
    let infoPanelLoaded = false;
    let infoPanelLoading = false;

    async function ensureInfoPanel() {
        if (infoPanelLoaded) return;
        if (infoPanelLoading) return;
        infoPanelLoading = true;
        const { initInfoPanel } = await import('./info-panel.js');
        initInfoPanel();
        infoPanelLoaded = true;
    }

    // Graphics Viewer (lazy-loaded from ui/graphics-viewer.js)
    let updateGraphicsViewer = null;
    let graphicsViewerLoading = false;

    async function ensureGraphicsViewer() {
        if (updateGraphicsViewer) return;
        if (graphicsViewerLoading) return;
        graphicsViewerLoading = true;
        const { initGraphicsViewer } = await import('./graphics-viewer.js');
        ({ updateGraphicsViewer } = initGraphicsViewer({
            readMemory,
            getMemoryInfo,
            getRegion: (addr) => regionManager.get(addr),
            addRegion: (region) => regionManager.add(region),
            getAllRegions: () => regionManager.getAll(),
            getRAMPage: (page) => spectrum.memory.ram[page],
            isRunning: () => spectrum.isRunning(),
            showMessage,
            goToAddress,
            goToMemoryAddress,
            updateDebugger,
            openOcrExtractDialog
        }));
        updateGraphicsViewer();
    }

    // Text Ripper / OCR (lazy-loaded from ui/text-ripper.js)
    let textRipperLoaded = false;
    let textRipperLoading = false;
    let textRipperApi = null;

    async function ensureTextRipper() {
        if (textRipperLoaded) return;
        if (textRipperLoading) return;
        textRipperLoading = true;
        const { initTextRipper } = await import('./text-ripper.js');
        textRipperApi = initTextRipper({
            readMemory,
            getRAMPage: (page) => spectrum.memory.ram[page],
            showMessage,
            downloadFile
        });
        textRipperLoaded = true;
    }

    async function openOcrExtractDialog(address, bank) {
        await ensureTextRipper();
        if (textRipperApi) textRipperApi.openExtractDialog(address, bank);
    }

    const regionManager = new RegionManager();
    const labelManager = new LabelManager();

    const commentManager = new CommentManager();

    const operandFormatManager = new OperandFormatManager();

    const xrefManager = new XRefManager();

    const subroutineManager = new SubroutineManager();

    const foldManager = new FoldManager();

    const undoManager = new UndoManager();
    undoManager.onChange = () => {
        if (undoManager.lastAction) {
            updateDebugger();
            showMessage(`${undoManager.lastAction.type === 'undo' ? 'Undo' : 'Redo'}: ${undoManager.lastAction.description}`);
            undoManager.lastAction = null;
        }
    };

    const traceManager = new TraceManager();

    const gameMapper = new GameMapper();

    const signaturePackManager = new SignaturePackManager();
    signaturePackManager.setAssembler(Assembler, VFS);

    let testRunner = null;

    // Navigation History (extracted to ui/nav-history.js)
    // Trampoline: goToAddressNoHistory comes from initPanelNavigator (initialized later)
    let _goToAddressNoHistory = null;
    const { navPushHistory, navBack, navForward, updateNavButtons, getLeftHistory, getRightHistory } = initNavHistory({
        goToAddressNoHistory: (addr, panel) => _goToAddressNoHistory(addr, panel)
    });

    // ROM Selector (extracted to ui/rom-selector.js)
    const { romData, loadRomsForMachineType, applyRomsToEmulator, initializeEmulator, tryLoadRomsFromDirectory, loadRomFile, updateRomStatus, showRomModal, isRomModalVisible, loadRomForMachineById, getRomFileName } = initRomSelector({
        getSpectrum: () => spectrum,
        getShowMessage: () => showMessage,
        labelManager,
        getMachineProfile,
        MACHINE_PROFILES,
        getDisplayAPI: () => displayAPI,
        getUpdateBetaDiskStatus: () => updateBetaDiskStatus,
        getUpdatePlusDStatus: () => updatePlusDStatus,
        getUpdateIF1Status: () => updateIF1Status,
        getUpdateRomFileNames: () => updateRomFileNames,
        getUpdateDriveSelector: () => updateDriveSelector
    });

    // UI Elements
    let displayAPI;  // Assigned later by initDisplaySettings()
    const canvas = document.getElementById('screen');
    const overlayCanvas = document.getElementById('overlayCanvas');

    const btnReset = document.getElementById('btnReset');
    const loadSelect = document.getElementById('loadSelect');
    const saveSelect = document.getElementById('saveSelect');
    const machineSelect = document.getElementById('machineSelect');
    const speedSelect = document.getElementById('speedSelect');
    const borderSizeSelect = document.getElementById('borderSizeSelect');
    const chkSound = document.getElementById('chkSound');
    const chkAY48k = document.getElementById('chkAY48k');
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    const stereoMode = document.getElementById('stereoMode');
    const btnFullscreen = document.getElementById('btnFullscreen');
    const fullscreenMode = document.getElementById('fullscreenMode');
    // Forward declarations for file-loader (assigned by initFileLoader below)
    let handleLoadResult, updateMediaIndicator, updateDriveSelector, getSelectedDriveIndex;

    // Machine Dropdown & Settings (extracted to ui/machine-selector.js)
    const { updateRomFileNames } = initMachineSelector({
        MACHINE_PROFILES, getMachineTypes, DEFAULT_VISIBLE_MACHINES,
        getLoadRomForMachineById: () => loadRomForMachineById,
        getGetRomFileName: () => getRomFileName
    });

    // Status display (extracted to ui/status-display.js)
    const { showMessage, updateStatus, updateRZXStatus, setUpdateDebugger } = initStatusDisplay({
        getSpectrum: () => spectrum,
        getIsDebuggerVisible: () => isDebuggerVisible()
    });
    // Late-bind updateDebugger (defined below as function declaration, hoisted)
    setUpdateDebugger(() => updateDebugger());

    // Zoom controls and theme toggle (extracted to ui/canvas-zoom.js)
    const { updateCanvasSize, setZoom, getCurrentZoom, setOnZoomChange, isDarkTheme, setDarkTheme, setUiScale, getUiScale } = initCanvasZoom({
        getSpectrum: () => spectrum,
        getUpdateSpriteRegionPreview: () => typeof updateSpriteRegionPreview === 'function' ? updateSpriteRegionPreview : null
    });

    // Signature Packs UI (extracted to ui/signature-packs-ui.js)
    initSignaturePacksUI({
        signaturePackManager, labelManager, regionManager,
        getSpectrum: () => spectrum,
        ZipLoader, showMessage, updateDebugger
    });

    // Create emulator
    const savedMachineType = storageGet('zxm8_machine', '48k');
    let spectrum = new Spectrum(canvas, {
        machineType: savedMachineType,
        tapeTrapsEnabled: true,
        overlayCanvas: overlayCanvas
    });
    window.spectrum = spectrum;

    // ========== Rewind ==========
    // A ring of recent machine states so a mistake costs seconds, not a reload.
    // States are ordinary SZX snapshots, so a rewind point is exactly a quickload;
    // saveSnapshot/loadSZXSnapshot are synchronous, which the frame loop needs.
    const REWIND_KEY = 'zxm8_rewind';
    const rewind = createRewindBuffer({
        capture: () => spectrum.saveSnapshot('szx'),
        restore: (data) => spectrum.loadSZXSnapshot(data),
        intervalFrames: 100,          // ~2s
        maxStates: 30,                // ~60s
    });
    rewind.setEnabled(storageGet(REWIND_KEY, '1') !== '0');
    spectrum.addFrameListener(() => rewind.onFrame(spectrum.totalFrames));

    // Stepping stays in "scrubbing" mode briefly, so several taps walk further
    // back; the abandoned future is dropped once the user settles.
    let rewindSettle = null;
    function rewindStep(back) {
        if (!rewind.enabled) { showMessage('Rewind is off (Settings → Display)'); return; }
        const moved = back ? rewind.stepBack() : rewind.stepForward();
        if (!moved) {
            showMessage(back ? 'No more rewind history' : 'Already at the present');
        } else {
            updateCanvasSize();
            showMessage(`Rewind ${rewind.depth * 2}s`);
        }
        if (rewindSettle) clearTimeout(rewindSettle);
        rewindSettle = setTimeout(() => { rewind.resume(); rewindSettle = null; }, 1200);
    }
    window.zxRewind = { step: rewindStep, buffer: rewind };

    // A scripted key press that names nothing is a no-op that hides itself: the
    // run continues, the chord never happened, and the result gets explained some
    // other way. So the automation API refuses the name instead — and, since the
    // usual mistake is writing a chord as one string ('caps space'), it says which
    // keys it did recognise in what was passed.
    function assertZXKey(what, key) {
        const ula = spectrum.ula;
        if (ula.hasKey(key)) return;
        const parts = String(key == null ? '' : key).split(/[\s+,]+/).filter(Boolean);
        const named = parts.length > 1 ? parts.map(p => ula.resolveKeyName(p)) : [];
        const hint = named.length && named.every(Boolean)
            ? ` — a chord is one call per key: ${named.map(n => `zxDebug.${what}('${n}')`).join('; ')}`
            : ' — see zxDebug.keyNames()';
        throw new Error(`zxDebug.${what}: no ZX key named '${key}'${hint}`);
    }

    // Stepping, running-to and breakpoints all bail out of the core with a bare
    // `false` while the machine is running. To a driver that reads as "it did
    // nothing and did not say why" — the same silent-no-op trap as an unknown key
    // name — so name the fix instead.
    function requireStopped(what) {
        if (spectrum.running) {
            throw new Error(`zxDebug.${what}: the machine is running — call zxDebug.pause() first ` +
                            `(or use runFrames() to advance it while it runs)`);
        }
        if (!spectrum.romLoaded) {
            throw new Error(`zxDebug.${what}: no ROM loaded — await zxDebug.ready() first`);
        }
    }

    // Bytes, or hex text with `?`/`??` for any byte. A null in the result means
    // "match anything here".
    function parseBytePattern(pattern) {
        if (Array.isArray(pattern) || pattern instanceof Uint8Array) {
            return Array.from(pattern, b => (b === null ? null : b & 0xFF));
        }
        if (typeof pattern !== 'string') return null;
        const out = [];
        for (const tok of pattern.trim().split(/[\s,]+/).filter(Boolean)) {
            if (tok === '?' || tok === '??') { out.push(null); continue; }
            if (!/^[0-9a-fA-F]{2}$/.test(tok)) return null;
            out.push(parseInt(tok, 16));
        }
        return out.length ? out : null;
    }

    // ========== Headless automation API (window.zxDebug) ==========
    // A documented, stable surface for external drivers (the ZX-disasm skill)
    // so they don't reach into emulator internals (which the planned Spectrum
    // refactor would break). Covers the execution map, the debug managers, the
    // disassembly-toolchain exporters, and write provenance. See docs/automation.md.
    window.zxDebug = {
        version: APP_VERSION,
        // ========== What this build has ==========
        //
        // Tools kept reimplementing what the emulator already did, because nothing
        // told them what was there — and a document cannot, since a driver talks
        // to whatever build is deployed rather than to the docs someone read once.
        // So ask: `capabilities()` is the whole surface, declared in
        // core/api-manifest.js and kept honest by tests/api-manifest-test.html.
        capabilities() {
            return buildCapabilities(APP_VERSION, (name) => name in window.zxDebug);
        },
        // The one call to give an external tool: "await zxDebug.brief()".
        //
        // Everything a driver needs in one string — the rules that cannot be
        // discovered from the API, then the whole surface of *this* build. Meant
        // to be read, logged, or handed straight to a model as context.
        //
        // The rules are fetched from M8XXX.md rather than kept here, so
        // there is one copy of them; the API half is generated, so it cannot go
        // stale. If the fetch fails the API half still comes back, with a line
        // saying which half is missing — a silently half-answer would be worse
        // than either.
        async brief() {
            const api = window.zxDebug.help();
            let rules = '';
            try {
                const url = new URL('M8XXX.md', document.baseURI).href;
                const res = await fetch(url, { cache: 'no-store' });
                if (res.ok) rules = (await res.text()).trim();
                else rules = `<!-- M8XXX.md returned ${res.status}: the rules are ` +
                             `not included below, only the API surface -->`;
            } catch (e) {
                rules = `<!-- M8XXX.md could not be read (${e.message}): the rules ` +
                        `are not included below, only the API surface -->`;
            }
            return `${rules}\n\n---\n\n${api}`;
        },
        // One line of prose for one member, or the whole lot as markdown — which
        // is the form to hand to a model driving this.
        help(name) {
            if (!name) {
                const caps = buildCapabilities(APP_VERSION, (n) => n in window.zxDebug);
                const byCat = new Map();
                for (const m of caps.members) {
                    if (!byCat.has(m.category)) byCat.set(m.category, []);
                    byCat.get(m.category).push(m);
                }
                let out = `# zxDebug — ZX-M8XXX ${APP_VERSION} (api ${caps.apiVersion})\n`;
                for (const [cat, members] of byCat) {
                    out += `\n## ${cat} — ${caps.categories[cat] || ''}\n\n`;
                    for (const m of members) out += `- \`${m.sig}\` — ${m.summary}\n`;
                }
                return out;
            }
            const entry = API[name];
            if (!entry) return `zxDebug has nothing called "${name}". capabilities() lists what it has.`;
            return `${entry.sig}\n${entry.summary}` + (entry.since ? `\n(since ${entry.since})` : '');
        },
        // Fail at startup with one clear error, rather than working around a gap
        // and growing a second implementation of something that is already here.
        require(names) {
            return checkRequired(Array.isArray(names) ? names : [names],
                                 APP_VERSION, (n) => n in window.zxDebug);
        },
        get apiVersion() { return API_VERSION; },

        get spectrum() { return spectrum; },
        // The application test runner (tests/tests.json), wired with the same
        // loaders and callbacks the Tools → Tests tab uses. Null until init has
        // built it. Lets a harness run one entry — `runSingleTest(test)` — and
        // capture what it drew, which is how the reference screens are made.
        get testRunner() { return testRunner; },

        // ---- Readiness ----
        // The page fetches its ROMs asynchronously at startup. A driver that
        // grabs `spectrum` and starts running before they land executes a blank
        // $0000-$3FFF: every ROM call and RST vector is a NOP sled, the game
        // wanders off, and nothing on screen moves — which looks like a much
        // deeper problem than "the ROM isn't in yet". Await this first.
        //
        //   await zxDebug.ready();                 // current machine
        //   await zxDebug.ready({ machine: '128k' });
        //
        // Resolves { machineType, romLoaded, running } once the machine's ROM is
        // actually in memory; rejects on timeout rather than hanging.
        async ready({ machine = null, timeoutMs = 15000, pollMs = 25 } = {}) {
            if (machine && spectrum.machineType !== machine) {
                await this.ensureRom(machine);   // so the selector's ROM check passes
                // Drive the real selector so every side effect (paging, palette,
                // canvas, reset) matches a user switch. Machines hidden from the
                // dropdown aren't selectable that way, so fall back to the core.
                machineSelect.value = machine;
                if (machineSelect.value === machine) {
                    machineSelect.dispatchEvent(new Event('change'));
                } else {
                    spectrum.setMachineType(machine);
                    applyRomsToEmulator();
                    spectrum.reset();
                }
            }
            const deadline = Date.now() + timeoutMs;
            let triedLoad = false;
            for (;;) {
                // ROM present? byte 0 of a Spectrum ROM is DI ($F3); a blank
                // (unloaded) ROM area reads back as $00.
                const romIn = spectrum.romLoaded && spectrum.memory.read(0) !== 0x00;
                if (romIn) {
                    return {
                        machineType: spectrum.machineType,
                        romLoaded: true,
                        running: spectrum.isRunning ? spectrum.isRunning() : !!spectrum.running,
                    };
                }
                if (!triedLoad && Date.now() > deadline - timeoutMs / 2) {
                    // Startup fetch may have failed (or never ran) — try once here
                    triedLoad = true;
                    try { await this.ensureRom(spectrum.machineType); } catch (e) { /* report below */ }
                }
                if (Date.now() > deadline) {
                    throw new Error(
                        `zxDebug.ready: no ROM for '${spectrum.machineType}' after ${timeoutMs} ms — ` +
                        `is roms/${getMachineProfile(spectrum.machineType).romFile} being served?`);
                }
                await new Promise(r => setTimeout(r, pollMs));
            }
        },

        // Load a machine's ROM file if it isn't loaded yet, and page it in when
        // it belongs to the current machine. Returns true if the ROM is present.
        async ensureRom(machineType = spectrum.machineType) {
            const profile = getMachineProfile(machineType);
            if (!profile) throw new Error(`Unknown machine: ${machineType}`);
            if (!romData[profile.romFile]) {
                const res = await fetch('roms/' + profile.romFile);
                if (!res.ok) {
                    throw new Error(`roms/${profile.romFile} not available (HTTP ${res.status})`);
                }
                romData[profile.romFile] = await res.arrayBuffer();
            }
            if (machineType === spectrum.machineType) {
                loadRomsForMachineType(spectrum, machineType);
            }
            return !!romData[profile.romFile];
        },

        // Debug managers (read or add labels / regions / comments / xrefs)
        labels: labelManager,
        regions: regionManager,
        comments: commentManager,
        xrefs: xrefManager,

        // ---- Execution-based code/data map ----
        // enableMap(true, {fast:true})        → cheap flat touched-bitsets for long RZX;
        // enableMap(true, {fast:true,paged:true}) → per-page touched-bitsets (bank-switch
        //                                        correct — banks don't union together);
        // fast omitted → the rich Map<key,count> (per-address counts + pages).
        enableMap(on = true, { fast = false, paged = false } = {}) {
            spectrum.setAutoMapFast(fast || paged, paged);
            spectrum.setAutoMapEnabled(on);
        },
        clearMap() { spectrum.clearAutoMap(); },
        mapData() { return spectrum.getAutoMapData(); },   // rich mode Maps
        mapBits() { return spectrum.getAutoMapBits(); },   // fast mode Uint8Arrays (+ paged/pagedBits)

        // Coalesced { ranges:[{start,end,type}], pages } from the active mode.
        // In paged fast mode the result also carries `byPage` (per-page ranges).
        ranges(opts = {}) {
            const o = { readByte: (a) => spectrum.memory.read(a), ...opts };
            if (spectrum.autoMap.paged) return buildRangesFromPagedBits(spectrum.autoMap.pagedBits, o);
            return spectrum.autoMap.fast
                ? buildRangesFromBits(spectrum.getAutoMapBits(), o)
                : buildRanges(spectrum.getAutoMapData(), o);
        },
        // Per-page coalesced ranges { [pageLabel]: { ranges, pages } } — only
        // meaningful in paged fast mode (empty object otherwise).
        rangesByPage(opts = {}) {
            const o = { readByte: (a) => spectrum.memory.read(a), ...opts };
            if (!spectrum.autoMap.paged) return {};
            return buildRangesFromPagedBits(spectrum.autoMap.pagedBits, o).byPage;
        },

        // ---- Disassembly-toolchain exports (strings; wired to live managers) ----
        exportCtl(opts = {}) {
            const { ranges, pages } = this.ranges();
            return exportCtl({
                ranges, pages,
                regions: regionManager.getAll(),
                labels: labelManager.getAll(),
                comments: commentManager.getAll(),
                readByte: (a) => spectrum.memory.read(a),
                ...opts
            });
        },
        exportCsv() {
            return exportGhidraCsv({ labels: labelManager.getAll(), comments: commentManager.getAll() });
        },
        exportSym() {
            return exportSym({ labels: labelManager.getAll() });
        },

        // ---- Write provenance (which instruction writes into a range) ----
        // Replaces hand-wrapping the memory write callback. watchWrites → run
        // frames / replay an RZX → getWrites() returns [{pc,count,callers}].
        watchWrites(lo, hi) { spectrum.startWriteProvenance(lo, hi); },
        getWrites() { return spectrum.getWriteProvenance(); },
        stopWrites() { return spectrum.stopWriteProvenance(); },

        // Who READS a block (classify an unreferenced data block by its consumer)
        // and what EXECUTES inside a range (is this block code, and who calls it).
        // Same shape as the write side: [{pc, count, callers:[addr]}].
        // For reads, `pc` is the reading instruction; for exec it's the executed
        // address itself. Both only do work in-range, so an RZX replay is fine.
        watchReads(lo, hi) { spectrum.startReadProvenance(lo, hi); },
        getReads() { return spectrum.getReadProvenance(); },
        stopReads() { return spectrum.stopReadProvenance(); },
        watchExec(lo, hi) { spectrum.startExecProvenance(lo, hi); },
        getExec() { return spectrum.getExecProvenance(); },
        stopExec() { return spectrum.stopExecProvenance(); },

        // ---- Call a routine directly ----
        // For effects normally reachable only through menus or movement the
        // harness can't drive: set the registers, call the routine, read what it
        // changed. Instead of poking a HALT sentinel and pumping frames by hand,
        // this pushes a return marker, runs instructions until the routine returns
        // to it, and restores the CPU state afterwards.
        //
        //   const r = zxDebug.callRoutine(0x8F20, { regs: { a: 3, hl: 0x5C00 } });
        //   // r = { returned, halted, steps, regs:{...}, tStates }
        //
        // Notes: interrupts are off during the call (deterministic, and the ISR
        // can't disturb the routine) unless you pass `interrupts: true`. The
        // routine is stepped through the CPU directly, which read/write/exec
        // provenance still sees, but auto-map does not (it only records inside
        // runFrame) — pass `frames: true` when you want it mapped, or when the
        // routine waits for an interrupt. Trust the state you peek afterwards over
        // `returned`: a print or pause tail may not complete, but state changes
        // land before it.
        callRoutine(addr, { regs = {}, sp = null, maxSteps = 5000000,
                            interrupts = false, frames = false, maxFrames = 600 } = {}) {
            const cpu = spectrum.cpu;
            const saved = {};
            for (const k of ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'ix', 'iy', 'sp', 'pc',
                             'iff1', 'iff2', 'halted']) saved[k] = cpu[k];

            // A return marker the routine can't plausibly execute: RET lands on it,
            // and we stop before executing anything there.
            const MARKER = 0xFFFF;
            const set16 = (name, v) => {
                if (v === undefined) return;
                if (name === 'bc') { cpu.b = (v >> 8) & 0xFF; cpu.c = v & 0xFF; }
                else if (name === 'de') { cpu.d = (v >> 8) & 0xFF; cpu.e = v & 0xFF; }
                else if (name === 'hl') { cpu.h = (v >> 8) & 0xFF; cpu.l = v & 0xFF; }
                else if (name === 'af') { cpu.a = (v >> 8) & 0xFF; cpu.f = v & 0xFF; }
                else cpu[name] = v;
            };
            try {
                if (sp !== null) cpu.sp = sp & 0xFFFF;
                for (const [k, v] of Object.entries(regs)) {
                    if (['bc', 'de', 'hl', 'af', 'ix', 'iy', 'sp'].includes(k)) set16(k, v);
                    else cpu[k] = v;
                }
                // Push the marker as the return address
                cpu.sp = (cpu.sp - 2) & 0xFFFF;
                spectrum.memory.write(cpu.sp, MARKER & 0xFF);
                spectrum.memory.write((cpu.sp + 1) & 0xFFFF, (MARKER >> 8) & 0xFF);
                if (!interrupts) { cpu.iff1 = false; cpu.iff2 = false; }
                cpu.halted = false;
                cpu.pc = addr & 0xFFFF;

                const t0 = cpu.tStates;
                let steps = 0, returned = false;
                if (frames) {
                    for (let f = 0; f < maxFrames; f++) {
                        spectrum.runFrame();
                        if (cpu.pc === MARKER || cpu.halted) { returned = cpu.pc === MARKER; break; }
                    }
                } else {
                    while (steps < maxSteps) {
                        if (cpu.pc === MARKER) { returned = true; break; }
                        if (cpu.halted) break;
                        // Keep the "which instruction did this" marker current, so
                        // read/write provenance attributes accesses to the right
                        // instruction here too (runFrame normally maintains it).
                        spectrum._currentInstrPC = cpu.pc;
                        cpu.step();
                        steps++;
                    }
                }
                const result = {
                    returned,
                    halted: !!cpu.halted,
                    steps,
                    tStates: cpu.tStates - t0,
                    regs: {
                        a: cpu.a, f: cpu.f,
                        bc: (cpu.b << 8) | cpu.c, de: (cpu.d << 8) | cpu.e,
                        hl: (cpu.h << 8) | cpu.l, ix: cpu.ix, iy: cpu.iy,
                    },
                };
                if (!returned && !result.halted) {
                    result.timedOut = true;   // budget ran out — not a wrong answer
                }
                return result;
            } finally {
                for (const k of Object.keys(saved)) cpu[k] = saved[k];
            }
        },

        // ---- Resolved indirect jumps (JP (HL)/(IX)/(IY) dispatch targets) ----
        // The edges Ghidra can't recover. watchIndirect → run frames / replay
        // an RZX → getIndirect() = [{site,kind,targets:[{target,count}]}];
        // exportIndirectCsv() → Ghidra address,name,comment (one row per site).
        watchIndirect() { spectrum.startIndirectJumps(); },
        getIndirect() { return spectrum.getIndirectJumps(); },
        stopIndirect() { return spectrum.stopIndirectJumps(); },
        exportIndirectCsv() { return exportIndirectCsv(spectrum.getIndirectJumps()); },

        // ---- Self-modifying code (executed AND written at runtime) ----
        // Computed from the active auto-map (fast bitsets or rich Maps).
        getSmc() {
            if (spectrum.autoMap.paged) {
                // Intersect exec∩write PER PAGE (unioning first would falsely pair
                // exec in one bank with a write to another at the same address),
                // then coalesce the per-page ranges into one sorted list.
                const all = [];
                for (const t of spectrum.autoMap.pagedBits.values()) {
                    for (const r of findSmcRanges(t.execBits, t.writeBits)) all.push(r);
                }
                all.sort((a, b) => a.start - b.start);
                const out = [];
                for (const r of all) {
                    const last = out[out.length - 1];
                    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
                    else out.push({ ...r });
                }
                return out;
            }
            if (spectrum.autoMap.fast) {
                const b = spectrum.getAutoMapBits();
                return findSmcRanges(b.execBits, b.writeBits);
            }
            const m = spectrum.getAutoMapData();
            return findSmcRanges(m.executed, m.written);
        },
        exportSmcCsv() { return exportSmcCsv(this.getSmc()); },

        // ---- Runtime call graph (observed CALL/RST edges) ----
        // watchCalls → run frames / replay an RZX → getCalls() =
        // [{caller, callees:[{callee,count}]}]; exportCallGraphCsv() is
        // callee-indexed ("who calls this") for the naming workflow.
        watchCalls() { spectrum.startCallGraph(); },
        getCalls() { return spectrum.getCallGraph(); },
        stopCalls() { return spectrum.stopCallGraph(); },
        exportCallGraphCsv() { return exportCallGraphCsv(spectrum.getCallGraph()); },

        // ---- Raw access hooks (custom recorders) ----
        // Register callbacks fired on every opcode fetch / memory read / write,
        // without enabling a monitor and without wrapping the managed cpu.onFetch
        // (which is null unless a feature needs it). Fetch gets (addr); read/write
        // get (addr, val). Inside a hook read spectrum state synchronously — e.g.
        // spectrum.memory.currentRamBank for per-page coverage. Returns a disposer.
        onAccess(hooks = {}) {
            spectrum.setAccessHooks(hooks);
            return () => spectrum.clearAccessHooks();
        },
        offAccess() { spectrum.clearAccessHooks(); },

        // ---- Checkpointing (survives --virtual-time-budget / a killed run) ----
        // Under headless Edge --virtual-time-budget the real clock freezes
        // (Date.now/performance.now read ~0) and --dump-dom only emits on process
        // exit, so a killed long run loses everything. checkpoint() writes the
        // latest progress into a hidden DOM node (#zxDebugCheckpoint) the harness
        // can poll mid-run (DevTools) or recover from the final --dump-dom.
        // emuClock() gives an emulated-time estimate (frame/T-state based) since
        // the wall clock is unavailable.
        emuClock() {
            const tpf = (spectrum.timing && spectrum.timing.tstatesPerFrame) || 69888;
            const hz = spectrum.cpuClock || 3500000;
            const tStates = spectrum.totalFrames * tpf + (spectrum.cpu ? spectrum.cpu.tStates : 0);
            return { frames: spectrum.totalFrames, tStates, seconds: tStates / hz };
        },
        // Hand a result (or progress) back to whoever launched the browser, by
        // posting it to serve.py's sink — `--dump-dom` only prints at exit, so a
        // long run otherwise has no way to report anything until it finishes.
        //   await zxDebug.report({ ranges }, 'result');   -> headless/result.json
        //   await zxDebug.report(state, 'progress');      -> headless/progress.json
        //   await zxDebug.report(x, 'result', 'venom')    -> headless/venom.json
        async report(data, kind = 'result', name = null) {
            const clk = this.emuClock();
            const body = JSON.stringify({ kind, frames: clk.frames, seconds: clk.seconds, data });
            const url = '/' + (kind === 'progress' ? 'progress' : 'result') +
                        (name ? '?name=' + encodeURIComponent(name) : '');
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            if (!res.ok) {
                throw new Error(`report failed: HTTP ${res.status} — is this served by serve.py?`);
            }
            return res.json();
        },

        checkpoint(data) {
            let el = document.getElementById('zxDebugCheckpoint');
            if (!el) {
                el = document.createElement('div');
                el.id = 'zxDebugCheckpoint';
                el.style.display = 'none';
                document.body.appendChild(el);
            }
            const clk = this.emuClock();
            this._cpSeq = (this._cpSeq || 0) + 1;
            const payload = { seq: this._cpSeq, frames: clk.frames, tStates: clk.tStates, seconds: clk.seconds, data };
            el.textContent = JSON.stringify(payload);
            return payload;
        },
        getCheckpoint() {
            const el = document.getElementById('zxDebugCheckpoint');
            if (!el || !el.textContent) return null;
            try { return JSON.parse(el.textContent); } catch (e) { return null; }
        },

        // ---- RZX replay (headless drivers) ----
        // One call: load the RZX, play to its true end, resolve when done.
        // No hand-rolled frame loop and no need to know the frame count — the
        // loop is bounded by rzxPlaying (now that playback terminates correctly)
        // with maxFrames only as a safety backstop (default = length + 16).
        // onProgress(frame, total) fires every progressEvery frames; a checkpoint
        // is also emitted at each tick and at the end, so a killed replay leaves
        // its last position recoverable.
        async replayRZX(fileOrBytes, { onProgress, maxFrames, progressEvery = 1000, headless = true } = {}) {
            const bytes = (fileOrBytes instanceof File)
                ? new Uint8Array(await fileOrBytes.arrayBuffer())
                : fileOrBytes;
            const info = await spectrum.loadRZX(bytes);
            const total = info.frames;
            const cap = (maxFrames == null) ? total + 16 : maxFrames;
            const step = (headless && spectrum.runFrameHeadless)
                ? () => spectrum.runFrameHeadless()
                : () => spectrum.runFrame();
            let played = 0;
            while (spectrum.isRZXPlaying() && played < cap) {
                step();
                played++;
                if (played % progressEvery === 0) {
                    const fr = spectrum.getRZXFrame();
                    if (onProgress) onProgress(fr, total);
                    this.checkpoint({ phase: 'replayRZX', rzxFrame: fr, rzxTotal: total, played });
                }
            }
            const result = { frames: total, played, atEnd: !spectrum.isRZXPlaying() };
            this.checkpoint({ phase: 'replayRZX', done: true, ...result });
            return result;
        },
        get rzxPlaying() { return spectrum.isRZXPlaying(); },
        get rzxFrame() { return spectrum.getRZXFrame(); },
        get rzxFrameCount() { return spectrum.getRZXTotalFrames(); },

        // ---- Convenience ----
        runFrames(n) { for (let i = 0; i < n; i++) spectrum.runFrame(); },

        // ========== Primitives ==========
        //
        // The plain operations a driver needs constantly: read and write memory,
        // find bytes in it, disassemble it, and step through it. All of this was
        // inside the app already; none of it was reachable except through
        // `zxDebug.spectrum`, so every tool that wanted to peek a byte reached
        // into emulator internals — the exact thing this API exists to avoid, and
        // the thing a Spectrum refactor would break underneath them.

        // --- memory ---
        // Through the *current* paging, as the CPU sees it
        peek(addr) { return spectrum.memory.read(addr & 0xFFFF); },
        poke(addr, value) { spectrum.memory.write(addr & 0xFFFF, value & 0xFF); },
        peekWord(addr) {
            return spectrum.memory.read(addr & 0xFFFF) |
                   (spectrum.memory.read((addr + 1) & 0xFFFF) << 8);
        },
        pokeWord(addr, value) {
            spectrum.memory.write(addr & 0xFFFF, value & 0xFF);
            spectrum.memory.write((addr + 1) & 0xFFFF, (value >> 8) & 0xFF);
        },
        peekBlock(addr, length) {
            const out = new Uint8Array(Math.max(0, length | 0));
            for (let i = 0; i < out.length; i++) out[i] = spectrum.memory.read((addr + i) & 0xFFFF);
            return out;
        },
        pokeBlock(addr, bytes) {
            const src = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
            for (let i = 0; i < src.length; i++) spectrum.memory.write((addr + i) & 0xFFFF, src[i]);
            return src.length;
        },
        // A whole RAM bank regardless of what is paged in — null if the machine
        // hasn't got one by that number
        peekBank(bank) {
            const b = spectrum.memory.getRamBank(bank);
            return b ? new Uint8Array(b) : null;
        },

        // --- search ---
        // `pattern` is bytes, or hex text ("CD ?? 00", `?`/`??` matching any byte).
        // Capped by `limit`: a one-byte needle matches hundreds of times, and a
        // list that long is not an answer.
        findBytes(pattern, { from = 0, to = 0x10000, limit = 200, bank = null } = {}) {
            const pat = parseBytePattern(pattern);
            if (!pat) throw new Error('findBytes: pattern must be bytes or hex text like "CD ?? 00"');
            const data = bank === null ? null : spectrum.memory.getRamBank(bank);
            if (bank !== null && !data) throw new Error('findBytes: this machine has no RAM bank ' + bank);
            const read = data ? (a) => data[a] : (a) => spectrum.memory.read(a & 0xFFFF);
            const end = Math.min(to, data ? data.length : 0x10000) - pat.length;
            const hits = [];
            for (let a = Math.max(0, from); a <= end && hits.length < limit; a++) {
                let ok = true;
                for (let i = 0; i < pat.length; i++) {
                    if (pat[i] !== null && read(a + i) !== pat[i]) { ok = false; break; }
                }
                if (ok) hits.push(a);
            }
            return hits;
        },
        findWord(value, opts = {}) {
            return window.zxDebug.findBytes([value & 0xFF, (value >> 8) & 0xFF], opts);
        },

        // --- disassembly ---
        // [{addr, bytes, text, length}] — the reading of it. The exportCtl/Csv/Sym
        // calls are for handing a map to another toolchain, not for reading here.
        disassemble(addr, count = 1) {
            const d = disasm || new Disassembler(spectrum.memory);
            const out = [];
            let a = addr & 0xFFFF;
            for (let i = 0; i < count; i++) {
                const r = d.disassemble(a);
                const len = r.length || (r.bytes ? r.bytes.length : 1);
                out.push({ addr: a, bytes: Array.from(r.bytes || []), text: r.mnemonic, length: len });
                a = (a + len) & 0xFFFF;
            }
            return out;
        },
        disassembleRange(from, to) {
            const d = disasm || new Disassembler(spectrum.memory);
            const out = [];
            let a = from & 0xFFFF;
            while (a < to && out.length < 100000) {
                const r = d.disassemble(a);
                const len = r.length || (r.bytes ? r.bytes.length : 1);
                out.push({ addr: a, bytes: Array.from(r.bytes || []), text: r.mnemonic, length: len });
                a += len;
            }
            return out;
        },

        // --- execution control ---
        pause() { if (spectrum.running) spectrum.stop(); return !spectrum.running; },
        resume() { if (!spectrum.running) spectrum.start(); return spectrum.running; },
        get paused() { return !spectrum.running; },

        step(n = 1) {
            requireStopped('step');
            let done = 0;
            for (let i = 0; i < n; i++) { if (spectrum.stepInto() === false) break; done++; }
            return { steps: done, pc: spectrum.cpu.pc };
        },
        stepOver(maxCycles) {
            requireStopped('stepOver');
            const r = spectrum.stepOver(maxCycles) || {};
            return { ...r, pc: spectrum.cpu.pc };
        },
        runTo(addr, maxCycles) {
            requireStopped('runTo');
            const reached = spectrum.runToAddress(addr & 0xFFFF, maxCycles);
            return { reached: !!reached, pc: spectrum.cpu.pc };
        },
        runToInterrupt(maxCycles) {
            requireStopped('runToInterrupt');
            return { reached: !!spectrum.runToInterrupt(maxCycles), pc: spectrum.cpu.pc };
        },
        runToRet(maxCycles) {
            requireStopped('runToRet');
            return { reached: !!spectrum.runToRet(maxCycles), pc: spectrum.cpu.pc };
        },

        // --- breakpoints ---
        // A number, or an address spec the app understands ("8000", "8000-80FF")
        addBreakpoint(spec) { return spectrum.addBreakpoint(spec) !== false; },
        removeBreakpoint(index) { return spectrum.removeBreakpoint(index); },
        clearBreakpoints() { spectrum.clearBreakpoints(); },
        breakpoints() {
            return spectrum.triggers
                .filter(t => t.type === 'exec')
                .map(t => ({ start: t.start, end: t.end, page: t.page, enabled: t.enabled }));
        },

        // --- registers ---
        setRegisters(regs) {
            const c = spectrum.cpu;
            const pairs = { bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'] };
            for (const [k, v] of Object.entries(regs || {})) {
                if (pairs[k]) { c[pairs[k][0]] = (v >> 8) & 0xFF; c[pairs[k][1]] = v & 0xFF; }
                else if (k in c) c[k] = v;
                else throw new Error('setRegisters: no register named "' + k + '"');
            }
            return window.zxDebug.captureRegisters();
        },

        // Type into the running machine, frame by frame — for the programs that ask
        // a question before they do anything (Woodmass' Snow Contention prompts for
        // a T-state with INPUT, and sat in the ROM's key wait looking exactly like a
        // failed auto-load). `\n` is ENTER. Frames are pumped here, so this works
        // while the emulator is stopped, which is how a headless run drives it.
        // Hold and gap are in frames: the ROM samples the keyboard once per
        // interrupt, so anything shorter than a frame is never seen.
        typeText(text, { hold = 4, gap = 4 } = {}) {
            const ula = spectrum.ula;
            for (const ch of String(text)) {
                const key = (ch === '\n') ? 'Enter' : (ch === ' ' ? 'Space' : ch);
                ula.keyDown(key);
                for (let i = 0; i < hold; i++) spectrum.runFrame();
                ula.keyUp(key);
                for (let i = 0; i < gap; i++) spectrum.runFrame();
            }
            return { pc: spectrum.cpu.pc };
        },

        // Keyboard ghosting (Settings → Input). A headless driver holding several
        // keys reads the matrix through the same path, so this decides whether it
        // sees the phantom presses real hardware produces. Survives a machine
        // switch; returns the state so a run can log what it measured.
        setKeyboardGhosting(on) {
            spectrum.ula.setKeyboardGhosting(on);
            const chk = document.getElementById('chkKeyboardGhosting');
            if (chk) chk.checked = spectrum.ula.keyboardGhosting;
            return spectrum.ula.keyboardGhosting;
        },
        get keyboardGhosting() { return spectrum.ula.keyboardGhosting; },

        // Hold/release matrix keys without a DOM event (headless runs have no
        // real keyboard): names are the ULA's own, e.g. 'q', 'Enter', ' '.
        //
        // A name the ULA doesn't know **throws** here. The DOM path has to stay
        // quiet — the browser sends every key the PC has — but a scripted press
        // that silently does nothing is the worst kind of bug: the run carries on,
        // the chord was never pressed, and the result gets explained some other
        // way. A chord is one call per key, so 'CAPS SPACE' is two calls; the
        // message says so and names the keys it recognised in what you passed.
        keyDown(key) { assertZXKey('keyDown', key); return spectrum.ula.keyDown(key); },
        keyUp(key) { assertZXKey('keyUp', key); return spectrum.ula.keyUp(key); },

        // Every name the two above accept
        keyNames() { return spectrum.ula.keyNames(); },
        readKeyboardPort(port) { return spectrum.ula.readPort(port); },

        // Encoding-aware text search (core/encoded-search.js). Game text is very
        // often not stored as text, and a plaintext search reports the same
        // "nothing" whether the word is absent or merely enciphered — so this
        // tries the ladder: plain, complemented, XOR/offset by any key, the
        // position folded into the key, and nibble packing.
        //
        // `searchEncodedText` reads the paged 64K; `searchEncodedBytes` takes any
        // array, which is how a driver searches a file it has loaded rather than
        // run. Both return [{addr, encoding, key, label, length, text, note}].
        searchEncodedText(text, opts = {}) {
            const read = (a) => spectrum.memory.read(a & 0xffff);
            const from = opts.from | 0, to = opts.to === undefined ? 0x10000 : opts.to;
            const a = searchEncoded(read, from, to, text, opts);
            const b = opts.nibble === false ? { matches: [] }
                    : searchNibblePacked(read, from, to, text, opts);
            return a.matches.concat(b.matches).sort((x, y) => x.addr - y.addr);
        },
        searchEncodedBytes(bytes, text, opts = {}) {
            const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const read = (a) => data[a];
            const from = opts.from | 0, to = opts.to === undefined ? data.length : opts.to;
            const a = searchEncoded(read, from, to, text, opts);
            const b = opts.nibble === false ? { matches: [] }
                    : searchNibblePacked(read, from, to, text, opts);
            return a.matches.concat(b.matches).sort((x, y) => x.addr - y.addr);
        },
        // What the bytes at a hit say once the scheme is undone — the word is the
        // way in, the record around it is usually the point
        decodeEncoded(addr, encoding, key, length, startIndex = 0) {
            return decodeAt((a) => spectrum.memory.read(a & 0xffff), addr, encoding, key, length, startIndex);
        },
        decodeEncodedBytes(bytes, offset, encoding, key, length, startIndex = 0) {
            const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            return decodeAt((a) => data[a], offset, encoding, key, length, startIndex);
        },
        get encodings() { return ENCODINGS.map(e => ({ id: e.id, label: e.label, keys: e.keys })); },

        // Data-table recognisers (core/table-scan.js). Signature packs match code
        // byte patterns; these find tables by their shape, which is the only thing
        // a table has to be recognised by.
        //
        //   findKeyScanTables  (half-row, key bit) records — a game's controls
        //   findCharTables     runs of printable bytes of a key-table length
        //   findWordTables     fixed-record word tables (PAW/Quill vocabularies)
        //
        // `vocabularyByValue` is the reading that pays: the words in value order
        // with the outliers marked, which is how two cheat words numbered 200 and
        // 201 stand out of a table that otherwise runs 11, 57, 71.
        findKeyScanTables(from = 0x4000, to = 0x10000, opts = {}) {
            return findKeyScanTables((a) => spectrum.memory.read(a & 0xffff), from, to, opts);
        },
        findCharTables(from = 0x4000, to = 0x10000, opts = {}) {
            return findCharTables((a) => spectrum.memory.read(a & 0xffff), from, to, opts);
        },
        findWordTables(from = 0x4000, to = 0x10000, opts = {}) {
            return findWordTables((a) => spectrum.memory.read(a & 0xffff), from, to, opts);
        },
        vocabularyByValue(table, opts = {}) {
            const odd = new Set(tableOutliers(table, opts).map(e => e.addr));
            return tableByValue(table).map(e => ({ ...e, outlier: odd.has(e.addr) }));
        },

        // ========== Differential runs ==========
        //
        // Run the same thing twice with one variable changed and find where the
        // two runs stop agreeing. Code Path already answers "what did this run
        // reach that the other didn't" — a set difference — but a set has no
        // order, so it cannot say *where* they parted company. This records the
        // program counter in order and compares the two streams.
        //
        //   const a = await zx.recordRun(() => { ...; zx.runFrames(50); });
        //   // change the one variable
        //   const b = await zx.recordRun(() => { ...; zx.runFrames(50); });
        //   zx.compareRuns(a, b);
        //
        // Both runs must start from the same state for the comparison to mean
        // anything — restore the same snapshot before each, or the first
        // divergence is just wherever they happened to be different already.
        async recordRun(fn, opts = {}) {
            spectrum.startExecTrace(opts);
            let error = null;
            try { await fn(); } catch (e) { error = e; }
            const trace = spectrum.stopExecTrace();
            const memory = opts.memory === false ? null : window.zxDebug.snapshotMemory();
            const registers = window.zxDebug.captureRegisters();
            if (error) throw error;
            return { trace, memory, registers, tStates: spectrum.cpu.tStates };
        },

        // A flat copy of the paged 64K as it stands — what the run left behind
        snapshotMemory() {
            const out = new Uint8Array(0x10000);
            for (let a = 0; a < 0x10000; a++) out[a] = spectrum.memory.read(a);
            return out;
        },

        captureRegisters() {
            const c = spectrum.cpu;
            return {
                pc: c.pc, sp: c.sp, a: c.a, f: c.f,
                bc: (c.b << 8) | c.c, de: (c.d << 8) | c.e, hl: (c.h << 8) | c.l,
                ix: c.ix, iy: c.iy,
                a_: c.a_, f_: c.f_,
                bc_: (c.b_ << 8) | c.c_, de_: (c.d_ << 8) | c.e_, hl_: (c.h_ << 8) | c.l_,
                i: c.i, r: c.r, im: c.im, iff1: c.iff1, iff2: c.iff2,
            };
        },

        // The comparison itself (core/divergence.js — pure, so it tests without
        // an emulator): the first instruction at which the streams differ, the
        // run-up and the two branches, what memory ends up holding, and which
        // registers disagree.
        compareRuns(a, b, opts = {}) { return compareRuns(a, b, opts); },
        firstDivergence(a, b) { return firstDivergence(a && a.trace || a, b && b.trace || b); },
        divergenceContext(a, b, at, before, after) {
            return divergenceContext(a && a.trace || a, b && b.trace || b, at, before, after);
        },
        diffMemoryImages(a, b, opts) { return diffMemoryImages(a, b, opts); },
        diffRegisters(a, b) { return diffRegisters(a, b); },

        // The recorder on its own, for a driver that wants to drive the frames
        startExecTrace(opts) { return spectrum.startExecTrace(opts || {}); },
        stopExecTrace() { return spectrum.stopExecTrace(); },
        async loadFile(fileOrBytes, name) {
            const f = (fileOrBytes instanceof File) ? fileOrBytes : new File([fileOrBytes], name || 'file.bin');
            return spectrum.loadFile(f);
        },

        // Fetch a tape/snapshot/disk and load it, bypassing the HTTP cache.
        // The browser's cache persists across runs via --user-data-dir, so a
        // rebuilt tape at the same URL silently replays the OLD bytes — a decode
        // that looks byte-shifted between two builds is usually this, not a real
        // shift. Returns { name, bytes, lastModified, result } so a driver can log
        // exactly which build it measured.
        async loadUrl(url, { name = null, cache = 'no-store' } = {}) {
            const res = await fetch(url, { cache });
            if (!res.ok) {
                throw new Error(`loadUrl: ${url} returned HTTP ${res.status}`);
            }
            const buf = new Uint8Array(await res.arrayBuffer());
            const file = name || url.split('/').pop().split('?')[0] || 'file.bin';
            const loaded = await this.loadFile(buf, file);
            return {
                name: file,
                bytes: buf.length,
                lastModified: res.headers.get('last-modified'),
                result: loaded,
            };
        },

        // ---- One-call execution map ----
        // Boot media, run (or replay an RZX), and hand back the map plus every
        // export in one object — the boot → run → export sequence every harness
        // otherwise rebuilds by hand.
        //
        //   const m = await zxDebug.mapRun({ url: 'game.tzx', frames: 3000 });
        //   const m = await zxDebug.mapRun({ rzxUrl: 'walkthrough.rzx' });
        //   fs.writeFileSync('game.ctl', m.ctl);
        //
        // Returns { machineType, frames, played?, atEnd?, ranges, byPage, ctl,
        //           csv, sym, smcCsv?, indirectCsv?, callGraphCsv? }.
        async mapRun({
            url = null, file = null, name = null, rzxUrl = null, rzx = null,
            machine = null, frames = 2000, settleFrames = 200,
            paged = true, autoLoad = true, isTzx = false, diskRun = null, type = 'tape',
            indirect = false, calls = false, smc = false,
            onProgress = null, progressEvery = 1000, report = null,
        } = {}) {
            await this.ready(machine ? { machine } : {});

            let media = null;
            if (rzxUrl || rzx) {
                // RZX carries its own snapshot — no separate media to boot
                if (rzxUrl) {
                    const res = await fetch(rzxUrl, { cache: 'no-store' });
                    if (!res.ok) throw new Error(`mapRun: ${rzxUrl} returned HTTP ${res.status}`);
                    rzx = new Uint8Array(await res.arrayBuffer());
                }
            } else if (url) {
                media = await this.loadUrl(url, { name });
            } else if (file) {
                media = { name: name || 'file.bin', result: await this.loadFile(file, name) };
            } else {
                throw new Error('mapRun: pass url, file, rzxUrl or rzx');
            }

            this.clearMap();
            this.enableMap(true, { fast: true, paged });
            if (indirect) this.watchIndirect();
            if (calls) this.watchCalls();

            let played = null, atEnd = null, ran = 0;
            if (rzx) {
                const r = await this.replayRZX(rzx, { onProgress, progressEvery });
                played = r.played;
                atEnd = r.atEnd;
                ran = r.played;
            } else {
                if (autoLoad) {
                    await this.autoLoad({ type, isTzx, diskRun });
                }
                for (let i = 0; i < frames; i++) {
                    spectrum.runFrame();
                    ran++;
                    if (onProgress && ran % progressEvery === 0) onProgress(ran, frames);
                }
            }
            for (let i = 0; i < settleFrames; i++) spectrum.runFrame();

            const rangesResult = this.ranges();
            const out = {
                machineType: spectrum.machineType,
                media: media ? media.name : (rzxUrl || 'rzx'),
                frames: ran,
                ranges: rangesResult.ranges,
                pages: rangesResult.pages,
                byPage: paged ? this.rangesByPage() : null,
                ctl: this.exportCtl(),
                csv: this.exportCsv(),
                sym: this.exportSym(),
            };
            if (played !== null) { out.played = played; out.atEnd = atEnd; }
            if (smc) out.smcCsv = this.exportSmcCsv();
            if (indirect) out.indirectCsv = this.exportIndirectCsv();
            if (calls) out.callGraphCsv = this.exportCallGraphCsv();

            this.enableMap(false);
            if (indirect) this.stopIndirect();
            if (calls) this.stopCalls();

            if (report) {
                // Post the exports straight to serve.py's sink
                await this.report(out, 'result', typeof report === 'string' ? report : null);
            }
            return out;
        }
    };

    // ========== Second Screen (Shadow Screen) ==========
    let secondScreenCtx = null;
    let secondScreenImageData = null;
    let secondScreenBuf32 = null;
    let secondScreenMode = 'none'; // 'none' | 'full' | 'bitmap' | 'linear' | 'spectrum'
    let secondScreenCustomAddr = 0xC000;

    function updateSecondScreenOptions() {
        const select = document.getElementById('secondScreenMode');
        const is128k = spectrum.memory.profile.ramPages > 1;
        for (const opt of select.options) {
            if (opt.value === 'full' || opt.value === 'bitmap') {
                opt.disabled = !is128k;
                opt.style.display = is128k ? '' : 'none';
            }
        }
        // Fall back if current mode not available on this machine
        if (!is128k && (secondScreenMode === 'full' || secondScreenMode === 'bitmap')) {
            secondScreenMode = 'none';
            select.value = 'none';
            storageSet('zxm8_secondScreen', 'none');
        }
    }

    function renderSecondScreen() {
        if (!secondScreenCtx) {
            const c = document.getElementById('secondScreen');
            secondScreenCtx = c.getContext('2d');
            secondScreenImageData = secondScreenCtx.createImageData(256, 192);
            secondScreenBuf32 = new Uint32Array(secondScreenImageData.data.buffer);
        }

        const mem = spectrum.memory;
        const fb = secondScreenBuf32;
        const inkC = 0xFFFFFFFF; // white
        const papC = 0xFF000000; // black

        // Paint the shadow canvas solid black — used when the current mode has
        // nothing valid to show (e.g. a shadow mode on a 48K machine), so we
        // never leave a previous machine's image lingering on screen.
        const blankSecondScreen = (label) => {
            fb.fill(papC);
            secondScreenCtx.putImageData(secondScreenImageData, 0, 0);
            if (label !== undefined) document.getElementById('secondScreenLabel').textContent = label;
        };

        if (secondScreenMode === 'full' || secondScreenMode === 'bitmap') {
            // Shadow modes — require 128K+ (two screen banks). On 48K (or if the
            // inactive bank isn't available) show black, not stale pixels.
            if (mem.profile.ramPages <= 1) { blankSecondScreen('n/a (48K)'); return; }
            const inactiveBank = (mem.screenBank === 5) ? 7 : 5;
            const ram = mem.getRamBank(inactiveBank);
            if (!ram) { blankSecondScreen('n/a'); return; }

            if (secondScreenMode === 'bitmap') {
                for (let y = 0; y < 192; y++) {
                    const pixelAddr = ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
                    const rowOff = y * 256;
                    for (let col = 0; col < 32; col++) {
                        const px = ram[pixelAddr + col];
                        const b = rowOff + (col << 3);
                        fb[b]   = (px & 0x80) ? inkC : papC;
                        fb[b+1] = (px & 0x40) ? inkC : papC;
                        fb[b+2] = (px & 0x20) ? inkC : papC;
                        fb[b+3] = (px & 0x10) ? inkC : papC;
                        fb[b+4] = (px & 0x08) ? inkC : papC;
                        fb[b+5] = (px & 0x04) ? inkC : papC;
                        fb[b+6] = (px & 0x02) ? inkC : papC;
                        fb[b+7] = (px & 0x01) ? inkC : papC;
                    }
                }
            } else {
                const ula = spectrum.ula;
                const flashActive = ula.flashState;
                const ulaPlusActive = ula.ulaplus.enabled && ula.ulaplus.paletteEnabled;
                const pal32 = ula.palette32;
                const ulaPal32 = ula.ulaplus.palette32;
                for (let y = 0; y < 192; y++) {
                    const pixelAddr = ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
                    const attrAddr = 0x1800 + ((y >> 3) << 5);
                    const rowOff = y * 256;
                    for (let col = 0; col < 32; col++) {
                        const px = ram[pixelAddr + col];
                        const attr = ram[attrAddr + col];
                        let ic, pc;
                        if (ulaPlusActive) {
                            const clut = ((attr >> 6) & 3) << 4;
                            ic = ulaPal32[clut + (attr & 7)];
                            pc = ulaPal32[clut + 8 + ((attr >> 3) & 7)];
                        } else {
                            let ink = attr & 7, paper = (attr >> 3) & 7;
                            const bright = (attr & 0x40) ? 8 : 0;
                            if ((attr & 0x80) && flashActive) { const t = ink; ink = paper; paper = t; }
                            ic = pal32[ink + bright];
                            pc = pal32[paper + bright];
                        }
                        const b = rowOff + (col << 3);
                        fb[b]   = (px & 0x80) ? ic : pc;
                        fb[b+1] = (px & 0x40) ? ic : pc;
                        fb[b+2] = (px & 0x20) ? ic : pc;
                        fb[b+3] = (px & 0x10) ? ic : pc;
                        fb[b+4] = (px & 0x08) ? ic : pc;
                        fb[b+5] = (px & 0x04) ? ic : pc;
                        fb[b+6] = (px & 0x02) ? ic : pc;
                        fb[b+7] = (px & 0x01) ? ic : pc;
                    }
                }
            }
            secondScreenCtx.putImageData(secondScreenImageData, 0, 0);
            document.getElementById('secondScreenLabel').textContent =
                'Bank ' + ((mem.screenBank === 5) ? 7 : 5) + '  (active: bank ' + mem.screenBank + ')';

        } else if (secondScreenMode === 'spectrum') {
            // Spectrum interleaved layout from custom address, white-on-black
            const baseAddr = secondScreenCustomAddr;
            for (let y = 0; y < 192; y++) {
                const lineOffset = ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
                const rowOff = y * 256;
                for (let col = 0; col < 32; col++) {
                    const px = mem.read((baseAddr + lineOffset + col) & 0xFFFF);
                    const b = rowOff + (col << 3);
                    fb[b]   = (px & 0x80) ? inkC : papC;
                    fb[b+1] = (px & 0x40) ? inkC : papC;
                    fb[b+2] = (px & 0x20) ? inkC : papC;
                    fb[b+3] = (px & 0x10) ? inkC : papC;
                    fb[b+4] = (px & 0x08) ? inkC : papC;
                    fb[b+5] = (px & 0x04) ? inkC : papC;
                    fb[b+6] = (px & 0x02) ? inkC : papC;
                    fb[b+7] = (px & 0x01) ? inkC : papC;
                }
            }
            secondScreenCtx.putImageData(secondScreenImageData, 0, 0);
            document.getElementById('secondScreenLabel').textContent =
                'Spectrum @ $' + hex16(baseAddr);

        } else if (secondScreenMode === 'linear') {
            // Linear row-sequential layout from custom address, white-on-black
            const baseAddr = secondScreenCustomAddr;
            for (let y = 0; y < 192; y++) {
                const lineOffset = y * 32;
                const rowOff = y * 256;
                for (let col = 0; col < 32; col++) {
                    const px = mem.read((baseAddr + lineOffset + col) & 0xFFFF);
                    const b = rowOff + (col << 3);
                    fb[b]   = (px & 0x80) ? inkC : papC;
                    fb[b+1] = (px & 0x40) ? inkC : papC;
                    fb[b+2] = (px & 0x20) ? inkC : papC;
                    fb[b+3] = (px & 0x10) ? inkC : papC;
                    fb[b+4] = (px & 0x08) ? inkC : papC;
                    fb[b+5] = (px & 0x04) ? inkC : papC;
                    fb[b+6] = (px & 0x02) ? inkC : papC;
                    fb[b+7] = (px & 0x01) ? inkC : papC;
                }
            }
            secondScreenCtx.putImageData(secondScreenImageData, 0, 0);
            document.getElementById('secondScreenLabel').textContent =
                'Linear @ $' + hex16(baseAddr);
        }
    }

    function updateSecondScreenVisibility() {
        const container = document.getElementById('secondScreenContainer');
        const bankInfo = document.getElementById('screenBankInfo');
        const addrLabel = document.getElementById('secondScreenAddrLabel');
        const is128k = spectrum.memory.profile.ramPages > 1;

        // SCR bank indicator — 128K+ only
        if (is128k) {
            bankInfo.style.display = '';
            document.getElementById('screenBankStatus').textContent = spectrum.memory.screenBank;
        } else {
            bankInfo.style.display = 'none';
        }

        // Address input — visible for linear/spectrum modes
        addrLabel.style.display = (secondScreenMode === 'linear' || secondScreenMode === 'spectrum') ? '' : 'none';

        // Container visibility — any non-none mode (linear/spectrum work on all machines)
        if (secondScreenMode !== 'none') {
            container.classList.remove('hidden');
            updateSecondScreenSize();
            renderSecondScreen();
        } else {
            container.classList.add('hidden');
        }
    }

    function updateSecondScreenSize() {
        if (secondScreenMode === 'none') return;
        const ssCanvas = document.getElementById('secondScreen');
        const zoom = getCurrentZoom();
        ssCanvas.style.width = (256 * zoom) + 'px';
        ssCanvas.style.height = (192 * zoom) + 'px';
        const header = document.querySelector('.second-screen-header');
        if (header) header.style.width = (256 * zoom) + 'px';
    }

    // Set onFrame hook early (before auto-capture or profiler hook it)
    const savedOnFrame = spectrum.onFrame;
    spectrum.onFrame = (fc) => {
        if (spectrum.memory.profile.ramPages > 1) {
            document.getElementById('screenBankStatus').textContent = spectrum.memory.screenBank;
        }
        if (secondScreenMode !== 'none') renderSecondScreen();
        if (savedOnFrame) savedOnFrame(fc);
    };

    // Settings wiring for second screen dropdown
    const secondScreenSelect = document.getElementById('secondScreenMode');
    const secondScreenAddrInput = document.getElementById('secondScreenAddr');
    const savedMode = storageGet('zxm8_secondScreen');
    // Migrate legacy boolean value
    if (savedMode === 'true') {
        secondScreenMode = 'full';
        storageSet('zxm8_secondScreen', 'full');
    } else if (['full', 'bitmap', 'linear', 'spectrum'].includes(savedMode)) {
        secondScreenMode = savedMode;
    } else {
        secondScreenMode = 'none';
    }
    const savedAddr = storageGet('zxm8_secondScreenAddr');
    if (savedAddr) {
        const parsed = parseInt(savedAddr, 16);
        if (!isNaN(parsed)) {
            secondScreenCustomAddr = parsed & 0xFFFF;
            secondScreenAddrInput.value = hex16(secondScreenCustomAddr);
        }
    }
    secondScreenSelect.value = secondScreenMode;
    updateSecondScreenOptions();
    updateSecondScreenVisibility();

    secondScreenSelect.addEventListener('change', () => {
        secondScreenMode = secondScreenSelect.value;
        storageSet('zxm8_secondScreen', secondScreenMode);
        updateSecondScreenVisibility();
    });

    secondScreenAddrInput.addEventListener('change', () => {
        const parsed = parseInt(secondScreenAddrInput.value, 16);
        if (!isNaN(parsed)) {
            secondScreenCustomAddr = parsed & 0xFFFF;
            secondScreenAddrInput.value = hex16(secondScreenCustomAddr);
            storageSet('zxm8_secondScreenAddr', secondScreenAddrInput.value);
            if (secondScreenMode === 'linear' || secondScreenMode === 'spectrum') renderSecondScreen();
        }
    });

    // Sync second screen size on any zoom change (buttons, F1 key, etc.)
    setOnZoomChange(() => updateSecondScreenSize());

    // Shared memory access wrappers (used by many UI modules via DI)
    const readMemory = (addr) => spectrum.memory.read(addr);
    const getMemoryInfo = () => ({
        machineType: spectrum.memory.machineType,
        currentRomBank: spectrum.memory.currentRomBank,
        currentRamBank: spectrum.memory.currentRamBank,
        ramPages: spectrum.memory.ram ? spectrum.memory.ram.length : 1
    });
    const getRamBank = (bank) => spectrum.memory.getRamBank(bank);

    // Disk activity indicator (extracted to ui/disk-activity.js)
    const diskActivityAPI = initDiskActivity({ getSpectrum: () => spectrum });

    // Initialize test runner
    testRunner = new TestRunner(spectrum);
    testRunner.setLoaders({ TapeTrapHandler, ZipLoader, is128kCompat });
    testRunner.setCallbacks({
        updateCanvasSize,
        applyPalette: (id) => displayAPI.applyPalette(id),
        updateULAplusStatus: () => displayAPI.updateULAplusStatus(),
        updateMediaIndicator: (...args) => updateMediaIndicator(...args),
        loadRomsForMachineType,
        getPaletteValue: () => displayAPI.getPaletteValue(),
        onDisasmReset: () => { disasm = null; },
        updateSecondScreenOptions: () => { updateSecondScreenOptions(); updateSecondScreenVisibility(); },
        getSecondScreenMode: () => secondScreenMode,
        setSecondScreenMode: (mode) => {
            secondScreenMode = mode;
            const sel = document.getElementById('secondScreenMode');
            if (sel) sel.value = mode;
            storageSet('zxm8_secondScreen', mode);
            updateSecondScreenOptions();    // falls back to none if unsupported here
            updateSecondScreenVisibility(); // show/hide container + render
        }
    });


    // Compare Tool (extracted to compare-tool.js)
    const compareAPI = initCompareTool({
        RZXLoader,
        SZXLoader,
        getEmulatorState: () => ({
            cpu: spectrum.cpu,
            memory: spectrum.memory,
            machineType: spectrum.machineType,
            borderColor: spectrum.ula.borderColor
        })
    });

    // Restore the last-used border size preset (defaults to full border)
    const savedBorderPreset = storageGet('zxm8_border', 'full');
    borderSizeSelect.value = savedBorderPreset;
    spectrum.ula.setBorderPreset(savedBorderPreset);
    spectrum.updateDisplayDimensions();

    // Restore saved zoom level (after spectrum is created)
    setZoom(getCurrentZoom());

    // Port I/O logging and trace filters (extracted to ui/port-logging.js)
    const portLoggingAPI = initPortLogging({
        getSpectrum: () => spectrum,
        showMessage
    });

    // RZX end callback
    spectrum.onRZXEnd = () => {
        updateRZXStatus();
        showMessage('RZX playback finished');
    };

    // Debugger functionality
    const debuggerPanel = document.getElementById('debuggerPanel');

    // Register editor (extracted to ui/register-editor.js)
    const regEditorAPI = initRegisterEditor({
        getSpectrum: () => spectrum, updateDebugger,
        addWatch: (addr, name) => addWatch?.(addr, name),
        showMessage
    });

    // Memory View UI elements
    const memoryAddressInput = document.getElementById('memoryAddress');
    const btnMemoryPC = document.getElementById('btnMemoryPC');
    const btnMemorySP = document.getElementById('btnMemorySP');
    const btnMemoryHL = document.getElementById('btnMemoryHL');
    const btnMemoryPgUp = document.getElementById('btnMemoryPgUp');
    const btnMemoryPgDn = document.getElementById('btnMemoryPgDn');
    const btnMemorySnap = document.getElementById('btnMemorySnap');
    const btnMemoryClearSnap = document.getElementById('btnMemoryClearSnap');
    const chkRomEdit = document.getElementById('chkRomEdit');

    // Memory snapshot for diff
    let memorySnapshot = null;




    // Snapshot state for export (captured via Snap button)
    let exportSnapshot = null;  // { cpu: {...}, memory: Uint8Array, border: number }


    // Bookmarks - now store {addr, type} where type is 'disasm' or 'memdump'
    let leftBookmarks = [null, null, null, null, null];   // 5 bookmark slots for left panel
    let rightBookmarks = [null, null, null, null, null];  // 5 bookmark slots for right panel
    // Legacy aliases for compatibility
    let disasmBookmarks = leftBookmarks;
    let memoryBookmarks = rightBookmarks;

    // Panel type state
    let leftPanelType = 'disasm';   // 'disasm' or 'memdump'
    let rightPanelType = 'memdump'; // 'disasm' or 'memdump'
    const leftPanel = document.getElementById('leftPanel');
    const rightPanel = document.getElementById('rightPanel');

    // Left panel memory view state
    let leftMemoryViewAddress = 0;

    // Right panel disasm view state
    let rightDisasmViewAddress = null;

    // Memory view state
    let memoryViewAddress = 0;
    const MEMORY_LINES = 32;         // Right panel memory lines
    const LEFT_MEMORY_LINES = 42;    // Left panel memory lines (taller panel)
    const BYTES_PER_LINE = 16;
    
    // Disassembly view state
    let disasmViewAddress = null; // null = follow PC
    let disasmLastLineAddr = 0;
    let traceViewAddress = null; // Address being viewed in trace history (null = live)
    const DISASM_LINES = 48;
    const DISASM_PC_POSITION = 4; // Show PC at 5th line (0-indexed)
    const chkShowTstates = document.getElementById('chkShowTstates');
    const labelDisplayMode = document.getElementById('labelDisplayMode');

    // Disassembly formatter (extracted to ui/disasm-formatter.js)
    const { getCurrentPage, formatAddrWithLabel, formatAddrColumn,
            applyOperandFormat, replaceMnemonicAddresses } = initDisasmFormatter({
        getMemory: () => spectrum.memory, labelManager, operandFormatManager
    });

    let disasm = null;

    // Layout helpers (extracted to ui/layout-helpers.js)
    const { isDebuggerVisible, isFlowBreak } = initLayoutHelpers();

    // Disassembly generator (extracted to ui/disasm-generator.js)
    const { disassembleWithRegions, disassembleWithFolding } = initDisasmGenerator({
        getDisasm: () => disasm, getMemory: () => spectrum.memory,
        regionManager, subroutineManager, foldManager, labelManager,
        getCurrentPage
    });

    // updateDebugger thin wrapper — delegates to debugger-display module
    // (debuggerDisplayAPI is initialized later, after all sub-update functions are available)
    let debuggerDisplayAPI = null;
    function updateDebugger() {
        if (debuggerDisplayAPI) debuggerDisplayAPI.renderDebugger();
        // While stepping the emulator isn't running frames, so the onFrame hook
        // that normally refreshes the shadow screen never fires. Re-render it here
        // so a byte changed by a single step is reflected immediately.
        if (secondScreenMode !== 'none') renderSecondScreen();
    }
    
    // Panel navigator (extracted to ui/panel-navigator.js)
    const { switchLeftPanelType, switchRightPanelType,
            updateLeftPanel, updateRightPanel,
            goToLeftMemory, goToRightMemory,
            goToLeftDisasm, goToRightDisasm,
            goToMemoryHere, goToMemoryOther,
            goToDisasmHere, goToDisasmOther,
            goToMemoryAddress, goToAddressNoHistory, goToAddress,
            navigateToAddress,
            goToLeftMemoryAddress, goToRightDisasmAddress } = initPanelNavigator({
        getSpectrum: () => spectrum,
        getDisasm: () => disasm,
        getLeftPanelType: () => leftPanelType,
        setLeftPanelType: (v) => { leftPanelType = v; },
        getRightPanelType: () => rightPanelType,
        setRightPanelType: (v) => { rightPanelType = v; },
        getDisasmViewAddress: () => disasmViewAddress,
        setDisasmViewAddress: (v) => { disasmViewAddress = v; },
        getRightDisasmViewAddress: () => rightDisasmViewAddress,
        setRightDisasmViewAddress: (v) => { rightDisasmViewAddress = v; },
        getMemoryViewAddress: () => memoryViewAddress,
        setMemoryViewAddress: (v) => { memoryViewAddress = v; },
        getLeftMemoryViewAddress: () => leftMemoryViewAddress,
        setLeftMemoryViewAddress: (v) => { leftMemoryViewAddress = v; },
        getLeftBookmarks: () => leftBookmarks,
        getRightBookmarks: () => rightBookmarks,
        navPushHistory, getLeftHistory, getRightHistory,
        getUpdateBookmarkButtons: () => updateBookmarkButtons,
        updateDebugger,
        getUpdateRightDisassemblyView: () => updateRightDisassemblyView,
        getUpdateMemoryView: () => updateMemoryView,
        getUpdateLeftMemoryView: () => updateLeftMemoryView,
        DISASM_LINES, DISASM_PC_POSITION
    });
    // Wire the trampoline for nav-history ↔ panel-navigator
    _goToAddressNoHistory = goToAddressNoHistory;

    // DOM aliases needed by remaining index.html code (elements discovered inside panel-navigator)
    const leftMemAddressInput = document.getElementById('leftMemAddress');
    const leftMemoryView = document.getElementById('leftMemoryView');

    // Stack & call stack views (extracted to ui/stack-view.js)
    const { updateStackView, updateCallStack } = initStackView({
        getSpectrum: () => spectrum, labelManager, traceManager,
        getCurrentPage,
        navigateToAddress: (addr) => navigateToAddress(addr),
        goToMemoryAddress,
        goToRightMemoryAddress: (addr) => goToRightMemory(addr),
        setDisasmViewAddress: (addr) => { disasmViewAddress = addr; },
        setRightDisasmViewAddress: (addr) => { rightDisasmViewAddress = addr; },
        updateDebugger,
        updateRightDisassemblyView: () => updateRightDisassemblyView()
    });
    
    // Labels & triggers (extracted to ui/labels-triggers.js)
    const { updateTriggerList, updateBreakpointList, updateWatchpointList,
            updatePortBreakpointList, updateLabelsList } = initLabelsTriggers({
        getSpectrum: () => spectrum, labelManager
    });

    // Memory view (extracted to ui/memory-view.js)
    const memoryViewAPI = initMemoryView({
        getSpectrum: () => spectrum, getDisasm: () => disasm, regionManager,
        getMemoryViewAddress: () => memoryViewAddress,
        getLeftMemoryViewAddress: () => leftMemoryViewAddress,
        getMemorySnapshot: () => memorySnapshot,
        updateDebugger,
        getGoToMemoryAddress: () => goToMemoryAddress,
        MEMORY_LINES, LEFT_MEMORY_LINES, BYTES_PER_LINE
    });
    const { updateMemoryView, updateLeftMemoryView,
            getRightBytesPerLine, getLeftBytesPerLine,
            clearMemSelection, clearAsciiSelection, startByteEdit, finishCurrentEdit } = memoryViewAPI;

    // Memory context menus initialized later (after initDialogs)
    
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
        goToMemoryAddress(memoryViewAddress - MEMORY_LINES * getRightBytesPerLine());
    });

    btnMemoryPgDn.addEventListener('click', () => {
        goToMemoryAddress(memoryViewAddress + MEMORY_LINES * getRightBytesPerLine());
    });

    // Right panel disassembly view (extracted to ui/right-disasm-view.js)
    const { updateRightDisassemblyView } = initRightDisasmView({
        getSpectrum: () => spectrum, getDisasm: () => disasm,
        subroutineManager, labelManager, foldManager,
        commentManager, regionManager,
        getCurrentPage, formatAddrColumn, replaceMnemonicAddresses,
        formatMnemonic, isFlowBreak, disassembleWithFolding,
        getRightDisasmViewAddress: () => rightDisasmViewAddress,
        getLabelDisplayMode: () => labelDisplayMode.value,
        DISASM_LINES
    });

    // Debugger display (extracted to ui/debugger-display.js)
    debuggerDisplayAPI = initDebuggerDisplay({
        getSpectrum: () => spectrum,
        getDisasm: () => disasm,
        setDisasm: (d) => { disasm = d; },
        DisassemblerClass: Disassembler,
        regEditorAPI, traceManager,
        regionManager, commentManager, subroutineManager, foldManager, labelManager,
        xrefManager,
        getCurrentPage, formatAddrColumn, replaceMnemonicAddresses,
        formatMnemonic, isFlowBreak, disassembleWithFolding,
        getDisasmViewAddress: () => disasmViewAddress,
        setDisasmViewAddress: (v) => { disasmViewAddress = v; },
        getDisasmLastLineAddr: () => disasmLastLineAddr,
        setDisasmLastLineAddr: (v) => { disasmLastLineAddr = v; },
        getTraceViewAddress: () => traceViewAddress,
        getLeftPanelType: () => leftPanelType,
        getRightPanelType: () => rightPanelType,
        getLabelDisplayMode: () => labelDisplayMode.value,
        getShowTstates: () => chkShowTstates.checked,
        DISASM_LINES, DISASM_PC_POSITION,
        updateBreakpointList, updateWatchpointList, updatePortBreakpointList,
        updateLabelsList, updateLeftMemoryView, updateMemoryView,
        updateRightDisassemblyView,
        updateStackView, updateCallStack,
        getUpdateTraceStatus: () => window.updateTraceStatus,
        getUpdateTraceList: () => window.updateTraceList,
        getUpdateWatchValues: () => updateWatchValues
    });

    // Panel type select event handlers
    document.getElementById('leftPanelType').addEventListener('change', (e) => {
        switchLeftPanelType(e.target.value);
    });

    document.getElementById('rightPanelType').addEventListener('change', (e) => {
        switchRightPanelType(e.target.value);
    });

    // Left panel memory controls
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
        goToLeftMemoryAddress(leftMemoryViewAddress - LEFT_MEMORY_LINES * getLeftBytesPerLine());
    });
    document.getElementById('btnLeftMemPgDn')?.addEventListener('click', () => {
        goToLeftMemoryAddress(leftMemoryViewAddress + LEFT_MEMORY_LINES * getLeftBytesPerLine());
    });

    // Scroll wheel for left memory view
    leftMemoryView.addEventListener('wheel', (e) => {
        if (leftPanelType !== 'memdump') return;
        e.preventDefault();
        const scrollLines = e.deltaY > 0 ? 3 : -3;
        goToLeftMemoryAddress(leftMemoryViewAddress + scrollLines * getLeftBytesPerLine());
    }, { passive: false });

    // Bookmarks (extracted to ui/bookmarks.js)
    const { updateBookmarkButtons, setupBookmarkHandlers } = initBookmarks({
        getSpectrum: () => spectrum,
        undoManager,
        getLeftPanelType: () => leftPanelType,
        getRightPanelType: () => rightPanelType,
        getDisasmViewAddress: () => disasmViewAddress,
        getLeftMemoryViewAddress: () => leftMemoryViewAddress,
        getMemoryViewAddress: () => memoryViewAddress,
        getRightDisasmViewAddress: () => rightDisasmViewAddress,
        getLeftBookmarks: () => leftBookmarks,
        setLeftBookmark: (idx, val) => { leftBookmarks[idx] = val; disasmBookmarks = leftBookmarks; },
        getRightBookmarks: () => rightBookmarks,
        setRightBookmark: (idx, val) => { rightBookmarks[idx] = val; memoryBookmarks = rightBookmarks; },
        switchLeftPanelType, switchRightPanelType,
        goToAddress, goToMemoryAddress,
        goToLeftMemoryAddress, goToRightDisasmAddress,
        getCalcValue: () => calculatorAPI ? calculatorAPI.getValue() : 0,
        setCalcValue: (v) => { if (calculatorAPI) calculatorAPI.setValue(v); },
        showMessage
    });

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

    // Instruction history popup (click "System" heading)
    {
        const pcHistoryPopup = document.getElementById('pcHistoryPopup');
        const btnPcHistory = document.getElementById('btnPcHistory');

        function disassembleFromBytes(pc, bytes, len) {
            const mem = { read(addr) { const idx = (addr - pc) & 0xffff; return idx < len ? bytes[idx] : 0; } };
            const d = new Disassembler(mem);
            return d.disassemble(pc);
        }

        function showPcHistory() {
            if (!spectrum?.cpu) return;
            const cpu = spectrum.cpu;
            const entries = [];
            for (let i = 0; i < 10; i++) {
                const idx = (cpu.instrHistoryIdx + i) % 10;
                const entry = cpu.instrHistory[idx];
                if (entry.len > 0) entries.push(entry);
            }
            if (entries.length === 0) {
                pcHistoryPopup.innerHTML = '<div class="ph-header">Instruction History</div><div class="ph-bytes">No instructions recorded</div>';
            } else {
                let html = '<div class="ph-header">Instruction History (last ' + entries.length + ')</div>';
                for (const entry of entries) {
                    const result = disassembleFromBytes(entry.pc, entry.bytes, entry.len);
                    const addrStr = hex16(entry.pc);
                    let bytesStr = '';
                    for (let j = 0; j < entry.len; j++) {
                        bytesStr += hex8(entry.bytes[j]) + ' ';
                    }
                    html += '<div class="ph-instr" data-addr="' + entry.pc + '">'
                        + '<span class="ph-addr">' + addrStr + '</span> '
                        + escapeHtml(result.mnemonic)
                        + '<span class="ph-bytes">' + bytesStr.trim() + '</span>'
                        + '</div>';
                }
                pcHistoryPopup.innerHTML = html;
            }
            // Position below the heading (account for UI zoom)
            const rect = btnPcHistory.getBoundingClientRect();
            const zoom = getUiScale() || 1;
            pcHistoryPopup.style.left = (rect.left / zoom) + 'px';
            pcHistoryPopup.style.top = ((rect.bottom + 4) / zoom) + 'px';
            pcHistoryPopup.classList.remove('hidden');
            // Clamp to viewport if overflowing right edge
            const popupRect = pcHistoryPopup.getBoundingClientRect();
            if (popupRect.right > window.innerWidth) {
                pcHistoryPopup.style.left = ((window.innerWidth - popupRect.width - 8) / zoom) + 'px';
            }
            // Click rows to navigate
            pcHistoryPopup.querySelectorAll('.ph-instr').forEach(el => {
                el.addEventListener('click', () => {
                    const addr = parseInt(el.dataset.addr, 10);
                    navigateToAddress(addr);
                    closePcHistory();
                });
            });
        }

        function closePcHistory() {
            pcHistoryPopup.classList.add('hidden');
        }

        btnPcHistory.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pcHistoryPopup.classList.contains('hidden')) {
                showPcHistory();
            } else {
                closePcHistory();
            }
        });

        document.addEventListener('click', (e) => {
            if (!pcHistoryPopup.classList.contains('hidden') && !pcHistoryPopup.contains(e.target) && e.target !== btnPcHistory) {
                closePcHistory();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !pcHistoryPopup.classList.contains('hidden')) {
                closePcHistory();
            }
        });
    }

    // Explorer (extracted to explorer.js)
    const explorerAPI = initExplorer({
        DSKLoader, Disassembler, SZXLoader, RZXLoader, ZipLoader,
        pako: window.pako,
        getPalette: () => spectrum?.ula?.palette || null,
        getRomLabels: () => labelManager?.romLabels || {},
        // ZX charset (chars 0x20-0x7F at 0x3D00) from the always-loaded 48.rom —
        // machine-independent (romData holds loaded ROM files, not paged memory),
        // so the Explorer's banner text preview works on any current machine.
        getZxCharset: () => {
            const r = romData && romData['48.rom'];
            if (!r) return null;
            const u8 = r instanceof Uint8Array ? r : new Uint8Array(r);
            return u8.length >= 0x3D00 + 768 ? u8.subarray(0x3D00, 0x3D00 + 768) : null;
        }
    });


    // Text Scanner (extracted to ui/text-scanner.js)
    initTextScanner({
        readMemory,
        getMemoryInfo,
        getRamBank,
        getRom: (index) => spectrum.memory.rom[index],
        showMessage,
        goToMemoryAddress
    });

    // Tables card, right below Text scan in the Search tab
    initTableScanner({ readMemory, showMessage, goToMemoryAddress });


    // Watches (extracted to ui/watches.js)
    const { updateWatchValues, renderWatches, saveWatches, setWatches, getWatchBytesCount, getWatches, addWatch } = initWatches({
        readMemory,
        getMemoryInfo,
        getRamBank,
        parseAddressSpec: (addrStr) => spectrum.parseAddressSpec(addrStr),
        getLabel: (addr) => labelManager.get(addr),
        showMessage
    });

    // Poke Manager (extracted to poke-manager.js)
    const pokeManagerAPI = initPokeManager({
        readMemory,
        writePoke: (addr, val) => spectrum.poke(addr, val),
        showMessage,
        goToAddress,
        setFrozenAddresses: (list) => spectrum.setFrozenAddresses(list)
    });

    // Poke Search (extracted to poke-search.js)
    const pokeSearchAPI = initPokeSearch({
        readMemory,
        startWriteTrace: () => spectrum.startPokeWriteTrace(),
        stopWriteTrace: () => spectrum.stopPokeWriteTrace(),
        showMessage,
        goToMemoryAddress,
        startWriteMonitor: (addr) => spectrum.startWriteMonitor(addr),
        stopWriteMonitor: () => spectrum.stopWriteMonitor(),
        startReadMonitor: (addr) => spectrum.startReadMonitor(addr),
        stopReadMonitor: () => spectrum.stopReadMonitor(),
        disassembleAt: (addr) => {
            const d = disasm || new Disassembler(spectrum.memory);
            return d.disassemble(addr);
        },
        goToAddress,
        startComparisonBreakpoint: (a, b, op) => spectrum.startComparisonBreakpoint(a, b, op),
        stopComparisonBreakpoint: () => spectrum.stopComparisonBreakpoint(),
        startRegisterTracker: (pc, reg) => spectrum.startRegisterTracker(pc, reg),
        stopRegisterTracker: () => spectrum.stopRegisterTracker()
    });

    // Struct Mapper (extracted to ui/struct-mapper.js)
    const structMapperAPI = initStructMapper({
        startStructMapper: (base, reg, max) => spectrum.startStructMapper(base, reg, max),
        stopStructMapper: () => spectrum.stopStructMapper(),
        readMemory,
        getSpectrum: () => spectrum,
        disassembleAt: (addr) => {
            const d = disasm || new Disassembler(spectrum.memory);
            return d.disassemble(addr);
        },
        labelManager,
        goToAddress,
        showMessage
    });

    // BASIC Copy/Paste (extracted to ui/basic-editor.js)
    initBasicEditor({
        getSpectrum: () => spectrum,
        readMemory,
        writePoke: (addr, val) => spectrum.poke(addr, val),
        isRunning: () => spectrum.isRunning(),
        stopEmulator: () => spectrum.stop(),
        showMessage,
        updateDebugger
    });

    // Memory Search (extracted to memory-search.js)
    initMemorySearch({
        readMemory,
        showMessage,
        goToMemoryAddress,
        goToLeftMemoryAddress
    });

    // Assembler (extracted to ui/assembler-ui.js)
    const asmAPI = initAssemblerUI({
        VFS,
        Assembler,
        AsmMemory,
        ErrorCollector,
        ZipLoader,
        MD5,
        getSpectrum: () => spectrum,
        labelManager,
        showMessage,
        updateDebugger,
        updateStatus,
        updateLabelsList,
        is128kCompat,
        arrayToBase64,
        pako: window.pako,
        goToAddress,
        goToRightDisasmAddress,
        getLeftPanelType: () => leftPanelType,
        getRightPanelType: () => rightPanelType,
        switchLeftPanelType
    });

    // ASM editor snippets (extracted to ui/asm-snippets.js)
    initAsmSnippets({
        insertAtCursor: (text) => asmAPI.insertAtCursor(text),
        getSelectedText: () => asmAPI.getSelectedText(),
        showMessage,
        downloadFile,
        escapeHtml
    });


    // Auto-map, XRef, Code-Flow Analysis (extracted to ui/analysis-tools.js)
    const analysisAPI = initAnalysisTools({
        getSpectrum: () => spectrum,
        getDisasm: () => disasm,
        setExportSnapshot: (snap) => { exportSnapshot = snap; },
        regionManager,
        labelManager,
        xrefManager,
        subroutineManager,
        getDisasmViewAddress: () => disasmViewAddress,
        showMessage,
        updateDebugger,
        getGenerateAssemblyOutput: () => generateAssemblyOutput,
        downloadFile,
        appVersion: APP_VERSION
    });
    // ========== Runtime Behavior Profiler (extracted to ui/profiler-ui.js) ==========
    // Call Graph (extracted to ui/call-graph.js)
    const callGraphAPI = initCallGraph({
        labelManager,
        goToAddress,
        showMessage
    });

    const profilerAPI = initProfilerUI({
        readMemory,
        getMemoryInfo,
        getProfiler: () => spectrum.profiler,
        startProfiling: (frames) => spectrum.startProfiling(frames),
        stopProfiling: () => spectrum.stopProfiling(),
        isRunning: () => spectrum.isRunning(),
        startEmulator: () => spectrum.start(),
        getOnFrame: () => spectrum.onFrame,
        setOnFrame: (cb) => { spectrum.onFrame = cb; },
        labelManager,
        regionManager,
        navigateToAddress,
        goToAddress,
        updateLabelsList,
        updateDebugger,
        showMessage,
        callGraphAPI
    });

    // Code Path Tool (extracted to ui/codepath.js)
    const codePathAPI = initCodePath({
        getSpectrum: () => spectrum,
        readMemory,
        disassembleAt: (addr) => {
            const d = disasm || new Disassembler(spectrum.memory);
            return d.disassemble(addr);
        },
        getLabel: (addr) => {
            const label = labelManager.get(addr);
            return label ? label.name : null;
        },
        goToAddress,
        showMessage,
        downloadFile
    });

    // The ordered counterpart to the Code Path slots above it, in the same tab:
    // a set difference says what a run reached, this says where two runs parted
    initDiffRun({
        getSpectrum: () => spectrum,
        disassembleAt: (addr) => {
            const d = disasm || new Disassembler(spectrum.memory);
            return d.disassemble(addr);
        },
        getLabel: (addr) => {
            const label = labelManager.get(addr);
            return label ? label.name : null;
        },
        goToAddress,
        showMessage,
        downloadFile
    });

    // Trace Display & Controls (extracted to ui/trace-display.js)
    const traceAPI = initTraceDisplay({
        traceManager,
        getSpectrum: () => spectrum,
        getDisasm: () => disasm,
        Disassembler,
        getTraceViewAddress: () => traceViewAddress,
        setTraceViewAddress: (addr) => { traceViewAddress = addr; },
        goToAddress,
        showMessage,
        updateDebugger
    });
    const { updateTraceList, updateTraceStatus, showTraceEntry } = traceAPI;
    window.updateTraceList = updateTraceList;
    window.updateTraceStatus = updateTraceStatus;


    // Memory Map Dialog (extracted to ui/memory-map.js)
    initMemoryMap({
        readMemory,
        getMemoryInfo,
        getRAMBanks: () => spectrum.memory.ram,
        getAutoMapData: () => spectrum.getAutoMapData(),
        getAutoMapKey: (addr) => spectrum.getAutoMapKey(addr),
        parseAutoMapKey: (key) => spectrum.parseAutoMapKey(key),
        downloadFile,
        regionManager,
        labelManager,
        commentManager,
        goToAddress,
        goToMemoryAddress,
        updateDebugger
    });

    // Export Disassembly (extracted to ui/export-asm.js)
    initExportAsm({
        getExportSnapshot: () => exportSnapshot,
        getCpuState: () => spectrum.cpu,
        getMemoryState: () => spectrum.memory,
        getMachineType: () => spectrum.machineType,
        getProfile: () => spectrum.profile,
        getAutoMapData: () => spectrum.getAutoMapData(),
        getPagingState: () => spectrum.memory.getPagingState(),
        getCurrentBank: () => spectrum.memory.currentBank || 0,
        readMemory,
        regionManager,
        labelManager,
        getDisasm: () => disasm,
        is128kCompat,
        appVersion: APP_VERSION
    });

    // Step controls (extracted to ui/step-controls.js)
    const stepControlsAPI = initStepControls({
        getSpectrum: () => spectrum, traceManager, commentManager,
        getTraceViewAddress: () => traceViewAddress,
        setTraceViewAddress: (v) => { traceViewAddress = v; },
        getStepOverLimit: () => displayAPI.getStepOverLimit(),
        showMessage, showRomModal, openDebuggerPanel,
        updateDebugger, updateStatus
    });

    // Assembly output (extracted to ui/assembly-output.js)
    const { generateAssemblyOutput } = initAssemblyOutput({
        getSpectrum: () => spectrum, getDisasm: () => disasm,
        labelManager, regionManager, commentManager,
        appVersion: APP_VERSION
    });

    // Disasm navigation (extracted to ui/disasm-navigation.js)
    const disasmNavAPI = initDisasmNavigation({
        getSpectrum: () => spectrum, getDisasm: () => disasm, downloadFile,
        labelManager, foldManager,
        getDisasmViewAddress: () => disasmViewAddress,
        setDisasmViewAddress: (v) => { disasmViewAddress = v; },
        getDisasmLastLineAddr: () => disasmLastLineAddr,
        getRightPanelType: () => rightPanelType,
        navPushHistory, navBack, navForward, getLeftHistory, updateNavButtons,
        goToAddress, goToMemoryAddress, goToRightDisasm, goToRightMemory,
        goToRightDisasmAddress,
        getRightDisasmViewAddress: () => rightDisasmViewAddress,
        generateAssemblyOutput,
        stepControlsAPI,
        updateDebugger,
        updateRightDisassemblyView: () => updateRightDisassemblyView(),
        updateLabelsList,
        showMessage,
        DISASM_LINES, DISASM_PC_POSITION
    });

    setInterval(updateStatus, 500);

    const dialogs = initDialogs({
        labelManager, regionManager, commentManager, foldManager, undoManager,
        REGION_TYPES,
        showMessage, updateDebugger, updateLabelsList
    });
    const { showLabelDialog, showRegionDialog, showFoldDialog,
            showCommentDialog, closeLabelContextMenu } = dialogs;

    // Labels panel (extracted to ui/labels-panel.js)
    initLabelsPanel({
        labelManager, undoManager,
        showLabelDialog, showMessage,
        updateLabelsList, updateDebugger, navigateToAddress
    });

    const { closeMemContextMenu, closeLeftMemContextMenu } = initMemContext({
        labelManager, regionManager, undoManager,
        REGION_TYPES,
        getSpectrum: () => spectrum,
        dialogs,
        showMessage, updateDebugger, updateLabelsList,
        goToLeftDisasm, goToRightDisasm, goToLeftMemory, goToRightMemory,
        addWatch,
        addFreezeEditor: (addr, name) => pokeManagerAPI.addFreezeEditor(addr, name),
        getMemSelection: () => memoryViewAPI.getMemSelection(),
        getAsciiSelection: () => memoryViewAPI.getAsciiSelection(),
        clearMemSelection,
        clearAsciiSelection,
        getMemoryEditingAddr: () => memoryViewAPI.getMemoryEditingAddr(),
        finishCurrentEdit
    });

    const { hideXRefTooltip } = initDisasmContext({
        labelManager, regionManager, commentManager, operandFormatManager,
        subroutineManager, foldManager, undoManager, xrefManager,
        REGION_TYPES, OPERAND_FORMATS,
        dialogs,
        closeMemContextMenu, closeLeftMemContextMenu,
        showMessage, updateDebugger, updateLabelsList,
        goToLeftDisasm, goToRightDisasm, goToLeftMemory, goToRightMemory,
        getRightPanelType: () => rightPanelType,
        readMemory,
        addPoke: pokeManagerAPI.addPoke,
        getInstrLength: (addr) => disasm ? disasm.disassemble(addr).length : 1,
        getDisasmSelection: () => disasmNavAPI.getSelectionRange()
    });

    // Trigger handlers (extracted to ui/trigger-handlers.js)
    initTriggerHandlers({
        getSpectrum: () => spectrum,
        setDisasmViewAddress: (addr) => { disasmViewAddress = addr; },
        showMessage, updateDebugger, updateStatus, openDebuggerPanel,
        goToAddress, goToMemoryAddress
    });

    // Global hotkeys for debugger (extracted to ui/keyboard-shortcuts.js, init call below after mapperAPI)

    btnReset.addEventListener('click', () => {
        if (!confirm('Reset machine? This will lose current state.')) return;
        stopActiveTools();
        spectrum.reset();
        // Keep the chosen border size preset across a reset
        if (spectrum.ula.setBorderPreset(borderSizeSelect.value)) {
            spectrum.updateDisplayDimensions();
            updateCanvasSize();
        }
        // Hide media indicators (tape/disk cleared on reset)
        document.getElementById('diskActivity').style.display = 'none';
        document.getElementById('tapeInfo').style.display = 'none';
        document.getElementById('diskInfo').style.display = 'none';
        mediaCatalogAPI.clearDiskCatalog();
        mediaCatalogAPI.buildTapeCatalog();
        mediaCatalogAPI.updateTapeSlotTabs();
        mediaCatalogAPI.updateRecordingStatus();
        updateSecondScreenOptions();
        updateSecondScreenVisibility();
        showMessage('Machine reset');
    });

    document.getElementById('btnScreenshot').addEventListener('click', () => {
        if (exportSelectedLoop()) return;
        const format = document.getElementById('frameExportFormat').value;
        const baseName = getExportBaseName() || 'screenshot';
        const timestamp = Date.now();

        if (format === 'png') {
            const canvas = document.getElementById('screen');
            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${baseName}_${timestamp}.png`;
                a.click();
                URL.revokeObjectURL(url);
                showMessage('Screenshot saved as PNG');
            }, 'image/png');
        } else if (format === 'scr') {
            // Export SCR - with ULAplus palette if active and modified
            const { data, msg } = createScrData();
            const blob = new Blob([data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${baseName}_${timestamp}.scr`;
            a.click();
            URL.revokeObjectURL(url);
            showMessage(msg);
        } else if (format === 'gif') {
            // GIF (flash): 2-frame animated GIF if flash content, otherwise still image
            const canvas = document.getElementById('screen');
            const w = canvas.width, h = canvas.height;
            const savedFlash = spectrum.ula.flashState;
            const savedCounter = spectrum.ula.frameCounter;

            spectrum.ula.frameCounter = 0;
            spectrum.ula.flashState = false;
            spectrum.renderToScreen();
            const imgData1 = canvas.getContext('2d').getImageData(0, 0, w, h);

            spectrum.ula.frameCounter = 0;
            spectrum.ula.flashState = true;
            spectrum.renderToScreen();
            const imgData2 = canvas.getContext('2d').getImageData(0, 0, w, h);

            spectrum.ula.frameCounter = savedCounter;
            spectrum.ula.flashState = savedFlash;
            spectrum.renderToScreen();

            // Check if frames differ (flash is visible)
            let hasFlash = false;
            for (let i = 0; i < imgData1.data.length; i++) {
                if (imgData1.data[i] !== imgData2.data[i]) { hasFlash = true; break; }
            }

            const fn = `${baseName}_${timestamp}.gif`;
            setTimeout(() => {
                const gif = new GifEncoder(w, h);
                if (hasFlash) {
                    gif.addFrame(imgData1.data, 32); // 320ms per phase
                    gif.addFrame(imgData2.data, 32);
                } else {
                    gif.addFrame(imgData1.data, 0); // Still image
                }
                const gifData = gif.finish();
                downloadFile(fn, gifData);
                showMessage(hasFlash ? 'GIF saved (2-frame flash)' : 'GIF saved (still image)');
            }, 20);
        } else if (format === 'bsc') {
            // BSC requires frame capture - start single frame capture
            showMessage('Use Start/Stop for BSC format', 'info');
        } else {
            // Other formats (zip, sca) need frame sequence
            showMessage(`Use Start/Stop for ${format.toUpperCase()} format`, 'info');
        }
    });

    // Helper: build .scr bytes from the current screen — 6912 bytes, plus the
    // 64-byte ULAplus palette appended when an active, modified palette exists.
    function createScrData() {
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
        return { data, msg };
    }

    // Helper: capture screen canvas with configurable crop, zoom, and overlay
    function captureScreenCanvas(size, zoom, includeOverlay) {
        const screenCanvas = document.getElementById('screen');
        const dims = spectrum.ula.getDimensions();
        let sx, sy, sw, sh;
        if (size === 'screen') {
            sx = dims.borderLeft;
            sy = dims.borderTop;
            sw = 256;
            sh = 192;
        } else {
            sx = 0;
            sy = 0;
            sw = dims.width;
            sh = dims.height;
        }
        const outW = sw * zoom;
        const outH = sh * zoom;
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = outW;
        tmpCanvas.height = outH;
        const ctx = tmpCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(screenCanvas, sx, sy, sw, sh, 0, 0, outW, outH);
        if (includeOverlay && spectrum.overlayMode !== 'none') {
            const ovCanvas = document.getElementById('overlayCanvas');
            const curZoom = getCurrentZoom();
            ctx.drawImage(ovCanvas, sx * curZoom, sy * curZoom, sw * curZoom, sh * curZoom, 0, 0, outW, outH);
        }
        return tmpCanvas;
    }

    // Batch screenshot buffer: {name, data} entries for ZIP export
    const screenshotBatch = [];

    function updateBatchCount() {
        const el = document.getElementById('screenshotBatchCount');
        if (screenshotBatch.length > 0) {
            el.textContent = `(${screenshotBatch.length})`;
            el.style.display = '';
        } else {
            el.style.display = 'none';
        }
    }

    function saveBatchAsZip() {
        if (screenshotBatch.length === 0) {
            showMessage('No screenshots in batch');
            return;
        }
        const baseName = getExportBaseName() || 'screenshot';
        const zipData = createZip(screenshotBatch);
        downloadFile(`${baseName}_batch.zip`, zipData);
        showMessage(`ZIP saved (${screenshotBatch.length} files)`);
        screenshotBatch.length = 0;
        updateBatchCount();
    }

    // Expose saveBatchAsZip for keyboard shortcut access
    window._screenshotSaveBatchAsZip = saveBatchAsZip;

    // Auto-capture state
    let autoCaptureActive = false;
    let autoCaptureFrameCounter = 0;
    let autoCaptureSeqNum = 0;
    let autoCaptureSavedOnFrame = null;
    let autoCaptureIntervalFrames = 50;

    function startAutoCapture() {
        const interval = parseFloat(document.getElementById('screenshotInterval').value) || 50;
        const unit = document.getElementById('screenshotIntervalUnit').value;
        autoCaptureIntervalFrames = unit === 'seconds' ? Math.max(1, Math.round(interval * 50)) : Math.max(1, Math.round(interval));
        autoCaptureFrameCounter = 0;
        autoCaptureSeqNum = screenshotBatch.length;

        autoCaptureSavedOnFrame = spectrum.onFrame;
        spectrum.onFrame = (fc) => {
            autoCaptureFrameCounter++;
            if (autoCaptureFrameCounter >= autoCaptureIntervalFrames) {
                autoCaptureFrameCounter = 0;
                autoCaptureOneFrame();
            }
            if (autoCaptureSavedOnFrame) autoCaptureSavedOnFrame(fc);
        };

        autoCaptureActive = true;
        const format = document.getElementById('screenshotFormat').value;
        let msg = `Auto-capture started (every ${interval} ${unit})`;
        if (format === 'gif') msg += ' — using PNG (GIF flash N/A in batch)';
        showMessage(msg);
    }

    function stopAutoCapture() {
        spectrum.onFrame = autoCaptureSavedOnFrame;
        autoCaptureSavedOnFrame = null;
        autoCaptureActive = false;
        showMessage(`Auto-capture stopped (${screenshotBatch.length} screenshots)`);
    }

    function autoCaptureOneFrame() {
        const format = document.getElementById('screenshotFormat').value;
        const size = document.getElementById('screenshotSize').value;
        const zoom = parseInt(document.getElementById('screenshotZoom').value, 10);
        const includeOverlay = document.getElementById('chkScreenshotOverlay').checked;
        const baseName = getExportBaseName() || 'screenshot';
        const seq = String(autoCaptureSeqNum++).padStart(5, '0');

        if (format === 'gigascr') {
            if (spectrum.memory.profile.ramPages === 1) {
                // 48K fallback — capture as SCR
                const data = new Uint8Array(6912);
                for (let i = 0; i < 6912; i++) data[i] = spectrum.memory.read(0x4000 + i);
                screenshotBatch.push({ name: `${baseName}_${seq}.scr`, data });
            } else {
                const data = new Uint8Array(13824);
                data.set(spectrum.memory.ram[5].subarray(0, 6912), 0);
                data.set(spectrum.memory.ram[7].subarray(0, 6912), 6912);
                screenshotBatch.push({ name: `${baseName}_${seq}.img`, data });
            }
        } else if (format === 'scr') {
            const { data } = createScrData();
            screenshotBatch.push({ name: `${baseName}_${seq}.scr`, data });
        } else {
            // PNG (also used for GIF mode — flash GIF per frame is impractical)
            const cap = captureScreenCanvas(size, zoom, includeOverlay);
            const dataUrl = cap.toDataURL('image/png');
            const bin = dataUrlToUint8Array(dataUrl);
            screenshotBatch.push({ name: `${baseName}_${seq}.png`, data: bin });
        }
        updateBatchCount();
    }

    function dataUrlToUint8Array(dataUrl) {
        const base64 = dataUrl.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    window._screenshotAutoCapture = {
        start: startAutoCapture,
        stop: stopAutoCapture,
        isActive: () => autoCaptureActive
    };

    function captureToBuffer(name, data) {
        screenshotBatch.push({ name, data: data instanceof Uint8Array ? data : new Uint8Array(data) });
        updateBatchCount();
        showMessage(`Batch: ${screenshotBatch.length} screenshot(s) buffered`);
    }

    document.getElementById('btnScreenshotMain').addEventListener('click', () => {
        const format = document.getElementById('screenshotFormat').value;
        const size = document.getElementById('screenshotSize').value;
        const zoom = parseInt(document.getElementById('screenshotZoom').value, 10);
        const includeOverlay = document.getElementById('chkScreenshotOverlay').checked;
        const batch = document.getElementById('chkScreenshotBatch').checked;
        const baseName = getExportBaseName() || 'screenshot';
        const timestamp = Date.now();

        if (format === 'scr') {
            // SCR: raw 6912 bytes from $4000 — zoom/size/overlay don't apply
            const { data, msg } = createScrData();
            const fn = `${baseName}_${timestamp}.scr`;
            if (batch) {
                captureToBuffer(fn, data);
            } else {
                const blob = new Blob([data], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fn;
                a.click();
                URL.revokeObjectURL(url);
                showMessage(msg);
            }
        } else if (format === 'gif') {
            // GIF (flash): 2-frame animated GIF showing both flash phases
            const savedFlash = spectrum.ula.flashState;
            const savedCounter = spectrum.ula.frameCounter;

            spectrum.ula.frameCounter = 0;
            spectrum.ula.flashState = false;
            spectrum.renderToScreen();
            const cap1 = captureScreenCanvas(size, zoom, includeOverlay);
            const imgData1 = cap1.getContext('2d').getImageData(0, 0, cap1.width, cap1.height);

            spectrum.ula.frameCounter = 0;
            spectrum.ula.flashState = true;
            spectrum.renderToScreen();
            const cap2 = captureScreenCanvas(size, zoom, includeOverlay);
            const imgData2 = cap2.getContext('2d').getImageData(0, 0, cap2.width, cap2.height);

            spectrum.ula.frameCounter = savedCounter;
            spectrum.ula.flashState = savedFlash;
            spectrum.renderToScreen();

            showMessage('Encoding GIF...');
            const w = cap1.width, h = cap1.height;
            const fn = `${baseName}_${timestamp}.gif`;
            setTimeout(() => {
                const gif = new GifEncoder(w, h);
                gif.addFrame(imgData1.data, 32);
                gif.addFrame(imgData2.data, 32);
                const gifData = gif.finish();
                if (batch) {
                    captureToBuffer(fn, gifData);
                } else {
                    downloadFile(fn, gifData);
                    showMessage('GIF screenshot saved');
                }
            }, 20);
        } else if (format === 'gigascr') {
            // Gigascreen: two sequential SCR frames from banks 5 and 7 (13824 bytes, .img)
            if (spectrum.memory.profile.ramPages === 1) {
                // 48K has no second screen bank — fall back to regular SCR
                const data = new Uint8Array(6912);
                for (let i = 0; i < 6912; i++) {
                    data[i] = spectrum.memory.read(0x4000 + i);
                }
                const fn = `${baseName}_${timestamp}.scr`;
                if (batch) {
                    captureToBuffer(fn, data);
                } else {
                    downloadFile(fn, data);
                }
                showMessage('48K: no second screen bank — saved as SCR (6912 bytes)');
            } else {
                const data = new Uint8Array(13824);
                data.set(spectrum.memory.ram[5].subarray(0, 6912), 0);
                data.set(spectrum.memory.ram[7].subarray(0, 6912), 6912);
                const fn = `${baseName}_${timestamp}.img`;
                if (batch) {
                    captureToBuffer(fn, data);
                } else {
                    downloadFile(fn, data);
                }
                showMessage('Gigascreen saved (13824 bytes)');
            }
        } else {
            // PNG
            const tmpCanvas = captureScreenCanvas(size, zoom, includeOverlay);
            const fn = `${baseName}_${timestamp}.png`;
            if (batch) {
                tmpCanvas.toBlob((blob) => {
                    blob.arrayBuffer().then(buf => {
                        captureToBuffer(fn, new Uint8Array(buf));
                    });
                }, 'image/png');
            } else {
                tmpCanvas.toBlob((blob) => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fn;
                    a.click();
                    URL.revokeObjectURL(url);
                    showMessage('PNG screenshot saved');
                }, 'image/png');
            }
        }
    });

    // Screenshot button settings: persist to localStorage
    function updateScreenshotControls() {
        const fmt = document.getElementById('screenshotFormat').value;
        const isRaw = fmt === 'scr' || fmt === 'gigascr';
        document.getElementById('screenshotImageOptions').style.display = isRaw ? 'none' : '';
    }
    function saveScreenshotSettings() {
        storageSet('zxm8_screenshot', JSON.stringify({
            format: document.getElementById('screenshotFormat').value,
            size: document.getElementById('screenshotSize').value,
            zoom: document.getElementById('screenshotZoom').value,
            overlay: document.getElementById('chkScreenshotOverlay').checked,
            batch: document.getElementById('chkScreenshotBatch').checked,
            interval: document.getElementById('screenshotInterval').value,
            intervalUnit: document.getElementById('screenshotIntervalUnit').value
        }));
    }
    function loadScreenshotSettings() {
        const json = storageGet('zxm8_screenshot');
        if (json) {
            try {
                const s = JSON.parse(json);
                if (s.format) document.getElementById('screenshotFormat').value = s.format;
                if (s.size) document.getElementById('screenshotSize').value = s.size;
                if (s.zoom) document.getElementById('screenshotZoom').value = s.zoom;
                if (s.overlay !== undefined) document.getElementById('chkScreenshotOverlay').checked = s.overlay;
                if (s.batch !== undefined) document.getElementById('chkScreenshotBatch').checked = s.batch;
                if (s.interval) document.getElementById('screenshotInterval').value = s.interval;
                if (s.intervalUnit) {
                    document.getElementById('screenshotIntervalUnit').value = s.intervalUnit;
                    document.getElementById('screenshotInterval').step = s.intervalUnit === 'seconds' ? 'any' : '1';
                }
            } catch (e) { /* ignore corrupt data */ }
        }
    }
    loadScreenshotSettings();
    updateScreenshotControls();
    document.getElementById('screenshotFormat').addEventListener('change', () => { saveScreenshotSettings(); updateScreenshotControls(); });
    document.getElementById('screenshotSize').addEventListener('change', saveScreenshotSettings);
    document.getElementById('screenshotZoom').addEventListener('change', saveScreenshotSettings);
    document.getElementById('chkScreenshotOverlay').addEventListener('change', saveScreenshotSettings);
    document.getElementById('chkScreenshotBatch').addEventListener('change', saveScreenshotSettings);
    document.getElementById('screenshotInterval').addEventListener('change', saveScreenshotSettings);
    document.getElementById('screenshotIntervalUnit').addEventListener('change', () => {
        const intervalInput = document.getElementById('screenshotInterval');
        if (document.getElementById('screenshotIntervalUnit').value === 'frames') {
            intervalInput.step = '1';
            intervalInput.value = Math.max(1, Math.round(parseFloat(intervalInput.value) || 50));
        } else {
            intervalInput.step = 'any';
        }
        saveScreenshotSettings();
    });

    // Load dropdown handler
    loadSelect.addEventListener('change', (e) => {
        const action = e.target.value;
        e.target.selectedIndex = 0; // Reset dropdown
        e.target.blur(); // release focus so typing doesn't navigate the dropdown
        if (!action) return;

        if (action === 'file') {
            document.getElementById('fileInput').click();
        } else if (action === 'browse') {
            gameBrowserAPI.open();
        } else if (action === 'quick') {
            displayAPI.quickload();
        }
    });

    // Save dropdown handler
    saveSelect.addEventListener('change', (e) => {
        const action = e.target.value;
        e.target.selectedIndex = 0; // Reset dropdown
        e.target.blur(); // release focus so typing doesn't navigate the dropdown
        if (!action) return;

        if (action === 'project') {
            saveProject();
        } else if (action === 'quick') {
            displayAPI.quicksave();
        } else if (action === 'dsk') {
            try {
                if (!spectrum.fdc) {
                    showMessage('DSK save requires ZX Spectrum +3', 'error');
                    return;
                }
                // Find first drive with a disk
                let driveIdx = -1;
                for (let i = 0; i < 2; i++) {
                    if (spectrum.fdc.drives[i].disk) { driveIdx = i; break; }
                }
                if (driveIdx < 0) {
                    showMessage('No disk in FDC drive', 'error');
                    return;
                }
                const dskImage = spectrum.fdc.drives[driveIdx].disk;
                const data = dskImage.toBuffer();
                const name = (spectrum.loadedFDCDisks[driveIdx] && spectrum.loadedFDCDisks[driveIdx].name) || 'disk.dsk';
                const blob = new Blob([data], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = name.toLowerCase().endsWith('.dsk') ? name : name + '.dsk';
                a.click();
                URL.revokeObjectURL(url);
                showMessage(`DSK saved (drive ${String.fromCharCode(65 + driveIdx)})`);
            } catch (err) {
                showMessage('Failed to save DSK: ' + err.message, 'error');
            }
        } else if (action === 'trd') {
            try {
                if (!spectrum.betaDisk) {
                    showMessage('No Beta Disk interface', 'error');
                    return;
                }
                // Use the drive selected in Settings → Disk
                const driveIdx = getSelectedDriveIndex ? getSelectedDriveIndex() : 0;
                if (!spectrum.betaDisk.drives[driveIdx].diskData) {
                    showMessage(`No disk in drive ${String.fromCharCode(65 + driveIdx)} (select drive in Settings → Disk)`, 'error');
                    return;
                }
                // Live image (TRD format, includes all TR-DOS writes)
                const trdData = spectrum.betaDisk.drives[driveIdx].diskData;
                const loaded = spectrum.loadedBetaDisks[driveIdx];
                let name = (loaded && loaded.name) || 'disk.trd';
                // Keep the original format: disks loaded from .scl save back as SCL
                const asScl = name.toLowerCase().endsWith('.scl');
                const data = asScl ? spectrum.betaDisk.trdToScl(trdData) : trdData;
                if (!asScl && !name.toLowerCase().endsWith('.trd')) {
                    name = name.replace(/[\[\]]/g, '') + '.trd';
                }
                downloadFile(name, data);
                showMessage(`${asScl ? 'SCL' : 'TRD'} saved (drive ${String.fromCharCode(65 + driveIdx)})`);
            } catch (err) {
                showMessage('Failed to save disk: ' + err.message, 'error');
            }
        } else {
            // Save snapshot (sna, z80, szx)
            try {
                const profile = getMachineProfile(spectrum.machineType);
                // Warn if format can't preserve all RAM pages
                if (action !== 'szx' && profile.ramPages > 8) {
                    showMessage(`${action.toUpperCase()} format limited to 8 RAM pages — ${profile.ramPages - 8} pages will be lost. Use SZX for full save.`, 'warning');
                }
                const data = spectrum.saveSnapshot(action);
                const blob = new Blob([data], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `snapshot_${spectrum.machineType}.${action}`;
                a.click();
                URL.revokeObjectURL(url);
                showMessage(`Snapshot saved as ${action.toUpperCase()}`);
            } catch (err) {
                showMessage('Failed to save: ' + err.message, 'error');
            }
        }
    });

    // Project save/load (extracted to ui/project-io.js, init call below after mediaCatalogAPI)
    let saveProject, loadProject;

    
    machineSelect.addEventListener('change', () => {
        stopActiveTools();
        const type = machineSelect.value;

        // Check if we have the required ROM - open ROM dialog if not
        const profile = getMachineProfile(type);
        if (type !== '48k' && !romData[profile.romFile]) {
            showMessage(profile.name + ' ROM not loaded. Please select the ROM file.', 'error');
            machineSelect.value = spectrum.machineType;
            showRomModal();
            return;
        }

        const wasRunning = spectrum.isRunning();
        if (wasRunning) spectrum.stop();
        
        spectrum.setMachineType(type);
        storageSet('zxm8_machine', type);
        applyRomsToEmulator();
        // Re-apply border preset setting to new ULA
        spectrum.ula.setBorderPreset(borderSizeSelect.value);
        spectrum.updateDisplayDimensions();
        updateCanvasSize();
        // Re-apply palette to new ULA
        if (displayAPI) {
            displayAPI.applyPalette(displayAPI.getPaletteValue());
        }
        // Update ULAplus status (palette was reset in setMachineType)
        if (displayAPI) {
            displayAPI.updateULAplusStatus();
            // Snow needs contended memory — the note says so per machine
            if (displayAPI.updateUlaSnowStatus) displayAPI.updateUlaSnowStatus();
            // Same for the ink edge skew — the Ferranti machines only
            if (displayAPI.updateInkSkewStatus) displayAPI.updateInkSkewStatus();
            // …and the composite filter, which only stands still on a locked clock
            if (displayAPI.updatePalCompositeStatus) displayAPI.updatePalCompositeStatus();
        }
        spectrum.reset();
        disasm = null; // Reset to use fresh memory reference

        // Update Beta Disk status (always on for Pentagon machines)
        if (profile.betaDiskDefault) {
            spectrum.betaDiskEnabled = true;
        }
        spectrum.updateBetaDiskPagingFlag();
        updateBetaDiskStatus();
        updatePlusDStatus();
        updateIF1Status();
        diskActivityAPI.setup();

        if (wasRunning) {
            spectrum.start();
        } else {
            spectrum.runFrame();
        }

        updateSecondScreenOptions();
        updateSecondScreenVisibility();
        if (typeof updateGraphicsViewer === 'function') updateGraphicsViewer();
        // Compare's memory regions are addressed per machine (banks, or plain 64K)
        if (compareAPI) compareAPI.refreshMachine();
        showMessage(`Switched to ${type.toUpperCase()}`);
        updateStatus();
    });
    
    speedSelect.addEventListener('change', () => {
        const speed = parseInt(speedSelect.value, 10);
        spectrum.setSpeed(speed);
        const label = speed === 0 ? 'Max' : speed + '%';
        showMessage(`Speed: ${label}`);
        speedSelect.blur(); // release focus so typing goes to the emulator, not the dropdown
    });
    
    // Input & Mouse Settings (extracted to ui/input-settings.js)
    const { saveInputSettings, updateBetaDiskStatus, updatePlusDStatus, updateIF1Status, updateMouseStatus, gamepadAPI, bootAPI } =
        initInputSettings({
            getSpectrum: () => spectrum,
            getCanvas: () => canvas,
            romData,
            showMessage,
            initGamepad,
            initBootManager,
            onDiskSystemsChanged: () => { if (updateDriveSelector) updateDriveSelector(); }
        });

    // Autofire (extracted to ui/autofire.js)
    const autofireAPI = initAutofire({
        getSpectrum: () => spectrum,
        showMessage
    });

    // Set up boot TRD callback for injection during disk loading
    spectrum.onBeforeTrdLoad = (data, filename) => bootAPI.processTrdWithBoot(data, filename);

    // Media Catalog (extracted to ui/media-catalog.js)
    const mediaCatalogAPI = initMediaCatalog({
        getSpectrum: () => spectrum,
        showMessage,
        downloadFile,
        updateDriveSelector: (...args) => updateDriveSelector(...args),
        openInExplorer: async (data, filename) => {
            await explorerAPI.loadData(data, filename);
            // Switch to Utils main tab
            const utilsBtn = document.querySelector('.tab-btn[data-tab="tools"]');
            if (utilsBtn && !utilsBtn.classList.contains('active')) utilsBtn.click();
            // Switch to Explorer sub-tab
            document.querySelector('.tools-subtab-btn[data-toolstab="explorer"]').click();
        }
    });

    // Tape SAVE trap — update recording UI on each saved block
    spectrum.tapeSaveTrap.onBlockSaved = (tapBlock, flag) => {
        spectrum.tapeRecordings[spectrum.activeTapeSlot].push(tapBlock);
        mediaCatalogAPI.updateRecordingStatus();
        const type = flag === 0x00 ? 'Header' : 'Data';
        showMessage(`Saved ${type} block (${tapBlock.length - 2} bytes)`);
    };

    // MIC recorder — update recording UI on each completed block
    spectrum.micRecorder.onBlockRecorded = (block) => {
        spectrum.micRecordings[spectrum.activeTapeSlot].push(block);
        mediaCatalogAPI.updateRecordingStatus();
        showMessage(`MIC: Recorded block (${block.pulses.length} pulses)`);
    };

    // Auto-Loader (extracted to ui/auto-loader.js)
    const autoLoaderAPI = initAutoLoader({ getSpectrum: () => spectrum });

    // Deterministic headless auto-load/boot for window.zxDebug (see docs/automation.md).
    // Reuses the frame-driven auto-loader but skips its rAF start() and pumps
    // runFrame() itself, so it advances step-for-step under a headless harness.
    // A tape/disk must already be loaded (e.g. via zxDebug.loadFile). Resolves
    // once the typed sequence finishes plus a settle window for the load to run.
    // The POKE manager, for drivers and tests: .loadPokFile(text, name) loads a
    // community .pok cheat file, .loadPokeJSON(text) the native format.
    window.zxDebug.pokes = pokeManagerAPI;

    // Save-state slots and quicksave, for drivers and tests.
    window.zxDebug.getDisplayAPI = () => displayAPI;
    // The ASM project (addProjectFiles, editor state) and its virtual filesystem,
    // so a driver or test can inspect what a build will actually see.
    window.zxDebug.getAsmAPI = () => asmAPI;
    window.zxDebug.vfs = VFS;
    window.zxDebug.assembler = Assembler;

    window.zxDebug.autoLoad = async function (opts = {}) {
        const {
            type = 'tape',          // 'tape' | 'trd' | 'dsk'
            isTzx = false,
            diskRun = null,          // TR-DOS: filename to RUN, or null → boot file
            maxFrames = 3000,
            settleFrames = 400
        } = opts;
        spectrum.stop();
        if (type === 'trd') {
            if (diskRun) autoLoaderAPI.startAutoLoadDiskRun(diskRun, { headless: true });
            else autoLoaderAPI.startAutoLoadDisk({ headless: true });
        } else if (type === 'dsk') {
            autoLoaderAPI.startAutoLoadPlus3Disk({ headless: true });
        } else {
            autoLoaderAPI.startAutoLoadTape(isTzx, { headless: true });
        }
        let f = 0;
        // Pump until the typed key sequence has finished...
        while (autoLoaderAPI.isActive() && f < maxFrames) { spectrum.runFrame(); f++; }
        // ...then a settle window so the ROM actually executes LOAD / boots.
        for (let i = 0; i < settleFrames && f < maxFrames; i++, f++) spectrum.runFrame();
        return { frames: f, pc: spectrum.cpu.pc, timedOut: f >= maxFrames };
    };

    // Clickable on-screen ZX keyboard (extracted to ui/virtual-keyboard.js)
    initVirtualKeyboard({ getSpectrum: () => spectrum, appVersion: APP_VERSION });

    // Stop all active debug/analysis tools (used on project load, file load, reset, machine change)
    function stopActiveTools() {
        autoLoaderAPI.cancelAutoLoad();
        autofireAPI.stopAutofire();
        pokeSearchAPI.stopTracing();
        pokeSearchAPI.stopWriteMonitor();
        pokeSearchAPI.stopReadMonitor();
        pokeSearchAPI.stopComparisonBreakpoint();
        pokeSearchAPI.stopRegisterTracker();
        structMapperAPI.stopMapping();
        codePathAPI.stopRecording();
        profilerAPI.clearResults();
        if (window._screenshotAutoCapture && window._screenshotAutoCapture.isActive()) {
            window._screenshotAutoCapture.stop();
        }
    }

    // Project save/load (extracted to ui/project-io.js)
    ({ saveProject, loadProject } = initProjectIO({
        getSpectrum: () => spectrum,
        labelManager, regionManager, commentManager,
        xrefManager, subroutineManager, foldManager,
        operandFormatManager, traceManager,
        getDisplayAPI: () => displayAPI,
        getAutoLoaderAPI: () => autoLoaderAPI,
        getPokeManagerAPI: () => pokeManagerAPI,
        getStopActiveTools: () => stopActiveTools,
        getAsmAPI: () => asmAPI,
        getAnalysisAPI: () => analysisAPI,
        getPortLoggingAPI: () => portLoggingAPI,
        getMediaCatalogAPI: () => mediaCatalogAPI,
        getGamepadAPI: () => gamepadAPI,
        VFS,
        getDisasmViewAddress: () => disasmViewAddress,
        setDisasmViewAddress: (v) => { disasmViewAddress = v; },
        getMemoryViewAddress: () => memoryViewAddress,
        setMemoryViewAddress: (v) => { memoryViewAddress = v; },
        getLeftMemoryViewAddress: () => leftMemoryViewAddress,
        setLeftMemoryViewAddress: (v) => { leftMemoryViewAddress = v; },
        getRightDisasmViewAddress: () => rightDisasmViewAddress,
        setRightDisasmViewAddress: (v) => { rightDisasmViewAddress = v; },
        getLeftPanelType: () => leftPanelType,
        getRightPanelType: () => rightPanelType,
        getLeftBookmarks: () => leftBookmarks,
        setLeftBookmarks: (v) => { leftBookmarks = v; disasmBookmarks = leftBookmarks; },
        getRightBookmarks: () => rightBookmarks,
        setRightBookmarks: (v) => { rightBookmarks = v; memoryBookmarks = rightBookmarks; },
        getTraceViewAddress: () => traceViewAddress,
        setTraceViewAddress: (v) => { traceViewAddress = v; },
        setDisasm: (v) => { disasm = v; },
        showMessage, updateStatus, updateDebugger,
        updateMemoryView, updateBreakpointList,
        updateWatchpointList, updatePortBreakpointList,
        updateLabelsList, updateRZXStatus,
        updateMediaIndicator: (...args) => updateMediaIndicator(...args),
        updateBookmarkButtons,
        updateCanvasSize,
        switchLeftPanelType, switchRightPanelType,
        setZoom, isDarkTheme, setDarkTheme, setUiScale, getUiScale,
        applyRomsToEmulator,
        getWatches, setWatches, saveWatches, renderWatches,
        getUpdateGraphicsViewer: () => updateGraphicsViewer,
        getUpdateMouseStatus: () => updateMouseStatus,
        getCodePathAPI: () => codePathAPI,
        getStructMapperAPI: () => structMapperAPI
    }));

    // Display settings (extracted to ui/display-settings.js)
    displayAPI = initDisplaySettings({
        getSpectrum: () => spectrum,
        showMessage,
        getHandleLoadResult: () => handleLoadResult,
        updateCanvasSize
    });

    // File Loader (extracted to ui/file-loader.js)
    ({ handleLoadResult, updateMediaIndicator, updateDriveSelector, getSelectedDriveIndex } =
        initFileLoader({
            getSpectrum: () => spectrum,
            romData,
            getAutoLoaderAPI: () => autoLoaderAPI,
            getStopActiveTools: () => stopActiveTools,
            getMediaCatalogAPI: () => mediaCatalogAPI,
            getAnalysisAPI: () => analysisAPI,
            getDisplayAPI: () => displayAPI,
            getLoadProject: () => loadProject,
            getBootAPI: () => bootAPI,
            labelManager, regionManager, commentManager,
            xrefManager, operandFormatManager, subroutineManager,
            showMessage,
            updateRZXStatus, updateStatus, updateDebugger,
            openDebuggerPanel, updateCanvasSize,
            loadRomsForMachineType,
            showRomModal, isRomModalVisible,
            setDisasm: (v) => { disasm = v; }
        }));

    // Frame Export & PSG Recording (extracted to ui/frame-export.js)
    const { getExportBaseName, GifEncoder, createZip, exportSelectedLoop } = initFrameExport({
        getScreenCanvas: () => canvas,
        getDimensions: () => spectrum.ula.getDimensions(),
        getUlaPlusState: () => ({
            enabled: spectrum.ula.ulaplus.enabled,
            paletteEnabled: spectrum.ula.ulaplus.paletteEnabled,
            paletteModified: spectrum.ula.ulaplus.paletteModified,
            palette: spectrum.ula.ulaplus.palette
        }),
        getMemoryBlock: (start, length) => spectrum.memory.getBlock(start, length),
        readMemory,
        isRunning: () => spectrum.isRunning(),
        startEmulator: () => spectrum.start(),
        stopEmulator: () => spectrum.stop(),
        setOnFrame: (cb) => { spectrum.onFrame = cb; },
        getAy: () => spectrum.ay,
        showMessage,
        getRAMPage: (page) => spectrum.memory.ram[page],
        getRamPages: () => spectrum.memory.profile.ramPages,
        getActiveScreenData: () => {
            if (spectrum.memory.profile.ramPages <= 1) {
                return spectrum.memory.getBlock(0x4000, 6912);
            }
            return spectrum.memory.ram[spectrum.memory.screenBank || 5].subarray(0, 6912);
        }
    });

    // RZX Recording (extracted to ui/rzx-recorder.js)
    initRzxRecorder({
        getSpectrum: () => spectrum,
        getExportBaseName,
        showMessage
    });

    // PSG player (extracted to ui/psg-player.js)
    initPsgPlayer({ showMessage });

    // Binary export/load
    {
        const binStart = document.getElementById('binExportStart');
        const binLength = document.getElementById('binExportLength');
        const binEnd = document.getElementById('binExportEnd');
        const binStatus = document.getElementById('binStatus');
        let lastEditedField = 'length'; // track whether user last edited Length or End

        function parseBinHex(input) {
            const v = parseInt(input.value, 16);
            return isNaN(v) ? -1 : v;
        }

        function syncBinFields(source) {
            const start = parseBinHex(binStart);
            if (start < 0 || start > 0xFFFF) return;
            if (source === 'length') {
                let len = parseBinHex(binLength);
                if (len < 0) return;
                if (len < 1) len = 1;
                if (start + len > 0x10000) len = 0x10000 - start;
                binLength.value = hex16(len);
                binEnd.value = hex16(start + len - 1);
                lastEditedField = 'length';
            } else if (source === 'end') {
                let end = parseBinHex(binEnd);
                if (end < 0) return;
                if (end < start) end = start;
                if (end > 0xFFFF) end = 0xFFFF;
                binEnd.value = hex16(end);
                binLength.value = hex16(end - start + 1);
                lastEditedField = 'end';
            } else if (source === 'start') {
                if (lastEditedField === 'end') {
                    // Clamp end if it fell below new start
                    let end = parseBinHex(binEnd);
                    if (end >= 0 && end < start) {
                        binEnd.value = hex16(start);
                    }
                    syncBinFields('end');
                } else {
                    syncBinFields('length');
                }
            }
        }

        binStart.addEventListener('change', () => syncBinFields('start'));
        binLength.addEventListener('change', () => syncBinFields('length'));
        binEnd.addEventListener('change', () => syncBinFields('end'));

        document.getElementById('btnBinExport').addEventListener('click', () => {
            const start = parseBinHex(binStart);
            const end = parseBinHex(binEnd);
            const len = parseBinHex(binLength);
            if (start < 0 || start > 0xFFFF) {
                binStatus.textContent = 'Invalid start address';
                return;
            }
            if (end < 0 || end > 0xFFFF || end < start) {
                binStatus.textContent = 'End address must be >= start address';
                return;
            }
            if (len <= 0 || len > 0x10000) {
                binStatus.textContent = 'Invalid length';
                return;
            }
            if (start + len > 0x10000) {
                binStatus.textContent = 'Range exceeds 64K';
                return;
            }
            const data = spectrum.memory.getBlock(start, len);
            const baseName = getExportBaseName();
            const addrSuffix = '_' + hex16(start);
            downloadFile(baseName + addrSuffix + '.bin', data);
            binStatus.textContent = 'Exported ' + len + ' bytes from $' + hex16(start);
        });

        const binLoadFile = document.getElementById('binLoadFile');
        document.getElementById('btnBinLoad').addEventListener('click', () => {
            binLoadFile.click();
        });

        binLoadFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const data = new Uint8Array(reader.result);
                const start = parseBinHex(binStart);
                if (start < 0 || start > 0xFFFF) {
                    binStatus.textContent = 'Invalid start address';
                    return;
                }
                if (start + data.length > 0x10000) {
                    binStatus.textContent = 'Data exceeds 64K (start + ' + data.length + ' bytes)';
                    return;
                }
                spectrum.memory.setBlock(start, data);
                spectrum.renderToScreen();
                binStatus.textContent = 'Loaded ' + data.length + ' bytes at $' + hex16(start);
                updateDebugger();
            };
            reader.readAsArrayBuffer(file);
            binLoadFile.value = '';
        });

        // Fill the Start..End range with a single byte (default 00 — clears memory)
        const binFillByte = document.getElementById('binFillByte');
        document.getElementById('btnBinFill').addEventListener('click', () => {
            const start = parseBinHex(binStart);
            const end = parseBinHex(binEnd);
            const len = parseBinHex(binLength);
            if (start < 0 || start > 0xFFFF) {
                binStatus.textContent = 'Invalid start address';
                return;
            }
            if (end < 0 || end > 0xFFFF || end < start) {
                binStatus.textContent = 'End address must be >= start address';
                return;
            }
            if (len <= 0 || start + len > 0x10000) {
                binStatus.textContent = 'Invalid length';
                return;
            }
            const byte = parseInt(binFillByte.value, 16);
            if (isNaN(byte) || byte < 0 || byte > 0xFF) {
                binStatus.textContent = 'Invalid fill byte';
                return;
            }
            spectrum.memory.setBlock(start, new Uint8Array(len).fill(byte));
            spectrum.renderToScreen();
            updateDebugger();
            binStatus.textContent = 'Filled ' + len + ' bytes at $' + hex16(start) + ' with $' + hex8(byte);
        });

        // Screen fill patterns (Binary section). Extensible — add an entry to
        // offer a new variant in the dropdown. Each build() returns a full
        // 6912-byte screen image (6144-byte bitmap + 768-byte attributes).
        // CLEAR_ATTR = black ink on white paper, no bright/flash ($38).
        const CLEAR_ATTR = 0x38;
        // ZX bitmap byte offset of pixel (x,y) within the 6144-byte display.
        const scrOffset = (x, y) =>
            ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | (x >> 3);
        function makeScreen(bitmapFn, attr) {
            const scr = new Uint8Array(0x1B00);   // bitmap stays 0 unless filled
            if (bitmapFn) bitmapFn(scr);
            scr.fill(attr, 0x1800);
            return scr;
        }
        function fillGrid(scr) {   // 8×8 character-cell grid, black pixels
            for (let y = 0; y < 192; y++) {
                for (let x = 0; x < 256; x++) {
                    if ((x & 7) === 0 || (y & 7) === 0) scr[scrOffset(x, y)] |= (0x80 >> (x & 7));
                }
            }
        }
        function fillDiagGrid(scr) {   // grid rotated 45°: both diagonals every 8px
            for (let y = 0; y < 192; y++) {
                for (let x = 0; x < 256; x++) {
                    if (((x + y) & 7) === 0 || ((x - y) & 7) === 0) scr[scrOffset(x, y)] |= (0x80 >> (x & 7));
                }
            }
        }
        const SCREEN_PATTERNS = {
            clear: { label: 'Clear',    build: () => makeScreen(null, CLEAR_ATTR) },
            grid:  { label: 'Grid',     build: () => makeScreen(fillGrid, CLEAR_ATTR) },
            diag:  { label: 'Diagonal', build: () => makeScreen(fillDiagGrid, CLEAR_ATTR) }
        };

        const binScreenSelWrap = document.getElementById('binScreenSelWrap');
        const binScreenSel = document.getElementById('binScreenSel');
        const binPatternSel = document.getElementById('binPatternSel');
        // A machine has a shadow screen if it has a RAM bank 7 — i.e. every
        // 128K-style machine (128K/+2/+2A/+3, Pentagon, Pentagon 1024,
        // Scorpion), NOT only is128kCompat (which excludes Pentagon/Scorpion).
        const hasShadowScreen = () => !!(spectrum.memory.ram && spectrum.memory.ram[7]);
        function updateBinScreenSel() {
            binScreenSelWrap.style.display = hasShadowScreen() ? 'inline-flex' : 'none';
        }
        updateBinScreenSel();
        machineSelect.addEventListener('change', updateBinScreenSel);

        document.getElementById('btnBinScreenApply').addEventListener('click', () => {
            const pat = SCREEN_PATTERNS[binPatternSel.value];
            if (!pat) return;
            const scr = pat.build();
            const shadow = hasShadowScreen() && binScreenSel.value === 'shadow';
            // Main screen is RAM bank 5 (128K-style) or the fixed $4000
            // display (48K); shadow screen is RAM bank 7.
            const target = shadow ? spectrum.memory.ram[7] : (spectrum.memory.ram[5] || null);
            if (target) target.set(scr, 0);
            else spectrum.memory.setBlock(0x4000, scr);
            spectrum.renderToScreen();
            updateDebugger();
        });
    }

    canvas.tabIndex = 0;

    // Screen Info Popup (extracted to ui/screen-info.js)
    initScreenInfo({ getSpectrum: () => spectrum });

    // ========== Game Mapper (extracted to ui/mapper-ui.js) ==========
    const mapperAPI = initMapperUI({
        gameMapper,
        getScreenCanvas: () => document.getElementById('screen'),
        getScreenDimensions: () => spectrum.getScreenDimensions()
    });

    // Go-to-label palette (Ctrl+G, extracted to ui/goto-palette.js)
    initGotoPalette({
        labelManager, navigateToAddress, openDebuggerPanel,
        getAsmSymbols: () => asmAPI.getSourceSymbols(),
        gotoAsmLine: (path, line) => asmAPI.gotoSourceLine(path, line),
        gotoAsmLineSplit: (path, line) => asmAPI.gotoSourceLineSplit(path, line)
    });

    // Foreign assembler source importer (ALASM/TASM from TRD/SCL/ZIP)
    initImportForeign({
        TRDLoader, SCLLoader, ZipLoader, showMessage,
        addProjectFiles: (files, mainHint) => asmAPI.addProjectFiles(files, mainHint)
    });

    // Global hotkeys (extracted to ui/keyboard-shortcuts.js)
    initKeyboardShortcuts({
        getSpectrum: () => spectrum,
        getDisasm: () => disasm,
        undoManager, traceManager,
        getMapperAPI: () => mapperAPI,
        getGameMapper: () => gameMapper,
        getAutofireAPI: () => autofireAPI,
        getRegEditorAPI: () => regEditorAPI,
        getDisasmViewAddress: () => disasmViewAddress,
        setDisasmViewAddress: (v) => { disasmViewAddress = v; },
        getRightDisasmViewAddress: () => rightDisasmViewAddress,
        setRightDisasmViewAddress: (v) => { rightDisasmViewAddress = v; },
        getLeftPanelType: () => leftPanelType,
        getRightPanelType: () => rightPanelType,
        getLeftBookmarks: () => leftBookmarks,
        setLeftBookmark: (idx, val) => { leftBookmarks[idx] = val; disasmBookmarks = leftBookmarks; },
        getRightBookmarks: () => rightBookmarks,
        setRightBookmark: (idx, val) => { rightBookmarks[idx] = val; memoryBookmarks = rightBookmarks; },
        getLeftMemoryViewAddress: () => leftMemoryViewAddress,
        getMemoryViewAddress: () => memoryViewAddress,
        getTraceViewAddress: () => traceViewAddress,
        setTraceViewAddress: (v) => { traceViewAddress = v; },
        getRunToTarget: () => stepControlsAPI.getRunToTarget(),
        getStepOverLimit: () => displayAPI.getStepOverLimit(),
        showDisasmWarning: (text) => stepControlsAPI.showDisasmWarning(text),
        showMessage, updateStatus, updateDebugger,
        openDebuggerPanel,
        goToAddress, goToMemoryAddress,
        goToLeftMemoryAddress, goToRightDisasmAddress,
        switchLeftPanelType, switchRightPanelType,
        updateBookmarkButtons,
        showTraceEntry, updateTraceStatus, updateTraceList,
        setZoom, getCurrentZoom,
        DISASM_LINES, MEMORY_LINES, LEFT_MEMORY_LINES,
        getRightBytesPerLine, getLeftBytesPerLine
    });

    // Initial black screen
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Try to auto-load ROMs, show dialog only if not found
    tryLoadRomsFromDirectory();
    
