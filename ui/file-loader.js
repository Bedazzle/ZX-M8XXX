// file-loader.js — File loading, drag-drop, ZIP selection, media indicators (extracted from index.html)
import { hex16 } from '../core/utils.js';

export function initFileLoader({
    getSpectrum,
    romData,
    getAutoLoaderAPI,
    getStopActiveTools,
    getMediaCatalogAPI,
    getAnalysisAPI,
    getDisplayAPI,
    getLoadProject,
    getBootAPI,
    labelManager, regionManager, commentManager,
    xrefManager, operandFormatManager, subroutineManager,
    showMessage,
    updateRZXStatus, updateStatus, updateDebugger,
    openDebuggerPanel, updateCanvasSize,
    loadRomsForMachineType,
    showRomModal, isRomModalVisible,
    setDisasm
}) {
    // DOM elements
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    const zipModal = document.getElementById('zipModal');
    const zipFileList = document.getElementById('zipFileList');
    const btnZipCancel = document.getElementById('btnZipCancel');
    const btnBootTrdos = document.getElementById('btnBootTrdos');
    const diskActivityEl = document.getElementById('diskActivity');
    const diskLedEl = document.getElementById('diskLed');
    const diskStatusEl = document.getElementById('diskStatus');

    let pendingZipResult = null;

    // Handle disk image insertion - requires Beta Disk to be available
    function handleDiskInserted(result, fileName) {
        if (result.needsMachineSwitch) {
            // Beta Disk not available on current machine - don't force machine switch
            if (!romData['trdos.rom']) {
                showMessage('TR-DOS ROM required for disk images. Load trdos.rom first.', 'error');
            } else {
                showMessage('Enable Beta Disk in Settings, or switch to Pentagon/Scorpion mode for disk images.', 'error');
            }
            return;
        }

        handleLoadResult(result, fileName);
    }

    // Update media indicators (tape/disk filenames)
    function updateMediaIndicator(fileName, type, driveIndex) {
        const spectrum = getSpectrum();
        const ext = fileName.split('.').pop().toLowerCase();
        if (type === 'tape' || ext === 'tap' || ext === 'tzx') {
            document.getElementById('tapeLed').title = fileName;
            document.getElementById('tapeInfo').style.display = 'inline-block';
        } else if (type === 'disk' || ext === 'trd' || ext === 'scl' || ext === 'dsk' || ext === 'mgt' || ext === 'mdr' || ext === 'img') {
            // Build tooltip listing all loaded drives
            const driveNames = [];
            const betaDisks = spectrum.loadedBetaDisks;
            const fdcDisks = spectrum.loadedFDCDisks;
            const plusDDisks = spectrum.loadedPlusDDisks;
            if (spectrum.machineType === '+3') {
                for (let i = 0; i < 2; i++) {
                    if (fdcDisks[i]) driveNames.push(`${String.fromCharCode(65 + i)}: ${fdcDisks[i].name}`);
                }
            } else {
                for (let i = 0; i < 4; i++) {
                    if (betaDisks[i]) driveNames.push(`${String.fromCharCode(65 + i)}: ${betaDisks[i].name}`);
                }
            }
            if (plusDDisks) {
                for (let i = 0; i < 2; i++) {
                    if (plusDDisks[i]) driveNames.push(`+D ${String.fromCharCode(65 + i)}: ${plusDDisks[i].name}`);
                }
            }
            const if1Cartridges = spectrum.loadedIF1Cartridges;
            if (if1Cartridges) {
                for (let i = 0; i < if1Cartridges.length; i++) {
                    if (if1Cartridges[i]) driveNames.push(`MDR ${i + 1}: ${if1Cartridges[i].name}`);
                }
            }
            document.getElementById('diskInfoLed').title = driveNames.join('\n') || fileName;
            document.getElementById('diskInfo').style.display = 'inline-block';
        }
    }

    // Show/hide drive selector based on current machine type
    function updateDriveSelector() {
        const spectrum = getSpectrum();
        const sel = document.getElementById('driveSelectorSelect');
        if (spectrum.machineType === '+3') {
            // FDC: only 2 drives
            sel.options[2].style.display = 'none';
            sel.options[3].style.display = 'none';
            if (sel.selectedIndex > 1) sel.selectedIndex = 0;
        } else {
            sel.options[2].style.display = '';
            sel.options[3].style.display = '';
        }
    }

    // Get currently selected drive index from the UI drive selector
    function getSelectedDriveIndex() {
        const sel = document.getElementById('driveSelectorSelect');
        return parseInt(sel.value, 10) || 0;
    }

    // Handle loaded result (shared between file input and ZIP selection)
    function handleLoadResult(result, fileName) {
        const spectrum = getSpectrum();
        const autoLoaderAPI = getAutoLoaderAPI();
        const mediaCatalogAPI = getMediaCatalogAPI();

        // Stop all active debug/analysis tools and cancel auto load
        const stopActiveTools = getStopActiveTools();
        if (stopActiveTools) stopActiveTools();

        // Stop any running RZX playback when loading new file (unless this IS an RZX)
        if (result.frames === undefined && spectrum.isRZXPlaying()) {
            spectrum.rzxStop();
            updateRZXStatus();
        }

        // Update last loaded file label
        const lastFileEl = document.getElementById('lastLoadedFile');
        if (lastFileEl) lastFileEl.textContent = fileName;

        // Update media indicators based on result type
        if (result.diskInserted || result.diskFile) {
            const drv = result._driveIndex || 0;
            const ctrl = result.isDSK ? 'fdc' : result.diskType === 'mdr' ? 'if1' : result.diskType === 'mgt' ? 'plusd' : 'beta';
            updateMediaIndicator(fileName, 'disk', drv);
            mediaCatalogAPI.buildDiskCatalog(drv, ctrl);
        } else if (result.blocks !== undefined) {
            updateMediaIndicator(fileName, 'tape');
            // Update tape position display and catalog
            mediaCatalogAPI.updateTapePosition();
            mediaCatalogAPI.buildTapeCatalog();
        }

        // Load labels, regions, comments, and xrefs for this file
        labelManager.setCurrentFile(fileName);
        regionManager.setCurrentFile(fileName);
        commentManager.setCurrentFile(fileName);
        xrefManager.setCurrentFile(fileName);
        operandFormatManager.setCurrentFile(fileName);
        subroutineManager.setCurrentFile(fileName);
        getAnalysisAPI().updateXrefStats();

        // Check result type by properties
        if (result.isDSK && result.diskInserted) {
            // DSK disk inserted into µPD765 FDC (+3)
            const dskDrive = result._driveIndex || 0;
            const dskLetter = String.fromCharCode(65 + dskDrive);
            // Auto-boot only when loading into drive A (drive 0)
            if (autoLoaderAPI.isAutoLoadEnabled() && spectrum.machineType === '+3' && dskDrive === 0) {
                showMessage(`DSK disk inserted in ${dskLetter}: ${result.diskName} (${result.fileCount} files). Auto booting +3...`);
                autoLoaderAPI.startAutoLoadPlus3Disk();
            } else {
                if (!spectrum.isRunning()) spectrum.start();
                showMessage(`DSK disk inserted in ${dskLetter}: ${result.diskName} (${result.fileCount} files).`);
            }
        } else if (result.diskInserted && result.diskType === 'mgt') {
            // MGT disk inserted into +D interface
            const mgtDrive = result._driveIndex || 0;
            const mgtLetter = String.fromCharCode(65 + mgtDrive);
            if (!spectrum.isRunning()) spectrum.start();
            let msg = `MGT disk inserted in +D ${mgtLetter}: ${result.diskName} (${result.fileCount} files).`;
            if (result.plusDRequired) {
                msg += ' Enable +D interface and load plusd.rom in Settings to use.';
            }
            showMessage(msg);
        } else if (result.diskInserted && result.diskType === 'mdr') {
            // MDR cartridge inserted into Interface 1
            const mdvDrive = result._driveIndex || 0;
            if (!spectrum.isRunning()) spectrum.start();
            let msg = `Cartridge inserted in Microdrive ${mdvDrive + 1}: ${result.diskName} (${result.fileCount} files).`;
            if (result.if1Required) {
                msg += ' Enable Interface 1 and load if1.rom in Settings to use.';
            }
            showMessage(msg);
        } else if (result.diskInserted) {
            // TRD/SCL disk inserted into Beta Disk interface
            const trdDrive = result._driveIndex || 0;
            const trdLetter = String.fromCharCode(65 + trdDrive);
            // Auto-load only when loading into drive A (drive 0) and Beta Disk available
            const canBootTrdos = spectrum.profile.betaDiskDefault ||
                (spectrum.betaDiskEnabled && spectrum.memory.hasTrdosRom());
            if (autoLoaderAPI.isAutoLoadEnabled() && canBootTrdos && trdDrive === 0) {
                const typeStr = result.diskType.toUpperCase();
                const bootMode = getBootAPI ? getBootAPI().getBootMode() : 'none';
                if (bootMode === 'run_first' || bootMode === 'run_last') {
                    // Find BASIC files in disk listing, skip "boot" unless it's the only one
                    const allBasic = (result._diskFiles || []).filter(f => f.type === 'basic');
                    const nonBoot = allBasic.filter(f => f.name.trim().toLowerCase() !== 'boot');
                    const basicFiles = nonBoot.length > 0 ? nonBoot : allBasic;
                    if (basicFiles.length > 0) {
                        const target = bootMode === 'run_first' ? basicFiles[0] : basicFiles[basicFiles.length - 1];
                        showMessage(`${typeStr} disk inserted in ${trdLetter}: ${result.diskName}. Running "${target.name}"...`);
                        autoLoaderAPI.startAutoLoadDiskRun(target.name);
                    } else {
                        showMessage(`${typeStr} disk inserted in ${trdLetter}: ${result.diskName} (no BASIC files found). Auto booting TR-DOS...`);
                        autoLoaderAPI.startAutoLoadDisk();
                    }
                } else {
                    showMessage(`${typeStr} disk inserted in ${trdLetter}: ${result.diskName} (${result.fileCount} files). Auto booting TR-DOS...`);
                    autoLoaderAPI.startAutoLoadDisk();
                }
            } else {
                if (!spectrum.isRunning()) spectrum.start();
                const typeStr = result.diskType.toUpperCase();
                showMessage(`${typeStr} disk inserted in ${trdLetter}: ${result.diskName} (${result.fileCount} files).`);
            }
        } else if (result.diskFile) {
            // TRD/SCL disk file - ensure emulator is running
            if (!spectrum.isRunning()) spectrum.start();

            if (result.useTrdos) {
                // TR-DOS mode - show instructions
                if (result.manualBoot) {
                    showMessage(`Disk loaded. Select TR-DOS from Pentagon menu, then type ${result.trdosCommand}`);
                } else {
                    showMessage(`TR-DOS: Type ${result.trdosCommand} to run ${result.fileName}`);
                }
            } else {
                const addrHex = hex16(result.start);
                if (result.fileType === 'code') {
                    showMessage(`${result.diskType.toUpperCase()}: ${result.fileName} loaded at ${addrHex}h (${result.length} bytes) - RANDOMIZE USR ${result.start} to run`);
                } else if (result.fileType === 'basic') {
                    // BASIC program - auto-loading via injected LOAD ""
                    if (result.autoload) {
                        showMessage(`${result.diskType.toUpperCase()}: ${result.fileName} - Loading...`);
                    } else {
                        showMessage(`${result.diskType.toUpperCase()}: ${result.fileName} loaded - Type LOAD "" to load`);
                    }
                } else {
                    showMessage(`${result.diskType.toUpperCase()}: Loaded ${result.fileName}`);
                }
            }
        } else if (result.blocks !== undefined) {
            // TAP/TZX file
            const isTzx = /\.tzx/i.test(fileName);
            if (autoLoaderAPI.isAutoLoadEnabled()) {
                // +3: eject FDC disks so the ROM Loader falls through to tape
                if (spectrum.machineType === '+3' && spectrum.fdc) {
                    for (let i = 0; i < 2; i++) {
                        spectrum.clearDisk(i, 'fdc');
                    }
                    mediaCatalogAPI.clearDiskCatalog();
                    document.getElementById('diskInfo').style.display = 'none';
                }
                showMessage(`${isTzx ? 'TZX' : 'TAP'} loaded: ${result.blocks} blocks. Auto loading...`);
                autoLoaderAPI.startAutoLoadTape(isTzx);
            } else {
                showMessage(`${isTzx ? 'TZX' : 'TAP'} loaded: ${result.blocks} blocks. Type LOAD "" to load.`);
            }
        } else if (result.frames !== undefined) {
            // RZX file - stop immediately and show debugger
            spectrum.stop();
            setDisasm(null);

            // Reload ROM if needed (machine type changed or ROM incompatible)
            if (result.needsRomReload || !spectrum.romLoaded) {
                loadRomsForMachineType(spectrum, result.machineType);
            }

            const creatorInfo = result.creator ? ` (${result.creator.name})` : '';
            const pc = spectrum.cpu ? spectrum.cpu.pc : 0;
            const pcHex = hex16(pc);
            showMessage(`RZX loaded: ${result.frames} frames${creatorInfo} - PC: ${pcHex} (paused, press Resume to play)`);

            openDebuggerPanel();
            updateRZXStatus();
            updateStatus();
            updateDebugger();

            // Render the snapshot screen (updateCanvasSize() clears the canvas)
            spectrum.renderToScreen();
        } else {
            // SNA/Z80/SZX snapshot - machine type may have changed
            showMessage(`Snapshot loaded (${result.machineType.toUpperCase()}): ${fileName}`);

            // Re-apply appropriate ROM after machine switch (and set romLoaded flag)
            const romReloaded = loadRomsForMachineType(spectrum, result.machineType);

            // If ROM was reloaded after machine type change, start emulation
            // (snapshot loaders try to start but fail if romLoaded was false)
            if (romReloaded && !spectrum.running) {
                spectrum.start();
            }

            // Reset disassembler to use fresh memory reference
            setDisasm(null);

            updateStatus();
            updateDebugger();
        }
    }

    // Show file selection modal (ZIP or disk image)
    async function showZipSelection(result, fileName) {
        const spectrum = getSpectrum();
        const displayAPI = getDisplayAPI();

        pendingZipResult = { result, fileName };
        zipFileList.innerHTML = '';

        const isDisk = result.diskType;
        const modalTitle = zipModal.querySelector('h2');
        const modalDesc = zipModal.querySelector('p');

        // Check Beta Disk availability for disk images
        if (isDisk && result.needsMachineSwitch) {
            // Beta Disk not available - warn user and don't force machine switch
            if (!romData['trdos.rom']) {
                showMessage('TR-DOS ROM required for disk images. Load trdos.rom first.', 'error');
            } else {
                showMessage('Enable Beta Disk in Settings, or switch to Pentagon/Scorpion mode for disk images.', 'error');
            }
            return;
        } else if (isDisk && romData['trdos.rom'] && !spectrum.memory.hasTrdosRom()) {
            // TR-DOS ROM available but not loaded into memory - load it now
            spectrum.memory.loadTrdosRom(romData['trdos.rom']);
            spectrum.trdosTrap.updateTrdosRomFlag();
        }

        if (isDisk) {
            modalTitle.textContent = `Select File from ${result.diskType.toUpperCase()}`;
            modalDesc.textContent = 'Select file to load, or boot TR-DOS for command prompt:';
            // Show Boot TR-DOS button if Beta Disk available (Pentagon OR enabled with TR-DOS ROM)
            const hasTrdosRom = spectrum.memory.hasTrdosRom && spectrum.memory.hasTrdosRom();
            const betaDiskAvailable = spectrum.profile.betaDiskDefault || spectrum.betaDiskEnabled;
            btnBootTrdos.style.display = (betaDiskAvailable && hasTrdosRom) ? 'inline-block' : 'none';
        } else {
            modalTitle.textContent = 'Select File to Load';
            modalDesc.textContent = 'The archive contains multiple files. Select one to load:';
            btnBootTrdos.style.display = 'none';
        }

        // Create sorted list with original indices
        const sortedFiles = result.files
            .map((file, index) => ({ file, index: isDisk ? file.index : index }))
            .sort((a, b) => a.file.name.localeCompare(b.file.name));

        sortedFiles.forEach(({ file, index }) => {
            const item = document.createElement('div');
            item.className = 'zip-file-item';

            // For disk files, show more details
            if (isDisk) {
                const isBoot = file.name.toLowerCase().startsWith('boot');
                const typeLabel = file.type === 'basic' ? 'BASIC' :
                                 file.type === 'code' ? 'CODE' :
                                 file.type === 'data' ? 'DATA' : file.type.toUpperCase();
                const startHex = hex16(file.start);
                const bootBadge = isBoot ? ' <span style="color: var(--success-color); font-weight: bold;">[BOOT]</span>' : '';
                item.innerHTML = `
                    <span class="zip-file-name">${file.name}${bootBadge}</span>
                    <span class="zip-file-type">${typeLabel}</span>
                    <span class="zip-file-info">${startHex}h, ${file.length} bytes</span>
                `;
                if (isBoot) {
                    item.style.borderLeft = '3px solid var(--success-color)';
                }
            } else {
                item.innerHTML = `
                    <span class="zip-file-name">${file.name}</span>
                    <span class="zip-file-type">${file.type}</span>
                `;
            }

            item.addEventListener('click', async () => {
                zipModal.classList.add('hidden');

                // Save current settings before loading (may trigger machine type change)
                const savedPaletteId = displayAPI.getPaletteValue();
                const savedFullBorder = getSpectrum().ula.fullBorderMode;

                try {
                    const spectrum = getSpectrum();
                    let loadResult;
                    if (isDisk) {
                        // Load from disk image
                        loadResult = spectrum.loadFromDiskSelection(result, index);
                    } else if (file.type === 'rzx') {
                        // Handle RZX files specially (async loading)
                        const rzxData = result._zipFiles[index].data;
                        loadResult = await spectrum.loadRZX(rzxData);
                        // Reload ROM if needed (machine type changed or ROM incompatible)
                        if (loadResult.needsRomReload || !spectrum.romLoaded) {
                            loadRomsForMachineType(spectrum, loadResult.machineType);
                        }
                    } else if (file.type === 'trd' || file.type === 'scl') {
                        // Disk image inside ZIP - handle disk insertion
                        loadResult = spectrum.loadFromZipSelection(result, index);
                        if (loadResult.diskInserted) {
                            handleDiskInserted(loadResult, file.name, { fullBorder: savedFullBorder, paletteId: savedPaletteId });
                            pendingZipResult = null;
                            return;
                        }
                    } else {
                        loadResult = spectrum.loadFromZipSelection(result, index);
                    }

                    // Restore full border setting (machine type change creates new ULA)
                    if (spectrum.ula.setFullBorder(savedFullBorder)) {
                        spectrum.updateDisplayDimensions();
                    }

                    // Update canvas sizes after loading (machine type change may affect dimensions)
                    updateCanvasSize();

                    // Restore palette after loading (machine type change creates new ULA)
                    if (displayAPI) {
                        displayAPI.applyPalette(savedPaletteId);
                    }

                    handleLoadResult(loadResult, file.name);
                } catch (e) {
                    showMessage('Failed to load: ' + e.message, 'error');
                }
                pendingZipResult = null;
            });
            zipFileList.appendChild(item);
        });

        zipModal.classList.remove('hidden');
    }

    btnZipCancel.addEventListener('click', () => {
        zipModal.classList.add('hidden');
        pendingZipResult = null;
        btnBootTrdos.style.display = 'none';
        // Make sure emulator is running after dialog closes
        if (!getSpectrum().isRunning()) getSpectrum().start();
    });

    btnBootTrdos.addEventListener('click', () => {
        const spectrum = getSpectrum();
        zipModal.classList.add('hidden');
        pendingZipResult = null;
        btnBootTrdos.style.display = 'none';

        // Boot into TR-DOS
        if (spectrum.bootTrdos()) {
            spectrum.start();
            showMessage('TR-DOS started. Type RUN or LOAD "filename" to run programs.');
        } else {
            // Determine what's missing
            if (!spectrum.memory.hasTrdosRom()) {
                showMessage('Cannot boot TR-DOS: trdos.rom not loaded', 'error');
            } else if (!spectrum.profile.betaDiskDefault && !spectrum.betaDiskEnabled) {
                showMessage('Cannot boot TR-DOS: Enable Beta Disk in Settings', 'error');
            } else {
                showMessage('Cannot boot TR-DOS', 'error');
            }
        }
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const ext = file.name.toLowerCase().split('.').pop();

        // Project files (.zxproj, .json) — load as project
        if (ext === 'zxproj' || ext === 'json') {
            const reader = new FileReader();
            reader.onload = (event) => {
                getLoadProject()(event.target.result);
            };
            reader.onerror = () => showMessage('Failed to read file: ' + file.name, 'error');
            reader.readAsText(file);
            fileInput.value = '';
            return;
        }

        // Check if ROM loaded
        const spectrum = getSpectrum();
        if (!spectrum.romLoaded) {
            showMessage('Please load ROM files first', 'error');
            showRomModal();
            fileInput.value = '';
            return;
        }

        try {
            const driveIndex = getSelectedDriveIndex();
            const result = await spectrum.loadFile(file, driveIndex);

            // Update canvas sizes after loading (machine type change may affect dimensions)
            updateCanvasSize();

            // Check if ZIP needs file selection
            if (result.needsSelection) {
                showZipSelection(result, file.name);
            } else if (result.diskInserted) {
                // Handle disk image with machine switch if needed
                handleDiskInserted(result, file.name);
            } else {
                handleLoadResult(result, file.name);
            }
        } catch (e) {
            showMessage('Failed to load: ' + e.message, 'error');
        }
        fileInput.value = '';
    });

    // Check if assembler tab is active
    function isAssemblerTabActive() {
        const asmTab = document.getElementById('tab-assembler');
        return asmTab && asmTab.classList.contains('active');
    }

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (isRomModalVisible()) return;
        // Don't show drop zone overlay when assembler tab is active
        // (assembler has its own drop handling with visual feedback)
        if (isAssemblerTabActive()) return;
        dropZone.classList.add('active');
    });

    document.addEventListener('dragleave', (e) => {
        if (e.target === dropZone) dropZone.classList.remove('active');
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('active');
        if (isRomModalVisible()) return;
        // Skip if assembler tab is active (handled by assembler's own drop handler)
        if (isAssemblerTabActive()) return;

        const file = e.dataTransfer.files[0];
        if (!file) return;
        const ext = file.name.toLowerCase().split('.').pop();

        try {
            if (ext === 'zxproj' || ext === 'json') {
                const text = await file.text();
                getLoadProject()(text);
            } else if (ext === 'rom' || ext === 'bin') {
                const spectrum = getSpectrum();
                const data = await file.arrayBuffer();
                if (data.byteLength >= 32768) {
                    romData['128.rom'] = data;
                    if (spectrum.machineType !== '48k') {
                        spectrum.memory.loadRom(data.slice(0, 16384), 0);
                        spectrum.memory.loadRom(data.slice(16384, 32768), 1);
                    }
                } else {
                    romData['48.rom'] = data;
                    spectrum.memory.loadRom(data, 0);
                }
                spectrum.romLoaded = true;
                showMessage('ROM loaded: ' + file.name);
            } else if (ext === 'sna' || ext === 'tap' || ext === 'tzx' || ext === 'z80' || ext === 'szx' || ext === 'zip' || ext === 'trd' || ext === 'scl' || ext === 'dsk' || ext === 'mdr' || ext === 'rzx') {
                const spectrum = getSpectrum();
                if (!spectrum.romLoaded) {
                    showMessage('Please load ROM files first', 'error');
                    showRomModal();
                    return;
                }

                const driveIndex = getSelectedDriveIndex();
                const result = await spectrum.loadFile(file, driveIndex);

                // Update canvas sizes after loading (machine type change may affect dimensions)
                updateCanvasSize();

                // Check if ZIP needs file selection
                if (result.needsSelection) {
                    showZipSelection(result, file.name);
                } else if (result.diskInserted) {
                    // Handle disk image with machine switch if needed
                    handleDiskInserted(result, file.name);
                } else {
                    handleLoadResult(result, file.name);
                }
            }
        } catch (e) {
            showMessage('Failed to load: ' + e.message, 'error');
        }
    });

    // Blank disk button
    document.getElementById('btnBlankDisk').addEventListener('click', () => {
        const spectrum = getSpectrum();
        if (!spectrum.betaDisk) {
            showMessage('Beta Disk not available', 'error');
            return;
        }
        const driveIndex = getSelectedDriveIndex();
        spectrum.betaDisk.createBlankDisk('BLANK', driveIndex);
        // Update per-drive media state
        spectrum.loadedBetaDisks[driveIndex] = { data: spectrum.betaDisk.drives[driveIndex].diskData, name: '[blank]' };
        spectrum.loadedBetaDiskFiles[driveIndex] = [];
        const driveLetter = String.fromCharCode(65 + driveIndex);
        // Show disk name and activity indicators
        updateMediaIndicator('[blank]', 'disk', driveIndex);
        diskActivityEl.style.display = 'inline-block';
        diskStatusEl.textContent = 'ready';
        diskLedEl.style.color = '';
        showMessage(`Blank formatted disk inserted in drive ${driveLetter}:`);
        getMediaCatalogAPI().clearDiskCatalog(driveIndex);
    });

    return {
        handleLoadResult,
        handleDiskInserted,
        updateMediaIndicator,
        updateDriveSelector,
        getSelectedDriveIndex,
        showZipSelection
    };
}
