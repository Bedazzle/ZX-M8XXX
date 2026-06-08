// frame-export.js — Frame Export & PSG Recording (extracted from index.html)
import {
    SCREEN_BITMAP, SCREEN_ATTR,
    SCREEN_SIZE, SCREEN_BITMAP_SIZE, SCREEN_ATTR_SIZE,
    SCREEN_WIDTH, SCREEN_HEIGHT
} from '../core/constants.js';
import { hex8 } from '../core/utils.js';

export function initFrameExport({ getScreenCanvas, getDimensions, getUlaPlusState, getMemoryBlock, readMemory, isRunning, startEmulator, stopEmulator, setOnFrame, getAy, showMessage, getRAMPage, getRamPages, getActiveScreenData }) {

    // ========== Frame Export ==========
    const frameGrabState = {
        active: false,
        frames: [],
        wasRunning: false,
        startTime: 0
    };

    // ========== Loop Detection ==========
    const loopDetectState = {
        active: false,
        wasRunning: false,
        hashes: [],
        confirmedLoops: [],
        startTime: 0,
        maxLoops: 3,
        repeats: 3,
        lastLoopFrame: 0       // frame index when last loop was confirmed
    };
    const frameGrabStatus = document.getElementById('frameGrabStatus');
    const btnFrameGrabStart = document.getElementById('btnFrameGrabStart');
    const btnFrameGrabStop = document.getElementById('btnFrameGrabStop');
    const btnFrameGrabCancel = document.getElementById('btnFrameGrabCancel');
    const frameExportFormat = document.getElementById('frameExportFormat');
    const frameExportSize = document.getElementById('frameExportSize');
    const spriteRegionRow = document.getElementById('spriteRegionRow');
    const sizeRow = document.getElementById('sizeRow');

    // Loop detection element refs
    const btnLoopDetect = document.getElementById('btnLoopDetect');
    const loopResultsContainer = document.getElementById('loopResultsContainer');
    const loopSkipDups = document.getElementById('loopSkipDups');
    const loopSkipDupsLabel = document.getElementById('loopSkipDupsLabel');

    // Track last sprite mode for value conversion
    let lastSpriteMode = null;

    // Show/hide size row based on format selection (SCR/BSC/SCA have fixed sizes)
    function updateSizeRowVisibility() {
        const format = frameExportFormat.value;
        const scaOptionsRow = document.getElementById('scaOptionsRow');
        const scaCustomPatternRow = document.getElementById('scaCustomPatternRow');

        if (format === 'scr' || format === 'sca' || format === 'gigascr') {
            // SCR/SCA requires screen only (256x192)
            sizeRow.style.display = 'none';
            frameExportSize.value = 'screen';
            spriteRegionRow.style.display = 'none';
            clearSpriteRegionPreview();
            // Show SCA options only for SCA format
            scaOptionsRow.style.display = format === 'sca' ? 'flex' : 'none';
            if (format !== 'sca') {
                scaCustomPatternRow.style.display = 'none';
            }
        } else if (format === 'bsc') {
            // BSC requires full border
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

    // Show/hide SCA payload-specific options
    function updateScaOptionsVisibility() {
        const scaOptionsRow = document.getElementById('scaOptionsRow');
        const scaCustomPatternRow = document.getElementById('scaCustomPatternRow');
        const scaPayloadType = document.getElementById('scaPayloadType');
        const scaFillPattern = document.getElementById('scaFillPattern');

        if (scaOptionsRow.style.display === 'none') return;

        const isType1 = scaPayloadType.value === '1';
        // Show fill pattern options only for type 1
        scaFillPattern.disabled = !isType1;
        scaCustomPatternRow.style.display = (isType1 && scaFillPattern.value === 'custom') ? 'flex' : 'none';
    }

    frameExportFormat.addEventListener('change', updateSizeRowVisibility);
    document.getElementById('scaPayloadType').addEventListener('change', updateScaOptionsVisibility);
    document.getElementById('scaFillPattern').addEventListener('change', updateScaOptionsVisibility);

    // Show/hide sprite region inputs and update labels based on size selection
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

            // Update labels
            document.getElementById('spriteLabelX').textContent = isPixels ? 'X:' : 'Col:';
            document.getElementById('spriteLabelY').textContent = isPixels ? 'Y:' : 'Row:';

            // Convert values if switching between pixel and cell modes
            if (lastSpriteMode !== sizeMode) {
                if (isPixels) {
                    if (lastSpriteMode) {
                        // Converting from cells to pixels
                        spriteXEl.value = Math.min(255, parseInt(spriteXEl.value) * 8);
                        spriteYEl.value = Math.min(191, parseInt(spriteYEl.value) * 8);
                        spriteWEl.value = Math.min(SCREEN_WIDTH, parseInt(spriteWEl.value) * 8);
                        spriteHEl.value = Math.min(SCREEN_HEIGHT, parseInt(spriteHEl.value) * 8);
                    }
                    // else: first time pixels - keep HTML defaults (0, 0, 16, 16)
                } else {
                    // Converting to cells (from pixels or first time)
                    spriteXEl.value = Math.min(31, Math.floor(parseInt(spriteXEl.value) / 8));
                    spriteYEl.value = Math.min(23, Math.floor(parseInt(spriteYEl.value) / 8));
                    spriteWEl.value = Math.max(1, Math.min(32, Math.ceil(parseInt(spriteWEl.value) / 8)));
                    spriteHEl.value = Math.max(1, Math.min(24, Math.ceil(parseInt(spriteHEl.value) / 8)));
                }
            }

            // Update max values
            if (isPixels) {
                spriteXEl.max = SCREEN_WIDTH - 1; spriteYEl.max = SCREEN_HEIGHT - 1; spriteWEl.max = SCREEN_WIDTH; spriteHEl.max = SCREEN_HEIGHT;
            } else {
                spriteXEl.max = 31; spriteYEl.max = 23; spriteWEl.max = 32; spriteHEl.max = 24;
            }

            lastSpriteMode = sizeMode;
            updateSpriteRegionPreview();
        } else {
            clearSpriteRegionPreview();
        }
    });

    // Sprite region preview using CSS-positioned div (not canvas, which gets cleared by spectrum)
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

        // Clamp to screen bounds
        spriteX = Math.max(0, Math.min(SCREEN_WIDTH - 1, spriteX));
        spriteY = Math.max(0, Math.min(SCREEN_HEIGHT - 1, spriteY));
        spriteW = Math.max(1, spriteW);
        spriteH = Math.max(1, spriteH);
        if (spriteX + spriteW > SCREEN_WIDTH) spriteW = SCREEN_WIDTH - spriteX;
        if (spriteY + spriteH > SCREEN_HEIGHT) spriteH = SCREEN_HEIGHT - spriteY;

        // Get screen dimensions - use defaults if ULA not ready
        let borderLeft = 32, borderTop = 24, screenWidth = 320;
        const dims = getDimensions();
        if (dims) {
            borderLeft = dims.borderLeft;
            borderTop = dims.borderTop;
            screenWidth = dims.width;
        }

        // Get zoom from screen canvas style
        const screenCanvas = document.getElementById('screen');
        const styleWidth = parseFloat(screenCanvas.style.width) || screenCanvas.width;
        const zoom = styleWidth / screenCanvas.width || 1;

        // Calculate pixel position (accounting for border and zoom)
        const x = (borderLeft + spriteX) * zoom;
        const y = (borderTop + spriteY) * zoom;
        const w = spriteW * zoom;
        const h = spriteH * zoom;

        // Position the overlay div
        spriteOverlay.style.left = x + 'px';
        spriteOverlay.style.top = y + 'px';
        spriteOverlay.style.width = w + 'px';
        spriteOverlay.style.height = h + 'px';
        spriteOverlay.style.display = 'block';
    }

    function clearSpriteRegionPreview() {
        spriteOverlay.style.display = 'none';
    }

    // Update preview when sprite inputs change
    ['spriteX', 'spriteY', 'spriteW', 'spriteH'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateSpriteRegionPreview);
    });

    function updateFrameGrabStatus() {
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

    function captureFrame() {
        if (!frameGrabState.active) return;

        const sizeMode = frameExportSize.value;
        const dims = getDimensions();

        let sx, sy, sw, sh;
        if (sizeMode === 'screen') {
            // Screen only: 256x192, centered
            sx = dims.borderLeft;
            sy = dims.borderTop;
            sw = SCREEN_WIDTH;
            sh = SCREEN_HEIGHT;
        } else if (sizeMode === 'normal') {
            // Normal border (32px each side)
            sx = Math.max(0, dims.borderLeft - 32);
            sy = Math.max(0, dims.borderTop - 32);
            sw = SCREEN_WIDTH + 64;
            sh = SCREEN_HEIGHT + 64;
        } else if (sizeMode.startsWith('sprite-')) {
            // Custom sprite region (relative to screen area)
            const isPixels = sizeMode === 'sprite-pixels';
            const multiplier = isPixels ? 1 : 8;

            // Get input values, default to valid ranges
            let spriteX = parseInt(document.getElementById('spriteX').value) || 0;
            let spriteY = parseInt(document.getElementById('spriteY').value) || 0;
            let spriteW = parseInt(document.getElementById('spriteW').value) || (isPixels ? 16 : 2);
            let spriteH = parseInt(document.getElementById('spriteH').value) || (isPixels ? 16 : 2);

            // Convert to pixels
            spriteX *= multiplier;
            spriteY *= multiplier;
            spriteW *= multiplier;
            spriteH *= multiplier;

            // Clamp position to screen bounds (0-255, 0-191)
            spriteX = Math.max(0, Math.min(SCREEN_WIDTH - 1, spriteX));
            spriteY = Math.max(0, Math.min(SCREEN_HEIGHT - 1, spriteY));

            // Ensure width/height are at least 1 pixel
            spriteW = Math.max(1, spriteW);
            spriteH = Math.max(1, spriteH);

            // Clamp width/height to not exceed screen bounds
            if (spriteX + spriteW > SCREEN_WIDTH) spriteW = SCREEN_WIDTH - spriteX;
            if (spriteY + spriteH > SCREEN_HEIGHT) spriteH = SCREEN_HEIGHT - spriteY;

            sx = dims.borderLeft + spriteX;
            sy = dims.borderTop + spriteY;
            sw = spriteW;
            sh = spriteH;
        } else {
            // Full border
            sx = 0;
            sy = 0;
            sw = dims.width;
            sh = dims.height;
        }

        // Create a temporary canvas to capture the frame region
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = sw;
        tempCanvas.height = sh;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(getScreenCanvas(), sx, sy, sw, sh, 0, 0, sw, sh);

        // Store as data URL (PNG) + memory snapshots for SCA export
        const attrs = getMemoryBlock(SCREEN_ATTR, SCREEN_ATTR_SIZE);
        const bitmap = getMemoryBlock(SCREEN_BITMAP, SCREEN_BITMAP_SIZE);
        const frameData = {
            dataUrl: tempCanvas.toDataURL('image/png'),
            width: sw,
            height: sh,
            attrs: new Uint8Array(attrs),
            bitmap: new Uint8Array(bitmap)
        };

        // For Gigascreen, capture both screen banks directly
        if (frameExportFormat.value === 'gigascr' && getRamPages() > 1) {
            frameData.bank5 = new Uint8Array(getRAMPage(5).subarray(0, SCREEN_SIZE));
            frameData.bank7 = new Uint8Array(getRAMPage(7).subarray(0, SCREEN_SIZE));
        }

        frameGrabState.frames.push(frameData);

        updateFrameGrabStatus();

        // Check max frames limit
        const maxFrames = parseInt(document.getElementById('maxFrames').value) || 0;
        if (maxFrames > 0 && frameGrabState.frames.length >= maxFrames) {
            stopFrameGrab(false);
        }
    }

    function startFrameGrab() {
        frameGrabState.wasRunning = isRunning();
        frameGrabState.active = true;
        frameGrabState.frames = [];
        frameGrabState.startTime = Date.now();

        // Clear sprite region preview during recording
        clearSpriteRegionPreview();

        // Set up frame callback
        setOnFrame(() => {
            captureFrame();
        });

        // Start emulator if not running
        if (!frameGrabState.wasRunning) {
            startEmulator();
        }

        // Update UI
        btnFrameGrabStart.disabled = true;
        btnFrameGrabStop.disabled = false;
        btnFrameGrabCancel.disabled = false;
        btnLoopDetect.disabled = true;
        frameExportFormat.disabled = true;
        frameExportSize.disabled = true;
        document.getElementById('spriteX').disabled = true;
        document.getElementById('spriteY').disabled = true;
        document.getElementById('spriteW').disabled = true;
        document.getElementById('spriteH').disabled = true;
        document.getElementById('maxFrames').disabled = true;

        updateFrameGrabStatus();
        showMessage('Recording frames...');
    }

    function stopFrameGrab(cancel = false) {
        frameGrabState.active = false;
        setOnFrame(null);

        // Stop emulator if it was paused before
        if (!frameGrabState.wasRunning) {
            stopEmulator();
        }

        // Update UI
        btnFrameGrabStart.disabled = false;
        btnFrameGrabStop.disabled = true;
        btnFrameGrabCancel.disabled = true;
        btnLoopDetect.disabled = false;
        frameExportFormat.disabled = false;
        frameExportSize.disabled = false;
        document.getElementById('spriteX').disabled = false;
        document.getElementById('spriteY').disabled = false;
        document.getElementById('spriteW').disabled = false;
        document.getElementById('spriteH').disabled = false;
        document.getElementById('maxFrames').disabled = false;

        // Restore sprite region preview if in sprite mode
        updateSpriteRegionPreview();

        if (cancel) {
            frameGrabState.frames = [];
            frameGrabStatus.textContent = 'Recording cancelled';
            frameGrabStatus.classList.remove('recording');
            showMessage('Frame recording cancelled');
            return;
        }

        // Export frames
        const frameCount = frameGrabState.frames.length;
        if (frameCount === 0) {
            frameGrabStatus.textContent = 'No frames captured';
            showMessage('No frames captured', 'error');
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
        } else if (format === 'gigascr') {
            exportFramesAsImg();
        } else {
            exportFramesAsGif();
        }
    }

    // Get base name for exports from last loaded filename (any type: SNA, Z80, TAP, TRD, etc.)
    function getExportBaseName() {
        const el = document.getElementById('lastLoadedFile');
        const name = el ? el.textContent.trim() : '';
        if (!name || name === '\u2014') return 'frame'; // em dash = no file loaded
        // Strip file extension for clean base name
        const dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    async function exportFramesAsZip() {
        const frames = frameGrabState.frames;
        const baseName = getExportBaseName();

        // Single frame - save as single PNG file, not ZIP
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
            showMessage(`Exported ${baseName}_0000.png`);
            frameGrabState.frames = [];
            return;
        }

        // Multiple frames - create ZIP
        const files = [];
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const filename = `${baseName}_${String(i).padStart(4, '0')}.png`;

            // Convert data URL to binary
            const base64 = frame.dataUrl.split(',')[1];
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let j = 0; j < binary.length; j++) {
                bytes[j] = binary.charCodeAt(j);
            }

            files.push({ name: filename, data: bytes });
        }

        // Create ZIP using simple store method (no compression for PNGs - already compressed)
        const zipData = createZip(files);

        // Download
        const blob = new Blob([zipData], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}.zip`;
        a.click();
        URL.revokeObjectURL(url);

        frameGrabStatus.textContent = `Exported ${frames.length} frames to ZIP`;
        frameGrabStatus.classList.remove('recording');
        showMessage(`Exported ${frames.length} frames to ${baseName}.zip`);
        frameGrabState.frames = [];
    }

    function createZip(files) {
        // Simple ZIP file creator (store method, no compression)
        const localHeaders = [];
        const centralHeaders = [];
        let offset = 0;

        for (const file of files) {
            const nameBytes = new TextEncoder().encode(file.name);
            const data = file.data;

            // CRC32
            const crc = crc32(data);

            // Local file header
            const localHeader = new Uint8Array(30 + nameBytes.length);
            const lv = new DataView(localHeader.buffer);
            lv.setUint32(0, 0x04034b50, true);  // Local file header signature
            lv.setUint16(4, 20, true);          // Version needed
            lv.setUint16(6, 0, true);           // General purpose flag
            lv.setUint16(8, 0, true);           // Compression: store
            lv.setUint16(10, 0, true);          // Mod time
            lv.setUint16(12, 0, true);          // Mod date
            lv.setUint32(14, crc, true);        // CRC32
            lv.setUint32(18, data.length, true);// Compressed size
            lv.setUint32(22, data.length, true);// Uncompressed size
            lv.setUint16(26, nameBytes.length, true); // Filename length
            lv.setUint16(28, 0, true);          // Extra field length
            localHeader.set(nameBytes, 30);

            // Central directory header
            const centralHeader = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(centralHeader.buffer);
            cv.setUint32(0, 0x02014b50, true);  // Central file header signature
            cv.setUint16(4, 20, true);          // Version made by
            cv.setUint16(6, 20, true);          // Version needed
            cv.setUint16(8, 0, true);           // General purpose flag
            cv.setUint16(10, 0, true);          // Compression: store
            cv.setUint16(12, 0, true);          // Mod time
            cv.setUint16(14, 0, true);          // Mod date
            cv.setUint32(16, crc, true);        // CRC32
            cv.setUint32(20, data.length, true);// Compressed size
            cv.setUint32(24, data.length, true);// Uncompressed size
            cv.setUint16(28, nameBytes.length, true); // Filename length
            cv.setUint16(30, 0, true);          // Extra field length
            cv.setUint16(32, 0, true);          // Comment length
            cv.setUint16(34, 0, true);          // Disk number start
            cv.setUint16(36, 0, true);          // Internal attributes
            cv.setUint32(38, 0, true);          // External attributes
            cv.setUint32(42, offset, true);     // Relative offset
            centralHeader.set(nameBytes, 46);

            localHeaders.push({ header: localHeader, data: data });
            centralHeaders.push(centralHeader);
            offset += localHeader.length + data.length;
        }

        // End of central directory record
        const centralDirOffset = offset;
        let centralDirSize = 0;
        for (const ch of centralHeaders) {
            centralDirSize += ch.length;
        }

        const endRecord = new Uint8Array(22);
        const ev = new DataView(endRecord.buffer);
        ev.setUint32(0, 0x06054b50, true);      // End signature
        ev.setUint16(4, 0, true);               // Disk number
        ev.setUint16(6, 0, true);               // Start disk
        ev.setUint16(8, files.length, true);    // Entries on disk
        ev.setUint16(10, files.length, true);   // Total entries
        ev.setUint32(12, centralDirSize, true); // Central dir size
        ev.setUint32(16, centralDirOffset, true); // Central dir offset
        ev.setUint16(20, 0, true);              // Comment length

        // Combine all parts
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

    // ========== Loop Detection Algorithm ==========

    // Fuzzy mismatch budget: games without HALT have non-integer animation
    // periods (e.g. ~11.7 frames), causing occasional frame shifts.
    // Allow up to 10% mismatches to handle this.
    function maxMismatches(length) {
        return length < 4 ? 0 : Math.max(1, Math.floor(length * 0.1));
    }

    function validateLoop(hashes, period, startFrame, repeats) {
        const totalFrames = period * repeats;
        if (startFrame + totalFrames > hashes.length) return false;
        // Reject static screen (all hashes within one cycle identical)
        let allSame = true;
        for (let i = 1; i < period; i++) {
            if (hashes[startFrame + i] !== hashes[startFrame]) { allSame = false; break; }
        }
        if (allSame) return false;
        // Verify cycles match with fuzzy tolerance for non-integer animation periods
        const maxMM = maxMismatches(period);
        for (let cycle = 1; cycle < repeats; cycle++) {
            let mismatches = 0;
            for (let i = 0; i < period; i++) {
                if (hashes[startFrame + i] !== hashes[startFrame + cycle * period + i]) {
                    mismatches++;
                    if (mismatches > maxMM) return false;
                }
            }
        }
        return true;
    }

    function detectLoopAtCurrentFrame(hashes, confirmedLoops, repeats) {
        const N = hashes.length - 1;
        const currentHash = hashes[N];
        const maxSearch = Math.min(N, 2000);
        for (let M = N - 2; M >= N - maxSearch && M >= 0; M--) {
            if (hashes[M] !== currentHash) continue;
            const period = N - M;
            if (period === 1) continue;
            // Near-multiple check: suppress if period ≈ k × confirmed period.
            // Allow 1 frame of drift per sub-cycle (non-integer animation periods
            // cause accumulated frame shift proportional to the number of cycles).
            let dominated = false;
            for (const cl of confirmedLoops) {
                const k = Math.round(period / cl.period);
                if (k >= 1 && Math.abs(period - k * cl.period) <= k) {
                    dominated = true; break;
                }
            }
            if (dominated) continue;
            const startFrame = N - period * repeats + 1;
            if (startFrame < 0) continue;
            if (validateLoop(hashes, period, startFrame, repeats)) {
                return { period, startFrame };
            }
        }
        return null;
    }

    // Post-processing: merge jitter-variant states that represent the same visual.
    // Uses natural gap in pairwise distances: small distances = jitter, large = real differences.
    // After merging, remaps hashes and re-detects loops on the cleaned sequence.
    function mergeCloseStates() {
        const states = loopDetectKnownStates;
        const n = states.length;
        if (n <= 2) return false;   // 2 or fewer = nothing ambiguous to merge

        // Compute all pairwise cell distances using cell hashes
        const pairDists = [];
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                pairDists.push({
                    i, j,
                    dist: countCellDiffsFromHashes(states[i].cellHashes, states[j].cellHashes)
                });
            }
        }
        pairDists.sort((a, b) => a.dist - b.dist);

        // Find largest gap (ratio) between consecutive sorted distances.
        // Distances below the gap = jitter within same state.
        // Distances above = genuinely different states.
        let bestGapIdx = -1;
        let bestGapRatio = 0;
        for (let k = 0; k < pairDists.length - 1; k++) {
            const lo = pairDists[k].dist;
            const hi = pairDists[k + 1].dist;
            if (lo === 0) continue;
            const ratio = hi / lo;
            if (ratio > bestGapRatio) {
                bestGapRatio = ratio;
                bestGapIdx = k;
            }
        }

        // Only merge if there's a clear separation (at least 3× gap)
        if (bestGapIdx < 0 || bestGapRatio < 3) return false;

        const mergeThreshold = pairDists[bestGapIdx].dist;

        // Union-find to group close states
        const parent = Array.from({ length: n }, (_, i) => i);
        function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
        function union(a, b) { parent[find(a)] = find(b); }

        for (const { i, j, dist } of pairDists) {
            if (dist <= mergeThreshold) union(i, j);
        }

        // Check if any merging actually happened
        const groups = new Set();
        for (let i = 0; i < n; i++) groups.add(find(i));
        if (groups.size >= n) return false;

        // Build hash remap: every state's hash → its root state's hash
        const hashMap = new Map();
        for (let i = 0; i < n; i++) {
            hashMap.set(states[i].hash, states[find(i)].hash);
        }

        // Remap all hashes in the recorded sequence
        const hashes = loopDetectState.hashes;
        for (let i = 0; i < hashes.length; i++) {
            const mapped = hashMap.get(hashes[i]);
            if (mapped !== undefined) hashes[i] = mapped;
        }


        return true;
    }

    // Re-detect loops on the (possibly merged) hash sequence from scratch.
    function redetectLoops() {
        const confirmedLoops = [];
        const hashes = loopDetectState.hashes;
        const repeats = loopDetectState.repeats;
        const maxLoops = loopDetectState.maxLoops;

        for (let N = repeats * 2; N < hashes.length && confirmedLoops.length < maxLoops; N++) {
            const currentHash = hashes[N];
            const maxSearch = Math.min(N, 2000);
            for (let M = N - 2; M >= N - maxSearch && M >= 0; M--) {
                if (hashes[M] !== currentHash) continue;
                const period = N - M;
                if (period === 1) continue;
                let dominated = false;
                for (const cl of confirmedLoops) {
                    const k = Math.round(period / cl.period);
                    if (k >= 1 && Math.abs(period - k * cl.period) <= k) {
                        dominated = true; break;
                    }
                }
                if (dominated) continue;
                const startFrame = N - period * repeats + 1;
                if (startFrame < 0) continue;
                if (validateLoop(hashes, period, startFrame, repeats)) {
                    confirmedLoops.push({ period, startFrame });
                    break;
                }
            }
        }

        loopDetectState.confirmedLoops = confirmedLoops;
    }

    let loopDetectPrevPixels = null;       // Previous frame canvas pixels for jitter detection
    let loopDetectPrevCellHashes = null;   // Previous frame cell hashes (768 uint32) for fast jitter check
    let loopDetectKnownStates = [];        // Array of { hash, pixels, bitmap, attrs, cellHashes } for stable state IDs
    let loopDetectCanvas = null;
    let loopDetectCtx = null;
    let loopDetectFrameCounter = 0;        // For throttled DOM updates

    // Capture rendered canvas pixels into a reusable canvas.
    // Returns the pixel data (Uint8ClampedArray).
    function captureCanvasPixels() {
        if (!loopDetectCanvas) {
            loopDetectCanvas = document.createElement('canvas');
            loopDetectCanvas.width = SCREEN_WIDTH;
            loopDetectCanvas.height = SCREEN_HEIGHT;
            loopDetectCtx = loopDetectCanvas.getContext('2d', { willReadFrequently: true });
        }
        const dims = getDimensions();
        loopDetectCtx.drawImage(getScreenCanvas(), dims.borderLeft, dims.borderTop,
            SCREEN_WIDTH, SCREEN_HEIGHT, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        return loopDetectCtx.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT).data;
    }

    // Capture a data URL from the current screen canvas (called only at state registration).
    function captureCanvasDataUrl() {
        // Use the same offscreen canvas that captureCanvasPixels uses
        // (it was just drawn to in captureCanvasPixels, so it has the current frame)
        return loopDetectCanvas.toDataURL('image/png');
    }

    // Count how many 8x8 character cells differ between two RGBA pixel arrays.
    // Screen is 256x192 = 32x24 cells. Returns 0..768.
    function countCellDifferences(pixels1, pixels2) {
        const COLS = 32, ROWS = 24, CELL = 8;
        const stride = SCREEN_WIDTH * 4;
        let diffCount = 0;
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                let cellDiffers = false;
                const baseY = row * CELL;
                const baseX = col * CELL * 4;
                for (let y = 0; y < CELL && !cellDiffers; y++) {
                    const rowOff = (baseY + y) * stride + baseX;
                    for (let x = 0; x < CELL * 4; x += 4) {
                        const off = rowOff + x;
                        if (pixels1[off] !== pixels2[off] ||
                            pixels1[off + 1] !== pixels2[off + 1] ||
                            pixels1[off + 2] !== pixels2[off + 2]) {
                            cellDiffers = true;
                            break;
                        }
                    }
                }
                if (cellDiffers) diffCount++;
            }
        }
        return diffCount;
    }

    // Pre-compute a hash per 8x8 cell (768 uint32 values).
    // Comparing cell hashes is 768 int comparisons (3KB) vs 196KB pixel scan.
    function computeCellHashes(pixels) {
        const COLS = 32, ROWS = 24, CELL = 8;
        const stride = SCREEN_WIDTH * 4;
        const result = new Uint32Array(COLS * ROWS);
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                let h = 0x811c9dc5;  // FNV-1a offset basis
                const baseY = row * CELL;
                const baseX = col * CELL * 4;
                for (let y = 0; y < CELL; y++) {
                    const rowOff = (baseY + y) * stride + baseX;
                    for (let x = 0; x < CELL * 4; x += 4) {
                        const off = rowOff + x;
                        h ^= pixels[off];     h = Math.imul(h, 0x01000193);
                        h ^= pixels[off + 1]; h = Math.imul(h, 0x01000193);
                        h ^= pixels[off + 2]; h = Math.imul(h, 0x01000193);
                    }
                }
                result[row * COLS + col] = h >>> 0;
            }
        }
        return result;
    }

    // Count cell differences using pre-computed cell hashes (768 int comparisons)
    function countCellDiffsFromHashes(cellHashes1, cellHashes2) {
        let diff = 0;
        for (let i = 0; i < 768; i++) {
            if (cellHashes1[i] !== cellHashes2[i]) diff++;
        }
        return diff;
    }

    // State matching thresholds (cell-level comparison, 768 cells total):
    const FRAME_JITTER_THRESHOLD = 2;   // consecutive frame jitter (1-2 cells) → same state as prev
    const STATE_MATCH_THRESHOLD = 4;    // absolute match against known states

    function captureLoopFrame() {
        if (!loopDetectState.active) return;

        const hashes = loopDetectState.hashes;
        let hash;

        // Capture canvas pixels and compute cell hashes
        const currentPixels = captureCanvasPixels();
        const currentCellHashes = computeCellHashes(currentPixels);

        // Stage 1: compare with previous frame — small jitter = same state
        if (loopDetectPrevCellHashes !== null && hashes.length > 0) {
            const jitterDist = countCellDiffsFromHashes(currentCellHashes, loopDetectPrevCellHashes);
            if (jitterDist <= FRAME_JITTER_THRESHOLD) {
                hash = hashes[hashes.length - 1];
                loopDetectPrevPixels = currentPixels;
                loopDetectPrevCellHashes = currentCellHashes;
                hashes.push(hash);
                detectAndUpdate();
                return;
            }
        }

        // Stage 2: compare with known states using cell hashes (768 int comparisons each)
        if (loopDetectKnownStates.length > 0) {
            let bestHash = null;
            let bestDist = Infinity;
            for (const state of loopDetectKnownStates) {
                const dist = countCellDiffsFromHashes(currentCellHashes, state.cellHashes);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestHash = state.hash;
                }
            }
            if (bestDist <= STATE_MATCH_THRESHOLD) {
                hash = bestHash;
            } else {
                hash = registerNewState(currentPixels, currentCellHashes);
            }
        } else {
            hash = registerNewState(currentPixels, currentCellHashes);
        }

        loopDetectPrevPixels = currentPixels;
        loopDetectPrevCellHashes = currentCellHashes;
        hashes.push(hash);
        detectAndUpdate();

        function detectAndUpdate() {
            const result = detectLoopAtCurrentFrame(
                hashes, loopDetectState.confirmedLoops, loopDetectState.repeats
            );
            if (result) {
                loopDetectState.confirmedLoops.push(result);
                loopDetectState.lastLoopFrame = hashes.length;
            }

            // Throttle DOM update to every 10 frames
            loopDetectFrameCounter++;
            if (loopDetectFrameCounter % 10 === 0) {
                const frameCount = hashes.length;
                const loopsFound = loopDetectState.confirmedLoops.length;
                const stateCount = loopDetectKnownStates.length;
                frameGrabStatus.textContent = `Detecting... ${frameCount} frames, ${stateCount} states, ${loopsFound}/${loopDetectState.maxLoops} loops`;
                frameGrabStatus.classList.add('recording');
            }

            const frameCount = hashes.length;
            const loopsFound = loopDetectState.confirmedLoops.length;
            const framesSinceLastLoop = frameCount - loopDetectState.lastLoopFrame;
            if (loopsFound >= loopDetectState.maxLoops || frameCount >= 5000 ||
                (loopsFound > 0 && framesSinceLastLoop >= 500)) {
                stopLoopDetection();
            }
        }
    }

    function registerNewState(currentPixels, cellHashes) {
        const screenView = getActiveScreenData();
        const screenData = new Uint8Array(screenView);
        const hash = crc32(currentPixels);
        const dataUrl = captureCanvasDataUrl();
        loopDetectKnownStates.push({
            hash,
            pixels: new Uint8ClampedArray(currentPixels),
            cellHashes: new Uint32Array(cellHashes),
            bitmap: new Uint8Array(screenData.subarray(0, SCREEN_BITMAP_SIZE)),
            attrs: new Uint8Array(screenData.subarray(SCREEN_BITMAP_SIZE, SCREEN_SIZE)),
            _dataUrl: dataUrl
        });

        return hash;
    }

    function startLoopDetection() {
        loopDetectState.repeats = 3;
        loopDetectState.maxLoops = 3;
        loopDetectState.wasRunning = isRunning();
        loopDetectState.active = true;
        loopDetectState.hashes = [];
        loopDetectState.confirmedLoops = [];
        loopDetectState.startTime = Date.now();
        loopDetectPrevPixels = null;
        loopDetectPrevCellHashes = null;
        loopDetectKnownStates = [];
        loopDetectFrameCounter = 0;

        // Hide previous results
        loopResultsContainer.style.display = 'none';
        loopResultsContainer.innerHTML = '';
        loopSkipDupsLabel.style.display = 'none';

        setOnFrame(() => {
            captureLoopFrame();
        });

        if (!loopDetectState.wasRunning) {
            startEmulator();
        }

        btnLoopDetect.textContent = 'Stop';
        btnFrameGrabStart.disabled = true;
        btnFrameGrabStop.disabled = true;
        btnFrameGrabCancel.disabled = true;
        frameGrabStatus.textContent = 'Detecting... 0 frames';
        frameGrabStatus.classList.add('recording');
        showMessage('Loop detection started...');
    }

    function stopLoopDetection() {
        loopDetectState.active = false;
        setOnFrame(null);

        if (!loopDetectState.wasRunning) {
            stopEmulator();
        }

        btnLoopDetect.textContent = 'Detect Loop';
        btnFrameGrabStart.disabled = false;
        btnFrameGrabStop.disabled = true;
        btnFrameGrabCancel.disabled = true;
        frameGrabStatus.classList.remove('recording');

        // Post-processing: merge jitter-variant states, re-detect if needed
        if (mergeCloseStates()) {
            redetectLoops();
        }

        const loops = loopDetectState.confirmedLoops;
        if (loops.length === 0) {
            frameGrabStatus.textContent = `No loops found (${loopDetectState.hashes.length} frames scanned)`;
            showMessage('No animation loops detected');
            discardLoopData();
            return;
        }

        frameGrabStatus.textContent = `Found ${loops.length} loop(s) in ${loopDetectState.hashes.length} frames`;
        showMessage(`Detected ${loops.length} animation loop(s)`);
        displayLoopResults();
    }

    let selectedLoop = null;

    function displayLoopResults() {
        const loops = loopDetectState.confirmedLoops.slice().sort((a, b) => a.period - b.period);
        loopResultsContainer.innerHTML = '';
        loopResultsContainer.style.display = 'block';
        selectedLoop = null;

        const btnDiscard = document.createElement('button');
        btnDiscard.className = 'frame-grab-btn';
        btnDiscard.textContent = 'Discard';
        btnDiscard.style.marginTop = '6px';
        btnDiscard.title = 'Discard loop detection results';
        btnDiscard.addEventListener('click', () => {
            discardLoopData();
            frameGrabStatus.textContent = 'Results discarded';
        });

        // Build loop list
        const list = document.createElement('div');
        list.className = 'loop-results-list';

        loops.forEach((loop) => {
            const duration = (loop.period / 50).toFixed(2);
            const item = document.createElement('div');
            item.className = 'loop-result-item';
            item.innerHTML = `<span class="loop-result-badge">${loop.period} frames</span>` +
                `<span style="font-size: 11px;">${duration}s cycle</span>`;
            item.addEventListener('click', () => {
                list.querySelectorAll('.loop-result-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                selectedLoop = loop;
            });
            list.appendChild(item);
        });

        loopResultsContainer.appendChild(list);
        loopResultsContainer.appendChild(btnDiscard);
        loopSkipDupsLabel.style.display = '';

        // Auto-select first (shortest) loop
        if (loops.length > 0) {
            selectedLoop = loops[0];
            list.firstChild.classList.add('selected');
        }
    }

    // Build a hash→state lookup from known states
    function getStateByHash(hash) {
        for (const state of loopDetectKnownStates) {
            if (state.hash === hash) return state;
        }
        return null;
    }

    // Return the dataUrl captured at state registration time.
    function stateToDataUrl(state) {
        return state._dataUrl;
    }

    // Build export frame objects from hashes + known states for one cycle.
    // If skipDups is true:
    //   Phase 1: merge consecutive identical hashes into runs
    //   Phase 2: merge visually-similar consecutive runs (jitter/transition artifacts)
    //            using adaptive gap detection on inter-run cell distances
    function buildExportFrames(hashes, startFrame, period, skipDups) {
        // Phase 1: build runs (consecutive identical hashes merged)
        const runs = [];
        for (let i = 0; i < period; i++) {
            const hash = hashes[startFrame + i];
            const state = getStateByHash(hash);
            if (!state) continue;
            if (skipDups && runs.length > 0 && runs[runs.length - 1].hash === hash) {
                runs[runs.length - 1].count++;
            } else {
                runs.push({ state, hash, count: 1 });
            }
        }

        // Phase 2: merge visually-similar consecutive runs (only when skipDups)
        if (skipDups && runs.length > 2) {
            // Compute cell distances between consecutive runs using cell hashes
            const dists = [];
            for (let j = 0; j < runs.length - 1; j++) {
                dists.push(countCellDiffsFromHashes(runs[j].state.cellHashes, runs[j + 1].state.cellHashes));
            }
            // Find natural gap in sorted distances: small = jitter, large = real transition
            const sorted = [...dists].sort((a, b) => a - b);
            let mergeThreshold = -1;
            for (let k = 0; k < sorted.length - 1; k++) {
                if (sorted[k] === 0) continue;
                if (sorted[k + 1] / sorted[k] >= 3) {
                    mergeThreshold = sorted[k];
                    break;
                }
            }
            // Merge consecutive runs within threshold
            if (mergeThreshold >= 0) {
                const merged = [runs[0]];
                for (let j = 1; j < runs.length; j++) {
                    const dist = countCellDiffsFromHashes(runs[j].state.cellHashes, merged[merged.length - 1].state.cellHashes);
                    if (dist <= mergeThreshold) {
                        merged[merged.length - 1].count += runs[j].count;
                    } else {
                        merged.push(runs[j]);
                    }
                }
                runs.length = 0;
                runs.push(...merged);

            }
        }


        return runs.map(r => ({
            dataUrl: stateToDataUrl(r.state),
            width: SCREEN_WIDTH,
            height: SCREEN_HEIGHT,
            bitmap: r.state.bitmap,
            attrs: r.state.attrs,
            delay: r.count * 2  // centiseconds at 50fps
        }));
    }

    function exportLoop(loop, format) {
        const exportFrames = buildExportFrames(
            loopDetectState.hashes, loop.startFrame, loop.period,
            loopSkipDups.checked
        );
        if (exportFrames.length === 0) {
            showMessage('Loop frames no longer available', 'error');
            return;
        }

        // Temporarily place into frameGrabState for existing export functions
        const savedFrames = frameGrabState.frames;
        frameGrabState.frames = exportFrames;

        // Force screen-only size mode for export
        const savedSize = frameExportSize.value;
        frameExportSize.value = 'screen';

        const restore = () => {
            frameGrabState.frames = savedFrames;
            frameExportSize.value = savedSize;
        };

        if (format === 'gif') {
            exportFramesAsGif().then(restore);
        } else if (format === 'zip') {
            exportFramesAsZip().then(restore);
        } else if (format === 'scr') {
            exportFramesAsScr('scr').then(restore);
        }
    }

    function discardLoopData() {
        loopDetectState.hashes = [];
        loopDetectState.confirmedLoops = [];
        loopDetectPrevPixels = null;
        loopDetectPrevCellHashes = null;
        loopDetectKnownStates = [];
        loopDetectFrameCounter = 0;
        selectedLoop = null;
        loopResultsContainer.style.display = 'none';
        loopResultsContainer.innerHTML = '';
        loopSkipDupsLabel.style.display = 'none';
    }

    btnLoopDetect.addEventListener('click', () => {
        if (loopDetectState.active) {
            stopLoopDetection();
        } else {
            // Don't start if frame grab is active
            if (frameGrabState.active) {
                showMessage('Stop frame recording first', 'error');
                return;
            }
            startLoopDetection();
        }
    });

    // Called by the main Export button — returns true if a loop was exported
    function exportSelectedLoop() {
        if (!selectedLoop) return false;
        const fmt = frameExportFormat.value;
        const formatMap = { png: 'zip', gif: 'gif', zip: 'zip', scr: 'scr', bsc: 'scr', sca: 'sca', gigascr: 'scr' };
        exportLoop(selectedLoop, formatMap[fmt] || 'gif');
        return true;
    }

    // ZX Spectrum standard palette (RGB values)
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

    function rgbToZxColor(r, g, b) {
        // Find closest ZX Spectrum color
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

    function imageDataToScr(pixels, srcWidth, screenLeft, screenTop) {
        // Convert image to SCR format (SCREEN_SIZE bytes)
        // SCR = SCREEN_BITMAP_SIZE bytes bitmap + SCREEN_ATTR_SIZE bytes attributes
        const scr = new Uint8Array(SCREEN_SIZE);

        // Process each 8x8 character cell
        for (let charY = 0; charY < 24; charY++) {
            for (let charX = 0; charX < 32; charX++) {
                // Count colors in this cell
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

                // Find two most common colors
                const sorted = [...colorCounts.entries()].sort((a, b) => b[1] - a[1]);
                let ink = sorted[0] ? sorted[0][0] : 0;
                let paper = sorted[1] ? sorted[1][0] : 7;

                // Determine brightness (both colors should match)
                const inkBright = ink >= 8;
                const paperBright = paper >= 8;
                const bright = inkBright || paperBright;

                // Convert to base color (0-7)
                ink = ink % 8;
                paper = paper % 8;

                // Make sure paper is different from ink
                if (paper === ink) {
                    paper = (ink === 7) ? 0 : 7;
                }

                // Build attribute byte
                const attr = (bright ? 0x40 : 0) | (paper << 3) | ink;
                scr[SCREEN_BITMAP_SIZE + charY * 32 + charX] = attr;

                // Build bitmap for this cell
                for (let py = 0; py < 8; py++) {
                    let byte = 0;
                    for (let px = 0; px < 8; px++) {
                        const sx = screenLeft + charX * 8 + px;
                        const sy = screenTop + charY * 8 + py;
                        const idx = (sy * srcWidth + sx) * 4;
                        const zxColor = rgbToZxColor(pixels[idx], pixels[idx+1], pixels[idx+2]) % 8;

                        // Pixel is set if closer to ink than paper
                        const inkDist = Math.abs(zxColor - ink);
                        const paperDist = Math.abs(zxColor - paper);
                        if (inkDist <= paperDist) {
                            byte |= (0x80 >> px);
                        }
                    }

                    // Calculate screen address (ZX Spectrum weird layout)
                    const third = Math.floor(charY / 8);
                    const charRow = charY % 8;
                    const addr = third * 2048 + py * 256 + charRow * 32 + charX;
                    scr[addr] = byte;
                }
            }
        }

        return scr;
    }

    // BSC format constants
    const BSC_FORMAT = {
        TOTAL_SIZE: 11136,        // SCREEN_SIZE + 4224
        BORDER_OFFSET: SCREEN_SIZE,
        BORDER_SIZE: 4224,
        BYTES_PER_FULL_LINE: 24,  // Top/bottom: 24 bytes per line (384px / 16px per byte)
        BYTES_PER_SIDE_LINE: 8,   // Side: 8 bytes per line (4 left + 4 right)
        FRAME_WIDTH: 384,
        FRAME_HEIGHT: 304,
        BORDER_LEFT_PX: 64,
        BORDER_TOP_LINES: 64,
        BORDER_BOTTOM_LINES: 48,
        SCREEN_LINES: 192
    };

    function extractBscBorder(pixels, srcWidth, srcHeight, screenLeft, screenTop) {
        // BSC border format:
        // - Top border: 64 lines x 24 bytes = 1536 bytes
        // - Side borders: 192 lines x 8 bytes = 1536 bytes (4 left + 4 right)
        // - Bottom border: 48 lines x 24 bytes = 1152 bytes
        // Each byte: bits 2-0 = first color (8px), bits 5-3 = second color (8px)
        const borderData = new Uint8Array(BSC_FORMAT.BORDER_SIZE);
        let offset = 0;

        // Helper: sample color at pixel position (clamped to frame bounds)
        const getColor = (x, y) => {
            x = Math.max(0, Math.min(srcWidth - 1, Math.floor(x)));
            y = Math.max(0, Math.min(srcHeight - 1, Math.floor(y)));
            const idx = (y * srcWidth + x) * 4;
            return rgbToZxColor(pixels[idx], pixels[idx+1], pixels[idx+2]) % 8;
        };

        // Helper: pack two 3-bit colors into one byte
        const packColors = (c1, c2) => (c1 & 7) | ((c2 & 7) << 3);

        // Calculate border sizes in captured frame
        const srcScreenRight = screenLeft + SCREEN_WIDTH;
        const srcScreenBottom = screenTop + SCREEN_HEIGHT;
        const srcRightBorder = srcWidth - srcScreenRight;
        const srcBottomBorder = srcHeight - srcScreenBottom;

        // Top border: 64 lines x 24 bytes (384px width)
        // Map 64 BSC lines to srcTop lines of captured frame
        for (let line = 0; line < BSC_FORMAT.BORDER_TOP_LINES; line++) {
            const srcY = screenTop > 0 ? (line * screenTop / BSC_FORMAT.BORDER_TOP_LINES) : 0;
            for (let col = 0; col < BSC_FORMAT.BYTES_PER_FULL_LINE; col++) {
                // Each byte covers 16 pixels (2 colors x 8 pixels)
                // Map 384px BSC width to srcWidth
                const bscX1 = col * 16;
                const bscX2 = col * 16 + 8;
                const srcX1 = bscX1 * srcWidth / BSC_FORMAT.FRAME_WIDTH;
                const srcX2 = bscX2 * srcWidth / BSC_FORMAT.FRAME_WIDTH;
                const c1 = getColor(srcX1, srcY);
                const c2 = getColor(srcX2, srcY);
                borderData[offset++] = packColors(c1, c2);
            }
        }

        // Side borders: 192 lines x 8 bytes (4 left + 4 right)
        for (let line = 0; line < BSC_FORMAT.SCREEN_LINES; line++) {
            const srcY = screenTop + line;

            // Left side: 4 bytes = 64 BSC pixels
            for (let col = 0; col < 4; col++) {
                const bscX1 = col * 16;
                const bscX2 = col * 16 + 8;
                // Map 64px BSC left border to screenLeft pixels
                const srcX1 = screenLeft > 0 ? (bscX1 * screenLeft / 64) : 0;
                const srcX2 = screenLeft > 0 ? (bscX2 * screenLeft / 64) : 0;
                const c1 = getColor(srcX1, srcY);
                const c2 = getColor(srcX2, srcY);
                borderData[offset++] = packColors(c1, c2);
            }

            // Right side: 4 bytes = 64 BSC pixels
            for (let col = 0; col < 4; col++) {
                const bscX1 = col * 16;
                const bscX2 = col * 16 + 8;
                // Map 64px BSC right border to srcRightBorder pixels
                const srcX1 = srcScreenRight + (srcRightBorder > 0 ? (bscX1 * srcRightBorder / 64) : 0);
                const srcX2 = srcScreenRight + (srcRightBorder > 0 ? (bscX2 * srcRightBorder / 64) : 0);
                const c1 = getColor(srcX1, srcY);
                const c2 = getColor(srcX2, srcY);
                borderData[offset++] = packColors(c1, c2);
            }
        }

        // Bottom border: 48 lines x 24 bytes (384px width)
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

    async function exportFramesAsScr(ext) {
        const frames = frameGrabState.frames;
        const baseName = getExportBaseName();
        const files = [];
        const isBsc = ext === 'bsc';

        // Get border dimensions for proper extraction
        let borderLeft = 0, borderTop = 0;
        const dimsForBorder = getDimensions();
        if (dimsForBorder) {
            borderLeft = dimsForBorder.borderLeft;
            borderTop = dimsForBorder.borderTop;
        }

        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const filename = `${baseName}_${String(i).padStart(4, '0')}.${ext}`;

            // Convert data URL to image
            const img = new Image();
            img.src = frame.dataUrl;
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

            // Get image data
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = frame.width;
            tempCanvas.height = frame.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(img, 0, 0);
            const imageData = tempCtx.getImageData(0, 0, frame.width, frame.height);
            const pixels = imageData.data;

            // Determine screen position within captured frame
            let scrLeft = 0, scrTop = 0;
            if (frame.width > SCREEN_WIDTH) {
                // Frame includes border - calculate screen position
                // For full capture (dims.width x dims.height): screen at (borderLeft, borderTop)
                // For normal capture (320 x 256): screen at (32, 32)
                // For other sizes: calculate based on the border we have
                const dims = getDimensions();
                if (dims && frame.width >= dims.width && frame.height >= dims.height) {
                    // Full or larger capture
                    scrLeft = borderLeft;
                    scrTop = borderTop;
                } else if (frame.width === 320 && frame.height === 256) {
                    // Normal capture mode (32px borders)
                    scrLeft = 32;
                    scrTop = 32;
                } else {
                    // Calculate proportionally from what we have
                    scrLeft = (frame.width - SCREEN_WIDTH) / 2;
                    scrTop = (frame.height - SCREEN_HEIGHT) / 2;
                }
            }

            // Convert to SCR format
            const scrData = imageDataToScr(pixels, frame.width, scrLeft, scrTop);

            if (isBsc) {
                // BSC format: SCR (SCREEN_SIZE) + border data (4224 bytes)
                // Full frame: 384x304, border color packed 2 per byte
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

        // Single frame - save as single file, not ZIP
        if (files.length === 1) {
            let fileData = files[0].data;
            let statusMsg = `Exported 1 ${ext.toUpperCase()} frame`;

            // For SCR format with ULAplus active and palette modified, use raw memory + palette
            const ulaPlusState = getUlaPlusState();
            if (!isBsc && ulaPlusState.enabled && ulaPlusState.paletteEnabled && ulaPlusState.paletteModified) {
                const scrData = new Uint8Array(SCREEN_SIZE + 64);
                for (let i = 0; i < SCREEN_SIZE; i++) {
                    scrData[i] = readMemory(SCREEN_BITMAP + i);
                }
                scrData.set(ulaPlusState.palette, SCREEN_SIZE);
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
            showMessage(statusMsg);
            return;
        }

        // Multiple frames - create ZIP
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
        showMessage(`Exported ${frameCount} frames to ${baseName}_${ext}.zip`);
    }

    function exportFramesAsImg() {
        const frames = frameGrabState.frames;
        const baseName = getExportBaseName();
        const frameCount = frames.length;

        // 48K fallback — no second screen bank
        if (getRamPages() === 1) {
            // Fall back to SCR export
            exportFramesAsScr('scr');
            showMessage('48K: no second screen bank — exported as SCR');
            return;
        }

        const files = [];
        for (let i = 0; i < frameCount; i++) {
            const frame = frames[i];
            const filename = `${baseName}_${String(i).padStart(4, '0')}.img`;
            const data = new Uint8Array(SCREEN_SIZE * 2);
            data.set(frame.bank5, 0);
            data.set(frame.bank7, SCREEN_SIZE);
            files.push({ name: filename, data });
        }

        // Single frame — save as single file
        if (files.length === 1) {
            const blob = new Blob([files[0].data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = files[0].name;
            a.click();
            URL.revokeObjectURL(url);
            frameGrabStatus.textContent = `Exported 1 Gigascreen frame (${SCREEN_SIZE * 2} bytes)`;
            frameGrabStatus.classList.remove('recording');
            showMessage(`Exported ${files[0].name}`);
            return;
        }

        // Multiple frames — ZIP
        const zipData = createZip(files);
        const blob = new Blob([zipData], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}_img.zip`;
        a.click();
        URL.revokeObjectURL(url);

        const duration = (frameCount / 50).toFixed(2);
        frameGrabStatus.textContent = `Exported ${frameCount} Gigascreen frames (${duration}s)`;
        frameGrabStatus.classList.remove('recording');
        showMessage(`Exported ${frameCount} frames to ${baseName}_img.zip`);
    }

    // Detect if bitmap has a consistent 8-byte repeating pattern
    // Returns the pattern if found, null otherwise
    function detectBitmapPattern(bitmap) {
        if (!bitmap || bitmap.length < SCREEN_BITMAP_SIZE) return null;

        // ZX Spectrum screen layout: 3 thirds, each 8 char rows
        // Within each third: interleaved by pixel row
        // For pattern detection, check if each 8x8 cell uses the same 8-byte pattern

        // Extract the pattern from first cell (top-left)
        const pattern = new Uint8Array(8);
        for (let row = 0; row < 8; row++) {
            // Address for pixel row 'row' of char cell (0,0)
            const addr = row * 256; // third 0, char row 0, pixel row 'row'
            pattern[row] = bitmap[addr];
        }

        // Check if this pattern repeats across all 32x24 cells
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

        // Allow some tolerance (95% match)
        const total = matches + mismatches;
        if (matches / total >= 0.95) {
            return pattern;
        }
        return null;
    }

    // Show dialog to let user choose between 53c and 127c patterns
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

    // SCA format: animation file with header + delay table + SCR frames
    // https://github.com/moroz1999/sca
    // Type 0: full SCREEN_SIZE-byte SCR frames
    // Type 1: 8-byte fill pattern + SCREEN_ATTR_SIZE-byte attributes per frame
    async function exportFramesAsSca() {
        const frames = frameGrabState.frames;
        const baseName = getExportBaseName();
        const frameCount = frames.length;

        // Get payload type and fill pattern from UI
        const payloadType = parseInt(document.getElementById('scaPayloadType').value);

        // Warning for Type 1 - feature under development
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
                // Try to detect pattern from first frame's bitmap
                const detected = detectBitmapPattern(frames[0].bitmap);
                if (detected) {
                    fillPattern = detected;
                    showMessage(`Detected pattern: ${Array.from(detected).map(b => hex8(b)).join(' ')}`);
                } else {
                    // Pattern not consistent - ask user
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
                // Vertical 4x8+4x8: 4 columns ink, 4 columns paper
                fillPattern = new Uint8Array([0xF0, 0xF0, 0xF0, 0xF0, 0xF0, 0xF0, 0xF0, 0xF0]);
            } else if (patternSelect === 'h8x4') {
                // Horizontal 8x4+8x4: 4 rows ink, 4 rows paper
                fillPattern = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00]);
            } else {
                // Custom pattern - parse hex string
                const customStr = document.getElementById('scaCustomPattern').value.trim();
                const hexBytes = customStr.split(/[\s,]+/).map(h => parseInt(h, 16) || 0);
                for (let i = 0; i < 8; i++) {
                    fillPattern[i] = hexBytes[i % hexBytes.length] || 0;
                }
            }
        }

        // Get border dimensions for proper extraction
        let borderLeft = 0, borderTop = 0;
        const dimsForBorder = getDimensions();
        if (dimsForBorder) {
            borderLeft = dimsForBorder.borderLeft;
            borderTop = dimsForBorder.borderTop;
        }

        // SCA header: 14 bytes
        // 0-2: "SCA" marker
        // 3: version (1)
        // 4-5: width (256, little-endian)
        // 6-7: height (192, little-endian)
        // 8: border color (0)
        // 9-10: frame count (little-endian)
        // 11: payload type (0 = full SCR, 1 = attrs only)
        // 12-13: payload position (14 = after header)
        const headerSize = 14;
        const delayTableSize = frameCount;
        const fillPatternSize = payloadType === 1 ? 8 : 0;
        const frameDataSize = payloadType === 1 ? frameCount * SCREEN_ATTR_SIZE : frameCount * SCREEN_SIZE;
        const totalSize = headerSize + delayTableSize + fillPatternSize + frameDataSize;

        const scaData = new Uint8Array(totalSize);

        // Write header
        scaData[0] = 0x53; // 'S'
        scaData[1] = 0x43; // 'C'
        scaData[2] = 0x41; // 'A'
        scaData[3] = 1;    // version
        scaData[4] = SCREEN_WIDTH & 0xFF;  // width low
        scaData[5] = (SCREEN_WIDTH >> 8) & 0xFF; // width high
        scaData[6] = SCREEN_HEIGHT & 0xFF;  // height low
        scaData[7] = (SCREEN_HEIGHT >> 8) & 0xFF; // height high
        scaData[8] = 0;    // border color
        scaData[9] = frameCount & 0xFF;  // frame count low
        scaData[10] = (frameCount >> 8) & 0xFF; // frame count high
        scaData[11] = payloadType;  // payload type
        scaData[12] = headerSize & 0xFF;  // payload position low
        scaData[13] = (headerSize >> 8) & 0xFF; // payload position high

        // Write delay table (1 byte per frame, all set to 1 = 1/50s = 50fps)
        for (let i = 0; i < frameCount; i++) {
            scaData[headerSize + i] = 1;
        }

        // Write fill pattern for type 1
        let frameDataOffset = headerSize + delayTableSize;
        if (payloadType === 1) {
            scaData.set(fillPattern, frameDataOffset);
            frameDataOffset += 8;
        }

        // Convert and write each frame
        for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];

            // Convert data URL to image
            const img = new Image();
            img.src = frame.dataUrl;
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

            // Get image data
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = frame.width;
            tempCanvas.height = frame.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(img, 0, 0);
            const imageData = tempCtx.getImageData(0, 0, frame.width, frame.height);
            const pixels = imageData.data;

            // Determine screen position within captured frame
            let scrLeft = 0, scrTop = 0;
            if (frame.width > SCREEN_WIDTH) {
                const dims = getDimensions();
                if (dims && frame.width >= dims.width && frame.height >= dims.height) {
                    scrLeft = borderLeft;
                    scrTop = borderTop;
                } else if (frame.width === 320 && frame.height === 256) {
                    scrLeft = 32;
                    scrTop = 32;
                } else {
                    scrLeft = (frame.width - SCREEN_WIDTH) / 2;
                    scrTop = (frame.height - SCREEN_HEIGHT) / 2;
                }
            }

            if (payloadType === 1) {
                // Type 1: copy attributes directly from frame's memory snapshot
                scaData.set(frame.attrs, frameDataOffset + i * SCREEN_ATTR_SIZE);
            } else {
                // Type 0: full SCR (SCREEN_SIZE bytes)
                const scrData = imageDataToScr(pixels, frame.width, scrLeft, scrTop);
                scaData.set(scrData, frameDataOffset + i * SCREEN_SIZE);
            }

            if (i % 10 === 0) {
                frameGrabStatus.textContent = `Encoding SCA: ${Math.round(i / frames.length * 100)}%`;
                await new Promise(r => setTimeout(r, 0));
            }
        }

        // Download
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
        showMessage(`Exported ${frameCount} frames to ${baseName}.sca (${typeStr})`);
        frameGrabState.frames = [];
    }

    async function exportFramesAsGif() {
        const frames = frameGrabState.frames;
        if (frames.length === 0) return;

        const width = frames[0].width;
        const height = frames[0].height;

        // Simple GIF encoder
        const gif = new GifEncoder(width, height);

        for (let i = 0; i < frames.length; i++) {
            // Convert data URL to image data
            const img = new Image();
            img.src = frames[i].dataUrl;
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(img, 0, 0);
            const imageData = tempCtx.getImageData(0, 0, width, height);

            const delay = frames[i].delay || 2; // per-frame delay or 20ms default (50fps)
            gif.addFrame(imageData.data, delay);

            if (i % 10 === 0) {
                frameGrabStatus.textContent = `Encoding GIF: ${Math.round(i / frames.length * 100)}%`;
                await new Promise(r => setTimeout(r, 0)); // Allow UI update
            }
        }

        const gifData = gif.finish();
        const baseName = getExportBaseName();

        // Download
        const blob = new Blob([gifData], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}.gif`;
        a.click();
        URL.revokeObjectURL(url);

        frameGrabStatus.textContent = `Exported ${frames.length} frames to GIF`;
        frameGrabStatus.classList.remove('recording');
        showMessage(`Exported ${frames.length} frames to ${baseName}.gif`);
        frameGrabState.frames = [];
    }

    // Simple GIF Encoder (256-color, LZW compression)
    class GifEncoder {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.frames = [];
            this.data = [];
        }

        addFrame(rgba, delay) {
            // Quantize to 256 colors and create indexed frame
            const { palette, indexed } = this.quantize(rgba);
            this.frames.push({ palette, indexed, delay });
        }

        quantize(rgba) {
            // Simple color quantization using a fixed palette
            // Use median-cut or popularity algorithm for better results
            const colorCounts = new Map();
            const pixels = [];

            for (let i = 0; i < rgba.length; i += 4) {
                const r = rgba[i] & 0xF8;     // 5 bits
                const g = rgba[i + 1] & 0xFC; // 6 bits
                const b = rgba[i + 2] & 0xF8; // 5 bits
                const key = (r << 16) | (g << 8) | b;
                pixels.push(key);
                colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
            }

            // Get top 256 colors
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

            // Map pixels to palette indices
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
            out.push(0xF7); // Global color table, 256 colors (2^(7+1))
            out.push(0);    // Background color index
            out.push(0);    // Pixel aspect ratio

            // Global Color Table (placeholder — each frame uses local color table)
            for (let i = 0; i < 256 * 3; i++) {
                out.push(0);
            }

            // Netscape Extension for looping
            out.push(0x21, 0xFF, 0x0B);
            out.push(...[0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]); // NETSCAPE2.0
            out.push(0x03, 0x01, 0x00, 0x00, 0x00); // Loop forever

            // Frames
            for (const frame of this.frames) {
                // Graphics Control Extension
                out.push(0x21, 0xF9, 0x04);
                out.push(0x04); // Disposal method: 1 (do not dispose) << 2
                out.push(frame.delay & 0xFF, (frame.delay >> 8) & 0xFF); // Delay
                out.push(0x00); // Transparent color index
                out.push(0x00); // Block terminator

                // Image Descriptor
                out.push(0x2C);
                out.push(0, 0, 0, 0); // Left, Top
                out.push(this.width & 0xFF, (this.width >> 8) & 0xFF);
                out.push(this.height & 0xFF, (this.height >> 8) & 0xFF);
                out.push(0x87); // Local color table, 256 colors (2^(7+1))

                // Local Color Table
                for (let i = 0; i < 256 * 3; i++) {
                    out.push(frame.palette[i] || 0);
                }

                // LZW Compressed Image Data
                const lzw = this.lzwEncode(frame.indexed, 8);
                out.push(8); // LZW minimum code size

                // Output in sub-blocks
                let pos = 0;
                while (pos < lzw.length) {
                    const blockSize = Math.min(255, lzw.length - pos);
                    out.push(blockSize);
                    for (let i = 0; i < blockSize; i++) {
                        out.push(lzw[pos++]);
                    }
                }
                out.push(0x00); // Block terminator
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

            // Use numeric keys: (prefix_code << 8) | byte — avoids string allocation
            const table = new Map();

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

            if (data.length === 0) {
                writeBits(eoiCode, codeSize);
                if (bitCount > 0) output.push(bitBuffer & 0xFF);
                return output;
            }

            let prefix = data[0]; // Initial code = first byte value
            for (let i = 1; i < data.length; i++) {
                const byte = data[i];
                const key = (prefix << 8) | byte;

                const found = table.get(key);
                if (found !== undefined) {
                    prefix = found;
                } else {
                    writeBits(prefix, codeSize);

                    if (nextCode < maxCode) {
                        table.set(key, nextCode++);
                        if (nextCode > (1 << codeSize) && codeSize < 12) {
                            codeSize++;
                        }
                    } else {
                        // Reset table
                        writeBits(clearCode, codeSize);
                        table.clear();
                        codeSize = minCodeSize + 1;
                        nextCode = eoiCode + 1;
                    }

                    prefix = byte;
                }
            }

            writeBits(prefix, codeSize);
            writeBits(eoiCode, codeSize);

            if (bitCount > 0) {
                output.push(bitBuffer & 0xFF);
            }

            return output;
        }
    }

    btnFrameGrabStart.addEventListener('click', startFrameGrab);
    btnFrameGrabStop.addEventListener('click', () => stopFrameGrab(false));
    btnFrameGrabCancel.addEventListener('click', () => stopFrameGrab(true));

    // PSG Recording controls
    const btnPsgStart = document.getElementById('btnPsgStart');
    const btnPsgStop = document.getElementById('btnPsgStop');
    const btnPsgCancel = document.getElementById('btnPsgCancel');
    const chkPsgChangedOnly = document.getElementById('chkPsgChangedOnly');
    const psgStatus = document.getElementById('psgStatus');
    let psgRecording = false;
    let psgFrameCount = 0;
    let psgWriteCount = 0;
    let psgUpdateInterval = null;

    function startPsgRecording() {
        getAy().startLogging();
        psgRecording = true;
        psgFrameCount = 0;
        psgWriteCount = 0;
        btnPsgStart.disabled = true;
        btnPsgStop.disabled = false;
        btnPsgCancel.disabled = false;
        psgStatus.textContent = 'Recording: 0 frames';
        showMessage('PSG recording started');

        // Update status periodically by reading AY properties directly
        psgUpdateInterval = setInterval(() => {
            if (psgRecording && getAy().loggingEnabled) {
                psgFrameCount = getAy().logFrameNumber;
                psgWriteCount = getAy().registerLog.length;
                const duration = (psgFrameCount / 50).toFixed(1);
                psgStatus.textContent = `Recording: ${psgFrameCount} frames, ${psgWriteCount} writes (${duration}s)`;
            }
        }, 200);
    }

    function stopPsgRecording(cancel) {
        getAy().stopLogging();
        psgRecording = false;
        btnPsgStart.disabled = false;
        btnPsgStop.disabled = true;
        btnPsgCancel.disabled = true;

        if (psgUpdateInterval) {
            clearInterval(psgUpdateInterval);
            psgUpdateInterval = null;
        }

        if (cancel) {
            getAy().clearLog();
            psgStatus.textContent = 'Cancelled';
            showMessage('PSG recording cancelled');
            return;
        }

        // Export PSG file
        const changedOnly = chkPsgChangedOnly.checked;
        const psgData = getAy().exportPSG(changedOnly);

        if (!psgData || psgData.length <= 16) {
            psgStatus.textContent = 'No AY data recorded';
            showMessage('No AY data to export');
            getAy().clearLog();
            return;
        }

        const frames = psgFrameCount;
        const duration = (frames / 50).toFixed(1);
        const blob = new Blob([psgData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `music_${frames}f.psg`;
        a.click();
        URL.revokeObjectURL(url);

        psgStatus.textContent = `Exported: ${psgData.length} bytes, ${frames} frames (${duration}s)`;
        showMessage(`Exported PSG: ${psgData.length} bytes`);
        getAy().clearLog();
    }

    btnPsgStart.addEventListener('click', startPsgRecording);
    btnPsgStop.addEventListener('click', () => stopPsgRecording(false));
    btnPsgCancel.addEventListener('click', () => stopPsgRecording(true));

    return { getExportBaseName, GifEncoder, createZip, exportSelectedLoop };
}
