# The embeddable player

`player.html` is ZX-M8XXX without the rest of the app: one program, no
debugger, no settings. It is for sites that let people play their software
online, such as zxart.ee. The page passes in a file and the release's hardware
list, and the player does the rest:
- fits the machine and peripherals;
- fetches the ROMs;
- picks the file to run from an archive;
- starts the program.

It keeps nothing in localStorage. It does not read the full app's settings
and leaves none of its own.

## In an iframe

```html
<iframe src="/zxm8/player.html?url=/files/game.zip&hw=pentagon128,ts,kempston&launch=GAME.TRD"
        allow="fullscreen; autoplay" style="width:704px;height:592px;border:0"></iframe>
```

| Parameter  | Meaning |
|------------|---------|
| `url`      | The file: a TAP, TZX, SNA, Z80, SZX, TRD, SCL, UDI, DSK, MGT, OPD, D80, MDR, KDI or DCK, or a ZIP holding one. It must be served from the same origin, or with CORS. |
| `name`     | The file's name, when the URL does not end in it (the format is told partly by extension). |
| `launch`   | The file in the archive to run (zxart's `launchFilePath`): the whole path, or just the name, in any case. |
| `hw`       | zxart hardware codes, separated by commas (see below). |
| `machine`  | A machine to use instead: `48k` `128k` `+2` `+2a` `+3` `pentagon` `pentagon1024` `scorpion` `tc2048` `tc2068` `tk90x` `tk95` `dgama` `hc2000`. |
| `arrows`   | `1`/`0`: the cursor keys work the joystick, and Right Ctrl fires. The default is on when `hw` names a joystick. |
| `flash`    | `0`: tapes load in real time. The default is instant loading where the ROM traps allow it. |
| `sound`    | `0`: start muted. |
| `controls` | `0`: no button bar. |
| `roms`     | The URL of the ROM directory. The default is `roms/`. |
| `boot5`, `boot4` | The boot added to a TR-DOS disk that has none (see below). |

The host page can send the player commands with `postMessage`. The player
takes them only from its parent window:
- `{zxm8: 'restart'}`
- `{zxm8: 'fullscreen', on: true}`
- `{zxm8: 'sound', on: false}`
- `{zxm8: 'screenshot', type: 'image/png'}`: the player answers with
  `{zxm8: 'screenshot', blob}`.

As it works, the player posts `{zxm8: 'status', text, kind}` to the host.
`kind` is `info`, `error` or `ready`.

## As a module

```js
import { create } from './ui/player.js';
const p = await create(document.getElementById('box'), {
    url, fileName, launchFilePath, hardware: ['zx128', 'ay'], machine,
    arrowsAsJoystick, flashLoad, sound, controls, romBase, boot5, boot4,
    onStatus: (text, kind) => {},
});
p.restart(); p.setFullscreen(true); p.setSound(false);
const png = await p.screenshot(); p.destroy();
```

`lib/pako.min.js` must be loaded first (ZIP). One player per page: the
Spectrum core listens to the keyboard on `document`.

## zxart hardware codes

`core/zxart-hardware.js` turns the codes into a machine and the peripherals
to fit.

- **Machine.** If the release lists several machines, the player takes the
  first available in this order:
  - zx128, +2, Pentagon 128, Pentagon 512/1024 (as the 1024), Scorpion;
  - then +2B (as the +2A) and +3;
  - then zx48 and zx16;
  - then TC2068, TC2048, TK-90X and Didaktik 80 (as the Gama).

  A machine with a ROM of its own comes after the 48K: a 48K game that also
  lists one is still best off on a Spectrum. With no machine listed, the
  player uses the 128K.
- **What the file demands.**
  - A TRD, SCL or UDI, or the codes `trdos` / `betadisk`, mean TR-DOS 5.
    The disk goes to the machine the release names (zx48 to a 48K, zx128 to
    a 128K), with a Beta 128 fitted where the machine has none built in.
    With no machine named, it goes to a Pentagon.
  - If only `trdos4x` is listed, the release is for TR-DOS 4.x: a Beta 48 on
    a 48K, or on the TK-90X if `tk9x` is listed. It needs `roms/beta48.rom`.
    A TKMEM is fitted only when the release lists it (`tkmem128` or
    `tkmem512`; zxart.ee has `tkmem128`). A 128K machine in the list does
    not bring one.
  - If both `trdos` and `trdos4x` are listed, the player uses TR-DOS 5: a
    128K game is simpler on a 128K than on a 48K with a TKMEM.
  - A DSK goes to the +3, to the FDD 3000 with `tos`, or to the Kempston
    Disc with `kdi` / `kdi128`. `cpmp3` (Locomotive CP/M+) is the +3 too, and
    `hccpm` is the HC-2000.
  - A DCK goes to the TC2068.
  - An MGT goes to the +D, also with `disciple` or `gdos`: the +D runs the
    DISCiPLE's software too, on a 48K or a 128K.
  - OPD goes to the Opus; D80/D40 or `mdos` to the Didaktik 80. The
    `didaktik80` machine is a Didaktik Gama with that drive and MDOS; MDR or
    `microdrive` to Interface 1.
  - KDI, or `kdi`, is the Kempston Disc with the stock board (K-DOS 2.1).
    `kdi128` is the 128A6 board with its K-DOS, on a 128K.
- **Sound.**
  - `ay` on a 48K-class machine fits an AY.
  - `ts` is TurboSound, and `tsfm` is TurboSound FM.
  - `gs` and `ngs` are General Sound (`roms/gs105b.rom`). So is `covoxgs`:
    the program itself switches the GS into its Covox mode.
  - `saa` is the SAA1099.
  - `covoxfb` and `covoxdd` are a Covox on port FB or DD.
  - `soundrive` is the Soundrive; `specdrum` and `cheetah` are the SpecDrum.
  - `midi` sends the 128's MIDI out (AY port A) to the built-in synth. While
    the emulation stands still or the sound is off, all notes are switched
    off, so a held note does not drone on.
- **Input and video.**
  - `kempston`, `cursor`, `int2_1` and `int2_2` pick the joystick.
  - `kempston8b` turns on the extended buttons.
  - `kempstonmouse` fits the mouse, with its wheel (the top four bits of the
    buttons port). A click on the screen captures it, and Esc lets it go.
  - `ulaplus` turns on ULAplus.
  - `tmxhires` and `tmxhicol` (Timex video modes) need a Timex: the one the
    release lists, or else the TC2048.

The player logs the codes it cannot emulate (`sid`, `divmmc`, and others) to
the console and ignores them.

## Starting the program

The player starts the program the way the app does with auto load on:
- A tape is loaded with LOAD "" (on the +3, the disk drives are emptied
  first).
- A +3 disk boots through the Loader, and an FDD 3000 disk through its own
  boot.
- A snapshot or a cartridge just runs.
- Didaktik, Microdrive, Kempston Disc and HC disks are inserted, and the
  machine is started at BASIC.

Disks of TR-DOS, the +D and the Opus follow one rule:
1. If the disk has its own autostart, it runs.
2. If not, and `data/boot/` has a boot of ours for that system, it is added
   to the disk, and it runs, with its own menu inside the emulator.
3. If neither, one BASIC program on the disk is run. If there are several,
   the player shows them over the screen, picked with the arrows and Enter
   or with a click.

| System | Its autostart | Our boot | How the player runs a program |
|--------|---------------|----------|-------------------------------|
| TR-DOS 5.x | `boot` | `trdos5.trd` / `trdos5.hobeta` (Dimon's boot, which runs a lone program straight away) | RUN "name" |
| TR-DOS 4.x | `boot` | `trdos4.trd` / `trdos4.hobeta` (none yet) | RUN "name" |
| +D (MGT) | `auto…` | `plusd-auto.tap`: a TAP holding one BASIC program, written to the disk as `auto` (none yet) | RUN (G+DOS boots), then LOAD d1"name" |
| Opus | `run` | `opus-run.tap`: the same, written as `run` (none yet) | LOAD *"m";1;"name" |

`boot5` / `boot4` in the query string point to another TR-DOS boot.

The +D's ROM is only a bootstrap: RUN loads G+DOS from the disk, from the
file whose name begins `+SYS` (found by its name, wherever it is in the
directory). A disk without one is given G+DOS 2a from `data/boot/plusd.sys`
(its directory entry, then its data, 510 bytes a sector; taken from a
working disk).

A program saved without a LINE to start at would only load. The player gives
the copy on the disk LINE 0 before loading it, so it runs as it loads. Typing
RUN after it does not work in 128 BASIC: the screen editor's cursor sits on a
program line, and the word lands in it.

How the player types: it waits until BASIC sits scanning the keyboard with
the interface paged out, plus at least 2 seconds after a command (the disk
spins up with the interface ROM paged out). On a 128K it takes 128 BASIC
from the menu and types words letter by letter. It presses a cursor key
first to clear the report that 128 BASIC shows after a command, then waits
for the redraw.

To try the mouse, `headless/player/mouse.tap` (not in the repository) is a
BASIC loop that prints X, Y and the buttons and plots where the mouse is.

Browsers start sound only after a click or a key. Until then the player
shows "Click for sound".
