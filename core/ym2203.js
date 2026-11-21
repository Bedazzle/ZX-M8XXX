/**
 * ZX-M8XXX - YM2203 (OPN) FM part, for TurboSound FM
 * @license GPL-3.0
 *
 * A port of the OPN parts of ymfm (ymfm_fm.ipp / ymfm_opn.cpp; BSD-3-Clause,
 * Copyright (c) 2021, Aaron Giles), the core Unreal-NG plays TS-FM with:
 * 3 channels x 4 operators, 8 algorithms, feedback, the OPN envelope with
 * SSG-EG, detune / multiple, the channel 3 special (multi-frequency) mode and
 * CSM, timers A / B and the busy flag. No LFO (the YM2203 has none).
 *
 * The SSG half of the chip is the emulator's AY (core/ay.js); this class is
 * only the FM half. One FM sample (an engine clock) every 72 master clocks
 * (12 operators x prescale 6); TS-FM runs the chip at 3.5 MHz, so 48.6 kHz.
 */

const SIN = [
    0x859,0x6c3,0x607,0x58b,0x52e,0x4e4,0x4a6,0x471,0x443,0x41a,0x3f5,0x3d3,0x3b5,0x398,0x37e,0x365,
    0x34e,0x339,0x324,0x311,0x2ff,0x2ed,0x2dc,0x2cd,0x2bd,0x2af,0x2a0,0x293,0x286,0x279,0x26d,0x261,
    0x256,0x24b,0x240,0x236,0x22c,0x222,0x218,0x20f,0x206,0x1fd,0x1f5,0x1ec,0x1e4,0x1dc,0x1d4,0x1cd,
    0x1c5,0x1be,0x1b7,0x1b0,0x1a9,0x1a2,0x19b,0x195,0x18f,0x188,0x182,0x17c,0x177,0x171,0x16b,0x166,
    0x160,0x15b,0x155,0x150,0x14b,0x146,0x141,0x13c,0x137,0x133,0x12e,0x129,0x125,0x121,0x11c,0x118,
    0x114,0x10f,0x10b,0x107,0x103,0x0ff,0x0fb,0x0f8,0x0f4,0x0f0,0x0ec,0x0e9,0x0e5,0x0e2,0x0de,0x0db,
    0x0d7,0x0d4,0x0d1,0x0cd,0x0ca,0x0c7,0x0c4,0x0c1,0x0be,0x0bb,0x0b8,0x0b5,0x0b2,0x0af,0x0ac,0x0a9,
    0x0a7,0x0a4,0x0a1,0x09f,0x09c,0x099,0x097,0x094,0x092,0x08f,0x08d,0x08a,0x088,0x086,0x083,0x081,
    0x07f,0x07d,0x07a,0x078,0x076,0x074,0x072,0x070,0x06e,0x06c,0x06a,0x068,0x066,0x064,0x062,0x060,
    0x05e,0x05c,0x05b,0x059,0x057,0x055,0x053,0x052,0x050,0x04e,0x04d,0x04b,0x04a,0x048,0x046,0x045,
    0x043,0x042,0x040,0x03f,0x03e,0x03c,0x03b,0x039,0x038,0x037,0x035,0x034,0x033,0x031,0x030,0x02f,
    0x02e,0x02d,0x02b,0x02a,0x029,0x028,0x027,0x026,0x025,0x024,0x023,0x022,0x021,0x020,0x01f,0x01e,
    0x01d,0x01c,0x01b,0x01a,0x019,0x018,0x017,0x017,0x016,0x015,0x014,0x014,0x013,0x012,0x011,0x011,
    0x010,0x00f,0x00f,0x00e,0x00d,0x00d,0x00c,0x00c,0x00b,0x00a,0x00a,0x009,0x009,0x008,0x008,0x007,
    0x007,0x007,0x006,0x006,0x005,0x005,0x005,0x004,0x004,0x004,0x003,0x003,0x003,0x002,0x002,0x002,
    0x002,0x001,0x001,0x001,0x001,0x001,0x001,0x001,0x000,0x000,0x000,0x000,0x000,0x000,0x000,0x000
];
const POW_RAW = [
    0x3fa,0x3f5,0x3ef,0x3ea,0x3e4,0x3df,0x3da,0x3d4,0x3cf,0x3c9,0x3c4,0x3bf,0x3b9,0x3b4,0x3ae,0x3a9,
    0x3a4,0x39f,0x399,0x394,0x38f,0x38a,0x384,0x37f,0x37a,0x375,0x370,0x36a,0x365,0x360,0x35b,0x356,
    0x351,0x34c,0x347,0x342,0x33d,0x338,0x333,0x32e,0x329,0x324,0x31f,0x31a,0x315,0x310,0x30b,0x306,
    0x302,0x2fd,0x2f8,0x2f3,0x2ee,0x2e9,0x2e5,0x2e0,0x2db,0x2d6,0x2d2,0x2cd,0x2c8,0x2c4,0x2bf,0x2ba,
    0x2b5,0x2b1,0x2ac,0x2a8,0x2a3,0x29e,0x29a,0x295,0x291,0x28c,0x288,0x283,0x27f,0x27a,0x276,0x271,
    0x26d,0x268,0x264,0x25f,0x25b,0x257,0x252,0x24e,0x249,0x245,0x241,0x23c,0x238,0x234,0x230,0x22b,
    0x227,0x223,0x21e,0x21a,0x216,0x212,0x20e,0x209,0x205,0x201,0x1fd,0x1f9,0x1f5,0x1f0,0x1ec,0x1e8,
    0x1e4,0x1e0,0x1dc,0x1d8,0x1d4,0x1d0,0x1cc,0x1c8,0x1c4,0x1c0,0x1bc,0x1b8,0x1b4,0x1b0,0x1ac,0x1a8,
    0x1a4,0x1a0,0x19c,0x199,0x195,0x191,0x18d,0x189,0x185,0x181,0x17e,0x17a,0x176,0x172,0x16f,0x16b,
    0x167,0x163,0x160,0x15c,0x158,0x154,0x151,0x14d,0x149,0x146,0x142,0x13e,0x13b,0x137,0x134,0x130,
    0x12c,0x129,0x125,0x122,0x11e,0x11b,0x117,0x114,0x110,0x10c,0x109,0x106,0x102,0x0ff,0x0fb,0x0f8,
    0x0f4,0x0f1,0x0ed,0x0ea,0x0e7,0x0e3,0x0e0,0x0dc,0x0d9,0x0d6,0x0d2,0x0cf,0x0cc,0x0c8,0x0c5,0x0c2,
    0x0be,0x0bb,0x0b8,0x0b5,0x0b1,0x0ae,0x0ab,0x0a8,0x0a4,0x0a1,0x09e,0x09b,0x098,0x094,0x091,0x08e,
    0x08b,0x088,0x085,0x082,0x07e,0x07b,0x078,0x075,0x072,0x06f,0x06c,0x069,0x066,0x063,0x060,0x05d,
    0x05a,0x057,0x054,0x051,0x04e,0x04b,0x048,0x045,0x042,0x03f,0x03c,0x039,0x036,0x033,0x030,0x02d,
    0x02a,0x028,0x025,0x022,0x01f,0x01c,0x019,0x016,0x014,0x011,0x00e,0x00b,0x008,0x006,0x003,0x000
];
const POW = POW_RAW.map(a => (a | 0x400) << 2);
const INC = [
    0x00000000, 0x00000000, 0x10101010, 0x10101010, 0x10101010, 0x10101010, 0x11101110, 0x11101110,
    0x10101010, 0x10111010, 0x11101110, 0x11111110, 0x10101010, 0x10111010, 0x11101110, 0x11111110,
    0x10101010, 0x10111010, 0x11101110, 0x11111110, 0x10101010, 0x10111010, 0x11101110, 0x11111110,
    0x10101010, 0x10111010, 0x11101110, 0x11111110, 0x10101010, 0x10111010, 0x11101110, 0x11111110,
    0x10101010, 0x10111010, 0x11101110, 0x11111110, 0x10101010, 0x10111010, 0x11101110, 0x11111110,
    0x10101010, 0x10111010, 0x11101110, 0x11111110, 0x10101010, 0x10111010, 0x11101110, 0x11111110,
    0x11111111, 0x21112111, 0x21212121, 0x22212221, 0x22222222, 0x42224222, 0x42424242, 0x44424442,
    0x44444444, 0x84448444, 0x84848484, 0x88848884, 0x88888888, 0x88888888, 0x88888888, 0x88888888
];
const DETUNE = [
    [0,0,1,2],[0,0,1,2],[0,0,1,2],[0,0,1,2],[0,1,2,2],[0,1,2,3],[0,1,2,3],[0,1,2,3],
    [0,1,2,4],[0,1,3,4],[0,1,3,4],[0,1,3,5],[0,2,4,5],[0,2,4,6],[0,2,4,6],[0,2,5,7],
    [0,2,5,8],[0,3,6,8],[0,3,6,9],[0,3,7,10],[0,4,8,11],[0,4,8,12],[0,4,9,13],[0,5,10,14],
    [0,5,11,16],[0,6,12,17],[0,6,13,19],[0,7,14,20],[0,8,16,22],[0,8,16,22],[0,8,16,22],[0,8,16,22]
];
const alg = (a, b, c, d, e, f) => a | (b << 1) | (c << 4) | (d << 7) | (e << 8) | (f << 9);
const ALGORITHMS = [
    alg(1,2,3, 0,0,0), alg(0,5,3, 0,0,0), alg(0,2,6, 0,0,0), alg(1,0,7, 0,0,0),
    alg(1,0,3, 0,1,0), alg(1,1,1, 0,1,1), alg(1,0,0, 0,1,1), alg(0,0,0, 1,1,1)
];
// The waveform: |sin| attenuation in 4.8 log, sign in bit 15
const WAVE = new Uint16Array(0x400);
for (let i = 0; i < 0x400; i++) {
    const x = (i & 0x100) ? (~i & 0xFF) : (i & 0xFF);
    WAVE[i] = SIN[x] | ((i & 0x200) ? 0x8000 : 0);
}

const EG_ATTACK = 1, EG_DECAY = 2, EG_SUSTAIN = 3, EG_RELEASE = 4;
const EG_QUIET = 0x380;
const KEYON_NORMAL = 0, KEYON_CSM = 2;
const bit = (v, s, n = 1) => (v >>> s) & ((1 << n) - 1);
const attToVol = (a) => POW[a & 0xFF] >> (a >> 8);
const effRate = (raw, ksr) => raw === 0 ? 0 : Math.min(raw + ksr, 63);

class Operator {
    constructor(chip, opoffs) {
        this.chip = chip; this.opoffs = opoffs; this.choffs = 0;
        this.cache = { phaseStep: 0, totalLevel: 0, blockFreq: 0, detune: 0, multiple: 1, egSustain: 0, egRate: [0, 0, 0, 0, 0] };
        this.reset();
    }
    reset() {
        this.phase = 0; this.att = 0x3ff; this.state = EG_RELEASE; this.ssgInv = false;
        this.keyState = 0; this.keyonLive = 0;
    }
    reg(base) { return this.chip.regs[base + this.opoffs]; }
    ssgEnable() { return bit(this.reg(0x90), 3); }
    ssgMode() { return bit(this.reg(0x90), 0, 3); }
    prepare() {
        this.chip.cacheOperator(this.choffs, this.opoffs, this.cache);
        this.clockKeystate(this.keyonLive !== 0 ? 1 : 0);
        if (this.keyonLive & (1 << KEYON_CSM)) {
            if (!(this.keyonLive & (1 << KEYON_NORMAL))) this.clockKeystate(0);
        }
        this.keyonLive &= ~(1 << KEYON_CSM);
        return this.state !== EG_RELEASE || this.att < EG_QUIET;
    }
    clock(envCounter) {
        if (this.ssgEnable()) this.clockSsg(); else this.ssgInv = false;
        if ((envCounter & 3) === 0) this.clockEnvelope(envCounter >>> 2);
        this.phase = (this.phase + this.cache.phaseStep) >>> 0;
    }
    envAtt() {
        let r = this.att;
        if (this.ssgInv) r = (0x200 - r) & 0x3ff;
        r += this.cache.totalLevel;
        return r > 0x3ff ? 0x3ff : r;
    }
    volume(phase) {
        if (this.att > EG_QUIET) return 0;
        const s = WAVE[phase & 0x3ff];
        const v = attToVol((s & 0x7fff) + (this.envAtt() << 2));
        return (s & 0x8000) ? -v : v;
    }
    keyonoff(on, type) { this.keyonLive = (this.keyonLive & ~(1 << type)) | ((on & 1) << type); }
    startAttack(restart = false) {
        if (this.state === EG_ATTACK) return;
        this.state = EG_ATTACK;
        if (!restart) {
            this.ssgInv = !!(this.ssgEnable() & bit(this.ssgMode(), 2));
            this.phase = 0;
        }
        if (this.cache.egRate[EG_ATTACK] >= 62) this.att = 0;
    }
    startRelease() {
        if (this.state >= EG_RELEASE) return;
        this.state = EG_RELEASE;
        if (this.ssgInv) { this.att = (0x200 - this.att) & 0x3ff; this.ssgInv = false; }
    }
    clockKeystate(ks) {
        if ((ks ^ this.keyState) !== 0) {
            this.keyState = ks;
            if (ks) this.startAttack(); else this.startRelease();
        }
    }
    clockSsg() {
        if (!bit(this.att, 9)) return;
        const mode = this.ssgMode();
        if (bit(mode, 0)) {
            this.ssgInv = !!(bit(mode, 2) ^ bit(mode, 1));
            if (this.state !== EG_ATTACK) this.att = this.ssgInv ? 0x200 : 0x3ff;
        } else {
            this.ssgInv = !!(this.ssgInv ^ bit(mode, 1));
            if (this.state === EG_DECAY || this.state === EG_SUSTAIN) this.startAttack(true);
            if (bit(mode, 1) === 0) this.phase = 0;
        }
        if (this.state === EG_RELEASE) this.att = 0x3ff;
    }
    clockEnvelope(envCounter) {
        if (this.state === EG_ATTACK && this.att === 0) this.state = EG_DECAY;
        if (this.state === EG_DECAY && this.att >= this.cache.egSustain) this.state = EG_SUSTAIN;
        const rate = this.cache.egRate[this.state];
        const rateShift = rate >> 2;
        const ec = (envCounter << rateShift) >>> 0;
        if ((ec & 0x7ff) !== 0) return;
        const relevant = bit(ec, rateShift <= 11 ? 11 : rateShift, 3);
        const inc = bit(INC[rate], 4 * relevant, 4);
        if (this.state === EG_ATTACK) {
            if (rate < 62) this.att += ((~this.att) * inc) >> 4;
        } else {
            if (!this.ssgEnable()) this.att += inc;
            else if (this.att < 0x200) this.att += 4 * inc;
            if (this.att >= 0x400) this.att = 0x3ff;
        }
    }
}

export class YM2203FM {
    constructor() {
        this.regs = new Uint8Array(256);
        // operator n at register offset n + n/3; channel c uses (c, c+6, c+3, c+9)
        this.ops = [];
        for (let n = 0; n < 12; n++) this.ops.push(new Operator(this, n + Math.floor(n / 3)));
        this.channels = [0, 1, 2].map(c => ({
            choffs: c, fb: [0, 0], fbIn: 0,
            op: [this.ops[c], this.ops[c + 6], this.ops[c + 3], this.ops[c + 9]]
        }));
        for (const ch of this.channels) for (const o of ch.op) o.choffs = ch.choffs;
        this.reset();
    }

    reset() {
        this.regs.fill(0);
        for (const o of this.ops) o.reset();
        for (const ch of this.channels) { ch.fb[0] = ch.fb[1] = 0; ch.fbIn = 0; }
        this.envCounter = 0;
        this.modified = true;
        this.prepareCount = 0;
        this.active = 7;
    }

    // ---- registers ----
    chBlockFreq(c) { return ((this.regs[0xa4 + c] & 0x3f) << 8) | this.regs[0xa0 + c]; }
    multiBlockFreq(n) { return ((this.regs[0xac + n] & 0x3f) << 8) | this.regs[0xa8 + n]; }
    multiFreq() { return bit(this.regs[0x27], 6, 2) !== 0; }
    csm() { return bit(this.regs[0x27], 6, 2) === 2; }

    cacheOperator(choffs, opoffs, cache) {
        let bf = this.chBlockFreq(choffs);
        if (this.multiFreq() && choffs === 2) {
            if (opoffs === 2) bf = this.multiBlockFreq(1);
            else if (opoffs === 10) bf = this.multiBlockFreq(2);
            else if (opoffs === 6) bf = this.multiBlockFreq(0);
        }
        cache.blockFreq = bf;
        let keycode = bit(bf, 10, 4) << 1;
        keycode |= bit(0xfe80, bit(bf, 7, 4));
        const dt = bit(this.regs[0x30 + opoffs], 4, 3);
        const d = DETUNE[keycode][dt & 3];
        cache.detune = (dt & 4) ? -d : d;
        cache.multiple = bit(this.regs[0x30 + opoffs], 0, 4) * 2 || 1;
        const fnum = bit(bf, 0, 11) << 1;
        const block = bit(bf, 11, 3);
        let step = ((fnum << block) >> 2) + cache.detune;
        step &= 0x1ffff;
        cache.phaseStep = (step * cache.multiple) >> 1;
        cache.totalLevel = bit(this.regs[0x40 + opoffs], 0, 7) << 3;
        let sl = bit(this.regs[0x80 + opoffs], 4, 4);
        sl |= (sl + 1) & 0x10;
        cache.egSustain = sl << 5;
        const ksr = keycode >> (bit(this.regs[0x50 + opoffs], 6, 2) ^ 3);
        cache.egRate[EG_ATTACK] = effRate(bit(this.regs[0x50 + opoffs], 0, 5) * 2, ksr);
        cache.egRate[EG_DECAY] = effRate(bit(this.regs[0x60 + opoffs], 0, 5) * 2, ksr);
        cache.egRate[EG_SUSTAIN] = effRate(bit(this.regs[0x70 + opoffs], 0, 5) * 2, ksr);
        cache.egRate[EG_RELEASE] = effRate(bit(this.regs[0x80 + opoffs], 0, 4) * 4 + 2, ksr);
    }

    /** An FM register (address >= $10) */
    write(index, data) {
        index &= 0xFF; data &= 0xFF;
        this.modified = true;
        if ((index & 0xf0) === 0xa0) {
            if ((index & 3) === 3) return;
            const latch = 0xb8 | bit(index, 3);
            if (bit(index, 2)) this.regs[latch] = data & 0x3f;
            else { this.regs[index] = data; this.regs[index | 4] = this.regs[latch]; }
            return;
        }
        if ((index & 0xf8) === 0xb8) return;
        this.regs[index] = data;
        if (index === 0x28) {
            const c = data & 3;
            if (c === 3) return;
            const mask = data >> 4;
            this.channels[c].op.forEach((o, i) => o.keyonoff((mask >> i) & 1, KEYON_NORMAL));
        }
    }

    /** Timer A ran out with CSM on: key channel 3 on for one sample */
    csmKeyOn() {
        if (!this.csm()) return;
        for (const o of this.channels[2].op) o.keyonoff(1, KEYON_CSM);
        this.modified = true;
    }

    // ---- one FM sample ----
    clock() {
        if (this.modified || this.prepareCount++ >= 4096) {
            this.active = 0;
            for (let c = 0; c < 3; c++) {
                let any = false;
                for (const o of this.channels[c].op) if (o.prepare()) any = true;
                if (any) this.active |= 1 << c;
            }
            this.modified = false;
            this.prepareCount = 0;
        }
        if (((++this.envCounter) & 3) === 3) this.envCounter += 1;   // EG divider 3
        for (const ch of this.channels) {
            ch.fb[0] = ch.fb[1];
            ch.fb[1] = ch.fbIn;
            for (const o of ch.op) o.clock(this.envCounter);
        }
        let out = 0;
        for (let c = 0; c < 3; c++) if (this.active & (1 << c)) out += this.output(this.channels[c]);
        return out < -32768 ? -32768 : out > 32767 ? 32767 : out;
    }

    output(ch) {
        const op = ch.op, ph = (o) => o.phase >>> 10;
        const fbLevel = bit(this.regs[0xb0 + ch.choffs], 3, 3);
        let opmod = fbLevel ? (ch.fb[0] + ch.fb[1]) >> (10 - fbLevel) : 0;
        const o1 = ch.fbIn = op[0].volume(ph(op[0]) + opmod);
        const a = ALGORITHMS[bit(this.regs[0xb0 + ch.choffs], 0, 3)];
        const out = [0, o1, 0, 0, 0, 0, 0, 0];
        opmod = out[bit(a, 0, 1)] >> 1;
        out[2] = op[1].volume(ph(op[1]) + opmod);
        out[5] = out[1] + out[2];
        opmod = out[bit(a, 1, 3)] >> 1;
        out[3] = op[2].volume(ph(op[2]) + opmod);
        out[6] = out[1] + out[3];
        out[7] = out[2] + out[3];
        opmod = out[bit(a, 4, 3)] >> 1;
        let r = op[3].volume(ph(op[3]) + opmod);
        const clip = (v) => v < -32768 ? -32768 : v > 32767 ? 32767 : v;
        if (bit(a, 7)) r = clip(r + out[1]);
        if (bit(a, 8)) r = clip(r + out[2]);
        if (bit(a, 9)) r = clip(r + out[3]);
        return r;
    }
}

/**
 * The CPU's side of a YM2203: the timers, their status flags and busy, in
 * master clocks (T-states on TS-FM). The status is what IN $FFFD returns in
 * status mode: bit 7 busy, bit 1 timer B, bit 0 timer A.
 */
export class YM2203Timers {
    constructor() { this.reset(); }
    reset() {
        this.ta = 0; this.tb = 0; this.mode = 0;
        this.status = 0;
        this.aLeft = -1; this.bLeft = -1;     // master clocks to expiry, -1 = stopped
        this.busyLeft = 0;
        this.onCsm = null;
    }
    advance(clocks) {
        if (this.busyLeft > 0) this.busyLeft = Math.max(0, this.busyLeft - clocks);
        for (let n = 0; n < 2; n++) {
            const key = n ? 'bLeft' : 'aLeft';
            if (this[key] < 0) continue;
            this[key] -= clocks;
            while (this[key] <= 0) {
                if (n === 0 && (this.mode & 0x04)) this.status |= 1;
                if (n === 1 && (this.mode & 0x08)) this.status |= 2;
                if (n === 0 && (this.mode & 0xC0) === 0x80 && this.onCsm) this.onCsm();
                this[key] += this._period(n);
            }
        }
    }
    _period(n) { return n === 0 ? (1024 - this.ta) * 72 : 16 * (256 - this.tb) * 72; }
    write(reg, val) {
        this.busyLeft = 32 * 6;
        if (reg === 0x24) this.ta = (this.ta & 3) | (val << 2);
        else if (reg === 0x25) this.ta = (this.ta & 0x3fc) | (val & 3);
        else if (reg === 0x26) this.tb = val;
        else if (reg === 0x27) {
            this.mode = val;
            if (val & 0x10) this.status &= ~1;
            if (val & 0x20) this.status &= ~2;
            if ((val & 1) && this.aLeft < 0) this.aLeft = this._period(0); else if (!(val & 1)) this.aLeft = -1;
            if ((val & 2) && this.bLeft < 0) this.bLeft = this._period(1); else if (!(val & 2)) this.bLeft = -1;
        }
    }
    readStatus() { return (this.busyLeft > 0 ? 0x80 : 0) | (this.status & 3); }
}
