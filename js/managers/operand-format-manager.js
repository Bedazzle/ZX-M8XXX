/**
 * ZX-M8XXX - Operand Format Manager
 * Stores custom display formats for operands (hex/dec/bin/char).
 * @license GPL-3.0
 */

// Lines 11213-11329 of index.html

export const OPERAND_FORMATS = {
    HEX: 'hex',
    DEC: 'dec',
    BIN: 'bin',
    CHAR: 'char'
};

export class OperandFormatManager {
    constructor() {
        this.formats = new Map();  // Map<address, format>
        this.currentFile = null;
        this.autoSaveEnabled = true;
    }

    // Set format for operand at instruction address
    set(address, format) {
        address = address & 0xffff;
        if (format === OPERAND_FORMATS.HEX) {
            // Default format - remove entry
            this.formats.delete(address);
        } else {
            this.formats.set(address, format);
        }
        if (this.autoSaveEnabled) this._autoSave();
    }

    // Get format at address (returns 'hex' as default)
    get(address) {
        return this.formats.get(address & 0xffff) || OPERAND_FORMATS.HEX;
    }

    // Remove format at address
    remove(address) {
        const had = this.formats.has(address & 0xffff);
        this.formats.delete(address & 0xffff);
        if (had && this.autoSaveEnabled) this._autoSave();
        return had;
    }

    // Get all formats as array
    getAll() {
        const result = [];
        for (const [addr, format] of this.formats) {
            result.push({ address: addr, format });
        }
        return result.sort((a, b) => a.address - b.address);
    }

    // Clear all formats
    clear() {
        this.formats.clear();
        if (this.autoSaveEnabled) this._autoSave();
    }

    // Format a value according to format type
    formatValue(value, format, is16bit = false) {
        const val = is16bit ? (value & 0xffff) : (value & 0xff);
        switch (format) {
            case OPERAND_FORMATS.DEC:
                return val.toString(10);
            case OPERAND_FORMATS.BIN:
                return '%' + val.toString(2).padStart(is16bit ? 16 : 8, '0');
            case OPERAND_FORMATS.CHAR:
                if (!is16bit && val >= 32 && val < 127) {
                    const ch = String.fromCharCode(val);
                    // Escape quotes
                    if (ch === "'") return '"\'"';
                    return "'" + ch + "'";
                }
                // Fall back to hex for non-printable or 16-bit
                return val.toString(16).toUpperCase().padStart(is16bit ? 4 : 2, '0') + 'h';
            case OPERAND_FORMATS.HEX:
            default:
                return val.toString(16).toUpperCase().padStart(is16bit ? 4 : 2, '0') + 'h';
        }
    }

    // Set current file for auto-save
    setCurrentFile(filename) {
        this.currentFile = filename;
        this._autoLoad();
    }

    _storageKey() {
        if (!this.currentFile) return null;
        return `zx_opformats_${this.currentFile.toLowerCase()}`;
    }

    _autoSave() {
        const key = this._storageKey();
        if (!key) return;
        try {
            localStorage.setItem(key, JSON.stringify(this.getAll()));
        } catch (e) {
            console.warn('Failed to save operand formats:', e);
        }
    }

    _autoLoad() {
        this.formats.clear();
        const key = this._storageKey();
        if (!key) return;
        try {
            const data = localStorage.getItem(key);
            if (data) {
                const arr = JSON.parse(data);
                for (const f of arr) {
                    this.formats.set(f.address, f.format);
                }
            }
        } catch (e) {
            console.warn('Failed to load operand formats:', e);
        }
    }
}
