# Test suites: what each one covers

Run everything with `python run-tests.py`. This file is the per-suite detail;
CLAUDE.md lists the suites and the command.

## How `run-tests.py` drives a suite

A suite is an HTML page that runs its asserts on load and writes them into the DOM;
headless Edge prints that DOM with `--dump-dom`, **when the load event fires** -- long
before an async suite has finished. So the runner has to hold that event open.

It used to buy the time with `--virtual-time-budget`. That is the wrong clock: virtual
time advances while the real page waits, so a suite's own "poll up to 10 seconds for the
app to come up" could expire in a blink and the dump caught a half-written page. That was
the intermittent `NO RESULT`; raising the budget to 3,000,000 made `disk-boot-test` fail
*every* time, which is what identified it.

There is no virtual time now. `run-tests.py` serves the suite pages itself and splices a
small script into each, which loads an `<img>` whose request the server holds open -- that
delays the load event in real time -- and releases it once the suite has gone quiet.
**Quiet is counted in ticks, not wall-clock**: a suite running 700 frames in a synchronous
loop blocks the thread, so no tick fires and it cannot be mistaken for a finished one. An
iframe suite gets a far longer idle window, since it waits on work driven by the iframe's
own timers, which the watcher in the parent page cannot see.

- **A suite that dies half-way says so**: an uncaught error or an unhandled rejection
  becomes a failure line, instead of the suite reporting however many asserts it had
  reached -- which reads as a shorter suite rather than a broken one. `NOT QUIET` in the
  table means the page never went quiet and the dump was taken anyway.
- **The clock is real, so `await wait(200)` means 200ms.** Three asserts in the UI suites
  passed only on the virtual clock: two waiting on a throttled redraw, one planting bytes
  while the 48K ROM was still clearing RAM over them. Wait for the thing being checked
  with `until(...)`, and stop the machine if the test does not want the ROM running.

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

## ULA snow (application tests)

Five programs that make the snow effect visible, each opting in with
`"ulaSnow": true` (the runner forces snow OFF otherwise, so a Settings toggle
cannot decide a result):

| entry | author | note |
|:--|:--|:--|
| `snowhold-48k` / `-128k` | Mark Woodmass | **static on both machines**, which is why it is the calibration target; the banding is hand-derivable |
| `snow48-azesmbog` | azesmbog | also static |
| `snowtest-48k` / `-128k` / `-plus2` | Weiv | **the only one with an oracle**: it draws the hardware-measured EXPECTED row above the LIVE one, so a mismatch is visible in the picture itself |
| `snowtest-plus2a` | Weiv | the negative case — no snow on the Amstrad machines, so the LIVE row must stay plain |

**`snowtest` is the calibration; the rest are regression guards.** Only `snowtest`
can say our snow is *right* rather than *unchanged*, because only it carries the
hardware reference in the same frame. It found the model two character columns out on
48K and four on 128K, and the constants it settled are in
[rendering.md](rendering.md#ula-snow). The others pin that a future timing change
cannot alter the pattern unnoticed -- and note what that is worth: `snowhold` and
`snow48-azesmbog` passed happily for sixty releases against a wrong model, because a
reference captured from our own render cannot be wrong by construction.

Two of the collection were tried and **deliberately left out**: Weiv's `ula128` is
byte-identical to the tape already shipped as the `ula128` entry and sits on its title
screen with snow on, and `snow128n` draws a flat screen here. Both would pass even if
snow broke completely, so pinning them would be theatre. The remaining programs live
in `C:\Backa\zx-snow-tests\` if they are ever wanted.

## Border and screen timing (application tests)

Where a border or screen write lands, measured directly instead of inferred from
whether a game's title screen matches a PNG we captured ourselves:

| entry | author | what it shows |
|:--|:--|:--|
| `bordertime-48k` / `-128k` | Jan Bobrowski | the T-state of the **OUT** machine cycle (`14112 + 224 = 14336`) with a marker where the border actually changed; Q and A step it |
| `screentime-48k` / `-128k` | Jan Bobrowski | the same for the **screen WRITE** cycle |
| `multicolor-48k` | Patrik Rak | a dense multicolour pattern -- every cell driven on its own tick |
| `basicborder-48k` | Michael D. Wynne | border stripes from BASIC |

**`bordertime` is the instrument for the `academy` question** (its white line starts 8
pixels = 4T in from the left edge). The wiki page for Border Time links **video of it
running on real hardware**, so the marker position can be compared against a real
machine without owning one -- which is a better route than hunting for a Spectrum owner
to photograph a game.

The committed references are our own output, so on their own they are regression
guards, not proof. The proof is comparing the marker with that hardware video.

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

## `tests/cpu-variant-test.html`

**Which Z80 the machine was fitted with.** Second-source parts differ in exactly two
ways software can see, and the two are **independent** -- which is why `core/z80.js`
carries two fields rather than one variant enum:

- the undocumented YF/XF after `SCF`/`CCF`: Zilog takes both from `(F^Q) | A`, ST CMOS
  takes XF from A alone, NEC takes both from A;
- whether `OUT (C),0` drives 0 or 255 (255 on the Zilog CMOS part).

The formulas are written out **longhand** here rather than reused from the emulator --
expressed the way `core/z80.js` expresses them, the test would only prove the code
equals itself. It then sweeps all 256 values of A against every YF/XF combination in F
and in Q, for both instructions, on all four variants, and asserts the three flavours
are actually distinguishable rather than the knob being decorative.

One assertion is there to record a **decision, not a measurement**: `st-cmos` keeps
`OUT (C),0` at 0, because the 255 report is for the *Zilog* CMOS part and no source
extends it to ST. Asserting 255 there would be a guess dressed as a fact; the test
says so, so it does not read as an oversight.

Table, sources and the Settings control: `docs/machines.md#cpu-variant`.

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

## `tests/beta48-test.html`

The 48K-era Beta Disk and its clones. Three sections, the first two needing no ROM at all.

**ROM images** (`core/beta48.js`). `crc32` is pinned against the standard check value (`123456789` → `cbf43926`) rather than against itself, since every ROM is identified through it. Then: a readable 8KB image is mirrored into 16KB and left alone, a name is read out of the ROM text, a **D0/D7-crossed dump of the same ROM produces a byte-identical result** — which is the property that matters, because the dumps in circulation differ in exactly that way — a Vision board is recognised from its text, and anything that is not 8KB or 16KB is refused rather than loaded crookedly.

**The `$3Cxx` window and the latch.** Two marked ROMs (Sinclair `$11`, DOS `$22`) make every question a single byte read. With the latch off, `$0000` and `$3D00` are Sinclair while **every address in `$3C00-$3CFF` is the DOS** — that window is the whole trick of the 48K Beta, and it is live for data reads, not only opcode fetches. With the latch on the DOS covers all of `$0000-$3FFF`, and RAM above `$4000` is untouched either way. Then the CBI's master bit 6 switches the window off, and with the interface not fitted the machine is a plain 48K again.

**Real ROM** (skipped unless `roms/beta48.rom` is present). The app is brought up on a 48K with the interface fitted, and the ROM is left to boot itself: after reset the latch must be set and the master register clear, the DOS must actually **drive the master register** (writes to a port `xxxxxx00`), its sign-on must reach the screen, and the magic button must raise an NMI with the ROM latched.

## `tests/tkmem-test.html`

**TKMEM-128 II**, the external 128K/512K RAM for a 48K. Two sections, neither needing a ROM.

**Memory** (`core/memory.js`). Eight banks at `$C000` each keep their own byte, `$8000` is bank 2 whichever bank is latched, and `$4000` is still the machine's own screen RAM with latch bit 3 set — which is how the suite pins that there is **no shadow screen**, the one thing a 7FFD-shaped latch invites you to add. Bit 5 locks the latch until reset; in 512K mode bits 6-7 become bank bits 3-4, checked by bank 25 not being bank 1 rather than by reading the field back. Fitting it to a 128K does nothing, and removing it gives a plain 48K `$C000` again.

**Port decode**, driven through the real `portWrite` on a 48K. `7FFD` pages under both decodes; the Beta 48 DOS's own `$00FC`/`$07FC` page under the board's GAL equation and **not** under the default `a14`, which is the whole reason that option exists — under `gal` a TR-DOS 4.x call pages bank 0 or 7 in beneath its own stack. `A15=1`, `A1=1` and `A5=0` are all rejected.

## `tests/hc2000-test.html`

**The HC-2000 (ICE Felix) and its built-in HC IF1**, ported from Alex Badea's FUSE branch
`hc2000-v2`. Four unit sections and one that boots the real ROMs:

- **The memory map**, built against `Memory` directly with two marked ROM halves, so each
  8KB slot is identified by what it answers rather than by the flag that was set: the $7E
  latch's B/OL, CPMPL and CVS bits, the lock that holds until reset, $C5/$C7 bringing the
  $E000 RAM down to $C000, and that writes reach RAM and are dropped on ROM. The RAM is
  held in the 128K bank numbers (0/5/2/7), which is what makes CVS the ordinary shadow
  screen and keeps the special cases out of everything else.
- **The 16K overlay**: the HC IF1's ROM over $0000-$3FFF with its 1KB of RAM mirrored at
  $2800 and $3800, and — the part worth having a test for — that the overlay is invisible
  while CP/M decoding is on, as in FUSE's `hc2000_memory_map()`.
- **Terminal Count**, which the +3 does not have wired: the HC IF1 ROM asks for R..EOT=16,
  reads one sector and pulses TC, and the command must end **normally** (ST0 IC=00, no EN)
  after the sectors the CPU actually moved. The +3's own ending is asserted unchanged on a
  controller without `tcConnected`, so the two behaviours are pinned apart rather than one
  being replaced.
- **Raw images**: a 640K/320K/720K/360K file has no geometry of its own, so it becomes a
  `DSKImage` with real C/H/R/N and the same disk as IMG and as DSK then reads identically.
  The side order (all of side 0 first, or alternating per cylinder) is **detected from the
  directory**, and the HC file systems — 11-character BASIC names across the 8+3 slot, the
  9-byte IF1 header, the logical skew — are read back from a disk the Explorer's own code
  wrote.
- **On the real ROMs**, when `roms/hc2000.rom` (or FUSE's `hc2000-0.rom` + `hc2000-1.rom`)
  and `roms/hc-if1.rom` are present: FUSE's own `success_hc` disk (`tests/success_hc.img.zip`,
  847 bytes, the one committed binary fixture in `tests/`) plus a disk written here, both
  booted. **That fixture is the point of the section** — a disk our own writer made can only
  prove we agree with ourselves, where one from FUSE is an outside oracle. Without the ROMs
  the section skips and the suite still reports 60 asserts.

## `tests/fdd3000-test.html`

**The Timex FDD 3000**, which is a computer rather than an interface. Two sections.

**Station, controller, latches** — no ROMs needed, because the station's Z80 is given hand-written code to run. Seven asserts on the things that make it a second machine rather than a disk controller: a byte fetched from a sector by C/H/R and handed across the two latches (station port `$20` out, Spectrum port `$EF` in) and back the other way, the config register's bit 6 paging the boot ROM out, the interface ROM mirrored at `$1000`, RAM at `$2000` with the ROM below it read-only, and the one that is a real trap — **INTRQ must rise a few station instructions after a command ends, not instantly**. TOS reads the status register (which clears INTRQ), does `EI` and *then* waits, so an instantaneous INTRQ is lost and every Seek times out.

**Real ROMs** (skipped without `roms/fdd3stavi.rom`, `roms/fdd3000-boot.rom` and `headless/fdd3000/tos.dsk`, which are all gitignored). TOS A.2 booted on a 128K: the station loads its system from drive A, the 48K ROM is selected as in FUSE, the second copyright line `© 91 STAVI 128K TOS A.2` reaches the screen, `CAT *` lists the disk, and `SAVE *`/`LOAD *` is a **round trip through the station** — 2048 bytes written and read back and compared, which is the only thing here that cannot pass by accident. Then CP/M on a 48K through the Monitor Emulator terminal, including the disk swap `fdd3000AutoBoot` does by hand.

## `tests/explorer-test.html` — the XSS section

**A crafted file must not be able to put markup on the page.** The Explorer renders every field it shows by building an HTML string and assigning `innerHTML`, so one unescaped field is script execution in this origin. A TZX text block and a TZX message block are 255 bytes each, which is room for a working payload: both are loaded carrying `<img src=x onerror="window.__xssRan=1">` and the suite requires that no `<img>` appears, that `__xssRan` stays `undefined`, and that the payload is **shown as text**. Then a TAP filename, which is only ten bytes — too few for that payload but plenty for `<b>PWNED!`, and a tag is the thing that must not survive.

This section is checked against the bug it exists for: reverting the four escapes in `ui/explorer-banks.js` fails six asserts, and **`and its onerror never runs` is among them** — the payload really does execute without the fix, so the test is a demonstrated exploit rather than a theoretical one.

## `tests/gama-test.html`

**The Didaktik Gama's 80KB.** Ten asserts with no ROM, and the ROM section after them.

**The 8255 and the second bank** — reachable always, and for the same reason as `tk-test`: everything the contributor wrote gates on `roms/dgama89.rom`, which is in neither FUSE's nor ZEsarUX's distribution, so **this suite ran 0 asserts and reported green**. The 80KB is the layer, so it is pinned here. The profile declaring `gama80k` and nothing else having a second bank; **power-on mode `$9B` leaves every port an input, so PC0 is pulled low and cannot select** — a set PC0 still reads bank 0, which is the detail that makes the Gama boot as a 48K until its ROM writes `$92`; a mode set clearing the outputs (hence bank 0 again); PC0 then selecting bank 1 and clearing back; `$8000-$FFFF` being **two genuinely separate 32KB stores** (a byte written in each bank, both read back); `$4000-$7FFF` being the same contended RAM whichever bank is in; and a BSR aimed at another port C bit leaving the bank alone, since the bit is addressed by D3-D1.

**On the real ROM** (skipped without `roms/dgama89.rom`): the ROM booting to "© 1989 DIDAKTIK SKALICA", and the bank-B detection routine every Czechoslovak program used (`OUT (127)` with 1/0 around a write to 50000) answering 80KB here and 48KB on a 48K. Not run here.

## `tests/tk-test.html`

**The Microdigital TK-90X and TK-95.** Nine asserts with no ROM, and three sections that need one.

**The line time, and the two relaxations** — reachable always, which matters here more than usual. Everything the contributor wrote is behind a `roms/tk90x.rom` gate, and those ROMs are not in FUSE (it does not emulate these machines), so on a tree without them **the suite ran 0 asserts and still reported green** — the exact shape of a false pass. So the thing the layer *is* gets pinned up front: both machines at **228 T-states a line**, 312 lines, 71136 a frame, and the first pixel at `64 × 228 = 14592` — that last one because the layer stopped writing 14336 down and derived it instead, and a reverted constant would draw every TK screen a third of a frame out of step. The 48K is asserted unchanged (224 / 69888 / 14336) and the fallback pinned, since a profile with no `tstatesPerLine` must land on 224 rather than `undefined`. Then the two "allowed on a TK as well" changes, neither of which had any coverage: **TKMEM-128 II** fitting a TK-90X and TK-95 (and still refusing a 128K, a Pentagon and a Timex), and **AY in 48K** being offered on them — that one a hardcoded machine list inside `_ayOnPorts()` rather than a profile field, so adding a machine means remembering to edit it.

**On the real ROMs** (skipped without `roms/tk90x.rom` / `tk95.rom`, and the Chase HQ section also wants `roms/beta48.rom` and `headless/tk/ChaseHQ_TKMEM.scl`): the ROM booting on each machine, the frame timing measured on the running ULA, and a Brazilian Beta 48 clone loading a TKMEM game. None of it runs here.

## `tests/sound-addons-test.html`

**TurboSound and the DACs**, driven in the real app on a 128K. Fifteen asserts, no ROM needed.

**TurboSound** — that `$FE`/`$FF` on `$FFFD` are ordinary register writes while it is off; that with it on `$FF` picks chip 0 and `$FE` chip 1 and each keeps its own registers; that a register read follows the selected chip; that a write to the second chip is tagged with the chip so the mixer replays it there; and that reset clears the second AY and selects chip 0.

**DACs** — Covox mono on `$FB` driving all four channels, Covox moved to `$DD` and answering there and **not on `$DC`, the port one bit away** (which is what pins a full 8-bit compare — `$DD` against `$FB` differ in too many bits for a loose match to fail); Stereo Covox putting each port on its own pair; Specdrum on `$DF`; Soundrive's two jumper modes with the other mode's ports ignored; and the one that is a decision rather than an arithmetic — **while TR-DOS is paged in the DACs do not hear the bus**, because Soundrive mode 1's `$1F` and `$5F` are the Beta Disk's own registers and disk work would otherwise click through them. Then that with the DAC off nothing moves, and that **reset returns the levels to silence, `$80` and not 0** — a DAC held at 0 is a full-scale offset, not quiet, and the "DAC off" assert cannot see that because with it off the levels never left `$80` to begin with.

## `tests/timex-test.html`

**The Timex TC2048 / TC2068 and their SCLD.** Ten asserts with no ROM at all, and two sections that need one.

**SCLD modes and DCK** — pure, against `core/timex.js`. The hi-res ink/paper pair from DEC bits 3-5; the second display file at `$6000` (mode 1), 8x1 hi-colour attributes (mode 2) and the hi-res pairings (modes 4-7), each checked with bytes planted so that no two modes could return the same answer. **The display-file offset of all 192 rows** against the layout written out longhand rather than reused from the implementation — every other assert here uses a row in the first third, where the third's own term is zero, so without this the term that places two thirds of the screen is not exercised at all. Then a DCK cartridge parsed: a DOCK block with a ROM chunk and a RAM chunk, and separately an EXROM block whose **empty-RAM** chunk must be 8KB of zeros and consume no file bytes — the access type the first fixture does not use.

**The machines themselves** (skipped without `roms/tc2048.rom` and `roms/tc2068.rom`, or FUSE's `tc2068-0.rom` + `tc2068-1.rom`; all gitignored). The SCLD ports and their read-back, the hi-res display, DOCK/EXROM paging, the AY on `$F5`/`$F6`, the Timex joysticks and a `.dck` cartridge booting are **all** inside those sections, so with no ROMs present the two machines are unverified and only the pure SCLD arithmetic above is covered. Worth knowing when reading a green run.

## `tests/midi-test.html`

**The 128's MIDI out**, which is a UART written in software by the ROM. Ten asserts.

**UART and assembler** — pure, no machine. Five bytes bit-banged into `UartDecoder` and read back (`$FF` and `$00` among them, because they are the two with no edges in the middle); the start-bit rule from **both** sides, since a start bit is the line *falling* — a low line rising is not one, and neither is a low line going low again, which is the half an "is it low?" test would get wrong; the assembler's running status, real-time bytes, program change and SysEx; and a byte with **one edge stamped a frame late**, which must come back wrong — that is the hazard the monotonic clock exists to avoid, written down where it can be seen.

**On the real 128K ROM** (needs `roms/128.rom`). `PLAY "Y1c"` typed at 128 BASIC, and the bytes that come out must be `90 3C 78` / `80 3C 40` — Note On and Note Off for middle C on channel 1, with no framing error. That is an outside oracle: the ROM decides the baud rate, the bit order and the message, not us. Then three things the port had to add because nothing asserted them: **R7 bit 6** is port A's direction, so the line idles high while the Spectrum is reading port A and only follows R14 bit 2 once it is driving it; **reset sends All Notes Off on all 16 channels**, since a note sounding when the machine is reset would never get its Note Off; and the UART takes its time from `absTStates()` at both the edge and the per-frame flush. That last one is pinned as a collaboration rather than a behaviour on purpose — the two clocks differ by a whole frame and, measured, the naive one does not go backwards, so there is nothing observable to assert, only the choice to be kept.

## `tests/saa-test.html`

**The SAA1099**, the ZXM-SoundCard's chip. 26 asserts, and **nothing here skips**: the chip is arithmetic on its own registers, so there is no ROM to be without and no "ran 0 asserts and reported green" to worry about — the trap the last three layers all fell into.

**The chip model** — pure, against `core/saa1099.js`. A tone measured at two octaves against the half period `(511 - f) << (8 - octave)` written out as a frequency, so a changed shift or an off-by-one in the 511 shows as the wrong number of edges per second; the amplitude nibbles going to their own channel and nothing reaching the other; **six channels at 15 together reaching exactly 1.0**, which is what fixes the scaling; the noise rate; a single decay running down to 0 and staying silent; the external envelope clock, one step per address write, with its inverted right side; and new parameters written into a running envelope **waiting for the end of the period** — the data sheet, SAASound and Xpeccy against MAME, which restarts at once.

**The eight the layer shipped without**, which is where the reading was worth it. Everything above exercises envelope generator 0 on channel 2; the chip has **two**, so the data sheet's "channels 2 and 5" was only half pinned and nothing at all reached generator 1. It is now its own object, stepped by **tone 4**, reaching **channel 5 alone** — and that last one is the assert that fails if the envelopes are given all three channels of their group, which is exactly what MAME does. Then `$1C` bit 1 **holding and resetting** the generators (the existing "six channels reach 1.0" case writes that bit only to get a known starting level, so it passed whether it held or not); tone and noise on one channel giving the tone at **half** amplitude while the noise is high and silence while it is low, counted one clock at a time so every level is exact and nothing is averaged away; noise parameter 3 being **tone 0's clock** and not a fourth divider rate, pinned by the rate differing by four at octave 7; the 3-bit envelope bit, where 15 must read as 14 and every level is even; and a **48K with no AY** taking the card, since nothing in the decode may be standing on an AY being there.

**The ports** (`$01FF` / `$00FF`), driven through the real `portWrite` in the app. The two told apart by A8, the writes reaching the chip at the frame's end — which is `_saaFlush`, the path that runs when the audio is not taking them — and then four silences: while TR-DOS is paged in (the ports are the Beta Disk's), on a Timex (whose `$FF` is the SCLD's), while the card is switched off, and after a reset.

**Mutation-tested, 16 of 16 killed**, each by the assert named after the behaviour it broke. One was put in expecting it to survive: moving the noise LFSR's tap, since the suite measures the noise *rate* and not its sequence. It was killed anyway — x^18+x^12+x is not a maximal-length polynomial, so the register degenerates and the rate collapses with it. The rate assert catches a moved tap by accident; **the sequence is still unpinned**, and that is worth knowing rather than counting as cover.

## `tests/kempdisc-test.html`

**The Kempston Disc Interface and the K-DOS file system.** 34 asserts, none of which needs a ROM — which is the whole point of how this suite ended up shaped the way it is.

**The board.** The stock port decode (`$E5`/`$E7`/`$ED`/`$EF`, register = A1 | A3 << 1) and the 128A6 one (`$A7`/`$E7`/`$AF`/`$EF`, A6 | A3 << 1), each rejecting the other's ports; the 8KB ROM mirrored over `$0000-$3FFF` and in at reset; `OUT $D7` paging out and then the difference that matters — on the stock board **any** `$xxFD` pages it back in, which is the 128K's own `$7FFD` and the reason the board is a 48K one, while on the 128A6 board `$7FFD` is ignored and `OUT $BF` does it; and `$DF` picking drive and side.

**The file system, which had no reachable assert at all.** `core/loaders/disk-kdos.js` is 298 lines with fourteen public methods and it is what the Explorer's editor is built on, but every assert the layer wrote for it sat behind the `roms/kdos21.rom` gate — and that gate `return`s, so with no ROM the format ran nothing. None of it needs one. Pinned now: `FORMAT`'s layout for DS 80 and SS 40 (label, the fixed geometry bytes, 795K and 195K free, `$A5` everywhere outside the directory, no sector 10) and **which** five blocks the directory takes — 200-204 on a DS disk, 100-104 on an SS one, which nothing reads through the map, so marking the wrong five is invisible until a file is allocated on top of them; every block past the end of the disk marked used, and a foreign disk that leaves them clear still reporting only its own blocks free; the name hash against the ROM routine written out longhand, with `AUTO` = `$93` as the oracle and a name whose hash really comes out 0 stored as 1; `addFile` packing from block 0 with no gap; a 3000-byte file read back byte for byte across the side boundary; delete, rename, swap, label and param1 each with their slot byte; the two refusals, disk full and directory full, with their messages; and the Explorer view's MDOS type letters and free count.

**The one that a round trip cannot check.** Logical sector *n* maps to a track, a side and a sector, and `addFile` and `readFile` both go through that same mapping — so **any** consistent permutation of it round-trips perfectly, which is this tree's standing warning that our own capture proves "unchanged" and never "correct". Two mutations of the mapping survived a full round-trip test. It is now read off physical sectors marked one by one and compared with the layout written longhand, and both mutations die.

**Mutation-tested 18 of 18 — after two passes.** The first pass killed only ten: the round-trip asserts above, `addFile` taking the end of a free run instead of its beginning, the directory's block position, a zero name hash, and `freeBlocks`' clamp all survived. Each survivor was a real weakness in an assert written here, not a missing mutation, and six asserts were added or sharpened because of them.

**What waits for the ROM.** K-DOS is an 8KB firmware no emulator distribution ships (MAME alone supports the board, and ships CRCs), so the sections that boot it skip: the ROM booting and printing its copyright, the drive test, real `.kdi` games, and the 128A6 board on a 128K. `disk-boot-test` carries the interface's required section and, until the ROM arrives, asserts the two things that do not need it — that `allInterfacesOff` really switches a board that pages in **at reset** off, and that switching it on with no ROM leaves `$0000` as the Spectrum's own.

## `tests/gs-test.html`

**General Sound**, which is a computer rather than a chip. 32 asserts, and the interesting thing about them is that this suite has an **outside oracle**: the card's own firmware, which boots, tests its RAM and reports what it found.

**The board on its own** — pure, against `core/gs.js`. A read from `$6000`/`$6100`/`$6200`/`$6300` feeding DACs 1-4 with A9-A8 picking the channel and 1+2 going left, 3+4 right; volume 0 silencing a channel and a volume register being **6 bits**, so `$FF` reads back as 63 and not 255; page 0 putting the whole ROM at `$8000` and page *n* 32KB of RAM; the wrap **following the RAM fitted** — page 17 to page 1 on a 512KB board, page 5 to page 1 on a 128KB one, which is four pages and not sixteen; the `$BB`/`$B3` mailbox each way with its status bits and the GS-side ports that clear them; `(port & $F7) === $B3`; and `$33` resetting the card while leaving the mailbox alone.

**The clock and the interrupt**, which is what the layer left unmeasured. Nothing it shipped runs the GS's Z80 at all, so neither the 12 MHz nor the 37.5 kHz interrupt was pinned and the firmware boots either way, just faster or slower. A 32KB ROM written here — `IM 1`, `EI`, a two-byte self-loop, and a handler that re-enables and returns — measures both without the firmware: 70000 T-states of a 48K must be 240000 GS cycles with 750 interrupts in them, and a 128K's 3.5469 MHz must give **1.3% fewer**, because the time base is per machine. Then the NMI from `$33` bit 6, which the layer only recorded as *pending*: it must actually be taken, once, and the card must leave its loop.

**The firmware** (needs `roms/gs105b.rom`; `gs104.rom` and `gs105a.rom` extend it). Each one must boot, run its own RAM test and answer command `$23` with the number of 32KB pages and `$20` with the free RAM — gs105b at 128KB, 512KB **and** 2MB, gs104 and gs105a at 128KB. Those numbers come from the card, not from us, which is what makes them an oracle: the mutation that fixes the page wrap at 16 is caught here, by a 2MB board reporting itself as 512KB, and so is a missing status bit on the command port. Each ROM also carries its own version stamp straight after the entry jump (`F3 C3 48 01`, then `04 01` or `05 01`), an identity the filename cannot fake. Then a Spectrum reset leaving the card running, `OUT $33,$80` stopping it, its ports vanishing when it is switched off, and the per-machine clock from both ends.

**The sync, pinned because a mutation survived.** `syncTo` is called at every port access *and* at each frame's end, and dropping the per-access call first passed all 31 asserts — the card still ran, a frame behind, and nothing looked within a frame. The assert now puts the card at a frame's start and reaches it mid-frame, which is the only place the difference exists. **Mutation-tested 17 of 17** after that.

## `tests/tsfm-test.html`

**TurboSound FM**, and the one suite here whose subject is **a port of someone else's code**. `core/ym2203.js` is ymfm's OPN core translated from C++, which makes "it applied cleanly" worth nothing — a clean apply is a textual fact — and makes a round trip through our own output worth little more, for the reason the Kempston Disc layer wrote down: a consistent error in a shared path survives any capture of ours. So the oracle here is the arithmetic the chip is *defined* by, written out longhand as `ula-blit-test` does for the cell blit. 70 asserts, none needing a ROM.

**The two ROMs, rebuilt rather than trusted.** The port carries 512 hand-copied hex numbers. The log-sin table is rebuilt from `round(-log2(sin((x + 0.5) × pi / 512)) × 256)` and the exp table from `round(2048 × 2^(-(i+1)/256)) - 1024`, and both are compared with the port's **digit for digit, with no tolerance, over all 256 entries each**; then the whole operator output is rebuilt the same way and compared sample for sample over 1024 attenuations × 147 phases. A mistyped digit fails here instead of sounding 0.3% wrong, and the mutation that changes one hex digit of either table dies on it. Full scale is ±8168, the sign is phase bit 9, total level is 0.75 dB a step over 128 steps, and the bottom of the envelope is silence rather than a floor.

**Pitch, against the datasheet.** `f = FNUM × fM / (2^(20−B) × 144)` for six block/fnum pairs, exactly — and at block 0, where the step is `fnum >> 1`, the half an odd F-number loses is pinned as the chip's own truncation. MULTIPLE 1-15 multiply and 0 halves; DETUNE 1-3 sharpen by a rising amount and bit 2 flattens by exactly as much. The **keycode** is checked against the datasheet's own F11/F10/F9/F8 rule over 48 block/fnum pairs rather than against the port's `bit(0xfe80, …)` packing of it, read back through the key scaling.

**The envelope.** The documented *every 4 steps of the effective rate halves the time*, measured on the pipeline over five rates; rate 0 stopped rather than very slow; the attack exponential, with every step smaller than the last and the first from full attenuation exactly 64 (a sixteenth of what is left); attack rate 31 instant by its own branch. Then **one absolute time**, because every other envelope assert is a ratio and all of them would pass with the divide-by-3 missing or doubled: the generator ticks once every three FM samples, so at the top rate the attenuation reaches 768 in 288 samples. SSG-EG runs four times as fast above half and repeats instead of holding.

**The algorithms.** Each of the eight carrier sets read off by silencing three operators and listening for the fourth — 32 operators, each silent or loud as the datasheet says. Then all eight waveforms **pairwise different** — with the four operators given different MULTIPLEs, since four identical ones make algorithms 2 and 3 the same sum by symmetry. That assert is not enough on its own and the mutation pass said so: eight different waveforms stay eight different waveforms when two table entries are swapped, so swapping algorithms 5 and 6 — the pair that shares a carrier set — survived it. What tells them apart is **positional**: for each algorithm, which of its carriers are *modulated*, decided by whether silencing the modulators changes the output at all. 16 carriers, and alg 5's `{2,3,4}` against alg 6's `{2}` is the difference. Feedback is checked as a modulation index that **doubles at every level**, which is what `>> (10 - level)` means and is easy to write backwards; above level 5 the phase swing passes a whole cycle and the measure folds back, so the doubling is asserted where it can be seen and the folding is written down rather than averaged into a weaker claim.

**Channel 3, the timers and the board.** Multi-frequency mode with slot 4 keeping the channel's own F-number (the other three registers' slot order is ymfm's, pinned so a regression shows but not verified against a datasheet); CSM taking all four operators through an attack and back to release in one sample, and nothing at all outside CSM mode. Timer A at `(1024 − TA) × 72`, timer B at sixteen times the granularity, each flag's enable and reset bit separately, busy at 32 × 6, and that clearing a running timer's flag does **not** restart its period. Then the board on a 128K: the `%11111xyz` control word, the SSG / FM address split with the SSG keeping its own register, an FM write that stops at the FM and never reaches the AY, `$FF` from a latched FM address, both chips' own FM halves, `_fmFlush`, reset, and a 48K with no AY fitted hearing nothing.

**The clock, and what the layer got wrong.** The layer timed the chip from `totalFrames × tstatesPerFrame + cpu.tStates` — the clock this tree threw out for the disk at 112 T-states and MIDI at 113. Timer A's shortest period is 72, so the hazard is worse here, and one assert says what it costs: a frame arriving at once fires CSM **984 times in a single call**. Another pins that the port path reads `absTStates()` and that three frames of emulation advance the timers by three frames.

**Mutation-tested 48 of 48.**

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

- **The disk clock only ever moves forward.** Everything timed by rotation is arithmetic on
  one number, so it is sampled either side of 200 frame boundaries and must never go back,
  and must advance one frame per frame. Built as `totalFrames * tstatesPerFrame +
  cpu.tStates` it did neither: `totalFrames` moves at the end of a frame and the subtraction
  from `cpu.tStates` at the start of the next, so the clock leapt a frame and dropped back —
  a wobble against a 698880-T revolution, and a stalled Opus transfer against a DRQ due
  112 T out.
- **Opus Discovery**, **Interface 1 / Microdrive** and **Didaktik 80** — the full round trip on
  a blank disk. The Didaktik also checks the file appears in the MDOS catalogue of the image
  itself, not just on screen, and **times the bytes of the `LOAD`**: MDOS transfers by NMI,
  so it should read at the medium's 111.8 T-states a byte and not at the handler's. It reads
  at 111.8; scheduled from the host's service instead of from the previous byte's due time it
  reads at 127.0, and the assert says so. Nothing else here can see that — the transfer
  completes either way, only slower than the disk physically turns.
- **Opus Discovery — the ROM formats a blank image into a disk**, and **Didaktik 80 — MDOS
  formats 160 track-sides.** A round trip proves a writer; these prove the interface can
  **make** the disk in the first place, which is a different question and the one Write Track
  answers. Each starts from something that is *not* a disk of the right kind — an all-zero
  image with no anchor sector for the Opus, a valid D80 with every byte overwritten with
  `$5A` for MDOS — so neither can pass by accident. What is checked is not the screen but the
  image: the Opus's anchor sector (`$18 $05`), the label the ROM was given, the geometry the
  drive was set to, an empty catalogue, and then a `SAVE`/reset/`LOAD` on the new disk with
  the file appearing in the catalogue. MDOS gets the same treatment, plus the confirmation
  prompt it puts up before destroying a disk (`P` for Proceed) — worth pinning, because a
  format that needed no confirmation would mean the ROM had taken a different path through
  its own parser. The two ROMs between them cover both sector sizes and both register
  decodes. The **+D** cannot be tested — no G+DOS in the tree.
  Both also pin **the pacing**: `lastFormat.revolutions` ≈ 1.00, because these two transfer
  by NMI and their DRQ is scheduled from the previous byte's *due* time rather than from the
  moment the host serviced it. Scheduled the other way the handler's own cost is added to
  every byte — measured at ~130 T-states against the 111.8 a byte has, a track taking 1.15
  revolutions, which no real drive can do. All three also pin **`indexWait`** and the span:
  a Write Track begins on the index rather than where the command landed, so the wait is 0
  to 1 and the whole command runs to between one and two revolutions — Opus 0.86 + 1.00,
  MDOS 0.72 + 1.00, TR-DOS 0.66 + 1.00.
  TR-DOS *was* the control here, on the grounds that it polls instead of taking NMIs so
  nothing paced it and its figure had to stay under one revolution. **That was the bug stated
  as a feature**: nothing pacing it meant its ~57 T-state loop wrote a track in half a
  revolution, and anchoring the window to the index turned the figure negative. Its pin now
  reads ≈ 1.00 like the others, and the control it provides is a different one — it is the
  only format here driven by a polling ROM, so it is what proves the chip's own DRQ gating
  works on the register that ROM actually reads.
- **TR-DOS — FORMAT from the `A>` prompt.** The same again, with one trap worth the section
  on its own: at the prompt the cursor is in K mode, where `f` gives **FOR**, not `FORMAT`.
  `FORMAT` is an *extended*-mode keyword (CAPS+SYMBOL, then SYMBOL+`0`) and nothing in
  `ula.keyDown` reaches it, so this drives the key matrix directly. Typing `FOR "trd"`
  instead is how TR-DOS came to look as though it could not format at all. What is asserted:
  the keyword really appears, the report carries the new name and a free count equal to the
  total, byte 231 of the disk-info sector is the TR-DOS id `$10` the ROM wrote, the old
  disk's files are gone, a SAVE to the new disk lands in its catalogue, and the last track
  of the format was track 79 side 0 with all 16 sectors landed — an **80-track single-sided**
  disk, which is what `1264/1264` free means (80 × 16 minus track 0, not 40 × 2). Note that
  `lastFormat` has to be snapshotted *before* that SAVE: every TR-DOS save issues a Write
  Track of its own and would overwrite it.
- **Didaktik 80 on a 128K** — the same round trip again, because "it works on a 128K" means
  that and nothing weaker. A stock 128K must refuse the interface; with the **128K hardware
  patch** it must hold ROM page 1 through a reset *and* against a later `$7FFD` write, then
  complete the round trip. Remove the ROM hold and four asserts fail — checked, so this is a
  guard rather than a decoration. Also pins where the patch does **not** reach: the +2A
  (different `$7FFD` decode) and Pentagon (its own disk interface).
- **DISCiPLE** — no round trip either, and the ROM itself says why: its RST 10 vector is
  `OUT ($7B)` then `JP $0550`, and $0550 is only code once $7B has swapped the 8K RAM down
  to $0000. GDOS proper is the system file off the disk, running from that RAM at the ROM's
  own addresses, and there is no such disk in the tree. What the ROM does on its own is
  pinned instead: it takes $0000-$3FFF **one instruction into the reset** (the fetch after
  the Spectrum ROM's `DI`, stepped by hand because it happens exactly once ever), sets
  itself up, pages itself back out, and leaves 48K BASIC running — which is where the +D
  once failed. Then the window: the RAM takes writes where the ROM half drops
  them, `OUT ($7B)` brings it down to $0000 and `IN ($7B)` puts it back, bit 3 of port $1F
  picks which 8K of a 16K image is live (found by the byte the two banks differ at, not by
  address), and `OUT ($BB)` must take the whole window away or the next RST lands in GDOS.
  Flipping one comparison in the overlay fails 13 of the 21 asserts — checked. Also pinned
  as a **decision**: with the interface on, port $1F is the DISCiPLE's joystick whether or
  not the Kempston is switched on, because the hardware drives it — and the alternative is
  a floating $1F, which is what Venom and Academy read as a fire press.
- **+D** — no round trip is possible: its 8K ROM is a bootstrap that needs G+DOS in a `+SYS`
  file, and there is no such disk in the tree. What is pinned down instead is the failure it
  actually had — the machine soft-resetting before the ROM could say anything. Booting a
  disk with no `+SYS` must produce G+DOS's own diagnostic.
- **+3 floppy** — the same round trip through the built-in µPD765. This one had **no
  end-to-end cover at all**: `tests/tests.json` has no `+3` entry, so the FDC and the whole
  +3DOS path were shipped on trust. It works, but nothing proved it until now.
- **TR-DOS / Beta Disk on Pentagon** — the same round trip, which it used to be exempted from
  on the grounds that `SYSTEM TEST V1.01R`, `Global test v1.0` and `AUMT` in
  `tests/tests.json` already boot real TR-DOS software. They do, but every one of them
  **reads** a disk somebody else wrote, so none proves our TR-DOS *writer* — the exact gap
  that let the Microdrive ship broken. It looks unlike the others for two reasons: the Beta
  Disk is not a `$0000` overlay with a star syntax, so from 128 BASIC `SAVE "x"` goes to
  **tape** and the commands have to be typed at TR-DOS's own `A>` prompt (one key per
  keyword — the cursor is in K mode, so `s` is `SAVE` and spelling it out would type `SAVE`
  then `AVE`); and the reset between halves must be `bootTrdos()`, since a plain Pentagon
  reset lands in the ROM's menu. Also pinned: TR-DOS has paged *itself* back out by the time
  the prompt is up — it is not a permanent overlay — so what has to hold is **ROM bank 1**,
  because `updateBetaDiskPaging()` only re-pages on bank 1 and a Pentagon left on bank 0 (the
  128 editor) can never re-enter TR-DOS at all.
- **The TR-DOS chip is the one ROM that is not part of `memory.rom`**, so `setMachineType`'s
  `new Memory` drops it while every machine ROM survives. Blanking it and switching 48K →
  Pentagon must bring it back. That asymmetry is why a TR-DOS disk could fail on Pentagon
  while the same disk worked on a **Scorpion**, which keeps TR-DOS in bank 3 of
  `scorpion.rom` (`trdosInRom`) and cannot lose it — asserted here rather than assumed. The
  cold-cache half of that bug (`ensureRom` fetching `trdos.rom` before `roms/` has been
  walked) needs an empty ROM cache, which this suite cannot make; it is held by the fetch
  list in `zxDebug.ensureRom`.

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
  retry storm** and then printed the disk label and all three filenames. It also **times the
  512 bytes it reads**: the mean gap between data-register reads must be the medium's 111.8
  T-states a byte. Scheduled from the host's service rather than from the previous byte's due
  time it comes to 135.7, and that assert is the only thing in the tree that notices — the
  catalogue appears either way. Checked by reverting the schedule, so it is an oracle and not
  a tautology.
  - The DRQ stub in the section above it **saves and restores the real handler** rather than
    re-implementing it. It used to rebuild the closure and poke the `Spectrum` fields it knew
    the names of; when the schedule changed, that stale copy left the NMI permanently due,
    fired it before the ROM had set up the transfer, and failed *this* section a long way
    from the cause — which also produced the wrong conclusion that reads could not be paced
    absolutely. Two hours went into the product looking for a bug that was in the test.

Note it drives the `Opus Discovery 1 v1.2` ROM for that last part: the v2.x, EXCOM and
QuickDOS ROMs boot fine but take a different command set (see `docs/peripherals.md`). The
`+2A/+3` check is deliberately last, because switching machines rebuilds `Memory`.

## `tests/mfm-track-test.html`

The raw MFM track, both directions (`core/loaders/mfm-track.js`). Formatting is not a sector
operation — a DOS streams the whole track at the chip — so this is the stream a formatter
writes and the bytes a Read Track gives back, which are deliberately **not** the same bytes.

What it pins:

- A format stream built and parsed back for seven real geometries (TR-DOS 16×256, Opus
  SS 18×256, Opus DD and MGT 10×512, MDOS 9×512, 5×1024, 26×128), each sector carrying
  contents nothing else could produce, so a data field sliced one byte wrong cannot pass.
- The interleave is the order the sectors pass under the head, each number used once.
- **A mark counts only behind a `$F5`.** A data field filled with `$FE` — including an
  `$FB`, an `$FE` and an `$F8` at the front of it — is still one sector, read back byte for
  byte. That is the one property that makes the parser safe on real data.
- What is refused: an ID field with no data field after it (the chip wrote it, but there is
  no sector there), a data field with no ID before it, a track of gap filler, nothing at all.
- A stream cut short mid-field keeps the complete sectors and invents no half one — which is
  what a Force Interrupt during a format looks like.
- Deleted data marks (`$F8`) come back flagged, with their data.
- The medium form: real `$A1` sync bytes rather than the `$F5` that writes them, the ID
  bytes in order, and the CRCs checked by **appending each to its own message and asserting
  the running CRC is zero** — so nothing is recomputed by hand here.
- The property no constant gap can have: **every real geometry fits exactly one revolution.**
  6250 bytes leave 91 per sector for 18×256 and 113 for 10×512, so gap 3 has to be shared
  out, and an explicit `gap3` still wins for a caller that knows better. A geometry that
  cannot fit at all (16×1024) reports the length it would need instead of losing sectors.

## `tests/disk-rotation-test.html`

The disk going round (`core/loaders/disk-rotation.js`), pure arithmetic on a T-state count.

What it pins:

- **A revolution is ten frames**, so the figure follows the machine: 698880 on a 48K, 709080
  on a 128K, and both the same ten frames. No per-machine disk constant to go stale.
- The byte time derived from the geometry — 698880 / 6250 = 111.8 — **asserted to round to
  the 112 in `core/constants.js`**, which is the same number written down from the
  250 kbit/s data rate. If the two ever disagree, one of them is wrong.
- Where the head is: the angle through a revolution, wrapping, negative times, and a
  revolution length of zero answered rather than divided by.
- The index pulse: 1.5 ms of each revolution, under 1% of it — a pulse and not a phase — and
  the property that makes a pulse that short safe, that **a status loop polling every 500
  T-states cannot miss it at any phase**.
- Which byte and which sector are under the head: forward through the track, never off it,
  and a revolution passing all sixteen sectors in order exactly once.
- The Write Track deadline: a command opened at **any** phase meets an index within one
  revolution — the property the TR-DOS SAVE hang came down to.
- The byte schedule is **absolute**, so a whole 6250-byte track comes to exactly one
  revolution, and `byteDueAt` / `bytesSince` are exact inverses at every byte tried (which
  is why the first rounds up: rounding down leaves them one byte apart for every schedule
  whose byte time is not a whole number of T-states, i.e. all of them).
- The clock a controller is given: no time source gives **no clock at all** rather than a
  fake one, and the revolution length is read live so a machine change is picked up — and
  `nextIndex` (where a Write Track's revolution will begin) and `byteTime` (how long the
  chip may take over each byte) follow the machine the same way, a 128K byte asserted to be
  measurably longer than a 48K one rather than merely recomputed.
- **Elapsed time is not pulses crossed.** `sinceIndex` reaches 1 a thirtieth of a turn after
  0.97 of a revolution while `revolutionsSince` is still near zero. The deadline was written
  with the first and cut a TR-DOS format short at 196 bytes of its 82nd track; both are kept
  and checked against each other so the distinction cannot quietly go away.

## `tests/disk-test.html`

Write Track and Read Track through the controllers, on top of the below. A track laid down
and read back; a format written **where the head is**, so a stream whose IDs claim another
cylinder writes nothing and counts ten skipped; the wrong sector size or a number off the
end of the track refused sector by sector; a Force Interrupt committing exactly the three
complete sectors; a stream longer than a revolution truncated at the index pulse as a real
drive truncates it; the Opus's 18×256-from-0 and MDOS's 9×512 driven through their own
register decodes (the Opus has no I/O ports — `writeMemory`, not `write`); and a UDI track
image still refusing to be formatted, because there is no UDI writer.

Then the regression that implementing Write Track caused, which is the sharper half:
**a track opened and never fed ends with lost data and an interrupt** after exactly
`FORMAT_POLL_LIMIT` polls, on the status register, the system register and the +D's control
register alike, leaving the disk byte for byte what it was and not even marked modified —
because TR-DOS 5.03 writes Write Track from its entry stub on every SAVE and then waits.
And the other side of it: **a format being fed is never cut short**, however hard the host
polls between bytes (the test polls 40 times per byte, a quarter of a million times in all),
because MDOS polls well past the limit before its first byte and a limit on the *gap*
aborted its format at track 2.

Then the same ground again **with a rotation clock injected by hand**, which is the state the
app actually runs in — the poll counter is only the fallback for a controller with no machine
around it. Time standing still: 20,000 polls at one instant do not end a track, nor does a
revolution less one T-state, and the first poll a whole revolution later does. A format fed
across an index boundary lands all sixteen sectors (the `sinceIndex` bug wrote 196 bytes of
one). A format fed at the Opus's measured 130 T-states a byte — slower than the medium —
still completes, and reports having taken over a revolution, which is why the deadline is
measured from the last byte and not from the command. A track abandoned half way *is* closed,
with lost data, keeping the sectors that arrived. The index bit follows the clock rather than
one read in sixteen, and 200 reads at the same instant never invent a pulse.

**Where a Write Track begins** is its own section, because the ones above all issue the
command at `t = 0` — which is *inside* an index pulse, so they never had to wait. A command
issued four tenths of a turn in must: a revolution after the command is not enough to close
it, the next index is, and `lastFormat` reports `indexWait` 0.6 with `revolutions` exactly
1.0 — the wait and the write, separately. A command landing on the pulse waits for nothing.
Then the **polled byte rate**: after the chip takes its first byte it holds DRQ *down* until
the next is due, on port `$FF` bit 6 and not merely in the status register, because `$FF` is
what TR-DOS polls — gating only the status register changed nothing, which is how that was
found. DRQ comes back up exactly at the index, and a byte time after each byte thereafter.

Read Address is the subtle one. **Reading an ID costs the time to reach it** — the command
waits for the next ID field to come round — so consecutive commands report consecutive
sectors even with the clock standing still, while a command half a revolution later picks up
where the disk has actually turned to, and one issued after time has gone *backwards* still
never hands back a sector the head has passed. Those are the assertions, and the first of
them is one `opus-test` had to teach this suite: modelling Read Address as an instantaneous
"what is under the head now" made two commands in a row give the same sector twice, which no
real chip does. A controller with no clock still walks 1…10 in turn so a loader can enumerate
a track.

Disk controller tests — BetaDisk (WD1793), PlusDDisk (WD1772), Microdrive (IF1), MGTLoader, MDRLoader, OPDLoader, DidaktikLoader (D40/D80 MDOS read + write: FAT packing, addFile/deleteFile/renameFile/setStartAddr round-trips); TR-DOS/SCL file copy **monoloader** coverage (`ui/disk-file-copy.js`): full-allocation verbatim copy (BASIC + CODE) with catalogue length/start/programLength preserved, normal BASIC/CODE negatives + boundary cases, `splitMonoloader` loader/payload split (lossless reconstruction); **SPECSCII banner** coverage (`core/specscii.js`): stream parse, `isBannerName`, encoder round-trip through `simulateListPrint` (cell-exact, incl. junk-row reset), `buildTRD`/`buildSCL` banner-entry injection + `decodeBannerNames` re-read; `gridToSpecscii`/`bannerNamesToSpecscii` extract round-trip

## `tests/depack-test.html`

ZX0/ZX7 depacker + packed-screen detection tests — round-trips (forward/backward), `detectPackedScreen` variants + entropy guard + size-gate/negatives + output-cap safety, `rcsToScr` inverse, `findDepackerSignature`/`findPackedScreenInBlock` (embedded loader: signature ID + `LD HL` pointer-parse locate), RCS auto-detect by image coherence, and the Hrust depacker (`isHrust`/`hrustDecompress` — base64 fixture round-trip + header guards)

## `tests/pristine-test.html`

Pristine (golden) byte-for-byte comparison: extracts files from a reference disk built by *other* software and asserts they match the `tests/pristine/src/` Hobeta sources. Skips if the disk is absent. See `tests/pristine/README.md`

## `tests/explorer-test.html`

Explorer UI tests — drives the **real** Explorer in an iframe over `index.html` (it is built around the app's DOM, so it can't be unit-tested in isolation): loads synthetic SNA/TAP/TRD/SCL/UDI fixtures through the file input and checks the info panels, catalogues, hex dump, and that switching files clears the previous one. Sections are independent, so one failure doesn't abort the run

The UDI fixture runs the other way from the rest: a TRD is encoded **into** MFM track bytes — sync zeros, three 0xA1 with their clock bits set, the address mark, the payload and a real CRC-16, with 0x4E gaps — so the assert is a round trip and the catalogue on screen has to be what went in. What the catalogue cannot see is which bytes the views are indexing, since it reads correctly from the flattened image either way; that is pinned by the two sizes shown having to differ, with the 640K one underneath the views. Then the three decisions the real sample images forced: a stale file checksum is reported and the disk still loads, the sectors a TRD has no room for are itemised separately from the ones it keeps with their deleted-data mark lost, and a lowercase `udi!` is refused by name. The format's own two sharp edges — the checksum is not a standard CRC-32, and the clock bitmap is LSB-first — are pinned against five real images in `udi-test`, not here

## `tests/mediasave-test.html`

Getting a disk back out of the emulator after a program has written to it, driven in the real app.
The write goes through the WD1793 as a program's would — poking `diskData` directly would pass even
if no write ever reached it. Covers: a disk starts unmarked and is marked once written; the bytes
offered for saving contain the write; an SCL saves back as SCL and a UDI offers a TRD rather than
pretending it can write a `.udi`; inserting another disk clears the mark; and the panel lists the
drive and the file in it.

The sharp one is the **project save**. `getLoadedMedia()` re-serialised FDC disks and IF1 cartridges
from live state but handed Beta Disk, +D, Opus and Didaktik over as the copies taken at load time, so
a project saved after a game wrote to a disk restored it as it was *before* the write, silently and
with nothing on screen to suggest it. The assert reads the saved image back and fails on the stale
byte; putting the snapshot back fails it.

## `tests/udi-fixture.js`

Not a suite — a fixture module (`run-tests.py` only picks up `*-test.html`). It builds a UDI out of
described sectors, writing the track bytes out longhand: sync zeros, three 0xA1 carrying clock bits,
the address mark, the payload, a real CRC-16, 0x4E gaps. It goes that way round deliberately, because
every other disk fixture here is a sector image and a sector image is exactly what cannot express the
things UDI support exists for — a 512-byte sector, a sector numbered outside 1–16, a deleted-data
mark, a wrong CRC, an ID field claiming another cylinder. The format's own two sharp edges (the file
checksum is not a standard CRC-32; the clock bitmap is LSB-first) are pinned against five real images
in `udi-test`, so a test built on this module is testing the consumer, not the format.

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

## `tests/udi-test.html`

UDI keeps raw track bytes and one clock bit per byte, so the two things worth
pinning are the two the spec gets wrong or leaves open, and both are pinned
against something other than our own code:

- **The file checksum.** Vectors come from a transcription of the reference C
  that reproduces three real images' stored checksums exactly, so the JS is
  measured against the reference rather than against itself. Replacing the
  arithmetic shift with a logical one (i.e. making it a standard CRC-32) fails 6
  asserts.
- **The clock bitmap bit order**, from the spec's own worked example. Flipping it
  to MSB-first fails 23 asserts.
- **Sector CRC-16**, using the covered bytes and the checksums that
  `ST_INHER.UDI` itself stores — passing means agreeing with the formatter that
  wrote the disk.
- **Decoding real track bytes**: 1600 bytes lifted out of that image with their
  clock map, asserted down to the sector numbers, sizes, both CRCs per sector,
  and that sector 1 really is the TR-DOS catalogue (its first entry is `BLOK`).
  Decoding *something* is not enough.

Then the decisions the sample images forced, each as its own assert: a bad
checksum is reported and the disk still loads (two of five real images disagree
with their own); trailing text after the last track is kept, not fatal (the
format author's own converter appends a comment); a header that under-declares
its cylinder count loses to the record count, with a warning. Finally what a TRD
cannot hold — 512-byte sectors, sectors numbered outside 1..16, deleted-data
marks, a bad sector CRC — is counted in `lost` rather than dropped quietly.
