# Changelog

All notable changes to ZX-M8XXX are documented in this file.

## v0.13.4
- **Assembler SAVESNA sjasmplus Compatibility**: Fixed SAVESNA to produce byte-identical output with the sjasmplus reference assembler:
  - **Page mapping fix**: ZXSPECTRUM48 page mapping changed from 128K-style [5, 2, 0] to correct [1, 2, 3] — the old mapping silently produced 16K of zeroes since pages 5 and 2 don't exist on the 4-page device.
  - **USR 0 memory initialization**: DEVICE ZXSPECTRUM* now initializes system variables ($5C00-$5CFF), UDG character data ($FF58-$FFFF), default stack ($5D58-$5D5B), and screen attributes ($5800-$5AFF) to match a real ZX Spectrum after USR 0.
  - **SNA header registers**: Set to proper USR 0 values (HL', DE', AF', HL, DE, IY, IX, AF, IFF2) matching sjasmplus. BC is set to the start address.
  - **48K PC injection**: Uses sjasmplus stack-check logic — if default stack is unmodified, injects PC at $5D56 with SP=$5D56; otherwise falls back to $4000.
  - **128K SNA fix**: SP set to $5D58 (default stack, was $0000). Port 7FFD value now includes bit 4 (ROM bank 1 / 48K BASIC) matching sjasmplus USR 0 state.
- **Assembler Text Encoding Support**: Non-UTF-8 assembly files are now handled with an encoding selector dialog. When a file fails UTF-8 decoding, the user is prompted to choose from CP866, Windows-1251, KOI8-R, ISO 8859, and other encodings with a live preview. The choice is remembered for subsequent files.
- **Assembler Error Location**: Error messages now always include the source file name and line number. Previously, errors from instruction encoders (e.g. "Invalid LD operands") showed the message without any location info, making it hard to find the problem.
- **Assembler IX/IY Half-Register Aliases**: Added support for sjasmplus register name aliases: `XH`/`HX` for `IXH`, `XL`/`LX` for `IXL`, `YH`/`HY` for `IYH`, `YL`/`LY` for `IYL`. These are commonly used in ZX Spectrum assembly code.
- **Assembler Include Directives**: Added `INSERT` (synonym for `INCBIN`), `INCHOB` (include Hobeta file, auto-skips 17-byte header), and `INCTRD` (extract and include a file from a TRD disk image). All match sjasmplus behavior and support optional offset/length parameters.
- **Assembler Export Plain Text**: Single source files are now exported as plain text by default instead of ZIP. An "Assembler: export as ZIP" checkbox in Settings → Display forces ZIP format for single files. Multi-file projects always export as ZIP regardless of the setting. Also fixed the Export button not appearing when typing code directly into the editor or after undo/redo.

## v0.13.3
- **Bookmark Clearing**: Ctrl+click a bookmark button or Ctrl+digit (1-5 left, 6-9/0 right) to clear a bookmark slot. Supports undo/redo.
- **Step Over Block Instructions**: F8 (Step Over) now executes repeating block instructions (LDIR, LDDR, CPIR, CPDR, INIR, INDR, OTIR, OTDR) to completion instead of stepping through each iteration.
- **Assembler Debug Navigation**: The Debug button now navigates a disassembly panel to the entry address. Prefers left panel if it's disasm, falls back to right panel if it's disasm, otherwise switches left panel to disasm mode.

## v0.13.1
- **Debugger Display Settings**: Three new checkboxes in Settings → Display for debugger view control:
  - **Flow break spacing** — toggle extra space after flow control instructions (JP, JR, RET, DJNZ). Default ON.
  - **Show PC cursor** — when OFF, hides the PC highlight during real-time running (always shown when paused). Default ON.
  - **Follow PC** — auto-scroll disassembly to follow the program counter. Moved from the disasm toolbar to Settings. Default ON.
  - All three settings persist to localStorage and apply to both left and right disassembly panels.

## v0.13.0
- **Assembler Undo/Redo**: Multi-level undo/redo for the assembler editor (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z). 100 levels of history with checkpoints at line breaks (Enter), typing pauses (400ms), and explicit actions (Tab, Replace). Cursor position saved/restored with each step. Stack resets on file switch, project load, and Clear.
- **Assembler Clear Confirmation**: The Clear button now shows a confirmation dialog before erasing all files and assembled output.
- **Assembler Example Code**: Updated the placeholder example to a random border stripes program using `LD A, R` / `OUT ($FE), A`.

## v0.12.0
- **Double-Buffer Flickering Fix**: Fixed sprite flickering in 128K games that use double-buffered screen rendering (e.g. the game "Shadow Fields"). Two related issues: (1) The multicolor attribute snapshot (`attrInitial`) was captured from the pre-swap screen bank at frame start, causing attribute/pixel bank mismatch after the ISR swaps the display bank — `setScreenBankAt()` now re-captures `attrInitial` from the new bank and clears stale attribute changes. (2) Attribute write tracking (`onMemWrite`) was recording writes to the back buffer ($5800 = always bank 5) as display changes even when bank 7 was being displayed, polluting the multicolor rendering path with irrelevant data — added `screenBank === 5` guard.

## v0.11.2
- **Auto-Screenshot (Timed Batch Capture)**: When Batch is checked, **F3** starts/stops timed auto-capture at a configurable interval (frames or seconds). Screenshots buffer automatically while the emulator runs. **Ctrl+F3** stops auto-capture and saves the buffer as ZIP. New "Every" input and "frames/seconds" dropdown in the Screenshot Button section. GIF format falls back to PNG during auto-capture. Auto-capture stops on machine reset/change. Settings persist to localStorage.
- **Right Panel Comments & Regions**: The right disassembly panel now shows user comments (before/inline/after/separator), region type markers (B/W/T/G/S), subroutine end markers, and user fold end markers — matching the left panel.
- **Export Filename Fix**: `getExportBaseName()` now reads from the last loaded filename (any type: SNA, Z80, TAP, TRD, etc.) and strips the file extension. Previously it read from disk/tape indicator tooltips, returning the placeholder "No disk" when only a snapshot was loaded.
- **GIF Export Button Fix**: The Export button in Export/Import tab now handles "Animated GIF" format directly — captures both flash phases, detects flash content, and produces a 2-frame animated GIF (or still image if no flash). Previously it only showed "Use Start/Stop" message.

## v0.11.1
- **Screenshot Button Settings**: The 📷 screenshot button below the canvas is now configurable. New "Screenshot Button" section at the top of the Export/Import tab with Format (PNG/SCR/GIF flash), Size (Screen only/With border), Zoom (x1/x2/x3), Overlay, and Batch toggles. PNG captures the screen at the selected size and zoom with optional overlay compositing. SCR exports raw 6912 bytes (with ULAplus palette if active). GIF (flash) creates a 2-frame animated GIF showing both flash phases (320ms per phase). SCR with ULAplus appends 64-byte palette (6976 bytes); raster palette effects (HAM256) cannot be captured in SCR — use PNG. **Batch mode**: when Batch is checked, F3 buffers screenshots instead of downloading; **Ctrl+F3** saves all buffered screenshots as a ZIP file and clears the buffer. Count shown next to checkbox. Settings persist to localStorage. Hotkey: **F3** (F3 remains Find Next inside the assembler editor).

## v0.11.0
- **Binary Export/Import**: New "Binary" section in the Export/Import tab. Export a memory range to a .bin file (start address + length or end address, mutually synced with proactive clamping). Import a .bin file into emulator memory at a specified address with immediate screen refresh (works while paused). Both operations respect current banking state (128K page, TR-DOS, +2A special paging, etc.). Tab renamed from "Export" to "Export/Import".
- **Compare: Memory vs Binary**: New comparison mode in the Compare tab. Compare a loaded binary file against current emulator memory at a specified start address. Uses banking-aware memory reads. Shows truncation warning if the file would overflow past $FFFF.

## v0.10.0
- **Explorer: Text Tab**: New "Text" sub-tab in the Explorer alongside BASIC / Disasm / Hex Dump. Shows raw file data decoded as text with a codepage selector dropdown (ASCII, CP866 DOS Cyrillic, Windows-1251, KOI8-R, ISO 8859-1). Source dropdown mirrors Hex Dump sources.
- **Explorer: OPD BASIC Fix**: Fixed Opus Discovery (.opd) BASIC decoding showing garbled line numbers. The file data header is 7 bytes (`type + datalen + param1 + param2`), not 6 as previously coded. Also fixed `listFiles` field mapping for autostart and startAddr.
- **Explorer: MGT BASIC Fix**: Fixed DISCiPLE/+D (.mgt) BASIC files showing "No BASIC lines found" or truncated listings. Three issues fixed: (1) `extractFile` now validates the sector address map and falls back to contiguous allocation from firstTrack/firstSector when the map contains invalid entries (common on third-party MGT images). (2) Single-sided images (side 1 all zeros) are detected so contiguous allocation stays on side 0 only. (3) The 9-byte +D file data header is now stripped before BASIC decoding.
- **Explorer: BASIC Decoder Robustness**: The BASIC decoder now scans for the 0x0D line terminator to find actual line boundaries (matching ZX ROM LIST behavior), rather than trusting the stored line length field which can be incorrect on some +D disk saves.
- **+D Interface Overhaul**: Fixed +D (DISCiPLE/+D) emulation with three major changes: (1) **Port mapping corrected** to match FUSE/real hardware — FDC at $E3/$EB/$F3/$FB, control at $EF, paging at $E7 (read=page in, write=page out). Previously the ports were assigned to wrong registers, so the +D ROM couldn't communicate with the FDC or page itself out. (2) **Auto-paging implemented** per FUSE z80_ops.c — +D ROM pages in at PC=$0008 (RST 8), $003A (KEY-NEXT), $0066 (NMI), $028E (KEY-SCAN), with no ROM bank restriction (works on 128K editor ROM too). This enables BASIC commands like `CAT 1`, `LOAD d1"filename"`, and `SAVE d1"filename"`. (3) **Port I/O gate fixed** — `_isPlusDActive` now allows port access whenever the +D ROM is paged in, not only when a disk is inserted.
- **Unit Test Runner**: New `tests/all-tests.html` — combined test runner page that orchestrates all 14 unit test suites via iframes. Dropdown to run all or pick individual suites, aggregate pass/fail/suite counters, expandable suite cards with color-coded badges, theme toggle synced into iframes. Replaces the dropdown selector in the emulator with a single "Unit Tests" link.

## v0.9.12
- **Debug Manager Tests**: New `tests/debug-test.html` — unit tests for all 9 debug managers (LabelManager, RegionManager, CommentManager, OperandFormatManager, UndoManager, FoldManager, TraceManager, XRefManager, SubroutineManager). ~103 tests covering add/get/remove, page-aware lookups, export/import round-trips, edge cases.
- **Breakpoint & Trigger Tests**: New `tests/breakpoint-test.html` — integration tests using a real Spectrum instance with small Z80 programs. ~55 tests covering execution breakpoints, write/read watchpoints, port breakpoints, comparison breakpoints, write/read monitors, memory freeze, call stack tracking, and the unified trigger API.
- **Disassembler Tests**: New `tests/disasm-test.html` — Z80 disassembler unit tests. ~200 tests covering all main opcodes, CB/ED/DD/FD prefixes, indexed CB (DD CB/FD CB), chained/redundant prefix handling, undocumented instructions (IXH/IXL/IYH/IYL, SLL, rotate+store), reference extraction (JP/JR/DJNZ/CALL/RST/LD), hex formatting, displacement formatting, address wrapping, and instruction length verification.
- **Format Loader Tests**: New `tests/loader-test.html` — unit tests for file format loaders. ~120 tests covering format detection (TRD/SCL/MGT/MDR/OPD/DSK/SZX/ZIP/RZX), TAP tape loading (block navigation, data integrity, unified timing parameters, edge cases), TRD/SCL directory parsing and file extraction round-trips, MGT disk info and sector offset calculation, MDR cartridge create/build/list/extract round-trips with data verification, OPD single/double-sided disk creation and geometry, DSK standard format parsing with sector read/write, and SZX header parsing and chunk building.
- **Memory Banking Tests**: New `tests/memory-test.html` — unit tests for the Memory class across all machine types. ~160 tests covering 48K memory layout (contiguous RAM, ROM protection, contention), 128K bank switching (RAM/ROM/screen, paging lock, port decode, contention on odd banks), +2A special paging modes (all 4 configs, all-RAM writability, 4 ROM banks, contention on banks 4-7, strict port decode), Pentagon (no contention), Pentagon 1024 (64 RAM pages, 1MB mode, RAM-over-ROM, lock bit behavior), Scorpion (16 pages, dual-port paging, ROM bank selection, TR-DOS in ROM bank 3), ROM/TR-DOS/+D/IF1 overlay paging and priority, read/write callbacks, and paging state save/restore.
- **Machine Profile & Utility Tests**: New `tests/machine-test.html` — unit tests for machine profiles and shared utilities. ~140 tests covering all 8 machine profile definitions (48K, 128K, +2, +2A, +3, Pentagon, Pentagon 1024, Scorpion), profile field validation, ROM size consistency, Z80 snapshot hardware mode lookups (V2/V3), SZX machine ID lookups with fallbacks, is128kCompat helper, constants verification (memory layout, ports, decode masks, SNA sizes), and utility functions (hex8/hex16, escapeHtml, arrayToBase64, localStorage wrappers).
- **FDC & DSK Tests**: New `tests/fdc-test.html` — unit tests for µPD765 FDC emulation and DSK format handling. ~130 tests covering DSKImage (construction, getTrack, readSector/writeSector, getTotalTracks), DSKLoader (isDSK detection, standard/extended parsing, unformatted tracks, createBlankDSK, getDiskSpec with checksum validation, getBlockAllocationMap), DSK filesystem (CP/M directory listing, deleted entries, multi-extent files, readFileData, writeDirectory, +3DOS header detection), UPD765 controller (reset, setMotor, hasDisk/ejectDisk, MSR states, Specify, Seek/Recalibrate with SenseInterruptStatus, SenseDriveStatus, ReadID, Scan stubs, drive selection, single/multi-sector Read/Write Data, physical track addressing, Format Track, Read Track, activity callbacks, write-during-result reset), and round-trip tests (toBuffer/parse, data preservation, weak sector handling).
- **Tape & AY Tests**: New `tests/tape-test.html` — unit tests for TapePlayer, TZXLoader, and AY sound chip. ~170 tests covering TapePlayer basics (construction, loadBlocks, play/stop/rewind, getPosition, getEarBit, callbacks), TapePlayer playback (pilot/sync/data/tail/pause phases, edge transitions, timing verification, multi-block progression), TapePlayer advanced (tone blocks, pulse sequences, stop/pause blocks, loop blocks, noPilot flag, usedBits<8, end-of-tape handling), TZXLoader (format detection, version parsing, block types 0x10/0x11/0x12/0x13/0x14/0x20/0x24+0x25, navigation, mixed types, TZX→TapePlayer integration), AY basics (register read/write with masks, tone/noise/envelope period calculation, mixer control, reset, stereo panning, clock rate, state export/import), AY sound generation (volume table, tone/noise generators, fixed/envelope amplitude, all 16 envelope shapes, getSample, stepMultiple/getAveragedSample), and AY PSG export (logging lifecycle, frame stats, PSG format output, changedOnly mode, empty frame skipping).
- **Disk Controller & Format Tests**: New `tests/disk-test.html` — unit tests for disk controllers and format loaders. ~200 tests covering TapeLoader (TAP parsing, navigation, getUnifiedBlocks, edge cases), BetaDisk WD1793 basics (constructor, createBlankDisk, multi-drive, ejectDisk, SCL-to-TRD conversion, getSectorOffset), BetaDisk commands (Restore, Seek, Step In/Out, Force Interrupt, Read Address, no-disk handling, reset), BetaDisk data I/O (Read/Write Sector, multi-sector read/write, system register/INTRQ, lost data simulation, activity callback, index pulse), PlusDDisk WD1772 (constructor, getSectorOffset, port addresses, control register, read/write sector, Type I commands, Read Address, INTRQ/DRQ, reset, multi-drive), Microdrive IF1 (constructor, cartridge management, COMMS shift register, read/write data, status register, head wrapping, getCartridgeData, reset, control modes), MGTLoader (format detection, _slotOffset, getSectorOffset, listFiles, extractFile, getDiskInfo), MDRLoader (mdrChecksum, format detection, createBlankMDR, buildMDR/listFiles round-trip, extractFile, multi-sector files, getDiskInfo), and OPDLoader (format detection, getSectorOffset, createBlankOPD, buildOPD/listFiles round-trip, extractFile, getDiskInfo, double-sided geometry).
- **GameMapper Tests**: New `tests/mapper-test.html` — unit tests for the GameMapper class. ~85 tests covering constructor defaults, room management (ensure/delete/move), screenshot add/delete/select, navigation and bounds calculation, multi-floor support, export/import JSON round-trips (including v1→v2 migration), text slides (create/render/isTextSlide), display image selection logic (selected vs blended vs first screenshot), and clear.
- **Signature Pack Tests**: New `tests/sigpack-test.html` — unit tests for SignaturePackManager. ~90 tests covering constructor, pack management (add/remove/enable/disable/import/export), matching engine (exact match, masked bytes, two-pass matching, offset voting for relocated code, multi-anchor confidence scoring, no false positives), label application (uniform offset, per-anchor offset, system pattern labels, nearest-anchor binary search, user label priority, region/comment import), .skool parser (control chars, @label directives, inline comments, multi-block files), .asm parser (labels, ORG, EQU, DEFB/DEFW/DEFS, INCLUDE resolution, instruction size tracking), Z80 address mask helper, internal helpers (_parseAsmValue, _countDataBytes, _splitDataItems, _isZ80Mnemonic, _z80InstrSize), and buildAnchorsFromMemory.
- **Calculator Tests**: New `tests/calculator-test.html` — unit tests for the programmer calculator. ~60 tests covering public API (getValue/setValue round-trips, BigInt handling), expression parser (basic arithmetic, operator precedence, parentheses, bitwise AND/OR/XOR/shifts, hex/bin/octal literals, negative numbers, division by zero, chained operations), bit size masking (8/16/32-bit truncation and sign extension), display formatting (hex/dec/bin/octal output, signed display, binary grouping), unary operations (NOT, INC, DEC, LSL, LSR, ASR, ROL, ROR with carry/sign behavior), and base conversion input parsing.
- All test suites accessible from Tools → Tests tab links. No ROM files needed.

## v0.9.11
- **Memory Freeze**: Lock memory addresses so the game cannot change them. Enable the freeze checkbox on any memory editor — the current value is rewritten every frame. Right-click any byte in the memory dump and choose "Freeze value" for one-click freezing.
- **Comparison Breakpoint**: Break when two memory addresses satisfy a condition (=, !=, <, >). Enter hero_x and enemy_x addresses, click Break — emulator pauses at the exact moment they become equal (collision). Condition is also checked immediately on start.
- **Register Tracker**: Log a register's value at a specific PC across frames. Shows value distribution histogram. Useful for understanding subroutine inputs and game state ranges.
- **Read Monitor Backward Slice**: Read Monitor results now show where comparison registers were loaded (e.g., "B from $6A10: LD B,(HL)"), tracing the data flow backward.
- **Struct Mapper**: Monitor all field accesses relative to a base register (IX/IY) or fixed address. Shows which offsets are read/written and by which subroutines — maps game entity structures automatically.
- **Subroutine Signatures**: Profiler now shows register inputs/outputs for each subroutine (e.g., "in: HL, A → out: CF"). Determined by static analysis of entry code.
- **Call Graph**: Visual call graph from profiler data. Canvas-based tree with clickable nodes, zoom/pan, and cycle detection. Open via Graph button after profiling.
- **Read Monitor**: Monitor reads from a specific memory address to find collision detection code. Enter a known coordinate address, click Monitor, trigger a collision, click Stop — shows all instructions that read from that address with call stacks and post-read context (reveals the CP/SUB comparison). Works regardless of access pattern (direct, IX+d, (HL)).
- **Register Watch**: Double-click a register pair name (BC, DE, HL, IX, IY, SP, PC) in the registers panel to add its current value as a memory watch.
- **Code Path: Per-Event Diff Modes**: Two new diff modes: `(A − B) − Baseline` and `(B − A) − Baseline`. Isolate code unique to a single event type (e.g., spike collision detection) by subtracting both the other event and normal gameplay. Enables finding per-enemy invulnerability pokes.
- **Code Path: Merge Recording**: "Merge" checkbox — union new recordings into existing slot data. Build comprehensive baselines across multiple gameplay sessions without losing previously recorded paths.
- **Code Path: Post-Diff Filter**: Filter row with mnemonic filter (pipe-separated terms), address range (hex from/to), and preset buttons: "Writes" (DEC|SUB|SBC|CP) and "Branch" (conditional JP/JR/CALL/RET). Matching instructions highlighted in cyan. Export respects filter — only visible blocks are exported.

## v0.9.10
- **Code Path: Intersection Diff**: New `(A ∩ B) − Baseline` diff mode. Finds code that ran in both Event A and Event B but not in the Baseline — isolates shared event handlers (e.g. the death routine common to all enemy types) for invulnerability pokes.
- **Code Path: Label Support**: Diff results and exports now substitute hex operand addresses with label names when available (e.g. `CALL main_loop` instead of `CALL 6A00h`). Block headers and address column show labels when the address has one.
- **Mapper: Text Slide**: New room type for adding text annotations to maps. Click "Text" in the toolbar to create or edit a text slide. Supports multi-line text with configurable font name, font size, font color, and paper color (color pickers). Use "Set as default" to save current settings as defaults for new slides. Text slides render in overview, export, and hover popup like regular rooms. Settings saved per-room in the map JSON.
- **Mapper: Remove Room / Move Room**: New toolbar buttons for room management. **Remove room** deletes the entire room (all screenshots, blend, stamps) at the current position (also via Ctrl+Delete). **Move** relocates a room: click Move, then click an empty cell on the overview canvas to reposition the room there.

## v0.9.9
- **Intelligent Add Poke**: Right-clicking a conditional instruction (JP cc, CALL cc, JR cc, RET cc) in the disassembly view now shows a submenu with two options: **NOP** (zero all instruction bytes, as before) or **make unconditional** (patch only the opcode byte to its unconditional equivalent — e.g. JP Z→JP, CALL NZ→CALL, JR C→JR, RET Z→RET). Non-conditional instructions still show the flat "Add poke" option.
- **Code Path Skip ROM fix**: The "Skip ROM" filter now correctly preserves code executing in RAM mapped over ROM (Pentagon 1024 `ramInRomMode`, Scorpion `scorpionRamInRomMode`, +2A/+3 special paging). Previously it discarded all addresses in the 0x0000–0x3FFF range regardless of what was actually mapped there. Also fixed `getAutoMapKey()` to tag RAM-over-ROM with the RAM page number instead of the ROM bank, so auto-map, profiler, and code path tracking correctly distinguish RAM from ROM in that region.
- **Code Path Tool**: Record and diff executed code paths to isolate event-specific handlers (collision, damage). 3 slots (Baseline, Event A, Event B), 4 diff modes, grouped disassembly output with export. Each block includes context instructions (configurable count via `CODE_PATH_CONTEXT_LINES` in constants.js, default 5) disassembled before the block start, marked with `*` for easy identification of branch patterns. Export is tab-aligned with mnemonic before bytes. **Trace mode**: click Trace after recording a baseline — emulator auto-breaks at the first instruction not in the baseline set, instantly isolating event-specific code entry points.
- **Help**: Documented Code-Flow Analysis, Text Scanner, Pattern Search, POKE Search Trace/blacklist, expanded Auto-Map controls. Reorganized help: new Tools section groups Auto-Map, Code-Flow, XRefs, Profiler, POKE Search, Write Monitor, and Text Scanner together.

## v0.9.8
- **POKE Manager Enhancements**:
  - **View patch details**: Click a poke name to expand/collapse the list of patched addresses with original and poke values.
  - **Rename pokes**: Double-click a poke name to edit it inline (Enter to save, Escape to cancel).
  - **Patch hints**: Optional per-patch description field ("Hint") in the add form and JSON format. Hints are shown as italic comments in the expanded patch view and persist in save/load.
  - **Create poke from disassembly**: Right-click any instruction in the disassembly view → "Add poke" creates a poke covering all bytes of that instruction (e.g. a 3-byte `LD (nn),A` creates 3 patches). Poke values default to $00 (NOP).
  - **Edit patches**: Double-click a patch line in the expanded view to edit the address, original value, poke value, and hint inline (Enter to save, Escape to cancel).
  - **Address navigation**: Click any address in the expanded patch details or in memory editors to navigate the left disassembly panel to that address.
- **Trace History Screen Revert**: Navigating trace history (slider, back/forward, click) now reverses memory writes so the emulator screen shows the historical state. Scroll back to see what the screen looked like at any traced instruction; return to live to restore current state. Works with both step trace and runtime trace. Memory operations record old values for undo/redo. Gracefully skips old trace entries recorded before this feature.
- **Trace History Slider**: Drag slider below the trace list to quickly scroll through the entire execution history. No more repeated clicking of the back button.
- **Trace History Disassembly Fix**: Stepping back through trace history now shows the correct instruction at the traced PC, even when memory banking has changed since recording. Previously the disassembly view could show zeroes or wrong bytes if a different ROM/RAM bank was currently paged in.
- **OPD Disk Format Support (Explorer)**: Parse, display, edit, and save OPD disk images (40 tracks × 18 sectors × 256 bytes, single-sided 180 KB or double-sided 360 KB). 0-based sector numbering.
  - **Explorer**: OPD analysis — disk geometry, sector usage, file listing. Hex dump for raw sector inspection. ZIP drill-in for OPD files inside archives.
  - **Dual-Panel Editor**: Create new OPD disks (SS/DS), import existing OPD images, cross-panel copy between OPD ↔ TAP ↔ TZX ↔ TRD/SCL ↔ MGT ↔ DSK ↔ MDR.
- **Interface 1 / Microdrive (MDR Cartridges)**: Full IF1 hardware emulation with 8KB shadow ROM paging at $0000-$1FFF, Microdrive tape-loop cartridge emulation with COMMS shift register for 8-drive daisy chain. ROM paging at PC=$0008 (RST 8) and PC=$1708 (CLOSE#), page-out at PC=$0700. Works with 48K, 128K, +2, Pentagon (not +2A/+3). Mutually exclusive with +D (conflicting ports $E7/$EF), compatible with Beta Disk.
  - **MDR Format**: Parse, display, edit, and save MDR cartridge images (254 sectors × 543 bytes = 137,923 bytes). Sector-level header/record parsing with file reconstruction from linked sector chains.
  - **Explorer**: MDR analysis — cartridge name, file listing with sector count and type, used/free sector counts. BASIC decoding, disassembly, and hex dump for individual files. ZIP drill-in for MDR files inside archives.
  - **Dual-Panel Editor**: Create new MDR cartridges, add/delete/reorder files, inline edit names, cross-panel copy between MDR ↔ TAP ↔ TZX ↔ TRD/SCL ↔ MGT ↔ DSK ↔ OPD with automatic format conversion.
  - **IF1 Settings**: Enable/disable Interface 1, load IF1 ROM (if1.rom). Mutual exclusion with +D. Settings persist across sessions.
  - **Media Catalog**: MDR cartridge file listing in Settings → Media with drive tabs (MDR:1 through MDR:8) and multi-controller prefix labels.
  - **Project Save/Load**: IF1 cartridge state fully preserved in project files (base64-encoded cartridge images).
  - **8 drives** (1-8) with drive selector in Settings → Media.

## v0.9.7
- **DISCiPLE/+D Interface (MGT Disks)**: Full +D hardware emulation with WD1772 FDC controller, 8KB ROM + 8KB RAM paging at $0000-$3FFF, and NMI snapshot button support. Works with any machine type (48K, 128K, +2, Pentagon, etc.).
  - **MGT Format**: Parse, display, edit, and save MGT disk images (80 tracks × 2 sides × 10 sectors × 512 bytes = 800 KB). Supports all +D file types: BASIC, CODE, arrays, 48K/128K snapshots, SCREEN$, opentype, execute.
  - **Explorer**: Full MGT analysis — file listing with type, size, start address. BASIC decoding, disassembly, and hex dump for individual files. ZIP drill-in for MGT files inside archives.
  - **Dual-Panel Editor**: Create new MGT disks, add/delete/reorder files, inline edit names and types, cross-panel copy between MGT ↔ TAP ↔ TZX ↔ TRD/SCL ↔ DSK with automatic format conversion.
  - **+D Settings**: Enable/disable +D interface, load +D ROM (plusd.rom), NMI button for snapshot trigger. Settings persist across sessions.
  - **Media Catalog**: MGT disk file listing in Settings → Media with drive tabs and multi-controller prefix labels (MGT:A, MGT:B) when multiple disk interfaces are active.
  - **Project Save/Load**: +D disk state fully preserved in project files (base64-encoded disk images).
  - **2 drives** (A-B) with drive selector in Settings → Media.

## v0.9.6
- **Dual-Panel File Editor**: Explorer Edit tab — Norton Commander-style dual-panel interface for TAP, TZX, TRD/SCL, and DSK formats. Create, edit, reorder, delete, extract, and save blocks/files. Cross-panel copy with automatic format conversion. Inline editing via double-click. ZIP archives transparently unwrapped.
- **TZX Editor**: Standard speed blocks use the same workflow as TAP. Non-standard blocks (turbo, pure tone, metadata, etc.) preserved as read-only rows with full round-trip save/load. Editable per-block pause values.
- **DSK Write Persistence**: +3 games can save to disk. FDC writes preserved across project save/load.
- **Hobeta Support**: Full import/export support for Hobeta files (.$B, .$C, .$D, .$#, .hobeta) — the standard single-file exchange format for TR-DOS files.
  - **Extract dropdown**: The Extract button is replaced by a dropdown with "Extract bin" (raw binary) and "Extract Hobeta" options, available for all panel types (TAP, TZX, TRD/SCL, DSK). Linked header+data pairs in TAP/TZX produce a single Hobeta file (header metadata embedded in the Hobeta wrapper).
  - **Add File**: Hobeta files dropped onto TRD/SCL panels are auto-detected — the 17-byte header is stripped and filename, extension, and start address are pre-filled in the add dialog.
  - **Explorer**: Hobeta files can be opened directly in the Explorer for analysis (File Info, BASIC decode, Disasm, Hex Dump, screen preview).
- **DSK Boot Sector Fix**: Fixed +3DOS boot sector disk specification byte layout — an extra `firstSectorId` byte at position 4 shifted all subsequent fields, causing external tools (ZX-Blockeditor, etc.) to show files as "HEADERLESS". Also fixed checksum formula (sum ≡ 3 mod 256) and disk type byte.
- **DSK Directory Fix**: Removed non-standard CP/M byte 13 (S1) write from directory entries — +3DOS uses CP/M 2.2 where S1 must be 0.
- **TR-DOS BASIC Fix**: Fixed BASIC file autostart field in cross-panel copy — TR-DOS bytes 9-10 are program body length, not autostart (autostart is embedded in the BASIC data).

## v0.9.52
- **Screen Region Write Breakpoints**: New "Write Bitmap" and "Write Attr" trigger types break on writes to rectangular screen regions. Cell mode (col, row, width, height in character cells) or pixel mode (x, y, w, h in pixels — bitmap only). Supports Normal screen (page 5), Shadow screen (page 7), or Both. Uses precomputed address Sets for O(1) lookup with zero overhead when no screen triggers are set. Saved/restored in projects.
- **Media Catalog → Explorer**: Double-click a tape block or disk file in Settings → Media catalog to open the full tape/disk image in Utils → Explorer for analysis (BASIC decode, disassembly, hex dump).
- **Kempston Info**: Utils → Info now documents extended Kempston buttons (bits 5-7: C, A, Start) instead of showing "Not used".
- **TZX Explorer**: Standard speed blocks in TZX files now support BASIC decoding, disassembly, and hex dump in Explorer — same as TAP files. Click a Program header to decode BASIC, a Bytes header to disassemble, or a data block to view hex.

## v0.9.51
- **Boot File Injection**: Fixed Hobeta boot files being rejected when the internal filename wasn't literally "boot". A Hobeta file selected as boot source is now always accepted — the injection writes the name as "boot" regardless of the original filename.

## v0.9.50
- **GIF Export**: Fixed all-black frames when recording starts from a black screen. Each frame now uses a local color table instead of relying on the first frame's palette as the global table.
- **Disk Auto-Load**: Fixed filenames with special characters (hyphens, punctuation) being silently stripped during TR-DOS RUN command injection. All Symbol Shift characters are now supported.

## v0.9.49
- **Write Monitor (Collision Finder)**: New "Watch" tool in Search panel monitors writes to a specific memory address (e.g. lives counter). Play the game, trigger a collision/death, then stop — the monitor captures every writing instruction's PC, full call stack, and value transitions. Results are grouped by writing PC with disassembled instructions, deduplicated call chains (clickable addresses navigate to disasm), and NOP suggestions identifying the exact CALL instruction to patch out. Workflow: use POKE Search to find the lives address, enter it in Watch, click Monitor, play until hit, click Stop. Machine change and reset automatically stop monitoring.

## v0.9.48
- **Text Ripper (OCR)** enhancements:
  - Custom cell size: configurable cell width (4–8 px) and height (4–16 px) per charset, enabling OCR of non-standard fixed-width fonts (4×8, 6×8, 8×16, etc.). Sub-byte pixel extraction handles non-byte-aligned widths across byte boundaries. Grid origin offsets (OX, OY) shift the cell grid for fonts that don't start at pixel (0,0). Cell gap (GX, GY, 0–8 px) adds spacing between cells for programs that print with empty lines or columns between characters
  - Grid overlay: toggleable orange grid on the preview canvas showing cell boundaries at current CW/CH/OX/OY. Red crosshair marks the origin point when OX/OY > 0
  - Preview zoom: x1/x2/x3 zoom buttons below the preview canvas (x2 default). Grid overlay renders at display resolution for crisp lines at any zoom level
  - Bulk glyph delete: Ctrl+click tiles to multi-select (orange highlight), then delete all selected at once via "Del N selected" button
  - Capture Known mode: "Known" checkbox next to Capture button. When enabled, only glyphs already mapped in any charset are captured; unknown glyphs become spaces
  - Charset selector in Extract Font dialog: destination charset dropdown so extracted glyphs go into the selected charset instead of always the active one. W/H auto-sync when switching charset
  - Fix: imported charsets now correctly display their glyphs immediately (was missing bitmap reconstruction from hash data)
  - Fix: switching charsets via dropdown now rebuilds glyph bitmaps so extracted font glyphs display correctly
  - Fix: extracted font glyphs no longer disappear when pages are deleted

## v0.9.47
- **Text Ripper (OCR)**: New OCR tab in Utils for screen-based character recognition. Captures 8×8 glyph bitmaps from screen memory ($4000 or $C000 shadow), maps unique glyphs to characters via an interactive tile grid, and renders extracted text. Features: multiple named charsets (create/rename/delete), multi-page capture with append/new page, mouse drag region selection on preview canvas, hash-grid storage (remapping a glyph updates all pages instantly), session auto-save to localStorage, full session and charset import/export as JSON, text export. Primary use case: diskmag text ripping.

## v0.9.46
- **Symbols reference**: New "Symbols" subtab in Utils → Info showing the complete ZX Spectrum character set (codes 0–255): control characters, printable ASCII with ZX exceptions (↑, £, ©), block graphics with Unicode glyphs, UDG characters, and all 91 BASIC keyword tokens.

## v0.9.45
- **Autofire**: New autofire feature in Settings → Input with named profiles. Configure key (Fire/Space/Enter/Caps Shift/Sym Shift/0-9/A-Z), repeat rate (1–50 Hz), and hold duration (30%–70% or constant Hold). Toggle with Ctrl+F or checkbox. Multiple profiles for different games — click to switch, + to add, rename/delete. Fire option uses Kempston joystick fire bit. Profiles persist in localStorage; autofire always starts off and stops on machine reset.

## v0.9.44
- **Run BASIC from TRD/SCL disk**: New "Run first BASIC" and "Run last BASIC" options in the Boot File dropdown (Settings → Media). When a disk is loaded with auto-load enabled, boots TR-DOS and types `RUN "filename"` to execute the selected BASIC program. Boot files named "boot" are skipped unless they're the only BASIC file on disk. The existing boot file on disk is temporarily hidden during TR-DOS init to prevent auto-run, then restored.
- **Breakpoint UX improvements**: Wider click hit zone for breakpoint dots in disasm view. Disabled breakpoints now show a visible `×` indicator (was nearly invisible). Light theme breakpoint line background lightened to `#fde0d8`.
- **Memory search hex fix**: "Last char 7-bit" and "Case insensitive" options now only apply to text searches. Previously they were applied to hex/decimal searches too, causing false matches (e.g. searching `CD 01` would match `CD 81` because `0x81 & 0x7F = 0x01`).
- **Poke manager project load fix**: Pokes saved in projects now correctly toggle memory on enable/disable. The project save format (object patches) was incompatible with the loader (expected array patches); loader now handles both formats.
- **Graphics Viewer improvements**: Canvas rendering switched from thousands of `fillRect` calls to atomic `ImageData`/`putImageData` for tear-free updates. Added "Emulator is running — memory is changing" warning overlay when viewing graphics while emulator is running.
- **Code quality**: Removed init-scope spectrum captures in 6 UI modules (use `getSpectrum()` at point of use). Consolidated 17 duplicate DI parameter wrappers (`readMemory`/`getMemoryInfo`/`getRamBank`) into 3 shared wrappers. Standardized localStorage key prefixes to `zxm8_`.

## v0.9.43
- **ULAplus border color fix**: Border now uses CLUT 0 PAPER entries 8-15 indexed by port $FE border color (was hardcoded to entry 8). Also fixed border flush trigger to cover all border-relevant palette entries (8-15), so mid-frame border color changes via ULAplus palette writes render correctly.
- **Scorpion ZS 256 boot fix**: Fixed three paging bugs that prevented the Scorpion from booting:
  - Port 0x7FFD decode changed from loose 128K-style `(port & 0x8002) === 0` to +3-style `(port & 0xC002) === 0x4000` — prevents 1FFD writes (A14=0) from incorrectly triggering the 7FFD handler
  - RAM page calculation: restored 1FFD bit 4 contribution — `page = ((1FFD & 0x10) >> 1) | (7FFD & 0x07)` gives pages 0-15, per FUSE/ZXMAK2/UnrealSpeccy
  - ROM bank selection in `writeScorpion1FFD`: when 1FFD bit 1 is cleared, ROM 0/1 is now determined from the stored 7FFD bit 4 value (matching FUSE's `(last_byte & 0x10) >> 4`), not from `currentRomBank & 1` which gave incorrect results when transitioning from ROM 2
- **ES Module Extraction Round 4**: Extracted 4 more modules from `index.html` following the init-function DI pattern:
  - `ui/disk-activity.js` — Disk activity LED indicator and track/sector status display
  - `ui/memory-view.js` — Right + left panel hex dump, inline byte editor, mouse selection, scroll wheel
  - `ui/right-disasm-view.js` — Right panel disassembly view (never auto-follows PC)
  - `ui/debugger-display.js` — Register rendering, left panel disassembly view, sub-panel update dispatch
- **`panel-navigator.js` late-binding**: Changed `updateMemoryView`/`updateLeftMemoryView` DI params to getter pattern (`getUpdateMemoryView`/`getUpdateLeftMemoryView`) to resolve circular init dependency with memory-view module
- **`updateDebugger()` thin wrapper**: Body extracted to `debugger-display.js` `renderDebugger()`; index.html retains a one-line delegating function for backward compatibility with all existing callers
- **ES Module Extraction Round 5**: Extracted 4 more modules from `index.html`:
  - `ui/step-controls.js` — Step/Run button handlers for both left and right panels
  - `ui/disasm-navigation.js` — Disasm address nav, export dialog, scroll wheel, click handlers
  - `ui/labels-panel.js` — Label filter, add, clear, export, import, list click/dblclick
  - `ui/psg-player.js` — PSG player template download
- **Right panel Run to Cursor fix**: Right panel "To Cursor" button now works correctly (was referencing undefined variable and nonexistent method)
- **Hover-aware keyboard navigation**: Arrow keys and PageUp/PageDown now scroll whichever debugger panel the mouse is hovering over, supporting both disasm and memory views:
  - Left/Right — scroll by 1 byte
  - Up/Down — scroll by 1 line
  - PageUp/PageDown — scroll by 1 page

## v0.9.42
- **Test Runner fix**: Fixed Pentagon TRD/SCL disk tests — `injectDiskRunCommand()` was lowercasing all filename characters, causing TR-DOS `RUN "test pc"` to fail (case-sensitive match against uppercase `TEST PC` on disk). Uppercase letters now typed with Caps Shift. Added `=` character support (Symbol Shift + L) for filenames like `=GLOBAL=`.
- **Keyboard mapping**: PC Shift now maps to Caps Shift — Shift+letter produces uppercase in BASIC/TR-DOS, matching standard PC typing expectations. Shift+digit continues to produce symbols (!@#$%^&*) via the punctuation handler (Caps Shift temporarily suppressed to avoid Extended Mode). Ctrl is no longer mapped to Caps Shift — reserved for browser shortcuts (Ctrl+C/V/Z etc.). Alt remains Symbol Shift.

## v0.9.41
- **ES Module Extraction Round 3**: Extracted 3 more modules from `index.html` following the init-function DI pattern:
  - `ui/bookmarks.js` — Bookmark management for left/right debugger panels
  - `ui/input-settings.js` — Input & Mouse Settings (Kempston, gamepad, mouse capture, Beta Disk toggle)
  - `ui/file-loader.js` — File loading, drag-drop, ZIP selection modal, media indicators, blank disk
- **`display-settings.js` lazy getter**: Changed `handleLoadResult` DI param to `getHandleLoadResult` (late-binding getter) to resolve circular dependency with file-loader

## v0.9.40
- **ES Module Extraction Round 2**: Extracted 3 more modules from `index.html` following the init-function DI pattern:
  - `ui/machine-selector.js` — Machine dropdown and settings checkboxes
  - `ui/project-io.js` — Project save/load (saveProject, loadProject)
  - `ui/keyboard-shortcuts.js` — Global keyboard shortcut handler
- **`arrayToBase64` moved to `core/utils.js`**: Pure utility function now shared via import instead of duplicated in index.html scope

## v0.9.39
- **GFX tab moved to Utils**: Graphics Viewer is now a sub-tab under Utils (formerly top-level GFX tab). Lazy-loaded on first visit to reduce initial page load.
- **Tools → Utils rename**: Renamed top-level "Tools" tab to "Utils" to avoid confusion with the debugger panel "Tools" tab.

## v0.9.38
- **File Reorganization**: Moved all root-level JS files into categorized subdirectories: `core/` (12 files — emulation engine), `debug/` (8 files — debugger managers), `tools/` (2 files — standalone engines), `lib/` (1 file — pako). Moved test HTML files, FUSE test data, and tests.json into `tests/`. Moved static data assets (palettes, keyboard image, ROM labels) into `data/`. All import paths updated across index.html, ui/*.js, and test HTML files.
- **Heatmap Export**: Export automap data from the Memory Map heatmap view as a TSV text file. Columns: Address ($hex), Page (memory bank), Exec/Read/Write counts. Checkboxes to skip ROM and screen addresses.
- **ES Modules**: Converted all JavaScript files to ES modules with proper import/export.
  Inspired by dcorp80's modularization PR (github.com/Bedazzle/ZX-M8XXX/pull/1).
- **Unified Load**: Removed separate "Load → Project" menu option. Project files (.zxproj, .json) are now loaded via Load → File or drag-and-drop, alongside snapshots and other formats.

## v0.9.37
- **POKE Manager**: New "Pokes" tab in the debugger panel for managing named pokes (multi-address byte patches with on/off toggle) and memory value editors. Load poke definitions from external JSON files — patches use compact `[addr, normal, poke]` arrays with `$hex`, `0xhex`, or decimal formats. Each poke stores original and patched byte values — toggling a poke instantly writes to memory via checkbox, and disabling restores the original values. Memory editors provide live byte/word read and write with hex input. Poke state (entries, editors, enabled flags) persists in project save/load.
- **POKE Manager CRUD**: Two-column layout with editors on the left and pokes on the right. Inline add/delete for both: poke add form accepts name, address, original value, and poke value — entering the same name adds a patch to the existing poke (multi-patch building). Editor add form accepts name, address, and byte/word type. Remove entries with × button (pokes restore original bytes if enabled). Master checkbox toggles all pokes on/off (indeterminate state when partially enabled). Editor values apply immediately on Enter or blur — accept `$hex`, `0xhex`, or decimal input. Single Read button refreshes all editors from memory. Save exports all pokes and editors to JSON. Load/Save/Clear buttons grouped at top right. Click game name label to edit.
- **Game Mapper**: New "Mapper" sub-tab in Tools for capturing game screens and stitching rooms into a navigable map grid. Capture the current screen (or a configurable sub-region) into the current room slot, navigate with arrow buttons to adjacent rooms, and build up a full map. Supports multiple screenshots per room with thumbnail selection, pixel-averaging blend mode, and a zoomable overview canvas with click-to-select navigation and hover popup preview. Multi-floor support for games with vertical layers (floor navigation via toolbar or Ctrl+PgUp/PgDn). Separate horizontal and vertical room gap settings for flexible spacing. PNG export with composite grid layouts (N×... columns or ...×N rows) or separate files per floor; configurable floor gap for composite exports; empty floors are automatically skipped. Save/load map data as JSON. Keyboard shortcuts: Ctrl+Space (capture), Ctrl+Arrows (navigate rooms), Ctrl+PgUp/PgDn (change floor). Compact toolbar with collapsible settings panel for metadata and export options.
- **Mapper Stamp tool**: Stamp regions from individual screenshots onto the blended image to correct blend artifacts (e.g. animated objects removed by mode algorithm). Select a source screenshot thumbnail, click Stamp, drag a rectangle in the dialog to copy those pixels onto the blend. Multiple stamps per room, persisted in save/load, re-applied on re-blend. Clear stamps to revert to pure mode blend. Escape closes the dialog.
- **Mapper popup zoom**: Room hover popup in the overview canvas now displays at 2x zoom for better visibility.
- **POKE Search rewrite**: Snap-based architecture — take multiple snapshots at different game states, then search to find addresses matching a pattern across all snaps. Every snap-to-snap transition is validated (no deduplication). More snaps = fewer candidates. Removed progressive narrowing; each search scans all RAM from scratch using the full snapshot history.
  - **Snap counter**: Status line shows `(snaps: N)` and `(snaps: N, M candidates)` after search
  - **Value filter**: Enter a hex value and click Filter to keep only candidates where current memory matches that value. Reversible: clear the value and click Filter to undo. Re-filtering with a different value works from the original search results.
  - **Value history tooltip**: Hover over a result to see values at every snap point (e.g. "05 → 04 → 03 → 02")
  - **Skip screen**: Checkbox (on by default) excludes screen memory (4000-5BFF), reducing false positives
  - Removed "Equals" search mode (incompatible with snap-based architecture)
- **Mapper overview zoom**: Zoom selector in settings — Fit (auto-scale to container, default), x1 (native pixel size), x2 (double). x1 and x2 enable scrolling when the map exceeds the container. Follow option auto-scrolls to the current room in x1/x2 mode. Persisted in save/load.
- **Mapper region lock**: Capture region controls (X, Y, W, H) are disabled once any screenshot exists, preventing dimension mismatches between existing captures and new ones. Clear the map to unlock.
- **Memory dump: Break on read/write**: Right-click context menu on memory bytes now includes "Break on read", "Break on write", and "Break on R/W" options to quickly set watchpoint-style breakpoints. Supports single address or drag-selected range.
- **Mapper Room Mark**: Mark rooms with a colored diagonal cross (X) overlay to flag rooms needing attention. Choose from all 8 ZX Spectrum colors via a toolbar dropdown. Marks appear in the overview canvas, hover popup, and PNG export. Persisted in save/load JSON.
- **Game Mapper**: Optimized layout — reduced top padding and eliminated empty space below the overview container.
- **Fixed**: Mapper stamp dialog now saves and restores scroll position, so the overview doesn't jump when closing the dialog.
- **Fixed**: Mapper room hover popup now positions correctly in x1/x2 zoom modes, accounting for container scroll offset so the popup never appears off-screen.
- **Fixed**: Breakpoints list scrollbar no longer overlaps remove buttons — uses thin custom scrollbar with right padding for clearance.
- **Fixed**: Memory dump context menu now repositions when it would overflow the viewport, ensuring all options remain accessible when right-clicking near the bottom or right edge of the screen.
- **Fixed**: Memory dump byte editing in first column — clicking the first byte of a line now correctly enters edit mode instead of selecting the address field.

## v0.9.36
- **UI: Tests layout redesign**: Test list table columns are now compact (no stretched empty space). Preview and comparison images moved to the right side panel. Test result details (e.g. "Step 2, frame 1035: 228 pixels differ") integrated directly into the test list as a Details column. Summary stats (passed/failed/skipped/time/fps) moved to the top bar. Removed separate Results Summary section at the bottom. Increased test list height to show ~20 rows.
- **Fixed**: Beta Disk not working in autotests when switching to Pentagon. `setMachineType()` updated `profile` but not `betaDiskEnabled`, so disk I/O ports were inactive despite TR-DOS booting successfully ("No disk" error). Now enables Beta Disk automatically when switching to Pentagon/Scorpion.
- **Fixed**: ULAplus state leaking between autotests. `setMachineType()` carried runtime `ulaplus.enabled` from the old ULA to the new one, so a test with `ulaplus: true` could pollute subsequent tests via machine switches in the finally block. Now reads the user's persistent setting from localStorage instead of runtime state.
- **Fixed**: INT pulse timing for HALT-to-interrupt transition (HALT2INT test now passes)
- **Fixed**: Late timing offset correctly applied to INT pulse window (48K only)
- **Fixed**: HALT NOP contention — HALT NOPs at contended addresses now apply per-access memory contention (M1 fetch from PC+1), matching real Z80 hardware behavior

## v0.9.35
- **Hotspot detection**: Profiler now tracks per-PC T-state consumption during profiling. After completion, identifies small address ranges consuming disproportionate CPU time (>1% of total). Classifies hotspots as delay loops (`delay_djnz`, `delay_bc`), block operations (`block_ldir`, `block_lddr`), I/O operations (`io_poll`, `io_block`), frame sync (`frame_sync`), or generic hotspots. Results displayed as clickable rows in Analysis card showing percentage, address, classification, and size. Click navigates to hotspot address.
- **System signature pack**: New built-in "Common Z80 Patterns" signature pack (`signatures/system_patterns.json`) with well-known Z80 byte patterns that can appear at any address: DJNZ delay, DEC BC delay, IM 2 setup, CLS LDIR, CLS attributes, DI/HALT frame sync, ROM tape loader edge loop, screen line advance, masked/XOR sprite column. Uses `type: "system"` with each anchor placed directly at its found address. Enabled by default in Settings → Signatures.
- **Decompressor signature pack**: New built-in "Decompressor Routines" pack (`signatures/decompressors.json`) with 28 byte-pattern signatures for common Z80 decompressors: ZX0 (standard/turbo/fast/mega, each with backward variant, plus v1 fast), ZX1 (standard/turbo/mega, each with backward variant), ZX7 (standard/turbo), ZX7B backward (slow/medium/fast), MegaLZ V4, Exomizer 2, LZ48, LZ49, Pletter 0.5c, Bitbuster 1.2, LZSA1, LZSA2, Shrinkler. Scan Memory finds decompressor routines at any address and labels them (e.g. `decompress_zx0_std`). Enabled by default.

## v0.9.34
- **Runtime behavior profiler**: New "Profile" tool in Analysis card (Tools tab). Runs the emulator for N frames (default 200), tracks per-subroutine behavior (port I/O, screen access, call patterns), and generates descriptive labels. Replaces generic `sub_XXXX` names with labels like `read_keyboard`, `draw_sprite`, `play_music`, `main_loop`. Preserves user-named labels. Profiled labels tagged with "P" badge and `source: 'profiler'` for filtering. IM 2 support: detects interrupt mode 2 handler address (`isr_handler_im2`) and marks the vector table at I×256 as a DW data region (`im2_vector_table`).
- **Label source filter**: New dropdown in Labels panel replaces the ROM checkbox. Filter by All / User / Profiled / ROM. Label counts shown per category (e.g. "12 user, 8 profiled, 85 rom").
- **Page-aware label resolution**: Disassembly view now resolves labels using the current memory page (ROM bank, RAM bank). Paged labels from profiler and other sources now appear correctly in disasm and operands on 128K/Pentagon/Scorpion machines.
- **Label click navigation**: Clicking a label in the Labels panel navigates to that address — prefers disasm view, falls back to memory view.
- **Fix call stack overflow**: Calls panel now has a max height (200px) with scrollbar, preventing UI layout breakage from deep call stacks.

## v0.9.33
- **Tape & disk breakpoint triggers**: Three new trigger types in the unified breakpoint system:
  - **Tape Block**: Break after N tape blocks loaded (flash load or real-time playback). Use skip count to set the block threshold.
  - **Disk Read**: Break after N disk sector reads from any controller (TR-DOS WD1793 or +3DOS µPD765).
  - **Disk Sector**: Break on a specific track:sector read. Enter as TT:SS (e.g. 0:1 for track 0, sector 1). Works with both TR-DOS and +3DOS.

## v0.9.32
- **Mouse wheel direction swap**: New "Swap Wheel" checkbox in Settings → Input inverts Kempston Mouse wheel direction.
- **Persistent input settings**: Kempston joystick, extended buttons, gamepad, mouse, wheel, swap L/R, and swap wheel settings are now saved to localStorage and restored on reload.
- **Swap L/R default**: Mouse button swap is now checked by default.
- **Screen info popup**: Bitmap rows now show memory addresses. Removed "multicolor" label from attribute display.
- **Fix call stack crash**: Guard against undefined `_debugCallStack` during early initialization.
- **UI: Settings reorganization**: Beta Disk checkbox moved from Input to Machines tab. ROMs button removed from Media tab (already in Machines). GitHub button tooltip updated to list all supported formats.

## v0.9.31
- **Fix WD1793 Lost Data simulation**: Games that issue Read Sector and only poll the system register ($FF) for INTRQ — without reading data from port $7F — now work correctly. On real WD1793 hardware, data bytes arrive at disk rotation speed and are "lost" if not read; after all bytes pass, INTRQ fires. M8XXX's instant-completion model lacked this, causing infinite loops in games like Merged on Pentagon 128.
  - Tracks consecutive system register polls without data reads (`_sysReadsSinceData` counter)
  - After 2+ consecutive $FF reads without a $7F read, remaining sector bytes are auto-completed with LOST_DATA flag
  - Counter properly reset when new commands are issued, preventing false triggers during normal data-reading loops
  - Works for both single-sector and multi-sector reads
- **Fix WD1793 Read Address**: Read Address command ($C0) now returns the physical head position (`headTrack`) instead of the track register value. These can differ when the track register is updated without a seek.
- **Fix WD1793 multi-sector read/write**: Multi-sector commands (m=1) now advance to the next sector after each sector is consumed via port $7F, continuing until past the last sector on the track.
- **Fix WD1793 INTRQ timing**: INTRQ is no longer cleared on status register read. In the instant-completion model, clearing on read caused TR-DOS to miss INTRQ when it reads status before polling the system register. INTRQ is now only cleared when a new command is issued.
- **Audio fallback for non-secure contexts**: When AudioWorklet is unavailable (plain HTTP), audio automatically falls back to ScriptProcessorNode. Enables sound on VPS or LAN deployments without HTTPS.
- **UI: Late Timings moved to Machines tab**: Late Timings checkbox relocated from Settings → Display to Settings → Machines, near the Load ROMs button.
- **UI: Fix register panel wrapping**: REGS and SYSTEM panels no longer wrap register items to new lines when the window is narrow. Each row (AF/BC/DE/HL, SP/PC/I/IM/IFF, etc.) stays on a single line.
- **UI: Landscape layout improvements**: Wider right panel (memory/hex dump), tab container shifts left at zoom x2/x3, wider Breakpoints/Labels panel.

## v0.9.30
- **Cross-game signature matching**: Signature packs can now match code across different games sharing the same engine. Per-anchor offset voting resolves procedures relocated to different addresses. Each label is mapped using its nearest matched anchor's offset.
- **Z80 address operand masking**: Anchor fingerprints automatically mask 16-bit address operands (CALL nn, JP nn, LD rr,nn, LD (nn),A, etc.) so byte patterns match even when absolute addresses differ between game builds.
- **Two-pass anchor matching**: Pass 1 matches anchors exactly (all bytes). Pass 2 applies address masks for anchors with no exact match. Exact matches receive double vote weight for offset disambiguation.
- **Direct Apply button**: Apply all labels from a signature pack directly at offset 0, bypassing memory scanning. Useful when the target binary matches the source addresses exactly.
- **ZIP import for signatures**: Import .zip files containing any combination of .asm, .a80, and .skool source files. All files are extracted and processed together, with INCLUDE directives resolved across the archive.
- **Label count display**: Labels tab shows user-defined label count next to the Clear button.

## v0.9.29
- **Signature Packs**: Modular knowledge base for automatic label/region recognition. Engine signatures (AGD, Quill, etc.) and game-specific disassemblies stored as individual JSON pack files. Enable/disable packs via Settings → Signatures.
- **Import formats**: .skool (SkoolKit) and .asm/.a80 (sjasmplus/pasmo/z80asm) with INCLUDE resolution. Multi-file ASM projects parsed as a single pack.
- **GitHub browser**: Browse any GitHub repository for .skool/.asm files. Paste a repo URL, scan for source files, select and import. ASM files downloaded as batch for INCLUDE resolution across the project.
- **Kempston Mouse Swap L/R**: Option to swap left/right mouse button bits (bit0↔bit1) for different hardware implementations. Settings → Input → Swap L/R.
- **Trace register change detection**: Trace panel only shows registers that changed since the previous entry instead of repeating all values. Alt regs and Sys regs checkboxes now also control the live trace display.
- **Debugger hotkeys (paused mode)**: 1-5 jump to left panel bookmarks, 6-9/0 jump to right panel bookmarks, Shift+digit sets bookmark, tilde (`) resumes emulation, PageUp/PageDown scrolls disassembly by page, Up/Down scrolls by line
- **Breakpoint ΔT counter**: System registers panel shows accumulated T-states since last breakpoint fired. Accumulates through steps, runs, and all execution modes. Resets when any breakpoint fires (exec, watchpoint, port). Useful for cycle-exact timing measurement.
- **Calls panel**: Runtime call stack tracking in the register area. Tracks CALL, RST, and INT pushes; removes entries on RET/RETI/RETN. Shows active subroutine chain with labels and INT markers. Click to navigate, right-click for context menu. Cleared on machine reset. Direct SP manipulation (LD SP,nn / LD SP,HL) resets the call stack. POP instructions are filtered out (only true RET pops entries).
- **Assembler Debug labels**: The Debug button now injects assembler symbol labels into the debugger. Labels from compiled ASM source appear in disassembly, call stack, and other views. Skips internal labels (prefixed with `__`) and doesn't overwrite existing labels.
- **System panel layout**: Reorganized register panels — SP/PC/I/IM/IFF on first row, T-st/ΔT on second row, R register on the flags row. Compact spacing between panels.
- **Stack/Calls click navigation**: Clicking an address in the Stack or Calls panel navigates to that address. Priority: left disasm → right disasm → left memory → right memory. Right-click context menu still available for explicit panel choice.
- **Zoom hotkey**: F1 cycles canvas zoom (x1 → x2 → x3 → x1).
- **Overlay hotkey**: F10 cycles through overlay modes (Normal → Grid → Box → Screen → Reveal → Beam → BeamScreen → No Attr → No Bitmap → Normal...).
- **Follow PC**: Disabled by default (was enabled)
- **Fix**: `color-scheme` set globally (`dark`/`light`) via `<meta>` tag so native `<select>` dropdowns and other form controls match the active theme
- **Fix**: Trace panel showing "undefined" for instruction text (used `instr.text` instead of `instr.mnemonic`)
- **Fix**: Reveal overlay mode now correctly blends screen content over border — main canvas renders border-only (like Screen mode), overlay draws normal screen picture at 50% transparency so border effects are visible underneath
- **Fix**: No Bitmap overlay uses diagonal X crosses instead of graveyard (+) crosses for clearer visual distinction
- **Fix**: Flash-loaded tape blocks no longer produce loading sound — audio suppressed while `tapeFlashLoad` is active (turbo EAR-bit generation still works for real-time playback)
- **Graphics Viewer**: Width increased from 24 to 32 columns (full screen width). Canvas now sizes to actual sprite width instead of fixed maximum, eliminating empty space at smaller widths.

## v0.9.28
- **Tools & Trace card layout**: Panels use card-based `.tools-group` boxes with `--bg-tertiary` background and `--border-primary` border. Side-by-side in landscape via `.tools-panel-row` flex wrapper, stacking in portrait.
- **CSS**: Added `--border-primary` variable (`#3a3a5a` dark / `#b8b8c8` light`)
- **Fix**: Panel tabs (`Breakpoints/Labels/Watches/Tools/Trace`) no longer exceed debug row width in landscape (`max-width: 1008px` in landscape media query)
- **Port I/O source tagging**: Port log entries include `src` field identifying the source when PC is in ROM area: `TRDOS` (TR-DOS ROM active), `ROM:N` (ROM bank N), `RAM` (RAM mapped at 0x0000), or empty (PC in RAM). Exported in `Src` column.

## v0.9.27
- **Port Trace Filter**: Whitelist filter for trace logging and Port I/O log
  - When empty, all ports are traced (default behavior); when ports are specified, only matching ports are recorded
  - Applies to both runtime trace port ops and standalone Port I/O log
  - Mask-based matching using same `parsePortSpec` format as breakpoints: `FE`, `7FFD`, `FE&FF`
  - UI: Port filter row in Trace panel with add/remove/clear controls and filter list
  - Filter state (`portTraceFilters`) persisted in project save/load
- **Fix**: Port I/O Export button no longer opens save dialog twice
- **Multi-Drive Support**: BetaDisk 4 drives (A-D) + FDC 2 drives (A-B) + simultaneous tape
  - **BetaDisk per-drive state** (`loaders.js`): `drives[]` array with per-drive `diskData`, `diskType`, and `headTrack`
    - WD1793 track register remains shared (real hardware behavior); physical head position tracked per drive
    - `loadDisk(data, type, driveIndex)` — load into specific drive
    - `ejectDisk(driveIndex)` / `hasDisk(driveIndex)` / `hasAnyDisk()` — per-drive management
    - `createBlankDisk(label, driveIndex)` — blank formatted disk in specific drive
  - **FDC per-drive updates** (`fdc.js`): `ejectDisk(driveIndex)`, drive number in activity callback
  - **Tape + Disk coexistence** (`spectrum.js`): Loading tape no longer ejects disk and vice versa
    - Separate state: `loadedTape`, `loadedBetaDisks[4]`, `loadedFDCDisks[2]`
    - Separate file listings per controller: `loadedBetaDiskFiles[4]`, `loadedFDCDiskFiles[2]`
    - `clearTape()` / `clearDisk(driveIndex, type)` for selective clearing
  - **Drive selector UI** (`index.html`): Dropdown to choose target drive (A-D) when loading disk images
  - **Per-drive catalog tabs**: Dynamic drive sub-tabs in Settings → Media disk catalog
    - Simple labels (`A:`, `B:`, etc.) when one controller is active
    - Prefixed labels (`3DOS:A`, `3DOS:B`, `TRD:A`, `TRD:B`) when both FDC and Beta Disk have disks simultaneously
    - Each tab shows only its controller's catalog content
  - **Disk activity indicator**: Drive letter prefix (e.g., `A:T00:S01:A`), tooltip lists all loaded drives
  - **Auto-load gating**: Only triggers when loading into drive A (index 0)
  - **Project save/load v2**: `mediaVersion: 2` format stores tape + per-drive Beta Disk + per-drive FDC disk
    - Backward compatible with old single-media project format

## v0.9.26
- **Scorpion ZS 256 Support**: New machine type — Soviet clone with 256KB RAM
  - New "scorpion" option in machine selector dropdown (group: Scorpion)
  - 256KB RAM (16 × 16KB pages), 4 ROM banks in `scorpion.rom` (64KB)
  - ROM layout: ROM0=128 BASIC, ROM1=48 BASIC, ROM2=Service Monitor, ROM3=TR-DOS
  - Pentagon-compatible ULA timing (224 T/line × 320 lines = 71680 T/frame, no contention)
  - AY clock: 1.75 MHz (Pentagon standard)
  - Port 0x7FFD: standard 128K paging (RAM pages 0-7, ROM 0/1, screen bank, paging lock)
  - Port 0x1FFD (exact match): bit 0 = RAM page 0 over ROM, bit 1 = Service Monitor ROM select, bit 4 = RAM page high bit (+8)
  - 3-way ROM selection (per FUSE): 1FFD bit 1 set → ROM 2 (Service Monitor); unset → 7FFD bit 4 selects ROM 0/1
  - Built-in TR-DOS: ROM bank 3 loaded into Beta Disk ROMCS (`trdosInRom: true`) — no separate `trdos.rom` required
  - Beta Disk interface enabled by default (same as Pentagon)
  - SZX machine ID: 8, Z80 hardware mode: 9 (same as Pentagon)
  - SZX snapshots save/load all 16 RAM pages + port 0x1FFD state
  - SNA load preserves Scorpion machine type when already selected
  - Auto-loads from `roms/scorpion.rom` on startup
  - ROM dialog with scorpion.rom button and status indicator
- **Test runner: Scorpion and Pentagon 1024 support**: Both machines now available as test targets
  - Added `scorpion` and `pentagon1024` to test runner `switchMachine()` mapping
  - Previously fell through to 48K default silently
- **Fix SZX snapshot Pentagon 1024**: Save/load now preserves full paging state
  - Port 0x7FFD reconstruction includes extended bits 6-7 (RAM bank bits 3-4) and bit 5 (1MB mode)
  - Port 0xEFF7 saved in SPCR byte 3 and restored on load
  - RAM page count no longer capped at 16 — all 64 pages saved/loaded correctly
- **Fix SZX snapshot +3 paging**: Port 0x1FFD now restored for +3 (not just +2A)
  - Changed `machineType === '+2a'` check to `pagingModel === '+2a'` which covers both +2A and +3
- **Fix SNA load Pentagon 1024**: Machine type preserved when loading 128K SNA snapshots
  - Previously dropped to generic 128K; now stays on Pentagon 1024 (same as Pentagon and Scorpion)
- **Fix getFullState() Pentagon 1024**: State dump now includes portEFF7, pentagon1024Mode, and ramInRomMode
- **Extract shared constants** (`constants.js`): Magic numbers replaced with named constants
  - Port addresses: `PORT_7FFD`, `PORT_1FFD`, `PORT_EFF7`, `PORT_ULAPLUS_*`, `PORT_WD_*`
  - Port decode masks: `DECODE_128K_MASK`, `DECODE_PLUS2A_MASK`, `DECODE_AY_MASK`, etc.
  - Paging bit masks: `P7FFD_RAM_MASK`, `P7FFD_SCREEN_BIT`, `P7FFD_ROM_BIT`, `P7FFD_LOCK_BIT`
  - SNA format sizes: `SNA_48K_SIZE`, `SNA_128K_SIZE`, `SNA_128K_MIN`, `PAGE_SIZE`
  - Screen memory: `SCREEN_ATTR`, `SCREEN_END`, `BANK_MASK`

## v0.9.25
- **Explorer: DSK file support**: Tools → Explorer now parses and displays DSK disk images
  - Shows disk geometry (format, tracks, sides, sectors, block size, reserved tracks)
  - +3DOS boot sector parsing: reads disk specification with checksum validation
  - CP/M directory listing with precise file sizes from +3DOS headers
  - File types (BASIC/CODE) with load addresses and autostart line numbers
  - Full filenames with extensions (e.g. `SCREEN.BIN`, `GAME.CODE`)
  - BASIC program decoding: click a BASIC file to see decoded listing
  - Boot sector disassembly: Disasm tab shows boot loader code at $FE10
  - Boot sector hex dump: Hex tab shows full boot sector from $FE00
  - File content access: click a file for hex dump or disassembly
  - Screen preview for files matching known screen sizes (6912, 6144, etc.)
  - DSK files accessible inside ZIP archives (auto-drill and click)
- **Fix**: DSK Explorer crash on non-standard disk formats ("source array is too long")
  - Disks with large sectors (e.g. 4096 bytes) caused fractional `sectorsPerBlock`, leading to undersized buffer in `_readDirectory` and overflow in `TypedArray.set()`
  - `_readDirectory` rewritten to use byte-count loop, handles any sector size
  - `listFiles`/`readFileData` now use boot track geometry consistently for block-to-sector mapping
- **Fix**: DSK loading crash on non-CP/M disks (e.g. copy-protected games like Hostages)
  - `listFiles()` wrapped in try/catch in both `loadDSKImage()` and Explorer
  - Non-filesystem disks load and auto-boot correctly; Explorer shows geometry without file list

## v0.9.24
- **FDC Read Track command (0x02)**: Implement Read Track for copy-protected games (e.g. Batman)
  - Reads all sectors on current track in physical order, ignoring sector IDs
  - Previously unrecognized command caused FDC desync — game sent 9-byte command but FDC returned invalid result after byte 1, leaving subsequent bytes misinterpreted
- **FDC Scan commands (0x11/0x19/0x1D)**: Accept all 9 command bytes (stub returning scan-not-satisfied)
  - Prevents same desync issue as Read Track for any game using Scan Equal/Low/High
- **Fix FDC drive select masking**: Only bit 0 decoded on +3 hardware (drives 0/2 map to same physical drive)
  - Batman's bootstrap uses drive=2 in FDC commands; previously treated as non-existent drive
- **Fix FDC Read/Write Data physical track lookup**: Use drive head position, not logical cylinder from command
  - Copy-protected disks have non-matching physical/logical track numbers (e.g. physical track 38, C=0x12 in sector headers)
  - Previously read data from wrong physical tracks, causing garbage on screen
- **Fix FDC Read Data R > EOT handling**: Always read at least sector R regardless of EOT value
  - On real µPD765, sector R is always read; EOT only controls when to stop reading additional sectors
  - Games with non-standard sector layouts (R=0x0B, EOT=0x09) hung waiting for data that was never provided
- **Fix FDC CRC-error noise destroying game data**: Only randomize CRC-error sectors where stored data fully covers the declared size
  - Oversized sectors (e.g. N=6, 8192 declared, 6144 actual) have CRC errors because declared size exceeds stored data — their content is valid game data, not noise
  - Previously ALL CRC-error sectors had bytes 256+ randomized, destroying valid data (e.g. Robocop 2)
  - Now: `sec.data.length >= sectorDataSize` → randomize (genuine CRC corruption, e.g. Target Renegade protection); `sec.data.length < sectorDataSize` → pass through as-is
- **Fix +3 DSK auto-load**: Use Amstrad menu Enter key injection (like +2/+2A tape) instead of raw PC=0 boot — ROM's "Loader" option now properly detects disk and boots the game

## v0.9.23
- **ZX Spectrum +3 Support**: First-class machine type with built-in floppy disk controller
  - New "+3" option in machine selector dropdown
  - +3 ROM section in ROM dialog (`plus3.rom`, 64KB — 4 ROM banks)
  - Auto-loads from `roms/plus3.rom` on startup
  - Same memory banking as +2A (`pagingModel: '+2a'`, port 0x1FFD special paging)
  - Z80 snapshot hwMode 7 maps to +3; SZX machineId 5 maps to +3
  - `is128kCompat()` helper updated to include +3
- **µPD765 FDC Emulation** (`fdc.js`): Floppy disk controller for ZX Spectrum +3
  - Full state machine: idle → command → execution → result phases
  - 11 commands: Specify, Sense Drive Status, Read/Write Data, Recalibrate, Sense Interrupt Status, Read ID, Write/Read Deleted Data, Format Track, Seek
  - MSR (Main Status Register) with RQM, DIO, NDMA, CB bits
  - Port 0x2FFD (MSR read), 0x3FFD (data read/write), motor via 0x1FFD bit 3
  - 4 drives supported, instant-completion model (same approach as BetaDisk WD1793)
  - Disk activity indicator shows FDC operations
- **DSK Disk Format Support**: Standard and extended CPC DSK format
  - `DSKLoader.parse()` handles both "MV - CPC" standard and "EXTENDED CPC DSK" formats
  - `DSKImage` class for in-memory disk with read/write sector operations
  - CP/M-style directory listing in Settings → Media → Disk tab
  - `.dsk` files recognized in file picker, ZIP browser, and drag-and-drop
- **Auto Load for +3 DSK**: Boots +3 from disk automatically when Auto Load is enabled
  - `bootPlus3Disk()` resets machine, preserves disk, sets motor on, boots from ROM
  - Amstrad menu handling: +3 added to Amstrad menu detection
- **Fix**: Beta Disk auto-paging on +2A used hardcoded ROM bank 1
  - `updateBetaDiskPaging()` and `bootTrdos()` now use `profile.basicRomBank` (bank 3 for +2A)
- **Fix**: FDC port reads (0x2FFD, 0x3FFD) were overwritten by floating bus handler
  - FDC reads were outside the port dispatch if/else chain; floating bus `else` clause overwrote results with garbage
  - Moved FDC reads into the if/else chain to prevent fallthrough
- **Fix**: FDC Read/Write Data correctly buffers sectors from R to EOT
  - +3 ROM sets EOT=R for single-sector reads (buffers 1 sector), custom game loaders set EOT > R for multi-sector reads
  - Previously single-sector-only buffering broke custom loaders that expect multi-sector transfers (e.g. Venom Strikes Back, Target Renegade)
- **Fix**: FDC data commands returned normal termination (ST0=0x00) instead of abnormal
  - +3 ROM expects ST0 bits 7:6 = 01 (abnormal) and ST1 bit 7 = EN (end of track) because TC is never asserted
  - Without these flags, +3DOS treated successful reads as errors
- **Fix**: FDC MSR missing drive busy bits and EXM flag
  - Added drive busy bits (MSR bits 0-3), set by Seek/Recalibrate, cleared by Sense Interrupt Status
  - EXM bit (bit 5) correctly set during execution phase for non-DMA mode
- **Fix**: FDC Sense Drive Status returned wrong flags for missing drives
  - No disk now returns WP=1 (write protected) + RDY=0 (not ready), matching +3 ROM's drive detection logic
- **Fix**: FDC CM (Control Mark) flag in ST2 was inverted for Read Deleted Data
  - CM should be set when actual data mark type doesn't match command expectation
  - Read Data + deleted mark → CM=1; Read Deleted Data + normal mark → CM=1
- **Fix**: Extended DSK parser returned empty sector data when `actualLen=0`
  - In extended CPC DSK format, `actualLen=0` means use default size from N (size code), not 0 bytes
  - Affected games using non-standard formats (e.g. Target Renegade: 1024-byte sectors, deleted data marks)
- **Fix**: FDC Read Data/Read Deleted Data discarded DSK sector error flags (ST1/ST2)
  - DSK files store per-sector ST1/ST2 for copy protection (CRC errors, missing marks, etc.)
  - FDC now passes through DSK error flags (DE, DD, MA, MD) merged with computed flags (EN, CM)
  - Fixes copy-protected games that check for specific error signatures (e.g. Target Renegade reads sector 2 expecting ST1=0x20 DE + ST2=0x20 DD)
- **Fix**: EDSK weak/random sector support for copy protection (Speedlock +3)
  - Sectors with `actualSize > nominalSize` (exact multiple) contain multiple data copies
  - At parse time, copies are compared byte-by-byte to build a weak byte map
  - On each FDC read, weak byte positions are randomized (FUSE approach)
  - Fixes Speedlock-protected games that read a sector multiple times and expect different data (e.g. Target Renegade)
- **Fix**: FDC SK (Skip Deleted) flag parsed but never used in Read Data/Read Deleted Data
  - SK=1 now skips sectors whose mark type doesn't match the command
  - SK=0 reads mismatched sectors but sets CM flag and terminates after the sector
  - Per-sector DDAM check via DSK ST2 bit 6 (Deleted Data Address Mark indicator)
- **Fix**: FDC EN (End of Track) flag unconditionally set in ST1
  - EN should only be set when all R→EOT sectors were read without early termination
  - Not set when terminated by CM (mark mismatch) or CRC error (DE flag)
- **Fix**: +2A/+3 memory contention used wrong delay pattern
  - 48K/128K/+2 use pattern (6,5,4,3,2,1,0,0); +2A/+3 use (7,6,5,4,3,2,1,0)
  - Added profile-driven `contentionPattern` property (`'65432100'` vs `'76543210'`)
  - Precomputed contention delay lookup table replaces Swan formula
  - Reference: FUSE `contend_delay_76543210` for +3, sinclair.wiki.zxnet.co.uk contention tables
- **Fix**: +2A/+3 incorrectly applied IO contention
  - The Amstrad 40077 gate array only contends on MREQ, not during IO operations
  - Added `hasIOContention` profile flag; `applyIOTimings` returns 0 when false
  - Reference: sinclair.wiki.zxnet.co.uk/wiki/Contended_I/O ("no contention occurs" on +3)
- **Fix**: +2A/+3 incorrectly applied internal cycle contention
  - Non-MREQ cycles (DJNZ, JR internal waits) should not be contended on +2A/+3
  - Added `hasInternalContention` profile flag; `contendInternal` skips delays when false
  - Reference: FUSE `contend_delay_no_mreq = spectrum_contend_delay_none` for +3

## v0.9.22
- **Machine Profile System**: Configurable machine definitions replacing hardcoded type checks
- **Pentagon 1024 Support**: Extended memory banking (64 RAM pages) via port 0xEFF7

## v0.9.21
- **ZX Spectrum +2A Support**: First-class machine type (without floppy)
  - New "+2A" option in machine selector dropdown
  - +2A ROM section in ROM dialog (`plus2a.rom`, 64KB — 4 ROM banks)
  - Auto-loads from `roms/plus2a.rom` on startup
  - Port 0x1FFD handling: special all-RAM paging modes (4 configurations)
  - ROM bank selection via combined 0x7FFD bit 4 and 0x1FFD bit 2
  - +2A contention: banks 4,5,6,7 (differs from 128K/+2 which uses 1,3,5,7)
  - Same ULA timing as 128K (228 T/line, 311 lines, 70908 T/frame)
  - Z80 snapshot hwMode 13 maps to +2A; SZX machineId 4 maps to +2A
  - SZX snapshot preserves port 0x1FFD value in SPCR chunk
  - +3/+3e SZX snapshots treated as +2A (hardware-identical minus floppy)
  - Tape trap uses ROM bank 3 for 48K BASIC (not bank 1 like 128K)
  - `is128kCompat()` helper updated to include +2A
- **Auto Load for Amstrad menu** (+2/+2A): Press Enter to select "Tape Loader" (default menu item) which runs LOAD "" automatically — no key typing needed
- **SCL boot injection**: Boot file injection (Settings → Media → Boot File) now works for SCL files
  - SCL converted to TRD format before boot injection via `betaDisk.sclToTrd()`
  - Ensures "Add boot" / "Replace boot" modes apply to both TRD and SCL disk images
- **Test runner +2A support**: Test suite correctly loads TAP files on +2A machines
  - Mirrors main auto-load approach: waits for Amstrad menu, presses Enter for Tape Loader
  - Machine alias `plus2a` mapped to `+2a` in test runner's `switchMachine()`
- **Test runner TRD/SCL disk support**: Tests can now boot from disk images
  - New `diskRun` field in tests.json: program name to run (e.g. `"game"`) or `"boot"` for boot file
  - Boots TR-DOS via `bootTrdos()`, waits for prompt, types `RUN "filename"` and Enter
  - Works with TRD and SCL files (SCL converted to TRD automatically)

## v0.9.20
- **ZX Spectrum +2 Support**: First-class machine type with dedicated ROM
  - New "+2" option in machine selector dropdown
  - +2 ROM section in ROM dialog (`plus2.rom`, 32KB)
  - Auto-loads from `roms/plus2.rom` on startup
  - ROM dialog reopens with Close button when switching to a machine with missing ROM
  - Identical hardware to 128K (same ULA timing, contention, AY, memory banking) — only ROM differs
  - `is128kCompat()` helper function for 128K-compatible hardware checks
  - Z80 snapshot hwMode 12 maps to +2; SZX machineId 3 maps to +2
  - Z80/SZX export writes correct machine identifiers for +2
  - SNA load preserves +2 machine type when already selected
  - Tape trap ROM bank check includes +2

## v0.9.19
- **Auto Load**: Automatic load-and-run for tape and disk files
  - New "Auto Load" checkbox in Settings → Media (enabled by default)
  - TAP/TZX: Resets machine, types `LOAD ""` (128K: selects BASIC from menu first)
  - TRD/SCL: Boots into TR-DOS automatically
  - Pure turbo TZX (no standard blocks): Switches to real-time mode automatically
  - setTimeout-based key injection using `ula.keyDown()`/`ula.keyUp()`
  - Cancels cleanly on machine change, reset, or new file load
  - Setting saved/restored in project files
- **TZX Turbo Block Handoff**: Flash load to real-time turbo transition
  - Dual tape system: `tapeLoader` (standard blocks only) + `tapePlayer` (all blocks)
  - `standardBlockMap` maps flash-loaded block indices to full tape positions
  - After flash-loading standard blocks, turbo blocks auto-start via `_turboBlockPending` flag
  - Auto-start triggers in `portRead()` when custom loader reads port 0xFE
  - Critical `PC >= 0x4000` guard prevents false trigger from ROM keyboard scan
- **Tape Block Catalog**: Block listing in Settings → Media
  - Shows all TZX/TAP blocks with type labels (Standard, Turbo, Pure Tone, etc.)
  - Displays block sizes and current playback position
- **Fix**: Disk auto-load (TRD/SCL) crashed on Pentagon instead of booting TR-DOS
  - `bootTrdos()` was manually constructing system variables and jumping to wrong entry point (0x3D13)
  - Rewritten to use FUSE-style approach: reset machine, select ROM bank 1, page in TR-DOS ROM, boot from address 0
  - TR-DOS ROM runs its own initialization from address 0, properly setting up all system variables and workspace
- **Fix**: Beta Disk auto-paging only worked on Pentagon, not on 48K/128K with Beta Disk enabled
  - Main loop gated `updateBetaDiskPaging()` by `isPentagon` instead of `_betaDiskPagingEnabled`
- **Fix**: Loading TRD/SCL on machine without Beta Disk no longer forces switch to Pentagon
  - Now shows warning message instead of automatically changing machine type

## v0.9.18
- **Fix**: Screen flicker in double-buffered games (e.g., Cubix) on 128K/Pentagon
  - Deferred paper rendering was incorrectly triggered by simple double-buffering (1 bank swap per frame)
  - Deferred mode reads screen RAM at end-of-frame, which shows the cleared back buffer instead of the completed display
  - Now only defers for scroll17-style effects (many rapid bank alternations per frame)
  - Normal scanline rendering correctly handles double-buffering by reading the active bank at each line's execution time
- **Fix**: SZX snapshots inside ZIP archives were not recognized
  - `findAllSpectrum()` in ZIP loader was missing `.szx` from the supported extension list
- **Fix**: SZX save wrote wrong machine ID for Pentagon (saved as 128K instead of Pentagon)
  - Caused machine type mismatch on load, leading to ULA dimension errors (IndexSizeError)
  - Pentagon machine ID is now correctly written as 7 in SZX header

## v0.9.17
- **Fix**: Debugger "Go to address" navigation error (navHistory not defined)
- **Fix**: Beam mode rendering improvements for multicolor programs after snapshot load
- **Fix**: Beam mode now preserves last complete frame as background (not overwritten when stepping)
- **Fix**: "No Bitmap" overlay mode now respects multicolor (per-scanline attributes)
- **Improve**: Beam mode previous frame is darker (50%) for better contrast with current colored region

## v0.9.16

## v0.9.15
- **Test Suite Enhancements**: Extended automated test capabilities
  - Added RZX file support for input recording playback tests
  - Added SZX snapshot format support
  - New multicolor rendering tests (Shock megademo, Nirvana+ effects)
  - New RZX playback tests to verify recording compatibility
  - **Test categories**: Filter tests by type (All/CPU/Video/ULA+/Multicolor/RZX)
  - Category tabs with test counts above test list
  - Select-all checkbox now only affects visible (filtered) tests
  - Fixed ROM corruption when tests load snapshots that change machine type
  - Fixed RZX playback in test runner (frame counter wasn't advancing in headless mode)
  - Fixed ULA+ palette bleeding between tests (now reset before each test)
- **RZX Playback Fix**: Fixed RZX playback failing when loaded from different machine type
  - Loading 48K RZX while in Pentagon or 128K mode now works correctly
  - ROM is now properly reloaded when machine type changes during snapshot loading
  - Previously, wrong ROM was used causing execution to diverge (e.g., RET returning to wrong address)
- **RZX UI Fix**: RZX controls now properly clear when loading other files
  - Stop button and progress indicator no longer remain visible after loading snapshot/tape
- **Loading Fix**: Fixed black screen when loading snapshot while RZX is playing
  - Emulation now properly restarts after ROM reload on machine type change
- **Code Cleanup**: Removed excessive debug logging
  - Removed Z80 Loader debug messages
  - Removed RZX initial state dump

## v0.9.14
- **Info Tab Reorganization**: Restructured Info tab with sub-tabs for better organization
  - I/O sub-tab: Keyboard layout, ports (keyboard, Kempston, ULAplus, AY-3-8910), colors
  - Timings sub-tab: Frame timing, border sizes, memory map, RAM banks, contention patterns, Pentagon differences
  - Opcodes sub-tab: Z80 instruction set reference (moved from main tabs)
- **Tools Tab**: New consolidated Tools tab with sub-tabs
  - Explorer sub-tab: File structure viewer (TAP, TZX, SNA, Z80, etc.)
  - Compare sub-tab: Snapshot and binary comparison tool
  - Tests sub-tab: Emulator regression tests (moved from main tabs)
  - Export sub-tab: Screenshot, frame export, PSG capture, RZX recording, ASM export options
- **Settings Tab Reorganization**: Split Settings tab into sub-tabs
  - Display sub-tab: Border size, palette, zoom, overlay, fullscreen mode, late timings, ULA+
  - Input sub-tab: Kempston joystick/mouse, gamepad, Beta Disk
  - Media sub-tab: Flash load, tape controls, blank disk, boot file
  - Audio sub-tab: Sound, AY in 48K, volume, stereo mode
- **ULAplus Support**: Extended palette mode for 64 colors
  - Ports $BF3B (register select) and $FF3B (data)
  - 64-color palette using GRB 332 format (4 CLUTs × 16 colors)
  - Real-time palette preview in Settings → Display
  - Enable/disable via checkbox, persisted to localStorage
  - **HAM256 raster effects**: Full support for mid-frame palette changes
    - Tracks palette writes with T-state timing
    - Group-based palette lookup (12 groups × 64 entries per frame)
    - Works on 48K, 128K, and Pentagon machines
  - ULAplus state properly managed on machine switch (checkbox preserved, palette reset)
- **SCR Export with ULAplus**: Export screen with extended palette
  - Standard SCR: 6912 bytes (bitmap + attributes)
  - ULAplus SCR: 6976 bytes (+ 64-byte palette appended)
  - Auto-detects if game has modified ULAplus palette
  - Compatible with ZX-Paintbrush and other editors
- **Export Improvements**:
  - Added PNG format to export format selector
  - Export button uses selected format (PNG, SCR, BSC, etc.)
  - SCR export reads raw screen memory for accurate ULAplus data
- **Game Browser Improvements**:
  - Fixed pagination (client-side, fetches up to 100 results)
  - Added placeholder with diagonal lines for games without screenshots
  - Scroll to top when changing pages

## v0.9.13
- **Game Browser**: Added online game search powered by Spectrum Computing (ZXDB)
  - Access via Load → Web in toolbar
  - Search games by title with screenshots and details
  - Uses ZXInfo API (api.zxinfo.dk) - the largest ZX Spectrum database
  - Direct download links for TAP, TZX, Z80, SNA files
  - Results sorted alphabetically by title
  - Zero dependencies - works directly from browser
- **Quicksave/Quickload**: Save and restore game state instantly
  - F2 = Quicksave (saves to browser localStorage)
  - F5 = Quickload (restores saved state)
  - Also accessible via Save/Load dropdowns
  - Uses SZX format for full state preservation
- **UI Improvements**: Consolidated toolbar for cleaner interface
  - Load dropdown: File, Web, Project, Quick (F5)
  - Save dropdown: SNA, Z80, SZX, Project, Quick (F2)
  - Help and theme buttons moved next to Save dropdown
  - App name/version moved to Help button tooltip
  - Reduced toolbar width, no more overlapping with tabs
- **Info Tab**: Added input port reference
  - Keyboard port (#FE) with all half-row addresses and key bits
  - Kempston joystick port (#1F) with direction/fire bits
  - Kempston mouse ports (#FBDF, #FFDF, #FADF)
  - Input state summary: keyboard active-low (0=pressed), joystick active-high (1=pressed)
- **RZX Recording**: Fixed RZX export to work with other emulators (Spectaculator, EmuZWin)
  - Recording now starts after interrupt fires, not at frame boundary
  - Uses SZX snapshot format (preserves CPU halted state)
  - Keyboard scan inputs now correctly captured in frame 0
  - Most recordings work; some games with unusual timing (e.g., Batty) may still fail
- **RZX Loading Fix**: Show snapshot screen when RZX is loaded in paused state
  - Canvas was cleared by updateCanvasSize() after snapshot rendering
  - Border color from snapshot now correctly displayed
- **RZX Explorer Fix**: Fixed Z80 screen preview showing random blocks
  - Z80 format always stores screen in page 8 (both 48K and 128K)
  - Was incorrectly looking for page 5 in 128K mode
- **UI Fix**: Can now start new RZX recording after exporting
  - Recording button was disabled after export due to stale playback state
- **Code Cleanup**: Removed excessive RZX debug logging

## v0.9.12
- **RZX Playback Improvements**: Improved RZX replay compatibility
  - Fixed Z80 loader not recognizing +3, +2, +2A machine types (hwMode 7, 12, 13)
  - Fixed Z80 loader not recognizing Pentagon (hwMode 9) in V2 format snapshots
  - Fixed ROM not loaded when switching from 48K to 128K/Pentagon (ROM bank 1 was empty)
  - Some recordings still have issues due to emulator-specific behavior differences
- **Disassembler Fixes**: Fixed several bugs in disassembler and trace-to-file export
- **Export Enhancement**: Added option to collapse multiple lines of block operations (LDIR, LDDR, etc.)
  - Reduces output size for repeated block instruction sequences
- **Multicolor Fix**: Fixed Shock megademo multicolor rendering bug
  - Issue was caused by previous screen bank switching optimization
- **Snapshot Loading Fix**: Fixed frozen display/no sound when loading SZX/Z80/SNA snapshots
  - Root cause: paging lock from previous program blocked port 7FFD writes
  - All loaders now reset `pagingDisabled` before restoring paging state
  - Also reset frame timing and ULA deferred rendering state
- **UI Improvements**:
  - Removed redundant "Running/Stopped" status label (button text shows state)
  - Fixed RZX status layout shifts when frame counter digits change
  - Removed RZX debug overlay (keypress display in bottom-right corner)
- **Code Cleanup**: Removed excessive console logging throughout codebase
  - Debug logs now controlled by flags (debugContention, debugInterrupts, etc.)

## v0.9.11
- **Fullscreen Mode**: Added fullscreen support for the emulator canvas
  - Fullscreen button (⛶) in the control bar, or press F11
  - ESC key exits fullscreen
  - Three display modes:
    - Crisp: Integer scaling for perfectly sharp pixels (default)
    - Fit: Maximum scale with aspect ratio preserved
    - Stretch: Fill entire screen
  - Setting saved to localStorage
- **Disassembler Fix**: Fixed incorrect mnemonic for indexed load instructions
  - `LD L,(IX+d)` was incorrectly shown as `LD IXL,(IX+d)`
  - `LD H,(IX+d)` was incorrectly shown as `LD IXH,(IX+d)`
  - Same fix applied for IY variants
  - IXH/IXL substitution now only applies when not using indexed memory addressing
  - Displacement now shown in hex (e.g. `IX+31h` instead of `IX+49` for 0x31)
- **Trace Recording Fix**: Fixed incorrect disassembly for self-modifying code
  - Instructions that write to their own address (e.g. `LD (94AEh),IX` at 94AF) were traced incorrectly
  - Now captures instruction bytes BEFORE execution, not after memory modification
- **RZX Playback Fix**: Fixed DDCB/FDCB M1 cycle counting
  - DDCB/FDCB instructions now correctly count as 2 M1 cycles, not 3
  - R register now increments correctly (2 times per instruction)
  - Fixes potential RZX playback desync for recordings using indexed bit operations
- **RZX Playback Fix**: Fixed screen rendering artifacts during RZX playback
  - T-states now reset at frame start during RZX playback
  - Fixes "line by line" progressive rendering artifact where parts of screen weren't rendered
  - RZX frames end by instruction count, not T-states, causing scanline calculation drift

## v0.9.10
- **Performance Optimization**: Fixed severe slowdown with screen bank switching effects
  - Demos using 128K screen bank switching (Echologia, etc.) now run at full speed
  - Optimized `renderDeferredPaper()` from per-pixel to per-column rendering (~100x faster)
  - Pre-cached RAM bank lookups to avoid repeated function calls

## v0.9.9
- **Hobeta Boot Support**: Boot file injection now accepts Hobeta files
  - Supports Hobeta files (typically .$b or .$c)
  - Boot source can be TRD disk or standalone Hobeta file
  - UI shows file type label: "(TRD)" or "(Hobeta)"

## v0.9.8
- **Boot TRD Injection**: Automatically add boot loader to TRD disk images
  - Settings → Media → Boot File: select a TRD or Hobeta file containing a boot loader
  - Three modes: No change, Add boot (if missing), Replace boot
  - Boot file is injected when loading TRD images based on selected mode
  - Smart replace: reuses old boot's disk location when new boot fits
  - Error popups when disk is full or boot cannot be added
- **TR-DOS Boot Loaders Fix**: Fixed boot loaders showing empty disk
  - TR-DOS ROM flag was not being updated after ROM load
  - Boot loaders now properly read disk catalog via TR-DOS ROM
- **Extended Mode Characters**: Fixed typing of `[ ] { } ~ | \` characters
  - These characters require Extended Mode on Spectrum (Caps+Symbol, then Symbol+letter)
  - Emulator now automatically simulates the two-step key sequence
  - Works in both 48K and 128K BASIC modes

## v0.9.7
- **Keyboard Remapping**: Changed modifier key assignments
  - Ctrl → Caps Shift (was Shift)
  - Alt → Symbol Shift (was Ctrl)
  - PC Shift now free for regular shifted characters (!@#$%^&*etc)
- **Non-English Keyboard Fix**: Keyboard now works with any layout (Russian, German, etc.)
  - Uses `e.code` (physical key position) instead of deprecated `e.keyCode`
  - Keys mapped by QWERTY physical layout, independent of active language
- **SCA Type 1 Export**: Added payload type 1 support for multicolor animations
  - Type 0: Full 6912-byte SCR frames (unchanged)
  - Type 1: 8-byte fill pattern + 768-byte attributes per frame (smaller files)
  - Fill pattern options: 53c (AA 55), 127c (DD 77), Vertical 4x8, Horizontal 8x4, Custom
  - Automatic pattern detection from captured screen bitmap
  - User prompt when pattern cannot be auto-detected

## v0.9.6
- **SCA Export Fix**: Fixed SCA animation export version field (was 0, now 1)
  - Exported .sca files now compatible with other viewers

## v0.9.5
- **Code Folding**: Collapse/expand subroutines and custom blocks in disassembly
  - Click fold toggle (▾/▸) on subroutine headers to collapse/expand
  - Collapsed view shows summary: "(N bytes, M instructions)"
  - User-defined fold blocks via right-click → "Create fold block..."
  - Fold markers for user blocks displayed in magenta
  - "Collapse all folds" / "Expand all folds" in context menu
  - Auto-expand when PC enters a collapsed region
  - Fold state saved in projects and localStorage
  - Works in both main and right panel disassembly views

## v0.9.4
- **TZX Tape Loading**: Full TZX file format support with variable speed blocks
  - Standard speed data blocks (0x10) - same as TAP
  - Turbo speed data blocks (0x11) - custom pilot/sync/data timing
  - Pure tone blocks (0x12) - single frequency pulses
  - Pulse sequence blocks (0x13) - arbitrary pulse arrays
  - Pure data blocks (0x14) - data without pilot/sync
  - Pause/Stop blocks (0x20) - silence between blocks
  - Loop blocks (0x24/0x25) - multi-load support
  - TZX files work in both flash load and real-time modes
  - Unified block format for TAP/TZX playback
- **TZXLoader Class**: New parser for TZX format in loaders.js
  - Magic byte detection ("ZXTape!" + 0x1A)
  - Converts TZX blocks to unified format for TapePlayer
  - ZIP archive support for TZX files

## v0.9.3
- **Real-Time Tape Loading**: Optional cycle-accurate tape playback with border stripes and sound
  - New "Flash Load" checkbox toggles between instant (ROM trap) and real-time modes
  - Real-time mode shows authentic border loading stripes during tape playback
  - Tape audio emulation with "Tape Sound" checkbox to enable/disable loading sounds
  - Play/Stop/Rewind controls for manual tape control in real-time mode
  - Tape position indicator shows current block and progress
  - Standard tape timing: pilot (2168T), sync (667T/735T), zero (855T), one (1710T)
  - Both settings saved/loaded with projects
- **TapePlayer Class**: New tape playback engine with accurate timing
  - State machine: pilot → sync1 → sync2 → data → pause → next block
  - Edge transition recording for audio generation with T-state precision
  - Proper header (8063 pulses) and data block (3223 pulses) pilot lengths

## v0.9.2
- **PSG Export**: Record AY chip output to PSG file format
  - Start/Stop recording in Settings → AY Capture section
  - "Changed only" option exports only modified registers (smaller files)
  - "Get Player" downloads ready-to-assemble Z80 player source
  - Real-time frame/write counter during recording
- **Sound Fix for 128K**: Fixed AY sound not working after machine type switch
  - `ayEnabled` flag now correctly updates in `setMachineType()`
- **Audio Context Improvements**: Better browser autoplay policy handling
  - Audio init triggers on both click and keydown events
  - Persistent resume handlers for stricter browsers
- **Default Settings Changes**:
  - Default zoom changed to x1 (was x2)
  - Late Timings disabled by default (was enabled)

## v0.9.1
- **48K Border Timing Fix**: Memory-location-aware I/O timing for OUT (n),A
  - Contended memory ($4000-$7FFF): ioOffset=11 (fixes Aquaplane)
  - Non-contended memory ($8000+): ioOffset=8 (fixes Venom)
  - OUT (C),r unchanged at ioOffset=9 (ULA48 continues to pass)
  - All border timing tests now pass: Aquaplane, ULA48, Venom, P128, Comet

## v0.9.0
- **128K Border Timing Fix**: Instruction-specific I/O timing for accurate border effects
  - OUT (C),r (12T): ioOffset=13 for ULA128-style timing tests
  - OUT (n),A (11T): ioOffset=9 for Shock-style multicolor demos
  - Both ULA128 test and Shock megademo now display correctly on 128K
- **128K Multicolor Timing**: Refined attribute timing calculations
  - TOP_LEFT_PIXEL_TSTATE=14364 (documented value) now used consistently
  - Border and paper rendering aligned (BORDER_TIMING_OFFSET=0)
  - mc128kOffset tuning parameter for fine-grained control

## v0.8.9
- **Multicolor Support**: T-state accurate attribute tracking for Nirvana+ and similar engines
  - Attribute writes ($5800-$5AFF) now tracked with precise T-state timing
  - Rendering uses correct attribute value at each column's ULA scan time
  - Shock megademo, Nirvana+ games now display correctly
- **PUSH Contention Timing**: Fixed 1T internal cycle before memory writes
  - PUSH writes now contended at T+5 and T+8, not T+4 and T+7
  - Critical for multicolor engines that use PUSH for rapid attribute updates
- **Interrupt Timing**: Fixed contention for interrupt/NMI handling
  - IM1/IM2: 7T acknowledge cycle before push (no internal cycle)
  - NMI: 5T acknowledge cycle before push
  - Interrupt push correctly skips the 1T internal cycle
- **Beta Disk for 48K/128K**: TR-DOS interface now available on all machine types
  - New "Beta Disk (TR-DOS)" checkbox in Settings → Input section
  - Allows loading TRD/SCL disk images on 48K and 128K machines
  - Requires trdos.rom to be loaded; always enabled for Pentagon

## v0.8.8
- **Filename Display Fix**: Test runner now updates filename in status bar when loading files
  - Previously, running tests would leave stale filename from previous manual load
  - Both `loadTestFile` and `loadExtractedFile` now update the display
- **Border Timing Improvements**: Instruction-specific timing for 48K border effects
  - OUT (C),r (12T) uses ioOffset=9, OUT (n),A (11T) uses ioOffset=8
  - Fixes Comet and similar demos that use OUT (C),r for border effects
  - ULA48, Comet, Venom border tests now pass

## v0.8.7
- **Port 0xFE Emulation Fix**: Fixed IN instruction tests (Raxoft z80test)
  - EAR input (bit 6) now LOW when no tape (Issue 2/3 ULA behavior)
  - Bits 5,7 now consistently HIGH for port 0xFE reads
  - Floating bus still available via other port reads
- **ULA Timing Improvements**: Fixed early/late timing for 48K and 128K
  - Settings preserved when loading files (only projects change settings)
  - 48K: Early timing (14336T) now default and matches ULA48 test
  - 128K: Late timing (14361T) matches ULA128 test

## v0.8.6
- **AudioWorklet Migration**: Replaced deprecated ScriptProcessorNode with modern AudioWorklet API
  - New `audio-processor.js` runs on dedicated audio thread
  - Lower latency, no UI jank during audio processing
  - Supported in all modern browsers (Chrome 66+, Firefox 76+, Safari 14.1+)
- **Code Cleanup**: Removed debug logging from console

## v0.8.5
- **Gamepad Calibration**: Configure any USB/Bluetooth gamepad
  - Click "Calibrate" button next to Gamepad checkbox
  - Assign Up/Down/Left/Right/Fire by moving stick or pressing buttons
  - Extended buttons (C, A, Start) for Sega-style games
  - Mapping saved to localStorage and project files
- **Explorer BASIC**: USR VAL "number" addresses now clickable
  - Supports quoted numbers: `USR VAL "24064"`
  - Supports scientific notation: `USR VAL "2.4064E4"`
  - Also works with PEEK VAL and POKE VAL
- **Performance**: Audio disabled at speeds > 200% to reduce CPU usage
- **Numpad Kempston**: Fixed cross-platform compatibility
  - Uses `e.code` instead of deprecated `e.keyCode`
  - Up/Down now work consistently on all keyboards
- **Console**: Removed verbose SCL/TRD conversion debug messages

## v0.8.4
- **Kempston Mouse**: Full mouse emulation with pointer lock
  - Click screen or 🖱️ button to capture mouse, Escape to release
  - Ports: FADF (buttons), FBDF (X), FFDF (Y)
  - Optional wheel support on bits 7:4 of button port
- **Extended Kempston Joystick**: Sega Genesis/Mega Drive gamepad compatible
  - Bit 5: C button ([ key)
  - Bit 6: A button (] key)
  - Bit 7: Start button (\ key)
- **Hardware Gamepad Support**: USB/Bluetooth controllers via Gamepad API
  - D-pad and analog stick for directions
  - Standard button mapping (A=Fire, B/X=Extended buttons, Start)
  - Auto-detection with status display
- **Per-Panel Navigation**: Left and right disasm panels have independent history
  - ◀/▶ buttons navigate within each panel
  - Clicking CALL/JP targets navigates in the same panel

## v0.8.3
- **Snapshot Saving Formats**: Added Z80 and SZX snapshot saving
  - Save dropdown replaces Save button - select SNA/Z80/SZX format
  - Z80 v3 format (48K, 128K, Pentagon) - uncompressed for maximum compatibility
  - SZX format with zlib compression (48K, 128K, Pentagon)
  - Pentagon snapshots use hardware mode 9 in Z80 format

## v0.8.2
- **Calculator in Right Panel**: Moved calculator from tab to right panel dropdown
  - Available as third option alongside Memory and Disasm
  - Bits panel spans full width below calculator and history
  - History preserved when switching between panel types
  - Numeric system dropdown disabled when formula is present (prevents conversion errors)
- **UI Improvements**:
  - Reduced panel heights for better fit on smaller monitors
  - Fixed dropdown styling in dark mode
  - Compact calculator layout with optimized spacing

## v0.8.1
- **Configurable Debug Panels**: Left and right panels can independently show disasm or memory dump
  - Panel type selector dropdown in each panel header
  - All panel combinations supported: disasm+memory, disasm+disasm, memory+memory, memory+disasm
  - Step controls appear in disasm panels, search controls in memory panels
  - Bookmark emojis indicate panel type (🔍 disasm, 📦 memory)
- **Improved Context Menu Navigation**: Unified navigation across all panels
  - "Address XXXX" header shows target address
  - Explicit "Disasm left/right" and "Memory left/right" options
  - Right-click on memory address column now works
  - Hover underline on memory addresses
- **UI Improvements**:
  - Fixed panel height alignment in portrait and landscape modes
  - Fixed search mode sync between independent memory panels
  - Region coloring in left memory panel matches right panel
  - Consistent lowercase menu item text

## v0.8.0
- **Subroutine Detection**: Mark and display subroutines in disassembly
  - Manual marking via right-click context menu
  - Auto-detection during Auto-Map Apply (CALL instruction targets)
  - IDA-style separator display with subroutine name
  - End marker after RET instruction ("; end of sub_XXXX")
  - Saved in projects and localStorage per file
- **Explorer Tab**: New Explorer tab for analyzing ZX Spectrum files without loading into emulator
  - Supports TAP, SNA, Z80, TRD, SCL, SZX, RZX, and ZIP formats
  - File Info sub-tab: File structure, blocks, registers, disk catalogs
  - BASIC sub-tab: Decode and display BASIC programs with syntax highlighting
  - Disasm sub-tab: Z80 disassembly with ROM routine labels
  - Hex Dump sub-tab: Raw hex view with ASCII column
  - Screen preview for snapshots and graphics files
  - Click on TRD/SCL BASIC files to decode, CODE files to disassemble
  - Click USR addresses in BASIC to jump to disassembly view
  - Blank lines after flow control instructions (JP, JR, CALL, RET, RST, DJNZ, HALT)
  - Copy-friendly text format for disassembly and hex dump
  - TR-DOS BASIC decoder with correct PROG address (0x5D3B)
- **Code Refactoring**: Removed duplicate functions, shared flow-break detection
- **Bug Fixes**:
  - Fixed DJNZ not showing blank line in debugger disassembly
  - Fixed text selection in Explorer outputs

## v0.7.1
- **Compare Tool**: New Compare tab for comparing snapshots and binary files
  - Compare two snapshot files (.SNA or .Z80, 48K or 128K)
  - Compare two raw binary files byte-by-byte
  - Compare snapshot against current emulator state
  - Side-by-side hex dump with ASCII representation
  - Register comparison with main and alternate registers side-by-side
  - Differences highlighted in red with marker
  - Exclude screen memory option ($4000-$5AFF and 128K shadow screen)
  - Pagination for large differences (50 blocks per page)
  - Cross-format comparison (e.g., .SNA vs .Z80)
- **Export ASM**: Enhanced disassembly export from Memory Map
  - Uses memory regions to determine code vs data
  - Code regions disassembled as Z80 instructions
  - DB/DW/Text/Graphics regions exported with appropriate directives
  - Includes labels and CPU state in header
  - Addr+Bytes option for address and hex byte comments
  - Screen memory exported as INCBIN directive

## v0.7.0
- **Automated Test Suite**: New Tests tab for regression testing with native Spectrum programs
  - Define tests in `tests.json` with machine type, timing settings, and screenshot steps
  - Multi-step tests with key press simulation between screens
  - Absolute frame numbering (frame count from test start, not relative to previous step)
  - Screenshot comparison against reference PNG images
  - Preview mode for calibrating frame numbers with Pause/Resume
  - Screenshot button to capture reference images during preview
  - Copy Frame# button to clipboard for easy test configuration
  - Full border mode support for accurate border rendering in tests
  - Step progress shown during test runs (e.g., "Test 1/10: z80ccf (3/8)")
  - Frame number displayed on mismatch detection
  - Author and source URL fields in tests.json for attribution
  - Time elapsed and average FPS shown in test summary
- **Test Key Simulation**: Flexible key press format for test automation
  - Single keys: `ENTER`, `SPACE`, `a`, `1`
  - Simultaneous keys: `SHIFT+a`, `CTRL+p` (Symbol Shift)
  - Key sequences with delays: `ENTER,500ms,SPACE`
  - Special keys: `UP`, `DOWN`, `LEFT`, `RIGHT`
- **Bug Fixes**:
  - Fixed preview state not resetting after errors (preview button would stop working)
  - Fixed duplicate element ID for screenshot buttons
  - Removed excessive debug logging from browser console

## v0.6.5
- **AY-3-8910 Sound**: Full PSG emulation with Web Audio API output
  - 3 tone generators with 12-bit period counters
  - Noise generator with 17-bit LFSR
  - Envelope generator with all 16 shapes
  - Stereo modes: Mono, ABC (A-left, B-center, C-right), ACB
  - Volume control and mute button
  - State saved/restored in projects
  - Register logging for future PSG export
  - Works on 128K, Pentagon, and optionally 48K
- **Z80 Q Factor**: Implemented undocumented Q register for accurate CCF/SCF behavior
  - Q register tracks whether previous instruction modified flags
  - CCF/SCF bits 3,5 computed as `((Q ^ F) | A) & 0x28`
  - Block instructions (LDIR/LDDR/CPIR/CPDR) set Y/X from PC when repeating
  - I/O block instructions (INIR/INDR/OTIR/OTDR) have additional PF/HF modifications
  - Passes all z80ccf tests including edge cases (LDIR->NOP', INIR->NOP', etc.)
- **Z80 HALT Fix**: Corrected HALT behavior to match real hardware
  - PC points to HALT instruction itself (traditional behavior)
  - During HALT NOP cycles, CPU reads from PC+1 (next instruction), not HALT itself
  - When interrupt fires, PC is incremented to point to next instruction
  - Proper memory reads during HALT cycles for accurate contention timing
- **Late Timing Option**: Configurable early/late interrupt timing
  - INT now fires at frame END (T=tstatesPerFrame), matching real hardware
  - Early timing: INT recognized at frame end
  - Late timing: INT recognized 4 T-states after frame end
  - INT pulse duration: 32 T-states (48K) or 36 T-states (128K/Pentagon)
  - Models cold/warm ULA behavior (real hardware drifts over time)
  - Fixed: INT now stays pending until IFF1 is true (EI works correctly)
  - Fixed: Proper EI delay handling (INT not recognized immediately after EI)
  - Checkbox in Settings → Timing
  - Saved in projects and localStorage
- **Floating Bus Emulation**: Basic floating bus support for 48K
  - Returns video memory data during ULA active display
  - Returns 0xFF during border/retrace periods
  - Helps with timing-sensitive tests and some copy protection

## v0.6.4
- **SCL Disk Image Fix**: Fixed SCL→TRD conversion for proper file loading
  - Corrected logical track/sector calculation (16 sectors per logical track)
  - Fixed directory entries to use 0-based sectors matching TRD format
  - Files now start at logical track 1 (physical track 0, side 1)
  - Data offsets now match real TRD disk layout
- **Pentagon Beta Disk Fix**: Fixed "RUN USR 0" hang in Basic 128
  - TR-DOS auto-paging now only activates when ROM 1 (48K BASIC) is selected
  - Prevents spurious TR-DOS activation when running 128K editor code
  - Explicit TR-DOS activation when booting via menu
- **Z80 MEMPTR Fix**: Fixed undocumented MEMPTR behavior for block I/O instructions
  - INIR, INDR, OTIR, OTDR now set MEMPTR = PC + 1 when repeating (B ≠ 0)
  - Passes z80memptr test v1.2a (INIR->NOP', INDR->NOP' tests)

## v0.6.3
- **Graphics Viewer UI Improvements**:
  - Reorganized layout: Canvas | Address+Navigation+Settings | Comment+Actions
  - Navigation buttons, Width/Height spinners, checkboxes, zoom, and preview all in one column
  - Radio buttons (zoom x1/x2/x3) moved below checkboxes
  - Added tooltips to all GFX controls and buttons
  - Renamed "→Mem" button to "→Memdump"
  - Adjusted canvas sizing for portrait mode
- **Programmer Calculator Improvements**:
  - Fixed Enter key to update display with result (not just history)
  - Disable unavailable digit buttons based on numeric system (hex/dec/oct/bin)
  - Visual styling for disabled buttons (grayed out)
  - Keyboard input validation for current base
- **UI Polish**:
  - Renamed tabs: Debug / ASM / Opcodes / GFX / Info / Settings / Calc
  - Landscape mode: shifted app name, Help, and theme buttons right
  - Graphics dump canvas width reduced to 24 columns

## v0.6.2
- **Text Scanner Tool**: Search memory for human-readable text strings
  - Dictionary mode with ~120 common game/computer words (SCORE, LIVES, GAME OVER, etc.)
  - Custom search mode for specific text
  - ROM scan option to include ROM area (0000-3FFF)
  - All banks option to scan all 8 RAM banks in 128K mode (not just mapped memory)
  - Supports null-terminated and bit7-terminated strings
  - Case-insensitive dictionary matching
  - Pagination with configurable results per page (10/25/50/100/All)
  - Click result to navigate to memory address
- **Memory Dump Tooltip Enhancement**:
  - Now shows ASCII character for printable bytes (32-126)
  - Shows `'X'+$80` notation for characters with bit 7 set

## v0.6.1
- **Drag & Drop for Assembler**: Drag .asm or .zip files directly onto editor
  - Separate drop zones: assembler tab for sources, emulator area for ROM/snapshots
  - Visual feedback (cyan border) when dragging over editor
- **File Replace Dialog**: Smart handling of duplicate filenames
  - When dropping a file that exists in project, choose to replace or add as new
  - Prevents duplicate tabs for same file
  - Properly refreshes editor with new content after replace
- **TAP File Fix**: Corrected BASIC block param2 (program length) in TAP headers
  - BASIC blocks now have correct header structure matching sjasmplus.exe output
- **UI Improvements**:
  - Fixed defines dropdown colors in dark theme
  - Increased assembler output panel height
  - "Assembling..." message shown immediately when compiling

## v0.6.0
- **Integrated Z80 Assembler**: sjasmplus-compatible assembler with syntax highlighting
  - Full instruction set support including undocumented opcodes
  - Directives: ORG, EQU, DEFINE, INCLUDE, INCBIN, DB, DW, DS, BLOCK, ALIGN
  - Macros, local labels, temporary labels, structs
  - Expressions with arithmetic, bitwise, and logical operators
- **Multi-file Projects**: Virtual File System (VFS) for assembly projects
  - Load ZIP files containing multiple .asm source files
  - File tabs with modification indicators
  - Main file detection and selection
  - INCLUDE directive resolves files from VFS
- **Assembler Search/Replace**: Full search and replace functionality
  - Ctrl+F: Open find bar
  - Ctrl+R or Ctrl+H: Open find/replace bar
  - F3/Shift+F3: Find next/previous
  - Case-sensitive option
  - Replace one or replace all
- **Search All Files**: Search across all project files in VFS
  - "All Files" button in search bar searches all .asm files
  - Results show filename, line number, and highlighted match
  - Click result to jump to file and line (opens tab if needed)
- **Output File Generation**: SAVEBIN, SAVESNA, SAVETAP, EMPTYTAP directives
  - Generated files listed in output with size and MD5 hash
  - Download button to save output files (single file or ZIP archive)
  - Multiple SAVETAP commands to same file produce single TAP with multiple blocks
- **MD5 Checksum Verification**: Verify generated file integrity
  - Add `; md5: hash` comment to SAVE directives for automatic verification
  - MD5CHECK macro support for associating hashes with files
  - Output shows MD5 OK or MD5 MISMATCH with expected hash
- **Command-Line Defines**: Pass defines for conditional assembly (IFDEF/IFNDEF)
  - Defines input field: `DEBUG,VERSION=5,BUILD=$100`
  - `@define` markers in source: add `; @define NAME` in first 50 lines
  - Dropdown appears for detected @define markers (Ctrl+click for multiple)
- **Debug Button**: Inject code and start debugging at entry point
  - Entry point priority: SAVESNA address > single ORG > prompt if multiple ORGs
- **Assembler Tests**: Comprehensive test suite (asm-test.html)
  - Tests for instructions, directives, labels, expressions, macros, conditionals
- **Assembler UI improvements**:
  - Removed redundant Save button (Export covers it)
  - Smart button states: Inject disabled until successful assembly, Assemble disabled when nothing to compile
  - Reordered toolbar: Files ▼ | Assemble | Inject | Debug | Clear | New | Load | Export | Download
  - Files dropdown shows directory path and sorts by dir/filename
  - Files button always visible but disabled when ≤1 file
  - Main file label colored red for visibility
  - Assembly status shown in Output textarea with success/error styling
  - "Show compiled" checkbox to toggle hex dump display
  - Main file moved to top when loading ZIP projects
- **Error reporting**: Assembly errors now correctly show file and line number
- Removed localStorage saving of assembler source (use project save/load instead)
- Removed debug logging for cleaner console output

## v0.5.8
- **Memory Watches**: New Watches tab for monitoring up to 10 memory addresses
  - Displays 8 bytes per watch with hex dump and ASCII representation
  - Shows label names when watch address matches a defined label
  - Paged address support (e.g., `5:C000` reads directly from RAM bank 5)
  - Changed bytes highlighted during stepping
  - Watches persisted to localStorage and saved in projects
- **UI reorganization**:
  - Moved Overlay mode, Zoom controls to Settings/Display
  - Moved Screenshot/Export to Settings/Export
  - Moved Tests link to Settings/Tools
  - Help button positioned near theme button
  - Reduced screen container padding for compact layout
- **New palettes**: Added Linear, SpecEmu, SpecEmu (green), SpecEmu (grey), Spectaculator b/w
- **Invert display**: Checkbox in Settings/Display to invert screen colors

## v0.5.7
- **Frame Export enhancements**:
  - SCR export format (256x192 screen only, 6912 bytes)
  - BSC export format (screen + border data for rainbow effects, 11136 bytes)
  - [SCA](https://github.com/moroz1999/sca) export format (animation with header + delay table + SCR frames)
  - Single file export when Max frames = 1 (no ZIP wrapper)
  - Export filename based on loaded game name (e.g., `gamename.tap_0000.scr`)
  - Format auto-selects correct capture size (SCR/SCA=screen only, BSC=full border)
  - Compact UI: Format and Max controls on same row
- **BSC format fixes**: Correct border data extraction with proper screen position calculation

## v0.5.6
- **Settings tab**: New tab with Input and Display settings
- **Palette support**: 15 color palettes including Default, ATM-Turbo, Pulsar, Spectaculator, Mars, Ocean, Grey
- Palette selection persisted to localStorage
- **Disassembler fixes**: Fixed ED-prefixed instructions showing extra spurious instructions
- Redundant prefixes (DD DD, FD FD, ED ED, ED CB) now correctly shown as DEFB

## v0.5.5
- **Undocumented flags**: Added 'x' (bit 3) and 'y' (bit 5) flags to the flags display
- **EXA/EXX buttons**: Quick register swap buttons in the IX/IY register row
- **Editable T-states**: Click to edit current T-state counter value
- **Keyboard image**: Added ZX Spectrum keyboard layout image to Info tab
- Fixed register editing: contentEditable approach prevents UI shifting
- Fixed keyboard capture during register editing
- Input length limits based on register size (4 chars for 16-bit, 2 for 8-bit, etc.)

## v0.5.4
- **Editable registers**: Click on any register value (AF, BC, DE, HL, IX, IY, SP, PC, I, R) to edit
- Inline editing with hex/decimal input, Enter to confirm, Escape to cancel
- Editable I, R, IM registers and IFF1/IFF2 interrupt flags
- **Clickable flags**: Click individual CPU flags (S, Z, H, P/V, N, C) to toggle them
- **128K paging controls**: Edit RAM bank (C000), screen bank, ROM bank, and paging lock
- Alternate registers (AF', BC', DE', HL') also editable
- Register editing disabled when viewing trace history

## v0.5.3
- **128K I/O contention emulation** based on Swan emulator algorithm
- Port contention patterns: C:1,C:3 for contended high byte ($40-$7F), N:1,C:3 for ULA ports
- Contention check with `& 0x87` mask ensures accurate per-line timing
- Fixed ULA timing lacing/interlacing issue in 128K mode
- All ULA timing tests now pass: 48K, 128K, and Pentagon
- **Chained prefix support**: DD DD, DD FD, FD DD, DD ED correctly handled
- Z80 emulator processes chained prefixes with correct timing (4T per prefix)
- Disassembler shows redundant prefixes as separate NOP instructions
- Added chained prefix tests to system test suite

## v0.5.2
- **Pixel-perfect Pentagon timing** calibrated against ULA timing test
- Pentagon line composition: 32 (H-blank) + 36 (left border) + 128 (screen) + 28 (right border) = 224 T-states
- Pentagon frame: 16 (V-blank) + 64 (top border) + 192 (screen) + 48 (bottom border) = 320 lines
- Theme persistence across emulator and test pages via localStorage
- Unified font sizes and styling across all test pages

## v0.5.1
- **Pixel-perfect 128K border timing** with ULA rendering offset for right border
- Overlay mode cycling button: None → Grid → Box → Screen → Reveal
- Grid overlay: 8x8 grid, thirds/quarters dividers, 256x192 boundary lines in borders
- Box overlay: Yellow rectangle around 256x192 paper area
- Screen overlay: Border-only mode (hides paper, shows timing stripes)
- Reveal overlay: Semi-transparent paper showing border underneath
- Overlay lines render at 1px regardless of zoom level
- I/O contention for port operations in 128K mode

## v0.5.0
- **Pixel-perfect border timing** for 48K multicolor effects
- Timing now uses pixel units (7MHz) for sub-T-state precision
- ULA contention: per-line delay during screen drawing (32 T-states for 48K, 36 for 128K)
- Single global beam sync offset (no per-line adjustments)
- Border color recorded at correct point in OUT instruction cycle
- Accurate 50 FPS frame timing using requestAnimationFrame
- Machine-specific timing parameters (48K/128K/Pentagon)
- Contention checkbox enabled by default

## v0.4.78
- Fixed: Pentagon 128K menu navigation causing reset
- Fixed: TR-DOS ROM now separate from Pentagon ROM (pentagon.rom contains 128K BASIC + 48K BASIC, NOT TR-DOS)
- Added separate trdos.rom loading (16KB TR-DOS 5.03/5.04t required for disk support)
- Implemented automatic Beta Disk ROM paging (3D00-3DFF trigger)
- TR-DOS ROM pages in when CPU fetches from 3D00-3DFF
- TR-DOS ROM pages out when CPU enters RAM (>=4000h)
- TR-DOS trap handler now checks trdosActive flag before triggering
- Fixed: WD1793 Type III commands (Read/Write Track) now signal completion properly
- Fixed: TRD/SCL loading no longer shows file selection dialog - disk inserts directly
- Fixed: Ctrl+number keys now work for Symbol Shift symbols (underscore, etc.)
- Added: Keyboard help with full Symbol Shift combinations table

## v0.4.77
- Beta Disk interface emulation (WD1793 floppy controller)
- Full TR-DOS ROM support - uses actual TR-DOS for disk operations
- Auto-switch to Pentagon mode when loading TRD/SCL (if Pentagon ROM available)
- "Boot TR-DOS" button for direct access to TR-DOS command prompt
- Proper disk I/O via emulated WD1793 ports (#1F, #3F, #5F, #7F, #FF)
- SCL to TRD conversion for Beta Disk compatibility

## v0.4.76
- TRD/SCL: TR-DOS trap handler for disk operations
- TRD/SCL: Boot files highlighted in selection dialog
- TRD/SCL: CODE files load directly into memory at specified address
- TRD/SCL: Improved messages (not TAP-style LOAD instructions)
- Fixed ZIP extraction buffer slice bug (central directory parsing)

## v0.4.75
- TRD/SCL disk image support (TR-DOS format)
- File browser shows disk contents with type, address, and size
- Files converted to TAP format for instant loading
- Nested disk images in ZIP archives supported
- Project files now store original TAP/TRD/SCL for multi-file programs
- Tape position preserved in project files

## v0.4.74
- Export All Sprites: Export all marked graphics regions to single ASM file
- Region width/height stored with graphics regions for accurate export
- Memory Map: Scale with ticks and 128K multi-bank view
- Click on graphics viewer to show address popup

## v0.4.73
- Graphics Viewer: New tab for sprite search and memory visualization
- Continuous memory dump rendered as graphics (EmuzWin-style)
- Adjustable sprite width (1-32 bytes) and height (1-64 lines)
- Main dump: sprite width x 288 lines, small preview with context
- Red rectangle highlights current sprite selection
- Navigation: byte, line, row (8 lines), sprite, page (24 rows)
- Min/max buttons for width, +/-8 buttons for height (snap to 8-line boundary)
- Mouse wheel scrolling through memory
- Mark selected sprite as Graphics region
- Jump to disassembly or memory view from selected sprite
- Grid overlay and invert display options

## v0.4.72
- Operand Formatting: Right-click on disassembly to change operand display
- Format options: Hex (FFh), Decimal (255), Binary (%11111111), Char ('A')
- Formats persist per instruction address in project save/load
- Syntax highlighting: registers (gold), numbers (green), chars (purple), binary (blue)

## v0.4.71
- Memory Heatmap: Visualize execution/read/write access frequency
- Toggle between Regions and Heatmap views in Memory Map dialog
- RGB color intensity shows access patterns (B=execute, G=read, R=write)
- Log-scale normalization for better visualization of hot spots
- Tooltip shows exact access counts per address

## v0.4.70
- Unified Breakpoint System: Single panel for all trigger types
- Trigger types: Exec, Read, Write, R/W, Port IN, Port OUT, Port I/O
- Enable/disable triggers without removing them
- Conditions now support `val` (memory/port value) and `port` keywords
- Hit counters for each trigger
- Backward compatible with old project files

## v0.4.69
- Execution Trace: Record last 10,000 instructions with full register state
- Trace navigation: Step back/forward through execution history (Alt+Left/Right)
- Trace list panel showing recent instructions with registers
- Click status counter to show/hide trace list

## v0.4.68
- Undo/Redo: Revert changes to labels, regions, comments, bookmarks (Ctrl+Z/Y)
- Pattern Search: Wildcard support with ? for any byte (e.g., "CD ? 00")
- Undo/redo buttons added to toolbar

## v0.4.67
- Tools panel: Consolidated POKE search, Auto-Map, and XRefs into unified panel
- Step buttons moved into disasm panel for compact layout
- Version display moved to status line
- Navigation history fix when navigating from memory map
- Improved landscape mode layout and alignment

## v0.4.66
- Tabbed interface: Debugger and Opcodes tabs with responsive layout
- Z80 opcodes reference with byte values, flags, cycles
- Sorted by mnemonic, undocumented instructions marked
- Search and category filter for opcodes

## v0.4.65
- Cross-references (XRefs): Track where addresses are referenced from
- Hover over operand addresses to see xref tooltip

## v0.4.64
- Bookmarks: Quick navigation for disassembly and memory views

## v0.4.63
- RZX playback (partial)
- Auto memory mapping

## v0.4.62
- Data region rendering (DB/DW/Text as assembler syntax)
- Export with regions (sjasmplus compatible)

## v0.4.61
- Project save/load
- Memory region marking
- Theme toggle

## v0.4.60
- Labels with persistent storage
- Conditional breakpoints
- Memory diff and POKE search
