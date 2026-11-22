// rom-loader.js — puts a machine's ROMs (and its interfaces' ROMs) into a Spectrum.
//
// Shared by the full app (ui/rom-selector.js, zxDebug.ensureRom) and the
// embeddable player (ui/player.js), which has no ROM dialog. `romData` is a
// plain { 'file.rom': ArrayBuffer } cache owned by the caller.

import { getMachineProfile } from './machines.js';
import { storageGet } from './utils.js';

// Page the ROMs for `machineType` from romData into `spec`. Returns false when
// the machine's own ROM is not there.
export function applyRoms(spec, machineType, romData) {
    const profile = getMachineProfile(machineType);
    const rom = romData[profile.romFile];
    if (!rom) return false;
    for (let bank = 0; bank < profile.romBanks; bank++) {
        spec.memory.loadRom(rom.slice(bank * 16384, (bank + 1) * 16384), bank);
    }
    // Load TR-DOS ROM if available (for Beta Disk interface)
    // Skip for machines with TR-DOS built into main ROM (e.g. Scorpion)
    if (!profile.trdosInRom && romData['trdos.rom'] && (profile.betaDiskDefault || spec.betaDiskEnabled)) {
        spec.memory.loadTrdosRom(romData['trdos.rom']);
    }
    // Beta 48 ROM (TR-DOS 4.x / Vision / CBI-95...) for an add-on Beta set to a
    // Beta 48 variant; identified and straightened by core/beta48.js
    if (romData['beta48.rom'] && !profile.betaDiskDefault && spec.betaDiskEnabled &&
        spec.betaVariant !== '128' && spec.loadBeta48Rom) {
        try { spec.loadBeta48Rom(romData['beta48.rom']); }
        catch (e) { console.warn('[Beta 48] ' + e.message); }
    }
    // Update TR-DOS ROM flag for trap handler (must be called for all machines,
    // including Scorpion where TR-DOS is in main ROM bank)
    if (spec.trdosTrap) spec.trdosTrap.updateTrdosRomFlag();
    if (romData['plusd.rom'] && spec.plusDEnabled) {
        spec.memory.loadPlusDRom(romData['plusd.rom']);
    }
    if (romData['disciple.rom'] && spec.discipleEnabled) {
        spec.memory.loadDiscipleRom(romData['disciple.rom']);
    }
    if (romData['if1.rom'] && spec.if1Enabled) {
        spec.memory.loadIF1Rom(romData['if1.rom']);
    }
    if (romData['opus.rom'] && spec.opusEnabled) {
        spec.memory.loadOpusRom(romData['opus.rom']);
    }
    if (romData['didaktik.rom'] && spec.didaktikEnabled) {
        spec.memory.loadDidaktikRom(romData['didaktik.rom']);
    }
    // Timex FDD 3000: the interface ROM (fdd3stavi.rom for a Spectrum, or
    // fdd3timex.rom) and the station's boot ROM
    if (spec.fdd3000 && spec.fdd3000Enabled) {
        const ifr = romData[spec.fdd3000RomFile], boot = romData['fdd3000-boot.rom'];
        try {
            if (ifr) spec.fdd3000.loadRom(new Uint8Array(ifr));
            if (boot) spec.fdd3000.loadBootRom(new Uint8Array(boot));
        } catch (e) { console.warn('[FDD 3000] ' + e.message); }
    }
    // Kempston Disc: K-DOS
    if (spec.kempdisc && spec.kempdiscEnabled) {
        const kd = romData[spec.kempdiscRomFile];
        try { if (kd) spec.kempdisc.loadRom(new Uint8Array(kd)); }
        catch (e) { console.warn('[Kempston Disc] ' + e.message); }
    }
    // HC-2000: its HC IF1 is built in, so its ROM goes with the machine
    if (romData['hc-if1.rom'] && profile.pagingModel === 'hc2000' && spec.hcIf1) {
        spec.memory.loadHcIf1Rom(romData['hc-if1.rom']);
    }
    // Recalculate paging flags AFTER all ROMs are loaded — hasPlusDRom()/hasIF1Rom()
    // must return true for _plusDPagingEnabled/_if1PagingEnabled to be set
    spec.updateBetaDiskPagingFlag();
    spec.romLoaded = true;
    return true;
}

// Fetch into romData the ROM files `machineType` needs on `spec`: the machine's
// own (an error if it is missing) and those of the interfaces `spec` has
// switched on (optional: without one the machine just lacks that interface).
// `base` is the URL of the roms/ directory, with its trailing slash.
//
// It fetches the INTERFACE ROMs too, not just the machine's own: setMachineType
// builds a `new Memory` whose TR-DOS ROM is zeroed until applyRoms puts it back,
// so a Pentagon whose trdos.rom had not landed yet sat in its menu, and nothing
// healed it afterwards.
export async function fetchRoms(spec, machineType, romData, base = 'roms/') {
    const profile = getMachineProfile(machineType);
    if (!profile) throw new Error(`Unknown machine: ${machineType}`);
    const get = async (file) => {
        try {
            const res = await fetch(base + file);
            return res.ok ? await res.arrayBuffer() : null;
        } catch (e) { return null; }
    };
    if (!romData[profile.romFile] && profile.romFile === 'hc2000.rom') {
        // HC-2000 also comes as FUSE's two 16KB halves
        const halves = await Promise.all([get('hc2000-0.rom'), get('hc2000-1.rom')]);
        if (halves[0] && halves[1]) {
            const full = new Uint8Array(32768);
            full.set(new Uint8Array(halves[0]).subarray(0, 16384), 0);
            full.set(new Uint8Array(halves[1]).subarray(0, 16384), 16384);
            romData['hc2000.rom'] = full.buffer;
        }
    }
    if (!romData[profile.romFile] && profile.romFile === 'tc2068.rom') {
        // TC2068 also comes as FUSE's tc2068-0.rom (16KB) + tc2068-1.rom (8KB)
        const parts = await Promise.all([get('tc2068-0.rom'), get('tc2068-1.rom')]);
        if (parts[0] && parts[1]) {
            const full = new Uint8Array(24576).fill(0xFF);
            full.set(new Uint8Array(parts[0]).subarray(0, 16384), 0);
            full.set(new Uint8Array(parts[1]).subarray(0, 8192), 16384);
            romData['tc2068.rom'] = full.buffer;
        }
    }
    if (!romData[profile.romFile]) {
        const res = await fetch(base + profile.romFile);
        if (!res.ok) throw new Error(`roms/${profile.romFile} not available (HTTP ${res.status})`);
        romData[profile.romFile] = await res.arrayBuffer();
    }
    const maybe = async (file) => {
        if (!file || romData[file]) return;
        const data = await get(file);
        if (data) romData[file] = data;
    };
    // Beta Disk follows the TARGET machine, worked out the way setMachineType
    // does it -- reading spec.betaDiskEnabled would answer for the machine
    // being left behind.
    const betaDisk = profile.betaDiskDefault || storageGet('zxm8_betaDisk') === 'true';
    const wanted = [];
    if (!profile.trdosInRom && betaDisk) wanted.push('trdos.rom');
    if (betaDisk && !profile.betaDiskDefault && spec.betaVariant !== '128') wanted.push('beta48.rom');
    if (spec.plusDEnabled) wanted.push('plusd.rom');
    if (spec.discipleEnabled) wanted.push('disciple.rom');
    if (spec.if1Enabled) wanted.push('if1.rom');
    if (spec.opusEnabled) wanted.push('opus.rom');
    if (spec.didaktikEnabled) wanted.push('didaktik.rom');
    if (spec.fdd3000Enabled) wanted.push(spec.fdd3000RomFile, 'fdd3000-boot.rom');
    if (spec.kempdiscEnabled) wanted.push(spec.kempdiscRomFile);
    if (profile.pagingModel === 'hc2000') wanted.push('hc-if1.rom');   // built-in HC IF1
    await Promise.all(wanted.map(maybe));
    return !!romData[profile.romFile];
}
