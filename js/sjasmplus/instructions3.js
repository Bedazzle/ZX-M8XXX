// sjasmplus-js v0.10.22 - Z80 Assembler for ZX Spectrum
// Z80 Instruction Encoder - Part 3: Jumps, calls, and misc

import { ErrorCollector } from './errors.js';
import { Z80Asm, InstructionEncoder } from './instructions.js';

// JP encoder
InstructionEncoder.encodeJP = function(ops, addr, syms) {
    if (ops.length === 1) {
        const op = ops[0].toUpperCase();

        // JP (HL)
        if (op === '(HL)') {
            return { bytes: [0xE9], size: 1, undefined: false };
        }

        // JP (IX) / JP (IY)
        if (op === '(IX)' || op === '(IY)') {
            const prefix = op === '(IX)' ? 0xDD : 0xFD;
            return { bytes: [prefix, 0xE9], size: 2, undefined: false };
        }

        // JP nn (unconditional)
        const val = this.evalExpr(ops[0], syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0xC3, lo, hi], size: 3, undefined: val.undefined };
    }

    if (ops.length === 2) {
        // JP cc, nn (conditional)
        const cc = Z80Asm.getCC(ops[0]);
        if (cc === null) {
            ErrorCollector.error(`Invalid condition: ${ops[0]}`);
        }
        const val = this.evalExpr(ops[1], syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0xC2 | (cc << 3), lo, hi], size: 3, undefined: val.undefined };
    }

    ErrorCollector.error('Invalid JP operands');
};

// JR encoder
InstructionEncoder.encodeJR = function(ops, addr, syms) {
    // JR uses relative addressing: target - (current + 2)
    const calcOffset = (target) => {
        const offset = target - (addr + 2);
        if (offset < -128 || offset > 127) {
            ErrorCollector.warn(`JR offset ${offset} out of range`);
        }
        return Z80Asm.checkByte(offset, true);
    };

    if (ops.length === 1) {
        // JR e (unconditional)
        const val = this.evalExpr(ops[0], syms, addr);
        const offset = val.undefined ? 0 : calcOffset(val.value);
        return { bytes: [0x18, offset], size: 2, undefined: val.undefined };
    }

    if (ops.length === 2) {
        // JR cc, e (conditional - only NZ, Z, NC, C)
        const cc = ops[0].toUpperCase();
        const ccMap = { NZ: 0, Z: 1, NC: 2, C: 3 };
        if (!(cc in ccMap)) {
            ErrorCollector.error(`Invalid JR condition: ${ops[0]} (only NZ, Z, NC, C allowed)`);
        }
        const val = this.evalExpr(ops[1], syms, addr);
        const offset = val.undefined ? 0 : calcOffset(val.value);
        return { bytes: [0x20 | (ccMap[cc] << 3), offset], size: 2, undefined: val.undefined };
    }

    ErrorCollector.error('Invalid JR operands');
};

// DJNZ encoder
InstructionEncoder.encodeDJNZ = function(ops, addr, syms) {
    if (ops.length !== 1) {
        ErrorCollector.error('DJNZ requires 1 operand');
    }

    const val = this.evalExpr(ops[0], syms, addr);
    const offset = val.undefined ? 0 : (val.value - (addr + 2));
    if (!val.undefined && (offset < -128 || offset > 127)) {
        ErrorCollector.warn(`DJNZ offset ${offset} out of range`);
    }
    return { bytes: [0x10, Z80Asm.checkByte(offset, true)], size: 2, undefined: val.undefined };
};

// CALL encoder
InstructionEncoder.encodeCALL = function(ops, addr, syms) {
    if (ops.length === 1) {
        // CALL nn (unconditional)
        const val = this.evalExpr(ops[0], syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0xCD, lo, hi], size: 3, undefined: val.undefined };
    }

    if (ops.length === 2) {
        // CALL cc, nn (conditional)
        const cc = Z80Asm.getCC(ops[0]);
        if (cc === null) {
            ErrorCollector.error(`Invalid condition: ${ops[0]}`);
        }
        const val = this.evalExpr(ops[1], syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0xC4 | (cc << 3), lo, hi], size: 3, undefined: val.undefined };
    }

    ErrorCollector.error('Invalid CALL operands');
};

// RET encoder
InstructionEncoder.encodeRET = function(ops, addr, syms) {
    if (ops.length === 0) {
        // RET (unconditional)
        return { bytes: [0xC9], size: 1, undefined: false };
    }

    if (ops.length === 1) {
        // RET cc (conditional)
        const cc = Z80Asm.getCC(ops[0]);
        if (cc === null) {
            ErrorCollector.error(`Invalid condition: ${ops[0]}`);
        }
        return { bytes: [0xC0 | (cc << 3)], size: 1, undefined: false };
    }

    ErrorCollector.error('Invalid RET operands');
};

// RST encoder
InstructionEncoder.encodeRST = function(ops, addr, syms) {
    if (ops.length !== 1) {
        ErrorCollector.error('RST requires 1 operand');
    }

    const val = this.evalExpr(ops[0], syms, addr);
    const valid = [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38];
    if (!val.undefined && !valid.includes(val.value)) {
        ErrorCollector.error(`Invalid RST address: ${val.value} (must be 0, 8, 16, 24, 32, 40, 48, or 56)`);
    }
    const p = (val.value >> 3) & 7;
    return { bytes: [0xC7 | (p << 3)], size: 1, undefined: val.undefined };
};

// PUSH/POP encoder
InstructionEncoder.encodePUSHPOP = function(op, ops, addr, syms) {
    if (ops.length !== 1) {
        ErrorCollector.error(`${op} requires 1 operand`);
    }

    const reg = ops[0].toUpperCase();
    const isPush = op === 'PUSH';
    const base = isPush ? 0xC5 : 0xC1;

    // PUSH/POP qq (BC, DE, HL, AF)
    const r16af = { BC: 0, DE: 1, HL: 2, AF: 3 };
    if (reg in r16af) {
        return { bytes: [base | (r16af[reg] << 4)], size: 1, undefined: false };
    }

    // PUSH/POP IX/IY
    if (reg === 'IX' || reg === 'IY') {
        const prefix = reg === 'IX' ? 0xDD : 0xFD;
        const code = isPush ? 0xE5 : 0xE1;
        return { bytes: [prefix, code], size: 2, undefined: false };
    }

    ErrorCollector.error(`Invalid ${op} operand: ${ops[0]}`);
};

// EX encoder
InstructionEncoder.encodeEX = function(ops, addr, syms) {
    if (ops.length !== 2) {
        ErrorCollector.error('EX requires 2 operands');
    }

    const d = ops[0].toUpperCase();
    const s = ops[1].toUpperCase();

    // EX DE, HL
    if (d === 'DE' && s === 'HL') {
        return { bytes: [0xEB], size: 1, undefined: false };
    }

    // EX AF, AF'
    if ((d === 'AF' && (s === "AF'" || s === "AF`")) ||
        ((d === "AF'" || d === "AF`") && s === 'AF')) {
        return { bytes: [0x08], size: 1, undefined: false };
    }

    // EX (SP), HL
    if (d === '(SP)' && s === 'HL') {
        return { bytes: [0xE3], size: 1, undefined: false };
    }

    // EX (SP), IX/IY
    if (d === '(SP)' && (s === 'IX' || s === 'IY')) {
        const prefix = s === 'IX' ? 0xDD : 0xFD;
        return { bytes: [prefix, 0xE3], size: 2, undefined: false };
    }

    ErrorCollector.error(`Invalid EX operands: ${ops[0]}, ${ops[1]}`);
};

// CB prefix operations (rotates/shifts)
InstructionEncoder.encodeCB = function(op, ops, addr, syms) {
    if (ops.length !== 1) {
        ErrorCollector.error(`${op} requires 1 operand`);
    }

    const cbCode = Z80Asm.CB_OP[op];
    const operand = ops[0].toUpperCase();

    // CB r
    if (Z80Asm.isR8(operand)) {
        const r = Z80Asm.getR8(operand);
        return { bytes: [0xCB, (cbCode << 3) | r], size: 2, undefined: false };
    }

    // CB (IX+d) / CB (IY+d)
    const idx = Z80Asm.parseIndexed(ops[0]);
    if (idx) {
        const prefix = idx.reg === 'IX' ? 0xDD : 0xFD;
        const offset = this.evalExpr(idx.offset, syms, addr);
        const disp = Z80Asm.checkByte(offset.value, true);
        return { bytes: [prefix, 0xCB, disp, (cbCode << 3) | 6], size: 4, undefined: offset.undefined };
    }

    ErrorCollector.error(`Invalid ${op} operand: ${ops[0]}`);
};

// BIT/SET/RES encoder
InstructionEncoder.encodeBIT = function(op, ops, addr, syms) {
    if (ops.length !== 2) {
        ErrorCollector.error(`${op} requires 2 operands`);
    }

    const bitOps = { BIT: 1, RES: 2, SET: 3 };
    const opCode = bitOps[op];

    // Get bit number
    const bitVal = this.evalExpr(ops[0], syms, addr);
    if (!bitVal.undefined && (bitVal.value < 0 || bitVal.value > 7)) {
        ErrorCollector.error(`Bit number must be 0-7, got ${bitVal.value}`);
    }
    const bit = bitVal.value & 7;

    const operand = ops[1].toUpperCase();

    // BIT b, r
    if (Z80Asm.isR8(operand)) {
        const r = Z80Asm.getR8(operand);
        return { bytes: [0xCB, (opCode << 6) | (bit << 3) | r], size: 2, undefined: bitVal.undefined };
    }

    // BIT b, (IX+d) / BIT b, (IY+d)
    const idx = Z80Asm.parseIndexed(ops[1]);
    if (idx) {
        const prefix = idx.reg === 'IX' ? 0xDD : 0xFD;
        const offset = this.evalExpr(idx.offset, syms, addr);
        const disp = Z80Asm.checkByte(offset.value, true);
        return { bytes: [prefix, 0xCB, disp, (opCode << 6) | (bit << 3) | 6], size: 4,
                 undefined: bitVal.undefined || offset.undefined };
    }

    ErrorCollector.error(`Invalid ${op} operand: ${ops[1]}`);
};

// IN encoder
InstructionEncoder.encodeIN = function(ops, addr, syms) {
    if (ops.length === 2) {
        const d = ops[0].toUpperCase();
        const s = ops[1].toUpperCase();

        // IN A, (n)
        if (d === 'A' && s.startsWith('(') && s.endsWith(')')) {
            const inner = s.slice(1, -1).toUpperCase();
            if (inner !== 'C') {
                const val = this.evalExpr(ops[1], syms, addr);  // Use original case
                const n = Z80Asm.checkByte(val.value);
                return { bytes: [0xDB, n], size: 2, undefined: val.undefined };
            }
        }

        // IN r, (C)
        if (Z80Asm.isR8(d) && s === '(C)') {
            const r = Z80Asm.getR8(d);
            return { bytes: [0xED, 0x40 | (r << 3)], size: 2, undefined: false };
        }
    }

    // IN F, (C) - undocumented, reads flags
    if (ops.length === 2 && ops[0].toUpperCase() === 'F' && ops[1].toUpperCase() === '(C)') {
        return { bytes: [0xED, 0x70], size: 2, undefined: false };
    }

    ErrorCollector.error('Invalid IN operands');
};

// OUT encoder
InstructionEncoder.encodeOUT = function(ops, addr, syms) {
    if (ops.length === 2) {
        const d = ops[0].toUpperCase();
        const s = ops[1].toUpperCase();

        // OUT (n), A
        if (d.startsWith('(') && d.endsWith(')') && s === 'A') {
            const inner = d.slice(1, -1).toUpperCase();
            if (inner !== 'C') {
                const val = this.evalExpr(ops[0], syms, addr);  // Use original case
                const n = Z80Asm.checkByte(val.value);
                return { bytes: [0xD3, n], size: 2, undefined: val.undefined };
            }
        }

        // OUT (C), r
        if (d === '(C)' && Z80Asm.isR8(s)) {
            const r = Z80Asm.getR8(s);
            return { bytes: [0xED, 0x41 | (r << 3)], size: 2, undefined: false };
        }

        // OUT (C), 0 - undocumented
        if (d === '(C)' && s === '0') {
            return { bytes: [0xED, 0x71], size: 2, undefined: false };
        }
    }

    ErrorCollector.error('Invalid OUT operands');
};

// IM encoder
InstructionEncoder.encodeIM = function(ops, addr, syms) {
    if (ops.length !== 1) {
        ErrorCollector.error('IM requires 1 operand');
    }

    const val = this.evalExpr(ops[0], syms, addr);
    const modes = { 0: 0x46, 1: 0x56, 2: 0x5E };

    if (!val.undefined && !(val.value in modes)) {
        ErrorCollector.error(`Invalid IM mode: ${val.value} (must be 0, 1, or 2)`);
    }

    return { bytes: [0xED, modes[val.value] || 0x46], size: 2, undefined: val.undefined };
};
