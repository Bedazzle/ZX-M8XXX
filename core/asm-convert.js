// asm-convert.js - Converts foreign assembler dialect source text into
// sjasmplus syntax accepted by the built-in assembler (sjasmplus/).

import { Parser } from '../sjasmplus/parser.js';
//
// Works line by line with string/comment awareness; lines that need no
// change pass through untouched so the original formatting is preserved.
// Untranslatable constructs are commented out with a "; [import]" marker
// and reported in the warnings list.
//
// Supported dialects: 'alasm', 'tasm', 'tasm4', 'text' (pass-through)

// Mnemonic position rewrites shared by all dialects.
// Either a simple rename or a function (operands) -> { mnemonic, operands }.
const COMMON_MNEMONIC_MAP = {
    'SLI': 'SLL',                                       // undocumented shift, sjasmplus name
    'INF': () => ({ mnemonic: 'IN', operands: 'F,(C)' }),
    'EXD': () => ({ mnemonic: 'EX', operands: 'DE,HL' })
};

// ALASM JP-with-condition shorthand
const ALASM_JCC = { 'JZ': 'Z', 'JNZ': 'NZ', 'JC': 'C', 'JNC': 'NC' };

// GENS assembler control commands (*X) - meanings per the HiSoft GENS3
// manual, section 2.9. All are listing controls except *F.
function gensStarMeaning(cmd) {
    const letter = (cmd[1] || '').toUpperCase();
    const minus = cmd[2] === '-';
    switch (letter) {
        case 'L': return minus ? 'listing off' : 'listing on';
        case 'D': return minus ? 'listing addresses in hex' : 'listing addresses in decimal';
        case 'C': return minus ? 'short listing without object code' : 'full listing';
        case 'M': return minus ? 'hide macro expansions in listing' : 'show macro expansions in listing';
        case 'E': return 'listing eject (blank lines)';
        case 'H': return 'listing heading';
        case 'S': return 'pause listing until keypress';
        case 'F': return 'continue assembly from tape/microdrive file';
        default:  return 'assembler control';
    }
}

// Pasmo word operators (operand position) -> sjasmplus symbols
const PASMO_WORD_OPS = {
    'AND': '&', 'OR': '|', 'XOR': '^', 'NOT': '~', 'MOD': '%',
    'SHL': '<<', 'SHR': '>>', 'EQ': '==', 'NE': '!=',
    'LT': '<', 'LE': '<=', 'GT': '>', 'GE': '>='
};

// Pasmo constructs with no equivalent
const PASMO_UNSUPPORTED = {
    'PUBLIC': 'Pasmo PUBLIC (linker export) has no equivalent',
    'LOCAL':  'Pasmo LOCAL (macro-local symbols) is not supported',
    'IRP':    'Pasmo IRP loop cannot be converted automatically'
};

// Zeus data directives whose /string/ operands become "string"
const ZEUS_STRING_DIRS = ['DEFM', 'DEFB', 'DB', 'DM'];

// STORM directive renames
const STORM_DIRECTIVES = {
    'INCL': 'INCLUDE',
    'INCB': 'INCBIN',
    'EIF':  'ENDIF',
    'IFD':  'IFDEF',
    'IFND': 'IFNDEF'
};

// ALASM constructs with no sjasmplus equivalent - commented out with a warning
const ALASM_UNSUPPORTED = {
    'MAIN':   'ALASM MAIN project marker has no equivalent',
    'LOCAL':  'ALASM LOCAL label block - check for label collisions below',
    'ENDL':   'end of ALASM LOCAL label block',
    'REPEAT': 'ALASM REPEAT/UNTIL loop cannot be converted automatically',
    'UNTIL':  'ALASM REPEAT/UNTIL loop cannot be converted automatically',
    'DD':     'ALASM DD directive is not supported'
};

export class AsmDialectConverter {

    // Convert dialect source text to sjasmplus syntax.
    //   text    - plain source text (already detokenized)
    //   dialect - 'alasm' | 'tasm' | 'tasm4' | 'gens' | 'pasmo' | 'text'
    //   opts.fileMap - optional { lowercased original name -> VFS filename }
    //                  used to rewrite INCLUDE/INCBIN targets
    // Returns { text, warnings: [string] }
    static convert(text, dialect, opts = {}) {
        const warnings = [];
        if (text == null) return { text: '', warnings };

        const lines = text.replace(/\r\n|\r/g, '\n').split('\n');

        // Labels may contain characters that are operators in sjasmplus
        // (ALASM allows e.g. out[DE], ^ay) - rename them consistently in
        // declarations and references. opts.renames supplies a project-wide
        // map (labels may be declared in one file and referenced in another);
        // otherwise a per-file map is built. Only the native tokenized
        // dialects allow such names.
        let renames = null;
        if (opts.renames) {
            renames = opts.renames;
            for (const [orig, repl] of renames) {
                if (lines.some(l => l.includes(orig))) {
                    warnings.push(`Label "${orig}" contains characters invalid in sjasmplus - renamed to "${repl}"`);
                }
            }
        } else if (dialect === 'alasm' || dialect === 'tasm' || dialect === 'tasm4' ||
            dialect === 'ads' || dialect === 'storm') {
            renames = this.buildLabelRenames(lines);
            for (const [orig, repl] of renames) {
                warnings.push(`Label "${orig}" contains characters invalid in sjasmplus - renamed to "${repl}"`);
            }
        }

        const out = [];
        const state = {};   // per-file conversion state (e.g. Zeus DISP tracking)
        for (let n = 0; n < lines.length; n++) {
            let line = lines[n];
            if (renames && renames.size) {
                line = this.applyLabelRenames(line, renames);
            }
            const converted = this.convertLine(line, dialect, opts, (msg) => {
                warnings.push(`Line ${n + 1}: ${msg}`);
            }, state);
            out.push(converted);
        }

        return { text: out.join('\n'), warnings };
    }

    // Collect column-0 labels whose names sjasmplus cannot parse and build
    // a deterministic rename map (invalid chars -> '_'). The mapping depends
    // only on the name itself, so the same label renames identically in
    // every file of a project.
    static buildLabelRenames(lines) {
        // '@' is only valid as the first char (absolute-reference prefix)
        const valid = /^[A-Za-z_.@][\w.]*$/;
        const declared = new Set();
        const bad = [];
        for (const raw of lines) {
            const { code } = this.splitComment(raw);
            if (!code || /^\s/.test(code)) continue;
            const m = code.match(/^(\S+)/);
            if (!m) continue;
            const label = m[1].replace(/:$/, '');
            if (!label) continue;
            // INSTR:... at column 0 is a multi-statement line, not a label
            if (label.includes(':')) continue;
            declared.add(label);
            if (!valid.test(label)) bad.push(label);
        }
        const map = new Map();
        for (const orig of bad) {
            if (map.has(orig)) continue;
            let repl = orig.replace(/[^\w.@]/g, '_');
            repl = repl[0] + repl.slice(1).replace(/@/g, '_');
            if (!/^[A-Za-z_.@]/.test(repl)) repl = '_' + repl;
            map.set(orig, repl);
        }
        // deterministic mapping may collide with an existing label - warn-worthy
        for (const [orig, repl] of map) {
            if (declared.has(repl)) {
                map.set(orig, repl + '__renamed');
            }
        }
        return map;
    }

    // Replace renamed labels in a line (code part only, strings protected).
    // Longest originals first so overlapping names cannot mis-match.
    static applyLabelRenames(line, renames) {
        const { code, comment } = this.splitComment(line);
        if (!code) return line;
        const ordered = [...renames.keys()].sort((a, b) => b.length - a.length);
        let out = '';
        let i = 0;
        while (i < code.length) {
            const ch = code[i];
            const prev = out.length ? out[out.length - 1] : '';
            if (ch === '"' || (ch === "'" && !/[A-Za-z0-9_')]/.test(prev))) {
                out += ch;
                i++;
                while (i < code.length && code[i] !== ch) out += code[i++];
                if (i < code.length) out += code[i++];
                continue;
            }
            let matched = false;
            if (!/[\w.@]/.test(prev)) {
                for (const orig of ordered) {
                    if (code.startsWith(orig, i) && !/[\w.@]/.test(code[i + orig.length] || '')) {
                        out += renames.get(orig);
                        i += orig.length;
                        // a trailing colon on the declaration stays in place
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched) {
                out += ch;
                i++;
            }
        }
        return out + comment;
    }

    // ---- single line ------------------------------------------------------

    static convertLine(line, dialect, opts, warn, state = {}) {
        if (dialect === 'text') return line;

        let { code, comment } = this.splitComment(line);
        if (!code.trim()) return line;

        if (dialect === 'zeus') {
            // Zeus is line-numbered like GENS in editor exports
            const m = code.match(/^\d+[ \t]/);
            if (m) {
                code = code.slice(m[0].length);
                line = code + comment;
                if (!code.trim()) return line;
            } else if (/^\d+\s*$/.test(code)) {
                return comment.replace(/^[ \t]+/, '');
            }
        }

        if (dialect === 'ads') {
            // ADS has unclosed char literals ("c followed by a separator,
            // e.g. ADD A,"A or DEFB "1,#FF) alongside normal closed strings
            // (DEFM "Formating") - close only the char literals
            let closed = '';
            for (let i = 0; i < code.length; i++) {
                const ch = code[i];
                if (ch !== '"') {
                    closed += ch;
                    continue;
                }
                const c1 = code[i + 1];
                const c2 = code[i + 2];
                if (c1 === undefined) {
                    closed += ch;
                } else if (c2 === '"') {
                    closed += code.slice(i, i + 3);      // already closed "x"
                    i += 2;
                } else if (c2 === undefined || /[,:)]/.test(c2)) {
                    // one-char literal: "1,#FF / ADD A,"A / LD A,".:RST
                    closed += '"' + c1 + '"';
                    i += 1;
                } else {
                    // ordinary string - copy through the closing quote
                    let j = i + 1;
                    while (j < code.length && code[j] !== '"') j++;
                    if (j < code.length) {
                        closed += code.slice(i, j + 1);
                        i = j;
                    } else {
                        closed += code.slice(i) + '"';   // unterminated - close at EOL
                        i = code.length;
                    }
                }
            }
            if (closed !== code) {
                code = closed;
                line = code + comment;
            }
            // Slash strings (DEFM /x:y/) before the ':' statement split
            const sl = this.slashStringsToQuotes(code);
            if (sl !== null) {
                code = sl;
                line = code + comment;
            }
            // ADS allows ':'-separated statements, including labels after a
            // ':' (...:imul PUSH HL) - split into real lines and recurse
            if (code.includes(':')) {
                const stmts = [];
                let cur = '';
                let inStr = false;
                for (const ch of code) {
                    if (ch === '"') inStr = !inStr;
                    if (ch === ':' && !inStr) {
                        stmts.push(cur);
                        cur = '';
                    } else {
                        cur += ch;
                    }
                }
                stmts.push(cur);
                if (stmts.length > 1 && stmts.every(s => s.trim())) {
                    return stmts
                        .map(s => this.convertLine(s, dialect, opts, warn, state))
                        .join('\n') + comment;
                }
            }
            // A column-0 instruction or directive would parse as a label -
            // indent statements. A bare word with no operands is only a
            // statement if the instruction takes none; otherwise it must be
            // a label (e.g. a label named "Res").
            if (!/^\s/.test(code)) {
                const m = code.match(/^([A-Za-z]+)\b(.*)$/);
                if (m) {
                    const w = m[1].toUpperCase();
                    const hasRest = m[2].trim() !== '';
                    const ZERO_OP = ['NOP', 'RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL',
                        'SCF', 'CCF', 'HALT', 'DI', 'EI', 'EXX', 'EXA', 'LDI', 'LDIR',
                        'LDD', 'LDDR', 'CPI', 'CPIR', 'CPD', 'CPDR', 'INI', 'INIR',
                        'IND', 'INDR', 'OUTI', 'OTIR', 'OUTD', 'OTDR', 'NEG', 'RETI',
                        'RETN', 'RLD', 'RRD', 'RET'];
                    if ((hasRest && (Parser.isInstruction(w) || Parser.isDirective(w))) ||
                        (!hasRest && ZERO_OP.includes(w))) {
                        code = '        ' + code;
                        line = code + comment;
                    }
                }
            }
        }

        if (dialect === 'gens') {
            // GENS sources are line-numbered like BASIC - strip the number
            const m = code.match(/^\d+[ \t]/);
            if (m) {
                code = code.slice(m[0].length);
                line = code + comment;
                if (!code.trim()) return line;
            } else if (/^\d+\s*$/.test(code)) {
                // number followed only by a comment (or by nothing)
                return comment.replace(/^[ \t]+/, '');
            }
            // *L+ / *D- / *E ... - GENS assembler control commands
            const star = code.match(/^\s*(\*\S+)/);
            if (star) {
                const meaning = gensStarMeaning(star[1]);
                if (star[1].toUpperCase().startsWith('*F')) {
                    warn(`GENS ${star[1]} continues assembly from a tape file - import that file separately`);
                } else {
                    warn(`GENS ${star[1]} (${meaning}) - listing control commented out`);
                }
                return `; [import] ${line}  ; ${meaning}`;
            }
        }

        if (dialect === 'alasm') {
            // ALASM allows a string to run to end of line without a closing
            // quote (DB "w, as opcode bytes) - terminate it for sjasmplus.
            // With an odd quote count splitComment saw no comment, so the
            // whole rest of the line is string content, as in ALASM.
            let quotes = 0;
            for (const ch of code) if (ch === '"') quotes++;
            if (quotes % 2 === 1) {
                code += '"';
                line = code + comment;
            }
            // 'label is ALASM's high-byte operator (ADD A,'BMAP)
            const t = this.alasmHighOp(code);
            if (t !== code) {
                code = t;
                line = code + comment;
            }
        }

        const parsed = this.parseCode(code);

        // A column-0 label that collides with an instruction or directive
        // name would be parsed as that instruction - force a colon
        if (parsed.label && !parsed.label.endsWith(':') &&
            (Parser.isInstruction(parsed.label) || Parser.isDirective(parsed.label.toUpperCase()))) {
            parsed.label += ':';
            if (parsed.gapAfterLabel.length > 1) parsed.gapAfterLabel = parsed.gapAfterLabel.slice(1);
            code = parsed.label + parsed.gapAfterLabel +
                (parsed.mnemonic ? parsed.mnemonic + parsed.gap + parsed.operands : '');
            line = code + comment;
        }

        if (!parsed.mnemonic) return line;

        const upper = parsed.mnemonic.toUpperCase();

        // ALASM allows chained LD pairs: LD H,D,L,E = LD H,D + LD L,E
        if (dialect === 'alasm' && upper === 'LD') {
            const parts = this.splitTopLevel(parsed.operands);
            if (parts.length > 2) {
                if (parts.length % 2 !== 0) {
                    warn(`LD with ${parts.length} operands cannot be split into pairs`);
                    return line;
                }
                const lines = [];
                for (let i = 0; i < parts.length; i += 2) {
                    const ops = parts[i].trim() + ',' + parts[i + 1].trim();
                    if (i === 0) {
                        lines.push(this.rebuild(parsed, parsed.mnemonic, ops) + comment);
                    } else {
                        lines.push('        ' + parsed.mnemonic + (parsed.gap || ' ') + ops);
                    }
                }
                return lines.join('\n');
            }
        }

        // INCLUDE/INCBIN target remapping (all dialects)
        if (upper === 'INCLUDE' || upper === 'INCBIN') {
            const remapped = this.remapIncludeTarget(parsed.operands, opts, warn, upper);
            if (remapped !== null && remapped !== parsed.operands) {
                return this.rebuild(parsed, parsed.mnemonic, remapped) + comment;
            }
            return line;
        }

        if (dialect === 'alasm') {
            if (upper in ALASM_UNSUPPORTED) {
                warn(`${ALASM_UNSUPPORTED[upper]} - line commented out`);
                return '; [import] ' + line;
            }
            if (upper in ALASM_JCC) {
                return this.rebuild(parsed, 'JP', ALASM_JCC[upper] + ',' + parsed.operands.trim()) + comment;
            }
            if (upper === 'IFN') {
                // IFN expr - assemble when expression is false
                return this.rebuild(parsed, 'IF', '!(' + parsed.operands.trim() + ')') + comment;
            }
        }

        if (dialect === 'gens' && upper === 'ENT') {
            warn('GENS ENT (run address) has no equivalent - line commented out');
            return '; [import] ' + line;
        }

        if (dialect === 'zeus') {
            if (upper === 'DISP') {
                // Zeus DISP n displaces the PLACEMENT relative to ORG while
                // code still runs at ORG - the inverse of sjasmplus DISP
                // (placement here, run address displaced). Cannot be mapped
                // mechanically without restructuring ORG.
                warn('Zeus DISP displaces placement relative to ORG (inverse of sjasmplus DISP) - rewrite as ORG placement + DISP run-address manually');
                return '; [import] ' + line;
            }
            if (upper === 'ENT') {
                warn('Zeus ENT (entry point) has no equivalent - line commented out');
                return '; [import] ' + line;
            }
            // Zeus allows overflow names for the parity conditions
            if (upper === 'JP' || upper === 'CALL') {
                const m2 = parsed.operands.match(/^(\s*)(NV|V)(\s*,)/i);
                if (m2) {
                    const cond = m2[2].toUpperCase() === 'V' ? 'PE' : 'PO';
                    return this.rebuild(parsed, parsed.mnemonic,
                        parsed.operands.replace(m2[0], m2[1] + cond + m2[3])) + comment;
                }
            }
            if (upper === 'RET' && /^(NV|V)$/i.test(parsed.operands.trim())) {
                const cond = parsed.operands.trim().toUpperCase() === 'V' ? 'PE' : 'PO';
                return this.rebuild(parsed, parsed.mnemonic, cond) + comment;
            }
            if (upper === 'PROC') {
                // the label stays (sjasmplus .locals scope under it)
                warn(`Zeus PROC - locals now scope under "${parsed.label || '(no label)'}"`);
                return (parsed.label || '') + '   ; [import] PROC' + comment;
            }
            if (upper === 'ENDP') {
                return '; [import] ' + line;
            }
            if (upper === 'RETP') {
                warn('Zeus RETP converted to RET - verify');
                return this.rebuild(parsed, 'RET', '') + comment;
            }
            if (upper === 'MEND') {
                return this.rebuild(parsed, 'ENDM', parsed.operands) + comment;
            }
            if (ZEUS_STRING_DIRS.includes(upper)) {
                const newOps = this.slashStringsToQuotes(parsed.operands);
                if (newOps !== null) {
                    return this.rebuild(parsed, parsed.mnemonic, newOps) + comment;
                }
            }
        }

        if (dialect === 'pasmo') {
            if (upper in PASMO_UNSUPPORTED) {
                warn(`${PASMO_UNSUPPORTED[upper]} - line commented out`);
                return '; [import] ' + line;
            }
            if (upper === 'END' && parsed.operands.trim()) {
                warn('END entry address is ignored by the built-in assembler');
            }
            // Word operators (AND/OR/MOD/SHL/...) become symbols
            const newOps = this.pasmoOperands(parsed.operands);
            if (newOps !== parsed.operands) {
                return this.rebuild(parsed, parsed.mnemonic, newOps) + comment;
            }
        }

        if (dialect === 'storm') {
            if (upper in STORM_DIRECTIVES) {
                const newDir = STORM_DIRECTIVES[upper];
                let ops = this.stormOperands(parsed.operands, warn);
                if (newDir === 'INCLUDE' || newDir === 'INCBIN') {
                    const remapped = this.remapIncludeTarget(ops, opts, warn, newDir);
                    if (remapped !== null) ops = remapped;
                }
                return this.rebuild(parsed, newDir, ops) + comment;
            }
            if (upper === 'IFU' || upper === 'IFNU') {
                warn(`STORM ${upper} (if symbol ${upper === 'IFU' ? '' : 'not '}used) mapped to IF${upper === 'IFU' ? 'DEF' : 'NDEF'} - semantics differ, verify`);
                return this.rebuild(parsed, upper === 'IFU' ? 'IFDEF' : 'IFNDEF', parsed.operands) + comment;
            }
            if (parsed.label && /^\.\d+:?$/.test(parsed.label)) {
                warn(`STORM numeric local label ${parsed.label.replace(/:$/, '')} - verify scope after conversion`);
            }
            const newOps = this.stormOperands(parsed.operands, warn);
            if (newOps !== parsed.operands) {
                return this.rebuild(parsed, parsed.mnemonic, newOps) + comment;
            }
        }

        // ADS allows labels on indented lines ("   Res CALL DRWN",
        // "   push DEFW #3FC0") - our parser wants labels at column 1.
        // Evidence of a label: the next word is a directive (never a valid
        // operand), or an instruction while this word isn't a flow op that
        // takes label operands.
        if (dialect === 'ads' && parsed.indent && parsed.mnemonic && parsed.operands) {
            const fwm = parsed.operands.match(/^([A-Za-z_]\w*)\b/);
            const FLOW = ['JP', 'JR', 'CALL', 'DJNZ', 'RET'];
            if (fwm && !FLOW.includes(upper)) {
                // flow ops take label operands that may collide with
                // directive/instruction names (JP OPT) - never hoist those
                const fw = fwm[1].toUpperCase();
                if (Parser.isDirective(fw) || Parser.isInstruction(fw)) {
                    return this.convertLine(
                        parsed.mnemonic + ':' + parsed.gap + parsed.operands,
                        dialect, opts, warn, state) + comment;
                }
            }
        }

        if (dialect === 'tasm' || dialect === 'tasm4' || dialect === 'ads') {
            if (upper === 'UNPHASE') {
                return this.rebuild(parsed, 'DEPHASE', parsed.operands) + comment;
            }
            if (upper === 'DM') {
                return this.rebuild(parsed, 'DB', parsed.operands) + comment;
            }
            if (dialect === 'tasm4') {
                if (upper === 'DEFMAC') {
                    // DEFMAC NAME [args] -> NAME MACRO [args]
                    const ops = parsed.operands.trim();
                    const m = ops.match(/^(\S+)\s*(.*)$/);
                    if (m) {
                        warn(`macro "${m[1]}" converted to sjasmplus MACRO - verify parameter usage`);
                        const head = parsed.label ? parsed.label + parsed.gapAfterLabel : parsed.indent;
                        return head + m[1] + ' MACRO' + (m[2] ? ' ' + m[2] : '') + comment;
                    }
                }
                if (upper === 'ENDMAC') {
                    return this.rebuild(parsed, 'ENDM', parsed.operands) + comment;
                }
            }
        }

        if (upper in COMMON_MNEMONIC_MAP) {
            const map = COMMON_MNEMONIC_MAP[upper];
            if (typeof map === 'string') {
                return this.rebuild(parsed, map, parsed.operands) + comment;
            }
            const r = map(parsed.operands);
            return this.rebuild(parsed, r.mnemonic, r.operands) + comment;
        }

        return line;
    }

    // ---- helpers ------------------------------------------------------------

    // STORM operand rewriting outside strings: \ (modulo) -> %, and =N
    // local-label references -> .N (matching the .N declarations)
    static stormOperands(operands, warn) {
        let out = '';
        let inString = false;
        for (let i = 0; i < operands.length; i++) {
            const ch = operands[i];
            if (ch === '"') {
                inString = !inString;
                out += ch;
                continue;
            }
            if (!inString) {
                if (ch === '\\') {
                    out += '%';
                    continue;
                }
                // =N where a term starts is a local-label reference; after an
                // identifier/value or comparison char it is the = operator
                if (ch === '=' && /\d/.test(operands[i + 1] || '') &&
                    !/[\w)$=<>!]/.test(out.slice(-1))) {
                    out += '.';
                    continue;
                }
                if (ch === '`' || ch === '?' || ch === '@') {
                    warn(`STORM operator "${ch}" has no direct equivalent - verify expression`);
                }
            }
            out += ch;
        }
        return out;
    }

    // Pasmo operand rewriting: word operators -> symbols, b-suffix binary
    // numbers -> % prefix. Skips quoted strings (both quote styles; an
    // apostrophe after an identifier char, as in AF', is not a string).
    static pasmoOperands(operands) {
        let out = '';
        let i = 0;
        while (i < operands.length) {
            const ch = operands[i];
            const prev = out.length ? out[out.length - 1] : '';
            if (ch === '"' || (ch === "'" && !/[A-Za-z0-9_')]/.test(prev))) {
                // copy quoted string verbatim
                out += ch;
                i++;
                while (i < operands.length && operands[i] !== ch) out += operands[i++];
                if (i < operands.length) out += operands[i++];
                continue;
            }
            // accumulate up to the next string, then rewrite the segment
            let seg = '';
            while (i < operands.length) {
                const c = operands[i];
                const p = seg.length ? seg[seg.length - 1] : prev;
                if (c === '"' || (c === "'" && !/[A-Za-z0-9_')]/.test(p))) break;
                seg += c;
                i++;
            }
            seg = seg.replace(/\b(AND|OR|XOR|NOT|MOD|SHL|SHR|EQ|NE|LT|LE|GT|GE)\b/gi,
                w => PASMO_WORD_OPS[w.toUpperCase()]);
            seg = seg.replace(/\b([01]+)[bB]\b/g, '%$1');
            // BASIC-style literals: &HFF hex, &X1010 binary, &O77 octal
            seg = seg.replace(/&[Hh]([0-9A-Fa-f]+)\b/g, '#$1');
            seg = seg.replace(/&[Xx]([01]+)\b/g, '%$1');
            seg = seg.replace(/&[Oo]([0-7]+)\b/g, (m, d) => String(parseInt(d, 8)));
            out += seg;
        }
        return out;
    }

    // Convert slash-delimited strings (DEFM /HELLO/) to quoted strings.
    // A slash string starts at the beginning or after a separator and ends
    // before a separator/end of operands, so division (X/2) is untouched.
    // Returns the new operand string, or null if nothing changed.
    static slashStringsToQuotes(operands) {
        const out = operands.replace(/(^|[\s,:])\/([^/]*)\/(?=[\s,:]|$)/g,
            (m, pre, body) => pre + '"' + body + '"');
        return out !== operands ? out : null;
    }

    // Split an operand list on top-level commas (ignores commas inside
    // parentheses and double-quoted strings).
    static splitTopLevel(operands) {
        const parts = [];
        let depth = 0, inString = false, cur = '';
        for (let i = 0; i < operands.length; i++) {
            const ch = operands[i];
            if (ch === '"') inString = !inString;
            else if (!inString) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
                else if (ch === ',' && depth === 0) {
                    parts.push(cur);
                    cur = '';
                    continue;
                }
            }
            cur += ch;
        }
        if (cur.trim() !== '' || parts.length) parts.push(cur);
        return parts;
    }

    // Replace ALASM's high-byte operator 'expr with HIGH expr - applies to
    // labels, $ (current address, e.g. ORG '$*256+256 page alignment),
    // numbers and parenthesized terms. Skips quoted strings and the
    // apostrophe in AF' (preceded by an identifier character).
    // Our HIGH binds at unary level, matching ALASM: '$*256 = (HIGH $)*256.
    static alasmHighOp(code) {
        let out = '';
        let inString = false;
        for (let i = 0; i < code.length; i++) {
            const ch = code[i];
            if (ch === '"') {
                inString = !inString;
                out += ch;
                continue;
            }
            if (!inString && ch === "'") {
                const prev = out.length ? out[out.length - 1] : '';
                const next = code[i + 1] || '';
                if (!/[A-Za-z0-9_')$]/.test(prev) && /[A-Za-z_$#0-9(%]/.test(next)) {
                    out += 'HIGH ';
                    continue;
                }
            }
            out += ch;
        }
        return out;
    }

    // Split a line into code and comment, respecting quoted strings.
    // Double quotes always delimit strings; a single quote only opens one
    // when not preceded by an identifier char (so AF' and ALASM's 'label
    // high-byte operator don't swallow the rest of the line).
    // The comment part includes the ';' and the whitespace just before it,
    // so rebuilt lines keep their original comment spacing.
    static splitComment(line) {
        let inString = false;
        let quote = '';
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inString) {
                if (ch === quote) inString = false;
            } else if (ch === '"') {
                inString = true;
                quote = '"';
            } else if (ch === "'" && !/[A-Za-z0-9_')]/.test(line[i - 1] || '')) {
                inString = true;
                quote = "'";
            } else if (ch === ';') {
                let j = i;
                while (j > 0 && (line[j - 1] === ' ' || line[j - 1] === '\t')) j--;
                return { code: line.slice(0, j), comment: line.slice(j) };
            }
        }
        return { code: line, comment: '' };
    }

    // Parse the code part into label / mnemonic / operands while keeping
    // the whitespace pieces needed to reassemble the line.
    static parseCode(code) {
        const result = { label: '', gapAfterLabel: '', indent: '', mnemonic: '', gap: ' ', operands: '' };

        let rest = code;
        if (!/^\s/.test(code)) {
            // Label in column 0 (colon optional)
            const m = code.match(/^(\S+)(\s*)([\s\S]*)$/);
            if (m) {
                result.label = m[1];
                result.gapAfterLabel = m[2];
                rest = m[3];
            }
            if (!rest) return result;   // label-only line
        } else {
            const m = code.match(/^(\s+)([\s\S]*)$/);
            result.indent = m[1];
            rest = m[2];
        }

        const m2 = rest.match(/^(\S+)(\s*)([\s\S]*)$/);
        if (m2) {
            result.mnemonic = m2[1];
            result.gap = m2[2] || '';
            result.operands = m2[3];
        }
        return result;
    }

    // Reassemble a parsed line with a replacement mnemonic/operands.
    static rebuild(parsed, mnemonic, operands) {
        const head = parsed.label
            ? parsed.label + (parsed.gapAfterLabel || ' ')
            : parsed.indent;
        const gap = parsed.gap || (operands ? ' ' : '');
        return head + mnemonic + (operands ? gap + operands : '');
    }

    // Rewrite the INCLUDE/INCBIN target using the imported-files map.
    // The target may be quoted or bare; TR-DOS names have no extension.
    // opts: { fileMap, binaryTargets } - binaryTargets is a Set of VFS names
    // that are being imported as raw binary; INCLUDE-ing one of those cannot
    // work, so it gets a dedicated warning.
    // Returns the new operand string, or null if no rewrite applies.
    static remapIncludeTarget(operands, opts, warn, directive) {
        const fileMap = opts && opts.fileMap;
        if (!fileMap) return null;
        const trimmed = operands.trim();
        const m = trimmed.match(/^"([^"]*)"$|^(\S+)$/);
        if (!m) return null;
        const rawName = (m[1] !== undefined ? m[1] : m[2]).trim();
        const key = rawName.toLowerCase();

        let target = fileMap[key];
        if (!target) {
            // try without an extension ("GAME0.A" -> "game0")
            const noExt = key.replace(/\.[^.]*$/, '');
            target = fileMap[noExt];
        }
        if (!target) {
            warn(`${directive} "${rawName}" does not match any imported file`);
            return null;
        }
        if (directive === 'INCLUDE' && opts.binaryTargets && opts.binaryTargets.has(target)) {
            warn(`INCLUDE "${rawName}" points at "${target}" which is imported as binary - if it is a source file, set its format (e.g. STORM/ALASM/TASM) in the import list`);
        }
        return '"' + target + '"';
    }

    // Build a fileMap entry set for one imported file.
    // Maps the original TR-DOS/archive name (with and without type extension,
    // lowercased) to the VFS filename it was imported as.
    static addFileMapEntries(fileMap, originalName, typeChar, vfsName) {
        const base = originalName.trim().toLowerCase();
        if (!base) return;
        fileMap[base] = vfsName;
        if (typeChar) {
            fileMap[base + '.' + typeChar.toLowerCase()] = vfsName;
        }
    }
}
