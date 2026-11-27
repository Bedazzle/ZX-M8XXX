/**
 * ZX-M8XXX - HC IF1 disk images
 * @license GPL-3.0-or-later
 *
 * A raw (.img) HC disk has no geometry of its own, so it is turned into
 * a DSKImage here — real tracks with real C/H/R/N — and the controller never
 * learns where a disk came from. The same disk as IMG and as DSK then gives
 * the same sectors, heads and tracks, which FUSE-HC did not guarantee (it laid
 * a raw file out by its extension).
 *
 * What a raw HC image is (checked against disks that run on a real HC-2000
 * through a Gotek, see docs/peripherals.md):
 *   - sectors are stored by ID: R=1..N at offsets 0..N-1 within a track;
 *   - the SIDE order varies: some files hold all of side 0 then all of side 1
 *     (FUSE's .img), others alternate per cylinder (FUSE's .mgt, Gotek).
 * The side order is detected from the directory: the HC IF1 file system is
 * CP/M-like, 2KB blocks, directory in blocks 0-1 (cylinder 0, side 0, which
 * both layouts share), and the HC IF1 ROM turns logical sector n into
 * C = n/32, side = (n%32)/16, R = SKEW[n%16] (table at $1FF0). The layout under
 * which the blocks of the directory's files land on non-empty sectors wins.
 */

import { DSKImage } from '../fdc.js';

// HC IF1 ROM $1FF0: logical sector (0-15) within a side -> sector ID
export const HC_SKEW = [1, 3, 5, 7, 9, 11, 13, 15, 2, 4, 6, 8, 10, 12, 14, 16];

// Raw sizes we know. 16x256 is the HC BASIC format, 9x512 the CP/M one.
const RAW_GEOMETRIES = {
    655360: { cylinders: 80, sides: 2, sectors: 16, sizeCode: 1 },   // 640K
    327680: { cylinders: 40, sides: 2, sectors: 16, sizeCode: 1 },   // 320K (FUSE: 2x40)
    737280: { cylinders: 80, sides: 2, sectors: 9, sizeCode: 2 },    // 720K CP/M
    368640: { cylinders: 40, sides: 2, sectors: 9, sizeCode: 2 },    // 360K CP/M
};

export const HC_LAYOUT_INTERLEAVED = 'interleaved';  // C0H0, C0H1, C1H0, ...
export const HC_LAYOUT_SIDE_MAJOR = 'side-major';    // all side 0, then all side 1

export class HcDiskLoader {
    static isRaw(data) {
        const len = data.byteLength !== undefined ? data.byteLength : data.length;
        return RAW_GEOMETRIES[len] !== undefined;
    }

    static geometryFor(len) {
        return RAW_GEOMETRIES[len] || null;
    }

    // Track index (in file order) of cylinder c, side h
    static _trackIndex(geom, layout, c, h) {
        return layout === HC_LAYOUT_SIDE_MAJOR ? h * geom.cylinders + c : c * geom.sides + h;
    }

    static _sectorOffset(geom, layout, c, h, r) {
        const secSize = 128 << geom.sizeCode;
        return (HcDiskLoader._trackIndex(geom, layout, c, h) * geom.sectors + (r - 1)) * secSize;
    }

    /**
     * How well a layout explains the directory: the number of sectors of
     * directory-listed files that land on non-empty data. Only meaningful for
     * the 16x256 HC format, whose directory sits in cylinder 0 side 0.
     */
    static _scoreLayout(bytes, geom, layout) {
        if (geom.sectors !== 16 || geom.sizeCode !== 1) return 0;
        const sec = (n) => {
            const c = Math.floor(n / 32), w = n % 32;
            if (c >= geom.cylinders) return null;
            const off = HcDiskLoader._sectorOffset(geom, layout, c, w >> 4, HC_SKEW[w & 15]);
            return bytes.subarray(off, off + 256);
        };
        const isEmpty = (b) => {
            if (!b) return true;
            const f = b[0];
            if (f !== 0x00 && f !== 0xE5) return false;
            for (let i = 1; i < b.length; i++) if (b[i] !== f) return false;
            return true;
        };
        let score = 0;
        // Directory: blocks 0-1 = logical sectors 0-15, 32 bytes per entry
        for (let n = 0; n < 16; n++) {
            const d = sec(n);
            if (!d) continue;
            for (let e = 0; e < 256; e += 32) {
                if (d[e] > 15) continue;                       // deleted / unused
                const rc = d[e + 15];
                let recs = 0;
                // A first extent whose first sector carries an IF1 header with a
                // length that fits the directory is strong evidence: deleted
                // files leave data behind, so "non-empty" alone can tie.
                const first = d[e + 16] | (d[e + 17] << 8);
                if (d[e + 12] === 0 && first > 0 && first <= 2000) {
                    const h = sec(first * 8);
                    if (h && h[0] <= 3) {
                        const len = h[1] | (h[2] << 8);
                        if (len > 0 && Math.ceil((len + 9) / 128) <= Math.max(rc, 1) + 1) score += 8;
                    }
                }
                for (let i = 0; i < 16; i += 2) {
                    const block = d[e + 16 + i] | (d[e + 17 + i] << 8);
                    if (block === 0 || block > 2000) continue;
                    for (let k = 0; k < 8 && recs < rc; k++, recs += 2) {
                        if (!isEmpty(sec(block * 8 + k))) score++;
                    }
                }
            }
        }
        return score;
    }

    /** Pick the side order of a raw image: by directory, else by extension. */
    static detectLayout(bytes, fileName = '') {
        const geom = HcDiskLoader.geometryFor(bytes.length);
        const byExt = /\.img$/i.test(fileName) ? HC_LAYOUT_SIDE_MAJOR : HC_LAYOUT_INTERLEAVED;
        if (!geom) return { layout: byExt, reason: 'unknown size' };
        const a = HcDiskLoader._scoreLayout(bytes, geom, HC_LAYOUT_INTERLEAVED);
        const b = HcDiskLoader._scoreLayout(bytes, geom, HC_LAYOUT_SIDE_MAJOR);
        if (a > b) return { layout: HC_LAYOUT_INTERLEAVED, reason: `directory (${a} vs ${b})` };
        if (b > a) return { layout: HC_LAYOUT_SIDE_MAJOR, reason: `directory (${b} vs ${a})` };
        return { layout: byExt, reason: 'extension' };
    }

    /**
     * Raw image -> DSKImage with real geometry. Sectors are laid on each track
     * in ID order R=1..N, as the DSKs FUSE-HC writes have them.
     */
    static fromRaw(data, fileName = '', layout = null) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const geom = HcDiskLoader.geometryFor(bytes.length);
        if (!geom) throw new Error(`Not an HC raw disk image (${bytes.length} bytes)`);
        const det = layout ? { layout, reason: 'given' } : HcDiskLoader.detectLayout(bytes, fileName);
        const secSize = 128 << geom.sizeCode;
        const image = new DSKImage();
        image.numTracks = geom.cylinders;
        image.numSides = geom.sides;
        image.isExtended = false;
        for (let c = 0; c < geom.cylinders; c++) {
            for (let h = 0; h < geom.sides; h++) {
                const track = { sectors: [] };
                for (let r = 1; r <= geom.sectors; r++) {
                    const off = HcDiskLoader._sectorOffset(geom, det.layout, c, h, r);
                    track.sectors.push({
                        cylinder: c, head: h, id: r, sizeCode: geom.sizeCode,
                        st1: 0, st2: 0,
                        data: bytes.slice(off, off + secSize),
                        weakMap: null
                    });
                }
                image.tracks[c * geom.sides + h] = track;
            }
        }
        return { image, layout: det.layout, reason: det.reason, geometry: geom };
    }

    /** DSKImage -> raw bytes in the given side order (for saving back as IMG). */
    static toRaw(image, layout = HC_LAYOUT_INTERLEAVED) {
        const t0 = image.getTrack(0, 0);
        if (!t0 || !t0.sectors.length) throw new Error('Empty disk image');
        const sizeCode = t0.sectors[0].sizeCode;
        const geom = {
            cylinders: image.numTracks, sides: image.numSides,
            sectors: t0.sectors.length, sizeCode
        };
        const secSize = 128 << sizeCode;
        const out = new Uint8Array(geom.cylinders * geom.sides * geom.sectors * secSize).fill(0xE5);
        for (let c = 0; c < geom.cylinders; c++) {
            for (let h = 0; h < geom.sides; h++) {
                for (let r = 1; r <= geom.sectors; r++) {
                    const d = image.readSector(c, h, r);
                    if (d) out.set(d.subarray(0, secSize),
                        HcDiskLoader._sectorOffset(geom, layout, c, h, r));
                }
            }
        }
        return out;
    }
}
