// poke-manager.js — POKE Manager (extracted from index.html)
import { hex8, hex16 } from '../core/utils.js';

export function initPokeManager({ readMemory, writePoke, showMessage, goToAddress, setFrozenAddresses }) {
    // DOM lookups
    const pokeList = document.getElementById('pokeList');
    const pokeEditors = document.getElementById('pokeEditors');
    const pokeGameLabel = document.getElementById('pokeGameLabel');
    const pokeToggleAll = document.getElementById('pokeToggleAll');
    const btnPokeLoad = document.getElementById('btnPokeLoad');
    const btnPokeClear = document.getElementById('btnPokeClear');
    const btnPokeSave = document.getElementById('btnPokeSave');
    const btnPokeAdd = document.getElementById('btnPokeAdd');
    const btnEditorAdd = document.getElementById('btnEditorAdd');
    const btnEditorReadAll = document.getElementById('btnEditorReadAll');
    const pokeAddName = document.getElementById('pokeAddName');
    const pokeAddAddr = document.getElementById('pokeAddAddr');
    const pokeAddNormal = document.getElementById('pokeAddNormal');
    const pokeAddPoke = document.getElementById('pokeAddPoke');
    const pokeAddHint = document.getElementById('pokeAddHint');
    const editorAddName = document.getElementById('editorAddName');
    const editorAddAddr = document.getElementById('editorAddAddr');
    const editorAddType = document.getElementById('editorAddType');

    // State
    let pokeEntries = [];       // Array of { name, enabled, patches: [{addr, normal, poke}] }
    let pokeEditorEntries = []; // Array of { name, addr, type }
    let pokeGameName = '';

    function parsePokeValue(v) {
        if (typeof v === 'number') return v & 0xffff;
        const s = String(v).trim();
        if (s.startsWith('$')) return parseInt(s.slice(1), 16) & 0xffff;
        if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s.slice(2), 16) & 0xffff;
        return parseInt(s, 16) & 0xffff;
    }

    function pokeToggle(index, enable) {
        const entry = pokeEntries[index];
        if (!entry || !readMemory) return;
        entry.enabled = enable;
        for (const p of entry.patches) {
            writePoke(p.addr, enable ? p.poke : p.normal);
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
        updateFrozenList();
    }

    function loadPokeJSON(text) {
        const json = JSON.parse(text);
        pokeDisableAll();
        pokeEntries = [];
        pokeEditorEntries = [];
        pokeGameName = json.game || '';

        if (json.pokes) {
            for (const p of json.pokes) {
                const patches = (p.patches || []).map(pt => {
                    if (Array.isArray(pt)) {
                        const patch = { addr: parsePokeValue(pt[0]), normal: parsePokeValue(pt[1]) & 0xff, poke: parsePokeValue(pt[2]) & 0xff };
                        if (pt[3]) patch.hint = String(pt[3]);
                        return patch;
                    }
                    const patch = { addr: parsePokeValue(pt.addr), normal: parsePokeValue(pt.normal) & 0xff, poke: parsePokeValue(pt.poke) & 0xff };
                    if (pt.hint) patch.hint = String(pt.hint);
                    return patch;
                });
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
                    type: e.type === 'word' ? 'word' : 'byte',
                    freeze: !!e.freeze
                });
            }
        }

        renderPokeManager();
    }

    function pokeReadEditorValue(ed, input) {
        if (!readMemory) return;
        if (ed.type === 'word') {
            const lo = readMemory(ed.addr);
            const hi = readMemory((ed.addr + 1) & 0xffff);
            input.value = hex16((hi << 8) | lo);
        } else {
            input.value = hex8(readMemory(ed.addr));
        }
    }

    function pokeReadAllEditors() {
        pokeEditorEntries.forEach((ed, i) => {
            const input = document.getElementById('pokeEditor_' + i);
            if (input) pokeReadEditorValue(ed, input);
        });
    }

    function pokeUpdateToggleAll() {
        const cb = pokeToggleAll;
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

    function updateFrozenList() {
        if (!setFrozenAddresses) return;
        const list = [];
        for (const ed of pokeEditorEntries) {
            if (ed.freeze && readMemory) {
                if (ed.type === 'word') {
                    list.push({ addr: ed.addr, value: readMemory(ed.addr) });
                    list.push({ addr: (ed.addr + 1) & 0xffff, value: readMemory((ed.addr + 1) & 0xffff) });
                } else {
                    list.push({ addr: ed.addr, value: readMemory(ed.addr) });
                }
            }
        }
        setFrozenAddresses(list);
    }

    function renderPokeManager() {
        pokeGameLabel.textContent = pokeGameName;

        if (pokeEntries.length === 0) {
            pokeList.innerHTML = '<div class="no-breakpoints">No pokes loaded</div>';
        } else {
            pokeList.innerHTML = '';
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
                nameSpan.style.cursor = 'pointer';

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
                pokeList.appendChild(div);

                // Patch details (expand/collapse)
                const patchesDiv = document.createElement('div');
                patchesDiv.className = 'poke-patches hidden';
                for (const p of entry.patches) {
                    const patchLine = document.createElement('div');
                    patchLine.className = 'poke-patch';
                    const addrLink = document.createElement('span');
                    addrLink.className = 'poke-patch-addr';
                    addrLink.textContent = `$${hex16(p.addr)}`;
                    addrLink.title = 'Go to address in disassembly';
                    addrLink.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (goToAddress) goToAddress(p.addr);
                    });
                    patchLine.appendChild(addrLink);
                    const valText = `: $${hex8(p.normal)} \u2192 $${hex8(p.poke)}`;
                    patchLine.appendChild(document.createTextNode(valText));
                    if (p.hint) {
                        const hintSpan = document.createElement('span');
                        hintSpan.className = 'poke-patch-hint';
                        hintSpan.textContent = ` ; ${p.hint}`;
                        patchLine.appendChild(hintSpan);
                    }
                    // Double-click patch line to edit
                    patchLine.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        patchLine.innerHTML = '';
                        patchLine.className = 'poke-patch poke-patch-edit';
                        const mkInput = (val, w, ph) => {
                            const inp = document.createElement('input');
                            inp.type = 'text'; inp.value = val;
                            inp.style.width = w; inp.placeholder = ph;
                            inp.className = 'poke-patch-input';
                            return inp;
                        };
                        const inAddr = mkInput(hex16(p.addr), '38px', 'Addr');
                        const inOrig = mkInput(hex8(p.normal), '22px', 'Orig');
                        const inPoke = mkInput(hex8(p.poke), '22px', 'Poke');
                        const inHint = mkInput(p.hint || '', '50px', 'Hint');
                        patchLine.appendChild(inAddr);
                        patchLine.appendChild(inOrig);
                        patchLine.appendChild(inPoke);
                        patchLine.appendChild(inHint);
                        inAddr.select();

                        const finish = (save) => {
                            if (save) {
                                p.addr = parsePokeValue(inAddr.value);
                                p.normal = parsePokeValue(inOrig.value) & 0xff;
                                p.poke = parsePokeValue(inPoke.value) & 0xff;
                                const h = inHint.value.trim();
                                if (h) p.hint = h; else delete p.hint;
                            }
                            renderPokeManager();
                        };
                        const onKey = (ke) => {
                            if (ke.key === 'Enter') { ke.preventDefault(); finish(true); }
                            else if (ke.key === 'Escape') { ke.preventDefault(); finish(false); }
                        };
                        [inAddr, inOrig, inPoke, inHint].forEach(inp => {
                            inp.addEventListener('keydown', onKey);
                        });
                        // Save on blur, but only if we haven't already re-rendered
                        let done = false;
                        const onBlur = () => {
                            setTimeout(() => {
                                if (done) return;
                                if (!patchLine.contains(document.activeElement)) {
                                    done = true;
                                    finish(true);
                                }
                            }, 0);
                        };
                        [inAddr, inOrig, inPoke, inHint].forEach(inp => {
                            inp.addEventListener('blur', onBlur);
                        });
                    });
                    patchesDiv.appendChild(patchLine);
                }
                pokeList.appendChild(patchesDiv);

                // Click name to expand/collapse patches
                nameSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    patchesDiv.classList.toggle('hidden');
                });

                // Double-click name to rename
                nameSpan.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.className = 'poke-rename-input';
                    input.value = entry.name;
                    nameSpan.textContent = '';
                    nameSpan.appendChild(input);
                    input.select();

                    const finish = (save) => {
                        if (save) {
                            const newName = input.value.trim();
                            if (newName) entry.name = newName;
                        }
                        renderPokeManager();
                    };

                    input.addEventListener('keydown', (ke) => {
                        if (ke.key === 'Enter') { ke.preventDefault(); finish(true); }
                        else if (ke.key === 'Escape') { ke.preventDefault(); finish(false); }
                    });
                    input.addEventListener('blur', () => finish(true));
                    input.focus();
                });
            });
        }

        if (pokeEditorEntries.length === 0) {
            pokeEditors.innerHTML = '';
            pokeEditors.style.display = 'none';
        } else {
            pokeEditors.style.display = '';
            pokeEditors.innerHTML = '';
            pokeEditorEntries.forEach((ed, i) => {
                const div = document.createElement('div');
                div.className = 'poke-editor-entry';

                const nameSpan = document.createElement('span');
                nameSpan.className = 'poke-name';
                nameSpan.textContent = ed.name;

                const addrSpan = document.createElement('span');
                addrSpan.className = 'poke-editor-addr';
                addrSpan.textContent = hex16(ed.addr);
                addrSpan.title = 'Go to address in disassembly';
                addrSpan.style.cursor = 'pointer';
                addrSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (goToAddress) goToAddress(ed.addr);
                });

                const input = document.createElement('input');
                input.type = 'text';
                input.maxLength = ed.type === 'word' ? 4 : 2;
                input.style.width = ed.type === 'word' ? '50px' : '30px';
                input.title = ed.type === 'word' ? 'Word value (little-endian)' : 'Byte value';
                input.id = 'pokeEditor_' + i;

                const writeEditorValue = () => {
                    if (!readMemory) return;
                    const val = parsePokeValue(input.value);
                    if (ed.type === 'word') {
                        writePoke(ed.addr, val & 0xff);
                        writePoke((ed.addr + 1) & 0xffff, (val >> 8) & 0xff);
                    } else {
                        writePoke(ed.addr, val & 0xff);
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
                    if (!readMemory) return;
                    const cur = parsePokeValue(input.value) & max;
                    const nv = cur >= max ? 0 : cur + 1;
                    input.value = digits === 4 ? hex16(nv) : hex8(nv);
                    writeEditorValue();
                });
                const spinDown = document.createElement('button');
                spinDown.textContent = '\u25BC';
                spinDown.title = 'Decrement';
                spinDown.addEventListener('click', () => {
                    if (!readMemory) return;
                    const cur = parsePokeValue(input.value) & max;
                    const nv = cur <= 0 ? max : cur - 1;
                    input.value = digits === 4 ? hex16(nv) : hex8(nv);
                    writeEditorValue();
                });
                spinDiv.appendChild(spinUp);
                spinDiv.appendChild(spinDown);

                const freezeCb = document.createElement('input');
                freezeCb.type = 'checkbox';
                freezeCb.checked = !!ed.freeze;
                freezeCb.className = 'poke-freeze-cb';
                freezeCb.title = 'Freeze: lock current value so the game cannot change it';
                freezeCb.addEventListener('change', () => {
                    ed.freeze = freezeCb.checked;
                    updateFrozenList();
                });

                const removeBtn = document.createElement('button');
                removeBtn.className = 'poke-remove';
                removeBtn.textContent = '\u00d7';
                removeBtn.title = 'Remove editor';
                removeBtn.addEventListener('click', () => {
                    pokeEditorEntries.splice(i, 1);
                    renderPokeManager();
                    updateFrozenList();
                });

                div.appendChild(removeBtn);
                div.appendChild(freezeCb);
                div.appendChild(nameSpan);
                div.appendChild(addrSpan);
                div.appendChild(input);
                div.appendChild(spinDiv);
                pokeEditors.appendChild(div);

                pokeReadEditorValue(ed, input);
            });
        }

        pokeUpdateToggleAll();
    }

    // ========== Event bindings ==========

    btnPokeLoad.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onerror = () => showMessage('Failed to read file: ' + file.name, 'error');
            reader.onload = () => {
                try {
                    loadPokeJSON(reader.result);
                    showMessage('Pokes loaded: ' + file.name);
                } catch (e) {
                    showMessage('Error loading pokes: ' + e.message, 'error');
                }
            };
            reader.readAsText(file);
        }, { once: true });
        input.click();
    });

    btnPokeClear.addEventListener('click', pokeClearAll);

    pokeToggleAll.addEventListener('change', (e) => {
        const enable = e.target.checked;
        for (let i = 0; i < pokeEntries.length; i++) {
            pokeToggle(i, enable);
        }
        renderPokeManager();
    });

    btnEditorReadAll.addEventListener('click', pokeReadAllEditors);

    btnPokeAdd.addEventListener('click', () => {
        const name = pokeAddName.value.trim();
        const addr = pokeAddAddr.value.trim();
        const normal = pokeAddNormal.value.trim();
        const poke = pokeAddPoke.value.trim();
        const hint = pokeAddHint ? pokeAddHint.value.trim() : '';
        if (!name || !addr || !normal || !poke) return;

        const patch = {
            addr: parsePokeValue(addr),
            normal: parsePokeValue(normal) & 0xff,
            poke: parsePokeValue(poke) & 0xff
        };
        if (hint) patch.hint = hint;

        const existing = pokeEntries.find(e => e.name === name);
        if (existing) {
            existing.patches.push(patch);
            if (existing.enabled) writePoke(patch.addr, patch.poke);
        } else {
            pokeEntries.push({ name, enabled: false, patches: [patch] });
        }

        pokeAddAddr.value = '';
        pokeAddNormal.value = '';
        pokeAddPoke.value = '';
        if (pokeAddHint) pokeAddHint.value = '';
        renderPokeManager();
    });

    btnEditorAdd.addEventListener('click', () => {
        const name = editorAddName.value.trim();
        const addr = editorAddAddr.value.trim();
        const type = editorAddType.value;
        if (!name || !addr) return;

        pokeEditorEntries.push({
            name,
            addr: parsePokeValue(addr),
            type
        });

        editorAddName.value = '';
        editorAddAddr.value = '';
        renderPokeManager();
    });

    btnPokeSave.addEventListener('click', () => {
        if (pokeEntries.length === 0 && pokeEditorEntries.length === 0) return;

        const data = { game: pokeGameName };
        if (pokeEntries.length > 0) {
            data.pokes = pokeEntries.map(e => ({
                name: e.name,
                enabled: e.enabled,
                patches: e.patches.map(p => {
                    const arr = [hex16(p.addr), hex8(p.normal), hex8(p.poke)];
                    if (p.hint) arr.push(p.hint);
                    return arr;
                })
            }));
        }
        if (pokeEditorEntries.length > 0) {
            data.editors = pokeEditorEntries.map(e => {
                const obj = { name: e.name, addr: hex16(e.addr), type: e.type };
                if (e.freeze) obj.freeze = true;
                return obj;
            });
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

    pokeGameLabel.addEventListener('click', () => {
        const name = prompt('Game name:', pokeGameName);
        if (name !== null) {
            pokeGameName = name.trim();
            pokeGameLabel.textContent = pokeGameName;
        }
    });

    // Initial render
    renderPokeManager();

    // Public API
    return {
        loadPokeJSON,
        pokeClearAll,
        addPoke(name, addrOrPatches, normal, poke, hint) {
            let patches;
            if (Array.isArray(addrOrPatches)) {
                patches = addrOrPatches.map(p => ({
                    addr: p.addr, normal: p.normal & 0xff, poke: p.poke & 0xff,
                    ...(p.hint ? { hint: p.hint } : {})
                }));
            } else {
                const patch = { addr: addrOrPatches, normal: normal & 0xff, poke: poke & 0xff };
                if (hint) patch.hint = hint;
                patches = [patch];
            }
            pokeEntries.push({ name, enabled: false, patches });
            renderPokeManager();
        },
        getPokeData() {
            return {
                game: pokeGameName,
                pokes: pokeEntries.map(e => ({
                    name: e.name,
                    enabled: e.enabled,
                    patches: e.patches.map(p => {
                        const arr = [hex16(p.addr), hex8(p.normal), hex8(p.poke)];
                        if (p.hint) arr.push(p.hint);
                        return arr;
                    })
                })),
                editors: pokeEditorEntries.map(e => {
                    const obj = { name: e.name, addr: hex16(e.addr), type: e.type };
                    if (e.freeze) obj.freeze = true;
                    return obj;
                })
            };
        },
        addFreezeEditor(addr, name) {
            const existing = pokeEditorEntries.find(e => e.addr === addr && e.freeze);
            if (existing) return;
            pokeEditorEntries.push({
                name: name || hex16(addr),
                addr,
                type: 'byte',
                freeze: true
            });
            renderPokeManager();
            updateFrozenList();
        },
        hasData() {
            return pokeEntries.length > 0 || pokeEditorEntries.length > 0;
        }
    };
}
