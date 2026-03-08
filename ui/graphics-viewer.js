// graphics-viewer.js — Graphics Viewer (extracted from index.html)

import { REGION_TYPES } from '../debug/managers.js';
import { hex8, hex16 } from '../core/utils.js';

export function initGraphicsViewer({ readMemory, getMemoryInfo, getRegion, addRegion, getAllRegions, getRAMPage, isRunning, showMessage, goToAddress, goToMemoryAddress, updateDebugger, openOcrExtractDialog }) {
    // DOM lookups
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
    const gfxZoom1 = document.getElementById('gfxZoom1');
    const gfxZoom2 = document.getElementById('gfxZoom2');
    const gfxZoom3 = document.getElementById('gfxZoom3');
    const gfxComment = document.getElementById('gfxComment');
    const btnGfxWidthMin = document.getElementById('btnGfxWidthMin');
    const btnGfxWidthDec = document.getElementById('btnGfxWidthDec');
    const btnGfxWidthInc = document.getElementById('btnGfxWidthInc');
    const btnGfxWidthMax = document.getElementById('btnGfxWidthMax');
    const btnGfxHeightDec8 = document.getElementById('btnGfxHeightDec8');
    const btnGfxHeightDec = document.getElementById('btnGfxHeightDec');
    const btnGfxHeightInc = document.getElementById('btnGfxHeightInc');
    const btnGfxHeightInc8 = document.getElementById('btnGfxHeightInc8');
    const gfxBank = document.getElementById('gfxBank');

    // Graphics viewer state
    let gfxSpriteAddress = 0x3000; // Current sprite/view address
    let gfxViewAddress = 0x3000;
    let gfxSelectedBank = -1; // -1 = current paging, 0+ = specific RAM page
    const GFX_DUMP_COLS = 32;  // Bytes per row in dump view
    const GFX_DUMP_ROWS = 302;  // Rows visible

    function getGfxParams() {
        const widthBytes = Math.max(1, Math.min(32, parseInt(gfxWidth.value) || 1));
        const heightRows = Math.max(1, Math.min(64, parseInt(gfxHeight.value) || 8));
        const invert = gfxInvert.checked;
        const showGrid = gfxGrid.checked;
        const charMode = gfxCharMode.checked;
        const widthPx = widthBytes * 8;
        const bytesPerSprite = widthBytes * heightRows;
        return { widthBytes, heightRows, widthPx, bytesPerSprite, invert, showGrid, charMode };
    }

    // Address mask: 0x3FFF for specific bank (16K), 0xFFFF for all RAM (64K)
    function gfxAddrMask() {
        return gfxSelectedBank >= 0 ? 0x3FFF : 0xFFFF;
    }

    // Read byte: from specific RAM bank or current memory layout
    function gfxReadByte(addr) {
        const mask = gfxAddrMask();
        addr = addr & mask;
        if (gfxSelectedBank >= 0) {
            const page = getRAMPage(gfxSelectedBank);
            if (page) return page[addr];
            return 0;
        }
        return readMemory(addr);
    }

    // Populate bank dropdown based on machine RAM pages
    function updateBankDropdown() {
        const memInfo = getMemoryInfo();
        const prevValue = gfxBank.value;
        gfxBank.innerHTML = '<option value="-1">All RAM</option>';
        if (memInfo.machineType !== '48k') {
            const ramPages = memInfo.ramPages || 8;
            for (let i = 0; i < ramPages; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = 'Bank ' + i;
                gfxBank.appendChild(opt);
            }
        }
        // Restore previous selection if still valid
        if (gfxBank.querySelector(`option[value="${prevValue}"]`)) {
            gfxBank.value = prevValue;
        } else {
            gfxBank.value = '-1';
            gfxSelectedBank = -1;
        }
    }

    gfxBank.addEventListener('change', () => {
        gfxSelectedBank = parseInt(gfxBank.value);
        gfxBank.size = 1;
        gfxSpriteAddress = gfxSpriteAddress & gfxAddrMask();
        gfxAddress.value = hex16(gfxSpriteAddress);
        updateGraphicsViewer();
    });
    gfxBank.addEventListener('mousedown', () => {
        if (gfxBank.options.length > 10) gfxBank.size = 10;
    });
    gfxBank.addEventListener('blur', () => { gfxBank.size = 1; });
    gfxBank.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { gfxBank.size = 1; gfxBank.blur(); }
    });

    // Region colors as RGB triples for ImageData rendering
    const GFX_REGION_RGB = {
        code: [0x40, 0x80, 0xff], smc: [0xff, 0x40, 0x40], db: [0xff, 0xcc, 0x00], dw: [0xff, 0x88, 0x00],
        text: [0x40, 0xcc, 0x40], graphics: [0xcc, 0x40, 0xcc], default: [0x00, 0xcc, 0x00]
    };
    const GFX_ZERO_RGB = [0x00, 0x00, 0x00];
    const GFX_ZERO_REGION_RGB = [0x33, 0x33, 0x33];

    function renderGfxDump() {
        if (!readMemory) return;

        const params = getGfxParams();
        const zoom = gfxZoom3.checked ? 3 :
                     gfxZoom2.checked ? 2 : 1;
        const canvasWidth = params.widthBytes * 8 * zoom;
        const canvasHeight = GFX_DUMP_ROWS * zoom;
        const anchorRow = 8;  // Selection anchored at row 8 (row 1 in 8-row terms)

        // Calculate view start so selected address appears at row 8, column 0
        // In both modes: 8 rows of context = widthBytes * 8 bytes
        const viewStartAddr = (gfxSpriteAddress - params.widthBytes * 8) & gfxAddrMask();

        gfxDumpCanvas.width = canvasWidth;
        gfxDumpCanvas.height = canvasHeight;
        gfxDumpWrap.style.width = (GFX_DUMP_COLS * 8 * zoom) + 'px';
        gfxDumpWrap.style.height = canvasHeight + 'px';

        // Render pixels into ImageData for atomic update
        const imageData = gfxDumpCtx.createImageData(canvasWidth, canvasHeight);
        const data = imageData.data;

        // Fill with gray background
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 0x80; data[i + 1] = 0x80; data[i + 2] = 0x80; data[i + 3] = 255;
        }

        // Render sprite width bytes as graphics
        for (let row = 0; row < GFX_DUMP_ROWS; row++) {
            for (let col = 0; col < params.widthBytes; col++) {
                let addr;
                if (params.charMode) {
                    const charRow = row >> 3;
                    const lineInChar = row & 7;
                    addr = (viewStartAddr + (charRow * params.widthBytes + col) * 8 + lineInChar) & gfxAddrMask();
                } else {
                    addr = (viewStartAddr + row * params.widthBytes + col) & gfxAddrMask();
                }
                const byte = gfxReadByte(addr);
                const x = col * 8 * zoom;
                const y = row * zoom;

                // Get region color for this address
                const region = getRegion(addr);
                const hasRegion = region && GFX_REGION_RGB[region.type];
                const fgRgb = hasRegion ? GFX_REGION_RGB[region.type] : GFX_REGION_RGB.default;
                const bgRgb = hasRegion ? GFX_ZERO_REGION_RGB : GFX_ZERO_RGB;
                const actualBg = params.invert ? fgRgb : bgRgb;
                const actualFg = params.invert ? bgRgb : fgRgb;

                // Fill background for this byte (8*zoom wide, zoom tall)
                for (let zy = 0; zy < zoom; zy++) {
                    const rowOffset = ((y + zy) * canvasWidth + x) * 4;
                    for (let px = 0; px < 8 * zoom; px++) {
                        const idx = rowOffset + px * 4;
                        data[idx] = actualBg[0]; data[idx + 1] = actualBg[1]; data[idx + 2] = actualBg[2]; data[idx + 3] = 255;
                    }
                }

                // Draw foreground pixels
                for (let bit = 0; bit < 8; bit++) {
                    if ((byte >> (7 - bit)) & 1) {
                        const px = x + bit * zoom;
                        for (let zy = 0; zy < zoom; zy++) {
                            const rowOffset = ((y + zy) * canvasWidth + px) * 4;
                            for (let zx = 0; zx < zoom; zx++) {
                                const idx = rowOffset + zx * 4;
                                data[idx] = actualFg[0]; data[idx + 1] = actualFg[1]; data[idx + 2] = actualFg[2]; data[idx + 3] = 255;
                            }
                        }
                    }
                }
            }
        }

        // Put pixel data atomically
        gfxDumpCtx.putImageData(imageData, 0, 0);

        // Draw red rectangle at fixed anchor position (column 0, row 8)
        const rectX = 0;
        const rectY = anchorRow * zoom;
        const rectW = params.widthBytes * 8 * zoom;
        const rectH = params.heightRows * zoom;

        gfxDumpCtx.strokeStyle = '#ff0000';
        gfxDumpCtx.lineWidth = 2;
        gfxDumpCtx.strokeRect(rectX + 1, rectY + 1, rectW - 2, rectH - 2);

        // Draw grid lines between bytes if enabled (vertical and horizontal)
        if (params.showGrid) {
            gfxDumpCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            gfxDumpCtx.lineWidth = 1;
            const spriteWidthPx = params.widthBytes * 8 * zoom;
            // Vertical lines
            for (let col = 0; col <= params.widthBytes; col++) {
                const x = col * 8 * zoom;
                gfxDumpCtx.beginPath();
                gfxDumpCtx.moveTo(x + 0.5, 0);
                gfxDumpCtx.lineTo(x + 0.5, canvasHeight);
                gfxDumpCtx.stroke();
            }
            // Horizontal lines every 8 rows
            for (let row = 0; row <= GFX_DUMP_ROWS; row += 8) {
                const y = row * zoom;
                gfxDumpCtx.beginPath();
                gfxDumpCtx.moveTo(0, y + 0.5);
                gfxDumpCtx.lineTo(spriteWidthPx, y + 0.5);
                gfxDumpCtx.stroke();
            }
        }
    }

    function renderGfxPreview() {
        if (!readMemory) return;

        const params = getGfxParams();
        const previewZoom = 2;  // Fixed zoom for small preview
        // No context rows - sprite starts at row 0
        const totalRows = params.heightRows;
        const canvasW = params.widthPx * previewZoom;
        const canvasH = totalRows * previewZoom;

        gfxPreviewCanvas.width = canvasW;
        gfxPreviewCanvas.height = canvasH;

        // Render pixels into ImageData for atomic update
        const imageData = gfxPreviewCtx.createImageData(canvasW, canvasH);
        const pdata = imageData.data;

        for (let row = 0; row < totalRows; row++) {
            for (let byteX = 0; byteX < params.widthBytes; byteX++) {
                let addr;
                if (params.charMode) {
                    const charRow = row >> 3;
                    const lineInChar = row & 7;
                    addr = (gfxSpriteAddress + (charRow * params.widthBytes + byteX) * 8 + lineInChar) & gfxAddrMask();
                } else {
                    addr = (gfxSpriteAddress + row * params.widthBytes + byteX) & gfxAddrMask();
                }
                const byte = gfxReadByte(addr);

                const region = getRegion(addr);
                const hasRegion = region && GFX_REGION_RGB[region.type];
                const fgRgb = hasRegion ? GFX_REGION_RGB[region.type] : GFX_REGION_RGB.default;
                const bgRgb = hasRegion ? GFX_ZERO_REGION_RGB : GFX_ZERO_RGB;
                const actualFg = params.invert ? bgRgb : fgRgb;
                const actualBg = params.invert ? fgRgb : bgRgb;

                const x = byteX * 8 * previewZoom;
                const y = row * previewZoom;

                // Fill background for this byte
                for (let zy = 0; zy < previewZoom; zy++) {
                    const rowOffset = ((y + zy) * canvasW + x) * 4;
                    for (let px = 0; px < 8 * previewZoom; px++) {
                        const idx = rowOffset + px * 4;
                        pdata[idx] = actualBg[0]; pdata[idx + 1] = actualBg[1]; pdata[idx + 2] = actualBg[2]; pdata[idx + 3] = 255;
                    }
                }

                // Draw foreground pixels
                for (let bit = 0; bit < 8; bit++) {
                    if ((byte >> (7 - bit)) & 1) {
                        const px = x + bit * previewZoom;
                        for (let zy = 0; zy < previewZoom; zy++) {
                            const rowOffset = ((y + zy) * canvasW + px) * 4;
                            for (let zx = 0; zx < previewZoom; zx++) {
                                const idx = rowOffset + zx * 4;
                                pdata[idx] = actualFg[0]; pdata[idx + 1] = actualFg[1]; pdata[idx + 2] = actualFg[2]; pdata[idx + 3] = 255;
                            }
                        }
                    }
                }
            }
        }

        // Put pixel data atomically
        gfxPreviewCtx.putImageData(imageData, 0, 0);

        // Draw red rectangle around entire sprite
        gfxPreviewCtx.strokeStyle = '#ff0000';
        gfxPreviewCtx.lineWidth = 2;
        gfxPreviewCtx.strokeRect(1, 1, canvasW - 2, canvasH - 2);

        // Draw grid overlay if enabled
        if (params.showGrid) {
            gfxPreviewCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            gfxPreviewCtx.lineWidth = 1;
            // Vertical lines every 8 pixels
            for (let x = 8; x < params.widthPx; x += 8) {
                gfxPreviewCtx.beginPath();
                gfxPreviewCtx.moveTo(x * previewZoom + 0.5, 0);
                gfxPreviewCtx.lineTo(x * previewZoom + 0.5, canvasH);
                gfxPreviewCtx.stroke();
            }
            // Horizontal lines every 8 rows
            for (let y = 8; y <= totalRows; y += 8) {
                gfxPreviewCtx.beginPath();
                gfxPreviewCtx.moveTo(0, y * previewZoom + 0.5);
                gfxPreviewCtx.lineTo(canvasW, y * previewZoom + 0.5);
                gfxPreviewCtx.stroke();
            }
        }

        // Update info
        const addrHex = hex16(gfxSpriteAddress);
        const bankStr = gfxSelectedBank >= 0 ? ` [Bank ${gfxSelectedBank}]` : '';
        gfxInfo.textContent = `${addrHex}h: ${params.widthPx}x${params.heightRows}${bankStr}`;
    }

    function updateGfxSpinnerButtons() {
        const width = parseInt(gfxWidth.value) || 1;
        const height = parseInt(gfxHeight.value) || 8;
        // Width buttons
        btnGfxWidthMin.disabled = width <= 1;
        btnGfxWidthDec.disabled = width <= 1;
        btnGfxWidthInc.disabled = width >= 32;
        btnGfxWidthMax.disabled = width >= 32;
        // Height buttons
        btnGfxHeightDec8.disabled = height <= 8;
        btnGfxHeightDec.disabled = height <= 1;
        btnGfxHeightInc.disabled = height >= 64;
        btnGfxHeightInc8.disabled = height >= 64;
    }

    // Running state warning (overlaid on dump, no layout shift)
    const gfxRunningWarn = document.createElement('div');
    gfxRunningWarn.style.cssText = 'position:absolute;bottom:4px;left:4px;color:#ff4444;background:rgba(0,0,0,0.7);font-size:11px;padding:2px 6px;border-radius:3px;display:none;pointer-events:none';
    gfxRunningWarn.textContent = 'Emulator is running \u2014 memory is changing';
    gfxDumpWrap.style.position = 'relative';
    gfxDumpWrap.appendChild(gfxRunningWarn);
    const gfxRunningWarnInterval = setInterval(() => {
        gfxRunningWarn.style.display = isRunning() ? '' : 'none';
    }, 500);

    function updateGraphicsViewer() {
        updateBankDropdown();
        renderGfxDump();
        renderGfxPreview();
        updateGfxSpinnerButtons();
    }

    function gfxNavigate(delta) {
        gfxSpriteAddress = (gfxSpriteAddress + delta) & gfxAddrMask();
        gfxAddress.value = hex16(gfxSpriteAddress);
        updateGraphicsViewer();
    }

    // Navigation buttons (different behavior in char mode vs linear mode)
    document.getElementById('btnGfxByte1').addEventListener('click', () => {
        const params = getGfxParams();
        // Char mode: move by sprite height (next/prev char column); Linear: move by 1 byte
        gfxNavigate(params.charMode ? -params.heightRows : -1);
    });
    document.getElementById('btnGfxByte2').addEventListener('click', () => {
        const params = getGfxParams();
        gfxNavigate(params.charMode ? params.heightRows : 1);
    });
    document.getElementById('btnGfxLine1').addEventListener('click', () => {
        const params = getGfxParams();
        // Char mode: move by 1 byte; Linear: move by width bytes
        gfxNavigate(params.charMode ? -1 : -params.widthBytes);
    });
    document.getElementById('btnGfxLine2').addEventListener('click', () => {
        const params = getGfxParams();
        gfxNavigate(params.charMode ? 1 : params.widthBytes);
    });
    document.getElementById('btnGfxRow1').addEventListener('click', () => {
        const params = getGfxParams();
        // Move by one character row (width * 8 bytes)
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
    btnGfxWidthMin.addEventListener('click', () => {
        gfxWidth.value = 1;
        updateGraphicsViewer();
    });
    btnGfxWidthDec.addEventListener('click', () => {
        const val = Math.max(1, (parseInt(gfxWidth.value) || 1) - 1);
        gfxWidth.value = val;
        updateGraphicsViewer();
    });
    btnGfxWidthInc.addEventListener('click', () => {
        const val = Math.min(32, (parseInt(gfxWidth.value) || 1) + 1);
        gfxWidth.value = val;
        updateGraphicsViewer();
    });
    btnGfxWidthMax.addEventListener('click', () => {
        gfxWidth.value = 32;
        updateGraphicsViewer();
    });
    btnGfxHeightDec8.addEventListener('click', () => {
        const current = parseInt(gfxHeight.value) || 8;
        const remainder = current % 8;
        const val = remainder === 0 ? Math.max(8, current - 8) : Math.max(8, current - remainder);
        gfxHeight.value = val;
        updateGraphicsViewer();
    });
    btnGfxHeightDec.addEventListener('click', () => {
        const val = Math.max(1, (parseInt(gfxHeight.value) || 8) - 1);
        gfxHeight.value = val;
        updateGraphicsViewer();
    });
    btnGfxHeightInc.addEventListener('click', () => {
        const val = Math.min(64, (parseInt(gfxHeight.value) || 8) + 1);
        gfxHeight.value = val;
        updateGraphicsViewer();
    });
    btnGfxHeightInc8.addEventListener('click', () => {
        const current = parseInt(gfxHeight.value) || 8;
        const remainder = current % 8;
        const val = remainder === 0 ? Math.min(64, current + 8) : Math.min(64, current + (8 - remainder));
        gfxHeight.value = val;
        updateGraphicsViewer();
    });

    // Address input
    gfxAddress.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            gfxSpriteAddress = (parseInt(gfxAddress.value, 16) || 0) & gfxAddrMask();
            gfxAddress.value = hex16(gfxSpriteAddress);
            gfxViewAddress = gfxSpriteAddress;
            updateGraphicsViewer();
        }
    });

    gfxWidth.addEventListener('change', updateGraphicsViewer);
    gfxHeight.addEventListener('change', updateGraphicsViewer);
    gfxGrid.addEventListener('change', updateGraphicsViewer);
    gfxInvert.addEventListener('change', updateGraphicsViewer);
    gfxCharMode.addEventListener('change', updateGraphicsViewer);
    gfxZoom1.addEventListener('change', updateGraphicsViewer);
    gfxZoom2.addEventListener('change', updateGraphicsViewer);
    gfxZoom3.addEventListener('change', updateGraphicsViewer);

    // Scroll dump view (char mode: 1 byte per scroll; linear: widthBytes per scroll)
    document.querySelector('.graphics-dump-wrap').addEventListener('wheel', (e) => {
        e.preventDefault();
        const params = getGfxParams();
        const step = params.charMode ? 1 : params.widthBytes;
        const delta = e.deltaY > 0 ? step : -step;
        gfxSpriteAddress = (gfxSpriteAddress + delta) & gfxAddrMask();
        gfxAddress.value = hex16(gfxSpriteAddress);
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
        const zoom = gfxZoom3.checked ? 3 :
                     gfxZoom2.checked ? 2 : 1;
        const rect = gfxDumpCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Calculate byte position
        const col = Math.floor(x / (8 * zoom));
        const row = Math.floor(y / zoom);

        if (col >= params.widthBytes) return;

        // Calculate view start (same as in renderGfxDump)
        const anchorRow = 8;
        const viewStartAddr = (gfxSpriteAddress - params.widthBytes * anchorRow) & gfxAddrMask();

        // Calculate address for clicked position
        let addr;
        if (params.charMode) {
            const charRow = row >> 3;
            const lineInChar = row & 7;
            addr = (viewStartAddr + (charRow * params.widthBytes + col) * 8 + lineInChar) & gfxAddrMask();
        } else {
            addr = (viewStartAddr + row * params.widthBytes + col) & gfxAddrMask();
        }

        // Format address based on machine type
        const memInfo = getMemoryInfo();
        let addrStr;
        if (memInfo.machineType === '48k') {
            addrStr = hex16(addr) + 'h';
        } else {
            // 128K: show page:address
            let page;
            if (addr < 0x4000) page = 'ROM' + memInfo.currentRomBank;
            else if (addr < 0x8000) page = '5';
            else if (addr < 0xC000) page = '2';
            else page = memInfo.currentRamBank.toString();
            const offset = addr & 0x3FFF;
            addrStr = page + ':' + hex16(offset) + 'h';
        }

        // Show tooltip near cursor
        gfxTooltip.textContent = addrStr;
        gfxTooltip.style.left = (e.clientX + 10) + 'px';
        gfxTooltip.style.top = (e.clientY - 25) + 'px';
        gfxTooltip.style.display = 'block';

        // Hide after 2 seconds
        if (gfxTooltipTimeout) clearTimeout(gfxTooltipTimeout);
        gfxTooltipTimeout = setTimeout(() => {
            gfxTooltip.style.display = 'none';
        }, 2000);
    });

    // Action buttons
    document.getElementById('btnGfxGoDisasm').addEventListener('click', () => {
        document.querySelector('[data-tab="debugger"]').click();
        setTimeout(() => {
            goToAddress(gfxSpriteAddress);
            updateDebugger();
        }, 100);
    });

    document.getElementById('btnGfxGoMem').addEventListener('click', () => {
        document.querySelector('[data-tab="debugger"]').click();
        setTimeout(() => {
            goToMemoryAddress(gfxSpriteAddress);
        }, 100);
    });

    document.getElementById('btnGfxExtractOcr').addEventListener('click', () => {
        if (openOcrExtractDialog) openOcrExtractDialog(gfxSpriteAddress, gfxSelectedBank);
    });

    document.getElementById('btnGfxMarkRegion').addEventListener('click', () => {
        const params = getGfxParams();
        const endAddr = (gfxSpriteAddress + params.bytesPerSprite - 1) & gfxAddrMask();
        const userComment = gfxComment.value.trim();
        const comment = userComment || `Sprite ${params.widthPx}x${params.heightRows}`;

        const result = addRegion({
            start: gfxSpriteAddress,
            end: endAddr,
            type: REGION_TYPES.GRAPHICS,
            comment: comment,
            width: params.widthBytes,
            height: params.heightRows,
            charMode: params.charMode
        });

        if (result.error === 'overlap') {
            const r = result.regions[0];
            const existingRange = `${r.start.toString(16).toUpperCase()}-${r.end.toString(16).toUpperCase()}`;
            const existingType = r.type.toUpperCase();
            showMessage(`Overlap with existing ${existingType} region at ${existingRange}. Remove it first.`);
            return;
        }

        showMessage(`Marked ${gfxSpriteAddress.toString(16).toUpperCase()}-${endAddr.toString(16).toUpperCase()} as Graphics`);
        // Immediately update graphics preview to show region colors
        renderGfxDump();
        renderGfxPreview();
    });

    // Generate sprite as assembler DB statements
    function generateSpriteAsm() {
        const params = getGfxParams();
        const userComment = gfxComment.value.trim();
        const lines = [];

        // Header comment
        const addrHex = hex16(gfxSpriteAddress);
        if (userComment) {
            lines.push(`; ${userComment}`);
        }
        const charNote = params.charMode ? ', char-based' : '';
        lines.push(`; ${addrHex}h: ${params.widthPx}x${params.heightRows} (${params.bytesPerSprite} bytes${charNote})`);

        if (params.charMode) {
            // For char-based: first show visual preview, then output bytes in memory order
            lines.push(';');
            lines.push('; Visual:');

            // Generate visual preview (screen order)
            for (let row = 0; row < params.heightRows; row++) {
                let visualLine = ';   ';
                for (let col = 0; col < params.widthBytes; col++) {
                    const charRow = row >> 3;
                    const lineInChar = row & 7;
                    const addr = (gfxSpriteAddress + (charRow * params.widthBytes + col) * 8 + lineInChar) & gfxAddrMask();
                    const byte = gfxReadByte(addr);
                    for (let bit = 7; bit >= 0; bit--) {
                        visualLine += (byte >> bit) & 1 ? '\u2588' : '\u00B7';
                    }
                }
                lines.push(visualLine);
            }
            lines.push('');

            // Output bytes in memory order (character by character)
            const charsWide = params.widthBytes;
            const charsTall = Math.ceil(params.heightRows / 8);

            for (let charY = 0; charY < charsTall; charY++) {
                for (let charX = 0; charX < charsWide; charX++) {
                    const charIndex = charY * charsWide + charX;
                    const charBaseAddr = gfxSpriteAddress + charIndex * 8;

                    lines.push(`; Char ${charX},${charY}`);

                    const rowBytes = [];
                    for (let line = 0; line < 8; line++) {
                        const addr = (charBaseAddr + line) & gfxAddrMask();
                        const byte = gfxReadByte(addr);
                        rowBytes.push('$' + hex8(byte));
                    }
                    lines.push('        db ' + rowBytes.join(', '));
                }
            }
        } else {
            // Linear mode: output row by row with visual comments
            lines.push('');

            for (let row = 0; row < params.heightRows; row++) {
                const rowBytes = [];
                const visualParts = [];

                for (let col = 0; col < params.widthBytes; col++) {
                    const addr = (gfxSpriteAddress + row * params.widthBytes + col) & gfxAddrMask();
                    const byte = gfxReadByte(addr);
                    rowBytes.push('$' + hex8(byte));

                    // Create visual binary: block for 1, dot for 0
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

    // Copy ASM to clipboard
    document.getElementById('btnGfxCopyAsm').addEventListener('click', () => {
        const text = generateSpriteAsm();
        navigator.clipboard.writeText(text).then(() => {
            showMessage('Copied to clipboard');
        }).catch(() => {
            alert(text);
        });
    });

    // Save ASM to file
    document.getElementById('btnGfxSaveAsm').addEventListener('click', () => {
        const text = generateSpriteAsm();
        const userComment = gfxComment.value.trim();
        const addrHex = hex16(gfxSpriteAddress);

        // Generate filename
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
        showMessage('Saved ' + filename);
    });

    // Generate ASM for a specific graphics region
    function generateRegionSpriteAsm(region) {
        const lines = [];
        const addrHex = hex16(region.start);
        const widthBytes = region.width || 1;
        const totalBytes = region.end - region.start + 1;
        const heightRows = region.height || Math.ceil(totalBytes / widthBytes);
        const widthPx = widthBytes * 8;
        const charMode = region.charMode || false;

        // Helper to read byte from region (handles 128K banks)
        function readByte(addr) {
            addr = addr & 0xffff;
            const memInfo = getMemoryInfo();
            if (region.page !== null && region.page !== undefined && memInfo.machineType !== '48k') {
                if (region.page === 5 && addr >= 0x4000 && addr < 0x8000) {
                    return getRAMPage(5)[addr - 0x4000];
                } else if (region.page === 2 && addr >= 0x8000 && addr < 0xC000) {
                    return getRAMPage(2)[addr - 0x8000];
                } else if (addr >= 0xC000) {
                    return getRAMPage(region.page)[addr - 0xC000];
                }
            }
            return readMemory(addr);
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
            // For char-based: first show visual preview, then output bytes in memory order
            lines.push(';');
            lines.push('; Visual:');

            // Generate visual preview (screen order)
            for (let row = 0; row < heightRows; row++) {
                let visualLine = ';   ';
                for (let col = 0; col < widthBytes; col++) {
                    const charRow = row >> 3;
                    const lineInChar = row & 7;
                    const addr = region.start + (charRow * widthBytes + col) * 8 + lineInChar;
                    const byte = readByte(addr);
                    for (let bit = 7; bit >= 0; bit--) {
                        visualLine += (byte >> bit) & 1 ? '\u2588' : '\u00B7';
                    }
                }
                lines.push(visualLine);
            }
            lines.push('');

            // Output bytes in memory order (character by character)
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
                        rowBytes.push('$' + hex8(byte));
                    }
                    lines.push('        db ' + rowBytes.join(', '));
                }
            }
        } else {
            // Linear mode: output row by row with visual comments
            lines.push('');

            for (let row = 0; row < heightRows; row++) {
                const rowBytes = [];
                const visualParts = [];

                for (let col = 0; col < widthBytes; col++) {
                    const offset = row * widthBytes + col;
                    if (offset >= totalBytes) break;

                    const byte = readByte(region.start + offset);
                    rowBytes.push('$' + hex8(byte));

                    // Create visual binary: block for 1, dot for 0
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

    // Export All Sprites - finds all graphics regions and exports them
    document.getElementById('btnGfxExportAll').addEventListener('click', () => {
        const graphicsRegions = getAllRegions().filter(r => r.type === REGION_TYPES.GRAPHICS);

        if (graphicsRegions.length === 0) {
            showMessage('No graphics regions marked. Use "Mark Region" to mark sprites first.');
            return;
        }

        // Sort by address
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
        showMessage(`Exported ${graphicsRegions.length} sprites to ${filename}`);
    });

    return {
        updateGraphicsViewer,
        destroy() { clearInterval(gfxRunningWarnInterval); }
    };
}
