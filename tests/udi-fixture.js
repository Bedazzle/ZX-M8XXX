// Build a UDI out of described sectors, for tests.
//
// Going this way round is the point. Every other disk fixture here is a sector
// image, and a sector image is exactly what cannot express the things UDI
// support exists for -- a 512-byte sector, a sector numbered outside 1..16, a
// deleted-data mark, a wrong CRC, an ID field claiming the wrong cylinder. So
// the track bytes are written out longhand: 12 sync zeros, three 0xA1 carrying
// clock bits, the address mark, the payload, a real CRC-16, and 0x4E gaps --
// the layout a formatter writes.
//
// The two things the format gets wrong or leaves open (the file checksum is not
// a standard CRC-32; the clock bitmap is LSB-first) are pinned against five real
// images in tests/udi-test.html. This module takes them as settled and builds on
// them, so a test using it is testing the consumer, not the format.

import { crcFdc, crcUdi } from '../core/loaders/disk-udi.js';

/**
 * One track's raw bytes + clock bitmap.
 * Each sector: { cylinder, head, sector, sizeCode, data, deleted?, badDataCrc?, badIdCrc? }
 * `sizeCode` 0..3 means 128/256/512/1024 bytes and must match data.length.
 */
export function mfmTrack(sectors) {
    const bytes = [], clocked = [];
    const put = (v, clock = false) => { bytes.push(v); clocked.push(clock); };
    const run = (n, v) => { for (let i = 0; i < n; i++) put(v); };
    // Only the three 0xA1 carry a clock bit -- what the real images do; the
    // 0xFE/0xFB after them reads as a mark without one.
    const sync = () => { run(12, 0x00); for (let i = 0; i < 3; i++) put(0xA1, true); };

    run(80, 0x4E);                                      // gap 4a
    for (const s of sectors) {
        sync();
        put(0xFE);
        put(s.cylinder); put(s.head); put(s.sector); put(s.sizeCode);
        let idCrc = crcFdc(new Uint8Array(
            [0xA1, 0xA1, 0xA1, 0xFE, s.cylinder, s.head, s.sector, s.sizeCode]));
        if (s.badIdCrc) idCrc ^= 0xFFFF;
        put(idCrc >> 8); put(idCrc & 0xFF);
        run(22, 0x4E);                                  // gap 2
        sync();
        const mark = s.deleted ? 0xF8 : 0xFB;
        put(mark);
        for (const v of s.data) put(v);
        const covered = new Uint8Array(4 + s.data.length);
        covered.set([0xA1, 0xA1, 0xA1, mark], 0);
        covered.set(s.data, 4);
        let dataCrc = crcFdc(covered);
        if (s.badDataCrc) dataCrc ^= 0xFFFF;
        put(dataCrc >> 8); put(dataCrc & 0xFF);
        run(54, 0x4E);                                  // gap 3
    }

    const data = new Uint8Array(bytes);
    const clock = new Uint8Array((data.length >> 3) + ((data.length & 7) ? 1 : 0));
    for (let i = 0; i < clocked.length; i++) if (clocked[i]) clock[i >> 3] |= 1 << (i & 7);
    return { data, clock };
}

/**
 * A whole UDI file.
 * `trackSectors` is indexed cylinder-major, side-minor -- the order the format
 * stores records in and the order the loader walks them.
 */
export function buildUDI(trackSectors, { sides = 2, breakCrc = false } = {}) {
    const records = trackSectors.map(mfmTrack);
    const cylinders = Math.ceil(records.length / sides);

    let total = 16;                                     // header, no extension
    for (const r of records) total += 3 + r.data.length + r.clock.length;

    const b = new Uint8Array(total + 4);
    b.set([0x55, 0x44, 0x49, 0x21], 0);                 // 'UDI!'
    b[4] = total & 0xFF; b[5] = (total >> 8) & 0xFF;
    b[6] = (total >> 16) & 0xFF; b[7] = (total >>> 24) & 0xFF;
    b[8] = 0;                                           // v1.0
    b[9] = cylinders - 1; b[10] = sides - 1;

    let p = 16;
    for (const r of records) {
        b[p] = 0x00;                                    // MFM, no MF/weak maps
        b[p + 1] = r.data.length & 0xFF; b[p + 2] = r.data.length >> 8;
        b.set(r.data, p + 3);
        b.set(r.clock, p + 3 + r.data.length);
        p += 3 + r.data.length + r.clock.length;
    }

    const crc = (crcUdi(b, total) ^ (breakCrc ? 0xFF : 0)) >>> 0;
    b[total] = crc & 0xFF; b[total + 1] = (crc >> 8) & 0xFF;
    b[total + 2] = (crc >> 16) & 0xFF; b[total + 3] = (crc >>> 24) & 0xFF;
    return b;
}

/** 16 ordinary 256-byte sectors, each filled with a recognisable byte. */
export function normalTrack(cylinder, head, fill = (sec) => sec) {
    const out = [];
    for (let s = 1; s <= 16; s++) {
        out.push({
            cylinder, head, sector: s, sizeCode: 1,
            data: new Uint8Array(256).fill(fill(s) & 0xFF),
        });
    }
    return out;
}
