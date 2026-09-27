// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Expression parser - Evaluates arithmetic, bitwise, logical expressions

import { TokenType, Lexer } from './lexer.js';
import { ErrorCollector } from './errors.js';
import { SymbolTable } from './labels.js';

const ExpressionParser = {
    tokens: [],
    pos: 0,
    symbols: null,      // Symbol table for label resolution
    currentAddress: 0,  // $ value

    // What only the assembler knows, injected rather than imported so the parser
    // stays testable on its own:
    //   physical   the output address while inside DISP ($$$), null outside it
    //   pageOf(a)  the memory page address `a` falls in, via the DEVICE slot map
    //   readByte(a) reads assembled memory for {x} / {b x}, or null with no DEVICE
    ctx: null,

    // Parse and evaluate expression from tokens
    evaluate(tokens, symbols = {}, currentAddress = 0, ctx = null) {
        this.tokens = tokens;
        this.pos = 0;
        this.symbols = symbols;
        this.currentAddress = currentAddress;
        this.ctx = ctx;

        if (tokens.length === 0) {
            return { value: 0, undefined: true };
        }

        const result = this.parseLogicalOr();

        // Anything left over is junk after the expression ("LD A,1 2", "LD A,1)"),
        // which used to be dropped silently along with whatever it meant
        if (this.pos < this.tokens.length) {
            const token = this.tokens[this.pos];
            ErrorCollector.error(`Unexpected '${token.value}' after expression`);
        }

        return result;
    },

    peek(offset = 0) {
        const idx = this.pos + offset;
        return idx < this.tokens.length ? this.tokens[idx] : null;
    },

    advance() {
        return this.tokens[this.pos++];
    },

    check(type) {
        const token = this.peek();
        return token && token.type === type;
    },

    match(...types) {
        for (const type of types) {
            if (this.check(type)) {
                return this.advance();
            }
        }
        return null;
    },

    // sjasmplus spells the bitwise and shift operators in words as well as in
    // symbols — AND = &, OR = |, XOR = ^, MOD = %, SHL/SHR = <</>> (parser.cpp
    // needa()) — and native assemblers write them that way. Only in operator
    // position, where an identifier cannot be a label anyway, so a source that
    // does have a label called "or" still reads it as one everywhere else.
    matchWord(word) {
        const t = this.peek();
        if (t && t.type === TokenType.IDENTIFIER &&
            typeof t.value === 'string' && t.value.toUpperCase() === word) {
            return this.advance();
        }
        return null;
    },

    // Precedence levels (lowest to highest):
    // 1. || (logical or)
    // 2. && (logical and)
    // 3. | (bitwise or)
    // 4. ^ (bitwise xor)
    // 5. & (bitwise and)
    // 6. == != <> (equality)
    // 7. < > <= >= (comparison)
    // 8. << >> (shift)
    // 9. + - (additive)
    // 10. * / % (multiplicative)
    // 11. unary + - ~ ! high low (unary)
    // 12. ( ) (grouping), atoms

    parseLogicalOr() {
        let result = this.parseLogicalAnd();

        while (this.match(TokenType.OR)) {
            const right = this.parseLogicalAnd();
            if (result.undefined || right.undefined) {
                result = { value: 0, undefined: true };
            } else {
                result = { value: (result.value || right.value) ? 1 : 0, undefined: false };
            }
        }

        return result;
    },

    parseLogicalAnd() {
        let result = this.parseBitwiseOr();

        while (this.match(TokenType.AND)) {
            const right = this.parseBitwiseOr();
            if (result.undefined || right.undefined) {
                result = { value: 0, undefined: true };
            } else {
                result = { value: (result.value && right.value) ? 1 : 0, undefined: false };
            }
        }

        return result;
    },

    parseBitwiseOr() {
        let result = this.parseBitwiseXor();

        while (this.match(TokenType.PIPE) || this.matchWord('OR')) {
            const right = this.parseBitwiseXor();
            if (result.undefined || right.undefined) {
                result = { value: 0, undefined: true };
            } else {
                result = { value: (result.value | right.value) & 0xFFFFFFFF, undefined: false };
            }
        }

        return result;
    },

    parseBitwiseXor() {
        let result = this.parseBitwiseAnd();

        while (this.match(TokenType.CARET) || this.matchWord('XOR')) {
            const right = this.parseBitwiseAnd();
            if (result.undefined || right.undefined) {
                result = { value: 0, undefined: true };
            } else {
                result = { value: (result.value ^ right.value) & 0xFFFFFFFF, undefined: false };
            }
        }

        return result;
    },

    parseBitwiseAnd() {
        let result = this.parseEquality();

        while (this.match(TokenType.AMPERSAND) || this.matchWord('AND')) {
            const right = this.parseEquality();
            if (result.undefined || right.undefined) {
                result = { value: 0, undefined: true };
            } else {
                result = { value: (result.value & right.value) & 0xFFFFFFFF, undefined: false };
            }
        }

        return result;
    },

    parseEquality() {
        let result = this.parseComparison();

        while (true) {
            if (this.match(TokenType.EQ)) {
                const right = this.parseComparison();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: result.value === right.value ? 1 : 0, undefined: false };
                }
            } else if (this.match(TokenType.NE)) {
                const right = this.parseComparison();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: result.value !== right.value ? 1 : 0, undefined: false };
                }
            } else {
                break;
            }
        }

        return result;
    },

    parseComparison() {
        let result = this.parseShift();

        while (true) {
            if (this.match(TokenType.LT)) {
                const right = this.parseShift();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: result.value < right.value ? 1 : 0, undefined: false };
                }
            } else if (this.match(TokenType.GT)) {
                const right = this.parseShift();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: result.value > right.value ? 1 : 0, undefined: false };
                }
            } else if (this.match(TokenType.LE)) {
                const right = this.parseShift();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: result.value <= right.value ? 1 : 0, undefined: false };
                }
            } else if (this.match(TokenType.GE)) {
                const right = this.parseShift();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: result.value >= right.value ? 1 : 0, undefined: false };
                }
            } else {
                break;
            }
        }

        return result;
    },

    parseShift() {
        let result = this.parseAdditive();

        while (true) {
            if (this.match(TokenType.LSHIFT) || this.matchWord('SHL')) {
                const right = this.parseAdditive();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: (result.value << right.value) & 0xFFFFFFFF, undefined: false };
                }
            } else if (this.match(TokenType.RSHIFT) || this.matchWord('SHR')) {
                const right = this.parseAdditive();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: result.value >>> right.value, undefined: false };
                }
            } else {
                break;
            }
        }

        return result;
    },

    parseAdditive() {
        let result = this.parseMultiplicative();

        while (true) {
            if (this.match(TokenType.PLUS)) {
                const right = this.parseMultiplicative();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: (result.value + right.value) & 0xFFFFFFFF, undefined: false };
                }
            } else if (this.match(TokenType.MINUS)) {
                const right = this.parseMultiplicative();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: (result.value - right.value) & 0xFFFFFFFF, undefined: false };
                }
            } else {
                break;
            }
        }

        return result;
    },

    parseMultiplicative() {
        let result = this.parseUnary();

        while (true) {
            if (this.match(TokenType.STAR)) {
                const right = this.parseUnary();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    result = { value: (result.value * right.value) & 0xFFFFFFFF, undefined: false };
                }
            } else if (this.match(TokenType.SLASH)) {
                const right = this.parseUnary();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    if (right.value === 0) {
                        ErrorCollector.error('Division by zero');
                    }
                    result = { value: Math.floor(result.value / right.value), undefined: false };
                }
            } else if (this.match(TokenType.PERCENT) || this.matchWord('MOD')) {
                const right = this.parseUnary();
                if (result.undefined || right.undefined) {
                    result = { value: 0, undefined: true };
                } else {
                    if (right.value === 0) {
                        ErrorCollector.error('Division by zero');
                    }
                    result = { value: result.value % right.value, undefined: false };
                }
            } else {
                break;
            }
        }

        return result;
    },

    parseUnary() {
        // Unary operators: + - ~ !
        if (this.match(TokenType.PLUS)) {
            return this.parseUnary();
        }

        if (this.match(TokenType.MINUS)) {
            const result = this.parseUnary();
            if (result.undefined) {
                return { value: 0, undefined: true };
            }
            return { value: (-result.value) & 0xFFFFFFFF, undefined: false };
        }

        if (this.match(TokenType.TILDE)) {
            const result = this.parseUnary();
            if (result.undefined) {
                return { value: 0, undefined: true };
            }
            return { value: (~result.value) & 0xFFFFFFFF, undefined: false };
        }

        if (this.match(TokenType.BANG)) {
            const result = this.parseUnary();
            if (result.undefined) {
                return { value: 0, undefined: true };
            }
            return { value: result.value === 0 ? 1 : 0, undefined: false };
        }

        // Check for function-like operators: high(), low(), etc.
        const token = this.peek();
        if (token && token.type === TokenType.IDENTIFIER) {
            const name = token.value.toUpperCase();
            if (name === 'HIGH' || name === 'LOW' || name === 'NOT' || 
                name === 'ABS' || name === 'DEFINED') {
                this.advance();
                
                // Parentheses are optional for these functions
                const hasParen = this.match(TokenType.LPAREN);
                
                // With parens: parse full expression; without: parse just the next term
                const arg = hasParen ? this.parseLogicalOr() : this.parseUnary();
                
                if (hasParen && !this.match(TokenType.RPAREN)) {
                    ErrorCollector.error(`Expected ')' after ${name} argument`);
                }

                if (name === 'DEFINED') {
                    // Special case: returns 1 if defined, 0 if not
                    return { value: arg.undefined ? 0 : 1, undefined: false };
                }

                if (arg.undefined) {
                    return { value: 0, undefined: true };
                }

                switch (name) {
                    case 'HIGH':
                        return { value: (arg.value >> 8) & 0xFF, undefined: false };
                    case 'LOW':
                        return { value: arg.value & 0xFF, undefined: false };
                    case 'NOT':
                        return { value: arg.value === 0 ? 1 : 0, undefined: false };
                    case 'ABS':
                        return { value: Math.abs(arg.value), undefined: false };
                }
            }
        }

        return this.parsePrimary();
    },

    parsePrimary() {
        // Parentheses
        if (this.match(TokenType.LPAREN)) {
            const result = this.parseLogicalOr();
            if (!this.match(TokenType.RPAREN)) {
                ErrorCollector.error("Expected ')'");
            }
            return result;
        }

        // Number literal
        if (this.check(TokenType.NUMBER)) {
            const token = this.advance();
            return { value: token.value, undefined: false };
        }

        // String literal (converts to numeric value)
        // sjasmplus ordering: first char is HIGH byte, subsequent chars are lower bytes
        // 1 char: char code
        // 2 chars: first_char * 256 + second_char  
        // 3+ chars: big-endian style (first char highest significance)
        if (this.check(TokenType.STRING)) {
            const token = this.advance();
            const str = token.value;
            let value = 0;
            for (let i = 0; i < str.length && i < 4; i++) {
                value = (value << 8) | str.charCodeAt(i);
            }
            return { value, undefined: false };
        }

        // $ - current address
        if (this.match(TokenType.DOLLAR)) {
            return { value: this.currentAddress, undefined: false };
        }

        // {x} reads a WORD out of the assembled image, {b x} a BYTE. Only
        // meaningful in virtual device mode -- with no DEVICE there is no image to
        // read, and a braced operand there is the legacy STRUCT wrapper instead
        // (see Assembler.evaluate), so this primary is never reached.
        if (this.check(TokenType.LBRACE) && this.ctx && this.ctx.readByte) {
            this.advance();
            let size = 2;
            const t = this.peek();
            // "b" is the size keyword only when something follows it: {b} on its
            // own is a word read of a label called b.
            if (t && t.type === TokenType.IDENTIFIER && /^b$/i.test(t.value) &&
                this.peek(1) && this.peek(1).type !== TokenType.RBRACE) {
                this.advance();
                size = 1;
            }
            const addr = this.parseLogicalOr();
            if (!this.match(TokenType.RBRACE)) {
                ErrorCollector.error("Expected '}'");
            }
            if (addr.undefined) {
                return { value: 0, undefined: true, symbol: addr.symbol };
            }
            const a = addr.value & 0xFFFF;
            const read = this.ctx.readByte;
            const value = size === 1
                ? read(a) & 0xFF
                : ((read(a) & 0xFF) | ((read((a + 1) & 0xFFFF) & 0xFF) << 8));
            return { value, undefined: false };
        }

        // Identifier - label or symbol
        if (this.check(TokenType.IDENTIFIER)) {
            const token = this.advance();
            let name = token.value;

            // Handle compound identifiers like STRUCT.FIELD or MODULE.LABEL or SLOT.1
            while (this.match(TokenType.DOT)) {
                if (this.check(TokenType.IDENTIFIER)) {
                    name += '.' + this.advance().value;
                } else if (this.check(TokenType.NUMBER)) {
                    // Handle SLOT.1, ALIEN.2 etc.
                    name += '.' + this.advance().value;
                } else {
                    break;
                }
            }

            // sjasmplus sigils: $$ page, $$$ physical address, $$$$ physical page.
            // The lexer glues any following name on, so this is one token.
            let sigil = 0;
            if (name.charCodeAt(0) === 36 /* $ */) {
                const m = /^(\$+)([\s\S]*)$/.exec(name);
                sigil = m[1].length;
                name = m[2];
                if (name === '') {
                    // $$ is to $ what $$lab is to lab, so it goes through the same
                    // applySigil as the rest. Until v1.0.0 it meant the last ORG
                    // instead -- NASM's "section start", which this engine inherited
                    // from the standalone sjasmplus-js it grew out of.
                    if (sigil === 2) {
                        return { value: this.applySigil(2, this.currentAddress, this.currentAddress),
                                 undefined: false };
                    }
                    // $$$ / $$$$ -- the address the bytes are really going to, and
                    // its page. Outside DISP that is just the program counter.
                    const phys = (this.ctx && this.ctx.physical != null)
                        ? this.ctx.physical : this.currentAddress;
                    return { value: this.applySigil(sigil, phys & 0xFFFF, phys & 0xFFFF), undefined: false };
                }
            }

            // Handle @ prefix (absolute reference - skip module prefix)
            let isAbsolute = false;
            if (name.startsWith('@') && name.length > 1) {
                name = name.slice(1);
                isAbsolute = true;
            }

            if (sigil) {
                const sym = this.resolveName(name, isAbsolute, token);
                if (sym.undefined) return sym;
                const phys = (sym.physical != null) ? sym.physical : sym.value;
                return { value: this.applySigil(sigil, sym.value, phys), undefined: false };
            }
            return this.resolveName(name, isAbsolute, token);
        }

        // If we get here, unexpected token — or nothing at all, which means the
        // expression stopped mid-way ("LD A,1+") and must not evaluate to 0
        const token = this.peek();
        if (token) {
            ErrorCollector.error(`Unexpected token: ${token.type} (${token.value})`);
        } else {
            ErrorCollector.error('Incomplete expression');
        }

        return { value: 0, undefined: true };
    },

    // $$name -> page of the logical address, $$$name -> the physical address,
    // $$$$name -> page of the physical address. Both pages go through the DEVICE
    // slot map; with no device there are no pages, so 0.
    applySigil(sigil, logical, physical) {
        if (sigil === 3) return physical & 0xFFFF;
        // Every page form is virtual-device-only: with no DEVICE there is no slot
        // map and so no page to name. Say so rather than answering 0 -- returning a
        // plausible number for a question that has no answer is how the old $$ went
        // sixty releases without anyone noticing what it meant.
        if (!this.ctx || !this.ctx.pageOf) {
            ErrorCollector.error('Memory pages need a DEVICE (use DEVICE ZXSPECTRUM128 or similar)');
            return 0;
        }
        return this.ctx.pageOf(sigil === 2 ? logical : physical) & 0xFF;
    },

    // The symbol lookup, split out so a sigil can wrap it without duplicating the
    // module/local/forward-reference walk below.
    resolveName(name, isAbsolute, token) {
        // Check for temp label reference (1B, 1F, 2B, 2F, etc.)
        const tempMatch = /^(\d+)([BF])$/i.exec(name);
        if (tempMatch) {
            const result = SymbolTable.parseTemp(name, this.currentAddress, token.line);
            if (result) {
                return result;
            }
            return { value: 0, undefined: true };
        }

        // Resolve via module scope: innermost MODULE prefix → outer → global
        // (depth 0 = the raw name, i.e. global or an already-qualified name).
        // A module-local symbol shadows an outer/global one of the same name
        // (matching sjasmplus). Undefined forward-reference placeholders are
        // skipped so the walk keeps looking outward for a DEFINED symbol; a
        // genuine forward ref (only placeholders exist) stays undefined.
        // @-absolute and .local names skip the prefix walk.
        if (this.symbols) {
            const mods = (!isAbsolute && !name.startsWith('.') &&
                typeof SymbolTable !== 'undefined' && SymbolTable.modules) ? SymbolTable.modules : [];
            let pendingUndef = null;
            for (let depth = mods.length; depth >= 0; depth--) {
                const fn = (depth > 0 ? mods.slice(0, depth).join('.') + '.' : '') + name;
                if (!(fn in this.symbols)) continue;
                const sym = this.symbols[fn];
                const isUndef = (typeof sym === 'object') && (sym.undefined || false);
                if (isUndef) { if (pendingUndef === null) pendingUndef = fn; continue; }
                if (typeof SymbolTable !== 'undefined' && SymbolTable.symbols && SymbolTable.symbols[fn]) {
                    SymbolTable.symbols[fn].used = true;
                }
                return (typeof sym === 'object')
                    ? { value: sym.value, undefined: false, physical: sym.physical }
                    : { value: sym, undefined: false };
            }
            if (pendingUndef !== null) {
                if (typeof SymbolTable !== 'undefined' && SymbolTable.symbols && SymbolTable.symbols[pendingUndef]) {
                    SymbolTable.symbols[pendingUndef].used = true;
                }
                return { value: 0, undefined: true, symbol: name };
            }
        }

        // For local labels (starting with . only), try resolving with local prefix
        if (name.startsWith('.') &&
            typeof SymbolTable !== 'undefined' && SymbolTable.localPrefix) {
            const fullName = SymbolTable.localPrefix + name;
            if (this.symbols && fullName in this.symbols) {
                const sym = this.symbols[fullName];
                // Mark as used in the actual SymbolTable
                if (SymbolTable.symbols && SymbolTable.symbols[fullName]) {
                    SymbolTable.symbols[fullName].used = true;
                }
                if (typeof sym === 'object') {
                    return { value: sym.value, undefined: sym.undefined || false, physical: sym.physical };
                }
                return { value: sym, undefined: false };
            }
        }

        // Undefined symbol — register as forward reference so checkUndefined() can catch it
        SymbolTable.reference(name, ErrorCollector.currentLine, ErrorCollector.currentFile);
        return { value: 0, undefined: true, symbol: name };
    }
};

// Helper function to parse expression from source string
export function parseExpression(source, symbols = {}, currentAddress = 0, ctx = null) {
    const lexer = new Lexer(source);
    const tokens = lexer.tokenize().filter(t =>
        t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF
    );
    return ExpressionParser.evaluate(tokens, symbols, currentAddress, ctx);
}

