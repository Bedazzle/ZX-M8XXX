# Test suites: what each one covers

Run everything with `python run-tests.py`. This file is the per-suite detail;
CLAUDE.md lists the suites and the command.

## Running the application tests headlessly

`run-tests.py` runs `tests/*-test.html` and says nothing about the pictures. The
application tests (`tests/tests.json`) are the screen tests — real games and demos
run for N frames and compared with a reference PNG — and they are where a timing
change actually shows. `python run-app-tests.py` runs them without a human in
Tools → Tests:

```
python run-app-tests.py                  # everything enabled in tests.json
python run-app-tests.py aquaplane 48k    # substrings: id, name, machine, category
python run-app-tests.py --list
python run-app-tests.py --json out.json  # the full result, with per-test diff counts
```

It serves the tree with `serve.py` (the documented harness server — ES-module MIME
types, no-cache, and the POST endpoints `zxDebug.report()` uses), opens
`tools/app-tests-harness.html` in headless Edge/Chrome, and polls
`headless/apptests.json` while the run goes. **It needs `roms/` and the media in
`tests/`**, neither of which is in git.

**Read a result by running it twice** — once with the change, once against
`git show HEAD:core/<file>.js` — and diff the two. A screen test that was already
failing for an unrelated reason looks exactly like one the change broke, and the
only way to tell them apart is the control run. The first time this was used, 20 of
29 "failures" were the harness itself.

Two traps found building it, both worth knowing before touching the harness:

- **Call `runTests()`, never `runSingleTest()` in a loop of your own.**
  `runFramesWithAbortCheck()` returns immediately unless `TestRunner.running` is set,
  and only `runTests()` sets it. Driving the tests one at a time therefore runs *zero
  frames*: snapshots still load (they are instant) and every tape and disk silently
  loads nothing, then the test compares a bare ROM screen against the reference. It
  does not look like a harness bug — it looks like 20 broken screen tests.
- **The page starts the machine by itself** once the last ROM lands. A driver that
  begins before that has its run reset from under it, so the harness waits for
  `spectrum.running` after `zxDebug.ready()`.

**Open harness bug — `systest_1.01r`.** It passes in Tools → Tests, both on its own
and in the batch, and fails here. The emulator is not involved: the result is
identical with and without every change made to `core/z80.js` and `core/spectrum.js`.
Two symptoms, which is the useful part of the clue:

- **in a batch** it completes but is *behind* — at frame 102 it still shows the
  program's title screen where the reference already shows the finished results;
- **on its own** the run never returns at all.

What it is not: not Pentagon (`p128` passes alone), not TR-DOS or `.scl` (
`global_test_1.0b` is also Pentagon + TRD + a quoted filename and passes alone), and
not the first machine switch. What is unique to this entry is that its `diskRun` is
`"TEST PC"` — **the only one whose filename contains a space** — and that the space
is typed by `pressKey(' ')` in `injectDiskRunCommand`. Start there.

**`--shots <dir>` writes what each failing test actually drew**, next to the
reference for *the step that failed*, with an `index.html` putting the two side by
side. Use it before calling anything a regression. Two cases from the first real use
make the point: chromatrons' 41.9% diff was the 128K artifact colours going from
**inverted to correct** — the magenta and green regions simply swapped, and the
committed reference was the wrong one — while academy's 8 pixels were one scanline's
border starting 4T later, which no number distinguishes from noise. A big diff is as
likely to be a fix as a break; regenerate a reference only once the picture has been
checked against hardware or a known-good screenshot.

## `tests/asm-test.html`

Z80 assembler test suite — instructions, directives, expressions, macros, built-in editor
snippets (`data/asm-snippets.json`), and the **line map** (`lineMap`): one entry per line
that emitted, the parser's comment rather than a `;`-split of the raw line, settled
addresses, per-expansion entries for `DUP` and macro bodies with their nesting `depth`, and
that a second **async** build does not keep the first one's lines. `runDollarOperatorTests`
covers the sjasmplus address/page operators — `$$$`/`$$$$`, the three sigil-plus-label
forms and `{x}`/`{b x}`. It also pins the **v1.0.0 change to bare `$$`** (the last `ORG`
before it, the page of `$` now), including that it agrees with `$$lab` at the same address
and that the old `$-$$` block offset errors rather than returning a plausible small number.

Two asserts in that group were written **vacuous**, and both are easy to write again:
`db {b addr}` is indistinguishable from `db {addr}`, because a `DB` cuts the word down to
the same byte the byte read returns — the size only shows in a `DW`. And `$$$$` proves
nothing unless the displaced address and the physical one sit in slots holding **different
pages**; `org $8000 / page 2 / disp $C000` puts page 2 on both sides. Both were found by
breaking the implementation on purpose and seeing which asserts stayed green, which is the
check worth repeating when adding to this group.

**This suite reports green when it aborts.** `runAllTests` awaits each group with no
`catch`, so an exception out of one stops the run and everything after it silently never
executes — while the runner still says "all green", because nothing *failed*. It sat like
that at the TAPEND test, which expected a return value from something that reports by
throwing (fixed: it uses `tryAsm`). If a group you added seems to contribute no asserts,
this is why: check the pass count actually rose.

## `tests/asm-line-test.html`

One-line assembler tests (`core/asm-line.js`) — the operand forms, undocumented opcodes, expressions, `$`, labels as operands and a label defined on the line, the data directives and the refusal of the source-file ones, and every way bad input is turned down (unknown mnemonic, missing operand, undefined label named in the message, a JR out of range, two instructions in one row). The sharp one is a **round trip**: 35 byte sequences are disassembled and the text fed straight back, which is what pressing Enter on an unchanged row does — it is what catches the `FFh`/`0FFh` fix-up. Then the size rule (`NOP` over two bytes is `DD 00`, `LD A,5` is *not* padded to three, no three-byte NOP is invented) with the chosen encodings **run on the real Z80**, since they are only safe if the CPU agrees with the disassembler. Finally that the ASM panel's dialect switches and collected errors survive an edit

## `tests/disasm-asm-edit-test.html`

Editing an instruction in a disassembly row, driven in the real app: double-click the mnemonic, type, Enter. The box opens on the right row holding the row's own text (and Enter unchanged writes the same bytes back), a same-length instruction leaves the rows around it alone, a shorter one leaves the old bytes showing as rows of their own, a longer one eats the next instruction and the rows say so, `NOP` over two bytes goes in as the two-byte encoding, a refusal keeps the box open and memory untouched, Esc cancels, labels resolve and one written on the row is kept, one edit is one Ctrl+Z, the right panel and the context menu both do it, and a refresh cannot throw the box away mid-word

## `tests/asm-highlight-test.html`

ASM highlighter tests — token classes, markup safety/round-trip, cached vs uncached equality across edits/inserts/deletes, cache bounding, codepage view

## `tests/lua-test.html`

LUA scripting tests — pass filters, code emission via `_pc`/`_pl`, reading the assembler (`_c`, labels, defines), one state across three passes, LUA inside macros (incl. argument substitution and nesting), error reporting, and the sjasmplus `BasicLib` example compared byte-for-byte against sjasmplus 1.21.1 output (fixtures in `tests/lua/`)

## `tests/beautify-test.html`

ASM beautify tests — each transform in isolation (incl. hex↔dec base conversion + its temp-label/`$`/modulo safety), string/comment protection, idempotency, end-to-end assemble

## `tests/convert-test.html`

Foreign source import tests — Hobeta parsing, format detection, ALASM/TASM/STORM/ADS detokenizers, dialect converter rules (ALASM/TASM/ADS/STORM/GENS/Zeus/Pasmo — incl. the full STORM ruleset: register halves, `_` prefix, two-address ORG, bitwise operator remap, `[`/`]` byte selectors, multi-operand expansion), end-to-end detokenize→convert→assemble

## `tests/import-test.html`

Import Foreign dialog tests — synthetic TRD/SCL/ZIP/Hobeta fixtures driven through the real dialog (catalog listing, disk-in-ZIP expansion, multi-disk chooser, GENS auto-suggestion, format override, addProjectFiles payload)

## `tests/halt-int-test.html`

HALT + interrupt tests — a frame-start INT landing on a not-yet-executed HALT enters the halt state first so the handler returns to PC+1 (snapshot resume on an EI/HALT main loop, e.g. Shock megademo). Also that both steppers generate no audio while `audioSuppressed` is set, even with an enabled audio object — what keeps the application tests silent

## Timing Test (application tests)

**Patrik Rak**'s Timing Test (based on **Jan Bobrowski**'s zxtests, GPL) is a menu of
nine sub-tests; each draws a 20x8 grid of how long one instruction takes at each
T-state across the contention boundary. The menu choice is the entry's `keys`, so each
sub-test is its own row in `tests.json`:

| entry | keys | what it times |
|:--|:--|:--|
| `timingtest-48k` / `-128k` | `0,ENTER` | contended NOP -- the plain wait pattern |
| `timingtest-snow-*` | `1,ENTER` | NOP with `I` = `#7F`, so the refresh address is in the screen |
| `timingtest-00fe-*` | `2,ENTER` | `IN #00FE` -- high byte clear, ULA port: N:1,C:3 |
| `timingtest-00ff-*` | `3,ENTER` | `IN #00FF` -- high byte clear, other port: N:4, never waits |
| `timingtest-7ffe-*` | `4,ENTER` | `IN #7FFE` -- high byte contended, ULA port: C:1,C:3 |
| `timingtest-7fff-*` | `5,ENTER` | `IN #7FFF` -- high byte contended, other port: C:1 x4 |
| `timingtest-fffe-*` | `6,ENTER` | `IN #FFFE` -- as 00FE, through the keyboard port |
| `timingtest-ffff-*` | `7,ENTER` | `IN #FFFF` -- as 00FF |

Each on 48K and 128K, 16 entries. Sub-tests 2-7 are the **four port-contention
patterns**, which is the part of v26.09.04 that only ctprobe had checked. Menu entry 8
("128k page RET") is not included: it needs a page chosen through a separate prompt.

**Why it is here even though ctprobe covers the same ground.** ctprobe *reuses this
program's measuring engine*, so the two are not independent instruments. What is
independent is the reference: Rak's results were photographed on real 48K, 128K, +2A
and +3 machines. The documented hardware condition is that on a 48K with early timing
row `14328` reads `4 4 4 4 4 4 4 4` and row `14336` starts with `10` -- if `10` appears
at the END of row 14328 instead, the machine runs one tick off relative to the
interrupt. We satisfy both, and the 128K's first contended value lands at 14361, its
documented onset.

## ctprobe (application tests)

`ctprobe-48k`, `ctprobe-128k` and `ctprobe-pentagon` run **unreal-ng**'s contention
probe and compare its own report screen. It is the only instrument here that sees
**where inside an instruction** a memory wait falls: it times fragments at every
start tick around the contention boundary against an oracle built from the published
wait patterns and FUSE's cycle tables.

It ships as `tests/ctprobe.zip`, like every other test medium here, with its
sources, licence and credits in the same archive (`CREDITS.md`, GPL v3 - engine
by Jan Bobrowski, adjusted by Patrik Rak). Nothing needs unpacking by hand:
`run-ctprobe.py --tap` defaults to that zip and reads the `.tap` straight out of
it, and `--dump-dir` drops the breakdown script beside the dumps it writes.

Each entry is **~80-100s**, so the three together roughly double the application
suite. Worth it: they are what caught every fault fixed in v26.09.04.

The reference screens carry the probe's own verdict, which makes a regression
self-describing:

| entry | reference says |
|:--|:--|
| `ctprobe-48k` | green border, ALL VALUES AS EXPECTED |
| `ctprobe-pentagon` | green border, ALL VALUES AS EXPECTED |
| `ctprobe-scorpion` | green border, *attr bus, Even M1*, ALL VALUES AS EXPECTED |
| `ctprobe-128k` | red border, `P-05B`/`P-05D BAD`, 28 VALUES WRONG |

**The 128K reference pins a known disagreement on purpose.** P-05 is the rule that a
port whose high byte points at a contended page at `$C000` waits like contended
memory; the probe's own README calls it **not yet confirmed on real hardware** and the
emulators split on it. Do not "fix" it to make the screen green without evidence - and
if it is ever settled, re-baseline deliberately and say so.

For the **number** rather than a screen, and for a per-check breakdown:

```
python run-ctprobe.py 48k 128k pentagon
python run-ctprobe.py 48k --dump-dir out
python out/ctprobe-compare.py out/48k.bin
```

## Floating-bus tests (application tests)

`float48k` and `float128k` are **Mark Woodmass**'s floating-bus tests (2008), from
the machine-level catalogue at <https://github.com/redcode/ZXSpectrum/wiki/Tests>
(the sibling of the better-known CPU one, and where contention / floating-bus /
snow tests live). Each prints a table of frame T-state against the byte an unmapped
port reads, so a wrong sample point is legible on the screen rather than hidden in a
pixel count: before the fix the 48K showed `255` until tick 14350 instead of 14338,
and the 128K showed `255` for every tick because it had no floating bus at all.

They are a second opinion, not the primary one. The oracle is ctprobe's P-02
(`run-ctprobe.py`), which gives a number; these say the same thing in a form you can
look at, from an author independent of it. Both were used to fit `IO_CYCLE_READ_T`
and the per-machine `floatStart` in `core/spectrum.js`, and they agree.

## `tests/contention-timing-test.html`

**Where inside an instruction each wait falls.** The pattern, the onset and the M1 fetch
were already right; what was wrong was the placement of the cycles *between* the memory
accesses, which no screen test can see and which `tests/fuse-test.html` does not cover
either (it checks flags and lengths, not which address sits on the bus during an internal
cycle). Found by [ctprobe](https://github.com/alfishe/unreal-ng/tree/master/tools/verification/contention/ctprobe).

The 48K contention model of `core/spectrum.js` is replayed over a bare `Z80`, and every
instruction is checked against FUSE's cycle list walked independently, over every start
tick around the first contended one:

| Instruction | The cycle list it must follow |
|:--|:--|
| `LD r,(IX+d)`, `LD (IX+d),r`, ALU `(IX+d)` | `pc:4,pc+1:4,pc+2:3,pc+2:1x5,ixd:3` — the five internal ticks are on the **displacement's** address, not on `IX+d` |
| `INC/DEC (IX+d)` | the same, then `ixd:3,ixd:1,ixd:3` |
| `LD (IX+d),n` | `pc+2:3,pc+3:3,pc+3:1x2,ixd:3` — the odd one out: two ticks, on the **operand** |
| `RLC (IX+d)`, `BIT b,(IX+d)` | `pc+3:3,pc+3:1x2,ixd:3,ixd:1[,ixd:3]` — on the **fourth byte**, then one after the read |
| `CPI`/`CPD` | `hl:3,hl:1x5`; the repeating forms add another `hl:1x5` |
| `EX (SP),HL/IX/IY` | `sp:3,sp+1:3,sp+1:1,sp+1:3,sp:3,sp:1x2` — and the **high byte is written first** |
| `DD DD DD NOP`, `DD LD A,n` | every prefix is an opcode fetch of its own, four ticks apart |

The prefix rows are a different fault from the rest. The model reads `tStates` as the
instruction's **start** and tracks the position inside it separately, so a prefix that paid
its four ticks into `tStates` immediately was counted twice and every later cycle was looked
up four (then eight) ticks late. `DD DD DD NOP` is what ctprobe checks, but the case that
matters is `DD LD A,n`: a redundant prefix on an ordinary instruction, which is common, and
whose operand read was pushed late by it.

Two things keep it honest. The bare lengths (19, 23, 20, 16, 21, 19 …) are asserted
separately, so a change to *where* a wait lands cannot quietly change *how long* an
instruction takes; and the same instructions are run again in uncontended RAM, where every
one of them must still cost exactly its bare length.

## `tests/disk-boot-test.html`

**The suite that answers "does the disk system actually work".** Everything else can be
green while an interface does nothing at all — that happened three times: the Microdrive's
unit tests asserted our own broken model of the COMMS chain, `OPDLoader` had passing tests
while no Opus controller existed, and the +D soft-reset on boot because of a tape trap no
disk test could see. All three are invisible to a test that pokes our own classes.

The question this suite asks instead is: **can the real ROM put a program on a disk and get
it back after the machine has been wiped?** Each interface does a round trip — `SAVE`, hard
reset, `LOAD`, and the loaded program must run and print its token. Nothing is asserted
about our loaders' idea of the format; if our writer were wrong the ROM would fail to read
it back, which is exactly the Microdrive bug.

- **Opus Discovery**, **Interface 1 / Microdrive** and **Didaktik 80** — the full round trip on
  a blank disk. The Didaktik also checks the file appears in the MDOS catalogue of the image
  itself, not just on screen.
- **+D** — no round trip is possible: its 8K ROM is a bootstrap that needs G+DOS in a `+SYS`
  file, and there is no such disk in the tree. What is pinned down instead is the failure it
  actually had — the machine soft-resetting before the ROM could say anything. Booting a
  disk with no `+SYS` must produce G+DOS's own diagnostic.
- **+3 floppy** — the same round trip through the built-in µPD765. This one had **no
  end-to-end cover at all**: `tests/tests.json` has no `+3` entry, so the FDC and the whole
  +3DOS path were shipped on trust. It works, but nothing proved it until now.
- **TR-DOS** — deliberately not re-tested here. It is the one disk system that already had
  end-to-end cover: `SYSTEM TEST V1.01R`, `Global test v1.0` and `AUMT` in `tests/tests.json`
  boot real TR-DOS software and compare screens.

Adding a disk interface means adding a section here, not just a loader test.

Two things the harness gets wrong if you copy it carelessly:

- **The screen reader must follow `CHARS` (23606)**, not assume the font is at `$3D00` of ROM
  bank 0 — on a 128K-family machine bank 0 is the editor ROM and every glyph comes back `?`.
  In the 128 editor it fails anyway, which is why the +3 section uses a **POKE sentinel** and
  reads the `+3DOS` directory off the image instead of reading the screen.
- **A machine with a startup menu eats typed keys.** Pentagon and +3 come up on the menu, so
  keystrokes select menu entries rather than reaching BASIC. On the +3, menu item 2 is the
  disk-aware BASIC; item 4 is 48 BASIC, which types in keyword mode and silently mangles
  everything. Sections that switch machine go **last**, because the switch rebuilds `Memory`.

## `tests/opus-test.html`

Opus Discovery, driven in the real app because neither of the two things that make this
interface unusual is visible from a unit test of the loader: its FDC and PIA are in the
**memory** map rather than on I/O ports, and its data transfer is driven by an **NMI**.

- **Geometry from the image** — 0-based sectors, 18 × 256, and 184320 → 40 tracks × 1 side
  against 737280 → 80 × 2. Plus a check that the MGT side of the shared `PlusDDisk` is
  unchanged: it still numbers from 1 and wraps after 10.
- **The register window** — the PIA's two read side effects (port A clears its own bit 6,
  the control register always reads bit 6 set), drive on bit 1 and side on bit 4, the
  data/direction gate on control bit 2, the four WD177x registers repeating every 4 bytes
  to the top of `$2FFF`, and `$3800` up reading `$FF`.
- **A sector read and a sector write**, byte for byte against a pattern written into a
  hand-built image — not one produced by our own writer, so the expected bytes are
  independent of the code under test.
- **A debugger read must not drive the controller**: `Memory.peek` on the data register does
  not advance the sector buffer, and on port A does not clear bit 6.
- **DRQ edges** — a command raises one request flagged as the first byte (the one that waits
  longer), and reading a byte asks for the next.
- **The real ROM catalogues a real disk.** This is the section that matters; everything above
  it can pass against a wrong model. An image is built with three named files, the Opus ROM
  is asked for `CAT 1`, and the test checks it issued Restore/Seek/Read Sector **without a
  retry storm** and then printed the disk label and all three filenames.

Note it drives the `Opus Discovery 1 v1.2` ROM for that last part: the v2.x, EXCOM and
QuickDOS ROMs boot fine but take a different command set (see `docs/peripherals.md`). The
`+2A/+3` check is deliberately last, because switching machines rebuilds `Memory`.

## `tests/disk-test.html`

Disk controller tests — BetaDisk (WD1793), PlusDDisk (WD1772), Microdrive (IF1), MGTLoader, MDRLoader, OPDLoader, DidaktikLoader (D40/D80 MDOS read + write: FAT packing, addFile/deleteFile/renameFile/setStartAddr round-trips); TR-DOS/SCL file copy **monoloader** coverage (`ui/disk-file-copy.js`): full-allocation verbatim copy (BASIC + CODE) with catalogue length/start/programLength preserved, normal BASIC/CODE negatives + boundary cases, `splitMonoloader` loader/payload split (lossless reconstruction); **SPECSCII banner** coverage (`core/specscii.js`): stream parse, `isBannerName`, encoder round-trip through `simulateListPrint` (cell-exact, incl. junk-row reset), `buildTRD`/`buildSCL` banner-entry injection + `decodeBannerNames` re-read; `gridToSpecscii`/`bannerNamesToSpecscii` extract round-trip

## `tests/depack-test.html`

ZX0/ZX7 depacker + packed-screen detection tests — round-trips (forward/backward), `detectPackedScreen` variants + entropy guard + size-gate/negatives + output-cap safety, `rcsToScr` inverse, `findDepackerSignature`/`findPackedScreenInBlock` (embedded loader: signature ID + `LD HL` pointer-parse locate), RCS auto-detect by image coherence, and the Hrust depacker (`isHrust`/`hrustDecompress` — base64 fixture round-trip + header guards)

## `tests/pristine-test.html`

Pristine (golden) byte-for-byte comparison: extracts files from a reference disk built by *other* software and asserts they match the `tests/pristine/src/` Hobeta sources. Skips if the disk is absent. See `tests/pristine/README.md`

## `tests/explorer-test.html`

Explorer UI tests — drives the **real** Explorer in an iframe over `index.html` (it is built around the app's DOM, so it can't be unit-tested in isolation): loads synthetic SNA/TAP/TRD/SCL fixtures through the file input and checks the info panels, catalogues, hex dump, and that switching files clears the previous one. Sections are independent, so one failure doesn't abort the run

## `tests/addr-format-test.html`

Address/value/opcode base tests (`core/addr-format.js`), no emulator needed: in hex every
formatter is `hex16`/`hex8` digit for digit, the address column is a fixed 5 characters in
**both** bases (NBSP-padded, so a column sized for hex does not reflow when `65535` replaces
`FFFF`), the three bases move independently, one listener hears all three and a listener that
throws does not stop the others, and `parseAddr` reads back what the user typed — an explicit
`$`/`0x`/`#`/`h` beats the switch, a bare `FFFF` cannot be decimal, and nonsense returns null
rather than 0. Also `specToHex`/`portSpecToHex` (the UI-edge translation that keeps the core
hex-only), `fmtByteCol` (2 characters in hex, 3 in decimal) and `fmtAddrPair` (the
`4660 ($1234)` twin that collapses to one number in decimal).

**There is no `d` suffix and there must not be one.** `004D` is a real address, so a trailing
`d` cannot be told from a hex digit; an early cut of `parseAddr` read `004D` as 4.

## `tests/addr-base-ui-test.html`

The three switches driven in the **real** app (128 asserts). The checkboxes are in
Settings → Display and default to hex; the disassembly, both memory dumps, the registers, the
stack, the trace, POKE and the operand inside an instruction all redraw when one is thrown;
the address column is the same width and the same box in both bases; an address box reads and
writes the base that is on while `$`/`h` still force hex; a breakpoint typed in decimal reaches
the core as hex; the 16-bit registers follow while the 8-bit ones do not; a decimal register
keeps its box width as it counts (so the block does not twitch on every step); and the choice
is remembered. Also the memory dump's four-byte rule, the hints, and the boxes that were
converted last.

Four traps this suite exists to catch, each of which produced a **passing but empty** assert
first:

- **`showTab` must never click an active tab.** That collapses the container, and every width
  assertion then passes at 0px.
- **`.memory-byte` has a hard width**, so both `getBoundingClientRect()` and `scrollWidth` read
  18px whether or not `255` fits. Measure the text with `document.createRange()`.
- **A `border-left` does not widen a `border-box` cell** — it takes the pixel from the digits
  instead, so compare the text against the **content** box, not the border box.
- **A rule drawn per cell is not continuous.** A cell is 16px in a 20px row pitch, so assert
  that consecutive rows' rules touch, not merely that they exist.

## `tests/mapexport-test.html`

Auto-Map export tests (`core/map-export.js`): key parsing, range coalescing (executed=code/read=data, executed-wins), `buildRangesFromBits` (fast-mode bitsets), `buildRangesFromPagedBits` (paged fast: per-page ranges + flat union, bank-switch distinct), printable-run text detection + min-run demotion, user-region overlay carving, and the `.ctl`/Ghidra-CSV/`.sym`/indirect-CSV serializer shapes (incl. `exportCtl` with pre-built ranges). The `window.zxDebug` API + fast recording + write provenance are covered by a headless e2e (not a standing suite)

## `tests/pal-test.html`

PAL composite (RF) tests (`core/pal-composite.js`) — the 5/8 pixel-clock-to-subcarrier
relationship and what it implies (a byte, a line and a frame are all whole numbers of
cycles), which dither bytes carry colour (`$A5`/`$5A` on the subcarrier bin, `$AA`/`$55`
at Nyquist and therefore colourless), the sample-level encode/decode chain, that the
derived per-pixel FIR reproduces it, the delay line's magenta/green versus blue/yellow
split, the decoder knobs (saturation, burst phase, delay line), the per-machine
`ulaSubcarrierLock` gating including the hue drift on an unlocked machine, and that
enabling the filter or resetting the machine re-seeds that drift so a fixed-frame
screenshot is reproducible.

## `tests/encoded-search-test.html`

`core/encoded-search.js` against a synthetic 64K: one planting per scheme it claims
(plain, complemented, XOR, offset, key−char, and the three positional forms), each
found and named with its key. Also that duplicate encodings collapse to one candidate
(XOR $00, +$00 and plain are the same search, reported as plain), that XOR $20 *is*
the case bit so a lower-case needle finds upper-case bytes, the needle variants and
five-character truncation, nibble packing in both nibble orders, the range and result
limits, and that every scheme is a byte-clean bijection at every index — a scheme that
cannot be undone cannot be reported.

## `tests/table-scan-test.html`

`core/table-scan.js`: a keyboard (row, bit) table in both field orders, with a payload
byte and with the row held as an index; a 39- and a 40-byte character table with bit 7
on the last byte; and a PAW/Quill-shaped vocabulary in four encodings, including one
whose key is derived from the padding rather than swept. Also what each recogniser must
*not* match — noise, a field of spaces, a repeated (row, bit) pair — and the value-order
reading with its outliers, which is the point of having the table at all.

## `tests/divergence-test.html`

`core/divergence.js` against hand-built traces: the first index at which two runs differ,
the same address reached through a different bank, one run being a prefix of the other,
the run-up and the two branches, the memory and register differences. Then the recorder
itself against the real CPU — two runs of the same code with one byte changed part
company at the conditional, the same input twice diverges nowhere, the entry limit is a
hard ceiling that flags itself, a range filter keeps the ROM out, and the fetch hook goes
away when recording stops.

## `tests/diffrun-ui-test.html`

The Code Path tab's **Diff run** row driven in the real app. The assertion that matters
most is the self-check: with nothing changed the two runs must diverge nowhere, which
failed before the panel restored its snapshot ahead of the *first* run too — loading a
snapshot resets the frame T-state counter, so a run from the live machine and a run from a
restore start at different points in the frame and came out one instruction apart. Also:
one byte changed diverges at the conditional that reads it with both branches
disassembled, a byte the code never reads changes nothing and says so, `nonsense` and
`8000=zz` are refused rather than guessed at, and the export holds the report.

## `tests/asm-comments-ui-test.html`

Source comments reaching the disassembly, driven in the real app because it spans the
assembler, the comment manager and the editor. Injecting carries a line's own comment to
the address it assembled to and the block above a routine to the block above it; every
copy of an unrolled `DUP` body is annotated, **including the first** — `EDUP` is recorded
as having emitted the whole block at that address and, having no comment of its own, used
to win there and leave iteration one bare. A macro call beats its first body line at the
address they share. Then ownership: a comment typed in the debugger survives every
rebuild, editing an imported one makes it yours, a comment deleted from the source is
removed rather than stranded, and `; @main` markers stay out.

It also asserts the **row geometry**, because an imported comment is a whole sentence
where a hand-typed one rarely was: the row is a flex box, and the mnemonic gave up width
until `LD L,A` wrapped onto two lines. The check is that the mnemonic is no taller than one
line-height and is not clipped, that the comment stays inside the row, and that its full
text is in the `title` — the row cuts it off with an ellipsis. And the two ⚙ toggles:
switching off assembled comments leaves hand-written ones on screen, and the other way
round.

Its `buildAndInject` waits on the **output pane**, not the Inject button: the button is
still enabled from the previous build, so waiting on it returns at once and injects the
build before this one — which is how the stale-comment check first passed a source it had
never assembled.

## `tests/calc-host-test.html`

The programmer calculator is a singleton — fixed ids, handlers bound with document-wide
selectors — shared by the debugger's right panel and the assembler's split pane, so what
this asserts is not that it computes (`calculator-test` does that) but that exactly one
exists at all times, that each host reclaims it when its tab returns (leaving it behind
showed an empty box with the right label on it), and that it still converts wherever it
lands. It also asserts the split pane's **geometry** — history beside the keypad, bit field
in view — because both ways of getting that wrong render perfectly valid HTML with every
element present.

Two things it has to work around: clicking an already-active `.tab-btn` collapses the tab
container instead of showing it, and the container can start collapsed.

## `tests/api-manifest-test.html`

The test that keeps the automation surface honest. External tools reimplement what they
cannot discover, so `zxDebug` describes itself — and a self-description is worse than none
once it drifts. Four invariants, all of which have been broken here: every member is
declared in `core/api-manifest.js`, every declaration still exists on `zxDebug`, every
member is mentioned in `docs/automation.md` (22 were not when the test was written), and
every capability *category* is named in `M8XXX.md` — the page a tool is pointed at, which
must not enumerate members but must not hide a whole capability area either. Then
`capabilities`/`help`/`require` themselves, the version comparison, and the primitives —
peek/poke round-trips, `findBytes` with wildcards, disassembly walking by instruction
length, stepping, breakpoints, and that stepping a *running* machine throws and names the
fix rather than returning a bare false.
