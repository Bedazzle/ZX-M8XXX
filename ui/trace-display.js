// Trace Display & Controls — step trace UI, navigation, export
import { hex8, hex16 } from '../core/utils.js';

export function initTraceDisplay({ traceManager, getSpectrum, getDisasm, Disassembler,
                                    getTraceViewAddress, setTraceViewAddress,
                                    goToAddress, showMessage, updateDebugger }) {
    // DOM elements
    const chkTraceEnabled = document.getElementById('chkTraceEnabled');
    const chkTraceRuntime = document.getElementById('chkTraceRuntime');
    const btnTraceBack = document.getElementById('btnTraceBack');
    const btnTraceForward = document.getElementById('btnTraceForward');
    const btnTraceLive = document.getElementById('btnTraceLive');
    const btnTraceClear = document.getElementById('btnTraceClear');
    const btnTraceExport = document.getElementById('btnTraceExport');
    const selTraceExportMode = document.getElementById('selTraceExportMode');
    const txtTraceExportCount = document.getElementById('txtTraceExportCount');
    const txtTraceStopAfter = document.getElementById('txtTraceStopAfter');
    const chkTraceBytes = document.getElementById('chkTraceBytes');
    const chkTraceAlt = document.getElementById('chkTraceAlt');
    const chkTraceSys = document.getElementById('chkTraceSys');
    const chkTracePorts = document.getElementById('chkTracePorts');
    const chkTraceSkipROM = document.getElementById('chkTraceSkipROM');
    const chkTraceCollapseBlock = document.getElementById('chkTraceCollapseBlock');
    const traceStatus = document.getElementById('traceStatus');
    const traceList = document.getElementById('traceList');
    const traceSlider = document.getElementById('traceSlider');

    // Track last trace position for memory reversal (-1 = live)
    let lastTracePos = -1;

    /**
     * Apply memory writes/reverts when navigating trace history.
     * Going backward: undo writes (restore old values).
     * Going forward: redo writes (apply new values).
     * Temporarily disables memory.onWrite to avoid recursive callbacks.
     */
    function applyTraceMemoryDelta(fromPos, toPos) {
        const spectrum = getSpectrum();
        const memory = spectrum.memory;
        const history = traceManager.history;
        const len = history.length;

        // Convert -1 (live) to len for arithmetic
        const from = fromPos === -1 ? len : fromPos;
        const to = toPos === -1 ? len : toPos;

        if (from === to) return;

        // Save and disable write callback to avoid triggering trace/watchpoints
        const savedOnWrite = memory.onWrite;
        memory.onWrite = null;

        try {
            if (to < from) {
                // Going backward: undo entries from (from-1) down to (to), writing old values
                for (let i = from - 1; i >= to; i--) {
                    if (i < 0 || i >= len) continue;
                    const entry = history[i];
                    if (!entry.mem) continue;
                    // Undo in reverse order within each instruction
                    for (let j = entry.mem.length - 1; j >= 0; j--) {
                        const m = entry.mem[j];
                        if (m.old !== undefined) {
                            memory.write(m.addr & 0xFFFF, m.old & 0xFF);
                        }
                    }
                }
            } else {
                // Going forward: redo entries from (from) up to (to-1), writing new values
                for (let i = from; i < to; i++) {
                    if (i < 0 || i >= len) continue;
                    const entry = history[i];
                    if (!entry.mem) continue;
                    for (let j = 0; j < entry.mem.length; j++) {
                        const m = entry.mem[j];
                        memory.write(m.addr & 0xFFFF, m.val & 0xFF);
                    }
                }
            }
        } finally {
            memory.onWrite = savedOnWrite;
        }

        // Re-render screen from updated memory
        spectrum.renderToScreen();
    }

    // Set up trace recording callback
    getSpectrum().onBeforeStep = (cpu, memory, instrPC, portOps, memOps, instrBytes) => {
        try {
            traceManager.record(cpu, memory, instrPC, portOps, memOps, instrBytes);
        } catch (e) {
            console.error('Trace record error:', e);
        }
    };
    getSpectrum().traceEnabled = true;

    function updateTraceStatus() {
        const len = traceManager.length;
        const pos = traceManager.getCurrentPosition();
        const stopped = traceManager.stopped;
        if (pos === -1) {
            traceStatus.textContent = stopped ? `${len} STOPPED` : `${len} instr`;
            traceStatus.classList.toggle('active', len > 0);
            traceStatus.style.color = stopped ? '#f44' : '';
        } else {
            traceStatus.textContent = `${pos + 1}/${len}`;
            traceStatus.classList.add('active');
            traceStatus.style.color = '';
        }
        btnTraceBack.disabled = len === 0 || pos === 0;
        btnTraceForward.disabled = pos === -1;
        btnTraceLive.disabled = pos === -1;

        // Sync slider
        traceSlider.max = Math.max(0, len - 1);
        traceSlider.value = pos === -1 ? Math.max(0, len - 1) : pos;
        traceSlider.disabled = len === 0;
    }

    function updateTraceList() {
        // Only update if trace panel is active
        const tracePanel = document.getElementById('panel-trace');
        if (!tracePanel || !tracePanel.classList.contains('active')) return;

        const currentPos = traceManager.getCurrentPosition();
        const totalLen = traceManager.length;

        // Get entries: either around current position or most recent
        let entries, startIdx, viewIdxInList;
        if (currentPos >= 0) {
            // Navigating history - show entries around current position
            const result = traceManager.getEntriesAround(currentPos, 10);
            entries = result.entries;
            startIdx = result.startIdx;
            viewIdxInList = result.viewIdx;
        } else {
            // Live view - show most recent entries
            entries = traceManager.getRecent(10);
            startIdx = totalLen - entries.length;
            viewIdxInList = -1;
        }

        if (entries.length === 0) {
            traceList.innerHTML = '<div style="padding:4px;color:var(--text-secondary)">No trace data</div>';
            return;
        }

        let html = '';
        const includeAlt = chkTraceAlt.checked;
        const includeSys = chkTraceSys.checked;
        const disasm = getDisasm();
        let prev = null;

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const globalIdx = startIdx + i;
            const isFirst = (i === 0);
            const isViewing = currentPos === globalIdx;
            const isCurrent = currentPos === -1 && i === entries.length - 1;

            // Disassemble from stored bytes (memory may have changed since recording)
            let instrText = '';
            if (Disassembler) {
                const fakeMemory = { read: (addr) => entry.bytes[(addr - entry.pc) & 3] || 0 };
                const entryDisasm = new Disassembler(fakeMemory);
                const instr = entryDisasm.disassemble(entry.pc);
                instrText = instr.mnemonic;
            } else {
                instrText = entry.bytes.slice(0, 3).map(b => hex8(b)).join(' ');
            }

            const classes = ['trace-entry'];
            if (isViewing) classes.push('viewing');
            if (isCurrent) classes.push('current');

            // Format port operations if present
            let portsHtml = '';
            if (entry.ports && entry.ports.length > 0) {
                const portStrs = entry.ports.map(p =>
                    `${p.dir === 'in' ? 'IN' : 'OUT'}(${hex16(p.port)})=${hex8(p.val)}`
                );
                portsHtml = `<span class="ports">${portStrs.join(' ')}</span>`;
            }

            // Format memory operations if present
            let memHtml = '';
            if (entry.mem && entry.mem.length > 0) {
                const memStrs = entry.mem.map(m => `[${hex16(m.addr)}]=${hex8(m.val)}`);
                const suffix = entry.mem.length >= 8 ? '...' : '';
                memHtml = `<span class="memops">${memStrs.join(' ')}${suffix}</span>`;
            }

            // Build register string — only show registers that changed
            const regParts = [];
            if (isFirst || !prev || entry.af !== prev.af) regParts.push(`AF=${hex16(entry.af)}`);
            if (isFirst || !prev || entry.bc !== prev.bc) regParts.push(`BC=${hex16(entry.bc)}`);
            if (isFirst || !prev || entry.de !== prev.de) regParts.push(`DE=${hex16(entry.de)}`);
            if (isFirst || !prev || entry.hl !== prev.hl) regParts.push(`HL=${hex16(entry.hl)}`);
            if (isFirst || !prev || entry.sp !== prev.sp) regParts.push(`SP=${hex16(entry.sp)}`);
            if (isFirst || !prev || entry.ix !== prev.ix) regParts.push(`IX=${hex16(entry.ix)}`);
            if (isFirst || !prev || entry.iy !== prev.iy) regParts.push(`IY=${hex16(entry.iy)}`);
            if (includeAlt) {
                if (isFirst || !prev || entry.af_ !== prev.af_) regParts.push(`AF'=${hex16(entry.af_)}`);
                if (isFirst || !prev || entry.bc_ !== prev.bc_) regParts.push(`BC'=${hex16(entry.bc_)}`);
                if (isFirst || !prev || entry.de_ !== prev.de_) regParts.push(`DE'=${hex16(entry.de_)}`);
                if (isFirst || !prev || entry.hl_ !== prev.hl_) regParts.push(`HL'=${hex16(entry.hl_)}`);
            }
            if (includeSys) {
                if (isFirst || !prev || entry.i !== prev.i) regParts.push(`I=${hex8(entry.i)}`);
                if (isFirst || !prev || entry.r !== prev.r) regParts.push(`R=${hex8(entry.r)}`);
                if (isFirst || !prev || entry.im !== prev.im) regParts.push(`IM=${entry.im}`);
            }
            const regsHtml = regParts.length > 0 ? `<span class="regs">${regParts.join(' ')}</span>` : '';

            html += `<div class="${classes.join(' ')}" data-idx="${globalIdx}">` +
                `<span class="addr">${hex16(entry.pc)}</span>` +
                `<span class="instr">${instrText}</span>` +
                regsHtml + portsHtml + memHtml +
                `</div>`;

            prev = entry;
        }
        traceList.innerHTML = html;

        // Scroll to show the relevant entry
        if (viewIdxInList >= 0) {
            // Navigating history - scroll to viewed entry
            const viewedEl = traceList.querySelector('.trace-entry.viewing');
            if (viewedEl) {
                // Manual scroll within container only (scrollIntoView scrolls the whole page)
                traceList.scrollTop = viewedEl.offsetTop - traceList.offsetTop
                    - traceList.clientHeight / 2 + viewedEl.offsetHeight / 2;
            }
        } else {
            // Live view - scroll to bottom
            traceList.scrollTop = traceList.scrollHeight;
        }
    }

    function showTraceEntry(entry) {
        if (!entry) return;
        // Set trace cursor address for highlighting
        setTraceViewAddress(entry.pc);
        // Show the trace list panel if hidden
        if (!traceList.classList.contains('visible')) {
            traceList.classList.add('visible');
        }
        // Update displays to show historical state
        updateTraceStatus();
        updateTraceList();
        updateDebugger();  // Update registers to show trace entry values
        // Navigate disasm to the traced PC
        goToAddress(entry.pc);
        showMessage(`Viewing trace: ${hex16(entry.pc)}`);
    }

    chkTraceEnabled.addEventListener('change', () => {
        const spectrum = getSpectrum();
        traceManager.enabled = chkTraceEnabled.checked;
        spectrum.traceEnabled = chkTraceEnabled.checked;
        spectrum.updateMemoryCallbacksFlag();
        if (chkTraceEnabled.checked) {
            showMessage('Step trace enabled');
        } else {
            showMessage('Step trace disabled');
        }
    });

    chkTraceAlt.addEventListener('change', () => { updateTraceList(); });
    chkTraceSys.addEventListener('change', () => { updateTraceList(); });

    chkTraceRuntime.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.runtimeTraceEnabled = chkTraceRuntime.checked;
        spectrum.updateMemoryCallbacksFlag();
        if (chkTraceRuntime.checked) {
            showMessage('Runtime trace enabled');
        } else {
            showMessage('Runtime trace disabled');
        }
    });

    btnTraceBack.addEventListener('click', () => {
        const oldPos = lastTracePos;
        const entry = traceManager.goBack();
        if (entry) {
            const newPos = traceManager.getCurrentPosition();
            applyTraceMemoryDelta(oldPos, newPos);
            lastTracePos = newPos;
            showTraceEntry(entry);
        }
    });

    btnTraceForward.addEventListener('click', () => {
        const oldPos = lastTracePos;
        const entry = traceManager.goForward();
        if (entry) {
            const newPos = traceManager.getCurrentPosition();
            applyTraceMemoryDelta(oldPos, newPos);
            lastTracePos = newPos;
            showTraceEntry(entry);
        } else {
            // Returned to live
            applyTraceMemoryDelta(oldPos, -1);
            lastTracePos = -1;
            traceManager.goToLive();
            setTraceViewAddress(null);  // Clear trace cursor
            updateTraceStatus();
            updateTraceList();
            updateDebugger();
            showMessage('Returned to live view');
        }
    });

    btnTraceLive.addEventListener('click', () => {
        const oldPos = lastTracePos;
        applyTraceMemoryDelta(oldPos, -1);
        lastTracePos = -1;
        traceManager.goToLive();
        setTraceViewAddress(null);  // Clear trace cursor
        updateTraceStatus();
        updateTraceList();
        updateDebugger();
        showMessage('Returned to live view');
    });

    traceSlider.addEventListener('input', () => {
        const len = traceManager.length;
        if (len === 0) return;
        const idx = parseInt(traceSlider.value, 10);
        const oldPos = lastTracePos;
        if (idx >= len - 1) {
            // At the end — return to live
            applyTraceMemoryDelta(oldPos, -1);
            lastTracePos = -1;
            traceManager.goToLive();
            setTraceViewAddress(null);
            updateTraceStatus();
            updateTraceList();
            updateDebugger();
        } else {
            applyTraceMemoryDelta(oldPos, idx);
            lastTracePos = idx;
            traceManager.position = idx;
            const entry = traceManager.getEntry(idx);
            if (entry) showTraceEntry(entry);
        }
    });

    btnTraceClear.addEventListener('click', () => {
        // Restore memory to live state before clearing
        if (lastTracePos !== -1) {
            applyTraceMemoryDelta(lastTracePos, -1);
        }
        lastTracePos = -1;
        traceManager.clear();
        updateTraceStatus();
        updateTraceList();
        showMessage('Trace cleared');
    });

    btnTraceExport.addEventListener('click', () => {
        if (traceManager.length === 0) {
            showMessage('No trace data to export');
            return;
        }

        // Calculate range based on mode and count
        const mode = selTraceExportMode.value;  // 'first' or 'last'
        const count = parseInt(txtTraceExportCount.value, 10) || 0;
        const total = traceManager.length;

        let startIdx = 0;
        let endIdx = total;

        if (count > 0 && count < total) {
            if (mode === 'first') {
                startIdx = 0;
                endIdx = count;
            } else {
                startIdx = total - count;
                endIdx = total;
            }
        }

        const exportCount = endIdx - startIdx;

        const text = traceManager.exportToText({
            includeBytes: chkTraceBytes.checked,
            includeAlt: chkTraceAlt.checked,
            includeSys: chkTraceSys.checked,
            includePorts: chkTracePorts.checked,
            includeMem: false,
            collapseBlock: chkTraceCollapseBlock.checked,
            startIdx: startIdx,
            endIdx: endIdx
        }, Disassembler);
        const spectrum = getSpectrum();
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trace_${spectrum.machineType}_${mode}${count || 'all'}_${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        showMessage(`Exported ${exportCount} trace entries (${mode} ${count || 'all'})`);
    });

    // Update stopAfter on change or input
    function updateTraceStopAfter() {
        const val = parseInt(txtTraceStopAfter.value, 10) || 0;
        traceManager.stopAfter = val;
        traceManager.stopped = false;  // Reset stopped state when limit changes
        // Ensure maxHistory is at least as large as stopAfter
        if (val > 0 && val > traceManager.maxHistory) {
            traceManager.maxHistory = val;
        }
    }
    txtTraceStopAfter.addEventListener('change', () => {
        updateTraceStopAfter();
        showMessage(traceManager.stopAfter > 0 ? `Trace will stop after ${traceManager.stopAfter} entries` : 'Trace limit disabled');
    });
    txtTraceStopAfter.addEventListener('input', updateTraceStopAfter);

    // Pause emulator when trace limit is reached
    traceManager.onStopped = () => {
        const spectrum = getSpectrum();
        if (spectrum.running) {
            spectrum.stop();
            updateTraceStatus();
            showMessage(`Trace stopped at ${traceManager.length} entries - emulator paused`);
        }
    };

    // Initialize stopAfter from HTML default value
    updateTraceStopAfter();

    // Skip ROM checkbox
    chkTraceSkipROM.addEventListener('change', () => {
        traceManager.skipROM = chkTraceSkipROM.checked;
    });
    traceManager.skipROM = chkTraceSkipROM.checked;

    // Click on trace status to update trace list
    traceStatus.addEventListener('click', () => {
        updateTraceList();
    });

    // Click on trace entry to navigate
    traceList.addEventListener('click', (e) => {
        const entryEl = e.target.closest('.trace-entry');
        if (entryEl) {
            const idx = parseInt(entryEl.dataset.idx, 10);
            const entry = traceManager.getEntry(idx);
            if (entry) {
                const oldPos = lastTracePos;
                applyTraceMemoryDelta(oldPos, idx);
                lastTracePos = idx;
                traceManager.position = idx;
                showTraceEntry(entry);
            }
        }
    });

    // Expose API
    return {
        updateTraceList,
        updateTraceStatus,
        showTraceEntry
    };
}
