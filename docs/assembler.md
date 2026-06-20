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

**Assembler options** (⚙ gear popover in the toolbar, persisted to localStorage):
- **Case insensitive** (`chkAsmCaseInsensitive`, key `zxm8_asmCaseInsensitive`) — when checked, all label names are lowercased during define/lookup so `PlayerHPMAX` and `PlayerHPMax` resolve to the same symbol. Implemented via `SymbolTable.caseInsensitive` flag applied in `getFullName()` before any prefix/module processing. Passed as `options.caseInsensitive` to all four assembly entry points.
- **Unused labels** (`chkAsmUnusedLabels`) — show warnings for defined but unreferenced labels
- **Show compiled** (`chkAsmShowCompiled`) — show hex dump of assembled output
- **Export as ZIP** (`chkAsmExportZip`, key `zxm8_asmExportZip`) — force ZIP export for single files (multi-file projects always export as ZIP); moved here from Settings → Display
- **View enc** (`asmViewCodepage`, key `zxm8_asmViewCodepage`: `raw`/`cp866`/`koi8`/`koi7`) — display codepage for raw bytes in the editor (Cyrillic `DB` strings of imported TR-DOS sources). Display-only: the transform (`decodeViewCodepage` in `core/asm-detok.js`) is applied in `highlightAsmCode()` (the highlight layer paints the visible text while the textarea text is transparent) and maps 1 char → 1 char, so caret/selection positions stay aligned and the file content / assembled bytes are untouched. CP866 and KOI8-R decode the high half 0x80–0xFF; KOI-7 N2 remaps the lowercase Latin range 0x60–0x7E to uppercase Cyrillic (that's the encoding's design — lowercase code will display as Cyrillic too). The earlier boolean `zxm8_asmCp866View` key is migrated.
- **Font** (`asmFontSize`, key `zxm8_asmFontSize`) — editor font size, also adjustable with Ctrl+Plus/Ctrl+Minus

The popover (`btnAsmViewOpts` / `asmViewOptsPopover`) follows the same pattern as the disassembly view options gear: toggle on click, close on outside click. Element ids are unchanged, so all existing handlers and persistence work as before.

**Output splitter**: a drag bar (`#asmOutputSplitter`, wired via `initSplitter()` in `ui/tab-system.js` with inverted drag — the bar sits above the pane) resizes the Output pane via `--asm-output-h` (default behavior: auto height up to 200px). Clamped 60–500px, key `zxm8_asmOutputHeight`, double-click resets.

**Area height splitter**: a drag bar at the bottom of `.assembler-container` (`#asmHeightSplitter`) resizes the whole assembler area via `--asm-container-h` (default: `calc(100vh - 200px)` capped at 900px). Clamped 500–2000px, key `zxm8_asmContainerHeight`. Use it to grow editor and output together on tall monitors; the upper bar apportions the space between them.

**Split editor pane** (◫ toolbar button, `btnAsmSplit`): a second editor pane (`asmEditor2`/`asmHighlight2`/`asmLineNumbers2` inside `#asmPane2`) with its own file dropdown (`asmPane2File`, rebuilt from the VFS on open — guarded by a file-list signature in `dataset.sig`, because Firefox fires `mousedown` on the select when an option is clicked and an unconditional rebuild would reset the choice). The dropdown lives in `#asmPane2Header` inside the file-tabs row (`.asm-tabs-row`, same `--asm-pane2-w` flex basis so it aligns above the pane) — keeping it out of the editor area means both panes' line rows start at the same height. Two modes, decided by `pane2IsMirror()`:
- **Different file**: edits write straight to `VFS.files[path].content` on input (the main editor's `syncEditorToVFS()` flow is untouched) and mark the file modified.
- **Same file / unsaved buffer** (`pane2Path === currentOpenFile` or `null`): the panes mirror each other's content on every input, both directions — same file, two scroll positions.

The pane reuses `highlightAsmCode()` and the `.asm-textarea`/`.asm-highlight` classes (so font-size Ctrl+/− applies); Tab inserts 4 spaces. Files can be sent to it via the file-tab right-click menu ("Open in other pane", `showTabContextMenu()`/`openInSplitPane()` — the menu also took over "Set as main file", previously a direct right-click action, plus "Close tab") or with Shift+Enter in the Ctrl+G palette. Palette navigation is pane-aware (`asmActivePane`, tracked via editor focus events): Enter (`gotoSourceLine`) targets the last-focused pane, Shift+Enter (`gotoSourceLineSplit`) the other one; with no split open both default to the main editor / open the split respectively. Search/replace, custom undo, autocomplete, and the T-state popup work only in the main pane. Width via `--asm-pane2-w` (`#asmPaneSplitter`, inverted-x, 240–1200px, key `zxm8_asmPane2Width`); split state and file persist (`zxm8_asmSplit`, `zxm8_asmPane2File`) and are restored at startup.

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
- `LABELSLIST "file"` — text labels file in the sjasmplus "unreal speccy" `.l` format: one `PP:AAAA name` line per defined label/EQU (`PP` = 2-hex memory page from the active `DEVICE` slot map, `AAAA` = 4-hex address), sorted by address. Content is built at end of assembly (once all symbols resolve), not at the declaration point.
- `TAPOUT "file"[, flagbyte]` … `TAPEND` — wrap the bytes emitted between the two directives into one standard ZX tape block: `[len_lo][len_hi][flag][data…][checksum]`, where `len = data + 2` (flag + checksum), `checksum = flag XOR all data bytes`, and `flag` defaults to `0xFF`. Bytes are captured in emission order (handled via the `emit()` hook, so `ORG` jumps inside a block are honoured). Multiple `TAPOUT`/`TAPEND` pairs to the same filename append blocks. `TAPEND` without a matching `TAPOUT` (or a second `TAPOUT` before `TAPEND`) is an error.

All SAVE directives capture data at the point of declaration (not end of assembly), push to `saveCommands[]`, and support `; md5: <hash>` comment verification.

## File Management

The toolbar keeps only the build loop (Assemble, Debug, Download); all project actions live in the **Project ▼** menu (`btnAsmFiles` / `asmProjectMenu`): New file, Load…, Import foreign…, Import from clipboard, Beautify…, Export…, Share to clipboard, Inject into memory, Clear all — followed by the project file list. Export/Share gray out (`disabled`) when there is nothing to export, Inject until something is assembled; the menu button itself is always enabled. Action ids are unchanged (`btnAsmNew`, `btnAsmLoad`, `btnAsmImport`, `btnAsmExport`, `btnAsmShare`, `btnAsmInject`, `btnAsmClear`), so handlers and external references still work.

The file list section (`updateFilesList()`, container `asmFilesList` inside the menu) shows all VFS files grouped by directory with sort order: root files first, then directories alphabetically, files alphabetically within each directory.

**Directory headers**: When files share a directory prefix, a `📁` header row is inserted before the group. Files within a directory are indented (`.in-dir` class). The directory prefix is not repeated on individual file rows.

**File/directory removal**: Both file rows and directory headers show a red × button on hover (`.file-delete`, `opacity: 0` → `1` on row hover, red on button hover). Clicking removes the file or all files in the directory from the VFS, closes any open tabs for removed files, re-detects the main file if needed, and refreshes the file list, tabs, and button states.

**VFS methods** (`sjasmplus/vfs.js`):
- `removeFile(path)` — delete a single file by normalized path
- `removeDirectory(dirPath)` — delete all files under a directory prefix

**UI functions** (`ui/assembler-ui.js`):
- `removeVfsFile(path)` — remove file from VFS, close its tab, update UI
- `removeVfsDirectory(dirPath)` — remove all files in directory, close their tabs, update UI

## Import Foreign Sources

**Project ▼ → Import foreign…** (`ui/import-foreign.js`, dialog `importForeignDialog`) imports sources written for other ZX Spectrum assemblers and converts them to sjasmplus syntax so they assemble in the normal workflow.

**Input containers**: `.trd` and `.scl` disk images (catalog listed via `TRDLoader`/`SCLLoader`), `.zip` archives, and single files — including Hobeta-wrapped (`$`-files, 17-byte header parsed by `AsmDetok.parseHobeta`). A disk image found *inside* a ZIP is expanded into its catalog files too (SCL recognized by its `SINCLAIR` magic regardless of extension, TRD by `.trd` extension + size check). If the archive contains **several** disk images, a chooser step lists the disks (name + file count) and the user picks the exact one to open — a "◀ choose another disk" row switches back; non-disk files from the archive are listed alongside the chosen disk's catalog. Drag & drop onto the dialog works; the drop handler stops propagation so the global handlers don't insert the disk into the emulator.

**Detection** (`core/asm-detok.js`): ALASM is recognized by its 8-byte signature `F3 76 C7 DD FD ED B0 D9` (line data starts 24 bytes after it). TASM is recognized from TR-DOS catalog metadata — type char `A` with start address 39221/40872 (TASM 3) or ≤4096 (TASM 4) — or, without metadata, by validating its `len, content, len` line framing. STORM is recognized from catalog metadata (type `C` + start `#C00B`/`#C003`, or `R` + `#C00B`). ADS is recognized by its line framing — 16-bit strictly ascending line numbers, `0x00`-terminated content, `0xFFFF` end marker. MASM, ZXASM and XAS are recognized from catalog metadata but not yet supported (rows show "not supported yet", default to binary import). Detection source is shown per file and can be overridden with the per-row format dropdown (ALASM / TASM 3.x / TASM 4.x / ADS / STORM / ALASM (text) / TASM (text) / GENS (text) / Zeus (text) / Pasmo (text) / Text as-is / Binary).

**Detokenizers** are faithful ports of the xLook v0.2b FAR plugin sources (ALASM.CPP, TASM.CPP, STORM.CPP): token tables, space-run compression (`0x0A`+count in TASM 3, `0x01`+count in TASM 4), comment/string/Russian-text modes, TASM 4 token reassignments (DEFMAC/DISPLAY/ENDMAC). STORM is the most complex format: lines are stored back-to-front (each ends with a length byte, the table is walked from the file end), mnemonics may be implicit in operand bytes (LD/EX/OUT/JR/CALL ranges), expressions are fully tokenized (8 number formats, recursive sub-expressions, infix/postfix operator tables) and labels are bit-packed 6-bit strings. ALASM comment text is decoded from CP866 (Russian comments become readable Cyrillic); string literals stay byte-exact so `DB "..."` data reassembles unchanged. TASM keeps token decoding inside comments — real TASM sources tokenize register names there (`; HL=|B-D|...`). Plain-text imports (`bytesToText`) also decode CP866 outside double-quoted strings.

**Dialect conversion** (`core/asm-convert.js`) is line-based and string/comment-aware; unchanged lines pass through byte-identical. For the tokenized dialects (ALASM/TASM/ADS/STORM) a pre-pass renames labels whose names sjasmplus can't parse — ALASM allows almost any character in identifiers (real-world: `out[DE]`, `^ay`) — replacing invalid chars with `_` deterministically (same name → same rename in every file of a project) and rewriting declarations and references together, with one warning per renamed label; strings are protected, and a rename colliding with an existing label gets a `__renamed` suffix. Dialects: `alasm`, `tasm`/`tasm4`, `ads`, `storm` (also applied after detokenization), `gens`, `zeus`, `pasmo` (text-level), `text` (pass-through). ADS (a TASM-family editor, reverse-engineered from real sources — its tokens are exactly the TASM table with `u16 lineno + content + 0x00` framing): unclosed char literals are closed (`LD A,"A` → `"A"`, disambiguated from real strings like `DEFM "Tracks :"` by the character after the literal), Zeus-style `DEFM /slash/` strings converted, `:`-separated multi-statement lines are split into real lines (ADS allows labels after `:` and statements at column 0), and indented labels (`   push DEFW #3FC0`) are hoisted to column 0 (a next-word directive is proof of a label; an instruction too, unless the first word is a flow op like `JP label`). Label renames are built project-wide via `opts.renames` (a label like `ANT@` declared in one file renames identically in files that only reference it) — the Import dialog collects declarations across all selected sources first. Zeus (rules verified against the original Crystal Computing manual): slash strings `DEFM /HELLO/` → quotes (comma-aware), line numbers stripped, overflow condition names `V`/`NV` → `PE`/`PO` (JP/CALL/RET), `ENT` (entry point) commented, `DISP` commented with a warning — Zeus DISP displaces *placement* relative to ORG while code runs at ORG, the inverse of sjasmplus DISP, so it needs a manual ORG/DISP rewrite. `PROC`/`ENDP`/`RETP`/`MEND` (modern Zeus for Windows extensions, not in the tape original) are also handled: PROC keeps its label as the `.local` scope anchor, RETP→RET, MEND→ENDM. Text files with Zeus hallmarks (slash DEFM, PROC/MEND/RETP) are auto-suggested as Zeus. STORM: `INCL`/`INCB`→`INCLUDE`/`INCBIN`, `EIF`→`ENDIF`, `IFD`/`IFND`→`IFDEF`/`IFNDEF`, `IFU`/`IFNU`→`IFDEF`/`IFNDEF` with a semantics warning (used ≠ defined), `\` (modulo)→`%`, `=N` local-label references→`.N` (matching the `.N` declarations, which warn for scope review; equality `X=2` and comparisons are left alone), unknown STORM operators (`` ` ``, `?`, `@`) warn. GENS: line numbers are stripped (`10 START LD A,5` → `START LD A,5`, numbered comment lines too), `ENT` (run address) and `*` assembler controls are commented with warnings — each `*` command gets its meaning appended per the GENS3 manual §2.9 (`; [import] *L+  ; listing on`; `*D±` decimal/hex listing addresses, `*C±` short/full listing, `*M±` macro expansion listing, `*E` eject, `*H` heading, `*S` pause listing); `*F` (continue assembly from a tape file) warns that the continuation file must be imported separately. Pasmo: word operators in operand position become symbols (`AND`→`&`, `OR`→`|`, `XOR`→`^`, `NOT`→`~`, `MOD`→`%`, `SHL`/`SHR`→`<<`/`>>`, `EQ`/`NE`/`LT`/`LE`/`GT`/`GE`→comparisons) with quoted strings protected, BASIC-style literals are converted (`&HFF`→`#FF`, `&X1010`→`%1010`, `&O77`→decimal, `0101b`→`%0101`), `PUBLIC`/`LOCAL`/`IRP` are commented with warnings, `END addr` warns that the entry address is ignored; `$hex`, `0FFh`, `DEFL`, single-quote chars and `name MACRO` are natively supported and pass through. In the Import dialog, text files are auto-suggested as GENS when line-numbered or when `*` control lines are present. Rules: `EXD`→`EX DE,HL`, `JZ/JNZ/JC/JNC x`→`JP cc,x`, `INF`→`IN F,(C)`, `SLI`→`SLL`, `IFN e`→`IF !(e)`, `UNPHASE`→`DEPHASE`, `DM`→`DB`, TASM4 `DEFMAC n`→`n MACRO`/`ENDMAC`→`ENDM`, ALASM `'label`→`HIGH label` (the apostrophe in `AF'` and inside strings is untouched), ALASM chained `LD H,D,L,E` split into separate LDs, column-0 labels colliding with instruction/directive names (e.g. `MUL`) get a colon. `MAIN`, `LOCAL`/`ENDL`, `REPEAT`/`UNTIL` and `DD` are commented out with `; [import]` and a warning. `INCLUDE`/`INCBIN` targets are remapped to the VFS names of co-imported files (TR-DOS names matched with or without the type extension); unmatched targets keep their name and warn.

**Import**: checkboxes select files (all on by default — binaries import as-is so `INCBIN` keeps working); converted sources are saved as `name.a80`. The preview pane shows the converted text with a warning header. Import lands everything in the VFS via `asmAPI.addProjectFiles(files, mainHint)`, which refreshes tabs/buttons and opens the first imported source (set as main file if the project had none). The dialog closes on Esc but not on an outside click (so a misclick can't discard the loaded catalog and format choices).

**Load vs Import foreign**: these are deliberately separate. **Load…** opens files into the project as-is — text stays text, binary stays binary, lossless round-trip — and never rewrites code. **Import foreign…** detokenizes/converts (lossy, one-way). To bridge the easy confusion, Load runs the same `AsmDetok.detect` on each binary it adds and, when one looks like a convertible foreign source (ADS/ALASM/TASM/STORM), appends a hint to its status message pointing at Import foreign…; genuinely-binary blobs (no detected format) produce no hint.

## Beautify

**Project ▼ → Beautify…** (`core/asm-beautify.js`, dialog `beautifyDialog`) reformats the source — useful after importing badly-formatted foreign sources. The transform is pure (`beautify(text, opts)`), string/comment-aware (literals and comment text are never altered), and idempotent (running it twice is a no-op). The dialog shows a live before/after preview of the current file and persists its options to `zxm8_beautify`.

Transforms (each a checkbox unless noted):
- **Case** (select: UPPERCASE / lowercase / leave) — folds only instructions, registers, conditions and directives; labels, identifiers, numbers and strings keep their case.
- **Space after commas** — `LD A,5` → `LD A, 5`; no space before the comma; commas inside strings untouched.
- **One statement per line** — splits top-level `:`-separated statements (string-aware) into separate lines; a leading label stays with the first statement.
- **Label on its own line** — `START LD A,5` → `START` then the indented instruction; skipped for label-consuming directives (`EQU`, `=`, `DEFL`, `MACRO`, `STRUCT`, `PROC`) where the label must stay attached.
- **Blank line after flow control** — inserts one blank line after a statement that unconditionally leaves the block: `RET` (no condition), `JP nn`/`JR nn` (no leading condition), `RST`. `RET Z`, `JP NZ,loop`, `CALL` and `DJNZ` do *not* trigger a break (they fall through / return); no blank is added at end of file or where one already exists.
- **Blank line after block ops** — inserts a blank line after a repeating block instruction (`LDIR`, `LDDR`, `CPIR`, `CPDR`, `INIR`, `INDR`, `OTIR`, `OTDR`). Independent of the flow-control option (off by default).
- **Normalize pseudo-ops** — `EXA` → `EX AF,AF'`, `SLI`/`SL1` → `SLL`.
- **Expand multi-register PUSH/POP/LD** — `PUSH AF,HL,BC,DE` → one `PUSH` per line; chained `LD H,D,L,E` → `LD H,D` / `LD L,E` (even operand counts only).
- **Blank line before routines** — inserts a blank line before each top-level label (not local `.labels`), separating subroutines.
- **Space after `;` in comments** — `;text` → `; text`; a `;; banner` (semicolons then space) is left as-is.
- **Align operands into columns** (tabular) — pads the mnemonic field so operands start at a fixed column (`operandCol`, default 16), making a routine line up vertically.
- **Align trailing comments** — pads each line so its `;` comment starts at a common column (`commentCol`, default 32; long lines fall back to a single space).
- **Hex** (select: Leave / `#` / `$` / `0x` / `0FFh`) — unifies hex notation: `$FF`, `#FF`, `0xFF`, `0FFh` all become the chosen form. Converting to the `h` suffix adds a guard zero when the value starts with a hex letter (`$FF`→`0FFh`); converting away from it drops the guard zero. Bare `$` (current address) and `$+n`/`$-n` relative refs are left alone; hex inside strings is untouched.
- **Binary** (select: Leave / `%` / `0b` / `1010b`) — unifies binary notation. The `b` suffix form is padded to a minimum of 3 digits (`%10`→`010b`) because the assembler reads a 1–2 digit `Nb` as a temp-label reference, not binary. The modulo operator (`COUNT%10`, `5 % 2`) is never mistaken for a `%` binary literal.
- **Octal** (select: Leave / `77o` / `77q`) — unifies the octal suffix; sjasmplus has no octal prefix form.
- **Indent instructions to column 8** — instruction lines are padded to column 8 (label-and-code lines pad the label to column 8); off uses a single tab.
- **Trim trailing whitespace** and **Collapse blank lines** (3+ consecutive blanks → 1).
- **Apply to all project files** — reformats every `.asm`/`.z80`/`.s`/`.a80`/`.inc` file in the VFS instead of just the open one.

Apply is a single undoable edit (`asmUndoPushImmediate`), so Ctrl+Z restores the pre-beautify text. The dialog (like Import Foreign and the encoding picker) closes on Esc but not on an outside click, so a misclick can't discard the configured options. The preview pane is height-bounded (`.bf-cols` max 72vh) and scrolls internally for long files.

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
- Format: `17/10T` (max/min for conditional instructions), `4T` (fixed), `~12T` (approximate -- some instructions unrecognized), with a `(N instr, M bytes)` suffix. The byte count is summed from the opcode table (`op.b`) and multiplied through DUP/REPT just like T-states, so it reflects the real assembled size of a repeated block.
- Popup disappears immediately on: mouse move over editor, mouse click, keyboard input, scroll, blur, or selection change
- After hiding due to mouse move, re-appears after 1.5s if selection still exists and user is idle

**Implementation** (`ui/assembler-ui.js`):
- `tstateMap` / `tbyteMap` -- lookup Maps built from `z80Opcodes` data: uppercase mnemonic pattern -> T-state string / byte size (`op.b`)
- `normalizeMnemonic(line)` -- converts source line to canonical opcode table pattern (strips labels, normalizes registers/numbers, handles conditions)
- `lookupOp(map, pattern)` -- lookup with fallback: exact match -> `nn` substitution -> `n` substitution -> `(nn)` substitution -> generic register -> `(HL)` fallback; `lookupTiming`/`lookupBytes` wrap it over the two maps
- `computeTstatesForLines(lines)` -- totals min/max T-states and byte size, counts instructions and failures. `DUP`/`REPT`...`EDUP`/`ENDR` blocks multiply their body by the repeat count (nested blocks multiply; `parseRepeatCount()` accepts decimal, `$`/`#`/`0x` hex, and `h`-suffix literals — a non-literal count is treated as ×1 and flags the total approximate `~`)
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
