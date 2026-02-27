/**
 * ZX-M8XXX - Trace Manager (Execution Trace)
 * Records Z80 CPU execution history for debugging and analysis.
 * @license GPL-3.0
 *
 * External dependencies:
 * - Disassembler class: Used in exportToText() to disassemble stored instruction bytes.
 *   Must be passed or imported separately by the consumer.
 */

// Lines 11973-12256 of index.html

import { Disassembler } from '../core/disasm.js';

export class TraceManager {
    constructor(maxHistory = 100000) {
        this.history = [];        // Array of trace entries
        this.maxHistory = maxHistory;
        this.enabled = true;      // Can be toggled for performance
        this.position = -1;       // Current viewing position (-1 = live)
        this.stopAfter = 0;       // Stop recording after N entries (0 = no limit)
        this.stopped = false;     // Recording stopped due to limit
        this.onStopped = null;    // Callback when recording stops (for pausing emulator)
        this.skipROM = true;      // Skip recording when PC < 0x4000 (ROM area)
    }

    record(cpu, memory, instrPC = null, portOps = null, memOps = null, instrBytes = null) {
        if (this.stopped) return;

        // Use provided PC (before execution) or fall back to current PC
        const pc = instrPC !== null ? instrPC : cpu.pc;

        // Skip ROM area if option enabled
        if (this.skipROM && pc < 0x4000) return;

        // Check stop limit
        if (this.stopAfter > 0 && this.history.length >= this.stopAfter) {
            this.stopped = true;
            if (this.onStopped) this.onStopped();
            return;
        }
        const entry = {
            pc: pc,
            sp: cpu.sp,
            af: cpu.af,
            bc: cpu.bc,
            de: cpu.de,
            hl: cpu.hl,
            ix: cpu.ix,
            iy: cpu.iy,
            af_: (cpu.a_ << 8) | cpu.f_,
            bc_: (cpu.b_ << 8) | cpu.c_,
            de_: (cpu.d_ << 8) | cpu.e_,
            hl_: (cpu.h_ << 8) | cpu.l_,
            i: cpu.i,
            r: (cpu.r7 & 0x80) | (cpu.r & 0x7f),
            iff1: cpu.iff1,
            iff2: cpu.iff2,
            im: cpu.im,
            tStates: cpu.tStates,
            // Use pre-captured bytes (before instruction modified memory) or read from memory
            bytes: instrBytes || [
                memory.read(pc & 0xffff),
                memory.read((pc + 1) & 0xffff),
                memory.read((pc + 2) & 0xffff),
                memory.read((pc + 3) & 0xffff)
            ],
            // Port I/O operations during this instruction
            ports: portOps && portOps.length > 0 ? portOps.slice() : null,
            // Memory write operations during this instruction
            mem: memOps && memOps.length > 0 ? memOps.slice() : null
        };

        this.history.push(entry);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
        this.position = -1; // Reset to live view
    }

    getEntry(index) {
        if (index < 0 || index >= this.history.length) return null;
        return this.history[index];
    }

    getRecent(count = 50) {
        const start = Math.max(0, this.history.length - count);
        return this.history.slice(start);
    }

    // Get entries around a specific position (for navigation view)
    getEntriesAround(pos, count = 20) {
        if (pos < 0 || pos >= this.history.length) {
            return { entries: [], startIdx: 0, viewIdx: -1 };
        }
        const half = Math.floor(count / 2);
        let start = Math.max(0, pos - half);
        let end = Math.min(this.history.length, start + count);
        // Adjust start if we hit the end
        if (end - start < count) {
            start = Math.max(0, end - count);
        }
        return {
            entries: this.history.slice(start, end),
            startIdx: start,
            viewIdx: pos - start  // Index within returned array
        };
    }

    get length() {
        return this.history.length;
    }

    clear() {
        this.history = [];
        this.position = -1;
        this.stopped = false;
    }

    goBack() {
        if (this.history.length === 0) return null;
        if (this.position === -1) {
            this.position = this.history.length - 1;
        } else if (this.position > 0) {
            this.position--;
        }
        return this.history[this.position];
    }

    goForward() {
        if (this.position === -1 || this.history.length === 0) return null;
        if (this.position < this.history.length - 1) {
            this.position++;
            return this.history[this.position];
        } else {
            this.position = -1; // Back to live
            return null;
        }
    }

    goToLive() {
        this.position = -1;
    }

    isViewingHistory() {
        return this.position !== -1;
    }

    getCurrentPosition() {
        return this.position;
    }

    // Export trace to text format for file download (Excel-compatible TSV)
    exportToText(options = {}) {
        const {
            includeBytes = true,     // Include instruction bytes
            includeAlt = false,      // Include alternate registers
            includeSys = false,      // Include system regs (I, R, IFF, IM, T)
            includePorts = false,    // Include port I/O
            includeMem = false,      // Include memory writes
            collapseBlock = false,   // Collapse block commands (LDIR, LDDR, etc.) to single line
            startIdx = 0,            // Start index in history
            endIdx = -1              // End index (-1 = to end)
        } = options;

        // Block commands that repeat until BC=0 or condition met
        const blockCommands = ['LDIR', 'LDDR', 'CPIR', 'CPDR', 'INIR', 'INDR', 'OTIR', 'OTDR'];

        const lines = [];
        let prev = null;  // Previous entry for change detection
        const hex4 = v => v.toString(16).toUpperCase().padStart(4,'0');
        const hex2 = v => v.toString(16).toUpperCase().padStart(2,'0');

        // Calculate actual range
        const start = Math.max(0, startIdx);
        const end = endIdx < 0 ? this.history.length : Math.min(endIdx, this.history.length);

        // Build header row
        const headers = ['ADDR'];
        if (includeBytes) headers.push('BYTES');
        headers.push('INSTR', 'AF', 'BC', 'DE', 'HL', 'SP', 'IX', 'IY');
        if (includeSys) headers.push('I', 'R', 'IFF', 'IM', 'T');
        if (includeAlt) headers.push("AF'", "BC'", "DE'", "HL'");
        if (includePorts) headers.push('PORT');
        if (includeMem) headers.push('MEM');
        lines.push(headers.join('\t'));

        let lastBlockPC = -1;      // PC of last block command (for collapse detection)
        let lastBlockMnemonic = '';  // Mnemonic of last block command
        let blockRepeatCount = 0;  // How many times block command repeated

        for (let i = start; i < end; i++) {
            const e = this.history[i];
            const isFirst = (i === start);

            // Create a fake memory object that reads from stored bytes
            const fakeMemory = { read: (addr) => e.bytes[(addr - e.pc) & 3] || 0 };
            const disasmLocal = new Disassembler(fakeMemory);

            // Disassemble instruction
            const result = disasmLocal.disassemble(e.pc);
            const mnemonic = result.mnemonic || '???';
            const bytesHex = e.bytes.slice(0, result.length).map(b => hex2(b)).join(' ');

            // Block command collapsing
            if (collapseBlock) {
                const isBlockCmd = blockCommands.includes(mnemonic);
                if (isBlockCmd && e.pc === lastBlockPC && mnemonic === lastBlockMnemonic) {
                    // Same block command at same PC - skip this iteration
                    blockRepeatCount++;
                    continue;
                }
                // If we were tracking a block command and now moved on, add repeat count to last line
                if (blockRepeatCount > 0 && lines.length > 1) {
                    lines[lines.length - 1] += `\t(x${blockRepeatCount + 1})`;
                }
                // Update tracking
                if (isBlockCmd) {
                    lastBlockPC = e.pc;
                    lastBlockMnemonic = mnemonic;
                    blockRepeatCount = 0;
                } else {
                    lastBlockPC = -1;
                    lastBlockMnemonic = '';
                    blockRepeatCount = 0;
                }
            }

            // Build columns array
            const cols = [];

            // Address (always shown)
            cols.push(hex4(e.pc));

            // Bytes (optional)
            if (includeBytes) cols.push(bytesHex);

            // Instruction (always shown)
            cols.push(mnemonic);

            // Registers - show value if first row or changed, empty otherwise
            cols.push(isFirst || e.af !== prev.af ? hex4(e.af) : '');
            cols.push(isFirst || e.bc !== prev.bc ? hex4(e.bc) : '');
            cols.push(isFirst || e.de !== prev.de ? hex4(e.de) : '');
            cols.push(isFirst || e.hl !== prev.hl ? hex4(e.hl) : '');
            cols.push(isFirst || e.sp !== prev.sp ? hex4(e.sp) : '');
            cols.push(isFirst || e.ix !== prev.ix ? hex4(e.ix) : '');
            cols.push(isFirst || e.iy !== prev.iy ? hex4(e.iy) : '');

            // System registers (optional)
            if (includeSys) {
                cols.push(isFirst || e.i !== prev.i ? hex2(e.i) : '');
                cols.push(isFirst || e.r !== prev.r ? hex2(e.r) : '');
                cols.push(isFirst || e.iff1 !== prev.iff1 || e.iff2 !== prev.iff2 ? `${e.iff1?1:0}/${e.iff2?1:0}` : '');
                cols.push(isFirst || e.im !== prev.im ? e.im.toString() : '');
                cols.push(e.tStates.toString());  // T-states always shown
            }

            // Alternate registers (optional)
            if (includeAlt) {
                cols.push(isFirst || e.af_ !== prev.af_ ? hex4(e.af_) : '');
                cols.push(isFirst || e.bc_ !== prev.bc_ ? hex4(e.bc_) : '');
                cols.push(isFirst || e.de_ !== prev.de_ ? hex4(e.de_) : '');
                cols.push(isFirst || e.hl_ !== prev.hl_ ? hex4(e.hl_) : '');
            }

            // Port I/O (optional)
            if (includePorts) {
                if (e.ports && e.ports.length > 0) {
                    const portStr = e.ports.map(p => `${p.dir}:${hex4(p.port)}=${hex2(p.val||0)}`).join(' ');
                    cols.push(portStr);
                } else {
                    cols.push('');
                }
            }

            // Memory writes (optional)
            if (includeMem) {
                if (e.mem && e.mem.length > 0) {
                    const memStr = e.mem.map(m => `${hex4(m.addr)}=${hex2(m.val||0)}`).join(' ');
                    cols.push(memStr);
                } else {
                    cols.push('');
                }
            }

            lines.push(cols.join('\t'));
            prev = e;
        }

        // Handle case where trace ends with a block command
        if (collapseBlock && blockRepeatCount > 0 && lines.length > 1) {
            lines[lines.length - 1] += `\t(x${blockRepeatCount + 1})`;
        }

        return lines.join('\n');
    }
}
