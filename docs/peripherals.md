# Peripherals: Joysticks, +D/MGT, IF1/Microdrive, Opus Discovery, Didaktik 40/80, +3/FDC

## Joysticks (`core/joystick.js`)

Settings -> Input picks what the numpad and gamepad emulate. Only Kempston is
hardware; the rest close ZX keyboard contacts, so the machine presses those keys.

| Type | Left | Right | Down | Up | Fire |
|------|------|-------|------|----|------|
| Kempston | port $1F bit 1 | bit 0 | bit 2 | bit 3 | bit 4 |
| Sinclair 1 (Interface 2 right) | 6 | 7 | 8 | 9 | 0 |
| Sinclair 2 (Interface 2 left) | 1 | 2 | 3 | 4 | 5 |
| Cursor / AGF / Protek | 5 | 8 | 6 | 7 | 0 |
| Custom | any key | any key | any key | any key | any key |

**Custom keys** default to QAOP + Space and are rebound in place: click the button
for a direction, press the key. Partial settings are filled in from the defaults,
so a direction can never end up unbound.

Direction masks use the Kempston bit numbering the input layer already speaks, so
the numpad and gamepad paths feed all types without separate plumbing.
`setJoystickType()` and `setJoystickCustomKeys()` release whatever the previous
binding was holding, otherwise a key stays stuck down in the matrix.

Note Sinclair 1 and Cursor share fire (key 0), which is why some games accept
either.

### The Kempston port ($1F)

**Kempston port** in Settings -> Input is whether the interface is *fitted*, not
whether the numpad is mapped to it — it is on by default. Decoding is partial: the
one-chip design reads on any I/O access with A5 low, the two-chip one also checks
A6/A7, so we take the stricter form (FUSE's `kempston_strict_decoding`) and match
ports $00-$1F. That deliberately stops short of the Kempston mouse at $DF, which
also has A5 low.

Untick it and the port must go **silent**, not read zero. The interface is a bus
device; with no card in the slot nothing drives the data bus, so `IN 31` returns the
idle bus ($FF) or, during the display, the floating bus. Zero would read as
*"interface present, stick centred"* — the value detection routines look for — so an
absent interface answering 0 makes every game believe one is fitted (issue #12).
The port read simply falls through to the floating-bus default for this.

## DISCiPLE/+D Interface (MGT Disks)

External +D disk interface with WD1772 floppy controller. Supports .mgt/.img disk images.

**MGT Disk Format:**
- 819,200 bytes: 80 tracks x 2 sides x 10 sectors/track x 512 bytes/sector
- Directory: tracks 0-1 (both sides) = 80 entries x 256 bytes
- Sector offset: `((track * 2 + side) * 10 + (sector - 1)) * 512`
- File types: 0=erased, 1=BASIC, 2=num array, 3=str array, 4=CODE, 5=48K snap, 7=SCREEN$, 9=128K snap, 10=opentype, 11=execute
- Sector address map in directory entry bytes 15-209: sequential (track, sector) pairs. Some disks leave this area zeroed/invalid and use contiguous allocation from firstTrack/firstSector instead.
- Directory entry key offsets: 210=file type, 211-212=data length, 214-215=start address (PROG sysvar for BASIC, load address for CODE), 216-217=type-specific (body length for BASIC, 0x8000 for CODE), 218-219=autostart line (BASIC only; 0x8000 = no autostart).
- File data on disk has a 9-byte +D header: `type(1) + datalen(2 LE) + startAddr(2 LE) + progLen(2 LE) + autostart(2 LE)`. Must be stripped for BASIC decoding.
- Single-sided images: 819,200-byte image with side 1 all zeros. Contiguous allocation stays on side 0 only, advancing tracks.

**PlusDDisk class (`core/loaders.js`):**
- WD1772 FDC emulation (similar to WD1793 in BetaDisk but 512-byte sectors, 10 sectors/track)
- 2 drives, instant-completion model
- Port decode (low byte, per FUSE plusd.c): 0xE3=cmd/status, 0xEB=track, 0xF3=sector, 0xFB=data, 0xEF=control, 0xE7=paging
- Control register $EF: bits 0-1=drive, bit 7=side, bit 6=printer strobe. Paging port $E7: read=page in, write=page out

**MGTLoader class (`core/loaders.js`):**
- `isMGT(data)` -- detect by size (819200) and directory validity
- `listFiles(data)` -- parse 80 directory entries
- `extractFile(data, fileInfo)` -- follow sector address map if valid (all entries have track 0-79/128-207, sector 1-10); falls back to contiguous allocation from firstTrack/firstSector when map is invalid. Detects single-sided images to avoid reading empty side 1 sectors.
- `fileToTAP(fileData, fileInfo)` -- convert to TAP block
- `getDiskInfo(data)` -- disk statistics (used sectors, free sectors, file count)

**Memory paging (`core/memory.js`):**
- `plusDActive` flag: when true, 0x0000-0x1FFF reads from +D ROM, 0x2000-0x3FFF reads/writes +D RAM
- `loadPlusDRom(data)` / `hasPlusDRom()` -- 8KB ROM management

**Integration (`core/spectrum.js`):**
- `plusDEnabled` flag + `_isPlusDActive()` check (allows port I/O when ROM paged in OR disk inserted)
- Port decode in `portRead()`/`portWrite()` for WD1772 registers
- `loadMGTImage(data, fileName, driveIndex)` -- load MGT into +D drive
- `triggerPlusDNmi()` -- pages in +D ROM/RAM and triggers Z80 NMI (PC->0x0066)
- `updatePlusDPaging()` -- auto-paging per FUSE z80_ops.c: page in at $0008 (RST 8), $003A (KEY-NEXT), $0066 (NMI), $028E (KEY-SCAN). No ROM bank restriction (unlike IF1). Page out via paging port $E7 write (handled directly in `portWrite()`)
- `_plusDPagingEnabled` flag -- computed in `updateBetaDiskPagingFlag()`, requires `plusDEnabled + hasPlusDRom + pagingModel !== '+2a'`
- `loadedPlusDDisks[0..1]` / `loadedPlusDDiskFiles[0..1]` -- per-drive state

**Settings (`ui/input-settings.js`):**
- `chkPlusD` checkbox: enable/disable +D interface
- `plusd.rom` file loading via ROM selector or Settings button
- NMI button: triggers +D snapshot (pages in ROM, CPU NMI)
- Persisted in localStorage key `zxm8_plusD`

**Explorer (`ui/explorer.js`):**
- `explorerParseMGT(data)` -- parse directory, file list
- `explorerRenderMGTInfo()` -- display disk info, clickable file entries
- Edit tab: create, import, edit, save MGT disks (`diskEditorNewMgt`, `diskEditorBuildMgt`, etc.)
- Editor export and cross-format copy: `mgtExtractCleanData(file)` extracts clean file data from raw 512-byte sectors (510 data + 2-byte chain pointer), strips 9-byte +D header, trims to `file.length`
- Cross-format copy: MGT <-> TRD/SCL/TAP/TZX/DSK file conversion

**Media catalog (`ui/media-catalog.js`):**
- Drive tabs with "MGT:" prefix when multiple controllers active
- File list with MGT type names and addresses

## Interface 1 / Microdrive (MDR Cartridges)

External Interface 1 with Microdrive tape-loop cartridge support. Supports .mdr cartridge images.

**MDR Cartridge Format:**
- 137,923 bytes: 254 sectors x 543 bytes + 1 write-protect flag byte
- Sector layout: 15-byte header (HDFLAG, HDNUMB, unused x 2, HDNAME x 10, HDCHK) + 528-byte record (RECFLG, RECNUM, RECLEN x 2, RECNAM x 10, DESCHK, DATA x 512, DCHK)
- File reconstruction: Group sectors by RECNAM, sort by RECNUM, concatenate DATA, trim last to RECLEN
- Free sectors: HDFLAG=0 and RECFLG=0

**Microdrive class (`core/loaders.js`):**
- 8-drive support via COMMS shift register (bit 0=drive 1, bit 7=drive 8)
- Instant-completion model (same approach as BetaDisk/PlusDDisk)
- Port decode: bits 4:3 of low byte, bit 0 must be 1. $E7=data, $EF=status/control
- Status bits: WrProt(0), Sync(1), Gap(2), DTR(3), Busy(4)
- Head position cycles through 254 x 543 byte tape loop

**MDRLoader class (`core/loaders.js`):**
- `isMDR(data)` -- detect by size (137923/137922) and header validation
- `listFiles(data)` -- parse 254 sectors, group by filename
- `extractFile(data, fileInfo)` -- follow sector sequence, concat data, trim to RECLEN
- `getDiskInfo(data)` -- cartridge name, used/free sectors, file count
- `fileToTAP(fileData, fileInfo)` -- convert to TAP block
- `createBlankMDR(name)` -- create empty formatted cartridge image
- `buildMDR(files, cartridgeName)` -- serialize file list into MDR image
- `mdrChecksum(data, start, len)` -- Interface 1 sector checksum: sum of bytes **modulo 255** (per the IF1 ROM — never produces 255). Used for the header (bytes 0-13), record-descriptor (15-28), and data (30-541) checksums when writing/building MDR images so they're accepted by real hardware. Not validated on read.

**Memory paging (`core/memory.js`):**
- `if1Active` flag: when true, 0x0000-0x1FFF reads from IF1 ROM (8KB only, unlike +D which shadows 0x0000-0x3FFF)
- `loadIF1Rom(data)` / `hasIF1Rom()` -- 8KB ROM management

**Integration (`core/spectrum.js`):**
- `if1Enabled` flag + `_isIF1Active()` check (requires ROM + cartridge)
- ROM paging: page in at PC=$0008 (RST 8) or PC=$1708 (CLOSE#); page out after RET at PC=$0700
- Only pages in when BASIC ROM is selected (not +2A/+3 compatible)
- Port decode in `portRead()`/`portWrite()` -- checked BEFORE +D (port conflict on $E7/$EF)
- `loadMDRImage(data, fileName, driveIndex)` -- load MDR into Microdrive drive
- `loadedIF1Cartridges[0..7]` / `loadedIF1CartridgeFiles[0..7]` -- per-drive state
- IF1 and +D are mutually exclusive (conflicting ports); no conflict with Beta Disk

**Settings (`ui/input-settings.js`):**
- `chkIF1` checkbox: enable/disable Interface 1
- `if1.rom` file loading via ROM selector or Settings button
- Mutual exclusion: enabling IF1 disables +D (and vice versa)
- Persisted in localStorage key `zxm8_if1`

## Opus Discovery (OPD Disks)

External Opus Discovery disk interface with WD1770 FDC and MC6821 PIA. Supports .opd/.opu disk images.

**OPD Disk Format:**
- SS: 184,320 bytes (40 tracks x 18 sectors x 256 bytes), DS: 737,280 bytes (80 x 2 x 18 x 256 — the real Opus DS DD is 80-track, not 40). Track count is derived from the image size, not assumed.
- Sector IDs 0-17 (0-based, unlike MGT/TRD)
- Sector offset: `((track * sides + side) * 18 + sector) * 256`
- Raw sector dump, no container header or magic bytes
- Sector 0 = Opus **boot sector** (Z80 boot code / disk descriptor, geometry-specific). M8XXX's reader ignores it, but real Opus tools/hardware require it (HCDisk rejects a disk without it) — so the writer embeds a known-good boot sector per geometry (`OPD_BOOT_SECTORS`).
- Directory at sectors 1-7 (16-byte entries), data from sector 8+. Entry 0 = disk label (`bytesInLast=0xFF, first=0, last=6`), entries 1+ = files, then an end terminator (`bytesInLast=0xFF, first=totalSectors-1, lastBlock=0xFFFF`); unused entries are `0xE5`.
- Directory entry (16 bytes): `bytesInLast(2 LE) + firstBlock(2 LE) + lastBlock(2 LE) + name(10)`. `bytesInLast`: low 12 bits = bytes used in last sector **minus 1** (per Opus manual), top 4 bits = system flags. Block numbers are 0-based from sector 1 (image sector = block + 1). Raw file length = `(lastBlock - firstBlock) * 256 + (bytesInLast & 0x0FFF) + 1`.
- File data has a 7-byte header: `type(1) + datalen(2 LE) + param1(2 LE) + param2(2 LE)`. BASIC: param1=autostart, param2=progLength. CODE: param1=startAddr, param2=32768.

**OPDLoader class (`core/loaders.js`):**
- `isOPD(data)` -- detect by size (184320 SS or 737280 DS)
- `getDiskInfo(data)` -- geometry, sector usage (non-zero = used)
- `listFiles(data)` -- parse directory entries (name, type, length, startAddr, autostart)
- `extractFile(data, fileInfo)` -- extract file data (skips 7-byte header)
- `fileToTAP(fileData, fileInfo)` -- convert to TAP block
- `buildOPD(files, label, sides)` -- serialize file list into OPD image (writes the boot sector + directory skeleton; preserves an existing disk's sector 0 when given a `baseImage`)
- `createBlankOPD(sides)` -- create empty formatted disk image (boot sector + label entry + terminator)

**Status: emulated.** `core/loaders/disk-opus.js` holds both `OPDLoader` (the image format)
and `OpusDisk` (the controller). Disks boot: the Opus ROM catalogues a real image, and
`tests/opus-test.html` drives the whole path and then checks the ROM's own `CAT` output.

**OpusDisk class (`core/loaders/disk-opus.js`):**
- WD1770 FDC + MC6821 PIA. `OpusDisk extends PlusDDisk` — the +D's WD1772 is the same
  chip family, so the command engine is inherited and only the decode, the geometry and
  the PIA are Opus's own. Register behaviour follows FUSE's `peripherals/disk/opus.c`.
- **Registers are in the MEMORY map, not on I/O ports** — the one thing that makes this
  interface unlike every other one here. `readMemory`/`writeMemory` decode the window;
  the four WD177x registers are selected by `address & 3` and so repeat every 4 bytes
  across `$2800-$2FFF`.
- PIA port A: bit 1 = drive, bit 4 = side. Control register bit 2 gates data vs direction
  register. Two read side effects that are easy to miss: reading port A **clears its bit 6**,
  and reading the control register always returns **bit 6 set**. Port B is unconnected.
- 0-based sector numbering. `PlusDDisk` gained a `firstSector` field (1 for MGT, 0 for Opus)
  which `getSectorOffset` and the multi-sector wrap checks follow, so the shared FDC serves
  both without either format hard-coding the other's numbering.
- Geometry is taken from the image size on insert, not assumed: 184,320 = 40 tracks × 1 side,
  737,280 = 80 × 2.
- **`peekMemory`** is the same decode with no side effects. `Memory.peek` routes inspection
  reads (debugger panels, watches, search, exporters) through it, because reading the data
  register advances the sector buffer and raises a DRQ — a memory panel left showing `$2800`
  would otherwise drive the disk controller just by being on screen.

**Data transfer is by NMI, not polling.** The WD1770's DRQ is wired to the Z80's NMI line
(FUSE allocates the chip `WD_FLAG_DRQ` and its `set_datarq` raises an NMI), so every byte the
chip has ready interrupts the CPU and the handler in the Opus ROM moves it. Our FDC has no
timing of its own — a command completes instantly — so the delay is added in `spectrum.js`:
`OPUS_DRQ_BYTE_TSTATES` (112 T-states, one byte at 250 kbit/s MFM on a 3.5 MHz Z80) and
`OPUS_DRQ_FIRST_TSTATES` for the first byte, which also waits for the head to settle. Without
that delay the NMI lands on the instruction after the command write and preempts the ROM
before it has set up the transfer — which shows up as the ROM retrying and then reporting
`Disk I/O error`.

**Memory paging (`core/memory.js`):**
- `opusActive` flag: when true, $0000-$1FFF=ROM, $2000-$27FF=RAM, $2800-$2FFF=FDC, $3000-$37FF=PIA, $3800-$3FFF=unmapped ($FF)
- Priority in read(): IF1 -> Opus -> +D -> TR-DOS/ROM
- `loadOpusRom(data)` / `hasOpusRom()` -- 8KB ROM management

**Integration (`core/spectrum.js`):**
- `opusEnabled` flag; `_opusPagingEnabled` recalculated by `updateBetaDiskPagingFlag()`
  (which owns all the peripheral paging flags) — enabled + ROM loaded + `pagingModel !== '+2a'`
- `loadOPDImage(data, fileName, driveIndex)` -- load OPD into an Opus drive
- `loadedOpusDisks[0..1]` / `loadedOpusDiskFiles[0..1]` -- per-drive state
- Opus <-> +D mutually exclusive: both page themselves in at `$0008` over `$0000-$3FFF`.
  Compatible with IF1 and Beta Disk (IF1 takes priority in `Memory.read`, as in FUSE)
- Reset follows `opus_reset`: reset the WD1770 and the PIA and leave the interface paged
  **out**. The +D pages itself in at reset to run its boot code; the Opus does not — it waits
  to be entered through a hook, normally the `$0048` KEY-INT on the first maskable interrupt,
  which is where it initialises its 2K workspace.
- `this.memory.opusDisk = this.opus` — and re-linked on a machine switch, because the
  registers are read through the memory map and a fresh `Memory` without that reference
  returns `$FF` for every FDC and PIA access.

**ROM paging is checked AFTER the opcode fetch** (per FUSE `z80_ops.c`), unlike the +D and
IF1 which are checked before it. `updateOpusPaging(oldPC)` runs after `cpu.execute()` with the
PC the instruction started at: page IN at `$0008` (RST 8), `$0048` (KEY-INT) and `$1708`
(CLOSE#), page OUT at `$1748`.

FUSE can page mid-instruction — it fetches the opcode from the Spectrum ROM and then the
operands from the Opus ROM. `cpu.execute()` is atomic, so we page all-late instead, and the
ROMs show that is equivalent at all four addresses. Only `$0008` takes operands: the 48K ROM
has `LD HL,($5C5D)` there, so we load HL from `$5C5D` where FUSE loads it from `$0168` — and
the very next instruction is the Opus ROM's `POP HL` at `$000B`, which overwrites HL either
way. The other three are one-byte instructions (`PUSH BC`, `INC HL`, `RET`), so no operand is
fetched. (Opus `$1708` is `NOP / DEC HL` against the 48K's `INC HL`: the ROM is written to
tolerate both entry paths.)

**Settings (`ui/input-settings.js`):**
- `chkOpus` checkbox: enable/disable Opus Discovery; disabled with a reason on +2A/+3
- `opus.rom` auto-loaded from `roms/`, or via the Load Opus ROM button / ROM drag-drop
- Mutual exclusion: enabling Opus disables +D (and vice versa)
- Persisted in localStorage key `zxm8_opus`
- The Disk tab lists **Opus** as a system when `_opusPagingEnabled`, accepting `.opd`/`.opu`

**Using it.** Enable Opus Discovery in Settings → Machines on a 48K/128K/+2/Pentagon and load
an `.opd`. Disks appear in the Media catalogue under an `OPD:` drive tab and are saved into
and restored from a project like every other disk system.

**The command syntax is Interface 1's**, which is the point — the Discovery was built so IF1
software would work on it. The device is `"m"` and the drive number is 1 or 2:

```basic
LOAD *"m";1;"GAME"            REM BASIC — auto-runs if the file has an autostart line
LOAD *"m";1;"SCREEN"SCREEN$
LOAD *"m";1;"BLOB"CODE
SAVE *"m";1;"GAME"
CAT 1
```

`LOAD *"d"...` and `LOAD "GAME"` do **not** work — the first is `Invalid argument`, the second
falls through to the tape. A missing file gives `File not found`; a drive with no disk gives
`Insert disk N, then press a key`.

**Which ROM.** All six ROMs in `roms/` **load and run** programs — that part is the same
everywhere. They differ on `CAT`: only `Opus Discovery 1 v1.2` answers `CAT 1`, so that is the
ROM `tests/opus-test.html` drives. The v2.x ROMs, EXCOM and both QuickDOS versions (including
the one shipped as `roms/opus.rom`) boot and load fine but print nothing for `CAT 1` — they
take some other catalogue syntax, which has not been established here.

## Didaktik 40/80 (MDOS D40/D80 images)

**Status: emulated.** `core/loaders/disk-didaktik.js` holds both `DidaktikLoader` (the image
format) and `DidaktikDisk` (the controller). Disks boot: MDOS saves a program to a blank disk
and loads it back after a hard reset, checked by `tests/disk-boot-test.html`.

**DidaktikDisk (`core/loaders/disk-didaktik.js`)** — a WD2797 on I/O ports plus an aux
register, following FUSE's `peripherals/disk/didaktik.c`. `DidaktikDisk extends PlusDDisk`,
so the WD177x command engine is shared. Three things set it apart from the other interfaces:

- **The ROM is 14K, not 8K.** `$0000-$37FF` is ROM and `$3800-$3FFF` is 2K of RAM, so the
  overlay fills the whole bottom 16K. The dumps in circulation are 14336 or 16384 bytes;
  `loadDidaktikRom` takes the first 14336.
- **It pages in at `$0000`** (and `$0008`), paging out at `$1700`, checked *before* the opcode
  fetch like the +D and IF1. `$0000` means it takes the machine over from the moment of reset
  rather than waiting to be entered through a hook — its ROM, not the Spectrum's, is what boots.
  **That is why we offer this interface on the 48K only.** On a 128K-family machine it still
  seizes `$0000` at reset, and a ROM written for a 48K then runs off into RAM: red border,
  blank screen, no BASIC and no 128 menu. Reproduced on 128K and Pentagon.

  Two independent things point the same way, and it is worth being precise about which is
  which. FUSE declares the peripheral in `machines_periph_48()` only — `machines_periph_128()`
  and `machines_periph_plus3()` do not list it, and neither does the DISCiPLE. Note what is
  *not* restricted there: the +D sits in the shared `base_peripherals_48_128()`, which is
  exactly why the +D works on a 128K here too. That is emulator convention agreeing with our
  own reproduction — **not** a datasheet. No hardware source has been checked saying a real
  D40/D80 cannot drive a Sinclair 128K. The machines it shipped for (Didaktik Gama, Didaktik M)
  were 48K-class clones, and the Didaktik Kompakt 128K is a different machine with the drive
  built in rather than an external D80 on a 128K.

  So `_didaktikPagingEnabled` requires `pagingModel === 'none'` and the Settings checkbox is
  disabled elsewhere. If a source turns up showing real hardware managing it, this is a bug to
  chase rather than a restriction to keep. The other interfaces wait to be entered through a
  hook, which is how they can share a 128K at all.
- **The side is in the command byte.** There is no control register holding it: a WD2797 takes
  side select from bit 1 of a Type II/III command, which is where `executeCommand` reads it.

Ports (low byte): `$81` status/command, `$83` track, `$85` sector, `$87` data. The aux register
is decoded with mask `$F9`, so `$89/$8B/$8D/$8F` all reach it — bits 0/1 drive select, 2/3
motors, **bit 6 lets DRQ pull NMI and bit 7 lets INTRQ**. With neither bit set the interface is
in polled mode and must not interrupt at all. Anything with bit 7 of the port clear is the 8255
PPI, which is not wired to anything and reads `$FF`.

Geometry is MDOS: 9 sectors of 512 bytes, two sides, 40 tracks (368,640 bytes) or 80
(737,280), taken from the image size on insert.

**Using it:** enable Didaktik 80 in Settings → Machines **on a 48K**, load a `.d40`/`.d80`,
and use the **star form**:

```basic
SAVE *"NAME"      LOAD *"NAME"      CAT
```

A bare `SAVE "NAME"` goes to the tape. It is mutually exclusive with the +D and the Opus —
all three own `$0000-$3FFF`.

`DidaktikLoader` (`core/loaders.js`) reads and writes Didaktik 40/80 MDOS disk images — raw, header-less sector dumps (sector N at offset N×512). It lists/extracts catalog files, creates blank disks (`createBlankD40`/`createBlankD80` — byte-reproduce real 360K/720K MDOS formats), and supports in-place editing (add/delete/rename) for the Explorer/file-analysis tool; the controller is `DidaktikDisk`, above. Read algorithms ported from the zxspectrumutils tools (`d802tap.cpp`, `dird80.c`); the write path follows `tap2d80.cpp` from the same source.

Format:
- **Detection**: `"SDOS"` identifier at boot-sector offset 204, or a known D40/D80 size with a valid-looking catalog.
- **Directory**: physical sectors 6,8,10,12,7,9,11,13 (that interleave is the catalog order), 128 × 32-byte entries — byte 0 type char (`P` BASIC, `B` Code, `N`/`C` arrays, `S` snapshot, `Q` sequence; `0xE5`=deleted), 10-char name, 24-bit length (`len[0..1]` + `len2` at byte 21), start address, FAT first-sector index.
- **FAT** at sector 1, MDOS's own 12-bit packing (`getFATnum`): even entry `B0|((B1>>4)<<8)`, odd `B1|((B0&0x0F)<<8)`, 341 entries/sector. A file's sectors are chained until a value ≥0xC00; the final sector's low 9 bits give its used byte count (0xE00 special; 0xDxx = bad).
- **Geometry** (`getDiskInfo`) from boot sector: byte 177 flags (bit 4 double-sided), 178 tracks/side, 179 sectors/track; disk name at 192–201.
- **Write** (`addFile`/`deleteFile`/`renameFile`/`setStartAddr`, helper `setFATnum`): all edits mutate a copy of the image **in place** (boot sector and other files preserved) — there is no full rebuild, and free space is FAT-derived (no counter to maintain). `addFile` finds free sectors (FAT `0x000`, data area starts at sector 14) and a free directory slot, writes the payload, links the FAT chain, and sets the terminator `0xE00 | (length % 512)` (full last sector → `0xE00`). Directory fields match real disks: byte 20 attributes `0x0F`, B files store `0x8000` in the basicLength field, P files store program length there and the autostart LINE in the start-address field. `deleteFile` frees the chain (→ `0x000`) and clears the slot; reserved system sectors 0–13 stay `0xDDD`.

Explorer integration (`ui/explorer.js`): `.d40`/`.d80` open as `type: 'didaktik'` — directly, or drilled from a `.zip` (single-file ZIPs auto-open; multi-file ZIPs list for selection). The info panel shows geometry/label/catalog, files are clickable (P→BASIC view, B→disasm, others→hex), the BASIC/disasm/hex source selectors extract via `DidaktikLoader.extractFile`, and the Disk Map sub-tab renders sector allocation by walking each file's FAT chain (`buildDidaktikSectorMap`).

The Edit sub-tab is a full read-write editor for Didaktik (`didaktikEditorRenderFileList` + `didaktikEditorAddFile`/`didaktikEditorDeleteSelection`/`didaktikEditorApplyInlineEdit`/`didaktikEditorMoveSelection`/`didaktikEditorSave`): Add File (the shared disk-add dialog; dialog `B`=BASIC→MDOS `P`, `C`/other=Code→MDOS `B`), Delete (multi-select), inline Rename + start-address/LINE edit (double-click a row → Apply), reorder (Move Up/Down — `DidaktikLoader.swapDirEntries` swaps directory entries in place, data/FAT untouched), and Save (downloads the edited `.d40`/`.d80`). Extract (selected files out as Hobeta `.$X` via `buildHobeta`, or raw binary; multi-select → zip) and Copy also work. Copy is bidirectional: Didaktik files copy *out* to the other pane via `extractFilesFromPanel`, and files from any other format (TAP/TZX/TRD/SCL/MGT/MDR/OPD/DSK/snapshots) copy *into* a Didaktik disk via `addConvertedFile` (BASIC→MDOS `P` with autostart/vars metadata, Code→`B` with load address; a per-file "Disk full" / "Directory full" error is reported if it doesn't fit). Each edit mutates `panel.rawData` in place and re-derives the view via `didaktikEditorRefresh`. P files map to TAP BASIC (header type 0, autostart from the catalog LINE), B files to TAP Code (type 3, load address from `startAddr`).

## ZX Spectrum +3 / uPD765 FDC

The +3 uses the same memory banking as +2A (`pagingModel: '+2a'`) plus a built-in uPD765 floppy disk controller.

**FDC Implementation (`fdc.js`):**
- `UPD765` class: State machine with 4 phases (idle -> command -> execution -> result)
- Instant-completion model (no timing simulation), same approach as BetaDisk
- Ports: `0x2FFD` (MSR read), `0x3FFD` (data read/write)
- Motor control: via port `0x1FFD` bit 3 (shared with +2A paging port)
- Commands: Read Track, Specify, Sense Drive Status, Read/Write Data, Recalibrate, Sense Interrupt, Read/Write Deleted Data, Read ID, Format Track, Seek, Scan Equal/Low/High (stub)
- Drive select: only bit 0 decoded (2 physical drives max). Drives 0/2 and 1/3 map to the same physical drive.
- Physical track: Read/Write Data uses the drive head position (set by Seek/Recalibrate), not the C parameter from the command. Copy-protected disks have mismatched logical/physical track numbers.

**DSK Format (`fdc.js`):**
- `DSKImage` class: In-memory representation of parsed DSK disk
- `DSKLoader` class: Parses standard ("MV - CPC") and extended ("EXTENDED CPC DSK") formats
- `DSKLoader.getDiskSpec(dskImage)`: Reads +3DOS 16-byte boot spec (checksum=3) for disk parameters. When no valid boot spec exists, detects format from sector IDs and geometry: +3/PCW (sectors 1–9, 1 reserved track), CPC System (sectors 0x41–0x49, 2 reserved tracks), CPC Data (sectors 0xC1–0xC9, 0 reserved tracks), Timex FDD3000 (16×256-byte sectors, `isTOS: true`, sector skew table). Three FDD3000 variants are auto-detected by probing for valid CP/M directory entries (user 0-15, 0xE5, or 0xFF) at tracks 0, 2, and 4: TOS variant (`fdd3000` diskdef: 4 reserved tracks, skew 7), CP/M variant (`fdd3000_2` diskdef: 2 reserved tracks, skew 5), and disk label variant (0 reserved tracks, no skew — directory at track 0 with disk label entries user=0xFF, sectors in sequential order). Block size scales with capacity (1024/2048/4096 for 40T-SS/80T-SS/80T-DS). Unknown formats fall back to +3-style 1 reserved track.
- `DSKLoader._logicalToSectorId(spec, logicalSector)`: Maps a logical sector index (0-based within track) to a physical sector ID. Applies `spec.skewTable` if present (Timex FDD3000 DSK images store sectors in physical/interleaved order), otherwise adds `spec.firstSectorId` directly. Used by `_readDirectory`, `listFiles`, `readFileData`, and `writeDirectory`.
- `DSKLoader.listFiles(dskImage)`: CP/M directory parser. Detects file headers and sets `headerSize` and type fields. For TOS disks (`spec.isTOS`), directory entry bytes 12-15 are interpreted differently: byte 12 = part (extent), byte 13 = tail (bytes in last sector), byte 14 = sizeHi, byte 15 = sizeLo — giving exact file sizes via `(sizeHi*256+sizeLo)/2` sectors (per [Tomato FDD3000 tool](https://sourceforge.net/projects/fdd3000e/) `tos_image.hpp`). Supports two header formats:
  - **+3DOS**: 128-byte header with "PLUS3DOS" signature, file length, type, load address/autostart
  - **TOS (Timex FDD3000)**: Variable-size header at start of file data (per [Tomato FDD3000 tool](https://sourceforge.net/projects/fdd3000e/) source). Type 0 (BASIC): 7 bytes — `type(1) + autostart(2LE) + dataLen(2LE) + basLen(2LE)` where `dataLen` = total data (program + variables), `basLen` = program body length. Types 1-3 (Code, arrays): 5 bytes — `type(1) + dataLen(2LE) + address(2LE)`. Validated by exact match `dataLen + hdrSize == file.size` for TOS (exact sizes), or within 127 bytes for CP/M. Detected when first byte is 0-3 and no +3DOS signature is present.
- `DSKLoader.readFileData(dskImage, name, ext, user, size)`: Reads file data from allocation blocks across extents. For TOS disks, uses `part` (byte 12) as extent number instead of the CP/M `extentLo + extentHi*32` formula.
- `DSKLoader._readDirectory(dskImage, spec)`: Reads directory data from correct track (after reserved tracks), using `_logicalToSectorId()` for sector ordering.
- `DSKLoader.writeDirectory(dskImage, spec, dirData)`: Writes directory data back to disk using `_logicalToSectorId()` for sector ordering.
- Standard +3 geometry: 40 tracks, 1 side, 9 sectors/track, 512 bytes/sector, sector IDs **1–9** (the +3 uses the Amstrad PCW format; 0xC1–0xC9 is the CPC *data* format, a different system)
- Non-standard disks: Some games use custom formats (e.g. 1 x 4096-byte sector per track, no CP/M directory). These have a boot loader in sector 1 of track 0 that the +3 ROM executes directly.

**Copy Protection / Weak Sectors (`fdc.js`):**
- **EDSK weak sectors**: When a sector's stored data length > nominal size (128 << N) and is an exact multiple, the sector contains multiple copies. At parse time, copies are compared byte-by-byte to build a `weakMap`. On each FDC read, weak byte positions are randomized (FUSE approach).
- **CRC error noise**: Only applied when `sec.data.length >= sectorDataSize` (stored data fully covers the declared sector size -- genuine CRC corruption for copy protection). Skipped when `sec.data.length < sectorDataSize` (oversized sector technique, e.g. N=6/8192 declared with 6144 actual -- data is valid game content, CRC error is due to size mismatch).
- **SK flag**: Read Data/Read Deleted Data honor SK (Skip Deleted) bit. SK=1 skips mark-mismatched sectors; SK=0 reads them but sets CM flag and terminates.
- **Status register passthrough**: DSK per-sector ST1/ST2 error flags (DE, DD, MA, MD) are merged with computed flags (EN, CM). EN only set when all R->EOT sectors completed without early termination.
- These features support Speedlock +3 protection (used by Target Renegade, After Burner, Robocop, etc.).

**Integration (`spectrum.js`):**
- `this.fdc`: Created when `profile.hasFDC` is true, null otherwise
- `loadDSKImage(data, fileName, driveIndex = 0)`: Parse DSK, insert into specified FDC drive, return result
- `bootPlus3Disk()`: Reset machine, preserve disk (legacy -- main auto-load now uses Enter key injection via `startAutoLoadPlus3Disk()`)

**ROM:** `plus3.rom` (65536 bytes, 4 banks) -- same structure as plus2a.rom but with +3DOS
