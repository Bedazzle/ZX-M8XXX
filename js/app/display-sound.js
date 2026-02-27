// Display & Sound — audio controls, ULAplus, fullscreen, palette, zoom, canvas sizing
// Extracted from index.html lines ~32229-32760 + ~34423-34490

// ========== Audio Controls ==========

export async function initAudioOnUserGesture(spectrum) {
    const volumeSlider = document.getElementById('volumeSlider');
    const chkSound = document.getElementById('chkSound');
    const stereoMode = document.getElementById('stereoMode');

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

export function updateSoundButtons(enabled) {
    const btnSound = document.getElementById('btnSound');
    const btnMute = document.getElementById('btnMute');
    const icon = enabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
    btnSound.textContent = icon;
    btnMute.textContent = icon;
}

export async function toggleSound(enable, spectrum, showMessage) {
    const chkSound = document.getElementById('chkSound');
    if (enable) {
        await initAudioOnUserGesture(spectrum);
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
    localStorage.setItem('zx-sound-enabled', enable);
}

// ========== Fullscreen ==========

let originalCanvasStyle = null;
let originalOverlayStyle = null;

export function applyFullscreenScale() {
    const screenCanvas = document.getElementById('screen');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const fullscreenMode = document.getElementById('fullscreenMode');

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

export function restoreCanvasSize() {
    const screenCanvas = document.getElementById('screen');
    const overlayCanvas = document.getElementById('overlayCanvas');

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

export function toggleFullscreen() {
    const screenCanvas = document.getElementById('screen');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const screenWrapper = document.querySelector('.screen-wrapper');

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

// ========== ULAplus ==========

// Initialize ULAplus palette grid (4 rows x 16 colors = 64 cells)
export function initULAplusPaletteGrid() {
    const grid = document.getElementById('ulaplusPaletteGrid');
    if (grid && grid.children.length === 0) {
        for (let i = 0; i < 64; i++) {
            const cell = document.createElement('div');
            cell.className = 'ulaplus-palette-cell';
            grid.appendChild(cell);
        }
    }
}

export function updateULAplusStatus(spectrum) {
    const ulaplusStatus = document.getElementById('ulaplusStatus');
    const ulaplusPalettePreview = document.getElementById('ulaplusPalettePreview');

    const ula = spectrum.ula;
    if (!ula.ulaplus.enabled) {
        ulaplusStatus.textContent = '';
        ulaplusPalettePreview.classList.add('hidden');
    } else if (ula.ulaplus.paletteEnabled) {
        ulaplusStatus.textContent = '(palette active)';
        ulaplusPalettePreview.classList.remove('hidden');
        updateULAplusPalettePreview(spectrum);
    } else {
        ulaplusStatus.textContent = '(hardware present)';
        ulaplusPalettePreview.classList.add('hidden');
    }
}

export function updateULAplusPalettePreview(spectrum) {
    const ulaplusPaletteGrid = document.getElementById('ulaplusPaletteGrid');
    const palette = spectrum.ula.ulaplus.palette;
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

// ========== Palette ==========

let loadedPalettes = null;

export async function loadPalettes(spectrum) {
    const paletteSelect = document.getElementById('paletteSelect');

    try {
        const response = await fetch('palettes.json');
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
        const savedPalette = localStorage.getItem('zxm8_palette') || 'default';
        paletteSelect.value = savedPalette;
        applyPalette(savedPalette, spectrum);
    } catch (e) {
        console.error('Failed to load palettes:', e);
    }
}

export function applyPalette(paletteId, spectrum) {
    if (!loadedPalettes) return;

    const palette = loadedPalettes.find(p => p.id === paletteId);
    if (!palette) return;

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

export function updatePalettePreview(colors) {
    const palettePreview = document.getElementById('palettePreview');
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

// ========== Display: Invert, Canvas Size, Zoom ==========

export function applyInvertDisplay(invert) {
    const canvas = document.getElementById('screen');
    const overlayCanvas = document.getElementById('overlayCanvas');
    canvas.style.filter = invert ? 'invert(1)' : '';
    if (overlayCanvas) overlayCanvas.style.filter = invert ? 'invert(1)' : '';
}

let currentZoom = 1;

export function updateCanvasSize(spectrum) {
    const canvas = document.getElementById('screen');
    const overlayCanvas = document.getElementById('overlayCanvas');

    // Skip size updates when in fullscreen mode
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        return;
    }
    // Get current dimensions from ULA
    const dims = spectrum.ula.getDimensions();
    canvas.width = dims.width;
    canvas.height = dims.height;
    // Apply current zoom level to style
    canvas.style.width = (dims.width * currentZoom) + 'px';
    canvas.style.height = (dims.height * currentZoom) + 'px';
    // Overlay canvas: internal resolution = screen resolution (zoomed)
    // So 1px line = 1 screen pixel regardless of zoom
    overlayCanvas.width = dims.width * currentZoom;
    overlayCanvas.height = dims.height * currentZoom;
    overlayCanvas.style.width = (dims.width * currentZoom) + 'px';
    overlayCanvas.style.height = (dims.height * currentZoom) + 'px';
    // Tell spectrum about zoom for overlay drawing
    spectrum.setZoom(currentZoom);
}

export function setZoom(level, spectrum) {
    currentZoom = level;
    updateCanvasSize(spectrum);

    const zoomButtons = [
        document.getElementById('zoom1'),
        document.getElementById('zoom2'),
        document.getElementById('zoom3')
    ];

    // Update active button
    zoomButtons.forEach((btn, i) => {
        btn.classList.toggle('active', i + 1 === level);
    });

    // Re-render current frame after zoom change
    spectrum.renderToScreen();

    // Update sprite region preview if visible
    if (typeof updateSpriteRegionPreview === 'function') {
        updateSpriteRegionPreview();
    }
}

export function getCurrentZoom() {
    return currentZoom;
}

export function getLoadedPalettes() {
    return loadedPalettes;
}
