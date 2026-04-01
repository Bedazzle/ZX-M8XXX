// media-catalog.js — Media catalog (tape/disk) display and controls (extracted from index.html)
import { hex16 } from '../core/utils.js';

// Tape block description constants
const TAPE_STD_PILOT_PULSE   = 2168;
const TAPE_TURBO_TOLERANCE   = 50;
const TAPE_STD_FLAG          = 0x00;
const TAPE_HDR_MIN_LENGTH    = 18;
const TAPE_HDR_TYPE_PROGRAM  = 0;
const TAPE_HDR_TYPE_NUM_ARR  = 1;
const TAPE_HDR_TYPE_CHR_ARR  = 2;
const TAPE_HDR_TYPE_BYTES    = 3;

// TRD disk catalog constants
const TRD_SECTOR_SIZE        = 256;
const TRD_SECTOR9_OFFSET     = 8 * TRD_SECTOR_SIZE;
const TRD_FREE_SECS_LO      = 0xE5;
const TRD_FREE_SECS_HI      = 0xE6;
const TRD_LABEL_OFFSET       = 0xF5;
const TRD_LABEL_LENGTH       = 8;
const TRD_MIN_IMAGE_SIZE     = 0x8E7;

export function initMediaCatalog({ getSpectrum, showMessage, updateDriveSelector, openInExplorer }) {
    const chkFlashLoad = document.getElementById('chkFlashLoad');
    const tapeLoadModeEl = document.getElementById('tapeLoadMode');
    const tapePositionEl = document.getElementById('tapePosition');
    const tapeProgressEl = document.getElementById('tapeProgress');
    const tapeCatalogEl = document.getElementById('tapeCatalog');
    const diskCatalogEl = document.getElementById('diskCatalog');
    const mediaCatalogContainer = document.getElementById('mediaCatalogContainer');
    const mediaCatalogTapeBtn = document.getElementById('mediaCatalogTapeBtn');
    const mediaCatalogDiskBtn = document.getElementById('mediaCatalogDiskBtn');

    // Track which drive + controller is displayed in the disk catalog
    let diskCatalogDrive = 0;
    let diskCatalogController = null;  // 'fdc'|'beta'|null

    function selectCatalogTab(which) {
        const isTape = which === 'tape';
        mediaCatalogTapeBtn.classList.toggle('active', isTape);
        mediaCatalogDiskBtn.classList.toggle('active', !isTape);
        tapeCatalogEl.style.display = isTape ? 'block' : 'none';
        diskCatalogEl.style.display = !isTape ? 'block' : 'none';
    }

    function updateCatalogTabs(activate) {
        const spectrum = getSpectrum();
        const hasTape = tapeCatalogEl.children.length > 0;
        const hasDisk = diskCatalogEl.children.length > 0 ||
            (spectrum.loadedBetaDiskFiles && spectrum.loadedBetaDiskFiles.some(f => f && f.length > 0)) ||
            (spectrum.loadedFDCDiskFiles && spectrum.loadedFDCDiskFiles.some(f => f && f.length > 0)) ||
            (spectrum.loadedPlusDDiskFiles && spectrum.loadedPlusDDiskFiles.some(f => f && f.length > 0)) ||
            (spectrum.loadedIF1CartridgeFiles && spectrum.loadedIF1CartridgeFiles.some(f => f && f.length > 0)) ||
            [0, 1, 2, 3].some(i => hasDiskInDrive(i));
        mediaCatalogTapeBtn.style.display = hasTape ? '' : 'none';
        mediaCatalogDiskBtn.style.display = hasDisk ? '' : 'none';
        if (!hasTape && !hasDisk) {
            mediaCatalogContainer.style.display = 'none';
            return;
        }
        mediaCatalogContainer.style.display = 'block';
        if (activate === 'tape' && hasTape) selectCatalogTab('tape');
        else if (activate === 'disk' && hasDisk) selectCatalogTab('disk');
        else if (hasTape && !hasDisk) selectCatalogTab('tape');
        else if (hasDisk && !hasTape) selectCatalogTab('disk');
    }

    mediaCatalogTapeBtn.addEventListener('click', () => selectCatalogTab('tape'));
    mediaCatalogDiskBtn.addEventListener('click', () => selectCatalogTab('disk'));

    // Drive sub-tab click handlers
    document.getElementById('diskDriveTabs').addEventListener('click', (e) => {
        const btn = e.target.closest('.drive-tab');
        if (!btn) return;
        const drv = parseInt(btn.dataset.drive, 10);
        const ctrl = btn.dataset.controller || null;
        buildDiskCatalog(drv, ctrl);
    });

    function describeTapeBlock(block, index) {
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

    function buildTapeCatalog() {
        const spectrum = getSpectrum();
        const blocks = spectrum.tapePlayer.blocks;
        tapeCatalogEl.innerHTML = '';
        if (!blocks || blocks.length === 0) {
            updateCatalogTabs(null);
            return;
        }
        for (let i = 0; i < blocks.length; i++) {
            const row = document.createElement('div');
            row.className = 'tape-catalog-row';
            row.dataset.index = i;
            row.textContent = describeTapeBlock(blocks[i], i);
            row.style.cssText = 'padding: 1px 6px; cursor: pointer; white-space: nowrap;';
            row.addEventListener('click', () => {
                getSpectrum().tapePlayer.setBlock(i);
                updateTapePosition();
                updateTapeCatalogHighlight();
            });
            if (openInExplorer) {
                row.addEventListener('dblclick', () => {
                    const tape = getSpectrum().loadedTape;
                    if (tape && tape.data) {
                        openInExplorer(tape.data, tape.name || ('tape.' + (tape.type || 'tap')));
                    }
                });
                row.title = 'Click: jump to block. Double-click: open in Explorer';
            }
            tapeCatalogEl.appendChild(row);
        }
        updateTapeCatalogHighlight();
        updateCatalogTabs('tape');
    }

    function updateTapeCatalogHighlight() {
        const spectrum = getSpectrum();
        const rows = tapeCatalogEl.children;
        const current = spectrum.tapePlayer.currentBlock;
        for (let i = 0; i < rows.length; i++) {
            if (i === current) {
                rows[i].style.background = 'var(--accent)';
                rows[i].style.color = 'var(--bg-primary)';
            } else if (i < current) {
                rows[i].style.background = '';
                rows[i].style.color = 'var(--text-dim)';
            } else {
                rows[i].style.background = '';
                rows[i].style.color = 'var(--text-primary)';
            }
        }
    }

    function hasDiskInDrive(driveIndex) {
        const spectrum = getSpectrum();
        const hasFDC = driveIndex < 2 && spectrum.loadedFDCDisks[driveIndex];
        const hasBeta = driveIndex < 4 && spectrum.loadedBetaDisks[driveIndex];
        const hasPlusD = driveIndex < 2 && spectrum.loadedPlusDDisks && spectrum.loadedPlusDDisks[driveIndex];
        const hasIF1 = driveIndex < 8 && spectrum.loadedIF1Cartridges && spectrum.loadedIF1Cartridges[driveIndex];
        return !!(hasFDC || hasBeta || hasPlusD || hasIF1);
    }

    // MGT file type names for catalog display
    const MGT_TYPE_NAMES = { 0: 'Erased', 1: 'BASIC', 2: 'NumArr', 3: 'StrArr', 4: 'CODE', 5: '48K Snap', 7: 'SCREEN$', 9: '128K Snap', 10: 'Open', 11: 'Execute' };

    // MDR (Interface 1 Microdrive) file type names for catalog display
    const MDR_TYPE_NAMES = { 'File': 'File', 'PRINT': 'PRINT' };

    function buildDiskCatalogSection(driveIndex, isDSK, media, files, isMGT) {
        const driveLetter = String.fromCharCode(65 + driveIndex);
        const hasFiles = files && files.length > 0;

        // Header row with disk info
        const header = document.createElement('div');
        header.style.cssText = 'padding: 1px 6px; white-space: nowrap; color: var(--cyan); border-bottom: 1px solid var(--bg-secondary); margin-bottom: 2px;';
        let headerText = '';
        if (isMGT) {
            headerText = '\u{1F4BE} ' + driveLetter + ': ' + ((media && media.name) || 'MGT');
            if (hasFiles) headerText += ' \u2014 ' + files.length + ' files';
        } else if (isDSK) {
            if (hasFiles) {
                headerText = '\u{1F4BE} ' + driveLetter + ': ' + ((media && media.name) || 'DSK') + ' \u2014 ' + files.length + ' files';
            } else {
                headerText = '\u{1F4BE} ' + driveLetter + ': ' + ((media && media.name) || 'DSK');
            }
        } else if (media && media.data && media.data.length > TRD_MIN_IMAGE_SIZE) {
            const d = media.data;
            const freeSectors = d[TRD_SECTOR9_OFFSET + TRD_FREE_SECS_LO] | (d[TRD_SECTOR9_OFFSET + TRD_FREE_SECS_HI] << 8);
            const freeKB = Math.floor(freeSectors * TRD_SECTOR_SIZE / 1024);
            let label = '';
            for (let i = 0; i < TRD_LABEL_LENGTH; i++) {
                const ch = d[TRD_SECTOR9_OFFSET + TRD_LABEL_OFFSET + i];
                if (ch >= 0x20 && ch < 0x80) label += String.fromCharCode(ch);
            }
            label = label.trim();
            headerText = '\u{1F4BE} ' + driveLetter + ': ' + ((media && media.name) || 'TRD');
            if (label) headerText += ' [' + label + ']';
            headerText += ' \u2014 ' + (hasFiles ? files.length + ' files, ' : '') + freeKB + 'K free';
        } else {
            headerText = '\u{1F4BE} ' + driveLetter + ': ' + ((media && media.name) || 'Disk');
            if (hasFiles) headerText += ' \u2014 ' + files.length + ' files';
        }
        header.textContent = headerText;
        diskCatalogEl.appendChild(header);

        // File rows
        if (hasFiles) {
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const row = document.createElement('div');
                row.style.cssText = 'padding: 1px 6px; white-space: nowrap;';
                const num = String(i + 1).padStart(2, ' ');
                const name = isMGT ? f.name.padEnd(10, ' ') : f.name.padEnd(8, ' ');
                if (isMGT) {
                    const typeName = (MGT_TYPE_NAMES[f.type] || '?').padEnd(7, ' ');
                    const size = String(f.length).padStart(5, ' ');
                    const startHex = f.startAddress !== undefined ? hex16(f.startAddress) : '    ';
                    row.textContent = num + '  ' + name + '  ' + typeName + ' ' + startHex + 'h ' + size + 'b';
                } else if (isDSK) {
                    const ext = (f.ext || '').padEnd(3, ' ');
                    const size = String(f.size).padStart(6, ' ');
                    row.textContent = num + '  ' + name + '.' + ext + '  ' + size + 'b';
                } else {
                    const startHex = hex16(f.start);
                    const size = String(f.length).padStart(5, ' ');
                    const secs = String(f.sectors).padStart(3, ' ');
                    row.textContent = num + '  ' + name + '.' + f.ext + '  ' + startHex + 'h ' + size + 'b ' + secs + 's';
                    const isBoot = f.name.trim().toLowerCase() === 'boot';
                    if (isBoot) {
                        row.style.color = 'var(--cyan)';
                        row.title = 'Boot file (auto-run on TR-DOS startup)';
                    }
                }
                if (openInExplorer && media && media.data) {
                    row.style.cursor = 'pointer';
                    row.addEventListener('dblclick', () => {
                        const ext = isMGT ? 'mgt' : isDSK ? 'dsk' : 'trd';
                        openInExplorer(media.data, media.name || ('disk.' + ext));
                    });
                    if (!row.title) row.title = 'Double-click: open in Explorer';
                }
                diskCatalogEl.appendChild(row);
            }
        }
    }

    function buildIF1CatalogSection(driveIndex, media, files) {
        const driveNum = driveIndex + 1;  // Microdrives are 1-based
        const hasFiles = files && files.length > 0;

        // Header row with cartridge info
        const header = document.createElement('div');
        header.style.cssText = 'padding: 1px 6px; white-space: nowrap; color: var(--cyan); border-bottom: 1px solid var(--bg-secondary); margin-bottom: 2px;';
        let headerText = '\u{1F4BE} MDR ' + driveNum + ': ' + ((media && media.name) || 'Cartridge');
        if (hasFiles) headerText += ' \u2014 ' + files.length + ' files';
        if (media && media.usedSectors !== undefined && media.totalSectors !== undefined) {
            headerText += ', ' + media.usedSectors + '/' + media.totalSectors + ' sectors';
        }
        header.textContent = headerText;
        diskCatalogEl.appendChild(header);

        // File rows
        if (hasFiles) {
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const row = document.createElement('div');
                row.style.cssText = 'padding: 1px 6px; white-space: nowrap;';
                const num = String(i + 1).padStart(2, ' ');
                const name = (f.name || '').padEnd(10, ' ');
                const typeName = (MDR_TYPE_NAMES[f.type] || f.type || '?').padEnd(5, ' ');
                const length = String(f.length || 0).padStart(5, ' ');
                const secs = String(f.sectors || 0).padStart(3, ' ');
                row.textContent = num + '  ' + name + '  ' + typeName + ' ' + length + 'b ' + secs + 's';
                if (openInExplorer && media && media.data) {
                    row.style.cursor = 'pointer';
                    row.addEventListener('dblclick', () => {
                        openInExplorer(media.data, media.name || 'cartridge.mdr');
                    });
                    row.title = 'Double-click: open in Explorer';
                }
                diskCatalogEl.appendChild(row);
            }
        }
    }

    function buildDiskCatalog(driveIndex, controller) {
        const spectrum = getSpectrum();
        if (driveIndex === undefined) driveIndex = diskCatalogDrive;
        if (controller === undefined) controller = diskCatalogController;
        diskCatalogDrive = driveIndex;
        diskCatalogController = controller;
        diskCatalogEl.innerHTML = '';

        const showFdc = (!controller || controller === 'fdc') && driveIndex < 2;
        const showBeta = (!controller || controller === 'beta') && driveIndex < 4;
        const showPlusD = (!controller || controller === 'plusd') && driveIndex < 2;
        const showIF1 = (!controller || controller === 'if1') && driveIndex < 8;
        const fdcMedia = showFdc ? spectrum.loadedFDCDisks[driveIndex] : null;
        const betaMedia = showBeta ? spectrum.loadedBetaDisks[driveIndex] : null;
        const plusDMedia = showPlusD && spectrum.loadedPlusDDisks ? spectrum.loadedPlusDDisks[driveIndex] : null;
        const if1Media = showIF1 && spectrum.loadedIF1Cartridges ? spectrum.loadedIF1Cartridges[driveIndex] : null;
        const fdcFiles = showFdc ? spectrum.loadedFDCDiskFiles[driveIndex] : null;
        const betaFiles = showBeta ? spectrum.loadedBetaDiskFiles[driveIndex] : null;
        const plusDFiles = showPlusD && spectrum.loadedPlusDDiskFiles ? spectrum.loadedPlusDDiskFiles[driveIndex] : null;
        const if1Files = showIF1 && spectrum.loadedIF1CartridgeFiles ? spectrum.loadedIF1CartridgeFiles[driveIndex] : null;
        const hasFdcContent = fdcMedia || (fdcFiles && fdcFiles.length > 0);
        const hasBetaContent = betaMedia || (betaFiles && betaFiles.length > 0);
        const hasPlusDContent = plusDMedia || (plusDFiles && plusDFiles.length > 0);
        const hasIF1Content = if1Media || (if1Files && if1Files.length > 0);

        if (!hasFdcContent && !hasBetaContent && !hasPlusDContent && !hasIF1Content) {
            let anyDisk = false;
            for (let i = 0; i < 4; i++) {
                if (hasDiskInDrive(i)) { anyDisk = true; break; }
            }
            updateDiskDriveTabs();
            updateCatalogTabs(anyDisk ? 'disk' : null);
            return;
        }

        if (hasFdcContent) {
            buildDiskCatalogSection(driveIndex, true, fdcMedia, fdcFiles, false);
        }
        if (hasBetaContent) {
            buildDiskCatalogSection(driveIndex, false, betaMedia, betaFiles, false);
        }
        if (hasPlusDContent) {
            buildDiskCatalogSection(driveIndex, false, plusDMedia, plusDFiles, true);
        }
        if (hasIF1Content) {
            buildIF1CatalogSection(driveIndex, if1Media, if1Files);
        }

        updateDiskDriveTabs();
        updateCatalogTabs('disk');
    }

    function clearDiskCatalog(driveIndex) {
        const spectrum = getSpectrum();
        if (driveIndex !== undefined) {
            if (driveIndex < 4) spectrum.loadedBetaDiskFiles[driveIndex] = null;
            if (driveIndex < 2) spectrum.loadedFDCDiskFiles[driveIndex] = null;
            if (driveIndex < 2 && spectrum.loadedPlusDDiskFiles) spectrum.loadedPlusDDiskFiles[driveIndex] = null;
            if (driveIndex < 8 && spectrum.loadedIF1CartridgeFiles) spectrum.loadedIF1CartridgeFiles[driveIndex] = null;
            if (diskCatalogDrive === driveIndex) {
                diskCatalogEl.innerHTML = '';
            }
        } else {
            diskCatalogEl.innerHTML = '';
        }
        updateDiskDriveTabs();
        const maxDrives = 4;
        let anyDisk = false;
        for (let i = 0; i < maxDrives; i++) {
            if (hasDiskInDrive(i)) { anyDisk = true; break; }
        }
        if (!anyDisk) {
            updateCatalogTabs(null);
        }
    }

    function updateDiskDriveTabs() {
        const spectrum = getSpectrum();
        const tabsEl = document.getElementById('diskDriveTabs');
        const fdcDrives = [];
        const betaDrives = [];
        const plusDDrives = [];
        for (let i = 0; i < 2; i++) {
            if (spectrum.loadedFDCDisks[i] || (spectrum.loadedFDCDiskFiles[i] && spectrum.loadedFDCDiskFiles[i].length > 0)) {
                fdcDrives.push(i);
            }
        }
        for (let i = 0; i < 4; i++) {
            if (spectrum.loadedBetaDisks[i] || (spectrum.loadedBetaDiskFiles[i] && spectrum.loadedBetaDiskFiles[i].length > 0)) {
                betaDrives.push(i);
            }
        }
        for (let i = 0; i < 2; i++) {
            if ((spectrum.loadedPlusDDisks && spectrum.loadedPlusDDisks[i]) ||
                (spectrum.loadedPlusDDiskFiles && spectrum.loadedPlusDDiskFiles[i] && spectrum.loadedPlusDDiskFiles[i].length > 0)) {
                plusDDrives.push(i);
            }
        }
        const if1Drives = [];
        for (let i = 0; i < 8; i++) {
            if ((spectrum.loadedIF1Cartridges && spectrum.loadedIF1Cartridges[i]) ||
                (spectrum.loadedIF1CartridgeFiles && spectrum.loadedIF1CartridgeFiles[i] && spectrum.loadedIF1CartridgeFiles[i].length > 0)) {
                if1Drives.push(i);
            }
        }
        const activeControllers = (fdcDrives.length > 0 ? 1 : 0) + (betaDrives.length > 0 ? 1 : 0) + (plusDDrives.length > 0 ? 1 : 0) + (if1Drives.length > 0 ? 1 : 0);
        const multiController = activeControllers > 1;

        const tabs = [];
        if (fdcDrives.length > 0) {
            for (const drv of fdcDrives) {
                const letter = String.fromCharCode(65 + drv);
                tabs.push({ drive: drv, controller: 'fdc', label: multiController ? '3DOS:' + letter : letter + ':' });
            }
        }
        if (betaDrives.length > 0) {
            for (const drv of betaDrives) {
                const letter = String.fromCharCode(65 + drv);
                tabs.push({ drive: drv, controller: 'beta', label: multiController ? 'TRD:' + letter : letter + ':' });
            }
        }
        if (plusDDrives.length > 0) {
            for (const drv of plusDDrives) {
                const letter = String.fromCharCode(65 + drv);
                tabs.push({ drive: drv, controller: 'plusd', label: multiController ? 'MGT:' + letter : letter + ':' });
            }
        }
        if (if1Drives.length > 0) {
            for (const drv of if1Drives) {
                const num = drv + 1;  // Microdrives are 1-based
                tabs.push({ drive: drv, controller: 'if1', label: multiController ? 'MDR:' + num : num + ':' });
            }
        }
        tabsEl.innerHTML = '';
        for (const tab of tabs) {
            const btn = document.createElement('button');
            btn.className = 'media-catalog-btn drive-tab';
            btn.style.cssText = 'min-width: 24px; padding: 1px 4px;';
            btn.dataset.drive = tab.drive;
            btn.dataset.controller = tab.controller;
            btn.textContent = tab.label;
            btn.classList.toggle('active', tab.drive === diskCatalogDrive && tab.controller === diskCatalogController);
            tabsEl.appendChild(btn);
        }
        tabsEl.style.display = tabs.length > 0 ? 'inline' : 'none';

        const drvSelEl = document.getElementById('driveSelector');
        const hasBetaDisk = spectrum.betaDisk && spectrum.betaDisk.hasAnyDisk();
        const hasFDCDisk = spectrum.fdc && spectrum.fdc.hasDisk();
        const hasPlusDDisk = spectrum.plusD && spectrum.plusD.hasAnyDisk();
        drvSelEl.style.display = (hasBetaDisk || hasFDCDisk || hasPlusDDisk) ? '' : 'none';
        if (drvSelEl.style.display !== 'none') updateDriveSelector();
    }

    function updateTapePosition() {
        const spectrum = getSpectrum();
        const pos = spectrum.getTapePosition();
        if (pos.totalBlocks > 0) {
            const status = pos.playing ? (pos.phase === 'pilot' ? 'PILOT' : pos.phase === 'data' ? 'DATA' : pos.phase.toUpperCase()) : 'STOPPED';
            tapePositionEl.textContent = `Block ${pos.block + 1}/${pos.totalBlocks} ${status}`;
            if (tapeProgressEl) {
                if (pos.playing && pos.phase === 'data') {
                    tapeProgressEl.textContent = `${pos.blockProgress}%`;
                } else if (pos.playing) {
                    tapeProgressEl.textContent = 'SYNC';
                } else {
                    tapeProgressEl.textContent = '';
                }
            }
        } else {
            tapePositionEl.textContent = '';
            if (tapeProgressEl) {
                tapeProgressEl.textContent = '';
            }
        }
        updateTapeCatalogHighlight();
    }

    // Set up TapePlayer callbacks
    getSpectrum().tapePlayer.onBlockStart = (blockIndex, block) => {
        const type = block.flag === 0x00 ? 'Header' : 'Data';
        showMessage(`Loading block ${blockIndex + 1}: ${type}`);
        updateTapePosition();
    };
    getSpectrum().tapePlayer.onBlockEnd = (blockIndex) => {
        updateTapePosition();
        const sp = getSpectrum();
        const tapeTrigger = sp.checkTapeBlockTrigger(blockIndex);
        if (tapeTrigger) {
            sp.tapeBlockHit = true;
            sp.triggerHit = true;
            sp.lastTrigger = { trigger: tapeTrigger, blockIndex, type: 'tape_block' };
        }
    };
    getSpectrum().tapePlayer.onTapeEnd = () => {
        showMessage('Tape finished');
        updateTapePosition();
    };

    // Flash load toggle
    chkFlashLoad.addEventListener('change', () => {
        const spectrum = getSpectrum();
        const flash = chkFlashLoad.checked;
        spectrum.setTapeFlashLoad(flash);
        tapeLoadModeEl.textContent = flash ? '(instant)' : '(real-time)';
        if (flash) {
            spectrum.stopTape();
        }
        updateTapePosition();
    });

    // Initialize flash load state from checkbox on page load
    getSpectrum().setTapeFlashLoad(chkFlashLoad.checked);
    tapeLoadModeEl.textContent = chkFlashLoad.checked ? '(instant)' : '(real-time)';

    // Tape audio toggle
    const chkTapeAudio = document.getElementById('chkTapeAudio');
    chkTapeAudio.addEventListener('change', () => {
        const sp = getSpectrum();
        sp.tapeAudioEnabled = chkTapeAudio.checked;
    });

    // Tape transport buttons
    document.getElementById('btnTapePlay').addEventListener('click', () => {
        const spectrum = getSpectrum();
        if (spectrum.getTapeFlashLoad()) {
            showMessage('Switch to real-time mode to use Play', 'warning');
            return;
        }
        if (spectrum.playTape()) {
            showMessage('Tape playing - type LOAD "" and press Enter');
            updateTapePosition();
        } else {
            showMessage('No tape loaded', 'error');
        }
    });

    document.getElementById('btnTapeStop').addEventListener('click', () => {
        const spectrum = getSpectrum();
        spectrum.stopTape();
        showMessage('Tape stopped');
        updateTapePosition();
    });

    document.getElementById('btnTapeRewind').addEventListener('click', () => {
        const spectrum = getSpectrum();
        spectrum.rewindTape();
        showMessage('Tape rewound to beginning');
        updateTapePosition();
    });

    // Update tape position periodically when playing
    const tapePositionInterval = setInterval(() => {
        const spectrum = getSpectrum();
        if (spectrum.isTapePlaying()) {
            updateTapePosition();
        }
    }, 200);

    return {
        buildTapeCatalog,
        buildDiskCatalog,
        clearDiskCatalog,
        updateTapePosition,
        updateCatalogTabs,
        hasDiskInDrive,
        updateDiskDriveTabs,
        destroy() { clearInterval(tapePositionInterval); }
    };
}
