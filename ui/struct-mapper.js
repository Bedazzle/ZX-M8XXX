// struct-mapper.js — Struct field access mapper (monitor reads/writes at offsets from base)
import { hex8, hex16, escapeHtml } from '../core/utils.js';

export function initStructMapper({
    startStructMapper, stopStructMapper, readMemory, getSpectrum,
    disassembleAt, labelManager, goToAddress, showMessage
}) {
    // DOM lookups
    const smBaseReg = document.getElementById('smBaseReg');
    const smBaseAddr = document.getElementById('smBaseAddr');
    const smMaxOffset = document.getElementById('smMaxOffset');
    const btnSmStart = document.getElementById('btnSmStart');
    const smStatus = document.getElementById('smStatus');
    const smResults = document.getElementById('smResults');

    let mapping = false;

    if (!btnSmStart) return { stopMapping() {} };

    btnSmStart.addEventListener('click', () => {
        if (!mapping) {
            const baseReg = smBaseReg.value || null;
            const baseAddr = baseReg ? 0 : parseAddr(smBaseAddr.value);
            const maxOffset = parseInt(smMaxOffset.value) || 32;

            if (!baseReg && (isNaN(baseAddr) || baseAddr < 0 || baseAddr > 0xFFFF)) {
                showMessage('Enter a valid base address or select a register', 'error');
                return;
            }
            if (maxOffset < 1 || maxOffset > 255) {
                showMessage('Size must be 1-255', 'error');
                return;
            }

            startStructMapper(baseAddr, baseReg, maxOffset);
            mapping = true;
            btnSmStart.textContent = 'Stop';
            btnSmStart.classList.add('active');
            smStatus.textContent = `(mapping ${baseReg || '$' + hex16(baseAddr)} +0..+${maxOffset})`;
            smResults.innerHTML = '';
        } else {
            const results = stopStructMapper();
            mapping = false;
            btnSmStart.textContent = 'Map';
            btnSmStart.classList.remove('active');
            renderResults(results);
        }
    });

    function parseAddr(str) {
        str = (str || '').trim();
        if (!str) return -1;
        if (str.startsWith('$')) str = str.slice(1);
        else if (str.startsWith('0x') || str.startsWith('0X')) str = str.slice(2);
        return parseInt(str, 16);
    }

    function getLabel(addr) {
        if (!labelManager) return null;
        const label = labelManager.get(addr);
        return label ? label.name : null;
    }

    function renderResults(fields) {
        if (!fields || fields.size === 0) {
            smStatus.textContent = '(no field accesses detected)';
            smResults.innerHTML = '<div style="color:var(--text-secondary);padding:4px">No reads or writes detected at monitored offsets</div>';
            return;
        }

        // Get current base for reading values
        const spectrum = getSpectrum();
        const baseReg = smBaseReg.value || null;
        const base = baseReg ?
            (baseReg === 'IX' ? spectrum.cpu.ix : spectrum.cpu.iy) :
            parseAddr(smBaseAddr.value);

        // Sort by offset
        const sorted = [...fields.entries()].sort((a, b) => a[0] - b[0]);

        smStatus.textContent = `(${sorted.length} fields accessed)`;

        // Find max count widths for alignment
        let maxReadCount = 0, maxWriteCount = 0;
        for (const [, field] of sorted) {
            const tr = [...field.reads.values()].reduce((a, b) => a + b, 0);
            const tw = [...field.writes.values()].reduce((a, b) => a + b, 0);
            if (tr > maxReadCount) maxReadCount = tr;
            if (tw > maxWriteCount) maxWriteCount = tw;
        }
        const rcw = String(maxReadCount).length;
        const wcw = String(maxWriteCount).length;

        let html = '<table style="width:100%;border-collapse:collapse;font-size:11px;font-family:monospace">';
        html += '<tr style="color:var(--cyan);border-bottom:1px solid var(--border)">';
        html += '<th style="text-align:left;padding:2px 4px;width:32px">+Off</th>';
        html += '<th style="text-align:left;padding:2px 4px;width:44px">Addr</th>';
        html += '<th style="text-align:left;padding:2px 4px;width:22px">Val</th>';
        html += '<th style="text-align:right;padding:2px 4px">Reads</th>';
        html += '<th style="text-align:right;padding:2px 4px">Writes</th>';
        html += '</tr>';

        for (const [offset, field] of sorted) {
            const addr = (base + offset) & 0xFFFF;
            const curVal = readMemory(addr);

            const totalReads = [...field.reads.values()].reduce((a, b) => a + b, 0);
            const totalWrites = [...field.writes.values()].reduce((a, b) => a + b, 0);
            const rowId = `sm-detail-${offset}`;

            html += `<tr class="hover-highlight" style="border-bottom:1px solid var(--bg-tertiary);cursor:pointer" data-detail="${rowId}">`;

            // Offset
            html += `<td style="padding:2px 4px;color:var(--cyan);font-weight:bold">+${hex8(offset)}</td>`;

            // Address
            html += `<td style="padding:2px 4px;color:var(--text-secondary)">$${hex16(addr)}</td>`;

            // Current value
            html += `<td style="padding:2px 4px">${hex8(curVal)}</td>`;

            // Reads summary
            html += '<td style="padding:2px 4px;text-align:right">';
            if (totalReads > 0) {
                html += `${String(totalReads).padStart(rcw, '\u2007')}\u00d7 <span style="color:var(--text-secondary)">(${field.reads.size})</span>`;
            }
            html += '</td>';

            // Writes summary
            html += '<td style="padding:2px 4px;text-align:right">';
            if (totalWrites > 0) {
                html += `${String(totalWrites).padStart(wcw, '\u2007')}\u00d7 <span style="color:var(--text-secondary)">(${field.writes.size})</span>`;
            }
            html += '</td>';

            html += '</tr>';

            // Expandable detail row (hidden by default)
            html += `<tr id="${rowId}" class="hidden"><td colspan="5" style="padding:2px 4px 6px 12px">`;

            function renderAccessList(label, entries) {
                if (entries.length === 0) return '';
                let out = `<div style="color:var(--text-secondary);margin-bottom:1px">${label}:</div>`;
                const maxC = String(entries[0][1]).length; // sorted desc, first is widest
                for (const [pc, count] of entries) {
                    const lbl = getLabel(pc);
                    const display = lbl ? escapeHtml(lbl) : `$${hex16(pc)}`;
                    const disasmResult = disassembleAt ? disassembleAt(pc) : null;
                    const mnemonic = disasmResult ? disasmResult.mnemonic || '' : '';
                    out += `<div style="margin-left:8px">`;
                    out += `<span style="display:inline-block;text-align:right;width:${maxC + 1}ch;color:var(--text-secondary)">${count}\u00d7</span> `;
                    out += `<span class="wm-addr" data-addr="${pc}" style="cursor:pointer;color:var(--cyan)">${display}</span>`;
                    if (mnemonic) out += ` <span style="color:var(--text-secondary)">${escapeHtml(mnemonic)}</span>`;
                    out += '</div>';
                }
                return out;
            }

            if (totalReads > 0) {
                html += renderAccessList('Readers', [...field.reads.entries()].sort((a, b) => b[1] - a[1]));
            }
            if (totalWrites > 0) {
                if (totalReads > 0) html += '<div style="height:3px"></div>';
                html += renderAccessList('Writers', [...field.writes.entries()].sort((a, b) => b[1] - a[1]));
            }
            html += '</td></tr>';
        }

        html += '</table>';
        smResults.innerHTML = html;
    }

    // Click handlers for addresses and row expansion
    smResults.addEventListener('click', (e) => {
        // Navigate to address
        const addrEl = e.target.closest('[data-addr]');
        if (addrEl) {
            goToAddress(parseInt(addrEl.dataset.addr));
            return;
        }
        // Expand/collapse detail row
        const row = e.target.closest('[data-detail]');
        if (row) {
            const detailRow = document.getElementById(row.dataset.detail);
            if (detailRow) detailRow.classList.toggle('hidden');
        }
    });

    function stopMappingCleanup() {
        if (mapping) {
            stopStructMapper();
            mapping = false;
            if (btnSmStart) {
                btnSmStart.textContent = 'Map';
                btnSmStart.classList.remove('active');
            }
        }
        if (smStatus) smStatus.textContent = '';
        if (smResults) smResults.innerHTML = '';
    }

    return {
        stopMapping() {
            stopMappingCleanup();
        }
    };
}
