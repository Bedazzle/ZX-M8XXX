// Machine Selector — machine dropdown & settings checkboxes (init-function pattern, DI)
import { storageGet, storageSet } from '../core/utils.js';

export function initMachineSelector({ MACHINE_PROFILES, getMachineTypes, DEFAULT_VISIBLE_MACHINES, getLoadRomForMachineById, getGetRomFileName }) {
    const machineSelect = document.getElementById('machineSelect');

    function getVisibleMachines() {
        try {
            const stored = storageGet('zxm8_machines');
            if (stored) {
                const arr = JSON.parse(stored);
                // Ensure 48k is always included
                if (!arr.includes('48k')) arr.unshift('48k');
                return arr;
            }
        } catch (e) { console.warn('Failed to load visible machines:', e); }
        return DEFAULT_VISIBLE_MACHINES.slice();
    }

    function setVisibleMachines(arr) {
        storageSet('zxm8_machines', JSON.stringify(arr));
    }

    function populateMachineDropdown() {
        const visible = getVisibleMachines();
        visible.sort((a, b) => (MACHINE_PROFILES[a]?.name || a).localeCompare(MACHINE_PROFILES[b]?.name || b));
        const currentValue = machineSelect.value;
        machineSelect.innerHTML = '';
        for (const id of visible) {
            const p = MACHINE_PROFILES[id];
            if (p) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = p.name;
                machineSelect.appendChild(opt);
            }
        }
        // Restore selection if still visible, otherwise select first
        if (visible.includes(currentValue)) {
            machineSelect.value = currentValue;
        }
    }

    function buildMachineCheckboxes() {
        const container = document.getElementById('machineCheckboxes');
        if (!container) return;
        container.innerHTML = '';
        const visible = getVisibleMachines();

        // Group machines by group
        const groups = {};
        for (const [id, p] of Object.entries(MACHINE_PROFILES)) {
            (groups[p.group] ||= []).push(p);
        }

        for (const [group, machines] of Object.entries(groups)) {
            const groupDiv = document.createElement('div');
            groupDiv.style.cssText = 'margin-bottom: 8px;';
            const groupLabel = document.createElement('div');
            groupLabel.style.cssText = 'color: var(--text-secondary); font-size: 11px; margin-bottom: 4px; font-weight: bold;';
            groupLabel.textContent = group;
            groupDiv.appendChild(groupLabel);

            for (const p of machines) {
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; align-items: center; margin-left: 8px; margin-bottom: 2px; gap: 6px;';

                const label = document.createElement('label');
                label.className = 'checkbox-label';
                label.style.cssText = 'white-space: nowrap;';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = visible.includes(p.id);
                cb.dataset.machineId = p.id;
                // 48K always visible (cannot uncheck)
                if (p.id === '48k') {
                    cb.disabled = true;
                    cb.checked = true;
                }
                cb.addEventListener('change', () => {
                    const current = getVisibleMachines();
                    if (cb.checked) {
                        if (!current.includes(p.id)) {
                            // Insert in profile order
                            const allIds = getMachineTypes();
                            const idx = allIds.indexOf(p.id);
                            let insertAt = current.length;
                            for (let i = 0; i < current.length; i++) {
                                if (allIds.indexOf(current[i]) > idx) {
                                    insertAt = i;
                                    break;
                                }
                            }
                            current.splice(insertAt, 0, p.id);
                        }
                    } else {
                        const idx = current.indexOf(p.id);
                        if (idx > -1) current.splice(idx, 1);
                    }
                    setVisibleMachines(current);
                    populateMachineDropdown();
                });
                label.appendChild(cb);
                label.appendChild(document.createTextNode(' ' + p.name));
                row.appendChild(label);

                // Load ROM button
                const loadBtn = document.createElement('button');
                loadBtn.className = 'control-btn';
                loadBtn.textContent = 'Load ROM';
                loadBtn.title = 'Load ROM file for ' + p.name + ' (' + (p.romSize / 1024) + 'KB)';
                loadBtn.style.cssText = 'font-size: 10px; padding: 1px 5px;';
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = '.rom,.bin';
                fileInput.style.display = 'none';
                loadBtn.addEventListener('click', () => fileInput.click());
                fileInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        file.arrayBuffer().then(data => {
                            const loadRom = getLoadRomForMachineById();
                            if (loadRom && loadRom(p.id, data, file.name)) {
                                updateRomFileNames();
                            }
                        });
                    }
                    fileInput.value = '';
                });
                row.appendChild(loadBtn);
                row.appendChild(fileInput);

                // ROM filename display
                const fnSpan = document.createElement('span');
                fnSpan.style.cssText = 'color: var(--cyan); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
                fnSpan.dataset.romMachineId = p.id;
                row.appendChild(fnSpan);

                groupDiv.appendChild(row);
            }
            container.appendChild(groupDiv);
        }
    }

    function updateRomFileNames() {
        const getRomFileName = getGetRomFileName();
        if (!getRomFileName) return;
        const spans = document.querySelectorAll('[data-rom-machine-id]');
        for (const span of spans) {
            const machineId = span.dataset.romMachineId;
            const name = getRomFileName(machineId);
            span.textContent = name || '';
            span.title = name || '';
        }
    }

    // Populate dropdown on startup
    populateMachineDropdown();
    buildMachineCheckboxes();

    return { populateMachineDropdown, getVisibleMachines, updateRomFileNames };
}
