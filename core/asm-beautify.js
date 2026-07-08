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
    // Per-width base conversion (precedence over the notation options below).
    // A literal is a "byte" if its value ≤ $FF, else a "word". Each width picks
    // its target base independently — e.g. byteBase 'dec' + wordBase 'hex' keeps
    // 8-bit values decimal while turning addresses into hex.
    byteBase: 'leave',      // 'leave' | 'hex' | 'dec' - base for values ≤ $FF
    wordBase: 'leave',      // 'leave' | 'hex' | 'dec' - base for values $100..$FFFF+
    hexPadBytes: false,     // pad byte-range hex (≤ $FF) to 2 digits: $5 → $05
    hexPadWords: false,     // pad word-range hex ($100..$FFFF) to 4 digits: $100 → $0100
    hexPrefix: 'leave',     // 'leave' | '#' | '$' | '0x' | 'h' - unify hex notation
    binFormat: 'leave',     // 'leave' | '%' | '0b' | 'b' - unify binary notation
    octFormat: 'leave',     // 'leave' | 'o' | 'q' - unify octal notation
    // Annotate each numeric operand in the trailing comment with its value in
    // the *other* base: a decimal literal gets a hex note, a hex/binary/octal
    // literal gets a decimal note (e.g. LD HL,1234 → "; 1234=$04D2";
    // OUT ($FE),A → "; $FE=254"). Hex output follows hexPrefix (else '$') and
    // is padded to 2/4 digits. Decimal literals ≤ 9 are skipped (dec and hex
    // coincide). Idempotent (a prior note is stripped before re-adding).
    // The value is the mode, which also governs lines that ALREADY have a
    // comment:
    //   'off'     - feature disabled
    //   'add'     - append the note in parentheses after the existing comment
    //   'replace' - discard the existing comment, keep only the note
    //   'skip'    - leave a commented line alone (bare lines still annotated)
    annotateBase: 'off',
    // Generate labels for current-address-relative jumps (JR/JP/DJNZ/… $±N).
    // Resolves the target line by summing instruction byte sizes, inserts a
    // label there (reusing an existing global label if present), and rewrites
    // the operand. Backward JR/JP/DJNZ → 'back_N', forward → 'fwd_N', any
    // other instruction (CALL, LD, …) → 'addr_N'. Only resolves when every
    // line in the span has a known size and the target lands on an instruction
    // boundary; anything uncertain is left as-is. Idempotent.
    genJumpLabels: false,
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
    // Pre-pass: turn $±N relative jumps into named labels before the operand
    // transforms (base conversion etc.) run, so offsets aren't rewritten.
    let input = opts.genJumpLabels ? generateJumpLabels(text, opts) : text;
    const src = input.replace(/\r\n|\r/g, '\n').split('\n');
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
            let lineComment = isLast ? cmt : '';
            if (opts.annotateBase && opts.annotateBase !== 'off') {
                const note = buildBaseNote(parts.ops, opts);
                lineComment = mergeBaseNote(stripBaseNote(lineComment), note, opts.annotateBase);
            }
            out.push(composeLine(lbl, parts, lineComment, opts, isData));

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
    // Per-width base conversion: a literal's target base is byteBase (value ≤ $FF)
    // or wordBase (larger). Notation for hex output: the chosen hex prefix, else '$'.
    const byteBase = opts.byteBase || 'leave';
    const wordBase = opts.wordBase || 'leave';
    const hexNotation = hp || '$';
    // Convert one recognised numeric literal to its width's target base. `kind` is
    // the source base ('hex'|'bin'|'oct'|'dec'); `digits` the bare digits; `tok`
    // the original text (returned verbatim when the target base is 'leave' and no
    // notation change applies to it).
    const convNum = (value, kind, digits, tok) => {
        const target = value <= 0xFF ? byteBase : wordBase;
        if (target === 'dec') return value.toString(10);
        if (target === 'hex') return emitHex(padHex(value.toString(16).toUpperCase(), opts), hexNotation);
        // target === 'leave': keep the source base, apply notation unification for it
        if (kind === 'hex') return hp ? emitHex(padHex(digits, opts), hp) : tok;
        if (kind === 'bin') return bp ? emitBin(digits, bp) : tok;
        if (kind === 'oct') return op ? emitOct(digits, op) : tok;
        return tok;   // decimal stays decimal
    };
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
        // current-address-relative offset ($+n / $-n) — never a convertible
        // literal, so copy the whole token verbatim (protects jump offsets).
        if (ch === '$' && (ops[i + 1] === '+' || ops[i + 1] === '-')) {
            let j = i + 2;
            while (j < ops.length && /[$#%0-9A-Za-z_]/.test(ops[j])) j++;
            out += ops.slice(i, j);
            i = j;
            continue;
        }
        // $-prefixed / #-prefixed hex (followed by at least one hex digit).
        // Bare $ (current address) and $+n / $-n are left alone.
        if ((ch === '$' || ch === '#') && /[0-9a-fA-F]/.test(ops[i + 1] || '')) {
            let j = i + 1;
            while (j < ops.length && /[0-9a-fA-F]/.test(ops[j])) j++;
            const digits = ops.slice(i + 1, j);
            out += convNum(parseInt(digits, 16), 'hex', digits, ops.slice(i, j));
            i = j;
            continue;
        }
        // %-prefixed binary - but only when % starts a value, not as the
        // modulo operator (COUNT%10 must stay modulo)
        if (ch === '%' && /[01]/.test(ops[i + 1] || '')) {
            const prev = out.replace(/\s+$/, '').slice(-1);
            if (!/[A-Za-z0-9_)$]/.test(prev)) {
                let j = i + 1;
                while (j < ops.length && /[01]/.test(ops[j])) j++;
                const digits = ops.slice(i + 1, j);
                out += convNum(parseInt(digits, 2), 'bin', digits, ops.slice(i, j));
                i = j;
                continue;
            }
        }
        // digit-led token: 0x/0b prefixes, h/b/o/q suffixes, or plain decimal
        if (/[0-9]/.test(ch)) {
            let j = i;
            while (j < ops.length && /[0-9a-zA-Z_]/.test(ops[j])) j++;
            const tok = ops.slice(i, j);
            let m, dg;
            if (m = tok.match(/^0[xX]([0-9a-fA-F]+)$/)) out += convNum(parseInt(m[1], 16), 'hex', m[1], tok);
            else if (m = tok.match(/^([0-9][0-9a-fA-F]*)[hH]$/)) { dg = stripGuardZero(m[1]); out += convNum(parseInt(dg, 16), 'hex', dg, tok); }
            else if (m = tok.match(/^0[bB]([01]+)$/)) out += convNum(parseInt(m[1], 2), 'bin', m[1], tok);
            else if (m = tok.match(/^([01]{3,})[bB]$/)) out += convNum(parseInt(m[1], 2), 'bin', m[1], tok);   // 1-2 digit Nb is a temp label
            else if (m = tok.match(/^([0-7]+)[oOqQ]$/)) out += convNum(parseInt(m[1], 8), 'oct', m[1], tok);
            else if (m = tok.match(/^([0-9]+)[dD]?$/)) out += convNum(parseInt(m[1], 10), 'dec', m[1], tok);   // decimal or explicit Nd
            else out += tok;   // temp labels, mixed identifiers - untouched
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

// Base conversion helpers (value-preserving). hexToDec parses hex digits to a
// decimal string; decToHex emits a decimal string as uppercase hex in the given
// notation (reusing emitHex for the guard-zero / prefix rules).
// Pad hex digits to a fixed width by value class when the matching option is on:
// a byte value (≤ $FF) to 2 digits, a word value ($100..$FFFF) to 4. Values over
// $FFFF are left as-is. 'byte' and 'word' are the standard Z80 terms (DB/DW).
function padHex(digits, opts) {
    const val = parseInt(digits, 16);
    let w = 0;
    if (val <= 0xFF) { if (opts.hexPadBytes) w = 2; }
    else if (val <= 0xFFFF) { if (opts.hexPadWords) w = 4; }
    return (w && digits.length < w) ? digits.padStart(w, '0') : digits;
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

// ---- base annotation (other-system note in the comment) -------------------

// Scan an operand string for numeric literals, using the same recognition
// rules as processOperands (strings, $ current-address, % modulo, temp labels
// and AF' are all skipped). Returns [{ value, kind, token }] in order, where
// `kind` is the source base ('hex'|'bin'|'oct'|'dec') and `token` is the
// literal exactly as it appears.
function scanLiterals(ops) {
    const lits = [];
    let i = 0, prev = '';
    while (i < ops.length) {
        const ch = ops[i];
        // string literal - skip verbatim
        if (ch === '"' || (ch === "'" && !/[A-Za-z0-9_')]/.test(ops[i - 1] || ''))) {
            const q = ch; let j = i + 1;
            while (j < ops.length && ops[j] !== q) j++;
            i = j + 1; prev = q; continue;
        }
        // current-address-relative offset ($+n / $-n) — not a literal, skip it
        if (ch === '$' && (ops[i + 1] === '+' || ops[i + 1] === '-')) {
            let j = i + 2;
            while (j < ops.length && /[$#%0-9A-Za-z_]/.test(ops[j])) j++;
            prev = ops[j - 1] || ''; i = j; continue;
        }
        // $-prefixed / #-prefixed hex (bare $ and $+n are left alone)
        if ((ch === '$' || ch === '#') && /[0-9a-fA-F]/.test(ops[i + 1] || '')) {
            let j = i + 1;
            while (j < ops.length && /[0-9a-fA-F]/.test(ops[j])) j++;
            const digits = ops.slice(i + 1, j);
            lits.push({ value: parseInt(digits, 16), kind: 'hex', token: ops.slice(i, j) });
            prev = ops[j - 1]; i = j; continue;
        }
        // %-prefixed binary - not the modulo operator
        if (ch === '%' && /[01]/.test(ops[i + 1] || '') && !/[A-Za-z0-9_)$]/.test(prev)) {
            let j = i + 1;
            while (j < ops.length && /[01]/.test(ops[j])) j++;
            const digits = ops.slice(i + 1, j);
            lits.push({ value: parseInt(digits, 2), kind: 'bin', token: ops.slice(i, j) });
            prev = ops[j - 1]; i = j; continue;
        }
        // digit-led token: 0x/0b prefixes, h/b/o/q/d suffixes, or plain decimal
        if (/[0-9]/.test(ch)) {
            let j = i;
            while (j < ops.length && /[0-9a-zA-Z_]/.test(ops[j])) j++;
            const tok = ops.slice(i, j);
            let m, dg;
            if (m = tok.match(/^0[xX]([0-9a-fA-F]+)$/)) lits.push({ value: parseInt(m[1], 16), kind: 'hex', token: tok });
            else if (m = tok.match(/^([0-9][0-9a-fA-F]*)[hH]$/)) { dg = stripGuardZero(m[1]); lits.push({ value: parseInt(dg, 16), kind: 'hex', token: tok }); }
            else if (m = tok.match(/^0[bB]([01]+)$/)) lits.push({ value: parseInt(m[1], 2), kind: 'bin', token: tok });
            else if (m = tok.match(/^([01]{3,})[bB]$/)) lits.push({ value: parseInt(m[1], 2), kind: 'bin', token: tok });
            else if (m = tok.match(/^([0-7]+)[oOqQ]$/)) lits.push({ value: parseInt(m[1], 8), kind: 'oct', token: tok });
            else if (m = tok.match(/^([0-9]+)[dD]?$/)) lits.push({ value: parseInt(m[1], 10), kind: 'dec', token: tok });
            // else: temp label / mixed identifier - not a literal
            prev = ops[j - 1] || ''; i = j; continue;
        }
        // identifier word (incl. trailing AF')
        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < ops.length && /[\w]/.test(ops[j])) j++;
            if (ops[j] === "'") j++;
            prev = ops[j - 1] || ''; i = j; continue;
        }
        if (!/\s/.test(ch)) prev = ch;
        i++;
    }
    return lits;
}

// Hex notation used inside annotation comments: follow the hexPrefix option,
// defaulting to '$' when it's 'leave'.
function commentHexNotation(opts) {
    return (opts.hexPrefix && opts.hexPrefix !== 'leave') ? opts.hexPrefix : '$';
}

// Uppercase hex digits, padded to the natural width (byte→2, word→4) so
// annotation values line up regardless of the hexPad* code options.
function commentPadHex(value) {
    let h = value.toString(16).toUpperCase();
    if (value <= 0xFF) h = h.padStart(2, '0');
    else if (value <= 0xFFFF) h = h.padStart(4, '0');
    return h;
}

// Convert one literal to its "other" base as a display string, or null when it
// should be skipped: decimal → hex; hex/binary/octal → decimal. A value ≤ 9
// coming from decimal or hex is skipped (the two bases coincide there).
function convertOtherBase(lit, opts) {
    if (lit.kind === 'dec') {
        if (lit.value <= 9) return null;
        return emitHex(commentPadHex(lit.value), commentHexNotation(opts));
    }
    if (lit.kind === 'hex' && lit.value <= 9) return null;
    return lit.value.toString(10);
}

// Build the "other base" note for a line's operands, e.g. "1234=$04D2" or
// "$FE=254, %1010=10". Empty string when nothing is annotatable.
function buildBaseNote(ops, opts) {
    if (!ops) return '';
    const items = [];
    for (const lit of scanLiterals(ops)) {
        const conv = convertOtherBase(lit, opts);
        if (conv !== null) items.push(lit.token + '=' + conv);
    }
    return items.join(', ');
}

// Recognizer for a previously generated note so it can be stripped before a
// fresh one is added (keeps the transform idempotent). Matches only our own
// "<literal>=<value>" shape, so ordinary prose parentheticals are left intact.
const BASE_NOTE_LIT = '(?:\\$[0-9A-Fa-f]+|#[0-9A-Fa-f]+|0[xX][0-9A-Fa-f]+|%[01]+|[0-9][0-9A-Fa-f]*[hHbBoOqQdD]?)';
const BASE_NOTE_CONV = '(?:\\$[0-9A-Fa-f]+|#[0-9A-Fa-f]+|0[xX][0-9A-Fa-f]+|[0-9A-Fa-f]+[hH]|[0-9]+)';
const BASE_NOTE_ITEMS = BASE_NOTE_LIT + '=' + BASE_NOTE_CONV + '(?:,\\s*' + BASE_NOTE_LIT + '=' + BASE_NOTE_CONV + ')*';
const BASE_NOTE_WHOLE = new RegExp('^;+\\s*' + BASE_NOTE_ITEMS + '\\s*$');
const BASE_NOTE_TRAIL = new RegExp('\\s*\\(' + BASE_NOTE_ITEMS + '\\)\\s*$');

// Remove a prior annotation note, recovering the user's own comment (or '' if
// the whole comment was just a note). Leaves non-note comments untouched.
function stripBaseNote(comment) {
    if (!comment) return comment;
    if (BASE_NOTE_WHOLE.test(comment)) return '';
    return comment.replace(BASE_NOTE_TRAIL, '');
}

// Merge a freshly built note into a comment. `mode` governs the case where a
// (user) comment is already present: 'add' appends in parentheses, 'replace'
// drops it for the note, 'skip' leaves the comment as-is. A line with no
// comment always gets a plain "; note".
function mergeBaseNote(comment, note, mode) {
    if (!note) return comment;
    if (!comment) return '; ' + note;
    if (mode === 'skip') return comment;
    if (mode === 'replace') return '; ' + note;
    return comment + '  (' + note + ')';
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

// ---- relative-jump label generation ---------------------------------------
// Turn current-address-relative jumps (JR/JP/… $±N) into named labels. The
// target line is found by summing instruction byte sizes across the span; a
// label is inserted there (or an existing global label reused) and the operand
// rewritten. Directional names for JR/JP/DJNZ (back_/fwd_), neutral addr_ for
// everything else. Conservative: only resolves when every intervening line has
// a known size and the target lands exactly on an instruction boundary.

const BRANCH_MNEMS = new Set(['JR', 'JP', 'DJNZ']);
// Directives that emit no bytes (safe to cross); anything else unknown is a
// barrier so a span containing it won't resolve.
const ZERO_DIRECTIVES = new Set(['EQU', 'DEFL', '=', 'EQUZ']);

// Parse a bare numeric token (dec/hex/bin/oct) to a value, or null.
function parseIntToken(tok) {
    if (tok == null) return null;
    const t = tok.trim();
    let m;
    if (m = t.match(/^\$([0-9a-fA-F]+)$/)) return parseInt(m[1], 16);
    if (m = t.match(/^#([0-9a-fA-F]+)$/)) return parseInt(m[1], 16);
    if (m = t.match(/^0[xX]([0-9a-fA-F]+)$/)) return parseInt(m[1], 16);
    if (m = t.match(/^([0-9][0-9a-fA-F]*)[hH]$/)) return parseInt(stripGuardZero(m[1]), 16);
    if (m = t.match(/^%([01]+)$/)) return parseInt(m[1], 2);
    if (m = t.match(/^0[bB]([01]+)$/)) return parseInt(m[1], 2);
    if (m = t.match(/^([01]+)[bB]$/)) return parseInt(m[1], 2);
    if (m = t.match(/^([0-7]+)[oOqQ]$/)) return parseInt(m[1], 8);
    if (m = t.match(/^([0-9]+)[dD]?$/)) return parseInt(m[1], 10);
    return null;
}

// If an operand list contains a single $ / $±N term, return its signed offset,
// which comma-separated operand it is, and whether it was parenthesized.
function relTargetOffset(ops) {
    const parts = ops === '' ? [] : splitTopLevelCommas(ops);
    for (let k = 0; k < parts.length; k++) {
        let t = parts[k].trim();
        let paren = false, inner = t;
        if (/^\(.*\)$/.test(t)) { inner = t.slice(1, -1).trim(); paren = true; }
        if (inner === '$') return { offset: 0, operandIndex: k, paren };
        const m = inner.match(/^\$\s*([+\-])\s*(\S+)$/);
        if (m) {
            const v = parseIntToken(m[2]);
            if (v == null) continue;
            return { offset: m[1] === '-' ? -v : v, operandIndex: k, paren };
        }
    }
    return null;
}

// Classify a single operand token for instruction sizing.
function classifyOperand(tok) {
    const t = tok.trim();
    const up = t.toUpperCase();
    if (/^\(.*\)$/.test(t)) {
        const inner = t.slice(1, -1).trim();
        const iu = inner.toUpperCase();
        if (iu === 'HL') return 'mem_hl';
        if (iu === 'BC') return 'mem_bc';
        if (iu === 'DE') return 'mem_de';
        if (iu === 'SP') return 'mem_sp';
        if (iu === 'C') return 'mem_c';
        if (iu === 'IX' || iu === 'IY') return 'mem_idx';
        if (/^(IX|IY)\s*[+\-]/i.test(inner)) return 'mem_idxd';
        return 'mem_nn';
    }
    if (up === 'A') return 'A';
    if (['B', 'C', 'D', 'E', 'H', 'L'].includes(up)) return 'r8';
    if (['IXH', 'IXL', 'IYH', 'IYL', 'XH', 'XL', 'YH', 'LY', 'HX', 'LX', 'HY'].includes(up)) return 'r8x';
    if (up === 'BC' || up === 'DE') return 'r16';
    if (up === 'HL') return 'hl';
    if (up === 'SP') return 'sp';
    if (up === 'IX' || up === 'IY') return 'r16x';
    if (up === 'AF' || up === "AF'") return 'af';
    if (up === 'I') return 'I';
    if (up === 'R') return 'R';
    return 'imm';
}

// Byte size of an LD, or null if the form isn't recognized.
function ldSize(parts, c) {
    if (parts.length !== 2) return null;
    const d = c[0], s = c[1];
    const reg8 = t => (t === 'A' || t === 'r8');
    if (reg8(d) && reg8(s)) return 1;
    if (reg8(d) && s === 'mem_hl') return 1;
    if (d === 'mem_hl' && reg8(s)) return 1;
    if (reg8(d) && s === 'imm') return 2;
    if (d === 'mem_hl' && s === 'imm') return 2;
    if (d === 'r8x' || s === 'r8x') {
        if (reg8(d) && s === 'r8x') return 2;
        if (d === 'r8x' && reg8(s)) return 2;
        if (d === 'r8x' && s === 'r8x') return 2;
        if (d === 'r8x' && s === 'imm') return 3;
        return null;
    }
    if (d === 'mem_idxd' && reg8(s)) return 3;
    if (reg8(d) && s === 'mem_idxd') return 3;
    if (d === 'mem_idxd' && s === 'imm') return 4;
    if (d === 'A' && (s === 'mem_bc' || s === 'mem_de')) return 1;
    if ((d === 'mem_bc' || d === 'mem_de') && s === 'A') return 1;
    if (d === 'A' && s === 'mem_nn') return 3;
    if (d === 'mem_nn' && s === 'A') return 3;
    if (d === 'A' && (s === 'I' || s === 'R')) return 2;
    if ((d === 'I' || d === 'R') && s === 'A') return 2;
    if ((d === 'r16' || d === 'hl' || d === 'sp') && s === 'imm') return 3;
    if (d === 'r16x' && s === 'imm') return 4;
    if (d === 'hl' && s === 'mem_nn') return 3;
    if (d === 'mem_nn' && s === 'hl') return 3;
    if ((d === 'r16' || d === 'sp') && s === 'mem_nn') return 4;
    if (d === 'mem_nn' && (s === 'r16' || s === 'sp')) return 4;
    if (d === 'r16x' && s === 'mem_nn') return 4;
    if (d === 'mem_nn' && s === 'r16x') return 4;
    if (d === 'sp' && s === 'hl') return 1;
    if (d === 'sp' && s === 'r16x') return 2;
    return null;
}

// Byte size of one Z80 instruction from its mnemonic + operand text, or null
// when the form isn't confidently known (caller then skips the span).
function z80Size(mnem, opsRaw) {
    const M = mnem.toUpperCase();
    const ops = opsRaw.trim();
    const parts = ops === '' ? [] : splitTopLevelCommas(ops).map(s => s.trim());
    const c = parts.map(classifyOperand);

    if (parts.length === 0 &&
        ['NOP', 'HALT', 'DI', 'EI', 'EXX', 'RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'].includes(M)) return 1;
    if (['NEG', 'RETN', 'RETI', 'RRD', 'RLD', 'LDI', 'LDD', 'LDIR', 'LDDR', 'CPI', 'CPD', 'CPIR', 'CPDR',
        'INI', 'IND', 'INIR', 'INDR', 'OUTI', 'OUTD', 'OTIR', 'OTDR'].includes(M)) return 2;
    if (M === 'IM') return 2;
    if (M === 'RET') return 1;
    if (M === 'RST') return 1;
    if (M === 'DJNZ' || M === 'JR') return 2;
    if (M === 'CALL') return 3;
    if (M === 'JP') {
        const last = c[c.length - 1];
        if (last === 'mem_hl') return 1;
        if (last === 'mem_idx') return 2;
        return 3;
    }
    if (M === 'EX') {
        if (parts.length === 2) {
            const a = parts[0].toUpperCase(), b = parts[1].toUpperCase();
            if (a === 'AF' && (b === "AF'" || b === 'AF')) return 1;
            if (a === 'DE' && b === 'HL') return 1;
            if (a === '(SP)' && b === 'HL') return 1;
            if (a === '(SP)' && (b === 'IX' || b === 'IY')) return 2;
        }
        return null;
    }
    if (M === 'PUSH' || M === 'POP') {
        if (parts.length === 1) {
            const t = parts[0].toUpperCase();
            if (['AF', 'BC', 'DE', 'HL'].includes(t)) return 1;
            if (t === 'IX' || t === 'IY') return 2;
        }
        return null;
    }
    if (M === 'INC' || M === 'DEC') {
        if (parts.length !== 1) return null;
        const t = c[0];
        if (t === 'A' || t === 'r8' || t === 'mem_hl' || t === 'r16' || t === 'hl' || t === 'sp') return 1;
        if (t === 'r16x' || t === 'r8x') return 2;
        if (t === 'mem_idxd') return 3;
        return null;
    }
    if (['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'OR', 'XOR', 'CP'].includes(M)) {
        if (parts.length === 2 && c[0] === 'hl' && M === 'ADD') return 1;
        if (parts.length === 2 && c[0] === 'hl' && (M === 'ADC' || M === 'SBC')) return 2;
        if (parts.length === 2 && c[0] === 'r16x' && M === 'ADD') return 2;
        const opnd = c[c.length - 1];
        if (opnd === 'A' || opnd === 'r8' || opnd === 'mem_hl') return 1;
        if (opnd === 'r8x') return 2;
        if (opnd === 'mem_idxd') return 3;
        if (opnd === 'imm') return 2;
        return null;
    }
    if (['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SLI', 'SRL'].includes(M)) {
        if (parts.length === 1) {
            const t = c[0];
            if (t === 'A' || t === 'r8' || t === 'mem_hl') return 2;
            if (t === 'mem_idxd') return 4;
        }
        return null;
    }
    if (M === 'BIT' || M === 'RES' || M === 'SET') {
        if (parts.length === 2) {
            const t = c[1];
            if (t === 'A' || t === 'r8' || t === 'mem_hl') return 2;
            if (t === 'mem_idxd') return 4;
        }
        return null;
    }
    if (M === 'IN' || M === 'OUT') return 2;
    if (M === 'LD') return ldSize(parts, c);
    return null;
}

// Byte size of a data directive (DB/DW/DS…), or null if uncertain.
function dataSize(M, ops) {
    if (['DB', 'DEFB', 'DM', 'DEFM', 'BYTE'].includes(M)) {
        const items = splitTopLevelCommas(ops);
        let n = 0;
        for (let it of items) {
            it = it.trim();
            if (it === '') return null;
            if (/^["']/.test(it)) {
                const q = it[0];
                if (it.length >= 2 && it[it.length - 1] === q && it.slice(1, -1).length === 1) { n += 1; continue; }
                return null;   // multi-char string: don't risk a miscount
            }
            n += 1;
        }
        return n;
    }
    if (['DW', 'DEFW', 'WORD'].includes(M)) {
        const items = splitTopLevelCommas(ops);
        if (items.some(x => x.trim() === '')) return null;
        return items.length * 2;
    }
    if (['DS', 'DEFS', 'BLOCK'].includes(M)) {
        const v = parseIntToken((splitTopLevelCommas(ops)[0] || '').trim());
        return v == null ? null : v;
    }
    return null;
}

// Size of one parsed statement (instruction / data / zero-byte directive), or
// null (a barrier the span can't cross).
function statementSize(mnem, ops) {
    const M = mnem.toUpperCase();
    if (INSTRUCTIONS.has(M)) return z80Size(M, ops);
    if (DATA_DIRS.has(M)) return dataSize(M, ops);
    if (ZERO_DIRECTIVES.has(M)) return 0;
    return null;
}

// Walk from srcIdx by `offset` bytes; return the line index that lands exactly
// on an instruction boundary, or -1 (overshoot / unknown size / off the ends).
function walkTarget(recs, srcIdx, offset) {
    if (offset === 0) return srcIdx;
    if (offset > 0) {
        let acc = 0, j = srcIdx;
        while (true) {
            if (acc === offset) return j;
            if (acc > offset) return -1;
            const s = recs[j].size;
            if (s == null) return -1;
            acc += s; j++;
            if (j >= recs.length) return -1;
        }
    }
    let rel = 0, j = srcIdx;
    while (true) {
        if (rel === offset) return j;
        if (rel < offset) return -1;
        if (j - 1 < 0) return -1;
        const s = recs[j - 1].size;
        if (s == null) return -1;
        rel -= s; j--;
    }
}

// Skip blank/comment-only lines (same address) so the label lands on the code.
function normalizeTarget(recs, t) {
    let k = t;
    while (k < recs.length) {
        if (recs[k].kind === 'blank' && !recs[k].labelWord) { k++; continue; }
        return k;
    }
    return -1;
}

export function generateJumpLabels(text, opts = {}) {
    const rawLines = text.replace(/\r\n|\r/g, '\n').split('\n');
    const N = rawLines.length;
    const recs = [];
    const allLabels = new Set();

    for (let i = 0; i < N; i++) {
        const raw = rawLines[i];
        const { code, comment } = splitComment(raw);
        if (code.trim() === '') { recs.push({ size: 0, kind: 'blank', raw, labelWord: '' }); continue; }
        const { label, rest } = extractLabel(code);
        const labelWord = label ? label.replace(/:$/, '') : '';
        if (labelWord) allLabels.add(labelWord);
        const stmts = splitStatements(rest).map(s => s.trim()).filter(s => s !== '')
            .map(s => { const m = s.match(/^(\S+)(?:\s+([\s\S]*))?$/); return { mnem: m[1], ops: (m[2] || '').trim() }; });
        let size = 0;
        for (const st of stmts) { const z = statementSize(st.mnem, st.ops); if (z == null) { size = null; break; } size += z; }
        let jump = null;
        if (stmts.length === 1 && INSTRUCTIONS.has(stmts[0].mnem.toUpperCase())) {
            const rel = relTargetOffset(stmts[0].ops);
            if (rel) jump = { ...rel, mnem: stmts[0].mnem, ops: stmts[0].ops };
        }
        recs.push({
            size, kind: stmts.length ? 'code' : 'labelonly', raw, label, comment,
            labelWord, statements: stmts, jump,
            globalLabel: (labelWord && !labelWord.startsWith('.')) ? labelWord : ''
        });
    }

    // Resolve each jump to a target line.
    const resolutions = [];
    for (let i = 0; i < N; i++) {
        const r = recs[i];
        if (!r.jump) continue;
        const t = walkTarget(recs, i, r.jump.offset);
        if (t < 0) continue;
        const tn = normalizeTarget(recs, t);
        if (tn < 0) continue;
        resolutions.push({ src: i, target: tn, offset: r.jump.offset, isBranch: BRANCH_MNEMS.has(r.jump.mnem.toUpperCase()) });
    }
    if (resolutions.length === 0) return text;

    // Assign a name per target (reusing an existing global label if present),
    // numbering back_/fwd_/addr_ independently in target order.
    const byTarget = new Map();
    for (const res of resolutions) {
        if (!byTarget.has(res.target)) byTarget.set(res.target, []);
        byTarget.get(res.target).push(res);
    }
    const counters = { back: 0, fwd: 0, addr: 0 };
    const nameFor = new Map();
    const insertAt = new Map();
    for (const t of [...byTarget.keys()].sort((a, b) => a - b)) {
        const refs = byTarget.get(t);
        if (recs[t].globalLabel) { nameFor.set(t, recs[t].globalLabel); continue; }
        let prefix = 'addr';
        if (refs.some(x => x.isBranch && x.offset <= 0)) prefix = 'back';
        else if (refs.some(x => x.isBranch && x.offset > 0)) prefix = 'fwd';
        let name;
        do { counters[prefix]++; name = `${prefix}_${counters[prefix]}`; } while (allLabels.has(name));
        allLabels.add(name);
        nameFor.set(t, name);
        insertAt.set(t, name);
    }

    // Rewrite the operand on each source line.
    const modified = new Map();
    for (const res of resolutions) {
        const r = recs[res.src];
        const name = nameFor.get(res.target);
        const st = r.statements[0];
        const parts = splitTopLevelCommas(st.ops);
        parts[r.jump.operandIndex] = r.jump.paren ? `(${name})` : name;
        const newOps = parts.join(',');
        const labelPart = r.label ? r.label + ' ' : '';
        const code2 = labelPart + st.mnem + (newOps ? ' ' + newOps : '');
        modified.set(res.src, code2 + (r.comment ? ' ' + r.comment : ''));
    }

    const out = [];
    for (let i = 0; i < N; i++) {
        if (insertAt.has(i)) out.push(insertAt.get(i) + ':');
        out.push(modified.has(i) ? modified.get(i) : recs[i].raw);
    }
    return out.join('\n');
}
