# Tools: Explorer, Game Mapper, POKEs, Profiler, Hotspot, Code Path, Struct Mapper, Auto-Map, Signature Packs, Memory Map

## Explorer (Utils -> Explorer)

File analysis tool for reverse engineering. Supports TAP, TZX, SNA, Z80, SZX, RZX, TRD, SCL, MGT, IMG, DSK, OPD, MDR, ZIP, and raw graphics files.

**Architecture (`index.html`):**
- `explorerParseFile()` -> format-specific parser -> `explorerRenderFileInfo()` -> renderer
- `explorerUpdateSourceSelectors()` populates BASIC/Disasm/Hex tab dropdowns
- `explorerRenderBASIC()`, `explorerRenderDisasm()`, `explorerRenderHexDump()` extract and render data
- BASIC decoder scans for 0x0D line terminator (like the ZX ROM LIST routine) rather than trusting the stored line length, which can be incorrect on some +D disk saves. MGT/OPD/MDR BASIC extraction strips the on-disk file header (9-byte for MGT/MDR, 7-byte for OPD) before decoding.
- MDR file listing parses the 9-byte Spectrum header to show file types (BASIC/Code/Num array/Char array), actual data length (excluding header), start address for Code files (decimal + hex), and autostart line for BASIC files. Disasm and hex dump views also strip the header. Editor file list shows the same parsed details.
- MDR cross-format copy: extracting from MDR strips the 9-byte header and passes file type/address/autostart to the destination; copying to MDR constructs the header from source metadata. `mdrEditorParseHeader()` shared helper parses the header for both File Info and Edit tabs. MDR export strips the 9-byte header so downloaded files contain only payload data.
- TAP/TZX block lengths show actual data size (excluding flag byte and checksum). Hex dump and text views strip the flag byte and checksum to show only payload.
- TRD/SCL file listing shows full type names (BASIC, Code, Data, Sequential), start address in decimal+hex for Code files, autostart line (`LINE n`) for BASIC files, and sector count. BASIC autostart is detected by scanning the file data for the `$80 $AA` marker followed by a little-endian 16-bit line number (per TR-DOS filesystem spec — autostart is stored in-band after the program end marker, not in the directory entry).
- OPD file listing shows full type names (BASIC, Code, Num array, Str array), start address in decimal+hex for Code files, autostart line (`LINE n`) for BASIC files, and sector count. The 7-byte Opus file header (`type(1) + length(2) + param1(2) + param2(2)`) is stripped from all data views (hex dump, disasm, text, BASIC). Directory entry `bytesInLast` stores "bytes in last sector minus 1" with the top 4 bits reserved for system flags — `rawLength = (lastBlock - firstBlock) * 256 + (bytesInLast & 0x0FFF) + 1`.
- DSK file listing shows type (BASIC/Code/Num array/Char array), start address in decimal+hex for Code files, autostart line for BASIC, and sector count. File headers are detected and stripped in all data views: +3DOS (128-byte "PLUS3DOS" header), TOS (Timex FDD3000: 7-byte BASIC header `type+autostart+dataLen+basLen` or 5-byte Code/array header `type+dataLen+address`, all fields 16-bit LE). Non-+3DOS CP/M disks (CPC, Timex FDD3000) are detected by sector IDs and geometry — see `getDiskSpec()` in `fdc.js`. Timex FDD3000 (TOS) disks use a modified CP/M directory format with exact file sizes (bytes 13-15 = tail/sizeHi/sizeLo instead of BC/S2/RC) and sector skew for correct logical-to-physical sector mapping. Files are stored with a `headerSize` property (128 for +3DOS, 5/7 for TOS, 0 for raw CP/M) used consistently across all views (hex, disasm, BASIC, text, editor, export).
- MGT file listing shows full type names, start address in decimal+hex for Code/SCREEN$ files, autostart line (`LINE n`) for BASIC (read from directory offset 218-219). The 9-byte +D file header is stripped by `extractFile`, which also trims to `fileInfo.length`. Editor export and cross-format copy both use `mgtExtractCleanData(file)` to concatenate 510-byte data portions from raw 512-byte sectors (skipping 2-byte chain pointers at bytes 510-511), strip the 9-byte +D header, and trim to `file.length`.
- Click handlers on file entries switch to appropriate sub-tab

**Screen Preview:**
- File Info tab shows a screen preview for snapshots and screen-sized data files
- 48K snapshots (SNA, Z80 v1): single screen from bank 5 ($4000-$5AFF)
- 128K snapshots (SNA, Z80 v2/v3, SZX): dual screen — bank 5 (primary) and bank 7 (shadow) stacked vertically with an 8px gap. Active screen (port $7FFD bit 3) highlighted with a green border. Z80 format uses page 8 (bank 5) and page 10 (bank 7). SZX extracts via `SZXLoader.extractRAMPage()` for pages 5 and 7.
- RZX recordings: extracts from embedded SNA or Z80 snapshot, with dual screen for 128K
- `explorerRenderDualScreen(screen5, screen7, activeScreen)`: renders both banks into a single 256×392 canvas at 2x zoom (512×784 CSS). Does NOT call `syncPreviewHeight()` — the preview container sizes naturally to fit the tall canvas.
- `explorerRenderSCRToImageData(pixels, canvasWidth, data, xOffset, yBase)`: shared renderer with `yBase` offset for vertical stacking
- `explorerExtractZ80Screen(data, parsed, targetPage)`: extracts screen from Z80 v1/v2/v3. `targetPage` defaults to 8 (bank 5); pass 10 for bank 7. V1 returns null for non-page-8.
- TAP/TZX/disk formats: preview shown for blocks/files with screen-sized data (6912, 6144, 4096, 2048, 768 bytes)
- Rendering mode toggle for ambiguous sizes (2048, 4096, 6144 bytes): three buttons appear below the canvas — **Spectrum** (interleaved ZX screen layout), **Linear** (sequential scanlines, 256px wide), **Font** (8×8 glyph grid, 32 columns). Defaults to Spectrum; resets when a new file is selected. 768 bytes always renders as font (no toggle). 6912/9216/12288/18432 are unambiguous format-specific sizes (no toggle).

**Bank Export/Import (Hex Dump sub-tab):**
- Snapshot files (SNA, Z80, SZX) show per-bank sources in hex and disasm dropdowns: "Full memory" plus individual banks (0-7 for 128K, 5/2/0 for 48K). Bank 5 labeled "(screen)", bank 7 labeled "(shadow)".
- Selecting a bank source shows the bank tools row: Addressing mode toggle, Export .bin, Import .bin, Save Modified buttons.
- **Addressing modes**: Bank-relative (0000-3FFF) shows raw bank offsets. Logical Z80 shows the address where the bank is mapped in the Z80 address space (bank 5 → 4000, bank 2 → 8000, paged bank → C000).
- **Export**: Downloads the selected bank (or a sub-range from address/length fields) as a `.bin` file. Filename includes bank number and optional address suffix.
- **Import**: Loads a `.bin` file into the cached bank at the current address offset. Marks the bank as dirty. If bank 5 or 7 is modified, the screen preview updates immediately.
- **Save Modified**: Rebuilds the full snapshot with all modified banks written back. SNA preserves the original header and bank layout (128K: paged bank at offset 27+32768, remaining 5 at 49183+). Z80 v1 files are upgraded to v3 with uncompressed pages. SZX rebuilds RAMP chunks with pako compression.
- Bank data is cached on first access via `explorerExtractBank()`. Import modifies the cache in-place. Cache is cleared when a new file is loaded.
- The "Full memory" source for Z80/SZX now reconstructs 48K from decompressed banks instead of showing raw compressed file bytes.

**Edit Tab (dual-panel file editor):**
- Two independent panels (left/right) for side-by-side file editing and cross-format copy
- Supported container formats: TAP, TZX, TRD, SCL, MGT, IMG, MDR, DSK, OPD, OPU, ZIP, SNA, Z80, SZX
- Each panel displays format-specific file/block lists with selection (click, Ctrl+click multi-select, Shift+click range select)
- Toolbar: New (format dropdown), Save, Move Up/Down, Delete, Extract (bin/Hobeta dropdown), Copy (to other panel), Add File
- **Editable containers** (TAP/TZX/TRD/SCL/MGT/MDR/DSK/OPD): add, remove, reorder, rename files; inline edit via double-click; save produces a new file
- **TR-DOS BASIC conventions** (cross-format copy to/from TRD/SCL): directory entry bytes 9-10 = program+variables length, bytes 11-12 = variables offset (NOT a start address — writing one there makes TR-DOS load an empty program); file data carries the in-band autostart trailer `0x80 0xAA line_lo line_hi` after the program+vars (line ≥ 32768 = no autostart). Copies map TAP header param1 (autostart) ↔ trailer and param2 (vars offset) ↔ bytes 11-12 in both directions
- **BASIC vars offset across systems**: the "program length without variables" value flows through all cross-format copies — TRD/SCL dir bytes 11-12, MGT dir bytes 216-217 (PROG field defaults to 23755), MDR Spectrum-header bytes 5-6, OPD header param2 (`progLength` from `OPDLoader.listFiles`), +3DOS header bytes 20-21, TOS basLen. +3DOS CODE headers: bytes 16-17 = length, 18-19 = load address (per spec; matches the parser in `fdc.js`)
- **ZIP containers**: transparent unwrap — single supported file auto-loads, multiple shows a picker dialog
- **Snapshot containers** (SNA/Z80/SZX): virtual file list showing extractable entries:
  - BASIC program (if PROG < VARS and PROG >= $4000, extracted from snapshot memory via system variables at $5C53/$5C4B)
  - Screen — first 6912 bytes of bank 5 (bitmap + attributes)
  - Shadow Screen — first 6912 bytes of bank 7 (128K only)
  - RAM banks — all available banks (0-7 for 128K, 5/2/0 for 48K) as 16384-byte entries
  - Bank addresses use logical Z80 mapping: bank 5 → $4000, bank 2 → $8000, all others → $C000
  - Move/Delete/Add File disabled (fixed structure). Extract and Copy enabled.
  - **Editing**: select target entry in snapshot panel, then Copy from other panel replaces that entry's data. Selection-based matching — first incoming file goes to first selected entry, etc. Falls back to address+length matching when no selection.
  - **128K bank mapping**: the bank at $C000 is `port7FFD & 0x07`, not necessarily bank 0. `snapshotEditorWriteEntry()` and `snapshotEditorSave()` both respect this — SNA save writes paged bank at offset 27+32768, remaining banks at 49183+ in order [0,1,3,4,6,7] minus paged.
  - **Save**: enabled when entries have been modified (button shows `Save SNA *`). Rebuilds the full snapshot: SNA preserves header and bank layout; Z80 v1 upgraded to v3 uncompressed; SZX rebuilds RAMP chunks with optional pako compression. Downloads as `filename_modified.sna/z80/szx`.
  - Per-panel bank cache (`panel.snapshotBankCache`) and dirty set (`panel.snapshotDirty`) — left and right panels don't interfere with each other or with global explorer state.
  - Screen entry auto-updates when its underlying bank (5 or 7) is replaced via bank entry write.
- **Cross-format copy** (`editorCopySelection`): extracts files from source panel via `extractFilesFromPanel()`, converts via `convertFileForPanel()`, adds to destination via `addConvertedFile()`. Auto-creates empty destination if needed (snapshot source → TAP). Format conversion handles name truncation, extension mapping (single-char ↔ multi-char), type codes, and header construction per destination format.

**Disk Map sub-tab (`explorerRenderDiskMap`):**
- Visual sector-level disk structure for DSK, TRD, MGT, and OPD images
- Two views: Grid (HTML div grid, sector-by-track with row/col labels) and Disk (Canvas radial with concentric cylinder rings)
- Left sidebar shows Grid/Disk toggle, geometry info (cylinders × sides × sectors/track), and color legend
- `buildDSKSectorMap()` — CP/M block-to-file reverse map via `DSKLoader._readDirectory()`. Non-CP/M DSKs classified as data/empty/error
- `buildTRDSectorMap()` — TR-DOS contiguous allocation from directory entries (sectors 0-7 = directory, sector 8 = disk info)
- `buildMGTSectorMap()` — +D/DISCiPLE sector address map per file (tracks 0-1 both sides = directory)
- `buildOPDSectorMap()` — Opus Discovery contiguous block allocation (sector 0 = descriptor, sectors 1-7 = directory)
- File colors: golden-angle HSL spacing (`hue = index * 137.5 % 360`) for maximum visual distinction
- Hover: highlights all sectors belonging to same file, dims others, shows track/side/sector/filename info
- Click: navigates to Hex Dump tab showing that sector's raw data (uses `sector:` source prefix)
- Legend click: toggles persistent file highlight across all sectors
- Double-sided disks: Grid shows sides as two columns; Disk view shows two radial disks side-by-side
- Sector addressing: DSK uses C/H/R (via `dskImage.readSector`); TRD/MGT/OPD use flat byte offsets

**DSK Explorer:**
- `explorerParseDSK(data)`: Parses DSK, gets disk spec, lists files (with try/catch for non-CP/M disks)
- `explorerRenderDSKInfo()`: Shows format, geometry, sectors, block size, reserved tracks, file list. Calls `detectDiskProtection(dskImage)` to identify copy protection schemes — shown as a yellow "Protection" row. Detects 20+ systems (Speedlock, Alkatraz, Hexagon, etc.) via ASCII signature searches and structural track/sector analysis. Disks with no CP/M files show "0 (non-CP/M or empty disk)"
- Boot sector: Disasm source "Boot sector @ $FE10" reads track 0 sector 1, skips 16-byte disk spec. Hex source "Boot sector" shows full sector from $FE00.
- File click handler: BASIC files -> BASIC tab with decoder; CODE files -> Disasm tab with load address; all files -> Hex tab
- Header awareness: +3DOS (128-byte) and TOS (5/7-byte) headers skipped for BASIC/Disasm content, uses `rawSize` for full allocation data
- DSK editor TOS support: `dskEditorAddFile()` creates TOS headers instead of +3DOS when writing to TOS disks, applies sector skew via `_logicalToSectorId()`, and writes TOS-format directory entries (part/tail/sizeHi/sizeLo)
- ZIP handling: Single supported file auto-drills on open. Supported formats for drill-in: TAP, TZX, SNA, Z80, TRD, SCL, MGT, IMG, MDR, OPD, OPU, DSK, RZX. ZIPs containing no supported files show a yellow warning with the unsupported extension names. Clickable entries highlighted; unsupported entries dimmed (opacity 0.5)

## Game Mapper (Utils -> Mapper)

Screen capture and room stitching tool for building navigable game maps. Captures game screen regions, arranges them on a 2D grid with floor layers, supports blending, save/load as JSON, and PNG export.

**Data Model (`GameMapper` class in `index.html`):**
- `rooms` Map with `"x,y,z"` string keys (grid X, grid Y, floor Z)
- Each room: `{ screenshots: [dataUrl...], selectedIndex, blended, stamps: [...], _baseBlend, mark }` -- multiple screenshots per room, one selected for display, optional blended average, stamp corrections, un-stamped base blend, and optional mark color
- `currentX`, `currentY`, `currentFloor` -- cursor position
- `captureRegion` -- `{ x, y, w, h }` in character cells (8px each)
- `gapH`, `gapV` -- horizontal and vertical pixel spacing between rooms in overview/export
- `floorGap` -- pixel spacing between floors in composite PNG export
- `exportLayout` -- multi-floor PNG layout: `'separate'` | `'1x'`..`'5x'` (column-count) | `'x1'`..`'x5'` (row-count)
- `overviewZoom` -- overview zoom mode: `'fit'` (auto-scale to container) | `'x1'` (native) | `'x2'` (double). x1/x2 enable container scrolling
- `overviewFollow` -- auto-scroll to current room in x1/x2 zoom mode
- `_imageCache` Map -- caches decoded Image objects from data URLs
- Version 2 format; `importJSON()` auto-migrates v1 `"x,y"` keys to v2 `"x,y,0"`, old `gap` to `gapH`/`gapV`, old layout names to new format

**UI (`index.html`):**
- Compact toolbar: Capture, nav arrows, room label, floor nav, Blend/Stamp/Mark color/Delete (contextual), thumbnail strip, gear toggle
- Collapsible settings panel: region XYWH (locked when screenshots exist), highlight color, gap H/V, zoom (fit/x1/x2), follow checkbox, export layout (separate/Nx.../...xN), floor gap, metadata (game/level/author), Save/Load/Export PNG/Clear, stats
- Overview canvas: shows current floor only, click to select room, hover 2x popup preview. Fit mode auto-scales; x1/x2 use fixed scale with scrollable container; follow mode auto-scrolls to current room
- Stamp dialog: overlays overview container, shows blend at 2x with drag-to-stamp interaction
- All controls use `mapperAction()` debounce guard (150ms) + `blur()` to prevent double-fire

**Key functions (`index.html`):**
- `mapperCaptureScreen()` -- reads screen canvas via `spectrum.getScreenDimensions()` border offsets, crops to capture region
- `mapperUpdateUI()` -- refreshes all inputs, thumbnails, overview, stats
- `mapperRenderOverview()` -- renders current floor rooms with gapH/gapV and zoom support, stores layout for click detection. Fit mode auto-scales; x1/x2 set fixed scale and enable container scrolling; follow mode auto-scrolls to current room
- `mapperOverviewClick()` -- converts click coords to grid position using stored layout
- `mapperBlendScreenshots()` -- per-pixel mode blend via Promise-based Image loading; stores un-stamped result in `room._baseBlend`, re-applies existing stamps
- `mapperRenderFloorToCanvas(floor)` -- renders one floor to offscreen canvas (used by export)
- `mapperExportPng()` -- supports composite grid layouts (Nx... columns or ...xN rows) with floor gap, or separate files per floor. Empty floors are skipped
- `mapperSave()` / `mapperLoad()` / `mapperClear()` -- JSON serialization, file I/O
- `mapperOpenStampDialog()` / `mapperCloseStampDialog()` -- stamp dialog lifecycle
- `mapperStampRender()` -- draws `_baseBlend` + stamp overlays + outlines (cyan=existing, yellow=dragging) on stamp canvas
- `mapperApplyStamps(room)` -- composites all stamps from `_baseBlend` + source screenshots into `room.blended`; returns Promise
- `mapperClearStamps()` -- clears stamps array, re-blends from scratch
- `mapperStampCanvasCoords(event)` -- converts mouse coords to canvas pixels accounting for CSS 2x scaling
- `mapperDrawRoomMark(ctx, x, y, w, h, color)` -- draws a colored diagonal cross (X) overlay on a room; used by overview, export, and hover popup

**Keyboard shortcuts** (Mapper tab active, in global keydown handler):
- `Ctrl+Space` -- capture screen
- `Ctrl+Arrow keys` -- navigate rooms
- `Ctrl+Shift+Up/Down` -- change floor
- `Escape` -- close stamp dialog (when open)
- All guarded by `!e.repeat` and `mapperAction()` debounce

**Stamp tool workflow:** Select source screenshot thumbnail -> click Stamp -> dialog opens over overview -> drag rectangle -> pixels from source replace blend pixels in that region. Stamps are metadata (`{ sourceIndex, x, y, w, h }`), not baked pixel data. `_baseBlend` stores the un-stamped mode blend; `room.blended` always reflects `_baseBlend` + all stamps. Stamps survive re-blending, are cleared on screenshot deletion (since blend is also cleared), and persist in save/load JSON.

**Event wiring:** Button click handlers at ~line 40200, keyboard hotkeys at ~line 33430. Stamp canvas mouse handlers (mousedown/mousemove/mouseup) at ~line 40220.

## POKE Manager

Manages named pokes (multi-address byte patches) and memory value editors. Located in Pokes tab in the debugger panel.

**Layout (`index.html`):**
- Two-column layout: editors (left) and pokes (right), side by side via `.poke-columns` flex container
- Each column has its own add form at the top, entries below
- Load/Save/Clear buttons and game name label at top right (`.poke-col-buttons`)

**State (`index.html`):**
- `pokeEntries[]` -- array of `{ name, enabled, patches: [{addr, normal, poke}] }`
- `pokeEditorEntries[]` -- array of `{ name, addr, type }` (type: `'byte'` or `'word'`)
- `pokeGameName` -- display label for the loaded poke set

**Key functions:**
- `parsePokeValue(v)` -- parses `$hex`, `0xhex`, or decimal -> 16-bit int
- `pokeToggle(index, enable)` -- writes poke/normal bytes to memory via `spectrum.poke()`
- `pokeDisableAll()` / `pokeClearAll()` -- bulk operations
- `loadPokeJSON(text)` -- parses JSON, populates entries, calls `renderPokeManager()`
- `renderPokeManager()` -- rebuilds poke list and editor list DOM, updates master checkbox
- `pokeReadEditorValue(ed, input)` -- reads memory into editor input (displayed with `$` prefix)
- `pokeReadAllEditors()` -- refreshes all editor inputs from memory
- `pokeUpdateToggleAll()` -- syncs master checkbox (checked/unchecked/indeterminate)

**Poke entries:**
- Checkbox toggles on/off (writes patched or original bytes)
- Master checkbox (`#pokeToggleAll`) enables/disables all; shows indeterminate when partial
- x button removes entry (disables first if enabled)
- Add form: same-name adds patch to existing poke (multi-patch building)

**Editor entries:**
- Value input accepts `$hex`, `0xhex`, or decimal; writes to memory on Enter or blur
- Read button refreshes all editors from memory
- x button removes entry

**JSON format:** Patches use compact `[addr, normal, poke]` arrays. Values as `$hex` strings. Same format for Load, Save, and project persistence.

**Project save/load:** `project.pokes` stores game name, poke entries (with enabled state), and editor entries. Loaded via `loadPokeJSON(JSON.stringify(project.pokes))`.

## POKE Search

Snap-based memory scanner for finding game variables (lives, score, etc.). Located in the debug Search tab.

**Architecture (`index.html`):**
- `pokeSnapshots[]` -- array of full 64K `Uint8Array` snapshots, one per Snap click
- `pokeSnapshot` -- alias to the last snapshot
- `pokeCandidates` -- Set of candidate addresses (null before first search)
- `pokeValueHistory` -- Map of addr -> `[v0, v1, v2, ...]` values at each snap point (for tooltip display)
- `pokePreFilterCandidates` / `pokePreFilterHistory` -- backup before filter (for undo)
- `pokeSnapCount` -- number of user-initiated snaps (displayed in status)

**Workflow:** Snap -> play -> Snap -> play -> Snap -> Search. Each Search scans all RAM from scratch, building the value sequence from all stored snapshots. Every consecutive snap-to-snap pair is validated against the selected mode. No deduplication -- if a value didn't change between two snaps, modes like `-1` or `changed` will reject it.

**Search modes:** `-1`/`+1` (exact step), `Decreased`/`Increased`, `Changed`, `Unchanged`, `A-B-A-B`. No `Equals` mode (removed -- incompatible with snap-based validation).

**A-B-A-B mode:** Finds memory locations that alternate between two values across snapshots. Requires at least 4 snapshots. Even-indexed snapshots (0, 2, 4, ...) must all have the same value, odd-indexed (1, 3, 5, ...) must all have the same value, and the two values must differ. Uses all available snapshots (more = stricter). Post-filter automatically strips contiguous runs of 2+ matching addresses to eliminate room layout / screen buffer data that also follows the A-B-A-B pattern. Typical workflow: alternate between two game states (e.g. two rooms), take 4-8 snapshots, search.

**Value filter:** Post-search filter by exact current memory value. Checks `spectrum.memory.read(addr)` (matches displayed value). Reversible: clear input + click Filter restores pre-filter candidates. Re-filtering with a different value works from the original search results, not the filtered set.

**Status display:** Always shows snap count. After search: `(snaps: N, M candidates)`.

**Key design decisions:**
- Search always scans all RAM -- snapshot history provides all narrowing. More snaps = fewer candidates (monotonically decreasing).
- No progressive candidate narrowing between searches -- each search is a complete re-evaluation.
- Skip screen checkbox excludes 0x4000-0x5BFF (screen bitmap + attributes).
- Tooltip shows value at every snap point (raw, including duplicates).

## Runtime Behavior Profiler

Auto-label subroutines by running the emulator and observing per-subroutine behavior. Located in the debug Analysis tab -> Profile row.

**UI**: Run button, frame count input (10-5000, default 200), Stop button, Graph button, Clear button, status span. Progress shown during profiling. Clear removes all profiler-generated labels (`source: 'profiler'`), the IM 2 vector table region, and resets the results display.

**Architecture (`spectrum.js` + `index.html`):**
- `spectrum.profiler` state object: `enabled`, `maxFrames`, `framesRemaining`, `startFrame`, `subroutines` Map, `onComplete` callback, `im2` (detected IM 2 info: handlerAddr, vectorTableAddr, iReg)
- `startProfiling(maxFrames)` / `stopProfiling()` -- control methods
- `_profilerTrackCallRet(oldPC, oldSP)` -- detects CALL/RST via SP delta + return address verification, records SubroutineStats
- `_profilerCurrentSub()` -- reads top of `_debugCallStack` for current context
- `_profilerGetOrCreateStats(entryAddr)` -- creates/retrieves stats keyed by `getAutoMapKey()`

**Hooks in `spectrum.js`:**
- Main loop (after `_trackCallStack`): call/ret detection
- `_trackInterruptCall()`: IM 2 detection -- records handler address, vector table address (I*256), I register value on first IM 2 interrupt
- `portRead()` / `portWrite()`: track portsIn/portsOut/beeperOuts per subroutine
- `_memoryReadCallback` / `_memoryWriteCallback`: track screen bitmap/attr reads/writes
- Frame end (after `totalFrames++`): countdown and auto-stop
- `updateMemoryCallbacksFlag()`: includes `profiler.enabled` in `needsMemoryCallbacks`

**SubroutineStats** per entry address:
```
entryAddr, page, callCount, portsIn (Set), portsOut (Set),
writesScreenBitmap, writesScreenAttr, readsScreenBitmap, readsScreenAttr,
calledFromISR, callees (Set), callers (Set), framesCalled (Set), beeperOuts
```

**Label generation** (`generateProfilerLabels()` in `index.html`): 13-priority classification:
1. `isr_handler` / `isr_handler_im2` -- IM 1 handler at $0038, or IM 2 handler at vector table address
1b. `im2_vector_table` -- IM 2 vector table at I*256 (257 bytes, marked as DW region)
2. `isr_routine` -- called from ISR context
3. `main_loop` -- called >90% frames, most callees
4. `read_keyboard` -- reads port $xxFE, no screen writes
5. `play_beep` -- beeperOuts > 10
6. `play_music` / `ay_write` / `ay_init` -- AY port writes
7. `draw_sprite` -- screen bitmap writes only
8. `set_attrs` -- attribute writes only
9. `draw_screen` -- both bitmap and attribute writes
10. `page_memory` -- 128K paging port writes
11. `disk_read` / `disk_write` -- WD1793 or FDC port access
12. `init_XXXX` -- called once, in frame 0
13. `util_XXXX` -- leaf routine, callCount > 10

**Label application** (`applyProfilerLabels()`): Adds `source: 'profiler'` to labels. Replaces `sub_XXXX`/`loc_XXXX` auto-labels and previous profiler labels. Preserves user-named labels.

**Label source filter** (Labels panel dropdown): All / User / Profiled / ROM. Profiled labels shown with cyan "P" badge. Counts displayed per category. ROM visibility tied to `labelManager.showRomLabels`.

**Page-aware label resolution** (`getCurrentPage(addr)` in `index.html`): Returns active page string for an address (`"R0"` for ROM, `"5"` for RAM page, `null` for 48K/fixed RAM). Used by `formatAddrColumn()`, `replaceMnemonicAddresses()`, `updateCallStack()`, and subroutine fold name lookups.

## Hotspot Detection

Profiler enhancement that tracks per-PC T-state consumption during profiling to identify tight loops and performance-critical code.

**Data collection** (`spectrum.js`):
- `profiler.tStatesPerPC` Map: autoMapKey -> total T-states spent at each PC
- Tracked in 4 locations: runFrame HALT + non-HALT paths, processFrameHeadless HALT + non-HALT paths
- `stopProfiling()` includes `tStatesPerPC` and `totalTStates` in results

**Analysis** (`index.html`):
- `analyzeHotspots(results)`: Clusters consecutive PCs (max gap 4 bytes, same page), filters >1% total T-states, size <= 32 bytes, addr >= 0x4000
- `classifyHotspot(hotspot, readByte)`: Scans opcodes for known patterns -- DJNZ, DEC BC loops, HALT, LDIR/LDDR, INIR/OTIR, IN/OUT loops, POP/PUSH, EX (SP),HL
- Classifications: `delay_djnz`, `delay_bc`, `frame_sync`, `block_ldir`, `block_lddr`, `block_copy`, `io_block`, `io_poll`, `io_output`, `stack_copy`, `hotspot` (generic)
- `generateHotspotLabels(hotspots)`: Creates labels `{classification}_{addrHex}` with `source: 'profiler'`
- `displayHotspotResults(hotspots)`: Shows top 10 hotspots as clickable rows (percentage, address, classification, size)

## Code Path Tool

Record and diff executed code paths to isolate event-specific handlers (collision, damage per monster type). Located in the debug Code Path tab.

**Architecture** (`core/spectrum.js` + `ui/codepath.js`):
- `spectrum.codePath` state: `{ enabled, executed, tracing, baselineSet, traceHit, traceAddr }` -- `executed` is a `Set<string>` of autoMapKeys during recording; `tracing`/`baselineSet` for trace-break mode
- `startCodePathRecording()` / `stopCodePathRecording()` -- start/stop recording, return recorded Set
- `startCodePathTracing(slotSet)` / `stopCodePathTracing()` -- start/stop trace-break mode against any slot
- `onCodePathHit` callback -- fired when trace detects divergence (addr passed as argument)
- Hooks into `_cpuFetchCallback` alongside autoMap; `updateMemoryCallbacksFlag()` gates `cpu.onFetch` on `codePath.enabled || codePath.tracing`
- Break in `runFrame()`: same stop/render/callback pattern as watchpoints -- checks `codePath.traceHit` flag

**UI state** (`ui/codepath.js`):
- `slots[3]` -- `[null, null, null]` for Baseline, Event A, Event B. Each slot holds a `Set<string>` of autoMapKeys or null
- `recording` / `currentRecordSlot` -- active recording state
- `tracing` -- true when trace-break mode active; `chkCpTrace` checkbox toggles on/off
- `diffResults` -- clustered block array after diff

**Workflow**: Select slot -> Record -> run emulator -> Record (stop) -> select diff mode -> Diff -> view/export results.

**Trace workflow**: Record a slot -> select it in the dropdown -> check Trace checkbox -> run emulator -> emulator auto-breaks at first PC not in the selected slot -> message: "Code path diverged at $XXXX". The Trace checkbox uses the currently selected slot (not hardcoded to Baseline). If the selected slot is empty, a message is shown and the checkbox is unchecked. Trace is cancelled on Clear, machine change, or reset.

**Diff**: Set subtraction (`A - B` = keys in A not in B). Parse keys via `split(':')` for `{ addr, page }`. Skip ROM filter: `addr < 0x4000`. Intersection mode `(A ^ B) - Baseline`: computes `from ^ intersect` first, then subtracts -- isolates shared event handlers (e.g. common death routine across enemy types).

**Clustering**: Sort by page then addr. Merge consecutive PCs with gap <= 4 bytes, same page (same algorithm as hotspot clustering).

**Context lines**: Each block is preceded by `CODE_PATH_CONTEXT_LINES` (default 5, defined in `constants.js`) instructions disassembled before the block start. Marked with `*` in the marker column and dimmed in the UI. Scan works by disassembling forward from `blockStart - (N*4+4)` and taking the last N instructions landing before blockStart.

**Render**: Block header (`$XXXX-$XXXX [page] (NB)`) + context lines (marked `*`, dimmed) + diff instructions. All addresses clickable -> `goToAddress()`.

**Export**: Tab-aligned text file: `marker \t $addr \t mnemonic \t bytes`. Context lines marked with `*`, diff lines with space. Via `downloadFile()`.

**Caching**: Disassembly (both context and block instructions) is computed once at diff time and cached in `block.context` / `block.instrs`. Export reuses cached data -- safe even if memory/banking changes after diff.

**Project save/load**: All three slot Sets are serialized as arrays in `project.codePaths` (array of 3 entries, each an array of autoMapKey strings or null). Restored via `codePathAPI.setSlots()`, which rebuilds the Sets and updates slot labels. Active recordings/tracing are not saved — only completed slots.

**Cleanup**: `codePathAPI.stopRecording()` called on machine change and reset to cancel active recordings and tracing.

## Struct Mapper

Monitor reads/writes at offsets from a base register (IX/IY) or fixed address to reverse-engineer data structures. Located in the debug Struct tab.

**Architecture** (`core/spectrum.js` + `ui/struct-mapper.js`):
- `spectrum.structMapper` state: `{ enabled, baseAddr, baseReg, maxOffset, fields }` -- `fields` is a `Map<offset, { reads: Map<pc,count>, writes: Map<pc,count> }>`
- `startStructMapper(baseAddr, baseReg, maxOffset)` / `stopStructMapper()` -- control methods, `stopStructMapper` returns the fields Map
- Hooks into `_memoryReadCallback` / `_memoryWriteCallback` -- checks if accessed address falls within `[base, base+maxOffset]`, records the accessing PC

**UI** (`ui/struct-mapper.js`):
- Config inputs: base register (IX/IY/none), base address, max offset (1-255)
- Results table: +Offset, Addr, Val, Reads, Writes columns
- Expandable detail rows showing individual reader/writer PCs with disassembly
- Clickable addresses navigate to disassembler

**Project save/load**: Last completed mapping results and config (baseReg, baseAddr, maxOffset) are serialized in `project.structMapper`. Fields Map serialized as array of `{ offset, reads: [[pc,count]], writes: [[pc,count]] }`. Restored via `structMapperAPI.setResults()`, which populates the config UI fields and re-renders the results table.

## Auto-Map Tracking

Runtime execution tracking that records every executed, read, and written address. Located in the debug Analysis tab -> "Auto-Map" row.

**Architecture** (`core/spectrum.js` + `ui/analysis-tools.js`):
- `spectrum.autoMap` state: `{ enabled, executed: Map, read: Map, written: Map, currentFetchAddrs: Set }`
- Keys are autoMapKeys (format: `"addr"` or `"addr:page"` for banked memory)
- Values are hit counts
- `getAutoMapData()` / `setAutoMapData()` -- get/restore Maps
- `clearAutoMap()` -- clears all tracking data

**Project save/load**: `project.autoMap` stores `{ enabled, executed: [[key,count]], read: [[key,count]], written: [[key,count]] }`. On restore, the auto-map checkbox is synced and tracking is re-enabled if it was active.

**Export**: The "Export" button downloads a `.asm` file containing sjasmplus-format disassembly of all auto-mapped regions. Addresses from `executed`, `read`, and `written` maps are merged with addresses from marked regions (`regionManager.getAll()`). Screen memory (0x4000–0x5AFF) is excluded. Addresses are sorted and grouped into contiguous blocks (gap > 16 bytes = new block). Each block is disassembled via `generateAssemblyOutput()` with ORG directives and address comments. The output file includes a header with version, timestamp, auto-map statistics, and block count.

## Signature Packs

Modular knowledge base for automatic label/region recognition. Engine signatures (AGD, Quill, etc.) and game-specific disassemblies stored as individual JSON pack files.

**Architecture (`index.html`):**
- `SignaturePackManager` class handles pack index, loading, matching, and persistence
- `signatures/index.json` -- master index listing all available packs with enabled/disabled state
- `signatures/*.json` -- individual pack files (engine or game)
- User-imported packs stored in localStorage (`zxm8_sigpack_{id}`)
- Custom pack index in localStorage (`zxm8_sigpacks_custom`)
- Enabled/disabled state in localStorage (`zxm8_sigpacks_enabled`)

**Pack format** (`signatures/*.json`):
```json
{
    "id": "pack-id",
    "name": "Display Name",
    "type": "engine|game",
    "source": "origin/attribution",
    "baseAddress": 24576,
    "machineType": "48k",
    "anchors": [{ "address": 24576, "bytes": [243, 33, ...], "mask": null, "label": "start" }],
    "labels": { "6000": "start", "6033": "main_loop" },
    "regions": [{ "start": 24576, "end": 25000, "type": "code", "comment": "..." }],
    "comments": { "6000": "Entry point" },
    "stats": { "labels": 20, "regions": 3, "comments": 1, "anchors": 2 }
}
```

**Key concepts:**
- **Anchors**: Byte patterns at known addresses used as fingerprints for matching. Built from current memory via "Anchors" button.
- **Matching**: `scanMemory(readByte, start, end)` checks all enabled packs' anchors against memory. Returns confidence (matched/total anchors).
- **Application**: `applyLabels()` adds pack's labels/regions to the session. User labels take priority.
- **Priority**: Game packs override engine packs. User labels override everything.

**.skool import** (`parseSkoolFile()`):
- Reads SkoolKit `.skool` format: `@label=` directives, control chars (`c`/`b`/`t`/`w`/`s`), `@equ=`, inline comments
- Generates labels, regions, and comments from parsed data
- Auto-generates labels from short header comments when no `@label` present
- Anchors are empty after import -- must be built from memory via "Anchors" button

**.asm import** (`parseAsmFiles()`):
- Reads sjasmplus/pasmo/z80asm assembly format: labels (with/without colon), ORG, EQU/DEFINE, DEFB/DEFW/DEFS/DEFM
- Accepts array of `{ path, text }` for multi-file projects. INCLUDE directives resolved against file map.
- Z80 instruction sizes calculated from mnemonics (`_z80InstrSize()`) to track PC through code
- Finds main file (one with INCLUDE + ORG), processes recursively

**GitHub browser** (Settings -> Signatures -> GitHub):
- Paste repo URL or `owner/repo` -> scans recursively (3 levels) for .skool/.asm/.a80/.json files
- Uses GitHub API (`api.github.com/repos/{owner/repo}/contents/{path}`)
- ASM files downloaded as batch for INCLUDE resolution, parsed into single pack
- .skool files parsed individually; .json files imported as pre-built packs

**UI**: Settings -> Signatures tab. Import .skool or JSON, enable/disable packs, build anchors, scan memory, apply matches.

## System Signature Packs

Built-in signature packs with `type: "system"` -- common Z80 byte patterns that can appear at any address.

**Key design**: `type: "system"` distinguishes from engine/game packs. Each anchor IS the label -- `anchor.label` applied directly at found address. No `labels`/`regions` dict; all data in anchors.

**`system_patterns.json`** (12 anchors): DJNZ delay, DEC BC delay (v1/v2), IM 2 setup, CLS LDIR, CLS attributes, DI/HALT frame sync, ROM tape loader edge loop (`rom_load_edge`), screen line advance (`next_screen_line`), masked sprite column (`masked_sprite_col`), XOR sprite column (`xor_sprite_col`).

**`decompressors.json`** (28 anchors): ZX0 v2 standard/turbo/fast/mega (each with backward variant) + v1 fast, ZX1 standard/turbo/mega (each with backward variant), ZX7 standard/turbo, ZX7B backward (slow/medium/fast), MegaLZ V4, Exomizer 2, LZ48, LZ49, Pletter 0.5c, Bitbuster 1.2, LZSA1, LZSA2, Shrinkler. Each signature matches the entry-point byte sequence of the reference decompressor implementation. Masks applied to address-dependent operands. ZX0 turbo/mega/fast distinguished from ZX1 turbo/mega by deeper bytes (ZX0 uses `LD C,$FE` / `ADD A,A` while ZX1 uses `DEC B` / `LD C,(HL)` / `INC HL`). ZX0 v1 fast distinguished by `SCF` / `EX AF,AF'` prefix.

**Integration**: `SignaturePackManager.applyLabels()` detects `type: 'system'` and delegates to `_applySystemPatternLabels()`. Labels use `source: 'signature'`. Skips user labels; replaces auto/signature labels.

## Memory Map / Heatmap (Debugger -> Memory Map button)

Visual 512x512 bitmap of the 64KB address space. Two view modes (Regions / Heatmap) and a 128K bank view for multi-page machines.

**Architecture (`ui/memory-map.js`):**
- Init-function pattern: `initMemoryMap({ readMemory, getMemoryInfo, getRAMBanks, getAutoMapData, getAutoMapKey, parseAutoMapKey, downloadFile, regionManager, labelManager, goToAddress, goToMemoryAddress, updateDebugger })`
- Dialog opened via `#btnMemoryMap`, closed via `#btnMemmapClose` or backdrop click
- Canvas click navigates to address in both disasm and memory panels

**View modes:**
- **Regions**: Colors each address by region type (Code=blue, SMC=red, DB=yellow, DW=orange, Text=green, Graphics=magenta, Unmapped=grey, Zeroes=black). Stats table shows counts and percentages. Stacked bar shows proportions.
- **Heatmap**: Colors by automap access data — B=execute, G=read, R=write. Logarithmic intensity scaling. Stats table shows executed/read/written address counts, totals, and maximums. Bar shows exec/read/write proportions.
- **128K view** (`btnMemmap128K`): 2x4 grid showing all 8 RAM banks. Each bank rendered as 128-byte-wide rows at x2 horizontal scale. Grid lines and bank labels overlaid. Current bank label shown in green. Supports both region and heatmap coloring.

**Sidebar elements** (top to bottom):
- Mode toggle buttons (Regions / Heatmap)
- Bank toggle (64K / 128K) — hidden for 48K machines
- Legend (region colors or heatmap gradient + scale)
- Heatmap export controls: Export button, Free button, Skip ROM / Skip screen checkboxes
- Stats table (populated per view mode)
- Proportional bar
- Address info box (hover details: address, value, type/counts, label)
- Title ("Memory Map (64KB)")
- Export ASM button + Addr+Bytes and Dedup loops checkboxes — placed below the map canvas, not in the sidebar (Dedup loops moved here from Utils → Export; detects unrolled loops and emits REPT blocks)

**Scale bar** (`.memmap-scale`): Shows ROM bank and current RAM bank labels below the canvas. Hidden in 128K bank view.

**Tooltip**: Follows mouse over canvas, shows `$XXXX: value - type [label]` (regions) or `$XXXX: E:N R:N W:N [label]` (heatmap).

**Heatmap Export** (`exportHeatmapData()`):
- Collects all accessed addresses from automap executed/read/written maps
- Parses page-qualified keys via `parseAutoMapKey()` for per-page sorting
- Filters by Skip ROM (`addr < SLOT1_START` with ROM page) and Skip screen (`SLOT1_START`–`SCREEN_AFTER` in page 5)
- Sorts by page (null, ROM, then numeric ascending), then address
- TSV format: `Address\tPage\tExec\tRead\tWrite`
- Downloads as `heatmap.txt`

**Export Free Addresses** (`exportFreeAddresses()`):
- Bank-aware: on 128K machines, fixed memory (0x0000–0xBFFF) scanned flat; paged region (0xC000–0xFFFF) scanned per bank (0 through `numBanks-1`). Banks never paged in during profiling show as entirely free. On 48K, full 64KB scanned flat.
- Access data split by `parseAutoMapKey()`: keys with numeric page and addr >= 0xC000 go to per-bank sets; everything else (flat addresses, ROM pages) goes to the flat set
- Scannable range filtered by checkboxes: Skip ROM starts from `SLOT1_START` (0x4000); Skip screen omits `SLOT1_START`–`SCREEN_AFTER` (0x4000–0x5B00) in flat region only
- Contiguous unaccessed runs found by `findFreeRanges()` helper (shared by flat and per-bank scans)
- Filters out ranges shorter than 10 bytes
- Sorted by length descending
- TSV format: `Start\tEnd\tLength\tPage` with `$XXXX` hex addresses; Page column empty for fixed memory, bank number for paged ranges
- Downloads as `free-addresses.txt`

## BASIC Copy/Paste (debug BASIC tab)

Copy and Paste buttons for ZX Spectrum BASIC programs, plus an Explorer Copy button.

### Architecture

**Shared module** (`core/basic-tokens.js`):
- `BASIC_TOKENS` — token table (0xA3–0xFF): `[keyword, spaceBefore, spaceAfter]`
- `CONTROL_CODES` — control code table (0x10–0x17)
- `parseFloat5(bytes)` — decode Sinclair 5-byte FP → JS number
- `encodeFloat5(n)` — encode JS number → 5-byte FP (integer shortform for -65535..65535, full mantissa/exponent otherwise)
- `decodeBasicProgram(data, options)` — Uint8Array → `[{ number, text, tokens, obfuscations }]`. `options.deobfuscate` (default `true`): when true, replaces obfuscated ASCII digits with `{{real_value}}`; when false, keeps original ASCII
- `buildTokenLookup()` — reverse lookup sorted longest-first, with `GOTO`/`GOSUB` alternate spellings
- `tokenizeLine(text, lookup)` — single line text → tokenized bytes with 0x0D terminator. Handles REM (literal after token), quoted strings (literal), keyword matching (longest-first, boundary-checked), numbers (ASCII digits + 0x0E + FP encoding)
- `parseBasicText(text)` — multi-line text → `[{ number, text }]`, sorted by line number (1–9999)
- `buildBasicProgram(lines, lookup)` — parsed lines → complete binary (line headers + tokenized content)

**UI module** (`ui/basic-editor.js`): init-function pattern with DI (`getSpectrum`, `readMemory`, `writePoke`, `isRunning`, `stopEmulator`, `showMessage`, `updateDebugger`).

**Explorer integration** (`ui/explorer.js`): caches raw BASIC data (`explorerBasicRawData`) for re-decoding with different options on copy.

### Copy Flow (BASIC tab)

1. Reads `PROG` (0x5C53) and `VARS` (0x5C4B) system variables
2. Validates PROG ≥ 0x4000 and VARS > PROG
3. Reads bytes from PROG to VARS
4. Calls `decodeBasicProgram(data, { deobfuscate })` — deobfuscate depends on "As listed" checkbox
5. Strips `{{`/`}}` markers, formats as `"10 PRINT \"HELLO\"\n20 GOTO 10"`
6. Writes to clipboard via `navigator.clipboard.writeText()`

### Paste Flow (BASIC tab)

1. Opens paste dialog (pre-fills from clipboard if available)
2. User pastes/types BASIC text, clicks Confirm
3. `parseBasicText()` validates line numbers (1–9999), sorts by number
4. Auto-pauses emulator if running
5. `buildBasicProgram()` produces binary
6. Checks size fits: `PROG + totalSize < RAMTOP` (0x5CB2)
7. Writes binary to memory at PROG via `writePoke()`
8. Updates system variables:
   - `VARS` (0x5C4B) = PROG + programLen
   - `E_LINE` (0x5C59) = VARS + 1 (after 0x80 end-of-vars marker)
   - `CH_ADD` (0x5C5B) = E_LINE
   - `WORKSP` (0x5C61) = E_LINE + 2 (after 0x0D + 0x80 edit line)
   - `STKBOT` (0x5C63) = WORKSP
   - `STKEND` (0x5C65) = WORKSP
9. Writes end markers: 0x80 at VARS, 0x0D + 0x80 at E_LINE

### Explorer Copy (Explorer -> BASIC tab)

Copy button next to the Decode button. Re-decodes cached `explorerBasicRawData` with chosen deobfuscation mode and copies formatted text to clipboard.

### "As listed" Option

Both the BASIC tab and Explorer have an "As listed" checkbox:
- **Unchecked** (default): deobfuscated — obfuscated numbers replaced with real FP values
- **Checked**: as listed — shows original ASCII digits as the Spectrum's `LIST` would display them

### Line Binary Format

```
[lineNum_hi] [lineNum_lo] [contentLen_lo] [contentLen_hi] [tokenized content...] [0x0D]
```

### Tokenizer Strategy

1. Build reverse lookup: keyword text (uppercase) → token byte, sorted longest-first
2. For each line, scan left-to-right:
   - After REM token: everything is literal bytes
   - Inside quotes: literal bytes
   - Keyword match: uppercase remaining text, try each keyword longest-first, require non-alpha boundary before and after match
   - Number: write ASCII digits, then append 0x0E + `encodeFloat5(parsedValue)`
   - Other chars (0x20–0x7F): write directly
3. Append 0x0D terminator
