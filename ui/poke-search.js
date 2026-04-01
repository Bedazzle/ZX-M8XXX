// poke-search.js — POKE Search / Memory Scanner (extracted from index.html)
import { hex8, hex16, escapeHtml } from '../core/utils.js';
import { SLOT1_START } from '../core/constants.js';

export function initPokeSearch({ readMemory, startWriteTrace, stopWriteTrace, showMessage, goToMemoryAddress, startWriteMonitor, stopWriteMonitor, startReadMonitor, stopReadMonitor, disassembleAt, goToAddress, startComparisonBreakpoint, stopComparisonBreakpoint, startRegisterTracker, stopRegisterTracker }) {

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

    // Read monitor DOM
    const readMonAddrInput = document.getElementById('readMonAddr');
    const btnReadMon = document.getElementById('btnReadMon');
    const readMonStatus = document.getElementById('readMonStatus');
    const readMonResults = document.getElementById('readMonResults');

    // Read monitor state
    let readMonitoring = false;

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
        }
        writeMonStatus.textContent = '';
        writeMonResults.innerHTML = '';
    }

    // ========== Read Monitor ==========

    function analyzeReadMonitorHits(hits) {
        // Group by reading PC
        const groups = new Map();
        for (const hit of hits) {
            const key = hit.pc;
            if (!groups.has(key)) {
                groups.set(key, { pc: hit.pc, hits: [], callChains: [] });
            }
            groups.get(key).hits.push(hit);
        }

        // For each group, deduplicate call chains and collect unique values read
        for (const [, group] of groups) {
            group.values = new Set(group.hits.map(h => h.val));

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

    function renderReadMonitorResults(groups) {
        if (groups.length === 0) {
            readMonResults.innerHTML = '<div style="color:var(--text-secondary);padding:4px">No reads detected</div>';
            return;
        }

        let html = '';
        for (const group of groups) {
            // Disassemble the reading instruction
            let instrText = '???';
            let instrLen = 1;
            try {
                const info = disassembleAt(group.pc);
                if (info) {
                    instrText = info.mnemonic || '???';
                    instrLen = info.length || 1;
                }
            } catch (e) { /* ignore */ }

            // Unique values read
            const valsStr = [...group.values].map(v => hex8(v)).join(', ');

            html += '<div class="write-mon-entry">';
            // Line 1: instruction + values + count
            html += `<span class="wm-instr" data-addr="${group.pc}">$${hex16(group.pc)}: ${escapeHtml(instrText)}</span>`;
            html += `<span class="wm-vals">[${valsStr}]</span>`;
            if (group.hits.length > 1) {
                html += `<span class="wm-count">\u00d7${group.hits.length}</span>`;
            }

            // Context-after: disassemble 3 instructions after the reading instruction
            let contextPC = group.pc + instrLen;
            for (let i = 0; i < 3 && contextPC <= 0xFFFF; i++) {
                try {
                    const ctxInfo = disassembleAt(contextPC);
                    if (ctxInfo) {
                        const ctxText = ctxInfo.mnemonic || '???';
                        html += `<div class="wm-chain" style="opacity:0.7">\u25b8 <span class="wm-addr" data-addr="${contextPC}">$${hex16(contextPC)}</span>: ${escapeHtml(ctxText)}</div>`;
                        contextPC += ctxInfo.length || 1;
                    } else {
                        break;
                    }
                } catch (e) { break; }
            }

            // Call chains (show up to 3 unique chains)
            const chainsToShow = group.callChains.slice(0, 3);
            for (const chain of chainsToShow) {
                if (chain.length > 0) {
                    let chainHtml = '\u2190 ';
                    const callers = [...chain].reverse();
                    chainHtml += callers.map(e => {
                        let label = `$${hex16(e.addr)}`;
                        if (e.isInt) label += '(INT)';
                        return `<span class="wm-addr" data-addr="${e.addr}">${label}</span>`;
                    }).join(' \u2190 ');
                    html += `<div class="wm-chain">${chainHtml}</div>`;
                }
            }

            html += '</div>';
        }

        readMonResults.innerHTML = html;
    }

    // Click handlers for addresses in read monitor results
    readMonResults.addEventListener('click', (e) => {
        const addrEl = e.target.closest('[data-addr]');
        if (addrEl) {
            const addr = parseInt(addrEl.dataset.addr);
            goToAddress(addr);
        }
    });

    btnReadMon.addEventListener('click', () => {
        if (!readMonitoring) {
            // Start monitoring
            const addr = parseMonAddr(readMonAddrInput.value);
            if (isNaN(addr) || addr < 0 || addr > 0xFFFF) {
                showMessage('Enter a valid address ($hex, 0xhex, or decimal)', 'error');
                return;
            }
            startReadMonitor(addr);
            readMonitoring = true;
            btnReadMon.textContent = 'Stop';
            btnReadMon.classList.add('active');
            readMonStatus.textContent = `(watching $${hex16(addr)})`;
            readMonResults.innerHTML = '';
        } else {
            // Stop monitoring
            const hits = stopReadMonitor();
            readMonitoring = false;
            btnReadMon.textContent = 'Monitor';
            btnReadMon.classList.remove('active');
            const groups = analyzeReadMonitorHits(hits);
            readMonStatus.textContent = `(${hits.length} read${hits.length !== 1 ? 's' : ''}, ${groups.length} source${groups.length !== 1 ? 's' : ''})`;
            renderReadMonitorResultsWithSlice(groups);
        }
    });

    function stopReadMonitorCleanup() {
        if (readMonitoring) {
            stopReadMonitor();
            readMonitoring = false;
            btnReadMon.textContent = 'Monitor';
            btnReadMon.classList.remove('active');
        }
        readMonStatus.textContent = '';
        readMonResults.innerHTML = '';
    }

    // ========== Backward Slice (extends Read Monitor) ==========

    function getComparisonRegs(mnemonic) {
        // Extract register operand from CP/SUB/SBC/AND/OR/XOR instructions
        const m = mnemonic.toUpperCase().trim();
        const ops = ['CP', 'SUB', 'SBC', 'AND', 'OR', 'XOR'];
        for (const op of ops) {
            if (m.startsWith(op + ' ')) {
                const operand = m.slice(op.length).trim().replace(',', '').trim();
                // For SBC A,r → operand is "A,r", extract r
                const parts = operand.split(',').map(s => s.trim());
                const reg = parts[parts.length - 1];
                // Only return single register names (not memory refs or immediates)
                if (/^[A-Z]{1,2}$/.test(reg) && reg !== 'A') return [reg];
                if (/^\(HL\)$/.test(reg)) return ['H', 'L'];
            }
        }
        return [];
    }

    function writesRegister(mnemonic, reg) {
        const m = mnemonic.toUpperCase().trim();
        const r = reg.toUpperCase();
        // LD X,... — destination is the register
        if (m.startsWith('LD ')) {
            const dest = m.slice(3).split(',')[0].trim();
            if (dest === r) return true;
            // LD pair — writes both halves (BC→B,C etc.)
            if (dest === 'BC' && (r === 'B' || r === 'C')) return true;
            if (dest === 'DE' && (r === 'D' || r === 'E')) return true;
            if (dest === 'HL' && (r === 'H' || r === 'L')) return true;
        }
        // INC/DEC X
        if ((m.startsWith('INC ') || m.startsWith('DEC ')) && m.slice(4).trim() === r) return true;
        // POP pair
        if (m.startsWith('POP ')) {
            const pair = m.slice(4).trim();
            if (pair === 'AF' && (r === 'A' || r === 'F')) return true;
            if (pair === 'BC' && (r === 'B' || r === 'C')) return true;
            if (pair === 'DE' && (r === 'D' || r === 'E')) return true;
            if (pair === 'HL' && (r === 'H' || r === 'L')) return true;
        }
        // IN X,(C)
        if (m.startsWith('IN ') && m.includes('(C)') && m.slice(3).split(',')[0].trim() === r) return true;
        // EX DE,HL — writes D,E,H,L
        if (m === 'EX DE,HL' && (r === 'D' || r === 'E' || r === 'H' || r === 'L')) return true;
        // ADD/ADC/SUB/SBC/AND/OR/XOR/CP with A as implicit dest
        if (r === 'A') {
            for (const op of ['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'OR', 'XOR']) {
                if (m.startsWith(op + ' ')) return true;
            }
        }
        // RLC/RRC/RL/RR/SLA/SRA/SRL/BIT/SET/RES r
        for (const op of ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SRL', 'SET', 'RES']) {
            if (m.startsWith(op + ' ') && m.endsWith(r)) return true;
        }
        return false;
    }

    function findRegisterSource(pc, targetReg, maxScanBack) {
        if (!maxScanBack) maxScanBack = 32;
        // Disassemble forward from pc-maxScanBack to collect instructions
        let startAddr = Math.max(0, pc - maxScanBack);
        const instrs = [];
        let curAddr = startAddr;
        while (curAddr < pc) {
            try {
                const info = disassembleAt(curAddr);
                if (!info) break;
                instrs.push({ addr: curAddr, mnemonic: info.mnemonic, length: info.length });
                curAddr += info.length || 1;
            } catch (e) { break; }
        }
        // Walk backward to find last instruction that writes targetReg
        for (let i = instrs.length - 1; i >= 0; i--) {
            const instr = instrs[i];
            const m = instr.mnemonic.toUpperCase();
            // Stop at control flow
            if (/^(JP|JR|CALL|RET|RST|DJNZ|RETI|RETN)\b/.test(m)) break;
            if (writesRegister(instr.mnemonic, targetReg)) {
                return instr;
            }
        }
        return null;
    }

    // ========== Comparison Breakpoint ==========

    const cmpAddrA = document.getElementById('cmpAddrA');
    const cmpOp = document.getElementById('cmpOp');
    const cmpAddrB = document.getElementById('cmpAddrB');
    const btnCmpBreak = document.getElementById('btnCmpBreak');
    const cmpBreakStatus = document.getElementById('cmpBreakStatus');

    let cmpBreakActive = false;

    if (btnCmpBreak) {
        btnCmpBreak.addEventListener('click', () => {
            if (!cmpBreakActive) {
                const addrA = parseMonAddr(cmpAddrA.value);
                const addrB = parseMonAddr(cmpAddrB.value);
                if (isNaN(addrA) || addrA < 0 || addrA > 0xFFFF ||
                    isNaN(addrB) || addrB < 0 || addrB > 0xFFFF) {
                    showMessage('Enter valid addresses for both A and B', 'error');
                    return;
                }
                const op = cmpOp.value;
                startComparisonBreakpoint(addrA, addrB, op);
                cmpBreakActive = true;
                btnCmpBreak.textContent = 'Stop';
                btnCmpBreak.classList.add('active');
                cmpBreakStatus.textContent = `($${hex16(addrA)} ${op} $${hex16(addrB)})`;
            } else {
                stopComparisonBreakpoint();
                cmpBreakActive = false;
                btnCmpBreak.textContent = 'Break';
                btnCmpBreak.classList.remove('active');
                cmpBreakStatus.textContent = '';
            }
        });
    }

    function stopCmpBreakCleanup() {
        if (cmpBreakActive) {
            stopComparisonBreakpoint();
            cmpBreakActive = false;
            if (btnCmpBreak) {
                btnCmpBreak.textContent = 'Break';
                btnCmpBreak.classList.remove('active');
            }
        }
        if (cmpBreakStatus) cmpBreakStatus.textContent = '';
    }

    // ========== Register Tracker ==========

    const rtAddr = document.getElementById('rtAddr');
    const rtReg = document.getElementById('rtReg');
    const btnRtTrack = document.getElementById('btnRtTrack');
    const rtStatus = document.getElementById('rtStatus');
    const rtResults = document.getElementById('rtResults');

    let rtTracking = false;

    if (btnRtTrack) {
        btnRtTrack.addEventListener('click', () => {
            if (!rtTracking) {
                const pc = parseMonAddr(rtAddr.value);
                if (isNaN(pc) || pc < 0 || pc > 0xFFFF) {
                    showMessage('Enter a valid PC address', 'error');
                    return;
                }
                const reg = rtReg.value;
                startRegisterTracker(pc, reg);
                rtTracking = true;
                btnRtTrack.textContent = 'Stop';
                btnRtTrack.classList.add('active');
                rtStatus.textContent = `(tracking ${reg} at $${hex16(pc)})`;
                rtResults.innerHTML = '';
            } else {
                const values = stopRegisterTracker();
                rtTracking = false;
                btnRtTrack.textContent = 'Track';
                btnRtTrack.classList.remove('active');
                renderRegTrackerResults(values);
            }
        });
    }

    function renderRegTrackerResults(values) {
        if (!values || values.length === 0) {
            rtStatus.textContent = '(no samples)';
            rtResults.innerHTML = '<div style="color:var(--text-secondary);padding:4px">No hits — PC may not have been reached</div>';
            return;
        }

        // Build value distribution
        const dist = new Map();
        for (const v of values) {
            dist.set(v.value, (dist.get(v.value) || 0) + 1);
        }

        // Sort by count descending
        const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
        const maxCount = sorted[0][1];
        const isWide = values[0] && values[0].value > 0xFF; // 16-bit register

        // Summary
        const allVals = values.map(v => v.value);
        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        const mode = sorted[0][0];
        rtStatus.textContent = `(${values.length} samples, ${dist.size} unique, range: ${isWide ? hex16(min) : hex8(min)}-${isWide ? hex16(max) : hex8(max)}, mode: ${isWide ? hex16(mode) : hex8(mode)})`;

        // Histogram
        let html = '';
        const top = sorted.slice(0, 32);
        for (const [val, count] of top) {
            const pct = (count / maxCount * 100).toFixed(0);
            const valStr = isWide ? hex16(val) : hex8(val);
            html += `<div style="display:flex;align-items:center;gap:4px;padding:1px 2px">`;
            html += `<span style="width:${isWide ? 36 : 20}px;text-align:right;color:var(--cyan)">${valStr}</span>`;
            html += `<span style="flex:1;height:10px;background:var(--bg-tertiary);position:relative"><span style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:var(--cyan)"></span></span>`;
            html += `<span style="width:40px;text-align:right;font-size:10px">${count}</span>`;
            html += `</div>`;
        }
        if (sorted.length > 32) {
            html += `<div style="color:var(--text-secondary);padding:2px">...and ${sorted.length - 32} more values</div>`;
        }
        rtResults.innerHTML = html;
    }

    function stopRtTrackCleanup() {
        if (rtTracking) {
            stopRegisterTracker();
            rtTracking = false;
            if (btnRtTrack) {
                btnRtTrack.textContent = 'Track';
                btnRtTrack.classList.remove('active');
            }
        }
        if (rtStatus) rtStatus.textContent = '';
        if (rtResults) rtResults.innerHTML = '';
    }

    // ========== Enhanced Read Monitor with Backward Slice ==========

    // Override renderReadMonitorResults to include backward slice analysis
    const originalRenderReadMonitorResults = renderReadMonitorResults;

    function renderReadMonitorResultsWithSlice(groups) {
        if (groups.length === 0) {
            readMonResults.innerHTML = '<div style="color:var(--text-secondary);padding:4px">No reads detected</div>';
            return;
        }

        let html = '';
        for (const group of groups) {
            // Disassemble the reading instruction
            let instrText = '???';
            let instrLen = 1;
            try {
                const info = disassembleAt(group.pc);
                if (info) {
                    instrText = info.mnemonic || '???';
                    instrLen = info.length || 1;
                }
            } catch (e) { /* ignore */ }

            // Unique values read
            const valsStr = [...group.values].map(v => hex8(v)).join(', ');

            html += '<div class="write-mon-entry">';
            // Line 1: instruction + values + count
            html += `<span class="wm-instr" data-addr="${group.pc}">$${hex16(group.pc)}: ${escapeHtml(instrText)}</span>`;
            html += `<span class="wm-vals">[${valsStr}]</span>`;
            if (group.hits.length > 1) {
                html += `<span class="wm-count">\u00d7${group.hits.length}</span>`;
            }

            // Context-after: disassemble 3 instructions after the reading instruction
            let contextPC = group.pc + instrLen;
            const contextInstrs = [];
            for (let i = 0; i < 3 && contextPC <= 0xFFFF; i++) {
                try {
                    const ctxInfo = disassembleAt(contextPC);
                    if (ctxInfo) {
                        const ctxText = ctxInfo.mnemonic || '???';
                        contextInstrs.push({ addr: contextPC, mnemonic: ctxText, length: ctxInfo.length });
                        html += `<div class="wm-chain" style="opacity:0.7">\u25b8 <span class="wm-addr" data-addr="${contextPC}">$${hex16(contextPC)}</span>: ${escapeHtml(ctxText)}</div>`;
                        contextPC += ctxInfo.length || 1;
                    } else {
                        break;
                    }
                } catch (e) { break; }
            }

            // Backward slice: for each context instruction that's a comparison, find where the operand register was loaded
            for (const ctx of contextInstrs) {
                const regs = getComparisonRegs(ctx.mnemonic);
                for (const reg of regs) {
                    const source = findRegisterSource(ctx.addr, reg);
                    if (source) {
                        html += `<div class="wm-chain" style="color:var(--cyan);opacity:0.8">\u25c2 ${reg} from <span class="wm-addr" data-addr="${source.addr}">$${hex16(source.addr)}</span>: ${escapeHtml(source.mnemonic)}</div>`;
                    }
                }
            }

            // Call chains (show up to 3 unique chains)
            const chainsToShow = group.callChains.slice(0, 3);
            for (const chain of chainsToShow) {
                if (chain.length > 0) {
                    let chainHtml = '\u2190 ';
                    const callers = [...chain].reverse();
                    chainHtml += callers.map(e => {
                        let label = `$${hex16(e.addr)}`;
                        if (e.isInt) label += '(INT)';
                        return `<span class="wm-addr" data-addr="${e.addr}">${label}</span>`;
                    }).join(' \u2190 ');
                    html += `<div class="wm-chain">${chainHtml}</div>`;
                }
            }

            html += '</div>';
        }

        readMonResults.innerHTML = html;
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
        },
        stopReadMonitor() {
            stopReadMonitorCleanup();
        },
        stopComparisonBreakpoint() {
            stopCmpBreakCleanup();
        },
        stopRegisterTracker() {
            stopRtTrackCleanup();
        }
    };
}
