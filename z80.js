/**
 * ZX-M8XXX - Z80 CPU Emulation
 * @version 0.6.5
 * @license GPL-3.0
 * 
 * Full Z80 CPU emulation including all documented and undocumented opcodes.
 * Based on Zilog Z80 documentation and Fuse emulator behavior.
 */

(function(global) {
    'use strict';
    
    const VERSION = '0.6.5';

    class Z80 {
        static get VERSION() { return VERSION; }
        
        constructor(memory) {
            this.memory = memory;
            this.halted = false;
            this.iff1 = false;
            this.iff2 = false;
            this.im = 0;
            this.eiPending = false;
            
            // Contention handler (set by Spectrum class)
            this.contend = null;

            // Debug: trace EI/DI and interrupt handling
            this.debugInterrupts = false;
            
            // Main registers
            this.a = 0; this.f = 0;
            this.b = 0; this.c = 0;
            this.d = 0; this.e = 0;
            this.h = 0; this.l = 0;
            
            // Alternate registers
            this.a_ = 0; this.f_ = 0;
            this.b_ = 0; this.c_ = 0;
            this.d_ = 0; this.e_ = 0;
            this.h_ = 0; this.l_ = 0;
            
            // Index registers
            this.ix = 0;
            this.iy = 0;
            
            // Other registers
            this.sp = 0xffff;
            this.pc = 0;
            this.i = 0;
            this.r = 0;
            this.r7 = 0; // Bit 7 of R is preserved separately
            
            // Internal state for MEMPTR (WZ) - undocumented
            this.memptr = 0;
            
            // Q flag for SCF/CCF - undocumented behavior
            this.q = 0;
            this.lastQ = 0;

            // Cycle counter
            this.tStates = 0;
            
            // Port handlers
            this.portRead = null;
            this.portWrite = null;

            // Fetch callback for auto-mapping (called with PC before each fetch)
            this.onFetch = null;
            
            // Flag bits
            this.FLAG_C = 0x01;
            this.FLAG_N = 0x02;
            this.FLAG_PV = 0x04;
            this.FLAG_3 = 0x08;
            this.FLAG_H = 0x10;
            this.FLAG_5 = 0x20;
            this.FLAG_Z = 0x40;
            this.FLAG_S = 0x80;
            
            // Lookup tables
            this.sz53Table = new Uint8Array(256);
            this.parityTable = new Uint8Array(256);
            this.sz53pTable = new Uint8Array(256);
            
            this.initTables();
        }
        
        initTables() {
            for (let i = 0; i < 256; i++) {
                let p = 0;
                let v = i;
                for (let j = 0; j < 8; j++) {
                    p ^= v & 1;
                    v >>= 1;
                }
                this.parityTable[i] = p ? 0 : this.FLAG_PV;
                this.sz53Table[i] = (i & 0x80) | (i & 0x28) | (i === 0 ? this.FLAG_Z : 0);
                this.sz53pTable[i] = this.sz53Table[i] | this.parityTable[i];
            }
        }
        
        reset() {
            this.a = this.f = 0xff;
            this.b = this.c = this.d = this.e = this.h = this.l = 0;
            this.a_ = this.f_ = this.b_ = this.c_ = this.d_ = this.e_ = this.h_ = this.l_ = 0;
            this.ix = this.iy = 0;
            this.sp = 0xffff;
            this.pc = 0;
            this.i = this.r = this.r7 = 0;
            this.iff1 = this.iff2 = false;
            this.im = 0;
            this.halted = false;
            this.memptr = 0;
            this.q = 0;
            this.lastQ = 0;
            this.tStates = 0;
        }
        
        // Register pair accessors
        get af() { return (this.a << 8) | this.f; }
        set af(v) { this.a = (v >> 8) & 0xff; this.f = v & 0xff; }
        
        get bc() { return (this.b << 8) | this.c; }
        set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
        
        get de() { return (this.d << 8) | this.e; }
        set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
        
        get hl() { return (this.h << 8) | this.l; }
        set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
        
        get ixh() { return (this.ix >> 8) & 0xff; }
        set ixh(v) { this.ix = (v << 8) | (this.ix & 0xff); }
        
        get ixl() { return this.ix & 0xff; }
        set ixl(v) { this.ix = (this.ix & 0xff00) | (v & 0xff); }
        
        get iyh() { return (this.iy >> 8) & 0xff; }
        set iyh(v) { this.iy = (v << 8) | (this.iy & 0xff); }
        
        get iyl() { return this.iy & 0xff; }
        set iyl(v) { this.iy = (this.iy & 0xff00) | (v & 0xff); }
        
        // R register: lower 7 bits auto-increment, bit 7 is preserved separately
        get rFull() { return (this.r & 0x7f) | this.r7; }
        set rFull(v) { this.r = v & 0x7f; this.r7 = v & 0x80; }
        
        incR() {
            this.r = (this.r + 1) & 0x7f;
        }
        
        // Memory access with contention
        readByte(addr) {
            addr &= 0xffff;
            if (this.contend) this.contend(addr);
            return this.memory.read(addr);
        }
        
        writeByte(addr, val) {
            addr &= 0xffff;
            if (this.contend) this.contend(addr);
            this.memory.write(addr, val & 0xff);
        }
        
        readWord(addr) {
            return this.readByte(addr) | (this.readByte((addr + 1) & 0xffff) << 8);
        }
        
        writeWord(addr, val) {
            this.writeByte(addr, val & 0xff);
            this.writeByte((addr + 1) & 0xffff, (val >> 8) & 0xff);
        }
        
        // Fetch operations
        fetchByte() {
            if (this.onFetch) this.onFetch(this.pc);
            const val = this.readByte(this.pc);
            this.pc = (this.pc + 1) & 0xffff;
            return val;
        }
        
        fetchWord() {
            const lo = this.fetchByte();
            const hi = this.fetchByte();
            return (hi << 8) | lo;
        }
        
        fetchDisplacement() {
            const d = this.fetchByte();
            return d < 128 ? d : d - 256;
        }
        
        // Stack operations
        push(val) {
            this.sp = (this.sp - 1) & 0xffff;
            this.writeByte(this.sp, (val >> 8) & 0xff);
            this.sp = (this.sp - 1) & 0xffff;
            this.writeByte(this.sp, val & 0xff);
        }
        
        pop() {
            const lo = this.readByte(this.sp);
            this.sp = (this.sp + 1) & 0xffff;
            const hi = this.readByte(this.sp);
            this.sp = (this.sp + 1) & 0xffff;
            return (hi << 8) | lo;
        }
        
        // Port I/O
        inPort(port) {
            if (this.ioContend) this.ioContend(port);
            if (this.portRead) {
                return this.portRead(port);
            }
            return 0xff;
        }

        outPort(port, val, instructionTiming = 12) {
            if (this.ioContend) this.ioContend(port);
            if (this.portWrite) {
                this.portWrite(port, val, instructionTiming);
            }
        }
        
        // Interrupt handling
        interrupt() {
            if (!this.iff1) return 0;

            const wasHalted = this.halted;
            const oldPC = this.pc;

            // Exit halt state - PC points to HALT, need to increment to next instruction
            if (this.halted) {
                this.halted = false;
                this.pc = (this.pc + 1) & 0xffff;
            }

            this.iff1 = this.iff2 = false;
            this.incR();

            switch (this.im) {
                case 0:
                case 1:
                    this.push(this.pc);
                    this.pc = 0x0038;
                    this.memptr = this.pc;
                    if (this.debugInterrupts) console.log(`[INT] IM${this.im}: wasHalted=${wasHalted}, oldPC=${oldPC.toString(16)}, newPC=0038, T=${this.tStates}`);
                    return 13;
                case 2:
                    this.push(this.pc);
                    const vector = (this.i << 8) | 0xff;
                    this.pc = this.readWord(vector);
                    this.memptr = this.pc;
                    if (this.debugInterrupts) console.log(`[INT] IM2: wasHalted=${wasHalted}, oldPC=${oldPC.toString(16)}, vector=${vector.toString(16)}, newPC=${this.pc.toString(16)}, T=${this.tStates}`);
                    return 19;
            }
            return 0;
        }
        
        nmi() {
            // Exit halt state - PC points to HALT, need to increment to next instruction
            if (this.halted) {
                this.halted = false;
                this.pc = (this.pc + 1) & 0xffff;
            }
            this.iff2 = this.iff1;
            this.iff1 = false;
            this.incR();
            this.push(this.pc);
            this.pc = 0x0066;
            this.memptr = this.pc;
            return 11;
        }
        
        // ALU Operations
        add8(val) {
            const a = this.a;
            const result = a + val;
            this.a = result & 0xff;
            this.f = (result & 0x100 ? this.FLAG_C : 0) |
                     ((a ^ val ^ result) & 0x10) |  // Half-carry
                     (((a ^ result) & (val ^ result) & 0x80) >> 5) |  // Overflow
                     this.sz53Table[this.a];
            this.q = this.f;
        }

        adc8(val) {
            const a = this.a;
            const carry = this.f & this.FLAG_C;
            const result = a + val + carry;
            this.a = result & 0xff;
            this.f = (result & 0x100 ? this.FLAG_C : 0) |
                     ((a ^ val ^ result) & 0x10) |  // Half-carry
                     (((a ^ result) & (val ^ result) & 0x80) >> 5) |  // Overflow
                     this.sz53Table[this.a];
            this.q = this.f;
        }

        sub8(val) {
            const a = this.a;
            const result = a - val;
            this.a = result & 0xff;
            this.f = (result & 0x100 ? this.FLAG_C : 0) |
                     this.FLAG_N |
                     ((a ^ val ^ result) & 0x10) |  // Half-carry
                     (((a ^ val) & (a ^ result) & 0x80) >> 5) |  // Overflow
                     this.sz53Table[this.a];
            this.q = this.f;
        }

        sbc8(val) {
            const a = this.a;
            const carry = this.f & this.FLAG_C;
            const result = a - val - carry;
            this.a = result & 0xff;
            this.f = (result & 0x100 ? this.FLAG_C : 0) |
                     this.FLAG_N |
                     ((a ^ val ^ result) & 0x10) |  // Half-carry
                     (((a ^ val) & (a ^ result) & 0x80) >> 5) |  // Overflow
                     this.sz53Table[this.a];
            this.q = this.f;
        }

        and8(val) {
            this.a &= val;
            this.f = this.FLAG_H | this.sz53pTable[this.a];
            this.q = this.f;
        }

        xor8(val) {
            this.a ^= val;
            this.f = this.sz53pTable[this.a];
            this.q = this.f;
        }

        or8(val) {
            this.a |= val;
            this.f = this.sz53pTable[this.a];
            this.q = this.f;
        }

        cp8(val) {
            const a = this.a;
            const result = a - val;
            this.f = (result & 0x100 ? this.FLAG_C : 0) |
                     this.FLAG_N |
                     ((a ^ val ^ result) & 0x10) |  // Half-carry
                     (((a ^ val) & (a ^ result) & 0x80) >> 5) |  // Overflow
                     (result & 0x80) |  // Sign from result
                     (result & 0xff ? 0 : this.FLAG_Z) |
                     (val & 0x28);  // Bits 5,3 from operand (not result)
            this.q = this.f;
        }

        inc8(val) {
            const result = (val + 1) & 0xff;
            this.f = (this.f & this.FLAG_C) |
                     (result === 0x80 ? this.FLAG_PV : 0) |
                     ((result & 0x0f) ? 0 : this.FLAG_H) |
                     this.sz53Table[result];
            this.q = this.f;
            return result;
        }

        dec8(val) {
            const result = (val - 1) & 0xff;
            this.f = (this.f & this.FLAG_C) |
                     (val === 0x80 ? this.FLAG_PV : 0) |
                     ((val & 0x0f) ? 0 : this.FLAG_H) |
                     this.FLAG_N |
                     this.sz53Table[result];
            this.q = this.f;
            return result;
        }

        add16(hl, val) {
            const result = hl + val;
            this.memptr = (hl + 1) & 0xffff;
            this.f = (this.f & (this.FLAG_PV | this.FLAG_Z | this.FLAG_S)) |
                     (result & 0x10000 ? this.FLAG_C : 0) |
                     ((result >> 8) & 0x28) |
                     (((hl ^ val ^ result) & 0x1000) >> 8);  // Half-carry at bit 11
            this.q = this.f;
            return result & 0xffff;
        }

        adc16(val) {
            const hl = this.hl;
            const carry = this.f & this.FLAG_C;
            const result = hl + val + carry;
            this.memptr = (hl + 1) & 0xffff;
            this.hl = result & 0xffff;
            this.f = (result & 0x10000 ? this.FLAG_C : 0) |
                     (((hl ^ result) & (val ^ result) & 0x8000) >> 13) |  // Overflow
                     ((result >> 8) & 0x28) |
                     (((hl ^ val ^ result) & 0x1000) >> 8) |  // Half-carry at bit 11
                     (this.hl ? 0 : this.FLAG_Z) |
                     ((result >> 8) & this.FLAG_S);
            this.q = this.f;
        }

        sbc16(val) {
            const hl = this.hl;
            const carry = this.f & this.FLAG_C;
            const result = hl - val - carry;
            this.memptr = (hl + 1) & 0xffff;
            this.hl = result & 0xffff;
            this.f = (result & 0x10000 ? this.FLAG_C : 0) |
                     this.FLAG_N |
                     (((hl ^ val) & (hl ^ result) & 0x8000) >> 13) |  // Overflow
                     ((result >> 8) & 0x28) |
                     (((hl ^ val ^ result) & 0x1000) >> 8) |  // Half-carry at bit 11
                     (this.hl ? 0 : this.FLAG_Z) |
                     ((result >> 8) & this.FLAG_S);
            this.q = this.f;
        }
        
        // Rotate/shift operations
        rlc(val) {
            const result = ((val << 1) | (val >> 7)) & 0xff;
            this.f = (val >> 7) | this.sz53pTable[result];
            this.q = this.f;
            return result;
        }

        rrc(val) {
            const result = ((val >> 1) | (val << 7)) & 0xff;
            this.f = (val & 0x01) | this.sz53pTable[result];
            this.q = this.f;
            return result;
        }

        rl(val) {
            const result = ((val << 1) | (this.f & this.FLAG_C)) & 0xff;
            this.f = (val >> 7) | this.sz53pTable[result];
            this.q = this.f;
            return result;
        }

        rr(val) {
            const result = ((val >> 1) | ((this.f & this.FLAG_C) << 7)) & 0xff;
            this.f = (val & 0x01) | this.sz53pTable[result];
            this.q = this.f;
            return result;
        }

        sla(val) {
            const result = (val << 1) & 0xff;
            this.f = (val >> 7) | this.sz53pTable[result];
            this.q = this.f;
            return result;
        }

        sra(val) {
            const result = ((val >> 1) | (val & 0x80)) & 0xff;
            this.f = (val & 0x01) | this.sz53pTable[result];
            this.q = this.f;
            return result;
        }

        // Undocumented SLL (shift left logical, bit 0 = 1)
        sll(val) {
            const result = ((val << 1) | 0x01) & 0xff;
            this.f = (val >> 7) | this.sz53pTable[result];
            this.q = this.f;
            return result;
        }

        srl(val) {
            const result = (val >> 1) & 0xff;
            this.f = (val & 0x01) | this.sz53pTable[result];
            this.q = this.f;
            return result;
        }

        // Bit operations
        bit(n, val) {
            const result = val & (1 << n);
            this.f = (this.f & this.FLAG_C) |
                     this.FLAG_H |
                     (result ? 0 : this.FLAG_Z | this.FLAG_PV) |
                     (result & this.FLAG_S) |
                     (val & 0x28);
            this.q = this.f;
        }

        bitMemptr(n, val) {
            const result = val & (1 << n);
            this.f = (this.f & this.FLAG_C) |
                     this.FLAG_H |
                     (result ? 0 : this.FLAG_Z | this.FLAG_PV) |
                     (result & this.FLAG_S) |
                     ((this.memptr >> 8) & 0x28);
            this.q = this.f;
        }
        
        // Execute single instruction
        execute() {
            this.incR();
            // Save Q from previous instruction for CCF/SCF, then reset
            this.lastQ = this.q;
            this.q = 0;

            if (this.eiPending) {
                this.eiPending = false;
                this.iff1 = this.iff2 = true;
            }

            const opcode = this.fetchByte();
            this.executeMain(opcode);
        }
        
        // Execute single instruction and return cycles consumed
        step() {
            const startTStates = this.tStates;
            this.execute();
            return this.tStates - startTStates;
        }
        
        // Main opcode execution
        executeMain(opcode) {
            // Cache flag constants for faster access
            const FLAG_C = 0x01, FLAG_N = 0x02, FLAG_PV = 0x04, FLAG_H = 0x10, FLAG_Z = 0x40, FLAG_S = 0x80;
            switch (opcode) {
                case 0x00: this.tStates += 4; break; // NOP
                case 0x01: this.bc = this.fetchWord(); this.tStates += 10; break; // LD BC,nn
                case 0x02: this.writeByte(this.bc, this.a); this.memptr = ((this.a << 8) | ((this.bc + 1) & 0xff)); this.tStates += 7; break; // LD (BC),A
                case 0x03: this.bc = (this.bc + 1) & 0xffff; this.tStates += 6; break; // INC BC
                case 0x04: this.b = this.inc8(this.b); this.tStates += 4; break; // INC B
                case 0x05: this.b = this.dec8(this.b); this.tStates += 4; break; // DEC B
                case 0x06: this.b = this.fetchByte(); this.tStates += 7; break; // LD B,n
                case 0x07: // RLCA
                    this.a = ((this.a << 1) | (this.a >> 7)) & 0xff;
                    this.f = (this.f & (FLAG_PV | FLAG_Z | FLAG_S)) | (this.a & (FLAG_C | 0x28));
                    this.q = this.f;
                    this.tStates += 4;
                    break;
                case 0x08: // EX AF,AF'
                    let tmp = this.a; this.a = this.a_; this.a_ = tmp;
                    tmp = this.f; this.f = this.f_; this.f_ = tmp;
                    this.tStates += 4;
                    break;
                case 0x09: this.hl = this.add16(this.hl, this.bc); this.tStates += 11; break; // ADD HL,BC
                case 0x0a: this.a = this.readByte(this.bc); this.memptr = (this.bc + 1) & 0xffff; this.tStates += 7; break; // LD A,(BC)
                case 0x0b: this.bc = (this.bc - 1) & 0xffff; this.tStates += 6; break; // DEC BC
                case 0x0c: this.c = this.inc8(this.c); this.tStates += 4; break; // INC C
                case 0x0d: this.c = this.dec8(this.c); this.tStates += 4; break; // DEC C
                case 0x0e: this.c = this.fetchByte(); this.tStates += 7; break; // LD C,n
                case 0x0f: // RRCA
                    this.f = (this.f & (FLAG_PV | FLAG_Z | FLAG_S)) | (this.a & FLAG_C);
                    this.a = ((this.a >> 1) | (this.a << 7)) & 0xff;
                    this.f |= (this.a & 0x28);
                    this.q = this.f;
                    this.tStates += 4;
                    break;
                case 0x10: // DJNZ d
                    this.b = (this.b - 1) & 0xff;
                    if (this.b) {
                        const d = this.fetchDisplacement();
                        this.memptr = this.pc = (this.pc + d) & 0xffff;
                        this.tStates += 13;
                    } else {
                        this.pc = (this.pc + 1) & 0xffff;
                        this.tStates += 8;
                    }
                    break;
                case 0x11: this.de = this.fetchWord(); this.tStates += 10; break; // LD DE,nn
                case 0x12: this.writeByte(this.de, this.a); this.memptr = ((this.a << 8) | ((this.de + 1) & 0xff)); this.tStates += 7; break; // LD (DE),A
                case 0x13: this.de = (this.de + 1) & 0xffff; this.tStates += 6; break; // INC DE
                case 0x14: this.d = this.inc8(this.d); this.tStates += 4; break; // INC D
                case 0x15: this.d = this.dec8(this.d); this.tStates += 4; break; // DEC D
                case 0x16: this.d = this.fetchByte(); this.tStates += 7; break; // LD D,n
                case 0x17: // RLA
                    {
                        const newCarry = this.a >> 7;
                        this.a = ((this.a << 1) | (this.f & FLAG_C)) & 0xff;
                        this.f = (this.f & (FLAG_PV | FLAG_Z | FLAG_S)) | newCarry | (this.a & 0x28);
                        this.q = this.f;
                    }
                    this.tStates += 4;
                    break;
                case 0x18: // JR d
                    {
                        const d = this.fetchDisplacement();
                        this.memptr = this.pc = (this.pc + d) & 0xffff;
                    }
                    this.tStates += 12;
                    break;
                case 0x19: this.hl = this.add16(this.hl, this.de); this.tStates += 11; break; // ADD HL,DE
                case 0x1a: this.a = this.readByte(this.de); this.memptr = (this.de + 1) & 0xffff; this.tStates += 7; break; // LD A,(DE)
                case 0x1b: this.de = (this.de - 1) & 0xffff; this.tStates += 6; break; // DEC DE
                case 0x1c: this.e = this.inc8(this.e); this.tStates += 4; break; // INC E
                case 0x1d: this.e = this.dec8(this.e); this.tStates += 4; break; // DEC E
                case 0x1e: this.e = this.fetchByte(); this.tStates += 7; break; // LD E,n
                case 0x1f: // RRA
                    {
                        const newCarry = this.a & 0x01;
                        this.a = ((this.a >> 1) | ((this.f & FLAG_C) << 7)) & 0xff;
                        this.f = (this.f & (FLAG_PV | FLAG_Z | FLAG_S)) | newCarry | (this.a & 0x28);
                        this.q = this.f;
                    }
                    this.tStates += 4;
                    break;
                case 0x20: // JR NZ,d
                    if (!(this.f & FLAG_Z)) {
                        const d = this.fetchDisplacement();
                        this.memptr = this.pc = (this.pc + d) & 0xffff;
                        this.tStates += 12;
                    } else {
                        this.pc = (this.pc + 1) & 0xffff;
                        this.tStates += 7;
                    }
                    break;
                case 0x21: this.hl = this.fetchWord(); this.tStates += 10; break; // LD HL,nn
                case 0x22: // LD (nn),HL
                    {
                        const addr = this.fetchWord();
                        this.writeWord(addr, this.hl);
                        this.memptr = (addr + 1) & 0xffff;
                    }
                    this.tStates += 16;
                    break;
                case 0x23: this.hl = (this.hl + 1) & 0xffff; this.tStates += 6; break; // INC HL
                case 0x24: this.h = this.inc8(this.h); this.tStates += 4; break; // INC H
                case 0x25: this.h = this.dec8(this.h); this.tStates += 4; break; // DEC H
                case 0x26: this.h = this.fetchByte(); this.tStates += 7; break; // LD H,n
                case 0x27: // DAA
                    {
                        let add = 0;
                        let carry = this.f & FLAG_C;
                        if ((this.f & FLAG_H) || ((this.a & 0x0f) > 9)) add = 6;
                        if (carry || (this.a > 0x99)) { add |= 0x60; carry = FLAG_C; }
                        if (this.f & FLAG_N) {
                            this.sub8(add);
                        } else {
                            this.add8(add);
                        }
                        this.f = (this.f & ~(FLAG_C | FLAG_PV)) | carry | this.parityTable[this.a];
                        this.q = this.f;
                    }
                    this.tStates += 4;
                    break;
                case 0x28: // JR Z,d
                    if (this.f & FLAG_Z) {
                        const d = this.fetchDisplacement();
                        this.memptr = this.pc = (this.pc + d) & 0xffff;
                        this.tStates += 12;
                    } else {
                        this.pc = (this.pc + 1) & 0xffff;
                        this.tStates += 7;
                    }
                    break;
                case 0x29: this.hl = this.add16(this.hl, this.hl); this.tStates += 11; break; // ADD HL,HL
                case 0x2a: // LD HL,(nn)
                    {
                        const addr = this.fetchWord();
                        this.hl = this.readWord(addr);
                        this.memptr = (addr + 1) & 0xffff;
                    }
                    this.tStates += 16;
                    break;
                case 0x2b: this.hl = (this.hl - 1) & 0xffff; this.tStates += 6; break; // DEC HL
                case 0x2c: this.l = this.inc8(this.l); this.tStates += 4; break; // INC L
                case 0x2d: this.l = this.dec8(this.l); this.tStates += 4; break; // DEC L
                case 0x2e: this.l = this.fetchByte(); this.tStates += 7; break; // LD L,n
                case 0x2f: // CPL
                    this.a ^= 0xff;
                    this.f = (this.f & (FLAG_C | FLAG_PV | FLAG_Z | FLAG_S)) | (this.a & 0x28) | FLAG_N | FLAG_H;
                    this.q = this.f;
                    this.tStates += 4;
                    break;
                case 0x30: // JR NC,d
                    if (!(this.f & FLAG_C)) {
                        const d = this.fetchDisplacement();
                        this.memptr = this.pc = (this.pc + d) & 0xffff;
                        this.tStates += 12;
                    } else {
                        this.pc = (this.pc + 1) & 0xffff;
                        this.tStates += 7;
                    }
                    break;
                case 0x31: this.sp = this.fetchWord(); this.tStates += 10; break; // LD SP,nn
                case 0x32: // LD (nn),A
                    {
                        const addr = this.fetchWord();
                        this.writeByte(addr, this.a);
                        this.memptr = ((this.a << 8) | ((addr + 1) & 0xff));
                    }
                    this.tStates += 13;
                    break;
                case 0x33: this.sp = (this.sp + 1) & 0xffff; this.tStates += 6; break; // INC SP
                case 0x34: this.writeByte(this.hl, this.inc8(this.readByte(this.hl))); this.tStates += 11; break; // INC (HL)
                case 0x35: this.writeByte(this.hl, this.dec8(this.readByte(this.hl))); this.tStates += 11; break; // DEC (HL)
                case 0x36: this.writeByte(this.hl, this.fetchByte()); this.tStates += 10; break; // LD (HL),n
                case 0x37: // SCF
                    this.f = (this.f & (FLAG_PV | FLAG_Z | FLAG_S)) |
                             (((this.lastQ ^ this.f) | this.a) & 0x28) |
                             FLAG_C;
                    this.q = this.f;
                    this.tStates += 4;
                    break;
                case 0x38: // JR C,d
                    if (this.f & FLAG_C) {
                        const d = this.fetchDisplacement();
                        this.memptr = this.pc = (this.pc + d) & 0xffff;
                        this.tStates += 12;
                    } else {
                        this.pc = (this.pc + 1) & 0xffff;
                        this.tStates += 7;
                    }
                    break;
                case 0x39: this.hl = this.add16(this.hl, this.sp); this.tStates += 11; break; // ADD HL,SP
                case 0x3a: // LD A,(nn)
                    {
                        const addr = this.fetchWord();
                        this.a = this.readByte(addr);
                        this.memptr = (addr + 1) & 0xffff;
                    }
                    this.tStates += 13;
                    break;
                case 0x3b: this.sp = (this.sp - 1) & 0xffff; this.tStates += 6; break; // DEC SP
                case 0x3c: this.a = this.inc8(this.a); this.tStates += 4; break; // INC A
                case 0x3d: this.a = this.dec8(this.a); this.tStates += 4; break; // DEC A
                case 0x3e: this.a = this.fetchByte(); this.tStates += 7; break; // LD A,n
                case 0x3f: // CCF
                    this.f = (this.f & (FLAG_PV | FLAG_Z | FLAG_S)) |
                             ((this.f & FLAG_C) ? FLAG_H : FLAG_C) |
                             (((this.lastQ ^ this.f) | this.a) & 0x28);
                    this.q = this.f;
                    this.tStates += 4;
                    break;
                
                // LD r,r' instructions 0x40-0x7f
                case 0x40: this.tStates += 4; break; // LD B,B
                case 0x41: this.b = this.c; this.tStates += 4; break;
                case 0x42: this.b = this.d; this.tStates += 4; break;
                case 0x43: this.b = this.e; this.tStates += 4; break;
                case 0x44: this.b = this.h; this.tStates += 4; break;
                case 0x45: this.b = this.l; this.tStates += 4; break;
                case 0x46: this.b = this.readByte(this.hl); this.tStates += 7; break;
                case 0x47: this.b = this.a; this.tStates += 4; break;
                case 0x48: this.c = this.b; this.tStates += 4; break;
                case 0x49: this.tStates += 4; break; // LD C,C
                case 0x4a: this.c = this.d; this.tStates += 4; break;
                case 0x4b: this.c = this.e; this.tStates += 4; break;
                case 0x4c: this.c = this.h; this.tStates += 4; break;
                case 0x4d: this.c = this.l; this.tStates += 4; break;
                case 0x4e: this.c = this.readByte(this.hl); this.tStates += 7; break;
                case 0x4f: this.c = this.a; this.tStates += 4; break;
                case 0x50: this.d = this.b; this.tStates += 4; break;
                case 0x51: this.d = this.c; this.tStates += 4; break;
                case 0x52: this.tStates += 4; break; // LD D,D
                case 0x53: this.d = this.e; this.tStates += 4; break;
                case 0x54: this.d = this.h; this.tStates += 4; break;
                case 0x55: this.d = this.l; this.tStates += 4; break;
                case 0x56: this.d = this.readByte(this.hl); this.tStates += 7; break;
                case 0x57: this.d = this.a; this.tStates += 4; break;
                case 0x58: this.e = this.b; this.tStates += 4; break;
                case 0x59: this.e = this.c; this.tStates += 4; break;
                case 0x5a: this.e = this.d; this.tStates += 4; break;
                case 0x5b: this.tStates += 4; break; // LD E,E
                case 0x5c: this.e = this.h; this.tStates += 4; break;
                case 0x5d: this.e = this.l; this.tStates += 4; break;
                case 0x5e: this.e = this.readByte(this.hl); this.tStates += 7; break;
                case 0x5f: this.e = this.a; this.tStates += 4; break;
                case 0x60: this.h = this.b; this.tStates += 4; break;
                case 0x61: this.h = this.c; this.tStates += 4; break;
                case 0x62: this.h = this.d; this.tStates += 4; break;
                case 0x63: this.h = this.e; this.tStates += 4; break;
                case 0x64: this.tStates += 4; break; // LD H,H
                case 0x65: this.h = this.l; this.tStates += 4; break;
                case 0x66: this.h = this.readByte(this.hl); this.tStates += 7; break;
                case 0x67: this.h = this.a; this.tStates += 4; break;
                case 0x68: this.l = this.b; this.tStates += 4; break;
                case 0x69: this.l = this.c; this.tStates += 4; break;
                case 0x6a: this.l = this.d; this.tStates += 4; break;
                case 0x6b: this.l = this.e; this.tStates += 4; break;
                case 0x6c: this.l = this.h; this.tStates += 4; break;
                case 0x6d: this.tStates += 4; break; // LD L,L
                case 0x6e: this.l = this.readByte(this.hl); this.tStates += 7; break;
                case 0x6f: this.l = this.a; this.tStates += 4; break;
                case 0x70: this.writeByte(this.hl, this.b); this.tStates += 7; break;
                case 0x71: this.writeByte(this.hl, this.c); this.tStates += 7; break;
                case 0x72: this.writeByte(this.hl, this.d); this.tStates += 7; break;
                case 0x73: this.writeByte(this.hl, this.e); this.tStates += 7; break;
                case 0x74: this.writeByte(this.hl, this.h); this.tStates += 7; break;
                case 0x75: this.writeByte(this.hl, this.l); this.tStates += 7; break;
                case 0x76: // HALT - PC points to HALT itself
                    if (this.debugInterrupts) console.log(`[HALT] at PC=${(this.pc-1).toString(16)}, IFF1=${this.iff1}, T=${this.tStates}`);
                    this.halted = true; this.pc = (this.pc - 1) & 0xffff; this.tStates += 4; break;
                case 0x77: this.writeByte(this.hl, this.a); this.tStates += 7; break;
                case 0x78: this.a = this.b; this.tStates += 4; break;
                case 0x79: this.a = this.c; this.tStates += 4; break;
                case 0x7a: this.a = this.d; this.tStates += 4; break;
                case 0x7b: this.a = this.e; this.tStates += 4; break;
                case 0x7c: this.a = this.h; this.tStates += 4; break;
                case 0x7d: this.a = this.l; this.tStates += 4; break;
                case 0x7e: this.a = this.readByte(this.hl); this.tStates += 7; break;
                case 0x7f: this.tStates += 4; break; // LD A,A
                
                // ALU operations 0x80-0xbf
                case 0x80: this.add8(this.b); this.tStates += 4; break;
                case 0x81: this.add8(this.c); this.tStates += 4; break;
                case 0x82: this.add8(this.d); this.tStates += 4; break;
                case 0x83: this.add8(this.e); this.tStates += 4; break;
                case 0x84: this.add8(this.h); this.tStates += 4; break;
                case 0x85: this.add8(this.l); this.tStates += 4; break;
                case 0x86: this.add8(this.readByte(this.hl)); this.tStates += 7; break;
                case 0x87: this.add8(this.a); this.tStates += 4; break;
                case 0x88: this.adc8(this.b); this.tStates += 4; break;
                case 0x89: this.adc8(this.c); this.tStates += 4; break;
                case 0x8a: this.adc8(this.d); this.tStates += 4; break;
                case 0x8b: this.adc8(this.e); this.tStates += 4; break;
                case 0x8c: this.adc8(this.h); this.tStates += 4; break;
                case 0x8d: this.adc8(this.l); this.tStates += 4; break;
                case 0x8e: this.adc8(this.readByte(this.hl)); this.tStates += 7; break;
                case 0x8f: this.adc8(this.a); this.tStates += 4; break;
                case 0x90: this.sub8(this.b); this.tStates += 4; break;
                case 0x91: this.sub8(this.c); this.tStates += 4; break;
                case 0x92: this.sub8(this.d); this.tStates += 4; break;
                case 0x93: this.sub8(this.e); this.tStates += 4; break;
                case 0x94: this.sub8(this.h); this.tStates += 4; break;
                case 0x95: this.sub8(this.l); this.tStates += 4; break;
                case 0x96: this.sub8(this.readByte(this.hl)); this.tStates += 7; break;
                case 0x97: this.sub8(this.a); this.tStates += 4; break;
                case 0x98: this.sbc8(this.b); this.tStates += 4; break;
                case 0x99: this.sbc8(this.c); this.tStates += 4; break;
                case 0x9a: this.sbc8(this.d); this.tStates += 4; break;
                case 0x9b: this.sbc8(this.e); this.tStates += 4; break;
                case 0x9c: this.sbc8(this.h); this.tStates += 4; break;
                case 0x9d: this.sbc8(this.l); this.tStates += 4; break;
                case 0x9e: this.sbc8(this.readByte(this.hl)); this.tStates += 7; break;
                case 0x9f: this.sbc8(this.a); this.tStates += 4; break;
                case 0xa0: this.and8(this.b); this.tStates += 4; break;
                case 0xa1: this.and8(this.c); this.tStates += 4; break;
                case 0xa2: this.and8(this.d); this.tStates += 4; break;
                case 0xa3: this.and8(this.e); this.tStates += 4; break;
                case 0xa4: this.and8(this.h); this.tStates += 4; break;
                case 0xa5: this.and8(this.l); this.tStates += 4; break;
                case 0xa6: this.and8(this.readByte(this.hl)); this.tStates += 7; break;
                case 0xa7: this.and8(this.a); this.tStates += 4; break;
                case 0xa8: this.xor8(this.b); this.tStates += 4; break;
                case 0xa9: this.xor8(this.c); this.tStates += 4; break;
                case 0xaa: this.xor8(this.d); this.tStates += 4; break;
                case 0xab: this.xor8(this.e); this.tStates += 4; break;
                case 0xac: this.xor8(this.h); this.tStates += 4; break;
                case 0xad: this.xor8(this.l); this.tStates += 4; break;
                case 0xae: this.xor8(this.readByte(this.hl)); this.tStates += 7; break;
                case 0xaf: this.xor8(this.a); this.tStates += 4; break;
                case 0xb0: this.or8(this.b); this.tStates += 4; break;
                case 0xb1: this.or8(this.c); this.tStates += 4; break;
                case 0xb2: this.or8(this.d); this.tStates += 4; break;
                case 0xb3: this.or8(this.e); this.tStates += 4; break;
                case 0xb4: this.or8(this.h); this.tStates += 4; break;
                case 0xb5: this.or8(this.l); this.tStates += 4; break;
                case 0xb6: this.or8(this.readByte(this.hl)); this.tStates += 7; break;
                case 0xb7: this.or8(this.a); this.tStates += 4; break;
                case 0xb8: this.cp8(this.b); this.tStates += 4; break;
                case 0xb9: this.cp8(this.c); this.tStates += 4; break;
                case 0xba: this.cp8(this.d); this.tStates += 4; break;
                case 0xbb: this.cp8(this.e); this.tStates += 4; break;
                case 0xbc: this.cp8(this.h); this.tStates += 4; break;
                case 0xbd: this.cp8(this.l); this.tStates += 4; break;
                case 0xbe: this.cp8(this.readByte(this.hl)); this.tStates += 7; break;
                case 0xbf: this.cp8(this.a); this.tStates += 4; break;
                
                // 0xc0-0xff
                case 0xc0: if (!(this.f & FLAG_Z)) { this.memptr = this.pc = this.pop(); this.tStates += 11; } else { this.tStates += 5; } break; // RET NZ
                case 0xc1: this.bc = this.pop(); this.tStates += 10; break; // POP BC
                case 0xc2: { const addr = this.fetchWord(); if (!(this.f & FLAG_Z)) { this.pc = addr; } this.memptr = addr; this.tStates += 10; } break; // JP NZ,nn
                case 0xc3: this.memptr = this.pc = this.fetchWord(); this.tStates += 10; break; // JP nn
                case 0xc4: { const addr = this.fetchWord(); if (!(this.f & FLAG_Z)) { this.push(this.pc); this.pc = addr; this.tStates += 17; } else { this.tStates += 10; } this.memptr = addr; } break; // CALL NZ,nn
                case 0xc5: this.push(this.bc); this.tStates += 11; break; // PUSH BC
                case 0xc6: this.add8(this.fetchByte()); this.tStates += 7; break; // ADD A,n
                case 0xc7: this.push(this.pc); this.memptr = this.pc = 0x00; this.tStates += 11; break; // RST 0
                case 0xc8: if (this.f & FLAG_Z) { this.memptr = this.pc = this.pop(); this.tStates += 11; } else { this.tStates += 5; } break; // RET Z
                case 0xc9: this.memptr = this.pc = this.pop(); this.tStates += 10; break; // RET
                case 0xca: { const addr = this.fetchWord(); if (this.f & FLAG_Z) { this.pc = addr; } this.memptr = addr; this.tStates += 10; } break; // JP Z,nn
                case 0xcb: this.executeCB(); break; // CB prefix
                case 0xcc: { const addr = this.fetchWord(); if (this.f & FLAG_Z) { this.push(this.pc); this.pc = addr; this.tStates += 17; } else { this.tStates += 10; } this.memptr = addr; } break; // CALL Z,nn
                case 0xcd: { const addr = this.fetchWord(); this.push(this.pc); this.memptr = this.pc = addr; this.tStates += 17; } break; // CALL nn
                case 0xce: this.adc8(this.fetchByte()); this.tStates += 7; break; // ADC A,n
                case 0xcf: this.push(this.pc); this.memptr = this.pc = 0x08; this.tStates += 11; break; // RST 8
                case 0xd0: if (!(this.f & FLAG_C)) { this.memptr = this.pc = this.pop(); this.tStates += 11; } else { this.tStates += 5; } break; // RET NC
                case 0xd1: this.de = this.pop(); this.tStates += 10; break; // POP DE
                case 0xd2: { const addr = this.fetchWord(); if (!(this.f & FLAG_C)) { this.pc = addr; } this.memptr = addr; this.tStates += 10; } break; // JP NC,nn
                case 0xd3: { const port = this.fetchByte(); this.outPort((this.a << 8) | port, this.a, 11); this.memptr = ((this.a << 8) | ((port + 1) & 0xff)); this.tStates += 11; } break; // OUT (n),A
                case 0xd4: { const addr = this.fetchWord(); if (!(this.f & FLAG_C)) { this.push(this.pc); this.pc = addr; this.tStates += 17; } else { this.tStates += 10; } this.memptr = addr; } break; // CALL NC,nn
                case 0xd5: this.push(this.de); this.tStates += 11; break; // PUSH DE
                case 0xd6: this.sub8(this.fetchByte()); this.tStates += 7; break; // SUB n
                case 0xd7: this.push(this.pc); this.memptr = this.pc = 0x10; this.tStates += 11; break; // RST 16
                case 0xd8: if (this.f & FLAG_C) { this.memptr = this.pc = this.pop(); this.tStates += 11; } else { this.tStates += 5; } break; // RET C
                case 0xd9: // EXX
                    {
                        let tmp = this.bc; this.bc = (this.b_ << 8) | this.c_; this.b_ = (tmp >> 8) & 0xff; this.c_ = tmp & 0xff;
                        tmp = this.de; this.de = (this.d_ << 8) | this.e_; this.d_ = (tmp >> 8) & 0xff; this.e_ = tmp & 0xff;
                        tmp = this.hl; this.hl = (this.h_ << 8) | this.l_; this.h_ = (tmp >> 8) & 0xff; this.l_ = tmp & 0xff;
                    }
                    this.tStates += 4;
                    break;
                case 0xda: { const addr = this.fetchWord(); if (this.f & FLAG_C) { this.pc = addr; } this.memptr = addr; this.tStates += 10; } break; // JP C,nn
                case 0xdb: { const port = this.fetchByte(); const portAddr = (this.a << 8) | port; this.a = this.inPort(portAddr); this.memptr = (portAddr + 1) & 0xffff; this.tStates += 11; } break; // IN A,(n)
                case 0xdc: { const addr = this.fetchWord(); if (this.f & FLAG_C) { this.push(this.pc); this.pc = addr; this.tStates += 17; } else { this.tStates += 10; } this.memptr = addr; } break; // CALL C,nn
                case 0xdd: this.executeDD(); break; // DD prefix (IX)
                case 0xde: this.sbc8(this.fetchByte()); this.tStates += 7; break; // SBC A,n
                case 0xdf: this.push(this.pc); this.memptr = this.pc = 0x18; this.tStates += 11; break; // RST 24
                case 0xe0: if (!(this.f & FLAG_PV)) { this.memptr = this.pc = this.pop(); this.tStates += 11; } else { this.tStates += 5; } break; // RET PO
                case 0xe1: this.hl = this.pop(); this.tStates += 10; break; // POP HL
                case 0xe2: { const addr = this.fetchWord(); if (!(this.f & FLAG_PV)) { this.pc = addr; } this.memptr = addr; this.tStates += 10; } break; // JP PO,nn
                case 0xe3: { const tmp = this.readWord(this.sp); this.writeWord(this.sp, this.hl); this.memptr = this.hl = tmp; this.tStates += 19; } break; // EX (SP),HL
                case 0xe4: { const addr = this.fetchWord(); if (!(this.f & FLAG_PV)) { this.push(this.pc); this.pc = addr; this.tStates += 17; } else { this.tStates += 10; } this.memptr = addr; } break; // CALL PO,nn
                case 0xe5: this.push(this.hl); this.tStates += 11; break; // PUSH HL
                case 0xe6: this.and8(this.fetchByte()); this.tStates += 7; break; // AND n
                case 0xe7: this.push(this.pc); this.memptr = this.pc = 0x20; this.tStates += 11; break; // RST 32
                case 0xe8: if (this.f & FLAG_PV) { this.memptr = this.pc = this.pop(); this.tStates += 11; } else { this.tStates += 5; } break; // RET PE
                case 0xe9: this.pc = this.hl; this.tStates += 4; break; // JP (HL)
                case 0xea: { const addr = this.fetchWord(); if (this.f & FLAG_PV) { this.pc = addr; } this.memptr = addr; this.tStates += 10; } break; // JP PE,nn
                case 0xeb: { const tmp = this.de; this.de = this.hl; this.hl = tmp; } this.tStates += 4; break; // EX DE,HL
                case 0xec: { const addr = this.fetchWord(); if (this.f & FLAG_PV) { this.push(this.pc); this.pc = addr; this.tStates += 17; } else { this.tStates += 10; } this.memptr = addr; } break; // CALL PE,nn
                case 0xed: this.executeED(); break; // ED prefix
                case 0xee: this.xor8(this.fetchByte()); this.tStates += 7; break; // XOR n
                case 0xef: this.push(this.pc); this.memptr = this.pc = 0x28; this.tStates += 11; break; // RST 40
                case 0xf0: if (!(this.f & FLAG_S)) { this.memptr = this.pc = this.pop(); this.tStates += 11; } else { this.tStates += 5; } break; // RET P
                case 0xf1: this.af = this.pop(); this.tStates += 10; break; // POP AF
                case 0xf2: { const addr = this.fetchWord(); if (!(this.f & FLAG_S)) { this.pc = addr; } this.memptr = addr; this.tStates += 10; } break; // JP P,nn
                case 0xf3: // DI
                    if (this.debugInterrupts) console.log(`[DI] at PC=${(this.pc-1).toString(16)}, T=${this.tStates}`);
                    this.iff1 = this.iff2 = false; this.tStates += 4; break;
                case 0xf4: { const addr = this.fetchWord(); if (!(this.f & FLAG_S)) { this.push(this.pc); this.pc = addr; this.tStates += 17; } else { this.tStates += 10; } this.memptr = addr; } break; // CALL P,nn
                case 0xf5: this.push(this.af); this.tStates += 11; break; // PUSH AF
                case 0xf6: this.or8(this.fetchByte()); this.tStates += 7; break; // OR n
                case 0xf7: this.push(this.pc); this.memptr = this.pc = 0x30; this.tStates += 11; break; // RST 48
                case 0xf8: if (this.f & FLAG_S) { this.memptr = this.pc = this.pop(); this.tStates += 11; } else { this.tStates += 5; } break; // RET M
                case 0xf9: this.sp = this.hl; this.tStates += 6; break; // LD SP,HL
                case 0xfa: { const addr = this.fetchWord(); if (this.f & FLAG_S) { this.pc = addr; } this.memptr = addr; this.tStates += 10; } break; // JP M,nn
                case 0xfb: // EI
                    if (this.debugInterrupts) console.log(`[EI] at PC=${(this.pc-1).toString(16)}, T=${this.tStates}`);
                    this.iff1 = this.iff2 = true; this.eiPending = true; this.tStates += 4; break;
                case 0xfc: { const addr = this.fetchWord(); if (this.f & FLAG_S) { this.push(this.pc); this.pc = addr; this.tStates += 17; } else { this.tStates += 10; } this.memptr = addr; } break; // CALL M,nn
                case 0xfd: this.executeFD(); break; // FD prefix (IY)
                case 0xfe: this.cp8(this.fetchByte()); this.tStates += 7; break; // CP n
                case 0xff: this.push(this.pc); this.memptr = this.pc = 0x38; this.tStates += 11; break; // RST 56
            }
        }
        
        // CB prefix - bit operations
        executeCB() {
            const FLAG_C = 0x01, FLAG_N = 0x02, FLAG_PV = 0x04, FLAG_H = 0x10, FLAG_Z = 0x40, FLAG_S = 0x80;
            this.incR();
            const opcode = this.fetchByte();
            const reg = opcode & 0x07;
            const op = opcode >> 3;
            
            let val;
            if (reg === 6) {
                val = this.readByte(this.hl);
                this.tStates += 4;
            } else {
                val = this.getRegister(reg);
            }
            
            let result;
            if (op < 8) {
                // Rotate/shift
                switch (op) {
                    case 0: result = this.rlc(val); break;
                    case 1: result = this.rrc(val); break;
                    case 2: result = this.rl(val); break;
                    case 3: result = this.rr(val); break;
                    case 4: result = this.sla(val); break;
                    case 5: result = this.sra(val); break;
                    case 6: result = this.sll(val); break; // Undocumented
                    case 7: result = this.srl(val); break;
                }
                if (reg === 6) {
                    this.writeByte(this.hl, result);
                    this.tStates += 11;
                } else {
                    this.setRegister(reg, result);
                    this.tStates += 8;
                }
            } else if (op < 16) {
                // BIT
                this.bit(op - 8, val);
                if (reg === 6) {
                    this.f = (this.f & ~0x28) | ((this.memptr >> 8) & 0x28);
                    this.q = this.f;
                    this.tStates += 8;
                } else {
                    this.tStates += 8;
                }
            } else if (op < 24) {
                // RES
                result = val & ~(1 << (op - 16));
                if (reg === 6) {
                    this.writeByte(this.hl, result);
                    this.tStates += 11;
                } else {
                    this.setRegister(reg, result);
                    this.tStates += 8;
                }
            } else {
                // SET
                result = val | (1 << (op - 24));
                if (reg === 6) {
                    this.writeByte(this.hl, result);
                    this.tStates += 11;
                } else {
                    this.setRegister(reg, result);
                    this.tStates += 8;
                }
            }
        }
        
        // DD prefix - IX operations
        executeDD() {
            this.incR();
            let opcode = this.fetchByte();

            // Handle chained prefixes: DD DD, DD FD, DD ED
            while (opcode === 0xdd || opcode === 0xfd || opcode === 0xed) {
                if (opcode === 0xdd) {
                    // Another DD prefix - current DD acts as 4T NOP
                    this.tStates += 4;
                    this.incR();
                    opcode = this.fetchByte();
                } else if (opcode === 0xfd) {
                    // FD overrides DD - DD acts as 4T NOP, switch to IY
                    this.tStates += 4;
                    return this.executeFD();
                } else if (opcode === 0xed) {
                    // ED overrides DD - DD acts as 4T NOP
                    this.tStates += 4;
                    return this.executeED();
                }
            }

            if (opcode === 0xcb) {
                this.executeDDCB();
                return;
            }

            // Handle IX-specific opcodes
            this.executeIndexed(opcode, 'ix');
        }

        // FD prefix - IY operations
        executeFD() {
            this.incR();
            let opcode = this.fetchByte();

            // Handle chained prefixes: FD FD, FD DD, FD ED
            while (opcode === 0xdd || opcode === 0xfd || opcode === 0xed) {
                if (opcode === 0xfd) {
                    // Another FD prefix - current FD acts as 4T NOP
                    this.tStates += 4;
                    this.incR();
                    opcode = this.fetchByte();
                } else if (opcode === 0xdd) {
                    // DD overrides FD - FD acts as 4T NOP, switch to IX
                    this.tStates += 4;
                    return this.executeDD();
                } else if (opcode === 0xed) {
                    // ED overrides FD - FD acts as 4T NOP
                    this.tStates += 4;
                    return this.executeED();
                }
            }

            if (opcode === 0xcb) {
                this.executeFDCB();
                return;
            }

            this.executeIndexed(opcode, 'iy');
        }
        
        // DD CB / FD CB prefix
        executeDDCB() {
            const d = this.fetchDisplacement();
            const opcode = this.fetchByte();
            const addr = (this.ix + d) & 0xffff;
            this.memptr = addr;
            
            this.executeIndexedCB(opcode, addr);
        }
        
        executeFDCB() {
            const d = this.fetchDisplacement();
            const opcode = this.fetchByte();
            const addr = (this.iy + d) & 0xffff;
            this.memptr = addr;
            
            this.executeIndexedCB(opcode, addr);
        }
        
        executeIndexedCB(opcode, addr) {
            const reg = opcode & 0x07;
            const op = opcode >> 3;
            
            let val = this.readByte(addr);
            let result;
            
            if (op < 8) {
                switch (op) {
                    case 0: result = this.rlc(val); break;
                    case 1: result = this.rrc(val); break;
                    case 2: result = this.rl(val); break;
                    case 3: result = this.rr(val); break;
                    case 4: result = this.sla(val); break;
                    case 5: result = this.sra(val); break;
                    case 6: result = this.sll(val); break;
                    case 7: result = this.srl(val); break;
                }
                this.writeByte(addr, result);
                if (reg !== 6) this.setRegister(reg, result);
                this.tStates += 23;
            } else if (op < 16) {
                this.bitMemptr(op - 8, val);
                this.tStates += 20;
            } else if (op < 24) {
                result = val & ~(1 << (op - 16));
                this.writeByte(addr, result);
                if (reg !== 6) this.setRegister(reg, result);
                this.tStates += 23;
            } else {
                result = val | (1 << (op - 24));
                this.writeByte(addr, result);
                if (reg !== 6) this.setRegister(reg, result);
                this.tStates += 23;
            }
        }
        
        // Indexed operations (IX/IY)
        executeIndexed(opcode, reg) {
            const FLAG_C = 0x01, FLAG_N = 0x02, FLAG_PV = 0x04, FLAG_H = 0x10, FLAG_Z = 0x40, FLAG_S = 0x80;
            const ir = reg === 'ix' ? this.ix : this.iy;
            const setIR = (v) => { if (reg === 'ix') this.ix = v; else this.iy = v; };
            const getH = () => reg === 'ix' ? this.ixh : this.iyh;
            const getL = () => reg === 'ix' ? this.ixl : this.iyl;
            const setH = (v) => { if (reg === 'ix') this.ixh = v; else this.iyh = v; };
            const setL = (v) => { if (reg === 'ix') this.ixl = v; else this.iyl = v; };
            
            switch (opcode) {
                case 0x09: setIR(this.add16(ir, this.bc)); this.tStates += 15; break;
                case 0x19: setIR(this.add16(ir, this.de)); this.tStates += 15; break;
                case 0x21: setIR(this.fetchWord()); this.tStates += 14; break;
                case 0x22: { const addr = this.fetchWord(); this.writeWord(addr, ir); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break;
                case 0x23: setIR((ir + 1) & 0xffff); this.tStates += 10; break;
                case 0x24: setH(this.inc8(getH())); this.tStates += 8; break;
                case 0x25: setH(this.dec8(getH())); this.tStates += 8; break;
                case 0x26: setH(this.fetchByte()); this.tStates += 11; break;
                case 0x29: setIR(this.add16(ir, ir)); this.tStates += 15; break;
                case 0x2a: { const addr = this.fetchWord(); setIR(this.readWord(addr)); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break;
                case 0x2b: setIR((ir - 1) & 0xffff); this.tStates += 10; break;
                case 0x2c: setL(this.inc8(getL())); this.tStates += 8; break;
                case 0x2d: setL(this.dec8(getL())); this.tStates += 8; break;
                case 0x2e: setL(this.fetchByte()); this.tStates += 11; break;
                case 0x34: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.inc8(this.readByte(addr))); this.tStates += 23; } break;
                case 0x35: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.dec8(this.readByte(addr))); this.tStates += 23; } break;
                case 0x36: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.fetchByte()); this.tStates += 19; } break;
                case 0x39: setIR(this.add16(ir, this.sp)); this.tStates += 15; break;
                
                // LD with (IX+d)/(IY+d)
                case 0x46: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.b = this.readByte(addr); this.tStates += 19; } break;
                case 0x4e: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.c = this.readByte(addr); this.tStates += 19; } break;
                case 0x56: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.d = this.readByte(addr); this.tStates += 19; } break;
                case 0x5e: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.e = this.readByte(addr); this.tStates += 19; } break;
                case 0x66: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.h = this.readByte(addr); this.tStates += 19; } break;
                case 0x6e: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.l = this.readByte(addr); this.tStates += 19; } break;
                case 0x7e: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.a = this.readByte(addr); this.tStates += 19; } break;
                
                case 0x70: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.b); this.tStates += 19; } break;
                case 0x71: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.c); this.tStates += 19; } break;
                case 0x72: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.d); this.tStates += 19; } break;
                case 0x73: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.e); this.tStates += 19; } break;
                case 0x74: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.h); this.tStates += 19; } break;
                case 0x75: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.l); this.tStates += 19; } break;
                case 0x77: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.writeByte(addr, this.a); this.tStates += 19; } break;
                
                // Undocumented: LD with IXH/IXL/IYH/IYL
                case 0x44: this.b = getH(); this.tStates += 8; break;
                case 0x45: this.b = getL(); this.tStates += 8; break;
                case 0x4c: this.c = getH(); this.tStates += 8; break;
                case 0x4d: this.c = getL(); this.tStates += 8; break;
                case 0x54: this.d = getH(); this.tStates += 8; break;
                case 0x55: this.d = getL(); this.tStates += 8; break;
                case 0x5c: this.e = getH(); this.tStates += 8; break;
                case 0x5d: this.e = getL(); this.tStates += 8; break;
                case 0x60: setH(this.b); this.tStates += 8; break;
                case 0x61: setH(this.c); this.tStates += 8; break;
                case 0x62: setH(this.d); this.tStates += 8; break;
                case 0x63: setH(this.e); this.tStates += 8; break;
                case 0x64: this.tStates += 8; break;
                case 0x65: setH(getL()); this.tStates += 8; break;
                case 0x67: setH(this.a); this.tStates += 8; break;
                case 0x68: setL(this.b); this.tStates += 8; break;
                case 0x69: setL(this.c); this.tStates += 8; break;
                case 0x6a: setL(this.d); this.tStates += 8; break;
                case 0x6b: setL(this.e); this.tStates += 8; break;
                case 0x6c: setL(getH()); this.tStates += 8; break;
                case 0x6d: this.tStates += 8; break;
                case 0x6f: setL(this.a); this.tStates += 8; break;
                case 0x7c: this.a = getH(); this.tStates += 8; break;
                case 0x7d: this.a = getL(); this.tStates += 8; break;
                
                // ALU with (IX+d)/(IY+d)
                case 0x86: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.add8(this.readByte(addr)); this.tStates += 19; } break;
                case 0x8e: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.adc8(this.readByte(addr)); this.tStates += 19; } break;
                case 0x96: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.sub8(this.readByte(addr)); this.tStates += 19; } break;
                case 0x9e: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.sbc8(this.readByte(addr)); this.tStates += 19; } break;
                case 0xa6: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.and8(this.readByte(addr)); this.tStates += 19; } break;
                case 0xae: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.xor8(this.readByte(addr)); this.tStates += 19; } break;
                case 0xb6: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.or8(this.readByte(addr)); this.tStates += 19; } break;
                case 0xbe: { const d = this.fetchDisplacement(); const addr = (ir + d) & 0xffff; this.memptr = addr; this.cp8(this.readByte(addr)); this.tStates += 19; } break;
                
                // Undocumented ALU with IXH/IXL/IYH/IYL
                case 0x84: this.add8(getH()); this.tStates += 8; break;
                case 0x85: this.add8(getL()); this.tStates += 8; break;
                case 0x8c: this.adc8(getH()); this.tStates += 8; break;
                case 0x8d: this.adc8(getL()); this.tStates += 8; break;
                case 0x94: this.sub8(getH()); this.tStates += 8; break;
                case 0x95: this.sub8(getL()); this.tStates += 8; break;
                case 0x9c: this.sbc8(getH()); this.tStates += 8; break;
                case 0x9d: this.sbc8(getL()); this.tStates += 8; break;
                case 0xa4: this.and8(getH()); this.tStates += 8; break;
                case 0xa5: this.and8(getL()); this.tStates += 8; break;
                case 0xac: this.xor8(getH()); this.tStates += 8; break;
                case 0xad: this.xor8(getL()); this.tStates += 8; break;
                case 0xb4: this.or8(getH()); this.tStates += 8; break;
                case 0xb5: this.or8(getL()); this.tStates += 8; break;
                case 0xbc: this.cp8(getH()); this.tStates += 8; break;
                case 0xbd: this.cp8(getL()); this.tStates += 8; break;
                
                case 0xe1: setIR(this.pop()); this.tStates += 14; break;
                case 0xe3: { const tmp = this.readWord(this.sp); this.writeWord(this.sp, ir); this.memptr = tmp; setIR(tmp); this.tStates += 23; } break;
                case 0xe5: this.push(ir); this.tStates += 15; break;
                case 0xe9: this.pc = ir; this.tStates += 8; break;
                case 0xf9: this.sp = ir; this.tStates += 10; break;
                
                default:
                    // Treat as NOP for unrecognized prefixed opcodes
                    // Add 4 T-states for the DD/FD prefix that was consumed
                    this.tStates += 4;
                    this.executeMain(opcode);
                    break;
            }
        }
        
        // ED prefix
        executeED() {
            const FLAG_C = 0x01, FLAG_N = 0x02, FLAG_PV = 0x04, FLAG_H = 0x10, FLAG_Z = 0x40, FLAG_S = 0x80;
            this.incR();
            const opcode = this.fetchByte();

            switch (opcode) {
                case 0x40: { const port = this.bc; this.b = this.inPort(port); this.f = (this.f & FLAG_C) | this.sz53pTable[this.b]; this.q = this.f; this.memptr = (port + 1) & 0xffff; this.tStates += 12; } break; // IN B,(C)
                case 0x41: this.outPort(this.bc, this.b); this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // OUT (C),B
                case 0x42: this.sbc16(this.bc); this.tStates += 15; break; // SBC HL,BC
                case 0x43: { const addr = this.fetchWord(); this.writeWord(addr, this.bc); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break; // LD (nn),BC
                case 0x44: case 0x4c: case 0x54: case 0x5c: case 0x64: case 0x6c: case 0x74: case 0x7c: // NEG
                    {
                        const tmp = this.a;
                        this.a = 0;
                        this.sub8(tmp);
                    }
                    this.tStates += 8;
                    break;
                case 0x45: case 0x4d: case 0x55: case 0x5d: case 0x65: case 0x6d: case 0x75: case 0x7d: // RETN/RETI
                    this.iff1 = this.iff2;
                    this.memptr = this.pc = this.pop();
                    this.tStates += 14;
                    break;
                case 0x46: case 0x4e: case 0x66: case 0x6e: this.im = 0; this.tStates += 8; break; // IM 0
                case 0x47: this.i = this.a; this.tStates += 9; break; // LD I,A
                case 0x48: { const port = this.bc; this.c = this.inPort(port); this.f = (this.f & FLAG_C) | this.sz53pTable[this.c]; this.q = this.f; this.memptr = (port + 1) & 0xffff; this.tStates += 12; } break; // IN C,(C)
                case 0x49: this.outPort(this.bc, this.c); this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // OUT (C),C
                case 0x4a: this.adc16(this.bc); this.tStates += 15; break; // ADC HL,BC
                case 0x4b: { const addr = this.fetchWord(); this.bc = this.readWord(addr); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break; // LD BC,(nn)
                case 0x4f: this.rFull = this.a; this.tStates += 9; break; // LD R,A
                case 0x50: this.d = this.inPort(this.bc); this.f = (this.f & FLAG_C) | this.sz53pTable[this.d]; this.q = this.f; this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // IN D,(C)
                case 0x51: this.outPort(this.bc, this.d); this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // OUT (C),D
                case 0x52: this.sbc16(this.de); this.tStates += 15; break; // SBC HL,DE
                case 0x53: { const addr = this.fetchWord(); this.writeWord(addr, this.de); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break; // LD (nn),DE
                case 0x56: case 0x76: this.im = 1; this.tStates += 8; break; // IM 1
                case 0x57: // LD A,I
                    this.a = this.i;
                    this.f = (this.f & FLAG_C) | this.sz53Table[this.a] | (this.iff2 ? FLAG_PV : 0);
                    this.q = this.f;
                    this.tStates += 9;
                    break;
                case 0x58: this.e = this.inPort(this.bc); this.f = (this.f & FLAG_C) | this.sz53pTable[this.e]; this.q = this.f; this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // IN E,(C)
                case 0x59: this.outPort(this.bc, this.e); this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // OUT (C),E
                case 0x5a: this.adc16(this.de); this.tStates += 15; break; // ADC HL,DE
                case 0x5b: { const addr = this.fetchWord(); this.de = this.readWord(addr); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break; // LD DE,(nn)
                case 0x5e: case 0x7e: this.im = 2; this.tStates += 8; break; // IM 2
                case 0x5f: // LD A,R
                    this.a = this.rFull;
                    this.f = (this.f & FLAG_C) | this.sz53Table[this.a] | (this.iff2 ? FLAG_PV : 0);
                    this.q = this.f;
                    this.tStates += 9;
                    break;
                case 0x60: this.h = this.inPort(this.bc); this.f = (this.f & FLAG_C) | this.sz53pTable[this.h]; this.q = this.f; this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // IN H,(C)
                case 0x61: this.outPort(this.bc, this.h); this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // OUT (C),H
                case 0x62: this.sbc16(this.hl); this.tStates += 15; break; // SBC HL,HL
                case 0x63: { const addr = this.fetchWord(); this.writeWord(addr, this.hl); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break; // LD (nn),HL
                case 0x67: // RRD
                    {
                        const tmp = this.readByte(this.hl);
                        this.writeByte(this.hl, ((this.a << 4) | (tmp >> 4)) & 0xff);
                        this.a = (this.a & 0xf0) | (tmp & 0x0f);
                        this.f = (this.f & FLAG_C) | this.sz53pTable[this.a];
                        this.q = this.f;
                        this.memptr = (this.hl + 1) & 0xffff;
                    }
                    this.tStates += 18;
                    break;
                case 0x68: this.l = this.inPort(this.bc); this.f = (this.f & FLAG_C) | this.sz53pTable[this.l]; this.q = this.f; this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // IN L,(C)
                case 0x69: this.outPort(this.bc, this.l); this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // OUT (C),L
                case 0x6a: this.adc16(this.hl); this.tStates += 15; break; // ADC HL,HL
                case 0x6b: { const addr = this.fetchWord(); this.hl = this.readWord(addr); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break; // LD HL,(nn)
                case 0x6f: // RLD
                    {
                        const tmp = this.readByte(this.hl);
                        this.writeByte(this.hl, ((tmp << 4) | (this.a & 0x0f)) & 0xff);
                        this.a = (this.a & 0xf0) | (tmp >> 4);
                        this.f = (this.f & FLAG_C) | this.sz53pTable[this.a];
                        this.q = this.f;
                        this.memptr = (this.hl + 1) & 0xffff;
                    }
                    this.tStates += 18;
                    break;
                case 0x70: { const tmp = this.inPort(this.bc); this.f = (this.f & FLAG_C) | this.sz53pTable[tmp]; this.q = this.f; this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; } break; // IN (C) / IN F,(C)
                case 0x71: this.outPort(this.bc, 0); this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // OUT (C),0
                case 0x72: this.sbc16(this.sp); this.tStates += 15; break; // SBC HL,SP
                case 0x73: { const addr = this.fetchWord(); this.writeWord(addr, this.sp); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break; // LD (nn),SP
                case 0x78: this.a = this.inPort(this.bc); this.f = (this.f & FLAG_C) | this.sz53pTable[this.a]; this.q = this.f; this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // IN A,(C)
                case 0x79: this.outPort(this.bc, this.a); this.memptr = (this.bc + 1) & 0xffff; this.tStates += 12; break; // OUT (C),A
                case 0x7a: this.adc16(this.sp); this.tStates += 15; break; // ADC HL,SP
                case 0x7b: { const addr = this.fetchWord(); this.sp = this.readWord(addr); this.memptr = (addr + 1) & 0xffff; this.tStates += 20; } break; // LD SP,(nn)
                
                // Block instructions
                case 0xa0: // LDI
                    {
                        const val = this.readByte(this.hl);
                        this.writeByte(this.de, val);
                        this.bc = (this.bc - 1) & 0xffff;
                        this.de = (this.de + 1) & 0xffff;
                        this.hl = (this.hl + 1) & 0xffff;
                        const n = (this.a + val) & 0xff;
                        this.f = (this.f & (FLAG_C | FLAG_Z | FLAG_S)) |
                                 (this.bc ? FLAG_PV : 0) |
                                 (n & 0x08) | ((n & 0x02) ? 0x20 : 0);
                        this.q = this.f;
                    }
                    this.tStates += 16;
                    break;
                case 0xa1: // CPI
                    {
                        const val = this.readByte(this.hl);
                        const result = (this.a - val) & 0xff;
                        const hf = (this.a ^ val ^ result) & 0x10;  // Half-carry
                        this.hl = (this.hl + 1) & 0xffff;
                        this.bc = (this.bc - 1) & 0xffff;
                        let n = result;
                        if (hf) n = (n - 1) & 0xff;
                        this.f = (this.f & FLAG_C) |
                                 (this.bc ? FLAG_PV : 0) |
                                 hf |
                                 FLAG_N |
                                 (result ? 0 : FLAG_Z) |
                                 (result & FLAG_S) |
                                 (n & 0x08) | ((n & 0x02) ? 0x20 : 0);
                        this.q = this.f;
                        this.memptr = (this.memptr + 1) & 0xffff;
                    }
                    this.tStates += 16;
                    break;
                case 0xa2: // INI
                    {
                        this.memptr = (this.bc + 1) & 0xffff;
                        const val = this.inPort(this.bc);
                        this.b = (this.b - 1) & 0xff;
                        this.writeByte(this.hl, val);
                        this.hl = (this.hl + 1) & 0xffff;
                        // Flags: N = bit 7 of input value
                        const k = (val + ((this.c + 1) & 0xff));
                        const kFlag = k > 255 ? (FLAG_H | FLAG_C) : 0;
                        this.f = kFlag |
                                 (val & 0x80 ? FLAG_N : 0) |
                                 this.parityTable[((k & 0x07) ^ this.b) & 0xff] |
                                 this.sz53Table[this.b];
                        this.q = this.f;
                    }
                    this.tStates += 16;
                    break;
                case 0xa3: // OUTI
                    {
                        const val = this.readByte(this.hl);
                        this.b = (this.b - 1) & 0xff;
                        this.memptr = (this.bc + 1) & 0xffff;
                        this.outPort(this.bc, val, 16);
                        this.hl = (this.hl + 1) & 0xffff;
                        // Flags: N = bit 7 of val, H/C from k > 255
                        const k = (val + this.l);
                        const kFlag = k > 255 ? (FLAG_H | FLAG_C) : 0;
                        this.f = kFlag |
                                 (val & 0x80 ? FLAG_N : 0) |
                                 this.parityTable[((k & 0x07) ^ this.b) & 0xff] |
                                 this.sz53Table[this.b];
                        this.q = this.f;
                    }
                    this.tStates += 16;
                    break;
                case 0xa8: // LDD
                    {
                        const val = this.readByte(this.hl);
                        this.writeByte(this.de, val);
                        this.bc = (this.bc - 1) & 0xffff;
                        this.de = (this.de - 1) & 0xffff;
                        this.hl = (this.hl - 1) & 0xffff;
                        const n = (this.a + val) & 0xff;
                        this.f = (this.f & (FLAG_C | FLAG_Z | FLAG_S)) |
                                 (this.bc ? FLAG_PV : 0) |
                                 (n & 0x08) | ((n & 0x02) ? 0x20 : 0);
                        this.q = this.f;
                    }
                    this.tStates += 16;
                    break;
                case 0xa9: // CPD
                    {
                        const val = this.readByte(this.hl);
                        const result = (this.a - val) & 0xff;
                        const hf = (this.a ^ val ^ result) & 0x10;  // Half-carry
                        this.hl = (this.hl - 1) & 0xffff;
                        this.bc = (this.bc - 1) & 0xffff;
                        let n = result;
                        if (hf) n = (n - 1) & 0xff;
                        this.f = (this.f & FLAG_C) |
                                 (this.bc ? FLAG_PV : 0) |
                                 hf |
                                 FLAG_N |
                                 (result ? 0 : FLAG_Z) |
                                 (result & FLAG_S) |
                                 (n & 0x08) | ((n & 0x02) ? 0x20 : 0);
                        this.q = this.f;
                        this.memptr = (this.memptr - 1) & 0xffff;
                    }
                    this.tStates += 16;
                    break;
                case 0xaa: // IND
                    {
                        this.memptr = (this.bc - 1) & 0xffff;
                        const val = this.inPort(this.bc);
                        this.b = (this.b - 1) & 0xff;
                        this.writeByte(this.hl, val);
                        this.hl = (this.hl - 1) & 0xffff;
                        // Flags: N = bit 7 of input value
                        const k = (val + ((this.c - 1) & 0xff));
                        const kFlag = k > 255 ? (FLAG_H | FLAG_C) : 0;
                        this.f = kFlag |
                                 (val & 0x80 ? FLAG_N : 0) |
                                 this.parityTable[((k & 0x07) ^ this.b) & 0xff] |
                                 this.sz53Table[this.b];
                        this.q = this.f;
                    }
                    this.tStates += 16;
                    break;
                case 0xab: // OUTD
                    {
                        const val = this.readByte(this.hl);
                        this.b = (this.b - 1) & 0xff;
                        this.memptr = (this.bc - 1) & 0xffff;
                        this.outPort(this.bc, val, 16);
                        this.hl = (this.hl - 1) & 0xffff;
                        // Flags: N = bit 7 of val, H/C from k > 255
                        const k = (val + this.l);
                        const kFlag = k > 255 ? (FLAG_H | FLAG_C) : 0;
                        this.f = kFlag |
                                 (val & 0x80 ? FLAG_N : 0) |
                                 this.parityTable[((k & 0x07) ^ this.b) & 0xff] |
                                 this.sz53Table[this.b];
                        this.q = this.f;
                    }
                    this.tStates += 16;
                    break;
                case 0xb0: // LDIR
                    {
                        const val = this.readByte(this.hl);
                        this.writeByte(this.de, val);
                        this.bc = (this.bc - 1) & 0xffff;
                        const n = (this.a + val) & 0xff;
                        if (this.bc) {
                            // When repeating: Y/X from PC high byte, P/V set
                            const pch = (this.pc >> 8) & 0xff;
                            this.f = (this.f & (FLAG_C | FLAG_Z | FLAG_S)) |
                                     FLAG_PV |
                                     (pch & 0x28);
                            this.q = this.f;
                            this.pc = (this.pc - 2) & 0xffff;
                            this.memptr = (this.pc + 1) & 0xffff;
                            this.tStates += 21;
                        } else {
                            // Normal completion: Y/X from (A + val)
                            this.f = (this.f & (FLAG_C | FLAG_Z | FLAG_S)) |
                                     (n & 0x08) | ((n & 0x02) ? 0x20 : 0);
                            this.q = this.f;
                            this.tStates += 16;
                        }
                        this.de = (this.de + 1) & 0xffff;
                        this.hl = (this.hl + 1) & 0xffff;
                    }
                    break;
                case 0xb1: // CPIR
                    {
                        const val = this.readByte(this.hl);
                        const result = (this.a - val) & 0xff;
                        const hf = (this.a ^ val ^ result) & 0x10;  // Half-carry
                        this.bc = (this.bc - 1) & 0xffff;
                        let n = result;
                        this.f = (this.f & FLAG_C) |
                                 (this.bc ? FLAG_PV : 0) |
                                 hf |
                                 FLAG_N |
                                 (result ? 0 : FLAG_Z) |
                                 (result & FLAG_S);
                        if (hf) n = (n - 1) & 0xff;
                        this.f |= (n & 0x08) | ((n & 0x02) ? 0x20 : 0);
                        if ((this.f & (FLAG_PV | FLAG_Z)) === FLAG_PV) {
                            // When repeating: Y/X from PC high byte
                            const pch = (this.pc >> 8) & 0xff;
                            this.f = (this.f & ~0x28) | (pch & 0x28);
                            this.q = this.f;
                            this.pc = (this.pc - 2) & 0xffff;
                            this.memptr = (this.pc + 1) & 0xffff;
                            this.tStates += 21;
                        } else {
                            this.q = this.f;
                            this.memptr = (this.memptr + 1) & 0xffff;
                            this.tStates += 16;
                        }
                        this.hl = (this.hl + 1) & 0xffff;
                    }
                    break;
                case 0xb2: // INIR
                    {
                        this.memptr = (this.bc + 1) & 0xffff;
                        const val = this.inPort(this.bc);
                        this.b = (this.b - 1) & 0xff;
                        this.writeByte(this.hl, val);
                        this.hl = (this.hl + 1) & 0xffff;
                        // Flags: N = bit 7 of input value
                        const k = (val + ((this.c + 1) & 0xff));
                        const kFlag = k > 255 ? (FLAG_H | FLAG_C) : 0;
                        this.f = kFlag |
                                 (val & 0x80 ? FLAG_N : 0) |
                                 this.parityTable[((k & 0x07) ^ this.b) & 0xff] |
                                 this.sz53Table[this.b];
                        if (this.b) {
                            // When repeating: additional PF/HF modifications + Y/X from PC
                            const pch = (this.pc >> 8) & 0xff;
                            let pf = this.f & FLAG_PV;
                            let hf = 0;
                            if (this.f & FLAG_C) {
                                if (val & 0x80) {
                                    pf ^= this.parityTable[(this.b - 1) & 0x07] ^ FLAG_PV;
                                    hf = ((this.b & 0x0f) === 0x00) ? FLAG_H : 0;
                                } else {
                                    pf ^= this.parityTable[(this.b + 1) & 0x07] ^ FLAG_PV;
                                    hf = ((this.b & 0x0f) === 0x0f) ? FLAG_H : 0;
                                }
                            } else {
                                pf ^= this.parityTable[this.b & 0x07] ^ FLAG_PV;
                            }
                            this.f = (this.f & (FLAG_C | FLAG_N | FLAG_Z | FLAG_S)) |
                                     pf | hf | (pch & 0x28);
                            this.q = this.f;
                            this.pc = (this.pc - 2) & 0xffff;
                            this.memptr = (this.pc + 1) & 0xffff;
                            this.tStates += 21;
                        } else {
                            this.q = this.f;
                            this.tStates += 16;
                        }
                    }
                    break;
                case 0xb3: // OTIR
                    {
                        const val = this.readByte(this.hl);
                        this.b = (this.b - 1) & 0xff;
                        this.memptr = (this.bc + 1) & 0xffff;
                        this.outPort(this.bc, val, 16);
                        this.hl = (this.hl + 1) & 0xffff;
                        // Flags: N = bit 7 of val, H/C from k > 255
                        const k = (val + this.l);
                        const kFlag = k > 255 ? (FLAG_H | FLAG_C) : 0;
                        this.f = kFlag |
                                 (val & 0x80 ? FLAG_N : 0) |
                                 this.parityTable[((k & 0x07) ^ this.b) & 0xff] |
                                 this.sz53Table[this.b];
                        if (this.b) {
                            // When repeating: additional PF/HF modifications + Y/X from PC
                            const pch = (this.pc >> 8) & 0xff;
                            let pf = this.f & FLAG_PV;
                            let hf = 0;
                            if (this.f & FLAG_C) {
                                if (val & 0x80) {
                                    pf ^= this.parityTable[(this.b - 1) & 0x07] ^ FLAG_PV;
                                    hf = ((this.b & 0x0f) === 0x00) ? FLAG_H : 0;
                                } else {
                                    pf ^= this.parityTable[(this.b + 1) & 0x07] ^ FLAG_PV;
                                    hf = ((this.b & 0x0f) === 0x0f) ? FLAG_H : 0;
                                }
                            } else {
                                pf ^= this.parityTable[this.b & 0x07] ^ FLAG_PV;
                            }
                            this.f = (this.f & (FLAG_C | FLAG_N | FLAG_Z | FLAG_S)) |
                                     pf | hf | (pch & 0x28);
                            this.q = this.f;
                            this.pc = (this.pc - 2) & 0xffff;
                            this.memptr = (this.pc + 1) & 0xffff;
                            this.tStates += 21;
                        } else {
                            this.q = this.f;
                            this.tStates += 16;
                        }
                    }
                    break;
                case 0xb8: // LDDR
                    {
                        const val = this.readByte(this.hl);
                        this.writeByte(this.de, val);
                        this.bc = (this.bc - 1) & 0xffff;
                        const n = (this.a + val) & 0xff;
                        if (this.bc) {
                            // When repeating: Y/X from PC high byte, P/V set
                            const pch = (this.pc >> 8) & 0xff;
                            this.f = (this.f & (FLAG_C | FLAG_Z | FLAG_S)) |
                                     FLAG_PV |
                                     (pch & 0x28);
                            this.q = this.f;
                            this.pc = (this.pc - 2) & 0xffff;
                            this.memptr = (this.pc + 1) & 0xffff;
                            this.tStates += 21;
                        } else {
                            // Normal completion: Y/X from (A + val)
                            this.f = (this.f & (FLAG_C | FLAG_Z | FLAG_S)) |
                                     (n & 0x08) | ((n & 0x02) ? 0x20 : 0);
                            this.q = this.f;
                            this.tStates += 16;
                        }
                        this.de = (this.de - 1) & 0xffff;
                        this.hl = (this.hl - 1) & 0xffff;
                    }
                    break;
                case 0xb9: // CPDR
                    {
                        const val = this.readByte(this.hl);
                        const result = (this.a - val) & 0xff;
                        const hf = (this.a ^ val ^ result) & 0x10;  // Half-carry
                        this.bc = (this.bc - 1) & 0xffff;
                        let n = result;
                        this.f = (this.f & FLAG_C) |
                                 (this.bc ? FLAG_PV : 0) |
                                 hf |
                                 FLAG_N |
                                 (result ? 0 : FLAG_Z) |
                                 (result & FLAG_S);
                        if (hf) n = (n - 1) & 0xff;
                        this.f |= (n & 0x08) | ((n & 0x02) ? 0x20 : 0);
                        if ((this.f & (FLAG_PV | FLAG_Z)) === FLAG_PV) {
                            // When repeating: Y/X from PC high byte
                            const pch = (this.pc >> 8) & 0xff;
                            this.f = (this.f & ~0x28) | (pch & 0x28);
                            this.q = this.f;
                            this.pc = (this.pc - 2) & 0xffff;
                            this.memptr = (this.pc + 1) & 0xffff;
                            this.tStates += 21;
                        } else {
                            this.q = this.f;
                            this.memptr = (this.memptr - 1) & 0xffff;
                            this.tStates += 16;
                        }
                        this.hl = (this.hl - 1) & 0xffff;
                    }
                    break;
                case 0xba: // INDR
                    {
                        this.memptr = (this.bc - 1) & 0xffff;
                        const val = this.inPort(this.bc);
                        this.b = (this.b - 1) & 0xff;
                        this.writeByte(this.hl, val);
                        this.hl = (this.hl - 1) & 0xffff;
                        // Flags: N = bit 7 of input value
                        const k = (val + ((this.c - 1) & 0xff));
                        const kFlag = k > 255 ? (FLAG_H | FLAG_C) : 0;
                        this.f = kFlag |
                                 (val & 0x80 ? FLAG_N : 0) |
                                 this.parityTable[((k & 0x07) ^ this.b) & 0xff] |
                                 this.sz53Table[this.b];
                        if (this.b) {
                            // When repeating: additional PF/HF modifications + Y/X from PC
                            const pch = (this.pc >> 8) & 0xff;
                            let pf = this.f & FLAG_PV;
                            let hf = 0;
                            if (this.f & FLAG_C) {
                                if (val & 0x80) {
                                    pf ^= this.parityTable[(this.b - 1) & 0x07] ^ FLAG_PV;
                                    hf = ((this.b & 0x0f) === 0x00) ? FLAG_H : 0;
                                } else {
                                    pf ^= this.parityTable[(this.b + 1) & 0x07] ^ FLAG_PV;
                                    hf = ((this.b & 0x0f) === 0x0f) ? FLAG_H : 0;
                                }
                            } else {
                                pf ^= this.parityTable[this.b & 0x07] ^ FLAG_PV;
                            }
                            this.f = (this.f & (FLAG_C | FLAG_N | FLAG_Z | FLAG_S)) |
                                     pf | hf | (pch & 0x28);
                            this.q = this.f;
                            this.pc = (this.pc - 2) & 0xffff;
                            this.memptr = (this.pc + 1) & 0xffff;
                            this.tStates += 21;
                        } else {
                            this.q = this.f;
                            this.tStates += 16;
                        }
                    }
                    break;
                case 0xbb: // OTDR
                    {
                        const val = this.readByte(this.hl);
                        this.b = (this.b - 1) & 0xff;
                        this.memptr = (this.bc - 1) & 0xffff;
                        this.outPort(this.bc, val, 16);
                        this.hl = (this.hl - 1) & 0xffff;
                        // Flags: N = bit 7 of val, H/C from k > 255
                        const k = (val + this.l);
                        const kFlag = k > 255 ? (FLAG_H | FLAG_C) : 0;
                        this.f = kFlag |
                                 (val & 0x80 ? FLAG_N : 0) |
                                 this.parityTable[((k & 0x07) ^ this.b) & 0xff] |
                                 this.sz53Table[this.b];
                        if (this.b) {
                            // When repeating: additional PF/HF modifications + Y/X from PC
                            const pch = (this.pc >> 8) & 0xff;
                            let pf = this.f & FLAG_PV;
                            let hf = 0;
                            if (this.f & FLAG_C) {
                                if (val & 0x80) {
                                    pf ^= this.parityTable[(this.b - 1) & 0x07] ^ FLAG_PV;
                                    hf = ((this.b & 0x0f) === 0x00) ? FLAG_H : 0;
                                } else {
                                    pf ^= this.parityTable[(this.b + 1) & 0x07] ^ FLAG_PV;
                                    hf = ((this.b & 0x0f) === 0x0f) ? FLAG_H : 0;
                                }
                            } else {
                                pf ^= this.parityTable[this.b & 0x07] ^ FLAG_PV;
                            }
                            this.f = (this.f & (FLAG_C | FLAG_N | FLAG_Z | FLAG_S)) |
                                     pf | hf | (pch & 0x28);
                            this.q = this.f;
                            this.pc = (this.pc - 2) & 0xffff;
                            this.memptr = (this.pc + 1) & 0xffff;
                            this.tStates += 21;
                        } else {
                            this.q = this.f;
                            this.tStates += 16;
                        }
                    }
                    break;
                
                default:
                    // NOP for undefined ED opcodes
                    this.tStates += 8;
                    break;
            }
        }
        
        // Helper to get register by index
        getRegister(idx) {
            switch (idx) {
                case 0: return this.b;
                case 1: return this.c;
                case 2: return this.d;
                case 3: return this.e;
                case 4: return this.h;
                case 5: return this.l;
                case 6: return this.readByte(this.hl);
                case 7: return this.a;
            }
        }
        
        // Helper to set register by index
        setRegister(idx, val) {
            switch (idx) {
                case 0: this.b = val; break;
                case 1: this.c = val; break;
                case 2: this.d = val; break;
                case 3: this.e = val; break;
                case 4: this.h = val; break;
                case 5: this.l = val; break;
                case 6: this.writeByte(this.hl, val); break;
                case 7: this.a = val; break;
            }
        }
        
        // Run for specified number of t-states
        run(targetTStates) {
            const startTStates = this.tStates;
            while (this.tStates - startTStates < targetTStates) {
                if (this.halted) {
                    // During HALT, CPU reads from PC+1 (next instruction after HALT) but discards data
                    // PC points to HALT itself, but bus reads happen from next address
                    this.readByte((this.pc + 1) & 0xffff);
                    this.tStates += 4;
                    this.incR();
                } else {
                    this.execute();
                }
            }
            return this.tStates - startTStates;
        }
    }

    // Export for both browser and Node.js
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Z80;
    }
    if (typeof global !== 'undefined') {
        global.Z80 = Z80;
    }
    if (typeof window !== 'undefined') {
        window.Z80 = Z80;
    }

})(typeof window !== 'undefined' ? window : global);
