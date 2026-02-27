/**
 * ZX-M8XXX - Region Manager
 * Manages memory regions (code/data/text/graphics) for the disassembler.
 * @license GPL-3.0
 */

// Lines 10913-11082 of index.html

// Memory region types for marking code/data/etc
export const REGION_TYPES = {
    CODE: 'code',
    DB: 'db',       // Data bytes
    DW: 'dw',       // Data words (16-bit)
    TEXT: 'text',   // Text strings
    GRAPHICS: 'graphics',
    SMC: 'smc'      // Self-modifying code
};

export class RegionManager {
    constructor() {
        this.regions = [];  // Array of {start, end, type, page, comment}
        this.currentFile = null;
        this.autoSaveEnabled = true;
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

    // Clear all regions
    clear() {
        this.regions = [];
        if (this.autoSaveEnabled) this._autoSave();
    }

    // Set current file (for auto-save key)
    setCurrentFile(filename) {
        this.currentFile = filename;
        this._autoLoad();
    }

    // Get storage key for current file
    _storageKey() {
        if (!this.currentFile) return null;
        return `zx_regions_${this.currentFile.toLowerCase()}`;
    }

    // Auto-save to localStorage
    _autoSave() {
        const key = this._storageKey();
        if (!key) return;
        try {
            localStorage.setItem(key, JSON.stringify(this.regions));
        } catch (e) {
            console.warn('Failed to save regions:', e);
        }
    }

    // Auto-load from localStorage
    _autoLoad() {
        this.regions = [];
        const key = this._storageKey();
        if (!key) return;
        try {
            const data = localStorage.getItem(key);
            if (data) {
                this.regions = JSON.parse(data);
            }
        } catch (e) {
            console.warn('Failed to load regions:', e);
        }
    }

    // Export to JSON
    exportJSON() {
        return JSON.stringify(this.regions, null, 2);
    }

    // Import from JSON
    importJSON(jsonStr, merge = false) {
        try {
            const arr = JSON.parse(jsonStr);
            if (!merge) this.regions = [];
            for (const r of arr) {
                this.regions.push(r);
            }
            this.regions.sort((a, b) => a.start - b.start);
            if (this.autoSaveEnabled) this._autoSave();
            return arr.length;
        } catch (e) {
            console.error('Failed to import regions:', e);
            return -1;
        }
    }
}
