# Pristine (golden) test files

These are **reference files for byte-for-byte comparison**. The idea: build a
disk in *other* software from the Hobeta
sources in `src/`, then `tests/pristine-test.html` extracts each file with
M8XXX's loaders and asserts the payload matches the source exactly. Comparing
against an image written by independent software is what catches real bugs (it's
how the BASIC variables-area truncation was found — see
[`docs/format-references.md`](../../docs/format-references.md) → *BASIC catalogue
convention*).

Missing references are **skipped, not failed**, so the suite is green until you
drop a disk in.

## How to activate

The same seven `src/*.$` files drive every disk set — you just add them to a
disk in another tool and drop the image here:

- **TRD** — in a TR-DOS tool, make a blank TRD, add the seven `src/*.$` Hobeta
  files **in filename order 1 → 7** (the leading digit is the add order), save as
  `tests/pristine/ref-trd-80ds.trd`.
- **DSK (+3)** — in a +3 tool, copy the same seven files' *payloads* onto a +3
  disk, save as `tests/pristine/ref-dsk-80ds.dsk`. +3DOS wraps each in a 128-byte
  header; the harness strips it and compares the payload to the Hobeta source.
- **MGT (+D/G+DOS)** — in a +D tool, add the same seven files, save as
  `tests/pristine/ref-mgt-80ds.mgt`. The loader returns clean payloads (chain
  pointers stripped), compared to the Hobeta sources directly.
- **TAP / TZX** — in a tape tool, append the same seven files' payloads as
  Bytes/Program blocks, save as `tests/pristine/ref-tap.tap` and/or
  `tests/pristine/ref-tzx.tzx`. Each header+data pair is one "file"; data is
  compared byte-for-byte, with CODE load addresses and BASIC program-length/autostart
  checked from the header. (TZX data is read from its Standard/Turbo data blocks.)
- **Didaktik D40/D80 (MDOS)** — in a Didaktik tool, add the same seven files, save as
  `tests/pristine/ref-d80.d80` and/or `ref-d40.d40`. Payloads compared directly; for
  BASIC, MDOS keeps the program length in `basicLength`, autostart in `startAddr`. ⚠️
  **Use the same tool for both** — `rebuildMatch` re-adds via `DidaktikLoader.addFile`,
  which writes directory attribute byte `0x0F` and first-fit allocation; that matches
  the tool that made `ref-d80.d80` but *not* every MDOS tool (e.g. hracka `system.d40`
  uses attr `0x88`), so a D40 from a different tool won't byte-match. The D40 set is
  already wired (it skips until `ref-d40.d40` is supplied).
- **Didaktik blank (`ref-d80-blank.d80`)** — a clean, *empty* MDOS_2 720K format
  (no files), extracted from the EDSK-wrapped `d80/D80_mdos2_dsdd.dsk` in the
  ZX-Spectrum-FD-Images repo (see below). `runBlankD80` asserts
  `DidaktikLoader.createBlankD80('SPECCYPL')` reproduces it **byte-for-byte** — the
  writer check for "create new Didaktik disk". (To regenerate: `gw`-read or extract
  the `.dsk`'s sectors in order to a flat 737280-byte image.)
- **Empty-disk writer blanks** — real externally-formatted *empty* disks that the
  blank-disk writers must reproduce byte-for-byte: `ref-trd-blank.trd` (TR-DOS, label
  "SPECCYPL") for `runBlankTRD` vs `TRDLoader.buildTRD([],…)`; `ref-opd-blank-ss.opd`
  (Opus SS, label "SpeccyPL") for `runBlankOPD` vs `OPDLoader.buildOPD([],…,1)`, and
  `ref-opd-blank-ds.opd` (Opus DS, 80-track 720K) vs `OPDLoader.buildOPD([],…,2)` — all
  from the ZX-Spectrum-FD-Images repo. `ref-d40-blank.d40` (Didaktik 360K, label
  "SYSTEM") for `runBlankD40` vs `DidaktikLoader.createBlankD40` — a real `system.d40`
  (from hracka.org/~mike/d40) neutralised to empty (free its data FAT, blank dir+data to
  0xE5). These confirm the TR-DOS, Opus and D40 blank writers match genuine formats
  (Opus's other ref is M8XXX-built, so this is its first independent writer check).
- **add→delete cycle** (`runDidaktikDeleteCycle` / `runDskDeleteCycle`, no reference
  file) — closes the delete stage of the create→add→read→delete cycle for the in-place
  writers (**Didaktik D40/D80** and **+3 DSK**): on a fresh blank, adding then deleting a
  file must leave 0 files with free space/blocks fully reclaimed (Didaktik also checks a
  sibling file survives intact), and a re-add after delete must **byte-reproduce the
  original add** (delete is a clean inverse for re-use). A direct delete→blank byte-match
  is *not* asserted — delete marks the dir entry deleted (`0x00`/`0xE5`), not the blank's
  fill, and doesn't wipe data (normal for a filesystem delete), so re-add-equality is the
  byte-precise equivalent. Didaktik uses `DidaktikLoader.deleteFile`; +3 uses
  `DSKLoader.deleteFiles`/`deleteFile` (lifted out of the Explorer UI, like `addFile`).
- **OPD (Opus Discovery)** — no third-party Opus *writer* exists, so `ref-opd.opd` is
  built by M8XXX but **cross-validated once with HCDisk** (an independent reader); it
  anchors the OPD read/write round-trip. Rebuild via `OPDLoader.buildOPD` if the
  sources change. (M8XXX now writes the Opus boot descriptor — see the OPD note in
  `docs/format-references.md`.) Note: the OPD *blank* IS independently byte-matched
  (`ref-opd-blank-ss/ds.opd`, FD-Images), but the file-bearing **writer can't be
  byte-matched against an independent disk** — the only one (`z80to/test.opd`) differs
  solely in each CODE file's `param2` header word (Z80to writes `0x0000`, M8XXX the ZX
  tape convention `0x8000`); that 7th header byte is an *undefined/unused* field per the
  Opus format notes, so neither is wrong and the difference is inherent, not a bug.
- **SCL (TR-DOS archive)** — export the seven files as an `.scl` from any TR-DOS tool,
  save as `ref.scl`. SCL shares the TR-DOS catalogue layout (no sysinfo sector).
- **MDR (Microdrive)** — `ref-mdr.mdr` is M8XXX-built (`MDRLoader.buildMDR`); its
  *reader* is independently validated by the Z80to cross-read below, so this round-trip
  set anchors writer+reader together. MDR is **not** byte-matched against an external
  image *by design*: a Microdrive cartridge is a loop of self-describing records (each
  carries its own sector/file header + checksums), so record placement around the loop
  is free — a correct writer needn't reproduce another tool's ordering byte-for-byte, so
  a byte-match would test incidental layout, not correctness.
- **EDSK (+3 Extended DSK)** — `ref-edsk-40ss.dsk` is a real, independently-created
  Extended CPC DSK (40T SS, CPC-data format) holding the 7 sources, exercising the
  variable-track-size parse path against genuine third-party output. Its directory also
  carries a +3DOS disc-specification record in slot 0 (control-byte filename), which the
  CP/M reader skips — surfacing/closing a reader robustness gap.

Reference images are named `ref-<format>-<geometry>.<ext>` (e.g. `80ds` =
80-track double-sided), so each is self-identifying; add new geometries under
their own name.

Then open `tests/pristine-test.html` via a web server. Missing images are
skipped, so you can supply just one.

The registry at the top of `pristine-test.html` (`PRISTINE_SETS`) holds one entry
per disk: `disk` path, `diskType`, `expectDisk` (disk metadata — label, geometry,
…), and `sources` with optional per-file `expect` (catalogue fields not in the
Hobeta, e.g. start track/sector, `plus3Type`, `dataLength`).

## Which geometries to test

Don't build a full matrix (40/80 × SS/DS × standard/EDSK). The synthetic suites
(`loader-test`, `fdc-test`) already exhaust format permutations; pristine's job is
"does M8XXX match what *real* tools write," so a few representative images are
enough. TRD geometry doesn't change the catalog/extract path (only the disk-type
byte and free-sector count differ); DSK is where variants matter (standard vs
**EDSK**, side count). Add a new geometry only when you actually use it or hit a
bug — name it by format+geometry (e.g. `ref-trd-40ss.trd`, `ref-edsk.dsk`), give
it its own registry set, and **assert the geometry in `expectDisk`** so the file
is self-identifying and a misread fails loudly.

## Testing real-world images (cross-check, no known sources)

The golden method above needs files *you* put on the disk. To check M8XXX against
a **real** image full of unknown content (a game disk, a system disk), you can't
byte-compare against a known source — instead **cross-check M8XXX's reading
against an independent tool** on the same image. If both list the same files with
the same block ranges / sizes / addresses (and extract identical bytes), M8XXX
reads it correctly — and because the other tool isn't M8XXX, it isn't circular.

Real images to test with, e.g. <https://github.com/konkotgit/ZX-Spectrum-FD-Images>
(TRD, MGT, DSK, OPD, D80, …). These are Gotek/FlashFloppy-prepared (curated /
tool-made), so treat agreement as **corroboration, not hardware-conformance proof**
(same caveat as in [`docs/format-references.md`](../../docs/format-references.md)).

**Method**

1. Read the image with M8XXX — in the Explorer (open it, read the catalog / extract
   files), or a throwaway headless page that calls the loader's `listFiles` /
   `extractFile` (DSK: `parse` → `listFiles(img)` → `readFileData`; tape: walk
   blocks). See how `pristine-test.html` does each.
2. Read the same image with an independent tool (below).
3. Compare the catalog (names, block/sector ranges, lengths, load addresses) and,
   where the tool can extract, the file bytes.

**Independent reader per filesystem**

| Filesystem | Independent reader |
|------------|--------------------|
| TR-DOS (TRD/SCL) | zxspectrumutils; any TR-DOS tool / emulator catalog |
| +D / G+DOS (MGT) | a +D tool / emulator |
| +3DOS (DSK) | CPCDiskXP, SAMdisk, a +3 emulator |
| Opus (OPD) | `opustools` `ODIR.EXE` (dir) + `EXTRACT.EXE` (files), run in DOSBox — read-only |
| Didaktik MDOS (D40/D80) | zxspectrumutils `dird80` / `d802tap` |
| TAP / TZX | ZX-Blockeditor, `tzxlist` |

**[HCDisk](https://github.com/0sAND1s/HCDisk)** (Windows CLI) is a single modern
reader covering most of the above — TR-DOS, +D, **Opus (OPD)**, +3DOS, DSK/EDSK,
SCL, TAP/TZX — so it's the easiest cross-check tool when you don't want DOSBox.
(It's read-only for TR-DOS/+D/Opus, so it can list/extract those but not *create*
golden images for them; +3/CP/M and TAP/TZX are read-write.)

**Example (OPD).** With HCDisk: catalog the image and dump a file, then compare to
M8XXX. Or with `opustools`: run `ODIR <image>` in DOSBox and note its
`name / 1stblock / lastblock / blocks / filelen` table; list the same image with
M8XXX's `OPDLoader.listFiles` (`name`, `firstBlock`, `lastBlock`, `sectors`) and
diff. Block ranges and names must match exactly. File length has a known
interpretation nuance — `ODIR` uses `bytes_in_last_block` raw, M8XXX uses the
Opus-manual reading `(bytes_in_last & 0x0FFF) + 1` — so a 1-byte/high-bit gap there
is expected and tells you which the disk actually uses, not a catalog bug.

## Independent-writer cross-read (`z80to/`)

`z80to/` holds disk images written by **Z80to** (Tom Dalby — a separate codebase),
generated by converting `z80to/test.z80`:

```
z80to -o test.z80   → test.opd   (Opus)
z80to -m test.z80   → test.mdr   (Microdrive)
z80to -r test.z80   → test.trd   (TR-DOS)
z80to -p test.z80   → test.mgt   (+D)
```

Z80to writes a bootable loader (`run`/`test`), screen (`tes.0`) and compressed
memory (`tes.M`), so there are no byte-compare sources — these sets use the
registry's **`expectFiles`** mode instead: assert the catalogue M8XXX reads (name,
ext, length) and that each file extracts. This is the **non-circular reader check
for OPD** (no third-party Opus *writer* exists otherwise — `ref-opd.opd` is
M8XXX-built) and the **only MDR coverage** in the suite. To refresh, re-run Z80to
on `test.z80` and update the `expectFiles` lengths if its loader output changes.

## Source files (`src/`)

Hobeta (`.$`) = 17-byte header + payload. CODE uses bytes 9-10 = load address,
11-12 = length. BASIC uses bytes 9-10 = **total** length (program + variables),
11-12 = **program** length (offset where the variables area begins).

| File | Type | Payload | Purpose |
|------|------|--------:|---------|
| `1TINY100.$c` | CODE, load `0xA000` | 100 B | tiny file, partial sector |
| `2FULL256.$c` | CODE, load `0x9000` | 256 B | exactly one full sector |
| `3PART700.$c` | CODE, load `0x8000` | 700 B | spans sectors, partial last |
| `4FULL512.$c` | CODE, load `0xC000` | 512 B | exactly two full sectors |
| `5BIG4000.$c` | CODE, load `0x8000` | 4000 B | multi-sector, crosses a track |
| `6BASPROG.$b` | BASIC | 42 B | **program only** (total 42 = progLen 42, no variables) |
| `7BASVARS.$b` | BASIC | 100 B | **program + variables area** (total 100, progLen 85, 15-byte vars) |

CODE payloads: the first 8 bytes are the ASCII name as a tag, the rest a
deterministic pattern (so a mismatch is easy to read in a hex dump).

### The two BASIC samples

Both hold this program:

```
10 REM M8XXX GOLDEN
20 LET a=100
30 LET b=5
40 LET c$="GOLD"
50 PRINT a;b;c$
60 PRINT x$
```

- **`6BASPROG.$b`** — a *shorter* program-only sample (no variables area;
  `total == progLen`). It is the baseline for "BASIC without variables".
- **`7BASVARS.$b`** — the program above **plus a variables area** holding a single
  variable: **`x$ = "ZX Spectrum"`** (encoded `58 0B 00 …` = string var `x`,
  length 11, the text, then the `0x80` end-of-variables marker).

  Why only `x$`? The numeric `a`/`b` and string `c$` are created by the program's
  `LET` lines **only when it RUNs**. The saved variables area is a snapshot of
  memory *at save time*; this sample represents "type the program, assign
  `x$` at the keyboard, SAVE without running" — so the keyboard-typed `x$` is the
  only variable present, exactly the program-vs-variables distinction these files
  exist to test.

Regenerate them with the helper used to author them if you need to tweak the
content (program lines, variable set) — the Hobeta CRC is
`(257 * sum(header[0..14]) + 105) & 0xFFFF`.
