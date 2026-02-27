// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Labels and Symbol Table - Handles global, local, temporary labels and modules

import { ErrorCollector } from './errors.js';

export const SymbolTable = {
    symbols: {},           // Global symbols: name -> { value, type, defined, used, line, file }
    modules: [],           // Module stack for MODULE/ENDMODULE
    localPrefix: '',       // Current label prefix for local labels
    tempLabels: {},        // Temporary labels: number -> [{ addr, line, defOrder }]
    tempLabelCounters: {}, // For generating unique temp label references
    tempDefOrder: 0,       // Global counter for temp label definition order
    tempRefOrder: 0,       // Current reference point in definition order

    reset() {
        this.symbols = {};
        this.modules = [];
        this.localPrefix = '';
        this.tempLabels = {};
        this.prevTempLabels = {};
        this.tempLabelCounters = {};
        this.tempDefOrder = 0;
        this.tempRefOrder = 0;
    },

    // Get current module prefix
    getModulePrefix() {
        return this.modules.length > 0 ? this.modules.join('.') + '.' : '';
    },

    // Get full name with module prefix
    getFullName(name) {
        // Absolute reference (starts with @)
        if (name.startsWith('@') && name.length > 1 && !/^\d/.test(name[1])) {
            return name.slice(1);
        }
        // Local label (starts with . only - underscore labels are global)
        if (name.startsWith('.') && this.localPrefix) {
            return this.localPrefix + name;
        }
        // Regular label - add module prefix
        return this.getModulePrefix() + name;
    },

    // Define a label
    define(name, value, line = null, file = null, type = 'label') {
        const fullName = this.getFullName(name);

        // Check for redefinition (unless it's a pass update for same label)
        if (fullName in this.symbols && this.symbols[fullName].defined && type !== 'equ') {
            // Allow redefinition during multi-pass if it's the same location
            if (this.symbols[fullName].line !== line || this.symbols[fullName].file !== file) {
                // Different location - real redefinition error
                // But during assembly passes, we update values, so check type
                if (this.symbols[fullName].type === 'label' && type === 'label') {
                    // Same label being updated in a new pass - allow it
                } else {
                    ErrorCollector.error(`Symbol '${name}' already defined`, line, file);
                }
            }
        }

        this.symbols[fullName] = {
            value: value,
            type: type,
            defined: true,
            used: this.symbols[fullName]?.used || false,
            line: line,
            file: file
        };

        // Update local prefix for non-local labels (. prefixed are local)
        if (!name.startsWith('.') && type === 'label') {
            this.localPrefix = fullName;
        }

        return fullName;
    },

    // Reference a label (may be forward reference)
    reference(name, line = null, file = null) {
        const fullName = this.getFullName(name);

        if (fullName in this.symbols) {
            this.symbols[fullName].used = true;
            return this.symbols[fullName];
        }

        // Forward reference - create undefined entry
        this.symbols[fullName] = {
            value: 0,
            type: 'label',
            defined: false,
            used: true,
            line: line,
            file: file
        };

        return this.symbols[fullName];
    },

    // Get symbol value
    getValue(name) {
        // Check for built-in variables first
        const upper = name.toUpperCase();
        if (upper === '_ERRORS') {
            return { value: ErrorCollector.errorCount, undefined: false };
        }
        if (upper === '_WARNINGS') {
            return { value: ErrorCollector.warnings.length, undefined: false };
        }

        const fullName = this.getFullName(name);
        if (fullName in this.symbols) {
            return {
                value: this.symbols[fullName].value,
                undefined: !this.symbols[fullName].defined
            };
        }
        return { value: 0, undefined: true };
    },

    // Check if symbol is defined
    isDefined(name) {
        // Built-in variables are always defined
        const upper = name.toUpperCase();
        if (upper === '_ERRORS' || upper === '_WARNINGS') {
            return true;
        }

        const fullName = this.getFullName(name);
        return fullName in this.symbols && this.symbols[fullName].defined;
    },

    // Enter a module
    enterModule(name) {
        this.modules.push(name);
    },

    // Exit a module
    exitModule() {
        if (this.modules.length === 0) {
            ErrorCollector.error('ENDMODULE without MODULE');
        }
        this.modules.pop();
    },

    // Define temporary label (numeric: 1:, 2:, etc.)
    defineTemp(num, addr, line = null) {
        if (!(num in this.tempLabels)) {
            this.tempLabels[num] = [];
        }
        this.tempLabels[num].push({ addr, line, defOrder: this.tempDefOrder });
        this.tempDefOrder++;
    },

    // Reference temporary label forward (1F, 2F, etc.)
    // Finds the NEXT temp label that will be defined after our current position
    refTempForward(num, currentAddr, line = null) {
        // Check current pass labels - find first one defined after our current position
        const labels = this.tempLabels[num] || [];

        // Current position is indicated by how many temp labels we've defined so far
        const currentPos = this.tempDefOrder;

        // Look for the first label with defOrder >= currentPos (next to be defined or already defined after us)
        for (const label of labels) {
            if (label.defOrder >= currentPos) {
                return { value: label.addr, undefined: false };
            }
        }

        // Check previous pass labels - these have complete definition order info
        const prevLabels = (this.prevTempLabels && this.prevTempLabels[num]) || [];
        for (const label of prevLabels) {
            if (label.defOrder >= currentPos) {
                return { value: label.addr, undefined: false };
            }
        }

        // Not found yet - forward reference
        return { value: 0, undefined: true };
    },

    // Reference temporary label backward (1B, 2B, etc.)
    // Finds the most recent temp label defined BEFORE our current position
    refTempBackward(num, currentAddr, line = null) {
        const labels = this.tempLabels[num] || [];

        // Current position is indicated by how many temp labels we've defined so far
        const currentPos = this.tempDefOrder;

        // Find most recent label defined before current position
        let found = null;
        for (const label of labels) {
            if (label.defOrder < currentPos) {
                found = label;
            }
        }
        if (found) {
            return { value: found.addr, undefined: false };
        }
        ErrorCollector.error(`Backward reference ${num}B not found`, line);
    },

    // Parse temporary label reference (1B, 1F, etc.)
    parseTemp(name, currentAddr, line) {
        const match = /^(\d+)([BF])$/i.exec(name);
        if (!match) return null;

        const num = parseInt(match[1]);
        const dir = match[2].toUpperCase();

        if (dir === 'B') {
            return this.refTempBackward(num, currentAddr, line);
        } else {
            return this.refTempForward(num, currentAddr, line);
        }
    },

    // Check for undefined symbols (for final pass)
    checkUndefined() {
        const undefined = [];
        const syms = this.symbols || {};
        for (const name in syms) {
            const sym = syms[name];
            if (!sym.defined && sym.used) {
                undefined.push({ name, line: sym.line, file: sym.file });
            }
        }
        return undefined;
    },

    // Check for unused symbols (for warnings)
    checkUnused() {
        const unused = [];
        const syms = this.symbols || {};
        for (const name in syms) {
            const sym = syms[name];
            if (sym && sym.defined && !sym.used && sym.type === 'label') {
                unused.push({ name, line: sym.line, file: sym.file });
            }
        }
        return unused;
    },

    // Export symbol table for listing/debugging
    export() {
        const result = [];
        const syms = this.symbols || {};
        for (const name in syms) {
            const sym = syms[name];
            if (sym && sym.defined) {
                result.push({
                    name,
                    value: sym.value,
                    type: sym.type,
                    hex: sym.value.toString(16).toUpperCase().padStart(4, '0')
                });
            }
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    },

    // Export as simple object for expression evaluation
    toObject() {
        const obj = {};
        const syms = this.symbols || {};
        for (const name in syms) {
            const sym = syms[name];
            if (sym) {
                obj[name] = {
                    value: sym.value,
                    undefined: !sym.defined
                };
            }
        }
        // Add built-in variables
        obj['_ERRORS'] = { value: ErrorCollector.errorCount || 0, undefined: false };
        obj['_WARNINGS'] = { value: (ErrorCollector.warnings || []).length, undefined: false };
        return obj;
    }
};

// EQU values (can be set and are constant)
export const EquTable = {
    values: {},

    reset() {
        this.values = {};
    },

    define(name, value, line, file) {
        const vals = this.values || {};
        this.values = vals;
        const fullName = SymbolTable.getFullName(name);
        if (fullName in vals) {
            // Allow redefinition only if value is the same
            if (vals[fullName] !== value) {
                ErrorCollector.error(`EQU '${name}' redefined with different value`, line, file);
            }
        }
        vals[fullName] = value;
        // Also add to symbol table
        const syms = SymbolTable.symbols || {};
        SymbolTable.symbols = syms;
        syms[fullName] = {
            value: value,
            type: 'equ',
            defined: true,
            used: false,
            line: line,
            file: file
        };
    },

    getValue(name) {
        const vals = this.values || {};
        const fullName = SymbolTable.getFullName(name);
        if (fullName in vals) {
            return { value: vals[fullName], undefined: false };
        }
        return null;
    }
};
