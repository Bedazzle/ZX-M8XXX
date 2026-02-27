// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Lexer - Tokenizes Z80 assembly source code

import { ErrorCollector } from './errors.js';

export const TokenType = {
    // Identifiers and literals
    IDENTIFIER: 'IDENTIFIER',       // label, instruction, register
    NUMBER: 'NUMBER',               // numeric literal
    STRING: 'STRING',               // "string" or 'string'

    // Operators
    PLUS: 'PLUS',                   // +
    MINUS: 'MINUS',                 // -
    STAR: 'STAR',                   // *
    SLASH: 'SLASH',                 // /
    PERCENT: 'PERCENT',             // %
    AMPERSAND: 'AMPERSAND',         // &
    PIPE: 'PIPE',                   // |
    CARET: 'CARET',                 // ^
    TILDE: 'TILDE',                 // ~
    LSHIFT: 'LSHIFT',               // <<
    RSHIFT: 'RSHIFT',               // >>
    EQ: 'EQ',                       // = or ==
    NE: 'NE',                       // != or <>
    LT: 'LT',                       // <
    GT: 'GT',                       // >
    LE: 'LE',                       // <=
    GE: 'GE',                       // >=
    BANG: 'BANG',                   // !
    AND: 'AND',                     // &&
    OR: 'OR',                       // ||

    // Punctuation
    LPAREN: 'LPAREN',               // (
    RPAREN: 'RPAREN',               // )
    LBRACKET: 'LBRACKET',           // [
    RBRACKET: 'RBRACKET',           // ]
    COMMA: 'COMMA',                 // ,
    COLON: 'COLON',                 // :
    DOT: 'DOT',                     // .
    HASH: 'HASH',                   // #
    DOLLAR: 'DOLLAR',               // $
    QUESTION: 'QUESTION',           // ?
    AT: 'AT',                       // @
    BACKSLASH: 'BACKSLASH',         // \

    // Special
    NEWLINE: 'NEWLINE',
    EOF: 'EOF',

    // Macro operators
    HASH_HASH: 'HASH_HASH',         // ##
};

export class Token {
    constructor(type, value, line, column) {
        this.type = type;
        this.value = value;
        this.line = line;
        this.column = column;
    }
}

export class Lexer {
    constructor(source, filename = '<input>') {
        this.source = source || '';
        this.filename = filename;
        this.pos = 0;
        this.line = 1;
        this.column = 1;
        this.lineStart = 0;
        this.lastComment = '';
        this.lineComments = {};  // Store comments by line number
    }

    peek(offset = 0) {
        const idx = this.pos + offset;
        return idx < this.source.length ? this.source[idx] : '\0';
    }

    advance() {
        const ch = this.source[this.pos++];
        if (ch === '\n') {
            this.line++;
            this.column = 1;
            this.lineStart = this.pos;
        } else {
            this.column++;
        }
        return ch;
    }

    skipWhitespace() {
        while (this.pos < this.source.length) {
            const ch = this.peek();
            if (ch === ' ' || ch === '\t' || ch === '\r') {
                this.advance();
            } else if (ch === '\\' && this.peek(1) === '\n') {
                // Line continuation
                this.advance();
                this.advance();
            } else {
                break;
            }
        }
    }

    skipComment() {
        // ; comment or // comment
        if (this.peek() === ';' || (this.peek() === '/' && this.peek(1) === '/')) {
            const startPos = this.pos;
            const lineNum = this.line;
            while (this.pos < this.source.length && this.peek() !== '\n') {
                this.advance();
            }
            // Store the comment text for the current line
            this.lastComment = this.source.slice(startPos, this.pos);
            this.lineComments[lineNum] = this.lastComment;
            return true;
        }
        // /* block comment */
        if (this.peek() === '/' && this.peek(1) === '*') {
            this.advance();
            this.advance();
            while (this.pos < this.source.length) {
                if (this.peek() === '*' && this.peek(1) === '/') {
                    this.advance();
                    this.advance();
                    break;
                }
                this.advance();
            }
            return true;
        }
        return false;
    }

    readNumber() {
        const startLine = this.line;
        const startCol = this.column;
        let value = 0;
        let str = '';

        // Check for hex prefixes: $, #, 0x
        if (this.peek() === '$' || this.peek() === '#') {
            this.advance();
            str = this.readHexDigits();
            if (str.length === 0) {
                ErrorCollector.error('Expected hex digits', this.line, this.filename);
            }
            value = parseInt(str, 16);
        } else if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
            this.advance();
            this.advance();
            str = this.readHexDigits();
            if (str.length === 0) {
                ErrorCollector.error('Expected hex digits', this.line, this.filename);
            }
            value = parseInt(str, 16);
        } else if (this.peek() === '%') {
            // Binary: %01010101
            this.advance();
            str = this.readBinaryDigits();
            if (str.length === 0) {
                ErrorCollector.error('Expected binary digits', this.line, this.filename);
            }
            value = parseInt(str, 2);
        } else if (this.peek() === '0' && (this.peek(1) === 'b' || this.peek(1) === 'B')) {
            // Could be binary 0b01010101 OR hex like 0Bh/0BAh OR temp label like 0B
            let lookahead = 2;
            while (/[0-9a-fA-F_]/.test(this.peek(lookahead))) {
                lookahead++;
            }
            const endChar = this.peek(lookahead);

            if (endChar === 'h' || endChar === 'H') {
                // It's hex with H suffix (like 0Bh or 0BAh)
                str = this.readAlphanumeric();
                const parsed = this.parseNumberWithSuffix(str);
                if (parsed !== null) {
                    value = parsed;
                } else {
                    ErrorCollector.error('Invalid number format', this.line, this.filename);
                }
            } else if (/[01_]/.test(this.peek(2))) {
                // Has binary digits after 0b, so it's binary: 0b01010101 or 0b0101_0101
                this.advance();
                this.advance();
                str = this.readBinaryDigits();
                if (str.length === 0) {
                    ErrorCollector.error('Expected binary digits', this.line, this.filename);
                }
                value = parseInt(str, 2);
            } else {
                // No binary digits after 0B - treat as alphanumeric (could be temp label 0B)
                str = this.readAlphanumeric();
                const parsed = this.parseNumberWithSuffix(str);
                if (parsed === null) {
                    return new Token(TokenType.IDENTIFIER, str, startLine, startCol);
                }
                value = parsed;
            }
        } else {
            // Decimal, hex with H suffix, binary with B suffix, etc.
            // Save position in case we need to backtrack
            const savedPos = this.pos;
            const savedCol = this.column;

            str = this.readAlphanumeric();
            const parsed = this.parseNumberWithSuffix(str);

            if (parsed === null) {
                // This is a temp label reference (1B, 1F, etc.), treat as identifier
                return new Token(TokenType.IDENTIFIER, str, startLine, startCol);
            }

            value = parsed;
        }

        return new Token(TokenType.NUMBER, value, startLine, startCol);
    }

    readHexDigits() {
        let str = '';
        while (/[0-9a-fA-F_]/.test(this.peek())) {
            const c = this.advance();
            if (c !== '_') str += c;  // Skip underscores in result
        }
        return str;
    }

    readBinaryDigits() {
        let str = '';
        while (this.peek() === '0' || this.peek() === '1' || this.peek() === '_') {
            const c = this.advance();
            if (c !== '_') str += c;  // Skip underscores in result
        }
        return str;
    }

    readAlphanumeric() {
        // Read digits, letters, and underscores for suffix-based number detection
        let str = '';
        while (/[0-9a-zA-Z_]/.test(this.peek())) {
            str += this.advance();
        }
        return str;
    }

    parseNumberWithSuffix(str) {
        // Strip underscores (thousand separators) for parsing
        const cleanStr = str.replace(/_/g, '');

        // Check for temp label reference: 1B, 1F, 10F, 99B, etc.
        // These are numeric labels followed by B (backward) or F (forward)
        // Must distinguish from binary numbers (10101010B) which only contain 0 and 1
        const upper = cleanStr.toUpperCase();
        if (upper.endsWith('F')) {
            // xF is always a temp label (can't be binary or hex suffix)
            const num = cleanStr.slice(0, -1);
            if (/^\d+$/.test(num)) {
                return null; // Signal to treat as identifier
            }
        }
        if (upper.endsWith('B')) {
            const num = cleanStr.slice(0, -1);
            // Temp label conditions:
            // 1. Single digit (0B, 1B, 2B, etc.) - always temp label
            // 2. Two digits (10B, 99B, etc.) - always temp label (binary is rarely 2 digits)
            // 3. Any length with non-binary digit (123B) - temp label
            // Binary condition: 3+ digits AND all 0/1
            if (/^\d+$/.test(num)) {
                if (num.length <= 2 || /[2-9]/.test(num)) {
                    return null; // Temp label
                }
            }
        }

        // Check suffix and parse accordingly

        // Hex suffix: 0FFH
        if (upper.endsWith('H')) {
            const hex = cleanStr.slice(0, -1);
            if (/^[0-9][0-9a-fA-F]*$/.test(hex)) {
                return parseInt(hex, 16);
            }
        }

        // Binary suffix: 10101010B (must have 3+ digits AND all 0/1)
        // 1-2 digit numbers ending in B are temp labels instead
        if (upper.endsWith('B')) {
            const bin = cleanStr.slice(0, -1);
            if (/^[01]+$/.test(bin) && bin.length >= 3) {
                return parseInt(bin, 2);
            }
        }

        // Octal suffix: 77O or 77Q
        if (upper.endsWith('O') || upper.endsWith('Q')) {
            const oct = cleanStr.slice(0, -1);
            if (/^[0-7]+$/.test(oct)) {
                return parseInt(oct, 8);
            }
        }

        // Decimal suffix: 123D
        if (upper.endsWith('D')) {
            const dec = cleanStr.slice(0, -1);
            if (/^[0-9]+$/.test(dec)) {
                return parseInt(dec, 10);
            }
        }

        // Plain decimal
        if (/^[0-9]+$/.test(cleanStr)) {
            return parseInt(cleanStr, 10);
        }

        // Invalid number
        ErrorCollector.error(`Invalid number: ${str}`, this.line, this.filename);
    }

    readString(quote) {
        const startLine = this.line;
        const startCol = this.column;
        this.advance(); // consume opening quote
        let value = '';

        while (this.pos < this.source.length && this.peek() !== quote && this.peek() !== '\n') {
            if (this.peek() === '\\') {
                const next = this.peek(1);

                // Special case: '\' where backslash is the ONLY character in a single-char string
                // This handles: cp '\' which means backslash character
                // Only applies when string is empty so far and next char is closing quote
                if (value === '' && next === quote) {
                    const afterQuote = this.peek(2);
                    // If nothing meaningful after the quote, treat backslash as literal
                    if (afterQuote === '\n' || afterQuote === '\0' || afterQuote === ' ' ||
                        afterQuote === '\t' || afterQuote === ',' || afterQuote === ';' ||
                        afterQuote === ')' || afterQuote === undefined || this.pos + 2 >= this.source.length) {
                        value += this.advance(); // add backslash literally
                        continue;
                    }
                }

                // Normal escape sequence handling
                this.advance(); // consume backslash
                const escaped = this.peek();
                switch (escaped) {
                    case 'n': value += '\n'; this.advance(); break;
                    case 'r': value += '\r'; this.advance(); break;
                    case 't': value += '\t'; this.advance(); break;
                    case '0': value += '\0'; this.advance(); break;
                    case '\\': value += '\\'; this.advance(); break;
                    case '"': value += '"'; this.advance(); break;
                    case "'": value += "'"; this.advance(); break;
                    default:
                        // Unknown escape - output backslash + character literally
                        value += '\\' + escaped;
                        this.advance();
                        break;
                }
            } else {
                value += this.advance();
            }
        }

        if (this.peek() === quote) {
            this.advance(); // consume closing quote
        } else {
            ErrorCollector.error('Unterminated string', startLine, this.filename);
        }

        return new Token(TokenType.STRING, value, startLine, startCol);
    }

    readIdentifier() {
        const startLine = this.line;
        const startCol = this.column;
        let value = '';

        // First char: letter, underscore, dot (for local labels), or @ (for temporary labels)
        if (/[a-zA-Z_.]/.test(this.peek()) || this.peek() === '@') {
            value += this.advance();
        }

        // Subsequent chars: letters, digits, underscore
        while (/[a-zA-Z0-9_]/.test(this.peek())) {
            value += this.advance();
        }

        // Special case: AF' is the alternate AF register
        if (value.toUpperCase() === 'AF' && this.peek() === "'") {
            value += this.advance();
        }

        return new Token(TokenType.IDENTIFIER, value, startLine, startCol);
    }

    readTemporaryLabel() {
        // Numeric temporary labels: 1:, 1B, 1F
        const startLine = this.line;
        const startCol = this.column;
        let value = '';

        while (/[0-9]/.test(this.peek())) {
            value += this.advance();
        }

        // Check for B (backward) or F (forward) suffix
        if (this.peek() === 'B' || this.peek() === 'b' ||
            this.peek() === 'F' || this.peek() === 'f') {
            value += this.advance().toUpperCase();
        }

        return new Token(TokenType.IDENTIFIER, value, startLine, startCol);
    }

    nextToken() {
        this.skipWhitespace();

        while (this.skipComment()) {
            this.skipWhitespace();
        }

        if (this.pos >= this.source.length) {
            return new Token(TokenType.EOF, null, this.line, this.column);
        }

        const startLine = this.line;
        const startCol = this.column;
        const ch = this.peek();

        // Newline
        if (ch === '\n') {
            this.advance();
            return new Token(TokenType.NEWLINE, '\n', startLine, startCol);
        }

        // String literals
        if (ch === '"' || ch === "'") {
            return this.readString(ch);
        }

        // Numbers (including $ and # hex prefix and % binary prefix)
        if (/[0-9]/.test(ch)) {
            return this.readNumber();
        }

        // $ can be current address or hex prefix
        if (ch === '$') {
            if (/[0-9a-fA-F]/.test(this.peek(1))) {
                return this.readNumber();
            }
            this.advance();
            // $$ for start of section
            if (this.peek() === '$') {
                this.advance();
                return new Token(TokenType.IDENTIFIER, '$$', startLine, startCol);
            }
            return new Token(TokenType.DOLLAR, '$', startLine, startCol);
        }

        // # can be hex prefix or stringification
        if (ch === '#') {
            if (/[0-9a-fA-F]/.test(this.peek(1))) {
                return this.readNumber();
            }
            this.advance();
            if (this.peek() === '#') {
                this.advance();
                return new Token(TokenType.HASH_HASH, '##', startLine, startCol);
            }
            return new Token(TokenType.HASH, '#', startLine, startCol);
        }

        // % can be binary prefix or modulo
        if (ch === '%') {
            if (this.peek(1) === '0' || this.peek(1) === '1') {
                return this.readNumber();
            }
            this.advance();
            return new Token(TokenType.PERCENT, '%', startLine, startCol);
        }

        // Identifiers and labels
        // Dot starts local label only if followed by letter/underscore
        if (/[a-zA-Z_]/.test(ch) || ch === '@') {
            return this.readIdentifier();
        }

        // Dot handling:
        // - At start of token (after whitespace/newline/comma/etc): .local is local label
        // - In middle of expression: A.B should be A DOT B
        if (ch === '.') {
            // Check if this could be a local label (at token boundary)
            // Look at previous character to determine context
            const prevChar = this.pos > 0 ? this.source[this.pos - 1] : '\n';
            const isAtBoundary = /[\s,;:([\n]/.test(prevChar) || this.pos === 0;

            if (isAtBoundary && /[a-zA-Z_]/.test(this.peek(1))) {
                // Local label like .loop
                return this.readIdentifier();
            }
            // Otherwise emit DOT token (for struct.field syntax)
            this.advance();
            return new Token(TokenType.DOT, '.', startLine, startCol);
        }

        // Numeric temporary labels (1:, 1B, 1F)
        // Already handled by number check above, but 1B/1F need special handling
        // This is handled contextually in parser

        // Two-character operators
        if (ch === '<') {
            this.advance();
            if (this.peek() === '<') { this.advance(); return new Token(TokenType.LSHIFT, '<<', startLine, startCol); }
            if (this.peek() === '=') { this.advance(); return new Token(TokenType.LE, '<=', startLine, startCol); }
            if (this.peek() === '>') { this.advance(); return new Token(TokenType.NE, '<>', startLine, startCol); }
            return new Token(TokenType.LT, '<', startLine, startCol);
        }

        if (ch === '>') {
            this.advance();
            if (this.peek() === '>') { this.advance(); return new Token(TokenType.RSHIFT, '>>', startLine, startCol); }
            if (this.peek() === '=') { this.advance(); return new Token(TokenType.GE, '>=', startLine, startCol); }
            return new Token(TokenType.GT, '>', startLine, startCol);
        }

        if (ch === '=') {
            this.advance();
            if (this.peek() === '=') { this.advance(); }
            return new Token(TokenType.EQ, '=', startLine, startCol);
        }

        if (ch === '!') {
            this.advance();
            if (this.peek() === '=') { this.advance(); return new Token(TokenType.NE, '!=', startLine, startCol); }
            return new Token(TokenType.BANG, '!', startLine, startCol);
        }

        if (ch === '&') {
            this.advance();
            if (this.peek() === '&') { this.advance(); return new Token(TokenType.AND, '&&', startLine, startCol); }
            return new Token(TokenType.AMPERSAND, '&', startLine, startCol);
        }

        if (ch === '|') {
            this.advance();
            if (this.peek() === '|') { this.advance(); return new Token(TokenType.OR, '||', startLine, startCol); }
            return new Token(TokenType.PIPE, '|', startLine, startCol);
        }

        // Single-character operators
        const singleCharTokens = {
            '+': TokenType.PLUS,
            '-': TokenType.MINUS,
            '*': TokenType.STAR,
            '/': TokenType.SLASH,
            '^': TokenType.CARET,
            '~': TokenType.TILDE,
            '(': TokenType.LPAREN,
            ')': TokenType.RPAREN,
            '[': TokenType.LBRACKET,
            ']': TokenType.RBRACKET,
            ',': TokenType.COMMA,
            ':': TokenType.COLON,
            '?': TokenType.QUESTION,
            '\\': TokenType.BACKSLASH,
        };

        if (singleCharTokens[ch]) {
            this.advance();
            return new Token(singleCharTokens[ch], ch, startLine, startCol);
        }

        // Unknown character - skip and warn
        ErrorCollector.warn(`Unexpected character: '${ch}'`, this.line, this.filename);
        this.advance();
        return this.nextToken();
    }

    tokenize() {
        const tokens = [];
        while (true) {
            const token = this.nextToken();
            tokens.push(token);
            if (token.type === TokenType.EOF) {
                break;
            }
        }
        return tokens;
    }

    // Tokenize single line (useful for incremental parsing)
    tokenizeLine() {
        const tokens = [];
        while (true) {
            const token = this.nextToken();
            tokens.push(token);
            if (token.type === TokenType.EOF || token.type === TokenType.NEWLINE) {
                break;
            }
        }
        return tokens;
    }
}
