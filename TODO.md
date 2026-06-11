# TODO

## Pending

- [ ] **halt2int test**: Investigate and fix timing/interrupt issue to pass HALT2INT test
  - Test file: `tests/halt2int.tap`
  - Author: Mark Woodmass
  - Reference: https://github.com/redcode/Z80/wiki/HALT2INT
  - Currently fails - need to analyze expected vs actual behavior

## Refactoring plan (long-term)

- [ ] **Split the `Spectrum` god object** (`core/spectrum.js`, ~9,400 lines, ~280 methods)
  - Mixes emulation, contention setup, debugging (breakpoints, call stack, trace), profiling,
    RZX handling, tape/disk integration, and screen rendering in one class
  - Extract incrementally, one concern at a time, keeping the `Spectrum` facade so callers
    (index.html, ui/ modules, tests) don't change:
    1. Contention setup (the large per-machine `setupContention` closures) → `core/contention.js`
    2. Breakpoint evaluation + debug call stack → `core/debug-hooks.js`
    3. RZX record/playback state machine → `core/rzx.js`
    4. Profiler/auto-map data collection → `core/profiler.js`
  - Verify each step with tests/system-test.html, breakpoint-test.html, tape-test.html
- [ ] **Split `core/loaders.js`** (~6,400 lines, 13+ loader classes)
  - Group into `core/loaders/` by media type: tape (TAP/TZX/WAV), snapshot (SNA/Z80/SZX/RZX),
    disk (TRD/SCL/MGT/MDR/OPD), archive (ZIP); keep `loaders.js` as a barrel re-export
    so existing imports keep working
  - Verify with tests/loader-test.html, disk-test.html, tape-test.html
- [ ] **Table-drive the assembler directive dispatch** (`sjasmplus/assembler.js`)
  - `processDirective()` is a ~75-case switch; replace with a directive→handler map
    (`{ ORG: this.dirORG, ... }`) so adding directives is one line
  - Split the ~220-line `processLine()` into `_collectMacro()`, `_collectRept()`,
    `_handleStructFields()`, etc.
  - Verify with tests/asm-test.html
- [ ] **Leveled logger** for debug output (`core/spectrum.js` has ~90 flag-gated console.log
  calls): a tiny `log(level, ...)` helper with a runtime level would replace the scattered
  `if (this.debugX) console.log(...)` pattern
