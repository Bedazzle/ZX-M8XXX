# Peripherals: +D/MGT, IF1/Microdrive, Opus Discovery, Didaktik 40/80, +3/FDC

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

**OpusDisk class (`core/loaders.js`):**
- WD1770 FDC + MC6821 PIA emulation via composition (wraps PlusDDisk internally)
- Memory-mapped register access (not I/O ports): readFDC/writeFDC ($2800-$2FFF), readPIA/writePIA ($3000-$37FF)
- PIA Port A bits: bit 1=drive select, bit 4=side select; Control register bit 2 gates DDR vs data
- 0-based sector numbering via overridden `getSectorOffset`

**Memory paging (`core/memory.js`):**
- `opusActive` flag: when true, $0000-$1FFF=ROM, $2000-$27FF=RAM, $2800-$2FFF=FDC, $3000-$37FF=PIA, $3800-$3FFF=unmapped ($FF)
- Priority in read(): IF1 -> Opus -> +D -> TR-DOS/ROM
- `loadOpusRom(data)` / `hasOpusRom()` -- 8KB ROM management

**Integration (`core/spectrum.js`):**
- `opusEnabled` flag + `_isOpusActive()` check
- `loadOPDImage(data, fileName, driveIndex)` -- load OPD into Opus drive
- `triggerOpusNmi()` -- pages in Opus ROM/RAM and triggers Z80 NMI
- `loadedOpusDisks[0..1]` / `loadedOpusDiskFiles[0..1]` -- per-drive state
- Opus <-> +D mutually exclusive (both overlay $0000-$3FFF); compatible with IF1 and Beta Disk
- ROM paging (per FUSE z80_ops.c): ALL-LATE check model. Unlike IF1/+D (which page BEFORE opcode fetch), FUSE checks Opus AFTER opcode fetch. This is because the Opus ROM has a DIFFERENT instruction at $0008 (`JP $0168`) vs the Spectrum ROM (`LD HL,(nn)`). FUSE's mid-instruction paging fetches the opcode from the Spectrum ROM, then pages in Opus for operands. Since our cpu.execute() is atomic, we use all-late paging:
  - `updateOpusPaging(oldPC)` -- AFTER cpu.execute(): page IN at $0008 (RST 8 -> Spectrum ROM's LD HL executes, PC=$000B=ENTRY_1, POP HL discards HL), $0048 (KEY_INT ISR hook), $1708 (CLOSE#); page OUT at $1748.
  - PIA initialized to all zeros (matching FUSE). INIT_RAM2 runs on first $0048 ISR frame to configure PIA registers AND copy lookup tables from ROM to 2KB RAM -- both are essential for RST $30 (LOOKUP) dispatch.
- `updateOpusPagingFlag()` -- recalculate `_opusPagingEnabled` flag (call when settings/ROM change)

**Settings (`ui/input-settings.js`):**
- `chkOpus` checkbox: enable/disable Opus Discovery
- `opus.rom` file loading via ROM selector or Settings button
- NMI button: triggers Opus snapshot (pages in ROM, CPU NMI)
- Mutual exclusion: enabling Opus disables +D (and vice versa)
- Persisted in localStorage key `zxm8_opus`

## Didaktik 40/80 (MDOS D40/D80 images)

`DidaktikLoader` (`core/loaders.js`) reads and writes Didaktik 40/80 MDOS disk images — raw, header-less sector dumps (sector N at offset N×512). It lists/extracts catalog files, creates blank disks (`createBlankD40`/`createBlankD80` — byte-reproduce real 360K/720K MDOS formats), and supports in-place editing (add/delete/rename) for the Explorer/file-analysis tool; it does **not** emulate the Didaktik interface, so disks don't boot. Read algorithms ported from the zxspectrumutils tools (`d802tap.cpp`, `dird80.c`); the write path follows `tap2d80.cpp` from the same source.

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
