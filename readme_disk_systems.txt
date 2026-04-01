================================================================================
ZX-M8XXX — Disk Systems Reference
================================================================================

This file covers the five disk/storage interfaces supported by the emulator:
Beta Disk (TR-DOS), +3 DOS (µPD765 FDC), DISCiPLE/+D (GDOS), Interface 1 (Microdrive),
and Opus Discovery (OPD).


================================================================================
1. BETA DISK — TR-DOS  (TRD / SCL files)
================================================================================

SETUP
-----
- Pentagon / Scorpion: Beta Disk is always enabled (built-in).
- 48K / 128K / +2: Enable in Settings → Machines → "Beta Disk (TR-DOS)".
  Requires trdos.rom to be loaded (via ROM dialog or Settings → Load ROMs).
- Auto Load (Settings → Media): When enabled, loading a TRD/SCL file
  automatically boots into TR-DOS and runs the boot file.

ENTERING TR-DOS
---------------
From BASIC prompt:

  RANDOMIZE USR 15616           — Enter TR-DOS command line

The TR-DOS command line shows the drive letter prompt (e.g. "A>").

LOADING FILES
-------------
From TR-DOS command line:

  LIST                          — List files on disk
  LOAD "filename"               — Load and run BASIC program
  LOAD "filename" CODE          — Load CODE file to its saved address
  LOAD "filename" CODE 40000    — Load CODE file to address 40000
  RUN "filename"                — Same as LOAD for BASIC files
  RUN                           — Run the file named "boot" (type B, BASIC)

From 48K BASIC (without entering TR-DOS):

  RANDOMIZE USR 15619: REM: LOAD "filename"
  RANDOMIZE USR 15619: REM: LOAD "filename" CODE

USR 15619 executes a single TR-DOS command given after REM:.
If the loaded BASIC program has an autostart line, it will run immediately.

SAVING FILES
------------
From TR-DOS command line:

  SAVE "filename"               — Save current BASIC program
  SAVE "filename" LINE 10       — Save BASIC with autostart at line 10
  SAVE "filename" CODE 30000,2048   — Save memory block as CODE
  SAVE "filename" DATA a()      — Save numeric array
  SAVE "filename" DATA a$()     — Save string array

MANAGING FILES
--------------
  ERASE "filename"              — Delete file
  MOVE "old","new"              — Rename file (some TR-DOS versions)

FILE TYPES
----------
  B  — BASIC program
  C  — CODE (machine code / data block)
  D  — Data array (numeric or string)
  #  — Sequential file (stream I/O)

DISK GEOMETRY
-------------
  80 tracks, 2 sides, 16 sectors/track, 256 bytes/sector
  Total: 640 KB (655,360 bytes)
  Maximum 128 files per disk

MULTI-DRIVE
------------
4 drives supported (A-D). Select target drive in Settings → Media dropdown
before loading a disk image. From TR-DOS:

  *"B:"                         — Switch default drive to B
  CAT "B:"                      — List files on drive B
  LOAD "B:filename"             — Load from drive B (temporary)
  LOAD "B:filename" CODE        — Load CODE from drive B
  SAVE "B:filename"             — Save to drive B


================================================================================
2. +3 DOS — µPD765 FDC  (DSK files)
================================================================================

SETUP
-----
- Only available on the +3 machine type.
- Select "+3" from the machine dropdown (requires plus3.rom).
- Auto Load: When enabled, loading a DSK file resets the +3 and presses
  Enter at the Amstrad menu, selecting "Loader" which auto-detects the disk.

LOADING
-------
The +3 ROM handles disk boot automatically:
1. Load a DSK file into the emulator
2. Reset (or let auto-load do it)
3. At the Amstrad menu, press Enter (selects "Loader")
4. The ROM reads the boot sector and runs the disk

From +3 BASIC (disk is the default device):

  CAT                           — List files on disk
  LOAD "filename"               — Load BASIC program from disk
  LOAD "filename" CODE          — Load CODE file from disk
  LOAD "filename" CODE 40000    — Load CODE to specific address
  LOAD "filename" SCREEN$       — Load screen data
  LOAD "filename" DATA a()      — Load array

From tape (must switch to tape first):

  LOAD "T:"                     — Switch LOAD to tape
  LOAD ""                       — Load next program from tape
  LOAD "filename"               — Load named program from tape
  LOAD "A:"                     — Switch LOAD back to disk

SAVING
------
To disk (default):

  SAVE "filename"               — Save BASIC program to disk
  SAVE "filename" CODE 30000,2048   — Save CODE block to disk
  SAVE "filename" SCREEN$       — Save screen
  SAVE "filename" DATA a()      — Save array

To tape (must switch to tape first):

  SAVE "T:"                     — Switch SAVE to tape
  SAVE "filename"               — Save to tape
  SAVE "A:"                     — Switch SAVE back to disk

MANAGING FILES
--------------
  CAT                           — Directory listing
  ERASE "filename"              — Delete file
  MOVE "old" TO "new"           — Rename file

The +3 uses CP/M-compatible directory format internally. Files have
8.3 filenames (8-char name + 3-char extension). +3DOS headers (128 bytes)
store the ZX Spectrum file type, load address, and length.

WRITE PERSISTENCE
-----------------
Games can save to disk. All writes are preserved in memory and included
in project saves. Use Save → DSK to download the modified disk image.

DISK GEOMETRY
-------------
  Standard: 40 tracks, 1 side, 9 sectors/track, 512 bytes/sector
  Total: 180 KB (184,320 bytes)
  Some games use non-standard formats (custom sector sizes, track counts).

DRIVE LETTERS
-------------
The +3 uses drive letter prefixes to select the storage device:

  A:  — Built-in disk drive (default)
  B:  — External disk drive
  T:  — Tape
  M:  — RAMdisk

By default, LOAD and SAVE operate on disk (A:). To switch to tape:

  LOAD "T:"                     — Switch LOAD/MERGE to tape
  SAVE "T:"                     — Switch SAVE to tape

After this, all subsequent LOAD/SAVE commands use tape until switched back:

  LOAD "A:"                     — Switch LOAD/MERGE back to disk
  SAVE "A:"                     — Switch SAVE back to disk

Example — copy a BASIC program from tape to disk:

  LOAD "T:"                     — Switch to tape
  LOAD ""                       — Load next program from tape
  SAVE "A:"                     — Switch to disk
  SAVE "filename"               — Save to disk

Note: CAT, ERASE, MOVE, and COPY always operate on the disk drive,
regardless of the T:/A: setting.

MULTI-DRIVE
------------
2 drives (A-B). Select target drive in Settings → Media dropdown.


================================================================================
3. DISCiPLE / +D — GDOS  (MGT files)
================================================================================

SETUP
-----
- Enable in Settings → Machines → "+D Interface (MGT)".
- Requires plusd.rom to be loaded (via ROM dialog or "Load +D ROM" button
  in Settings → Machines).
- Works with any machine type (48K, 128K, +2, Pentagon, etc.).
- The +D is an external interface that pages its own ROM/RAM over the
  Spectrum's address space when active.

USING THE +D
-------------
The +D is activated via the NMI button (snapshot button on the real hardware):

1. Click "NMI" button in Settings → Machines
2. The +D ROM pages in and the CPU jumps to address $0066
3. The +D menu appears on screen

From the NMI menu you can save snapshots, catalog disks, and manage files.

LOADING FILES FROM BASIC
-------------------------
The +D extends BASIC with new commands (processed by the +D ROM when it
intercepts the BASIC error handler):

  CAT 1                         — Catalog drive 1 (A)
  CAT 2                         — Catalog drive 2 (B)
  LOAD d1"filename"             — Load from drive 1
  LOAD d2"filename"             — Load from drive 2
  LOAD d1"filename" CODE        — Load CODE file
  LOAD d1"filename" CODE 40000  — Load CODE to address
  LOAD d1"filename" SCREEN$     — Load screen
  LOAD d1"filename" DATA a()    — Load array

SAVING FILES FROM BASIC
------------------------
  SAVE d1"filename"             — Save BASIC program
  SAVE d1"filename" CODE 30000,2048   — Save CODE block
  SAVE d1"filename" SCREEN$     — Save screen
  SAVE d1"filename" DATA a()    — Save array

MANAGING FILES
--------------
  CAT 1                         — Directory listing
  ERASE d1"filename"            — Delete file

FILE TYPES
----------
  1   BASIC       — BASIC program
  2   Num Array   — Numeric array
  3   Str Array   — String array
  4   CODE        — Machine code / data
  5   48K Snap    — 48K snapshot (via NMI button)
  7   SCREEN$     — Screen dump (6912 bytes)
  9   128K Snap   — 128K snapshot
  10  Opentype    — Sequential access file
  11  Execute     — Auto-run CODE file

DISK GEOMETRY
-------------
  80 tracks, 2 sides, 10 sectors/track, 512 bytes/sector
  Total: 800 KB (819,200 bytes)
  Directory: tracks 0-1 (both sides) = 80 entries
  Data area: tracks 2-79 = 1560 sectors available
  Maximum 80 files per disk
  Maximum file size: 195 sectors = 99,840 bytes (limited by directory
  sector map which holds 97 track/sector pairs + partial sector)

MULTI-DRIVE
------------
2 drives (A-B). Select target drive in Settings → Media dropdown.

NMI SNAPSHOT
-------------
The +D's NMI button was the primary feature of the DISCiPLE/+D interface.
Pressing it during a game saves a complete snapshot to disk. This works
because the NMI is non-maskable — the running program cannot prevent it.

Note: The +D ROM must be loaded and the interface must be enabled for
the NMI button to work. Without the ROM, the NMI has no handler code.


================================================================================
4. INTERFACE 1 / MICRODRIVE
================================================================================

The Interface 1 was Sinclair's first mass storage device, using Microdrive
tape-loop cartridges. Each cartridge holds up to 254 sectors of 512 bytes
(approximately 128KB). Files are stored as linked sector chains.

SETUP:
- Enable "Interface 1 (Microdrive)" in Settings → Machines
- Load if1.rom (8KB Interface 1 ROM)
- Load .mdr cartridge files via the file loader
- Note: IF1 conflicts with +D interface (cannot use both simultaneously)
- Compatible with: 48K, 128K, +2, Pentagon (NOT +2A/+3)

BASIC COMMANDS:
  CAT 1                  — List files on Microdrive 1
  LOAD *"m";1;"name"     — Load program "name" from Microdrive 1
  SAVE *"m";1;"name"     — Save program "name" to Microdrive 1
  ERASE "m";1;"name"     — Erase file "name" from Microdrive 1
  FORMAT "m";1;"label"   — Format Microdrive 1 cartridge with label
  MOVE "m";1;"n1" TO "m";2;"n2"  — Copy file between drives

TECHNICAL DETAILS:
- MDR file size: 137,923 bytes (254 × 543 + 1 write-protect byte)
- IF1 ROM: 8KB shadow ROM at $0000-$1FFF
- ROM paging: IN at PC=$0008 (RST 8) or $1708 (CLOSE#); OUT at $0700
- I/O ports: $E7 (data), $EF (status/control), decoded by bits 4:3
- Up to 8 Microdrives supported via COMMS shift register


================================================================================
5. OPUS DISCOVERY  (OPD / OPU files)
================================================================================

The Opus Discovery was a disk interface for the ZX Spectrum using the
WD1770 floppy disk controller and MC6821 PIA, with 8KB ROM and 2KB RAM.
Unlike other Spectrum disk interfaces, all hardware registers are
memory-mapped (not I/O ports).

SETUP:
- Enable "Opus Discovery" in Settings → Machines
- Load opus.rom (8KB Opus Discovery ROM)
- Load .opd or .opu disk images via the file loader
- Note: Opus conflicts with +D interface (both overlay $0000-$3FFF)
- Compatible with: 48K, 128K, +2, Pentagon (NOT +2A/+3)
- No conflict with IF1 or Beta Disk

BASIC COMMANDS (Microdrive-compatible syntax):
  CAT 1                      — List files on drive 1
  LOAD *"m";1;"name"         — Load program from drive 1
  SAVE *"m";1;"name"         — Save program to drive 1
  MOVE "d";1 TO "d";2        — Copy entire disk (drive 1 → drive 2)
  OPEN # 4,"m";1;"filename"  — Open file on drive 1 for I/O
  OPEN # 3;"t"               — Open printer channel

NMI BUTTON:
The NMI button pages in the Opus ROM and triggers the Z80 NMI (PC→$0066).
This gives access to the Opus snapshot/catalog menu.

DISK GEOMETRY:
  40 tracks, 18 sectors/track, 256 bytes/sector, 0-based sector IDs
  Single-sided: 180 KB (184,320 bytes)
  Double-sided: 360 KB (368,640 bytes)
  Sector offset: ((track × sides + side) × 18 + sector) × 256

MEMORY MAP (when paged in):
  $0000-$1FFF  8KB ROM (read-only)
  $2000-$27FF  2KB RAM (read/write)
  $2800-$2FFF  WD1770 FDC registers (mirrored)
  $3000-$37FF  MC6821 PIA registers (mirrored)
  $3800-$3FFF  Unmapped (returns $FF)

MULTI-DRIVE:
2 drives (A-B). Select target drive in Settings → Media dropdown.


================================================================================
6. COMMON NOTES
================================================================================

AUTO LOAD
---------
Settings → Media → "Auto Load" checkbox controls automatic loading:
- TAP/TZX: Types LOAD "" and flash-loads
- TRD/SCL: Boots into TR-DOS (runs boot file if present)
- DSK: Resets +3, presses Enter at menu (ROM auto-detects disk)
- MGT: Disk is inserted but must be accessed manually (use NMI or
  BASIC commands above)
- MDR: Cartridge is inserted but must be accessed manually (use
  Interface 1 BASIC commands above)
- OPD: Disk is inserted but must be accessed manually (use NMI or
  Opus BASIC commands above)

DRIVE SELECTOR
--------------
When a disk is loaded, the drive selector appears in Settings → Media.
Choose drive A/B/C/D before loading a disk image to insert it into
a specific drive.

MEDIA CATALOG
-------------
Settings → Media shows the loaded media catalog:
- Tape tab: block listing with playback position
- Disk tab: file listing per drive, with sub-tabs for each controller
  when multiple disk interfaces are active simultaneously

When multiple controllers have disks (e.g., Beta Disk + +D), drive tabs
use prefixed labels: TRD:A, MGT:A, 3DOS:A, MDR:1 etc.

EXPLORER
--------
Tools → Explorer can open and analyze any disk image:
- View file listings with type, size, address info
- Extract individual files (BASIC viewer, hex dump, disassembly)
- Edit tab: create, modify, and save disk images in all formats
- Copy files between formats (TAP ↔ TRD ↔ MGT ↔ DSK ↔ MDR ↔ OPD)

PROJECT SAVE
------------
Save → Project preserves all loaded media (tape + all disk drives from
all controllers). The project file includes the full disk images encoded
as base64, so no data is lost when saving and reloading a session.
