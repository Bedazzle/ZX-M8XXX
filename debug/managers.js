// Pure data managers — extracted from index.html
import { storageGet, storageSet } from '../core/utils.js';

// Shared per-file localStorage persistence. Subclasses provide:
//   _serialize()        — JSON-ready value of the store (an array)
//   _deserialize(arr)   — load parsed entries into the store (additive)
//   _clearData()        — reset the store (without autosaving)
export class PersistentManager {
    constructor(storagePrefix, dataName) {
        this._storagePrefix = storagePrefix;
        this._dataName = dataName;
        this.currentFile = null;
        this.autoSaveEnabled = true;
    }

    // Set current file (for auto-save key)
    setCurrentFile(filename) {
        this.currentFile = filename;
        this._autoLoad();
    }

    _storageKey() {
        if (!this.currentFile) return null;
        return `zxm8_${this._storagePrefix}_${this.currentFile.toLowerCase()}`;
    }

    _autoSave() {
        const key = this._storageKey();
        if (!key) return;
        storageSet(key, JSON.stringify(this._serialize()));
    }

    _autoLoad() {
        this._clearData();
        const key = this._storageKey();
        if (!key) return;

        const data = storageGet(key);
        if (data) {
            try {
                this._deserialize(JSON.parse(data));
            } catch (e) {
                console.warn(`Failed to load ${this._dataName}:`, e);
            }
        }
    }

    clear() {
        this._clearData();
        if (this.autoSaveEnabled) this._autoSave();
    }

    exportJSON() {
        return JSON.stringify(this._serialize(), null, 2);
    }

    importJSON(jsonStr, merge = false) {
        try {
            const arr = JSON.parse(jsonStr);
            if (!merge) this._clearData();
            this._deserialize(arr);
            if (this.autoSaveEnabled) this._autoSave();
            return arr.length;
        } catch (e) {
            console.error(`Failed to import ${this._dataName}:`, e);
            return -1;
        }
    }
}

export class LabelManager extends PersistentManager {
    constructor() {
        super('labels', 'labels');
        this.labels = new Map();  // key = "page:address", value = label object
        this.romLabels = new Map(); // ROM labels loaded from file
        this.showRomLabels = true;
    }

    // Generate key for label lookup
    _key(address, page = null) {
        const pageStr = page === null ? 'g' : page.toString();
        return `${pageStr}:${address.toString(16).padStart(4, '0')}`;
    }

    _serialize() {
        return Array.from(this.labels.values());
    }

    _deserialize(arr) {
        for (const label of arr) {
            this.labels.set(this._key(label.address, label.page), label);
        }
    }

    _clearData() {
        this.labels.clear();
    }

    // Add or update a label
    add(label) {
        const key = this._key(label.address, label.page);
        const entry = {
            address: label.address & 0xffff,
            page: label.page ?? null,
            name: label.name || '',
            comment: label.comment || '',
            size: label.size || 1
        };
        if (label.source) entry.source = label.source;
        this.labels.set(key, entry);
        if (this.autoSaveEnabled) this._autoSave();
        return entry;
    }

    // Remove a label
    remove(address, page = null) {
        const key = this._key(address, page);
        const existed = this.labels.delete(key);
        if (existed && this.autoSaveEnabled) this._autoSave();
        return existed;
    }

    // Get label at exact address and page
    get(address, page = null) {
        // First try user labels (exact page match)
        let label = this.labels.get(this._key(address, page));
        if (label) return label;
        // Fall back to global user label
        if (page !== null) {
            label = this.labels.get(this._key(address, null));
            if (label) return label;
        }
        // Fall back to ROM labels if enabled
        if (this.showRomLabels) {
            label = this.romLabels.get(this._key(address, page));
            if (label) return label;
            if (page !== null) {
                label = this.romLabels.get(this._key(address, null));
            }
        }
        return label || null;
    }

    // Find label by name
    findByName(name) {
        const nameLower = name.toLowerCase();
        for (const label of this.labels.values()) {
            if (label.name.toLowerCase() === nameLower) return label;
        }
        return null;
    }

    // Get all labels, optionally filtered by page
    getAll(pageFilter = undefined) {
        const result = [];
        for (const label of this.labels.values()) {
            if (pageFilter === undefined || label.page === pageFilter || label.page === null) {
                result.push(label);
            }
        }
        return result.sort((a, b) => a.address - b.address);
    }

    // Load ROM labels from JSON string
    loadRomLabels(jsonStr) {
        try {
            const arr = JSON.parse(jsonStr);
            this.romLabels.clear();
            for (const label of arr) {
                const entry = {
                    address: label.address & 0xffff,
                    page: label.page ?? null,
                    name: label.name || '',
                    comment: label.comment || '',
                    size: label.size || 1,
                    isRom: true
                };
                this.romLabels.set(this._key(entry.address, entry.page), entry);
            }
            return arr.length;
        } catch (e) {
            console.error('Failed to load ROM labels:', e);
            return -1;
        }
    }

    // Get count of ROM labels
    getRomLabelCount() {
        return this.romLabels.size;
    }
}

// Memory region types for marking code/data/etc
export const REGION_TYPES = {
    CODE: 'code',
    DB: 'db',       // Data bytes
    DW: 'dw',       // Data words (16-bit)
    TEXT: 'text',   // Text strings
    GRAPHICS: 'graphics',
    SMC: 'smc'      // Self-modifying code
};

export class RegionManager extends PersistentManager {
    constructor() {
        super('regions', 'regions');
        this.regions = [];  // Array of {start, end, type, page, comment}
    }

    _serialize() {
        return this.regions;
    }

    _deserialize(arr) {
        for (const r of arr) {
            this.regions.push(r);
        }
        this.regions.sort((a, b) => a.start - b.start);
    }

    _clearData() {
        this.regions = [];
    }

    // Check if a range overlaps with existing regions
    getOverlapping(start, end, page = null) {
        start = start & 0xffff;
        end = end & 0xffff;
        return this.regions.filter(r => {
            if (r.page !== page && r.page !== null && page !== null) return false;
            // Check for overlap
            return !(r.end < start || r.start > end);
        });
    }

    // Add or update a region
    add(region, allowOverwrite = false) {
        const entry = {
            start: region.start & 0xffff,
            end: region.end & 0xffff,
            type: region.type || REGION_TYPES.CODE,
            page: region.page ?? null,
            comment: region.comment || ''
        };
        // Store width/height/charMode for graphics regions
        if (region.width) entry.width = region.width;
        if (region.height) entry.height = region.height;
        if (region.charMode) entry.charMode = region.charMode;

        // Check for overlapping regions
        const overlapping = this.getOverlapping(entry.start, entry.end, entry.page);
        if (overlapping.length > 0 && !allowOverwrite) {
            return { error: 'overlap', regions: overlapping };
        }

        // Remove overlapping regions if overwrite allowed
        if (allowOverwrite) {
            this.regions = this.regions.filter(r => {
                if (r.page !== entry.page && r.page !== null && entry.page !== null) return true;
                return r.end < entry.start || r.start > entry.end;
            });
        }

        this.regions.push(entry);
        this.regions.sort((a, b) => a.start - b.start);
        if (this.autoSaveEnabled) this._autoSave();
        return entry;
    }

    // Remove region containing address
    remove(address, page = null) {
        const before = this.regions.length;
        this.regions = this.regions.filter(r => {
            if (r.page !== page && r.page !== null && page !== null) return true;
            return !(address >= r.start && address <= r.end);
        });
        if (this.regions.length !== before && this.autoSaveEnabled) {
            this._autoSave();
        }
        return this.regions.length !== before;
    }

    // Get region at address
    get(address, page = null) {
        for (const r of this.regions) {
            if ((r.page === page || r.page === null) &&
                address >= r.start && address <= r.end) {
                return r;
            }
        }
        return null;
    }

    // Get region type at address (for quick checks)
    getType(address, page = null) {
        const region = this.get(address, page);
        return region ? region.type : REGION_TYPES.CODE;
    }

    // Check if address is in a non-code region
    isData(address, page = null) {
        const type = this.getType(address, page);
        return type !== REGION_TYPES.CODE && type !== REGION_TYPES.SMC;
    }

    // Get all regions
    getAll(pageFilter = undefined) {
        if (pageFilter === undefined) return [...this.regions];
        return this.regions.filter(r => r.page === pageFilter || r.page === null);
    }
}

export class CommentManager extends PersistentManager {
    constructor() {
        super('comments', 'comments');
        this.comments = new Map();  // Map<address, {before, inline, after, separator}>
    }

    _serialize() {
        return this.getAll();
    }

    _deserialize(arr) {
        for (const c of arr) {
            this.comments.set(c.address, {
                before: c.before || '',
                inline: c.inline || '',
                after: c.after || '',
                separator: c.separator || false
            });
        }
    }

    _clearData() {
        this.comments.clear();
    }

    // Add or update comment at address
    set(address, comment) {
        address = address & 0xffff;
        const existing = this.comments.get(address) || {};
        const entry = {
            before: comment.before !== undefined ? comment.before : (existing.before || ''),
            inline: comment.inline !== undefined ? comment.inline : (existing.inline || ''),
            after: comment.after !== undefined ? comment.after : (existing.after || ''),
            separator: comment.separator !== undefined ? comment.separator : (existing.separator || false)
        };
        // Remove if all empty
        if (!entry.before && !entry.inline && !entry.after && !entry.separator) {
            this.comments.delete(address);
        } else {
            this.comments.set(address, entry);
        }
        if (this.autoSaveEnabled) this._autoSave();
        return entry;
    }

    // Get comment at address
    get(address) {
        return this.comments.get(address & 0xffff) || null;
    }

    // Remove all comments at address
    remove(address) {
        const had = this.comments.has(address & 0xffff);
        this.comments.delete(address & 0xffff);
        if (had && this.autoSaveEnabled) this._autoSave();
        return had;
    }

    // Get all comments as array
    getAll() {
        const result = [];
        for (const [addr, comment] of this.comments) {
            result.push({ address: addr, ...comment });
        }
        return result.sort((a, b) => a.address - b.address);
    }
}

// Stores custom display formats for operands (hex/dec/bin/char)
export const OPERAND_FORMATS = {
    HEX: 'hex',
    DEC: 'dec',
    BIN: 'bin',
    CHAR: 'char'
};

export class OperandFormatManager extends PersistentManager {
    constructor() {
        super('opformats', 'operand formats');
        this.formats = new Map();  // Map<address, format>
    }

    _serialize() {
        return this.getAll();
    }

    _deserialize(arr) {
        for (const f of arr) {
            this.formats.set(f.address, f.format);
        }
    }

    _clearData() {
        this.formats.clear();
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
}
