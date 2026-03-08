// text-ripper.js — Screen-based character recognition (OCR) for ZX Spectrum
// Maps unique glyph bitmaps (configurable CW×CH, 4-8 × 4-16 pixels) to characters
// for text extraction from screen memory. Supports sub-byte pixel extraction for
// non-byte-aligned widths (e.g. 4×8, 6×8) and grid origin offsets (OX, OY).
//
// Each captured page stores the full screen bitmap (6144 bytes, base64) so the user
// can navigate back/forward between grabbed screens. Each page has its own region;
// new pages copy the region from the last capture.

export function initTextRipper({ readMemory, getRAMPage, showMessage, downloadFile }) {

    // ========== DOM refs ==========
    const sourceSelect = document.getElementById('ocrSource');
    const charsetSelect = document.getElementById('ocrCharset');
    const btnCharsetNew = document.getElementById('btnOcrCharsetNew');
    const btnCharsetRename = document.getElementById('btnOcrCharsetRename');
    const btnCharsetDel = document.getElementById('btnOcrCharsetDel');
    const regionX = document.getElementById('ocrRegionX');
    const regionY = document.getElementById('ocrRegionY');
    const regionW = document.getElementById('ocrRegionW');
    const regionH = document.getElementById('ocrRegionH');
    const btnRefresh = document.getElementById('btnOcrRefresh');
    const btnCapture = document.getElementById('btnOcrCapture');
    const statusSpan = document.getElementById('ocrStatus');
    const previewCanvas = document.getElementById('ocrPreviewCanvas');
    const previewCtx = previewCanvas.getContext('2d');
    const gridCanvas = document.getElementById('ocrGridCanvas');
    const gridCtx = gridCanvas.getContext('2d');
    const previewZoomBtns = document.querySelectorAll('.ocr-zoom-btn');
    let previewZoom = 2;
    const glyphHeader = document.getElementById('ocrGlyphHeader');
    const glyphGrid = document.getElementById('ocrGlyphGrid');
    const btnDeleteSelected = document.getElementById('btnOcrDeleteSelected');
    const btnPagePrev = document.getElementById('btnOcrPagePrev');
    const btnPageNext = document.getElementById('btnOcrPageNext');
    const pageLabel = document.getElementById('ocrPageLabel');
    const btnAppend = document.getElementById('btnOcrAppend');
    const btnNewPage = document.getElementById('btnOcrNewPage');
    const btnDelPage = document.getElementById('btnOcrDelPage');
    const textOutput = document.getElementById('ocrTextOutput');
    const btnExportText = document.getElementById('btnOcrExportText');
    const btnExportCharset = document.getElementById('btnOcrExportCharset');
    const btnImportCharset = document.getElementById('btnOcrImportCharset');
    const btnSaveSession = document.getElementById('btnOcrSaveSession');
    const btnLoadSession = document.getElementById('btnOcrLoadSession');
    const btnClear = document.getElementById('btnOcrClear');
    const btnFontMinus = document.getElementById('btnOcrFontMinus');
    const btnFontPlus = document.getElementById('btnOcrFontPlus');
    const showDupesCheckbox = document.getElementById('ocrShowDupes');
    const captureKnownCheckbox = document.getElementById('ocrCaptureKnown');
    const extractDialog = document.getElementById('ocrExtractDialog');
    const extractAddrInput = document.getElementById('ocrExtractAddr');
    const extractCountInput = document.getElementById('ocrExtractCount');
    const extractByteInfo = document.getElementById('ocrExtractByteInfo');
    const extractMapSelect = document.getElementById('ocrExtractMapSelect');
    const extractMapText = document.getElementById('ocrExtractMapText');
    const extractMapCount = document.getElementById('ocrExtractMapCount');
    const btnExtractDo = document.getElementById('btnOcrExtractDo');
    const btnExtractRom = document.getElementById('btnOcrExtractRom');
    const btnExtractClose = document.getElementById('btnOcrExtractClose');
    const btnExtractSaveMap = document.getElementById('btnOcrExtractSaveMap');
    const btnExtractLoadMap = document.getElementById('btnOcrExtractLoadMap');
    const extractColsInput = document.getElementById('ocrExtractCols');
    const extractBankInput = document.getElementById('ocrExtractBank');
    const extractCharsetSelect = document.getElementById('ocrExtractCharset');

    // ========== DOM refs (CW/CH/OX/OY) ==========
    const cellWidthInput = document.getElementById('ocrCellWidth');
    const cellHeightInput = document.getElementById('ocrCellHeight');
    const originXInput = document.getElementById('ocrOriginX');
    const originYInput = document.getElementById('ocrOriginY');
    const gapXInput = document.getElementById('ocrGapX');
    const gapYInput = document.getElementById('ocrGapY');
    const showGridCheckbox = document.getElementById('ocrShowGrid');
    const extractWidthInput = document.getElementById('ocrExtractWidth');
    const extractHeightInput = document.getElementById('ocrExtractHeight');

    // ========== Constants ==========
    const GLYPH_ZOOM = 4;
    const SCREEN_BITMAP_SIZE = 6144; // 256×192 / 8
    const SKIP_CHAR = '\uFFFD'; // unknown/unmapped position marker in character maps
    const SPECTRUM_ASCII_MAP = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_\u00A3abcdefghijklmnopqrstuvwxyz{|}~\u00A9';
    // Spectrofon 224-char font (32 cols bitmap): Latin + Cyrillic uppercase + lowercase split across rows 5/7
    // Row 4: uppercase А-Я (32), Row 5: lowercase а-п (16) + unknown (16),
    // Row 6: unknown (32), Row 7: lowercase р-я (16) + Ёё (2) + unknown (14)
    const SPECTROFON_MAP = SPECTRUM_ASCII_MAP
        + '\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417\u0418\u0419\u041A\u041B\u041C\u041D\u041E\u041F\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427\u0428\u0429\u042A\u042B\u042C\u042D\u042E\u042F'
        + '\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0439\u043A\u043B\u043C\u043D\u043E\u043F'
        + SKIP_CHAR.repeat(16)
        + SKIP_CHAR.repeat(32)
        + '\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044A\u044B\u044C\u044D\u044E\u044F'
        + '\u0401\u0451'
        + SKIP_CHAR.repeat(14);

    // ========== State ==========
    let session = createDefaultSession();
    let capturedGlyphs = new Map(); // hash → { bytes: Uint8Array, w: number, h: number }, runtime only
    let glyphOrder = []; // insertion-order list of hashes (for grid display)
    let selectedGlyphs = new Set(); // hashes of selected glyphs for bulk operations
    let liveMode = true; // true = preview shows live memory; false = shows stored page screen

    // ========== Session / data model ==========

    function createDefaultSession() {
        const defaultCharset = createCharset('Default');
        return {
            charsets: [defaultCharset],
            activeCharsetId: defaultCharset.id,
            region: { x: 0, y: 0, w: 32, h: 24 }, // default region for new captures
            pages: [],
            currentPageIndex: 0
        };
    }

    // Page structure:
    // {
    //     text: string,
    //     timestamp: string,
    //     hashGrid: string[][],        // [row][col] = glyph hash
    //     gridRegion: { x, y, w, h },  // per-page region (in cell coords)
    //     screenData: string,           // base64-encoded 6144-byte bitmap
    //     screenBase: number,           // 0x4000 or 0xC000
    //     cellWidth: number,            // 4-8, pixel width at capture time
    //     cellHeight: number,           // 4-16, pixel height at capture time
    //     originX: number,              // 0 to cellWidth-1, grid origin X offset
    //     originY: number,              // 0 to cellHeight-1, grid origin Y offset
    //     gapX: number,                 // 0-8, horizontal gap between cells (pixels)
    //     gapY: number                  // 0-8, vertical gap between cells (pixels)
    // }

    function createCharset(name) {
        return {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: name,
            cellWidth: 8,
            cellHeight: 8,
            originX: 0,
            originY: 0,
            gapX: 0,
            gapY: 0,
            glyphs: {}
        };
    }

    function getActiveCharset() {
        return session.charsets.find(c => c.id === session.activeCharsetId) || session.charsets[0];
    }

    function getCurrentPage() {
        if (session.pages.length === 0) return null;
        const idx = Math.max(0, Math.min(session.currentPageIndex, session.pages.length - 1));
        session.currentPageIndex = idx;
        return session.pages[idx];
    }

    // ========== Screen data encode/decode ==========

    function captureScreenBytes(base) {
        const bytes = new Uint8Array(SCREEN_BITMAP_SIZE);
        if (base === 0xC000) {
            const page7 = getRAMPage(7);
            if (page7) {
                for (let i = 0; i < SCREEN_BITMAP_SIZE; i++) bytes[i] = page7[i];
            } else {
                for (let i = 0; i < SCREEN_BITMAP_SIZE; i++) bytes[i] = readMemory(0xC000 + i);
            }
        } else {
            for (let i = 0; i < SCREEN_BITMAP_SIZE; i++) bytes[i] = readMemory(0x4000 + i);
        }
        return bytes;
    }

    function screenBytesToBase64(bytes) {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }

    function base64ToScreenBytes(b64) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    // ========== Screen memory reading ==========

    function screenOffset(cy, cx, line) {
        // Offset within the 6144-byte bitmap block (no base added)
        return (((cy >> 3) & 3) << 11) | (line << 8) | ((cy & 7) << 5) | cx;
    }

    function readLiveScreenByte(base, cy, cx, line) {
        const addr = (base | screenOffset(cy, cx, line));
        if (base === 0xC000) {
            const page7 = getRAMPage(7);
            if (page7) return page7[addr & 0x3FFF];
            return readMemory(addr);
        }
        return readMemory(addr);
    }

    function readStoredByte(screenBytes, cy, cx, line) {
        return screenBytes[screenOffset(cy, cx, line)];
    }

    // ========== Pixel-level addressing (variable cell size) ==========

    // ZX Spectrum pixel addressing: returns offset within 6144-byte bitmap
    function pixelOffset(px, py) {
        const third = py >> 6;
        const charRow = (py >> 3) & 7;
        const line = py & 7;
        const byteCol = px >> 3;
        return (third << 11) | (line << 8) | (charRow << 5) | byteCol;
    }

    // Extract w pixels (1-8) starting at pixel column px from scanline py.
    // Returns one byte, left-aligned (bit 7 = leftmost pixel).
    // Handles byte-boundary crossing for non-aligned widths.
    function extractPixelByte(readByteFn, px, py, w) {
        const ofs = pixelOffset(px, py);
        const bitOfs = px & 7;
        const b0 = readByteFn(ofs);
        let val = (b0 << bitOfs) & 0xFF;
        if (bitOfs + w > 8) {
            const ofs1 = pixelOffset(px + 8 - bitOfs, py);
            const b1 = readByteFn(ofs1);
            val |= (b1 >> (8 - bitOfs));
        }
        return val & ((0xFF << (8 - w)) & 0xFF);
    }

    // Read a cw×ch pixel block at cell position (col, row) with origin offset (ox, oy) and gaps (gx, gy)
    function readGlyphFromScreen(readByteFn, col, row, cw, ch, ox, oy, gx, gy) {
        gx = gx || 0; gy = gy || 0;
        const px = ox + col * (cw + gx);
        const py = oy + row * (ch + gy);
        const bytes = new Uint8Array(ch);
        for (let line = 0; line < ch; line++) {
            bytes[line] = extractPixelByte(readByteFn, px, py + line, cw);
        }
        return bytes;
    }

    // Legacy wrappers using readGlyphFromScreen
    function readGlyphLive(base, cy, cx, cw, ch, ox, oy, gx, gy) {
        cw = cw || 8; ch = ch || 8; ox = ox || 0; oy = oy || 0; gx = gx || 0; gy = gy || 0;
        const readFn = (ofs) => {
            const addr = base | ofs;
            if (base === 0xC000) {
                const page7 = getRAMPage(7);
                if (page7) return page7[addr & 0x3FFF];
                return readMemory(addr);
            }
            return readMemory(addr);
        };
        return readGlyphFromScreen(readFn, cx, cy, cw, ch, ox, oy, gx, gy);
    }

    function readGlyphStored(screenBytes, cy, cx, cw, ch, ox, oy, gx, gy) {
        cw = cw || 8; ch = ch || 8; ox = ox || 0; oy = oy || 0; gx = gx || 0; gy = gy || 0;
        const readFn = (ofs) => screenBytes[ofs];
        return readGlyphFromScreen(readFn, cx, cy, cw, ch, ox, oy, gx, gy);
    }

    function glyphHash(bytes, h) {
        h = h || bytes.length;
        let s = '';
        for (let i = 0; i < h; i++) {
            s += ((bytes[i] >> 4) & 0xF).toString(16).toUpperCase();
            s += (bytes[i] & 0xF).toString(16).toUpperCase();
        }
        return s;
    }

    function hashToBytes(hash) {
        const len = hash.length >> 1;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = parseInt(hash.substr(i * 2, 2), 16);
        }
        return bytes;
    }

    // Glyph states: 'mapped' (has character), 'skipped' (explicitly empty), 'unmapped' (no entry)
    function glyphState(charset, hash) {
        if (!(hash in charset.glyphs)) return 'unmapped';
        return charset.glyphs[hash].length > 0 ? 'mapped' : 'skipped';
    }

    // Look up a glyph across ALL charsets (active first). Returns { char, state } or null.
    function glyphLookupAll(hash) {
        const active = getActiveCharset();
        if (hash in active.glyphs) {
            return active.glyphs[hash].length > 0
                ? { char: active.glyphs[hash], state: 'mapped' }
                : { char: '', state: 'skipped' };
        }
        for (const cs of session.charsets) {
            if (cs.id === session.activeCharsetId) continue;
            if (hash in cs.glyphs) {
                return cs.glyphs[hash].length > 0
                    ? { char: cs.glyphs[hash], state: 'mapped' }
                    : { char: '', state: 'skipped' };
            }
        }
        return null;
    }

    function glyphStateAll(hash) {
        const r = glyphLookupAll(hash);
        return r ? r.state : 'unmapped';
    }

    function glyphCharAll(hash) {
        const r = glyphLookupAll(hash);
        return r && r.state === 'mapped' ? r.char : null;
    }

    // Track glyph insertion order
    function trackGlyphOrder(hash) {
        if (!glyphOrder.includes(hash)) glyphOrder.push(hash);
    }

    // ========== Preview canvas ==========

    function renderPreview() {
        const imgData = previewCtx.createImageData(256, 192);
        const data = imgData.data;
        const page = getCurrentPage();

        if (!liveMode && page && page.screenData) {
            // Render from stored screen
            const screenBytes = base64ToScreenBytes(page.screenData);
            for (let cy = 0; cy < 24; cy++) {
                for (let cx = 0; cx < 32; cx++) {
                    for (let line = 0; line < 8; line++) {
                        const byte = readStoredByte(screenBytes, cy, cx, line);
                        const py = cy * 8 + line;
                        for (let bit = 0; bit < 8; bit++) {
                            const px = cx * 8 + bit;
                            const v = ((byte >> (7 - bit)) & 1) ? 255 : 0;
                            const idx = (py * 256 + px) * 4;
                            data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255;
                        }
                    }
                }
            }
        } else {
            // Render from live memory
            const base = parseInt(sourceSelect.value, 16);
            for (let cy = 0; cy < 24; cy++) {
                for (let cx = 0; cx < 32; cx++) {
                    for (let line = 0; line < 8; line++) {
                        const byte = readLiveScreenByte(base, cy, cx, line);
                        const py = cy * 8 + line;
                        for (let bit = 0; bit < 8; bit++) {
                            const px = cx * 8 + bit;
                            const v = ((byte >> (7 - bit)) & 1) ? 255 : 0;
                            const idx = (py * 256 + px) * 4;
                            data[idx] = v; data[idx + 1] = v; data[idx + 2] = v; data[idx + 3] = 255;
                        }
                    }
                }
            }
        }

        previewCtx.putImageData(imgData, 0, 0);

        // Draw grid and region overlays on the overlay canvas at display resolution
        renderGridOverlay();
    }

    function renderGridOverlay() {
        const z = previewZoom;
        gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);

        const cs = getActiveCharset();
        const cw = cs.cellWidth, ch = cs.cellHeight;
        const ox = cs.originX || 0, oy = cs.originY || 0;
        const gx = cs.gapX || 0, gy = cs.gapY || 0;
        const stepX = cw + gx, stepY = ch + gy;
        const maxCols = Math.floor((256 - ox) / stepX);
        const maxRows = Math.floor((192 - oy) / stepY);

        // Grid overlay (toggleable)
        if (showGridCheckbox.checked) {
            gridCtx.strokeStyle = 'rgba(255, 165, 0, 0.6)';
            gridCtx.lineWidth = 1;
            for (let c = 0; c <= maxCols; c++) {
                const x = Math.round((ox + c * stepX) * z) + 0.5;
                gridCtx.beginPath();
                gridCtx.moveTo(x, oy * z);
                gridCtx.lineTo(x, (oy + maxRows * stepY) * z);
                gridCtx.stroke();
                // Right edge of cell (if gap > 0, show cell boundary)
                if (gx > 0 && c < maxCols) {
                    const x2 = Math.round((ox + c * stepX + cw) * z) + 0.5;
                    gridCtx.beginPath();
                    gridCtx.moveTo(x2, oy * z);
                    gridCtx.lineTo(x2, (oy + maxRows * stepY) * z);
                    gridCtx.stroke();
                }
            }
            for (let r2 = 0; r2 <= maxRows; r2++) {
                const y = Math.round((oy + r2 * stepY) * z) + 0.5;
                gridCtx.beginPath();
                gridCtx.moveTo(ox * z, y);
                gridCtx.lineTo((ox + maxCols * stepX) * z, y);
                gridCtx.stroke();
                // Bottom edge of cell (if gap > 0, show cell boundary)
                if (gy > 0 && r2 < maxRows) {
                    const y2 = Math.round((oy + r2 * stepY + ch) * z) + 0.5;
                    gridCtx.beginPath();
                    gridCtx.moveTo(ox * z, y2);
                    gridCtx.lineTo((ox + maxCols * stepX) * z, y2);
                    gridCtx.stroke();
                }
            }

            // Origin point marker (colored crosshair at grid origin)
            if (ox > 0 || oy > 0) {
                const armLen = Math.max(cw, ch, 5) * z;
                const mx = Math.round(ox * z) + 0.5;
                const my = Math.round(oy * z) + 0.5;
                gridCtx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
                gridCtx.lineWidth = 1;
                gridCtx.beginPath();
                gridCtx.moveTo(mx - armLen, my); gridCtx.lineTo(mx + armLen, my);
                gridCtx.moveTo(mx, my - armLen); gridCtx.lineTo(mx, my + armLen);
                gridCtx.stroke();
                gridCtx.fillStyle = 'rgba(255, 80, 80, 0.9)';
                gridCtx.fillRect(mx - 1.5, my - 1.5, 3, 3);
            }
        }

        // Region overlay (dashed cyan)
        const r = getActiveRegion();
        gridCtx.strokeStyle = '#00ffff';
        gridCtx.lineWidth = 1;
        gridCtx.setLineDash([4, 3]);
        gridCtx.strokeRect(
            Math.round((ox + r.x * stepX) * z) + 0.5,
            Math.round((oy + r.y * stepY) * z) + 0.5,
            (r.w * stepX - gx) * z - 1,
            (r.h * stepY - gy) * z - 1
        );
        gridCtx.setLineDash([]);
    }

    // ========== Region helpers ==========

    // The "active region" is per-page when viewing a stored page, or session.region in live mode.
    function getActiveRegion() {
        if (!liveMode) {
            const page = getCurrentPage();
            if (page && page.gridRegion) return page.gridRegion;
        }
        return session.region;
    }

    function setActiveRegion(r) {
        if (!liveMode) {
            const page = getCurrentPage();
            if (page) {
                page.gridRegion = r;
                return;
            }
        }
        session.region = r;
    }

    function clampRegion() {
        const cs = getActiveCharset();
        const cw = cs.cellWidth, ch = cs.cellHeight;
        const ox = cs.originX || 0, oy = cs.originY || 0;
        const gx = cs.gapX || 0, gy = cs.gapY || 0;
        const maxCols = Math.floor((256 - ox) / (cw + gx));
        const maxRows = Math.floor((192 - oy) / (ch + gy));

        let x = parseInt(regionX.value) || 0;
        let y = parseInt(regionY.value) || 0;
        let w = parseInt(regionW.value) || 1;
        let h = parseInt(regionH.value) || 1;

        x = Math.max(0, Math.min(maxCols - 1, x));
        y = Math.max(0, Math.min(maxRows - 1, y));
        w = Math.max(1, Math.min(maxCols - x, w));
        h = Math.max(1, Math.min(maxRows - y, h));

        regionX.value = x;
        regionY.value = y;
        regionW.value = w;
        regionH.value = h;

        // Update max attributes dynamically
        regionX.max = maxCols - 1;
        regionY.max = maxRows - 1;
        regionW.max = maxCols;
        regionH.max = maxRows;

        setActiveRegion({ x, y, w, h });
    }

    function syncRegionToSpinners() {
        const r = getActiveRegion();
        regionX.value = r.x;
        regionY.value = r.y;
        regionW.value = r.w;
        regionH.value = r.h;
    }

    // ========== Capture engine ==========

    function isKnownGlyph(hash) {
        for (const cs of session.charsets) {
            if (hash in cs.glyphs) return true;
        }
        return false;
    }

    function captureFromLive() {
        const base = parseInt(sourceSelect.value, 16);
        const r = getActiveRegion();
        const cs = getActiveCharset();
        const cw = cs.cellWidth, ch = cs.cellHeight;
        const ox = cs.originX || 0, oy = cs.originY || 0;
        const gx = cs.gapX || 0, gy = cs.gapY || 0;
        const screenBytes = captureScreenBytes(base);
        const hashGrid = [];
        const readFn = (ofs) => screenBytes[ofs];
        const knownOnly = captureKnownCheckbox.checked;

        for (let row = 0; row < r.h; row++) {
            const hashRow = [];
            for (let col = 0; col < r.w; col++) {
                const bytes = readGlyphFromScreen(readFn, r.x + col, r.y + row, cw, ch, ox, oy, gx, gy);
                const hash = glyphHash(bytes, ch);
                if (knownOnly && !isKnownGlyph(hash)) {
                    hashRow.push('');
                } else {
                    hashRow.push(hash);
                    if (!capturedGlyphs.has(hash)) {
                        capturedGlyphs.set(hash, { bytes: bytes.slice(), w: cw, h: ch });
                        trackGlyphOrder(hash);
                    }
                }
            }
            hashGrid.push(hashRow);
        }

        return {
            hashGrid,
            gridRegion: { x: r.x, y: r.y, w: r.w, h: r.h },
            screenData: screenBytesToBase64(screenBytes),
            screenBase: base,
            cellWidth: cw,
            cellHeight: ch,
            originX: ox,
            originY: oy,
            gapX: gx,
            gapY: gy
        };
    }

    // Re-extract hash grid from a page's stored screen using its region
    function reExtractPage(page) {
        if (!page.screenData) return;
        const screenBytes = base64ToScreenBytes(page.screenData);
        const r = page.gridRegion;
        const cw = page.cellWidth || 8, ch = page.cellHeight || 8;
        const ox = page.originX || 0, oy = page.originY || 0;
        const gx = page.gapX || 0, gy = page.gapY || 0;
        const readFn = (ofs) => screenBytes[ofs];
        const hashGrid = [];

        for (let row = 0; row < r.h; row++) {
            const hashRow = [];
            for (let col = 0; col < r.w; col++) {
                const bytes = readGlyphFromScreen(readFn, r.x + col, r.y + row, cw, ch, ox, oy, gx, gy);
                const hash = glyphHash(bytes, ch);
                hashRow.push(hash);
                if (!capturedGlyphs.has(hash)) {
                    capturedGlyphs.set(hash, { bytes: bytes.slice(), w: cw, h: ch });
                    trackGlyphOrder(hash);
                }
            }
            hashGrid.push(hashRow);
        }

        page.hashGrid = hashGrid;
        regeneratePageText(page);
    }

    function renderTextFromGrid(hashGrid) {
        const lines = [];
        for (const row of hashGrid) {
            let line = '';
            for (const hash of row) {
                if (hash === '') { line += ' '; continue; }
                const ch = glyphCharAll(hash);
                if (ch !== null) line += ch;
                else if (glyphStateAll(hash) === 'skipped') line += '';
                else line += '?';
            }
            lines.push(line);
        }
        return lines.join('\n');
    }

    function regeneratePageText(page) {
        page.text = renderTextFromGrid(page.hashGrid);
    }

    function regenerateAllPages() {
        for (const page of session.pages) regeneratePageText(page);
    }

    // ========== Glyph grid ==========

    function collectAllGlyphHashes() {
        const hashes = new Set();
        for (const page of session.pages) {
            for (const row of page.hashGrid) {
                for (const hash of row) hashes.add(hash);
            }
        }
        // Include extracted font glyphs from the active charset only
        const activeCs = getActiveCharset();
        for (const hash in activeCs.glyphs) {
            if (capturedGlyphs.has(hash)) hashes.add(hash);
        }
        return hashes;
    }

    function renderGlyphTile(hash, duplicateChars) {
        const state = glyphStateAll(hash);
        const chr = glyphCharAll(hash);
        const charStr = state === 'mapped' ? chr : state === 'skipped' ? '–' : '?';
        const isDuplicate = showDupesCheckbox.checked && state === 'mapped' && duplicateChars.has(chr);

        const tile = document.createElement('div');
        tile.className = 'ocr-glyph-tile ' + state;
        tile.dataset.hash = hash;

        const glyph = capturedGlyphs.get(hash);
        const gw = glyph ? glyph.w : 8;
        const gh = glyph ? glyph.h : 8;

        const canvas = document.createElement('canvas');
        canvas.width = gw * GLYPH_ZOOM;
        canvas.height = gh * GLYPH_ZOOM;
        const ctx = canvas.getContext('2d');

        if (glyph) {
            const bytes = glyph.bytes;
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = gw;
            tmpCanvas.height = gh;
            const tmpCtx = tmpCanvas.getContext('2d');
            const imgData = tmpCtx.createImageData(gw, gh);
            const d = imgData.data;
            for (let line = 0; line < gh; line++) {
                for (let bit = 0; bit < gw; bit++) {
                    const v = ((bytes[line] >> (7 - bit)) & 1) ? 255 : 0;
                    const idx = (line * gw + bit) * 4;
                    d[idx] = v; d[idx + 1] = v; d[idx + 2] = v; d[idx + 3] = 255;
                }
            }
            tmpCtx.putImageData(imgData, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tmpCanvas, 0, 0, gw, gh, 0, 0, gw * GLYPH_ZOOM, gh * GLYPH_ZOOM);
        }

        if (isDuplicate) {
            const cw = gw * GLYPH_ZOOM, ch2 = gh * GLYPH_ZOOM;
            ctx.strokeStyle = '#e33';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(1, 1); ctx.lineTo(cw - 1, ch2 - 1);
            ctx.moveTo(cw - 1, 1); ctx.lineTo(1, ch2 - 1);
            ctx.stroke();
        }

        // Dynamic tile width via inline style
        tile.style.width = (gw * GLYPH_ZOOM + 8) + 'px';

        tile.appendChild(canvas);

        const label = document.createElement('div');
        label.className = 'ocr-glyph-label' + (state !== 'mapped' ? ' ' + state : '');
        label.textContent = charStr;
        tile.appendChild(label);

        if (selectedGlyphs.has(hash)) tile.classList.add('selected');

        tile.addEventListener('click', (e) => {
            if (tile.classList.contains('editing')) return;
            if (e.ctrlKey || e.metaKey) {
                // Toggle selection
                if (selectedGlyphs.has(hash)) {
                    selectedGlyphs.delete(hash);
                    tile.classList.remove('selected');
                } else {
                    selectedGlyphs.add(hash);
                    tile.classList.add('selected');
                }
                updateDeleteSelectedBtn();
                return;
            }
            // Clear selection on normal click
            if (selectedGlyphs.size > 0) {
                selectedGlyphs.clear();
                glyphGrid.querySelectorAll('.ocr-glyph-tile.selected').forEach(t => t.classList.remove('selected'));
                updateDeleteSelectedBtn();
            }
            startGlyphEdit(tile, hash);
        });

        return tile;
    }

    function updateDeleteSelectedBtn() {
        if (selectedGlyphs.size > 0) {
            btnDeleteSelected.classList.remove('hidden');
            btnDeleteSelected.textContent = `Del ${selectedGlyphs.size} selected`;
        } else {
            btnDeleteSelected.classList.add('hidden');
        }
    }

    function startGlyphEdit(tile, hash) {
        const charset = getActiveCharset();
        const current = charset.glyphs[hash] || '';

        tile.classList.add('editing');

        const label = tile.querySelector('.ocr-glyph-label');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ocr-glyph-input';
        input.value = current;
        input.maxLength = 4;
        label.replaceWith(input);
        input.focus();
        input.select();

        function commit() {
            charset.glyphs[hash] = input.value; // empty string = skipped

            regenerateAllPages();
            refreshTextOutput();
            renderGlyphGrid();
            saveSession();
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Delete' && input.value === '') {
                // Delete key on empty input = remove mapping entirely (unmapped)
                e.preventDefault();
                delete charset.glyphs[hash];
                regenerateAllPages();
                refreshTextOutput();
                renderGlyphGrid();
                saveSession();
            }
            else if (e.key === 'Escape') {
                e.preventDefault();
                tile.classList.remove('editing');
                const st = glyphStateAll(hash);
                const c = glyphCharAll(hash);
                const displayStr = st === 'mapped' ? c : st === 'skipped' ? '–' : '?';
                const newLabel = document.createElement('div');
                newLabel.className = 'ocr-glyph-label' + (st !== 'mapped' ? ' ' + st : '');
                newLabel.textContent = displayStr;
                input.replaceWith(newLabel);
            }
        });
        input.addEventListener('blur', () => {
            if (tile.classList.contains('editing')) commit();
        });
    }

    function renderGlyphGrid() {
        const allHashes = collectAllGlyphHashes();

        let mapped = 0, unmapped = 0, skipped = 0;
        for (const hash of allHashes) {
            const st = glyphStateAll(hash);
            if (st === 'mapped') mapped++;
            else if (st === 'skipped') skipped++;
            else unmapped++;
        }

        // Build set of characters mapped to more than one glyph hash
        const charToHashes = new Map();
        for (const hash of allHashes) {
            const ch = glyphCharAll(hash);
            if (ch !== null) {
                if (!charToHashes.has(ch)) charToHashes.set(ch, []);
                charToHashes.get(ch).push(hash);
            }
        }
        const duplicateChars = new Set();
        for (const [ch, hashes] of charToHashes) {
            if (hashes.length > 1) duplicateChars.add(ch);
        }

        if (allHashes.size === 0) {
            glyphHeader.textContent = 'No glyphs captured';
        } else {
            const parts = [`${allHashes.size} glyphs (${mapped} mapped`];
            if (unmapped > 0) parts.push(`${unmapped} unmapped`);
            if (skipped > 0) parts.push(`${skipped} skipped`);
            if (duplicateChars.size > 0) parts.push(`${duplicateChars.size} dupes`);
            glyphHeader.textContent = parts.join(', ') + ')';
        }

        glyphGrid.innerHTML = '';

        // Display in insertion order (extraction order / capture order)
        // glyphOrder tracks sequence; filter to only those present in allHashes
        const ordered = [];
        const inOrder = new Set();
        for (const hash of glyphOrder) {
            if (allHashes.has(hash) && !inOrder.has(hash)) {
                ordered.push(hash);
                inOrder.add(hash);
            }
        }
        // Append any hashes not yet in glyphOrder (shouldn't happen, but safety)
        for (const hash of allHashes) {
            if (!inOrder.has(hash)) ordered.push(hash);
        }

        for (const hash of ordered) glyphGrid.appendChild(renderGlyphTile(hash, duplicateChars));

        // Prune stale selections and update button
        for (const hash of selectedGlyphs) {
            if (!allHashes.has(hash)) selectedGlyphs.delete(hash);
        }
        updateDeleteSelectedBtn();
    }

    // ========== Text output + pages ==========

    function refreshTextOutput() {
        const page = getCurrentPage();
        textOutput.value = page ? page.text : '';
        updatePageLabel();
    }

    function updatePageLabel() {
        if (session.pages.length === 0) {
            pageLabel.textContent = 'No pages';
        } else {
            pageLabel.textContent = `Page ${session.currentPageIndex + 1}/${session.pages.length}`;
        }
    }

    function navigateToPage() {
        const page = getCurrentPage();
        if (page) {
            liveMode = false;
            syncRegionToSpinners();
        } else {
            liveMode = true;
            syncRegionToSpinners();
        }
        renderPreview();
        refreshTextOutput();
    }

    // ========== Charset management ==========

    function populateCharsetDropdown() {
        charsetSelect.innerHTML = '';
        for (const cs of session.charsets) {
            const opt = document.createElement('option');
            opt.value = cs.id;
            opt.textContent = cs.name;
            if (cs.id === session.activeCharsetId) opt.selected = true;
            charsetSelect.appendChild(opt);
        }
    }

    // ========== Rebuild glyph bitmaps from stored screens ==========

    function rebuildCapturedGlyphs() {
        capturedGlyphs.clear();
        glyphOrder = [];

        // Pass 1: rebuild from stored screen data (page grid order preserved)
        for (const page of session.pages) {
            if (!page.screenData || !page.gridRegion) continue;
            const screenBytes = base64ToScreenBytes(page.screenData);
            const r = page.gridRegion;
            const cw = page.cellWidth || 8, ch = page.cellHeight || 8;
            const ox = page.originX || 0, oy = page.originY || 0;
            const gx = page.gapX || 0, gy = page.gapY || 0;
            const readFn = (ofs) => screenBytes[ofs];
            const pageCols = Math.floor((256 - ox) / (cw + gx));
            const pageRows = Math.floor((192 - oy) / (ch + gy));
            // Rebuild in grid order (left-to-right, top-to-bottom within region)
            for (let row = 0; row < r.h; row++) {
                for (let col = 0; col < r.w; col++) {
                    const bytes = readGlyphFromScreen(readFn, r.x + col, r.y + row, cw, ch, ox, oy, gx, gy);
                    const hash = glyphHash(bytes, ch);
                    if (!capturedGlyphs.has(hash)) {
                        capturedGlyphs.set(hash, { bytes: bytes.slice(), w: cw, h: ch });
                        trackGlyphOrder(hash);
                    }
                }
            }
            // Also scan appended rows (hashGrid may be taller than gridRegion)
            if (page.hashGrid && page.hashGrid.length > r.h) {
                for (let ri = r.h; ri < page.hashGrid.length; ri++) {
                    for (const hash of page.hashGrid[ri]) {
                        if (!capturedGlyphs.has(hash)) {
                            // Try to find bitmap from full screen scan
                            for (let cy = 0; cy < pageRows; cy++) {
                                for (let cx = 0; cx < pageCols; cx++) {
                                    const bytes = readGlyphFromScreen(readFn, cx, cy, cw, ch, ox, oy, gx, gy);
                                    const h2 = glyphHash(bytes, ch);
                                    if (h2 === hash) {
                                        capturedGlyphs.set(hash, { bytes: bytes.slice(), w: cw, h: ch });
                                        trackGlyphOrder(hash);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Pass 1b: ensure all page grid hashes have bitmaps (full screen scan)
        for (const page of session.pages) {
            if (!page.screenData) continue;
            const screenBytes = base64ToScreenBytes(page.screenData);
            const cw = page.cellWidth || 8, ch = page.cellHeight || 8;
            const ox = page.originX || 0, oy = page.originY || 0;
            const gx = page.gapX || 0, gy = page.gapY || 0;
            const readFn = (ofs) => screenBytes[ofs];
            const pageCols = Math.floor((256 - ox) / (cw + gx));
            const pageRows = Math.floor((192 - oy) / (ch + gy));
            for (const row of page.hashGrid) {
                for (const hash of row) {
                    if (!capturedGlyphs.has(hash)) {
                        for (let cy = 0; cy < pageRows; cy++) {
                            for (let cx = 0; cx < pageCols; cx++) {
                                const bytes = readGlyphFromScreen(readFn, cx, cy, cw, ch, ox, oy, gx, gy);
                                const h2 = glyphHash(bytes, ch);
                                if (!capturedGlyphs.has(h2)) {
                                    capturedGlyphs.set(h2, { bytes: bytes.slice(), w: cw, h: ch });
                                    trackGlyphOrder(h2);
                                }
                            }
                        }
                        break; // full scan done once per page
                    }
                }
            }
        }

        // Pass 2: add charset glyphs that have no bitmap yet (extracted fonts
        // without pages) — reconstruct bitmap from hash string and add to order
        for (const cs of session.charsets) {
            for (const hash in cs.glyphs) {
                if (!capturedGlyphs.has(hash)) {
                    const bytes = hashToBytes(hash);
                    capturedGlyphs.set(hash, { bytes, w: cs.cellWidth || 8, h: bytes.length });
                }
                trackGlyphOrder(hash);
            }
        }

        // Pass 3: fallback to live screen for any hashes still missing
        const needed = collectAllGlyphHashes();
        let missing = 0;
        for (const hash of needed) {
            if (!capturedGlyphs.has(hash)) missing++;
        }
        if (missing > 0) {
            const cs = getActiveCharset();
            const cw = cs.cellWidth, ch = cs.cellHeight;
            const ox = cs.originX || 0, oy = cs.originY || 0;
            const gx = cs.gapX || 0, gy = cs.gapY || 0;
            const liveCols = Math.floor((256 - ox) / (cw + gx));
            const liveRows = Math.floor((192 - oy) / (ch + gy));
            const base = parseInt(sourceSelect.value, 16);
            for (let cy = 0; cy < liveRows; cy++) {
                for (let cx = 0; cx < liveCols; cx++) {
                    const bytes = readGlyphLive(base, cy, cx, cw, ch, ox, oy, gx, gy);
                    const hash = glyphHash(bytes, ch);
                    if (needed.has(hash) && !capturedGlyphs.has(hash)) {
                        capturedGlyphs.set(hash, { bytes: bytes.slice(), w: cw, h: ch });
                        trackGlyphOrder(hash);
                    }
                }
            }
        }
    }

    // ========== Preview canvas mouse drag ==========

    let dragStart = null;

    function canvasToCell(e) {
        const cs = getActiveCharset();
        const cw = cs.cellWidth, ch = cs.cellHeight;
        const ox = cs.originX || 0, oy = cs.originY || 0;
        const gx = cs.gapX || 0, gy = cs.gapY || 0;
        const stepX = cw + gx, stepY = ch + gy;
        const maxCols = Math.floor((256 - ox) / stepX);
        const maxRows = Math.floor((192 - oy) / stepY);
        const rect = previewCanvas.getBoundingClientRect();
        const scaleX = 256 / rect.width;
        const scaleY = 192 / rect.height;
        const px = (e.clientX - rect.left) * scaleX;
        const py = (e.clientY - rect.top) * scaleY;
        return {
            cx: Math.max(0, Math.min(maxCols - 1, Math.floor((px - ox) / stepX))),
            cy: Math.max(0, Math.min(maxRows - 1, Math.floor((py - oy) / stepY)))
        };
    }

    previewCanvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        dragStart = canvasToCell(e);
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragStart) return;
        const cur = canvasToCell(e);
        const x1 = Math.min(dragStart.cx, cur.cx);
        const y1 = Math.min(dragStart.cy, cur.cy);
        const x2 = Math.max(dragStart.cx, cur.cx);
        const y2 = Math.max(dragStart.cy, cur.cy);
        setActiveRegion({ x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 });
        syncRegionToSpinners();
        renderPreview();
    });

    document.addEventListener('mouseup', (e) => {
        if (!dragStart) return;
        const cur = canvasToCell(e);
        const x1 = Math.min(dragStart.cx, cur.cx);
        const y1 = Math.min(dragStart.cy, cur.cy);
        const x2 = Math.max(dragStart.cx, cur.cx);
        const y2 = Math.max(dragStart.cy, cur.cy);
        setActiveRegion({ x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 });
        syncRegionToSpinners();
        dragStart = null;

        // If viewing a stored page, re-extract with new region
        if (!liveMode) {
            const page = getCurrentPage();
            if (page && page.screenData) {
                reExtractPage(page);
                renderGlyphGrid();
                refreshTextOutput();
            }
        }

        renderPreview();
        saveSession();
    });

    // ========== Persistence ==========

    function saveSession() {
        // No-op: session is saved/loaded as file only
    }

    // ========== Full UI refresh ==========

    function refreshAll() {
        populateCharsetDropdown();
        // Sync CW/CH/OX/OY from active charset
        const cs = getActiveCharset();
        cellWidthInput.value = cs.cellWidth;
        cellHeightInput.value = cs.cellHeight;
        originXInput.value = cs.originX || 0;
        originYInput.value = cs.originY || 0;
        gapXInput.value = cs.gapX || 0;
        gapYInput.value = cs.gapY || 0;
        originXInput.max = cs.cellWidth - 1;
        originYInput.max = cs.cellHeight - 1;
        rebuildCapturedGlyphs();
        // If we have pages, show the current page; otherwise live mode
        if (session.pages.length > 0) {
            liveMode = false;
        } else {
            liveMode = true;
        }
        syncRegionToSpinners();
        renderPreview();
        renderGlyphGrid();
        refreshTextOutput();
    }

    // ========== Status update helper ==========

    function updateStatus() {
        const allHashes = collectAllGlyphHashes();
        let unmapped = 0;
        for (const hash of allHashes) {
            if (glyphStateAll(hash) === 'unmapped') unmapped++;
        }
        statusSpan.textContent = allHashes.size === 0 ? ''
            : unmapped > 0 ? `(${unmapped} unmapped)` : '(all mapped)';
    }

    // ========== Event handlers ==========

    // Region spinners
    [regionX, regionY, regionW, regionH].forEach(el => {
        el.addEventListener('change', () => {
            clampRegion();
            // If viewing a stored page, re-extract with new region
            if (!liveMode) {
                const page = getCurrentPage();
                if (page && page.screenData) {
                    reExtractPage(page);
                    renderGlyphGrid();
                    refreshTextOutput();
                    updateStatus();
                }
            }
            renderPreview();
            saveSession();
        });
    });

    // Source selector
    sourceSelect.addEventListener('change', () => {
        if (liveMode) renderPreview();
    });

    // Refresh — switch to live mode and re-read screen memory
    btnRefresh.addEventListener('click', () => {
        liveMode = true;
        syncRegionToSpinners();
        renderPreview();
    });

    // Capture — always from live memory, replaces current page
    btnCapture.addEventListener('click', () => {
        liveMode = true; // read from live
        clampRegion();
        const result = captureFromLive();

        if (session.pages.length === 0) {
            session.pages.push({
                text: '',
                timestamp: new Date().toISOString(),
                hashGrid: result.hashGrid,
                gridRegion: result.gridRegion,
                screenData: result.screenData,
                screenBase: result.screenBase,
                cellWidth: result.cellWidth,
                cellHeight: result.cellHeight,
                originX: result.originX,
                originY: result.originY,
                gapX: result.gapX,
                gapY: result.gapY
            });
            session.currentPageIndex = 0;
        } else {
            const page = getCurrentPage();
            page.hashGrid = result.hashGrid;
            page.gridRegion = result.gridRegion;
            page.screenData = result.screenData;
            page.screenBase = result.screenBase;
            page.cellWidth = result.cellWidth;
            page.cellHeight = result.cellHeight;
            page.originX = result.originX;
            page.originY = result.originY;
            page.gapX = result.gapX;
            page.gapY = result.gapY;
            page.timestamp = new Date().toISOString();
        }

        liveMode = false; // now show the stored page
        regenerateAllPages();
        renderGlyphGrid();
        refreshTextOutput();
        renderPreview();
        updateStatus();
        saveSession();
        showMessage(`Captured ${result.hashGrid.length}×${result.hashGrid[0].length} cells, ${collectAllGlyphHashes().size} unique glyphs`);
    });

    // Append — capture from live memory, append rows to current page
    btnAppend.addEventListener('click', () => {
        liveMode = true;
        clampRegion();
        const result = captureFromLive();

        if (session.pages.length === 0) {
            session.pages.push({
                text: '',
                timestamp: new Date().toISOString(),
                hashGrid: result.hashGrid,
                gridRegion: result.gridRegion,
                screenData: result.screenData,
                screenBase: result.screenBase,
                cellWidth: result.cellWidth,
                cellHeight: result.cellHeight,
                originX: result.originX,
                originY: result.originY,
                gapX: result.gapX,
                gapY: result.gapY
            });
            session.currentPageIndex = 0;
        } else {
            const page = getCurrentPage();
            for (const row of result.hashGrid) page.hashGrid.push(row);
            // Update stored screen to latest capture
            page.screenData = result.screenData;
            page.screenBase = result.screenBase;
            page.cellWidth = result.cellWidth;
            page.cellHeight = result.cellHeight;
            page.originX = result.originX;
            page.originY = result.originY;
            page.gapX = result.gapX;
            page.gapY = result.gapY;
            page.timestamp = new Date().toISOString();
        }

        liveMode = false;
        regenerateAllPages();
        renderGlyphGrid();
        refreshTextOutput();
        renderPreview();
        updateStatus();
        saveSession();
        showMessage('Appended capture to current page');
    });

    // New Page — capture from live memory into a new page
    btnNewPage.addEventListener('click', () => {
        liveMode = true;
        clampRegion();
        // Copy current region for the new page
        const r = getActiveRegion();
        session.region = { ...r }; // snapshot into session.region before capture
        const result = captureFromLive();

        session.pages.push({
            text: '',
            timestamp: new Date().toISOString(),
            hashGrid: result.hashGrid,
            gridRegion: result.gridRegion,
            screenData: result.screenData,
            screenBase: result.screenBase,
            cellWidth: result.cellWidth,
            cellHeight: result.cellHeight,
            originX: result.originX,
            originY: result.originY,
            gapX: result.gapX,
            gapY: result.gapY
        });
        session.currentPageIndex = session.pages.length - 1;

        liveMode = false;
        regenerateAllPages();
        renderGlyphGrid();
        refreshTextOutput();
        renderPreview();
        updateStatus();
        saveSession();
        showMessage(`New page ${session.pages.length} created`);
    });

    // Delete Page
    btnDelPage.addEventListener('click', () => {
        if (session.pages.length === 0) return;
        session.pages.splice(session.currentPageIndex, 1);
        if (session.currentPageIndex >= session.pages.length && session.pages.length > 0) {
            session.currentPageIndex = session.pages.length - 1;
        }
        if (session.pages.length === 0) liveMode = true;
        rebuildCapturedGlyphs();
        navigateToPage();
        renderGlyphGrid();
        updateStatus();
        saveSession();
        showMessage('Page deleted');
    });

    // Page nav
    btnPagePrev.addEventListener('click', () => {
        if (session.currentPageIndex > 0) {
            session.currentPageIndex--;
            navigateToPage();
        }
    });

    btnPageNext.addEventListener('click', () => {
        if (session.currentPageIndex < session.pages.length - 1) {
            session.currentPageIndex++;
            navigateToPage();
        }
    });

    // CW/CH/OX/OY/GX/GY change handlers
    [cellWidthInput, cellHeightInput, originXInput, originYInput, gapXInput, gapYInput].forEach(el => el.addEventListener('change', () => {
        const cs = getActiveCharset();
        cs.cellWidth = Math.max(4, Math.min(8, parseInt(cellWidthInput.value) || 8));
        cs.cellHeight = Math.max(4, Math.min(16, parseInt(cellHeightInput.value) || 8));
        cs.originX = Math.max(0, Math.min(cs.cellWidth - 1, parseInt(originXInput.value) || 0));
        cs.originY = Math.max(0, Math.min(cs.cellHeight - 1, parseInt(originYInput.value) || 0));
        cs.gapX = Math.max(0, Math.min(8, parseInt(gapXInput.value) || 0));
        cs.gapY = Math.max(0, Math.min(8, parseInt(gapYInput.value) || 0));
        // Sync inputs and OX/OY max
        cellWidthInput.value = cs.cellWidth;
        cellHeightInput.value = cs.cellHeight;
        originXInput.value = cs.originX;
        originYInput.value = cs.originY;
        gapXInput.value = cs.gapX;
        gapYInput.value = cs.gapY;
        originXInput.max = cs.cellWidth - 1;
        originYInput.max = cs.cellHeight - 1;
        // Reset region to full screen with new grid
        const maxCols = Math.floor((256 - cs.originX) / (cs.cellWidth + cs.gapX));
        const maxRows = Math.floor((192 - cs.originY) / (cs.cellHeight + cs.gapY));
        setActiveRegion({ x: 0, y: 0, w: maxCols, h: maxRows });
        clampRegion();
        renderPreview();
    }));

    // Charset dropdown
    charsetSelect.addEventListener('change', () => {
        session.activeCharsetId = charsetSelect.value;
        // Sync CW/CH/OX/OY/GX/GY inputs from new charset
        const cs = getActiveCharset();
        cellWidthInput.value = cs.cellWidth;
        cellHeightInput.value = cs.cellHeight;
        originXInput.value = cs.originX || 0;
        originYInput.value = cs.originY || 0;
        gapXInput.value = cs.gapX || 0;
        gapYInput.value = cs.gapY || 0;
        originXInput.max = cs.cellWidth - 1;
        originYInput.max = cs.cellHeight - 1;
        clampRegion();
        rebuildCapturedGlyphs();
        regenerateAllPages();
        renderGlyphGrid();
        refreshTextOutput();
        updateStatus();
        saveSession();
    });

    // New charset
    btnCharsetNew.addEventListener('click', () => {
        const name = prompt('Charset name:');
        if (!name) return;
        const cs = createCharset(name);
        session.charsets.push(cs);
        session.activeCharsetId = cs.id;
        populateCharsetDropdown();
        regenerateAllPages();
        renderGlyphGrid();
        refreshTextOutput();
        updateStatus();
        saveSession();
        showMessage(`Charset "${name}" created`);
    });

    // Rename charset
    btnCharsetRename.addEventListener('click', () => {
        const cs = getActiveCharset();
        const name = prompt('New name:', cs.name);
        if (!name) return;
        cs.name = name;
        populateCharsetDropdown();
        saveSession();
        showMessage(`Charset renamed to "${name}"`);
    });

    // Delete charset
    btnCharsetDel.addEventListener('click', () => {
        if (session.charsets.length <= 1) {
            showMessage('Cannot delete the last charset');
            return;
        }
        const cs = getActiveCharset();
        if (!confirm(`Delete charset "${cs.name}"?`)) return;
        session.charsets = session.charsets.filter(c => c.id !== cs.id);
        session.activeCharsetId = session.charsets[0].id;
        populateCharsetDropdown();
        regenerateAllPages();
        renderGlyphGrid();
        refreshTextOutput();
        updateStatus();
        saveSession();
        showMessage('Charset deleted');
    });

    // Export Text
    btnExportText.addEventListener('click', () => {
        if (session.pages.length === 0) { showMessage('No pages to export'); return; }
        let text = '';
        for (let i = 0; i < session.pages.length; i++) {
            if (i > 0) text += '\n--- Page ' + (i + 1) + ' ---\n';
            text += session.pages[i].text;
        }
        downloadFile('ocr-text.txt', text);
        showMessage('Text exported');
    });

    // Export Charset
    btnExportCharset.addEventListener('click', () => {
        const cs = getActiveCharset();
        downloadFile('charset-' + cs.name.replace(/\s+/g, '_') + '.json', JSON.stringify(cs, null, 2));
        showMessage(`Charset "${cs.name}" exported`);
    });

    // Import Charset
    btnImportCharset.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const cs = JSON.parse(reader.result);
                    if (!cs.glyphs || !cs.name) throw new Error('Invalid charset format');
                    cs.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                    if (!cs.cellWidth) cs.cellWidth = 8;
                    if (!cs.cellHeight) cs.cellHeight = 8;
                    if (cs.originX === undefined) cs.originX = 0;
                    if (cs.originY === undefined) cs.originY = 0;
                    if (cs.gapX === undefined) cs.gapX = 0;
                    if (cs.gapY === undefined) cs.gapY = 0;
                    session.charsets.push(cs);
                    session.activeCharsetId = cs.id;
                    populateCharsetDropdown();
                    rebuildCapturedGlyphs();
                    regenerateAllPages();
                    renderGlyphGrid();
                    refreshTextOutput();
                    updateStatus();
                    saveSession();
                    showMessage(`Charset "${cs.name}" imported`);
                } catch (e) {
                    showMessage('Failed to import charset: ' + e.message);
                }
            };
            reader.readAsText(file);
        });
        input.click();
    });

    // Save Session
    btnSaveSession.addEventListener('click', () => {
        downloadFile('ocr-session.json', JSON.stringify(session, null, 2));
        showMessage('Session saved');
    });

    // Load Session
    btnLoadSession.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result);
                    if (!data.charsets || !Array.isArray(data.charsets)) throw new Error('Invalid session format');
                    session = data;
                    if (!session.region) session.region = { x: 0, y: 0, w: 32, h: 24 };
                    if (!session.pages) session.pages = [];
                    if (typeof session.currentPageIndex !== 'number') session.currentPageIndex = 0;
                    for (const page of session.pages) {
                        if (!page.gridRegion) page.gridRegion = { ...session.region };
                    }
                    refreshAll();
                    saveSession();
                    showMessage('Session loaded');
                } catch (e) {
                    showMessage('Failed to load session: ' + e.message);
                }
            };
            reader.readAsText(file);
        });
        input.click();
    });

    // Clear
    btnClear.addEventListener('click', () => {
        if (session.pages.length > 0 || Object.keys(getActiveCharset().glyphs).length > 0) {
            if (!confirm('Clear all OCR data (pages, glyphs)?')) return;
        }
        session = createDefaultSession();
        capturedGlyphs.clear();
        glyphOrder = [];
        liveMode = true;
        statusSpan.textContent = '';
        refreshAll();
        saveSession();
        showMessage('OCR data cleared');
    });

    // Font size +/-
    const FONT_MIN = 10, FONT_MAX = 28, FONT_STEP = 2;
    btnFontMinus.addEventListener('click', () => {
        const cur = parseInt(getComputedStyle(textOutput).fontSize, 10);
        if (cur > FONT_MIN) textOutput.style.fontSize = (cur - FONT_STEP) + 'px';
    });
    btnFontPlus.addEventListener('click', () => {
        const cur = parseInt(getComputedStyle(textOutput).fontSize, 10);
        if (cur < FONT_MAX) textOutput.style.fontSize = (cur + FONT_STEP) + 'px';
    });

    // Show dupes toggle
    showDupesCheckbox.addEventListener('change', () => renderGlyphGrid());

    // Delete selected glyphs
    btnDeleteSelected.addEventListener('click', () => {
        if (selectedGlyphs.size === 0) return;
        const charset = getActiveCharset();
        const count = selectedGlyphs.size;
        for (const hash of selectedGlyphs) {
            delete charset.glyphs[hash];
            capturedGlyphs.delete(hash);
            glyphOrder = glyphOrder.filter(h => h !== hash);
        }
        selectedGlyphs.clear();
        regenerateAllPages();
        refreshTextOutput();
        renderGlyphGrid();
        updateStatus();
        saveSession();
        showMessage(`Deleted ${count} glyphs`);
    });

    // Show grid toggle
    showGridCheckbox.addEventListener('change', () => renderPreview());

    // Preview zoom
    previewZoomBtns.forEach(btn => btn.addEventListener('click', () => {
        previewZoom = parseInt(btn.dataset.zoom);
        const w = 256 * previewZoom, h = 192 * previewZoom;
        previewCanvas.style.width = w + 'px';
        previewCanvas.style.height = h + 'px';
        gridCanvas.width = w;
        gridCanvas.height = h;
        gridCanvas.style.width = w + 'px';
        gridCanvas.style.height = h + 'px';
        previewZoomBtns.forEach(b => b.classList.toggle('active', b === btn));
        renderGridOverlay();
    }));

    // ========== Extract Font dialog ==========

    const EXTRACT_PRESETS = {
        spectrum:   { map: SPECTRUM_ASCII_MAP, cols: 1 },
        spectrofon: { map: SPECTROFON_MAP,     cols: 1 }
    };

    function updateExtractByteInfo() {
        const count = parseInt(extractCountInput.value) || 0;
        const cols = parseInt(extractColsInput.value) || 1;
        const eh = parseInt(extractHeightInput.value) || 8;
        const bytes = cols > 1
            ? Math.ceil(count / cols) * cols * eh
            : count * eh;
        extractByteInfo.textContent = `(= ${bytes} bytes)`;
    }

    function updateExtractMapCount() {
        const text = extractMapText.value;
        const unknown = (text.match(/\uFFFD/g) || []).length;
        extractMapCount.textContent = unknown > 0
            ? `${text.length} (${unknown} unknown)`
            : `${text.length}`;
    }

    function syncCountToMap() {
        const mapLen = extractMapText.value.length;
        extractCountInput.value = mapLen;
        updateExtractByteInfo();
    }

    function populateExtractCharsetSelect() {
        extractCharsetSelect.innerHTML = '';
        for (const cs of session.charsets) {
            const opt = document.createElement('option');
            opt.value = cs.id;
            opt.textContent = cs.name;
            extractCharsetSelect.appendChild(opt);
        }
        extractCharsetSelect.value = session.activeCharsetId;
    }

    function openExtractDialog(address, bank) {
        if (address !== undefined) {
            extractAddrInput.value = address.toString(16).toUpperCase().padStart(4, '0');
        }
        if (bank !== undefined && bank >= 0) {
            extractBankInput.value = bank;
        } else {
            extractBankInput.value = '';
        }
        // Populate charset selector and sync W/H from active charset
        populateExtractCharsetSelect();
        const cs = getActiveCharset();
        extractWidthInput.value = cs.cellWidth;
        extractHeightInput.value = cs.cellHeight;
        extractDialog.classList.remove('hidden');
        updateExtractByteInfo();
        updateExtractMapCount();
    }

    function closeExtractDialog() {
        extractDialog.classList.add('hidden');
    }

    function readByteFromBank(addr, bank) {
        addr = addr & 0xFFFF;
        if (bank >= 0) {
            const page = getRAMPage(bank);
            if (page) return page[addr & 0x3FFF];
            return 0;
        }
        return readMemory(addr);
    }

    function extractFont(address, charMap, cols, bank, extractW, extractH, targetCharsetId) {
        const charset = targetCharsetId
            ? (session.charsets.find(c => c.id === targetCharsetId) || getActiveCharset())
            : getActiveCharset();
        let added = 0;
        cols = cols || 1;
        extractW = extractW || 8;
        extractH = extractH || 8;
        const widthMask = (0xFF << (8 - extractW)) & 0xFF;
        if (bank === undefined || bank === null) bank = -1;
        for (let i = 0; i < charMap.length; i++) {
            if (charMap[i] === SKIP_CHAR) continue;
            const bytes = new Uint8Array(extractH);
            if (cols > 1) {
                // Bitmap layout: chars arranged in a grid, cols wide
                const row = Math.floor(i / cols);
                const col = i % cols;
                for (let line = 0; line < extractH; line++) {
                    bytes[line] = readByteFromBank((address + row * cols * extractH + line * cols + col) & 0xFFFF, bank) & widthMask;
                }
            } else {
                // Sequential layout: extractH consecutive bytes per char
                for (let line = 0; line < extractH; line++) {
                    bytes[line] = readByteFromBank((address + i * extractH + line) & 0xFFFF, bank) & widthMask;
                }
            }
            const hash = glyphHash(bytes, extractH);
            charset.glyphs[hash] = charMap[i];
            capturedGlyphs.set(hash, { bytes, w: extractW, h: extractH });
            trackGlyphOrder(hash);
            added++;
        }
        regenerateAllPages();
        refreshTextOutput();
        renderGlyphGrid();
        updateStatus();
        saveSession();
        return added;
    }

    // Close dialog
    btnExtractClose.addEventListener('click', closeExtractDialog);

    // Click backdrop to close
    extractDialog.addEventListener('click', (e) => {
        if (e.target === extractDialog) closeExtractDialog();
    });

    // Escape to close
    extractDialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeExtractDialog();
    });

    // Charset selector change → sync W/H from selected charset
    extractCharsetSelect.addEventListener('change', () => {
        const cs = session.charsets.find(c => c.id === extractCharsetSelect.value);
        if (cs) {
            extractWidthInput.value = cs.cellWidth;
            extractHeightInput.value = cs.cellHeight;
            updateExtractByteInfo();
        }
    });

    // Count / Cols / W / H inputs → update byte info
    extractCountInput.addEventListener('input', updateExtractByteInfo);
    extractColsInput.addEventListener('input', updateExtractByteInfo);
    extractWidthInput.addEventListener('input', updateExtractByteInfo);
    extractHeightInput.addEventListener('input', updateExtractByteInfo);

    // Map textarea → update count display and sync count input
    extractMapText.addEventListener('input', () => {
        updateExtractMapCount();
        syncCountToMap();
        // Switch to Custom if user edits text while on a preset
        if (extractMapSelect.value !== 'custom') {
            const preset = EXTRACT_PRESETS[extractMapSelect.value];
            if (preset && extractMapText.value !== preset.map) {
                extractMapSelect.value = 'custom';
            }
        }
    });

    // Map dropdown change
    extractMapSelect.addEventListener('change', () => {
        const preset = EXTRACT_PRESETS[extractMapSelect.value];
        if (preset) {
            extractMapText.value = preset.map;
            extractColsInput.value = preset.cols;
        }
        updateExtractMapCount();
        syncCountToMap();
    });

    // Extract to Charset
    btnExtractDo.addEventListener('click', () => {
        const addrStr = extractAddrInput.value.trim();
        const address = parseInt(addrStr, 16);
        if (isNaN(address) || address < 0 || address > 0xFFFF) {
            showMessage('Invalid address');
            return;
        }
        const charMap = extractMapText.value;
        if (charMap.length === 0) {
            showMessage('Character map is empty');
            return;
        }
        const cols = parseInt(extractColsInput.value) || 1;
        const bankStr = extractBankInput.value.trim();
        const bank = bankStr === '' ? -1 : parseInt(bankStr);
        const ew = Math.max(4, Math.min(8, parseInt(extractWidthInput.value) || 8));
        const eh = Math.max(4, Math.min(16, parseInt(extractHeightInput.value) || 8));
        const targetId = extractCharsetSelect.value;
        const added = extractFont(address, charMap, cols, bank, ew, eh, targetId);
        const targetCs = session.charsets.find(c => c.id === targetId);
        const csName = targetCs ? ` → ${targetCs.name}` : '';
        const bankNote = bank >= 0 ? ` (bank ${bank})` : '';
        showMessage(`Extracted ${added} glyphs from $${address.toString(16).toUpperCase().padStart(4, '0')}${bankNote}${csName}`);
    });

    // Load ROM Font — shortcut: $3D00, 96 chars, sequential, Spectrum ASCII map
    btnExtractRom.addEventListener('click', () => {
        extractAddrInput.value = '3D00';
        extractBankInput.value = '';
        extractCountInput.value = '96';
        extractColsInput.value = '1';
        extractWidthInput.value = '8';
        extractHeightInput.value = '8';
        extractMapSelect.value = 'spectrum';
        extractMapText.value = SPECTRUM_ASCII_MAP;
        updateExtractByteInfo();
        updateExtractMapCount();
        const targetId = extractCharsetSelect.value;
        const added = extractFont(0x3D00, SPECTRUM_ASCII_MAP, 1, -1, 8, 8, targetId);
        const targetCs = session.charsets.find(c => c.id === targetId);
        const csName = targetCs ? ` → ${targetCs.name}` : '';
        showMessage(`ROM font: extracted ${added} glyphs from $3D00${csName}`);
    });

    // Save Map — download map string as .txt file
    btnExtractSaveMap.addEventListener('click', () => {
        const mapStr = extractMapText.value;
        if (mapStr.length === 0) {
            showMessage('Character map is empty');
            return;
        }
        downloadFile('charmap.txt', mapStr);
        showMessage('Character map saved');
    });

    // Load Map — import map string from .txt file
    btnExtractLoadMap.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt';
        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const text = reader.result.replace(/\r\n/g, '').replace(/\n/g, '');
                extractMapText.value = text;
                extractMapSelect.value = text === SPECTRUM_ASCII_MAP ? 'spectrum'
                    : text === SPECTROFON_MAP ? 'spectrofon' : 'custom';
                updateExtractMapCount();
                syncCountToMap();
                showMessage(`Character map loaded (${text.length} chars)`);
            };
            reader.readAsText(file);
        });
        input.click();
    });

    // ========== Init ==========

    refreshAll();

    return { openExtractDialog };
}
