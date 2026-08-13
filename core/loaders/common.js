/**
 * ZX-M8XXX - Shared helpers: checksums and fixed-width field writing
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

export function xorChecksum(data, seed = 0, length = data.length) {
    let checksum = seed;
    for (let i = 0; i < length; i++) checksum ^= data[i];
    return checksum;
}

// Write `str` into `bytes` at `offset` as a fixed `length`-byte field: the
// string's char codes (truncated to `length`), the remainder filled with `pad`
// (default 0x20 space; pass 0x00 for null-padded fields). Used by the disk
// catalog writers for file names and disk labels.
export function writeField(bytes, offset, str, length, pad = 0x20) {
    str = str || '';
    for (let i = 0; i < length; i++) {
        bytes[offset + i] = i < str.length ? str.charCodeAt(i) : pad;
    }
}

// SCL trailing checksum: 32-bit sum of all bytes before the checksum itself
export function sclChecksum(data, length = data.length) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum = (sum + data[i]) >>> 0;
    return sum;
}
