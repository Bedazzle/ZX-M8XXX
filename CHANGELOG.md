# Changelog

All notable changes to ZX-M8XXX are documented in this file.

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
