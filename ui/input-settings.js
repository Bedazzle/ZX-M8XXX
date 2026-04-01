// input-settings.js — Input & Mouse Settings (extracted from index.html)
import { storageGet, storageSet } from '../core/utils.js';

export function initInputSettings({
    getSpectrum,
    getCanvas,
    romData,
    showMessage,
    initGamepad,
    initBootManager
}) {
    const canvas = getCanvas();

    // DOM elements
    const chkKempston = document.getElementById('chkKempston');
    const chkKempstonExtended = document.getElementById('chkKempstonExtended');
    const chkMouseWheel = document.getElementById('chkMouseWheel');
    const chkMouseSwap = document.getElementById('chkMouseSwap');
    const chkMouseWheelSwap = document.getElementById('chkMouseWheelSwap');
    const chkKempstonMouse = document.getElementById('chkKempstonMouse');
    const mouseStatus = document.getElementById('mouseStatus');
    const btnMouse = document.getElementById('btnMouse');
    const chkBetaDisk = document.getElementById('chkBetaDisk');
    const betaDiskStatus = document.getElementById('betaDiskStatus');
    const chkPlusD = document.getElementById('chkPlusD');
    const plusDStatus = document.getElementById('plusDStatus');
    const btnNmiPlusD = document.getElementById('btnNmiPlusD');
    const chkIF1 = document.getElementById('chkIF1');
    const if1Status = document.getElementById('if1Status');

    let mouseCaptured = false;

    function saveInputSettings() {
        storageSet('zxm8_input', JSON.stringify({
            kempston: chkKempston.checked,
            kempstonExtended: chkKempstonExtended.checked,
            gamepad: document.getElementById('chkGamepad').checked,
            kempstonMouse: chkKempstonMouse.checked,
            mouseWheel: chkMouseWheel.checked,
            mouseSwap: chkMouseSwap.checked,
            mouseWheelSwap: chkMouseWheelSwap.checked
        }));
    }

    // Restore input settings from localStorage
    {
        const spectrum = getSpectrum();
        try {
            const savedInput = JSON.parse(storageGet('zxm8_input'));
            if (savedInput) {
                if (savedInput.kempston !== undefined) {
                    chkKempston.checked = savedInput.kempston;
                    spectrum.kempstonEnabled = savedInput.kempston;
                }
                if (savedInput.kempstonExtended !== undefined) {
                    chkKempstonExtended.checked = savedInput.kempstonExtended;
                    spectrum.kempstonExtendedEnabled = savedInput.kempstonExtended;
                }
                if (savedInput.gamepad !== undefined) {
                    document.getElementById('chkGamepad').checked = savedInput.gamepad;
                    spectrum.gamepadEnabled = savedInput.gamepad;
                }
                if (savedInput.kempstonMouse !== undefined) {
                    chkKempstonMouse.checked = savedInput.kempstonMouse;
                    spectrum.kempstonMouseEnabled = savedInput.kempstonMouse;
                }
                if (savedInput.mouseWheel !== undefined) {
                    chkMouseWheel.checked = savedInput.mouseWheel;
                    spectrum.kempstonMouseWheelEnabled = savedInput.mouseWheel;
                }
                if (savedInput.mouseSwap !== undefined) {
                    chkMouseSwap.checked = savedInput.mouseSwap;
                    spectrum.kempstonMouseSwapButtons = savedInput.mouseSwap;
                }
                if (savedInput.mouseWheelSwap !== undefined) {
                    chkMouseWheelSwap.checked = savedInput.mouseWheelSwap;
                    spectrum.kempstonMouseSwapWheel = savedInput.mouseWheelSwap;
                }
            }
        } catch (e) { console.warn('Failed to load input settings:', e); }

        // Apply default for Swap L/R if no saved state
        spectrum.kempstonMouseSwapButtons = chkMouseSwap.checked;
    }

    chkKempston.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.kempstonEnabled = chkKempston.checked;
        saveInputSettings();
        showMessage(chkKempston.checked ? 'Kempston joystick enabled (Numpad)' : 'Kempston joystick disabled');
    });

    // Extended Kempston Joystick (C/A/Start buttons)
    chkKempstonExtended.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.kempstonExtendedEnabled = chkKempstonExtended.checked;
        saveInputSettings();
        showMessage(chkKempstonExtended.checked ?
            'Extended Kempston enabled ([ = C, ] = A, \\ = Start)' :
            'Extended Kempston disabled');
    });

    // Hardware Gamepad (extracted to ui/gamepad.js)
    const gamepadAPI = initGamepad({
        getGamepadEnabled: () => getSpectrum().gamepadEnabled,
        setGamepadEnabled: (v) => { getSpectrum().gamepadEnabled = v; },
        getGamepadMapping: () => getSpectrum().gamepadMapping,
        setGamepadMapping: (v) => { getSpectrum().gamepadMapping = v; },
        enableKempston: () => { chkKempston.checked = true; getSpectrum().kempstonEnabled = true; },
        saveInputSettings,
        showMessage
    });

    // Mouse Wheel checkbox
    chkMouseWheel.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.kempstonMouseWheelEnabled = chkMouseWheel.checked;
        saveInputSettings();
        showMessage(chkMouseWheel.checked ?
            'Mouse wheel enabled (bits 7:4)' :
            'Mouse wheel disabled');
    });

    // Mouse Swap L/R checkbox
    chkMouseSwap.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.kempstonMouseSwapButtons = chkMouseSwap.checked;
        saveInputSettings();
        showMessage(chkMouseSwap.checked ?
            'Mouse buttons swapped (left↔right)' :
            'Mouse buttons normal');
    });

    // Mouse Swap Wheel checkbox
    chkMouseWheelSwap.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.kempstonMouseSwapWheel = chkMouseWheelSwap.checked;
        saveInputSettings();
        showMessage(chkMouseWheelSwap.checked ?
            'Mouse wheel direction inverted' :
            'Mouse wheel direction normal');
    });

    // Kempston Mouse
    function updateMouseStatus() {
        // Update settings panel status text
        if (!chkKempstonMouse.checked) {
            mouseStatus.textContent = '';
            btnMouse.style.display = 'none';
        } else if (mouseCaptured) {
            mouseStatus.textContent = '(Captured - Esc to release)';
            mouseStatus.style.color = 'var(--green)';
            btnMouse.style.display = '';
            btnMouse.textContent = '🖱️✓';
            btnMouse.title = 'Mouse captured (Esc to release)';
        } else {
            mouseStatus.textContent = '(Click 🖱️ to capture)';
            mouseStatus.style.color = 'var(--text-dim)';
            btnMouse.style.display = '';
            btnMouse.textContent = '🖱️';
            btnMouse.title = 'Capture mouse (Kempston Mouse)';
        }
    }

    chkKempstonMouse.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.kempstonMouseEnabled = chkKempstonMouse.checked;
        if (!chkKempstonMouse.checked && mouseCaptured) {
            document.exitPointerLock();
        }
        updateMouseStatus();
        saveInputSettings();
        showMessage(chkKempstonMouse.checked ?
            'Kempston Mouse enabled - click 🖱️ button to capture' :
            'Kempston Mouse disabled');
    });

    // Beta Disk (TR-DOS) interface toggle
    function updateBetaDiskStatus() {
        const spectrum = getSpectrum();
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

    chkBetaDisk.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.betaDiskEnabled = chkBetaDisk.checked;
        storageSet('zxm8_betaDisk', chkBetaDisk.checked);
        // Load TR-DOS ROM into memory when enabling Beta Disk
        if (chkBetaDisk.checked && romData['trdos.rom'] && !spectrum.memory.hasTrdosRom()) {
            spectrum.memory.loadTrdosRom(romData['trdos.rom']);
            spectrum.trdosTrap.updateTrdosRomFlag();
        }
        spectrum.updateBetaDiskPagingFlag();
        updateBetaDiskStatus();
        showMessage(chkBetaDisk.checked ?
            'Beta Disk interface enabled' :
            'Beta Disk interface disabled');
    });

    // Restore Beta Disk setting from localStorage (but not for machines with built-in Beta Disk)
    {
        const spectrum = getSpectrum();
        const savedBetaDisk = storageGet('zxm8_betaDisk') === 'true';
        if (!spectrum.profile.betaDiskDefault) {
            chkBetaDisk.checked = savedBetaDisk;
            spectrum.betaDiskEnabled = savedBetaDisk;
            // Load TR-DOS ROM if Beta Disk enabled and ROM available
            if (savedBetaDisk && romData['trdos.rom'] && !spectrum.memory.hasTrdosRom()) {
                spectrum.memory.loadTrdosRom(romData['trdos.rom']);
                spectrum.trdosTrap.updateTrdosRomFlag();
            }
        }
        spectrum.updateBetaDiskPagingFlag();
        updateBetaDiskStatus();
    }

    // +D Interface (MGT) toggle
    function updatePlusDStatus() {
        const spectrum = getSpectrum();
        if (!romData['plusd.rom']) {
            plusDStatus.textContent = '(plusd.rom required)';
        } else if (chkPlusD.checked) {
            plusDStatus.textContent = '';
        } else {
            plusDStatus.textContent = '';
        }
        btnNmiPlusD.disabled = !chkPlusD.checked || !romData['plusd.rom'];
    }

    chkPlusD.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.plusDEnabled = chkPlusD.checked;
        storageSet('zxm8_plusD', chkPlusD.checked);
        // Load +D ROM into memory when enabling
        if (chkPlusD.checked && romData['plusd.rom'] && !spectrum.memory.hasPlusDRom()) {
            spectrum.memory.loadPlusDRom(romData['plusd.rom']);
        }
        // Mutual exclusion: +D and IF1 use conflicting ports $E7/$EF
        if (chkPlusD.checked && chkIF1.checked) {
            chkIF1.checked = false;
            spectrum.if1Enabled = false;
            storageSet('zxm8_if1', false);
            spectrum.updateBetaDiskPagingFlag();
            updateIF1Status();
            showMessage('+D enabled — Interface 1 disabled (conflicting ports $E7/$EF)');
        }
        updatePlusDStatus();
        showMessage(chkPlusD.checked ?
            '+D interface enabled (MGT disks)' :
            '+D interface disabled');
    });

    // +D ROM load button
    document.getElementById('btnLoadPlusDRom').addEventListener('click', () => {
        document.getElementById('romPlusDInput').click();
    });

    // +D ROM file input
    document.getElementById('romPlusDInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const data = new Uint8Array(ev.target.result);
            romData['plusd.rom'] = data;
            const spectrum = getSpectrum();
            spectrum.memory.loadPlusDRom(data);
            updatePlusDStatus();
            showMessage('+D ROM loaded (' + data.length + ' bytes)');
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';  // Allow re-loading same file
    });

    // +D NMI (snapshot) button
    btnNmiPlusD.addEventListener('click', () => {
        const spectrum = getSpectrum();
        spectrum.triggerPlusDNmi();
    });

    // Restore +D setting from localStorage
    {
        const spectrum = getSpectrum();
        const savedPlusD = storageGet('zxm8_plusD') === 'true';
        chkPlusD.checked = savedPlusD;
        spectrum.plusDEnabled = savedPlusD;
        // Load +D ROM if enabled and ROM available
        if (savedPlusD && romData['plusd.rom'] && !spectrum.memory.hasPlusDRom()) {
            spectrum.memory.loadPlusDRom(romData['plusd.rom']);
        }
        updatePlusDStatus();
    }

    // Interface 1 (Microdrive) toggle
    function updateIF1Status() {
        if (!romData['if1.rom']) {
            if1Status.textContent = '(if1.rom required)';
        } else if (chkIF1.checked) {
            if1Status.textContent = '';
        } else {
            if1Status.textContent = '';
        }
    }

    chkIF1.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.if1Enabled = chkIF1.checked;
        storageSet('zxm8_if1', chkIF1.checked);
        // Load IF1 ROM into memory when enabling
        if (chkIF1.checked && romData['if1.rom']) {
            spectrum.memory.loadIF1Rom(romData['if1.rom']);
        }
        // Mutual exclusion: IF1 and +D use conflicting ports $E7/$EF
        if (chkIF1.checked && chkPlusD.checked) {
            chkPlusD.checked = false;
            spectrum.plusDEnabled = false;
            storageSet('zxm8_plusD', false);
            updatePlusDStatus();
            showMessage('Interface 1 enabled — +D disabled (conflicting ports $E7/$EF)');
        }
        spectrum.updateBetaDiskPagingFlag();
        updateIF1Status();
        showMessage(chkIF1.checked ?
            'Interface 1 enabled (Microdrive)' :
            'Interface 1 disabled');
    });

    // IF1 ROM load button
    document.getElementById('btnLoadIF1Rom').addEventListener('click', () => {
        document.getElementById('romIF1Input').click();
    });

    // IF1 ROM file input
    document.getElementById('romIF1Input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const data = new Uint8Array(ev.target.result);
            romData['if1.rom'] = data;
            const spectrum = getSpectrum();
            spectrum.memory.loadIF1Rom(data);
            updateIF1Status();
            showMessage('Interface 1 ROM loaded (' + data.length + ' bytes)');
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';  // Allow re-loading same file
    });

    // Restore IF1 setting from localStorage
    {
        const spectrum = getSpectrum();
        const savedIF1 = storageGet('zxm8_if1') === 'true';
        chkIF1.checked = savedIF1;
        spectrum.if1Enabled = savedIF1;
        // Load IF1 ROM if enabled and ROM available
        if (savedIF1 && romData['if1.rom']) {
            spectrum.memory.loadIF1Rom(romData['if1.rom']);
        }
        spectrum.updateBetaDiskPagingFlag();
        updateIF1Status();
    }

    // Boot Manager (extracted to ui/boot-manager.js)
    const bootAPI = initBootManager({ showMessage });

    // Mouse button click to capture
    btnMouse.addEventListener('click', () => {
        if (!mouseCaptured) {
            canvas.requestPointerLock();
        }
    });

    // Pointer Lock for mouse capture (also works by clicking canvas)
    canvas.addEventListener('click', () => {
        if (chkKempstonMouse.checked && !mouseCaptured) {
            canvas.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        mouseCaptured = document.pointerLockElement === canvas;
        updateMouseStatus();
        if (mouseCaptured) {
            showMessage('Mouse captured - press Escape to release');
        }
    });

    document.addEventListener('pointerlockerror', () => {
        showMessage('Failed to capture mouse', 'error');
    });

    // Mouse movement when captured
    document.addEventListener('mousemove', (e) => {
        if (mouseCaptured && getSpectrum().kempstonMouseEnabled) {
            // movementX/Y give relative movement
            getSpectrum().updateMousePosition(e.movementX, e.movementY);
        }
    });

    // Mouse buttons when captured
    canvas.addEventListener('mousedown', (e) => {
        if (mouseCaptured && getSpectrum().kempstonMouseEnabled) {
            getSpectrum().setMouseButton(e.button, true);
            e.preventDefault();
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (mouseCaptured && getSpectrum().kempstonMouseEnabled) {
            getSpectrum().setMouseButton(e.button, false);
            e.preventDefault();
        }
    });

    // Prevent context menu when mouse captured
    canvas.addEventListener('contextmenu', (e) => {
        if (mouseCaptured) {
            e.preventDefault();
        }
    });

    // Mouse wheel when captured
    document.addEventListener('wheel', (e) => {
        const spectrum = getSpectrum();
        if (mouseCaptured && spectrum.kempstonMouseEnabled && spectrum.kempstonMouseWheelEnabled) {
            spectrum.updateMouseWheel(e.deltaY);
            e.preventDefault();
        }
    }, { passive: false });

    return {
        saveInputSettings,
        updateBetaDiskStatus,
        updatePlusDStatus,
        updateIF1Status,
        getUpdateIF1Status: () => updateIF1Status,
        updateMouseStatus,
        gamepadAPI,
        bootAPI
    };
}
