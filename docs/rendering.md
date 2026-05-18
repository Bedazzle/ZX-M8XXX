# Rendering: Audio, Scanline Rendering, Double-Buffer Design

## Audio (`spectrum.js`)

Audio output uses `AudioWorklet` when available (secure contexts: HTTPS or localhost), with automatic fallback to `ScriptProcessorNode` for plain HTTP deployments.

- **AudioWorklet path**: `audio-processor.js` runs a `ZXAudioProcessor` worklet with an 8192-sample ring buffer. Main thread sends samples via `workletNode.port.postMessage({left, right})`.
- **ScriptProcessorNode fallback**: `_initScriptProcessor()` creates a `ScriptProcessorNode` with identical ring-buffer logic inline. Activated when `this.context.audioWorklet` is undefined.
- **`flushSamples()`**: Routes sample data to whichever output is active (postMessage for worklet, `_scriptWrite()` closure for ScriptProcessor).
- **`processFrame()`**: Generates per-frame audio samples from beeper changes, tape audio, and AY chip state. Guard checks for either `workletNode` or `scriptNode`.
- **Volume/mute**: Controlled via shared `gainNode` -- works identically on both paths.
- **Late Timings**: ULA timing checkbox in Settings -> Machines (near Load ROMs button). Stored in localStorage key `zxm8_lateTiming`.

## Scanline Rendering and Double-Buffer Design

**Scanline rendering timing**: Scanlines are rendered at **line END** (`(line+1) * tstatesPerLine`), not at paper start. This is critical for Nirvana-style multicolor engines that write attributes "racing the beam" -- the CPU must have executed past the entire line so all attribute writes are recorded in `attrChanges` before the T-state lookup resolves them per-column. Paper-start rendering breaks multicolor because `renderScanline` fires before the CPU has written the beam-racing attributes.

**Double-buffer screen bank handling** (128K games using banks 5/7):
- `attrInitial` (768-byte attribute snapshot) is captured at frame start from the current screen bank. When the game swaps screen banks via port $7FFD bit 3, `setScreenBankAt()` re-captures `attrInitial` from the **new** display bank and clears `attrChanges`. Without this, `renderScanline` reads pixels from the new bank but uses attributes from the old bank, causing flickering (e.g. the game "Shadow Fields").
- `onMemWrite` attribute tracking ($5800-$5AFF) is guarded by `memory.screenBank === 5` on Pentagon (no contention). Writes to $5800 always go to RAM bank 5 (slot 1 is always bank 5). When bank 7 is displayed, $5800 writes affect the invisible back buffer and must not pollute `attrChanges` for the displayed bank. On 128K (contended), the guard is omitted — all $5800-$5AFF writes are tracked since only bank 5 can be written via those addresses.
- These two invariants must be maintained: **(1)** `attrInitial` always reflects the currently displayed screen bank, **(2)** `attrChanges` only tracks writes to the displayed bank's attributes.

## Screen Bank Switching Effects

Three distinct screen bank usage patterns exist, each requiring different rendering strategies:

### 1. Double-buffering (e.g. Shadow Fields)
One bank swap per frame. Normal scanline rendering handles this — `deferPaperRendering` is `false` when `previousScreenBankChangeCount <= 2`. `setScreenBankAt()` re-captures `attrInitial` from the new bank and clears `attrChanges` so post-swap lines use the correct attributes.

### 2. Scroll17 / screen multiplexing
Rapid bank alternation within a single frame (dozens to hundreds of switches per frame). Combines pixel/attribute data from both banks to achieve per-column independent scrolling.

- **Triggering**: `deferPaperRendering = true` when `previousScreenBankChangeCount > 2` (previous frame had many switches).
- **Rendering**: `renderScanline()` skips paper when `deferPaperRendering` is true. At end-of-frame, `renderDeferredPaper()` renders all 192 paper lines using per-column bank selection — for each column (4 T-states = 8 pixels), `screenBankChanges` timestamps determine which bank's pixel and attribute data to use.
- **Bank data is stable**: Scroll17 does not modify bank contents mid-frame — it only switches which bank the ULA reads. End-of-frame reading is correct because bank contents haven't changed.

### 3. Per-scanline bank switching with mid-frame writes (e.g. Eye Ache demo)
Alternates screen bank every scanline (~192 switches per frame) AND writes attribute data to both banks via $C000 mapping. The demo pages bank 7 at $C000 and writes attributes to $D800-$DAFF (bank 7's attribute area), then switches to bank 5 and writes to bank 5's attributes at $D800-$DAFF via the other bank mapping.

- **Problem with pure deferred rendering**: `renderDeferredPaper()` reads bank contents at end-of-frame. By then, both banks have been overwritten with the next frame's attribute data, producing corrupted output.
- **Solution — render-before-switch catch-up** (`_renderCatchUpPaper`): At each bank switch, paper lines whose entire paper area (128T) falls before the switch point are rendered immediately using the OLD bank's current RAM content, before the switch is applied. These lines are added to `_bankSwitchRenderedLines` and skipped by `renderDeferredPaper()`.
- **Mid-line guard**: A line is only caught up if `paperEndTstate <= curTState` (the full 128T paper area completes before the switch). If the switch happens mid-line (`paperEndTstate > curTState`), the line is left for `renderDeferredPaper()` to handle per-column. This preserves scroll17's per-column bank selection for lines with multiple mid-line switches.
- **Tracking**: `_catchUpNextY` provides progressive scanning (avoids rescanning from line 0 on each switch). `_bankSwitchRenderedLines` (a Set) and `_catchUpNextY` are cleared at each `startFrame()`.

### Pentagon M-cycle Tracking for Multicolor Effects (`spectrum.js`)

Pentagon, Pentagon 1024, and Scorpion have no memory contention, but multicolor effects (e.g. Eye Ache) still need cycle-accurate attribute write timestamps. The `setupContention()` method installs the same M-cycle offset framework used by contended machines, but without adding contention delays:

- `cpu.contend()` tracks 4T (M1 fetch) or 3T (subsequent access) per call
- `cpu.internalCycles()` / `cpu.contendInternal()` track internal CPU cycles
- `cpu.execute()`, `cpu.incR()`, `cpu.interrupt()`, `cpu.nmi()` are wrapped to reset/initialize `mcycleOffset` at instruction boundaries
- **Write timestamp**: `cpu.tStates + mcycleOffset - 3` — the `-3` accounts for the write cycle's own 3T already counted by `contend()`. The ULA sees the new attribute value at the START of the write cycle, not the end. This matches JSSpeccy3's model where `updateFramebuffer()` runs before `t += 3` in `writeMem()`.
