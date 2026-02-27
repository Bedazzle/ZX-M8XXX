// ========== Navigation History (per-panel) + Region Parsing Helpers ==========
// Extracted from index.html inline script

// --- Navigation History ---
const NAV_HISTORY_MAX = 50;

// Left panel history
const leftNavHistory = [];
let leftNavHistoryIndex = -1;

// Right panel history
const rightNavHistory = [];
let rightNavHistoryIndex = -1;

// External dependency: goToAddressNoHistory(addr, panel)
// This will be wired by the caller after import.
let _goToAddressNoHistory = null;

/**
 * Set the goToAddressNoHistory callback used by navBack/navForward.
 * Must be called before navBack/navForward are used.
 */
export function setGoToAddressNoHistory(fn) {
    _goToAddressNoHistory = fn;
}

export function navPushHistory(addr, panel = 'left') {
    if (addr === null || addr === undefined) return;
    addr = addr & 0xffff;
    const history = panel === 'right' ? rightNavHistory : leftNavHistory;
    let index = panel === 'right' ? rightNavHistoryIndex : leftNavHistoryIndex;

    // Don't push if same as current
    if (index >= 0 && history[index] === addr) return;
    // Truncate forward history
    history.length = index + 1;
    history.push(addr);
    // Limit size
    if (history.length > NAV_HISTORY_MAX) {
        history.shift();
    }
    if (panel === 'right') {
        rightNavHistoryIndex = history.length - 1;
    } else {
        leftNavHistoryIndex = history.length - 1;
    }
    updateNavButtons();
}

export function navBack(panel = 'left') {
    const history = panel === 'right' ? rightNavHistory : leftNavHistory;
    let index = panel === 'right' ? rightNavHistoryIndex : leftNavHistoryIndex;

    if (index > 0) {
        index--;
        if (panel === 'right') {
            rightNavHistoryIndex = index;
        } else {
            leftNavHistoryIndex = index;
        }
        const addr = history[index];
        if (_goToAddressNoHistory) _goToAddressNoHistory(addr, panel);
        updateNavButtons();
    }
}

export function navForward(panel = 'left') {
    const history = panel === 'right' ? rightNavHistory : leftNavHistory;
    let index = panel === 'right' ? rightNavHistoryIndex : leftNavHistoryIndex;

    if (index < history.length - 1) {
        index++;
        if (panel === 'right') {
            rightNavHistoryIndex = index;
        } else {
            leftNavHistoryIndex = index;
        }
        const addr = history[index];
        if (_goToAddressNoHistory) _goToAddressNoHistory(addr, panel);
        updateNavButtons();
    }
}

export function updateNavButtons() {
    // Left panel buttons
    const btnLeftBack = document.getElementById('btnDisasmPgUp');
    const btnLeftFwd = document.getElementById('btnDisasmPgDn');
    if (btnLeftBack) btnLeftBack.disabled = leftNavHistoryIndex <= 0;
    if (btnLeftFwd) btnLeftFwd.disabled = leftNavHistoryIndex >= leftNavHistory.length - 1;

    // Right panel buttons
    const btnRightBack = document.getElementById('btnRightDisasmPgUp');
    const btnRightFwd = document.getElementById('btnRightDisasmPgDn');
    if (btnRightBack) btnRightBack.disabled = rightNavHistoryIndex <= 0;
    if (btnRightFwd) btnRightFwd.disabled = rightNavHistoryIndex >= rightNavHistory.length - 1;
}

// --- Region Parsing Helpers ---
// Shared constants for region display
export const REGION_MAX_TEXT = 50;   // sjasmplus compatible
export const REGION_MAX_BYTES = 8;   // bytes per DB line
export const REGION_MAX_WORDS = 4;   // words per DW line

/**
 * Parse text region, returns {text, bytes, bit7Terminated, nextAddr, singleByte}
 * @param {object} memory - Memory object with .read(addr) method
 * @param {number} startAddr
 * @param {number} endAddr
 * @param {number} maxChars
 */
export function parseTextRegion(memory, startAddr, endAddr, maxChars = REGION_MAX_TEXT) {
    let text = '';
    let bytes = [];
    let bit7Terminated = false;
    let addr = startAddr;

    while (addr <= endAddr && text.length < maxChars && addr <= 0xffff) {
        const byte = memory.read(addr);
        bytes.push(byte);

        const hasBit7 = (byte & 0x80) !== 0;
        const charByte = hasBit7 ? (byte & 0x7F) : byte;

        if (charByte >= 32 && charByte < 127 && charByte !== 34) {
            text += String.fromCharCode(charByte);
            if (hasBit7) {
                bit7Terminated = true;
                addr++;
                break;
            }
        } else if (charByte === 34) {
            text += '""'; // Escape quote
            if (hasBit7) {
                bit7Terminated = true;
                addr++;
                break;
            }
        } else if (byte === 0) {
            text += '\\0';
        } else if (byte === 10) {
            text += '\\n';
        } else if (byte === 13) {
            text += '\\r';
        } else {
            // Non-printable - stop here
            if (text.length === 0) {
                // Return single byte as non-text
                return { text: '', bytes: [byte], bit7Terminated: false, nextAddr: addr + 1, singleByte: true };
            }
            bytes.pop(); // Don't include this byte
            break;
        }
        addr++;
    }

    return { text, bytes, bit7Terminated, nextAddr: addr, singleByte: false };
}

/**
 * Parse byte region (DB), returns {byteStrs, bytes, nextAddr}
 * @param {object} memory - Memory object with .read(addr) method
 * @param {number} startAddr
 * @param {number} endAddr
 * @param {number} maxBytes
 */
export function parseByteRegion(memory, startAddr, endAddr, maxBytes = REGION_MAX_BYTES) {
    let byteStrs = [];
    let bytes = [];
    let addr = startAddr;

    while (addr <= endAddr && byteStrs.length < maxBytes && addr <= 0xffff) {
        const byte = memory.read(addr);
        byteStrs.push(`$${hex8(byte)}`);
        bytes.push(byte);
        addr++;
    }

    return { byteStrs, bytes, nextAddr: addr };
}

/**
 * Parse word region (DW), returns {wordStrs, bytes, nextAddr}
 * @param {object} memory - Memory object with .read(addr) method
 * @param {number} startAddr
 * @param {number} endAddr
 * @param {number} maxWords
 */
export function parseWordRegion(memory, startAddr, endAddr, maxWords = REGION_MAX_WORDS) {
    let wordStrs = [];
    let bytes = [];
    let addr = startAddr;

    while (addr <= endAddr && wordStrs.length < maxWords && addr < 0xffff) {
        const lo = memory.read(addr);
        const hi = memory.read((addr + 1) & 0xffff);
        const word = lo | (hi << 8);
        wordStrs.push(`$${hex16(word)}`);
        bytes.push(lo, hi);
        addr += 2;
        if (addr > endAddr + 1) break;
    }

    return { wordStrs, bytes, nextAddr: addr };
}

// --- Local helpers (these mirror functions defined elsewhere in the monolith) ---
function hex8(val) {
    return (val & 0xFF).toString(16).toUpperCase().padStart(2, '0');
}

function hex16(val) {
    return (val & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}
