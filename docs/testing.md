# Test suites: what each one covers

Run everything with `python run-tests.py`. This file is the per-suite detail;
CLAUDE.md lists the suites and the command.

## `tests/asm-test.html`

Z80 assembler test suite — instructions, directives, expressions, macros, built-in editor snippets (`data/asm-snippets.json`)

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

HALT + interrupt tests — a frame-start INT landing on a not-yet-executed HALT enters the halt state first so the handler returns to PC+1 (snapshot resume on an EI/HALT main loop, e.g. Shock megademo)

## `tests/disk-test.html`

Disk controller tests — BetaDisk (WD1793), PlusDDisk (WD1772), Microdrive (IF1), MGTLoader, MDRLoader, OPDLoader, DidaktikLoader (D40/D80 MDOS read + write: FAT packing, addFile/deleteFile/renameFile/setStartAddr round-trips); TR-DOS/SCL file copy **monoloader** coverage (`ui/disk-file-copy.js`): full-allocation verbatim copy (BASIC + CODE) with catalogue length/start/programLength preserved, normal BASIC/CODE negatives + boundary cases, `splitMonoloader` loader/payload split (lossless reconstruction); **SPECSCII banner** coverage (`core/specscii.js`): stream parse, `isBannerName`, encoder round-trip through `simulateListPrint` (cell-exact, incl. junk-row reset), `buildTRD`/`buildSCL` banner-entry injection + `decodeBannerNames` re-read; `gridToSpecscii`/`bannerNamesToSpecscii` extract round-trip

## `tests/depack-test.html`

ZX0/ZX7 depacker + packed-screen detection tests — round-trips (forward/backward), `detectPackedScreen` variants + entropy guard + size-gate/negatives + output-cap safety, `rcsToScr` inverse, `findDepackerSignature`/`findPackedScreenInBlock` (embedded loader: signature ID + `LD HL` pointer-parse locate), RCS auto-detect by image coherence, and the Hrust depacker (`isHrust`/`hrustDecompress` — base64 fixture round-trip + header guards)

## `tests/pristine-test.html`

Pristine (golden) byte-for-byte comparison: extracts files from a reference disk built by *other* software and asserts they match the `tests/pristine/src/` Hobeta sources. Skips if the disk is absent. See `tests/pristine/README.md`

## `tests/explorer-test.html`

Explorer UI tests — drives the **real** Explorer in an iframe over `index.html` (it is built around the app's DOM, so it can't be unit-tested in isolation): loads synthetic SNA/TAP/TRD/SCL fixtures through the file input and checks the info panels, catalogues, hex dump, and that switching files clears the previous one. Sections are independent, so one failure doesn't abort the run

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
