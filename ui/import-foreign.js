// import-foreign.js - Import foreign assembler sources into the ASM project
// Reads single files, .zip archives and .trd/.scl disk images, detokenizes
// native binary formats (ALASM, TASM - see core/asm-detok.js), converts the
// dialect to sjasmplus syntax (core/asm-convert.js) and lands the result in
// the assembler VFS like a normally loaded project.

import { AsmDetok, DETOK_FORMAT_NAMES, cp866Char } from '../core/asm-detok.js';
import { AsmDialectConverter } from '../core/asm-convert.js';
import { escapeHtml } from '../core/utils.js';

export function initImportForeign({ TRDLoader, SCLLoader, ZipLoader, showMessage, addProjectFiles }) {
    const btnOpen = document.getElementById('btnAsmImportForeign');
    const dialog = document.getElementById('importForeignDialog');
    if (!btnOpen || !dialog) return null;

    const fileInput = document.getElementById('impForeignFile');
    const btnChoose = document.getElementById('btnImpForeignChoose');
    const srcName = document.getElementById('impForeignSrcName');
    const listEl = document.getElementById('impForeignList');
    const previewEl = document.getElementById('impForeignPreview');
    const statusEl = document.getElementById('impForeignStatus');
    const btnCancel = document.getElementById('btnImpForeignCancel');
    const btnOk = document.getElementById('btnImpForeignOk');

    // Catalog entries: { name, typeChar, vfsName, data, format, include, selectable }
    let entries = [];
    let selectedRow = -1;
    // When a ZIP contains several disk images, the user picks one explicitly
    let pendingDisks = null;   // [{ name, data, Loader, count }]
    let pendingLoose = null;   // non-disk ZIP entries [{ name, data }]
    let sourceName = '';

    const TEXT_EXTS = ['asm', 'a80', 'z80', 's', 'inc', 'txt', 'def', 'h'];

    function open() {
        entries = [];
        selectedRow = -1;
        pendingDisks = null;
        pendingLoose = null;
        if (fileInput) fileInput.value = '';
        if (srcName) srcName.textContent = 'or drop a .trd / .scl / .zip / single file here';
        renderList();
        renderPreview();
        dialog.classList.remove('hidden');
    }

    function close() {
        dialog.classList.add('hidden');
    }

    // ---- source loading -----------------------------------------------------

    async function loadSource(file) {
        try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const lower = file.name.toLowerCase();

            entries = [];
            selectedRow = -1;
            pendingDisks = null;
            pendingLoose = null;
            sourceName = file.name;

            if (lower.endsWith('.trd') && TRDLoader.isTRD(buffer)) {
                addDiskEntries(buffer, TRDLoader);
            } else if (lower.endsWith('.scl') && SCLLoader.isSCL(buffer)) {
                addDiskEntries(buffer, SCLLoader);
            } else if (lower.endsWith('.zip') && ZipLoader.isZip(buffer)) {
                const zipFiles = await ZipLoader.extract(buffer);
                const disks = [], loose = [];
                for (const f of zipFiles) {
                    if (f.name.endsWith('/') || f.name.startsWith('.') || f.name.includes('/.')) continue;
                    const fdata = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
                    const fl = f.name.toLowerCase();
                    if (SCLLoader.isSCL(fdata)) {
                        disks.push({ name: f.name, data: fdata, Loader: SCLLoader });
                    } else if (fl.endsWith('.trd') && TRDLoader.isTRD(fdata)) {
                        disks.push({ name: f.name, data: fdata, Loader: TRDLoader });
                    } else {
                        loose.push({ name: f.name, data: fdata });
                    }
                }
                if (disks.length > 1) {
                    // Several disk images - let the user pick the exact one
                    for (const d of disks) {
                        try { d.count = d.Loader.listFiles(d.data).length; }
                        catch (e) { d.count = null; }
                    }
                    pendingDisks = disks;
                    pendingLoose = loose;
                    if (srcName) srcName.textContent = `${file.name} — ${disks.length} disk images`;
                    setStatus('Archive contains several disk images — choose one to open');
                    renderDiskChooser();
                    renderPreview();
                    return;
                }
                if (disks.length === 1) {
                    addDiskEntries(disks[0].data, disks[0].Loader);
                }
                for (const f of loose) addZipEntry(f.name, f.data);
            } else {
                // Single file - possibly Hobeta-wrapped
                const hobeta = AsmDetok.parseHobeta(bytes);
                if (hobeta) {
                    addEntry(hobeta.name, hobeta.type, hobeta.data, { type: hobeta.type, start: hobeta.start });
                } else {
                    const dotName = file.name.replace(/^.*[\\/]/, '');
                    const base = dotName.replace(/\.[^.]*$/, '');
                    const extM = dotName.match(/\.([^.]*)$/);
                    addEntry(base, extM ? extM[1] : '', bytes, null);
                }
            }

            if (srcName) srcName.textContent = `${file.name} — ${entries.length} file(s)`;
            if (entries.length === 0) {
                setStatus('No files found in ' + file.name);
            } else {
                // Preselect the first source file for preview
                selectedRow = entries.findIndex(e => e.format !== 'binary');
                if (selectedRow < 0) selectedRow = 0;
                setStatus('');
            }
            renderList();
            renderPreview();
        } catch (err) {
            console.error('Import foreign load error:', err);
            setStatus('Error: ' + err.message);
        }
    }

    // Expand a TRD/SCL disk image into one entry per catalog file
    function addDiskEntries(data, Loader) {
        for (const f of Loader.listFiles(data)) {
            addEntry(f.name, f.ext, Loader.extractFile(data, f), { type: f.ext, start: f.start });
        }
    }

    // Chooser step for archives with several disk images
    function renderDiskChooser() {
        entries = [];
        selectedRow = -1;
        if (!listEl) return;
        listEl.innerHTML = pendingDisks.map((d, i) =>
            `<div class="impf-row" data-disk="${i}">
                <span>💾</span>
                <span class="impf-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
                <span class="impf-size">${d.count === null ? '?' : d.count + ' files'}</span>
            </div>`).join('');
        updateOkButton();
    }

    function openPendingDisk(i) {
        const d = pendingDisks[i];
        entries = [];
        try {
            addDiskEntries(d.data, d.Loader);
        } catch (err) {
            setStatus('Error reading ' + d.name + ': ' + err.message);
            return;
        }
        for (const f of pendingLoose) addZipEntry(f.name, f.data);
        if (srcName) srcName.textContent = `${sourceName} — ${d.name}`;
        setStatus('');
        selectedRow = entries.findIndex(e => e.format !== 'binary');
        if (selectedRow < 0 && entries.length) selectedRow = 0;
        renderList();
        renderPreview();
    }

    function addEntry(name, typeChar, data, meta) {
        const det = AsmDetok.detect(data, meta);
        let format, note = '';
        if (det && det.supported && det.format !== 'text') {
            format = det.format;
        } else if (det && !det.supported) {
            format = 'binary';
            note = DETOK_FORMAT_NAMES[det.format] + ' — not supported yet';
        } else if (det && det.format === 'text') {
            format = suggestTextDialect(data);
        } else {
            format = 'binary';
        }
        entries.push({
            name: name.trim(),
            typeChar: (typeChar || '').trim(),
            vfsName: makeVfsName(name, typeChar, format),
            data,
            format,
            note,
            include: true
        });
    }

    function addZipEntry(path, data) {
        const base = path.replace(/^.*[\\/]/, '');
        const extM = base.match(/\.([^.]*)$/);
        const ext = extM ? extM[1].toLowerCase() : '';
        const hobeta = AsmDetok.parseHobeta(data);
        if (hobeta && AsmDetok.detect(hobeta.data, { type: hobeta.type, start: hobeta.start })) {
            addEntry(hobeta.name, hobeta.type, hobeta.data, { type: hobeta.type, start: hobeta.start });
            return;
        }
        const det = AsmDetok.detect(data, null);
        let format;
        if (det && det.supported && det.format !== 'text') format = det.format;
        else if (TEXT_EXTS.includes(ext) || (det && det.format === 'text')) {
            format = suggestTextDialect(data);
        } else format = 'binary';
        entries.push({
            name: base.replace(/\.[^.]*$/, ''),
            typeChar: ext,
            vfsName: format === 'binary' || format === 'text' ? path : makeVfsName(base.replace(/\.[^.]*$/, ''), ext, format),
            data,
            format,
            note: det && !det.supported ? DETOK_FORMAT_NAMES[det.format] + ' — not supported yet' : '',
            include: true
        });
    }

    // Sanitized VFS filename: converted sources become NAME.a80,
    // other files keep their (sanitized) name + type as extension.
    function makeVfsName(name, typeChar, format) {
        const base = name.trim().replace(/[^\w.\-]+/g, '_').toLowerCase() || 'file';
        if (['alasm', 'tasm', 'tasm4', 'ads', 'storm', 'gens', 'zeus', 'pasmo', 'alasm-text', 'tasm-text'].includes(format)) {
            return base.includes('.') ? base.replace(/\.[^.]*$/, '.a80') : base + '.a80';
        }
        const ext = (typeChar || '').trim().replace(/[^\w]+/g, '').toLowerCase();
        if (base.includes('.')) return base;
        return ext ? base + '.' + ext : base;
    }

    // Suggest a text dialect: Zeus when its hallmarks appear (slash strings,
    // PROC/MEND); GENS when most lines are numbered or * controls appear.
    function suggestTextDialect(bytes) {
        const text = bytesToText(bytes.slice(0, 4096));
        const lines = text.split('\n').filter(l => l.trim() !== '');
        if (lines.length < 4) return 'text';
        if (lines.some(l => /\bDEFM\s+\/|\bPROC\b|\bMEND\b|\bRETP\b/.test(l))) return 'zeus';
        const numbered = lines.filter(l => /^\d+[ \t]/.test(l)).length;
        if (numbered / lines.length > 0.7) return 'gens';
        if (lines.some(l => /^\*[A-Za-z][+-]?\s*$/.test(l))) return 'gens';
        return 'text';
    }

    // ---- conversion -----------------------------------------------------------

    function buildFileMap() {
        const map = {};
        const binaryTargets = new Set();
        // Project-wide label renames: a weird label (out[DE], ANT@) may be
        // declared in one file and referenced from another
        const renames = new Map();
        for (const e of entries) {
            if (!e.include) continue;
            AsmDialectConverter.addFileMapEntries(map, e.name, e.typeChar, e.vfsName);
            if (e.format === 'binary') {
                binaryTargets.add(e.vfsName);
                continue;
            }
            const text = sourceTextOf(e);
            if (text == null) continue;
            const lines = text.replace(/\r\n|\r/g, '\n').split('\n');
            for (const [o, r] of AsmDialectConverter.buildLabelRenames(lines)) {
                if (!renames.has(o)) renames.set(o, r);
            }
        }
        return { fileMap: map, binaryTargets, renames };
    }

    // Detokenized/decoded source text of an entry, cached per format
    function sourceTextOf(e) {
        if (e.format === 'binary') return null;
        if (e._cacheFmt === e.format && e._cacheText !== undefined) return e._cacheText;
        let t = null;
        if (e.format === 'text' || TEXT_DIALECTS[e.format]) {
            t = bytesToText(e.data);
        } else {
            t = AsmDetok.detokenize(e.data, e.format).text;
        }
        e._cacheFmt = e.format;
        e._cacheText = t;
        return t;
    }

    // Convert one entry. Returns { text, warnings } or { data } for binary.
    // ctx is the result of buildFileMap(): { fileMap, binaryTargets }
    function convertEntry(entry, ctx) {
        if (entry.format === 'binary') {
            return { data: entry.data };
        }
        if (entry.format === 'text') {
            return { text: bytesToText(entry.data), warnings: [] };
        }
        if (TEXT_DIALECTS[entry.format]) {
            const r = AsmDialectConverter.convert(bytesToText(entry.data), TEXT_DIALECTS[entry.format], ctx);
            return { text: r.text, warnings: r.warnings };
        }
        const detok = AsmDetok.detokenize(entry.data, entry.format);
        if (detok.text === null) {
            return { text: '; [import] could not detokenize: ' + detok.warnings.join('; '), warnings: detok.warnings };
        }
        const conv = AsmDialectConverter.convert(detok.text, entry.format, ctx);
        return { text: conv.text, warnings: detok.warnings.concat(conv.warnings) };
    }

    // Decode source text: high bytes outside double-quoted strings are CP866
    // Cyrillic (comments); inside strings they stay byte-exact so DB "..."
    // data survives reassembly unchanged.
    function bytesToText(bytes) {
        let s = '';
        let inString = false;
        for (let i = 0; i < bytes.length; i++) {
            let b = bytes[i];
            if (b === 0x0D) {
                if (bytes[i + 1] === 0x0A) continue;
                b = 0x0A;
            }
            if (b === 0x0A) {
                inString = false;
                s += '\n';
                continue;
            }
            if (b === 0x22) {
                inString = !inString;
                s += '"';
                continue;
            }
            s += inString ? String.fromCharCode(b) : cp866Char(b);
        }
        return s;
    }

    // ---- rendering ------------------------------------------------------------

    const FORMAT_OPTIONS = [
        ['alasm', 'ALASM'],
        ['tasm', 'TASM 3.x'],
        ['tasm4', 'TASM 4.x'],
        ['ads', 'ADS'],
        ['storm', 'STORM'],
        ['alasm-text', 'ALASM (text)'],
        ['tasm-text', 'TASM (text)'],
        ['gens', 'GENS (text)'],
        ['zeus', 'Zeus (text)'],
        ['pasmo', 'Pasmo (text)'],
        ['text', 'Text as-is'],
        ['binary', 'Binary']
    ];

    // Text-level dialects: no detokenization, converted straight from text
    const TEXT_DIALECTS = { 'alasm-text': 'alasm', 'tasm-text': 'tasm', 'gens': 'gens', 'zeus': 'zeus', 'pasmo': 'pasmo' };

    function renderList() {
        if (!listEl) return;
        if (entries.length === 0) {
            listEl.innerHTML = '<div class="impf-empty">No file loaded</div>';
            updateOkButton();
            return;
        }
        // Inside a multi-disk archive: a row to go back to the disk chooser
        const backRow = pendingDisks
            ? `<div class="impf-row impf-back" data-back="1">◀ choose another disk (${pendingDisks.length} in archive)</div>`
            : '';
        listEl.innerHTML = backRow + entries.map((e, i) => {
            const opts = FORMAT_OPTIONS.map(([v, label]) =>
                `<option value="${v}"${e.format === v ? ' selected' : ''}>${label}</option>`).join('');
            const dispName = e.typeChar && !e.name.includes('.') ? `${e.name}.${e.typeChar}` : e.name;
            return `<div class="impf-row${i === selectedRow ? ' selected' : ''}" data-i="${i}">
                <input type="checkbox" data-chk="${i}"${e.include ? ' checked' : ''}>
                <span class="impf-name" title="${escapeHtml(e.vfsName)}">${escapeHtml(dispName)}</span>
                <span class="impf-size">${e.data.length}</span>
                <select data-fmt="${i}" title="${escapeHtml(e.note || 'Source format')}">${opts}</select>
            </div>`;
        }).join('');
        updateOkButton();
    }

    function renderPreview() {
        if (!previewEl) return;
        const e = entries[selectedRow];
        if (!e) {
            previewEl.textContent = '';
            return;
        }
        if (e.format === 'binary') {
            previewEl.textContent = (e.note ? e.note + '\n' : '') +
                `Binary file — ${e.data.length} bytes (imported as "${e.vfsName}")`;
            return;
        }
        const r = convertEntry(e, buildFileMap());
        let head = '';
        if (r.warnings && r.warnings.length) {
            head = '; ===== ' + r.warnings.length + ' warning(s) =====\n' +
                r.warnings.slice(0, 20).map(w => '; ' + w).join('\n') +
                (r.warnings.length > 20 ? '\n; …' : '') + '\n; =====\n\n';
        }
        previewEl.textContent = head + (r.text || '');
    }

    function setStatus(msg) {
        if (statusEl) statusEl.textContent = msg;
    }

    function updateOkButton() {
        if (btnOk) btnOk.disabled = !entries.some(e => e.include);
    }

    // ---- import ---------------------------------------------------------------

    function doImport() {
        const ctx = buildFileMap();
        const files = [];
        let totalWarnings = 0;
        let mainHint = null;

        for (const e of entries) {
            if (!e.include) continue;
            const r = convertEntry(e, ctx);
            if (r.data !== undefined) {
                files.push({ path: e.vfsName, data: r.data });
            } else {
                files.push({ path: e.vfsName, text: r.text });
                totalWarnings += (r.warnings || []).length;
                if (!mainHint && /\.(asm|z80|s|a80)$/i.test(e.vfsName)) mainHint = e.vfsName;
            }
        }

        if (files.length === 0) return;
        close();
        addProjectFiles(files, mainHint);
        showMessage(`Imported ${files.length} file(s)` +
            (totalWarnings ? ` — ${totalWarnings} conversion warning(s), see "; [import]" comments` : ''));
    }

    // ---- events ---------------------------------------------------------------

    btnOpen.addEventListener('click', open);
    if (btnCancel) btnCancel.addEventListener('click', close);
    if (btnOk) btnOk.addEventListener('click', doImport);

    if (btnChoose && fileInput) {
        btnChoose.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) loadSource(e.target.files[0]);
        });
    }

    if (listEl) {
        listEl.addEventListener('click', (e) => {
            const diskRow = e.target.closest('.impf-row[data-disk]');
            if (diskRow) {
                openPendingDisk(parseInt(diskRow.dataset.disk));
                return;
            }
            if (e.target.closest('.impf-row[data-back]')) {
                setStatus('Archive contains several disk images — choose one to open');
                if (srcName) srcName.textContent = `${sourceName} — ${pendingDisks.length} disk images`;
                renderDiskChooser();
                renderPreview();
                return;
            }
            const chk = e.target.closest('input[data-chk]');
            if (chk) {
                entries[parseInt(chk.dataset.chk)].include = chk.checked;
                updateOkButton();
                renderPreview();
                return;
            }
            if (e.target.closest('select')) return;
            const row = e.target.closest('.impf-row');
            if (row) {
                selectedRow = parseInt(row.dataset.i);
                renderList();
                renderPreview();
            }
        });
        listEl.addEventListener('change', (e) => {
            const sel = e.target.closest('select[data-fmt]');
            if (sel) {
                const entry = entries[parseInt(sel.dataset.fmt)];
                entry.format = sel.value;
                entry.vfsName = makeVfsName(entry.name, entry.typeChar, entry.format);
                selectedRow = parseInt(sel.dataset.fmt);
                renderList();
                renderPreview();
            }
        });
    }

    // Drag & drop onto the dialog; stop propagation so the global handlers
    // do not load the dropped .trd as an emulator disk
    dialog.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    dialog.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files.length > 0) loadSource(e.dataTransfer.files[0]);
    });

    dialog.addEventListener('mousedown', (e) => {
        if (e.target === dialog) close();
    });
    dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });

    // loadFile lets callers (and tests) hand a File to the importer directly
    return { open, loadFile: loadSource };
}
