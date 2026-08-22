# Feature index: where each thing lives

A bug report names a *feature*, not a file. This maps one to the other, so a fix
starts with three files open instead of a grep.

Columns: the logic, the UI module that drives it, the markup ids it owns, its test
suite, and the user-facing docs. "—" means that layer doesn't exist for it.

## Emulation

| Feature | Logic | UI | Markup | Test | Docs |
|---------|-------|----|--------|------|------|
| Z80 CPU | `core/z80.js` | — | — | `fuse-test` | — |
| Memory / paging | `core/memory.js`, `core/machines.js` | `ui/machine-selector.js` | `machineSelect` | `memory-test`, `machine-test` | `docs/machines.md` |
| Video, border | `core/ula.js` | `ui/display-settings.js` | `screen`, `borderSizeSelect` | `system-test` | `docs/rendering.md` |
| ULAplus | `core/ula.js` (`ulaplus`) | `ui/display-settings.js` | `chkULAplus`, `ulaplusPalette*` | `system-test`, `szx-peripherals-test` | `docs/rendering.md` |
| Sound (beeper, AY) | `core/ay.js`, `core/audio-processor.js` | `ui/display-settings.js` | `chkSound`, `volumeSlider`, `stereoMode` | `tape-test` | `docs/rendering.md` |
| Keyboard | `core/ula.js` (keyMap), `core/spectrum.js` | `ui/input-settings.js`, `ui/virtual-keyboard.js` | `selCapsShiftKey`, `virtualKeyboard` | `system-test` | `docs/peripherals.md` |
| Keyboard ghosting | `core/ula.js` (`_ghostedRows`, `setKeyboardGhosting`) | `ui/input-settings.js` | `chkKeyboardGhosting` | `system-test` | `docs/peripherals.md` |
| Scripted key presses | `core/ula.js` (`hasKey`, `keyNames`, `resolveKeyName`) | `ui/app-init.js` (`assertZXKey`) | — | `system-test` | `docs/automation.md` |
| ULA snow | `core/ula-snow.js`, `core/ula.js` (`_displayRam`) | `ui/display-settings.js` | `chkUlaSnow` | `snow-test` | `docs/rendering.md` |
| ULA ink edge skew | `core/ula-inkskew.js`, `core/ula.js` (`inkSkew`) | `ui/display-settings.js` | `chkInkSkew` | `inkskew-test` | `docs/rendering.md` |
| PAL composite (RF) | `core/pal-composite.js`, `core/ula.js` (`setPalComposite`) | `ui/display-settings.js` | `chkPalComposite` | `pal-test`, `chromatrons`, `chromatrons-pentagon` | `docs/rendering.md` |
| Joysticks | `core/joystick.js`, `core/spectrum.js` | `ui/input-settings.js`, `ui/gamepad.js` | `selJoystickType`, `joyCustomKeys`, `chkKempston` | `joystick-test` | `docs/peripherals.md` |
| Kempston mouse | `core/spectrum.js` | `ui/input-settings.js` | `chkKempstonMouse` | `system-test` | `docs/peripherals.md` |

## Media

| Feature | Logic | UI | Markup | Test | Docs |
|---------|-------|----|--------|------|------|
| Tape (TAP/TZX/WAV) | `core/loaders/tape.js` | `ui/media-catalog.js`, `ui/file-loader.js` | `tapeInfo`, `tapeProgress` | `tape-test`, `loader-test` | `docs/media.md` |
| Auto Load | `ui/auto-loader.js` | `ui/file-loader.js` | — | (headless) | `docs/media.md` |
| Beta Disk / TR-DOS | `core/loaders/disk-beta.js` | `ui/media-catalog.js` | `diskInfo`, `diskActivity` | `disk-test` | `docs/peripherals.md` |
| +D / MGT | `core/loaders/disk-mgt.js` | `ui/input-settings.js` | `chkPlusD` | `disk-test` | `docs/peripherals.md` |
| Interface 1 / Microdrive | `core/loaders/microdrive.js` | `ui/input-settings.js` | `chkIF1` | `disk-test` | `docs/peripherals.md` |
| Opus (image format only) | `core/loaders/disk-opus.js` | `ui/explorer.js` | — | `loader-test` | `docs/peripherals.md` |
| Didaktik D40/D80 | `core/loaders/disk-didaktik.js` | `ui/explorer-editors.js` | — | `disk-test` | `docs/peripherals.md` |
| +3 FDC / DSK | `core/fdc.js` | `ui/media-catalog.js` | `diskActivity` | `fdc-test` | `docs/peripherals.md` |
| ZIP archives | `core/loaders/zip.js` | `ui/file-loader.js` | `zipSelectModal` | `loader-test` | `docs/media.md` |

## State

| Feature | Logic | UI | Markup | Test | Docs |
|---------|-------|----|--------|------|------|
| Snapshots (SNA/Z80/SZX) | `core/loaders/snapshot.js`, `core/loaders/szx.js` | `ui/file-loader.js` | `loadSelect`, `saveSelect` | `loader-test`, `snapshot-parse-test` | `docs/snapshot-formats.md` |
| Peripheral state in snapshots | `core/loaders/szx.js`, `core/spectrum.js` (`_snapshotPeripherals`, `_snapshotMedia`) | — | — | `szx-peripherals-test` | `docs/snapshot-formats.md` |
| Save slots (F2/F5/Shift+F2) | `core/save-slots.js` | `ui/display-settings.js` | `slotInfo`, `slotStatus` | `save-slots-test` | `docs/snapshot-formats.md` |
| Rewind (Ctrl+arrows) | `core/rewind.js` | `ui/app-init.js`, `ui/keyboard-shortcuts.js` | — | `rewind-test` | `docs/snapshot-formats.md` |
| RZX record/playback | `core/loaders/rzx.js` | `ui/rzx-recorder.js` | `rzxInfo`, `rzxStatus` | `loader-test` | `docs/snapshot-formats.md` |

## Assembler

| Feature | Logic | UI | Markup | Test | Docs |
|---------|-------|----|--------|------|------|
| Assembler core | `sjasmplus/*.js` | `ui/assembler-ui.js` | `asmEditor`, `asmOutput` | `asm-test` | `docs/assembler.md` |
| Project files / VFS | `sjasmplus/vfs.js` | `ui/assembler-ui.js` (`addProjectFiles`) | `asmFileSelect` | `asm-vfs-test` | `docs/assembler.md` |
| LUA scripting | `sjasmplus/lua.js` | `ui/assembler-ui.js` | — | `lua-test` | `docs/assembler.md` |
| Syntax highlighting | `ui/asm-highlight.js` | `ui/assembler-ui.js` | `.asm-highlight` | `asm-highlight-test` | `docs/assembler.md` |
| Beautify | `core/asm-beautify.js` | `ui/assembler-ui.js` | `beautifyDialog`, `bf*` | `beautify-test` | `docs/assembler.md` |
| Import foreign sources | `core/asm-detok.js`, `core/asm-convert.js` | `ui/import-foreign.js` | `importForeignDialog` | `convert-test`, `import-test` | `docs/assembler.md` |
| Snippets | `data/asm-snippets.json` | `ui/asm-snippets.js` | `btnAsmSnippets` | `asm-test` | `docs/assembler.md` |
| Non-Zilog forms (options) | `sjasmplus/instructions.js` (`DialectOptions`) | `ui/assembler-ui.js` | `chkAsmAltMnemonics`, `chkAsmMultiOperand`, `chkAsmUndocumented` | `asm-test` | `docs/assembler.md` |

## Debugger and RE

| Feature | Logic | UI | Markup | Test | Docs |
|---------|-------|----|--------|------|------|
| Disassembly | `core/disasm.js` | `ui/debugger-display.js`, `ui/disasm-*.js` | `disassemblyView` | `disasm-test` | `docs/debugger.md` |
| Breakpoints | `core/spectrum.js` | `ui/step-controls.js` | `breakpointsList` | `breakpoint-test` | `docs/debugger.md` |
| Trace | `debug/trace-manager.js` | `ui/trace-display.js` | `traceList` | `debug-test` | `docs/debugger.md` |
| Labels / regions / comments | `debug/managers.js` | `ui/labels-panel.js`, `ui/mem-context.js` | `labelsList` | `debug-test` | `docs/debugger.md` |
| Auto-map + exports | `core/debug-instrument.js`, `core/map-export.js` | `ui/memory-map.js`, `ui/analysis-tools.js` | `memoryMapDialog` | `mapexport-test` | `docs/tools.md` |
| Profiler | `tools/profiler-analysis.js` | `ui/profiler-ui.js` | `profilerPanel` | `profiler-analysis-test` | `docs/tools.md` |
| Signature packs | `debug/signature-pack-manager.js` | `ui/signature-packs-ui.js` | `sigPacksList` | `sigpack-test` | `docs/tools.md` |
| Headless API | `ui/app-init.js` (`window.zxDebug`) | — | — | (per-feature) | `docs/automation.md` |
| API manifest / capabilities | `core/api-manifest.js` | `ui/app-init.js` (`capabilities`, `help`, `require`) | — | `api-manifest-test` | `docs/automation.md` |

## Tools

| Feature | Logic | UI | Markup | Test | Docs |
|---------|-------|----|--------|------|------|
| Explorer | `ui/explorer.js` + `explorer-banks.js` + `explorer-editors.js` | same | `explorer*`, `editorPanel*` | `explorer-test` | `docs/tools.md` |
| POKEs (JSON and `.pok`) | `core/pok.js` | `ui/poke-manager.js` | `pokeList`, `btnPokeLoad` | `pok-test` | `docs/tools.md` |
| POKE search | — | `ui/poke-search.js` | `pokeSearchPanel` | — | `docs/tools.md` |
| Encoded text search | `core/encoded-search.js` | `ui/memory-search.js`, `ui/explorer-views.js` | `memSearchType`, `explorerFindMode` | `encoded-search-test`, `explorer-test` | `docs/automation.md` |
| Data-table recognisers | `core/table-scan.js` | `ui/table-scanner.js` | `btnTableScan`, `tableScanKind` | `table-scan-test` | `docs/automation.md` |
| Differential runs | `core/divergence.js`, `core/spectrum.js` (`execTrace`) | `ui/diff-run.js`, `ui/app-init.js` (`recordRun`) | `btnDiffRun`, `drChange`, `drResults` | `divergence-test`, `diffrun-ui-test` | `docs/tools.md`, `docs/automation.md` |
| Game Mapper | `tools/game-mapper.js` | `ui/mapper-ui.js` | `mapperCanvas` | `mapper-test` | `docs/tools.md` |
| OCR text ripper | — | `ui/text-ripper.js` | `ocrDialog` | — | `docs/tools.md` |
| Graphics viewer | — | `ui/graphics-viewer.js` | `graphicsViewer*` | — | `docs/tools.md` |
| Compare tool | `ui/snapshot-parse.js` | `ui/compare-tool.js` | `compareDialog` | `snapshot-parse-test` | `docs/tools.md` |
| Compare: memory vs memory | `core/mem-compare.js` | `ui/compare-tool.js` | `compareMemMemOptions`, `compareMemAMode` | `memcompare-test`, `compare-ui-test` | `docs/tools.md` |
| Calculator | — | `ui/calculator.js` | `calcDialog` | `calculator-test` | — |
| Frame/PNG/GIF export | — | `ui/frame-export.js` | `btnScreenshotMain` | — | `docs/snapshot-formats.md` |

## Adding a feature: the usual six files

1. `core/<feature>.js` — the logic, pure where possible (storage, capture, DOM injected)
2. `ui/<module>.js` — wiring, or a new module following the init-function pattern
3. `html/<area>.html` — markup and ids (spliced into `index.html` at boot by `ui/boot.js`)
4. `css/app.css` — styling, if any
5. `tests/<feature>-test.html` — add it to the table above
6. Docs: this file, the relevant `docs/*.md`, `ui/help-content.html` (users), `CHANGELOG.md`
