# File-Format Authoritative Sources

Reference list of the authoritative sources used to verify M8XXX's file-format
implementations (loaders/writers in `core/loaders.js`, `core/fdc.js`,
`core/asm-detok.js`). Recorded during the format audit so future checks start
from the same references rather than re-deriving them.

Two disk formats were additionally cross-checked **against real-world disk
images** (useful since no mainstream emulator parses these catalogs):
**MGT/+D G+DOS** and **Didaktik D40/D80** — both list files correctly and extract
byte-accurately.

**Provenance caveat:** an image only proves conformance if it was written by
*genuine period hardware* — a modern tool-created image can share the same
layout assumptions (or reverse-engineering lineage) as M8XXX, making "reads
correctly" circular. Of the images used, only **`Outlet (Issue 027).mgt`** (a
period +D disk-magazine) has strong provenance; the `plusd_gdos_*` images and
`DonkeyKong.d80` are likely tool-created (weaker corroboration). So treat this as
*strong corroboration*, not hardware-conformance proof — a genuine
original-hardware disk per format would be needed for the latter.

## BASIC catalogue convention (TRD / SCL / Hobeta)

In a TR-DOS catalogue entry (and the Hobeta header, which mirrors it) the two
16-bit words at offsets 9-10 and 11-12 mean **different things by file type**:

| Bytes | CODE (and others) | BASIC (type `B`) |
|-------|-------------------|------------------|
| 9-10  | start/load address | **total length** (program + variables) |
| 11-12 | data length | **program length** (offset where variables begin) |

So for a BASIC file the number of data bytes to extract is in **9-10**, and the
variables area is `total − programLength` bytes after the program. Reading 11-12
as the length (the CODE rule) **truncates the variables** — a real bug M8XXX had
until it was fixed across `TRDLoader`/`SCLLoader`, `fileToTAP`, both `parseHobeta`
and `buildHobeta`, and the Explorer editor (`trdEntryFields`/`trdEntryWords`).
Confirmed against the Sinclair Wiki *TR-DOS filesystem* page and the Kaitai
`tr_dos_image` spec (`program_and_data_length` @9-10, `program_length` @11-12);
covered by a round-trip test (`loader-test` TRD BASIC-with-vars, `convert-test`
Hobeta BASIC).

## Access caveats (as of the audit)

- **GitLab** (`gitlab.com/fuse-emulator/*`) blocks anonymous raw fetches — it
  prompts for sign-in / card verification. libspectrum and FUSE source are still
  the authority, but must be read in a browser, not fetched programmatically.
- **SourceForge** raw view works: append `?format=raw` to a file URL.
- Some **World of Spectrum** mirrors (`worldofspectrum.net`) intermittently
  return HTTP 403 to automated fetches; the `worldofspectrum.org/faq/reference/`
  pages were reachable.
- For byte-layout/algorithm questions, a **published spec is as authoritative as
  libspectrum's source** — libspectrum implements those same specs.

## Sources by format

The **How checked** column records what actually happened during the audit, since
not every canonical source was reachable. Legend:
🟢 fetched/read this audit and compared byte-for-byte ·
⚪ compared against the canonical spec from established knowledge (not fetched this audit) ·
🟡 only partially reachable — some details confirmed, others left unverified ·
🔴 source inaccessible this audit (verification from knowledge + code consistency only).

| Format | Authoritative source(s) | Location | How checked |
|--------|------------------------|----------|-------------|
| **.z80** snapshot | World of Spectrum — *Z80 format* reference | https://worldofspectrum.org/faq/reference/z80format.htm | 🟢 fetched — confirmed byte-12==255 rule, v1-only end-marker, 1FFD@86 needs len==55 |
| **SZX** snapshot | Spectaculator — *zx-state (SZX) file format*, `ZXSTZ80REGS` chunk | https://www.spectaculator.com/docs/zx-state/z80regs.shtml | 🟢 fetched — confirmed `chFlags`@34, `ZXSTZF_HALTED`=2 |
| **SNA** snapshot | World of Spectrum — file formats FAQ | https://rk.nvg.ntnu.no/sinclair/faq/fileform.html | ⚪ from spec knowledge |
| **TZX** tape | TZX 1.20 specification (Tomaž Kac / WoS) | https://worldofspectrum.net/TZXformat.html | ⚪ from spec knowledge (1.20 block table); site 403'd to fetch |
| **RZX** input recording | Ramsoft — *RZX file format specification* | https://worldofspectrum.net/RZXformat.html | 🔴 inaccessible (403 / conn refused) — core verified from knowledge + code; creator-version & external-snapshot items left **unconfirmed/flagged** |
| **TR-DOS / TRD** | zxspectrumutils `trdos_structure.h` (info-sector offsets); Sinclair Wiki *TR-DOS filesystem* + Kaitai `tr_dos_image` (catalogue entry) | https://sourceforge.net/p/zxspectrumutils/code/HEAD/tree/trunk/src/trdos_structure.h?format=raw · https://sinclair.wiki.zxnet.co.uk/wiki/TR-DOS_filesystem · https://formats.kaitai.io/tr_dos_image/ | 🟢 fetched — see **BASIC catalogue convention** below |
| **SCL** | Spectrum FAQ file formats (SINCLAIR sig + 14-byte dir + 32-bit checksum) | https://rk.nvg.ntnu.no/sinclair/faq/fileform.html | ⚪ from spec knowledge (same 9-10/11-12 entry layout as TRD — BASIC convention applies) |
| **Hobeta** ($-file) | zxspectrumutils `hobeta2trd.c` (17-byte header offsets) | https://sourceforge.net/p/zxspectrumutils/code/HEAD/tree/trunk/src/hobeta2trd.c?format=raw | 🟢 fetched — header mirrors the TRD catalogue entry, so the BASIC convention applies |
| **Didaktik MDOS (D40/D80)** | zxspectrumutils `d802tap.cpp`, `dird80.c` (read), `tap2d80.cpp` (write) | https://sourceforge.net/p/zxspectrumutils/code/HEAD/tree/trunk/src/ | 🟢 fetched (all three) + cross-checked against a real-world `DonkeyKong.d80` (5 files listed, byte-accurate extraction, `run` = `LOAD *"DK"`) — modern/tool-created image, so corroboration not hardware proof (see provenance caveat); writer round-trip tested |
| **MDR (Microdrive)** | Spectrum FAQ file formats; *ZX Microdrive internal format* (Spectrum Computing) — checksum = sum mod 255; RECFLG bit 1 = EOF, bit 2 = SAVE-vs-PRINT | https://rk.nvg.ntnu.no/sinclair/faq/fileform.html · https://spectrumcomputing.co.uk/forums/viewtopic.php?t=12229 | 🟢 via web search (FAQ + forum content); the zxnet MDR wiki itself 404'd; libspectrum `microdrive.c` was the intended source but GitLab blocked it |
| **DSK / EDSK container** | CPCWiki — *Disk image file format* (canonical) | https://www.cpcwiki.eu/index.php/Format:DSK_disk_image_file_format | ⚪ from spec knowledge (CPCWiki DSK layout) |
| **+3DOS filesystem** | Amstrad/Locomotive *+3DOS* technical spec; ZX Spectrum +3 manual appendix (PLUS3DOS header, CP/M directory) | ZX Spectrum +3 manual; mirrored on CPCWiki | ⚪ from spec knowledge |
| **MGT (+D / DISCiPLE, G+DOS)** | Sinclair Wiki — *MGT filesystem* (directory layout, SAM bitmap formula, sector chain) and *MGT format* (image container, alt vs out-out ordering). Geometry also corroborated by MAME `bus/spectrum/mgt.cpp` (controller-only, no catalog parsing — points to the same wiki) | https://sinclair.wiki.zxnet.co.uk/wiki/MGT_filesystem · https://sinclair.wiki.zxnet.co.uk/wiki/MGT_format · https://github.com/mamedev/mame/blob/master/src/devices/bus/spectrum/mgt.cpp | 🟢 fetched + cross-checked against real-world +D/G+DOS images — incl. the period *Outlet* disk-magazine (strong provenance) plus tool-created `plusd_gdos_*` images (24 and 5 files listed, byte-accurate extraction; corroboration, see provenance caveat). Confirmed: dir entry (type@0, name@1-10, big-endian sector count@11-12, track@13 side-in-bit7, sector@14); SAM@15-209 is a 1560-bit **bitmap**, bit0 = logical track 4 (cyl2/side0) sector 1, index `(logicalTrack-4)*10+(sector-1)`; files chained via last-2-bytes (next track,sector; 0,0=end); directory at logical tracks 0-3 (cyl0-1, both sides) |
| **OPD (Opus Discovery)** | Sinclair Wiki — *OPD format* (geometry: 18 SPT, 256 BPS, SS 184320 / DS **737280** — the real Opus DS DD is 80-track, confirmed against the ZX-Spectrum-FD-Images greaseweazle blanks + diskdefs; M8XXX derives track count from image size; alternating-side track order). Catalog layout per the Opus Discovery Manual + the WoS *Opus Discovery disk utilities* (`EXTRACT.C`), both cited in M8XXX's code: sector 0 descriptor, directory sectors 1-7 (16-byte entries: bytesInLast@0-1, firstBlock@2-3, lastBlock@4-5, name@6-15, LE), contiguous block allocation, 7-byte file header (type/length/param1/param2) | https://sinclair.wiki.zxnet.co.uk/wiki/OPD_format · https://worldofspectrum.net/legacy-info/opus-discovery-disk-utilities/ · https://spectrumcomputing.co.uk/pub/sinclair/hardware-info/o/OpusDiscovery_Manual.pdf | 🟢 — geometry fetched & confirmed; catalog **cross-checked against the Opus disk-utilities C source** (`opustools`: `OPUS.TXT`, `READOPUS.H`, `ODIR.C`, `OPUS2B.C`). Confirms the 16-byte dir entry (bytesInLast@0-1, firstBlock@2-3, lastBlock@4-5, name@6-15) and that the ints are **little-endian** — `ODIR.C` `fread`s entries straight into a `struct direntry` on 16-bit x86, so `OPUS.TXT`'s "big-endian" prose is a mislabel (its "(Intel like)" aside means LE); M8XXX reads LE, matching. File header = `type(1) + len(2 LE) + start(2 LE) + 1 unknown` (`OPUS.TXT`'s "6 or 7 byte" header = struct padding), per `OPUS2B.C`'s `opusheader`. Also **verified by build→read round-trip test**. **Writer cross-checked with HCDisk** on a real blank Opus disk: this exposed that M8XXX left **sector 0 (the Opus boot descriptor) zeroed** — its own reader and `opustools` skip sector 0, but HCDisk (and real Opus) require it. Fixed: `createBlankOPD`/`buildOPD` now embed the geometry-specific boot sector + directory skeleton (label entry `255,0,6`; terminator `255, totalSectors−1, 0xFFFF`; `0xE5` fill), and HCDisk now reads an M8XXX-built OPD correctly (names/types/load addresses/lengths). Note: Opus has no BASIC program/variables split in the file header (HCDisk shows `VarLen=0`), unlike TR-DOS/tape. **Reader also cross-validated non-circularly**: an OPD written by **Z80to** (Tom Dalby — different author/codebase) lists + extracts correctly in M8XXX (`run`/`tes.0`/`tes.M`); same confirmed for M8XXX's MDR/TRD/MGT readers against Z80to output. |

## Reference codebases (read in browser; not directly fetchable)

| Project | Covers | Location |
|---------|--------|----------|
| **libspectrum** | Snapshots (z80, szx, sna), tape (tzx, tap), `microdrive.c` (MDR), `rzx.c` | https://gitlab.com/fuse-emulator/libspectrum |
| **FUSE** | Disk-image *geometry* in `disk/disk.c` (TRD/MGT/DSK/OPD). Note: FUSE emulates the disk controller and lets the ROM walk the filesystem, so it does **not** parse the on-disk catalogs (G+DOS / +3DOS / Opus / MDOS directories) | https://gitlab.com/fuse-emulator/fuse |
| **zxspectrumutils** | Conversion tools: D40/D80, Hobeta, TR-DOS, MBD (Microdrive Backup Device — a different format from `.mdr`) | https://sourceforge.net/p/zxspectrumutils/code/HEAD/tree/trunk/src/ |
| **opustools** (WoS Opus disk utilities) | OPD catalog + file header C source (`OPUS.TXT`, `READOPUS.H`/`.C`, `ODIR.C`, `OPUS2B.C`, `EXTRACT.C`) — read locally; read-only tools (no OPD writer) | https://worldofspectrum.net/legacy-info/opus-discovery-disk-utilities/ |

> **Catalog vs. geometry:** for disk formats, libspectrum/FUSE validate the
> *image/byte layout and geometry* but not the *filesystem catalog* M8XXX's
> Explorer parses. Catalog correctness is verified against the format specs above
> (and, for the writers, ideally round-tripped against real disks / a strict
> emulator).
