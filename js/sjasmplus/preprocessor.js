// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Preprocessor - Handles conditionals, macros, repeats, structs, includes

import { ErrorCollector } from './errors.js';
import { parseExpression } from './expression.js';

export const Preprocessor = {
    macros: {},          // name -> { params, body, local }
    structs: {},         // name -> { fields, size }
    structStack: [],     // For nested struct definitions
    charset: null,       // Character mapping table
    ifStack: [],         // Conditional nesting: { active, wasActive, inElse }
    repeatStack: [],     // REPT/DUP nesting

    reset() {
        Preprocessor.macros = {};
        Preprocessor.structs = {};
        Preprocessor.structStack = [];
        Preprocessor.charset = null;
        Preprocessor.ifStack = [];
        Preprocessor.repeatStack = [];
    },

    // ==================== Conditionals ====================

    // Check if currently in active code section
    isActive() {
        if (this.ifStack.length === 0) return true;
        return this.ifStack.every(frame => frame.active);
    },

    // IF expr - assemble if expr is non-zero
    processIF(expr, symbols) {
        const parentActive = this.isActive();
        let active = false;

        if (parentActive) {
            const val = parseExpression(expr, symbols, 0, 0);
            // Treat undefined as 0 (matches sjasmplus behavior)
            // This allows conditional assembly to converge properly
            active = val.value !== 0;
        }

        this.ifStack.push({ active, wasActive: active, inElse: false });
    },

    // IFDEF symbol - assemble if symbol is defined
    processIFDEF(symbol, symbols) {
        const parentActive = this.isActive();
        const active = parentActive && (symbol in symbols) && !symbols[symbol].undefined;
        this.ifStack.push({ active, wasActive: active, inElse: false });
    },

    // IFNDEF symbol - assemble if symbol is not defined
    processIFNDEF(symbol, symbols) {
        const parentActive = this.isActive();
        const active = parentActive && (!(symbol in symbols) || symbols[symbol].undefined);
        this.ifStack.push({ active, wasActive: active, inElse: false });
    },

    // IFUSED symbol - assemble if symbol has been referenced
    processIFUSED(symbol, symbols) {
        const parentActive = this.isActive();
        const sym = symbols[symbol];
        const active = parentActive && sym && sym.used;
        this.ifStack.push({ active, wasActive: active, inElse: false });
    },

    // IFNUSED symbol - assemble if symbol has not been referenced
    processIFNUSED(symbol, symbols) {
        const parentActive = this.isActive();
        const sym = symbols[symbol];
        const active = parentActive && (!sym || !sym.used);
        this.ifStack.push({ active, wasActive: active, inElse: false });
    },

    // ELSE - toggle condition
    processELSE() {
        if (this.ifStack.length === 0) {
            ErrorCollector.error('ELSE without IF');
            return;
        }
        const frame = this.ifStack[this.ifStack.length - 1];
        if (frame.inElse) {
            ErrorCollector.error('Multiple ELSE clauses');
            return;
        }
        frame.inElse = true;
        // Only activate if parent is active and we haven't been active yet
        const parentActive = this.ifStack.length === 1 ||
            this.ifStack.slice(0, -1).every(f => f.active);
        frame.active = parentActive && !frame.wasActive;
    },

    // ELSEIF expr - else with new condition
    processELSEIF(expr, symbols) {
        if (this.ifStack.length === 0) {
            ErrorCollector.error('ELSEIF without IF');
            return;
        }
        const frame = this.ifStack[this.ifStack.length - 1];
        if (frame.inElse) {
            ErrorCollector.error('ELSEIF after ELSE');
            return;
        }

        const parentActive = this.ifStack.length === 1 ||
            this.ifStack.slice(0, -1).every(f => f.active);

        if (parentActive && !frame.wasActive) {
            const val = parseExpression(expr, symbols, 0, 0);
            // Treat undefined as 0 (matches sjasmplus behavior)
            frame.active = val.value !== 0;
            if (frame.active) frame.wasActive = true;
        } else {
            frame.active = false;
        }
    },

    // ENDIF - end conditional
    processENDIF() {
        if (this.ifStack.length === 0) {
            ErrorCollector.error('ENDIF without IF');
            return;
        }
        this.ifStack.pop();
    },

    // ==================== Macros ====================

    // Define a macro
    defineMacro(name, params, body) {
        const key = name.toUpperCase();
        Preprocessor.macros[key] = {
            params: params,
            body: body,
            local: []  // Local labels within macro
        };
    },

    // Check if identifier is a macro
    isMacro(name) {
        const key = name.toUpperCase();
        return key in Preprocessor.macros;
    },

    // Expand a macro call
    expandMacro(name, args, macroCount) {
        const key = name.toUpperCase();
        const macro = Preprocessor.macros[key];
        if (!macro) return null;

        let body = macro.body.slice();
        const localPrefix = `__macro_${macroCount}_`;

        // Substitute parameters (case-insensitive - sjasmplus treats params case-insensitively)
        for (let i = 0; i < macro.params.length; i++) {
            const param = macro.params[i];
            const arg = args[i] !== undefined ? args[i] : '';
            const regex = new RegExp('\\b' + param + '\\b', 'gi');  // Case-insensitive
            body = body.map(line => line.replace(regex, arg));
        }

        // Handle # (stringize) and ## (concatenate) operators
        body = body.map(line => {
            // ## concatenation - remove spaces around ##
            line = line.replace(/\s*##\s*/g, '');
            return line;
        });

        // Replace local labels with unique versions (but not inside strings)
        body = body.map(line => {
            // Split line into string and non-string parts
            const result = [];
            let inString = false;
            let stringChar = '';
            let current = '';

            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (!inString && (ch === '"' || ch === "'")) {
                    // Start of string - process current non-string part
                    if (current) {
                        result.push({ text: current.replace(/\.(\w+)/g, `.${localPrefix}$1`), isString: false });
                        current = '';
                    }
                    inString = true;
                    stringChar = ch;
                    current = ch;
                } else if (inString && ch === stringChar) {
                    // End of string - keep string unchanged
                    current += ch;
                    result.push({ text: current, isString: true });
                    current = '';
                    inString = false;
                } else {
                    current += ch;
                }
            }
            // Handle remaining text
            if (current) {
                if (inString) {
                    result.push({ text: current, isString: true });
                } else {
                    result.push({ text: current.replace(/\.(\w+)/g, `.${localPrefix}$1`), isString: false });
                }
            }

            return result.map(p => p.text).join('');
        });

        // Handle _NARG
        body = body.map(line => line.replace(/_NARG\b/g, args.length.toString()));

        return body;
    },

    // ==================== Repeats ====================

    // Start REPT block
    startREPT(count) {
        this.repeatStack.push({
            type: 'REPT',
            count: count,
            body: [],
            collecting: true
        });
    },

    // Start DUP block (alias for REPT)
    startDUP(count) {
        this.startREPT(count);
        this.repeatStack[this.repeatStack.length - 1].type = 'DUP';
    },

    // End REPT/DUP block and return expanded lines
    endREPT() {
        if (this.repeatStack.length === 0) {
            ErrorCollector.error('ENDR/EDUP without REPT/DUP');
            return [];
        }
        const block = this.repeatStack.pop();
        const result = [];
        for (let i = 0; i < block.count; i++) {
            result.push(...block.body);
        }
        return result;
    },

    // Check if collecting for REPT
    isCollectingRepeat() {
        return this.repeatStack.length > 0 &&
               this.repeatStack[this.repeatStack.length - 1].collecting;
    },

    // Add line to current REPT body
    addRepeatLine(line) {
        if (this.repeatStack.length > 0) {
            this.repeatStack[this.repeatStack.length - 1].body.push(line);
        }
    },

    // ==================== Structs ====================

    // Start STRUCT definition
    startSTRUCT(name) {
        this.structStack.push({
            name: name,
            fields: [],
            offset: 0
        });
    },

    // Add field to current struct
    addStructField(name, size, defaultValue) {
        if (this.structStack.length === 0) {
            ErrorCollector.error('Field outside STRUCT');
            return;
        }
        const struct = this.structStack[this.structStack.length - 1];
        struct.fields.push({
            name: name,
            offset: struct.offset,
            size: size,
            defaultValue: defaultValue  // Can be number, string, or array of bytes
        });
        struct.offset += size;
    },

    // End STRUCT definition
    endSTRUCT() {
        if (this.structStack.length === 0) {
            ErrorCollector.error('ENDS without STRUCT');
            return null;
        }
        const struct = this.structStack.pop();
        this.structs[struct.name] = {
            fields: struct.fields,
            size: struct.offset
        };
        return struct;
    },

    // Get struct by name
    getSTRUCT(name) {
        return this.structs[name] || null;
    },

    // Check if inside struct definition
    inSTRUCT() {
        return this.structStack.length > 0;
    },

    // ==================== Character Set ====================

    // Set character mapping
    setCHARSET(from, to, offset) {
        if (!this.charset) {
            // Initialize to identity mapping
            this.charset = new Array(256);
            for (let i = 0; i < 256; i++) {
                this.charset[i] = i;
            }
        }

        if (typeof from === 'string' && typeof to === 'string') {
            // Map character range
            const fromCode = from.charCodeAt(0);
            const toCode = to.charCodeAt(0);
            for (let i = fromCode; i <= toCode; i++) {
                this.charset[i] = offset + (i - fromCode);
            }
        } else if (typeof from === 'number') {
            // Map single character
            this.charset[from] = to;
        }
    },

    // Apply charset to string
    applyCharset(str) {
        const result = [];
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if (Preprocessor.charset && code < 256) {
                result.push(Preprocessor.charset[code]);
            } else {
                result.push(code);
            }
        }
        return result;
    },

    // Reset charset to default
    resetCHARSET() {
        this.charset = null;
    }
};
