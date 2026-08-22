// table-scanner.js — the Search tab's "Tables" card.
//
// The rest of the panel finds code. This finds the tables a hunt usually turns
// on: the keyboard scan a game reads its controls through, the key-number to
// character map, and the fixed-record vocabulary an adventure parses against.
// core/table-scan.js does the recognising; this is the card around it.
//
// The vocabulary view sorts by word *value* by default, and marks the entries
// that sit far above the rest. That ordering is the point: a game whose words
// run 11, 57, 71 and then has two at 200 and 201 is saying what those two are.

import { hex16, escapeHtml } from '../core/utils.js';
import { findKeyScanTables, findCharTables, findWordTables,
         byValue, outliers } from '../core/table-scan.js';

export function initTableScanner({ readMemory, showMessage, goToMemoryAddress }) {
    const btnTableScan = document.getElementById('btnTableScan');
    const tableScanKind = document.getElementById('tableScanKind');
    const tableScanROM = document.getElementById('tableScanROM');
    const tableScanByValue = document.getElementById('tableScanByValue');
    const tableScanStatus = document.getElementById('tableScanStatus');
    const tableScanResults = document.getElementById('tableScanResults');
    if (!btnTableScan || !tableScanResults) return {};

    // Every candidate is a lead, not a proof — cap the list so a noisy scan
    // can't fill the panel with things nobody will read
    const MAX_TABLES = 25;
    const MAX_ROWS = 40;

    function scanRange() {
        return tableScanROM.checked ? [0x0000, 0x10000] : [0x4000, 0x10000];
    }

    function renderKeyScan(tables) {
        return tables.map(t => {
            const keys = t.entries.map(e => e.key || `$${e.row.toString(16)}/$${e.bit.toString(16)}`);
            return row(t.addr, t.label, keys.join(' '));
        }).join('');
    }

    function renderChars(tables) {
        return tables.map(t => row(t.addr, t.label, t.text)).join('');
    }

    function renderVocab(tables) {
        return tables.map(t => {
            const odd = new Set(outliers(t).map(e => e.addr));
            const entries = tableScanByValue.checked ? byValue(t) : t.entries;
            const words = entries.slice(0, MAX_ROWS).map(e => {
                const text = `${e.word}=${e.value}`;
                return odd.has(e.addr)
                    ? `<b class="table-odd" title="far above the rest of the table">${escapeHtml(text)}</b>`
                    : escapeHtml(text);
            }).join(' ');
            const more = entries.length > MAX_ROWS ? ` …+${entries.length - MAX_ROWS}` : '';
            return row(t.addr, t.label, words + more, true);
        }).join('');
    }

    function row(addr, label, body, html = false) {
        return `<div class="text-scan-result" data-addr="${addr}">` +
               `<span class="addr">${hex16(addr)}</span> ` +
               `<span class="tscan-label">${escapeHtml(label)}</span> ` +
               `<span class="preview">${html ? body : escapeHtml(body)}</span></div>`;
    }

    function doScan() {
        const [from, to] = scanRange();
        const kind = tableScanKind.value;
        tableScanResults.innerHTML = '';
        tableScanStatus.textContent = 'scanning…';

        let tables = [], html = '';
        try {
            if (kind === 'keyscan') {
                tables = findKeyScanTables(readMemory, from, to, { limit: MAX_TABLES });
                html = renderKeyScan(tables);
            } else if (kind === 'chars') {
                tables = findCharTables(readMemory, from, to, { limit: MAX_TABLES });
                html = renderChars(tables);
            } else {
                tables = findWordTables(readMemory, from, to, { limit: MAX_TABLES });
                html = renderVocab(tables);
            }
        } catch (e) {
            tableScanStatus.textContent = 'failed';
            showMessage('Table scan failed: ' + e.message, 'error');
            return;
        }

        if (!tables.length) {
            tableScanStatus.textContent = 'nothing of that shape';
            tableScanResults.innerHTML =
                '<div class="search-info">No table of that shape in this range</div>';
            return;
        }
        tableScanStatus.textContent = `${tables.length} candidate${tables.length === 1 ? '' : 's'}`;
        tableScanResults.innerHTML = html;
    }

    btnTableScan.addEventListener('click', doScan);
    tableScanResults.addEventListener('click', (e) => {
        const el = e.target.closest('.text-scan-result');
        if (el) goToMemoryAddress(parseInt(el.dataset.addr, 10));
    });
    // Re-render rather than re-scan: the ordering is a view, not a search
    tableScanByValue.addEventListener('change', () => {
        if (tableScanResults.children.length) doScan();
    });

    return { doScan };
}
