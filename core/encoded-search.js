// Encoding-aware string search — pure: the caller supplies a byte reader.
//
// Text in a game is very often not stored as text. The same small set of schemes
// keeps coming back: complemented, XORed with a constant, subtracted from one,
// or with the character's position folded into the key so no two characters are
// enciphered alike. Searching only for the plaintext finds nothing and, worse,
// says nothing — the absence looks like the text not being there.
//
// Cost does not grow with the number of schemes. Every (scheme, key) pair is
// encoded once and indexed by the byte the needle would *start* with, so a
// position in memory only verifies the handful of pairs that could begin there.
// Seven schemes x 256 keys is one pass, not 1792.

import { hex8 } from './utils.js';

// A scheme encodes plaintext character `c` at index `i` under key `k`.
// Keep `encode` total and byte-clean: every result is masked to 8 bits.
export const ENCODINGS = [
    {
        id: 'plain', label: 'Plain', keys: 1,
        encode: (c) => c & 0xff,
        describe: () => 'plain',
    },
    {
        id: 'xor', label: 'XOR key', keys: 256,
        encode: (c, k) => (c ^ k) & 0xff,
        // $FF is worth naming: a complemented string is the commonest of all
        describe: (k) => (k === 0xff ? 'complemented (XOR $FF)' : `XOR $${hex8(k)}`),
    },
    {
        id: 'add', label: 'Add key', keys: 256,
        encode: (c, k) => (c + k) & 0xff,
        // Subtracting a key is the same family seen from the other side
        describe: (k) => `+$${hex8(k)}  (= −$${hex8((256 - k) & 0xff)})`,
    },
    {
        id: 'const-sub', label: 'Key − char', keys: 256,
        encode: (c, k) => (k - c) & 0xff,
        describe: (k) => `$${hex8(k)} − c`,
    },
    {
        id: 'xor-pos', label: 'XOR (key + index)', keys: 256,
        encode: (c, k, i) => (c ^ ((k + i) & 0xff)) & 0xff,
        describe: (k) => `XOR ($${hex8(k)} + i)`,
    },
    {
        id: 'add-pos', label: 'Add (key + index)', keys: 256,
        encode: (c, k, i) => (c + k + i) & 0xff,
        describe: (k) => `+($${hex8(k)} + i)`,
    },
    {
        id: 'sub-pos', label: 'Char − (key + index)', keys: 256,
        encode: (c, k, i) => (c - k - i) & 0xff,
        describe: (k) => `c − ($${hex8(k)} + i)`,
    },
];

export const ENCODING_IDS = ENCODINGS.map(e => e.id);

// The needle forms to look for, before any scheme is applied. A search is for a
// word, not for one spelling of it: a game may hold it upper-cased, and the
// last character often carries bit 7 as an end-of-string marker.
export function needleVariants(text, { cases = true, bit7 = true, truncate = 0 } = {}) {
    let s = String(text == null ? '' : text);
    if (truncate > 0) s = s.slice(0, truncate);
    if (!s) return [];

    const spellings = cases ? [s, s.toUpperCase(), s.toLowerCase()] : [s];
    const out = [];
    const seen = new Set();
    for (const sp of spellings) {
        const base = Array.from(sp, ch => ch.charCodeAt(0) & 0xff);
        const forms = [{ bytes: base, note: '' }];
        if (bit7 && base.length) {
            const marked = base.slice();
            marked[marked.length - 1] |= 0x80;
            forms.push({ bytes: marked, note: 'bit 7 on the last character' });
        }
        for (const f of forms) {
            const key = f.bytes.join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ bytes: f.bytes, text: sp, note: f.note });
        }
    }
    return out;
}

// Every (variant, scheme, key) encoded once, indexed by its first byte.
//
// Two pairs that produce the same bytes are the same search — XOR $00, +$00 and
// plain all are — so the index keeps whichever scheme comes first in ENCODINGS,
// which is the plainest description of what was found.
export function buildIndex(variants, { encodings = ENCODING_IDS } = {}) {
    const wanted = ENCODINGS.filter(e => encodings.includes(e.id));
    const byFirstByte = Array.from({ length: 256 }, () => []);
    const seen = new Set();
    let count = 0;

    for (const variant of variants) {
        if (!variant.bytes.length) continue;
        for (const enc of wanted) {
            for (let k = 0; k < enc.keys; k++) {
                const bytes = variant.bytes.map((c, i) => enc.encode(c, k, i));
                const sig = bytes.join(',');
                if (seen.has(sig)) continue;
                seen.add(sig);
                byFirstByte[bytes[0]].push({ bytes, encoding: enc, key: k, variant });
                count++;
            }
        }
    }
    return { byFirstByte, count };
}

// Scan [from, to) through `read(addr)`, returning every match.
//
// `limit` caps the results, not the work: a search over 64K for a short word can
// match in hundreds of places under some key or other, and a list that long is
// not an answer. Raise it when the caller is a script rather than a panel.
export function searchEncoded(read, from, to, text, opts = {}) {
    const { limit = 500 } = opts;
    const variants = needleVariants(text, opts);
    if (!variants.length) return { matches: [], candidates: 0, truncated: false };

    const { byFirstByte, count } = buildIndex(variants, opts);
    const longest = Math.max(...variants.map(v => v.bytes.length));
    const last = to - longest;
    const matches = [];
    let truncated = false;

    for (let addr = from; addr <= last; addr++) {
        const here = byFirstByte[read(addr) & 0xff];
        if (!here.length) continue;
        for (const cand of here) {
            const bytes = cand.bytes;
            let ok = true;
            for (let i = 1; i < bytes.length; i++) {
                if ((read(addr + i) & 0xff) !== bytes[i]) { ok = false; break; }
            }
            if (!ok) continue;
            if (matches.length >= limit) { truncated = true; break; }
            matches.push({
                addr,
                length: bytes.length,
                bytes,
                encoding: cand.encoding.id,
                key: cand.key,
                label: cand.encoding.describe(cand.key),
                text: cand.variant.text,
                note: cand.variant.note,
            });
        }
        if (truncated) break;
    }
    return { matches, candidates: count, truncated };
}

// Nibble packing is a different shape, not another key: two characters share a
// byte, so the needle halves in length and can start in either nibble. The
// alphabet is a run of `size` codes starting at `base` (A=1..Z=26 and A=0..Z=25
// are both common), and the sweep over `base` is what finds it without knowing.
export function searchNibblePacked(read, from, to, text, opts = {}) {
    const { limit = 500, cases = true, highFirst = true, lowFirst = true, minBytes = 2 } = opts;
    const spellings = cases ? [...new Set([String(text).toUpperCase(), String(text)])]
                            : [String(text)];
    const matches = [];
    let truncated = false;

    for (const sp of spellings) {
        const chars = Array.from(sp, ch => ch.charCodeAt(0) & 0xff);
        if (chars.length < 2) continue;

        for (let base = 0; base < 256 && !truncated; base++) {
            const nibbles = chars.map(c => (c - base) & 0xff);
            if (nibbles.some(n => n > 0x0f)) continue;   // doesn't fit this alphabet

            for (const high of [highFirst && 'high', lowFirst && 'low'].filter(Boolean)) {
                // Pack from the first character; an odd length leaves the tail
                // nibble unknown, so only whole bytes are compared.
                //
                // Below `minBytes` there is nothing to find: two characters are
                // one byte, and one byte matches a couple of hundred times in a
                // 64K under every base in the sweep — a list of those is not a
                // result, it is the limit being filled with noise before the scan
                // ever reaches the real one.
                const whole = Math.floor(nibbles.length / 2);
                if (whole < minBytes) continue;
                const packed = [];
                for (let i = 0; i < whole; i++) {
                    const a = nibbles[i * 2], b = nibbles[i * 2 + 1];
                    packed.push(high === 'high' ? ((a << 4) | b) : ((b << 4) | a));
                }
                for (let addr = from; addr + packed.length <= to; addr++) {
                    let ok = true;
                    for (let i = 0; i < packed.length; i++) {
                        if ((read(addr + i) & 0xff) !== packed[i]) { ok = false; break; }
                    }
                    if (!ok) continue;
                    if (matches.length >= limit) { truncated = true; break; }
                    matches.push({
                        addr,
                        length: packed.length,
                        bytes: packed,
                        encoding: 'nibble',
                        key: base,
                        label: `nibble-packed, ${high} nibble first, '${sp[0]}' = ${(chars[0] - base) & 0x0f}`,
                        text: sp.slice(0, whole * 2),
                        note: nibbles.length & 1 ? 'odd length: the last character is not compared' : '',
                    });
                }
                if (truncated) break;
            }
        }
    }
    return { matches, truncated };
}

// What a match says the surrounding bytes decode to — the point of a hit is
// usually the record around it, not the word itself.
export function decodeAt(read, addr, encoding, key, length, startIndex = 0) {
    const enc = ENCODINGS.find(e => e.id === encoding);
    if (!enc) return null;
    // Invert by search: the schemes are byte-wide, so 256 tries per character is
    // exact and needs no per-scheme inverse to get wrong.
    const out = [];
    for (let i = 0; i < length; i++) {
        const got = read(addr + i) & 0xff;
        let plain = null;
        for (let c = 0; c < 256; c++) {
            if (enc.encode(c, key, startIndex + i) === got) { plain = c; break; }
        }
        out.push(plain === null ? got : plain);
    }
    return out;
}
