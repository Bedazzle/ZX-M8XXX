/**
 * ZX-M8XXX - Comment Manager
 * Manages inline/before/after comments for disassembly addresses.
 * @license GPL-3.0
 */

// Lines 11088-11209 of index.html

export class CommentManager {
    constructor() {
        this.comments = new Map();  // Map<address, {before, inline, after, separator}>
        this.currentFile = null;
        this.autoSaveEnabled = true;
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

    // Clear all comments
    clear() {
        this.comments.clear();
        if (this.autoSaveEnabled) this._autoSave();
    }

    // Set current file for auto-save
    setCurrentFile(filename) {
        this.currentFile = filename;
        this._autoLoad();
    }

    _storageKey() {
        if (!this.currentFile) return null;
        return `zx_comments_${this.currentFile.toLowerCase()}`;
    }

    _autoSave() {
        const key = this._storageKey();
        if (!key) return;
        try {
            localStorage.setItem(key, JSON.stringify(this.getAll()));
        } catch (e) {
            console.warn('Failed to save comments:', e);
        }
    }

    _autoLoad() {
        this.comments.clear();
        const key = this._storageKey();
        if (!key) return;
        try {
            const data = localStorage.getItem(key);
            if (data) {
                const arr = JSON.parse(data);
                for (const c of arr) {
                    this.comments.set(c.address, {
                        before: c.before || '',
                        inline: c.inline || '',
                        after: c.after || '',
                        separator: c.separator || false
                    });
                }
            }
        } catch (e) {
            console.warn('Failed to load comments:', e);
        }
    }

    exportJSON() {
        return JSON.stringify(this.getAll(), null, 2);
    }

    importJSON(jsonStr, merge = false) {
        try {
            const arr = JSON.parse(jsonStr);
            if (!merge) this.comments.clear();
            for (const c of arr) {
                this.comments.set(c.address, {
                    before: c.before || '',
                    inline: c.inline || '',
                    after: c.after || '',
                    separator: c.separator || false
                });
            }
            if (this.autoSaveEnabled) this._autoSave();
            return arr.length;
        } catch (e) {
            console.error('Failed to import comments:', e);
            return -1;
        }
    }
}
