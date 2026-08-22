// Data-table recognisers — pure: the byte reader is injected.
//
// Everything else here finds *code*: signature packs match byte patterns, the
// auto-map marks what executed. But the thing a hunt usually turns on is a
// table — the keyboard scan a game reads its controls through, the key-number to
// character map, the vocabulary an adventure parses input against. Those have no
// opcodes to anchor on; they are recognised by shape.
//
// Each scanner returns candidates with enough detail to judge them, and none of
// them is a proof. A run of bytes that happens to look like a table is a lead.

import { hex16 } from './utils.js';

// The eight keyboard half-rows as they appear on the address bus: one bit low
// each. A game that scans the keyboard has these in a table, or in its code.
export const HALF_ROW_BYTES = [0xFE, 0xFD, 0xFB, 0xF7, 0xEF, 0xDF, 0xBF, 0x7F];

// The rows in the order the port bytes above address them, for reporting
export const HALF_ROW_KEYS = [
    'CAPS Z X C V', 'A S D F G', 'Q W E R T', '1 2 3 4 5',
    '0 9 8 7 6', 'P O I U Y', 'ENTER L K J H', 'SPACE SYM M N B',
];

// One key of a half-row: bit 0 is the outermost, bit 4 the innermost
const KEY_BITS = [0x01, 0x02, 0x04, 0x08, 0x10];

const isHalfRow = (b) => HALF_ROW_BYTES.indexOf(b) >= 0;
const isKeyBit = (b) => KEY_BITS.indexOf(b) >= 0;
const isRowIndex = (b) => b <= 7;

// Which key a (row byte, bit) pair names, for a report that can be read
export function namedKey(rowByte, bit) {
    const row = HALF_ROW_BYTES.indexOf(rowByte);
    const col = KEY_BITS.indexOf(bit);
    if (row < 0 || col < 0) return null;
    return HALF_ROW_KEYS[row].split(' ')[col] || null;
}

// ---------------------------------------------------------------------------
// Keyboard scan tables: (half-row, key bit) pairs
// ---------------------------------------------------------------------------

// A game that reads its controls from a table holds one record per key. The
// record is nearly always the half-row select byte and the bit to test, in one
// order or the other, sometimes with a payload byte or two between them.
//
// The row may be the port byte ($FE, $FD, …) or an index 0-7 that the code turns
// into one; both are reported, the port byte being much the stronger signal.
export function findKeyScanTables(read, from, to, opts = {}) {
    const {
        strides = [2, 3, 4], minEntries = 4, limit = 50,
        // A controls table names each key once and there are only 40 of them.
        // Without these two the recogniser runs away: the row-as-index form
        // accepts any byte 0-7 and the bit form any of five values, so ordinary
        // data matches for thousands of "entries" and drowns the real tables.
        maxEntries = 40, requireDistinct = true, allowRowIndex = true,
    } = opts;
    const found = [];

    for (const stride of strides) {
        // Where in the record each field sits. Only the two orders that occur.
        const layouts = [
            { rowAt: 0, bitAt: 1, order: 'row, bit' },
            { rowAt: 1, bitAt: 0, order: 'bit, row' },
        ];
        for (const layout of layouts) {
            let addr = from;
            while (addr + stride <= to) {
                const entries = [];
                let a = addr;
                let portForm = true;
                while (a + stride <= to && entries.length < maxEntries) {
                    const rowByte = read(a + layout.rowAt) & 0xff;
                    const bit = read(a + layout.bitAt) & 0xff;
                    if (!isKeyBit(bit)) break;
                    if (isHalfRow(rowByte)) {
                        entries.push({ addr: a, row: rowByte, bit, key: namedKey(rowByte, bit) });
                    } else if (allowRowIndex && isRowIndex(rowByte)) {
                        portForm = false;
                        entries.push({
                            addr: a, row: HALF_ROW_BYTES[rowByte], bit,
                            key: namedKey(HALF_ROW_BYTES[rowByte], bit),
                        });
                    } else break;
                    a += stride;
                }
                const distinct = new Set(entries.map(e => e.row + ':' + e.bit)).size;
                // Each key named once is what a controls table looks like. The
                // same key over and over is data that happens to fit.
                if (requireDistinct && distinct !== entries.length) {
                    addr++;
                    continue;
                }
                if (entries.length >= minEntries) {
                    found.push({
                        addr, stride, order: layout.order, entries, distinct,
                        rowForm: portForm ? 'port byte' : 'row index',
                        label: `${entries.length} keys, stride ${stride}, ${layout.order}` +
                               (portForm ? '' : ', row as index'),
                    });
                    addr = a;
                    if (found.length >= limit) return dedupeByAddr(found);
                } else {
                    addr++;
                }
            }
        }
    }
    return dedupeByAddr(found);
}

// The same table found at two strides is one table; keep the longest reading
function dedupeByAddr(list) {
    const best = new Map();
    for (const t of list) {
        const prev = best.get(t.addr);
        if (!prev || t.entries.length > prev.entries.length) best.set(t.addr, t);
    }
    return [...best.values()].sort((a, b) => a.addr - b.addr);
}

// ---------------------------------------------------------------------------
// Key-number to character tables
// ---------------------------------------------------------------------------

const isPrintable = (b) => b >= 0x20 && b < 0x7f;

// A run of printable bytes of a length that means something: the 48K ROM keeps
// four 39-byte tables (K_UNSHIFT, K_SHIFT, K_EXT, K_GRAPH) and a game that rolls
// its own usually keeps 40, one per key. Length is the whole signal, so the
// lengths to look for are the caller's to choose.
//
// `minDistinct` is what separates a character table from a run of padding: a
// table of forty keys has forty different characters in it, or nearly.
export function findCharTables(read, from, to, opts = {}) {
    const { lengths = [39, 40], minDistinct = 20, bit7 = true, limit = 50 } = opts;
    const wanted = new Set(lengths);
    const longest = Math.max(...lengths);
    const found = [];

    let addr = from;
    while (addr < to) {
        // How far the printable run from here reaches
        let n = 0;
        while (addr + n < to && n <= longest) {
            const b = read(addr + n) & 0xff;
            if (!isPrintable(bit7 ? (b & 0x7f) : b)) break;
            n++;
        }
        if (n >= Math.min(...lengths)) {
            for (const len of wanted) {
                if (n < len) continue;
                const bytes = [];
                for (let i = 0; i < len; i++) bytes.push((read(addr + i) & (bit7 ? 0x7f : 0xff)));
                const distinct = new Set(bytes).size;
                if (distinct < minDistinct) continue;
                found.push({
                    addr, length: len, distinct,
                    text: bytes.map(b => String.fromCharCode(b)).join(''),
                    label: `${len} printable characters, ${distinct} distinct`,
                });
                if (found.length >= limit) return found;
            }
            addr += Math.max(1, n);
        } else {
            // The run stopped short, so nothing inside it can start a long enough
            // one either — skip past the byte that ended it
            addr += n + 1;
        }
    }
    return found;
}

// ---------------------------------------------------------------------------
// Fixed-record word tables (PAW / Quill vocabularies and their like)
// ---------------------------------------------------------------------------

// The alphabet a word may be spelt in. Space is included because entries are
// padded with it, and that padding is what gives the encoding away.
const DEFAULT_ALPHABET = (() => {
    const s = new Set([0x20]);
    for (let c = 0x41; c <= 0x5A; c++) s.add(c);   // A-Z
    for (let c = 0x30; c <= 0x39; c++) s.add(c);   // 0-9
    for (const c of "-'.") s.add(c.charCodeAt(0));
    return s;
})();

// The schemes a vocabulary is stored in, keyed the same way as encoded-search
const WORD_ENCODINGS = {
    plain: (b) => b,
    complement: (b) => b ^ 0xff,
    high: (b) => b ^ 0x80,
    xor: (b, k) => b ^ k,
    add: (b, k) => (b - k) & 0xff,       // stored = plain + k, so decode subtracts
    'const-sub': (b, k) => (k - b) & 0xff,
};

// An adventure keeps its vocabulary as fixed-length records: so many characters
// of the word, then the value the parser matches on, then the word's type. That
// shape survives whatever encoding the text wears, so it is what to look for —
// and the *value* is what makes the table worth reading. Two words numbered 200
// and 201 in a game whose other words run 11, 57, 71 are not ordinary words.
//
// The key is not brute-forced: entries are padded, so the commonest byte in the
// text of the first records is almost certainly that pad, and assuming it is a
// space gives one key per scheme to check rather than 256.
export function findWordTables(read, from, to, opts = {}) {
    const {
        recordLens = [6, 7], textLens = [4, 5], minEntries = 8,
        alphabet = DEFAULT_ALPHABET, bit7 = true, limit = 30, keys = null,
    } = opts;
    const found = [];

    for (const recordLen of recordLens) {
        for (const textLen of textLens) {
            if (textLen >= recordLen) continue;
            let addr = from;
            while (addr + recordLen * minEntries <= to) {
                const cand = tryWordTable(read, addr, to, {
                    recordLen, textLen, minEntries, alphabet, bit7, keys,
                });
                if (cand) {
                    found.push(cand);
                    addr = cand.addr + cand.entries.length * recordLen;
                    if (found.length >= limit) return sortTables(found);
                } else {
                    addr++;
                }
            }
        }
    }
    return sortTables(found);
}

// The same bytes read two ways: 5+2 records also read as 4+3, because the fifth
// character is a letter and a letter is a legal byte in the value field. Both
// readings are produced; this keeps the one that explains the most — most
// entries, and on a tie the longer word, since the alternative is leaving a
// letter sitting where the value should be.
function sortTables(list) {
    const best = new Map();
    for (const t of list) {
        const prev = best.get(t.addr);
        const better = !prev || t.entries.length > prev.entries.length ||
                       (t.entries.length === prev.entries.length && t.textLen > prev.textLen);
        if (better) best.set(t.addr, t);
    }
    return [...best.values()].sort((a, b) => a.addr - b.addr);
}

// The (scheme, key) pairs worth trying at this position: the fixed ones, plus
// one per family derived from assuming the commonest byte here is the pad
function candidateSchemes(read, addr, span, keys) {
    if (keys) return keys;
    const counts = new Map();
    for (let i = 0; i < span; i++) {
        const b = read(addr + i) & 0xff;
        counts.set(b, (counts.get(b) || 0) + 1);
    }
    let pad = 0x20, most = -1;
    for (const [b, n] of counts) if (n > most) { most = n; pad = b; }
    return [
        { encoding: 'plain', key: 0 },
        { encoding: 'complement', key: 0 },
        { encoding: 'high', key: 0 },
        { encoding: 'xor', key: pad ^ 0x20 },
        { encoding: 'add', key: (pad - 0x20) & 0xff },
        { encoding: 'const-sub', key: (pad + 0x20) & 0xff },
    ];
}

function tryWordTable(read, addr, to, { recordLen, textLen, minEntries, alphabet, bit7, keys }) {
    const span = Math.min(recordLen * minEntries, to - addr);
    for (const scheme of candidateSchemes(read, addr, Math.min(span, recordLen * 4), keys)) {
        const decode = WORD_ENCODINGS[scheme.encoding];
        if (!decode) continue;

        const entries = [];
        let a = addr;
        while (a + recordLen <= to) {
            const chars = [];
            let ok = true;
            for (let i = 0; i < textLen; i++) {
                let c = decode(read(a + i) & 0xff, scheme.key) & 0xff;
                // Bit 7 marks the end of the word — on the *last* byte of the
                // field only. Masking it everywhere would make a vocabulary
                // stored with the high bit set indistinguishable from a plain
                // one, and the encoding is half of what the reader needs.
                if (bit7 && i === textLen - 1) c &= 0x7f;
                if (!alphabet.has(c)) { ok = false; break; }
                chars.push(c);
            }
            // A word cannot be all padding, and cannot start with it
            if (ok && (chars[0] === 0x20 || chars.every(c => c === 0x20))) ok = false;
            if (!ok) break;
            const rest = [];
            for (let i = textLen; i < recordLen; i++) rest.push(read(a + i) & 0xff);
            entries.push({
                addr: a,
                word: chars.map(c => String.fromCharCode(c)).join('').trimEnd(),
                value: rest[0],
                type: rest.length > 1 ? rest[1] : null,
                extra: rest,
            });
            a += recordLen;
        }
        if (entries.length >= minEntries) {
            const words = new Set(entries.map(e => e.word));
            if (words.size < entries.length * 0.8) continue;   // the same word over and over is noise
            return {
                addr, recordLen, textLen, entries,
                encoding: scheme.encoding, key: scheme.key,
                label: `${entries.length} words, ${textLen}+${recordLen - textLen} bytes each, ` +
                       (scheme.encoding === 'plain' ? 'plain'
                        : scheme.encoding === 'complement' ? 'complemented'
                        : scheme.encoding === 'high' ? 'high bit set'
                        : `${scheme.encoding} $${scheme.key.toString(16).padStart(2, '0').toUpperCase()}`),
            };
        }
    }
    return null;
}

// The reading that makes a vocabulary worth having: the words in value order, so
// the odd ones out stand up. A game whose words run 11, 57, 71 and then has two
// at 200 and 201 is telling you what those two are for.
export function byValue(table) {
    if (!table || !table.entries) return [];
    return table.entries.slice().sort((a, b) => (a.value - b.value) || a.addr - b.addr);
}

// Values far from the rest of the table — the reason to sort by value at all.
// "Far" is by gap, not by magnitude: a table of 11, 57, 71, 200, 201 has an
// outlying *pair*, and both belong together in the answer.
export function outliers(table, { minGap = 32 } = {}) {
    const sorted = byValue(table).filter(e => e.value != null);
    if (sorted.length < 3) return [];
    for (let i = sorted.length - 1; i > 0; i--) {
        if (sorted[i].value - sorted[i - 1].value >= minGap) {
            return sorted.slice(i);
        }
    }
    return [];
}

export function describeTable(t) {
    return `$${hex16(t.addr)}  ${t.label}`;
}
