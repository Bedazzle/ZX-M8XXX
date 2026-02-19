# Z80 and ZX Spectrum Emulation Technical Guide

**Version 1.2** | For emulator developers

This document describes the technical requirements for cycle-accurate emulation of the Z80 CPU and ZX Spectrum family (48K, 128K, Pentagon 128, and extended clones). It covers timing, contention, sound, undocumented behavior, and edge cases that must be implemented for perfect emulation.

---

## Table of Contents

1. [Machine Specifications](#1-machine-specifications)
2. [Z80 CPU Core](#2-z80-cpu-core)
3. [Memory Contention](#3-memory-contention)
4. [I/O Contention](#4-io-contention)
5. [ULA and Video Timing](#5-ula-and-video-timing)
6. [Floating Bus](#6-floating-bus)
7. [Interrupt Handling](#7-interrupt-handling)
8. [Memory Banking (128K/Pentagon)](#8-memory-banking-128kpentagon)
9. [Undocumented Z80 Behavior](#9-undocumented-z80-behavior)
10. [Edge Cases and Gotchas](#10-edge-cases-and-gotchas)
11. [AY-3-8910 Sound Chip](#11-ay-3-8910-sound-chip)
12. [Beeper Audio](#12-beeper-audio)
13. [Extended Machines](#13-extended-machines)
14. [Emulator Architecture](#14-emulator-architecture)
15. [Performance Optimization](#15-performance-optimization-without-wasm)
16. [Testing and Validation](#16-testing-and-validation)
17. [RZX Input Recording Format](#17-rzx-input-recording-format)
18. [References](#18-references)

---

## 1. Machine Specifications

### 1.1 Timing Constants

| Parameter | 48K | 128K | Pentagon 128 |
|-----------|-----|------|--------------|
| CPU Clock | 3.5 MHz | 3.5469 MHz | 3.5 MHz |
| T-states/line | 224 | 228 | 224 |
| Lines/frame | 312 | 311 | 320 |
| T-states/frame | 69888 | 70908 | 71680 |
| Frame rate | ~50.08 Hz | ~50.02 Hz | ~48.83 Hz |
| INT pulse duration | 32 T | 36 T | 36 T |

### 1.2 Screen Layout (Lines)

| Region | 48K | 128K | Pentagon |
|--------|-----|------|----------|
| V-blank | 0-7 | 0-7 | 0-15 |
| Top border | 8-63 (56 lines) | 8-62 (55 lines) | 16-79 (64 lines) |
| Paper area | 64-255 (192 lines) | 63-254 (192 lines) | 80-271 (192 lines) |
| Bottom border | 256-311 (56 lines) | 255-310 (56 lines) | 272-319 (48 lines) |

### 1.3 Line Structure (T-states within line)

**48K (224 T-states/line):**
```
[0-127]   Paper area (128 T = 256 pixels)
[128-151] Right border (24 T = 48 pixels)
[152-175] H-blank (24 T)
[176-199] H-sync (24 T)
[200-223] Left border (24 T = 48 pixels)
```
Note: Line structure varies by reference. Some count left border first.

**128K (228 T-states/line):**
```
[0-23]    Left border (24 T = 48 pixels)
[24-151]  Paper area (128 T = 256 pixels)
[152-175] Right border (24 T = 48 pixels)
[176-227] H-retrace (52 T)
```

**Pentagon (224 T-states/line):**
```
[0-31]    H-blank (32 T)
[32-67]   Left border (36 T = 72 pixels)
[68-195]  Paper area (128 T = 256 pixels)
[196-223] Right border (28 T = 56 pixels)
```

---

## 2. Z80 CPU Core

### 2.1 Instruction Dispatch

For optimal performance, use a **function table** (array of 256 functions) instead of a large switch statement:

```javascript
// O(1) dispatch instead of O(n) switch
this.opcodeTable[opcode]();
```

Prefix handlers (CB, DD, ED, FD) can use separate tables or inline switches since they execute less frequently.

### 2.2 Register Pair Accessors

Use getters/setters for 16-bit register pairs:

```javascript
get bc() { return (this.b << 8) | this.c; }
set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
```

### 2.3 R Register

The refresh register has special behavior:
- **Bits 0-6**: Auto-increment on each M1 cycle (instruction fetch)
- **Bit 7**: Preserved separately, only changed by `LD R,A`

```javascript
get rFull() { return (this.r & 0x7f) | this.r7; }
set rFull(v) { this.r = v & 0x7f; this.r7 = v & 0x80; }

incR() { this.r = (this.r + 1) & 0x7f; }
```

### 2.4 Timing Model

Each instruction must track T-states precisely. The basic cycle breakdown:

| Cycle Type | T-states | Description |
|------------|----------|-------------|
| M1 (opcode fetch) | 4 | Fetch + decode + R increment |
| Memory read | 3 | Standard memory read |
| Memory write | 3 | Standard memory write |
| I/O read | 4 | Port input (includes IORQ timing) |
| I/O write | 4 | Port output |
| Internal | 1+ | CPU-internal processing |

**Critical**: Contention must be applied at the exact T-state of each memory/I/O access, not at instruction start.

### 2.5 Instruction Timing Examples

```
NOP:           4T (M1 only)
LD r,n:        7T (M1:4 + read:3)
LD r,(HL):     7T (M1:4 + read:3)
LD (HL),r:     7T (M1:4 + write:3)
LD (HL),n:     10T (M1:4 + read:3 + write:3)
PUSH qq:       11T (M1:4 + internal:1 + write:3 + write:3)
POP qq:        10T (M1:4 + read:3 + read:3)
JP nn:         10T (M1:4 + read:3 + read:3)
CALL nn:       17T (M1:4 + read:3 + read:3 + internal:1 + write:3 + write:3)
JR d:          12T (M1:4 + read:3 + internal:5)
JR cc,d (taken):   12T
JR cc,d (not taken): 7T
DJNZ (taken):  13T (M1:4 + internal:1 + read:3 + internal:5)
DJNZ (not taken): 8T (M1:4 + internal:1 + read:3)
```

### 2.6 Block Instructions (LDIR, LDDR, etc.)

Block instructions have complex timing due to the repeat mechanism:

**LDI/LDD (16T):**
```
M1: 4T (ED prefix fetch)
M1: 4T (opcode fetch)
Read (HL): 3T
Write (DE): 3T
Internal: 2T (with BC on address bus)
```

**LDIR/LDDR (21T when BC≠0, 16T when BC=0):**
```
Same as LDI/LDD
If BC≠0: +5T internal (with DE on address bus)
```

**CPIR/CPDR**: Similar pattern, 21T/16T
**INIR/INDR/OTIR/OTDR**: 21T/16T with I/O timing

**Critical edge case**: For block I/O instructions, the internal cycles use `BC` (not `HL`) on the address bus for contention purposes after the first iteration.

---

## 3. Memory Contention

### 3.1 Overview

The ULA and CPU share access to the screen memory (0x4000-0x7FFF). When the ULA is fetching display data, the CPU must wait. This is called **contention**.

**Pentagon has NO contention** - this is a key difference from UK Spectrums.

### 3.2 Contention Pattern

During each 8 T-state ULA fetch cycle within the paper area:

| T mod 8 | Delay |
|---------|-------|
| 0 | 6 |
| 1 | 5 |
| 2 | 4 |
| 3 | 3 |
| 4 | 2 |
| 5 | 1 |
| 6 | 0 |
| 7 | 0 |

### 3.3 Contention Start T-state

| Machine | Contention Start | Notes |
|---------|------------------|-------|
| 48K | 14335 | First paper line at 14336, pattern starts 1T earlier |
| 128K | 14361 | Different line timing |
| Pentagon | N/A | No contention |

### 3.4 Contended Memory Regions

**48K:**
- 0x4000-0x7FFF: Always contended during screen fetch

**128K:**
- 0x4000-0x7FFF: Bank 5 (always contended)
- 0xC000-0xFFFF: Contended if bank 1, 3, 5, or 7 is paged in

### 3.5 Implementation

```javascript
getContentionDelay(tStates) {
    const contentionFrom = 14335;  // 48K
    const contentionTo = contentionFrom + (192 * 224) + 128;

    if (tStates < contentionFrom || tStates >= contentionTo) {
        return 0;
    }

    const lineT = (tStates - contentionFrom) % 224;
    if (lineT >= 128) return 0;  // Border/retrace

    return [6, 5, 4, 3, 2, 1, 0, 0][lineT & 7];
}
```

### 3.6 When to Apply Contention

Apply contention at the **start of each memory access**, not at instruction start:

1. **M1 cycle (opcode fetch)**: At T+0 of instruction
2. **Operand fetches**: At their actual T-state offset
3. **Memory reads/writes**: At their actual T-state offset
4. **Internal cycles**: Some instructions contend during internal cycles (see 3.7)

### 3.7 Internal Cycle Contention

Some instructions have internal cycles where the CPU puts an address on the bus without performing a memory access. These cycles ARE contended:

| Instruction | Internal T-states | Address on bus |
|-------------|-------------------|----------------|
| ADD HL,rr | 7 | IR (I register << 8 | R) |
| JR d (taken) | 5 | Last displacement byte address |
| DJNZ (taken) | 5 | Displacement byte address |
| LD I,A / LD R,A | 1 | IR |
| RLD, RRD | 4 | HL |
| INC/DEC (HL) | 1 | HL |
| Block instructions | 2 | DE or BC depending on instruction |

---

## 4. I/O Contention

### 4.1 Overview

I/O operations have different contention rules based on the port address.

### 4.2 Contention Rules (48K/128K)

The rule depends on bit 0 of the port address (directly decodes to ULA):

**Low byte bit 0 = 0 (ULA port):**
- C:1, C:3 pattern
- Contend, then 1T, then contend, then 3T

**Low byte bit 0 = 1 (non-ULA), high byte contended (0x40-0x7F):**
- C:1, C:1, C:1, C:1 pattern
- Four single T-state accesses, each contended

**Low byte bit 0 = 1, high byte not contended:**
- N:4 pattern
- No contention, just 4T

### 4.3 Implementation Example

```javascript
ioContend(port) {
    const isUlaPort = (port & 0x01) === 0;
    const highByteContended = (port & 0xC000) === 0x4000;

    if (isUlaPort) {
        // C:1, C:3
        this.tStates += this.getContentionDelay(this.cpu.tStates);
        this.cpu.tStates += 1;
        this.tStates += this.getContentionDelay(this.cpu.tStates);
        this.cpu.tStates += 3;
    } else if (highByteContended) {
        // C:1, C:1, C:1, C:1
        for (let i = 0; i < 4; i++) {
            this.tStates += this.getContentionDelay(this.cpu.tStates);
            this.cpu.tStates += 1;
        }
    } else {
        // N:4
        this.cpu.tStates += 4;
    }
}
```

---

## 5. ULA and Video Timing

### 5.1 Frame Structure

The ULA generates video output in a raster pattern:
1. V-blank (invisible)
2. Top border (visible, border color)
3. Paper area (192 lines of screen content)
4. Bottom border (visible, border color)

### 5.2 Border Color Changes

Border color changes via OUT to port 0xFE take effect at the **current beam position**. For multicolor border effects, you must track the exact T-state of each OUT instruction.

**Key formula for beam position:**
```javascript
const line = Math.floor(tStates / tstatesPerLine);
const tInLine = tStates % tstatesPerLine;
const pixelX = tInLine * 2;  // 2 pixels per T-state
```

### 5.3 Attribute Timing (Multicolor)

For multicolor effects in the paper area, the ULA reads attributes **ahead** of display:

| Machine | ULA Read-ahead |
|---------|----------------|
| 48K | 1 T-state |
| 128K | 3 T-states |
| Pentagon | 0 T-states |

This means writing to attribute memory must account for when the write actually occurs versus when the ULA reads it:

```javascript
// Calculate when attribute write affects display
const effectiveT = cpuTstates + writeDelay;
const displayT = effectiveT + ULA_READ_AHEAD;
```

### 5.4 Flash

Flash state toggles every 16 frames (32 total cycle = ~0.64 seconds). Track frame count:

```javascript
if (++frameCounter >= 16) {
    frameCounter = 0;
    flashState = !flashState;
}
```

---

## 6. Floating Bus

### 6.1 Overview

When reading from unconnected I/O ports, the data bus "floats" and can return values from the ULA's current video fetch. This is an **advanced feature** used by some software for synchronization.

### 6.2 Timing

During paper area rendering, the ULA performs a repeating 8 T-state cycle:
```
T+0: Read bitmap byte 1
T+1: Read attribute byte 1
T+2: Read bitmap byte 2
T+3: Read attribute byte 2
T+4-7: Idle (no fetch)
```

### 6.3 Implementation

```javascript
getFloatingBusValue() {
    const t = this.cpu.tStates;
    const line = Math.floor(t / tstatesPerLine);
    const tInLine = t % tstatesPerLine;

    const screenLine = line - firstScreenLine;
    if (screenLine < 0 || screenLine >= 192) return 0xFF;

    // Paper area within line
    const paperStart = 3;  // Adjust for machine type
    if (tInLine < paperStart || tInLine >= paperStart + 128) return 0xFF;

    const tInFetch = tInLine - paperStart;
    const cyclePos = tInFetch % 8;

    if (cyclePos >= 4) return 0xFF;  // Idle cycles

    const charColumn = Math.floor(tInFetch / 8) * 2 + Math.floor(cyclePos / 2);
    const isBitmap = (cyclePos % 2) === 0;

    if (isBitmap) {
        return readBitmapByte(screenLine, charColumn);
    } else {
        return readAttributeByte(screenLine, charColumn);
    }
}
```

### 6.4 Late Timing Mode

Real hardware has timing drift as the ULA warms up:
- **Early timing** (cold ULA): Standard timing
- **Late timing** (warm ULA): +1 T-state offset on floating bus and INT

---

## 7. Interrupt Handling

### 7.1 Interrupt Modes

| Mode | Vector Address | Total T-states |
|------|----------------|----------------|
| IM 0 | 0x0038 (RST 38) | 13 |
| IM 1 | 0x0038 | 13 |
| IM 2 | (I << 8) \| data_bus | 19 |

**Note**: In IM 2, the data bus value is 0xFF on Spectrum hardware (no peripheral putting a vector).

### 7.2 INT Timing

The INT signal is generated at frame start (T=0) and lasts for INT_PULSE_DURATION T-states.

**Key timing details:**
1. INT is checked at the **end** of each instruction
2. If CPU is HALTed, it executes one more HALT NOP (4T) before responding
3. IFF1 and IFF2 are cleared when accepting interrupt
4. EI enables interrupts **after** the following instruction

### 7.3 EI Timing

```javascript
// EI sets a pending flag, actual enable happens after next instruction
case EI:
    this.eiPending = true;
    break;

// At start of execute():
if (this.eiPending) {
    this.eiPending = false;
    this.iff1 = this.iff2 = true;
}
```

### 7.4 HALT Behavior

When HALTed:
1. CPU executes NOP repeatedly (4T each)
2. PC is decremented to re-execute HALT
3. R register still increments
4. Wake on INT (if IFF1=1) or NMI

```javascript
case HALT:
    this.halted = true;
    this.pc = (this.pc - 1) & 0xffff;
    break;
```

### 7.5 NMI Handling

NMI is non-maskable and always responds:
- Jumps to 0x0066
- IFF1 is copied to IFF2, then IFF1 is cleared
- Takes 11 T-states

---

## 8. Memory Banking (128K/Pentagon)

### 8.1 Memory Map

```
0x0000-0x3FFF: ROM (ROM 0 or ROM 1, or TR-DOS ROM)
0x4000-0x7FFF: RAM Bank 5 (screen 1)
0x8000-0xBFFF: RAM Bank 2
0xC000-0xFFFF: Switchable RAM bank (0-7)
```

### 8.2 Paging Port (0x7FFD)

Written to any port where A15=0 and A1=0:

| Bits | Function |
|------|----------|
| 0-2 | RAM bank at 0xC000-0xFFFF |
| 3 | Screen select (0=bank 5, 1=bank 7) |
| 4 | ROM select (0=ROM 0/128K, 1=ROM 1/48K BASIC) |
| 5 | Paging disable (locks paging until reset) |

### 8.3 Pentagon TR-DOS Paging

Pentagon has automatic TR-DOS ROM paging:
- Accessing 0x3Dxx with TR-DOS ROM loaded pages in TR-DOS
- Returning from TR-DOS (to RAM) pages out TR-DOS

### 8.4 Screen Bank Switching

The shadow screen (bank 7) allows flicker-free double-buffering. Games can switch instantly between screens via bit 3 of port 0x7FFD.

**Two distinct usage patterns exist — emulators must handle them differently:**

**1. Double-buffering** (e.g., Cubix): One bank swap per frame. The game displays the completed back buffer, then clears and redraws the other bank. Typical flow:
```
ISR fires → game logic → swap display bank (OUT $7FFD) → clear back buffer → draw frame → wait
```
The displayed bank is always a fully-drawn frame. The key constraint: by end-of-frame, the *previous* display bank has been cleared and redrawn as the new back buffer.

**2. Scroll17 / screen multiplexing**: Rapid bank alternation within a single frame (dozens to hundreds of switches). Combines pixel/attribute data from both banks to achieve effects impossible with a single screen, such as per-column independent scrolling.

**Emulation pitfall — deferred vs scanline rendering:**

Scanline rendering (reading screen RAM at each line's CPU execution time) handles double-buffering correctly: lines rendered before the swap show the old display bank (still intact), lines after show the new bank.

Deferred rendering (reading all screen RAM at end-of-frame) is required for scroll17 (need all bank change timestamps to determine per-column bank selection). However, it **breaks double-buffering**: by end-of-frame the pre-swap bank has been cleared/redrawn, so reading it produces a blank or partially-drawn image — causing severe flicker.

**Solution:** Only defer paper rendering when the previous frame had many bank changes (>2 entries), indicating scroll17. Simple double-buffering (initial state + 1 swap = 2 entries) should use normal scanline rendering.

---

## 9. Undocumented Z80 Behavior

### 9.1 MEMPTR (WZ) Register

An internal 16-bit register that affects flags in certain instructions:

**Updates:**
- `LD A,(nn)`: MEMPTR = nn + 1
- `LD (nn),A`: MEMPTR = (A << 8) | ((nn + 1) & 0xFF)
- `LD A,(BC/DE)`: MEMPTR = BC/DE + 1
- `LD (BC/DE),A`: MEMPTR = (A << 8) | ((BC/DE + 1) & 0xFF)
- JR/JP/CALL/RET: MEMPTR = target address

**Affects flags in:**
- BIT n,(HL): bits 3,5 of F come from MEMPTR high byte
- LDIR/LDDR/CPIR/CPDR: Various flag behaviors

### 9.2 Q Register (SCF/CCF Behavior)

An internal state tracking last instruction's flag modification:

```javascript
// At start of each instruction
this.lastQ = this.q;
this.q = 0;

// SCF
this.f = (this.f & (FLAG_PV | FLAG_Z | FLAG_S)) | FLAG_C | (this.a & 0x28);
this.q = this.f;

// CCF - affected by lastQ
const hfOrNf = ((this.lastQ ^ this.f) | this.f) & FLAG_H;
this.f = ((this.f ^ FLAG_C) & (FLAG_PV | FLAG_Z | FLAG_S | FLAG_C)) | hfOrNf | (this.a & 0x28);
```

### 9.3 Undocumented Flags (Bits 3 and 5)

Bits 3 (0x08) and 5 (0x20) of the F register are undocumented but predictable:
- Usually copy from the result or operand
- BIT instructions: come from undocumented sources (MEMPTR for BIT n,(HL))

### 9.4 Undocumented Opcodes

**DD/FD prefix undocumented:**
- IXH, IXL, IYH, IYL accessible as separate 8-bit registers
- Most main opcodes work with IX/IY instead of HL

**ED prefix undocumented:**
- 0xED70: IN F,(C) - input affects flags only
- 0xED71: OUT (C),0 or OUT (C),255 (NMOS vs CMOS)
- 0xED illegal: behave as NOP (8T)

**CB prefix:**
- All CB opcodes are documented

### 9.5 OUT (C),0 vs OUT (C),255

- **NMOS Z80** (original): OUT (C),0 outputs 0x00
- **CMOS Z80**: OUT (C),0 outputs 0xFF

Most Spectrums use NMOS. Implementation should be configurable.

---

## 10. Edge Cases and Gotchas

### 10.1 PUSH Timing

PUSH has 1T internal cycle BEFORE the writes, affecting contention timing:
```
M1: 4T
Internal: 1T
Write high byte: 3T
Write low byte: 3T
Total: 11T
```

INT/NMI push does NOT have this internal cycle.

### 10.2 Block Instruction Interrupts

Block instructions (LDIR etc.) can be interrupted between iterations. The CPU saves the decremented PC, so the instruction resumes from the beginning of the current iteration.

### 10.3 EI + DI Sequence

```
EI          ; Sets eiPending
DI          ; Clears IFF1/IFF2
```
If INT is pending, it will NOT fire between EI and DI because EI only takes effect after the NEXT instruction.

### 10.4 EI + HALT Sequence

```
EI          ; Sets eiPending
HALT        ; IFFs enabled, then HALT executed
```
HALT will immediately respond to pending INT on the next check.

### 10.5 IM 2 Vector Table Alignment

For IM 2, the vector table address is `(I << 8) | data_bus_value`. On Spectrum, data_bus is 0xFF, so the table must have entries at odd addresses (e.g., 0xFEFF-0xFF00).

### 10.6 Memory Write Contention During Block Ops

For LDIR/LDDR, writes to contended memory incur contention. This is why copying to screen memory is slower than copying from it.

### 10.7 Snow Effect (48K)

On 48K only, during the first T-state of certain instructions, if the IR register points to contended memory AND the ULA is fetching, a "snow" effect can occur. This is rarely emulated.

### 10.8 Chained Prefix Bytes (DD/FD)

The DD and FD prefix bytes can be chained indefinitely. Each prefix:
- Takes 4 T-states
- Increments the R register
- Resets the "current index register" for the following instruction

**Behavior:**
```
DD DD DD 21 nn nn    ; Three DD prefixes, then LD IX,nnnn
                     ; Total: 4+4+4+14 = 26 T-states
                     ; R incremented 4 times (3 prefixes + 1 instruction)

DD FD 21 nn nn       ; DD then FD, then LD IY,nnnn
                     ; FD "wins" - the last prefix determines IX vs IY
                     ; Total: 4+4+14 = 22 T-states

DD DD CB d op        ; Prefixes before DDCB
                     ; Only the last DD matters for the DDCB instruction
```

**Implementation:**
```javascript
execute() {
    let opcode = this.fetchByte();  // 4T, R++

    // Handle prefix chains
    while (opcode === 0xDD || opcode === 0xFD) {
        this.currentIndex = (opcode === 0xDD) ? 'IX' : 'IY';
        this.tStates += 4;
        opcode = this.fetchByte();  // 4T, R++
    }

    // Now execute the actual instruction with currentIndex
    this.executeWithIndex(opcode, this.currentIndex);
}
```

### 10.9 Interrupts During Prefix Chains

**Critical behavior**: Interrupts are **NOT accepted** between a prefix byte and its instruction.

The Z80 has an internal flag that blocks interrupt recognition immediately after fetching DD, FD, CB, or ED prefix bytes. This means:

```
DD          ; Prefix fetched, INT blocked
21 nn nn    ; LD IX,nnnn completes
            ; NOW interrupt can be accepted

DD          ; Prefix fetched, INT blocked
DD          ; Another prefix, INT still blocked
DD          ; Another prefix, INT still blocked
21 nn nn    ; Instruction completes
            ; NOW interrupt can be accepted
```

**Why this matters:**
- A long chain of prefixes (e.g., 1000× DD) will delay interrupt response
- Some protection schemes exploit this
- The CPU appears "hung" during the prefix chain

**Implementation:**
```javascript
execute() {
    // ... fetch and execute instruction ...

    // After instruction completes, check for interrupt
    // But NOT if we just executed a prefix that chains
    if (!this.prefixActive && this.iff1 && this.intPending) {
        this.interrupt();
    }
}
```

**Edge case - EI followed by prefix:**
```
EI          ; eiPending = true
DD          ; Prefix - IFFs enabled NOW (before DD executes)
21 nn nn    ; LD IX,nnnn
            ; Interrupt CAN fire after this instruction
```

The EI's delayed enable happens at the START of the next instruction (before decoding), so interrupts are enabled before the prefix is processed, but still blocked by the prefix mechanism.

### 10.10 Kempston Joystick

The Kempston joystick interface is the most common joystick standard for the Spectrum.

**Port:** 0x1F (or any port with A5=0)

**Bit layout (active HIGH - bit set when pressed):**
```
Bit 0: Right
Bit 1: Left
Bit 2: Down
Bit 3: Up
Bit 4: Fire
Bits 5-7: Usually 0 (extended buttons on some interfaces)
```

**Port decoding:**
The original Kempston responds to any port where A5=0:
```javascript
if ((port & 0x20) === 0) {
    return this.kempstonState;
}
```

**Implementation:**
```javascript
// Kempston state (bits set when direction/button pressed)
this.kempstonState = 0;

// On port read
readPort(port) {
    if ((port & 0x00E0) === 0x001F) {  // More selective decoding
        return this.kempstonState;
    }
    // ... other ports ...
}

// Update from input
pressRight()   { this.kempstonState |= 0x01; }
releaseRight() { this.kempstonState &= ~0x01; }
// etc.
```

**Extended Kempston (some interfaces):**
```
Bit 5: Fire 2 / Button C
Bit 6: Fire 3 / Button A
Bit 7: Fire 4 / Start
```

### 10.11 Kempston Mouse

The Kempston mouse interface provides relative X/Y movement and button state.

**Ports:**
```
0xFADF: Buttons (read)
0xFBDF: X position (read)
0xFFDF: Y position (read)
```

**Button port (0xFADF):**
```
Bit 0: Right button (0 = pressed, active LOW)
Bit 1: Left button (0 = pressed, active LOW)
Bit 2: Middle button (0 = pressed, active LOW)
Bit 3: Always 1
Bits 4-7: Wheel delta (0-15) on some interfaces
```

**Position ports (0xFBDF, 0xFFDF):**
- Return 8-bit value that wraps (0-255)
- Value is cumulative position, not delta
- Software calculates delta by comparing with previous read
- X increases moving right, Y direction varies by game

**Implementation:**
```javascript
constructor() {
    this.mouseX = 0;        // 8-bit wrapping counter
    this.mouseY = 0;        // 8-bit wrapping counter
    this.mouseButtons = 0x07; // All released (active low)
}

// Called from browser mouse move event
onMouseMove(deltaX, deltaY) {
    this.mouseX = (this.mouseX + deltaX) & 0xFF;
    this.mouseY = (this.mouseY + deltaY) & 0xFF;
}

readPort(port) {
    // Kempston mouse - check specific port patterns
    if ((port & 0x0521) === 0x0001) {
        const highByte = (port >> 8) & 0xFF;
        if (highByte === 0xFA) return this.mouseButtons;
        if (highByte === 0xFB) return this.mouseX;
        if (highByte === 0xFF) return this.mouseY;
    }
    // ...
}
```

**Mouse capture considerations:**
- Browser requires user gesture to capture mouse (Pointer Lock API)
- Relative movement only available when pointer is locked
- Sensitivity scaling may be needed (Spectrum software expects ~1:1 pixel:count)

**AMX Mouse (alternative):**
Different port addresses and protocol, less common:
```
0x1F (bits depend on A5-A7): Buttons and Y high nibble
0x7F: X and Y low nibbles
```

---

## 11. AY-3-8910 Sound Chip

### 11.1 Overview

The AY-3-8910 (or YM2149 compatible) PSG provides 3 square wave channels, noise generator, and envelope generator. Present in 128K, +2, +3, and most clones.

### 11.2 Clock Rates

| Machine | AY Clock | Notes |
|---------|----------|-------|
| 128K/+2/+3 | 1.7734 MHz | CPU clock / 2 |
| Pentagon | 1.75 MHz | CPU clock / 2 |
| Scorpion | 1.75 MHz | Same as Pentagon |

### 11.3 Register Map

| Reg | Bits | Function |
|-----|------|----------|
| R0 | 8 | Channel A tone period (fine) |
| R1 | 4 | Channel A tone period (coarse) |
| R2 | 8 | Channel B tone period (fine) |
| R3 | 4 | Channel B tone period (coarse) |
| R4 | 8 | Channel C tone period (fine) |
| R5 | 4 | Channel C tone period (coarse) |
| R6 | 5 | Noise period |
| R7 | 8 | Mixer control (enable/disable tone/noise per channel) |
| R8 | 5 | Channel A amplitude (bit 4 = use envelope) |
| R9 | 5 | Channel B amplitude |
| R10 | 5 | Channel C amplitude |
| R11 | 8 | Envelope period (fine) |
| R12 | 8 | Envelope period (coarse) |
| R13 | 4 | Envelope shape |
| R14 | 8 | I/O Port A (usually unused) |
| R15 | 8 | I/O Port B (usually unused) |

### 11.4 Port Addresses

**128K/+2/+3:**
```
0xFFFD (write): Select register (active low A1, active low A15)
0xFFFD (read):  Read selected register
0xBFFD (write): Write to selected register
```

**Pentagon/Scorpion:**
Same port addresses as 128K.

**48K with add-on (Melodik, etc.):**
Various addresses depending on interface.

### 11.5 Tone Generation

Tone period is 12-bit (R0/R1, R2/R3, R4/R5):
```
Frequency = AY_Clock / (16 * TonePeriod)
```

For example, at 1.7734 MHz with period 256:
```
1773400 / (16 * 256) = 433 Hz
```

### 11.6 Noise Generation

Uses 17-bit LFSR (Linear Feedback Shift Register):
```javascript
// Polynomial: x^17 + x^3 + 1
const bit = ((shift ^ (shift >> 3)) & 1);
shift = (shift >> 1) | (bit << 16);
noiseOutput = shift & 1;
```

Noise period (R6, 5 bits) sets update rate:
```
NoiseFreq = AY_Clock / (16 * NoisePeriod)
```

### 11.7 Envelope Shapes

R13 selects one of 16 envelope shapes (only 4 bits used):

| Shape | Binary | Pattern | Description |
|-------|--------|---------|-------------|
| 0-3 | 00xx | `\___` | Decay once, then silent |
| 4-7 | 01xx | `/___` | Attack once, then silent |
| 8 | 1000 | `\\\\` | Continuous decay (sawtooth down) |
| 9 | 1001 | `\___` | Decay once, then silent |
| 10 | 1010 | `\/\/` | Decay-attack alternating (triangle) |
| 11 | 1011 | `\‾‾‾` | Decay once, then hold high |
| 12 | 1100 | `////` | Continuous attack (sawtooth up) |
| 13 | 1101 | `/‾‾‾` | Attack once, then hold high |
| 14 | 1110 | `/\/\` | Attack-decay alternating (triangle) |
| 15 | 1111 | `/___` | Attack once, then silent |

**Writing to R13 restarts the envelope from beginning.**

### 11.8 Mixer Control (R7)

```
Bit 0: Channel A tone disable (1 = off)
Bit 1: Channel B tone disable
Bit 2: Channel C tone disable
Bit 3: Channel A noise disable
Bit 4: Channel B noise disable
Bit 5: Channel C noise disable
Bit 6: I/O Port A direction (0 = input)
Bit 7: I/O Port B direction
```

### 11.9 Volume Table

The AY uses logarithmic volume scaling:

```javascript
const VOLUME_TABLE = [
    0.0000, 0.0137, 0.0205, 0.0291,
    0.0423, 0.0618, 0.0847, 0.1369,
    0.1691, 0.2647, 0.3527, 0.4499,
    0.5704, 0.6873, 0.8482, 1.0000
];
```

### 11.10 Timing and Prescaler

The AY internally divides its clock:
- Tone/noise counters update at **clock ÷ 8**
- Envelope counter updates at **clock ÷ 16**

```javascript
step() {
    this.prescaler++;

    if ((this.prescaler & 7) === 0) {
        // Update tone and noise
    }

    if ((this.prescaler & 15) === 0) {
        // Update envelope
    }
}
```

### 11.11 Stereo Modes

Common stereo configurations:

| Mode | Channel A | Channel B | Channel C |
|------|-----------|-----------|-----------|
| Mono | Center | Center | Center |
| ABC | Left | Center | Right |
| ACB | Left | Right | Center |

---

## 12. Beeper Audio

### 12.1 Overview

The 48K beeper is a 1-bit audio output controlled via port 0xFE bit 4. Despite being 1-bit, clever software achieves multi-channel and sample playback.

### 12.2 Port 0xFE Audio Bits

| Bit | Function |
|-----|----------|
| 3 | MIC output (directly affects MIC socket, also affects beeper on 128K) |
| 4 | EAR output / beeper |

### 12.3 Sample Rate Considerations

For accurate beeper emulation:
1. Track T-state of each OUT to port 0xFE
2. Record (tState, beeperLevel) pairs per frame
3. Resample to audio output rate (44100/48000 Hz)

```javascript
// At each OUT to port 0xFE
beeperChanges.push({
    tState: cpu.tStates,
    level: (value >> 4) & 1
});
```

### 12.4 DC Offset Removal

Beeper output oscillates around a DC level. Apply high-pass filter to remove DC:

```javascript
// Simple DC removal
output = input - dcLevel;
dcLevel = dcLevel * 0.999 + input * 0.001;
```

---

## 13. Extended Machines

### 13.1 Machine Comparison Table

| Machine | Year | RAM | ROM | CPU Clock | Lines | T/line | Contention | Special Features |
|---------|------|-----|-----|-----------|-------|--------|------------|------------------|
| 48K | 1982 | 48KB | 16KB | 3.5 MHz | 312 | 224 | Yes | - |
| 128K | 1985 | 128KB | 32KB | 3.5469 MHz | 311 | 228 | Yes | AY, 2 screens |
| +2 | 1986 | 128KB | 32KB | 3.5469 MHz | 311 | 228 | Yes | Same as 128K |
| +2A | 1987 | 128KB | 64KB | 3.5469 MHz | 311 | 228 | Yes | Different paging |
| +3 | 1987 | 128KB | 64KB | 3.5469 MHz | 311 | 228 | Yes | +3DOS, FDC |
| Pentagon | 1989 | 128KB | 32KB | 3.5 MHz | 320 | 224 | **No** | TR-DOS |
| Pentagon 512 | 1991 | 512KB | 32KB | 3.5 MHz | 320 | 224 | No | Extended RAM |
| Pentagon 1024 | 1994 | 1024KB | 32KB | 3.5/7 MHz | 320 | 224 | No | Turbo mode |
| Scorpion ZS 256 | 1991 | 256KB | 64KB | 3.5/7 MHz | 320 | 224 | No | PROF-ROM |

### 13.2 +2A/+3 Differences

The +2A and +3 use a different ULA (the same as each other) with key differences:

**Memory Paging:**
- Extra paging mode via port 0x1FFD
- Four special paging modes (all-RAM configurations)
- Different ROM arrangement (4 × 16KB ROMs)

**Port 0x1FFD (bits when bit 0 = 0):**
```
Bit 1: Special paging mode
Bit 2: High bit of ROM selection (with bit 4 of 0x7FFD)
Bit 3: Disk motor on
Bit 4: Parallel port strobe
```

**Special Paging Modes (port 0x1FFD bit 0 = 1):**
```
Bits 1-2 select configuration:
00: RAM 0, 1, 2, 3
01: RAM 4, 5, 6, 7
10: RAM 4, 5, 6, 3
11: RAM 4, 7, 6, 3
```

**+3 Floppy Disk Controller:**
- uPD765A FDC at ports 0x2FFD (status) and 0x3FFD (data)
- 3" CF-2 disk format (173KB per side)
- +3DOS file system

### 13.3 Pentagon Variants

**Pentagon 128 (base):**
- No memory contention
- 320 lines per frame (71680 T-states)
- TR-DOS support via Beta Disk interface
- Different border proportions (taller)

**Pentagon 512:**
- 512KB RAM (32 banks of 16KB)
- Extended paging via port 0x7FFD bits 6-7
- Port EFF7 for extended features

**Pentagon 1024:**
- 1024KB RAM (64 banks)
- Turbo mode (7 MHz CPU)
- Port 0xEFF7 controls:
  - Bit 2: Turbo enable
  - Bits 4-5: Additional RAM bank bits

### 13.4 Scorpion ZS 256

**Memory:**
- 256KB RAM (16 banks)
- 64KB ROM (4 banks)
- PROF-ROM support

**Paging (port 0x1FFD):**
```
Bit 0: RAM bank bit 3 (extension)
Bit 1: Block 0 is RAM (not ROM)
Bit 2: ROM bank bit 0
Bit 4: Turbo mode (7 MHz)
```

**Extended port 0x7FFD:**
```
Bits 0-2: RAM bank (low 3 bits)
Bit 3: Screen bank
Bit 4: ROM bank high bit
Bit 5: Paging lock
```

### 13.5 Timex Variants (TC2048, TC2068, TS2068)

**Timex 2048:**
- Compatible with 48K
- Extended display modes (512×192, dual screen)
- Port 0xFF for display mode

**Display Modes (port 0xFF):**
```
Bits 0-2: Screen mode
  000: Standard ZX mode
  001: Dual screen (A/B alternating per line)
  010: Extended color (no attributes, 8×1 cells)
  110: 512×192 monochrome
Bits 3-5: Screen bank
Bit 6: Disable screen
```

**Timex 2068:**
- 8×8 pixel attribute cells option
- Joystick ports built-in
- Horizontal scroll register

### 13.6 Russian Clones

| Clone | Based On | Key Differences |
|-------|----------|-----------------|
| Pentagon | 128K | No contention, TR-DOS, 320 lines |
| Scorpion ZS 256 | 128K | PROF-ROM, turbo, no contention |
| ATM Turbo | 128K | 512KB/1MB, turbo, enhanced video |
| Sprinter | Custom | 21 MHz, 4MB RAM, enhanced graphics |
| ZX Evolution (TS-Conf) | Custom | FPGA, 4MB RAM, enhanced video |
| Kay 1024 | Pentagon | 1MB RAM, turbo |
| Profi | Scorpion | 1MB RAM, CP/M compatible |

### 13.7 Modern FPGA Recreations

| Project | Origin | Description |
|---------|--------|-------------|
| ZX-Uno | Spain | Multi-core FPGA, emulates 48K/128K/Pentagon/+2A/+3 |
| ZX Spectrum Next | UK | Official successor, Z80N CPU, enhanced features |
| ZXDOS+ | Spain | ZX-Uno compatible, active development |
| MiSTer | International | Multi-system FPGA, Spectrum core available |
| ZX81+38 | Various | FPGA ZX81/Spectrum hybrid |

Note: FPGA implementations are hardware recreations, not clones. They can achieve cycle-perfect accuracy when properly implemented.

### 13.8 Beta Disk Interface (TR-DOS)

**Ports:**
```
0x1F: Command/Status register (WD1793 FDC)
0x3F: Track register
0x5F: Sector register
0x7F: Data register
0xFF: System register (drive select, side, density, HLD, etc.)
```

**TR-DOS ROM Paging (Pentagon):**
- ROM pages in when PC enters 0x3D00-0x3DFF
- ROM pages out when PC exits to RAM (0x4000+)

**TRD Disk Format:**
- 80 tracks, 2 sides, 16 sectors/track, 256 bytes/sector
- Total: 640KB (655360 bytes)
- First track contains directory and disk info

### 13.9 Adding New Machine Support

**Recommended abstraction:**

```javascript
class MachineConfig {
    constructor() {
        this.name = '';
        this.ramSize = 0;           // Total RAM in bytes
        this.ramBanks = 0;          // Number of 16KB banks
        this.romBanks = 0;          // Number of 16KB ROM banks
        this.cpuClock = 0;          // Hz
        this.tstatesPerLine = 0;
        this.linesPerFrame = 0;
        this.firstScreenLine = 0;
        this.hasContention = false;
        this.hasAY = false;
        this.hasFDC = false;        // Floppy disk controller
        this.fdcType = null;        // 'wd1793', 'upd765', etc.
        this.pagingPorts = {};      // Port definitions
    }
}
```

**Key extension points:**
1. Memory banking logic (port handlers)
2. Contention patterns (or lack thereof)
3. Video timing constants
4. I/O port mapping
5. ROM configuration
6. Special features (turbo, FDC, etc.)

### 13.10 ULAplus (Extended Palette)

ULAplus is a palette extension that provides 64 simultaneous colors from a 256-color palette. It is supported by many modern emulators, FPGA implementations (ZX-Uno, ZX Spectrum Next), and some hardware add-ons.

**I/O Ports:**

| Port | Function | Access |
|------|----------|--------|
| 0xBF3B | Register select | Write only |
| 0xFF3B | Data port | Read/Write |

**Register Port (0xBF3B) Format:**

| Bits | Function |
|------|----------|
| 7-6 | Group select: 00=Palette, 01=Mode |
| 5-0 | Palette entry (0-63) when group=00 |

**Palette Data Format (GRB, written to 0xFF3B):**

| Bits | Color | Range |
|------|-------|-------|
| 7-5 | Green | 0-7 |
| 4-2 | Red | 0-7 |
| 1-0 | Blue | 0-3 (expanded) |

**Blue Expansion:**
The 2-bit blue value is expanded to 3 bits: `00→000`, `01→011`, `10→101`, `11→111`

This gives access to 256 colors from a theoretical 512-color (9-bit GRB) palette.

**Palette Organization:**

The 64-entry palette is organized as 4 CLUTs (Color Lookup Tables) of 16 colors each:

| Entry | CLUT | Type | Selection |
|-------|------|------|-----------|
| 0-7 | 0 | INK | BRIGHT=0, FLASH=0 |
| 8-15 | 0 | PAPER | BRIGHT=0, FLASH=0 |
| 16-23 | 1 | INK | BRIGHT=1, FLASH=0 |
| 24-31 | 1 | PAPER | BRIGHT=1, FLASH=0 |
| 32-39 | 2 | INK | BRIGHT=0, FLASH=1 |
| 40-47 | 2 | PAPER | BRIGHT=0, FLASH=1 |
| 48-55 | 3 | INK | BRIGHT=1, FLASH=1 |
| 56-63 | 3 | PAPER | BRIGHT=1, FLASH=1 |

**CLUT Selection Formula:**
```
clut = (FLASH × 2) + BRIGHT
ink_entry = clut × 16 + INK
paper_entry = clut × 16 + 8 + PAPER
```

**Mode Register (group=01, written to 0xFF3B):**

| Bit | Function |
|-----|----------|
| 0 | ULAplus enable (1=on, 0=off) |
| 1 | Grayscale mode (1=on, 0=off) |

**Border Behavior:**
When ULAplus is enabled, the border color uses PAPER 0 from CLUT 0 (palette entry 8).

**Implementation:**

```javascript
class ULAplus {
    constructor() {
        this.palette = new Uint8Array(64);  // GRB values
        this.paletteRGB = new Uint32Array(64);  // Expanded 32-bit RGBA
        this.enabled = false;
        this.grayscale = false;
        this.selectedRegister = 0;
        this.registerGroup = 0;
    }

    writeRegisterPort(value) {
        // Port 0xBF3B
        this.registerGroup = (value >> 6) & 0x03;
        this.selectedRegister = value & 0x3F;
    }

    writeDataPort(value) {
        // Port 0xFF3B
        if (this.registerGroup === 0) {
            // Palette group
            this.palette[this.selectedRegister] = value;
            this.updatePaletteEntry(this.selectedRegister);
        } else if (this.registerGroup === 1) {
            // Mode group
            this.enabled = (value & 0x01) !== 0;
            this.grayscale = (value & 0x02) !== 0;
        }
    }

    readDataPort() {
        // Port 0xFF3B
        if (this.registerGroup === 0) {
            return this.palette[this.selectedRegister];
        } else if (this.registerGroup === 1) {
            return (this.enabled ? 1 : 0) | (this.grayscale ? 2 : 0);
        }
        return 0xFF;
    }

    updatePaletteEntry(index) {
        const grb = this.palette[index];
        const g3 = (grb >> 5) & 0x07;
        const r3 = (grb >> 2) & 0x07;
        const b2 = grb & 0x03;

        // Expand to 8-bit per channel
        const r = (r3 << 5) | (r3 << 2) | (r3 >> 1);
        const g = (g3 << 5) | (g3 << 2) | (g3 >> 1);
        // Blue expansion: 00→000, 01→011, 10→101, 11→111
        const b3 = b2 === 0 ? 0 : (b2 << 1) | 1;
        const b = (b3 << 5) | (b3 << 2) | (b3 >> 1);

        // Store as 32-bit RGBA (little-endian: ABGR)
        this.paletteRGB[index] = 0xFF000000 | (b << 16) | (g << 8) | r;
    }

    getColor(attr, isInk) {
        if (!this.enabled) {
            return null;  // Use standard ULA colors
        }

        const flash = (attr >> 7) & 1;
        const bright = (attr >> 6) & 1;
        const clut = flash * 2 + bright;
        const colorIndex = isInk ? (attr & 0x07) : ((attr >> 3) & 0x07);

        const paletteIndex = clut * 16 + (isInk ? colorIndex : 8 + colorIndex);
        return this.paletteRGB[paletteIndex];
    }
}
```

**Detection:**
Software can detect ULAplus by writing a value to palette entry 0, reading it back, and checking if it matches. Standard ULA returns floating bus on port 0xFF3B.

**File Format Support:**
Extended SCR files can include palette data:
- 6912 bytes: Standard screen (no palette)
- 6976 bytes: Screen + 64-byte palette
- 12288 bytes: Hi-res screen
- 12352 bytes: Hi-res + palette

**HAM256 Raster Effects:**

HAM256 (Hold And Modify 256) is a technique that updates the ULAplus palette mid-frame to display more than 64 colors simultaneously. The demo writes all 64 palette entries 12 times per frame, once for each 16-line group of the display.

To support HAM256 and similar raster effects:

1. **Track palette writes with T-states**: Record each palette write with its T-state timing:
   ```javascript
   paletteChanges.push({tState: cpu.tStates, reg: register, value: value});
   ```

2. **Group-based palette lookup**: HAM256 writes entries 0-63 sequentially, 12 times per frame. For rendering line Y (0-191):
   ```javascript
   const group = Math.floor(Y / 16);  // 0-11
   // Apply first (group+1)*64 palette changes
   const maxChanges = (group + 1) * 64;
   for (let i = 0; i < Math.min(maxChanges, changes.length); i++) {
       palette[changes[i].reg] = expandGRB(changes[i].value);
   }
   ```

3. **IM2 interrupt timing**: HAM256 uses IM2 with I=$3B, vector at $3BFF. The interrupt fires, then code delays until near the paper area before writing palette entries synchronized with the raster beam.

This approach works reliably on all machine types (48K, 128K, Pentagon) without requiring T-state timing calibration.

---

## 14. Emulator Architecture

### 14.1 Recommended Component Structure

```
┌─────────────────────────────────────────────────────┐
│                    Spectrum                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐ │
│  │   Z80   │  │ Memory  │  │   ULA   │  │   AY   │ │
│  │   CPU   │◄─┤ Manager │◄─┤  Video  │  │ Sound  │ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬───┘ │
│       │            │            │            │      │
│       └────────────┴────────────┴────────────┘      │
│                        │                             │
│  ┌─────────┐  ┌───────┴───────┐  ┌──────────────┐  │
│  │  Tape   │  │     Port      │  │   Beta Disk  │  │
│  │ Handler │  │    Handler    │  │   Interface  │  │
│  └─────────┘  └───────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 14.2 Frame Loop

```javascript
runFrame() {
    const targetT = this.tstatesPerFrame;

    while (this.cpu.tStates < targetT) {
        // Check for interrupt at frame start
        if (this.cpu.tStates < this.intPulseDuration) {
            if (this.cpu.iff1 && !this.cpu.halted) {
                this.cpu.interrupt();
            }
        }

        // Execute instruction
        this.cpu.execute();

        // Update peripherals (AY, tape, etc.)
        this.updatePeripherals();
    }

    // Render frame
    this.ula.renderFrame();

    // Handle frame overflow
    this.cpu.tStates -= targetT;
}
```

### 14.3 State Serialization

For save states and project files, serialize:

```javascript
exportState() {
    return {
        cpu: {
            af, bc, de, hl, af_, bc_, de_, hl_,
            ix, iy, sp, pc, i, r, r7,
            iff1, iff2, im, halted, memptr, q
        },
        memory: {
            ram: [...banks],
            pagingState: {...}
        },
        ula: {
            borderColor, flashState, frameCounter
        },
        ay: {
            registers: [...],
            toneCounters, noiseShift, envelopeState
        },
        timing: {
            tStates, frameCount
        }
    };
}
```

---

## 15. Performance Optimization (Without WASM)

Achieving 50+ FPS with full accuracy (multicolor, contention, undocumented behavior) in pure JavaScript requires careful optimization. Here are proven techniques:

### 15.1 CPU Core Optimizations

**Function Table Dispatch (vs Switch):**
```javascript
// Slower: switch with 256 cases - O(log n) or O(n) depending on engine
switch (opcode) { case 0x00: ... }

// Faster: function table - O(1) direct lookup
this.opcodeTable[opcode]();
```

**Inline Critical Operations:**
```javascript
// Slower: function call overhead
readByte(addr) {
    if (this.contend) this.contend(addr);
    return this.memory.read(addr);
}

// Faster: inline in hot paths
const val = this.memory.ram[addr - 0x4000];  // Direct array access when safe
```

**Avoid Property Access in Tight Loops:**
```javascript
// Slower: repeated property lookups
while (tStates < target) {
    this.cpu.tStates += 4;
    this.cpu.pc = (this.cpu.pc + 1) & 0xffff;
}

// Faster: cache in local variables
const cpu = this.cpu;
let tStates = cpu.tStates;
let pc = cpu.pc;
while (tStates < target) {
    tStates += 4;
    pc = (pc + 1) & 0xffff;
}
cpu.tStates = tStates;
cpu.pc = pc;
```

### 15.2 Memory System Optimizations

**Direct TypedArray Access:**
```javascript
// For non-contended reads in known RAM regions
// Skip the memory.read() abstraction when safe
const ram = this.memory.ram[5];  // Bank 5 reference
const val = ram[addr & 0x3FFF];  // Direct access
```

**Contention Lookup Table:**
```javascript
// Pre-compute contention delays for entire frame
this.contentionTable = new Uint8Array(70908);  // 128K frame
for (let t = 0; t < 70908; t++) {
    this.contentionTable[t] = calculateContentionDelay(t);
}

// In hot path: single array lookup vs calculation
delay = this.contentionTable[tStates];
```

**Memory Bank Caching:**
```javascript
// Cache current bank references to avoid recalculation
onPagingChange() {
    this.currentRomRef = this.rom[this.currentRomBank];
    this.currentRamRef = this.ram[this.currentRamBank];
    this.screenRef = this.ram[this.screenBank];
}
```

### 15.3 Event-Driven Architecture

Instead of checking conditions every instruction, schedule events:

```javascript
class EventScheduler {
    constructor() {
        this.events = [];  // Sorted by T-state
    }

    schedule(tState, callback) {
        // Insert in sorted order
        this.events.push({ t: tState, fn: callback });
        this.events.sort((a, b) => a.t - b.t);
        this.nextEventT = this.events[0]?.t ?? Infinity;
    }

    runUntil(targetT) {
        while (this.cpu.tStates < targetT) {
            // Fast path: no events pending
            if (this.cpu.tStates < this.nextEventT) {
                this.cpu.execute();
                continue;
            }
            // Process event
            const event = this.events.shift();
            event.fn();
            this.nextEventT = this.events[0]?.t ?? Infinity;
        }
    }
}
```

**Events to schedule:**
- Frame interrupt (T=0)
- End of INT pulse (T=32/36)
- Tape edge changes
- AY updates (per scanline or per N T-states)

### 15.4 Rendering Optimizations

**Deferred/Dirty Rendering:**
```javascript
// Track what changed during frame
this.dirtyLines = new Set();  // Lines with attribute changes
this.borderChanges = [];       // Border color changes with timestamps

// Only re-render affected areas
renderFrame() {
    if (this.borderChanges.length > 0) {
        this.renderBorder();
    }
    for (const line of this.dirtyLines) {
        this.renderScanline(line);
    }
    this.dirtyLines.clear();
}
```

**32-bit Pixel Writes:**
```javascript
// Slower: 4 separate byte writes
frameBuffer[offset] = r;
frameBuffer[offset + 1] = g;
frameBuffer[offset + 2] = b;
frameBuffer[offset + 3] = 255;

// Faster: single 32-bit write
frameBuffer32[offset >> 2] = palette32[colorIndex];
```

**Pre-computed Palette:**
```javascript
// Pre-pack RGBA as 32-bit values (endian-aware)
this.palette32 = new Uint32Array(16);
for (let i = 0; i < 16; i++) {
    const [r, g, b] = this.palette[i];
    this.palette32[i] = (255 << 24) | (b << 16) | (g << 8) | r;
}
```

**Batch Pixel Rendering:**
```javascript
// Render 8 pixels at once (one byte of bitmap data)
renderByte(bitmap, ink32, paper32, offset) {
    const fb = this.frameBuffer32;
    fb[offset]     = (bitmap & 0x80) ? ink32 : paper32;
    fb[offset + 1] = (bitmap & 0x40) ? ink32 : paper32;
    fb[offset + 2] = (bitmap & 0x20) ? ink32 : paper32;
    // ... etc, or unroll completely
}
```

### 15.5 Multicolor Without Per-Pixel Overhead

The challenge: multicolor requires tracking attribute changes mid-scanline.

**Solution 1: Record and Replay**
```javascript
// During CPU execution, record attribute writes with timestamps
onAttributeWrite(addr, val) {
    if (addr >= 0x5800 && addr <= 0x5AFF) {
        this.attrChanges.push({
            t: this.cpu.tStates,
            addr: addr,
            val: val
        });
    }
}

// At frame end, sort and replay during rendering
renderMulticolorLine(y) {
    const lineStartT = this.getLineTstate(y);
    const lineEndT = lineStartT + 128;

    // Get attribute changes for this line
    const changes = this.attrChanges.filter(c =>
        c.t >= lineStartT && c.t < lineEndT
    );

    // Render in segments between changes
    let lastT = lineStartT;
    for (const change of changes) {
        this.renderSegment(y, lastT, change.t);
        this.applyAttributeChange(change);
        lastT = change.t;
    }
    this.renderSegment(y, lastT, lineEndT);
}
```

**Solution 2: Scanline Snapshots**
```javascript
// Take attribute snapshot at specific T-states
// Faster than per-write tracking for most cases
onScanlineStart(line) {
    const attrRow = Math.floor(line / 8);
    this.scanlineAttrs[line] = this.memory.getBlock(
        0x5800 + attrRow * 32, 32
    );
}
```

### 15.6 Reduce Function Call Overhead

**Inline Small Functions:**
```javascript
// Before: function call per flag calculation
this.f = this.calculateFlags(result);

// After: inline the calculation
this.f = this.sz53Table[result] | (carry ? 1 : 0);
```

**Avoid Closure Allocation in Hot Paths:**
```javascript
// Bad: creates new function object each call
this.schedule(() => this.handleInterrupt());

// Good: reuse bound function
this.boundInterruptHandler = this.handleInterrupt.bind(this);
this.schedule(this.boundInterruptHandler);
```

### 15.7 Audio Optimizations

**Batch AY Updates:**
```javascript
// Instead of stepping AY every CPU T-state:
// Update once per scanline (224/228 T-states)
onScanlineEnd() {
    this.ay.stepMultiple(this.tstatesPerLine);
}
```

**Separate Audio Thread (Web Worker):**
```javascript
// Main thread: collect audio events
this.audioEvents.push({ t: tStates, type: 'beeper', val: level });
this.audioEvents.push({ t: tStates, type: 'ay', reg: r, val: v });

// Worker: process events and generate samples
// Communicates via SharedArrayBuffer for low latency
```

### 15.8 Frame Execution Strategies

**Instruction Batching (when safe):**
```javascript
// Execute multiple instructions without interrupt checks
// Safe when: not near frame boundary, no pending events
const safeRunUntil = Math.min(targetT, this.nextEventT);
while (this.cpu.tStates < safeRunUntil) {
    this.cpu.execute();  // No interrupt check inside
}
```

**Speculative Execution:**
```javascript
// Pre-execute next frame's early instructions during vsync
// Rollback if state differs (rare)
```

### 15.9 Profiling and Measurement

**Identify Bottlenecks:**
```javascript
// Chrome DevTools: Performance tab
// Firefox: Profiler
// Key metrics:
// - Time in execute()
// - Time in renderFrame()
// - GC pauses

// Simple measurement:
const t0 = performance.now();
this.runFrame();
const frameTime = performance.now() - t0;
console.log(`Frame: ${frameTime.toFixed(2)}ms`);  // Target: <20ms for 50fps
```

### 15.10 Summary: Optimization Priority

1. **Function table dispatch** - Major win, easy to implement
2. **32-bit pixel writes** - Significant rendering speedup
3. **Contention lookup table** - Removes calculation from hot path
4. **Cache property access** - Use locals in tight loops
5. **Event scheduling** - Avoid per-instruction checks
6. **Direct TypedArray access** - Skip abstraction when safe
7. **Batch rendering** - Process 8 pixels at once
8. **Deferred multicolor** - Record/replay vs per-pixel check

**What NOT to sacrifice for speed:**
- Accurate T-state counting
- Correct contention timing
- MEMPTR/Q flag behavior
- Proper interrupt timing
- Attribute timing for multicolor

---

## 16. Testing and Validation

### 16.1 FUSE Tests

The **FUSE** (Free Unix Spectrum Emulator) test suite provides comprehensive Z80 tests:
- `tests.in`: Input states
- `tests.expected`: Expected output states
- Covers all documented and undocumented opcodes
- Tests flags, timing, and register states

**Note:** The FUSE tests are well-established but date from the mid-2000s. Some Z80 behaviors discovered later (such as the Q register affecting SCF/CCF flags, detailed MEMPTR behavior in block instructions, and precise interrupt timing edge cases) may not be fully covered. Use newer test suites in addition to FUSE for complete validation.

### 16.2 Key Test Cases

1. **Flag tests**: All ALU operations with edge-case inputs
2. **Undocumented flag tests**: Bits 3/5, MEMPTR effects
3. **Timing tests**: Per-instruction cycle counts
4. **Contention tests**: Memory access patterns
5. **Block instruction tests**: BC=0 edge cases, interrupts

### 16.3 Visual Tests

For video timing validation:
- Border effects (Aquaplane, Uridium loading)
- Multicolor demos (Interlace, Shock)
- Floating bus detection (Arkanoid, Sidewize)

---

## 17. RZX Input Recording Format

### 17.1 Overview

RZX is the standard input recording format for ZX Spectrum emulators. It records all port IN operations, allowing exact replay of a session by feeding back the same inputs at the same instruction counts.

### 17.2 File Structure

```
Header Block (always first)
Creator Block (0x10) - optional but recommended
Snapshot Block (0x30) - embedded snapshot
Input Recording Block (0x80) - frame data
```

**Header Block (10 bytes):**
```
Offset  Size  Description
0       4     Signature "RZX!"
4       1     Major version (0)
5       1     Minor version (13)
6       4     Flags (bit 0 = encrypted)
```

**Creator Block (0x10):**
```
Offset  Size  Description
0       1     Block ID (0x10)
1       4     Block length (29)
5       20    Creator name (ASCII, null-padded)
25      2     Creator major version
27      2     Creator minor version
```

**Snapshot Block (0x30):**
```
Offset  Size  Description
0       1     Block ID (0x30)
1       4     Block length
5       4     Flags (bit 0 = external file, bit 1 = compressed)
9       4     Extension (.sna/.z80/.szx)
13      4     Uncompressed length
17      n     Snapshot data (compressed if flag set)
```

**Input Recording Block (0x80):**
```
Offset  Size  Description
0       1     Block ID (0x80)
1       4     Block length
5       4     Number of frames
9       1     Reserved (0)
10      4     Initial T-state count
14      4     Flags (bit 0 = encrypted, bit 1 = compressed)
18      n     Frame data (compressed if flag set)
```

### 17.3 Frame Data Structure

Each frame consists of:
```
Offset  Size  Description
0       2     Instruction count (M1 cycles, or 0xFFFF for repeat)
2       2     Input count (number of port IN values)
4       n     Input values (one byte per IN operation)
```

**Repeat frames**: If instruction count is 0xFFFF, this is a repeat frame:
```
Offset  Size  Description
0       2     0xFFFF marker
2       2     Number of times to repeat previous frame
```

### 17.4 Recording Implementation

**Critical timing requirement**: Recording must start immediately AFTER the interrupt fires, not at frame boundary.

```javascript
// Set pending flag when user requests recording
rzxStartRecording() {
    this.rzxRecordPending = true;
    this.rzxRecordedFrames = [];
}

// Actual recording starts after interrupt fires
// This happens in the interrupt handler:
if (this.rzxRecordPending) {
    this.rzxRecordSnapshot = this.createSZXSnapshot();
    this.rzxRecordTstates = this.cpu.tStates;  // ~19-20 T-states
    this.rzxRecordCurrentFrame = { fetchCount: 0, inputs: [] };
    this.rzxRecording = true;
    this.rzxRecordPending = false;
}
```

**Why this matters**: The keyboard scan routine (8 INs from port $00FE) runs in the interrupt handler. If recording starts at frame boundary (before interrupt), these 8 inputs get captured in frame 1 during playback instead of frame 0, causing desync.

**Snapshot format**: Use SZX format, not Z80, because SZX properly preserves the CPU halted state. Z80 format does not save halted state, causing playback issues.

### 17.5 Playback Implementation

**Early interrupt for HALT**: During RZX playback, fire interrupt early when CPU is halted:

```javascript
const rzxHaltedNeedsInt = this.rzxPlaying &&
    this.cpu.halted &&
    this.cpu.iff1 &&
    !this.cpu.eiPending;

if (rzxHaltedNeedsInt || normalIntWindow) {
    this.cpu.interrupt();
}
```

**Frame boundary handling**:
```javascript
// At frame end, check M1 count matches
if (actualM1Count !== expectedM1Count) {
    console.warn(`M1 mismatch: actual=${actualM1Count} expected=${expectedM1Count}`);
}

// Also verify all inputs were consumed
if (consumedInputs !== totalInputs) {
    console.warn(`Input mismatch: consumed=${consumedInputs}/${totalInputs}`);
}
```

### 17.6 Port IN Handling

During playback, intercept port reads:

```javascript
readPort(port) {
    if (this.rzxPlaying && this.rzxHasInput()) {
        return this.rzxGetNextInput();
    }
    return this.normalPortRead(port);
}
```

During recording, capture port reads:

```javascript
readPort(port) {
    const value = this.normalPortRead(port);
    if (this.rzxRecording) {
        this.rzxRecordCurrentFrame.inputs.push(value);
    }
    return value;
}
```

### 17.7 Compatibility Notes

Most RZX recordings work correctly. Some games with unusual timing (e.g., Batty) may fail due to edge cases in interrupt or contention timing.

| Emulator | Quirks |
|----------|--------|
| Spectaculator | Strict M1/input counting, good for validation |
| FUSE | Reference implementation, fires INT at frame end |
| EmuZWin | Requires proper frame structure |

**Common issues:**
- "Not enough port reads" - Frame boundary timing mismatch
- "Too many port reads" - Recording started at wrong point
- M1 mismatch - HALT handling or interrupt timing issue

---

## 18. References

### 18.1 Official Documentation

- Zilog Z80 User Manual
- ZX Spectrum Service Manual
- ZX Spectrum 128K Technical Reference

### 18.2 Community Resources

- [Z80 Documented](http://z80.info/z80doc.htm) - Sean Young's complete guide
- [Sinclair Wiki](https://sinclair.wiki.zxnet.co.uk/) - Spectrum technical details
- [World of Spectrum](https://worldofspectrum.org/) - Community and resources
- [FUSE Emulator](http://fuse-emulator.sourceforge.net/) - Reference implementation

**GitHub Z80 Test Repositories:**
- [raxoft/z80test](https://github.com/raxoft/z80test) - Patrik Rak's Z80 test suite (Q flag, MEMPTR, flags)
- [redcode/Z80](https://github.com/redcode/Z80) - Z80 library with extensive tests
- [floooh/chips-test](https://github.com/floooh/chips-test) - Tests for chips emulation library
- [hoglet67/Z80Decoder](https://github.com/hoglet67/Z80Decoder) - Z80 decode/timing analysis
- [maziac/z80-instruction-set](https://github.com/maziac/z80-instruction-set) - Z80 instruction reference

### 18.3 Reference Emulators

| Emulator | Notable Features |
|----------|------------------|
| FUSE | Reference accuracy, comprehensive tests, open source |
| Swan | Delphi, very accurate contention/floating bus, good source for timing |
| EmuzWin | Windows, accurate, extensive format support, built-in debugger |
| Unreal Speccy | Accurate Pentagon/Scorpion, TR-DOS, Russian scene standard |
| SpecEmu | Windows, very accurate timing, good debugging |
| ZXMAK2 | .NET, modular architecture, excellent debugging |
| ZEsarUX | Cross-platform, extensive machine support (80+ machines) |
| JSSpeccy3 | WebAssembly, cycle-accurate, modern web-based |
| Spectaculator | Windows, commercial, very accurate |
| ZX Spin | Windows, good debugging, tape analysis |

### 18.4 Test Suites

**Classic tests:**
- FUSE Z80 test suite - comprehensive but older (mid-2000s)
- Z80 Test Suite by Mark Woodmass
- ZEXALL/ZEXDOC CP/M tests (requires adaptation)

**Modern tests (covering recently discovered behaviors):**
- z80test by Patrik Rak - tests Q flag (SCF/CCF), MEMPTR, all undocumented flags
- Z80 Block Flags Test - detailed block instruction flag behavior
- Woody's Z80 other tests - extended MEMPTR and flag corner cases
- Timing tests from various demos - real-world contention validation

**Recommended approach:**
1. Start with FUSE tests for basic correctness
2. Add z80test for Q register and modern undocumented behavior
3. Validate timing with contention-sensitive demos (e.g., border effects)
4. Use floating bus tests (Arkanoid, Cobra) for I/O timing

---

## Appendix A: Quick Reference Tables

### A.1 Contention Pattern
```
T mod 8:  0  1  2  3  4  5  6  7
Delay:    6  5  4  3  2  1  0  0
```

### A.2 Machine Timing Summary
```
           48K      128K     Pentagon
T/line:    224      228      224
Lines:     312      311      320
T/frame:   69888    70908    71680
INT len:   32T      36T      36T
Contention: Yes     Yes      No
```

### A.3 I/O Contention Patterns
```
Port type                    Pattern
ULA (bit 0 = 0):            C:1, C:3
Non-ULA, high contended:    C:1, C:1, C:1, C:1
Non-ULA, high not contended: N:4
```

### A.4 AY Register Quick Reference
```
R0-R1:  Channel A period (12-bit)
R2-R3:  Channel B period (12-bit)
R4-R5:  Channel C period (12-bit)
R6:     Noise period (5-bit)
R7:     Mixer (bits 0-2=tone disable, 3-5=noise disable)
R8-R10: Amplitude (bit 4=envelope mode)
R11-R12: Envelope period (16-bit)
R13:    Envelope shape
R14-R15: I/O ports (unused on Spectrum)
```

### A.5 Extended Machine Memory Maps

**128K/+2:**
```
0x0000-0x3FFF: ROM 0 or ROM 1 (16KB each)
0x4000-0x7FFF: RAM Bank 5 (always)
0x8000-0xBFFF: RAM Bank 2 (always)
0xC000-0xFFFF: RAM Bank 0-7 (switchable)
```

**+2A/+3 Special Modes:**
```
Mode 0: RAM 0, RAM 1, RAM 2, RAM 3
Mode 1: RAM 4, RAM 5, RAM 6, RAM 7
Mode 2: RAM 4, RAM 5, RAM 6, RAM 3
Mode 3: RAM 4, RAM 7, RAM 6, RAM 3
```

**Pentagon 512/1024:**
```
Extended banking via port 0x7FFD bits 6-7
Port 0xEFF7 for turbo and more RAM bits
Total banks: 32 (512KB) or 64 (1024KB)
```

### A.6 Port Summary by Machine

**48K:**
```
0xFE (any even): ULA (border, beeper, keyboard)
0x1F, 0x7F:      Kempston joystick (optional)
```

**128K/+2:**
```
0xFE:    ULA
0x7FFD:  Memory paging (A15=0, A1=0)
0xFFFD:  AY register select
0xBFFD:  AY data write
```

**+2A/+3:**
```
+ 0x1FFD: Extended paging, disk motor
+ 0x2FFD: FDC status (+3 only)
+ 0x3FFD: FDC data (+3 only)
```

**Pentagon:**
```
0xFE:    ULA
0x7FFD:  Memory paging
0xFFFD:  AY register select
0xBFFD:  AY data write
0x1F-0xFF: Beta Disk (WD1793)
```

**ULAplus (extension for any machine):**
```
0xBF3B:  Register select (write)
0xFF3B:  Data port (read/write)
```

---

## Appendix B: Envelope Shape Reference

```
Shape 0-3 (\___):   15→0, hold at 0
                    ████▄▃▂▁________

Shape 4-7 (/___):   0→15, hold at 0
                    ▁▂▃▄████________

Shape 8 (\\\\):     15→0, repeat
                    ████▄▃▂▁████▄▃▂▁

Shape 9 (\___):     15→0, hold at 0
                    ████▄▃▂▁________

Shape 10 (\/\/):    15→0→15, repeat
                    ████▄▃▂▁▂▃▄████▄▃▂▁

Shape 11 (\‾‾‾):    15→0, hold at 15
                    ████▄▃▂▁████████

Shape 12 (////):    0→15, repeat
                    ▁▂▃▄████▁▂▃▄████

Shape 13 (/‾‾‾):    0→15, hold at 15
                    ▁▂▃▄████████████

Shape 14 (/\/\):    0→15→0, repeat
                    ▁▂▃▄████▄▃▂▁▂▃▄████

Shape 15 (/___):    0→15, hold at 0
                    ▁▂▃▄████________
```

---

## Appendix C: Clock and Timing Calculations

### Frame Rate Calculation
```
FrameRate = CPU_Clock / T_states_per_frame

48K:      3500000 / 69888  = 50.08 Hz
128K:     3546900 / 70908  = 50.02 Hz
Pentagon: 3500000 / 71680  = 48.83 Hz
```

### Sound Frequency Calculation
```
AY Tone:     Freq = AY_Clock / (16 × Period)
AY Noise:    Freq = AY_Clock / (16 × Period)
AY Envelope: Freq = AY_Clock / (256 × Period)
```

### Beeper Pitch from Loop Timing
```
Many beeper routines use:
  LD B, pitch
loop:
  DJNZ loop      ; 13T taken, 8T last

Cycles per half-period = 13×(B-1) + 8 = 13×B - 5
Full period = 2 × (13×B - 5) T-states
Frequency = CPU_Clock / (2 × (13×B - 5))
```

---

*Document created for ZX-M8XXX emulator project. Version 1.2 - February 2026.*
*Contributions and corrections welcome.*
