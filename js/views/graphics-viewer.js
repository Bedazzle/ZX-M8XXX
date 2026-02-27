// ========== Graphics Viewer ==========
// Extracted from index.html inline script

// --- DOM element references ---
const gfxDumpCanvas = document.getElementById('gfxDumpCanvas');
const gfxDumpCtx = gfxDumpCanvas.getContext('2d');
const gfxDumpWrap = document.querySelector('.graphics-dump-wrap');
const gfxPreviewCanvas = document.getElementById('gfxPreviewCanvas');
const gfxPreviewCtx = gfxPreviewCanvas.getContext('2d');
const gfxAddress = document.getElementById('gfxAddress');
const gfxWidth = document.getElementById('gfxWidth');
const gfxHeight = document.getElementById('gfxHeight');
const gfxGrid = document.getElementById('gfxGrid');
const gfxInvert = document.getElementById('gfxInvert');
const gfxCharMode = document.getElementById('gfxCharMode');
const gfxInfo = document.getElementById('gfxInfo');

// --- State ---
export let gfxSpriteAddress = 0x3000; // Current sprite/view address

// --- Constants ---
export const GFX_DUMP_COLS = 24;  // Bytes per row in dump view
export const GFX_DUMP_ROWS = 302;  // Rows visible

// --- External dependencies ---
// These are injected via init() to avoid circular imports.
let _spectrum = null;
let _regionManager = null;
let _showMessage = null;
let _goToAddress = null;
let _goToMemoryAddress = null;
let _updateDebugger = null;
let _REGION_TYPES = null;

/**
 * Initialize graphics viewer with external dependencies.
 * @param {object} deps - { spectrum, regionManager, showMessage, goToAddress, goToMemoryAddress, updateDebugger, REGION_TYPES }
 */
export function initGraphicsViewer(deps) {
    _spectrum = deps.spectrum;
    _regionManager = deps.regionManager;
    _showMessage = deps.showMessage;
    _goToAddress = deps.goToAddress;
    _goToMemoryAddress = deps.goToMemoryAddress;
    _updateDebugger = deps.updateDebugger;
    _REGION_TYPES = deps.REGION_TYPES;
}

// --- Core functions ---

export function getGfxParams() {
    const widthBytes = Math.max(1, Math.min(32, parseInt(gfxWidth.value) || 1));
    const heightRows = Math.max(1, Math.min(64, parseInt(gfxHeight.value) || 8));
    const invert = gfxInvert.checked;
    const showGrid = gfxGrid.checked;
    const charMode = gfxCharMode.checked;
    const widthPx = widthBytes * 8;
    const bytesPerSprite = widthBytes * heightRows;
    return { widthBytes, heightRows, widthPx, bytesPerSprite, invert, showGrid, charMode };
}

export function renderGfxDump() {
    if (!_spectrum) return;

    const params = getGfxParams();
    const zoom = document.getElementById('gfxZoom3').checked ? 3 :
                 document.getElementById('gfxZoom2').checked ? 2 : 1;
    const canvasWidth = GFX_DUMP_COLS * 8 * zoom;
    const canvasHeight = GFX_DUMP_ROWS * zoom;
    const anchorRow = 8;  // Selection anchored at row 8 (row 1 in 8-row terms)

    // Calculate view start so selected address appears at row 8, column 0
    const viewStartAddr = (gfxSpriteAddress - params.widthBytes * 8) & 0xffff;

    gfxDumpCanvas.width = canvasWidth;
    gfxDumpCanvas.height = canvasHeight;
    gfxDumpWrap.style.height = canvasHeight + 'px';

    // Clear with gray background
    gfxDumpCtx.fillStyle = '#808080';
    gfxDumpCtx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Region colors for graphics
    const GFX_REGION_COLORS = {
        code: '#4080ff', smc: '#ff4040', db: '#ffcc00', dw: '#ff8800',
        text: '#40cc40', graphics: '#cc40cc', default: '#00cc00'
    };

    // Render sprite width bytes as graphics
    for (let row = 0; row < GFX_DUMP_ROWS; row++) {
        for (let col = 0; col < params.widthBytes; col++) {
            let addr;
            if (params.charMode) {
                const charRow = Math.floor(row / 8);
                const lineInChar = row % 8;
                addr = (viewStartAddr + (charRow * params.widthBytes + col) * 8 + lineInChar) & 0xffff;
            } else {
                addr = (viewStartAddr + row * params.widthBytes + col) & 0xffff;
            }
            const byte = _spectrum.memory.read(addr);
            const x = col * 8 * zoom;
            const y = row * zoom;

            // Get region color for this address
            const region = _regionManager.get(addr);
            const hasRegion = region && GFX_REGION_COLORS[region.type];
            let pixelColor = hasRegion ? GFX_REGION_COLORS[region.type] : GFX_REGION_COLORS.default;
            const zeroBitColor = hasRegion ? '#333333' : '#000000';
            const actualBg = params.invert ? pixelColor : zeroBitColor;
            const actualFg = params.invert ? zeroBitColor : pixelColor;

            gfxDumpCtx.fillStyle = actualBg;
            gfxDumpCtx.fillRect(x, y, 8 * zoom, zoom);

            gfxDumpCtx.fillStyle = actualFg;
            for (let bit = 0; bit < 8; bit++) {
                if ((byte >> (7 - bit)) & 1) {
                    gfxDumpCtx.fillRect(x + bit * zoom, y, zoom, zoom);
                }
            }
        }
    }

    // Draw red rectangle at fixed anchor position
    const rectX = 0;
    const rectY = anchorRow * zoom;
    const rectW = params.widthBytes * 8 * zoom;
    const rectH = params.heightRows * zoom;

    gfxDumpCtx.strokeStyle = '#ff0000';
    gfxDumpCtx.lineWidth = 2;
    gfxDumpCtx.strokeRect(rectX + 1, rectY + 1, rectW - 2, rectH - 2);

    // Draw grid lines between bytes if enabled
    if (params.showGrid) {
        gfxDumpCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        gfxDumpCtx.lineWidth = 1;
        const spriteWidthPx = params.widthBytes * 8 * zoom;
        for (let col = 0; col <= params.widthBytes; col++) {
            const x = col * 8 * zoom;
            gfxDumpCtx.beginPath();
            gfxDumpCtx.moveTo(x + 0.5, 0);
            gfxDumpCtx.lineTo(x + 0.5, canvasHeight);
            gfxDumpCtx.stroke();
        }
        for (let row = 0; row <= GFX_DUMP_ROWS; row += 8) {
            const y = row * zoom;
            gfxDumpCtx.beginPath();
            gfxDumpCtx.moveTo(0, y + 0.5);
            gfxDumpCtx.lineTo(spriteWidthPx, y + 0.5);
            gfxDumpCtx.stroke();
        }
    }
}

export function renderGfxPreview() {
    if (!_spectrum) return;

    const params = getGfxParams();
    const previewZoom = 2;
    const totalRows = params.heightRows;
    const canvasW = params.widthPx * previewZoom;
    const canvasH = totalRows * previewZoom;

    gfxPreviewCanvas.width = canvasW;
    gfxPreviewCanvas.height = canvasH;

    const GFX_REGION_COLORS = {
        code: '#4080ff', smc: '#ff4040', db: '#ffcc00', dw: '#ff8800',
        text: '#40cc40', graphics: '#cc40cc', default: '#00cc00'
    };

    gfxPreviewCtx.fillStyle = '#000000';
    gfxPreviewCtx.fillRect(0, 0, canvasW, canvasH);

    for (let row = 0; row < totalRows; row++) {
        for (let byteX = 0; byteX < params.widthBytes; byteX++) {
            let addr;
            if (params.charMode) {
                const charRow = Math.floor(row / 8);
                const lineInChar = row % 8;
                addr = (gfxSpriteAddress + (charRow * params.widthBytes + byteX) * 8 + lineInChar) & 0xffff;
            } else {
                addr = (gfxSpriteAddress + row * params.widthBytes + byteX) & 0xffff;
            }
            const byte = _spectrum.memory.read(addr);

            const region = _regionManager.get(addr);
            const hasRegion = region && GFX_REGION_COLORS[region.type];
            let pixelColor = hasRegion ? GFX_REGION_COLORS[region.type] : GFX_REGION_COLORS.default;
            const zeroBitColor = hasRegion ? '#333333' : '#000000';
            const fgColor = params.invert ? zeroBitColor : pixelColor;
            const bgColor = params.invert ? pixelColor : zeroBitColor;

            gfxPreviewCtx.fillStyle = bgColor;
            gfxPreviewCtx.fillRect(byteX * 8 * previewZoom, row * previewZoom, 8 * previewZoom, previewZoom);

            gfxPreviewCtx.fillStyle = fgColor;
            for (let bit = 0; bit < 8; bit++) {
                if ((byte >> (7 - bit)) & 1) {
                    const px = byteX * 8 + bit;
                    gfxPreviewCtx.fillRect(px * previewZoom, row * previewZoom, previewZoom, previewZoom);
                }
            }
        }
    }

    // Draw red rectangle around entire sprite
    gfxPreviewCtx.strokeStyle = '#ff0000';
    gfxPreviewCtx.lineWidth = 2;
    gfxPreviewCtx.strokeRect(1, 1, canvasW - 2, canvasH - 2);

    // Draw grid overlay if enabled
    if (params.showGrid) {
        gfxPreviewCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        gfxPreviewCtx.lineWidth = 1;
        for (let x = 8; x < params.widthPx; x += 8) {
            gfxPreviewCtx.beginPath();
            gfxPreviewCtx.moveTo(x * previewZoom + 0.5, 0);
            gfxPreviewCtx.lineTo(x * previewZoom + 0.5, canvasH);
            gfxPreviewCtx.stroke();
        }
        for (let y = 8; y <= totalRows; y += 8) {
            gfxPreviewCtx.beginPath();
            gfxPreviewCtx.moveTo(0, y * previewZoom + 0.5);
            gfxPreviewCtx.lineTo(canvasW, y * previewZoom + 0.5);
            gfxPreviewCtx.stroke();
        }
    }

    // Update info
    const addrHex = gfxSpriteAddress.toString(16).toUpperCase().padStart(4, '0');
    gfxInfo.textContent = `${addrHex}h: ${params.widthPx}x${params.heightRows}`;
}

export function updateGfxSpinnerButtons() {
    const width = parseInt(gfxWidth.value) || 1;
    const height = parseInt(gfxHeight.value) || 8;
    document.getElementById('btnGfxWidthMin').disabled = width <= 1;
    document.getElementById('btnGfxWidthDec').disabled = width <= 1;
    document.getElementById('btnGfxWidthInc').disabled = width >= 32;
    document.getElementById('btnGfxWidthMax').disabled = width >= 32;
    document.getElementById('btnGfxHeightDec8').disabled = height <= 8;
    document.getElementById('btnGfxHeightDec').disabled = height <= 1;
    document.getElementById('btnGfxHeightInc').disabled = height >= 64;
    document.getElementById('btnGfxHeightInc8').disabled = height >= 64;
}

export function updateGraphicsViewer() {
    renderGfxDump();
    renderGfxPreview();
    updateGfxSpinnerButtons();
}

export function gfxNavigate(delta) {
    gfxSpriteAddress = (gfxSpriteAddress + delta) & 0xffff;
    gfxAddress.value = gfxSpriteAddress.toString(16).toUpperCase().padStart(4, '0');
    updateGraphicsViewer();
}

// Generate sprite as assembler DB statements
export function generateSpriteAsm() {
    const params = getGfxParams();
    const userComment = document.getElementById('gfxComment').value.trim();
    const lines = [];

    // Header comment
    const addrHex = gfxSpriteAddress.toString(16).toUpperCase().padStart(4, '0');
    if (userComment) {
        lines.push(`; ${userComment}`);
    }
    const charNote = params.charMode ? ', char-based' : '';
    lines.push(`; ${addrHex}h: ${params.widthPx}x${params.heightRows} (${params.bytesPerSprite} bytes${charNote})`);

    if (params.charMode) {
        lines.push(';');
        lines.push('; Visual:');

        for (let row = 0; row < params.heightRows; row++) {
            let visualLine = ';   ';
            for (let col = 0; col < params.widthBytes; col++) {
                const charRow = Math.floor(row / 8);
                const lineInChar = row % 8;
                const addr = (gfxSpriteAddress + (charRow * params.widthBytes + col) * 8 + lineInChar) & 0xffff;
                const byte = _spectrum.memory.read(addr);
                for (let bit = 7; bit >= 0; bit--) {
                    visualLine += (byte >> bit) & 1 ? '\u2588' : '\u00B7';
                }
            }
            lines.push(visualLine);
        }
        lines.push('');

        const charsWide = params.widthBytes;
        const charsTall = Math.ceil(params.heightRows / 8);

        for (let charY = 0; charY < charsTall; charY++) {
            for (let charX = 0; charX < charsWide; charX++) {
                const charIndex = charY * charsWide + charX;
                const charBaseAddr = gfxSpriteAddress + charIndex * 8;

                lines.push(`; Char ${charX},${charY}`);

                const rowBytes = [];
                for (let line = 0; line < 8; line++) {
                    const addr = (charBaseAddr + line) & 0xffff;
                    const byte = _spectrum.memory.read(addr);
                    rowBytes.push('$' + byte.toString(16).toUpperCase().padStart(2, '0'));
                }
                lines.push('        db ' + rowBytes.join(', '));
            }
        }
    } else {
        lines.push('');

        for (let row = 0; row < params.heightRows; row++) {
            const rowBytes = [];
            const visualParts = [];

            for (let col = 0; col < params.widthBytes; col++) {
                const addr = (gfxSpriteAddress + row * params.widthBytes + col) & 0xffff;
                const byte = _spectrum.memory.read(addr);
                rowBytes.push('$' + byte.toString(16).toUpperCase().padStart(2, '0'));

                let visual = '';
                for (let bit = 7; bit >= 0; bit--) {
                    visual += (byte >> bit) & 1 ? '\u2588' : '\u00B7';
                }
                visualParts.push(visual);
            }

            const dbLine = '        db ' + rowBytes.join(', ');
            const visualComment = ' ; ' + visualParts.join(' ');
            lines.push(dbLine + visualComment);
        }
    }

    return lines.join('\n');
}

// Generate ASM for a specific graphics region
export function generateRegionSpriteAsm(region) {
    const lines = [];
    const addrHex = region.start.toString(16).toUpperCase().padStart(4, '0');
    const widthBytes = region.width || 1;
    const totalBytes = region.end - region.start + 1;
    const heightRows = region.height || Math.ceil(totalBytes / widthBytes);
    const widthPx = widthBytes * 8;
    const charMode = region.charMode || false;

    // Helper to read byte from region (handles 128K banks)
    function readByte(addr) {
        addr = addr & 0xffff;
        if (region.page !== null && region.page !== undefined && _spectrum.memory.machineType !== '48k') {
            if (region.page === 5 && addr >= 0x4000 && addr < 0x8000) {
                return _spectrum.memory.ram[5][addr - 0x4000];
            } else if (region.page === 2 && addr >= 0x8000 && addr < 0xC000) {
                return _spectrum.memory.ram[2][addr - 0x8000];
            } else if (addr >= 0xC000) {
                return _spectrum.memory.ram[region.page][addr - 0xC000];
            }
        }
        return _spectrum.memory.read(addr);
    }

    // Header comment
    if (region.comment) {
        lines.push(`; ${region.comment}`);
    }
    const charNote = charMode ? ', char-based' : '';
    lines.push(`; ${addrHex}h: ${widthPx}x${heightRows} (${totalBytes} bytes${charNote})`);
    if (region.page !== null && region.page !== undefined) {
        lines.push(`; Bank ${region.page}`);
    }

    if (charMode) {
        lines.push(';');
        lines.push('; Visual:');

        for (let row = 0; row < heightRows; row++) {
            let visualLine = ';   ';
            for (let col = 0; col < widthBytes; col++) {
                const charRow = Math.floor(row / 8);
                const lineInChar = row % 8;
                const addr = region.start + (charRow * widthBytes + col) * 8 + lineInChar;
                const byte = readByte(addr);
                for (let bit = 7; bit >= 0; bit--) {
                    visualLine += (byte >> bit) & 1 ? '\u2588' : '\u00B7';
                }
            }
            lines.push(visualLine);
        }
        lines.push('');

        const charsWide = widthBytes;
        const charsTall = Math.ceil(heightRows / 8);

        for (let charY = 0; charY < charsTall; charY++) {
            for (let charX = 0; charX < charsWide; charX++) {
                const charIndex = charY * charsWide + charX;
                const charBaseAddr = region.start + charIndex * 8;

                lines.push(`; Char ${charX},${charY}`);

                const rowBytes = [];
                for (let line = 0; line < 8; line++) {
                    const byte = readByte(charBaseAddr + line);
                    rowBytes.push('$' + byte.toString(16).toUpperCase().padStart(2, '0'));
                }
                lines.push('        db ' + rowBytes.join(', '));
            }
        }
    } else {
        lines.push('');

        for (let row = 0; row < heightRows; row++) {
            const rowBytes = [];
            const visualParts = [];

            for (let col = 0; col < widthBytes; col++) {
                const offset = row * widthBytes + col;
                if (offset >= totalBytes) break;

                const byte = readByte(region.start + offset);
                rowBytes.push('$' + byte.toString(16).toUpperCase().padStart(2, '0'));

                let visual = '';
                for (let bit = 7; bit >= 0; bit--) {
                    visual += (byte >> bit) & 1 ? '\u2588' : '\u00B7';
                }
                visualParts.push(visual);
            }

            if (rowBytes.length > 0) {
                const dbLine = '        db ' + rowBytes.join(', ');
                const visualComment = ' ; ' + visualParts.join(' ');
                lines.push(dbLine + visualComment);
            }
        }
    }

    return lines.join('\n');
}

// --- Event listeners (wiring) ---

// Navigation buttons
document.getElementById('btnGfxByte1').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(params.charMode ? -params.heightRows : -1);
});
document.getElementById('btnGfxByte2').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(params.charMode ? params.heightRows : 1);
});
document.getElementById('btnGfxLine1').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(params.charMode ? -1 : -params.widthBytes);
});
document.getElementById('btnGfxLine2').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(params.charMode ? 1 : params.widthBytes);
});
document.getElementById('btnGfxRow1').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(-params.widthBytes * 8);
});
document.getElementById('btnGfxRow2').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(params.widthBytes * 8);
});
document.getElementById('btnGfxSprite1').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(-params.bytesPerSprite);
});
document.getElementById('btnGfxSprite2').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(params.bytesPerSprite);
});
document.getElementById('btnGfxPage1').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(-params.widthBytes * 8 * 24);
});
document.getElementById('btnGfxPage2').addEventListener('click', () => {
    const params = getGfxParams();
    gfxNavigate(params.widthBytes * 8 * 24);
});

// Width/Height spinners
document.getElementById('btnGfxWidthMin').addEventListener('click', () => {
    gfxWidth.value = 1;
    updateGraphicsViewer();
});
document.getElementById('btnGfxWidthDec').addEventListener('click', () => {
    const val = Math.max(1, (parseInt(gfxWidth.value) || 1) - 1);
    gfxWidth.value = val;
    updateGraphicsViewer();
});
document.getElementById('btnGfxWidthInc').addEventListener('click', () => {
    const val = Math.min(32, (parseInt(gfxWidth.value) || 1) + 1);
    gfxWidth.value = val;
    updateGraphicsViewer();
});
document.getElementById('btnGfxWidthMax').addEventListener('click', () => {
    gfxWidth.value = 32;
    updateGraphicsViewer();
});
document.getElementById('btnGfxHeightDec8').addEventListener('click', () => {
    const current = parseInt(gfxHeight.value) || 8;
    const remainder = current % 8;
    const val = remainder === 0 ? Math.max(8, current - 8) : Math.max(8, current - remainder);
    gfxHeight.value = val;
    updateGraphicsViewer();
});
document.getElementById('btnGfxHeightDec').addEventListener('click', () => {
    const val = Math.max(1, (parseInt(gfxHeight.value) || 8) - 1);
    gfxHeight.value = val;
    updateGraphicsViewer();
});
document.getElementById('btnGfxHeightInc').addEventListener('click', () => {
    const val = Math.min(64, (parseInt(gfxHeight.value) || 8) + 1);
    gfxHeight.value = val;
    updateGraphicsViewer();
});
document.getElementById('btnGfxHeightInc8').addEventListener('click', () => {
    const current = parseInt(gfxHeight.value) || 8;
    const remainder = current % 8;
    const val = remainder === 0 ? Math.min(64, current + 8) : Math.min(64, current + (8 - remainder));
    gfxHeight.value = val;
    updateGraphicsViewer();
});

// Address input
gfxAddress.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        gfxSpriteAddress = parseInt(gfxAddress.value, 16) || 0;
        updateGraphicsViewer();
    }
});

gfxWidth.addEventListener('change', updateGraphicsViewer);
gfxHeight.addEventListener('change', updateGraphicsViewer);
gfxGrid.addEventListener('change', updateGraphicsViewer);
gfxInvert.addEventListener('change', updateGraphicsViewer);
gfxCharMode.addEventListener('change', updateGraphicsViewer);
document.getElementById('gfxZoom1').addEventListener('change', updateGraphicsViewer);
document.getElementById('gfxZoom2').addEventListener('change', updateGraphicsViewer);
document.getElementById('gfxZoom3').addEventListener('change', updateGraphicsViewer);

// Scroll dump view
document.querySelector('.graphics-dump-wrap').addEventListener('wheel', (e) => {
    e.preventDefault();
    const params = getGfxParams();
    const step = params.charMode ? 1 : params.widthBytes;
    const delta = e.deltaY > 0 ? step : -step;
    gfxSpriteAddress = (gfxSpriteAddress + delta) & 0xffff;
    gfxAddress.value = gfxSpriteAddress.toString(16).toUpperCase().padStart(4, '0');
    updateGraphicsViewer();
}, { passive: false });

// Tooltip for gfx dump
const gfxTooltip = document.createElement('div');
gfxTooltip.style.cssText = 'position:fixed;background:rgba(0,0,0,0.9);color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;font-family:monospace;pointer-events:none;z-index:1000;display:none';
document.body.appendChild(gfxTooltip);
let gfxTooltipTimeout = null;

// Click on dump to show address popup near cursor
gfxDumpCanvas.addEventListener('click', (e) => {
    const params = getGfxParams();
    const zoom = document.getElementById('gfxZoom3').checked ? 3 :
                 document.getElementById('gfxZoom2').checked ? 2 : 1;
    const rect = gfxDumpCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const col = Math.floor(x / (8 * zoom));
    const row = Math.floor(y / zoom);

    if (col >= params.widthBytes) return;

    const anchorRow = 8;
    const viewStartAddr = (gfxSpriteAddress - params.widthBytes * anchorRow) & 0xffff;

    let addr;
    if (params.charMode) {
        const charRow = Math.floor(row / 8);
        const lineInChar = row % 8;
        addr = (viewStartAddr + (charRow * params.widthBytes + col) * 8 + lineInChar) & 0xffff;
    } else {
        addr = (viewStartAddr + row * params.widthBytes + col) & 0xffff;
    }

    // Format address based on machine type
    let addrStr;
    if (_spectrum.memory.machineType === '48k') {
        addrStr = addr.toString(16).toUpperCase().padStart(4, '0') + 'h';
    } else {
        let page;
        if (addr < 0x4000) page = 'ROM' + _spectrum.memory.currentRomBank;
        else if (addr < 0x8000) page = '5';
        else if (addr < 0xC000) page = '2';
        else page = _spectrum.memory.currentRamBank.toString();
        const offset = addr & 0x3FFF;
        addrStr = page + ':' + offset.toString(16).toUpperCase().padStart(4, '0') + 'h';
    }

    gfxTooltip.textContent = addrStr;
    gfxTooltip.style.left = (e.clientX + 10) + 'px';
    gfxTooltip.style.top = (e.clientY - 25) + 'px';
    gfxTooltip.style.display = 'block';

    if (gfxTooltipTimeout) clearTimeout(gfxTooltipTimeout);
    gfxTooltipTimeout = setTimeout(() => {
        gfxTooltip.style.display = 'none';
    }, 2000);
});

// Action buttons
document.getElementById('btnGfxGoDisasm').addEventListener('click', () => {
    document.querySelector('[data-tab="debugger"]').click();
    setTimeout(() => {
        if (_goToAddress) _goToAddress(gfxSpriteAddress);
        if (_updateDebugger) _updateDebugger();
    }, 100);
});

document.getElementById('btnGfxGoMem').addEventListener('click', () => {
    document.querySelector('[data-tab="debugger"]').click();
    setTimeout(() => {
        if (_goToMemoryAddress) _goToMemoryAddress(gfxSpriteAddress);
    }, 100);
});

document.getElementById('btnGfxMarkRegion').addEventListener('click', () => {
    const params = getGfxParams();
    const endAddr = (gfxSpriteAddress + params.bytesPerSprite - 1) & 0xffff;
    const userComment = document.getElementById('gfxComment').value.trim();
    const comment = userComment || `Sprite ${params.widthPx}x${params.heightRows}`;

    const result = _regionManager.add({
        start: gfxSpriteAddress,
        end: endAddr,
        type: _REGION_TYPES.GRAPHICS,
        comment: comment,
        width: params.widthBytes,
        height: params.heightRows,
        charMode: params.charMode
    });

    if (result.error === 'overlap') {
        const r = result.regions[0];
        const existingRange = `${r.start.toString(16).toUpperCase()}-${r.end.toString(16).toUpperCase()}`;
        const existingType = r.type.toUpperCase();
        if (_showMessage) _showMessage(`Overlap with existing ${existingType} region at ${existingRange}. Remove it first.`);
        return;
    }

    if (_showMessage) _showMessage(`Marked ${gfxSpriteAddress.toString(16).toUpperCase()}-${endAddr.toString(16).toUpperCase()} as Graphics`);
    renderGfxDump();
    renderGfxPreview();
});

// Copy ASM to clipboard
document.getElementById('btnGfxCopyAsm').addEventListener('click', () => {
    const text = generateSpriteAsm();
    navigator.clipboard.writeText(text).then(() => {
        if (_showMessage) _showMessage('Copied to clipboard');
    }).catch(() => {
        alert(text);
    });
});

// Save ASM to file
document.getElementById('btnGfxSaveAsm').addEventListener('click', () => {
    const text = generateSpriteAsm();
    const userComment = document.getElementById('gfxComment').value.trim();
    const addrHex = gfxSpriteAddress.toString(16).toUpperCase().padStart(4, '0');

    let filename;
    if (userComment) {
        filename = userComment.replace(/[^a-zA-Z0-9_-]/g, '_') + '.asm';
    } else {
        filename = 'sprite_' + addrHex + '.asm';
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    if (_showMessage) _showMessage('Saved ' + filename);
});

// Export All Sprites
document.getElementById('btnGfxExportAll').addEventListener('click', () => {
    const graphicsRegions = _regionManager.getAll().filter(r => r.type === _REGION_TYPES.GRAPHICS);

    if (graphicsRegions.length === 0) {
        if (_showMessage) _showMessage('No graphics regions marked. Use "Mark Region" to mark sprites first.');
        return;
    }

    graphicsRegions.sort((a, b) => {
        if (a.page !== b.page) return (a.page || 0) - (b.page || 0);
        return a.start - b.start;
    });

    const allLines = [
        '; ================================================',
        '; Exported Sprites',
        '; ' + graphicsRegions.length + ' graphics regions',
        '; ================================================',
        ''
    ];

    for (const region of graphicsRegions) {
        allLines.push(generateRegionSpriteAsm(region));
        allLines.push('');
    }

    const text = allLines.join('\n');
    const filename = 'sprites_export.asm';

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    if (_showMessage) _showMessage(`Exported ${graphicsRegions.length} sprites to ${filename}`);
});
