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
