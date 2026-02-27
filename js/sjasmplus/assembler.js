// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Assembler core - Multi-pass assembly orchestration
// https://github.com/anthropics/sjasmplus-js

import { AssemblerError, ErrorCollector } from './errors.js';
import { SymbolTable, EquTable } from './labels.js';
import { Parser } from './parser.js';
import { parseExpression } from './expression.js';
import { Z80Asm, InstructionEncoder } from './instructions.js';
import './instructions2.js';
import './instructions3.js';
import { AsmMemory } from './memory.js';
import { Preprocessor } from './preprocessor.js';
import { VFS } from './vfs.js';
import { OutputFormats } from './output.js';
import { MD5 } from './md5.js';


export const Assembler = {
    // Configuration
    maxPasses: 10,
    
    // State
    currentAddress: 0,
    physicalAddress: null,  // During DISP, tracks actual output location (null = not in DISP)
    sectionStart: 0,
    output: [],           // Output bytes array
    outputStart: 0,       // Starting address of output
    orgAddresses: [],     // All ORG addresses encountered
    lines: [],            // Parsed lines
    pass: 0,
    changed: false,       // Did any label value change this pass?
    saveCommands: [],     // Output save directives
    md5Associations: {},  // filename -> MD5 hash from MD5CHECK macro
    
    // Reset assembler state
    reset() {
        this.currentAddress = 0;
        this.physicalAddress = null;
        this.sectionStart = 0;
        this.output = [];
        this.outputStart = 0;
        this.orgAddresses = [];
        this.lines = [];
        this.pass = 0;
        this.changed = false;
        this.macroCount = 0;
        this.macroDefinition = null;
        this.reptState = null;
        this.includeStack = [];
        this.saveCommands = [];
        this.md5Associations = {};
        
        SymbolTable.reset();
        EquTable.reset();
        ErrorCollector.reset();
        AsmMemory.reset();
        Preprocessor.reset();
        VFS.reset();
    },

    // Main assembly function for single file
    assemble(source, filename = '<input>', cmdDefines = []) {
        this.reset();
        
        // Apply command-line defines
        for (const def of cmdDefines) {
            EquTable.define(def.name, def.value, 0, '<cmdline>');
        }
        
        // Add source to VFS
        VFS.addFile(filename, source);
        
        // Parse source
        this.lines = Parser.parse(source, filename);
        
        return this.runPasses();
    },

    // Assembly function for multi-file project (files already in VFS)
    assembleProject(mainFile, cmdDefines = []) {
        // Don't reset VFS - files are already loaded
        this.currentAddress = 0;
        this.physicalAddress = null;
        this.sectionStart = 0;
        this.output = [];
        this.outputStart = 0;
        this.orgAddresses = [];
        this.lines = [];
        this.pass = 0;
        this.changed = false;
        this.macroCount = 0;
        this.macroDefinition = null;
        this.reptState = null;
        this.includeStack = [];
        this.saveCommands = [];
        
        SymbolTable.reset();
        EquTable.reset();
        ErrorCollector.reset();
        AsmMemory.reset();
        Preprocessor.reset();
        
        // Apply command-line defines
        cmdDefines = cmdDefines || [];
        for (const def of cmdDefines) {
            EquTable.define(def.name, def.value, 0, '<cmdline>');
        }
        
        // Get main file from VFS
        const file = VFS.getFile(mainFile);
        if (!file || file.error) {
            throw new AssemblerError(file ? file.error : `Main file not found: ${mainFile}`);
        }
        
        // Parse main source
        this.lines = Parser.parse(file.content, file.path);
        
        return this.runPasses();
    },

    // Run multi-pass assembly
    runPasses() {
        let lastUndefinedCount = Infinity;
        
        for (this.pass = 1; this.pass <= this.maxPasses; this.pass++) {
            this.changed = false;
            this.currentAddress = 0;
            this.physicalAddress = null;
            this.sectionStart = 0;
            this.output = [];
            this.outputStart = 0;
            this.macroDefinition = null;
            this.reptState = null;
            this.includeStack = [];
            this.saveCommands = [];
            this.linesProcessed = 0;  // Global counter including macro expansions
            
            // Save previous pass temp labels for forward references
            // then clear for new collection
            SymbolTable.prevTempLabels = SymbolTable.tempLabels;
            SymbolTable.tempLabels = {};
            SymbolTable.tempDefOrder = 0;
            SymbolTable.tempRefOrder = 0;
            
            // Reset local label prefix each pass
            SymbolTable.localPrefix = '';
            
            // Reset preprocessor conditional state
            Preprocessor.ifStack = [];
            
            // Process all lines
            let lineCount = 0;
            const totalLines = this.lines.length;
            for (const line of this.lines) {
                lineCount++;
                // Track current source location for error reporting
                AsmMemory.currentLine = line.line;
                AsmMemory.currentFile = line.file;
                try {
                    this.processLine(line);
                } catch (e) {
                    if (e instanceof AssemblerError) {
                        throw e;
                    }
                    ErrorCollector.error(e.message, line.line, line.file);
                }
            }
            
            // Check for undefined symbols
            const undefinedSyms = SymbolTable.checkUndefined();
            
            // If no undefined symbols and no changes, we're done
            if (undefinedSyms.length === 0 && !this.changed) {
                break;
            }
            
            // If undefined count not decreasing, we have unresolvable refs
            if (undefinedSyms.length > 0 && undefinedSyms.length >= lastUndefinedCount && this.pass > 2) {
                const names = undefinedSyms.map(u => u.name).join(', ');
                ErrorCollector.error(`Undefined symbols: ${names}`);
            }
            
            // If no undefined but still changing after many passes, something is wrong
            if (undefinedSyms.length === 0 && this.changed && this.pass > 5) {
                ErrorCollector.error('Assembly failed to converge - possible circular dependency');
            }
            
            lastUndefinedCount = undefinedSyms.length;
        }
        
        if (this.pass > this.maxPasses) {
            ErrorCollector.error('Assembly did not converge within maximum passes');
        }
        
        // Generate warnings for unused labels
        const unused = SymbolTable.checkUnused();
        for (const u of unused) {
            ErrorCollector.warn(`Unused label: ${u.name}`, u.line, u.file);
        }
        
        return {
            success: true,
            output: this.output,
            outputStart: this.outputStart,
            orgAddresses: this.orgAddresses.slice(),  // All ORG addresses
            symbols: SymbolTable.export(),
            passes: this.pass,
            warnings: ErrorCollector.warnings,
            saveCommands: this.saveCommands
        };
    },

    // Process a single line
    processLine(line) {
        // Track total lines processed (including macro expansions)
        this.linesProcessed = (this.linesProcessed || 0) + 1;
        if (this.progressCallback && this.linesProcessed % 5000 === 0) {
            this.progressCallback(this.pass, this.linesProcessed, null);
        }
        
        const dir = line.directive;
        
        // Handle macro definition collection
        if (this.macroDefinition) {
            if (dir === 'ENDM' || dir === 'ENDMACRO') {
                this.endMacroDefinition(line);
            } else {
                // Collect raw line for macro body
                const rawLine = this.reconstructLine(line);
                this.macroDefinition.body.push(rawLine);
            }
            return;
        }

        // Handle REPT/DUP body collection
        if (this.reptState) {
            if (dir === 'ENDR' || dir === 'EDUP') {
                // End REPT - expand and process
                const expanded = [];
                const reptFile = this.reptState.file;
                const reptLine = this.reptState.startLine;
                if (this.reptState.body) {
                    for (let i = 0; i < this.reptState.count; i++) {
                        expanded.push(...this.reptState.body);
                    }
                }
                this.reptState = null;
                // Process expanded lines
                for (const rawLine of expanded) {
                    const parsed = Parser.parse(rawLine, reptFile || '<rept>')[0];
                    if (parsed) {
                        // Preserve original file/line info from REPT definition
                        parsed.file = reptFile;
                        parsed.line = reptLine;
                        this.processLine(parsed);
                    }
                }
            } else {
                // Collect raw line for REPT body
                const rawLine = this.reconstructLine(line);
                this.reptState.body.push(rawLine);
            }
            return;
        }

        // Handle conditionals - these must be processed even when inactive
        if (dir === 'IF' || dir === 'IFDEF' || dir === 'IFNDEF' || 
            dir === 'IFUSED' || dir === 'IFNUSED' ||
            dir === 'ELSE' || dir === 'ELSEIF' || dir === 'ENDIF') {
            this.processDirective(line);
            return;
        }

        // Skip if not in active conditional block
        if (!Preprocessor.isActive()) {
            return;
        }

        // Handle struct field definitions
        if (Preprocessor.inSTRUCT()) {
            if (dir === 'ENDS' || dir === 'ENDSTRUCT') {
                this.dirENDS(line);
                return;
            }
            // Inside struct: "fieldname TYPE" or "fieldname TYPE default"
            // Parser will give us: label=fieldname, directive=TYPE
            const fieldName = line.label || line.instructionRaw || line.instruction;
            let fieldType = dir || (line.operands.length > 0 ? line.operands[0] : null);
            
            if (fieldName && fieldType) {
                let typeUpper = fieldType.toUpperCase();
                let size = 1;
                let defaultValue = null;
                
                // Handle TEXT with size: "TEXT 7" or "TEXT 8, {default}"
                const textMatch = typeUpper.match(/^TEXT\s+(\d+)$/);
                if (textMatch) {
                    size = parseInt(textMatch[1], 10);
                    // Check for default value in operands[1] (e.g., "0001000" after comma)
                    if (line.operands.length > 1) {
                        let defStr = line.operands[1];
                        // Remove quotes if present
                        if ((defStr.startsWith('"') && defStr.endsWith('"')) ||
                            (defStr.startsWith("'") && defStr.endsWith("'"))) {
                            defStr = defStr.slice(1, -1);
                        }
                        defaultValue = { type: 'text', value: defStr, size: size };
                    }
                } else if (typeUpper.match(/^D\s+\d+$/)) {
                    // Handle "D size" (DEFS-style in struct)
                    size = parseInt(typeUpper.split(/\s+/)[1], 10);
                } else {
                    switch (typeUpper) {
                        case 'BYTE': case 'DB': case 'DEFB': 
                            size = 1; 
                            // Check for default value
                            if (line.operands.length > 0) {
                                const val = this.evaluate(line.operands[0], line);
                                if (!val.undefined) {
                                    defaultValue = { type: 'byte', value: val.value };
                                }
                            }
                            break;
                        case 'WORD': case 'DW': case 'DEFW': 
                            size = 2; 
                            if (line.operands.length > 0) {
                                const val = this.evaluate(line.operands[0], line);
                                if (!val.undefined) {
                                    defaultValue = { type: 'word', value: val.value };
                                }
                            }
                            break;
                        case 'DWORD': case 'DD': case 'DEFD': 
                            size = 4; 
                            if (line.operands.length > 0) {
                                const val = this.evaluate(line.operands[0], line);
                                if (!val.undefined) {
                                    defaultValue = { type: 'dword', value: val.value };
                                }
                            }
                            break;
                        default:
                            // Could be a nested struct or just DS size
                            const nestedStruct = Preprocessor.getSTRUCT(typeUpper);
                            if (nestedStruct) {
                                size = nestedStruct.size;
                                // Store the struct type name for nested field symbol generation
                                defaultValue = { type: 'struct', structType: typeUpper };
                            }
                    }
                }
                Preprocessor.addStructField(fieldName, size, defaultValue);
            }
            return;
        }

        // Handle label (but not for EQU/DEFL/MACRO - those handle their own labels)
        if (line.label && dir !== 'EQU' && dir !== '=' && dir !== 'DEFL' && dir !== 'DEFINE' && dir !== 'UNDEFINE' && dir !== 'MACRO') {
            this.defineLabel(line.label, line.line, line.file);
        }
        
        // Handle directive
        if (line.directive) {
            this.processDirective(line);
            return;
        }
        
        // Handle instruction
        if (line.instruction) {
            this.processInstruction(line);
            return;
        }
    },

    // Reconstruct source line from parsed form (preserving original case for macro bodies)
    reconstructLine(line) {
        let result = '';
        const dir = line.directive?.toUpperCase();
        
        // For directives that consume the label (EQU, =, DEFL), don't add colon
        const labelConsumingDirs = ['EQU', '=', 'DEFL', 'DEFINE', 'MACRO'];
        const isLabelConsuming = labelConsumingDirs.includes(dir);
        
        if (line.label) {
            result += line.label;
            if (!isLabelConsuming && !line.label.endsWith(':')) result += ':';
            result += ' ';
        }
        // Add indentation for instructions/directives if no label
        // This prevents them being misinterpreted as labels when re-parsed
        if (!line.label) {
            result += '    ';
        }
        if (line.instruction) {
            // Use original case (instructionRaw) for macro body preservation
            result += line.instructionRaw || line.instruction;
            if (line.operands.length > 0) {
                result += ' ' + line.operands.join(', ');
            }
        }
        if (line.directive) {
            result += line.directive;
            if (line.operands.length > 0) {
                result += ' ' + line.operands.join(', ');
            }
        }
        return result;
    },

    // Define a label at current address
    defineLabel(label, lineNum, file) {
        // Check for temporary label (1:, 2:, etc.)
        const tempMatch = /^(\d+):$/.exec(label);
        if (tempMatch) {
            SymbolTable.defineTemp(parseInt(tempMatch[1]), this.currentAddress, lineNum);
            // Mark as changed on first pass to ensure multi-pass runs
            if (this.pass === 1) {
                this.changed = true;
            }
            return;
        }
        
        // Regular label
        const oldValue = SymbolTable.getValue(label);
        SymbolTable.define(label, this.currentAddress, lineNum, file);
        
        // Check if value changed (for multi-pass convergence)
        if (oldValue.value !== this.currentAddress) {
            this.changed = true;
        }
    },

    // Process a directive
    processDirective(line) {
        const dir = line.directive;
        const ops = line.operands;
        
        switch (dir) {
            case 'ORG':
                this.dirORG(ops, line);
                break;
            case 'EQU':
                this.dirEQU(line);
                break;
            case '=':
            case 'DEFL':
                this.dirDEFL(line);
                break;
            case 'DEFINE':
                this.dirDEFINE(line);
                break;
            case 'UNDEFINE':
                this.dirUNDEFINE(line);
                break;
            case 'DB':
            case 'DEFB':
            case 'BYTE':
            case 'DM':
            case 'DEFM':
                this.dirDB(ops, line);
                break;
            case 'ABYTE':
                this.dirABYTE(ops, line);
                break;
            case 'ABYTEC':
                this.dirABYTEC(ops, line);
                break;
            case 'ABYTEZ':
                this.dirABYTEZ(ops, line);
                break;
            case 'DW':
            case 'DEFW':
            case 'WORD':
                this.dirDW(ops, line);
                break;
            case 'DS':
            case 'DEFS':
            case 'BLOCK':
                this.dirDS(ops, line);
                break;
            case 'DZ':
                this.dirDZ(ops, line);
                break;
            case 'DC':
                this.dirDC(ops, line);
                break;
            case 'ALIGN':
                this.dirALIGN(ops, line);
                break;
            case 'DISP':
            case 'PHASE':
                this.dirDISP(ops, line);
                break;
            case 'ENT':
            case 'DEPHASE':
                this.dirENT(ops, line);
                break;
            case 'ASSERT':
                this.dirASSERT(ops, line);
                break;
            case 'END':
                // Stop processing
                break;
            case 'DEVICE':
                this.dirDEVICE(ops, line);
                break;
            case 'SLOT':
                this.dirSLOT(ops, line);
                break;
            case 'PAGE':
                this.dirPAGE(ops, line);
                break;
            case 'IF':
                this.dirIF(ops, line);
                break;
            case 'IFDEF':
                this.dirIFDEF(ops, line);
                break;
            case 'IFNDEF':
                this.dirIFNDEF(ops, line);
                break;
            case 'IFUSED':
                this.dirIFUSED(ops, line);
                break;
            case 'IFNUSED':
                this.dirIFNUSED(ops, line);
                break;
            case 'ELSE':
                Preprocessor.processELSE();
                break;
            case 'ELSEIF':
                this.dirELSEIF(ops, line);
                break;
            case 'ENDIF':
                Preprocessor.processENDIF();
                break;
            case 'MACRO':
                this.startMacroDefinition(ops, line);
                break;
            case 'ENDM':
            case 'ENDMACRO':
                this.endMacroDefinition(line);
                break;
            case 'REPT':
                this.dirREPT(ops, line);
                break;
            case 'DUP':
                this.dirDUP(ops, line);
                break;
            case 'ENDR':
            case 'EDUP':
                // Handled by REPT processing
                break;
            case 'STRUCT':
                this.dirSTRUCT(ops, line);
                break;
            case 'ENDS':
            case 'ENDSTRUCT':
                this.dirENDS(line);
                break;
            case 'CHARSET':
                this.dirCHARSET(ops, line);
                break;
            case 'MODULE':
                this.dirMODULE(ops, line);
                break;
            case 'ENDMODULE':
                SymbolTable.exitModule();
                break;
            case 'INCLUDE':
                this.dirINCLUDE(ops, line);
                break;
            case 'INCBIN':
                this.dirINCBIN(ops, line);
                break;
            case 'OUTPUT':
                // OUTPUT is just a hint, we'll use the first save directive
                break;
            case 'EMPTYTAP':
                this.dirEMPTYTAP(ops, line);
                break;
            case 'SAVEBIN':
                this.dirSAVEBIN(ops, line);
                break;
            case 'SAVESNA':
                this.dirSAVESNA(ops, line);
                break;
            case 'SAVETAP':
                this.dirSAVETAP(ops, line);
                break;
            case 'EMPTYTRD':
                this.dirEMPTYTRD(ops, line);
                break;
            case 'SAVETRD':
                this.dirSAVETRD(ops, line);
                break;
            default:
                // Unknown directive - might be macro call
                if (this.tryMacroCall(line)) {
                    break;
                }
                if (!line.directive.startsWith('.')) {
                    // ErrorCollector.warn(`Unknown directive: ${dir}`, line.line, line.file);
                }
                break;
        }
    },

    // ORG directive
    dirORG(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('ORG requires an address', line.line, line.file);
        }
        const val = this.evaluate(ops[0], line);
        if (!val.undefined) {
            // Set output start on first ORG (before any output)
            if (this.output.length === 0 && this.outputStart === 0) {
                this.outputStart = val.value;
            }
            // Track all ORG addresses (only on last pass to avoid duplicates)
            if (this.pass === this.maxPasses || !this.changed) {
                if (!this.orgAddresses.includes(val.value)) {
                    this.orgAddresses.push(val.value);
                }
            }
            this.currentAddress = val.value;
            this.sectionStart = val.value;
        }
    },

    // EQU directive
    dirEQU(line) {
        if (!line.label) {
            ErrorCollector.error('EQU requires a label', line.line, line.file);
        }
        if (line.operands.length < 1) {
            ErrorCollector.error('EQU requires a value', line.line, line.file);
        }
        const val = this.evaluate(line.operands[0], line);
        if (!val.undefined) {
            EquTable.define(line.label, val.value, line.line, line.file);
        }
    },

    // DEFL directive (redefinable)
    dirDEFL(line) {
        if (!line.label) {
            ErrorCollector.error('DEFL requires a label', line.line, line.file);
        }
        if (line.operands.length < 1) {
            ErrorCollector.error('DEFL requires a value', line.line, line.file);
        }
        const val = this.evaluate(line.operands[0], line);
        // DEFL allows redefinition
        SymbolTable.symbols[SymbolTable.getFullName(line.label)] = {
            value: val.value,
            type: 'defl',
            defined: !val.undefined,
            used: false,
            line: line.line,
            file: line.file
        };
    },

    // DEFINE directive (define symbol for IFDEF checks)
    dirDEFINE(line) {
        // DEFINE can have label or first operand as name
        let name = line.label;
        let value = 1;
        
        if (!name && line.operands.length >= 1) {
            // Parse first operand - might be "NAME" or "NAME VALUE" or "NAME, VALUE"
            const parts = line.operands[0].trim().split(/\s+/);
            name = parts[0];
            if (parts.length >= 2) {
                // Value after space: DEFINE NAME value or DEFINE NAME "string"
                const rawValue = parts.slice(1).join(' ');
                value = this.parseDefineValue(rawValue, line);
            } else if (line.operands.length >= 2) {
                // Value in second operand (comma-separated): DEFINE NAME, value
                value = this.parseDefineValue(line.operands[1], line);
            }
        } else if (name && line.operands.length >= 1) {
            value = this.parseDefineValue(line.operands[0], line);
        }
        
        if (!name) {
            ErrorCollector.error('DEFINE requires a symbol name', line.line, line.file);
            return;
        }
        
        EquTable.define(name, value, line.line, line.file);
    },
    
    // Parse DEFINE value - can be string or expression
    parseDefineValue(rawValue, line) {
        const trimmed = rawValue.trim();
        // Check if it's a quoted string
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.slice(1, -1); // Return unquoted string
        }
        // Otherwise evaluate as expression
        const val = this.evaluate(trimmed, line);
        return val.undefined ? 1 : val.value;
    },
    
    // Resolve filename - can be quoted string or symbol reference
    resolveFilename(op, line) {
        const trimmed = op.trim();
        // If quoted, strip quotes
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.slice(1, -1);
        }
        // Otherwise look up as symbol
        const val = EquTable.getValue(trimmed);
        if (val && typeof val.value === 'string') {
            return val.value;
        }
        // Try SymbolTable too
        const sym = SymbolTable.getValue(trimmed);
        if (sym && typeof sym.value === 'string') {
            return sym.value;
        }
        // Return as-is (might be an error, but let it through)
        return trimmed;
    },

    // UNDEFINE directive (remove symbol definition)
    dirUNDEFINE(line) {
        let name = line.label;
        
        if (!name && line.operands.length >= 1) {
            // Parse first operand - take first word
            name = line.operands[0].trim().split(/\s+/)[0];
        }
        
        if (!name) {
            ErrorCollector.error('UNDEFINE requires a symbol name', line.line, line.file);
            return;
        }
        
        const fullName = SymbolTable.getFullName(name);
        delete SymbolTable.symbols[fullName];
        delete EquTable.values[name];
        delete EquTable.values[fullName];
    },

    // DB/DEFB directive
    dirDB(ops, line) {
        for (const op of ops) {
            // Check if double-quoted string
            if (op.startsWith('"') && op.endsWith('"')) {
                const str = op.slice(1, -1);
                for (let i = 0; i < str.length; i++) {
                    this.emit(str.charCodeAt(i));
                }
            }
            // Check if single-quoted string (for multi-char strings like 'HELLO')
            else if (op.startsWith("'") && op.endsWith("'") && op.length > 2) {
                const str = op.slice(1, -1);
                for (let i = 0; i < str.length; i++) {
                    this.emit(str.charCodeAt(i));
                }
            }
            else {
                const val = this.evaluate(op, line);
                this.emit(Z80Asm.checkByte(val.value));
            }
        }
    },

    // DW/DEFW directive
    dirDW(ops, line) {
        for (const op of ops) {
            const val = this.evaluate(op, line);
            const [lo, hi] = Z80Asm.wordBytes(val.value);
            this.emit(lo);
            this.emit(hi);
        }
    },

    // DS/DEFS directive (reserve space)
    dirDS(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('DS requires a size', line.line, line.file);
        }
        const size = this.evaluate(ops[0], line);
        const fill = ops.length > 1 ? this.evaluate(ops[1], line).value : 0;
        
        if (!size.undefined) {
            for (let i = 0; i < size.value; i++) {
                this.emit(fill & 0xFF);
            }
        }
    },

    // DZ directive (zero-terminated string)
    dirDZ(ops, line) {
        this.dirDB(ops, line);
        this.emit(0);
    },

    // DC directive (string with high bit set on last character)
    dirDC(ops, line) {
        for (let opIdx = 0; opIdx < ops.length; opIdx++) {
            const op = ops[opIdx];
            // Handle string (double-quoted)
            if (op.startsWith('"') && op.endsWith('"')) {
                const str = op.slice(1, -1);
                for (let i = 0; i < str.length; i++) {
                    let byte = str.charCodeAt(i);
                    // Set high bit on last character if this is the last string operand
                    if (i === str.length - 1 && opIdx === ops.length - 1) {
                        byte |= 0x80;
                    }
                    this.emit(byte);
                }
            }
            // Handle single-quoted string
            else if (op.startsWith("'") && op.endsWith("'") && op.length > 2) {
                const str = op.slice(1, -1);
                for (let i = 0; i < str.length; i++) {
                    let byte = str.charCodeAt(i);
                    // Set high bit on last character if this is the last string operand
                    if (i === str.length - 1 && opIdx === ops.length - 1) {
                        byte |= 0x80;
                    }
                    this.emit(byte);
                }
            }
            else {
                const val = this.evaluate(op, line);
                let byte = Z80Asm.checkByte(val.value);
                // Set high bit on last byte operand
                if (opIdx === ops.length - 1) {
                    byte |= 0x80;
                }
                this.emit(byte);
            }
        }
    },

    // Helper to parse ABYTE operands - handles both "offset, data" and "offset data" syntax
    parseAbyteOps(ops) {
        // If only one operand, try to split at string start
        if (ops.length === 1) {
            const op = ops[0];
            // Look for pattern like: 0"string" or 0 "string" or $80'string'
            const match = op.match(/^([^"']+)(["'].*)$/);
            if (match) {
                return [match[1].trim(), match[2]];
            }
        }
        return ops;
    },

    // ABYTE offset, data... - output bytes with offset added to each
    dirABYTE(ops, line) {
        ops = this.parseAbyteOps(ops);
        if (ops.length < 2) {
            ErrorCollector.error('ABYTE requires offset and data', line.line, line.file);
            return;
        }
        const offset = this.evaluate(ops[0], line).value;
        for (let i = 1; i < ops.length; i++) {
            const op = ops[i];
            if ((op.startsWith('"') && op.endsWith('"')) || 
                (op.startsWith("'") && op.endsWith("'") && op.length > 2)) {
                const str = op.slice(1, -1);
                for (let j = 0; j < str.length; j++) {
                    this.emit((str.charCodeAt(j) + offset) & 0xFF);
                }
            } else {
                const val = this.evaluate(op, line);
                this.emit((val.value + offset) & 0xFF);
            }
        }
    },

    // ABYTEC offset, data... - like ABYTE but set bit 7 on last byte
    dirABYTEC(ops, line) {
        ops = this.parseAbyteOps(ops);
        if (ops.length < 2) {
            ErrorCollector.error('ABYTEC requires offset and data', line.line, line.file);
            return;
        }
        const offset = this.evaluate(ops[0], line).value;
        const bytes = [];
        
        for (let i = 1; i < ops.length; i++) {
            const op = ops[i];
            if ((op.startsWith('"') && op.endsWith('"')) || 
                (op.startsWith("'") && op.endsWith("'") && op.length > 2)) {
                const str = op.slice(1, -1);
                for (let j = 0; j < str.length; j++) {
                    bytes.push((str.charCodeAt(j) + offset) & 0xFF);
                }
            } else {
                const val = this.evaluate(op, line);
                bytes.push((val.value + offset) & 0xFF);
            }
        }
        
        // Set bit 7 on last byte
        for (let i = 0; i < bytes.length; i++) {
            if (i === bytes.length - 1) {
                this.emit(bytes[i] | 0x80);
            } else {
                this.emit(bytes[i]);
            }
        }
    },

    // ABYTEZ offset, data... - like ABYTE but add zero terminator
    dirABYTEZ(ops, line) {
        ops = this.parseAbyteOps(ops);
        if (ops.length < 2) {
            ErrorCollector.error('ABYTEZ requires offset and data', line.line, line.file);
            return;
        }
        const offset = this.evaluate(ops[0], line).value;
        for (let i = 1; i < ops.length; i++) {
            const op = ops[i];
            if ((op.startsWith('"') && op.endsWith('"')) || 
                (op.startsWith("'") && op.endsWith("'") && op.length > 2)) {
                const str = op.slice(1, -1);
                for (let j = 0; j < str.length; j++) {
                    this.emit((str.charCodeAt(j) + offset) & 0xFF);
                }
            } else {
                const val = this.evaluate(op, line);
                this.emit((val.value + offset) & 0xFF);
            }
        }
        this.emit(0);  // Zero terminator
    },

    // ALIGN directive
    dirALIGN(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('ALIGN requires alignment value', line.line, line.file);
        }
        const align = this.evaluate(ops[0], line);
        const fill = ops.length > 1 ? this.evaluate(ops[1], line).value : 0;
        
        if (!align.undefined && align.value > 0) {
            while (this.currentAddress % align.value !== 0) {
                this.emit(fill & 0xFF);
            }
        }
    },

    // DISP/PHASE directive (displaced assembly)
    dirDISP(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('DISP requires an address', line.line, line.file);
        }
        const val = this.evaluate(ops[0], line);
        if (!val.undefined) {
            // Save current address as physical address
            this.physicalAddress = this.currentAddress;
            // Set logical address to DISP value
            this.currentAddress = val.value;
        }
    },

    // ENT/DEPHASE directive
    dirENT(ops, line) {
        // Return to physical address
        if (this.physicalAddress !== null) {
            this.currentAddress = this.physicalAddress;
            this.physicalAddress = null;
        }
    },

    // ASSERT directive - only evaluate on final pass when all symbols are resolved
    dirASSERT(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('ASSERT requires a condition', line.line, line.file);
        }
        // Skip ASSERT evaluation until final pass to allow forward references
        if (this.pass < 2) {
            return;
        }
        const val = this.evaluate(ops[0], line);
        // Only fail if expression is fully resolved and evaluates to 0
        if (!val.undefined && val.value === 0) {
            const msg = ops.length > 1 ? ops[1] : 'Assertion failed';
            ErrorCollector.error(`ASSERT: ${msg}`, line.line, line.file);
        }
    },

    // DEVICE directive
    dirDEVICE(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('DEVICE requires a device name', line.line, line.file);
        }
        AsmMemory.setDevice(ops[0]);
    },

    // SLOT directive
    dirSLOT(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('SLOT requires a slot number', line.line, line.file);
        }
        const val = this.evaluate(ops[0], line);
        if (!val.undefined) {
            AsmMemory.setCurrentSlot(val.value);
        }
    },

    // PAGE directive
    dirPAGE(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('PAGE requires a page number', line.line, line.file);
        }
        const val = this.evaluate(ops[0], line);
        if (!val.undefined) {
            AsmMemory.setSlot(AsmMemory.currentSlot, val.value);
        }
    },

    // ==================== Conditionals ====================

    dirIF(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('IF requires an expression', line.line, line.file);
            return;
        }
        Preprocessor.processIF(ops[0], SymbolTable.toObject());
    },

    dirIFDEF(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('IFDEF requires a symbol name', line.line, line.file);
            return;
        }
        Preprocessor.processIFDEF(ops[0], SymbolTable.toObject());
    },

    dirIFNDEF(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('IFNDEF requires a symbol name', line.line, line.file);
            return;
        }
        Preprocessor.processIFNDEF(ops[0], SymbolTable.toObject());
    },

    dirIFUSED(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('IFUSED requires a symbol name', line.line, line.file);
            return;
        }
        Preprocessor.processIFUSED(ops[0], SymbolTable.symbols);
    },

    dirIFNUSED(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('IFNUSED requires a symbol name', line.line, line.file);
            return;
        }
        Preprocessor.processIFNUSED(ops[0], SymbolTable.symbols);
    },

    dirELSEIF(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('ELSEIF requires an expression', line.line, line.file);
            return;
        }
        Preprocessor.processELSEIF(ops[0], SymbolTable.toObject());
    },

    // ==================== Macros ====================

    macroDefinition: null,  // Current macro being defined

    startMacroDefinition(ops, line) {
        let name, params = [];
        
        // Format 1: "label MACRO" - name is in line.label
        if (ops.length === 0 && line.label) {
            name = line.label;
        }
        // Format 2: "MACRO name, params" - name is first operand
        else if (ops.length >= 1) {
            // First operand might be "NAME param1" (space-separated) or just "NAME"
            const firstParts = ops[0].trim().split(/\s+/);
            name = firstParts[0];
            
            // Collect params: rest of first operand + remaining operands
            if (firstParts.length > 1) {
                params.push(...firstParts.slice(1));
            }
            params.push(...ops.slice(1));
        }
        else {
            ErrorCollector.error('MACRO requires a name', line.line, line.file);
            return;
        }
        
        this.macroDefinition = {
            name: name,
            params: params,
            body: []
        };
    },

    endMacroDefinition(line) {
        if (!this.macroDefinition) {
            ErrorCollector.error('ENDM without MACRO', line.line, line.file);
            return;
        }
        Preprocessor.defineMacro(
            this.macroDefinition.name,
            this.macroDefinition.params,
            this.macroDefinition.body
        );
        this.macroDefinition = null;
    },

    tryMacroCall(line) {
        const name = line.directive;
        if (!Preprocessor.isMacro(name)) {
            return false;
        }
        
        // OPTIMIZATION: Don't expand macros inside inactive conditional blocks
        // This is critical for projects like HOTM with nested IF/ENDIF in macros
        if (!Preprocessor.isActive()) {
            return true;  // Return true to indicate it WAS a macro, just skipped
        }
        
        // Intercept MD5CHECK macro to capture filename -> MD5 associations
        if (name.toUpperCase() === 'MD5CHECK' && line.operands.length >= 2) {
            const filename = this.resolveFilename(line.operands[0], line);
            const md5 = this.resolveFilename(line.operands[1], line);
            if (filename && md5 && /^[a-fA-F0-9]{32}$/.test(md5)) {
                this.md5Associations[filename.toLowerCase()] = md5.toLowerCase();
            }
        }
        
        this.macroCount++;
        const expanded = Preprocessor.expandMacro(name, line.operands, this.macroCount);
        if (expanded) {
            // Parse and process expanded lines
            for (const expandedLine of expanded) {
                const parsed = Parser.parse(expandedLine, line.file || '<macro>')[0];
                if (parsed) {
                    // Preserve original file/line info from macro call site
                    parsed.file = line.file;
                    parsed.line = line.line;
                    this.processLine(parsed);
                }
            }
        }
        return true;
    },

    // ==================== REPT/DUP ====================

    reptState: null,  // Current REPT being collected

    dirREPT(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('REPT requires a count', line.line, line.file);
            return;
        }
        const val = this.evaluate(ops[0], line);
        if (!val.undefined) {
            this.reptState = {
                count: val.value,
                body: [],
                startLine: line.line,
                file: line.file
            };
        }
    },

    dirDUP(ops, line) {
        this.dirREPT(ops, line);
    },

    // ==================== STRUCT ====================

    dirSTRUCT(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('STRUCT requires a name', line.line, line.file);
            return;
        }
        Preprocessor.startSTRUCT(ops[0]);
    },

    dirENDS(line) {
        const struct = Preprocessor.endSTRUCT();
        if (struct) {
            // Define struct size as constant
            EquTable.define(struct.name, struct.offset, line.line, line.file);
            // Define field offsets
            for (const field of struct.fields) {
                EquTable.define(`${struct.name}.${field.name}`, field.offset, line.line, line.file);
                
                // If field is a nested struct type, define nested field symbols
                if (field.defaultValue && field.defaultValue.type === 'struct') {
                    const nestedDef = Preprocessor.getSTRUCT(field.defaultValue.structType);
                    if (nestedDef) {
                        for (const nestedField of nestedDef.fields) {
                            const combinedOffset = field.offset + nestedField.offset;
                            EquTable.define(`${struct.name}.${field.name}.${nestedField.name}`, combinedOffset, line.line, line.file);
                        }
                    }
                }
            }
        }
    },

    // ==================== CHARSET ====================

    dirCHARSET(ops, line) {
        if (ops.length === 0) {
            Preprocessor.resetCHARSET();
            return;
        }
        if (ops.length >= 3) {
            // CHARSET 'A', 'Z', 128
            const from = ops[0].replace(/['"]/g, '');
            const to = ops[1].replace(/['"]/g, '');
            const val = this.evaluate(ops[2], line);
            if (!val.undefined) {
                Preprocessor.setCHARSET(from, to, val.value);
            }
        } else if (ops.length === 2) {
            // CHARSET char, value
            const from = this.evaluate(ops[0], line);
            const to = this.evaluate(ops[1], line);
            if (!from.undefined && !to.undefined) {
                Preprocessor.setCHARSET(from.value, to.value, 0);
            }
        }
    },

    // ==================== MODULE ====================

    dirMODULE(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('MODULE requires a name', line.line, line.file);
            return;
        }
        SymbolTable.enterModule(ops[0]);
    },

    // ==================== INCLUDE / INCBIN ====================

    // Track included files to prevent infinite recursion
    includeStack: [],
    maxIncludeDepth: 32,

    dirINCLUDE(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('INCLUDE requires a filename', line.line, line.file);
            return;
        }

        // Get filename (strip quotes if present)
        let filename = ops[0];
        if ((filename.startsWith('"') && filename.endsWith('"')) ||
            (filename.startsWith("'") && filename.endsWith("'"))) {
            filename = filename.slice(1, -1);
        }

        // Check recursion depth
        if (this.includeStack.length >= this.maxIncludeDepth) {
            ErrorCollector.error(`Include depth exceeded (max ${this.maxIncludeDepth})`, line.line, line.file);
            return;
        }

        // Get file from VFS
        const file = VFS.getFile(filename, line.file);
        if (!file || file.error) {
            ErrorCollector.error(file ? file.error : `File not found: ${filename}`, line.line, line.file);
            return;
        }

        // Check for circular include
        if (this.includeStack.includes(file.path)) {
            ErrorCollector.error(`Circular include detected: ${filename}`, line.line, line.file);
            return;
        }

        // Push onto include stack
        this.includeStack.push(file.path);

        // Parse the included file
        const includedLines = Parser.parse(file.content, file.path);

        // Process included lines
        if (includedLines) {
            for (const includedLine of includedLines) {
                this.processLine(includedLine);
            }
        }

        // Pop include stack
        this.includeStack.pop();
    },

    dirINCBIN(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('INCBIN requires a filename', line.line, line.file);
            return;
        }

        // Get filename (strip quotes if present)
        let filename = ops[0];
        if ((filename.startsWith('"') && filename.endsWith('"')) ||
            (filename.startsWith("'") && filename.endsWith("'"))) {
            filename = filename.slice(1, -1);
        }

        // Parse optional offset and length
        let offset = 0;
        let length = -1;  // -1 means entire file

        if (ops.length >= 2) {
            const offsetVal = this.evaluate(ops[1], line);
            if (!offsetVal.undefined) {
                offset = offsetVal.value;
            }
        }

        if (ops.length >= 3) {
            const lengthVal = this.evaluate(ops[2], line);
            if (!lengthVal.undefined) {
                length = lengthVal.value;
            }
        }

        // Get file from VFS
        const file = VFS.getBinaryFile(filename, line.file);
        if (file.error) {
            ErrorCollector.error(file.error, line.line, line.file);
            return;
        }

        // Apply offset and length
        let data = file.content;
        if (offset > 0) {
            if (offset >= data.length) {
                ErrorCollector.error(`INCBIN offset ${offset} exceeds file size ${data.length}`, line.line, line.file);
                return;
            }
            data = data.slice(offset);
        }

        if (length >= 0) {
            if (length > data.length) {
                ErrorCollector.warn(`INCBIN length ${length} exceeds available data ${data.length}`, line.line, line.file);
            }
            data = data.slice(0, length);
        }

        // Emit bytes
        if (data) {
            for (const byte of data) {
                this.emit(byte);
            }
        }
    },

    // ==================== SAVE DIRECTIVES ====================

    // SAVEBIN "filename", start, length
    // Extract expected MD5 from comment like "; md5: abc123" or "; md5 check: abc123"
    extractExpectedMD5(comment) {
        if (!comment) return null;
        const match = comment.match(/;\s*md5(?:\s*check)?:\s*([a-fA-F0-9]{32})/i);
        return match ? match[1].toLowerCase() : null;
    },
    
    // Get expected MD5 from comment or MD5CHECK macro associations
    getExpectedMD5(filename, comment) {
        // First check comment (higher priority - inline with SAVE directive)
        const commentMD5 = this.extractExpectedMD5(comment);
        if (commentMD5) return commentMD5;
        
        // Then check MD5CHECK associations
        if (filename && this.md5Associations[filename.toLowerCase()]) {
            return this.md5Associations[filename.toLowerCase()];
        }
        
        return null;
    },

    dirSAVEBIN(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('SAVEBIN requires filename', line.line, line.file);
            return;
        }
        
        const filename = this.resolveFilename(ops[0], line);
        
        let start = this.outputStart;
        let length = -1; // -1 means all
        
        if (ops.length >= 2) {
            const startVal = this.evaluate(ops[1], line);
            if (!startVal.undefined) {
                start = startVal.value;
            }
        }
        
        if (ops.length >= 3) {
            const lengthVal = this.evaluate(ops[2], line);
            if (!lengthVal.undefined) {
                length = lengthVal.value;
            }
        }
        
        // Capture data NOW - memory may be overwritten later by subsequent code
        // saveCommands is reset each pass, so final pass capture is what we keep
        let capturedData = null;
        const actualLength = length > 0 ? length : 
            (AsmMemory.device ? 0x10000 - start : Math.max(0, this.output.length - (start - this.outputStart)));
        if (actualLength > 0) {
            if (AsmMemory.device) {
                capturedData = new Uint8Array(actualLength);
                for (let i = 0; i < actualLength; i++) {
                    capturedData[i] = AsmMemory.readByte(start + i);
                }
            } else if (start >= this.outputStart) {
                const dataStart = start - this.outputStart;
                capturedData = new Uint8Array(this.output.slice(dataStart, dataStart + actualLength));
            }
        }
        
        this.saveCommands.push({
            type: 'bin',
            filename: filename,
            start: start,
            length: length,
            capturedData: capturedData,
            expectedMD5: this.getExpectedMD5(filename, line.comment)
        });
    },

    // SAVESNA "filename", startaddr
    dirSAVESNA(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('SAVESNA requires filename', line.line, line.file);
            return;
        }
        
        const filename = this.resolveFilename(ops[0], line);
        
        let startAddr = this.outputStart;
        
        if (ops.length >= 2) {
            const startVal = this.evaluate(ops[1], line);
            if (!startVal.undefined) {
                startAddr = startVal.value;
            }
        }
        
        this.saveCommands.push({
            type: 'sna',
            filename: filename,
            start: startAddr,
            expectedMD5: this.getExpectedMD5(filename, line.comment)
        });
    },

    // EMPTYTAP "filename" - Create/truncate TAP file
    dirEMPTYTAP(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('EMPTYTAP requires filename', line.line, line.file);
            return;
        }
        
        const filename = this.resolveFilename(ops[0], line);
        
        this.saveCommands.push({
            type: 'emptytap',
            filename: filename
        });
    },

    // SAVETAP - Multiple forms:
    // Simple: SAVETAP "file", start - creates CODE block with BASIC loader
    // SAVETAP "file", BASIC, "name", start, length[, autorun[, lengthwithoutvars]]
    // SAVETAP "file", CODE, "name", start, length[, customstart[, param3]]
    // SAVETAP "file", NUMBERS, "name", start, length[, varletter]
    // SAVETAP "file", CHARS, "name", start, length[, varletter]
    // SAVETAP "file", HEADLESS, start, length[, flag]
    dirSAVETAP(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('SAVETAP requires filename', line.line, line.file);
            return;
        }
        
        const filename = this.resolveFilename(ops[0], line);
        
        // Default values
        let blockType = 'SNAPSHOT';  // Simple form creates snapshot with loader
        let blockName = filename.replace(/\.tap$/i, '').slice(0, 10);
        let startAddr = this.outputStart;
        let length = -1;
        let param1 = 0;  // autorun line, custom start, or var letter
        let param2 = -1;  // length without vars, param3, or flag (-1 = use default)
        
        if (ops.length >= 2) {
            const second = ops[1].toUpperCase();
            
            if (second === 'BASIC' || second === 'CODE' || second === 'NUMBERS' || 
                second === 'CHARS' || second === 'HEADLESS') {
                blockType = second;
                
                if (blockType === 'HEADLESS') {
                    // SAVETAP "file", HEADLESS, start, length[, flag]
                    // Default flag for HEADLESS is 0xFF (data block)
                    param1 = 0xFF;
                    if (ops.length >= 3) {
                        const startVal = this.evaluate(ops[2], line);
                        if (!startVal.undefined) startAddr = startVal.value;
                    }
                    if (ops.length >= 4) {
                        const lengthVal = this.evaluate(ops[3], line);
                        if (!lengthVal.undefined) length = lengthVal.value;
                    }
                    if (ops.length >= 5) {
                        const flagVal = this.evaluate(ops[4], line);
                        if (!flagVal.undefined) param1 = flagVal.value;  // custom flag
                    }
                } else {
                    // BASIC/CODE/NUMBERS/CHARS: "file", TYPE, "name", start, length[, p1[, p2]]
                    if (ops.length >= 3) {
                        // Block name can be quoted string or symbol reference
                        blockName = this.resolveFilename(ops[2], line).slice(0, 10);
                    }
                    if (ops.length >= 4) {
                        const startVal = this.evaluate(ops[3], line);
                        if (!startVal.undefined) startAddr = startVal.value;
                    }
                    if (ops.length >= 5) {
                        const lengthVal = this.evaluate(ops[4], line);
                        if (!lengthVal.undefined) length = lengthVal.value;
                    }
                    if (ops.length >= 6) {
                        // For NUMBERS/CHARS this could be a character like 'a'
                        let p1 = ops[5];
                        if ((p1.startsWith("'") && p1.endsWith("'")) && p1.length === 3) {
                            param1 = p1.charCodeAt(1);  // Variable letter
                        } else {
                            const p1Val = this.evaluate(ops[5], line);
                            if (!p1Val.undefined) param1 = p1Val.value;
                        }
                    }
                    if (ops.length >= 7) {
                        const p2Val = this.evaluate(ops[6], line);
                        if (!p2Val.undefined) param2 = p2Val.value;
                    }
                }
            } else {
                // Simple form: SAVETAP "file", start - creates snapshot with BASIC loader
                const startVal = this.evaluate(ops[1], line);
                if (!startVal.undefined) {
                    startAddr = startVal.value;
                }
            }
        }
        
        // Capture data NOW - memory may be overwritten later by subsequent code
        let capturedData = null;
        const actualLength = length > 0 ? length : 
            (AsmMemory.device ? 0x10000 - startAddr : Math.max(0, this.output.length - (startAddr - this.outputStart)));
        if (actualLength > 0) {
            if (AsmMemory.device) {
                capturedData = new Uint8Array(actualLength);
                for (let i = 0; i < actualLength; i++) {
                    capturedData[i] = AsmMemory.readByte(startAddr + i);
                }
            } else if (startAddr >= this.outputStart) {
                const dataStart = startAddr - this.outputStart;
                capturedData = new Uint8Array(this.output.slice(dataStart, dataStart + actualLength));
            }
        }
        
        this.saveCommands.push({
            type: 'tap',
            filename: filename,
            blockType: blockType,
            blockName: blockName,
            start: startAddr,
            length: length,
            param1: param1,
            param2: param2,
            capturedData: capturedData,
            expectedMD5: this.getExpectedMD5(filename, line.comment)
        });
    },

    // EMPTYTRD "filename"[, "label"]
    // Creates an empty TRD disk image
    dirEMPTYTRD(ops, line) {
        if (ops.length < 1) {
            ErrorCollector.error('EMPTYTRD requires filename', line.line, line.file);
            return;
        }
        
        const filename = this.resolveFilename(ops[0], line);
        const label = ops.length >= 2 ? this.resolveFilename(ops[1], line) : 'sjasmplus';
        
        this.saveCommands.push({
            type: 'emptytrd',
            filename: filename,
            label: label,
            expectedMD5: this.getExpectedMD5(filename, line.comment)
        });
    },

    // SAVETRD "diskfile", "filename", start, length
    // SAVETRD "diskfile", "filename", type, start, length
    // type: BASIC, CODE, DATA, or character ('B', 'C', 'D', '#')
    dirSAVETRD(ops, line) {
        if (ops.length < 2) {
            ErrorCollector.error('SAVETRD requires disk filename and file name', line.line, line.file);
            return;
        }
        
        const diskFilename = this.resolveFilename(ops[0], line);
        const innerFilename = this.resolveFilename(ops[1], line).substring(0, 8);
        
        let fileType = 'C';
        let startAddr = this.outputStart;
        let length = -1;
        let opIndex = 2;
        
        if (ops.length >= 3) {
            // Check if third param is a type keyword or expression
            const third = ops[2].toUpperCase();
            if (third === 'BASIC' || third === 'CODE' || third === 'DATA' || 
                third === "'B'" || third === "'C'" || third === "'D'" || third === "'#'" ||
                third === 'B' || third === 'C' || third === 'D') {
                fileType = third.replace(/'/g, '').charAt(0);
                opIndex = 3;
            }
        }
        
        if (ops.length > opIndex) {
            const startVal = this.evaluate(ops[opIndex], line);
            if (!startVal.undefined) startAddr = startVal.value;
        }
        
        if (ops.length > opIndex + 1) {
            const lengthVal = this.evaluate(ops[opIndex + 1], line);
            if (!lengthVal.undefined) length = lengthVal.value;
        }
        
        // Capture data NOW - memory may be overwritten later by subsequent code
        let capturedData = null;
        const actualLength = length > 0 ? length : 
            (AsmMemory.device ? 0x10000 - startAddr : Math.max(0, this.output.length - (startAddr - this.outputStart)));
        if (actualLength > 0) {
            if (AsmMemory.device) {
                capturedData = new Uint8Array(actualLength);
                for (let i = 0; i < actualLength; i++) {
                    capturedData[i] = AsmMemory.readByte(startAddr + i);
                }
            } else if (startAddr >= this.outputStart) {
                const dataStart = startAddr - this.outputStart;
                capturedData = new Uint8Array(this.output.slice(dataStart, dataStart + actualLength));
            }
        }
        
        this.saveCommands.push({
            type: 'trd',
            trdFilename: diskFilename,
            innerFilename: innerFilename,
            filename: diskFilename,  // For display purposes
            fileType: fileType,
            start: startAddr,
            startAddr: startAddr,
            length: length,
            capturedData: capturedData,
            expectedMD5: this.getExpectedMD5(diskFilename, line.comment)
        });
    },

    // Process an instruction
  processInstruction(line) {
        // Check if this is a macro call (use original case)
        const macroName = line.instructionRaw || line.instruction;
        if (Preprocessor.isMacro(macroName)) {
            // Intercept MD5CHECK macro to capture filename -> MD5 associations
            if (macroName.toUpperCase() === 'MD5CHECK' && line.operands.length >= 2) {
                const filename = this.resolveFilename(line.operands[0], line);
                const md5 = this.resolveFilename(line.operands[1], line);
                if (filename && md5 && /^[a-fA-F0-9]{32}$/.test(md5)) {
                    this.md5Associations[filename.toLowerCase()] = md5.toLowerCase();
                }
            }
            
            this.macroCount++;
            const expanded = Preprocessor.expandMacro(macroName, line.operands, this.macroCount);
            if (expanded) {
                for (const expandedLine of expanded) {
                    const parsed = Parser.parse(expandedLine, line.file || '<macro>')[0];
                    if (parsed) {
                        // Preserve original file/line info from macro call site
                        parsed.file = line.file;
                        parsed.line = line.line;
                        this.processLine(parsed);
                    }
                }
            }
            return;
        }

        // Check if this is a struct instantiation
        const structDef = Preprocessor.getSTRUCT(macroName);
        if (structDef) {
            // Emit bytes for struct fields with provided values or defaults
            for (let i = 0; i < structDef.fields.length; i++) {
                const field = structDef.fields[i];
                let operand = i < line.operands.length ? line.operands[i] : null;
                
                // Check if operand is empty (just comma separator)
                const isEmpty = !operand || operand.trim() === '';
                
                if (!isEmpty) {
                    // Check for string operand "text" or 'text' format
                    let strValue = null;
                    if ((operand.startsWith('"') && operand.endsWith('"')) ||
                        (operand.startsWith("'") && operand.endsWith("'"))) {
                        strValue = operand.slice(1, -1);
                    }
                    // Also check {" "} or {"text"} format (legacy)
                    const strMatch = operand.match(/^\{['"](.*)['"]\}$/);
                    if (strMatch) {
                        strValue = strMatch[1];
                    }
                    
                    if (strValue !== null) {
                        // Emit string bytes, padded/truncated to field size
                        for (let b = 0; b < field.size; b++) {
                            this.emit(b < strValue.length ? strValue.charCodeAt(b) : 0x20); // Pad with spaces
                        }
                        continue;
                    }
                    
                    // Try to evaluate as expression
                    const val = this.evaluate(operand, line);
                    if (!val.undefined) {
                        // Emit bytes based on field size
                        for (let b = 0; b < field.size; b++) {
                            this.emit((val.value >> (b * 8)) & 0xFF);
                        }
                        continue;
                    }
                }
                
                // Use default value if available
                if (field.defaultValue) {
                    if (field.defaultValue.type === 'text') {
                        const str = field.defaultValue.value;
                        for (let b = 0; b < field.size; b++) {
                            this.emit(b < str.length ? str.charCodeAt(b) : 0x20);
                        }
                    } else {
                        // byte/word/dword
                        for (let b = 0; b < field.size; b++) {
                            this.emit((field.defaultValue.value >> (b * 8)) & 0xFF);
                        }
                    }
                } else {
                    // No default, emit zeros
                    for (let b = 0; b < field.size; b++) {
                        this.emit(0);
                    }
                }
            }
            return;
        }

        const result = InstructionEncoder.encode(
            line.instruction,
            line.operands,
            this.currentAddress,
            SymbolTable.toObject()
        );
        
        if (!result) {
            // If unknown instruction with no operands, treat as label definition
            // This handles labels without colons on their own line
            if (line.operands.length === 0) {
                // Use original case (instructionRaw) if available, otherwise instruction
                const labelName = line.instructionRaw || line.instruction;
                this.defineLabel(labelName, line.line, line.file);
                return;
            }
            // Could be a macro call - try again with original case
            const macroName = line.instructionRaw || line.instruction;
            if (Preprocessor.isMacro(macroName)) {
                this.macroCount++;
                const expanded = Preprocessor.expandMacro(macroName, line.operands, this.macroCount);
                if (expanded) {
                    for (const expandedLine of expanded) {
                        const parsed = Parser.parse(expandedLine, line.file || '<macro>')[0];
                        if (parsed) {
                            // Preserve original file/line info from macro call site
                            parsed.file = line.file;
                            parsed.line = line.line;
                            this.processLine(parsed);
                        }
                    }
                }
                return;
            }
            ErrorCollector.error(`Unknown instruction: ${macroName}`, line.line, line.file);
            return;
        }
        
        // Emit bytes
        if (result.bytes) {
            for (const byte of result.bytes) {
                this.emit(byte);
            }
        }
    },

    // Emit a byte to output
    emit(byte) {
        const b = byte & 0xFF;
        
        // Use physical address for output, logical address for labels
        const outputAddr = (this.physicalAddress !== null ? this.physicalAddress : this.currentAddress) & 0xFFFF;
        
        // When DEVICE is set, use Memory model
        if (AsmMemory.device) {
            AsmMemory.writeByte(outputAddr, b);
        }
        
        // Only add to linear output if within output range
        // This prevents ORG 0 tricks (for string length measurement) from polluting output
        if (outputAddr >= this.outputStart) {
            const offset = outputAddr - this.outputStart;
            // Fill gap if needed (handles forward ORG within output range)
            while (this.output.length < offset) {
                this.output.push(0);
            }
            if (offset === this.output.length) {
                this.output.push(b);
            } else if (offset < this.output.length) {
                // Overwrite existing byte (can happen with ORG tricks)
                this.output[offset] = b;
            }
        }
        
        // Advance both logical and physical addresses
        this.currentAddress++;
        this.currentAddress &= 0xFFFF;
        
        if (this.physicalAddress !== null) {
            this.physicalAddress++;
            this.physicalAddress &= 0xFFFF;
        }
    },

    // Evaluate an expression
    // Evaluate an expression
    evaluate(expr, line) {
        // Handle temp labels
        const tempMatch = /^(\d+)([BF])$/i.exec(expr);
        if (tempMatch) {
            const result = SymbolTable.parseTemp(expr, this.currentAddress, line.line);
            if (result) {
                return result;
            }
            return { value: 0, undefined: true };
        }
        
        return parseExpression(expr, SymbolTable.toObject(), this.currentAddress, this.sectionStart);
    }
};

