// rom-selector.js — ROM selector modal, auto-load, validation, drag & drop (extracted from index.html)

export function initRomSelector({ getSpectrum, getShowMessage, labelManager, getMachineProfile, MACHINE_PROFILES, getDisplayAPI, getUpdateBetaDiskStatus, getUpdatePlusDStatus, getUpdateIF1Status }) {
    function showMessage(text, type) { getShowMessage()(text, type); }
    const romData = {};    // { 'filename': ArrayBuffer, ... }

    const ROM_TYPE_TO_FILE = { '48k': '48.rom', '128k': '128.rom', 'plus2': 'plus2.rom', 'plus2a': 'plus2a.rom', 'plus3': 'plus3.rom', 'pentagon': 'pentagon.rom', 'scorpion': 'scorpion.rom', 'trdos': 'trdos.rom', 'plusd': 'plusd.rom', 'if1': 'if1.rom' };

    function getRomByType(type) {
        return romData[ROM_TYPE_TO_FILE[type]] || null;
    }
    function setRomByType(type, data) {
        if (ROM_TYPE_TO_FILE[type]) romData[ROM_TYPE_TO_FILE[type]] = data;
    }

    // DOM elements
    const romModal = document.getElementById('romModal');
    const btnStartEmulator = document.getElementById('btnStartEmulator');
    const btnCloseRomModal = document.getElementById('btnCloseRomModal');
    const status48Rom = document.getElementById('status48Rom');
    const status128Rom = document.getElementById('status128Rom');
    const statusPlus2Rom = document.getElementById('statusPlus2Rom');
    const statusPlus2aRom = document.getElementById('statusPlus2aRom');
    const statusPlus3Rom = document.getElementById('statusPlus3Rom');
    const statusPentagonRom = document.getElementById('statusPentagonRom');
    const statusScorpionRom = document.getElementById('statusScorpionRom');

    const btnSelect48Rom = document.getElementById('btnSelect48Rom');
    const btnSelect128Rom = document.getElementById('btnSelect128Rom');
    const btnSelectPlus2Rom = document.getElementById('btnSelectPlus2Rom');
    const btnSelectPlus2aRom = document.getElementById('btnSelectPlus2aRom');
    const btnSelectPlus3Rom = document.getElementById('btnSelectPlus3Rom');
    const btnSelectPentagonRom = document.getElementById('btnSelectPentagonRom');
    const btnSelectScorpionRom = document.getElementById('btnSelectScorpionRom');
    const btnSelectTrdosRom = document.getElementById('btnSelectTrdosRom');
    const btnSelectPlusDRom = document.getElementById('btnSelectPlusDRom');
    const btnSelectIF1Rom = document.getElementById('btnSelectIF1Rom');
    const rom48Input = document.getElementById('rom48Input');
    const rom128Input = document.getElementById('rom128Input');
    const romPlus2Input = document.getElementById('romPlus2Input');
    const romPlus2aInput = document.getElementById('romPlus2aInput');
    const romPlus3Input = document.getElementById('romPlus3Input');
    const romPentagonInput = document.getElementById('romPentagonInput');
    const romScorpionInput = document.getElementById('romScorpionInput');
    const romTrdosInput = document.getElementById('romTrdosInput');
    const romPlusDRomInput = document.getElementById('romPlusDRomInput');
    const romIF1Input = document.getElementById('romIF1Input');

    // ROM size validation
    const ROM_EXPECTED_SIZES = {
        '48k': [16384], 'trdos': [16384], 'plusd': [8192], 'if1': [8192],
        '128k': [32768], 'plus2': [32768], 'pentagon': [32768],
        'plus2a': [65536], 'plus3': [65536], 'scorpion': [65536]
    };

    const ROM_STATUS_IDS = {
        '48k': 'status48Rom', '128k': 'status128Rom', 'plus2': 'statusPlus2Rom',
        'plus2a': 'statusPlus2aRom', 'plus3': 'statusPlus3Rom', 'pentagon': 'statusPentagonRom', 'scorpion': 'statusScorpionRom', 'trdos': 'statusTrdosRom', 'plusd': 'statusPlusDRom', 'if1': 'statusIF1Rom'
    };

    function updateRomStatus() {
        const statusTrdosRom = document.getElementById('statusTrdosRom');
        // Clear any inline error color from size validation
        [status48Rom, status128Rom, statusPlus2Rom, statusPlus2aRom, statusPlus3Rom, statusPentagonRom, statusScorpionRom, statusTrdosRom].forEach(el => { if (el) el.style.color = ''; });

        if (romData['48.rom']) {
            status48Rom.textContent = '✓ Loaded (' + (romData['48.rom'].byteLength / 1024) + 'KB)';
            status48Rom.classList.add('loaded');
        } else {
            status48Rom.textContent = 'Not loaded';
            status48Rom.classList.remove('loaded');
        }

        if (romData['128.rom']) {
            status128Rom.textContent = '✓ Loaded (' + (romData['128.rom'].byteLength / 1024) + 'KB)';
            status128Rom.classList.add('loaded');
        } else {
            status128Rom.textContent = 'Not loaded (128K mode unavailable)';
            status128Rom.classList.remove('loaded');
        }

        if (romData['plus2.rom']) {
            statusPlus2Rom.textContent = '✓ Loaded (' + (romData['plus2.rom'].byteLength / 1024) + 'KB)';
            statusPlus2Rom.classList.add('loaded');
        } else {
            statusPlus2Rom.textContent = 'Not loaded (+2 mode unavailable)';
            statusPlus2Rom.classList.remove('loaded');
        }

        if (romData['plus2a.rom']) {
            const bank0 = new Uint8Array(romData['plus2a.rom'].slice(0, 16384));
            const romStr = String.fromCharCode(...bank0.slice(0, 16384));
            const hasMenu = romStr.indexOf('Loader') !== -1 || romStr.indexOf('+3') !== -1;
            if (hasMenu) {
                statusPlus2aRom.textContent = '✓ Loaded (' + (romData['plus2a.rom'].byteLength / 1024) + 'KB)';
                statusPlus2aRom.classList.add('loaded');
            } else {
                statusPlus2aRom.textContent = '⚠ Loaded but may be wrong ROM (no +2A menu in bank 0)';
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
            statusPentagonRom.textContent = '✓ Loaded (' + (romData['pentagon.rom'].byteLength / 1024) + 'KB)';
            statusPentagonRom.classList.add('loaded');
        } else {
            statusPentagonRom.textContent = 'Not loaded (Pentagon mode unavailable)';
            statusPentagonRom.classList.remove('loaded');
        }

        if (statusScorpionRom) {
            if (romData['scorpion.rom']) {
                statusScorpionRom.textContent = '✓ Loaded (' + (romData['scorpion.rom'].byteLength / 1024) + 'KB)';
                statusScorpionRom.classList.add('loaded');
            } else {
                statusScorpionRom.textContent = 'Not loaded (Scorpion mode unavailable)';
                statusScorpionRom.classList.remove('loaded');
            }
        }

        if (statusTrdosRom) {
            if (romData['trdos.rom']) {
                statusTrdosRom.textContent = '✓ Loaded (' + (romData['trdos.rom'].byteLength / 1024) + 'KB)';
                statusTrdosRom.classList.add('loaded');
            } else {
                statusTrdosRom.textContent = 'Not loaded (required for TRD/SCL disk images)';
                statusTrdosRom.classList.remove('loaded');
            }
        }

        const statusPlusDRom = document.getElementById('statusPlusDRom');
        if (statusPlusDRom) {
            if (romData['plusd.rom']) {
                statusPlusDRom.textContent = '✓ Loaded (' + (romData['plusd.rom'].byteLength / 1024) + 'KB)';
                statusPlusDRom.classList.add('loaded');
            } else {
                statusPlusDRom.textContent = 'Not loaded (for MGT disk images)';
                statusPlusDRom.classList.remove('loaded');
            }
        }

        const statusIF1Rom = document.getElementById('statusIF1Rom');
        if (statusIF1Rom) {
            if (romData['if1.rom']) {
                statusIF1Rom.textContent = '✓ Loaded (' + (romData['if1.rom'].byteLength / 1024) + 'KB)';
                statusIF1Rom.classList.add('loaded');
            } else {
                statusIF1Rom.textContent = 'Not loaded (for Microdrive cartridges)';
                statusIF1Rom.classList.remove('loaded');
            }
        }

        btnStartEmulator.disabled = !romData['48.rom'];
    }

    async function loadRomFile(data, type) {
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
    function loadRomsForMachineType(spec, machineType) {
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
        // Load +D ROM if available and +D is enabled
        if (romData['plusd.rom'] && spec.plusDEnabled) {
            spec.memory.loadPlusDRom(romData['plusd.rom']);
        }
        // Load Interface 1 ROM if available and IF1 is enabled
        if (romData['if1.rom'] && spec.if1Enabled) {
            spec.memory.loadIF1Rom(romData['if1.rom']);
        }
        // Recalculate paging flags AFTER all ROMs are loaded — hasPlusDRom()/hasIF1Rom()
        // must return true for _plusDPagingEnabled/_if1PagingEnabled to be set
        spec.updateBetaDiskPagingFlag();
        spec.romLoaded = true;
        return true;
    }

    function applyRomsToEmulator() {
        const spectrum = getSpectrum();
        loadRomsForMachineType(spectrum, spectrum.machineType);
    }

    function initializeEmulator() {
        const spectrum = getSpectrum();
        const displayAPI = getDisplayAPI();
        // Validate saved machine type has required ROM, fallback to 48k if not
        if (spectrum.machineType !== '48k') {
            const profile = getMachineProfile(spectrum.machineType);
            if (!romData[profile.romFile]) {
                spectrum.setMachineType('48k');
                if (displayAPI) displayAPI.updateULAplusStatus();
            }
        }

        applyRomsToEmulator();
        romModal.classList.add('hidden');

        // Reset and start emulator immediately
        spectrum.reset();
        spectrum.start();

        // Update disk interface statuses after machine type is finalized and ROMs loaded
        const updateBetaDiskStatus = getUpdateBetaDiskStatus();
        if (typeof updateBetaDiskStatus === 'function') {
            updateBetaDiskStatus();
        }
        const updatePlusDStatus = getUpdatePlusDStatus();
        if (typeof updatePlusDStatus === 'function') {
            updatePlusDStatus();
        }
        const updateIF1Status = getUpdateIF1Status();
        if (typeof updateIF1Status === 'function') {
            updateIF1Status();
        }

        showMessage('Emulator started');
    }

    // Try to load ROM labels from data/ directory
    async function tryLoadRomLabels() {
        const labelPaths = [
            'data/48k-labels.json',
            'data/rom48-labels.json',
            'data/spectrum48-labels.json'
        ];

        for (const path of labelPaths) {
            try {
                const response = await fetch(path);
                if (response.ok) {
                    const jsonStr = await response.text();
                    const count = labelManager.loadRomLabels(jsonStr);
                    if (count > 0) {
                        return;
                    }
                }
            } catch (e) {
                // Labels file not found, continue
            }
        }
    }

    // Try to auto-load ROMs from roms/ directory
    async function tryLoadRomsFromDirectory() {
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
        // +D ROM (for MGT disks)
        if (!seen.has('plusd.rom')) {
            romPaths.push({ path: 'roms/plusd.rom', file: 'plusd.rom' });
        }
        // Interface 1 ROM (for Microdrive cartridges)
        if (!seen.has('if1.rom')) {
            romPaths.push({ path: 'roms/if1.rom', file: 'if1.rom' });
        }
        for (const rom of romPaths) {
            try {
                const response = await fetch(rom.path);
                if (response.ok) {
                    romData[rom.file] = await response.arrayBuffer();
                }
            } catch (e) {
                // ROM not found, continue
            }
        }

        // Try to load ROM labels
        await tryLoadRomLabels();

        updateRomStatus();

        if (romData['48.rom']) {
            // ROMs found, initialize directly
            initializeEmulator();
        } else {
            // No 48K ROM, show dialog
            romModal.classList.remove('hidden');
        }
    }

    function showRomModal() {
        updateRomStatus();
        btnCloseRomModal.classList.remove('hidden');
        romModal.classList.remove('hidden');
    }

    function isRomModalVisible() {
        return !romModal.classList.contains('hidden');
    }

    // --- Event handlers ---

    // ROM select button → file input click
    btnSelect48Rom.addEventListener('click', () => rom48Input.click());
    btnSelect128Rom.addEventListener('click', () => rom128Input.click());
    btnSelectPlus2Rom.addEventListener('click', () => romPlus2Input.click());
    btnSelectPlus2aRom.addEventListener('click', () => romPlus2aInput.click());
    if (btnSelectPlus3Rom) btnSelectPlus3Rom.addEventListener('click', () => romPlus3Input.click());
    btnSelectPentagonRom.addEventListener('click', () => romPentagonInput.click());
    if (btnSelectScorpionRom) btnSelectScorpionRom.addEventListener('click', () => romScorpionInput.click());
    if (btnSelectTrdosRom) btnSelectTrdosRom.addEventListener('click', () => romTrdosInput.click());
    if (btnSelectPlusDRom) btnSelectPlusDRom.addEventListener('click', () => romPlusDRomInput.click());
    if (btnSelectIF1Rom) btnSelectIF1Rom.addEventListener('click', () => romIF1Input.click());

    // File input change handlers
    const fileHandlers = [
        { input: rom48Input, type: '48k', label: '48K ROM' },
        { input: rom128Input, type: '128k', label: '128K ROM' },
        { input: romPlus2Input, type: 'plus2', label: '+2 ROM' },
        { input: romPlus2aInput, type: 'plus2a', label: '+2A ROM' },
        { input: romPlus3Input, type: 'plus3', label: '+3 ROM' },
        { input: romPentagonInput, type: 'pentagon', label: 'Pentagon ROM' },
        { input: romScorpionInput, type: 'scorpion', label: 'Scorpion ROM' },
        { input: romTrdosInput, type: 'trdos', label: 'TR-DOS ROM' },
        { input: romPlusDRomInput, type: 'plusd', label: '+D ROM' },
        { input: romIF1Input, type: 'if1', label: 'Interface 1 ROM' }
    ];

    for (const { input, type, label } of fileHandlers) {
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const data = await file.arrayBuffer();
                await loadRomFile(data, type);
                showMessage(label + ' loaded');
                if (type === 'trdos') {
                    const updateBetaDiskStatus = getUpdateBetaDiskStatus();
                    if (typeof updateBetaDiskStatus === 'function') {
                        updateBetaDiskStatus();
                    }
                }
                if (type === 'plusd') {
                    const updatePlusDStatus = getUpdatePlusDStatus();
                    if (typeof updatePlusDStatus === 'function') {
                        updatePlusDStatus();
                    }
                }
                if (type === 'if1') {
                    const updateIF1Status = getUpdateIF1Status();
                    if (typeof updateIF1Status === 'function') {
                        updateIF1Status();
                    }
                }
            }
            input.value = '';
        });
    }

    btnStartEmulator.addEventListener('click', () => {
        initializeEmulator();
    });

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

        if (name.includes('plusd') || name === 'plusd.rom') {
            await loadRomFile(data, 'plusd');
            showMessage('+D ROM loaded');
        } else if (name.includes('if1') || name === 'if1.rom' || name.includes('interface1')) {
            await loadRomFile(data, 'if1');
            showMessage('Interface 1 ROM loaded');
        } else if (name.includes('trdos') || name === 'trdos.rom') {
            await loadRomFile(data, 'trdos');
            showMessage('TR-DOS ROM loaded');
            const updateBetaDiskStatus = getUpdateBetaDiskStatus();
            if (typeof updateBetaDiskStatus === 'function') {
                updateBetaDiskStatus();
            }
        } else if (name.includes('plus3') || name.includes('+3')) {
            await loadRomFile(data, 'plus3');
            showMessage('+3 ROM loaded');
        } else if (name.includes('plus2a') || name.includes('+2a')) {
            await loadRomFile(data, 'plus2a');
            showMessage('+2A ROM loaded');
        } else if (name.includes('plus2') || name.includes('+2')) {
            await loadRomFile(data, 'plus2');
            showMessage('+2 ROM loaded');
        } else if (name.includes('scorpion')) {
            await loadRomFile(data, 'scorpion');
            showMessage('Scorpion ROM loaded');
        } else if (name.includes('pentagon')) {
            await loadRomFile(data, 'pentagon');
            showMessage('Pentagon ROM loaded');
        } else if (name.includes('128') || (data.byteLength >= 32768 && !name.includes('48') && !name.includes('trdos'))) {
            await loadRomFile(data, '128k');
            showMessage('128K ROM loaded');
        } else {
            await loadRomFile(data, '48k');
            showMessage('48K ROM loaded');
        }
    });

    // Settings → Load ROMs button
    document.getElementById('btnSettingsLoadRoms').addEventListener('click', () => {
        showRomModal();
    });

    return {
        romData,
        loadRomsForMachineType,
        applyRomsToEmulator,
        initializeEmulator,
        tryLoadRomsFromDirectory,
        loadRomFile,
        updateRomStatus,
        showRomModal,
        isRomModalVisible
    };
}
