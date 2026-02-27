// ========== Assembler Tab ==========
// Extracted from index.html inline script (lines 22829-27435)

import { VFS } from '../sjasmplus/vfs.js';
import { Assembler } from '../sjasmplus/assembler.js';
import { ErrorCollector } from '../sjasmplus/errors.js';
import { MD5 } from '../sjasmplus/md5.js';
import { is128kCompat } from '../core/machines.js';

// External dependencies (set via init function)
let spectrum = null;
let showMessage = null;
let hex8 = null;
let hex16 = null;
let downloadFile = null;
let updateDebugger = null;
let goToAddress = null;
let labelManager = null;
let regionManager = null;
let subroutineManager = null;
let xrefManager = null;
let undoManager = null;
let REGION_TYPES = null;
let Disassembler = null;
let SjASMPlus = null;
let disasm = null;
let commentManager = null;
let parseTextRegion = null;
let parseWordRegion = null;
let parseByteRegion = null;
let APP_VERSION = null;
let exportSnapshot = null;
let asmFontSizeSelect = null;
let traceManager = null;
let foldManager = null;
let operandFormatManager = null;
let navPushHistory = null;
let getDisasmViewAddress = null;
let setDisasmViewAddress = null;
let getLeftNavHistory = null;
let updateNavButtons = null;

// ========== Assembler ==========
let currentProjectMainFile = null;  // Main file for compilation
let currentOpenFile = null;         // Currently displayed file in editor
let openTabs = [];                  // List of open tab paths
let fileModified = {};              // Track modified state per file
export function updateProjectButtons() {
    const fileCount = Object.keys(VFS.files).length;
    const hasFiles = fileCount > 0;
    const hasMultipleFiles = fileCount > 1;
    const hasContent = asmEditor && asmEditor.value.trim().length > 0;

    if (btnAsmExport) {
        btnAsmExport.style.display = hasFiles ? 'inline-block' : 'none';
    }
    // Files button: always visible, disabled when 0 or 1 file
    if (btnAsmFiles) {
        btnAsmFiles.disabled = !hasMultipleFiles;
    }
    if (asmMainFileLabel) {
        if (currentProjectMainFile && hasFiles) {
            asmMainFileLabel.style.display = 'inline';
            asmMainFileLabel.textContent = currentProjectMainFile.split('/').pop();
        } else {
            asmMainFileLabel.style.display = 'none';
        }
    }
    // Enable Assemble if there's content in editor or files in VFS
    if (btnAsmAssemble) {
        btnAsmAssemble.disabled = !(hasContent || hasFiles);
    }
}

export function updateFilesList() {
    if (!asmFilesList) return;
    asmFilesList.innerHTML = '';

    const files = VFS.listFiles();

    // Sort by directory then filename
    files.sort((a, b) => {
        const dirA = a.includes('/') ? a.substring(0, a.lastIndexOf('/')) : '';
        const dirB = b.includes('/') ? b.substring(0, b.lastIndexOf('/')) : '';
        const nameA = a.split('/').pop().toLowerCase();
        const nameB = b.split('/').pop().toLowerCase();

        // First compare directories
        if (dirA !== dirB) {
            // Root files (no directory) come first
            if (!dirA) return -1;
            if (!dirB) return 1;
            return dirA.localeCompare(dirB);
        }
        // Then compare filenames
        return nameA.localeCompare(nameB);
    });

    for (const path of files) {
        const file = VFS.files[path];
        const name = path.split('/').pop();
        const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/') + 1) : '';
        const isBinary = file.binary;
        const isMain = path === currentProjectMainFile;
        const isOpen = openTabs.includes(path);
        const size = isBinary ? file.content.length : file.content.length;

        const item = document.createElement('div');
        item.className = 'asm-files-list-item';
        if (isMain) item.classList.add('main');
        if (isBinary) item.classList.add('binary');
        if (isOpen) item.classList.add('open');

        const icon = isBinary ? '📦' : (isMain ? '▶' : '📄');
        const sizeStr = size < 1024 ? `${size}b` : `${(size/1024).toFixed(1)}K`;
        const dirHtml = dir ? `<span class="file-dir">${dir}</span>` : '';

        item.innerHTML = `
            <span class="file-icon">${icon}</span>
            <span class="file-name" title="${path}">${dirHtml}${name}</span>
            <span class="file-size">${sizeStr}</span>
        `;

        item.addEventListener('click', () => {
            openFileTab(path);
            asmFilesList.classList.remove('show');
        });

        asmFilesList.appendChild(item);
    }
}

export function openFileTab(path) {
    const file = VFS.files[path];
    if (!file) {
        console.warn('openFileTab: file not found:', path);
        return;
    }

    // Save current editor content to previous file (only if it's a text file)
    if (currentOpenFile && VFS.files[currentOpenFile] && !VFS.files[currentOpenFile].binary) {
        VFS.files[currentOpenFile].content = asmEditor.value;
    }

    // Add to open tabs if not already open
    if (!openTabs.includes(path)) {
        openTabs.push(path);
    }

    // Load file content into editor
    if (file.binary) {
        asmEditor.value = `; Binary file: ${path}\n; Size: ${file.content.length} bytes\n; Cannot edit binary files`;
        asmEditor.disabled = true;
    } else {
        asmEditor.value = file.content || '';
        asmEditor.disabled = false;
    }

    currentOpenFile = path;
    updateLineNumbers();
    updateHighlight();
    updateFileTabs();

    // Update defines dropdown when opening main file
    if (path === currentProjectMainFile || !currentProjectMainFile) {
        updateDefinesDropdown();
    }
}

export function closeFileTab(path) {
    const idx = openTabs.indexOf(path);
    if (idx === -1) return;

    openTabs.splice(idx, 1);
    delete fileModified[path];

    // If closing current file, switch to another
    if (currentOpenFile === path) {
        if (openTabs.length > 0) {
            openFileTab(openTabs[Math.min(idx, openTabs.length - 1)]);
        } else {
            currentOpenFile = null;
            asmEditor.value = '';
            asmEditor.disabled = false;
            updateLineNumbers();
            updateHighlight();
        }
    }

    updateFileTabs();
}

export function updateFileTabs() {
    if (!asmFileTabs) return;
    asmFileTabs.innerHTML = '';

    for (const path of openTabs) {
        const file = VFS.files[path];
        if (!file) continue;

        const tab = document.createElement('div');
        tab.className = 'asm-file-tab';
        if (path === currentOpenFile) tab.classList.add('active');
        if (path === currentProjectMainFile) tab.classList.add('main');
        if (file.binary) tab.classList.add('binary');
        if (fileModified[path]) tab.classList.add('modified');

        const name = path.split('/').pop();
        tab.innerHTML = `<span class="tab-name" title="${path}">${name}</span><span class="tab-close">×</span>`;

        // Click on tab (anywhere except close button) to switch
        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                openFileTab(path);
            }
        });

        // Close button
        tab.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeFileTab(path);
        });

        // Right-click to set as main file
        tab.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!file.binary) {
                currentProjectMainFile = path;
                updateFileTabs();
                updateProjectButtons();
                showMessage(`Main file set to: ${name}`);
            }
        });

        asmFileTabs.appendChild(tab);
    }
}

export function showMainFileDialog(files, title = 'Select Main File') {
    return new Promise((resolve) => {
        const asmFiles = files.filter(f => {
            const ext = '.' + f.split('.').pop().toLowerCase();
            return ['.asm', '.z80', '.s', '.a80'].includes(ext);
        });

        if (asmFiles.length === 0) {
            showMessage('No assembly files found');
            resolve(null);
            return;
        }

        if (asmFiles.length === 1) {
            resolve(asmFiles[0]);
            return;
        }

        // Auto-detect main file
        const detected = VFS.findMainFile();

        // Sort files: detected main file first, then alphabetically
        asmFiles.sort((a, b) => a.localeCompare(b));
        if (detected) {
            // Find detected file (exact match or case-insensitive)
            let idx = asmFiles.indexOf(detected);
            if (idx === -1) {
                const detectedLower = detected.toLowerCase();
                idx = asmFiles.findIndex(f => f.toLowerCase() === detectedLower);
            }
            if (idx > 0) {
                const mainFile = asmFiles.splice(idx, 1)[0];
                asmFiles.unshift(mainFile);
            }
        }

        // Build dialog content
        fileSelectorTitle.textContent = title;
        fileSelectorBody.innerHTML = '';

        for (const path of asmFiles) {
            const name = path.split('/').pop();
            const isDetected = path === detected;

            const item = document.createElement('div');
            item.className = 'file-selector-item';
            if (isDetected) item.classList.add('detected');

            item.innerHTML = `
                <span class="item-icon">📄</span>
                <span class="item-name">${path}</span>
                ${isDetected ? '<span class="item-hint">detected</span>' : ''}
            `;

            item.addEventListener('click', () => {
                fileSelectorDialog.classList.add('hidden');
                resolve(path);
            });

            fileSelectorBody.appendChild(item);
        }

        // Show dialog
        fileSelectorDialog.classList.remove('hidden');

        // Handle close button - use detected or first file
        const closeHandler = () => {
            fileSelectorDialog.classList.add('hidden');
            resolve(detected || asmFiles[0]);
        };
        btnFileSelectorClose.onclick = closeHandler;

        // Click outside to close
        fileSelectorDialog.onclick = (e) => {
            if (e.target === fileSelectorDialog) {
                closeHandler();
            }
        };
    });
}

export function tokenizeAsmLine(line) {
    const tokens = [];
    let pos = 0;

    while (pos < line.length) {
        const ch = line[pos];

        // Whitespace
        if (ch === ' ' || ch === '\t') {
            let start = pos;
            while (pos < line.length && (line[pos] === ' ' || line[pos] === '\t')) {
                pos++;
            }
            tokens.push({ type: 'whitespace', value: line.slice(start, pos) });
            continue;
        }

        // Comment (;)
        if (ch === ';') {
            tokens.push({ type: 'comment', value: line.slice(pos) });
            break;
        }

        // String
        if (ch === '"' || ch === "'") {
            const quote = ch;
            let start = pos;
            pos++;
            while (pos < line.length && line[pos] !== quote) {
                if (line[pos] === '\\' && pos + 1 < line.length) pos++;
                pos++;
            }
            if (pos < line.length) pos++; // closing quote
            tokens.push({ type: 'string', value: line.slice(start, pos) });
            continue;
        }

        // Number: $hex, #hex, 0x, %, binary, decimal, or suffix-based
        if (/[0-9$#%]/.test(ch)) {
            let start = pos;
            if (ch === '$' || ch === '#') {
                pos++;
                while (pos < line.length && /[0-9a-fA-F_]/.test(line[pos])) pos++;
            } else if (ch === '%') {
                pos++;
                while (pos < line.length && /[01_]/.test(line[pos])) pos++;
            } else if (ch === '0' && pos + 1 < line.length && (line[pos + 1] === 'x' || line[pos + 1] === 'X')) {
                pos += 2;
                while (pos < line.length && /[0-9a-fA-F_]/.test(line[pos])) pos++;
            } else {
                while (pos < line.length && /[0-9a-fA-F_]/.test(line[pos])) pos++;
                if (pos < line.length && /[hHbBoOdDqQ]/.test(line[pos])) pos++;
            }
            tokens.push({ type: 'number', value: line.slice(start, pos) });
            continue;
        }

        // Identifier (label, instruction, register)
        if (/[a-zA-Z_.]/.test(ch) || ch === '@') {
            let start = pos;
            pos++;
            while (pos < line.length && /[a-zA-Z0-9_]/.test(line[pos])) pos++;
            if (pos < line.length && line[pos] === "'") pos++; // AF'
            const value = line.slice(start, pos);
            const upper = value.toUpperCase();

            // Check for colon after (label definition)
            let isLabel = false;
            let colonPos = pos;
            while (colonPos < line.length && (line[colonPos] === ' ' || line[colonPos] === '\t')) colonPos++;
            if (colonPos < line.length && line[colonPos] === ':') {
                isLabel = true;
            }
            // Also check if starts with . (local label)
            if (value.startsWith('.')) isLabel = true;

            if (Z80_INSTRUCTIONS.has(upper)) {
                tokens.push({ type: 'instruction', value });
            } else if (Z80_DIRECTIVES.has(upper)) {
                tokens.push({ type: 'directive', value });
            } else if (Z80_REGISTERS.has(upper) || Z80_CONDITIONS.has(upper)) {
                tokens.push({ type: 'register', value });
            } else if (isLabel || start === 0) {
                tokens.push({ type: 'label', value });
            } else {
                tokens.push({ type: 'identifier', value });
            }
            continue;
        }

        // Operators and punctuation
        if (ch === '(' || ch === ')' || ch === '[' || ch === ']') {
            tokens.push({ type: 'paren', value: ch });
            pos++;
            continue;
        }

        if (ch === ':') {
            tokens.push({ type: 'colon', value: ch });
            pos++;
            continue;
        }

        if (ch === ',') {
            tokens.push({ type: 'comma', value: ch });
            pos++;
            continue;
        }

        if (/[+\-*\/%&|^~<>=!]/.test(ch)) {
            let start = pos;
            pos++;
            // Handle two-char operators
            if (pos < line.length && /[<>=&|]/.test(line[pos])) pos++;
            tokens.push({ type: 'operator', value: line.slice(start, pos) });
            continue;
        }

        // Unknown char
        tokens.push({ type: 'text', value: ch });
        pos++;
    }

    return tokens;
}

export function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function highlightAsmCode(code) {
    const lines = code.split('\n');
    return lines.map(line => {
        const tokens = tokenizeAsmLine(line);
        return tokens.map(token => {
            const escaped = escapeHtml(token.value);
            switch (token.type) {
                case 'instruction':
                    return `<span class="asm-hl-instruction">${escaped}</span>`;
                case 'directive':
                    return `<span class="asm-hl-directive">${escaped}</span>`;
                case 'register':
                    return `<span class="asm-hl-register">${escaped}</span>`;
                case 'number':
                    return `<span class="asm-hl-number">${escaped}</span>`;
                case 'string':
                    return `<span class="asm-hl-string">${escaped}</span>`;
                case 'label':
                    return `<span class="asm-hl-label">${escaped}</span>`;
                case 'comment':
                    return `<span class="asm-hl-comment">${escaped}</span>`;
                case 'paren':
                    return `<span class="asm-hl-paren">${escaped}</span>`;
                case 'operator':
                    return `<span class="asm-hl-operator">${escaped}</span>`;
                default:
                    return escaped;
            }
        }).join('');
    }).join('\n');
}

export function updateLineNumbers() {
    const lines = asmEditor.value.split('\n');
    const lineCount = lines.length;
    // Build line numbers without trailing newline to match textarea height
    const numbers = [];
    for (let i = 1; i <= lineCount; i++) {
        numbers.push(i);
    }
    asmLineNumbers.textContent = numbers.join('\n');
}

export function updateHighlight() {
    try {
        // Use exact same content as textarea - no extra newline
        // Add a zero-width space at end to prevent collapse if needed
        const code = asmEditor.value;
        asmHighlight.innerHTML = highlightAsmCode(code) + '\u200B';
        asmEditor.classList.add('highlighting');
    } catch (e) {
        console.error('Highlight error:', e);
        asmEditor.classList.remove('highlighting');
    }
}

export function syncScroll() {
    asmHighlight.scrollTop = asmEditor.scrollTop;
    asmHighlight.scrollLeft = asmEditor.scrollLeft;
    asmLineNumbers.scrollTop = asmEditor.scrollTop;
}

export function syncEditorToVFS() {
    if (currentOpenFile && VFS.files[currentOpenFile] && !VFS.files[currentOpenFile].binary) {
        VFS.files[currentOpenFile].content = asmEditor.value;
    }
}

export function findFilesByBasename(basename) {
    const matches = [];
    const basenameLower = basename.toLowerCase();
    for (const path of VFS.listFiles()) {
        const pathBasename = path.split('/').pop().toLowerCase();
        if (pathBasename === basenameLower) {
            matches.push(path);
        }
    }
    return matches;
}

export async function showFileReplaceDialog(filename, existingPaths) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="max-width: 400px;">
                <h3 style="margin-top:0;">File already exists</h3>
                <p>A file named "<b>${filename}</b>" already exists in the project.</p>
                <p>Where should the new file be placed?</p>
                <div id="fileReplaceOptions" style="margin: 15px 0;"></div>
                <div style="text-align: right;">
                    <button id="fileReplaceCancel" style="margin-right: 10px;">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const optionsDiv = overlay.querySelector('#fileReplaceOptions');

        // Add option to replace each existing file
        for (const path of existingPaths) {
            const btn = document.createElement('button');
            btn.style.cssText = 'display: block; width: 100%; margin: 5px 0; text-align: left; padding: 8px;';
            btn.textContent = `Replace: ${path}`;
            btn.onclick = () => {
                document.body.removeChild(overlay);
                resolve({ action: 'replace', path: path });
            };
            optionsDiv.appendChild(btn);
        }

        // Add option to create new file at root
        const rootPath = filename.toLowerCase();
        if (!existingPaths.includes(rootPath)) {
            const btn = document.createElement('button');
            btn.style.cssText = 'display: block; width: 100%; margin: 5px 0; text-align: left; padding: 8px;';
            btn.textContent = `Add as new: ${filename}`;
            btn.onclick = () => {
                document.body.removeChild(overlay);
                resolve({ action: 'new', path: filename });
            };
            optionsDiv.appendChild(btn);
        }

        overlay.querySelector('#fileReplaceCancel').onclick = () => {
            document.body.removeChild(overlay);
            resolve({ action: 'cancel' });
        };
    });
}

export async function loadAsmFiles(files) {
    const textExtensions = ['.asm', '.z80', '.s', '.a80', '.inc', '.txt', '.def', '.h'];
    let totalAdded = 0;
    let lastAddedFile = null;
    let needsMainFile = !currentProjectMainFile;

    try {
        for (const file of files) {
            const arrayBuffer = await file.arrayBuffer();

            // Check if it's a ZIP file
            if (file.name.toLowerCase().endsWith('.zip') && ZipLoader.isZip(arrayBuffer)) {
                const zipFiles = await ZipLoader.extract(arrayBuffer);

                // Track which files from ZIP will update open tabs
                const updatedPaths = [];

                for (const f of zipFiles) {
                    if (f.name.endsWith('/') || f.name.startsWith('.') || f.name.includes('/.')) continue;

                    const ext = '.' + f.name.split('.').pop().toLowerCase();
                    const isText = textExtensions.includes(ext);
                    const normalizedPath = VFS.normalizePath(f.name);

                    // Check if this file is already open in a tab
                    if (openTabs.includes(normalizedPath)) {
                        updatedPaths.push(normalizedPath);
                    }

                    if (isText) {
                        const decoder = new TextDecoder('utf-8');
                        VFS.addFile(f.name, decoder.decode(f.data));
                        if (['.asm', '.z80', '.s', '.a80'].includes(ext)) {
                            lastAddedFile = normalizedPath;
                        }
                    } else {
                        VFS.addBinaryFile(f.name, f.data);
                    }
                    totalAdded++;
                }

                // Remove updated files from open tabs so they get refreshed
                for (const path of updatedPaths) {
                    const idx = openTabs.indexOf(path);
                    if (idx !== -1) {
                        openTabs.splice(idx, 1);
                    }
                }

                // If current file was updated, clear it to prevent old content being saved back
                if (currentOpenFile && updatedPaths.includes(currentOpenFile)) {
                    currentOpenFile = null;
                }

                // Prefer opening the main file if it exists in the ZIP
                if (currentProjectMainFile && updatedPaths.includes(currentProjectMainFile)) {
                    lastAddedFile = currentProjectMainFile;
                }
            } else {
                // Single file - check for duplicates
                const ext = '.' + file.name.split('.').pop().toLowerCase();
                const isText = textExtensions.includes(ext);
                const basename = file.name.split('/').pop();
                const existingFiles = findFilesByBasename(basename);

                let targetPath = file.name;

                if (existingFiles.length > 0) {
                    // Check if exact path match exists
                    const normalizedInput = VFS.normalizePath(file.name);
                    const exactMatch = existingFiles.find(p => p === normalizedInput);

                    if (exactMatch) {
                        // Exact match - just replace
                        targetPath = exactMatch;
                        // If this file is currently open, clear currentOpenFile
                        // to prevent openFileTab from saving old content back
                        if (currentOpenFile === exactMatch) {
                            currentOpenFile = null;
                        }
                        // Remove from open tabs (will reopen with new content)
                        const oldTabIdx = openTabs.indexOf(exactMatch);
                        if (oldTabIdx !== -1) {
                            openTabs.splice(oldTabIdx, 1);
                        }
                    } else {
                        // Same basename but different path - ask user
                        const result = await showFileReplaceDialog(basename, existingFiles);
                        if (result.action === 'cancel') {
                            continue; // Skip this file
                        } else if (result.action === 'replace') {
                            targetPath = result.path;
                            // If this file is currently open, clear currentOpenFile
                            // to prevent openFileTab from saving old content back
                            if (currentOpenFile === result.path) {
                                currentOpenFile = null;
                            }
                            // Close old tab if open (will reopen with new content)
                            const oldTabIdx = openTabs.indexOf(result.path);
                            if (oldTabIdx !== -1) {
                                openTabs.splice(oldTabIdx, 1);
                            }
                        } else {
                            targetPath = result.path;
                        }
                    }
                }

                if (isText) {
                    const decoder = new TextDecoder('utf-8');
                    VFS.addFile(targetPath, decoder.decode(new Uint8Array(arrayBuffer)));
                    if (['.asm', '.z80', '.s', '.a80'].includes(ext)) {
                        lastAddedFile = VFS.normalizePath(targetPath);
                    }
                } else {
                    VFS.addBinaryFile(targetPath, new Uint8Array(arrayBuffer));
                }
                totalAdded++;
            }
        }

        // If no main file set and we added source files, ask to select
        if (needsMainFile && lastAddedFile) {
            const allFiles = VFS.listFiles();
            const mainFile = await showMainFileDialog(allFiles);
            if (mainFile) {
                currentProjectMainFile = mainFile;
                openFileTab(mainFile);
            }
        } else if (lastAddedFile) {
            // Open the last added source file
            openFileTab(lastAddedFile);
        }

        updateProjectButtons();
        updateDefinesDropdown();
        updateFileTabs();
        showMessage(totalAdded > 0 ? `Added/updated ${totalAdded} file(s)` : 'No files added');

    } catch (err) {
        console.error('Load error:', err);
        showMessage('Error loading: ' + err.message);
    }
}

let searchMatches = [];
let currentMatchIndex = -1;
export function openSearchBar(showReplace) {
    asmSearchBar.style.display = 'flex';
    asmReplaceRow.style.display = showReplace ? 'flex' : 'none';
    asmSearchResults.style.display = 'none';
    asmSearchInput.focus();
    // Pre-fill with selected text
    const selected = asmEditor.value.substring(asmEditor.selectionStart, asmEditor.selectionEnd);
    if (selected && !selected.includes('\n')) {
        asmSearchInput.value = selected;
    }
    asmSearchInput.select();
    updateSearchMatches();
}

export function closeSearchBar() {
    asmSearchBar.style.display = 'none';
    asmSearchResults.style.display = 'none';
    asmEditor.focus();
}

export function searchAllFiles() {
    const query = asmSearchInput.value;
    if (!query) {
        asmSearchResults.style.display = 'none';
        return;
    }

    const caseSensitive = chkAsmSearchCase.checked;
    const results = [];

    // Get all files from VFS
    const files = VFS.listFiles();
    if (files.length === 0) {
        // Just search current editor
        const currentResults = searchInText(asmEditor.value, query, caseSensitive, currentOpenFile || 'untitled');
        results.push(...currentResults);
    } else {
        // Save current editor to VFS first
        if (currentOpenFile && VFS.files[currentOpenFile] && !VFS.files[currentOpenFile].binary) {
            VFS.files[currentOpenFile].content = asmEditor.value;
        }
        // Search all files (skip binary files)
        for (const filename of files) {
            const file = VFS.files[filename];
            if (file && !file.binary) {
                const fileResults = searchInText(file.content, query, caseSensitive, filename);
                results.push(...fileResults);
            }
        }
    }

    // Display results
    if (results.length === 0) {
        asmSearchResults.innerHTML = '<div class="asm-search-results-header">No results found</div>';
    } else {
        let html = `<div class="asm-search-results-header">Found ${results.length} result${results.length !== 1 ? 's' : ''} in ${new Set(results.map(r => r.file)).size} file${new Set(results.map(r => r.file)).size !== 1 ? 's' : ''}</div>`;
        for (const r of results) {
            const escapedText = escapeHtml(r.lineText);
            const highlightedText = highlightMatch(escapedText, query, caseSensitive);
            html += `<div class="asm-search-result-item" data-file="${escapeHtml(r.file)}" data-line="${r.lineNum}" data-col="${r.col}">`;
            html += `<span class="asm-search-result-file">${escapeHtml(r.file)}</span>`;
            html += `<span class="asm-search-result-line">${r.lineNum}</span>`;
            html += `<span class="asm-search-result-text">${highlightedText}</span>`;
            html += `</div>`;
        }
        asmSearchResults.innerHTML = html;

        // Add click handlers
        asmSearchResults.querySelectorAll('.asm-search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const file = item.dataset.file;
                const line = parseInt(item.dataset.line);
                const col = parseInt(item.dataset.col);
                goToSearchResult(file, line, col, query.length);
            });
        });
    }
    asmSearchResults.style.display = 'block';
}

export function searchInText(text, query, caseSensitive, filename) {
    const results = [];
    const lines = text.split('\n');
    const searchQuery = caseSensitive ? query : query.toLowerCase();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const searchLine = caseSensitive ? line : line.toLowerCase();
        let col = 0;
        while ((col = searchLine.indexOf(searchQuery, col)) !== -1) {
            results.push({
                file: filename,
                lineNum: i + 1,
                col: col,
                lineText: line.trim()
            });
            col += searchQuery.length;
        }
    }
    return results;
}

export function highlightMatch(text, query, caseSensitive) {
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    return text.replace(regex, match => `<span class="asm-search-result-match">${match}</span>`);
}

export function goToSearchResult(file, lineNum, col, matchLen) {
    // If different file, switch to it
    if (file !== currentOpenFile && VFS.listFiles().length > 0) {
        // Save current file first
        if (currentOpenFile && VFS.files[currentOpenFile] && !VFS.files[currentOpenFile].binary) {
            VFS.files[currentOpenFile].content = asmEditor.value;
        }
        // Open target file
        const targetFile = VFS.files[file];
        if (targetFile && !targetFile.binary) {
            if (!openTabs.includes(file)) {
                openTabs.push(file);
            }
            currentOpenFile = file;
            asmEditor.value = targetFile.content;
            updateFileTabs();
            updateLineNumbers();
            updateHighlight();
        }
    }

    // Go to line and select match
    const lines = asmEditor.value.split('\n');
    let pos = 0;
    for (let i = 0; i < lineNum - 1 && i < lines.length; i++) {
        pos += lines[i].length + 1;
    }
    pos += col;
    asmEditor.focus();
    asmEditor.setSelectionRange(pos, pos + matchLen);
    // Scroll into view
    const lineHeight = 18;
    const scrollTop = (lineNum - 5) * lineHeight;
    asmEditor.scrollTop = Math.max(0, scrollTop);
}

export function updateSearchMatches() {
    const query = asmSearchInput.value;
    searchMatches = [];
    currentMatchIndex = -1;

    if (!query) {
        asmSearchCount.textContent = '';
        return;
    }

    const text = asmEditor.value;
    const caseSensitive = chkAsmSearchCase.checked;
    const searchText = caseSensitive ? text : text.toLowerCase();
    const searchQuery = caseSensitive ? query : query.toLowerCase();

    let pos = 0;
    while ((pos = searchText.indexOf(searchQuery, pos)) !== -1) {
        searchMatches.push(pos);
        pos += searchQuery.length;
    }

    if (searchMatches.length > 0) {
        // Find closest match to cursor
        const cursor = asmEditor.selectionStart;
        currentMatchIndex = 0;
        for (let i = 0; i < searchMatches.length; i++) {
            if (searchMatches[i] >= cursor) {
                currentMatchIndex = i;
                break;
            }
        }
        asmSearchCount.textContent = `${currentMatchIndex + 1} of ${searchMatches.length}`;
    } else {
        asmSearchCount.textContent = 'No results';
    }
}

export function findNext() {
    if (searchMatches.length === 0) {
        updateSearchMatches();
        if (searchMatches.length === 0) return;
    }

    currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
    selectMatch();
}

export function findPrev() {
    if (searchMatches.length === 0) {
        updateSearchMatches();
        if (searchMatches.length === 0) return;
    }

    currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    selectMatch();
}

export function selectMatch() {
    if (currentMatchIndex < 0 || currentMatchIndex >= searchMatches.length) return;

    const pos = searchMatches[currentMatchIndex];
    const len = asmSearchInput.value.length;
    asmEditor.focus();
    asmEditor.setSelectionRange(pos, pos + len);

    // Scroll to selection
    const lineHeight = 16;
    const lines = asmEditor.value.substring(0, pos).split('\n').length - 1;
    asmEditor.scrollTop = Math.max(0, lines * lineHeight - asmEditor.clientHeight / 2);

    asmSearchCount.textContent = `${currentMatchIndex + 1} of ${searchMatches.length}`;
}

export function replaceOne() {
    if (searchMatches.length === 0 || currentMatchIndex < 0) return;

    const pos = searchMatches[currentMatchIndex];
    const len = asmSearchInput.value.length;
    const replacement = asmReplaceInput.value;

    const before = asmEditor.value.substring(0, pos);
    const after = asmEditor.value.substring(pos + len);
    asmEditor.value = before + replacement + after;

    updateLineNumbers();
    updateHighlight();
    syncEditorToVFS();

    // Update matches and find next
    updateSearchMatches();
    if (searchMatches.length > 0) {
        if (currentMatchIndex >= searchMatches.length) {
            currentMatchIndex = 0;
        }
        selectMatch();
    }
}

export function replaceAll() {
    const query = asmSearchInput.value;
    if (!query) return;

    const replacement = asmReplaceInput.value;
    const caseSensitive = chkAsmSearchCase.checked;

    let text = asmEditor.value;
    let count = 0;

    if (caseSensitive) {
        while (text.includes(query)) {
            text = text.replace(query, replacement);
            count++;
        }
    } else {
        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = text.match(regex);
        count = matches ? matches.length : 0;
        text = text.replace(regex, replacement);
    }

    asmEditor.value = text;
    updateLineNumbers();
    updateHighlight();
    syncEditorToVFS();
    updateSearchMatches();

    asmSearchCount.textContent = `Replaced ${count}`;
}

let asmFontSize = parseInt(localStorage.getItem('asmFontSize')) || 12;
export function updateAsmFontSize(newSize) {
    // Clamp between 8 and 24
    asmFontSize = Math.max(8, Math.min(24, newSize));
    // Line height is roughly 1.4x font size, rounded to avoid fractional pixels
    const lineHeight = Math.round(asmFontSize * 1.4);

    document.documentElement.style.setProperty('--asm-font-size', asmFontSize + 'px');
    document.documentElement.style.setProperty('--asm-line-height', lineHeight + 'px');

    // Update dropdown to match
    if (asmFontSizeSelect) {
        asmFontSizeSelect.value = asmFontSize;
    }

    localStorage.setItem('asmFontSize', asmFontSize);

    // Update line numbers to match new height
    updateLineNumbers();
}

let assembledBytes = null;
let assembledOrg = 0;
let assembledOrgAddresses = [];  // All ORG addresses from assembly
let assembledSaveCommands = [];  // SAVESNA/SAVETAP commands from assembly
let assembledEntryPoint = null;  // Entry point from ; @entry marker
export function goToFileLine(file, line) {
    // Normalize file path
    const normalizedFile = file ? file.replace(/\\/g, '/').toLowerCase() : null;

    // Find the file in VFS
    let targetPath = null;
    if (normalizedFile) {
        for (const path in VFS.files) {
            if (path.toLowerCase() === normalizedFile ||
                path.toLowerCase().endsWith('/' + normalizedFile) ||
                normalizedFile.endsWith('/' + path.toLowerCase())) {
                targetPath = path;
                break;
            }
        }
    }

    // If file found and it's different from current, open it
    if (targetPath && targetPath !== currentOpenFile) {
        openFileTab(targetPath);
    }

    // Go to line in editor
    if (line && asmEditor) {
        const lines = asmEditor.value.split('\n');
        const lineIndex = Math.max(0, Math.min(line - 1, lines.length - 1));
        let charPos = 0;
        for (let i = 0; i < lineIndex; i++) {
            charPos += lines[i].length + 1;
        }
        asmEditor.focus();
        asmEditor.setSelectionRange(charPos, charPos + lines[lineIndex].length);
        // Scroll to make the line visible
        const lineHeight = parseInt(getComputedStyle(asmEditor).lineHeight) || 18;
        asmEditor.scrollTop = Math.max(0, (lineIndex - 5) * lineHeight);
    }
}

export function formatErrorLocation(file, line, message, isError) {
    const cssClass = isError ? 'asm-error' : 'asm-warning';
    const prefix = isError ? 'Error' : 'Warning';
    let location = '';

    if (file) {
        const shortFile = file.split('/').pop();
        location = `${shortFile}:${line || '?'}`;
    } else if (line) {
        location = `Line ${line}`;
    }

    const escapedMsg = escapeHtml(message);
    const dataFile = file ? `data-file="${escapeHtml(file)}"` : '';
    const dataLine = line ? `data-line="${line}"` : '';

    return `<div class="${cssClass} asm-clickable" ${dataFile} ${dataLine} style="cursor:pointer" title="Click to go to location">${prefix}: ${location}: ${escapedMsg}</div>`;
}

export function detectDefinesFromSource() {
    const defines = [];

    // Get content from main file in project mode, or current editor
    let content = '';
    const mainFile = currentProjectMainFile || currentOpenFile;
    if (mainFile && VFS.files[mainFile] && !VFS.files[mainFile].binary) {
        content = VFS.files[mainFile].content;
    } else if (asmEditor) {
        content = asmEditor.value;
    }

    if (!content) return defines;

    // Only check first 50 lines for @define markers
    const lines = content.split('\n').slice(0, 50);
    for (const line of lines) {
        const match = line.match(/^\s*;\s*@define\s+(\w+)(?:\s*=\s*(.+))?/i);
        if (match) {
            defines.push({
                name: match[1],
                value: match[2] !== undefined ? match[2].trim() : '1'
            });
        }
    }

    return defines;
}

export function updateDefinesDropdown() {
    if (!asmDetectedDefines) return;

    const defines = detectDefinesFromSource();

    if (defines.length === 0) {
        asmDetectedDefines.style.display = 'none';
        return;
    }

    // Build options
    asmDetectedDefines.innerHTML = defines.map(d =>
        `<option value="${d.name}" data-value="${d.value}">${d.name}${d.value !== '1' ? '=' + d.value : ''}</option>`
    ).join('');

    // Adjust size based on count
    asmDetectedDefines.size = Math.min(defines.length, 4);
    asmDetectedDefines.style.display = 'inline-block';
    asmDetectedDefines.title = `Available defines from @define markers (${defines.length})\nCtrl+click to select multiple`;
}

export function getSelectedDefinesFromDropdown() {
    if (!asmDetectedDefines) return [];

    const selected = [];
    for (const opt of asmDetectedDefines.selectedOptions) {
        const valueStr = opt.dataset.value;
        // Parse value
        let value = 1;
        if (valueStr && valueStr !== '1') {
            if (/^-?\d+$/.test(valueStr)) {
                value = parseInt(valueStr, 10);
            } else if (/^[\$0x]/i.test(valueStr)) {
                value = parseInt(valueStr.replace(/^[\$0x]/i, ''), 16);
            } else {
                value = valueStr; // Keep as string
            }
        }
        selected.push({ name: opt.value, value });
    }
    return selected;
}

export function assembleCode() {
    // Pause emulator before assembly
    if (spectrum.isRunning()) {
        spectrum.stop();
        updateStatus();
    }
    // Run assembly directly (no setTimeout to avoid race with Debug button)
    doAssemble();
}

export function doAssemble() {
    // Use the project main file name if available, otherwise default to current file or 'editor.asm'
    const filename = currentProjectMainFile || currentOpenFile || 'editor.asm';
    // VFS normalizes paths to lowercase
    const normalizedFilename = filename.replace(/\\/g, '/').toLowerCase();

    // Determine if this is a single-file assembly (no project loaded)
    const isSingleFile = !currentProjectMainFile && !currentOpenFile;

    // For single-file mode, always use fresh VFS to avoid stale content
    if (isSingleFile) {
        VFS.reset();
    }

    // Sync current editor to VFS before assembly
    const normalizedOpenFile = currentOpenFile ? currentOpenFile.replace(/\\/g, '/').toLowerCase() : null;
    if (normalizedOpenFile && VFS.files[normalizedOpenFile] && !VFS.files[normalizedOpenFile].binary) {
        // Update existing file in VFS
        VFS.files[normalizedOpenFile].content = asmEditor.value;
    }

    // Always add/update the file being assembled with current editor content
    if (asmEditor.value.trim()) {
        VFS.addFile(filename, asmEditor.value);
    }

    // Check if we have a multi-file project
    const hasProject = !isSingleFile && Object.keys(VFS.files).length > 1;

    // Parse command-line defines from input (format: "NAME,NAME=value,...")
    const cmdDefines = [];
    if (asmDefinesInput && asmDefinesInput.value.trim()) {
        const defParts = asmDefinesInput.value.split(',').map(s => s.trim()).filter(s => s);
        for (const part of defParts) {
            const eqIdx = part.indexOf('=');
            if (eqIdx > 0) {
                const name = part.substring(0, eqIdx).trim();
                const valueStr = part.substring(eqIdx + 1).trim();
                // Parse value as number if possible, otherwise use 1
                const value = /^-?\d+$/.test(valueStr) ? parseInt(valueStr, 10) :
                              /^[\$0x]/i.test(valueStr) ? parseInt(valueStr.replace(/^[\$0x]/i, ''), 16) : 1;
                cmdDefines.push({ name, value });
            } else {
                cmdDefines.push({ name: part, value: 1 });
            }
        }
    }

    // Add selected defines from @define markers dropdown
    const dropdownDefines = getSelectedDefinesFromDropdown();
    for (const def of dropdownDefines) {
        // Only add if not already in cmdDefines (manual input takes priority)
        if (!cmdDefines.some(d => d.name === def.name)) {
            cmdDefines.push(def);
        }
    }

    // Use sjasmplus-js assembler
    try {
        let result;
        if (hasProject && VFS.files[normalizedFilename]) {
            // Multi-file project - use assembleProject to preserve VFS
            result = Assembler.assembleProject(normalizedFilename, cmdDefines);
        } else {
            // Single file mode - use assemble
            const code = asmEditor.value;
            result = Assembler.assemble(code, filename, cmdDefines);
        }

        assembledBytes = result.output;
        assembledOrg = result.outputStart;
        assembledOrgAddresses = result.orgAddresses || [result.outputStart];
        assembledSaveCommands = result.saveCommands || [];

        // Parse ; @entry marker from source
        assembledEntryPoint = null;
        const sourceCode = hasProject && VFS.files[normalizedFilename] ? VFS.files[normalizedFilename].content : asmEditor.value;
        const entryMatch = sourceCode.match(/^\s*;\s*@entry\s+(\S+)/im);
        if (entryMatch) {
            const entryValue = entryMatch[1];
            // result.symbols is an array of {name, value, ...}
            // Try to resolve as label first (case-insensitive)
            const symbolEntry = result.symbols && result.symbols.find(s =>
                s.name === entryValue || s.name.toLowerCase() === entryValue.toLowerCase()
            );
            if (symbolEntry) {
                assembledEntryPoint = symbolEntry.value;
            } else {
                // Try parsing as number ($hex, 0xhex, or decimal)
                const numMatch = entryValue.match(/^(?:\$|0x)([0-9a-f]+)$/i);
                if (numMatch) {
                    assembledEntryPoint = parseInt(numMatch[1], 16);
                } else if (/^\d+$/.test(entryValue)) {
                    assembledEntryPoint = parseInt(entryValue, 10);
                }
            }
        }

        // Check for errors
        const errors = ErrorCollector.errors || [];
        const warnings = result.warnings || [];

        let html = '';

        if (errors.length > 0) {
            const statusMsg = `${errors.length} error(s)`;
            html += `<div class="asm-status-line error">${statusMsg}</div>`;
            errors.forEach(e => {
                html += formatErrorLocation(e.file, e.line, e.message, true);
            });
            assembledBytes = null;
            btnAsmInject.disabled = true;
            btnAsmDebug.disabled = true;
            btnAsmDownload.disabled = true;
        } else {
            // Show assembled output with addresses and bytes (if enabled)
            const output = result.output;
            const startAddr = result.outputStart;
            const statusMsg = `OK: ${output.length} bytes at ${startAddr.toString(16).toUpperCase()}h (${result.passes} pass${result.passes > 1 ? 'es' : ''})`;
            html += `<div class="asm-status-line success">${statusMsg}</div>`;

            // Show warnings (filter unused labels based on checkbox)
            const showUnused = chkAsmUnusedLabels && chkAsmUnusedLabels.checked;
            const realWarnings = warnings.filter(w =>
                showUnused || !w.message.startsWith('Unused label:')
            );
            realWarnings.forEach(w => {
                html += formatErrorLocation(w.file, w.line, w.message, false);
            });

            const showCompiled = chkAsmShowCompiled && chkAsmShowCompiled.checked;

            if (showCompiled && output.length > 0) {
                // Show hex dump grouped by 8 bytes per line
                for (let i = 0; i < output.length; i += 8) {
                    const addr = startAddr + i;
                    const chunk = output.slice(i, Math.min(i + 8, output.length));
                    const bytesHex = chunk.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
                    html += `<div class="asm-line">`;
                    html += `<span class="asm-addr">${addr.toString(16).toUpperCase().padStart(4, '0')}</span>`;
                    html += `<span class="asm-bytes">${bytesHex}</span>`;
                    html += `</div>`;
                }
            }

            // Show generated files list (grouped by filename)
            const saveCommands = assembledSaveCommands.filter(c =>
                c.type === 'bin' || c.type === 'sna' || c.type === 'tap' ||
                c.type === 'emptytap' || c.type === 'trd' || c.type === 'emptytrd'
            );
            // Group by filename
            const fileMap = new Map();
            for (const cmd of saveCommands) {
                const fn = cmd.filename || cmd.trdFilename;
                if (!fn) continue;
                if (!fileMap.has(fn)) {
                    fileMap.set(fn, { commands: [], totalSize: 0, type: cmd.type });
                }
                const entry = fileMap.get(fn);
                entry.commands.push(cmd);
                if (cmd.capturedData) entry.totalSize += cmd.capturedData.length;
                else if (cmd.length) entry.totalSize += cmd.length;
                // Update type if we have a real command (not empty)
                if (cmd.type !== 'emptytap' && cmd.type !== 'emptytrd') {
                    entry.type = cmd.type;
                }
            }

            if (fileMap.size > 0) {
                html += `<div class="asm-files-section">`;
                html += `<div class="asm-files-header">Generated files:</div>`;
                for (const [filename, info] of fileMap) {
                    let fileSize = 0;
                    let md5Hash = '';
                    let expectedMD5 = null;
                    let blockCount = 0;

                    // Get expected MD5 from first command with it
                    for (const cmd of info.commands) {
                        if (cmd.expectedMD5) {
                            expectedMD5 = cmd.expectedMD5.toLowerCase();
                            break;
                        }
                    }

                    if (info.type === 'tap') {
                        const tapCmds = info.commands.filter(c => c.type === 'tap');
                        blockCount = tapCmds.length;
                        // Generate TAP data to get accurate size and MD5
                        const allBlocks = [];
                        for (const cmd of tapCmds) {
                            const blockData = generateTAPBlocks(cmd);
                            if (blockData) allBlocks.push(blockData);
                        }
                        if (allBlocks.length > 0) {
                            const totalLen = allBlocks.reduce((sum, b) => sum + b.length, 0);
                            const tapData = new Uint8Array(totalLen);
                            let offset = 0;
                            for (const block of allBlocks) {
                                tapData.set(block, offset);
                                offset += block.length;
                            }
                            fileSize = tapData.length;
                            md5Hash = MD5.hash(tapData);
                        }
                    } else if (info.type === 'bin') {
                        const cmd = info.commands.find(c => c.type === 'bin');
                        if (cmd && cmd.capturedData) {
                            fileSize = cmd.capturedData.length;
                            md5Hash = MD5.hash(cmd.capturedData);
                        }
                    } else if (info.type === 'sna') {
                        const cmd = info.commands.find(c => c.type === 'sna');
                        if (cmd) {
                            const snaData = generateSNAFile(cmd);
                            fileSize = snaData.length;
                            md5Hash = MD5.hash(snaData);
                        }
                    } else {
                        fileSize = info.totalSize;
                    }

                    // Format details
                    let details = '';
                    if (info.type === 'tap' && blockCount > 1) {
                        details = `${blockCount} blocks, ${fileSize} bytes`;
                    } else if (fileSize > 0) {
                        details = `${fileSize} bytes`;
                    }

                    // MD5 verification
                    let md5Status = '';
                    if (expectedMD5 && md5Hash) {
                        if (md5Hash === expectedMD5) {
                            md5Status = '<span class="asm-md5-pass">MD5 OK</span>';
                        } else {
                            md5Status = `<span class="asm-md5-fail">MD5 MISMATCH (expected: ${expectedMD5})</span>`;
                        }
                    }

                    html += `<div class="asm-file-item">`;
                    html += `${escapeHtml(filename)}`;
                    if (details) html += ` <span class="asm-file-details">(${details})</span>`;
                    if (md5Hash) html += ` <span class="asm-file-md5">[${md5Hash}]</span>`;
                    if (md5Status) html += ` ${md5Status}`;
                    html += `</div>`;
                }
                html += `</div>`;
            }

            btnAsmInject.disabled = false;
            btnAsmDebug.disabled = false;
            btnAsmDownload.disabled = fileMap.size === 0;
        }

        asmOutput.innerHTML = html;

        // Add click handlers for error/warning navigation
        asmOutput.querySelectorAll('.asm-clickable').forEach(el => {
            el.addEventListener('click', () => {
                const file = el.dataset.file || null;
                const line = el.dataset.line ? parseInt(el.dataset.line) : null;
                goToFileLine(file, line);
            });
        });

    } catch (e) {
        // Handle AssemblerError with file/line info
        const statusMsg = 'Assembly failed';
        let html = `<div class="asm-status-line error">${statusMsg}</div>`;
        if (e.file || e.line) {
            html += formatErrorLocation(e.file, e.line, e.message, true);
        } else {
            html += `<div class="asm-error">${escapeHtml(e.message || e.toString())}</div>`;
        }
        asmOutput.innerHTML = html;

        // Add click handlers for error navigation
        asmOutput.querySelectorAll('.asm-clickable').forEach(el => {
            el.addEventListener('click', () => {
                const file = el.dataset.file || null;
                const line = el.dataset.line ? parseInt(el.dataset.line) : null;
                goToFileLine(file, line);
            });
        });

        assembledBytes = null;
        btnAsmInject.disabled = true;
        btnAsmDebug.disabled = true;
        btnAsmDownload.disabled = true;
    }
}

export function generateSNAFile(cmd) {
    const deviceName = AsmMemory.getDeviceName();
    const is128k = AsmMemory.device &&
        (deviceName === 'ZXSPECTRUM128' || deviceName === 'ZXSPECTRUM512' || deviceName === 'ZXSPECTRUM1024');
    const size = is128k ? 131103 : 49179;
    const snaData = new Uint8Array(size);

    const startAddr = cmd.start;

    // SNA header (27 bytes)
    // I register
    snaData[0] = 0x3F;
    // HL', DE', BC', AF' (alternate registers)
    snaData[1] = 0; snaData[2] = 0;  // HL'
    snaData[3] = 0; snaData[4] = 0;  // DE'
    snaData[5] = 0; snaData[6] = 0;  // BC'
    snaData[7] = 0; snaData[8] = 0;  // AF'
    // HL, DE, BC (main registers)
    snaData[9] = 0; snaData[10] = 0;  // HL
    snaData[11] = 0; snaData[12] = 0; // DE
    snaData[13] = 0; snaData[14] = 0; // BC
    // IY, IX
    snaData[15] = 0x5C; snaData[16] = 0x3A; // IY = 5C3Ah (standard)
    snaData[17] = 0; snaData[18] = 0;        // IX
    // Interrupt (bit 2 = IFF2)
    snaData[19] = 0x04; // IFF2 enabled
    // R register
    snaData[20] = 0;
    // AF
    snaData[21] = 0; snaData[22] = 0;         // AF
    // SP
    if (is128k) {
        // 128K: PC stored in extended header, SP is actual value
        snaData[23] = 0; snaData[24] = 0; // SP = 0x0000
    } else {
        // 48K: PC stored on stack via RETN trick, SP points below pushed PC
        snaData[23] = 0xFE; snaData[24] = 0xFF; // SP = 0xFFFE
    }
    // Interrupt mode
    snaData[25] = 1; // IM 1
    // Border color
    snaData[26] = 7; // White border

    // RAM dump (48K starting at 0x4000)
    // Copy assembled data into 48K section
    if (AsmMemory.device) {
        if (is128k) {
            // 128K: 48K section = banks 5, 2, and current bank at C000
            const currentBank = AsmMemory.slots[3].page;
            const pageMap = [5, 2, currentBank];
            for (let section = 0; section < 3; section++) {
                const pageData = AsmMemory.getPage(pageMap[section]);
                if (pageData) {
                    snaData.set(pageData, 27 + section * 0x4000);
                }
            }
        } else {
            // ZXSPECTRUM48: pages 5, 2, 0 map to 0x4000-0xFFFF
            const pageMap = [5, 2, 0];
            for (let page = 0; page < 3; page++) {
                const pageData = AsmMemory.getPage(pageMap[page]);
                if (pageData) {
                    snaData.set(pageData, 27 + page * 0x4000);
                }
            }
        }
    } else {
        // No DEVICE - linear output
        const outputStart = Assembler.outputStart;
        const output = Assembler.output;
        for (let i = 0; i < output.length; i++) {
            const addr = outputStart + i;
            if (addr >= 0x4000 && addr <= 0xFFFF) {
                snaData[27 + (addr - 0x4000)] = output[i];
            }
        }
    }

    if (is128k) {
        // 128K extended header at offset 49179
        const offset = 49179;
        // PC
        snaData[offset] = startAddr & 0xFF;
        snaData[offset + 1] = (startAddr >> 8) & 0xFF;
        // Port 0x7FFD value
        const currentBank = AsmMemory.slots[3].page;
        snaData[offset + 2] = currentBank & 0x07;
        // TR-DOS ROM not paged
        snaData[offset + 3] = 0;
        // Remaining RAM banks (excluding 5, 2, and current bank at C000)
        const banksToSave = [0, 1, 3, 4, 6, 7].filter(b => b !== currentBank);
        const banksToActuallySave = banksToSave.slice(0, 5);
        let bankOffset = offset + 4;
        for (const bankNum of banksToActuallySave) {
            const pageData = AsmMemory.getPage(bankNum);
            if (pageData) {
                snaData.set(pageData, bankOffset);
            }
            bankOffset += 0x4000;
        }
    } else {
        // 48K: Place start address on stack for RETN
        snaData[27 + (0xFFFE - 0x4000)] = startAddr & 0xFF;
        snaData[27 + (0xFFFE - 0x4000) + 1] = (startAddr >> 8) & 0xFF;
    }

    return snaData;
}

export function generateTAPBlocks(cmd) {
    if (cmd.blockType === 'HEADLESS') {
        // Headless block - just data with flag byte
        const flagByte = cmd.param1 !== undefined ? cmd.param1 : 0xFF;
        return createTAPBlock(cmd.capturedData, flagByte);
    }

    // Standard block with header
    const blocks = [];

    if (cmd.blockType === 'CODE') {
        // Header block (type 3 = CODE)
        const header = new Uint8Array(17);
        header[0] = 3; // CODE
        // Filename (10 chars, space padded)
        const name = (cmd.blockName || 'CODE').substring(0, 10).padEnd(10, ' ');
        for (let i = 0; i < 10; i++) {
            header[1 + i] = name.charCodeAt(i);
        }
        const len = cmd.capturedData ? cmd.capturedData.length : cmd.length;
        header[11] = len & 0xFF;
        header[12] = (len >> 8) & 0xFF;
        header[13] = cmd.start & 0xFF;
        header[14] = (cmd.start >> 8) & 0xFF;
        const codeParam2 = (cmd.param2 >= 0) ? cmd.param2 : 32768;
        header[15] = codeParam2 & 0xFF;
        header[16] = (codeParam2 >> 8) & 0xFF;

        blocks.push(createTAPBlock(header, 0x00)); // Flag 0 = header
        blocks.push(createTAPBlock(cmd.capturedData, 0xFF)); // Flag FF = data
    } else if (cmd.blockType === 'BASIC') {
        // BASIC program header (type 0)
        const header = new Uint8Array(17);
        header[0] = 0; // BASIC
        const name = (cmd.blockName || 'PROGRAM').substring(0, 10).padEnd(10, ' ');
        for (let i = 0; i < 10; i++) {
            header[1 + i] = name.charCodeAt(i);
        }
        const len = cmd.capturedData ? cmd.capturedData.length : cmd.length;
        header[11] = len & 0xFF;
        header[12] = (len >> 8) & 0xFF;
        const autorun = cmd.param1 !== undefined ? cmd.param1 : 0x8000;
        header[13] = autorun & 0xFF;
        header[14] = (autorun >> 8) & 0xFF;
        const varsOffset = (cmd.param2 >= 0) ? cmd.param2 : len;
        header[15] = varsOffset & 0xFF;
        header[16] = (varsOffset >> 8) & 0xFF;

        blocks.push(createTAPBlock(header, 0x00));
        blocks.push(createTAPBlock(cmd.capturedData, 0xFF));
    } else {
        // Default - just data block
        blocks.push(createTAPBlock(cmd.capturedData, 0xFF));
    }

    // Concatenate all blocks
    const totalLen = blocks.reduce((sum, b) => sum + b.length, 0);
    const tapData = new Uint8Array(totalLen);
    let offset = 0;
    for (const block of blocks) {
        tapData.set(block, offset);
        offset += block.length;
    }
    return tapData;
}

export function createTAPBlock(data, flagByte) {
    const blockLen = data.length + 2; // +1 flag, +1 checksum
    const block = new Uint8Array(blockLen + 2); // +2 for length prefix
    block[0] = blockLen & 0xFF;
    block[1] = (blockLen >> 8) & 0xFF;
    block[2] = flagByte;
    block.set(data, 3);
    // Calculate checksum (XOR of flag and all data bytes)
    let checksum = flagByte;
    for (let i = 0; i < data.length; i++) {
        checksum ^= data[i];
    }
    block[block.length - 1] = checksum;
    return block;
}

export async function createZipFromFiles(files) {
    // Simple ZIP creation without compression (STORE method)
    const entries = [];
    let offset = 0;

    // Build local file headers and file data
    for (const file of files) {
        const nameBytes = new TextEncoder().encode(file.filename);
        const localHeader = new Uint8Array(30 + nameBytes.length);

        // Local file header signature
        localHeader[0] = 0x50; localHeader[1] = 0x4B;
        localHeader[2] = 0x03; localHeader[3] = 0x04;
        // Version needed (2.0)
        localHeader[4] = 20; localHeader[5] = 0;
        // Flags
        localHeader[6] = 0; localHeader[7] = 0;
        // Compression (0 = store)
        localHeader[8] = 0; localHeader[9] = 0;
        // Mod time/date (use fixed value)
        localHeader[10] = 0; localHeader[11] = 0;
        localHeader[12] = 0x21; localHeader[13] = 0;
        // CRC32
        const crc = crc32(file.data);
        localHeader[14] = crc & 0xFF;
        localHeader[15] = (crc >> 8) & 0xFF;
        localHeader[16] = (crc >> 16) & 0xFF;
        localHeader[17] = (crc >> 24) & 0xFF;
        // Compressed size
        localHeader[18] = file.data.length & 0xFF;
        localHeader[19] = (file.data.length >> 8) & 0xFF;
        localHeader[20] = (file.data.length >> 16) & 0xFF;
        localHeader[21] = (file.data.length >> 24) & 0xFF;
        // Uncompressed size
        localHeader[22] = file.data.length & 0xFF;
        localHeader[23] = (file.data.length >> 8) & 0xFF;
        localHeader[24] = (file.data.length >> 16) & 0xFF;
        localHeader[25] = (file.data.length >> 24) & 0xFF;
        // Filename length
        localHeader[26] = nameBytes.length & 0xFF;
        localHeader[27] = (nameBytes.length >> 8) & 0xFF;
        // Extra field length
        localHeader[28] = 0; localHeader[29] = 0;
        // Filename
        localHeader.set(nameBytes, 30);

        entries.push({
            filename: file.filename,
            nameBytes,
            data: file.data,
            localHeader,
            offset,
            crc
        });
        offset += localHeader.length + file.data.length;
    }

    // Build central directory
    const centralDir = [];
    for (const entry of entries) {
        const cdEntry = new Uint8Array(46 + entry.nameBytes.length);
        // Central directory signature
        cdEntry[0] = 0x50; cdEntry[1] = 0x4B;
        cdEntry[2] = 0x01; cdEntry[3] = 0x02;
        // Version made by
        cdEntry[4] = 20; cdEntry[5] = 0;
        // Version needed
        cdEntry[6] = 20; cdEntry[7] = 0;
        // Flags
        cdEntry[8] = 0; cdEntry[9] = 0;
        // Compression
        cdEntry[10] = 0; cdEntry[11] = 0;
        // Mod time/date
        cdEntry[12] = 0; cdEntry[13] = 0;
        cdEntry[14] = 0x21; cdEntry[15] = 0;
        // CRC32
        cdEntry[16] = entry.crc & 0xFF;
        cdEntry[17] = (entry.crc >> 8) & 0xFF;
        cdEntry[18] = (entry.crc >> 16) & 0xFF;
        cdEntry[19] = (entry.crc >> 24) & 0xFF;
        // Compressed size
        cdEntry[20] = entry.data.length & 0xFF;
        cdEntry[21] = (entry.data.length >> 8) & 0xFF;
        cdEntry[22] = (entry.data.length >> 16) & 0xFF;
        cdEntry[23] = (entry.data.length >> 24) & 0xFF;
        // Uncompressed size
        cdEntry[24] = entry.data.length & 0xFF;
        cdEntry[25] = (entry.data.length >> 8) & 0xFF;
        cdEntry[26] = (entry.data.length >> 16) & 0xFF;
        cdEntry[27] = (entry.data.length >> 24) & 0xFF;
        // Filename length
        cdEntry[28] = entry.nameBytes.length & 0xFF;
        cdEntry[29] = (entry.nameBytes.length >> 8) & 0xFF;
        // Extra, comment, disk start, internal/external attrs
        for (let i = 30; i < 42; i++) cdEntry[i] = 0;
        // Local header offset
        cdEntry[42] = entry.offset & 0xFF;
        cdEntry[43] = (entry.offset >> 8) & 0xFF;
        cdEntry[44] = (entry.offset >> 16) & 0xFF;
        cdEntry[45] = (entry.offset >> 24) & 0xFF;
        // Filename
        cdEntry.set(entry.nameBytes, 46);
        centralDir.push(cdEntry);
    }

    const cdSize = centralDir.reduce((sum, e) => sum + e.length, 0);
    const cdOffset = offset;

    // End of central directory
    const eocd = new Uint8Array(22);
    eocd[0] = 0x50; eocd[1] = 0x4B;
    eocd[2] = 0x05; eocd[3] = 0x06;
    // Disk numbers
    eocd[4] = 0; eocd[5] = 0;
    eocd[6] = 0; eocd[7] = 0;
    // Entry counts
    eocd[8] = entries.length & 0xFF;
    eocd[9] = (entries.length >> 8) & 0xFF;
    eocd[10] = entries.length & 0xFF;
    eocd[11] = (entries.length >> 8) & 0xFF;
    // Central directory size
    eocd[12] = cdSize & 0xFF;
    eocd[13] = (cdSize >> 8) & 0xFF;
    eocd[14] = (cdSize >> 16) & 0xFF;
    eocd[15] = (cdSize >> 24) & 0xFF;
    // Central directory offset
    eocd[16] = cdOffset & 0xFF;
    eocd[17] = (cdOffset >> 8) & 0xFF;
    eocd[18] = (cdOffset >> 16) & 0xFF;
    eocd[19] = (cdOffset >> 24) & 0xFF;
    // Comment length
    eocd[20] = 0; eocd[21] = 0;

    // Assemble final ZIP
    const totalSize = offset + cdSize + 22;
    const zipData = new Uint8Array(totalSize);
    let pos = 0;

    for (const entry of entries) {
        zipData.set(entry.localHeader, pos);
        pos += entry.localHeader.length;
        zipData.set(entry.data, pos);
        pos += entry.data.length;
    }
    for (const cd of centralDir) {
        zipData.set(cd, pos);
        pos += cd.length;
    }
    zipData.set(eocd, pos);

    return zipData;
}

export function crc32(data) {
    const table = [];
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function downloadBinaryFile(filename, data) {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export async function showOrgSelectionDialog(addresses) {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'file-selector-dialog';
        dialog.innerHTML = `
            <div class="file-selector-content" style="max-width: 300px;">
                <div class="file-selector-header">
                    <h3>Select Entry Point</h3>
                    <button class="file-selector-close">&times;</button>
                </div>
                <div class="file-selector-body" style="max-height: 200px;">
                    ${addresses.map(addr =>
                        `<div class="file-item" data-addr="${addr}" style="cursor:pointer;padding:8px;">
                            ${addr.toString(16).toUpperCase().padStart(4, '0')}h
                        </div>`
                    ).join('')}
                    <div class="file-item" data-custom="true" style="cursor:pointer;padding:8px;color:var(--cyan);">
                        Custom address...
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);

        const close = () => {
            dialog.remove();
            resolve(null);
        };

        dialog.querySelector('.file-selector-close').addEventListener('click', close);
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) close();
        });

        dialog.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', () => {
                if (item.dataset.custom) {
                    const addr = prompt('Enter entry point address (hex):', addresses[0].toString(16).toUpperCase());
                    if (addr) {
                        const parsed = parseInt(addr, 16);
                        if (!isNaN(parsed) && parsed >= 0 && parsed <= 0xFFFF) {
                            dialog.remove();
                            resolve(parsed);
                        } else {
                            showMessage('Invalid address', 'error');
                        }
                    }
                } else {
                    dialog.remove();
                    resolve(parseInt(item.dataset.addr));
                }
            });
        });
    });
}

export function updateAutoMapStats() {
    const stats = spectrum.getAutoMapStats();
    if (stats.executed === 0 && stats.read === 0 && stats.written === 0) {
        autoMapStats.textContent = '';
        autoMapStats.classList.remove('active');
    } else {
        autoMapStats.textContent = `E:${stats.executed} R:${stats.read} W:${stats.written}`;
        autoMapStats.classList.add('active');
    }
}

export function updateXrefStats() {
    const count = xrefManager.getCount();
    if (count > 0) {
        xrefStats.textContent = `${count} refs`;
        xrefStats.classList.add('active');
    } else {
        xrefStats.textContent = '';
        xrefStats.classList.remove('active');
    }
}

export function showTraceEntry(entry) {
    if (!entry) return;
    // Set trace cursor address for highlighting
    traceViewAddress = entry.pc;
    // Show the trace list panel if hidden
    if (!traceList.classList.contains('visible')) {
        traceList.classList.add('visible');
    }
    // Update displays to show historical state
    updateTraceStatus();
    updateTraceList();
    updateDebugger();  // Update registers to show trace entry values
    // Navigate disasm to the traced PC
    goToAddress(entry.pc);
    showMessage(`Viewing trace: ${hex16(entry.pc)}`);
}

export function updateTraceStopAfter() {
    const val = parseInt(txtTraceStopAfter.value, 10) || 0;
    traceManager.stopAfter = val;
    traceManager.stopped = false;  // Reset stopped state when limit changes
    // Ensure maxHistory is at least as large as stopAfter
    if (val > 0 && val > traceManager.maxHistory) {
        traceManager.maxHistory = val;
    }
}

let memmapViewMode = 'regions'; // 'regions' or 'heatmap'
let memmapBankMode = '64k'; // '64k' or '128k'
export function updateMemmapScale() {
    const romLabel = document.getElementById('memmapRomLabel');
    const bankLabel = document.getElementById('memmapBankLabel');
    if (!spectrum) return;

    // Show/hide 128K toggle based on machine type
    if (spectrum.memory.machineType === '48k') {
        memmapBankToggle.style.display = 'none';
        memmapBankMode = '64k';
    } else {
        memmapBankToggle.style.display = 'flex';
    }

    // Update scale visibility based on bank mode
    memmapScale.style.display = (memmapBankMode === '128k') ? 'none' : 'flex';

    if (spectrum.memory.machineType === '48k') {
        romLabel.textContent = 'ROM';
        bankLabel.textContent = 'RAM';
    } else {
        romLabel.textContent = 'ROM ' + spectrum.memory.currentRomBank;
        bankLabel.textContent = 'Bank ' + spectrum.memory.currentRamBank;
    }
}

export function openMemoryMap() {
    memmapDialog.classList.remove('hidden');
    updateMemmapScale();
    renderCurrentMemmapView();
}

export function renderCurrentMemmapView() {
    if (memmapBankMode === '128k') {
        render128KMap();
    } else if (memmapViewMode === 'heatmap') {
        renderHeatmap();
    } else {
        renderMemoryMap();
    }
}

export function closeMemoryMap() {
    memmapDialog.classList.add('hidden');
}

export function setMemmapView(mode) {
    memmapViewMode = mode;
    btnMemmapRegions.classList.toggle('active', mode === 'regions');
    btnMemmapHeatmap.classList.toggle('active', mode === 'heatmap');
    memmapLegendRegions.classList.toggle('hidden', mode !== 'regions');
    memmapLegendHeatmap.classList.toggle('hidden', mode !== 'heatmap');
    renderCurrentMemmapView();
}

export function setMemmapBankMode(mode) {
    memmapBankMode = mode;
    btnMemmap64K.classList.toggle('active', mode === '64k');
    btnMemmap128K.classList.toggle('active', mode === '128k');
    memmapScale.style.display = (mode === '128k') ? 'none' : 'flex';
    // Show legends in both modes
    memmapLegendRegions.classList.toggle('hidden', memmapViewMode !== 'regions');
    memmapLegendHeatmap.classList.toggle('hidden', memmapViewMode !== 'heatmap');
    renderCurrentMemmapView();
}

export function getMemoryMapData() {
    const data = new Array(65536);
    const stats = {
        code: 0, smc: 0, db: 0, dw: 0, text: 0, graphics: 0, unmapped: 0, zero: 0
    };

    // First pass: mark all addresses based on memory content
    for (let addr = 0; addr < 65536; addr++) {
        const val = spectrum.memory.read(addr);
        const region = regionManager.get(addr);

        if (region) {
            data[addr] = region.type;
            stats[region.type]++;
        } else if (val === 0) {
            data[addr] = 'zero';
            stats.zero++;
        } else {
            data[addr] = 'unmapped';
            stats.unmapped++;
        }
    }

    return { data, stats };
}

export function renderMemoryMap() {
    const { data, stats } = getMemoryMapData();
    const imageData = memmapCtx.createImageData(512, 512);

    // Render 512x512 grid (2x2 pixels per byte, row-major)
    for (let addr = 0; addr < 65536; addr++) {
        const type = data[addr];
        const color = MEMMAP_COLORS[type] || MEMMAP_COLORS.unmapped;

        // Parse hex color
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);

        // Calculate 2x2 pixel position
        const srcX = addr & 0xFF;
        const srcY = addr >> 8;
        const dstX = srcX * 2;
        const dstY = srcY * 2;

        // Draw 2x2 block
        for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
                const idx = ((dstY + dy) * 512 + (dstX + dx)) * 4;
                imageData.data[idx] = r;
                imageData.data[idx + 1] = g;
                imageData.data[idx + 2] = b;
                imageData.data[idx + 3] = 255;
            }
        }
    }

    memmapCtx.putImageData(imageData, 0, 0);

    // Update statistics
    const total = 65536;
    const mapped = stats.code + stats.smc + stats.db + stats.dw + stats.text + stats.graphics;

    memmapStats.innerHTML = `
        <table>
            <tr><td>Code</td><td>${stats.code.toLocaleString()}</td><td>${(stats.code/total*100).toFixed(1)}%</td></tr>
            <tr><td>SMC</td><td>${stats.smc.toLocaleString()}</td><td>${(stats.smc/total*100).toFixed(1)}%</td></tr>
            <tr><td>DB</td><td>${stats.db.toLocaleString()}</td><td>${(stats.db/total*100).toFixed(1)}%</td></tr>
            <tr><td>DW</td><td>${stats.dw.toLocaleString()}</td><td>${(stats.dw/total*100).toFixed(1)}%</td></tr>
            <tr><td>Text</td><td>${stats.text.toLocaleString()}</td><td>${(stats.text/total*100).toFixed(1)}%</td></tr>
            <tr><td>Graphics</td><td>${stats.graphics.toLocaleString()}</td><td>${(stats.graphics/total*100).toFixed(1)}%</td></tr>
            <tr><td>Unmapped</td><td>${stats.unmapped.toLocaleString()}</td><td>${(stats.unmapped/total*100).toFixed(1)}%</td></tr>
            <tr><td>Zeroes</td><td>${stats.zero.toLocaleString()}</td><td>${(stats.zero/total*100).toFixed(1)}%</td></tr>
            <tr class="total"><td>Mapped</td><td>${mapped.toLocaleString()}</td><td>${(mapped/total*100).toFixed(1)}%</td></tr>
        </table>
    `;

    // Update bar
    const barParts = [
        { type: 'code', width: stats.code / total * 100 },
        { type: 'smc', width: stats.smc / total * 100 },
        { type: 'db', width: stats.db / total * 100 },
        { type: 'dw', width: stats.dw / total * 100 },
        { type: 'text', width: stats.text / total * 100 },
        { type: 'graphics', width: stats.graphics / total * 100 },
        { type: 'unmapped', width: stats.unmapped / total * 100 },
        { type: 'zero', width: stats.zero / total * 100 }
    ];

    memmapBar.innerHTML = '<div class="memmap-bar-fill">' +
        barParts.map(p => `<div style="width:${p.width}%;background:${MEMMAP_COLORS[p.type]}"></div>`).join('') +
        '</div>';
}

let heatmapData = null;
export function renderHeatmap() {
    const autoMapData = spectrum.getAutoMapData();
    const imageData = memmapCtx.createImageData(512, 512);

    // Find max counts for normalization
    let maxExec = 0, maxRead = 0, maxWrite = 0;
    for (const count of autoMapData.executed.values()) maxExec = Math.max(maxExec, count);
    for (const count of autoMapData.read.values()) maxRead = Math.max(maxRead, count);
    for (const count of autoMapData.written.values()) maxWrite = Math.max(maxWrite, count);

    // Use log scale for better visualization
    const logScale = (count, max) => {
        if (count === 0 || max === 0) return 0;
        return Math.log(count + 1) / Math.log(max + 1);
    };

    // Store heatmap data for tooltip
    heatmapData = {
        executed: autoMapData.executed,
        read: autoMapData.read,
        written: autoMapData.written,
        maxExec, maxRead, maxWrite
    };

    // Stats for display
    const stats = {
        executed: autoMapData.executed.size,
        read: autoMapData.read.size,
        written: autoMapData.written.size,
        totalExec: 0, totalRead: 0, totalWrite: 0
    };
    for (const count of autoMapData.executed.values()) stats.totalExec += count;
    for (const count of autoMapData.read.values()) stats.totalRead += count;
    for (const count of autoMapData.written.values()) stats.totalWrite += count;

    // Render heatmap
    // Color channels: B=execute, G=read, R=write
    for (let addr = 0; addr < 65536; addr++) {
        const key = spectrum.getAutoMapKey(addr);
        const execCount = autoMapData.executed.get(key) || 0;
        const readCount = autoMapData.read.get(key) || 0;
        const writeCount = autoMapData.written.get(key) || 0;

        // Calculate intensity using log scale
        const execIntensity = logScale(execCount, maxExec);
        const readIntensity = logScale(readCount, maxRead);
        const writeIntensity = logScale(writeCount, maxWrite);

        // Map to RGB: R=write (orange), G=read (green), B=execute (blue)
        let r = Math.floor(writeIntensity * 255);
        let g = Math.floor(readIntensity * 255);
        let b = Math.floor(execIntensity * 255);

        // Calculate 2x2 pixel position
        const srcX = addr & 0xFF;
        const srcY = addr >> 8;
        const dstX = srcX * 2;
        const dstY = srcY * 2;

        // Draw 2x2 block
        for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
                const idx = ((dstY + dy) * 512 + (dstX + dx)) * 4;
                imageData.data[idx] = r;
                imageData.data[idx + 1] = g;
                imageData.data[idx + 2] = b;
                imageData.data[idx + 3] = 255;
            }
        }
    }

    memmapCtx.putImageData(imageData, 0, 0);

    // Update statistics for heatmap
    memmapStats.innerHTML = `
        <table>
            <tr><td>Executed addrs</td><td>${stats.executed.toLocaleString()}</td></tr>
            <tr><td>Total executions</td><td>${stats.totalExec.toLocaleString()}</td></tr>
            <tr><td>Read addrs</td><td>${stats.read.toLocaleString()}</td></tr>
            <tr><td>Total reads</td><td>${stats.totalRead.toLocaleString()}</td></tr>
            <tr><td>Written addrs</td><td>${stats.written.toLocaleString()}</td></tr>
            <tr><td>Total writes</td><td>${stats.totalWrite.toLocaleString()}</td></tr>
            <tr class="total"><td>Max exec</td><td>${maxExec.toLocaleString()}</td></tr>
            <tr class="total"><td>Max read</td><td>${maxRead.toLocaleString()}</td></tr>
            <tr class="total"><td>Max write</td><td>${maxWrite.toLocaleString()}</td></tr>
        </table>
    `;

    // Update bar for heatmap (show proportions of exec/read/write)
    const totalAccesses = stats.executed + stats.read + stats.written;
    if (totalAccesses > 0) {
        const execWidth = stats.executed / totalAccesses * 100;
        const readWidth = stats.read / totalAccesses * 100;
        const writeWidth = stats.written / totalAccesses * 100;
        memmapBar.innerHTML = `<div class="memmap-bar-fill">
            <div style="width:${execWidth}%;background:#0066ff" title="Execute"></div>
            <div style="width:${readWidth}%;background:#00ff66" title="Read"></div>
            <div style="width:${writeWidth}%;background:#ff6600" title="Write"></div>
        </div>`;
    } else {
        memmapBar.innerHTML = '<div class="memmap-bar-fill"><div style="width:100%;background:#333">No data</div></div>';
    }
}

export function render128KMap() {
    if (!spectrum || spectrum.memory.machineType === '48k') return;

    const imageData = memmapCtx.createImageData(512, 512);
    // Layout: 2 columns x 4 rows, each cell is 256x128 pixels showing 16KB
    // Each byte = 2x1 pixels (x2 horizontal scale)
    const cellWidth = 256;  // pixels
    const cellHeight = 128; // pixels
    const bytesPerRow = 128; // bytes per row in each cell

    // Get heatmap data if in heatmap mode
    let heatData = null, maxExec = 0, maxRead = 0, maxWrite = 0;
    if (memmapViewMode === 'heatmap') {
        const autoMapData = spectrum.getAutoMapData();
        heatData = autoMapData;
        for (const count of autoMapData.executed.values()) maxExec = Math.max(maxExec, count);
        for (const count of autoMapData.read.values()) maxRead = Math.max(maxRead, count);
        for (const count of autoMapData.written.values()) maxWrite = Math.max(maxWrite, count);
    }

    const logScale = (count, max) => {
        if (count === 0 || max === 0) return 0;
        return Math.log(count + 1) / Math.log(max + 1);
    };

    for (let bank = 0; bank < 8; bank++) {
        const col = bank % 2;
        const row = Math.floor(bank / 2);
        const baseX = col * cellWidth;
        const baseY = row * cellHeight;
        const ramBank = spectrum.memory.ram[bank];

        for (let addr = 0; addr < 0x4000; addr++) {
            const val = ramBank[addr];
            let r, g, b;

            // Calculate the CPU address for this bank+offset
            // Bank 5 is always at 4000-7FFF, Bank 2 at 8000-BFFF
            // Other banks page into C000-FFFF
            let cpuAddr;
            if (bank === 5) cpuAddr = 0x4000 + addr;
            else if (bank === 2) cpuAddr = 0x8000 + addr;
            else cpuAddr = 0xC000 + addr;

            if (memmapViewMode === 'heatmap' && heatData) {
                // Heatmap mode: show execution/read/write as RGB
                // Use same key format as getAutoMapKey:
                // 4000-BFFF: just address string
                // C000-FFFF: "${addr}:${bank}"
                let key;
                if (bank === 5 || bank === 2) {
                    key = cpuAddr.toString();
                } else {
                    key = `${cpuAddr}:${bank}`;
                }
                const execCount = heatData.executed.get(key) || 0;
                const readCount = heatData.read.get(key) || 0;
                const writeCount = heatData.written.get(key) || 0;
                r = Math.floor(logScale(writeCount, maxWrite) * 255);
                g = Math.floor(logScale(readCount, maxRead) * 255);
                b = Math.floor(logScale(execCount, maxExec) * 255);
            } else {
                // Regions mode: lookup region at CPU address
                const region = regionManager.get(cpuAddr);
                let color;
                if (region) {
                    color = MEMMAP_COLORS[region.type];
                } else if (val === 0) {
                    color = MEMMAP_COLORS.zero;
                } else {
                    color = MEMMAP_COLORS.unmapped;
                }
                r = parseInt(color.slice(1, 3), 16);
                g = parseInt(color.slice(3, 5), 16);
                b = parseInt(color.slice(5, 7), 16);
            }

            // Calculate pixel position with x2 horizontal scale
            const localX = addr % bytesPerRow;
            const localY = Math.floor(addr / bytesPerRow);
            const px = baseX + localX * 2;
            const py = baseY + localY;

            // Draw 2x1 pixel block
            for (let dx = 0; dx < 2; dx++) {
                if ((px + dx) < 512 && py < 512) {
                    const idx = (py * 512 + px + dx) * 4;
                    imageData.data[idx] = r;
                    imageData.data[idx + 1] = g;
                    imageData.data[idx + 2] = b;
                    imageData.data[idx + 3] = 255;
                }
            }
        }
    }

    memmapCtx.putImageData(imageData, 0, 0);

    // Draw grid lines
    memmapCtx.strokeStyle = '#444';
    memmapCtx.lineWidth = 1;
    // Vertical line (center)
    memmapCtx.beginPath();
    memmapCtx.moveTo(cellWidth, 0);
    memmapCtx.lineTo(cellWidth, 512);
    memmapCtx.stroke();
    // Horizontal lines
    for (let i = 1; i < 4; i++) {
        memmapCtx.beginPath();
        memmapCtx.moveTo(0, i * cellHeight);
        memmapCtx.lineTo(512, i * cellHeight);
        memmapCtx.stroke();
    }

    // Draw bank labels
    memmapCtx.font = '11px monospace';
    for (let bank = 0; bank < 8; bank++) {
        const col = bank % 2;
        const row = Math.floor(bank / 2);
        const x = col * cellWidth + 4;
        const y = row * cellHeight + 14;
        const isCurrentBank = (bank === spectrum.memory.currentRamBank);
        memmapCtx.fillStyle = isCurrentBank ? '#00ff00' : '#888';
        memmapCtx.fillText('Bank ' + bank, x, y);
    }

    // Update stats
    let totalZero = 0, totalNonZero = 0;
    for (let bank = 0; bank < 8; bank++) {
        const ramBank = spectrum.memory.ram[bank];
        for (let addr = 0; addr < 0x4000; addr++) {
            if (ramBank[addr] === 0) totalZero++;
            else totalNonZero++;
        }
    }
    const total = 128 * 1024;
    memmapStats.innerHTML = `
        <table>
            <tr><td>Total RAM</td><td>128 KB</td></tr>
            <tr><td>Non-zero</td><td>${totalNonZero.toLocaleString()}</td><td>${(totalNonZero/total*100).toFixed(1)}%</td></tr>
            <tr><td>Zeroes</td><td>${totalZero.toLocaleString()}</td><td>${(totalZero/total*100).toFixed(1)}%</td></tr>
            <tr class="total"><td>Current</td><td colspan="2">Bank ${spectrum.memory.currentRamBank}</td></tr>
        </table>
    `;
    memmapBar.innerHTML = '';
}

export function getAddrFromCanvasPos(x, y) {
    const rect = memmapCanvas.getBoundingClientRect();
    const scaleX = 512 / rect.width;
    const scaleY = 512 / rect.height;
    const px = Math.floor((x - rect.left) * scaleX / 2);  // Divide by 2 for 2x scale
    const py = Math.floor((y - rect.top) * scaleY / 2);
    if (px < 0 || px >= 256 || py < 0 || py >= 256) return -1;
    return py * 256 + px;
}

export function exportDisassembly() {
    const SCREEN_START = 0x4000;
    const SCREEN_END = 0x5B00;  // Screen memory ends at 5AFF, attributes at 5B00

    const lines = [];
    const now = new Date();
    const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);

    // Use snapped state if available, otherwise current state
    const usingSnapshot = exportSnapshot !== null;
    const cpu = usingSnapshot ? exportSnapshot.cpu : spectrum.cpu;

    // Paging state (for 128K/Pentagon)
    const paging = usingSnapshot && exportSnapshot.paging
        ? exportSnapshot.paging
        : spectrum.memory.getPagingState();

    // Memory read function - uses snapshot if available
    const readMem = usingSnapshot
        ? (addr) => exportSnapshot.memory[addr & 0xFFFF]
        : (addr) => spectrum.memory.read(addr);

    const hex16 = (v) => '$' + (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    const hex8 = (v) => '$' + (v & 0xFF).toString(16).toUpperCase().padStart(2, '0');

    // Build register pairs from individual registers
    const af = (cpu.a << 8) | cpu.f;
    const bc = (cpu.b << 8) | cpu.c;
    const de = (cpu.d << 8) | cpu.e;
    const hl = (cpu.h << 8) | cpu.l;
    const af_ = (cpu.a_ << 8) | cpu.f_;
    const bc_ = (cpu.b_ << 8) | cpu.c_;
    const de_ = (cpu.d_ << 8) | cpu.e_;
    const hl_ = (cpu.h_ << 8) | cpu.l_;
    const stackDepth = 16;
    const sp = cpu.sp;

    // Calculate port $7FFD value for 128K paging
    // Bits 0-2: RAM bank, Bit 3: screen (0=bank5, 1=bank7), Bit 4: ROM, Bit 5: lock
    const port7FFD = (paging.ramBank & 0x07) |
                     (paging.screenBank === 7 ? 0x08 : 0x00) |
                     (paging.romBank ? 0x10 : 0x00) |
                     (paging.pagingDisabled ? 0x20 : 0x00);

    // DEVICE directive based on machine type
    const deviceMap = {
        '48k': 'ZXSPECTRUM48',
        '128k': 'ZXSPECTRUM128',
        '+2': 'ZXSPECTRUM128',      // +2 uses 128K memory model
        '+2a': 'ZXSPECTRUM128',     // +2A uses 128K memory model
        'pentagon': 'ZXSPECTRUM128'  // Pentagon uses 128K memory model
    };
    const device = deviceMap[spectrum.machineType] || 'ZXSPECTRUM48';

    // Header with DEVICE
    lines.push('; Disassembly exported from ZX-M8XXX v' + APP_VERSION);
    lines.push(`; Date: ${timestamp}`);
    lines.push(`; Machine: ${spectrum.machineType.toUpperCase()}`);
    if (usingSnapshot) {
        lines.push(`; Using SNAPSHOT from: ${exportSnapshot.timestamp || 'unknown'}`);
        lines.push('; NOTE: Byte values are from snapshot, but instruction disassembly');
        lines.push(';       uses current memory (may differ if memory changed)');
    }
    lines.push(';');
    lines.push('; CPU State:');
    lines.push(`; PC=${hex16(cpu.pc)}  SP=${hex16(cpu.sp)}  IM=${cpu.im}  IFF1=${cpu.iff1 ? 1 : 0}  IFF2=${cpu.iff2 ? 1 : 0}`);
    lines.push(`; AF=${hex16(af)}  BC=${hex16(bc)}  DE=${hex16(de)}  HL=${hex16(hl)}`);
    lines.push(`; IX=${hex16(cpu.ix)}  IY=${hex16(cpu.iy)}  I=${hex8(cpu.i)}  R=${hex8(cpu.r)}`);
    lines.push(`; AF'=${hex16(af_)}  BC'=${hex16(bc_)}  DE'=${hex16(de_)}  HL'=${hex16(hl_)}`);
    // Add paging info for 128K/Pentagon
    if (spectrum.machineType !== '48k') {
        lines.push(`;`);
        lines.push(`; Paging: RAM=${paging.ramBank}  ROM=${paging.romBank}  Screen=${paging.screenBank}  Lock=${paging.pagingDisabled ? 1 : 0}`);
        lines.push(`; Port $7FFD = ${hex8(port7FFD)}`);
    }
    lines.push(';');
    lines.push('; Stack contents (SP points to top, growing down):');
    let stackLine = '; SP->';
    for (let i = 0; i < stackDepth; i++) {
        const addr = (sp + i * 2) & 0xFFFF;
        const lo = readMem(addr);
        const hi = readMem((addr + 1) & 0xFFFF);
        const word = lo | (hi << 8);
        if (i > 0 && i % 8 === 0) {
            lines.push(stackLine);
            stackLine = ';     ';
        }
        stackLine += ` ${hex16(word)}`;
    }
    lines.push(stackLine);
    lines.push(';');
    lines.push('');
    lines.push(`    DEVICE ${device}`);
    lines.push('    OPT --syntax=abf  ; allow undocumented instructions');
    lines.push('');

    // Get all mapped regions and heatmap data
    const autoMapData = spectrum.getAutoMapData();
    const allRegions = regionManager.getAll();

    // Build address set of all addresses with activity (execute, read, write)
    // or marked regions
    const activeAddrs = new Set();
    const executedAddrs = new Set();  // Track which addresses were executed

    // Add executed addresses
    for (const key of autoMapData.executed.keys()) {
        const addr = parseInt(key, 10);  // Parse address (ignores ":page" suffix)
        if (!isNaN(addr) && addr >= 0 && addr < 65536) {
            activeAddrs.add(addr);
            executedAddrs.add(addr);  // Remember this was executed
        }
    }

    // Add read addresses
    for (const key of autoMapData.read.keys()) {
        const addr = parseInt(key, 10);
        if (!isNaN(addr) && addr >= 0 && addr < 65536) {
            activeAddrs.add(addr);
        }
    }

    // Add written addresses
    for (const key of autoMapData.written.keys()) {
        const addr = parseInt(key, 10);
        if (!isNaN(addr) && addr >= 0 && addr < 65536) {
            activeAddrs.add(addr);
        }
    }

    // Add addresses from marked regions
    for (const region of allRegions) {
        for (let a = region.start; a <= region.end; a++) {
            activeAddrs.add(a);
        }
    }

    // Add diagnostic info to header
    lines.push(`; Auto-Map data: ${autoMapData.executed.size} executed, ${autoMapData.read.size} read, ${autoMapData.written.size} written`);
    lines.push(`; Regions: ${allRegions.length} marked regions`);
    lines.push(`; Parsed: ${executedAddrs.size} unique executed addresses`);
    lines.push('');


    if (activeAddrs.size === 0) {
        alert('No mapped regions or heatmap data to export.\nRun the program with Auto-Map tracking enabled first.');
        return;
    }

    // Sort addresses and group into contiguous blocks
    const sortedAddrs = Array.from(activeAddrs).sort((a, b) => a - b);

    // Check if there's executed code in ROM
    const execInROM = Array.from(executedAddrs).filter(a => a < 0x4000).length;
    const execInRAM = Array.from(executedAddrs).filter(a => a >= 0x5B00).length;

    // Ask user if they want to include ROM when ROM code was executed
    let includeROM = false;
    if (execInROM > 0 && execInRAM === 0) {
        includeROM = confirm(`All ${execInROM} executed addresses are in ROM (0000-3FFF).\n\nInclude ROM disassembly in export?`);
    } else if (execInROM > 0) {
        includeROM = confirm(`${execInROM} executed addresses are in ROM.\n\nInclude ROM disassembly in export?`);
    }

    // Check if user wants to include addresses and bytes (from checkbox)
    const includeAddrBytes = document.getElementById('chkExportAddrBytes').checked;
    const dedupLoops = document.getElementById('chkExportDedupLoops').checked;

    // Detect unrolled loops - finds repeating byte patterns in code
    // Returns {patternBytes: [...], repeatCount, totalBytes} or null if no loop found
    // Detect repeating pattern in an instruction array (for nested loop detection)
    function detectPatternInArray(instructions, minRepeats = 3, maxPatternBytes = 512) {
        if (instructions.length < minRepeats * 2) return null;

        let bestResult = null;
        let bestSavings = 0;

        for (let patternLen = 1; patternLen <= Math.min(256, Math.floor(instructions.length / minRepeats)); patternLen++) {
            // Get pattern bytes
            let patternBytes = [];
            for (let i = 0; i < patternLen; i++) {
                patternBytes = patternBytes.concat(instructions[i].bytes);
            }
            if (patternBytes.length > maxPatternBytes) break;

            // Count repetitions
            let repeatCount = 1;
            let instrIdx = patternLen;

            while (instrIdx + patternLen <= instructions.length) {
                let matches = true;
                for (let i = 0; i < patternLen && matches; i++) {
                    const patternInstr = instructions[i];
                    const testInstr = instructions[instrIdx + i];
                    if (patternInstr.bytes.length !== testInstr.bytes.length) {
                        matches = false;
                    } else {
                        for (let b = 0; b < patternInstr.bytes.length; b++) {
                            if (patternInstr.bytes[b] !== testInstr.bytes[b]) {
                                matches = false;
                                break;
                            }
                        }
                    }
                }
                if (matches) {
                    repeatCount++;
                    instrIdx += patternLen;
                } else {
                    break;
                }
            }

            if (repeatCount >= minRepeats) {
                const totalBytes = patternBytes.length * repeatCount;
                const savings = totalBytes - patternBytes.length;
                if (savings > bestSavings) {
                    bestSavings = savings;
                    bestResult = {
                        patternInstructions: instructions.slice(0, patternLen),
                        patternBytes,
                        repeatCount,
                        totalBytes,
                        instrCount: patternLen * repeatCount
                    };
                }
            }
        }

        return bestResult;
    }

    function detectUnrolledLoop(startAddr, blockEnd, minRepeats = 3, maxPatternBytes = 512) {
        // First, disassemble to find instruction boundaries
        const instructions = [];
        let addr = startAddr;
        const maxScanBytes = Math.min(4096, (blockEnd - startAddr + 1));
        let scannedBytes = 0;

        while (scannedBytes < maxScanBytes && addr <= blockEnd) {
            // Stop at labels (they break the loop pattern)
            if (addr !== startAddr && labelManager.get(addr)) break;
            // Stop at non-code region boundaries (data/text regions break the pattern)
            const region = regionManager.get(addr);
            if (region && region.start === addr && addr !== startAddr && region.type !== 'code') break;

            const dis = disasm.disassemble(addr);
            const bytes = [];
            for (let i = 0; i < dis.length; i++) {
                bytes.push(readMem((addr + i) & 0xFFFF));
            }
            instructions.push({ addr, bytes, length: dis.length, mnemonic: dis.mnemonic });
            scannedBytes += dis.length;
            addr += dis.length;
        }

        if (instructions.length < minRepeats * 2) return null;

        // Try pattern lengths from 1 instruction up to maxPatternBytes worth
        let bestResult = null;
        let bestSavings = 0;

        for (let patternLen = 1; patternLen <= Math.min(256, Math.floor(instructions.length / minRepeats)); patternLen++) {
            // Get pattern bytes
            let patternBytes = [];
            for (let i = 0; i < patternLen; i++) {
                patternBytes = patternBytes.concat(instructions[i].bytes);
            }
            if (patternBytes.length > maxPatternBytes) break;

            // Count repetitions
            let repeatCount = 1;
            let instrIdx = patternLen;

            while (instrIdx + patternLen <= instructions.length) {
                // Compare next patternLen instructions
                let matches = true;
                for (let i = 0; i < patternLen && matches; i++) {
                    const patternInstr = instructions[i];
                    const testInstr = instructions[instrIdx + i];
                    if (patternInstr.bytes.length !== testInstr.bytes.length) {
                        matches = false;
                    } else {
                        for (let b = 0; b < patternInstr.bytes.length; b++) {
                            if (patternInstr.bytes[b] !== testInstr.bytes[b]) {
                                matches = false;
                                break;
                            }
                        }
                    }
                }
                if (matches) {
                    repeatCount++;
                    instrIdx += patternLen;
                } else {
                    break;
                }
            }

            if (repeatCount >= minRepeats) {
                const totalBytes = patternBytes.length * repeatCount;
                const savings = totalBytes - patternBytes.length; // Bytes saved by not repeating
                if (savings > bestSavings) {
                    bestSavings = savings;
                    bestResult = {
                        patternInstructions: instructions.slice(0, patternLen),
                        patternBytes,
                        repeatCount,
                        totalBytes
                    };
                }
            }
        }

        return bestResult;
    }

    // Filter out screen memory, and optionally ROM
    // Keep: addresses >= 0x5B00 (above screen, in RAM)
    // Optionally keep: ROM (< 0x4000)
    // Always exclude: screen (0x4000-0x5AFF)
    const filteredAddrs = sortedAddrs.filter(addr => {
        if (addr >= SCREEN_END) return true;  // Above screen - always include
        if (addr < 0x4000 && includeROM) return true;  // ROM - include if requested
        return false;  // Screen memory - exclude
    });

    // Create Set for O(1) lookup when checking label references
    const exportedAddrs = new Set(filteredAddrs);
    // Track external labels (referenced but not in exported range)
    const externalLabels = new Map();  // addr -> label name

    if (filteredAddrs.length === 0) {
        alert('No exportable addresses found.');
        return;
    }

    // Group into contiguous blocks (gap of 16+ bytes starts new block)
    const blocks = [];
    let blockStart = filteredAddrs[0];
    let blockEnd = filteredAddrs[0];

    for (let i = 1; i < filteredAddrs.length; i++) {
        const addr = filteredAddrs[i];
        if (addr > blockEnd + 16) {
            // Start new block
            blocks.push({ start: blockStart, end: blockEnd });
            blockStart = addr;
        }
        blockEnd = addr;
    }
    blocks.push({ start: blockStart, end: blockEnd });

    // Check for 128K paged memory (addresses >= 0xC000)
    const is128K = is128kCompat(spectrum.machineType) || spectrum.profile.ramPages > 1;
    let currentBank = -1;

    // Generate disassembly for each block
    for (const block of blocks) {
        // Skip screen memory
        if (block.start >= SCREEN_START && block.end < SCREEN_END) continue;

        // Handle bank paging for 128K
        if (is128K && block.start >= 0xC000) {
            const bank = spectrum.memory.currentBank || 0;
            if (bank !== currentBank) {
                lines.push('');
                lines.push(`    PAGE ${bank}`);
                currentBank = bank;
            }
        }

        // ORG directive
        lines.push('');
        lines.push(`    ORG $${block.start.toString(16).toUpperCase().padStart(4, '0')}`);
        lines.push('');

        // Disassemble the block
        let addr = block.start;
        while (addr <= block.end) {
            // Skip screen memory within block
            if (addr >= SCREEN_START && addr < SCREEN_END) {
                addr = SCREEN_END;
                if (addr > block.end) break;
                lines.push('');
                lines.push(`    ORG $${addr.toString(16).toUpperCase().padStart(4, '0')}`);
                lines.push('');
            }

            const region = regionManager.get(addr);
            const wasExecuted = executedAddrs.has(addr);
            const labelObj = labelManager.get(addr);

            // Add label if exists
            if (labelObj && labelObj.name) {
                lines.push(`${labelObj.name}:`);
            }

            const addrHex = '$' + addr.toString(16).toUpperCase().padStart(4, '0');

            if (region && region.type === 'text') {
                // Text region - output as DEFM
                let text = '';
                let textStart = addr;
                const textBytes = [];
                while (addr <= block.end && addr <= region.end) {
                    const byte = readMem(addr);
                    if (byte >= 32 && byte < 127) {
                        text += String.fromCharCode(byte);
                        textBytes.push(byte.toString(16).toUpperCase().padStart(2, '0'));
                    } else {
                        break;
                    }
                    addr++;
                }
                if (text.length > 0) {
                    let line = `    DEFM "${text.replace(/"/g, '""')}"`;
                    if (includeAddrBytes) {
                        line += `  ; ${textStart.toString(16).toUpperCase().padStart(4, '0')}: ${textBytes.join(' ')}`;
                    }
                    lines.push(line);
                }
            } else if (region && region.type === 'dw') {
                // Word data
                const lo = readMem(addr);
                const hi = readMem(addr + 1);
                const word = lo | (hi << 8);
                let line = `    DEFW $${word.toString(16).toUpperCase().padStart(4, '0')}`;
                if (includeAddrBytes) {
                    line += `  ; ${addr.toString(16).toUpperCase().padStart(4, '0')}: ${lo.toString(16).toUpperCase().padStart(2, '0')} ${hi.toString(16).toUpperCase().padStart(2, '0')}`;
                }
                lines.push(line);
                addr += 2;
            } else if (region && (region.type === 'db' || region.type === 'graphics')) {
                // Byte data or graphics - output as DEFB
                const bytesPerLine = region.type === 'graphics' ? 8 : 16;
                let byteCount = 0;
                let byteValues = [];
                const startAddr = addr;
                const rawBytes = [];

                while (addr <= block.end && addr <= region.end && byteCount < bytesPerLine) {
                    const byte = readMem(addr);
                    byteValues.push('$' + byte.toString(16).toUpperCase().padStart(2, '0'));
                    rawBytes.push(byte.toString(16).toUpperCase().padStart(2, '0'));
                    addr++;
                    byteCount++;
                }
                if (byteValues.length > 0) {
                    let line = `    DEFB ${byteValues.join(',')}`;
                    if (includeAddrBytes) {
                        line += `  ; ${startAddr.toString(16).toUpperCase().padStart(4, '0')}: ${rawBytes.join(' ')}`;
                    }
                    lines.push(line);
                }
            } else if (wasExecuted || (region && region.type === 'code')) {
                // Code - check for unrolled loops first
                let loopHandled = false;
                if (dedupLoops) {
                    const loop = detectUnrolledLoop(addr, block.end);
                    if (loop && loop.repeatCount >= 3) {
                        // Helper function to format a mnemonic (replace addresses with labels)
                        const formatMnemonic = (mnemonic) => {
                            const addrMatch = mnemonic.match(/([0-9A-F]{4})h/i);
                            if (addrMatch) {
                                const refAddr = parseInt(addrMatch[1], 16);
                                const refLabelObj = labelManager.get(refAddr);
                                if (refLabelObj && refLabelObj.name) {
                                    mnemonic = mnemonic.replace(addrMatch[0], refLabelObj.name);
                                    if (!exportedAddrs.has(refAddr)) {
                                        externalLabels.set(refAddr, refLabelObj.name);
                                    }
                                } else {
                                    mnemonic = mnemonic.replace(/([0-9A-F]{4})h/gi, '$$$1');
                                }
                            }
                            return mnemonic.replace(/([0-9A-F]{2})h/gi, '$$$1');
                        };

                        // Recursive function to output instructions with nested loop detection
                        const outputWithNesting = (instructions, indent) => {
                            let i = 0;
                            while (i < instructions.length) {
                                // Look for inner loop starting at this instruction
                                const remaining = instructions.slice(i);
                                const innerLoop = detectPatternInArray(remaining);

                                if (innerLoop && innerLoop.repeatCount >= 3) {
                                    // Calculate inner loop byte size for comment
                                    const innerBytes = innerLoop.patternBytes.length * innerLoop.repeatCount;
                                    lines.push('');
                                    lines.push(`${indent}; Unrolled loop detected: ${innerLoop.repeatCount} repetitions, ${innerBytes} bytes`);
                                    lines.push(`${indent}REPT ${innerLoop.repeatCount}`);
                                    // Recursively output inner pattern (may have deeper nesting)
                                    outputWithNesting(innerLoop.patternInstructions, indent + '    ');
                                    lines.push(`${indent}ENDR`);
                                    lines.push('');
                                    i += innerLoop.instrCount;
                                } else {
                                    // Output single instruction
                                    lines.push(`${indent}${formatMnemonic(instructions[i].mnemonic)}`);
                                    i++;
                                }
                            }
                        };

                        // Output as REPT block
                        const startAddrHex = addr.toString(16).toUpperCase().padStart(4, '0');
                        lines.push('');  // Empty line before REPT block
                        lines.push(`    ; Unrolled loop detected: ${loop.repeatCount} repetitions, ${loop.totalBytes} bytes`);
                        lines.push(`    REPT ${loop.repeatCount}`);

                        // Output pattern instructions with nested loop detection
                        outputWithNesting(loop.patternInstructions, '        ');

                        lines.push(`    ENDR`);
                        if (includeAddrBytes) {
                            lines.push(`    ; ${startAddrHex}-${((addr + loop.totalBytes - 1) & 0xFFFF).toString(16).toUpperCase().padStart(4, '0')}`);
                        }
                        lines.push('');  // Empty line after REPT block

                        addr += loop.totalBytes;
                        loopHandled = true;
                    }
                }

                if (!loopHandled) {
                    // Regular code disassembly
                    const dis = disasm.disassemble(addr);
                    let mnemonic = dis.mnemonic;

                    // Replace numeric addresses with labels where possible
                    const addrMatch = mnemonic.match(/([0-9A-F]{4})h/i);
                    if (addrMatch) {
                        const refAddr = parseInt(addrMatch[1], 16);
                        const refLabelObj = labelManager.get(refAddr);
                        if (refLabelObj && refLabelObj.name) {
                            // Use label - either in exported range or will be EQU
                            mnemonic = mnemonic.replace(addrMatch[0], refLabelObj.name);
                            // Track external labels for EQU generation
                            if (!exportedAddrs.has(refAddr)) {
                                externalLabels.set(refAddr, refLabelObj.name);
                            }
                        } else {
                            mnemonic = mnemonic.replace(/([0-9A-F]{4})h/gi, '$$$1');
                        }
                    }
                    // Replace 2-digit hex
                    mnemonic = mnemonic.replace(/([0-9A-F]{2})h/gi, '$$$1');

                    // Build bytes array for address+bytes comment
                    const codeBytes = [];
                    for (let bi = 0; bi < dis.length; bi++) {
                        codeBytes.push(readMem(addr + bi).toString(16).toUpperCase().padStart(2, '0'));
                    }
                    const addrBytesComment = includeAddrBytes
                        ? `  ; ${addr.toString(16).toUpperCase().padStart(4, '0')}: ${codeBytes.join(' ')}`
                        : '';

                    // When using snapshot, output bytes from snapshot with mnemonic as comment
                    // (in case memory changed between snap and export)
                    if (usingSnapshot) {
                        const bytes = codeBytes.map(b => '$' + b);
                        lines.push(`    DEFB ${bytes.join(',')}  ; ${mnemonic}${addrBytesComment ? addrBytesComment.replace('  ; ', ' @ ') : ''}`);
                    } else {
                        lines.push(`    ${mnemonic}${addrBytesComment}`);
                    }
                    addr += dis.length;
                }
            } else {
                // Unknown - just data byte (read/write but not executed)
                const byte = readMem(addr);
                const startAddr = addr;

                // Check for run of same byte (for DS compression)
                let runLength = 1;
                while (addr + runLength <= block.end &&
                       readMem(addr + runLength) === byte &&
                       !executedAddrs.has(addr + runLength) &&
                       !regionManager.get(addr + runLength) &&
                       !labelManager.get(addr + runLength)) {
                    runLength++;
                }

                if (runLength > 10) {
                    // Use DS for long runs
                    let line = `    DS ${runLength}, $${byte.toString(16).toUpperCase().padStart(2, '0')}`;
                    if (includeAddrBytes) {
                        line += `  ; ${startAddr.toString(16).toUpperCase().padStart(4, '0')}: ${runLength}x ${byte.toString(16).toUpperCase().padStart(2, '0')}`;
                    }
                    lines.push(line);
                    addr += runLength;
                } else {
                    let line = `    DEFB $${byte.toString(16).toUpperCase().padStart(2, '0')}`;
                    if (includeAddrBytes) {
                        line += `  ; ${addr.toString(16).toUpperCase().padStart(4, '0')}: ${byte.toString(16).toUpperCase().padStart(2, '0')}`;
                    }
                    lines.push(line);
                    addr++;
                }
            }
        }
    }

    // Generate EQUs for external labels (referenced but outside exported range)
    if (externalLabels.size > 0) {
        // Find position after DEVICE line to insert EQUs
        const deviceIndex = lines.findIndex(l => l.includes('DEVICE '));
        if (deviceIndex !== -1) {
            const equLines = [];
            equLines.push('');
            equLines.push('; External labels (referenced but not in exported code)');
            // Sort by address
            const sortedExternal = Array.from(externalLabels.entries()).sort((a, b) => a[0] - b[0]);
            for (const [addr, name] of sortedExternal) {
                equLines.push(`${name} EQU $${addr.toString(16).toUpperCase().padStart(4, '0')}`);
            }
            equLines.push('');
            // Insert after DEVICE line
            lines.splice(deviceIndex + 1, 0, ...equLines);
        }
    }

    // Restoration code at the bottom
    // Calculate size: DI(1) + [paging: LD A(2) + LD BC(3) + OUT(2) = 7] + LD SP(3) + LD A(2) + LD I,A(2) + LD A(2) + LD R,A(2) +
    // LD BC(3) + LD DE(3) + LD HL(3) + PUSH(1) + LD HL(3) + PUSH(1) + POP AF(1) + POP HL(1) +
    // EX AF,AF'(1) + EXX(1) + LD BC(3) + LD DE(3) + LD IX(4) + LD IY(4) +
    // LD HL(3) + PUSH(1) + LD HL(3) + PUSH(1) + POP AF(1) + POP HL(1) + IM(2) + EI?(1) + JP(3)
    const pagingCodeSize = is128K ? 7 : 0;  // LD A + LD BC + OUT (C),A
    const restoreCodeSize = 59 + (cpu.iff1 ? 1 : 0) + pagingCodeSize;  // 59 bytes base, +1 if EI, +7 if 128K
    const stackDataSize = stackDepth * 2;  // 32 bytes for 16 words
    const totalRestoreSize = restoreCodeSize + stackDataSize;

    // IM2 vector table (257 bytes at I*256)
    if (cpu.im === 2) {
        const vectorBase = cpu.i << 8;
        lines.push('');
        lines.push('');
        lines.push('; ============ IM2 VECTOR TABLE ============');
        lines.push(`; 257 bytes at I*256 = ${hex16(vectorBase)}`);
        lines.push('');
        lines.push(`    ORG ${hex16(vectorBase)}`);
        lines.push('');
        lines.push('im2_vectors:');
        // Output 257 bytes with DS compression for runs
        let i = 0;
        while (i < 257) {
            const addr = (vectorBase + i) & 0xFFFF;
            const byte = readMem(addr);

            // Check for run of same byte
            let runLength = 1;
            while (i + runLength < 257 &&
                   readMem((vectorBase + i + runLength) & 0xFFFF) === byte) {
                runLength++;
            }

            if (runLength > 10) {
                let line = `    DS ${runLength}, $${byte.toString(16).toUpperCase().padStart(2, '0')}`;
                if (includeAddrBytes) {
                    line += `  ; ${addr.toString(16).toUpperCase().padStart(4, '0')}: ${runLength}x ${byte.toString(16).toUpperCase().padStart(2, '0')}`;
                }
                lines.push(line);
                i += runLength;
            } else {
                // Output up to 16 bytes as DEFB
                const count = Math.min(16, 257 - i);
                const bytes = [];
                const rawBytes = [];
                for (let j = 0; j < count; j++) {
                    const a = (vectorBase + i + j) & 0xFFFF;
                    const b = readMem(a);
                    bytes.push('$' + b.toString(16).toUpperCase().padStart(2, '0'));
                    rawBytes.push(b.toString(16).toUpperCase().padStart(2, '0'));
                }
                let line = `    DEFB ${bytes.join(',')}`;
                if (includeAddrBytes) {
                    line += `  ; ${addr.toString(16).toUpperCase().padStart(4, '0')}: ${rawBytes.join(' ')}`;
                }
                lines.push(line);
                i += count;
            }
        }
    }

    lines.push('');
    lines.push('');
    lines.push('; ============ STACK DATA ============');
    lines.push(`; ${stackDataSize} bytes at SP=${hex16(sp)}`);
    lines.push('');
    lines.push(`    ORG ${hex16(sp)}  ; SP value`);
    lines.push('');
    lines.push('stack_top:');
    for (let i = 0; i < stackDepth; i++) {
        const addr = (sp + i * 2) & 0xFFFF;
        const lo = readMem(addr);
        const hi = readMem((addr + 1) & 0xFFFF);
        const word = lo | (hi << 8);
        let line = `    DEFW ${hex16(word)}  ; SP+${(i * 2).toString().padStart(2)}`;
        if (includeAddrBytes) {
            line += ` @ ${addr.toString(16).toUpperCase().padStart(4, '0')}: ${lo.toString(16).toUpperCase().padStart(2, '0')} ${hi.toString(16).toUpperCase().padStart(2, '0')}`;
        }
        lines.push(line);
    }
    lines.push('stack_bottom:');
    lines.push('');
    lines.push('');
    lines.push('; ============ RESTORATION CODE ============');
    lines.push(`; ${restoreCodeSize} bytes`);
    lines.push('');
    lines.push('    ORG $4000  ; <-- change to your safe address');
    lines.push('');
    lines.push('restore_state:');
    lines.push('    DI');
    lines.push('');
    // Add 128K paging restoration
    if (is128K) {
        lines.push('    ; Restore 128K paging');
        lines.push(`    LD A,${hex8(port7FFD)}  ; RAM=${paging.ramBank}, ROM=${paging.romBank}, Screen=${paging.screenBank}`);
        lines.push('    LD BC,$7FFD');
        lines.push('    OUT (C),A');
        lines.push('');
    }
    lines.push('    ; Setup stack');
    lines.push('    LD SP,stack_top');
    lines.push('');
    lines.push('    ; Restore I and R registers');
    lines.push(`    LD A,${hex8(cpu.i)}`);
    lines.push('    LD I,A');
    // R increments with each M1 cycle after LD R,A
    // Count M1 cycles from after LD R,A until PC reaches target:
    // LD BC(1) + LD DE(1) + LD HL(1) + PUSH(1) + LD HL(1) + PUSH(1) + POP AF(1) + POP HL(1) +
    // EX AF,AF'(1) + EXX(1) + LD BC(1) + LD DE(1) + LD IX(2) + LD IY(2) +
    // LD HL(1) + PUSH(1) + LD HL(1) + PUSH(1) + POP AF(1) + POP HL(1) + IM(2) + [EI(1)] + JP(1)
    // = 25 without EI, 26 with EI
    const m1CyclesAfterR = 25 + (cpu.iff1 ? 1 : 0);
    const adjustedR = (((cpu.r & 0x7F) - m1CyclesAfterR) & 0x7F) | (cpu.r & 0x80);
    lines.push(`    LD A,${hex8(adjustedR)}  ; R=${hex8(cpu.r)}, minus ${m1CyclesAfterR} M1 cycles`);
    lines.push('    LD R,A');
    lines.push('');
    lines.push('    ; Restore alternate registers (load into main, then swap)');
    lines.push(`    LD BC,${hex16(bc_)}`);
    lines.push(`    LD DE,${hex16(de_)}`);
    lines.push(`    LD HL,${hex16(hl_)}`);
    lines.push('    PUSH HL');
    lines.push(`    LD HL,${hex16(af_)}`);
    lines.push('    PUSH HL');
    lines.push('    POP AF');
    lines.push('    POP HL');
    lines.push('    EX AF,AF\'');
    lines.push('    EXX');
    lines.push('');
    lines.push('    ; Restore main registers');
    lines.push(`    LD BC,${hex16(bc)}`);
    lines.push(`    LD DE,${hex16(de)}`);
    lines.push(`    LD IX,${hex16(cpu.ix)}`);
    lines.push(`    LD IY,${hex16(cpu.iy)}`);
    lines.push('');
    lines.push('    ; Restore HL, AF and jump');
    lines.push(`    LD HL,${hex16(hl)}`);
    lines.push('    PUSH HL');
    lines.push(`    LD HL,${hex16(af)}`);
    lines.push('    PUSH HL');
    lines.push('    POP AF');
    lines.push('    POP HL');
    lines.push('');
    lines.push(`    IM ${cpu.im}`);
    if (cpu.iff1) {
        lines.push('    EI');
    }
    lines.push(`    JP ${hex16(cpu.pc)}`);
    lines.push('');
    lines.push('    SAVESNA "output.sna",restore_state');
    lines.push('');

    // Create and download file
    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `disasm_${now.toISOString().substring(0,10)}.asm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function generateAssemblyOutput(startAddr, endAddr, options = {}) {
    if (!disasm || !spectrum.memory) return '';

    const withOrg = options.withOrg !== false;
    const withAddr = options.withAddr !== false;
    const withBytes = options.withBytes === true;
    const withTstates = options.withTstates === true;

    // Format current datetime
    const now = new Date();
    const datetime = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0') + ':' +
        String(now.getSeconds()).padStart(2, '0');

    let output = '; Disassembly exported from ZX-M8XXX v' + APP_VERSION + '\n';
    output += `; Date: ${datetime}\n`;
    if (labelManager.currentFile) {
        output += `; Source: ${labelManager.currentFile}\n`;
    }
    output += `; Range: $${hex16(startAddr)} - $${hex16(endAddr)}\n\n`;

    if (withOrg) {
        output += `        ORG $${hex16(startAddr)}\n\n`;
    }

    let addr = startAddr;
    while (addr <= endAddr && addr < 0x10000) {
        const region = regionManager.get(addr);
        const label = labelManager.get(addr);
        const comment = commentManager.get(addr);
        const instrStartAddr = addr;

        // Output comments before instruction
        if (comment) {
            if (comment.separator) {
                output += `; ----------\n`;
            }
            if (comment.before) {
                const beforeLines = comment.before.split('\n');
                for (const line of beforeLines) {
                    output += `; ${line}\n`;
                }
            }
        }

        // Output label on its own line if exists
        if (label) {
            output += `${label.name}:\n`;
        }

        let mnemonic = '';
        let bytes = [];
        let isData = false;
        let addBlankAfter = false;

        if (!region || region.type === REGION_TYPES.CODE || region.type === REGION_TYPES.SMC) {
            // Normal disassembly
            const instr = disasm.disassemble(addr);
            if (!instr) break;

            mnemonic = instr.mnemonic;
            bytes = instr.bytes;

            // Check for flow control
            const mnemonicUpper = mnemonic.toUpperCase();
            if (mnemonicUpper.startsWith('RET') || mnemonicUpper.startsWith('JP ') ||
                mnemonicUpper.startsWith('JR ') || mnemonicUpper.startsWith('CALL ') ||
                mnemonicUpper.startsWith('DJNZ') || mnemonicUpper.startsWith('RST') ||
                mnemonicUpper === 'HALT') {
                addBlankAfter = true;
            }

            addr += bytes.length;
        } else if (region.type === REGION_TYPES.TEXT) {
            // Text region - use shared helper
            const regionEnd = Math.min(region.end, endAddr);
            const result = parseTextRegion(spectrum.memory, addr, regionEnd);
            bytes = result.bytes;

            if (result.singleByte) {
                mnemonic = `DB $${hex8(bytes[0])}`;
            } else if (result.text.length > 0) {
                const suffix = result.bit7Terminated ? '+$80' : '';
                mnemonic = `DB "${result.text}"${suffix}`;
            }
            addr = result.nextAddr;
            isData = true;
        } else if (region.type === REGION_TYPES.DW) {
            // Word data - use shared helper
            const regionEnd = Math.min(region.end, endAddr);
            const result = parseWordRegion(spectrum.memory, addr, regionEnd);
            bytes = result.bytes;
            mnemonic = `DW ${result.wordStrs.join(', ')}`;
            addr = result.nextAddr;
            isData = true;
        } else if (region.type === REGION_TYPES.DB || region.type === REGION_TYPES.GRAPHICS) {
            // Byte data - use shared helper
            const regionEnd = Math.min(region.end, endAddr);
            const result = parseByteRegion(spectrum.memory, addr, regionEnd);
            bytes = result.bytes;
            mnemonic = `DB ${result.byteStrs.join(', ')}`;
            addr = result.nextAddr;
            isData = true;
        } else {
            // Unknown region - fallback
            const instr = disasm.disassemble(addr);
            if (!instr) break;
            mnemonic = instr.mnemonic;
            bytes = instr.bytes;
            addr += bytes.length;
        }

        // Build instruction line
        let line = '        '; // 8 spaces for indentation

        // Convert mnemonic to sjasmplus format (for code lines)
        if (!isData) {
            mnemonic = mnemonic.replace(/([0-9A-F]{4})h/gi, (m, hex) => `$${hex}`);
            mnemonic = mnemonic.replace(/([0-9A-F]{2})h/gi, (m, hex) => `$${hex}`);
        }

        line += mnemonic;

        // Add aligned comments
        const hasMetaComments = withAddr || withBytes || (withTstates && !isData);
        if (hasMetaComments) {
            line = line.padEnd(40);
            line += '; ';

            if (withAddr) {
                line += `$${hex16(instrStartAddr)} `;
            }
            if (withBytes) {
                const bytesStr = bytes.map(b => hex8(b)).join(' ');
                if (withAddr) line += '| ';
                line += bytesStr.padEnd(24);
            }
            if (withTstates && !isData) {
                const timing = disasm.getTiming(bytes);
                if (timing) {
                    if (withAddr || withBytes) line += '| ';
                    line += timing;
                }
            }
        }

        // Add inline comment
        if (comment && comment.inline) {
            if (!hasMetaComments) {
                line = line.padEnd(40);
            }
            line += (hasMetaComments ? ' | ' : '; ') + comment.inline;
        }

        output += line + '\n';

        // Add after comments
        if (comment && comment.after) {
            const afterLines = comment.after.split('\n');
            for (const afterLine of afterLines) {
                output += `; ${afterLine}\n`;
            }
        }

        if (addBlankAfter) {
            output += '\n';
        }
    }

    return output;
}

export function formatMnemonic(mnemonic) {
    // Split into opcode and operands
    const spaceIdx = mnemonic.indexOf(' ');
    if (spaceIdx === -1) {
        return `<span class="op">${mnemonic}</span>`;
    }

    const opcode = mnemonic.substring(0, spaceIdx);
    let operands = mnemonic.substring(spaceIdx + 1);

    // Tokenize operands to avoid replacing inside HTML tags
    // Process each comma-separated operand
    const parts = operands.split(',');
    const coloredParts = parts.map(part => {
        let p = part.trim();

        // Character literals ('X' or "X")
        if (/^'.'$/.test(p) || /^".*"$/.test(p)) {
            return `<span class="disasm-char">${p}</span>`;
        }

        // Binary numbers (%...)
        if (p.startsWith('%')) {
            return `<span class="disasm-bin">${p}</span>`;
        }

        // Check for indirect addressing (...)
        const indirectMatch = p.match(/^\((.+)\)$/);
        if (indirectMatch) {
            const inner = colorOperand(indirectMatch[1]);
            return `<span class="disasm-ptr">(</span>${inner}<span class="disasm-ptr">)</span>`;
        }

        return colorOperand(p);
    });

    function colorOperand(p) {
        // Already has HTML (from replaceMnemonicAddresses)
        if (p.includes('<span')) {
            return p;
        }

        // Hex numbers (XXh or XXXXh)
        if (/^[0-9A-F]+h$/i.test(p)) {
            return `<span class="disasm-num">${p}</span>`;
        }

        // Decimal numbers
        if (/^\d+$/.test(p)) {
            return `<span class="disasm-num">${p}</span>`;
        }

        // IX+d or IY+d patterns
        const ixMatch = p.match(/^(IX|IY)([+-])(.+)$/i);
        if (ixMatch) {
            const reg = ixMatch[1].toUpperCase();
            const sign = ixMatch[2];
            const disp = colorOperand(ixMatch[3]);
            return `<span class="disasm-reg">${reg}</span>${sign}${disp}`;
        }

        // 16-bit registers
        if (/^(AF'|BC'|DE'|HL'|AF|BC|DE|HL|SP|IX|IY|PC)$/i.test(p)) {
            return `<span class="disasm-reg">${p}</span>`;
        }

        // 8-bit registers
        if (/^(A|B|C|D|E|H|L|I|R|IXH|IXL|IYH|IYL)$/i.test(p)) {
            return `<span class="disasm-reg">${p}</span>`;
        }

        // Condition flags
        if (/^(NZ|NC|PO|PE|Z|C|P|M)$/i.test(p)) {
            return `<span class="disasm-reg">${p}</span>`;
        }

        return p;
    }

    return `<span class="op">${opcode}</span> ${coloredParts.join(',')}`;
}

/**
 * Initialize Assembler Tab with dependencies and set up DOM event listeners.
 * @param {object} deps - { spectrum, showMessage, hex8, hex16, downloadFile, updateDebugger, goToAddress, labelManager, regionManager, subroutineManager, xrefManager, undoManager, REGION_TYPES, Disassembler, SjASMPlus }
 */
export function initAssemblerTab(deps) {
    spectrum = deps.spectrum;
    showMessage = deps.showMessage;
    hex8 = deps.hex8;
    hex16 = deps.hex16;
    downloadFile = deps.downloadFile;
    updateDebugger = deps.updateDebugger;
    goToAddress = deps.goToAddress;
    labelManager = deps.labelManager;
    regionManager = deps.regionManager;
    subroutineManager = deps.subroutineManager;
    xrefManager = deps.xrefManager;
    undoManager = deps.undoManager;
    REGION_TYPES = deps.REGION_TYPES;
    Disassembler = deps.Disassembler;
    SjASMPlus = deps.SjASMPlus;
    disasm = deps.disasm;
    commentManager = deps.commentManager;
    parseTextRegion = deps.parseTextRegion;
    parseWordRegion = deps.parseWordRegion;
    parseByteRegion = deps.parseByteRegion;
    APP_VERSION = deps.APP_VERSION;
    traceManager = deps.traceManager;
    foldManager = deps.foldManager;
    operandFormatManager = deps.operandFormatManager;
    navPushHistory = deps.navPushHistory;
    getDisasmViewAddress = deps.getDisasmViewAddress;
    setDisasmViewAddress = deps.setDisasmViewAddress;
    getLeftNavHistory = deps.getLeftNavHistory;
    updateNavButtons = deps.updateNavButtons;

    const disasmAddressInput = document.getElementById('disasmAddress');
    const btnDisasmGo = document.getElementById('btnDisasmGo');
    const btnDisasmPC = document.getElementById('btnDisasmPC');

    const asmEditor = document.getElementById('asmEditor');
    const asmHighlight = document.getElementById('asmHighlight');
    const asmLineNumbers = document.getElementById('asmLineNumbers');
    const asmOutput = document.getElementById('asmOutput');
    // asmStatus removed - status shown in output log
    const btnAsmAssemble = document.getElementById('btnAsmAssemble');
    const btnAsmClear = document.getElementById('btnAsmClear');
    const btnAsmNew = document.getElementById('btnAsmNew');
    const btnAsmLoad = document.getElementById('btnAsmLoad');
    const asmFileInput = document.getElementById('asmFileInput');
    const btnAsmInject = document.getElementById('btnAsmInject');
    const btnAsmDebug = document.getElementById('btnAsmDebug');
    const btnAsmDownload = document.getElementById('btnAsmDownload');
    const chkAsmUnusedLabels = document.getElementById('chkAsmUnusedLabels');
    const chkAsmShowCompiled = document.getElementById('chkAsmShowCompiled');
    const asmDefinesInput = document.getElementById('asmDefines');
    const asmDetectedDefines = document.getElementById('asmDetectedDefines');
    const btnAsmExport = document.getElementById('btnAsmExport');
    const asmFileTabs = document.getElementById('asmFileTabs');
    const asmMainFileLabel = document.getElementById('asmMainFileLabel');
    const asmFilesDropdown = document.querySelector('.asm-files-dropdown');
    const btnAsmFiles = document.getElementById('btnAsmFiles');
    const asmFilesList = document.getElementById('asmFilesList');
    const fileSelectorDialog = document.getElementById('fileSelectorDialog');
    const fileSelectorBody = document.getElementById('fileSelectorBody');
    const fileSelectorTitle = document.getElementById('fileSelectorTitle');
    const btnFileSelectorClose = document.getElementById('btnFileSelectorClose');

    // Current project state

    // Show/hide buttons based on project state

    // Update files dropdown list

    // Open a file in a tab

    // Close a file tab

    // Update file tabs display

    // Show main file selection dialog (returns a Promise)

    // Z80 instructions set for highlighting
    const Z80_INSTRUCTIONS = new Set([
        'ADC', 'ADD', 'AND', 'BIT', 'CALL', 'CCF', 'CP', 'CPD', 'CPDR', 'CPI', 'CPIR',
        'CPL', 'DAA', 'DEC', 'DI', 'DJNZ', 'EI', 'EX', 'EXX', 'HALT', 'IM', 'IN',
        'INC', 'IND', 'INDR', 'INI', 'INIR', 'JP', 'JR', 'LD', 'LDD', 'LDDR', 'LDI',
        'LDIR', 'NEG', 'NOP', 'OR', 'OTDR', 'OTIR', 'OUT', 'OUTD', 'OUTI', 'POP',
        'PUSH', 'RES', 'RET', 'RETI', 'RETN', 'RL', 'RLA', 'RLC', 'RLCA', 'RLD',
        'RR', 'RRA', 'RRC', 'RRCA', 'RRD', 'RST', 'SBC', 'SCF', 'SET', 'SLA', 'SLL',
        'SRA', 'SRL', 'SUB', 'XOR', 'DEFB', 'DEFW', 'DEFS', 'DB', 'DW', 'DS', 'DEFM',
        'DM', 'BYTE', 'WORD', 'BLOCK'
    ]);

    const Z80_DIRECTIVES = new Set([
        'ORG', 'EQU', 'INCLUDE', 'INCBIN', 'MACRO', 'ENDM', 'REPT', 'ENDR',
        'IF', 'ELSE', 'ENDIF', 'IFDEF', 'IFNDEF', 'ALIGN', 'PHASE', 'DEPHASE',
        'END', 'ASSERT', 'DEVICE', 'SLOT', 'PAGE', 'MODULE', 'ENDMODULE',
        'STRUCT', 'ENDS', 'SECTION', 'ENDSECTION', 'OUTPUT', 'LABELSLIST',
        'DISPLAY', 'SHELLEXEC', 'DEFINE', 'UNDEFINE', 'DUP', 'EDUP', 'PROC', 'ENDP'
    ]);

    const Z80_REGISTERS = new Set([
        'A', 'B', 'C', 'D', 'E', 'H', 'L', 'F', 'I', 'R',
        'AF', 'BC', 'DE', 'HL', 'IX', 'IY', 'SP', 'PC',
        'IXH', 'IXL', 'IYH', 'IYL', "AF'"
    ]);

    const Z80_CONDITIONS = new Set(['Z', 'NZ', 'C', 'NC', 'PE', 'PO', 'P', 'M']);

    // Simple tokenizer for syntax highlighting






    // Sync editor to VFS when in project mode

    // Editor event listeners
    if (asmEditor) {
        // Debounce timer for defines detection
        let definesUpdateTimer = null;

        asmEditor.addEventListener('input', () => {
            updateLineNumbers();
            updateHighlight();
            syncEditorToVFS();
            updateProjectButtons();

            // Debounced update of defines dropdown (only when editing main file)
            if (!currentOpenFile || currentOpenFile === currentProjectMainFile) {
                clearTimeout(definesUpdateTimer);
                definesUpdateTimer = setTimeout(updateDefinesDropdown, 500);
            }
        });

        asmEditor.addEventListener('scroll', syncScroll);

        // Sync on click and cursor movement (browser may auto-scroll)
        asmEditor.addEventListener('click', () => {
            requestAnimationFrame(syncScroll);
        });
        asmEditor.addEventListener('keyup', (e) => {
            // Arrow keys, Home, End, Page Up/Down may cause auto-scroll
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                requestAnimationFrame(syncScroll);
            }
        });
        asmEditor.addEventListener('focus', syncScroll);

        // Handle paste - need delay for content to be inserted
        asmEditor.addEventListener('paste', () => {
            setTimeout(() => {
                updateLineNumbers();
                updateHighlight();
                syncScroll();
                syncEditorToVFS();
                updateProjectButtons();
            }, 0);
        });

        asmEditor.addEventListener('keydown', (e) => {
            // Tab inserts actual tab
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = asmEditor.selectionStart;
                const end = asmEditor.selectionEnd;
                asmEditor.value = asmEditor.value.substring(0, start) + '\t' + asmEditor.value.substring(end);
                asmEditor.selectionStart = asmEditor.selectionEnd = start + 1;
                updateLineNumbers();
                updateHighlight();
            }
            // Ctrl+F - Find
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                openSearchBar(false);
            }
            // Ctrl+H or Ctrl+R - Replace
            if (e.ctrlKey && (e.key === 'h' || e.key === 'r')) {
                e.preventDefault();
                openSearchBar(true);
            }
            // F3 - Find Next
            if (e.key === 'F3' && !e.shiftKey) {
                e.preventDefault();
                findNext();
            }
            // Shift+F3 - Find Previous
            if (e.key === 'F3' && e.shiftKey) {
                e.preventDefault();
                findPrev();
            }
            // Escape - Close search
            if (e.key === 'Escape' && asmSearchBar.style.display !== 'none') {
                closeSearchBar();
            }
        });

        // Drag & drop file loading
        const asmEditorContainer = asmEditor.parentElement;

        asmEditorContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            asmEditorContainer.classList.add('drag-over');
        });

        asmEditorContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            asmEditorContainer.classList.remove('drag-over');
        });

        asmEditorContainer.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            asmEditorContainer.classList.remove('drag-over');

            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                await loadAsmFiles(files);
            }
        });

        // Initial update
        updateLineNumbers();
        updateHighlight();
    }

    // Find existing files in VFS with the same basename

    // Show dialog to choose where to put a file

    // Reusable file loading function (for Load button and drag & drop)

    // Search/Replace functionality
    const asmSearchBar = document.getElementById('asmSearchBar');
    const asmSearchInput = document.getElementById('asmSearchInput');
    const asmReplaceInput = document.getElementById('asmReplaceInput');
    const asmReplaceRow = document.getElementById('asmReplaceRow');
    const asmSearchCount = document.getElementById('asmSearchCount');
    const chkAsmSearchCase = document.getElementById('chkAsmSearchCase');
    const btnAsmFindNext = document.getElementById('btnAsmFindNext');
    const btnAsmFindPrev = document.getElementById('btnAsmFindPrev');
    const btnAsmReplace = document.getElementById('btnAsmReplace');
    const btnAsmReplaceAll = document.getElementById('btnAsmReplaceAll');
    const btnAsmSearchAll = document.getElementById('btnAsmSearchAll');
    const btnAsmSearchClose = document.getElementById('btnAsmSearchClose');
    const asmSearchResults = document.getElementById('asmSearchResults');














    // Search bar event listeners
    if (asmSearchInput) {
        asmSearchInput.addEventListener('input', updateSearchMatches);
        asmSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) findPrev();
                else findNext();
            }
            if (e.key === 'Escape') closeSearchBar();
        });
    }
    if (asmReplaceInput) {
        asmReplaceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                replaceOne();
            }
            if (e.key === 'Escape') closeSearchBar();
        });
    }
    if (chkAsmSearchCase) {
        chkAsmSearchCase.addEventListener('change', updateSearchMatches);
    }
    if (btnAsmFindNext) btnAsmFindNext.addEventListener('click', findNext);
    if (btnAsmFindPrev) btnAsmFindPrev.addEventListener('click', findPrev);
    if (btnAsmReplace) btnAsmReplace.addEventListener('click', replaceOne);
    if (btnAsmReplaceAll) btnAsmReplaceAll.addEventListener('click', replaceAll);
    if (btnAsmSearchClose) btnAsmSearchClose.addEventListener('click', closeSearchBar);
    if (btnAsmSearchAll) btnAsmSearchAll.addEventListener('click', searchAllFiles);

    updateProjectButtons();

    // Font size controls for assembler editor
    asmFontSizeSelect = document.getElementById('asmFontSize');



    // Initialize font size from saved preference
    updateAsmFontSize(asmFontSize);

    if (asmFontSizeSelect) {
        asmFontSizeSelect.addEventListener('change', () => {
            updateAsmFontSize(parseInt(asmFontSizeSelect.value));
        });
    }

    // Keyboard shortcuts for font size (Ctrl+Plus, Ctrl+Minus)
    if (asmEditor) {
        asmEditor.addEventListener('keydown', (e) => {
            if (e.ctrlKey && (e.key === '+' || e.key === '=' || e.key === 'NumpadAdd')) {
                e.preventDefault();
                updateAsmFontSize(asmFontSize + 1);
            } else if (e.ctrlKey && (e.key === '-' || e.key === '_' || e.key === 'NumpadSubtract')) {
                e.preventDefault();
                updateAsmFontSize(asmFontSize - 1);
            }
        });
    }

    // Button handlers
    if (btnAsmClear) {
        btnAsmClear.addEventListener('click', () => {
            asmEditor.value = '';
            asmOutput.innerHTML = '<span class="asm-hint">Press Assemble to compile</span>';
            updateLineNumbers();
            updateHighlight();
            // Close any open project and reset tabs
            VFS.reset();
            currentProjectMainFile = null;
            currentOpenFile = null;
            openTabs = [];
            fileModified = {};
            updateFileTabs();
            updateProjectButtons();
            updateDefinesDropdown();
            // Disable inject since nothing is assembled
            assembledBytes = null;
            btnAsmInject.disabled = true;
            btnAsmDebug.disabled = true;
            btnAsmDownload.disabled = true;
        });
    }

    if (btnAsmNew) {
        btnAsmNew.addEventListener('click', () => {
            // Prompt for filename
            const defaultName = `file${Object.keys(VFS.files).length + 1}.asm`;
            const filename = prompt('Enter filename:', defaultName);
            if (!filename) return;

            // Ensure it has an extension
            let finalName = filename.trim();
            if (!finalName.includes('.')) {
                finalName += '.asm';
            }

            // Check if file already exists
            const normalized = finalName.replace(/\\/g, '/').toLowerCase();
            for (const path in VFS.files) {
                if (path.toLowerCase() === normalized) {
                    showMessage(`File already exists: ${finalName}`);
                    return;
                }
            }

            // Create empty file in VFS
            const template = `; ${finalName}\n; Created: ${new Date().toLocaleDateString()}\n; @entry start\n\n        ORG $8000\n\nstart:\n        ret\n`;
            VFS.addFile(finalName, template);

            // Set as main file if no main file yet
            if (!currentProjectMainFile) {
                currentProjectMainFile = finalName;
            }

            // Open in tab
            openFileTab(finalName);
            updateProjectButtons();
            showMessage(`Created: ${finalName}`);
        });
    }

    if (btnAsmLoad) {
        btnAsmLoad.addEventListener('click', () => {
            asmFileInput.click();
        });
    }

    // Files dropdown handler
    if (btnAsmFiles) {
        btnAsmFiles.addEventListener('click', (e) => {
            e.stopPropagation();
            updateFilesList();
            asmFilesList.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (asmFilesList && !asmFilesDropdown.contains(e.target)) {
                asmFilesList.classList.remove('show');
            }
        });
    }

    // Click handler for main file label - allows changing main file
    if (asmMainFileLabel) {
        asmMainFileLabel.addEventListener('click', async () => {
            const allFiles = VFS.listFiles();
            const newMain = await showMainFileDialog(allFiles, 'Change Main File');
            if (newMain) {
                currentProjectMainFile = newMain;
                updateFileTabs();
                updateProjectButtons();
                showMessage(`Main file set to: ${newMain.split('/').pop()}`);
            }
        });
    }

    // File loader - always adds/merges files (never resets VFS)
    if (asmFileInput) {
        asmFileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            await loadAsmFiles(files);
            asmFileInput.value = '';
        });
    }

    // Export source files as ZIP
    if (btnAsmExport) {
        btnAsmExport.addEventListener('click', () => {
            // Sync current editor to VFS first
            syncEditorToVFS();

            // Collect source files only (skip binary)
            const sourceFiles = [];
            const textExtensions = ['.asm', '.z80', '.s', '.a80', '.inc', '.txt', '.def', '.h'];

            for (const path in VFS.files) {
                const file = VFS.files[path];
                if (!file.binary) {
                    const ext = '.' + path.split('.').pop().toLowerCase();
                    if (textExtensions.includes(ext) || !path.includes('.')) {
                        sourceFiles.push({ name: path, content: file.content });
                    }
                }
            }

            if (sourceFiles.length === 0) {
                showMessage('No source files to export');
                return;
            }

            // Create simple uncompressed ZIP
            const zipParts = [];
            const centralDir = [];
            let offset = 0;

            for (const file of sourceFiles) {
                const nameBytes = new TextEncoder().encode(file.name);
                const contentBytes = new TextEncoder().encode(file.content);

                // CRC-32 calculation
                let crc = 0xFFFFFFFF;
                for (const byte of contentBytes) {
                    crc ^= byte;
                    for (let i = 0; i < 8; i++) {
                        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
                    }
                }
                crc ^= 0xFFFFFFFF;

                // Local file header
                const localHeader = new Uint8Array(30 + nameBytes.length);
                const lhView = new DataView(localHeader.buffer);
                lhView.setUint32(0, 0x04034b50, true);  // Signature
                lhView.setUint16(4, 20, true);          // Version needed
                lhView.setUint16(6, 0, true);           // Flags
                lhView.setUint16(8, 0, true);           // Compression (0=store)
                lhView.setUint16(10, 0, true);          // Mod time
                lhView.setUint16(12, 0, true);          // Mod date
                lhView.setUint32(14, crc >>> 0, true);  // CRC-32
                lhView.setUint32(18, contentBytes.length, true);  // Compressed size
                lhView.setUint32(22, contentBytes.length, true);  // Uncompressed size
                lhView.setUint16(26, nameBytes.length, true);     // Name length
                lhView.setUint16(28, 0, true);          // Extra length
                localHeader.set(nameBytes, 30);

                // Central directory entry
                const cdEntry = new Uint8Array(46 + nameBytes.length);
                const cdView = new DataView(cdEntry.buffer);
                cdView.setUint32(0, 0x02014b50, true);  // Signature
                cdView.setUint16(4, 20, true);          // Version made by
                cdView.setUint16(6, 20, true);          // Version needed
                cdView.setUint16(8, 0, true);           // Flags
                cdView.setUint16(10, 0, true);          // Compression
                cdView.setUint16(12, 0, true);          // Mod time
                cdView.setUint16(14, 0, true);          // Mod date
                cdView.setUint32(16, crc >>> 0, true);  // CRC-32
                cdView.setUint32(20, contentBytes.length, true);  // Compressed
                cdView.setUint32(24, contentBytes.length, true);  // Uncompressed
                cdView.setUint16(28, nameBytes.length, true);     // Name length
                cdView.setUint16(30, 0, true);          // Extra length
                cdView.setUint16(32, 0, true);          // Comment length
                cdView.setUint16(34, 0, true);          // Disk start
                cdView.setUint16(36, 0, true);          // Internal attrs
                cdView.setUint32(38, 0, true);          // External attrs
                cdView.setUint32(42, offset, true);     // Local header offset
                cdEntry.set(nameBytes, 46);

                zipParts.push(localHeader);
                zipParts.push(contentBytes);
                centralDir.push(cdEntry);
                offset += localHeader.length + contentBytes.length;
            }

            // Central directory
            const cdOffset = offset;
            let cdSize = 0;
            for (const entry of centralDir) {
                zipParts.push(entry);
                cdSize += entry.length;
            }

            // End of central directory
            const eocd = new Uint8Array(22);
            const eocdView = new DataView(eocd.buffer);
            eocdView.setUint32(0, 0x06054b50, true);    // Signature
            eocdView.setUint16(4, 0, true);             // Disk number
            eocdView.setUint16(6, 0, true);             // CD disk
            eocdView.setUint16(8, sourceFiles.length, true);   // Entries on disk
            eocdView.setUint16(10, sourceFiles.length, true);  // Total entries
            eocdView.setUint32(12, cdSize, true);       // CD size
            eocdView.setUint32(16, cdOffset, true);     // CD offset
            eocdView.setUint16(20, 0, true);            // Comment length
            zipParts.push(eocd);

            // Combine all parts
            const totalSize = zipParts.reduce((sum, p) => sum + p.length, 0);
            const zipData = new Uint8Array(totalSize);
            let pos = 0;
            for (const part of zipParts) {
                zipData.set(part, pos);
                pos += part.length;
            }

            // Download
            const blob = new Blob([zipData], { type: 'application/zip' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'project_source.zip';
            a.click();
            URL.revokeObjectURL(a.href);

            showMessage(`Exported ${sourceFiles.length} source file(s)`);
        });
    }

    // Simple assembler - enough for basic code
    if (btnAsmAssemble) {
        btnAsmAssemble.addEventListener('click', assembleCode);
    }

    // Assembled bytes storage

    // Navigate to file:line in editor

    // Format error/warning location as clickable HTML

    // Scan source file header for @define markers (first 50 lines)
    // Format: ; @define NAME or ; @define NAME=VALUE

    // Update defines dropdown based on @define markers in source

    // Get selected defines from dropdown



    // Inject assembled code into memory (supports 128K paging)
    if (btnAsmInject) {
        btnAsmInject.addEventListener('click', () => {
            if (!spectrum.memory) {
                showMessage('Emulator not ready');
                return;
            }

            const deviceName = AsmMemory.getDeviceName();
            const emulatorIs128K = is128kCompat(spectrum.memory.machineType) || spectrum.memory.profile.ramPages > 1;

            // Check if we have paged assembly (DEVICE directive used)
            if (deviceName === 'ZXSPECTRUM128' || deviceName === 'ZXSPECTRUM512' || deviceName === 'ZXSPECTRUM1024') {
                // 128K paged assembly
                if (!emulatorIs128K) {
                    showMessage('Warning: 128K code cannot be fully injected to 48K machine. Only pages 5, 2, 0 will be injected.');
                }

                let totalBytes = 0;
                const pagesInjected = [];

                // For 128K emulator: inject all 8 pages to RAM banks
                // For 48K emulator: inject pages 5,2,0 to corresponding addresses
                const pagesToInject = emulatorIs128K ? [0, 1, 2, 3, 4, 5, 6, 7] : [5, 2, 0];

                for (const pageNum of pagesToInject) {
                    const pageData = AsmMemory.getPage(pageNum);
                    if (!pageData) continue;

                    // Check if page has any non-zero content
                    let hasContent = false;
                    for (let i = 0; i < pageData.length; i++) {
                        if (pageData[i] !== 0) {
                            hasContent = true;
                            break;
                        }
                    }

                    if (hasContent) {
                        if (emulatorIs128K) {
                            // Direct bank copy for 128K
                            const ramBank = spectrum.memory.getRamBank(pageNum);
                            if (ramBank) {
                                ramBank.set(pageData);
                                totalBytes += pageData.length;
                                pagesInjected.push(pageNum);
                            }
                        } else {
                            // 48K emulator - map pages to addresses
                            // Page 5 -> $4000, Page 2 -> $8000, Page 0 -> $C000
                            const addrMap = { 5: 0x4000, 2: 0x8000, 0: 0xC000 };
                            const baseAddr = addrMap[pageNum];
                            if (baseAddr !== undefined) {
                                for (let i = 0; i < pageData.length; i++) {
                                    spectrum.memory.write(baseAddr + i, pageData[i]);
                                }
                                totalBytes += pageData.length;
                                pagesInjected.push(pageNum);
                            }
                        }
                    }
                }

                // Reset paging state to match assembler's slot configuration
                if (emulatorIs128K) {
                    const asmBank = AsmMemory.slots[3].page;
                    spectrum.memory.setPagingState({
                        ramBank: asmBank & 0x07,
                        romBank: 0,
                        screenBank: 5,
                        pagingDisabled: false
                    });
                }

                if (pagesInjected.length > 0) {
                    showMessage(`Injected ${totalBytes} bytes from pages [${pagesInjected.join(', ')}]`);
                } else {
                    showMessage('No content to inject');
                }

            } else if (deviceName === 'ZXSPECTRUM48') {
                // 48K paged assembly - pages 1,2,3 map to $4000,$8000,$C000
                let totalBytes = 0;
                const addrMap = { 1: 0x4000, 2: 0x8000, 3: 0xC000 };

                for (const pageNum of [1, 2, 3]) {
                    const pageData = AsmMemory.getPage(pageNum);
                    if (!pageData) continue;

                    // Check if page has any non-zero content
                    let hasContent = false;
                    for (let i = 0; i < pageData.length; i++) {
                        if (pageData[i] !== 0) {
                            hasContent = true;
                            break;
                        }
                    }

                    if (hasContent) {
                        const baseAddr = addrMap[pageNum];
                        if (emulatorIs128K) {
                            // 128K emulator - map 48K pages to 128K banks
                            // Page 1 -> Bank 5, Page 2 -> Bank 2, Page 3 -> Bank 0
                            const bankMap = { 1: 5, 2: 2, 3: 0 };
                            const ramBank = spectrum.memory.getRamBank(bankMap[pageNum]);
                            if (ramBank) {
                                ramBank.set(pageData);
                                totalBytes += pageData.length;
                            }
                        } else {
                            // 48K emulator - direct address write
                            for (let i = 0; i < pageData.length; i++) {
                                spectrum.memory.write(baseAddr + i, pageData[i]);
                            }
                            totalBytes += pageData.length;
                        }
                    }
                }

                // Reset paging to bank 0 at C000 (48K default)
                if (emulatorIs128K) {
                    spectrum.memory.setPagingState({
                        ramBank: 0,
                        romBank: 0,
                        screenBank: 5,
                        pagingDisabled: false
                    });
                }

                if (totalBytes > 0) {
                    showMessage(`Injected ${totalBytes} bytes (48K device)`);
                } else {
                    showMessage('No content to inject');
                }

            } else {
                // No DEVICE - use linear output
                if (!assembledBytes || assembledBytes.length === 0) {
                    showMessage('No assembled code to inject');
                    return;
                }

                for (let i = 0; i < assembledBytes.length; i++) {
                    spectrum.memory.write(assembledOrg + i, assembledBytes[i]);
                }

                showMessage(`Injected ${assembledBytes.length} bytes at ${assembledOrg.toString(16).toUpperCase()}h`);
            }

            updateDebugger();
        });
    }

    // Debug button - assemble, inject code and start debugging
    if (btnAsmDebug) {
        btnAsmDebug.addEventListener('click', async () => {
            if (!spectrum.memory) {
                showMessage('Emulator not ready');
                return;
            }

            // First, re-assemble the current code
            doAssemble();

            // Check if assembly succeeded
            if (!assembledBytes && !AsmMemory.getDeviceName()) {
                showMessage('Assembly failed - cannot debug');
                return;
            }

            // Then inject
            btnAsmInject.click();

            // Determine entry point - priority: @entry > SAVESNA > single ORG > multiple ORGs (ask)
            let entryPoint = assembledOrg;

            if (assembledEntryPoint !== null) {
                // Use ; @entry marker
                entryPoint = assembledEntryPoint;
            } else {
                // Check if there's a SAVESNA command - use its start address
                const snaCommand = assembledSaveCommands.find(c => c.type === 'sna');
                if (snaCommand) {
                    entryPoint = snaCommand.start;
                } else if (assembledOrgAddresses.length > 1) {
                    // Multiple ORGs - ask user to select
                    entryPoint = await showOrgSelectionDialog(assembledOrgAddresses);
                    if (entryPoint === null) return;  // User cancelled
                } else if (assembledOrgAddresses.length === 1) {
                    entryPoint = assembledOrgAddresses[0];
                }
            }

            // Reset CPU and frame timing state for clean debug start
            spectrum.cpu.halted = false;
            spectrum.cpu.iff1 = 0;
            spectrum.cpu.iff2 = 0;
            spectrum.cpu.tStates = 0;
            spectrum.frameStartOffset = 0;
            spectrum.accumulatedContention = 0;
            spectrum.pendingInt = false;

            spectrum.cpu.pc = entryPoint;

            // Switch to debugger tab
            const debuggerTab = document.querySelector('.tab-btn[data-tab="debugger"]');
            if (debuggerTab) {
                debuggerTab.click();
            }

            // Update debugger view
            updateDebugger();
            updateStatus();

            showMessage(`Ready to debug at ${entryPoint.toString(16).toUpperCase()}h - press F7 to step`);
        });
    }

    // Download generated files
    if (btnAsmDownload) {
        btnAsmDownload.addEventListener('click', async () => {
            const saveCommands = assembledSaveCommands.filter(c =>
                c.type === 'bin' || c.type === 'sna' || c.type === 'tap' ||
                c.type === 'emptytap' || c.type === 'trd' || c.type === 'emptytrd'
            );

            if (saveCommands.length === 0) {
                showMessage('No files to download');
                return;
            }

            // Group commands by filename - multiple SAVETAP to same file = one TAP with multiple blocks
            const fileGroups = new Map();
            for (const cmd of saveCommands) {
                const filename = cmd.filename || cmd.trdFilename;
                if (!filename) continue;

                if (!fileGroups.has(filename)) {
                    fileGroups.set(filename, []);
                }
                fileGroups.get(filename).push(cmd);
            }

            // Generate file data for each unique filename
            const files = [];
            for (const [filename, commands] of fileGroups) {
                let data = null;

                // Determine file type from first non-empty command
                const firstCmd = commands.find(c => c.type !== 'emptytap' && c.type !== 'emptytrd') || commands[0];
                const fileType = firstCmd.type === 'emptytap' ? 'tap' :
                                 firstCmd.type === 'emptytrd' ? 'trd' : firstCmd.type;

                if (fileType === 'bin') {
                    // Binary file - use captured data directly
                    data = firstCmd.capturedData;
                } else if (fileType === 'sna') {
                    // SNA snapshot - generate from assembler memory state
                    data = generateSNAFile(firstCmd);
                } else if (fileType === 'tap') {
                    // TAP file - concatenate all blocks from all SAVETAP commands to this file
                    const tapCommands = commands.filter(c => c.type === 'tap');
                    if (tapCommands.length > 0) {
                        const allBlocks = [];
                        for (const cmd of tapCommands) {
                            const blockData = generateTAPBlocks(cmd);
                            if (blockData) allBlocks.push(blockData);
                        }
                        // Concatenate all blocks
                        const totalLen = allBlocks.reduce((sum, b) => sum + b.length, 0);
                        data = new Uint8Array(totalLen);
                        let offset = 0;
                        for (const block of allBlocks) {
                            data.set(block, offset);
                            offset += block.length;
                        }
                    }
                } else if (fileType === 'trd') {
                    // TRD file - not yet implemented
                    console.log('TRD export not yet implemented:', filename);
                    continue;
                }

                if (data && data.length > 0) {
                    files.push({ filename, data });
                }
            }

            if (files.length === 0) {
                showMessage('No valid files to download');
                return;
            }

            if (files.length === 1) {
                // Single file - download directly
                downloadBinaryFile(files[0].filename, files[0].data);
                showMessage(`Downloaded: ${files[0].filename}`);
            } else {
                // Multiple files - create ZIP
                const zipData = await createZipFromFiles(files);
                const zipName = currentProjectMainFile
                    ? currentProjectMainFile.replace(/\.[^.]+$/, '.zip')
                    : 'output.zip';
                downloadBinaryFile(zipName, zipData);
                showMessage(`Downloaded ${files.length} files as ${zipName}`);
            }
        });
    }

    // Generate SNA file from assembler memory state

    // Generate TAP blocks for a single SAVETAP command (may include header + data blocks)

    // Create a single TAP block with length prefix, flag, data, and checksum

    // Create ZIP file from multiple files

    // CRC32 calculation

    // Download binary file

    // Dialog for selecting ORG address when multiple are present

    // Auto-map handlers

    chkAutoMap.addEventListener('change', () => {
        spectrum.setAutoMapEnabled(chkAutoMap.checked);
        if (chkAutoMap.checked) {
            showMessage('Auto-map tracking enabled');
        }
    });

    btnAutoMapClear.addEventListener('click', () => {
        spectrum.clearAutoMap();
        spectrum.pendingSnapCallback = null;  // Cancel any pending snap
        exportSnapshot = null;  // Clear snap when clearing auto-map
        btnAutoMapSnap.style.background = '';  // Reset button style
        updateAutoMapStats();
        showMessage('Auto-map tracking cleared');
    });

    btnAutoMapSnap.addEventListener('click', () => {
        // Function to capture snapshot
        const captureSnapshot = () => {
            const cpu = spectrum.cpu;
            const paging = spectrum.memory.getPagingState();
            exportSnapshot = {
                cpu: {
                    a: cpu.a, f: cpu.f, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, h: cpu.h, l: cpu.l,
                    a_: cpu.a_, f_: cpu.f_, b_: cpu.b_, c_: cpu.c_, d_: cpu.d_, e_: cpu.e_, h_: cpu.h_, l_: cpu.l_,
                    ix: cpu.ix, iy: cpu.iy, sp: cpu.sp, pc: cpu.pc,
                    i: cpu.i, r: cpu.r, im: cpu.im, iff1: cpu.iff1, iff2: cpu.iff2
                },
                paging: {
                    ramBank: paging.ramBank,
                    romBank: paging.romBank,
                    screenBank: paging.screenBank,
                    pagingDisabled: paging.pagingDisabled
                },
                memory: spectrum.memory.getFullSnapshot(),
                border: spectrum.ula.borderColor,
                machineType: spectrum.machineType,
                timestamp: new Date().toISOString()
            };
            btnAutoMapSnap.style.background = 'var(--green)';
            const pcHex = cpu.pc.toString(16).toUpperCase().padStart(4, '0');
            showMessage(`Snap captured at PC=$${pcHex} (frame boundary) - continue running to collect code paths, then Export`);
        };

        if (spectrum.isRunning()) {
            // Schedule snap at next frame boundary (safest state)
            spectrum.pendingSnapCallback = captureSnapshot;
            btnAutoMapSnap.style.background = 'var(--yellow)';  // Yellow = pending
            showMessage('Snap scheduled for next frame boundary...');
        } else {
            // Paused - capture immediately (already at instruction boundary)
            captureSnapshot();
        }
    });

    document.getElementById('btnClearRegions').addEventListener('click', () => {
        const count = regionManager.getAll().length;
        if (count === 0) {
            showMessage('No regions to clear');
            return;
        }
        regionManager.clear();
        updateDebugger();
        showMessage(`Cleared ${count} regions`);
    });

    // XRef controls
    const btnXrefScan = document.getElementById('btnXrefScan');
    const btnXrefScanAll = document.getElementById('btnXrefScanAll');
    const btnXrefClear = document.getElementById('btnXrefClear');
    const chkXrefRuntime = document.getElementById('chkXrefRuntime');
    const xrefStats = document.getElementById('xrefStats');


    btnXrefScan.addEventListener('click', () => {
        // Scan visible range (approximate 4KB from current disasm view)
        const startAddr = getDisasmViewAddress() || 0;
        const endAddr = (startAddr + 0x1000) & 0xffff;
        const count = xrefManager.scanRange(startAddr, endAddr);
        updateXrefStats();
        showMessage(`Scanned ${hex16(startAddr)}-${hex16(endAddr)}: ${count} refs found`);
    });

    btnXrefScanAll.addEventListener('click', async () => {
        btnXrefScanAll.disabled = true;
        btnXrefScanAll.textContent = 'Scanning...';
        try {
            const count = await xrefManager.scanRangeAsync(0x0000, 0xFFFF, (done, total, refs) => {
                const pct = Math.round((done / total) * 100);
                btnXrefScanAll.textContent = `${pct}%`;
            });
            updateXrefStats();
            showMessage(`Full scan: ${count} refs found`);
        } finally {
            btnXrefScanAll.disabled = false;
            btnXrefScanAll.textContent = 'Scan All';
        }
    });

    btnXrefClear.addEventListener('click', () => {
        xrefManager.clear();
        updateXrefStats();
        showMessage('XRefs cleared');
    });

    chkXrefRuntime.addEventListener('change', () => {
        xrefRuntimeEnabled = chkXrefRuntime.checked;
        spectrum.xrefTrackingEnabled = xrefRuntimeEnabled;
        if (xrefRuntimeEnabled) {
            showMessage('XRef runtime tracking enabled');
        }
    });

    // Set up xref tracking callback
    spectrum.onInstructionExecuted = (pc) => {
        if (!xrefRuntimeEnabled || !disasm) return;
        const instr = disasm.disassemble(pc, true);
        if (instr.refs) {
            for (const ref of instr.refs) {
                xrefManager.add(ref.target, pc, ref.type, null);
            }
        }
    };

    // Trace controls
    const chkTraceEnabled = document.getElementById('chkTraceEnabled');
    const chkTraceRuntime = document.getElementById('chkTraceRuntime');
    const btnTraceBack = document.getElementById('btnTraceBack');
    const btnTraceForward = document.getElementById('btnTraceForward');
    const btnTraceLive = document.getElementById('btnTraceLive');
    const btnTraceClear = document.getElementById('btnTraceClear');
    const btnTraceExport = document.getElementById('btnTraceExport');
    const selTraceExportMode = document.getElementById('selTraceExportMode');
    const txtTraceExportCount = document.getElementById('txtTraceExportCount');
    const txtTraceStopAfter = document.getElementById('txtTraceStopAfter');
    const chkTraceBytes = document.getElementById('chkTraceBytes');
    const chkTraceAlt = document.getElementById('chkTraceAlt');
    const chkTraceSys = document.getElementById('chkTraceSys');
    const chkTracePorts = document.getElementById('chkTracePorts');
    const chkTraceSkipROM = document.getElementById('chkTraceSkipROM');
    const chkTraceCollapseBlock = document.getElementById('chkTraceCollapseBlock');
    const traceStatus = document.getElementById('traceStatus');
    const traceList = document.getElementById('traceList');

    // Set up trace recording callback
    spectrum.onBeforeStep = (cpu, memory, instrPC, portOps, memOps, instrBytes) => {
        try {
            traceManager.record(cpu, memory, instrPC, portOps, memOps, instrBytes);
        } catch (e) {
            console.error('Trace record error:', e);
        }
    };
    spectrum.traceEnabled = true;

    window.updateTraceStatus = function updateTraceStatus() {
        const len = traceManager.length;
        const pos = traceManager.getCurrentPosition();
        const stopped = traceManager.stopped;
        if (pos === -1) {
            traceStatus.textContent = stopped ? `${len} STOPPED` : `${len} instr`;
            traceStatus.classList.toggle('active', len > 0);
            traceStatus.style.color = stopped ? '#f44' : '';
        } else {
            traceStatus.textContent = `${pos + 1}/${len}`;
            traceStatus.classList.add('active');
            traceStatus.style.color = '';
        }
        btnTraceBack.disabled = len === 0 || pos === 0;
        btnTraceForward.disabled = pos === -1;
        btnTraceLive.disabled = pos === -1;
    }

    window.updateTraceList = function updateTraceList() {
        // Only update if trace panel is active
        const tracePanel = document.getElementById('panel-trace');
        if (!tracePanel || !tracePanel.classList.contains('active')) return;

        const currentPos = traceManager.getCurrentPosition();
        const totalLen = traceManager.length;

        // Get entries: either around current position or most recent
        let entries, startIdx, viewIdxInList;
        if (currentPos >= 0) {
            // Navigating history - show entries around current position
            const result = traceManager.getEntriesAround(currentPos, 20);
            entries = result.entries;
            startIdx = result.startIdx;
            viewIdxInList = result.viewIdx;
        } else {
            // Live view - show most recent entries
            entries = traceManager.getRecent(20);
            startIdx = totalLen - entries.length;
            viewIdxInList = -1;
        }

        if (entries.length === 0) {
            traceList.innerHTML = '<div style="padding:4px;color:var(--text-secondary)">No trace data</div>';
            return;
        }

        let html = '';
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const globalIdx = startIdx + i;
            const isViewing = currentPos === globalIdx;
            const isCurrent = currentPos === -1 && i === entries.length - 1;

            // Disassemble the instruction (use stored bytes as hex if disasm unavailable)
            let instrText = '';
            if (disasm) {
                const instr = disasm.disassemble(entry.pc);
                instrText = instr.text;
            } else {
                instrText = entry.bytes.slice(0, 3).map(b => hex8(b)).join(' ');
            }

            const classes = ['trace-entry'];
            if (isViewing) classes.push('viewing');
            if (isCurrent) classes.push('current');

            // Format port operations if present
            let portsHtml = '';
            if (entry.ports && entry.ports.length > 0) {
                const portStrs = entry.ports.map(p =>
                    `${p.dir === 'in' ? 'IN' : 'OUT'}(${hex16(p.port)})=${hex8(p.val)}`
                );
                portsHtml = `<span class="ports">${portStrs.join(' ')}</span>`;
            }

            // Format memory operations if present
            let memHtml = '';
            if (entry.mem && entry.mem.length > 0) {
                const memStrs = entry.mem.map(m => `[${hex16(m.addr)}]=${hex8(m.val)}`);
                const suffix = entry.mem.length >= 8 ? '...' : '';
                memHtml = `<span class="memops">${memStrs.join(' ')}${suffix}</span>`;
            }

            html += `<div class="${classes.join(' ')}" data-idx="${globalIdx}">` +
                `<span class="addr">${hex16(entry.pc)}</span>` +
                `<span class="instr">${instrText}</span>` +
                `<span class="regs">AF=${hex16(entry.af)} BC=${hex16(entry.bc)} HL=${hex16(entry.hl)}</span>` +
                portsHtml + memHtml +
                `</div>`;
        }
        traceList.innerHTML = html;

        // Scroll to show the relevant entry
        if (viewIdxInList >= 0) {
            // Navigating history - scroll to viewed entry
            const viewedEl = traceList.querySelector('.trace-entry.viewing');
            if (viewedEl) {
                viewedEl.scrollIntoView({ block: 'center', behavior: 'auto' });
            }
        } else {
            // Live view - scroll to bottom
            traceList.scrollTop = traceList.scrollHeight;
        }
    }


    chkTraceEnabled.addEventListener('change', () => {
        traceManager.enabled = chkTraceEnabled.checked;
        spectrum.traceEnabled = chkTraceEnabled.checked;
        if (chkTraceEnabled.checked) {
            showMessage('Step trace enabled');
        } else {
            showMessage('Step trace disabled');
        }
    });

    chkTraceRuntime.addEventListener('change', () => {
        spectrum.runtimeTraceEnabled = chkTraceRuntime.checked;
        spectrum.updateMemoryCallbacksFlag();
        if (chkTraceRuntime.checked) {
            showMessage('Runtime trace enabled');
        } else {
            showMessage('Runtime trace disabled');
        }
    });

    btnTraceBack.addEventListener('click', () => {
        const entry = traceManager.goBack();
        if (entry) {
            showTraceEntry(entry);
        }
    });

    btnTraceForward.addEventListener('click', () => {
        const entry = traceManager.goForward();
        if (entry) {
            showTraceEntry(entry);
        } else {
            // Returned to live
            traceManager.goToLive();
            traceViewAddress = null;  // Clear trace cursor
            updateTraceStatus();
            updateTraceList();
            updateDebugger();
            showMessage('Returned to live view');
        }
    });

    btnTraceLive.addEventListener('click', () => {
        traceManager.goToLive();
        traceViewAddress = null;  // Clear trace cursor
        updateTraceStatus();
        updateTraceList();
        updateDebugger();
        showMessage('Returned to live view');
    });

    btnTraceClear.addEventListener('click', () => {
        traceManager.clear();
        updateTraceStatus();
        updateTraceList();
        showMessage('Trace cleared');
    });

    btnTraceExport.addEventListener('click', () => {
        if (traceManager.length === 0) {
            showMessage('No trace data to export');
            return;
        }

        // Calculate range based on mode and count
        const mode = selTraceExportMode.value;  // 'first' or 'last'
        const count = parseInt(txtTraceExportCount.value, 10) || 0;
        const total = traceManager.length;

        let startIdx = 0;
        let endIdx = total;

        if (count > 0 && count < total) {
            if (mode === 'first') {
                startIdx = 0;
                endIdx = count;
            } else {
                startIdx = total - count;
                endIdx = total;
            }
        }

        const exportCount = endIdx - startIdx;

        const text = traceManager.exportToText({
            includeBytes: chkTraceBytes.checked,
            includeAlt: chkTraceAlt.checked,
            includeSys: chkTraceSys.checked,
            includePorts: chkTracePorts.checked,
            includeMem: false,
            collapseBlock: chkTraceCollapseBlock.checked,
            startIdx: startIdx,
            endIdx: endIdx
        });
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trace_${spectrum.machineType}_${mode}${count || 'all'}_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showMessage(`Exported ${exportCount} trace entries (${mode} ${count || 'all'})`);
    });

    // Update stopAfter on change or input
    txtTraceStopAfter.addEventListener('change', () => {
        updateTraceStopAfter();
        showMessage(traceManager.stopAfter > 0 ? `Trace will stop after ${traceManager.stopAfter} entries` : 'Trace limit disabled');
    });
    txtTraceStopAfter.addEventListener('input', updateTraceStopAfter);

    // Pause emulator when trace limit is reached
    traceManager.onStopped = () => {
        if (spectrum.running) {
            spectrum.stop();
            updateTraceStatus();
            showMessage(`Trace stopped at ${traceManager.length} entries - emulator paused`);
        }
    };

    // Initialize stopAfter from HTML default value
    updateTraceStopAfter();

    // Skip ROM checkbox
    chkTraceSkipROM.addEventListener('change', () => {
        traceManager.skipROM = chkTraceSkipROM.checked;
    });
    traceManager.skipROM = chkTraceSkipROM.checked;

    // Click on trace status to update trace list
    traceStatus.addEventListener('click', () => {
        updateTraceList();
    });

    // Click on trace entry to navigate
    traceList.addEventListener('click', (e) => {
        const entryEl = e.target.closest('.trace-entry');
        if (entryEl) {
            const idx = parseInt(entryEl.dataset.idx, 10);
            const entry = traceManager.getEntry(idx);
            if (entry) {
                traceManager.position = idx;
                showTraceEntry(entry);
            }
        }
    });

    // Memory Map Dialog
    const memmapDialog = document.getElementById('memmapDialog');
    const memmapCanvas = document.getElementById('memmapCanvas');
    const memmapCtx = memmapCanvas.getContext('2d');
    const memmapTooltip = document.getElementById('memmapTooltip');
    const memmapStats = document.getElementById('memmapStats');
    const memmapBar = document.getElementById('memmapBar');
    const memmapAddrInfo = document.getElementById('memmapAddrInfo');

    const MEMMAP_COLORS = {
        code: '#4080ff',
        smc: '#ff4040',
        db: '#ffcc00',
        dw: '#ff8800',
        text: '#40cc40',
        graphics: '#cc40cc',
        unmapped: '#606060',
        zero: '#000000'
    };

    const btnMemmapRegions = document.getElementById('btnMemmapRegions');
    const btnMemmapHeatmap = document.getElementById('btnMemmapHeatmap');
    const memmapLegendRegions = document.getElementById('memmapLegendRegions');
    const memmapLegendHeatmap = document.getElementById('memmapLegendHeatmap');
    const memmapBankToggle = document.getElementById('memmapBankToggle');
    const btnMemmap64K = document.getElementById('btnMemmap64K');
    const btnMemmap128K = document.getElementById('btnMemmap128K');
    const memmapScale = document.querySelector('.memmap-scale');







    btnMemmapRegions.addEventListener('click', () => setMemmapView('regions'));
    btnMemmapHeatmap.addEventListener('click', () => setMemmapView('heatmap'));
    btnMemmap64K.addEventListener('click', () => setMemmapBankMode('64k'));
    btnMemmap128K.addEventListener('click', () => setMemmapBankMode('128k'));



    // Heatmap data for tooltip access


    // 128K view: Show all 8 banks in a 2x4 grid with x2 horizontal scale


    memmapCanvas.addEventListener('mousemove', (e) => {
        const addr = getAddrFromCanvasPos(e.clientX, e.clientY);
        if (addr < 0) {
            memmapTooltip.style.display = 'none';
            return;
        }

        const val = spectrum.memory.read(addr);
        const label = labelManager.get(addr);
        let info, infoText;

        if (memmapViewMode === 'heatmap' && heatmapData) {
            // Heatmap tooltip
            const key = spectrum.getAutoMapKey(addr);
            const execCount = heatmapData.executed.get(key) || 0;
            const readCount = heatmapData.read.get(key) || 0;
            const writeCount = heatmapData.written.get(key) || 0;

            info = `${hex16(addr)}: E:${execCount} R:${readCount} W:${writeCount}`;
            if (label) info += ` [${label.name}]`;

            const addrHi = (addr >> 8).toString(16).toUpperCase().padStart(2, '0');
            const addrLo = (addr & 0xFF).toString(16).toUpperCase().padStart(2, '0');
            infoText = `Address: ${hex16(addr)} (${addrHi}xx + ${addrLo})\nValue: ${hex8(val)} (${val})`;
            infoText += `\nExecuted: ${execCount.toLocaleString()} times`;
            infoText += `\nRead: ${readCount.toLocaleString()} times`;
            infoText += `\nWritten: ${writeCount.toLocaleString()} times`;
            if (label) infoText += `\nLabel: ${label.name}`;
        } else {
            // Region tooltip
            const region = regionManager.get(addr);
            const type = region ? region.type : (val === 0 ? 'Zero' : 'Unmapped');

            info = `${hex16(addr)}: ${hex8(val)} - ${type}`;
            if (label) info += ` [${label.name}]`;

            const addrHi = (addr >> 8).toString(16).toUpperCase().padStart(2, '0');
            const addrLo = (addr & 0xFF).toString(16).toUpperCase().padStart(2, '0');
            infoText = `Address: ${hex16(addr)} (${addrHi}xx + ${addrLo})\nValue: ${hex8(val)} (${val})\nType: ${type}`;
            if (region && region.comment) infoText += `\n${region.comment}`;
            if (label) infoText += `\nLabel: ${label.name}`;
        }

        memmapTooltip.textContent = info;
        memmapTooltip.style.display = 'block';
        memmapTooltip.style.left = (e.clientX - memmapCanvas.getBoundingClientRect().left + 10) + 'px';
        memmapTooltip.style.top = (e.clientY - memmapCanvas.getBoundingClientRect().top - 20) + 'px';
        memmapAddrInfo.textContent = infoText;
    });

    memmapCanvas.addEventListener('mouseleave', () => {
        memmapTooltip.style.display = 'none';
    });

    memmapCanvas.addEventListener('click', (e) => {
        const addr = getAddrFromCanvasPos(e.clientX, e.clientY);
        if (addr >= 0) {
            closeMemoryMap();
            // Navigate disassembly (includes history)
            goToAddress(addr);
            // Navigate memory dump
            goToMemoryAddress(addr);
            updateDebugger();
        }
    });

    document.getElementById('btnMemoryMap').addEventListener('click', openMemoryMap);
    document.getElementById('btnMemmapClose').addEventListener('click', closeMemoryMap);
    document.getElementById('btnExportAsm').addEventListener('click', exportDisassembly);

    // Export disassembly as sjasmplus-compatible ASM file
    memmapDialog.addEventListener('click', (e) => {
        if (e.target === memmapDialog) closeMemoryMap();
    });

    btnAutoMapApply.addEventListener('click', () => {
        const data = spectrum.getAutoMapData();
        if (data.executed.size === 0) {
            showMessage('No execution data to apply', 'error');
            return;
        }

        // Merge consecutive addresses into regions
        function mergeToRegions(addrMap, type) {
            // Parse all addresses and group by page
            const byPage = new Map(); // page -> sorted addresses
            for (const key of addrMap.keys()) {
                const { addr, page } = spectrum.parseAutoMapKey(key);
                const pageKey = page || '';
                if (!byPage.has(pageKey)) byPage.set(pageKey, []);
                byPage.get(pageKey).push(addr);
            }

            const regions = [];
            for (const [pageKey, addrs] of byPage) {
                addrs.sort((a, b) => a - b);
                let start = addrs[0];
                let end = addrs[0];

                for (let i = 1; i < addrs.length; i++) {
                    if (addrs[i] === end + 1) {
                        end = addrs[i];
                    } else {
                        // Gap - finish this region
                        regions.push({
                            start,
                            end,
                            type,
                            page: pageKey || null
                        });
                        start = addrs[i];
                        end = addrs[i];
                    }
                }
                // Add final region
                regions.push({
                    start,
                    end,
                    type,
                    page: pageKey || null
                });
            }
            return regions;
        }

        // Find SMC: addresses that are both executed AND written
        const smcAddrs = new Map();
        for (const [key, count] of data.executed) {
            if (data.written.has(key)) {
                smcAddrs.set(key, count);
            }
        }

        // Find CODE: addresses executed but NOT written (pure code)
        const codeAddrs = new Map();
        for (const [key, count] of data.executed) {
            if (!data.written.has(key)) {
                codeAddrs.set(key, count);
            }
        }

        // Find DATA: addresses read but NOT executed
        const dataAddrs = new Map();
        for (const [key, count] of data.read) {
            if (!data.executed.has(key)) {
                dataAddrs.set(key, count);
            }
        }

        // Generate regions
        const smcRegions = mergeToRegions(smcAddrs, REGION_TYPES.SMC);
        const codeRegions = mergeToRegions(codeAddrs, REGION_TYPES.CODE);
        const dataRegions = mergeToRegions(dataAddrs, REGION_TYPES.DB);

        // Apply to region manager (skip overlapping regions)
        let added = 0, skipped = 0;
        for (const region of smcRegions) {
            const result = regionManager.add(region);
            if (result.error) skipped++; else added++;
        }
        for (const region of codeRegions) {
            const result = regionManager.add(region);
            if (result.error) skipped++; else added++;
        }
        for (const region of dataRegions) {
            const result = regionManager.add(region);
            if (result.error) skipped++; else added++;
        }

        // Detect subroutines from CALL targets in executed code
        const subsDetected = subroutineManager.detectFromCode(data.executed);

        updateDebugger();
        const msg = `Applied ${added} regions` + (skipped ? `, skipped ${skipped} overlapping` : '') + (subsDetected ? `, ${subsDetected} subroutines` : '');
        showMessage(msg);
    });

    // Update auto-map stats periodically
    setInterval(updateAutoMapStats, 1000);

    // Disassembly navigation handlers
    btnDisasmGo.addEventListener('click', () => {
        const addr = parseInt(disasmAddressInput.value, 16);
        if (!isNaN(addr)) {
            // If history is empty, save current view position first
            if (getLeftNavHistory().length === 0 && getDisasmViewAddress() !== null) {
                navPushHistory(getDisasmViewAddress());
            }
            navPushHistory(addr & 0xffff);
            setDisasmViewAddress(addr & 0xffff);
            updateDebugger();
        }
    });

    disasmAddressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const addr = parseInt(disasmAddressInput.value, 16);
            if (!isNaN(addr)) {
                // If history is empty, save current view position first
                if (getLeftNavHistory().length === 0 && getDisasmViewAddress() !== null) {
                    navPushHistory(getDisasmViewAddress());
                }
                navPushHistory(addr & 0xffff);
                setDisasmViewAddress(addr & 0xffff);
                updateDebugger();
            }
        }
    });

    btnDisasmPC.addEventListener('click', () => {
        setDisasmViewAddress(null); // Follow PC
        disasmAddressInput.value = '';
        updateDebugger();
    });

    // Keyboard shortcuts for navigation (Alt+Left/Right)
    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            navBack();
        } else if (e.altKey && e.key === 'ArrowRight') {
            e.preventDefault();
            navForward();
        }
    });

    btnDisasmPgUp.addEventListener('click', () => navBack());
    btnDisasmPgDn.addEventListener('click', () => navForward());
    updateNavButtons();  // Initialize disabled state

    // Generate assembly output for sjasmplus
}
