// ========== Frame Export ==========
// Extracted from index.html inline script

// --- State ---
export const frameGrabState = {
    active: false,
    frames: [],
    wasRunning: false,
    startTime: 0
};

// --- DOM element references ---
const frameGrabStatus = document.getElementById('frameGrabStatus');
const btnFrameGrabStart = document.getElementById('btnFrameGrabStart');
const btnFrameGrabStop = document.getElementById('btnFrameGrabStop');
const btnFrameGrabCancel = document.getElementById('btnFrameGrabCancel');
const frameExportFormat = document.getElementById('frameExportFormat');
const frameExportSize = document.getElementById('frameExportSize');
const spriteRegionRow = document.getElementById('spriteRegionRow');
const sizeRow = document.getElementById('sizeRow');

// --- External dependencies ---
let _spectrum = null;
let _canvas = null;
let _showMessage = null;

/**
 * Initialize frame export with external dependencies.
 * @param {object} deps - { spectrum, canvas, showMessage }
 */
export function initFrameExport(deps) {
    _spectrum = deps.spectrum;
    _canvas = deps.canvas;
    _showMessage = deps.showMessage;
}

// --- Track last sprite mode for value conversion ---
let lastSpriteMode = null;

// --- Helper functions ---

// Show/hide size row based on format selection
function updateSizeRowVisibility() {
    const format = frameExportFormat.value;
    const scaOptionsRow = document.getElementById('scaOptionsRow');
    const scaCustomPatternRow = document.getElementById('scaCustomPatternRow');

    if (format === 'scr' || format === 'sca') {
        sizeRow.style.display = 'none';
        frameExportSize.value = 'screen';
        spriteRegionRow.style.display = 'none';
        clearSpriteRegionPreview();
        scaOptionsRow.style.display = format === 'sca' ? 'flex' : 'none';
        if (format !== 'sca') {
            scaCustomPatternRow.style.display = 'none';
        }
    } else if (format === 'bsc') {
        sizeRow.style.display = 'none';
        frameExportSize.value = 'full';
        spriteRegionRow.style.display = 'none';
        clearSpriteRegionPreview();
        scaOptionsRow.style.display = 'none';
        scaCustomPatternRow.style.display = 'none';
    } else {
        sizeRow.style.display = 'flex';
        scaOptionsRow.style.display = 'none';
        scaCustomPatternRow.style.display = 'none';
    }
    updateScaOptionsVisibility();
}

function updateScaOptionsVisibility() {
    const scaOptionsRow = document.getElementById('scaOptionsRow');
    const scaCustomPatternRow = document.getElementById('scaCustomPatternRow');
    const scaPayloadType = document.getElementById('scaPayloadType');
    const scaFillPattern = document.getElementById('scaFillPattern');

    if (scaOptionsRow.style.display === 'none') return;

    const isType1 = scaPayloadType.value === '1';
    scaFillPattern.disabled = !isType1;
    scaCustomPatternRow.style.display = (isType1 && scaFillPattern.value === 'custom') ? 'flex' : 'none';
}

// Sprite region preview using CSS-positioned div
const spriteOverlay = document.getElementById('spriteRegionOverlay');

function updateSpriteRegionPreview() {
    if (frameGrabState.active) {
        spriteOverlay.style.display = 'none';
        return;
    }

    const sizeMode = frameExportSize.value;
    if (!sizeMode.startsWith('sprite-')) {
        spriteOverlay.style.display = 'none';
        return;
    }

    const isPixels = sizeMode === 'sprite-pixels';
    const multiplier = isPixels ? 1 : 8;

    let spriteX = (parseInt(document.getElementById('spriteX').value) || 0) * multiplier;
    let spriteY = (parseInt(document.getElementById('spriteY').value) || 0) * multiplier;
    let spriteW = (parseInt(document.getElementById('spriteW').value) || (isPixels ? 16 : 2)) * multiplier;
    let spriteH = (parseInt(document.getElementById('spriteH').value) || (isPixels ? 16 : 2)) * multiplier;

    spriteX = Math.max(0, Math.min(255, spriteX));
    spriteY = Math.max(0, Math.min(191, spriteY));
    spriteW = Math.max(1, spriteW);
    spriteH = Math.max(1, spriteH);
    if (spriteX + spriteW > 256) spriteW = 256 - spriteX;
    if (spriteY + spriteH > 192) spriteH = 192 - spriteY;

    let borderLeft = 32, borderTop = 24, screenWidth = 320;
    if (_spectrum && _spectrum.ula) {
        const dims = _spectrum.ula.getDimensions();
        borderLeft = dims.borderLeft;
        borderTop = dims.borderTop;
        screenWidth = dims.width;
    }

    const screenCanvas = document.getElementById('screen');
    const styleWidth = parseFloat(screenCanvas.style.width) || screenCanvas.width;
    const zoom = styleWidth / screenCanvas.width || 1;

    const x = (borderLeft + spriteX) * zoom;
    const y = (borderTop + spriteY) * zoom;
    const w = spriteW * zoom;
    const h = spriteH * zoom;

    spriteOverlay.style.left = x + 'px';
    spriteOverlay.style.top = y + 'px';
    spriteOverlay.style.width = w + 'px';
    spriteOverlay.style.height = h + 'px';
    spriteOverlay.style.display = 'block';
}

function clearSpriteRegionPreview() {
    spriteOverlay.style.display = 'none';
}

// --- Frame grab status ---

export function updateFrameGrabStatus() {
    if (!frameGrabState.active) {
        frameGrabStatus.textContent = '';
        frameGrabStatus.classList.remove('recording');
        return;
    }
    const frameCount = frameGrabState.frames.length;
    const duration = (frameCount / 50).toFixed(2);
    frameGrabStatus.textContent = `Recording: ${frameCount} frames (${duration}s)`;
    frameGrabStatus.classList.add('recording');
}

// --- Capture frame ---

export function captureFrame() {
    if (!frameGrabState.active) return;

    const sizeMode = frameExportSize.value;
    const dims = _spectrum.ula.getDimensions();
    const canvas = _canvas;

    let sx, sy, sw, sh;
    if (sizeMode === 'screen') {
        sx = dims.borderLeft;
        sy = dims.borderTop;
        sw = 256;
        sh = 192;
    } else if (sizeMode === 'normal') {
        sx = Math.max(0, dims.borderLeft - 32);
        sy = Math.max(0, dims.borderTop - 32);
        sw = 256 + 64;
        sh = 192 + 64;
    } else if (sizeMode.startsWith('sprite-')) {
        const isPixels = sizeMode === 'sprite-pixels';
        const multiplier = isPixels ? 1 : 8;

        let spriteX = parseInt(document.getElementById('spriteX').value) || 0;
        let spriteY = parseInt(document.getElementById('spriteY').value) || 0;
        let spriteW = parseInt(document.getElementById('spriteW').value) || (isPixels ? 16 : 2);
        let spriteH = parseInt(document.getElementById('spriteH').value) || (isPixels ? 16 : 2);

        spriteX *= multiplier;
        spriteY *= multiplier;
        spriteW *= multiplier;
        spriteH *= multiplier;

        spriteX = Math.max(0, Math.min(255, spriteX));
        spriteY = Math.max(0, Math.min(191, spriteY));
        spriteW = Math.max(1, spriteW);
        spriteH = Math.max(1, spriteH);
        if (spriteX + spriteW > 256) spriteW = 256 - spriteX;
        if (spriteY + spriteH > 192) spriteH = 192 - spriteY;

        sx = dims.borderLeft + spriteX;
        sy = dims.borderTop + spriteY;
        sw = spriteW;
        sh = spriteH;
    } else {
        sx = 0;
        sy = 0;
        sw = dims.width;
        sh = dims.height;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sw;
    tempCanvas.height = sh;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const attrs = _spectrum ? _spectrum.memory.getBlock(0x5800, 768) : new Uint8Array(768);
    const bitmap = _spectrum ? _spectrum.memory.getBlock(0x4000, 6144) : new Uint8Array(6144);
    frameGrabState.frames.push({
        dataUrl: tempCanvas.toDataURL('image/png'),
        width: sw,
        height: sh,
        attrs: new Uint8Array(attrs),
        bitmap: new Uint8Array(bitmap)
    });

    updateFrameGrabStatus();

    const maxFrames = parseInt(document.getElementById('maxFrames').value) || 0;
    if (maxFrames > 0 && frameGrabState.frames.length >= maxFrames) {
        stopFrameGrab(false);
    }
}

// --- Start/Stop frame grab ---

export function startFrameGrab() {
    frameGrabState.wasRunning = _spectrum.isRunning();
    frameGrabState.active = true;
    frameGrabState.frames = [];
    frameGrabState.startTime = Date.now();

    clearSpriteRegionPreview();

    _spectrum.onFrame = () => {
        captureFrame();
    };

    if (!frameGrabState.wasRunning) {
        _spectrum.start();
    }

    btnFrameGrabStart.disabled = true;
    btnFrameGrabStop.disabled = false;
    btnFrameGrabCancel.disabled = false;
    frameExportFormat.disabled = true;
    frameExportSize.disabled = true;
    document.getElementById('spriteX').disabled = true;
    document.getElementById('spriteY').disabled = true;
    document.getElementById('spriteW').disabled = true;
    document.getElementById('spriteH').disabled = true;
    document.getElementById('maxFrames').disabled = true;

    updateFrameGrabStatus();
    if (_showMessage) _showMessage('Recording frames...');
}

export function stopFrameGrab(cancel = false) {
    frameGrabState.active = false;
    _spectrum.onFrame = null;

    if (!frameGrabState.wasRunning) {
        _spectrum.stop();
    }

    btnFrameGrabStart.disabled = false;
    btnFrameGrabStop.disabled = true;
    btnFrameGrabCancel.disabled = true;
    frameExportFormat.disabled = false;
    frameExportSize.disabled = false;
    document.getElementById('spriteX').disabled = false;
    document.getElementById('spriteY').disabled = false;
    document.getElementById('spriteW').disabled = false;
    document.getElementById('spriteH').disabled = false;
    document.getElementById('maxFrames').disabled = false;

    updateSpriteRegionPreview();

    if (cancel) {
        frameGrabState.frames = [];
        frameGrabStatus.textContent = 'Recording cancelled';
        frameGrabStatus.classList.remove('recording');
        if (_showMessage) _showMessage('Frame recording cancelled');
        return;
    }

    const frameCount = frameGrabState.frames.length;
    if (frameCount === 0) {
        frameGrabStatus.textContent = 'No frames captured';
        if (_showMessage) _showMessage('No frames captured', 'error');
        return;
    }

    const format = frameExportFormat.value;
    const duration = (frameCount / 50).toFixed(2);
    frameGrabStatus.textContent = `Exporting ${frameCount} frames...`;

    if (format === 'zip') {
        exportFramesAsZip();
    } else if (format === 'scr') {
        exportFramesAsScr('scr');
    } else if (format === 'bsc') {
        exportFramesAsScr('bsc');
    } else if (format === 'sca') {
        exportFramesAsSca();
    } else {
        exportFramesAsGif();
    }
}

// --- Export base name ---

function getExportBaseName() {
    const diskInfoLed = document.getElementById('diskInfoLed');
    const tapeLed = document.getElementById('tapeLed');
    const diskName = diskInfoLed ? diskInfoLed.title.trim() : '';
    const tapeName = tapeLed ? tapeLed.title.trim() : '';
    return diskName || tapeName || 'frame';
}

// --- ZIP export ---

export async function exportFramesAsZip() {
    const frames = frameGrabState.frames;
    const baseName = getExportBaseName();

    if (frames.length === 1) {
        const frame = frames[0];
        const base64 = frame.dataUrl.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) {
            bytes[j] = binary.charCodeAt(j);
        }
        const blob = new Blob([bytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}_0000.png`;
        a.click();
        URL.revokeObjectURL(url);
        frameGrabStatus.textContent = `Exported 1 frame as PNG`;
        frameGrabStatus.classList.remove('recording');
        if (_showMessage) _showMessage(`Exported ${baseName}_0000.png`);
        frameGrabState.frames = [];
        return;
    }

    const files = [];
    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const filename = `${baseName}_${String(i).padStart(4, '0')}.png`;
        const base64 = frame.dataUrl.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) {
            bytes[j] = binary.charCodeAt(j);
        }
        files.push({ name: filename, data: bytes });
    }

    const zipData = createZip(files);
    const blob = new Blob([zipData], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.zip`;
    a.click();
    URL.revokeObjectURL(url);

    frameGrabStatus.textContent = `Exported ${frames.length} frames to ZIP`;
    frameGrabStatus.classList.remove('recording');
    if (_showMessage) _showMessage(`Exported ${frames.length} frames to ${baseName}.zip`);
    frameGrabState.frames = [];
}

// --- ZIP creator ---

function createZip(files) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = new TextEncoder().encode(file.name);
        const data = file.data;
        const crc = crc32(data);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(localHeader.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0, true);
        lv.setUint16(8, 0, true);
        lv.setUint16(10, 0, true);
        lv.setUint16(12, 0, true);
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        lv.setUint16(28, 0, true);
        localHeader.set(nameBytes, 30);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(centralHeader.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        centralHeader.set(nameBytes, 46);

        localHeaders.push({ header: localHeader, data: data });
        centralHeaders.push(centralHeader);
        offset += localHeader.length + data.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const ch of centralHeaders) {
        centralDirSize += ch.length;
    }

    const endRecord = new Uint8Array(22);
    const ev = new DataView(endRecord.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralDirSize, true);
    ev.setUint32(16, centralDirOffset, true);
    ev.setUint16(20, 0, true);

    const totalSize = offset + centralDirSize + 22;
    const result = new Uint8Array(totalSize);
    let pos = 0;

    for (const lh of localHeaders) {
        result.set(lh.header, pos);
        pos += lh.header.length;
        result.set(lh.data, pos);
        pos += lh.data.length;
    }
    for (const ch of centralHeaders) {
        result.set(ch, pos);
        pos += ch.length;
    }
    result.set(endRecord, pos);

    return result;
}

function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = crc32.table || (crc32.table = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            t[i] = c;
        }
        return t;
    })());

    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// --- ZX Spectrum color conversion ---

const zxPalette = [
    [0, 0, 0],       // 0: black
    [0, 0, 215],     // 1: blue
    [215, 0, 0],     // 2: red
    [215, 0, 215],   // 3: magenta
    [0, 215, 0],     // 4: green
    [0, 215, 215],   // 5: cyan
    [215, 215, 0],   // 6: yellow
    [215, 215, 215], // 7: white
    [0, 0, 0],       // 8: black (bright)
    [0, 0, 255],     // 9: blue (bright)
    [255, 0, 0],     // 10: red (bright)
    [255, 0, 255],   // 11: magenta (bright)
    [0, 255, 0],     // 12: green (bright)
    [0, 255, 255],   // 13: cyan (bright)
    [255, 255, 0],   // 14: yellow (bright)
    [255, 255, 255]  // 15: white (bright)
];

export function rgbToZxColor(r, g, b) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < 16; i++) {
        const dr = r - zxPalette[i][0];
        const dg = g - zxPalette[i][1];
        const db = b - zxPalette[i][2];
        const dist = dr*dr + dg*dg + db*db;
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }
    return bestIdx;
}

export function imageDataToScr(pixels, srcWidth, screenLeft, screenTop) {
    const scr = new Uint8Array(6912);

    for (let charY = 0; charY < 24; charY++) {
        for (let charX = 0; charX < 32; charX++) {
            const colorCounts = new Map();

            for (let py = 0; py < 8; py++) {
                for (let px = 0; px < 8; px++) {
                    const sx = screenLeft + charX * 8 + px;
                    const sy = screenTop + charY * 8 + py;
                    const idx = (sy * srcWidth + sx) * 4;
                    const zxColor = rgbToZxColor(pixels[idx], pixels[idx+1], pixels[idx+2]);
                    colorCounts.set(zxColor, (colorCounts.get(zxColor) || 0) + 1);
                }
            }

            const sorted = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]);
            let ink = sorted[0] ? sorted[0][0] : 0;
            let paper = sorted[1] ? sorted[1][0] : 7;

            const inkBright = ink >= 8;
            const paperBright = paper >= 8;
            const bright = inkBright || paperBright;

            ink = ink % 8;
            paper = paper % 8;

            if (paper === ink) {
                paper = (ink === 7) ? 0 : 7;
            }

            const attr = (bright ? 0x40 : 0) | (paper << 3) | ink;
            scr[6144 + charY * 32 + charX] = attr;

            for (let py = 0; py < 8; py++) {
                let byte = 0;
                for (let px = 0; px < 8; px++) {
                    const sx = screenLeft + charX * 8 + px;
                    const sy = screenTop + charY * 8 + py;
                    const idx = (sy * srcWidth + sx) * 4;
                    const zxColor = rgbToZxColor(pixels[idx], pixels[idx+1], pixels[idx+2]) % 8;

                    const inkDist = Math.abs(zxColor - ink);
                    const paperDist = Math.abs(zxColor - paper);
                    if (inkDist <= paperDist) {
                        byte |= (0x80 >> px);
                    }
                }

                const third = Math.floor(charY / 8);
                const charRow = charY % 8;
                const addr = third * 2048 + py * 256 + charRow * 32 + charX;
                scr[addr] = byte;
            }
        }
    }

    return scr;
}

// --- BSC format ---

export const BSC_FORMAT = {
    TOTAL_SIZE: 11136,
    BORDER_OFFSET: 6912,
    BORDER_SIZE: 4224,
    BYTES_PER_FULL_LINE: 24,
    BYTES_PER_SIDE_LINE: 8,
    FRAME_WIDTH: 384,
    FRAME_HEIGHT: 304,
    BORDER_LEFT_PX: 64,
    BORDER_TOP_LINES: 64,
    BORDER_BOTTOM_LINES: 48,
    SCREEN_LINES: 192
};

function extractBscBorder(pixels, srcWidth, srcHeight, screenLeft, screenTop) {
    const borderData = new Uint8Array(BSC_FORMAT.BORDER_SIZE);
    let offset = 0;

    const getColor = (x, y) => {
        x = Math.max(0, Math.min(srcWidth - 1, Math.floor(x)));
        y = Math.max(0, Math.min(srcHeight - 1, Math.floor(y)));
        const idx = (y * srcWidth + x) * 4;
        return rgbToZxColor(pixels[idx], pixels[idx+1], pixels[idx+2]) % 8;
    };

    const packColors = (c1, c2) => (c1 & 7) | ((c2 & 7) << 3);

    const srcScreenRight = screenLeft + 256;
    const srcScreenBottom = screenTop + 192;
    const srcRightBorder = srcWidth - srcScreenRight;
    const srcBottomBorder = srcHeight - srcScreenBottom;

    // Top border
    for (let line = 0; line < BSC_FORMAT.BORDER_TOP_LINES; line++) {
        const srcY = screenTop > 0 ? (line * screenTop / BSC_FORMAT.BORDER_TOP_LINES) : 0;
        for (let col = 0; col < BSC_FORMAT.BYTES_PER_FULL_LINE; col++) {
            const bscX1 = col * 16;
            const bscX2 = col * 16 + 8;
            const srcX1 = bscX1 * srcWidth / BSC_FORMAT.FRAME_WIDTH;
            const srcX2 = bscX2 * srcWidth / BSC_FORMAT.FRAME_WIDTH;
            const c1 = getColor(srcX1, srcY);
            const c2 = getColor(srcX2, srcY);
            borderData[offset++] = packColors(c1, c2);
        }
    }

    // Side borders
    for (let line = 0; line < BSC_FORMAT.SCREEN_LINES; line++) {
        const srcY = screenTop + line;

        for (let col = 0; col < 4; col++) {
            const bscX1 = col * 16;
            const bscX2 = col * 16 + 8;
            const srcX1 = screenLeft > 0 ? (bscX1 * screenLeft / 64) : 0;
            const srcX2 = screenLeft > 0 ? (bscX2 * screenLeft / 64) : 0;
            const c1 = getColor(srcX1, srcY);
            const c2 = getColor(srcX2, srcY);
            borderData[offset++] = packColors(c1, c2);
        }

        for (let col = 0; col < 4; col++) {
            const bscX1 = col * 16;
            const bscX2 = col * 16 + 8;
            const srcX1 = srcScreenRight + (srcRightBorder > 0 ? (bscX1 * srcRightBorder / 64) : 0);
            const srcX2 = srcScreenRight + (srcRightBorder > 0 ? (bscX2 * srcRightBorder / 64) : 0);
            const c1 = getColor(srcX1, srcY);
            const c2 = getColor(srcX2, srcY);
            borderData[offset++] = packColors(c1, c2);
        }
    }

    // Bottom border
    for (let line = 0; line < BSC_FORMAT.BORDER_BOTTOM_LINES; line++) {
        const srcY = srcScreenBottom + (srcBottomBorder > 0 ? (line * srcBottomBorder / BSC_FORMAT.BORDER_BOTTOM_LINES) : 0);
        for (let col = 0; col < BSC_FORMAT.BYTES_PER_FULL_LINE; col++) {
            const bscX1 = col * 16;
            const bscX2 = col * 16 + 8;
            const srcX1 = bscX1 * srcWidth / BSC_FORMAT.FRAME_WIDTH;
            const srcX2 = bscX2 * srcWidth / BSC_FORMAT.FRAME_WIDTH;
            const c1 = getColor(srcX1, srcY);
            const c2 = getColor(srcX2, srcY);
            borderData[offset++] = packColors(c1, c2);
        }
    }

    return borderData;
}

// --- SCR/BSC export ---

export async function exportFramesAsScr(ext) {
    const frames = frameGrabState.frames;
    const baseName = getExportBaseName();
    const files = [];
    const isBsc = ext === 'bsc';

    let borderLeft = 0, borderTop = 0;
    if (_spectrum && _spectrum.ula) {
        const dims = _spectrum.ula.getDimensions();
        borderLeft = dims.borderLeft;
        borderTop = dims.borderTop;
    }

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const filename = `${baseName}_${String(i).padStart(4, '0')}.${ext}`;

        const img = new Image();
        img.src = frame.dataUrl;
        await new Promise(resolve => img.onload = resolve);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = frame.width;
        tempCanvas.height = frame.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, frame.width, frame.height);
        const pixels = imageData.data;

        let scrLeft = 0, scrTop = 0;
        if (frame.width > 256) {
            const dims = _spectrum && _spectrum.ula ? _spectrum.ula.getDimensions() : null;
            if (dims && frame.width >= dims.width && frame.height >= dims.height) {
                scrLeft = borderLeft;
                scrTop = borderTop;
            } else if (frame.width === 320 && frame.height === 256) {
                scrLeft = 32;
                scrTop = 32;
            } else {
                scrLeft = (frame.width - 256) / 2;
                scrTop = (frame.height - 192) / 2;
            }
        }

        const scrData = imageDataToScr(pixels, frame.width, scrLeft, scrTop);

        if (isBsc) {
            const borderData = extractBscBorder(pixels, frame.width, frame.height, scrLeft, scrTop);
            const bscData = new Uint8Array(BSC_FORMAT.TOTAL_SIZE);
            bscData.set(scrData, 0);
            bscData.set(borderData, BSC_FORMAT.BORDER_OFFSET);
            files.push({ name: filename, data: bscData });
        } else {
            files.push({ name: filename, data: scrData });
        }
    }

    const frameCount = frames.length;
    const duration = (frameCount / 50).toFixed(2);

    if (files.length === 1) {
        let fileData = files[0].data;
        let statusMsg = `Exported 1 ${ext.toUpperCase()} frame`;

        if (!isBsc && _spectrum.ula.ulaplus.enabled && _spectrum.ula.ulaplus.paletteEnabled && _spectrum.ula.ulaplus.paletteModified) {
            const scrData = new Uint8Array(6912 + 64);
            for (let i = 0; i < 6912; i++) {
                scrData[i] = _spectrum.memory.read(0x4000 + i);
            }
            scrData.set(_spectrum.ula.ulaplus.palette, 6912);
            fileData = scrData;
            statusMsg = 'Exported SCR with ULAplus palette (6976 bytes)';
        }

        const blob = new Blob([fileData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}_0000.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        frameGrabStatus.textContent = statusMsg;
        frameGrabStatus.classList.remove('recording');
        if (_showMessage) _showMessage(statusMsg);
        return;
    }

    const zipData = createZip(files);
    const blob = new Blob([zipData], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_${ext}.zip`;
    a.click();

    URL.revokeObjectURL(url);

    frameGrabStatus.textContent = `Exported ${frameCount} ${ext.toUpperCase()} frames (${duration}s)`;
    frameGrabStatus.classList.remove('recording');
    if (_showMessage) _showMessage(`Exported ${frameCount} frames to ${baseName}_${ext}.zip`);
}

// --- SCA format helpers ---

function detectBitmapPattern(bitmap) {
    if (!bitmap || bitmap.length < 6144) return null;

    const pattern = new Uint8Array(8);
    for (let row = 0; row < 8; row++) {
        const addr = row * 256;
        pattern[row] = bitmap[addr];
    }

    let matches = 0;
    let mismatches = 0;
    for (let charY = 0; charY < 24; charY++) {
        const third = Math.floor(charY / 8);
        const charRow = charY % 8;
        for (let charX = 0; charX < 32; charX++) {
            for (let row = 0; row < 8; row++) {
                const addr = third * 2048 + row * 256 + charRow * 32 + charX;
                if (bitmap[addr] === pattern[row]) {
                    matches++;
                } else {
                    mismatches++;
                }
            }
        }
    }

    const total = matches + mismatches;
    if (matches / total >= 0.95) {
        return pattern;
    }
    return null;
}

function showPatternChoiceDialog() {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        dialog.innerHTML = `
            <div class="modal-dialog" style="max-width: 320px;">
                <div class="modal-header">
                    <span>Select Fill Pattern</span>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 12px;">Could not detect a consistent bitmap pattern. Please select the fill pattern to use:</p>
                    <div style="display: flex; gap: 10px; justify-content: center;">
                        <button id="patternChoice53c" class="primary" style="padding: 8px 16px;">53c (AA 55)</button>
                        <button id="patternChoice127c" style="padding: 8px 16px;">127c (DD 77)</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        const close = (result) => {
            dialog.remove();
            resolve(result);
        };

        dialog.querySelector('.modal-close').onclick = () => close(null);
        dialog.querySelector('#patternChoice53c').onclick = () => close('53c');
        dialog.querySelector('#patternChoice127c').onclick = () => close('127c');
        dialog.onclick = (e) => { if (e.target === dialog) close(null); };
    });
}

// --- SCA export ---

export async function exportFramesAsSca() {
    const frames = frameGrabState.frames;
    const baseName = getExportBaseName();
    const frameCount = frames.length;

    const payloadType = parseInt(document.getElementById('scaPayloadType').value);

    if (payloadType === 1) {
        if (!confirm('SCA Type 1 export is experimental and under development.\nFormat may change in future versions.\n\nContinue with export?')) {
            frameGrabStatus.textContent = 'Export cancelled';
            frameGrabStatus.classList.remove('recording');
            return;
        }
    }

    let fillPattern = new Uint8Array(8);
    if (payloadType === 1) {
        const patternSelect = document.getElementById('scaFillPattern').value;
        if (patternSelect === 'auto') {
            const detected = detectBitmapPattern(frames[0].bitmap);
            if (detected) {
                fillPattern = detected;
                if (_showMessage) _showMessage(`Detected pattern: ${Array.from(detected).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')}`);
            } else {
                const choice = await showPatternChoiceDialog();
                if (choice === null) {
                    frameGrabStatus.textContent = 'Export cancelled';
                    frameGrabStatus.classList.remove('recording');
                    return;
                }
                fillPattern = choice === '53c'
                    ? new Uint8Array([0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55])
                    : new Uint8Array([0xDD, 0x77, 0xDD, 0x77, 0xDD, 0x77, 0xDD, 0x77]);
            }
        } else if (patternSelect === '53c') {
            fillPattern = new Uint8Array([0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55]);
        } else if (patternSelect === '127c') {
            fillPattern = new Uint8Array([0xDD, 0x77, 0xDD, 0x77, 0xDD, 0x77, 0xDD, 0x77]);
        } else if (patternSelect === 'v4x8') {
            fillPattern = new Uint8Array([0xF0, 0xF0, 0xF0, 0xF0, 0xF0, 0xF0, 0xF0, 0xF0]);
        } else if (patternSelect === 'h8x4') {
            fillPattern = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00]);
        } else {
            const customStr = document.getElementById('scaCustomPattern').value.trim();
            const hexBytes = customStr.split(/[\s,]+/).map(h => parseInt(h, 16) || 0);
            for (let i = 0; i < 8; i++) {
                fillPattern[i] = hexBytes[i % hexBytes.length] || 0;
            }
        }
    }

    let borderLeft = 0, borderTop = 0;
    if (_spectrum && _spectrum.ula) {
        const dims = _spectrum.ula.getDimensions();
        borderLeft = dims.borderLeft;
        borderTop = dims.borderTop;
    }

    const headerSize = 14;
    const delayTableSize = frameCount;
    const fillPatternSize = payloadType === 1 ? 8 : 0;
    const frameDataSize = payloadType === 1 ? frameCount * 768 : frameCount * 6912;
    const totalSize = headerSize + delayTableSize + fillPatternSize + frameDataSize;

    const scaData = new Uint8Array(totalSize);

    // Write header
    scaData[0] = 0x53; // 'S'
    scaData[1] = 0x43; // 'C'
    scaData[2] = 0x41; // 'A'
    scaData[3] = 1;
    scaData[4] = 256 & 0xFF;
    scaData[5] = (256 >> 8) & 0xFF;
    scaData[6] = 192 & 0xFF;
    scaData[7] = (192 >> 8) & 0xFF;
    scaData[8] = 0;
    scaData[9] = frameCount & 0xFF;
    scaData[10] = (frameCount >> 8) & 0xFF;
    scaData[11] = payloadType;
    scaData[12] = headerSize & 0xFF;
    scaData[13] = (headerSize >> 8) & 0xFF;

    for (let i = 0; i < frameCount; i++) {
        scaData[headerSize + i] = 1;
    }

    let frameDataOffset = headerSize + delayTableSize;
    if (payloadType === 1) {
        scaData.set(fillPattern, frameDataOffset);
        frameDataOffset += 8;
    }

    for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];

        const img = new Image();
        img.src = frame.dataUrl;
        await new Promise(resolve => img.onload = resolve);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = frame.width;
        tempCanvas.height = frame.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, frame.width, frame.height);
        const pixels = imageData.data;

        let scrLeft = 0, scrTop = 0;
        if (frame.width > 256) {
            const dims = _spectrum && _spectrum.ula ? _spectrum.ula.getDimensions() : null;
            if (dims && frame.width >= dims.width && frame.height >= dims.height) {
                scrLeft = borderLeft;
                scrTop = borderTop;
            } else if (frame.width === 320 && frame.height === 256) {
                scrLeft = 32;
                scrTop = 32;
            } else {
                scrLeft = (frame.width - 256) / 2;
                scrTop = (frame.height - 192) / 2;
            }
        }

        if (payloadType === 1) {
            scaData.set(frame.attrs, frameDataOffset + i * 768);
        } else {
            const scrData = imageDataToScr(pixels, frame.width, scrLeft, scrTop);
            scaData.set(scrData, frameDataOffset + i * 6912);
        }

        if (i % 10 === 0) {
            frameGrabStatus.textContent = `Encoding SCA: ${Math.round(i / frames.length * 100)}%`;
            await new Promise(r => setTimeout(r, 0));
        }
    }

    const blob = new Blob([scaData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.sca`;
    a.click();
    URL.revokeObjectURL(url);

    const duration = (frameCount / 50).toFixed(2);
    const typeStr = payloadType === 1 ? 'Type 1' : 'Type 0';
    frameGrabStatus.textContent = `Exported ${frameCount} frames to SCA ${typeStr} (${duration}s)`;
    frameGrabStatus.classList.remove('recording');
    if (_showMessage) _showMessage(`Exported ${frameCount} frames to ${baseName}.sca (${typeStr})`);
    frameGrabState.frames = [];
}

// --- GIF export ---

export async function exportFramesAsGif() {
    const frames = frameGrabState.frames;
    if (frames.length === 0) return;

    const width = frames[0].width;
    const height = frames[0].height;

    const gif = new GifEncoder(width, height);

    for (let i = 0; i < frames.length; i++) {
        const img = new Image();
        img.src = frames[i].dataUrl;
        await new Promise(resolve => img.onload = resolve);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(img, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, width, height);

        gif.addFrame(imageData.data, 2);

        if (i % 10 === 0) {
            frameGrabStatus.textContent = `Encoding GIF: ${Math.round(i / frames.length * 100)}%`;
            await new Promise(r => setTimeout(r, 0));
        }
    }

    const gifData = gif.finish();
    const baseName = getExportBaseName();

    const blob = new Blob([gifData], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.gif`;
    a.click();
    URL.revokeObjectURL(url);

    frameGrabStatus.textContent = `Exported ${frames.length} frames to GIF`;
    frameGrabStatus.classList.remove('recording');
    if (_showMessage) _showMessage(`Exported ${frames.length} frames to ${baseName}.gif`);
    frameGrabState.frames = [];
}

// --- GIF Encoder ---

export class GifEncoder {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.frames = [];
        this.data = [];
    }

    addFrame(rgba, delay) {
        const { palette, indexed } = this.quantize(rgba);
        this.frames.push({ palette, indexed, delay });
    }

    quantize(rgba) {
        const colorCounts = new Map();
        const pixels = [];

        for (let i = 0; i < rgba.length; i += 4) {
            const r = rgba[i] & 0xF8;
            const g = rgba[i + 1] & 0xFC;
            const b = rgba[i + 2] & 0xF8;
            const key = (r << 16) | (g << 8) | b;
            pixels.push(key);
            colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
        }

        const sorted = [...colorCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 256);

        const palette = new Uint8Array(256 * 3);
        const colorToIndex = new Map();

        for (let i = 0; i < sorted.length; i++) {
            const [color] = sorted[i];
            const r = (color >> 16) & 0xFF;
            const g = (color >> 8) & 0xFF;
            const b = color & 0xFF;
            palette[i * 3] = r;
            palette[i * 3 + 1] = g;
            palette[i * 3 + 2] = b;
            colorToIndex.set(color, i);
        }

        const indexed = new Uint8Array(pixels.length);
        for (let i = 0; i < pixels.length; i++) {
            indexed[i] = colorToIndex.get(pixels[i]) || 0;
        }

        return { palette, indexed };
    }

    finish() {
        const out = [];

        // GIF Header
        out.push(...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a

        // Logical Screen Descriptor
        out.push(this.width & 0xFF, (this.width >> 8) & 0xFF);
        out.push(this.height & 0xFF, (this.height >> 8) & 0xFF);
        out.push(0xF7); // Global color table, 256 colors
        out.push(0);
        out.push(0);

        // Global Color Table
        if (this.frames.length > 0) {
            for (let i = 0; i < 256 * 3; i++) {
                out.push(this.frames[0].palette[i] || 0);
            }
        }

        // Netscape Extension for looping
        out.push(0x21, 0xFF, 0x0B);
        out.push(...[0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]); // NETSCAPE2.0
        out.push(0x03, 0x01, 0x00, 0x00, 0x00); // Loop forever

        // Frames
        for (const frame of this.frames) {
            // Graphics Control Extension
            out.push(0x21, 0xF9, 0x04);
            out.push(0x00);
            out.push(frame.delay & 0xFF, (frame.delay >> 8) & 0xFF);
            out.push(0x00);
            out.push(0x00);

            // Image Descriptor
            out.push(0x2C);
            out.push(0, 0, 0, 0);
            out.push(this.width & 0xFF, (this.width >> 8) & 0xFF);
            out.push(this.height & 0xFF, (this.height >> 8) & 0xFF);
            out.push(0x00);

            // LZW Compressed Image Data
            const lzw = this.lzwEncode(frame.indexed, 8);
            out.push(8);

            let pos = 0;
            while (pos < lzw.length) {
                const blockSize = Math.min(255, lzw.length - pos);
                out.push(blockSize);
                for (let i = 0; i < blockSize; i++) {
                    out.push(lzw[pos++]);
                }
            }
            out.push(0x00);
        }

        // GIF Trailer
        out.push(0x3B);

        return new Uint8Array(out);
    }

    lzwEncode(data, minCodeSize) {
        const clearCode = 1 << minCodeSize;
        const eoiCode = clearCode + 1;
        let codeSize = minCodeSize + 1;
        let nextCode = eoiCode + 1;
        const maxCode = 4096;

        const table = new Map();
        for (let i = 0; i < clearCode; i++) {
            table.set(String.fromCharCode(i), i);
        }

        const output = [];
        let bitBuffer = 0;
        let bitCount = 0;

        const writeBits = (code, size) => {
            bitBuffer |= code << bitCount;
            bitCount += size;
            while (bitCount >= 8) {
                output.push(bitBuffer & 0xFF);
                bitBuffer >>= 8;
                bitCount -= 8;
            }
        };

        writeBits(clearCode, codeSize);

        let current = '';
        for (let i = 0; i < data.length; i++) {
            const char = String.fromCharCode(data[i]);
            const next = current + char;

            if (table.has(next)) {
                current = next;
            } else {
                writeBits(table.get(current), codeSize);

                if (nextCode < maxCode) {
                    table.set(next, nextCode++);
                    if (nextCode > (1 << codeSize) && codeSize < 12) {
                        codeSize++;
                    }
                } else {
                    writeBits(clearCode, codeSize);
                    table.clear();
                    for (let j = 0; j < clearCode; j++) {
                        table.set(String.fromCharCode(j), j);
                    }
                    codeSize = minCodeSize + 1;
                    nextCode = eoiCode + 1;
                }

                current = char;
            }
        }

        if (current.length > 0) {
            writeBits(table.get(current), codeSize);
        }

        writeBits(eoiCode, codeSize);

        if (bitCount > 0) {
            output.push(bitBuffer & 0xFF);
        }

        return output;
    }
}

// --- Event listeners (wiring) ---

frameExportFormat.addEventListener('change', updateSizeRowVisibility);
document.getElementById('scaPayloadType').addEventListener('change', updateScaOptionsVisibility);
document.getElementById('scaFillPattern').addEventListener('change', updateScaOptionsVisibility);

frameExportSize.addEventListener('change', () => {
    const sizeMode = frameExportSize.value;
    const isSprite = sizeMode.startsWith('sprite-');
    const isPixels = sizeMode === 'sprite-pixels';

    spriteRegionRow.style.display = isSprite ? 'flex' : 'none';

    if (isSprite) {
        const spriteXEl = document.getElementById('spriteX');
        const spriteYEl = document.getElementById('spriteY');
        const spriteWEl = document.getElementById('spriteW');
        const spriteHEl = document.getElementById('spriteH');

        document.getElementById('spriteLabelX').textContent = isPixels ? 'X:' : 'Col:';
        document.getElementById('spriteLabelY').textContent = isPixels ? 'Y:' : 'Row:';

        if (lastSpriteMode !== sizeMode) {
            if (isPixels) {
                if (lastSpriteMode) {
                    spriteXEl.value = Math.min(255, parseInt(spriteXEl.value) * 8);
                    spriteYEl.value = Math.min(191, parseInt(spriteYEl.value) * 8);
                    spriteWEl.value = Math.min(256, parseInt(spriteWEl.value) * 8);
                    spriteHEl.value = Math.min(192, parseInt(spriteHEl.value) * 8);
                }
            } else {
                spriteXEl.value = Math.min(31, Math.floor(parseInt(spriteXEl.value) / 8));
                spriteYEl.value = Math.min(23, Math.floor(parseInt(spriteYEl.value) / 8));
                spriteWEl.value = Math.max(1, Math.min(32, Math.ceil(parseInt(spriteWEl.value) / 8)));
                spriteHEl.value = Math.max(1, Math.min(24, Math.ceil(parseInt(spriteHEl.value) / 8)));
            }
        }

        if (isPixels) {
            spriteXEl.max = 255; spriteYEl.max = 191; spriteWEl.max = 256; spriteHEl.max = 192;
        } else {
            spriteXEl.max = 31; spriteYEl.max = 23; spriteWEl.max = 32; spriteHEl.max = 24;
        }

        lastSpriteMode = sizeMode;
        updateSpriteRegionPreview();
    } else {
        clearSpriteRegionPreview();
    }
});

// Update preview when sprite inputs change
['spriteX', 'spriteY', 'spriteW', 'spriteH'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateSpriteRegionPreview);
});

btnFrameGrabStart.addEventListener('click', startFrameGrab);
btnFrameGrabStop.addEventListener('click', () => stopFrameGrab(false));
btnFrameGrabCancel.addEventListener('click', () => stopFrameGrab(true));
