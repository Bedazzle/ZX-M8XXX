# Architecture: what each file does

Moved out of CLAUDE.md, which is loaded into context every session and so
carries only the map. Each section here is the detail for one file.

## `ui/app-init.js`

**The application**: imports every module, builds `spectrum`/`zxDebug`, owns the main loop and all the DOM wiring. Was inlined in index.html; identical module semantics, but now readable, diffable and importable. `fetch()` URLs inside it resolve against the *document*, so `roms/48.rom` and friends are unchanged

## `css/`

**Stylesheets** — `app.css` (main), `dialogs.css` (Beautify + ZIP list); linked in that order, which is the order they had inline. `url()` paths are relative to `css/`

## `core/memory.js`

Memory banking for 128K/+2/+2A/Pentagon/Pentagon 1024/Scorpion, +D ROM/RAM paging, IF1 ROM paging, Opus ROM/RAM/register paging

## `core/ula.js`

Video generation, keyboard, border; configurable Caps/Symbol Shift PC keys (`MODIFIER_KEY_OPTIONS`, `setModifierKeys()`, canonical `'CAPS'`/`'SYM'` keyMap tokens); optional keyboard ghosting (`setKeyboardGhosting()`, off by default — `_ghostedRows()` unions the columns of half-rows that share a held key until nothing changes, so three keys at the corners of a rectangle read as four; applied at read time only, so `keyboardState` stays the genuine presses that the virtual keyboard highlights)

## `core/spectrum.js`

Machine integration, memory banking, tape handling, IF1/Microdrive, Opus Discovery. Auto-Map has a **fast bitset mode** (`setAutoMapFast(on, paged)`/`getAutoMapBits` — Uint8Array(0x10000) exec/read/write touched-sets, ~10× cheaper than the `Map<key,count>`, for long RZX). **Paged fast** (`setAutoMapFast(true, true)`) keeps one bitset triple per memory page (`autoMap.pagedBits`, keyed like `getAutoMapKey` via the shared `_autoMapPage`; hot path caches per-slot pointers behind `_pagingSignature`) so bank-switching games map correctly instead of unioning banks. **Write provenance** (`startWriteProvenance(lo,hi)`/`stopWriteProvenance`/`getWriteProvenance`) records which instruction PC writes into a range. **Indirect-jump resolution** (`startIndirectJumps`/…/`getIndirectJumps` + `_trackIndirectJump` in the exec loop) records `JP (HL)/(IX)/(IY)` runtime targets. **Runtime call graph** (`startCallGraph`/`stopCallGraph`/`getCallGraph`; edge recorded in `_trackCallStack`'s CALL branch) captures observed CALL/RST caller→callee edges. **SMC** is computed in `core/map-export.js` (`findSmcRanges` = exec∩write). **External access hooks** (`setAccessHooks({onFetch,onRead,onWrite})`/`clearAccessHooks` — `_accessHooks` fired at the top of the three memory/fetch callbacks, kept live by `updateMemoryCallbacksFlag`) let a headless driver observe every fetch/read/write without a monitor. All surfaced via `window.zxDebug` (built in index.html) — the headless automation API, see `docs/automation.md`

## `core/debug-instrument.js`

**The observation surface**, split out of `spectrum.js` and mixed into `Spectrum.prototype` (`Object.assign` at the end of spectrum.js), so every call site is unchanged: auto-map coverage (`setAutoMapEnabled`/`setAutoMapFast`/`getAutoMapBits`/`get`/`setAutoMapData`, `getAutoMapKey`/`parseAutoMapKey`), read/write/exec provenance, indirect-jump resolution and the runtime call graph. The hot-path hooks stay in spectrum.js; this is the control and reporting surface

## `core/loaders.js`

**Barrel** — re-exports everything in `core/loaders/`; existing `import { X } from './loaders.js'` sites are unaffected

## `core/loaders/`

**One module per format family** (split out of the old 7.2k-line file): `common.js` (checksums, `writeField`), `tape.js` (TAP/TZX/WAV + ROM load/save traps, MIC recording), `disk-beta.js` (BetaDisk WD1793, TRD, SCL, TR-DOS trap), `disk-mgt.js` (MGT image + PlusDDisk WD1772), `microdrive.js` (MDR + IF1 drive), `disk-opus.js` (OPD), `disk-didaktik.js` (D40/D80 MDOS), `zip.js`, `rzx.js`, `szx.js`, `snapshot.js` (SNA/Z80 + the format-detecting load dispatcher). Dependencies are acyclic: everything → `common.js`; `disk-mgt`/`microdrive` → `disk-beta`; `snapshot.js` is the only consumer of the rest. Details of each format: SNA/Z80/TAP/WAV/ZIP/RZX/MGT/OPD file format loaders, SZX/RZX export, PlusDDisk (WD1772), MDRLoader (MDR format), Microdrive (IF1 hardware), OPDLoader (OPD format), DidaktikLoader (D40/D80 MDOS read + in-place write: listFiles/extractFile/getDiskInfo/fileToTAP + addFile/deleteFile/renameFile/setStartAddr/setFATnum/setDiskLabel + createBlankD40/createBlankD80 (byte-reproduce real MDOS 360K/720K formats), write format per zxspectrumutils tap2d80.cpp), TapeSaveTrapHandler (ROM save trap), MicRecorder (port 0xFE MIC bit recording), TZX builder

## `core/fdc.js`

µPD765 FDC emulation, DSK format loader/image (+3 disk); DSKLoader CP/M directory read/write (listFiles, writeDirectory, get/setDiskLabel — CP/M Plus `0x20` volume-label entry)

## `core/asm-detok.js`

Detokenizers for native ZX assembler binary formats (ALASM, TASM 3/4, STORM — faithful xLook ports; STORM: backward line storage, tokenized expressions, bit-packed labels; ADS — TASM tokens with u16-lineno framing, reverse-engineered), Hobeta parsing, format detection from TR-DOS catalog metadata (type char + start address) or raw bytes, codepage tables + `decodeViewCodepage` (CP866/KOI8-R/KOI-7 display decoding for the editor's View enc option)

## `core/asm-beautify.js`

`beautify(text, opts)` source reformatter (pure, idempotent, string/comment-aware): case folding (instructions/registers/conditions/directives only), space after commas, split colon statements, label on own line (not for EQU/MACRO/= label-consumers), blank line after unconditional JP/JR/RET/RST, blank line after block ops (LDIR/LDDR/CPIR/CPDR/INIR/INDR/OTIR/OTDR), normalize pseudo-ops (EXA→EX AF,AF', SLI→SLL), expand multi-register PUSH/POP and chained LD, blank line before routines, space after ';', unify number notation (hex #/$/0x/h, binary %/0b/b with ≥3-digit pad, octal o/q suffix; modulo-safe), **per-width base conversion** (`byteBase`/`wordBase: 'hex'|'dec'|'leave'` — classify literal by value ≤$FF=byte else word, convert each width's base independently → e.g. addresses hex + 8-bit dec; precedence over notation; temp-label/`$`/modulo-safe) + hex byte/word padding (`hexPadBytes`→2 digits, `hexPadWords`→4 digits), indent to column 8, tabular operand/comment column alignment, trim trailing, collapse blank lines

## `core/asm-convert.js`

Foreign dialect → sjasmplus syntax converter (line-based, string/comment-aware): ALASM/TASM (EXD/JZ/JNZ/INF/SLI rewrites, `'label` HIGH operator, chained LD splitting, unterminated string closing), STORM (INCL/INCB/EIF/IFD/IFND renames, `\`→`%`, `=N` local refs→`.N`, register halves LX/HX/LY/HY→IXL/IXH/IYL/IYH, `_` not-tabulated prefix→indent, two-address `ORG run,load`→`ORG load`+`DISP run`, bitwise `!`OR→`|` / `|`XOR→`^`, postfix byte selectors `[`→HIGH / `]`→LOW, other postfix ops `` ` ^ ~ @ `` warned, multi-operand expansion `stormExpand` (PUSH/POP N-reg, LD 16-bit rr,rr'→8-bit pairs via `stormLd16`, chained LD/ALU→pairs, EX HL,DE→EX DE,HL, ADD DE,HL→EX/ADD/EX, OUT/IN implicit A)), ADS (char-literal closing, `:` statement splitting, indented-label hoisting, slash strings), GENS (line-number stripping, ENT, `*` controls with meanings), Zeus (slash strings, PROC/ENDP/RETP/MEND, DISP/ENT pairing), Pasmo (word operators → symbols, &H/&X/&O literals), label sanitization (invalid chars like `out[DE]`/`^ay` → `_`, deterministic across files), instruction-named label colons, INCLUDE remapping, unsupported constructs commented with warnings

## `core/map-export.js`

Auto-Map → disassembly-toolchain exporters (pure, DOM-free): `buildRanges` (executed=code / read+written=data, coalesced into typed ranges; optional `readByte` → printable-run text detection), `buildRangesFromBits` (same from fast-mode Uint8Array bitsets), `buildRangesFromPagedBits` (paged fast mode: `Map<label,{execBits,readBits,writeBits}>` → unioned `ranges`/`pages` **plus** per-page `byPage`, so bank-switched banks stay distinct), `applyRegions` (user regions overlay, carve & relabel), `exportCtl` (SkoolKit `.ctl`: `c`/`b`/`t`/`w` blocks + `@ ADDR label=` + `N ADDR` comments; accepts pre-built `ranges` or raw `mapData`), `exportGhidraCsv` (`address,name,comment` for zx-disasm `apply_labels.py`), `exportSym` (sjasmplus `NAME: EQU 0x…`), `exportIndirectCsv` (resolved `JP (HL)/(IX)/(IY)` targets → per-site Ghidra comment), `findSmcRanges`/`exportSmcCsv` (exec∩write self-modifying code), `exportCallGraphCsv` (callee-indexed "who calls this"). `parseAutoMapKey` mirrors the Spectrum one. 128K pages are unioned into the 16-bit space and reported

## `core/specscii.js`

SPECSCII text-mode ZX art (SpectraLab/zxart.ee) + TR-DOS catalogue banners. `parseSpecscii` (print-code stream → 24×32 cell grid), `renderGrid` (grid → canvas; procedural 0x80–0x8F block glyphs + ROM font for text), `encodeBannerEntries` (grid → fake 8-byte catalogue entry names: `AT`+5-byte payload chunks, attribute-switch dedup, visible-only attrs per glyph — space=paper, 0x8F=ink; last-row no-op padding so nothing wraps onto the reset row; two Deja Vu-style reset entries on the junk row), `decodeBannerNames`/`isBannerName` (read an existing banner), `gridToSpecscii`/`bannerNamesToSpecscii` (extract a banner back to a clean `.specscii` stream — inverse of parseSpecscii), `simulateListPrint` (models TR-DOS `CAT` incl. junk-column overprint, for tests). `renderGrid`'s font is passed in (never machine-tied) — the Explorer supplies it from the always-loaded `48.rom` at 0x3D00 via `romData`, so previews work on any current machine. `TRDLoader.buildTRD`/`SCLLoader.buildSCL` take an optional `bannerNames` written before the files

## `core/joystick.js`

**Joystick types** (pure): `JOYSTICK_TYPES` (Kempston, Sinclair 1/2, Cursor), `usesKeyboard`, `joystickKeys(type, mask)` → `KeyboardEvent.code`s, `allJoystickKeys`, plus a **Custom** type: `DEFAULT_CUSTOM_KEYS` (QAOP+Space), `DIRECTIONS`, `normalizeCustomKeys` (fills gaps so a half-written setting can't leave a direction dead). Settings → Input shows click-to-bind buttons for Custom. Sinclair and Cursor are keyboard interfaces, so `core/spectrum.js` presses ZX keys for them instead of feeding the Kempston port; `setJoystickType()` releases whatever the old type was holding first, or a key sticks in the matrix. Direction masks use the Kempston bit numbering the input layer already speaks

## `core/save-slots.js`

**Save-state slots** (pure — storage is injected): `createSaveSlots({storage, count})` → `save/load/clear/used/list/next/migrateLegacy`. Reports a full browser store as `{ok:false, full:true}` and leaves the slot untouched rather than half-written; corrupt data reads as empty. `migrateLegacy()` moves the old single `zxm8_quicksave` into slot 1. Wired in `ui/display-settings.js`: **F2** saves to the current slot, **F5** loads it, **Shift+F2** cycles (9 slots, persisted in `zxm8_slot_current`)

## `core/rewind.js`

**Rewind ring buffer** (pure — `capture`/`restore` are injected, so it tests without an emulator): `createRewindBuffer({capture, restore, intervalFrames, maxStates})` → `onFrame(frame)`, `stepBack()`, `stepForward()`, `resume()`, `clear()`, `setEnabled()`. Wired in `ui/app-init.js` to SZX snapshots (`saveSnapshot('szx')`/`loadSZXSnapshot` — both synchronous) via `addFrameListener`, one state per ~2s, 30 deep; **Ctrl+←/→** steps, and scrubbing settles after 1.2s, dropping the abandoned future. Only `runFrame` notifies frame listeners, so headless runs using `runFrameHeadless` record nothing

## `core/pok.js`

`.pok` cheat-file support (the format the community POKE databases ship): `parsePok` (N/M/Z/Y lines → trainers, tolerant of CRLF, blank lines, a missing `Y`, malformed or orphan pokes — it warns rather than throwing), `looksLikePok` (content detection, so a `.txt` still loads), `pokTrainersToEntries` (→ POKE manager shape; value 256 = ask the user, via an `askValue` callback). Bank 8 = unbanked; a 128K bank becomes a patch hint

## `core/depackers.js`

ZX0/ZX7 (de)compressors (formats by Einar Saukas) with output-capped, back-reference-checked decompress. Packed-screen detection for the Explorer preview: `detectPackedScreen` (standalone — speculative whole-block depack → exactly-6912 + low attribute-entropy), `findDepackerSignature` + `locatePackedScreen` (embedded — find the standard ZX0/ZX7 depacker code, then locate data via its `LD HL` source pointer, no brute scan), wrapped by `findPackedScreenInBlock(bytes, loadAddr)`. Plus `rcsToScr` (inverse RCS bitmap reorder, Einar Saukas) with `screenCoherence`/`looksRcsEncoded` auto-detecting RCS by image smoothness (manual toggle overrides). `isHrust`/`hrustDecompress` — Hrust 1.3 depacker (`HR` container; MIT port of Bedazzle's Compressors-JS, incl. the 0xE0 "copy with break"/D-change escape), decompress-only; used by Import Foreign to auto-unpack packed sources

## `debug/managers.js`

Pure data managers: PersistentManager base class (per-file localStorage persistence) + LabelManager, RegionManager, CommentManager, OperandFormatManager.

`PersistentManager.save()` persists once, for a caller that turned `autoSaveEnabled` off to make a batch of changes and doesn't want one localStorage write per item.

A comment entry carries **`source`**: `''` when the user wrote it, `'asm'` when it was carried over from an assembled source (see [assembler.md](assembler.md#source-comments-in-the-disassembly)). It persists — without it a reload would make every imported comment look hand-written and the next inject would refuse to refresh it. The comment dialog writes `source: ''`, so editing an imported comment makes it the user's and later builds leave it alone.

## `tools/profiler-analysis.js`

Pure profiler analysis shared by the debugger's Profiler and `profile-game.html`: hotspot clustering/classification (`analyzeHotspots`, `classifyHotspot`) and label generation (`generateProfilerLabels`, `generateHotspotLabels`). No DOM — memory access and the include-ROM flag are parameters

## `ui/comment-visibility.js`

Which comments the disassembly shows. A comment carried over from an assembled source (`source: 'asm'`) and one typed in the debugger are toggled separately, in the disasm ⚙ options — a build can bring in hundreds at once, so "only what I wrote" and "only what the source said" are different questions and each is worth asking. `visibleComment(comment)` returns it or null; an absent checkbox counts as shown, so it is safe before the markup is spliced in.

Both disassembly views (`ui/debugger-display.js`, `ui/right-disasm-view.js`) render comments with the same code, so the rule lives here rather than being written twice.

## `ui/calc-host.js`

Which panel currently holds the programmer calculator. It is a singleton — fixed ids (`#calcInput`, `#calcDec`, …) and handlers bound with document-wide `.calc-btn` selectors — so a second copy in the DOM would fight the first for every one of them. The debugger's right panel and the assembler's split pane therefore share one node by moving it rather than each owning an instance.

A host registers `(element, wants)`; `refreshCalcHost()` gives the calculator to the first host that both wants it and is on screen, else parks it at `#rightCalculatorView`. "On screen" is settled by `offsetParent`, which is null for anything inside an inactive tab, so no host needs to know about the others. Called from `switchRightPanelType`, from the split pane's load/close, and from a `.tab-btn` click listener — without the last one, switching tabs left the other panel showing an empty box with the right label on it.

## `ui/basic-editor.js`

BASIC copy/paste: read/write tokenized BASIC programs via clipboard (DI: getSpectrum, readMemory, writePoke, isRunning, stopEmulator, showMessage, updateDebugger)

## `ui/disk-file-copy.js`

Pure (DOM-free) TR-DOS/SCL file-copy helpers shared by `explorer.js` and `tests/disk-test.html`: `trdBasicAutostartLine`, `isMonoloader` (`sectors > ceil(length/256)`, any type), `extractTrdFileDescriptor` (monoloader of any type → carry full `sectors×256` + `verbatim` meta; normal BASIC → program+vars; normal CODE/DATA → declared length + optional slack), `addMetaFromDescriptor`, `shapeBasicEntry` (BASIC: verbatim vs program+vars+autostart-trailer), `splitMonoloader` (RE: loader trimmed to declared length + appended bytes as a separate `C` entry, start addr 0)

## `ui/snapshot-parse.js`

Reads a `.sna`/`.z80` into a plain view (`registers`, flat 64K `memory`, `is128K`, `border`, `port7FFD`) by loading it through the real `SnapshotLoader` into a real `Memory` — so the Compare tool never carries its own snapshot parser

## `ui/explorer.js`

File analysis tool for reverse engineering (DI: DSKLoader, Disassembler, SZXLoader, RZXLoader, ZipLoader, pako, getPalette, getRomLabels, getZxCharset — the ZX font from the always-loaded `48.rom` via `romData` at 0x3D00, machine-independent NOT the current machine's paged ROM). TR-DOS/SCL **Banner** dialog (`editorOpenBannerDialog`): load `.specscii` → `parseSpecscii`→`encodeBannerEntries`, preview via `renderGrid`, inject as `panel.bannerEntries` (written before files by `diskEditorBuildTrd/Scl`); **Save .specscii** extracts an existing banner (`bannerNamesToSpecscii`); banner entries detected on load via `isBannerName` and kept out of the file list

## `ui/explorer-editors.js`

The Explorer's **per-format editors** — TZX, TR-DOS (TRD/SCL), SPECSCII banner dialog, MGT, Microdrive, Opus, Didaktik, +3 DSK, ZIP — split out of `explorer.js`. `initExplorerEditors(ctx)` takes 39 shared accessors and returns the 74 functions the toolbar and dialog handlers call. Four bindings (`explorerParsed`/`explorerData`/`explorerFileType`/`explorerZipFiles`) are **written** here, so their ctx entries are get/set pairs

## `ui/explorer-banks.js`

Explorer's per-format **info panels** (SNA/Z80/SZX/TAP/TZX/TRD/SCL/MGT/MDR/OPD/Didaktik/Hobeta/RZX) and **RAM/ROM bank extraction** for snapshots, split out of `explorer.js`. `initExplorerBanks(ctx)` takes the Explorer's mutable state as **getters** (`explorerParsed`/`explorerData` are reassigned on every load — read through `ctx`, never cache) and returns the 23 functions the rest of the Explorer calls, plus `get/setRzxDecodeMode` for the RZX dropdown it owns

## `ui/graphics-viewer.js`

Graphics dump/preview viewer (DI: readMemory, getMemoryInfo, getRegion, addRegion, getAllRegions, getRAMPage, showMessage, goToAddress, goToMemoryAddress, updateDebugger, openOcrExtractDialog)

## `ui/text-ripper.js`

OCR text recognition: screen capture, glyph hashing, charset management, font extraction from memory (DI: readMemory, getRAMPage, showMessage, downloadFile)

## `ui/text-scanner.js`

Text string scanner with dictionary matching (DI: readMemory, getMemoryInfo, getRamBank, getRom, showMessage, goToMemoryAddress)

## `ui/watches.js`

Memory watches with change highlighting (DI: readMemory, getMemoryInfo, getRamBank, parseAddressSpec, getLabel, showMessage)

## `ui/frame-export.js`

Frame grab, PNG/SCR/BSC/SCA/GIF/IMG export, animation loop detection, PSG recording (DI: getScreenCanvas, getDimensions, getUlaPlusState, getMemoryBlock, readMemory, isRunning, startEmulator, stopEmulator, setOnFrame, getAy, showMessage, getRAMPage, getRamPages, getActiveScreenData)

## `ui/poke-search.js`

POKE search: snap-based memory scanner for game variables (DI: readMemory, startWriteTrace, stopWriteTrace, showMessage, goToMemoryAddress)

## `ui/memory-search.js`

Memory pattern search for right and left panels (DI: readMemory, showMessage, goToMemoryAddress, goToLeftMemoryAddress)

## `ui/profiler-ui.js`

Runtime behavior profiler: label generation, hotspot detection (DI: readMemory, getMemoryInfo, getProfiler, startProfiling, stopProfiling, isRunning, startEmulator, getOnFrame, setOnFrame, labelManager, regionManager, navigateToAddress, updateLabelsList, updateDebugger, showMessage)

## `ui/codepath.js`

Code path recording and diff tool: record executed PCs into slots, set-difference, clustered disassembly output, export (DI: getSpectrum, readMemory, disassembleAt, goToAddress, showMessage, downloadFile)

## `ui/struct-mapper.js`

Struct field access mapper: monitor reads/writes at offsets from base register (IX/IY) or fixed address (DI: startStructMapper, stopStructMapper, readMemory, getSpectrum, disassembleAt, labelManager, goToAddress, showMessage)

## `ui/call-graph.js`

Visual call graph from profiler data: canvas-based tree, zoom/pan, clickable nodes (DI: labelManager, goToAddress, showMessage)

## `ui/mapper-ui.js`

Game Mapper UI: capture, overview, blend, stamp, export (DI: gameMapper, getScreenCanvas, getScreenDimensions)

## `ui/gamepad.js`

Hardware gamepad support and calibration (DI: get/setGamepadEnabled, get/setGamepadMapping, enableKempston, saveInputSettings, showMessage)

## `ui/input-settings.js`

Settings → Input tab: Kempston joystick/mouse toggles, Beta Disk/+D/IF1 interface toggles, Caps Shift/Symbol Shift PC-key dropdowns (options from `MODIFIER_KEY_OPTIONS`; collision reassigns the other select; applied via `ula.setModifierKeys`, persisted in `zxm8_input`), keyboard ghosting toggle (`chkKeyboardGhosting` → `ula.setKeyboardGhosting`, same `zxm8_input` key, preserved across a machine switch by `setMachineType`) (DI: getSpectrum, getCanvas, romData, showMessage, initGamepad, initBootManager, onDiskSystemsChanged)

## `ui/virtual-keyboard.js`

Clickable on-screen ZX keyboard (⌨ toolbar toggle; floating `position:fixed` bottom-centred panel, `min(720px,97vw)` — viewport-sized so the narrow landscape emulator column / small border can't crush it): CSS key grid with all key legends (keyword / symbol-shift / extended-mode green / ext+symbol red colour-sound like INK·BEEP); click injects via `ula.keyDown/keyUp` (codes match `ula.keyMap`; CAPS/SYM use the canonical `'CAPS'`/`'SYM'` tokens, so remapped PC modifier keys don't affect it); latching CAPS/SYMBOL shift (click to hold, click to release; both held = extended mode); live pressed-key highlight via `spectrum.addFrameListener` reading `ula.keyboardState` (DI: getSpectrum)

## `ui/memory-view.js`

Right + left panel hex dump (bytes per line adapt to panel width: 8/16/32), inline byte editor, hex/ASCII mouse selection with Ctrl+C copy, scroll wheel (DI: getSpectrum, getDisasm, regionManager, getMemoryViewAddress, getLeftMemoryViewAddress, getMemorySnapshot, updateDebugger, getGoToMemoryAddress)

## `ui/mem-context.js`

Memory context menus (left + right panels), click-outside clear for hex/ASCII selection (DI: labelManager, regionManager, undoManager, dialogs, getMemSelection, getAsciiSelection, clearMemSelection, clearAsciiSelection)

## `ui/memory-map.js`

Memory map/heatmap dialog with regions, 128K bank view, plus **disassembly exports** (`.ctl`/Ghidra `.csv`/`.sym` buttons → `core/map-export.js`, honouring the Skip ROM/Screen checkboxes) (DI: readMemory, getMemoryInfo, getRAMBanks, getAutoMapData, getAutoMapKey, parseAutoMapKey, downloadFile, regionManager, labelManager, commentManager, goToAddress, goToMemoryAddress, updateDebugger)

## `ui/export-asm.js`

Export disassembly as sjasmplus ASM with loop dedup, restoration code (DI: getExportSnapshot, getCpuState, getMachineType, getProfile, getAutoMapData, getPagingState, getCurrentBank, readMemory, regionManager, labelManager, disasm, is128kCompat, appVersion)

## `ui/analysis-tools.js`

Auto-map tracking, XRef controls, Code-Flow Analysis (DI: getSpectrum, getDisasm, setExportSnapshot, regionManager, labelManager, xrefManager, subroutineManager, getDisasmViewAddress, showMessage, updateDebugger, getGenerateAssemblyOutput, downloadFile, appVersion, hex16)

## `ui/debugger-display.js`

Register rendering (REGS, SYSTEM, Pages, AY R0–R13), disassembly view, sub-panel dispatch (DI: getSpectrum, getDisasm, traceManager, regEditorAPI, labelManager, regionManager, etc.)

## `ui/display-settings.js`

Audio, fullscreen, quicksave/load, display invert, ULAplus, palette (click-to-edit via native color picker, custom palette persistence, save/load/delete named palettes, ULA+ GRB 332 snapping), debugger display settings, Step Over T-state limit persistence (input lives in the disasm ⚙ popover) (DI: getSpectrum, showMessage, handleLoadResult, updateCanvasSize)

## `ui/assembler-ui.js`

Z80 assembler editor: syntax highlighting, multi-file projects, VFS, compilation, inject/debug, search/replace, undo/redo, SNA/TAP/TRD/ZIP export, clipboard share/import, T-state selection popup, split editor pane (◫, second pane edits another VFS file or mirrors the same file) (DI: VFS, Assembler, AsmMemory, ErrorCollector, ZipLoader, MD5, getSpectrum, labelManager, escapeHtml, showMessage, updateDebugger, updateStatus, updateLabelsList, is128kCompat, arrayToBase64, pako; imports z80Opcodes from opcodes-data.js)

## `ui/asm-highlight.js`

ASM syntax highlighting: `highlightAsmLine`/`highlightAsmCode`, `collectLabels(code)`/`labelDefinedOn(line)` feed the tokenizer the file's label set, so a label is coloured identically at its definition and at every use and a label named after a directive (`end:`) stays a label; the layer keeps that set as a multiset updated from the edited lines only (a full rescan per keystroke would undo the repaint budget). `createHighlightCache()` (per-line markup cache keyed by line *text* — markup also depends on the label set, hence `cache.labelsKey`) and `createHighlightLayer(el)` — the editor's layer, split into inline ~100-line chunks and patched in place (`render()` returns `patched`/`rebuilt`/`unchanged`). Chunks hold a line *count*, so an insert/delete grows one chunk instead of shifting the rest. Repaints are synchronous: the textarea text is transparent, so deferring a repaint would delay the typed character

## `ui/asm-snippets.js`

ASM editor Snippets ▼ dropdown: insert predefined code at the cursor. Built-in set from `data/asm-snippets.json`; user snippets in localStorage `zxm8_asmSnippets` (add from editor selection with a name, per-item delete, clear all, export/import JSON — import merges, overwriting same-named) (DI: insertAtCursor, getSelectedText, showMessage, downloadFile, escapeHtml — first two from `assembler-ui.js` API)

## `ui/signature-packs-ui.js`

Signature Packs management UI and GitHub Repository Browser (DI: signaturePackManager, labelManager, regionManager, getSpectrum, ZipLoader, showMessage, updateDebugger)

## `ui/import-foreign.js`

Import Foreign dialog (ASM Project ▼ menu): load .trd/.scl/.zip/single files (incl. Hobeta), disk images inside ZIPs expanded (chooser step when an archive holds several disks), per-file format detection with manual override, conversion preview with warnings, import into VFS. Auto-unpacks Hrust-packed (`HR`) entries via `depackers.isHrust`/`hrustDecompress` before detection (so packed sources import as text). Progress feedback during load/convert (DI: TRDLoader, SCLLoader, ZipLoader, showMessage, addProjectFiles; imports asm-detok/asm-convert/depackers directly)

## `ui/auto-loader.js`

Auto-load engine for tape/disk media: key injection, timing, TRD boot, +3 boot. Frame-driven (`addFrameListener`), so it also runs under a manual `runFrame` loop; start functions take `{headless}` to skip the rAF `start()` and expose `isActive()` — used by `zxDebug.autoLoad` for deterministic headless boot (DI: getSpectrum)

## `ui/file-loader.js`

File loading, drag-drop, ZIP selection modal, media indicators, Load Tape/Load Disk insert-only handlers (DI: getSpectrum, romData, showMessage, managers, etc.)

## `ui/rom-selector.js`

ROM selector modal, auto-load from `roms/` directory, per-machine ROM loading, ROM size validation, drag-drop, filename tracking (DI: getSpectrum, showMessage, labelManager, getMachineProfile, MACHINE_PROFILES)

## `ui/machine-selector.js`

Machine dropdown population, Settings → Machines checkboxes with per-machine Load ROM buttons and ROM filename display (DI: MACHINE_PROFILES, getMachineTypes, loadRomForMachineById, getRomFileName)

## `ui/tab-system.js`

Main tabs, panel tabs, settings sub-tabs (Display, Input, Tape, Disk, Audio, Machines, Signatures), openDebuggerPanel, layout splitters (drag bars set `--left-panel-w` / `--right-panel-w` / `--debug-row-h` / `--subpanel-list-h` / `--asm-output-h` / `--asm-pane2-w` / `--asm-container-h` / `--explorer-pane-size` / `--explorer-pane2-size`, persisted), active-tab persistence (restored via deferred click)

## `ui/media-catalog.js`

Media catalog display (tape blocks, disk files), tape controls, tape slot tabs, recording export, drive tabs (DI: getSpectrum, showMessage, updateDriveSelector, downloadFile)

## `ui/step-controls.js`

Step/run button handlers for left and right panels: Step Into, Step Over, Run To, Run To INT, Run To RET, Run T-states; AY debug step sound (DI: getSpectrum, traceManager, commentManager, showMessage, updateDebugger, updateStatus)

## `ui/keyboard-shortcuts.js`

Global keyboard shortcut handler: F7 Step Into, F8 Step Over, F4 Run to Cursor (delegate to button click), F5/F6 run/pause, trace nav, zoom, bookmarks (DI: getSpectrum, traceManager, undoManager, showMessage, updateDebugger, etc.)

## `ui/goto-palette.js`

Ctrl+G quick-navigation overlay: fuzzy label search and hex addresses, ROM labels opt-in via checkbox, Enter navigates disasm; on the ASM tab searches source label definitions and jumps the last-focused editor pane (Shift+Enter: other pane) (DI: labelManager, navigateToAddress, openDebuggerPanel, getAsmSymbols, gotoAsmLine, gotoAsmLineSplit)

## `ui/trace-display.js`

Step/runtime trace UI: history navigation, slider, export, screen revert via memory undo/redo (DI: traceManager, getSpectrum, getDisasm, Disassembler, goToAddress, showMessage, updateDebugger)

## `sjasmplus/assembler.js`

Multi-pass assembly orchestration, directives (ORG/EQU/DB/DW/DS/INCLUDE/MACRO/STRUCT/SAVE*), instruction encoding dispatch.

Also returns **`lineMap`** — `[{file, line, addr, comment, depth}]`, one entry per source line that emitted bytes — which is how the debugger shows a source comment beside the code that line produced. Recorded in the `processLine` wrapper rather than the pass loop, so a macro or `REPT`/`DUP` body (expanded by re-entering `processLine`) is mapped per expansion; `depth` is that nesting level. Rebuilt every pass in **both** `runPasses` and `runPassesAsync`. `reconstructLine` keeps each line's comment for the same reason — REPT/macro bodies are stored as text and re-parsed. [Details](assembler.md#source-comments-in-the-disassembly)

## `sjasmplus/lua.js`

LUA/ENDLUA scripting (sjasmplus-compatible): lazy-loads fengari (`lib/fengari-web.js`, Lua 5.3, MIT), builds the Lua state and binds `_c`/`_pc`/`_pl` + the `sj` table (functions plus `current_address`/`pass`/`error_count`/`warning_count` as metatable properties), routes `print` to the assembler output, provides an `io` shim over the VFS, and exposes the `zx` table (`trdimage_create`/`trdimage_add_file`/`save_snapshot_sna`) which routes to the same save commands as EMPTYTRD/SAVETRD/SAVESNA. Pass filters via `parseLuaPass`/`luaPassMatches`; `sourceUsesLua` is the cheap pre-check the editor uses

## `core/loaders/szx.js` (peripheral state)

SZX now carries more than CPU/RAM/paging: **`AY`** (chFlags, current register, 16 registers) and **`B128`** (dwFlags incl. CONNECTED/PAGED, drives, system/track/sector/data/status) per the zx-state spec, plus two **private** chunks — `M8BD` (command, drive, side, per-drive head tracks, transfer buffer + position: what B128 has no field for) `M8UP` (ULAplus palette/mode, whose standard layout couldn't be verified) and `M8MP` (media *position*: tape playback point, +D and Microdrive seek state — never the media itself; `Spectrum.MEDIA_FIELDS` lists exactly what is captured). Fed by `spectrum._snapshotPeripherals()` / `_restorePeripherals()`, so quicksave, save slots and rewind all restore the sound chip and disk controller. Snapshots without these chunks load unchanged

## `ui/asm-beautify` (in `ui/assembler-ui.js`)

Beautify dialog (ASM Project ▼ menu): per-transform checkboxes + case select + live preview + "apply to all project files"; persisted to `zxm8_beautify`; Apply runs `core/asm-beautify.beautify()` on the editor (undoable) or every VFS text file

## `docs/tools.md`

Explorer, Game Mapper, POKE Manager, POKE Search, Runtime Behavior Profiler, Hotspot Detection, Code Path Tool, Struct Mapper, Auto-Map Tracking, Signature Packs, System Signature Packs, BASIC Copy/Paste

## `docs/automation.md`

Headless automation API (`window.zxDebug`): **harness setup** (serve + headless-Chromium launch, readiness timing, ROM bootstrap, `--virtual-time-budget`/`--dump-dom` gotchas — no Node entry point), execution map (fast/rich), managers, `.ctl`/`.csv`/`.sym` exporters, write provenance, `replayRZX` one-call playback, deterministic `autoLoad` boot — for external RE/disassembly drivers
