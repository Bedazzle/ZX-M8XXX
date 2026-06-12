// goto-palette.js — Ctrl+G quick navigation: fuzzy label search + hex addresses
// Opens a centered overlay; Enter navigates the disasm view via navigateToAddress.

import { hex16, escapeHtml, storageGet, storageSet } from '../core/utils.js';

export function initGotoPalette({ labelManager, navigateToAddress, openDebuggerPanel, getAsmSymbols, gotoAsmLine, gotoAsmLineSplit }) {
    const overlay = document.getElementById('gotoPalette');
    const input = document.getElementById('gotoPaletteInput');
    const list = document.getElementById('gotoPaletteList');
    const romChk = document.getElementById('gotoPaletteRom');
    if (!overlay || !input || !list) return;

    // ROM labels are noise for most projects — excluded by default, persisted
    if (romChk) {
        romChk.checked = storageGet('zxm8_gotoIncludeRom') === 'true';
        romChk.addEventListener('change', () => {
            storageSet('zxm8_gotoIncludeRom', romChk.checked);
            update();
            input.focus();
        });
    }

    let results = [];
    let selected = 0;
    let asmMode = false;  // ASM tab active: search source labels, jump the editor

    function close() {
        overlay.classList.add('hidden');
    }

    function open() {
        const asmTab = document.getElementById('tab-assembler');
        asmMode = !!(getAsmSymbols && asmTab && asmTab.classList.contains('active'));
        input.placeholder = asmMode ? 'Source label… (Shift+Enter → other pane)' : 'Label or hex address… (Ctrl+G)';
        if (romChk) romChk.parentElement.style.display = asmMode ? 'none' : '';
        overlay.classList.remove('hidden');
        input.value = '';
        update();
        input.focus();
    }

    function collectLabels() {
        const out = labelManager.getAll().map(l => ({ name: l.name, address: l.address, src: l.source || 'user' }));
        if (romChk && romChk.checked) {
            for (const l of labelManager.romLabels.values()) {
                out.push({ name: l.name, address: l.address, src: 'rom' });
            }
        }
        return out;
    }

    function update() {
        const q = input.value.trim();
        results = [];
        if (!asmMode) {
            // Hex address forms: 8000, $8000, #8000, 0x8000
            const m = q.match(/^[$#]?(?:0x)?([0-9a-fA-F]{1,4})$/);
            if (m) {
                results.push({ name: '(address)', address: parseInt(m[1], 16), src: 'addr' });
            }
        }
        const labels = asmMode ? getAsmSymbols() : collectLabels();
        if (q.length > 0) {
            const ql = q.toLowerCase();
            const starts = [], contains = [];
            for (const l of labels) {
                const n = (l.name || '').toLowerCase();
                if (!n) continue;
                if (n.startsWith(ql)) starts.push(l);
                else if (n.includes(ql)) contains.push(l);
            }
            results = results.concat(starts, contains);
        } else {
            results = results.concat(labels);
        }
        results = results.slice(0, 40);
        selected = 0;
        render();
    }

    function render() {
        list.innerHTML = results.length
            ? results.map((r, i) =>
                `<div class="goto-item${i === selected ? ' selected' : ''}" data-i="${i}">` +
                (asmMode
                    ? `<span class="goto-addr">${r.line}</span>` +
                      `<span class="goto-name">${escapeHtml(r.name)}</span>` +
                      `<span class="goto-src">${escapeHtml(r.path.split('/').pop())}</span>`
                    : `<span class="goto-addr">${hex16(r.address)}</span>` +
                      `<span class="goto-name">${escapeHtml(r.name)}</span>` +
                      `<span class="goto-src">${r.src}</span>`) +
                '</div>').join('')
            : '<div class="goto-empty">No matches</div>';
        const sel = list.querySelector('.goto-item.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
    }

    function pick(i, toSplit = false) {
        const r = results[i];
        if (!r) return;
        close();
        if (asmMode) {
            if (toSplit && gotoAsmLineSplit) gotoAsmLineSplit(r.path, r.line);
            else gotoAsmLine(r.path, r.line);
        } else {
            openDebuggerPanel();
            navigateToAddress(r.address & 0xffff);
        }
    }

    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (selected < results.length - 1) { selected++; render(); }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (selected > 0) { selected--; render(); }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(selected, e.shiftKey);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
        e.stopPropagation();  // keep palette keys away from global shortcuts
    });

    list.addEventListener('click', (e) => {
        const item = e.target.closest('.goto-item');
        if (item) pick(parseInt(item.dataset.i));
    });

    // Click on the dimmed backdrop closes
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) close();
    });

    // Wheel anywhere on the overlay outside the result list must not scroll
    // the page/editor behind it (the list itself scrolls, contained by CSS)
    overlay.addEventListener('wheel', (e) => {
        if (!list.contains(e.target)) e.preventDefault();
    }, { passive: false });

    // Ctrl+G opens from anywhere (browser find-next is suppressed)
    // e.code is the physical key - works with non-English keyboard layouts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyG') {
            e.preventDefault();
            if (overlay.classList.contains('hidden')) open();
            else close();
        }
    });

    return { open };
}
