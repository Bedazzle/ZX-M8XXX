// POKE Manager & Search — snap-based memory value search, poke entries, memory editors.
// Extracted from monolith index.html v0.9.37.
//
// Listeners registered by this module:
// - btnPokeSnap.click → take memory snapshot
// - btnPokeSearch.click → search candidates across snapshots
// - btnPokeFilter.click → filter candidates by hex value
// - btnPokeReset.click → reset all search state
// - btnPokeTrace.click → toggle memory write tracing
// - btnPokeTraceClear.click → clear blacklist
// - pokeResults.click → navigate to address (delegated)
// - btnPokeLoad.click → load pokes from JSON file
// - btnPokeSave.click → save pokes to JSON file
// - btnPokeClear.click → clear all pokes and editors
// - pokeToggleAll.change → master toggle all pokes
// - btnEditorReadAll.click → read all editor values from memory
// - btnPokeAdd.click → add poke entry
// - btnEditorAdd.click → add editor entry
// - pokeGameLabel.click → edit game name
//
// External dependencies (injected via initPokeManager):
//   spectrum — emulator instance (.memory, .poke, .startPokeWriteTrace, .stopPokeWriteTrace)
//   showMessage — UI toast/status function
//   hex8, hex16 — format helpers
//   goToMemoryAddress — debugger navigation

// ========== State ==========

let spectrum = null;
let showMessage = null;
let hex8 = null;
let hex16 = null;
let goToMemoryAddress = null;

let pokeSnapshot = null;
let pokeSnapshots = [];
let pokeCandidates = null;
let pokeSnapCount = 0;
let pokeValueHistory = new Map();
let pokePreFilterCandidates = null;
let pokePreFilterHistory = null;
let pokeBlacklist = null;
let pokeWriteTracing = false;

// POKE manager state
let pokeEntries = [];
let pokeEditorEntries = [];
let pokeGameName = '';

// ========== Helpers ==========

function parsePokeValue(v) {
    if (typeof v === 'number') return v & 0xffff;
    const s = String(v).trim();
    if (s.startsWith('$')) return parseInt(s.slice(1), 16) & 0xffff;
    if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s.slice(2), 16) & 0xffff;
    return parseInt(s, 10) & 0xffff;
}

function pokeToggle(index, enable) {
    const entry = pokeEntries[index];
    if (!entry || !spectrum.memory) return;
    entry.enabled = enable;
    for (const p of entry.patches) {
        spectrum.poke(p.addr, enable ? p.poke : p.normal);
    }
}

function pokeDisableAll() {
    for (let i = 0; i < pokeEntries.length; i++) {
        if (pokeEntries[i].enabled) pokeToggle(i, false);
    }
}

function pokeClearAll() {
    pokeDisableAll();
    pokeEntries = [];
    pokeEditorEntries = [];
    pokeGameName = '';
    renderPokeManager();
}

function loadPokeJSON(text) {
    const json = JSON.parse(text);
    pokeDisableAll();
    pokeEntries = [];
    pokeEditorEntries = [];
    pokeGameName = json.game || '';

    if (json.pokes) {
        for (const p of json.pokes) {
            const patches = (p.patches || []).map(pt => ({
                addr: parsePokeValue(pt[0]), normal: parsePokeValue(pt[1]) & 0xff, poke: parsePokeValue(pt[2]) & 0xff
            }));
            pokeEntries.push({ name: p.name || 'Unnamed', enabled: false, patches });
            if (p.enabled) {
                pokeToggle(pokeEntries.length - 1, true);
            }
        }
    }

    if (json.editors) {
        for (const e of json.editors) {
            pokeEditorEntries.push({
                name: e.name || 'Value',
                addr: parsePokeValue(e.addr),
                type: e.type === 'word' ? 'word' : 'byte'
            });
        }
    }

    renderPokeManager();
}

function pokeReadEditorValue(ed, input) {
    if (!spectrum.memory) return;
    if (ed.type === 'word') {
        const lo = spectrum.memory.read(ed.addr);
        const hi = spectrum.memory.read((ed.addr + 1) & 0xffff);
        input.value = '$' + ((hi << 8) | lo).toString(16).toUpperCase().padStart(4, '0');
    } else {
        input.value = '$' + spectrum.memory.read(ed.addr).toString(16).toUpperCase().padStart(2, '0');
    }
}

function pokeReadAllEditors() {
    pokeEditorEntries.forEach((ed, i) => {
        const input = document.getElementById('pokeEditor_' + i);
        if (input) pokeReadEditorValue(ed, input);
    });
}

function pokeUpdateToggleAll() {
    const cb = document.getElementById('pokeToggleAll');
    if (!cb) return;
    if (pokeEntries.length === 0) {
        cb.checked = false;
        cb.indeterminate = false;
    } else {
        const enabledCount = pokeEntries.filter(e => e.enabled).length;
        cb.checked = enabledCount === pokeEntries.length;
        cb.indeterminate = enabledCount > 0 && enabledCount < pokeEntries.length;
    }
}

// ========== Render ==========

function renderPokeManager() {
    const listEl = document.getElementById('pokeList');
    const editorsEl = document.getElementById('pokeEditors');
    const labelEl = document.getElementById('pokeGameLabel');

    labelEl.textContent = pokeGameName;

    if (pokeEntries.length === 0) {
        listEl.innerHTML = '<div class="no-breakpoints">No pokes loaded</div>';
    } else {
        listEl.innerHTML = '';
        pokeEntries.forEach((entry, i) => {
            const div = document.createElement('div');
            div.className = 'poke-entry';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = entry.enabled;
            cb.title = entry.enabled ? 'Disable poke' : 'Enable poke';
            cb.addEventListener('change', () => {
                pokeToggle(i, cb.checked);
                pokeUpdateToggleAll();
            });

            const nameSpan = document.createElement('span');
            nameSpan.className = 'poke-name';
            nameSpan.textContent = entry.name;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'poke-remove';
            removeBtn.textContent = '\u00d7';
            removeBtn.title = 'Remove poke';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (entry.enabled) pokeToggle(i, false);
                pokeEntries.splice(i, 1);
                renderPokeManager();
            });

            div.appendChild(cb);
            div.appendChild(nameSpan);
            div.appendChild(removeBtn);
            listEl.appendChild(div);
        });
    }

    if (pokeEditorEntries.length === 0) {
        editorsEl.innerHTML = '';
        editorsEl.style.display = 'none';
    } else {
        editorsEl.style.display = '';
        editorsEl.innerHTML = '';
        pokeEditorEntries.forEach((ed, i) => {
            const div = document.createElement('div');
            div.className = 'poke-editor-entry';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'poke-name';
            nameSpan.textContent = ed.name;

            const addrSpan = document.createElement('span');
            addrSpan.className = 'poke-editor-addr';
            addrSpan.textContent = '$' + ed.addr.toString(16).toUpperCase().padStart(4, '0');

            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = ed.type === 'word' ? 4 : 2;
            input.style.width = ed.type === 'word' ? '50px' : '30px';
            input.title = ed.type === 'word' ? 'Word value (little-endian)' : 'Byte value';
            input.id = 'pokeEditor_' + i;

            const writeEditorValue = () => {
                if (!spectrum.memory) return;
                const val = parsePokeValue(input.value);
                if (ed.type === 'word') {
                    spectrum.poke(ed.addr, val & 0xff);
                    spectrum.poke((ed.addr + 1) & 0xffff, (val >> 8) & 0xff);
                } else {
                    spectrum.poke(ed.addr, val & 0xff);
                }
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { writeEditorValue(); input.blur(); }
            });
            input.addEventListener('blur', writeEditorValue);

            const max = ed.type === 'word' ? 0xffff : 0xff;
            const digits = ed.type === 'word' ? 4 : 2;
            const spinDiv = document.createElement('span');
            spinDiv.className = 'poke-editor-spin';
            const spinUp = document.createElement('button');
            spinUp.textContent = '\u25B2';
            spinUp.title = 'Increment';
            spinUp.addEventListener('click', () => {
                if (!spectrum.memory) return;
                const cur = parsePokeValue(input.value) & max;
                const nv = cur >= max ? 0 : cur + 1;
                input.value = '$' + nv.toString(16).toUpperCase().padStart(digits, '0');
                writeEditorValue();
            });
            const spinDown = document.createElement('button');
            spinDown.textContent = '\u25BC';
            spinDown.title = 'Decrement';
            spinDown.addEventListener('click', () => {
                if (!spectrum.memory) return;
                const cur = parsePokeValue(input.value) & max;
                const nv = cur <= 0 ? max : cur - 1;
                input.value = '$' + nv.toString(16).toUpperCase().padStart(digits, '0');
                writeEditorValue();
            });
            spinDiv.appendChild(spinUp);
            spinDiv.appendChild(spinDown);

            const removeBtn = document.createElement('button');
            removeBtn.className = 'poke-remove';
            removeBtn.textContent = '\u00d7';
            removeBtn.title = 'Remove editor';
            removeBtn.addEventListener('click', () => {
                pokeEditorEntries.splice(i, 1);
                renderPokeManager();
            });

            div.appendChild(removeBtn);
            div.appendChild(nameSpan);
            div.appendChild(addrSpan);
            div.appendChild(input);
            div.appendChild(spinDiv);
            editorsEl.appendChild(div);

            pokeReadEditorValue(ed, input);
        });
    }

    pokeUpdateToggleAll();
}

// ========== Search UI ==========

function updatePokeStatus() {
    const pokeStatus = document.getElementById('pokeStatus');
    let text = pokeSnapCount > 0 ? `snaps: ${pokeSnapCount}` : '';
    if (pokeCandidates !== null) {
        text += (text ? ', ' : '') + `${pokeCandidates.size} candidates`;
    }
    if (pokeBlacklist) {
        text += (text ? ', ' : '') + `BL: ${pokeBlacklist.size}`;
    }
    pokeStatus.textContent = text ? `(${text})` : '';
}

function updatePokeResults() {
    const pokeResults = document.getElementById('pokeResults');
    if (pokeCandidates === null || pokeCandidates.size === 0) {
        pokeResults.innerHTML = '';
        return;
    }
    const lastSnap = pokeSnapshots.length > 0 ? pokeSnapshots[pokeSnapshots.length - 1] : null;
    const addrs = [...pokeCandidates].slice(0, 100);
    pokeResults.innerHTML = addrs.map(addr => {
        const val = lastSnap ? lastSnap[addr] : 0;
        const hist = pokeValueHistory.get(addr);
        const tip = hist ? hist.map(v => hex8(v)).join(' \u2192 ') : '';
        return `<span class="poke-result" data-addr="${addr}" title="${tip}"><span class="addr">${hex16(addr)}</span><span class="val">${hex8(val)}</span></span>`;
    }).join('');
    if (pokeCandidates.size > 100) {
        pokeResults.innerHTML += `<span class="poke-status">...and ${pokeCandidates.size - 100} more</span>`;
    }
}

// ========== Project integration ==========

function getPokeState() {
    if (pokeEntries.length === 0 && pokeEditorEntries.length === 0) return null;
    return {
        game: pokeGameName,
        pokes: pokeEntries.map(e => ({
            name: e.name,
            enabled: e.enabled,
            patches: e.patches.map(p => ({
                addr: '$' + p.addr.toString(16).toUpperCase().padStart(4, '0'),
                normal: '$' + p.normal.toString(16).toUpperCase().padStart(2, '0'),
                poke: '$' + p.poke.toString(16).toUpperCase().padStart(2, '0')
            }))
        })),
        editors: pokeEditorEntries.map(e => ({
            name: e.name,
            addr: '$' + e.addr.toString(16).toUpperCase().padStart(4, '0'),
            type: e.type
        }))
    };
}

function restorePokeState(pokesData) {
    if (pokesData) {
        try { loadPokeJSON(JSON.stringify(pokesData)); } catch (e) { /* ignore */ }
    }
}

function stopPokeWriteTracing() {
    if (pokeWriteTracing) {
        spectrum.stopPokeWriteTrace();
        pokeWriteTracing = false;
        const btnTrace = document.getElementById('btnPokeTrace');
        btnTrace.textContent = 'Trace';
        btnTrace.classList.remove('active');
    }
}

// ========== Init ==========

function initPokeManager(deps) {
    spectrum = deps.spectrum;
    showMessage = deps.showMessage;
    hex8 = deps.hex8;
    hex16 = deps.hex16;
    goToMemoryAddress = deps.goToMemoryAddress;

    const btnPokeSnap = document.getElementById('btnPokeSnap');
    const pokeSearchMode = document.getElementById('pokeSearchMode');
    const btnPokeSearch = document.getElementById('btnPokeSearch');
    const btnPokeReset = document.getElementById('btnPokeReset');
    const pokeResults = document.getElementById('pokeResults');

    // Snap
    btnPokeSnap.addEventListener('click', () => {
        if (!spectrum.memory) return;
        pokeSnapshot = new Uint8Array(0x10000);
        for (let addr = 0; addr < 0x10000; addr++) {
            pokeSnapshot[addr] = spectrum.memory.read(addr);
        }
        pokeSnapshots.push(pokeSnapshot);
        pokeSnapCount++;
        updatePokeStatus();
    });

    // Search
    btnPokeSearch.addEventListener('click', () => {
        if (!spectrum.memory || pokeSnapshots.length < 2) {
            showMessage('Need at least 2 snapshots', 'error');
            return;
        }

        const mode = pokeSearchMode.value;
        const skipScreen = document.getElementById('pokeSkipScreen').checked;
        const startAddr = skipScreen ? 0x5C00 : 0x4000;

        const newCandidates = new Set();
        const newHistory = new Map();

        for (let addr = startAddr; addr < 0x10000; addr++) {
            if (pokeBlacklist && pokeBlacklist.has(addr)) continue;
            const values = [];
            for (let s = 0; s < pokeSnapshots.length; s++) {
                values.push(pokeSnapshots[s][addr]);
            }

            if (values.length < 2) {
                if (mode === 'unchanged') {
                    newCandidates.add(addr);
                    newHistory.set(addr, values);
                }
                continue;
            }

            let match = true;
            for (let i = 1; i < values.length; i++) {
                const pv = values[i - 1], cv = values[i];
                let ok = false;
                switch (mode) {
                    case 'dec1': ok = cv === ((pv - 1) & 0xff); break;
                    case 'inc1': ok = cv === ((pv + 1) & 0xff); break;
                    case 'decreased': ok = cv < pv; break;
                    case 'increased': ok = cv > pv; break;
                    case 'changed': ok = cv !== pv; break;
                    case 'unchanged': ok = cv === pv; break;
                }
                if (!ok) { match = false; break; }
            }

            if (match) {
                newCandidates.add(addr);
                newHistory.set(addr, values);
            }
        }

        pokeCandidates = newCandidates;
        pokeValueHistory = newHistory;
        pokePreFilterCandidates = null;
        pokePreFilterHistory = null;

        showMessage(`${pokeCandidates.size} candidate(s) found`);
        updatePokeStatus();
        updatePokeResults();
    });

    // Filter
    document.getElementById('btnPokeFilter').addEventListener('click', () => {
        const valStr = document.getElementById('pokeFilterValue').value.trim();

        if (!valStr) {
            if (pokePreFilterCandidates) {
                pokeCandidates = pokePreFilterCandidates;
                pokeValueHistory = pokePreFilterHistory;
                pokePreFilterCandidates = null;
                pokePreFilterHistory = null;
                showMessage(`Filter cleared, ${pokeCandidates.size} candidate(s)`);
                updatePokeStatus();
                updatePokeResults();
            }
            return;
        }

        if (!pokeCandidates || pokeCandidates.size === 0) {
            showMessage('No candidates to filter', 'error');
            return;
        }
        if (!/^[0-9A-Fa-f]{1,2}$/.test(valStr)) {
            showMessage('Enter hex value (00-FF)', 'error');
            return;
        }
        const targetValue = parseInt(valStr, 16);

        if (!pokePreFilterCandidates) {
            pokePreFilterCandidates = new Set(pokeCandidates);
            pokePreFilterHistory = new Map(pokeValueHistory);
        }

        const lastSnap = pokeSnapshots.length > 0 ? pokeSnapshots[pokeSnapshots.length - 1] : null;
        if (!lastSnap) {
            showMessage('No snapshots taken', 'error');
            return;
        }
        const source = pokePreFilterCandidates;
        const filtered = new Set();
        for (const addr of source) {
            if (lastSnap[addr] === targetValue) {
                filtered.add(addr);
            }
        }
        pokeCandidates = filtered;
        pokeValueHistory = new Map(pokePreFilterHistory);
        for (const addr of pokeValueHistory.keys()) {
            if (!filtered.has(addr)) pokeValueHistory.delete(addr);
        }
        showMessage(`${filtered.size} candidate(s) after filter`);
        updatePokeStatus();
        updatePokeResults();
    });

    // Reset
    btnPokeReset.addEventListener('click', () => {
        pokeSnapshot = null;
        pokeSnapshots = [];
        pokeCandidates = null;
        pokeValueHistory = new Map();
        pokePreFilterCandidates = null;
        pokePreFilterHistory = null;
        pokeSnapCount = 0;
        pokeResults.innerHTML = '';
        document.getElementById('pokeFilterValue').value = '';
        updatePokeStatus();
    });

    // Trace
    document.getElementById('btnPokeTrace').addEventListener('click', () => {
        const btn = document.getElementById('btnPokeTrace');
        if (!pokeWriteTracing) {
            spectrum.startPokeWriteTrace();
            pokeWriteTracing = true;
            btn.textContent = 'Stop Trace';
            btn.classList.add('active');
        } else {
            const addrs = spectrum.stopPokeWriteTrace();
            pokeWriteTracing = false;
            btn.textContent = 'Trace';
            btn.classList.remove('active');
            if (addrs && addrs.size > 0) {
                if (pokeBlacklist) {
                    for (const a of addrs) pokeBlacklist.add(a);
                } else {
                    pokeBlacklist = new Set(addrs);
                }
            }
            showMessage(`Blacklisted ${pokeBlacklist ? pokeBlacklist.size : 0} addresses`);
            document.getElementById('btnPokeTraceClear').classList.toggle('hidden', !pokeBlacklist);
            updatePokeStatus();
        }
    });

    document.getElementById('btnPokeTraceClear').addEventListener('click', () => {
        pokeBlacklist = null;
        document.getElementById('btnPokeTraceClear').classList.add('hidden');
        updatePokeStatus();
        showMessage('Blacklist cleared');
    });

    // Result click → navigate
    pokeResults.addEventListener('click', (e) => {
        const resultEl = e.target.closest('.poke-result');
        if (resultEl) {
            const addr = parseInt(resultEl.dataset.addr);
            goToMemoryAddress(addr);
        }
    });

    // ========== POKE Manager listeners ==========

    document.getElementById('btnPokeLoad').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    loadPokeJSON(reader.result);
                    showMessage('Pokes loaded: ' + file.name);
                } catch (e) {
                    showMessage('Error loading pokes: ' + e.message, 'error');
                }
            };
            reader.readAsText(file);
        });
        input.click();
    });

    document.getElementById('btnPokeClear').addEventListener('click', pokeClearAll);

    document.getElementById('pokeToggleAll').addEventListener('change', (e) => {
        const enable = e.target.checked;
        for (let i = 0; i < pokeEntries.length; i++) {
            pokeToggle(i, enable);
        }
        renderPokeManager();
    });

    document.getElementById('btnEditorReadAll').addEventListener('click', pokeReadAllEditors);

    document.getElementById('btnPokeAdd').addEventListener('click', () => {
        const name = document.getElementById('pokeAddName').value.trim();
        const addr = document.getElementById('pokeAddAddr').value.trim();
        const normal = document.getElementById('pokeAddNormal').value.trim();
        const poke = document.getElementById('pokeAddPoke').value.trim();
        if (!name || !addr || !normal || !poke) return;

        const patch = {
            addr: parsePokeValue(addr),
            normal: parsePokeValue(normal) & 0xff,
            poke: parsePokeValue(poke) & 0xff
        };

        const existing = pokeEntries.find(e => e.name === name);
        if (existing) {
            existing.patches.push(patch);
            if (existing.enabled) spectrum.poke(patch.addr, patch.poke);
        } else {
            pokeEntries.push({ name, enabled: false, patches: [patch] });
        }

        document.getElementById('pokeAddAddr').value = '';
        document.getElementById('pokeAddNormal').value = '';
        document.getElementById('pokeAddPoke').value = '';
        renderPokeManager();
    });

    document.getElementById('btnEditorAdd').addEventListener('click', () => {
        const name = document.getElementById('editorAddName').value.trim();
        const addr = document.getElementById('editorAddAddr').value.trim();
        const type = document.getElementById('editorAddType').value;
        if (!name || !addr) return;

        pokeEditorEntries.push({
            name,
            addr: parsePokeValue(addr),
            type
        });

        document.getElementById('editorAddName').value = '';
        document.getElementById('editorAddAddr').value = '';
        renderPokeManager();
    });

    document.getElementById('btnPokeSave').addEventListener('click', () => {
        if (pokeEntries.length === 0 && pokeEditorEntries.length === 0) return;

        const data = { game: pokeGameName };
        if (pokeEntries.length > 0) {
            data.pokes = pokeEntries.map(e => ({
                name: e.name,
                enabled: e.enabled,
                patches: e.patches.map(p => [
                    '$' + p.addr.toString(16).toUpperCase().padStart(4, '0'),
                    '$' + p.normal.toString(16).toUpperCase().padStart(2, '0'),
                    '$' + p.poke.toString(16).toUpperCase().padStart(2, '0')
                ])
            }));
        }
        if (pokeEditorEntries.length > 0) {
            data.editors = pokeEditorEntries.map(e => ({
                name: e.name,
                addr: '$' + e.addr.toString(16).toUpperCase().padStart(4, '0'),
                type: e.type
            }));
        }

        const json = JSON.stringify(data, null, 4);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (pokeGameName || 'pokes').replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('pokeGameLabel').addEventListener('click', () => {
        const name = prompt('Game name:', pokeGameName);
        if (name !== null) {
            pokeGameName = name.trim();
            document.getElementById('pokeGameLabel').textContent = pokeGameName;
        }
    });
}

// ========== Exports ==========

export {
    initPokeManager,
    renderPokeManager,
    loadPokeJSON,
    pokeClearAll,
    pokeDisableAll,
    getPokeState,
    restorePokeState,
    stopPokeWriteTracing
};
