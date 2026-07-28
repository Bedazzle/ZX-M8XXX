// profiler-ui.js — Runtime Behavior Profiler UI (extracted from index.html)

import { REGION_TYPES } from '../debug/managers.js';
import { hex16 } from '../core/utils.js';
import {
    generateProfilerLabels as analysisLabels,
    analyzeHotspots as analysisHotspots,
    generateHotspotLabels as analysisHotspotLabels,
} from '../tools/profiler-analysis.js';

export function initProfilerUI({
    readMemory, getMemoryInfo, getProfiler, startProfiling, stopProfiling,
    isRunning, startEmulator, getOnFrame, setOnFrame,
    labelManager, regionManager,
    navigateToAddress, goToAddress, updateLabelsList, updateDebugger, showMessage,
    callGraphAPI
}) {

    // DOM lookups
    const btnProfileRun = document.getElementById('btnProfileRun');
    const btnProfileStop = document.getElementById('btnProfileStop');
    const btnProfileClear = document.getElementById('btnProfileClear');
    const profileFrameCount = document.getElementById('profileFrameCount');
    const profileStatus = document.getElementById('profileStatus');

    // ========== Label generation ==========

    // Analysis lives in tools/profiler-analysis.js (shared with profile-game.html);
    // these wrappers supply the memory access and the "include ROM" checkbox.
    function includeRomChecked() {
        const chk = document.getElementById('chkProfileROM');
        return chk ? chk.checked : false;
    }

    function generateProfilerLabels(results) {
        return analysisLabels(results, {
            readByte: readMemory, getMemoryInfo, includeRom: includeRomChecked()
        });
    }

    function analyzeHotspots(results) {
        return analysisHotspots(results, { readByte: readMemory, includeRom: includeRomChecked() });
    }

    function generateHotspotLabels(hotspots) {
        return analysisHotspotLabels(hotspots, { includeRom: includeRomChecked() });
    }


    function displayHotspotResults(hotspots) {
        const container = document.getElementById('hotspotResults');
        if (!container) return;
        container.innerHTML = '';
        container.classList.remove('hidden');
        const header = document.createElement('div');
        header.style.cssText = 'color:var(--cyan);margin-bottom:2px';
        header.textContent = `Hotspots (${hotspots.length}):`;
        container.appendChild(header);
        const top = hotspots.slice(0, 10);
        for (const hs of top) {
            const row = document.createElement('div');
            row.style.cssText = 'cursor:pointer;padding:1px 4px;font-family:monospace';
            row.className = 'hover-highlight';
            const addrHex = hex16(hs.startAddr);
            const size = hs.endAddr - hs.startAddr + 1;
            row.textContent = `${hs.percentage.padStart(5)}%  $${addrHex}  ${hs.classification}  (${size}B)`;
            row.addEventListener('click', () => goToAddress(hs.startAddr));
            container.appendChild(row);
        }
    }

    // ========== Apply labels ==========

    function applyProfilerLabels(labels, im2Info) {
        let added = 0, replaced = 0, skipped = 0;
        labelManager.autoSaveEnabled = false;

        for (const label of labels) {
            const existing = labelManager.get(label.address, label.page);
            if (existing) {
                // Only replace auto-generated labels (sub_XXXX, loc_XXXX) or previous profiler labels
                if (/^(sub_|loc_)[0-9a-fA-F]{4}$/.test(existing.name) || existing.source === 'profiler') {
                    labelManager.add({ address: label.address, page: label.page, name: label.name, source: 'profiler' });
                    replaced++;
                } else {
                    skipped++;
                }
            } else {
                labelManager.add({ address: label.address, page: label.page, name: label.name, source: 'profiler' });
                added++;
            }
        }

        // IM 2: mark vector table as data region (257 bytes of word pointers)
        if (im2Info && im2Info.vectorTableAddr >= 0x4000) {
            const vtEnd = (im2Info.vectorTableAddr + 256) & 0xFFFF;
            regionManager.add({
                start: im2Info.vectorTableAddr,
                end: vtEnd,
                type: REGION_TYPES.DW,
                comment: 'IM 2 vector table (I=' + im2Info.iReg.toString(16).toUpperCase() + 'h)'
            });
        }

        labelManager.autoSaveEnabled = true;
        labelManager._autoSave();
        updateLabelsList();
        return { added, replaced, skipped };
    }

    // ========== Subroutine Signatures ==========

    function formatRegSignature(stats) {
        if ((!stats.regInputs || stats.regInputs.size === 0) &&
            (!stats.regOutputs || stats.regOutputs.size === 0)) return '';
        const inStr = stats.regInputs && stats.regInputs.size > 0
            ? [...stats.regInputs].filter(r => r !== 'F').join(', ') : '';
        const outStr = stats.regOutputs && stats.regOutputs.size > 0
            ? [...stats.regOutputs].filter(r => r !== 'F').join(', ') : '';
        // Include CF (carry flag) in output if F is in outputs
        const hasCarryOut = stats.regOutputs && stats.regOutputs.has('F');
        const outParts = [];
        if (outStr) outParts.push(outStr);
        if (hasCarryOut) outParts.push('CF');
        const parts = [];
        if (inStr) parts.push('in: ' + inStr);
        if (outParts.length > 0) parts.push('out: ' + outParts.join(', '));
        return parts.join(' \u2192 ');
    }

    function displaySignatureResults(results) {
        const container = document.getElementById('sigResults');
        if (!container) return;
        container.innerHTML = '';
        container.classList.remove('hidden');

        const chkProfileROM = document.getElementById('chkProfileROM');
        const includeRom = chkProfileROM ? chkProfileROM.checked : false;

        // Collect subroutines with signatures
        const subs = [];
        for (const [key, stats] of results.subroutines) {
            if (!includeRom && stats.entryAddr < 0x4000) continue;
            if ((!stats.regInputs || stats.regInputs.size === 0) &&
                (!stats.regOutputs || stats.regOutputs.size === 0)) continue;
            const sig = formatRegSignature(stats);
            if (!sig) continue;
            // Get label if available
            const label = labelManager.get(stats.entryAddr, stats.page);
            const name = label ? label.name : `sub_${hex16(stats.entryAddr)}`;
            subs.push({ addr: stats.entryAddr, name, sig, callCount: stats.callCount });
        }

        if (subs.length === 0) {
            container.classList.add('hidden');
            return;
        }

        // Sort by call count descending
        subs.sort((a, b) => b.callCount - a.callCount);

        const header = document.createElement('div');
        header.style.cssText = 'color:var(--cyan);margin-bottom:2px';
        header.textContent = `Signatures (${subs.length}):`;
        container.appendChild(header);

        const top = subs.slice(0, 20);
        for (const sub of top) {
            const row = document.createElement('div');
            row.style.cssText = 'cursor:pointer;padding:1px 4px;font-family:monospace;font-size:11px';
            row.className = 'hover-highlight';
            const addrSpan = document.createElement('span');
            addrSpan.textContent = `$${hex16(sub.addr)} `;
            addrSpan.style.color = 'var(--cyan)';
            row.appendChild(addrSpan);
            const nameSpan = document.createElement('span');
            nameSpan.textContent = sub.name + '  ';
            row.appendChild(nameSpan);
            const sigSpan = document.createElement('span');
            sigSpan.textContent = sub.sig;
            sigSpan.style.color = 'var(--text-secondary)';
            row.appendChild(sigSpan);
            row.addEventListener('click', () => goToAddress(sub.addr));
            container.appendChild(row);
        }
    }

    // ========== Event bindings ==========

    let profileSavedOnFrame = null;

    btnProfileRun.addEventListener('click', () => {
        const frames = parseInt(profileFrameCount.value) || 200;
        if (frames < 10 || frames > 5000) {
            showMessage('Frame count must be between 10 and 5000');
            return;
        }

        // Save and override onFrame for progress
        profileSavedOnFrame = getOnFrame();

        const profiler = getProfiler();
        profiler.onComplete = (results) => {
            // Restore onFrame
            setOnFrame(profileSavedOnFrame);
            profileSavedOnFrame = null;

            btnProfileRun.disabled = false;
            btnProfileStop.disabled = true;

            // Clear previous hotspot and signature results
            const hotspotContainer = document.getElementById('hotspotResults');
            if (hotspotContainer) { hotspotContainer.innerHTML = ''; hotspotContainer.classList.add('hidden'); }
            const sigContainer = document.getElementById('sigResults');
            if (sigContainer) { sigContainer.innerHTML = ''; sigContainer.classList.add('hidden'); }

            const labels = generateProfilerLabels(results);
            const hotspots = analyzeHotspots(results);
            const hotspotLabels = generateHotspotLabels(hotspots);
            const allLabels = [...labels, ...hotspotLabels];

            if (allLabels.length === 0) {
                profileStatus.textContent = `${results.framesProfiled} frames, ${results.subroutines.size} subs — no labels generated`;
                profileStatus.classList.add('active');
                showMessage('Profiling complete — no subroutines matched labeling rules');
                displaySignatureResults(results);
                if (callGraphAPI) callGraphAPI.renderGraph(results);
                updateDebugger();
                return;
            }

            const stats = applyProfilerLabels(allLabels, results.im2);
            const im2Note = results.im2 ? `, IM2@${results.im2.handlerAddr.toString(16).toUpperCase()}` : '';
            const hsNote = hotspots.length > 0 ? `, ${hotspots.length} hotspot${hotspots.length > 1 ? 's' : ''}` : '';
            profileStatus.textContent = `${results.framesProfiled}f, ${results.subroutines.size} subs → ${stats.added} new, ${stats.replaced} replaced, ${stats.skipped} kept${im2Note}${hsNote}`;
            profileStatus.classList.add('active');
            showMessage(`Profiler: ${stats.added} labels added, ${stats.replaced} replaced, ${stats.skipped} user labels kept`);

            if (hotspots.length > 0) displayHotspotResults(hotspots);
            displaySignatureResults(results);
            if (callGraphAPI) callGraphAPI.renderGraph(results);
            updateDebugger();
        };

        startProfiling(frames);

        setOnFrame((fc) => {
            const done = frames - getProfiler().framesRemaining;
            profileStatus.textContent = `${done}/${frames}`;
            profileStatus.classList.add('active');
            if (profileSavedOnFrame) profileSavedOnFrame(fc);
        });

        btnProfileRun.disabled = true;
        btnProfileStop.disabled = false;
        profileStatus.textContent = '0/' + frames;
        profileStatus.classList.add('active');

        // Start emulator if paused
        if (!isRunning()) {
            startEmulator();
        }
    });

    btnProfileStop.addEventListener('click', () => {
        stopProfiling();
    });

    function clearResults() {
        // Stop profiler if running
        const profiler = getProfiler();
        if (profiler && profiler.enabled) {
            stopProfiling();
            // Restore onFrame if we saved it
            if (profileSavedOnFrame !== null) {
                setOnFrame(profileSavedOnFrame);
                profileSavedOnFrame = null;
            }
            btnProfileRun.disabled = false;
            btnProfileStop.disabled = true;
        }
        // Clear results display
        const hotspotContainer = document.getElementById('hotspotResults');
        if (hotspotContainer) { hotspotContainer.innerHTML = ''; hotspotContainer.classList.add('hidden'); }
        const sigContainer = document.getElementById('sigResults');
        if (sigContainer) { sigContainer.innerHTML = ''; sigContainer.classList.add('hidden'); }
        profileStatus.textContent = '';
        profileStatus.classList.remove('active');
        // Disable call graph button and hide dialog if open
        const btnCallGraph = document.getElementById('btnCallGraph');
        if (btnCallGraph) btnCallGraph.disabled = true;
        const callGraphDialog = document.getElementById('callGraphDialog');
        if (callGraphDialog) callGraphDialog.classList.add('hidden');
    }

    btnProfileClear.addEventListener('click', () => {
        // Collect profiler-sourced labels
        const profilerLabels = labelManager.getAll().filter(l => l.source === 'profiler');
        const hasResults = profileStatus.textContent !== '';

        if (profilerLabels.length === 0 && !hasResults) {
            showMessage('Nothing to clear');
            return;
        }

        // Remove profiler labels
        labelManager.autoSaveEnabled = false;
        for (const l of profilerLabels) {
            labelManager.remove(l.address, l.page);
        }
        labelManager.autoSaveEnabled = true;
        if (profilerLabels.length > 0) labelManager._autoSave();

        // Remove IM 2 vector table region if profiler-created
        const im2Region = regionManager.getAll().find(r =>
            r.comment && r.comment.startsWith('IM 2 vector table')
        );
        if (im2Region) regionManager.remove(im2Region.start, im2Region.page);

        // Clear results display and stop profiler if running
        clearResults();

        updateLabelsList();
        updateDebugger();
        showMessage(`Cleared ${profilerLabels.length} profiler label(s)`);
    });

    return { clearResults };
}
