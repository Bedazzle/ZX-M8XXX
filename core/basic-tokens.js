// ZX Spectrum BASIC token table, detokenizer, tokenizer, and 5-byte FP encoder/decoder.
// Shared by ui/explorer.js (file analysis) and ui/basic-editor.js (copy/paste).

import { hex8 } from './utils.js';

// ZX Spectrum BASIC tokens (0xA3-0xFF)
// Each entry: [keyword, spaceBefore, spaceAfter]
export const BASIC_TOKENS = {
    0xA3: ['SPECTRUM', true, true], 0xA4: ['PLAY', true, true],
    0xA5: ['RND', true, false], 0xA6: ['INKEY$', true, false],
    0xA7: ['PI', true, false], 0xA8: ['FN', true, false],
    0xA9: ['POINT', true, false], 0xAA: ['SCREEN$', true, false],
    0xAB: ['ATTR', true, false], 0xAC: ['AT', true, true],
    0xAD: ['TAB', true, true], 0xAE: ['VAL$', true, false],
    0xAF: ['CODE', true, true], 0xB0: ['VAL', true, true],
    0xB1: ['LEN', true, false], 0xB2: ['SIN', true, false],
    0xB3: ['COS', true, false], 0xB4: ['TAN', true, false],
    0xB5: ['ASN', true, false], 0xB6: ['ACS', true, false],
    0xB7: ['ATN', true, false], 0xB8: ['LN', true, false],
    0xB9: ['EXP', true, false], 0xBA: ['INT', true, false],
    0xBB: ['SQR', true, false], 0xBC: ['SGN', true, false],
    0xBD: ['ABS', true, false], 0xBE: ['PEEK', true, false],
    0xBF: ['IN', true, true], 0xC0: ['USR', true, true],
    0xC1: ['STR$', true, false], 0xC2: ['CHR$', true, false],
    0xC3: ['NOT', true, true], 0xC4: ['BIN', true, true],
    0xC5: ['OR', true, true], 0xC6: ['AND', true, true],
    0xC7: ['<=', false, false], 0xC8: ['>=', false, false],
    0xC9: ['<>', false, false], 0xCA: ['LINE', true, true],
    0xCB: ['THEN', true, true], 0xCC: ['TO', true, true],
    0xCD: ['STEP', true, true], 0xCE: ['DEF FN', true, true],
    0xCF: ['CAT', true, true], 0xD0: ['FORMAT', true, true],
    0xD1: ['MOVE', true, true], 0xD2: ['ERASE', true, true],
    0xD3: ['OPEN #', true, false], 0xD4: ['CLOSE #', true, false],
    0xD5: ['MERGE', true, true], 0xD6: ['VERIFY', true, true],
    0xD7: ['BEEP', true, true], 0xD8: ['CIRCLE', true, true],
    0xD9: ['INK', true, true], 0xDA: ['PAPER', true, true],
    0xDB: ['FLASH', true, true], 0xDC: ['BRIGHT', true, true],
    0xDD: ['INVERSE', true, true], 0xDE: ['OVER', true, true],
    0xDF: ['OUT', true, true], 0xE0: ['LPRINT', true, true],
    0xE1: ['LLIST', true, true], 0xE2: ['STOP', true, false],
    0xE3: ['READ', true, true], 0xE4: ['DATA', true, true],
    0xE5: ['RESTORE', true, true], 0xE6: ['NEW', true, false],
    0xE7: ['BORDER', true, true], 0xE8: ['CONTINUE', true, false],
    0xE9: ['DIM', true, true], 0xEA: ['REM', true, true],
    0xEB: ['FOR', true, true], 0xEC: ['GO TO', true, true],
    0xED: ['GO SUB', true, true], 0xEE: ['INPUT', true, true],
    0xEF: ['LOAD', true, true], 0xF0: ['LIST', true, true],
    0xF1: ['LET', true, true], 0xF2: ['PAUSE', true, true],
    0xF3: ['NEXT', true, true], 0xF4: ['POKE', true, true],
    0xF5: ['PRINT', true, true], 0xF6: ['PLOT', true, true],
    0xF7: ['RUN', true, true], 0xF8: ['SAVE', true, true],
    0xF9: ['RANDOMIZE', true, true], 0xFA: ['IF', true, true],
    0xFB: ['CLS', true, false], 0xFC: ['DRAW', true, true],
    0xFD: ['CLEAR', true, true], 0xFE: ['RETURN', true, false],
    0xFF: ['COPY', true, false]
};

export const CONTROL_CODES = {
    0x10: 'INK', 0x11: 'PAPER', 0x12: 'FLASH',
    0x13: 'BRIGHT', 0x14: 'INVERSE', 0x15: 'OVER',
    0x16: 'AT', 0x17: 'TAB'
};

// Decode Sinclair 5-byte floating point → JS number
export function parseFloat5(bytes) {
    if (bytes.length < 5) return null;
    const exp = bytes[0];
    if (exp === 0) {
        if (bytes[1] === 0x00 && bytes[4] === 0x00) {
            return bytes[2] | (bytes[3] << 8);
        }
        if (bytes[1] === 0xFF && bytes[4] === 0x00) {
            const val = bytes[2] | (bytes[3] << 8);
            return val > 32767 ? val - 65536 : -val;
        }
        return 0;
    }
    const sign = (bytes[1] & 0x80) ? -1 : 1;
    const mantissa = (((bytes[1] | 0x80) << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0;
    return sign * (mantissa / 0x100000000) * Math.pow(2, exp - 128);
}

// Encode JS number → 5-byte Sinclair floating point Uint8Array
export function encodeFloat5(n) {
    const result = new Uint8Array(5);
    if (n === 0) {
        // All zeros
        return result;
    }
    // Integer shortform: -65535..65535
    if (Number.isInteger(n) && n >= -65535 && n <= 65535) {
        result[0] = 0x00;
        if (n >= 0) {
            result[1] = 0x00;
            result[2] = n & 0xFF;
            result[3] = (n >> 8) & 0xFF;
        } else {
            result[1] = 0xFF;
            const mag = -n;
            // Two's complement of magnitude for negative
            const tc = 0x10000 - mag;
            result[2] = tc & 0xFF;
            result[3] = (tc >> 8) & 0xFF;
        }
        result[4] = 0x00;
        return result;
    }
    // Full floating-point encoding
    const sign = n < 0 ? 1 : 0;
    const abs = Math.abs(n);
    const exp = Math.floor(Math.log2(abs));
    const exponent = exp + 129;
    if (exponent < 1 || exponent > 255) {
        // Out of range — encode as 0
        return result;
    }
    // Normalize: mantissa = abs / 2^exp, in range [1, 2)
    const normalized = abs / Math.pow(2, exp);
    // Mantissa is 32 bits; bit 31 is implicit 1, replaced by sign
    const mantissaInt = Math.round(normalized * 0x80000000) >>> 0;
    result[0] = exponent;
    result[1] = ((mantissaInt >>> 24) & 0x7F) | (sign << 7);
    result[2] = (mantissaInt >>> 16) & 0xFF;
    result[3] = (mantissaInt >>> 8) & 0xFF;
    result[4] = mantissaInt & 0xFF;
    return result;
}

function formatNumber(n) {
    if (n === null || n === undefined) return '?';
    if (Number.isInteger(n)) return n.toString();
    return parseFloat(n.toPrecision(10)).toString();
}

// Decode a tokenized BASIC program (Uint8Array) → array of { number, text }
// Also returns offset, tokens, obfuscations for explorer compatibility.
// options.deobfuscate (default true): replace obfuscated numbers with {{real_value}}
export function decodeBasicProgram(data, options) {
    const deobfuscate = !options || options.deobfuscate !== false;
    const lines = [];
    let offset = 0;

    while (offset < data.length - 4) {
        const lineNum = (data[offset] << 8) | data[offset + 1];
        let lineLen = data[offset + 2] | (data[offset + 3] << 8);

        if (lineLen === 0) break;

        // Stop at variables area: ZX BASIC line numbers are 0-9999.
        if (lineNum >= 16384) break;

        const availableLen = data.length - offset - 4;
        if (lineLen > availableLen) lineLen = availableLen;
        if (lineLen === 0) break;

        // Scan for 0x0D terminator
        let displayLen = lineLen;
        let advanceLen = lineLen;
        const searchEnd = Math.min(offset + 4 + lineLen + 32, data.length);
        for (let scan = offset + 4; scan < searchEnd; scan++) {
            if (data[scan] === 0x0D) {
                const foundLen = scan - offset - 4 + 1;
                if (foundLen <= lineLen) {
                    displayLen = foundLen;
                } else {
                    displayLen = foundLen;
                    advanceLen = foundLen;
                }
                break;
            }
        }

        const lineData = data.slice(offset + 4, offset + 4 + displayLen);
        const decoded = decodeLine(lineData, deobfuscate);

        lines.push({
            number: lineNum,
            offset: offset,
            text: decoded.text,
            tokens: decoded.tokens,
            obfuscations: decoded.obfuscations
        });

        offset += 4 + advanceLen;
    }
    return lines;
}

function decodeLine(data, deobfuscate) {
    let text = '';
    let tokens = [];
    let obfuscations = [];
    let i = 0;
    let inString = false;
    let inREM = false;
    let lastWasSpace = false;
    let asciiBeforeFP = '';
    let asciiStartPos = -1;
    let asciiTokenStart = -1;

    function addText(str, spaceBefore = false, spaceAfter = false) {
        let addedSpaceBefore = false, addedSpaceAfter = false;
        if (spaceBefore && text.length > 0 && !lastWasSpace && !text.endsWith(' ')) {
            const prev = text[text.length - 1];
            if (/[A-Za-z0-9$:]/.test(prev)) {
                text += ' ';
                addedSpaceBefore = true;
            }
        }
        text += str;
        lastWasSpace = str.endsWith(' ') || spaceAfter;
        if (spaceAfter && !str.endsWith(' ')) {
            text += ' ';
            addedSpaceAfter = true;
            lastWasSpace = true;
        }
        return { addedSpaceBefore, addedSpaceAfter };
    }

    while (i < data.length) {
        const byte = data[i];

        if (byte === 0x0D) break;

        if (inREM) {
            if (byte >= 0x20 && byte < 0x80) {
                text += String.fromCharCode(byte);
                tokens.push({ type: 'text', value: String.fromCharCode(byte) });
            } else if (byte === 0x0E) {
                i += 5;
            } else if (BASIC_TOKENS[byte]) {
                const [keyword, spaceBefore, spaceAfter] = BASIC_TOKENS[byte];
                if (spaceBefore && text.length > 0 && !text.endsWith(' ')) {
                    text += ' ';
                    tokens.push({ type: 'space' });
                }
                text += keyword;
                tokens.push({ type: 'keyword', value: keyword });
                if (spaceAfter) {
                    text += ' ';
                    tokens.push({ type: 'space' });
                }
            } else {
                const hex = hex8(byte);
                text += `[${hex}]`;
                tokens.push({ type: 'hex', value: hex });
            }
            i++;
            continue;
        }

        if (byte === 0x0E && !inString) {
            const fpBytes = [];
            for (let j = 0; j < 5 && i + 1 + j < data.length; j++) {
                fpBytes.push(data[i + 1 + j]);
            }
            const fpValue = parseFloat5(fpBytes);
            const fpFormatted = formatNumber(fpValue);
            let isObfuscated = false;
            let asciiDisplay = asciiBeforeFP.trim();

            if (asciiDisplay !== '') {
                let asciiNum = parseFloat(asciiDisplay);
                if (asciiDisplay.startsWith('.')) asciiNum = parseFloat('0' + asciiDisplay);
                if (isNaN(asciiNum)) {
                    isObfuscated = true;
                } else {
                    const valuesMatch = Math.abs(Math.abs(asciiNum) - Math.abs(fpValue)) < 0.0001 ||
                                       Math.abs(asciiNum - fpValue) < 0.0001;
                    if (!valuesMatch) isObfuscated = true;
                }
            } else {
                isObfuscated = true;
                asciiDisplay = '(hidden)';
            }

            if (isObfuscated) {
                obfuscations.push({ ascii: asciiDisplay, actual: fpValue });
                if (deobfuscate) {
                    if (asciiStartPos >= 0 && asciiStartPos < text.length) {
                        text = text.substring(0, asciiStartPos);
                    }
                    if (asciiTokenStart >= 0 && asciiTokenStart < tokens.length) {
                        tokens.length = asciiTokenStart;
                    }
                    text += `{{${fpFormatted}}}`;
                    tokens.push({ type: 'number', value: `{{${fpFormatted}}}` });
                }
            }
            asciiBeforeFP = '';
            asciiStartPos = -1;
            asciiTokenStart = -1;
            i += 6;
            continue;
        }

        const isNumberChar = (byte >= 0x30 && byte <= 0x39) || byte === 0x2E ||
                             byte === 0x2B || byte === 0x2D || byte === 0x45 || byte === 0x65;
        if (!inString && isNumberChar) {
            if (asciiStartPos < 0) {
                asciiStartPos = text.length;
                asciiTokenStart = tokens.length;
            }
            asciiBeforeFP += String.fromCharCode(byte);
        } else if (!inString && byte !== 0x0E) {
            if (byte !== 0x20 || asciiBeforeFP === '') {
                asciiBeforeFP = '';
                asciiStartPos = -1;
                asciiTokenStart = -1;
            } else if (byte === 0x20 && asciiBeforeFP !== '') {
                asciiBeforeFP += ' ';
            }
        }

        if (byte === 0x22) {
            inString = !inString;
            text += '"';
            tokens.push({ type: 'string_delim' });
            lastWasSpace = false;
            asciiBeforeFP = '';
            asciiStartPos = -1;
            asciiTokenStart = -1;
            i++;
            continue;
        }

        if (inString) {
            if (byte >= 0x20 && byte < 0x80) {
                text += String.fromCharCode(byte);
                tokens.push({ type: 'string_char', value: String.fromCharCode(byte) });
            } else if (byte >= 0x80 && byte <= 0x8F) {
                text += `[BLK]`;
                tokens.push({ type: 'block', byte });
            } else if (byte >= 0x90 && byte <= 0xA2) {
                text += `[UDG-${String.fromCharCode(65 + byte - 0x90)}]`;
                tokens.push({ type: 'udg', letter: String.fromCharCode(65 + byte - 0x90) });
            } else if (CONTROL_CODES[byte]) {
                const params = [];
                if (byte >= 0x16) {
                    i++;
                    if (i < data.length) params.push(data[i]);
                    i++;
                    if (i < data.length) params.push(data[i]);
                } else {
                    i++;
                    if (i < data.length) params.push(data[i]);
                }
                text += '{' + CONTROL_CODES[byte] + ' ' + params.join(',') + '}';
                tokens.push({ type: 'control', name: CONTROL_CODES[byte], params });
            } else if (BASIC_TOKENS[byte]) {
                const [keyword] = BASIC_TOKENS[byte];
                text += keyword;
                tokens.push({ type: 'string_char', value: keyword });
            } else {
                const hex = hex8(byte);
                text += `[${hex}]`;
                tokens.push({ type: 'hex', value: hex });
            }
            i++;
            continue;
        }

        if (CONTROL_CODES[byte]) {
            const params = [];
            asciiBeforeFP = '';
            asciiStartPos = -1;
            asciiTokenStart = -1;
            if (byte >= 0x16) {
                i++;
                if (i < data.length) params.push(data[i]);
                i++;
                if (i < data.length) params.push(data[i]);
            } else {
                i++;
                if (i < data.length) params.push(data[i]);
            }
            const ctrlText = '{' + CONTROL_CODES[byte] + ' ' + params.join(',') + '}';
            const ctrlSpaces = addText(ctrlText, true, false);
            if (ctrlSpaces.addedSpaceBefore) tokens.push({ type: 'space' });
            tokens.push({ type: 'control', name: CONTROL_CODES[byte], params });
            i++;
            continue;
        }

        if (BASIC_TOKENS[byte]) {
            const [keyword, spaceBefore, spaceAfter] = BASIC_TOKENS[byte];
            const kwSpaces = addText(keyword, spaceBefore, spaceAfter);
            if (kwSpaces.addedSpaceBefore) tokens.push({ type: 'space' });
            tokens.push({ type: 'keyword', value: keyword });
            if (kwSpaces.addedSpaceAfter) tokens.push({ type: 'space' });
            if (byte === 0xEA) inREM = true;
            asciiBeforeFP = '';
            asciiStartPos = -1;
            asciiTokenStart = -1;
            i++;
            continue;
        }

        if (byte === 0x3A) {
            text += ':';
            tokens.push({ type: 'colon' });
            lastWasSpace = false;
            asciiBeforeFP = '';
            asciiStartPos = -1;
            asciiTokenStart = -1;
            i++;
            continue;
        }

        if (byte >= 0x20 && byte < 0x80) {
            text += String.fromCharCode(byte);
            if (byte === 0x20) {
                tokens.push({ type: 'space' });
            } else {
                tokens.push({ type: 'text', value: String.fromCharCode(byte) });
            }
            lastWasSpace = (byte === 0x20);
        } else if (byte >= 0x90 && byte <= 0xA2) {
            text += `[UDG-${String.fromCharCode(65 + byte - 0x90)}]`;
            tokens.push({ type: 'udg', letter: String.fromCharCode(65 + byte - 0x90) });
            lastWasSpace = false;
            asciiBeforeFP = '';
            asciiStartPos = -1;
            asciiTokenStart = -1;
        } else if (byte >= 0x80 && byte <= 0x8F) {
            text += `[BLK]`;
            tokens.push({ type: 'block', byte });
            lastWasSpace = false;
            asciiBeforeFP = '';
            asciiStartPos = -1;
            asciiTokenStart = -1;
        } else if (byte < 0x20 && byte !== 0x0E) {
            if (byte === 0x06) {
                text += ',';
                tokens.push({ type: 'text', value: ',' });
            }
            asciiBeforeFP = '';
            asciiStartPos = -1;
            asciiTokenStart = -1;
        }
        i++;
    }
    return { text: text.trim(), tokens, obfuscations };
}

// --- Tokenizer ---

// Build reverse lookup: uppercase keyword → token byte, sorted longest-first
export function buildTokenLookup() {
    const entries = [];
    for (const [code, [keyword]] of Object.entries(BASIC_TOKENS)) {
        entries.push({ keyword: keyword.toUpperCase(), code: parseInt(code) });
    }
    // Add alternate spellings
    entries.push({ keyword: 'GOTO', code: 0xEC });
    entries.push({ keyword: 'GOSUB', code: 0xED });
    // Sort longest-first so "GO TO" matches before "GO", "RANDOMIZE" before "RAN" etc.
    entries.sort((a, b) => b.keyword.length - a.keyword.length);
    return entries;
}

// Tokenize a single BASIC line text → Uint8Array of content bytes (without header, with 0x0D terminator)
export function tokenizeLine(text, lookup) {
    const bytes = [];
    let i = 0;
    let inString = false;
    let inREM = false;
    const upper = text.toUpperCase();

    while (i < text.length) {
        const ch = text[i];

        // After REM: everything is literal
        if (inREM) {
            bytes.push(text.charCodeAt(i));
            i++;
            continue;
        }

        // String literals: pass through
        if (ch === '"') {
            inString = !inString;
            bytes.push(0x22);
            i++;
            continue;
        }
        if (inString) {
            bytes.push(text.charCodeAt(i));
            i++;
            continue;
        }

        // Try keyword match (only outside strings/REM)
        let matched = false;
        for (const entry of lookup) {
            const kw = entry.keyword;
            if (upper.substring(i, i + kw.length) === kw) {
                // Boundary check: if keyword starts with a letter, previous char must not be alpha
                if (/[A-Z]/.test(kw[0]) && i > 0 && /[A-Za-z0-9$]/.test(text[i - 1])) {
                    continue;
                }
                // Boundary check: char after keyword must not be alpha (prevent partial match)
                const afterPos = i + kw.length;
                if (/[A-Z]/.test(kw[kw.length - 1]) && afterPos < text.length && /[A-Za-z]/.test(text[afterPos])) {
                    continue;
                }
                bytes.push(entry.code);
                i += kw.length;
                matched = true;
                if (entry.code === 0xEA) inREM = true; // REM
                break;
            }
        }
        if (matched) continue;

        // Number: write ASCII digits, then append 0x0E + encodeFloat5
        if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < text.length && /[0-9]/.test(text[i + 1]))) {
            // Collect the full number string
            let numStr = '';
            let j = i;
            // Optional leading sign is already handled as separate char at this point
            while (j < text.length && /[0-9.eE+\-]/.test(text[j])) {
                // Don't consume +/- unless after E/e
                if ((text[j] === '+' || text[j] === '-') && j > i && !/[eE]/.test(text[j - 1])) {
                    break;
                }
                numStr += text[j];
                j++;
            }
            const num = parseFloat(numStr);
            // Write ASCII digits
            for (let k = 0; k < numStr.length; k++) {
                bytes.push(numStr.charCodeAt(k));
            }
            // Append hidden FP representation
            if (!isNaN(num)) {
                bytes.push(0x0E);
                const fp = encodeFloat5(num);
                for (let k = 0; k < 5; k++) bytes.push(fp[k]);
            }
            i = j;
            continue;
        }

        // Regular character
        bytes.push(text.charCodeAt(i));
        i++;
    }

    bytes.push(0x0D);
    return new Uint8Array(bytes);
}

// Parse multi-line BASIC text → array of { number, text }
export function parseBasicText(text) {
    const lines = [];
    const rawLines = text.split(/\r?\n/);
    for (const raw of rawLines) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        // Match leading line number
        const m = trimmed.match(/^(\d+)\s+(.*)/);
        if (!m) continue;
        const num = parseInt(m[1]);
        if (num < 1 || num > 9999) continue;
        lines.push({ number: num, text: m[2] });
    }
    // Sort by line number
    lines.sort((a, b) => a.number - b.number);
    return lines;
}

// Build complete BASIC program binary from parsed lines
// Returns Uint8Array ready to write at PROG
export function buildBasicProgram(lines, lookup) {
    const allBytes = [];
    for (const line of lines) {
        const content = tokenizeLine(line.text, lookup);
        const contentLen = content.length; // includes 0x0D
        // Line header: lineNum BE, contentLen LE
        allBytes.push((line.number >> 8) & 0xFF);
        allBytes.push(line.number & 0xFF);
        allBytes.push(contentLen & 0xFF);
        allBytes.push((contentLen >> 8) & 0xFF);
        for (let i = 0; i < content.length; i++) {
            allBytes.push(content[i]);
        }
    }
    return new Uint8Array(allBytes);
}
