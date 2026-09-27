// explorer.js — File analysis tool (extracted from index.html)
import { hex8, hex16, escapeHtml, downloadFile } from '../core/utils.js';
// Addresses and offsets follow the address switch, bytes the value one. hex16
// stays where a number is written OUT -- an export filename must not change
// shape because of a display setting.
import {
    fmtAddr, fmtAddrPair, fmtByte, parseAddr, parseByte, onNumberBaseChange
} from '../core/addr-format.js';
import { isFlowBreak } from './mnemonic-format.js';
import {
    SLOT1_START,
    SCREEN_SIZE, SCREEN_BITMAP_SIZE, SCREEN_ATTR_SIZE,
    SCREEN_WIDTH, SCREEN_HEIGHT
} from '../core/constants.js';
import { TRDLoader, SCLLoader, MGTLoader, MDRLoader, OPDLoader, DidaktikLoader, sclChecksum } from '../core/loaders.js';
import { BASIC_TOKENS, decodeBasicProgram } from '../core/basic-tokens.js';
import { findPackedScreenInBlock, rcsToScr, looksRcsEncoded } from '../core/depackers.js';
import { trdBasicAutostartLine, extractTrdFileDescriptor, shapeBasicEntry, addMetaFromDescriptor, isMonoloader, splitMonoloader } from './disk-file-copy.js';
import { initExplorerBanks } from './explorer-banks.js';
import { initExplorerEditors } from './explorer-editors.js';
import { initExplorerViews } from './explorer-views.js';
import { parseSpecscii, renderGrid, encodeBannerEntries, decodeBannerNames, bannerNamesToSpecscii, isBannerName, lastContentRow, BANNER_MAX_ROWS } from '../core/specscii.js';
export function initExplorer({ DSKLoader, Disassembler, SZXLoader, RZXLoader, ZipLoader, pako, getPalette, getRomLabels, getZxCharset }) {
    // ========== Explorer Tab ==========
    const explorerFileInput = document.getElementById('explorerFileInput');
    const btnExplorerLoad = document.getElementById('btnExplorerLoad');
    const explorerFileName = document.getElementById('explorerFileName');
    const explorerFileSize = document.getElementById('explorerFileSize');
    const explorerInfoOutput = document.getElementById('explorerInfoOutput');
    const explorerBasicOutput = document.getElementById('explorerBasicOutput');
    const explorerBasicSource = document.getElementById('explorerBasicSource');
    const explorerDisasmOutput = document.getElementById('explorerDisasmOutput');
    const explorerDisasmAddr = document.getElementById('explorerDisasmAddr');
    const explorerDisasmLen = document.getElementById('explorerDisasmLen');
    const explorerDisasmSource = document.getElementById('explorerDisasmSource');
    const btnExplorerDisasm = document.getElementById('btnExplorerDisasm');
    const explorerHexOutput = document.getElementById('explorerHexOutput');
    const explorerHexAddr = document.getElementById('explorerHexAddr');
    const explorerHexLen = document.getElementById('explorerHexLen');
    const explorerHexSource = document.getElementById('explorerHexSource');
    const btnExplorerHex = document.getElementById('btnExplorerHex');
    const explorerFindText = document.getElementById('explorerFindText');
    const explorerFindMode = document.getElementById('explorerFindMode');
    const chkExplorerFind5ch = document.getElementById('chkExplorerFind5ch');
    const btnExplorerFind = document.getElementById('btnExplorerFind');
    const explorerFindStatus = document.getElementById('explorerFindStatus');
    const explorerFindResults = document.getElementById('explorerFindResults');
    const explorerBankTools = document.getElementById('explorerBankTools');
    const explorerBankAddrMode = document.getElementById('explorerBankAddrMode');
    const btnExplorerExportBank = document.getElementById('btnExplorerExportBank');
    const btnExplorerImportBank = document.getElementById('btnExplorerImportBank');
    const btnExplorerSaveModified = document.getElementById('btnExplorerSaveModified');
    const explorerBankStatus = document.getElementById('explorerBankStatus');
    const explorerBankImportInput = document.getElementById('explorerBankImportInput');
    const explorerTextOutput = document.getElementById('explorerTextOutput');
    const explorerTextSource = document.getElementById('explorerTextSource');
    const explorerTextCodepage = document.getElementById('explorerTextCodepage');
    const btnExplorerText = document.getElementById('btnExplorerText');

    // Codepage tables (128 entries for bytes 0x80-0xFF)
    const CODEPAGE_TABLES = {
        cp866: '\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417\u0418\u0419\u041A\u041B\u041C\u041D\u041E\u041F\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427\u0428\u0429\u042A\u042B\u042C\u042D\u042E\u042F\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0439\u043A\u043B\u043C\u043D\u043E\u043F\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044A\u044B\u044C\u044D\u044E\u044F\u0401\u0451\u0404\u0454\u0407\u0457\u040E\u045E\u00B0\u2219\u00B7\u221A\u2116\u00A4\u25A0\u00A0',
        win1251: '\u0402\u0403\u201A\u0453\u201E\u2026\u2020\u2021\u20AC\u2030\u0409\u2039\u040A\u040C\u040B\u040F\u0452\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u0098\u2122\u0459\u203A\u045A\u045C\u045B\u045F\u00A0\u040E\u045E\u0408\u00A4\u0490\u00A6\u00A7\u0401\u00A9\u0404\u00AB\u00AC\u00AD\u00AE\u0407\u00B0\u00B1\u0406\u0456\u0491\u00B5\u00B6\u00B7\u0451\u2116\u0454\u00BB\u0458\u0405\u0455\u0457\u0410\u0411\u0412\u0413\u0414\u0415\u0416\u0417\u0418\u0419\u041A\u041B\u041C\u041D\u041E\u041F\u0420\u0421\u0422\u0423\u0424\u0425\u0426\u0427\u0428\u0429\u042A\u042B\u042C\u042D\u042E\u042F\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0439\u043A\u043B\u043C\u043D\u043E\u043F\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044A\u044B\u044C\u044D\u044E\u044F',
        koi8r: '\u2500\u2502\u250C\u2510\u2514\u2518\u251C\u2524\u252C\u2534\u253C\u2580\u2584\u2588\u258C\u2590\u2591\u2592\u2593\u2320\u25A0\u2219\u221A\u2248\u2264\u2265\u00A0\u2321\u00B0\u00B2\u00B7\u00F7\u2550\u2551\u2552\u0451\u2553\u2554\u2555\u2556\u2557\u2558\u2559\u255A\u255B\u255C\u255D\u255E\u255F\u2560\u2561\u0401\u2562\u2563\u2564\u2565\u2566\u2567\u2568\u2569\u256A\u256B\u256C\u00A9\u044E\u0430\u0431\u0446\u0434\u0435\u0444\u0433\u0445\u0438\u0439\u043A\u043B\u043C\u043D\u043E\u043F\u044F\u0440\u0441\u0442\u0443\u0436\u0432\u044C\u044B\u0437\u0448\u044D\u0449\u0447\u044A\u042E\u0410\u0411\u0426\u0414\u0415\u0424\u0413\u0425\u0418\u0419\u041A\u041B\u041C\u041D\u041E\u041F\u042F\u0420\u0421\u0422\u0423\u0416\u0412\u042C\u042B\u0417\u0428\u042D\u0429\u0427\u042A',
        iso88591: null // direct mapping: byte value = Unicode codepoint
    };

    // Explorer state
    let explorerData = null;         // Raw file data
    let explorerParsed = null;       // Parsed file structure
    let explorerFileType = null;     // 'tap', 'sna', 'z80', 'trd', 'scl', 'zip'
    let explorerBlocks = [];         // Parsed blocks/files
    let explorerZipFiles = [];       // Files from ZIP archive
    let explorerZipParentName = null; // Store parent ZIP name for drill-down
    let explorerBasicViewMode = 'code';  // 'code' or 'screen'
    let explorerBasicLines = null;       // Cached decoded lines for view toggle
    let explorerBasicRawData = null;     // Cached raw BASIC binary for copy
    let explorerBankCache = new Map();      // bankNum -> Uint8Array(16384)
    let explorerBankDirty = new Set();      // bank numbers modified via import
    let explorerBankAddressMode = 'bank';   // 'bank' or 'logical'
    const explorerBasicView = document.getElementById('explorerBasicView');

    // Preview canvas elements
    const explorerPreviewContainer = document.getElementById('explorerPreviewContainer');
    const explorerPreviewCanvas = document.getElementById('explorerPreviewCanvas');
    const explorerPreviewLabel = document.getElementById('explorerPreviewLabel');
    const explorerRcsToggle = document.getElementById('explorerRcsToggle');
    const explorerRcsToggleLabel = document.getElementById('explorerRcsToggleLabel');
    const explorerSaveScrBtn = document.getElementById('explorerSaveScrBtn');
    const explorerPreviewCtx = explorerPreviewCanvas.getContext('2d');
    if (explorerRcsToggle) explorerRcsToggle.addEventListener('change', () => explorerRenderPackedScreen());
    if (explorerSaveScrBtn) explorerSaveScrBtn.addEventListener('click', () => {
        if (!explorerPackedScreen) return;
        const useRcs = explorerRcsToggle && explorerRcsToggle.checked;
        const data = useRcs ? rcsToScr(explorerPackedScreen.data) : explorerPackedScreen.data;
        const base = ((explorerPackedScreen.name || 'screen') + '').replace(/\s+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'screen';
        downloadFile(base + '.scr', data);
    });
    let explorerPreviewTimer = null;   // defers preview/detection so the catalog paints first
    let explorerPreviewPending = false; // preview/detection deferred until the Info tab is opened
    const explorerPreviewModes = document.getElementById('explorerPreviewModes');
    let explorerPreviewMode = 'spectrum';
    let explorerPreviewDataCache = null;
    let explorerPreviewThirdsCache = 0;
    let explorerPreviewFileNameCache = null;

    // Disk Map elements
    const diskmapGridContainer = document.getElementById('diskmapGridContainer');
    const diskmapDiskContainer = document.getElementById('diskmapDiskContainer');
    const diskmapCanvas = document.getElementById('diskmapCanvas');
    const diskmapLegend = document.getElementById('diskmapLegend');
    const diskmapInfo = document.getElementById('diskmapInfo');
    const diskmapStatus = document.getElementById('diskmapStatus');
    let diskmapSectorMap = null;       // Cached sector map for current DSK
    let diskmapHighlightFile = -1;     // File index to highlight (-1 = none)
    let diskmapCurrentView = 'grid';   // 'grid' or 'disk'

    // Get current palette from ULA (falls back to default if not available)
    function getExplorerPalette() {
        const palette = getPalette();
        if (palette) {
            // ULA palette is 16 colors: 0-7 regular, 8-15 bright
            return {
                regular: palette.slice(0, 8).map(c => [c[0], c[1], c[2]]),
                bright: palette.slice(8, 16).map(c => [c[0], c[1], c[2]])
            };
        }
        // Default palette if ULA not available
        return {
            regular: [[0,0,0], [0,0,215], [215,0,0], [215,0,215], [0,215,0], [0,215,215], [215,215,0], [215,215,215]],
            bright: [[0,0,0], [0,0,255], [255,0,0], [255,0,255], [0,255,0], [0,255,255], [255,255,0], [255,255,255]]
        };
    }

    // Sync preview panel height to match info output panel (single-screen path only)
    function syncPreviewHeight() {
        setTimeout(() => {
            const leftH = explorerInfoOutput.offsetHeight;
            if (leftH > 0 && !explorerPreviewContainer.classList.contains('hidden')) {
                explorerPreviewContainer.style.setProperty('height', leftH + 'px', 'important');
            }
        }, 50);
    }

    // Preview rendering functions
    // Sizes that support Spectrum/Linear/Font mode toggle
    const TOGGLEABLE_SIZES = { 2048: 1, 4096: 2, 6144: 3 }; // size -> thirds

    // Previewable graphic blob sizes (full screen, bitmap-only, thirds, attrs, fonts)
    const PREVIEW_SIZES = [SCREEN_SIZE, SCREEN_BITMAP_SIZE, 4096, 2048, SCREEN_ATTR_SIZE, 9216, 11136, 12288, 18432];
    // TR-DOS catalogue file-type letter → display name
    const TRD_TYPE_NAMES = { 'B': 'BASIC', 'C': 'Code', 'D': 'Data', '#': 'Sequential' };
    // TR-DOS usable sectors (2560 total − 16 on track 0 reserved for system/catalog)
    const TRD_TOTAL_SECTORS = 2544;

    function explorerUpdatePreview(data, blockData = null, fileName = null) {
        if (!data) {
            explorerPreviewContainer.classList.add('hidden');
            explorerPreviewContainer.style.height = '';
            explorerPreviewModes.classList.add('hidden');
            return;
        }

        const len = data.length;
        let previewType = null;
        let label = '';

        // Check if this size supports mode toggle
        const thirds = TOGGLEABLE_SIZES[len];
        if (thirds !== undefined) {
            // Cache data and reset mode for new data
            explorerPreviewDataCache = data;
            explorerPreviewThirdsCache = thirds;
            explorerPreviewFileNameCache = fileName;
            explorerPreviewMode = 'spectrum';
            explorerPreviewModes.classList.remove('hidden');
            for (const btn of explorerPreviewModes.querySelectorAll('.explorer-mode-btn')) {
                btn.classList.toggle('active', btn.dataset.mode === 'spectrum');
            }
            explorerRenderPreviewMode(data, thirds, 'spectrum', fileName);
            return;
        }

        // Non-toggleable sizes
        explorerPreviewModes.classList.add('hidden');
        explorerPreviewDataCache = null;

        // Detect preview type by size
        if (len === SCREEN_SIZE) {
            previewType = 'scr';
            label = 'Screen (6912 bytes)';
        } else if (len === 768) {
            previewType = 'font';
            label = 'Font / Attributes (768 bytes)';
        } else if (len === 9216) {
            previewType = 'ifl';
            label = 'IFL 8×2 Multicolor (9216 bytes)';
        } else if (len === 12288) {
            previewType = 'mlt';
            label = 'MLT 8×1 Multicolor (12288 bytes)';
        } else if (len === 18432) {
            previewType = 'rgb3';
            label = 'RGB3 Tricolor (18432 bytes)';
        }

        if (!previewType) {
            explorerPreviewContainer.classList.add('hidden');
            explorerPreviewContainer.style.height = '';
            return;
        }

        // Show preview
        explorerPreviewContainer.classList.remove('hidden');
        if (fileName) {
            explorerPreviewLabel.innerHTML = `${escapeHtml(label)}<br><span style="color:var(--cyan)">${escapeHtml(fileName)}</span>`;
        } else {
            explorerPreviewLabel.textContent = label;
        }

        // Render based on type
        switch (previewType) {
            case 'scr':
                explorerRenderSCR(data);
                break;
            case 'font':
                explorerRenderFont(data);
                break;
            case 'ifl':
                explorerRenderIFL(data);
                break;
            case 'mlt':
                explorerRenderMLT(data);
                break;
            case 'rgb3':
                explorerRenderRGB3(data);
                break;
        }

        // Display at 2x zoom
        explorerPreviewCanvas.style.width = (explorerPreviewCanvas.width * 2) + 'px';
        explorerPreviewCanvas.style.height = (explorerPreviewCanvas.height * 2) + 'px';

        syncPreviewHeight();
    }

    function explorerRenderPreviewMode(data, thirds, mode, fileName) {
        const len = data.length;
        const thirdLabels = { 1: '1/3', 2: '2/3', 3: '' };
        const thirdSuffix = thirdLabels[thirds];
        const charCount = len / 8;
        const linearH = thirds * 64;
        let label;

        switch (mode) {
            case 'spectrum':
                label = `Bitmap ${thirdSuffix} (${len} bytes)`.replace('  ', ' ');
                explorerRenderMono(data, thirds);
                break;
            case 'linear':
                label = `Linear 256\u00d7${linearH} (${len} bytes)`;
                explorerRenderLinear(data, 256, linearH);
                break;
            case 'font':
                label = `Font ${charCount} chars (${len} bytes)`;
                explorerRenderFontGrid(data, charCount);
                break;
        }

        explorerPreviewContainer.classList.remove('hidden');
        if (fileName) {
            explorerPreviewLabel.innerHTML = `${escapeHtml(label)}<br><span style="color:var(--cyan)">${escapeHtml(fileName)}</span>`;
        } else {
            explorerPreviewLabel.textContent = label;
        }

        // Display at 2x zoom
        explorerPreviewCanvas.style.width = (explorerPreviewCanvas.width * 2) + 'px';
        explorerPreviewCanvas.style.height = (explorerPreviewCanvas.height * 2) + 'px';

        syncPreviewHeight();
    }

    function explorerRenderLinear(data, width, height) {
        explorerPreviewCanvas.width = width;
        explorerPreviewCanvas.height = height;
        const imageData = explorerPreviewCtx.createImageData(width, height);
        const pixels = imageData.data;

        // Fill with black
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 255;
        }

        const ink = [215, 215, 215];
        const bytesPerRow = width / 8;

        for (let y = 0; y < height; y++) {
            for (let col = 0; col < bytesPerRow; col++) {
                const byte = data[y * bytesPerRow + col];
                const x = col * 8;
                for (let bit = 0; bit < 8; bit++) {
                    if ((byte & (0x80 >> bit)) !== 0) {
                        const idx = ((y * width) + x + bit) * 4;
                        pixels[idx] = ink[0];
                        pixels[idx + 1] = ink[1];
                        pixels[idx + 2] = ink[2];
                    }
                }
            }
        }

        explorerPreviewCtx.putImageData(imageData, 0, 0);
    }

    function explorerRenderFontGrid(data, charCount) {
        const cols = 32;
        const rows = Math.ceil(charCount / cols);
        const canvasW = cols * 8;
        const canvasH = rows * 8;

        explorerPreviewCanvas.width = canvasW;
        explorerPreviewCanvas.height = canvasH;
        const imageData = explorerPreviewCtx.createImageData(canvasW, canvasH);
        const pixels = imageData.data;

        // Fill with black
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 255;
        }

        const ink = [215, 215, 215];

        for (let charIdx = 0; charIdx < charCount; charIdx++) {
            const gridX = charIdx % cols;
            const gridY = Math.floor(charIdx / cols);
            const charOffset = charIdx * 8;

            for (let line = 0; line < 8; line++) {
                const byte = data[charOffset + line];
                if (byte === undefined) break;
                const y = gridY * 8 + line;
                const x = gridX * 8;

                for (let bit = 0; bit < 8; bit++) {
                    if ((byte & (0x80 >> bit)) !== 0) {
                        const idx = ((y * canvasW) + x + bit) * 4;
                        pixels[idx] = ink[0];
                        pixels[idx + 1] = ink[1];
                        pixels[idx + 2] = ink[2];
                    }
                }
            }
        }

        explorerPreviewCtx.putImageData(imageData, 0, 0);
    }

    // Mode button click handler
    explorerPreviewModes.addEventListener('click', (e) => {
        const btn = e.target.closest('.explorer-mode-btn');
        if (!btn || !explorerPreviewDataCache) return;

        const mode = btn.dataset.mode;
        if (mode === explorerPreviewMode) return;

        explorerPreviewMode = mode;
        for (const b of explorerPreviewModes.querySelectorAll('.explorer-mode-btn')) {
            b.classList.toggle('active', b.dataset.mode === mode);
        }
        explorerRenderPreviewMode(explorerPreviewDataCache, explorerPreviewThirdsCache, mode, explorerPreviewFileNameCache);
    });

    function explorerRenderSCR(data) {
        explorerPreviewCanvas.width = SCREEN_WIDTH;
        explorerPreviewCanvas.height = SCREEN_HEIGHT;
        const imageData = explorerPreviewCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
        const pixels = imageData.data;

        // Process all three screen thirds
        const sections = [
            { bitmapAddr: 0, attrAddr: SCREEN_BITMAP_SIZE, yOffset: 0 },
            { bitmapAddr: 2048, attrAddr: SCREEN_BITMAP_SIZE + 256, yOffset: 64 },
            { bitmapAddr: 4096, attrAddr: SCREEN_BITMAP_SIZE + 512, yOffset: 128 }
        ];

        for (const section of sections) {
            const { bitmapAddr, attrAddr, yOffset } = section;
            for (let line = 0; line < 8; line++) {
                for (let row = 0; row < 8; row++) {
                    for (let col = 0; col < 32; col++) {
                        const bitmapOffset = bitmapAddr + col + row * 32 + line * SCREEN_WIDTH;
                        const byte = data[bitmapOffset];
                        const attrOffset = attrAddr + col + row * 32;
                        const attr = data[attrOffset];

                        const isBright = (attr & 0x40) !== 0;
                        const ink = attr & 0x07;
                        const paper = (attr >> 3) & 0x07;
                        const pal = getExplorerPalette();
                        const palette = isBright ? pal.bright : pal.regular;
                        const inkRgb = palette[ink];
                        const paperRgb = palette[paper];

                        const x = col * 8;
                        const y = yOffset + row * 8 + line;

                        for (let bit = 0; bit < 8; bit++) {
                            const isSet = (byte & (0x80 >> bit)) !== 0;
                            const rgb = isSet ? inkRgb : paperRgb;
                            const idx = ((y * SCREEN_WIDTH) + x + bit) * 4;
                            pixels[idx] = rgb[0];
                            pixels[idx + 1] = rgb[1];
                            pixels[idx + 2] = rgb[2];
                            pixels[idx + 3] = 255;
                        }
                    }
                }
            }
        }

        explorerPreviewCtx.putImageData(imageData, 0, 0);
    }

    function explorerRenderMono(data, thirds) {
        explorerPreviewCanvas.width = SCREEN_WIDTH;
        explorerPreviewCanvas.height = SCREEN_HEIGHT;
        const imageData = explorerPreviewCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
        const pixels = imageData.data;

        // Fill with black
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 255;
        }

        const ink = [215, 215, 215];
        const paper = [0, 0, 0];

        for (let third = 0; third < thirds; third++) {
            const bitmapBase = third * 2048;
            for (let y = 0; y < 64; y++) {
                const charRow = Math.floor(y / 8);
                const pixelLine = y % 8;
                const bitmapOffset = bitmapBase + charRow * 32 + pixelLine * SCREEN_WIDTH;

                for (let col = 0; col < 32; col++) {
                    const byte = data[bitmapOffset + col];
                    const screenY = third * 64 + y;
                    const x = col * 8;

                    for (let bit = 0; bit < 8; bit++) {
                        const isSet = (byte & (0x80 >> bit)) !== 0;
                        const rgb = isSet ? ink : paper;
                        const idx = ((screenY * SCREEN_WIDTH) + x + bit) * 4;
                        pixels[idx] = rgb[0];
                        pixels[idx + 1] = rgb[1];
                        pixels[idx + 2] = rgb[2];
                        pixels[idx + 3] = 255;
                    }
                }
            }
        }

        explorerPreviewCtx.putImageData(imageData, 0, 0);
    }

    function explorerRenderFont(data) {
        // 96 chars, 8 bytes each = 768 bytes
        // Render as 16x6 grid (96 chars)
        explorerPreviewCanvas.width = 128;
        explorerPreviewCanvas.height = 48;
        const imageData = explorerPreviewCtx.createImageData(128, 48);
        const pixels = imageData.data;

        // Fill with black
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 255;
        }

        const ink = [215, 215, 215];

        for (let charIdx = 0; charIdx < 96; charIdx++) {
            const gridX = charIdx % 16;
            const gridY = Math.floor(charIdx / 16);
            const charOffset = charIdx * 8;

            for (let line = 0; line < 8; line++) {
                const byte = data[charOffset + line];
                const y = gridY * 8 + line;
                const x = gridX * 8;

                for (let bit = 0; bit < 8; bit++) {
                    if ((byte & (0x80 >> bit)) !== 0) {
                        const idx = ((y * 128) + x + bit) * 4;
                        pixels[idx] = ink[0];
                        pixels[idx + 1] = ink[1];
                        pixels[idx + 2] = ink[2];
                    }
                }
            }
        }

        explorerPreviewCtx.putImageData(imageData, 0, 0);
    }

    function explorerRenderIFL(data) {
        // IFL: 8×2 multicolor - SCREEN_BITMAP_SIZE bitmap + 3072 attributes (1 attr per 2 pixel lines)
        explorerPreviewCanvas.width = SCREEN_WIDTH;
        explorerPreviewCanvas.height = SCREEN_HEIGHT;
        const imageData = explorerPreviewCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
        const pixels = imageData.data;

        const sections = [
            { bitmapAddr: 0, yOffset: 0 },
            { bitmapAddr: 2048, yOffset: 64 },
            { bitmapAddr: 4096, yOffset: 128 }
        ];

        for (const section of sections) {
            const { bitmapAddr, yOffset } = section;
            for (let line = 0; line < 8; line++) {
                for (let row = 0; row < 8; row++) {
                    for (let col = 0; col < 32; col++) {
                        const bitmapOffset = bitmapAddr + col + row * 32 + line * SCREEN_WIDTH;
                        const byte = data[bitmapOffset];

                        const screenY = yOffset + row * 8 + line;
                        // IFL: 96 attribute rows (SCREEN_HEIGHT/2), one per 2 pixel lines
                        const attrRow = Math.floor(screenY / 2);
                        const attrOffset = SCREEN_BITMAP_SIZE + attrRow * 32 + col;
                        const attr = data[attrOffset];

                        const isBright = (attr & 0x40) !== 0;
                        const ink = attr & 0x07;
                        const paper = (attr >> 3) & 0x07;
                        const pal = getExplorerPalette();
                        const palette = isBright ? pal.bright : pal.regular;
                        const inkRgb = palette[ink];
                        const paperRgb = palette[paper];

                        const x = col * 8;
                        for (let bit = 0; bit < 8; bit++) {
                            const isSet = (byte & (0x80 >> bit)) !== 0;
                            const rgb = isSet ? inkRgb : paperRgb;
                            const idx = ((screenY * SCREEN_WIDTH) + x + bit) * 4;
                            pixels[idx] = rgb[0];
                            pixels[idx + 1] = rgb[1];
                            pixels[idx + 2] = rgb[2];
                            pixels[idx + 3] = 255;
                        }
                    }
                }
            }
        }
        explorerPreviewCtx.putImageData(imageData, 0, 0);
    }

    function explorerRenderMLT(data) {
        // MLT: 8×1 multicolor - SCREEN_BITMAP_SIZE bitmap + SCREEN_BITMAP_SIZE attributes (1 attr per pixel line)
        explorerPreviewCanvas.width = SCREEN_WIDTH;
        explorerPreviewCanvas.height = SCREEN_HEIGHT;
        const imageData = explorerPreviewCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
        const pixels = imageData.data;

        const sections = [
            { bitmapAddr: 0, yOffset: 0 },
            { bitmapAddr: 2048, yOffset: 64 },
            { bitmapAddr: 4096, yOffset: 128 }
        ];

        for (const section of sections) {
            const { bitmapAddr, yOffset } = section;
            for (let line = 0; line < 8; line++) {
                for (let row = 0; row < 8; row++) {
                    for (let col = 0; col < 32; col++) {
                        const bitmapOffset = bitmapAddr + col + row * 32 + line * SCREEN_WIDTH;
                        const byte = data[bitmapOffset];

                        const screenY = yOffset + row * 8 + line;
                        // MLT: SCREEN_HEIGHT attribute rows, one per pixel line
                        const attrOffset = SCREEN_BITMAP_SIZE + screenY * 32 + col;
                        const attr = data[attrOffset];

                        const isBright = (attr & 0x40) !== 0;
                        const ink = attr & 0x07;
                        const paper = (attr >> 3) & 0x07;
                        const pal = getExplorerPalette();
                        const palette = isBright ? pal.bright : pal.regular;
                        const inkRgb = palette[ink];
                        const paperRgb = palette[paper];

                        const x = col * 8;
                        for (let bit = 0; bit < 8; bit++) {
                            const isSet = (byte & (0x80 >> bit)) !== 0;
                            const rgb = isSet ? inkRgb : paperRgb;
                            const idx = ((screenY * SCREEN_WIDTH) + x + bit) * 4;
                            pixels[idx] = rgb[0];
                            pixels[idx + 1] = rgb[1];
                            pixels[idx + 2] = rgb[2];
                            pixels[idx + 3] = 255;
                        }
                    }
                }
            }
        }
        explorerPreviewCtx.putImageData(imageData, 0, 0);
    }

    function explorerRenderRGB3(data) {
        // RGB3: Tricolor - 3 × SCREEN_BITMAP_SIZE bitmaps (Red, Green, Blue)
        explorerPreviewCanvas.width = SCREEN_WIDTH;
        explorerPreviewCanvas.height = SCREEN_HEIGHT;
        const imageData = explorerPreviewCtx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
        const pixels = imageData.data;

        // Fill with black
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 255;
        }

        const sections = [
            { bitmapAddr: 0, yOffset: 0 },
            { bitmapAddr: 2048, yOffset: 64 },
            { bitmapAddr: 4096, yOffset: 128 }
        ];

        // Process each color plane
        for (const section of sections) {
            const { bitmapAddr, yOffset } = section;
            for (let line = 0; line < 8; line++) {
                for (let row = 0; row < 8; row++) {
                    for (let col = 0; col < 32; col++) {
                        const baseOffset = bitmapAddr + col + row * 32 + line * SCREEN_WIDTH;
                        const redByte = data[baseOffset];                        // Red plane
                        const greenByte = data[baseOffset + SCREEN_BITMAP_SIZE];     // Green plane
                        const blueByte = data[baseOffset + SCREEN_BITMAP_SIZE * 2];  // Blue plane

                        const screenY = yOffset + row * 8 + line;
                        const x = col * 8;

                        for (let bit = 0; bit < 8; bit++) {
                            const mask = 0x80 >> bit;
                            const r = (redByte & mask) ? 255 : 0;
                            const g = (greenByte & mask) ? 255 : 0;
                            const b = (blueByte & mask) ? 255 : 0;

                            const idx = ((screenY * SCREEN_WIDTH) + x + bit) * 4;
                            pixels[idx] = r;
                            pixels[idx + 1] = g;
                            pixels[idx + 2] = b;
                            pixels[idx + 3] = 255;
                        }
                    }
                }
            }
        }
        explorerPreviewCtx.putImageData(imageData, 0, 0);
    }

    function explorerRenderDualScreen(screen5, screen7, activeScreen) {
        // Render two screens stacked vertically for 128K
        const gap = 8;
        const totalHeight = SCREEN_HEIGHT + gap + SCREEN_HEIGHT;  // 192 + 8 + 192 = 392
        const screen7Y = SCREEN_HEIGHT + gap;
        explorerPreviewCanvas.width = SCREEN_WIDTH;   // 256
        explorerPreviewCanvas.height = totalHeight;
        explorerPreviewContainer.classList.remove('hidden');
        explorerPreviewLabel.textContent = `Bank 5 / Bank 7 \u2014 Active: ${activeScreen}`;

        const imageData = explorerPreviewCtx.createImageData(SCREEN_WIDTH, totalHeight);
        const pixels = imageData.data;

        // Fill with dark background
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 32; pixels[i + 1] = 32; pixels[i + 2] = 48; pixels[i + 3] = 255;
        }

        // Render screen 5 (top)
        if (screen5) {
            explorerRenderSCRToImageData(pixels, SCREEN_WIDTH, screen5, 0, 0);
        }

        // Render screen 7 (bottom)
        if (screen7) {
            explorerRenderSCRToImageData(pixels, SCREEN_WIDTH, screen7, 0, screen7Y);
        }

        explorerPreviewCtx.putImageData(imageData, 0, 0);

        // Draw border around active screen
        explorerPreviewCtx.strokeStyle = '#0f0';
        explorerPreviewCtx.lineWidth = 2;
        if (activeScreen === 5) {
            explorerPreviewCtx.strokeRect(1, 1, 254, 190);
        } else {
            explorerPreviewCtx.strokeRect(1, screen7Y + 1, 254, 190);
        }

        // Apply 2x zoom (no syncPreviewHeight — dual screen sizes naturally)
        explorerPreviewCanvas.style.width = (SCREEN_WIDTH * 2) + 'px';
        explorerPreviewCanvas.style.height = (totalHeight * 2) + 'px';
        explorerPreviewContainer.style.height = '';
    }

    function explorerRenderSCRToImageData(pixels, canvasWidth, data, xOffset, yBase) {
        if (yBase === undefined) yBase = 0;
        const sections = [
            { bitmapAddr: 0, attrAddr: SCREEN_BITMAP_SIZE, yOffset: 0 },
            { bitmapAddr: 2048, attrAddr: SCREEN_BITMAP_SIZE + 256, yOffset: 64 },
            { bitmapAddr: 4096, attrAddr: SCREEN_BITMAP_SIZE + 512, yOffset: 128 }
        ];

        for (const section of sections) {
            const { bitmapAddr, attrAddr, yOffset } = section;
            for (let line = 0; line < 8; line++) {
                for (let row = 0; row < 8; row++) {
                    for (let col = 0; col < 32; col++) {
                        const bitmapOffset = bitmapAddr + col + row * 32 + line * SCREEN_WIDTH;
                        const byte = data[bitmapOffset];
                        const attrOffset = attrAddr + col + row * 32;
                        const attr = data[attrOffset];

                        const isBright = (attr & 0x40) !== 0;
                        const ink = attr & 0x07;
                        const paper = (attr >> 3) & 0x07;
                        const pal = getExplorerPalette();
                        const palette = isBright ? pal.bright : pal.regular;
                        const inkRgb = palette[ink];
                        const paperRgb = palette[paper];

                        const x = col * 8 + xOffset;
                        const y = yBase + yOffset + row * 8 + line;

                        for (let bit = 0; bit < 8; bit++) {
                            const isSet = (byte & (0x80 >> bit)) !== 0;
                            const rgb = isSet ? inkRgb : paperRgb;
                            const idx = ((y * canvasWidth) + x + bit) * 4;
                            pixels[idx] = rgb[0];
                            pixels[idx + 1] = rgb[1];
                            pixels[idx + 2] = rgb[2];
                            pixels[idx + 3] = 255;
                        }
                    }
                }
            }
        }
    }

    // Sub-tab switching
    document.querySelectorAll('.explorer-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.explorer-subtab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.explorer-subtab-content').forEach(c => {
                c.classList.remove('active');
                c.style.display = 'none';
            });
            btn.classList.add('active');
            const contentId = 'explorer-' + btn.dataset.subtab;
            const content = document.getElementById(contentId);
            if (content) {
                content.classList.add('active');
                content.style.display = '';
            }
            // Run the deferred preview/packed-screen detection only when Info is actually opened.
            if (btn.dataset.subtab === 'info' && explorerPreviewPending) {
                explorerPreviewPending = false;
                clearTimeout(explorerPreviewTimer);
                explorerPreviewTimer = setTimeout(() => {
                    explorerUpdatePreviewForFile();
                    explorerMarkPackedScreens();
                }, 0);
            }
        });
    });

    // File load button
    btnExplorerLoad.addEventListener('click', () => explorerFileInput.click());

    explorerFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = await file.arrayBuffer();
            explorerData = new Uint8Array(data);
            explorerFileName.textContent = file.name;
            explorerFileSize.textContent = `(${explorerData.length.toLocaleString()} bytes)`;

            // Detect file type (.img is a DISCiPLE/+D alias for .mgt, but only for valid MGT sizes)
            const ext = file.name.split('.').pop().toLowerCase();
            const isMgtSize = explorerData.length === 819200 || explorerData.length === 409600;
            explorerFileType = (ext === 'img' && isMgtSize) ? 'mgt' : ext;

            // Parse file
            await explorerParseFile(file.name, ext);

            // Clear all sub-tab outputs (prevent stale content from previous file)
            explorerBasicOutput.innerHTML = '<div class="explorer-empty">Select a BASIC program source</div>';
            explorerDisasmOutput.innerHTML = '<div class="explorer-empty">Select a source to disassemble</div>';
            explorerHexOutput.innerHTML = '';
            explorerTextOutput.innerHTML = '<span class="explorer-empty">Select a source and click View</span>';
            diskmapSectorMap = null;

            // Check if Edit tab is active with an editor-supported format
            const activeSubtab = document.querySelector('.explorer-subtab.active');
            const editorFormats = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'img', 'mdr', 'dsk', 'opd', 'opu', 'zip', 'sna', 'z80', 'szx'];
            const keepEditTab = activeSubtab && activeSubtab.dataset.subtab === 'edit' && editorFormats.includes(ext);

            // Render File Info (suppress auto-switch when staying on Edit tab)
            explorerRenderFileInfo(!keepEditTab);

            if (!keepEditTab) {
                document.querySelector('.explorer-subtab[data-subtab="info"]').click();
            }

        } catch (err) {
            explorerFileName.textContent = 'Error loading file';
            explorerFileSize.textContent = '';
            console.error('Explorer load error:', err);
        }

        e.target.value = '';
    });

    // Parse file based on type
    async function explorerParseFile(filename, ext) {
        explorerBlocks = [];
        explorerZipFiles = [];
        explorerParsed = null;
        explorerBankCache = new Map();
        explorerBankDirty = new Set();
        explorerBankAddressMode = 'bank';
        if (btnExplorerSaveModified) btnExplorerSaveModified.style.display = 'none';
        if (explorerBankStatus) explorerBankStatus.textContent = '';
        if (explorerBankTools) explorerBankTools.style.display = 'none';
        if (explorerBankAddrMode) explorerBankAddrMode.value = 'bank';
        // Reset active panel state for new file (only the panel that will receive the file)
        const targetPanel = getActivePanel();
        targetPanel.selection.clear();
        targetPanel.expandedBlock = -1;

        switch (ext) {
            case 'tap':
                explorerParsed = explorerParseTAP(explorerData);
                break;
            case 'tzx':
                explorerParsed = explorerParseTZX(explorerData);
                break;
            case 'sna':
                explorerParsed = explorerParseSNA(explorerData);
                break;
            case 'z80':
                explorerParsed = explorerParseZ80(explorerData);
                break;
            case 'trd':
                explorerParsed = explorerParseTRD(explorerData);
                break;
            case 'scl':
                explorerParsed = explorerParseSCL(explorerData);
                break;
            case 'mgt':
                explorerParsed = explorerParseMGT(explorerData);
                break;
            case 'img':
                if (explorerData.length === 819200 || explorerData.length === 409600) {
                    explorerParsed = explorerParseMGT(explorerData);
                } else {
                    explorerParsed = { type: 'unknown', size: explorerData.length };
                }
                break;
            case 'mdr':
                explorerParsed = explorerParseMDR(explorerData);
                break;
            case 'opd':
                explorerParsed = explorerParseOPD(explorerData);
                break;
            case 'd40':
            case 'd80':
                explorerParsed = explorerParseDidaktik(explorerData);
                break;
            case 'dsk':
                explorerParsed = explorerParseDSK(explorerData);
                break;
            case 'zip':
                // Save original ZIP data before explorerParseZIP may auto-drill into single file
                var zipOriginalData = new Uint8Array(explorerData);
                explorerParsed = await explorerParseZIP(explorerData);
                break;
            case 'scr':
            case 'bsc':
            case 'fnt':
            case 'chr':
                explorerParsed = explorerParseRawGraphics(explorerData, ext);
                break;
            case 'szx':
                explorerParsed = explorerParseSZX(explorerData);
                break;
            case 'rzx':
                explorerParsed = await explorerParseRZX(explorerData);
                break;
            default:
                if (isHobetaExt(ext)) {
                    explorerParsed = explorerParseHobeta(explorerData);
                    break;
                }
                // Check if raw data matches known graphics sizes
                explorerParsed = explorerParseRawGraphics(explorerData, ext);
        }

        // Auto-populate active editor panel for editable formats
        const editorFormats = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'img', 'mdr', 'dsk', 'opd', 'opu', 'd40', 'd80', 'sna', 'z80', 'szx'];
        if (editorFormats.includes(ext) && explorerParsed) {
            loadFileIntoPanel(targetPanel, explorerData, filename, ext, explorerParsed);
        } else if (ext === 'zip' && explorerParsed) {
            // Check if ZIP auto-drilled into a single editable file
            if (editorFormats.includes(explorerFileType) && explorerParsed.type !== 'zip') {
                const innerName = explorerFileName.textContent.split(' > ').pop() || filename;
                await loadFileIntoPanel(targetPanel, explorerData, innerName, explorerFileType, explorerParsed);
            } else {
                await loadFileIntoPanel(targetPanel, zipOriginalData, filename, 'zip', null);
            }
        }
    }

    // Raw graphics file parser (SCR, BSC, fonts, etc.)
    function explorerParseRawGraphics(data, ext) {
        const len = data.length;
        let graphicsType = null;
        let description = '';

        // Detect by size
        if (len === SCREEN_SIZE) {
            graphicsType = 'scr';
            description = 'ZX Spectrum Screen (bitmap + attributes)';
        } else if (len === SCREEN_BITMAP_SIZE) {
            graphicsType = 'bitmap';
            description = 'Monochrome Bitmap (full screen)';
        } else if (len === 4096) {
            graphicsType = 'bitmap_2_3';
            description = 'Monochrome Bitmap (2/3 screen)';
        } else if (len === 2048) {
            graphicsType = 'bitmap_1_3';
            description = 'Monochrome Bitmap (1/3 screen)';
        } else if (len === 768) {
            if (ext === 'fnt' || ext === 'chr') {
                graphicsType = 'font';
                description = 'ZX Spectrum Font (96 characters)';
            } else {
                graphicsType = 'attr';
                description = 'Attribute data (768 bytes)';
            }
        } else if (len === 9216) {
            graphicsType = 'ifl';
            description = 'IFL 8×2 Multicolor (6144 + 3072 attributes)';
        } else if (len === 11136) {
            graphicsType = 'bsc';
            description = 'BSC Screen (6912 + 4224 border)';
        } else if (len === 12288) {
            graphicsType = 'mlt';
            description = 'MLT 8×1 Multicolor (6144 + 6144 attributes)';
        } else if (len === 18432) {
            graphicsType = 'rgb3';
            description = 'RGB3 Tricolor (3 × 6144 bitmaps)';
        }

        if (graphicsType) {
            return {
                type: 'graphics',
                graphicsType: graphicsType,
                description: description,
                size: len,
                data: data
            };
        }

        return { type: 'unknown', size: len };
    }

    // TAP file parser
    function explorerParseTAP(data) {
        const blocks = [];
        let offset = 0;

        while (offset < data.length - 1) {
            const blockLen = data[offset] | (data[offset + 1] << 8);
            if (blockLen === 0 || offset + 2 + blockLen > data.length) break;

            const blockData = data.slice(offset + 2, offset + 2 + blockLen);
            const flag = blockData[0];

            let blockInfo = {
                offset: offset,
                length: blockLen,
                flag: flag,
                data: blockData
            };

            if (flag === 0 && blockLen === 19) {
                // Header block
                const type = blockData[1];
                const name = String.fromCharCode(...blockData.slice(2, 12)).trim();
                const dataLen = blockData[12] | (blockData[13] << 8);
                const param1 = blockData[14] | (blockData[15] << 8);
                const param2 = blockData[16] | (blockData[17] << 8);

                const typeNames = ['Program', 'Number array', 'Character array', 'Bytes'];
                blockInfo.blockType = 'header';
                blockInfo.headerType = type;
                blockInfo.typeName = typeNames[type] || 'Unknown';
                blockInfo.name = name;
                blockInfo.dataLength = dataLen;
                blockInfo.param1 = param1;
                blockInfo.param2 = param2;

                if (type === 0) {
                    // Program: param1 = autostart, param2 = vars offset
                    blockInfo.autostart = param1 < 32768 ? param1 : null;
                    blockInfo.varsOffset = param2;
                } else if (type === 3) {
                    // Bytes: param1 = start address
                    blockInfo.startAddress = param1;
                }
            } else {
                // Data block
                blockInfo.blockType = 'data';
            }

            blocks.push(blockInfo);
            offset += 2 + blockLen;
        }

        explorerBlocks = blocks;
        return { type: 'tap', blocks: blocks, size: data.length };
    }

    // TZX file parser
    function explorerParseTZX(data) {
        // Check TZX header: "ZXTape!" + 0x1A
        const header = String.fromCharCode(...data.slice(0, 7));
        if (header !== 'ZXTape!' || data[7] !== 0x1A) {
            return { type: 'unknown', size: data.length, error: 'Invalid TZX header' };
        }

        const versionMajor = data[8];
        const versionMinor = data[9];
        const blocks = [];
        let offset = 10;

        while (offset < data.length) {
            const blockId = data[offset];
            const blockName = TZX_BLOCK_NAMES[blockId] || `Unknown (0x${hex8(blockId)})`;
            let blockLen = 0;
            let blockInfo = {
                offset: offset,
                id: blockId,
                name: blockName
            };

            offset++;

            switch (blockId) {
                case 0x10: // Standard speed data block
                    {
                        const pause = data[offset] | (data[offset + 1] << 8);
                        const dataLen = data[offset + 2] | (data[offset + 3] << 8);
                        blockLen = 4 + dataLen;
                        blockInfo.pause = pause;
                        blockInfo.dataLength = dataLen;

                        // Parse header if it's a standard header block
                        const blockData = data.slice(offset + 4, offset + 4 + dataLen);
                        blockInfo.data = blockData;
                        if (dataLen === 19 && blockData[0] === 0) {
                            const type = blockData[1];
                            const name = String.fromCharCode(...blockData.slice(2, 12)).replace(/\x00/g, ' ').trim();
                            const len = blockData[12] | (blockData[13] << 8);
                            const param1 = blockData[14] | (blockData[15] << 8);
                            const param2 = blockData[16] | (blockData[17] << 8);
                            const typeNames = ['Program', 'Number array', 'Character array', 'Bytes'];
                            blockInfo.headerType = typeNames[type] || 'Unknown';
                            blockInfo.headerTypeId = type;
                            blockInfo.fileName = name;
                            blockInfo.fileLength = len;
                            if (type === 0) {
                                blockInfo.autostart = param1 < 32768 ? param1 : null;
                                blockInfo.varsOffset = param2;
                            }
                            if (type === 3) blockInfo.startAddress = param1;
                        } else if (blockData[0] === 0xFF) {
                            blockInfo.dataBlock = true;
                        }
                    }
                    break;

                case 0x11: // Turbo speed data block
                    {
                        // A $11 turbo-format block whose pulse widths match the ROM
                        // loader's timings actually loads at normal speed (common for
                        // the BASIC loader in modern re-releases). Report it as
                        // Standard Speed so the name reflects the real load speed.
                        const pilot = data[offset] | (data[offset + 1] << 8);
                        const sync1 = data[offset + 2] | (data[offset + 3] << 8);
                        const sync2 = data[offset + 4] | (data[offset + 5] << 8);
                        const zero  = data[offset + 6] | (data[offset + 7] << 8);
                        const one   = data[offset + 8] | (data[offset + 9] << 8);
                        blockInfo.standardTiming = (pilot === 2168 && sync1 === 667 && sync2 === 735 && zero === 855 && one === 1710);
                        if (blockInfo.standardTiming) blockInfo.name = 'Standard Speed Data';

                        const dataLen = data[offset + 15] | (data[offset + 16] << 8) | (data[offset + 17] << 16);
                        blockLen = 18 + dataLen;
                        blockInfo.dataLength = dataLen;
                        blockInfo.pause = data[offset + 13] | (data[offset + 14] << 8);

                        // Parse inner data to detect standard tape headers/data
                        const blockData = data.slice(offset + 18, offset + 18 + dataLen);
                        blockInfo.data = blockData;
                        if (dataLen === 19 && blockData[0] === 0) {
                            const type = blockData[1];
                            const name = String.fromCharCode(...blockData.slice(2, 12)).replace(/\x00/g, ' ').trim();
                            const len = blockData[12] | (blockData[13] << 8);
                            const param1 = blockData[14] | (blockData[15] << 8);
                            const param2 = blockData[16] | (blockData[17] << 8);
                            const typeNames = ['Program', 'Number array', 'Character array', 'Bytes'];
                            blockInfo.headerType = typeNames[type] || 'Unknown';
                            blockInfo.headerTypeId = type;
                            blockInfo.fileName = name;
                            blockInfo.fileLength = len;
                            if (type === 0) {
                                blockInfo.autostart = param1 < 32768 ? param1 : null;
                                blockInfo.varsOffset = param2;
                            }
                            if (type === 3) blockInfo.startAddress = param1;
                        } else if (blockData.length > 0 && blockData[0] === 0xFF) {
                            blockInfo.dataBlock = true;
                        }
                    }
                    break;

                case 0x12: // Pure tone
                    blockLen = 4;
                    blockInfo.pulseLength = data[offset] | (data[offset + 1] << 8);
                    blockInfo.pulseCount = data[offset + 2] | (data[offset + 3] << 8);
                    break;

                case 0x13: // Pulse sequence
                    {
                        const pulseCount = data[offset];
                        blockLen = 1 + pulseCount * 2;
                    }
                    break;

                case 0x14: // Pure data block
                    blockLen = 10 + (data[offset + 7] | (data[offset + 8] << 8) | (data[offset + 9] << 16));
                    blockInfo.dataLength = blockLen - 10;
                    break;

                case 0x15: // Direct recording
                    {
                        const drDataLen = data[offset + 5] | (data[offset + 6] << 8) | (data[offset + 7] << 16);
                        blockLen = 8 + drDataLen;
                        blockInfo.dataLength = drDataLen;
                        blockInfo.tStatesPerSample = data[offset] | (data[offset + 1] << 8);
                        blockInfo.pause = data[offset + 2] | (data[offset + 3] << 8);
                        blockInfo.lastBits = data[offset + 4];
                    }
                    break;

                case 0x18: // CSW recording
                    blockLen = 4 + (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24));
                    break;

                case 0x19: // Generalized data block
                    blockLen = 4 + (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24));
                    break;

                case 0x20: // Pause/stop
                    blockLen = 2;
                    blockInfo.pause = data[offset] | (data[offset + 1] << 8);
                    if (blockInfo.pause === 0) blockInfo.stopTape = true;
                    break;

                case 0x21: // Group start
                    {
                        const nameLen = data[offset];
                        blockLen = 1 + nameLen;
                        blockInfo.groupName = String.fromCharCode(...data.slice(offset + 1, offset + 1 + nameLen));
                    }
                    break;

                case 0x22: // Group end
                    blockLen = 0;
                    break;

                case 0x23: // Jump to block
                    blockLen = 2;
                    blockInfo.jump = data[offset] | (data[offset + 1] << 8);
                    break;

                case 0x24: // Loop start
                    blockLen = 2;
                    blockInfo.repetitions = data[offset] | (data[offset + 1] << 8);
                    break;

                case 0x25: // Loop end
                    blockLen = 0;
                    break;

                case 0x26: // Call sequence
                    {
                        const callCount = data[offset] | (data[offset + 1] << 8);
                        blockLen = 2 + callCount * 2;
                    }
                    break;

                case 0x27: // Return from sequence
                    blockLen = 0;
                    break;

                case 0x28: // Select block
                    blockLen = 2 + (data[offset] | (data[offset + 1] << 8));
                    break;

                case 0x2A: // Stop tape if in 48K mode
                    blockLen = 4;
                    break;

                case 0x2B: // Set signal level
                    blockLen = 5;
                    break;

                case 0x30: // Text description
                    {
                        const textLen = data[offset];
                        blockLen = 1 + textLen;
                        blockInfo.text = String.fromCharCode(...data.slice(offset + 1, offset + 1 + textLen));
                    }
                    break;

                case 0x31: // Message block
                    {
                        const msgLen = data[offset + 1];
                        blockLen = 2 + msgLen;
                        blockInfo.displayTime = data[offset];
                        blockInfo.message = String.fromCharCode(...data.slice(offset + 2, offset + 2 + msgLen));
                    }
                    break;

                case 0x32: // Archive info
                    {
                        const archiveLen = data[offset] | (data[offset + 1] << 8);
                        blockLen = 2 + archiveLen;
                        // Parse archive info strings
                        const infoTypes = ['Title', 'Publisher', 'Author', 'Year', 'Language', 'Type', 'Price', 'Loader', 'Origin', 'Comment'];
                        const stringCount = data[offset + 2];
                        let infoOffset = offset + 3;
                        blockInfo.archiveInfo = [];
                        for (let i = 0; i < stringCount && infoOffset < offset + 2 + archiveLen; i++) {
                            const typeId = data[infoOffset];
                            const strLen = data[infoOffset + 1];
                            const str = String.fromCharCode(...data.slice(infoOffset + 2, infoOffset + 2 + strLen));
                            blockInfo.archiveInfo.push({
                                type: infoTypes[typeId] || `Info ${typeId}`,
                                value: str
                            });
                            infoOffset += 2 + strLen;
                        }
                    }
                    break;

                case 0x33: // Hardware type
                    {
                        const hwCount = data[offset];
                        blockLen = 1 + hwCount * 3;
                    }
                    break;

                case 0x35: // Custom info block
                    blockLen = 20 + (data[offset + 16] | (data[offset + 17] << 8) | (data[offset + 18] << 16) | (data[offset + 19] << 24));
                    blockInfo.customId = String.fromCharCode(...data.slice(offset, offset + 16)).replace(/\x00/g, '').trim();
                    break;

                case 0x5A: // Glue block
                    blockLen = 9;
                    break;

                default:
                    // Unknown block - try to skip based on common patterns
                    // Many unknown blocks have length at offset 0-3
                    if (offset + 4 <= data.length) {
                        blockLen = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24);
                        if (blockLen > data.length - offset) {
                            // Invalid length, stop parsing
                            blockInfo.error = 'Unknown block type, cannot determine length';
                            blocks.push(blockInfo);
                            offset = data.length;
                            continue;
                        }
                    } else {
                        offset = data.length;
                        continue;
                    }
            }

            blockInfo.length = blockLen;
            blocks.push(blockInfo);
            offset += blockLen;
        }

        explorerBlocks = blocks;
        return {
            type: 'tzx',
            version: `${versionMajor}.${String(versionMinor).padStart(2, '0')}`,
            blocks: blocks,
            size: data.length
        };
    }

    // SNA file parser
    function explorerParseSNA(data) {
        const is128 = data.length === 131103 || data.length === 147487;

        const regs = {
            I: data[0],
            HLa: data[1] | (data[2] << 8),
            DEa: data[3] | (data[4] << 8),
            BCa: data[5] | (data[6] << 8),
            AFa: data[7] | (data[8] << 8),
            HL: data[9] | (data[10] << 8),
            DE: data[11] | (data[12] << 8),
            BC: data[13] | (data[14] << 8),
            IY: data[15] | (data[16] << 8),
            IX: data[17] | (data[18] << 8),
            IFF2: (data[19] & 0x04) ? 1 : 0,
            R: data[20],
            AF: data[21] | (data[22] << 8),
            SP: data[23] | (data[24] << 8),
            IM: data[25],
            border: data[26]
        };

        // For 48K SNA, PC is on stack
        if (!is128) {
            const spOffset = regs.SP - 0x4000 + 27;
            if (spOffset >= 0 && spOffset < data.length - 1) {
                regs.PC = data[spOffset] | (data[spOffset + 1] << 8);
            }
        } else {
            // 128K SNA has PC after memory
            regs.PC = data[49179] | (data[49180] << 8);
            regs.port7FFD = data[49181];
            regs.trdosROM = data[49182];
        }

        return {
            type: 'sna',
            is128: is128,
            registers: regs,
            memoryOffset: 27,
            size: data.length
        };
    }

    // Z80 file parser
    function explorerParseZ80(data) {
        const regs = {
            A: data[0],
            F: data[1],
            BC: data[2] | (data[3] << 8),
            HL: data[4] | (data[5] << 8),
            PC: data[6] | (data[7] << 8),
            SP: data[8] | (data[9] << 8),
            I: data[10],
            R: (data[11] & 0x7f) | ((data[12] & 0x01) << 7),
            border: (data[12] >> 1) & 0x07,
            DE: data[13] | (data[14] << 8),
            BCa: data[15] | (data[16] << 8),
            DEa: data[17] | (data[18] << 8),
            HLa: data[19] | (data[20] << 8),
            Aa: data[21],
            Fa: data[22],
            IY: data[23] | (data[24] << 8),
            IX: data[25] | (data[26] << 8),
            IFF1: data[27] ? 1 : 0,
            IFF2: data[28] ? 1 : 0,
            IM: data[29] & 0x03
        };

        let version = 1;
        let is128 = false;
        let compressed = (data[12] & 0x20) !== 0;
        let hwMode = 0;
        let port7FFD = 0;
        let pages = [];

        if (regs.PC === 0) {
            // V2 or V3
            const extLen = data[30] | (data[31] << 8);
            version = extLen === 23 ? 2 : 3;
            regs.PC = data[32] | (data[33] << 8);
            hwMode = data[34];
            port7FFD = data[35];

            if (version === 2) {
                // V2: hwMode 3=128K, 4=128K+IF1, 9=Pentagon (non-standard but used by some savers)
                is128 = hwMode === 3 || hwMode === 4 || hwMode === 9;
            } else {
                // V3: 4-6=128K variants, 7=+3, 9=Pentagon, 12=+2, 13=+2A
                is128 = hwMode >= 4 && hwMode <= 6 || hwMode === 7 || hwMode === 9 || hwMode === 12 || hwMode === 13;
            }

            // Parse pages
            const headerLen = 30 + 2 + extLen;
            let offset = headerLen;
            while (offset < data.length - 3) {
                const compLen = data[offset] | (data[offset + 1] << 8);
                const pageNum = data[offset + 2];
                const isCompressed = compLen !== 0xffff;
                const dataLen = isCompressed ? compLen : 16384;

                // Determine page description
                let pageDesc = '';
                if (is128 || hwMode === 9) {
                    // 128K/Pentagon page mapping
                    if (pageNum === 0) pageDesc = 'ROM 48K (modified)';
                    else if (pageNum === 1) pageDesc = 'IF1 ROM';
                    else if (pageNum === 2) pageDesc = 'ROM 128K (modified)';
                    else if (pageNum >= 3 && pageNum <= 10) pageDesc = `RAM bank ${pageNum - 3}`;
                    else if (pageNum === 11) pageDesc = 'Multiface ROM';
                    else pageDesc = `Unknown`;
                } else {
                    // 48K page mapping
                    if (pageNum === 4) pageDesc = '0x8000-0xBFFF';
                    else if (pageNum === 5) pageDesc = '0xC000-0xFFFF';
                    else if (pageNum === 8) pageDesc = '0x4000-0x7FFF';
                    else pageDesc = `Unknown`;
                }

                pages.push({
                    num: pageNum,
                    offset: offset,
                    compLen: isCompressed ? compLen : 16384,
                    compressed: isCompressed,
                    desc: pageDesc
                });

                offset += 3 + dataLen;
            }
        }

        regs.AF = (regs.A << 8) | regs.F;
        regs.AFa = (regs.Aa << 8) | regs.Fa;

        return {
            type: 'z80',
            version: version,
            is128: is128,
            hwMode: hwMode,
            port7FFD: port7FFD,
            compressed: compressed,
            registers: regs,
            pages: pages,
            size: data.length
        };
    }

    // SZX file parser
    function explorerParseSZX(data) {
        if (!SZXLoader.isSZX(data)) {
            return { type: 'szx', error: 'Invalid SZX file', size: data.length };
        }

        const info = SZXLoader.parse(data);
        const bytes = new Uint8Array(data);

        // Extract registers from Z80R chunk
        const regs = {};
        for (const chunk of info.chunks) {
            if (chunk.id === 'Z80R') {
                const r = bytes.slice(chunk.offset, chunk.offset + chunk.size);
                regs.F = r[0]; regs.A = r[1];
                regs.C = r[2]; regs.B = r[3];
                regs.E = r[4]; regs.D = r[5];
                regs.L = r[6]; regs.H = r[7];
                regs.Fa = r[8]; regs.Aa = r[9];
                regs.Ca = r[10]; regs.Ba = r[11];
                regs.Ea = r[12]; regs.Da = r[13];
                regs.La = r[14]; regs.Ha = r[15];
                regs.IXL = r[16]; regs.IXH = r[17];
                regs.IYL = r[18]; regs.IYH = r[19];
                regs.SP = r[20] | (r[21] << 8);
                regs.PC = r[22] | (r[23] << 8);
                regs.I = r[24];
                regs.R = r[25];
                regs.IFF1 = r[26] & 1;
                regs.IFF2 = r[27] & 1;
                regs.IM = r[28];
                // Combine register pairs
                regs.AF = (regs.A << 8) | regs.F;
                regs.BC = (regs.B << 8) | regs.C;
                regs.DE = (regs.D << 8) | regs.E;
                regs.HL = (regs.H << 8) | regs.L;
                regs.AFa = (regs.Aa << 8) | regs.Fa;
                regs.BCa = (regs.Ba << 8) | regs.Ca;
                regs.DEa = (regs.Da << 8) | regs.Ea;
                regs.HLa = (regs.Ha << 8) | regs.La;
                regs.IX = (regs.IXH << 8) | regs.IXL;
                regs.IY = (regs.IYH << 8) | regs.IYL;
                break;
            }
        }

        // Extract border from SPCR chunk
        let border = 0;
        let port7FFD = 0;
        for (const chunk of info.chunks) {
            if (chunk.id === 'SPCR') {
                border = bytes[chunk.offset];
                port7FFD = bytes[chunk.offset + 1];
                break;
            }
        }
        regs.border = border;
        regs.port7FFD = port7FFD;

        return {
            type: 'szx',
            version: `${info.majorVersion}.${info.minorVersion}`,
            machineId: info.machineId,
            machineType: info.machineType,
            is128: info.is128,
            chunks: info.chunks,
            registers: regs,
            size: data.length
        };
    }

    // RZX file parser
    async function explorerParseRZX(data) {
        if (!RZXLoader.isRZX(data)) {
            return { type: 'rzx', error: 'Invalid RZX file', size: data.length };
        }

        const rzxLoader = new RZXLoader();
        try {
            await rzxLoader.parse(data.buffer || data);

            const result = {
                type: 'rzx',
                totalFrames: rzxLoader.getFrameCount(),
                creatorInfo: rzxLoader.creatorInfo,
                snapshotType: rzxLoader.getSnapshotType(),
                snapshot: rzxLoader.getSnapshot(),
                allSnapshots: rzxLoader.allSnapshots || [],
                size: data.length,
                stats: rzxLoader.getStats(),
                frames: rzxLoader.getFrames()
            };

            // Parse embedded snapshot for registers
            if (result.snapshot && result.snapshotType) {
                if (result.snapshotType === 'sna') {
                    result.embeddedParsed = explorerParseSNA(result.snapshot);
                } else if (result.snapshotType === 'z80') {
                    result.embeddedParsed = explorerParseZ80(result.snapshot);
                }
            }

            return result;
        } catch (e) {
            return { type: 'rzx', error: e.message, size: data.length };
        }
    }

    // Decode a TR-DOS catalogue entry's 9-10 / 11-12 words by file type.
    // BASIC (B, 0x42): 9-10 = total length (program + variables), 11-12 = program
    // length (offset where variables begin). CODE/others: 9-10 = start/load
    // address, 11-12 = data length. `length` is always the byte count to extract.
    function trdEntryFields(extByte, w9, w11) {
        if (extByte === 0x42) return { startAddress: 0, length: w9, programLength: w11 };
        return { startAddress: w9, length: w11, programLength: null };
    }

    // TRD file parser
    function explorerParseTRD(data) {
        const files = [];

        // Read directory (first 8 sectors = 2048 bytes)
        for (let i = 0; i < 128; i++) {
            const entryOffset = i * 16;
            if (data[entryOffset] === 0) break;
            if (data[entryOffset] === 1) continue; // Deleted

            const name = String.fromCharCode(...data.slice(entryOffset, entryOffset + 8)).replace(/\s+$/, '');
            const ext = String.fromCharCode(data[entryOffset + 8]);
            const w9 = data[entryOffset + 9] | (data[entryOffset + 10] << 8);
            const w11 = data[entryOffset + 11] | (data[entryOffset + 12] << 8);
            const { startAddress: startAddr, length, programLength } = trdEntryFields(data[entryOffset + 8], w9, w11);
            const sectors = data[entryOffset + 13];
            const startSector = data[entryOffset + 14];
            const startTrack = data[entryOffset + 15];

            files.push({
                name: name,
                ext: ext,
                startAddress: startAddr,
                length: length,
                programLength: programLength,
                sectors: sectors,
                startSector: startSector,
                startTrack: startTrack,
                offset: (startTrack * 16 + startSector) * 256
            });
        }

        // Read disk info from sector 8 (track 0, sector 8)
        const infoOffset = 8 * 256;
        const diskTitle = String.fromCharCode(...data.slice(infoOffset + 0xF5, infoOffset + 0xFD)).trim();
        const freeSpace = data[infoOffset + 0xE5];

        explorerBlocks = files;
        return {
            type: 'trd',
            files: files,
            diskTitle: diskTitle,
            freeSectors: freeSpace,
            size: data.length
        };
    }

    // SCL file parser
    function explorerParseSCL(data) {
        const files = [];

        // Check signature
        const sig = String.fromCharCode(...data.slice(0, 8));
        if (sig !== 'SINCLAIR') {
            return { type: 'scl', error: 'Invalid SCL signature', size: data.length };
        }

        const fileCount = data[8];
        let offset = 9;

        for (let i = 0; i < fileCount; i++) {
            const name = String.fromCharCode(...data.slice(offset, offset + 8)).replace(/\s+$/, '');
            const ext = String.fromCharCode(data[offset + 8]);
            const w9 = data[offset + 9] | (data[offset + 10] << 8);
            const w11 = data[offset + 11] | (data[offset + 12] << 8);
            const { startAddress: startAddr, length, programLength } = trdEntryFields(data[offset + 8], w9, w11);
            const sectors = data[offset + 13];

            files.push({
                name: name,
                ext: ext,
                startAddress: startAddr,
                length: length,
                programLength: programLength,
                sectors: sectors
            });

            offset += 14;
        }

        // Calculate data offsets
        let dataOffset = 9 + fileCount * 14;
        for (const file of files) {
            file.offset = dataOffset;
            dataOffset += file.sectors * 256;
        }

        explorerBlocks = files;
        return {
            type: 'scl',
            files: files,
            size: data.length
        };
    }

    // MGT disk image parser
    function explorerParseMGT(data) {
        const files = MGTLoader.listFiles(data);
        const info = MGTLoader.getDiskInfo(data);

        // Convert to explorer format with offset/ext for compatibility
        const explorerFiles = files.map(f => ({
            name: f.name,
            ext: f.typeName.substring(0, 1).toUpperCase(),  // First char as short type
            typeName: f.typeName,
            type: f.type,
            mgtType: f.type,
            startAddress: f.startAddress,
            length: f.length,
            sectors: f.sectors,
            sectorMap: f.sectorMap,
            firstTrack: f.firstTrack,
            firstSector: f.firstSector,
            autostart: f.autostart,
            bodyLength: f.bodyLength,
            tapeType: f.tapeType,
            isSAMDOS: f.isSAMDOS,
            slotIndex: f.slotIndex
        }));

        explorerBlocks = explorerFiles;
        return {
            type: 'mgt',
            files: explorerFiles,
            info: info,
            size: data.length
        };
    }

    // MDR cartridge image parser
    function explorerParseMDR(data) {
        const files = MDRLoader.listFiles(data);
        const info = MDRLoader.getDiskInfo(data);
        const explorerFiles = files.map(f => {
            let ext = f.isPrint ? 'P' : 'F';
            let typeName = f.type;
            // Non-PRINT files have a 9-byte Spectrum header:
            // type(1) len(2) start(2) progLen(2) autorun(2)
            // Byte 0: file type, Bytes 1-2: data length, Bytes 3-4: start address (CODE) or PROG addr (BASIC)
            // Bytes 5-6: program length (BASIC), Bytes 7-8: autostart line (BASIC, >=0x8000 = none)
            let dataLength = f.length;
            let startAddress = 0;
            let autorunLine = -1;
            if (f.length >= 9) {
                const fileData = MDRLoader.extractFile(data, f);
                if (fileData && fileData.length >= 9) {
                    const hdrType = fileData[0];
                    const hdrLen = fileData[1] | (fileData[2] << 8);
                    const hdrStart = fileData[3] | (fileData[4] << 8);
                    // For PRINT-flagged files, only accept header if it looks valid
                    // (handles MDR images from tools that don't set RECFLG bit 2 correctly)
                    const hasValidHeader = !f.isPrint ||
                        (hdrType <= 3 && hdrLen > 0 && hdrLen <= fileData.length - 9);
                    if (hasValidHeader) {
                        dataLength = hdrLen;
                        if (hdrType === 0) {
                            ext = 'B'; typeName = 'BASIC';
                            const hdrAutorun = fileData[7] | (fileData[8] << 8);
                            autorunLine = hdrAutorun >= 0x8000 ? -1 : hdrAutorun;
                        } else if (hdrType === 1) { ext = 'D'; typeName = 'Num array'; }
                        else if (hdrType === 2) { ext = 'D'; typeName = 'Char array'; }
                        else if (hdrType === 3) {
                            ext = 'C'; typeName = 'Code';
                            startAddress = hdrStart;
                        }
                    }
                }
            }
            // If header was successfully parsed, this is not a PRINT file
            const resolvedIsPrint = f.isPrint && typeName === f.type;
            return {
                name: f.name,
                ext,
                typeName,
                length: f.length,
                dataLength,
                startAddress,
                autorunLine,
                sectors: f.sectors,
                sectorIndices: f.sectorIndices,
                isPrint: resolvedIsPrint,
                deleted: f.deleted || false,
                mdrFile: true
            };
        });
        explorerBlocks = explorerFiles;
        return { type: 'mdr', files: explorerFiles, info: info, size: data.length };
    }

    // OPD disk image parser (Opus Discovery)
    function explorerParseOPD(data) {
        const info = OPDLoader.getDiskInfo(data);
        const files = OPDLoader.listFiles(data);
        explorerBlocks = files;
        return { type: 'opd', files: files, info: info, size: data.length };
    }

    // Didaktik 40/80 MDOS disk image parser
    function explorerParseDidaktik(data) {
        const info = DidaktikLoader.getDiskInfo(data);
        const files = DidaktikLoader.listFiles(data);
        explorerBlocks = files;
        return { type: 'didaktik', files: files, info: info, size: data.length };
    }

    // Hobeta file parser
    function explorerParseHobeta(data) {
        const file = parseHobeta(data);
        if (!file) {
            return { type: 'hobeta', error: 'Invalid Hobeta file (CRC mismatch)', size: data.length };
        }
        const trdTypeNames = TRD_TYPE_NAMES;
        explorerBlocks = [file];
        return {
            type: 'hobeta',
            file: file,
            typeName: trdTypeNames[file.ext] || file.ext,
            size: data.length
        };
    }

    // DSK file parser
    function explorerParseDSK(data) {
        try {
            const dskImage = DSKLoader.parse(data);
            const diskSpec = DSKLoader.getDiskSpec(dskImage);
            let files = [];
            try {
                files = DSKLoader.listFiles(dskImage);
            } catch (e) {
                // Non-CP/M disk or corrupt directory — show geometry without files
            }

            // Store DSKImage for later file data extraction
            explorerBlocks = files;
            return {
                type: 'dsk',
                dskImage: dskImage,
                diskSpec: diskSpec,
                files: files,
                isExtended: dskImage.isExtended,
                numTracks: dskImage.numTracks,
                numSides: dskImage.numSides,
                size: data.length
            };
        } catch (err) {
            return { type: 'dsk', error: err.message, size: data.length };
        }
    }

    // ZIP file parser
    async function explorerParseZIP(data) {
        try {
            const files = await ZipLoader.extract(data.buffer);
            explorerZipFiles = files;

            // Auto-drill into ZIP if it contains exactly one supported file
            const supportedExts = ['tap', 'tzx', 'sna', 'z80', 'szx', 'rzx', 'trd', 'scl', 'mgt', 'img', 'mdr', 'opd', 'opu', 'd40', 'd80', 'dsk'];
            const supportedFiles = files.filter(f => {
                const ext = f.name.split('.').pop().toLowerCase();
                if (ext === 'img') return f.data && (f.data.length === 819200 || f.data.length === 409600);
                return supportedExts.includes(ext);
            });

            if (supportedFiles.length === 0) {
                // No supported files — list contents but show warning
                const extList = files.map(f => f.name.split('.').pop().toUpperCase()).filter((v, i, a) => a.indexOf(v) === i);
                return {
                    type: 'zip',
                    files: files.map(f => ({ name: f.name, size: f.data.length })),
                    size: data.length,
                    warning: `No supported ZX Spectrum files found (${extList.join(', ')})`
                };
            }

            if (supportedFiles.length === 1) {
                // Auto-extract and parse the single file
                const zipFile = supportedFiles[0];
                const ext = zipFile.name.split('.').pop().toLowerCase();

                explorerZipParentName = explorerFileName.textContent;
                explorerData = new Uint8Array(zipFile.data);
                explorerFileName.textContent = `${explorerZipParentName} > ${zipFile.name}`;
                explorerFileSize.textContent = `(${explorerData.length.toLocaleString()} bytes)`;
                const isMgtSize = explorerData.length === 819200 || explorerData.length === 409600;
                explorerFileType = (ext === 'img' && isMgtSize) ? 'mgt' : ext;

                // Parse based on type
                switch (ext) {
                    case 'tap':
                        return explorerParseTAP(explorerData);
                    case 'tzx':
                        return explorerParseTZX(explorerData);
                    case 'sna':
                        return explorerParseSNA(explorerData);
                    case 'z80':
                        return explorerParseZ80(explorerData);
                    case 'szx':
                        return explorerParseSZX(explorerData);
                    case 'rzx':
                        return await explorerParseRZX(explorerData);
                    case 'trd':
                        return explorerParseTRD(explorerData);
                    case 'scl':
                        return explorerParseSCL(explorerData);
                    case 'mgt':
                        return explorerParseMGT(explorerData);
                    case 'img':
                        if (isMgtSize) return explorerParseMGT(explorerData);
                        return { type: 'unknown', size: explorerData.length };
                    case 'mdr':
                        return explorerParseMDR(explorerData);
                    case 'opd':
                    case 'opu':
                        return explorerParseOPD(explorerData);
                    case 'd40':
                    case 'd80':
                        return explorerParseDidaktik(explorerData);
                    case 'dsk':
                        return explorerParseDSK(explorerData);
                }
            }

            return {
                type: 'zip',
                files: files.map(f => ({
                    name: f.name,
                    size: f.data.length
                })),
                size: data.length
            };
        } catch (err) {
            return { type: 'zip', error: err.message, size: data.length };
        }
    }

    // Helper to render register table
    function explorerRenderRegsTable(r) {
        return `<table class="explorer-info-table">
            <tr><th>PC</th><td>${fmtAddr(r.PC)}</td><th>SP</th><td>${fmtAddr(r.SP)}</td></tr>
            <tr><th>AF</th><td>${fmtAddr(r.AF)}</td><th>AF'</th><td>${fmtAddr(r.AFa)}</td></tr>
            <tr><th>BC</th><td>${fmtAddr(r.BC)}</td><th>BC'</th><td>${fmtAddr(r.BCa)}</td></tr>
            <tr><th>DE</th><td>${fmtAddr(r.DE)}</td><th>DE'</th><td>${fmtAddr(r.DEa)}</td></tr>
            <tr><th>HL</th><td>${fmtAddr(r.HL)}</td><th>HL'</th><td>${fmtAddr(r.HLa)}</td></tr>
            <tr><th>IX</th><td>${fmtAddr(r.IX)}</td><th>IY</th><td>${fmtAddr(r.IY)}</td></tr>
            <tr><th>I</th><td>${fmtByte(r.I)}</td><th>R</th><td>${fmtByte(r.R)}</td></tr>
            <tr><th>IM</th><td>${r.IM}</td><th>IFF2</th><td>${r.IFF2}</td></tr>
            <tr><th>Border</th><td>${r.border}</td><th></th><td></td></tr>
        </table>`;
    }

    // Render File Info
    function explorerRenderFileInfo(autoSwitchTab = true) {
        if (!explorerParsed) {
            explorerInfoOutput.innerHTML = '<div class="explorer-empty">No file loaded</div>';
            return;
        }

        let html = '';

        switch (explorerParsed.type) {
            case 'tap':
                html = explorerRenderTAPInfo();
                break;
            case 'tzx':
                html = explorerRenderTZXInfo();
                break;
            case 'sna':
                html = explorerRenderSNAInfo();
                break;
            case 'z80':
                html = explorerRenderZ80Info();
                break;
            case 'szx':
                html = explorerRenderSZXInfo();
                break;
            case 'rzx':
                html = explorerRenderRZXInfo();
                break;
            case 'trd':
                html = explorerRenderTRDInfo();
                break;
            case 'scl':
                html = explorerRenderSCLInfo();
                break;
            case 'mgt':
                html = explorerRenderMGTInfo();
                break;
            case 'mdr':
                html = explorerRenderMDRInfo();
                break;
            case 'opd':
                html = explorerRenderOPDInfo();
                break;
            case 'didaktik':
                html = explorerRenderDidaktikInfo();
                break;
            case 'dsk':
                html = explorerRenderDSKInfo();
                break;
            case 'hobeta':
                html = explorerRenderHobetaInfo();
                break;
            case 'zip':
                html = explorerRenderZIPInfo();
                break;
            case 'graphics':
                html = explorerRenderGraphicsInfo();
                break;
            default:
                html = `<div class="explorer-info-section"><div class="explorer-info-header">File Info</div><table class="explorer-info-table"><tr><th>Type</th><td>Unknown</td></tr><tr><th>Size</th><td>${explorerParsed.size.toLocaleString()} bytes</td></tr></table></div>`;
        }

        explorerInfoOutput.innerHTML = html;

        // Update source selectors
        explorerUpdateSourceSelectors(autoSwitchTab);

        // Preview + packed-screen detection are File-Info-tab features and can be non-trivial
        // (per-file scans, speculative ZX0/ZX7 depacking). Only run them when the Info tab is
        // actually being shown; if we're staying on the Edit tab, defer until the user opens
        // Info (see the subtab click handler) so disk editing never pays for the detection.
        clearTimeout(explorerPreviewTimer);
        if (autoSwitchTab) {
            explorerPreviewPending = false;
            explorerPreviewTimer = setTimeout(() => {
                explorerUpdatePreviewForFile();
                explorerMarkPackedScreens();
            }, 0);
        } else {
            explorerPreviewPending = true;
        }
    }

    function explorerRenderGraphicsInfo() {
        const p = explorerParsed;
        return `<div class="explorer-info-section"><div class="explorer-info-header">${p.description}</div><table class="explorer-info-table"><tr><th>Type</th><td>${p.graphicsType.toUpperCase()}</td></tr><tr><th>Size</th><td>${p.size.toLocaleString()} bytes</td></tr></table></div>`;
    }

    // Fallback: try to preview a size-windowed block as a ZX0/ZX7-packed standard
    // screen. Returns true (and renders) on a confident match. Called only after the
    // exact-length (uncompressed) screen checks miss, so a real screen always wins.
    // Holds the raw (un-RCS'd) decode of the currently-previewed packed screen, so the
    // RCS toggle can re-render without re-depacking. Cleared whenever a non-packed
    // preview is shown (reset at the top of explorerUpdatePreviewForFile).
    let explorerPackedScreen = null;

    function explorerRenderPackedScreen() {
        if (!explorerPackedScreen) return;
        const useRcs = explorerRcsToggle && explorerRcsToggle.checked;
        explorerRenderSCR(useRcs ? rcsToScr(explorerPackedScreen.data) : explorerPackedScreen.data);
        explorerPreviewCanvas.style.width = (explorerPreviewCanvas.width * 2) + 'px';
        explorerPreviewCanvas.style.height = (explorerPreviewCanvas.height * 2) + 'px';
        syncPreviewHeight();
        explorerPreviewLabel.textContent = explorerPackedScreen.label + (useRcs ? ' +RCS' : '');
    }

    // Detected packed screens by catalog index — populated by explorerMarkPackedScreens()
    // so clicking a 📦-marked entry re-shows it without re-depacking.
    const explorerPackedCache = new Map();

    function explorerShowPackedScreen(hit, fileName) {
        const where = hit.offset > 0 ? ` @${hit.offset}` : '';
        const via = hit.viaSignature ? ' [sig]' : '';
        explorerPackedScreen = {
            data: hit.data,
            name: fileName || 'screen',
            label: `${hit.format} packed screen${hit.direction === 'backward' ? ' (reverse)' : ''}${where}${via}`
                + (fileName ? ` — ${String(fileName).replace(/\s+$/, '')}` : '')
        };
        explorerPreviewContainer.classList.remove('hidden');
        if (explorerRcsToggleLabel) explorerRcsToggleLabel.style.display = '';
        if (explorerSaveScrBtn) explorerSaveScrBtn.style.display = '';
        // Auto-detect RCS by image coherence; the checkbox stays a manual override.
        if (explorerRcsToggle) explorerRcsToggle.checked = looksRcsEncoded(hit.data);
        explorerRenderPackedScreen();
    }

    function explorerTryPackedScreenPreview(bytes, fileName, loadAddr) {
        const hit = findPackedScreenInBlock(bytes, loadAddr || 0);
        if (!hit) return false;
        explorerShowPackedScreen(hit, fileName);
        return true;
    }

    // Deferred (post-paint) pass: detect packed screens in every catalog entry and mark
    // them with a 📦 icon + cache the hit so clicking the row previews it. Lets the user
    // see and switch between multiple packed screens (e.g. two on one tape). Runs off the
    // catalog's paint path, so it never delays the catalog appearing.
    function explorerMarkPackedScreens() {
        explorerPackedCache.clear();
        if (!explorerParsed || !explorerInfoOutput) return;
        const type = explorerParsed.type;
        const ICON = '📦';   // 📦

        if (type === 'tap' || type === 'tzx') {
            // Uncompressed screens/fonts already get their 🖼️/🔤 from the renderer, in the
            // `.explorer-tap-preview` span after "Data length". For packed screens we drop 📦
            // into that SAME span (on the header block, which carries the data-length detail),
            // so packed and uncompressed icons sit in one consistent place.
            explorerInfoOutput.querySelectorAll('.explorer-block[data-block-index]').forEach(row => {
                const idx = parseInt(row.dataset.blockIndex);
                const block = explorerBlocks[idx];
                if (!block || !block.data || block.data.length < 3) return;
                const content = block.data.slice(1, block.data.length - 1);
                if (content.length <= 256 || content.length > 65536) return;
                const prev = idx > 0 ? explorerBlocks[idx - 1] : null;
                const hit = findPackedScreenInBlock(content, prev ? (prev.startAddress || 0) : 0);
                if (!hit) return;
                const named = prev && (prev.name || prev.fileName);
                const fName = named || `#${idx + 1}`;
                explorerPackedCache.set(idx, { hit, label: fName });
                // The preview span lives on the header block (it has the "Data length" line).
                let iconRow = row;
                if (named) {
                    explorerPackedCache.set(idx - 1, { hit, label: fName });
                    const headerRow = explorerInfoOutput.querySelector(`.explorer-block[data-block-index="${idx - 1}"]`);
                    if (headerRow) iconRow = headerRow;
                }
                const span = iconRow.querySelector('.explorer-tap-preview');
                if (span && !span.textContent.trim()) {
                    span.textContent = ' 📦';
                    span.title = 'Packed screen — click to preview';
                }
            });
        } else if (explorerParsed.files) {
            explorerInfoOutput.querySelectorAll('.explorer-file-entry[data-index]').forEach(row => {
                const idx = parseInt(row.dataset.index);
                const file = explorerParsed.files[idx];
                if (!file) return;
                const len = explorerDiskFileContentLen(type, file);
                if (!(len > 256 && len <= 65536)) return;
                const span = row.querySelector('.explorer-file-preview');
                if (span && span.textContent.trim()) return;   // already an uncompressed-preview icon
                const content = explorerExtractDiskFileContent(type, file);
                if (!content) return;
                const loadAddr = file.startAddress ?? file.startAddr ?? file.start ?? file.loadAddress ?? 0;
                const hit = findPackedScreenInBlock(content, loadAddr);
                if (!hit) return;
                const baseName = file.name ? String(file.name).replace(/\s+$/, '') : `#${idx + 1}`;
                const fLabel = (file.ext && !baseName.toLowerCase().endsWith('.' + String(file.ext).toLowerCase()))
                    ? `${baseName}.${file.ext}` : baseName;
                explorerPackedCache.set(idx, { hit, label: fLabel });
                if (span) { span.textContent = ICON; span.title = 'Packed screen — click to preview'; }
            });
        }
    }

    // Logical content length of a disk catalog entry (mirrors each format's exact-size
    // preview check), used to size-gate the packed-screen pass before extracting.
    function explorerDiskFileContentLen(type, file) {
        if (type === 'mdr') return file.isPrint ? file.length : file.dataLength;
        if (type === 'dsk') return file.size;
        return file.length;
    }

    // Extract a disk catalog entry's logical content bytes (headers stripped, trimmed to
    // length) per format — same extraction the exact-size preview branches use.
    function explorerExtractDiskFileContent(type, file) {
        try {
            if (type === 'mgt') return MGTLoader.extractFile(explorerData, file);
            if (type === 'mdr') {
                const fd = MDRLoader.extractFile(explorerData, file);
                return (!file.isPrint && fd && fd.length > 9) ? fd.slice(9) : fd;
            }
            if (type === 'trd' || type === 'scl') return explorerData.slice(file.offset, file.offset + file.length);
            if (type === 'opd' || type === 'didaktik') {
                const raw = type === 'opd' ? OPDLoader.extractFile(explorerData, file) : DidaktikLoader.extractFile(explorerData, file);
                if (!raw) return null;
                return file.length < raw.length ? raw.slice(0, file.length) : raw;
            }
            if (type === 'dsk') {
                const fd = DSKLoader.readFileData(explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size);
                if (!fd) return null;
                return file.headerSize ? fd.slice(file.headerSize) : fd;
            }
        } catch (e) { return null; }
        return null;
    }

    function explorerUpdatePreviewForFile() {
        // Reset packed-screen state (a non-packed preview hides the RCS toggle + Save .scr)
        explorerPackedScreen = null;
        if (explorerRcsToggleLabel) explorerRcsToggleLabel.style.display = 'none';
        if (explorerSaveScrBtn) explorerSaveScrBtn.style.display = 'none';

        // For graphics files, preview directly
        if (explorerParsed && explorerParsed.type === 'graphics') {
            // For BSC, extract the SCR portion (first SCREEN_SIZE bytes)
            if (explorerParsed.graphicsType === 'bsc') {
                explorerUpdatePreview(explorerData.slice(0, SCREEN_SIZE));
            } else {
                explorerUpdatePreview(explorerData);
            }
            return;
        }

        // For raw files loaded directly, check the file size
        if (explorerData && !explorerParsed) {
            if (!explorerTryPackedScreenPreview(explorerData, null)) explorerUpdatePreview(explorerData);
            return;
        }

        // For TAP files, check each data block for screen data
        if (explorerParsed && explorerParsed.type === 'tap') {
            for (let bi = 0; bi < explorerBlocks.length; bi++) {
                const block = explorerBlocks[bi];
                if (block.blockType === 'data') {
                    // Data block - check if it's a screen (minus flag and checksum bytes)
                    const contentLen = block.data.length - 2; // subtract flag byte and checksum
                    if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                        contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE) {
                        // Extract content (skip flag byte, exclude checksum)
                        const content = block.data.slice(1, block.data.length - 1);
                        const prevBlock = bi > 0 ? explorerBlocks[bi - 1] : null;
                        const fName = prevBlock && prevBlock.name ? prevBlock.name : null;
                        explorerUpdatePreview(content, null, fName);
                        return;
                    }
                }
            }
            // No uncompressed screen found — try packed screens (standalone or embedded)
            for (let bi = 0; bi < explorerBlocks.length; bi++) {
                const block = explorerBlocks[bi];
                if (block.blockType !== 'data' || !block.data || block.data.length < 3) continue;
                const content = block.data.slice(1, block.data.length - 1);
                const prevBlock = bi > 0 ? explorerBlocks[bi - 1] : null;
                const fName = prevBlock && prevBlock.name ? prevBlock.name : null;
                if (explorerTryPackedScreenPreview(content, fName, prevBlock ? (prevBlock.startAddress || 0) : 0)) return;
            }
        }

        // For TZX files, check data blocks for screen data
        if (explorerParsed && explorerParsed.type === 'tzx') {
            for (let bi = 0; bi < explorerBlocks.length; bi++) {
                const block = explorerBlocks[bi];
                // Check standard/turbo speed data blocks (0x10/0x11)
                if ((block.id === 0x10 || block.id === 0x11) && block.data && block.data.length > 0) {
                    const blockData = block.data;
                    // Check for data block with screen-sized content
                    if (blockData.length > 0 && blockData[0] === 0xFF) {
                        const contentLen = blockData.length - 2; // subtract flag and checksum
                        if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                            contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE) {
                            const content = blockData.slice(1, blockData.length - 1);
                            const prevBlock = bi > 0 ? explorerBlocks[bi - 1] : null;
                            const fName = prevBlock && prevBlock.fileName ? prevBlock.fileName : null;
                            explorerUpdatePreview(content, null, fName);
                            return;
                        }
                    }
                }
            }
            // No uncompressed screen found — try packed screens (standalone or embedded)
            for (let bi = 0; bi < explorerBlocks.length; bi++) {
                const block = explorerBlocks[bi];
                if (!((block.id === 0x10 || block.id === 0x11) && block.data && block.data.length > 3)) continue;
                if (block.data[0] !== 0xFF) continue;
                const content = block.data.slice(1, block.data.length - 1);
                const prevBlock = bi > 0 ? explorerBlocks[bi - 1] : null;
                const fName = prevBlock && prevBlock.fileName ? prevBlock.fileName : null;
                if (explorerTryPackedScreenPreview(content, fName, prevBlock ? (prevBlock.startAddress || 0) : 0)) return;
            }
        }

        // For Hobeta files, check if the contained data is screen-sized
        if (explorerParsed && explorerParsed.type === 'hobeta' && explorerParsed.file) {
            const contentLen = explorerParsed.file.length;
            if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE) {
                explorerUpdatePreview(explorerParsed.file.data, null, explorerParsed.file.name || null);
                return;
            }
            // Not an uncompressed screen — try a packed screen
            if (explorerTryPackedScreenPreview(explorerParsed.file.data, explorerParsed.file.name || null, explorerParsed.file.startAddress || 0)) return;
        }

        // For SNA/Z80/SZX, extract screen from bank cache (supports modified banks)
        if (explorerParsed && (explorerParsed.type === 'sna' || explorerParsed.type === 'z80' || explorerParsed.type === 'szx')) {
            try {
                const formatLabel = explorerParsed.type === 'sna' ? (explorerParsed.is128 ? '128K' : '48K')
                    : explorerParsed.type === 'z80' ? `Z80 v${explorerParsed.version}`
                    : `SZX v${explorerParsed.version}`;

                if (explorerParsed.is128) {
                    const port7FFD = explorerParsed.registers.port7FFD || 0;
                    const activeScreen = (port7FFD & 0x08) ? 7 : 5;
                    const bank5 = explorerExtractBank(5);
                    const bank7 = explorerExtractBank(7);
                    const screen5 = bank5 && bank5.length >= SCREEN_SIZE ? bank5.slice(0, SCREEN_SIZE) : null;
                    const screen7 = bank7 && bank7.length >= SCREEN_SIZE ? bank7.slice(0, SCREEN_SIZE) : null;
                    if (screen5 || screen7) {
                        explorerRenderDualScreen(screen5, screen7, activeScreen);
                        return;
                    }
                } else {
                    const bank5 = explorerExtractBank(5);
                    if (bank5 && bank5.length >= SCREEN_SIZE) {
                        const screen = bank5.slice(0, SCREEN_SIZE);
                        explorerPreviewContainer.classList.remove('hidden');
                        explorerPreviewLabel.textContent = `${formatLabel} Screen`;
                        explorerRenderSCR(screen);
                        explorerPreviewCanvas.style.width = (explorerPreviewCanvas.width * 2) + 'px';
                        explorerPreviewCanvas.style.height = (explorerPreviewCanvas.height * 2) + 'px';
                        syncPreviewHeight();
                        return;
                    }
                }
            } catch (e) {
                console.error('Screen extraction error:', e);
            }
        }

        // For RZX files, extract screen from embedded snapshot
        if (explorerParsed && explorerParsed.type === 'rzx' && explorerParsed.snapshot) {
            try {
                const ep = explorerParsed.embeddedParsed;

                if (explorerParsed.snapshotType === 'sna' && ep && ep.is128) {
                    // 128K SNA embedded in RZX: same extraction as standalone SNA
                    const snapData = explorerParsed.snapshot;
                    const port7FFD = ep.registers.port7FFD || 0;
                    const activeScreen = (port7FFD & 0x08) ? 7 : 5;
                    const pagedBank = port7FFD & 0x07;
                    const screen5 = snapData.length >= 27 + SCREEN_SIZE
                        ? snapData.slice(27, 27 + SCREEN_SIZE) : null;
                    let screen7 = null;
                    if (pagedBank === 7) {
                        const bank7Offset = 27 + 32768;
                        if (snapData.length >= bank7Offset + SCREEN_SIZE) {
                            screen7 = snapData.slice(bank7Offset, bank7Offset + SCREEN_SIZE);
                        }
                    } else {
                        const remainingBanks = [0, 1, 3, 4, 6, 7].filter(b => b !== pagedBank);
                        const bank7Index = remainingBanks.indexOf(7);
                        if (bank7Index >= 0) {
                            const bank7Offset = 49183 + bank7Index * 16384;
                            if (snapData.length >= bank7Offset + SCREEN_SIZE) {
                                screen7 = snapData.slice(bank7Offset, bank7Offset + SCREEN_SIZE);
                            }
                        }
                    }
                    if (screen5 || screen7) {
                        explorerRenderDualScreen(screen5, screen7, activeScreen);
                        return;
                    }
                } else if (explorerParsed.snapshotType === 'z80' && ep && ep.is128) {
                    // 128K Z80 embedded in RZX
                    const screen5 = explorerExtractZ80Screen(explorerParsed.snapshot, ep, 8);
                    const screen7 = explorerExtractZ80Screen(explorerParsed.snapshot, ep, 10);
                    const activeScreen = (ep.port7FFD & 0x08) ? 7 : 5;
                    if (screen5 || screen7) {
                        explorerRenderDualScreen(screen5, screen7, activeScreen);
                        return;
                    }
                }

                // Fallback: single screen (48K or extraction failure)
                let screen = null;
                if (explorerParsed.snapshotType === 'sna') {
                    if (explorerParsed.snapshot.length >= 27 + SCREEN_SIZE) {
                        screen = explorerParsed.snapshot.slice(27, 27 + SCREEN_SIZE);
                    }
                } else if (explorerParsed.snapshotType === 'z80' && ep) {
                    screen = explorerExtractZ80Screen(explorerParsed.snapshot, ep);
                }

                if (screen) {
                    explorerPreviewContainer.classList.remove('hidden');
                    explorerPreviewLabel.textContent = `RZX Embedded ${explorerParsed.snapshotType.toUpperCase()} Screen`;
                    explorerRenderSCR(screen);
                    explorerPreviewCanvas.style.width = (explorerPreviewCanvas.width * 2) + 'px';
                    explorerPreviewCanvas.style.height = (explorerPreviewCanvas.height * 2) + 'px';
                    syncPreviewHeight();
                    return;
                }
            } catch (e) {
                console.error('RZX screen extraction error:', e);
            }
        }

        // For MGT, look for previewable files
        if (explorerParsed && explorerParsed.type === 'mgt') {
            const previewSizes = PREVIEW_SIZES;
            for (let fi = 0; fi < explorerParsed.files.length; fi++) {
                const file = explorerParsed.files[fi];
                if (previewSizes.includes(file.length)) {
                    const fileData = MGTLoader.extractFile(explorerData, file);
                    explorerUpdatePreview(fileData, null, file.name || `#${fi + 1}`);
                    return;
                }
            }
        }

        // For MDR, look for previewable files (use dataLength which excludes 9-byte header)
        if (explorerParsed && explorerParsed.type === 'mdr') {
            const previewSizes = PREVIEW_SIZES;
            for (let fi = 0; fi < explorerParsed.files.length; fi++) {
                const file = explorerParsed.files[fi];
                const contentLen = file.isPrint ? file.length : file.dataLength;
                if (previewSizes.includes(contentLen)) {
                    const fileData = MDRLoader.extractFile(explorerData, file);
                    const content = (!file.isPrint && fileData.length > 9) ? fileData.slice(9) : fileData;
                    explorerUpdatePreview(content, null, file.name || `#${fi + 1}`);
                    return;
                }
            }
        }

        // For TRD/SCL, look for previewable files (screens, fonts)
        if (explorerParsed && (explorerParsed.type === 'trd' || explorerParsed.type === 'scl')) {
            const previewSizes = PREVIEW_SIZES;
            for (let fi = 0; fi < explorerParsed.files.length; fi++) {
                const file = explorerParsed.files[fi];
                if (previewSizes.includes(file.length)) {
                    const fileData = explorerData.slice(file.offset, file.offset + file.length);
                    const fLabel = file.name ? `${file.name}${file.ext ? '.' + file.ext : ''}` : `#${fi + 1}`;
                    explorerUpdatePreview(fileData, null, fLabel);
                    return;
                }
            }
        }

        // For OPD, look for previewable files (extractFile already strips 7-byte header)
        if (explorerParsed && (explorerParsed.type === 'opd' || explorerParsed.type === 'didaktik')) {
            const previewSizes = PREVIEW_SIZES;
            for (let fi = 0; fi < explorerParsed.files.length; fi++) {
                const file = explorerParsed.files[fi];
                if (previewSizes.includes(file.length)) {
                    const rawData = explorerParsed.type === 'opd'
                        ? OPDLoader.extractFile(explorerData, file)
                        : DidaktikLoader.extractFile(explorerData, file);
                    if (rawData) {
                        const fileData = file.length < rawData.length ? rawData.slice(0, file.length) : rawData;
                        explorerUpdatePreview(fileData, null, file.name || `#${fi + 1}`);
                        return;
                    }
                }
            }
        }

        // For DSK, look for previewable files (check data size after +3DOS header)
        if (explorerParsed && explorerParsed.type === 'dsk') {
            const previewSizes = PREVIEW_SIZES;
            for (let fi = 0; fi < explorerParsed.files.length; fi++) {
                const file = explorerParsed.files[fi];
                if (previewSizes.includes(file.size)) {
                    const fileData = DSKLoader.readFileData(
                        explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
                    );
                    if (fileData) {
                        // Skip file header (+3DOS 128 bytes / TOS 5-7 bytes) for preview
                        const content = file.headerSize ? fileData.slice(file.headerSize) : fileData;
                        const fLabel = file.name ? `${file.name}${file.ext ? '.' + file.ext : ''}` : `#${fi + 1}`;
                        explorerUpdatePreview(content, null, fLabel);
                        return;
                    }
                }
            }
        }

        // Packed-screen fallback: no uncompressed screen matched in any disk catalog —
        // try ZX0/ZX7-packed screens (standalone, or embedded with a depacker in the file).
        if (explorerParsed && explorerParsed.files &&
            ['mgt', 'mdr', 'trd', 'scl', 'opd', 'didaktik', 'dsk'].includes(explorerParsed.type)) {
            for (let fi = 0; fi < explorerParsed.files.length; fi++) {
                const file = explorerParsed.files[fi];
                const len = explorerDiskFileContentLen(explorerParsed.type, file);
                if (!(len > 256 && len <= 65536)) continue;
                const content = explorerExtractDiskFileContent(explorerParsed.type, file);
                if (!content) continue;
                const baseName = file.name ? String(file.name).replace(/\s+$/, '') : `#${fi + 1}`;
                // Some catalogs (e.g. Didaktik MDOS) already carry the extension in the name
                const fLabel = (file.ext && !baseName.toLowerCase().endsWith('.' + String(file.ext).toLowerCase()))
                    ? `${baseName}.${file.ext}` : baseName;
                const loadAddr = file.startAddress ?? file.startAddr ?? file.start ?? file.loadAddress ?? 0;
                if (explorerTryPackedScreenPreview(content, fLabel, loadAddr)) return;
            }
        }

        // No previewable content
        explorerUpdatePreview(null);
    }

    // Z80 decompression (RLE: ED ED count value -> repeat value count times)
    function explorerDecompressZ80(data, start, end) {
        const output = [];
        let i = start;

        while (i < end) {
            if (data[i] === 0xED && i + 1 < end && data[i + 1] === 0xED) {
                // Compressed sequence: ED ED count value
                if (i + 3 < end) {
                    const count = data[i + 2];
                    const value = data[i + 3];
                    for (let j = 0; j < count; j++) {
                        output.push(value);
                    }
                    i += 4;
                } else {
                    break;
                }
            } else {
                output.push(data[i]);
                i++;
            }
        }

        return new Uint8Array(output);
    }

    // Extract screen from Z80 file (supports v1, v2, v3, compressed and uncompressed)
    // Extract screen data from Z80 snapshot.
    // targetPage: Z80 page number (8 = bank 5 / primary screen, 10 = bank 7 / shadow screen)
    function explorerExtractZ80Screen(data, parsed, targetPage) {
        if (targetPage === undefined) targetPage = 8;
        try {
            if (parsed.version === 1) {
                // V1 is always 48K — only bank 5 (page 8) exists
                if (targetPage !== 8) return null;
                // V1: 30-byte header, then memory (possibly compressed)
                if (parsed.compressed) {
                    // Find end marker (00 ED ED 00) and decompress
                    let endMarker = data.length;
                    for (let i = 30; i < data.length - 3; i++) {
                        if (data[i] === 0x00 && data[i + 1] === 0xED &&
                            data[i + 2] === 0xED && data[i + 3] === 0x00) {
                            endMarker = i;
                            break;
                        }
                    }
                    const memory = explorerDecompressZ80(data, 30, endMarker);
                    if (memory.length >= SCREEN_SIZE) {
                        return memory.slice(0, SCREEN_SIZE);
                    }
                } else {
                    // Uncompressed v1
                    if (data.length >= 30 + SCREEN_SIZE) {
                        return data.slice(30, 30 + SCREEN_SIZE);
                    }
                }
            } else {
                // V2/V3: extended header + compressed pages
                const extLen = data[30] | (data[31] << 8);
                const headerEnd = 32 + extLen;

                // Parse pages
                let offset = headerEnd;
                while (offset < data.length - 3) {
                    const pageLen = data[offset] | (data[offset + 1] << 8);
                    const pageNum = data[offset + 2];
                    offset += 3;

                    if (pageNum === targetPage) {
                        let pageData;
                        if (pageLen === 0xFFFF) {
                            // Uncompressed page
                            pageData = data.slice(offset, offset + 16384);
                        } else {
                            // Compressed page
                            pageData = explorerDecompressZ80(data, offset, offset + pageLen);
                        }

                        if (pageData.length >= SCREEN_SIZE) {
                            return pageData.slice(0, SCREEN_SIZE);
                        }
                    }

                    // Move to next page
                    if (pageLen === 0xFFFF) {
                        offset += 16384;
                    } else {
                        offset += pageLen;
                    }
                }
            }
        } catch (e) {
            console.error('Z80 screen extraction error:', e);
        }
        return null;
    }

    // ========== Bank extraction for SNA/Z80/SZX snapshots ==========
    // Implementation lives in explorer-banks.js. State is passed as getters
    // because explorerParsed/explorerData are reassigned on every file load.
    const {
        detectBootloader,
        detectDiskProtection,
        explorerExtractBank,
        explorerFileSizeAttr,
        explorerFileSizeText,
        explorerGetBankList,
        explorerGetBankLogicalAddr,
        explorerReadSnapshotBlock,
        explorerReadSnapshotWord,
        explorerRenderDidaktikInfo,
        explorerRenderHobetaInfo,
        explorerRenderMDRInfo,
        explorerRenderMGTInfo,
        explorerRenderOPDInfo,
        explorerRenderRZXInfo,
        explorerRenderSCLInfo,
        explorerRenderSNAInfo,
        explorerRenderSZXInfo,
        explorerRenderTAPInfo,
        explorerRenderTRDInfo,
        explorerRenderTZXInfo,
        explorerRenderZ80Info,
        trdGetBasicAutostart,
        getRzxDecodeMode, setRzxDecodeMode,
    } = initExplorerBanks({
        get TRD_TYPE_NAMES() { return TRD_TYPE_NAMES; },
        get explorerBankCache() { return explorerBankCache; },
        get explorerBlocks() { return explorerBlocks; },
        get explorerData() { return explorerData; },
        get explorerDecompressZ80() { return explorerDecompressZ80; },
        get explorerFileName() { return explorerFileName; },
        get explorerParsed() { return explorerParsed; },
        get explorerRenderRegsTable() { return explorerRenderRegsTable; },
        get SZXLoader() { return SZXLoader; },
    });

    // ========== Disk Map and the hex/text/disasm/ZIP/DSK views ==========
    // Implementation lives in explorer-views.js; state is passed as accessors.
    const {
        diskmapApplyHighlight,
        diskmapFormatInfo,
        diskmapGetSectorInfo,
        diskmapNavigateToSector,
        explorerRenderDSKInfo,
        explorerRenderDisasm,
        explorerRenderDiskMap,
        explorerRenderZIPInfo,
        explorerUpdateSourceSelectors,
    } = initExplorerViews({
        get CODEPAGE_TABLES() { return CODEPAGE_TABLES; },
        get DSKLoader() { return DSKLoader; },
        get Disassembler() { return Disassembler; },
        get btnExplorerDisasm() { return btnExplorerDisasm; },
        get btnExplorerExportBank() { return btnExplorerExportBank; },
        get btnExplorerHex() { return btnExplorerHex; },
        get btnExplorerImportBank() { return btnExplorerImportBank; },
        get btnExplorerSaveModified() { return btnExplorerSaveModified; },
        get btnExplorerText() { return btnExplorerText; },
        get detectBootloader() { return detectBootloader; },
        get detectDiskProtection() { return detectDiskProtection; },
        get diskmapCanvas() { return diskmapCanvas; },
        get diskmapCurrentView() { return diskmapCurrentView; },
        get diskmapDiskContainer() { return diskmapDiskContainer; },
        get diskmapGridContainer() { return diskmapGridContainer; },
        get diskmapInfo() { return diskmapInfo; },
        get diskmapLegend() { return diskmapLegend; },
        get diskmapStatus() { return diskmapStatus; },
        get explorerBankAddrMode() { return explorerBankAddrMode; },
        get explorerBankCache() { return explorerBankCache; },
        get explorerBankDirty() { return explorerBankDirty; },
        get explorerBankImportInput() { return explorerBankImportInput; },
        get explorerBankStatus() { return explorerBankStatus; },
        get explorerBankTools() { return explorerBankTools; },
        get explorerBasicOutput() { return explorerBasicOutput; },
        get explorerBasicSource() { return explorerBasicSource; },
        get explorerBasicView() { return explorerBasicView; },
        get explorerBlocks() { return explorerBlocks; },
        get explorerDisasmAddr() { return explorerDisasmAddr; },
        get explorerDisasmLen() { return explorerDisasmLen; },
        get explorerDisasmOutput() { return explorerDisasmOutput; },
        get explorerDisasmSource() { return explorerDisasmSource; },
        get explorerExtractBank() { return explorerExtractBank; },
        get explorerFileName() { return explorerFileName; },
        get explorerFileSize() { return explorerFileSize; },
        get explorerGetBankList() { return explorerGetBankList; },
        get explorerGetBankLogicalAddr() { return explorerGetBankLogicalAddr; },
        get explorerFindText() { return explorerFindText; },
        get explorerFindMode() { return explorerFindMode; },
        get chkExplorerFind5ch() { return chkExplorerFind5ch; },
        get btnExplorerFind() { return btnExplorerFind; },
        get explorerFindStatus() { return explorerFindStatus; },
        get explorerFindResults() { return explorerFindResults; },
        get explorerHexAddr() { return explorerHexAddr; },
        get explorerHexLen() { return explorerHexLen; },
        get explorerHexOutput() { return explorerHexOutput; },
        get explorerHexSource() { return explorerHexSource; },
        get explorerInfoOutput() { return explorerInfoOutput; },
        get explorerPackedCache() { return explorerPackedCache; },
        get explorerParseFile() { return explorerParseFile; },
        get explorerParsed() { return explorerParsed; },
        get explorerReadSnapshotBlock() { return explorerReadSnapshotBlock; },
        get explorerReadSnapshotWord() { return explorerReadSnapshotWord; },
        get explorerRenderFileInfo() { return explorerRenderFileInfo; },
        get explorerRenderRZXInfo() { return explorerRenderRZXInfo; },
        get explorerShowPackedScreen() { return explorerShowPackedScreen; },
        get explorerTextCodepage() { return explorerTextCodepage; },
        get explorerTextOutput() { return explorerTextOutput; },
        get explorerTextSource() { return explorerTextSource; },
        get explorerUpdatePreview() { return explorerUpdatePreview; },
        get explorerUpdatePreviewForFile() { return explorerUpdatePreviewForFile; },
        get explorerZipFiles() { return explorerZipFiles; },
        get getRomLabels() { return getRomLabels; },
        get pako() { return pako; },
        get diskmapHighlightFile() { return diskmapHighlightFile; },
        set diskmapHighlightFile(v) { diskmapHighlightFile = v; },
        get diskmapSectorMap() { return diskmapSectorMap; },
        set diskmapSectorMap(v) { diskmapSectorMap = v; },
        get explorerBankAddressMode() { return explorerBankAddressMode; },
        set explorerBankAddressMode(v) { explorerBankAddressMode = v; },
        get explorerBasicLines() { return explorerBasicLines; },
        set explorerBasicLines(v) { explorerBasicLines = v; },
        get explorerBasicRawData() { return explorerBasicRawData; },
        set explorerBasicRawData(v) { explorerBasicRawData = v; },
        get explorerBasicViewMode() { return explorerBasicViewMode; },
        set explorerBasicViewMode(v) { explorerBasicViewMode = v; },
        get explorerData() { return explorerData; },
        set explorerData(v) { explorerData = v; },
        get explorerFileType() { return explorerFileType; },
        set explorerFileType(v) { explorerFileType = v; },
        get explorerZipParentName() { return explorerZipParentName; },
        set explorerZipParentName(v) { explorerZipParentName = v; },
    });

    // ========== Dual-Panel File Editor ==========

    // --- Shared toolbar DOM refs ---
    const editorNewFormat = document.getElementById('editorNewFormat');
    const btnEditorAddFile = document.getElementById('btnEditorAddFile');
    const btnEditorSave = document.getElementById('btnEditorSave');

    const btnEditorMoveUp = document.getElementById('btnEditorMoveUp');
    const btnEditorMoveDown = document.getElementById('btnEditorMoveDown');
    const btnEditorDel = document.getElementById('btnEditorDel');
    const btnEditorMarkDel = document.getElementById('btnEditorMarkDel');
    const btnEditorExtract = document.getElementById('btnEditorExtract');
    const editorExtractDisk = document.getElementById('editorExtractDisk');
    const btnEditorCopy = document.getElementById('btnEditorCopy');
    const btnEditorToTurbo = document.getElementById('btnEditorToTurbo');
    const btnEditorSplit = document.getElementById('btnEditorSplit');
    const btnEditorBanner = document.getElementById('btnEditorBanner');
    const editorKeepSlack = document.getElementById('editorKeepSlack');
    const editorKeepSlackLabel = document.getElementById('editorKeepSlackLabel');
    const editorExtractFullOpt = editorExtractDisk
        ? editorExtractDisk.querySelector('option[value="binfull"]') : null;
    // Formats whose editor model carries full sectors, so slack can be sourced /
    // dumped from them. TR-DOS and SCL today; other writers are extended as their
    // build paths learn to carry slack.
    const SLACK_FORMATS = ['trd', 'scl'];
    const editorLinkLabel = document.getElementById('editorLinkLabel');
    const editorPanelFileInput = document.getElementById('editorPanelFileInput');

    // Add File dialog elements (shared across panels via dialogTargetPanel)
    const tapAddDialog = document.getElementById('tapAddDialog');
    const tapAddType = document.getElementById('tapAddType');
    const tapAddName = document.getElementById('tapAddName');
    const tapAddAddr = document.getElementById('tapAddAddr');
    const tapAddAuto = document.getElementById('tapAddAuto');
    const tapAddVar = document.getElementById('tapAddVar');
    const tapAddNameRow = document.getElementById('tapAddNameRow');
    const tapAddAddrRow = document.getElementById('tapAddAddrRow');
    const tapAddAutoRow = document.getElementById('tapAddAutoRow');
    const tapAddVarRow = document.getElementById('tapAddVarRow');
    const tapAddFlag = document.getElementById('tapAddFlag');
    const tapAddFlagRow = document.getElementById('tapAddFlagRow');
    const tapAddPause = document.getElementById('tapAddPause');
    const tapAddPauseRow = document.getElementById('tapAddPauseRow');
    const tapAddFileInfo = document.getElementById('tapAddFileInfo');
    const btnTapAddOk = document.getElementById('btnTapAddOk');
    const btnTapAddCancel = document.getElementById('btnTapAddCancel');
    const tzxTurboDialog = document.getElementById('tzxTurboDialog');
    const tzxTurboInfo = document.getElementById('tzxTurboInfo');
    const btnTzxTurboOk = document.getElementById('btnTzxTurboOk');
    const btnTzxTurboCancel = document.getElementById('btnTzxTurboCancel');
    const editorPairLock = document.getElementById('editorPairLock');
    // Toggling "Link header" switches tape panels between the combined and raw views — redraw both.
    if (editorPairLock) editorPairLock.addEventListener('change', () => {
        if (editorPanels.left.fileType) editorRenderBlockList(editorPanels.left);
        if (editorPanels.right.fileType) editorRenderBlockList(editorPanels.right);
    });

    // Disk Add File dialog elements
    const diskAddDialog = document.getElementById('diskAddDialog');
    const diskAddName = document.getElementById('diskAddName');
    const diskAddExt = document.getElementById('diskAddExt');
    const diskAddAddr = document.getElementById('diskAddAddr');
    const diskAddFileInfo = document.getElementById('diskAddFileInfo');
    const btnDiskAddOk = document.getElementById('btnDiskAddOk');
    const btnDiskAddCancel = document.getElementById('btnDiskAddCancel');

    // DSK Add File dialog elements
    const dskAddDialog = document.getElementById('dskAddDialog');
    const dskAddName = document.getElementById('dskAddName');
    const dskAddExt = document.getElementById('dskAddExt');
    const dskAddType = document.getElementById('dskAddType');
    const dskAddAddr = document.getElementById('dskAddAddr');
    const dskAddAuto = document.getElementById('dskAddAuto');
    const dskAddAddrRow = document.getElementById('dskAddAddrRow');
    const dskAddAutoRow = document.getElementById('dskAddAutoRow');
    const dskAddFileInfo = document.getElementById('dskAddFileInfo');
    const btnDskAddOk = document.getElementById('btnDskAddOk');
    const btnDskAddCancel = document.getElementById('btnDskAddCancel');

    // --- Panel state ---
    function createPanelState() {
        return {
            parsedFile: null,       // panel-local parsed structure
            rawData: null,          // panel-local raw data
            blocks: [],             // panel-local blocks (TAP) or files list ref (DSK)
            fileType: null,         // 'tap', 'trd', 'scl', 'dsk', null
            fileName: '',
            selection: new Set(),
            expandedBlock: -1,
            lastClickIdx: -1,
            lastClickTime: 0,
            // TRD-specific
            diskFiles: [],
            diskLabel: '        ',
            // Pending file data for add dialogs
            pendingFileData: null,
            // DOM refs (set during init)
            dom: { container: null, header: null, fileList: null, labelBar: null,
                   formatSpan: null, nameSpan: null, statusSpan: null }
        };
    }

    let editorPanels = { left: createPanelState(), right: createPanelState() };
    let activePanel = 'left';
    let dialogTargetPanel = 'left';

    // Init DOM refs for panels
    function initPanelDom(panel, side) {
        const el = document.getElementById(side === 'left' ? 'editorPanelLeft' : 'editorPanelRight');
        panel.dom.container = el;
        panel.dom.header = el.querySelector('.editor-panel-header');
        panel.dom.fileList = el.querySelector('.editor-panel-filelist');
        panel.dom.labelBar = el.querySelector('.editor-panel-labelbar');
        panel.dom.formatSpan = el.querySelector('.editor-panel-format');
        panel.dom.nameSpan = el.querySelector('.editor-panel-name');
        panel.dom.statusSpan = el.querySelector('.editor-panel-status');
        // Volume-label strip interactions (click chip to edit, Apply/Enter to save, Esc to cancel)
        if (panel.dom.labelBar) {
            panel.dom.labelBar.addEventListener('click', (e) => {
                if (e.target.closest('[data-action="label-apply"]')) { editorApplyLabel(panel); return; }
                if (e.target.closest('[data-label-edit]')) {
                    panel.expandedBlock = (panel.expandedBlock === -2) ? -1 : -2;
                    editorRenderLabelBar(panel);
                }
            });
            panel.dom.labelBar.addEventListener('keydown', (e) => {
                if (!e.target.matches || !e.target.matches('[data-field="label"]')) return;
                if (e.key === 'Enter') { e.preventDefault(); editorApplyLabel(panel); }
                else if (e.key === 'Escape') { panel.expandedBlock = -1; editorRenderLabelBar(panel); }
            });
        }
    }
    initPanelDom(editorPanels.left, 'left');
    initPanelDom(editorPanels.right, 'right');

    function getActivePanel() { return editorPanels[activePanel]; }

    // --- Pair logic (parameterized on panel) ---

    // A header and the data block right after it form a matched pair only when the data
    // payload length matches the header's declared data length. Mismatched (or missing)
    // data is treated as unmatched, so it shows separately and selection won't link them.
    function editorPairLenMatch(panel, headerIdx) {
        const h = panel.blocks[headerIdx], d = panel.blocks[headerIdx + 1];
        return !!d && d.blockType === 'data' && d.data && (d.data.length - 2) === h.dataLength;
    }

    function editorIsPairHeader(panel, idx) {
        return idx < panel.blocks.length &&
            panel.blocks[idx].blockType === 'header' &&
            idx + 1 < panel.blocks.length &&
            panel.blocks[idx + 1].blockType === 'data' &&
            editorPairLenMatch(panel, idx);
    }

    function editorPairHeaderOf(panel, idx) {
        if (idx > 0 &&
            panel.blocks[idx].blockType === 'data' &&
            panel.blocks[idx - 1].blockType === 'header' &&
            editorPairLenMatch(panel, idx - 1)) {
            return idx - 1;
        }
        return -1;
    }

    function editorExpandPairs(panel, indices) {
        const result = new Set(indices);
        if (!editorPairLock.checked) return result;
        for (const idx of indices) {
            if (editorIsPairHeader(panel, idx)) {
                result.add(idx + 1);
            }
            const hdr = editorPairHeaderOf(panel, idx);
            if (hdr >= 0) {
                result.add(hdr);
            }
        }
        return result;
    }

    function editorSelectedSorted(panel) {
        return [...panel.selection].sort((a, b) => a - b);
    }

    function editorRecalcChecksum(blockData) {
        let checksum = 0;
        for (let i = 0; i < blockData.length - 1; i++) {
            checksum ^= blockData[i];
        }
        blockData[blockData.length - 1] = checksum;
    }

    // --- TZX block type names ---

    const TZX_BLOCK_NAMES = {
        0x10: 'Standard Speed Data', 0x11: 'Turbo Speed Data', 0x12: 'Pure Tone',
        0x13: 'Pulse Sequence', 0x14: 'Pure Data', 0x15: 'Direct Recording',
        0x18: 'CSW Recording', 0x19: 'Generalized Data', 0x20: 'Pause/Stop',
        0x21: 'Group Start', 0x22: 'Group End', 0x23: 'Jump to Block',
        0x24: 'Loop Start', 0x25: 'Loop End', 0x26: 'Call Sequence',
        0x27: 'Return from Sequence', 0x28: 'Select Block', 0x2A: 'Stop if 48K',
        0x2B: 'Set Signal Level', 0x30: 'Text Description', 0x31: 'Message',
        0x32: 'Archive Info', 0x33: 'Hardware Type', 0x35: 'Custom Info',
        0x5A: 'Glue Block'
    };

    function isTapOrTzx(t) { return t === 'tap' || t === 'tzx'; }

    // --- Hobeta format helpers ---

    const HOBETA_EXTS = ['$b', '$c', '$d', '$#', 'hobeta'];

    function isHobetaExt(ext) {
        return HOBETA_EXTS.includes(ext.toLowerCase());
    }

    /** Map TR-DOS extension char to Hobeta file extension */
    function trdExtToHobetaExt(ext) {
        const map = { 'B': '$b', 'C': '$c', 'D': '$d', '#': '$#' };
        return map[ext] || '$c';
    }

    /** Compute Hobeta CRC over first 15 bytes of header */
    function hobetaCRC(header) {
        let sum = 0;
        for (let i = 0; i < 15; i++) sum += header[i];
        return (257 * sum + 105) & 0xFFFF;
    }

    /** Build a Hobeta file from TR-DOS file entry.
     *  file: { name, ext, startAddress, length, data }
     *  Returns Uint8Array with 17-byte header + data. */
    function buildHobeta(file) {
        const dataLen = file.length;
        const sectorLen = Math.ceil(dataLen / 256) * 256;
        const hdr = new Uint8Array(17);
        // Bytes 0-7: filename padded with spaces
        const name = (file.name + '        ').substring(0, 8);
        for (let i = 0; i < 8; i++) hdr[i] = name.charCodeAt(i);
        // Byte 8: extension character
        hdr[8] = file.ext.charCodeAt(0);
        // Bytes 9-10 / 11-12 depend on type. BASIC (B): 9-10 = total length
        // (program + variables), 11-12 = program length (offset where variables
        // begin, defaults to total = no variables). CODE/others: 9-10 = start
        // address, 11-12 = data length. (TR-DOS catalogue convention.)
        const isBasic = (file.ext || '').toUpperCase() === 'B';
        const w9 = isBasic ? dataLen : (file.startAddress || 0);
        const w11 = isBasic ? (file.programLength != null ? file.programLength : dataLen) : dataLen;
        hdr[9] = w9 & 0xFF;
        hdr[10] = (w9 >> 8) & 0xFF;
        hdr[11] = w11 & 0xFF;
        hdr[12] = (w11 >> 8) & 0xFF;
        // Bytes 13-14: full sector length (LE)
        hdr[13] = sectorLen & 0xFF;
        hdr[14] = (sectorLen >> 8) & 0xFF;
        // Bytes 15-16: CRC (LE)
        const crc = hobetaCRC(hdr);
        hdr[15] = crc & 0xFF;
        hdr[16] = (crc >> 8) & 0xFF;

        const result = new Uint8Array(17 + dataLen);
        result.set(hdr, 0);
        result.set(file.data.slice(0, dataLen), 17);
        return result;
    }

    /** Parse a Hobeta file. Returns { name, ext, startAddress, length, data } or null on CRC fail. */
    function parseHobeta(data) {
        if (data.length < 17) return null;
        const hdr = data.slice(0, 17);
        const crc = hdr[15] | (hdr[16] << 8);
        if (crc !== hobetaCRC(hdr)) return null;
        let name = '';
        for (let i = 0; i < 8; i++) name += String.fromCharCode(hdr[i]);
        const ext = String.fromCharCode(hdr[8]);
        const w9 = hdr[9] | (hdr[10] << 8);
        const w11 = hdr[11] | (hdr[12] << 8);
        // BASIC (B): 9-10 = total length, 11-12 = program length. CODE/others:
        // 9-10 = start address, 11-12 = data length. (see buildHobeta)
        const isBasic = ext.toUpperCase() === 'B';
        const startAddress = isBasic ? 0 : w9;
        const length = isBasic ? w9 : w11;
        const programLength = isBasic ? w11 : null;
        const fileData = data.slice(17, 17 + length);
        return { name, ext, startAddress, length, programLength, data: fileData };
    }

    /** Map TAP/+3DOS header type to TR-DOS extension character */
    function headerTypeToTrdExt(type) {
        // 0=BASIC→B, 1=Number array→D, 2=Char array→D, 3=Bytes/Code→C
        return type === 0 ? 'B' : type === 3 ? 'C' : 'D';
    }

    /** Build Hobeta from generic file info (name, headerType, startAddress, data).
     *  Works for files extracted from TAP, TZX, DSK, or any source. */
    function buildHobetaGeneric(fileName, headerType, startAddress, data) {
        const padded = (fileName + '        ').substring(0, 8);
        return buildHobeta({
            name: padded,
            ext: headerTypeToTrdExt(headerType),
            startAddress: startAddress || 0,
            length: data.length,
            data: data
        });
    }

    // --- Snapshot editor (SNA/Z80/SZX) ---

    function isSnapshotType(t) {
        return t === 'sna' || t === 'z80' || t === 'szx';
    }

    function snapshotEditorBuildEntries(panel) {
        const parsed = panel.parsedFile;
        const data = panel.rawData;
        const entries = [];

        // Temporarily set globals for snapshot reading helpers
        const savedParsed = explorerParsed;
        const savedData = explorerData;
        const savedCache = explorerBankCache;
        explorerParsed = parsed;
        explorerData = data;
        explorerBankCache = new Map();

        try {
            // 1. BASIC program (if present)
            const prog = explorerReadSnapshotWord(0x5C53);
            const vars = explorerReadSnapshotWord(0x5C4B);
            if (prog >= 0x4000 && prog < 0xFFFF && vars > prog) {
                const basicLen = Math.min(vars - prog, 0xC000);
                if (basicLen > 0) {
                    entries.push({
                        name: 'BASIC',
                        ext: 'B',
                        tapType: 0,
                        addr: prog,
                        length: basicLen,
                        autostart: null,
                        kind: 'basic',
                        bankNum: null,
                        data: explorerReadSnapshotBlock(prog, basicLen)
                    });
                }
            }

            // 2. Main screen (bank 5, first 6912 bytes)
            const bank5 = explorerExtractBank(5);
            if (bank5) {
                entries.push({
                    name: 'Screen',
                    ext: 'C',
                    tapType: 3,
                    addr: 0x4000,
                    length: 6912,
                    autostart: null,
                    kind: 'screen',
                    bankNum: 5,
                    data: bank5.slice(0, 6912)
                });
            }

            // 3. Shadow screen (bank 7, 128K only)
            if (parsed.is128) {
                const bank7 = explorerExtractBank(7);
                if (bank7) {
                    entries.push({
                        name: 'Shadow',
                        ext: 'C',
                        tapType: 3,
                        addr: 0x4000,
                        length: 6912,
                        autostart: null,
                        kind: 'screen',
                        bankNum: 7,
                        data: bank7.slice(0, 6912)
                    });
                }
            }

            // 4. All RAM banks
            const bankList = parsed.is128 ? [0, 1, 2, 3, 4, 5, 6, 7] : [5, 2, 0];
            for (const bankNum of bankList) {
                const bankData = explorerExtractBank(bankNum);
                if (!bankData) continue;
                const addr = bankNum === 5 ? 0x4000 : bankNum === 2 ? 0x8000 : 0xC000;
                entries.push({
                    name: `Bank ${bankNum}`,
                    ext: 'C',
                    tapType: 3,
                    addr: addr,
                    length: bankData.length,
                    autostart: null,
                    kind: 'bank',
                    bankNum: bankNum,
                    data: new Uint8Array(bankData)
                });
            }
        } finally {
            explorerParsed = savedParsed;
            explorerData = savedData;
            explorerBankCache = savedCache;
        }

        return entries;
    }

    function snapshotEditorRenderEntries(panel) {
        const entries = panel.snapshotEntries || [];
        if (entries.length === 0) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">No extractable data</span>';
            panel.dom.statusSpan.textContent = '';
            editorUpdateToolbar();
            return;
        }

        editorRenderLabelBar(panel);
        let html = editorColHeaderHtml();

        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            const selected = panel.selection.has(i) ? ' selected' : '';
            const typeLabel = e.kind === 'basic' ? 'BASIC' : e.kind === 'screen' ? 'Screen' : 'CODE';
            html += `<div class="editor-block-row snapshot-row${selected}" data-block-idx="${i}">` +
                `<span class="editor-block-info">` +
                `<span class="dim">${i + 1}:</span>` +
                `<span class="file-name">${e.name}</span>` +
                `<span class="file-flag"></span>` +
                `<span class="file-ext">${typeLabel}</span>` +
                `<span class="file-addr">${fmtAddrPair(e.addr)}</span>` +
                `<span class="file-size">${e.length}</span>` +
                `</span></div>`;
        }

        panel.dom.fileList.innerHTML = html;
        panel.dom.statusSpan.textContent = `${entries.length} entries`;
        editorUpdateToolbar();
    }

    function snapshotEditorExtractSelection(panel, format) {
        const sorted = editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        const baseName = (panel.fileName || 'extract').replace(/\.(sna|z80|szx)$/i, '');
        const asHobeta = format === 'hobeta';

        const files = [];
        for (const idx of sorted) {
            const entry = panel.snapshotEntries[idx];
            if (!entry || !entry.data) continue;
            const trimName = entry.name.replace(/\s+/g, '_');
            if (asHobeta) {
                files.push({
                    name: trimName + '.' + trdExtToHobetaExt(entry.ext),
                    data: buildHobeta({
                        name: (entry.name + '        ').substring(0, 8),
                        ext: entry.ext,
                        startAddress: entry.addr,
                        length: entry.data.length,
                        data: entry.data
                    })
                });
            } else {
                const extMap = { basic: '.bas', screen: '.scr', bank: '.bin' };
                files.push({
                    name: trimName + (extMap[entry.kind] || '.bin'),
                    data: entry.data
                });
            }
        }
        if (files.length === 0) return;
        if (files.length === 1) {
            downloadFile(files[0].name, files[0].data);
            return;
        }
        const zipData = editorCreateZip(files);
        downloadFile(baseName + '_extract.zip', zipData);
    }

    /** Write incoming data into a snapshot entry's bank. Returns error string or null. */
    function snapshotEditorWriteEntry(panel, entryIdx, data) {
        const entry = (panel.snapshotEntries || [])[entryIdx];
        if (!entry) return 'No such entry';
        if (data.length > entry.length) return `Data too large (${data.length} > ${entry.length})`;
        if (!panel.snapshotBankCache) panel.snapshotBankCache = new Map();
        if (!panel.snapshotDirty) panel.snapshotDirty = new Set();

        if (entry.kind === 'basic') {
            // BASIC: write directly into entry data
            const newData = new Uint8Array(entry.length);
            newData.set(data);
            entry.data = newData;
            // Also update in bank cache: BASIC lives in bank 5 (and possibly 2 or paged bank)
            // For simplicity, rebuild the full bank from the original + BASIC overlay
            const parsed = panel.parsedFile;
            const savedParsed = explorerParsed;
            const savedData = explorerData;
            const savedCache = explorerBankCache;
            explorerParsed = parsed;
            explorerData = panel.rawData;
            explorerBankCache = panel.snapshotBankCache;
            try {
                // Determine which bank(s) the BASIC occupies
                const progAddr = entry.addr;
                for (let i = 0; i < data.length; i++) {
                    const addr = progAddr + i;
                    if (addr < 0x4000 || addr >= 0x10000) continue;
                    let bankNum, offset;
                    if (addr < 0x8000) { bankNum = 5; offset = addr - 0x4000; }
                    else if (addr < 0xC000) { bankNum = 2; offset = addr - 0x8000; }
                    else {
                        const port7FFD = (parsed.registers && parsed.registers.port7FFD) || 0;
                        bankNum = parsed.is128 ? (port7FFD & 0x07) : 0;
                        offset = addr - 0xC000;
                    }
                    let bank = panel.snapshotBankCache.get(bankNum);
                    if (!bank) {
                        bank = explorerExtractBank(bankNum);
                        if (!bank) continue;
                        bank = new Uint8Array(bank);
                        panel.snapshotBankCache.set(bankNum, bank);
                    }
                    bank[offset] = data[i];
                    panel.snapshotDirty.add(bankNum);
                }
            } finally {
                explorerParsed = savedParsed;
                explorerData = savedData;
                explorerBankCache = savedCache;
            }
        } else if (entry.kind === 'screen') {
            // Screen: first 6912 bytes of bank 5 or 7
            const bankNum = entry.bankNum;
            let bank = panel.snapshotBankCache.get(bankNum);
            if (!bank) {
                const savedParsed = explorerParsed;
                const savedData = explorerData;
                const savedCache = explorerBankCache;
                explorerParsed = panel.parsedFile;
                explorerData = panel.rawData;
                explorerBankCache = panel.snapshotBankCache;
                try { bank = explorerExtractBank(bankNum); } finally {
                    explorerParsed = savedParsed;
                    explorerData = savedData;
                    explorerBankCache = savedCache;
                }
                if (!bank) return 'Cannot extract bank';
                bank = new Uint8Array(bank);
                panel.snapshotBankCache.set(bankNum, bank);
            }
            bank.set(data.slice(0, Math.min(data.length, 6912)), 0);
            entry.data = bank.slice(0, 6912);
            panel.snapshotDirty.add(bankNum);
        } else if (entry.kind === 'bank') {
            // Full bank replacement
            const bankNum = entry.bankNum;
            let bank = panel.snapshotBankCache.get(bankNum);
            if (!bank) {
                const savedParsed = explorerParsed;
                const savedData = explorerData;
                const savedCache = explorerBankCache;
                explorerParsed = panel.parsedFile;
                explorerData = panel.rawData;
                explorerBankCache = panel.snapshotBankCache;
                try { bank = explorerExtractBank(bankNum); } finally {
                    explorerParsed = savedParsed;
                    explorerData = savedData;
                    explorerBankCache = savedCache;
                }
                if (!bank) return 'Cannot extract bank';
                bank = new Uint8Array(bank);
                panel.snapshotBankCache.set(bankNum, bank);
            }
            bank.set(data.slice(0, Math.min(data.length, 16384)), 0);
            entry.data = new Uint8Array(bank);
            panel.snapshotDirty.add(bankNum);
        }
        // Update screen entry if its bank was modified
        if (entry.kind === 'bank' && (entry.bankNum === 5 || entry.bankNum === 7)) {
            const screenName = entry.bankNum === 5 ? 'Screen' : 'Shadow';
            const screenEntry = (panel.snapshotEntries || []).find(e => e.kind === 'screen' && e.bankNum === entry.bankNum);
            if (screenEntry) {
                const bank = panel.snapshotBankCache.get(entry.bankNum);
                if (bank) screenEntry.data = bank.slice(0, 6912);
            }
        }
        return null;
    }

    /** Rebuild and download snapshot from modified bank data. */
    function snapshotEditorSave(panel) {
        if (!panel.snapshotDirty || panel.snapshotDirty.size === 0) return;
        const parsed = panel.parsedFile;
        const rawData = panel.rawData;
        const baseName = (panel.fileName || 'snapshot').replace(/\.[^.]+$/, '');

        // Build a bank cache that merges panel modifications with original data
        const savedParsed = explorerParsed;
        const savedData = explorerData;
        const savedCache = explorerBankCache;
        explorerParsed = parsed;
        explorerData = rawData;
        explorerBankCache = panel.snapshotBankCache || new Map();

        try {
            // Ensure all banks are in cache (extract unmodified ones from original)
            const bankList = parsed.is128 ? [0, 1, 2, 3, 4, 5, 6, 7] : [5, 2, 0];
            for (const bankNum of bankList) {
                if (!explorerBankCache.has(bankNum)) {
                    const bank = explorerExtractBank(bankNum);
                    if (bank) explorerBankCache.set(bankNum, new Uint8Array(bank));
                }
            }

            if (parsed.type === 'sna') {
                const result = new Uint8Array(rawData.length);
                result.set(rawData);
                const port7FFD = (parsed.registers && parsed.registers.port7FFD) || 0;
                const pagedBank = port7FFD & 0x07;
                for (const bankNum of panel.snapshotDirty) {
                    const bankData = explorerBankCache.get(bankNum);
                    if (!bankData) continue;
                    if (!parsed.is128) {
                        if (bankNum === 5) result.set(bankData, 27);
                        else if (bankNum === 2) result.set(bankData, 27 + 16384);
                        else if (bankNum === 0) result.set(bankData, 27 + 32768);
                    } else {
                        if (bankNum === 5) result.set(bankData, 27);
                        else if (bankNum === 2) result.set(bankData, 27 + 16384);
                        else if (bankNum === pagedBank) result.set(bankData, 27 + 32768);
                        else {
                            const remainingBanks = [0, 1, 3, 4, 6, 7].filter(b => b !== pagedBank);
                            const idx = remainingBanks.indexOf(bankNum);
                            if (idx >= 0) result.set(bankData, 49183 + idx * 16384);
                        }
                    }
                }
                downloadFile(`${baseName}_modified.sna`, result);
            } else if (parsed.type === 'z80') {
                let headerLen;
                if (parsed.version === 1) {
                    headerLen = 30 + 2 + 54;
                    const header = new Uint8Array(headerLen);
                    header.set(rawData.slice(0, 30));
                    header[6] = 0; header[7] = 0;
                    header[12] = header[12] & ~0x20;
                    header[30] = 54; header[31] = 0;
                    const origPC = rawData[6] | (rawData[7] << 8);
                    header[32] = origPC & 0xFF; header[33] = (origPC >> 8) & 0xFF;
                    header[34] = 0;
                    const totalSize = headerLen + bankList.length * (3 + 16384);
                    const result = new Uint8Array(totalSize);
                    result.set(header);
                    let offset = headerLen;
                    const pageMapping = { 5: 8, 2: 4, 0: 5 };
                    for (const bankNum of bankList) {
                        const bankData = explorerBankCache.get(bankNum);
                        if (!bankData) continue;
                        result[offset] = 0xFF; result[offset + 1] = 0xFF;
                        result[offset + 2] = pageMapping[bankNum] || (bankNum + 3);
                        result.set(bankData.slice(0, 16384), offset + 3);
                        offset += 3 + 16384;
                    }
                    downloadFile(`${baseName}_modified.z80`, result);
                } else {
                    const extLen = rawData[30] | (rawData[31] << 8);
                    headerLen = 32 + extLen;
                    const header = new Uint8Array(headerLen);
                    header.set(rawData.slice(0, headerLen));
                    const totalSize = headerLen + bankList.length * (3 + 16384);
                    const result = new Uint8Array(totalSize);
                    result.set(header);
                    let offset = headerLen;
                    for (const bankNum of bankList) {
                        const bankData = explorerBankCache.get(bankNum);
                        if (!bankData) continue;
                        const pageNum = parsed.is128 ? (bankNum + 3) : ({ 5: 8, 2: 4, 0: 5 })[bankNum];
                        if (pageNum === undefined) continue;
                        result[offset] = 0xFF; result[offset + 1] = 0xFF;
                        result[offset + 2] = pageNum;
                        result.set(bankData.slice(0, 16384), offset + 3);
                        offset += 3 + 16384;
                    }
                    downloadFile(`${baseName}_modified.z80`, result.slice(0, offset));
                }
            } else if (parsed.type === 'szx') {
                const bytes = new Uint8Array(rawData);
                const chunks = [];
                chunks.push(bytes.slice(0, 8));
                for (const chunk of (parsed.chunks || [])) {
                    if (chunk.id !== 'RAMP') {
                        const chunkStart = chunk.offset - 8;
                        const chunkEnd = chunk.offset + chunk.size;
                        if (chunkStart >= 8 && chunkEnd <= bytes.length) {
                            chunks.push(bytes.slice(chunkStart, chunkEnd));
                        }
                    }
                }
                for (const bankNum of bankList) {
                    const bankData = explorerBankCache.get(bankNum);
                    if (!bankData) continue;
                    let compressed = null, useCompression = false;
                    if (typeof pako !== 'undefined') {
                        try {
                            compressed = pako.deflate(bankData);
                            if (compressed.length < bankData.length - 100) useCompression = true;
                        } catch (e) { /* uncompressed */ }
                    }
                    const pageBytes = useCompression ? compressed : bankData;
                    const rampData = new Uint8Array(3 + pageBytes.length);
                    rampData[0] = useCompression ? 1 : 0;
                    rampData[1] = 0;
                    rampData[2] = bankNum;
                    rampData.set(pageBytes, 3);
                    const chunkBuf = new Uint8Array(8 + rampData.length);
                    chunkBuf[0] = 0x52; chunkBuf[1] = 0x41;
                    chunkBuf[2] = 0x4D; chunkBuf[3] = 0x50;
                    chunkBuf[4] = rampData.length & 0xFF;
                    chunkBuf[5] = (rampData.length >> 8) & 0xFF;
                    chunkBuf[6] = (rampData.length >> 16) & 0xFF;
                    chunkBuf[7] = (rampData.length >> 24) & 0xFF;
                    chunkBuf.set(rampData, 8);
                    chunks.push(chunkBuf);
                }
                const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
                const result = new Uint8Array(totalLen);
                let offset = 0;
                for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
                downloadFile(`${baseName}_modified.szx`, result);
            }
        } finally {
            explorerParsed = savedParsed;
            explorerData = savedData;
            explorerBankCache = savedCache;
        }
    }

    // --- Shared toolbar visibility ---

    function editorUpdateToolbar() {
        const panel = getActivePanel();
        const t = panel.fileType;
        const isTap = isTapOrTzx(t);
        const isTrd = t === 'trd' || t === 'scl' || t === 'mgt' || t === 'mdr';
        const isDsk = t === 'dsk';
        const isZip = t === 'zip';
        const isOpd = t === 'opd';
        const isSnapshot = isSnapshotType(t);
        const hasSel = panel.selection.size > 0;

        const snapModified = isSnapshot && panel.snapshotDirty && panel.snapshotDirty.size > 0;
        btnEditorSave.textContent = t ? `Save ${t.toUpperCase()}${snapModified ? ' *' : ''}` : 'Save';
        btnEditorSave.disabled = !t || (isSnapshot && !snapModified);

        const isDidaktik = t === 'didaktik';
        const canReorder = isTap || isTrd || isOpd || isDidaktik || isDsk;
        btnEditorMoveUp.style.display = canReorder && !isZip && !isSnapshot ? '' : 'none';
        btnEditorMoveDown.style.display = canReorder && !isZip && !isSnapshot ? '' : 'none';
        btnEditorMoveUp.disabled = !hasSel;
        btnEditorMoveDown.disabled = !hasSel;

        btnEditorMarkDel.style.display = (isTap || isTrd || isOpd || isDidaktik || isDsk) && !isSnapshot ? '' : 'none';
        btnEditorMarkDel.disabled = !hasSel;
        btnEditorMarkDel.title = 'Mark selected as deleted, or undelete if already deleted. TR-DOS keeps deleted entries on the disk; other formats flush them on save. Use Delete to remove forever.';

        btnEditorDel.disabled = !hasSel || isSnapshot;
        btnEditorExtract.style.display = 'none';
        editorExtractDisk.style.display = '';
        editorExtractDisk.disabled = !hasSel;
        if (hasSel) editorExtractDisk.value = '';

        editorLinkLabel.style.display = isTap && !isSnapshot ? '' : 'none';

        btnEditorAddFile.disabled = isSnapshot || (isDsk && panel.parsedFile && panel.parsedFile.dskImage &&
            !DSKLoader.getDiskSpec(panel.parsedFile.dskImage).valid && (panel.parsedFile.files || []).length === 0);

        btnEditorCopy.disabled = !hasSel || !t;
        btnEditorCopy.innerHTML = activePanel === 'left' ? 'Copy &#9654;' : '&#9664; Copy';

        // "Turbo": view / set the pulse timing of the selected block(s) — convert a
        // standard block to turbo, re-time a turbo block, or just inspect its params.
        // TZX only (TAP can't carry timing).
        if (btnEditorToTurbo) {
            const canTurbo = t === 'tzx' && hasSel && [...panel.selection].some(i => editorBlockTurboable(panel.blocks[i]));
            btnEditorToTurbo.style.display = t === 'tzx' ? '' : 'none';
            btnEditorToTurbo.disabled = !canTurbo;
        }

        // "Split": isolate a monoloader's appended CODE as its own entry for RE.
        // TR-DOS/SCL only (where the editor model carries full sectors + declared
        // length); enabled when exactly one selected file is a monoloader.
        if (btnEditorSplit) {
            const isTrdScl = t === 'trd' || t === 'scl';
            const sel = [...panel.selection];
            const canSplit = isTrdScl && sel.length === 1 &&
                panel.diskFiles[sel[0]] && isMonoloader(panel.diskFiles[sel[0]].length, panel.diskFiles[sel[0]].sectors);
            btnEditorSplit.style.display = isTrdScl ? '' : 'none';
            btnEditorSplit.disabled = !canSplit;
        }

        // "Banner": SPECSCII catalogue banner viewer/injector — TR-DOS/SCL only.
        // A tick marks a disk that already carries one.
        if (btnEditorBanner) {
            const isTrdScl = t === 'trd' || t === 'scl';
            btnEditorBanner.style.display = isTrdScl ? '' : 'none';
            btnEditorBanner.textContent = diskEditorBannerCount(panel) ? 'Banner ✓' : 'Banner';
        }

        // "Keep slack" / "full sectors" only apply where the model holds full sectors,
        // so show them only then (never as silent no-ops). Extract reads the source, so
        // it needs only the source to qualify; Copy fills the destination too, so it
        // needs both panels slack-capable (an empty destination is auto-created to match
        // the source, so it qualifies).
        const slackOk = SLACK_FORMATS.includes(t);
        const otherPanel = editorPanels[activePanel === 'left' ? 'right' : 'left'];
        const dstType = otherPanel && otherPanel.fileType;
        const slackCopyOk = slackOk && (!dstType || SLACK_FORMATS.includes(dstType));
        if (editorKeepSlackLabel) editorKeepSlackLabel.style.display = (slackCopyOk && !isSnapshot) ? '' : 'none';
        if (editorExtractFullOpt) editorExtractFullOpt.hidden = !slackOk;
    }

    function updatePanelHeader(panel) {
        panel.dom.formatSpan.textContent = panel.fileType ? panel.fileType.toUpperCase() : '';
        panel.dom.nameSpan.textContent = panel.fileName || 'Empty';
    }

    function activatePanel(side) {
        if (activePanel === side) return;
        activePanel = side;
        editorPanels.left.dom.container.classList.toggle('active', side === 'left');
        editorPanels.right.dom.container.classList.toggle('active', side === 'right');
        editorUpdateToolbar();
    }

    // --- Sync left panel to explorer state ---
    function syncPanelToExplorer(panel) {
        if (panel !== editorPanels.left) return;
        explorerParsed = panel.parsedFile;
        explorerData = panel.rawData;
        // For TZX files, the File Info tab uses the original parsed blocks from explorerParseTZX
        // (which have .id, .name, .offset, .length), not the editor's panel.blocks
        // (which have .tzxId, .typeName, .blockType, .dataLength for editing purposes)
        if (panel.parsedFile && panel.parsedFile._tzxInfoBlocks) {
            explorerBlocks = panel.parsedFile._tzxInfoBlocks;
        } else {
            explorerBlocks = panel.blocks;
        }
        const editActive = document.querySelector('.explorer-subtab.active');
        explorerUpdateSourceSelectors(!(editActive && editActive.dataset.subtab === 'edit'));
    }

    // --- TAP rendering (parameterized) ---

    // Disk-style type label for tape header types, for a uniform look with disk catalogs.
    function editorTapeTypeLabel(t) {
        return ['BASIC', 'Number array', 'Character array', 'Code'][t] || 'Unknown';
    }

    // Inline edit form for a tape header (shared by the combined and raw views).
    function editorTapeHeaderEditHtml(panel, block, i) {
        let h = `<div class="editor-inline-edit" data-edit-idx="${i}">`;
        h += `<input type="text" maxlength="10" value="${block.name}" data-field="name" placeholder="Name" class="editor-input">`;
        h += `<select data-field="type" class="editor-input">`;
        h += `<option value="0"${block.headerType === 0 ? ' selected' : ''}>Program</option>`;
        h += `<option value="1"${block.headerType === 1 ? ' selected' : ''}>Num array</option>`;
        h += `<option value="2"${block.headerType === 2 ? ' selected' : ''}>Char array</option>`;
        h += `<option value="3"${block.headerType === 3 ? ' selected' : ''}>Bytes</option>`;
        h += '</select>';
        if (block.headerType === 0) {
            h += `<input type="number" value="${block.autostart !== null ? block.autostart : ''}" data-field="autostart" min="0" max="9999" placeholder="off" title="BASIC autostart line — leave blank for no auto-run" class="editor-input editor-input-short">`;
        } else if (block.headerType === 3) {
            h += `<input type="text" value="${fmtAddr(block.startAddress)}" data-field="addr" maxlength="5" placeholder="Addr" class="editor-input editor-input-short">`;
        }
        h += `<button class="editor-apply-btn" data-action="apply" data-idx="${i}">Apply</button>`;
        h += '</div>';
        return h;
    }

    // Labeled column-header row, uniform across tape/disk/snapshot panels. Units live in the
    // header (Bytes, plus an optional Sectors/Blocks count column) so rows show bare numbers.
    function editorColHeaderHtml(countLabel) {
        const count = countLabel ? `<span class="file-sectors">${countLabel}</span>` : '';
        return `<div class="editor-block-row editor-col-header"><span class="editor-block-info"><span class="dim">#</span><span class="file-name">Name</span><span class="file-flag">Flag</span><span class="file-ext">Type</span><span class="file-addr">Address</span><span class="file-size">Bytes</span>${count}</span></div>`;
    }

    // Label row above the column headers — the editable media label where one exists, or an
    // empty row (keeps every panel row-synced: title → label → column header → files).
    function editorLabelRowHtml(inner, editable) {
        const content = inner || ' ';
        return `<div class="editor-block-row disk-label-row"${editable ? ' data-label-row="1"' : ' style="cursor:default"'}><span class="editor-block-info">${content}</span></div>`;
    }

    // ===== Volume-label strip (panel metadata, shown above the file table, not inside it) =====
    // Formats with a label slot show an editable "Label: …" chip; others get an empty strip
    // (which still reserves height so both panels' tables stay row-aligned).
    const EDITOR_LABEL_MAX = { trd: 8, scl: 8, mdr: 10, opd: 10, didaktik: 10, dsk: 11 };

    // Render a panel's label strip from `panel.diskLabel` into its dedicated bar element.
    // Call wherever the panel is (re)rendered — writes the bar, never the file list.
    function editorRenderLabelBar(panel) {
        const bar = panel.dom && panel.dom.labelBar;
        if (!bar) return;
        const maxLen = EDITOR_LABEL_MAX[panel.fileType] || 0;
        if (!maxLen) { bar.innerHTML = ''; return; }
        const lbl = (panel.diskLabel || '').replace(/\s+$/, '');
        if (panel.expandedBlock === -2) {
            bar.innerHTML = `<label>Label:</label>`
                + `<input type="text" maxlength="${maxLen}" value="${lbl}" data-field="label" style="width:120px">`
                + `<button class="editor-apply-btn" data-action="label-apply">Apply</button>`;
            const inp = bar.querySelector('input');
            if (inp) { inp.focus(); inp.select(); }
        } else {
            bar.innerHTML = `<span class="editor-label-view" data-label-edit="1" title="Click to rename the disk">Label: <span class="name">"${lbl}"</span></span>`;
        }
    }

    // Write the edited label from the strip back into the image, per format.
    function editorApplyLabel(panel) {
        const input = panel.dom.labelBar && panel.dom.labelBar.querySelector('[data-field="label"]');
        if (!input) return;
        const val = input.value;
        const t = panel.fileType;
        panel.expandedBlock = -1;
        if (t === 'trd' || t === 'scl') {
            panel.diskLabel = (val + '        ').substring(0, 8);
            diskEditorRenderFileList(panel);
            diskEditorRefreshExplorer(panel);
        } else if (t === 'mdr') {
            panel.diskLabel = (val + '          ').substring(0, 10);
            panel.rawData = diskEditorBuildMdr(panel);
            panel.parsedFile = explorerParseMDR(panel.rawData);
            mdrEditorRenderFileList(panel);
            syncPanelToExplorer(panel);
        } else if (t === 'opd') {
            panel.diskLabel = val.substring(0, 10);
            opdEditorRebuildImage(panel);
            opdEditorRenderFileList(panel);
            syncPanelToExplorer(panel);
        } else if (t === 'didaktik') {
            panel.rawData = DidaktikLoader.setDiskLabel(panel.rawData, val);
            didaktikEditorRefresh(panel);
        } else if (t === 'dsk') {
            DSKLoader.setDiskLabel(panel.parsedFile.dskImage, val);
            dskEditorRefreshState(panel);
            dskEditorRenderFileList(panel);
        }
        editorRenderLabelBar(panel);
    }

    function editorRenderBlockList(panel) {
        if (!panel) panel = getActivePanel();
        editorRenderLabelBar(panel); // clear/refresh the label strip on every (re)render
        // Format-aware dispatch
        if (panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr') {
            diskEditorRenderFileList(panel);
            return;
        }
        if (panel.fileType === 'opd') {
            opdEditorRenderFileList(panel);
            return;
        }
        if (panel.fileType === 'didaktik') {
            didaktikEditorRenderFileList(panel);
            return;
        }
        if (panel.fileType === 'dsk') {
            dskEditorRenderFileList(panel);
            return;
        }
        if (panel.fileType === 'zip') {
            zipEditorRenderFileList(panel);
            return;
        }
        if (isSnapshotType(panel.fileType)) {
            snapshotEditorRenderEntries(panel);
            return;
        }
        if (!panel.parsedFile || !isTapOrTzx(panel.parsedFile.type)) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty</span>';
            panel.dom.statusSpan.textContent = '';
            editorUpdateToolbar();
            return;
        }

        if (panel.blocks.length === 0) {
            const fmtName = panel.fileType === 'tzx' ? 'TZX' : 'TAP';
            panel.dom.fileList.innerHTML = `<span class="explorer-empty">Empty ${fmtName}. Use "Add File" to add blocks.</span>`;
            panel.dom.statusSpan.textContent = '0 blocks';
            editorUpdateToolbar();
            return;
        }

        // Summary row mirrors the disk panel's info row (keeps the two panels row-synced).
        // Total size counts file data only — headers don't count toward size on disk.
        const isRawTurboBlock = (b) => b.blockType === 'nonstandard' && (b.tzxId === 0x11 || b.tzxId === 0x14) && !!b.rawBytes;
        const rawTurboDataLen = (b) => Math.max(0, b.rawBytes.length - (b.tzxId === 0x11 ? 18 : 10));
        let tapeFiles = 0, tapeBytes = 0, tapeDeleted = 0;
        for (const b of panel.blocks) {
            if (b.deleted) { if (b.blockType === 'data' || isRawTurboBlock(b)) tapeDeleted++; continue; }
            if (b.blockType === 'data' && b.data) { tapeFiles++; tapeBytes += Math.max(0, b.data.length - 2); }
            else if (isRawTurboBlock(b)) { tapeFiles++; tapeBytes += rawTurboDataLen(b); }
        }
        editorRenderLabelBar(panel);
        let html = editorColHeaderHtml();
        const tapeFlag = (b) => (b && b.data && b.data.length) ? fmtByte(b.data[0]) : '';
        let rowNum = 0;
        for (let i = 0; i < panel.blocks.length; i++) {
            const block = panel.blocks[i];

            // TZX metadata/control blocks (Archive Info, Text Description, Pause/Stop, …) aren't
            // files — hidden in edit mode, but kept in panel.blocks so they survive on save.
            // Raw turbo ($11) / pure-data ($14) blocks ARE shown — they carry copyable data.
            const isRawTurbo = isRawTurboBlock(block);
            if (block.blockType === 'nonstandard' && !isRawTurbo) continue;

            const isHeader = block.blockType === 'header';
            const isSel = panel.selection.has(i);
            const isExpanded = panel.expandedBlock === i;

            // Raw turbo / pure-data block: a selectable, copyable row (no header → no
            // name/address; the load address lives in the game's own loader).
            if (isRawTurbo) {
                const hdr = block.tzxId === 0x11 ? 18 : 10;
                const tflag = block.rawBytes.length > hdr ? fmtByte(block.rawBytes[hdr]) : '';
                const kind = block.tzxId === 0x11 ? 'Turbo' : 'Pure data';
                let rc = 'editor-block-row data-row';
                if (block.deleted) rc += ' disk-deleted';
                if (isSel) rc += ' selected';
                html += `<div class="${rc}" data-block-idx="${i}">`;
                html += `<span class="editor-block-info"><span class="dim">${++rowNum}:</span><span class="file-name"></span><span class="file-flag">${tflag}</span><span class="file-ext">${kind}</span><span class="file-addr"></span><span class="file-size">${rawTurboDataLen(block)}</span></span></div>`;
                continue;
            }

            // Combined view (Link header on): fold a matched header+data pair into one
            // disk-shaped row (same file-ext/file-name/file-addr/file-size classes as disk
            // catalogs), in media order. Lone headers / leftover data stay in place below.
            if (editorPairLock.checked && isHeader && editorIsPairHeader(panel, i)) {
                const isPairSel = isSel || panel.selection.has(i + 1);
                let addrText = '';
                if (block.headerType === 3) addrText = fmtAddrPair(block.startAddress);
                else if (block.headerType === 0 && block.autostart !== null) addrText = `LINE ${block.autostart}`;
                const pairDeleted = block.deleted || (panel.blocks[i + 1] && panel.blocks[i + 1].deleted);
                html += `<div class="editor-block-row disk-row${pairDeleted ? ' disk-deleted' : ''}${isPairSel ? ' selected' : ''}" data-block-idx="${i}">`;
                const pairTurbo = (editorBlockIsTurbo(block) || editorBlockIsTurbo(panel.blocks[i + 1])) ? ' <span class="dim" title="Turbo timing ($11)">⚡</span>' : '';
                html += `<span class="editor-block-info"><span class="dim">${++rowNum}:</span><span class="file-name">${block.name.replace(/\s+$/, '')}</span><span class="file-flag">${tapeFlag(panel.blocks[i + 1])}</span><span class="file-ext">${editorTapeTypeLabel(block.headerType)}${pairTurbo}</span><span class="file-addr">${addrText}</span><span class="file-size">${block.dataLength}</span></span></div>`;
                if (isExpanded) html += editorTapeHeaderEditHtml(panel, block, i);
                i++;   // consumed the matching data block
                continue;
            }

            let rowClasses = 'editor-block-row';
            rowClasses += isHeader ? ' header-row' : ' data-row';
            if (block.deleted) rowClasses += ' disk-deleted';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            if (isHeader) {
                // Lone header (no matching data) \u2014 columnar like a pair so sizes stay aligned
                let hAddr = '';
                if (block.headerType === 3) hAddr = fmtAddrPair(block.startAddress);
                else if (block.headerType === 0 && block.autostart !== null) hAddr = `LINE ${block.autostart}`;
                const hTurbo = editorBlockIsTurbo(block) ? ' <span class="dim" title="Turbo timing ($11)">\u26a1</span>' : '';
                html += `<span class="dim">${++rowNum}:</span><span class="file-name">${block.name.replace(/\s+$/, '')}</span><span class="file-flag">${tapeFlag(block)}</span><span class="file-ext">${editorTapeTypeLabel(block.headerType)}${hTurbo}</span><span class="file-addr">${hAddr}</span><span class="file-size">${block.data ? block.data.length - 2 : 17}</span>`;
            } else {
                // Headerless / leftover data \u2014 empty type/name/addr cells keep the size column aligned
                const dTurbo = editorBlockIsTurbo(block) ? ' <span class="dim" title="Turbo timing ($11)">\u26a1</span>' : '';
                html += `<span class="dim">${++rowNum}:</span><span class="file-name"></span><span class="file-flag">${tapeFlag(block)}</span><span class="file-ext">Data${dTurbo}</span><span class="file-addr"></span><span class="file-size">${block.data.length - 2}</span>`;
            }
            html += '</span></div>';

            if (isExpanded && isHeader) html += editorTapeHeaderEditHtml(panel, block, i);
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        const delTag = tapeDeleted > 0 ? ` (+${tapeDeleted} deleted, flushed on save)` : '';
        const summary = `${tapeFiles} file${tapeFiles !== 1 ? 's' : ''} — ${tapeBytes} bytes${delTag}`;
        panel.dom.statusSpan.textContent = selCount > 0 ? `${summary}, ${selCount} sel` : summary;
        editorUpdateToolbar();
    }

    // --- Selection handling (parameterized) ---

    function editorGetItemCount(panel) {
        const isDisk = panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd' || panel.fileType === 'didaktik';
        const isDsk = panel.fileType === 'dsk';
        const isZip = panel.fileType === 'zip';
        if (isSnapshotType(panel.fileType)) return (panel.snapshotEntries || []).length;
        if (isDisk) return panel.diskFiles.length;
        if (isDsk) return (panel.parsedFile.files || []).length;
        if (isZip) return (panel.parsedFile.files || []).length;
        return panel.blocks.length;
    }

    function editorSelectBlock(panel, idx, ctrlKey, shiftKey) {
        const isDisk = panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd' || panel.fileType === 'didaktik';
        const isDsk = panel.fileType === 'dsk';
        const isZip = panel.fileType === 'zip';
        const isSnap = isSnapshotType(panel.fileType);
        if (shiftKey && (isDisk || isDsk || isZip || isSnap)) {
            // Range selection: from last anchor to current idx
            const anchor = panel._selAnchor !== undefined ? panel._selAnchor : idx;
            const lo = Math.min(anchor, idx);
            const hi = Math.max(anchor, idx);
            panel.selection = new Set();
            for (let i = lo; i <= hi; i++) panel.selection.add(i);
        } else if (ctrlKey) {
            if (isDisk || isDsk || isZip || isSnap) {
                if (panel.selection.has(idx)) {
                    panel.selection.delete(idx);
                } else {
                    panel.selection.add(idx);
                }
            } else {
                const pairIndices = editorExpandPairs(panel, new Set([idx]));
                const allSelected = [...pairIndices].every(i => panel.selection.has(i));
                if (allSelected) {
                    for (const i of pairIndices) panel.selection.delete(i);
                } else {
                    for (const i of pairIndices) panel.selection.add(i);
                }
            }
        } else {
            if (isDisk || isDsk || isZip || isSnap) {
                panel.selection = new Set([idx]);
            } else {
                panel.selection = editorExpandPairs(panel, new Set([idx]));
            }
        }
        if (!shiftKey) panel._selAnchor = idx;
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
    }

    function editorSelectAll(panel) {
        const count = editorGetItemCount(panel);
        if (count === 0) return;
        panel.selection = new Set();
        for (let i = 0; i < count; i++) panel.selection.add(i);
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
    }

    // --- TAP operations (parameterized) ---

    function editorMoveSelection(panel, direction) {
        const sorted = editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        if (direction === -1 && sorted[0] === 0) return;
        if (direction === 1 && sorted[sorted.length - 1] === panel.blocks.length - 1) return;

        const order = direction === -1 ? sorted : sorted.slice().reverse();
        const newSel = new Set();
        for (const idx of order) {
            const newIdx = idx + direction;
            const temp = panel.blocks[idx];
            panel.blocks[idx] = panel.blocks[newIdx];
            panel.blocks[newIdx] = temp;
            newSel.add(newIdx);
        }
        panel.selection = newSel;
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
        syncPanelToExplorer(panel);
    }

    function editorDeleteSelection(panel) {
        if (panel.selection.size === 0) return;
        const sorted = editorSelectedSorted(panel).reverse();
        for (const idx of sorted) {
            panel.blocks.splice(idx, 1);
        }
        panel.selection.clear();
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
        syncPanelToExplorer(panel);
    }

    // TAP/TZX soft-delete toggle: mark selected blocks (and their header/data pair) deleted —
    // shown greyed, kept in the list, and flushed from the built TAP/TZX on save. Re-running on
    // an already-deleted selection undeletes it.
    function editorMarkDeletedSelection(panel) {
        if (panel.selection.size === 0) return;
        const indices = [...editorExpandPairs(panel, panel.selection)];
        const allDeleted = indices.every(idx => panel.blocks[idx] && panel.blocks[idx].deleted);
        for (const idx of indices) {
            if (panel.blocks[idx]) panel.blocks[idx].deleted = !allDeleted;
        }
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
        syncPanelToExplorer(panel);
    }

    function editorCrc32(data) {
        let crc = 0xFFFFFFFF;
        const table = editorCrc32.t || (editorCrc32.t = (() => {
            const t = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[i] = c;
            }
            return t;
        })());
        for (let i = 0; i < data.length; i++) {
            crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function editorCreateZip(files) {
        const localHeaders = [];
        const centralHeaders = [];
        let offset = 0;
        for (const file of files) {
            const nameBytes = new TextEncoder().encode(file.name);
            // Local file header
            const lh = new Uint8Array(30 + nameBytes.length);
            const dv = new DataView(lh.buffer);
            dv.setUint32(0, 0x04034B50, true); // sig
            dv.setUint16(4, 20, true);  // version
            dv.setUint16(8, 0, true);   // compression: store
            dv.setUint32(14, editorCrc32(file.data), true);
            dv.setUint32(18, file.data.length, true); // compressed
            dv.setUint32(22, file.data.length, true); // uncompressed
            dv.setUint16(26, nameBytes.length, true);
            lh.set(nameBytes, 30);

            // Central dir
            const ch = new Uint8Array(46 + nameBytes.length);
            const cdv = new DataView(ch.buffer);
            cdv.setUint32(0, 0x02014B50, true);
            cdv.setUint16(4, 20, true);
            cdv.setUint16(6, 20, true);
            cdv.setUint32(16, editorCrc32(file.data), true);
            cdv.setUint32(20, file.data.length, true);
            cdv.setUint32(24, file.data.length, true);
            cdv.setUint16(28, nameBytes.length, true);
            cdv.setUint32(42, offset, true);
            ch.set(nameBytes, 46);

            localHeaders.push({ header: lh, data: file.data });
            centralHeaders.push(ch);
            offset += lh.length + file.data.length;
        }
        const cdOffset = offset;
        let cdSize = 0;
        for (const ch of centralHeaders) cdSize += ch.length;
        const end = new Uint8Array(22);
        const edv = new DataView(end.buffer);
        edv.setUint32(0, 0x06054B50, true);
        edv.setUint16(8, files.length, true);
        edv.setUint16(10, files.length, true);
        edv.setUint32(12, cdSize, true);
        edv.setUint32(16, cdOffset, true);
        const result = new Uint8Array(offset + cdSize + 22);
        let pos = 0;
        for (const lh of localHeaders) {
            result.set(lh.header, pos); pos += lh.header.length;
            result.set(lh.data, pos); pos += lh.data.length;
        }
        for (const ch of centralHeaders) { result.set(ch, pos); pos += ch.length; }
        result.set(end, pos);
        return result;
    }

    function editorSanitizeFilename(name) {
        return name.replace(/[^\x20-\x7E]/g, '').replace(/[\/\\:*?"<>|]/g, '').trim() || 'untitled';
    }

    function editorExtractRaw(panel, block, idx) {
        const num = String(idx + 1).padStart(3, '0');
        if (block.blockType === 'nonstandard' && (block.tzxId === 0x11 || block.tzxId === 0x14) && block.rawBytes) {
            // Raw turbo / pure-data block: dump the encoded byte stream verbatim.
            const hdr = block.tzxId === 0x11 ? 18 : 10;
            return { name: `${num}_turbo.bin`, data: block.rawBytes.slice(hdr) };
        }
        if (block.blockType === 'header') {
            const safe = editorSanitizeFilename(block.name);
            return { name: `${num}_${safe}_header.bin`, data: block.data };
        }
        const prev = idx > 0 ? panel.blocks[idx - 1] : null;
        if (prev && prev.blockType === 'header') {
            const safe = editorSanitizeFilename(prev.name);
            let suffix = '';
            if (prev.headerType === 3 && prev.startAddress !== undefined) {
                suffix = '_' + hex16(prev.startAddress);
            } else if (prev.headerType === 0 && prev.autostart !== null) {
                suffix = '_line' + prev.autostart;
            }
            return { name: `${num}_${safe}${suffix}.bin`, data: block.data.slice(1, block.data.length - 1) };
        }
        return { name: `${num}_data.bin`, data: block.data.slice(1, block.data.length - 1) };
    }

    function editorExtractHobeta(panel, block, idx) {
        // Only data blocks can be exported as Hobeta
        if (block.blockType === 'header') return null;
        if (block.blockType === 'nonstandard' && (block.tzxId === 0x11 || block.tzxId === 0x14) && block.rawBytes) {
            // Raw turbo / pure-data block → Hobeta as Code at address 0 (raw stream).
            const hdr = block.tzxId === 0x11 ? 18 : 10;
            const raw = block.rawBytes.slice(hdr);
            const hob = buildHobetaGeneric('turbo', 3, 0, raw);
            return { name: 'turbo.' + trdExtToHobetaExt(headerTypeToTrdExt(3)), data: hob };
        }
        const rawData = block.data.slice(1, block.data.length - 1); // strip flag + checksum
        const prev = idx > 0 ? panel.blocks[idx - 1] : null;
        let fileName = 'data';
        let headerType = 3;
        let addr = 0;
        if (prev && prev.blockType === 'header') {
            fileName = editorSanitizeFilename(prev.name);
            headerType = prev.headerType;
            addr = prev.startAddress || 0;
        }
        const hobetaData = buildHobetaGeneric(fileName, headerType, addr, rawData);
        const ext = trdExtToHobetaExt(headerTypeToTrdExt(headerType));
        return { name: `${fileName}.${ext}`, data: hobetaData };
    }

    function editorExtractSelection(panel, format) {
        const sorted = editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        const baseName = (panel.fileName || 'extract').replace(/\.(tap|tzx)$/i, '');
        const asHobeta = format === 'hobeta';

        // In Hobeta mode, skip header blocks whose data block is also selected
        // (the data block's Hobeta already contains the header metadata)
        const files = [];
        for (const idx of sorted) {
            const block = panel.blocks[idx];
            if (asHobeta && block.blockType === 'header' &&
                idx + 1 < panel.blocks.length && sorted.includes(idx + 1)) {
                continue;
            }
            if (asHobeta) {
                const hob = editorExtractHobeta(panel, block, idx);
                if (hob) { files.push(hob); continue; }
            }
            files.push(editorExtractRaw(panel, block, idx));
        }
        if (files.length === 0) return;

        if (files.length === 1) {
            downloadFile(files[0].name, files[0].data);
            return;
        }
        const zipData = editorCreateZip(files);
        downloadFile(baseName + '_extract.zip', zipData);
    }

    function editorUpdateHeaderBlock(panel, idx, name, type, param1, param2) {
        const block = panel.blocks[idx];
        if (block.blockType !== 'header') return;

        const d = block.data;
        d[1] = type & 0xFF;
        const padded = (name + '          ').substring(0, 10);
        for (let i = 0; i < 10; i++) {
            d[2 + i] = padded.charCodeAt(i);
        }
        d[14] = param1 & 0xFF;
        d[15] = (param1 >> 8) & 0xFF;
        d[16] = param2 & 0xFF;
        d[17] = (param2 >> 8) & 0xFF;
        editorRecalcChecksum(d);

        const typeNames = ['Program', 'Number array', 'Character array', 'Bytes'];
        block.headerType = type;
        block.typeName = typeNames[type] || 'Unknown';
        block.name = padded.trim();
        block.param1 = param1;
        block.param2 = param2;
        if (type === 0) {
            block.autostart = param1 < 32768 ? param1 : null;
            block.varsOffset = param2;
            delete block.startAddress;
        } else if (type === 3) {
            block.startAddress = param1;
            delete block.autostart;
            delete block.varsOffset;
        } else {
            delete block.autostart;
            delete block.varsOffset;
            delete block.startAddress;
        }
        syncPanelToExplorer(panel);
    }

    function editorAddFileBlocks(panel, fileData, name, type, startAddr, autostart, varLetter, pause, varsOffset) {
        const header = new Uint8Array(19);
        header[0] = 0x00;
        header[1] = type;
        const padded = (name + '          ').substring(0, 10);
        for (let i = 0; i < 10; i++) {
            header[2 + i] = padded.charCodeAt(i);
        }
        header[12] = fileData.length & 0xFF;
        header[13] = (fileData.length >> 8) & 0xFF;
        let param1 = 0;
        if (type === 0) {
            param1 = (autostart !== null && autostart !== undefined && autostart !== '') ? (parseInt(autostart) & 0xFFFF) : 0x8000;
        } else if (type === 3) {
            param1 = startAddr & 0xFFFF;
        } else if (type === 1) {
            const ch = (varLetter || 'A').toUpperCase().charCodeAt(0) - 0x41;
            param1 = 0x80 | (ch & 0x1F);
        } else if (type === 2) {
            const ch = (varLetter || 'A').toUpperCase().charCodeAt(0) - 0x41;
            param1 = 0xC0 | (ch & 0x1F);
        }
        header[14] = param1 & 0xFF;
        header[15] = (param1 >> 8) & 0xFF;
        // BASIC: param2 = vars offset (program length without variables)
        let param2 = (type === 0) ? (varsOffset != null ? Math.min(varsOffset, fileData.length) : fileData.length) : 0x8000;
        header[16] = param2 & 0xFF;
        header[17] = (param2 >> 8) & 0xFF;
        editorRecalcChecksum(header);

        const dataBlock = new Uint8Array(fileData.length + 2);
        dataBlock[0] = 0xFF;
        dataBlock.set(fileData, 1);
        editorRecalcChecksum(dataBlock);

        const typeNames = ['Program', 'Number array', 'Character array', 'Bytes'];
        const headerInfo = {
            offset: -1, length: 19, flag: 0, data: header,
            blockType: 'header', headerType: type,
            typeName: typeNames[type] || 'Unknown',
            name: padded.trim(), dataLength: fileData.length,
            param1: param1, param2: param2
        };
        if (pause !== undefined) headerInfo.tzxPause = pause;
        if (type === 0) {
            headerInfo.autostart = param1 < 32768 ? param1 : null;
            headerInfo.varsOffset = param2;
        } else if (type === 3) {
            headerInfo.startAddress = param1;
        }

        const dataInfo = {
            offset: -1, length: dataBlock.length, flag: 0xFF,
            data: dataBlock, blockType: 'data'
        };
        if (pause !== undefined) dataInfo.tzxPause = pause;

        const newIdx = panel.blocks.length;
        panel.blocks.push(headerInfo);
        panel.blocks.push(dataInfo);
        panel.selection.clear();
        panel.selection.add(newIdx);
        panel.selection.add(newIdx + 1);
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
        panel.dom.fileList.scrollTop = panel.dom.fileList.scrollHeight;
        syncPanelToExplorer(panel);
    }

    function editorAddHeaderlessBlock(panel, fileData, flag, pause) {
        const dataBlock = new Uint8Array(fileData.length + 2);
        dataBlock[0] = flag;
        dataBlock.set(fileData, 1);
        editorRecalcChecksum(dataBlock);

        const blockInfo = {
            offset: -1, length: dataBlock.length, flag: flag,
            data: dataBlock, blockType: flag === 0 ? 'header' : 'data'
        };
        if (pause !== undefined) blockInfo.tzxPause = pause;
        const newIdx = panel.blocks.length;
        panel.blocks.push(blockInfo);
        panel.selection.clear();
        panel.selection.add(newIdx);
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
        panel.dom.fileList.scrollTop = panel.dom.fileList.scrollHeight;
        syncPanelToExplorer(panel);
    }

    function editorImportTapData(panel, tapData) {
        let offset = 0;
        const typeNames = ['Program', 'Number array', 'Character array', 'Bytes'];
        while (offset < tapData.length - 1) {
            const blockLen = tapData[offset] | (tapData[offset + 1] << 8);
            if (blockLen === 0 || offset + 2 + blockLen > tapData.length) break;

            const blockData = new Uint8Array(tapData.slice(offset + 2, offset + 2 + blockLen));
            const flag = blockData[0];
            let blockInfo = { offset: -1, length: blockLen, flag: flag, data: blockData };

            if (flag === 0 && blockLen === 19) {
                const type = blockData[1];
                const name = String.fromCharCode(...blockData.slice(2, 12)).trim();
                const dataLen = blockData[12] | (blockData[13] << 8);
                const p1 = blockData[14] | (blockData[15] << 8);
                const p2 = blockData[16] | (blockData[17] << 8);
                blockInfo.blockType = 'header';
                blockInfo.headerType = type;
                blockInfo.typeName = typeNames[type] || 'Unknown';
                blockInfo.name = name;
                blockInfo.dataLength = dataLen;
                blockInfo.param1 = p1;
                blockInfo.param2 = p2;
                if (type === 0) { blockInfo.autostart = p1 < 32768 ? p1 : null; blockInfo.varsOffset = p2; }
                else if (type === 3) { blockInfo.startAddress = p1; }
            } else {
                blockInfo.blockType = 'data';
            }

            panel.blocks.push(blockInfo);
            offset += 2 + blockLen;
        }
        panel.selection.clear();
        panel.expandedBlock = -1;
    }

    function editorNewTap(panel) {
        panel.blocks = [];
        panel.parsedFile = { type: 'tap', blocks: panel.blocks, size: 0 };
        panel.fileType = 'tap';
        panel.rawData = new Uint8Array(0);
        panel.fileName = 'new.tap';
        panel.selection.clear();
        panel.expandedBlock = -1;
        panel.diskFiles = [];
        panel.diskLabel = '        ';
        updatePanelHeader(panel);
        editorRenderBlockList(panel);
        syncPanelToExplorer(panel);
    }

    function editorBuildTap(panel) {
        let totalSize = 0;
        for (const block of panel.blocks) { if (block.deleted) continue; totalSize += 2 + block.data.length; }
        const tap = new Uint8Array(totalSize);
        let offset = 0;
        for (const block of panel.blocks) {
            if (block.deleted) continue; // flush soft-deleted blocks on save
            tap[offset] = block.data.length & 0xFF;
            tap[offset + 1] = (block.data.length >> 8) & 0xFF;
            offset += 2;
            tap.set(block.data, offset);
            offset += block.data.length;
        }
        return tap;
    }

    function editorSaveTap(panel) {
        if (!panel.blocks.length) return;
        const tap = editorBuildTap(panel);
        const baseName = (panel.fileName || 'output').replace(/\.tap$/i, '');
        downloadFile(baseName + '.tap', tap);
    }

    // ========== Per-format editors (TZX, TR-DOS, banner, MGT, MDR, OPD,
    //            Didaktik, DSK, ZIP) ==========
    // Implementation lives in explorer-editors.js. State is passed as accessors:
    // the file-scoped bindings below are reassigned on every load, and four of
    // them are written by the editors themselves.
    const {
        buildSingleFileTap,
        didaktikEditorAddFile,
        didaktikEditorApplyInlineEdit,
        didaktikEditorDeleteSelection,
        didaktikEditorExtractFiles,
        didaktikEditorExtractSelection,
        didaktikEditorMarkDeletedSelection,
        didaktikEditorMoveSelection,
        didaktikEditorRefresh,
        didaktikEditorRenderFileList,
        didaktikEditorSave,
        diskEditorAddFile,
        diskEditorAddMdrFile,
        diskEditorAddMgtFile,
        diskEditorAddOpdFile,
        diskEditorApplyInlineEdit,
        diskEditorBannerCount,
        diskEditorBuildMdr,
        diskEditorDeleteSelection,
        diskEditorExtractOpdFiles,
        diskEditorExtractSelection,
        diskEditorMarkDeletedSelection,
        diskEditorMoveSelection,
        diskEditorNewDidaktik,
        diskEditorNewMdr,
        diskEditorNewMgt,
        diskEditorNewOpd,
        diskEditorNewTrd,
        diskEditorRefreshExplorer,
        diskEditorRenderFileList,
        diskEditorSaveDisk,
        diskEditorSaveMdr,
        diskEditorSaveMgt,
        diskEditorSaveOpd,
        dskEditorAddFile,
        dskEditorApplyInlineEdit,
        dskEditorDeleteFiles,
        dskEditorExtractFiles,
        dskEditorMarkDeletedSelection,
        dskEditorMoveSelection,
        dskEditorNewDsk,
        dskEditorRefreshState,
        dskEditorRenderFileList,
        dskEditorSaveDsk,
        editorBlockIsTurbo,
        editorBlockTurboable,
        editorConvertSelectionToTurbo,
        editorImportTzxData,
        editorNewTzx,
        editorOpenBannerDialog,
        editorReadTurboParams,
        editorSaveTzx,
        editorSplitMonoloader,
        mdrEditorApplyInlineEdit,
        mdrEditorRefreshExplorer,
        mdrEditorRenderFileList,
        mgtEditorApplyInlineEdit,
        mgtEditorRefreshExplorer,
        mgtEditorRenderFileList,
        mgtExtractCleanData,
        opdEditorApplyInlineEdit,
        opdEditorDeleteSelection,
        opdEditorExtractSelection,
        opdEditorRebuildImage,
        opdEditorRefreshExplorer,
        opdEditorRenderFileList,
        zipEditorAddFile,
        zipEditorDeleteFiles,
        zipEditorExtractFiles,
        zipEditorNewZip,
        zipEditorRenderFileList,
        zipEditorSaveZip,
        zipLoadInnerFile,
        zipShowPickDialog,
    } = initExplorerEditors({
        get DSKLoader() { return DSKLoader; },
        get TRD_TOTAL_SECTORS() { return TRD_TOTAL_SECTORS; },
        get TRD_TYPE_NAMES() { return TRD_TYPE_NAMES; },
        get TZX_BLOCK_NAMES() { return TZX_BLOCK_NAMES; },
        get buildHobeta() { return buildHobeta; },
        get buildHobetaGeneric() { return buildHobetaGeneric; },
        get editorColHeaderHtml() { return editorColHeaderHtml; },
        get editorCreateZip() { return editorCreateZip; },
        get editorPanels() { return editorPanels; },
        get editorRecalcChecksum() { return editorRecalcChecksum; },
        get editorRenderBlockList() { return editorRenderBlockList; },
        get editorRenderLabelBar() { return editorRenderLabelBar; },
        get editorSelectedSorted() { return editorSelectedSorted; },
        get editorUpdateToolbar() { return editorUpdateToolbar; },
        get explorerFileName() { return explorerFileName; },
        get explorerFileSize() { return explorerFileSize; },
        get explorerParseDidaktik() { return explorerParseDidaktik; },
        get explorerParseMDR() { return explorerParseMDR; },
        get explorerParseMGT() { return explorerParseMGT; },
        get explorerParseOPD() { return explorerParseOPD; },
        get explorerParseTAP() { return explorerParseTAP; },
        get explorerParseTRD() { return explorerParseTRD; },
        get explorerParseTZX() { return explorerParseTZX; },
        get explorerRenderFileInfo() { return explorerRenderFileInfo; },
        get getZxCharset() { return getZxCharset; },
        get headerTypeToTrdExt() { return headerTypeToTrdExt; },
        get loadFileIntoPanel() { return loadFileIntoPanel; },
        get syncPanelToExplorer() { return syncPanelToExplorer; },
        get trdEntryFields() { return trdEntryFields; },
        get trdExtToHobetaExt() { return trdExtToHobetaExt; },
        get updatePanelHeader() { return updatePanelHeader; },
        get detectBootloader() { return detectBootloader; },
        get explorerFileSizeAttr() { return explorerFileSizeAttr; },
        get explorerFileSizeText() { return explorerFileSizeText; },
        get trdGetBasicAutostart() { return trdGetBasicAutostart; },
        get explorerData() { return explorerData; },
        set explorerData(v) { explorerData = v; },
        get explorerFileType() { return explorerFileType; },
        set explorerFileType(v) { explorerFileType = v; },
        get explorerParsed() { return explorerParsed; },
        set explorerParsed(v) { explorerParsed = v; },
        get explorerZipFiles() { return explorerZipFiles; },
        set explorerZipFiles(v) { explorerZipFiles = v; },
    });

    // ========== Load file into panel ==========

    async function loadFileIntoPanel(panel, data, filename, ext, parsed) {
        panel.rawData = new Uint8Array(data);
        panel.fileName = filename;
        panel.selection.clear();
        panel.expandedBlock = -1;
        panel.lastClickIdx = -1;
        panel.lastClickTime = 0;
        panel.diskFiles = [];
        panel.diskLabel = '        ';
        panel.pendingFileData = null;

        if (ext === 'tap') {
            panel.fileType = 'tap';
            panel.blocks = [];
            panel.parsedFile = parsed ? { ...parsed, blocks: panel.blocks } : { type: 'tap', blocks: panel.blocks, size: data.length };
            editorImportTapData(panel, data);
            updatePanelHeader(panel);
            editorRenderBlockList(panel);
        } else if (ext === 'tzx') {
            panel.fileType = 'tzx';
            panel.blocks = [];
            const tzxInfoBlocks = parsed ? parsed.blocks : null;
            panel.parsedFile = parsed ? { ...parsed, blocks: panel.blocks, nonStandardBlocks: [] }
                                      : { type: 'tzx', blocks: panel.blocks, nonStandardBlocks: [], size: data.length };
            if (tzxInfoBlocks) panel.parsedFile._tzxInfoBlocks = tzxInfoBlocks;
            editorImportTzxData(panel, data);
            updatePanelHeader(panel);
            editorRenderBlockList(panel);
        } else if (ext === 'trd' || ext === 'scl') {
            panel.fileType = ext;
            panel.blocks = [];
            panel.parsedFile = parsed || { type: ext, files: [], size: data.length };
            updatePanelHeader(panel);
            diskEditorRenderFileList(panel);
        } else if (ext === 'mgt' || (ext === 'img' && (data.length === 819200 || data.length === 409600))) {
            panel.fileType = 'mgt';
            panel.blocks = [];
            panel.parsedFile = parsed || { type: 'mgt', files: [], size: data.length };
            updatePanelHeader(panel);
            diskEditorRenderFileList(panel);
        } else if (ext === 'mdr') {
            panel.fileType = 'mdr';
            panel.blocks = [];
            panel.parsedFile = parsed || { type: 'mdr', files: [], size: data.length };
            updatePanelHeader(panel);
            mdrEditorRenderFileList(panel);
        } else if (ext === 'opd' || ext === 'opu') {
            panel.fileType = 'opd';
            panel.blocks = [];
            panel.parsedFile = parsed || explorerParseOPD(data);
            diskEditorExtractOpdFiles(panel);
            updatePanelHeader(panel);
            opdEditorRenderFileList(panel);
        } else if (ext === 'd40' || ext === 'd80') {
            // Didaktik MDOS: list/extract/copy plus in-place add/delete/rename/save.
            panel.fileType = 'didaktik';
            panel.parsedFile = parsed || explorerParseDidaktik(data);
            didaktikEditorExtractFiles(panel);
            updatePanelHeader(panel);
            didaktikEditorRenderFileList(panel);
        } else if (ext === 'dsk') {
            panel.fileType = 'dsk';
            if (parsed && parsed.dskImage) {
                // Deep-copy DSKImage for right panel independence
                if (panel === editorPanels.right) {
                    const buf = parsed.dskImage.toBuffer();
                    const copy = DSKLoader.parse(buf);
                    let files = [];
                    try { files = DSKLoader.listFiles(copy); } catch (e) { /* non-CP/M */ }
                    panel.parsedFile = { ...parsed, dskImage: copy, files: files };
                    panel.blocks = files;
                } else {
                    panel.parsedFile = parsed;
                    panel.blocks = parsed.files || [];
                }
            } else {
                panel.parsedFile = { type: 'dsk', files: [], size: data.length };
                panel.blocks = [];
            }
            updatePanelHeader(panel);
            dskEditorRenderFileList(panel);
        } else if (ext === 'sna' || ext === 'z80' || ext === 'szx') {
            panel.fileType = ext;
            panel.blocks = [];
            if (!parsed) {
                if (ext === 'sna') parsed = explorerParseSNA(data);
                else if (ext === 'z80') parsed = explorerParseZ80(data);
                else parsed = explorerParseSZX(data);
            }
            panel.parsedFile = parsed;
            panel.snapshotEntries = snapshotEditorBuildEntries(panel);
            updatePanelHeader(panel);
            snapshotEditorRenderEntries(panel);
        } else if (ext === 'zip') {
            // Transparently unwrap ZIP — extract supported container files
            const rawCopy = new Uint8Array(data);
            const zipFiles = await ZipLoader.extract(rawCopy.buffer);
            const supportedExts = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'img', 'mdr', 'opd', 'opu', 'd40', 'd80', 'dsk'];
            const candidates = zipFiles.filter(f => {
                const fext = f.name.split('.').pop().toLowerCase();
                if (fext === 'img') return f.data && (f.data.length === 819200 || f.data.length === 409600);
                return supportedExts.includes(fext);
            });
            if (candidates.length === 1) {
                await zipLoadInnerFile(panel, candidates[0]);
                return;
            } else if (candidates.length > 1) {
                zipShowPickDialog(panel, candidates);
                return;
            }
            // No editor-supported files in ZIP — leave panel unchanged
            return;
        }
        syncPanelToExplorer(panel);
    }

    // ========== Cross-Format Copy ==========

    function extractFilesFromPanel(panel) {
        const sorted = editorSelectedSorted(panel);
        const result = [];
        // "Keep slack": carry the unused bytes in a CODE file's last sector so they
        // ride along on copy. Only formats whose editor model retains the full
        // sectors (TR-DOS / SCL) can source slack; the destination cuts it to fit
        // its own last sector (see applyKeptSlack).
        const keepSlack = !!(editorKeepSlack && editorKeepSlack.checked);

        if (isTapOrTzx(panel.fileType)) {
            // Group header+data pairs
            const processed = new Set();
            for (const idx of sorted) {
                if (processed.has(idx)) continue;
                const block = panel.blocks[idx];
                if (block.blockType === 'header' && idx + 1 < panel.blocks.length && panel.blocks[idx + 1].blockType === 'data') {
                    const dataBlock = panel.blocks[idx + 1];
                    const rawData = dataBlock.data.slice(1, dataBlock.data.length - 1); // strip flag + checksum
                    result.push({
                        name: block.name || 'untitled',
                        ext: '',
                        type: block.headerType,
                        addr: block.headerType === 3 ? (block.startAddress || 0) : 0,
                        autostart: block.headerType === 0 ? block.autostart : null,
                        varsOffset: block.headerType === 0 ? (block.varsOffset ?? null) : null,
                        rawData: rawData
                    });
                    processed.add(idx);
                    processed.add(idx + 1);
                } else if (block.blockType === 'data') {
                    // Standalone data block
                    result.push({
                        name: 'data',
                        ext: '',
                        type: 3,
                        addr: 0,
                        autostart: null,
                        rawData: block.data.slice(1, block.data.length - 1)
                    });
                    processed.add(idx);
                } else if (block.blockType === 'nonstandard' && (block.tzxId === 0x11 || block.tzxId === 0x14) && block.rawBytes) {
                    // Raw turbo ($11) / pure-data ($14) block: copy the encoded byte
                    // stream verbatim (after the timing-parameter header) as a CODE
                    // file with start address 0. The load address / framing is known
                    // only to the game's own loader, so we don't guess — the user
                    // takes responsibility for what the raw turbo data means.
                    const hdr = block.tzxId === 0x11 ? 18 : 10; // $11: 18-byte params, $14: 10-byte params
                    result.push({
                        name: `turbo${idx + 1}`,
                        ext: '',
                        type: 3,        // Code
                        addr: 0,        // raw stream — true address lives in the loader
                        autostart: null,
                        rawData: block.rawBytes.slice(hdr)
                    });
                    processed.add(idx);
                }
            }
        } else if (panel.fileType === 'trd' || panel.fileType === 'scl') {
            for (const idx of sorted) {
                if (idx < 0 || idx >= panel.diskFiles.length) continue;
                const f = panel.diskFiles[idx];
                // Monoloader-aware extract for any type (see ui/disk-file-copy.js):
                // carries the full sector allocation + verbatim metadata when the
                // file's declared length is smaller than its allocation.
                result.push(extractTrdFileDescriptor(f, { keepSlack }));
            }
        } else if (panel.fileType === 'mgt') {
            for (const idx of sorted) {
                if (idx < 0 || idx >= panel.diskFiles.length) continue;
                const f = panel.diskFiles[idx];
                const isBASIC = f.mgtType === 1 || f.mgtType === 16;
                result.push({
                    name: f.name.replace(/\s+$/, ''),
                    ext: f.ext,
                    type: isBASIC ? 0 : 3,
                    addr: isBASIC ? 0 : (f.startAddress || 0),
                    autostart: f.autostart,
                    varsOffset: isBASIC ? (f.bodyLength ?? null) : null,
                    rawData: mgtExtractCleanData(f)
                });
            }
        } else if (panel.fileType === 'mdr') {
            for (const idx of sorted) {
                if (idx < 0 || idx >= panel.diskFiles.length) continue;
                const f = panel.diskFiles[idx];
                // MDR file data includes a 9-byte Spectrum header; strip it for cross-format copy
                let rawData = f.data.slice(0, f.length);
                let type = 3, addr = 0, autostart = null, varsOffset = null;
                if (!f.isPrint && rawData.length >= 9) {
                    const hdrType = rawData[0];
                    const hdrStart = rawData[3] | (rawData[4] << 8);
                    const hdrProgLen = rawData[5] | (rawData[6] << 8);
                    const hdrAutorun = rawData[7] | (rawData[8] << 8);
                    type = hdrType;
                    if (hdrType === 3) addr = hdrStart;
                    if (hdrType === 0) {
                        autostart = hdrAutorun >= 0x8000 ? null : hdrAutorun;
                        varsOffset = hdrProgLen > 0 ? hdrProgLen : null;
                    }
                    rawData = rawData.slice(9);
                }
                result.push({
                    name: f.name.replace(/\s+$/, ''),
                    ext: f.ext,
                    type,
                    addr,
                    autostart,
                    varsOffset,
                    rawData
                });
            }
        } else if (panel.fileType === 'opd') {
            for (const idx of sorted) {
                if (idx < 0 || idx >= panel.diskFiles.length) continue;
                const f = panel.diskFiles[idx];
                const isBASIC = f.ext === 'B';
                result.push({
                    name: f.name.replace(/\s+$/, ''),
                    ext: f.ext,
                    type: isBASIC ? 0 : (f.type >= 0 ? f.type : 3),
                    addr: isBASIC ? 0 : (f.startAddr || 0),
                    autostart: f.autostart,
                    varsOffset: isBASIC ? (f.progLength ?? null) : null,
                    rawData: f.data.slice(0, f.length)
                });
            }
        } else if (panel.fileType === 'didaktik') {
            for (const idx of sorted) {
                if (idx < 0 || idx >= panel.diskFiles.length) continue;
                const f = panel.diskFiles[idx];
                const isBASIC = f.type === 'P';
                result.push({
                    name: f.name.replace(/\s+$/, ''),
                    ext: f.ext,
                    type: isBASIC ? 0 : 3,
                    addr: isBASIC ? 0 : (f.startAddr || 0),
                    autostart: isBASIC ? ((f.startAddr > 0 && f.startAddr < 32768) ? f.startAddr : null) : null,
                    varsOffset: isBASIC ? (f.basicLength ?? null) : null,
                    rawData: f.data.slice(0, f.length)
                });
            }
        } else if (panel.fileType === 'dsk') {
            if (!panel.parsedFile || !panel.parsedFile.dskImage) return result;
            const dskImage = panel.parsedFile.dskImage;
            const files = panel.parsedFile.files || [];
            for (const idx of sorted) {
                if (idx < 0 || idx >= files.length) continue;
                const file = files[idx];
                const data = DSKLoader.readFileData(dskImage, file.name, file.ext, file.user, file.rawSize);
                if (!data) continue;
                const hdr = file.headerSize || 0;
                const fileData = (hdr && data.length >= hdr) ? data.slice(hdr, hdr + file.size) : data.slice(0, file.size);
                result.push({
                    name: file.name.trimEnd(),
                    ext: file.ext ? file.ext.trimEnd() : '',
                    type: hdr ? file.plus3Type : 3,
                    addr: file.loadAddress || 0,
                    autostart: file.autostart,
                    varsOffset: file.plus3Type === 0 ? (file.varsOffset ?? null) : null,
                    rawData: fileData
                });
            }
        } else if (panel.fileType === 'zip') {
            const zipFiles = panel.parsedFile.files || [];
            for (const idx of sorted) {
                if (idx < 0 || idx >= zipFiles.length) continue;
                const zipEntry = zipFiles[idx];
                if (!zipEntry) continue;
                const entryExt = zipEntry.name.split('.').pop().toLowerCase();
                const entryData = new Uint8Array(zipEntry.data);

                if (entryExt === 'tap' || entryExt === 'tzx') {
                    // Parse TAP/TZX blocks and extract header+data pairs
                    const tmpPanel = { blocks: [], selection: new Set(), expandedBlock: -1, parsedFile: { type: entryExt, nonStandardBlocks: [] } };
                    if (entryExt === 'tzx') editorImportTzxData(tmpPanel, entryData);
                    else editorImportTapData(tmpPanel, entryData);
                    for (let i = 0; i < tmpPanel.blocks.length; i++) {
                        const block = tmpPanel.blocks[i];
                        if (block.blockType === 'header' && i + 1 < tmpPanel.blocks.length && tmpPanel.blocks[i + 1].blockType === 'data') {
                            const dataBlock = tmpPanel.blocks[i + 1];
                            const rawData = dataBlock.data.slice(1, dataBlock.data.length - 1);
                            result.push({
                                name: block.name || 'untitled',
                                ext: '',
                                type: block.headerType,
                                addr: block.headerType === 3 ? (block.startAddress || 0) : 0,
                                autostart: block.headerType === 0 ? block.autostart : null,
                                varsOffset: block.headerType === 0 ? (block.varsOffset ?? null) : null,
                                rawData: rawData
                            });
                            i++; // skip data block
                        } else if (block.blockType === 'data') {
                            result.push({
                                name: 'data',
                                ext: '',
                                type: 3,
                                addr: 0,
                                autostart: null,
                                rawData: block.data.slice(1, block.data.length - 1)
                            });
                        }
                    }
                } else if (entryExt === 'trd') {
                    // Parse TRD disk and extract files
                    for (let i = 0; i < 128; i++) {
                        const entryOffset = i * 16;
                        if (entryData[entryOffset] === 0) break;
                        if (entryData[entryOffset] === 1) continue; // deleted
                        const name = String.fromCharCode(...entryData.slice(entryOffset, entryOffset + 8));
                        const fext = String.fromCharCode(entryData[entryOffset + 8]);
                        const startAddr = entryData[entryOffset + 9] | (entryData[entryOffset + 10] << 8);
                        const length = entryData[entryOffset + 11] | (entryData[entryOffset + 12] << 8);
                        const sectors = entryData[entryOffset + 13];
                        const startSector = entryData[entryOffset + 14];
                        const startTrack = entryData[entryOffset + 15];
                        const fileOffset = (startTrack * 16 + startSector) * 256;
                        const fileData = entryData.slice(fileOffset, fileOffset + length);
                        result.push({
                            name: name.replace(/\s+$/, ''),
                            ext: fext,
                            type: fext === 'B' ? 0 : 3,
                            addr: startAddr,
                            autostart: null,
                            rawData: fileData
                        });
                    }
                } else if (entryExt === 'scl') {
                    // Parse SCL and extract files
                    const sig = String.fromCharCode(...entryData.slice(0, 8));
                    if (sig === 'SINCLAIR') {
                        const fileCount = entryData[8];
                        let offset = 9;
                        const sclFiles = [];
                        for (let i = 0; i < fileCount; i++) {
                            const name = String.fromCharCode(...entryData.slice(offset, offset + 8));
                            const fext = String.fromCharCode(entryData[offset + 8]);
                            const startAddr = entryData[offset + 9] | (entryData[offset + 10] << 8);
                            const length = entryData[offset + 11] | (entryData[offset + 12] << 8);
                            const sectors = entryData[offset + 13];
                            sclFiles.push({ name, ext: fext, startAddr, length, sectors });
                            offset += 14;
                        }
                        for (const f of sclFiles) {
                            const fileData = entryData.slice(offset, offset + f.length);
                            result.push({
                                name: f.name.replace(/\s+$/, ''),
                                ext: f.ext,
                                type: f.ext === 'B' ? 0 : 3,
                                addr: f.startAddr,
                                autostart: null,
                                rawData: fileData
                            });
                            offset += f.sectors * 256;
                        }
                    }
                } else if (entryExt === 'mgt' || (entryExt === 'img' && (entryData.length === 819200 || entryData.length === 409600))) {
                    // Parse MGT and extract files
                    const mgtFiles = MGTLoader.listFiles(entryData);
                    for (const f of mgtFiles) {
                        const fileData = MGTLoader.extractFile(entryData, f);
                        const isBASIC = f.type === 1;
                        result.push({
                            name: f.name.replace(/\s+$/, ''),
                            ext: f.typeName.substring(0, 1).toUpperCase(),
                            type: isBASIC ? 0 : 3,
                            addr: isBASIC ? 0 : (f.startAddress || 0),
                            autostart: f.autostart,
                            rawData: fileData.slice(0, f.length)
                        });
                    }
                } else if (entryExt === 'mdr') {
                    // Parse MDR and extract files
                    const mdrFiles = MDRLoader.listFiles(entryData);
                    for (const f of mdrFiles) {
                        const fileData = MDRLoader.extractFile(entryData, f);
                        result.push({
                            name: f.name.replace(/\s+$/, ''),
                            ext: f.isPrint ? 'P' : 'F',
                            type: 3,
                            addr: 0,
                            autostart: null,
                            rawData: fileData.slice(0, f.length)
                        });
                    }
                } else if (entryExt === 'dsk') {
                    // Parse DSK and extract files
                    try {
                        const dskImg = DSKLoader.parse(entryData);
                        let dskFiles = [];
                        try { dskFiles = DSKLoader.listFiles(dskImg); } catch (e) { /* non-CP/M */ }
                        for (const file of dskFiles) {
                            const data = DSKLoader.readFileData(dskImg, file.name, file.ext, file.user, file.rawSize);
                            if (!data) continue;
                            const hdr = file.headerSize || 0;
                            const fileData = (hdr && data.length >= hdr) ? data.slice(hdr, hdr + file.size) : data.slice(0, file.size);
                            result.push({
                                name: file.name.trimEnd(),
                                ext: file.ext ? file.ext.trimEnd() : '',
                                type: hdr ? file.plus3Type : 3,
                                addr: file.loadAddress || 0,
                                autostart: file.autostart,
                                rawData: fileData
                            });
                        }
                    } catch (e) { /* invalid DSK */ }
                }
            }
        } else if (isSnapshotType(panel.fileType)) {
            for (const idx of sorted) {
                if (idx < 0 || !panel.snapshotEntries || idx >= panel.snapshotEntries.length) continue;
                const e = panel.snapshotEntries[idx];
                if (!e.data) continue;
                result.push({
                    name: e.name.replace(/\s+/g, '_'),
                    ext: e.ext,
                    type: e.tapType,
                    addr: e.tapType === 3 ? e.addr : 0,
                    autostart: e.autostart,
                    rawData: new Uint8Array(e.data)
                });
            }
        }
        return result;
    }

    function convertFileForPanel(srcFile, srcType, dstType) {
        if (srcType === dstType || (srcType === 'scl' && dstType === 'trd') || (srcType === 'trd' && dstType === 'scl')
            || (srcType === 'tap' && dstType === 'tzx') || (srcType === 'tzx' && dstType === 'tap')
            || (srcType === 'opd' && dstType === 'opd')) {
            return { ...srcFile };
        }
        // Snapshot destination: raw data passthrough — matching is done in addConvertedFile
        if (isSnapshotType(dstType)) return { ...srcFile };
        const f = { ...srcFile };

        if (dstType === 'trd' || dstType === 'scl') {
            f.name = (f.name + '        ').substring(0, 8).replace(/\s+$/, '') || 'untitled';
            // Map +3DOS/TAP/MGT extensions to TR-DOS single-char conventions
            if (f.ext && f.ext.length > 1) {
                const el = f.ext.toUpperCase();
                if (el === 'BAS') f.ext = 'B';
                else if (el === 'BIN') f.ext = 'C';
                else if (el === 'DAT') f.ext = 'D';
                else if (el === 'SEQ') f.ext = '#';
                else f.ext = f.type === 0 ? 'B' : 'C';
            }
            if (!f.ext || f.ext.length === 0) {
                f.ext = f.type === 0 ? 'B' : 'C';
            }
        } else if (dstType === 'mgt') {
            f.name = (f.name + '          ').substring(0, 10).replace(/\s+$/, '') || 'untitled';
            // Map to MGT type: ext B→1(BASIC), C→4(CODE), D→2(Num Array)
            if (!f.ext || f.ext.length === 0) {
                f.ext = f.type === 0 ? 'B' : 'C';
            }
        } else if (dstType === 'mdr') {
            f.name = (f.name + '          ').substring(0, 10).replace(/\s+$/, '') || 'untitled';
            // MDR files are either File or Data — map ext
            if (!f.ext || f.ext.length === 0) {
                f.ext = 'F';
            } else if (f.ext === 'B' || f.ext === 'C' || f.ext === 'D') {
                f.ext = 'F';
            }
        } else if (dstType === 'opd') {
            f.name = (f.name + '          ').substring(0, 10).replace(/\s+$/, '') || 'untitled';
            // Map to Opus type: B→0(BASIC), C→3(CODE)
            if (!f.ext || f.ext.length === 0) {
                f.ext = f.type === 0 ? 'B' : 'C';
            }
            // Ensure type is set from ext
            if (f.type === undefined) {
                f.type = f.ext === 'B' ? 0 : 3;
            }
        } else if (dstType === 'didaktik') {
            f.name = (f.name + '          ').substring(0, 10).replace(/\s+$/, '') || 'untitled';
            if (f.type === undefined) f.type = f.ext === 'B' ? 0 : 3;
        } else if (isTapOrTzx(dstType)) {
            f.name = (f.name + '          ').substring(0, 10).replace(/\s+$/, '') || 'untitled';
            // Map ext to TAP type if not already set from source
            if (srcType === 'trd' || srcType === 'scl' || srcType === 'mgt' || srcType === 'mdr' || srcType === 'opd' || isSnapshotType(srcType)) {
                f.type = f.ext === 'B' ? 0 : 3;
            } else if (srcType === 'dsk' && f.type === undefined) {
                const el = (f.ext || '').toUpperCase();
                f.type = el === 'BAS' ? 0 : 3;
            }
        } else if (dstType === 'dsk') {
            f.name = (f.name + '        ').substring(0, 8).replace(/\s+$/, '') || 'untitled';
            // Map TR-DOS/MGT/MDR single-char extensions to +3DOS conventions
            if (srcType === 'trd' || srcType === 'scl' || srcType === 'mgt' || srcType === 'mdr' || srcType === 'opd' || isSnapshotType(srcType)) {
                if (f.ext === 'B') f.ext = 'BAS';
                else if (f.ext === 'C') f.ext = 'BIN';
                else if (f.ext === 'D') f.ext = 'DAT';
                else if (f.ext === '#') f.ext = 'SEQ';
            }
            if (!f.ext || f.ext.length === 0) {
                f.ext = f.type === 0 ? 'BAS' : 'BIN';
            }
        }

        return f;
    }

    // Write carried slack (file.slack) into a freshly-added disk-model entry's
    // last-sector padding. entry.data is already padded to the destination's
    // sectors*256, so writing at offset entry.length and truncating the source
    // slack to the remaining room implements the "cut to the target's slack" rule
    // (excess source slack is discarded; a larger target slack stays zero-filled).
    function applyKeptSlack(entry, file) {
        if (!entry || !file || !file.slack || !file.slack.length) return;
        if (!entry.data || typeof entry.length !== 'number') return;
        const room = entry.data.length - entry.length;
        if (room <= 0) return;
        entry.data.set(file.slack.subarray(0, room), entry.length);
    }

    function addConvertedFile(panel, file) {
        if (isTapOrTzx(panel.fileType)) {
            editorAddFileBlocks(panel, file.rawData, file.name, file.type, file.addr, file.autostart, null, undefined, file.varsOffset);
            return null;
        } else if (panel.fileType === 'trd' || panel.fileType === 'scl') {
            const err = diskEditorAddFile(panel, file.rawData, file.name, file.ext || 'C', file.addr, addMetaFromDescriptor(file));
            if (!err) applyKeptSlack(panel.diskFiles[panel.diskFiles.length - 1], file);
            return err;
        } else if (panel.fileType === 'mgt') {
            // Map ext to MGT type: B→1(BASIC), C→4(CODE), D→2(Num Array)
            const mgtTypeMap = { 'B': 1, 'C': 4, 'D': 2, '#': 10 };
            const mgtType = mgtTypeMap[file.ext] || (file.type === 0 ? 1 : 4);
            return diskEditorAddMgtFile(panel, file.rawData, file.name, mgtType, file.addr || 0, file.autostart, file.varsOffset);
        } else if (panel.fileType === 'mdr') {
            const isPrint = file.ext === 'P';
            // MDR files need a 9-byte Spectrum header prepended to the data
            let mdrData;
            if (isPrint) {
                mdrData = file.rawData;
            } else {
                const hdr = new Uint8Array(9);
                const ftype = (file.type !== undefined && file.type >= 0 && file.type <= 3) ? file.type : 3;
                hdr[0] = ftype;
                hdr[1] = file.rawData.length & 0xFF;
                hdr[2] = (file.rawData.length >> 8) & 0xFF;
                const addr = file.addr || 0;
                hdr[3] = addr & 0xFF;
                hdr[4] = (addr >> 8) & 0xFF;
                if (ftype === 0) {
                    // BASIC: bytes 5-6 = program length without variables (vars offset), 7-8 = autostart line
                    const progLen = (file.varsOffset != null)
                        ? Math.min(file.varsOffset, file.rawData.length) : file.rawData.length;
                    hdr[5] = progLen & 0xFF;
                    hdr[6] = (progLen >> 8) & 0xFF;
                    const auto = (file.autostart != null && file.autostart >= 0) ? file.autostart : 0x8000;
                    hdr[7] = auto & 0xFF;
                    hdr[8] = (auto >> 8) & 0xFF;
                }
                mdrData = new Uint8Array(9 + file.rawData.length);
                mdrData.set(hdr, 0);
                mdrData.set(file.rawData, 9);
            }
            return diskEditorAddMdrFile(panel, mdrData, file.name, isPrint);
        } else if (panel.fileType === 'opd') {
            return diskEditorAddOpdFile(panel, file.rawData, file.name, file.type >= 0 ? file.type : 3, file.addr, file.autostart, file.varsOffset);
        } else if (panel.fileType === 'didaktik') {
            const isBasic = (file.type === 0);
            try {
                panel.rawData = DidaktikLoader.addFile(panel.rawData, {
                    name: (file.name || 'untitled').substring(0, 10),
                    type: isBasic ? 'P' : 'B',
                    data: file.rawData,
                    startAddr: isBasic
                        ? ((file.autostart != null && file.autostart >= 0 && file.autostart < 0x8000) ? file.autostart : 0x8000)
                        : (file.addr || 0),
                    basicLength: isBasic ? (file.varsOffset != null ? file.varsOffset : file.rawData.length) : undefined
                });
                return null;
            } catch (e) {
                return e.message;
            }
        } else if (panel.fileType === 'dsk') {
            return dskEditorAddFile(panel, file.rawData, file.name, file.ext || '', file.type, file.addr, file.autostart, file.varsOffset);
        } else if (panel.fileType === 'zip') {
            // Build a minimal TAP containing this single file and add as ZIP entry
            const tapData = buildSingleFileTap(file);
            zipEditorAddFile(panel, tapData, (file.name || 'file') + '.tap');
            return null;
        } else if (isSnapshotType(panel.fileType)) {
            // Match to a selected entry in the destination, or by address+length
            const entries = panel.snapshotEntries || [];
            if (entries.length === 0) return 'No entries';
            let targetIdx = -1;
            // Use next unconsumed selected entry (set up by editorCopySelection)
            if (panel._snapCopyTargets && panel._snapCopyIdx < panel._snapCopyTargets.length) {
                targetIdx = panel._snapCopyTargets[panel._snapCopyIdx++];
            } else {
                // No selection — try address+length match
                targetIdx = entries.findIndex(e =>
                    e.addr === (file.addr || 0) && e.length === file.rawData.length);
            }
            if (targetIdx < 0 || targetIdx >= entries.length) return 'No matching entry';
            return snapshotEditorWriteEntry(panel, targetIdx, file.rawData);
        }
        return 'Unknown format';
    }

    function editorCopySelection() {
        const src = getActivePanel();
        const dstId = activePanel === 'left' ? 'right' : 'left';
        const dst = editorPanels[dstId];

        if (src.selection.size === 0) return;

        // Auto-create destination if empty
        if (!dst.fileType) {
            switch (src.fileType) {
                case 'tap': editorNewTap(dst); break;
                case 'tzx': editorNewTzx(dst); break;
                case 'trd': case 'scl': diskEditorNewTrd(dst); break;
                case 'mgt': diskEditorNewMgt(dst); break;
                case 'mdr': diskEditorNewMdr(dst); break;
                case 'opd': diskEditorNewOpd(dst); break;
                case 'dsk': dskEditorNewDsk(dst); break;
                case 'zip': zipEditorNewZip(dst); break;
                case 'didaktik': editorNewTap(dst); break; // read-only source → copy into a new TAP
                case 'sna': case 'z80': case 'szx': editorNewTap(dst); break;
            }
        }

        const files = extractFilesFromPanel(src);

        // For snapshot destinations, prepare selection-based target matching
        if (isSnapshotType(dst.fileType)) {
            dst._snapCopyTargets = [...dst.selection].sort((a, b) => a - b);
            dst._snapCopyIdx = 0;
        }

        let added = 0, errors = [];
        for (const f of files) {
            const converted = convertFileForPanel(f, src.fileType, dst.fileType);
            const err = addConvertedFile(dst, converted);
            if (err) errors.push(`${f.name}: ${err}`);
            else added++;
        }

        // Clean up snapshot copy state
        delete dst._snapCopyTargets;
        delete dst._snapCopyIdx;

        // Refresh destination rendering
        if (isSnapshotType(dst.fileType)) {
            snapshotEditorRenderEntries(dst);
        } else if (dst.fileType === 'trd' || dst.fileType === 'scl') {
            diskEditorRenderFileList(dst);
            diskEditorRefreshExplorer(dst);
        } else if (dst.fileType === 'mgt') {
            mgtEditorRenderFileList(dst);
            mgtEditorRefreshExplorer(dst);
        } else if (dst.fileType === 'mdr') {
            mdrEditorRenderFileList(dst);
            mdrEditorRefreshExplorer(dst);
        } else if (dst.fileType === 'opd') {
            opdEditorRenderFileList(dst);
            opdEditorRefreshExplorer(dst);
        } else if (dst.fileType === 'didaktik') {
            didaktikEditorRefresh(dst);
        } else if (dst.fileType === 'dsk') {
            dskEditorRefreshState(dst);
            dskEditorRenderFileList(dst);
        } else if (isTapOrTzx(dst.fileType)) {
            editorRenderBlockList(dst);
            syncPanelToExplorer(dst);
        } else if (dst.fileType === 'zip') {
            zipEditorRenderFileList(dst);
            syncPanelToExplorer(dst);
        }

        const statusMsg = errors.length > 0
            ? `Copied ${added}, ${errors.length} failed`
            : `Copied ${added} file${added !== 1 ? 's' : ''}`;
        dst.dom.statusSpan.textContent = statusMsg;
    }

    // ========== Panel file list click handler (delegated) ==========

    function handlePanelFileListClick(panel, e) {
        const bootLink = e.target.closest('.explorer-boot-disasm-link');
        if (bootLink) {
            document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
            explorerDisasmSource.value = 'boot';
            explorerDisasmAddr.value = 'FE10';
            explorerDisasmLen.value = 496;
            explorerRenderDisasm();
            return;
        }

        const isDisk = panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd' || panel.fileType === 'didaktik';
        const isDsk = panel.fileType === 'dsk';
        const isZip = panel.fileType === 'zip';
        const isSnap = isSnapshotType(panel.fileType);

        // Handle OPD Apply button
        const opdApplyBtn = e.target.closest('[data-action="opd-apply"]');
        if (opdApplyBtn) {
            const idx = parseInt(opdApplyBtn.dataset.idx);
            opdEditorApplyInlineEdit(panel, idx);
            return;
        }

        // Handle Didaktik Apply button
        const didaktikApplyBtn = e.target.closest('[data-action="didaktik-apply"]');
        if (didaktikApplyBtn) {
            const idx = parseInt(didaktikApplyBtn.dataset.idx);
            didaktikEditorApplyInlineEdit(panel, idx);
            return;
        }

        // Handle MDR Apply button
        const mdrApplyBtn = e.target.closest('[data-action="mdr-apply"]');
        if (mdrApplyBtn) {
            const idx = parseInt(mdrApplyBtn.dataset.idx);
            mdrEditorApplyInlineEdit(panel, idx);
            return;
        }

        // Handle DSK Apply button
        const dskApplyBtn = e.target.closest('[data-action="dsk-apply"]');
        if (dskApplyBtn) {
            const idx = parseInt(dskApplyBtn.dataset.idx);
            dskEditorApplyInlineEdit(panel, idx);
            return;
        }

        // Handle MGT Apply button
        const mgtApplyBtn = e.target.closest('[data-action="mgt-apply"]');
        if (mgtApplyBtn) {
            const idx = parseInt(mgtApplyBtn.dataset.idx);
            mgtEditorApplyInlineEdit(panel, idx);
            return;
        }

        // Handle disk Apply button
        const diskApplyBtn = e.target.closest('[data-action="disk-apply"]');
        if (diskApplyBtn) {
            const idx = parseInt(diskApplyBtn.dataset.idx);
            diskEditorApplyInlineEdit(panel, idx);
            return;
        }

        // Handle TAP Apply button
        const applyBtn = e.target.closest('[data-action="apply"]');
        if (applyBtn) {
            const idx = parseInt(applyBtn.dataset.idx);
            const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
            if (!editRow) return;
            const nameInput = editRow.querySelector('[data-field="name"]');
            const typeSelect = editRow.querySelector('[data-field="type"]');
            const newName = nameInput ? nameInput.value : '';
            const newType = typeSelect ? parseInt(typeSelect.value) : 3;
            let param1 = 0, param2 = 0x8000;
            if (newType === 0) {
                const autoInput = editRow.querySelector('[data-field="autostart"]');
                const autoVal = autoInput ? autoInput.value : '';
                param1 = (autoVal !== '' && !isNaN(parseInt(autoVal))) ? (parseInt(autoVal) & 0xFFFF) : 0x8000;
                param2 = panel.blocks[idx].dataLength;
            } else if (newType === 3) {
                const addrInput = editRow.querySelector('[data-field="addr"]');
                param1 = addrInput ? parseAddr(addrInput.value) || 0 : 0;
            }
            editorUpdateHeaderBlock(panel, idx, newName, newType, param1, param2);
            if (panel.fileType === 'tzx') {
                const pauseInput = editRow.querySelector('[data-field="pause"]');
                if (pauseInput) {
                    const pauseVal = parseInt(pauseInput.value) || 1000;
                    panel.blocks[idx].tzxPause = Math.max(0, Math.min(65535, pauseVal));
                    // Apply same pause to paired data block
                    if (idx + 1 < panel.blocks.length && panel.blocks[idx + 1].blockType === 'data') {
                        panel.blocks[idx + 1].tzxPause = panel.blocks[idx].tzxPause;
                    }
                }
            }
            panel.expandedBlock = -1;
            editorRenderBlockList(panel);
            return;
        }

        // Don't change selection when clicking inside inline edit inputs
        if (e.target.closest('.editor-inline-edit')) return;

        // Row click: select/multi-select + double-click detection
        const row = e.target.closest('.editor-block-row');
        if (row) {
            // Handle disk label row double-click
            if ((isDisk || isDsk) && row.dataset.labelRow) {
                const now = Date.now();
                if (panel.lastClickIdx === -2 && now - panel.lastClickTime < 400) {
                    panel.lastClickIdx = -1;
                    panel.lastClickTime = 0;
                    panel.expandedBlock = panel.expandedBlock === -2 ? -1 : -2;
                    editorRenderBlockList(panel);
                    return;
                }
                panel.lastClickIdx = -2;
                panel.lastClickTime = now;
                return;
            }

            const idx = parseInt(row.dataset.blockIdx);
            const maxIdx = isSnap ? (panel.snapshotEntries || []).length :
                           isDisk ? panel.diskFiles.length :
                           isDsk ? (panel.parsedFile.files || []).length :
                           isZip ? (panel.parsedFile.files || []).length :
                           panel.blocks.length;
            if (isNaN(idx) || idx < 0 || idx >= maxIdx) return;
            const now = Date.now();
            if (panel.lastClickIdx === idx && now - panel.lastClickTime < 400) {
                panel.lastClickIdx = -1;
                panel.lastClickTime = 0;
                if (isZip || isSnap) {
                    // ZIP/snapshot rows don't have inline edit — just ignore double-click
                    return;
                }
                if (isDisk || isDsk) {
                    panel.expandedBlock = panel.expandedBlock === idx ? -1 : idx;
                    editorRenderBlockList(panel);
                } else if (panel.blocks[idx].blockType === 'header') {
                    panel.expandedBlock = panel.expandedBlock === idx ? -1 : idx;
                    editorRenderBlockList(panel);
                }
                return;
            }
            panel.lastClickIdx = idx;
            panel.lastClickTime = now;
            editorSelectBlock(panel, idx, e.ctrlKey || e.metaKey, e.shiftKey);
        }
    }

    // Wire delegated click handlers for both panels
    editorPanels.left.dom.fileList.addEventListener('click', (e) => {
        activatePanel('left');
        handlePanelFileListClick(editorPanels.left, e);
    });
    editorPanels.right.dom.fileList.addEventListener('click', (e) => {
        activatePanel('right');
        handlePanelFileListClick(editorPanels.right, e);
    });

    // Panel header click to activate
    document.getElementById('editorPanels').addEventListener('mousedown', (e) => {
        const panelEl = e.target.closest('.editor-panel');
        if (panelEl) activatePanel(panelEl.dataset.panel);
    });

    // Ctrl+A select all in active editor panel (Edit subtab must be visible)
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.key !== 'a') return;
        // Don't intercept when focus is inside a text input or textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        // Only when Edit subtab is active
        const editTab = document.querySelector('.explorer-subtab[data-subtab="edit"]');
        if (!editTab || !editTab.classList.contains('active')) return;
        // Only when the explorer panel is visible
        const explorerPanel = document.getElementById('tools-explorer');
        if (!explorerPanel || explorerPanel.offsetParent === null) return;
        e.preventDefault();
        editorSelectAll(getActivePanel());
    });

    // ========== Shared Toolbar Button Handlers ==========

    editorNewFormat.addEventListener('change', () => {
        const panel = getActivePanel();
        const fmt = editorNewFormat.value;
        editorNewFormat.selectedIndex = 0; // reset to "New" placeholder
        switch (fmt) {
            case 'tap': editorNewTap(panel); break;
            case 'tzx': editorNewTzx(panel); break;
            case 'trd': diskEditorNewTrd(panel); break;
            case 'scl': diskEditorNewTrd(panel); panel.fileType = 'scl'; panel.fileName = 'new.scl'; panel.parsedFile.type = 'scl'; updatePanelHeader(panel); break;
            case 'mgt': diskEditorNewMgt(panel); break;
            case 'mdr': diskEditorNewMdr(panel); break;
            case 'opd': diskEditorNewOpd(panel, 1); break;
            case 'opd-ds': diskEditorNewOpd(panel, 2); break;
            case 'd40': diskEditorNewDidaktik(panel, 'd40'); break;
            case 'd80': diskEditorNewDidaktik(panel, 'd80'); break;
            case 'zip': zipEditorNewZip(panel); break;
            default:
                if (fmt.startsWith('dsk-')) {
                    dskEditorNewDsk(panel, fmt.slice(4));
                }
                break;
        }
    });

    btnEditorAddFile.addEventListener('click', () => {
        dialogTargetPanel = activePanel;
        editorPanelFileInput.click();
    });

    // Add one file to the active container with metadata auto-derived from its
    // filename / Hobeta header — the dialog-free path used when several files are
    // selected at once. Mirrors the prefill defaults of the single-file dialog.
    // Returns null on success or an error string (prefixed with the filename).
    function editorAutoAddOneFile(panel, rawBytes, fileName) {
        if (panel.fileType === 'zip') {
            const zext = fileName.split('.').pop().toLowerCase();
            const supported = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'img', 'mdr', 'dsk'];
            if (!supported.includes(zext)) return `${fileName}: unsupported container type`;
            zipEditorAddFile(panel, rawBytes, fileName);
            return null;
        }

        // Universal Hobeta recognition: strip the 17-byte header and adopt its
        // name / type / start address (mirrors the single-file handler).
        const inputExt = fileName.split('.').pop().toLowerCase();
        const hobetaFile = isHobetaExt(inputExt) ? parseHobeta(rawBytes) : null;
        const data = hobetaFile ? hobetaFile.data : rawBytes;
        const programLength = (hobetaFile && hobetaFile.programLength != null) ? hobetaFile.programLength : null;
        const hobName = hobetaFile ? hobetaFile.name.replace(/\s+$/, '') : fileName.replace(/\.[^.]+$/, '');
        const addr = hobetaFile ? hobetaFile.startAddress : 0x8000;
        const ext = hobetaFile ? hobetaFile.ext : 'C';
        const tag = (e) => e ? `${fileName}: ${e}` : null;

        if (panel.fileType === 'trd' || panel.fileType === 'scl') {
            if (data.length > 65280) return `${fileName}: too large (max 65,280 bytes)`;
            const basicInfo = (ext === 'B' && programLength != null) ? { varsOffset: programLength } : null;
            return tag(diskEditorAddFile(panel, data, hobName.substring(0, 8), ext, addr, basicInfo));
        }
        if (panel.fileType === 'mgt') {
            const mgtTypeMap = { 'B': 1, 'C': 4, 'D': 2, '#': 10 };
            return tag(diskEditorAddMgtFile(panel, data, hobName.substring(0, 10), mgtTypeMap[ext] || 4, addr));
        }
        if (panel.fileType === 'mdr') {
            return tag(diskEditorAddMdrFile(panel, data, hobName.substring(0, 10), false));
        }
        if (panel.fileType === 'opd') {
            return tag(diskEditorAddOpdFile(panel, data, hobName.substring(0, 10), ext === 'B' ? 0 : 3, addr, 0));
        }
        if (panel.fileType === 'didaktik') {
            try { didaktikEditorAddFile(panel, data, hobName.substring(0, 10), ext, addr); return null; }
            catch (err) { return `${fileName}: ${err.message}`; }
        }
        if (panel.fileType === 'dsk') {
            const hobToDsk = { B: ['0', 'BAS'], C: ['3', 'BIN'], D: ['1', 'DAT'], '#': ['3', 'SEQ'] };
            const dmap = hobetaFile ? (hobToDsk[hobetaFile.ext] || ['3', 'BIN']) : null;
            const dskExt = dmap ? dmap[1] : (fileName.includes('.') ? fileName.split('.').pop().substring(0, 3) : '');
            return tag(dskEditorAddFile(panel, data, hobName.substring(0, 8), dskExt, dmap ? parseInt(dmap[0]) : 3, addr, ''));
        }
        // TAP/TZX (panel made into a TAP up front if it was empty)
        if (data.length > 65533) return `${fileName}: too large (max 65,533 bytes)`;
        const hobToTap = { B: 0, C: 3, D: 1, '#': 3 };
        const type = hobetaFile ? (hobToTap[hobetaFile.ext] ?? 3) : 3;
        const pause = panel.fileType === 'tzx' ? 1000 : undefined;
        const varsOffset = (type === 0 && programLength != null) ? programLength : undefined;
        editorAddFileBlocks(panel, data, hobName.substring(0, 10), type, addr, '', 'A', pause, varsOffset);
        return null;
    }

    // Re-render the file list once after a bulk add. TAP/TZX, Didaktik and ZIP
    // adds already re-render per file, so only the disk formats need a final pass.
    function editorRefreshAfterBulkAdd(panel) {
        switch (panel.fileType) {
            case 'trd': case 'scl':
                panel.selection.clear(); panel.expandedBlock = -1;
                diskEditorRenderFileList(panel); diskEditorRefreshExplorer(panel); break;
            case 'mgt':
                panel.selection.clear(); panel.expandedBlock = -1;
                mgtEditorRenderFileList(panel); mgtEditorRefreshExplorer(panel); break;
            case 'mdr': {
                panel.selection.clear(); panel.expandedBlock = -1;
                const mdr = diskEditorBuildMdr(panel);
                panel.rawData = mdr;
                panel.parsedFile = explorerParseMDR(mdr);
                mdrEditorRenderFileList(panel); mdrEditorRefreshExplorer(panel); break;
            }
            case 'opd':
                panel.selection.clear(); panel.expandedBlock = -1;
                opdEditorRenderFileList(panel); opdEditorRefreshExplorer(panel); break;
            case 'dsk':
                panel.selection.clear(); panel.expandedBlock = -1;
                dskEditorRefreshState(panel); dskEditorRenderFileList(panel); break;
        }
    }

    // Read every selected file, add them in order, then refresh once and report a
    // summary. Files that don't fit (disk/dir full, oversized) are skipped, not fatal.
    function editorAddMultipleFiles(panel, files) {
        if (!panel.fileType) editorNewTap(panel); // empty editor → create a TAP container
        Promise.all(files.map(f => f.arrayBuffer())).then(buffers => {
            let added = 0;
            const errors = [];
            for (let i = 0; i < files.length; i++) {
                let err;
                try { err = editorAutoAddOneFile(panel, new Uint8Array(buffers[i]), files[i].name); }
                catch (ex) { err = `${files[i].name}: ${ex.message}`; }
                if (err) errors.push(err); else added++;
            }
            editorRefreshAfterBulkAdd(panel);
            if (panel === editorPanels.left) explorerRenderFileInfo(false);
            const msg = `Added ${added}/${files.length} files` + (errors.length ? ` — ${errors.length} skipped` : '');
            if (panel.dom && panel.dom.statusSpan) panel.dom.statusSpan.textContent = msg;
            if (errors.length) console.warn('Add files — skipped:\n' + errors.join('\n'));
        });
    }

    editorPanelFileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        e.target.value = '';
        if (!files.length) return;
        // Multiple files: auto-add each with metadata derived from the filename /
        // Hobeta header, no per-file dialog. A single file keeps the prefill dialog
        // so name / type / address can still be tweaked.
        if (files.length > 1) { editorAddMultipleFiles(editorPanels[dialogTargetPanel], files); return; }
        const file = files[0];
        file.arrayBuffer().then(buf => {
            const panel = editorPanels[dialogTargetPanel];
            panel.pendingFileData = new Uint8Array(buf);

            if (panel.fileType === 'zip') {
                // ZIP panel: add container files directly
                const ext = file.name.split('.').pop().toLowerCase();
                const supported = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'img', 'mdr', 'dsk'];
                if (!supported.includes(ext)) {
                    panel.dom.statusSpan.textContent = 'Only .tap/.tzx/.trd/.scl/.mgt/.img/.mdr/.dsk files';
                    panel.pendingFileData = null;
                    return;
                }
                zipEditorAddFile(panel, panel.pendingFileData, file.name);
                panel.pendingFileData = null;
                return;
            }

            // Universal Hobeta recognition: a .$X file is detected for EVERY format —
            // strip its 17-byte header so only the payload is stored, and use its
            // name / type / start address for the dialog prefills below.
            const inputExt = file.name.split('.').pop().toLowerCase();
            const hobetaFile = isHobetaExt(inputExt) ? parseHobeta(panel.pendingFileData) : null;
            if (hobetaFile) panel.pendingFileData = hobetaFile.data;
            // Stash the BASIC variables offset (program length) so the add handler can
            // record it; null for non-BASIC or non-Hobeta input.
            panel.pendingProgramLength = (hobetaFile && hobetaFile.programLength != null) ? hobetaFile.programLength : null;
            const hobName = hobetaFile ? hobetaFile.name.replace(/\s+$/, '') : file.name.replace(/\.[^.]+$/, '');
            const hobTag = hobetaFile ? ' [Hobeta]' : '';

            if (panel.fileType === 'trd' || panel.fileType === 'scl') {
                // Open disk add dialog
                const maxSize = 65280;
                const fileData = panel.pendingFileData;
                const tooLarge = fileData.length > maxSize;
                const sectors = Math.ceil(fileData.length / 256);
                const baseName = hobetaFile
                    ? hobetaFile.name.replace(/\s+$/, '').substring(0, 8)
                    : file.name.replace(/\.[^.]+$/, '').substring(0, 8);
                diskAddName.value = baseName;
                diskAddAddr.value = hobetaFile ? fmtAddr(hobetaFile.startAddress) : fmtAddr(0x8000);
                diskAddExt.value = hobetaFile ? hobetaFile.ext : 'C';
                diskAddFileInfo.textContent = `${fileData.length.toLocaleString()} bytes (${sectors} sector${sectors !== 1 ? 's' : ''})` +
                    (hobetaFile ? ' [Hobeta]' : '') +
                    (tooLarge ? ` \u2014 max ${maxSize.toLocaleString()}` : '');
                diskAddFileInfo.style.color = tooLarge ? 'var(--accent)' : '';
                btnDiskAddOk.disabled = tooLarge;
                diskAddDialog.classList.remove('hidden');
            } else if (panel.fileType === 'mgt') {
                // Open disk add dialog (reuse TRD dialog with MGT constraints)
                const maxSize = 99840; // 195 sectors × 512
                const fileData = panel.pendingFileData;
                const tooLarge = fileData.length > maxSize;
                const sectors = Math.ceil(fileData.length / 512);
                diskAddName.value = hobName.substring(0, 10);
                diskAddName.maxLength = 10;
                diskAddAddr.value = hobetaFile ? fmtAddr(hobetaFile.startAddress) : fmtAddr(0x8000);
                diskAddExt.value = hobetaFile ? hobetaFile.ext : 'C';
                diskAddFileInfo.textContent = `${fileData.length.toLocaleString()} bytes (${sectors} sector${sectors !== 1 ? 's' : ''})` +
                    hobTag + (tooLarge ? ` \u2014 max ${maxSize.toLocaleString()}` : '');
                diskAddFileInfo.style.color = tooLarge ? 'var(--accent)' : '';
                btnDiskAddOk.disabled = tooLarge;
                diskAddDialog.classList.remove('hidden');
            } else if (panel.fileType === 'mdr') {
                // MDR: add file directly (no address/type needed — all files are "File" or "Data")
                const totalSectors = panel.rawData ? MDRLoader.getSectorCount(panel.rawData) : MDRLoader.SECTOR_COUNT;
                const usedSectors = panel.diskFiles.filter(f => !f.deleted).reduce((sum, f) => sum + f.sectors, 0);
                const maxSize = (totalSectors - usedSectors) * MDRLoader.DATA_SIZE;
                const fileData = panel.pendingFileData;
                const tooLarge = fileData.length > maxSize;
                const sectors = Math.ceil(fileData.length / MDRLoader.DATA_SIZE);
                diskAddName.value = hobName.substring(0, 10);
                diskAddName.maxLength = 10;
                diskAddAddr.value = '0000';
                diskAddExt.value = 'F';
                diskAddFileInfo.textContent = `${fileData.length.toLocaleString()} bytes (${sectors} sector${sectors !== 1 ? 's' : ''})` +
                    hobTag + (tooLarge ? ` \u2014 max ${maxSize.toLocaleString()}` : '');
                diskAddFileInfo.style.color = tooLarge ? 'var(--accent)' : '';
                btnDiskAddOk.disabled = tooLarge;
                diskAddDialog.classList.remove('hidden');
            } else if (panel.fileType === 'opd') {
                // OPD: reuse disk add dialog
                const sides = OPDLoader.isDoubleSided(panel.rawData) ? 2 : 1;
                const totalSectors = (sides === 2 ? OPDLoader.DS_SIZE : OPDLoader.SS_SIZE) / OPDLoader.BYTES_PER_SECTOR;
                const maxSize = (totalSectors - OPDLoader.DATA_START_SECTOR) * OPDLoader.BYTES_PER_SECTOR;
                const fileData = panel.pendingFileData;
                const tooLarge = fileData.length > maxSize;
                const sectors = Math.ceil(fileData.length / OPDLoader.BYTES_PER_SECTOR);
                diskAddName.value = hobName.substring(0, 10);
                diskAddName.maxLength = 10;
                diskAddAddr.value = hobetaFile ? fmtAddr(hobetaFile.startAddress) : fmtAddr(0x8000);
                diskAddExt.value = hobetaFile ? hobetaFile.ext : 'C';
                diskAddFileInfo.textContent = `${fileData.length.toLocaleString()} bytes (${sectors} sector${sectors !== 1 ? 's' : ''})` +
                    hobTag + (tooLarge ? ` \u2014 max ${maxSize.toLocaleString()}` : '');
                diskAddFileInfo.style.color = tooLarge ? 'var(--accent)' : '';
                btnDiskAddOk.disabled = tooLarge;
                diskAddDialog.classList.remove('hidden');
            } else if (panel.fileType === 'didaktik') {
                // Didaktik MDOS: reuse the disk add dialog; free space is FAT-derived
                const free = DidaktikLoader._freeSectors(panel.rawData).length;
                const maxSize = free * DidaktikLoader.SECTOR_SIZE;
                const fileData = panel.pendingFileData;
                const tooLarge = fileData.length > maxSize;
                const sectors = Math.ceil(fileData.length / DidaktikLoader.SECTOR_SIZE);
                diskAddName.value = hobName.substring(0, 10);
                diskAddName.maxLength = 10;
                diskAddAddr.value = hobetaFile ? fmtAddr(hobetaFile.startAddress) : fmtAddr(0x8000);
                diskAddExt.value = hobetaFile ? hobetaFile.ext : 'C';
                diskAddFileInfo.textContent = `${fileData.length.toLocaleString()} bytes (${sectors} sector${sectors !== 1 ? 's' : ''}, ${free} free)` +
                    hobTag + (tooLarge ? ` — disk full` : '');
                diskAddFileInfo.style.color = tooLarge ? 'var(--accent)' : '';
                btnDiskAddOk.disabled = tooLarge;
                diskAddDialog.classList.remove('hidden');
            } else if (panel.fileType === 'dsk') {
                // Open DSK add dialog
                // map Hobeta TR-DOS type char → +3DOS type + 3-char extension
                const hobToDsk = { B: ['0', 'BAS'], C: ['3', 'BIN'], D: ['1', 'DAT'], '#': ['3', 'SEQ'] };
                const dmap = hobetaFile ? (hobToDsk[hobetaFile.ext] || ['3', 'BIN']) : null;
                const baseName = hobName.substring(0, 8);
                const ext = dmap ? dmap[1] : (file.name.includes('.') ? file.name.split('.').pop().substring(0, 3) : '');
                dskAddName.value = baseName;
                dskAddExt.value = ext;
                dskAddType.value = dmap ? dmap[0] : '3';
                dskAddAddr.value = hobetaFile ? fmtAddr(hobetaFile.startAddress) : fmtAddr(0x8000);
                dskAddAuto.value = '';
                dskAddAddrRow.style.display = '';
                dskAddAutoRow.style.display = 'none';
                dskAddFileInfo.textContent = `${panel.pendingFileData.length.toLocaleString()} bytes` + hobTag;
                dskAddFileInfo.style.color = '';
                btnDskAddOk.disabled = false;
                dskAddDialog.classList.remove('hidden');
            } else {
                // TAP/TZX or empty (auto-create TAP)
                if (!panel.fileType) editorNewTap(panel);
                const maxPayload = 65533;
                const tooLarge = panel.pendingFileData.length > maxPayload;
                const hobToTap = { B: '0', C: '3', D: '1', '#': '3' };
                tapAddName.value = hobName.substring(0, 10);
                tapAddFileInfo.textContent = `${panel.pendingFileData.length.toLocaleString()} bytes` + hobTag +
                    (tooLarge ? ` (max ${maxPayload.toLocaleString()})` : '');
                tapAddFileInfo.style.color = tooLarge ? 'var(--accent)' : '';
                btnTapAddOk.disabled = tooLarge;
                tapAddType.value = hobetaFile ? (hobToTap[hobetaFile.ext] || '3') : '3';
                // Show the rows that match the chosen type (mirrors the tapAddType
                // change handler). For BASIC this exposes the autostart field so a
                // start line can be entered manually — the Hobeta itself carries no
                // autostart and its format is left untouched (stays spec-compliant).
                const tt = tapAddType.value;
                tapAddNameRow.style.display = '';
                tapAddAddrRow.style.display = (tt === '3') ? '' : 'none';
                tapAddAutoRow.style.display = (tt === '0') ? '' : 'none';
                tapAddVarRow.style.display = (tt === '1' || tt === '2') ? '' : 'none';
                tapAddFlagRow.style.display = 'none';
                tapAddPauseRow.style.display = panel.fileType === 'tzx' ? '' : 'none';
                tapAddPause.value = '1000';
                tapAddAddr.value = hobetaFile ? fmtAddr(hobetaFile.startAddress) : fmtAddr(0x8000);
                tapAddAuto.value = '';
                tapAddVar.value = 'A';
                tapAddFlag.value = 'FF';
                tapAddDialog.classList.remove('hidden');
            }
        });
    });

    btnEditorSave.addEventListener('click', () => {
        const panel = getActivePanel();
        if (isSnapshotType(panel.fileType)) { snapshotEditorSave(panel); return; }
        if (panel.fileType === 'tap') editorSaveTap(panel);
        else if (panel.fileType === 'tzx') editorSaveTzx(panel);
        else if (panel.fileType === 'trd' || panel.fileType === 'scl') diskEditorSaveDisk(panel);
        else if (panel.fileType === 'mgt') diskEditorSaveMgt(panel);
        else if (panel.fileType === 'mdr') diskEditorSaveMdr(panel);
        else if (panel.fileType === 'opd') diskEditorSaveOpd(panel);
        else if (panel.fileType === 'didaktik') didaktikEditorSave(panel);
        else if (panel.fileType === 'dsk') dskEditorSaveDsk(panel);
        else if (panel.fileType === 'zip') zipEditorSaveZip(panel);
    });



    function editorMoveDispatch(dir) {
        const panel = getActivePanel();
        const t = panel.fileType;
        if (isTapOrTzx(t)) editorMoveSelection(panel, dir);
        else if (t === 'trd' || t === 'scl' || t === 'mgt' || t === 'mdr' || t === 'opd') diskEditorMoveSelection(panel, dir);
        else if (t === 'didaktik') didaktikEditorMoveSelection(panel, dir);
        else if (t === 'dsk') dskEditorMoveSelection(panel, dir);
    }
    btnEditorMoveUp.addEventListener('click', () => editorMoveDispatch(-1));
    btnEditorMoveDown.addEventListener('click', () => editorMoveDispatch(1));

    btnEditorDel.addEventListener('click', () => {
        const panel = getActivePanel();
        if (isSnapshotType(panel.fileType)) return;
        if (isTapOrTzx(panel.fileType)) editorDeleteSelection(panel);
        else if (panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr') diskEditorDeleteSelection(panel);
        else if (panel.fileType === 'opd') opdEditorDeleteSelection(panel);
        else if (panel.fileType === 'didaktik') didaktikEditorDeleteSelection(panel);
        else if (panel.fileType === 'dsk') dskEditorDeleteFiles(panel);
        else if (panel.fileType === 'zip') zipEditorDeleteFiles(panel);
    });

    btnEditorMarkDel.addEventListener('click', () => {
        const panel = getActivePanel();
        if (isTapOrTzx(panel.fileType)) editorMarkDeletedSelection(panel);
        else if (panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd') diskEditorMarkDeletedSelection(panel);
        else if (panel.fileType === 'didaktik') didaktikEditorMarkDeletedSelection(panel);
        else if (panel.fileType === 'dsk') dskEditorMarkDeletedSelection(panel);
    });

    editorExtractDisk.addEventListener('change', () => {
        const fmt = editorExtractDisk.value;
        if (!fmt) return;
        const panel = getActivePanel();
        const t = panel.fileType;
        if (isTapOrTzx(t)) editorExtractSelection(panel, fmt);
        else if (t === 'trd' || t === 'scl' || t === 'mgt' || t === 'mdr') diskEditorExtractSelection(panel, fmt);
        else if (t === 'opd') opdEditorExtractSelection(panel, fmt);
        else if (t === 'didaktik') didaktikEditorExtractSelection(panel, fmt);
        else if (t === 'dsk') dskEditorExtractFiles(panel, fmt);
        else if (t === 'zip') zipEditorExtractFiles(panel, fmt);
        else if (isSnapshotType(t)) snapshotEditorExtractSelection(panel, fmt);
        editorExtractDisk.value = '';
    });

    btnEditorCopy.addEventListener('click', () => editorCopySelection());

    if (btnEditorSplit) btnEditorSplit.addEventListener('click', () => editorSplitMonoloader(getActivePanel()));
    if (btnEditorBanner) btnEditorBanner.addEventListener('click', () => editorOpenBannerDialog(getActivePanel()));

    let tzxTurboPanel = null;
    if (btnEditorToTurbo) btnEditorToTurbo.addEventListener('click', () => {
        const panel = getActivePanel();
        if (panel.fileType !== 'tzx') return;
        const sel = editorSelectedSorted(panel).filter(i => editorBlockTurboable(panel.blocks[i]));
        if (sel.length === 0) return;
        tzxTurboPanel = panel;

        // Pre-fill from the first selected block's current timing: a turbo block shows
        // its own pulses (so the user can see what it uses); a standard block shows
        // standard ROM defaults (header pilot 8063, data 3223).
        const first = panel.blocks[sel[0]];
        const cur = editorReadTurboParams(first);
        const isHeaderBlk = first.blockType === 'header' || (first.data && first.data[0] === 0x00 && first.data.length === 19);
        const vals = cur || {
            pilot: 2168, sync1: 667, sync2: 735, zero: 855, one: 1710,
            pilotLen: isHeaderBlk ? 8063 : 3223, usedBits: 8,
            pause: (first.tzxPause != null ? first.tzxPause : 1000)
        };
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        setVal('tzxTbPilot', vals.pilot); setVal('tzxTbSync1', vals.sync1); setVal('tzxTbSync2', vals.sync2);
        setVal('tzxTbZero', vals.zero); setVal('tzxTbOne', vals.one); setVal('tzxTbPilotLen', vals.pilotLen);
        setVal('tzxTbUsedBits', vals.usedBits); setVal('tzxTbPause', vals.pause);

        if (tzxTurboInfo) {
            const state = cur ? (editorBlockIsTurbo(first) || (first.blockType === 'nonstandard') ? 'turbo' : 'standard-timed') : 'standard';
            tzxTurboInfo.textContent = `${sel.length} block${sel.length !== 1 ? 's' : ''} selected — first is ${state}. Apply to (re)set timing.`;
        }
        tzxTurboDialog.classList.remove('hidden');
    });

    function tzxTurboReadParam(id, def, min, max) {
        const el = document.getElementById(id);
        let v = parseInt(el && el.value, 10);
        if (!Number.isFinite(v)) v = def;
        return Math.max(min, Math.min(max, v));
    }

    if (btnTzxTurboOk) btnTzxTurboOk.addEventListener('click', () => {
        const panel = tzxTurboPanel || getActivePanel();
        const p = {
            pilot:    tzxTurboReadParam('tzxTbPilot', 2168, 0, 65535),
            sync1:    tzxTurboReadParam('tzxTbSync1', 667, 0, 65535),
            sync2:    tzxTurboReadParam('tzxTbSync2', 735, 0, 65535),
            zero:     tzxTurboReadParam('tzxTbZero', 855, 0, 65535),
            one:      tzxTurboReadParam('tzxTbOne', 1710, 0, 65535),
            pilotLen: tzxTurboReadParam('tzxTbPilotLen', 3223, 0, 65535),
            usedBits: tzxTurboReadParam('tzxTbUsedBits', 8, 1, 8),
            pause:    tzxTurboReadParam('tzxTbPause', 1000, 0, 65535)
        };
        const n = editorConvertSelectionToTurbo(panel, p);
        tzxTurboDialog.classList.add('hidden');
        editorRenderBlockList(panel);
        syncPanelToExplorer(panel);
        if (panel.dom && panel.dom.statusSpan) panel.dom.statusSpan.textContent = `Applied turbo timing to ${n} block${n !== 1 ? 's' : ''}`;
    });

    if (btnTzxTurboCancel) btnTzxTurboCancel.addEventListener('click', () => tzxTurboDialog.classList.add('hidden'));

    // ========== Dialog handlers (target dialogTargetPanel) ==========

    tapAddType.addEventListener('change', () => {
        const v = tapAddType.value;
        tapAddNameRow.style.display = v === '-1' ? 'none' : '';
        tapAddAddrRow.style.display = v === '3' ? '' : 'none';
        tapAddAutoRow.style.display = v === '0' ? '' : 'none';
        tapAddVarRow.style.display = (v === '1' || v === '2') ? '' : 'none';
        tapAddFlagRow.style.display = v === '-1' ? '' : 'none';
    });

    btnTapAddOk.addEventListener('click', () => {
        const panel = editorPanels[dialogTargetPanel];
        if (!panel.pendingFileData) return;
        if (!panel.parsedFile || !isTapOrTzx(panel.parsedFile.type)) editorNewTap(panel);
        const type = parseInt(tapAddType.value);
        const pause = panel.fileType === 'tzx' ? (parseInt(tapAddPause.value) || 1000) : undefined;
        if (type === -1) {
            const flag = parseByte(tapAddFlag.value) ?? 0xFF;
            editorAddHeaderlessBlock(panel, panel.pendingFileData, flag & 0xFF, pause);
        } else {
            const name = tapAddName.value || 'untitled';
            const startAddr = parseAddr(tapAddAddr.value) || 0;
            const autostart = tapAddAuto.value;
            const varLetter = tapAddVar.value;
            // For a BASIC Hobeta the variables offset (program length) was stashed on
            // the panel; pass it so the TAP header's param2 marks where variables begin
            // (without it, param2 = total length, so the file looks like it has no vars).
            const varsOffset = (type === 0 && panel.pendingProgramLength != null) ? panel.pendingProgramLength : undefined;
            editorAddFileBlocks(panel, panel.pendingFileData, name, type, startAddr, autostart, varLetter, pause, varsOffset);
        }
        panel.pendingFileData = null;
        tapAddDialog.classList.add('hidden');
        if (panel === editorPanels.left) explorerRenderFileInfo(false);
    });

    btnTapAddCancel.addEventListener('click', () => {
        editorPanels[dialogTargetPanel].pendingFileData = null;
        tapAddDialog.classList.add('hidden');
    });

    btnDiskAddOk.addEventListener('click', () => {
        const panel = editorPanels[dialogTargetPanel];
        if (!panel.pendingFileData) return;
        const name = diskAddName.value || 'untitled';
        const ext = diskAddExt.value || 'C';
        const addr = parseAddr(diskAddAddr.value) || 0;

        if (panel.fileType === 'mgt') {
            // Map ext to MGT type: B→1(BASIC), C→4(CODE), D→2(Num Array)
            const mgtTypeMap = { 'B': 1, 'C': 4, 'D': 2, '#': 10 };
            const mgtType = mgtTypeMap[ext] || 4;
            const err = diskEditorAddMgtFile(panel, panel.pendingFileData, name, mgtType, addr);
            if (err) {
                diskAddFileInfo.textContent = err;
                diskAddFileInfo.style.color = 'var(--accent)';
                return;
            }
            panel.pendingFileData = null;
            diskAddDialog.classList.add('hidden');
            panel.selection.clear();
            panel.expandedBlock = -1;
            mgtEditorRenderFileList(panel);
            mgtEditorRefreshExplorer(panel);
        } else if (panel.fileType === 'mdr') {
            const isPrint = ext === 'P';
            const err = diskEditorAddMdrFile(panel, panel.pendingFileData, name, isPrint);
            if (err) {
                diskAddFileInfo.textContent = err;
                diskAddFileInfo.style.color = 'var(--accent)';
                return;
            }
            panel.pendingFileData = null;
            diskAddDialog.classList.add('hidden');
            panel.selection.clear();
            panel.expandedBlock = -1;
            // Rebuild MDR image from files
            const mdr = diskEditorBuildMdr(panel);
            panel.rawData = mdr;
            panel.parsedFile = explorerParseMDR(mdr);
            mdrEditorRenderFileList(panel);
            mdrEditorRefreshExplorer(panel);
        } else if (panel.fileType === 'opd') {
            const opdType = ext === 'B' ? 0 : 3;
            const err = diskEditorAddOpdFile(panel, panel.pendingFileData, name, opdType, addr, 0);
            if (err) {
                diskAddFileInfo.textContent = err;
                diskAddFileInfo.style.color = 'var(--accent)';
                return;
            }
            panel.pendingFileData = null;
            diskAddDialog.classList.add('hidden');
            panel.selection.clear();
            panel.expandedBlock = -1;
            opdEditorRenderFileList(panel);
            opdEditorRefreshExplorer(panel);
        } else if (panel.fileType === 'didaktik') {
            try {
                didaktikEditorAddFile(panel, panel.pendingFileData, name, ext, addr);
            } catch (err) {
                diskAddFileInfo.textContent = err.message;
                diskAddFileInfo.style.color = 'var(--accent)';
                return;
            }
            panel.pendingFileData = null;
            diskAddDialog.classList.add('hidden');
        } else {
            const isDisk = panel.fileType === 'trd' || panel.fileType === 'scl';
            if (!isDisk) diskEditorNewTrd(panel);
            const basicInfo = (ext === 'B' && panel.pendingProgramLength != null)
                ? { varsOffset: panel.pendingProgramLength } : null;
            const err = diskEditorAddFile(panel, panel.pendingFileData, name, ext, addr, basicInfo);
            if (err) {
                diskAddFileInfo.textContent = err;
                diskAddFileInfo.style.color = 'var(--accent)';
                return;
            }
            panel.pendingFileData = null;
            diskAddDialog.classList.add('hidden');
            panel.selection.clear();
            panel.expandedBlock = -1;
            diskEditorRenderFileList(panel);
            diskEditorRefreshExplorer(panel);
        }
    });

    btnDiskAddCancel.addEventListener('click', () => {
        editorPanels[dialogTargetPanel].pendingFileData = null;
        diskAddDialog.classList.add('hidden');
    });

    dskAddType.addEventListener('change', () => {
        const v = dskAddType.value;
        dskAddAddrRow.style.display = v === '3' ? '' : 'none';
        dskAddAutoRow.style.display = v === '0' ? '' : 'none';
    });

    btnDskAddOk.addEventListener('click', () => {
        const panel = editorPanels[dialogTargetPanel];
        if (!panel.pendingFileData) return;
        if (!panel.parsedFile || panel.parsedFile.type !== 'dsk') dskEditorNewDsk(panel);
        const name = dskAddName.value || 'untitled';
        const ext = dskAddExt.value || '';
        const type = parseInt(dskAddType.value);
        const addr = parseAddr(dskAddAddr.value) || 0;
        const autostart = dskAddAuto.value;
        const err = dskEditorAddFile(panel, panel.pendingFileData, name, ext, type, addr, autostart);
        if (err) {
            dskAddFileInfo.textContent = err;
            dskAddFileInfo.style.color = 'var(--accent)';
            return;
        }
        panel.pendingFileData = null;
        dskAddDialog.classList.add('hidden');
        panel.selection.clear();
        panel.expandedBlock = -1;
        dskEditorRefreshState(panel);
        dskEditorRenderFileList(panel);
    });

    btnDskAddCancel.addEventListener('click', () => {
        editorPanels[dialogTargetPanel].pendingFileData = null;
        dskAddDialog.classList.add('hidden');
    });

    // Auto-render edit tab when switched to
    const editSubtabBtn = document.querySelector('.explorer-subtab[data-subtab="edit"]');
    if (editSubtabBtn) {
        editSubtabBtn.addEventListener('click', () => {
            editorRenderBlockList(editorPanels.left);
            editorRenderBlockList(editorPanels.right);
            editorUpdateToolbar();
        });
    }

    // Auto-render disk map tab when switched to
    const diskmapSubtabBtn = document.querySelector('.explorer-subtab[data-subtab="diskmap"]');
    if (diskmapSubtabBtn) {
        diskmapSubtabBtn.addEventListener('click', () => {
            explorerRenderDiskMap();
        });
    }

    // Disk Map view toggle (Grid / Disk)
    document.querySelectorAll('.diskmap-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.diskmap-view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            diskmapCurrentView = btn.dataset.view;
            if (diskmapCurrentView === 'grid') {
                diskmapGridContainer.style.display = '';
                diskmapDiskContainer.style.display = 'none';
            } else {
                diskmapGridContainer.style.display = 'none';
                diskmapDiskContainer.style.display = '';
            }
        });
    });

    // Disk Map grid hover
    diskmapGridContainer.addEventListener('mousemove', (e) => {
        const cell = e.target.closest('.diskmap-cell');
        if (!cell || cell.dataset.sec === '-1') {
            diskmapInfo.textContent = '';
            diskmapApplyHighlight(-1);
            return;
        }
        const cyl = parseInt(cell.dataset.cyl);
        const head = parseInt(cell.dataset.head);
        const secIdx = parseInt(cell.dataset.sec);
        const sec = diskmapGetSectorInfo(cyl, head, secIdx);
        diskmapInfo.textContent = diskmapFormatInfo(sec, cyl, head);
        if (sec && sec.fileIndex >= 0) {
            diskmapApplyHighlight(sec.fileIndex);
        } else {
            diskmapApplyHighlight(-1);
        }
    });

    diskmapGridContainer.addEventListener('mouseleave', () => {
        diskmapInfo.textContent = '';
        diskmapApplyHighlight(-1);
    });

    // Disk Map grid click — navigate to hex dump
    diskmapGridContainer.addEventListener('click', (e) => {
        const cell = e.target.closest('.diskmap-cell');
        if (!cell || cell.dataset.sec === '-1') return;
        const cyl = parseInt(cell.dataset.cyl);
        const head = parseInt(cell.dataset.head);
        const secIdx = parseInt(cell.dataset.sec);
        if (diskmapGetSectorInfo(cyl, head, secIdx)) {
            diskmapNavigateToSector(cyl, head, secIdx);
        }
    });

    // Disk Map canvas hover/click
    diskmapCanvas.addEventListener('mousemove', (e) => {
        if (!diskmapSectorMap) return;
        const hit = diskmapCanvasHitTest(e);
        if (hit) {
            const sec = diskmapGetSectorInfo(hit.cyl, hit.head, hit.secIdx);
            diskmapInfo.textContent = diskmapFormatInfo(sec, hit.cyl, hit.head);
            if (sec && sec.fileIndex >= 0) {
                diskmapApplyHighlight(sec.fileIndex);
            } else {
                diskmapApplyHighlight(-1);
            }
        } else {
            diskmapInfo.textContent = '';
            diskmapApplyHighlight(-1);
        }
    });

    diskmapCanvas.addEventListener('mouseleave', () => {
        diskmapInfo.textContent = '';
        diskmapApplyHighlight(-1);
    });

    diskmapCanvas.addEventListener('click', (e) => {
        if (!diskmapSectorMap) return;
        const hit = diskmapCanvasHitTest(e);
        if (hit && diskmapGetSectorInfo(hit.cyl, hit.head, hit.secIdx)) {
            diskmapNavigateToSector(hit.cyl, hit.head, hit.secIdx);
        }
    });

    function diskmapCanvasHitTest(e) {
        if (!diskmapSectorMap) return null;
        const { numCylinders, numSides, tracks } = diskmapSectorMap;
        const rect = diskmapCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const diskSize = Math.min(380, Math.max(200, numCylinders * 4 + 80));

        for (let side = 0; side < numSides; side++) {
            const cx = numSides > 1 ? (side * (diskSize + 20) + diskSize / 2) : diskSize / 2;
            const cy = diskSize / 2;
            const outerRadius = diskSize / 2 - 4;
            const innerRadius = outerRadius * 0.2;
            const ringWidth = (outerRadius - innerRadius) / numCylinders;

            const dx = mx - cx;
            const dy = my - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < innerRadius * 0.6 || dist > outerRadius) continue;

            // Determine cylinder
            const cyl = Math.floor((outerRadius - dist) / ringWidth);
            if (cyl < 0 || cyl >= numCylinders) continue;

            // Determine sector by angle
            let angle = Math.atan2(dy, dx) + Math.PI / 2; // offset by -PI/2 to match draw start
            if (angle < 0) angle += 2 * Math.PI;

            const sideData = tracks[cyl].sides[side];
            if (!sideData || sideData.sectors.length === 0) continue;

            const numSec = sideData.sectors.length;
            const gapAngle = 0.02;
            const arcAngle = (2 * Math.PI - numSec * gapAngle) / numSec;
            const totalArc = arcAngle + gapAngle;

            const secIdx = Math.floor(angle / totalArc);
            if (secIdx >= 0 && secIdx < numSec) {
                // Check we're within the arc (not in the gap)
                const withinArc = angle - secIdx * totalArc;
                if (withinArc <= arcAngle) {
                    return { cyl, head: side, secIdx };
                }
            }
        }
        return null;
    }

    // Disk Map legend click — toggle file highlight
    diskmapLegend.addEventListener('click', (e) => {
        const item = e.target.closest('.diskmap-legend-item');
        if (!item) return;
        const fileIdx = item.dataset.file !== undefined ? parseInt(item.dataset.file) : -1;
        if (fileIdx < 0) return; // Don't toggle system legend items
        if (diskmapHighlightFile === fileIdx) {
            diskmapApplyHighlight(-1);
        } else {
            diskmapApplyHighlight(fileIdx);
        }
    });

    /**
     * Load raw file data into Explorer programmatically
     * @param {Uint8Array} data - Raw file bytes
     * @param {string} filename - File name with extension
     */
    async function loadData(data, filename) {
        explorerData = new Uint8Array(data);
        explorerFileName.textContent = filename;
        explorerFileSize.textContent = `(${explorerData.length.toLocaleString()} bytes)`;

        const ext = filename.split('.').pop().toLowerCase();
        explorerFileType = ext;

        await explorerParseFile(filename, ext);

        explorerBasicOutput.innerHTML = '<div class="explorer-empty">Select a BASIC program source</div>';
        explorerDisasmOutput.innerHTML = '<div class="explorer-empty">Select a source to disassemble</div>';
        explorerHexOutput.innerHTML = '';
        explorerTextOutput.innerHTML = '<span class="explorer-empty">Select a source and click View</span>';
        diskmapSectorMap = null;

        explorerRenderFileInfo();
        document.querySelector('.explorer-subtab[data-subtab="info"]').click();
    }

    // The info panel is rendered text like the other views, so it goes stale when
    // the switch is thrown. Redrawn in place -- autoSwitchTab false, or changing a
    // setting would yank the user onto the Info tab.
    onNumberBaseChange(() => {
        if (explorerParsed) explorerRenderFileInfo(false);
    });

    return { loadData };

} // end of initExplorer