// assembler-ui.js — Assembler UI module (extracted from index.html)
// ES module with init-function pattern
import { escapeHtml, hex8, hex16, storageGet, storageSet } from '../core/utils.js';

export function initAssemblerUI({
    VFS,
    Assembler,
    AsmMemory,
    ErrorCollector,
    ZipLoader,
    MD5,
    getSpectrum,
    labelManager,
    showMessage,
    updateDebugger,
    updateStatus,
    updateLabelsList,
    is128kCompat,
    arrayToBase64,
    goToAddress,
    goToRightDisasmAddress,
    getLeftPanelType,
    getRightPanelType,
    switchLeftPanelType
}) {
    // ========== Assembler ==========
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
    const chkAsmExportZip = document.getElementById('chkAsmExportZip');
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

    // Encoding chosen by user for non-UTF-8 files (persisted in localStorage)
    let chosenFallbackEncoding = storageGet('zxm8_asmEncoding') || null;

    // Supported fallback encodings
    const FALLBACK_ENCODINGS = [
        { id: 'ibm866',        label: 'CP866 (DOS Cyrillic)' },
        { id: 'windows-1251',  label: 'Windows-1251 (Cyrillic)' },
        { id: 'koi8-r',        label: 'KOI8-R (Russian)' },
        { id: 'koi8-u',        label: 'KOI8-U (Ukrainian)' },
        { id: 'windows-1250',  label: 'Windows-1250 (Central European)' },
        { id: 'windows-1253',  label: 'Windows-1253 (Greek)' },
        { id: 'windows-1254',  label: 'Windows-1254 (Turkish)' },
        { id: 'windows-1257',  label: 'Windows-1257 (Baltic)' },
        { id: 'iso-8859-1',    label: 'ISO 8859-1 (Western European)' },
        { id: 'iso-8859-2',    label: 'ISO 8859-2 (Central European)' },
        { id: 'iso-8859-15',   label: 'ISO 8859-15 (Western w/ Euro)' }
    ];

    // Auto-detect most likely encoding from byte patterns
    function detectEncoding(bytes) {
        // Count bytes in discriminating ranges
        let cp866Score = 0, win1251Score = 0, koi8Score = 0;
        for (const b of bytes) {
            if (b >= 0x80 && b <= 0xAF) cp866Score++;       // Cyrillic in CP866, symbols in Win-1251
            else if (b >= 0xC0 && b <= 0xFF) win1251Score++; // Cyrillic in Win-1251, box drawing + р-я in CP866
            if (b >= 0xC0 && b <= 0xDF) koi8Score++;         // Lowercase Cyrillic in KOI8-R
        }
        if (cp866Score >= 3 && cp866Score >= win1251Score) return 'ibm866';
        if (win1251Score >= 3) return 'windows-1251';
        if (koi8Score >= 3) return 'koi8-r';
        return chosenFallbackEncoding || 'ibm866';
    }

    // Extract a meaningful text sample (skip leading blank lines, take ~20 lines with high-byte content)
    function extractPreviewSample(bytes, encoding) {
        const decoded = new TextDecoder(encoding).decode(bytes);
        const lines = decoded.split('\n');
        const sample = [];
        let collecting = false;
        for (const line of lines) {
            if (!collecting && line.trim() === '') continue;
            collecting = true;
            sample.push(line);
            if (sample.length >= 20) break;
        }
        return sample.join('\n');
    }

    // Show encoding preview dialog with side-by-side raw vs decoded view
    // Returns Promise<string|null> — encoding id or null if aborted
    function showEncodingDialog(bytes) {
        return new Promise((resolve) => {
            const detected = detectEncoding(bytes);

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;';

            const box = document.createElement('div');
            box.style.cssText = 'background:var(--bg-secondary,#1e1e2e);border:1px solid var(--border-color,#444);border-radius:6px;padding:16px;max-width:720px;width:92%;color:var(--text-primary,#ccc);font-family:monospace;font-size:12px;';

            // Title
            const title = document.createElement('div');
            title.style.cssText = 'font-size:13px;font-weight:bold;margin-bottom:12px;color:var(--text-highlight,#fff);';
            title.textContent = 'Non-UTF-8 encoding detected';
            box.appendChild(title);

            // Encoding selector row
            const selectorRow = document.createElement('div');
            selectorRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';

            const label = document.createElement('span');
            label.textContent = 'Encoding:';
            label.style.cssText = 'font-size:11px;color:var(--text-secondary,#aaa);';
            selectorRow.appendChild(label);

            const select = document.createElement('select');
            select.style.cssText = 'font-size:11px;padding:3px 6px;font-family:monospace;flex:1;max-width:280px;';
            for (const enc of FALLBACK_ENCODINGS) {
                const opt = document.createElement('option');
                opt.value = enc.id;
                opt.textContent = enc.label;
                if (enc.id === detected) opt.selected = true;
                select.appendChild(opt);
            }
            selectorRow.appendChild(select);
            box.appendChild(selectorRow);

            // Side-by-side preview
            const previewRow = document.createElement('div');
            previewRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';

            // Raw (UTF-8 lossy) preview
            const rawBox = document.createElement('div');
            rawBox.style.cssText = 'flex:1;min-width:0;';
            const rawLabel = document.createElement('div');
            rawLabel.style.cssText = 'font-size:10px;color:var(--text-secondary,#888);margin-bottom:4px;';
            rawLabel.textContent = 'Raw (UTF-8):';
            rawBox.appendChild(rawLabel);
            const rawPre = document.createElement('pre');
            rawPre.style.cssText = 'background:var(--bg-primary,#111);padding:8px;border-radius:3px;height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--text-secondary,#888);margin:0;';
            const rawText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            const rawLines = rawText.split('\n').slice(0, 20);
            rawPre.textContent = rawLines.join('\n');
            rawBox.appendChild(rawPre);
            previewRow.appendChild(rawBox);

            // Decoded preview
            const decBox = document.createElement('div');
            decBox.style.cssText = 'flex:1;min-width:0;';
            const decLabel = document.createElement('div');
            decLabel.style.cssText = 'font-size:10px;color:var(--cyan,#0af);margin-bottom:4px;';
            decLabel.textContent = 'Decoded:';
            decBox.appendChild(decLabel);
            const decPre = document.createElement('pre');
            decPre.style.cssText = 'background:var(--bg-primary,#111);padding:8px;border-radius:3px;height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11px;color:var(--text-primary,#ccc);margin:0;';
            decBox.appendChild(decPre);
            previewRow.appendChild(decBox);
            box.appendChild(previewRow);

            function updateDecoded() {
                const enc = select.value;
                decPre.textContent = extractPreviewSample(bytes, enc);
            }
            select.addEventListener('change', updateDecoded);
            updateDecoded();

            // Sync scroll between panels
            rawPre.addEventListener('scroll', () => { decPre.scrollTop = rawPre.scrollTop; });
            decPre.addEventListener('scroll', () => { rawPre.scrollTop = decPre.scrollTop; });

            // Buttons
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

            const btnAbort = document.createElement('button');
            btnAbort.textContent = 'Abort';
            btnAbort.style.cssText = 'padding:5px 16px;font-size:12px;cursor:pointer;';
            btnAbort.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });
            btnRow.appendChild(btnAbort);

            const btnImport = document.createElement('button');
            btnImport.textContent = 'Import';
            btnImport.style.cssText = 'padding:5px 16px;font-size:12px;cursor:pointer;font-weight:bold;';
            btnImport.addEventListener('click', () => {
                chosenFallbackEncoding = select.value;
                storageSet('zxm8_asmEncoding', select.value);
                document.body.removeChild(overlay);
                resolve(select.value);
            });
            btnRow.appendChild(btnImport);

            box.appendChild(btnRow);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            // Focus import button
            btnImport.focus();
        });
    }

    // Async decode: UTF-8 if valid, otherwise prompt user for encoding
    async function decodeText(data) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        // Try UTF-8
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (e) { /* not valid UTF-8 */ }
        // Use previously chosen encoding without asking again
        if (chosenFallbackEncoding) {
            return new TextDecoder(chosenFallbackEncoding).decode(bytes);
        }
        // Ask user
        const encoding = await showEncodingDialog(bytes);
        if (!encoding) return null; // aborted
        return new TextDecoder(encoding).decode(bytes);
    }

    // Current project state
    let currentProjectMainFile = null;  // Main file for compilation
    let currentOpenFile = null;         // Currently displayed file in editor
    let openTabs = [];                  // List of open tab paths
    let fileModified = {};              // Track modified state per file

    // ========== Undo/Redo system ==========
    // Checkpoints created at: typing pause (400ms), Enter key, explicit actions (Tab, Replace).
    // beforeinput captures baseline before first edit after quiet period.
    const ASM_UNDO_LIMIT = 100;
    let asmUndoStack = [];   // [{text, cursor}]
    let asmRedoStack = [];
    let asmUndoTimer = null; // non-null while typing burst is active

    function asmUndoPush() {
        if (!asmEditor) return;
        const text = asmEditor.value;
        // Skip if identical to top of stack
        if (asmUndoStack.length > 0 && text === asmUndoStack[asmUndoStack.length - 1].text) return;
        asmUndoStack.push({ text, cursor: asmEditor.selectionStart });
        if (asmUndoStack.length > ASM_UNDO_LIMIT) asmUndoStack.shift();
        asmRedoStack = [];
    }

    function asmUndoPushImmediate() {
        clearTimeout(asmUndoTimer);
        asmUndoTimer = null;
        asmUndoPush();
    }

    function asmUndoSchedule() {
        clearTimeout(asmUndoTimer);
        asmUndoTimer = setTimeout(() => {
            asmUndoPush();  // checkpoint at end of typing burst
            asmUndoTimer = null;
        }, 400);
    }

    function asmUndo() {
        if (!asmEditor || asmUndoStack.length === 0) return;
        clearTimeout(asmUndoTimer);
        asmUndoTimer = null;
        const current = asmEditor.value;
        // Skip top if it matches current (pause checkpoint with no subsequent edits)
        if (asmUndoStack[asmUndoStack.length - 1].text === current) {
            asmUndoStack.pop();
            if (asmUndoStack.length === 0) return;
        }
        asmRedoStack.push({ text: current, cursor: asmEditor.selectionStart });
        const prev = asmUndoStack.pop();
        asmEditor.value = prev.text;
        asmEditor.selectionStart = asmEditor.selectionEnd = prev.cursor;
        updateLineNumbers();
        updateHighlight();
        syncEditorToVFS();
        updateProjectButtons();
    }

    function asmRedo() {
        if (!asmEditor || asmRedoStack.length === 0) return;
        clearTimeout(asmUndoTimer);
        asmUndoTimer = null;
        asmUndoStack.push({ text: asmEditor.value, cursor: asmEditor.selectionStart });
        const next = asmRedoStack.pop();
        asmEditor.value = next.text;
        asmEditor.selectionStart = asmEditor.selectionEnd = next.cursor;
        updateLineNumbers();
        updateHighlight();
        syncEditorToVFS();
        updateProjectButtons();
    }

    function asmUndoReset() {
        asmUndoStack = [];
        asmRedoStack = [];
        clearTimeout(asmUndoTimer);
        asmUndoTimer = null;
    }

    // Show/hide buttons based on project state
    function updateProjectButtons() {
        const fileCount = Object.keys(VFS.files).length;
        const hasFiles = fileCount > 0;
        const hasMultipleFiles = fileCount > 1;
        const hasContent = asmEditor && asmEditor.value.trim().length > 0;

        if (btnAsmExport) {
            btnAsmExport.style.display = (hasFiles || hasContent) ? 'inline-block' : 'none';
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

    // Update files dropdown list
    function updateFilesList() {
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

            const icon = isBinary ? '\u{1F4E6}' : (isMain ? '\u25B6' : '\u{1F4C4}');
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

    // Open a file in a tab
    function openFileTab(path) {
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
        asmUndoReset();
        updateLineNumbers();
        updateHighlight();
        updateFileTabs();

        // Update defines dropdown when opening main file
        if (path === currentProjectMainFile || !currentProjectMainFile) {
            updateDefinesDropdown();
        }
    }

    // Close a file tab
    function closeFileTab(path) {
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

    // Update file tabs display
    function updateFileTabs() {
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
            tab.innerHTML = `<span class="tab-name" title="${path}">${name}</span><span class="tab-close">\u00D7</span>`;

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

    // Show main file selection dialog (returns a Promise)
    function showMainFileDialog(files, title = 'Select Main File') {
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
                    <span class="item-icon">\u{1F4C4}</span>
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
    function tokenizeAsmLine(line) {
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

    function highlightAsmCode(code) {
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

    function updateLineNumbers() {
        const lines = asmEditor.value.split('\n');
        const lineCount = lines.length;
        // Build line numbers without trailing newline to match textarea height
        const numbers = [];
        for (let i = 1; i <= lineCount; i++) {
            numbers.push(i);
        }
        asmLineNumbers.textContent = numbers.join('\n');
    }

    function updateHighlight() {
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

    function syncScroll() {
        asmHighlight.scrollTop = asmEditor.scrollTop;
        asmHighlight.scrollLeft = asmEditor.scrollLeft;
        asmLineNumbers.scrollTop = asmEditor.scrollTop;
    }

    // Sync editor to VFS when in project mode
    function syncEditorToVFS() {
        if (currentOpenFile && VFS.files[currentOpenFile] && !VFS.files[currentOpenFile].binary) {
            VFS.files[currentOpenFile].content = asmEditor.value;
        }
    }

    // Editor event listeners
    if (asmEditor) {
        // Debounce timer for defines detection
        let definesUpdateTimer = null;

        // Capture pre-edit baseline at the start of each typing burst
        asmEditor.addEventListener('beforeinput', () => {
            if (asmUndoTimer === null) {
                asmUndoPush();
            }
        });

        asmEditor.addEventListener('input', () => {
            asmUndoSchedule();
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
        // (beforeinput already captured pre-paste state)
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
            // Ctrl+Z - Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                asmUndo();
                return;
            }
            // Ctrl+Y or Ctrl+Shift+Z - Redo
            if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) {
                e.preventDefault();
                asmRedo();
                return;
            }
            // Enter - checkpoint before newline (line = natural undo boundary)
            if (e.key === 'Enter') {
                asmUndoPushImmediate();
            }
            // Tab inserts actual tab
            if (e.key === 'Tab') {
                e.preventDefault();
                asmUndoPushImmediate();
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
    function findFilesByBasename(basename) {
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

    // Show dialog to choose where to put a file
    async function showFileReplaceDialog(filename, existingPaths) {
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

    // Reusable file loading function (for Load button and drag & drop)
    async function loadAsmFiles(files) {
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
                            const text = await decodeText(f.data);
                            if (text === null) { showMessage('Import aborted'); return; }
                            VFS.addFile(f.name, text);
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
                        const text = await decodeText(arrayBuffer);
                        if (text === null) { showMessage('Import aborted'); return; }
                        VFS.addFile(targetPath, text);
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

    let searchMatches = [];
    let currentMatchIndex = -1;

    function openSearchBar(showReplace) {
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

    function closeSearchBar() {
        asmSearchBar.style.display = 'none';
        asmSearchResults.style.display = 'none';
        asmEditor.focus();
    }

    function searchAllFiles() {
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

    function searchInText(text, query, caseSensitive, filename) {
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

    function highlightMatch(text, query, caseSensitive) {
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
        return text.replace(regex, match => `<span class="asm-search-result-match">${match}</span>`);
    }

    function goToSearchResult(file, lineNum, col, matchLen) {
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
                asmUndoReset();
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

    function updateSearchMatches() {
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

    function findNext() {
        if (searchMatches.length === 0) {
            updateSearchMatches();
            if (searchMatches.length === 0) return;
        }

        currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
        selectMatch();
    }

    function findPrev() {
        if (searchMatches.length === 0) {
            updateSearchMatches();
            if (searchMatches.length === 0) return;
        }

        currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
        selectMatch();
    }

    function selectMatch() {
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

    function replaceOne() {
        if (searchMatches.length === 0 || currentMatchIndex < 0) return;

        asmUndoPushImmediate();
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

    function replaceAll() {
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

        asmUndoPushImmediate();
        asmEditor.value = text;
        updateLineNumbers();
        updateHighlight();
        syncEditorToVFS();
        updateSearchMatches();

        asmSearchCount.textContent = `Replaced ${count}`;
    }

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
    const asmFontSizeSelect = document.getElementById('asmFontSize');

    let asmFontSize = parseInt(storageGet('zxm8_asmFontSize')) || 12;

    function updateAsmFontSize(newSize) {
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

        storageSet('zxm8_asmFontSize', asmFontSize);

        // Update line numbers to match new height
        updateLineNumbers();
    }

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
            if (!confirm('Clear all files and assembled output?')) return;
            asmEditor.value = '';
            asmOutput.innerHTML = '<span class="asm-hint">Press Assemble to compile</span>';
            asmUndoReset();
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

            const alwaysZip = chkAsmExportZip && chkAsmExportZip.checked;

            // Single file: save as plain text (unless "Export ZIP" checked)
            if (sourceFiles.length === 1 && !alwaysZip) {
                const file = sourceFiles[0];
                const blob = new Blob([file.content], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = file.name;
                a.click();
                URL.revokeObjectURL(a.href);
                showMessage(`Exported ${file.name}`);
                return;
            }

            // Multiple files (or forced ZIP): create uncompressed ZIP
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

            showMessage(`Exported ${sourceFiles.length} source file(s) as ZIP`);
        });
    }

    // Simple assembler - enough for basic code
    if (btnAsmAssemble) {
        btnAsmAssemble.addEventListener('click', assembleCode);
    }

    // Assembled bytes storage
    let assembledBytes = null;
    let assembledOrg = 0;
    let assembledOrgAddresses = [];  // All ORG addresses from assembly
    let assembledSaveCommands = [];  // SAVESNA/SAVETAP commands from assembly
    let assembledEntryPoint = null;  // Entry point from ; @entry marker
    let assembledSymbols = [];       // Symbols from last assembly {name, value, type}

    // Navigate to file:line in editor
    function goToFileLine(file, line) {
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

    // Format error/warning location as clickable HTML
    function formatErrorLocation(file, line, message, isError) {
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

    // Scan source file header for @define markers (first 50 lines)
    // Format: ; @define NAME or ; @define NAME=VALUE
    function detectDefinesFromSource() {
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

    // Update defines dropdown based on @define markers in source
    function updateDefinesDropdown() {
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

    // Get selected defines from dropdown
    function getSelectedDefinesFromDropdown() {
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

    function assembleCode() {
        const spectrum = getSpectrum();
        // Pause emulator before assembly
        if (spectrum.isRunning()) {
            spectrum.stop();
            updateStatus();
        }
        // Run assembly directly (no setTimeout to avoid race with Debug button)
        doAssemble();
    }

    function doAssemble() {
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
            assembledSymbols = result.symbols || [];

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
                        const bytesHex = chunk.map(b => hex8(b)).join(' ');
                        html += `<div class="asm-line">`;
                        html += `<span class="asm-addr">${hex16(addr)}</span>`;
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

    // Inject assembled code into memory (supports 128K paging)
    if (btnAsmInject) {
        btnAsmInject.addEventListener('click', () => {
            const spectrum = getSpectrum();
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
            const spectrum = getSpectrum();
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

            // Inject assembler symbols as debugger labels
            if (assembledSymbols.length > 0) {
                let injected = 0;
                for (const sym of assembledSymbols) {
                    const addr = sym.value & 0xFFFF;
                    // Skip symbols outside addressable range or internal
                    if (sym.value < 0 || sym.value > 0xFFFF) continue;
                    if (sym.name.startsWith('__')) continue;
                    // Only add if no existing user label at this address
                    if (!labelManager.get(addr)) {
                        labelManager.add({ address: addr, name: sym.name });
                        injected++;
                    }
                }
                if (injected > 0) {
                    updateLabelsList();
                }
            }

            // Switch to debugger tab
            const debuggerTab = document.querySelector('.tab-btn[data-tab="debugger"]');
            if (debuggerTab) {
                debuggerTab.click();
            }

            // Navigate disassembly to entry address
            if (getLeftPanelType() === 'disasm') {
                goToAddress(entryPoint);
            } else if (getRightPanelType() === 'disasm') {
                goToRightDisasmAddress(entryPoint);
            } else {
                switchLeftPanelType('disasm');
                goToAddress(entryPoint);
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
    function generateSNAFile(cmd) {
        const deviceName = AsmMemory.getDeviceName();
        const is128k = AsmMemory.device &&
            (deviceName === 'ZXSPECTRUM128' || deviceName === 'ZXSPECTRUM512' || deviceName === 'ZXSPECTRUM1024');
        const size = is128k ? 131103 : 49179;
        const snaData = new Uint8Array(size);

        const startAddr = cmd.start;

        // SNA header (27 bytes) — USR 0 register state matching sjasmplus
        //  I    L'   H'   E'   D'   C'   B'   F'   A'   L    H    E    D    C    B
        //  IYL  IYH  IXL  IXH  IFF2 R    F    A    SPL  SPH  IM   Border
        snaData[0]  = 0x3F;                          // I
        snaData[1]  = 0x58; snaData[2]  = 0x27;     // HL' = 0x2758
        snaData[3]  = 0x9B; snaData[4]  = 0x36;     // DE' = 0x369B
        snaData[5]  = 0x00; snaData[6]  = 0x00;     // BC' = 0x0000
        snaData[7]  = 0x44; snaData[8]  = 0x00;     // AF' = 0x0044
        snaData[9]  = 0x2B; snaData[10] = 0x2D;     // HL  = 0x2D2B
        snaData[11] = 0xDC; snaData[12] = 0x5C;     // DE  = 0x5CDC
        // BC = start address (sjasmplus convention)
        snaData[13] = startAddr & 0xFF;
        snaData[14] = (startAddr >> 8) & 0xFF;
        snaData[15] = 0x3A; snaData[16] = 0x5C;     // IY  = 0x5C3A
        snaData[17] = 0x3C; snaData[18] = 0xFF;     // IX  = 0xFF3C
        snaData[19] = 0x00;                          // IFF2 = disabled
        snaData[20] = 0x00;                          // R
        snaData[21] = 0x54; snaData[22] = 0x00;     // AF  = 0x0054
        // SP — set below after RAM dump (depends on stack analysis)
        snaData[23] = 0x00; snaData[24] = 0x00;     // SP (placeholder)
        snaData[25] = 0x01;                          // IM 1
        snaData[26] = 0x07;                          // Border = white

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
                // ZXSPECTRUM48: pages 1, 2, 3 map to 0x4000-0xFFFF
                const pageMap = [1, 2, 3];
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
            // 128K: SP = default stack address (USR 0 state)
            snaData[23] = 0x58; snaData[24] = 0x5D; // SP = 0x5D58

            // 128K extended header at offset 49179
            const offset = 49179;
            // PC
            snaData[offset] = startAddr & 0xFF;
            snaData[offset + 1] = (startAddr >> 8) & 0xFF;
            // Port 0x7FFD value: bits 0-2 = current bank, bit 4 = ROM bank 1 (48K BASIC, USR 0 state)
            const currentBank = AsmMemory.slots[3].page;
            snaData[offset + 2] = 0x10 | (currentBank & 0x07);
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
            // 48K: Check if default stack is unmodified (sjasmplus approach)
            // Default stack at $5D58-$5D5B: 03 13 00 3E
            // Plus two zero bytes before it at $5D56-$5D57 (for 48K PC injection check)
            const stackAddr = 0x5D58; // ZxRamTop(0x5D5B) + 1 - 4
            const ramOffset = 27; // SNA header size
            const defaultStackOK =
                snaData[ramOffset + (stackAddr - 0x4000)]     === 0x03 &&
                snaData[ramOffset + (stackAddr - 0x4000) + 1] === 0x13 &&
                snaData[ramOffset + (stackAddr - 0x4000) + 2] === 0x00 &&
                snaData[ramOffset + (stackAddr - 0x4000) + 3] === 0x3E &&
                snaData[ramOffset + (stackAddr - 0x4000) - 2] === 0x00 &&
                snaData[ramOffset + (stackAddr - 0x4000) - 1] === 0x00;

            if (defaultStackOK) {
                // Inject PC below the default stack at $5D56
                snaData[ramOffset + (0x5D56 - 0x4000)]     = startAddr & 0xFF;
                snaData[ramOffset + (0x5D56 - 0x4000) + 1] = (startAddr >> 8) & 0xFF;
                // SP points at injected PC
                snaData[23] = 0x56; snaData[24] = 0x5D; // SP = 0x5D56
            } else {
                // Stack was modified — fallback: inject PC at $4000, SP = $4000
                snaData[ramOffset]     = startAddr & 0xFF;
                snaData[ramOffset + 1] = (startAddr >> 8) & 0xFF;
                snaData[23] = 0x00; snaData[24] = 0x40; // SP = 0x4000
            }
        }

        return snaData;
    }

    // Generate TAP blocks for a single SAVETAP command (may include header + data blocks)
    function generateTAPBlocks(cmd) {
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

    // Create a single TAP block with length prefix, flag, data, and checksum
    function createTAPBlock(data, flagByte) {
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

    // CRC-32 calculation for ZIP creation
    function crc32(data) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < data.length; i++) {
            crc ^= data[i];
            for (let j = 0; j < 8; j++) {
                crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
            }
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    // Create ZIP file from multiple files
    async function createZipFromFiles(files) {
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
            const crcVal = crc32(file.data);
            localHeader[14] = crcVal & 0xFF;
            localHeader[15] = (crcVal >> 8) & 0xFF;
            localHeader[16] = (crcVal >> 16) & 0xFF;
            localHeader[17] = (crcVal >> 24) & 0xFF;
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
                crc: crcVal
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

    // Download binary file
    function downloadBinaryFile(filename, data) {
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

    // Dialog for selecting ORG address when multiple are present
    async function showOrgSelectionDialog(addresses) {
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
                                ${hex16(addr)}h
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

    // Return API object
    return {
        // For project save
        saveState: () => {
            // Sync current editor to VFS
            if (currentOpenFile && VFS.files[currentOpenFile] && !VFS.files[currentOpenFile].binary) {
                VFS.files[currentOpenFile].content = asmEditor.value;
            }
            return {
                editorContent: asmEditor.value,
                mainFile: currentProjectMainFile,
                openTabs: openTabs,
                currentOpenFile: currentOpenFile,
                files: {},    // caller fills from VFS
                binaryFiles: {} // caller fills from VFS
            };
        },
        // For project load
        restoreState: (data) => {
            currentProjectMainFile = data.mainFile || null;
            openTabs = data.openTabs || [];
            currentOpenFile = data.currentOpenFile || null;
            fileModified = {};
            if (Object.keys(VFS.files).length > 0 && openTabs.length === 0) {
                if (currentProjectMainFile) {
                    openTabs.push(currentProjectMainFile);
                    currentOpenFile = currentProjectMainFile;
                }
            }
            if (currentOpenFile && VFS.files[currentOpenFile]) {
                asmEditor.value = VFS.files[currentOpenFile].content || '';
            } else if (data.editorContent && asmEditor) {
                asmEditor.value = data.editorContent;
            }
            asmUndoReset();
            updateLineNumbers();
            updateHighlight();
            updateFileTabs();
            updateProjectButtons();
            updateDefinesDropdown();
        },
        // For checking if there's content to save
        hasContent: () => !!(asmEditor && (asmEditor.value || Object.keys(VFS.files).length > 0)),
        getEditorValue: () => asmEditor ? asmEditor.value : '',
    };
}
