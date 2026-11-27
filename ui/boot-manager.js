// boot-manager.js — Boot file injection for TRD/Hobeta disks (extracted from index.html)
import { storageGet, storageSet } from '../core/utils.js';
import { findBootEntry, trdHasBootFile, extractBootFile, isHobetaFile, hobetaHasBootFile,
         extractBootFromHobeta, injectBootIntoTrd as injectBoot } from '../core/trd-boot.js';

export function initBootManager({ showMessage }) {
    let bootTrdData = null;
    let bootTrdName = null;
    let bootFileType = null;

    // Boot TRD file selection
    const btnSelectBootTrd = document.getElementById('btnSelectBootTrd');
    const bootTrdFileInput = document.getElementById('bootTrdFile');
    btnSelectBootTrd.addEventListener('click', () => {
        bootTrdFileInput.click();
    });

    bootTrdFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const data = new Uint8Array(await file.arrayBuffer());

            // Detect file type: TRD by size, Hobeta by extension/CRC
            let detectedType = null;
            let hasBootFile = false;

            // Check if it's a TRD file (by size)
            if (data.length === 655360 || data.length === 655360 - 256) {
                detectedType = 'trd';
                hasBootFile = trdHasBootFile(data);
            }
            // Check if it's a Hobeta file
            else if (isHobetaFile(data, file.name)) {
                detectedType = 'hobeta';
                hasBootFile = hobetaHasBootFile(data);
            }

            if (!detectedType) {
                showMessage('Invalid file: not a TRD or Hobeta file', 'error');
                return;
            }

            if (!hasBootFile) {
                showMessage(`Selected ${detectedType.toUpperCase()} has no boot file`, 'error');
                return;
            }

            bootTrdData = data;
            bootTrdName = file.name;
            bootFileType = detectedType;

            // Display with type label
            const typeLabel = detectedType === 'hobeta' ? '(Hobeta)' : '(TRD)';
            bootTrdNameEl.textContent = `${file.name} ${typeLabel}`;

            // Save to localStorage
            storageSet('zxm8_bootName', file.name);
            storageSet('zxm8_bootData', arrayBufferToBase64(data));
            storageSet('zxm8_bootType', detectedType);

            showMessage(`Boot file set: ${file.name} ${typeLabel}`);
        } catch (err) {
            showMessage('Failed to load boot file: ' + err.message, 'error');
        }
        // Clear input so same file can be selected again
        e.target.value = '';
    });

    // Boot TRD mode change
    const bootTrdMode = document.getElementById('bootTrdMode');
    const bootTrdNameEl = document.getElementById('bootTrdName');
    bootTrdMode.addEventListener('change', (e) => {
        storageSet('zxm8_bootMode', e.target.value);
        updateBootUIVisibility(e.target.value);
    });

    function updateBootUIVisibility(mode) {
        const isRunMode = mode === 'run_first' || mode === 'run_last';
        btnSelectBootTrd.style.display = isRunMode ? 'none' : '';
        bootTrdNameEl.style.display = isRunMode ? 'none' : '';
    }

    function injectBootIntoTrd(trdData, bootInfo) {
        try { return injectBoot(trdData, bootInfo); }
        catch (e) { alert('Cannot add boot: ' + e.message); return new Uint8Array(trdData); }
    }

    // Helper: Convert ArrayBuffer to base64 for localStorage
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.slice(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    }

    // Helper: Convert base64 to Uint8Array
    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    // Load boot TRD settings from localStorage
    function loadBootTrdSettings() {
        const mode = storageGet('zxm8_bootMode', 'none');
        bootTrdMode.value = mode;

        const name = storageGet('zxm8_bootName');
        const dataBase64 = storageGet('zxm8_bootData');
        const storedType = storageGet('zxm8_bootType');
        if (name && dataBase64) {
            try {
                bootTrdData = base64ToArrayBuffer(dataBase64);
                bootTrdName = name;
                // Default to 'trd' for backwards compatibility
                bootFileType = storedType || 'trd';
                // Display with type label
                const typeLabel = bootFileType === 'hobeta' ? '(Hobeta)' : '(TRD)';
                bootTrdNameEl.textContent = `${name} ${typeLabel}`;
            } catch (e) {
                console.warn('Failed to load boot file from localStorage:', e);
            }
        }
    }

    // Process TRD with boot injection if configured
    function processTrdWithBoot(data, filename) {
        const mode = bootTrdMode.value;
        if (mode === 'none' || mode === 'run_first' || mode === 'run_last' || !bootTrdData) {
            return data;
        }

        // Extract boot from boot source (TRD or Hobeta)
        let bootInfo;
        if (bootFileType === 'hobeta') {
            bootInfo = extractBootFromHobeta(bootTrdData);
        } else {
            bootInfo = extractBootFile(bootTrdData);
        }
        if (!bootInfo) {
            alert('Cannot add boot: no boot file found in selected boot source');
            return data;
        }

        const existingBoot = getBootFileInfo(data);

        if (mode === 'add') {
            if (existingBoot) {
                // Already has boot, don't add
                return data;
            }
            // No boot exists, add new one
            return injectBootIntoTrd(data, bootInfo, null);
        }

        if (mode === 'replace') {
            if (existingBoot) {
                // Replace existing boot - reuse its location if new boot fits
                if (bootInfo.sectorCount <= existingBoot.sectorCount) {
                    // New boot fits in old boot's space - reuse location
                    return replaceBootInPlace(data, bootInfo, existingBoot);
                } else {
                    // New boot is larger - remove old and add at first free
                    data = removeBootFromTrd(data);
                    return injectBootIntoTrd(data, bootInfo, null);
                }
            } else {
                // No boot exists, just add
                return injectBootIntoTrd(data, bootInfo, null);
            }
        }

        return data;
    }

    // Helper: Get info about existing boot file on disk
    function getBootFileInfo(data) {
        const entry = findBootEntry(data);
        if (!entry) return null;
        const { slot, offset, bytes } = entry;
        return {
            dirSlot: slot,
            sectorCount: bytes[offset + 13],
            firstSector: bytes[offset + 14],
            firstTrack: bytes[offset + 15]
        };
    }

    // Helper: Replace boot file in place (reuse old boot's disk location)
    function replaceBootInPlace(trdData, bootInfo, existingBoot) {
        const result = new Uint8Array(trdData);
        const dirOffset = existingBoot.dirSlot * 16;

        // Update directory entry with new boot info (keep same disk location)
        const bootName = 'boot    ';
        for (let i = 0; i < 8; i++) {
            result[dirOffset + i] = bootName.charCodeAt(i);
        }
        result[dirOffset + 8] = bootInfo.fileType;
        result[dirOffset + 9] = bootInfo.startAddr & 0xFF;
        result[dirOffset + 10] = (bootInfo.startAddr >> 8) & 0xFF;
        result[dirOffset + 11] = bootInfo.length & 0xFF;
        result[dirOffset + 12] = (bootInfo.length >> 8) & 0xFF;
        result[dirOffset + 13] = bootInfo.sectorCount;
        // Keep same location as old boot
        result[dirOffset + 14] = existingBoot.firstSector;
        result[dirOffset + 15] = existingBoot.firstTrack;

        // Write new boot data at old boot's location
        const trackOffset = existingBoot.firstTrack * 16 * 256;
        const sectorOffset = existingBoot.firstSector * 256;
        const dataOffset = trackOffset + sectorOffset;
        result.set(bootInfo.fileData.slice(0, bootInfo.sectorCount * 256), dataOffset);

        // If new boot is smaller, we waste some sectors (acceptable)
        // File count stays the same (replacing, not adding)

        return result;
    }

    // Helper: Remove boot file from TRD
    function removeBootFromTrd(data) {
        const result = new Uint8Array(data);
        const entry = findBootEntry(result);
        if (entry) {
            // Mark as deleted
            result[entry.offset] = 0x01;
            // Update file count
            const sector8Offset = 8 * 256;
            const fileCount = result[sector8Offset + 0xE4];
            if (fileCount > 0) {
                result[sector8Offset + 0xE4] = fileCount - 1;
            }
        }
        return result;
    }

    loadBootTrdSettings();
    updateBootUIVisibility(bootTrdMode.value);

    return { processTrdWithBoot, getBootMode: () => bootTrdMode.value };
}
