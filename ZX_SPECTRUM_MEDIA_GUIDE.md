# ZX Spectrum — Media Systems Guide

This file covers tape formats, disk/storage interfaces, and their file formats as used by ZX Spectrum family computers and compatible hardware.

---

## 1. Tape — TAP / TZX

Cassette tape was the standard storage medium for the ZX Spectrum. Programs are stored as sequences of audio pulses representing data blocks.

TAP is a simple format storing raw data blocks with length headers. TZX is an extended format supporting turbo loaders, custom timing schemes, and copy protection.

---

## 2. Beta Disk — TR-DOS (TRD / SCL files)

### Setup

- Pentagon / Scorpion: Beta Disk is always enabled (built-in).
- 48K / 128K / +2: Requires TR-DOS ROM (trdos.rom) and Beta Disk enabled.

### Entering TR-DOS

From BASIC prompt:

```
RANDOMIZE USR 15616           — Enter TR-DOS command line
```

The TR-DOS command line shows the drive letter prompt (e.g. `A>`).

### Loading files

From TR-DOS command line:

```
LIST                          — List files on disk
LOAD "filename"               — Load and run BASIC program
LOAD "filename" CODE          — Load CODE file to its saved address
LOAD "filename" CODE 40000    — Load CODE file to address 40000
RUN "filename"                — Same as LOAD for BASIC files
RUN                           — Run the file named "boot" (type B, BASIC)
```

From 48K BASIC (without entering TR-DOS):

```
RANDOMIZE USR 15619: REM: LOAD "filename"
RANDOMIZE USR 15619: REM: LOAD "filename" CODE
```

USR 15619 executes a single TR-DOS command given after `REM:`. If the loaded BASIC program has an autostart line, it will run immediately.

### Saving files

From TR-DOS command line:

```
SAVE "filename"               — Save current BASIC program
SAVE "filename" LINE 10       — Save BASIC with autostart at line 10
SAVE "filename" CODE 30000,2048   — Save memory block as CODE
SAVE "filename" DATA a()      — Save numeric array
SAVE "filename" DATA a$()     — Save string array
```

### Managing files

```
ERASE "filename"              — Delete file
MOVE "old","new"              — Rename file (some TR-DOS versions)
```

### File types

| Extension | Type |
|-----------|------|
| B | BASIC program |
| C | CODE (machine code / data block) |
| D | Data array (numeric or string) |
| # | Sequential file (stream I/O) |

### Multi-drive

4 drives supported (A–D). From TR-DOS:

```
*"B:"                         — Switch default drive to B
CAT "B:"                      — List files on drive B
LOAD "B:filename"             — Load from drive B (temporary)
LOAD "B:filename" CODE        — Load CODE from drive B
SAVE "B:filename"             — Save to drive B
```

---

## 3. +3 DOS (DSK files)

### Setup

- Only available on the +3 machine type (requires plus3.rom).
- The +3 ROM handles disk boot automatically via the Amstrad menu "Loader" option.

### Loading

From +3 BASIC (disk is the default device):

```
CAT                           — List files on disk
LOAD "filename"               — Load BASIC program from disk
LOAD "filename" CODE          — Load CODE file from disk
LOAD "filename" CODE 40000    — Load CODE to specific address
LOAD "filename" SCREEN$       — Load screen data
LOAD "filename" DATA a()      — Load array
```

From tape (must switch to tape first):

```
LOAD "T:"                     — Switch LOAD to tape
LOAD ""                       — Load next program from tape
LOAD "filename"               — Load named program from tape
LOAD "A:"                     — Switch LOAD back to disk
```

### Saving

To disk (default):

```
SAVE "filename"               — Save BASIC program to disk
SAVE "filename" CODE 30000,2048   — Save CODE block to disk
SAVE "filename" SCREEN$       — Save screen
SAVE "filename" DATA a()      — Save array
```

To tape (must switch to tape first):

```
SAVE "T:"                     — Switch SAVE to tape
SAVE "filename"               — Save to tape
SAVE "A:"                     — Switch SAVE back to disk
```

### Managing files

```
CAT                           — Directory listing
ERASE "filename"              — Delete file
MOVE "old" TO "new"           — Rename file
```

Files have 8.3 filenames (8-char name + 3-char extension).

### Drive letters

The +3 uses drive letter prefixes to select the storage device:

| Prefix | Device |
|--------|--------|
| A: | Built-in disk drive (default) |
| B: | External disk drive |
| T: | Tape |
| M: | RAMdisk |

By default, LOAD and SAVE operate on disk (A:). To switch to tape:

```
LOAD "T:"                     — Switch LOAD/MERGE to tape
SAVE "T:"                     — Switch SAVE to tape
```

After this, all subsequent LOAD/SAVE commands use tape until switched back:

```
LOAD "A:"                     — Switch LOAD/MERGE back to disk
SAVE "A:"                     — Switch SAVE back to disk
```

Example — copy a BASIC program from tape to disk:

```
LOAD "T:"                     — Switch to tape
LOAD ""                       — Load next program from tape
SAVE "A:"                     — Switch to disk
SAVE "filename"               — Save to disk
```

> **Note:** CAT, ERASE, MOVE, and COPY always operate on the disk drive, regardless of the T:/A: setting.

### Multi-drive

2 drives (A–B).

---

## 4. DISCiPLE / +D — GDOS (MGT / IMG files)

### Setup

- Requires plusd.rom (8KB +D ROM).
- Works with any machine type (48K, 128K, +2, Pentagon, etc.).
- The +D is an external interface that pages its own ROM/RAM over the Spectrum's address space when active.

### Using the +D

The +D is activated via the NMI button (snapshot button on the real hardware):

1. Press NMI button
2. The +D menu appears on screen

From the NMI menu you can save snapshots, catalog disks, and manage files.

### Loading files from BASIC

The +D extends BASIC with new commands (processed by the +D ROM when it intercepts the BASIC error handler):

```
CAT 1                         — Catalog drive 1 (A)
CAT 2                         — Catalog drive 2 (B)
LOAD d1"filename"             — Load from drive 1
LOAD d2"filename"             — Load from drive 2
LOAD d1"filename" CODE        — Load CODE file
LOAD d1"filename" CODE 40000  — Load CODE to address
LOAD d1"filename" SCREEN$     — Load screen
LOAD d1"filename" DATA a()    — Load array
```

### Saving files from BASIC

```
SAVE d1"filename"             — Save BASIC program
SAVE d1"filename" CODE 30000,2048   — Save CODE block
SAVE d1"filename" SCREEN$     — Save screen
SAVE d1"filename" DATA a()    — Save array
```

### Managing files

```
CAT 1                         — Directory listing
ERASE d1"filename"            — Delete file
```

### File types

| Code | Type |
|------|------|
| 1 | BASIC program |
| 2 | Numeric array |
| 3 | String array |
| 4 | CODE (machine code / data) |
| 5 | 48K snapshot (via NMI button) |
| 7 | SCREEN$ (6912 bytes) |
| 9 | 128K snapshot |
| 10 | Opentype (sequential access) |
| 11 | Execute (auto-run CODE) |

### Multi-drive

2 drives (A–B).

### NMI snapshot

The +D's NMI button was the primary feature of the DISCiPLE/+D interface. Pressing it during a game saves a complete snapshot to disk. This works because the NMI is non-maskable — the running program cannot prevent it.

---

## 5. Interface 1 / Microdrive (MDR files)

The Interface 1 was Sinclair's first mass storage device, using Microdrive tape-loop cartridges. Each cartridge holds approximately 128KB. Files are stored as linked sector chains.

### Setup

- Requires if1.rom (8KB Interface 1 ROM)
- Note: IF1 conflicts with +D interface (cannot use both simultaneously)
- Compatible with: 48K, 128K, +2, Pentagon (NOT +2A/+3)

### BASIC commands

```
CAT 1                  — List files on Microdrive 1
LOAD *"m";1;"name"     — Load program "name" from Microdrive 1
SAVE *"m";1;"name"     — Save program "name" to Microdrive 1
ERASE "m";1;"name"     — Erase file "name" from Microdrive 1
FORMAT "m";1;"label"   — Format Microdrive 1 cartridge with label
MOVE "m";1;"n1" TO "m";2;"n2"  — Copy file between drives
```

Up to 8 Microdrives supported via daisy-chain connection.

---

## 6. Opus Discovery (OPD / OPU files)

The Opus Discovery was a third-party disk interface for the ZX Spectrum with 8KB ROM and 2KB RAM.

### Setup

- Requires opus.rom (8KB Opus Discovery ROM)
- Note: Opus conflicts with +D interface (both overlay $0000–$3FFF)
- Compatible with: 48K, 128K, +2, Pentagon (NOT +2A/+3)
- No conflict with IF1 or Beta Disk

### BASIC commands (Microdrive-compatible syntax)

```
CAT 1                      — List files on drive 1
LOAD *"m";1;"name"         — Load program from drive 1
SAVE *"m";1;"name"         — Save program to drive 1
MOVE "d";1 TO "d";2       — Copy entire disk (drive 1 → drive 2)
OPEN # 4,"m";1;"filename"  — Open file on drive 1 for I/O
OPEN # 3;"t"               — Open printer channel
```

### NMI button

The NMI button activates the Opus snapshot/catalog menu.

### Multi-drive

2 drives (A–B).

---

## 7. Common Notes

### Auto load

- **TAP/TZX**: Types `LOAD ""` and flash-loads
- **TRD/SCL**: Boots into TR-DOS (runs boot file if present)
- **DSK**: Resets +3, presses Enter at menu (ROM auto-detects disk)
- **MGT**: Disk is inserted but must be accessed manually (use NMI or BASIC commands above)
- **MDR**: Cartridge is inserted but must be accessed manually (use Interface 1 BASIC commands above)
- **OPD**: Disk is inserted but must be accessed manually (use NMI or Opus BASIC commands above)

### Cross-format file compatibility

All disk formats store the same ZX Spectrum file types (BASIC, CODE, arrays, sequential) with compatible metadata (filename, start address, autostart line). Files can be transferred between formats with appropriate header conversion:

| Source format | Header style | Size |
|---------------|--------------|------|
| TAP/TZX | 17-byte tape header | Inline in block |
| TRD/SCL | Directory entry | 16-byte entry |
| MGT | +D header | 9 bytes prepended to data |
| MDR | Spectrum header | 9 bytes prepended to data |
| OPD | Opus header | 7 bytes prepended to data |
| DSK (+3DOS) | +3DOS header | 128 bytes prepended to data |
| DSK (TOS) | TOS header | 5 or 7 bytes prepended to data |

### Write persistence

Games can save to disk. All disk writes are preserved in memory. Use format-appropriate save to download the modified disk image.

---

## 8. File Format Technical Details

This chapter contains byte-level specifications for all media file formats.

### 8.1 TAP format

```
Structure: [length:2 LE][data:length bytes] repeated
```

Each block starts with a flag byte:
- `$00` — Header block (always 17 data bytes + 1 checksum = 19 total)
- `$FF` — Data block (variable length)

Header block layout (17 bytes after flag):

| Offset | Content |
|--------|---------|
| 0 | File type (0=BASIC, 1=Num array, 2=Char array, 3=CODE) |
| 1–10 | Filename (10 chars, padded with spaces) |
| 11–12 | Data length (LE) |
| 13–14 | Param 1 (autostart line for BASIC, start address for CODE) |
| 15–16 | Param 2 (program length for BASIC, 32768 for CODE) |

Last byte of each block: XOR checksum of all preceding bytes (flag + data).

File size: Variable (sum of all block lengths + 2-byte headers per block).

### 8.2 TZX format

Signature: `"ZXTape!\x1A"` (8 bytes) + version major(1) + minor(1)

Block types (each prefixed by 1-byte ID):

| ID | Block type |
|----|------------|
| $10 | Standard Speed Data Block (pause:2, length:2, data) |
| $11 | Turbo Speed Data Block (pilot/sync/bit timings, data) |
| $12 | Pure Tone (pulse length:2, count:2) |
| $13 | Pulse Sequence (count:1, pulses:count×2) |
| $14 | Pure Data Block (zero/one bit lengths, data) |
| $15 | Direct Recording (sample rate, data) |
| $20 | Pause/Stop ($0000 = stop tape) |
| $21 | Group Start (name) |
| $22 | Group End |
| $23 | Jump to Block |
| $24 | Loop Start (count:2) |
| $25 | Loop End |
| $2A | Stop if 48K |
| $30 | Text Description |
| $32 | Archive Info |
| $35 | Custom Info Block |

Standard blocks ($10) use the same flag/header/data/checksum structure as TAP. Turbo blocks ($11) use custom timing for faster loading or copy protection.

### 8.3 TRD format

**Geometry:** 80 tracks, 2 sides, 16 sectors/track, 256 bytes/sector. Total: 640 KB (655,360 bytes). Maximum 128 files per disk.

File size: 655,360 bytes (80 × 2 × 16 × 256). Raw sector dump, sequential: track 0 side 0, track 0 side 1, track 1 side 0...

Sector offset: `((track × 2 + side) × 16 + sector) × 256`

Directory: track 0 (both sides), sectors 0–15 = 128 entries × 16 bytes.

**Directory entry (16 bytes):**

| Offset | Content |
|--------|---------|
| 0 | File type (B/C/D/#, or $00=erased, $01=deleted) |
| 1–8 | Filename (8 chars, space-padded) |
| 9 | Extension (single char: B, C, D, #) |
| 10–11 | Param 1 — start address (CODE) or BASIC length (LE) |
| 12–13 | Param 2 — data length (LE) |
| 14 | Sector count (file size in sectors) |
| 15 | First sector (0–15) |

> Note: first track is implicit from sequential allocation.

**Disk descriptor (track 0, sector 8, byte 225+):**

| Offset | Content |
|--------|---------|
| 225 | First free sector |
| 226 | First free track |
| 227 | Disk type ($16=80T DS, $17=40T DS, $18=80T SS, $19=40T SS) |
| 228 | File count |
| 229–230 | Free sector count (LE) |
| 231 | TR-DOS ID ($10) |
| 245–252 | Disk label (8 chars) |

### 8.4 SCL format

TR-DOS archive format. Contains only the file entries and their data, not the full disk geometry.

```
Signature: "SINCLAIR" (8 bytes)
Byte 8: File count (N)
Bytes 9..(9+N×14-1): Directory entries (14 bytes each — type, name, start, length, sectors)
Remaining: Concatenated file data blocks
Last 4 bytes: CRC32 of all preceding data
```

SCL files are converted to TRD format for use with the Beta Disk emulation.

### 8.5 DSK / EDSK format (Extended Disk Image)

The DSK format (also known as EDSK — Extended DSK) is a disk image format originally created for Amstrad CPC emulators but also used for ZX Spectrum +3 disk images. It stores a complete low-level representation of a floppy disk including per-track sector layouts.

**Signatures:**
- Standard: `"MV - CPC"` (34-byte header line)
- Extended: `"EXTENDED CPC DSK"` (34-byte header line)

**Disk header (256 bytes):**

| Offset | Content |
|--------|---------|
| 0–33 | Signature line |
| 48 | Number of tracks |
| 49 | Number of sides |
| 50–51 | Track size (standard) / unused (extended) |
| 52–255 | Track size table (extended: 1 byte per track, in units of 256) |

**Track header (256 bytes per track):**

| Offset | Content |
|--------|---------|
| 0–12 | `"Track-Info\r\n"` |
| 16 | Track number |
| 17 | Side number |
| 20 | Sector size code (log2(size)−7; 2=512, 1=256) |
| 21 | Number of sectors |
| 22 | GAP#3 length |
| 23 | Filler byte |
| 24+ | Sector info (8 bytes each — see below) |

**Sector info (8 bytes):**

| Offset | Content |
|--------|---------|
| 0 | Cylinder (C) |
| 1 | Head (H) |
| 2 | Sector ID (R) |
| 3 | Size code (N) |
| 4 | FDC status register 1 |
| 5 | FDC status register 2 |
| 6–7 | Actual data length (extended format, LE) |

Sector data follows the track header, sizes per sector info.

#### +3DOS boot specification (16 bytes at track 0, first sector)

| Byte | Content |
|------|---------|
| 0 | Disk type (0=PCW/+3 SS, 1=CPC System, 2=CPC Data, 3=PCW/+3 DS) |
| 1 | Sidedness (0=single, 1=double alternating, 2=double successive) |
| 2 | Tracks per side |
| 3 | Sectors per track |
| 4 | Sector size log: log2(size) − 7 (2=512, 1=256) |
| 5 | Reserved tracks (before directory) |
| 6 | Block shift: log2(blockSize / 128) (3=1K, 4=2K, 5=4K) |
| 7 | Directory blocks |
| 8 | R/W gap length |
| 9 | Format gap length |
| 10–14 | Reserved (0) |
| 15 | Checksum (sum of bytes 0–15 must equal 3 mod 256) |

#### CP/M directory (32 bytes per entry)

| Byte | Content |
|------|---------|
| 0 | User number (0–15; $E5=deleted) |
| 1–8 | Filename (8 chars, 7-bit, space-padded) |
| 9–11 | Extension (3 chars, high bits used as attributes) |
| 12 | Extent low (EL) |
| 13 | Reserved (0 for CP/M; byte count for TOS) |
| 14 | Extent high (EH) |
| 15 | Record count (RC) — 128-byte records in this extent |
| 16–31 | Allocation block pointers (8×16-bit or 16×8-bit) |

Block pointer size: 8-bit when total blocks ≤ 255; 16-bit LE otherwise. Extent number = EL + EH × 32; multi-extent files span multiple entries.

#### +3DOS file header (128 bytes, prepended to file data on disk)

| Byte | Content |
|------|---------|
| 0–7 | Signature `"PLUS3DOS"` |
| 8 | $1A (soft-EOF marker) |
| 9 | Issue number |
| 10 | Version number |
| 11–14 | File length (32-bit LE, includes this 128-byte header) |
| 15 | +3 BASIC file type (0=BASIC, 1=Num array, 2=Char array, 3=CODE) |
| 16–17 | Data length (LE) |
| 18–19 | Param 1 (autostart for BASIC, load address for CODE) |
| 20–21 | Param 2 (program body length for BASIC, unused for CODE) |
| 22–126 | Reserved (0) |
| 127 | Checksum (sum of bytes 0–126 mod 256) |

#### DSK format variants

**+3 SS 40T** (Standard Spectrum +3 disk): 40 tracks, 1 side, 9 sectors/track, 512 bytes/sector. Sector IDs $C1–$C9. Total 180 KB. Block size 1024, dir blocks 2, reserved tracks 1. Boot spec type=0.

**+3 DS 80T** (Double-sided +3): 80 tracks, 2 sides, 9 sectors/track, 512 bytes/sector. Sector IDs $C1–$C9. Total 720 KB. Block size 2048, dir blocks 4, reserved tracks 1. Boot spec type=3.

**CPC System SS:** 40 tracks, 1 side, 9 sectors/track, 512 bytes/sector. Sector IDs $41–$49. Total 180 KB. Block size 1024, dir blocks 2, reserved tracks 2. Boot spec type=1.

**CPC System DS:** 80 tracks, 2 sides, 9 sectors/track, 512 bytes/sector. Sector IDs $41–$49. Total 720 KB. Block size 2048, dir blocks 4, reserved tracks 2. Boot spec type=1.

**CPC Data SS:** 40 tracks, 1 side, 9 sectors/track, 512 bytes/sector. Sector IDs $C1–$C9. Total 180 KB. Block size 1024, dir blocks 2, reserved tracks 0. No boot spec (detected by sector ID geometry).

**CPC Data DS:** 80 tracks, 2 sides, 9 sectors/track, 512 bytes/sector. Sector IDs $C1–$C9. Total 720 KB. Block size 2048, dir blocks 4, reserved tracks 0. 16-bit block pointers (360 blocks > 255). No boot spec (detected by sector ID geometry).

**Timex FDD3000 (TOS) 40T:** 40 tracks, 1 side, 16 sectors/track, 256 bytes/sector. Sector IDs $00–$0F. Total 160 KB. Block size 1024, dir blocks 4, reserved tracks 4. Sector skew: `[0,7,14,5,12,3,10,1,8,15,6,13,4,11,2,9]`. No boot spec.

**Timex FDD3000 (TOS) 80T:** 80 tracks, 1 side, 16 sectors/track, 256 bytes/sector. Sector IDs $00–$0F. Total 320 KB. Block size 2048, dir blocks 2, reserved tracks 4. Sector skew as above. No boot spec.

**Timex FDD3000 (TOS) 80T DS:** 80 tracks, 2 sides, 16 sectors/track, 256 bytes/sector. Sector IDs $00–$0F. Total 640 KB. Block size 4096, dir blocks 1, reserved tracks 4. Sector skew as above. No boot spec.

**Timex FDD3000 (CP/M variant):** Same geometry as TOS variants above but with 2 reserved tracks and sector skew 5: `[0,5,10,15,4,9,14,3,8,13,2,7,12,1,6,11]`. Corresponds to cpmtools `fdd3000_2` diskdef. No boot spec.

**Timex FDD3000 (disk label variant):** Same geometry but with 0 reserved tracks and no sector skew (sequential sector order). Directory starts at track 0 with a disk label entry (user byte = $FF) as the first 32-byte entry. The disk label name field typically contains a volume identifier (e.g. "1A DIR"). No boot spec.

**FDD3000 variant auto-detection:** Since none of the FDD3000 variants have a +3DOS boot spec, the variant is detected by probing for valid CP/M directory entries at tracks 0, 2, and 4. A disk label ($FF) as the first entry of track 0 → disk label variant. Valid directory at track 2 but not track 4 → CP/M variant. Otherwise → TOS standard variant.

**Non-standard / copy-protected:** Some games use custom formats (e.g. 1×4096-byte sector per track, no CP/M directory). These have a boot loader in the first sector that the +3 ROM executes directly. May use weak sectors or deliberate CRC errors for copy protection (e.g. Speedlock +3).

#### TOS directory extensions

Timex FDD3000 uses a modified CP/M directory entry layout:
- Byte 12: Part number (extent, single byte — no EH×32 formula)
- Byte 13: Tail (bytes used in last sector, for exact file size)
- Bytes 14–15: Size in half-sectors (sizeHi:sizeLo), file size = value/2 sectors

TOS file headers (prepended to file data, per Tomato FDD3000 tool):
- Type 0 (BASIC): 7 bytes — `type(1) + autostart(2LE) + dataLen(2LE) + basLen(2LE)`
- Types 1–3 (Code/arrays): 5 bytes — `type(1) + dataLen(2LE) + address(2LE)`

Sector skew: DSK images store sectors in physical (interleaved) order. The skew table maps logical sector index → physical sector ID for data reads.

#### Copy protection / weak sectors

**EDSK weak sectors:** When a sector's stored data exceeds nominal size and is an exact multiple, it contains multiple copies. Different bytes across copies form a "weak map" — randomized on each FDC read (FUSE approach).

**CRC error noise:** Applied only when stored data fully covers declared sector size (genuine copy protection). Skipped for oversized-N technique (valid data, CRC error due to size mismatch).

**SK (Skip Deleted) flag:** Read Data/Read Deleted Data honor SK bit. SK=1 skips mark-mismatched sectors; SK=0 reads but sets CM flag and terminates.

#### Known copy protection schemes

DSK images can preserve copy protection through non-standard track layouts, FDC error flags (st1/st2), and embedded signature strings. Common schemes:

| Protection | Identifying traits |
|------------|-------------------|
| Alkatraz | Signature `"THE ALKATRAZ PROTECTION SYSTEM"` in T0/S0. Structural: 18-sector track with 256B sectors |
| Frontier | Signature `"W DISK PROTECTION SYSTEM. (C) 1990 BY NEW FRONTIER SOFT."` in T1/S0. Structural: T9 has 1 sector, T0/S0 dataSize=4096 |
| Hexagon | Signature `"HEXAGON DISK PROTECTION c 1989"` (case variants) in T0–T3. Structural: T0=10 sectors + track with 1 sector fdcSize=6 st1=$20 st2=$60 |
| Paul Owens | Signature `"PAUL OWENS\x80PROTECTION SYS"` in T0 sector index 2. Structural: T0=9 sectors, T1=0 sectors, T2=6 sectors 256B |
| Speedlock | Copyright strings (1985–1990 variants). +3 1987: T0=9sec T1=5sec×1024B, T0/S6 st2=$40, T0/S8 st2=0. +3 1988: same but T0/S8 st2=$40. 1989/1990: T0>7sec T1=1sec ID=$C1 st1=$20 |
| Three Inch | Signature `"***Loader Copyright Three Inch Software 1988"` (4 variants) in T0/S0, T0/S7, or T1/S4 |
| Laser Load | Signature `"Laser Load   By C.J.Pink For Consult Computer    Systems"` in T0 sector index 2 |
| W.R.M | Signatures `"W.R.M Disc"` + `"Protection"` + `"System (c) 1987"` in T8 sector index 9 |
| P.M.S. | Signature `"[C] P.M.S. 1986"` (variants) in T0/S0. Structural: T0 formatted, T1 unformatted, T2 formatted |
| Players | 16-sector track where sector[i].id == sector[i].sizeCode == i |
| Infogrames | T39 has sector with sizeCode=2 but dataSize=540 (oversized) |
| Rainbow Arts | T40 has sector with ID=$C6 st1=$20 st2=$20 |
| Remi Herbulot | Signature `"PROTECTION      Remi HERBULOT"`. Often combined with KBI |
| KBI | Signature `"(c) 1986 for KBI "`. KBI-10 structural: T39=10sec T38=9sec, st1/st2 errors. CAAV variant: `"ALAIN LAURENT GENERATION 5 1989"` |
| DiscSYS | 16-sector track where ID=track=side=index for all sectors. Signatures `"discsys"` or `"MEAN PROTECTION SYSTEM"` |
| Amsoft/EXOPAL | Signatures `"Amsoft disc protection system"` + `"EXOPAL"` in T3/S0 |
| ARMOURLOC | `"0K free"` at offset 2 in T0/S0 |
| Studio B/DiscLoc | Signature `"Disc format (c) 1986 Studio B Ltd."` in T0/S0, `"DISCLOC"` in T2/S0. Structural: T0 formatted, T1 unformatted, T2 formatted |

Some disks combine multiple protections (e.g. Remi Herbulot + KBI). Reference: [DiskImageManager](https://github.com/damieng/DiskImageManager) by Damien Guard.

### 8.6 MGT format (.mgt / .img)

**Geometry:** 80 tracks, 2 sides, 10 sectors/track, 512 bytes/sector. Total: 800 KB (819,200 bytes). Maximum 80 files per disk. Maximum file size: 195 sectors = 99,840 bytes (limited by directory sector map which holds 97 track/sector pairs + partial sector).

File size: 819,200 bytes (80 × 2 × 10 × 512). The `.img` extension is a common alias for the same format. Raw sector dump: track 0 side 0, track 0 side 1, track 1 side 0...

Sector offset: `((track × 2 + side) × 10 + (sector - 1)) × 512`. Sector numbering: 1-based (sectors 1–10).

Directory: tracks 0–1 (both sides), 80 entries × 256 bytes (2 sectors each).

**Directory entry (256 bytes):**

| Offset | Content |
|--------|---------|
| 0 | File type (0=erased, 1=BASIC, 2=NumArr, 3=StrArr, 4=CODE, 5=48K snap, 7=SCREEN$, 9=128K snap, 10=opentype, 11=execute) |
| 1–10 | Filename (10 chars, space-padded) |
| 11 | Number of sectors used |
| 12 | First track |
| 13 | First sector |
| 15–209 | Sector address map (track, sector) pairs — 97 entries |
| 210 | File type (duplicate) |
| 211–212 | Data length (LE) |
| 214–215 | Start address (load addr for CODE, PROG sysvar for BASIC) |
| 216–217 | Type-specific (body length for BASIC, $8000 for CODE) |
| 218–219 | Autostart line (BASIC; $8000 = no autostart) |

File data on disk has a 9-byte +D header: `type(1) + datalen(2 LE) + startAddr(2 LE) + progLen(2 LE) + autostart(2 LE)`

Sector data: 510 data bytes + 2-byte chain pointer (track, sector of next sector in file) at bytes 510–511. Some disks leave sector maps zeroed and use contiguous allocation from firstTrack/firstSector instead.

Single-sided images: 819,200-byte file with side 1 all zeros.

### 8.7 MDR format (Microdrive cartridge)

**Hardware:**
- IF1 ROM: 8KB shadow ROM at $0000–$1FFF
- ROM paging: IN at PC=$0008 (RST 8) or $1708 (CLOSE#); OUT at $0700
- I/O ports: $E7 (data), $EF (status/control), decoded by bits 4:3
- Drive select: COMMS shift register (8 drives max)

**File size:** 137,923 bytes (254 × 543 + 1) or 137,922 (without WP byte)

Structure: 254 sectors × 543 bytes + 1 write-protect flag byte (at end).

**Sector layout (543 bytes):**

Header (15 bytes):

| Offset | Content |
|--------|---------|
| 0 | HDFLAG ($01=header present, $00=free sector) |
| 1 | HDNUMB (sector number, 0–253) |
| 2–3 | Unused |
| 4–13 | HDNAME (cartridge name, 10 chars) |
| 14 | HDCHK (XOR checksum of bytes 0–13) |

Record (528 bytes):

| Offset | Content |
|--------|---------|
| 0 | RECFLG (bit 0: occupied, bit 1: EOF, bit 2: file type) |
| 1 | RECNUM (record number within file, 0-based) |
| 2–3 | RECLEN (data length in this record, LE; max 512) |
| 4–13 | RECNAM (filename, 10 chars) |
| 14 | DESCHK (checksum of record descriptor bytes 0–14) |
| 15–526 | DATA (512 bytes) |
| 527 | DCHK (checksum of data bytes) |

**File reconstruction:**
1. Group all sectors with matching RECNAM
2. Sort by RECNUM ascending
3. Concatenate DATA from each record
4. Trim last record to RECLEN bytes

Free sectors: HDFLAG=0 and RECFLG=0. Cartridge name: from first sector's HDNAME field.

File data includes a 9-byte Spectrum header (same as tape): `type(1) + datalen(2 LE) + param1(2 LE) + param2(2 LE) + checksum(1) + ???(1)` (param1 = autostart for BASIC, start address for CODE).

### 8.8 OPD format (Opus Discovery)

**Hardware:** WD1770 FDC + MC6821 PIA, memory-mapped (not I/O ports)

Memory map (when paged in):

| Address | Content |
|---------|---------|
| $0000–$1FFF | 8KB ROM (read-only) |
| $2000–$27FF | 2KB RAM (read/write) |
| $2800–$2FFF | WD1770 FDC registers (mirrored) |
| $3000–$37FF | MC6821 PIA registers (mirrored) |
| $3800–$3FFF | Unmapped (returns $FF) |

**Geometry:** 40 tracks, 18 sectors/track, 256 bytes/sector, 0-based sector IDs. Single-sided: 180 KB (184,320 bytes). Double-sided: 360 KB (368,640 bytes).

File size: 184,320 bytes (SS) or 368,640 bytes (DS). Raw sector dump. No header or magic bytes — detected purely by file size.

Sector offset: `((track × sides + side) × 18 + sector) × 256`

Directory: sectors 1–7 on track 0 side 0 (16-byte entries). Entry 0 = disk label, entries 1+ = files, terminated when lastBlock == $FFFF.

**Directory entry (16 bytes):**

| Offset | Content |
|--------|---------|
| 0–1 | bytesInLast (LE) — low 12 bits = bytes in last sector minus 1, top 4 bits = system flags |
| 2–3 | firstBlock (LE) — first data block number (0-based from sector 1) |
| 4–5 | lastBlock (LE) — last data block number ($FFFF = end marker) |
| 6–15 | Filename (10 chars, space-padded) |

Image sector = block + 1 (block 0 = sector 1, sector 0 = directory header). Raw file length = `(lastBlock - firstBlock) × 256 + (bytesInLast & $0FFF) + 1`.

File data has a 7-byte header: `type(1) + datalen(2 LE) + param1(2 LE) + param2(2 LE)`. BASIC: param1=autostart, param2=progLength. CODE: param1=startAddr, param2=32768.
