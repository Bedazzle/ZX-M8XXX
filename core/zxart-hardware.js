// zxart-hardware.js — turns a release's hardware list, as zxart.ee keeps it
// (project/core/ZxArt/Hardware/HardwareItem.php), into a machine and the
// peripherals to fit to it. Used by the embeddable player (ui/player.js).
//
//   resolveHardware(['pentagon128', 'ts', 'kempston'], 'game.trd')
//   -> { machine: 'pentagon', storage: { zxm8_turboSound: 'true' },
//        spectrum: {}, joystick: 'kempston', unsupported: [] }
//
// `storage` holds the settings the Spectrum core reads itself while it is
// built and on every machine change (core/utils.js storageGet); `spectrum`
// holds fields to set on the instance before the ROMs are fetched.

// Machines in the order of preference when a release lists more than one: a
// 128K Sinclair first (an AY and the most common target), then the clones,
// the 48K, and the machines with a ROM of their own last, as a 48K game that
// also lists a Timex is still best off on a Spectrum.
const MACHINES = [
    ['zx128', '128k'], ['zx128+2', '+2'], ['pentagon128', 'pentagon'],
    ['pentagon512', 'pentagon1024'], ['pentagon1024', 'pentagon1024'],
    ['pentagon2666', 'pentagon1024'],
    ['scorpion', 'scorpion'], ['scorpion1024', 'scorpion'],
    ['zx128+2b', '+2a'], ['zx128+3', '+3'],
    ['zx48', '48k'], ['zx16', '48k'],
    ['timex2068', 'tc2068'], ['timex2048', 'tc2048'],
    ['tk9x', 'tk90x'], ['didaktik80', 'dgama'],
];

// TR-DOS machines, in preference for a TR-DOS disk
const TRDOS_MACHINES = ['pentagon', 'pentagon1024', 'scorpion'];

const JOYSTICKS = { kempston: 'kempston', cursor: 'cursor', int2_1: 'sinclair1', int2_2: 'sinclair2' };

// Codes that need nothing (the machine has it) or are about the release, not
// the machine
const NOTHING_TO_FIT = new Set(['beeper', 'tape', 'flashcolor', 'cpm']);

export function fileExt(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
}

export function resolveHardware(codes = [], fileName = '') {
    const has = new Set((codes || []).map(c => String(c).toLowerCase()));
    const ext = fileExt(fileName);
    const storage = {};
    const spectrum = {};
    const unsupported = [];
    let joystick = null;
    const handled = new Set();
    const use = (code) => { handled.add(code); return has.has(code); };

    // ---- the disk system, from the codes or else the file's format ----
    const trdos = use('betadisk') | use('trdos') | use('trdos4x');
    const isTrdDisk = ['trd', 'scl', 'udi'].includes(ext);
    let needMachine = null;   // a machine the media itself demands
    // Kempston Disc: kdi is the stock board (K-DOS 2.1), kdi128 the 128A6
    // board with its K-DOS on a 128K. Their disks may be named .dsk (x128)
    const kdi128 = use('kdi128');
    const kdi = use('kdi') || kdi128 || ext === 'kdi';
    if (kdi) storage.zxm8_kempdisc = 'true';
    if (kdi128) storage.zxm8_kempdiscRom = 'kdos21-128a6.rom';
    // A DSK is a +3 disk, unless the release is for the Timex FDD 3000 (TOS)
    // or the Kempston Disc
    if ((ext === 'dsk' && !has.has('tos') && !kdi) || use('cpmp3')) needMachine = '+3';
    if (use('hccpm')) needMachine = 'hc2000';                // HC CP/M: the HC-2000's own
    if (use('timex_cartridge') || ext === 'dck') needMachine = 'tc2068';
    // MGT disks (disciple, gdos) all go to the +D: it runs the DISCiPLE's
    // software too, on a 48K or a 128K
    if (use('disciple') | use('gdos') || ext === 'mgt') spectrum.plusDEnabled = true;
    if (use('opd') || ext === 'opd' || ext === 'opu') spectrum.opusEnabled = true;
    // The Didaktik 80 is a Gama with its D80 drive and MDOS
    if (use('mdos') || has.has('didaktik80') || ext === 'd80' || ext === 'd40') spectrum.didaktikEnabled = true;
    if (use('microdrive') || ext === 'mdr') spectrum.if1Enabled = true;
    if (use('tos')) storage.zxm8_fdd3000 = 'true';
    use('3dos'); use('3dosdisk');

    // ---- the machine ----
    let listed = MACHINES.filter(([code]) => use(code)).map(([, id]) => id);
    for (const [code] of MACHINES) handled.add(code);
    // Timex hi-res / hi-colour modes need a Timex: one listed, else the TC2048
    if (use('tmxhires') | use('tmxhicol')) {
        const timex = listed.filter(m => m === 'tc2068' || m === 'tc2048');
        listed = timex.length ? timex : ['tc2048'];
    }
    let machine;
    if (kdi128 && !needMachine) {
        // the 128A6 board is for a 128K
        machine = listed.find(m => ['128k', '+2'].includes(m)) || '128k';
    } else if (needMachine) {
        machine = needMachine;
    } else if (has.has('trdos4x') && !has.has('trdos') && !has.has('betadisk')) {
        // Only TR-DOS 4.x: a Beta 48 (beta48.rom), a 48K add-on. On a 48K, or
        // the TK-90X when the release lists it. Extra memory (TKMEM) only
        // when the release lists it too; a 128K machine in the list does not
        // bring one, as the release may mean another version of itself.
        machine = listed.includes('tk90x') ? 'tk90x' : '48k';
        storage.zxm8_betaDisk = 'true';
        storage.zxm8_betaVariant = 'auto';
        if (machine === '48k' && (use('tkmem128') | use('tkmem'))) storage.zxm8_tkmem = '128';
        if (machine === '48k' && use('tkmem512')) storage.zxm8_tkmem = '512';
    } else if (isTrdDisk || trdos) {
        // TR-DOS 5 (also when both 5 and 4.x are listed: a 128K game is
        // simpler on a 128K than on a 48K with a TKMEM): the machine the
        // release names, with a Beta 128 where it has none built in. Nothing
        // named: a Pentagon.
        machine = listed[0] || 'pentagon';
        if (!TRDOS_MACHINES.includes(machine)) storage.zxm8_betaDisk = 'true';
    } else {
        machine = listed[0] || '128k';
    }
    if (has.has('pentagon2666')) unsupported.push('pentagon2666');

    // ---- sound ----
    if (use('ay') && ['48k', 'tc2048', 'tk90x', 'dgama', 'hc2000'].includes(machine)) {
        spectrum.ay48kEnabled = true;
    }
    if (use('ts')) storage.zxm8_turboSound = 'true';
    if (use('tsfm')) { storage.zxm8_turboSound = 'true'; storage.zxm8_tsfm = 'true'; }
    // covoxgs is the Covox mode of the General Sound: the program sets it up
    if (use('gs') | use('ngs') | use('covoxgs')) storage.zxm8_gs = 'true';
    if (use('saa')) storage.zxm8_saa = 'true';
    if (use('covoxfb')) { storage.zxm8_dacType = 'covox'; storage.zxm8_covoxPort = 'FB'; }
    else if (use('covoxdd')) { storage.zxm8_dacType = 'covox'; storage.zxm8_covoxPort = 'DD'; }
    else if (use('soundrive')) storage.zxm8_dacType = 'soundrive1';
    else if (use('specdrum') | use('cheetah')) storage.zxm8_dacType = 'specdrum';

    // ---- input and video ----
    for (const [code, type] of Object.entries(JOYSTICKS)) {
        if (use(code) && !joystick) joystick = type;
    }
    if (use('kempston8b')) { joystick = joystick || 'kempston'; spectrum.kempstonExtendedEnabled = true; }
    if (use('kempstonmouse') && machine !== 'hc2000') {
        spectrum.kempstonMouseEnabled = true;
        spectrum.kempstonMouseWheelEnabled = true;   // the wheel in the buttons port's top bits
    }
    if (use('ulaplus')) storage.zxm8_ulaplus = 'true';

    // 128 MIDI out (AY port A): played on the player's built-in synth
    const midi = !!use('midi');
    for (const code of has) {
        if (!handled.has(code) && !NOTHING_TO_FIT.has(code)) unsupported.push(code);
    }
    return { machine, storage, spectrum, joystick, midi, unsupported };
}

// Pick the file to run out of an archive's list ({name, type}). zxart names
// the file it means (launchFilePath) when it knows; otherwise a disk the
// machine boots beats a tape, a tape beats a snapshot, and within a kind the
// first one wins (side A, part 1).
const KIND_ORDER = ['trd', 'scl', 'udi', 'dsk', 'kdi', 'mgt', 'opd', 'd80', 'd40', 'mdr',
                    'tzx', 'tap', 'z80', 'szx', 'sna', 'dck', 'rzx', 'wav'];

export function pickLaunchFile(files, launchFilePath = '') {
    if (!files || !files.length) return -1;
    if (launchFilePath) {
        const want = launchFilePath.replace(/\\/g, '/').toLowerCase();
        const base = want.split('/').pop();
        let i = files.findIndex(f => f.name.replace(/\\/g, '/').toLowerCase() === want);
        if (i < 0) i = files.findIndex(f => f.name.replace(/\\/g, '/').toLowerCase().endsWith('/' + want));
        if (i < 0) i = files.findIndex(f => f.name.replace(/\\/g, '/').split('/').pop().toLowerCase() === base);
        if (i >= 0) return i;
    }
    const rank = (f) => {
        const r = KIND_ORDER.indexOf(f.type || fileExt(f.name));
        return r < 0 ? KIND_ORDER.length : r;
    };
    let best = 0;
    for (let i = 1; i < files.length; i++) {
        if (rank(files[i]) < rank(files[best])) best = i;
    }
    return best;
}
