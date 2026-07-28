# Headless automation API (`window.zxDebug`)

A documented, stable surface for driving ZX-M8XXX from an external harness (e.g.
a headless Edge `--dump-dom` run for reverse-engineering / disassembly). It wraps
the execution map, the debug managers, the disassembly-toolchain exporters and
write provenance so drivers don't have to reach into emulator internals — which
the planned `Spectrum` refactor would otherwise break.

Everything is reachable from the page's `window` (in an iframe harness,
`frame.contentWindow.zxDebug`). `window.spectrum` remains available for lower-level
access; `zxDebug.spectrum` returns the same instance.

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
(skips rendering/audio). Use `spectrum.runFrame()` when you need the per-frame
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
const readers = zx.stopReads();
const runners = zx.stopExec();
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

## Notes

- Recording requires `runFrame()`; `cpu.step()` bypasses the recording wrapper.
- `enableMap(true, {fast:true})` toggles fast mode *and* enables recording; to keep
  fast bitsets across separate recording windows, don't `clearMap()` between them.
- 128K: **flat** fast bitsets (`{fast:true}`) union all banks into one 16-bit space —
  fine for a non-banking game, wrong for a bank-switcher. Use **paged** fast
  (`{fast:true, paged:true}`) to keep per-bank coverage without counts, or rich mode
  (`mapData()`, keys `"addr:page"`) when you also need per-address counts.
