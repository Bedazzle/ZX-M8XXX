// ZX-M8XXX — Shared constants
// Hardware addresses, port masks, and format definitions used across the emulator.

// =============================================================================
// Memory layout
// =============================================================================

export const PAGE_SIZE = 0x4000;       // 16384 bytes per RAM/ROM bank
export const BANK_MASK = 0x3FFF;       // 16KB bank offset mask (addr & BANK_MASK)

// Memory slot boundaries (64KB address space divided into 4 × 16KB slots)
export const SLOT1_START = 0x4000;     // Slot 1: typically bank 5 (screen + low RAM)
export const SLOT2_START = 0x8000;     // Slot 2: typically bank 2
export const SLOT3_START = 0xC000;     // Slot 3: switchable bank (paging target)
export const ADDR_MAX    = 0xFFFF;     // Last addressable byte

// Screen memory (within bank 5, or bank 7 for shadow screen)
export const SCREEN_BITMAP      = 0x4000;  // Screen pixel data start (= SLOT1_START)
export const SCREEN_ATTR        = 0x5800;  // Attribute/color data start
export const SCREEN_END         = 0x5AFF;  // Attribute data end (inclusive)
export const SCREEN_AFTER       = 0x5B00;  // First address after screen memory
export const SCREEN_BITMAP_SIZE = 6144;    // Pixel data bytes (256×192 / 8)
export const SCREEN_ATTR_SIZE   = 768;     // Attribute bytes (32×24)
export const SCREEN_SIZE        = 6912;    // Bitmap + attributes
export const SCREEN_WIDTH       = 256;     // Screen width in pixels
export const SCREEN_HEIGHT      = 192;     // Screen height in pixels

// =============================================================================
// Port addresses
// =============================================================================

export const PORT_7FFD = 0x7FFD;  // 128K memory paging
export const PORT_1FFD = 0x1FFD;  // +2A special paging / Scorpion extended paging
export const PORT_EFF7 = 0xEFF7;  // Pentagon 1024 extended memory control

export const PORT_AY_REG  = 0xFFFD;  // AY-3-8910 register select
export const PORT_AY_DATA = 0xBFFD;  // AY-3-8910 register write

export const PORT_ULAPLUS_DATA = 0xBF3B;  // ULAplus data port
export const PORT_ULAPLUS_REG  = 0xFF3B;  // ULAplus register port

export const PORT_FDC_MSR  = 0x2FFD;  // µPD765 Main Status Register (read)
export const PORT_FDC_DATA = 0x3FFD;  // µPD765 Data Register (read/write)

// =============================================================================
// Port decode masks and patterns
// =============================================================================

// 128K/+2/Pentagon: (port & DECODE_128K_MASK) === 0
export const DECODE_128K_MASK = 0x8002;

// +2A: (port & DECODE_PLUS2A_MASK) === DECODE_7FFD_PLUS2A for 7FFD
export const DECODE_PLUS2A_MASK = 0xC002;
export const DECODE_7FFD_PLUS2A = 0x4000;

// +2A/+3: (port & DECODE_PLUS2A_MASK2) === DECODE_1FFD_PLUS2A for 1FFD
export const DECODE_PLUS2A_MASK2 = 0xF002;
export const DECODE_1FFD_PLUS2A  = 0x1000;

// +3 FDC: (port & DECODE_PLUS2A_MASK2) === DECODE_FDC_MSR / DECODE_FDC_DATA
export const DECODE_FDC_MSR  = 0x2000;
export const DECODE_FDC_DATA = 0x3000;

// Pentagon 1024: (port & DECODE_P1024_MASK) === DECODE_P1024_VAL
export const DECODE_P1024_MASK = 0xF008;
export const DECODE_P1024_VAL  = 0xE000;

// AY: (port & DECODE_AY_MASK) === DECODE_AY_REG / DECODE_AY_DATA
export const DECODE_AY_MASK = 0xC002;
export const DECODE_AY_REG  = 0xC000;
export const DECODE_AY_DATA = 0x8000;

// =============================================================================
// Port 0x7FFD bit masks
// =============================================================================

export const P7FFD_RAM_MASK   = 0x07;  // Bits 0-2: RAM bank (0-7)
export const P7FFD_SCREEN_BIT = 0x08;  // Bit 3: screen bank (0=bank 5, 1=bank 7)
export const P7FFD_ROM_BIT    = 0x10;  // Bit 4: ROM bank select
export const P7FFD_LOCK_BIT   = 0x20;  // Bit 5: paging disable (lock)
export const P7FFD_P1024_EXT  = 0xC0;  // Bits 6-7: Pentagon 1024 bank bits 3-4

// =============================================================================
// Kempston joystick port decode
// =============================================================================

// The interface is a bus device with partial decoding: the one-chip design reads
// on any I/O access with A5 low, the two-chip one also checks A6/A7. We use the
// stricter form (FUSE's kempston_strict_decoding), so ports 0x00-0x1F match and
// the mouse at 0xDF — which also has A5 low — does not.
export const DECODE_KEMPSTON_MASK = 0xE0;
export const DECODE_KEMPSTON      = 0x00;

// =============================================================================
// Beta Disk WD1793 port addresses (active-low, bits 5-7 select register)
// =============================================================================

export const PORT_WD_CMD    = 0x1F;   // Command/status register
export const PORT_WD_TRACK  = 0x3F;   // Track register
export const PORT_WD_SECTOR = 0x5F;   // Sector register
export const PORT_WD_DATA   = 0x7F;   // Data register
export const PORT_WD_SYS    = 0xFF;   // System register (active-high)

// =============================================================================
// +D (DISCiPLE/+D) port addresses (per FUSE plusd.c, active-low decode on low byte)
// =============================================================================

export const PORT_PLUSD_CMD   = 0xE3;  // +D WD1772 command/status register
export const PORT_PLUSD_TRACK = 0xEB;  // +D WD1772 track register
export const PORT_PLUSD_SEC   = 0xF3;  // +D WD1772 sector register
export const PORT_PLUSD_DATA  = 0xFB;  // +D WD1772 data register
export const PORT_PLUSD_CTRL  = 0xEF;  // +D control register (write: drive/side/printer)
export const PORT_PLUSD_PAGE  = 0xE7;  // +D paging register (read=page in, write=page out)
// Centronics: write = printer data, read = bit 7 busy (MAME mgt.cpp case 0x76).
// Not optional: the ROM does "IN A,($F7) / BIT 7,A / RET NZ" at $0437 on the boot
// path, so an unimplemented port reads the floating bus, bit 7 sticks at 1, and the
// +D concludes the printer is forever busy and soft-resets instead of booting.
export const PORT_PLUSD_PRINT = 0xF7;

// =============================================================================
// Interface 1 / Microdrive port addresses
// =============================================================================

// IF1 port decode: low byte bit 0 must be 1, bits 4:3 select register
export const IF1_PORT_MASK    = 0x18;  // Bits 4:3 for register select
export const IF1_PORT_DATA    = 0x00;  // Bits 4:3 = 00 → data ($E7)
export const IF1_PORT_CTL     = 0x08;  // Bits 4:3 = 01 → status/control ($EF)
export const IF1_PORT_NET     = 0x10;  // Bits 4:3 = 10 → network ($F7)

// IF1 ROM paging trigger addresses
export const IF1_PAGE_IN_RST8   = 0x0008;  // Opcode fetch at RST 8 → page in IF1 ROM
export const IF1_PAGE_IN_CLOSE  = 0x1708;  // Opcode fetch at CLOSE# → page in IF1 ROM
export const IF1_PAGE_OUT_ADDR  = 0x0700;  // RET at $0700 → page out IF1 ROM

// +D ROM auto-paging trigger addresses (per FUSE z80_ops.c)
export const PLUSD_PAGE_IN_RST8    = 0x0008;  // RST 8 — error handler (intercepts BASIC commands)
export const PLUSD_PAGE_IN_KEYNEXT = 0x003A;  // KEY-NEXT — token reading
export const PLUSD_PAGE_IN_NMI     = 0x0066;  // NMI handler
export const PLUSD_PAGE_IN_KEYSCAN = 0x028E;  // KEY-SCAN routine

// Opus Discovery ROM auto-paging trigger addresses (per FUSE z80_ops.c).
// Unlike the +D and IF1, FUSE tests these AFTER the opcode fetch rather than
// before it — see Spectrum.updateOpusPaging for why that is equivalent here.
export const OPUS_PAGE_IN_RST8   = 0x0008;  // RST 8 — error handler
export const OPUS_PAGE_IN_KEYINT = 0x0048;  // KEY-INT — the ROM's ISR hook
export const OPUS_PAGE_IN_CLOSE  = 0x1708;  // CLOSE#
export const OPUS_PAGE_OUT_ADDR  = 0x1748;  // page out

// Opus Discovery memory-mapped window (offsets within $0000-$3FFF when paged in)
export const OPUS_RAM_START = 0x2000;  // 2KB RAM
export const OPUS_FDC_START = 0x2800;  // WD1770 registers (address & 3)
export const OPUS_PIA_START = 0x3000;  // MC6821 PIA registers (address & 3)
export const OPUS_UNMAPPED  = 0x3800;  // reads as $FF

// Opus DRQ → NMI delays, in T-states. The WD1770 has no timing model here, so
// these stand in for it: MFM at 250 kbit/s is a byte every 32us = 112 T-states
// at 3.5 MHz, and the first byte of a transfer also waits for the head to settle
// and the sector to come round under it.
export const OPUS_DRQ_BYTE_TSTATES  = 112;
export const OPUS_DRQ_FIRST_TSTATES = 2500;

// =============================================================================
// Didaktik 80 (per FUSE peripherals/disk/didaktik.c)
// =============================================================================

// Its ROM is 14KB, not the 8KB every other interface here uses: $0000-$37FF is
// ROM and $3800-$3FFF is 2KB of RAM, so the overlay fills the bottom 16KB.
export const DIDAKTIK_ROM_SIZE  = 0x3800;  // 14336
export const DIDAKTIK_RAM_START = 0x3800;
export const DIDAKTIK_RAM_SIZE  = 0x0800;  // 2048

// ROM paging trigger addresses. $0000 means it takes over from reset — unlike
// every other interface, which waits to be entered through a hook.
export const DIDAKTIK_PAGE_IN_RESET = 0x0000;
export const DIDAKTIK_PAGE_IN_RST8  = 0x0008;
export const DIDAKTIK_PAGE_OUT_ADDR = 0x1700;

// WD2797 registers on I/O ports (low byte). Anything with bit 7 clear is the
// 8255 PPI, which is not wired to anything and reads $FF.
export const DIDAKTIK_PORT_MASK    = 0x00FF;
export const DIDAKTIK_PORT_COMMAND = 0x81;  // read = status, write = command
export const DIDAKTIK_PORT_TRACK   = 0x83;
export const DIDAKTIK_PORT_SECTOR  = 0x85;
export const DIDAKTIK_PORT_DATA    = 0x87;
// Aux register, decoded with mask $F9 so $89/$8B/$8D/$8F all reach it:
// bit 0/1 drive select, bit 2/3 motors, bit 6 DRQ->NMI, bit 7 INTRQ->NMI
export const DIDAKTIK_PORT_AUX      = 0x89;
export const DIDAKTIK_PORT_AUX_MASK = 0xF9;

// =============================================================================
// SNA snapshot format
// =============================================================================

export const SNA_HEADER_SIZE = 27;                                 // Register dump
export const SNA_48K_RAM     = 3 * PAGE_SIZE;                      // 49152 bytes (0x4000-0xFFFF)
export const SNA_48K_SIZE    = SNA_HEADER_SIZE + SNA_48K_RAM;      // 49179
export const SNA_128K_EXT    = 4;                                  // PC (2) + port7FFD (1) + trdos (1)
export const SNA_128K_MIN    = SNA_48K_SIZE + 2;                   // 49181 — minimum for 128K detection
export const SNA_128K_SIZE   = SNA_48K_SIZE + SNA_128K_EXT + 5 * PAGE_SIZE;  // 131103
export const SNA_P1024_SIZE  = SNA_48K_SIZE + SNA_128K_EXT + 6 * PAGE_SIZE;  // 147487

// =============================================================================
// Code Path Tool
// =============================================================================

export const CODE_PATH_CONTEXT_LINES = 5;  // Instructions disassembled before each block for context

// =============================================================================
// Game Mapper
// =============================================================================

export const MAPPER_DEFAULT_FONT = 'sans-serif';
export const MAPPER_DEFAULT_FONT_SIZE = 16;
