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
- `onMemWrite` attribute tracking ($5800-$5AFF) is guarded by `memory.screenBank === 5`. Writes to $5800 always go to RAM bank 5 (slot 1 is always bank 5). When bank 7 is displayed, $5800 writes affect the invisible back buffer and must not pollute `attrChanges` for the displayed bank.
- These two invariants must be maintained: **(1)** `attrInitial` always reflects the currently displayed screen bank, **(2)** `attrChanges` only tracks writes to the displayed bank's attributes.
