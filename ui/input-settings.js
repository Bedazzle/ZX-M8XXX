// input-settings.js — Input & Mouse Settings (extracted from index.html)
import { storageGet, storageSet } from '../core/utils.js';
import { MODIFIER_KEY_OPTIONS, DEFAULT_CAPS_SHIFT_OPTION, DEFAULT_SYMBOL_SHIFT_OPTION } from '../core/ula.js';

import { JOYSTICK_TYPES, isJoystickType, DIRECTIONS, DEFAULT_CUSTOM_KEYS,
         normalizeCustomKeys } from '../core/joystick.js';

export function initInputSettings({
    getSpectrum,
    getCanvas,
    romData,
    showMessage,
    initGamepad,
    initBootManager,
    onDiskSystemsChanged
}) {
    // Notify the disk tab when an interface toggle changes the available systems
    const notifyDiskSystems = () => { if (onDiskSystemsChanged) onDiskSystemsChanged(); };
    const canvas = getCanvas();

    // DOM elements
    const chkKempston = document.getElementById('chkKempston');
    const selJoystickType = document.getElementById('selJoystickType');

    // Fill the joystick dropdown *before* settings are restored: assigning
    // select.value with no matching <option> is silently ignored, so the restore
    // would leave the dropdown on its first entry and the next save would write
    // that back — losing the setting.
    if (selJoystickType && !selJoystickType.options.length) {
        for (const t of JOYSTICK_TYPES) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            opt.title = t.hint;
            selJoystickType.appendChild(opt);
        }
    }
    const joyCustomKeys = document.getElementById('joyCustomKeys');
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
    const chkOpus = document.getElementById('chkOpus');
    const opusStatus = document.getElementById('opusStatus');
    const chkDidaktik = document.getElementById('chkDidaktik');
    const didaktikStatus = document.getElementById('didaktikStatus');

    // Which ROM file each interface wants, and where its name is shown. The rows
    // mirror the machine list above: checkbox, Load ROM, filename in cyan.
    const IFACE_ROMS = {
        betaDisk: { rom: 'trdos.rom',    span: 'betaDiskRomName' },
        plusD:    { rom: 'plusd.rom',    span: 'plusDRomName' },
        if1:      { rom: 'if1.rom',      span: 'if1RomName' },
        opus:     { rom: 'opus.rom',     span: 'opusRomName' },
        didaktik: { rom: 'didaktik.rom', span: 'didaktikRomName' }
    };
    // A ROM loaded by hand keeps the name of the file the user picked; one that
    // came from roms/ shows its canonical name, exactly as the machine rows do.
    const ifaceRomFileNames = {};

    function setIfaceRomName(key, fileName) {
        ifaceRomFileNames[IFACE_ROMS[key].rom] = fileName;
        updateIfaceRomName(key);
    }

    function updateIfaceRomName(key) {
        const entry = IFACE_ROMS[key];
        const el = document.getElementById(entry.span);
        if (!el) return;
        const name = ifaceRomFileNames[entry.rom] ||
                     (romData[entry.rom] ? entry.rom : '');
        el.textContent = name;
        el.title = name;
    }

    function updateAllIfaceRomNames() {
        for (const key of Object.keys(IFACE_ROMS)) updateIfaceRomName(key);
    }
    const chkKeyboardGhosting = document.getElementById('chkKeyboardGhosting');
    const selCapsShiftKey = document.getElementById('selCapsShiftKey');
    const selSymbolShiftKey = document.getElementById('selSymbolShiftKey');
    const modKeysHint = document.getElementById('modKeysHint');

    let mouseCaptured = false;

    function saveInputSettings() {
        storageSet('zxm8_input', JSON.stringify({
            kempston: chkKempston.checked,
            kempstonExtended: chkKempstonExtended.checked,
            gamepad: document.getElementById('chkGamepad').checked,
            kempstonMouse: chkKempstonMouse.checked,
            mouseWheel: chkMouseWheel.checked,
            mouseSwap: chkMouseSwap.checked,
            mouseWheelSwap: chkMouseWheelSwap.checked,
            joystickType: selJoystickType ? selJoystickType.value : 'kempston',
            joystickCustomKeys: customKeys,
            capsShiftKey: selCapsShiftKey.value,
            symbolShiftKey: selSymbolShiftKey.value,
            keyboardGhosting: chkKeyboardGhosting ? chkKeyboardGhosting.checked : false
        }));
    }

    // ===== Caps Shift / Symbol Shift PC key selection =====

    for (const sel of [selCapsShiftKey, selSymbolShiftKey]) {
        for (const [id, opt] of Object.entries(MODIFIER_KEY_OPTIONS)) {
            const o = document.createElement('option');
            o.value = id;
            o.textContent = opt.label;
            sel.appendChild(o);
        }
    }
    selCapsShiftKey.value = DEFAULT_CAPS_SHIFT_OPTION;
    selSymbolShiftKey.value = DEFAULT_SYMBOL_SHIFT_OPTION;

    function modifierCodesOverlap(a, b) {
        return MODIFIER_KEY_OPTIONS[a].codes.some(c => MODIFIER_KEY_OPTIONS[b].codes.includes(c));
    }

    function updateModKeysHint() {
        const usesCtrl = [selCapsShiftKey.value, selSymbolShiftKey.value]
            .some(id => MODIFIER_KEY_OPTIONS[id].codes.some(c => c.startsWith('Control')));
        modKeysHint.textContent = usesCtrl ?
            '(browser reserves Ctrl+W/T/N — those can\'t reach the Spectrum)' : '';
    }

    function applyModifierKeys() {
        getSpectrum().ula.setModifierKeys(selCapsShiftKey.value, selSymbolShiftKey.value);
        updateModKeysHint();
        saveInputSettings();
    }

    // On collision the other dropdown takes this one's previous value (swap),
    // so Caps and Symbol Shift can never share a PC key. If the previous value
    // also overlaps the new pick (e.g. Both Shifts → Left Shift), the other
    // dropdown falls back to the first non-overlapping option instead.
    const modPrev = new Map([[selCapsShiftKey, selCapsShiftKey.value],
                             [selSymbolShiftKey, selSymbolShiftKey.value]]);
    function wireModifierSelect(sel, other) {
        sel.addEventListener('change', () => {
            if (modifierCodesOverlap(sel.value, other.value)) {
                let replacement = modPrev.get(sel);
                if (modifierCodesOverlap(replacement, sel.value)) {
                    replacement = Object.keys(MODIFIER_KEY_OPTIONS)
                        .find(id => !modifierCodesOverlap(id, sel.value));
                }
                other.value = replacement;
                modPrev.set(other, replacement);
                showMessage('Caps and Symbol Shift can\'t share a key — the other one was reassigned');
            }
            modPrev.set(sel, sel.value);
            applyModifierKeys();
        });
    }
    wireModifierSelect(selCapsShiftKey, selSymbolShiftKey);
    wireModifierSelect(selSymbolShiftKey, selCapsShiftKey);

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
                if (savedInput.joystickType !== undefined && selJoystickType &&
                    isJoystickType(savedInput.joystickType)) {
                    selJoystickType.value = savedInput.joystickType;
                    if (spectrum.setJoystickType) spectrum.setJoystickType(savedInput.joystickType);
                }
                if (savedInput.joystickCustomKeys) {
                    customKeys = normalizeCustomKeys(savedInput.joystickCustomKeys);
                    if (spectrum.setJoystickCustomKeys) spectrum.setJoystickCustomKeys(customKeys);
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
                if (savedInput.keyboardGhosting !== undefined && chkKeyboardGhosting) {
                    chkKeyboardGhosting.checked = savedInput.keyboardGhosting;
                }
                if (MODIFIER_KEY_OPTIONS[savedInput.capsShiftKey]) {
                    selCapsShiftKey.value = savedInput.capsShiftKey;
                }
                if (MODIFIER_KEY_OPTIONS[savedInput.symbolShiftKey] &&
                    !modifierCodesOverlap(selCapsShiftKey.value, savedInput.symbolShiftKey)) {
                    selSymbolShiftKey.value = savedInput.symbolShiftKey;
                }
            }
        } catch (e) { console.warn('Failed to load input settings:', e); }

        // Apply default for Swap L/R if no saved state
        spectrum.kempstonMouseSwapButtons = chkMouseSwap.checked;

        // Apply the restored (or default) Caps/Symbol Shift key choices
        if (modifierCodesOverlap(selCapsShiftKey.value, selSymbolShiftKey.value)) {
            selSymbolShiftKey.value = Object.keys(MODIFIER_KEY_OPTIONS)
                .find(id => !modifierCodesOverlap(id, selCapsShiftKey.value));
        }
        modPrev.set(selCapsShiftKey, selCapsShiftKey.value);
        modPrev.set(selSymbolShiftKey, selSymbolShiftKey.value);
        spectrum.ula.setModifierKeys(selCapsShiftKey.value, selSymbolShiftKey.value);
        updateModKeysHint();

        if (chkKeyboardGhosting) {
            spectrum.ula.setKeyboardGhosting(chkKeyboardGhosting.checked);
            chkKeyboardGhosting.addEventListener('change', () => {
                getSpectrum().ula.setKeyboardGhosting(chkKeyboardGhosting.checked);
                saveInputSettings();
            });
        }
    }

    // Which joystick the numpad/gamepad emulates. Sinclair and Cursor are keyboard
    // interfaces, so the machine presses ZX keys for them; Kempston reads port $1F.
    // Custom bindings: one click-to-bind button per direction, e.g. QAOP + Space
    // for a game that expects those keys. Shown only for the Custom type.
    let customKeys = normalizeCustomKeys(DEFAULT_CUSTOM_KEYS);
    let bindingBit = null;

    const keyLabel = (code) => String(code || '')
        .replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');

    // Compact: one small button per direction, glyph + the bound key, on one line.
    const DIR_GLYPH = { up: '↑', down: '↓', left: '←', right: '→', fire: '●' };

    function renderCustomKeys() {
        if (!joyCustomKeys) return;
        const isCustom = selJoystickType && selJoystickType.value === 'custom';
        joyCustomKeys.classList.toggle('hidden', !isCustom);
        if (!isCustom) return;
        joyCustomKeys.innerHTML = '';
        for (const d of DIRECTIONS) {
            const btn = document.createElement('button');
            btn.className = 'joy-bind' + (bindingBit === d.bit ? ' binding' : '');
            btn.title = `${d.name} — click, then press a key (Esc to cancel)`;
            btn.textContent = bindingBit === d.bit
                ? `${DIR_GLYPH[d.id]} …` : `${DIR_GLYPH[d.id]} ${keyLabel(customKeys[d.bit])}`;
            btn.addEventListener('click', () => {
                bindingBit = bindingBit === d.bit ? null : d.bit;
                renderCustomKeys();
            });
            joyCustomKeys.appendChild(btn);
        }
    }

    // Capture the next key press while a button is armed. Capture phase, so the
    // key is bound instead of being typed into the emulator.
    document.addEventListener('keydown', (e) => {
        if (bindingBit === null) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.code !== 'Escape') {
            customKeys = normalizeCustomKeys({ ...customKeys, [bindingBit]: e.code });
            const spectrum = getSpectrum();
            if (spectrum.setJoystickCustomKeys) spectrum.setJoystickCustomKeys(customKeys);
            saveInputSettings();
        }
        bindingBit = null;
        renderCustomKeys();
    }, true);

    if (selJoystickType) {
        selJoystickType.addEventListener('change', () => {
            const spectrum = getSpectrum();
            if (spectrum.setJoystickType) spectrum.setJoystickType(selJoystickType.value);
            saveInputSettings();
            renderCustomKeys();
            const t = JOYSTICK_TYPES.find(x => x.id === selJoystickType.value);
            showMessage(`Joystick: ${t ? t.name : selJoystickType.value}` +
                        (selJoystickType.value === 'custom' ? ' — click a button, then press a key' : ''));
        });
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
        updateIfaceRomName('betaDisk');
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
        notifyDiskSystems();
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
        // The +D cannot page its ROM in on a +2A/+3 — same as real hardware, and
        // the reason spectrum.js gates _plusDPagingEnabled on pagingModel. Say so
        // rather than letting the box be ticked and silently doing nothing.
        const incompatible = spectrum.profile.pagingModel === '+2a';
        chkPlusD.disabled = incompatible;
        if (incompatible) {
            plusDStatus.textContent = 'not available on +2A/+3 — use 48K, 128K, +2 or Pentagon';
        } else if (!romData['plusd.rom']) {
            plusDStatus.textContent = '(plusd.rom required)';
        } else {
            plusDStatus.textContent = '';
        }
        btnNmiPlusD.disabled = incompatible || !chkPlusD.checked || !romData['plusd.rom'];
        updateIfaceRomName('plusD');
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
            updateIF1Status();
            showMessage('+D enabled — Interface 1 disabled (conflicting ports $E7/$EF)');
        }
        // Mutual exclusion with the Opus: both page in at $0008 over $0000-$3FFF
        if (chkPlusD.checked && chkOpus.checked) {
            chkOpus.checked = false;
            spectrum.opusEnabled = false;
            storageSet('zxm8_opus', false);
            updateOpusStatus();
            showMessage('+D enabled — Opus Discovery disabled (both page in at $0008)');
        }
        if (chkPlusD.checked && chkDidaktik.checked) {
            chkDidaktik.checked = false;
            spectrum.didaktikEnabled = false;
            storageSet('zxm8_didaktik', false);
            updateDidaktikStatus();
            showMessage('+D enabled — Didaktik 80 disabled (both overlay $0000-$3FFF)');
        }
        spectrum.updateBetaDiskPagingFlag();
        updatePlusDStatus();
        notifyDiskSystems();
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
            setIfaceRomName('plusD', file.name);
            const spectrum = getSpectrum();
            spectrum.memory.loadPlusDRom(data);
            updatePlusDStatus();
            notifyDiskSystems();
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
        spectrum.updateBetaDiskPagingFlag();
        updatePlusDStatus();
    }

    // TR-DOS ROM load button. The Beta Disk had no row of its own before; its
    // ROM could only be reached through the Load ROMs... dialog, which is not
    // where anyone looks when the status line says "(trdos.rom required)".
    document.getElementById('btnLoadTrdosRom').addEventListener('click', () => {
        document.getElementById('romTrdosRomInput').click();
    });

    document.getElementById('romTrdosRomInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const data = new Uint8Array(ev.target.result);
            romData['trdos.rom'] = data;
            setIfaceRomName('betaDisk', file.name);
            const spectrum = getSpectrum();
            spectrum.memory.loadTrdosRom(data);
            if (spectrum.trdosTrap) spectrum.trdosTrap.updateTrdosRomFlag();
            spectrum.updateBetaDiskPagingFlag();
            updateBetaDiskStatus();
            notifyDiskSystems();
            showMessage('TR-DOS ROM loaded (' + data.length + ' bytes)');
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    });

    // Interface 1 (Microdrive) toggle
    function updateIF1Status() {
        // Interface 1 is gated on pagingModel exactly like the +D — see above
        const incompatible = getSpectrum().profile.pagingModel === '+2a';
        chkIF1.disabled = incompatible;
        if (incompatible) {
            if1Status.textContent = 'not available on +2A/+3 — use 48K, 128K, +2 or Pentagon';
        } else if (!romData['if1.rom']) {
            if1Status.textContent = '(if1.rom required)';
        } else {
            if1Status.textContent = '';
        }
        updateIfaceRomName('if1');
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
        notifyDiskSystems();
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
            setIfaceRomName('if1', file.name);
            const spectrum = getSpectrum();
            spectrum.memory.loadIF1Rom(data);
            updateIF1Status();
            notifyDiskSystems();
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

    // Opus Discovery toggle
    function updateOpusStatus() {
        // Gated on pagingModel exactly like the +D and IF1 — the Opus overlays
        // $0000-$3FFF, which +2A/+3 paging already owns.
        const incompatible = getSpectrum().profile.pagingModel === '+2a';
        chkOpus.disabled = incompatible;
        if (incompatible) {
            opusStatus.textContent = 'not available on +2A/+3 — use 48K, 128K, +2 or Pentagon';
        } else if (!romData['opus.rom']) {
            opusStatus.textContent = '(opus.rom required)';
        } else {
            opusStatus.textContent = '';
        }
        updateIfaceRomName('opus');
    }

    chkOpus.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.opusEnabled = chkOpus.checked;
        storageSet('zxm8_opus', chkOpus.checked);
        if (chkOpus.checked && romData['opus.rom'] && !spectrum.memory.hasOpusRom()) {
            spectrum.memory.loadOpusRom(romData['opus.rom']);
        }
        // Mutual exclusion with the +D: both page themselves in at $0008, and
        // both overlay $0000-$3FFF, so only one can own that window.
        if (chkOpus.checked && chkPlusD.checked) {
            chkPlusD.checked = false;
            spectrum.plusDEnabled = false;
            storageSet('zxm8_plusD', false);
            updatePlusDStatus();
            showMessage('Opus Discovery enabled — +D disabled (both page in at $0008)');
        }
        if (chkOpus.checked && chkDidaktik.checked) {
            chkDidaktik.checked = false;
            spectrum.didaktikEnabled = false;
            storageSet('zxm8_didaktik', false);
            updateDidaktikStatus();
            showMessage('Opus Discovery enabled — Didaktik 80 disabled (both overlay $0000-$3FFF)');
        }
        spectrum.updateBetaDiskPagingFlag();
        updateOpusStatus();
        notifyDiskSystems();
        showMessage(chkOpus.checked ?
            'Opus Discovery enabled (OPD disks)' :
            'Opus Discovery disabled');
    });

    // Opus ROM load button
    document.getElementById('btnLoadOpusRom').addEventListener('click', () => {
        document.getElementById('romOpusInput').click();
    });

    // Opus ROM file input
    document.getElementById('romOpusInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const data = new Uint8Array(ev.target.result);
            romData['opus.rom'] = data;
            setIfaceRomName('opus', file.name);
            const spectrum = getSpectrum();
            spectrum.memory.loadOpusRom(data);
            updateOpusStatus();
            notifyDiskSystems();
            showMessage('Opus Discovery ROM loaded (' + data.length + ' bytes)');
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';  // Allow re-loading same file
    });

    // Restore Opus setting from localStorage
    {
        const spectrum = getSpectrum();
        const savedOpus = storageGet('zxm8_opus') === 'true';
        chkOpus.checked = savedOpus;
        spectrum.opusEnabled = savedOpus;
        if (savedOpus && romData['opus.rom'] && !spectrum.memory.hasOpusRom()) {
            spectrum.memory.loadOpusRom(romData['opus.rom']);
        }
        spectrum.updateBetaDiskPagingFlag();
        updateOpusStatus();
    }

    // Didaktik 80 toggle
    function updateDidaktikStatus() {
        // Offered on the 48K only, unlike the other interfaces: the Didaktik pages
        // itself in at $0000, so on any 128K-family machine it takes over at reset
        // and that machine's own ROM never boots (red screen, no BASIC, no 128
        // menu) — reproduced on 128K and Pentagon. FUSE lists the peripheral for
        // the 48K only as well. That is convention plus our reproduction, not a
        // hardware datasheet; see docs/peripherals.md.
        const incompatible = getSpectrum().profile.pagingModel !== 'none';
        chkDidaktik.disabled = incompatible;
        if (incompatible) {
            didaktikStatus.textContent = '48K only — it pages in at $0000 and would stop a 128K booting';
        } else if (!romData['didaktik.rom']) {
            didaktikStatus.textContent = '(didaktik.rom required)';
        } else {
            didaktikStatus.textContent = '';
        }
        updateIfaceRomName('didaktik');
    }

    chkDidaktik.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.didaktikEnabled = chkDidaktik.checked;
        storageSet('zxm8_didaktik', chkDidaktik.checked);
        if (chkDidaktik.checked && romData['didaktik.rom'] && !spectrum.memory.hasDidaktikRom()) {
            spectrum.memory.loadDidaktikRom(romData['didaktik.rom']);
        }
        // Mutual exclusion with the other $0000 overlays. The Didaktik pages in
        // at $0000 itself, so it cannot share the bottom of memory with anything.
        if (chkDidaktik.checked) {
            for (const [chk, flag, key, name] of [
                [chkPlusD, 'plusDEnabled', 'zxm8_plusD', '+D'],
                [chkOpus, 'opusEnabled', 'zxm8_opus', 'Opus Discovery']
            ]) {
                if (chk.checked) {
                    chk.checked = false;
                    spectrum[flag] = false;
                    storageSet(key, false);
                    showMessage('Didaktik 80 enabled — ' + name + ' disabled (both page in at $0000-$3FFF)');
                }
            }
            updatePlusDStatus();
            updateOpusStatus();
        }
        spectrum.updateBetaDiskPagingFlag();
        updateDidaktikStatus();
        notifyDiskSystems();

        // Reset on the way in. The Didaktik sets its workspace up at $0000 and
        // nowhere else, so switching it on mid-session leaves MDOS with 2K of
        // zeros: the interface answers, then fails every disk command with
        // "Device unavailable". The Opus gets away without this because it
        // re-initialises from its $0048 interrupt hook every frame. Resetting is
        // also what you would do with the real thing — you would not plug an
        // interface into a running Spectrum.
        if (chkDidaktik.checked && spectrum._didaktikPagingEnabled) {
            spectrum.reset();
            showMessage('Didaktik 80 enabled (D40/D80 disks) — machine reset so MDOS can start');
        } else {
            showMessage(chkDidaktik.checked ?
                'Didaktik 80 enabled (D40/D80 disks)' :
                'Didaktik 80 disabled');
        }
    });

    document.getElementById('btnLoadDidaktikRom').addEventListener('click', () => {
        document.getElementById('romDidaktikInput').click();
    });

    document.getElementById('romDidaktikInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const data = new Uint8Array(ev.target.result);
            romData['didaktik.rom'] = data;
            setIfaceRomName('didaktik', file.name);
            const spectrum = getSpectrum();
            spectrum.memory.loadDidaktikRom(data);
            spectrum.updateBetaDiskPagingFlag();
            updateDidaktikStatus();
            notifyDiskSystems();
            // Same reason the checkbox resets: MDOS only builds its workspace at
            // $0000, so a ROM swapped in mid-session is never actually entered —
            // the machine keeps running with whatever the old one left behind and
            // every disk command answers "Device unavailable". Swapping the ROM on
            // real hardware means pulling the interface apart, so a reset is if
            // anything the gentler version.
            if (spectrum._didaktikPagingEnabled) {
                spectrum.reset();
                showMessage('Didaktik 80 ROM loaded (' + data.length +
                            ' bytes) — machine reset so MDOS can start');
            } else {
                showMessage('Didaktik 80 ROM loaded (' + data.length + ' bytes)');
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    });

    // Restore Didaktik setting from localStorage
    {
        const spectrum = getSpectrum();
        const savedDidaktik = storageGet('zxm8_didaktik') === 'true';
        chkDidaktik.checked = savedDidaktik;
        spectrum.didaktikEnabled = savedDidaktik;
        if (savedDidaktik && romData['didaktik.rom'] && !spectrum.memory.hasDidaktikRom()) {
            spectrum.memory.loadDidaktikRom(romData['didaktik.rom']);
        }
        spectrum.updateBetaDiskPagingFlag();
        updateDidaktikStatus();
    }

    // The ROM auto-load from roms/ is async and usually lands after this panel
    // is built, so paint the filenames once here and again whenever a status
    // refresh runs.
    updateAllIfaceRomNames();

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

    // Reflect whatever was restored from settings (the load block runs before the
    // buttons exist, so render once here).
    renderCustomKeys();

    return {
        saveInputSettings,
        getCustomKeys: () => ({ ...customKeys }),
        renderCustomKeys,
        updateBetaDiskStatus,
        updatePlusDStatus,
        updateIF1Status,
        getUpdateIF1Status: () => updateIF1Status,
        updateOpusStatus,
        updateDidaktikStatus,
        updateAllIfaceRomNames,
        updateMouseStatus,
        gamepadAPI,
        bootAPI
    };
}
