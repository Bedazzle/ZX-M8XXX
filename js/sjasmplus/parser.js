// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Parser - Parses assembly source lines into structured form

import { ErrorCollector } from './errors.js';
import { TokenType, Lexer } from './lexer.js';

export const Parser = {
    tokens: [],
    pos: 0,
    line: 1,
    filename: '<input>',
    lineComments: {},  // Comments indexed by line number

    // Parse source into array of parsed lines
    parse(source, filename = '<input>') {
        this.filename = filename;
        ErrorCollector.reset();

        // Handle null/undefined source
        if (!source) {
            return [];
        }

        const lexer = new Lexer(source, filename);
        this.tokens = lexer.tokenize();
        this.lineComments = lexer.lineComments || {};  // Get comments from lexer
        this.pos = 0;
        this.line = 1;

        const lines = [];
        while (!this.isAtEnd()) {
            const parsed = this.parseLine();
            if (parsed) {
                lines.push(parsed);
            }
        }
        return lines;
    },

    isAtEnd() {
        return this.pos >= this.tokens.length ||
               this.tokens[this.pos].type === TokenType.EOF;
    },

    peek(offset = 0) {
        const idx = this.pos + offset;
        return idx < this.tokens.length ? this.tokens[idx] : null;
    },

    advance() {
        if (!this.isAtEnd()) {
            const token = this.tokens[this.pos++];
            if (token.type === TokenType.NEWLINE) {
                this.line++;
            }
            return token;
        }
        return this.tokens[this.tokens.length - 1];
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

    // Parse a single line
    parseLine() {
        // Skip empty lines
        if (this.match(TokenType.NEWLINE)) {
            return null;
        }

        const result = {
            line: this.line,
            file: this.filename,
            label: null,
            instruction: null,
            instructionRaw: null,
            directive: null,
            operands: [],
            raw: '',
            comment: this.lineComments[this.line] || ''  // Include comment from this line
        };

        // Check for label
        if (this.check(TokenType.IDENTIFIER) || this.check(TokenType.DOT)) {
            const labelStart = this.peek();

            // Local label starting with dot
            if (this.match(TokenType.DOT)) {
                const name = this.match(TokenType.IDENTIFIER);
                if (name) {
                    result.label = '.' + name.value;
                }
            }
            // Regular label or instruction
            else if (this.check(TokenType.IDENTIFIER)) {
                const identPos = this.pos;  // Save position before consuming identifier
                const ident = this.advance();
                const isAtLineStart = ident.column === 1;
                const identUpper = ident.value.toUpperCase();
                let putBack = false;

                // Block-end directives should never be treated as labels even with colon
                const alwaysDirective = ['ENDM', 'ENDIF', 'ENDS', 'ENDR', 'ENDP', 'ENDMOD', 'ENDMODULE',
                                        'EDUP', 'ENDT', 'ENDW', 'ELSE', 'ELSEIF'];

                // Check if this is a block-end directive (even with colon, treat as directive)
                if (alwaysDirective.includes(identUpper)) {
                    // Consume the colon if present (sjasmplus tolerates ELSE:)
                    this.match(TokenType.COLON);
                    // Put back to identifier position to be parsed as directive below
                    this.pos = identPos;
                    putBack = true;
                }
                // Check if followed by colon (label)
                else if (this.match(TokenType.COLON)) {
                    result.label = ident.value;
                }
                // Check for compound label like ALIEN.1: or LABEL.FIELD:
                // Pattern: IDENTIFIER DOT (NUMBER|IDENTIFIER) COLON
                else if (this.check(TokenType.DOT)) {
                    // Look ahead to see if this is a compound label
                    const dotPos = this.pos;
                    this.advance(); // consume DOT
                    let suffix = '';

                    // Collect the suffix (can be NUMBER or IDENTIFIER, or multiple parts)
                    while (this.check(TokenType.NUMBER) || this.check(TokenType.IDENTIFIER) || this.check(TokenType.DOT)) {
                        const part = this.advance();
                        suffix += (part.type === TokenType.DOT ? '.' : part.value);
                    }

                    // Check if followed by colon - if so, it's a compound label
                    if (suffix && this.match(TokenType.COLON)) {
                        result.label = ident.value + '.' + suffix;
                    } else {
                        // Not a compound label, restore position
                        this.pos = dotPos;
                        this.pos--; // Put back the original identifier too
                        putBack = true;
                    }
                }
                // Check if followed by EQU, =, DEFL, MACRO (label without colon)
                else if (this.check(TokenType.IDENTIFIER)) {
                    const next = this.peek().value.toUpperCase();
                    if (next === 'EQU' || next === 'DEFL' || next === 'MACRO') {
                        result.label = ident.value;
                        // Don't put it back - continue to parse directive
                    }
                    // If at column 1 and matches directive name (not instruction),
                    // and followed by local label (.xxx), treat directive name as label scope
                    // e.g., "SLOT" followed by ".XPOS EQU" makes SLOT a label
                    // But NOT "MACRO test" - that's a directive with operands
                    else if (isAtLineStart && this.isDirective(identUpper) && !this.isInstruction(ident.value)) {
                        // Only treat as label if we're followed by a DOT (local label)
                        // We already consumed this identifier and next is the following token
                        // If next is a regular identifier (not local label), this is a directive with operands
                        this.pos--; // Put it back, let it be parsed as directive
                        putBack = true;
                    }
                    // Check if this could be a label followed by instruction
                    // ONLY at column 1 - if indented, first identifier is instruction/macro, not label
                    // (identifier not a known instruction/directive, followed by known instruction)
                    else if (isAtLineStart && !this.isInstruction(ident.value) && !this.isDirective(identUpper) && this.isInstruction(next)) {
                        result.label = ident.value;
                        // Don't put it back - continue to parse instruction
                    }
                    // Check if this could be a label followed by directive (like BYTE, WORD in structs)
                    // ONLY at column 1
                    else if (isAtLineStart && !this.isInstruction(ident.value) && !this.isDirective(identUpper) && this.isDirective(next)) {
                        result.label = ident.value;
                        // Don't put it back - continue to parse directive
                    }
                    else {
                        this.pos--; // Put it back
                        putBack = true;
                    }
                }
                else if (this.check(TokenType.EQ)) {
                    // label = value syntax: treat = as directive with value as operand
                    result.label = ident.value;
                    this.advance(); // consume the =
                    result.directive = '=';
                    result.operands = this.parseOperands();
                    // Skip the rest of line parsing since we already parsed operands
                    while (!this.check(TokenType.NEWLINE) && !this.isAtEnd()) {
                        this.advance();
                    }
                    this.match(TokenType.NEWLINE);
                    return result;
                }
                // At column 1, alone on line, directive name (not instruction) = label
                // e.g., "SLOT" alone = label, "NOP" alone = instruction
                // EXCEPTION: Block-end directives (ENDM, ENDIF, ENDS, ENDR, etc.) are always directives
                else if (isAtLineStart && this.isDirective(identUpper) && !this.isInstruction(ident.value) &&
                         (this.check(TokenType.NEWLINE) || this.isAtEnd())) {
                    // These directives don't take operands and should always be directives
                    const alwaysDirective = ['ENDM', 'ENDIF', 'ENDS', 'ENDR', 'ENDP', 'ENDMOD', 'ENDMODULE',
                                            'EDUP', 'ENDT', 'ENDW', 'ELSE', 'ELSEIF'];
                    if (alwaysDirective.includes(identUpper)) {
                        this.pos--; // Put it back, parse as directive
                        putBack = true;
                    } else {
                        result.label = ident.value;
                    }
                }
                // Otherwise it's an instruction/directive (could be macro call)
                else if (!putBack) {
                    this.pos--; // Put it back
                }
            }
        }

        // Check for numeric temporary label (1:, 2:, etc.)
        if (this.check(TokenType.NUMBER)) {
            const num = this.peek();
            if (this.peek(1) && this.peek(1).type === TokenType.COLON) {
                this.advance(); // number
                this.advance(); // colon
                result.label = num.value.toString() + ':';
            }
        }

        // Skip if only label on line
        if (this.check(TokenType.NEWLINE) || this.isAtEnd()) {
            this.match(TokenType.NEWLINE);
            return result.label ? result : null;
        }

        // Parse instruction or directive
        if (this.check(TokenType.IDENTIFIER)) {
            const ident = this.advance();
            const name = ident.value.toUpperCase();

            // Check if it's a directive
            if (this.isDirective(name)) {
                result.directive = name;
            } else {
                result.instruction = name;
                result.instructionRaw = ident.value; // Preserve original case for label fallback
            }

            // Parse operands
            result.operands = this.parseOperands();
        }
        // Directive starting with dot
        else if (this.check(TokenType.DOT)) {
            this.advance();
            if (this.check(TokenType.IDENTIFIER)) {
                const ident = this.advance();
                result.directive = '.' + ident.value.toUpperCase();
                result.operands = this.parseOperands();
            }
        }

        // Consume rest of line (but stop at colon - it's a statement separator)
        while (!this.check(TokenType.NEWLINE) && !this.check(TokenType.COLON) && !this.isAtEnd()) {
            this.advance();
        }
        // If we hit a colon, consume it but don't consume newline - let next parseLine call handle the next statement
        if (this.check(TokenType.COLON)) {
            this.advance();
            // Don't consume newline - there may be more statements
        } else {
            this.match(TokenType.NEWLINE);
        }

        return result;
    },

    // Parse operands until end of line
    parseOperands() {
        const operands = [];

        if (this.check(TokenType.NEWLINE) || this.isAtEnd()) {
            return operands;
        }

        // First operand
        operands.push(this.parseOperand());

        // Additional operands separated by comma
        while (this.match(TokenType.COMMA)) {
            operands.push(this.parseOperand());
        }

        return operands;
    },

    // Parse a single operand (can be expression, register, memory reference)
    parseOperand() {
        const tokens = [];
        let parenDepth = 0;

        while (!this.isAtEnd()) {
            const token = this.peek();

            // End of operand
            if (token.type === TokenType.NEWLINE) break;
            if (token.type === TokenType.COMMA && parenDepth === 0) break;
            // Colon can be statement separator (but not inside parens or after first token if it's a label)
            if (token.type === TokenType.COLON && parenDepth === 0) break;

            // Track parentheses
            if (token.type === TokenType.LPAREN) parenDepth++;
            if (token.type === TokenType.RPAREN) parenDepth--;

            tokens.push(this.advance());
        }

        // Convert tokens to string representation
        return this.tokensToString(tokens);
    },

    // Convert tokens back to string for operand
    tokensToString(tokens) {
        let result = '';
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const prev = tokens[i - 1];

            // Add space between certain tokens
            if (prev && this.needsSpace(prev, token)) {
                result += ' ';
            }

            if (token.type === TokenType.STRING) {
                // Choose quote style based on content to avoid escaping issues
                // If string contains double quote, use single quotes and vice versa
                const val = token.value;
                if (val.includes('"') && !val.includes("'")) {
                    result += "'" + val + "'";
                } else {
                    result += '"' + val + '"';
                }
            } else if (token.type === TokenType.NUMBER) {
                result += token.value.toString();
            } else {
                result += token.value;
            }
        }
        return result.trim();
    },

    needsSpace(prev, curr) {
        // No space after opening paren or before closing
        if (prev.type === TokenType.LPAREN) return false;
        if (curr.type === TokenType.RPAREN) return false;
        // No space before comma
        if (curr.type === TokenType.COMMA) return false;
        // Space between identifiers/numbers
        if ((prev.type === TokenType.IDENTIFIER || prev.type === TokenType.NUMBER) &&
            (curr.type === TokenType.IDENTIFIER || curr.type === TokenType.NUMBER)) {
            return true;
        }
        // Space between identifier and string (e.g., DEFINE name "value")
        if (prev.type === TokenType.IDENTIFIER && curr.type === TokenType.STRING) {
            return true;
        }
        return false;
    },

    // Check if identifier is a directive
    isDirective(name) {
        const directives = [
            // Data definition
            'DB', 'DW', 'DD', 'DQ', 'DEFB', 'DEFW', 'DEFD', 'DEFQ',
            'BYTE', 'WORD', 'DWORD', 'DS', 'DEFS', 'BLOCK',
            'DZ', 'DEFM', 'DM', 'DC', 'HEX',
            'ABYTE', 'ABYTEC', 'ABYTEZ',
            // Origin and alignment
            'ORG', 'ALIGN', 'PHASE', 'DEPHASE', 'DISP', 'ENT',
            // Labels and symbols
            'EQU', 'DEFL', 'LABEL', '=', 'DEFINE', 'UNDEFINE',
            // Conditionals
            'IF', 'IFDEF', 'IFNDEF', 'IFUSED', 'IFNUSED',
            'ELSE', 'ELSEIF', 'ENDIF',
            // Macros
            'MACRO', 'ENDM', 'ENDMACRO', 'EXITM',
            'REPT', 'ENDR', 'IRP', 'IRPC', 'DUP', 'EDUP',
            // Structures
            'STRUCT', 'ENDS', 'ENDSTRUCT',
            // Modules
            'MODULE', 'ENDMODULE',
            // Includes
            'INCLUDE', 'INCBIN',
            // Output
            'OUTPUT', 'OUTEND',
            'SAVEBIN', 'SAVESNA', 'SAVETAP', 'EMPTYTAP', 'SAVETRD', 'EMPTYTRD',
            // Device
            'DEVICE', 'SLOT', 'PAGE', 'MMU',
            // Misc
            'ASSERT', 'DISPLAY', 'SHELLEXEC',
            'OPT', 'CHARSET', 'ENCODING',
            'END',
            // Listing
            'LIST', 'NOLIST',
        ];
        return directives.includes(name) || name.startsWith('.');
    },

    // Check if identifier is a Z80 instruction
    isInstruction(name) {
        const instructions = [
            // 8-bit load
            'LD', 'PUSH', 'POP',
            // 16-bit load
            // 8-bit arithmetic
            'ADD', 'ADC', 'SUB', 'SBC', 'AND', 'XOR', 'OR', 'CP',
            'INC', 'DEC',
            // 16-bit arithmetic
            // General purpose
            'DAA', 'CPL', 'NEG', 'CCF', 'SCF', 'NOP', 'HALT', 'DI', 'EI',
            'IM',
            // Rotate and shift
            'RLCA', 'RLA', 'RRCA', 'RRA',
            'RLC', 'RL', 'RRC', 'RR', 'SLA', 'SRA', 'SRL', 'SLL',
            // Bit manipulation
            'BIT', 'SET', 'RES',
            // Jump
            'JP', 'JR', 'DJNZ',
            // Call and return
            'CALL', 'RET', 'RETI', 'RETN', 'RST',
            // Input/output
            'IN', 'OUT', 'INI', 'INIR', 'IND', 'INDR',
            'OUTI', 'OTIR', 'OUTD', 'OTDR',
            // Block transfer
            'LDI', 'LDIR', 'LDD', 'LDDR',
            'CPI', 'CPIR', 'CPD', 'CPDR',
            // Exchange
            'EX', 'EXX',
            // Undocumented
            'SLI', 'SWAP',
            // Next hardware (if supported)
            'LDIX', 'LDIRX', 'LDDX', 'LDDRX', 'LDPIRX', 'LDIRSCALE',
            'OUTINB', 'MUL', 'MIRROR', 'NEXTREG', 'PIXELDN', 'PIXELAD',
            'SETAE', 'TEST', 'BSLA', 'BSRA', 'BSRL', 'BSRF', 'BRLC',
        ];
        return instructions.includes(name.toUpperCase());
    }
};

// Line types for clearer identification
export const LineType = {
    INSTRUCTION: 'instruction',
    DIRECTIVE: 'directive',
    LABEL_ONLY: 'label_only',
    EMPTY: 'empty'
};

// Get line type
export function getLineType(parsed) {
    if (!parsed) return LineType.EMPTY;
    if (parsed.instruction) return LineType.INSTRUCTION;
    if (parsed.directive) return LineType.DIRECTIVE;
    if (parsed.label) return LineType.LABEL_ONLY;
    return LineType.EMPTY;
}
