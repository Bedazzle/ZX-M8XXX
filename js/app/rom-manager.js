// ROM Manager — ROM loading, machine dropdown, ROM modal handlers
// Extracted from index.html lines ~14000-14308 and ~27801-28176

import { MACHINE_PROFILES, DEFAULT_VISIBLE_MACHINES, getMachineProfile, getMachineTypes } from '../core/machines.js';
import { updateULAplusStatus } from './display-sound.js';

// updateBetaDiskStatus is set via setRomManagerDeps to avoid circular dependency with media-io.js
let _updateBetaDiskStatus = null;
export function setRomManagerDeps(deps) {
    if (deps.updateBetaDiskStatus) _updateBetaDiskStatus = deps.updateBetaDiskStatus;
}

// ROM storage — keyed by ROM filename (shared across machines using same ROM)
export const romData = {};    // { 'filename': ArrayBuffer, ... }

// Legacy accessors for backward compatibility within ROM dialog handlers
// These are getters/setters that map to romData entries
export function getRomByType(type) {
    const fileMap = { '48k': '48.rom', '128k': '128.rom', 'plus2': 'plus2.rom', 'plus2a': 'plus2a.rom', 'plus3': 'plus3.rom', 'pentagon': 'pentagon.rom', 'scorpion': 'scorpion.rom', 'trdos': 'trdos.rom' };
    return romData[fileMap[type]] || null;
}

export function setRomByType(type, data) {
    const fileMap = { '48k': '48.rom', '128k': '128.rom', 'plus2': 'plus2.rom', 'plus2a': 'plus2a.rom', 'plus3': 'plus3.rom', 'pentagon': 'pentagon.rom', 'scorpion': 'scorpion.rom', 'trdos': 'trdos.rom' };
    if (fileMap[type]) romData[fileMap[type]] = data;
}

// Try to auto-load ROMs from roms/ directory
export async function tryLoadRomsFromDirectory(labelManager, updateRomStatusFn, initializeEmulatorFn) {
    // Build unique ROM file list from machine profiles + trdos
    const romPaths = [];
    const seen = new Set();
    for (const p of Object.values(MACHINE_PROFILES)) {
        if (!seen.has(p.romFile)) {
            seen.add(p.romFile);
            romPaths.push({ path: 'roms/' + p.romFile, file: p.romFile });
        }
    }
    // TR-DOS ROM (shared across all machines)
    if (!seen.has('trdos.rom')) {
        romPaths.push({ path: 'roms/trdos.rom', file: 'trdos.rom' });
    }

    for (const rom of romPaths) {
        try {
            const response = await fetch(rom.path);
            if (response.ok) {
                romData[rom.file] = await response.arrayBuffer();
                console.log(`Loaded ${rom.path}`);
            }
        } catch (e) {
            // ROM not found, continue
        }
    }

    // Try to load ROM labels
    await tryLoadRomLabels(labelManager);

    updateRomStatusFn();

    if (romData['48.rom']) {
        // ROMs found, initialize directly
        initializeEmulatorFn();
    } else {
        // No 48K ROM, show dialog
        const romModal = document.getElementById('romModal');
        romModal.classList.remove('hidden');
    }
}

// Try to load ROM labels from labels/ directory
export async function tryLoadRomLabels(labelManager) {
    const labelPaths = [
        'labels/48k.json',
        'labels/rom48.json',
        'labels/spectrum48.json'
    ];

    for (const path of labelPaths) {
        try {
            const response = await fetch(path);
            if (response.ok) {
                const jsonStr = await response.text();
                const count = labelManager.loadRomLabels(jsonStr);
                if (count > 0) {
                    console.log(`Loaded ${count} ROM labels from ${path}`);
                    return;
                }
            }
        } catch (e) {
            // Labels file not found, continue
        }
    }
}

// ========== Machine Dropdown & Settings ==========

export function getVisibleMachines() {
    try {
        const stored = localStorage.getItem('zx-visible-machines');
        if (stored) {
            const arr = JSON.parse(stored);
            // Ensure 48k is always included
            if (!arr.includes('48k')) arr.unshift('48k');
            return arr;
        }
    } catch (e) {}
    return DEFAULT_VISIBLE_MACHINES.slice();
}

export function setVisibleMachines(arr) {
    localStorage.setItem('zx-visible-machines', JSON.stringify(arr));
}

export function populateMachineDropdown(machineSelect) {
    const visible = getVisibleMachines();
    visible.sort((a, b) => (MACHINE_PROFILES[a]?.name || a).localeCompare(MACHINE_PROFILES[b]?.name || b));
    const currentValue = machineSelect.value;
    machineSelect.innerHTML = '';
    for (const id of visible) {
        const p = MACHINE_PROFILES[id];
        if (p) {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = p.name;
            machineSelect.appendChild(opt);
        }
    }
    // Restore selection if still visible, otherwise select first
    if (visible.includes(currentValue)) {
        machineSelect.value = currentValue;
    }
}

export function buildMachineCheckboxes(machineSelect) {
    const container = document.getElementById('machineCheckboxes');
    if (!container) return;
    container.innerHTML = '';
    const visible = getVisibleMachines();

    // Group machines by group
    const groups = {};
    for (const [id, p] of Object.entries(MACHINE_PROFILES)) {
        (groups[p.group] ||= []).push(p);
    }

    for (const [group, machines] of Object.entries(groups)) {
        const groupDiv = document.createElement('div');
        groupDiv.style.cssText = 'margin-bottom: 8px;';
        const groupLabel = document.createElement('div');
        groupLabel.style.cssText = 'color: var(--text-secondary); font-size: 11px; margin-bottom: 4px; font-weight: bold;';
        groupLabel.textContent = group;
        groupDiv.appendChild(groupLabel);

        for (const p of machines) {
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            label.style.cssText = 'display: block; margin-left: 8px; margin-bottom: 2px;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = visible.includes(p.id);
            cb.dataset.machineId = p.id;
            // 48K always visible (cannot uncheck)
            if (p.id === '48k') {
                cb.disabled = true;
                cb.checked = true;
            }
            cb.addEventListener('change', () => {
                const current = getVisibleMachines();
                if (cb.checked) {
                    if (!current.includes(p.id)) {
                        // Insert in profile order
                        const allIds = getMachineTypes();
                        const idx = allIds.indexOf(p.id);
                        let insertAt = current.length;
                        for (let i = 0; i < current.length; i++) {
                            if (allIds.indexOf(current[i]) > idx) {
                                insertAt = i;
                                break;
                            }
                        }
                        current.splice(insertAt, 0, p.id);
                    }
                } else {
                    const idx = current.indexOf(p.id);
                    if (idx > -1) current.splice(idx, 1);
                }
                setVisibleMachines(current);
                populateMachineDropdown(machineSelect);
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(' ' + p.name));
            groupDiv.appendChild(label);
        }
        container.appendChild(groupDiv);
    }
}

// Disk activity indicator callback setup
export function setupDiskActivityCallback(spectrum) {
    const diskActivityEl = document.getElementById('diskActivity');
    const diskLedEl = document.getElementById('diskLed');
    const diskStatusEl = document.getElementById('diskStatus');
    let diskActivityTimeout = null;

    const activityHandler = (type, track, sector, side, driveNum) => {
        // Show disk activity indicator
        diskActivityEl.style.display = 'inline-block';

        // Update LED color based on operation
        if (type === 'read') {
            diskLedEl.style.color = '#0f0';  // Green for read
            diskLedEl.title = 'Reading from disk';
        } else if (type === 'write') {
            diskLedEl.style.color = '#f80';  // Orange for write
            diskLedEl.title = 'Writing to disk';
        }

        // Show drive letter + track/sector info (padded to fixed width)
        const driveLetter = String.fromCharCode(65 + (driveNum || 0));
        const sideStr = side ? 'B' : 'A';
        const trackStr = String(track).padStart(2, '0');
        const sectorStr = String(sector).padStart(2, '0');
        diskStatusEl.textContent = `${driveLetter}:T${trackStr}:S${sectorStr}:${sideStr}`;

        // Clear timeout and set new one to show idle state
        if (diskActivityTimeout) clearTimeout(diskActivityTimeout);
        diskActivityTimeout = setTimeout(() => {
            diskLedEl.style.color = '';  // Reset color
            diskLedEl.title = 'Disk idle';
            diskStatusEl.textContent = 'idle';
        }, 200);
    };

    if (spectrum.betaDisk) {
        spectrum.betaDisk.onDiskActivity = activityHandler;
    }
    if (spectrum.fdc) {
        spectrum.fdc.onDiskActivity = activityHandler;
    }
}

// ========== ROM Status & Validation ==========

export function updateRomStatus() {
    const status48Rom = document.getElementById('status48Rom');
    const status128Rom = document.getElementById('status128Rom');
    const statusPlus2Rom = document.getElementById('statusPlus2Rom');
    const statusPlus2aRom = document.getElementById('statusPlus2aRom');
    const statusPlus3Rom = document.getElementById('statusPlus3Rom');
    const statusPentagonRom = document.getElementById('statusPentagonRom');
    const statusScorpionRom = document.getElementById('statusScorpionRom');
    const statusTrdosRom = document.getElementById('statusTrdosRom');
    const btnStartEmulator = document.getElementById('btnStartEmulator');

    // Clear any inline error color from size validation
    [status48Rom, status128Rom, statusPlus2Rom, statusPlus2aRom, statusPlus3Rom, statusPentagonRom, statusScorpionRom, statusTrdosRom].forEach(el => { if (el) el.style.color = ''; });

    if (romData['48.rom']) {
        status48Rom.textContent = '\u2713 Loaded (' + (romData['48.rom'].byteLength / 1024) + 'KB)';
        status48Rom.classList.add('loaded');
    } else {
        status48Rom.textContent = 'Not loaded';
        status48Rom.classList.remove('loaded');
    }

    if (romData['128.rom']) {
        status128Rom.textContent = '\u2713 Loaded (' + (romData['128.rom'].byteLength / 1024) + 'KB)';
        status128Rom.classList.add('loaded');
    } else {
        status128Rom.textContent = 'Not loaded (128K mode unavailable)';
        status128Rom.classList.remove('loaded');
    }

    if (romData['plus2.rom']) {
        statusPlus2Rom.textContent = '\u2713 Loaded (' + (romData['plus2.rom'].byteLength / 1024) + 'KB)';
        statusPlus2Rom.classList.add('loaded');
    } else {
        statusPlus2Rom.textContent = 'Not loaded (+2 mode unavailable)';
        statusPlus2Rom.classList.remove('loaded');
    }

    if (romData['plus2a.rom']) {
        // Check if ROM bank 0 contains +2A/+3 menu by looking for "Loader" string
        const bank0 = new Uint8Array(romData['plus2a.rom'].slice(0, 16384));
        const romStr = String.fromCharCode(...bank0.slice(0, 16384));
        const hasMenu = romStr.indexOf('Loader') !== -1 || romStr.indexOf('+3') !== -1;
        if (hasMenu) {
            statusPlus2aRom.textContent = '\u2713 Loaded (' + (romData['plus2a.rom'].byteLength / 1024) + 'KB)';
            statusPlus2aRom.classList.add('loaded');
        } else {
            statusPlus2aRom.textContent = '\u26A0 Loaded but may be wrong ROM (no +2A menu in bank 0)';
            statusPlus2aRom.classList.add('loaded');
            statusPlus2aRom.style.color = '#e67e22';
        }
    } else {
        statusPlus2aRom.textContent = 'Not loaded (+2A mode unavailable)';
        statusPlus2aRom.classList.remove('loaded');
    }

    if (statusPlus3Rom) {
        if (romData['plus3.rom']) {
            const bank0 = new Uint8Array(romData['plus3.rom'].slice(0, 16384));
            const romStr = String.fromCharCode(...bank0.slice(0, 16384));
            const hasMenu = romStr.indexOf('Loader') !== -1 || romStr.indexOf('+3') !== -1;
            if (hasMenu) {
                statusPlus3Rom.textContent = '\u2713 Loaded (' + (romData['plus3.rom'].byteLength / 1024) + 'KB)';
                statusPlus3Rom.classList.add('loaded');
            } else {
                statusPlus3Rom.textContent = '\u26A0 Loaded but may be wrong ROM (no +3 menu in bank 0)';
                statusPlus3Rom.classList.add('loaded');
                statusPlus3Rom.style.color = '#e67e22';
            }
        } else {
            statusPlus3Rom.textContent = 'Not loaded (+3 mode unavailable)';
            statusPlus3Rom.classList.remove('loaded');
        }
    }

    if (romData['pentagon.rom']) {
        statusPentagonRom.textContent = '\u2713 Loaded (' + (romData['pentagon.rom'].byteLength / 1024) + 'KB)';
        statusPentagonRom.classList.add('loaded');
    } else {
        statusPentagonRom.textContent = 'Not loaded (Pentagon mode unavailable)';
        statusPentagonRom.classList.remove('loaded');
    }

    if (statusScorpionRom) {
        if (romData['scorpion.rom']) {
            statusScorpionRom.textContent = '\u2713 Loaded (' + (romData['scorpion.rom'].byteLength / 1024) + 'KB)';
            statusScorpionRom.classList.add('loaded');
        } else {
            statusScorpionRom.textContent = 'Not loaded (Scorpion mode unavailable)';
            statusScorpionRom.classList.remove('loaded');
        }
    }

    if (statusTrdosRom) {
        if (romData['trdos.rom']) {
            statusTrdosRom.textContent = '\u2713 Loaded (' + (romData['trdos.rom'].byteLength / 1024) + 'KB)';
            statusTrdosRom.classList.add('loaded');
        } else {
            statusTrdosRom.textContent = 'Not loaded (required for TRD/SCL disk images)';
            statusTrdosRom.classList.remove('loaded');
        }
    }

    btnStartEmulator.disabled = !romData['48.rom'];
}

export const ROM_EXPECTED_SIZES = {
    '48k': [16384], 'trdos': [16384],
    '128k': [32768], 'plus2': [32768], 'pentagon': [32768],
    'plus2a': [65536], 'plus3': [65536], 'scorpion': [65536]
};

export const ROM_STATUS_IDS = {
    '48k': 'status48Rom', '128k': 'status128Rom', 'plus2': 'statusPlus2Rom',
    'plus2a': 'statusPlus2aRom', 'plus3': 'statusPlus3Rom', 'pentagon': 'statusPentagonRom', 'scorpion': 'statusScorpionRom', 'trdos': 'statusTrdosRom'
};

export async function loadRomFile(data, type, showMessage) {
    const romModal = document.getElementById('romModal');
    const expected = ROM_EXPECTED_SIZES[type];
    if (expected && !expected.includes(data.byteLength)) {
        const msg = 'Wrong size: expected ' + (expected[0] / 1024) + 'KB, got ' + (data.byteLength / 1024) + 'KB';
        const statusEl = document.getElementById(ROM_STATUS_IDS[type]);
        if (statusEl && !romModal.classList.contains('hidden')) {
            statusEl.textContent = msg;
            statusEl.classList.remove('loaded');
            statusEl.style.color = 'var(--error, #e74c3c)';
        } else {
            showMessage(type + ' ROM: ' + msg, 'error');
        }
        return;
    }
    setRomByType(type, data);
    updateRomStatus();
}

// Profile-driven ROM loader — works for any machine type
// Can operate on any spectrum instance (used by test runner too)
export function loadRomsForMachineType(spec, machineType) {
    const profile = getMachineProfile(machineType);
    const rom = romData[profile.romFile];
    if (!rom) return false;
    for (let bank = 0; bank < profile.romBanks; bank++) {
        spec.memory.loadRom(rom.slice(bank * 16384, (bank + 1) * 16384), bank);
    }
    // Load TR-DOS ROM if available (for Beta Disk interface)
    // Skip for machines with TR-DOS built into main ROM (e.g. Scorpion)
    if (!profile.trdosInRom && romData['trdos.rom'] && (profile.betaDiskDefault || spec.betaDiskEnabled)) {
        spec.memory.loadTrdosRom(romData['trdos.rom']);
    }
    // Update TR-DOS ROM flag for trap handler (must be called for all machines,
    // including Scorpion where TR-DOS is in main ROM bank)
    if (spec.trdosTrap) spec.trdosTrap.updateTrdosRomFlag();
    spec.updateBetaDiskPagingFlag();
    spec.romLoaded = true;
    return true;
}

export function applyRomsToEmulator(spectrum) {
    loadRomsForMachineType(spectrum, spectrum.machineType);
}

export function initializeEmulator(spectrum, showMessage) {
    // Validate saved machine type has required ROM, fallback to 48k if not
    if (spectrum.machineType !== '48k') {
        const profile = getMachineProfile(spectrum.machineType);
        if (!romData[profile.romFile]) {
            spectrum.setMachineType('48k');
            updateULAplusStatus(spectrum);
        }
    }

    applyRomsToEmulator(spectrum);
    const romModal = document.getElementById('romModal');
    romModal.classList.add('hidden');

    // Reset and start emulator immediately
    spectrum.reset();
    spectrum.start();

    // Update Beta Disk status after machine type is finalized
    _updateBetaDiskStatus?.(spectrum);

    showMessage('Emulator started');
}

// ROM Modal event handlers
export function initRomModalHandlers(spectrum, showMessage) {
    const romModal = document.getElementById('romModal');
    const btnSelect48Rom = document.getElementById('btnSelect48Rom');
    const btnSelect128Rom = document.getElementById('btnSelect128Rom');
    const btnSelectPlus2Rom = document.getElementById('btnSelectPlus2Rom');
    const btnSelectPlus2aRom = document.getElementById('btnSelectPlus2aRom');
    const btnSelectPlus3Rom = document.getElementById('btnSelectPlus3Rom');
    const btnSelectPentagonRom = document.getElementById('btnSelectPentagonRom');
    const btnSelectScorpionRom = document.getElementById('btnSelectScorpionRom');
    const btnSelectTrdosRom = document.getElementById('btnSelectTrdosRom');
    const btnStartEmulator = document.getElementById('btnStartEmulator');
    const rom48Input = document.getElementById('rom48Input');
    const rom128Input = document.getElementById('rom128Input');
    const romPlus2Input = document.getElementById('romPlus2Input');
    const romPlus2aInput = document.getElementById('romPlus2aInput');
    const romPlus3Input = document.getElementById('romPlus3Input');
    const romPentagonInput = document.getElementById('romPentagonInput');
    const romScorpionInput = document.getElementById('romScorpionInput');
    const romTrdosInput = document.getElementById('romTrdosInput');

    btnSelect48Rom.addEventListener('click', () => rom48Input.click());
    btnSelect128Rom.addEventListener('click', () => rom128Input.click());
    btnSelectPlus2Rom.addEventListener('click', () => romPlus2Input.click());
    btnSelectPlus2aRom.addEventListener('click', () => romPlus2aInput.click());
    if (btnSelectPlus3Rom) btnSelectPlus3Rom.addEventListener('click', () => romPlus3Input.click());
    btnSelectPentagonRom.addEventListener('click', () => romPentagonInput.click());
    if (btnSelectScorpionRom) btnSelectScorpionRom.addEventListener('click', () => romScorpionInput.click());
    if (btnSelectTrdosRom) btnSelectTrdosRom.addEventListener('click', () => romTrdosInput.click());

    rom48Input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const data = await file.arrayBuffer();
            await loadRomFile(data, '48k', showMessage);
            showMessage('48K ROM loaded');
        }
        rom48Input.value = '';
    });

    rom128Input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const data = await file.arrayBuffer();
            await loadRomFile(data, '128k', showMessage);
            showMessage('128K ROM loaded');
        }
        rom128Input.value = '';
    });

    romPlus2Input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const data = await file.arrayBuffer();
            await loadRomFile(data, 'plus2', showMessage);
            showMessage('+2 ROM loaded');
        }
        romPlus2Input.value = '';
    });

    romPlus2aInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const data = await file.arrayBuffer();
            await loadRomFile(data, 'plus2a', showMessage);
            showMessage('+2A ROM loaded');
        }
        romPlus2aInput.value = '';
    });

    romPlus3Input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const data = await file.arrayBuffer();
            await loadRomFile(data, 'plus3', showMessage);
            showMessage('+3 ROM loaded');
        }
        romPlus3Input.value = '';
    });

    romPentagonInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const data = await file.arrayBuffer();
            await loadRomFile(data, 'pentagon', showMessage);
            showMessage('Pentagon ROM loaded');
        }
        romPentagonInput.value = '';
    });

    romScorpionInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const data = await file.arrayBuffer();
            await loadRomFile(data, 'scorpion', showMessage);
            showMessage('Scorpion ROM loaded');
        }
        romScorpionInput.value = '';
    });

    romTrdosInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const data = await file.arrayBuffer();
            await loadRomFile(data, 'trdos', showMessage);
            showMessage('TR-DOS ROM loaded');
            _updateBetaDiskStatus?.(spectrum);
        }
        romTrdosInput.value = '';
    });

    btnStartEmulator.addEventListener('click', () => {
        initializeEmulator(spectrum, showMessage);
    });

    const btnCloseRomModal = document.getElementById('btnCloseRomModal');
    btnCloseRomModal.addEventListener('click', () => {
        romModal.classList.add('hidden');
    });

    // Allow dropping ROMs on modal
    romModal.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    romModal.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (!file) return;

        const data = await file.arrayBuffer();
        const name = file.name.toLowerCase();

        if (name.includes('trdos') || name === 'trdos.rom') {
            await loadRomFile(data, 'trdos', showMessage);
            showMessage('TR-DOS ROM loaded');
            _updateBetaDiskStatus?.(spectrum);
        } else if (name.includes('plus3') || name.includes('+3')) {
            await loadRomFile(data, 'plus3', showMessage);
            showMessage('+3 ROM loaded');
        } else if (name.includes('plus2a') || name.includes('+2a')) {
            await loadRomFile(data, 'plus2a', showMessage);
            showMessage('+2A ROM loaded');
        } else if (name.includes('plus2') || name.includes('+2')) {
            await loadRomFile(data, 'plus2', showMessage);
            showMessage('+2 ROM loaded');
        } else if (name.includes('scorpion')) {
            await loadRomFile(data, 'scorpion', showMessage);
            showMessage('Scorpion ROM loaded');
        } else if (name.includes('pentagon')) {
            await loadRomFile(data, 'pentagon', showMessage);
            showMessage('Pentagon ROM loaded');
        } else if (name.includes('128') || (data.byteLength >= 32768 && !name.includes('48') && !name.includes('trdos'))) {
            await loadRomFile(data, '128k', showMessage);
            showMessage('128K ROM loaded');
        } else {
            await loadRomFile(data, '48k', showMessage);
            showMessage('48K ROM loaded');
        }
    });
}
