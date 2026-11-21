/**
 * ZX-M8XXX - UDI (Ultra Disk Image): raw-track Beta Disk images
 * @license GPL-3.0
 *
 * UDI stores what the drive head actually saw -- every byte of every track,
 * address marks, gaps and sector CRCs included -- plus a bit per byte saying
 * whether it carried a MARK clock. That is why protected disks survive it and
 * do not survive TRD, which is nothing but the sector payloads in order.
 *
 * Format by Alex Makeev (v1.0, 2002; v1.1 extends only the track container).
 * Spec: https://sinclair.wiki.zxnet.co.uk/wiki/UDI_format
 *
 * Verified against five real images (see docs/format-references.md). Three
 * things the spec does not tell you, which those files do:
 *
 *   - The trailing checksum is NOT a standard CRC-32. It inverts the register
 *     before and after EVERY byte and shifts an arithmetic (signed) right, so
 *     bit 31 is dragged down instead of vacated. 128 standard parameterisations
 *     reproduce none of the five files; `crcUdi` reproduces three exactly.
 *   - The other two carry a stale checksum, so a reader that refuses a bad CRC
 *     (Fuse does) refuses real disks. Ours reports it and loads anyway.
 *   - A file may hold trailing text after the last track: ST_INHER.UDI ends
 *     with a comment from the format author's own converter. So the track walk
 *     stops at the first byte that is not a track type instead of trusting the
 *     length, and the remainder is kept as `trailer` rather than failing.
 */

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

// The 8 shift/xor steps of the UDI checksum, as a sliced table. Both the shift
// and the conditional xor are GF(2)-linear, so the whole byte step is linear
// and tabulates; the ARITHMETIC shift is the part that makes it non-standard:
// on 32 bits that is (x >>> 1) | (x & 0x80000000).
const UDI_CRC_TABLES = (() => {
    const rounds = (x) => {
        for (let i = 0; i < 8; i++) {
            const lsb = x & 1;
            x = ((x >>> 1) | (x & 0x80000000)) >>> 0;
            if (lsb) x = (x ^ 0xEDB88320) >>> 0;
        }
        return x >>> 0;
    };
    const t = [];
    for (let k = 0; k < 4; k++) {
        const col = new Uint32Array(256);
        for (let v = 0; v < 256; v++) col[v] = rounds(((v << (8 * k)) >>> 0));
        t.push(col);
    }
    return t;
})();

/**
 * The UDI file checksum over `bytes[0..end)`.
 *
 * Substituting D = ~crc removes the per-byte double inversion from the
 * reference implementation, leaving D = 0; for each byte D = rounds(D ^ byte);
 * answer = ~D. Written that way it is four table lookups per byte.
 */
export function crcUdi(bytes, end = bytes.length) {
    const [T0, T1, T2, T3] = UDI_CRC_TABLES;
    let d = 0;
    for (let i = 0; i < end; i++) {
        d = (T0[(d ^ bytes[i]) & 0xFF] ^ T1[(d >>> 8) & 0xFF]
            ^ T2[(d >>> 16) & 0xFF] ^ T3[(d >>> 24) & 0xFF]) >>> 0;
    }
    return (~d) >>> 0;
}

// CRC-16-CCITT, the one the WD1793 writes into every ID and data field:
// G(x) = x^16 + x^12 + x^5 + 1, fed MSB-first, no final xor.
const FDC_CRC_TABLE = (() => {
    const t = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i << 8;
        for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
        t[i] = c;
    }
    return t;
})();

// The seed is 0xFFFF and the three 0xA1 sync bytes and the mark are part of the
// covered data, not a preamble -- leave them out and every sector looks corrupt.
export function crcFdc(bytes, crc = 0xFFFF) {
    for (let i = 0; i < bytes.length; i++) {
        crc = ((crc << 8) ^ FDC_CRC_TABLE[((crc >> 8) ^ bytes[i]) & 0xFF]) & 0xFFFF;
    }
    return crc;
}

// ---------------------------------------------------------------------------
// Track containers
// ---------------------------------------------------------------------------

export const UDI_TRACK_TYPES = {
    0x00: 'MFM',
    0x01: 'FM',
    0x02: 'mixed MFM/FM',
    0x80: 'weak MFM',
    0x81: 'weak FM',
    0x82: 'weak mixed MFM/FM',
    0x83: 'multiple read',
    0xE0: 'Microdrive',
    0xF0: 'zlib container',
};

// Types whose body is TLEN + one or more same-sized bitmaps. Bit 0x02 adds the
// MF map (which bytes are FM), bit 0x80 adds the weak map.
const PLAIN_TYPES = [0x00, 0x01, 0x02, 0x80, 0x81, 0x82];

// Bits per byte, rounded up: one clock bit per track byte.
const clen = (tlen) => (tlen >> 3) + ((tlen & 7) ? 1 : 0);

// LSB-first, settled twice over: the spec's own worked example (A1,A1,00,A1,FE
// -> 0x0B) and, in the five real images, every one of 12,760 A1 sync bytes.
// Fuse's byte-clearing mask table reads as MSB-first, but its bitmap_test is
// `b[n/8] & (1 << (n%8))`, so the mask is the odd one out, not the bit order.
export function udiClockBit(map, i) {
    const byte = i >> 3;
    return byte < map.length ? (map[byte] >> (i & 7)) & 1 : 0;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export class UDILoader {

    /** 'UDI!' at offset 0. */
    static detect(data) {
        return data && data.length >= 20
            && data[0] === 0x55 && data[1] === 0x44 && data[2] === 0x49 && data[3] === 0x21;
    }

    /**
     * Parse a UDI into track records. Throws only when the file cannot be read
     * at all; a bad checksum, an under-declared cylinder count and trailing
     * junk are all reported in the result instead, because real files have them.
     */
    static parse(data) {
        const b = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (b.length < 20) throw new Error('UDI: file too short');
        if (b[0] === 0x75 && b[1] === 0x64 && b[2] === 0x69 && b[3] === 0x21) {
            // v1.0 reserved a lowercase signature for a compressed file and never
            // said what the compression was; v1.1 withdrew it. Say so plainly
            // rather than reading the header as if it were uncompressed.
            throw new Error('UDI: lowercase "udi!" (compressed whole-file variant) is not defined by any spec revision');
        }
        if (!UDILoader.detect(b)) throw new Error('UDI: bad signature');

        const u16 = (o) => b[o] | (b[o + 1] << 8);
        const u32 = (o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

        const sizeField = u32(4);
        const warnings = [];
        // The field counts everything but the 4-byte checksum. Trust the file's
        // real length where they disagree: the checksum sits at the end either way.
        let eof = sizeField;
        if (sizeField !== b.length - 4) {
            warnings.push(`size field ${sizeField} does not match file length - 4 (${b.length - 4})`);
            eof = Math.min(sizeField, b.length - 4);
            if (eof < 16) throw new Error('UDI: size field unusable');
        }

        const version = b[8];
        const declaredCylinders = b[9] + 1;
        const sides = b[10] + 1;
        if (sides < 1 || sides > 2) throw new Error(`UDI: ${sides} sides is not a disk`);
        const extLen = u32(12);
        if (16 + extLen > eof) throw new Error('UDI: extended header runs past the tracks');

        const tracks = [];
        let trailer = null;
        let i = 16 + extLen;

        while (i < eof) {
            const type = b[i];
            let record;

            if (PLAIN_TYPES.includes(type)) {
                const tlen = u16(i + 1);
                const cl = clen(tlen);
                const maps = 1 + ((type & 0x02) ? 1 : 0) + ((type & 0x80) ? 1 : 0);
                record = 3 + tlen + cl * maps;
                if (i + record > eof) { warnings.push(`track ${tracks.length} runs past the end; stopped`); break; }
                let p = i + 3 + tlen;
                const clock = b.subarray(p, p + cl); p += cl;
                const mf = (type & 0x02) ? b.subarray(p, p + cl) : null;
                if (mf) p += cl;
                const weak = (type & 0x80) ? b.subarray(p, p + cl) : null;
                tracks.push({ type, data: b.subarray(i + 3, i + 3 + tlen), clock, mf, weak });

            } else if (type === 0xF0) {
                // zlib container: holds another track's body, type byte and TLEN
                // moved into the container header. DLEN is stored minus one.
                const dlen = u16(i + 1) + 1;
                const inner = b[i + 3];
                const tlen = u16(i + 4);
                record = 6 + dlen;
                if (i + record > eof) { warnings.push(`compressed track ${tracks.length} runs past the end; stopped`); break; }
                if (typeof pako === 'undefined') throw new Error('UDI: compressed track needs pako (lib/pako.min.js)');
                const raw = pako.inflate(b.subarray(i + 6, i + 6 + dlen));
                const cl = clen(tlen);
                const maps = 1 + ((inner & 0x02) ? 1 : 0) + ((inner & 0x80) ? 1 : 0);
                if (raw.length < tlen + cl * maps) {
                    warnings.push(`compressed track ${tracks.length} inflated short; stopped`);
                    break;
                }
                let p = tlen;
                const clock = raw.subarray(p, p + cl); p += cl;
                const mf = (inner & 0x02) ? raw.subarray(p, p + cl) : null;
                if (mf) p += cl;
                const weak = (inner & 0x80) ? raw.subarray(p, p + cl) : null;
                tracks.push({ type: inner, data: raw.subarray(0, tlen), clock, mf, weak, compressed: true });

            } else {
                // Not a track type. The author's own TRX2X converter appends a
                // text comment here, so this is where a file ends, not an error.
                trailer = b.subarray(i, eof);
                break;
            }
            i += record;
        }

        const cylinders = Math.ceil(tracks.length / sides);
        if (cylinders > declaredCylinders) {
            // SP17_O.udi declares 80 and carries 83. The extra cylinders are
            // where protection lives, so go by what is in the file.
            warnings.push(`header declares ${declaredCylinders} cylinders, file holds ${cylinders}`);
        }

        const crcStored = u32(eof);
        const crcComputed = crcUdi(b, eof);

        return {
            version, sides, cylinders, declaredCylinders, extLen,
            extHeader: extLen ? b.subarray(16, 16 + extLen) : null,
            tracks, trailer, warnings,
            crcStored, crcComputed, crcOk: crcStored === crcComputed,
            unused11: b[11],
        };
    }

    /**
     * Walk one track's raw bytes the way the controller does and return the
     * sector records found: an ID field (0xFE) carries cylinder/head/sector/size,
     * a following data field (0xFB, or 0xF8 for deleted data) carries the bytes.
     *
     * A mark is a byte with its clock bit set; the bytes after a run of 0xA1 are
     * accepted without one, since that is how an unclocked 0xFE still reads.
     */
    static decodeTrack(track) {
        const d = track.data, c = track.clock, n = d.length;
        const out = [];
        let a1 = 0, pending = null;

        for (let i = 0; i < n;) {
            const byte = d[i];

            if (byte === 0xA1 && udiClockBit(c, i)) { a1++; i++; continue; }

            if (byte === 0xFE && (udiClockBit(c, i) || a1 > 0)) {
                if (i + 7 > n) break;
                const stored = (d[i + 5] << 8) | d[i + 6];
                const covered = new Uint8Array([0xA1, 0xA1, 0xA1, 0xFE,
                    d[i + 1], d[i + 2], d[i + 3], d[i + 4]]);
                pending = {
                    cylinder: d[i + 1], head: d[i + 2], sector: d[i + 3], sizeCode: d[i + 4],
                    length: 128 << (d[i + 4] & 3),
                    idCrcOk: crcFdc(covered) === stored,
                    // READ ADDRESS returns the ID field's own CRC bytes, so a loader
                    // that checks them sees what is on the disk rather than a zero.
                    idCrc: stored,
                    idOffset: i, data: null, dataCrcOk: null, deleted: false,
                };
                out.push(pending);
                i += 7; a1 = 0; continue;
            }

            if (byte >= 0xF8 && byte <= 0xFB && (udiClockBit(c, i) || a1 > 0) && pending) {
                const len = pending.length;
                if (i + 1 + len + 2 > n) break;
                const payload = d.subarray(i + 1, i + 1 + len);
                const stored = (d[i + 1 + len] << 8) | d[i + 2 + len];
                const covered = new Uint8Array(4 + len);
                covered.set([0xA1, 0xA1, 0xA1, byte]);
                covered.set(payload, 4);
                pending.data = payload;
                pending.deleted = (byte === 0xF8);
                pending.dataCrcOk = crcFdc(covered) === stored;
                pending.weak = !!(track.weak && (() => {
                    for (let k = i + 1; k < i + 1 + len; k++) if (udiClockBit(track.weak, k)) return true;
                    return false;
                })());
                i += 1 + len + 2; pending = null; a1 = 0; continue;
            }

            a1 = 0; i++;
        }
        return out;
    }

    /**
     * Flatten a parsed UDI into a TRD image, which is what the rest of the
     * emulator speaks: sector payloads in (cylinder, head, sector) order, with
     * nothing else kept.
     *
     * This is lossy by construction, so everything it had to drop is listed in
     * `lost` rather than silently discarded -- a 512-byte sector, a sector
     * numbered outside 1..16, a deleted-data mark and a bad CRC are all real in
     * the sample images, and none of them can be expressed in a TRD.
     */
    static toTRD(parsed, { sectorsPerTrack = 16, bytesPerSector = 256 } = {}) {
        const { sides, cylinders, tracks } = parsed;
        const trd = new Uint8Array(cylinders * sides * sectorsPerTrack * bytesPerSector);
        const lost = { wrongSize: 0, outOfRange: 0, badCrc: 0, deleted: 0, noData: 0, weak: 0 };
        let placed = 0;

        for (let idx = 0; idx < tracks.length; idx++) {
            // "alt" schema: side 0 track 0, side 1 track 0, side 0 track 1, ...
            const cyl = Math.floor(idx / sides), head = idx % sides;
            for (const s of UDILoader.decodeTrack(tracks[idx])) {
                if (s.data === null) { lost.noData++; continue; }
                if (s.length !== bytesPerSector) { lost.wrongSize++; continue; }
                if (s.sector < 1 || s.sector > sectorsPerTrack) { lost.outOfRange++; continue; }
                if (s.deleted) lost.deleted++;
                if (s.weak) lost.weak++;
                if (s.dataCrcOk === false) { lost.badCrc++; }
                const logical = cyl * sides + head;
                const off = (logical * sectorsPerTrack + s.sector - 1) * bytesPerSector;
                if (off + bytesPerSector > trd.length) { lost.outOfRange++; continue; }
                trd.set(s.data, off);
                placed++;
            }
        }
        return { trd, placed, lost, sides, cylinders };
    }

    /**
     * The tracks in the shape the controller serves from: per (cylinder, side),
     * the raw bytes and the sector records decoded out of them.
     *
     * This is the whole point of supporting UDI. A TRD answers exactly one
     * question -- "give me the 256 bytes of sector N" -- and a protected disk's
     * loader asks others: what sector IDs are on this track, what size is this
     * sector, did its CRC fail, is it marked deleted, is this track readable at
     * all. Those answers exist only here.
     *
     * Indexed cylinder-major, side-minor, the same order toTRD walks.
     */
    static toTrackImage(parsed) {
        const tracks = parsed.tracks.map((t) => ({
            raw: t.data,
            sectors: UDILoader.decodeTrack(t),
        }));
        return { sides: parsed.sides, cylinders: parsed.cylinders, tracks };
    }

    /**
     * Read a UDI the way the file loader wants it: the TRD bytes plus what was
     * given up getting there.
     */
    static load(data) {
        const parsed = UDILoader.parse(data);
        const flat = UDILoader.toTRD(parsed);
        return {
            trd: flat.trd,
            // The flat image is still what the catalogue, the project save and the
            // TR-DOS trap read; the controller reads THIS.
            trackImage: UDILoader.toTrackImage(parsed),
            cylinders: flat.cylinders,
            sides: flat.sides,
            sectorsPlaced: flat.placed,
            lost: flat.lost,
            crcOk: parsed.crcOk,
            warnings: parsed.warnings,
            trailerText: parsed.trailer ? UDILoader.trailerText(parsed.trailer) : null,
            parsed,
        };
    }

    /** Trailing bytes as text, if they look like text (a converter's comment). */
    static trailerText(trailer) {
        let s = '';
        for (let i = 0; i < trailer.length; i++) {
            const ch = trailer[i];
            if (ch === 0) break;
            if (ch < 0x09 || (ch > 0x0D && ch < 0x20)) return null;
            s += String.fromCharCode(ch);
        }
        return s.trim() || null;
    }
}
