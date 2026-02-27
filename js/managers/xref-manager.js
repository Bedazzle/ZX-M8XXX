/**
 * ZX-M8XXX - Cross-Reference Manager
 * Tracks cross-references (calls, jumps) between addresses.
 * @license GPL-3.0
 *
 * External dependencies (passed via methods, not imported):
 * - disasm (global): Used by scanRange/scanRangeAsync for disassembly
 */

// Lines 11334-11515 of index.html

export class XRefManager {
    constructor() {
        this.xrefs = new Map();  // "page:addr" -> [{fromAddr, type, page}]
        this.currentFile = null;
        this.autoSaveEnabled = true;
    }

    _key(address, page = null) {
        const pageStr = page === null ? 'g' : page.toString();
        return `${pageStr}:${address.toString(16).padStart(4, '0')}`;
    }

    add(targetAddr, fromAddr, type, page = null) {
        const key = this._key(targetAddr, page);
        if (!this.xrefs.has(key)) {
            this.xrefs.set(key, []);
        }
        const refs = this.xrefs.get(key);
        // Avoid duplicates
        if (!refs.some(r => r.fromAddr === fromAddr && r.type === type && r.page === page)) {
            refs.push({ fromAddr, type, page });
        }
    }

    get(targetAddr, page = null) {
        const key = this._key(targetAddr, page);
        const refs = this.xrefs.get(key) || [];
        // Also check global refs if page-specific
        if (page !== null) {
            const globalRefs = this.xrefs.get(this._key(targetAddr, null)) || [];
            return [...refs, ...globalRefs];
        }
        return [...refs];
    }

    hasRefs(targetAddr, page = null) {
        return this.get(targetAddr, page).length > 0;
    }

    getCount() {
        let count = 0;
        for (const refs of this.xrefs.values()) {
            count += refs.length;
        }
        return count;
    }

    scanRange(startAddr, endAddr, disasm, page = null) {
        if (!disasm) return 0;
        let count = 0;
        let addr = startAddr;

        while (addr <= endAddr && addr < 0x10000) {
            const instr = disasm.disassemble(addr, true);
            if (instr.refs) {
                for (const ref of instr.refs) {
                    this.add(ref.target, addr, ref.type, page);
                    count++;
                }
            }
            addr = (addr + instr.length) & 0xffff;
            // Prevent infinite loop if we wrap around
            if (addr <= startAddr && addr !== 0) break;
        }
        if (this.autoSaveEnabled) this._autoSave();
        return count;
    }

    // Async version for large scans - processes in chunks to avoid blocking UI
    async scanRangeAsync(startAddr, endAddr, disasm, onProgress = null, page = null) {
        if (!disasm) return 0;
        let count = 0;
        let addr = startAddr;
        let bytesProcessed = 0;
        const totalBytes = endAddr - startAddr + 1;  // Don't mask - can be up to 0x10000
        let lastYield = Date.now();

        while (addr <= endAddr && addr < 0x10000 && bytesProcessed < totalBytes) {
            const instr = disasm.disassemble(addr, true);
            if (instr.refs) {
                for (const ref of instr.refs) {
                    this.add(ref.target, addr, ref.type, page);
                    count++;
                }
            }
            bytesProcessed += instr.length;
            addr = (addr + instr.length) & 0xffff;

            // Yield to UI every 20ms
            if (Date.now() - lastYield > 20) {
                if (onProgress) onProgress(bytesProcessed, totalBytes, count);
                await new Promise(r => setTimeout(r, 0));
                lastYield = Date.now();
            }
        }
        if (this.autoSaveEnabled) this._autoSave();
        return count;
    }

    clear() {
        this.xrefs.clear();
        if (this.autoSaveEnabled) this._autoSave();
    }

    setCurrentFile(filename) {
        // Save current file's xrefs before switching
        if (this.currentFile && this.autoSaveEnabled) {
            this._autoSave();
        }
        this.currentFile = filename;
        if (filename) {
            this._autoLoad();
        } else {
            this.xrefs.clear();
        }
    }

    _storageKey() {
        if (!this.currentFile) return null;
        return `zx_xrefs_${this.currentFile.toLowerCase()}`;
    }

    _autoSave() {
        const key = this._storageKey();
        if (!key) return;
        try {
            const data = this.exportJSON();
            if (data) {
                localStorage.setItem(key, data);
            } else {
                localStorage.removeItem(key);
            }
        } catch (e) {
            console.warn('Failed to save xrefs:', e);
        }
    }

    _autoLoad() {
        const key = this._storageKey();
        if (!key) return;
        try {
            const data = localStorage.getItem(key);
            if (data) {
                this.importJSON(data, false);
            }
        } catch (e) {
            console.warn('Failed to load xrefs:', e);
        }
    }

    exportJSON() {
        if (this.xrefs.size === 0) return null;
        const arr = [];
        for (const [key, refs] of this.xrefs.entries()) {
            arr.push({ key, refs });
        }
        return JSON.stringify(arr);
    }

    importJSON(jsonStr, merge = false) {
        try {
            const arr = JSON.parse(jsonStr);
            if (!merge) this.xrefs.clear();
            for (const item of arr) {
                if (merge && this.xrefs.has(item.key)) {
                    const existing = this.xrefs.get(item.key);
                    for (const ref of item.refs) {
                        if (!existing.some(r => r.fromAddr === ref.fromAddr && r.type === ref.type)) {
                            existing.push(ref);
                        }
                    }
                } else {
                    this.xrefs.set(item.key, item.refs);
                }
            }
            return arr.length;
        } catch (e) {
            console.error('Failed to import xrefs:', e);
            return -1;
        }
    }
}
