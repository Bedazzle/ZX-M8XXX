// Project Save/Load — serializes/restores all emulator state (init-function pattern, DI)

import { hex16, arrayToBase64, storageSet } from '../core/utils.js';

export function initProjectIO({
    getSpectrum,
    labelManager, regionManager, commentManager,
    xrefManager, subroutineManager, foldManager,
    operandFormatManager, traceManager,
    getDisplayAPI, getAutoLoaderAPI, getPokeManagerAPI,
    getStopActiveTools,
    getAsmAPI, getAnalysisAPI, getPortLoggingAPI,
    getMediaCatalogAPI, getGamepadAPI,
    VFS,
    getDisasmViewAddress, setDisasmViewAddress,
    getMemoryViewAddress, setMemoryViewAddress,
    getLeftMemoryViewAddress, setLeftMemoryViewAddress,
    getRightDisasmViewAddress, setRightDisasmViewAddress,
    getLeftPanelType, getRightPanelType,
    getLeftBookmarks, setLeftBookmarks,
    getRightBookmarks, setRightBookmarks,
    getTraceViewAddress, setTraceViewAddress,
    setDisasm,
    showMessage, updateStatus, updateDebugger,
    updateMemoryView, updateBreakpointList,
    updateWatchpointList, updatePortBreakpointList,
    updateLabelsList, updateRZXStatus,
    updateMediaIndicator, updateBookmarkButtons,
    updateCanvasSize,
    switchLeftPanelType, switchRightPanelType,
    setZoom, isDarkTheme, setDarkTheme,
    applyRomsToEmulator,
    getWatches, setWatches, saveWatches, renderWatches,
    getUpdateGraphicsViewer,
    getUpdateMouseStatus
}) {
    // DOM elements discovered internally
    const machineSelect = document.getElementById('machineSelect');
    const chkKempston = document.getElementById('chkKempston');
    const speedSelect = document.getElementById('speedSelect');
    const borderSizeSelect = document.getElementById('borderSizeSelect');
    const fullscreenMode = document.getElementById('fullscreenMode');
    const tabContainer = document.getElementById('tabContainer');
    const labelSourceFilter = document.getElementById('labelSourceFilter');
    const disasmAddressInput = document.getElementById('disasmAddress');
    const memoryAddressInput = document.getElementById('memoryAddress');
    const leftMemAddressInput = document.getElementById('leftMemAddress');
    const rightDisasmAddressInput = document.getElementById('rightDisasmAddress');
    const disasmBookmarksBar = document.getElementById('disasmBookmarks');
    const memoryBookmarksBar = document.getElementById('memoryBookmarks');

    function saveProject() {
        const spectrum = getSpectrum();
        const displayAPI = getDisplayAPI();
        const autoLoaderAPI = getAutoLoaderAPI();
        const pokeManagerAPI = getPokeManagerAPI();
        const asmAPI = getAsmAPI();

        try {
            // Get emulator snapshot as base64
            const snapshotData = spectrum.saveSnapshot();
            const snapshotBase64 = arrayToBase64(snapshotData);

            const disasmViewAddress = getDisasmViewAddress();
            const memoryViewAddress = getMemoryViewAddress();
            const leftMemoryViewAddress = getLeftMemoryViewAddress();
            const rightDisasmViewAddress = getRightDisasmViewAddress();
            const leftPanelType = getLeftPanelType();
            const rightPanelType = getRightPanelType();
            const leftBookmarks = getLeftBookmarks();
            const rightBookmarks = getRightBookmarks();

            // Collect all project state
            const project = {
                version: 2,  // v2 adds media storage
                timestamp: new Date().toISOString(),
                machineType: spectrum.machineType,
                snapshot: snapshotBase64,
                debugger: {
                    disasmAddress: disasmViewAddress,
                    memoryAddress: memoryViewAddress,
                    leftMemoryAddress: leftMemoryViewAddress,
                    rightDisasmAddress: rightDisasmViewAddress,
                    leftPanelType: leftPanelType,
                    rightPanelType: rightPanelType,
                    leftBookmarks: leftBookmarks.slice(),
                    rightBookmarks: rightBookmarks.slice(),
                    // Legacy format for backward compatibility
                    disasmBookmarks: leftBookmarks.slice(),
                    memoryBookmarks: rightBookmarks.slice(),
                    // Unified triggers (new format)
                    triggers: spectrum.getTriggers().map(t => {
                        const obj = {
                            type: t.type,
                            start: t.start,
                            end: t.end,
                            page: t.page,
                            mask: t.mask,
                            condition: t.condition || '',
                            enabled: t.enabled,
                            skipCount: t.skipCount || 0,
                            hitCount: t.hitCount || 0,
                            name: t.name || ''
                        };
                        if (t.type === 'screen_bitmap' || t.type === 'screen_attr') {
                            obj.col = t.col;
                            obj.row = t.row;
                            obj.w = t.w;
                            obj.h = t.h;
                            obj.pixelMode = t.pixelMode || false;
                            obj.screen = t.screen || 'normal';
                        }
                        return obj;
                    }),
                    labels: JSON.parse(labelManager.exportJSON()),
                    regions: JSON.parse(regionManager.exportJSON()),
                    comments: JSON.parse(commentManager.exportJSON()),
                    xrefs: xrefManager.exportJSON() ? JSON.parse(xrefManager.exportJSON()) : [],
                    subroutines: JSON.parse(subroutineManager.exportJSON()),
                    folds: foldManager.exportJSON() ? JSON.parse(foldManager.exportJSON()) : { userFolds: [], collapsed: [] },
                    operandFormats: operandFormatManager.getAll(),
                    watches: getWatches(),
                    portTraceFilters: spectrum.getPortTraceFilters().map(f => ({ port: f.port, mask: f.mask }))
                },
                settings: {
                    kempston: chkKempston.checked,
                    kempstonExtended: document.getElementById('chkKempstonExtended').checked,
                    gamepad: document.getElementById('chkGamepad').checked,
                    gamepadMapping: spectrum.gamepadMapping,
                    kempstonMouse: document.getElementById('chkKempstonMouse').checked,
                    mouseWheel: document.getElementById('chkMouseWheel').checked,
                    mouseSwap: document.getElementById('chkMouseSwap').checked,
                    mouseWheelSwap: document.getElementById('chkMouseWheelSwap').checked,
                    borderPreset: borderSizeSelect.value,
                    invertDisplay: document.getElementById('chkInvertDisplay').checked,
                    lateTimings: document.getElementById('chkLateTimings').checked,
                    speed: parseInt(speedSelect.value),
                    palette: displayAPI.getPaletteValue(),
                    labelDisplayMode: document.getElementById('labelDisplayMode').value,
                    showRomLabels: labelManager.showRomLabels,
                    darkTheme: isDarkTheme(),
                    debuggerOpen: !tabContainer.classList.contains('collapsed'),
                    zoom: document.querySelector('.zoom-btn.active')?.textContent.replace('x', '') || '2',
                    running: spectrum.isRunning(),
                    overlayMode: document.getElementById('overlaySelect').value,
                    fullscreenMode: fullscreenMode.value,
                    tapeFlashLoad: spectrum.getTapeFlashLoad(),
                    tapeAudioEnabled: spectrum.tapeAudioEnabled,
                    autoLoad: autoLoaderAPI.isAutoLoadEnabled(),
                    cfaSkipRom: document.getElementById('chkCfaSkipRom').checked,
                    cfaISR: document.getElementById('chkCfaISR').checked,
                    cfaEntries: document.getElementById('cfaExtraEntries').value,
                    if1Enabled: spectrum.if1Enabled
                },
                // CPU timing state (not stored in SNA format)
                cpuTiming: {
                    tStates: spectrum.cpu.tStates,
                    halted: spectrum.cpu.halted,
                    iff1: spectrum.cpu.iff1,
                    iff2: spectrum.cpu.iff2
                },
                // ULA state for rainbow border graphics
                ulaState: {
                    borderColor: spectrum.ula.borderColor,
                    borderChanges: spectrum.ula.borderChanges.slice()  // Copy of border change array
                },
                // AY-3-8910 sound chip state
                ayState: spectrum.ay ? spectrum.ay.exportState() : null
            };

            // Add source file name if loaded
            if (labelManager.currentFile) {
                project.sourceFile = labelManager.currentFile;
            }

            // Add RZX state if RZX data exists (even if paused)
            if (spectrum.getRZXData()) {
                const rzxData = spectrum.getRZXData();
                project.rzx = {
                    data: arrayToBase64(rzxData),
                    frame: spectrum.getRZXFrame(),
                    instructions: spectrum.getRZXInstructions(),
                    totalFrames: spectrum.getRZXTotalFrames()
                };
            }

            // Add loaded media (multi-drive format v2)
            const mediaState = spectrum.getLoadedMedia();
            if (mediaState) {
                project.mediaVersion = 2;
                project.media = {};

                if (mediaState.tape && mediaState.tape.data) {
                    project.media.tape = {
                        type: mediaState.tape.type,
                        name: mediaState.tape.name,
                        data: arrayToBase64(mediaState.tape.data),
                        tapeBlock: mediaState.tapeBlock
                    };
                }

                project.media.betaDisks = [];
                for (let i = 0; i < 4; i++) {
                    if (mediaState.betaDisks[i] && mediaState.betaDisks[i].data) {
                        project.media.betaDisks.push({
                            drive: i,
                            name: mediaState.betaDisks[i].name,
                            data: arrayToBase64(mediaState.betaDisks[i].data)
                        });
                    }
                }

                project.media.fdcDisks = [];
                for (let i = 0; i < 2; i++) {
                    if (mediaState.fdcDisks[i] && mediaState.fdcDisks[i].data) {
                        project.media.fdcDisks.push({
                            drive: i,
                            name: mediaState.fdcDisks[i].name,
                            data: arrayToBase64(mediaState.fdcDisks[i].data)
                        });
                    }
                }

                if (mediaState.plusDDisks) {
                    project.media.plusDDisks = [];
                    for (let i = 0; i < 2; i++) {
                        if (mediaState.plusDDisks[i] && mediaState.plusDDisks[i].data) {
                            project.media.plusDDisks.push({
                                drive: i,
                                name: mediaState.plusDDisks[i].name,
                                data: arrayToBase64(mediaState.plusDDisks[i].data)
                            });
                        }
                    }
                }

                if (mediaState.if1Cartridges) {
                    project.media.if1Cartridges = [];
                    for (let i = 0; i < 8; i++) {
                        if (mediaState.if1Cartridges[i] && mediaState.if1Cartridges[i].data) {
                            project.media.if1Cartridges.push({ drive: i, name: mediaState.if1Cartridges[i].name, data: arrayToBase64(mediaState.if1Cartridges[i].data) });
                        }
                    }
                }
            }

            // Add poke manager state
            if (pokeManagerAPI.hasData()) {
                project.pokes = pokeManagerAPI.getPokeData();
            }

            // Add assembler state (VFS and editor content)
            if (asmAPI.hasContent()) {
                project.assembler = asmAPI.saveState();
                // Save all files from VFS
                for (const path in VFS.files) {
                    const file = VFS.files[path];
                    if (file.binary) {
                        project.assembler.binaryFiles[path] = arrayToBase64(file.content);
                    } else {
                        project.assembler.files[path] = file.content;
                    }
                }
            }

            const json = JSON.stringify(project, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const fileName = labelManager.currentFile ?
                labelManager.currentFile.replace(/\.[^.]+$/, '') :
                `project_${spectrum.machineType}`;
            a.download = `${fileName}_${Date.now()}.zxproj`;
            a.click();
            URL.revokeObjectURL(url);
            showMessage('Project saved');
        } catch (e) {
            showMessage('Failed to save project: ' + e.message, 'error');
            console.error(e);
        }
    }

    async function loadProject(jsonStr) {
        const spectrum = getSpectrum();
        const displayAPI = getDisplayAPI();
        const portLoggingAPI = getPortLoggingAPI();
        const mediaCatalogAPI = getMediaCatalogAPI();
        const pokeManagerAPI = getPokeManagerAPI();
        const asmAPI = getAsmAPI();
        const analysisAPI = getAnalysisAPI();
        const gamepadAPI = getGamepadAPI();

        try {
            const project = JSON.parse(jsonStr);

            if (!project.version || !project.snapshot) {
                throw new Error('Invalid project file');
            }

            // Stop emulator during load
            const wasRunning = spectrum.isRunning();
            spectrum.stop();

            // Stop all active debug/analysis tools
            const stopActiveTools = getStopActiveTools();
            if (stopActiveTools) stopActiveTools();

            // Switch machine type if needed
            if (project.machineType && project.machineType !== spectrum.machineType) {
                spectrum.setMachineType(project.machineType);
                applyRomsToEmulator();
                machineSelect.value = project.machineType;
                if (displayAPI) displayAPI.updateULAplusStatus();
            }

            // Restore snapshot
            const snapshotBinary = Uint8Array.from(atob(project.snapshot), c => c.charCodeAt(0));
            spectrum.loadSnapshot(snapshotBinary);

            // Reset disassembler to use fresh memory reference
            setDisasm(null);

            // Clear existing debugger state
            spectrum.clearTriggers();
            labelManager.clear();

            // Restore debugger state
            if (project.debugger) {
                // Restore addresses
                if (project.debugger.disasmAddress !== undefined) {
                    setDisasmViewAddress(project.debugger.disasmAddress);
                    if (project.debugger.disasmAddress !== null) {
                        disasmAddressInput.value = hex16(project.debugger.disasmAddress);
                    }
                }
                if (project.debugger.memoryAddress !== undefined) {
                    setMemoryViewAddress(project.debugger.memoryAddress);
                    memoryAddressInput.value = hex16(project.debugger.memoryAddress);
                }
                if (project.debugger.leftMemoryAddress !== undefined) {
                    setLeftMemoryViewAddress(project.debugger.leftMemoryAddress);
                    leftMemAddressInput.value = hex16(project.debugger.leftMemoryAddress);
                }
                if (project.debugger.rightDisasmAddress !== undefined) {
                    setRightDisasmViewAddress(project.debugger.rightDisasmAddress);
                    if (project.debugger.rightDisasmAddress !== null) {
                        rightDisasmAddressInput.value = hex16(project.debugger.rightDisasmAddress);
                    }
                }

                // Restore panel types
                if (project.debugger.leftPanelType) {
                    switchLeftPanelType(project.debugger.leftPanelType);
                }
                if (project.debugger.rightPanelType) {
                    switchRightPanelType(project.debugger.rightPanelType);
                }

                // Restore bookmarks (new format first, then legacy)
                if (project.debugger.leftBookmarks) {
                    setLeftBookmarks(project.debugger.leftBookmarks.slice());
                    updateBookmarkButtons(disasmBookmarksBar, project.debugger.leftBookmarks, 'left');
                } else if (project.debugger.disasmBookmarks) {
                    setLeftBookmarks(project.debugger.disasmBookmarks.slice());
                    updateBookmarkButtons(disasmBookmarksBar, project.debugger.disasmBookmarks, 'left');
                }
                if (project.debugger.rightBookmarks) {
                    setRightBookmarks(project.debugger.rightBookmarks.slice());
                    updateBookmarkButtons(memoryBookmarksBar, project.debugger.rightBookmarks, 'right');
                } else if (project.debugger.memoryBookmarks) {
                    setRightBookmarks(project.debugger.memoryBookmarks.slice());
                    updateBookmarkButtons(memoryBookmarksBar, project.debugger.memoryBookmarks, 'right');
                }

                // Restore triggers (new unified format)
                if (project.debugger.triggers) {
                    for (const t of project.debugger.triggers) {
                        spectrum.addTrigger(t);
                    }
                } else {
                    // Legacy format - convert breakpoints/watchpoints/portBreakpoints
                    if (project.debugger.breakpoints) {
                        for (const bp of project.debugger.breakpoints) {
                            spectrum.addTrigger({
                                type: 'exec',
                                start: bp.start,
                                end: bp.end,
                                page: bp.page,
                                condition: bp.condition || ''
                            });
                        }
                    }
                    if (project.debugger.watchpoints) {
                        for (const wp of project.debugger.watchpoints) {
                            const wpType = wp.type === 'read' ? 'read' : wp.type === 'write' ? 'write' : 'rw';
                            spectrum.addTrigger({
                                type: wpType,
                                start: wp.start,
                                end: wp.end,
                                page: wp.page
                            });
                        }
                    }
                    if (project.debugger.portBreakpoints) {
                        for (const pb of project.debugger.portBreakpoints) {
                            const pbType = pb.direction === 'in' ? 'port_in' : pb.direction === 'out' ? 'port_out' : 'port_io';
                            spectrum.addTrigger({
                                type: pbType,
                                start: pb.port,
                                mask: pb.mask
                            });
                        }
                    }
                }

                // Restore port trace filters
                if (project.debugger.portTraceFilters) {
                    spectrum.clearPortTraceFilters();
                    for (const f of project.debugger.portTraceFilters) {
                        spectrum.addPortTraceFilter(f);
                    }
                    portLoggingAPI.updatePortFilterList();
                }

                // Restore labels
                if (project.debugger.labels && project.debugger.labels.length > 0) {
                    labelManager.importJSON(JSON.stringify(project.debugger.labels), false);
                }

                // Clear and restore regions
                regionManager.clear();
                if (project.debugger.regions && project.debugger.regions.length > 0) {
                    regionManager.importJSON(JSON.stringify(project.debugger.regions), false);
                }

                // Clear and restore comments
                commentManager.clear();
                if (project.debugger.comments && project.debugger.comments.length > 0) {
                    commentManager.importJSON(JSON.stringify(project.debugger.comments), false);
                }

                // Clear and restore xrefs
                xrefManager.clear();
                if (project.debugger.xrefs && project.debugger.xrefs.length > 0) {
                    xrefManager.importJSON(JSON.stringify(project.debugger.xrefs), false);
                }
                analysisAPI.updateXrefStats();

                // Clear and restore subroutines
                subroutineManager.clear();
                if (project.debugger.subroutines && project.debugger.subroutines.length > 0) {
                    subroutineManager.importJSON(JSON.stringify(project.debugger.subroutines), false);
                }

                // Clear and restore folds
                foldManager.clear();
                if (project.debugger.folds) {
                    foldManager.importJSON(JSON.stringify(project.debugger.folds), false);
                }

                // Clear and restore operand formats
                operandFormatManager.clear();
                if (project.debugger.operandFormats && project.debugger.operandFormats.length > 0) {
                    for (const f of project.debugger.operandFormats) {
                        operandFormatManager.formats.set(f.address, f.format);
                    }
                }

                // Restore watches
                if (project.debugger.watches && Array.isArray(project.debugger.watches)) {
                    setWatches(project.debugger.watches);
                    saveWatches();
                    renderWatches();
                }
            }

            // Restore settings
            if (project.settings) {
                if (project.settings.kempston !== undefined) {
                    chkKempston.checked = project.settings.kempston;
                    spectrum.kempstonEnabled = project.settings.kempston;
                }
                if (project.settings.kempstonExtended !== undefined) {
                    const extChk = document.getElementById('chkKempstonExtended');
                    if (extChk) {
                        extChk.checked = project.settings.kempstonExtended;
                        spectrum.kempstonExtendedEnabled = project.settings.kempstonExtended;
                    }
                }
                if (project.settings.gamepad !== undefined) {
                    const gpChk = document.getElementById('chkGamepad');
                    if (gpChk) {
                        gpChk.checked = project.settings.gamepad;
                        spectrum.gamepadEnabled = project.settings.gamepad;
                        setTimeout(() => {
                            if (gamepadAPI) gamepadAPI.updateStatus();
                        }, 0);
                    }
                }
                if (project.settings.gamepadMapping !== undefined) {
                    spectrum.gamepadMapping = project.settings.gamepadMapping;
                }
                if (project.settings.kempstonMouse !== undefined) {
                    const mouseChk = document.getElementById('chkKempstonMouse');
                    if (mouseChk) {
                        mouseChk.checked = project.settings.kempstonMouse;
                        spectrum.kempstonMouseEnabled = project.settings.kempstonMouse;
                        // Update button visibility - defer to ensure function exists
                        setTimeout(() => {
                            const updateMouseStatus = getUpdateMouseStatus();
                            if (typeof updateMouseStatus === 'function') updateMouseStatus();
                        }, 0);
                    }
                }
                if (project.settings.mouseWheel !== undefined) {
                    const wheelChk = document.getElementById('chkMouseWheel');
                    if (wheelChk) {
                        wheelChk.checked = project.settings.mouseWheel;
                        spectrum.kempstonMouseWheelEnabled = project.settings.mouseWheel;
                    }
                }
                if (project.settings.mouseSwap !== undefined) {
                    const swapChk = document.getElementById('chkMouseSwap');
                    if (swapChk) {
                        swapChk.checked = project.settings.mouseSwap;
                        spectrum.kempstonMouseSwapButtons = project.settings.mouseSwap;
                    }
                }
                if (project.settings.mouseWheelSwap !== undefined) {
                    const wheelSwapChk = document.getElementById('chkMouseWheelSwap');
                    if (wheelSwapChk) {
                        wheelSwapChk.checked = project.settings.mouseWheelSwap;
                        spectrum.kempstonMouseSwapWheel = project.settings.mouseWheelSwap;
                    }
                }
                if (project.settings.speed !== undefined) {
                    speedSelect.value = project.settings.speed;
                    spectrum.setSpeed(project.settings.speed);
                }
                if (project.settings.palette && displayAPI.hasLoadedPalettes()) {
                    displayAPI.applyPalette(project.settings.palette);
                }
                if (project.settings.labelDisplayMode) {
                    document.getElementById('labelDisplayMode').value = project.settings.labelDisplayMode;
                }
                if (project.settings.showRomLabels !== undefined) {
                    labelManager.showRomLabels = project.settings.showRomLabels;
                    labelSourceFilter.value = project.settings.showRomLabels ? 'all' : 'user';
                }
                if (project.settings.darkTheme !== undefined) {
                    setDarkTheme(project.settings.darkTheme);
                }
                if (project.settings.debuggerOpen !== undefined) {
                    tabContainer.classList.toggle('collapsed', !project.settings.debuggerOpen);
                }
                // Restore border preset FIRST (before zoom) so dimensions are correct
                if (project.settings.borderPreset !== undefined) {
                    borderSizeSelect.value = project.settings.borderPreset;
                    spectrum.ula.setBorderPreset(project.settings.borderPreset);
                    spectrum.updateDisplayDimensions();
                } else if (project.settings.fullBorder !== undefined) {
                    // Legacy: convert fullBorder boolean to preset
                    const preset = project.settings.fullBorder ? 'full' : 'normal';
                    borderSizeSelect.value = preset;
                    spectrum.ula.setBorderPreset(preset);
                    spectrum.updateDisplayDimensions();
                }
                if (project.settings.zoom) {
                    const zoomLevel = parseInt(project.settings.zoom);
                    if (zoomLevel >= 1 && zoomLevel <= 3) {
                        // Defer setZoom to ensure border preset is applied first
                        setTimeout(() => {
                            setZoom(zoomLevel);
                            // Force canvas update with correct dimensions
                            updateCanvasSize();
                            spectrum.renderToScreen();
                        }, 0);
                    }
                } else if (project.settings.borderPreset !== undefined || project.settings.fullBorder !== undefined) {
                    // No zoom setting but border changed - update canvas
                    setTimeout(() => { updateCanvasSize(); spectrum.renderToScreen(); }, 0);
                }
                // Load overlay mode (new) or grid (legacy)
                if (project.settings.overlayMode !== undefined) {
                    document.getElementById('overlaySelect').value = project.settings.overlayMode;
                    spectrum.setOverlayMode(project.settings.overlayMode);
                } else if (project.settings.grid !== undefined) {
                    // Legacy: convert grid boolean to overlay mode
                    const mode = project.settings.grid ? 'grid' : 'normal';
                    document.getElementById('overlaySelect').value = mode;
                    spectrum.setOverlayMode(mode);
                }
                if (project.settings.fullscreenMode !== undefined) {
                    fullscreenMode.value = project.settings.fullscreenMode;
                    storageSet('zxm8_fullscreen', project.settings.fullscreenMode);
                }
                if (project.settings.invertDisplay !== undefined) {
                    document.getElementById('chkInvertDisplay').checked = project.settings.invertDisplay;
                    displayAPI.applyInvertDisplay(project.settings.invertDisplay);
                }
                if (project.settings.lateTimings !== undefined) {
                    document.getElementById('chkLateTimings').checked = project.settings.lateTimings;
                    spectrum.setLateTimings(project.settings.lateTimings);
                }
                if (project.settings.tapeFlashLoad !== undefined) {
                    document.getElementById('chkFlashLoad').checked = project.settings.tapeFlashLoad;
                    spectrum.setTapeFlashLoad(project.settings.tapeFlashLoad);
                }
                if (project.settings.tapeAudioEnabled !== undefined) {
                    document.getElementById('chkTapeAudio').checked = project.settings.tapeAudioEnabled;
                    spectrum.tapeAudioEnabled = project.settings.tapeAudioEnabled;
                }
                if (project.settings.autoLoad !== undefined) {
                    document.getElementById('chkAutoLoad').checked = project.settings.autoLoad;
                }
                if (project.settings.cfaSkipRom !== undefined) document.getElementById('chkCfaSkipRom').checked = project.settings.cfaSkipRom;
                if (project.settings.cfaISR !== undefined) document.getElementById('chkCfaISR').checked = project.settings.cfaISR;
                if (project.settings.cfaEntries !== undefined) document.getElementById('cfaExtraEntries').value = project.settings.cfaEntries;
                if (project.settings.if1Enabled !== undefined) {
                    spectrum.if1Enabled = project.settings.if1Enabled;
                    // Update UI checkbox if available
                    const chkIF1 = document.getElementById('chkIF1');
                    if (chkIF1) chkIF1.checked = spectrum.if1Enabled;
                    spectrum.updateBetaDiskPagingFlag();
                }

            }

            // Restore CPU timing state (tStates, halted, IFF)
            if (project.cpuTiming) {
                if (project.cpuTiming.tStates !== undefined) {
                    spectrum.cpu.tStates = project.cpuTiming.tStates;
                }
                if (project.cpuTiming.halted !== undefined) {
                    spectrum.cpu.halted = project.cpuTiming.halted;
                }
                if (project.cpuTiming.iff1 !== undefined) {
                    spectrum.cpu.iff1 = project.cpuTiming.iff1;
                }
                if (project.cpuTiming.iff2 !== undefined) {
                    spectrum.cpu.iff2 = project.cpuTiming.iff2;
                }
                // Safety: if CPU is halted but interrupts disabled, enable them
                // Otherwise the CPU will be stuck forever
                if (spectrum.cpu.halted && !spectrum.cpu.iff1) {
                    console.warn('[loadProject] CPU was halted with IFF=0, enabling interrupts');
                    spectrum.cpu.iff1 = true;
                    spectrum.cpu.iff2 = true;
                }
            }

            // Restore ULA state (border changes for rainbow graphics)
            if (project.ulaState) {
                if (project.ulaState.borderColor !== undefined) {
                    spectrum.ula.borderColor = project.ulaState.borderColor;
                }
                if (project.ulaState.borderChanges && project.ulaState.borderChanges.length > 0) {
                    spectrum.ula.borderChanges = project.ulaState.borderChanges.slice();
                }
            }

            // Restore AY-3-8910 sound chip state
            if (project.ayState && spectrum.ay) {
                spectrum.ay.importState(project.ayState);
            }

            // Restore source file name and update status display
            if (project.sourceFile) {
                labelManager.currentFile = project.sourceFile;
                regionManager.currentFile = project.sourceFile;
                commentManager.currentFile = project.sourceFile;
                // Update media indicator in status bar
                updateMediaIndicator(project.sourceFile);
            } else {
                // No source file - hide media indicators
                document.getElementById('tapeInfo').style.display = 'none';
                document.getElementById('diskInfo').style.display = 'none';
            }

            // Restore RZX state if present
            if (project.rzx && project.rzx.data) {
                try {
                    const rzxBinary = Uint8Array.from(atob(project.rzx.data), c => c.charCodeAt(0));
                    // Load RZX but skip embedded snapshot (we already loaded project snapshot)
                    await spectrum.loadRZX(rzxBinary, true);
                    // Restore frame position and instruction count
                    spectrum.setRZXFrame(project.rzx.frame || 0);
                    spectrum.setRZXInstructions(project.rzx.instructions || 0);
                    updateRZXStatus();
                } catch (e) {
                    console.warn('Failed to restore RZX state:', e);
                }
            }

            // Restore loaded media
            if (project.mediaVersion === 2 && project.media) {
                // New multi-drive format (v2)
                try {
                    const restoreMedia = {};
                    if (project.media.tape && project.media.tape.data) {
                        restoreMedia.tape = {
                            type: project.media.tape.type,
                            name: project.media.tape.name,
                            data: Uint8Array.from(atob(project.media.tape.data), c => c.charCodeAt(0))
                        };
                    } else {
                        restoreMedia.tape = null;
                    }
                    restoreMedia.betaDisks = [null, null, null, null];
                    if (project.media.betaDisks) {
                        for (const entry of project.media.betaDisks) {
                            restoreMedia.betaDisks[entry.drive] = {
                                name: entry.name,
                                data: Uint8Array.from(atob(entry.data), c => c.charCodeAt(0))
                            };
                        }
                    }
                    restoreMedia.fdcDisks = [null, null];
                    if (project.media.fdcDisks) {
                        for (const entry of project.media.fdcDisks) {
                            restoreMedia.fdcDisks[entry.drive] = {
                                name: entry.name,
                                data: Uint8Array.from(atob(entry.data), c => c.charCodeAt(0))
                            };
                        }
                    }
                    restoreMedia.plusDDisks = [null, null];
                    if (project.media.plusDDisks) {
                        for (const entry of project.media.plusDDisks) {
                            restoreMedia.plusDDisks[entry.drive] = {
                                name: entry.name,
                                data: Uint8Array.from(atob(entry.data), c => c.charCodeAt(0))
                            };
                        }
                    }
                    restoreMedia.if1Cartridges = new Array(8).fill(null);
                    if (project.media.if1Cartridges) {
                        for (const entry of project.media.if1Cartridges) {
                            restoreMedia.if1Cartridges[entry.drive] = { data: Uint8Array.from(atob(entry.data), c => c.charCodeAt(0)), name: entry.name };
                        }
                    }

                    spectrum.setLoadedMedia(restoreMedia);
                    // Restore tape position
                    if (project.media.tape && project.media.tape.tapeBlock !== undefined) {
                        spectrum.setTapeBlock(project.media.tape.tapeBlock);
                    }
                    // Rebuild catalogs — show first drive that has a disk
                    let foundDisk = false;
                    for (let i = 0; i < 2 && !foundDisk; i++) {
                        if (spectrum.loadedFDCDisks[i]) { mediaCatalogAPI.buildDiskCatalog(i, 'fdc'); foundDisk = true; }
                    }
                    for (let i = 0; i < 4 && !foundDisk; i++) {
                        if (spectrum.loadedBetaDisks[i]) { mediaCatalogAPI.buildDiskCatalog(i, 'beta'); foundDisk = true; }
                    }
                    for (let i = 0; i < 2 && !foundDisk; i++) {
                        if (spectrum.loadedPlusDDisks[i]) { mediaCatalogAPI.buildDiskCatalog(i, 'plusd'); foundDisk = true; }
                    }
                    for (let i = 0; i < 8 && !foundDisk; i++) {
                        if (spectrum.loadedIF1Cartridges && spectrum.loadedIF1Cartridges[i]) {
                            mediaCatalogAPI.buildDiskCatalog(i, 'if1');
                            foundDisk = true;
                        }
                    }

                    mediaCatalogAPI.buildTapeCatalog();
                } catch (e) {
                    console.warn('Failed to restore media (v2):', e);
                }
            } else if (project.media && project.media.data) {
                // Legacy single-media format (v1 backward compat)
                try {
                    const mediaData = Uint8Array.from(atob(project.media.data), c => c.charCodeAt(0));
                    spectrum.setLoadedMedia({
                        type: project.media.type,
                        name: project.media.name,
                        data: mediaData
                    });
                    // Restore tape position
                    if (project.media.tapeBlock !== undefined) {
                        spectrum.setTapeBlock(project.media.tapeBlock);
                    }
                    // Rebuild disk catalog for TRD/SCL media
                    if (project.media.type === 'trd' || project.media.type === 'scl') {
                        mediaCatalogAPI.buildDiskCatalog(0, 'beta');
                    } else if (project.media.type === 'dsk') {
                        mediaCatalogAPI.buildDiskCatalog(0, 'fdc');
                    }
                    // Rebuild tape catalog
                    mediaCatalogAPI.buildTapeCatalog();
                } catch (e) {
                    console.warn('Failed to restore media:', e);
                }
            }

            // Restore poke manager state
            if (project.pokes) {
                try { pokeManagerAPI.loadPokeJSON(JSON.stringify(project.pokes)); } catch (e) { console.warn('Failed to restore pokes:', e); }
            }

            // Restore assembler state (VFS and editor content)
            if (project.assembler) {
                try {
                    // Clear existing VFS
                    VFS.reset();

                    // Restore text files
                    if (project.assembler.files) {
                        for (const path in project.assembler.files) {
                            VFS.addFile(path, project.assembler.files[path]);
                        }
                    }

                    // Restore binary files
                    if (project.assembler.binaryFiles) {
                        for (const path in project.assembler.binaryFiles) {
                            const base64 = project.assembler.binaryFiles[path];
                            const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                            VFS.addBinaryFile(path, binary);
                        }
                    }

                    asmAPI.restoreState(project.assembler);
                } catch (e) {
                    console.warn('Failed to restore assembler state:', e);
                }
            }

            // Reset trace to live view and clear stale data
            traceManager.clear();
            traceManager.goToLive();
            setTraceViewAddress(null);

            // Update UI
            updateDebugger();
            updateMemoryView();
            updateBreakpointList();
            updateWatchpointList();
            updatePortBreakpointList();
            updateLabelsList();
            const updateGraphicsViewer = getUpdateGraphicsViewer();
            if (typeof updateGraphicsViewer === 'function') {
                updateGraphicsViewer();
            }

            // Restore running state from project, or use previous state
            const shouldRun = project.settings?.running !== undefined ?
                project.settings.running : wasRunning;

            if (shouldRun) {
                // Force start to ensure loop begins even if state is inconsistent
                spectrum.start(true);
            } else {
                spectrum.stop();
                // Render current state WITHOUT executing CPU (preserves tStates)
                spectrum.renderToScreen();
            }

            // Update all status displays including RZX
            updateStatus();
            updateRZXStatus();

            showMessage(project.rzx ?
                `Project loaded (RZX frame ${spectrum.getRZXFrame()}/${spectrum.getRZXTotalFrames()})` :
                'Project loaded');
        } catch (e) {
            showMessage('Failed to load project: ' + e.message, 'error');
            console.error(e);
        }
    }

    return { saveProject, loadProject };
}
