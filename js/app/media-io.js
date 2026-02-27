// Media I/O — disk management, tape handling, file load/drop, quicksave/quickload, auto-load
// Extracted from index.html lines ~31047-32228, ~32453-32510, ~34493-34962

import { romData } from './rom-manager.js';

// Tape header constants (used by describeTapeBlock)
const TAPE_STD_PILOT_PULSE   = 2168;
const TAPE_TURBO_TOLERANCE   = 50;
const TAPE_STD_FLAG           = 0x00;
const TAPE_HDR_MIN_LENGTH    = 18;
const TAPE_HDR_TYPE_PROGRAM  = 0;
const TAPE_HDR_TYPE_NUM_ARR  = 1;
const TAPE_HDR_TYPE_CHR_ARR  = 2;
const TAPE_HDR_TYPE_BYTES    = 3;

// TRD disk geometry
const TRD_SECTOR_SIZE        = 256;
const TRD_SECTOR9_OFFSET     = 8 * TRD_SECTOR_SIZE;
const TRD_FREE_SECS_LO      = 0xE5;
const TRD_FREE_SECS_HI      = 0xE6;
const TRD_LABEL_OFFSET       = 0xF5;
const TRD_LABEL_LENGTH       = 8;
const TRD_MIN_IMAGE_SIZE     = 0x8E7;

// Auto Load timing constants (ms)
const AUTO_LOAD_ROM_WAIT     = 3000;
const AUTO_LOAD_128K_WAIT    = 1500;
const AUTO_LOAD_KEY_HOLD     = 200;
const AUTO_LOAD_KEY_GAP      = 150;

// ========== Beta Disk Status ==========

export function updateBetaDiskStatus(spectrum) {
    const chkBetaDisk = document.getElementById('chkBetaDisk');
    const betaDiskStatus = document.getElementById('betaDiskStatus');

    if (spectrum.profile.betaDiskDefault) {
        betaDiskStatus.textContent = '(always on for ' + spectrum.profile.name + ')';
        chkBetaDisk.checked = true;
        chkBetaDisk.disabled = true;
    } else {
        chkBetaDisk.disabled = false;
        if (!romData['trdos.rom']) {
            betaDiskStatus.textContent = '(trdos.rom required)';
        } else if (chkBetaDisk.checked) {
            betaDiskStatus.textContent = '';
        } else {
            betaDiskStatus.textContent = '';
        }
    }
}

// ========== Drive Selector ==========

export function updateDriveSelector(spectrum) {
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

export function getSelectedDriveIndex() {
    const sel = document.getElementById('driveSelectorSelect');
    return parseInt(sel.value, 10) || 0;
}

// ========== Media Indicator ==========

export function updateMediaIndicator(fileName, type, driveIndex, spectrum) {
    const ext = fileName.split('.').pop().toLowerCase();
    if (type === 'tape' || ext === 'tap' || ext === 'tzx') {
        document.getElementById('tapeLed').title = fileName;
        document.getElementById('tapeInfo').style.display = 'inline-block';
    } else if (type === 'disk' || ext === 'trd' || ext === 'scl' || ext === 'dsk') {
        // Build tooltip listing all loaded drives
        const driveNames = [];
        const betaDisks = spectrum.loadedBetaDisks;
        const fdcDisks = spectrum.loadedFDCDisks;
        if (spectrum.machineType === '+3') {
            for (let i = 0; i < 2; i++) {
                if (fdcDisks[i]) driveNames.push(`${String.fromCharCode(65 + i)}: ${fdcDisks[i].name}`);
            }
        } else {
            for (let i = 0; i < 4; i++) {
                if (betaDisks[i]) driveNames.push(`${String.fromCharCode(65 + i)}: ${betaDisks[i].name}`);
            }
        }
        document.getElementById('diskInfoLed').title = driveNames.join('\n') || fileName;
        document.getElementById('diskInfo').style.display = 'inline-block';
    }
}

// ========== Handle Disk Inserted ==========

export function handleDiskInserted(result, fileName, spectrum, showMessage, handleLoadResultFn) {
    if (result.needsMachineSwitch) {
        if (!romData['trdos.rom']) {
            showMessage('TR-DOS ROM required for disk images. Load trdos.rom first.', 'error');
        } else {
            showMessage('Enable Beta Disk in Settings, or switch to Pentagon/Scorpion mode for disk images.', 'error');
        }
        return;
    }

    handleLoadResultFn(result, fileName);
}

// ========== Handle Load Result ==========

export function handleLoadResult(result, fileName, spectrum, showMessage, deps) {
    const {
        cancelAutoLoad, updateRZXStatus, updateTapePosition, buildTapeCatalog,
        buildDiskCatalog, updateMediaIndicator: updateMediaIndicatorFn,
        labelManager, regionManager, commentManager, xrefManager,
        operandFormatManager, subroutineManager, updateXrefStats,
        chkAutoLoad, startAutoLoadTape, startAutoLoadDisk, startAutoLoadPlus3Disk,
        loadRomsForMachineType, openDebuggerPanel, updateDebugger, updateStatus,
        updateCanvasSize
    } = deps;

    // Cancel any in-progress auto load sequence
    cancelAutoLoad();

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
        const ctrl = result.isDSK ? 'fdc' : 'beta';
        updateMediaIndicatorFn(fileName, 'disk', drv);
        if (typeof buildDiskCatalog === 'function') {
            buildDiskCatalog(drv, ctrl);
        }
    } else if (result.blocks !== undefined) {
        updateMediaIndicatorFn(fileName, 'tape');
        if (typeof updateTapePosition === 'function') {
            updateTapePosition();
        }
        if (typeof buildTapeCatalog === 'function') {
            buildTapeCatalog();
        }
    }

    // Load labels, regions, comments, and xrefs for this file
    labelManager.setCurrentFile(fileName);
    regionManager.setCurrentFile(fileName);
    commentManager.setCurrentFile(fileName);
    xrefManager.setCurrentFile(fileName);
    operandFormatManager.setCurrentFile(fileName);
    subroutineManager.setCurrentFile(fileName);
    updateXrefStats();

    const hex16 = (v) => v.toString(16).toUpperCase().padStart(4, '0');

    // Check result type by properties
    if (result.isDSK && result.diskInserted) {
        const dskDrive = result._driveIndex || 0;
        const dskLetter = String.fromCharCode(65 + dskDrive);
        if (chkAutoLoad.checked && spectrum.machineType === '+3' && dskDrive === 0) {
            showMessage(`DSK disk inserted in ${dskLetter}: ${result.diskName} (${result.fileCount} files). Auto booting +3...`);
            startAutoLoadPlus3Disk();
        } else {
            if (!spectrum.isRunning()) spectrum.start();
            showMessage(`DSK disk inserted in ${dskLetter}: ${result.diskName} (${result.fileCount} files).`);
        }
    } else if (result.diskInserted) {
        const trdDrive = result._driveIndex || 0;
        const trdLetter = String.fromCharCode(65 + trdDrive);
        const canBootTrdos = spectrum.profile.betaDiskDefault ||
            (spectrum.betaDiskEnabled && spectrum.memory.hasTrdosRom());
        if (chkAutoLoad.checked && canBootTrdos && trdDrive === 0) {
            const typeStr = result.diskType.toUpperCase();
            showMessage(`${typeStr} disk inserted in ${trdLetter}: ${result.diskName} (${result.fileCount} files). Auto booting TR-DOS...`);
            startAutoLoadDisk();
        } else {
            if (!spectrum.isRunning()) spectrum.start();
            const typeStr = result.diskType.toUpperCase();
            showMessage(`${typeStr} disk inserted in ${trdLetter}: ${result.diskName} (${result.fileCount} files).`);
        }
    } else if (result.diskFile) {
        if (!spectrum.isRunning()) spectrum.start();
        if (result.useTrdos) {
            if (result.manualBoot) {
                showMessage(`Disk loaded. Select TR-DOS from Pentagon menu, then type ${result.trdosCommand}`);
            } else {
                showMessage(`TR-DOS: Type ${result.trdosCommand} to run ${result.fileName}`);
            }
        } else {
            const addrHex = result.start.toString(16).toUpperCase().padStart(4, '0');
            if (result.fileType === 'code') {
                showMessage(`${result.diskType.toUpperCase()}: ${result.fileName} loaded at ${addrHex}h (${result.length} bytes) - RANDOMIZE USR ${result.start} to run`);
            } else if (result.fileType === 'basic') {
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
        const isTzx = /\.tzx/i.test(fileName);
        if (chkAutoLoad.checked) {
            showMessage(`${isTzx ? 'TZX' : 'TAP'} loaded: ${result.blocks} blocks. Auto loading...`);
            startAutoLoadTape(isTzx);
        } else {
            showMessage(`${isTzx ? 'TZX' : 'TAP'} loaded: ${result.blocks} blocks. Type LOAD "" to load.`);
        }
    } else if (result.frames !== undefined) {
        spectrum.stop();
        deps.disasm = null;

        if (result.needsRomReload || !spectrum.romLoaded) {
            loadRomsForMachineType(spectrum, result.machineType);
        }

        const creatorInfo = result.creator ? ` (${result.creator.name})` : '';
        const pc = spectrum.cpu ? spectrum.cpu.pc : 0;
        const pcHex = pc.toString(16).toUpperCase().padStart(4, '0');
        showMessage(`RZX loaded: ${result.frames} frames${creatorInfo} - PC: ${pcHex} (paused, press Resume to play)`);

        openDebuggerPanel();
        updateRZXStatus();
        updateStatus();
        updateDebugger();

        spectrum.renderToScreen();
    } else {
        showMessage(`Snapshot loaded (${result.machineType.toUpperCase()}): ${fileName}`);

        const romReloaded = loadRomsForMachineType(spectrum, result.machineType);

        if (romReloaded && !spectrum.running) {
            spectrum.start();
        }

        deps.disasm = null;

        updateStatus();
        updateDebugger();
    }
}

// ========== ZIP Selection ==========

export async function showZipSelection(result, fileName, spectrum, showMessage, deps) {
    const {
        handleLoadResultFn, handleDiskInsertedFn, loadRomsForMachineType,
        updateCanvasSize, applyPalette, paletteSelect, buildDiskCatalog
    } = deps;

    const zipModal = document.getElementById('zipModal');
    const zipFileList = document.getElementById('zipFileList');
    const btnBootTrdos = document.getElementById('btnBootTrdos');
    let pendingZipResult = { result, fileName };
    zipFileList.innerHTML = '';

    const isDisk = result.diskType;
    const modalTitle = zipModal.querySelector('h2');
    const modalDesc = zipModal.querySelector('p');

    // Check Beta Disk availability for disk images
    if (isDisk && result.needsMachineSwitch) {
        if (!romData['trdos.rom']) {
            showMessage('TR-DOS ROM required for disk images. Load trdos.rom first.', 'error');
        } else {
            showMessage('Enable Beta Disk in Settings, or switch to Pentagon/Scorpion mode for disk images.', 'error');
        }
        return;
    } else if (isDisk && romData['trdos.rom'] && !spectrum.memory.hasTrdosRom()) {
        spectrum.memory.loadTrdosRom(romData['trdos.rom']);
        spectrum.trdosTrap.updateTrdosRomFlag();
    }

    if (isDisk) {
        modalTitle.textContent = `Select File from ${result.diskType.toUpperCase()}`;
        modalDesc.textContent = 'Select file to load, or boot TR-DOS for command prompt:';
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

        if (isDisk) {
            const isBoot = file.name.toLowerCase().startsWith('boot');
            const typeLabel = file.type === 'basic' ? 'BASIC' :
                             file.type === 'code' ? 'CODE' :
                             file.type === 'data' ? 'DATA' : file.type.toUpperCase();
            const startHex = file.start.toString(16).toUpperCase().padStart(4, '0');
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

            const savedPaletteId = paletteSelect?.value || 'default';
            const savedFullBorder = spectrum.ula.fullBorderMode;

            try {
                let loadResult;
                if (isDisk) {
                    loadResult = spectrum.loadFromDiskSelection(result, index);
                } else if (file.type === 'rzx') {
                    const rzxData = result._zipFiles[index].data;
                    loadResult = await spectrum.loadRZX(rzxData);
                    if (loadResult.needsRomReload || !spectrum.romLoaded) {
                        loadRomsForMachineType(spectrum, loadResult.machineType);
                    }
                } else if (file.type === 'trd' || file.type === 'scl') {
                    loadResult = spectrum.loadFromZipSelection(result, index);
                    if (loadResult.diskInserted) {
                        handleDiskInsertedFn(loadResult, file.name);
                        pendingZipResult = null;
                        return;
                    }
                } else {
                    loadResult = spectrum.loadFromZipSelection(result, index);
                }

                if (spectrum.ula.setFullBorder(savedFullBorder)) {
                    spectrum.updateDisplayDimensions();
                }

                updateCanvasSize();

                if (typeof applyPalette === 'function') {
                    applyPalette(savedPaletteId);
                }

                handleLoadResultFn(loadResult, file.name);
            } catch (e) {
                showMessage('Failed to load: ' + e.message, 'error');
            }
            pendingZipResult = null;
        });
        zipFileList.appendChild(item);
    });

    zipModal.classList.remove('hidden');
}

// ========== Quicksave / Quickload ==========

const QUICKSAVE_KEY = 'zx-quicksave';

export function quicksave(spectrum, showMessage) {
    try {
        const data = spectrum.saveSnapshot('szx');
        // Convert to base64 for localStorage
        let binary = '';
        const bytes = new Uint8Array(data);
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        localStorage.setItem(QUICKSAVE_KEY, base64);
        localStorage.setItem(QUICKSAVE_KEY + '-machine', spectrum.machineType);
        localStorage.setItem(QUICKSAVE_KEY + '-time', new Date().toLocaleString());
        showMessage('Quicksave (F5 to load)', 'success');
    } catch (err) {
        showMessage('Quicksave failed: ' + err.message, 'error');
    }
}

export async function quickload(spectrum, showMessage, handleLoadResultFn, updateCanvasSizeFn) {
    try {
        const base64 = localStorage.getItem(QUICKSAVE_KEY);
        if (!base64) {
            showMessage('No quicksave found (F2 to save)', 'warning');
            return;
        }
        // Convert from base64
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const file = new File([blob], 'quicksave.szx');
        const result = await spectrum.loadFile(file);
        handleLoadResultFn(result, 'Quicksave');
        updateCanvasSizeFn();
        showMessage('Quickload successful');
    } catch (err) {
        showMessage('Quickload failed: ' + err.message, 'error');
    }
}

// ========== Auto Load Engine ==========

let autoLoadTimers = [];
let autoLoadActive = false;

export function cancelAutoLoad(spectrum) {
    for (const id of autoLoadTimers) clearTimeout(id);
    autoLoadTimers = [];
    if (autoLoadActive) {
        spectrum.ula.keyboardState.fill(0xFF);
        autoLoadActive = false;
    }
}

function autoLoadTimeout(fn, delay) {
    const id = setTimeout(() => {
        const idx = autoLoadTimers.indexOf(id);
        if (idx >= 0) autoLoadTimers.splice(idx, 1);
        fn();
    }, delay);
    autoLoadTimers.push(id);
}

export function startAutoLoadTape(isTzx, spectrum, showMessage) {
    cancelAutoLoad(spectrum);
    autoLoadActive = true;
    const machType = spectrum.machineType;
    const isAmsMenu = machType === '+2' || machType === '+2a' || machType === '+3';
    const is128K = machType !== '48k';
    const ula = spectrum.ula;
    const chkFlashLoad = document.getElementById('chkFlashLoad');
    const tapeLoadModeEl = document.getElementById('tapeLoadMode');

    // Reset (tape data survives reset - only rewinds)
    spectrum.stop();
    spectrum.reset();
    spectrum.start();

    let t = 0;

    if (isTzx && spectrum.getTapeFlashLoad() &&
        spectrum.tapeLoader.getBlockCount() === 0 &&
        spectrum.tapePlayer.hasMoreBlocks()) {
        spectrum.setTapeFlashLoad(false);
        chkFlashLoad.checked = false;
        tapeLoadModeEl.textContent = '(real-time)';
    }

    if (isAmsMenu) {
        t += AUTO_LOAD_ROM_WAIT;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadTimeout(() => {
            if (!autoLoadActive) return;
            ula.keyUp('Enter');
            ula.keyboardState.fill(0xFF);
            if (!spectrum.getTapeFlashLoad()) {
                if (!spectrum.tapePlayer.isPlaying()) {
                    spectrum.playTape();
                }
            }
            autoLoadActive = false;
        }, t);
        return;
    }

    if (is128K) {
        t += AUTO_LOAD_ROM_WAIT;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('1'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('1'); ula.keyboardState.fill(0xFF); }, t);
        t += AUTO_LOAD_128K_WAIT;
    } else {
        t += AUTO_LOAD_ROM_WAIT;
    }

    // J = LOAD
    autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('j'); }, t);
    t += AUTO_LOAD_KEY_HOLD;
    autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('j'); ula.keyboardState.fill(0xFF); }, t);
    t += AUTO_LOAD_KEY_GAP;

    // Symbol+P = first "
    autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
    t += AUTO_LOAD_KEY_HOLD;
    autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
    t += AUTO_LOAD_KEY_GAP;

    // Symbol+P = second "
    autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
    t += AUTO_LOAD_KEY_HOLD;
    autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
    t += AUTO_LOAD_KEY_GAP;

    // Enter
    autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
    t += AUTO_LOAD_KEY_HOLD;
    autoLoadTimeout(() => {
        if (!autoLoadActive) return;
        ula.keyUp('Enter');
        ula.keyboardState.fill(0xFF);
        if (!spectrum.getTapeFlashLoad()) {
            if (!spectrum.tapePlayer.isPlaying()) {
                spectrum.playTape();
            }
        }
        autoLoadActive = false;
    }, t);
}

export function startAutoLoadDisk(spectrum) {
    cancelAutoLoad(spectrum);
    if (spectrum.bootTrdos()) {
        spectrum.start();
    }
}

export function startAutoLoadPlus3Disk(spectrum) {
    cancelAutoLoad(spectrum);
    autoLoadActive = true;
    const ula = spectrum.ula;

    // Save all FDC drive disks before reset
    const savedDisks = spectrum.fdc ? spectrum.fdc.drives.map(d => d.disk) : [];

    // Reset machine (disk data survives via restore below)
    spectrum.stop();
    spectrum.reset();

    // Restore all drive disks after reset
    if (spectrum.fdc) {
        for (let i = 0; i < savedDisks.length; i++) {
            if (savedDisks[i]) spectrum.fdc.drives[i].disk = savedDisks[i];
        }
    }

    spectrum.start();

    // +3 Amstrad menu: press Enter to select "Loader" (default option)
    let t = AUTO_LOAD_ROM_WAIT;
    autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
    t += AUTO_LOAD_KEY_HOLD;
    autoLoadTimeout(() => {
        if (!autoLoadActive) return;
        ula.keyUp('Enter');
        ula.keyboardState.fill(0xFF);
        autoLoadActive = false;
    }, t);
}

// ========== Tape Catalog & Disk Catalog Helpers ==========

export function describeTapeBlock(block, index) {
    if (!block) return `${index}: ?`;
    const num = String(index + 1).padStart(2, ' ');
    if (block.type === 'pause') return `${num}  Pause ${block.pauseMs || 0}ms`;
    if (block.type === 'stop') return `${num}  Stop Tape`;
    if (block.type !== 'data') return `${num}  ${block.type}`;
    const isTurbo = block.pilotPulse && Math.abs(block.pilotPulse - TAPE_STD_PILOT_PULSE) >= TAPE_TURBO_TOLERANCE;
    const prefix = isTurbo ? 'Turbo' : 'Std';
    const size = block.data ? block.data.length : block.length || 0;
    // Decode standard header
    if (!isTurbo && block.flag === TAPE_STD_FLAG && block.data && block.data.length >= TAPE_HDR_MIN_LENGTH) {
        const d = block.data;
        const hdrType = d[1];
        let name = '';
        for (let i = 2; i < 12; i++) name += String.fromCharCode(d[i] & 0x7f);
        name = name.trimEnd();
        if (hdrType === TAPE_HDR_TYPE_PROGRAM) return `${num}  Header: Program "${name}"`;
        if (hdrType === TAPE_HDR_TYPE_BYTES) return `${num}  Header: Bytes "${name}"`;
        if (hdrType === TAPE_HDR_TYPE_NUM_ARR) return `${num}  Header: Num Array "${name}"`;
        if (hdrType === TAPE_HDR_TYPE_CHR_ARR) return `${num}  Header: Char Array "${name}"`;
        return `${num}  Header: "${name}"`;
    }
    return `${num}  ${prefix} Data (${size} bytes)`;
}

// ========== Boot TRD Helpers ==========

export function trdHasBootFile(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    for (let i = 0; i < 128; i++) {
        const offset = i * 16;
        const firstByte = bytes[offset];
        if (firstByte === 0x00) break;
        if (firstByte === 0x01) continue;
        let filename = '';
        for (let j = 0; j < 8; j++) {
            filename += String.fromCharCode(bytes[offset + j]);
        }
        filename = filename.trimEnd().toLowerCase();
        if (filename === 'boot') return true;
    }
    return false;
}

export function extractBootFile(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    for (let i = 0; i < 128; i++) {
        const offset = i * 16;
        const firstByte = bytes[offset];
        if (firstByte === 0x00) break;
        if (firstByte === 0x01) continue;
        let filename = '';
        for (let j = 0; j < 8; j++) {
            filename += String.fromCharCode(bytes[offset + j]);
        }
        filename = filename.trimEnd().toLowerCase();
        if (filename === 'boot') {
            const fileType = bytes[offset + 8];
            const startAddr = bytes[offset + 9] | (bytes[offset + 10] << 8);
            const length = bytes[offset + 11] | (bytes[offset + 12] << 8);
            const sectorCount = bytes[offset + 13];
            const firstSector = bytes[offset + 14];
            const firstTrack = bytes[offset + 15];
            const dirEntry = bytes.slice(offset, offset + 16);
            const trackOffset = firstTrack * 16 * 256;
            const sectorOffset = firstSector * 256;
            const dataOffset = trackOffset + sectorOffset;
            const fileData = bytes.slice(dataOffset, dataOffset + sectorCount * 256);
            return { dirEntry, fileData, sectorCount, length, startAddr, fileType };
        }
    }
    return null;
}

export function isHobetaFile(data, filename) {
    const lowerName = filename.toLowerCase();
    const hobetaExtensions = ['.$c', '.$b', '.$d', '.$#', '.hobeta'];
    const hasHobetaExt = hobetaExtensions.some(ext => lowerName.endsWith(ext));
    if (!hasHobetaExt) return false;
    if (data.length <= 17) return false;
    const dataSize = data.length - 17;
    const actualSectors = Math.ceil(dataSize / 256);
    if (actualSectors === 0 || actualSectors > 255) return false;
    return true;
}

export function hobetaHasBootFile(data) {
    if (data.length < 17) return false;
    let filename = '';
    for (let i = 0; i < 8; i++) {
        filename += String.fromCharCode(data[i]);
    }
    filename = filename.trimEnd().toLowerCase();
    return filename === 'boot';
}

export function extractBootFromHobeta(data) {
    if (data.length <= 17) return null;
    const fileType = data[8];
    const startAddr = data[9] | (data[10] << 8);
    const length = data[11] | (data[12] << 8);
    const dataSize = data.length - 17;
    const sectorCount = Math.ceil(dataSize / 256);
    const dirEntry = new Uint8Array(16);
    for (let i = 0; i < 8; i++) {
        dirEntry[i] = data[i];
    }
    dirEntry[8] = fileType;
    dirEntry[9] = startAddr & 0xFF;
    dirEntry[10] = (startAddr >> 8) & 0xFF;
    dirEntry[11] = length & 0xFF;
    dirEntry[12] = (length >> 8) & 0xFF;
    dirEntry[13] = sectorCount;
    dirEntry[14] = 0;
    dirEntry[15] = 0;
    const fileData = new Uint8Array(sectorCount * 256);
    fileData.set(data.slice(17));
    return { dirEntry, fileData, sectorCount, length, startAddr, fileType };
}

export function injectBootIntoTrd(trdData, bootInfo, reuseLocation) {
    const result = new Uint8Array(trdData);
    let dirSlot = -1;
    let wasEndMarker = false;
    for (let i = 0; i < 128; i++) {
        const offset = i * 16;
        const firstByte = result[offset];
        if (firstByte === 0x00) { dirSlot = i; wasEndMarker = true; break; }
        if (firstByte === 0x01) { dirSlot = i; wasEndMarker = false; break; }
    }
    if (dirSlot === -1) {
        alert('Cannot add boot: disk directory is full (128 files max)');
        return result;
    }
    const sector8Offset = 8 * 256;
    let firstFreeSector = result[sector8Offset + 0xE1];
    let firstFreeTrack = result[sector8Offset + 0xE2];
    const fileCount = result[sector8Offset + 0xE4];
    let freeSectors = result[sector8Offset + 0xE5] | (result[sector8Offset + 0xE6] << 8);
    if (freeSectors < bootInfo.sectorCount) {
        alert('Cannot add boot: not enough free space on disk');
        return result;
    }
    const dirOffset = dirSlot * 16;
    const bootName = 'boot    ';
    for (let i = 0; i < 8; i++) {
        result[dirOffset + i] = bootName.charCodeAt(i);
    }
    result[dirOffset + 8] = bootInfo.fileType;
    result[dirOffset + 9] = bootInfo.startAddr & 0xFF;
    result[dirOffset + 10] = (bootInfo.startAddr >> 8) & 0xFF;
    result[dirOffset + 11] = bootInfo.length & 0xFF;
    result[dirOffset + 12] = (bootInfo.length >> 8) & 0xFF;
    result[dirOffset + 13] = bootInfo.sectorCount;
    result[dirOffset + 14] = firstFreeSector;
    result[dirOffset + 15] = firstFreeTrack;
    const trackOffset = firstFreeTrack * 16 * 256;
    const sectorOffset = firstFreeSector * 256;
    const dataOffset = trackOffset + sectorOffset;
    result.set(bootInfo.fileData.slice(0, bootInfo.sectorCount * 256), dataOffset);
    let newSector = firstFreeSector + bootInfo.sectorCount;
    let newTrack = firstFreeTrack;
    while (newSector >= 16) {
        newSector -= 16;
        newTrack++;
    }
    result[sector8Offset + 0xE1] = newSector;
    result[sector8Offset + 0xE2] = newTrack;
    result[sector8Offset + 0xE4] = fileCount + 1;
    freeSectors -= bootInfo.sectorCount;
    result[sector8Offset + 0xE5] = freeSectors & 0xFF;
    result[sector8Offset + 0xE6] = (freeSectors >> 8) & 0xFF;
    if (wasEndMarker && dirSlot + 1 < 128) {
        const nextOffset = (dirSlot + 1) * 16;
        result[nextOffset] = 0x00;
    }
    return result;
}

export function getBootFileInfo(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    for (let i = 0; i < 128; i++) {
        const offset = i * 16;
        const firstByte = bytes[offset];
        if (firstByte === 0x00) break;
        if (firstByte === 0x01) continue;
        let filename = '';
        for (let j = 0; j < 8; j++) {
            filename += String.fromCharCode(bytes[offset + j]);
        }
        if (filename.trimEnd().toLowerCase() === 'boot') {
            return {
                dirSlot: i,
                sectorCount: bytes[offset + 13],
                firstSector: bytes[offset + 14],
                firstTrack: bytes[offset + 15]
            };
        }
    }
    return null;
}

export function replaceBootInPlace(trdData, bootInfo, existingBoot) {
    const result = new Uint8Array(trdData);
    const dirOffset = existingBoot.dirSlot * 16;
    const bootName = 'boot    ';
    for (let i = 0; i < 8; i++) {
        result[dirOffset + i] = bootName.charCodeAt(i);
    }
    result[dirOffset + 8] = bootInfo.fileType;
    result[dirOffset + 9] = bootInfo.startAddr & 0xFF;
    result[dirOffset + 10] = (bootInfo.startAddr >> 8) & 0xFF;
    result[dirOffset + 11] = bootInfo.length & 0xFF;
    result[dirOffset + 12] = (bootInfo.length >> 8) & 0xFF;
    result[dirOffset + 13] = bootInfo.sectorCount;
    result[dirOffset + 14] = existingBoot.firstSector;
    result[dirOffset + 15] = existingBoot.firstTrack;
    const trackOffset = existingBoot.firstTrack * 16 * 256;
    const sectorOffset = existingBoot.firstSector * 256;
    const dataOffset = trackOffset + sectorOffset;
    result.set(bootInfo.fileData.slice(0, bootInfo.sectorCount * 256), dataOffset);
    return result;
}

export function removeBootFromTrd(data) {
    const result = new Uint8Array(data);
    for (let i = 0; i < 128; i++) {
        const offset = i * 16;
        const firstByte = result[offset];
        if (firstByte === 0x00) break;
        if (firstByte === 0x01) continue;
        let filename = '';
        for (let j = 0; j < 8; j++) {
            filename += String.fromCharCode(result[offset + j]);
        }
        filename = filename.trimEnd().toLowerCase();
        if (filename === 'boot') {
            result[offset] = 0x01;
            const sector8Offset = 8 * 256;
            const fileCount = result[sector8Offset + 0xE4];
            if (fileCount > 0) {
                result[sector8Offset + 0xE4] = fileCount - 1;
            }
            break;
        }
    }
    return result;
}

export function processTrdWithBoot(data, filename, bootTrdData, bootFileType) {
    const mode = document.getElementById('bootTrdMode').value;
    if (mode === 'none' || !bootTrdData) {
        return data;
    }

    let bootInfo;
    if (bootFileType === 'hobeta') {
        bootInfo = extractBootFromHobeta(bootTrdData);
    } else {
        bootInfo = extractBootFile(bootTrdData);
    }
    if (!bootInfo) {
        alert('Cannot add boot: no boot file found in selected boot source');
        return data;
    }

    const existingBoot = getBootFileInfo(data);

    if (mode === 'add') {
        if (existingBoot) return data;
        return injectBootIntoTrd(data, bootInfo, null);
    }

    if (mode === 'replace') {
        if (existingBoot) {
            if (bootInfo.sectorCount <= existingBoot.sectorCount) {
                return replaceBootInPlace(data, bootInfo, existingBoot);
            } else {
                data = removeBootFromTrd(data);
                return injectBootIntoTrd(data, bootInfo, null);
            }
        } else {
            return injectBootIntoTrd(data, bootInfo, null);
        }
    }

    return data;
}

// ========== Base64 Helpers ==========

export function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ========== Boot TRD Settings ==========

export let bootTrdData = null;
export let bootTrdName = null;
export let bootFileType = null;

export function loadBootTrdSettings() {
    const mode = localStorage.getItem('bootTrdMode') || 'none';
    document.getElementById('bootTrdMode').value = mode;

    const name = localStorage.getItem('bootTrdName');
    const dataBase64 = localStorage.getItem('bootTrdData');
    const storedType = localStorage.getItem('bootFileType');
    if (name && dataBase64) {
        try {
            bootTrdData = base64ToArrayBuffer(dataBase64);
            bootTrdName = name;
            bootFileType = storedType || 'trd';
            const typeLabel = bootFileType === 'hobeta' ? '(Hobeta)' : '(TRD)';
            document.getElementById('bootTrdName').textContent = `${name} ${typeLabel}`;
        } catch (e) {
            console.warn('Failed to load boot file from localStorage:', e);
        }
    }
}

export function setBootTrdData(data, name, type) {
    bootTrdData = data;
    bootTrdName = name;
    bootFileType = type;
}

// ========== Export Base Name ==========

export function getExportBaseName() {
    const diskInfoLed = document.getElementById('diskInfoLed');
    const tapeLed = document.getElementById('tapeLed');
    const diskName = diskInfoLed ? diskInfoLed.title.trim() : '';
    const tapeName = tapeLed ? tapeLed.title.trim() : '';
    return diskName || tapeName || 'frame';
}
