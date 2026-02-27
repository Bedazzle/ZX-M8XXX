/**
 * ZX-M8XXX - Label Manager
 * Manages user and ROM labels for the disassembler.
 * @license GPL-3.0
 */

// Lines 10736-10911 of index.html

export class LabelManager {
    constructor() {
        this.labels = new Map();  // key = "page:address", value = label object
        this.romLabels = new Map(); // ROM labels loaded from file
        this.showRomLabels = true;
        this.currentFile = null;
        this.autoSaveEnabled = true;
    }

    // Generate key for label lookup
    _key(address, page = null) {
        const pageStr = page === null ? 'g' : page.toString();
        return `${pageStr}:${address.toString(16).padStart(4, '0')}`;
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

    // Clear all labels
    clear() {
        this.labels.clear();
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
        return `zx_labels_${this.currentFile.toLowerCase()}`;
    }

    // Auto-save to localStorage
    _autoSave() {
        const key = this._storageKey();
        if (!key) return;
        const data = JSON.stringify(Array.from(this.labels.values()));
        try {
            localStorage.setItem(key, data);
        } catch (e) {
            console.warn('Failed to save labels:', e);
        }
    }

    // Auto-load from localStorage
    _autoLoad() {
        this.labels.clear();
        const key = this._storageKey();
        if (!key) return;
        try {
            const data = localStorage.getItem(key);
            if (data) {
                const arr = JSON.parse(data);
                for (const label of arr) {
                    this.labels.set(this._key(label.address, label.page), label);
                }
            }
        } catch (e) {
            console.warn('Failed to load labels:', e);
        }
    }

    // Export labels to JSON string
    exportJSON() {
        return JSON.stringify(Array.from(this.labels.values()), null, 2);
    }

    // Import labels from JSON string
    importJSON(jsonStr, merge = false) {
        try {
            const arr = JSON.parse(jsonStr);
            if (!merge) this.labels.clear();
            for (const label of arr) {
                this.labels.set(this._key(label.address, label.page), label);
            }
            if (this.autoSaveEnabled) this._autoSave();
            return arr.length;
        } catch (e) {
            console.error('Failed to import labels:', e);
            return -1;
        }
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
