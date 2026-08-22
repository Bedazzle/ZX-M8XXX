# M8XXX for external tools

**Read this first.** ZX-M8XXX is a ZX Spectrum emulator with a debugger, driven from
outside through `window.zxDebug` — a documented, stable surface. Most of what a tool
wants is already here; the commonest mistake is reimplementing something the emulator
already does, worse, because nothing said it existed.

No build step: serve the folder over HTTP, open `index.html` in a headless Chromium, wait
for the app, then drive `window.zxDebug` (in an iframe harness,
`frame.contentWindow.zxDebug`).

## Start here

```js
await zxDebug.ready();                 // ROM really in memory — see rule 1
zxDebug.require(['peek', 'poke', 'findBytes', 'disassemble', 'step']);
console.log(zxDebug.help());           // every member of *this* build, as markdown
```

- **`zxDebug.help()`** — the reference: every member with its signature and a one-line
  summary, grouped by category. Read it before writing a helper.
- **`zxDebug.help('peek')`** — one member.
- **`zxDebug.capabilities()`** — the same as data (`{name, sig, summary, category, since}`),
  sorted and JSON-safe, for a version check or a diff between builds.
- **`zxDebug.require([...])`** — throws one clear error naming what this build is missing
  and which version would have it. Call it at startup.
- **`await zxDebug.brief()`** — this page plus the full list, in one string, if you'd
  rather fetch it than read it.

## What it can do

Categories, so you know what to look for. `help()` has the members; nothing is listed
here that would go stale.

| | |
|---|---|
| **discovery** | Asking this build what it can do |
| **lifecycle** | Getting a machine ready, and reporting results back from a run |
| **memory** | Reading and writing memory — including patching a running program |
| **search** | Finding values, and finding text that isn't stored as text |
| **tables** | Recognising data tables by their shape (keyboard scans, vocabularies) |
| **disasm** | Disassembly, and handing a map to SkoolKit / Ghidra / sjasmplus |
| **execution** | Running, stepping, running until something happens, calling a routine |
| **breakpoints** | Execution breakpoints |
| **registers** | Reading and setting the register file |
| **map** | The execution-based code/data map — what is code, what is data |
| **provenance** | Which instruction read, wrote, called or jumped where |
| **differential** | Running twice with one thing changed, and finding where they diverge |
| **managers** | The debugger's own labels, regions, comments, xrefs, pokes |
| **keyboard** | Pressing keys without a keyboard |
| **media** | Loading tapes, disks, snapshots, RZX |
| **hooks** | Raw per-access callbacks |
| **ui** | Handles onto UI subsystems |

## The ten rules

These are the things `help()` cannot tell you. Each has cost someone a session.

1. **`await zxDebug.ready()` before anything.** `window.spectrum` and `window.zxDebug`
   appear during module init, but ROMs load *asynchronously*. A driver that starts early
   runs a blank `$0000-$3FFF`: every ROM call becomes a NOP sled, the program wanders off,
   and it looks like a deep problem instead of a race.

2. **If it isn't on `zxDebug`, say so — don't reimplement it.** `zxDebug.spectrum` is an
   escape hatch and **not a stable interface**; the planned `Spectrum` refactor will move
   things under it. Something reachable only through it is a gap in the API. Report the
   gap. A tool that quietly grows its own disassembler or memory search ends up with a
   worse one, and it breaks on the next refactor.

3. **`pause()` before `step`, `stepOver`, `runTo` or breakpoints.** They need the machine
   stopped and will throw if it isn't. To advance a *running* machine use `runFrames(n)`.

4. **Wall-clock time is frozen** under `--virtual-time-budget`: `Date.now()` and
   `performance.now()` read a constant. Pace and bound everything by frames or by
   `zxDebug.emuClock()`, never by elapsed time.

5. **`--dump-dom` only prints when the process exits.** A long run that is killed loses
   everything. Use `zxDebug.report(data, kind, name)` (via `serve.py`) to hand back
   progress and results while the run is still going.

6. **One `--user-data-dir` per headless run, and kill by it.** Headless Edge/Chrome often
   does not exit after `--dump-dom`, and orphaned processes hold the pipe open. Chromium
   also caches ES modules hard across runs, so a shared profile serves stale code after
   an edit.

7. **Fetch media with `zxDebug.loadUrl`, not your own fetch.** It bypasses the HTTP cache.
   A rebuilt file at the same URL otherwise replays the *old* bytes, and the symptom —
   output that looks shifted between two builds — sends you looking for a decoding bug.

8. **A chord is one call per key.** `keyDown('CAPS'); keyDown('Space')`, not
   `keyDown('caps space')`. An unknown name throws rather than doing nothing; `keyNames()`
   lists what is accepted.

9. **Both halves of a differential run must start from the same state.** Restore the same
   snapshot before each, or the first divergence is only wherever they already differed.
   (The `r` register always differs — it counts refreshes across both.)

10. **Bound every loop.** Frame loops, replay loops, retry loops. A desync or a bad file
    should end the run, not spin it.

## Where the detail lives

- **`zxDebug.help()`** — the surface of the build you are talking to. Start here.
- **[docs/automation.md](docs/automation.md)** — the same surface in prose, with recipes:
  patch a running program, find a value and see what writes it, break and look around,
  read text that isn't stored as text, find what one change did.
- **[docs/features.md](docs/features.md)** — which file implements a feature, if you are
  changing the emulator rather than driving it.

`tests/api-manifest-test.html` enforces that every member is declared and documented, and
that every category above is named here — so this page and the code cannot drift apart.
