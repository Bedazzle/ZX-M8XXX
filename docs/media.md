# Media: Auto Load, Tape Loading, WAV Loading, Media Catalog, Multi-Drive Support, Multi-Tape, Tape SAVE, MIC Recording

## Auto Load

Automatic load-and-run for tape and disk files. Controlled via checkbox in Settings -> Tape, mirrored on Settings -> Disk (`chkAutoLoadDisk`, two-way synced with `chkAutoLoad` in `auto-loader.js`; project restore dispatches `change` to keep them aligned).

**Behavior by format:**
- **TAP/TZX**: Reset machine -> type `LOAD ""` (128K: press `1` for Sinclair BASIC menu; +2/+2A: press Enter for Amstrad "Tape Loader") -> flash load handles standard blocks
- **TZX with turbo blocks**: After flash-loading standard blocks, `spectrum.js` auto-starts real-time playback for turbo blocks (see Tape Loading Architecture below)
- **TRD/SCL**: Boot into TR-DOS automatically via `spectrum.bootTrdos()` (only if Beta Disk is available on current machine). SCL files are converted to TRD format before loading.
- **DSK** (+3): Insert into uPD765 FDC, reset + press Enter at Amstrad menu to select "Loader" (ROM auto-detects disk and boots). Uses CP/M-style directory listing.
- **Pure turbo TZX** (no standard blocks): Switches to real-time mode, starts tape playback after Enter
- **WAV**: Treated like pure turbo TZX — flash load is disabled, real-time tape playback starts after `LOAD ""` Enter

**Disk auto-load requirements:** Beta Disk must be available (Pentagon mode, or Beta Disk enabled in settings with TR-DOS ROM loaded). If not available, disk is inserted but only a message is shown -- no automatic machine switch.

**Implementation (`ui/auto-loader.js`):**
- `startAutoLoadTape(isTzx)` -- key injection (J, Sym+P, Sym+P, Enter); 128K/Pentagon pick BASIC then type letter-by-letter; Scorpion navigates its menu first
- `startAutoLoadDisk()` -- calls `spectrum.bootTrdos()` then `spectrum.start()`
- `startAutoLoadDiskRun(filename)` -- TR-DOS `RUN "filename"` (hides the boot entry so it doesn't auto-run, restores it after init)
- `startAutoLoadPlus3Disk()` -- reset, preserve disk, press Enter at Amstrad menu (same pattern as +2/+2A tape)
- `cancelAutoLoad()` -- clears the pending queue, restores keyboard state, unhooks the frame pump
- **Frame-driven timing**: the ZX keyboard is scanned once per maskable interrupt (one per frame), so key debounce/auto-repeat are counted in **frames**, not wall-clock. The typed sequence is scheduled by emulated-frame offset (`autoLoadAt(fn, frameOffset)`, absolute frame = `spectrum.totalFrames` at start + offset) and pumped by a per-frame listener (`autoLoadTick`) registered via `spectrum.addFrameListener()` — which fires once per emulated frame at every speed including Max. This makes auto-load behave identically at any emulation speed (10% … Max) and on any machine regardless of T-states/frame, and it pauses with the emulator. An external rAF poll would batch many frames at high speed and skip a key's down→up window, so the per-frame listener is required. The listener is removed (`removeFrameListener`) when the queue drains or on cancel. Using the multi-listener registry (rather than wrapping `spectrum.onFrame`) keeps it decoupled from other per-frame consumers (second screen, profiler)
- Timing constants (frames, ~50/sec): `AUTO_LOAD_ROM_WAIT` (150), `AUTO_LOAD_128K_WAIT` (75), `AUTO_LOAD_SCORPION_WAIT` (200), `AUTO_LOAD_KEY_HOLD` (10), `AUTO_LOAD_KEY_GAP` (8), `AUTO_LOAD_KEY_HOLD_FAST`/`AUTO_LOAD_KEY_GAP_FAST` (5)
- Amstrad menu machines (+2/+2A/+3): just press Enter -- "Tape Loader" is the default menu item, runs LOAD "" automatically
- Cancellation hooks: machine change, reset button, new file load

**`bootTrdos()` (`spectrum.js`):**
- Uses FUSE-style approach: full machine reset -> select BASIC ROM bank -> page in TR-DOS ROM -> PC=0
- TR-DOS ROM runs its own initialization from address 0 (sets up system variables, channels, workspace)
- Does NOT manually construct system variables -- the ROM handles everything
- Disk state (betaDisk) is preserved across the reset

**Boot file injection** (Settings -> Disk -> Boot File):
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

Tape and disk catalogs are on separate Settings sub-tabs (Tape and Disk).

**Tape catalog** (Settings -> Tape):
- Appears when a TZX/TAP is loaded or a blank tape is inserted
- Lists all blocks with type labels (Standard, Turbo, Pure Tone, etc.), block sizes, current playback position
- Highlights active block during playback; click a block to jump to it
- Slot tabs (1/2) when multi-tape is in use
- Actions row: Eject, Export, Clear Rec buttons

**Disk catalog** (Settings -> Disk):
- Appears when a TRD/SCL/DSK/MGT/MDR/OPD disk is loaded
- Shows disk header (label, file count, free space) and file listing
- TRD: name, extension, start address, size, sectors (boot file in cyan). DSK: CP/M-style name, extension, size. MGT: name, type name, address, size. MDR: name, length, sectors, type. OPD: name, length.
- **Drive sub-tabs**: Dynamically generated per drive that has a disk. When only one disk controller is active, uses simple labels (`A:`, `B:`, `1:`, etc.). When multiple controllers have disks loaded simultaneously, uses prefixed labels (`3DOS:A`, `TRD:A`, `MGT:A`, `MDR:1`, `Opus:A`, etc.) to distinguish controllers.
- **Drive selector**: Dropdown to choose target drive (A-D for Beta Disk, A-B for FDC) when loading/creating disk images
- **Load Disk...**: Opens file picker for disk images (TRD/SCL/DSK/MGT/IMG/MDR/OPD/ZIP), inserts into selected drive without reset/auto-boot
- **Blank Disk**: Creates a blank formatted disk in the selected drive for the *active disk system* — button label shows the format (Blank TRD / Blank DSK / Blank MGT / Blank MDR). `getAvailableDiskSystems()` (`file-loader.js`) lists active systems in hardware order (+3 FDC → DSK, Beta Disk built-in or enabled+trdos.rom → TRD, +D → MGT, IF1 → MDR); `getActiveDiskSystem()` returns the user-selected one (or the first). Error with guidance if none active
- **System dropdown** (`#diskSystemSelect`): always lists all active disk systems (Beta Disk can coexist with +D or IF1); selects which system Blank Disk, Target drive, and system-specific rows act on. Selection sticks until that system is disabled
- **Target drive**: options adjust per system — 4 lettered drives for TR-DOS, 2 for +3DOS/+D, numbered 1:-4: for Microdrives. The row is visible whenever ≥1 disk interface is active. Refresh triggers: interface toggles and manual ROM loads (`onDiskSystemsChanged` callback in `input-settings.js`), and `loadRomsForMachineType()` (`rom-selector.js`) — the latter matters because peripheral ROMs auto-load asynchronously at startup, so e.g. Microdrive only becomes available once if1.rom arrives
- **System-specific rows**: `#trdosBootRow` (boot file injection) is shown only when the selected system is TR-DOS

Double-click a tape block or disk file to open the full image in Explorer for analysis.

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
- `sclToTrd(sclData)` / `trdToScl(trdData)` -- SCL↔TRD conversion. SCL disks are converted to TRD on insert; Save → TRD/SCL (toolbar) downloads the disk in the drive selected under Settings → Disk, converting back to SCL for disks loaded from `.scl`. `trdToScl` skips deleted directory entries (first byte 0x01 — TR-DOS erase corrupts the name's first character) and stops at the end marker (0x00); output includes the trailing 4-byte SCL checksum (32-bit LE sum)
- Write Sector completion clears DRQ along with BUSY in the WD1793 status — TR-DOS validates the final status with `AND 7Fh`, so a leftover DRQ reads as a failed write ("Disc error")
- Blank/converted disks stamp 2544 free sectors in the info sector (2560 total − 16 for the directory track)
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
- `this.loadedTapes[0..1]` -- 2-slot tape state (independent of disks)
- `this.activeTapeSlot` -- currently active tape slot (0 or 1)
- `this.loadedBetaDisks[0..3]` -- per-drive Beta Disk state `{ data, name }`
- `this.loadedFDCDisks[0..1]` -- per-drive FDC state `{ data, name }`
- `this.loadedBetaDiskFiles[0..3]` -- per-drive Beta Disk file listings for catalog display
- `this.loadedFDCDiskFiles[0..1]` -- per-drive FDC file listings for catalog display
- File listings are stored separately per controller to prevent cross-contamination when both FDC and Beta Disk have disks at the same drive index
- Loading tape no longer ejects disk and vice versa
- `this.loadedOpusDisks[0..1]` -- per-drive Opus Discovery state `{ data, name }`
- `this.loadedOpusDiskFiles[0..1]` -- per-drive Opus Discovery file listings for catalog display
- `getLoadedMedia()` returns structured `{ tape, tapes, activeTapeSlot, tapeSlotStates, tapeRecordings, betaDisks, fdcDisks, plusDDisks, opusDisks, tapeBlock }`
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
- Multi-tape state (`tapes`, `activeTapeSlot`, `tapeSlotStates`, `tapeRecordings`) saved alongside legacy `tape` field
- Backward compatible: loads old single-media format (`project.media.data`) via legacy path in `setLoadedMedia()`; single `media.tape` migrated to `loadedTapes[0]`
- Auto-load only triggers when loading into drive A (index 0)

## Multi-Tape Support

2 tape slots for multi-tape games. Controlled via slot tabs (1/2) in Media Catalog bar.

**Data structures (`spectrum.js`):**
- `this.loadedTapes[0..1]` -- per-slot `{ type, data, name }` (same format as old `loadedTape`)
- `this.activeTapeSlot` -- 0 or 1
- `this.tapeSlotStates[0..1]` -- per-slot `{ loaderBlock, playerBlock }` preserving tape position
- `this.tapeRecordings[0..1]` -- per-slot arrays of saved TAP block Uint8Arrays

**Slot switching (`setActiveTapeSlot(slot)`):**
1. Stops tape playback
2. Saves current position (tapeLoader block + tapePlayer block) to `tapeSlotStates[currentSlot]`
3. Sets `activeTapeSlot = slot`
4. Reloads tape data into tapeLoader/tapePlayer/tapeTrap from `loadedTapes[slot]`
5. Restores position from `tapeSlotStates[slot]` if available

**Limitations:**
- Phase within a block is lost on slot switch (restarts from block start)
- Recording buffers survive slot switches (each slot has independent recordings)

**UI (`media-catalog.js`):**
- Slot tabs appear in media catalog bar when any tape is loaded
- Active slot tab highlighted; empty slots shown at 40% opacity
- Switching slot rebuilds tape catalog, updates position display, updates recording status

## Tape SAVE

Traps the ROM `SA_BYTES` routine at 0x04C2 to capture SAVE data and build TAP blocks for export.

**TapeSaveTrapHandler (`core/loaders.js`):**
- Checks PC=0x04C2, correct ROM bank (BASIC ROM via `profile.basicRomBank`), TR-DOS not active
- Reads flag from A register (0x00=header, 0xFF=data), start from IX, length from DE
- Reads data bytes from memory, computes XOR checksum (flag + all data)
- Builds TAP block: `[length_lo][length_hi][flag][data...][checksum]`
- Calls `onBlockSaved(tapBlock, flag)` callback
- Simulates register state as if SA_BYTES ran to completion: IX advanced past data, DE set to 0xFFFF (counter underflow after parity byte), carry set for success
- Pops return address from stack and jumps to it (same as load trap) — works for both CALL SA_BYTES (header) and JP SA_BYTES (data) entry patterns

**Integration (`spectrum.js`):**
- `this.tapeSaveTrap` created in constructor, enabled alongside tape traps
- Default `onBlockSaved` appends to `this.tapeRecordings[activeTapeSlot]`
- Checked in both fast and debug execution loops (after load trap, before TR-DOS trap)
- Override callback in `index.html` adds UI feedback (recording count, status message)

**Recording export:**
- `getTapeRecording(slot)` -- returns `{ data: Uint8Array, ext: 'tap'|'tzx' }` or null
  - TAP format when only ROM-trapped blocks exist (pure standard saves)
  - TZX format when MIC-recorded blocks are present (combines both sources via `buildTZX()`)
- `clearTapeRecording(slot)` -- clears both TAP and MIC recording buffers for slot
- `getTapeRecordingBlockCount(slot)` -- returns total saved blocks (ROM trap + MIC)

**UI (`media-catalog.js`):**
- Actions row appears below tape catalog: "Eject", recording count, "Export", "Clear Rec"
- "Eject" visible when tape present in active slot; "Export"/"Clear Rec" visible when recordings exist
- "Export" downloads recording as TAP or TZX depending on content
- "Clear Rec" clears recording buffer and removes block listing for active slot
- Status message shown on each saved block ("Saved Header block (19 bytes)", etc.)
- Tape tab auto-appears when first recording is captured, even without a loaded tape
- "Blank Tape" button inserts an empty tape into the active slot — shows tape catalog with "blank tape" and hint "Recording is automatic — just press any key when prompted"
- "Load Tape..." button opens a file picker (TAP/TZX/WAV/ZIP) and inserts the selected tape into the active slot without resetting the machine or triggering auto-load — useful for tape copiers, multi-tape games, and mid-session tape swaps. ZIP files are filtered to tape types only; single-tape ZIPs load directly, multi-tape ZIPs show a selection dialog.
- "Load Disk..." button (on Disk tab) opens a file picker (TRD/SCL/DSK/MGT/IMG/MDR/OPD/ZIP) and inserts the disk image into the selected drive without resetting the machine or triggering auto-load/boot. Supports all disk systems: Beta Disk (TRD/SCL), +3 FDC (DSK), +D/DISCiPLE (MGT/IMG), Interface 1 Microdrive (MDR), Opus Discovery (OPD). ZIP files are filtered to disk types only. Machine compatibility is validated — error messages guide the user if the required interface is not enabled.
- Recorded blocks listed in catalog for blank tapes (header/data descriptions parsed from TAP blocks, MIC blocks shown with pulse count)

## MIC Recording

Captures custom save routines that bypass the ROM by writing directly to port 0xFE bit 3 (MIC output). Records pulse timings and exports as TZX Direct Recording blocks.

**MicRecorder (`core/loaders.js`):**
- Monitors port 0xFE bit 3 (MIC) transitions via `writeMic(micBit, cpuTStates)`
- Records pulse durations (T-states between level changes) into `currentPulses[]`
- Auto-detects block boundaries via silence detection: 50 frames (~1s) without a MIC transition finalizes the current block
- Minimum pulse threshold (100 pulses) filters out noise/beeper writes
- `onFrameEnd(cpuTStates)` called every frame to track silence duration
- `onBlockRecorded(block)` callback fires when a block is finalized
- Each block stores `{ pulses: number[], initialLevel: 0|1 }`

**Pulse-to-TZX conversion (`core/loaders.js`):**
- `pulsesToDirectRecording(block)` converts pulse arrays to TZX block 0x15 (Direct Recording)
- Sample rate: 79 T-states per sample (~44.3 kHz at 3.5 MHz)
- Pulse durations converted to sample counts, packed into bitstream
- Initial level set from `block.initialLevel`

**`buildTZX(tapBlocks, micBlocks)` (`core/loaders.js`):**
- Combines ROM-trapped TAP blocks (as TZX block 0x10, Standard Speed Data) and MIC pulse blocks (as TZX block 0x15, Direct Recording) into a single valid TZX file
- Header: `ZXTape!\x1A` + version 1.20

**Integration (`spectrum.js`):**
- `this.micRecorder` created in constructor with `tstatesPerFrame` from machine timing
- `this.micRecordings[0..1]` -- per-slot arrays of recorded MIC blocks
- Port 0xFE writes feed `micRecorder.writeMic((val >> 3) & 1, cpuTStates)`
- Frame end calls `micRecorder.onFrameEnd(cpuTStates)` in both normal and headless loops
- Default `onBlockRecorded` appends to `micRecordings[activeTapeSlot]`
- Override callback in `index.html` adds UI feedback ("MIC: Recorded block (N pulses)")
- `micRecorder.reset()` called on machine type change; `setTstatesPerFrame()` updates timing
