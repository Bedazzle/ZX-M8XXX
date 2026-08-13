// asm-highlight.js — syntax highlighting for the ASM editor
//
// Pure: text in, markup out. Extracted from assembler-ui.js so it can be tested
// and benchmarked on its own, and so the per-line cache has one home.

import { escapeHtml } from '../core/utils.js';
import { decodeViewCodepage } from '../core/asm-detok.js';

// Z80 instructions set for highlighting
const Z80_INSTRUCTIONS = new Set([
    'ADC', 'ADD', 'AND', 'BIT', 'CALL', 'CCF', 'CP', 'CPD', 'CPDR', 'CPI', 'CPIR',
    'CPL', 'DAA', 'DEC', 'DI', 'DJNZ', 'EI', 'EX', 'EXX', 'HALT', 'IM', 'IN',
    'INC', 'IND', 'INDR', 'INI', 'INIR', 'JP', 'JR', 'LD', 'LDD', 'LDDR', 'LDI',
    'LDIR', 'NEG', 'NOP', 'OR', 'OTDR', 'OTIR', 'OUT', 'OUTD', 'OUTI', 'POP',
    'PUSH', 'RES', 'RET', 'RETI', 'RETN', 'RL', 'RLA', 'RLC', 'RLCA', 'RLD',
    'RR', 'RRA', 'RRC', 'RRCA', 'RRD', 'RST', 'SBC', 'SCF', 'SET', 'SLA', 'SLL',
    'SRA', 'SRL', 'SUB', 'XOR', 'DEFB', 'DEFW', 'DEFS', 'DB', 'DW', 'DS', 'DEFM',
    'DM', 'BYTE', 'WORD', 'BLOCK'
]);

const Z80_DIRECTIVES = new Set([
    'ORG', 'EQU', 'INCLUDE', 'INCBIN', 'MACRO', 'ENDM', 'REPT', 'ENDR',
    'IF', 'ELSE', 'ENDIF', 'IFDEF', 'IFNDEF', 'ALIGN', 'PHASE', 'DEPHASE',
    'END', 'ASSERT', 'DEVICE', 'SLOT', 'PAGE', 'MODULE', 'ENDMODULE',
    'STRUCT', 'ENDS', 'SECTION', 'ENDSECTION', 'OUTPUT', 'LABELSLIST',
    'DISPLAY', 'SHELLEXEC', 'DEFINE', 'UNDEFINE', 'DUP', 'EDUP', 'PROC', 'ENDP'
]);

const Z80_CONDITIONS = new Set(['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M']);

const Z80_REGISTERS = new Set([
    'A', 'B', 'C', 'D', 'E', 'H', 'L', 'F', 'I', 'R',
    'AF', 'BC', 'DE', 'HL', 'IX', 'IY', 'SP', 'PC',
    'IXH', 'IXL', 'IYH', 'IYL', "AF'"
]);

// A label definition on this line: "name:" (indented or not) or a bare name in
// column 0. Returns null for anything else. Instruction and directive names only
// count as labels when written with a colon, so an unindented `ORG` stays a
// directive while `end:` is a label.
const LABEL_COLON = /^[ \t]*([A-Za-z_.][\w.$]*)[ \t]*:/;
const LABEL_COL0 = /^([A-Za-z_.][\w.$]*)(?=[ \t]|$)/;

export function labelDefinedOn(line) {
    const code = line.replace(/;.*$/, '');
    let m = LABEL_COLON.exec(code);
    if (m) return m[1];
    m = LABEL_COL0.exec(code);
    if (m) {
        const up = m[1].toUpperCase();
        if (Z80_INSTRUCTIONS.has(up) || Z80_DIRECTIVES.has(up)) return null;
        return m[1];
    }
    return null;
}

// Every label defined anywhere in a document. Passing this to the tokenizer is
// what lets a label be coloured the same at its definition and at every use.
export function collectLabels(code) {
    const set = new Set();
    for (const line of code.split('\n')) {
        const name = labelDefinedOn(line);
        if (name) set.add(name);
    }
    return set;
}

// Simple tokenizer for syntax highlighting.
// `labels` (optional) is the document's label set, from collectLabels().
function tokenizeAsmLine(line, labels = null) {
    const tokens = [];
    let pos = 0;
    // Directives and instructions only exist in the mnemonic slot. Past it we're
    // in operands, where the same word is a symbol - so `jr end` reads as an
    // (undefined) symbol rather than as the END directive. A ':' separator starts
    // a new statement, so the slot opens again.
    let seenMnemonic = false;

    while (pos < line.length) {
        const ch = line[pos];

        // Whitespace
        if (ch === ' ' || ch === '\t') {
            let start = pos;
            while (pos < line.length && (line[pos] === ' ' || line[pos] === '\t')) {
                pos++;
            }
            tokens.push({ type: 'whitespace', value: line.slice(start, pos) });
            continue;
        }

        // Comment (;)
        if (ch === ';') {
            tokens.push({ type: 'comment', value: line.slice(pos) });
            break;
        }

        // String
        if (ch === '"' || ch === "'") {
            const quote = ch;
            let start = pos;
            pos++;
            while (pos < line.length && line[pos] !== quote) {
                if (line[pos] === '\\' && pos + 1 < line.length) pos++;
                pos++;
            }
            if (pos < line.length) pos++; // closing quote
            tokens.push({ type: 'string', value: line.slice(start, pos) });
            continue;
        }

        // Number: $hex, #hex, 0x, %, binary, decimal, or suffix-based
        if (/[0-9$#%]/.test(ch)) {
            let start = pos;
            if (ch === '$' || ch === '#') {
                pos++;
                while (pos < line.length && /[0-9a-fA-F_]/.test(line[pos])) pos++;
            } else if (ch === '%') {
                pos++;
                while (pos < line.length && /[01_]/.test(line[pos])) pos++;
            } else if (ch === '0' && pos + 1 < line.length && (line[pos + 1] === 'x' || line[pos + 1] === 'X')) {
                pos += 2;
                while (pos < line.length && /[0-9a-fA-F_]/.test(line[pos])) pos++;
            } else {
                while (pos < line.length && /[0-9a-fA-F_]/.test(line[pos])) pos++;
                if (pos < line.length && /[hHbBoOdDqQ]/.test(line[pos])) pos++;
            }
            tokens.push({ type: 'number', value: line.slice(start, pos) });
            continue;
        }

        // Identifier (label, instruction, register)
        if (/[a-zA-Z_.]/.test(ch) || ch === '@') {
            let start = pos;
            pos++;
            while (pos < line.length && /[a-zA-Z0-9_]/.test(line[pos])) pos++;
            if (pos < line.length && line[pos] === "'") pos++; // AF'
            const value = line.slice(start, pos);
            const upper = value.toUpperCase();

            // Check for colon after (label definition)
            let isLabel = false;
            let colonPos = pos;
            while (colonPos < line.length && (line[colonPos] === ' ' || line[colonPos] === '\t')) colonPos++;
            if (colonPos < line.length && line[colonPos] === ':') {
                isLabel = true;
            }
            // Also check if starts with . (local label)
            if (value.startsWith('.')) isLabel = true;

            // A label wins over the keyword tables: a colon (or leading dot) says
            // so on this line alone, and `labels` says so for uses elsewhere —
            // otherwise `end:` and `JR Z,end` would both colour as the END
            // directive. Registers are still checked first, so `LD A,B` keeps its
            // register colour even in a file that happens to define a label B.
            if (isLabel) {
                tokens.push({ type: 'label', value });
            } else if (Z80_REGISTERS.has(upper) || Z80_CONDITIONS.has(upper)) {
                tokens.push({ type: 'register', value });
            } else if (labels && labels.has(value)) {
                tokens.push({ type: 'label', value });
            } else if (!seenMnemonic && Z80_INSTRUCTIONS.has(upper)) {
                tokens.push({ type: 'instruction', value });
                seenMnemonic = true;
            } else if (!seenMnemonic && Z80_DIRECTIVES.has(upper)) {
                tokens.push({ type: 'directive', value });
                seenMnemonic = true;
            } else if (start === 0) {
                tokens.push({ type: 'label', value });
            } else {
                tokens.push({ type: 'identifier', value });
            }
            continue;
        }

        // Operators and punctuation
        if (ch === '(' || ch === ')' || ch === '[' || ch === ']') {
            tokens.push({ type: 'paren', value: ch });
            pos++;
            continue;
        }

        if (ch === ':') {
            tokens.push({ type: 'colon', value: ch });
            seenMnemonic = false;       // statement separator (or end of a label)
            pos++;
            continue;
        }

        if (ch === ',') {
            tokens.push({ type: 'comma', value: ch });
            pos++;
            continue;
        }

        if (/[+\-*\/%&|^~<>=!]/.test(ch)) {
            let start = pos;
            pos++;
            // Handle two-char operators
            if (pos < line.length && /[<>=&|]/.test(line[pos])) pos++;
            tokens.push({ type: 'operator', value: line.slice(start, pos) });
            continue;
        }

        // Unknown char
        tokens.push({ type: 'text', value: ch });
        pos++;
    }

    return tokens;
}

// One source line to markup. This is the unit the line cache stores.
export function highlightAsmLine(line, labels = null) {
    {
        const tokens = tokenizeAsmLine(line, labels);
        return tokens.map(token => {
            const escaped = escapeHtml(token.value);
            switch (token.type) {
                case 'instruction':
                    return `<span class="asm-hl-instruction">${escaped}</span>`;
                case 'directive':
                    return `<span class="asm-hl-directive">${escaped}</span>`;
                case 'register':
                    return `<span class="asm-hl-register">${escaped}</span>`;
                case 'number':
                    return `<span class="asm-hl-number">${escaped}</span>`;
                case 'string':
                    return `<span class="asm-hl-string">${escaped}</span>`;
                case 'label':
                    return `<span class="asm-hl-label">${escaped}</span>`;
                case 'comment':
                    return `<span class="asm-hl-comment">${escaped}</span>`;
                case 'paren':
                    return `<span class="asm-hl-paren">${escaped}</span>`;
                case 'operator':
                    return `<span class="asm-hl-operator">${escaped}</span>`;
                default:
                    return escaped;
            }
        }).join('');
    }
}

// A per-line markup cache, keyed by line text so that inserting or deleting a
// line doesn't invalidate the lines below it. Entries not used by the latest
// highlight pass are dropped, so the map tracks the file rather than growing.
export function createHighlightCache() {
    let current = new Map();
    let next = new Map();
    return {
        get(line) {
            let html = next.get(line);
            if (html !== undefined) return html;
            html = current.get(line);
            if (html === undefined) return undefined;
            next.set(line, html);
            return html;
        },
        put(line, html) { next.set(line, html); },
        endPass() { current = next; next = new Map(); },
        clear() { current = new Map(); next = new Map(); },
        // Markup depends on the document's label set as well as on the line text,
        // so a caller that reuses a cache across edits must drop it when the set
        // changes. (createHighlightLayer does this itself, from the edited lines.)
        labelsKey: null,
        get size() { return current.size; },
    };
}

// A highlight layer that repaints in place.
//
// The editor's textarea text is transparent — the layer *is* what the user reads —
// so a repaint can't be deferred without the typed character appearing late. To
// make a synchronous repaint cheap on a large file, the layer is split into
// chunks of ~`linesPerChunk` lines, each an inline <span> inside the same <pre>
// (inline, so the text lays out exactly as one blob would). An ordinary edit
// touches one chunk, so only that chunk's markup is rebuilt and written.
//
// Chunks hold a line *count*, not fixed line numbers: inserting or deleting a
// line grows or shrinks the chunk that contains it and leaves the rest alone, so
// pressing Enter doesn't rewrite the whole layer either. Anything wider than one
// chunk (a paste, a replace-all) falls back to a full rebuild.
export function createHighlightLayer(el, { linesPerChunk = 100, zeroWidthSpace = '​' } = {}) {
    const cache = createHighlightCache();
    let prevLines = null;      // lines currently rendered (after codepage decode)
    let prevCodepage = null;
    let sizes = [];            // line count per chunk element

    // The document's labels, so a label is coloured the same at its definition and
    // wherever it's used. Rescanning the whole buffer per keystroke would undo the
    // work that made repaints cheap, so this is a multiset kept up to date from the
    // lines the edit actually touched. Counts (not a plain Set) so that deleting one
    // of two identical definitions doesn't drop the label.
    let labelCounts = new Map();
    let labels = new Set();

    function noteLine(line, delta) {
        const name = labelDefinedOn(line);
        if (!name) return false;
        const n = (labelCounts.get(name) || 0) + delta;
        if (n > 0) {
            labelCounts.set(name, n);
            if (labels.has(name)) return false;
            labels.add(name);
            return true;                       // set membership changed
        }
        labelCounts.delete(name);
        labels.delete(name);
        return true;
    }

    function rescanLabels(lines) {
        labelCounts = new Map();
        labels = new Set();
        for (const line of lines) noteLine(line, 1);
    }

    const lineHtml = (line) => {
        let html = cache.get(line);
        if (html === undefined) {
            html = highlightAsmLine(line, labels);
            cache.put(line, html);
        }
        return html;
    };

    // Markup for lines [start, start+count). Every chunk but the last carries the
    // newline that separates it from the next, so the chunks concatenate to the
    // document exactly.
    function chunkHtml(lines, start, count, isLast) {
        const parts = new Array(count);
        for (let i = 0; i < count; i++) parts[i] = lineHtml(lines[start + i]);
        return parts.join('\n') + (isLast ? '' : '\n');
    }

    function rebuild(lines) {
        rescanLabels(lines);
        cache.clear();
        sizes = [];
        const parts = [];
        for (let i = 0; i < lines.length; i += linesPerChunk) {
            const count = Math.min(linesPerChunk, lines.length - i);
            sizes.push(count);
            parts.push('<span>' + chunkHtml(lines, i, count, i + count >= lines.length) + '</span>');
        }
        if (!parts.length) { sizes = [1]; parts.push('<span></span>'); }
        el.innerHTML = parts.join('') + zeroWidthSpace;
        cache.endPass();
    }

    return {
        // Returns what it had to do, for tests and diagnostics
        render(code, viewCodepage = 'raw') {
            if (viewCodepage !== prevCodepage) {
                cache.clear();
                prevLines = null;
                prevCodepage = viewCodepage;
            }
            const decoded = (viewCodepage && viewCodepage !== 'raw')
                ? decodeViewCodepage(code, viewCodepage) : code;
            const lines = decoded.split('\n');

            if (!prevLines || el.children.length !== sizes.length) {
                rebuild(lines);
                prevLines = lines;
                return 'rebuilt';
            }

            // Narrow the edit to [a, …) from the front and [… , n-b) from the back
            const oldN = prevLines.length, newN = lines.length;
            let a = 0;
            while (a < oldN && a < newN && prevLines[a] === lines[a]) a++;
            if (a === oldN && a === newN) return 'unchanged';
            let b = 0;
            while (b < oldN - a && b < newN - a && prevLines[oldN - 1 - b] === lines[newN - 1 - b]) b++;

            // Which chunk holds the edit, in old line numbers?
            let k = 0, start = 0;
            while (k < sizes.length - 1 && start + sizes[k] <= a) { start += sizes[k]; k++; }
            const oldEnd = oldN - b;                 // exclusive
            const delta = newN - oldN;
            const newSize = sizes[k] + delta;
            const withinChunk = oldEnd <= start + sizes[k] && newSize > 0 &&
                                newSize <= linesPerChunk * 2;
            if (!withinChunk) {
                rebuild(lines);
                prevLines = lines;
                return 'rebuilt';
            }

            // Update the label set from the edited lines only. If a label appeared
            // or disappeared, every cached line that mentions it is now stale, so
            // fall back to a full rebuild — that happens when a definition line is
            // edited, not on ordinary typing.
            let labelsChanged = false;
            for (let i = a; i < oldEnd; i++) labelsChanged = noteLine(prevLines[i], -1) || labelsChanged;
            for (let i = a; i < newN - b; i++) labelsChanged = noteLine(lines[i], 1) || labelsChanged;
            if (labelsChanged) {
                rebuild(lines);
                prevLines = lines;
                return 'rebuilt';
            }

            sizes[k] = newSize;
            el.children[k].innerHTML = chunkHtml(lines, start, newSize, k === sizes.length - 1);
            cache.endPass();
            prevLines = lines;
            return 'patched';
        },

        reset() {
            prevLines = null; prevCodepage = null; sizes = [];
            cache.clear(); labelCounts = new Map(); labels = new Set();
        },
        get labelCount() { return labels.size; },
        get chunkCount() { return sizes.length; },
    };
}

// Highlight a whole document. Pass a cache (see createHighlightCache) to make
// repeated calls on a mostly-unchanged document cheap — the usual case while
// typing, where one line differs from the previous pass.
export function highlightAsmCode(code, viewCodepage = 'raw', cache = null) {
    // View-only codepage: the highlight layer paints the visible text (the
    // textarea text is transparent), and the mapping is 1 char -> 1 char,
    // so caret/selection positions stay aligned with the raw content
    if (viewCodepage && viewCodepage !== 'raw') {
        code = decodeViewCodepage(code, viewCodepage);
    }
    const lines = code.split('\n');
    const labels = collectLabels(code);
    if (cache) {
        const key = labels.size + '|' + [...labels].join(',');
        if (cache.labelsKey !== key) { cache.clear(); cache.labelsKey = key; }
    }
    const out = new Array(lines.length);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let html = cache ? cache.get(line) : undefined;
        if (html === undefined) {
            html = highlightAsmLine(line, labels);
            if (cache) cache.put(line, html);
        }
        out[i] = html;
    }
    if (cache) cache.endPass();
    return out.join('\n');
}
