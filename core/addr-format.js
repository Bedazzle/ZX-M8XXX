// addr-format.js — how a 16-bit address is written on screen (pure, no DOM).
//
// One switch (Settings -> Display) decides hex or decimal for every address the
// interface *shows*. It must never reach what the app *writes out*: ASM export,
// project JSON, signature packs, `.pok` files and the file-format code all speak
// hex by definition, so those keep calling hex16() directly. The rule for a call
// site is "would a user retype this into another tool?" — if yes it stays hex.
//
// It is also only for *addresses*. A memory byte, an opcode, a register value or
// an attribute stays hex whatever the switch says: a hex dump in decimal is
// unreadable, and `LD A,255` tells you less than `LD A,FFh` about what a bit
// pattern means.
//
// Width. 65535 is one character wider than FFFF, so a column sized for hex
// reflows the moment the switch is thrown. fmtAddrCol() pads to a fixed five
// characters in both bases, so a layout is sized once and never moves. The pad
// is NBSP rather than a plain space because most of these strings land in
// innerHTML, where a run of ordinary spaces collapses to one.

const PAD = '\u00A0';

// Five: the width of 65535, and of $FFFF with its prefix.
export const ADDR_COL_WIDTH = 5;

let base = 'hex';

// A second, independent switch for *values* -- a memory byte, an opcode, an
// 8-bit operand. Reading a lives counter as 3 rather than 03 is the point of
// it, and it is separate from the address base because the two questions are
// separate: a hex dump with decimal addresses is perfectly sensible, and so is
// the reverse.
let valueBase = 'hex';

// And a third for the OPCODE bytes beside an instruction. Separate again,
// because a decimal dump and a decimal opcode column are different wishes:
// plenty of people learned assembly from books that listed opcodes as decimal
// POKEs, and hex there is genuinely hard for them to read.
let opcodeBase = 'hex';

const listeners = new Set();

export function getAddrBase() { return base; }

function announce() {
    for (const fn of listeners) {
        try { fn(base, valueBase, opcodeBase); } catch (e) { console.error('number-base listener failed', e); }
    }
}

// Returns true when the base actually changed, so a caller can skip a re-render.
export function setAddrBase(next) {
    const wanted = next === 'dec' || next === true ? 'dec' : 'hex';
    if (wanted === base) return false;
    base = wanted;
    announce();
    return true;
}

export function getValueBase() { return valueBase; }

export function getOpcodeBase() { return opcodeBase; }

export function setOpcodeBase(next) {
    const wanted = next === 'dec' || next === true ? 'dec' : 'hex';
    if (wanted === opcodeBase) return false;
    opcodeBase = wanted;
    announce();
    return true;
}

export function setValueBase(next) {
    const wanted = next === 'dec' || next === true ? 'dec' : 'hex';
    if (wanted === valueBase) return false;
    valueBase = wanted;
    announce();
    return true;
}

// Panels re-render themselves when EITHER base changes -- most of them show both
// kinds of number, so splitting the notification would only mean two subscriptions.
// Returns an unsubscribe.
export function onNumberBaseChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// The address as the interface writes it: FFFF or 65535. Unpadded — for prose,
// tooltips and menu items, where a pad would read as a stray gap.
export function fmtAddr(val) {
    const a = val & 0xFFFF;
    return base === 'dec' ? String(a) : a.toString(16).toUpperCase().padStart(4, '0');
}

// Column form, always ADDR_COL_WIDTH wide. Left-aligned (the pad trails): an
// address column is read down its left edge, and what follows it — a label —
// should sit in the same place in both bases.
export function fmtAddrCol(val) {
    return fmtAddr(val).padEnd(ADDR_COL_WIDTH, PAD);
}

// With the `$` the app has always put in front of a hex address in prose --
// dropped in decimal, where `$45056` would be a lie about the base. Use this
// wherever the text used to read `$${hex16(x)}`.
export function fmtAddrSigil(val) {
    return (base === 'hex' ? '$' : '') + fmtAddr(val);
}

// With the trailing `h` an assembler writes after a hex number, likewise dropped
// in decimal. For text that read `${hex16(x)}h`.
export function fmtAddrH(val) {
    return fmtAddr(val) + (base === 'hex' ? 'h' : '');
}

// Right-aligned variant, for a column whose numbers line up on their last digit.
export function fmtAddrColRight(val) {
    return fmtAddr(val).padStart(ADDR_COL_WIDTH, PAD);
}

// Read an address the user typed. An explicit radix always wins over the switch,
// so a pasted `$8000` or `8000h` still means 32768 with decimal turned on — and a
// bare number carrying a hex-only digit can't be decimal, whatever the switch
// says. Returns null for anything it can't read, so a caller can reject rather
// than silently jump to 0.
//
// There is deliberately no `d` suffix for decimal: `004D` is a real hex address,
// so `004d` cannot also mean 4. Decimal is what the switch selects, and a field
// that is always one base passes opts.base instead.
export function parseAddr(text, opts = {}) {
    if (text === null || text === undefined) return null;
    let s = String(text).replace(/[\s\u00A0]/g, '');
    if (!s) return null;

    let radix = null;
    if (/^(\$|0x|0X|#)/.test(s)) {
        radix = 16;
        s = s.replace(/^(\$|0x|0X|#)/, '');
    } else if (/^[0-9a-fA-F]+[hH]$/.test(s)) {
        // No leading-digit rule here, unlike an assembler: this is an address box,
        // not a source line, so `C000h` cannot be confused with a label.
        radix = 16;
        s = s.slice(0, -1);
    }
    if (!s) return null;

    if (radix === null) {
        const b = opts.base || base;
        radix = (b === 'dec' && !/[a-fA-F]/.test(s)) ? 10 : 16;
    }

    if (!(radix === 16 ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/).test(s)) return null;
    const v = parseInt(s, radix);
    return Number.isNaN(v) ? null : v;
}

// Rewrite an address spec the user typed into the hex the core parses:
// `5:C000`, `4000-4FFF`, `45056`, `$B000`, `C000h`. The page prefix is left
// alone -- a page is a bank number, not an address, and it was always decimal.
// Returns null when an address part cannot be read, so the caller refuses the
// input instead of accepting whatever `parseInt` salvaged from it (`FE&FF` used
// to become address $00FE).
//
// Ports are not addresses and never come through here: parsePortSpec has its own
// branch, and a port number stays hex whatever the switch says.
export function specToHex(spec, opts = {}) {
    if (spec === null || spec === undefined) return null;
    let s = String(spec).trim();
    if (!s) return null;

    let prefix = '';
    const colon = s.indexOf(':');
    if (colon !== -1) { prefix = s.slice(0, colon + 1); s = s.slice(colon + 1); }

    const asHex = (part) => {
        const v = parseAddr(part, opts);
        return v === null ? null : (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    };

    const dash = s.indexOf('-');
    if (dash !== -1) {
        const from = asHex(s.slice(0, dash));
        const to = asHex(s.slice(dash + 1));
        return (from === null || to === null) ? null : prefix + from + '-' + to;
    }
    const only = asHex(s);
    return only === null ? null : prefix + only;
}

// A PORT number. It is an address, just in I/O space rather than memory, so it
// follows the address switch -- `OUT 32765,16` is how every BASIC listing and
// magazine type-in writes one, and there is no reason a decimal debugger should
// disagree with them. Width follows the port: $FE stays two digits, $7FFD four.
export function fmtPort(val, is16bit = null) {
    const wide = is16bit === null ? (val & 0xFFFF) > 0xFF : is16bit;
    const v = wide ? (val & 0xFFFF) : (val & 0xFF);
    if (base === 'dec') return String(v);
    return v.toString(16).toUpperCase().padStart(wide ? 4 : 2, '0');
}

// Rewrite a port spec the user typed (`FE`, `7FFD`, `FE&FF`) into the hex the
// core parses. The mask keeps whatever base the port did -- it is typed in the
// same box, and a mask the user cannot read back is worse than a wide one.
// Returns null when either half is unreadable.
export function portSpecToHex(spec) {
    if (spec === null || spec === undefined) return null;
    const s = String(spec).trim();
    if (!s) return null;
    const asHex = (part) => {
        const v = parseAddr(part);
        if (v === null) return null;
        const wide = (v & 0xFFFF) > 0xFF;
        return (v & 0xFFFF).toString(16).toUpperCase().padStart(wide ? 4 : 2, '0');
    };
    const amp = s.indexOf('&');
    if (amp !== -1) {
        const port = asHex(s.slice(0, amp));
        const mask = asHex(s.slice(amp + 1));
        return (port === null || mask === null) ? null : port + '&' + mask;
    }
    return asHex(s);
}

// A byte as the interface writes it: FF or 255. Values, not addresses -- see the
// note on valueBase above. Unpadded: the memory dump sizes its cell in CSS, which
// keeps the grid still whichever base is on.
export function fmtByte(val) {
    const b = val & 0xFF;
    return valueBase === 'dec' ? String(b) : b.toString(16).toUpperCase().padStart(2, '0');
}

// A byte in a fixed-width column of a text dump: two characters in hex, three in
// decimal, right-aligned so the units line up. BYTE_COL_WIDTH is what a gap in the
// column costs, which a dump needs when it runs out of data mid-line.
export function byteColWidth() {
    return valueBase === 'dec' ? 3 : 2;
}

export function fmtByteCol(val) {
    return fmtByte(val).padStart(byteColWidth(), ' ');
}

// The Explorer likes to give a load address both ways at once: `4660 ($1234)`.
// In decimal that is the same number printed twice, so the pair collapses.
function hex16d(v) {
    return (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

export function fmtAddrPair(val) {
    const v = val & 0xFFFF;
    return base === 'dec' ? String(v) : `${v} ($${hex16d(v)})`;
}

// A 16-bit VALUE -- a memory word, not an address. It follows the value base, so
// a word editor showing 1000 is not confused with the address 1000.
export function fmtWord(val) {
    const w = val & 0xFFFF;
    return valueBase === 'dec' ? String(w) : w.toString(16).toUpperCase().padStart(4, '0');
}

// A byte with the `$` the app writes in prose, dropped in decimal for the same
// reason fmtAddrSigil drops it.
export function fmtByteSigil(val) {
    return (valueBase === 'hex' ? '$' : '') + fmtByte(val);
}

// Read a byte the user typed, in the value base. An explicit radix wins, and a
// bare number with a hex-only digit cannot be decimal -- the same rules as
// parseAddr, which this defers to.
export function parseByte(text, opts = {}) {
    return parseAddr(text, { base: opts.base || valueBase });
}

// One byte of an instruction's encoding, as the byte column beside the
// disassembly writes it. Its own switch -- not the value one -- because a hex
// dump of data and a hex dump of code are separate preferences.
export function fmtOpcode(val) {
    const b = val & 0xFF;
    return opcodeBase === 'dec' ? String(b) : b.toString(16).toUpperCase().padStart(2, '0');
}
