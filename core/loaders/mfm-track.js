/**
 * ZX-M8XXX - One raw MFM track, parsed and built (pure)
 * @license GPL-3.0
 *
 * A sector read hands the controller an address and gets 256 or 512 bytes back.
 * Formatting does not work like that at all: the host streams the WHOLE track at
 * the chip — gaps, sync fields, address marks, the ID of every sector and its
 * data field — and the chip writes the lot between one index pulse and the next.
 * There is no "format a sector" command, which is why a disk interface that
 * cannot do Write Track cannot make a disk at all, only edit one somebody else
 * made.
 *
 * So this module is the two halves of that stream:
 *
 *   `parseTrackStream`  what the host wrote → the sectors it laid down
 *   `buildTrackStream`  the sectors on a track → the bytes a Read Track returns
 *
 * They are deliberately not quite inverses, because the two directions are not
 * the same bytes. During Write Track four values are INSTRUCTIONS to the chip
 * rather than data: `$F5` writes an `A1` with a missing clock transition and
 * presets the CRC generator, `$F6` writes a `C2` the same way, and `$F7` writes
 * the two CRC bytes it has accumulated. Read Track reads the medium, so it gives
 * back the real `A1` bytes and the real CRCs. `marks: 'stream'` builds the first
 * form, `marks: 'medium'` (the default) the second.
 *
 * Two things this does not model, both decisions:
 *
 * - **MFM only.** Every interface in this emulator runs its controller in double
 *   density; FM would need the DDEN pin, which nothing drives. In FM the marks
 *   carry their own missing clocks and `$F5`/`$F6` are illegal, so supporting it
 *   means a second state machine with no caller.
 * - **`$F5` inside a data field is taken as data.** On real hardware it is not —
 *   it would write a sync byte into the middle of a sector and preset the CRC,
 *   which is exactly why Write Track cannot lay down arbitrary content and why
 *   every formatter fills data fields with `$E5` or `$00`. Honouring it here
 *   would mean refusing to parse a stream no formatter produces.
 */

import { crcFdc } from './disk-udi.js';

// 250 kbit/s MFM at 300 rpm: one byte every 32 µs, 200 ms a revolution. A
// formatter writes about this many bytes and lets the index pulse cut it off.
export const TRACK_BYTES_MFM = 6250;

// The four values a WD177x/WD179x acts on instead of writing through.
export const WT_A1 = 0xF5;    // write A1 with a missing clock; preset the CRC
export const WT_C2 = 0xF6;    // write C2 with a missing clock
export const WT_CRC = 0xF7;   // write the two accumulated CRC bytes

// Address marks, as they appear on the medium and in the stream alike.
export const AM_ID = 0xFE;
export const AM_DATA = 0xFB;
export const AM_DELETED = 0xF8;

export const MARK_A1 = 0xA1;  // what $F5 actually puts on the disk
export const GAP_BYTE = 0x4E; // MFM gap filler
export const SYNC_BYTE = 0x00;

/** The ID field's N → the data field's length. */
export function sectorSize(sizeCode) {
    return 128 << (sizeCode & 0x03);
}

/**
 * What a Write Track stream laid down.
 *
 * Walks the stream the way the chip does — a mark only counts as a mark when a
 * `$F5` put a missing clock in front of it, so an `$FE` sitting in the middle of
 * a data field is just a byte. An ID field with no data field after it is
 * dropped: the chip wrote it, but there is no sector there to record.
 *
 * Returns `{ sectors, truncated }`. `truncated` says the stream ended inside a
 * field, which is what a Force Interrupt mid-format looks like.
 */
export function parseTrackStream(bytes) {
    const sectors = [];
    let pending = null;    // an ID field whose data field has not arrived yet
    let marked = false;    // the byte before this one was a $F5
    let truncated = false;
    let i = 0;

    while (i < bytes.length) {
        const b = bytes[i];

        if (b === WT_A1) { marked = true; i++; continue; }
        if (!marked) { i++; continue; }
        marked = false;

        if (b === AM_ID) {
            if (i + 5 > bytes.length) { truncated = true; break; }
            pending = {
                cylinder: bytes[i + 1],
                head: bytes[i + 2],
                sector: bytes[i + 3],
                sizeCode: bytes[i + 4] & 0x03,
            };
            i += 5;
            if (bytes[i] === WT_CRC) i++;
            continue;
        }

        if ((b === AM_DATA || b === AM_DELETED) && pending) {
            const len = sectorSize(pending.sizeCode);
            if (i + 1 + len > bytes.length) { truncated = true; break; }
            sectors.push({
                cylinder: pending.cylinder,
                head: pending.head,
                sector: pending.sector,
                sizeCode: pending.sizeCode,
                deleted: b === AM_DELETED,
                data: bytes.slice(i + 1, i + 1 + len),
            });
            pending = null;
            i += 1 + len;
            if (bytes[i] === WT_CRC) i++;
            continue;
        }

        i++;
    }

    return { sectors, truncated };
}

/**
 * The bytes on a track that holds these sectors.
 *
 * `sectors` is `[{ sector, sizeCode?, cylinder?, head?, data?, fill?, deleted? }]`
 * in the order they pass under the head — which for a flat sector dump is the
 * only order there is, since an image like that records no interleave.
 *
 * **Gap 3 is computed, not a constant**, because no constant works. A revolution
 * holds 6250 bytes; 18 Opus sectors of 256 leave 91 bytes an apiece for
 * everything that is not data and 10 MGT sectors of 512 leave 113, so a gap long
 * enough for the one overruns the other. A real formatter divides out what is
 * left after the sectors, and so does this. Pass `gap3` to override it.
 *
 * The result is `trackLen` bytes padded with `$4E`, or longer if the sectors
 * asked for cannot fit even at the minimum gap — a geometry that could not exist
 * on a real disk is still reported as asked for, rather than silently losing its
 * last sectors.
 */
export function buildTrackStream(spec = {}) {
    const {
        cylinder = 0,
        head = 0,
        sectors = [],
        trackLen = TRACK_BYTES_MFM,
        gap1 = 60,      // post-index gap
        gap2 = 22,      // ID field → data field
        sync = 12,      // the $00 run before each sync field
        marks = 'medium',
    } = spec;

    const stream = marks === 'stream';
    const a1 = stream ? WT_A1 : MARK_A1;

    // Everything on the track that is not gap 3, and not the data either. The
    // CRC is counted at its size on the MEDIUM (two bytes) whichever form is
    // being built: the gap has to fit the disk, not the stream.
    let fixed = gap1;
    let dataBytes = 0;
    for (const s of sectors) {
        dataBytes += sectorSize(s.sizeCode === undefined ? 2 : s.sizeCode);
        fixed += sync + 3 + 1 + 4 + 2 + gap2 + sync + 3 + 1 + 2;
    }

    // Share out what a revolution has left. Clamped below so a geometry that
    // cannot fit still gets a separable track, and above at the System 34
    // figure so a sparse one does not get an absurd gap.
    const gap3 = spec.gap3 !== undefined ? spec.gap3 : (sectors.length
        ? Math.max(10, Math.min(84,
            Math.floor((trackLen - fixed - dataBytes) / sectors.length)))
        : 0);

    // Size it first: one pass of arithmetic beats growing an array 6250 times.
    let need = gap1;
    for (const s of sectors) {
        const len = sectorSize(s.sizeCode === undefined ? 2 : s.sizeCode);
        need += sync + 3 + 1 + 4 + (stream ? 1 : 2) + gap2
              + sync + 3 + 1 + len + (stream ? 1 : 2) + gap3;
    }

    const out = new Uint8Array(Math.max(trackLen, need));
    out.fill(GAP_BYTE);
    let p = gap1;

    const put = (v) => { out[p++] = v; };
    const run = (v, n) => { for (let k = 0; k < n; k++) put(v); };

    for (const s of sectors) {
        const sizeCode = s.sizeCode === undefined ? 2 : s.sizeCode;
        const len = sectorSize(sizeCode);
        const cyl = s.cylinder === undefined ? cylinder : s.cylinder;
        const hd = s.head === undefined ? head : s.head;
        const am = s.deleted ? AM_DELETED : AM_DATA;

        // ID field. The CRC covers the three sync bytes and the mark as well as
        // the four address bytes — leave them out and every sector reads corrupt.
        run(SYNC_BYTE, sync);
        run(a1, 3);
        put(AM_ID);
        put(cyl); put(hd); put(s.sector); put(sizeCode);
        if (stream) put(WT_CRC);
        else {
            const c = crcFdc(new Uint8Array([MARK_A1, MARK_A1, MARK_A1, AM_ID,
                                             cyl, hd, s.sector, sizeCode]));
            put((c >> 8) & 0xFF); put(c & 0xFF);
        }
        run(GAP_BYTE, gap2);

        // Data field. A sector with no data is a formatted but unwritten one, so
        // it gets the filler a formatter would have left there.
        const data = new Uint8Array(len);
        if (s.data) data.set(s.data.subarray(0, Math.min(len, s.data.length)));
        else data.fill(s.fill === undefined ? 0xE5 : s.fill);

        run(SYNC_BYTE, sync);
        run(a1, 3);
        put(am);
        for (let k = 0; k < len; k++) put(data[k]);
        if (stream) put(WT_CRC);
        else {
            const pre = new Uint8Array([MARK_A1, MARK_A1, MARK_A1, am]);
            const c = crcFdc(data, crcFdc(pre));
            put((c >> 8) & 0xFF); put(c & 0xFF);
        }
        run(GAP_BYTE, gap3);
    }

    return out;
}

/**
 * The stream a formatter would write for one track of a uniform geometry — the
 * thing a test can hand straight to a Write Track command. `marks` defaults to
 * `'stream'` here, which is the only form a format command accepts.
 */
export function formatTrackStream(spec = {}) {
    const {
        cylinder = 0, head = 0,
        sectorsPerTrack = 10, firstSector = 1, sizeCode = 2,
        interleave = 1, fill = 0xE5, data = null,
        ...rest
    } = spec;

    const order = [];
    const n = sectorsPerTrack;
    if (interleave > 1 && n > 1) {
        const used = new Set();
        let slot = 0;
        for (let k = 0; k < n; k++) {
            while (used.has(slot % n)) slot++;
            order.push(slot % n);
            used.add(slot % n);
            slot += interleave;
        }
    } else {
        for (let k = 0; k < n; k++) order.push(k);
    }

    return buildTrackStream({
        cylinder, head, marks: 'stream', ...rest,
        sectors: order.map((idx) => ({
            cylinder, head,
            sector: firstSector + idx,
            sizeCode,
            data: data ? data(firstSector + idx) : null,
            fill,
        })),
    });
}
