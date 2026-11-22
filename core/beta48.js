/**
 * ZX-M8XXX - Beta 48: Technology Research "Beta Disk plus" (TR-DOS 4.x) and its clones
 * @license GPL-3.0-or-later
 *
 * The 48K-era Beta Disk Interface, as described by MAME's
 * src/devices/bus/spectrum/beta.cpp (N. Barnes, D. Haywood, MetalliC), which
 * follows the BDI schematics. What is taken from it is the hardware
 * behaviour it documents, not its code. That file is BSD-3-Clause
 * (https://opensource.org/license/bsd-3-clause) and its copyright stays
 * with its authors — a licence GPL-3.0-or-later admits with the notice
 * kept, so the credit stands however closely the two are read.
 *
 * The behaviour:
 *
 *   - its ROM answers ANY memory access (opcode, data) to $3C00-$3CFF, for
 *     that access only — there is no Beta 128-style "stays paged" state;
 *   - and the whole $0000-$3FFF while the ROM latch is set: bit 7 of the
 *     system port ($FF, decoded 1xxxx111) = 0. Reset clears the port, so the
 *     DOS boots first;
 *   - a write to any port xxxxxx00 (e.g. $FC, also the border) sets the
 *     "master" register: bit 7 = 1 switches the interface's I/O off (the
 *     ports then pass through, so $1F is the Kempston joystick again);
 *   - I/O as on the Beta 128: FDC registers at 0YYxx111 ($1F/$3F/$5F/$7F),
 *     system port at 1xxxx111 ($FF): write = drive, side, reset, HLT, DDEN,
 *     ROM latch; read = INTRQ (bit 7), DRQ (bit 6);
 *   - the "magic button" raises NMI with the ROM paged in (latch set).
 *
 * Variants (selected by Spectrum.betaVariant, or worked out from the ROM):
 *   'plus'   Beta Disk plus, TR-DOS 4.09/4.11/4.12, CAS-DOS, IC-DOS: 8KB ROM,
 *            shown twice in $0000-$3FFF. Original boards have D0 and D7 of the
 *            ROM swapped, so a "proper" dump reads with those bits crossed;
 *            loadBeta48Rom() straightens it.
 *   'vision' Vision Desktop clones (TR-DOS 4.12-4.83): 16KB ROM, no swap.
 *   'cbi'    Brazilian clones — CBI-95, SYNCHRON IDS91/IDS2001ne, ARCADE AR-20:
 *            16KB ROM, FD1797, a printer port, and bit 6 of the master
 *            register switches the $3Cxx window off. The system port reads
 *            bit 4 = 1 (a jumper) and bit 5 = printer BUSY.
 */

// CRC32 of MAME's dumps -> what they are. `swapped`: the dump has D0/D7 crossed.
const KNOWN_ROMS = {
    '18365bdc': { variant: 'plus', name: 'TR-DOS 4.09', swapped: true },
    '26902902': { variant: 'plus', name: 'TR-DOS 4.11', swapped: true },
    'f72efdf4': { variant: 'plus', name: 'TR-DOS 4.12', swapped: true },
    '4313234c': { variant: 'plus', name: 'TR-DOS 4.12 (FD1797)', swapped: true },
    'da0cfdcc': { variant: 'plus', name: 'CAS DOS 1986', swapped: true },
    'a6a9450c': { variant: 'plus', name: 'CAS DOS 1987', swapped: true },
    '1398d13a': { variant: 'plus', name: 'IC-DOS JUMBO 2.0', swapped: true },
    // Brazilian CAS DOS 1986, as passed around: the raw EPROM (D0/D7 crossed on
    // the board, per its own note) and the decoded image
    'af7b92b1': { variant: 'plus', name: 'CAS DOS 1986', swapped: true },
    '63effffe': { variant: 'plus', name: 'CAS DOS 1986', swapped: false },
    '20f49ff5': { variant: 'vision', name: 'Vision 1.0 (TR-DOS 4.12)', swapped: false },
    '9903f577': { variant: 'vision', name: 'Vision 1.4 (TR-DOS 4.40)', swapped: false },
    'ecee1ff1': { variant: 'vision', name: 'Vision 1.7 (TR-DOS 4.82)', swapped: false },
    'c192a6b1': { variant: 'vision', name: 'Vision 1.7 (TR-DOS 4.83)', swapped: false },
    '3ee7a488': { variant: 'vision', name: 'Vision 1.8 (TR-DOS 4.80)', swapped: false },
    '1a793d53': { variant: 'vision', name: 'Vision 1.9 (TR-DOS 4.81)', swapped: false },
    '7fbefca6': { variant: 'cbi', name: 'CBI-95 v2.3', swapped: false },
    'afe4cec3': { variant: 'cbi', name: 'CBI-95 v2.4', swapped: false },
    'd569c67a': { variant: 'cbi', name: 'SYNCHRON IDS91', swapped: false },
    'a1701f84': { variant: 'cbi', name: 'SYNCHRON IDS2001ne', swapped: false },
    '0ceeaa4d': { variant: 'cbi', name: 'ARCADE AR-20', swapped: false },
};

export const BETA_VARIANTS = {
    '128':    'Beta 128 (TR-DOS 5.x)',
    'auto':   'Beta 48 — from the ROM',
    'plus':   'Beta 48 — Beta Disk plus / Vision',
    'cbi':    'Beta 48 — CBI-95 / IDS / AR-20',
};

let crcTable = null;
export function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            crcTable[n] = c >>> 0;
        }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}

// Swap data bits 0 and 7 (the original BDI board wiring)
export function swapD0D7(bytes) {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        out[i] = (b & 0x7E) | ((b & 1) << 7) | ((b >> 7) & 1);
    }
    return out;
}

// How readable the ROM's own name is: counts "DOS"/"VISION"/"Beta" texts.
// A crossed D0/D7 garbles every letter with bit 0 set, so the right way
// round is the one where they read.
function textScore(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        s += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '\n';
    }
    return (s.match(/TR-?DOS|VISION|Technology Research|DOS/g) || []).length;
}

/**
 * Identify a Beta 48 ROM image and bring it to the form the emulator maps:
 * 16KB, bits the right way round, an 8KB ROM shown twice.
 * @returns {{rom: Uint8Array, variant: string, name: string, swapped: boolean, known: boolean}}
 */
export function prepareBeta48Rom(data) {
    let bytes = new Uint8Array(data instanceof ArrayBuffer ? data : (data.buffer ? data : new Uint8Array(data)));
    if (bytes.length !== 8192 && bytes.length !== 16384) {
        throw new Error(`Beta 48 ROM must be 8KB or 16KB, got ${bytes.length} bytes`);
    }
    let info = null;
    // The whole image, or an 8KB ROM stored twice in a 16KB file
    for (const part of [bytes, bytes.length === 16384 ? bytes.subarray(0, 8192) : null]) {
        if (!part) continue;
        const k = KNOWN_ROMS[crc32(part)];
        if (k) { info = { ...k, known: true }; break; }
        const ks = KNOWN_ROMS[crc32(swapD0D7(part))];
        if (ks) { info = { ...ks, swapped: !ks.swapped, known: true }; break; }
    }
    let swapped;
    if (info) {
        swapped = info.swapped;
    } else {
        swapped = textScore(swapD0D7(bytes)) > textScore(bytes);
    }
    if (swapped) bytes = swapD0D7(bytes);
    if (!info) {
        const t = textScore(bytes) && String.fromCharCode(...bytes);
        const vision = t && /VISION/i.test(t);
        const m = t && t.match(/TR-?DOS ?(?:Ver )?\d\.\d+\w?/i);
        info = {
            variant: vision ? 'vision' : 'plus',
            name: m ? m[0] : (vision ? 'Vision' : 'unknown ROM'),
            known: false
        };
    }
    const rom = new Uint8Array(16384);
    if (bytes.length === 8192) {
        rom.set(bytes, 0);
        rom.set(bytes, 8192);
    } else {
        rom.set(bytes);
    }
    // 'vision' behaves as 'plus' on the bus; keep the name for the UI
    return { rom, variant: info.variant, name: info.name, swapped, known: info.known };
}
