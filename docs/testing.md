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
