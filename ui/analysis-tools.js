// analysis-tools.js — Auto-map tracking, XRef controls, Code-Flow Analysis (extracted from index.html)

import { REGION_TYPES } from '../debug/managers.js';
import { hex16 } from '../core/utils.js';

export function initAnalysisTools({ getSpectrum, getDisasm, setExportSnapshot,
                                     regionManager, labelManager, xrefManager, subroutineManager,
                                     getDisasmViewAddress, showMessage, updateDebugger,
                                     getGenerateAssemblyOutput, downloadFile, appVersion }) {

    // DOM elements
    const chkAutoMap = document.getElementById('chkAutoMap');
    const btnAutoMapSnap = document.getElementById('btnAutoMapSnap');
    const btnAutoMapApply = document.getElementById('btnAutoMapApply');
    const btnAutoMapClear = document.getElementById('btnAutoMapClear');
    const btnAutoMapExport = document.getElementById('btnAutoMapExport');
    const autoMapStats = document.getElementById('autoMapStats');
    const btnCfaRun = document.getElementById('btnCfaRun');
    const chkCfaSkipRom = document.getElementById('chkCfaSkipRom');
    const chkCfaISR = document.getElementById('chkCfaISR');
    const cfaExtraEntries = document.getElementById('cfaExtraEntries');
    const btnCfaClear = document.getElementById('btnCfaClear');
    const cfaStatus = document.getElementById('cfaStatus');

    // XRef controls
    const btnXrefScan = document.getElementById('btnXrefScan');
    const btnXrefScanAll = document.getElementById('btnXrefScanAll');
    const btnXrefClear = document.getElementById('btnXrefClear');
    const chkXrefRuntime = document.getElementById('chkXrefRuntime');
    const xrefStats = document.getElementById('xrefStats');

    let xrefRuntimeEnabled = false;

    // ===== Auto-map handlers =====

    function updateAutoMapStats() {
        const spectrum = getSpectrum();
        const stats = spectrum.getAutoMapStats();
        if (stats.executed === 0 && stats.read === 0 && stats.written === 0) {
            autoMapStats.textContent = '';
            autoMapStats.classList.remove('active');
        } else {
            autoMapStats.textContent = `E:${stats.executed} R:${stats.read} W:${stats.written}`;
            autoMapStats.classList.add('active');
        }
    }

    chkAutoMap.addEventListener('change', () => {
        const spectrum = getSpectrum();
        spectrum.setAutoMapEnabled(chkAutoMap.checked);
        if (chkAutoMap.checked) {
            showMessage('Auto-map tracking enabled');
        }
    });

    btnAutoMapClear.addEventListener('click', () => {
        const spectrum = getSpectrum();
        spectrum.clearAutoMap();
        spectrum.pendingSnapCallback = null;  // Cancel any pending snap
        setExportSnapshot(null);  // Clear snap when clearing auto-map
        btnAutoMapSnap.style.background = '';  // Reset button style
        updateAutoMapStats();
        showMessage('Auto-map tracking cleared');
    });

    btnAutoMapExport.addEventListener('click', () => {
        const spectrum = getSpectrum();
        const autoMapData = spectrum.getAutoMapData();

        if (autoMapData.executed.size === 0 && autoMapData.read.size === 0 && autoMapData.written.size === 0) {
            showMessage('No auto-map data to export');
            return;
        }

        // Collect all active addresses (resolve banked keys to 16-bit addresses)
        const activeAddrs = new Set();
        for (const key of autoMapData.executed.keys()) {
            const addr = spectrum.parseAutoMapKey(key).addr;
            if (addr >= 0 && addr < 65536) activeAddrs.add(addr);
        }
        for (const key of autoMapData.read.keys()) {
            const addr = spectrum.parseAutoMapKey(key).addr;
            if (addr >= 0 && addr < 65536) activeAddrs.add(addr);
        }
        for (const key of autoMapData.written.keys()) {
            const addr = spectrum.parseAutoMapKey(key).addr;
            if (addr >= 0 && addr < 65536) activeAddrs.add(addr);
        }

        // Include addresses from marked regions
        for (const region of regionManager.getAll()) {
            for (let a = region.start; a <= region.end; a++) activeAddrs.add(a);
        }

        // Filter screen memory, sort
        const SCREEN_START = 0x4000, SCREEN_END = 0x5B00;
        const sorted = Array.from(activeAddrs)
            .filter(a => a < SCREEN_START || a >= SCREEN_END)
            .sort((a, b) => a - b);

        if (sorted.length === 0) {
            showMessage('No exportable addresses (only screen memory mapped)');
            return;
        }

        // Group into contiguous blocks (gap > 16 = new block)
        const blocks = [];
        let blockStart = sorted[0], blockEnd = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] > blockEnd + 16) {
                blocks.push({ start: blockStart, end: blockEnd });
                blockStart = sorted[i];
            }
            blockEnd = sorted[i];
        }
        blocks.push({ start: blockStart, end: blockEnd });

        // Build header
        const now = new Date();
        const datetime = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');

        let output = '; Auto-Map disassembly exported from ZX-M8XXX v' + appVersion + '\n';
        output += '; Date: ' + datetime + '\n';
        output += '; Auto-Map data: ' + autoMapData.executed.size + ' executed, ' +
                  autoMapData.read.size + ' read, ' + autoMapData.written.size + ' written\n';
        output += '; Blocks: ' + blocks.length + ' contiguous regions\n\n';

        // Generate disassembly for each block
        const genAsm = getGenerateAssemblyOutput();
        const options = { withOrg: true, withAddr: true, withBytes: false, withTstates: false, withHeader: false };
        for (const block of blocks) {
            output += genAsm(block.start, block.end, options);
            output += '\n';
        }

        // Download
        const filename = 'automap-' + datetime.replace(/[: ]/g, '-') + '.asm';
        downloadFile(filename, output);
        showMessage('Exported ' + blocks.length + ' block(s), ' + sorted.length + ' addresses');
    });

    btnAutoMapSnap.addEventListener('click', () => {
        const spectrum = getSpectrum();
        // Function to capture snapshot
        const captureSnapshot = () => {
            const cpu = spectrum.cpu;
            const paging = spectrum.memory.getPagingState();
            setExportSnapshot({
                cpu: {
                    a: cpu.a, f: cpu.f, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, h: cpu.h, l: cpu.l,
                    a_: cpu.a_, f_: cpu.f_, b_: cpu.b_, c_: cpu.c_, d_: cpu.d_, e_: cpu.e_, h_: cpu.h_, l_: cpu.l_,
                    ix: cpu.ix, iy: cpu.iy, sp: cpu.sp, pc: cpu.pc,
                    i: cpu.i, r: cpu.r, im: cpu.im, iff1: cpu.iff1, iff2: cpu.iff2
                },
                paging: {
                    ramBank: paging.ramBank,
                    romBank: paging.romBank,
                    screenBank: paging.screenBank,
                    pagingDisabled: paging.pagingDisabled
                },
                memory: spectrum.memory.getFullSnapshot(),
                border: spectrum.ula.borderColor,
                machineType: spectrum.machineType,
                timestamp: new Date().toISOString()
            });
            btnAutoMapSnap.style.background = 'var(--green)';
            const pcHex = hex16(cpu.pc);
            showMessage(`Snap captured at PC=$${pcHex} (frame boundary) - continue running to collect code paths, then Export`);
        };

        if (spectrum.isRunning()) {
            // Schedule snap at next frame boundary (safest state)
            spectrum.pendingSnapCallback = captureSnapshot;
            btnAutoMapSnap.style.background = 'var(--yellow)';  // Yellow = pending
            showMessage('Snap scheduled for next frame boundary...');
        } else {
            // Paused - capture immediately (already at instruction boundary)
            captureSnapshot();
        }
    });

    document.getElementById('btnClearRegions').addEventListener('click', () => {
        const count = regionManager.getAll().length;
        if (count === 0) {
            showMessage('No regions to clear');
            return;
        }
        regionManager.clear();
        updateDebugger();
        showMessage(`Cleared ${count} regions`);
    });

    // ===== XRef controls =====

    function updateXrefStats() {
        const count = xrefManager.getCount();
        if (count > 0) {
            xrefStats.textContent = `${count} refs`;
            xrefStats.classList.add('active');
        } else {
            xrefStats.textContent = '';
            xrefStats.classList.remove('active');
        }
    }

    btnXrefScan.addEventListener('click', () => {
        // Scan visible range (approximate 4KB from current disasm view)
        const startAddr = getDisasmViewAddress() || 0;
        const endAddr = (startAddr + 0x1000) & 0xffff;
        const count = xrefManager.scanRange(startAddr, endAddr);
        updateXrefStats();
        showMessage(`Scanned ${hex16(startAddr)}-${hex16(endAddr)}: ${count} refs found`);
    });

    btnXrefScanAll.addEventListener('click', async () => {
        btnXrefScanAll.disabled = true;
        btnXrefScanAll.textContent = 'Scanning...';
        try {
            const count = await xrefManager.scanRangeAsync(0x0000, 0xFFFF, (done, total, refs) => {
                const pct = Math.round((done / total) * 100);
                btnXrefScanAll.textContent = `${pct}%`;
            });
            updateXrefStats();
            showMessage(`Full scan: ${count} refs found`);
        } finally {
            btnXrefScanAll.disabled = false;
            btnXrefScanAll.textContent = 'Scan All';
        }
    });

    btnXrefClear.addEventListener('click', () => {
        xrefManager.clear();
        updateXrefStats();
        showMessage('XRefs cleared');
    });

    chkXrefRuntime.addEventListener('change', () => {
        const spectrum = getSpectrum();
        xrefRuntimeEnabled = chkXrefRuntime.checked;
        spectrum.xrefTrackingEnabled = xrefRuntimeEnabled;
        if (xrefRuntimeEnabled) {
            showMessage('XRef runtime tracking enabled');
        }
    });

    // Set up xref tracking callback
    getSpectrum().onInstructionExecuted = (pc) => {
        const disasm = getDisasm();
        if (!xrefRuntimeEnabled || !disasm) return;
        const instr = disasm.disassemble(pc, true);
        if (instr.refs) {
            for (const ref of instr.refs) {
                xrefManager.add(ref.target, pc, ref.type, null);
            }
        }
    };

    // ===== Auto-Map Apply =====

    btnAutoMapApply.addEventListener('click', () => {
        const spectrum = getSpectrum();
        const data = spectrum.getAutoMapData();
        if (data.executed.size === 0) {
            showMessage('No execution data to apply', 'error');
            return;
        }

        // Merge consecutive addresses into regions
        function mergeToRegions(addrMap, type) {
            // Parse all addresses and group by page
            const byPage = new Map(); // page -> sorted addresses
            for (const key of addrMap.keys()) {
                const { addr, page } = spectrum.parseAutoMapKey(key);
                const pageKey = page || '';
                if (!byPage.has(pageKey)) byPage.set(pageKey, []);
                byPage.get(pageKey).push(addr);
            }

            const regions = [];
            for (const [pageKey, addrs] of byPage) {
                addrs.sort((a, b) => a - b);
                let start = addrs[0];
                let end = addrs[0];

                for (let i = 1; i < addrs.length; i++) {
                    if (addrs[i] === end + 1) {
                        end = addrs[i];
                    } else {
                        // Gap - finish this region
                        regions.push({
                            start,
                            end,
                            type,
                            page: pageKey || null
                        });
                        start = addrs[i];
                        end = addrs[i];
                    }
                }
                // Add final region
                regions.push({
                    start,
                    end,
                    type,
                    page: pageKey || null
                });
            }
            return regions;
        }

        // Find SMC: addresses that are both executed AND written
        const smcAddrs = new Map();
        for (const [key, count] of data.executed) {
            if (data.written.has(key)) {
                smcAddrs.set(key, count);
            }
        }

        // Find CODE: addresses executed but NOT written (pure code)
        const codeAddrs = new Map();
        for (const [key, count] of data.executed) {
            if (!data.written.has(key)) {
                codeAddrs.set(key, count);
            }
        }

        // Find DATA: addresses read but NOT executed
        const dataAddrs = new Map();
        for (const [key, count] of data.read) {
            if (!data.executed.has(key)) {
                dataAddrs.set(key, count);
            }
        }

        // Generate regions
        const smcRegions = mergeToRegions(smcAddrs, REGION_TYPES.SMC);
        const codeRegions = mergeToRegions(codeAddrs, REGION_TYPES.CODE);
        const dataRegions = mergeToRegions(dataAddrs, REGION_TYPES.DB);

        // Apply to region manager (skip overlapping regions)
        let added = 0, skipped = 0;
        for (const region of smcRegions) {
            const result = regionManager.add(region);
            if (result.error) skipped++; else added++;
        }
        for (const region of codeRegions) {
            const result = regionManager.add(region);
            if (result.error) skipped++; else added++;
        }
        for (const region of dataRegions) {
            const result = regionManager.add(region);
            if (result.error) skipped++; else added++;
        }

        // Detect subroutines from CALL targets in executed code
        const subsDetected = subroutineManager.detectFromCode(data.executed);

        updateDebugger();
        const msg = `Applied ${added} regions` + (skipped ? `, skipped ${skipped} overlapping` : '') + (subsDetected ? `, ${subsDetected} subroutines` : '');
        showMessage(msg);
    });

    // ===== Code-flow analysis handlers =====

    btnCfaRun.addEventListener('click', async () => {
        const spectrum = getSpectrum();
        // Collect entry points
        const entries = new Set();

        // Current PC
        entries.add(spectrum.cpu.pc & 0xFFFF);

        // ISR handler at $0038
        if (chkCfaISR.checked) {
            entries.add(0x0038);
        }

        // All existing subroutine entries
        const subs = subroutineManager.getAll();
        for (const sub of subs) {
            entries.add(sub.address & 0xFFFF);
        }

        // Extra entry points from text input
        const extraText = cfaExtraEntries.value.trim();
        if (extraText) {
            for (const part of extraText.split(',')) {
                const addr = parseInt(part.trim(), 16);
                if (!isNaN(addr)) {
                    entries.add(addr & 0xFFFF);
                }
            }
        }

        // All label addresses
        const labels = labelManager.getAll();
        for (const lbl of labels) {
            entries.add(lbl.address & 0xFFFF);
        }

        const skipRom = chkCfaSkipRom.checked;

        // Build isDataRegion callback
        const isDataRegion = addr => regionManager.isData(addr);

        // Disable button, show progress
        btnCfaRun.disabled = true;
        cfaStatus.textContent = 'Analyzing...';

        try {
            const result = await spectrum.analyzeCodeFlow({
                entryPoints: Array.from(entries),
                skipRom: skipRom,
                isDataRegion: isDataRegion,
                onProgress: (processed, queued) => {
                    cfaStatus.textContent = `Analyzing... ${processed} instructions, ${queued} queued`;
                },
                maxInstructions: 100000
            });

            // Convert codeAddresses to sorted array and merge consecutive into regions
            const sortedAddrs = Array.from(result.codeAddresses).sort((a, b) => a - b);
            const regions = [];
            let i = 0;
            while (i < sortedAddrs.length) {
                const start = sortedAddrs[i];
                let end = start;
                while (i + 1 < sortedAddrs.length && sortedAddrs[i + 1] === end + 1) {
                    i++;
                    end = sortedAddrs[i];
                }
                regions.push({ start: start, end: end, type: REGION_TYPES.CODE });
                i++;
            }

            // Apply regions (skip overlaps)
            let added = 0, skipped = 0;
            for (const region of regions) {
                const res = regionManager.add(region);
                if (res.error) skipped++; else added++;
            }

            // Add subroutine entries
            let subsAdded = 0;
            for (const target of result.callTargets) {
                subroutineManager.add(target, null, null, true);
                subsAdded++;
            }

            // Add xrefs
            for (const xref of result.xrefs) {
                xrefManager.add(xref.target, xref.from, xref.type);
            }

            updateDebugger();

            // Log warnings
            for (const w of result.warnings) {
                console.warn('[CFA]', w);
            }

            const msg = `Flow: ${added} regions, ${subsAdded} subs, ${result.xrefs.length} xrefs` +
                (skipped ? `, ${skipped} overlaps skipped` : '') +
                (result.indirectJumps.length ? `, ${result.indirectJumps.length} indirect jumps` : '');
            cfaStatus.textContent = msg;
            showMessage(msg);
        } catch (err) {
            cfaStatus.textContent = 'Error: ' + err.message;
            console.error('[CFA]', err);
        } finally {
            btnCfaRun.disabled = false;
        }
    });

    btnCfaClear.addEventListener('click', () => {
        cfaStatus.textContent = '';
    });

    // Update auto-map stats periodically
    const autoMapStatsInterval = setInterval(updateAutoMapStats, 1000);

    return {
        updateAutoMapStats,
        updateXrefStats,
        setXrefRuntimeEnabled: (enabled) => {
            xrefRuntimeEnabled = enabled;
            chkXrefRuntime.checked = enabled;
        },
        setAutoMapEnabled: (enabled) => {
            chkAutoMap.checked = enabled;
        },
        destroy() {
            clearInterval(autoMapStatsInterval);
        }
    };
}
