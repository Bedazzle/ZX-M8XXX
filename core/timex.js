/**
 * ZX-M8XXX - Timex SCLD display modes (TC2048)
 * @license GPL-3.0
 *
 * After FUSE's peripherals/scld.c and display.c. Port $FF (DEC):
 *   bits 0-2  screen mode
 *     0 standard
 *     1 second display file ($6000 pixels, $7800 attributes)
 *     2 hi-colour: pixels from the first file, an attribute per 8x1 from the
 *       second file's pixel area ($6000 + the same offset)
 *     3 as 2, pixels from the second file (FUSE: attributes are then the
 *       same bytes)
 *     4 hi-res: 512x192, each 16 pixels = first file byte, then its attribute
 *       byte read as pixels (the "strange" mode)
 *     5 as 4 on the second file (its byte, then its attribute byte)
 *     6 hi-res proper: first file byte, then the second file's byte
 *     7 second file only, each byte twice
 *   bits 3-5  hi-res colours (ink/paper pair, see HIRES_ATTR)
 *   bit 6     masks the frame interrupt
 *   bit 7     DOCK/EXROM select for the HSR (port $F4)
 * In hi-res the border is the hi-res paper colour.
 */

export const ALTDFILE_OFFSET = 0x2000;

// DEC bits 3-5 -> attribute byte for the hi-res ink/paper (FUSE hires_convert_dec)
const HIRES_ATTR = [0x78, 0x71, 0x6A, 0x63, 0x5C, 0x55, 0x4E, 0x47];

export function timexHiresAttr(dec) {
    return HIRES_ATTR[(dec >> 3) & 7];
}

/** Display-file offset of pixel row y (0-191) */
export function pixelRowOffset(y) {
    return ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
}

/**
 * The 32 cells of row y in a low-res mode (1-3): [pixel byte, attribute] each.
 * `ram` is the 48K block, the display file at index 0.
 */
export function timexLoresCell(ram, dec, y, col) {
    const p = pixelRowOffset(y) + col;
    const altd = (dec & 1) ? ALTDFILE_OFFSET : 0;
    const data = ram[p + altd];
    let attr;
    if (dec & 2) attr = ram[p + ALTDFILE_OFFSET];                       // 8x1
    else attr = ram[0x1800 + ((y >> 3) << 5) + col + altd];
    return [data, attr];
}

/** The 16 hi-res pixels of cell col in row y, as a 16-bit value, MSB first */
export function timexHiresWord(ram, dec, y, col) {
    const p = pixelRowOffset(y) + col;
    const mode = dec & 7;
    const data = ram[p + ((dec & 1) ? ALTDFILE_OFFSET : 0)];
    let data2;
    switch (mode) {
        case 5: data2 = ram[0x1800 + ((y >> 3) << 5) + col + ALTDFILE_OFFSET]; break;
        case 6: data2 = ram[p + ALTDFILE_OFFSET]; break;
        case 7: data2 = data; break;
        default: data2 = ram[0x1800 + ((y >> 3) << 5) + col]; break;  // 4
    }
    return (data << 8) | data2;
}

// DCK cartridge image (libspectrum dck.c): blocks of a 9-byte header -- bank
// ($00 DOCK, $FE EXROM, $FF HOME) and one access byte per 8KB chunk (0 none,
// 1 empty RAM, 2 ROM, 3 RAM) -- followed by 8KB for each ROM/RAM chunk.
export const DCK_BANK_DOCK = 0x00, DCK_BANK_EXROM = 0xFE, DCK_BANK_HOME = 0xFF;

/** @returns {Array<{bank:number, chunks:Array<null|{data:Uint8Array, writable:boolean}>}>} */
export function parseDck(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const blocks = [];
    let pos = 0;
    while (pos + 9 <= b.length) {
        const bank = b[pos];
        if (bank !== DCK_BANK_DOCK && bank !== DCK_BANK_EXROM && bank !== DCK_BANK_HOME) {
            throw new Error(`DCK: bank $${bank.toString(16)} not supported`);
        }
        const access = Array.from(b.subarray(pos + 1, pos + 9));
        pos += 9;
        const chunks = access.map((a) => {
            if (a === 0) return null;
            if (a === 1) return { data: new Uint8Array(0x2000), writable: true };
            if (a !== 2 && a !== 3) throw new Error(`DCK: chunk type ${a} not supported`);
            if (pos + 0x2000 > b.length) throw new Error('DCK: file is cut short');
            const data = b.slice(pos, pos + 0x2000);
            pos += 0x2000;
            return { data, writable: a === 3 };
        });
        blocks.push({ bank, chunks });
    }
    if (!blocks.length) throw new Error('DCK: no blocks');
    return blocks;
}
