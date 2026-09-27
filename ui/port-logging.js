// port-logging.js — Port I/O logging and trace filter controls (extracted from index.html)
import { fmtPort } from '../core/addr-format.js';

export function initPortLogging({ getSpectrum, showMessage }) {
    const chkPortLog = document.getElementById('chkPortLog');
    const selPortLogFilter = document.getElementById('selPortLogFilter');
    const btnPortLogExport = document.getElementById('btnPortLogExport');
    const btnPortLogClear = document.getElementById('btnPortLogClear');
    const portLogStatus = document.getElementById('portLogStatus');

    function updatePortLogStatus() {
        const spectrum = getSpectrum();
        const count = spectrum.getPortLogCount();
        portLogStatus.textContent = count > 0 ? `${count} entries` : '';
    }

    chkPortLog.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.setPortLogEnabled(chkPortLog.checked);
        updatePortLogStatus();
        if (chkPortLog.checked) {
            showMessage('Port I/O logging enabled');
        }
    });

    btnPortLogExport.addEventListener('click', () => {
        if (btnPortLogExport.dataset.exporting) return;
        btnPortLogExport.dataset.exporting = '1';
        try {
            const spectrum = getSpectrum();
            const filter = selPortLogFilter.value; // 'both', 'in', or 'out'
            const result = spectrum.exportPortLog(filter);
            if (result.count === 0) {
                showMessage('No port log entries to export');
                return;
            }
            const blob = new Blob([result.text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'port-io-log.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showMessage(`Exported ${result.count} port log entries`);
        } finally {
            setTimeout(() => { delete btnPortLogExport.dataset.exporting; }, 500);
        }
    });

    btnPortLogClear.addEventListener('click', () => {
        const spectrum = getSpectrum();
        spectrum.clearPortLog();
        updatePortLogStatus();
        showMessage('Port log cleared');
    });

    // Port trace filter controls
    const txtPortTraceFilter = document.getElementById('txtPortTraceFilter');
    const btnAddPortFilter = document.getElementById('btnAddPortFilter');
    const btnClearPortFilters = document.getElementById('btnClearPortFilters');
    const portFilterStatus = document.getElementById('portFilterStatus');
    const portFilterList = document.getElementById('portFilterList');

    function updatePortFilterList() {
        const spectrum = getSpectrum();
        const filters = spectrum.getPortTraceFilters();
        if (filters.length === 0) {
            portFilterList.innerHTML = '<div class="no-breakpoints">All ports (no filter)</div>';
            portFilterStatus.textContent = '';
        } else {
            const portHex = v => fmtPort(v);
            portFilterList.innerHTML = filters.map((f, i) => {
                const desc = portHex(f.port) + '&' + portHex(f.mask);
                return `<div class="trigger-item" data-index="${i}">
                    <span class="trigger-icon port-filter" title="Port filter">P</span>
                    <span class="trigger-desc">${desc}</span>
                    <span class="trigger-remove" data-index="${i}" title="Remove">\u00d7</span>
                </div>`;
            }).join('');
            portFilterStatus.textContent = `${filters.length} filter${filters.length !== 1 ? 's' : ''}`;
        }
    }

    function addPortFilterFromInput() {
        const spectrum = getSpectrum();
        const val = txtPortTraceFilter.value.trim();
        if (!val) return;
        const result = spectrum.addPortTraceFilter(val);
        if (!result) {
            showMessage('Invalid port spec (use hex: FE, 7FFD, FE&FF)');
            return;
        }
        txtPortTraceFilter.value = '';
        updatePortFilterList();
    }

    btnAddPortFilter.addEventListener('click', addPortFilterFromInput);

    txtPortTraceFilter.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addPortFilterFromInput();
        }
    });

    btnClearPortFilters.addEventListener('click', () => {
        const spectrum = getSpectrum();
        spectrum.clearPortTraceFilters();
        updatePortFilterList();
        showMessage('Port filters cleared — tracing all ports');
    });

    portFilterList.addEventListener('click', (e) => {
        if (e.target.classList.contains('trigger-remove')) {
            const spectrum = getSpectrum();
            const index = parseInt(e.target.dataset.index);
            spectrum.removePortTraceFilter(index);
            updatePortFilterList();
        }
    });

    return {
        updatePortLogStatus,
        updatePortFilterList
    };
}
