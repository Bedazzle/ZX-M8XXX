// player.js — the embeddable player: one machine, one program, no debugger.
//
// For sites that offer their software to play online (zxart.ee). The page
// hands over a file URL and the release's hardware list; the player fits the
// machine and peripherals the list asks for, fetches the ROMs, picks the file
// to run from an archive, and starts it the way the full app's auto load does.
// It keeps no settings: storage runs in memory (core/utils.js), so it neither
// reads the app's saved settings nor leaves its own behind.
//
//   const p = await ZXM8.create(container, {
//       url: '/file/12345/game.zip',     // the release
//       fileName: 'game.zip',            // when the URL does not end in it
//       launchFilePath: 'GAME.TRD',      // the file in the archive to run
//       hardware: ['pentagon128', 'ts'], // zxart hardware codes
//       machine: 'pentagon',             // override the machine (core/machines.js id)
//       romBase: 'roms/',                // where the ROMs are served
//       onStatus: (text, kind) => {},    // kind: 'info' | 'error' | 'ready'
//   });
//   p.restart(); p.setFullscreen(true); p.setSound(false);
//   await p.screenshot('image/png'); p.destroy();
//
// player.html wraps this for an iframe and takes the same options from its
// query string (see docs/player.md).

import { Spectrum } from '../core/spectrum.js';
import { getMachineProfile } from '../core/machines.js';
import { setStorageMemory } from '../core/utils.js';
import { applyRoms, fetchRoms } from '../core/rom-loader.js';
import { resolveHardware, pickLaunchFile, fileExt } from '../core/zxart-hardware.js';
import { ZipLoader } from '../core/loaders/zip.js';
import { initAutoLoader } from './auto-loader.js';
import { MidiSynth } from './midi-synth.js';
import { createTouchJoystick, TOUCH_TYPES } from './touch-joystick.js';
import { initVirtualKeyboard } from './virtual-keyboard.js';
import { MGTLoader } from '../core/loaders/disk-mgt.js';
import { OPDLoader } from '../core/loaders/disk-opus.js';
import { hasPlusDSystem, addPlusDSystem, addMgtFile, mgtBasicFile } from '../core/mgt-sys.js';
import { trdHasBootFile, extractBootFile, isHobetaFile, extractBootFromHobeta, injectBootIntoTrd } from '../core/trd-boot.js';

const ICON = { reset: '⟲', sound: '🔊', mute: '🔇', full: '⛶', joy: '🎮', keys: '⌨' };

function nameFromUrl(url) {
    try {
        const u = new URL(url, location.href);
        return decodeURIComponent(u.pathname.split('/').pop() || '');
    } catch (e) { return ''; }
}

export async function create(container, opts = {}) {
    const status = (text, kind = 'info') => {
        msg.textContent = kind === 'ready' ? '' : text;
        msg.className = 'zxm8-msg' + (kind === 'error' ? ' zxm8-error' : '');
        if (opts.onStatus) { try { opts.onStatus(text, kind); } catch (e) { /* host's */ } }
    };

    // ---- the page ----
    container.classList.add('zxm8-player');
    container.innerHTML = '';
    const screen = document.createElement('div');
    screen.className = 'zxm8-screen';
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    canvas.width = 352; canvas.height = 296;
    const unmute = document.createElement('button');
    unmute.className = 'zxm8-unmute';
    unmute.textContent = ICON.mute + ' Click for sound';
    unmute.hidden = true;
    const msg = document.createElement('div');
    msg.className = 'zxm8-msg';
    // The programs on a disk that has no autostart of its own and none of
    // ours to add: one of them is picked here
    const menu = document.createElement('div');
    menu.className = 'zxm8-menu';
    menu.tabIndex = 0;
    menu.hidden = true;
    screen.append(canvas, menu, unmute, msg);
    const bar = document.createElement('div');
    bar.className = 'zxm8-bar';
    const button = (label, title, fn) => {
        const b = document.createElement('button');
        b.textContent = label; b.title = title;
        b.addEventListener('click', (e) => { e.preventDefault(); fn(); canvas.focus({ preventScroll: true }); });
        bar.append(b);
        return b;
    };
    if (opts.controls !== false) container.append(screen, bar); else container.append(screen);

    // ---- the machine, from the release ----
    // A file that cannot be had still leaves a working machine, and says why
    let media = null, mediaError = null;
    try { media = await fetchMedia(opts, status); }
    catch (e) { mediaError = e.message; }
    let soundOn = opts.sound !== false;
    const hw = resolveHardware(opts.hardware || [], media ? media.runName : '');
    const machine = opts.machine && getMachineProfile(opts.machine) ? opts.machine : hw.machine;
    setStorageMemory(hw.storage);
    const spectrum = new Spectrum(canvas, { machineType: machine, tapeTrapsEnabled: true });
    spectrum.betaDiskEnabled = spectrum.profile.betaDiskDefault || hw.storage.zxm8_betaDisk === 'true';
    Object.assign(spectrum, hw.spectrum);
    if (hw.joystick) spectrum.setJoystickType(hw.joystick);
    // MIDI out to the built-in synth, as the app's "Built-in synth" output
    let midiSynth = null, midiTimer = null;
    if (hw.midi) {
        midiSynth = new MidiSynth();
        spectrum.onMidiMessage = (m) => {
            if (!soundOn && (m[0] & 0xF0) === 0x90 && m[2] > 0) return;   // sound off: no new notes
            midiSynth.send(m);
        };
        spectrum.setMidiOut(true);
        // A note held while the emulation stands still (paused, a hidden tab)
        // or the sound is off would sound on and on: all notes off then, once
        let lastFrame = -1, lastMove = 0, quiet = false;
        midiTimer = setInterval(() => {
            const now = performance.now();
            if (spectrum.frameCount !== lastFrame) { lastFrame = spectrum.frameCount; lastMove = now; }
            const still = !soundOn || document.hidden || now - lastMove > 150;
            if (still && !quiet) midiSynth.allOff();
            quiet = still;
        }, 50);
    }
    // The cursor keys drive the joystick when the release has one; without
    // one they stay the Spectrum's cursor keys (Caps Shift + 5..8)
    spectrum.arrowsAsJoystick = opts.arrowsAsJoystick !== undefined ? !!opts.arrowsAsJoystick : !!hw.joystick;
    spectrum.setTapeFlashLoad(opts.flashLoad !== false);
    const boots = await fetchBoots(opts);
    const bootBase = opts.bootBase || 'data/boot/';
    const plusDSys = await fetchBytes(bootBase + 'plusd.sys');
    // Our own boot programs for disks with no autostart, as one-program TAPs:
    // "auto" for the +D, "run" for the Opus. Without one the player's menu
    // does the choosing.
    const plusDAuto = tapBasic(await fetchBytes(bootBase + 'plusd-auto.tap'));
    const opusRun = tapBasic(await fetchBytes(bootBase + 'opus-run.tap'));
    // A TR-DOS disk without a "boot" gets ours, one for each TR-DOS: the menu
    // a TR-DOS 5.x boot draws does not run under 4.x and the other way round
    spectrum.onBeforeTrdLoad = (data) => {
        const beta48 = !spectrum.profile.betaDiskDefault && spectrum.betaVariant !== '128';
        const boot = boots[beta48 ? 'trdos4' : 'trdos5'];
        if (!boot || trdHasBootFile(data)) return data;
        try { return injectBootIntoTrd(data, boot); }
        catch (e) { console.info('[player] no boot added: ' + e.message); return data; }
    };
    if (hw.unsupported.length) console.info('[player] not emulated: ' + hw.unsupported.join(', '));

    const romData = {};
    const romBase = opts.romBase || 'roms/';
    async function loadRoms(type) {
        await fetchRoms(spectrum, type, romData, romBase);
        if (spectrum.gsOn && !spectrum.gs.rom) {
            try {
                const r = await fetch(romBase + spectrum.gsRomFile);
                if (r.ok) spectrum.setGs(true, spectrum.gs.ramKB, new Uint8Array(await r.arrayBuffer()));
            } catch (e) { /* plays without it */ }
        }
        applyRoms(spectrum, type, romData);
    }

    const autoLoader = initAutoLoader({ getSpectrum: () => spectrum });

    // The canvas follows the machine (border size, Timex's double width)
    function fitCanvas() {
        const d = spectrum.ula.getDimensions();
        const w = d.width * (spectrum.canvasScaleX || 1), h = d.height;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        // the core may have resized the canvas itself (a Timex or the GMX,
        // twice as wide): the shape follows the machine's, not the canvas's
        const ar = `${d.width} / ${h}`;
        if (screen.style.aspectRatio !== ar) screen.style.aspectRatio = ar;
    }
    spectrum.addFrameListener(fitCanvas);

    // ---- sound: browsers start it only from a click or a key ----
    async function startAudio() {
        try {
            const audio = spectrum.initAudio();
            if (!audio.context) await audio.start();
            if (audio.context && audio.context.state === 'suspended') await audio.context.resume();
            audio.setMuted(!soundOn);
            if (midiSynth) midiSynth.resume();
            unmute.hidden = !audio.context || audio.context.state === 'running';
        } catch (e) { unmute.hidden = true; }
    }
    const onGesture = () => { startAudio(); };
    container.addEventListener('pointerdown', onGesture);
    document.addEventListener('keydown', onGesture);
    unmute.addEventListener('click', () => { startAudio(); canvas.focus({ preventScroll: true }); });

    // ---- Kempston mouse: a click on the screen captures it, Esc lets go ----
    const mouseOn = () => spectrum.kempstonMouseEnabled;
    const captured = () => document.pointerLockElement === canvas;
    const mouse = {
        click: () => { if (mouseOn() && !captured() && menu.hidden) canvas.requestPointerLock(); },
        lock: () => { if (captured()) status('Mouse captured: Esc lets it go'); else status('', 'ready'); },
        move: (e) => { if (captured() && mouseOn()) spectrum.updateMousePosition(e.movementX, e.movementY); },
        down: (e) => { if (captured() && mouseOn()) { spectrum.setMouseButton(e.button, true); e.preventDefault(); } },
        up: (e) => { if (captured() && mouseOn()) { spectrum.setMouseButton(e.button, false); e.preventDefault(); } },
        menu: (e) => { if (captured()) e.preventDefault(); },
        wheel: (e) => {
            if (captured() && mouseOn() && spectrum.kempstonMouseWheelEnabled) { spectrum.updateMouseWheel(e.deltaY); e.preventDefault(); }
        },
    };
    canvas.addEventListener('click', mouse.click);
    canvas.addEventListener('mousedown', mouse.down);
    canvas.addEventListener('mouseup', mouse.up);
    canvas.addEventListener('contextmenu', mouse.menu);
    document.addEventListener('pointerlockchange', mouse.lock);
    document.addEventListener('mousemove', mouse.move);
    document.addEventListener('wheel', mouse.wheel, { passive: false });

    // ---- running the program ----
    async function boot() {
        if (closeMenu) closeMenu();
        stopScript();
        diskBytes = null;
        spectrum.stop();
        autoLoader.cancelAutoLoad();
        if (spectrum.machineType !== machine) spectrum.setMachineType(machine);
        status('Loading ROMs…');
        await loadRoms(machine);
        spectrum.reset();
        fitCanvas();
        if (!media) {
            spectrum.start();
            if (mediaError) status(mediaError, 'error'); else status('', 'ready');
            return;
        }
        status('Starting ' + media.runName + '…');
        let result;
        if (media.zip) {
            result = await spectrum.loadFile(new File([media.data], media.name), 0);
            if (result.needsSelection) {
                const f = result._zipFiles[media.index];
                f.data = prepareDisk(f.name, f.data);
                diskBytes = f.data; diskName = f.name;
                result = spectrum.loadFromZipSelection(result, media.index);
            }
        } else {
            const data = prepareDisk(media.name, media.data);
            diskBytes = data; diskName = media.name;
            result = await spectrum.loadFile(new File([data], media.name), 0);
        }
        await dispatch(result, media.runName);
        fitCanvas();
        if (menu.hidden) canvas.focus({ preventScroll: true });
    }

    // An MGT without G+DOS on it gets ours: the +D cannot start one otherwise
    let diskBytes = null, diskName = '';
    // The rule for every disk system: its own autostart runs; without one,
    // ours (data/boot/) is added if there is one; else the player's menu.
    function prepareDisk(name, data) {
        const ext = fileExt(name);
        try {
            if (ext === 'mgt' && MGTLoader.isMGT(data)) {
                if (plusDSys && !hasPlusDSystem(data)) data = addPlusDSystem(data, plusDSys).buffer;
                const basic = MGTLoader.listFiles(data).filter(f => f.type === 1);
                if (plusDAuto && !basic.some(f => f.name.trim().toLowerCase().startsWith('auto'))) {
                    data = addMgtFile(data, mgtBasicFile('auto', plusDAuto.prog, plusDAuto.autostart)).buffer;
                }
            } else if ((ext === 'opd' || ext === 'opu') && opusRun) {
                const files = OPDLoader.listFiles(data);
                if (!files.some(f => f.type === 0 && f.name.trim().toLowerCase() === 'run')) {
                    const bytes = new Uint8Array(data);
                    const keep = files.map(f => ({
                        name: f.name, type: f.type, startAddr: f.startAddr, autostart: f.autostart,
                        progLength: f.progLength, declaredLength: f.length, data: OPDLoader.extractFile(bytes, f),
                    }));
                    const run = { name: 'run', type: 0, autostart: opusRun.autostart,
                                  progLength: opusRun.prog.length, data: opusRun.prog };
                    data = OPDLoader.buildOPD([run, ...keep], OPDLoader.getDiskInfo(bytes).diskLabel || '', 1, bytes).buffer;
                }
            }
        } catch (e) { console.info('[player] disk left as it was: ' + e.message); }
        return data;
    }

    // ---- typing at the machine, frame by frame ----
    // Steps: {ready} waits for the ROM to sit scanning the keyboard (after a
    // reset or a disk load) for a moment; {keys} presses keys together;
    // {text} types characters one by one.
    let scriptOff = null;
    function stopScript() { if (scriptOff) { scriptOff(); scriptOff = null; } }
    function charKeys(c) {
        if (/[A-Z]/.test(c)) return ['CAPS', c.toLowerCase()];
        if (c === ' ') return ['Space'];
        return [c];
    }
    function runScript(steps) {
        stopScript();
        const ula = spectrum.ula;
        const queue = [];
        for (const st of steps) {
            if (st.text) for (const c of st.text) queue.push({ keys: charKeys(c) });
            else queue.push(st);
        }
        let i = 0, phase = 0, t = 0, reads = ula.keyboardReads, scanning = 0, held = null;
        scriptOff = spectrum.addFrameListener(() => {
            const st = queue[i];
            if (!st) { stopScript(); return; }
            t++;
            if (st.ready) {
                const now = ula.keyboardReads;
                // A DOS checks BREAK while it loads, so a scan alone does not
                // mean BASIC is waiting: the interface must be paged out too
                const mem = spectrum.memory;
                const idle = !mem.plusDActive && !mem.opusActive;
                scanning = now > reads && idle ? scanning + 1 : 0;
                reads = now;
                if ((scanning >= (st.settle || 20) && t >= (st.min || 0)) || t > (st.timeout || 1500)) {
                    i++; t = 0; scanning = 0;
                }
            } else if (phase === 0) {
                held = st.keys.map(k => ula.resolveKeyName(k) || k);
                held.forEach(k => ula.keyDown(k));
                phase = 1; t = 0;
            } else if (phase === 1 && t >= 5) {
                held.forEach(k => ula.keyUp(k));
                phase = 2; t = 0;
            } else if (phase === 2 && t >= 5) {
                phase = 0; t = 0; i++; reads = ula.keyboardReads;
            }
        });
    }
    // Into BASIC from reset: a 128K's menu goes to 128 BASIC, where words are
    // typed letter by letter; a 48K types keywords as single keys
    const isMenuMachine = () => spectrum.profile.pagingModel !== 'none' && spectrum.profile.pagingModel !== 'scorpion';
    function basicSteps() {
        return isMenuMachine()
            ? [{ ready: true }, { keys: ['ArrowDown'] }, { keys: ['Enter'] }, { ready: true }]
            : [{ ready: true }];
    }
    // After a command (a DOS loading, a LOAD): BASIC waiting again, the disk
    // spun down. 128 BASIC first shows its report, and the key that clears it
    // is lost: a cursor key does that and nothing else. It redraws the screen
    // some 40 frames later, and keys typed before that are lost too.
    function afterCommand() {
        const wait = { ready: true, min: 100, settle: 30 };
        return isMenuMachine() ? [wait, { keys: ['ArrowDown'] }, { ready: true, min: 60 }] : [wait];
    }
    // RUN, or LOAD and what follows it, as this machine's BASIC takes it
    const kw = (word, key) => isMenuMachine() ? { text: word + ' ' } : { keys: [key] };
    const typeRun = () => [kw('run', 'r'), { keys: ['Enter'] }];
    const typeLoad = (rest) => [kw('load', 'j'), { text: rest }, { keys: ['Enter'] }];

    // +D (MGT): RUN loads G+DOS, which runs "auto". Without one a lone BASIC
    // program is loaded; of several the player asks which.
    function startPlusD() {
        const files = diskBytes ? MGTLoader.listFiles(diskBytes) : [];
        const basic = files.filter(f => f.type === 1);
        const hasAuto = basic.some(f => f.name.trim().toLowerCase().startsWith('auto'));
        const go = (f) => {
            if (f) startAtLine0(f, 'mgt');
            spectrum.reset();
            runScript([...basicSteps(), ...typeRun(),
                ...(f ? [...afterCommand(), ...typeLoad('d1"' + f.name.trim() + '"')] : [])]);
            spectrum.start();
        };
        pickAndGo(hasAuto ? [] : basic, go);
    }
    // Opus: RUN runs the disk's "run". Without one a lone BASIC program is
    // loaded; of several the player asks which.
    function startOpus() {
        const files = diskBytes ? OPDLoader.listFiles(diskBytes) : [];
        const basic = files.filter(f => f.type === 0);
        const hasRun = basic.some(f => f.name.trim().toLowerCase() === 'run');
        const go = (f) => {
            if (f) startAtLine0(f, 'opd');
            spectrum.reset();
            runScript([...basicSteps(),
                ...(f ? typeLoad('*"m";1;"' + f.name.trim() + '"') : typeRun())]);
            spectrum.start();
        };
        pickAndGo(hasRun ? [] : basic, go);
    }
    // A program saved without a LINE to start at would only load, and typing
    // RUN after it is unreliable in 128 BASIC's screen editor (the cursor sits
    // on a program line, and the word lands in it). So the copy on the disk is
    // given LINE 0, and the disk inserted again: it runs as it loads.
    function startAtLine0(f, kind) {
        if (f.autostart != null && f.autostart < 0x8000) return;
        const b = new Uint8Array(diskBytes).slice();
        if (kind === 'mgt') {
            const o = f.slotIndex * 256;
            b[o + 218] = 0; b[o + 219] = 0;
            const t = f.firstTrack, x = (((t & 0x7F) * 2 + (t >> 7)) * 10 + (f.firstSector - 1)) * 512;
            if (b[x] === 0) { b[x + 7] = 0; b[x + 8] = 0; }     // the file's own 9-byte header
        } else {
            b[f.dataOffset + 3] = 0; b[f.dataOffset + 4] = 0;   // param1 of the Opus file header
        }
        diskBytes = b.buffer;
        spectrum.loadFileData(diskBytes, diskName, 0);
    }
    // Nothing to choose (an autostart, or nothing to run): go(null). One
    // program: go(it). Several: the menu first.
    function pickAndGo(files, go) {
        if (files.length === 0) go(null);
        else if (files.length === 1) go(files[0]);
        else chooseProgram(files.map(f => f.name.trim())).then(name => {
            if (name !== null) { go(files.find(f => f.name.trim() === name)); canvas.focus({ preventScroll: true }); }
        });
    }

    // What the full app does with a loaded file when auto load is on
    // (ui/file-loader.js handleLoadResult), without its panels.
    async function dispatch(result, name) {
        const start = () => { if (!spectrum.isRunning()) spectrum.start(); };
        if (result.needsMachineSwitch) {
            start();
            status('This disk needs a Beta Disk, and the machine has none', 'error');
            return;
        }
        if (result.isDSK && result.diskInserted) {
            if (spectrum.machineType === '+3' && !(result._driveIndex > 0)) autoLoader.startAutoLoadPlus3Disk();
            else start();
        } else if (result.diskInserted && result.diskType === 'fdd3') {
            spectrum.fdd3000AutoBoot();
            start();
        } else if (result.diskInserted && result.diskType === 'mgt' && spectrum.plusDEnabled) {
            startPlusD();
        } else if (result.diskInserted && result.diskType === 'opd' && spectrum.opusEnabled) {
            startOpus();
        } else if (result.diskInserted && ['mgt', 'opd', 'mdr', 'd80', 'kdi', 'hc'].includes(result.diskType)) {
            start();
        } else if (result.diskInserted) {
            const canBoot = spectrum.profile.betaDiskDefault ||
                (spectrum.betaDiskEnabled && spectrum.memory.hasTrdosRom()) || spectrum.memory.beta48On;
            // TR-DOS runs a "boot" by itself. On a disk without one a single
            // BASIC program is RUN; of several, the player asks which
            const basic = (result._diskFiles || []).filter(f => f.type === 'basic');
            const hasBoot = basic.some(f => f.name.trim().toLowerCase() === 'boot');
            if (!canBoot) start();
            else if (hasBoot || !basic.length) autoLoader.startAutoLoadDisk();
            else if (basic.length === 1) autoLoader.startAutoLoadDiskRun(basic[0].name);
            else {
                // not awaited: the player is ready while the menu waits
                chooseProgram(basic.map(f => f.name)).then(name => {
                    if (name === null) return;      // restarted meanwhile
                    autoLoader.startAutoLoadDiskRun(name);
                    canvas.focus({ preventScroll: true });
                });
            }
        } else if (result.blocks !== undefined) {
            if (spectrum.machineType === '+3' && spectrum.fdc) {
                for (let i = 0; i < 2; i++) spectrum.clearDisk(i, 'fdc');
            }
            autoLoader.startAutoLoadTape(/\.(tzx|wav)$/i.test(name));
        } else if (result.frames !== undefined) {
            if (result.needsRomReload || !spectrum.romLoaded) await loadRoms(result.machineType || spectrum.machineType);
            start();
        } else {
            // A snapshot (or a cartridge): it may have changed the machine
            if (!spectrum.romLoaded || result.machineType && result.machineType !== machine) {
                await loadRoms(spectrum.machineType);
            }
            start();
        }
        status('', 'ready');
    }

    let closeMenu = null;
    function chooseProgram(names) {
        return new Promise(resolve => {
            let sel = 0;
            menu.innerHTML = '';
            const title = document.createElement('div');
            title.className = 'zxm8-menu-title';
            title.textContent = 'Choose a program';
            const list = document.createElement('div');
            list.className = 'zxm8-menu-list';
            const items = names.map((n, i) => {
                const b = document.createElement('button');
                b.textContent = n.trim();
                b.addEventListener('click', () => done(n));
                b.addEventListener('mousemove', () => mark(i));
                list.append(b);
                return b;
            });
            menu.append(title, list);
            const mark = (i) => {
                sel = (i + items.length) % items.length;
                items.forEach((b, j) => b.classList.toggle('zxm8-sel', j === sel));
                items[sel].scrollIntoView({ block: 'nearest' });
            };
            const onKey = (e) => {
                // the keys are the menu's, not the (stopped) Spectrum's
                e.stopPropagation();
                if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); mark(sel + 1); }
                else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); mark(sel - 1); }
                else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done(names[sel]); }
            };
            const done = (name) => {
                menu.removeEventListener('keydown', onKey);
                menu.hidden = true;
                menu.innerHTML = '';
                closeMenu = null;
                resolve(name);
            };
            closeMenu = () => done(null);
            menu.addEventListener('keydown', onKey);
            menu.hidden = false;
            mark(0);
            menu.focus({ preventScroll: true });
        });
    }

    // ---- on-screen joystick and keyboard, for phones and tablets ----
    // The joystick shows by itself on a touch screen (opts.touch overrides);
    // its type follows the release's codes and can be changed in the bar.
    const touchScreen = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const joyType = hw.spectrum.kempstonExtendedEnabled ? 'kempston8b'
        : (TOUCH_TYPES.some(t => t.id === hw.joystick) ? hw.joystick : 'kempston');
    const joy = createTouchJoystick({ spectrum, parent: screen, type: opts.touchType || joyType });
    const selJoy = document.createElement('select');
    selJoy.className = 'zxm8-joytype';
    selJoy.title = 'Joystick type';
    for (const t of TOUCH_TYPES) selJoy.add(new Option(t.name, t.id));
    selJoy.value = joy.type;
    selJoy.addEventListener('change', () => {
        joy.setType(selJoy.value);
        // the keyboard's arrows (arrowsAsJoystick) follow the same type
        spectrum.setJoystickType(selJoy.value === 'kempston8b' ? 'kempston' : selJoy.value);
        canvas.focus({ preventScroll: true });
    });
    const vkbd = document.createElement('div');
    vkbd.id = 'virtualKeyboard';
    vkbd.className = 'vkbd hidden';
    container.append(vkbd);

    // ---- controls ----
    const btnSound = button(soundOn ? ICON.sound : ICON.mute, 'Sound on / off', () => setSound(!soundOn));
    button(ICON.reset, 'Start again', () => restart());
    const btnJoy = button(ICON.joy, 'On-screen joystick', () => showJoystick(!joy.visible));
    bar.insertBefore(selJoy, btnJoy);
    const btnKeys = button(ICON.keys, 'On-screen keyboard', () => {});
    btnKeys.id = 'btnVKbd';
    initVirtualKeyboard({ getSpectrum: () => spectrum, appVersion: '', persist: false });
    button(ICON.full, 'Full screen', () => setFullscreen(!document.fullscreenElement));
    function showJoystick(on) {
        joy.show(on);
        btnJoy.classList.toggle('active', on);
        selJoy.hidden = !on;
    }
    showJoystick(opts.touch !== undefined ? !!opts.touch : touchScreen);

    function setSound(on) {
        soundOn = !!on;
        btnSound.textContent = soundOn ? ICON.sound : ICON.mute;
        if (soundOn) startAudio();
        else if (spectrum.audio) spectrum.audio.setMuted(true);
    }
    async function restart() {
        try { await boot(); } catch (e) { status(e.message, 'error'); }
    }
    function setFullscreen(on) {
        if (on && !document.fullscreenElement) {
            (container.requestFullscreen ? container.requestFullscreen() : Promise.reject())
                .catch(() => {});
        } else if (!on && document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    }
    function screenshot(type = 'image/png') {
        return new Promise(res => canvas.toBlob(res, type));
    }
    let destroyed = false;
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        if (closeMenu) closeMenu();
        autoLoader.cancelAutoLoad();
        if (midiTimer) clearInterval(midiTimer);
        if (midiSynth) midiSynth.allOff();
        joy.destroy();
        spectrum.destroy();
        container.removeEventListener('pointerdown', onGesture);
        document.removeEventListener('keydown', onGesture);
        if (captured()) document.exitPointerLock();
        document.removeEventListener('pointerlockchange', mouse.lock);
        document.removeEventListener('mousemove', mouse.move);
        document.removeEventListener('wheel', mouse.wheel);
        container.innerHTML = '';
    }

    try {
        await boot();
        await startAudio();
    } catch (e) {
        status(e.message, 'error');
    }
    return { spectrum, machine, hardware: hw, restart, setFullscreen, setSound, screenshot, destroy };
}

// The boot files the player adds to a TR-DOS disk that has none, as a TRD
// holding a "boot" or as a Hobeta file: data/boot/trdos5.* for TR-DOS 5.x
// (Beta 128, Pentagon, Scorpion), data/boot/trdos4.* for 4.x (Beta 48).
// opts.boot5 / opts.boot4 point elsewhere; a missing one means no boot is
// added, and such a disk has its first BASIC program RUN instead.
// The first BASIC program of a TAP: { prog, autostart }, or null
function tapBasic(tap) {
    if (!tap) return null;
    let i = 0, header = null;
    while (i + 2 <= tap.length) {
        const len = tap[i] | (tap[i + 1] << 8);
        const block = tap.subarray(i + 2, i + 2 + len);
        i += 2 + len;
        if (block[0] === 0 && block[1] === 0) header = block;
        else if (block[0] === 0xFF && header) {
            return { prog: block.slice(1, block.length - 1), autostart: header[14] | (header[15] << 8) };
        }
    }
    return null;
}

async function fetchBytes(url) {
    try {
        const r = await fetch(url);
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch (e) { return null; }
}

async function fetchBoots(opts) {
    const base = opts.bootBase || 'data/boot/';
    const one = async (urls) => {
        for (const url of urls) {
            try {
                const r = await fetch(url);
                if (!r.ok) continue;
                const data = new Uint8Array(await r.arrayBuffer());
                const boot = /\.trd$/i.test(url) ? extractBootFile(data)
                    : isHobetaFile(data, url.replace(/\.hobeta$/i, '.$b')) ? extractBootFromHobeta(data) : null;
                if (boot) return boot;
            } catch (e) { /* try the next */ }
        }
        return null;
    };
    const [trdos5, trdos4] = await Promise.all([
        one(opts.boot5 ? [opts.boot5] : [base + 'trdos5.trd', base + 'trdos5.hobeta']),
        one(opts.boot4 ? [opts.boot4] : [base + 'trdos4.trd', base + 'trdos4.hobeta']),
    ]);
    return { trdos5, trdos4 };
}

// Fetch the release, and if it is an archive choose the file in it to run.
// Returns { data, name, runName, index } or null when there is no URL.
async function fetchMedia(opts, status) {
    if (!opts.url) return null;
    status('Downloading…');
    const res = await fetch(opts.url);
    if (!res.ok) throw new Error(`Could not download the file (HTTP ${res.status})`);
    const data = await res.arrayBuffer();
    const name = opts.fileName || nameFromUrl(opts.url) || 'file';
    let runName = name, index = 0, zip = false;
    if (ZipLoader.isZip(data)) {
        zip = true;
        const files = await ZipLoader.findAllSpectrum(data);
        if (!files.length) throw new Error('There is no Spectrum file in the archive');
        index = pickLaunchFile(files.map(f => ({ name: f.name, type: f.type })), opts.launchFilePath);
        runName = files[index].name;
    }
    // The loaders tell formats by extension too, so an archive keeps one
    return { data, name: zip && !fileExt(name) ? name + '.zip' : name, runName, index, zip };
}

if (typeof window !== 'undefined') window.ZXM8 = { create };
