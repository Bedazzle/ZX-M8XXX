# Snapshot Formats: RZX, Binary Export/Import, Screenshot, Quicksave, Game Browser

## RZX Recording/Playback

RZX is the standard input recording format for ZX Spectrum emulators.

**Recording** (`spectrum.js`):
- Uses SZX snapshot format (preserves CPU halted state)
- Recording starts immediately after interrupt fires (not at frame boundary)
- This ensures snapshot captures interrupt handler entry state (PC=$0038, IFF1=false, T~20)
- Each frame stores: M1 cycle count (fetchCount) and port IN values

**Playback**:
- Fires interrupt early when CPU is halted and waiting (RZX HALT support)
- Tracks M1 cycles and input consumption per frame
- Logs warnings on M1/input mismatches for debugging

**Key timing detail**: Recording must start after interrupt fires so keyboard scan inputs (8 INs from $00FE) are captured in frame 0, not frame 1. This matches FUSE/Spectaculator behavior.

**Compatibility**: Most RZX recordings work correctly. Some games with unusual timing (e.g., Batty) may fail.

## Game Browser

Online game search via ZXInfo API (api.zxinfo.dk) - same database as Spectrum Computing.

- Access via Load -> Web
- Search by title, results sorted alphabetically
- Shows screenshots, metadata, direct download links
- Zero dependencies - uses browser fetch directly

## Quicksave/Quickload

Instant state save/restore using browser localStorage.

- **F2** = Quicksave (stores SZX to localStorage)
- **F5** = Quickload (restores from localStorage)
- Also accessible via Load/Save dropdowns

## Binary Export/Import

Export memory ranges to `.bin` files or import `.bin` files into memory. Located in Tools -> Export/Import tab, "Binary" section. Uses `memory.getBlock()`/`memory.setBlock()` which route through `read()`/`write()` per byte, so the current banking state (128K page, TR-DOS, +2A special paging, etc.) is automatically respected.

**Export**: Start address (hex) + Length (hex) + End address (hex). Start + Length and Start + End are mutually synced -- editing Length updates End and vice versa. Editing Start re-syncs the dependent field. End is clamped to never fall below Start. Downloads as `{baseName}_{startAddr}.bin` via `downloadFile()`.

**Import**: Start address (hex) + file picker (`.bin`, `.dat`, or any). Reads file as `ArrayBuffer`, writes to memory at start address via `memory.setBlock()`, calls `renderToScreen()` to refresh display while paused, then refreshes debugger.

**Validation**: End >= Start enforced on commit. Length clamped to minimum 1 and maximum `0x10000 - start`. Export also validates before download. Field sync uses `change` events (fires on blur/Enter) so the user can freely type without mid-edit reformatting.

**Compare** (Tools -> Compare tab): "Memory vs Binary" mode compares a loaded binary file against current emulator memory at a specified start address. Uses `memory.read()` per byte so banking is respected. File is shown as "File A", emulator memory as "Memory". Truncates comparison if file would overflow past $FFFF (with warning).

## Screenshot Button

The camera button below the canvas (hotkey: **F3**) captures a screenshot using settings from the Export/Import tab's "Screenshot Button" section. F3 in the assembler editor remains Find Next (scoped to `asmEditor` keydown).

**Settings** (persisted to `localStorage` key `zxm8_screenshot` as JSON):
- **Format**: PNG (image), SCR (raw 6912 bytes), GIF (flash) -- 2-frame animated GIF with both flash phases, Gigascreen -- dual-screen `.img` (13824 bytes: bank 5 + bank 7, no header; 48K falls back to SCR)
- **Size**: Screen only (256x192 crop) or With border (full display). Hidden for raw formats (SCR, Gigascreen)
- **Zoom**: x1, x2, x3 -- output pixel scaling. Hidden for raw formats (SCR, Gigascreen)
- **Overlay**: Include overlay canvas (grid, etc.) in the capture. Hidden for raw formats (SCR, Gigascreen)
- **Batch**: Buffer screenshots instead of downloading. When Batch is checked, **F3** starts/stops timed auto-capture. **Ctrl+F3** stops auto-capture (if running) and saves all buffered screenshots as ZIP via `createZip()`.
- **Every / frames|seconds**: Auto-capture interval. "frames" counts emulator frames directly; "seconds" converts to frames at 50fps (`Math.round(N * 50)`). Fractional seconds supported (e.g., 0.5 = every 25 frames).

**IDs**: `screenshotFormat`, `screenshotSize`, `screenshotZoom`, `chkScreenshotOverlay`, `chkScreenshotBatch`, `screenshotBatchCount`, `screenshotInterval`, `screenshotIntervalUnit`

**Implementation** (`index.html`):
- `captureScreenCanvas(size, zoom, includeOverlay)` -- helper that crops the screen canvas (screen-only or full border), scales to zoom level with `imageSmoothingEnabled = false`, composites overlay canvas if enabled. Overlay source rect accounts for `getCurrentZoom()` since overlayCanvas resolution = screen dims x currentZoom.
- **PNG mode**: `captureScreenCanvas()` -> `toBlob()` -> download
- **SCR mode**: Read 6912 bytes from $4000, append 64-byte ULAplus palette if active (6976 bytes total). Zoom/size/overlay don't apply. Cannot capture raster palette effects (HAM256 etc.) that change palette registers mid-frame -- `palette[]` only holds the last-written values, not per-scanline state. Use PNG for those.
- **GIF mode**: Capture frame 1, flip `ula.flashState`, `renderToScreen()`, capture frame 2, restore flash state. Build 2-frame GIF via `GifEncoder` (exposed from `frame-export.js`). Frame delay = 32 (320ms per flash phase).
- **Gigascreen mode**: Reads `spectrum.memory.ram[5]` (bank 5) and `spectrum.memory.ram[7]` (bank 7) directly — 6912 bytes each, concatenated into a 13824-byte `.img` file with no header. On 48K machines (single RAM page), falls back to regular SCR export with a message. No ULAplus palette is appended. Zoom/size/overlay don't apply.
- Filename: `{baseName}_{timestamp}.{ext}` using `getExportBaseName()`

**Batch buffer** (`index.html`): `screenshotBatch[]` array of `{name, data}` entries. `captureToBuffer(name, data)` pushes to buffer and updates count display. `saveBatchAsZip()` calls `createZip(screenshotBatch)` -> `downloadFile()` -> clears buffer. Exposed as `window._screenshotSaveBatchAsZip` for keyboard shortcut access from `keyboard-shortcuts.js`.

**Auto-capture** (`index.html`): Timed batch capture using `spectrum.onFrame` hook. State: `autoCaptureActive`, `autoCaptureFrameCounter`, `autoCaptureSeqNum`, `autoCaptureSavedOnFrame` (saves previous `onFrame` for chaining), `autoCaptureIntervalFrames` (computed from UI). `startAutoCapture()` hooks `spectrum.onFrame`, counts frames, calls `autoCaptureOneFrame()` at interval. `stopAutoCapture()` restores previous `onFrame`. `autoCaptureOneFrame()` captures using current settings -- SCR reads memory directly, Gigascreen reads `ram[5]`+`ram[7]` directly (48K falls back to SCR), PNG/GIF uses synchronous `toDataURL()` via `dataUrlToUint8Array()` helper. GIF mode falls back to PNG (flash GIF per frame is impractical). Filenames use 5-digit zero-padded sequence numbers (`{baseName}_{00000}.{ext}`). Exposed as `window._screenshotAutoCapture` with `start()`, `stop()`, `isActive()`. Auto-capture stops on machine reset/change via `stopActiveTools()`.

**`getExportBaseName()`**: Reads `lastLoadedFile` element text (set by `handleLoadResult()` for any file type -- SNA, Z80, TAP, TRD, etc.), strips file extension. Returns `'frame'` if no file loaded. Defined in `ui/frame-export.js`.

**`GifEncoder`** and **`createZip`**: Defined in `ui/frame-export.js` inside `initFrameExport()` closure. Exposed via return value: `return { getExportBaseName, GifEncoder, createZip }`. Destructured in `index.html`.
