// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Error handling module

export class AssemblerError extends Error {
    constructor(message, line = null, file = null) {
        super(message);
        this.name = 'AssemblerError';
        this.line = line;
        this.file = file;
    }

    toString() {
        let loc = '';
        if (this.file) loc += `${this.file}`;
        if (this.line !== null) loc += `(${this.line})`;
        if (loc) loc += ': ';
        return `${loc}error: ${this.message}`;
    }
}

export class AssemblerWarning {
    constructor(message, line = null, file = null) {
        this.message = message;
        this.line = line;
        this.file = file;
    }

    toString() {
        let loc = '';
        if (this.file) loc += `${this.file}`;
        if (this.line !== null) loc += `(${this.line})`;
        if (loc) loc += ': ';
        return `${loc}warning: ${this.message}`;
    }
}

export const ErrorCollector = {
    warnings: [],
    errors: [],
    errorCount: 0,

    reset() {
        this.warnings = [];
        this.errors = [];
        this.errorCount = 0;
    },

    warn(message, line = null, file = null) {
        this.warnings.push(new AssemblerWarning(message, line, file));
    },

    error(message, line = null, file = null) {
        this.errorCount++;
        const err = new AssemblerError(message, line, file);
        this.errors.push({ message, line, file });
        throw err;
    }
};
