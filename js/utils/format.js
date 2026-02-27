// Extracted from index.html inline script
// Formatting, encoding, and small pure utility functions

// --- Hex formatting ---

// Format as 2-digit uppercase hex (no prefix), masked to 8-bit
// Lines 15954-15956
export function hex8(val) {
    return (val & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

// Format as 4-digit uppercase hex (no prefix), masked to 16-bit
// Lines 15958-15960
export function hex16(val) {
    return (val & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

// Format as 2-digit uppercase hex (no prefix), no mask
// Line 14694
export function formatHex8(v) {
    return v.toString(16).toUpperCase().padStart(2, '0');
}

// Format as 4-digit uppercase hex (no prefix), no mask
// Line 14695
export function formatHex16(v) {
    return v.toString(16).toUpperCase().padStart(4, '0');
}

// --- HTML escaping ---

// Escape a single char code for safe HTML display (ASCII hex dump style)
// Lines 14744-14751
export function escapeHtmlChar(charCode) {
    if (charCode < 32 || charCode >= 127) return '.';
    if (charCode === 32) return '&nbsp;';  // space - use non-breaking space
    if (charCode === 60) return '&lt;';    // <
    if (charCode === 62) return '&gt;';    // >
    if (charCode === 38) return '&amp;';   // &
    return String.fromCharCode(charCode);
}

// Escape a string for safe HTML embedding
// Lines 16618-16620
export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Base64 encoding/decoding ---

// Convert array/Uint8Array to base64 (handles large arrays via chunking)
// Lines 29938-29950
export function arrayToBase64(data) {
    const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < arr.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, arr.length);
        const chunk = Array.from(arr.subarray(i, end));
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

// Convert ArrayBuffer to base64 (for localStorage)
// Lines 31984-31993
export function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

// Convert base64 string to Uint8Array
// Lines 31996-32003
export function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// --- CRC32 ---

// CRC32 calculation (table-caching variant)
// Lines 33308-33326
export function crc32(data) {
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

// --- File download helpers ---

// Trigger download of text/binary content as a file
// Lines 16622-16630
export function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Trigger download of binary data (Uint8Array) as a file
// Lines 25431-25441
export function downloadBinaryFile(filename, data) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
