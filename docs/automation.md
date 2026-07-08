# Headless automation API (`window.zxDebug`)

A documented, stable surface for driving ZX-M8XXX from an external harness (e.g.
a headless Edge `--dump-dom` run for reverse-engineering / disassembly). It wraps
the execution map, the debug managers, the disassembly-toolchain exporters and
write provenance so drivers don't have to reach into emulator internals — which
the planned `Spectrum` refactor would otherwise break.

Everything is reachable from the page's `window` (in an iframe harness,
`frame.contentWindow.zxDebug`). `window.spectrum` remains available for lower-level
access; `zxDebug.spectrum` returns the same instance.

## Execution-based code/data map

```js
zx.enableMap(true, { fast: true });   // start recording (fast = touched-bitsets)
for (let i = 0; i < N; i++) zx.spectrum.runFrame();   // or replay an RZX
zx.enableMap(false, { fast: true });

const { ranges, pages } = zx.ranges();  // [{start,end,type:'code'|'db'|'text'}]
```

- **`enableMap(on = true, {fast = false})`** — turn recording on/off. `fast` records
  into flat 16-bit touched-bitsets (`Uint8Array(0x10000)`) instead of the rich
  `Map<key,count>`. Fast mode is **~10× cheaper per memory access** — use it for
  long RZX playthroughs where only coverage (code vs data) matters. It drops
  per-address counts and 128K page granularity. Recording only happens inside
  `runFrame()` (which sets `inExecution`); raw `cpu.step()` is **not** recorded.
- **`clearMap()`** — reset both the Maps and the bitsets.
- **`mapData()`** — `{executed, read, written}` as `Map<key,count>` (rich mode).
- **`mapBits()`** — `{execBits, readBits, writeBits}` as `Uint8Array(0x10000)` (fast
  mode; `null` until `fast` has been enabled once). `bits[addr] === 1` = touched.
- **`ranges(opts)`** — coalesced, typed ranges from whichever mode is active.
  Executed addresses are `code`; read/written are `db`; sustained printable runs
  become `text` (uses `spectrum.memory.read` by default). Pass `{textMinRun}` to
  tune the text threshold.

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

## Write provenance (who writes into a range)

Records which instruction PC writes into `[lo, hi]` and how often — a first-class,
range-scoped replacement for hand-wrapping the memory write callback. Cheap enough
for a full RZX replay (work happens only for in-range writes).

```js
zx.watchWrites(0xF800, 0xF8FF);
// ... run frames / replay an RZX ...
const writers = zx.stopWrites();
// [{ pc, count, callers:[addr,…] }], most-frequent first
```

`getWrites()` reads the current results without stopping; `stopWrites()` disables
recording and returns them. A **0-writers** result across a long replay is strong
evidence a "buffer" is dead during play (corroborate with static unreachability).

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

## Convenience

- **`runFrames(n)`** — `spectrum.runFrame()` × n.
- **`loadFile(fileOrBytes, name)`** — `spectrum.loadFile(new File(...))`; loads a
  snapshot/tape (`.sna/.z80/.szx/.tap/.tzx/.zip`). For `.rzx` use
  `spectrum.loadRZX(arrayBuffer)` (see the skill's `m8xxx-automap.md`).
- **`version`** — the app version string (matches `APP_VERSION`).

## Notes

- Recording requires `runFrame()`; `cpu.step()` bypasses the recording wrapper.
- `enableMap(true, {fast:true})` toggles fast mode *and* enables recording; to keep
  fast bitsets across separate recording windows, don't `clearMap()` between them.
- 128K: fast bitsets are a flat 16-bit space (pages unioned). For per-page counts
  use rich mode (`mapData()`), whose keys are `"addr:page"`.
