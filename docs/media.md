# Media: Auto Load, Tape Loading, WAV Loading, Media Catalog, Multi-Drive Support

## Auto Load

Automatic load-and-run for tape and disk files. Controlled via checkbox in Settings -> Media.

**Behavior by format:**
- **TAP/TZX**: Reset machine -> type `LOAD ""` (128K: press `1` for Sinclair BASIC menu; +2/+2A: press Enter for Amstrad "Tape Loader") -> flash load handles standard blocks
- **TZX with turbo blocks**: After flash-loading standard blocks, `spectrum.js` auto-starts real-time playback for turbo blocks (see Tape Loading Architecture below)
- **TRD/SCL**: Boot into TR-DOS automatically via `spectrum.bootTrdos()` (only if Beta Disk is available on current machine). SCL files are converted to TRD format before loading.
- **DSK** (+3): Insert into uPD765 FDC, reset + press Enter at Amstrad menu to select "Loader" (ROM auto-detects disk and boots). Uses CP/M-style directory listing.
- **Pure turbo TZX** (no standard blocks): Switches to real-time mode, starts tape playback after Enter
- **WAV**: Treated like pure turbo TZX — flash load is disabled, real-time tape playback starts after `LOAD ""` Enter

**Disk auto-load requirements:** Beta Disk must be available (Pentagon mode, or Beta Disk enabled in settings with TR-DOS ROM loaded). If not available, disk is inserted but only a message is shown -- no automatic machine switch.

**Implementation (`index.html`):**
- `startAutoLoadTape(isTzx)` -- setTimeout-based key injection (J, Sym+P, Sym+P, Enter)
- `startAutoLoadDisk()` -- calls `spectrum.bootTrdos()` then `spectrum.start()`
- `startAutoLoadPlus3Disk()` -- reset, preserve disk, press Enter at Amstrad menu (same pattern as +2/+2A tape)
- `cancelAutoLoad()` -- clears all pending timers, resets keyboard state
- Timing constants: `AUTO_LOAD_ROM_WAIT` (3000ms), `AUTO_LOAD_KEY_HOLD` (300ms), `AUTO_LOAD_KEY_GAP` (200ms), `AUTO_LOAD_128K_WAIT` (2000ms)
- Amstrad menu machines (+2/+2A/+3): just press Enter -- "Tape Loader" is the default menu item, runs LOAD "" automatically
- Cancellation hooks: machine change, reset button, new file load

**`bootTrdos()` (`spectrum.js`):**
- Uses FUSE-style approach: full machine reset -> select BASIC ROM bank -> page in TR-DOS ROM -> PC=0
- TR-DOS ROM runs its own initialization from address 0 (sets up system variables, channels, workspace)
- Does NOT manually construct system variables -- the ROM handles everything
- Disk state (betaDisk) is preserved across the reset

**Boot file injection** (Settings -> Media -> Boot File):
- Modes: "No change", "Add boot" (only if no boot exists), "Replace boot"
- User selects a source TRD or Hobeta file containing the boot file to inject
- Applied via `spectrum.onBeforeTrdLoad` callback in `loadDiskImage()`
- SCL files are converted to TRD format first, so boot injection works for both TRD and SCL
- Conversion uses `betaDisk.sclToTrd()` before boot injection, then loads as TRD

**Project save/load:** `autoLoad` boolean in `project.settings`

## Tape Loading Architecture

Two tape systems work together for TZX files with mixed standard + turbo blocks:

**`tapeLoader`** -- holds only standard blocks (filtered), used by flash load (ROM trap at PC=0x056C)
**`tapePlayer`** -- holds ALL blocks (standard + turbo), used for real-time EAR-bit playback

**Key data structures (`spectrum.js`):**
- `standardBlockMap[]` -- maps tapeLoader indices -> full tapePlayer block indices
- `standardBlockSet` -- Set of full indices that are standard blocks
- `_turboBlockPending` -- flag set when next block after flash load is non-standard

**Flash-to-turbo handoff flow:**
1. Flash load processes standard blocks via `tapeTrap.onBlockLoaded(loadedBlockIndex)`
2. Callback maps `loadedBlockIndex` -> `fullIdx` via `standardBlockMap`, checks if `nextFullIdx` is non-standard
3. If next block is turbo: positions `tapePlayer` at that block, sets `_turboBlockPending = true`
4. Auto-start in `portRead()`: when port 0xFE is read with `_turboBlockPending` true, starts `tapePlayer.play()`

**Critical guard -- PC >= 0x4000:**
The auto-start ONLY triggers when `this.cpu.pc >= 0x4000`. This prevents false triggers from ROM keyboard scanning (ISR at ~0x0038 -> 0x028E reads port 0xFE for all 8 half-rows). Without this check, the turbo pilot starts during an interrupt BEFORE the custom loader runs, and short pilots expire before the loader can sync. On stock ROMs (48K, 128K, Pentagon 128), custom loaders reside in RAM (PC >= 0x4000). Note: some modified ROMs contain turbo loaders in ROM space, but these are out of scope for the supported machine types.

## WAV Tape Loading

WAV audio files can be loaded as tape input. PCM audio is converted to pulse sequences for real-time EAR-bit playback via the TapePlayer.

**WAVLoader (`core/loaders.js`):**
- `static isWAV(data)` -- checks RIFF/WAVE magic bytes
- `load(data)` -- parses RIFF chunks (scans for `fmt ` and `data`), validates PCM format (audioFormat=1)
- Supports 8-bit unsigned and 16-bit signed samples, mono and stereo (left channel only for stereo)
- Stores metadata: sampleRate, bitsPerSample, channels, duration, totalSamples

**AC-coupled zero-crossing conversion:**
The real ZX Spectrum EAR circuit has a capacitor that AC-couples the tape signal before the comparator, removing DC offset. WAVLoader simulates this:
1. **Pass 1**: Scans all samples to find min/max range for initial midpoint
2. **Pass 2**: Applies a high-pass filter (exponential moving average, 5ms time constant: `dcAlpha = 1 / (sampleRate * 0.005)`) to track DC offset locally. The AC-coupled signal = raw sample minus DC estimate
3. **Zero-crossing detection**: Finds sign changes in the AC-coupled signal with linear interpolation for sub-sample precision edge timing
4. **Pulse generation**: Converts crossing positions to T-state durations between EAR level toggles (`tStatesPerSample = 3500000 / sampleRate`)

The AC coupling is essential for WAV files where the DC offset varies between standard and turbo sections (e.g. asymmetric signals with range [-122, 73]). A global midpoint threshold would place crossings at wrong positions for one section or the other.

**Output format**: A `pulses` block (array of T-state durations between level toggles). If the initial signal level is high, a 1-T-state tone block is prepended to set the correct initial EAR state.

**Integration (`spectrum.js`):**
- `loadWAV()` loads blocks into `tapePlayer` only (no flash load — WAV is always real-time playback)
- Sets `_turboBlockPending = true` for auto-start when the loader reads port 0xFE
- Auto-load treats WAV like pure turbo TZX (types `LOAD ""`, starts real-time playback)

## Media Catalog

Settings -> Media shows a tabbed catalog at the bottom of the Media panel:
- **Tape tab**: Appears when a TZX/TAP is loaded. Lists all blocks with type labels (Standard, Turbo, Pure Tone, etc.), block sizes, current playback position. Highlights active block during playback. Click a block to jump to it.
- **Disk tab**: Appears when a TRD/SCL/DSK/MGT/MDR/OPD disk is loaded. Shows disk header (label, file count, free space) and file listing. TRD: name, extension, start address, size, sectors (boot file in cyan). DSK: CP/M-style name, extension, size. MGT: name, type name, address, size. MDR: name, length, sectors, type. OPD: name, length.
- **Drive sub-tabs**: Dynamically generated per drive that has a disk. When only one disk controller is active, uses simple labels (`A:`, `B:`, `1:`, etc.). When multiple controllers have disks loaded simultaneously, uses prefixed labels (`3DOS:A`, `TRD:A`, `MGT:A`, `MDR:1`, `Opus:A`, etc.) to distinguish controllers. Clicking a tab shows only that controller's catalog for the selected drive.
- **Drive selector**: Dropdown in Settings -> Media to choose target drive (A-D for Beta Disk, A-B for FDC) when loading disk images
- Tabs appear/disappear dynamically as media is loaded or cleared
- Auto-selects the tab for newly loaded media
- Container hidden when no media is loaded; hidden on machine reset

## Multi-Drive Support

Supports multiple simultaneous drives and tape+disk coexistence.

**BetaDisk (WD1793) -- 4 drives (`loaders.js`):**
- `this.drives[]` array: 4 entries, each with `{ diskData, diskType, headTrack }`
- `this.drive` (0-3) set by system register 0xFF bits 0-1 -- selects active drive
- `this.track` = WD1793 track register (shared across all drives)
- `drives[n].headTrack` = physical head position per drive (updated by seek/step/restore)
- `readSector()`/`writeSector()` use `currentDisk.diskData` (current drive's data)
- `loadDisk(data, type, driveIndex = 0)` -- loads into specific drive
- `ejectDisk(driveIndex)` / `hasDisk(driveIndex)` / `hasAnyDisk()` -- per-drive queries
- `createBlankDisk(label, driveIndex = 0)` -- creates blank disk in specific drive
- **Instant-completion model**: Sector data is loaded into a buffer immediately when a Read/Write Sector command is issued. Bytes are transferred one at a time via port $7F reads/writes. No timing simulation.
- **Lost Data simulation**: On real WD1793, data bytes arrive at disk rotation speed. If the CPU polls the system register ($FF) without reading port $7F, bytes are "lost" and INTRQ fires after all bytes pass. Tracked via `_sysReadsSinceData` counter -- after 2+ consecutive $FF reads without a $7F read, the sector auto-completes. Counter resets on port $7F reads and on new commands. This handles TR-DOS routines that issue Read Sector and only poll for INTRQ.
- **Read Address ($C0)**: Returns physical head position (`headTrack`), not the track register value
- **Multi-sector reads/writes**: m=1 commands auto-advance sector after each sector is consumed, continuing until past last sector (16) on the track

**FDC (uPD765) -- 2 drives (`fdc.js`):**
- `this.drives[]` array: 4 entries (only 0-1 used), each with `{ track, disk, motorOn }`
- `ejectDisk(driveIndex)` / `hasDisk(driveIndex)` -- per-drive management
- `onDiskActivity` callback includes drive number as 5th parameter

**Microdrive (IF1) -- 8 drives (`loaders.js`):**
- `this.drives[]` array: 8 entries, each with `{ cartridge, writeProtect, motorOn, headPos }`
- `this.commsShiftReg` 8-bit shift register for drive select (rising CLK edge shifts DATA in)
- `loadCartridge(data, driveIndex)` -- loads MDR image into specific drive
- `ejectCartridge(driveIndex)` / `hasCartridge(driveIndex)` / `hasAnyCartridge()` -- per-drive queries
- Instant-completion model: Each port $E7 access reads/writes one byte at headPos and advances

**Tape + Disk coexistence (`spectrum.js`):**
- `this.loadedTape` -- tape state (independent of disks)
- `this.loadedBetaDisks[0..3]` -- per-drive Beta Disk state `{ data, name }`
- `this.loadedFDCDisks[0..1]` -- per-drive FDC state `{ data, name }`
- `this.loadedBetaDiskFiles[0..3]` -- per-drive Beta Disk file listings for catalog display
- `this.loadedFDCDiskFiles[0..1]` -- per-drive FDC file listings for catalog display
- File listings are stored separately per controller to prevent cross-contamination when both FDC and Beta Disk have disks at the same drive index
- Loading tape no longer ejects disk and vice versa
- `this.loadedOpusDisks[0..1]` -- per-drive Opus Discovery state `{ data, name }`
- `this.loadedOpusDiskFiles[0..1]` -- per-drive Opus Discovery file listings for catalog display
- `getLoadedMedia()` returns structured `{ tape, betaDisks, fdcDisks, plusDDisks, opusDisks, tapeBlock }`
- `setLoadedMedia(media)` handles both new multi-drive format and legacy single-media format
- `clearTape()` / `clearDisk(driveIndex, type)` -- selective clearing (`type`: `'fdc'`, `'beta'`, `'plusd'`, or `'opus'`)
- `loadFile(file, driveIndex)` / `loadDiskImage(..., driveIndex)` / `loadDSKImage(..., driveIndex)` -- drive parameter

**Multi-controller support (FDC, Beta Disk, +D, IF1, Opus):**
- All five disk/cartridge controllers can have media loaded simultaneously (though IF1 and +D are mutually exclusive at the port level, and Opus and +D are mutually exclusive)
- `hasDiskInDrive(driveIndex)` checks all controllers including IF1 and Opus
- Catalog shows sections for each active controller when a drive index has disks from multiple controllers
- Drive tabs use prefixed labels (`3DOS:A`, `TRD:B`, `MGT:A`, `MDR:1`, `Opus:A`) when multiple controllers have disks; simple labels (`A:`, `B:`, `1:`) when only one controller is active
- `buildDiskCatalog(driveIndex, controller)` accepts optional controller type (`'fdc'`/`'beta'`/`'plusd'`/`'if1'`/`'opus'`) to show specific controller's content; each tab tracks its controller via `data-controller` attribute
- `diskCatalogController` tracks which controller is currently displayed alongside `diskCatalogDrive`

**Disk activity indicator:** Shows drive letter prefix (e.g., `A:T00:S01:A`). Disk tooltip lists all loaded drives.

**Project save/load (`index.html`):**
- `mediaVersion: 2` format saves tape + per-drive Beta Disk + per-drive FDC disk + per-drive +D disk + per-drive Opus disk
- Backward compatible: loads old single-media format (`project.media.data`) via legacy path in `setLoadedMedia()`
- Auto-load only triggers when loading into drive A (index 0)
