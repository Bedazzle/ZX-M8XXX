// asm-detok.js - Detokenizers for native ZX Spectrum assembler source formats
// Converts tokenized binary sources (as saved by the assemblers on TR-DOS disks)
// into plain dialect text. Algorithms are faithful ports of the xLook v0.2b
// FAR plugin sources (ALASM.CPP, TASM.CPP, STORM.CPP) by Dmitry Kozlov
// (HalfElf) and Alexander Medvedev.
//
// Supported:    ALASM, TASM 3.x, TASM 4.x, STORM
// Recognized but not yet supported: MASM, ZXASM, XAS

// 8-byte machine-code prologue every ALASM source file starts its data with
export const ALASM_SIGNATURE = [0xF3, 0x76, 0xC7, 0xDD, 0xFD, 0xED, 0xB0, 0xD9];

// CP866 (DOS Cyrillic) upper half 0x80-0xFF - comments in TR-DOS era sources
// store Russian text in this codepage
const CP866_HIGH =
    'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп' +
    '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
    'рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■ ';

// Decode a single byte as CP866 text (bytes < 0x80 are plain ASCII)
export function cp866Char(b) {
    return b < 0x80 ? String.fromCharCode(b) : CP866_HIGH[b - 0x80];
}

// KOI8-R upper half 0x80-0xFF
const KOI8_HIGH =
    '─│┌┐└┘├┤┬┴┼▀▄█▌▐░▒▓⌠■∙√≈≤≥ ⌡°²·÷' +
    '═║╒ё╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡Ё╢╣╤╥╦╧╨╩╪╫╬©' +
    'юабцдефгхийклмнопярстужвьызшэщчъ' +
    'ЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧЪ';

// KOI-7 N2: lowercase ASCII positions 0x60-0x7E hold uppercase Cyrillic
const KOI7_LOW = 'ЮАБЦДЕФГХИЙКЛМНОПЯРСТУЖВЬЫЗШЭЩЧ';

// Display-only codepage transform for editor views. Each mapping is
// 1 char -> 1 char so caret/selection offsets stay aligned with the raw text.
// cp: 'cp866' | 'koi8' | 'koi7' (anything else returns the text unchanged)
export function decodeViewCodepage(text, cp) {
    if (cp === 'cp866') {
        return text.replace(/[\u0080-\u00FF]/g, c => CP866_HIGH[c.charCodeAt(0) - 0x80]);
    }
    if (cp === 'koi8') {
        return text.replace(/[\u0080-\u00FF]/g, c => KOI8_HIGH[c.charCodeAt(0) - 0x80]);
    }
    if (cp === 'koi7') {
        // 7-bit encoding: it sacrifices the lowercase Latin range by design
        return text.replace(/[`-~]/g, c => KOI7_LOW[c.charCodeAt(0) - 0x60]);
    }
    return text;
}

// ALASM token tables (codes 0x80-0xE5 for mnemonics in first-token position)
const ALASM_MNEMONICS = [
    'INCLUDE', 'INCBIN', 'MACRO', 'LOCAL', 'RLCA', 'RRCA', 'HALT', 'CALL',
    'PUSH', 'RETN', 'RETI', 'DJNZ', 'OUTI', 'OUTD', 'LDIR', 'CPIR',
    'INIR', 'OTIR', 'LDDR', 'CPDR', 'INDR', 'OTDR', 'DD', 'DEFB',
    'DEFW', 'DEFS', 'DISP', 'ENDM', 'EDUP', 'ENDL', 'MAIN', 'ELSE',
    'DISPLAY', 'EXA', 'DB', 'DW', 'DS', 'NOP', 'INC', 'DEC',
    'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF', 'ADD', 'ADC',
    'SUB', 'SBC', 'AND', 'XOR', 'RET', 'POP', 'RST', 'EXX',
    'RLC', 'RRC', 'SLA', 'SRA', 'SLI', 'SRL', 'BIT', 'RES',
    'SET', 'OUT', 'NEG', 'RRD', 'RLD', 'LDI', 'CPI', 'INI',
    'LDD', 'CPD', 'IND', 'ORG', 'EQU', 'ENT', 'INF', 'DUP',
    'IFN', 'REPEAT', 'UNTIL', 'IF', 'LD', 'JR', 'JP', 'OR',
    'CP', 'EX', 'DI', 'EI', 'IN', 'RL', 'RR', 'IM',
    'ENDIF', 'EXD', 'JNZ', 'JZ', 'JNC', 'JC'
];
const ALASM_REGS1 = ['(BC)', '(DE)', '(HL)', '(SP)', '(IX)', '(IY)'];           // 0x9F-0xA4
const ALASM_REGS2 = ['(C)', '(IX', '(IY', "AF'"];                               // 0xD0-0xD3
const ALASM_REGS3 = ['BC', 'DE', 'HL', 'AF', 'IX', 'IY', 'SP', 'NZ', 'NC',
    'PO', 'PE', 'HX', 'LX', 'HY', 'LY', 'B', 'C', 'D', 'E', 'H', 'L',
    'A', 'P', 'M', 'Z', 'R', 'I'];                                              // 0xE0-0xFA

// TASM token table (codes 0x80+, trailing spaces are part of the token)
const TASM_TOKENS = [
    'A', 'ADC ', 'ADD ', "AF'", 'AF', 'AND ', 'B', 'BC', 'BIT ', 'C', 'CALL ', 'CCF', 'CP ', 'CPD', 'CPDR', 'CPI',
    'CPIR', 'CPL', 'D', 'DAA', 'DE', 'DEC ', 'DEFB ', 'DEFM ', 'DEFS ', 'DEFW ', 'DI', 'PHASE ', 'DJNZ ', 'E', 'EI', 'UNPHASE ',
    'EQU ', 'EX ', 'EXX', 'H', 'HALT', 'HL', 'I', 'IM ', 'IN ', 'INC ', 'IND', 'INDR', 'INI', 'INIR', 'IX', 'IY',
    'JP ', 'JR ', 'L', 'LD ', 'LDD', 'LDDR', 'LDI', 'LDIR', 'M', 'NC', 'NEG', 'NOP', 'NV', 'NZ', 'OR ', 'ORG ',
    'OTDR', 'OTIR', 'OUT ', 'OUTD', 'OUTI', 'P', 'PE', 'PO', 'POP ', 'PUSH ', 'R', 'RES ', 'RET', 'RETI', 'RETN', 'RL ',
    'RLA', 'RLC ', 'RLCA', 'RLD', 'RR ', 'RRA', 'RRC ', 'RRCA', 'RRD', 'RST ', 'SBC ', 'SCF', 'SET ', 'SLA ', 'SP', 'SRA ',
    'SRL ', 'SUB ', 'V', 'XOR ', 'Z', 'INCLUDE ', 'INCBIN ', 'SLI ', 'INF', 'LX', 'HX', 'LY', 'HY', 'DB ', 'DM ', 'DS ',
    'DW ', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?', '?'
];

// STORM token table (codes 0x09-0x8B; array index = code - 9)
const STORM_TOKENS = [
    'ORG', 'EQU', 'DI', 'EI', 'EXA', 'NOP', 'CCF', 'SCF',
    'CPL', 'DAA', 'EXX', 'RLA', 'RRA', 'RLCA', 'RRCA', 'HALT',
    'LDI', 'LDD', 'LDIR', 'LDDR', 'CPI', 'CPD', 'CPIR', 'CPDR',
    'INI', 'IND', 'INIR', 'INDR', 'OUTI', 'OUTD', 'OTIR', 'OTDR',
    'NEG', 'RLD', 'RRD', 'INF', 'RETI', 'RETN', '', 'B',
    'C', 'D', 'E', 'H', 'L', '(HL)', 'A', 'HX',
    'LX', 'HY', 'LY', 'BC', 'DE', 'HL', 'SP', '',
    'DEFB', 'DEFW', 'DEFS', "AF'", 'XH', 'XL', 'YH', 'YL',
    '', 'LD', 'INC', 'DEC', 'EX', 'JR', 'DJNZ', 'JP',
    'CALL', 'RET', 'POP', 'PUSH', 'ADD', 'ADC', 'SUB', 'SBC',
    'AND', 'OR', 'XOR', 'CP', 'IN', 'OUT', 'BIT', 'RES',
    'SET', 'RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLI',
    'SRL', 'IM', 'RST', 'DB', 'DW', 'DS', 'IX', 'IY',
    '(BC)', '(DE)', 'I', 'R', 'AF', '(SP)', '(C)', 'NZ',
    'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M', 'INCL',
    'INCB', 'REPT', 'ENDR', 'IF', 'IFU', 'IFNU', 'IFD', 'IFND',
    'ELSE', 'EIF', 'ENDM'
];

// STORM operator table: infix ops at 0-14, postfix ops at 15-22
const STORM_OPS = [
    '+', '-', '*', '/', '\\', '&', '!', '|',
    '<<', '>>', '<=', '>=', '<', '>', '=',
    '[', ']', '^', '`', '?', '~', '@', "'"
];

// Display names for the UI
export const DETOK_FORMAT_NAMES = {
    alasm: 'ALASM',
    tasm: 'TASM 3.x',
    tasm4: 'TASM 4.x',
    ads: 'ADS',
    storm: 'STORM',
    masm: 'MASM',
    zxasm: 'ZXASM',
    xas: 'XAS',
    text: 'Plain text'
};

// Formats detokenize() can actually decode
export const DETOK_SUPPORTED = ['alasm', 'tasm', 'tasm4', 'ads', 'storm'];

export class AsmDetok {

    // ---- Hobeta wrapper ----------------------------------------------------

    // Parse a 17-byte Hobeta header ($-file). Returns header info + payload,
    // or null if the data does not look Hobeta-wrapped.
    static parseHobeta(bytes) {
        if (!bytes || bytes.length < 17 + 1) return null;
        let name = '';
        for (let i = 0; i < 8; i++) {
            const c = bytes[i];
            if (c < 0x20 || c >= 0x80) return null;
            name += String.fromCharCode(c);
        }
        const type = String.fromCharCode(bytes[8]);
        if (!/^[A-Za-z0-9#!$]$/.test(type)) return null;
        const start = bytes[9] | (bytes[10] << 8);
        const length = bytes[11] | (bytes[12] << 8);
        const sectors = bytes[14];
        if (length === 0 || length > bytes.length - 17) return null;
        // Occupied sectors must cover the declared length
        if (sectors > 0 && sectors * 256 < length) return null;
        return {
            name: name.trimEnd(),
            type,
            start,
            length,
            data: bytes.slice(17, 17 + length)
        };
    }

    // ---- Detection ---------------------------------------------------------

    static findAlasmSignature(bytes, searchLimit = 512) {
        const limit = Math.min(bytes.length - ALASM_SIGNATURE.length, searchLimit);
        for (let i = 0; i <= limit; i++) {
            let match = true;
            for (let j = 0; j < ALASM_SIGNATURE.length; j++) {
                if (bytes[i + j] !== ALASM_SIGNATURE[j]) { match = false; break; }
            }
            if (match) return i;
        }
        return -1;
    }

    // Validate TASM line framing: len, content[len], len, ... terminated by 0xFF
    // Returns number of valid lines found (0 = not TASM)
    // Empty lines (len 0) frame trivially - any run of zero bytes chains as
    // valid empty lines (SCREEN$ data fooled this) - so only non-empty lines
    // count as evidence.
    static checkTasmFraming(bytes) {
        let p = 0, lines = 0, evidence = 0;
        while (p < bytes.length) {
            const len = bytes[p++];
            if (len === 0xFF) return (lines >= 3 && evidence >= 3) ? lines : 0;
            if (p + len >= bytes.length) break;
            // A run of N identical bytes frames as "len=N, content=N..., repeat=N"
            // (uniform fills like a SCREEN$ attribute area) - such degenerate
            // lines are not evidence of TASM
            let degenerate = true;
            for (let i = 0; i < len; i++) {
                if (bytes[p + i] !== len) { degenerate = false; break; }
            }
            p += len;
            if (bytes[p] !== len) break;   // trailing repeat of the length byte
            p++;
            lines++;
            if (len > 0 && !degenerate) evidence++;
        }
        // Accept truncated files that framed cleanly for a good while
        return (lines >= 8 && evidence >= 3) ? lines : 0;
    }

    // Validate ADS line framing: u16 line number (strictly ascending),
    // content bytes, 0x00 terminator. Returns number of valid lines.
    static checkAdsFraming(bytes) {
        let p = 0, lines = 0, prev = -1, tokens = 0;
        while (p + 2 < bytes.length) {
            const lineno = bytes[p] | (bytes[p + 1] << 8);
            if (lineno === 0 || lineno === 0xFFFF) break;   // end marker / padding
            if (lineno <= prev) return 0;
            prev = lineno;
            p += 2;
            const start = p;
            while (p < bytes.length && bytes[p] !== 0) {
                if (bytes[p] >= 0x80) tokens++;
                p++;
            }
            if (p >= bytes.length) break;
            if (p - start > 240) return 0;      // implausibly long line
            p++;
            lines++;
        }
        return (lines >= 4 && tokens >= 3) ? lines : 0;
    }

    // Detect the source format.
    //   bytes - file payload (Hobeta header already stripped if present)
    //   meta  - optional TR-DOS catalog info: { type: 'A', start: 39221 }
    // Returns { format, supported, source } or null.
    static detect(bytes, meta = null) {
        if (!bytes || bytes.length < 4) return null;

        // ALASM has an unambiguous signature regardless of catalog metadata
        if (this.findAlasmSignature(bytes) >= 0) {
            return { format: 'alasm', supported: true, source: 'signature' };
        }

        if (meta && meta.type) {
            const t = meta.type;
            const start = meta.start | 0;
            const t1 = start & 0xFF, t2 = (start >> 8) & 0xFF;
            const c1 = String.fromCharCode(t1), c2 = String.fromCharCode(t2);

            if (t === 'A' && (start === 39221 || start === 40872 || start <= 4096)) {
                return { format: start <= 4096 ? 'tasm4' : 'tasm', supported: true, source: 'catalog' };
            }
            if (t === 'a' && (start === 38667 || start === 38821)) {
                return { format: 'masm', supported: false, source: 'catalog' };
            }
            if ((t === 'C' && (start === 0xC00B || start === 0xC003)) ||
                (t === 'R' && start === 0xC00B)) {
                return { format: 'storm', supported: true, source: 'catalog' };
            }
            if ((t === 'a' && c1 === 's' && c2 === 'm') ||
                (t === 'a' && c1 === ' ' && c2 === ' ') ||
                (t === 'z' && c1 === 'a' && c2 === 's') ||
                (t === 'C' && start === 35151) ||
                (t === 'a' && start === 28001)) {
                return { format: 'zxasm', supported: false, source: 'catalog' };
            }
            if ((t === 'X' || t === 'x') && (c1 === 'A' || c1 === 'a') && c2 === 'S') {
                return { format: 'xas', supported: false, source: 'catalog' };
            }
        }

        if (this.isMostlyText(bytes)) {
            return { format: 'text', supported: true, source: 'heuristic' };
        }

        // ADS: u16 ascending line numbers (checked before TASM - stricter)
        if (this.checkAdsFraming(bytes) > 0) {
            return { format: 'ads', supported: true, source: 'heuristic' };
        }

        // No metadata: try TASM line framing on raw bytes
        if (this.checkTasmFraming(bytes) > 0) {
            // TASM 3 indents with 0x0A+count, TASM 4 with 0x01+count
            let c0A = 0, c01 = 0;
            for (let i = 0; i < Math.min(bytes.length, 2048); i++) {
                if (bytes[i] === 0x0A) c0A++;
                else if (bytes[i] === 0x01) c01++;
            }
            return { format: c01 > c0A ? 'tasm4' : 'tasm', supported: true, source: 'heuristic' };
        }

        return null;
    }

    static isMostlyText(bytes) {
        const n = Math.min(bytes.length, 512);
        if (n === 0) return false;
        let printable = 0;
        for (let i = 0; i < n; i++) {
            const b = bytes[i];
            if ((b >= 0x20 && b < 0x80) || b === 0x0A || b === 0x0D || b === 0x09) printable++;
        }
        return printable / n > 0.95;
    }

    // ---- Detokenizers ------------------------------------------------------

    static detokenize(bytes, format) {
        switch (format) {
            case 'alasm': return this.detokenizeAlasm(bytes);
            case 'tasm':  return this.detokenizeTasm(bytes, false);
            case 'tasm4': return this.detokenizeTasm(bytes, true);
            case 'ads':   return this.detokenizeAds(bytes);
            case 'storm': return this.detokenizeStorm(bytes);
            default:
                return { text: null, warnings: [`Format "${format}" is not supported for detokenization`] };
        }
    }

    // ADS (TASM-family editor): each line is a 16-bit line number, content
    // bytes, 0x00 terminator; zero line number / padding ends the file.
    // Content uses the TASM token table and TASM 3 space runs (0x0A+count).
    static detokenizeAds(bytes) {
        const warnings = [];
        let p = 0;
        let result = '';

        while (p + 2 < bytes.length) {
            const lineno = bytes[p] | (bytes[p + 1] << 8);
            if (lineno === 0 || lineno === 0xFFFF) break;   // end marker / padding
            p += 2;

            let line = '';
            while (p < bytes.length && bytes[p] !== 0) {
                const b = bytes[p];
                if (b < 0x20) {
                    if (b === 0x0A && p + 1 < bytes.length && bytes[p + 1] !== 0) {
                        p++;
                        line += ' '.repeat(bytes[p]);
                    } else {
                        line += String.fromCharCode(b);
                    }
                } else if (b < 0x80) {
                    line += String.fromCharCode(b);
                } else {
                    line += TASM_TOKENS[b - 0x80];
                }
                p++;
            }
            if (p >= bytes.length) {
                warnings.push('ADS file ends without line terminator - file may be truncated');
            }
            p++;
            result += line + '\n';
        }

        return { text: result, warnings };
    }

    // ALASM: lines start 24 bytes after the signature.
    // Each line: length byte (0 = end of source), then length-1 content bytes.
    static detokenizeAlasm(bytes) {
        const warnings = [];
        const sigPos = this.findAlasmSignature(bytes);
        if (sigPos < 0) {
            return { text: null, warnings: ['ALASM signature not found'] };
        }
        let p = sigPos + ALASM_SIGNATURE.length + 16;
        let result = '';

        while (p < bytes.length) {
            const len = bytes[p++];
            if (len === 0) break;

            let comment = false;
            let string = false;
            let russian = false;
            let tabUsed = false;
            let firstToken = true;
            let pos = 0;
            let line = '';

            for (let j = 0; j < len - 1 && p < bytes.length; j++) {
                const b = bytes[p++];
                if (b === 0xFF) continue;

                if (comment || russian) {
                    if (b < 0x20) continue;
                    line += cp866Char(b);   // Russian comments are CP866
                    pos++;
                    continue;
                }
                if (string) {
                    // strings affect assembled bytes - keep them byte-exact
                    if (b === 0x22) string = false;
                    if (b < 0x20) continue;
                    line += String.fromCharCode(b);
                    pos++;
                    continue;
                }

                if (b === 0x3B) comment = true;     // ';' starts a comment (char is kept)
                if (b === 0x22) string = true;      // '"' starts a string (char is kept)
                if (b === 0x10) {                   // Russian text until end of line
                    russian = true;
                    continue;
                }
                if (b < 0x10) {                     // compressed run of spaces
                    line += ' '.repeat(b);
                    pos += b;
                    tabUsed = true;
                    continue;
                }

                if (b >= 0x80) {
                    if (firstToken) {
                        firstToken = false;
                        if (pos < 8 && !tabUsed) {
                            line += ' '.repeat(8 - pos);
                            pos = 8;
                        }
                        if (b <= 0xE5) {
                            const tok = ALASM_MNEMONICS[b - 0x80];
                            line += tok + '\t';
                            pos += tok.length + 1;
                        }
                    } else {
                        if (b >= 0x9F && b <= 0xA4) {
                            line += ALASM_REGS1[b - 0x9F];
                            pos += ALASM_REGS1[b - 0x9F].length;
                        } else if (b >= 0xD0 && b <= 0xD3) {
                            line += ALASM_REGS2[b - 0xD0];
                            pos += ALASM_REGS2[b - 0xD0].length;
                        } else if (b >= 0xE0 && b <= 0xFA) {
                            line += ALASM_REGS3[b - 0xE0];
                            pos += ALASM_REGS3[b - 0xE0].length;
                        }
                        // other high bytes are dropped (matches xLook behavior)
                    }
                    continue;
                }

                line += String.fromCharCode(b);
                pos++;
            }

            // ALASM allows a string literal to run to end of line without a
            // closing quote (DB "w, as opcode bytes) - close it for sjasmplus
            if (string) line += '"';

            result += line + '\n';
        }

        return { text: result, warnings };
    }

    // TASM: each line is "length, content[length], length" - terminated by 0xFF.
    // Control bytes < 0x20 encode runs of spaces (0x0A+count in TASM 3,
    // 0x01+count in TASM 4). Bytes >= 0x80 are table tokens.
    static detokenizeTasm(bytes, isTasm4) {
        const warnings = [];
        let p = 0;
        let result = '';

        while (p < bytes.length) {
            const len = bytes[p++];
            if (len === 0xFF) break;

            let line = '';
            for (let i = 0; i < len && p < bytes.length; i++) {
                const b = bytes[p];
                if (b < 0x20) {
                    if (isTasm4 || (b === 0x0A && i !== len - 1)) {
                        if (!isTasm4 || b === 0x01) {
                            p++;
                            i++;
                        }
                        if (p < bytes.length) line += ' '.repeat(bytes[p]);
                    } else {
                        line += String.fromCharCode(b);
                    }
                } else if (b < 0x80) {
                    line += String.fromCharCode(b);
                } else {
                    let tok;
                    if (isTasm4) {
                        // TASM 4 reassigns three token codes
                        if (b === 0x97) tok = 'DEFMAC ';
                        else if (b === 0x9B) tok = 'DISPLAY ';
                        else if (b === 0x9F) tok = 'ENDMAC ';
                        else tok = TASM_TOKENS[b - 0x80];
                    } else {
                        tok = TASM_TOKENS[b - 0x80];
                    }
                    line += tok;
                }
                p++;
            }

            result += line + '\n';

            // each line ends with a repeat of its length byte
            if (p >= bytes.length) break;
            if (bytes[p] !== len) {
                if (p < bytes.length - 1) {
                    warnings.push(`TASM line framing broken at offset ${p} - file may be truncated`);
                }
                break;
            }
            p++;
        }

        return { text: result, warnings };
    }

    // STORM: lines are stored back to front - each line ends with a byte
    // whose low 6 bits give the line length, so the line table is walked
    // from the end of the file. Line content is fully tokenized including
    // expressions (numbers in 8 formats, bit-packed labels, operators).
    static detokenizeStorm(bytes) {
        const warnings = [];
        const T = STORM_TOKENS;
        const AR = STORM_OPS;

        // collect line offsets from the end backwards
        const lineList = [];
        let p = bytes.length - 1;
        while (p > 0) {
            const len = bytes[p] & 0x3F;
            lineList.push({ start: p - len, len });
            p -= len + 1;
        }
        if (p < -1) {
            warnings.push('STORM line table does not align - file may be truncated');
        }
        lineList.reverse();

        const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');
        const bin8 = (b) => b.toString(2).padStart(8, '0');

        let result = '';

        for (const { start, len } of lineList) {
            if (start < 0) continue;
            let out = '';
            let i = start;
            const lineEnd = start + len;

            const fillTo = (n) => { while (out.length < n) out += ' '; };

            // text until 0x00; bytes <= 0x1F are runs of spaces
            const printString = (j, isComment) => {
                while (j < bytes.length && bytes[j]) {
                    const b = bytes[j];
                    if (b <= 0x1F) out += ' '.repeat(b);
                    else out += isComment ? cp866Char(b) : String.fromCharCode(b);
                    j++;
                }
                return j + 1;
            };

            // bit-packed label: first char in 0xC0+, then 6-bit chars,
            // terminated by a byte with bit 7 set (which is still decoded)
            const printLabel = (j) => {
                const b = bytes[j];
                if (b === 0xDA) out += '_';
                else if (b > 0xDA) out += '=';
                else out += String.fromCharCode(b - 0x7F);
                let cur;
                do {
                    j++;
                    cur = bytes[j];
                    const c = cur & 0x3F;
                    if (c <= 0x09) out += String.fromCharCode(0x30 + c);
                    else if (c === 0x0B) out += '_';
                    else if (c === 0x0A) { /* end of one-char label */ }
                    else if (c < 0x26) out += String.fromCharCode(c - 0x0C + 0x41);
                    else out += String.fromCharCode(c - 0x26 + 0x61);
                } while (j < bytes.length && cur < 0x80);
                return j + 1;
            };

            // recursive expression decoder: alternates number and operator
            // phases; bit 3 of the descriptor marks the last element
            const printExpr = (j, op, number) => {
                while (true) {
                    if (number) {
                        switch (op & 0x07) {
                            case 0: {                       // parenthesized subexpression
                                out += '(';
                                const b = bytes[j++];
                                j = printExpr(j, b, !(op & 0x10));
                                out += ')';
                                break;
                            }
                            case 1:                          // hex byte
                                out += '#' + hex2(bytes[j++]);
                                break;
                            case 2:                          // decimal byte
                                out += String(bytes[j++]);
                                break;
                            case 3:                          // $ / local ref / label
                                if (bytes[j] < 0xC0) {
                                    let b = bytes[j++];
                                    if (b === 0) out += '$';
                                    else {
                                        b--;
                                        b &= 0x07;
                                        out += '=' + String.fromCharCode(0x30 + b);
                                    }
                                } else {
                                    j = printLabel(j);
                                }
                                break;
                            case 4:                          // char constant (1-2 chars)
                                out += '"';
                                if (bytes[j + 1] !== 0) out += String.fromCharCode(bytes[j + 1]);
                                out += String.fromCharCode(bytes[j]);
                                j += 2;
                                out += '"';
                                break;
                            case 5:                          // hex word
                                out += '#' + hex2(bytes[j + 1]) + hex2(bytes[j]);
                                j += 2;
                                break;
                            case 6:                          // decimal word
                                out += String(256 * bytes[j + 1] + bytes[j]);
                                j += 2;
                                break;
                            case 7:                          // binary (1-2 bytes)
                                out += '%';
                                if (bytes[j + 1] !== 0) out += bin8(bytes[j + 1]);
                                out += bin8(bytes[j]);
                                j += 2;
                                break;
                        }
                        number = false;
                        if (op & 0x08) break;
                        op = bytes[j++];
                    } else {
                        const saved = op;
                        if ((op & 0xF0) !== 0xF0) {
                            out += AR[(op & 0xF0) >> 4];     // infix operator
                            op = saved;
                            number = true;
                        } else {
                            out += AR[0x0F + (op & 0x07)];   // postfix operator
                            number = false;
                            if (saved & 0x08) break;
                            op = bytes[j++];
                        }
                    }
                }
                return j;
            };

            // mnemonic; several ranges encode the command implicitly and do
            // not consume the byte (it doubles as the first operand)
            const printCommand = (j, indent) => {
                if (indent) fillTo(8);
                const b = bytes[j];
                if (b >= 0x09 && b < 0x2F) { out += T[b - 9]; j++; }
                else if (b > 0x2F && b < 0x40) out += 'LD';
                else if (b >= 0x40 && b < 0x6F) {
                    if (b === 0x49) {                        // extended directives (INCL..ENDM)
                        out += T[bytes[j + 1] + 0x80 - 9] || '?';
                        j += 2;
                    } else {
                        out += T[b - 9];
                        j++;
                    }
                }
                else if (b >= 0x6F && b < 0x75) out += 'LD';
                else if (b >= 0x75 && b < 0x77) out += 'EX';
                else if (b === 0x77) out += 'OUT';
                else if (b > 0x77 && b < 0x7C) out += 'JR';
                else if (b >= 0x7C && b < 0x80) out += 'CALL';
                else if (b >= 0x80 && b < 0xDC) out += (b & 0x20) ? 'LD' : 'JR';
                else if (b === 0xDC) out += 'DB';
                else if (b > 0xDC) out += 'JR';
                return j;
            };

            if (len === 0) {
                result += '\n';
                continue;
            }

            if (bytes[i] === 0x2F) {                         // comment line
                out += ';';
                printString(i + 1, true);
                result += out + '\n';
                continue;
            }

            let indent = true;
            const b0 = bytes[i];
            if (b0 >= 0xC0 && b0 < 0xDC) {
                if (bytes[i + 1] & 0x40) i = printLabel(i);
            } else if (b0 === 0x06) {
                out += '_';
                i++;
                indent = false;
            } else if (b0 === 0x07) {
                out += '.' + bytes[i + 1];
                i += 2;
            }

            let done = lineEnd - i <= 0;

            while (!done) {                                  // command groups split by ':'
                i = printCommand(i, indent);
                indent = false;

                let separator = ' ';
                let nextCommand = false;

                while (true) {                               // operand loop
                    if (lineEnd - i <= 0) { done = true; break; }

                    if (bytes[i] === 0x2F) {                 // inline comment
                        out += ';';
                        printString(i + 1, true);
                        done = true;
                        break;
                    }
                    if (bytes[i] < 0x80) {
                        const m = bytes[i] & 0x3F;
                        if (m >= 0x2A && m < 0x2F) {         // statement separators
                            out += [':', ' :', ' : ', ' :  ', '  : '][m - 0x2A];
                            i++;
                            nextCommand = true;
                            break;
                        }
                    }

                    out += separator;
                    separator = ',';

                    const b = bytes[i];
                    if (b < 0x80) {                          // register/condition token
                        out += T[b - 9] || '?';
                        i++;
                    } else if (b < 0xC0) {                   // expression
                        let e = bytes[i++];
                        const needBrackets = !!(e & 0x20);
                        if (needBrackets) out += '(';
                        let number = true;
                        if (!needBrackets) {
                            number = !(e & 0x10);
                            if (!number) e &= 0x1F;
                        }
                        if (needBrackets && (e & 0x10)) {    // (IX+d) / (IY+d)
                            out += 'I' + ((e & 0x08) ? 'Y' : 'X');
                            e &= 0x07;
                            if (!e) {
                                out += ')';
                                continue;
                            }
                            if ((e & 0x03) === 0) {
                                e = bytes[i++];
                            } else {
                                if (e & 0x04) e = (e & 0x03) | 0x10;
                                e |= 0x08;
                            }
                            number = false;
                        } else if (!number) {
                            e &= 0x1F;
                        }
                        i = printExpr(i, e, number);
                        if (needBrackets) out += ')';
                    } else if (b <= 0xDB) {                  // label reference
                        i = printLabel(i);
                    } else if (b === 0xDC) {                 // quoted string
                        out += '"';
                        i = printString(i + 1, false);
                        out += '"';
                    } else if (b <= 0xE6) {                  // single digit
                        out += String.fromCharCode(b - 0xAD);
                        i++;
                    } else {                                 // $ +/- offset
                        out += '$';
                        if (b < 0xF3) out += '-' + (0xF3 - b);
                        else if (b > 0xF3) out += '+' + (b - 0xF3);
                        i++;
                    }
                }
            }

            result += out + '\n';
        }

        return { text: result, warnings };
    }
}
