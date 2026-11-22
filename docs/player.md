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
  - A TRD, SCL or UDI goes to a Pentagon or Scorpion if the list allows it.
    Otherwise it goes to the listed machine with a Beta Disk fitted.
  - `trdos4x` (without `trdos` / `betadisk`) is a Beta 48 on a 48K. It needs
    `roms/beta48.rom`. The Beta 48 is a 48K add-on, so if the release also
    lists a 128K machine, the 48K gets a TKMEM-128 board: that is what the
    128K versions for TR-DOS 4.x were made for.
  - A DSK goes to the +3, or to the FDD 3000 with `tos`.
  - A DCK goes to the TC2068.
  - An MGT goes to the DISCiPLE with `disciple`, or else to the +D.
  - OPD goes to the Opus; D80/D40 or `mdos` to the Didaktik 80; MDR or
    `microdrive` to Interface 1; KDI to the Kempston Disc.
- **Sound.**
  - `ay` on a 48K-class machine fits an AY.
  - `ts` is TurboSound, and `tsfm` is TurboSound FM.
  - `gs` and `ngs` are General Sound (`roms/gs105b.rom`).
  - `saa` is the SAA1099.
  - `covoxfb` and `covoxdd` are a Covox on port FB or DD.
  - `soundrive` is the Soundrive; `specdrum` and `cheetah` are the SpecDrum.
- **Input and video.**
  - `kempston`, `cursor`, `int2_1` and `int2_2` pick the joystick.
  - `kempston8b` turns on the extended buttons.
  - `kempstonmouse` fits the mouse; the canvas captures it on a click.
  - `ulaplus` turns on ULAplus.

The player logs the codes it cannot emulate (`sid`, `divmmc`, and others) to
the console and ignores them.

## Starting the program

The player starts the program the way the app does with auto load on:
- A tape is loaded with LOAD "" (on the +3, the disk drives are emptied
  first).
- A TR-DOS disk boots TR-DOS:
  - TR-DOS runs the disk's `boot`.
  - A disk without one gets ours, if there is one for that TR-DOS:
    `data/boot/trdos5.*` for 5.x and `data/boot/trdos4.*` for 4.x, as a TRD
    holding a `boot` or as a `.hobeta` file. The TR-DOS 5.x boot is Dimon's
    boot, which runs a lone program straight away.
  - With no boot to add, a single BASIC program is RUN. If there are
    several, the player shows a list of them over the screen, picked with the
    arrows and Enter or with a click. This is the TR-DOS 4.x case, which has
    no boot yet.
- A +3 disk boots through the Loader, and an FDD 3000 disk through its own
  boot.
- A snapshot or a cartridge just runs.
- +D, Opus, Didaktik, Microdrive and Kempston Disc disks are inserted, and
  the machine is started at BASIC.

Browsers start sound only after a click or a key. Until then the player
shows "Click for sound".
