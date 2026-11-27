# Machine profiles: fields and paging rules

Moved out of CLAUDE.md so the always-loaded map stays small.

Data-driven machine definitions. Each profile defines hardware properties used across the emulator.

```javascript
// Get a profile object by machine type ID
const profile = getMachineProfile('128k');

// Profile properties:
//   id, name, group          - Identity and UI grouping ('Sinclair', 'Pentagon', 'Scorpion')
//   ramPages, romBanks       - Memory: 1/8/64 RAM pages, 1/2/4 ROM banks
//   romFile, romSize          - ROM filename and total size in bytes
//   basicRomBank             - ROM bank containing BASIC (0 for 48K, 1 for 128K/Pentagon, 3 for +2A/+3)
//   pagingModel              - 'none' | '128k' | '+2a' | 'pentagon1024' | 'scorpion' | 'hc2000'
//   ulaProfile               - ULA timing: '48k' | '128k' | 'pentagon'
//   hasContention             - Memory contention enabled (false for Pentagon/Scorpion)
//   evenM1                    - Scorpion Even M1: an opcode fetch from RAM is held
//                               until an even T-state, so an instruction run from RAM
//                               takes its length rounded UP to even (LD A,n is 8)
//   attrBusPorts              - Scorpion: a port nobody answers reads the ATTRIBUTE the
//                               screen hardware is fetching, not a Ferranti floating bus
//   hasIOContention           - IO port contention (false for +2A/+3/Pentagon/Scorpion)
//   hasInternalContention     - Internal cycle contention (false for +2A/+3/Pentagon/Scorpion)
//   contentionPattern         - '65432100' (48K/128K/+2) | '76543210' (+2A/+3) | 'none'
//   borderQuantization        - Border color changes quantized (false for Pentagon/Scorpion)
//   intPulseDuration          - INT pulse T-states (32 for 48K, 36 for others)
//   earlyIntTiming            - true = 48K-style early INT point
//   ayDefault, ayClockHz     - AY chip enabled by default, clock frequency
//   betaDiskDefault           - Beta Disk interface enabled by default
//   z80HwMode, szxMachineId  - Snapshot format machine identifiers
//   hasFDC                    - true if machine has µPD765 FDC (+3 only)
//   is128kCompat              - true for 128K, +2, +2A, +3
//   trdosInRom                - true if TR-DOS is in main ROM (Scorpion: bank 3)
//   trdosRomBank              - ROM bank containing TR-DOS (Scorpion: 3)

// Helpers
getMachineTypes()                     // All machine type IDs
getMachineByZ80HwMode(hwMode, len)    // Reverse lookup from Z80 snapshot hw mode
getMachineBySzxId(id)                 // Reverse lookup from SZX machine ID
```


**Defined machines**: `48k`, `128k`, `+2`, `+2a`, `+3`, `pentagon`, `pentagon1024`, `scorpion`, `hc2000`

**Adding a new machine**: Add profile to `MACHINE_PROFILES` in `machines.js`. The profile drives memory init, ULA timing, port decoding, contention, and snapshot format mapping. Add ULA border/timing entries if `ulaProfile` is new. If the machine needs a new ROM file, add it to the `roms/` directory.

**Visible machines**: Users choose which machines appear in the dropdown via Settings → Machines. Default: `['48k', '128k', 'pentagon']`. Stored in localStorage key `zx-visible-machines`.

**HC-2000 paging** (port of FUSE `hc2000.c`, branch `hc2000-v2` of vamposdecampos/fuse-emulator-svn): 64KB RAM held in 128K bank numbers — 0 (under the ROM, CP/M), 5 ($4000), 2 ($8000), 7 ($C000) — so CVS is the 128K shadow screen and nothing else needs a special case. `Memory._hcRemap()` builds eight 8KB read/write views. Port $7E (A7=0, A0=0): D0 B/OL (ROM 0 BASIC / 1 CP/M), D1 CPMPL (RAM at $0000, upper 8KB of the ROM at $E000), D2 lock until reset, D3 CVS (screen at $C000). Ports $C5/$C7 drop/raise CPM: the $E000 RAM also appears at $C000. The ULA port is A7=1, A0=0 on the HC, so $7E touches neither border nor keyboard. No contention; 48K timing. ROM: `hc2000.rom` (32KB) or FUSE's `hc2000-0.rom` + `hc2000-1.rom`, glued on load. SZX machine ID 17 (FUSE's); SPCR byte 1 carries $7E, byte 3 the last of $C5/$C7. The HC IF1 floppy interface is fitted by default and can be switched off — see docs/peripherals.md.

**Pentagon 1024 paging**: Port 0xEFF7 bit 2 = 0 enables 1MB mode (bit 5 of 7FFD selects bank bit 5). Bit 3 = 1 maps RAM page 0 over ROM at 0x0000-0x3FFF. Port 7FFD bits 0-2 + 6,7 + (5 in 1MB mode) select from 64 RAM pages.

## CPU variant

Which Z80 a machine was fitted with is **not** a machine profile field: any
Spectrum could have either part, so it is one setting (Settings -> Machines,
`zxm8_cpuVariant`) applied through `spectrum.setCpuVariant()`.

Only two behaviours differ in a way software can see, and they are **independent**,
which is why `core/z80.js` carries two fields (`xcfMask`, `outVc255`) rather than one
enum. The named variants are the documented combinations:

| variant | SCF/CCF YF | SCF/CCF XF | `OUT (C),0` |
|:--|:--|:--|:--|
| `zilog-nmos` (default) | `A.5 \| (F^Q).5` | `A.3 \| (F^Q).3` | 0 |
| `zilog-cmos` | `A.5 \| (F^Q).5` | `A.3 \| (F^Q).3` | **255** |
| `nec-nmos` | `A.5` | `A.3` | 0 |
| `st-cmos` | `A.5 \| (F^Q).5` | `A.3` | 0 |

Sources: Patrik Rak cracked the Zilog SCF/CCF rule in 2012; **David Banks** found in
2018 that ST CMOS parts take XF from A alone and NEC NMOS parts take both from A;
**Simon Cooke** reported the `OUT (C),0` -> 255 behaviour on Usenet in 1996.

**`st-cmos` keeps `OUT (C),0` -> 0 deliberately.** The 255 report is for the *Zilog*
CMOS part and no source here extends it to ST, so asserting it would be a guess
dressed as a fact. `tests/cpu-variant-test.html` pins that as a decision.

The application-test runner forces `zilog-nmos` per test and restores afterwards, for
the same reason it pins snow and Kempston: a Settings dropdown must not decide a
result. A test that is *about* a variant names it with `"cpuVariant"`.

**Scorpion ZS 256 timing**: the 48K frame, **224 x 312 = 69888 T-states**, not the Pentagon 71680 it used to be given (`ulaProfile: 'scorpion'`). No memory or I/O contention, like the other clones, but two features of its own:

- **Even M1** (`evenM1`): the machine holds an opcode fetch from RAM until an even T-state. The wait belongs to the fetch, so it lands on the *next* instruction's first M1 -- which is what makes every instruction run from RAM span an even number of ticks. ROM fetches are not held, which is why TactMeter reads 069874 from ROM and 069872 from RAM. Implemented in `setupContention`'s no-contention path in `core/spectrum.js`, using `memory.isRomAt()`.
- **Attribute bus** (`attrBusPorts`): an unused port reads the attribute byte being fetched -- one per character cell, so one per 4 T-states, with no idle half. `getAttrBusValue()`. The behaviour is in the machine's programmer's guide; **the exact tick alignment is fitted to ctprobe's grid, which its own README calls unconfirmed on real hardware**, and is a single constant if that is ever settled.

`tests/tests.json` has `ctprobe-scorpion`, which reports *attr bus, Even M1*, frame 69888, and **ALL VALUES AS EXPECTED**; `TactMeterV1.0` is the independent check -- it is a program written for the machine and its numbers moved from 071680 to 069872.

**Scorpion ZS 256 paging**: 256KB RAM (16 pages), 4 ROM banks in `scorpion.rom` (ROM0=128 BASIC, ROM1=48 BASIC, ROM2=Service Monitor, ROM3=TR-DOS). Port 0x7FFD decoded as `(port & 0xC002) === 0x4000` (+3-style per FUSE, NOT loose 128K decode — A14=1 required to distinguish from 1FFD). Port 0x1FFD decoded as `(port & 0xF002) === 0x1000` (+3-style, A14=0). RAM page = `((1FFD & 0x10) >> 1) | (7FFD & 0x07)` → pages 0-15 (per FUSE/ZXMAK2/UnrealSpeccy/official programmer's guide). 1FFD bits: bit 0 = RAM page 0 over ROM, bit 1 = ROM 2 select, bit 4 = RAM page high bit (+8). ROM selection is 3-way (per FUSE): 1FFD bit 1 set → ROM 2 (Service Monitor); unset → stored 7FFD bit 4 selects ROM 0/1. **Implementation note**: `scorpionPort7FFD` stores the last 7FFD value for ROM bank fallback when 1FFD bit 1 is cleared — using `currentRomBank & 1` is incorrect when transitioning from ROM 2 (gives 0 instead of the 7FFD-selected bank). TR-DOS is built into ROM bank 3 (`trdosInRom: true`, `trdosRomBank: 3`) — loaded into Beta Disk ROMCS, no separate `trdos.rom` needed. SZX machine ID: 8.

**Scorpion ROM selection** (MAME `scorpion_update_memory`, `Memory._scorpionRomRead`): 1FFD bit 0 (RAM page 0) comes first; then 1FFD bit 1 shows the Service ROM (2) **even while the DOS is on**; then the DOS shows TR-DOS (3); else 7FFD bit 4 picks 0 / 1. The DOS comes on at an opcode fetch in $3D00-$3DFF with **7FFD bit 4 set**, whatever ROM 1FFD shows (MAME `beta_enable_r`). With the DOS off, port $1F (`xxxxxxxx0x0xxx11`) returns the Beta Disk's INTRQ / DRQ in bits 7-6 (and the Kempston stick in 0-4): the ProfROM issues a WD1793 command through TR-DOS, comes back to its Service ROM through RAM (the DOS goes off) and waits on them there.

**Scorpion ZS 256 TURBO+ (1MB)** (`scorpiontb`, MAME `scorpiontb_state`): `profrom.rom`, the 256KB ProfROM 4.xx, as four 64KB **planes** of four ROMs (`romBanks: 16`, the ROM read is `rom[plane * 4 + bank]`). Reading $0100 / $0104 / $0108 / $010C while the Service ROM is in moves to another plane by MAME's `prof_plane_map` (`PROF_PLANE_MAP`, indexed by `(addr & $0C) | plane`); `peek()` does not switch. 1MB: RAM page bits 4-5 from 1FFD bits 6-7. **Turbo**: IN from $7FFD (`port & $C023 = $4021`) switches the CPU to 7 MHz, IN from $1FFD (`$0021`) back to 3.5 (`setHwTurbo`); reset turns it off. AY register 14 reads back `(7FFD bit 4) << 1 | 1FFD bit 4 | 7FFD bits 0-3`. No Even-M1 wait on this board. SMUC is not emulated, but with the DOS on its IDE registers ($xxBE) read $7F, a cable with no drive (the ATA pull-down on D7: not busy) -- read as a floating bus, BUSY never drops and the ProfROM waits a minute for its "HDD master not found". Disks auto-start through the ProfROM menu (Enter on "128 TR-DOS", then `RUN "name"`): its 48K ROM is its own, so the jump straight into TR-DOS that `bootTrdos()` does elsewhere lands in the ProfROM's self-test. Test: `tests/scorpion-test.html`.

**CPU turbo** (`Spectrum._turboSpend`, `setTurboForce`, `setHwTurbo`): after each instruction (and each HALT step) the T-states it took are divided by the multiplier, the remainder carried over, so the Z80 does 2x / 4x the work in a frame while the frame, the screen, the sound, the tape and the disks keep the machine's clock. Settings > Machines > CPU > Turbo: "as the machine" (only the TURBO+ has one), off, x2, x4 (`zxm8_turbo`).
**Scorpion GMX (2MB)** (`scorpiongmx`, MAME `scorpiongmx_state`): `gmx.rom`, 512KB (MAME's gmx12500, "GMX Boot Rom 1.2 V5.00"; ProfROM+GMX images of 512KB load as well), eight 64KB planes picked by **#7EFD bits 4-6** (no plane switch on reads: MAME installs that tap on the TURBO+ only) unless #00 bit 4 (FIXROM). Ports, each fully decoded and off while #00 bit 5 (BLKEXT) is set: **#00** (any high byte) global configuration, bit 3 the magic shift register and, without FIXROM, a CPU restart; **#78FD** the RAM page at $8000 XOR 2 (`Memory.slot2Page`; reads back with BRD1 and the magic bit); **#7AFD** / **#7CFD** the scroll, low / high (reads #7AFD: the $C000 page and BRD0); **#7EFD** bit 7 turbo, bit 3 the 640x200 mode, bit 2 magic off (reads: turbo, the mode, 1FFD bit 0, 7FFD bits 3/5, BRD2); **#DFFD** bits 0-2, the $C000 page bits 4-6 (1FFD bits 6-7 are not used here). 1FFD bit 2 pages TR-DOS in over everything and switches the DOS on. The TURBO+'s IN-from-#7FFD/#1FFD turbo and AY R14 stay; the 7xFD reads above do not count as #7FFD. **640x200** (`Spectrum._blitGmx`): pixels from page #39 (#3B with 7FFD bit 3), 80 bytes a line, the attribute 64 pages up (ink = bits 0-2 + bit 6, paper = bits 3-6, bit 7 flashes), scrolled by whole lines (scroll / 80); drawn whole at the frame's end on the doubled canvas the Timex hi-res uses. Tested with Puzzle Bobble and Edge Grinder for GMX. Magic NMI and its register lock are not done.
**CMOS clock** (`core/cmos.js`, `Spectrum.rtc`, after Xpeccy+ `libxpeccy/cmos.c` and `hdd.c`): an MC146818 with the host's time (BCD unless register B bit 2; weekday 1-7 from Sunday; register C bit 4 rises once a second and a read clears it; D reads $80) and 114 bytes of CMOS RAM, kept in the browser (`zxm8_cmos`). Settings > Machines > CPU > CMOS clock (`zxm8_rtc`, on by default). **Gluk** on the Pentagon and Pentagon 1024 (decoded on A15-A12 and A3): #EFF7 bit 7 puts the clock on the bus (reset clears it), #DFF7 picks the register, #BFF7 reads and writes it. **SMUC** on the Scorpions, only with TR-DOS paged in (`(port & $18E3) = $18A2`, register by A15/A13/A2): version 1.2 (#5FBA $3F, #5FBE $57), #7FBA the virtual-FDD latch (`val & $C8`, read `| $37`; ProfROM writes it and reads it back -- a constant there gave "Disc Error"), #FFBA SYS with the **NVRAM**, a 24C16 2KB I2C EEPROM (`core/nvram.js`, a port of Xpeccy+ `nvram.c`; SDA = bit 4, SCL = bit 6, SDA read back in bit 6; kept in the browser as `zxm8_smucnv`), where the ProfROM keeps its settings -- without it the ProfROM never looks at the clock, and GB 3.4.1.1 shows no time, #DFBA the clock -- address while SYS bit 7 is 0, data while it is 1 -- and the IDE registers as a cable with no drive ($7F). HFT 1.02 then reports "CMOS: SMUC". Test: `tests/scorpion-test.html`.

