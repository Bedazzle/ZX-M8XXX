// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Z80 Instruction Encoder - Encodes Z80 assembly mnemonics to machine code

import { AssemblerError } from './errors.js';
import { ErrorCollector } from './errors.js';
import { parseExpression } from './expression.js';

export const Z80Asm = {
    // Register encoding for 8-bit registers
    R8: { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, '(HL)': 6, A: 7 },

    // Register encoding for 16-bit register pairs
    R16: { BC: 0, DE: 1, HL: 2, SP: 3 },
    R16_AF: { BC: 0, DE: 1, HL: 2, AF: 3 },  // For PUSH/POP

    // Index registers
    IX: 0xDD,
    IY: 0xFD,

    // Condition codes
    CC: { NZ: 0, Z: 1, NC: 2, C: 3, PO: 4, PE: 5, P: 6, M: 7 },

    // CB prefix bit operations
    CB_OP: { RLC: 0, RRC: 1, RL: 2, RR: 3, SLA: 4, SRA: 5, SLL: 6, SRL: 7 },

    // Undocumented: IXH, IXL, IYH, IYL
    R8_IX: { B: 0, C: 1, D: 2, E: 3, IXH: 4, IXL: 5, '(IX)': 6, A: 7 },
    R8_IY: { B: 0, C: 1, D: 2, E: 3, IYH: 4, IYL: 5, '(IY)': 6, A: 7 },

    // Check if operand is 8-bit register
    isR8(op) {
        const upper = op.toUpperCase();
        return upper in this.R8;
    },

    // Check if operand is 16-bit register pair
    isR16(op) {
        const upper = op.toUpperCase();
        return upper in this.R16;
    },

    // Check if operand is index register
    isIndex(op) {
        const upper = op.toUpperCase();
        return upper === 'IX' || upper === 'IY';
    },

    // Check for indexed addressing: (IX+d) or (IY+d)
    isIndexed(op) {
        const upper = op.toUpperCase();
        return /^\(I[XY][+-]/.test(upper) || upper === '(IX)' || upper === '(IY)';
    },

    // Parse indexed addressing, returns { reg: 'IX'|'IY', offset: expr }
    parseIndexed(op) {
        const match = op.match(/^\(I([XY])([+-].*?)?\)$/i);
        if (!match) return null;
        return {
            reg: 'I' + match[1].toUpperCase(),
            offset: match[2] || '+0'
        };
    },

    // Check for indirect addressing: (BC), (DE), (HL), (nn)
    isIndirect(op) {
        return op.startsWith('(') && op.endsWith(')');
    },

    // Check if operand is condition code
    isCC(op) {
        const upper = op.toUpperCase();
        return upper in this.CC;
    },

    // Get 8-bit register code
    getR8(op) {
        const upper = op.toUpperCase();
        if (upper in this.R8) return this.R8[upper];
        return null;
    },

    // Get 16-bit register pair code
    getR16(op) {
        const upper = op.toUpperCase();
        if (upper in this.R16) return this.R16[upper];
        return null;
    },

    // Get condition code
    getCC(op) {
        const upper = op.toUpperCase();
        if (upper in this.CC) return this.CC[upper];
        return null;
    },

    // Helper to create bytes array
    bytes(...args) {
        return args;
    },

    // Sign extend 8-bit to check range
    checkByte(value, signed = false) {
        if (signed) {
            if (value < -128 || value > 127) {
                ErrorCollector.warn(`Value ${value} out of signed byte range`);
            }
        } else {
            if (value < -128 || value > 255) {
                ErrorCollector.warn(`Value ${value} out of byte range`);
            }
        }
        return value & 0xFF;
    },

    // Check 16-bit value range
    checkWord(value) {
        if (value < -32768 || value > 65535) {
            ErrorCollector.warn(`Value ${value} out of word range`);
        }
        return value & 0xFFFF;
    },

    // Split word into low/high bytes
    wordBytes(value) {
        const w = this.checkWord(value);
        return [w & 0xFF, (w >> 8) & 0xFF];
    }
};

// Instruction encoder
export const InstructionEncoder = {
    // Encode a single instruction
    // Returns { bytes: [...], size: n, undefined: bool }
    encode(mnemonic, operands, currentAddress, symbols) {
        const mn = mnemonic.toUpperCase();
        const ops = operands.map(o => o.trim());

        // Dispatch to specific encoder
        const encoder = this.encoders[mn];
        if (!encoder) {
            return null; // Unknown instruction
        }

        try {
            return encoder.call(this, ops, currentAddress, symbols);
        } catch (e) {
            if (e instanceof AssemblerError) throw e;
            ErrorCollector.error(`Error encoding ${mn}: ${e.message}`);
        }
    },

    // Evaluate operand expression
    evalExpr(op, symbols, currentAddress) {
        // Remove parentheses if indirect
        let expr = op;
        if (expr.startsWith('(') && expr.endsWith(')')) {
            const inner = expr.slice(1, -1);
            // Check if it's a simple register
            const upper = inner.toUpperCase();
            if (['HL', 'BC', 'DE', 'SP', 'IX', 'IY', 'C'].includes(upper)) {
                return { value: 0, undefined: false, isReg: true };
            }
            expr = inner;
        }

        // Parse indexed: (IX+n) -> extract n
        const idxMatch = expr.match(/^I[XY]([+-].*)$/i);
        if (idxMatch) {
            expr = idxMatch[1];
        }

        return parseExpression(expr, symbols, currentAddress);
    },

    // Main encoder dispatch table
    encoders: {
        // 8-bit load instructions
        'LD': function(ops, addr, syms) {
            if (ops.length !== 2) {
                ErrorCollector.error('LD requires 2 operands');
            }
            return this.encodeLD(ops[0], ops[1], addr, syms);
        },

        // Arithmetic
        'ADD': function(ops, addr, syms) { return this.encodeALU('ADD', ops, addr, syms); },
        'ADC': function(ops, addr, syms) { return this.encodeALU('ADC', ops, addr, syms); },
        'SUB': function(ops, addr, syms) { return this.encodeALU('SUB', ops, addr, syms); },
        'SBC': function(ops, addr, syms) { return this.encodeALU('SBC', ops, addr, syms); },
        'AND': function(ops, addr, syms) { return this.encodeALU('AND', ops, addr, syms); },
        'XOR': function(ops, addr, syms) { return this.encodeALU('XOR', ops, addr, syms); },
        'OR': function(ops, addr, syms) { return this.encodeALU('OR', ops, addr, syms); },
        'CP': function(ops, addr, syms) { return this.encodeALU('CP', ops, addr, syms); },

        // Increment/Decrement
        'INC': function(ops, addr, syms) { return this.encodeINCDEC('INC', ops, addr, syms); },
        'DEC': function(ops, addr, syms) { return this.encodeINCDEC('DEC', ops, addr, syms); },

        // Jumps
        'JP': function(ops, addr, syms) { return this.encodeJP(ops, addr, syms); },
        'JR': function(ops, addr, syms) { return this.encodeJR(ops, addr, syms); },
        'DJNZ': function(ops, addr, syms) { return this.encodeDJNZ(ops, addr, syms); },

        // Calls and returns
        'CALL': function(ops, addr, syms) { return this.encodeCALL(ops, addr, syms); },
        'RET': function(ops, addr, syms) { return this.encodeRET(ops, addr, syms); },
        'RST': function(ops, addr, syms) { return this.encodeRST(ops, addr, syms); },

        // Stack
        'PUSH': function(ops, addr, syms) { return this.encodePUSHPOP('PUSH', ops, addr, syms); },
        'POP': function(ops, addr, syms) { return this.encodePUSHPOP('POP', ops, addr, syms); },

        // Exchange
        'EX': function(ops, addr, syms) { return this.encodeEX(ops, addr, syms); },
        'EXX': function(ops) { return { bytes: [0xD9], size: 1, undefined: false }; },

        // Rotates and shifts
        'RLCA': function() { return { bytes: [0x07], size: 1, undefined: false }; },
        'RRCA': function() { return { bytes: [0x0F], size: 1, undefined: false }; },
        'RLA': function() { return { bytes: [0x17], size: 1, undefined: false }; },
        'RRA': function() { return { bytes: [0x1F], size: 1, undefined: false }; },
        'RLC': function(ops, addr, syms) { return this.encodeCB('RLC', ops, addr, syms); },
        'RRC': function(ops, addr, syms) { return this.encodeCB('RRC', ops, addr, syms); },
        'RL': function(ops, addr, syms) { return this.encodeCB('RL', ops, addr, syms); },
        'RR': function(ops, addr, syms) { return this.encodeCB('RR', ops, addr, syms); },
        'SLA': function(ops, addr, syms) { return this.encodeCB('SLA', ops, addr, syms); },
        'SRA': function(ops, addr, syms) { return this.encodeCB('SRA', ops, addr, syms); },
        'SRL': function(ops, addr, syms) { return this.encodeCB('SRL', ops, addr, syms); },
        'SLL': function(ops, addr, syms) { return this.encodeCB('SLL', ops, addr, syms); }, // Undocumented

        // Bit operations
        'BIT': function(ops, addr, syms) { return this.encodeBIT('BIT', ops, addr, syms); },
        'SET': function(ops, addr, syms) { return this.encodeBIT('SET', ops, addr, syms); },
        'RES': function(ops, addr, syms) { return this.encodeBIT('RES', ops, addr, syms); },

        // I/O
        'IN': function(ops, addr, syms) { return this.encodeIN(ops, addr, syms); },
        'OUT': function(ops, addr, syms) { return this.encodeOUT(ops, addr, syms); },

        // Misc single-byte
        'NOP': function() { return { bytes: [0x00], size: 1, undefined: false }; },
        'HALT': function() { return { bytes: [0x76], size: 1, undefined: false }; },
        'DI': function() { return { bytes: [0xF3], size: 1, undefined: false }; },
        'EI': function() { return { bytes: [0xFB], size: 1, undefined: false }; },
        'SCF': function() { return { bytes: [0x37], size: 1, undefined: false }; },
        'CCF': function() { return { bytes: [0x3F], size: 1, undefined: false }; },
        'CPL': function() { return { bytes: [0x2F], size: 1, undefined: false }; },
        'NEG': function() { return { bytes: [0xED, 0x44], size: 2, undefined: false }; },
        'DAA': function() { return { bytes: [0x27], size: 1, undefined: false }; },

        // ED prefix instructions
        'RETI': function() { return { bytes: [0xED, 0x4D], size: 2, undefined: false }; },
        'RETN': function() { return { bytes: [0xED, 0x45], size: 2, undefined: false }; },
        'IM': function(ops, addr, syms) { return this.encodeIM(ops, addr, syms); },
        'RRD': function() { return { bytes: [0xED, 0x67], size: 2, undefined: false }; },
        'RLD': function() { return { bytes: [0xED, 0x6F], size: 2, undefined: false }; },

        // Block instructions
        'LDI': function() { return { bytes: [0xED, 0xA0], size: 2, undefined: false }; },
        'LDIR': function() { return { bytes: [0xED, 0xB0], size: 2, undefined: false }; },
        'LDD': function() { return { bytes: [0xED, 0xA8], size: 2, undefined: false }; },
        'LDDR': function() { return { bytes: [0xED, 0xB8], size: 2, undefined: false }; },
        'CPI': function() { return { bytes: [0xED, 0xA1], size: 2, undefined: false }; },
        'CPIR': function() { return { bytes: [0xED, 0xB1], size: 2, undefined: false }; },
        'CPD': function() { return { bytes: [0xED, 0xA9], size: 2, undefined: false }; },
        'CPDR': function() { return { bytes: [0xED, 0xB9], size: 2, undefined: false }; },
        'INI': function() { return { bytes: [0xED, 0xA2], size: 2, undefined: false }; },
        'INIR': function() { return { bytes: [0xED, 0xB2], size: 2, undefined: false }; },
        'IND': function() { return { bytes: [0xED, 0xAA], size: 2, undefined: false }; },
        'INDR': function() { return { bytes: [0xED, 0xBA], size: 2, undefined: false }; },
        'OUTI': function() { return { bytes: [0xED, 0xA3], size: 2, undefined: false }; },
        'OTIR': function() { return { bytes: [0xED, 0xB3], size: 2, undefined: false }; },
        'OUTD': function() { return { bytes: [0xED, 0xAB], size: 2, undefined: false }; },
        'OTDR': function() { return { bytes: [0xED, 0xBB], size: 2, undefined: false }; },
    }
};
