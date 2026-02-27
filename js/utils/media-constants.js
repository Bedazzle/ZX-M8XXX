// Extracted from index.html inline script, lines 8452-8475
// Media-related constants: auto-load timing, tape headers, TRD disk geometry

// Auto Load timing constants (ms)
export const AUTO_LOAD_ROM_WAIT     = 3000;  // Wait for ROM init after reset
export const AUTO_LOAD_128K_WAIT    = 1500;  // Extra wait after 128K menu "1" press
export const AUTO_LOAD_KEY_HOLD     = 200;   // How long to hold each key
export const AUTO_LOAD_KEY_GAP      = 150;   // Gap between keypresses

// Tape header constants
export const TAPE_STD_PILOT_PULSE   = 2168;  // Standard pilot pulse length (T-states)
export const TAPE_TURBO_TOLERANCE   = 50;    // Deviation from standard to classify as turbo
export const TAPE_STD_FLAG          = 0x00;  // Flag byte for standard header blocks
export const TAPE_HDR_MIN_LENGTH    = 18;    // Minimum data length for a valid header
export const TAPE_HDR_TYPE_PROGRAM  = 0;
export const TAPE_HDR_TYPE_NUM_ARR  = 1;
export const TAPE_HDR_TYPE_CHR_ARR  = 2;
export const TAPE_HDR_TYPE_BYTES    = 3;

// TRD disk geometry
export const TRD_SECTOR_SIZE        = 256;
export const TRD_SECTOR9_OFFSET     = 8 * TRD_SECTOR_SIZE;  // Sector 9 (system info)
export const TRD_FREE_SECS_LO      = 0xE5;  // Offset within sector 9
export const TRD_FREE_SECS_HI      = 0xE6;
export const TRD_LABEL_OFFSET       = 0xF5;  // Disk label start within sector 9
export const TRD_LABEL_LENGTH       = 8;
export const TRD_MIN_IMAGE_SIZE     = 0x8E7; // Minimum size to have valid system sector
