// ZX0 / ZX7 (de)compressors. ZX0/ZX7 formats and reference algorithms by Einar Saukas.
//
// ES module port for ZX-M8XXX: the decompressors take an optional `maxOutput` cap so
// untrusted blocks can be speculatively depacked without runaway memory/time (a
// malformed stream is rejected, not allowed to balloon). Used by the Explorer's
// packed-screen detector (detectPackedScreen).

const ZX0_MAX_OFFSET = 32640;
const ZX0_INITIAL_OFFSET = 1;

function reverse(arr, start, end) {
    while (start < end) {
        const tmp = arr[start];
        arr[start] = arr[end];
        arr[end] = tmp;
        start++;
        end--;
    }
}

/* ───────────────────────────── ZX0 ───────────────────────────── */

function zx0EliasGammaBits(value) {
    let bits = 1;
    while (value >>= 1) bits += 2;
    return bits;
}

function zx0OffsetCeiling(index, offset_limit) {
    return index > offset_limit ? offset_limit : index < ZX0_INITIAL_OFFSET ? ZX0_INITIAL_OFFSET : index;
}

function zx0Optimize(input_data, input_size, skip, offset_limit) {
    const max_offset_start = zx0OffsetCeiling(input_size - 1, offset_limit);
    const last_literal = new Array(max_offset_start + 1).fill(null);
    const last_match = new Array(max_offset_start + 1).fill(null);
    const optimal = new Array(input_size).fill(null);
    const match_length = new Int32Array(max_offset_start + 1);
    const best_length = new Int32Array(input_size);

    if (input_size > 2) best_length[2] = 2;

    const allocate = (bits, index, offset, chain) => ({ bits, index, offset, chain });
    last_match[ZX0_INITIAL_OFFSET] = allocate(-1, skip - 1, ZX0_INITIAL_OFFSET, null);

    for (let index = skip; index < input_size; index++) {
        let best_length_size = 2;
        const max_offset = zx0OffsetCeiling(index, offset_limit);
        for (let offset = 1; offset <= max_offset; offset++) {
            if (index !== skip && index >= offset && input_data[index] === input_data[index - offset]) {
                if (last_literal[offset]) {
                    const length = index - last_literal[offset].index;
                    const bits = last_literal[offset].bits + 1 + zx0EliasGammaBits(length);
                    last_match[offset] = allocate(bits, index, offset, last_literal[offset]);
                    if (!optimal[index] || optimal[index].bits > bits) optimal[index] = last_match[offset];
                }
                match_length[offset]++;
                if (match_length[offset] > 1) {
                    if (best_length_size < match_length[offset]) {
                        let bits = optimal[index - best_length[best_length_size]].bits + zx0EliasGammaBits(best_length[best_length_size] - 1);
                        do {
                            best_length_size++;
                            const bits2 = optimal[index - best_length_size].bits + zx0EliasGammaBits(best_length_size - 1);
                            if (bits2 <= bits) { best_length[best_length_size] = best_length_size; bits = bits2; }
                            else best_length[best_length_size] = best_length[best_length_size - 1];
                        } while (best_length_size < match_length[offset]);
                    }
                    const length = best_length[match_length[offset]];
                    const bits = optimal[index - length].bits + 8 + zx0EliasGammaBits(((offset - 1) / 128 | 0) + 1) + zx0EliasGammaBits(length - 1);
                    if (!last_match[offset] || last_match[offset].index !== index || last_match[offset].bits > bits) {
                        last_match[offset] = allocate(bits, index, offset, optimal[index - length]);
                        if (!optimal[index] || optimal[index].bits > bits) optimal[index] = last_match[offset];
                    }
                }
            } else {
                match_length[offset] = 0;
                if (last_match[offset]) {
                    const length = index - last_match[offset].index;
                    const bits = last_match[offset].bits + 1 + zx0EliasGammaBits(length) + length * 8;
                    last_literal[offset] = allocate(bits, index, 0, last_match[offset]);
                    if (!optimal[index] || optimal[index].bits > bits) optimal[index] = last_literal[offset];
                }
            }
        }
    }
    return optimal[input_size - 1];
}

function zx0CompressCore(input_data, skip, backwards_mode, classic_mode, quick_mode) {
    const input_size = input_data.length;
    const offset_limit = quick_mode ? 2176 : ZX0_MAX_OFFSET;
    const invert_mode = !classic_mode && !backwards_mode;
    const optimal_block = zx0Optimize(input_data, input_size, skip, offset_limit);

    const output_size = ((optimal_block.bits + 25) / 8) | 0;
    const output_data = new Uint8Array(output_size);

    let prev = null, cur = optimal_block;
    while (cur) { const next = cur.chain; cur.chain = prev; prev = cur; cur = next; }

    let diff = output_size - input_size + skip;
    let delta = 0, input_index = skip, output_index = 0;
    let bit_mask = 0, bit_index = 0, backtrack = true;
    let last_offset = ZX0_INITIAL_OFFSET;

    const read_bytes = (n) => { input_index += n; diff += n; if (delta < diff) delta = diff; };
    const write_byte = (value) => { output_data[output_index++] = value; diff--; };
    function write_bit(value) {
        if (backtrack) { if (value) output_data[output_index - 1] |= 1; backtrack = false; }
        else {
            if (!bit_mask) { bit_mask = 128; bit_index = output_index; write_byte(0); }
            if (value) output_data[bit_index] |= bit_mask;
            bit_mask >>= 1;
        }
    }
    function write_interlaced_elias_gamma(value, invert) {
        let i;
        for (i = 2; i <= value; i <<= 1);
        i >>= 1;
        while (i >>= 1) {
            write_bit(backwards_mode ? 1 : 0);
            write_bit(invert ? (!(value & i) ? 1 : 0) : ((value & i) ? 1 : 0));
        }
        write_bit(backwards_mode ? 0 : 1);
    }

    let node = prev;
    for (let opt = node.chain; opt; node = opt, opt = opt.chain) {
        const length = opt.index - node.index;
        if (!opt.offset) {
            write_bit(0); write_interlaced_elias_gamma(length, false);
            for (let i = 0; i < length; i++) { write_byte(input_data[input_index]); read_bytes(1); }
        } else if (opt.offset === last_offset) {
            write_bit(0); write_interlaced_elias_gamma(length, false); read_bytes(length);
        } else {
            write_bit(1);
            write_interlaced_elias_gamma(((opt.offset - 1) / 128 | 0) + 1, invert_mode);
            if (backwards_mode) write_byte(((opt.offset - 1) % 128) << 1);
            else write_byte((127 - (opt.offset - 1) % 128) << 1);
            backtrack = true;
            write_interlaced_elias_gamma(length - 1, false);
            read_bytes(length);
            last_offset = opt.offset;
        }
    }
    write_bit(1);
    write_interlaced_elias_gamma(256, invert_mode);
    return output_data;
}

function zx0DecompressCore(input_data, backwards_mode, classic_mode, maxOutput) {
    const input_size = input_data.length;
    const output = [];
    let input_index = 0, bit_mask = 0, bit_value = 0;
    let backtrack = false, last_byte = 0, last_offset = ZX0_INITIAL_OFFSET;

    function read_byte() {
        if (input_index >= input_size) throw new Error('Truncated input');
        last_byte = input_data[input_index++];
        return last_byte;
    }
    function read_bit() {
        if (backtrack) { backtrack = false; return last_byte & 1; }
        bit_mask >>= 1;
        if (bit_mask === 0) { bit_mask = 128; bit_value = read_byte(); }
        return (bit_value & bit_mask) ? 1 : 0;
    }
    function read_interlaced_elias_gamma(inverted) {
        let value = 1;
        if (backwards_mode) { while (read_bit()) value = value << 1 | (read_bit() ^ inverted); }
        else { while (!read_bit()) value = value << 1 | (read_bit() ^ inverted); }
        return value;
    }
    function write_bytes(offset, length) {
        // A valid back-reference never points before the start of the output; rejecting
        // that makes speculative offset-scanning bail fast on wrong start offsets.
        if (offset <= 0 || offset > output.length || output.length + length > maxOutput) throw new Error('bad copy');
        for (let i = 0; i < length; i++) output.push(output[output.length - offset]);
    }

    const invert_offset = (!classic_mode && !backwards_mode) ? 1 : 0;
    let length, state = 0;
    while (true) {
        if (output.length > maxOutput) throw new Error('Output exceeds cap');
        if (state === 0) {
            length = read_interlaced_elias_gamma(0);
            if (output.length + length > maxOutput) throw new Error('Output exceeds cap');
            for (let i = 0; i < length; i++) output.push(read_byte());
            state = read_bit() ? 2 : 1;
        } else if (state === 1) {
            length = read_interlaced_elias_gamma(0);
            write_bytes(last_offset, length);
            state = read_bit() ? 2 : 0;
        } else {
            const msb = read_interlaced_elias_gamma(invert_offset);
            if (msb === 256) break;
            if (backwards_mode) last_offset = (msb - 1) * 128 + (read_byte() >> 1) + 1;
            else last_offset = msb * 128 - (read_byte() >> 1);
            backtrack = true;
            length = read_interlaced_elias_gamma(0) + 1;
            write_bytes(last_offset, length);
            state = read_bit() ? 2 : 0;
        }
    }
    return new Uint8Array(output);
}

export function zx0Compress(data, { skip = 0, backwards = false, classic = false, quick = false } = {}) {
    const input = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (backwards) {
        const rev = new Uint8Array(input); reverse(rev, 0, rev.length - 1);
        const out = zx0CompressCore(rev, skip, true, classic, quick);
        reverse(out, 0, out.length - 1);
        return out;
    }
    return zx0CompressCore(input, skip, false, classic, quick);
}

export function zx0Decompress(data, { backwards = false, classic = false, maxOutput = 65536 } = {}) {
    const input = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (backwards) {
        const rev = new Uint8Array(input); reverse(rev, 0, rev.length - 1);
        const out = zx0DecompressCore(rev, true, classic, maxOutput);
        reverse(out, 0, out.length - 1);
        return out;
    }
    return zx0DecompressCore(input, false, classic, maxOutput);
}

/* ───────────────────────────── ZX7 ───────────────────────────── */

const ZX7_MAX_OFFSET = 2176;
const ZX7_MAX_LEN = 65536;

function zx7EliasGammaBits(value) {
    let bits = 1;
    while (value > 1) { bits += 2; value >>= 1; }
    return bits;
}

function zx7CountBits(offset, len) {
    return 1 + (offset > 128 ? 12 : 8) + zx7EliasGammaBits(len - 1);
}

function zx7Optimize(inputData, skip = 0) {
    const inputSize = inputData.length;
    const min = new Array(ZX7_MAX_OFFSET + 1).fill(0);
    const max = new Array(ZX7_MAX_OFFSET + 1).fill(0);
    const matches = new Array(256 * 256).fill(0);
    const matchSlots = new Array(inputSize).fill(0);
    const optimal = [];
    for (let i = 0; i < inputSize; i++) optimal.push({ bits: 0, offset: 0, len: 0 });

    for (let i = 1; i <= skip; i++) {
        const matchIndex = (inputData[i - 1] << 8) | inputData[i];
        matchSlots[i] = matches[matchIndex];
        matches[matchIndex] = i;
    }
    optimal[skip].bits = 8;

    for (let i = skip + 1; i < inputSize; i++) {
        optimal[i].bits = optimal[i - 1].bits + 9;
        const matchIndex = (inputData[i - 1] << 8) | inputData[i];
        let bestLen = 1;
        let matchIdx = matches[matchIndex];
        while (matchIdx !== 0 && bestLen < ZX7_MAX_LEN) {
            const offset = i - matchIdx;
            if (offset > ZX7_MAX_OFFSET) { matchIdx = 0; break; }
            let testedLen = 2, actualLen = 1;
            while (testedLen <= ZX7_MAX_LEN && i >= skip + testedLen) {
                if (testedLen > bestLen) {
                    bestLen = testedLen;
                    const bits = optimal[i - testedLen].bits + zx7CountBits(offset, testedLen);
                    if (optimal[i].bits > bits) { optimal[i].bits = bits; optimal[i].offset = offset; optimal[i].len = testedLen; }
                } else if (max[offset] !== 0 && i + 1 === max[offset] + testedLen) {
                    testedLen = i - min[offset];
                    if (testedLen > bestLen) testedLen = bestLen;
                }
                actualLen = testedLen;
                if (i < offset + testedLen || inputData[i - testedLen] !== inputData[i - testedLen - offset]) break;
                testedLen++;
            }
            min[offset] = i + 1 - actualLen;
            max[offset] = i;
            matchIdx = matchSlots[matchIdx];
        }
        matchSlots[i] = matches[matchIndex];
        matches[matchIndex] = i;
    }
    return optimal;
}

function zx7CompressCore(inputData, skip = 0) {
    const inputSize = inputData.length;
    const optimal = zx7Optimize(inputData, skip);
    let inputIndex = inputSize - 1;
    const outputSize = Math.floor((optimal[inputIndex].bits + 18 + 7) / 8);
    const outputData = new Uint8Array(outputSize);

    let diff = outputSize - inputSize + skip, delta = 0;
    const readBytes = (n) => { diff += n; if (diff > delta) delta = diff; };
    let outputIndex = 0, bitMask = 0, bitIndex = 0;
    const writeByte = (value) => { outputData[outputIndex++] = value; diff--; };
    function writeBit(value) {
        if (bitMask === 0) { bitMask = 128; bitIndex = outputIndex; writeByte(0); }
        if (value > 0) outputData[bitIndex] |= bitMask;
        bitMask >>= 1;
    }
    function writeEliasGamma(value) {
        let i;
        for (i = 2; i <= value; i <<= 1) writeBit(0);
        while ((i >>= 1) > 0) writeBit(value & i);
    }

    optimal[inputIndex].bits = 0;
    while (inputIndex !== skip) {
        const inputPrev = inputIndex - (optimal[inputIndex].len > 0 ? optimal[inputIndex].len : 1);
        optimal[inputPrev].bits = inputIndex;
        inputIndex = inputPrev;
    }

    outputIndex = 0; bitMask = 0;
    writeByte(inputData[inputIndex]); readBytes(1);
    while ((inputIndex = optimal[inputIndex].bits) > 0) {
        if (optimal[inputIndex].len === 0) {
            writeBit(0); writeByte(inputData[inputIndex]); readBytes(1);
        } else {
            writeBit(1); writeEliasGamma(optimal[inputIndex].len - 1);
            let offset1 = optimal[inputIndex].offset - 1;
            if (offset1 < 128) writeByte(offset1);
            else {
                offset1 -= 128;
                writeByte((offset1 & 127) | 128);
                for (let mask = 1024; mask > 127; mask >>= 1) writeBit(offset1 & mask);
            }
            readBytes(optimal[inputIndex].len);
        }
    }
    writeBit(1);
    for (let i = 0; i < 16; i++) writeBit(0);
    writeBit(1);
    return outputData;
}

function zx7DecompressCore(inputData, maxOutput) {
    const inputSize = inputData.length;
    const outputData = [];
    let inputIndex = 0, bitMask = 0, bitValue = 0;

    function readByte() {
        if (inputIndex >= inputSize) throw new Error('Truncated input');
        return inputData[inputIndex++];
    }
    function readBit() {
        bitMask >>= 1;
        if (bitMask === 0) { bitMask = 128; bitValue = readByte(); }
        return (bitValue & bitMask) ? 1 : 0;
    }
    function readEliasGamma() {
        let i = 0;
        while (!readBit()) i++;
        if (i > 15) return -1;
        let value = 1;
        while (i--) value = (value << 1) | readBit();
        return value;
    }
    function readOffset() {
        const value = readByte();
        if (value < 128) return value;
        let i = readBit();
        i = (i << 1) | readBit();
        i = (i << 1) | readBit();
        i = (i << 1) | readBit();
        return (value & 127) | ((i << 7) + 128);
    }

    outputData.push(readByte());
    while (true) {
        if (outputData.length > maxOutput) throw new Error('Output exceeds cap');
        if (!readBit()) {
            outputData.push(readByte());
        } else {
            const length = readEliasGamma() + 1;
            if (length === 0) break;
            const offset = readOffset() + 1;
            // Reject impossible back-references (see ZX0 note) — fast bail when scanning.
            if (offset > outputData.length || outputData.length + length > maxOutput) throw new Error('bad copy');
            for (let i = 0; i < length; i++) outputData.push(outputData[outputData.length - offset]);
        }
    }
    return new Uint8Array(outputData);
}

export function zx7Compress(data, { skip = 0, backwards = false } = {}) {
    const input = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (backwards) {
        const rev = new Uint8Array(input); reverse(rev, 0, rev.length - 1);
        const out = zx7CompressCore(rev, skip);
        reverse(out, 0, out.length - 1);
        return out;
    }
    return zx7CompressCore(input, skip);
}

export function zx7Decompress(data, { backwards = false, maxOutput = 65536 } = {}) {
    const input = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (backwards) {
        const rev = new Uint8Array(input); reverse(rev, 0, rev.length - 1);
        const out = zx7DecompressCore(rev, maxOutput);
        reverse(out, 0, out.length - 1);
        return out;
    }
    return zx7DecompressCore(input, maxOutput);
}

/* ──────────────────────── packed-screen detector ──────────────────────── */

const SCREEN_LEN = 6912;
const ATTR_START = 6144;          // bitmap (6144) + attributes (768)

// Shannon entropy (bits/byte, 0..8) over the 768-byte attribute area. A real screen's
// attributes come from a small, repeated palette → low entropy; mis-depacked garbage is
// near-random → high entropy.
export function attributeEntropy(scr) {
    if (!scr || scr.length < SCREEN_LEN) return 8;
    const counts = new Uint32Array(256);
    for (let i = ATTR_START; i < SCREEN_LEN; i++) counts[scr[i]]++;
    const n = SCREEN_LEN - ATTR_START;
    let e = 0;
    for (let c = 0; c < 256; c++) {
        if (counts[c]) { const p = counts[c] / n; e -= p * Math.log2(p); }
    }
    return e;
}

// Speculatively depack `bytes` as a standard 6912-byte SCR. Tries ZX0/ZX7 in forward
// and backward modes (exit on the first that validates), requiring an exact 6912-byte
// output with low attribute entropy. Returns { format, direction, entropy, data } or null.
// The size gate (caller-tunable) skips tiny stubs and already-uncompressed screens.
export function detectPackedScreen(bytes, { minLen = 257, maxLen = 6911, entropyMax = 7.0 } = {}) {
    if (!bytes || bytes.length < minLen || bytes.length > maxLen) return null;
    const cap = SCREEN_LEN + 1280;   // allow a 6912 result, reject anything ballooning past it
    const attempts = [
        { format: 'ZX0', direction: 'forward',  fn: () => zx0Decompress(bytes, { maxOutput: cap }) },
        { format: 'ZX7', direction: 'forward',  fn: () => zx7Decompress(bytes, { maxOutput: cap }) },
        { format: 'ZX0', direction: 'backward', fn: () => zx0Decompress(bytes, { backwards: true, maxOutput: cap }) },
        { format: 'ZX7', direction: 'backward', fn: () => zx7Decompress(bytes, { backwards: true, maxOutput: cap }) },
    ];
    for (const a of attempts) {
        let out;
        try { out = a.fn(); } catch (e) { continue; }
        if (!out || out.length !== SCREEN_LEN) continue;
        const entropy = attributeEntropy(out);
        if (entropy > entropyMax) continue;
        return { format: a.format, direction: a.direction, entropy, data: out };
    }
    return null;
}

// RCS (Reverse Computer Screen, Einar Saukas): bytes are reordered before packing to
// compress better. Only the bitmap is permuted (attributes stay in place), so this is
// the inverse — turn an RCS-ordered full screen back into a standard 6912 SCR. Encode
// enumerates sector→col→row→lin pulling std[sector*2048 + lin*256 + row*32 + col];
// decode reverses that. (Full screen only — 3 sectors + attributes.)
export function rcsToScr(rcs) {
    if (!rcs || rcs.length < SCREEN_LEN) return rcs;
    const out = new Uint8Array(SCREEN_LEN);
    let i = 0;
    for (let sector = 0; sector < 3; sector++)
        for (let col = 0; col < 32; col++)
            for (let row = 0; row < 8; row++)
                for (let lin = 0; lin < 8; lin++)
                    out[sector * 2048 + lin * 256 + row * 32 + col] = rcs[i++];
    for (let a = ATTR_START; a < SCREEN_LEN; a++) out[a] = rcs[a];   // attributes unchanged
    return out;
}

const POPCOUNT = (() => { const t = new Uint8Array(256); for (let i = 1; i < 256; i++) t[i] = t[i >> 1] + (i & 1); return t; })();

// Bitmap "noisiness": total pixel-differences between vertically-adjacent screen rows.
// A correctly-laid-out screen is smooth (flat areas, structured art → low); a scrambled
// one (e.g. RCS-reordered bytes rendered as a plain SCR) is near-random → high.
export function screenCoherence(scr) {
    if (!scr || scr.length < SCREEN_LEN) return Infinity;
    const rowAddr = (y) => ((y >> 6) * 2048) + ((y & 7) * 256) + (((y >> 3) & 7) * 32);
    let t = 0;
    for (let y = 0; y < 191; y++) {
        const a = rowAddr(y), b = rowAddr(y + 1);
        for (let xb = 0; xb < 32; xb++) t += POPCOUNT[scr[a + xb] ^ scr[b + xb]];
    }
    return t;
}

// Auto-detect RCS without signatures: true when de-RCS'ing the depacked bytes makes the
// screen markedly more coherent (the margin avoids flip-flopping on ambiguous images).
export function looksRcsEncoded(data) {
    if (!data || data.length < SCREEN_LEN) return false;
    return screenCoherence(rcsToScr(data)) < screenCoherence(data) * 0.85;
}

/* ───────────────── depacker-signature scan (embedded screens) ───────────────── */

function indexOfBytes(hay, needle, from = 0) {
    const n = needle.length, end = hay.length - n;
    for (let i = from; i <= end; i++) {
        let ok = true;
        for (let j = 0; j < n; j++) if (hay[i + j] !== needle[j]) { ok = false; break; }
        if (ok) return i;
    }
    return -1;
}

// Position-independent inner-loop fingerprints of the standard depackers (relative jumps
// + arithmetic only — no absolute addresses). Shared by the plain and RCS variants, so
// they identify the format/family, not whether RCS was applied.
const SIG_ZX7 = [0x87, 0xC0, 0x7E, 0x23, 0x17, 0xC9];        // dzx7_standard next-bit reader
const SIG_ZX0 = [0x87, 0x20, 0x03, 0x7E, 0x23, 0x17, 0xD8];  // dzx0_standard Elias-gamma loop

// Which depacker family's code is present in a block (or null).
export function findDepackerSignature(bytes) {
    if (!bytes) return null;
    if (indexOfBytes(bytes, SIG_ZX7) >= 0) return { format: 'ZX7' };
    if (indexOfBytes(bytes, SIG_ZX0) >= 0) return { format: 'ZX0' };
    return null;
}

// Locate the packed screen once the format is known — NOT by brute scanning, but by
// reading the loader's own source pointers: try the block start plus every `LD HL,nnnn`
// (0x21) operand mapped to a file offset via the block's load address. Decode each once.
function locatePackedScreen(bytes, loadAddr, format, entropyMax) {
    const cap = SCREEN_LEN + 1280;
    const decode = format === 'ZX0' ? zx0Decompress : zx7Decompress;
    const cands = new Set([0]);
    for (let i = 0; i + 2 < bytes.length && cands.size < 64; i++) {
        if (bytes[i] === 0x21) {                                   // LD HL, nnnn
            const off = (bytes[i + 1] | (bytes[i + 2] << 8)) - (loadAddr | 0);
            if (off > 0 && off < bytes.length) cands.add(off);
        }
    }
    for (const off of [...cands].sort((a, b) => a - b)) {
        let out;
        try { out = decode(bytes.subarray(off), { maxOutput: cap }); } catch (e) { continue; }
        if (!out || out.length !== SCREEN_LEN) continue;
        if (attributeEntropy(out) > entropyMax) continue;
        return { format, offset: off, data: out };
    }
    return null;
}

// Explorer entry point. First the standalone whole-block detector (in-window, fwd+back);
// then, for a larger/embedded block, a depacker-signature scan that locates the data via
// the loader's pointers. `loadAddr` is the block's load address (0 if unknown). Returns
// { format, direction, offset, data, viaSignature } or null. (RCS de-scramble is applied
// by the caller via a toggle — these bytes are raw decode output.)
export function findPackedScreenInBlock(bytes, loadAddr = 0, { entropyMax = 7.0 } = {}) {
    const whole = detectPackedScreen(bytes, { entropyMax });
    if (whole) return { ...whole, offset: 0, viaSignature: false };
    const sig = findDepackerSignature(bytes);
    if (sig) {
        const loc = locatePackedScreen(bytes, loadAddr, sig.format, entropyMax);
        if (loc) return { ...loc, direction: 'forward', viaSignature: true };
    }
    return null;
}
