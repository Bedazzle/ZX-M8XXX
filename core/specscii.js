/**
 * ZX-M8XXX - SPECSCII text-mode art support
 * @license GPL-3.0
 *
 * SPECSCII (SpectraLab / zxart.ee) is character-based ZX art stored as a raw
 * ZX print-codes stream: printable ZX chars (0x20-0x7F), block graphics
 * (0x80-0x8F) and print control codes (0x0D ENTER, 0x10 INK n, 0x11 PAPER n,
 * 0x12 FLASH n, 0x13 BRIGHT n, 0x14 INVERSE n, 0x15 OVER n, 0x16 AT r c,
 * 0x17 TAB c). No header; a full-screen picture is exactly 32x24 = 768 cells.
 * Format reference: Bedazzle/SpectraLab ZX_SPECTRUM_GRAPHICS_GUIDE.md.
 *
 * The same print-code vocabulary is what TR-DOS catalogue banners are made
 * of (Deja Vu, Body Orgasm, Adventurer disks): fake directory entries whose
 * 8-byte "filenames" hold control codes, drawn when TR-DOS LIST prints them
 * through the ROM print routine. This module converts between the two:
 *
 *   parseSpecscii(bytes)        .specscii stream -> 24x32 cell grid
 *   renderGrid(grid, ...)       cell grid -> canvas (preview)
 *   encodeBannerEntries(grid)   cell grid -> fake catalogue entry names
 *   decodeBannerNames(names)    fake entry names -> cell grid (preview of
 *                               an existing banner disk, junk columns ignored)
 *
 * Banner encoding model (validated against Deja Vu #0A):
 * - Every entry name is 8 bytes: AT(3 bytes) + 5 payload bytes. After the
 *   name TR-DOS prints the row's type/size columns ("junk") at the cursor;
 *   the next entry's AT jumps back and overprints it, so only the final
 *   junk row below the banner survives (authentic - real disks show it too).
 * - Rows are painted in full (all 32 columns), so wrapped junk from the
 *   previous row is always overwritten. Attribute switches are emitted only
 *   on change; trailing pad spaces are safe because the next entry re-ATs.
 * - Two reset entries follow the banner: flash/bright off, then ink 0 /
 *   paper 7, both AT the junk row so the leftovers print black-on-white.
 */

const CTRL_ARG_COUNTS = { 0x10: 1, 0x11: 1, 0x12: 1, 0x13: 1, 0x14: 1, 0x15: 1, 0x16: 2, 0x17: 1 };

export const SPECSCII_COLS = 32;
export const SPECSCII_ROWS = 24;
// AT row must stay in the upper screen (0-21); the banner needs one more
// row below it for the reset/junk line.
export const BANNER_MAX_ROWS = 21;

// Standard ZX palette (GRB bit order like the ULA): [normal 0-7, bright 0-7]
export const SPECSCII_PALETTE = [
    [0, 0, 0], [0, 0, 205], [205, 0, 0], [205, 0, 205],
    [0, 205, 0], [0, 205, 205], [205, 205, 0], [205, 205, 205],
    [0, 0, 0], [0, 0, 255], [255, 0, 0], [255, 0, 255],
    [0, 255, 0], [0, 255, 255], [255, 255, 0], [255, 255, 255]
];

function blankState() {
    return { row: 0, col: 0, ink: 0, paper: 7, bright: 0, flash: 0, inverse: 0 };
}

function newGrid() {
    const grid = [];
    for (let r = 0; r < SPECSCII_ROWS; r++) grid.push(new Array(SPECSCII_COLS).fill(null));
    return grid;
}

// Interpret a ZX print-code stream into a cell grid. Shared by the .specscii
// parser and the catalogue-banner decoder (the latter feeds entry names).
function interpretStream(bytes, grid, state, warnings) {
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 0x0D) { state.row++; state.col = 0; continue; }
        const argc = CTRL_ARG_COUNTS[b];
        if (argc !== undefined) {
            const a1 = bytes[i + 1], a2 = bytes[i + 2];
            i += argc;
            switch (b) {
                case 0x10: state.ink = a1 & 7; break;
                case 0x11: state.paper = a1 & 7; break;
                case 0x12: state.flash = a1 & 1; break;
                case 0x13: state.bright = a1 & 1; break;
                case 0x14: state.inverse = a1 & 1; break;
                case 0x15: warnings.push('OVER control ignored'); break;
                case 0x16: state.row = a1; state.col = a2; break;
                case 0x17: state.col = a1 & 31; break;
            }
            continue;
        }
        if (b < 0x20) continue; // unused codes print nothing
        if (b >= 0x90) warnings.push('char 0x' + b.toString(16) + ' (UDG/token) kept as-is');
        if (state.col >= SPECSCII_COLS) { state.row++; state.col = 0; }
        if (state.row >= 0 && state.row < SPECSCII_ROWS && state.col >= 0 && state.col < SPECSCII_COLS) {
            grid[state.row][state.col] = {
                ch: b,
                ink: state.inverse ? state.paper : state.ink,
                paper: state.inverse ? state.ink : state.paper,
                bright: state.bright,
                flash: state.flash
            };
        }
        state.col++;
    }
}

// Parse a .specscii file into { grid, cellCount, warnings }
export function parseSpecscii(bytes) {
    const grid = newGrid();
    const warnings = [];
    interpretStream(bytes, grid, blankState(), warnings);
    let cellCount = 0;
    for (const row of grid) for (const c of row) if (c) cellCount++;
    return { grid, cellCount, warnings };
}

// Decode an existing catalogue banner: names = array of 8-byte name arrays
// in catalogue order. Junk columns TR-DOS prints between entries are not
// simulated, so the preview is slightly cleaner than a real LIST.
export function decodeBannerNames(names) {
    const grid = newGrid();
    const warnings = [];
    const state = blankState();
    for (const nm of names) interpretStream(nm, grid, state, warnings);
    return { grid, warnings };
}

// Serialize a cell grid back to a clean .specscii print-code stream (the inverse
// of parseSpecscii): one AT per used row, attribute controls emitted only on
// change, trailing background cells trimmed. Round-trips: parseSpecscii of the
// output reproduces the content cells. Used to extract a catalogue banner as a
// reusable .specscii file.
export function gridToSpecscii(grid) {
    const out = [];
    const isBg = (c) => !c || (c.ch === 0x20 && c.paper === 7 && !c.bright && !c.flash);
    const rows = lastContentRow(grid) + 1;
    let ink = -1, paper = -1, bright = -1, flash = -1;
    for (let r = 0; r < rows; r++) {
        let end = SPECSCII_COLS - 1;
        while (end >= 0 && isBg(grid[r][end])) end--;
        out.push(0x16, r, 0);   // AT row, 0
        for (let c = 0; c <= end; c++) {
            const cell = grid[r][c] || { ch: 0x20, ink: 0, paper: 7, bright: 0, flash: 0 };
            if (cell.ink !== ink) { out.push(0x10, cell.ink); ink = cell.ink; }
            if (cell.paper !== paper) { out.push(0x11, cell.paper); paper = cell.paper; }
            if (cell.flash !== flash) { out.push(0x12, cell.flash); flash = cell.flash; }
            if (cell.bright !== bright) { out.push(0x13, cell.bright); bright = cell.bright; }
            out.push(cell.ch);
        }
    }
    return new Uint8Array(out);
}

// Extract a catalogue banner (array of 8-byte entry names) as a clean .specscii
// byte stream — decode → grid → re-serialize.
export function bannerNamesToSpecscii(names) {
    return gridToSpecscii(decodeBannerNames(names).grid);
}

// True if an 8-byte catalogue name looks like a banner slice (print controls)
export function isBannerName(nameBytes) {
    for (let i = 0; i < 8; i++) {
        const b = nameBytes[i];
        if (b >= 0x0D && b <= 0x17 && (b === 0x0D || CTRL_ARG_COUNTS[b] !== undefined)) return true;
    }
    return false;
}

// Bottom-most row that holds any non-background cell, -1 if none.
// Background = empty, or a space over paper 7 with no bright/flash.
export function lastContentRow(grid) {
    for (let r = SPECSCII_ROWS - 1; r >= 0; r--) {
        for (const c of grid[r]) {
            if (!c) continue;
            if (c.ch !== 0x20 || c.paper !== 7 || c.bright !== 0 || c.flash !== 0) return r;
        }
    }
    return -1;
}

// ==================== Rendering ====================

// Render the grid onto a 2D canvas context at 256x192 (cell = 8x8).
// charset: 768-byte ROM font (glyphs 0x20-0x7F, 8 bytes each) or null -
// without it text chars render as a checker placeholder; block graphics
// (0x80-0x8F) are always drawn procedurally (bit0=TR bit1=TL bit2=BR bit3=BL).
export function renderGrid(grid, ctx, charset = null, palette = SPECSCII_PALETTE) {
    const img = ctx.createImageData(SPECSCII_COLS * 8, SPECSCII_ROWS * 8);
    const px = img.data;
    for (let r = 0; r < SPECSCII_ROWS; r++) {
        for (let c = 0; c < SPECSCII_COLS; c++) {
            const cell = grid[r][c] || { ch: 0x20, ink: 0, paper: 7, bright: 0, flash: 0 };
            const inkRgb = palette[cell.ink + (cell.bright ? 8 : 0)];
            const papRgb = palette[cell.paper + (cell.bright ? 8 : 0)];
            for (let y = 0; y < 8; y++) {
                let rowBits = 0;
                const ch = cell.ch;
                if (ch >= 0x80 && ch <= 0x8F) {
                    const q = ch - 0x80;
                    const top = y < 4;
                    const left = ((top ? (q & 2) : (q & 8)) !== 0);   // TL / BL
                    const right = ((top ? (q & 1) : (q & 4)) !== 0);  // TR / BR
                    rowBits = (left ? 0xF0 : 0) | (right ? 0x0F : 0);
                } else if (ch >= 0x20 && ch < 0x80 && charset) {
                    rowBits = charset[(ch - 0x20) * 8 + y];
                } else if (ch !== 0x20) {
                    rowBits = (y & 1) ? 0x55 : 0xAA; // placeholder checker
                }
                for (let x = 0; x < 8; x++) {
                    const on = (rowBits & (0x80 >> x)) !== 0;
                    const rgb = on ? inkRgb : papRgb;
                    const o = (((r * 8 + y) * SPECSCII_COLS * 8) + c * 8 + x) * 4;
                    px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
                }
            }
        }
    }
    ctx.putImageData(img, 0, 0);
}

// ==================== Banner encoding ====================

// Per-char attribute relevance: components that must match the cell for the
// print to look right. Spaces have no ink pixels; 0x8F solid blocks have no
// paper pixels.
function relevantAttrs(ch) {
    if (ch === 0x20) return ['paper', 'bright', 'flash'];
    if (ch === 0x8F) return ['ink', 'bright', 'flash'];
    return ['ink', 'paper', 'bright', 'flash'];
}

const SWITCH_CODE = { ink: 0x10, paper: 0x11, flash: 0x12, bright: 0x13 };

// Byte stream for one full row (32 cells), continuing `state` (mutated).
function rowStream(gridRow, state) {
    const out = [];
    for (let c = 0; c < SPECSCII_COLS; c++) {
        const cell = gridRow[c] || { ch: 0x20, ink: 0, paper: 7, bright: 0, flash: 0 };
        for (const k of relevantAttrs(cell.ch)) {
            if (state[k] !== cell[k]) {
                out.push(SWITCH_CODE[k], cell[k]);
                state[k] = cell[k];
            }
        }
        out.push(cell.ch);
    }
    return out;
}

// Split a row stream into AT-prefixed 8-byte entry names (AT + 5 payload).
// A chunk never splits a switch+arg pair. Short chunks are padded with spaces
// — safe mid-banner because the next entry re-ATs to the true column and the
// padded cells get repainted.
// exact=true (last banner row): pad spaces would wrap onto the reset row and
// survive, so the final chunk is topped up with non-printing bytes instead:
// pad 2/4 -> no-op ink re-switches, pad 3 -> AT to the junk row (where the
// cursor heads next anyway), pad 1 -> the trailing printable char moves to
// its own exactly-full chunk. The row stream always ends with a printable
// (the column-31 char), which makes the pad-1 move well-defined.
function chunkRow(stream, row, junkRow, inkNoop, exact) {
    // Cut the stream into 1-byte (printable) / 2-byte (switch+arg) units
    const units = [];
    for (let i = 0; i < stream.length;) {
        const sz = (stream[i] >= 0x10 && stream[i] <= 0x13) ? 2 : 1;
        units.push(stream.slice(i, i + sz));
        i += sz;
    }
    // Greedy pack into chunks of <= 5 payload bytes
    const chunks = [];
    let col = 0;
    let cur = { bytes: [], colStart: 0 };
    for (const u of units) {
        if (cur.bytes.length + u.length > 5) {
            chunks.push(cur);
            cur = { bytes: [], colStart: col };
        }
        cur.bytes.push(...u);
        if (u.length === 1) col++;
    }
    chunks.push(cur);
    if (exact) {
        let last = chunks[chunks.length - 1];
        const pad = 5 - last.bytes.length;
        if (pad === 1) {
            const ch = last.bytes.pop();                      // trailing printable
            last.bytes.push(0x10, inkNoop);                   // now exactly 5
            chunks.push({ bytes: [ch, 0x10, inkNoop, 0x10, inkNoop], colStart: col - 1 });
        } else if (pad === 2) {
            last.bytes.push(0x10, inkNoop);
        } else if (pad === 3) {
            last.bytes.push(0x16, junkRow, 0);
        } else if (pad === 4) {
            last.bytes.push(0x10, inkNoop, 0x10, inkNoop);
        }
    }
    return chunks.map(ch => {
        const name = [0x16, row, ch.colStart, ...ch.bytes];
        while (name.length < 8) name.push(0x20);              // space pad (re-AT heals)
        return name;
    });
}

// Encode grid rows [0..rows-1] as fake TR-DOS catalogue entry names.
// Returns { names: Uint8Array(8)[], warnings }. Throws on rows out of range.
export function encodeBannerEntries(grid, rows) {
    if (!rows || rows < 1) throw new Error('specscii: banner needs at least 1 row');
    if (rows > BANNER_MAX_ROWS) throw new Error('specscii: banner limited to ' + BANNER_MAX_ROWS + ' rows (AT upper-screen limit)');
    const warnings = [];
    // state starts unknown so the first cell emits all its attribute switches
    const state = { ink: -1, paper: -1, bright: -1, flash: -1 };
    const names = [];
    for (let r = 0; r < rows; r++) {
        const stream = rowStream(grid[r], state);
        const inkNoop = state.ink < 0 ? 0 : state.ink; // re-switch = visual no-op
        for (const nm of chunkRow(stream, r, rows, inkNoop, r === rows - 1)) {
            names.push(Uint8Array.from(nm));
        }
    }
    // Reset entries on the junk row (Deja Vu scheme): flash/bright off first,
    // then ink 0 / paper 7; both AT(row,0) so the second's junk overprints the
    // first's in black-on-white. One junk line remains - authentic.
    const jr = rows;
    names.push(Uint8Array.from([0x16, jr, 0, 0x12, 0, 0x13, 0, 0x20]));
    names.push(Uint8Array.from([0x16, jr, 0, 0x10, 0, 0x11, 7, 0x20]));
    return { names, warnings };
}

// Simulate what TR-DOS LIST paints for generated entries, INCLUDING the junk
// columns each row print leaves behind (" <T> nnn..."), to verify the encoder's
// overprint claims in tests. Junk text is approximated; what matters is that
// it lands where the design says it gets overwritten.
export function simulateListPrint(names, junkText = '<C> 000 00000 00000') {
    const grid = newGrid();
    const warnings = [];
    const state = blankState();
    for (const nm of names) {
        interpretStream(nm, grid, state, warnings);
        // TR-DOS prints the catalogue columns then a newline
        const junk = [];
        for (let i = 0; i < junkText.length; i++) junk.push(junkText.charCodeAt(i));
        junk.push(0x0D);
        interpretStream(junk, grid, state, warnings);
    }
    return { grid, warnings };
}
