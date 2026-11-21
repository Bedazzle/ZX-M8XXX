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
- SS: 184,320 bytes (40 tracks x 18 sectors x 256 bytes), DS: 737,280 bytes (80 x 2 x 18 x 256 — the real Opus DS DD is 80-track, not 40). **Double density is 80 x 2 x 10 x 512 = 819,200**, and the sector SIZE is as much a per-disk property as the track count: everything in the catalogue counts in sectors, so 512 moves the directory, the blocks and every file offset.
- Sector IDs 0-based (unlike MGT/TRD), 0-17 at 256 bytes and 0-9 at 512
- Sector offset: `((track * sides + side) * sectorsPerTrack + sector) * bytesPerSector`
- Raw sector dump, no container header or magic bytes
- Sector 0 = Opus **boot sector** (Z80 boot code / disk descriptor, geometry-specific). M8XXX's reader ignores it, but real Opus tools/hardware require it (HCDisk rejects a disk without it) — so the writer embeds a known-good boot sector per geometry (`OPD_BOOT_SECTORS`).
- Directory at sectors 1-7 (16-byte entries), data from sector 8+. Entry 0 = disk label (`bytesInLast=0xFF, first=0, last=6`), entries 1+ = files, then an end terminator (`bytesInLast=0xFF, first=totalSectors-1, lastBlock=0xFFFF`); unused entries are `0xE5`.
- Directory entry (16 bytes): `bytesInLast(2 LE) + firstBlock(2 LE) + lastBlock(2 LE) + name(10)`. `bytesInLast`: low 12 bits = bytes used in last sector **minus 1** (per Opus manual), top 4 bits = system flags. Block numbers are 0-based from sector 1 (image sector = block + 1). Raw file length = `(lastBlock - firstBlock) * 256 + (bytesInLast & 0x0FFF) + 1`.
- File data has a 7-byte header: `type(1) + datalen(2 LE) + param1(2 LE) + param2(2 LE)`. BASIC: param1=autostart, param2=progLength. CODE: param1=startAddr, param2=32768.

**OPDLoader class (`core/loaders.js`):**
- `isOPD(data)` -- detect by size (184320 SS or 737280 DS), or by an anchor sector that accounts for the image in the Opus's own 18 x 256. It stays deliberately narrow: an 819,200-byte flat image is the same size as an MGT one, so size-sniffing a double-density disk would be a coin toss. A `.dsk` and an `.opd` name decide by extension before any of this runs.
- `layoutOf(data)` -- the disk's geometry: its anchor sector when that accounts for the image, else derived from the size. Every reader here counts in what this returns
- `fromDSK(data)` -- the flat Opus image inside a CPC container, or null
- `getDiskInfo(data)` -- geometry, sector usage (non-zero = used)
- `listFiles(data)` -- parse directory entries (name, type, length, startAddr, autostart)
- `extractFile(data, fileInfo)` -- extract file data (skips 7-byte header)
- `fileToTAP(fileData, fileInfo)` -- convert to TAP block
- `buildOPD(files, label, sides)` -- serialize file list into OPD image (writes the boot sector + directory skeleton; preserves an existing disk's sector 0 when given a `baseImage`)
- `createBlankOPD(sides)` -- create empty formatted disk image (boot sector + label entry + terminator)

**Status: emulated.** `core/loaders/disk-opus.js` holds both `OPDLoader` (the image format)
and `OpusDisk` (the controller). Disks boot: the Opus ROM catalogues a real image, and
`tests/opus-test.html` drives the whole path and then checks the ROM's own `CAT` output.

**A double-density Opus disk arrives inside a `.dsk`.** There are no `.opd` files of the DD
format: 512-byte sectors are what a PC floppy controller can image, so those disks were put
into CPC-style containers, and `SeaDragon_opus_dd.dsk` and `T2_opus_dd.dsk` are what
circulates. Every `.dsk` went to the +3 FDC and came back "DSK files require ZX Spectrum +3",
which is wrong about the **disk** and not merely unhelpful about the machine — a container
says nothing about the filesystem inside it. So a `.dsk` on a machine with no FDC is now
offered to the Opus first: `DSKLoader.flatten` turns the container into the linear sector
dump the Opus addresses (undoing the rotational skew a track's ids are written in, and
refusing anything that is not a uniform grid), and `OPDLoader.fromDSK` accepts it only when
the flattened image's own anchor sector accounts for every byte with that exact geometry.
A +3 disk fails that test and still says it wants a +3; a machine that **has** an FDC keeps
every `.dsk`, since the Opus cannot page its ROM on a +2A/+3 anyway. What is mounted — and
what Save → Media… writes back — is the flat image, under an `.opd` name. Both real disks
catalogue on all six Opus ROMs and boot into their title screens.

**`CAT 1` and bare `RUN` on ROM v2.2 and later — it was the tape trap.** For a while
`CAT 1` worked only on **v1.2**; on v2.2, v2.22, EXCOM 2.28 and QuickDOS 2.31 (which is what
`roms/opus.rom` is) it answered `C Nonsense in BASIC`, and so did a bare `RUN` — the autoload
of a file called `run`, which is how every disk game on an Opus is started. Nothing was
wrong in `disk-opus.js`: **`$0556` is only LD-BYTES while the Spectrum's own ROM is at the
bottom of the map**, and in these Opus ROMs it is the middle of the statement parser. The
flash-load trap fired there, found no tape, cleared carry and returned — so the Opus's
parser skipped the filename, `CH_ADD` was left on the `;` of the `LOAD *1;"run"` it had just
built in the edit line, and its own end-of-statement check reported `Nonsense`. The guard
now covers the Opus, the Interface 1 and the Didaktik as well as the +D, on both `$0556`
and `$04C2`; `tests/disk-boot-test.html` saves a program as `run` through ROM v2.2 and then
presses R + ENTER on a cold machine. How the ROM gets there is worth knowing, because it
looks like a bug and is not: the Opus spots a bare `RUN` from `PROG+25 == WORKSP` with the
`RUN` token at `WORKSP-3`, writes `LOAD *SGN PI;"run"` over the edit line (`SGN PI` is how
QuickDOS says 1 without a numeric literal), and then **deliberately calls the Spectrum ROM's
`REPORT-C` at `$1C8A`** so that its own `RST 8` hook is handed the line to re-parse. An
`ERR_NR` of 11 on that path is normal, in every ROM version.

**The head is not the track register.** A WD1770's track register is a register; where the
head is sitting is the drive's business, and the two are deliberately held apart by any DOS
that double-steps. So each drive carries its own `headTrack`, and:

- **Seek** moves the head by `data − track register` **steps** and then loads the register
  with the data. It does not place the head *at* the data — a ROM that has told the chip it
  is somewhere it is not keeps the offset it chose.
- **Step / Step In / Step Out** move the head and leave the track register alone unless the
  **U bit** (bit 4) is set. This is how a DOS double-steps: two steps per track, the register
  counting tracks and the head counting cylinders.
- **Read/Write Sector** find a sector by comparing ID fields, not by indexing with the track
  register: the ID under the head must say the register's track or the command fails with
  **Record Not Found**, exactly as FUSE's `wd_fdc.c` does it.
- The **V bit** (bit 2) on a Type I command verifies the same way and reports **Seek Error**.
  EXCOM 2.28 steps in once more with V set and reads that error as "this is not the 80-track
  drive I assume".
- **`TRACK0`** is a line from the drive, so it reports the head, not the register.

Only `stepFactor` is Opus-specific (`PlusDDisk` returns 1, so the +D and Didaktik keep the
straight mapping they always had): a **40-track disk in an 80-track drive** is written on
every other cylinder, so image track *t* lives at physical cylinder *2t*, and a head parked
on an odd cylinder is over no ID field at all. Which drive you have is **configuration** —
nothing in a raw `.opd` records it — so it is a per-drive **40/80** selector in
Settings → Machines beside the Opus tick, defaulting to **40**, the mechanism the Discovery
shipped with. The stock ROMs (v1.2, v2.2, v2.22, QuickDOS) assume 40 and load disks with it;
at 80 they read every other track and fail.

**Geometry belongs to the disk, not the controller.** Each drive record keeps its own
`{tracks, sides, sectorsPerTrack, bytesPerSector}`, read from the disk's **anchor sector**
(track 0, sector 0: byte 2 tracks, byte 3 sectors per track, byte 4 flags, bits 7-6 the
sector-size code and bit 4 two sides) and trusted only when it accounts for every byte of the
image — otherwise the size-derived rule stands. All five sample disks validate byte for byte.
It used to be one set of numbers per controller taken from whichever image was loaded last,
so an SS disk in drive 1 beside a DS one in drive 2 read through the wrong layout.

**Known divergence — EXCOM 2.28 and a bare `RUN`.** The other four ROMs load and run the
file. EXCOM asks for logical track 1 by seeking to 1 and then stepping in once more with the
U bit clear — a double-step — so on a 40-track drive the head is on cylinder 2 while the
register says 1, and the read is Record Not Found: `Disc I/O error`. **FUSE fails the same
way** (it has no double-stepping at all: physical cylinder *is* the image track), which is
what his report says too. Set drive 1 to **80** and EXCOM reads track 1 correctly — further
than FUSE gets — and then fails on its way back, because it seeks to 0 without the matching
second step. What EXCOM actually wants is an 80-track disk, and with one (80 × 2 × 18 × 256)
all five ROMs catalogue it at either drive setting.

**OpusDisk class (`core/loaders/disk-opus.js`):**
- WD1770 FDC + MC6821 PIA. `OpusDisk extends PlusDDisk` — the +D's WD1772 is the same
  chip family, so the command engine is inherited and only the decode, the geometry and
  the PIA are Opus's own. Register behaviour follows FUSE's `peripherals/disk/opus.c`.
- **Registers are in the MEMORY map, not on I/O ports** — the one thing that makes this
  interface unlike every other one here. `readMemory`/`writeMemory` decode the window;
  the four WD177x registers are selected by `address & 3` and so repeat every 4 bytes
  across `$2800-$2FFF`.
- PIA port A: bit 1 = drive, bit 4 = side. Control register bit 2 gates data vs direction
  register. Three read behaviours that are easy to miss: port A **bit 6 is the parallel
  printer's BUSY line and reads HIGH when the printer is busy *or absent***, so with no
  printer emulated it reads set (`printerConnected` picks which, as FUSE's
  `settings_current.printer` does — reading it as clear told every ROM a printer was there
  and waiting); the port A **control** register always returns bit 6 set, to acknowledge
  parallel-port actions; and port B is the printer's **data** port, whose control register —
  unlike control A — reads back exactly as written. A byte written to port B is handed to
  `onPrinterByte`.
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
`Disk I/O error`. DRQ is a **level** on the real wire, not a pulse, so the queued NMI is
only delivered if the chip still wants a byte when the countdown expires
(`OpusDisk.hasDataRequest()`): a transfer that finished in the gap — the last byte of the
sector taken, or a Force Interrupt — leaves no edge to deliver.

**Read Address** (`PlusDDisk`, so the +D and the Didaktik too) answers from the GEOMETRY,
one sector further on each command: `[medium track, side, first sector + n, size code, 0, 0]`,
with the size code taken from `bytesPerSector` (1 for the Opus's 256-byte sectors, 2 for
MGT's 512) and the ID's track address also loaded into the **sector register**, as the
datasheet requires. These images are raw sector dumps with no ID fields, so there is nothing
else to report — but synthesizing per sector is what lets a program walk a track and see its
numbering and sector size, where handing back the sector register only told it what it had
just written there. (A `.udi` on the Beta Disk has real ID fields; `disk-beta.js` serves
those instead.)

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

**On a 128K the hook fires inside the editor ROM too**, and nothing can be done about that:
the decode sees an address and never which bank is paged, and bank 0's interrupt path goes
through `$0048` on its way back from bank 1. Bank 0 holds `POP HL / RET` there, where the 48K
ROM holds `PUSH BC`. The v2.2-class ROMs (v2.2, v2.22, EXCOM, QuickDOS — and the default
`opus.rom`, which is QuickDOS) re-enter the Spectrum ROM at `$0049`, which is that `RET`, and
the stack balances: the 128 menu and 128 BASIC are unaffected, disk in or not, at either
drive size (`tests/opus-test.html` pins it). **v1.2 re-enters at `$004A`**, which in bank 0 is
`LD BC,$7FFD / XOR A / DI / OUT (C),A … JP $0321` — the editor's own paging re-init — so a
128K with v1.2 never reaches its menu at all. That is what the hardware does; do not gate the
paging on the ROM bank to "fix" it.

**Settings (`ui/input-settings.js`):**
- `chkOpus` checkbox: enable/disable Opus Discovery; disabled with a reason on +2A/+3
- `opus.rom` auto-loaded from `roms/`, or via the Load Opus ROM button / ROM drag-drop
- Mutual exclusion: enabling Opus disables +D (and vice versa)
- `selOpusTracks0` / `selOpusTracks1`: how many tracks each drive's **mechanism** has, 40 or
  80, which is what decides double-stepping (see above). The row hides itself when the
  interface is off; persisted as `zxm8_opusTracks0` / `zxm8_opusTracks1`
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

## Beta 48 (TR-DOS 4.x, Vision, CBI-95 / IDS / AR-20)

`core/beta48.js`, wired in `core/spectrum.js` / `core/memory.js`. The 48K-era Beta Disk ("Beta Disk plus") and its clones, modelled on MAME's `bus/spectrum/beta.cpp`. Selected by **Settings → Disk interfaces → Beta Disk → Type** (`zxm8_betaVariant`: `128` default, `auto`, `plus`, `cbi`) on a machine without a built-in Beta 128; its ROM is `roms/beta48.rom` (or Load ROM).

- **ROM paging.** The DOS ROM answers any access to `$3C00-$3CFF` (for that access only), and all of `$0000-$3FFF` while the latch is set: system port `1xxxx111` (`$FF`) written with bit 7 = 0. Reset sets the latch, so the DOS boots first (`memory.beta48Latch`).
- **Master register.** Any write to a port `xxxxxx00` (`$FC` is the border too): bit 7 = 1 turns the interface's I/O off; on `cbi`, bit 6 = 1 turns the `$3Cxx` window off (`memory.beta48WindowOff`).
- **I/O.** FDC at `0YYxx111` (`$1F/$3F/$5F/$7F`), system port at `1xxxx111`. A read of the system port gives INTRQ (bit 7) and DRQ (bit 6); the rest reads 1 (`cbi`: bit 5 = printer BUSY = 0). The Beta 128 port handlers stay out while `memory.beta48On`.
- **ROM images.** `prepareBeta48Rom()` knows MAME's CRCs and a few Brazilian dumps; otherwise it decides by which way round the DOS text reads. Original boards cross D0 and D7, so such dumps are straightened; 8KB ROMs are mirrored to 16KB. `auto` takes `cbi` only from a known CBI-95/IDS91/AR-20 ROM.
- **Magic button** (Beta 48 and Beta 128): `triggerBetaMagic()` pages the DOS ROM and raises NMI.
- Tape traps run only with the Sinclair ROM in; the Beta 128 TR-DOS traps are off for Beta 48 (the real DOS does the FDC work).
- Checked by hand with TR-DOS 4.09/4.11/4.12, CAS DOS 1986/1987, IC-DOS, Vision 1.0-1.9e, CBI-95 2.3/2.4, IDS91, IDS2001ne, AR-20. `tests/beta48-test.html` covers ROM identification, the window/latch logic and (with `roms/beta48.rom` present) a real boot and the magic button.

## TKMEM-128 II (128K/512K RAM for a 48K)

`Memory.setTkmem()` / `Memory.writeTkmem()`, port decode in `Spectrum.portWrite`. A model of [TKMEM-128 II](https://github.com/lrrosa/tkmem128-ii), the Brazilian external RAM board for the TK90X/TK95 and 48K Spectrum. **Settings → Machines → Memory expansion** (`zxm8_tkmem`: 0 / 128 / 512; `zxm8_tkmemDecode`); 48K machine only.

- `$8000-$BFFF` = external bank 2, `$C000-$FFFF` = the latched bank; the 48K's own `$8000-$FFFF` is switched off. `$4000-$7FFF` stays the 48K's RAM: no shadow screen (bit 3 is latched and ignored), and the 48K ROM stays (bit 4 only matters with the board's optional EPROM, not modelled). External RAM is uncontended.
- Latch: bits 0-2 bank, bit 5 lock until reset, bits 6-7 bank bits 3-4 in 512K mode (JP3). Write-only.
- **Port decode.** The board's GAL decodes A15=0, A5=1, A1=0 (`gal`). Every Beta 48 DOS (TR-DOS 4.x, CAS, Vision, CBI-95/IDS/AR-20) writes `OUT ($FC),A` with A = 0 / 7 on each call — ports `$00FC` / `$07FC` — which that decode takes as 7FFD: bank 0/7 is paged in under the DOS's stack and it hangs (TR-DOS 4.11) or crashes the program (CBI-95). The default `a14` adds A14=1, which 7FFD has and those ports have not. Checked with Saboteur II 128, Pac-Mania 128 and T2 (loads all of its data into the banks in one go) on Beta 48.
- Save states/rewind carry its RAM and latch (`_snapshotMedia().tkmem`); `.sna`/`.z80`/`.szx` of a 48K do not.
- `tests/tkmem-test.html`.

## Timex FDD 3000 (TOS / CP/M DSK)

`core/fdd3000.js`, port of the FUSE patch fdd3000e 0.2.1.1 (Sławomir Szczyrba). **Settings → Machines → Disk interfaces → Timex FDD 3000**; 48K / 128K / +2 (not HC-2000, not +2A/+3); the +D is off while it is on (both use port `$EF`).

- **Two computers.** The station is its own Z80 (64KB RAM, 2KB boot ROM `roms/fdd3000-boot.rom`, WD1770) — a second `Z80` instance stepped once per Spectrum instruction and twice every fifth (as FUSE), HALT included. A Spectrum reset leaves it running; **Reset FDD** restarts it (FUSE's "FDD3000 reset"), and it loads TOS from drive A.
- **Spectrum side (TI-397).** 4KB ROM (`fdd3stavi.rom` for the Spectrum — FUSE's default — or `fdd3timex.rom`), mirrored over `$0000-$1FFF`, 8KB RAM at `$2000-$3FFF`; paged in at the `$0000`/`$0008` fetch, out after the instruction at `$0604`. Port `$xxEF`: write = Spectrum → station latch, read = station → Spectrum.
- **Station I/O** (A7-A5): `$20` latches (read: Spectrum byte | DRQ in bit 7), `$C0` WD registers, `$E0` config (active-low drive select, side, density, head; bit 6 = boot ROM out); serial ports not emulated. INTRQ → station INT.
- **Controller.** `Fdd3000Fdc` = the +D's instant-completion WD177x reading sectors by C/H/R from DSK images (4 drives). INTRQ rises a few station instructions after a command ends (`FDD3000_INTRQ_DELAY`): TOS reads the status (which clears INTRQ), does EI and waits for the interrupt, so an instant INTRQ would be lost and every Seek would time out.
- **Use.** Insert a DSK (Disk tab, system "FDD 3000"), Reset FDD, reset the Spectrum: with a system disk the second copyright line (`© 91 STAVI 128K TOS A.2`) appears, a disk with autostart starts; `CAT *` lists a disk. On a 128K the 48K ROM is selected, as in FUSE.
- **Boot / auto load** (`Spectrum.fdd3000AutoBoot`). Reset FDD runs the station's boot at once (`Fdd3000.boot`: alone, until it polls port `$20` with no other I/O — the boot ROM's delay loops are ~3M instructions). Boot (and Auto load, for a disk put into A) = Reset FDD + Spectrum reset. A CP/M disk in A (boot sector `ED 56`; TOS is `01 C3`) is started the way it is by hand: the Monitor Emulator disk (TOS, `MONITOR` in its directory) must be in B-D; it is swapped into A and booted, and once Monitor runs (Spectrum PC ≥ `$8040` for 10 frames, station idle) CP/M goes back into A and only the station is reset. ~2.7 s of emulated time to `A>`.
- `tests/fdd3000-test.html` (with the ROMs and `headless/fdd3000/tos.dsk`: the real boot and `CAT *`). Checked: TOS A.2 (CAT *), Battle Command (autostart, 80-track DS disk).
- **Monitor Emulator (CP/M terminal) on a 128K: open question.** Its loader tells a Timex from a Spectrum by `OUT 255,0: LET a=IN 255: IF a=0 THEN` (Timex path, 64-column hi-res with odd columns in the second screen at `$6000`). On a Spectrum port `$FF` is the floating bus, so the answer depends on which T-state the `IN` lands on. Here the 48K reads 255 (Spectrum path, CP/M works) and the 128K reads a screen byte of 0 (Timex path, half the text missing); FUSE reads 255 on its 128K. Which one real hardware does is not known: FUSE may be the one that is off, and Monitor may have needed a patch for the 128K. Left as it is.
- Not done: Timex TC2048/TC2068 machines; save states do not carry the station.

## Timex TC2048 / TC2068 (SCLD)

Machine `tc2048` (`core/machines.js`, group Timex; ROM `roms/tc2048.rom`), SCLD in `core/timex.js` + `ULA._renderTimexPaper`, after FUSE's `machines/tc2048.c`, `peripherals/scld.c` and `display.c`.

- A 48K (`ramPages: 1`, 48K contention and timing); **no floating bus** (unused ports read `$FF`); the SCLD answers `$F4`, `$FE`, `$FF` only (full decoding, so `OUT ($F4)` is not a border write).
- **DEC (`$FF`)**, read back: bits 0-2 screen mode (1 second file at `$6000`; 2/3 hi-colour, attribute per 8x1 from `$6000`+offset; 4-7 hi-res 512x192: 4 file byte + its attribute byte, 5 the same on the second file, 6 first file byte + second file byte, 7 second file byte twice), bits 3-5 hi-res ink/paper (FUSE `hires_convert_dec`), bit 6 masks the frame interrupt, bit 7 DOCK/EXROM select.
- **HSR (`$F4`)**, read back: a set bit maps that 8KB chunk to DOCK/EXROM, empty on a TC2048 (reads `$FF`, writes ignored).
- **Display.** Low-res modes go through the normal frame buffer. Hi-res rows are drawn at 512 into `ula.hiresBuf` (and a 256-pixel reduction into the frame buffer for everything else); `Spectrum.blitFrame` puts the frame on a canvas twice as wide (`canvasScaleX = 2`, CSS keeps the aspect) and the hi-res rows over it. In hi-res the border is the hi-res paper colour (recorded through `setBorderAt`, so beam rendering follows; port `$FE` is remembered for when hi-res ends).
- With the FDD 3000 (`fdd3stavi.rom`): Monitor Emulator detects the Timex (`IN 255` = 0) and runs CP/M in 64 columns, hi-res mode 6. `fdd3timex.rom` does not start on the TC2048 (likely the TC2068 build).
- **TC2068** (machine `tc2068`, PAL, FUSE `machines/tc2068.c`): ROM `tc2068.rom` (24KB) or FUSE's `tc2068-0.rom` + `tc2068-1.rom`: 16KB HOME + 8KB EXROM. With DEC bit 7 set, an HSR bit maps the EXROM into that 8KB chunk (every chunk sees the same 8KB); clear, the DOCK (empty, or a cartridge). AY on `$F5` (select) / `$F6` (data), register 14 the joystick port: read through `$F6`, address bit 8 puts joystick 1 and bit 9 joystick 2 on it (a pressed direction pulls its bit low: up $01, down $02, left $04, right $08, fire $80). The numpad/gamepad drives them with the joystick type *Timex 1* / *Timex 2* (which leaves the Kempston port alone). Its ROM is not the 48K's, so the tape/TR-DOS traps are off (`noRomTraps`): tapes load in real time, and Auto load types `LOAD ""` and starts the tape.
- **DCK cartridges** (`parseDck`, `Spectrum.loadDCK` / `ejectDCK`; open a `.dck` on a TC2068): DOCK and EXROM blocks (HOME blocks ignored), ROM and RAM chunks; the machine resets and the ROM starts the cartridge. Checked: Donkey Kong (`dk-spectrum.dck`), Timmy for the 2068 (tape).
- Not done: TS2068 (NTSC), HOME blocks in DCK, snapshots of the SCLD/DOCK state, flash in hi-res. `tests/timex-test.html`.

## TurboSound and DACs (Covox / Specdrum / Soundrive)

`Spectrum.setTurboSound`, `Spectrum.setDac`, mixed in `AudioManager.processFrame`. **Settings → Audio**.

- **TurboSound** (NedoPC): a second AY (`spectrum.ay2`) on the same ports, wherever there is an AY on `$FFFD`/`$BFFD` (128K, Pentagon..., AY in 48K). `OUT ($FFFD),$FF` selects chip 0, `$FE` chip 1; any other value is a register number for the selected chip, and reads follow the selected chip. With it off, `$FE`/`$FF` are ordinary register writes. AY writes carry the chip in `ayChanges` and are replayed on that chip; the two are mixed at 0.7 each. Checked with AY_YM_TS_test v0.2 (both chips' register tests and the channel tones).
- **DACs**, write-only and not exclusive (the port still reaches the rest of the bus), four 8-bit channels, `$80` = silence, recorded per frame with their T-state like the beeper:
  - *Covox*: one port, mono, settable (`$FB` by default, Pentagon; `$DD` on the Scorpion);
  - *Stereo Covox*: two settable ports, left and right (`$0F`/`$4F` by default);
  - *Specdrum* (Cheetah): `$DF`, mono;
  - *Soundrive 1.05*, two jumper modes (as in Unreal Speccy): mode 1 `$0F`/`$1F` left, `$4F`/`$5F` right; mode 2 `$F1`/`$F3` left, `$F9`/`$FB` right.
  - While TR-DOS is paged in, the DACs do not hear the bus (as in Unreal Speccy): mode 1's `$1F`/`$5F` are the Beta Disk's command and sector registers, and disk work would otherwise click through it. Likewise on a Beta 48's live FDC/system ports.
- `tests/sound-addons-test.html`.

## Microdigital TK-90X / TK-95

Machines `tk90x` and `tk95` (group Microdigital; ROMs `roms/tk90x.rom`, MAME's CRC `3e785f6f`, and `roms/tk95.rom`, `17368e07`; the TK-90X v1/v3 ROMs load the same way).

- 48K clones with the Microdigital ULA: **228 T-states a line**, 312 lines at 50 Hz = 71136 a frame (ZEsarUX: "La ULA Microdigital emplea 228 T por línea"), the 48K contention pattern; `profile.tstatesPerLine` in the ULA's 48K branch (the 48K itself is unchanged, 224). No floating bus (MAME: unattached ports read `$FF`), no snow.
- The ROM keeps the 48K entry points: tape traps and flash load work. Auto load types `LOAD ""` (keyword BASIC, as on every `pagingModel: 'none'` machine).
- TKMEM-128 II and "AY in 48K" are allowed on them; the Brazilian Beta 48 clones work (checked: Chase HQ 128 for TKMEM on CBI-95; T2 on TK-95 + TKMEM, no snow).
- Not done: the 60 Hz mode (262 lines), the TK-95's Spectrum+ keyboard layout as such, MAME's unexplained `$DF` write at start-up. `tests/tk-test.html`.

## Didaktik Gama (80KB)

Machine `dgama` (group Didaktik; ROM `roms/dgama89.rom`, MAME CRC `45c29401`; the '87 `43104909` and '88 `4ec7e078` load the same way). After ZEsarUX's `machines/didaktikgama.c` (MAME has the ROMs and a TODO for the 80K).

- A 48K clone (48K timing and contention, no floating bus) with 80KB: 16KB at `$4000` and two 32KB banks at `$8000-$FFFF` (`memory.gamaBank`, bank 1 in `gamaBank1`).
- The bank is **PC0** of its MHB8255, on ports `$1F` (A), `$3F` (B), `$5F` (C), `$7F` (control; decoded `xxx11111`, A6-A5 pick the register). A mode set (`$7F`, D7=1) clears the outputs; D7=0 sets/resets one port C bit (so `OUT 127,1` / `OUT 127,0` switch banks). PC0 counts only while the lower half of C is an output, else it is pulled low: bank 0. Power-on: mode `$9B` (all inputs); the ROM sets `$92` at start. Control reads `$FF`, port C its latch. While TR-DOS is paged in the ports are the Beta Disk's.
- Checked: the ROM boots ("© 1989 DIDAKTIK SKALICA"); the usual bank B detection routine (`OUT (127)` with 1/0 around a write to 50000) answers 80KB on the Gama and 48KB on a 48K. `tests/gama-test.html`.
- Not done: what else the 8255 drives (printer, the joystick on port A); Kempston on `$1F` is left as it is.

## Spectrum 128 MIDI out (AY register 14)

`core/midi.js`, `Spectrum.setMidiOut` / `onMidiMessage`. **Settings → Audio → MIDI out**: off, *monitor only* (the byte count and the last bytes next to it, no sound), *built-in synth* (`ui/midi-synth.js`: a small Web Audio synth, one voice per note, the waveform by program family, channel 10 as noise drums; not a GM sound set), or a Web MIDI output (a synth, Microsoft GS Wavetable, loopMIDI...). *search MIDI devices…* asks the browser for MIDI access and lists the outputs; once access is granted they are listed when the page loads, and the list follows devices plugged in or out.

- The 128K's MIDI OUT is RS232 TXD: bit 2 of AY register 14 (port A), while R7 bit 6 makes port A an output (otherwise the line idles high). The ROM's `PLAY` with a `Y` channel, and programs, bit-bang bytes at 31250 baud.
- Every change of the line is recorded with its absolute T-state; `UartDecoder` samples each bit in its middle (bit time = CPU clock / 31250: 3.5469 MHz on the 128K family, 3.5 MHz elsewhere), a frame listener finishes bytes whose last bits change nothing. It starts from the line as it is (a low line is not a start bit until it has been high).
- `MidiAssembler` makes whole messages for `send()`: running status, real-time bytes, SysEx.
- Checked: `PLAY "Y1c"` on a 128K sends `90 3C 78` / `80 3C 40` (Note On / Note Off, middle C, channel 1). Output to a real Web MIDI device is not covered by the tests. `tests/midi-test.html`.
- The new test pages keep their summary changing while they run (`running… n`), so `all-tests.html` does not take a long pause for the result.

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
- **Offered on the 48K only, and the port collision is the first reason, not the ROM.** The
  128K paging port decodes loosely as `port & 0x8002 == 0`, and `OUT (n),A` puts the written
  byte on A15-A8 — so on a 128K the *command byte* decides what else it hits. Every WD2797
  command collides with something: `$00` Restore and `$20` Step have A15=0 and A1=0, so they
  page memory; `$88` Read Sector and `$A8` Write Sector decode as the AY data port; `$C4`,
  `$D0`, `$E4` and `$F4` as AY register select. Only `$83` and `$87` escape, because A1=1.
  This is what VELESOFT means by a bus collision: *"D40 (Didaktik 40) is designed for use with
  48kB models. FDD ports is unusable on ZX128/+2/+2A/+3 (collision od data bus)."*

  The ROM is the second, independent reason, and it is the one we reproduced before knowing
  about the first. The interface seizes `$0000` at reset and its ROM is written for a 48K, but
  paging out on a 128K gives ROM 0, the 128 editor — so the machine never boots: red border,
  blank screen, no BASIC and no 128 menu. Reproduced on 128K and Pentagon.

- **Real hardware did run a D40 on a 128K — with a hardware patch.** VELESOFT: *"Some
  48to128kB upgrades also contain hardware patch for enable use D40 or D80"*, and the patch is
  that all three 128 ports must decode A5 high, `port & 0x8002 == 0` becoming
  `port & 0x8022 == 0x0020`. That cuts cleanly: all five Didaktik ports have A5=0 and drop
  out, while `$7FFD`, `$FFFD` and `$BFFD` have A5=1 and keep working. Arki55 reports years of
  use on a Didaktik M 128K converted by Kompakt Servis, and implemented both halves for FUSE
  — the A5 mask and ROM forced to page 1 — as an **optional** setting, "Port & Rom patch for
  128k+D80" ([thread](https://sourceforge.net/p/fuse-emulator/discussion/314871/thread/68bb262a2d/)).
  So the machines it shipped for were 48K-class clones, but upgrade services patched them; the
  Didaktik Kompakt 128K is a different machine again, with the drive built in.

  **48K-only is the default** — it is what stock hardware does — and the patch is offered as
  an opt-in: Settings → Machines → **128K hardware patch**, under the Didaktik row and shown
  only on a 128K/+2. `didaktik128Patch` is off unless asked for, remembered in
  `zxm8_didaktik128`. Upstream FUSE keeps the peripheral in `machines_periph_48()` only, while
  the +D sits in the shared `base_peripherals_48_128()` — which is why the +D works on a 128K
  here; Arki55's patch was a fork.

  **What the patch has to do here is ROM page 1, and only that.** Measured, not assumed: with
  the A5 mask simulated and the ROM held at bank 1 a full MDOS round trip succeeds on a 128K,
  and the A5 suppression never fires once — MDOS drives the FDC with the high address byte
  set, so no paging decode matches anyway. Take the ROM hold away and the round trip collapses
  (`disk-boot-test` fails four asserts, verified). Two reasons the mask is not needed: that,
  and `core/spectrum.js`'s port dispatch, which `return`s on the Didaktik branch **before** the
  paging and AY decode — so once the interface is active the collision cannot occur here at
  all. The mask is therefore not implemented; it would change nothing observable. What that
  leaves loose is the *stock* 128K, where real hardware has the ports present and colliding
  and we simply refuse them — unreachable, since the checkbox is off.

  `_didaktikMachineOk()` is the single predicate behind all four gates (`_isDidaktikActive`,
  `_didaktikPagingEnabled`, the reset hook and `loadD80Image`'s availability), so they cannot
  drift apart. It allows `pagingModel === '128k'` without `betaDiskDefault` — the 128K and +2.
  Not the +2A/+3, which decode `$7FFD` differently and which VELESOFT rules out by name; not
  Pentagon or Scorpion, which ship their own disk interface, so the patch was never a thing
  fitted to them. `memory.didaktikForceRom1` holds ROM 1 at reset **and** against any later
  `$7FFD` write, because the interface's ROM runs from reset and a 128K left on bank 0 boots
  the editor instead, and MDOS never starts.
- **The side is in the command byte.** There is no control register holding it: a WD2797 takes
  side select from bit 1 of a Type II/III command, which is where `executeCommand` reads it.

Ports (low byte): `$81` status/command, `$83` track, `$85` sector, `$87` data. The aux register
is decoded with mask `$F9`, so `$89/$8B/$8D/$8F` all reach it — bits 0/1 drive select, 2/3
motors, **bit 6 lets DRQ pull NMI and bit 7 lets INTRQ**. With neither bit set the interface is
in polled mode and must not interrupt at all. Anything with bit 7 of the port clear is the 8255
PPI, which is not wired to anything and reads `$FF`.

Geometry is MDOS: 9 sectors of 512 bytes, two sides, 40 tracks (368,640 bytes) or 80
(737,280), taken from the image size on insert.

**Using it:** enable Didaktik 80 in Settings → Machines **on a 48K** (or a 128K/+2 with the
128K hardware patch ticked), load a `.d40`/`.d80`,
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

## HC IF1 (HC-2000's built-in floppy interface)

Port of FUSE `if1_fdc.c` (branch `hc2000-v2`), checked against "HC Ports" (A. D. Ioan) and the HC IF1 ROM disassembly. `core/hc-if1.js`.

- **Memory**: pages in like an Interface 1 ($0008/$1708 in, $0700 out, any ROM bank), but over 16KB: `hc-if1.rom` at $0000-$3FFF with 1KB RAM at $2800-$2FFF and $3800-$3FFF (mirrored). Hidden while the HC-2000 is in CP/M decoding (CPMPL), as in FUSE. While the HC IF1 is fitted, +D, DISCiPLE, Opus, Interface 1 and the Kempston mouse are not offered — they page in at the same $0008 or overlap its ports.
- **Switchable**: Settings → Disk interfaces → "HC IF1 (HC-2000)", on by default (`zxm8_hcIf1`), `Spectrum.setHcIf1Enabled()`. An HC-2000 without it (or running an HC-91 ROM) is a plain Spectrum-compatible: no FDC, and the add-on interfaces come back. Toggling resets the HC-2000.
- **Ports** (only when A4-A6 are low): $85 MSR, $87 data, $05/$07 select latch — D0 TC, D1/D2 drive 0/1, D3 armed, D4=0 resets the 8272; reading bit 0 is low while a motor turns. Disarming starts the 555 (~1.7s) that drops the motors. Answered ahead of Kempston, which would otherwise claim $05/$07. The Kempston mouse is switched off on the HC-2000: on real hardware (and in FUSE-HC) its partial decode overlaps $85/$87 and breaks disk access.
- **Controller**: a `UPD765` with `tcConnected = true`, and it *is* `spectrum.fdc` on this machine, so DSK loading, drive letters, project save and the activity light use the +3 paths. The HC IF1 ROM asks for R..EOT=16, reads one 256-byte sector and pulses TC; `terminalCount()` ends the command normally (ST0 IC=00, no EN) after the sectors moved so far. Without TC the controller keeps the +3 behaviour.
- **Disks** (`core/loaders/disk-hc.js`): DSK as is; raw IMG converted (MGT stays the +D/DISCiPLE format and is not offered on the HC) to a DSKImage with real C/H/R/N. HC BASIC 16×256 (640K/320K) and CP/M 9×512 (720K/360K). Raw files store sectors by ID, but their side order varies (FUSE wrote `.img` side-major, `.mgt`/Gotek images alternate per cylinder): it is detected from the CP/M-style directory — the order under which the directory's blocks land on non-empty sectors — and only then from the extension. The ROM maps logical sector n to C=n/32, side=(n%32)/16, R=skew[n%16], skew 1,3,5…15,2,4…16 (ROM $1FF0); HC CP/M uses 1,3,5,7,9,2,4,6,8 on 9×512.
- **File systems** (`DSKLoader`, used by the disk catalogue and the Explorer): `DSKLoader.isHcDisk()` recognises an HC disk on its own — 16×256 numbered from 1 (the FDD3000 numbers from 0; an empty directory counts), or 9×512 without a +3DOS boot spec and with a CP/M directory after the boot tracks — and `getDiskSpec()` then returns the HC parameters (`_hcDiskSpec`, from hcfsv1.txt: BASIC 0 boot tracks / CP/M 4 (2 on 40 cylinders), 2K blocks, 16-bit allocation above 255 blocks, logical skew). HC BASIC names are one 11-character name across the 8+3 slot (`_dirEntryName`, shared by listing, reading, deleting and `addFile`). HC BASIC files carry the 9-byte IF1 header — type, length, start, program length, autostart line — read in `listFiles` (a BASIC loader may carry code after the program: the header still counts when a real BASIC line follows it; `hcTrailing` says how much) and written by `addFile`. The skew matches HCDisk 2 (G. Chirtoaca: software interleave 1 for all four HC formats).
- **Explorer**: an HC `.img` is converted to a DSK on opening (`hcRawToDsk`, also inside ZIPs), shown as "Raw HC BASIC/CP/M IMG (side order; why)", edited as a DSK and saved back as the same kind of `.img`. HC DSKs open as they are. New → "HC (ICE Felix)" makes blank HC DSKs (BASIC/CP/M, 80/40 tracks); DSKs we write for HC carry "ZX-M8XXX HC" in the creator field, so even an empty CP/M one is recognised after a reload.
- **Snapshots**: the 1KB RAM, the latch and the paged flag ride in the `M8MP` media chunk; the FDC state goes with `fdc` as on the +3.
- **Using it**: `RUN` boots the file `run` from drive 1; `LOAD *"d";1;"name"` etc. as on IF1 with device `d`. CP/M: `PRINT USR 14446` with a CP/M disk in drive 1.
- Tests: `tests/hc2000-test.html` (memory map, overlay, TC, raw geometry, and FUSE's `success_hc` disk on the real ROMs).

## Formatting: Write Track and Read Track (all four WD controllers)

**Status: emulated.** `core/loaders/mfm-track.js` (pure) plus Type III handling in
`PlusDDisk` (so the +D, the Opus and the Didaktik) and in `BetaDisk`.
`tests/mfm-track-test.html` covers the module; `tests/disk-test.html` the controllers;
`tests/disk-boot-test.html` drives two real ROMs through a whole disk.

**There is no "format a sector".** A DOS streams the WHOLE track at the chip — gaps, sync
fields, address marks, every sector's ID and its data field — and the chip writes the lot
between one index pulse and the next. So an interface without Write Track cannot *make* a
disk, only edit one somebody else made. Before this every `FORMAT` in the app reported
success and changed nothing, because the command completed instantly and threw the stream
away.

**The stream is not the medium.** During Write Track four byte values are instructions
rather than data: `$F5` writes an `A1` with a missing clock transition *and presets the CRC
generator*, `$F6` writes a `C2` the same way, and `$F7` writes the two CRC bytes the chip
has accumulated. Read Track reads the disk, so it gives back real `A1` bytes and real CRCs.
`buildTrackStream` builds either — `marks: 'stream'` for the first, `marks: 'medium'`
(the default) for the second — and `parseTrackStream` reads the first.

- **`parseTrackStream(bytes)`** → `{ sectors, truncated }`. Walks the stream the way the
  chip does: a mark counts only when a `$F5` put a missing clock in front of it, so an
  `$FE` inside a data field is just a byte. An ID field with no data field after it is
  dropped — the chip wrote it, but there is no sector there. `truncated` says the stream
  ended inside a field, which is what a Force Interrupt mid-format looks like.
- **`buildTrackStream(spec)`** → the bytes on a track holding those sectors. **Gap 3 is
  computed, not a constant**, because no constant works: a revolution holds 6250 bytes, so
  18 Opus sectors of 256 leave 91 bytes each for everything that is not data while 10 MGT
  sectors of 512 leave 113. A real formatter divides out what is left, and so does this.
- **`formatTrackStream(spec)`** → the stream a formatter would write for one uniform
  geometry, interleave included. What a test hands straight to a Write Track command.

**Only MFM**, and that is a decision: every interface here runs its controller in double
density, and FM would need the DDEN pin, which nothing drives. Also a decision: **`$F5`
inside a data field is taken as data.** Real hardware would write a sync byte into the
middle of the sector and preset the CRC — which is exactly why Write Track cannot lay down
arbitrary content, and why every formatter fills data fields with `$E5` or `$00`.

**Where the sectors go.** Write Track compares nothing: it writes where the head is
standing, so the cylinder byte in each ID is simply more data. `finishWriteTrack` indexes
by `mediumTrack` (the head position, double-stepping accounted for) and counts a sector as
**skipped** if its ID disagrees with that, if its size code is not the image's, or if its
number is off the end of the track. On a real disk the ID and the head position can
disagree — half of how copy protection works — but a flat sector dump has nowhere to put
such a track, so it is counted rather than filed under what it claims. `lastFormat`
(`{track, side, drive, found, written, skipped, revolutions}`) is what a stalled `FORMAT` is
diagnosed from; `revolutions` is how long the host took to feed the track, and a real chip
gives it exactly one.

**Read Track** answers from the geometry for a flat image, with real marks and real CRCs.
Two things such an image cannot say: the interleave (the sectors are reported in ascending
order, the only order it records) and the real gap lengths, which get the IBM System 34
defaults. A `.udi` on the Beta Disk has the actual track bytes and is served from those
instead.

**The index pulse is what ends a Write Track**, one revolution after it began, whatever the
host does. A host that opens a track and then waits for an INTRQ is relying on exactly that
— and **TR-DOS 5.03 does it on every SAVE**: it writes `$F8` to the command register from
the ROM's entry stub at `$3D9C`, then polls `$FF` for an interrupt and feeds nothing at all.
While Write Track was a no-op that cost nothing; implementing it hung every TR-DOS save
until a deadline put the interrupt back.

`_formatPoll()` applies that deadline on every look at the status register, the system
register or the +D's control register. With a rotation clock (see the next section) it is a
**revolution of silence, measured from the last byte** — then the command completes with
**lost data** and raises the interrupt, committing whatever did arrive. Measuring from the
last byte rather than from the command is deliberate: a feed still arriving has not missed
its index, and the Opus and MDOS both take about 1.15 revolutions to stream a track, so a
deadline measured from the command would break two formats that work. No ROM mid-format
pauses for anything near a revolution — the slowest here goes ~130 T-states between bytes
against the 698880 of a revolution — so a real format cannot be cut short.

Without a clock (a controller built with no machine around it, which is every unit test that
constructs one directly) the old stand-in applies: `FORMAT_POLL_LIMIT` (4096) register reads
with `dataPos` still 0. The gate on `dataPos` is what makes *that* safe — MDOS polls the
status well past 4096 times *before* its first byte, and an earlier version counting the gap
between bytes aborted its format at track 2. A new command also ends an open format wherever
it came from, so nothing can latch.

**What the real ROMs do** (`tests/disk-boot-test.html`):

| Interface | `FORMAT` syntax | Result |
|---|---|---|
| Opus Discovery | `FORMAT "m";1;"NAME"` (no star, unlike SAVE) | 40 Write Tracks, 720 sectors. An all-zero image becomes a disk our own reader catalogues, and a SAVE/reset/LOAD round trip works on it |
| Didaktik 80 | `FORMAT "A:NAME"`, then `P` at "All data will be discarded !" | 160 track-sides, 1440 sectors, and MDOS saves to the disk it just made |
| TR-DOS | `FORMAT "NAME"` at the `A>` prompt | 82 Write Tracks, 1296 sectors. Formats an **80-track single-sided** disk (`1264/1264` free is 80 × 16 minus track 0, not 40 × 2 — that is the drive type it defaults to), writes its own disk-info sector, and a SAVE to the result lands in the catalogue |
| +D / G+DOS | — | Untestable here: the 8K ROM is a bootstrap and G+DOS lives in a `+SYS` file on the disk, which is not in the tree. `FORMAT` is not hooked, so the main ROM answers `Invalid stream` |

**Typing `FORMAT` is the trap.** At the `A>` prompt the cursor is in K mode, where `f` gives
**FOR** — `FORMAT` is an *extended*-mode keyword (CAPS+SYMBOL, then SYMBOL+`0`) and nothing in
`ula.keyDown` reaches it, so `tests/disk-boot-test.html` drives the matrix directly
(`[0,0]`+`[7,1]`, then `[7,1]`+`[4,0]`). Getting that wrong is how TR-DOS came to look as
though it could not format at all: `FOR "trd"` leaves a stray Write Track behind and a screen
full of nothing.

**What TR-DOS's formatter looks like**, for anyone reading the ROM: `$1FFD` does
`DI / LD A,$F4 / OUT ($1F),A`, then streams from a table at `$1FB9` holding the sector
interleave (`01 09 02 0A 03 0B …`) — 10 × `$4E`, 12 × `$00`, three `$F5`, `$FE`, cylinder from
E, **head hard-coded to `$00`**, the sector from the table, `$01` for N, `$F7`, and the data
field the same way with `$FB` and 256 zero bytes. The side comes from the drive's select line
(`$1FEB` sets bit 4 of the `$FF` shadow at `$5D16` for side 0, `$1FF6` clears it for side 1),
never from the ID field — which is why `finishWriteTrack` indexes by the head and not by the
stream's head byte.

## Rotation: the index pulse and the byte clock

**Status: emulated.** `core/loaders/disk-rotation.js` (pure), given to every WD17xx
controller by `Spectrum._wireDiskRotation()`. `tests/disk-rotation-test.html` covers the
module, `tests/disk-test.html` the controllers with a clock injected by hand.

A floppy is not a passive array of sectors: it turns at 300 rpm whether the host is ready or
not, and almost everything a WD17xx does is timed by that. Three things software can see:

- **The index pulse.** One per revolution, from a hole in the disk. It is bit 1 of the Type I
  status register, and it is what ends a Write Track.
- **The byte rate.** MFM at 250 kbit/s is one byte every 32 µs. DRQ comes on that schedule
  and does not wait.
- **Which sector is under the head.** Read Address returns the next ID to come round, so two
  reads a revolution apart give different answers.

**Read Address is not a snapshot, and modelling it as one is wrong** — `opus-test` caught
this. The command *waits* for the next ID field, so reading one costs the time to reach it
and two commands in a row report consecutive sectors on real hardware. Our commands complete
instantly, so the head is kept **monotone** instead, counted in absolute sector slots rather
than modulo a revolution (`absoluteSlot`): a command takes the next slot after the one it
last reported, or wherever the disk has since turned to, whichever is further on, and never
one the head has already passed. Modelled as "which sector is under the head now" it handed
back the same sector twice, which is less realistic than the round robin it replaced.

**A revolution is exactly ten frames.** 300 rpm is 5 rev/s and a PAL frame is 50 Hz, so one
revolution is ten frames of whatever the machine's T-states-per-frame happens to be — 698880
on a 48K, 709080 on a 128K, 716800 on a Pentagon. That is why there is no per-machine disk
constant anywhere here and no floating-point clock rate: the figure follows the machine, and
it stays right when the machine changes under a controller. The byte time falls out of the
same arithmetic — 698880 / 6250 = 111.8, which is where the 112 in `core/constants.js` comes
from, now derived rather than written down for one machine (`disk-rotation-test` asserts the
two agree).

**The clock is injected, and its absence is a supported state.** `setRotationClock(nowFn,
revFn)` takes a monotonic T-state count and a revolution length, both as functions so a
machine switch is picked up. `Spectrum` builds the count from the monotonic frame counter
plus the in-frame `cpu.tStates` — the in-frame counter alone restarts fifty times a second,
which would put the index pulse back where it was ten times a revolution. A controller given
no clock keeps its untimed behaviour (a faked pulse one read in sixteen, Read Address in
round robin, Write Track ended by counting register reads), because a controller with no
machine around it has no business inventing a rotation it cannot see.

**Elapsed time is not pulses crossed**, and conflating them is a real bug that happened here.
`indexPulsesBetween` counts index pulses *crossed* by an interval, which for a Write Track
deadline is the wrong question: a last byte landing at 0.97 of a revolution crosses a pulse a
thirtieth of a turn later. Written that way, TR-DOS formatted 81 tracks and then wrote 196
bytes of the 82nd. The deadline wants `revolutionsSince` — elapsed time — and both functions
are kept, and tested against each other, so the distinction cannot quietly go away.

**DRQ pacing: absolute, and that is the whole trick.** The two interfaces that transfer by NMI
— the Opus and the Didaktik — get their DRQ scheduled from the previous byte's **due** time,
not from the moment the host got round to servicing it, with the byte time taken from the
rotation (111.8 T on a 48K, 114.7 on a Pentagon) rather than the rounded 112 in
`core/constants.js`. Scheduled the other way round, the handler's own cost is added to every
byte instead of hiding inside it: measured, the Opus spent ~130 T-states a byte and MDOS ~128
where the medium allows 111.8, and a track took **1.15 revolutions** to write, which no real
drive could do. Absolute, both come to 111.8 and `lastFormat.revolutions` ≈ 1.003 — the 0.003
being the head-settle delay before the first byte. `disk-boot-test` pins all three figures,
with TR-DOS as the control at the time: it polls rather than taking NMIs, so nothing Spectrum
did to the NMI schedule could move it, and it fitted a track into half a revolution. It no
longer does — see the polled pacing below, which is the gap that control variable was quietly
measuring all along.

**Reads are paced the same way, and the symmetry was hard won.** A read looks as though it
must be different: the chip has a byte waiting and DRQ means "take it before the next lands
on it", so scheduling the next request before the host has finished with this one is exactly
the lost-data condition. That argument is wrong here, and it was believed for a while because
`opus-test` collapsed into a retry storm when reads were first made absolute — which turned
out to be the test restoring a stubbed `onDataRequest` by re-implementing it, leaving the NMI
permanently due. **Measured instead of argued**, on 512 bytes of a real `CAT` through the real
ROM:

| | from the service | from the previous due |
|---|---|---|
| Opus write (format) | 130.1 T/byte | 112.2 |
| MDOS write (format) | 127.9 | 112.2 |
| Opus read (CAT) | 135.7 | 111.9 |
| MDOS read (LOAD) | 127.0 | 111.8 |

The Opus NMI read handler is **eleven instructions and 87 T-states** from acknowledge to
`RETN`, 27 of them before it takes the byte:

```
$0066  JP (HL)        $174C  LD A,(2803h)   ; the data register
$1749  EX AF,AF'      $174F  JP Z,1755h
$174A  LD A,B         $1752  LD (DE),A      ; into the buffer
$174B  OR C           $1753  INC DE  / DEC BC / EX AF,AF' / RETN
```

It fits inside a byte time with a quarter to spare, and on real hardware it has to — so
nothing nests. Both suites pin the rate (`opus-test` on the CAT, `disk-boot-test` on an MDOS
`LOAD`), and both fail at ~136 and ~127 if the schedule is put back the other way.

What this leaves open is the opposite of what it was: a host now **can** be late, and a real
chip would raise LOST DATA where we simply deliver the byte anyway. That is in `TODO.md`,
along with the rotational latency Read/Write Sector still lack.

**A Write Track begins on the index pulse, not where the command landed.** The chip asserts
DRQ the moment the command is written — the host needs its first byte in the register before
the hole comes round, and failing to is lost data on real hardware — and then waits, and
writes from that pulse to the next one. So the **command** spans between one and two
revolutions while the **write** spans exactly one, and `lastFormat` reports the two
separately: `indexWait` (0 to 1, wherever the command fell) and `revolutions`. A command
landing *on* the pulse waits for nothing. Measured on the three ROMs: Opus 0.86 + 1.00,
MDOS 0.72 + 1.00, TR-DOS 0.66 + 1.00, so a real command takes 1.7–1.9 turns. `revolutions`
reads 0.9997 rather than the old 1.003 because the first byte's head-settle delay now sits
in the wait instead of inside the window, which is where it physically belongs.

`Spectrum._drqDueAt` holds the paced interfaces to it through `ctrl.drqNotBefore`: the first
byte is exempt, and the stream from the second byte on starts at the index.

**And the POLLED Write Track had no byte pacing at all** — which only became visible once the
window was anchored. TR-DOS does not take NMIs; its feed loop reads port `$FF` for DRQ and
comes round every ~57 T-states where the medium gives a byte 111.8, so it filled a whole
6250-byte track in **half a revolution**. Harmless while the deadline ran from the last byte;
incoherent the moment the window started at the index, because the buffer filled before the
window opened and `revolutions` came out **negative**. The chip now clears DRQ until the next
byte is due — on port `$FF` bit 6 as well as in the status register, because `$FF` is the one
TR-DOS actually polls, and gating only the status register changed nothing at all. TR-DOS
formats a track in 0.9997 revolutions now instead of 0.5.

**An NMI acknowledge costs 11 T-states, and for a long time it cost us nothing.** `Z80.nmi()`
returns them the way `interrupt()` does, and every one of the five call sites in `Spectrum`
dropped the value instead of adding it to the clock. Nothing measured at frame scale could
see it; a transfer paced to the byte could. Charging it moved the Opus handler from 76 to 87
T-states and the per-byte rate not at all — which is the absolute schedule earning its keep,
since the extra cost hides inside the interval rather than being added to every byte.

**The clock has to be monotonic, and `totalFrames` will not give you that.** Built as
`totalFrames * tstatesPerFrame + cpu.tStates` it is not: `totalFrames` is incremented at the
**end** of a frame while the frame is subtracted from `cpu.tStates` at the **start** of the
next one, so between the two the clock leaps a whole frame forward and then drops back.
Against a 698880-T revolution that is a wobble nothing notices; against a DRQ due 112 T out
it schedules a byte a whole frame late and stalls every Opus transfer. `Spectrum` keeps
`_diskClockBase` advanced in lockstep with that subtraction instead, at all four places it
happens, and `diskClockNow()` is the sum. `disk-boot-test` samples it either side of 200
frame boundaries.

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
