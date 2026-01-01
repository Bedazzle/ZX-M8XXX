# Changelog

All notable changes to ZX-M8XXX are documented in this file.

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
