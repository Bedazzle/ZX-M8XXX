# Assembler: Z80 Assembler, T-State Selection Popup

## Z80 Assembler (`sjasmplus/`)

sjasmplus-compatible Z80 assembler. Multi-pass (up to 10 passes) with forward reference resolution.

**Multi-pass assembly** (`assembler.js` `runPasses()`):
- Each pass: reset output, process all lines, check for undefined symbols
- Convergence: stop when no undefined symbols AND no label value changes
- Forward references: unknown symbols get `{ value: 0, undefined: true }` during evaluation, resolved in subsequent passes
- Failure: if undefined count stops decreasing after pass 2, report errors

**Undefined symbol detection** (`expression.js` + `labels.js`):
- When the expression evaluator encounters an unknown identifier, it calls `SymbolTable.reference(name, line, file)` to register it as a forward reference with source location
- `SymbolTable.reference()` creates a `{ defined: false, used: true }` entry if the symbol doesn't already exist; if it exists, just marks `used = true`
- After final pass, `SymbolTable.checkUndefined()` scans for symbols that are `used && !defined`
- Each undefined symbol is reported as a separate error with its file and line number (clickable in the UI)
- `parseExpression()` preserves `ErrorCollector.currentLine/currentFile` across its internal `reset()` call so source locations survive

**Expression evaluation** (`expression.js`):
- Operator precedence: logical or -> logical and -> bitwise or/xor/and -> equality -> comparison -> shift -> additive -> multiplicative -> unary -> primary
- Unary operators: `+`, `-`, `~`, `!`, `HIGH`, `LOW`, `NOT`, `ABS`, `DEFINED` (parentheses optional)
- All operations propagate `undefined` flag -- if any operand is undefined, result is `{ value: 0, undefined: true }`
- `$` = current address, `$$` = section start
- Temp label references: `1B`/`1F` etc. via `SymbolTable.parseTemp()`

**Error reporting** (`errors.js` + `assembler-ui.js`):
- `ErrorCollector.error()` throws `AssemblerError` immediately (halts assembly)
- `ErrorCollector.errors[]` array collects errors with `{ message, line, file }`
- UI catch block checks `ErrorCollector.errors` first -- renders each as a clickable `formatErrorLocation()` line
- Undefined symbols: pushed individually to `ErrorCollector.errors` with per-symbol file/line, then a summary `AssemblerError` is thrown

**DISPLAY directive** (`assembler.js` `dirDISPLAY()`):
- Syntax: `DISPLAY "text", /A, expr, /D, expr` -- comma-separated operands
- Format specifiers are separate operands that modify the next expression's output:
  - `/H` = hex (default): `0x0100`
  - `/D` = decimal: `256`
  - `/A` = hex and decimal: `0x0100, 256`
  - `/B` = binary (8-bit): `00000001`
  - `/C` = character: `'A'`
- Messages collected in `this.displayMessages[]` per pass; only the last pass's messages are emitted as warnings (avoids duplicates from intermediate passes)
- UI renders with cyan `.asm-display` CSS class and `>` prefix, clickable to navigate to source line
- Prefixed with `DISPLAY: ` in `ErrorCollector.warnings` for UI identification

## Assembly Progress Indicator

Shows real-time pass and line progress during assembly.

**UI elements** (`index.html`):
- `#asmProgress` — container (`.asm-progress`, hidden by default)
- `#asmProgressLabel` — pass label ("Assembling...", "Pass 1...", "Pass 2...")
- `#asmProgressFill` — bar fill, width set as percentage via JS
- `#asmProgressPct` — percentage text ("42%")
- Fill bar uses `transition: width 0.15s linear` for smooth updates

**Async assembly** (`assembler.js`):
- `assembleAsync()` / `assembleProjectAsync()` — async entry points mirroring the sync versions
- `runPassesAsync()` — async version of `runPasses()` that yields to the browser via `await setTimeout(0)` every 2000 lines and between passes
- `progressCallback(pass, linesDone, totalLines)` — called at each yield point; set externally before calling async methods

**UI integration** (`assembler-ui.js`):
- Assemble button click → `assembleCode()` (async path): shows progress bar, sets `Assembler.progressCallback` to update label/fill/percentage, awaits `doAssembleAsync()`, hides bar
- Debug button / `assembleCode(true)` (sync path): no progress bar, calls `doAssemble()` directly
- `assembling` flag prevents re-entrance during async assembly
- Assemble and Debug buttons disabled during assembly
- Shared helpers: `prepareAssembly()` (VFS sync, defines), `processAssemblyResult()`, `processAssemblyError()` — used by both sync and async paths

**Assembler options** (toolbar checkboxes, persisted to localStorage):
- **Case insensitive** (`chkAsmCaseInsensitive`, key `zxm8_asmCaseInsensitive`) — when checked, all label names are lowercased during define/lookup so `PlayerHPMAX` and `PlayerHPMax` resolve to the same symbol. Implemented via `SymbolTable.caseInsensitive` flag applied in `getFullName()` before any prefix/module processing. Passed as `options.caseInsensitive` to all four assembly entry points.
- **Unused labels** (`chkAsmUnusedLabels`) — show warnings for defined but unreferenced labels
- **Show compiled** (`chkAsmShowCompiled`) — show hex dump of assembled output

**Source markers** — special comments in source file headers:
- `; @main` — marks this file as the project entry point for assembly (checked in first 20 lines by `VFS.findMainFile()`)
- `; @entry LABEL` or `; @start LABEL` — sets the debug entry point to the given label or address. Accepts a symbol name (resolved from assembled symbols), hex (`$1234` or `0x1234`), or decimal. Parsed from the main file by `processAssemblyResult()`
- `; @define NAME=VALUE` or `; @define NAME` — defines assembler symbols before assembly (checked in first 30 lines by `VFS.getFileDefines()`, defaults to `1` if no value given)

**Debug entry point priority** (`doDebug()` in `assembler-ui.js`):
1. `; @entry` / `; @start` marker (highest priority)
2. SAVESNA command start address
3. Single ORG address (used directly)
4. Multiple ORG addresses (shows "Select Entry Point" dialog)

**Debug with SAVESNA**:
- When the assembled project contains a SAVESNA command, Debug initializes the CPU to the USR 0 machine state matching SNA output: IM 1, IFF1 enabled, SP=0x5D58, I=0x3F, IY=0x5C3A, IX=0xFF3C, BC=entryPoint
- Without SAVESNA, Debug uses minimal state (interrupts disabled) for simple test programs

**Save directives** (`assembler.js`):
- `SAVEBIN "file", start, length` — raw binary
- `SAVESNA "file", startaddr` — SNA snapshot (48K or 128K with DEVICE)
- `SAVETAP "file", ...` — TAP tape (BASIC/CODE/HEADLESS blocks)
- `EMPTYTRD "file"` / `SAVETRD "file", "name", [type,] start, length` — TRD disk image
- `EMPTYTAP "file"` — empty TAP file
- `SAVEHOB "file", "name.X", start, length` — Hobeta file (17-byte header + data). TR-DOS name parsed as 8-char name + extension char (B/C/D/#). Complement of `INCHOB`.

All SAVE directives capture data at the point of declaration (not end of assembly), push to `saveCommands[]`, and support `; md5: <hash>` comment verification.

## File Management

The Files dropdown (`updateFilesList()`) shows all VFS files grouped by directory with sort order: root files first, then directories alphabetically, files alphabetically within each directory.

**Directory headers**: When files share a directory prefix, a `📁` header row is inserted before the group. Files within a directory are indented (`.in-dir` class). The directory prefix is not repeated on individual file rows.

**File/directory removal**: Both file rows and directory headers show a red × button on hover (`.file-delete`, `opacity: 0` → `1` on row hover, red on button hover). Clicking removes the file or all files in the directory from the VFS, closes any open tabs for removed files, re-detects the main file if needed, and refreshes the file list, tabs, and button states.

**VFS methods** (`sjasmplus/vfs.js`):
- `removeFile(path)` — delete a single file by normalized path
- `removeDirectory(dirPath)` — delete all files under a directory prefix

**UI functions** (`ui/assembler-ui.js`):
- `removeVfsFile(path)` — remove file from VFS, close its tab, update UI
- `removeVfsDirectory(dirPath)` — remove all files in directory, close their tabs, update UI

## Undocumented Half-Index Registers

The assembler supports undocumented Z80 half-index register operands: IXH, IXL, IYH, IYL. Aliases XH/HX, XL/LX, YH/HY, YL/LY are also accepted (normalized via `normalizeOperand()` in `instructions.js`).

**Supported instructions** (`instructions2.js`, `instructions3.js`):
- LD: `LD r, IXH` / `LD IXH, r` / `LD IXH, n` / `LD IXH, IXL` — all source/dest/immediate combinations
- INC/DEC: `INC IXH` / `DEC IYL` etc.
- ALU (ADD, ADC, SUB, SBC, AND, XOR, OR, CP): `ADD A, IXH` / `CP IXL` / `OR IYL` etc.

**Encoding**: DD prefix for IX, FD prefix for IY. Register code 4 = high byte, 5 = low byte. Same opcode structure as standard 8-bit register operations with the IX/IY prefix prepended.

## sjasmplus Instruction Extensions

**Multi-register PUSH/POP** (`instructions3.js`):
- `PUSH HL,AF` = `PUSH HL : PUSH AF` — each register pair encoded as a separate instruction
- `POP AF,HL,DE,BC` — pops in listed order
- Supports BC, DE, HL, AF, IX, IY in any combination and count

**Multi-operand INC/DEC** (`instructions2.js`):
- `INC E,DE,E,DE` = `INC E : INC DE : INC E : INC DE` — each operand encoded as a separate instruction
- Supports all operand types: 8-bit registers, 16-bit pairs, IX/IY, (IX+d)/(IY+d), undocumented IXH/IXL/IYH/IYL

**Colon as statement separator** (`parser.js`, `assembler.js`):
- `:` after an indented known instruction name is a statement separator, not a label terminator: `exa : ld a,b` = `EX AF,AF'` then `LD A,B`
- `:` after a column-1 identifier is always a label terminator (even if the name matches an instruction)
- Macro names followed by `:` then an instruction/directive are expanded as macros: `GET_BIT : jr nc,label` = expand `GET_BIT` macro, then `JR NC,label`
- Label-only lines always define a label, even if the name matches a macro (case-insensitive): `wait_key_down:` defines a label even when a `WAIT_KEY_DOWN` macro exists

## Syntax Highlighting (`assembler-ui.js`)

The editor uses a transparent `<textarea>` overlay on a `<pre>` element containing highlighted HTML. The textarea captures input; the pre element shows colored tokens.

- **`tokenizeAsmLine(line)`** — character-by-character state machine tokenizer. Recognizes: instructions, directives, registers, numbers (hex/bin/dec), strings, labels, comments, parentheses, operators. Efficient for individual lines.
- **`highlightAsmCode(code)`** — splits source into lines, tokenizes each, wraps tokens in `<span class="asm-hl-*">` elements, returns HTML string.
- **`updateHighlight()`** — sets `asmHighlight.innerHTML` to the highlighted HTML. Called directly from file open, undo/redo, paste, Tab key, search/replace, and other discrete operations for immediate visual feedback.
- **Debounced input** — the `input` event handler debounces `updateHighlight()` and `updateLineNumbers()` with an 80ms timer. Rapid keystrokes coalesce into a single re-highlight after typing pauses. This prevents DOM thrashing on large files (e.g. hundreds of DEFB lines) which would otherwise cause visible lag in Firefox.
- **`updateLineNumbers()`** — regenerates line number gutter text. Also debounced during typing, immediate for discrete operations.

## T-State Selection Popup

Shows total T-state timing for selected Z80 instructions in the assembler editor.

**Behavior:**
- Select one or more lines of Z80 code in the assembler editor
- After 1.5 seconds of inactivity (no mouse movement, keyboard, or scroll), a popup appears near the selection showing total T-states
- Format: `17/10T` (max/min for conditional instructions), `4T` (fixed), `~12T` (approximate -- some instructions unrecognized), `(N instr)` suffix for multi-instruction selections
- Popup disappears immediately on: mouse move over editor, mouse click, keyboard input, scroll, blur, or selection change
- After hiding due to mouse move, re-appears after 1.5s if selection still exists and user is idle

**Implementation** (`ui/assembler-ui.js`):
- `tstateMap` -- lookup Map built from `z80Opcodes` data: uppercase mnemonic pattern -> T-state string
- `normalizeMnemonic(line)` -- converts source line to canonical opcode table pattern (strips labels, normalizes registers/numbers, handles conditions)
- `lookupTstates(pattern)` -- lookup with fallback: exact match -> `nn` substitution -> `n` substitution -> `(nn)` substitution -> generic register -> `(HL)` fallback
- `computeTstatesForLines(lines)` -- totals min/max T-states, counts instructions and failures
- `showTstatePopup()` -- computes and positions popup; only when `asmEditor` is focused and has selection
- `positionTstatePopupFromTextarea()` -- positions relative to selection end using computed line height and character width
- `scheduleTstateUpdate()` -- 1500ms debounce timer; cancelled by any user interaction
- `hideTstatePopup()` -- clears timer and hides immediately

**CSS**: `.asm-tstate-popup` -- uses `var(--asm-font-size)` to match editor font size, `pointer-events: none`, positioned absolute within editor wrapper

**Event wiring:**
- `selectionchange` -> hide + schedule (if editor focused)
- `mousedown` -> hide
- `mousemove` -> hide + re-schedule (only if popup was visible)
- `keydown` -> hide
- `scroll` -> hide
- `blur` -> hide
