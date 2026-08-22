# Headless automation API (`window.zxDebug`)

A documented, stable surface for driving ZX-M8XXX from an external harness (e.g.
a headless Edge `--dump-dom` run for reverse-engineering / disassembly). It wraps
the execution map, the debug managers, the disassembly-toolchain exporters and
write provenance so drivers don't have to reach into emulator internals — which
the planned `Spectrum` refactor would otherwise break.

Everything is reachable from the page's `window` (in an iframe harness,
`frame.contentWindow.zxDebug`). `window.spectrum` remains available for lower-level
access; `zxDebug.spectrum` returns the same instance.

**Writing a tool that drives this?** Start with [M8XXX.md](../M8XXX.md) — one
page to paste into the tool's instructions: ask `zxDebug.help()` what the build has, plus
the rules that are not discoverable from the API. This file is the detail behind it.

## Running headlessly (harness setup)

M8XXX is a browser app with no build step, so a headless run is: serve the folder
over HTTP, open `index.html` in a headless Chromium (Edge/Chrome), wait for the app
to boot, then drive `window.zxDebug`. **No Node.js is required** — the core is
browser ES-modules that need `index.html` to bootstrap the ROMs, so there is no
DOM-free entry point today; all headless work goes through a browser.

```bash
# 1. Serve the repo root with serve.py — it sets the ES-module MIME type, sends
#    no-cache headers (a stale module after an edit is a classic time-sink), and
#    accepts results from the run (see "Reporting results" below).
python serve.py 8000 &

# 2. Drive it with a headless Chromium. Put your automation in a small page or
#    inject it; --dump-dom prints the final DOM once the process exits.
msedge --headless=new --disable-gpu --user-data-dir=/tmp/zxrun \
       --virtual-time-budget=60000 --dump-dom "http://localhost:8000/index.html"
```

**Readiness — `await zxDebug.ready()` before anything else.**

```js
await zxDebug.ready();                    // ROM in memory, machine bootable
await zxDebug.ready({ machine: '128k' }); // switch machine first (loads its ROM)
```

Resolves `{ machineType, romLoaded, running }`, or rejects with a message naming the
ROM file it couldn't get. `zxDebug.ensureRom(machineType)` loads a machine's ROM
without switching to it.

This matters more than it looks. `window.spectrum` and `window.zxDebug` appear during
module init, but ROMs are fetched **asynchronously** — a driver that grabs `spectrum`
and starts running immediately executes a blank `$0000-$3FFF`: every ROM call and RST
vector becomes a NOP sled, the game wanders off, and nothing moves on screen. That
looks like a deep problem ("this game needs low memory the dump lacks") when it is
just a race with the ROM fetch. `ready()` polls until `memory.read(0)` is real ROM,
and retries the fetch once if the startup load didn't happen.

## Reporting results (progress from a run that hasn't exited)

`--dump-dom` only prints when the process exits, so a long run — an RZX replay, a
full execution map — can't hand anything back until it finishes, and can't report
progress at all. `serve.py` accepts results:

```js
await zxDebug.report({ ranges }, 'result');        // -> headless/result.json
await zxDebug.report({ frame: n }, 'progress');    // -> headless/progress.json
await zxDebug.report(data, 'result', 'venom');     // -> headless/venom.json
```

The driver reads those files while the browser is still running (each write is
atomic, so a reader never sees a half-written file). `zxDebug.checkpoint()` remains
the DOM-only variant for when the page isn't served by `serve.py`.

**Loading a file that isn't one.** If a fetch 404s, the bytes handed to
`loadFile` are the server's error page. That used to surface as
`Failed to parse TAP file`; it now reports *"… is an HTML page, not a Spectrum file
— if it was fetched, the URL probably returned an error page (404)"*. Check the
staged file exists before suspecting the format.

**Stepping.** Use `spectrum.runFrameHeadless()` for deterministic frame stepping
(skips rendering/audio). It accepts interrupts exactly as `runFrame` does, including
the case where the loaded PC sits on a not-yet-executed `HALT` — which is where every
snapshot saved on an `EI`/`HALT` main loop lands, since loading one resets frame-start
T-states into the INT window. That used to be missing here, and the symptom is nasty:
the program runs one frame and freezes, but the screen still holds the snapshot's own
picture, so it looks like it is running. Check `cpu.iff1` and a port-write count, not
the screen. Covered by `tests/halt-int-test.html`. Use `spectrum.runFrame()` when you need the per-frame
listener chain — e.g. `zxDebug.autoLoad` and the RZX advance run there. For RZX,
prefer the one-call `zxDebug.replayRZX` (see below), which loops correctly to the
recording's true end.

**Sharp edges** (all observed in real runs):

- **`--virtual-time-budget` freezes the clock.** `Date.now()` / `performance.now()`
  read a frozen value in-page, so anything measuring wall-clock reads ~0. Pace and
  bound work by **frame counts** (`spectrum.totalFrames`, `zxDebug.rzxFrame`), never
  by elapsed time.
- **`--dump-dom` only emits on process exit.** A killed long run loses all output.
  For long jobs, write results incrementally (e.g. into a DOM node your harness
  polls, or `console.log` you capture via the DevTools protocol) and checkpoint,
  rather than accumulating everything for a single final dump.
- **Headless Edge/Chrome may not exit** after `--dump-dom`/`--screenshot`. Give each
  run its own `--user-data-dir` and kill by that (or `taskkill /F /IM msedge.exe`)
  so runs don't pile up as orphaned processes holding the pipe open.
- **Bound every replay loop.** Even with the termination fix, cap frame loops
  (`replayRZX`'s `maxFrames`, or your own counter) so a desync or a bad file can't
  spin forever.

## What this build has (`capabilities`, `help`, `require`)

The surface describes itself, because a document can't: a driver talks to whatever build
is deployed, and *"does this one have an encoded search"* depends on that build, not on
the docs someone read once. Tools that can't discover a feature reimplement it.

```js
const brief = await zx.brief();        // ← the one call to give an external tool
```

`brief()` is the rules a driver needs followed by the whole surface of this build, in one
markdown string — ready to log, or to hand to a model as context. The rules half comes
from [M8XXX.md](../M8XXX.md) so there is one copy of it; the API half is
generated, so it cannot go stale. If the doc can't be fetched you still get the API half
and a line saying which half is missing.

The pieces on their own:

```js
zx.require(['peek', 'searchEncodedText', 'recordRun']);   // first thing a driver does
// throws: "zxDebug.require: this is ZX-M8XXX 0.15.31 — too old: searchEncodedText (needs 0.15.32)"

zx.capabilities();     // {apiVersion, appVersion, categories, members:[{name, sig, summary, category, since}]}
zx.help('peek');       // one member, in prose
zx.help();             // the whole surface as markdown — the form to hand to a model
```

- **`require(names)`** — throws one clear error naming what is missing, what version would
  have it, and which build it is talking to. That turns a gap into a fixable message
  instead of a silent workaround that grows into a second implementation.
- **`capabilities()`** — sorted and JSON-safe, so two builds diff cleanly.
- **`help(name?)`** — prose for one member, or markdown for all of it.
- **`apiVersion`** — bumped when the *shape* of the surface changes, separately from the
  app version, which moves for reasons a driver doesn't care about.

The manifest lives in `core/api-manifest.js` and `tests/api-manifest-test.html` enforces
three things: every member is declared, every declaration still exists, and every member
is mentioned in this file. A self-description is worse than none once it drifts.

**`zxDebug.spectrum` is the escape hatch and is *not* a stable interface** — the planned
`Spectrum` refactor will move things under it. If you need something only reachable
through it, that is a gap in this API; say so rather than building on it.

## Primitives (memory, search, disassembly, stepping)

The plain operations a driver needs constantly. All of this was already inside the app;
none of it was reachable except through `zxDebug.spectrum`, so every tool that wanted to
read a byte reached into emulator internals.

**Memory** — through the current paging, as the CPU sees it:

```js
zx.peek(0x5C78);                 zx.poke(0x5C78, 0);
zx.peekWord(0x5C78);             zx.pokeWord(0x5C78, 0xBEEF);
zx.peekBlock(0x4000, 6912);      zx.pokeBlock(0x8000, [0x3E, 0x42, 0xC9]);
zx.peekBank(5);                  // a whole RAM bank whatever is paged in, or null
zx.snapshotMemory();             // a flat Uint8Array(65536) of the paged 64K
```

`pokeBlock` is how you patch a running program. `zxDebug.pokes` is a different thing — the
poke *manager*, for named cheat sets of the `.pok` kind.

**Search:**

```js
zx.findBytes('CD ?? 00', {from: 0x4000, to: 0x10000, limit: 200});   // ? / ?? = any byte
zx.findBytes([0x21, null, 0x40]);                                    // or bytes, null = any
zx.findBytes('00 FF', {bank: 7});                                    // one bank, whatever is paged
zx.findWord(23296);                                                  // the little-endian pair
```

Capped by `limit` (200): a one-byte needle matches hundreds of times and a list that long
is not an answer. For text that isn't stored as text, see **Encoded text search** below.

**Disassembly** — the reading of it; `exportCtl`/`exportCsv`/`exportSym` are for handing a
map to another toolchain:

```js
zx.disassemble(0x8000, 10);        // [{addr, bytes, text, length}]
zx.disassembleRange(0x8000, 0x8100);
```

**Stepping and running-to** need the machine stopped. The core returns a bare `false` when
it is running, which to a driver is a silent no-op — so these **throw** and name the fix:

```js
zx.pause();                        // zx.paused, zx.resume()
zx.step(1);                        // {steps, pc}
zx.stepOver();                     // runs a CALL/RST to completion
zx.runTo(0x8010);                  // {reached, pc}
zx.runToInterrupt();  zx.runToRet();
```

**Breakpoints and registers:**

```js
zx.addBreakpoint(0x8000);          // a number, or an address spec ("8000-80FF")
zx.breakpoints();                  // [{start, end, page, enabled}]
zx.removeBreakpoint(0);  zx.clearBreakpoints();

zx.captureRegisters();             // {pc, sp, a, f, bc, de, hl, ix, iy, …}
zx.setRegisters({pc: 0x8000, hl: 0x1234});   // an unknown name is an error, not a no-op
```

## Recipes

**Patch a running program** — find the instruction, change it, watch it stay changed:

```js
await zx.ready();
const hits = zx.findBytes('3D 32 ?? ??');        // DEC A ; LD (nn),A — a life counter
zx.pokeBlock(hits[0], [0x00, 0x00, 0x00, 0x00]); // NOP it out
```

**Find a value and see what writes it:**

```js
const addrs = zx.findWord(9999);                 // the score, say
zx.watchWrites(addrs[0], addrs[0] + 1);
zx.runFrames(200);
zx.stopWrites();                                 // [{pc, count, callers, callSites}]
```

**Break somewhere and look around:**

```js
zx.pause();
zx.addBreakpoint(0x8000);
zx.resume();                                     // …until it hits
zx.pause();
zx.disassemble(zx.captureRegisters().pc, 8);
```

**Read text that isn't stored as text:** `zx.searchEncodedText('TREASURE')` — see
[Encoded text search](#encoded-text-search).

**Find what one change did:** `zx.recordRun` twice and `zx.compareRuns` — see
[Differential runs](#differential-runs).

## Execution-based code/data map

```js
zx.enableMap(true, { fast: true });   // start recording (fast = touched-bitsets)
for (let i = 0; i < N; i++) zx.spectrum.runFrame();   // or replay an RZX
zx.enableMap(false, { fast: true });

const { ranges, pages } = zx.ranges();  // [{start,end,type:'code'|'db'|'text'}]
```

- **`enableMap(on = true, {fast = false, paged = false})`** — turn recording on/off.
  `fast` records into flat 16-bit touched-bitsets (`Uint8Array(0x10000)`) instead of
  the rich `Map<key,count>`. Fast mode is **~10× cheaper per memory access** — use it
  for long RZX playthroughs where only coverage (code vs data) matters. Flat fast
  drops per-address counts *and* 128K page granularity (all banks union into one
  16-bit space). `paged: true` keeps the cost-free bitsets but stores **one triple
  per memory page** (keyed like the rich-mode `addr:page`), so a bank-switching game
  maps correctly — two banks with code at the same address stay distinct. The paged
  hot path caches per-slot bitset pointers behind a paging signature, so it only does
  real work when paging actually changes. Recording only happens inside `runFrame()`
  (which sets `inExecution`); raw `cpu.step()` is **not** recorded.
- **`clearMap()`** — reset the Maps, the flat bitsets, and the per-page bitsets.
- **`mapData()`** — `{executed, read, written}` as `Map<key,count>` (rich mode).
- **`mapBits()`** — `{execBits, readBits, writeBits, paged, pagedBits}`. Flat fast:
  `execBits`/etc. are `Uint8Array(0x10000)` (`bits[addr] === 1` = touched), `paged`
  false. Paged fast: the flat three are `null`, `paged` is true, and `pagedBits` is a
  `Map<label,{execBits,readBits,writeBits}>` — one flat-16-bit triple per page (label
  per `getAutoMapKey`: RAM page numbers, ROM banks `R0`/`R1`…, `''` = unpaged fixed
  RAM / 48K).
- **`ranges(opts)`** — coalesced, typed ranges from whichever mode is active.
  Executed addresses are `code`; read/written are `db`; sustained printable runs
  become `text` (uses `spectrum.memory.read` by default). Pass `{textMinRun}` to
  tune the text threshold. In paged mode the result also carries `byPage`
  (`{[label]: {ranges}}`) alongside the unioned flat `ranges`/`pages`.
- **`rangesByPage(opts)`** — just the per-page ranges `{[label]: {ranges, pages}}`
  (paged mode only; `{}` otherwise). Use this to disassemble each bank separately.

## Debug managers

`zx.labels`, `zx.regions`, `zx.comments`, `zx.xrefs` are the live manager
instances. Read or add:

```js
zx.labels.add({ address: 0x8000, name: 'main_loop' });
zx.regions.add({ start: 0x9000, end: 0x90FF, type: 'dw' });
zx.comments.set(0x8003, { inline: 'store the frame counter' });
```

## Disassembly-toolchain exports

Return strings, wired to the live managers + current map (fast or rich):

- **`exportCtl(opts)`** — SkoolKit control file: `c`/`b`/`t`/`w` blocks from the map,
  user regions overlaid, `@ ADDR label=NAME` and `N ADDR comment` directives.
- **`exportCsv()`** — Ghidra `address,name,comment` (the shape the ZX-disasm
  `apply_labels.py` imports).
- **`exportSym()`** — sjasmplus `NAME: EQU 0x…`, name-sorted.

These are the same serializers the Memory Map dialog's `.ctl`/`.csv`/`.sym` buttons
use (`core/map-export.js`).

## Provenance: who writes, reads or runs a range

Records which instruction touches `[lo, hi]` and how often — a first-class,
range-scoped replacement for hand-wrapping the memory callbacks. Cheap enough for a
full RZX replay (work happens only for in-range accesses).

```js
zx.watchWrites(0xF800, 0xF8FF);   // who writes this buffer?
zx.watchReads(0x9000, 0x90FF);    // who consumes this data block?
zx.watchExec(0xA000, 0xA0FF);     // is this block code, and who calls it?
// ... run frames / replay an RZX ...
const writers = zx.stopWrites();  // getWrites() reads without stopping
const readers = zx.stopReads();   // getReads() likewise
const runners = zx.stopExec();    // getExec() likewise
```

Each returns `[{ pc, count, callers, callSites }]`, most-frequent first:

- `pc` — for writes/reads, the instruction that did it; for exec, the executed address.
- `callers` — routines entered to reach it, outermost first.
- `callSites` — the `CALL`/`RST` instruction that entered each of those routines.

A **0-hit** result across a long replay is strong evidence a "buffer" is dead during
play (corroborate with static unreachability — silence in one recording is not proof).

## Calling a routine directly

For an effect that gameplay can't reach from a harness (a reward, a pickup, a state
change behind menus), call the routine and read what it changed:

```js
const r = zx.callRoutine(0x8F20, { regs: { a: 3, hl: 0x5C00 }, sp: 0x7FF0 });
// { returned, halted, timedOut, steps, tStates, regs:{a,f,bc,de,hl,ix,iy} }
```

It pushes a return marker, runs until the routine returns to it, and restores the CPU
state afterwards — no HALT sentinel to poke, no frame pumping to hand-roll. Interrupts
are off during the call unless you pass `interrupts: true`; a routine that never
returns comes back as `timedOut` (raise `maxSteps`) rather than looking like a wrong
answer. Provenance still records during the call; auto-map does not (it only records
inside `runFrame`) — pass `frames: true` if you need mapping, or if the routine waits
for an interrupt.

**Trust the state you peek afterwards over `returned`**: a print or pause tail may not
complete under the marker, but state effects (gold, item bits, "used" marks) are
applied before it. Pick `sp` in the game's own stack region so you clobber nothing.

## Resolved indirect jumps (dispatch targets)

Records the **runtime targets** of `JP (HL)` / `JP (IX)` / `JP (IY)` — the
dispatch-table / state-machine edges a static disassembler (Ghidra) can't recover.

```js
zx.watchIndirect();
// ... run frames / replay an RZX ...
const jumps = zx.getIndirect();   // [{ site, kind, targets:[{target,count}] }]
const csv = zx.exportIndirectCsv();  // Ghidra address,name,comment (one row/site)
```

`getIndirect()` / `stopIndirect()` return the structured data; `exportIndirectCsv()`
gives an `apply_labels.py`-ready CSV where each site's comment lists its resolved
targets (e.g. `JP (HL) → $9300(5) $9400(2) [2 targets]`). Import that into Ghidra to
turn its dead-end indirect jumps into documented dispatch edges. Only recorded while
enabled (off by default — the CPU hot loop just checks a flag).

## Self-modifying code (SMC)

Addresses that were **both executed and written** at runtime — code that patches
itself. It breaks byte-exact rebuilds and makes static disassembly wrong (Ghidra
reads the pre-patch bytes), so flag it. Computed from the active auto-map:

```js
const smc = zx.getSmc();         // [{start,end}] ranges (needs exec + write recorded)
const csv = zx.exportSmcCsv();   // Ghidra address,name,comment, one row per range
```

Needs both execution and writes recorded — enable the map (fast or rich) across the
run first.

## Runtime call graph

Observed `CALL`/`RST` caller→callee edges, including **self-modified CALL targets**
and remapped RST vectors that static xref analysis misses.

```js
zx.watchCalls();
// ... run frames / replay an RZX ...
const calls = zx.getCalls();          // [{caller, callees:[{callee,count}]}]
zx.stopCalls();                       // stop recording; getCalls() still reads
const csv = zx.exportCallGraphCsv();  // Ghidra CSV, callee-indexed ("who calls this")
```

`exportCallGraphCsv()` is **callee-indexed** — each routine entry's comment lists its
callers (`called from $8005(3) $8200 [2 callers]`), the form the naming workflow
wants. Diff it against Ghidra's static xrefs to isolate the runtime-only (computed)
edges. Off by default; recorded only while enabled.

## Deterministic boot / auto-load

`autoLoad(opts)` boots a *loaded* tape or disk to the running game, headless and
deterministically — no scripted-keyboard fragility, no hand-built `.z80`. It reuses
the frame-driven auto-loader (which types `LOAD ""` / picks the menu / RUNs the
boot file, scheduled by emulated frame) but skips the rAF `start()` and pumps
`runFrame()` itself, so it advances step-for-step under the harness.

```js
await zx.loadFile(tapeBytes, 'game.tap');
const r = await zx.autoLoad({ type: 'tape' });   // { frames, pc, timedOut }
// game is now loaded & running — map it, screenshot it, etc.
```

Options: `type` (`'tape'` | `'trd'` | `'dsk'`), `isTzx` (tape), `diskRun` (TR-DOS:
a filename to `RUN`, else the boot file), `maxFrames`, `settleFrames`. Keep
**flash load on** (`spectrum.setTapeFlashLoad(true)`) for an instant tape load;
real-time loading works too but needs a larger `settleFrames`. Resolves once the
typed sequence finishes plus a settle window for the ROM to run the load. 128K /
Pentagon / +2 / +2A / +3 and TR-DOS/+3 boots are handled by the same machine-aware
sequences the UI uses.

## Raw access hooks

`onAccess({onFetch, onRead, onWrite})` registers callbacks fired on **every** CPU
opcode fetch / memory read / memory write — without enabling a monitor and without
wrapping the managed `cpu.onFetch` / `memory.onRead` (which are `null` unless a
feature needs them, and reassigning the stored `_cpuFetchCallback` after init does
nothing — you'd have to wrap the live one). This is the documented registration
point that avoids that trap. Returns a disposer; `offAccess()` also clears them.

```js
const seen = new Set();
const stop = zx.onAccess({
    onFetch: (addr) => seen.add(addr + ':' + spectrum.memory.currentRamBank), // per-page PC
    onWrite: (addr, val) => { /* … */ },
});
await zx.replayRZX(bytes);
stop();   // unregister (or zx.offAccess())
```

- `onFetch(addr)` fires on M1 opcode fetches; `onRead(addr,val)` / `onWrite(addr,val)`
  fire on **all** reads/writes (gate on `spectrum.cpu.isFetching` /
  `spectrum._inCpuExecution` if you want CPU-execution-only).
- Inside a hook, read spectrum state synchronously — `spectrum.cpu.pc`,
  `spectrum.memory.currentRamBank`, etc. — for context the flat `addr` alone lacks.
- Any subset of the three may be supplied; omitted keys are cleared. Last
  registration wins (one hook per type). Recording still only happens inside
  `runFrame()`/`runFrameHeadless()`; raw `cpu.step()` bypasses the wrapper.
- For code/data coverage specifically, prefer the built-in paged fast map
  (`enableMap(true, {fast:true, paged:true})`) — it already resolves per-page
  identity cheaply. Reach for `onAccess` when you need a custom recorder the
  built-ins don't cover.

## Checkpointing (survive a killed headless run)

Under headless Edge `--virtual-time-budget` the real clock freezes and `--dump-dom`
only emits on process exit, so a long run that's killed loses everything. Two
built-ins address that:

- **`emuClock()`** — `{frames, tStates, seconds}` from the emulated frame/T-state
  counters (`totalFrames × tstatesPerFrame ÷ cpuClock`). Use this instead of
  `Date.now()`/`performance.now()`, which read ~0 under `--virtual-time-budget`.
- **`checkpoint(data)`** — writes the latest progress (`{seq, frames, tStates,
  seconds, data}`) into a hidden `#zxDebugCheckpoint` DOM node, replacing the prior
  one. A harness polls it mid-run via the DevTools protocol, or recovers the last
  value from the final `--dump-dom` even if the run was killed. **`getCheckpoint()`**
  reads it back (parsed, or `null`).

```js
for (let i = 0; i < 1_000_000; i += 5000) {
    zx.runFrames(5000);
    zx.checkpoint({ pass: 'coverage', framesDone: i, ranges: zx.ranges().ranges.length });
}
// If killed at frame 640000, the final --dump-dom still holds #zxDebugCheckpoint
// with { seq, frames, seconds, data:{ framesDone: 640000, … } } — resume from there.
```

`replayRZX` auto-checkpoints at each `progressEvery` tick and at the end (`{phase:
'replayRZX', rzxFrame, rzxTotal, played, done}`), so a killed replay leaves its last
position recoverable without any extra wiring.

## RZX replay

`replayRZX(fileOrBytes, opts)` loads an RZX and plays it to its true end in one
call — no hand-rolled frame loop, no need to know the frame count. The loop is
bounded by `rzxPlaying` (playback now terminates correctly at the last frame), with
`maxFrames` only as a safety backstop (default = recording length + 16). Uses
`runFrameHeadless()` by default.

```js
const r = await zx.replayRZX(rzxBytes, {
    onProgress: (frame, total) => console.log(frame + '/' + total),
    progressEvery: 5000,          // onProgress cadence (frames); default 1000
});
// r = { frames, played, atEnd }  — atEnd is false only if maxFrames capped it
```

Options: `onProgress(frame,total)`, `progressEvery` (default 1000), `maxFrames`
(default `frames + 16`), `headless` (default `true`). Read-only state getters:
`rzxPlaying`, `rzxFrame`, `rzxFrameCount` (end of playback ⇔ `rzxPlaying === false`).

## Convenience

- **`runFrames(n)`** — `spectrum.runFrame()` × n.
- **`loadFile(fileOrBytes, name)`** — `spectrum.loadFile(new File(...))`; loads a
  snapshot/tape (`.sna/.z80/.szx/.tap/.tzx/.zip`). For `.rzx` prefer `replayRZX`
  above (or `spectrum.loadRZX(arrayBuffer)` for manual stepping).
- **`loadUrl(url, {name})`** — fetch and load in one call, with `cache: 'no-store'`.
  Use this instead of your own `fetch`: the browser's HTTP cache persists across runs
  via `--user-data-dir`, so a rebuilt tape at the same URL silently replays the **old**
  bytes (a decode that looks byte-shifted between two builds is usually this, not a
  real shift). Returns `{ name, bytes, lastModified, result }` — log `lastModified` and
  you know which build you measured.
- **`version`** — the app version string (matches `APP_VERSION`).

## Keyboard (and ghosting)

A headless run has no real keyboard, so hold matrix keys directly. Key names are the
ULA's own: `'q'`, `'Enter'`, `' '`, `'CAPS'`, `'SYM'`.

```js
zx.keyDown('q'); zx.keyDown('w'); zx.keyDown('a');
zx.runFrames(200);                       // the ROM must reach its input loop first
zx.keyUp('q'); zx.keyUp('w'); zx.keyUp('a');
```

- **`typeText(text, {hold, gap})`** — type a string, pumping frames itself so it works
  while the emulator is stopped. `\n` is ENTER, `' '` is SPACE; `hold` and `gap` are in
  frames (4 each by default), because the ROM samples the keyboard once per interrupt
  and anything shorter than a frame is never seen.

  ```js
  await zx.autoLoad({ type: 'tape' });
  zx.typeText('0\n');                      // answer the program's INPUT prompt
  ```

  Needed by test programs that ask a question before doing anything. Woodmass' Snow
  Contention prompts for a T-state with `INPUT`, and a run that never answered sat in
  the ROM's key wait looking exactly like a failed auto-load — so check the PC against
  the ROM before concluding a tape did not load.
- **`keyDown(key)` / `keyUp(key)`** — press/release in the matrix (`ula.keyDown/keyUp`).
  **A name the ULA does not know throws here.** A chord is one call per key, so a
  driver that writes it as one string gets told exactly that:

  ```
  zxDebug.keyDown: no ZX key named 'caps space' — a chord is one call per key:
  zxDebug.keyDown('CAPS'); zxDebug.keyDown('Space')
  ```

  The reason for the noise is that the failure is otherwise invisible: the press does
  nothing, the run carries on, and whatever the program did next gets explained some
  other way. Real key events stay silent — the browser sends every key the PC has, most
  of which the Spectrum hasn't — so at the ULA the answer is a return value instead:
  `ula.keyDown/keyUp` return `true` when the key existed, and `ula.hasKey(name)` asks
  without pressing.
- **`keyNames()`** — every name the two above accept (134 of them: the `e.code` names,
  the typed characters, and the punctuation). `ula.resolveKeyName('cs')` → `'CAPS'`
  turns a loose spelling into the right name, for reporting — a press still has to name
  a key exactly.
- **`readKeyboardPort(port)`** — read a half-row, e.g. `readKeyboardPort(0xFDFE)`.
- **`setKeyboardGhosting(on)`** / **`keyboardGhosting`** — the Settings → Input toggle.
  Off by default. On, the matrix behaves as the hardware does: keys held in different
  half-rows on the same column short those rows together, so three keys at the corners
  of a rectangle make a fourth read as pressed. It survives a machine switch, and the
  Settings checkbox follows the API so the UI never disagrees with the run.

Two traps when checking whether a *running* program sees this:

- The CPU reads through **`ula.readKeyboard(highByte)`**, not `ula.readPort(port)` —
  hook the former if you are instrumenting scans. Ghosting lives in `readKeyboard`, so
  both entry points and `runFrameHeadless` are covered either way.
- A freshly reset 48K does not scan the keyboard for ~83 frames (see
  [Deterministic boot](#deterministic-boot--auto-load)). A few frames after `ready()`
  will show no scans at all, which looks like the feature is off.

## One call: boot, run, export the map

`mapRun()` is the whole boot → run → export sequence, so a driver doesn't rebuild it:

```js
const m = await zxDebug.mapRun({ url: 'game.tzx', frames: 3000 });
const m = await zxDebug.mapRun({ rzxUrl: 'walkthrough.rzx', smc: true, calls: true });
const m = await zxDebug.mapRun({ url: 'game.trd', type: 'trd', diskRun: 'game' });
```

It awaits `ready()`, loads the media (or the RZX), records a paged fast map while it
runs the frames (or replays the recording to its end), then returns everything:

```
{ machineType, media, frames, played?, atEnd?,
  ranges, pages, byPage,          // coalesced code/data
  ctl, csv, sym,                  // SkoolKit / Ghidra / sjasmplus exports
  smcCsv?, indirectCsv?, callGraphCsv? }   // with smc / indirect / calls: true
```

`ranges` entries are typed `code` | `db` | `text`. Recording is switched off again
before it returns. Pass `report: true` (or `report: 'name'`) to post the whole object
to `serve.py`'s sink, so the driver just reads `headless/name.json`. `onProgress(done,
total)` fires every `progressEvery` frames for both the frame-run and replay paths.

## Differential runs

Run the same thing twice with one variable changed and find where the two runs stop
agreeing. The Code Path tool already answers *what did this run reach that the other
didn't* — a set difference — but a set has no order, so it cannot say **where** they
parted company. This records the program counter in order and compares the streams.

```js
const before = zx.captureRegisters();          // and a save state, see below
const a = await zx.recordRun(() => zx.runFrames(50), { limit: 1 << 20 });
// ...restore the same starting state, change the one variable...
const b = await zx.recordRun(() => zx.runFrames(50), { limit: 1 << 20 });

const d = zx.compareRuns(a, b);
// d.at        -> { index, a:{pc,bank}, b:{pc,bank}, reason, lengths }
// d.context   -> { common:[…], a:[…], b:[…] }  the run-up, then the two branches
// d.memory    -> { first, count, runs:[{addr,length}], truncated }
// d.registers -> [{ name, a, b }]
// d.truncated -> either trace hit its limit, so proves nothing past its end
```

The same thing is in the UI, in the debugger's **Code Path** tab: the **Diff run** row
takes a frame count and a `8000=1` change, and does the snapshot/restore/compare itself.

**Both runs must start from the same state**, or the first divergence is only wherever
they already differed — restore the same save state (`getDisplayAPI().saveSlots`) before
each. The `r` register will differ regardless, since it counts refreshes across both.

- **`recordRun(fn, opts)`** — trace `fn` (sync or async), then capture memory and
  registers. `opts.limit` is a hard ceiling in entries, **not a ring**: a differential
  compares from the start, so the beginning is what must be kept. Four bytes an entry, so
  the default 1M is 4MB and roughly a third of a second of 48K execution. `opts.from`/`to`
  restrict which addresses are recorded (keeping the ROM out of a trace, say).
  `opts.memory: false` skips the 64K copy.
- **`startExecTrace(opts)` / `stopExecTrace()`** — the recorder alone, for a driver that
  wants to pump the frames itself. Returns `{pcs, count, truncated, limit}`.
- **`snapshotMemory()`** — a flat `Uint8Array(65536)` of the paged 64K as it stands.
- **`captureRegisters()`** — a plain object of the register file.
- **`compareRuns` / `firstDivergence` / `divergenceContext` / `diffMemoryImages` /
  `diffRegisters`** — the comparison itself (`core/divergence.js`, pure).

One entry per **instruction**, not per byte: `cpu.onFetch` fires for operand bytes too
(the auto-map wants that), so the recorder takes only the opcode fetch. The paged RAM bank
rides in the entry's high bits, so two runs reaching the same address through different
paging are not mistaken for agreeing — `pcOf()` and `bankOf()` split them.

## Encoded text search

Game text is very often not stored as text, and a plaintext search reports the same
"nothing" whether the word is absent or merely enciphered. These try the ladder: plain,
complemented, XOR or offset by any key, the character's position folded into the key, and
nibble packing (`core/encoded-search.js`).

```js
zx.searchEncodedText('TREASURE');
// [{ addr, encoding:'sub-pos', key:0x3B, label:'c − ($3B + i)', length, text, note }, …]
zx.searchEncodedBytes(fileBytes, 'TREASURE');       // the same over a file
zx.decodeEncoded(addr, encoding, key, 40);          // read on past the match
```

- **`searchEncodedText(text, opts)`** / **`searchEncodedBytes(bytes, text, opts)`** —
  `opts.from`/`to` bound the range, `truncate: 5` matches only the first five characters
  (a PAW/Quill vocabulary keeps five), `cases: false` stops trying upper/lower,
  `bit7: false` stops trying the bit-7 end marker, `nibble: false` skips the packed search.
- **`decodeEncoded(addr, enc, key, length, startIndex)`** / **`decodeEncodedBytes(...)`** —
  undo the scheme so the record *around* the hit can be read, which is usually the point.
  A positional scheme needs the real `startIndex` or it decodes to nonsense.
- **`encodings`** — the schemes and how many keys each has.

Cost does not grow with the number of schemes: every (scheme, key) pair is encoded once
and indexed by the byte the needle would start with, so a position only verifies the few
pairs that could begin there. The same search is in the debugger's **Search** box (type
**Encoded**) and in the Explorer's **Hex Dump → Find** row.

## Data-table recognisers

Signature packs match *code* byte patterns. These find tables, which have no opcodes to
anchor on and are recognised by shape instead (`core/table-scan.js`). Every result is a
lead, not a proof.

```js
zx.findKeyScanTables();   // (half-row, key bit) records — a game's controls
zx.findCharTables();      // runs of printable bytes of a key-table length
zx.findWordTables();      // fixed-record word tables (PAW/Quill vocabularies)
zx.vocabularyByValue(table);   // [{word, value, type, addr, outlier}] in value order
```

Each takes `(from = 0x4000, to = 0x10000, opts)`. The vocabulary scanner does not
brute-force the encoding: entries are space-padded, so the commonest byte in the first
records is almost certainly that pad, and assuming it is a space gives one key per scheme
to check rather than 256. Plain, complemented and high-bit-set are always tried.

`vocabularyByValue` is the reading that pays. A game whose words run 11, 57, 71 and then
has two at 200 and 201 is saying what those two are for; `outlier: true` marks them. The
same three scans are in the debugger's **Search** tab, in the **Tables** card.

## UI handles (pokes, save states, rewind)

Some features only exist as UI modules; these handles let a driver or a test use
them without clicking.

```js
// POKE manager — .pok cheat files and the native JSON
zxDebug.pokes.loadPokFile(text, 'manic.pok');   // { count, warnings }
zxDebug.pokes.loadPokeJSON(text);

// Save states: nine slots, F2/F5 act on the current one
const display = zxDebug.getDisplayAPI();
display.quicksave(3);                 // save to slot 3
await display.quickload(3);
display.saveSlots.list();             // [{ index, used, machine, time, title, bytes }]
display.cycleSlot();

// The assembler panel and its virtual filesystem
const asm = zxDebug.getAsmAPI();      // the ASM tab: compile, load a project, read output
zxDebug.vfs.addFile('main.asm', text);
zxDebug.assembler.assemble(text);

// Rewind ring (see core/rewind.js)
window.zxRewind.buffer.stepBack();
window.zxRewind.buffer.resume();
```

```js
// Application test runner (tests/tests.json) — the Tools → Tests tab's own engine
const tr = zxDebug.testRunner;
tr.running = true;                                  // see the trap below
const result = await tr.runSingleTest(entry);       // { passed, diff, step, frame }
tr.running = false;
```

Three traps worth knowing:

* **`runSingleTest` types nothing unless `running` (or `previewing`) is true.** Every
  wait inside `injectLoadCommand` goes through `runFramesWithAbortCheck`, which
  returns immediately when both are false — so the tape loads, nothing is typed, and
  the test quietly grades the boot screen. Set the flag before the call.
* **To capture what the runner drew, intercept it**, don't read the screen
  afterwards: `runSingleTest` restores the machine in its `finally`, so by the time
  it resolves the framebuffer is gone. Stub `loadPristineImage` to return any
  `ImageData` and `compareScreens` to keep its first argument — that is exactly the
  image the comparison would have used, which is how `tests/*.png` references are
  generated.
* Snapshotting before the ROM has loaded captures a **blank machine** — call
  `await zxDebug.ready()` first, or a save/load round-trip passes while proving
  nothing.
* Rewind captures from `spectrum.addFrameListener`, and only `runFrame` notifies
  listeners. A driver stepping with `runFrameHeadless` records no rewind states.

## Notes

- Recording requires `runFrame()`; `cpu.step()` bypasses the recording wrapper.
- `enableMap(true, {fast:true})` toggles fast mode *and* enables recording; to keep
  fast bitsets across separate recording windows, don't `clearMap()` between them.
- 128K: **flat** fast bitsets (`{fast:true}`) union all banks into one 16-bit space —
  fine for a non-banking game, wrong for a bank-switcher. Use **paged** fast
  (`{fast:true, paged:true}`) to keep per-bank coverage without counts, or rich mode
  (`mapData()`, keys `"addr:page"`) when you also need per-address counts.
