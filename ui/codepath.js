// codepath.js — Code Path Tool: record and diff executed code paths (init-function pattern)

import { hex16, hex8 } from '../core/utils.js';
import { CODE_PATH_CONTEXT_LINES } from '../core/constants.js';

export function initCodePath({
    getSpectrum, readMemory, disassembleAt, getLabel,
    goToAddress, showMessage, downloadFile
}) {

    // State
    const slots = [null, null, null];   // Set<string> per slot (autoMapKeys), or null
    const slotNames = ['Baseline', 'Event A', 'Event B'];
    let recording = false;
    let currentRecordSlot = 0;
    let diffResults = null;             // Array of clustered blocks after diff (each block has cached .instrs)
    let diffLabel = '';                  // Label from last diff computation
    let tracing = false;                // true when trace-break mode active

    // DOM lookups
    const cpSlotSelect = document.getElementById('cpSlotSelect');
    const btnCpRecord = document.getElementById('btnCpRecord');
    const btnCpDiff = document.getElementById('btnCpDiff');
    const cpDiffMode = document.getElementById('cpDiffMode');
    const chkCpSkipRom = document.getElementById('chkCpSkipRom');
    const btnCpExport = document.getElementById('btnCpExport');
    const btnCpClear = document.getElementById('btnCpClear');
    const btnCpTrace = document.getElementById('btnCpTrace');
    const chkCpMerge = document.getElementById('chkCpMerge');
    const cpStatus = document.getElementById('cpStatus');
    const cpResults = document.getElementById('cpResults');
    const cpFilterText = document.getElementById('cpFilterText');
    const btnCpFilter = document.getElementById('btnCpFilter');
    const btnCpFilterWrites = document.getElementById('btnCpFilterWrites');
    const btnCpFilterBranch = document.getElementById('btnCpFilterBranch');
    const cpFilterFrom = document.getElementById('cpFilterFrom');
    const cpFilterTo = document.getElementById('cpFilterTo');
    const cpFilterStatus = document.getElementById('cpFilterStatus');

    // --- Helpers ---

    function parseKey(key) {
        // autoMapKey format: "addr" or "addr:page"
        const colon = key.indexOf(':');
        if (colon === -1) {
            return { addr: parseInt(key, 10), page: null };
        }
        return {
            addr: parseInt(key.substring(0, colon), 10),
            page: key.substring(colon + 1)
        };
    }

    function substituteLabelNames(mnemonic) {
        // Replace 4-digit hex operands (e.g., 6A00h) with label names when available
        return mnemonic.replace(/\b([0-9A-F]{4})h\b/gi, (match, hexAddr) => {
            const addr = parseInt(hexAddr, 16);
            const name = getLabel(addr);
            return name || match;
        });
    }

    function updateSlotLabels() {
        for (let i = 0; i < 3; i++) {
            const opt = cpSlotSelect.options[i];
            if (slots[i]) {
                opt.textContent = `${slotNames[i]} (${slots[i].size})`;
            } else {
                opt.textContent = slotNames[i];
            }
        }
    }

    function updateStatus(text) {
        cpStatus.textContent = text;
    }

    // --- Recording ---

    function startRecording() {
        currentRecordSlot = parseInt(cpSlotSelect.value, 10);
        const spectrum = getSpectrum();
        spectrum.startCodePathRecording();
        recording = true;
        btnCpRecord.classList.add('active');
        btnCpRecord.textContent = 'Stop';
        updateStatus(`Recording ${slotNames[currentRecordSlot]}...`);
    }

    function stopRecordingInternal() {
        if (!recording) return;
        const spectrum = getSpectrum();
        const result = spectrum.stopCodePathRecording();
        recording = false;
        btnCpRecord.classList.remove('active');
        btnCpRecord.textContent = 'Record';
        if (result) {
            if (chkCpMerge.checked && slots[currentRecordSlot]) {
                const existing = slots[currentRecordSlot];
                const prevSize = existing.size;
                for (const key of result) existing.add(key);
                updateSlotLabels();
                updateStatus(`${slotNames[currentRecordSlot]}: ${existing.size} PCs (merged +${existing.size - prevSize})`);
            } else {
                slots[currentRecordSlot] = result;
                updateSlotLabels();
                updateStatus(`${slotNames[currentRecordSlot]}: ${result.size} PCs`);
            }
        } else {
            updateStatus('');
        }
    }

    btnCpRecord.addEventListener('click', () => {
        if (recording) {
            stopRecordingInternal();
        } else {
            startRecording();
        }
    });

    // --- Tracing ---

    function startTracing() {
        if (!slots[0]) {
            showMessage('Baseline slot is empty — record it first.');
            return;
        }
        if (recording) stopRecordingInternal();
        const spectrum = getSpectrum();
        spectrum.startCodePathTracing(slots[0]);
        tracing = true;
        btnCpTrace.classList.add('active');
        updateStatus('Tracing...');
    }

    function stopTracing() {
        if (!tracing) return;
        const spectrum = getSpectrum();
        spectrum.stopCodePathTracing();
        tracing = false;
        btnCpTrace.classList.remove('active');
        updateStatus('');
    }

    btnCpTrace.addEventListener('click', () => {
        if (tracing) {
            stopTracing();
        } else {
            startTracing();
        }
    });

    // --- Diff ---

    function getDiffOp() {
        const mode = cpDiffMode.value;
        switch (mode) {
            case 'a-base':  return { from: slots[1], subtract: slots[0], label: 'A \u2212 Baseline' };
            case 'b-base':  return { from: slots[2], subtract: slots[0], label: 'B \u2212 Baseline' };
            case 'a-b':     return { from: slots[1], subtract: slots[2], label: 'A \u2212 B' };
            case 'b-a':     return { from: slots[2], subtract: slots[1], label: 'B \u2212 A' };
            case 'ab-base': return { from: slots[1], intersect: slots[2], subtract: slots[0], label: '(A \u2229 B) \u2212 Baseline' };
            case 'a-b-base': return { from: slots[1], subtract: slots[2], subtract2: slots[0], label: '(A \u2212 B) \u2212 Baseline' };
            case 'b-a-base': return { from: slots[2], subtract: slots[1], subtract2: slots[0], label: '(B \u2212 A) \u2212 Baseline' };
            default:        return null;
        }
    }

    function computeDiff() {
        const op = getDiffOp();
        if (!op) return;
        if (!op.from) {
            showMessage('Source slot is empty \u2014 record it first.');
            return;
        }
        if ('intersect' in op && !op.intersect) {
            showMessage('Intersect slot is empty \u2014 record it first.');
            return;
        }
        if (!op.subtract) {
            showMessage('Subtract slot is empty \u2014 record it first.');
            return;
        }
        if ('subtract2' in op && !op.subtract2) {
            showMessage('Baseline slot is empty \u2014 record it first.');
            return;
        }
        const skipRom = chkCpSkipRom.checked;

        // Collect candidate keys: intersection mode filters from ∩ intersect first
        const candidates = op.intersect
            ? [...op.from].filter(key => op.intersect.has(key))
            : op.from;

        // Set subtraction: keys in candidates but not in subtract
        const unique = [];
        for (const key of candidates) {
            if (!op.subtract.has(key) && (!op.subtract2 || !op.subtract2.has(key))) {
                const parsed = parseKey(key);
                if (skipRom && parsed.addr < 0x4000 && (parsed.page === null || parsed.page.startsWith('R'))) continue;
                unique.push(parsed);
            }
        }

        if (unique.length === 0) {
            diffResults = [];
            cpResults.innerHTML = '';
            updateStatus(`${op.label}: 0 unique PCs`);
            showMessage('No unique code found.');
            return;
        }

        // Cluster: sort by page then addr, merge consecutive with gap ≤ 4, same page
        unique.sort((a, b) => {
            const pa = a.page || '';
            const pb = b.page || '';
            if (pa !== pb) return pa < pb ? -1 : 1;
            return a.addr - b.addr;
        });

        const blocks = [];
        let block = { page: unique[0].page, start: unique[0].addr, end: unique[0].addr, addrs: [unique[0].addr] };
        for (let i = 1; i < unique.length; i++) {
            const u = unique[i];
            if (u.page === block.page && u.addr - block.end <= 4) {
                block.end = u.addr;
                block.addrs.push(u.addr);
            } else {
                blocks.push(block);
                block = { page: u.page, start: u.addr, end: u.addr, addrs: [u.addr] };
            }
        }
        blocks.push(block);

        // Disassemble once and cache instructions + context per block
        for (const b of blocks) {
            const { context, instrs } = disassembleBlock(b);
            b.context = context;
            b.instrs = instrs;
        }

        diffResults = blocks;
        diffLabel = op.label;
        renderResults(blocks);
        updateStatus(`${op.label}: ${unique.length} PCs, ${blocks.length} blocks`);
    }

    // --- Render ---

    function renderInstrRow(instr, blockDiv) {
        const instrDiv = document.createElement('div');
        instrDiv.className = 'cp-instr' + (instr.context ? ' cp-context' : '');

        const markerSpan = document.createElement('span');
        markerSpan.className = 'cp-marker';
        markerSpan.textContent = instr.context ? '*' : ' ';

        const addrSpan = document.createElement('span');
        addrSpan.className = 'cp-addr';
        addrSpan.textContent = '$' + hex16(instr.addr);

        const mnemonicSpan = document.createElement('span');
        mnemonicSpan.className = 'cp-mnemonic';
        mnemonicSpan.textContent = instr.mnemonic;

        const bytesSpan = document.createElement('span');
        bytesSpan.className = 'cp-bytes';
        bytesSpan.textContent = instr.bytes.map(b => hex8(b)).join(' ');

        instrDiv.appendChild(markerSpan);
        instrDiv.appendChild(addrSpan);
        instrDiv.appendChild(mnemonicSpan);
        instrDiv.appendChild(bytesSpan);
        instrDiv.addEventListener('click', () => goToAddress(instr.addr));
        blockDiv.appendChild(instrDiv);
    }

    function renderResults(blocks) {
        cpResults.innerHTML = '';
        for (const block of blocks) {
            const blockDiv = document.createElement('div');
            blockDiv.className = 'cp-block';

            const instrs = block.instrs;

            // Block header
            const endAddr = instrs.length > 0 ? instrs[instrs.length - 1].addr + instrs[instrs.length - 1].length - 1 : block.end;
            const totalBytes = endAddr - block.start + 1;
            const pageStr = block.page ? ` [${block.page}]` : '';
            const header = document.createElement('div');
            header.className = 'cp-block-header';
            header.textContent = `$${hex16(block.start)}\u2013$${hex16(endAddr)}${pageStr} (${totalBytes}B)`;
            header.addEventListener('click', () => goToAddress(block.start));
            blockDiv.appendChild(header);

            // Context lines (marked with *)
            for (const ctx of block.context) {
                renderInstrRow(ctx, blockDiv);
            }

            // Diff instructions
            for (const instr of instrs) {
                renderInstrRow(instr, blockDiv);
            }

            cpResults.appendChild(blockDiv);
        }
        applyFilter();
    }

    // --- Filtering ---

    function hasActiveFilter() {
        return cpFilterText.value.trim() !== '' || cpFilterFrom.value.trim() !== '' || cpFilterTo.value.trim() !== '';
    }

    function blockMatchesFilter(block, terms, addrFrom, addrTo) {
        // Check address range overlap
        const instrs = block.instrs;
        if (instrs.length === 0) return false;
        const blockEnd = instrs[instrs.length - 1].addr;
        if (block.start > addrTo || blockEnd < addrFrom) return false;

        // If no mnemonic terms, pass on address match alone
        if (terms.length === 0) return true;

        // Check if any non-context instruction matches any term
        for (const instr of instrs) {
            const upper = instr.mnemonic.toUpperCase();
            for (const term of terms) {
                if (upper.indexOf(term) !== -1) return true;
            }
        }
        return false;
    }

    function instrMatchesTerm(instr, terms) {
        if (terms.length === 0) return false;
        const upper = instr.mnemonic.toUpperCase();
        for (const term of terms) {
            if (upper.indexOf(term) !== -1) return true;
        }
        return false;
    }

    function applyFilter() {
        if (!diffResults || diffResults.length === 0) {
            cpFilterStatus.textContent = '';
            return;
        }

        const filterStr = cpFilterText.value.trim().toUpperCase();
        const terms = filterStr ? filterStr.split('|').filter(t => t.length > 0) : [];
        const addrFrom = cpFilterFrom.value.trim() ? parseInt(cpFilterFrom.value.trim(), 16) || 0 : 0;
        const addrTo = cpFilterTo.value.trim() ? parseInt(cpFilterTo.value.trim(), 16) || 0xFFFF : 0xFFFF;
        const active = hasActiveFilter();

        const blockDivs = cpResults.querySelectorAll('.cp-block');
        let visible = 0;
        for (let i = 0; i < blockDivs.length && i < diffResults.length; i++) {
            const match = !active || blockMatchesFilter(diffResults[i], terms, addrFrom, addrTo);
            blockDivs[i].classList.toggle('cp-filtered', !match);
            if (match) visible++;

            // Highlight matching mnemonic instructions within visible blocks
            const instrDivs = blockDivs[i].querySelectorAll('.cp-instr');
            const allInstrs = [...diffResults[i].context, ...diffResults[i].instrs];
            for (let j = 0; j < instrDivs.length && j < allInstrs.length; j++) {
                const highlight = match && active && terms.length > 0 && !allInstrs[j].context && instrMatchesTerm(allInstrs[j], terms);
                instrDivs[j].classList.toggle('cp-highlight', highlight);
            }
        }

        if (active) {
            cpFilterStatus.textContent = `(${visible}/${diffResults.length})`;
        } else {
            cpFilterStatus.textContent = '';
        }
    }

    function getVisibleBlocks() {
        if (!diffResults || diffResults.length === 0) return [];
        if (!hasActiveFilter()) return diffResults;

        const filterStr = cpFilterText.value.trim().toUpperCase();
        const terms = filterStr ? filterStr.split('|').filter(t => t.length > 0) : [];
        const addrFrom = cpFilterFrom.value.trim() ? parseInt(cpFilterFrom.value.trim(), 16) || 0 : 0;
        const addrTo = cpFilterTo.value.trim() ? parseInt(cpFilterTo.value.trim(), 16) || 0xFFFF : 0xFFFF;

        return diffResults.filter(block => blockMatchesFilter(block, terms, addrFrom, addrTo));
    }

    function disassembleContext(blockStart) {
        // Disassemble backwards by starting from (blockStart - scanBack) and collecting
        // the last CODE_PATH_CONTEXT_LINES instructions that land before blockStart
        if (CODE_PATH_CONTEXT_LINES <= 0 || blockStart <= 0) return [];
        const scanBack = CODE_PATH_CONTEXT_LINES * 4 + 4; // generous scan window
        const scanStart = Math.max(0, blockStart - scanBack);
        const candidates = [];
        let pc = scanStart;
        let safety = 0;
        while (pc < blockStart && safety < 200) {
            const result = disassembleAt(pc);
            if (!result || result.length === 0) break;
            candidates.push({ addr: result.addr, bytes: result.bytes, mnemonic: substituteLabelNames(result.mnemonic), length: result.length, context: true });
            pc = (pc + result.length) & 0xffff;
            safety++;
        }
        // Take the last N that actually end at or before blockStart
        return candidates.slice(-CODE_PATH_CONTEXT_LINES);
    }

    function disassembleBlock(block) {
        const context = disassembleContext(block.start);
        const instrs = [];
        const addrSet = new Set(block.addrs);
        let pc = block.start;
        let safety = 0;
        while (pc <= block.end && safety < 500) {
            const result = disassembleAt(pc);
            if (!result || result.length === 0) break;
            if (addrSet.has(pc)) {
                instrs.push({ addr: result.addr, bytes: result.bytes, mnemonic: substituteLabelNames(result.mnemonic), length: result.length, context: false });
            }
            pc = (pc + result.length) & 0xffff;
            safety++;
            if (pc < block.start) break;
        }
        return { context, instrs };
    }

    // --- Export ---

    function formatInstrLine(instr) {
        const marker = instr.context ? '*' : ' ';
        const addrLabel = getLabel(instr.addr);
        const addr = '$' + hex16(instr.addr);
        const addrCol = addrLabel ? (addr + ' ' + addrLabel).padEnd(26) : addr.padEnd(7);
        const mnemonic = instr.mnemonic.padEnd(20);
        const bytesStr = instr.bytes.map(b => hex8(b)).join(' ');
        return `${marker}   ${addrCol}   ${mnemonic} ${bytesStr}`;
    }

    function exportResults() {
        if (!diffResults || diffResults.length === 0) {
            showMessage('No diff results to export.');
            return;
        }
        const visibleBlocks = getVisibleBlocks();
        if (visibleBlocks.length === 0) {
            showMessage('No blocks match current filter.');
            return;
        }
        const lines = [`; Code Path Diff: ${diffLabel}`];
        if (hasActiveFilter()) {
            const parts = [];
            if (cpFilterText.value.trim()) parts.push(`mnemonic: ${cpFilterText.value.trim()}`);
            if (cpFilterFrom.value.trim() || cpFilterTo.value.trim()) parts.push(`range: $${cpFilterFrom.value.trim() || '0000'}-$${cpFilterTo.value.trim() || 'FFFF'}`);
            lines.push(`; Filter: ${parts.join(', ')}`);
            lines.push(`; ${visibleBlocks.length}/${diffResults.length} blocks (filtered)`);
        } else {
            lines.push(`; ${visibleBlocks.length} blocks`);
        }
        lines.push('');

        for (const block of visibleBlocks) {
            const instrs = block.instrs;
            const endAddr = instrs.length > 0 ? instrs[instrs.length - 1].addr + instrs[instrs.length - 1].length - 1 : block.end;
            const pageStr = block.page ? ` [${block.page}]` : '';
            const startLabel = getLabel(block.start);
            const labelSuffix = startLabel ? ` (${startLabel})` : '';
            lines.push(`; --- $${hex16(block.start)}-$${hex16(endAddr)}${pageStr}${labelSuffix} ---`);
            for (const ctx of block.context) {
                lines.push(formatInstrLine(ctx));
            }
            for (const instr of instrs) {
                lines.push(formatInstrLine(instr));
            }
            lines.push('');
        }

        downloadFile(`codepath-${Math.floor(Date.now() / 1000)}.txt`, lines.join('\n'));
    }

    // --- Clear ---

    function clearAll() {
        if (tracing) stopTracing();
        if (recording) stopRecordingInternal();
        slots[0] = null;
        slots[1] = null;
        slots[2] = null;
        diffResults = null;
        diffLabel = '';
        cpResults.innerHTML = '';
        updateSlotLabels();
        updateStatus('');
        cpFilterText.value = '';
        cpFilterFrom.value = '';
        cpFilterTo.value = '';
        cpFilterStatus.textContent = '';
    }

    // --- Event wiring ---

    btnCpDiff.addEventListener('click', computeDiff);
    btnCpExport.addEventListener('click', exportResults);
    btnCpClear.addEventListener('click', clearAll);
    btnCpFilter.addEventListener('click', applyFilter);
    btnCpFilterWrites.addEventListener('click', () => {
        cpFilterText.value = 'DEC|SUB|SBC|CP';
        applyFilter();
    });
    btnCpFilterBranch.addEventListener('click', () => {
        cpFilterText.value = 'JP |JR |CALL |RET ';
        applyFilter();
    });
    cpFilterText.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyFilter();
    });

    // --- Public API ---

    return {
        stopRecording() {
            if (tracing) stopTracing();
            if (recording) {
                // Cancel without saving — discard partial recording
                const spectrum = getSpectrum();
                spectrum.stopCodePathRecording();
                recording = false;
                btnCpRecord.classList.remove('active');
                btnCpRecord.textContent = 'Record';
                updateStatus('');
            }
        }
    };
}
