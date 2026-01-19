/**
 * ZX-M8XXX - Z80 Disassembler
 * @version 0.9.1
 * @license GPL-3.0
 */

(function(global) {
    'use strict';

    const VERSION = '0.9.1';

    const r = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
    const rp = ['BC', 'DE', 'HL', 'SP'];
    const rp2 = ['BC', 'DE', 'HL', 'AF'];
    const cc = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
    const alu = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '];
    const rot = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'];

    class Disassembler {
        static get VERSION() { return VERSION; }
        
        constructor(memory) {
            this.memory = memory;
        }
        
        read(addr) {
            return this.memory.read(addr & 0xffff);
        }
        
        hex8(val) {
            return (val & 0xff).toString(16).toUpperCase().padStart(2, '0') + 'h';
        }
        
        hex16(val) {
            return (val & 0xffff).toString(16).toUpperCase().padStart(4, '0') + 'h';
        }
        
        signedByte(val) {
            val = val & 0xff;
            if (val >= 128) val -= 256;
            return val;
        }
        
        displacement(val, pc) {
            const signed = this.signedByte(val);
            const target = (pc + signed) & 0xffff;
            return this.hex16(target);
        }
        
        disassemble(addr, extractRefs = false) {
            const startAddr = addr;
            let opcode = this.read(addr++);
            let mnemonic = '';
            let bytes = [opcode];
            let refs = extractRefs ? [] : null;

            // Handle DD/FD prefixes
            // If followed by another prefix (DD, FD, ED), treat current as redundant NOP
            if (opcode === 0xDD || opcode === 0xFD) {
                const nextByte = this.read(addr);

                // Check if next byte is another prefix - if so, current is redundant
                if (nextByte === 0xDD || nextByte === 0xFD || nextByte === 0xED) {
                    // Redundant prefix - show as DEFB with actual byte value
                    return {
                        addr: startAddr,
                        bytes: bytes,
                        mnemonic: 'DEFB ' + this.hex8(opcode),
                        length: 1
                    };
                }

                // Not redundant - process as indexed instruction
                const indexReg = (opcode === 0xDD) ? 'IX' : 'IY';
                opcode = this.read(addr++);
                bytes.push(opcode);

                if (opcode === 0xCB) {
                    // DD CB or FD CB - indexed bit operations
                    const d = this.read(addr++);
                    const op = this.read(addr++);
                    bytes.push(d, op);
                    mnemonic = this.disasmIndexedCB(indexReg, d, op);
                } else {
                    // DD/FD prefixed instruction
                    const result = this.disasmIndexedOpcode(addr, indexReg, opcode, refs);
                    mnemonic = result.mnemonic;
                    bytes = bytes.concat(result.bytes);
                    addr = result.nextAddr;
                    if (result.refs) refs = result.refs;
                }
            } else if (opcode === 0xCB) {
                // Plain CB prefix
                bytes.push(this.read(addr));
                mnemonic = this.disasmCB(this.read(addr++));
            } else if (opcode === 0xED) {
                // ED prefix
                const nextByte = this.read(addr);

                // Check if next byte is another prefix - if so, current ED is redundant
                // CB is also invalid after ED (no ED CB instructions exist)
                if (nextByte === 0xDD || nextByte === 0xFD || nextByte === 0xED || nextByte === 0xCB) {
                    // Redundant prefix - show as DEFB with actual byte value
                    return {
                        addr: startAddr,
                        bytes: bytes,
                        mnemonic: 'DEFB ' + this.hex8(opcode),
                        length: 1
                    };
                }

                const result = this.disasmED(addr, refs);
                mnemonic = result.mnemonic;
                bytes = bytes.concat(result.bytes);
                addr = result.nextAddr;
                if (result.refs) refs = result.refs;
            } else {
                // Main instruction (no prefix)
                const result = this.disasmMain(opcode, addr, refs);
                mnemonic = result.mnemonic;
                bytes = bytes.concat(result.bytes);
                addr = result.nextAddr;
                if (result.refs) refs = result.refs;
            }

            const out = {
                addr: startAddr,
                bytes: bytes,
                mnemonic: mnemonic,
                length: addr - startAddr
            };
            if (refs && refs.length > 0) out.refs = refs;
            return out;
        }

        // Disassemble indexed CB instruction (DD CB d op or FD CB d op)
        disasmIndexedCB(ir, d, op) {
            const signed = this.signedByte(d);
            const disp = signed >= 0 ? '+' + signed : signed.toString();

            const x = (op >> 6) & 3;
            const y = (op >> 3) & 7;
            const z = op & 7;

            const target = '(' + ir + disp + ')';
            const rot = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'];
            const r = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];

            if (x === 0) {
                if (z === 6) {
                    return rot[y] + ' ' + target;
                } else {
                    return rot[y] + ' ' + target + ',' + r[z];
                }
            } else if (x === 1) {
                return 'BIT ' + y + ',' + target;
            } else if (x === 2) {
                if (z === 6) {
                    return 'RES ' + y + ',' + target;
                } else {
                    return 'RES ' + y + ',' + target + ',' + r[z];
                }
            } else {
                if (z === 6) {
                    return 'SET ' + y + ',' + target;
                } else {
                    return 'SET ' + y + ',' + target + ',' + r[z];
                }
            }
        }

        // Disassemble indexed instruction with opcode already fetched
        disasmIndexedOpcode(addr, ir, opcode, refs = null) {
            let mnemonic = '';
            let bytes = [];

            const x = (opcode >> 6) & 3;
            const y = (opcode >> 3) & 7;
            const z = opcode & 7;
            const p = (y >> 1) & 3;
            const q = y & 1;

            // Map (HL) to (IX+d)/(IY+d) and H/L to IXH/IXL/IYH/IYL
            const irh = ir + 'H';
            const irl = ir + 'L';
            const r = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
            const rp = ['BC', 'DE', 'HL', 'SP'];

            const ri = (idx) => {
                if (idx === 4) return irh;
                if (idx === 5) return irl;
                if (idx === 6) {
                    const d = this.read(addr++);
                    bytes.push(d);
                    const signed = this.signedByte(d);
                    const disp = signed >= 0 ? '+' + signed : signed.toString();
                    return '(' + ir + disp + ')';
                }
                return r[idx];
            };

            if (x === 0) {
                if (z === 1 && q === 0 && p === 2) {
                    const lo = this.read(addr++);
                    const hi = this.read(addr++);
                    bytes.push(lo, hi);
                    const target = (hi << 8) | lo;
                    mnemonic = 'LD ' + ir + ',' + this.hex16(target);
                    if (refs) refs.push({ type: 'ld_imm', target });
                } else if (z === 1 && q === 1) {
                    mnemonic = 'ADD ' + ir + ',' + (p === 2 ? ir : rp[p]);
                } else if (z === 2 && y === 4) {
                    const lo = this.read(addr++);
                    const hi = this.read(addr++);
                    bytes.push(lo, hi);
                    const target = (hi << 8) | lo;
                    mnemonic = 'LD (' + this.hex16(target) + '),' + ir;
                    if (refs) refs.push({ type: 'ld_ind', target });
                } else if (z === 2 && y === 5) {
                    const lo = this.read(addr++);
                    const hi = this.read(addr++);
                    bytes.push(lo, hi);
                    const target = (hi << 8) | lo;
                    mnemonic = 'LD ' + ir + ',(' + this.hex16(target) + ')';
                    if (refs) refs.push({ type: 'ld_ind', target });
                } else if (z === 3 && p === 2) {
                    mnemonic = (q === 0 ? 'INC ' : 'DEC ') + ir;
                } else if (z === 4 && (y === 4 || y === 5 || y === 6)) {
                    mnemonic = 'INC ' + ri(y);
                } else if (z === 5 && (y === 4 || y === 5 || y === 6)) {
                    mnemonic = 'DEC ' + ri(y);
                } else if (z === 6 && (y === 4 || y === 5 || y === 6)) {
                    const dest = ri(y);
                    const n = this.read(addr++);
                    bytes.push(n);
                    mnemonic = 'LD ' + dest + ',' + this.hex8(n);
                } else {
                    mnemonic = 'NOP';  // Unrecognized - treat as NOP
                }
            } else if (x === 1) {
                if (z === 6 && y === 6) {
                    mnemonic = 'HALT';
                } else if (y === 6 || z === 6) {
                    mnemonic = 'LD ' + ri(y) + ',' + ri(z);
                } else if (y === 4 || y === 5 || z === 4 || z === 5) {
                    mnemonic = 'LD ' + ri(y) + ',' + ri(z);
                } else {
                    mnemonic = 'LD ' + r[y] + ',' + r[z];
                }
            } else if (x === 2) {
                const alu = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '];
                if (z === 6 || z === 4 || z === 5) {
                    mnemonic = alu[y] + ri(z);
                } else {
                    mnemonic = alu[y] + r[z];
                }
            } else if (x === 3) {
                if (opcode === 0xE1) {
                    mnemonic = 'POP ' + ir;
                } else if (opcode === 0xE3) {
                    mnemonic = 'EX (SP),' + ir;
                } else if (opcode === 0xE5) {
                    mnemonic = 'PUSH ' + ir;
                } else if (opcode === 0xE9) {
                    mnemonic = 'JP (' + ir + ')';
                } else if (opcode === 0xF9) {
                    mnemonic = 'LD SP,' + ir;
                } else {
                    mnemonic = 'NOP';  // Unrecognized
                }
            }

            if (!mnemonic) mnemonic = 'NOP';

            return { mnemonic, bytes, nextAddr: addr, refs };
        }
        
        disasmMain(opcode, addr, refs = null) {
            let mnemonic = '';
            let bytes = [];
            const startAddr = addr;

            const x = (opcode >> 6) & 3;
            const y = (opcode >> 3) & 7;
            const z = opcode & 7;
            const p = (y >> 1) & 3;
            const q = y & 1;

            if (x === 0) {
                if (z === 0) {
                    if (y === 0) mnemonic = 'NOP';
                    else if (y === 1) mnemonic = "EX AF,AF'";
                    else if (y === 2) {
                        const d = this.read(addr++);
                        bytes.push(d);
                        const target = (addr + this.signedByte(d)) & 0xffff;
                        mnemonic = 'DJNZ ' + this.hex16(target);
                        if (refs) refs.push({ type: 'djnz', target });
                    } else if (y === 3) {
                        const d = this.read(addr++);
                        bytes.push(d);
                        const target = (addr + this.signedByte(d)) & 0xffff;
                        mnemonic = 'JR ' + this.hex16(target);
                        if (refs) refs.push({ type: 'jr', target });
                    } else {
                        const d = this.read(addr++);
                        bytes.push(d);
                        const target = (addr + this.signedByte(d)) & 0xffff;
                        mnemonic = 'JR ' + cc[y - 4] + ',' + this.hex16(target);
                        if (refs) refs.push({ type: 'jr', target });
                    }
                } else if (z === 1) {
                    if (q === 0) {
                        const lo = this.read(addr++);
                        const hi = this.read(addr++);
                        bytes.push(lo, hi);
                        const target = (hi << 8) | lo;
                        mnemonic = 'LD ' + rp[p] + ',' + this.hex16(target);
                        if (refs) refs.push({ type: 'ld_imm', target });
                    } else {
                        mnemonic = 'ADD HL,' + rp[p];
                    }
                } else if (z === 2) {
                    if (q === 0) {
                        if (p === 0) mnemonic = 'LD (BC),A';
                        else if (p === 1) mnemonic = 'LD (DE),A';
                        else if (p === 2) {
                            const lo = this.read(addr++);
                            const hi = this.read(addr++);
                            bytes.push(lo, hi);
                            const target = (hi << 8) | lo;
                            mnemonic = 'LD (' + this.hex16(target) + '),HL';
                            if (refs) refs.push({ type: 'ld_ind', target });
                        } else {
                            const lo = this.read(addr++);
                            const hi = this.read(addr++);
                            bytes.push(lo, hi);
                            const target = (hi << 8) | lo;
                            mnemonic = 'LD (' + this.hex16(target) + '),A';
                            if (refs) refs.push({ type: 'ld_ind', target });
                        }
                    } else {
                        if (p === 0) mnemonic = 'LD A,(BC)';
                        else if (p === 1) mnemonic = 'LD A,(DE)';
                        else if (p === 2) {
                            const lo = this.read(addr++);
                            const hi = this.read(addr++);
                            bytes.push(lo, hi);
                            const target = (hi << 8) | lo;
                            mnemonic = 'LD HL,(' + this.hex16(target) + ')';
                            if (refs) refs.push({ type: 'ld_ind', target });
                        } else {
                            const lo = this.read(addr++);
                            const hi = this.read(addr++);
                            bytes.push(lo, hi);
                            const target = (hi << 8) | lo;
                            mnemonic = 'LD A,(' + this.hex16(target) + ')';
                            if (refs) refs.push({ type: 'ld_ind', target });
                        }
                    }
                } else if (z === 3) {
                    mnemonic = (q === 0 ? 'INC ' : 'DEC ') + rp[p];
                } else if (z === 4) {
                    mnemonic = 'INC ' + r[y];
                } else if (z === 5) {
                    mnemonic = 'DEC ' + r[y];
                } else if (z === 6) {
                    const n = this.read(addr++);
                    bytes.push(n);
                    mnemonic = 'LD ' + r[y] + ',' + this.hex8(n);
                } else if (z === 7) {
                    const ops = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'];
                    mnemonic = ops[y];
                }
            } else if (x === 1) {
                if (z === 6 && y === 6) {
                    mnemonic = 'HALT';
                } else {
                    mnemonic = 'LD ' + r[y] + ',' + r[z];
                }
            } else if (x === 2) {
                mnemonic = alu[y] + r[z];
            } else if (x === 3) {
                if (z === 0) {
                    mnemonic = 'RET ' + cc[y];
                } else if (z === 1) {
                    if (q === 0) {
                        mnemonic = 'POP ' + rp2[p];
                    } else {
                        if (p === 0) mnemonic = 'RET';
                        else if (p === 1) mnemonic = 'EXX';
                        else if (p === 2) mnemonic = 'JP (HL)';
                        else mnemonic = 'LD SP,HL';
                    }
                } else if (z === 2) {
                    const lo = this.read(addr++);
                    const hi = this.read(addr++);
                    bytes.push(lo, hi);
                    const target = (hi << 8) | lo;
                    mnemonic = 'JP ' + cc[y] + ',' + this.hex16(target);
                    if (refs) refs.push({ type: 'jp', target });
                } else if (z === 3) {
                    if (y === 0) {
                        const lo = this.read(addr++);
                        const hi = this.read(addr++);
                        bytes.push(lo, hi);
                        const target = (hi << 8) | lo;
                        mnemonic = 'JP ' + this.hex16(target);
                        if (refs) refs.push({ type: 'jp', target });
                    } else if (y === 1) {
                        // CB prefix handled elsewhere
                        mnemonic = '???';
                    } else if (y === 2) {
                        const n = this.read(addr++);
                        bytes.push(n);
                        mnemonic = 'OUT (' + this.hex8(n) + '),A';
                    } else if (y === 3) {
                        const n = this.read(addr++);
                        bytes.push(n);
                        mnemonic = 'IN A,(' + this.hex8(n) + ')';
                    } else if (y === 4) {
                        mnemonic = 'EX (SP),HL';
                    } else if (y === 5) {
                        mnemonic = 'EX DE,HL';
                    } else if (y === 6) {
                        mnemonic = 'DI';
                    } else {
                        mnemonic = 'EI';
                    }
                } else if (z === 4) {
                    const lo = this.read(addr++);
                    const hi = this.read(addr++);
                    bytes.push(lo, hi);
                    const target = (hi << 8) | lo;
                    mnemonic = 'CALL ' + cc[y] + ',' + this.hex16(target);
                    if (refs) refs.push({ type: 'call', target });
                } else if (z === 5) {
                    if (q === 0) {
                        mnemonic = 'PUSH ' + rp2[p];
                    } else {
                        if (p === 0) {
                            const lo = this.read(addr++);
                            const hi = this.read(addr++);
                            bytes.push(lo, hi);
                            const target = (hi << 8) | lo;
                            mnemonic = 'CALL ' + this.hex16(target);
                            if (refs) refs.push({ type: 'call', target });
                        } else {
                            mnemonic = '???'; // DD, ED, FD prefixes handled elsewhere
                        }
                    }
                } else if (z === 6) {
                    const n = this.read(addr++);
                    bytes.push(n);
                    mnemonic = alu[y] + this.hex8(n);
                } else if (z === 7) {
                    const target = y * 8;
                    mnemonic = 'RST ' + this.hex8(target);
                    if (refs) refs.push({ type: 'rst', target });
                }
            }

            return { mnemonic, bytes, nextAddr: addr, refs };
        }
        
        disasmCB(opcode) {
            const x = (opcode >> 6) & 3;
            const y = (opcode >> 3) & 7;
            const z = opcode & 7;
            
            if (x === 0) {
                return rot[y] + ' ' + r[z];
            } else if (x === 1) {
                return 'BIT ' + y + ',' + r[z];
            } else if (x === 2) {
                return 'RES ' + y + ',' + r[z];
            } else {
                return 'SET ' + y + ',' + r[z];
            }
        }
        
        disasmED(addr, refs = null) {
            const opcode = this.read(addr++);
            let mnemonic = '';
            let bytes = [opcode];

            const x = (opcode >> 6) & 3;
            const y = (opcode >> 3) & 7;
            const z = opcode & 7;
            const p = (y >> 1) & 3;
            const q = y & 1;

            if (x === 1) {
                if (z === 0) {
                    if (y === 6) mnemonic = 'IN (C)';
                    else mnemonic = 'IN ' + r[y] + ',(C)';
                } else if (z === 1) {
                    if (y === 6) mnemonic = 'OUT (C),0';
                    else mnemonic = 'OUT (C),' + r[y];
                } else if (z === 2) {
                    mnemonic = (q === 0 ? 'SBC' : 'ADC') + ' HL,' + rp[p];
                } else if (z === 3) {
                    const lo = this.read(addr++);
                    const hi = this.read(addr++);
                    bytes.push(lo, hi);
                    const target = (hi << 8) | lo;
                    if (q === 0) {
                        mnemonic = 'LD (' + this.hex16(target) + '),' + rp[p];
                    } else {
                        mnemonic = 'LD ' + rp[p] + ',(' + this.hex16(target) + ')';
                    }
                    if (refs) refs.push({ type: 'ld_ind', target });
                } else if (z === 4) {
                    mnemonic = 'NEG';
                } else if (z === 5) {
                    mnemonic = (y === 1) ? 'RETI' : 'RETN';
                } else if (z === 6) {
                    const im = [0, 0, 1, 2, 0, 0, 1, 2];
                    mnemonic = 'IM ' + im[y];
                } else if (z === 7) {
                    const ops = ['LD I,A', 'LD R,A', 'LD A,I', 'LD A,R', 'RRD', 'RLD', 'NOP', 'NOP'];
                    mnemonic = ops[y];
                }
            } else if (x === 2) {
                if (z <= 3 && y >= 4) {
                    const bli = [
                        ['LDI', 'CPI', 'INI', 'OUTI'],
                        ['LDD', 'CPD', 'IND', 'OUTD'],
                        ['LDIR', 'CPIR', 'INIR', 'OTIR'],
                        ['LDDR', 'CPDR', 'INDR', 'OTDR']
                    ];
                    mnemonic = bli[y - 4][z];
                } else {
                    mnemonic = 'NOP';
                }
            } else {
                mnemonic = 'NOP';
            }

            return { mnemonic, bytes, nextAddr: addr, refs };
        }
        
        disasmIndexed(addr, ir, refs = null) {
            const opcode = this.read(addr++);
            let mnemonic = '';
            let bytes = [opcode];

            // Handle DD CB / FD CB prefix
            if (opcode === 0xCB) {
                const d = this.read(addr++);
                const op = this.read(addr++);
                bytes.push(d, op);

                const signed = this.signedByte(d);
                const disp = signed >= 0 ? '+' + signed : signed.toString();

                const x = (op >> 6) & 3;
                const y = (op >> 3) & 7;
                const z = op & 7;

                const target = '(' + ir + disp + ')';

                if (x === 0) {
                    if (z === 6) {
                        mnemonic = rot[y] + ' ' + target;
                    } else {
                        mnemonic = rot[y] + ' ' + target + ',' + r[z];
                    }
                } else if (x === 1) {
                    mnemonic = 'BIT ' + y + ',' + target;
                } else if (x === 2) {
                    if (z === 6) {
                        mnemonic = 'RES ' + y + ',' + target;
                    } else {
                        mnemonic = 'RES ' + y + ',' + target + ',' + r[z];
                    }
                } else {
                    if (z === 6) {
                        mnemonic = 'SET ' + y + ',' + target;
                    } else {
                        mnemonic = 'SET ' + y + ',' + target + ',' + r[z];
                    }
                }

                return { mnemonic, bytes, nextAddr: addr, refs };
            }

            const x = (opcode >> 6) & 3;
            const y = (opcode >> 3) & 7;
            const z = opcode & 7;
            const p = (y >> 1) & 3;
            const q = y & 1;

            // Map (HL) to (IX+d)/(IY+d) and H/L to IXH/IXL/IYH/IYL
            const irh = ir + 'H';
            const irl = ir + 'L';
            const ri = (idx) => {
                if (idx === 4) return irh;
                if (idx === 5) return irl;
                if (idx === 6) {
                    const d = this.read(addr++);
                    bytes.push(d);
                    const signed = this.signedByte(d);
                    const disp = signed >= 0 ? '+' + signed : signed.toString();
                    return '(' + ir + disp + ')';
                }
                return r[idx];
            };

            if (x === 0) {
                if (z === 1 && q === 0 && p === 2) {
                    const lo = this.read(addr++);
                    const hi = this.read(addr++);
                    bytes.push(lo, hi);
                    const target = (hi << 8) | lo;
                    mnemonic = 'LD ' + ir + ',' + this.hex16(target);
                    if (refs) refs.push({ type: 'ld_imm', target });
                } else if (z === 1 && q === 1) {
                    mnemonic = 'ADD ' + ir + ',' + (p === 2 ? ir : rp[p]);
                } else if (z === 2 && y === 4) {
                    const lo = this.read(addr++);
                    const hi = this.read(addr++);
                    bytes.push(lo, hi);
                    const target = (hi << 8) | lo;
                    mnemonic = 'LD (' + this.hex16(target) + '),' + ir;
                    if (refs) refs.push({ type: 'ld_ind', target });
                } else if (z === 2 && y === 5) {
                    const lo = this.read(addr++);
                    const hi = this.read(addr++);
                    bytes.push(lo, hi);
                    const target = (hi << 8) | lo;
                    mnemonic = 'LD ' + ir + ',(' + this.hex16(target) + ')';
                    if (refs) refs.push({ type: 'ld_ind', target });
                } else if (z === 3 && p === 2) {
                    mnemonic = (q === 0 ? 'INC ' : 'DEC ') + ir;
                } else if (z === 4 && (y === 4 || y === 5 || y === 6)) {
                    mnemonic = 'INC ' + ri(y);
                } else if (z === 5 && (y === 4 || y === 5 || y === 6)) {
                    mnemonic = 'DEC ' + ri(y);
                } else if (z === 6 && (y === 4 || y === 5 || y === 6)) {
                    const dest = ri(y);
                    const n = this.read(addr++);
                    bytes.push(n);
                    mnemonic = 'LD ' + dest + ',' + this.hex8(n);
                } else {
                    // Fall through to main decoder
                    const result = this.disasmMain(opcode, addr - 1, refs);
                    return { mnemonic: result.mnemonic, bytes: result.bytes, nextAddr: result.nextAddr, refs: result.refs };
                }
            } else if (x === 1) {
                if (y === 6 && z === 6) {
                    mnemonic = 'HALT';
                } else if (y === 6 || z === 6) {
                    mnemonic = 'LD ' + ri(y) + ',' + ri(z);
                } else if (y >= 4 && y <= 5 && z >= 4 && z <= 5) {
                    mnemonic = 'LD ' + ri(y) + ',' + ri(z);
                } else {
                    const result = this.disasmMain(opcode, addr - 1, refs);
                    return { mnemonic: result.mnemonic, bytes: result.bytes, nextAddr: result.nextAddr, refs: result.refs };
                }
            } else if (x === 2) {
                if (z === 6 || z === 4 || z === 5) {
                    mnemonic = alu[y] + ri(z);
                } else {
                    const result = this.disasmMain(opcode, addr - 1, refs);
                    return { mnemonic: result.mnemonic, bytes: result.bytes, nextAddr: result.nextAddr, refs: result.refs };
                }
            } else if (x === 3) {
                if (opcode === 0xE1) {
                    mnemonic = 'POP ' + ir;
                } else if (opcode === 0xE3) {
                    mnemonic = 'EX (SP),' + ir;
                } else if (opcode === 0xE5) {
                    mnemonic = 'PUSH ' + ir;
                } else if (opcode === 0xE9) {
                    mnemonic = 'JP (' + ir + ')';
                } else if (opcode === 0xF9) {
                    mnemonic = 'LD SP,' + ir;
                } else {
                    const result = this.disasmMain(opcode, addr - 1, refs);
                    return { mnemonic: result.mnemonic, bytes: result.bytes, nextAddr: result.nextAddr, refs: result.refs };
                }
            }

            return { mnemonic, bytes, nextAddr: addr, refs };
        }
        
        // Disassemble multiple instructions starting at addr
        disassembleRange(startAddr, count) {
            const lines = [];
            let addr = startAddr;
            
            for (let i = 0; i < count; i++) {
                const result = this.disassemble(addr);
                lines.push(result);
                addr = (addr + result.length) & 0xffff;
            }
            
            return lines;
        }
        
        // Find start address to show targetAddr at position positionFromTop (0-indexed)
        findStartForPosition(targetAddr, positionFromTop, maxLinesNeeded) {
            // Try disassembling from various starting points
            // Z80 instructions are 1-4 bytes, so try starting from targetAddr - 4*positionFromTop
            const maxBacktrack = 4 * (positionFromTop + 2);
            
            for (let offset = maxBacktrack; offset >= 1; offset--) {
                const tryAddr = (targetAddr - offset) & 0xffff;
                let addr = tryAddr;
                let foundTarget = false;
                let positionWhenFound = -1;
                
                for (let i = 0; i < maxLinesNeeded + positionFromTop; i++) {
                    if (addr === targetAddr) {
                        foundTarget = true;
                        positionWhenFound = i;
                        break;
                    }
                    const result = this.disassemble(addr);
                    addr = (addr + result.length) & 0xffff;
                    // Prevent infinite loops
                    if (addr <= tryAddr && i > 0) break;
                }
                
                if (foundTarget && positionWhenFound === positionFromTop) {
                    return tryAddr;
                }
            }
            
            // Fallback: just return targetAddr (will show at top)
            return targetAddr;
        }
        
        // Get T-states timing for instruction
        getTiming(bytes) {
            if (!bytes || bytes.length === 0) return '?';
            
            const op = bytes[0];
            
            // CB prefix
            if (op === 0xCB) {
                if (bytes.length < 2) return '?';
                const cb = bytes[1];
                // All CB instructions are 8 T-states, except (HL) which are 15
                const z = cb & 7;
                return z === 6 ? '15' : '8';
            }
            
            // ED prefix
            if (op === 0xED) {
                if (bytes.length < 2) return '?';
                return this.getTimingED(bytes[1]);
            }
            
            // DD/FD prefix (IX/IY)
            if (op === 0xDD || op === 0xFD) {
                if (bytes.length < 2) return '?';
                return this.getTimingIndexed(bytes);
            }
            
            // Main opcodes
            return this.getTimingMain(op);
        }
        
        getTimingMain(op) {
            const x = (op >> 6) & 3;
            const y = (op >> 3) & 7;
            const z = op & 7;
            const p = (y >> 1) & 3;
            const q = y & 1;
            
            if (x === 0) {
                if (z === 0) {
                    if (y === 0) return '4'; // NOP
                    if (y === 1) return '4'; // EX AF,AF'
                    if (y === 2) return '13/8'; // DJNZ
                    if (y === 3) return '12'; // JR
                    return '12/7'; // JR cc
                }
                if (z === 1) return q === 0 ? '10' : '11'; // LD rp,nn / ADD HL,rp
                if (z === 2) {
                    if (p === 0) return q === 0 ? '7' : '7'; // LD (BC),A / LD A,(BC)
                    if (p === 1) return q === 0 ? '7' : '7'; // LD (DE),A / LD A,(DE)
                    if (p === 2) return q === 0 ? '16' : '16'; // LD (nn),HL / LD HL,(nn)
                    return q === 0 ? '13' : '13'; // LD (nn),A / LD A,(nn)
                }
                if (z === 3) return '6'; // INC/DEC rp
                if (z === 4 || z === 5) return y === 6 ? '11' : '4'; // INC/DEC r
                if (z === 6) return y === 6 ? '10' : '7'; // LD r,n
                if (z === 7) {
                    const t7 = ['4','4','4','4','4','4','4','4']; // RLCA,RRCA,RLA,RRA,DAA,CPL,SCF,CCF
                    return t7[y];
                }
            }
            
            if (x === 1) {
                if (z === 6 && y === 6) return '4'; // HALT
                // LD r,r'
                if (z === 6 || y === 6) return '7'; // involves (HL)
                return '4';
            }
            
            if (x === 2) {
                // ALU A,r
                return z === 6 ? '7' : '4';
            }
            
            if (x === 3) {
                if (z === 0) return '11/5'; // RET cc
                if (z === 1) {
                    if (q === 0) return '10'; // POP
                    if (p === 0) return '10'; // RET
                    if (p === 1) return '4'; // EXX
                    if (p === 2) return '4'; // JP (HL)
                    return '6'; // LD SP,HL
                }
                if (z === 2) return '10'; // JP cc,nn
                if (z === 3) {
                    if (y === 0) return '10'; // JP nn
                    if (y === 2) return '11'; // OUT (n),A
                    if (y === 3) return '11'; // IN A,(n)
                    if (y === 4) return '19'; // EX (SP),HL
                    if (y === 5) return '4'; // EX DE,HL
                    if (y === 6) return '4'; // DI
                    if (y === 7) return '4'; // EI
                    return '?';
                }
                if (z === 4) return '17/10'; // CALL cc,nn
                if (z === 5) {
                    if (q === 0) return '11'; // PUSH
                    if (p === 0) return '17'; // CALL nn
                    return '?'; // DD/ED/FD prefixes handled elsewhere
                }
                if (z === 6) return '7'; // ALU A,n
                if (z === 7) return '11'; // RST
            }
            
            return '?';
        }
        
        getTimingED(op) {
            const x = (op >> 6) & 3;
            const y = (op >> 3) & 7;
            const z = op & 7;
            
            if (x === 1) {
                if (z === 0) return y === 6 ? '12' : '12'; // IN r,(C) / IN (C)
                if (z === 1) return y === 6 ? '12' : '12'; // OUT (C),r / OUT (C),0
                if (z === 2) return '15'; // SBC/ADC HL,rp
                if (z === 3) return '20'; // LD (nn),rp / LD rp,(nn)
                if (z === 4) return '8'; // NEG
                if (z === 5) return '14'; // RETN/RETI
                if (z === 6) return '8'; // IM
                if (z === 7) {
                    const t = ['9','9','18','18','8','8','8','8']; // LD I,A etc, RRD,RLD
                    return t[y];
                }
            }
            
            if (x === 2) {
                // Block instructions
                if (y >= 4 && z <= 3) {
                    // LDI,LDD,LDIR,LDDR,CPI,CPD,CPIR,CPDR,INI,IND,INIR,INDR,OUTI,OUTD,OTIR,OTDR
                    if (z === 0) return y >= 6 ? '21/16' : '16'; // LDI/LDD/LDIR/LDDR
                    if (z === 1) return y >= 6 ? '21/16' : '16'; // CPI/CPD/CPIR/CPDR
                    if (z === 2) return y >= 6 ? '21/16' : '16'; // INI/IND/INIR/INDR
                    if (z === 3) return y >= 6 ? '21/16' : '16'; // OUTI/OUTD/OTIR/OTDR
                }
            }
            
            return '8'; // Unknown/NOP
        }
        
        getTimingIndexed(bytes) {
            if (bytes.length < 2) return '?';
            const op2 = bytes[1];
            
            // DD CB / FD CB prefix
            if (op2 === 0xCB) {
                if (bytes.length < 4) return '?';
                const cb = bytes[3];
                const y = (cb >> 3) & 7;
                // BIT is 20, others are 23
                return ((cb & 0xC0) === 0x40) ? '20' : '23';
            }
            
            const x = (op2 >> 6) & 3;
            const y = (op2 >> 3) & 7;
            const z = op2 & 7;
            const p = (y >> 1) & 3;
            const q = y & 1;
            
            // Instructions that use (IX+d) or (IY+d)
            if (x === 0) {
                if (z === 1) return q === 0 ? '14' : '15'; // LD IX,nn / ADD IX,rp
                if (z === 2 && p === 2) return q === 0 ? '20' : '20'; // LD (nn),IX / LD IX,(nn)
                if (z === 3 && p === 2) return '10'; // INC/DEC IX
                if (z === 4 && y === 6) return '23'; // INC (IX+d)
                if (z === 5 && y === 6) return '23'; // DEC (IX+d)
                if (z === 6 && y === 6) return '19'; // LD (IX+d),n
                if (z === 4 || z === 5) return '8'; // INC/DEC IXH/IXL
                if (z === 6) return '11'; // LD IXH/IXL,n
            }
            
            if (x === 1) {
                // LD r,(IX+d) or LD (IX+d),r
                if (z === 6 || y === 6) return '19';
                return '8'; // LD between IXH/IXL and regular regs
            }
            
            if (x === 2) {
                // ALU A,(IX+d)
                if (z === 6) return '19';
                return '8'; // ALU with IXH/IXL
            }
            
            if (x === 3) {
                if (z === 1 && q === 0 && p === 2) return '14'; // POP IX
                if (z === 1 && q === 1 && p === 2) return '8'; // JP (IX)
                if (z === 1 && q === 1 && p === 3) return '10'; // LD SP,IX
                if (z === 3 && y === 4) return '23'; // EX (SP),IX
                if (z === 5 && q === 0 && p === 2) return '15'; // PUSH IX
            }
            
            return '8'; // Default/unknown
        }
    }

    // Export
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Disassembler;
    }
    if (typeof global !== 'undefined') {
        global.Disassembler = Disassembler;
    }

})(typeof window !== 'undefined' ? window : global);
