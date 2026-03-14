// poke-search.js — POKE Search / Memory Scanner (extracted from index.html)
import { hex8, hex16, escapeHtml } from '../core/utils.js';
import { SLOT1_START } from '../core/constants.js';

export function initPokeSearch({ readMemory, startWriteTrace, stopWriteTrace, showMessage, goToMemoryAddress, startWriteMonitor, stopWriteMonitor, disassembleAt, goToAddress }) {

    // DOM lookups
    const btnPokeSnap = document.getElementById('btnPokeSnap');
    const pokeSearchMode = document.getElementById('pokeSearchMode');
    const btnPokeSearch = document.getElementById('btnPokeSearch');
    const btnPokeReset = document.getElementById('btnPokeReset');
    const pokeStatus = document.getElementById('pokeStatus');
    const pokeResults = document.getElementById('pokeResults');
    const pokeSkipScreen = document.getElementById('pokeSkipScreen');
    const pokeFilterValue = document.getElementById('pokeFilterValue');
    const btnPokeFilter = document.getElementById('btnPokeFilter');
    const btnPokeTrace = document.getElementById('btnPokeTrace');
    const btnPokeTraceClear = document.getElementById('btnPokeTraceClear');

    // State
    let pokeSnapshot = null;  // Last snapshot for comparison
    let pokeSnapshots = [];   // All snapshots taken (each is Uint8Array of 64K)
    let pokeCandidates = null;  // Set of candidate addresses (null = all RAM)
    let pokeSnapCount = 0;  // Number of snapshots taken
    let pokeValueHistory = new Map();  // addr -> [val0, val1, ...] display history per candidate
    let pokePreFilterCandidates = null;  // Backup before filter
    let pokePreFilterHistory = null;     // Backup before filter
    let pokeBlacklist = null;        // Set<number> — addresses to exclude from search
    let pokeWriteTracing = false;

    // Write monitor DOM
    const writeMonAddrInput = document.getElementById('writeMonAddr');
    const btnWriteMon = document.getElementById('btnWriteMon');
    const writeMonStatus = document.getElementById('writeMonStatus');
    const writeMonResults = document.getElementById('writeMonResults');

    // Write monitor state
    let writeMonitoring = false;

    // Functions

    function updatePokeStatus() {
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
        if (pokeCandidates === null || pokeCandidates.size === 0) {
            pokeResults.innerHTML = '';
            return;
        }
        // Show first 100 candidates — values from snapshots only, not live memory
        const lastSnap = pokeSnapshots.length > 0 ? pokeSnapshots[pokeSnapshots.length - 1] : null;
        const addrs = [...pokeCandidates].slice(0, 100);
        let html = addrs.map(addr => {
            const val = lastSnap ? lastSnap[addr] : 0;
            const hist = pokeValueHistory.get(addr);
            const tip = hist ? hist.map(v => hex8(v)).join(' \u2192 ') : '';
            return `<span class="poke-result" data-addr="${addr}" title="${tip}"><span class="addr">${hex16(addr)}</span><span class="val">${hex8(val)}</span></span>`;
        }).join('');
        if (pokeCandidates.size > 100) {
            html += `<span class="poke-status">...and ${pokeCandidates.size - 100} more</span>`;
        }
        pokeResults.innerHTML = html;
    }

    // Event bindings

    btnPokeSnap.addEventListener('click', () => {
        if (!readMemory) return;
        pokeSnapshot = new Uint8Array(0x10000);
        for (let addr = 0; addr < 0x10000; addr++) {
            pokeSnapshot[addr] = readMemory(addr);
        }
        pokeSnapshots.push(pokeSnapshot);
        pokeSnapCount++;
        updatePokeStatus();
    });

    btnPokeSearch.addEventListener('click', () => {
        if (!readMemory || pokeSnapshots.length < 2) {
            showMessage('Need at least 2 snapshots', 'error');
            return;
        }

        const mode = pokeSearchMode.value;

        // Always scan all RAM — snapshot history provides the narrowing
        const skipScreen = pokeSkipScreen.checked;
        const startAddr = skipScreen ? 0x5C00 : SLOT1_START;

        const newCandidates = new Set();
        const newHistory = new Map();

        for (let addr = startAddr; addr < 0x10000; addr++) {
            if (pokeBlacklist && pokeBlacklist.has(addr)) continue;
            // Build value sequence from all snapshots
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

            // Validate ALL consecutive snap-to-snap pairs
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

    btnPokeFilter.addEventListener('click', () => {
        const valStr = pokeFilterValue.value.trim();

        // Empty value = undo filter
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

        // Save pre-filter state (only if not already filtered)
        if (!pokePreFilterCandidates) {
            pokePreFilterCandidates = new Set(pokeCandidates);
            pokePreFilterHistory = new Map(pokeValueHistory);
        }

        // Filter from pre-filter set using last snapshot (allows re-filtering with different value)
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
        // Restore full history then prune
        pokeValueHistory = new Map(pokePreFilterHistory);
        for (const addr of pokeValueHistory.keys()) {
            if (!filtered.has(addr)) pokeValueHistory.delete(addr);
        }
        showMessage(`${filtered.size} candidate(s) after filter`);
        updatePokeStatus();
        updatePokeResults();
    });

    btnPokeReset.addEventListener('click', () => {
        pokeSnapshot = null;
        pokeSnapshots = [];
        pokeCandidates = null;
        pokeValueHistory = new Map();
        pokePreFilterCandidates = null;
        pokePreFilterHistory = null;
        pokeSnapCount = 0;
        pokeResults.innerHTML = '';
        pokeFilterValue.value = '';
        updatePokeStatus();
    });

    btnPokeTrace.addEventListener('click', () => {
        const btn = btnPokeTrace;
        if (!pokeWriteTracing) {
            startWriteTrace();
            pokeWriteTracing = true;
            btn.textContent = 'Stop Trace';
            btn.classList.add('active');
        } else {
            const addrs = stopWriteTrace();
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
            btnPokeTraceClear.classList.toggle('hidden', !pokeBlacklist);
            updatePokeStatus();
        }
    });

    btnPokeTraceClear.addEventListener('click', () => {
        pokeBlacklist = null;
        btnPokeTraceClear.classList.add('hidden');
        updatePokeStatus();
        showMessage('Blacklist cleared');
    });

    pokeResults.addEventListener('click', (e) => {
        const resultEl = e.target.closest('.poke-result');
        if (resultEl) {
            const addr = parseInt(resultEl.dataset.addr);
            goToMemoryAddress(addr);
        }
    });

    // ========== Write Monitor ==========

    function parseMonAddr(str) {
        str = str.trim();
        if (!str) return -1;
        if (str.startsWith('$')) str = str.slice(1);
        else if (str.startsWith('0x') || str.startsWith('0X')) str = str.slice(2);
        return parseInt(str, 16);
    }

    function analyzeWriteMonitorHits(hits) {
        // Group by writing PC
        const groups = new Map();
        for (const hit of hits) {
            const key = hit.pc;
            if (!groups.has(key)) {
                groups.set(key, { pc: hit.pc, hits: [], callChains: [] });
            }
            groups.get(key).hits.push(hit);
        }

        // For each group, deduplicate call chains and collect value transitions
        for (const [, group] of groups) {
            // Value transitions
            group.transitions = group.hits.map(h => ({old: h.oldVal, new: h.newVal}));

            // Deduplicate call chains by stringifying
            const chainSet = new Set();
            for (const hit of group.hits) {
                const chainKey = hit.callStack.map(e => e.addr).join(',');
                if (!chainSet.has(chainKey)) {
                    chainSet.add(chainKey);
                    group.callChains.push(hit.callStack);
                }
            }
        }

        // Sort by frequency (most common first)
        return [...groups.values()].sort((a, b) => b.hits.length - a.hits.length);
    }

    function renderWriteMonitorResults(groups) {
        if (groups.length === 0) {
            writeMonResults.innerHTML = '<div style="color:var(--text-secondary);padding:4px">No writes detected</div>';
            return;
        }

        let html = '';
        for (const group of groups) {
            // Disassemble the writing instruction
            let instrText = '???';
            let instrLen = 1;
            try {
                const info = disassembleAt(group.pc);
                if (info) {
                    instrText = info.mnemonic || '???';
                    instrLen = info.length || 1;
                }
            } catch (e) { /* ignore */ }

            // Unique value transitions (deduplicate)
            const transSet = new Set();
            for (const t of group.transitions) {
                transSet.add(hex8(t.old) + '\u2192' + hex8(t.new));
            }
            const transStr = [...transSet].join(', ');

            html += '<div class="write-mon-entry">';
            // Line 1: instruction + values + count
            html += `<span class="wm-instr" data-addr="${group.pc}">$${hex16(group.pc)}: ${escapeHtml(instrText)}</span>`;
            html += `<span class="wm-vals">[${transStr}]</span>`;
            if (group.hits.length > 1) {
                html += `<span class="wm-count">\u00d7${group.hits.length}</span>`;
            }

            // Line 2: call chains (show up to 3 unique chains)
            const chainsToShow = group.callChains.slice(0, 3);
            for (const chain of chainsToShow) {
                if (chain.length > 0) {
                    let chainHtml = '\u2190 ';
                    const callers = [...chain].reverse(); // innermost first already, reverse for outer-to-inner display
                    chainHtml += callers.map(e => {
                        let label = `$${hex16(e.addr)}`;
                        if (e.isInt) label += '(INT)';
                        return `<span class="wm-addr" data-addr="${e.addr}">${label}</span>`;
                    }).join(' \u2190 ');
                    html += `<div class="wm-chain">${chainHtml}</div>`;
                }
            }

            // Line 3: NOP suggestion — find the CALL in the call chain that targets the writing subroutine
            if (group.callChains.length > 0) {
                const chain = group.callChains[0];
                if (chain.length > 0) {
                    // The last entry in the chain is the innermost caller
                    // The caller field tells us where the CALL instruction was
                    const innermost = chain[chain.length - 1];
                    // Try to disassemble the caller address to find the CALL instruction
                    let callerInstr = null;
                    let callerLen = 3;
                    try {
                        callerInstr = disassembleAt(innermost.caller);
                        if (callerInstr) callerLen = callerInstr.length || 3;
                    } catch (e) { /* ignore */ }
                    const callerMnemonic = callerInstr ? callerInstr.mnemonic : 'CALL ???';
                    html += `<div class="wm-nop">\u25b8 NOP ${callerLen} bytes at <span class="wm-addr" data-addr="${innermost.caller}">$${hex16(innermost.caller)}</span> (${escapeHtml(callerMnemonic)})</div>`;
                }
            }

            html += '</div>';
        }

        writeMonResults.innerHTML = html;
    }

    // Click handlers for addresses in write monitor results
    writeMonResults.addEventListener('click', (e) => {
        const addrEl = e.target.closest('[data-addr]');
        if (addrEl) {
            const addr = parseInt(addrEl.dataset.addr);
            goToAddress(addr);
        }
    });

    btnWriteMon.addEventListener('click', () => {
        if (!writeMonitoring) {
            // Start monitoring
            const addr = parseMonAddr(writeMonAddrInput.value);
            if (isNaN(addr) || addr < 0 || addr > 0xFFFF) {
                showMessage('Enter a valid address ($hex, 0xhex, or decimal)', 'error');
                return;
            }
            startWriteMonitor(addr);
            writeMonitoring = true;
            btnWriteMon.textContent = 'Stop';
            btnWriteMon.classList.add('active');
            writeMonStatus.textContent = `(watching $${hex16(addr)})`;
            writeMonResults.innerHTML = '';
        } else {
            // Stop monitoring
            const hits = stopWriteMonitor();
            writeMonitoring = false;
            btnWriteMon.textContent = 'Monitor';
            btnWriteMon.classList.remove('active');
            const groups = analyzeWriteMonitorHits(hits);
            writeMonStatus.textContent = `(${hits.length} write${hits.length !== 1 ? 's' : ''}, ${groups.length} source${groups.length !== 1 ? 's' : ''})`;
            renderWriteMonitorResults(groups);
        }
    });

    function stopWriteMonitorCleanup() {
        if (writeMonitoring) {
            stopWriteMonitor();
            writeMonitoring = false;
            btnWriteMon.textContent = 'Monitor';
            btnWriteMon.classList.remove('active');
            writeMonStatus.textContent = '';
            writeMonResults.innerHTML = '';
        }
    }

    // Public API
    return {
        stopTracing() {
            if (pokeWriteTracing) {
                stopWriteTrace();
                pokeWriteTracing = false;
                const btn = document.getElementById('btnPokeTrace');
                btn.textContent = 'Trace';
                btn.classList.remove('active');
            }
        },
        stopWriteMonitor() {
            stopWriteMonitorCleanup();
        }
    };
}
