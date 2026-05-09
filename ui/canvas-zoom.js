// canvas-zoom.js — Canvas zoom controls and theme toggle (extracted from index.html)
import { storageGet, storageSet } from '../core/utils.js';

export function initCanvasZoom({ getSpectrum, getUpdateSpriteRegionPreview }) {
    const canvas = document.getElementById('screen');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const zoomButtons = [
        document.getElementById('zoom1'),
        document.getElementById('zoom2'),
        document.getElementById('zoom3'),
        document.getElementById('zoom4'),
        document.getElementById('zoom5')
    ];

    let currentZoom = 1;  // Default zoom x1

    function updateCanvasSize() {
        const spectrum = getSpectrum();
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

    function setZoom(level) {
        const spectrum = getSpectrum();
        currentZoom = level;
        updateCanvasSize();

        // Update active button
        zoomButtons.forEach((btn, i) => {
            btn.classList.toggle('active', i + 1 === level);
        });

        // Shift tabs left in landscape mode at higher zoom levels
        document.getElementById('tabContainer').classList.toggle('zoom-shifted', level >= 2);

        // Re-render current frame after zoom change
        spectrum.renderToScreen();

        // Update sprite region preview if visible
        const updateSpriteRegionPreview = getUpdateSpriteRegionPreview();
        if (typeof updateSpriteRegionPreview === 'function') {
            updateSpriteRegionPreview();
        }
    }

    function getCurrentZoom() {
        return currentZoom;
    }

    zoomButtons[0].addEventListener('click', () => setZoom(1));
    zoomButtons[1].addEventListener('click', () => setZoom(2));
    zoomButtons[2].addEventListener('click', () => setZoom(3));
    zoomButtons[3].addEventListener('click', () => setZoom(4));
    zoomButtons[4].addEventListener('click', () => setZoom(5));

    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    const metaColorScheme = document.getElementById('metaColorScheme');
    let darkTheme = storageGet('zxm8_theme') !== 'light';
    document.body.classList.toggle('light-theme', !darkTheme);
    metaColorScheme.content = darkTheme ? 'dark' : 'light';
    themeToggle.textContent = darkTheme ? '☀️' : '🌙';

    themeToggle.addEventListener('click', () => {
        darkTheme = !darkTheme;
        document.body.classList.toggle('light-theme', !darkTheme);
        metaColorScheme.content = darkTheme ? 'dark' : 'light';
        themeToggle.textContent = darkTheme ? '☀️' : '🌙';
        storageSet('zxm8_theme', darkTheme ? 'dark' : 'light');
    });

    function isDarkTheme() {
        return darkTheme;
    }

    function setDarkTheme(value) {
        darkTheme = value;
        document.body.classList.toggle('light-theme', !darkTheme);
        metaColorScheme.content = darkTheme ? 'dark' : 'light';
        themeToggle.textContent = darkTheme ? '☀️' : '🌙';
    }

    // UI Scale — scales the entire interface without affecting the emulator canvas
    const uiScaleSelect = document.getElementById('uiScaleSelect');
    const uiContainer = document.querySelector('.container');
    const screenWrapper = document.querySelector('.screen-wrapper');
    const secondScreenContainer = document.getElementById('secondScreenContainer');

    let uiScale = parseFloat(storageGet('zxm8_uiScale', '1')) || 1;

    function setUiScale(scale) {
        uiScale = scale;
        uiContainer.style.zoom = scale;
        screenWrapper.style.zoom = 1 / scale;
        secondScreenContainer.style.zoom = 1 / scale;
        storageSet('zxm8_uiScale', scale.toString());
        uiScaleSelect.value = scale.toString();
    }

    function getUiScale() { return uiScale; }

    // Init — apply stored scale on load
    if (uiScale !== 1) setUiScale(uiScale);
    uiScaleSelect.value = uiScale.toString();

    uiScaleSelect.addEventListener('change', () => {
        setUiScale(parseFloat(uiScaleSelect.value) || 1);
    });

    return { updateCanvasSize, setZoom, getCurrentZoom, isDarkTheme, setDarkTheme, setUiScale, getUiScale };
}
