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
import { trdHasBootFile, extractBootFile, isHobetaFile, extractBootFromHobeta, injectBootIntoTrd } from '../core/trd-boot.js';

const ICON = { reset: '⟲', sound: '🔊', mute: '🔇', full: '⛶' };

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
    // The programs on a TR-DOS disk that has no boot of its own (and none of
    // ours to add, as under TR-DOS 4.x): one of them is picked here
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
    const hw = resolveHardware(opts.hardware || [], media ? media.runName : '');
    const machine = opts.machine && getMachineProfile(opts.machine) ? opts.machine : hw.machine;
    setStorageMemory(hw.storage);
    const spectrum = new Spectrum(canvas, { machineType: machine, tapeTrapsEnabled: true });
    spectrum.betaDiskEnabled = spectrum.profile.betaDiskDefault || hw.storage.zxm8_betaDisk === 'true';
    Object.assign(spectrum, hw.spectrum);
    if (hw.joystick) spectrum.setJoystickType(hw.joystick);
    // The cursor keys drive the joystick when the release has one; without
    // one they stay the Spectrum's cursor keys (Caps Shift + 5..8)
    spectrum.arrowsAsJoystick = opts.arrowsAsJoystick !== undefined ? !!opts.arrowsAsJoystick : !!hw.joystick;
    spectrum.setTapeFlashLoad(opts.flashLoad !== false);
    const boots = await fetchBoots(opts);
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
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h;
            screen.style.aspectRatio = `${d.width} / ${h}`;
        }
    }
    spectrum.addFrameListener(fitCanvas);

    // ---- sound: browsers start it only from a click or a key ----
    let soundOn = opts.sound !== false;
    async function startAudio() {
        try {
            const audio = spectrum.initAudio();
            if (!audio.context) await audio.start();
            if (audio.context && audio.context.state === 'suspended') await audio.context.resume();
            audio.setMuted(!soundOn);
            unmute.hidden = !audio.context || audio.context.state === 'running';
        } catch (e) { unmute.hidden = true; }
    }
    const onGesture = () => { startAudio(); };
    container.addEventListener('pointerdown', onGesture);
    document.addEventListener('keydown', onGesture);
    unmute.addEventListener('click', () => { startAudio(); canvas.focus({ preventScroll: true }); });

    // ---- running the program ----
    async function boot() {
        if (closeMenu) closeMenu();
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
        let result = await spectrum.loadFile(new File([media.data], media.name), 0);
        if (result.needsSelection) result = spectrum.loadFromZipSelection(result, media.index);
        await dispatch(result, media.runName);
        fitCanvas();
        if (menu.hidden) canvas.focus({ preventScroll: true });
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

    // ---- controls ----
    const btnSound = button(soundOn ? ICON.sound : ICON.mute, 'Sound on / off', () => setSound(!soundOn));
    button(ICON.reset, 'Start again', () => restart());
    button(ICON.full, 'Full screen', () => setFullscreen(!document.fullscreenElement));

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
        spectrum.destroy();
        container.removeEventListener('pointerdown', onGesture);
        document.removeEventListener('keydown', onGesture);
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
    return { data, name: zip && !fileExt(name) ? name + '.zip' : name, runName, index };
}

if (typeof window !== 'undefined') window.ZXM8 = { create };
