// Extracted from index.html inline script
// Region type constants for the disassembler's memory region manager

// Memory region types for marking code/data/etc
// Lines 10914-10921
export const REGION_TYPES = {
    CODE: 'code',
    DB: 'db',       // Data bytes
    DW: 'dw',       // Data words (16-bit)
    TEXT: 'text',   // Text strings
    GRAPHICS: 'graphics',
    SMC: 'smc'      // Self-modifying code
};

// Operand display format types
// Lines 11215-11220
export const OPERAND_FORMATS = {
    HEX: 'hex',
    DEC: 'dec',
    BIN: 'bin',
    CHAR: 'char'
};

// Region parsing display limits
// Lines 13910-13912
export const REGION_MAX_TEXT = 50;   // sjasmplus compatible
export const REGION_MAX_BYTES = 8;   // bytes per DB line
export const REGION_MAX_WORDS = 4;   // words per DW line
