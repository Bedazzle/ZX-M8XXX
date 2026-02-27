// Project I/O — save/load project files, export/import snapshots
// Extracted from index.html lines ~29934-30710

import { hex16 } from '../utils/format.js';

// Helper to convert array/Uint8Array to base64 (handles large arrays)
export function arrayToBase64(data) {
    // Ensure we have a Uint8Array
    const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < arr.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, arr.length);
        // Convert chunk to regular array for String.fromCharCode.apply
        const chunk = Array.from(arr.subarray(i, end));
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

export function saveProject(spectrum, deps) {
    const {
        labelManager, regionManager, commentManager, xrefManager,
        operandFormatManager, subroutineManager, foldManager,
        showMessage, disasmViewAddress, memoryViewAddress,
        leftMemoryViewAddress, rightDisasmViewAddress,
        leftPanelType, rightPanelType, leftBookmarks, rightBookmarks,
        watches, WATCH_BYTES, chkKempston, borderSizeSelect,
        chkInvertDisplay, chkLateTimings, speedSelect, paletteSelect,
        darkTheme, tabContainer, overlaySelect, fullscreenMode,
        chkAutoLoad, asmEditor, currentOpenFile, currentProjectMainFile,
        openTabs, fileModified, VFS
    } = deps;

    try {
        // Get emulator snapshot as base64
        const snapshotData = spectrum.saveSnapshot();
        const snapshotBase64 = arrayToBase64(snapshotData);

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
                triggers: spectrum.getTriggers().map(t => ({
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
                })),
                labels: JSON.parse(labelManager.exportJSON()),
                regions: JSON.parse(regionManager.exportJSON()),
                comments: JSON.parse(commentManager.exportJSON()),
                xrefs: xrefManager.exportJSON() ? JSON.parse(xrefManager.exportJSON()) : [],
                subroutines: JSON.parse(subroutineManager.exportJSON()),
                folds: foldManager.exportJSON() ? JSON.parse(foldManager.exportJSON()) : { userFolds: [], collapsed: [] },
                operandFormats: operandFormatManager.getAll(),
                watches: watches.map(w => ({ addr: w.addr, name: w.name, page: w.page })),
                portTraceFilters: spectrum.getPortTraceFilters().map(f => ({ port: f.port, mask: f.mask }))
            },
            settings: {
                kempston: chkKempston.checked,
                kempstonExtended: document.getElementById('chkKempstonExtended').checked,
                gamepad: document.getElementById('chkGamepad').checked,
                gamepadMapping: spectrum.gamepadMapping,
                kempstonMouse: document.getElementById('chkKempstonMouse').checked,
                mouseWheel: document.getElementById('chkMouseWheel').checked,
                borderPreset: borderSizeSelect.value,
                invertDisplay: chkInvertDisplay.checked,
                lateTimings: chkLateTimings.checked,
                speed: parseInt(speedSelect.value),
                palette: paletteSelect.value,
                labelDisplayMode: document.getElementById('labelDisplayMode').value,
                showRomLabels: labelManager.showRomLabels,
                darkTheme: darkTheme,
                debuggerOpen: !tabContainer.classList.contains('collapsed'),
                zoom: document.querySelector('.zoom-btn.active')?.textContent.replace('x', '') || '2',
                running: spectrum.isRunning(),
                overlayMode: overlaySelect.value,
                fullscreenMode: fullscreenMode.value,
                tapeFlashLoad: spectrum.getTapeFlashLoad(),
                tapeAudioEnabled: spectrum.tapeAudioEnabled,
                autoLoad: chkAutoLoad.checked
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
                borderChanges: spectrum.ula.borderChanges.slice()
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
        }

        // Add assembler state (VFS and editor content)
        if (asmEditor && (asmEditor.value || Object.keys(VFS.files).length > 0)) {
            // Sync current editor to VFS before saving
            if (currentOpenFile && VFS.files[currentOpenFile] && !VFS.files[currentOpenFile].binary) {
                VFS.files[currentOpenFile].content = asmEditor.value;
            }

            project.assembler = {
                editorContent: asmEditor.value,
                mainFile: currentProjectMainFile,
                openTabs: openTabs,
                currentOpenFile: currentOpenFile,
                files: {},
                binaryFiles: {}
            };
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

export async function loadProject(jsonStr, spectrum, deps) {
    const {
        showMessage, applyRomsToEmulator, updateULAplusStatus,
        labelManager, regionManager, commentManager, xrefManager,
        operandFormatManager, subroutineManager, foldManager,
        updateXrefStats, updatePortFilterList,
        disasmAddressInput, memoryAddressInput,
        leftMemAddressInput, rightDisasmAddressInput,
        switchLeftPanelType, switchRightPanelType,
        disasmBookmarksBar, memoryBookmarksBar,
        updateBookmarkButtons, watches, WATCH_BYTES,
        saveWatches, renderWatches,
        chkKempston, borderSizeSelect, speedSelect,
        paletteSelect, applyPalette, fullscreenMode,
        overlaySelect, chkInvertDisplay, chkLateTimings,
        applyInvertDisplay, setZoom, updateCanvasSize,
        updateDebugger, updateMemoryView,
        updateBreakpointList, updateWatchpointList,
        updatePortBreakpointList, updateLabelsList,
        updateGraphicsViewer, updateRZXStatus, updateStatus,
        traceManager, buildDiskCatalog, buildTapeCatalog,
        updateMediaIndicator, loadRomsForMachineType,
        asmEditor, VFS, updateLineNumbers, updateHighlight,
        updateFileTabs, updateProjectButtons, updateDefinesDropdown,
        getMachineProfile, chkAutoLoad, loadedPalettes,
        updateGamepadStatus, updateMouseStatus
    } = deps;

    try {
        const project = JSON.parse(jsonStr);

        if (!project.version || !project.snapshot) {
            throw new Error('Invalid project file');
        }

        // Stop emulator during load
        const wasRunning = spectrum.isRunning();
        spectrum.stop();

        // Switch machine type if needed
        if (project.machineType && project.machineType !== spectrum.machineType) {
            spectrum.setMachineType(project.machineType);
            applyRomsToEmulator(spectrum);
            const machineSelect = document.getElementById('machineSelect');
            machineSelect.value = project.machineType;
            if (updateULAplusStatus) updateULAplusStatus();
        }

        // Restore snapshot
        const snapshotBinary = Uint8Array.from(atob(project.snapshot), c => c.charCodeAt(0));
        spectrum.loadSnapshot(snapshotBinary);

        // Reset disassembler to use fresh memory reference
        deps.disasm = null;

        // Clear existing debugger state
        spectrum.clearTriggers();
        labelManager.clear();

        // Restore debugger state
        if (project.debugger) {
            // Restore addresses
            if (project.debugger.disasmAddress !== undefined) {
                deps.disasmViewAddress = project.debugger.disasmAddress;
                if (deps.disasmViewAddress !== null) {
                    disasmAddressInput.value = hex16(deps.disasmViewAddress);
                }
            }
            if (project.debugger.memoryAddress !== undefined) {
                deps.memoryViewAddress = project.debugger.memoryAddress;
                memoryAddressInput.value = hex16(deps.memoryViewAddress);
            }
            if (project.debugger.leftMemoryAddress !== undefined) {
                deps.leftMemoryViewAddress = project.debugger.leftMemoryAddress;
                leftMemAddressInput.value = hex16(deps.leftMemoryViewAddress);
            }
            if (project.debugger.rightDisasmAddress !== undefined) {
                deps.rightDisasmViewAddress = project.debugger.rightDisasmAddress;
                if (deps.rightDisasmViewAddress !== null) {
                    rightDisasmAddressInput.value = hex16(deps.rightDisasmViewAddress);
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
                deps.leftBookmarks = project.debugger.leftBookmarks.slice();
                deps.disasmBookmarks = deps.leftBookmarks;
                updateBookmarkButtons(disasmBookmarksBar, deps.leftBookmarks, 'left');
            } else if (project.debugger.disasmBookmarks) {
                deps.leftBookmarks = project.debugger.disasmBookmarks.slice();
                deps.disasmBookmarks = deps.leftBookmarks;
                updateBookmarkButtons(disasmBookmarksBar, deps.leftBookmarks, 'left');
            }
            if (project.debugger.rightBookmarks) {
                deps.rightBookmarks = project.debugger.rightBookmarks.slice();
                deps.memoryBookmarks = deps.rightBookmarks;
                updateBookmarkButtons(memoryBookmarksBar, deps.rightBookmarks, 'right');
            } else if (project.debugger.memoryBookmarks) {
                deps.rightBookmarks = project.debugger.memoryBookmarks.slice();
                deps.memoryBookmarks = deps.rightBookmarks;
                updateBookmarkButtons(memoryBookmarksBar, deps.rightBookmarks, 'right');
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
                        spectrum.addTrigger({ type: 'exec', start: bp.start, end: bp.end, page: bp.page, condition: bp.condition || '' });
                    }
                }
                if (project.debugger.watchpoints) {
                    for (const wp of project.debugger.watchpoints) {
                        const wpType = wp.type === 'read' ? 'read' : wp.type === 'write' ? 'write' : 'rw';
                        spectrum.addTrigger({ type: wpType, start: wp.start, end: wp.end, page: wp.page });
                    }
                }
                if (project.debugger.portBreakpoints) {
                    for (const pb of project.debugger.portBreakpoints) {
                        const pbType = pb.direction === 'in' ? 'port_in' : pb.direction === 'out' ? 'port_out' : 'port_io';
                        spectrum.addTrigger({ type: pbType, start: pb.port, mask: pb.mask });
                    }
                }
            }

            // Restore port trace filters
            if (project.debugger.portTraceFilters) {
                spectrum.clearPortTraceFilters();
                for (const f of project.debugger.portTraceFilters) {
                    spectrum.addPortTraceFilter(f);
                }
                updatePortFilterList();
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
            updateXrefStats();

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
                deps.watches = project.debugger.watches.map(item => {
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
                        if (typeof updateGamepadStatus === 'function') updateGamepadStatus();
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
                    setTimeout(() => {
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
            if (project.settings.speed !== undefined) {
                speedSelect.value = project.settings.speed;
                spectrum.setSpeed(project.settings.speed);
            }
            if (project.settings.palette && loadedPalettes) {
                paletteSelect.value = project.settings.palette;
                applyPalette(project.settings.palette);
            }
            if (project.settings.labelDisplayMode) {
                document.getElementById('labelDisplayMode').value = project.settings.labelDisplayMode;
            }
            if (project.settings.showRomLabels !== undefined) {
                labelManager.showRomLabels = project.settings.showRomLabels;
                document.getElementById('chkShowRomLabels').checked = project.settings.showRomLabels;
            }
            if (project.settings.darkTheme !== undefined) {
                deps.darkTheme = project.settings.darkTheme;
                document.body.classList.toggle('light-theme', !deps.darkTheme);
                const themeToggle = document.getElementById('themeToggle');
                themeToggle.textContent = deps.darkTheme ? '\u2600\uFE0F' : '\uD83C\uDF19';
            }
            if (project.settings.debuggerOpen !== undefined) {
                const tabContainer = document.getElementById('tabContainer');
                tabContainer.classList.toggle('collapsed', !project.settings.debuggerOpen);
            }
            // Restore border preset FIRST (before zoom) so dimensions are correct
            if (project.settings.borderPreset !== undefined) {
                borderSizeSelect.value = project.settings.borderPreset;
                spectrum.ula.setBorderPreset(project.settings.borderPreset);
                spectrum.updateDisplayDimensions();
            } else if (project.settings.fullBorder !== undefined) {
                const preset = project.settings.fullBorder ? 'full' : 'normal';
                borderSizeSelect.value = preset;
                spectrum.ula.setBorderPreset(preset);
                spectrum.updateDisplayDimensions();
            }
            if (project.settings.zoom) {
                const zoomLevel = parseInt(project.settings.zoom);
                if (zoomLevel >= 1 && zoomLevel <= 3) {
                    setTimeout(() => {
                        setZoom(zoomLevel);
                        updateCanvasSize();
                    }, 0);
                }
            } else if (project.settings.borderPreset !== undefined || project.settings.fullBorder !== undefined) {
                setTimeout(() => updateCanvasSize(), 0);
            }
            if (project.settings.overlayMode !== undefined) {
                overlaySelect.value = project.settings.overlayMode;
                spectrum.setOverlayMode(project.settings.overlayMode);
            } else if (project.settings.grid !== undefined) {
                const mode = project.settings.grid ? 'grid' : 'normal';
                overlaySelect.value = mode;
                spectrum.setOverlayMode(mode);
            }
            if (project.settings.fullscreenMode !== undefined) {
                fullscreenMode.value = project.settings.fullscreenMode;
                localStorage.setItem('zx-fullscreen-mode', project.settings.fullscreenMode);
            }
            if (project.settings.invertDisplay !== undefined) {
                chkInvertDisplay.checked = project.settings.invertDisplay;
                applyInvertDisplay(project.settings.invertDisplay);
            }
            if (project.settings.lateTimings !== undefined) {
                chkLateTimings.checked = project.settings.lateTimings;
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
        }

        // Restore CPU timing state
        if (project.cpuTiming) {
            if (project.cpuTiming.tStates !== undefined) spectrum.cpu.tStates = project.cpuTiming.tStates;
            if (project.cpuTiming.halted !== undefined) spectrum.cpu.halted = project.cpuTiming.halted;
            if (project.cpuTiming.iff1 !== undefined) spectrum.cpu.iff1 = project.cpuTiming.iff1;
            if (project.cpuTiming.iff2 !== undefined) spectrum.cpu.iff2 = project.cpuTiming.iff2;
            if (spectrum.cpu.halted && !spectrum.cpu.iff1) {
                console.warn('[loadProject] CPU was halted with IFF=0, enabling interrupts');
                spectrum.cpu.iff1 = true;
                spectrum.cpu.iff2 = true;
            }
        }

        // Restore ULA state
        if (project.ulaState) {
            if (project.ulaState.borderColor !== undefined) spectrum.ula.borderColor = project.ulaState.borderColor;
            if (project.ulaState.borderChanges && project.ulaState.borderChanges.length > 0) {
                spectrum.ula.borderChanges = project.ulaState.borderChanges.slice();
            }
        }

        // Restore AY state
        if (project.ayState && spectrum.ay) {
            spectrum.ay.importState(project.ayState);
        }

        // Restore source file name
        if (project.sourceFile) {
            labelManager.currentFile = project.sourceFile;
            regionManager.currentFile = project.sourceFile;
            commentManager.currentFile = project.sourceFile;
            updateMediaIndicator(project.sourceFile);
        } else {
            document.getElementById('tapeInfo').style.display = 'none';
            document.getElementById('diskInfo').style.display = 'none';
        }

        // Restore RZX state
        if (project.rzx && project.rzx.data) {
            try {
                const rzxBinary = Uint8Array.from(atob(project.rzx.data), c => c.charCodeAt(0));
                await spectrum.loadRZX(rzxBinary, true);
                spectrum.setRZXFrame(project.rzx.frame || 0);
                spectrum.setRZXInstructions(project.rzx.instructions || 0);
                updateRZXStatus();
            } catch (e) {
                console.warn('Failed to restore RZX state:', e);
            }
        }

        // Restore loaded media
        if (project.mediaVersion === 2 && project.media) {
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
                spectrum.setLoadedMedia(restoreMedia);
                if (project.media.tape && project.media.tape.tapeBlock !== undefined) {
                    spectrum.setTapeBlock(project.media.tape.tapeBlock);
                }
                let foundDisk = false;
                for (let i = 0; i < 2 && !foundDisk; i++) {
                    if (spectrum.loadedFDCDisks[i]) { buildDiskCatalog(i, 'fdc'); foundDisk = true; }
                }
                for (let i = 0; i < 4 && !foundDisk; i++) {
                    if (spectrum.loadedBetaDisks[i]) { buildDiskCatalog(i, 'beta'); foundDisk = true; }
                }
                buildTapeCatalog();
            } catch (e) {
                console.warn('Failed to restore media (v2):', e);
            }
        } else if (project.media && project.media.data) {
            try {
                const mediaData = Uint8Array.from(atob(project.media.data), c => c.charCodeAt(0));
                spectrum.setLoadedMedia({ type: project.media.type, name: project.media.name, data: mediaData });
                if (project.media.tapeBlock !== undefined) spectrum.setTapeBlock(project.media.tapeBlock);
                if (project.media.type === 'trd' || project.media.type === 'scl') buildDiskCatalog(0, 'beta');
                else if (project.media.type === 'dsk') buildDiskCatalog(0, 'fdc');
                buildTapeCatalog();
            } catch (e) {
                console.warn('Failed to restore media:', e);
            }
        }

        // Restore assembler state
        if (project.assembler) {
            try {
                VFS.reset();
                if (project.assembler.files) {
                    for (const path in project.assembler.files) VFS.addFile(path, project.assembler.files[path]);
                }
                if (project.assembler.binaryFiles) {
                    for (const path in project.assembler.binaryFiles) {
                        const binary = Uint8Array.from(atob(project.assembler.binaryFiles[path]), c => c.charCodeAt(0));
                        VFS.addBinaryFile(path, binary);
                    }
                }
                deps.currentProjectMainFile = project.assembler.mainFile || null;
                deps.openTabs = project.assembler.openTabs || [];
                deps.currentOpenFile = project.assembler.currentOpenFile || null;
                deps.fileModified = {};
                if (Object.keys(VFS.files).length > 0 && deps.openTabs.length === 0) {
                    if (deps.currentProjectMainFile) {
                        deps.openTabs.push(deps.currentProjectMainFile);
                        deps.currentOpenFile = deps.currentProjectMainFile;
                    }
                }
                if (deps.currentOpenFile && VFS.files[deps.currentOpenFile]) {
                    asmEditor.value = VFS.files[deps.currentOpenFile].content || '';
                } else if (project.assembler.editorContent && asmEditor) {
                    asmEditor.value = project.assembler.editorContent;
                }
                updateLineNumbers();
                updateHighlight();
                updateFileTabs();
                updateProjectButtons();
                updateDefinesDropdown();
            } catch (e) {
                console.warn('Failed to restore assembler state:', e);
            }
        }

        // Reset trace to live view
        traceManager.clear();
        traceManager.goToLive();
        deps.traceViewAddress = null;

        // Update UI
        updateDebugger();
        updateMemoryView();
        updateBreakpointList();
        updateWatchpointList();
        updatePortBreakpointList();
        updateLabelsList();
        if (typeof updateGraphicsViewer === 'function') updateGraphicsViewer();

        // Restore running state
        const shouldRun = project.settings?.running !== undefined ? project.settings.running : wasRunning;
        if (shouldRun) {
            spectrum.start(true);
        } else {
            spectrum.stop();
            spectrum.renderToScreen();
        }

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
