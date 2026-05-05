// display-settings.js — Audio, fullscreen, quicksave, display invert, ULAplus, palette (extracted from index.html)
import { storageGet, storageSet } from '../core/utils.js';

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

    function quicksave() {
        const spectrum = getSpectrum();
        try {
            const data = spectrum.saveSnapshot('szx');
            // Convert to base64 for localStorage
            let binary = '';
            const bytes = new Uint8Array(data);
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            storageSet(QUICKSAVE_KEY, base64);
            storageSet(QUICKSAVE_KEY + '-machine', spectrum.machineType);
            storageSet(QUICKSAVE_KEY + '-time', new Date().toLocaleString());
            showMessage('Quicksave (F5 to load)', 'success');
        } catch (err) {
            showMessage('Quicksave failed: ' + err.message, 'error');
        }
    }

    async function quickload() {
        const spectrum = getSpectrum();
        try {
            const base64 = storageGet(QUICKSAVE_KEY);
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
        if (e.key === 'F2' && !e.ctrlKey) {
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

            // Apply saved palette or default
            const savedPalette = storageGet('zxm8_palette', 'default');
            paletteSelect.value = savedPalette;
            applyPalette(savedPalette);
        } catch (e) {
            console.error('Failed to load palettes:', e);
        }
    }

    function applyPalette(paletteId) {
        if (!loadedPalettes) return;
        const spectrum = getSpectrum();

        const palette = loadedPalettes.find(p => p.id === paletteId);
        if (!palette) return;

        // Sync dropdown
        paletteSelect.value = paletteId;

        // Update ULA palette
        if (spectrum.ula) {
            spectrum.ula.palette = palette.colors.map(hex => {
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return [r, g, b, 255]; // [R, G, B, A] array format
            });
            spectrum.ula.updatePalette32(); // Recalculate 32-bit palette for rendering
            spectrum.redraw();
        }

        // Update preview
        updatePalettePreview(palette.colors);
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

    // Load palettes on startup
    loadPalettes();

    // ===== Debugger display settings =====

    const chkFlowBreakSpacing = document.getElementById('chkFlowBreakSpacing');
    const chkShowPCCursor = document.getElementById('chkShowPCCursor');
    const chkFollowPC = document.getElementById('chkFollowPC');

    // Restore (default true for all)
    if (chkFlowBreakSpacing) chkFlowBreakSpacing.checked = storageGet('zxm8_flowBreakSpacing') !== 'false';
    if (chkShowPCCursor) chkShowPCCursor.checked = storageGet('zxm8_showPCCursor') !== 'false';
    if (chkFollowPC) chkFollowPC.checked = storageGet('zxm8_followPC') !== 'false';

    // Persist on change
    if (chkFlowBreakSpacing) chkFlowBreakSpacing.addEventListener('change', () => {
        storageSet('zxm8_flowBreakSpacing', chkFlowBreakSpacing.checked);
    });
    if (chkShowPCCursor) chkShowPCCursor.addEventListener('change', () => {
        storageSet('zxm8_showPCCursor', chkShowPCCursor.checked);
    });
    if (chkFollowPC) chkFollowPC.addEventListener('change', () => {
        storageSet('zxm8_followPC', chkFollowPC.checked);
    });

    // ===== Public API =====

    return {
        applyPalette,
        updateULAplusStatus,
        quicksave,
        quickload,
        applyInvertDisplay,
        initAudioOnUserGesture,
        toggleSound,
        getPaletteValue: () => paletteSelect?.value || 'default',
        hasLoadedPalettes: () => !!loadedPalettes,
        destroy() { clearInterval(ulaPlusStatusInterval); }
    };
}
