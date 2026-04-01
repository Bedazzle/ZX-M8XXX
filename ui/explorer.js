// explorer.js — File analysis tool (extracted from index.html)
import { hex8, hex16, escapeHtml } from '../core/utils.js';
import {
    SLOT1_START,
    SCREEN_SIZE, SCREEN_BITMAP_SIZE, SCREEN_ATTR_SIZE,
    SCREEN_WIDTH, SCREEN_HEIGHT
} from '../core/constants.js';
import { MGTLoader, MDRLoader, OPDLoader } from '../core/loaders.js';
function isFlowBreak(mnemonic) {
    const mn = mnemonic.replace(/<[^>]+>/g, '').toUpperCase();
    return mn.startsWith('JP') || mn.startsWith('JR') ||
           mn.startsWith('RET') || mn.startsWith('DJNZ') ||
           mn.startsWith('RST') || mn.startsWith('CALL') ||
           mn === 'HALT';
}

export function initExplorer({ DSKLoader, Disassembler, SZXLoader, RZXLoader, ZipLoader, pako, getPalette, getRomLabels }) {
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

    // Explorer state
    let explorerData = null;         // Raw file data
    let explorerParsed = null;       // Parsed file structure
    let explorerFileType = null;     // 'tap', 'sna', 'z80', 'trd', 'scl', 'zip'
    let explorerBlocks = [];         // Parsed blocks/files
    let explorerZipFiles = [];       // Files from ZIP archive
    let explorerZipParentName = null; // Store parent ZIP name for drill-down

    // Preview canvas elements
    const explorerPreviewContainer = document.getElementById('explorerPreviewContainer');
    const explorerPreviewCanvas = document.getElementById('explorerPreviewCanvas');
    const explorerPreviewLabel = document.getElementById('explorerPreviewLabel');
    const explorerPreviewCtx = explorerPreviewCanvas.getContext('2d');

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

    // Preview rendering functions
    function explorerUpdatePreview(data, blockData = null) {
        if (!data) {
            explorerPreviewContainer.style.display = 'none';
            return;
        }

        const len = data.length;
        let previewType = null;
        let label = '';

        // Detect preview type by size
        if (len === SCREEN_SIZE) {
            previewType = 'scr';
            label = 'Screen (6912 bytes)';
        } else if (len === SCREEN_BITMAP_SIZE) {
            previewType = 'mono_full';
            label = 'Bitmap (6144 bytes)';
        } else if (len === 4096) {
            previewType = 'mono_2_3';
            label = 'Bitmap 2/3 (4096 bytes)';
        } else if (len === 2048) {
            previewType = 'mono_1_3';
            label = 'Bitmap 1/3 (2048 bytes)';
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
            explorerPreviewContainer.style.display = 'none';
            return;
        }

        // Show preview
        explorerPreviewContainer.style.display = 'flex';
        explorerPreviewLabel.textContent = label;

        // Render based on type
        switch (previewType) {
            case 'scr':
                explorerRenderSCR(data);
                break;
            case 'mono_full':
                explorerRenderMono(data, 3);
                break;
            case 'mono_2_3':
                explorerRenderMono(data, 2);
                break;
            case 'mono_1_3':
                explorerRenderMono(data, 1);
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
    }

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
        // Render two screens side by side for 128K
        explorerPreviewCanvas.width = 520;  // 256 + 8 gap + 256
        explorerPreviewCanvas.height = SCREEN_HEIGHT;
        explorerPreviewContainer.style.display = 'flex';
        explorerPreviewLabel.textContent = `128K Screens (Bank 5 / Bank 7) - Active: ${activeScreen}`;

        const imageData = explorerPreviewCtx.createImageData(520, SCREEN_HEIGHT);
        const pixels = imageData.data;

        // Fill with dark background
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i] = 32; pixels[i + 1] = 32; pixels[i + 2] = 48; pixels[i + 3] = 255;
        }

        // Render screen 5 (left)
        if (screen5) {
            explorerRenderSCRToImageData(pixels, 520, screen5, 0);
        }

        // Render screen 7 (right, offset by 264 pixels)
        if (screen7) {
            explorerRenderSCRToImageData(pixels, 520, screen7, 264);
        }

        explorerPreviewCtx.putImageData(imageData, 0, 0);

        // Draw border around active screen
        explorerPreviewCtx.strokeStyle = '#0f0';
        explorerPreviewCtx.lineWidth = 2;
        if (activeScreen === 5) {
            explorerPreviewCtx.strokeRect(1, 1, 254, 190);
        } else {
            explorerPreviewCtx.strokeRect(265, 1, 254, 190);
        }
    }

    function explorerRenderSCRToImageData(pixels, canvasWidth, data, xOffset) {
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
                        const y = yOffset + row * 8 + line;

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

            // Detect file type
            const ext = file.name.split('.').pop().toLowerCase();
            explorerFileType = ext;

            // Parse file
            await explorerParseFile(file.name, ext);

            // Clear all sub-tab outputs (prevent stale content from previous file)
            explorerBasicOutput.innerHTML = '<div class="explorer-empty">Select a BASIC program source</div>';
            explorerDisasmOutput.innerHTML = '<div class="explorer-empty">Select a source to disassemble</div>';
            explorerHexOutput.innerHTML = '';

            // Check if Edit tab is active with an editor-supported format
            const activeSubtab = document.querySelector('.explorer-subtab.active');
            const editorFormats = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'mdr', 'dsk', 'opd', 'opu', 'zip'];
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
            case 'img':
                explorerParsed = explorerParseMGT(explorerData);
                break;
            case 'mdr':
                explorerParsed = explorerParseMDR(explorerData);
                break;
            case 'opd':
                explorerParsed = explorerParseOPD(explorerData);
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
        const editorFormats = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'mdr', 'dsk', 'opd', 'opu'];
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
                        blockLen = 18 + (data[offset + 15] | (data[offset + 16] << 8) | (data[offset + 17] << 16));
                        blockInfo.dataLength = blockLen - 18;
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
                    blockLen = 8 + (data[offset + 5] | (data[offset + 6] << 8) | (data[offset + 7] << 16));
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
            const startAddr = data[entryOffset + 9] | (data[entryOffset + 10] << 8);
            const length = data[entryOffset + 11] | (data[entryOffset + 12] << 8);
            const sectors = data[entryOffset + 13];
            const startSector = data[entryOffset + 14];
            const startTrack = data[entryOffset + 15];

            files.push({
                name: name,
                ext: ext,
                startAddress: startAddr,
                length: length,
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
            const startAddr = data[offset + 9] | (data[offset + 10] << 8);
            const length = data[offset + 11] | (data[offset + 12] << 8);
            const sectors = data[offset + 13];

            files.push({
                name: name,
                ext: ext,
                startAddress: startAddr,
                length: length,
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
        const explorerFiles = files.map(f => ({
            name: f.name,
            ext: f.type === 'PRINT' ? 'P' : 'F',
            typeName: f.type,
            length: f.length,
            sectors: f.sectors,
            sectorIndices: f.sectorIndices,
            isPrint: f.isPrint,
            mdrFile: true
        }));
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

    // Hobeta file parser
    function explorerParseHobeta(data) {
        const file = parseHobeta(data);
        if (!file) {
            return { type: 'hobeta', error: 'Invalid Hobeta file (CRC mismatch)', size: data.length };
        }
        const trdTypeNames = { 'B': 'BASIC', 'C': 'Code', 'D': 'Data', '#': 'Sequential' };
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
            const supportedExts = ['tap', 'tzx', 'sna', 'z80', 'trd', 'scl', 'mgt', 'mdr', 'opd', 'opu', 'dsk'];
            const supportedFiles = files.filter(f => {
                const ext = f.name.split('.').pop().toLowerCase();
                return supportedExts.includes(ext);
            });

            if (supportedFiles.length === 1) {
                // Auto-extract and parse the single file
                const zipFile = supportedFiles[0];
                const ext = zipFile.name.split('.').pop().toLowerCase();

                explorerZipParentName = explorerFileName.textContent;
                explorerData = new Uint8Array(zipFile.data);
                explorerFileName.textContent = `${explorerZipParentName} > ${zipFile.name}`;
                explorerFileSize.textContent = `(${explorerData.length.toLocaleString()} bytes)`;
                explorerFileType = ext;

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
                    case 'trd':
                        return explorerParseTRD(explorerData);
                    case 'scl':
                        return explorerParseSCL(explorerData);
                    case 'mdr':
                        return explorerParseMDR(explorerData);
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
            <tr><th>PC</th><td>${hex16(r.PC)}</td><th>SP</th><td>${hex16(r.SP)}</td></tr>
            <tr><th>AF</th><td>${hex16(r.AF)}</td><th>AF'</th><td>${hex16(r.AFa)}</td></tr>
            <tr><th>BC</th><td>${hex16(r.BC)}</td><th>BC'</th><td>${hex16(r.BCa)}</td></tr>
            <tr><th>DE</th><td>${hex16(r.DE)}</td><th>DE'</th><td>${hex16(r.DEa)}</td></tr>
            <tr><th>HL</th><td>${hex16(r.HL)}</td><th>HL'</th><td>${hex16(r.HLa)}</td></tr>
            <tr><th>IX</th><td>${hex16(r.IX)}</td><th>IY</th><td>${hex16(r.IY)}</td></tr>
            <tr><th>I</th><td>${hex8(r.I)}</td><th>R</th><td>${hex8(r.R)}</td></tr>
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

        // Update preview - check for previewable content
        explorerUpdatePreviewForFile();
    }

    function explorerRenderGraphicsInfo() {
        const p = explorerParsed;
        return `<div class="explorer-info-section"><div class="explorer-info-header">${p.description}</div><table class="explorer-info-table"><tr><th>Type</th><td>${p.graphicsType.toUpperCase()}</td></tr><tr><th>Size</th><td>${p.size.toLocaleString()} bytes</td></tr></table></div>`;
    }

    function explorerUpdatePreviewForFile() {
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
            explorerUpdatePreview(explorerData);
            return;
        }

        // For TAP files, check each data block for screen data
        if (explorerParsed && explorerParsed.type === 'tap') {
            for (const block of explorerBlocks) {
                if (block.blockType === 'data') {
                    // Data block - check if it's a screen (minus flag and checksum bytes)
                    const contentLen = block.data.length - 2; // subtract flag byte and checksum
                    if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                        contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE) {
                        // Extract content (skip flag byte, exclude checksum)
                        const content = block.data.slice(1, block.data.length - 1);
                        explorerUpdatePreview(content);
                        return;
                    }
                }
            }
        }

        // For TZX files, check data blocks for screen data
        if (explorerParsed && explorerParsed.type === 'tzx') {
            for (const block of explorerBlocks) {
                // Check standard speed data blocks (0x10)
                if (block.id === 0x10 && block.dataLength) {
                    // Data starts at offset + 1 (block ID) + 4 (pause + length)
                    const dataStart = block.offset + 1 + 4;
                    const blockData = explorerData.slice(dataStart, dataStart + block.dataLength);
                    // Check for data block with screen-sized content
                    if (blockData.length > 0 && blockData[0] === 0xFF) {
                        const contentLen = blockData.length - 2; // subtract flag and checksum
                        if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                            contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE) {
                            const content = blockData.slice(1, blockData.length - 1);
                            explorerUpdatePreview(content);
                            return;
                        }
                    }
                }
            }
        }

        // For Hobeta files, check if the contained data is screen-sized
        if (explorerParsed && explorerParsed.type === 'hobeta' && explorerParsed.file) {
            const contentLen = explorerParsed.file.length;
            if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE) {
                explorerUpdatePreview(explorerParsed.file.data);
                return;
            }
        }

        // For SNA, extract screen from memory
        if (explorerParsed && explorerParsed.type === 'sna') {
            // SNA memory layout: 27-byte header, then RAM starting at $4000
            // Bank 5 (screen at $4000) is always first 16KB after header
            const memOffset = 27;

            if (explorerParsed.is128) {
                // 128K SNA: show both screens (bank 5 and bank 7)
                const port7FFD = explorerParsed.registers.port7FFD || 0;
                const activeScreen = (port7FFD & 0x08) ? 7 : 5;
                const pagedBank = port7FFD & 0x07;

                // Bank 5 is always at offset 27 (first 16KB after header)
                const screen5 = explorerData.slice(memOffset, memOffset + SCREEN_SIZE);

                // Bank 7 location depends on which bank is paged at $C000
                let screen7 = null;
                if (pagedBank === 7) {
                    // Bank 7 is paged in at $C000, so it's in the first 48KB
                    // Offset: 27 (header) + 32768 ($C000 - $4000) = 32795
                    const bank7Offset = 27 + 32768;
                    screen7 = explorerData.slice(bank7Offset, bank7Offset + SCREEN_SIZE);
                } else {
                    // Bank 7 is in the remaining banks after offset 49183
                    // Remaining banks are stored in order, excluding banks 2, 5, and pagedBank
                    // Order: 0,1,3,4,6,7 minus pagedBank (if not 2,5,7)
                    const remainingBanks = [0, 1, 3, 4, 6, 7].filter(b => b !== pagedBank);
                    const bank7Index = remainingBanks.indexOf(7);
                    if (bank7Index >= 0) {
                        const bank7Offset = 49183 + bank7Index * 16384;
                        if (explorerData.length >= bank7Offset + SCREEN_SIZE) {
                            screen7 = explorerData.slice(bank7Offset, bank7Offset + SCREEN_SIZE);
                        }
                    }
                }

                // Render both screens side by side
                explorerRenderDualScreen(screen5, screen7, activeScreen);
                return;
            } else {
                // 48K SNA: screen is at offset 27
                if (explorerData.length >= memOffset + SCREEN_SIZE) {
                    const screen = explorerData.slice(memOffset, memOffset + SCREEN_SIZE);
                    // Show preview with custom label for SNA
                    explorerPreviewContainer.style.display = 'flex';
                    explorerPreviewLabel.textContent = '48K Screen';
                    explorerRenderSCR(screen);
                    return;
                }
            }
        }

        // For Z80 files, extract and decompress screen
        if (explorerParsed && explorerParsed.type === 'z80') {
            const screen = explorerExtractZ80Screen(explorerData, explorerParsed);
            if (screen) {
                explorerPreviewContainer.style.display = 'flex';
                explorerPreviewLabel.textContent = `Z80 v${explorerParsed.version} Screen`;
                explorerRenderSCR(screen);
                return;
            }
        }

        // For SZX files, extract screen from RAMP chunk
        if (explorerParsed && explorerParsed.type === 'szx') {
            try {
                const screen = SZXLoader.extractScreen(explorerData);
                if (screen) {
                    explorerPreviewContainer.style.display = 'flex';
                    explorerPreviewLabel.textContent = `SZX v${explorerParsed.version} Screen`;
                    explorerRenderSCR(screen);
                    return;
                }
            } catch (e) {
                console.error('SZX screen extraction error:', e);
            }
        }

        // For RZX files, extract screen from embedded snapshot
        if (explorerParsed && explorerParsed.type === 'rzx' && explorerParsed.snapshot) {
            try {
                let screen = null;
                if (explorerParsed.snapshotType === 'sna') {
                    // SNA: screen is at offset 27
                    if (explorerParsed.snapshot.length >= 27 + SCREEN_SIZE) {
                        screen = explorerParsed.snapshot.slice(27, 27 + SCREEN_SIZE);
                    }
                } else if (explorerParsed.snapshotType === 'z80' && explorerParsed.embeddedParsed) {
                    // Use Z80 extraction
                    screen = explorerExtractZ80Screen(explorerParsed.snapshot, explorerParsed.embeddedParsed);
                }

                if (screen) {
                    explorerPreviewContainer.style.display = 'flex';
                    explorerPreviewLabel.textContent = `RZX Embedded ${explorerParsed.snapshotType.toUpperCase()} Screen`;
                    explorerRenderSCR(screen);
                    return;
                }
            } catch (e) {
                console.error('RZX screen extraction error:', e);
            }
        }

        // For MGT, look for previewable files
        if (explorerParsed && explorerParsed.type === 'mgt') {
            const previewSizes = [SCREEN_SIZE, SCREEN_BITMAP_SIZE, 4096, 2048, SCREEN_ATTR_SIZE, 9216, 11136, 12288, 18432];
            for (const file of explorerParsed.files) {
                if (previewSizes.includes(file.length)) {
                    const fileData = MGTLoader.extractFile(explorerData, file);
                    explorerUpdatePreview(fileData);
                    return;
                }
            }
        }

        // For MDR, look for previewable files
        if (explorerParsed && explorerParsed.type === 'mdr') {
            const previewSizes = [SCREEN_SIZE, SCREEN_BITMAP_SIZE, 4096, 2048, SCREEN_ATTR_SIZE, 9216, 11136, 12288, 18432];
            for (const file of explorerParsed.files) {
                if (previewSizes.includes(file.length)) {
                    const fileData = MDRLoader.extractFile(explorerData, file);
                    explorerUpdatePreview(fileData);
                    return;
                }
            }
        }

        // For TRD/SCL, look for previewable files (screens, fonts)
        if (explorerParsed && (explorerParsed.type === 'trd' || explorerParsed.type === 'scl')) {
            const previewSizes = [SCREEN_SIZE, SCREEN_BITMAP_SIZE, 4096, 2048, SCREEN_ATTR_SIZE, 9216, 11136, 12288, 18432];
            for (const file of explorerParsed.files) {
                if (previewSizes.includes(file.length)) {
                    const fileData = explorerData.slice(file.offset, file.offset + file.length);
                    explorerUpdatePreview(fileData);
                    return;
                }
            }
        }

        // For DSK, look for previewable files (check data size after +3DOS header)
        if (explorerParsed && explorerParsed.type === 'dsk') {
            const previewSizes = [SCREEN_SIZE, SCREEN_BITMAP_SIZE, 4096, 2048, SCREEN_ATTR_SIZE, 9216, 11136, 12288, 18432];
            for (const file of explorerParsed.files) {
                if (previewSizes.includes(file.size)) {
                    const fileData = DSKLoader.readFileData(
                        explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
                    );
                    if (fileData) {
                        // Skip +3DOS header for preview
                        const content = file.hasPlus3Header ? fileData.slice(128) : fileData;
                        explorerUpdatePreview(content);
                        return;
                    }
                }
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
    function explorerExtractZ80Screen(data, parsed) {
        try {
            if (parsed.version === 1) {
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

                // Determine which page contains the screen
                // Page 8 always contains the screen ($4000-$7FFF)
                // For 48K: page 8 = $4000-$7FFF
                // For 128K: pages 3-10 = RAM banks 0-7, so page 8 = bank 5 (screen)
                const screenPage = 8;

                // Parse pages
                let offset = headerEnd;
                while (offset < data.length - 3) {
                    const pageLen = data[offset] | (data[offset + 1] << 8);
                    const pageNum = data[offset + 2];
                    offset += 3;

                    if (pageNum === screenPage) {
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

    function explorerRenderTAPInfo() {
        let html = `<div class="explorer-info-section"><div class="explorer-info-header">TAP File · ${explorerBlocks.length} blocks · ${explorerData.length.toLocaleString()} bytes</div><div class="explorer-block-list">`;

        for (let i = 0; i < explorerBlocks.length; i++) {
            const block = explorerBlocks[i];
            const data = block.data;

            // Calculate checksum (XOR of all bytes except the last one, which is the stored checksum)
            let calcChecksum = 0;
            for (let j = 0; j < data.length - 1; j++) {
                calcChecksum ^= data[j];
            }
            const storedChecksum = data[data.length - 1];
            const checksumOk = calcChecksum === storedChecksum;
            const checksumClass = checksumOk ? 'checksum-ok' : 'checksum-bad';
            const checksumMark = checksumOk ? '\u2713' : '\u2717';

            if (block.blockType === 'header') {
                // Header block - different colors for different types
                let blockClass = 'explorer-block';
                if (block.headerType === 0) blockClass += ' basic-block';
                else if (block.headerType === 3) blockClass += ' code-block';
                else if (block.headerType === 1 || block.headerType === 2) blockClass += ' array-block';

                html += `<div class="${blockClass}" data-block-index="${i}">`;
                html += `<div class="explorer-block-header">${i + 1}: ${block.typeName}</div>`;
                html += `<div class="explorer-block-meta">Offset: ${block.offset} | Flag: ${block.flag} ($${hex8(block.flag)}) | Length: ${block.length} bytes | Checksum: ${hex8(storedChecksum)} <span class="${checksumClass}">${checksumMark}</span></div>`;
                html += `<div class="explorer-block-details">`;
                html += `<span class="label">Filename:</span> <span class="filename">"${block.name}"</span><br>`;
                html += `<span class="label">Data length:</span> ${block.dataLength} bytes`;

                if (block.headerType === 0) {
                    // Program
                    html += `<br><span class="label">Autostart:</span> ${block.autostart !== null ? block.autostart : 'None'}`;
                } else if (block.headerType === 3) {
                    // Bytes/CODE
                    html += `<br><span class="label">Start address:</span> <span class="value">$${hex16(block.startAddress)}</span>`;
                } else if (block.headerType === 1 || block.headerType === 2) {
                    // Number/Character array
                    html += `<br><span class="label">Variable name:</span> ${String.fromCharCode((block.param1 & 0x3F) + 0x40)}`;
                }

                html += `</div></div>`;
            } else {
                // Data block
                html += `<div class="explorer-block data-block" data-block-index="${i}">`;
                html += `<div class="explorer-block-header">${i + 1}: Data</div>`;
                html += `<div class="explorer-block-meta">Offset: ${block.offset} | Flag: ${block.flag} ($${hex8(block.flag)}) | Length: ${block.length} bytes | Checksum: ${hex8(storedChecksum)} <span class="${checksumClass}">${checksumMark}</span></div>`;
                html += `</div>`;
            }
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderTZXInfo() {
        const p = explorerParsed;
        let html = `<div class="explorer-info-section"><div class="explorer-info-header">TZX File v${p.version} · ${explorerBlocks.length} blocks · ${explorerData.length.toLocaleString()} bytes</div><div class="explorer-block-list">`;

        for (let i = 0; i < explorerBlocks.length; i++) {
            const block = explorerBlocks[i];
            let blockClass = 'explorer-block';

            // Color code different block types
            if (block.id === 0x10 || block.id === 0x11 || block.id === 0x14) {
                if (block.headerType) blockClass += ' code-block';
                else if (block.dataBlock) blockClass += ' data-block';
                else blockClass += ' data-block';
            } else if (block.id === 0x30 || block.id === 0x31 || block.id === 0x32) {
                blockClass += ' basic-block'; // Text/info blocks
            } else if (block.id === 0x20 || block.id === 0x21 || block.id === 0x22 || block.id === 0x24 || block.id === 0x25) {
                blockClass += ' array-block'; // Control blocks
            }

            html += `<div class="${blockClass}" data-block-index="${i}">`;
            html += `<div class="explorer-block-header">${i + 1}: ${block.name}</div>`;
            html += `<div class="explorer-block-meta">Offset: ${block.offset} | ID: $${hex8(block.id)} | Length: ${block.length} bytes</div>`;

            // Block-specific details
            let details = '';
            switch (block.id) {
                case 0x10: // Standard speed data
                    if (block.headerType) {
                        details = `<span class="label">Type:</span> ${block.headerType}<br>`;
                        details += `<span class="label">Filename:</span> <span class="filename">"${block.fileName}"</span><br>`;
                        details += `<span class="label">Data length:</span> ${block.fileLength} bytes`;
                        if (block.autostart !== undefined && block.autostart !== null) {
                            details += `<br><span class="label">Autostart:</span> ${block.autostart}`;
                        }
                        if (block.startAddress !== undefined) {
                            details += `<br><span class="label">Start address:</span> <span class="value">$${hex16(block.startAddress)}</span>`;
                        }
                    } else if (block.dataBlock) {
                        details = `<span class="label">Data length:</span> ${block.dataLength} bytes`;
                    } else {
                        details = `<span class="label">Data length:</span> ${block.dataLength} bytes`;
                    }
                    if (block.pause) details += `<br><span class="label">Pause:</span> ${block.pause} ms`;
                    break;

                case 0x11: // Turbo speed data
                    details = `<span class="label">Data length:</span> ${block.dataLength} bytes`;
                    break;

                case 0x12: // Pure tone
                    details = `<span class="label">Pulse length:</span> ${block.pulseLength} T-states<br>`;
                    details += `<span class="label">Pulse count:</span> ${block.pulseCount}`;
                    break;

                case 0x14: // Pure data
                    details = `<span class="label">Data length:</span> ${block.dataLength} bytes`;
                    break;

                case 0x20: // Pause/stop
                    if (block.stopTape) {
                        details = `<span class="label">Action:</span> Stop the tape`;
                    } else {
                        details = `<span class="label">Pause:</span> ${block.pause} ms`;
                    }
                    break;

                case 0x21: // Group start
                    details = `<span class="label">Group:</span> "${block.groupName}"`;
                    break;

                case 0x23: // Jump
                    details = `<span class="label">Jump:</span> ${block.jump} blocks`;
                    break;

                case 0x24: // Loop start
                    details = `<span class="label">Repetitions:</span> ${block.repetitions}`;
                    break;

                case 0x30: // Text description
                    details = `<span class="label">Text:</span> "${block.text}"`;
                    break;

                case 0x31: // Message
                    details = `<span class="label">Display time:</span> ${block.displayTime}s<br>`;
                    details += `<span class="label">Message:</span> "${block.message}"`;
                    break;

                case 0x32: // Archive info
                    if (block.archiveInfo && block.archiveInfo.length > 0) {
                        for (const info of block.archiveInfo) {
                            details += `<span class="label">${info.type}:</span> "${info.value}"<br>`;
                        }
                        details = details.slice(0, -4); // Remove trailing <br>
                    }
                    break;

                case 0x35: // Custom info
                    details = `<span class="label">Custom ID:</span> "${block.customId}"`;
                    break;
            }

            if (details) {
                html += `<div class="explorer-block-details">${details}</div>`;
            }

            if (block.error) {
                html += `<div class="explorer-block-details" style="color: var(--error);">${block.error}</div>`;
            }

            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderSNAInfo() {
        const r = explorerParsed.registers;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">SNA Snapshot (${explorerParsed.is128 ? '128K' : '48K'})</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Machine</th><td>${explorerParsed.is128 ? 'ZX Spectrum 128K' : 'ZX Spectrum 48K'}</td></tr>
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">Registers</div>
            ${explorerRenderRegsTable(r)}
        </div>`;

        return html;
    }

    function explorerRenderZ80Info() {
        const r = explorerParsed.registers;

        // Determine machine type name from hwMode
        let machineType = explorerParsed.is128 ? 'ZX Spectrum 128K' : 'ZX Spectrum 48K';
        if (explorerParsed.version >= 2) {
            const hwMode = explorerParsed.hwMode;
            if (explorerParsed.version === 2) {
                if (hwMode === 0) machineType = '48K';
                else if (hwMode === 1) machineType = '48K + IF1';
                else if (hwMode === 2) machineType = 'SamRam';
                else if (hwMode === 3) machineType = '128K';
                else if (hwMode === 4) machineType = '128K + IF1';
            } else {
                if (hwMode === 0) machineType = '48K';
                else if (hwMode === 1) machineType = '48K + IF1';
                else if (hwMode === 2) machineType = 'SamRam';
                else if (hwMode === 3) machineType = '48K + MGT';
                else if (hwMode === 4) machineType = '128K';
                else if (hwMode === 5) machineType = '128K + IF1';
                else if (hwMode === 6) machineType = '128K + MGT';
                else if (hwMode === 7) machineType = '+3';
                else if (hwMode === 9) machineType = 'Pentagon';
                else if (hwMode === 12) machineType = '+2';
                else if (hwMode === 13) machineType = '+2A';
            }
        }

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">Z80 Snapshot (v${explorerParsed.version})</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Version</th><td>${explorerParsed.version}</td></tr>
                <tr><th>Machine</th><td>${machineType} (hwMode=${explorerParsed.hwMode})</td></tr>
                <tr><th>Compressed</th><td>${explorerParsed.compressed ? 'Yes' : 'No'}</td></tr>
                ${explorerParsed.is128 ? `<tr><th>Port 7FFD</th><td>${hex8(explorerParsed.port7FFD)}</td></tr>` : ''}
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">Registers</div>
            <table class="explorer-info-table">
                <tr><th>PC</th><td>${hex16(r.PC)}</td><th>SP</th><td>${hex16(r.SP)}</td></tr>
                <tr><th>AF</th><td>${hex16(r.AF)}</td><th>AF'</th><td>${hex16(r.AFa)}</td></tr>
                <tr><th>BC</th><td>${hex16(r.BC)}</td><th>BC'</th><td>${hex16(r.BCa)}</td></tr>
                <tr><th>DE</th><td>${hex16(r.DE)}</td><th>DE'</th><td>${hex16(r.DEa)}</td></tr>
                <tr><th>HL</th><td>${hex16(r.HL)}</td><th>HL'</th><td>${hex16(r.HLa)}</td></tr>
                <tr><th>IX</th><td>${hex16(r.IX)}</td><th>IY</th><td>${hex16(r.IY)}</td></tr>
                <tr><th>I</th><td>${hex8(r.I)}</td><th>R</th><td>${hex8(r.R)}</td></tr>
                <tr><th>IM</th><td>${r.IM}</td><th>IFF1</th><td>${r.IFF1}</td></tr>
                <tr><th>Border</th><td>${r.border}</td><th>IFF2</th><td>${r.IFF2}</td></tr>
            </table>
        </div>`;

        // Show pages
        if (explorerParsed.pages && explorerParsed.pages.length > 0) {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Pages (${explorerParsed.pages.length})</div>
                <div class="explorer-block-list">`;

            for (const page of explorerParsed.pages) {
                const romClass = (page.num === 0 || page.num === 2) ? ' style="color: var(--cyan);"' : '';
                html += `<div class="explorer-block"${romClass}>
                    <span class="explorer-block-type">Page ${page.num}</span>
                    <span class="explorer-block-size">${page.desc} (${page.compLen} bytes${page.compressed ? ', compressed' : ''})</span>
                </div>`;
            }

            html += '</div></div>';
        }

        return html;
    }

    function explorerRenderSZXInfo() {
        if (explorerParsed.error) {
            return `<div class="explorer-info-section"><div class="explorer-info-header">SZX File</div><table class="explorer-info-table"><tr><th>Error</th><td>${explorerParsed.error}</td></tr></table></div>`;
        }

        const r = explorerParsed.registers;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">SZX Snapshot (v${explorerParsed.version}, ${explorerParsed.is128 ? '128K' : '48K'})</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Version</th><td>${explorerParsed.version}</td></tr>
                <tr><th>Machine</th><td>${explorerParsed.machineType} (ID: ${explorerParsed.machineId})</td></tr>
                <tr><th>Chunks</th><td>${explorerParsed.chunks.length}</td></tr>
            </table>
        </div>`;

        if (r && r.PC !== undefined) {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Registers</div>
                <table class="explorer-info-table">
                    <tr><th>PC</th><td>${hex16(r.PC)}</td><th>SP</th><td>${hex16(r.SP)}</td></tr>
                    <tr><th>AF</th><td>${hex16(r.AF)}</td><th>AF'</th><td>${hex16(r.AFa)}</td></tr>
                    <tr><th>BC</th><td>${hex16(r.BC)}</td><th>BC'</th><td>${hex16(r.BCa)}</td></tr>
                    <tr><th>DE</th><td>${hex16(r.DE)}</td><th>DE'</th><td>${hex16(r.DEa)}</td></tr>
                    <tr><th>HL</th><td>${hex16(r.HL)}</td><th>HL'</th><td>${hex16(r.HLa)}</td></tr>
                    <tr><th>IX</th><td>${hex16(r.IX)}</td><th>IY</th><td>${hex16(r.IY)}</td></tr>
                    <tr><th>I</th><td>${hex8(r.I)}</td><th>R</th><td>${hex8(r.R)}</td></tr>
                    <tr><th>IM</th><td>${r.IM}</td><th>IFF1</th><td>${r.IFF1}</td></tr>
                    <tr><th>Border</th><td>${r.border}</td><th>IFF2</th><td>${r.IFF2}</td></tr>
                </table>
            </div>`;
        }

        // Show chunk list
        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">Chunks</div>
            <div class="explorer-block-list">`;

        for (const chunk of explorerParsed.chunks) {
            html += `<div class="explorer-block">
                <span class="explorer-block-type">${chunk.id}</span>
                <span class="explorer-block-size">${chunk.size} bytes @ ${hex16(chunk.offset)}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderRZXInfo() {
        if (explorerParsed.error) {
            return `<div class="explorer-info-section"><div class="explorer-info-header">RZX File</div><table class="explorer-info-table"><tr><th>Error</th><td>${explorerParsed.error}</td></tr></table></div>`;
        }

        const stats = explorerParsed.stats;
        const creatorStr = explorerParsed.creatorInfo ?
            `${explorerParsed.creatorInfo.name} v${explorerParsed.creatorInfo.majorVersion}.${explorerParsed.creatorInfo.minorVersion}` :
            'Unknown';

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">RZX Input Recording</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Frames</th><td>${explorerParsed.totalFrames.toLocaleString()}</td></tr>
                <tr><th>Duration</th><td>${stats ? stats.durationSeconds + 's' : '?'} (@ 50fps)</td></tr>
                <tr><th>Snapshots</th><td>${explorerParsed.allSnapshots && explorerParsed.allSnapshots.length > 0
                    ? explorerParsed.allSnapshots.map((s, i) =>
                        `${s.ext.toUpperCase()}${i === 0 ? ' (start)' : i === explorerParsed.allSnapshots.length - 1 ? ' (end)' : ''} <button onclick="explorerExtractRZXSnapshot(${i})" class="small-btn">Extract</button>`
                      ).join('<br>')
                    : 'None'}</td></tr>
                <tr><th>Creator</th><td>${creatorStr}</td></tr>
            </table>
        </div>`;

        // Show frame statistics
        if (stats) {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Frame Statistics</div>
                <table class="explorer-info-table">
                    <tr><th>Total Inputs</th><td>${stats.totalInputs.toLocaleString()}</td></tr>
                    <tr><th>Total M1 Cycles</th><td>${stats.totalFetchCount.toLocaleString()}</td></tr>
                    <tr><th>Avg M1/Frame</th><td>${stats.avgFetchCount.toLocaleString()}</td></tr>
                    <tr><th>Avg Inputs/Frame</th><td>${stats.avgInputsPerFrame}</td></tr>
                    <tr><th>M1 Range</th><td>${stats.fetchRange.min} - ${stats.fetchRange.max}</td></tr>
                    <tr><th>Inputs Range</th><td>${stats.inputsRange.min} - ${stats.inputsRange.max}</td></tr>
                </table>
            </div>`;
        }

        // Show embedded snapshot registers if available
        if (explorerParsed.embeddedParsed && explorerParsed.embeddedParsed.registers) {
            const r = explorerParsed.embeddedParsed.registers;
            const snapType = explorerParsed.snapshotType.toUpperCase();
            const is128 = explorerParsed.embeddedParsed.is128;

            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Embedded ${snapType} Snapshot (${is128 ? '128K' : '48K'})</div>
                <table class="explorer-info-table">
                    <tr><th>PC</th><td>${hex16(r.PC)}</td><th>SP</th><td>${hex16(r.SP)}</td></tr>
                    <tr><th>AF</th><td>${hex16(r.AF)}</td><th>AF'</th><td>${hex16(r.AFa)}</td></tr>
                    <tr><th>BC</th><td>${hex16(r.BC)}</td><th>BC'</th><td>${hex16(r.BCa)}</td></tr>
                    <tr><th>DE</th><td>${hex16(r.DE)}</td><th>DE'</th><td>${hex16(r.DEa)}</td></tr>
                    <tr><th>HL</th><td>${hex16(r.HL)}</td><th>HL'</th><td>${hex16(r.HLa)}</td></tr>
                    <tr><th>IX</th><td>${hex16(r.IX)}</td><th>IY</th><td>${hex16(r.IY)}</td></tr>
                    <tr><th>I</th><td>${hex8(r.I)}</td><th>R</th><td>${hex8(r.R)}</td></tr>
                    <tr><th>IM</th><td>${r.IM}</td><th>Border</th><td>${r.border}</td></tr>
                </table>
            </div>`;

            // Show embedded snapshot pages
            const embPages = explorerParsed.embeddedParsed.pages;
            if (embPages && embPages.length > 0) {
                html += `<div class="explorer-info-section">
                    <div class="explorer-info-header">Snapshot Pages (${embPages.length})</div>
                    <div class="explorer-block-list">`;

                for (const page of embPages) {
                    const romClass = (page.num === 0 || page.num === 2) ? ' style="color: var(--cyan);"' : '';
                    html += `<div class="explorer-block"${romClass}>
                        <span class="explorer-block-type">Page ${page.num}</span>
                        <span class="explorer-block-size">${page.desc} (${page.compLen} bytes${page.compressed ? ', compressed' : ''})</span>
                    </div>`;
                }

                html += '</div></div>';
            }
        }

        // Show keypress timeline (human-readable)
        if (explorerParsed.frames && explorerParsed.frames.length > 0) {
            html += explorerRenderRZXKeyTimeline();
        }

        return html;
    }

    // Extract embedded snapshot from RZX and download it
    // index: which snapshot to extract (0 = first/start, default; higher = later/end)
    function explorerExtractRZXSnapshot(index = 0) {
        if (!explorerParsed || explorerParsed.type !== 'rzx') {
            alert('No RZX file loaded');
            return;
        }

        const allSnapshots = explorerParsed.allSnapshots;
        if (!allSnapshots || allSnapshots.length === 0) {
            alert('No embedded snapshots to extract');
            return;
        }

        if (index < 0 || index >= allSnapshots.length) {
            alert(`Invalid snapshot index: ${index}`);
            return;
        }

        const snapInfo = allSnapshots[index];
        const snapshot = snapInfo.data;
        const ext = snapInfo.ext || 'bin';
        const baseName = (explorerFileName.textContent || 'rzx_snapshot').replace(/\.rzx$/i, '');
        const suffix = allSnapshots.length > 1 ? `_snap${index + 1}` : '_embedded';
        const filename = baseName + suffix + '.' + ext;

        // Create download blob
        const blob = new Blob([snapshot], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

    }
    // Make globally accessible for inline onclick in generated HTML
    window.explorerExtractRZXSnapshot = explorerExtractRZXSnapshot;

    // Decode RZX input value to human-readable format
    // NOTE: RZX only stores VALUES, not ports - so for keyboard we show all possible keys per bit
    function rzxDecodeInput(value) {
        // Kempston joystick: active HIGH, values 0x01-0x1F
        // Bits: 0=Right, 1=Left, 2=Down, 3=Up, 4=Fire
        if (value > 0 && value <= 0x1F) {
            const dirs = [];
            if (value & 0x01) dirs.push('Right');
            if (value & 0x02) dirs.push('Left');
            if (value & 0x04) dirs.push('Down');
            if (value & 0x08) dirs.push('Up');
            if (value & 0x10) dirs.push('Fire');
            return 'Kemp: ' + dirs.join('+');
        }

        // Keyboard: active LOW (0=pressed in bits 0-4)
        // All 8 possible keys for each bit (one per row):
        const keysPerBit = [
            'CS/A/Q/1/0/P/Ent/Spc',   // bit 0
            'Z/S/W/2/9/O/L/SS',        // bit 1
            'X/D/E/3/8/I/K/M',         // bit 2
            'C/F/R/4/7/U/J/N',         // bit 3
            'V/G/T/5/6/Y/H/B'          // bit 4
        ];

        const pressed = [];
        for (let bit = 0; bit < 5; bit++) {
            if ((value & (1 << bit)) === 0) {
                pressed.push(keysPerBit[bit]);
            }
        }

        if (pressed.length === 0) return '(none)';
        return pressed.join(' + ');
    }

    // Current RZX decode mode (for explorer)
    let rzxDecodeMode = 'all';

    // Decode pressed bits (already normalized: 1=pressed) to key names
    function rzxDecodeBits(bits, originalValue, mode = null) {
        mode = mode || rzxDecodeMode;

        // Check if Kempston (original value was low with bits SET)
        if (originalValue > 0 && originalValue <= 0x1F) {
            const dirs = [];
            if (bits & 0x01) dirs.push('Right');
            if (bits & 0x02) dirs.push('Left');
            if (bits & 0x04) dirs.push('Down');
            if (bits & 0x08) dirs.push('Up');
            if (bits & 0x10) dirs.push('Fire');
            return dirs.length > 0 ? dirs.join('+') : '(none)';
        }

        // Keyboard decode based on mode
        const decodeModes = {
            'all': [
                'CS/A/Q/1/0/P/Ent/Spc',   // bit 0
                'Z/S/W/2/9/O/L/SS',        // bit 1
                'X/D/E/3/8/I/K/M',         // bit 2
                'C/F/R/4/7/U/J/N',         // bit 3
                'V/G/T/5/6/Y/H/B'          // bit 4
            ],
            'if2p1': [  // Interface II Port 1 (1-5): 1=Left, 2=Right, 3=Down, 4=Up, 5=Fire
                'Left',   // bit 0 = 1
                'Right',  // bit 1 = 2
                'Down',   // bit 2 = 3
                'Up',     // bit 3 = 4
                'Fire'    // bit 4 = 5
            ],
            'if2p2': [  // Interface II Port 2 (6-0): 6=Left, 7=Right, 8=Down, 9=Up, 0=Fire
                'Fire',   // bit 0 = 0
                'Up',     // bit 1 = 9
                'Down',   // bit 2 = 8
                'Right',  // bit 3 = 7
                'Left'    // bit 4 = 6
            ],
            'cursors': [  // Cursor keys: 5=Left, 6=Down, 7=Up, 8=Right, 0=Fire
                'Fire',   // bit 0 = 0
                '?',      // bit 1 = 9
                'Right',  // bit 2 = 8
                'Up',     // bit 3 = 7
                'Left/Down' // bit 4 = 5 or 6
            ],
            'qaop': [  // QAOP + Space: Q=Up, A=Down, O=Left, P=Right, Space=Fire
                'Up/Fire',   // bit 0 = Q or Space
                'Down/Left', // bit 1 = A or O
                '?',         // bit 2
                '?',         // bit 3
                'Right'      // bit 4 = P (row 0xDF)
            ],
            'kempston': [
                'Right',  // bit 0
                'Left',   // bit 1
                'Down',   // bit 2
                'Up',     // bit 3
                'Fire'    // bit 4
            ]
        };

        const keysPerBit = decodeModes[mode] || decodeModes['all'];

        const pressed = [];
        for (let bit = 0; bit < 5; bit++) {
            if (bits & (1 << bit)) {
                pressed.push(keysPerBit[bit]);
            }
        }

        return pressed.length > 0 ? pressed.join('+') : '(none)';
    }

    // Check if a value indicates "no input" (all key bits = 1)
    function rzxIsNoInput(value) {
        return (value & 0x1F) === 0x1F || value === 0;
    }

    // Extract pressed key bits (0-4) from a value, ignoring upper bits
    function rzxGetPressedBits(value) {
        if (value > 0 && value <= 0x1F) {
            return value & 0x1F;
        }
        return (~value) & 0x1F;
    }

    function explorerRenderRZXKeyTimeline() {
        if (!explorerParsed.frames || explorerParsed.frames.length === 0) return '';

        const GAP_TOLERANCE = 5;  // frames

        const events = [];
        let currentBits = 0;
        let currentValue = 0xFF;
        let keyStartFrame = 0;
        let lastActiveFrame = 0;

        for (let i = 0; i < explorerParsed.frames.length; i++) {
            const frame = explorerParsed.frames[i];

            let frameBits = 0;
            let frameValue = 0xFF;

            for (const input of frame.inputs) {
                if (!rzxIsNoInput(input)) {
                    const bits = rzxGetPressedBits(input);
                    frameBits |= bits;
                    frameValue = input;
                }
            }

            if (frameBits !== 0 && currentBits === 0) {
                currentBits = frameBits;
                currentValue = frameValue;
                keyStartFrame = i;
                lastActiveFrame = i;
            } else if (frameBits === 0 && currentBits !== 0) {
                if (i - lastActiveFrame > GAP_TOLERANCE) {
                    events.push({
                        type: 'press',
                        startFrame: keyStartFrame,
                        endFrame: lastActiveFrame,
                        duration: lastActiveFrame - keyStartFrame + 1,
                        value: currentValue,
                        bits: currentBits
                    });
                    currentBits = 0;
                }
            } else if (frameBits !== 0 && currentBits !== 0) {
                if (frameBits === currentBits) {
                    lastActiveFrame = i;
                } else {
                    events.push({
                        type: 'press',
                        startFrame: keyStartFrame,
                        endFrame: lastActiveFrame,
                        duration: lastActiveFrame - keyStartFrame + 1,
                        value: currentValue,
                        bits: currentBits
                    });
                    currentBits = frameBits;
                    currentValue = frameValue;
                    keyStartFrame = i;
                    lastActiveFrame = i;
                }
            }
        }

        if (currentBits !== 0) {
            events.push({
                type: 'press',
                startFrame: keyStartFrame,
                endFrame: explorerParsed.frames.length - 1,
                duration: explorerParsed.frames.length - keyStartFrame,
                value: currentValue,
                bits: currentBits
            });
        }

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">Keypress Timeline (${events.length} keypresses)
                <select id="rzxDecodeMode" style="margin-left: 10px; font-size: 11px;">
                    <option value="all">All keys</option>
                    <option value="if2p1">Interface II Port 1 (1-5)</option>
                    <option value="if2p2">Interface II Port 2 (6-0)</option>
                    <option value="cursors">Cursor keys (5-8)</option>
                    <option value="qaop">QAOP + Space</option>
                    <option value="kempston">Kempston</option>
                </select>
            </div>
            <div class="explorer-file-list" style="max-height: 350px; font-size: 11px;">`;

        if (events.length === 0) {
            html += '<div style="color: var(--text-secondary); padding: 8px;">No keypresses detected</div>';
        } else {
            html += `<div class="explorer-file-entry" style="padding: 2px 4px; color: var(--text-secondary); border-bottom: 1px solid var(--border-color);">
                <span style="width: 55px; display: inline-block;">Start</span>
                <span style="width: 70px; display: inline-block;">Duration</span>
                <span>Keys (possible)</span>
            </div>`;

            const maxToShow = 200;
            for (let i = 0; i < Math.min(maxToShow, events.length); i++) {
                const e = events[i];
                const startMs = Math.round(e.startFrame * 20);
                const durMs = Math.round(e.duration * 20);
                const durStr = durMs >= 1000 ? `${(durMs/1000).toFixed(1)}s` : `${durMs}ms`;

                const keysStr = rzxDecodeBits(e.bits, e.value);

                const bitNums = [];
                for (let b = 0; b < 5; b++) {
                    if (e.bits & (1 << b)) bitNums.push(b);
                }
                const bitStr = bitNums.length > 0 ? `[b${bitNums.join(',')}]` : '';

                html += `<div class="explorer-file-entry" style="padding: 2px 4px;">
                    <span style="color: var(--cyan); width: 55px; display: inline-block;">F${e.startFrame}</span>
                    <span style="color: var(--text-secondary); width: 70px; display: inline-block;">${durStr}</span>
                    <span style="color: var(--text-primary);">${keysStr}</span>
                    <span style="color: var(--text-secondary); margin-left: 8px;">${bitStr}</span>
                </div>`;
            }

            if (events.length > maxToShow) {
                html += `<div style="color: var(--text-secondary); padding: 4px;">... and ${events.length - maxToShow} more keypresses</div>`;
            }
        }

        html += '</div></div>';

        html += explorerRenderRZXFrameDetails();

        return html;
    }

    function explorerRenderRZXFrameDetails() {
        const framesWithInput = [];
        for (let i = 0; i < explorerParsed.frames.length && framesWithInput.length < 30; i++) {
            const frame = explorerParsed.frames[i];
            const hasInput = frame.inputs.some(v => !rzxIsNoInput(v));
            if (hasInput) {
                framesWithInput.push({ index: i, frame });
            }
        }

        if (framesWithInput.length === 0) return '';

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">Frames with Input (first ${framesWithInput.length})</div>
            <div class="explorer-file-list" style="max-height: 250px; font-size: 11px;">`;

        for (const { index, frame } of framesWithInput) {
            const timeMs = Math.round(index * 20);

            const activeInputs = [...new Set(frame.inputs.filter(v => !rzxIsNoInput(v)))];
            const inputStr = activeInputs.map(v => rzxDecodeInput(v)).join('; ');

            html += `<div class="explorer-file-entry" style="padding: 2px 4px;">
                <span style="color: var(--cyan); width: 50px; display: inline-block;">F${index}</span>
                <span style="color: var(--text-secondary); width: 60px; display: inline-block;">${timeMs}ms</span>
                <span style="color: var(--text-secondary); width: 70px; display: inline-block;">M1:${frame.fetchCount}</span>
                <span style="color: #f80;">${inputStr}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderTRDInfo() {
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">TRD Disk Image</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Label</th><td>${explorerParsed.diskTitle || '(none)'}</td></tr>
                <tr><th>Files</th><td>${explorerParsed.files.length}</td></tr>
                <tr><th>Free</th><td>${explorerParsed.freeSectors} sectors</td></tr>
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">File List</div>
            <div class="explorer-file-list">`;

        for (let i = 0; i < explorerParsed.files.length; i++) {
            const file = explorerParsed.files[i];
            const len = file.length;
            const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                len === 11136 || len === 12288 || len === 18432;
            const previewIcon = previewable ? '\u2B1A' : '';
            html += `<div class="explorer-file-entry" data-index="${i}">
                <span class="explorer-file-num">${i + 1}</span>
                <span class="explorer-file-type">${file.ext}</span>
                <span class="explorer-file-name">${file.name}</span>
                <span class="explorer-file-size">${file.length}</span>
                <span class="explorer-file-addr">$${hex16(file.startAddress)}</span>
                <span class="explorer-file-preview">${previewIcon}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderSCLInfo() {
        if (explorerParsed.error) {
            return `<div class="explorer-info-section">
                <div class="explorer-info-header">SCL File</div>
                <div style="color:#e74c3c">Error: ${explorerParsed.error}</div>
            </div>`;
        }

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">SCL Archive</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Files</th><td>${explorerParsed.files.length}</td></tr>
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">File List</div>
            <div class="explorer-file-list">`;

        for (let i = 0; i < explorerParsed.files.length; i++) {
            const file = explorerParsed.files[i];
            const len = file.length;
            const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                len === 11136 || len === 12288 || len === 18432;
            const previewIcon = previewable ? '\u2B1A' : '';
            html += `<div class="explorer-file-entry" data-index="${i}">
                <span class="explorer-file-num">${i + 1}</span>
                <span class="explorer-file-type">${file.ext}</span>
                <span class="explorer-file-name">${file.name}</span>
                <span class="explorer-file-size">${file.length}</span>
                <span class="explorer-file-addr">$${hex16(file.startAddress)}</span>
                <span class="explorer-file-preview">${previewIcon}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderMGTInfo() {
        const info = explorerParsed.info;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">MGT Disk Image (+D/DISCiPLE)</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Geometry</th><td>${info.tracks}T × ${info.sides}S × ${info.sectorsPerTrack}sec × ${info.bytesPerSector}B</td></tr>
                <tr><th>Files</th><td>${info.fileCount} / ${info.maxFiles}</td></tr>
                <tr><th>Free</th><td>${info.freeSectors} sectors (${(info.freeSectors * 512).toLocaleString()} bytes)</td></tr>
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">File List</div>
            <div class="explorer-file-list">`;

        for (let i = 0; i < explorerParsed.files.length; i++) {
            const file = explorerParsed.files[i];
            const len = file.length;
            const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                len === 11136 || len === 12288 || len === 18432;
            const previewIcon = previewable ? '\u2B1A' : '';
            html += `<div class="explorer-file-entry" data-index="${i}">
                <span class="explorer-file-num">${i + 1}</span>
                <span class="explorer-file-type" title="${file.typeName}">${file.typeName}</span>
                <span class="explorer-file-name">${file.name}</span>
                <span class="explorer-file-size">${file.length}</span>
                <span class="explorer-file-addr">$${hex16(file.startAddress)}</span>
                <span class="explorer-file-preview">${previewIcon}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderMDRInfo() {
        const info = explorerParsed.info;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">MDR Cartridge Image (Interface 1 Microdrive)</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Cartridge</th><td>${escapeHtml(info.cartridgeName || '(unnamed)')}</td></tr>
                <tr><th>Sectors</th><td>${info.totalSectors} (${info.usedSectors} used, ${info.freeSectors} free)</td></tr>
                <tr><th>Files</th><td>${info.fileCount}</td></tr>
                <tr><th>Write protect</th><td>${info.writeProtect ? 'Yes' : 'No'}</td></tr>
            </table>
        </div>`;

        const files = explorerParsed.files;
        if (files.length > 0) {
            html += '<div class="explorer-info-section"><div class="explorer-info-header">Files</div>';
            html += '<div class="explorer-file-list">';
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                html += `<div class="explorer-file-entry" data-index="${i}">
                    <span class="explorer-file-num">${i + 1}</span>
                    <span class="explorer-file-type" title="${f.typeName}">${f.typeName}</span>
                    <span class="explorer-file-name">${escapeHtml(f.name)}</span>
                    <span class="explorer-file-size">${f.length.toLocaleString()}</span>
                    <span class="explorer-file-addr">${f.sectors} sectors</span>
                </div>`;
            }
            html += '</div></div>';
        }

        return html;
    }

    function explorerRenderOPDInfo() {
        const info = explorerParsed.info;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">OPD Disk Image (Opus Discovery)</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Geometry</th><td>${info.tracks}T × ${info.sides}S × ${info.sectorsPerTrack}sec × ${info.bytesPerSector}B</td></tr>
                <tr><th>Capacity</th><td>${(info.totalSectors * info.bytesPerSector / 1024).toFixed(0)}KB (${info.totalSectors} sectors)</td></tr>`;
        if (info.diskLabel) {
            html += `<tr><th>Label</th><td>${escapeHtml(info.diskLabel)}</td></tr>`;
        }
        html += `<tr><th>Files</th><td>${info.fileCount}</td></tr>
                <tr><th>Used</th><td>${info.usedSectors} sectors (${(info.usedSectors * info.bytesPerSector).toLocaleString()} bytes)</td></tr>
                <tr><th>Free</th><td>${info.freeSectors} sectors (${(info.freeSectors * info.bytesPerSector).toLocaleString()} bytes)</td></tr>
            </table>
        </div>`;

        if (explorerParsed.files.length > 0) {
            html += '<div class="explorer-info-section"><div class="explorer-info-header">Files</div>';
            html += '<div class="explorer-file-list">';
            for (let i = 0; i < explorerParsed.files.length; i++) {
                const f = explorerParsed.files[i];
                const addrStr = f.type === 3 ? `$${hex16(f.startAddr)}` : '';
                html += `<div class="explorer-file-entry" data-index="${i}">
                    <span class="explorer-file-num">${i + 1}</span>
                    <span class="explorer-file-name">${escapeHtml(f.name || '(unnamed)')}</span>
                    <span class="explorer-file-type">${f.typeName}</span>
                    <span class="explorer-file-size">${(f.length || 0).toLocaleString()}</span>
                    <span class="explorer-file-addr">${addrStr}</span>
                </div>`;
            }
            html += '</div></div>';
        } else {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Files</div>
                <span class="dim">No files on disk.</span>
            </div>`;
        }

        return html;
    }

    function explorerRenderHobetaInfo() {
        if (explorerParsed.error) {
            return `<div class="explorer-info-section">
                <div class="explorer-info-header">Hobeta File</div>
                <div style="color:#e74c3c">Error: ${explorerParsed.error}</div>
            </div>`;
        }

        const f = explorerParsed.file;
        const len = f.length;
        const previewable = len === 6912 || len === 6144 || len === 4096 ||
            len === 2048 || len === 768 || len === 9216 ||
            len === 11136 || len === 12288 || len === 18432;
        const previewIcon = previewable ? ' \u2B1A' : '';
        return `<div class="explorer-info-section">
            <div class="explorer-info-header">Hobeta File</div>
            <table class="explorer-info-table">
                <tr><th>File size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Name</th><td>${f.name.replace(/\s+$/, '')}</td></tr>
                <tr><th>Extension</th><td>${f.ext} (${explorerParsed.typeName})</td></tr>
                <tr><th>Data length</th><td>${f.length.toLocaleString()} bytes</td></tr>
                <tr><th>Start address</th><td>$${hex16(f.startAddress)}</td></tr>
            </table>
        </div>`;
    }

    function explorerRenderDSKInfo() {
        if (explorerParsed.error) {
            return `<div class="explorer-info-section">
                <div class="explorer-info-header">DSK Disk Image</div>
                <div style="color:#e74c3c">Error: ${explorerParsed.error}</div>
            </div>`;
        }

        const formatType = explorerParsed.isExtended ? 'Extended CPC DSK' : 'Standard CPC DSK';
        const geometry = `${explorerParsed.numTracks} tracks, ${explorerParsed.numSides} side${explorerParsed.numSides > 1 ? 's' : ''}`;
        const spec = explorerParsed.diskSpec;

        let sectorInfo = '';
        if (explorerParsed.dskImage) {
            const t0 = explorerParsed.dskImage.getTrack(0, 0);
            if (t0 && t0.sectors.length > 0) {
                const sectorSize = t0.sectors[0].data.length;
                sectorInfo = `${t0.sectors.length} sectors/track, ${sectorSize} bytes/sector`;
            }
        }

        let specRows = '';
        if (spec) {
            specRows += `<tr><th>Block size</th><td>${spec.blockSize} bytes</td></tr>`;
            specRows += `<tr><th>Reserved</th><td>${spec.reservedTracks} track${spec.reservedTracks !== 1 ? 's' : ''}</td></tr>`;
        }

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">DSK Disk Image</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Format</th><td>${formatType}</td></tr>
                <tr><th>Geometry</th><td>${geometry}</td></tr>
                ${sectorInfo ? `<tr><th>Sectors</th><td>${sectorInfo}</td></tr>` : ''}
                ${specRows}
                <tr><th>Files</th><td>${explorerParsed.files.length}</td></tr>
            </table>
        </div>`;

        if (explorerParsed.files.length > 0) {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">File List (+3DOS / CP/M)</div>
                <div class="explorer-file-list">`;

            for (let i = 0; i < explorerParsed.files.length; i++) {
                const file = explorerParsed.files[i];
                const sizeStr = file.size.toLocaleString();

                const fullName = file.name + (file.ext ? '.' + file.ext : '');

                let typeStr = '-';
                if (file.hasPlus3Header) {
                    const typeNames = { 0: 'BASIC', 1: 'NUM', 2: 'CHR', 3: 'CODE' };
                    typeStr = typeNames[file.plus3Type] || '-';
                }

                let addrStr = '';
                if (file.plus3Type === 3 && file.loadAddress !== undefined) {
                    addrStr = '$' + hex16(file.loadAddress);
                } else if (file.plus3Type === 0 && file.autostart !== undefined && file.autostart < 32768) {
                    addrStr = 'LINE ' + file.autostart;
                }

                const len = file.size;
                const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                    len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                    len === 11136 || len === 12288 || len === 18432;
                const previewIcon = previewable ? '\u2B1A' : '';

                html += `<div class="explorer-file-entry" data-index="${i}">
                    <span class="explorer-file-num">${i + 1}</span>
                    <span class="explorer-file-type">${typeStr}</span>
                    <span class="explorer-file-name">${fullName}</span>
                    <span class="explorer-file-size">${sizeStr}</span>
                    <span class="explorer-file-addr">${addrStr}</span>
                    <span class="explorer-file-preview">${previewIcon}</span>
                </div>`;
            }

            html += '</div></div>';
        }

        return html;
    }

    function explorerRenderZIPInfo() {
        if (explorerParsed.error) {
            return `<div class="explorer-info-section">
                <div class="explorer-info-header">ZIP Archive</div>
                <div style="color:#e74c3c">Error: ${explorerParsed.error}</div>
            </div>`;
        }

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">ZIP Archive</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Files</th><td>${explorerParsed.files.length}</td></tr>
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">File List <span style="font-size:10px;color:var(--text-secondary)">(click to open)</span></div>
            <div class="explorer-block-list">`;

        for (let i = 0; i < explorerParsed.files.length; i++) {
            const file = explorerParsed.files[i];
            const ext = file.name.split('.').pop().toLowerCase();
            const supported = ['tap', 'tzx', 'sna', 'z80', 'trd', 'scl', 'mgt', 'mdr', 'dsk', 'rzx'].includes(ext);

            let extraInfo = '';
            if (ext === 'rzx' && file.data && file.data.length > 10) {
                extraInfo = ' <span style="color:var(--cyan)">[RZX]</span>';
            }

            html += `<div class="explorer-block${supported ? ' explorer-zip-file' : ''}" data-zip-index="${i}" style="${supported ? 'cursor:pointer' : 'opacity:0.5'}">
                <span class="explorer-block-num">${i + 1}</span>
                <span class="explorer-block-type">${ext.toUpperCase()}</span>
                <span class="explorer-block-name">${file.name}${extraInfo}</span>
                <span class="explorer-block-size">${file.size.toLocaleString()} bytes</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    // Handle RZX decode mode change
    explorerInfoOutput.addEventListener('change', (e) => {
        if (e.target.id === 'rzxDecodeMode') {
            rzxDecodeMode = e.target.value;
            if (explorerParsed && explorerParsed.type === 'rzx') {
                explorerInfoOutput.innerHTML = explorerRenderRZXInfo();
                const dropdown = document.getElementById('rzxDecodeMode');
                if (dropdown) dropdown.value = rzxDecodeMode;
            }
        }
    });

    // Handle clicking on ZIP file entries and TAP blocks
    explorerInfoOutput.addEventListener('click', async (e) => {
        const zipEntry = e.target.closest('.explorer-zip-file');
        if (zipEntry) {
            const idx = parseInt(zipEntry.dataset.zipIndex);
            if (isNaN(idx) || !explorerZipFiles[idx]) return;

            const zipFile = explorerZipFiles[idx];
            const ext = zipFile.name.split('.').pop().toLowerCase();

            if (!['tap', 'tzx', 'sna', 'z80', 'trd', 'scl', 'mgt', 'mdr', 'dsk', 'rzx'].includes(ext)) return;

            explorerZipParentName = explorerFileName.textContent;
            explorerData = new Uint8Array(zipFile.data);
            explorerFileName.textContent = `${explorerZipParentName} > ${zipFile.name}`;
            explorerFileSize.textContent = `(${explorerData.length.toLocaleString()} bytes)`;
            explorerFileType = ext;

            await explorerParseFile(zipFile.name, ext);

            explorerBasicOutput.innerHTML = '<div class="explorer-empty">Select a BASIC program source</div>';
            explorerDisasmOutput.innerHTML = '<div class="explorer-empty">Select a source to disassemble</div>';
            explorerHexOutput.innerHTML = '';

            explorerRenderFileInfo();
            return;
        }

        const blockEntry = e.target.closest('.explorer-block[data-block-index]');
        if (blockEntry && explorerParsed && explorerParsed.type === 'tap') {
            const idx = parseInt(blockEntry.dataset.blockIndex);
            if (isNaN(idx) || !explorerBlocks[idx]) return;

            const block = explorerBlocks[idx];

            if (block.blockType === 'data' && block.data.length > 2) {
                const content = block.data.slice(1, block.data.length - 1);
                const contentLen = content.length;

                if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                    contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                    contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                    explorerUpdatePreview(content);
                    return;
                }
            }

            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();

            if (block.blockType === 'data') {
                explorerHexSource.value = idx.toString();
            } else {
                if (idx + 1 < explorerBlocks.length && explorerBlocks[idx + 1].blockType === 'data') {
                    explorerHexSource.value = (idx + 1).toString();
                }
            }

            const dataLen = block.length;
            explorerHexLen.value = Math.min(dataLen, 65536);
            explorerHexAddr.value = '0000';

            explorerRenderHexDump();
        }

        if (blockEntry && explorerParsed && explorerParsed.type === 'tzx') {
            const idx = parseInt(blockEntry.dataset.blockIndex);
            if (isNaN(idx) || !explorerBlocks[idx]) return;

            const block = explorerBlocks[idx];

            // Only handle standard speed data blocks (0x10)
            if (block.id !== 0x10) return;

            // Screen-size data → preview
            if (block.dataBlock && block.data && block.data.length > 2) {
                const content = block.data.slice(1, block.data.length - 1);
                const contentLen = content.length;
                if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                    contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                    contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                    explorerUpdatePreview(content);
                    return;
                }
            }

            // Program header → BASIC tab
            if (block.headerTypeId === 0) {
                document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
                explorerBasicSource.value = idx.toString();
                explorerRenderBASIC();
                return;
            }

            // Bytes header → Disasm tab
            if (block.headerTypeId === 3) {
                document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
                explorerDisasmSource.value = idx.toString();
                explorerDisasmAddr.value = hex16(block.startAddress);
                explorerDisasmLen.value = Math.min(block.fileLength, 4096);
                explorerRenderDisasm();
                return;
            }

            // Data block → hex dump
            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
            if (block.dataBlock) {
                explorerHexSource.value = idx.toString();
            } else if (idx + 1 < explorerBlocks.length && explorerBlocks[idx + 1].id === 0x10 && explorerBlocks[idx + 1].dataBlock) {
                explorerHexSource.value = (idx + 1).toString();
            }
            explorerHexLen.value = Math.min(block.dataLength || block.length, 65536);
            explorerHexAddr.value = '0000';
            explorerRenderHexDump();
        }

        const trdEntry = e.target.closest('.explorer-file-entry[data-index]');
        if (trdEntry && explorerParsed && (explorerParsed.type === 'trd' || explorerParsed.type === 'scl' || explorerParsed.type === 'mgt' || explorerParsed.type === 'mdr')) {
            const idx = parseInt(trdEntry.dataset.index);
            if (isNaN(idx) || !explorerParsed.files[idx]) return;

            const file = explorerParsed.files[idx];
            const fileData = explorerParsed.type === 'mgt'
                ? MGTLoader.extractFile(explorerData, file)
                : explorerParsed.type === 'mdr'
                ? MDRLoader.extractFile(explorerData, file)
                : explorerData.slice(file.offset, file.offset + file.length);

            const contentLen = fileData.length;
            if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                explorerUpdatePreview(fileData);
                return;
            }

            if (file.ext === 'B') {
                document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
                explorerBasicSource.value = idx.toString();
                explorerRenderBASIC();
                return;
            }

            if (file.ext === 'C') {
                document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
                explorerDisasmSource.value = idx.toString();
                explorerDisasmAddr.value = hex16(file.startAddress);
                explorerDisasmLen.value = Math.min(file.length, 4096);
                explorerRenderDisasm();
                return;
            }

            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
            explorerHexSource.value = idx.toString();
            explorerHexLen.value = Math.min(file.length, 65536);
            explorerHexAddr.value = '0000';
            explorerRenderHexDump();
        }

        const opdEntry = e.target.closest('.explorer-file-entry[data-index]');
        if (opdEntry && explorerParsed && explorerParsed.type === 'opd') {
            const idx = parseInt(opdEntry.dataset.index);
            if (isNaN(idx) || !explorerParsed.files[idx]) return;

            const file = explorerParsed.files[idx];
            const fileData = OPDLoader.extractFile(explorerData, file);
            if (!fileData || fileData.length === 0) return;

            const contentLen = fileData.length;
            if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                explorerUpdatePreview(fileData);
                return;
            }

            if (file.ext === 'B') {
                document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
                explorerBasicSource.value = idx.toString();
                explorerRenderBASIC();
                return;
            }

            if (file.ext === 'C') {
                document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
                explorerDisasmSource.value = idx.toString();
                explorerDisasmAddr.value = hex16(file.startAddr);
                explorerDisasmLen.value = Math.min(file.length, 4096);
                explorerRenderDisasm();
                return;
            }

            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
            explorerHexSource.value = idx.toString();
            explorerHexLen.value = Math.min(file.length, 65536);
            explorerHexAddr.value = '0000';
            explorerRenderHexDump();
            return;
        }

        const dskEntry = e.target.closest('.explorer-file-entry[data-index]');
        if (dskEntry && explorerParsed && explorerParsed.type === 'dsk') {
            const idx = parseInt(dskEntry.dataset.index);
            if (isNaN(idx) || !explorerParsed.files[idx]) return;

            const file = explorerParsed.files[idx];

            const fileData = DSKLoader.readFileData(
                explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
            );
            if (!fileData || fileData.length === 0) return;

            const hasHeader = file.hasPlus3Header;
            const contentData = hasHeader ? fileData.slice(128) : fileData;
            const contentLen = contentData.length;

            if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                explorerUpdatePreview(contentData);
                return;
            }

            if (file.plus3Type === 0) {
                document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
                explorerBasicSource.value = idx.toString();
                explorerRenderBASIC();
                return;
            }

            if (file.plus3Type === 3 && file.loadAddress !== undefined) {
                document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
                explorerDisasmSource.value = idx.toString();
                explorerDisasmAddr.value = hex16(file.loadAddress);
                explorerDisasmLen.value = Math.min(file.size, 4096);
                explorerRenderDisasm();
                return;
            }

            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
            explorerHexSource.value = idx.toString();
            explorerHexLen.value = Math.min(file.rawSize || file.size, 65536);
            explorerHexAddr.value = '0000';
            explorerRenderHexDump();
        }
    });

    // Update source selectors based on file type
    function explorerUpdateSourceSelectors(autoSwitchTab = true) {
        const basicOpts = [];
        const disasmOpts = [];
        const hexOpts = [];
        let basicSources = [];

        if (explorerParsed.type === 'tap') {
            for (let i = 0; i < explorerBlocks.length; i++) {
                const block = explorerBlocks[i];
                if (block.blockType === 'header' && block.headerType === 0) {
                    basicOpts.push(`<option value="${i}">Block ${i + 1}: ${block.name}</option>`);
                    basicSources.push(i.toString());
                }
            }
            for (let i = 0; i < explorerBlocks.length; i++) {
                const block = explorerBlocks[i];
                if (block.blockType === 'header' && block.headerType === 3) {
                    disasmOpts.push(`<option value="${i}">Block ${i + 1}: ${block.name} @ ${hex16(block.startAddress)}</option>`);
                }
            }
            for (let i = 0; i < explorerBlocks.length; i++) {
                const block = explorerBlocks[i];
                if (block.blockType === 'data') {
                    const prevBlock = i > 0 ? explorerBlocks[i - 1] : null;
                    const name = prevBlock && prevBlock.blockType === 'header' ? prevBlock.name : `Block ${i + 1}`;
                    const addr = prevBlock && prevBlock.startAddress !== undefined ? ` @ ${hex16(prevBlock.startAddress)}` : '';
                    if (!prevBlock || prevBlock.headerType !== 3) {
                        disasmOpts.push(`<option value="data:${i}">${name} data${addr} (${block.length} bytes)</option>`);
                    }
                }
            }
            for (let i = 0; i < explorerBlocks.length; i++) {
                const block = explorerBlocks[i];
                if (block.blockType === 'data') {
                    const prevBlock = i > 0 ? explorerBlocks[i - 1] : null;
                    const name = prevBlock && prevBlock.blockType === 'header' ? prevBlock.name : `Block ${i + 1}`;
                    hexOpts.push(`<option value="${i}">${name} (${block.length} bytes)</option>`);
                }
            }
        } else if (explorerParsed.type === 'tzx') {
            // TZX standard speed blocks (0x10) — same structure as TAP
            for (let i = 0; i < explorerBlocks.length; i++) {
                const block = explorerBlocks[i];
                if (block.id === 0x10 && block.headerTypeId === 0) {
                    // Program header — BASIC source
                    basicOpts.push(`<option value="${i}">Block ${i + 1}: ${block.fileName}</option>`);
                    basicSources.push(i.toString());
                }
            }
            for (let i = 0; i < explorerBlocks.length; i++) {
                const block = explorerBlocks[i];
                if (block.id === 0x10 && block.headerTypeId === 3) {
                    // Bytes header — disasm source
                    disasmOpts.push(`<option value="${i}">Block ${i + 1}: ${block.fileName} @ ${hex16(block.startAddress)}</option>`);
                }
            }
            for (let i = 0; i < explorerBlocks.length; i++) {
                const block = explorerBlocks[i];
                if (block.id === 0x10 && block.dataBlock) {
                    // Data block — disasm + hex source
                    const prevBlock = i > 0 ? explorerBlocks[i - 1] : null;
                    const name = prevBlock && prevBlock.id === 0x10 && prevBlock.headerType ? prevBlock.fileName : `Block ${i + 1}`;
                    const addr = prevBlock && prevBlock.startAddress !== undefined ? ` @ ${hex16(prevBlock.startAddress)}` : '';
                    if (!prevBlock || prevBlock.headerTypeId !== 3) {
                        disasmOpts.push(`<option value="data:${i}">${name} data${addr} (${block.dataLength} bytes)</option>`);
                    }
                }
            }
            for (let i = 0; i < explorerBlocks.length; i++) {
                const block = explorerBlocks[i];
                if (block.id === 0x10 && block.dataBlock) {
                    const prevBlock = i > 0 ? explorerBlocks[i - 1] : null;
                    const name = prevBlock && prevBlock.id === 0x10 && prevBlock.headerType ? prevBlock.fileName : `Block ${i + 1}`;
                    hexOpts.push(`<option value="${i}">${name} (${block.dataLength} bytes)</option>`);
                }
            }
        } else if (explorerParsed.type === 'trd' || explorerParsed.type === 'scl' || explorerParsed.type === 'mgt') {
            const files = explorerParsed.files;
            const isMgt = explorerParsed.type === 'mgt';
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayName = isMgt ? `${file.name} [${file.typeName}]` : `${file.name}.${file.ext}`;
                if (file.ext === 'B') {
                    basicOpts.push(`<option value="${i}">${displayName}</option>`);
                    basicSources.push(i.toString());
                    disasmOpts.push(`<option value="basic:${i}">${displayName} (BASIC @ 5CCB)</option>`);
                } else if (file.ext === 'C') {
                    disasmOpts.push(`<option value="${i}">${displayName} @ ${hex16(file.startAddress)}</option>`);
                } else if (file.ext === 'D') {
                    disasmOpts.push(`<option value="${i}">${displayName} @ ${hex16(file.startAddress)}</option>`);
                }
                hexOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
            }
        } else if (explorerParsed.type === 'mdr') {
            const files = explorerParsed.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayName = `${file.name} [${file.typeName}]`;
                disasmOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
                hexOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
            }
        } else if (explorerParsed.type === 'opd') {
            const files = explorerParsed.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayName = `${file.name} [${file.typeName}]`;
                if (file.ext === 'B') {
                    basicOpts.push(`<option value="${i}">${displayName}</option>`);
                    basicSources.push(i.toString());
                    disasmOpts.push(`<option value="basic:${i}">${displayName} (BASIC @ 5CCB)</option>`);
                } else if (file.ext === 'C') {
                    disasmOpts.push(`<option value="${i}">${displayName} @ ${hex16(file.startAddr)} (${file.length} bytes)</option>`);
                } else {
                    disasmOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
                }
                hexOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
            }
        } else if (explorerParsed.type === 'hobeta') {
            if (!explorerParsed.error) {
                const f = explorerParsed.file;
                const trimName = f.name.replace(/\s+$/, '');
                if (f.ext === 'B') {
                    basicOpts.push(`<option value="0">${trimName}.${f.ext}</option>`);
                    basicSources.push('0');
                }
                disasmOpts.push(`<option value="0">${trimName}.${f.ext} @ ${hex16(f.startAddress)}</option>`);
                hexOpts.push(`<option value="0">${trimName}.${f.ext} (${f.length} bytes)</option>`);
            }
        } else if (explorerParsed.type === 'dsk') {
            disasmOpts.push('<option value="boot">Boot sector @ $FE10</option>');
            hexOpts.push('<option value="boot">Boot sector (512 bytes)</option>');
            const files = explorerParsed.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayName = file.name + (file.ext ? '.' + file.ext : '');
                const addrStr = file.loadAddress !== undefined ? ` @ ${hex16(file.loadAddress)}` : '';
                if (file.plus3Type === 0) {
                    basicOpts.push(`<option value="${i}">${displayName}</option>`);
                    basicSources.push(i.toString());
                }
                if (file.plus3Type === 3 || file.plus3Type === undefined) {
                    disasmOpts.push(`<option value="${i}">${displayName}${addrStr} (${file.size} bytes)</option>`);
                }
                hexOpts.push(`<option value="${i}">${displayName} (${file.size} bytes)</option>`);
            }
        } else if (explorerParsed.type === 'sna' || explorerParsed.type === 'z80') {
            disasmOpts.push('<option value="memory">Full memory</option>');
            hexOpts.push('<option value="memory">Full memory</option>');
        }

        explorerBasicSource.innerHTML = '<option value="">Select source...</option>' + basicOpts.join('');
        explorerDisasmSource.innerHTML = '<option value="">Select source...</option>' + disasmOpts.join('');
        explorerHexSource.innerHTML = '<option value="">Whole file</option>' + hexOpts.join('');

        if (basicSources.length === 1) {
            explorerBasicSource.value = basicSources[0];
            explorerRenderBASIC();
            if (autoSwitchTab) document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
        }

        if (explorerDisasmSource.options.length > 1) {
            explorerDisasmSource.selectedIndex = 1;
            explorerDisasmSource.dispatchEvent(new Event('change'));
        }

        const dataLen = explorerData ? explorerData.length : 0;
        if (dataLen > 0 && dataLen <= 4096) {
            explorerDisasmLen.value = dataLen;
        } else {
            explorerDisasmLen.value = 256;
        }
        if (dataLen > 0 && dataLen <= 65536) {
            explorerHexLen.value = dataLen;
        } else {
            explorerHexLen.value = 256;
        }
        if (explorerHexSource.options.length > 1) {
            explorerHexSource.selectedIndex = 1;
        }
    }

    btnExplorerDisasm.addEventListener('click', () => {
        explorerRenderDisasm();
    });

    explorerDisasmSource.addEventListener('change', () => {
        const source = explorerDisasmSource.value;
        if (!source) return;

        if (explorerParsed.type === 'tap') {
            if (source.startsWith('data:')) {
                const blockIdx = parseInt(source.slice(5));
                const prevBlock = blockIdx > 0 ? explorerBlocks[blockIdx - 1] : null;
                if (prevBlock && prevBlock.blockType === 'header' && prevBlock.startAddress !== undefined) {
                    explorerDisasmAddr.value = hex16(prevBlock.startAddress);
                }
            } else {
                const blockIdx = parseInt(source);
                const headerBlock = explorerBlocks[blockIdx];
                if (headerBlock && headerBlock.startAddress !== undefined) {
                    explorerDisasmAddr.value = hex16(headerBlock.startAddress);
                }
            }
        } else if (explorerParsed.type === 'tzx') {
            if (source.startsWith('data:')) {
                const blockIdx = parseInt(source.slice(5));
                const prevBlock = blockIdx > 0 ? explorerBlocks[blockIdx - 1] : null;
                if (prevBlock && prevBlock.id === 0x10 && prevBlock.startAddress !== undefined) {
                    explorerDisasmAddr.value = hex16(prevBlock.startAddress);
                }
            } else {
                const blockIdx = parseInt(source);
                const headerBlock = explorerBlocks[blockIdx];
                if (headerBlock && headerBlock.startAddress !== undefined) {
                    explorerDisasmAddr.value = hex16(headerBlock.startAddress);
                }
            }
        } else if (explorerParsed.type === 'trd' || explorerParsed.type === 'scl' || explorerParsed.type === 'mgt' || explorerParsed.type === 'mdr') {
            if (source.startsWith('basic:')) {
                explorerDisasmAddr.value = '5CCB';
            } else {
                const fileIdx = parseInt(source);
                const file = explorerParsed.files[fileIdx];
                if (file && file.startAddress !== undefined) {
                    explorerDisasmAddr.value = hex16(file.startAddress);
                }
            }
        } else if (explorerParsed.type === 'opd') {
            if (source.startsWith('basic:')) {
                explorerDisasmAddr.value = '5CCB';
            } else {
                const fileIdx = parseInt(source);
                const file = explorerParsed.files[fileIdx];
                if (file && file.startAddr !== undefined) {
                    explorerDisasmAddr.value = hex16(file.startAddr);
                }
            }
        } else if (explorerParsed.type === 'dsk') {
            if (source === 'boot') {
                explorerDisasmAddr.value = 'FE10';
            } else {
                const fileIdx = parseInt(source);
                const file = explorerParsed.files[fileIdx];
                if (file && file.loadAddress !== undefined) {
                    explorerDisasmAddr.value = hex16(file.loadAddress);
                } else {
                    explorerDisasmAddr.value = '0000';
                }
            }
        } else if (source === 'memory') {
            explorerDisasmAddr.value = '4000';
        }

        explorerRenderDisasm();
    });

    function explorerRenderDisasm() {
        const addr = parseInt(explorerDisasmAddr.value, 16) || 0;
        const len = parseInt(explorerDisasmLen.value, 10) || 256;
        const source = explorerDisasmSource.value;

        let data = null;
        let baseAddr = addr;

        if (source === 'memory' && (explorerParsed.type === 'sna' || explorerParsed.type === 'z80')) {
            data = explorerData.slice(explorerParsed.memoryOffset || 27);
            baseAddr = SLOT1_START;
        } else if (source && explorerParsed.type === 'tap') {
            if (source.startsWith('data:')) {
                const blockIdx = parseInt(source.slice(5));
                const dataBlock = explorerBlocks[blockIdx];
                if (dataBlock && dataBlock.blockType === 'data') {
                    data = dataBlock.data.slice(1, -1);
                    const prevBlock = blockIdx > 0 ? explorerBlocks[blockIdx - 1] : null;
                    if (prevBlock && prevBlock.blockType === 'header' && prevBlock.startAddress !== undefined) {
                        baseAddr = prevBlock.startAddress;
                    } else {
                        baseAddr = 0;
                    }
                }
            } else {
                const blockIdx = parseInt(source);
                const headerBlock = explorerBlocks[blockIdx];
                if (headerBlock && headerBlock.blockType === 'header' && blockIdx + 1 < explorerBlocks.length) {
                    const dataBlock = explorerBlocks[blockIdx + 1];
                    data = dataBlock.data.slice(1, -1);
                    baseAddr = headerBlock.startAddress || 0;
                    explorerDisasmAddr.value = hex16(baseAddr);
                }
            }
        } else if (source && explorerParsed.type === 'tzx') {
            if (source.startsWith('data:')) {
                const blockIdx = parseInt(source.slice(5));
                const dataBlock = explorerBlocks[blockIdx];
                if (dataBlock && dataBlock.id === 0x10 && dataBlock.dataBlock && dataBlock.data) {
                    data = dataBlock.data.slice(1, -1);
                    const prevBlock = blockIdx > 0 ? explorerBlocks[blockIdx - 1] : null;
                    if (prevBlock && prevBlock.id === 0x10 && prevBlock.startAddress !== undefined) {
                        baseAddr = prevBlock.startAddress;
                    } else {
                        baseAddr = 0;
                    }
                }
            } else {
                const blockIdx = parseInt(source);
                const headerBlock = explorerBlocks[blockIdx];
                if (headerBlock && headerBlock.id === 0x10 && headerBlock.headerTypeId === 3 && blockIdx + 1 < explorerBlocks.length) {
                    const dataBlock = explorerBlocks[blockIdx + 1];
                    if (dataBlock && dataBlock.data) {
                        data = dataBlock.data.slice(1, -1);
                        baseAddr = headerBlock.startAddress || 0;
                        explorerDisasmAddr.value = hex16(baseAddr);
                    }
                }
            }
        } else if (source && (explorerParsed.type === 'trd' || explorerParsed.type === 'scl' || explorerParsed.type === 'mgt' || explorerParsed.type === 'mdr')) {
            if (source.startsWith('basic:')) {
                const fileIdx = parseInt(source.slice(6));
                const file = explorerParsed.files[fileIdx];
                if (file) {
                    if (explorerParsed.type === 'mgt') {
                        data = MGTLoader.extractFile(explorerData, file);
                    } else if (explorerParsed.type === 'mdr') {
                        data = MDRLoader.extractFile(explorerData, file);
                    } else {
                        const fullSize = file.sectors * 256;
                        data = explorerData.slice(file.offset, file.offset + fullSize);
                    }
                    baseAddr = 0x5D3B;
                }
            } else {
                const fileIdx = parseInt(source);
                const file = explorerParsed.files[fileIdx];
                if (file) {
                    if (explorerParsed.type === 'mgt') {
                        data = MGTLoader.extractFile(explorerData, file);
                    } else if (explorerParsed.type === 'mdr') {
                        data = MDRLoader.extractFile(explorerData, file);
                    } else {
                        const fullSize = file.sectors * 256;
                        data = explorerData.slice(file.offset, file.offset + fullSize);
                    }
                    baseAddr = file.startAddress || 0;
                    explorerDisasmAddr.value = hex16(baseAddr);
                }
            }
        } else if (source && explorerParsed.type === 'opd') {
            if (source.startsWith('basic:')) {
                const fileIdx = parseInt(source.slice(6));
                const file = explorerParsed.files[fileIdx];
                if (file) {
                    data = OPDLoader.extractFile(explorerData, file);
                    baseAddr = 0x5D3B;
                }
            } else {
                const fileIdx = parseInt(source);
                const file = explorerParsed.files[fileIdx];
                if (file) {
                    data = OPDLoader.extractFile(explorerData, file);
                    baseAddr = file.startAddr || 0;
                    explorerDisasmAddr.value = hex16(baseAddr);
                }
            }
        } else if (source && explorerParsed.type === 'hobeta') {
            const f = explorerParsed.file;
            if (f) {
                data = f.data;
                baseAddr = f.startAddress;
                explorerDisasmAddr.value = hex16(baseAddr);
            }
        } else if (source && explorerParsed.type === 'dsk') {
            if (source === 'boot') {
                const bootSector = explorerParsed.dskImage.readSector(0, 0,
                    explorerParsed.diskSpec && explorerParsed.diskSpec.firstSectorId !== undefined
                        ? explorerParsed.diskSpec.firstSectorId : 1);
                if (bootSector && bootSector.length > 16) {
                    data = bootSector.slice(16);
                    baseAddr = 0xFE10;
                    explorerDisasmAddr.value = 'FE10';
                }
            } else {
                const fileIdx = parseInt(source);
                const file = explorerParsed.files[fileIdx];
                if (file) {
                    const rawData = DSKLoader.readFileData(
                        explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
                    );
                    if (rawData && file.hasPlus3Header && rawData.length > 128) {
                        data = rawData.slice(128);
                    } else {
                        data = rawData;
                    }
                    baseAddr = (file.loadAddress !== undefined) ? file.loadAddress : 0;
                    explorerDisasmAddr.value = hex16(baseAddr);
                }
            }
        } else if (!source && explorerData) {
            data = explorerData;
        }

        if (!data || data.length === 0) {
            explorerDisasmOutput.innerHTML = '<div class="explorer-empty">No data to disassemble</div>';
            return;
        }

        const fakeMemory = {
            read: (a) => {
                const offset = a - baseAddr;
                if (offset >= 0 && offset < data.length) {
                    return data[offset];
                }
                return 0;
            }
        };

        const disasm = new Disassembler(fakeMemory);

        let html = '';
        let offset = addr - baseAddr;
        const endOffset = Math.min(offset + len, data.length);

        const romLabels = getRomLabels();

        while (offset < endOffset && offset >= 0) {
            const currentAddr = baseAddr + offset;

            const result = disasm.disassemble(currentAddr);
            const instrLen = result.length || 1;
            const bytesHex = result.bytes.map(b => hex8(b)).join(' ');

            let mnemonic = result.mnemonic || '???';
            const addrMatch = mnemonic.match(/([0-9A-F]{4})h/i);
            if (addrMatch) {
                const targetAddr = parseInt(addrMatch[1], 16);
                const label = romLabels[targetAddr];
                if (label) {
                    mnemonic = mnemonic.replace(addrMatch[0], `<span class="dl">${label}</span>`);
                }
            }

            html += `<span class="da">${hex16(currentAddr)}</span>  <span class="dm">${mnemonic.padEnd(20)}</span> <span class="db">; ${bytesHex}</span>\n`;

            if (isFlowBreak(mnemonic)) {
                html += '\n';
            }

            offset += instrLen;
        }

        explorerDisasmOutput.innerHTML = html || '<div class="explorer-empty">No instructions</div>';
    }

    btnExplorerHex.addEventListener('click', () => {
        explorerRenderHexDump();
    });

    function explorerRenderHexDump() {
        const addr = parseInt(explorerHexAddr.value, 16) || 0;
        const len = parseInt(explorerHexLen.value, 10) || 256;
        const source = explorerHexSource.value;

        let data = null;
        let baseAddr = addr;

        if (source === 'memory' && (explorerParsed.type === 'sna' || explorerParsed.type === 'z80')) {
            data = explorerData.slice(explorerParsed.memoryOffset || 27);
            baseAddr = SLOT1_START;
        } else if (source && explorerParsed.type === 'tap') {
            const blockIdx = parseInt(source);
            const block = explorerBlocks[blockIdx];
            if (block && block.blockType === 'data') {
                data = block.data;
                baseAddr = 0;
            }
        } else if (source && explorerParsed.type === 'tzx') {
            const blockIdx = parseInt(source);
            const block = explorerBlocks[blockIdx];
            if (block && block.id === 0x10 && block.data) {
                data = block.data;
                baseAddr = 0;
            }
        } else if (source && (explorerParsed.type === 'trd' || explorerParsed.type === 'scl' || explorerParsed.type === 'mgt' || explorerParsed.type === 'mdr')) {
            const fileIdx = parseInt(source);
            const file = explorerParsed.files[fileIdx];
            if (file) {
                data = explorerParsed.type === 'mgt'
                    ? MGTLoader.extractFile(explorerData, file)
                    : explorerParsed.type === 'mdr'
                    ? MDRLoader.extractFile(explorerData, file)
                    : explorerData.slice(file.offset, file.offset + file.length);
                baseAddr = 0;
            }
        } else if (source && explorerParsed.type === 'opd') {
            const fileIdx = parseInt(source);
            const file = explorerParsed.files[fileIdx];
            if (file) {
                data = OPDLoader.extractFile(explorerData, file);
                baseAddr = 0;
            }
        } else if (source && explorerParsed.type === 'hobeta') {
            const f = explorerParsed.file;
            if (f) {
                data = f.data;
                baseAddr = 0;
            }
        } else if (source && explorerParsed.type === 'dsk') {
            if (source === 'boot') {
                const bootSector = explorerParsed.dskImage.readSector(0, 0,
                    explorerParsed.diskSpec && explorerParsed.diskSpec.firstSectorId !== undefined
                        ? explorerParsed.diskSpec.firstSectorId : 1);
                if (bootSector) {
                    data = bootSector;
                    baseAddr = 0xFE00;
                }
            } else {
                const fileIdx = parseInt(source);
                const file = explorerParsed.files[fileIdx];
                if (file) {
                    data = DSKLoader.readFileData(
                        explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
                    );
                    baseAddr = 0;
                }
            }
        } else if (explorerData) {
            data = explorerData;
        }

        if (!data || data.length === 0) {
            explorerHexOutput.innerHTML = '<div class="explorer-empty">No data</div>';
            return;
        }

        let html = '';
        const startOffset = Math.max(0, addr - baseAddr);
        const endOffset = Math.min(startOffset + len, data.length);

        for (let offset = startOffset; offset < endOffset; offset += 16) {
            const lineAddr = baseAddr + offset;
            let bytesHex = '';
            let ascii = '';

            for (let i = 0; i < 16; i++) {
                if (offset + i < data.length) {
                    const b = data[offset + i];
                    bytesHex += hex8(b) + ' ';
                    ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
                } else {
                    bytesHex += '   ';
                    ascii += ' ';
                }
                if (i === 7) bytesHex += ' ';
            }

            html += `<span class="ha">${hex16(lineAddr)}</span>  <span class="hb">${bytesHex}</span>  <span class="hc">${ascii}</span>\n`;
        }

        explorerHexOutput.innerHTML = html || '<div class="explorer-empty">No data</div>';
    }

    // BASIC Decoder for Explorer
    const ExplorerBasicDecoder = (() => {
        // ZX Spectrum BASIC tokens (0xA3-0xFF)
        const TOKENS = {
            0xA3: ['SPECTRUM', true, true], 0xA4: ['PLAY', true, true],
            0xA5: ['RND', true, false], 0xA6: ['INKEY$', true, false],
            0xA7: ['PI', true, false], 0xA8: ['FN', true, false],
            0xA9: ['POINT', true, false], 0xAA: ['SCREEN$', true, false],
            0xAB: ['ATTR', true, false], 0xAC: ['AT', true, true],
            0xAD: ['TAB', true, true], 0xAE: ['VAL$', true, false],
            0xAF: ['CODE', true, true], 0xB0: ['VAL', true, true],
            0xB1: ['LEN', true, false], 0xB2: ['SIN', true, false],
            0xB3: ['COS', true, false], 0xB4: ['TAN', true, false],
            0xB5: ['ASN', true, false], 0xB6: ['ACS', true, false],
            0xB7: ['ATN', true, false], 0xB8: ['LN', true, false],
            0xB9: ['EXP', true, false], 0xBA: ['INT', true, false],
            0xBB: ['SQR', true, false], 0xBC: ['SGN', true, false],
            0xBD: ['ABS', true, false], 0xBE: ['PEEK', true, false],
            0xBF: ['IN', true, true], 0xC0: ['USR', true, true],
            0xC1: ['STR$', true, false], 0xC2: ['CHR$', true, false],
            0xC3: ['NOT', true, true], 0xC4: ['BIN', true, true],
            0xC5: ['OR', true, true], 0xC6: ['AND', true, true],
            0xC7: ['<=', false, false], 0xC8: ['>=', false, false],
            0xC9: ['<>', false, false], 0xCA: ['LINE', true, true],
            0xCB: ['THEN', true, true], 0xCC: ['TO', true, true],
            0xCD: ['STEP', true, true], 0xCE: ['DEF FN', true, true],
            0xCF: ['CAT', true, true], 0xD0: ['FORMAT', true, true],
            0xD1: ['MOVE', true, true], 0xD2: ['ERASE', true, true],
            0xD3: ['OPEN #', true, false], 0xD4: ['CLOSE #', true, false],
            0xD5: ['MERGE', true, true], 0xD6: ['VERIFY', true, true],
            0xD7: ['BEEP', true, true], 0xD8: ['CIRCLE', true, true],
            0xD9: ['INK', true, true], 0xDA: ['PAPER', true, true],
            0xDB: ['FLASH', true, true], 0xDC: ['BRIGHT', true, true],
            0xDD: ['INVERSE', true, true], 0xDE: ['OVER', true, true],
            0xDF: ['OUT', true, true], 0xE0: ['LPRINT', true, true],
            0xE1: ['LLIST', true, true], 0xE2: ['STOP', true, false],
            0xE3: ['READ', true, true], 0xE4: ['DATA', true, true],
            0xE5: ['RESTORE', true, true], 0xE6: ['NEW', true, false],
            0xE7: ['BORDER', true, true], 0xE8: ['CONTINUE', true, false],
            0xE9: ['DIM', true, true], 0xEA: ['REM', true, true],
            0xEB: ['FOR', true, true], 0xEC: ['GO TO', true, true],
            0xED: ['GO SUB', true, true], 0xEE: ['INPUT', true, true],
            0xEF: ['LOAD', true, true], 0xF0: ['LIST', true, true],
            0xF1: ['LET', true, true], 0xF2: ['PAUSE', true, true],
            0xF3: ['NEXT', true, true], 0xF4: ['POKE', true, true],
            0xF5: ['PRINT', true, true], 0xF6: ['PLOT', true, true],
            0xF7: ['RUN', true, true], 0xF8: ['SAVE', true, true],
            0xF9: ['RANDOMIZE', true, true], 0xFA: ['IF', true, true],
            0xFB: ['CLS', true, false], 0xFC: ['DRAW', true, true],
            0xFD: ['CLEAR', true, true], 0xFE: ['RETURN', true, false],
            0xFF: ['COPY', true, false]
        };

        const CONTROL_CODES = {
            0x10: 'INK', 0x11: 'PAPER', 0x12: 'FLASH',
            0x13: 'BRIGHT', 0x14: 'INVERSE', 0x15: 'OVER',
            0x16: 'AT', 0x17: 'TAB'
        };

        function parseFloat5(bytes) {
            if (bytes.length < 5) return null;
            const exp = bytes[0];
            if (exp === 0) {
                if (bytes[1] === 0x00 && bytes[4] === 0x00) {
                    return bytes[2] | (bytes[3] << 8);
                }
                if (bytes[1] === 0xFF && bytes[4] === 0x00) {
                    const val = bytes[2] | (bytes[3] << 8);
                    return val > 32767 ? val - 65536 : -val;
                }
                return 0;
            }
            const sign = (bytes[1] & 0x80) ? -1 : 1;
            const mantissa = (((bytes[1] | 0x80) << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0;
            return sign * (mantissa / 0x100000000) * Math.pow(2, exp - 128);
        }

        function formatNumber(n) {
            if (n === null || n === undefined) return '?';
            if (Number.isInteger(n)) return n.toString();
            return parseFloat(n.toPrecision(10)).toString();
        }

        function decode(data) {
            const lines = [];
            let offset = 0;

            while (offset < data.length - 4) {
                const lineNum = (data[offset] << 8) | data[offset + 1];
                let lineLen = data[offset + 2] | (data[offset + 3] << 8);

                if (lineLen === 0) {
                    break;
                }

                const availableLen = data.length - offset - 4;
                if (lineLen > availableLen) {
                    lineLen = availableLen;
                }

                if (lineLen === 0) {
                    break;
                }

                const lineData = data.slice(offset + 4, offset + 4 + lineLen);
                const decoded = decodeLine(lineData);

                lines.push({
                    number: lineNum,
                    offset: offset,
                    text: decoded.text,
                    obfuscations: decoded.obfuscations
                });

                offset += 4 + lineLen;
            }
            return lines;
        }

        function decodeLine(data) {
            let text = '';
            let obfuscations = [];
            let i = 0;
            let inString = false;
            let inREM = false;
            let lastWasSpace = false;
            let asciiBeforeFP = '';
            let asciiStartPos = -1;

            function addText(str, spaceBefore = false, spaceAfter = false) {
                if (spaceBefore && text.length > 0 && !lastWasSpace && !text.endsWith(' ') && !text.endsWith(':')) {
                    text += ' ';
                }
                text += str;
                lastWasSpace = str.endsWith(' ') || spaceAfter;
                if (spaceAfter && !str.endsWith(' ')) {
                    text += ' ';
                    lastWasSpace = true;
                }
            }

            while (i < data.length) {
                const byte = data[i];

                if (byte === 0x0D) break;

                if (inREM) {
                    if (byte >= 0x20 && byte < 0x80) {
                        text += String.fromCharCode(byte);
                    } else if (byte === 0x0E) {
                        i += 5;
                    } else if (TOKENS[byte]) {
                        const [keyword, spaceBefore, spaceAfter] = TOKENS[byte];
                        if (spaceBefore && text.length > 0 && !text.endsWith(' ')) text += ' ';
                        text += keyword;
                        if (spaceAfter) text += ' ';
                    } else {
                        text += `[${hex8(byte)}]`;
                    }
                    i++;
                    continue;
                }

                if (byte === 0x0E && !inString) {
                    const fpBytes = [];
                    for (let j = 0; j < 5 && i + 1 + j < data.length; j++) {
                        fpBytes.push(data[i + 1 + j]);
                    }
                    const fpValue = parseFloat5(fpBytes);
                    const fpFormatted = formatNumber(fpValue);
                    let isObfuscated = false;
                    let asciiDisplay = asciiBeforeFP.trim();

                    if (asciiDisplay !== '') {
                        let asciiNum = parseFloat(asciiDisplay);
                        if (asciiDisplay.startsWith('.')) asciiNum = parseFloat('0' + asciiDisplay);
                        if (isNaN(asciiNum)) {
                            isObfuscated = true;
                        } else {
                            const valuesMatch = Math.abs(Math.abs(asciiNum) - Math.abs(fpValue)) < 0.0001 ||
                                               Math.abs(asciiNum - fpValue) < 0.0001;
                            if (!valuesMatch) isObfuscated = true;
                        }
                    } else {
                        isObfuscated = true;
                        asciiDisplay = '(hidden)';
                    }

                    if (isObfuscated) {
                        obfuscations.push({ ascii: asciiDisplay, actual: fpValue });
                        if (asciiStartPos >= 0 && asciiStartPos < text.length) {
                            text = text.substring(0, asciiStartPos);
                        }
                        text += `{{${fpFormatted}}}`;
                    }
                    asciiBeforeFP = '';
                    asciiStartPos = -1;
                    i += 6;
                    continue;
                }

                const isNumberChar = (byte >= 0x30 && byte <= 0x39) || byte === 0x2E ||
                                     byte === 0x2B || byte === 0x2D || byte === 0x45 || byte === 0x65;
                if (!inString && isNumberChar) {
                    if (asciiStartPos < 0) asciiStartPos = text.length;
                    asciiBeforeFP += String.fromCharCode(byte);
                } else if (!inString && byte !== 0x0E) {
                    if (byte !== 0x20 || asciiBeforeFP === '') {
                        asciiBeforeFP = '';
                        asciiStartPos = -1;
                    } else if (byte === 0x20 && asciiBeforeFP !== '') {
                        asciiBeforeFP += ' ';
                    }
                }

                if (byte === 0x22) {
                    inString = !inString;
                    text += '"';
                    lastWasSpace = false;
                    asciiBeforeFP = '';
                    asciiStartPos = -1;
                    i++;
                    continue;
                }

                if (inString) {
                    if (byte >= 0x20 && byte < 0x7F) {
                        text += String.fromCharCode(byte);
                    } else {
                        text += `[${hex8(byte)}]`;
                    }
                    i++;
                    continue;
                }

                if (CONTROL_CODES[byte]) {
                    addText('{' + CONTROL_CODES[byte] + ' ', true, false);
                    asciiBeforeFP = '';
                    asciiStartPos = -1;
                    if (byte >= 0x16) {
                        i++;
                        if (i < data.length) text += data[i];
                        i++;
                        if (i < data.length) text += ',' + data[i];
                    } else {
                        i++;
                        if (i < data.length) text += data[i];
                    }
                    text += '}';
                    i++;
                    continue;
                }

                if (TOKENS[byte]) {
                    const [keyword, spaceBefore, spaceAfter] = TOKENS[byte];
                    addText(keyword, spaceBefore, spaceAfter);
                    if (byte === 0xEA) inREM = true;
                    asciiBeforeFP = '';
                    asciiStartPos = -1;
                    i++;
                    continue;
                }

                if (byte === 0x3A) {
                    text += ':';
                    lastWasSpace = false;
                    asciiBeforeFP = '';
                    asciiStartPos = -1;
                    i++;
                    continue;
                }

                if (byte >= 0x20 && byte < 0x80) {
                    text += String.fromCharCode(byte);
                    lastWasSpace = (byte === 0x20);
                } else if (byte >= 0x90 && byte <= 0xA2) {
                    text += `[UDG-${String.fromCharCode(65 + byte - 0x90)}]`;
                    lastWasSpace = false;
                    asciiBeforeFP = '';
                    asciiStartPos = -1;
                } else if (byte >= 0x80 && byte <= 0x8F) {
                    text += `[BLK]`;
                    lastWasSpace = false;
                    asciiBeforeFP = '';
                    asciiStartPos = -1;
                } else if (byte < 0x20 && byte !== 0x0E) {
                    if (byte === 0x06) text += ',';
                    asciiBeforeFP = '';
                    asciiStartPos = -1;
                }
                i++;
            }
            return { text: text.trim(), obfuscations };
        }

        return { decode, parseFloat5, TOKENS };
    })();

    // BASIC view button handler
    const btnExplorerBasic = document.getElementById('btnExplorerBasic');
    if (btnExplorerBasic) {
        btnExplorerBasic.addEventListener('click', () => {
            explorerRenderBASIC();
        });
    }

    function explorerRenderBASIC() {
        const source = explorerBasicSource.value;
        if (!source) {
            explorerBasicOutput.innerHTML = '<div class="explorer-empty">Select a BASIC program source</div>';
            return;
        }

        let data = null;

        if (explorerParsed.type === 'tap') {
            const blockIdx = parseInt(source);
            const headerBlock = explorerBlocks[blockIdx];
            if (headerBlock && headerBlock.blockType === 'header' && headerBlock.headerType === 0 && blockIdx + 1 < explorerBlocks.length) {
                const dataBlock = explorerBlocks[blockIdx + 1];
                data = dataBlock.data.slice(1, -1);
            }
        } else if (explorerParsed.type === 'tzx') {
            const blockIdx = parseInt(source);
            const headerBlock = explorerBlocks[blockIdx];
            if (headerBlock && headerBlock.id === 0x10 && headerBlock.headerTypeId === 0 && blockIdx + 1 < explorerBlocks.length) {
                const dataBlock = explorerBlocks[blockIdx + 1];
                if (dataBlock && dataBlock.id === 0x10 && dataBlock.data) {
                    data = dataBlock.data.slice(1, -1);
                }
            }
        } else if (explorerParsed.type === 'trd' || explorerParsed.type === 'scl' || explorerParsed.type === 'mgt' || explorerParsed.type === 'mdr') {
            const fileIdx = parseInt(source);
            const file = explorerParsed.files[fileIdx];
            if (file) {
                data = explorerParsed.type === 'mgt'
                    ? MGTLoader.extractFile(explorerData, file)
                    : explorerParsed.type === 'mdr'
                    ? MDRLoader.extractFile(explorerData, file)
                    : explorerData.slice(file.offset, file.offset + file.length);
            }
        } else if (explorerParsed.type === 'opd') {
            const fileIdx = parseInt(source);
            const file = explorerParsed.files[fileIdx];
            if (file) {
                data = OPDLoader.extractFile(explorerData, file);
            }
        } else if (explorerParsed.type === 'hobeta') {
            const f = explorerParsed.file;
            if (f && f.ext === 'B') {
                data = f.data;
            }
        } else if (explorerParsed.type === 'dsk') {
            const fileIdx = parseInt(source);
            const file = explorerParsed.files[fileIdx];
            if (file && explorerParsed.dskImage) {
                const rawData = DSKLoader.readFileData(
                    explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
                );
                if (rawData) {
                    if (file.hasPlus3Header && rawData.length > 128) {
                        data = rawData.slice(128);
                    } else {
                        data = rawData;
                    }
                }
            }
        }

        if (!data || data.length === 0) {
            explorerBasicOutput.innerHTML = '<div class="explorer-empty">No BASIC data found</div>';
            return;
        }

        try {
            const lines = ExplorerBasicDecoder.decode(data);

            if (lines.length === 0) {
                const hexBytes = Array.from(data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                explorerBasicOutput.innerHTML = `<div class="explorer-empty">No BASIC lines found<br><span style="font-size:10px;color:var(--text-secondary)">First 16 bytes: ${hexBytes}</span></div>`;
                return;
            }

            let html = '';
            for (const line of lines) {
                let highlighted = highlightBasicLine(line.text);

                html += `<div class="explorer-basic-line">`;
                html += `<span class="explorer-basic-linenum">${line.number}</span>`;
                html += `<span>${highlighted}</span>`;
                html += `</div>`;

                if (line.obfuscations && line.obfuscations.length > 0) {
                    for (const obf of line.obfuscations) {
                        html += `<div style="color:#e67e22;font-size:10px;margin-left:60px;">`;
                        const actualNum = typeof obf.actual === 'number' ? obf.actual : parseFloat(obf.actual);
                        if (Number.isInteger(actualNum) && actualNum >= 16384 && actualNum <= 65535) {
                            html += `\u26A0 Obfuscated: "${obf.ascii}" \u2192 <span class="explorer-basic-addr" data-addr="${actualNum}" style="cursor:pointer;text-decoration:underline;color:var(--cyan)" title="Click to disassemble">${obf.actual}</span>`;
                        } else {
                            html += `\u26A0 Obfuscated: "${obf.ascii}" \u2192 ${obf.actual}`;
                        }
                        html += `</div>`;
                    }
                }
            }

            explorerBasicOutput.innerHTML = html;

        } catch (err) {
            explorerBasicOutput.innerHTML = `<div class="explorer-empty">Error decoding BASIC: ${err.message}</div>`;
        }
    }

    function highlightBasicLine(text) {
        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        html = html.replace(/"([^"]*)"/g, '<span class="explorer-basic-string">"$1"</span>');

        const keywords = Object.values(ExplorerBasicDecoder.TOKENS).map(t => t[0]).sort((a, b) => b.length - a.length);
        for (const kw of keywords) {
            const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp('\\b(' + escaped + ')\\b', 'g');
            html = html.replace(regex, '<span class="explorer-basic-keyword">$1</span>');
        }

        html = html.replace(/(USR|PEEK|POKE|RANDOMIZE\s+USR)(\s*<[^>]+>)?\s*(\d{4,5})/gi, (match, keyword, span, addr) => {
            const addrNum = parseInt(addr);
            if (addrNum >= 16384 && addrNum <= 65535) {
                return `${keyword}${span || ''} <span class="explorer-basic-addr" data-addr="${addrNum}" style="cursor:pointer;text-decoration:underline;color:var(--cyan)" title="Click to disassemble">${addr}</span>`;
            }
            return match;
        });

        html = html.replace(/(USR|PEEK|POKE)(<\/span>)?\s*(<span[^>]*>)?VAL(<\/span>)?\s*"([\d.]+(?:[Ee][+\-]?\d+)?)"/gi, (match, keyword, kwClose, valOpen, valClose, numStr) => {
            const addrNum = Math.round(parseFloat(numStr));
            if (addrNum >= 16384 && addrNum <= 65535) {
                return `${keyword}${kwClose || ''} ${valOpen || ''}VAL${valClose || ''} "<span class="explorer-basic-addr" data-addr="${addrNum}" style="cursor:pointer;text-decoration:underline;color:var(--cyan)" title="Click to disassemble at ${addrNum}">${numStr}</span>"`;
            }
            return match;
        });

        html = html.replace(/\b(\d+(?:\.\d+)?)\b(?![^<]*>)/g, '<span class="explorer-basic-number">$1</span>');

        html = html.replace(/\{\{([^}]+)\}\}/g, '<span style="color:#e67e22;font-weight:bold">{{$1}}</span>');

        return html;
    }

    // Handle clicking on addresses in BASIC listing
    explorerBasicOutput.addEventListener('click', (e) => {
        const addrSpan = e.target.closest('.explorer-basic-addr');
        if (!addrSpan) return;

        let addr = parseInt(addrSpan.dataset.addr);
        if (isNaN(addr)) return;

        document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();

        let foundSource = '';

        if (explorerParsed.type === 'tap') {
            for (let i = 0; i < explorerBlocks.length; i++) {
                const block = explorerBlocks[i];
                if (block.blockType === 'header' && block.headerType === 3) {
                    const startAddr = block.startAddress;
                    const dataBlock = explorerBlocks[i + 1];
                    if (dataBlock && dataBlock.blockType === 'data') {
                        const endAddr = startAddr + dataBlock.length - 2;
                        if (addr >= startAddr && addr < endAddr) {
                            foundSource = i.toString();
                            break;
                        }
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < explorerBlocks.length; i++) {
                    const block = explorerBlocks[i];
                    if (block.blockType === 'data' && i > 0) {
                        const prevBlock = explorerBlocks[i - 1];
                        if (prevBlock.blockType === 'header' && prevBlock.startAddress !== undefined) {
                            const startAddr = prevBlock.startAddress;
                            const endAddr = startAddr + block.length - 2;
                            if (addr >= startAddr && addr < endAddr) {
                                foundSource = 'data:' + i.toString();
                                break;
                            }
                        }
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < explorerBlocks.length; i++) {
                    if (explorerBlocks[i].blockType === 'data') {
                        foundSource = 'data:' + i.toString();
                        break;
                    }
                }
            }
        } else if (explorerParsed.type === 'trd' || explorerParsed.type === 'scl' || explorerParsed.type === 'mgt' || explorerParsed.type === 'mdr') {
            for (let i = 0; i < explorerParsed.files.length; i++) {
                const file = explorerParsed.files[i];
                if (file.ext === 'C' || file.ext === 'D' || file.ext === 'F') {
                    const endAddr = (file.startAddress || 0) + file.length;
                    if (addr >= (file.startAddress || 0) && addr < endAddr) {
                        foundSource = i.toString();
                        break;
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < explorerParsed.files.length; i++) {
                    const file = explorerParsed.files[i];
                    if (file.ext === 'B') {
                        const basicBase = 0x5D3B;
                        const fullSize = file.sectors * 256;
                        const endAddr = basicBase + fullSize;
                        if (addr >= basicBase && addr < endAddr) {
                            foundSource = 'basic:' + i.toString();
                            break;
                        }
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < explorerParsed.files.length; i++) {
                    const file = explorerParsed.files[i];
                    if (file.ext === 'C') {
                        const endAddr = file.startAddress + file.length;
                        if (addr >= file.startAddress && addr < endAddr) {
                            foundSource = i.toString();
                            break;
                        }
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < explorerParsed.files.length; i++) {
                    const file = explorerParsed.files[i];
                    if (file.ext === 'C') {
                        foundSource = i.toString();
                        if (addr < file.startAddress || addr >= file.startAddress + file.length) {
                            addr = file.startAddress;
                        }
                        break;
                    }
                }
            }
        } else if (explorerParsed.type === 'sna' || explorerParsed.type === 'z80') {
            foundSource = 'memory';
        }

        if (foundSource) {
            explorerDisasmSource.value = foundSource;
        }

        explorerDisasmAddr.value = hex16(addr);
        explorerDisasmLen.value = 256;

        explorerRenderDisasm();
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
    const editorPairLock = document.getElementById('editorPairLock');

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
            dom: { container: null, header: null, fileList: null,
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
        panel.dom.formatSpan = el.querySelector('.editor-panel-format');
        panel.dom.nameSpan = el.querySelector('.editor-panel-name');
        panel.dom.statusSpan = el.querySelector('.editor-panel-status');
    }
    initPanelDom(editorPanels.left, 'left');
    initPanelDom(editorPanels.right, 'right');

    function getActivePanel() { return editorPanels[activePanel]; }
    function getOtherPanel() { return editorPanels[activePanel === 'left' ? 'right' : 'left']; }

    // --- Pair logic (parameterized on panel) ---

    function editorIsPairHeader(panel, idx) {
        return idx < panel.blocks.length &&
            panel.blocks[idx].blockType === 'header' &&
            idx + 1 < panel.blocks.length &&
            panel.blocks[idx + 1].blockType === 'data';
    }

    function editorPairHeaderOf(panel, idx) {
        if (idx > 0 &&
            panel.blocks[idx].blockType === 'data' &&
            panel.blocks[idx - 1].blockType === 'header') {
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
        // Bytes 9-10: start address (LE)
        const addr = file.startAddress || 0;
        hdr[9] = addr & 0xFF;
        hdr[10] = (addr >> 8) & 0xFF;
        // Bytes 11-12: data length (LE)
        hdr[11] = dataLen & 0xFF;
        hdr[12] = (dataLen >> 8) & 0xFF;
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
        const startAddress = hdr[9] | (hdr[10] << 8);
        const length = hdr[11] | (hdr[12] << 8);
        const fileData = data.slice(17, 17 + length);
        return { name, ext, startAddress, length, data: fileData };
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

    // --- Shared toolbar visibility ---

    function editorUpdateToolbar() {
        const panel = getActivePanel();
        const t = panel.fileType;
        const isTap = isTapOrTzx(t);
        const isTrd = t === 'trd' || t === 'scl' || t === 'mgt' || t === 'mdr';
        const isDsk = t === 'dsk';
        const isZip = t === 'zip';
        const isOpd = t === 'opd';
        const hasSel = panel.selection.size > 0;

        btnEditorSave.textContent = t ? `Save ${t.toUpperCase()}` : 'Save';
        btnEditorSave.disabled = !t;


        btnEditorMoveUp.style.display = (isTap || isTrd) && !isZip ? '' : 'none';
        btnEditorMoveDown.style.display = (isTap || isTrd) && !isZip ? '' : 'none';
        btnEditorMoveUp.disabled = !hasSel;
        btnEditorMoveDown.disabled = !hasSel;

        btnEditorMarkDel.style.display = isTrd ? '' : 'none';
        btnEditorMarkDel.disabled = !hasSel;

        btnEditorDel.disabled = !hasSel;
        btnEditorExtract.style.display = 'none';
        editorExtractDisk.style.display = '';
        editorExtractDisk.disabled = !hasSel;
        if (hasSel) editorExtractDisk.value = '';

        editorLinkLabel.style.display = isTap ? '' : 'none';

        btnEditorAddFile.disabled = isDsk && panel.parsedFile && panel.parsedFile.dskImage &&
            !DSKLoader.getDiskSpec(panel.parsedFile.dskImage).valid && (panel.parsedFile.files || []).length === 0;

        btnEditorCopy.disabled = !hasSel || !t;
        btnEditorCopy.innerHTML = activePanel === 'left' ? 'Copy &#9654;' : '&#9664; Copy';
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
        explorerBlocks = panel.blocks;
        const editActive = document.querySelector('.explorer-subtab.active');
        explorerUpdateSourceSelectors(!(editActive && editActive.dataset.subtab === 'edit'));
    }

    // --- TAP rendering (parameterized) ---

    function editorRenderBlockList(panel) {
        if (!panel) panel = getActivePanel();
        // Format-aware dispatch
        if (panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr') {
            diskEditorRenderFileList(panel);
            return;
        }
        if (panel.fileType === 'opd') {
            opdEditorRenderFileList(panel);
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

        let html = '';
        for (let i = 0; i < panel.blocks.length; i++) {
            const block = panel.blocks[i];

            // Non-standard TZX block — dimmed info row
            if (block.blockType === 'nonstandard') {
                html += `<div class="editor-block-row nonstandard-row">`;
                html += `<span class="editor-block-info">`;
                html += `<span class="dim">${i + 1}:</span> ${block.typeName}`;
                html += ` <span class="dim">\u2014 ${block.dataLength} bytes</span>`;
                html += `</span></div>`;
                continue;
            }

            const isHeader = block.blockType === 'header';
            const isSel = panel.selection.has(i);
            const isPairData = editorPairLock.checked && !isHeader && editorPairHeaderOf(panel, i) >= 0;
            const isExpanded = panel.expandedBlock === i;

            let rowClasses = 'editor-block-row';
            rowClasses += isHeader ? ' header-row' : ' data-row';
            if (isPairData) rowClasses += ' pair';
            if (isSel) rowClasses += ' selected';

            let checksumOk = true;
            if (!isHeader) {
                let calcChecksum = 0;
                for (let j = 0; j < block.data.length - 1; j++) {
                    calcChecksum ^= block.data[j];
                }
                checksumOk = calcChecksum === block.data[block.data.length - 1];
            }

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            if (isHeader) {
                const typeNames = ['Program', 'Number array', 'Character array', 'Bytes'];
                const typeName = typeNames[block.headerType] || 'Unknown';
                html += `<span class="dim">${i + 1}:</span> Header \u2014 ${typeName} <span class="name">"${block.name}"</span>`;
                html += ` <span class="dim">\u2014 ${block.dataLength} bytes</span>`;
                if (block.headerType === 0 && block.autostart !== null) {
                    html += ` <span class="dim">\u2014 autostart ${block.autostart}</span>`;
                } else if (block.headerType === 3) {
                    html += ` <span class="addr"> @ $${hex16(block.startAddress)}</span>`;
                }
            } else {
                html += `<span class="dim">${i + 1}:</span> Data \u2014 ${block.data.length - 2} bytes`;
                html += ` <span class="dim">\u2014 checksum </span>`;
                html += checksumOk ? '<span class="ok">\u2713</span>' : '<span class="bad">\u2717</span>';
            }
            if (panel.fileType === 'tzx' && block.tzxPause !== undefined && block.tzxPause !== 1000) {
                html += ` <span class="dim">\u2014 pause ${block.tzxPause}ms</span>`;
            }
            html += '</span></div>';

            if (isExpanded && isHeader) {
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<label>Name:</label><input type="text" maxlength="10" value="${block.name}" data-field="name" style="width:100px">`;
                html += `<label>Type:</label><select data-field="type">`;
                html += `<option value="0"${block.headerType === 0 ? ' selected' : ''}>Program</option>`;
                html += `<option value="1"${block.headerType === 1 ? ' selected' : ''}>Num array</option>`;
                html += `<option value="2"${block.headerType === 2 ? ' selected' : ''}>Char array</option>`;
                html += `<option value="3"${block.headerType === 3 ? ' selected' : ''}>Bytes</option>`;
                html += '</select>';
                if (block.headerType === 0) {
                    html += `<label>Autostart:</label><input type="number" value="${block.autostart !== null ? block.autostart : ''}" data-field="autostart" min="0" max="9999" style="width:60px" placeholder="none">`;
                } else if (block.headerType === 3) {
                    html += `<label>Address:</label><input type="text" value="${hex16(block.startAddress)}" data-field="addr" maxlength="4" style="width:60px">`;
                }
                html += `<label class="dim">Data len: ${block.dataLength}</label>`;
                if (panel.fileType === 'tzx') {
                    const pauseVal = block.tzxPause !== undefined ? block.tzxPause : 1000;
                    html += `<label>Pause (ms):</label><input type="number" value="${pauseVal}" data-field="pause" min="0" max="65535" style="width:70px">`;
                }
                html += `<button class="editor-apply-btn" data-action="apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${panel.blocks.length} blocks, ${selCount} sel`;
        } else {
            panel.dom.statusSpan.textContent = `${panel.blocks.length} blocks`;
        }
        editorUpdateToolbar();
    }

    // --- Selection handling (parameterized) ---

    function editorGetItemCount(panel) {
        const isDisk = panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd';
        const isDsk = panel.fileType === 'dsk';
        const isZip = panel.fileType === 'zip';
        if (isDisk) return panel.diskFiles.length;
        if (isDsk) return (panel.parsedFile.files || []).length;
        if (isZip) return (panel.parsedFile.files || []).length;
        return panel.blocks.length;
    }

    function editorSelectBlock(panel, idx, ctrlKey, shiftKey) {
        const isDisk = panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd';
        const isDsk = panel.fileType === 'dsk';
        const isZip = panel.fileType === 'zip';
        if (shiftKey && (isDisk || isDsk || isZip)) {
            // Range selection: from last anchor to current idx
            const anchor = panel._selAnchor !== undefined ? panel._selAnchor : idx;
            const lo = Math.min(anchor, idx);
            const hi = Math.max(anchor, idx);
            panel.selection = new Set();
            for (let i = lo; i <= hi; i++) panel.selection.add(i);
        } else if (ctrlKey) {
            if (isDisk || isDsk || isZip) {
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
            if (isDisk || isDsk || isZip) {
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
            const blob = new Blob([files[0].data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = files[0].name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
        }
        const zipData = editorCreateZip(files);
        const blob = new Blob([zipData], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '_extract.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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

    function editorAddFileBlocks(panel, fileData, name, type, startAddr, autostart, varLetter, pause) {
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
        let param2 = (type === 0) ? fileData.length : 0x8000;
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
        for (const block of panel.blocks) totalSize += 2 + block.data.length;
        const tap = new Uint8Array(totalSize);
        let offset = 0;
        for (const block of panel.blocks) {
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
        const blob = new Blob([tap], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '.tap';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== TZX Editor Functions ==========

    function editorNewTzx(panel) {
        panel.blocks = [];
        panel.parsedFile = { type: 'tzx', blocks: panel.blocks, nonStandardBlocks: [], size: 0, version: '1.20' };
        panel.fileType = 'tzx';
        panel.rawData = new Uint8Array(0);
        panel.fileName = 'new.tzx';
        panel.selection.clear();
        panel.expandedBlock = -1;
        panel.diskFiles = [];
        panel.diskLabel = '        ';
        panel.pendingFileData = null;
        updatePanelHeader(panel);
        editorRenderBlockList(panel);
        syncPanelToExplorer(panel);
    }

    function editorImportTzxData(panel, tzxData) {
        const typeNames = ['Program', 'Number array', 'Character array', 'Bytes'];
        if (tzxData.length < 10) return;
        // Validate TZX header: "ZXTape!" + 0x1A
        const sig = String.fromCharCode(...tzxData.slice(0, 7));
        if (sig !== 'ZXTape!' || tzxData[7] !== 0x1A) return;
        const verMajor = tzxData[8];
        const verMinor = tzxData[9];
        if (panel.parsedFile) panel.parsedFile.version = `${verMajor}.${String(verMinor).padStart(2, '0')}`;

        let offset = 10;
        let blockIndex = 0;
        while (offset < tzxData.length) {
            const id = tzxData[offset];
            offset++;

            if (id === 0x10) {
                // Standard speed data block
                if (offset + 4 > tzxData.length) break;
                const pause = tzxData[offset] | (tzxData[offset + 1] << 8);
                const dataLen = tzxData[offset + 2] | (tzxData[offset + 3] << 8);
                offset += 4;
                if (offset + dataLen > tzxData.length) break;
                const blockData = new Uint8Array(tzxData.slice(offset, offset + dataLen));
                offset += dataLen;

                const flag = blockData[0];
                let blockInfo = { offset: -1, length: dataLen, flag: flag, data: blockData, tzxPause: pause };

                if (flag === 0 && dataLen === 19) {
                    const type = blockData[1];
                    const name = String.fromCharCode(...blockData.slice(2, 12)).trim();
                    const dLen = blockData[12] | (blockData[13] << 8);
                    const p1 = blockData[14] | (blockData[15] << 8);
                    const p2 = blockData[16] | (blockData[17] << 8);
                    blockInfo.blockType = 'header';
                    blockInfo.headerType = type;
                    blockInfo.typeName = typeNames[type] || 'Unknown';
                    blockInfo.name = name;
                    blockInfo.dataLength = dLen;
                    blockInfo.param1 = p1;
                    blockInfo.param2 = p2;
                    if (type === 0) { blockInfo.autostart = p1 < 32768 ? p1 : null; blockInfo.varsOffset = p2; }
                    else if (type === 3) { blockInfo.startAddress = p1; }
                } else {
                    blockInfo.blockType = 'data';
                }

                blockInfo._tzxOriginalIndex = blockIndex;
                panel.blocks.push(blockInfo);
            } else {
                // Non-standard block — read its full extent, store opaquely
                const blockStart = offset - 1; // includes ID byte
                let blockEnd = offset;

                switch (id) {
                    case 0x11: // Turbo speed data
                        if (offset + 0x12 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 0x12 + (tzxData[offset + 0x0F] | (tzxData[offset + 0x10] << 8) | (tzxData[offset + 0x11] << 16));
                        break;
                    case 0x12: // Pure tone
                        blockEnd = offset + 4;
                        break;
                    case 0x13: // Pulse sequence
                        if (offset >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 1 + tzxData[offset] * 2;
                        break;
                    case 0x14: // Pure data
                        if (offset + 0x0A > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 0x0A + (tzxData[offset + 0x07] | (tzxData[offset + 0x08] << 8) | (tzxData[offset + 0x09] << 16));
                        break;
                    case 0x15: // Direct recording
                        if (offset + 8 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 8 + (tzxData[offset + 0x05] | (tzxData[offset + 0x06] << 8) | (tzxData[offset + 0x07] << 16));
                        break;
                    case 0x18: // CSW recording
                    case 0x19: // Generalized data
                        if (offset + 4 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 4 + (tzxData[offset] | (tzxData[offset + 1] << 8) | (tzxData[offset + 2] << 16) | (tzxData[offset + 3] << 24));
                        break;
                    case 0x20: // Pause
                        blockEnd = offset + 2;
                        break;
                    case 0x21: // Group start
                        if (offset >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 1 + tzxData[offset];
                        break;
                    case 0x22: // Group end
                        blockEnd = offset;
                        break;
                    case 0x23: // Jump
                        blockEnd = offset + 2;
                        break;
                    case 0x24: // Loop start
                        blockEnd = offset + 2;
                        break;
                    case 0x25: // Loop end
                        blockEnd = offset;
                        break;
                    case 0x26: // Call sequence
                        if (offset + 2 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 2 + (tzxData[offset] | (tzxData[offset + 1] << 8)) * 2;
                        break;
                    case 0x27: // Return
                        blockEnd = offset;
                        break;
                    case 0x28: // Select
                        if (offset + 2 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 2 + (tzxData[offset] | (tzxData[offset + 1] << 8));
                        break;
                    case 0x2A: // Stop if 48K
                        blockEnd = offset + 4;
                        break;
                    case 0x2B: // Signal level
                        blockEnd = offset + 5;
                        break;
                    case 0x30: // Text description
                        if (offset >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 1 + tzxData[offset];
                        break;
                    case 0x31: // Message
                        if (offset + 1 >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 2 + tzxData[offset + 1];
                        break;
                    case 0x32: // Archive info
                        if (offset + 2 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 2 + (tzxData[offset] | (tzxData[offset + 1] << 8));
                        break;
                    case 0x33: // Hardware type
                        if (offset >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 1 + tzxData[offset] * 3;
                        break;
                    case 0x35: // Custom info
                        if (offset + 0x14 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 0x14 + (tzxData[offset + 0x10] | (tzxData[offset + 0x11] << 8) | (tzxData[offset + 0x12] << 16) | (tzxData[offset + 0x13] << 24));
                        break;
                    case 0x5A: // Glue
                        blockEnd = offset + 9;
                        break;
                    default:
                        // Unknown block — try reading 4-byte length at current offset
                        if (offset + 4 <= tzxData.length) {
                            blockEnd = offset + 4 + (tzxData[offset] | (tzxData[offset + 1] << 8) | (tzxData[offset + 2] << 16) | (tzxData[offset + 3] << 24));
                        } else {
                            blockEnd = tzxData.length;
                        }
                        break;
                }

                if (blockEnd > tzxData.length) blockEnd = tzxData.length;
                const rawBytes = new Uint8Array(tzxData.slice(blockStart + 1, blockEnd)); // without ID byte
                const typeName = TZX_BLOCK_NAMES[id] || `Unknown ($${id.toString(16).toUpperCase().padStart(2, '0')})`;

                panel.blocks.push({
                    blockType: 'nonstandard',
                    tzxId: id,
                    typeName: typeName,
                    rawBytes: rawBytes,
                    dataLength: rawBytes.length,
                    _tzxOriginalIndex: blockIndex
                });

                offset = blockEnd;
            }
            blockIndex++;
        }
        panel.selection.clear();
        panel.expandedBlock = -1;
    }

    function editorBuildTzx(panel) {
        // TZX header: "ZXTape!" + 0x1A + version 1.20
        const header = new Uint8Array([0x5A, 0x58, 0x54, 0x61, 0x70, 0x65, 0x21, 0x1A, 0x01, 0x14]);

        // Calculate total size
        let totalSize = header.length;
        for (const block of panel.blocks) {
            if (block.blockType === 'nonstandard') {
                totalSize += 1 + block.rawBytes.length; // ID byte + raw data
            } else {
                // ID 0x10: 1 (ID) + 2 (pause) + 2 (len) + data.length
                totalSize += 1 + 2 + 2 + block.data.length;
            }
        }

        const tzx = new Uint8Array(totalSize);
        tzx.set(header, 0);
        let offset = header.length;

        for (let i = 0; i < panel.blocks.length; i++) {
            const block = panel.blocks[i];
            if (block.blockType === 'nonstandard') {
                tzx[offset] = block.tzxId;
                offset++;
                tzx.set(block.rawBytes, offset);
                offset += block.rawBytes.length;
            } else {
                // Standard speed data block (ID 0x10)
                tzx[offset] = 0x10;
                offset++;
                // Pause: use stored value, or default 1000ms (0 for last standard block)
                let pause = block.tzxPause !== undefined ? block.tzxPause : 1000;
                // Find if this is the last standard block
                let isLastStandard = true;
                for (let j = i + 1; j < panel.blocks.length; j++) {
                    if (panel.blocks[j].blockType !== 'nonstandard') { isLastStandard = false; break; }
                }
                if (isLastStandard && block.tzxPause === undefined) pause = 0;
                tzx[offset] = pause & 0xFF;
                tzx[offset + 1] = (pause >> 8) & 0xFF;
                offset += 2;
                tzx[offset] = block.data.length & 0xFF;
                tzx[offset + 1] = (block.data.length >> 8) & 0xFF;
                offset += 2;
                tzx.set(block.data, offset);
                offset += block.data.length;
            }
        }

        return tzx;
    }

    function editorSaveTzx(panel) {
        if (!panel.blocks.length) return;
        const tzx = editorBuildTzx(panel);
        const baseName = (panel.fileName || 'output').replace(/\.tzx$/i, '');
        const blob = new Blob([tzx], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '.tzx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== Disk Editor Functions (parameterized) ==========

    function diskEditorExtractFiles(panel) {
        if (panel.diskFiles.length > 0) return;
        if (panel.parsedFile && panel.parsedFile.type === 'mgt') {
            diskEditorExtractMgtFiles(panel);
            return;
        }
        if (panel.parsedFile && panel.parsedFile.type === 'mdr') {
            diskEditorExtractMdrFiles(panel);
            return;
        }
        if (!panel.parsedFile || (panel.parsedFile.type !== 'trd' && panel.parsedFile.type !== 'scl')) return;
        if (!panel.rawData || panel.rawData.length === 0) return;

        if (panel.parsedFile.type === 'trd') {
            for (let i = 0; i < 128; i++) {
                const entryOffset = i * 16;
                if (panel.rawData[entryOffset] === 0) break;
                const deleted = panel.rawData[entryOffset] === 1;
                const name = String.fromCharCode(...panel.rawData.slice(entryOffset, entryOffset + 8));
                const ext = String.fromCharCode(panel.rawData[entryOffset + 8]);
                const startAddr = panel.rawData[entryOffset + 9] | (panel.rawData[entryOffset + 10] << 8);
                const length = panel.rawData[entryOffset + 11] | (panel.rawData[entryOffset + 12] << 8);
                const sectors = panel.rawData[entryOffset + 13];
                const startSector = panel.rawData[entryOffset + 14];
                const startTrack = panel.rawData[entryOffset + 15];
                const fileOffset = (startTrack * 16 + startSector) * 256;
                const dataSize = sectors * 256;
                const data = new Uint8Array(dataSize);
                data.set(panel.rawData.slice(fileOffset, fileOffset + dataSize));
                panel.diskFiles.push({
                    name: (name + '        ').substring(0, 8),
                    ext: ext,
                    startAddress: startAddr,
                    length: length,
                    sectors: sectors,
                    data: data,
                    deleted: deleted
                });
            }
        } else {
            const files = panel.parsedFile.files;
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const sectors = f.sectors;
                const dataSize = sectors * 256;
                const data = new Uint8Array(dataSize);
                const src = panel.rawData.slice(f.offset, f.offset + dataSize);
                data.set(src);
                panel.diskFiles.push({
                    name: (f.name + '        ').substring(0, 8),
                    ext: f.ext,
                    startAddress: f.startAddress,
                    length: f.length,
                    sectors: sectors,
                    data: data,
                    deleted: false
                });
            }
        }

        if (panel.parsedFile.type === 'trd' && panel.rawData.length >= 0x800 + 0xFD) {
            const infoOffset = 8 * 256;
            panel.diskLabel = String.fromCharCode(
                ...panel.rawData.slice(infoOffset + 0xF5, infoOffset + 0xFD)
            );
        } else {
            panel.diskLabel = '        ';
        }
    }

    function diskEditorTotalSectors(panel) {
        let total = 0;
        for (const f of panel.diskFiles) total += f.sectors;
        return total;
    }

    function diskEditorRenderFileList(panel) {
        if (panel.fileType === 'mgt') {
            mgtEditorRenderFileList(panel);
            return;
        }
        if (panel.fileType === 'mdr') {
            mdrEditorRenderFileList(panel);
            return;
        }
        diskEditorExtractFiles(panel);

        if (panel.diskFiles.length === 0) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty disk. Use "Add File" to add files.</span>';
            panel.dom.statusSpan.textContent = '0 files';
            editorUpdateToolbar();
            return;
        }

        const totalSectors = diskEditorTotalSectors(panel);
        const freeSectors = 2544 - totalSectors;
        const activeFiles = panel.diskFiles.filter(f => !f.deleted).length;
        const deletedFiles = panel.diskFiles.length - activeFiles;

        let html = '';

        html += '<div class="editor-block-row disk-label-row" data-label-row="1">';
        html += '<span class="editor-block-info">';
        html += `Label: <span class="name">"${panel.diskLabel.replace(/\s+$/, '')}"</span>`;
        html += ` \u2014 ${activeFiles} file${activeFiles !== 1 ? 's' : ''}`;
        if (deletedFiles > 0) html += ` <span class="dim">(+${deletedFiles} deleted)</span>`;
        html += ` \u2014 ${totalSectors} used, ${freeSectors} free sectors`;
        html += '</span></div>';

        if (panel.expandedBlock === -2) {
            html += '<div class="editor-inline-edit" data-edit-idx="-2">';
            html += `<label>Label:</label><input type="text" maxlength="8" value="${panel.diskLabel.replace(/\s+$/, '')}" data-field="label" style="width:100px">`;
            html += '<button class="editor-apply-btn" data-action="disk-apply" data-idx="-2">Apply</button>';
            html += '</div>';
        }

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const file = panel.diskFiles[i];
            const isSel = panel.selection.has(i);
            const isExpanded = panel.expandedBlock === i;

            let rowClasses = 'editor-block-row disk-row';
            if (file.deleted) rowClasses += ' disk-deleted';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span> `;
            html += `<span class="file-ext">${file.ext}</span>`;
            html += `<span class="file-name">${file.name.replace(/\s+$/, '')}</span>`;
            html += ` <span class="file-addr">@ $${hex16(file.startAddress)}</span>`;
            html += ` <span class="file-size">\u2014 ${file.length} bytes</span>`;
            html += ` <span class="file-sectors">(${file.sectors} sectors)</span>`;
            if (file.deleted) html += ' <span class="bad">[DEL]</span>';
            html += '</span></div>';

            if (isExpanded) {
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<label>Name:</label><input type="text" maxlength="8" value="${file.name.replace(/\s+$/, '')}" data-field="name" style="width:80px">`;
                html += `<label>Ext:</label><select data-field="ext">`;
                for (const e of ['C', 'B', 'D', '#']) {
                    html += `<option value="${e}"${file.ext === e ? ' selected' : ''}>${e}</option>`;
                }
                html += '</select>';
                html += `<label>Addr:</label><input type="text" value="${hex16(file.startAddress)}" data-field="addr" maxlength="4" style="width:60px">`;
                html += `<label class="dim">${file.length} bytes, ${file.sectors} sectors</label>`;
                html += `<button class="editor-apply-btn" data-action="disk-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${activeFiles} files, ${selCount} sel \u2014 ${freeSectors} free`;
        } else {
            panel.dom.statusSpan.textContent = `${activeFiles} files \u2014 ${freeSectors} free`;
        }
        editorUpdateToolbar();
    }

    function diskEditorMoveSelection(panel, dir) {
        const sorted = editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        if (dir === -1 && sorted[0] === 0) return;
        if (dir === 1 && sorted[sorted.length - 1] === panel.diskFiles.length - 1) return;

        const order = dir === -1 ? sorted : sorted.slice().reverse();
        const newSel = new Set();
        for (const idx of order) {
            const newIdx = idx + dir;
            const temp = panel.diskFiles[idx];
            panel.diskFiles[idx] = panel.diskFiles[newIdx];
            panel.diskFiles[newIdx] = temp;
            newSel.add(newIdx);
        }
        panel.selection = newSel;
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
    }

    function diskEditorDeleteSelection(panel) {
        if (panel.selection.size === 0) return;
        const sorted = editorSelectedSorted(panel).reverse();
        for (const idx of sorted) {
            panel.diskFiles.splice(idx, 1);
        }
        panel.selection.clear();
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
        if (panel.fileType === 'mgt') mgtEditorRefreshExplorer(panel);
        else if (panel.fileType === 'mdr') mdrEditorRefreshExplorer(panel);
        else if (panel.fileType === 'opd') opdEditorRefreshExplorer(panel);
        else diskEditorRefreshExplorer(panel);
    }

    function diskEditorMarkDeletedSelection(panel) {
        if (panel.selection.size === 0) return;
        const sorted = editorSelectedSorted(panel);
        const allDeleted = sorted.every(idx => panel.diskFiles[idx].deleted);
        for (const idx of sorted) {
            panel.diskFiles[idx].deleted = !allDeleted;
        }
        panel.expandedBlock = -1;
        editorRenderBlockList(panel);
    }

    function diskEditorExtractSelection(panel, format) {
        const sorted = editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        const baseName = (panel.fileName || 'extract').replace(/\.(trd|scl|mgt|mdr|img)$/i, '');
        const asHobeta = format === 'hobeta';

        if (sorted.length === 1) {
            const file = panel.diskFiles[sorted[0]];
            const trimName = file.name.replace(/\s+$/, '');
            let name, data;
            if (asHobeta) {
                name = trimName + '.' + trdExtToHobetaExt(file.ext);
                data = buildHobeta(file);
            } else {
                name = trimName + '.' + file.ext;
                data = file.data.slice(0, file.length);
            }
            const blob = new Blob([data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
        }

        const files = sorted.map(idx => {
            const file = panel.diskFiles[idx];
            const trimName = file.name.replace(/\s+$/, '');
            if (asHobeta) {
                return {
                    name: trimName + '.' + trdExtToHobetaExt(file.ext),
                    data: buildHobeta(file)
                };
            }
            return {
                name: trimName + '.' + file.ext,
                data: file.data.slice(0, file.length)
            };
        });
        const zipData = editorCreateZip(files);
        const blob = new Blob([zipData], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '_extract.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function diskEditorNewTrd(panel) {
        panel.diskFiles = [];
        panel.diskLabel = '        ';
        panel.blocks = [];
        panel.parsedFile = { type: 'trd', files: [], diskTitle: '', freeSectors: 2544, size: 0 };
        panel.fileType = 'trd';
        panel.rawData = new Uint8Array(0);
        panel.fileName = 'new.trd';
        panel.selection.clear();
        panel.expandedBlock = -1;
        updatePanelHeader(panel);
        diskEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function diskEditorAddFile(panel, data, name, ext, addr) {
        const length = data.length;
        const sectors = Math.ceil(length / 256);
        if (sectors > 255) return 'File too large (max 255 sectors / 65,280 bytes)';
        if (panel.diskFiles.length >= 128) return 'Directory full (max 128 files)';
        if (diskEditorTotalSectors(panel) + sectors > 2544) return 'Disk full (not enough free sectors)';

        const paddedData = new Uint8Array(sectors * 256);
        paddedData.set(data);
        const paddedName = (name + '        ').substring(0, 8);

        panel.diskFiles.push({
            name: paddedName,
            ext: ext,
            startAddress: addr,
            length: length,
            sectors: sectors,
            data: paddedData,
            deleted: false
        });
        return null;
    }

    function diskEditorImportDisk(panel, data, filename) {
        const ext = filename.split('.').pop().toLowerCase();
        let files;

        if (ext === 'scl') {
            const sig = String.fromCharCode(...data.slice(0, 8));
            if (sig !== 'SINCLAIR') return 'Invalid SCL signature';
            const fileCount = data[8];
            let offset = 9;
            files = [];
            for (let i = 0; i < fileCount; i++) {
                const name = String.fromCharCode(...data.slice(offset, offset + 8));
                const fext = String.fromCharCode(data[offset + 8]);
                const startAddr = data[offset + 9] | (data[offset + 10] << 8);
                const length = data[offset + 11] | (data[offset + 12] << 8);
                const sectors = data[offset + 13];
                files.push({ name, ext: fext, startAddress: startAddr, length, sectors });
                offset += 14;
            }
            let dataOffset = offset;
            for (const f of files) {
                const dataSize = f.sectors * 256;
                f.data = new Uint8Array(dataSize);
                f.data.set(data.slice(dataOffset, dataOffset + dataSize));
                dataOffset += dataSize;
            }
        } else {
            if (data.length < 4096) return 'File too small for TRD';
            files = [];
            for (let i = 0; i < 128; i++) {
                const entryOffset = i * 16;
                if (data[entryOffset] === 0) break;
                if (data[entryOffset] === 1) continue;
                const name = String.fromCharCode(...data.slice(entryOffset, entryOffset + 8));
                const fext = String.fromCharCode(data[entryOffset + 8]);
                const startAddr = data[entryOffset + 9] | (data[entryOffset + 10] << 8);
                const length = data[entryOffset + 11] | (data[entryOffset + 12] << 8);
                const sectors = data[entryOffset + 13];
                const startSector = data[entryOffset + 14];
                const startTrack = data[entryOffset + 15];
                const fileOffset = (startTrack * 16 + startSector) * 256;
                const dataSize = sectors * 256;
                const fileData = new Uint8Array(dataSize);
                fileData.set(data.slice(fileOffset, fileOffset + dataSize));
                files.push({ name, ext: fext, startAddress: startAddr, length, sectors, data: fileData });
            }
        }

        let skipped = 0;
        for (const f of files) {
            if (panel.diskFiles.length >= 128) { skipped++; continue; }
            if (diskEditorTotalSectors(panel) + f.sectors > 2544) { skipped++; continue; }
            panel.diskFiles.push({
                name: (f.name + '        ').substring(0, 8),
                ext: f.ext,
                startAddress: f.startAddress,
                length: f.length,
                sectors: f.sectors,
                data: f.data,
                deleted: false
            });
        }
        return skipped > 0 ? `Imported ${files.length - skipped} files, ${skipped} skipped (capacity)` : null;
    }

    function diskEditorBuildTrd(panel) {
        const trd = new Uint8Array(655360);
        let trdSector = 16;
        let activeFileCount = 0;

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const f = panel.diskFiles[i];
            const entryOffset = i * 16;

            for (let c = 0; c < 8; c++) {
                trd[entryOffset + c] = f.name.charCodeAt(c);
            }
            if (f.deleted) {
                trd[entryOffset] = 0x01;
            } else {
                activeFileCount++;
            }
            trd[entryOffset + 8] = f.ext.charCodeAt(0);
            trd[entryOffset + 9] = f.startAddress & 0xFF;
            trd[entryOffset + 10] = (f.startAddress >> 8) & 0xFF;
            trd[entryOffset + 11] = f.length & 0xFF;
            trd[entryOffset + 12] = (f.length >> 8) & 0xFF;
            trd[entryOffset + 13] = f.sectors;
            const startSector = trdSector % 16;
            const startTrack = Math.floor(trdSector / 16);
            trd[entryOffset + 14] = startSector;
            trd[entryOffset + 15] = startTrack;

            const dataOffset = trdSector * 256;
            trd.set(f.data.subarray(0, f.sectors * 256), dataOffset);
            trdSector += f.sectors;
        }

        const info = 0x800;
        trd[info + 0xE1] = trdSector % 16;
        trd[info + 0xE2] = Math.floor(trdSector / 16);
        trd[info + 0xE3] = 0x16;
        trd[info + 0xE4] = activeFileCount;
        const freeSectors = 2560 - trdSector;
        trd[info + 0xE5] = freeSectors & 0xFF;
        trd[info + 0xE6] = (freeSectors >> 8) & 0xFF;
        trd[info + 0xE7] = 0x10;

        for (let c = 0; c < 8; c++) {
            trd[info + 0xF5 + c] = panel.diskLabel.charCodeAt(c) || 0x20;
        }

        return trd;
    }

    function diskEditorBuildScl(panel) {
        const activeFiles = panel.diskFiles.filter(f => !f.deleted);

        let totalDataSize = 0;
        for (const f of activeFiles) totalDataSize += f.sectors * 256;
        const headerSize = 9 + activeFiles.length * 14;
        const scl = new Uint8Array(headerSize + totalDataSize);

        const sig = 'SINCLAIR';
        for (let i = 0; i < 8; i++) scl[i] = sig.charCodeAt(i);
        scl[8] = activeFiles.length;

        let offset = 9;
        for (const f of activeFiles) {
            for (let c = 0; c < 8; c++) {
                scl[offset + c] = f.name.charCodeAt(c) || 0x20;
            }
            scl[offset + 8] = f.ext.charCodeAt(0);
            scl[offset + 9] = f.startAddress & 0xFF;
            scl[offset + 10] = (f.startAddress >> 8) & 0xFF;
            scl[offset + 11] = f.length & 0xFF;
            scl[offset + 12] = (f.length >> 8) & 0xFF;
            scl[offset + 13] = f.sectors;
            offset += 14;
        }

        for (const f of activeFiles) {
            scl.set(f.data.subarray(0, f.sectors * 256), offset);
            offset += f.sectors * 256;
        }

        return scl;
    }

    function diskEditorSaveDisk(panel) {
        if (panel.diskFiles.length === 0) return;
        const isSCL = panel.fileType === 'scl';
        const data = isSCL ? diskEditorBuildScl(panel) : diskEditorBuildTrd(panel);
        const ext = isSCL ? '.scl' : '.trd';
        const baseName = (panel.fileName || 'output').replace(/\.(trd|scl)$/i, '');
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function diskEditorApplyInlineEdit(panel, idx) {
        if (idx === -2) {
            const editRow = panel.dom.fileList.querySelector('.editor-inline-edit[data-edit-idx="-2"]');
            if (!editRow) return;
            const labelInput = editRow.querySelector('[data-field="label"]');
            const raw = labelInput ? labelInput.value : '';
            panel.diskLabel = (raw + '        ').substring(0, 8);
            panel.expandedBlock = -1;
            diskEditorRenderFileList(panel);
            diskEditorRefreshExplorer(panel);
            return;
        }

        if (idx < 0 || idx >= panel.diskFiles.length) return;
        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const extSelect = editRow.querySelector('[data-field="ext"]');
        const addrInput = editRow.querySelector('[data-field="addr"]');

        const file = panel.diskFiles[idx];
        if (nameInput) {
            file.name = (nameInput.value + '        ').substring(0, 8);
        }
        if (extSelect) {
            file.ext = extSelect.value;
        }
        if (addrInput) {
            file.startAddress = parseInt(addrInput.value, 16) || 0;
        }

        panel.expandedBlock = -1;
        diskEditorRenderFileList(panel);
        diskEditorRefreshExplorer(panel);
    }

    function diskEditorRefreshExplorer(panel) {
        const trd = diskEditorBuildTrd(panel);
        panel.rawData = trd;
        panel.parsedFile = explorerParseTRD(trd);
        syncPanelToExplorer(panel);
    }

    // ========== MGT Disk Editor Functions ==========

    const MGT_TYPE_NAMES = {
        0: 'Erased', 1: 'BASIC', 2: 'Num Array', 3: 'Str Array', 4: 'CODE',
        5: '48K Snap', 7: 'SCREEN$', 9: '128K Snap', 10: 'Opentype', 11: 'Execute'
    };

    function diskEditorExtractMgtFiles(panel) {
        if (panel.diskFiles.length > 0) return;
        if (!panel.parsedFile || panel.parsedFile.type !== 'mgt') return;
        if (!panel.rawData || panel.rawData.length === 0) return;

        const files = MGTLoader.listFiles(panel.rawData);
        for (const f of files) {
            const fileData = MGTLoader.extractFile(panel.rawData, f);
            const sectors = f.sectors;
            const paddedData = new Uint8Array(sectors * 512);
            paddedData.set(fileData.subarray(0, Math.min(fileData.length, sectors * 512)));
            panel.diskFiles.push({
                name: (f.name + '          ').substring(0, 10),
                ext: f.typeName.substring(0, 1).toUpperCase(),
                mgtType: f.type,
                tapeType: f.tapeType,
                typeName: f.typeName,
                startAddress: f.startAddress,
                length: f.length,
                sectors: sectors,
                data: paddedData,
                autostart: f.autostart,
                bodyLength: f.bodyLength,
                deleted: false
            });
        }
    }

    function mgtEditorTotalSectors(panel) {
        let total = 0;
        for (const f of panel.diskFiles) total += f.sectors;
        return total;
    }

    function mgtEditorRenderFileList(panel) {
        diskEditorExtractMgtFiles(panel);

        if (panel.diskFiles.length === 0) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty MGT disk. Use "Add File" to add files.</span>';
            panel.dom.statusSpan.textContent = '0 files';
            editorUpdateToolbar();
            return;
        }

        const totalSectors = mgtEditorTotalSectors(panel);
        // MGT: 80 tracks × 2 sides × 10 sectors = 1600 total; directory uses tracks 0-1 = 40 sectors
        const freeSectors = 1560 - totalSectors;
        const activeFiles = panel.diskFiles.filter(f => !f.deleted).length;
        const deletedFiles = panel.diskFiles.length - activeFiles;

        let html = '';
        html += '<div class="editor-block-row disk-label-row">';
        html += '<span class="editor-block-info">';
        html += `MGT Disk \u2014 ${activeFiles} file${activeFiles !== 1 ? 's' : ''}`;
        if (deletedFiles > 0) html += ` <span class="dim">(+${deletedFiles} deleted)</span>`;
        html += ` \u2014 ${totalSectors} used, ${freeSectors} free sectors`;
        html += '</span></div>';

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const file = panel.diskFiles[i];
            const isSel = panel.selection.has(i);
            const isExpanded = panel.expandedBlock === i;
            const tName = file.typeName || MGT_TYPE_NAMES[file.mgtType] || 'Unknown';

            let rowClasses = 'editor-block-row disk-row';
            if (file.deleted) rowClasses += ' disk-deleted';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span> `;
            html += `<span class="file-mgttype">${tName}</span>`;
            html += `<span class="file-name">${file.name.replace(/\s+$/, '')}</span>`;
            html += ` <span class="file-addr">@ $${hex16(file.startAddress)}</span>`;
            html += ` <span class="file-size">\u2014 ${file.length} bytes</span>`;
            html += ` <span class="file-sectors">(${file.sectors} sectors)</span>`;
            if (file.deleted) html += ' <span class="bad">[DEL]</span>';
            html += '</span></div>';

            if (isExpanded) {
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<label>Name:</label><input type="text" maxlength="10" value="${file.name.replace(/\s+$/, '')}" data-field="name" style="width:100px">`;
                html += `<label>Type:</label><select data-field="mgttype">`;
                for (const [k, v] of Object.entries(MGT_TYPE_NAMES)) {
                    if (k === '0') continue; // skip Erased
                    html += `<option value="${k}"${file.mgtType === parseInt(k) ? ' selected' : ''}>${v}</option>`;
                }
                html += '</select>';
                html += `<label>Addr:</label><input type="text" value="${hex16(file.startAddress)}" data-field="addr" maxlength="4" style="width:60px">`;
                html += `<label class="dim">${file.length} bytes, ${file.sectors} sectors</label>`;
                html += `<button class="editor-apply-btn" data-action="mgt-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${activeFiles} files, ${selCount} sel \u2014 ${freeSectors} free`;
        } else {
            panel.dom.statusSpan.textContent = `${activeFiles} files \u2014 ${freeSectors} free`;
        }
        editorUpdateToolbar();
    }

    function diskEditorNewMgt(panel) {
        panel.diskFiles = [];
        panel.diskLabel = '';
        panel.blocks = [];
        panel.parsedFile = { type: 'mgt', files: [], info: null, size: 0 };
        panel.fileType = 'mgt';
        panel.rawData = new Uint8Array(0);
        panel.fileName = 'new.mgt';
        panel.selection.clear();
        panel.expandedBlock = -1;
        updatePanelHeader(panel);
        mgtEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function diskEditorAddMgtFile(panel, data, name, mgtType, addr) {
        const length = data.length;
        const sectors = Math.ceil(length / 512);
        if (sectors > 195) return 'File too large (max 195 sectors / 99,840 bytes)';
        if (panel.diskFiles.length >= 80) return 'Directory full (max 80 files)';
        if (mgtEditorTotalSectors(panel) + sectors > 1560) return 'Disk full (not enough free sectors)';

        const paddedData = new Uint8Array(sectors * 512);
        paddedData.set(data);
        const paddedName = (name + '          ').substring(0, 10);

        // Map mgtType to tapeType and typeName
        const tapeTypeMap = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 3, 7: 3, 9: 3, 10: 3, 11: 3 };
        const tapeType = tapeTypeMap[mgtType] !== undefined ? tapeTypeMap[mgtType] : 3;
        const typeName = MGT_TYPE_NAMES[mgtType] || 'CODE';

        panel.diskFiles.push({
            name: paddedName,
            ext: typeName.substring(0, 1).toUpperCase(),
            mgtType: mgtType,
            tapeType: tapeType,
            typeName: typeName,
            startAddress: addr,
            length: length,
            sectors: sectors,
            data: paddedData,
            autostart: null,
            bodyLength: null,
            deleted: false
        });
        return null;
    }

    function diskEditorBuildMgt(panel) {
        const mgt = new Uint8Array(819200);
        // Directory: slots 0-79 in tracks 0-1 (4 directory tracks: T0S0, T0S1, T1S0, T1S1)
        // Data starts at track 2, side 0, sector 1

        let nextTrack = 2, nextSide = 0, nextSector = 1;

        function advanceSector() {
            nextSector++;
            if (nextSector > 10) {
                nextSector = 1;
                nextSide++;
                if (nextSide > 1) {
                    nextSide = 0;
                    nextTrack++;
                }
            }
        }

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const f = panel.diskFiles[i];
            const slotIndex = i;

            // Directory entry offset: slot N → sectorIndex = floor(N/2), entry-in-sector = N%2
            const sectorIndex = Math.floor(slotIndex / 2);
            const entryInSector = slotIndex % 2;
            // sectorIndex maps to: track = floor(sectorIndex/10), which side/track in image:
            // 0-9 = T0 S0, 10-19 = T0 S1, 20-29 = T1 S0, 30-39 = T1 S1
            const dirLogical = sectorIndex;
            const dirTrack = Math.floor(dirLogical / 20);
            const dirRemain = dirLogical % 20;
            const dirSide = dirRemain >= 10 ? 1 : 0;
            const dirSec = (dirRemain % 10) + 1;
            const dirOffset = ((dirTrack * 2 + dirSide) * 10 + (dirSec - 1)) * 512 + entryInSector * 256;

            // File type
            if (f.deleted) {
                mgt[dirOffset] = 0;
                continue;
            }
            mgt[dirOffset] = f.mgtType || 4;

            // Filename (10 bytes, space-padded)
            for (let c = 0; c < 10; c++) {
                mgt[dirOffset + 1 + c] = c < f.name.length ? f.name.charCodeAt(c) : 0x20;
            }

            // Sector count (big-endian)
            mgt[dirOffset + 11] = (f.sectors >> 8) & 0xFF;
            mgt[dirOffset + 12] = f.sectors & 0xFF;

            // First sector track and sector
            const firstTrack = nextSide === 0 ? nextTrack : nextTrack + 128;
            mgt[dirOffset + 13] = firstTrack;
            mgt[dirOffset + 14] = nextSector;

            // Sector address map (up to 195 pairs at offset 15-209)
            const sectorMap = [];
            const savedTrack = nextTrack, savedSide = nextSide, savedSector = nextSector;
            for (let s = 0; s < f.sectors; s++) {
                const mapTrack = nextSide === 0 ? nextTrack : nextTrack + 128;
                sectorMap.push(mapTrack, nextSector);

                // Write file data to this sector
                const imgOffset = ((nextTrack * 2 + nextSide) * 10 + (nextSector - 1)) * 512;
                const srcOffset = s * 512;
                mgt.set(f.data.subarray(srcOffset, srcOffset + 512), imgOffset);

                advanceSector();
            }

            for (let m = 0; m < sectorMap.length && m < 390; m++) {
                mgt[dirOffset + 15 + m] = sectorMap[m];
            }

            // Tape type
            mgt[dirOffset + 211] = f.tapeType !== undefined ? f.tapeType : 3;

            // File data length (LSB, MSB)
            mgt[dirOffset + 212] = f.length & 0xFF;
            mgt[dirOffset + 213] = (f.length >> 8) & 0xFF;

            // Param 1: start address (CODE) / autostart (BASIC)
            const param1 = f.mgtType === 1 ? (f.autostart || 0x8000) : (f.startAddress || 0);
            mgt[dirOffset + 214] = param1 & 0xFF;
            mgt[dirOffset + 215] = (param1 >> 8) & 0xFF;

            // Param 2: body length (BASIC) / 32768 (CODE)
            const param2 = f.mgtType === 1 ? (f.bodyLength || f.length) : 0x8000;
            mgt[dirOffset + 216] = param2 & 0xFF;
            mgt[dirOffset + 217] = (param2 >> 8) & 0xFF;
        }

        return mgt;
    }

    function diskEditorSaveMgt(panel) {
        if (panel.diskFiles.length === 0) return;
        const data = diskEditorBuildMgt(panel);
        const baseName = (panel.fileName || 'output').replace(/\.(mgt|img)$/i, '');
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '.mgt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function diskEditorImportMgt(panel, data, filename) {
        const files = MGTLoader.listFiles(data);
        let skipped = 0;
        for (const f of files) {
            if (panel.diskFiles.length >= 80) { skipped++; continue; }
            const sectors = f.sectors;
            if (mgtEditorTotalSectors(panel) + sectors > 1560) { skipped++; continue; }
            const fileData = MGTLoader.extractFile(data, f);
            const paddedData = new Uint8Array(sectors * 512);
            paddedData.set(fileData.subarray(0, Math.min(fileData.length, sectors * 512)));
            panel.diskFiles.push({
                name: (f.name + '          ').substring(0, 10),
                ext: f.typeName.substring(0, 1).toUpperCase(),
                mgtType: f.type,
                tapeType: f.tapeType,
                typeName: f.typeName,
                startAddress: f.startAddress,
                length: f.length,
                sectors: sectors,
                data: paddedData,
                autostart: f.autostart,
                bodyLength: f.bodyLength,
                deleted: false
            });
        }
        return skipped > 0 ? `Imported ${files.length - skipped} files, ${skipped} skipped (capacity)` : null;
    }

    function mgtEditorApplyInlineEdit(panel, idx) {
        if (idx < 0 || idx >= panel.diskFiles.length) return;
        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const typeSelect = editRow.querySelector('[data-field="mgttype"]');
        const addrInput = editRow.querySelector('[data-field="addr"]');

        const file = panel.diskFiles[idx];
        if (nameInput) {
            file.name = (nameInput.value + '          ').substring(0, 10);
        }
        if (typeSelect) {
            const newType = parseInt(typeSelect.value);
            file.mgtType = newType;
            file.typeName = MGT_TYPE_NAMES[newType] || 'CODE';
            file.ext = file.typeName.substring(0, 1).toUpperCase();
            // Update tapeType based on mgtType
            const tapeTypeMap = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 3, 7: 3, 9: 3, 10: 3, 11: 3 };
            file.tapeType = tapeTypeMap[newType] !== undefined ? tapeTypeMap[newType] : 3;
        }
        if (addrInput) {
            file.startAddress = parseInt(addrInput.value, 16) || 0;
        }

        panel.expandedBlock = -1;
        mgtEditorRenderFileList(panel);
        mgtEditorRefreshExplorer(panel);
    }

    function mgtEditorRefreshExplorer(panel) {
        const mgt = diskEditorBuildMgt(panel);
        panel.rawData = mgt;
        panel.parsedFile = explorerParseMGT(mgt);
        syncPanelToExplorer(panel);
    }

    // ========== MDR (Microdrive) Editor Functions (parameterized) ==========

    function diskEditorExtractMdrFiles(panel) {
        if (panel.diskFiles.length > 0) return;
        if (!panel.parsedFile || panel.parsedFile.type !== 'mdr') return;
        if (!panel.rawData || panel.rawData.length === 0) return;

        const files = MDRLoader.listFiles(panel.rawData);
        for (const f of files) {
            const fileData = MDRLoader.extractFile(panel.rawData, f);
            panel.diskFiles.push({
                name: (f.name + '          ').substring(0, 10),
                ext: f.type === 'PRINT' ? 'P' : 'F',
                typeName: f.type,
                length: f.length,
                sectors: f.sectors,
                sectorIndices: f.sectorIndices,
                isPrint: f.isPrint,
                data: fileData,
                deleted: false
            });
        }
    }

    function mdrEditorRenderFileList(panel) {
        diskEditorExtractMdrFiles(panel);

        if (panel.diskFiles.length === 0) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty MDR cartridge. Use "Add File" to add files.</span>';
            panel.dom.statusSpan.textContent = '0 files';
            editorUpdateToolbar();
            return;
        }

        const info = MDRLoader.getDiskInfo(panel.rawData);
        const activeFiles = panel.diskFiles.filter(f => !f.deleted).length;
        const deletedFiles = panel.diskFiles.length - activeFiles;

        let html = '';
        html += '<div class="editor-block-row disk-label-row">';
        html += '<span class="editor-block-info">';
        html += `MDR Cartridge \u2014 ${activeFiles} file${activeFiles !== 1 ? 's' : ''}`;
        if (deletedFiles > 0) html += ` <span class="dim">(+${deletedFiles} deleted)</span>`;
        html += ` \u2014 ${info.usedSectors} used, ${info.freeSectors} free sectors`;
        html += '</span></div>';

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const file = panel.diskFiles[i];
            const isSel = panel.selection.has(i);
            const isExpanded = panel.expandedBlock === i;

            let rowClasses = 'editor-block-row disk-row';
            if (file.deleted) rowClasses += ' disk-deleted';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span> `;
            html += `<span class="file-mgttype">${file.typeName}</span>`;
            html += `<span class="file-name">${file.name.replace(/\s+$/, '')}</span>`;
            html += ` <span class="file-size">\u2014 ${file.length} bytes</span>`;
            html += ` <span class="file-sectors">(${file.sectors} sectors)</span>`;
            if (file.deleted) html += ' <span class="bad">[DEL]</span>';
            html += '</span></div>';

            if (isExpanded) {
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<label>Name:</label><input type="text" maxlength="10" value="${file.name.replace(/\s+$/, '')}" data-field="name" style="width:100px">`;
                html += `<label>Type:</label><select data-field="mdrtype">`;
                html += `<option value="F"${!file.isPrint ? ' selected' : ''}>File</option>`;
                html += `<option value="P"${file.isPrint ? ' selected' : ''}>PRINT</option>`;
                html += '</select>';
                html += `<label class="dim">${file.length} bytes, ${file.sectors} sectors</label>`;
                html += `<button class="editor-apply-btn" data-action="mdr-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${activeFiles} files, ${selCount} sel \u2014 ${info.freeSectors} free`;
        } else {
            panel.dom.statusSpan.textContent = `${activeFiles} files \u2014 ${info.freeSectors} free`;
        }
        editorUpdateToolbar();
    }

    function diskEditorNewMdr(panel) {
        panel.diskFiles = [];
        panel.diskLabel = '';
        panel.blocks = [];
        panel.parsedFile = { type: 'mdr', files: [], info: null, size: 0 };
        panel.fileType = 'mdr';
        panel.rawData = MDRLoader.createBlankMDR();
        panel.fileName = 'new.mdr';
        panel.selection.clear();
        panel.expandedBlock = -1;
        updatePanelHeader(panel);
        mdrEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function diskEditorAddMdrFile(panel, data, name, isPrint) {
        const length = data.length;
        const sectors = Math.ceil(length / MDRLoader.DATA_SIZE) || 1;
        if (sectors > MDRLoader.SECTOR_COUNT) return 'File too large';

        panel.diskFiles.push({
            name: (name + '          ').substring(0, 10),
            ext: isPrint ? 'P' : 'F',
            typeName: isPrint ? 'PRINT' : 'File',
            length: length,
            sectors: sectors,
            sectorIndices: [],
            isPrint: isPrint,
            data: new Uint8Array(data),
            deleted: false
        });
        return null;
    }

    function diskEditorBuildMdr(panel) {
        const files = panel.diskFiles.filter(f => !f.deleted).map(f => ({
            name: f.name.replace(/\s+$/, ''),
            data: f.data.slice(0, f.length),
            isPrint: f.isPrint
        }));
        const cartridgeName = panel.diskLabel || 'BLANK';
        return MDRLoader.buildMDR(files, cartridgeName);
    }

    function diskEditorSaveMdr(panel) {
        if (panel.diskFiles.length === 0) return;
        const data = diskEditorBuildMdr(panel);
        const baseName = (panel.fileName || 'output').replace(/\.mdr$/i, '');
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '.mdr';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function diskEditorImportMdr(panel, data, filename) {
        const files = MDRLoader.listFiles(data);
        let skipped = 0;
        for (const f of files) {
            const fileData = MDRLoader.extractFile(data, f);
            panel.diskFiles.push({
                name: (f.name + '          ').substring(0, 10),
                ext: f.type === 'PRINT' ? 'P' : 'F',
                typeName: f.type,
                length: f.length,
                sectors: f.sectors,
                sectorIndices: f.sectorIndices,
                isPrint: f.isPrint,
                data: fileData,
                deleted: false
            });
        }
        return skipped > 0 ? `Imported ${files.length - skipped} files, ${skipped} skipped` : null;
    }

    function mdrEditorApplyInlineEdit(panel, idx) {
        if (idx < 0 || idx >= panel.diskFiles.length) return;
        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const typeSelect = editRow.querySelector('[data-field="mdrtype"]');

        const file = panel.diskFiles[idx];
        if (nameInput) {
            file.name = (nameInput.value + '          ').substring(0, 10);
        }
        if (typeSelect) {
            file.isPrint = typeSelect.value === 'P';
            file.ext = file.isPrint ? 'P' : 'F';
            file.typeName = file.isPrint ? 'PRINT' : 'File';
        }

        panel.expandedBlock = -1;
        // Rebuild MDR image and refresh
        const mdr = diskEditorBuildMdr(panel);
        panel.rawData = mdr;
        panel.parsedFile = explorerParseMDR(mdr);
        mdrEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function mdrEditorRefreshExplorer(panel) {
        const mdr = diskEditorBuildMdr(panel);
        panel.rawData = mdr;
        panel.parsedFile = explorerParseMDR(mdr);
        syncPanelToExplorer(panel);
    }

    // ========== OPD (Opus Discovery) Editor Functions ==========

    function diskEditorNewOpd(panel) {
        panel.diskFiles = [];
        panel.diskLabel = '';
        panel.blocks = [];
        panel.parsedFile = { type: 'opd', files: [], info: OPDLoader.getDiskInfo(OPDLoader.createBlankOPD(1)), size: OPDLoader.SS_SIZE };
        panel.fileType = 'opd';
        panel.rawData = OPDLoader.createBlankOPD(1);
        panel.fileName = 'new.opd';
        panel.selection.clear();
        panel.expandedBlock = -1;
        updatePanelHeader(panel);
        opdEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function diskEditorExtractOpdFiles(panel) {
        const files = OPDLoader.listFiles(panel.rawData);
        panel.diskFiles = [];
        for (const f of files) {
            const fileData = OPDLoader.extractFile(panel.rawData, f);
            panel.diskFiles.push({
                name: (f.name + '          ').substring(0, 10),
                ext: f.ext,
                type: f.type,
                typeName: f.typeName,
                length: f.length,
                startAddr: f.startAddr,
                autostart: f.autostart,
                data: fileData ? new Uint8Array(fileData) : new Uint8Array(0),
                deleted: false
            });
        }
        panel.blocks = panel.diskFiles;
        const info = OPDLoader.getDiskInfo(panel.rawData);
        panel.diskLabel = info.diskLabel || '';
    }

    function diskEditorAddOpdFile(panel, data, name, type, startAddr, autostart) {
        const sides = OPDLoader.isDoubleSided(panel.rawData) ? 2 : 1;
        const typeNames = { 0: 'BASIC', 1: 'Number array', 2: 'String array', 3: 'CODE' };
        const extMap = { 0: 'B', 1: 'D', 2: 'D', 3: 'C' };
        panel.diskFiles.push({
            name: (name + '          ').substring(0, 10),
            ext: extMap[type] || 'C',
            type: type,
            typeName: typeNames[type] || 'CODE',
            length: data.length,
            startAddr: startAddr || 0,
            autostart: autostart || 0,
            data: new Uint8Array(data),
            deleted: false
        });
        // Rebuild the OPD image from diskFiles
        opdEditorRebuildImage(panel);
        return null;
    }

    function opdEditorRebuildImage(panel) {
        const sides = OPDLoader.isDoubleSided(panel.rawData) ? 2 : 1;
        const files = panel.diskFiles.filter(f => !f.deleted).map(f => ({
            name: f.name.replace(/\s+$/, ''),
            type: f.type >= 0 ? f.type : 3,
            length: f.data.length,
            startAddr: f.startAddr || 0,
            autostart: f.autostart || 0,
            data: f.data
        }));
        const newImage = OPDLoader.buildOPD(files, panel.diskLabel || '', sides, panel.rawData);
        panel.rawData = newImage;
        panel.parsedFile = explorerParseOPD(newImage);
        panel.blocks = panel.diskFiles;
    }

    function opdEditorRenderFileList(panel) {
        const info = OPDLoader.getDiskInfo(panel.rawData);
        const sides = OPDLoader.isDoubleSided(panel.rawData) ? 2 : 1;

        let html = '';
        html += '<div class="editor-block-row disk-label-row" data-label-row="1">';
        html += '<span class="editor-block-info">';
        html += `OPD Disk (${sides === 2 ? 'DS' : 'SS'}) \u2014 `;
        html += `${info.fileCount} files, ${info.usedSectors} used, ${info.freeSectors} free of ${info.totalSectors} sectors`;
        if (info.diskLabel) html += ` \u2014 "${escapeHtml(info.diskLabel)}"`;
        html += '</span></div>';

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const f = panel.diskFiles[i];
            if (f.deleted) continue;
            const selected = panel.selection.has(i);
            const trimName = f.name.replace(/\s+$/, '');
            const addrStr = f.type === 3 ? `$${hex16(f.startAddr || 0)}` : '';

            html += `<div class="editor-block-row${selected ? ' selected' : ''}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="file-name">${escapeHtml(trimName)}</span>`;
            html += ` <span class="file-ext">${f.typeName}</span>`;
            html += ` <span class="file-size">${f.length.toLocaleString()}</span>`;
            if (addrStr) html += ` <span class="file-addr">${addrStr}</span>`;
            html += '</span></div>';

            if (panel.expandedBlock === i) {
                const typeOptions = [0, 3].map(t => {
                    const names = { 0: 'BASIC', 3: 'CODE' };
                    return `<option value="${t}"${t === f.type ? ' selected' : ''}>${names[t]}</option>`;
                }).join('');
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<label>Name: <input type="text" data-field="name" value="${escapeHtml(trimName)}" maxlength="10" class="editor-input"></label>`;
                html += ` <label>Type: <select data-field="opdtype" class="editor-input">${typeOptions}</select></label>`;
                if (f.type === 3) {
                    html += ` <label>Addr: <input type="text" data-field="addr" value="${hex16(f.startAddr || 0)}" maxlength="4" class="editor-input editor-input-short"></label>`;
                }
                html += ` <button class="btn" data-action="opd-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;
        panel.dom.statusSpan.textContent = `${sides === 2 ? 'DS' : 'SS'} ${info.fileCount} files, ${info.usedSectors}/${info.totalSectors} sectors`;
        editorUpdateToolbar();
    }

    function opdEditorApplyInlineEdit(panel, idx) {
        if (idx < 0 || idx >= panel.diskFiles.length) return;
        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const typeSelect = editRow.querySelector('[data-field="opdtype"]');
        const addrInput = editRow.querySelector('[data-field="addr"]');

        const file = panel.diskFiles[idx];
        if (nameInput) {
            file.name = (nameInput.value + '          ').substring(0, 10);
        }
        if (typeSelect) {
            const newType = parseInt(typeSelect.value);
            file.type = newType;
            const typeNames = { 0: 'BASIC', 1: 'Number array', 2: 'String array', 3: 'CODE' };
            const extMap = { 0: 'B', 1: 'D', 2: 'D', 3: 'C' };
            file.typeName = typeNames[newType] || 'CODE';
            file.ext = extMap[newType] || 'C';
        }
        if (addrInput) {
            file.startAddr = parseInt(addrInput.value, 16) || 0;
        }

        panel.expandedBlock = -1;
        opdEditorRebuildImage(panel);
        opdEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function opdEditorRefreshExplorer(panel) {
        opdEditorRebuildImage(panel);
        syncPanelToExplorer(panel);
    }

    function diskEditorSaveOpd(panel) {
        if (!panel.rawData || panel.rawData.length === 0) return;
        const baseName = (panel.fileName || 'output').replace(/\.opd$/i, '').replace(/\.opu$/i, '');
        const blob = new Blob([panel.rawData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '.opd';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function opdEditorDeleteSelection(panel) {
        if (panel.selection.size === 0) return;
        const sorted = editorSelectedSorted(panel).reverse();
        for (const idx of sorted) {
            panel.diskFiles.splice(idx, 1);
        }
        panel.selection.clear();
        panel.expandedBlock = -1;
        opdEditorRebuildImage(panel);
        opdEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function opdEditorExtractSelection(panel, format) {
        const sorted = editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        const baseName = (panel.fileName || 'extract').replace(/\.(opd|opu)$/i, '');
        const asTap = format === 'tap';

        if (sorted.length === 1) {
            const file = panel.diskFiles[sorted[0]];
            const trimName = file.name.replace(/\s+$/, '');
            let name, data;
            if (asTap) {
                name = trimName + '.tap';
                data = OPDLoader.fileToTAP(file.data.slice(0, file.length), {
                    name: trimName, type: file.type, startAddr: file.startAddr || 0, autostart: file.autostart || 0
                });
            } else {
                name = trimName + '.' + file.ext;
                data = file.data.slice(0, file.length);
            }
            const blob = new Blob([data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
        }

        const files = sorted.map(idx => {
            const file = panel.diskFiles[idx];
            const trimName = file.name.replace(/\s+$/, '');
            if (asTap) {
                return {
                    name: trimName + '.tap',
                    data: OPDLoader.fileToTAP(file.data.slice(0, file.length), {
                        name: trimName, type: file.type, startAddr: file.startAddr || 0, autostart: file.autostart || 0
                    })
                };
            }
            return {
                name: trimName + '.' + file.ext,
                data: file.data.slice(0, file.length)
            };
        });
        const zipData = editorCreateZip(files);
        const blob = new Blob([zipData], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '_extract.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ========== DSK (CP/M +3DOS) Editor Functions (parameterized) ==========

    function dskEditorRefreshState(panel) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        const buf = panel.parsedFile.dskImage.toBuffer();
        panel.rawData = buf;
        let files = [];
        try {
            files = DSKLoader.listFiles(panel.parsedFile.dskImage);
        } catch (e) { /* non-CP/M */ }
        panel.parsedFile.files = files;
        panel.blocks = files;
        syncPanelToExplorer(panel);
    }

    function dskEditorRenderFileList(panel) {
        if (!panel.parsedFile || panel.parsedFile.type !== 'dsk') return;
        const dskImage = panel.parsedFile.dskImage;
        if (!dskImage) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">No valid DSK image loaded</span>';
            panel.dom.statusSpan.textContent = '';
            editorUpdateToolbar();
            return;
        }

        const spec = DSKLoader.getDiskSpec(dskImage);
        const files = panel.parsedFile.files || [];

        if (!spec.valid && files.length === 0) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Non-CP/M disk \u2014 editing not supported for this format</span>';
            panel.dom.statusSpan.textContent = 'Non-CP/M disk';
            editorUpdateToolbar();
            return;
        }

        const allocMap = DSKLoader.getBlockAllocationMap(dskImage, spec);

        if (files.length === 0) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty disk. Use "Add File" to add files.</span>';
            panel.dom.statusSpan.textContent = `0 files \u2014 ${allocMap.freeBlocks} free blocks (${allocMap.freeBlocks * spec.blockSize} bytes)`;
            editorUpdateToolbar();
            return;
        }

        let html = '';
        const typeNames = { 0: 'BASIC', 1: 'Num array', 2: 'Char array', 3: 'CODE' };
        html += '<div class="editor-block-row dsk-info-row">';
        html += '<span class="editor-block-info">';
        html += `${files.length} file${files.length !== 1 ? 's' : ''} \u2014 `;
        html += `${allocMap.totalBlocks} blocks (${allocMap.totalBlocks - allocMap.freeBlocks} used, ${allocMap.freeBlocks} free) \u2014 `;
        html += `${allocMap.freeBlocks * spec.blockSize} bytes free`;
        html += '</span></div>';

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const isSel = panel.selection.has(i);
            const isExpanded = panel.expandedBlock === i;

            let rowClasses = 'editor-block-row dsk-row';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span> `;
            if (file.user > 0) html += `<span class="file-user">[U${file.user}]</span> `;
            const typeName = file.hasPlus3Header ? (typeNames[file.plus3Type] || '?') : '';
            if (typeName) html += `<span class="file-plus3type">${typeName}</span>`;
            html += `<span class="file-name">${file.name}</span>`;
            if (file.ext) html += `<span class="dim">.${file.ext}</span>`;
            if (file.loadAddress !== undefined) {
                html += ` <span class="file-addr">@ $${hex16(file.loadAddress)}</span>`;
            }
            html += ` <span class="file-size">\u2014 ${file.size} bytes</span>`;
            html += ` <span class="file-sectors">(${file.blocks} blocks)</span>`;
            if (file.plus3Type === 0 && file.autostart !== undefined && file.autostart < 0x8000) {
                html += ` <span class="dim">autostart ${file.autostart}</span>`;
            }
            html += '</span></div>';

            if (isExpanded) {
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<label>Name:</label><input type="text" maxlength="8" value="${file.name}" data-field="name" style="width:80px">`;
                html += `<label>Ext:</label><input type="text" maxlength="3" value="${file.ext}" data-field="ext" style="width:40px">`;
                html += `<label class="dim">${file.size} bytes, ${file.blocks} blocks</label>`;
                html += `<button class="editor-apply-btn" data-action="dsk-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${files.length} files, ${selCount} sel \u2014 ${allocMap.freeBlocks * spec.blockSize} bytes free`;
        } else {
            panel.dom.statusSpan.textContent = `${files.length} files \u2014 ${allocMap.freeBlocks * spec.blockSize} bytes free`;
        }
        editorUpdateToolbar();
    }

    function dskEditorDeleteFiles(panel) {
        if (panel.selection.size === 0) return;
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;

        const dskImage = panel.parsedFile.dskImage;
        const spec = DSKLoader.getDiskSpec(dskImage);
        const dir = DSKLoader._readDirectory(dskImage, spec);
        if (!dir) return;

        const { dirData } = dir;
        const files = panel.parsedFile.files;
        const maxEntries = Math.floor(dirData.length / 32);

        const toDelete = new Set();
        for (const idx of panel.selection) {
            if (idx >= 0 && idx < files.length) {
                const f = files[idx];
                toDelete.add(`${f.user}:${f.name}:${f.ext}`);
            }
        }

        for (let i = 0; i < maxEntries; i++) {
            const entryBase = i * 32;
            const user = dirData[entryBase];
            if (user === 0xE5 || user > 15) continue;

            let name = '';
            for (let j = 1; j <= 8; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) name += String.fromCharCode(ch);
            }
            name = name.trimEnd();

            let ext = '';
            for (let j = 9; j <= 11; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) ext += String.fromCharCode(ch);
            }
            ext = ext.trimEnd();

            if (toDelete.has(`${user}:${name}:${ext}`)) {
                dirData[entryBase] = 0xE5;
            }
        }

        DSKLoader.writeDirectory(dskImage, spec, dirData);
        panel.selection.clear();
        panel.expandedBlock = -1;
        dskEditorRefreshState(panel);
        dskEditorRenderFileList(panel);
    }

    function dskEditorAddFile(panel, data, name, ext, type, addr, autostart) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return 'No DSK image loaded';
        const dskImage = panel.parsedFile.dskImage;
        const spec = DSKLoader.getDiskSpec(dskImage);

        const blockSize = spec.blockSize;
        const sectorSize = spec.sectorSize || 512;
        const sectorsPerBlock = Math.max(1, Math.round(blockSize / sectorSize));
        const sectorsPerTrack = spec.sectorsPerTrack || 9;
        const baseSectorId = spec.firstSectorId !== undefined ? spec.firstSectorId : 0xC1;
        const reservedTracks = spec.reservedTracks;

        let fullData;
        if (type >= 0) {
            const header = new Uint8Array(128);
            const sig = 'PLUS3DOS';
            for (let i = 0; i < sig.length; i++) header[i] = sig.charCodeAt(i);
            header[8] = 0x1A;
            header[9] = 1;
            header[10] = 0;
            const totalLen = data.length + 128;
            header[11] = totalLen & 0xFF;
            header[12] = (totalLen >> 8) & 0xFF;
            header[13] = (totalLen >> 16) & 0xFF;
            header[14] = (totalLen >> 24) & 0xFF;
            header[15] = type & 0xFF;
            if (type === 3) {
                header[16] = addr & 0xFF;
                header[17] = (addr >> 8) & 0xFF;
                header[18] = data.length & 0xFF;
                header[19] = (data.length >> 8) & 0xFF;
            } else if (type === 0) {
                header[16] = data.length & 0xFF;
                header[17] = (data.length >> 8) & 0xFF;
                const auto = (autostart !== undefined && autostart !== null && autostart !== '') ?
                    (parseInt(autostart) & 0xFFFF) : 0x8000;
                header[18] = auto & 0xFF;
                header[19] = (auto >> 8) & 0xFF;
            }
            let hdrSum = 0;
            for (let i = 0; i < 127; i++) hdrSum = (hdrSum + header[i]) & 0xFF;
            header[127] = hdrSum;

            fullData = new Uint8Array(128 + data.length);
            fullData.set(header);
            fullData.set(data, 128);
        } else {
            fullData = data;
        }

        const requiredBlocks = Math.ceil(fullData.length / blockSize);
        if (requiredBlocks === 0) return 'File is empty';

        const allocMap = DSKLoader.getBlockAllocationMap(dskImage, spec);
        if (requiredBlocks > allocMap.freeBlocks) {
            return `Not enough space: need ${requiredBlocks} blocks, ${allocMap.freeBlocks} free`;
        }

        const dir = DSKLoader._readDirectory(dskImage, spec);
        if (!dir) return 'Cannot read directory';
        const { dirData } = dir;
        const maxEntries = Math.floor(dirData.length / 32);

        const requiredExtents = Math.ceil(requiredBlocks / 16);
        let freeSlots = 0;
        for (let i = 0; i < maxEntries; i++) {
            if (dirData[i * 32] === 0xE5) freeSlots++;
        }
        if (requiredExtents > freeSlots) {
            return `Directory full: need ${requiredExtents} entries, ${freeSlots} free`;
        }

        const freeBlockNums = [];
        for (let b = 0; b < allocMap.totalBlocks && freeBlockNums.length < requiredBlocks; b++) {
            if (!allocMap.used.has(b)) freeBlockNums.push(b);
        }

        for (let bi = 0; bi < freeBlockNums.length; bi++) {
            const blockNum = freeBlockNums[bi];
            const absoluteSector = blockNum * sectorsPerBlock;
            const dataOffset = bi * blockSize;

            for (let s = 0; s < sectorsPerBlock; s++) {
                const curSectorInTrack = (absoluteSector + s) % sectorsPerTrack;
                const curTrack = reservedTracks + Math.floor((absoluteSector + s) / sectorsPerTrack);
                const sectorId = baseSectorId + curSectorInTrack;

                const sectorData = new Uint8Array(sectorSize);
                const srcOffset = dataOffset + s * sectorSize;
                if (srcOffset < fullData.length) {
                    const copyLen = Math.min(sectorSize, fullData.length - srcOffset);
                    sectorData.set(fullData.subarray(srcOffset, srcOffset + copyLen));
                }
                dskImage.writeSector(curTrack, 0, sectorId, sectorData);
            }
        }

        const paddedName = (name + '        ').substring(0, 8);
        const paddedExt = (ext + '   ').substring(0, 3);
        let freeSlotIdx = 0;
        for (let extNum = 0; extNum < requiredExtents; extNum++) {
            while (freeSlotIdx < maxEntries && dirData[freeSlotIdx * 32] !== 0xE5) freeSlotIdx++;
            if (freeSlotIdx >= maxEntries) return 'Directory full (internal error)';

            const entryBase = freeSlotIdx * 32;
            dirData[entryBase] = 0;

            for (let j = 0; j < 8; j++) {
                dirData[entryBase + 1 + j] = j < paddedName.length ? paddedName.charCodeAt(j) & 0x7F : 0x20;
            }
            for (let j = 0; j < 3; j++) {
                dirData[entryBase + 9 + j] = j < paddedExt.length ? paddedExt.charCodeAt(j) & 0x7F : 0x20;
            }

            dirData[entryBase + 12] = extNum & 0x1F;
            dirData[entryBase + 13] = 0;
            dirData[entryBase + 14] = (extNum >> 5) & 0x3F;

            const startBlock = extNum * 16;
            const endBlock = Math.min(startBlock + 16, requiredBlocks);
            const blocksInExtent = endBlock - startBlock;

            for (let j = 0; j < 16; j++) {
                dirData[entryBase + 16 + j] = (j < blocksInExtent) ? freeBlockNums[startBlock + j] : 0;
            }

            if (extNum === requiredExtents - 1) {
                const bytesInExtent = fullData.length - startBlock * blockSize;
                const records = Math.ceil(bytesInExtent / 128);
                dirData[entryBase + 15] = Math.min(records, 128);
            } else {
                dirData[entryBase + 15] = 128;
            }

            freeSlotIdx++;
        }

        DSKLoader.writeDirectory(dskImage, spec, dirData);
        return null;
    }

    function dskEditorRenameFile(panel, idx, newName, newExt) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        const dskImage = panel.parsedFile.dskImage;
        const spec = DSKLoader.getDiskSpec(dskImage);
        const dir = DSKLoader._readDirectory(dskImage, spec);
        if (!dir) return;

        const { dirData } = dir;
        const files = panel.parsedFile.files;
        if (idx < 0 || idx >= files.length) return;

        const file = files[idx];
        const maxEntries = Math.floor(dirData.length / 32);

        const paddedName = (newName + '        ').substring(0, 8);
        const paddedExt = (newExt + '   ').substring(0, 3);

        for (let i = 0; i < maxEntries; i++) {
            const entryBase = i * 32;
            const user = dirData[entryBase];
            if (user === 0xE5 || user > 15) continue;
            if (user !== file.user) continue;

            let name = '';
            for (let j = 1; j <= 8; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) name += String.fromCharCode(ch);
            }
            name = name.trimEnd();

            let ext = '';
            for (let j = 9; j <= 11; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) ext += String.fromCharCode(ch);
            }
            ext = ext.trimEnd();

            if (name !== file.name || ext !== file.ext) continue;

            for (let j = 0; j < 8; j++) {
                const highBit = dirData[entryBase + 1 + j] & 0x80;
                dirData[entryBase + 1 + j] = highBit | (j < paddedName.length ? paddedName.charCodeAt(j) & 0x7F : 0x20);
            }
            for (let j = 0; j < 3; j++) {
                const highBit = dirData[entryBase + 9 + j] & 0x80;
                dirData[entryBase + 9 + j] = highBit | (j < paddedExt.length ? paddedExt.charCodeAt(j) & 0x7F : 0x20);
            }
        }

        DSKLoader.writeDirectory(dskImage, spec, dirData);
    }

    function dskEditorExtractFiles(panel, format) {
        const sorted = editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        const asHobeta = format === 'hobeta';

        const dskImage = panel.parsedFile.dskImage;
        const files = panel.parsedFile.files;
        const baseName = (panel.fileName || 'extract').replace(/\.dsk$/i, '');

        const extractDskFile = (file) => {
            const data = DSKLoader.readFileData(dskImage, file.name, file.ext, file.user, file.rawSize);
            if (!data) return null;
            const fileData = (file.hasPlus3Header && data.length >= 128) ? data.slice(128, 128 + file.size) : data.slice(0, file.size);
            const trimName = file.name.trimEnd();
            if (asHobeta) {
                const hdrType = file.hasPlus3Header ? file.plus3Type : 3;
                const addr = file.loadAddress || 0;
                const hobData = buildHobetaGeneric(trimName, hdrType, addr, fileData);
                const ext = trdExtToHobetaExt(headerTypeToTrdExt(hdrType));
                return { name: trimName + '.' + ext, data: hobData };
            }
            const name = trimName + (file.ext ? '.' + file.ext.trimEnd() : '');
            return { name, data: fileData };
        };

        if (sorted.length === 1) {
            const file = files[sorted[0]];
            if (!file) return;
            const result = extractDskFile(file);
            if (!result) return;
            const blob = new Blob([result.data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = result.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
        }

        const zipFiles = [];
        for (const idx of sorted) {
            const file = files[idx];
            if (!file) continue;
            const result = extractDskFile(file);
            if (result) zipFiles.push(result);
        }
        if (zipFiles.length === 0) return;
        const zipData = editorCreateZip(zipFiles);
        const blob = new Blob([zipData], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '_extract.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function dskEditorNewDsk(panel) {
        const dskImage = DSKLoader.createBlankDSK();
        const spec = DSKLoader.getDiskSpec(dskImage);
        panel.parsedFile = {
            type: 'dsk',
            dskImage: dskImage,
            diskSpec: spec,
            files: [],
            isExtended: true,
            numTracks: 40,
            numSides: 1,
            size: 0
        };
        panel.blocks = [];
        panel.fileType = 'dsk';
        panel.rawData = dskImage.toBuffer();
        panel.fileName = 'new.dsk';
        panel.selection.clear();
        panel.expandedBlock = -1;
        panel.diskFiles = [];
        panel.diskLabel = '        ';
        updatePanelHeader(panel);
        dskEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function dskEditorImportDsk(panel, data) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return 'No target DSK loaded';
        let srcImage;
        try {
            srcImage = DSKLoader.parse(data);
        } catch (e) {
            return 'Invalid DSK file: ' + e.message;
        }

        let srcFiles;
        try {
            srcFiles = DSKLoader.listFiles(srcImage);
        } catch (e) {
            return 'Cannot read source disk files: ' + e.message;
        }

        if (srcFiles.length === 0) return 'Source disk has no files';

        let added = 0, skipped = 0;
        for (const file of srcFiles) {
            const rawData = DSKLoader.readFileData(srcImage, file.name, file.ext, file.user, file.rawSize);
            if (!rawData) { skipped++; continue; }

            const err = dskEditorAddFile(panel, rawData, file.name, file.ext, -1, 0, null);
            if (err) { skipped++; continue; }
            added++;
        }

        dskEditorRefreshState(panel);
        return skipped > 0 ?
            `Imported ${added} files, ${skipped} skipped` :
            (added > 0 ? null : 'No files imported');
    }

    function dskEditorSaveDsk(panel) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        const buf = panel.parsedFile.dskImage.toBuffer();
        const baseName = (panel.fileName || 'output').replace(/\.dsk$/i, '');
        const blob = new Blob([buf], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '.dsk';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function dskEditorApplyInlineEdit(panel, idx) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        const files = panel.parsedFile.files;
        if (idx < 0 || idx >= files.length) return;

        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const extInput = editRow.querySelector('[data-field="ext"]');

        const newName = nameInput ? nameInput.value.trimEnd() : files[idx].name;
        const newExt = extInput ? extInput.value.trimEnd() : files[idx].ext;

        dskEditorRenameFile(panel, idx, newName, newExt);
        panel.expandedBlock = -1;
        dskEditorRefreshState(panel);
        dskEditorRenderFileList(panel);
    }

    // ========== ZIP Transparent Unwrap ==========

    function zipParseInnerFile(innerData, innerExt) {
        let parsed = null;
        if (innerExt === 'tap') {
            parsed = { type: 'tap', blocks: [], size: innerData.length };
        } else if (innerExt === 'tzx') {
            parsed = { type: 'tzx', blocks: [], nonStandardBlocks: [], size: innerData.length };
        } else if (innerExt === 'trd') {
            parsed = explorerParseTRD(innerData);
        } else if (innerExt === 'scl') {
            parsed = { type: 'scl', files: [], size: innerData.length };
            const sig = String.fromCharCode(...innerData.slice(0, 8));
            if (sig === 'SINCLAIR') {
                const fileCount = innerData[8];
                let off = 9;
                for (let i = 0; i < fileCount; i++) {
                    const name = String.fromCharCode(...innerData.slice(off, off + 8));
                    const fext = String.fromCharCode(innerData[off + 8]);
                    const startAddr = innerData[off + 9] | (innerData[off + 10] << 8);
                    const length = innerData[off + 11] | (innerData[off + 12] << 8);
                    const sectors = innerData[off + 13];
                    parsed.files.push({ name, ext: fext, startAddress: startAddr, length, sectors, offset: 0 });
                    off += 14;
                }
                let dataOff = off;
                for (const f of parsed.files) { f.offset = dataOff; dataOff += f.sectors * 256; }
            }
        } else if (innerExt === 'mgt' || innerExt === 'img') {
            parsed = explorerParseMGT(innerData);
        } else if (innerExt === 'mdr') {
            parsed = explorerParseMDR(innerData);
        } else if (innerExt === 'opd' || innerExt === 'opu') {
            parsed = explorerParseOPD(innerData);
        } else if (innerExt === 'dsk') {
            try {
                const dskImage = DSKLoader.parse(innerData);
                const spec = DSKLoader.getDiskSpec(dskImage);
                let dskFiles = [];
                try { dskFiles = DSKLoader.listFiles(dskImage); } catch (e) { /* non-CP/M */ }
                parsed = { type: 'dsk', dskImage, diskSpec: spec, files: dskFiles, size: innerData.length };
            } catch (e) { /* invalid DSK */ }
        }
        return parsed;
    }

    async function zipLoadInnerFile(panel, zipEntry) {
        const innerExt = zipEntry.name.split('.').pop().toLowerCase();
        const innerData = new Uint8Array(zipEntry.data);
        const parsed = zipParseInnerFile(innerData, innerExt);
        if (parsed) {
            await loadFileIntoPanel(panel, innerData, zipEntry.name, innerExt, parsed);
        }
    }

    const zipPickDialog = document.getElementById('zipPickDialog');
    const zipPickList = document.getElementById('zipPickList');
    const btnZipPickCancel = document.getElementById('btnZipPickCancel');

    function zipShowPickDialog(panel, candidates) {
        let html = '';
        for (let i = 0; i < candidates.length; i++) {
            const f = candidates[i];
            const ext = f.name.split('.').pop().toLowerCase().toUpperCase();
            const size = f.data ? f.data.length : 0;
            html += `<div class="editor-block-row zip-row" data-zip-idx="${i}" style="cursor:pointer">`;
            html += '<span class="editor-block-info">';
            html += `<span class="file-ext">${ext}</span>`;
            html += `<span class="file-name">${f.name}</span>`;
            html += ` <span class="file-size">\u2014 ${size.toLocaleString()} bytes</span>`;
            html += '</span></div>';
        }
        zipPickList.innerHTML = html;
        zipPickDialog._panel = panel;
        zipPickDialog._candidates = candidates;
        zipPickDialog.classList.remove('hidden');
    }

    zipPickList.addEventListener('click', (e) => {
        const row = e.target.closest('[data-zip-idx]');
        if (!row) return;
        const idx = parseInt(row.dataset.zipIdx);
        const panel = zipPickDialog._panel;
        const candidates = zipPickDialog._candidates;
        if (idx >= 0 && idx < candidates.length && panel) {
            zipPickDialog.classList.add('hidden');
            zipLoadInnerFile(panel, candidates[idx]);
        }
    });

    btnZipPickCancel.addEventListener('click', () => {
        zipPickDialog.classList.add('hidden');
    });

    // ========== ZIP Editor Functions (unused — ZIP is unwrapped transparently) ==========

    function zipEditorNewZip(panel) {
        panel.blocks = [];
        panel.parsedFile = { type: 'zip', files: [], size: 0 };
        panel.fileType = 'zip';
        panel.rawData = new Uint8Array(0);
        panel.fileName = 'new.zip';
        panel.selection.clear();
        panel.expandedBlock = -1;
        panel.diskFiles = [];
        panel.diskLabel = '        ';
        panel.pendingFileData = null;
        updatePanelHeader(panel);
        zipEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    async function zipEditorImportZip(panel, data, filename) {
        const rawCopy = new Uint8Array(data);
        const files = await ZipLoader.extract(rawCopy.buffer);
        const supported = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'mdr', 'dsk'];
        const zxFiles = files.filter(f => {
            const ext = f.name.split('.').pop().toLowerCase();
            return supported.includes(ext);
        });
        panel.parsedFile = { type: 'zip', files: zxFiles, size: data.length };
        panel.blocks = zxFiles;
        panel.fileType = 'zip';
        panel.rawData = rawCopy;
        panel.fileName = filename;
        panel.selection.clear();
        panel.expandedBlock = -1;
        updatePanelHeader(panel);
        zipEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function zipEditorRenderFileList(panel) {
        const files = (panel.parsedFile && panel.parsedFile.files) || [];

        if (files.length === 0) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty ZIP. Use "Add File" to add container files.</span>';
            panel.dom.statusSpan.textContent = '0 files';
            editorUpdateToolbar();
            return;
        }

        let totalSize = 0;
        let html = '';
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const isSel = panel.selection.has(i);
            const ext = file.name.split('.').pop().toLowerCase();
            const badge = ext.toUpperCase();
            const size = file.data ? file.data.length : 0;
            totalSize += size;

            let rowClasses = 'editor-block-row zip-row';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span> `;
            html += `<span class="file-ext">${badge}</span>`;
            html += `<span class="file-name">${file.name}</span>`;
            html += ` <span class="file-size">\u2014 ${size.toLocaleString()} bytes</span>`;
            html += '</span></div>';
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${files.length} files, ${selCount} sel \u2014 ${totalSize.toLocaleString()} bytes`;
        } else {
            panel.dom.statusSpan.textContent = `${files.length} files \u2014 ${totalSize.toLocaleString()} bytes`;
        }
        editorUpdateToolbar();
    }

    function zipEditorAddFile(panel, fileData, fileName) {
        panel.parsedFile.files.push({ name: fileName, data: new Uint8Array(fileData) });
        panel.blocks = panel.parsedFile.files;
        zipEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function zipEditorDeleteFiles(panel) {
        if (panel.selection.size === 0) return;
        const sorted = editorSelectedSorted(panel).reverse();
        for (const idx of sorted) {
            panel.parsedFile.files.splice(idx, 1);
        }
        panel.blocks = panel.parsedFile.files;
        panel.selection.clear();
        panel.expandedBlock = -1;
        zipEditorRenderFileList(panel);
        syncPanelToExplorer(panel);
    }

    function zipEditorExtractFiles(panel, format) {
        const sorted = editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        const files = panel.parsedFile.files;
        const baseName = (panel.fileName || 'extract').replace(/\.zip$/i, '');

        if (sorted.length === 1) {
            const file = files[sorted[0]];
            if (!file) return;
            const blob = new Blob([file.data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            return;
        }

        const zipFiles = sorted.map(idx => files[idx]).filter(f => f);
        if (zipFiles.length === 0) return;
        const zipData = editorCreateZip(zipFiles.map(f => ({ name: f.name, data: f.data })));
        const blob = new Blob([zipData], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '_extract.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function zipEditorSaveZip(panel) {
        const files = (panel.parsedFile && panel.parsedFile.files) || [];
        if (files.length === 0) return;
        const zipData = editorCreateZip(files.map(f => ({ name: f.name, data: f.data })));
        const baseName = (panel.fileName || 'output').replace(/\.zip$/i, '');
        const blob = new Blob([zipData], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = baseName + '.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function buildSingleFileTap(file) {
        // Build header block: flag(0x00) + type + name(10) + length + param1 + param2
        const header = new Uint8Array(19);
        header[0] = 0x00; // flag
        header[1] = file.type & 0xFF;
        const padded = ((file.name || 'untitled') + '          ').substring(0, 10);
        for (let i = 0; i < 10; i++) {
            header[2 + i] = padded.charCodeAt(i);
        }
        header[12] = file.rawData.length & 0xFF;
        header[13] = (file.rawData.length >> 8) & 0xFF;
        let param1 = 0;
        if (file.type === 0) {
            param1 = (file.autostart !== null && file.autostart !== undefined && file.autostart !== '') ? (parseInt(file.autostart) & 0xFFFF) : 0x8000;
        } else if (file.type === 3) {
            param1 = (file.addr || 0) & 0xFFFF;
        }
        header[14] = param1 & 0xFF;
        header[15] = (param1 >> 8) & 0xFF;
        let param2 = (file.type === 0) ? file.rawData.length : 0x8000;
        header[16] = param2 & 0xFF;
        header[17] = (param2 >> 8) & 0xFF;
        editorRecalcChecksum(header);

        // Build data block: flag(0xFF) + rawData + checksum
        const dataBlock = new Uint8Array(file.rawData.length + 2);
        dataBlock[0] = 0xFF;
        dataBlock.set(file.rawData, 1);
        editorRecalcChecksum(dataBlock);

        // Wrap in TAP format: length prefix + block data
        const totalSize = 2 + header.length + 2 + dataBlock.length;
        const tap = new Uint8Array(totalSize);
        let offset = 0;
        tap[offset] = header.length & 0xFF;
        tap[offset + 1] = (header.length >> 8) & 0xFF;
        offset += 2;
        tap.set(header, offset);
        offset += header.length;
        tap[offset] = dataBlock.length & 0xFF;
        tap[offset + 1] = (dataBlock.length >> 8) & 0xFF;
        offset += 2;
        tap.set(dataBlock, offset);
        return tap;
    }

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
            panel.parsedFile = parsed ? { ...parsed, blocks: panel.blocks, nonStandardBlocks: [] }
                                      : { type: 'tzx', blocks: panel.blocks, nonStandardBlocks: [], size: data.length };
            editorImportTzxData(panel, data);
            updatePanelHeader(panel);
            editorRenderBlockList(panel);
        } else if (ext === 'trd' || ext === 'scl') {
            panel.fileType = ext;
            panel.blocks = [];
            panel.parsedFile = parsed || { type: ext, files: [], size: data.length };
            updatePanelHeader(panel);
            diskEditorRenderFileList(panel);
        } else if (ext === 'mgt') {
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
        } else if (ext === 'zip') {
            // Transparently unwrap ZIP — extract supported container files
            const rawCopy = new Uint8Array(data);
            const zipFiles = await ZipLoader.extract(rawCopy.buffer);
            const supportedExts = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'mdr', 'opd', 'opu', 'dsk'];
            const candidates = zipFiles.filter(f => supportedExts.includes(f.name.split('.').pop().toLowerCase()));
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
                }
            }
        } else if (panel.fileType === 'trd' || panel.fileType === 'scl') {
            for (const idx of sorted) {
                if (idx < 0 || idx >= panel.diskFiles.length) continue;
                const f = panel.diskFiles[idx];
                const isBASIC = f.ext === 'B';
                result.push({
                    name: f.name.replace(/\s+$/, ''),
                    ext: f.ext,
                    type: isBASIC ? 0 : 3,
                    addr: isBASIC ? 0 : (f.startAddress || 0),
                    autostart: null, // TR-DOS doesn't store autostart; it's embedded in BASIC data
                    rawData: f.data.slice(0, f.length)
                });
            }
        } else if (panel.fileType === 'mgt') {
            for (const idx of sorted) {
                if (idx < 0 || idx >= panel.diskFiles.length) continue;
                const f = panel.diskFiles[idx];
                const isBASIC = f.mgtType === 1;
                result.push({
                    name: f.name.replace(/\s+$/, ''),
                    ext: f.ext,
                    type: isBASIC ? 0 : 3,
                    addr: isBASIC ? 0 : (f.startAddress || 0),
                    autostart: f.autostart,
                    rawData: f.data.slice(0, f.length)
                });
            }
        } else if (panel.fileType === 'mdr') {
            for (const idx of sorted) {
                if (idx < 0 || idx >= panel.diskFiles.length) continue;
                const f = panel.diskFiles[idx];
                result.push({
                    name: f.name.replace(/\s+$/, ''),
                    ext: f.ext,
                    type: 3,
                    addr: 0,
                    autostart: null,
                    rawData: f.data.slice(0, f.length)
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
                const fileData = (file.hasPlus3Header && data.length >= 128) ? data.slice(128, 128 + file.size) : data.slice(0, file.size);
                result.push({
                    name: file.name.trimEnd(),
                    ext: file.ext ? file.ext.trimEnd() : '',
                    type: file.hasPlus3Header ? file.plus3Type : 3,
                    addr: file.loadAddress || 0,
                    autostart: file.autostart,
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
                } else if (entryExt === 'mgt' || entryExt === 'img') {
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
                            ext: f.type === 'PRINT' ? 'P' : 'F',
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
                            const fileData = (file.hasPlus3Header && data.length >= 128) ? data.slice(128, 128 + file.size) : data.slice(0, file.size);
                            result.push({
                                name: file.name.trimEnd(),
                                ext: file.ext ? file.ext.trimEnd() : '',
                                type: file.hasPlus3Header ? file.plus3Type : 3,
                                addr: file.loadAddress || 0,
                                autostart: file.autostart,
                                rawData: fileData
                            });
                        }
                    } catch (e) { /* invalid DSK */ }
                }
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
            // MDR files are either File or PRINT — map ext
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
        } else if (isTapOrTzx(dstType)) {
            f.name = (f.name + '          ').substring(0, 10).replace(/\s+$/, '') || 'untitled';
            // Map ext to TAP type if not already set from source
            if (srcType === 'trd' || srcType === 'scl' || srcType === 'mgt' || srcType === 'mdr' || srcType === 'opd') {
                f.type = f.ext === 'B' ? 0 : 3;
            } else if (srcType === 'dsk' && f.type === undefined) {
                const el = (f.ext || '').toUpperCase();
                f.type = el === 'BAS' ? 0 : 3;
            }
        } else if (dstType === 'dsk') {
            f.name = (f.name + '        ').substring(0, 8).replace(/\s+$/, '') || 'untitled';
            // Map TR-DOS/MGT/MDR single-char extensions to +3DOS conventions
            if (srcType === 'trd' || srcType === 'scl' || srcType === 'mgt' || srcType === 'mdr' || srcType === 'opd') {
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

    function addConvertedFile(panel, file) {
        if (isTapOrTzx(panel.fileType)) {
            editorAddFileBlocks(panel, file.rawData, file.name, file.type, file.addr, file.autostart, null);
            return null;
        } else if (panel.fileType === 'trd' || panel.fileType === 'scl') {
            return diskEditorAddFile(panel, file.rawData, file.name, file.ext || 'C', file.addr);
        } else if (panel.fileType === 'mgt') {
            // Map ext to MGT type: B→1(BASIC), C→4(CODE), D→2(Num Array)
            const mgtTypeMap = { 'B': 1, 'C': 4, 'D': 2, '#': 10 };
            const mgtType = mgtTypeMap[file.ext] || (file.type === 0 ? 1 : 4);
            return diskEditorAddMgtFile(panel, file.rawData, file.name, mgtType, file.addr || 0);
        } else if (panel.fileType === 'mdr') {
            const isPrint = file.ext === 'P';
            return diskEditorAddMdrFile(panel, file.rawData, file.name, isPrint);
        } else if (panel.fileType === 'opd') {
            return diskEditorAddOpdFile(panel, file.rawData, file.name, file.type >= 0 ? file.type : 3, file.addr, file.autostart);
        } else if (panel.fileType === 'dsk') {
            return dskEditorAddFile(panel, file.rawData, file.name, file.ext || '', file.type, file.addr, file.autostart);
        } else if (panel.fileType === 'zip') {
            // Build a minimal TAP containing this single file and add as ZIP entry
            const tapData = buildSingleFileTap(file);
            zipEditorAddFile(panel, tapData, (file.name || 'file') + '.tap');
            return null;
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
            }
        }

        const files = extractFilesFromPanel(src);

        let added = 0, errors = [];
        for (const f of files) {
            const converted = convertFileForPanel(f, src.fileType, dst.fileType);
            const err = addConvertedFile(dst, converted);
            if (err) errors.push(`${f.name}: ${err}`);
            else added++;
        }

        // Refresh destination rendering
        if (dst.fileType === 'trd' || dst.fileType === 'scl') {
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
        const isDisk = panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd';
        const isDsk = panel.fileType === 'dsk';
        const isZip = panel.fileType === 'zip';

        // Handle OPD Apply button
        const opdApplyBtn = e.target.closest('[data-action="opd-apply"]');
        if (opdApplyBtn) {
            const idx = parseInt(opdApplyBtn.dataset.idx);
            opdEditorApplyInlineEdit(panel, idx);
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
                param1 = addrInput ? parseInt(addrInput.value, 16) || 0 : 0;
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
            if (isDisk && row.dataset.labelRow) {
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
            const maxIdx = isDisk ? panel.diskFiles.length :
                           isDsk ? (panel.parsedFile.files || []).length :
                           isZip ? (panel.parsedFile.files || []).length :
                           panel.blocks.length;
            if (isNaN(idx) || idx < 0 || idx >= maxIdx) return;
            const now = Date.now();
            if (panel.lastClickIdx === idx && now - panel.lastClickTime < 400) {
                panel.lastClickIdx = -1;
                panel.lastClickTime = 0;
                if (isZip) {
                    // ZIP rows don't have inline edit — just ignore double-click
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
            case 'opd': diskEditorNewOpd(panel); break;
            case 'dsk': dskEditorNewDsk(panel); break;
            case 'zip': zipEditorNewZip(panel); break;
        }
    });

    btnEditorAddFile.addEventListener('click', () => {
        dialogTargetPanel = activePanel;
        editorPanelFileInput.click();
    });

    editorPanelFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        file.arrayBuffer().then(buf => {
            const panel = editorPanels[dialogTargetPanel];
            panel.pendingFileData = new Uint8Array(buf);

            if (panel.fileType === 'zip') {
                // ZIP panel: add container files directly
                const ext = file.name.split('.').pop().toLowerCase();
                const supported = ['tap', 'tzx', 'trd', 'scl', 'mgt', 'mdr', 'dsk'];
                if (!supported.includes(ext)) {
                    panel.dom.statusSpan.textContent = 'Only .tap/.tzx/.trd/.scl/.mgt/.mdr/.dsk files';
                    panel.pendingFileData = null;
                    return;
                }
                zipEditorAddFile(panel, panel.pendingFileData, file.name);
                panel.pendingFileData = null;
                return;
            }

            if (panel.fileType === 'trd' || panel.fileType === 'scl') {
                // Check for Hobeta file — auto-extract metadata from header
                const inputExt = file.name.split('.').pop().toLowerCase();
                const hobetaFile = isHobetaExt(inputExt) ? parseHobeta(panel.pendingFileData) : null;
                if (hobetaFile) {
                    panel.pendingFileData = hobetaFile.data;
                }
                // Open disk add dialog
                const maxSize = 65280;
                const fileData = panel.pendingFileData;
                const tooLarge = fileData.length > maxSize;
                const sectors = Math.ceil(fileData.length / 256);
                const baseName = hobetaFile
                    ? hobetaFile.name.replace(/\s+$/, '').substring(0, 8)
                    : file.name.replace(/\.[^.]+$/, '').substring(0, 8);
                diskAddName.value = baseName;
                diskAddAddr.value = hobetaFile ? hex16(hobetaFile.startAddress) : '8000';
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
                const baseName = file.name.replace(/\.[^.]+$/, '').substring(0, 10);
                diskAddName.value = baseName;
                diskAddName.maxLength = 10;
                diskAddAddr.value = '8000';
                diskAddExt.value = 'C';
                diskAddFileInfo.textContent = `${fileData.length.toLocaleString()} bytes (${sectors} sector${sectors !== 1 ? 's' : ''})` +
                    (tooLarge ? ` \u2014 max ${maxSize.toLocaleString()}` : '');
                diskAddFileInfo.style.color = tooLarge ? 'var(--accent)' : '';
                btnDiskAddOk.disabled = tooLarge;
                diskAddDialog.classList.remove('hidden');
            } else if (panel.fileType === 'mdr') {
                // MDR: add file directly (no address/type needed — all files are "File" or "PRINT")
                const maxSize = MDRLoader.SECTOR_COUNT * MDRLoader.DATA_SIZE;
                const fileData = panel.pendingFileData;
                const tooLarge = fileData.length > maxSize;
                const sectors = Math.ceil(fileData.length / MDRLoader.DATA_SIZE);
                const baseName = file.name.replace(/\.[^.]+$/, '').substring(0, 10);
                diskAddName.value = baseName;
                diskAddName.maxLength = 10;
                diskAddAddr.value = '0000';
                diskAddExt.value = 'F';
                diskAddFileInfo.textContent = `${fileData.length.toLocaleString()} bytes (${sectors} sector${sectors !== 1 ? 's' : ''})` +
                    (tooLarge ? ` \u2014 max ${maxSize.toLocaleString()}` : '');
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
                const baseName = file.name.replace(/\.[^.]+$/, '').substring(0, 10);
                diskAddName.value = baseName;
                diskAddName.maxLength = 10;
                diskAddAddr.value = '8000';
                diskAddExt.value = 'C';
                diskAddFileInfo.textContent = `${fileData.length.toLocaleString()} bytes (${sectors} sector${sectors !== 1 ? 's' : ''})` +
                    (tooLarge ? ` \u2014 max ${maxSize.toLocaleString()}` : '');
                diskAddFileInfo.style.color = tooLarge ? 'var(--accent)' : '';
                btnDiskAddOk.disabled = tooLarge;
                diskAddDialog.classList.remove('hidden');
            } else if (panel.fileType === 'dsk') {
                // Open DSK add dialog
                const baseName = file.name.replace(/\.[^.]+$/, '').substring(0, 8);
                const ext = file.name.includes('.') ? file.name.split('.').pop().substring(0, 3) : '';
                dskAddName.value = baseName;
                dskAddExt.value = ext;
                dskAddType.value = '3';
                dskAddAddr.value = '8000';
                dskAddAuto.value = '';
                dskAddAddrRow.style.display = '';
                dskAddAutoRow.style.display = 'none';
                dskAddFileInfo.textContent = `${panel.pendingFileData.length.toLocaleString()} bytes`;
                dskAddFileInfo.style.color = '';
                btnDskAddOk.disabled = false;
                dskAddDialog.classList.remove('hidden');
            } else {
                // TAP/TZX or empty (auto-create TAP)
                if (!panel.fileType) editorNewTap(panel);
                const maxPayload = 65533;
                const tooLarge = panel.pendingFileData.length > maxPayload;
                const baseName = file.name.replace(/\.[^.]+$/, '').substring(0, 10);
                tapAddName.value = baseName;
                tapAddFileInfo.textContent = `${panel.pendingFileData.length.toLocaleString()} bytes` +
                    (tooLarge ? ` (max ${maxPayload.toLocaleString()})` : '');
                tapAddFileInfo.style.color = tooLarge ? 'var(--accent)' : '';
                btnTapAddOk.disabled = tooLarge;
                tapAddType.value = '3';
                tapAddNameRow.style.display = '';
                tapAddAddrRow.style.display = '';
                tapAddAutoRow.style.display = 'none';
                tapAddVarRow.style.display = 'none';
                tapAddFlagRow.style.display = 'none';
                tapAddPauseRow.style.display = panel.fileType === 'tzx' ? '' : 'none';
                tapAddPause.value = '1000';
                tapAddAddr.value = '8000';
                tapAddAuto.value = '';
                tapAddVar.value = 'A';
                tapAddFlag.value = 'FF';
                tapAddDialog.classList.remove('hidden');
            }
        });
        e.target.value = '';
    });

    btnEditorSave.addEventListener('click', () => {
        const panel = getActivePanel();
        if (panel.fileType === 'tap') editorSaveTap(panel);
        else if (panel.fileType === 'tzx') editorSaveTzx(panel);
        else if (panel.fileType === 'trd' || panel.fileType === 'scl') diskEditorSaveDisk(panel);
        else if (panel.fileType === 'mgt') diskEditorSaveMgt(panel);
        else if (panel.fileType === 'mdr') diskEditorSaveMdr(panel);
        else if (panel.fileType === 'opd') diskEditorSaveOpd(panel);
        else if (panel.fileType === 'dsk') dskEditorSaveDsk(panel);
        else if (panel.fileType === 'zip') zipEditorSaveZip(panel);
    });



    btnEditorMoveUp.addEventListener('click', () => {
        const panel = getActivePanel();
        if (isTapOrTzx(panel.fileType)) editorMoveSelection(panel, -1);
        else if (panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd') diskEditorMoveSelection(panel, -1);
    });

    btnEditorMoveDown.addEventListener('click', () => {
        const panel = getActivePanel();
        if (isTapOrTzx(panel.fileType)) editorMoveSelection(panel, 1);
        else if (panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd') diskEditorMoveSelection(panel, 1);
    });

    btnEditorDel.addEventListener('click', () => {
        const panel = getActivePanel();
        if (isTapOrTzx(panel.fileType)) editorDeleteSelection(panel);
        else if (panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr') diskEditorDeleteSelection(panel);
        else if (panel.fileType === 'opd') opdEditorDeleteSelection(panel);
        else if (panel.fileType === 'dsk') dskEditorDeleteFiles(panel);
        else if (panel.fileType === 'zip') zipEditorDeleteFiles(panel);
    });

    btnEditorMarkDel.addEventListener('click', () => {
        const panel = getActivePanel();
        if (panel.fileType === 'trd' || panel.fileType === 'scl' || panel.fileType === 'mgt' || panel.fileType === 'mdr' || panel.fileType === 'opd') diskEditorMarkDeletedSelection(panel);
    });

    editorExtractDisk.addEventListener('change', () => {
        const fmt = editorExtractDisk.value;
        if (!fmt) return;
        const panel = getActivePanel();
        const t = panel.fileType;
        if (isTapOrTzx(t)) editorExtractSelection(panel, fmt);
        else if (t === 'trd' || t === 'scl' || t === 'mgt' || t === 'mdr') diskEditorExtractSelection(panel, fmt);
        else if (t === 'opd') opdEditorExtractSelection(panel, fmt);
        else if (t === 'dsk') dskEditorExtractFiles(panel, fmt);
        else if (t === 'zip') zipEditorExtractFiles(panel, fmt);
        editorExtractDisk.value = '';
    });

    btnEditorCopy.addEventListener('click', () => editorCopySelection());

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
            const flag = parseInt(tapAddFlag.value, 16) || 0xFF;
            editorAddHeaderlessBlock(panel, panel.pendingFileData, flag & 0xFF, pause);
        } else {
            const name = tapAddName.value || 'untitled';
            const startAddr = parseInt(tapAddAddr.value, 16) || 0;
            const autostart = tapAddAuto.value;
            const varLetter = tapAddVar.value;
            editorAddFileBlocks(panel, panel.pendingFileData, name, type, startAddr, autostart, varLetter, pause);
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
        const addr = parseInt(diskAddAddr.value, 16) || 0;

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
        } else {
            const isDisk = panel.fileType === 'trd' || panel.fileType === 'scl';
            if (!isDisk) diskEditorNewTrd(panel);
            const err = diskEditorAddFile(panel, panel.pendingFileData, name, ext, addr);
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
        const addr = parseInt(dskAddAddr.value, 16) || 0;
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

        explorerRenderFileInfo();
        document.querySelector('.explorer-subtab[data-subtab="info"]').click();
    }

    return { loadData };

} // end of initExplorer