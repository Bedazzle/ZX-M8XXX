// trd-boot.js — a TR-DOS "boot" file: find it on a TRD, take it from a TRD or
// a Hobeta file, and add it to a disk that has none. Used by the app's boot
// manager (ui/boot-manager.js) and the player (ui/player.js).
// injectBootIntoTrd throws when the disk has no room for it.

// Read 8-byte space-padded filename from TRD directory entry
function readTrdFilename(bytes, offset) {
    let name = '';
    for (let j = 0; j < 8; j++) {
        name += String.fromCharCode(bytes[offset + j]);
    }
    return name.trimEnd().toLowerCase();
}

// Ensure data is Uint8Array
function ensureBytes(data) {
    return data instanceof Uint8Array ? data : new Uint8Array(data);
}

// Find boot file directory entry in TRD data.
// Returns { slot, offset, bytes } or null if not found.
export function findBootEntry(data) {
    const bytes = ensureBytes(data);
    for (let i = 0; i < 128; i++) {
        const offset = i * 16;
        const firstByte = bytes[offset];
        if (firstByte === 0x00) break;
        if (firstByte === 0x01) continue;
        if (readTrdFilename(bytes, offset) === 'boot') {
            return { slot: i, offset, bytes };
        }
    }
    return null;
}

// Find first free directory slot (0x00 = end, 0x01 = deleted).
// Returns { slot, offset, wasEndMarker } or null if full.
function findFreeSlot(bytes) {
    for (let i = 0; i < 128; i++) {
        const offset = i * 16;
        const firstByte = bytes[offset];
        if (firstByte === 0x00) return { slot: i, offset, wasEndMarker: true };
        if (firstByte === 0x01) return { slot: i, offset, wasEndMarker: false };
    }
    return null;
}

// Helper: Check if TRD has a boot file (filename "boot" in directory)
export function trdHasBootFile(data) {
    return findBootEntry(data) !== null;
}

// Helper: Extract boot file from TRD
export function extractBootFile(data) {
    const entry = findBootEntry(data);
    if (!entry) return null;

    const { offset, bytes } = entry;
    const fileType = bytes[offset + 8];
    const startAddr = bytes[offset + 9] | (bytes[offset + 10] << 8);
    const length = bytes[offset + 11] | (bytes[offset + 12] << 8);
    const sectorCount = bytes[offset + 13];
    const firstSector = bytes[offset + 14];
    const firstTrack = bytes[offset + 15];

    // Copy directory entry
    const dirEntry = bytes.slice(offset, offset + 16);

    // Calculate data offset and extract file data
    const trackOffset = firstTrack * 16 * 256; // 16 sectors per track, 256 bytes per sector
    const sectorOffset = firstSector * 256;
    const dataOffset = trackOffset + sectorOffset;
    const dataEnd = dataOffset + sectorCount * 256;
    if (dataEnd > bytes.length) return null; // Corrupt: data extends beyond disk
    const fileData = bytes.slice(dataOffset, dataEnd);

    return { dirEntry, fileData, sectorCount, length, startAddr, fileType };
}

// Helper: Detect if file is Hobeta format
export function isHobetaFile(data, filename) {
    // Check by extension first
    const lowerName = filename.toLowerCase();
    const hobetaExtensions = ['.$c', '.$b', '.$d', '.$#', '.hobeta'];
    const hasHobetaExt = hobetaExtensions.some(ext => lowerName.endsWith(ext));

    if (!hasHobetaExt) return false;

    // Validate Hobeta header (17 bytes minimum + at least 1 byte of data)
    if (data.length <= 17) return false;

    // If extension matches and file has header + data, accept it
    // Calculate actual sector count from file size (more reliable than header byte)
    const dataSize = data.length - 17;
    const actualSectors = Math.ceil(dataSize / 256);
    if (actualSectors === 0 || actualSectors > 255) return false;

    return true;
}

// Helper: Check if Hobeta file can be used as boot file.
// A Hobeta file IS the boot file — the user selected it for injection.
// The internal filename doesn't need to be "boot"; injectBootIntoTrd()
// writes the name as "boot" regardless.
export function hobetaHasBootFile(data) {
    return data.length > 17;
}

// Helper: Extract boot file from Hobeta
export function extractBootFromHobeta(data) {
    if (data.length <= 17) return null;

    // Parse Hobeta header (17 bytes)
    // Bytes 0-7: Filename
    // Byte 8: Type (B/C/D/#)
    // Bytes 9-10: Start address
    // Bytes 11-12: Length
    // Byte 13: Sector count (may be 0 in some files, so calculate from size)
    // Bytes 14-16: CRC
    // Bytes 17+: File data

    const fileType = data[8];
    const startAddr = data[9] | (data[10] << 8);
    const length = data[11] | (data[12] << 8);
    // Calculate sector count from actual data size (more reliable)
    const dataSize = data.length - 17;
    const sectorCount = Math.ceil(dataSize / 256);

    // Create directory entry (16 bytes) in TRD format
    const dirEntry = new Uint8Array(16);
    // Copy filename (8 bytes)
    for (let i = 0; i < 8; i++) {
        dirEntry[i] = data[i];
    }
    dirEntry[8] = fileType;
    dirEntry[9] = startAddr & 0xFF;
    dirEntry[10] = (startAddr >> 8) & 0xFF;
    dirEntry[11] = length & 0xFF;
    dirEntry[12] = (length >> 8) & 0xFF;
    dirEntry[13] = sectorCount;
    // Bytes 14-15 (first sector/track) will be set by injection
    dirEntry[14] = 0;
    dirEntry[15] = 0;

    // Extract file data (after 17-byte header, pad to full sectors)
    const fileData = new Uint8Array(sectorCount * 256);
    fileData.set(data.slice(17));

    return { dirEntry, fileData, sectorCount, length, startAddr, fileType };
}

// Helper: Inject boot file into TRD data
export function injectBootIntoTrd(trdData, bootInfo, reuseLocation) {
    const result = new Uint8Array(trdData);

    // Find first free directory slot
    const freeSlot = findFreeSlot(result);
    if (!freeSlot) {
        throw new Error('the disk directory is full (128 files max)');
    }
    const { slot: dirSlot, wasEndMarker } = freeSlot;

    // Get disk info from sector 8 (offset 0x800)
    const sector8Offset = 8 * 256;
    let firstFreeSector = result[sector8Offset + 0xE1];
    let firstFreeTrack = result[sector8Offset + 0xE2];
    const fileCount = result[sector8Offset + 0xE4];
    let freeSectors = result[sector8Offset + 0xE5] | (result[sector8Offset + 0xE6] << 8);

    // Check if there's enough space
    if (freeSectors < bootInfo.sectorCount) {
        throw new Error('not enough free space on the disk');
    }

    // Write directory entry at the slot
    const dirOffset = dirSlot * 16;
    // Copy filename "boot    " (8 chars padded)
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
    result[dirOffset + 14] = firstFreeSector;
    result[dirOffset + 15] = firstFreeTrack;

    // Write file data at the free location
    const trackOffset = firstFreeTrack * 16 * 256;
    const sectorOffset = firstFreeSector * 256;
    const dataOffset = trackOffset + sectorOffset;
    const dataSize = bootInfo.sectorCount * 256;
    if (dataOffset + dataSize > result.length) {
        throw new Error('calculated position exceeds disk size');
    }
    result.set(bootInfo.fileData.slice(0, dataSize), dataOffset);

    // Update disk info
    // Calculate new free position
    let newSector = firstFreeSector + bootInfo.sectorCount;
    let newTrack = firstFreeTrack;
    while (newSector >= 16) {
        newSector -= 16;
        newTrack++;
    }
    result[sector8Offset + 0xE1] = newSector;
    result[sector8Offset + 0xE2] = newTrack;
    result[sector8Offset + 0xE4] = fileCount + 1;
    freeSectors -= bootInfo.sectorCount;
    result[sector8Offset + 0xE5] = freeSectors & 0xFF;
    result[sector8Offset + 0xE6] = (freeSectors >> 8) & 0xFF;

    // Mark end of directory if we inserted at the end marker
    if (wasEndMarker && dirSlot + 1 < 128) {
        // We inserted at the previous end-of-directory position
        // ALWAYS mark the next slot as end-of-directory
        const nextOffset = (dirSlot + 1) * 16;
        result[nextOffset] = 0x00;
    }

    return result;
}
