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
//   pagingModel              - 'none' | '128k' | '+2a' | 'pentagon1024' | 'scorpion'
//   ulaProfile               - ULA timing: '48k' | '128k' | 'pentagon'
//   hasContention             - Memory contention enabled (false for Pentagon/Scorpion)
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


**Defined machines**: `48k`, `128k`, `+2`, `+2a`, `+3`, `pentagon`, `pentagon1024`, `scorpion`

**Adding a new machine**: Add profile to `MACHINE_PROFILES` in `machines.js`. The profile drives memory init, ULA timing, port decoding, contention, and snapshot format mapping. Add ULA border/timing entries if `ulaProfile` is new. If the machine needs a new ROM file, add it to the `roms/` directory.

**Visible machines**: Users choose which machines appear in the dropdown via Settings → Machines. Default: `['48k', '128k', 'pentagon']`. Stored in localStorage key `zx-visible-machines`.

**Pentagon 1024 paging**: Port 0xEFF7 bit 2 = 0 enables 1MB mode (bit 5 of 7FFD selects bank bit 5). Bit 3 = 1 maps RAM page 0 over ROM at 0x0000-0x3FFF. Port 7FFD bits 0-2 + 6,7 + (5 in 1MB mode) select from 64 RAM pages.

**Scorpion ZS 256 paging**: 256KB RAM (16 pages), 4 ROM banks in `scorpion.rom` (ROM0=128 BASIC, ROM1=48 BASIC, ROM2=Service Monitor, ROM3=TR-DOS). Port 0x7FFD decoded as `(port & 0xC002) === 0x4000` (+3-style per FUSE, NOT loose 128K decode — A14=1 required to distinguish from 1FFD). Port 0x1FFD decoded as `(port & 0xF002) === 0x1000` (+3-style, A14=0). RAM page = `((1FFD & 0x10) >> 1) | (7FFD & 0x07)` → pages 0-15 (per FUSE/ZXMAK2/UnrealSpeccy/official programmer's guide). 1FFD bits: bit 0 = RAM page 0 over ROM, bit 1 = ROM 2 select, bit 4 = RAM page high bit (+8). ROM selection is 3-way (per FUSE): 1FFD bit 1 set → ROM 2 (Service Monitor); unset → stored 7FFD bit 4 selects ROM 0/1. **Implementation note**: `scorpionPort7FFD` stores the last 7FFD value for ROM bank fallback when 1FFD bit 1 is cleared — using `currentRomBank & 1` is incorrect when transitioning from ROM 2 (gives 0 instead of the 7FFD-selected bank). TR-DOS is built into ROM bank 3 (`trdosInRom: true`, `trdosRomBank: 3`) — loaded into Beta Disk ROMCS, no separate `trdos.rom` needed. SZX machine ID: 8.

