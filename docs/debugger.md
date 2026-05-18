# Debugger: Step Over, Trace History, Port I/O Log, Shadow Screen, Instruction History

## Step Over (F8)

Step Over executes the current instruction and stops at the next one, but treats certain instructions as atomic — running until execution returns past them:

- **CALL / CALL cc** — runs until PC reaches the instruction after the 3-byte CALL
- **RST n** — runs until PC reaches the instruction after the 1-byte RST
- **Block repeats** (LDIR, LDDR, CPIR, CPDR, INIR, INDR, OTIR, OTDR) — runs until PC reaches the instruction after the 2-byte ED xx
- **DJNZ** — runs the entire loop until B=0 and PC passes the 2-byte DJNZ

CALL, RST, and DJNZ use a configurable T-state limit (Settings → Display → "Step Over T-state limit", default 80000 ≈ one frame). This prevents infinite hangs when a CALL never returns, a DJNZ loop exits early via JP/JR, or execution diverges unexpectedly. Block repeats (LDIR, LDDR, etc.) always run to completion (fixed 10M limit) since they are bounded by BC and guaranteed to terminate.

**DJNZ smart analysis** (`_isDjnzLoopSafe`): Before applying the T-state limit, the loop body (from the branch target to the DJNZ address) is statically analyzed. If the body contains only B-preserving, non-branching instructions, the loop is guaranteed to terminate (B decrements to 0 each iteration), so the limit is bypassed (uses 10M instead). The analysis flags these as unsafe:
- Flow control: JP, JR, CALL, RST, RET, RETI, RETN, JP (HL/IX/IY), nested DJNZ, HALT
- B-modifying: LD B,r, LD B,n, LD B,(IX/IY+d), LD BC,nn, LD BC,(nn), INC/DEC B, INC/DEC BC, POP BC, EXX, IN B,(C), block ops (LDI/LDIR/CPI/etc.)
- CB-prefix shifts/rotates/SET/RES targeting B (register index 0)
- DD CB / FD CB instructions storing result in B

Forward DJNZ (positive displacement) always uses the limit since it doesn't form a backward loop.

**Limitation**: Self-modifying code (SMC) can defeat the static analysis — a loop body that passes the safe check could write a branch or B-modifying instruction into itself at runtime. Detecting this would require tracking all memory writes against the loop body address range during execution, which is impractical for a pre-check. The `runToAddress` hard limit (10M T-states) still prevents permanent hangs in this case, but the user-configured limit warning won't trigger.

**T-state limit warning**: If a step-over hits the limit, a red popup appears centered below the current PC line in the disassembly view. For DJNZ, the popup includes the remaining B value. The popup auto-dismisses after 3 seconds.

**Implementation**: `spectrum.stepOver(maxCycles)` returns `{ skipped, reached, isDJNZ }`. `skipped` = true when a multi-cycle run was used (CALL/RST/block/DJNZ). `reached` = true when the target PC was hit before the cycle limit. `isDJNZ` = true when the instruction was DJNZ. Callers in `ui/step-controls.js` and `ui/keyboard-shortcuts.js` check `skipped && !reached` to show the warning popup.

**Persistence**: The limit is stored in localStorage key `zxm8_stepOverLimit` and saved/loaded in project files (`project.settings.stepOverLimit`).

## Trace History Screen Revert

Navigating trace history reverses memory writes so the screen canvas shows the historical state at each traced instruction.

**Memory operations** (`spectrum.js` `_memoryWriteCallback`):
- Each memOp records `{ addr, old, val }` -- old value captured via `memory.read(addr)` inside `onWrite` callback (fires before the actual write)
- Captured during both runtime trace (`runtimeTraceEnabled`) and step trace (`traceEnabled`)
- `traceEnabled` included in `updateMemoryCallbacksFlag()` so write callback is active during stepping

**Screen revert** (`ui/trace-display.js` `applyTraceMemoryDelta(fromPos, toPos)`):
- `lastTracePos` tracks current viewing position (-1 = live)
- Going backward (toPos < fromPos): undo entries from fromPos-1 down to toPos, writing `old` values in reverse order within each instruction
- Going forward (toPos > fromPos): redo entries from fromPos up to toPos-1, writing `val` values
- Temporarily sets `memory.onWrite = null` to bypass callbacks during reversal
- Calls `spectrum.renderToScreen()` after writes to refresh the display
- Wired into all 6 navigation paths: back, forward, live, slider, list click, clear

**Limitations**: Bank-switched memory ($C000-$FFFF) may revert to wrong bank if paging changed between entries. Screen area ($4000-$5AFF) is always bank 5, so screen revert works correctly on all machines. Old trace entries without `old` field are skipped gracefully.

## Port I/O Log

Port I/O logging (Trace tab -> Port I/O -> Log checkbox) records all IN/OUT operations with source tagging.

**Source tagging** (`spectrum.js` `getPortSource()`): When PC is in 0x0000-0x3FFF, the `src` field identifies what's mapped there:
- `TRDOS` -- TR-DOS ROM active (Beta Disk auto-paging or Scorpion ROM bank)
- `ROM:N` -- ROM bank N (0=128 BASIC, 1=48 BASIC, 2=+3DOS/Service Monitor, 3=+3 48K/TR-DOS)
- `RAM` -- RAM mapped over ROM (`specialPagingMode`, `ramInRomMode`, `scorpionRamInRomMode`)
- empty string -- PC >= 0x4000 (user code in RAM)

**Export format**: TSV with columns `Dir Port Value PC Src Frame T-states`

**All Z80 I/O instructions** (direct and indirect) go through `z80.js` `inPort()`/`outPort()`, which call `spectrum.portRead()`/`portWrite()`. Block instructions (INIR, OTIR, IND, OUTD, etc.) call per iteration, producing one trace entry per port access.

## Shadow Screen (Second Screen)

Displays an alternate screen view below the main canvas. Supports shadow bank display (128K+) and custom memory buffer viewing (all machines).

**Settings** (Settings -> Display -> Shadow dropdown):
- **None** -- shadow screen hidden
- **Full** -- (128K+ only) renders inactive screen bank with full attribute coloring (ink/paper/bright/flash, ULAplus)
- **Bitmap** -- (128K+ only) renders inactive screen bank pixels only as white-on-black (no attribute lookup)
- **Linear** -- renders 6144 bytes from a user-specified address as sequential rows (byte 0 = row 0 col 0, byte 32 = row 1 col 0). White-on-black. Works on all machines.
- **Spectrum** -- renders 6144 bytes from a user-specified address using ZX Spectrum interleaved screen layout. White-on-black. Works on all machines.

**Dynamic dropdown**: `updateSecondScreenOptions()` hides/shows Full and Bitmap options based on machine type. On 48K (ramPages <= 1), only None/Linear/Spectrum are available. Switching from 128K to 48K with Full or Bitmap selected falls back to None. Called on init, machine change, and reset.

**Address input**: Hex address field (`secondScreenAddrLabel`/`secondScreenAddr`) visible only in Linear/Spectrum modes. Defaults to $C000. Persisted in localStorage key `zxm8_secondScreenAddr`.

**IDs**: `secondScreenMode` (dropdown), `secondScreenAddrLabel` (address label+input wrapper), `secondScreenAddr` (hex input), `secondScreenContainer`, `secondScreen` (canvas), `secondScreenLabel`

**Status bar indicator**: `SCR: 5` or `SCR: 7` shows which screen bank is active on the main display. Visible on ALL 128K+ machines regardless of shadow screen mode. IDs: `screenBankInfo`, `screenBankStatus`.

**Implementation (`index.html`)**:
- `secondScreenMode` -- state variable: `'none'` | `'full'` | `'bitmap'` | `'linear'` | `'spectrum'`
- `secondScreenCustomAddr` -- hex start address for linear/spectrum modes (default `0xC000`)
- `renderSecondScreen()` -- four render paths: `full` (inactive bank + attributes via `getRamBank()`), `bitmap` (inactive bank white-on-black), `spectrum` (custom addr, interleaved layout via `memory.read()`), `linear` (custom addr, sequential via `memory.read()`). No `ramPages` guard for linear/spectrum.
- `updateSecondScreenOptions()` -- hides/shows Full/Bitmap options based on `ramPages`, falls back to None if needed
- `updateSecondScreenVisibility()` -- shows container for any non-none mode (no ramPages gate for linear/spectrum), shows address input for linear/spectrum, SCR indicator for 128K+ only
- `updateSecondScreenSize()` -- syncs canvas CSS size to current zoom level
- `onFrame` hook -- updates SCR indicator on every frame (128K+), renders shadow screen if mode is not `'none'` (regardless of ramPages). Chains previous `onFrame` handler.

**Persistence**: localStorage key `zxm8_secondScreen` (stores mode string; legacy `'true'` auto-migrated to `'full'`). localStorage key `zxm8_secondScreenAddr` (hex address string).

**Project save/load**: `project.settings.secondScreenMode` and `project.settings.secondScreenAddr` in `project-io.js`.

**Visibility lifecycle**: `updateSecondScreenOptions()` + `updateSecondScreenVisibility()` called on dropdown change, machine change, and reset. SCR indicator hidden on 48K. Shadow screen container visible whenever mode is not 'none' (linear/spectrum work on 48K).

## Instruction History Popup

Displays the last 10 actually-executed instructions. Click the **System** heading in the register panel to open a popup showing each instruction's address, disassembled mnemonic, and captured hex bytes.

**Zero extra memory reads**: Every byte already passes through `fetchByte()`. The CPU piggybacks on this — `execute()` saves the start PC and resets a byte counter, `fetchByte()` appends each fetched value to a small accumulator, and after execution the accumulated bytes are copied into a pre-allocated ring buffer. No object creation in the hot loop, zero GC pressure.

**Captured bytes vs. current memory**: The popup disassembles from the captured bytes, not current memory. This correctly shows what was actually executed even with self-modifying code — the disassembler receives a minimal `{ read(addr) }` wrapper over the captured byte array.

**Chained prefixes**: Sequences like `DD DD 21 01 02` are split into separate history entries — `DD` (redundant NOP) and `DD 21 01 02` (LD IX,nn). The `_splitChainPrefix()` helper in `executeDD()`/`executeFD()` flushes the prefix as its own entry and resets the accumulator for the real instruction.

**Ring buffer** (`core/z80.js`): `cpu.instrHistory[0..9]` — pre-allocated entries `{ pc, bytes: Uint8Array(6), len }`. `cpu.instrHistoryIdx` is the write cursor. Cleared on `reset()`.

**Popup** (`index.html`): `#pcHistoryPopup` positioned below `#btnPcHistory`. Click a row to navigate to that address via `navigateToAddress()`. Closes on click outside, Escape, or re-click on heading.
