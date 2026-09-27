# Rendering: Audio, Scanline Rendering, Double-Buffer Design

## Audio (`spectrum.js`)

Audio output uses `AudioWorklet` when available (secure contexts: HTTPS or localhost), with automatic fallback to `ScriptProcessorNode` for plain HTTP deployments.

- **AudioWorklet path**: `audio-processor.js` runs a `ZXAudioProcessor` worklet with an 8192-sample ring buffer. Main thread sends samples via `workletNode.port.postMessage({left, right})`.
- **ScriptProcessorNode fallback**: `_initScriptProcessor()` creates a `ScriptProcessorNode` with identical ring-buffer logic inline. Activated when `this.context.audioWorklet` is undefined.
- **`flushSamples()`**: Routes sample data to whichever output is active (postMessage for worklet, `_scriptWrite()` closure for ScriptProcessor).
- **`processFrame()`**: Generates per-frame audio samples from beeper changes, tape audio, and AY chip state. Guard checks for either `workletNode` or `scriptNode`.
- **AY register-write replay**: AY writes during the frame are applied immediately (so register readback / AY detection see them) *and* recorded with their frame-relative T-state in `ayChanges`. At frame start the chip is snapshotted (`ayStateSnapshot`); `processFrame()` restores that snapshot and replays each write at its T-state across the sample loop (`AY.setRegisterForReplay()`, which skips PSG logging). Without this, the whole frame would render with the final register values — destroying digitized speech that drives R8–R10 as a DAC (Robocop, Chase H.Q.). Ordinary AY music is unaffected.
- **Volume/mute**: Controlled via shared `gainNode` -- works identically on both paths.
- **Late Timings**: ULA timing checkbox in Settings -> Machines (near Load ROMs button). Applies 1T shift for warmed Ferranti ULA. Only affects 48K/128K/+2/+2A/+3 — Pentagon uses a non-Ferranti ULA with no early/late drift. Stored in localStorage key `zxm8_lateTiming`.
- **Pentagon Attr Prefetch**: Checkbox in Settings -> Machines. When enabled, shifts the ULA attribute read point 5T earlier (`pentagonAttrOffset = -5`) for Pentagon/Pentagon 1024/Scorpion machines, matching the multicolor behavior of ZXMAK2, Spectaculator, and SpecEmu. Default (off) matches Unreal Speccy and FUSE. Stored in localStorage key `zxm8_pentagonPrefetch`. Fine-tunable via console: `spectrum.setPentagonAttrOffset(n)`.

## One character cell (`core/ula-blit.js`)

Every rendering path ends at the same place: an attribute byte picks two colours,
a pixel byte picks which of the two each of eight pixels gets. `core/ula.js` used
to write that out **seven** times — in `_renderCatchUpPaper`, both paths of
`renderScanline`, both paths of `renderPaperLine`, `renderDeferredPaper` and
`renderFrame` — each with its own ULAplus branch, its own flash swap, its own
BRIGHT handling, its own eight writes and its own call into the ink-skew filter.

That is where every rendering feature lands. ULA snow, the Ferranti ink edge skew
and PAL composite each had to be threaded through all seven, and a copy that missed
one would give a bug visible on one rendering path only — the same shape as the
`runFrame` vs `runFrameHeadless` HALT disagreement that has its own test suite.

```js
const cellCtx = cellContext(fb32, pal32, ulaPlusActive ? ulaPal32 : null, flashActive, inkSkew);
for (let col = 0; col < 32; col++) {
    prevInkBit = renderCell(cellCtx, rowOffset + (col << 3),
        screenRam[pixelAddr + col], screenRam[attrAddr + col], prevInkBit);
}
```

Two things worth knowing:

- **A null `ulaPal32` is what "ULAplus off" means.** The presence of the array is
  the flag, so there is no second boolean to fall out of step with it. Which
  ULAplus palette applies is the *caller's* question — the live one, a per-scanline
  one rebuilt for a raster effect, or a per-group one for HAM256 — and it is
  resolved before the loop, not re-tested per column as one copy used to.
- **`prevInkBit` is handed straight back when there is no skew**, exactly as
  `if (inkSkew) prevInkBit = ...` left the caller's local alone. Nothing reads it in
  that case, but returning the real last bit instead would be a silent difference.

This is the hot path, so the cost was measured rather than assumed: against the
loop written inline, on a synthetic 192×256 screen, 3000 iterations × 8 rounds with
the order alternated (timings drift downward through a run, so a fixed A-then-B
order flatters B), the call comes out at **−1.2%** plain and **−4.2%** with ULAplus
— nothing outside the noise; V8 inlines it — with identical pixels from both forms.

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
- **Attribute read timing** (`ula.js`): For each column, the ULA compares the write timestamp against `colTstate = paperStartTstate + col*4 + prefetchOffset`. The `prefetchOffset` is `pentagonAttrOffset` (default 0) for Pentagon machines, 0 for others. When "Pentagon Attr Prefetch" is enabled, `prefetchOffset = -5`, modeling the real ULA's attribute prefetch where data is read before the corresponding pixels are output. The 5T offset accounts for: 3T paper start difference (ZXMAK2 `c_ulaFirstPaperTact=65` vs M8XXX's 68), 1T from M1 fetch cycle tracking (`incR` wrapper sets `isFirstAccess=true`), and 1T from the ULA prefetch itself.

## ULA Snow (Settings -> Machines -> "ULA Snow", off by default)

**The fault, on real hardware.** During the second half of an M1 cycle the Z80 puts
the refresh address on the bus - `R` on the low byte, **`I` on the high byte** - and
pulls `MREQ`. The ULA watches `MREQ` alone: it checks neither `RD`/`WR` nor `RFSH`.
So with `I` pointing into contended RAM the refresh looks like a memory access
landing on top of the ULA's own display fetch.

**What the collision does** (Weiv, [Exact emulation of the Snow effect](https://hype.retroscene.org/blog/1089.html),
the research behind the `Snow*` programs in the
[ZX Spectrum test collection](https://github.com/redcode/ZXSpectrum/wiki/Tests)) -
decided by where the M1's **4th T-state** falls in the ULA's 8-T-state, 16-pixel
cycle, which outputs two character cells (pixels1/attr1, then pixels2/attr2):

| M1 T4 lands on | Outcome |
|---|---|
| the cycle's **3rd** T-state | **Snow** - bits 6..0 of the address the ULA is putting on the bus are replaced by bits 6..0 of `R`. It still reads the display file, but the wrong place in it, which is why snow is made of fragments of the picture. Both the pixel and the attribute byte of that cell come from the corrupted address. |
| the cycle's **5th** T-state | **Double** - the ULA never gets to read the second cell of the pair, and shows the first cell's bytes again. |
| any of the other six | nothing |

`I` values that trigger it: `$40-$7F` on 16/48/128/+2; on a 128K also `$C0-$FF`,
but only while an odd (contended) page sits at `$C000`. Never on a Pentagon, which
has no contended memory.

**How it is implemented.** The rules need the T-state of every M1's 4th cycle, so
`cpu.incR()` - the exact point at which a refresh happens, covering prefixes and
interrupt acknowledge - records `(T-state, R)` into `ula.m1Log`. That log is
attached only while the effect is on; otherwise `incR()` costs one null check.
`core/ula-snow.js` is pure and applies the two rules; `ula._displayRam(screen, line)`
returns the corrupted display file, and all three render paths take their bytes from
it, so snow cannot be drawn by one and missed by another.

Snow is applied **per scanline, as the beam reaches it** - the log only holds the
refreshes that have happened by then, which is the whole point of the effect. (An
earlier version built the whole frame at the first display fetch; that used the
wrong information for every line but the first.)

**Calibration.** Two constants pin our model against the real thing:
`M1_T4_FROM_FETCH` (the phase of our T-state counter against the ULA's 8-T cycle)
and `R_ON_BUS` (whether the bus carries `R` before or after the Z80 increments it).
A one-T-state or one-count error in either shifts the pattern without changing its
character, so the implementation follows the documented rules but is **not proven
exact until it is compared against the `Snow*` test programs** on real-hardware
reference screens. Tests: `tests/snow-test.html`.

## ULA ink/paper edge skew

The Ferranti ULA does not switch symmetrically between ink and paper: the
transition **into** ink lags the transition back to paper, so an ink pixel comes
out slightly narrower than a paper one. Only a pixel that *starts* an ink run pays
for it — a long run loses a sliver of its left edge and nothing else — so ordinary
graphics are essentially unchanged. A one-pixel checkerboard is the pathological
case, because there every ink pixel is a leading edge:

```
the same pattern, white as INK   -> (1 - skew) / 2 lit
the same pattern, white as PAPER -> (1 + skew) / 2 lit
```

Two encodings that a pixel-exact renderer cannot tell apart therefore differ in
brightness on hardware, by exactly `skew`. This is the whole content of the
**Bright Miner** test: it paints Miner Willy as `$AA` cells with attribute `$07`
(ink 7 / paper 0) against `$55` cells with attribute `$38` (ink 0 / paper 7) — an
inverted bitmap *and* an exact ink/paper swap, which cancel to a bit-for-bit
identical pixel stream. On a pixel-exact emulator the screen is uniform grey; with
the skew, Willy appears, and appears *brighter* than the background because his
cells carry the white as paper.

Which machines: the same split as [ULA snow](#ula-snow) — `48k`, `128k`, `+2` do
it, the +2A/+3 (Amstrad 40077 gate array) and the Pentagon/Scorpion clones do not.
It is a machine trait, driven by `ulaInkSkew` in the profile, not a display filter;
SpecEmu makes the same distinction, which is what identifies it as modelled
hardware rather than a post-process.

**How it is implemented.** `core/ula-inkskew.js` is pure. `leadingInkMask(byte,
prevInkBit)` picks the run-starting pixels (bit 7 is the leftmost, so a pixel's
left neighbour is the bit above it, and bit 7's comes from the previous cell);
`applyInkSkew` re-tints just those, *after* the cell's eight pixels have been
stored, and returns the carry bit for the next column. All seven paper-render sites
in `core/ula.js` call it behind `if (inkSkew)`, so a machine that doesn't skew
costs one test per cell. `ula.setInkSkew(x)` overrides the profile value at runtime
(`null` restores it, `0` switches it off); the Settings → Machines checkbox is on by
default, unlike snow, because this is what the part does all the time rather than a
fault to go looking for. Tests: `tests/inkskew-test.html`.

**Measured against hardware.** A capture of a real UK +2 running the test was
sampled: the figure's torso sat **4.7 luminance units above the background on a
0-170 black-to-white range**, and three background samples (left, right, above)
agreed within 0.4. The brighter region is the paper-white one, as the model predicts.
That puts the skew at **~0.03 of a pixel**, which is what the profiles ship.

It is a subtle effect: an emulator showing an obvious figure is overstating it, and
SpecEmu's contrast implies roughly 0.25 — about 8x too strong — so do not calibrate
against it. Caveats on the figure: camera, TV, video compression and display gamma all
sit between the ULA and that measurement, and gamma tends to expand a mid-grey
difference, so the true value may be smaller still. We blend in the same encoded byte
space the display uses, so matching the encoded delta is the right target.

## PAL composite (RF) simulation (Settings -> Machines -> "PAL Composite (RF)", off by default)

A Spectrum plugged into a TV hands it **one wire** carrying luminance and the
colour subcarrier together, and the set can only separate them by filtering. Fine
luminance detail whose frequency lands in the chroma band is therefore demodulated
as colour. Normally that is a nuisance (cross-colour, dot crawl); a program that
chooses its dither deliberately can use it as an extra palette. Nothing here is a
"filter" in the cosmetic sense — it is what the display actually does, and it is
the only way some software was ever meant to be seen.

### The clock relationship

On a 128K/+2/+2A/+3 the master clock is **17.734475 MHz — exactly 4x the PAL
subcarrier** (4.43361875 MHz) — and the pixel clock is that divided by 2.5:

```
f_subcarrier / f_pixel = 4.43361875 / 7.09379 = 5/8      exactly
```

Eight pixels are five subcarrier cycles. So **one bitmap byte is a whole number of
cycles**, every character column starts at the same phase, every line does too
(456 pixels = 285 cycles) and so does every frame. Artifact colour on those machines
therefore stands still and is byte-aligned, and the artifact chroma of a byte is
bin 5 (equivalently bin 3) of its 8-point luminance DFT.

The 48K is a 14 MHz machine with a **separate free-running subcarrier oscillator**.
Nothing is locked — that is its notorious dot crawl, which Sinclair knew about
before release and fixed on the 128K. Its artifact hue drifts along the line and
between frames instead of standing still. The Pentagon and Scorpion clones are
14 MHz machines too. The profile field is `ulaSubcarrierLock`, in the spirit of
`hasSnow` and `ulaInkSkew`.

### Chromatrons Attack

*Chromatrons Attack* (Guesser / Gasman, CSSCGC 2013) is built entirely on this, and
is the reason the feature exists: it is "perfectly visible on real machines but
nearly invisible on emulators". Its playfield is bytes **`$A5` and `$5A`** under one
attribute (`$78` — bright white paper, black ink). Both are 50 % dither, so a
pixel-exact renderer draws the same flat grey; but all of their AC energy sits in
DFT bin 5, i.e. *on* the subcarrier, and they are 180 degrees apart, so a TV turns
them into two complementary colours. A plain `$AA`/`$55` checkerboard would land in
bin 4 (Nyquist, 3.55 MHz) and produce nothing — which is why the superficially
similar [Bright Miner](#ula-inkpaper-edge-skew) test needed an entirely different
explanation.

The dither is also **inverted on every scanline** (4793 of 6112 adjacent byte pairs
in a screen dump are exact complements). That flips the artifact phasor 180 degrees
per line, so the receiver's PAL delay line cancels U and passes V — a magenta/green
axis with the **blue channel untouched**. The hardware photograph published with the
game shows exactly that: magenta (185, 91, 121) against green (57, 157, 121), the
same blue to within one count. A dither that is *identical* on consecutive lines
gets the opposite treatment: V cancels, U survives, and the colours run
blue/yellow instead — which is what the game's credit line does.

### Model

`core/pal-composite.js` is pure and DOM-free. The chain per line is the honest one:

1. RGB -> Y/U/V.
2. Encode to composite at **5 samples per pixel**, which puts exactly 8 samples in
   a subcarrier cycle on a locked machine: `c = Y + U sin(wt) +- V cos(wt)`, the
   sign being the PAL V-switch, alternating per display line.
3. Decode: notch the luminance, quadrature-demodulate U and V, low-pass both. The
   notch and the chroma low-pass are the same centred 9-tap boxcar over 8 samples —
   exactly one subcarrier cycle, so it is a perfect null at the subcarrier and every
   harmonic, and symmetric, so it adds no group delay. Chroma gets it twice, which
   also lands the chroma bandwidth near the ~1.3 MHz a PAL receiver uses.
4. PAL delay line: average this line's chroma with the previous line's.
5. Y/U/V -> RGB.

That whole chain is **linear**, and on a locked machine **periodic in 8 pixels**, so
it collapses without approximation into a per-pixel 3x3 FIR whose coefficients
depend only on the subcarrier phase at that pixel and the line parity. `buildKernel`
derives those coefficients from the sample-level chain **by impulse response**, so
the fast path is literally the slow path — there is no second implementation to
drift. The chroma filter reaches 8 samples either side of sample `5x+2`, i.e. pixels
`x-2 .. x+2`, so `KERNEL_HALF = 2` is exact rather than a truncation.

Only 8 of the 32 phase slots are reachable on a locked machine, and only those are
derived (~17 ms at enable time rather than ~60). The unlocked machines need the
fine grid because their phase creeps ~3 degrees a pixel.

### Cost, and where it runs

It is applied once to the finished frame, from `ULA.endFrame()` / `renderFrame()`,
so every consumer — canvas, screenshot, application test, video export — sees the
same picture. Roughly **9 ms per frame** on a full 352x311 display with the whole
paper area dithered; a row of one colour under a row of the same colour is skipped
wholesale (one word compare per pixel instead of an unpack), which makes the border
nearly free. That is why the toggle is **off by default**: it is real work every
frame, and it is only the truth for a machine plugged into a TV. Someone using the
RGB/SCART output sees the clean picture we draw without it.

### Calibration and knobs

`burstPhase` (the subcarrier phase at the left edge, default **180 degrees**) is the
one fitted constant, calibrated against the published hardware photograph: at 180
the game's two fields come out magenta and green, in the layout the photo shows, and
the simulated field colours land within a few counts of the measured ones —
(189, 90, 127) and (66, 163, 127) against (185, 91, 121) and (57, 157, 121) — with
`saturation` left at 1, i.e. **no fudge factor**. `ula.configurePalComposite({...})`
reaches `burstPhase`, `saturation`, `notch` (1 = full luma notch, below 1 leaves
visible dither texture) and `delayLine` (false models a receiver without one, which
gets Hanover bars instead of clean cancellation).

**Reproducibility on an unlocked machine.** The phase creeps a little every frame
there — that *is* dot crawl — so the picture depends on how long the filter has been
running. `setPalComposite(true)` and `ULA.reset()` both re-seed it, which is what
makes a fixed-frame Pentagon screenshot comparable at all: without that, the same
test passes or fails according to whether the machine was switched beforehand (a
machine switch rebuilds the ULA and so used to reset it by accident).

Tests: `tests/pal-test.html` for the module, plus two application tests running the
same tape with `"palComposite": true` — each in two steps, the title screen and, after
a CAPS SHIFT, gameplay. `chromatrons` on a **128K** is the positive case (readable
magenta/green); `chromatrons-pentagon` is the control, where the unlocked subcarrier
turns the same screen into drifting colour speckle. Like the Bright Miner pair, the
point is that one machine must show it and the other must not — a single screenshot
cannot tell "modelled correctly" from "unconditionally on".

### Other colour systems, for future clone profiles

The mechanism is not PAL-specific. Any composite system that carries colour as a
phase against a per-line burst shows it, and NTSC and the PAL variants differ in the
numbers rather than the principle. What decides whether a given dither byte produces
colour at all is the ratio **f_subcarrier / f_pixel**, so the same byte is not
equally useful on every machine:

| system | f_subcarrier | vertical | note |
|---|---|---|---|
| PAL-I (UK Spectrum) | 4.43361875 MHz | 50 Hz | ratio 5/8 on the locked 128K family; `$A5`/`$5A` carry, `$AA`/`$55` do not |
| PAL-M (Brazil, e.g. TK90X) | 3.575611 MHz | 60 Hz | see below |

PAL-M is the interesting one, because it is **not** a small variation. At a 7 MHz
pixel clock Nyquist is 3.5 MHz — only about 75 kHz below that subcarrier — so the
good and bad dither bytes swap round: a plain `$AA`/`$55` checkerboard lands
essentially *on* the burst, where on a UK machine it produces nothing. A TK90X shows
correct colour only on a PAL-M set; horizontal and vertical sync differ too, and the
ULAs are not always pin-compatible. (Frequencies from a community remark by Pericles
Vicente; they match the published standards.)

One caveat when reading descriptions of this elsewhere. PAL is often summarised as
"NTSC with the colour phase inverted 180 degrees every line", which is true of the
*encoder* and silently drops the receiver's **delay line** — and the delay line is
exactly what limits PAL's artifact palette. For a pattern that is identical on
consecutive lines it cancels the artifact's V outright, leaving one axis instead of
NTSC's full hue circle; that is why an emulator that models the encoder alone would
predict colours PAL never shows. `delayLine: false` is the NTSC-style decoder.
