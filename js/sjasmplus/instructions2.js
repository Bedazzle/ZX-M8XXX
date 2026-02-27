// sjasmplus-js v0.10.22 - Z80 Assembler for ZX Spectrum
// Z80 Instruction Encoder - Part 2: LD and ALU instructions

import { ErrorCollector } from './errors.js';
import { Z80Asm, InstructionEncoder } from './instructions.js';

// Add LD encoder to InstructionEncoder
InstructionEncoder.encodeLD = function(dest, src, addr, syms) {
    // Uppercase for pattern matching only - preserve original for expression evaluation
    const d = dest.toUpperCase();
    const s = src.toUpperCase();

    // LD A, I / LD A, R / LD I, A / LD R, A (must be before r,r check)
    if (d === 'A' && s === 'I') return { bytes: [0xED, 0x57], size: 2, undefined: false };
    if (d === 'A' && s === 'R') return { bytes: [0xED, 0x5F], size: 2, undefined: false };
    if (d === 'I' && s === 'A') return { bytes: [0xED, 0x47], size: 2, undefined: false };
    if (d === 'R' && s === 'A') return { bytes: [0xED, 0x4F], size: 2, undefined: false };

    // LD SP, HL (must be before rp, nn check)
    if (d === 'SP' && s === 'HL') {
        return { bytes: [0xF9], size: 1, undefined: false };
    }

    // LD SP, IX/IY
    if (d === 'SP' && (s === 'IX' || s === 'IY')) {
        const prefix = s === 'IX' ? 0xDD : 0xFD;
        return { bytes: [prefix, 0xF9], size: 2, undefined: false };
    }

    // LD A, (BC) / LD A, (DE) (must be before r, n check)
    if (d === 'A' && (s === '(BC)' || s === '(DE)')) {
        const code = s === '(BC)' ? 0x0A : 0x1A;
        return { bytes: [code], size: 1, undefined: false };
    }

    // LD (BC), A / LD (DE), A
    if ((d === '(BC)' || d === '(DE)') && s === 'A') {
        const code = d === '(BC)' ? 0x02 : 0x12;
        return { bytes: [code], size: 1, undefined: false };
    }

    // LD r, (IX+d) / LD r, (IY+d) (must be before r, n check)
    const srcIdx = Z80Asm.parseIndexed(src);
    if (srcIdx && Z80Asm.isR8(d) && d !== '(HL)') {
        const prefix = srcIdx.reg === 'IX' ? 0xDD : 0xFD;
        const dr = Z80Asm.getR8(d);
        const offset = this.evalExpr(srcIdx.offset, syms, addr);
        const disp = Z80Asm.checkByte(offset.value, true);
        return { bytes: [prefix, 0x46 | (dr << 3), disp], size: 3, undefined: offset.undefined };
    }

    // LD (IX+d), r / LD (IY+d), r
    const destIdx = Z80Asm.parseIndexed(dest);
    if (destIdx && Z80Asm.isR8(s) && s !== '(HL)') {
        const prefix = destIdx.reg === 'IX' ? 0xDD : 0xFD;
        const sr = Z80Asm.getR8(s);
        const offset = this.evalExpr(destIdx.offset, syms, addr);
        const disp = Z80Asm.checkByte(offset.value, true);
        return { bytes: [prefix, 0x70 | sr, disp], size: 3, undefined: offset.undefined };
    }

    // LD (IX+d), n / LD (IY+d), n
    if (destIdx) {
        const prefix = destIdx.reg === 'IX' ? 0xDD : 0xFD;
        const offset = this.evalExpr(destIdx.offset, syms, addr);
        const disp = Z80Asm.checkByte(offset.value, true);
        const val = this.evalExpr(src, syms, addr);
        const n = Z80Asm.checkByte(val.value);
        return { bytes: [prefix, 0x36, disp, n], size: 4, undefined: offset.undefined || val.undefined };
    }

    // LD HL, (nn) (must be before rp, (nn) check for efficiency)
    if (d === 'HL' && Z80Asm.isIndirect(s) && !['(BC)', '(DE)', '(SP)'].includes(s)) {
        const val = this.evalExpr(src, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0x2A, lo, hi], size: 3, undefined: val.undefined };
    }

    // LD (nn), HL
    if (Z80Asm.isIndirect(d) && s === 'HL' && !['(BC)', '(DE)', '(SP)'].includes(d)) {
        const val = this.evalExpr(dest, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0x22, lo, hi], size: 3, undefined: val.undefined };
    }

    // LD IX/IY, (nn)
    if ((d === 'IX' || d === 'IY') && Z80Asm.isIndirect(s)) {
        const prefix = d === 'IX' ? 0xDD : 0xFD;
        const val = this.evalExpr(src, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [prefix, 0x2A, lo, hi], size: 4, undefined: val.undefined };
    }

    // LD (nn), IX/IY
    if (Z80Asm.isIndirect(d) && (s === 'IX' || s === 'IY')) {
        const prefix = s === 'IX' ? 0xDD : 0xFD;
        const val = this.evalExpr(dest, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [prefix, 0x22, lo, hi], size: 4, undefined: val.undefined };
    }

    // LD A, (nn)
    if (d === 'A' && Z80Asm.isIndirect(s) && !['(BC)', '(DE)', '(HL)'].includes(s)) {
        const val = this.evalExpr(src, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0x3A, lo, hi], size: 3, undefined: val.undefined };
    }

    // LD (nn), A
    if (Z80Asm.isIndirect(d) && s === 'A' && !['(BC)', '(DE)', '(HL)'].includes(d)) {
        const val = this.evalExpr(dest, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0x32, lo, hi], size: 3, undefined: val.undefined };
    }

    // LD (nn), rp (ED prefix) - BC, DE, SP (not HL, that's handled above)
    if (Z80Asm.isIndirect(d) && Z80Asm.isR16(s) && s !== 'HL') {
        const rp = Z80Asm.getR16(s);
        const val = this.evalExpr(dest, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0xED, 0x43 | (rp << 4), lo, hi], size: 4, undefined: val.undefined };
    }

    // LD rp, (nn) (ED prefix) - BC, DE, SP (not HL)
    if (Z80Asm.isR16(d) && d !== 'HL' && Z80Asm.isIndirect(s)) {
        const rp = Z80Asm.getR16(d);
        const val = this.evalExpr(src, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0xED, 0x4B | (rp << 4), lo, hi], size: 4, undefined: val.undefined };
    }

    // Undocumented: LD IXH/IXL/IYH/IYL, r or LD r, IXH/IXL/IYH/IYL
    const undocDest = /^I([XY])([HL])$/.exec(d);
    const undocSrc = /^I([XY])([HL])$/.exec(s);

    if (undocDest && Z80Asm.isR8(s) && s !== '(HL)') {
        const prefix = undocDest[1] === 'X' ? 0xDD : 0xFD;
        const dr = undocDest[2] === 'H' ? 4 : 5;
        const sr = Z80Asm.getR8(s);
        return { bytes: [prefix, 0x40 | (dr << 3) | sr], size: 2, undefined: false };
    }

    if (undocSrc && Z80Asm.isR8(d) && d !== '(HL)') {
        const prefix = undocSrc[1] === 'X' ? 0xDD : 0xFD;
        const dr = Z80Asm.getR8(d);
        const sr = undocSrc[2] === 'H' ? 4 : 5;
        return { bytes: [prefix, 0x40 | (dr << 3) | sr], size: 2, undefined: false };
    }

    // LD IXH/IXL, n  /  LD IYH/IYL, n
    if (undocDest) {
        const prefix = undocDest[1] === 'X' ? 0xDD : 0xFD;
        const dr = undocDest[2] === 'H' ? 4 : 5;
        const val = this.evalExpr(src, syms, addr);
        const n = Z80Asm.checkByte(val.value);
        return { bytes: [prefix, 0x06 | (dr << 3), n], size: 3, undefined: val.undefined };
    }

    // LD r, r' (8-bit register to register)
    if (Z80Asm.isR8(d) && Z80Asm.isR8(s)) {
        const dr = Z80Asm.getR8(d);
        const sr = Z80Asm.getR8(s);
        // Can't do LD (HL), (HL) - that's HALT
        if (dr === 6 && sr === 6) {
            ErrorCollector.error('LD (HL), (HL) is not valid');
        }
        return { bytes: [0x40 | (dr << 3) | sr], size: 1, undefined: false };
    }

    // LD r, n (8-bit immediate)
    if (Z80Asm.isR8(d)) {
        const dr = Z80Asm.getR8(d);
        const val = this.evalExpr(src, syms, addr);
        const n = Z80Asm.checkByte(val.value);
        return { bytes: [0x06 | (dr << 3), n], size: 2, undefined: val.undefined };
    }

    // LD IX/IY, nn
    if (d === 'IX' || d === 'IY') {
        const prefix = d === 'IX' ? 0xDD : 0xFD;
        const val = this.evalExpr(src, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [prefix, 0x21, lo, hi], size: 4, undefined: val.undefined };
    }

    // LD rp, nn (16-bit immediate)
    if (Z80Asm.isR16(d)) {
        const rp = Z80Asm.getR16(d);
        const val = this.evalExpr(src, syms, addr);
        const [lo, hi] = Z80Asm.wordBytes(val.value);
        return { bytes: [0x01 | (rp << 4), lo, hi], size: 3, undefined: val.undefined };
    }

    ErrorCollector.error(`Invalid LD operands: ${dest}, ${src}`);
};

// ALU operations encoder
InstructionEncoder.encodeALU = function(op, ops, addr, syms) {
    const aluCodes = { ADD: 0, ADC: 1, SUB: 2, SBC: 3, AND: 4, XOR: 5, OR: 6, CP: 7 };
    const code = aluCodes[op];

    // ADD/ADC/SBC can have 16-bit forms
    if ((op === 'ADD' || op === 'ADC' || op === 'SBC') && ops.length === 2) {
        const d = ops[0].toUpperCase();
        const s = ops[1].toUpperCase();

        // ADD HL, rp
        if (op === 'ADD' && d === 'HL' && Z80Asm.isR16(s)) {
            const rp = Z80Asm.getR16(s);
            return { bytes: [0x09 | (rp << 4)], size: 1, undefined: false };
        }

        // ADC HL, rp
        if (op === 'ADC' && d === 'HL' && Z80Asm.isR16(s)) {
            const rp = Z80Asm.getR16(s);
            return { bytes: [0xED, 0x4A | (rp << 4)], size: 2, undefined: false };
        }

        // SBC HL, rp
        if (op === 'SBC' && d === 'HL' && Z80Asm.isR16(s)) {
            const rp = Z80Asm.getR16(s);
            return { bytes: [0xED, 0x42 | (rp << 4)], size: 2, undefined: false };
        }

        // ADD IX, rp / ADD IY, rp
        if (op === 'ADD' && (d === 'IX' || d === 'IY')) {
            const prefix = d === 'IX' ? 0xDD : 0xFD;
            let rp;
            if (s === d) rp = 2; // IX+IX or IY+IY uses HL slot
            else if (s === 'BC') rp = 0;
            else if (s === 'DE') rp = 1;
            else if (s === 'SP') rp = 3;
            else {
                ErrorCollector.error(`Invalid ADD ${d}, ${s}`);
            }
            return { bytes: [prefix, 0x09 | (rp << 4)], size: 2, undefined: false };
        }

        // 8-bit: ADD A, r etc
        if (d === 'A') {
            return this.encodeALU8(op, ops[1], addr, syms);
        }
    }

    // Single operand: SUB r, AND r, etc. (implicit A)
    if (ops.length === 1) {
        return this.encodeALU8(op, ops[0], addr, syms);
    }

    // Two operands with A as first
    if (ops.length === 2 && ops[0].toUpperCase() === 'A') {
        return this.encodeALU8(op, ops[1], addr, syms);
    }

    ErrorCollector.error(`Invalid ${op} operands`);
};

// 8-bit ALU helper
InstructionEncoder.encodeALU8 = function(op, operand, addr, syms) {
    const aluCodes = { ADD: 0, ADC: 1, SUB: 2, SBC: 3, AND: 4, XOR: 5, OR: 6, CP: 7 };
    const code = aluCodes[op];
    const s = operand.toUpperCase();

    // ALU r
    if (Z80Asm.isR8(s)) {
        const sr = Z80Asm.getR8(s);
        return { bytes: [0x80 | (code << 3) | sr], size: 1, undefined: false };
    }

    // ALU (IX+d) / (IY+d)
    const idx = Z80Asm.parseIndexed(operand);
    if (idx) {
        const prefix = idx.reg === 'IX' ? 0xDD : 0xFD;
        const offset = this.evalExpr(idx.offset, syms, addr);
        const disp = Z80Asm.checkByte(offset.value, true);
        return { bytes: [prefix, 0x86 | (code << 3), disp], size: 3, undefined: offset.undefined };
    }

    // ALU n (immediate)
    const val = this.evalExpr(operand, syms, addr);
    const n = Z80Asm.checkByte(val.value);
    return { bytes: [0xC6 | (code << 3), n], size: 2, undefined: val.undefined };
};

// INC/DEC encoder
InstructionEncoder.encodeINCDEC = function(op, ops, addr, syms) {
    if (ops.length !== 1) {
        ErrorCollector.error(`${op} requires 1 operand`);
    }

    const isINC = op === 'INC';
    const operand = ops[0].toUpperCase();

    // INC/DEC r (8-bit)
    if (Z80Asm.isR8(operand)) {
        const r = Z80Asm.getR8(operand);
        const base = isINC ? 0x04 : 0x05;
        return { bytes: [base | (r << 3)], size: 1, undefined: false };
    }

    // INC/DEC rp (16-bit)
    if (Z80Asm.isR16(operand)) {
        const rp = Z80Asm.getR16(operand);
        const base = isINC ? 0x03 : 0x0B;
        return { bytes: [base | (rp << 4)], size: 1, undefined: false };
    }

    // INC/DEC IX/IY
    if (operand === 'IX' || operand === 'IY') {
        const prefix = operand === 'IX' ? 0xDD : 0xFD;
        const base = isINC ? 0x23 : 0x2B;
        return { bytes: [prefix, base], size: 2, undefined: false };
    }

    // INC/DEC (IX+d) / (IY+d)
    const idx = Z80Asm.parseIndexed(ops[0]);
    if (idx) {
        const prefix = idx.reg === 'IX' ? 0xDD : 0xFD;
        const offset = this.evalExpr(idx.offset, syms, addr);
        const disp = Z80Asm.checkByte(offset.value, true);
        const base = isINC ? 0x34 : 0x35;
        return { bytes: [prefix, base, disp], size: 3, undefined: offset.undefined };
    }

    // Undocumented: INC/DEC IXH/IXL/IYH/IYL
    const undoc = /^I([XY])([HL])$/.exec(operand);
    if (undoc) {
        const prefix = undoc[1] === 'X' ? 0xDD : 0xFD;
        const r = undoc[2] === 'H' ? 4 : 5;
        const base = isINC ? 0x04 : 0x05;
        return { bytes: [prefix, base | (r << 3)], size: 2, undefined: false };
    }

    ErrorCollector.error(`Invalid ${op} operand: ${ops[0]}`);
};
