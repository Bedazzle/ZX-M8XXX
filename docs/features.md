# Feature index: where each thing lives

A bug report names a *feature*, not a file. This maps one to the other, so a fix
starts with three files open instead of a grep.

Columns: the logic, the UI module that drives it, the markup ids it owns, its test
suite, and the user-facing docs. "—" means that layer doesn't exist for it.

## Emulation

| Feature | Logic | UI | Markup | Test | Docs |
|---------|-------|----|--------|------|------|
| Z80 CPU | `core/z80.js` | — | — | `fuse-test` | — |
| CPU variant (Zilog/NEC/ST) | `core/z80.js` (`xcfMask`, `outVc255`), `core/spectrum.js` (`CPU_VARIANTS`, `setCpuVariant`) | `ui/display-settings.js` | `cpuVariantSelect` | `cpu-variant-test` | `docs/machines.md#cpu-variant` |
| Memory / paging | `core/memory.js`, `core/machines.js` | `ui/machine-selector.js` | `machineSelect` | `memory-test`, `machine-test` | `docs/machines.md` |
| Memory contention | `core/spectrum.js` (`setupContention`, `checkContention`), `core/z80.js` (`contend`, `contendInternal`), `core/machines.js` (`contentionPattern`, `hasContention`) | — | — | `contention-timing-test`, `ctprobe-*`, `timingtest-*` | `docs/machines.md` |
| Port I/O contention | `core/spectrum.js` (`applyIOTimings`, `applyIOTimingsForRead`, `IO_OFFSET_READ/WRITE`) | — | — | `contention-timing-test`, `timingtest-00fe/7ffe/…` | `docs/machines.md` |
| Floating bus | `core/spectrum.js` (`getFloatingBusValue`, `_ioCycleT`, `IO_CYCLE_READ_T`), `core/machines.js` (`hasFloatingBus`) | — | — | `float48k`, `float128k`, `ctprobe-*` | `docs/machines.md` |
| Scorpion Even M1 + attribute bus | `core/spectrum.js` (`evenM1` in `setupContention`, `getAttrBusValue`), `core/memory.js` (`isRomAt`), `core/machines.js` (`evenM1`, `attrBusPorts`) | — | — | `ctprobe-scorpion`, `TactMeterV1.0` | `docs/machines.md#cpu-variant` |
| Video, border | `core/ula.js` | `ui/display-settings.js` | `screen`, `borderSizeSelect` | `system-test` | `docs/rendering.md` |
| ULAplus | `core/ula.js` (`ulaplus`) | `ui/display-settings.js` | `chkULAplus`, `ulaplusPalette*` | `system-test`, `szx-peripherals-test` | `docs/rendering.md` |
| Sound (beeper, AY) | `core/ay.js`, `core/audio-processor.js` | `ui/display-settings.js` | `chkSound`, `volumeSlider`, `stereoMode` | `tape-test` | `docs/rendering.md` |
| Keyboard | `core/ula.js` (keyMap), `core/spectrum.js` | `ui/input-settings.js`, `ui/virtual-keyboard.js` | `selCapsShiftKey`, `virtualKeyboard` | `system-test` | `docs/peripherals.md` |
| Keyboard ghosting | `core/ula.js` (`_ghostedRows`, `setKeyboardGhosting`) | `ui/input-settings.js` | `chkKeyboardGhosting` | `system-test` | `docs/peripherals.md` |
| Scripted key presses | `core/ula.js` (`hasKey`, `keyNames`, `resolveKeyName`) | `ui/app-init.js` (`assertZXKey`) | — | `system-test` | `docs/automation.md` |
| ULA snow | `core/ula-snow.js`, `core/ula.js` (`_displayRam`, `_snowFetchStartTstate`) | `ui/display-settings.js` | `chkUlaSnow` | `snow-test`, app tests `snowtest-*` | `docs/rendering.md` |
| ULA ink edge skew | `core/ula-inkskew.js`, `core/ula.js` (`inkSkew`) | `ui/display-settings.js` | `chkInkSkew` | `inkskew-test` | `docs/rendering.md` |
| PAL composite (RF) | `core/pal-composite.js`, `core/ula.js` (`setPalComposite`) | `ui/display-settings.js` | `chkPalComposite` | `pal-test`, `chromatrons`, `chromatrons-pentagon` | `docs/rendering.md` |
| Joysticks | `core/joystick.js`, `core/spectrum.js` | `ui/input-settings.js`, `ui/gamepad.js` | `selJoystickType`, `joyCustomKeys`, `chkKempston` | `joystick-test` | `docs/peripherals.md` |
| Kempston mouse | `core/spectrum.js` | `ui/input-settings.js` | `chkKempstonMouse` | `system-test` | `docs/peripherals.md` |

## Media

| Feature | Logic | UI | Markup | Test | Docs |
|---------|-------|----|--------|------|------|
| Tape (TAP/TZX/WAV) | `core/loaders/tape.js` | `ui/media-catalog.js`, `ui/file-loader.js` | `tapeInfo`, `tapeProgress` | `tape-test`, `loader-test` | `docs/media.md` |
| Auto Load | `ui/auto-loader.js` | `ui/file-loader.js` | — | (headless) | `docs/media.md` |
| Save inserted media | `core/spectrum.js` (`getSaveableMedia`, `_liveDiskImages`) | `ui/media-save.js` | `mediaSaveModal`, `mediaSaveList` | `mediasave-test` | `docs/media.md` |
| Beta Disk / TR-DOS | `core/loaders/disk-beta.js` | `ui/media-catalog.js` | `diskInfo`, `diskActivity` | `disk-test` | `docs/peripherals.md` |
| Beta 48 (TR-DOS 4.x, Vision, CBI-95) | `core/beta48.js` (ROM identification, the D0/D7 swap), `core/memory.js` (the `$3Cxx` window and the latch), `core/spectrum.js` (master register, ports, magic button) | `ui/input-settings.js` (`selBetaVariant`), `ui/rom-selector.js`, `ui/file-loader.js` | `selBetaVariant`, `beta48Status`, `btnLoadBeta48Rom`, `romBeta48Input`, `btnBetaMagic` | `beta48-test` | `docs/peripherals.md` |
| TKMEM-128 II (48K memory expansion) | `core/memory.js` (`setTkmem`/`writeTkmem`, the `$8000-$FFFF` overlay), `core/spectrum.js` (the latch port decode, the save-state chunk) | `ui/input-settings.js` (`selTkmem`) | `selTkmem`, `selTkmemDecode`, `tkmemStatus` | `tkmem-test` | `docs/peripherals.md` |
| UDI disk image | `core/loaders/disk-udi.js` (`toTrackImage`); served by `core/loaders/disk-beta.js` (`attachTrackImage`, `_findSectorRecord`, `_readSectorFromTrack`) | `ui/file-loader.js` (detection in `core/loaders/snapshot.js`, flattening in `core/spectrum.js` `loadDiskImage`); Explorer via `explorerParseUDI` in `ui/explorer.js` + the UDI section in `ui/explorer-banks.js` | `explorerFileInput` | `udi-test`, `disk-test`, `explorer-test` | `docs/format-references.md` |
| +D / MGT | `core/loaders/disk-mgt.js` | `ui/input-settings.js` | `chkPlusD` | `disk-test` | `docs/peripherals.md` |
| DISCiPLE / MGT | `core/loaders/disk-mgt.js` (`PlusDDisk`, shared), `core/memory.js` (the $0000-$3FFF window), `core/spectrum.js` (ports, paging, NMI) | `ui/input-settings.js` (`chkDisciple`), `ui/file-loader.js`, `ui/rom-selector.js` | `chkDisciple`, `discipleStatus`, `btnLoadDiscipleRom`, `romDiscipleInput`, `btnNmiDisciple` | `disk-boot-test` | `docs/peripherals.md` |
| Interface 1 / Microdrive | `core/loaders/microdrive.js` | `ui/input-settings.js` | `chkIF1` | `disk-test` | `docs/peripherals.md` |
| Opus Discovery (OPD) | `core/loaders/disk-opus.js` (`OPDLoader` + `OpusDisk`), `core/memory.js` (overlay), `core/spectrum.js` (paging, DRQ NMI) | `ui/input-settings.js` (`chkOpus`), `ui/file-loader.js`, `ui/explorer.js` | `chkOpus`, `opusStatus`, `btnLoadOpusRom`, `romOpusInput`, `opusDrivesRow`, `selOpusTracks0/1` | `opus-test`, `loader-test`, `disk-boot-test` | `docs/peripherals.md` |
| Didaktik 40/80 (D40/D80) | `core/loaders/disk-didaktik.js` (`DidaktikLoader` + `DidaktikDisk`), `core/memory.js` (overlay), `core/spectrum.js` (paging, ports, NMI) | `ui/input-settings.js` (`chkDidaktik`), `ui/file-loader.js`, `ui/explorer-editors.js` | `chkDidaktik`, `chkDidaktik128`, `didaktik128Row`, `didaktikStatus`, `btnLoadDidaktikRom`, `romDidaktikInput` | `disk-boot-test`, `disk-test` | `docs/peripherals.md` |
| Disk formatting (Write/Read Track) | `core/loaders/mfm-track.js` (the stream, pure); Type III in `core/loaders/disk-mgt.js` (`writeTrack`, `readTrack`, `finishWriteTrack`, `_formatPoll`) and `core/loaders/disk-beta.js` (same, plus `readTrackFromImage`) | — (driven by the interface ROM's own `FORMAT`) | `diskActivity` | `mfm-track-test`, `disk-test`, `disk-boot-test` | `docs/peripherals.md` |
| Disk rotation (index pulse, byte clock) | `core/loaders/disk-rotation.js` (pure); `setRotationClock` on `core/loaders/disk-beta.js` and `core/loaders/disk-mgt.js` (so the Opus and Didaktik too), wired by `Spectrum._wireDiskRotation()` in `core/spectrum.js` | — | — | `disk-rotation-test`, `disk-test`, `disk-boot-test`, `opus-test` (the read rate) | `docs/peripherals.md` |
| +3 FDC / DSK | `core/fdc.js` | `ui/media-catalog.js` | `diskActivity` | `fdc-test` | `docs/peripherals.md` |
| HC-2000 (machine) | `core/machines.js` (the profile), `core/memory.js` (`_hcRemap`, the $7E latch and $C5/$C7), `core/spectrum.js` (ports, the ULA's A7), `core/loaders/szx.js` (machine 17), `core/ula.js` (borders) | `ui/rom-selector.js` (one 32K ROM or FUSE's two halves), `ui/machine-selector.js` | — | `hc2000-test`, `machine-test` | `docs/machines.md` |
| Timex FDD 3000 | `core/fdd3000.js` (the station's own Z80, its WD177x and the TI-397 latches), `core/spectrum.js` (`_fdd3000Ok`/`fdd3000AutoBoot`, port `$EF`, the per-instruction step), `core/memory.js` (the `$0000-$3FFF` overlay) | `ui/input-settings.js` (`chkFdd3000`), `ui/file-loader.js`, `ui/rom-selector.js` | `chkFdd3000`, `selFdd3000Rom`, `btnFdd3000Boot`, `btnFdd3000Reset`, `fdd3000Status` | `fdd3000-test` | `docs/peripherals.md` |
| Didaktik Gama (80KB) | `core/machines.js` (the `dgama` profile, `gama80k`), `core/spectrum.js` (`_gama8255Write`, the `$1F/$3F/$5F/$7F` decode, `_gamaMode`/`_gamaPortC`), `core/memory.js` (`gamaBank`, `gamaBank1`), `core/ula.js` | — (machine dropdown only) | `selMachine` (Didaktik group) | `gama-test` | `docs/peripherals.md` |
| Microdigital TK-90X / TK-95 | `core/machines.js` (both profiles, `tstatesPerLine: 228`), `core/ula.js` (the 48K branch takes its line time from the profile; `TOP_LEFT_PIXEL_TSTATE` derived as `64 × tpl`), `core/memory.js` (`setTkmem` admits them), `core/spectrum.js` (`_ayOnPorts`) | `ui/input-settings.js` (the TKMEM row's wording), `ui/auto-loader.js` (`isMenuMachine` now `pagingModel !== 'none'`) | `selMachine` (Microdigital group), `tkmemStatus` | `tk-test` | `docs/peripherals.md` |
| TurboSound + DACs (Covox / Specdrum / Soundrive) | `core/spectrum.js` (`ay2`, `_curAy`, `setTurboSound`, `setDac`, `_dacWrite`, the `extra` argument to `processFrame`) | `ui/display-settings.js` | `chkTurboSound`, `selDac`, `txtCovoxPort`, `txtStereoCovoxL`/`R`, `covoxPortLabel`, `stereoCovoxLabel` | `sound-addons-test` | `docs/peripherals.md` |
| Timex TC2048 / TC2068 (SCLD) | `core/timex.js` (the SCLD display modes and `parseDck`), `core/machines.js` (both profiles), `core/spectrum.js` (ports `$F4`/`$FF`, the AY on `$F5`/`$F6`, `blitFrame`, `loadDCK`/`ejectDCK`), `core/ula.js` (`_renderTimexPaper`, `hiresBuf`), `core/memory.js` (DOCK/EXROM chunks), `core/joystick.js` (Timex 1/2) | `ui/app-init.js`, `ui/file-loader.js` (`.dck`), `ui/rom-selector.js`, `ui/canvas-zoom.js`, `ui/screen-info.js`, `ui/auto-loader.js` | `selMachine` (Timex group), `canvasScaleX` | `timex-test` | `docs/peripherals.md` |
| 128 MIDI out | `core/midi.js` (`UartDecoder`, `MidiAssembler`), `core/spectrum.js` (`setMidiOut`/`_midiLine`, the AY R14/R7 hook, `absTStates`) | `ui/display-settings.js`, `ui/midi-synth.js` (the built-in Web Audio synth) | `selMidiOut`, `midiStatus` | `midi-test` | `docs/peripherals.md` |
| SAA1099 (ZXM-SoundCard) | `core/saa1099.js` (the chip: tone, noise, envelopes, `SAA_CLOCK`), `core/spectrum.js` (`setSaa`, `saaChanges`/`_saaFlush`, the `$01FF`/`$00FF` decode, the `saa` member of `processFrame`'s `extra`) | `ui/display-settings.js` | `chkSaa` | `saa-test` | `docs/peripherals.md` |
| Kempston Disc / K-DOS | `core/kempdisc.js` (`KempstonDisc`, `KempstonDiscFdc` — the FDD 3000's WD model plus the Read Address that ends itself; the stock and 128A6 port decodes), `core/loaders/disk-kdos.js` (`KdosLoader`: the file system, `createBlank`, `addFile`/`readFile`/`deleteFile`/`renameFile`/`swapFiles`, `nameHash`, `asExplorerDisk`), `core/spectrum.js` (`_kempdiscOk`, the `$E5`-`$EF`/`$DF`/`$D7`/`$FD`/`$BF` decode), `core/memory.js` (`kempdiscActive`, the `$0000-$3FFF` overlay), `core/loaders/disk-didaktik.js` (hands a K-DOS EDSK on to `KdosLoader`) | `ui/input-settings.js`, `ui/media-catalog.js` (the directory and Blank KDI), `ui/file-loader.js` (`.kdi`), `ui/explorer*.js` (the MDOS editor path), `ui/rom-selector.js` | `chkKempdisc`, `selKempdiscRom`, `kempdiscStatus` | `kempdisc-test`, `disk-boot-test` | `docs/peripherals.md` |
| General Sound | `core/gs.js` (a Z80 of its own: `syncTo`/`beginFrame`/`endFrame`, the paging, the four DACs, `GS_CLOCK`/`GS_INT_PERIOD`), `core/spectrum.js` (`setGs`, `_gsSpecClock`, the `$BB`/`$B3`/`$33` decode, the `gs` member of `processFrame`'s `extra`) | `ui/display-settings.js` (fetches the firmware from `roms/`) | `chkGs`, `selGsRom`, `selGsRam`, `gsStatus` | `gs-test` | `docs/peripherals.md` |
| TurboSound FM (2 x YM2203) | `core/ym2203.js` (`YM2203FM` — the operator pipeline, the OPN envelope with SSG-EG, the 8 algorithms, channel 3's multi-frequency mode and CSM; `YM2203Timers` — timers A/B, the busy flag; a port of ymfm's OPN core, BSD-3-Clause), `core/spectrum.js` (`setTsfm`, `_fmReset`/`_fmSync`/`_fmFlush`, `_fmMasterClock`, the `%11111xyz` control word and the SSG / FM address split on `$FFFD`, the `fm` member of `processFrame`'s `extra`) | `ui/display-settings.js` | `chkTsfm` | `tsfm-test` | `docs/peripherals.md` |
| HC IF1 / HC disks | `core/hc-if1.js` (the i8272 and its select latch), `core/fdc.js` (`tcConnected`/`terminalCount`, the HC file systems), `core/loaders/disk-hc.js` (raw IMG → DSKImage), `core/memory.js` (the 16K overlay with its 1K RAM) | `ui/input-settings.js` (`chkHcIf1`), `ui/file-loader.js`, `ui/explorer.js`, `ui/explorer-editors.js` | `chkHcIf1`, `hcIf1Status`, `btnLoadHcIf1Rom`, `romHcIf1Input` | `hc2000-test` | `docs/peripherals.md` |
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
| Address/page operators | `sjasmplus/lexer.js`, `sjasmplus/expression.js` (`applySigil`), `sjasmplus/labels.js` (`physical`), `sjasmplus/assembler.js` (`exprContext`) | — | — | `asm-test` | `docs/assembler.md` |
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
| Disassembly row (both panels) | `ui/disasm-line-render.js` | `ui/debugger-display.js`, `ui/right-disasm-view.js` | `disassemblyView`, `rightDisassemblyView` | `disasm-render-test` | `docs/architecture.md` |
| Memory dump row (both panels) | `ui/mem-dump-render.js` | `ui/memory-view.js` | `memoryView`, `leftMemoryView` | `memdump-render-test` | `docs/architecture.md` |
| Edit an instruction in the disasm | `core/asm-line.js` | `ui/disasm-asm-edit.js`, `ui/disasm-context.js` (`asm-edit`) | `disassemblyView`, `rightDisassemblyView`, `.disasm-asm-input`, `chkRomEditDisasm`/`chkRomEdit` | `asm-line-test`, `disasm-asm-edit-test` | `docs/debugger.md` |
| Character cell blit (all render paths) | `core/ula-blit.js` | `core/ula.js` | — | `ula-blit-test` | `docs/rendering.md` |
| Breakpoints | `core/spectrum.js` | `ui/step-controls.js` | `breakpointsList` | `breakpoint-test` | `docs/debugger.md` |
| Trace | `debug/trace-manager.js` | `ui/trace-display.js` | `traceList` | `debug-test` | `docs/debugger.md` |
| Labels / regions / comments | `debug/managers.js` | `ui/labels-panel.js`, `ui/mem-context.js` | `labelsList` | `debug-test` | `docs/debugger.md` |
| Auto-map + exports | `core/debug-instrument.js`, `core/map-export.js` | `ui/memory-map.js`, `ui/analysis-tools.js` | `memoryMapDialog` | `mapexport-test` | `docs/tools.md` |
| Profiler | `tools/profiler-analysis.js` | `ui/profiler-ui.js` | `profilerPanel` | `profiler-analysis-test` | `docs/tools.md` |
| Signature packs | `debug/signature-pack-manager.js` | `ui/signature-packs-ui.js` | `sigPacksList` | `sigpack-test` | `docs/tools.md` |
| Hex / decimal display | `core/addr-format.js` | `ui/display-settings.js`, `ui/number-hints.js` | `chkDecAddresses`, `chkDecValues`, `chkDecOpcodes` | `addr-format-test`, `addr-base-ui-test` | `docs/debugger.md` |
| Headless API | `ui/app-init.js` (`window.zxDebug`) | — | — | (per-feature) | `docs/automation.md` |
| API manifest / capabilities | `core/api-manifest.js` | `ui/app-init.js` (`capabilities`, `help`, `require`) | — | `api-manifest-test` | `docs/automation.md` |
| Port-read provenance | `core/debug-instrument.js` (`startPortReadProvenance`), `core/spectrum.js` (`portRead`) | `ui/app-init.js` (`watchPortReads`) | — | `api-manifest-test` | `docs/automation.md` |
| Tape position (both decks) | `core/spectrum.js` (`getTapeState`) | `ui/app-init.js` (`tapeState`) | — | `api-manifest-test` | `docs/automation.md` |

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
| Source comments in disasm | `sjasmplus/assembler.js` (`lineMap`), `debug/managers.js` (`source`) | `ui/assembler-ui.js` (`importAsmComments`), `ui/comment-visibility.js` | `btnAsmInject`, `btnAsmDebug`, `chkAsmComments`, `chkUserComments` | `asm-test`, `asm-comments-ui-test` | `docs/assembler.md`, `docs/debugger.md` |
| Calculator in either panel | `ui/calc-host.js` | `ui/panel-navigator.js`, `ui/assembler-ui.js` | `rightCalculatorView`, `asmPane2Calc`, `asmPane2File` | `calc-host-test` | — |
| Frame/PNG/GIF export | — | `ui/frame-export.js` | `btnScreenshotMain` | — | `docs/snapshot-formats.md` |

## Adding a feature: the usual six files

1. `core/<feature>.js` — the logic, pure where possible (storage, capture, DOM injected)
2. `ui/<module>.js` — wiring, or a new module following the init-function pattern
3. `html/<area>.html` — markup and ids (spliced into `index.html` at boot by `ui/boot.js`)
4. `css/app.css` — styling, if any
5. `tests/<feature>-test.html` — add it to the table above
6. Docs: this file, the relevant `docs/*.md`, `ui/help-content.html` (users), `CHANGELOG.md`
