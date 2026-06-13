// asm-beautify.js - Reformat Z80 assembler source for readability.
// Pure text→text transform used by the ASM editor's Beautify dialog.
// String literals and comments are never altered except for surrounding
// layout; the transform is idempotent (running it twice changes nothing).

// Z80 mnemonics, registers, conditions and common directives - used for
// case folding and flow-control detection. Only tokens in these sets are
// case-folded; labels, identifiers, numbers and strings keep their case.
const INSTRUCTIONS = new Set([
    'ADC', 'ADD', 'AND', 'BIT', 'CALL', 'CCF', 'CP', 'CPD', 'CPDR', 'CPI', 'CPIR',
    'CPL', 'DAA', 'DEC', 'DI', 'DJNZ', 'EI', 'EX', 'EXX', 'HALT', 'IM', 'IN',
    'INC', 'IND', 'INDR', 'INI', 'INIR', 'JP', 'JR', 'LD', 'LDD', 'LDDR', 'LDI',
    'LDIR', 'NEG', 'NOP', 'OR', 'OTDR', 'OTIR', 'OUT', 'OUTD', 'OUTI', 'POP',
    'PUSH', 'RES', 'RET', 'RETI', 'RETN', 'RL', 'RLA', 'RLC', 'RLCA', 'RLD',
    'RR', 'RRA', 'RRC', 'RRCA', 'RRD', 'RST', 'SBC', 'SCF', 'SET', 'SLA', 'SLL',
    'SRA', 'SRL', 'SUB', 'XOR', 'EXA', 'SLI'
]);
const DATA_DIRS = new Set(['DEFB', 'DEFW', 'DEFS', 'DEFM', 'DB', 'DW', 'DS', 'DM', 'BYTE', 'WORD', 'BLOCK']);
const DIRECTIVES = new Set([
    'ORG', 'EQU', 'INCLUDE', 'INCBIN', 'MACRO', 'ENDM', 'REPT', 'ENDR',
    'IF', 'ELSE', 'ENDIF', 'IFDEF', 'IFNDEF', 'ALIGN', 'PHASE', 'DEPHASE',
    'END', 'ASSERT', 'DEVICE', 'SLOT', 'PAGE', 'MODULE', 'ENDMODULE',
    'STRUCT', 'ENDS', 'SECTION', 'OUTPUT', 'DISPLAY', 'DEFINE', 'UNDEFINE',
    'DUP', 'EDUP', 'PROC', 'ENDP', 'ENT', 'DEFL'
]);
const REGISTERS = new Set([
    'A', 'B', 'C', 'D', 'E', 'H', 'L', 'F', 'I', 'R',
    'AF', 'BC', 'DE', 'HL', 'IX', 'IY', 'SP', 'PC',
    'IXH', 'IXL', 'IYH', 'IYL', "AF'"
]);
const CONDITIONS = new Set(['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M']);

// Repeating block instructions - a common place to break for readability
const BLOCK_REPEAT = new Set(['LDIR', 'LDDR', 'CPIR', 'CPDR', 'INIR', 'INDR', 'OTIR', 'OTDR']);

// Words that get case-folded (everything that isn't a user symbol)
const KEYWORDS = new Set([...INSTRUCTIONS, ...DATA_DIRS, ...DIRECTIVES, ...REGISTERS, ...CONDITIONS]);

// Directives that consume the label on their line (label must stay attached)
const LABEL_CONSUMING = new Set(['EQU', '=', 'DEFL', 'MACRO', 'STRUCT', 'PROC']);

// Pseudo-ops without a literal sjasmplus form, normalized to the real thing
const PSEUDO_MAP = {
    'EXA': 'EX AF,AF\'',
    'SLI': 'SLL',
    'SL1': 'SLL'
};

const DEFAULT_OPTS = {
    case: 'upper',          // 'upper' | 'lower' | 'none'
    spaceAfterComma: true,
    splitColon: true,
    labelOwnLine: true,
    blankAfterFlow: true,
    blankAfterBlock: false,
    normalizePseudo: true,
    hexPrefix: 'leave',     // 'leave' | '#' | '$' | '0x' | 'h' - unify hex notation
    binFormat: 'leave',     // 'leave' | '%' | '0b' | 'b' - unify binary notation
    octFormat: 'leave',     // 'leave' | 'o' | 'q' - unify octal notation
    expandMulti: true,      // PUSH AF,HL → one per line; LD H,D,L,E → LD pairs
    indent: true,           // align instructions to indentCol
    indentCol: 8,
    align: false,           // tabular: align operands into a column
    operandCol: 16,         // operand column when align is on
    alignComments: false,   // align trailing comments to commentCol
    commentCol: 32,
    commentSpace: true,     // ensure a space after ';'
    blankBeforeLabel: false,// blank line before each top-level routine label
    trimTrailing: true,
    collapseBlanks: true
};

export function beautify(text, options = {}) {
    const opts = { ...DEFAULT_OPTS, ...options };
    const src = text.replace(/\r\n|\r/g, '\n').split('\n');
    let out = [];

    for (const raw of src) {
        const { code, comment } = splitComment(raw);

        if (code.trim() === '') {
            // blank or comment-only line
            const cm = opts.commentSpace ? normalizeComment(comment) : comment;
            let line2 = code + cm;
            if (opts.trimTrailing) line2 = line2.replace(/\s+$/, '');
            out.push(line2);
            continue;
        }

        const { label, rest } = extractLabel(code);

        // statements separated by top-level ':'
        const stmts = opts.splitColon ? splitStatements(rest) : [rest];

        // does the rest start with a label-consuming directive?
        const firstWord = (rest.match(/^\s*([A-Za-z_.@=][\w.@']*)/) || [])[1];
        const labelConsuming = firstWord && LABEL_CONSUMING.has(firstWord.toUpperCase());

        const emitLabelSeparately = label && opts.labelOwnLine && !labelConsuming &&
            stmts.some(s => s.trim() !== '');

        const cmt = opts.commentSpace ? normalizeComment(comment) : comment;

        // blank line before a top-level routine label (not local '.x')
        if (label && opts.blankBeforeLabel && !label.startsWith('.') &&
            out.length && out[out.length - 1].trim() !== '') {
            out.push('');
        }

        if (label && emitLabelSeparately) {
            out.push(formatLabelLine(label));
        }

        let labelForFirst = (label && !emitLabelSeparately) ? label : null;
        let used = false;

        // expand each statement (multi-register PUSH/POP, chained LD)
        const realStmts = [];
        for (const s of stmts) {
            if (s.trim() === '') continue;
            const ex = opts.expandMulti ? expandStatement(s) : [s];
            for (const e of ex) realStmts.push(e);
        }
        if (realStmts.length === 0) {
            // label-only line (possibly with comment)
            out.push(composeLine(label, null, cmt, opts, true));
            continue;
        }

        for (let i = 0; i < realStmts.length; i++) {
            const isLast = i === realStmts.length - 1;
            const parts = formatStatement(realStmts[i], opts);
            const lbl = (!used && labelForFirst) ? labelForFirst : null;
            used = used || !!lbl;
            const isData = isDataLine(realStmts[i]);
            out.push(composeLine(lbl, parts, isLast ? cmt : '', opts, isData));

            if (isLast && ((opts.blankAfterFlow && isBlockEnd(realStmts[i])) ||
                (opts.blankAfterBlock && BLOCK_REPEAT.has(mnemonicOf(realStmts[i]))))) {
                out.push('__FLOW_BLANK__');
            }
        }
    }

    // resolve flow blanks: insert a single blank unless the next line is
    // already blank or end of file
    const resolved = [];
    for (let i = 0; i < out.length; i++) {
        if (out[i] === '__FLOW_BLANK__') {
            const next = out[i + 1];
            if (next !== undefined && next !== '__FLOW_BLANK__' && next.trim() !== '') {
                resolved.push('');
            }
            continue;
        }
        resolved.push(out[i]);
    }
    out = resolved;

    if (opts.collapseBlanks) {
        const collapsed = [];
        let blanks = 0;
        for (const l of out) {
            if (l.trim() === '') {
                blanks++;
                if (blanks <= 1) collapsed.push('');
            } else {
                blanks = 0;
                collapsed.push(l);
            }
        }
        out = collapsed;
    }

    if (opts.trimTrailing) {
        out = out.map(l => l.replace(/\s+$/, ''));
    }

    return out.join('\n');
}

// ---- line structure -------------------------------------------------------

// Split a line into code and comment. ';' starts a comment unless inside a
// quoted string. Double quotes always delimit; a single quote opens a string
// only when not preceded by an identifier char (so AF' is safe).
export function splitComment(line) {
    let inStr = false, q = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inStr) {
            if (ch === q) inStr = false;
        } else if (ch === '"') { inStr = true; q = '"'; }
        else if (ch === "'" && !/[A-Za-z0-9_')]/.test(line[i - 1] || '')) { inStr = true; q = "'"; }
        else if (ch === ';') return { code: line.slice(0, i), comment: line.slice(i) };
    }
    return { code: line, comment: '' };
}

// Extract a leading column-0 label. A label is the first token when the line
// starts in column 0 and that token is followed by ':' or is not a known
// mnemonic/directive. Returns { label, rest } (rest keeps leading space).
function extractLabel(code) {
    if (/^\s/.test(code)) return { label: '', rest: code };
    const m = code.match(/^([A-Za-z_.@][\w.@']*)(:?)([\s\S]*)$/);
    if (!m) return { label: '', rest: code };
    const word = m[1], colon = m[2], after = m[3];
    if (colon) return { label: word + ':', rest: after };
    // no colon: label only if the word is not a mnemonic/directive
    if (KEYWORDS.has(word.toUpperCase()) || DATA_DIRS.has(word.toUpperCase()) ||
        DIRECTIVES.has(word.toUpperCase())) {
        return { label: '', rest: code };
    }
    return { label: word, rest: after };
}

// Split code on top-level ':' (string-aware). Returns array of statements.
function splitStatements(code) {
    const parts = [];
    let cur = '', inStr = false, q = '';
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if (inStr) {
            cur += ch;
            if (ch === q) inStr = false;
            continue;
        }
        if (ch === '"') { inStr = true; q = '"'; cur += ch; continue; }
        if (ch === "'" && !/[A-Za-z0-9_')]/.test(code[i - 1] || '')) { inStr = true; q = "'"; cur += ch; continue; }
        if (ch === ':') { parts.push(cur); cur = ''; continue; }
        cur += ch;
    }
    parts.push(cur);
    return parts;
}

// ---- statement formatting -------------------------------------------------

// Format a single statement: pseudo-op normalization, case folding, comma
// spacing. Returns { mnem, ops } (both trimmed strings; ops may be '').
function formatStatement(stmt, opts) {
    let s = stmt.trim();
    if (s === '') return { mnem: '', ops: '' };

    // split mnemonic / operands
    const m = s.match(/^(\S+)(\s*)([\s\S]*)$/);
    let mnem = m[1];
    let operands = m[3];

    // pseudo-op normalization (replaces mnemonic and maybe injects operands)
    if (opts.normalizePseudo) {
        const repl = PSEUDO_MAP[mnem.toUpperCase()];
        if (repl) {
            const merged = operands.trim() ? repl + ' ' + operands : repl;
            const m2 = merged.match(/^(\S+)(\s*)([\s\S]*)$/);
            mnem = m2[1];
            operands = m2[3];
        }
    }

    mnem = foldWord(mnem, opts);
    operands = processOperands(operands, opts).trim();

    return { mnem, ops: operands };
}

// Expand multi-register PUSH/POP (PUSH AF,HL,BC → one per line) and chained
// ALASM-style LD (LD H,D,L,E → LD H,D / LD L,E). Returns an array of
// statement strings; usually just [stmt].
function expandStatement(stmt) {
    const m = stmt.trim().match(/^(\S+)\s+([\s\S]*)$/);
    if (!m) return [stmt];
    const mn = m[1].toUpperCase();
    const parts = splitTopLevelCommas(m[2]);

    if ((mn === 'PUSH' || mn === 'POP') && parts.length > 1) {
        const regs = parts.map(p => p.trim());
        if (regs.every(r => /^(AF|BC|DE|HL|IX|IY)$/i.test(r))) {
            return regs.map(r => m[1] + ' ' + r);
        }
    }
    if (mn === 'LD' && parts.length > 2 && parts.length % 2 === 0) {
        const out = [];
        for (let i = 0; i < parts.length; i += 2) {
            out.push(m[1] + ' ' + parts[i].trim() + ',' + parts[i + 1].trim());
        }
        return out;
    }
    return [stmt];
}

// Split on top-level commas (ignores commas inside () and strings).
function splitTopLevelCommas(s) {
    const parts = [];
    let cur = '', depth = 0, inStr = false, q = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) { cur += ch; if (ch === q) inStr = false; continue; }
        if (ch === '"' || (ch === "'" && !/[A-Za-z0-9_')]/.test(s[i - 1] || ''))) { inStr = true; q = ch; cur += ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
    }
    parts.push(cur);
    return parts;
}

// Ensure a space after the leading ';' run: ";text" -> "; text".
// A ";; banner" (semicolons then space) is left as-is.
function normalizeComment(comment) {
    return comment.replace(/^(;+)(?=[^;\s])/, '$1 ');
}

// Case-fold a single word if it's a known keyword; otherwise leave it.
function foldWord(word, opts) {
    if (opts.case === 'none') return word;
    const up = word.toUpperCase();
    if (KEYWORDS.has(up)) {
        return opts.case === 'lower' ? word.toLowerCase() : up;
    }
    return word;
}

// Fold keyword case, normalize comma spacing and hex notation in an operand
// string, leaving string literals untouched.
function processOperands(ops, opts) {
    const hp = opts.hexPrefix && opts.hexPrefix !== 'leave' ? opts.hexPrefix : null;
    const bp = opts.binFormat && opts.binFormat !== 'leave' ? opts.binFormat : null;
    const op = opts.octFormat && opts.octFormat !== 'leave' ? opts.octFormat : null;
    let out = '';
    let i = 0;
    while (i < ops.length) {
        const ch = ops[i];
        // string literal - copy verbatim
        if (ch === '"' || (ch === "'" && !/[A-Za-z0-9_')]/.test(ops[i - 1] || ''))) {
            const q = ch;
            let j = i + 1;
            while (j < ops.length && ops[j] !== q) j++;
            out += ops.slice(i, Math.min(j + 1, ops.length));
            i = j + 1;
            continue;
        }
        if (ch === ',') {
            out = out.replace(/[ \t]+$/, '');
            out += ',';
            if (opts.spaceAfterComma) out += ' ';
            i++;
            while (i < ops.length && (ops[i] === ' ' || ops[i] === '\t')) i++;
            continue;
        }
        // $-prefixed / #-prefixed hex (followed by at least one hex digit).
        // Bare $ (current address) and $+n / $-n are left alone.
        if ((ch === '$' || ch === '#') && hp && /[0-9a-fA-F]/.test(ops[i + 1] || '')) {
            let j = i + 1;
            while (j < ops.length && /[0-9a-fA-F]/.test(ops[j])) j++;
            out += emitHex(ops.slice(i + 1, j), hp);
            i = j;
            continue;
        }
        // %-prefixed binary - but only when % starts a value, not as the
        // modulo operator (COUNT%10 must stay modulo)
        if (ch === '%' && bp && /[01]/.test(ops[i + 1] || '')) {
            const prev = out.replace(/\s+$/, '').slice(-1);
            if (!/[A-Za-z0-9_)$]/.test(prev)) {
                let j = i + 1;
                while (j < ops.length && /[01]/.test(ops[j])) j++;
                out += emitBin(ops.slice(i + 1, j), bp);
                i = j;
                continue;
            }
        }
        // digit-led token: 0x/0b prefixes, h/b/o/q suffixes, or plain decimal
        if (/[0-9]/.test(ch)) {
            let j = i;
            while (j < ops.length && /[0-9a-zA-Z_]/.test(ops[j])) j++;
            const tok = ops.slice(i, j);
            let m;
            if (hp && (m = tok.match(/^0[xX]([0-9a-fA-F]+)$/))) out += emitHex(m[1], hp);
            else if (hp && (m = tok.match(/^([0-9][0-9a-fA-F]*)[hH]$/))) out += emitHex(stripGuardZero(m[1]), hp);
            else if (bp && (m = tok.match(/^0[bB]([01]+)$/))) out += emitBin(m[1], bp);
            else if (bp && (m = tok.match(/^([01]{3,})[bB]$/))) out += emitBin(m[1], bp);   // 1-2 digit Nb is a temp label
            else if (op && (m = tok.match(/^([0-7]+)[oOqQ]$/))) out += emitOct(m[1], op);
            else out += tok;   // decimal, decimal-d, temp labels - untouched
            i = j;
            continue;
        }
        // identifier word
        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < ops.length && /[\w]/.test(ops[j])) j++;
            if (ops[j] === "'") j++;  // AF'
            const word = ops.slice(i, j);
            out += foldWord(word, opts);
            i = j;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

// Drop a single guard zero in front of a hex letter (the 0FFh idiom): the
// leading 0 only exists so the token doesn't start with a letter.
function stripGuardZero(digits) {
    return (digits.length > 1 && digits[0] === '0' && /[a-fA-F]/.test(digits[1]))
        ? digits.slice(1) : digits;
}

// Emit hex digits in the target notation: '#' / '$' / '0x' / 'h' (suffix).
// The suffix form must start with a digit, so a guard zero is added when the
// value begins with a hex letter.
function emitHex(digits, target) {
    if (target === 'h') {
        if (/[a-fA-F]/.test(digits[0])) digits = '0' + digits;
        return digits + 'h';
    }
    if (target === '0x') return '0x' + digits;
    return target + digits;   // '#' or '$'
}

// Emit binary digits as '%' / '0b' prefix or 'b' suffix. The suffix form is
// only valid for 3+ digits (1-2 digit Nb is a temp label), so it is padded.
function emitBin(digits, target) {
    if (target === 'b') {
        while (digits.length < 3) digits = '0' + digits;
        return digits + 'b';
    }
    if (target === '0b') return '0b' + digits;
    return '%' + digits;
}

// Emit octal digits with the chosen suffix ('o' or 'q'); octal has no prefix
// form in sjasmplus.
function emitOct(digits, target) {
    return digits + target;
}

// ---- line composition -----------------------------------------------------

function formatLabelLine(label) {
    return label;   // label already includes ':' if it had one
}

// Compose one output line from a label, a { mnem, ops } parts object (or null
// for a label-only line), and a comment. Honors indent / tabular align /
// comment align.
function composeLine(label, parts, comment, opts, isLabelOnly) {
    const mnemCol = opts.indent ? opts.indentCol : 0;
    const pad = (s, col) => s.length < col ? s + ' '.repeat(col - s.length) : s + ' ';

    let head = '';

    if (label && parts && parts.mnem) {
        head = mnemCol ? pad(label, mnemCol) : label + ' ';
    } else if (label) {
        head = label;          // label-only line
    } else if (parts && parts.mnem) {
        head = opts.indent ? ' '.repeat(mnemCol) : '\t';
    }

    if (parts && parts.mnem) {
        if (parts.ops) {
            if (opts.align) {
                // tabular: operands at operandCol (measured from line start)
                head = pad(head + parts.mnem, opts.operandCol) + parts.ops;
            } else {
                head += parts.mnem + ' ' + parts.ops;
            }
        } else {
            head += parts.mnem;
        }
    }

    if (comment) {
        if (head) {
            if (opts.alignComments) {
                head = head.length < opts.commentCol
                    ? head + ' '.repeat(opts.commentCol - head.length) : head + ' ';
            } else {
                head += ' ';
            }
            head += comment;
        } else {
            head = comment;    // comment-only / comment after bare label handled above
        }
    }
    return head;
}

// ---- flow / data detection ------------------------------------------------

function mnemonicOf(stmt) {
    const m = stmt.trim().match(/^(\S+)/);
    return m ? m[1].toUpperCase() : '';
}

function operandsOf(stmt) {
    const m = stmt.trim().match(/^\S+\s+([\s\S]*)$/);
    return m ? m[1].trim() : '';
}

function isDataLine(stmt) {
    return DATA_DIRS.has(mnemonicOf(stmt));
}

// A statement ends a code block when control leaves unconditionally:
// RET (no condition), JP/JR with no leading condition, RST.
function isBlockEnd(stmt) {
    const mn = mnemonicOf(stmt);
    if (mn === 'RST') return true;
    if (mn === 'RET') return operandsOf(stmt) === '';   // RET cc keeps flowing
    if (mn === 'JP' || mn === 'JR') {
        const ops = operandsOf(stmt);
        const first = (ops.match(/^([A-Za-z]+)\s*,/) || [])[1];
        // conditional if first operand before a comma is a condition
        if (first && CONDITIONS.has(first.toUpperCase())) return false;
        return true;
    }
    return false;
}
