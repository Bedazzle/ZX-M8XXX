// Shared utility functions — pure, zero dependencies

export function hex8(val) {
    return (val & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

export function hex16(val) {
    return (val & 0xffff).toString(16).toUpperCase().padStart(4, '0');
}

export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    // In the document, and revoked a tick later -- both for Firefox. It ignores
    // a click on an anchor that is not in the DOM, and revoking the object URL
    // in the same tick can cancel the download that click just started. Chrome
    // tolerates both, so this failed on one browser only and silently: no error,
    // no file.
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

// Safe localStorage wrappers — handle quota errors, private browsing, missing storage.
// The embeddable player (player.html) switches them to an in-memory store: an
// embedded emulator takes its settings from the page that hosts it, and must
// neither read the full app's saved settings nor leave its own behind.
let memoryStore = null;
export function setStorageMemory(values) {
    memoryStore = new Map(Object.entries(values || {}).map(([k, v]) => [k, String(v)]));
}

export function storageGet(key, fallback = null) {
    if (memoryStore) return memoryStore.has(key) ? memoryStore.get(key) : fallback;
    try {
        const val = localStorage.getItem(key);
        return val !== null ? val : fallback;
    } catch (e) {
        return fallback;
    }
}

export function storageSet(key, value) {
    if (memoryStore) { memoryStore.set(key, String(value)); return true; }
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        return false;
    }
}

export function storageRemove(key) {
    if (memoryStore) { memoryStore.delete(key); return; }
    try {
        localStorage.removeItem(key);
    } catch (e) {
        // Ignore
    }
}

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

// CRC-32 (IEEE, the ZIP polynomial) — used when writing ZIP archives
export function crc32(data) {
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

    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Is this an HTML/XML document rather than a binary Spectrum file? Used to turn
// "Failed to parse TAP file" into something actionable when a fetch 404s.
export function looksLikeMarkup(data) {
    const b = new Uint8Array(data, 0, Math.min(512, data.byteLength));
    let text = '';
    for (let i = 0; i < b.length; i++) {
        if (b[i] === 0) return null;             // NUL: binary, not a document
        text += String.fromCharCode(b[i]);
    }
    const head = text.replace(/^﻿/, '').trimStart().toLowerCase();
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'an HTML page';
    if (head.startsWith('<?xml')) return 'an XML document';
    if (/^(404|403|500)\b|^error\b/.test(head)) return 'an error message';
    return null;
}
