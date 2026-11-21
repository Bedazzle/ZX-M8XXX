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
