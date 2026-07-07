// asm-snippets.js — code snippets for the ASM editor.
//
// Built-in snippets are loaded once from data/asm-snippets.json at startup.
// User snippets live in localStorage (key zxm8_asmSnippets) as a [{name, code}]
// array; they can be added from the current editor selection, deleted one by
// one, cleared en masse, or exported to a JSON file. Clicking any snippet
// inserts its code at the caret of the last-focused editor pane.
//
// DI: insertAtCursor(text), getSelectedText(), showMessage(msg), downloadFile(name, data), escapeHtml(s)

const STORAGE_KEY = 'zxm8_asmSnippets';

export function initAsmSnippets({ insertAtCursor, getSelectedText, showMessage, downloadFile, escapeHtml }) {
    const btn = document.getElementById('btnAsmSnippets');
    const menu = document.getElementById('asmSnippetsMenu');
    const list = document.getElementById('asmSnippetsList');
    const dropdown = btn ? btn.closest('.asm-files-dropdown') : null;
    if (!btn || !menu || !list) return;

    let builtIn = [];

    function loadUser() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr.filter(s => s && typeof s.name === 'string' && typeof s.code === 'string') : [];
        } catch { return []; }
    }

    function saveUser(arr) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }
        catch { showMessage('Could not save snippets (storage full?)'); }
    }

    // Build one clickable snippet row; user rows also get a delete (×) button.
    function row(snippet, userIndex) {
        const preview = snippet.code.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (userIndex == null) {
            return `<button class="asm-menu-item asm-snippet-item" data-kind="builtin" data-name="${escapeHtml(snippet.name)}" title="${escapeHtml(preview)}">${escapeHtml(snippet.name)}</button>`;
        }
        return `<div class="asm-snippet-row">` +
            `<button class="asm-menu-item asm-snippet-item" data-kind="user" data-idx="${userIndex}" title="${escapeHtml(preview)}">${escapeHtml(snippet.name)}</button>` +
            `<button class="asm-snippet-del" data-del="${userIndex}" title="Delete this snippet">&times;</button>` +
            `</div>`;
    }

    function render() {
        const user = loadUser();
        let html = '<div class="asm-snippet-section">Built-in</div>';
        html += builtIn.length ? builtIn.map(s => row(s, null)).join('') : '<div class="asm-snippet-empty">(none)</div>';
        html += '<div class="asm-snippet-section">My snippets</div>';
        html += user.length ? user.map((s, i) => row(s, i)).join('') : '<div class="asm-snippet-empty">(none yet — select code and "Add selection as snippet")</div>';
        list.innerHTML = html;
    }

    function insert(snippet) {
        if (!snippet) return;
        insertAtCursor(snippet.code);
    }

    function addFromSelection() {
        const sel = getSelectedText();
        if (!sel || !sel.trim()) {
            showMessage('Select some code in the editor first');
            return;
        }
        const name = (window.prompt('Snippet name:', '') || '').trim();
        if (!name) return;
        const user = loadUser();
        const existing = user.findIndex(s => s.name === name);
        if (existing !== -1) {
            if (!window.confirm(`A snippet named "${name}" already exists. Replace it?`)) return;
            user[existing] = { name, code: sel };
        } else {
            user.push({ name, code: sel });
        }
        saveUser(user);
        render();
        showMessage(`Saved snippet "${name}"`);
    }

    function exportUser() {
        const user = loadUser();
        if (!user.length) { showMessage('No snippets to export'); return; }
        downloadFile('asm-snippets.json', JSON.stringify(user, null, 2));
    }

    // Merge a [{name, code}] JSON file into the user snippets. Imported entries
    // overwrite existing snippets with the same name; the rest are added.
    function importUser(text) {
        let arr;
        try { arr = JSON.parse(text); }
        catch { showMessage('Not a valid snippets JSON file'); return; }
        if (!Array.isArray(arr)) { showMessage('Expected a JSON array of snippets'); return; }
        const incoming = arr.filter(s => s && typeof s.name === 'string' && s.name.trim() && typeof s.code === 'string');
        if (!incoming.length) { showMessage('No valid snippets in that file'); return; }
        const user = loadUser();
        let added = 0, updated = 0;
        for (const s of incoming) {
            const entry = { name: s.name.trim(), code: s.code };
            const i = user.findIndex(u => u.name === entry.name);
            if (i !== -1) { user[i] = entry; updated++; } else { user.push(entry); added++; }
        }
        saveUser(user);
        render();
        showMessage(`Imported ${incoming.length} snippet${incoming.length !== 1 ? 's' : ''} (${added} new, ${updated} updated)`);
    }

    function clearUser() {
        const user = loadUser();
        if (!user.length) { showMessage('No snippets to clear'); return; }
        if (!window.confirm(`Delete all ${user.length} of your snippets? (Built-in snippets stay.)`)) return;
        saveUser([]);
        render();
        showMessage('Cleared your snippets');
    }

    // --- Wiring ---
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        render();
        menu.classList.toggle('show');
    });

    document.getElementById('btnSnippetAdd').addEventListener('click', () => { menu.classList.remove('show'); addFromSelection(); });
    document.getElementById('btnSnippetExport').addEventListener('click', () => { menu.classList.remove('show'); exportUser(); });
    document.getElementById('btnSnippetClear').addEventListener('click', () => { menu.classList.remove('show'); clearUser(); });

    const importFile = document.getElementById('snippetImportFile');
    document.getElementById('btnSnippetImport').addEventListener('click', () => { menu.classList.remove('show'); importFile.click(); });
    if (importFile) importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        importFile.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => importUser(reader.result);
        reader.readAsText(file);
    });

    // Insert on snippet click; delete on × click. Delegated so it survives re-render.
    list.addEventListener('click', (e) => {
        const del = e.target.closest('.asm-snippet-del');
        if (del) {
            e.stopPropagation();
            const user = loadUser();
            const i = parseInt(del.dataset.del, 10);
            if (i >= 0 && i < user.length) { user.splice(i, 1); saveUser(user); render(); }
            return;
        }
        const item = e.target.closest('.asm-snippet-item');
        if (!item) return;
        menu.classList.remove('show');
        if (item.dataset.kind === 'builtin') {
            insert(builtIn.find(s => s.name === item.dataset.name));
        } else {
            insert(loadUser()[parseInt(item.dataset.idx, 10)]);
        }
    });

    // Close when clicking outside this dropdown
    document.addEventListener('click', (e) => {
        if (dropdown && !dropdown.contains(e.target)) menu.classList.remove('show');
    });

    // Load built-in snippets (non-fatal if the file is missing)
    fetch('data/asm-snippets.json')
        .then(r => r.ok ? r.json() : [])
        .then(arr => { builtIn = Array.isArray(arr) ? arr : []; render(); })
        .catch(() => { builtIn = []; render(); });

    render();
}
