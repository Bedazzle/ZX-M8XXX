// display-settings.js — Audio, fullscreen, quicksave, display invert, ULAplus, palette (extracted from index.html)
import { storageGet, storageSet } from '../core/utils.js';
import { setAddrBase, setValueBase, setOpcodeBase } from '../core/addr-format.js';
import { createSaveSlots } from '../core/save-slots.js';

export function initDisplaySettings({ getSpectrum, showMessage, getHandleLoadResult, updateCanvasSize }) {

    // DOM elements
    const canvas = document.getElementById('screen');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const btnSound = document.getElementById('btnSound');
    const btnMute = document.getElementById('btnMute');
    const chkSound = document.getElementById('chkSound');
    const chkAY48k = document.getElementById('chkAY48k');
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    const stereoMode = document.getElementById('stereoMode');
    const btnFullscreen = document.getElementById('btnFullscreen');
    const fullscreenMode = document.getElementById('fullscreenMode');
    const screenWrapper = document.querySelector('.screen-wrapper');
    const borderSizeSelect = document.getElementById('borderSizeSelect');
    const overlaySelect = document.getElementById('overlaySelect');
    const chkInvertDisplay = document.getElementById('chkInvertDisplay');
    const chkLateTimings = document.getElementById('chkLateTimings');
    const chkULAplus = document.getElementById('chkULAplus');
    const ulaplusStatus = document.getElementById('ulaplusStatus');
    const ulaplusPalettePreview = document.getElementById('ulaplusPalettePreview');
    const ulaplusPaletteGrid = document.getElementById('ulaplusPaletteGrid');
    const paletteSelect = document.getElementById('paletteSelect');
    const palettePreview = document.getElementById('palettePreview');

    let loadedPalettes = null;

    // ===== Audio controls =====

    async function initAudioOnUserGesture() {
        const spectrum = getSpectrum();
        if (!spectrum.audio) {
            const audio = spectrum.initAudio();
            await audio.start();
            // Restore settings
            audio.setVolume(volumeSlider.value / 100);
            audio.setMuted(!chkSound.checked);
            spectrum.ay.stereoMode = stereoMode.value;
            spectrum.ay.updateStereoPanning();
        }
        // Ensure context is resumed (browser autoplay policy)
        if (spectrum.audio && spectrum.audio.context) {
            if (spectrum.audio.context.state === 'suspended') {
                try {
                    await spectrum.audio.context.resume();
                } catch (e) { /* ignore */ }
            }
        }
    }

    function updateSoundButtons(enabled) {
        const icon = enabled ? '🔊' : '🔇';
        btnSound.textContent = icon;
        btnMute.textContent = icon;
    }

    async function toggleSound(enable) {
        const spectrum = getSpectrum();
        if (enable) {
            await initAudioOnUserGesture();
            if (spectrum.audio) {
                spectrum.audio.setMuted(false);
            }
            showMessage('Sound enabled');
        } else {
            if (spectrum.audio) {
                spectrum.audio.setMuted(true);
            }
            showMessage('Sound disabled');
        }
        chkSound.checked = enable;
        updateSoundButtons(enable);
        storageSet('zxm8_sound', enable);
    }

    // Main sound button (in controls area)
    btnSound.addEventListener('click', async () => {
        await toggleSound(!chkSound.checked);
    });

    // Settings checkbox
    chkSound.addEventListener('change', async () => {
        await toggleSound(chkSound.checked);
    });

    chkAY48k.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.ay48kEnabled = chkAY48k.checked;
        showMessage(chkAY48k.checked ? 'AY enabled in 48K mode' : 'AY disabled in 48K mode');
        storageSet('zxm8_ay48k', chkAY48k.checked);
    });

    btnMute.addEventListener('click', async () => {
        await toggleSound(!chkSound.checked);
    });

    volumeSlider.addEventListener('input', () => {
        const spectrum = getSpectrum();
        const vol = volumeSlider.value;
        volumeValue.textContent = vol + '%';
        if (spectrum.audio) {
            spectrum.audio.setVolume(vol / 100);
        }
        storageSet('zxm8_volume', vol);
    });

    stereoMode.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.ay.stereoMode = stereoMode.value;
        spectrum.ay.updateStereoPanning();
        storageSet('zxm8_stereo', stereoMode.value);
        showMessage(`Stereo mode: ${stereoMode.value.toUpperCase()}`);
    });

    // ===== Fullscreen functionality =====

    const screenCanvas = document.getElementById('screen');
    let originalCanvasStyle = null;
    let originalOverlayStyle = null;

    function applyFullscreenScale() {
        // Wait a frame for fullscreen to be fully applied
        requestAnimationFrame(() => {
            const mode = fullscreenMode.value;
            const canvasWidth = screenCanvas.width;
            const canvasHeight = screenCanvas.height;
            // Get fullscreen element dimensions (more reliable than window.inner*)
            const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
            const fsWidth = fsElement ? fsElement.clientWidth : screen.width;
            const fsHeight = fsElement ? fsElement.clientHeight : screen.height;

            let newWidth, newHeight, left, top;

            if (mode === 'stretch') {
                // Stretch to fill screen (known issue: may not fill full width)
                newWidth = fsWidth;
                newHeight = fsHeight;
                left = 0;
                top = 0;
            } else if (mode === 'crisp') {
                // Crisp: use integer scaling for sharp pixels
                const maxScaleX = Math.floor(fsWidth / canvasWidth);
                const maxScaleY = Math.floor(fsHeight / canvasHeight);
                const scale = Math.max(1, Math.min(maxScaleX, maxScaleY));
                newWidth = canvasWidth * scale;
                newHeight = canvasHeight * scale;
                left = Math.round((fsWidth - newWidth) / 2);
                top = Math.round((fsHeight - newHeight) / 2);
            } else {
                // Fit: maintain aspect ratio, scale to maximum that fits
                const scaleX = fsWidth / canvasWidth;
                const scaleY = fsHeight / canvasHeight;
                const scale = Math.min(scaleX, scaleY);
                newWidth = Math.round(canvasWidth * scale);
                newHeight = Math.round(canvasHeight * scale);
                left = Math.round((fsWidth - newWidth) / 2);
                top = Math.round((fsHeight - newHeight) / 2);
            }

            // Apply to main canvas with absolute positioning
            screenCanvas.style.position = 'absolute';
            screenCanvas.style.left = left + 'px';
            screenCanvas.style.top = top + 'px';
            screenCanvas.style.width = newWidth + 'px';
            screenCanvas.style.height = newHeight + 'px';

            // Apply same to overlay canvas
            overlayCanvas.style.position = 'absolute';
            overlayCanvas.style.left = left + 'px';
            overlayCanvas.style.top = top + 'px';
            overlayCanvas.style.width = newWidth + 'px';
            overlayCanvas.style.height = newHeight + 'px';
        });
    }

    function restoreCanvasSize() {
        if (originalCanvasStyle) {
            screenCanvas.style.position = originalCanvasStyle.position;
            screenCanvas.style.left = originalCanvasStyle.left;
            screenCanvas.style.top = originalCanvasStyle.top;
            screenCanvas.style.width = originalCanvasStyle.width;
            screenCanvas.style.height = originalCanvasStyle.height;
        }
        if (originalOverlayStyle) {
            overlayCanvas.style.position = originalOverlayStyle.position;
            overlayCanvas.style.left = originalOverlayStyle.left;
            overlayCanvas.style.top = originalOverlayStyle.top;
            overlayCanvas.style.width = originalOverlayStyle.width;
            overlayCanvas.style.height = originalOverlayStyle.height;
        }
    }

    function toggleFullscreen() {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            // Exit fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        } else {
            // Save original canvas styles
            originalCanvasStyle = {
                position: screenCanvas.style.position,
                left: screenCanvas.style.left,
                top: screenCanvas.style.top,
                width: screenCanvas.style.width,
                height: screenCanvas.style.height
            };
            originalOverlayStyle = {
                position: overlayCanvas.style.position,
                left: overlayCanvas.style.left,
                top: overlayCanvas.style.top,
                width: overlayCanvas.style.width,
                height: overlayCanvas.style.height
            };
            // Enter fullscreen
            if (screenWrapper.requestFullscreen) {
                screenWrapper.requestFullscreen();
            } else if (screenWrapper.webkitRequestFullscreen) {
                screenWrapper.webkitRequestFullscreen();
            }
        }
    }

    btnFullscreen.addEventListener('click', toggleFullscreen);

    fullscreenMode.addEventListener('change', () => {
        storageSet('zxm8_fullscreen', fullscreenMode.value);
        // Update scale if currently in fullscreen
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            applyFullscreenScale();
        }
    });

    // Handle fullscreen change events
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            applyFullscreenScale();
        } else {
            restoreCanvasSize();
        }
    });
    document.addEventListener('webkitfullscreenchange', () => {
        if (document.webkitFullscreenElement) {
            applyFullscreenScale();
        } else {
            restoreCanvasSize();
        }
    });

    // F11 key for fullscreen toggle
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
            toggleFullscreen();
        }
    });

    // ===== Quicksave/Quickload (F2/F5) =====

    const QUICKSAVE_KEY = 'zxm8_quicksave';
    const SLOT_KEY = 'zxm8_slot_current';

    // Several save slots instead of the single quicksave. F2/F5 act on the current
    // one; Shift+F2 cycles. The old single quicksave migrates into slot 1 so nobody
    // loses the state they had.
    const saveSlots = createSaveSlots({
        storage: {
            get: (k) => storageGet(k, null),
            set: (k, v) => {
                // storageSet swallows failures, so write through to localStorage here:
                // a full store must be reported, not silently dropped.
                localStorage.setItem(k, v);
            },
            remove: (k) => localStorage.removeItem(k),
        },
        count: 9,
    });
    try { saveSlots.migrateLegacy(); } catch (e) { /* storage unavailable */ }
    let currentSlot = parseInt(storageGet(SLOT_KEY, '1'), 10) || 1;

    // Persistent indicator in the status bar: which slot F2/F5 will use, and
    // whether it holds anything (a toast on save was the only clue before).
    const slotStatusEl = document.getElementById('slotStatus');
    const slotInfoEl = document.getElementById('slotInfo');

    function updateSlotIndicator() {
        if (!slotStatusEl) return;
        const entry = saveSlots.list().find(s => s.index === currentSlot);
        const used = entry && entry.used;
        slotStatusEl.textContent = String(currentSlot) + (used ? '' : '·');   // 3 or 3·
        slotStatusEl.style.color = used ? 'var(--green)' : 'var(--text-secondary)';
        if (slotInfoEl) {
            slotInfoEl.title = used
                ? `Save slot ${currentSlot} — ${entry.machine || 'saved'}${entry.time ? ', ' + entry.time : ''}. `
                  + 'F5 loads, F2 overwrites, Shift+F2 (or click) switches slot.'
                : `Save slot ${currentSlot} is empty. F2 saves, Shift+F2 (or click) switches slot.`;
        }
    }

    if (slotStatusEl) {
        slotStatusEl.addEventListener('click', () => cycleSlot());
    }

    function slotLabel(i) {
        const e = saveSlots.list().find(s => s.index === i);
        if (!e || !e.used) return `slot ${i} (empty)`;
        return `slot ${i}${e.machine ? ' · ' + e.machine : ''}${e.time ? ' · ' + e.time : ''}`;
    }

    function cycleSlot() {
        currentSlot = saveSlots.next(currentSlot);
        storageSet(SLOT_KEY, String(currentSlot));
        updateSlotIndicator();
        showMessage('Now using ' + slotLabel(currentSlot));
        return currentSlot;
    }

    function quicksave(slot = currentSlot) {
        const spectrum = getSpectrum();
        try {
            const data = spectrum.saveSnapshot('szx');
            const res = saveSlots.save(slot, new Uint8Array(data), {
                machine: spectrum.machineType,
                title: (spectrum.lastLoadedName || ''),
            });
            if (!res.ok) { showMessage('Quicksave failed: ' + res.error, 'error'); return; }
            updateSlotIndicator();
            showMessage(`Saved to slot ${slot} (F5 to load, Shift+F2 to change slot)`, 'success');
            return;
        } catch (err) {
            showMessage('Quicksave failed: ' + err.message, 'error');
        }
    }

    async function quickload(slot = currentSlot) {
        const spectrum = getSpectrum();
        try {
            const entry = saveSlots.load(slot);
            if (!entry) {
                showMessage(`Slot ${slot} is empty (F2 to save, Shift+F2 to change slot)`, 'warning');
                return;
            }
            const bytes = entry.bytes;
            const blob = new Blob([bytes], { type: 'application/octet-stream' });
            const file = new File([blob], 'quicksave.szx');
            const result = await spectrum.loadFile(file);
            getHandleLoadResult()(result, 'Quicksave');
            updateCanvasSize();
            showMessage('Quickload successful');
        } catch (err) {
            showMessage('Quickload failed: ' + err.message, 'error');
        }
    }

    document.addEventListener('keydown', (e) => {
        // F2 = Quicksave, F5 = Quickload (spaced apart to avoid mistakes)
        // Ctrl+F5 is allowed through for hard refresh
        if (e.key === 'F2' && !e.ctrlKey && e.shiftKey) {
            e.preventDefault();
            cycleSlot();                       // Shift+F2 = pick a different slot
        } else if (e.key === 'F2' && !e.ctrlKey) {
            e.preventDefault();
            quicksave();
        } else if (e.key === 'F5' && !e.ctrlKey) {
            e.preventDefault(); // Prevent browser refresh
            quickload();
        }
    });

    // Restore fullscreen setting
    const savedFullscreenMode = storageGet('zxm8_fullscreen');
    if (savedFullscreenMode) {
        fullscreenMode.value = savedFullscreenMode;
    }

    // Restore audio settings from localStorage
    const savedSoundEnabled = storageGet('zxm8_sound') === 'true';
    const savedAY48k = storageGet('zxm8_ay48k') === 'true';
    const savedVolume = storageGet('zxm8_volume');
    const savedStereoMode = storageGet('zxm8_stereo');

    chkSound.checked = savedSoundEnabled;
    chkAY48k.checked = savedAY48k;
    getSpectrum().ay48kEnabled = savedAY48k;
    updateSoundButtons(savedSoundEnabled);

    if (savedVolume !== null) {
        volumeSlider.value = savedVolume;
        volumeValue.textContent = savedVolume + '%';
    }
    if (savedStereoMode) {
        stereoMode.value = savedStereoMode;
        getSpectrum().ay.stereoMode = savedStereoMode;
        getSpectrum().ay.updateStereoPanning();
    }

    // Auto-initialize audio on first user interaction if sound is enabled
    if (savedSoundEnabled) {
        const initAudioOnce = async () => {
            await initAudioOnUserGesture();
            document.removeEventListener('click', initAudioOnce);
            document.removeEventListener('keydown', initAudioOnce);
        };
        document.addEventListener('click', initAudioOnce, { once: true });
        document.addEventListener('keydown', initAudioOnce, { once: true });
    }

    // Ensure audio context resumes on any user interaction (some browsers are strict)
    const resumeAudioContext = async () => {
        const spectrum = getSpectrum();
        if (spectrum.audio && spectrum.audio.context &&
            spectrum.audio.context.state === 'suspended' && chkSound.checked) {
            try {
                await spectrum.audio.context.resume();
            } catch (e) {
                // Ignore errors
            }
        }
    };
    document.addEventListener('click', resumeAudioContext);
    document.addEventListener('keydown', resumeAudioContext);

    // Overlay mode dropdown
    getSpectrum().setOverlayMode(overlaySelect.value);  // Initialize from select default
    overlaySelect.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.setOverlayMode(overlaySelect.value);
        spectrum.redraw();
    });

    // Border size preset
    borderSizeSelect.addEventListener('change', () => {
        const spectrum = getSpectrum();
        if (spectrum.ula.setBorderPreset(borderSizeSelect.value)) {
            spectrum.updateDisplayDimensions();
            updateCanvasSize();
            spectrum.redraw();
        }
        storageSet('zxm8_border', borderSizeSelect.value);
        const option = borderSizeSelect.options[borderSizeSelect.selectedIndex];
        showMessage('Border: ' + option.text);
    });

    // ===== Invert display handling =====

    function applyInvertDisplay(invert) {
        canvas.style.filter = invert ? 'invert(1)' : '';
        if (overlayCanvas) overlayCanvas.style.filter = invert ? 'invert(1)' : '';
    }

    // Restore saved invert setting
    const savedInvert = storageGet('zxm8_invert') === 'true';
    chkInvertDisplay.checked = savedInvert;
    applyInvertDisplay(savedInvert);

    chkInvertDisplay.addEventListener('change', () => {
        applyInvertDisplay(chkInvertDisplay.checked);
        storageSet('zxm8_invert', chkInvertDisplay.checked);
        showMessage(chkInvertDisplay.checked ? 'Display inverted' : 'Display normal');
    });

    // ===== Late timing checkbox =====

    const savedLateTimings = storageGet('zxm8_lateTiming') === 'true';  // Default false
    chkLateTimings.checked = savedLateTimings;
    getSpectrum().setLateTimings(savedLateTimings);

    chkLateTimings.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.setLateTimings(chkLateTimings.checked);
        storageSet('zxm8_lateTiming', chkLateTimings.checked);
        showMessage(chkLateTimings.checked ? 'Late timings enabled' : 'Early timings enabled');
    });

    // ===== ULA snow checkbox =====
    // Off by default: it is a hardware fault worth *seeing*, not one to inflict on
    // every session. The status line says when the machine can't produce it, so
    // ticking the box on a Pentagon doesn't look broken.
    const chkUlaSnow = document.getElementById('chkUlaSnow');
    const ulaSnowStatus = document.getElementById('ulaSnowStatus');

    // Only says something when the answer isn't in the tooltip: that this machine
    // cannot produce the effect at all. When it can, the checkbox speaks for itself.
    function updateUlaSnowStatus() {
        if (!ulaSnowStatus) return;
        const spectrum = getSpectrum();
        const profile = spectrum.memory && spectrum.memory.profile;
        const supported = !!(profile && profile.hasSnow);
        ulaSnowStatus.textContent = (chkUlaSnow && chkUlaSnow.checked && !supported)
            ? `${spectrum.machineType.toUpperCase()} has no snow — its ULA does not do it`
            : '';
    }

    if (chkUlaSnow) {
        const savedSnow = storageGet('zxm8_ulaSnow') === 'true';   // Default false
        chkUlaSnow.checked = savedSnow;
        getSpectrum().ula.setSnowEffect(savedSnow);
        updateUlaSnowStatus();

        chkUlaSnow.addEventListener('change', () => {
            getSpectrum().ula.setSnowEffect(chkUlaSnow.checked);
            storageSet('zxm8_ulaSnow', chkUlaSnow.checked);
            updateUlaSnowStatus();
            showMessage(chkUlaSnow.checked ? 'ULA snow enabled' : 'ULA snow disabled');
        });
    }

    // ===== ULA ink/paper edge skew checkbox =====
    // On by default, unlike snow: this is what the Ferranti part does all the time,
    // not a fault you go looking for. Ticking it only ever restores the machine's
    // own value, so a +2A or a Pentagon stays pixel-exact either way.
    const chkInkSkew = document.getElementById('chkInkSkew');
    const inkSkewStatus = document.getElementById('inkSkewStatus');

    function updateInkSkewStatus() {
        if (!inkSkewStatus) return;
        const spectrum = getSpectrum();
        const profile = spectrum.memory && spectrum.memory.profile;
        const supported = !!(profile && profile.ulaInkSkew);
        inkSkewStatus.textContent = (chkInkSkew && chkInkSkew.checked && !supported)
            ? `${spectrum.machineType.toUpperCase()} does not skew — Amstrad's gate array, not the Ferranti ULA`
            : '';
    }

    if (chkInkSkew) {
        const savedSkew = storageGet('zxm8_inkSkew') !== 'false';   // Default true
        chkInkSkew.checked = savedSkew;
        getSpectrum().ula.setInkSkew(savedSkew ? null : 0);
        updateInkSkewStatus();

        chkInkSkew.addEventListener('change', () => {
            getSpectrum().ula.setInkSkew(chkInkSkew.checked ? null : 0);
            storageSet('zxm8_inkSkew', chkInkSkew.checked);
            updateInkSkewStatus();
            showMessage(chkInkSkew.checked ? 'ULA ink edge skew enabled' : 'ULA ink edge skew disabled');
        });
    }

    // ===== PAL composite (RF) simulation checkbox =====
    // Off by default: it is a whole-frame filter, and it is only the truth for a
    // machine plugged into a TV — someone using the RGB/SCART output sees the clean
    // picture we draw without it.
    const chkPalComposite = document.getElementById('chkPalComposite');
    const palCompositeStatus = document.getElementById('palCompositeStatus');

    function updatePalCompositeStatus() {
        if (!palCompositeStatus) return;
        const spectrum = getSpectrum();
        const profile = spectrum.memory && spectrum.memory.profile;
        const locked = !!(profile && profile.ulaSubcarrierLock);
        palCompositeStatus.textContent = (chkPalComposite && chkPalComposite.checked && !locked)
            ? `${spectrum.machineType.toUpperCase()} does not lock its pixel clock to the subcarrier — dot crawl, no stable artifact colour`
            : '';
    }

    if (chkPalComposite) {
        const savedPal = storageGet('zxm8_palComposite') === 'true';   // Default false
        chkPalComposite.checked = savedPal;
        getSpectrum().ula.setPalComposite(savedPal);
        updatePalCompositeStatus();

        chkPalComposite.addEventListener('change', () => {
            getSpectrum().ula.setPalComposite(chkPalComposite.checked);
            storageSet('zxm8_palComposite', chkPalComposite.checked);
            updatePalCompositeStatus();
            showMessage(chkPalComposite.checked ? 'PAL composite simulation enabled' : 'PAL composite simulation disabled');
        });
    }

    // ===== Pentagon attribute prefetch checkbox =====

    const chkPentagonPrefetch = document.getElementById('chkPentagonPrefetch');
    const savedPentagonPrefetch = storageGet('zxm8_pentagonPrefetch') === 'true';  // Default false
    chkPentagonPrefetch.checked = savedPentagonPrefetch;
    getSpectrum().setPentagonAttrOffset(savedPentagonPrefetch ? -5 : 0);

    chkPentagonPrefetch.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.setPentagonAttrOffset(chkPentagonPrefetch.checked ? -5 : 0);
        storageSet('zxm8_pentagonPrefetch', chkPentagonPrefetch.checked);
        showMessage(chkPentagonPrefetch.checked ? 'Pentagon attr prefetch enabled' : 'Pentagon attr prefetch disabled');
    });

    // ===== ULAplus handling =====

    // Initialize ULAplus palette grid (4 rows x 16 colors)
    for (let i = 0; i < 64; i++) {
        const cell = document.createElement('div');
        cell.className = 'ulaplus-palette-cell';
        cell.dataset.index = i;
        ulaplusPaletteGrid.appendChild(cell);
    }

    function updateULAplusStatus() {
        const ula = getSpectrum().ula;
        if (!ula.ulaplus.enabled) {
            ulaplusStatus.textContent = '';
            ulaplusPalettePreview.classList.add('hidden');
        } else if (ula.ulaplus.paletteEnabled) {
            ulaplusStatus.textContent = '(palette active)';
            ulaplusPalettePreview.classList.remove('hidden');
            updateULAplusPalettePreview();
        } else {
            ulaplusStatus.textContent = '(hardware present)';
            ulaplusPalettePreview.classList.add('hidden');
        }
    }

    function updateULAplusPalettePreview() {
        const palette = getSpectrum().ula.ulaplus.palette;
        const cells = ulaplusPaletteGrid.children;
        for (let i = 0; i < 64; i++) {
            const grb = palette[i];
            // Convert GRB 332 to RGB
            const g3 = (grb >> 5) & 0x07;
            const r3 = (grb >> 2) & 0x07;
            const b2 = grb & 0x03;
            const r = (r3 << 5) | (r3 << 2) | (r3 >> 1);
            const g = (g3 << 5) | (g3 << 2) | (g3 >> 1);
            const b = (b2 << 6) | (b2 << 4) | (b2 << 2) | b2;
            cells[i].style.backgroundColor = `rgb(${r},${g},${b})`;
        }
    }

    const savedULAplus = storageGet('zxm8_ulaplus') === 'true';
    chkULAplus.checked = savedULAplus;
    getSpectrum().ula.ulaplus.enabled = savedULAplus;
    updateULAplusStatus();

    chkULAplus.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.ula.ulaplus.enabled = chkULAplus.checked;
        storageSet('zxm8_ulaplus', chkULAplus.checked);
        // Don't reset palette when toggling - preserve game's palette data
        updateULAplusStatus();
        spectrum.redraw(); // Immediately apply palette change
        showMessage(chkULAplus.checked ? 'ULA+ enabled' : 'ULA+ disabled');
    });

    // Reset ULAplus palette to defaults
    document.getElementById('btnResetULAplus').addEventListener('click', () => {
        const spectrum = getSpectrum();
        spectrum.ula.resetULAplus();
        updateULAplusStatus();
        spectrum.redraw();
        showMessage('ULAplus palette reset');
    });

    // Update ULAplus status periodically when palette is active
    const ulaPlusStatusInterval = setInterval(() => {
        if (getSpectrum().ula.ulaplus.enabled && getSpectrum().ula.ulaplus.paletteEnabled) {
            updateULAplusStatus();
        }
    }, 500);

    // ===== Palette handling =====

    const paletteColorPicker = document.getElementById('paletteColorPicker');
    const btnResetPalette = document.getElementById('btnResetPalette');
    const btnSavePalette = document.getElementById('btnSavePalette');
    const savedPaletteSelect = document.getElementById('savedPaletteSelect');
    const btnLoadSavedPalette = document.getElementById('btnLoadSavedPalette');
    const btnDeleteSavedPalette = document.getElementById('btnDeleteSavedPalette');

    async function loadPalettes() {
        try {
            const response = await fetch('data/palettes.json');
            const data = await response.json();
            loadedPalettes = data.palettes;

            // Populate dropdown
            paletteSelect.innerHTML = '';
            loadedPalettes.forEach(palette => {
                const option = document.createElement('option');
                option.value = palette.id;
                option.textContent = palette.name;
                paletteSelect.appendChild(option);
            });

            // Add "Custom (edited)" option
            const customOption = document.createElement('option');
            customOption.value = 'custom';
            customOption.textContent = 'Custom (edited)';
            paletteSelect.appendChild(customOption);

            // Apply saved palette or default
            const savedPalette = storageGet('zxm8_palette', 'default');
            paletteSelect.value = savedPalette;
            applyPalette(savedPalette);

            // Populate saved palettes dropdown
            refreshSavedPalettesDropdown();
        } catch (e) {
            console.error('Failed to load palettes:', e);
        }
    }

    function applyPalette(paletteId) {
        if (!loadedPalettes) return;
        const spectrum = getSpectrum();

        let colors;
        if (paletteId === 'custom') {
            // Load custom palette from localStorage
            const saved = storageGet('zxm8_customPalette');
            if (saved) {
                try {
                    colors = JSON.parse(saved);
                } catch (e) {
                    // Fallback to default if corrupt
                    colors = null;
                }
            }
            if (!colors) {
                // No custom palette stored — fall back to default
                const defaultPalette = loadedPalettes.find(p => p.id === 'default');
                if (defaultPalette) colors = defaultPalette.colors;
                else return;
            }
            paletteSelect.value = 'custom';
        } else {
            const palette = loadedPalettes.find(p => p.id === paletteId);
            if (!palette) return;
            colors = palette.colors;
            paletteSelect.value = paletteId;
        }

        // Update ULA palette
        if (spectrum.ula) {
            spectrum.ula.palette = colors.map(hex => {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return [r, g, b, 255]; // [R, G, B, A] array format
            });
            spectrum.ula.updatePalette32(); // Recalculate 32-bit palette for rendering
            spectrum.redraw();
        }

        // Update preview
        updatePalettePreview(colors);
    }

    // CSS color string for <input type="color"> (lowercase #rrggbb)
    function rgbToHex(r, g, b) {
        return '#' + r.toString(16).padStart(2, '0') +
                     g.toString(16).padStart(2, '0') +
                     b.toString(16).padStart(2, '0');
    }

    function getCurrentPaletteColors() {
        const ula = getSpectrum().ula;
        if (!ula) return null;
        return ula.palette.map(c => rgbToHex(c[0], c[1], c[2]));
    }

    function updatePalettePreview(colors) {
        const colorElements = palettePreview.querySelectorAll('.palette-color');
        colorElements.forEach(el => {
            const index = parseInt(el.dataset.index);
            const isBright = el.dataset.bright === 'true';
            const colorIndex = isBright ? index + 8 : index;
            if (colors[colorIndex]) {
                el.style.backgroundColor = colors[colorIndex];
                el.title = `${index}: ${colors[colorIndex]}`;
            }
        });
    }

    paletteSelect.addEventListener('change', () => {
        applyPalette(paletteSelect.value);
        storageSet('zxm8_palette', paletteSelect.value);
        showMessage(`Palette: ${paletteSelect.options[paletteSelect.selectedIndex].text}`);
    });

    // ===== Standard palette click-to-edit =====

    palettePreview.addEventListener('click', (e) => {
        const cell = e.target.closest('.palette-color');
        if (!cell) return;

        const index = parseInt(cell.dataset.index);
        const isBright = cell.dataset.bright === 'true';
        const colorIndex = isBright ? index + 8 : index;

        // Read current color from ULA palette
        const ula = getSpectrum().ula;
        if (!ula) return;
        const c = ula.palette[colorIndex];
        const hex = rgbToHex(c[0], c[1], c[2]);

        paletteColorPicker.value = hex;
        paletteColorPicker.dataset.editingMode = 'standard';
        paletteColorPicker.dataset.colorIndex = colorIndex;
        paletteColorPicker.click();
    });

    // ===== ULA+ palette click-to-edit =====

    function rgbToGrb332(r, g, b) {
        const r3 = Math.round(r * 7 / 255);
        const g3 = Math.round(g * 7 / 255);
        const b2 = Math.round(b * 3 / 255);
        return (g3 << 5) | (r3 << 2) | b2;
    }

    ulaplusPaletteGrid.addEventListener('click', (e) => {
        const cell = e.target.closest('.ulaplus-palette-cell');
        if (!cell) return;

        const ula = getSpectrum().ula;
        if (!ula.ulaplus.enabled || !ula.ulaplus.paletteEnabled) {
            showMessage('ULA+ palette not active', 'warning');
            return;
        }

        const index = parseInt(cell.dataset.index);
        const grb = ula.ulaplus.palette[index];

        // Convert GRB 332 to RGB hex for picker
        const g3 = (grb >> 5) & 0x07;
        const r3 = (grb >> 2) & 0x07;
        const b2 = grb & 0x03;
        const r = (r3 << 5) | (r3 << 2) | (r3 >> 1);
        const g = (g3 << 5) | (g3 << 2) | (g3 >> 1);
        const b = (b2 << 6) | (b2 << 4) | (b2 << 2) | b2;
        const hex = rgbToHex(r, g, b);

        paletteColorPicker.value = hex;
        paletteColorPicker.dataset.editingMode = 'ulaplus';
        paletteColorPicker.dataset.colorIndex = index;
        paletteColorPicker.click();
    });

    // ===== Color picker handler (shared) =====

    paletteColorPicker.addEventListener('input', () => {
        const hex = paletteColorPicker.value;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const mode = paletteColorPicker.dataset.editingMode;
        const colorIndex = parseInt(paletteColorPicker.dataset.colorIndex);
        const spectrum = getSpectrum();

        if (mode === 'standard') {
            spectrum.ula.palette[colorIndex] = [r, g, b, 255];
            spectrum.ula.updatePalette32();
            spectrum.redraw();

            // Switch dropdown to "Custom (edited)"
            paletteSelect.value = 'custom';
            storageSet('zxm8_palette', 'custom');

            // Save custom palette to localStorage
            const colors = getCurrentPaletteColors();
            storageSet('zxm8_customPalette', JSON.stringify(colors));

            // Update preview
            updatePalettePreview(colors);
        } else if (mode === 'ulaplus') {
            // Snap to GRB 332
            const grb = rgbToGrb332(r, g, b);
            spectrum.ula.ulaplus.palette[colorIndex] = grb;
            spectrum.ula.updateULAplusPalette32();
            spectrum.redraw();
            updateULAplusPalettePreview();
        }
    });

    // ===== Reset palette button =====

    btnResetPalette.addEventListener('click', () => {
        const currentId = paletteSelect.value;
        if (currentId === 'custom') {
            applyPalette('default');
            storageSet('zxm8_palette', 'default');
            showMessage('Palette reset to Default');
        } else {
            applyPalette(currentId);
            showMessage('Palette reset');
        }
    });

    // ===== Saved palettes (save/load/delete) =====

    function getSavedPalettes() {
        const raw = storageGet('zxm8_savedPalettes');
        if (!raw) return [];
        try { return JSON.parse(raw); } catch (e) { return []; }
    }

    function setSavedPalettes(palettes) {
        storageSet('zxm8_savedPalettes', JSON.stringify(palettes));
    }

    function refreshSavedPalettesDropdown() {
        const palettes = getSavedPalettes();
        savedPaletteSelect.innerHTML = '';
        if (palettes.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '(no saved palettes)';
            savedPaletteSelect.appendChild(opt);
        } else {
            palettes.forEach((p, i) => {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = p.name + (p.type === 'ulaplus' ? ' [ULA+]' : '');
                savedPaletteSelect.appendChild(opt);
            });
        }
    }

    btnSavePalette.addEventListener('click', () => {
        const name = prompt('Save palette as:');
        if (!name || !name.trim()) return;

        const spectrum = getSpectrum();
        const palettes = getSavedPalettes();
        const ula = spectrum.ula;

        // Determine if saving standard or ULA+ palette
        if (ula.ulaplus.enabled && ula.ulaplus.paletteEnabled) {
            // Save ULA+ palette
            palettes.push({
                name: name.trim(),
                type: 'ulaplus',
                colors: Array.from(ula.ulaplus.palette)
            });
        } else {
            // Save standard palette
            palettes.push({
                name: name.trim(),
                type: 'standard',
                colors: getCurrentPaletteColors()
            });
        }

        setSavedPalettes(palettes);
        refreshSavedPalettesDropdown();
        savedPaletteSelect.value = palettes.length - 1;
        showMessage(`Palette "${name.trim()}" saved`);
    });

    btnLoadSavedPalette.addEventListener('click', () => {
        const palettes = getSavedPalettes();
        const idx = parseInt(savedPaletteSelect.value);
        if (isNaN(idx) || !palettes[idx]) return;

        const saved = palettes[idx];
        const spectrum = getSpectrum();

        if (saved.type === 'ulaplus') {
            if (!spectrum.ula.ulaplus.enabled || !spectrum.ula.ulaplus.paletteEnabled) {
                showMessage('Enable ULA+ palette first', 'warning');
                return;
            }
            for (let i = 0; i < saved.colors.length && i < 64; i++) {
                spectrum.ula.ulaplus.palette[i] = saved.colors[i];
            }
            spectrum.ula.updateULAplusPalette32();
            spectrum.redraw();
            updateULAplusPalettePreview();
            showMessage(`ULA+ palette "${saved.name}" loaded`);
        } else {
            // Standard palette — apply as custom
            storageSet('zxm8_customPalette', JSON.stringify(saved.colors));
            paletteSelect.value = 'custom';
            storageSet('zxm8_palette', 'custom');
            applyPalette('custom');
            showMessage(`Palette "${saved.name}" loaded`);
        }
    });

    btnDeleteSavedPalette.addEventListener('click', () => {
        const palettes = getSavedPalettes();
        const idx = parseInt(savedPaletteSelect.value);
        if (isNaN(idx) || !palettes[idx]) return;

        const name = palettes[idx].name;
        palettes.splice(idx, 1);
        setSavedPalettes(palettes);
        refreshSavedPalettesDropdown();
        showMessage(`Palette "${name}" deleted`);
    });

    // Load palettes on startup
    loadPalettes();

    // ===== Debugger display settings =====

    const chkFlowBreakSpacing = document.getElementById('chkFlowBreakSpacing');
    const chkShowPCCursor = document.getElementById('chkShowPCCursor');
    const chkFollowPC = document.getElementById('chkFollowPC');
    const chkAsmComments = document.getElementById('chkAsmComments');
    const chkUserComments = document.getElementById('chkUserComments');

    // Restore (default true for all)
    if (chkFlowBreakSpacing) chkFlowBreakSpacing.checked = storageGet('zxm8_flowBreakSpacing') !== 'false';
    if (chkShowPCCursor) chkShowPCCursor.checked = storageGet('zxm8_showPCCursor') !== 'false';
    if (chkAsmComments) chkAsmComments.checked = storageGet('zxm8_showAsmComments') !== 'false';
    if (chkUserComments) chkUserComments.checked = storageGet('zxm8_showUserComments') !== 'false';
    if (chkFollowPC) {
        chkFollowPC.checked = storageGet('zxm8_followPC') !== 'false';
        // Notify listeners (disasm toolbar disables Go/PC/address while following)
        chkFollowPC.dispatchEvent(new Event('change'));
    }

    // Persist on change
    if (chkFlowBreakSpacing) chkFlowBreakSpacing.addEventListener('change', () => {
        storageSet('zxm8_flowBreakSpacing', chkFlowBreakSpacing.checked);
    });
    if (chkShowPCCursor) chkShowPCCursor.addEventListener('change', () => {
        storageSet('zxm8_showPCCursor', chkShowPCCursor.checked);
    });
    if (chkAsmComments) chkAsmComments.addEventListener('change', () => {
        storageSet('zxm8_showAsmComments', chkAsmComments.checked);
    });
    if (chkUserComments) chkUserComments.addEventListener('change', () => {
        storageSet('zxm8_showUserComments', chkUserComments.checked);
    });
    if (chkFollowPC) chkFollowPC.addEventListener('change', () => {
        storageSet('zxm8_followPC', chkFollowPC.checked);
    });

    // ===== Address base (hex / decimal) =====
    // Display only: it changes how an address is written, never what is stored or
    // exported. Applied before the first render so the debugger opens in the base
    // it was left in; panels redraw themselves through onNumberBaseChange().
    const chkDecAddresses = document.getElementById('chkDecAddresses');
    // Also stamped on <html>, so CSS can size a boxed field for the wider base.
    // A decimal register changes width as it counts (999 -> 1000), which would
    // make the whole register block twitch on every step without a floor.
    const applyAddrBase = (dec) => {
        setAddrBase(dec ? 'dec' : 'hex');
        document.documentElement.dataset.addrBase = dec ? 'dec' : 'hex';
    };
    const applyValueBase = (dec) => {
        setValueBase(dec ? 'dec' : 'hex');
        document.documentElement.dataset.valueBase = dec ? 'dec' : 'hex';
    };
    const applyOpcodeBase = (dec) => {
        setOpcodeBase(dec ? 'dec' : 'hex');
        document.documentElement.dataset.opcodeBase = dec ? 'dec' : 'hex';
    };
    if (chkDecAddresses) {
        chkDecAddresses.checked = storageGet('zxm8_decAddresses') === 'true';   // Default hex
        applyAddrBase(chkDecAddresses.checked);
        chkDecAddresses.addEventListener('change', () => {
            storageSet('zxm8_decAddresses', chkDecAddresses.checked);
            applyAddrBase(chkDecAddresses.checked);
            showMessage(chkDecAddresses.checked ? 'Addresses: decimal' : 'Addresses: hex');
        });
    }

    // A byte is not an address, so it gets its own switch: a hex dump with decimal
    // addresses is sensible, and so is a decimal dump with hex addresses.
    const chkDecValues = document.getElementById('chkDecValues');
    if (chkDecValues) {
        chkDecValues.checked = storageGet('zxm8_decValues') === 'true';   // Default hex
        applyValueBase(chkDecValues.checked);
        chkDecValues.addEventListener('change', () => {
            storageSet('zxm8_decValues', chkDecValues.checked);
            applyValueBase(chkDecValues.checked);
            showMessage(chkDecValues.checked ? 'Values: decimal' : 'Values: hex');
        });
    }

    // And a third for the opcode bytes: decimal-only assembly is a real background,
    // and the byte column is where that shows.
    const chkDecOpcodes = document.getElementById('chkDecOpcodes');
    if (chkDecOpcodes) {
        chkDecOpcodes.checked = storageGet('zxm8_decOpcodes') === 'true';   // Default hex
        applyOpcodeBase(chkDecOpcodes.checked);
        chkDecOpcodes.addEventListener('change', () => {
            storageSet('zxm8_decOpcodes', chkDecOpcodes.checked);
            applyOpcodeBase(chkDecOpcodes.checked);
            showMessage(chkDecOpcodes.checked ? 'Opcodes: decimal' : 'Opcodes: hex');
        });
    }

    // ===== Step Over T-state limit =====

    const stepOverMaxTstates = document.getElementById('stepOverMaxTstates');
    if (stepOverMaxTstates) {
        stepOverMaxTstates.value = storageGet('zxm8_stepOverLimit') || '80000';
        stepOverMaxTstates.addEventListener('change', () => {
            const val = parseInt(stepOverMaxTstates.value);
            if (val > 0) {
                storageSet('zxm8_stepOverLimit', val.toString());
            }
        });
    }

    // ===== Public API =====

    // Show the restored slot as soon as the app starts
    updateSlotIndicator();

    return {
        applyPalette,
        updateULAplusStatus,
        updateUlaSnowStatus,
        updateInkSkewStatus,
        updatePalCompositeStatus,
        quicksave,
        quickload,
        saveSlots,
        cycleSlot,
        updateSlotIndicator,
        getCurrentSlot: () => currentSlot,
        applyInvertDisplay,
        initAudioOnUserGesture,
        toggleSound,
        getPaletteValue: () => paletteSelect?.value || 'default',
        hasLoadedPalettes: () => !!loadedPalettes,
        getStepOverLimit: () => parseInt(stepOverMaxTstates?.value) || 80000,
        setStepOverLimit(val) {
            const v = parseInt(val);
            if (v > 0 && stepOverMaxTstates) {
                stepOverMaxTstates.value = v;
                storageSet('zxm8_stepOverLimit', v.toString());
            }
        },
        destroy() { clearInterval(ulaPlusStatusInterval); }
    };
}
