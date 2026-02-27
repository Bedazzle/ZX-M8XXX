/**
 * ZX-M8XXX - Subroutine Manager
 * Tracks subroutine boundaries and auto-detects them from executed code.
 * @license GPL-3.0
 *
 * External dependencies (passed via methods, not imported):
 * - disasm (global): Used by _findEndAddress, detectFromCode for disassembly
 * - spectrum (global): Used by detectFromCode for parseAutoMapKey
 */

// Lines 11521-11730 of index.html

export class SubroutineManager {
    constructor() {
        this.subs = new Map();  // address -> {name, comment, auto, endAddress}
        this.currentFile = null;
        this.autoSaveEnabled = true;
    }

    add(address, name = null, comment = null, auto = false, disasm = null) {
        address = address & 0xffff;
        const existing = this.subs.get(address);
        const endAddress = this._findEndAddress(address, disasm);
        this.subs.set(address, {
            name: name || (existing ? existing.name : null),
            comment: comment || (existing ? existing.comment : null),
            auto: auto || (existing ? existing.auto : false),
            endAddress: endAddress
        });
        if (this.autoSaveEnabled) this._autoSave();
    }

    // Scan forward to find subroutine end address
    _findEndAddress(startAddr, disasm = null) {
        if (!disasm) return null;

        let addr = startAddr;
        let lastUnconditionalRet = null;
        const maxScan = 1024; // max bytes to scan
        const endAddr = Math.min(startAddr + maxScan, 0x10000);

        while (addr < endAddr) {
            const instr = disasm.disassemble(addr);
            const mnem = (instr.mnemonic || '').replace(/<[^>]+>/g, '').toUpperCase().trim();
            const instrLen = instr.length || 1;

            // Check for unconditional RET
            if (mnem === 'RET' || mnem === 'RETI' || mnem === 'RETN') {
                lastUnconditionalRet = addr;
                // This could be the end, but there might be more code after
                // (e.g., error handlers, alternate entry points)
                // For now, treat first unconditional RET as the end
                return addr;
            }

            // Check for unconditional JP/JR back into subroutine (tail loop)
            if (mnem.startsWith('JP ') || mnem.startsWith('JR ')) {
                // Check if it's unconditional (no condition after JP/JR)
                const afterOp = mnem.slice(3).trim();
                const isConditional = /^(NZ|Z|NC|C|PO|PE|P|M),/.test(afterOp);
                if (!isConditional && instr.refs) {
                    const target = instr.refs[0]?.target;
                    if (target !== undefined && target >= startAddr && target <= addr) {
                        // Unconditional jump back into sub body - this is the end
                        return addr;
                    }
                }
            }

            // Stop if we hit another subroutine
            if (addr > startAddr && this.has(addr)) {
                break;
            }

            addr += instrLen;
        }

        return lastUnconditionalRet;
    }

    // Recalculate end addresses for all subroutines
    recalculateEnds(disasm = null) {
        for (const [addr, data] of this.subs) {
            data.endAddress = this._findEndAddress(addr, disasm);
        }
        if (this.autoSaveEnabled) this._autoSave();
    }

    remove(address) {
        address = address & 0xffff;
        if (this.subs.delete(address)) {
            if (this.autoSaveEnabled) this._autoSave();
            return true;
        }
        return false;
    }

    get(address) {
        return this.subs.get(address & 0xffff);
    }

    has(address) {
        return this.subs.has(address & 0xffff);
    }

    // Check if address is the end of any subroutine(s)
    // Returns array of all subs ending here, sorted by start address descending (reverse order)
    getAllEndingAt(address) {
        address = address & 0xffff;
        const results = [];
        for (const [startAddr, data] of this.subs) {
            if (data.endAddress === address) {
                results.push({ address: startAddr, ...data });
            }
        }
        // Sort by start address descending (reverse order of how they appear)
        return results.sort((a, b) => b.address - a.address);
    }

    getAll() {
        return Array.from(this.subs.entries())
            .map(([addr, data]) => ({ address: addr, ...data }))
            .sort((a, b) => a.address - b.address);
    }

    getCount() {
        return this.subs.size;
    }

    clear(autoOnly = false) {
        if (autoOnly) {
            for (const [addr, data] of this.subs) {
                if (data.auto) this.subs.delete(addr);
            }
        } else {
            this.subs.clear();
        }
        if (this.autoSaveEnabled) this._autoSave();
    }

    // Detect subroutines from executed addresses by scanning for CALL targets
    detectFromCode(executedAddrs, disasm, spectrum) {
        if (!disasm) return 0;
        let count = 0;

        for (const key of executedAddrs.keys()) {
            const { addr } = spectrum.parseAutoMapKey(key);
            const instr = disasm.disassemble(addr, true);

            // Check if this is a CALL instruction
            if (instr.refs) {
                for (const ref of instr.refs) {
                    if (ref.type === 'call' && !this.has(ref.target)) {
                        this.add(ref.target, null, null, true, disasm);
                        count++;
                    }
                }
            }
        }

        if (this.autoSaveEnabled) this._autoSave();
        return count;
    }

    setCurrentFile(filename) {
        if (this.currentFile && this.autoSaveEnabled) {
            this._autoSave();
        }
        this.currentFile = filename;
        if (filename) {
            this._autoLoad();
        }
    }

    _autoSave() {
        if (!this.currentFile) return;
        try {
            const key = `zxm8_subs_${this.currentFile}`;
            localStorage.setItem(key, this.exportJSON());
        } catch (e) { }
    }

    _autoLoad() {
        if (!this.currentFile) return;
        try {
            const key = `zxm8_subs_${this.currentFile}`;
            const json = localStorage.getItem(key);
            if (json) this.importJSON(json);
        } catch (e) { }
    }

    exportJSON() {
        const arr = [];
        for (const [addr, data] of this.subs) {
            arr.push({ address: addr, ...data });
        }
        return JSON.stringify(arr);
    }

    importJSON(jsonStr, merge = false, disasm = null) {
        try {
            const arr = JSON.parse(jsonStr);
            if (!merge) this.subs.clear();
            for (const item of arr) {
                this.subs.set(item.address, {
                    name: item.name || null,
                    comment: item.comment || null,
                    auto: item.auto || false,
                    endAddress: item.endAddress || null
                });
            }
            // Recalculate end addresses if disasm is available
            if (disasm) {
                this.recalculateEnds(disasm);
            }
            return arr.length;
        } catch (e) {
            console.error('Failed to import subroutines:', e);
            return -1;
        }
    }
}
