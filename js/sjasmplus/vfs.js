// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Virtual Filesystem - Handles multi-file projects, INCLUDE, INCBIN

export const VFS = {
    files: {},        // path -> { content, binary }
    basePath: '',     // Current base path for relative includes
    includePaths: [], // Additional search paths

    reset() {
        this.files = {};
        this.basePath = '';
        this.includePaths = [];
    },

    // Normalize path (handle .., ., etc)
    normalizePath(path) {
        // Convert backslashes to forward slashes
        path = path.replace(/\\/g, '/');

        // Remove leading ./
        path = path.replace(/^\.\//, '');

        // Handle .. by building path
        const parts = path.split('/');
        const result = [];

        for (const part of parts) {
            if (part === '..') {
                result.pop();
            } else if (part !== '.' && part !== '') {
                result.push(part);
            }
        }

        return result.join('/').toLowerCase();
    },

    // Resolve path relative to current file
    resolvePath(path, fromFile = '') {
        // Convert backslashes to forward slashes
        path = path.replace(/\\/g, '/');

        // If absolute (starts with /), treat as relative to project root
        if (path.startsWith('/')) {
            return this.normalizePath(path.slice(1));
        }

        // Get directory of current file
        let dir = '';
        if (fromFile) {
            const lastSlash = fromFile.lastIndexOf('/');
            if (lastSlash >= 0) {
                dir = fromFile.slice(0, lastSlash + 1);
            }
        } else if (this.basePath) {
            dir = this.basePath;
            if (!dir.endsWith('/')) dir += '/';
        }

        return this.normalizePath(dir + path);
    },

    // Add a text file
    addFile(path, content) {
        const normalized = this.normalizePath(path);
        this.files[normalized] = {
            content: content,
            binary: false
        };
    },

    // Add a binary file
    addBinaryFile(path, data) {
        const normalized = this.normalizePath(path);
        // Convert to Uint8Array if needed
        let bytes;
        if (data instanceof Uint8Array) {
            bytes = data;
        } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        } else if (Array.isArray(data)) {
            bytes = new Uint8Array(data);
        } else {
            bytes = new Uint8Array(0);
        }

        this.files[normalized] = {
            content: bytes,
            binary: true
        };
    },

    // Check if file exists
    exists(path, fromFile = '') {
        const resolved = this.resolvePath(path, fromFile);
        if (resolved in this.files) return true;

        // Try include paths
        for (const incPath of this.includePaths) {
            const tryPath = this.normalizePath(incPath + '/' + path);
            if (tryPath in this.files) return true;
        }

        return false;
    },

    // Get text file content
    getFile(path, fromFile = '') {
        const files = this.files || {};
        const resolved = this.resolvePath(path, fromFile);

        if (resolved in files) {
            const file = files[resolved];
            if (file.binary) {
                return { error: `Cannot INCLUDE binary file: ${path}` };
            }
            return { path: resolved, content: file.content };
        }

        // Try case-insensitive lookup on resolved path
        const resolvedLower = resolved.toLowerCase();
        for (const filePath in files) {
            if (filePath.toLowerCase() === resolvedLower) {
                const file = files[filePath];
                if (file.binary) {
                    return { error: `Cannot INCLUDE binary file: ${path}` };
                }
                return { path: filePath, content: file.content };
            }
        }

        // Try include paths
        for (const incPath of (this.includePaths || [])) {
            const tryPath = this.normalizePath(incPath + '/' + path);
            if (tryPath in files) {
                const file = files[tryPath];
                if (file.binary) {
                    return { error: `Cannot INCLUDE binary file: ${path}` };
                }
                return { path: tryPath, content: file.content };
            }
            // Case-insensitive
            const tryPathLower = tryPath.toLowerCase();
            for (const filePath in files) {
                if (filePath.toLowerCase() === tryPathLower) {
                    const file = files[filePath];
                    if (file.binary) {
                        return { error: `Cannot INCLUDE binary file: ${path}` };
                    }
                    return { path: filePath, content: file.content };
                }
            }
        }

        // Try without relative path - use path as-is from project root
        const normalizedPath = this.normalizePath(path);
        if (normalizedPath in files) {
            const file = files[normalizedPath];
            if (file.binary) {
                return { error: `Cannot INCLUDE binary file: ${path}` };
            }
            return { path: normalizedPath, content: file.content };
        }

        // Case-insensitive on normalized path
        const normalizedLower = normalizedPath.toLowerCase();
        for (const filePath in files) {
            if (filePath.toLowerCase() === normalizedLower) {
                const file = files[filePath];
                if (file.binary) {
                    return { error: `Cannot INCLUDE binary file: ${path}` };
                }
                return { path: filePath, content: file.content };
            }
        }

        // Final fallback: search by basename (case-insensitive)
        const basename = path.split('/').pop().toLowerCase();
        for (const filePath in files) {
            const fileBasename = filePath.split('/').pop().toLowerCase();
            if (fileBasename === basename) {
                const file = files[filePath];
                if (file.binary) {
                    return { error: `Cannot INCLUDE binary file: ${path}` };
                }
                return { path: filePath, content: file.content };
            }
        }

        return { error: `File not found: ${path}` };
    },

    // Get binary file content
    getBinaryFile(path, fromFile = '') {
        const files = this.files || {};
        const resolved = this.resolvePath(path, fromFile);

        // Helper to return file content as binary
        const getAsBinary = (filePath) => {
            const file = files[filePath];
            if (!file) return { error: `File not found: ${path}` };
            if (!file.binary) {
                // Text file - convert to bytes
                const content = file.content || '';
                const bytes = new Uint8Array(content.length);
                for (let i = 0; i < content.length; i++) {
                    bytes[i] = content.charCodeAt(i) & 0xFF;
                }
                return { path: filePath, content: bytes };
            }
            return { path: filePath, content: file.content };
        };

        if (resolved in files) {
            return getAsBinary(resolved);
        }

        // Case-insensitive lookup
        const resolvedLower = resolved.toLowerCase();
        for (const filePath in files) {
            if (filePath.toLowerCase() === resolvedLower) {
                return getAsBinary(filePath);
            }
        }

        // Try include paths
        for (const incPath of (this.includePaths || [])) {
            const tryPath = this.normalizePath(incPath + '/' + path);
            if (tryPath in files) {
                return getAsBinary(tryPath);
            }
            // Case-insensitive
            const tryPathLower = tryPath.toLowerCase();
            for (const filePath in files) {
                if (filePath.toLowerCase() === tryPathLower) {
                    return getAsBinary(filePath);
                }
            }
        }

        // Try without relative path - use path as-is from project root
        const normalizedPath = this.normalizePath(path);
        if (normalizedPath in files) {
            return getAsBinary(normalizedPath);
        }

        // Case-insensitive on normalized path
        const normalizedLower = normalizedPath.toLowerCase();
        for (const filePath in files) {
            if (filePath.toLowerCase() === normalizedLower) {
                return getAsBinary(filePath);
            }
        }

        // Final fallback: search by basename (case-insensitive)
        const basename = path.split('/').pop().toLowerCase();
        for (const filePath in files) {
            const fileBasename = filePath.split('/').pop().toLowerCase();
            if (fileBasename === basename) {
                return getAsBinary(filePath);
            }
        }

        return { error: `File not found: ${path}` };
    },

    // List all files
    listFiles() {
        return Object.keys(this.files || {}).sort();
    },

    // Find main file (entry point)
    findMainFile() {
        const files = this.listFiles();
        const asmFiles = files.filter(f =>
            f.endsWith('.asm') || f.endsWith('.z80') || f.endsWith('.s') || f.endsWith('.a80')
        );

        // First: check for explicit @main marker in any file
        for (const path of asmFiles) {
            const file = this.files[path];
            if (file.binary) continue;
            const content = file.content;
            // Check first 20 lines for marker
            const lines = content.split(/\r?\n/).slice(0, 20);
            for (const line of lines) {
                if (/^\s*;\s*@main\b/i.test(line)) {
                    return path;  // Explicit marker wins immediately
                }
            }
        }

        // Second pass: find which files are included by others
        const includedFiles = new Set();
        for (const path of asmFiles) {
            const file = this.files[path];
            if (file.binary) continue;
            const content = file.content;
            // Find all INCLUDE statements
            const matches = content.matchAll(/\bINCLUDE\s+["']?([^"'\s\n]+)["']?/gi);
            for (const match of matches) {
                const includedPath = match[1].replace(/\\/g, '/').toLowerCase();
                const basename = includedPath.split('/').pop();
                // Mark both full path and basename as included
                includedFiles.add(includedPath);
                includedFiles.add(basename);
            }
        }

        // Score each file based on content
        let bestFile = null;
        let bestScore = -1;

        for (const path of asmFiles) {
            const file = this.files[path];
            if (file.binary) continue;

            const content = file.content.toUpperCase();
            let score = 0;

            // PENALIZE files that are included by others FIRST - they're not the main file
            const name = path.split('/').pop().toLowerCase();
            if (includedFiles.has(path.toLowerCase()) || includedFiles.has(name)) {
                score -= 5000;  // Strong penalty - included files should almost never win
            }

            // VERY strong indicators of main file - output directives
            if (/\bSAVESNA\b/.test(content)) score += 2000;
            if (/\bSAVETAP\b/.test(content)) score += 2000;
            if (/\bSAVEBIN\b/.test(content)) score += 2000;

            // Strong indicators
            if (/\bDEVICE\b/.test(content)) score += 100;
            if (/\bORG\b/.test(content)) score += 50;

            // Count includes - main file typically includes others (but cap the bonus)
            const includeCount = (content.match(/\bINCLUDE\b/g) || []).length;
            score += Math.min(includeCount * 10, 200);  // Cap at 200 points

            // Prefer files at root level
            if (!path.includes('/')) score += 50;

            // Prefer common main file names
            if (name === 'main.asm' || name === 'main.z80' || name === 'main.a80') score += 100;
            if (name === 'start.asm' || name === 'start.z80' || name === 'start.a80') score += 80;
            if (name === 'game.asm' || name === 'program.asm' || name === 'game.a80') score += 60;
            if (name.includes('loader')) score += 150;  // Loader files are often the main entry

            if (score > bestScore) {
                bestScore = score;
                bestFile = path;
            }
        }

        return bestFile;
    },

    // Extract @define markers from a file's header comments
    // Format: ; @define NAME=VALUE or ; @define NAME (defaults to 1)
    getFileDefines(path) {
        const defines = [];
        const file = this.files[path];
        if (!file || file.binary) return defines;

        const lines = file.content.split(/\r?\n/).slice(0, 30);
        for (const line of lines) {
            const match = line.match(/^\s*;\s*@define\s+(\w+)(?:\s*=\s*(.+))?/i);
            if (match) {
                const name = match[1];
                const value = match[2] ? match[2].trim() : '1';
                defines.push({ name, value });
            }
        }
        return defines;
    },

    // Add include path
    addIncludePath(path) {
        const normalized = this.normalizePath(path);
        if (!this.includePaths.includes(normalized)) {
            this.includePaths.push(normalized);
        }
    },

    // Set base path for relative includes
    setBasePath(path) {
        this.basePath = this.normalizePath(path);
    }
};
