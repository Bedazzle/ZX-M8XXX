// Disasm navigation — address controls, scroll, click handlers, export dialog

import { hex16 } from '../core/utils.js';

export function initDisasmNavigation({
    getSpectrum, getDisasm, downloadFile,
    labelManager, foldManager,
    getDisasmViewAddress, setDisasmViewAddress,
    getDisasmLastLineAddr,
    getRightPanelType,
    navPushHistory, navBack, navForward, getLeftHistory, updateNavButtons,
    goToAddress, goToMemoryAddress, goToRightDisasm, goToRightMemory,
    goToRightDisasmAddress,
    getRightDisasmViewAddress,
    generateAssemblyOutput,
    stepControlsAPI,
    updateDebugger, updateRightDisassemblyView,
    updateLabelsList,
    showMessage,
    DISASM_LINES, DISASM_PC_POSITION
}) {
    // DOM elements
    const disasmAddressInput = document.getElementById('disasmAddress');
    const disassemblyView = document.getElementById('disassemblyView');
    const btnDisasmPC = document.getElementById('btnDisasmPC');
    const btnDisasmPgUp = document.getElementById('btnDisasmPgUp');
    const btnDisasmPgDn = document.getElementById('btnDisasmPgDn');
    const disasmExportSelect = document.getElementById('disasmExportSelect');
    const chkShowTstates = document.getElementById('chkShowTstates');
    const chkFollowPC = document.getElementById('chkFollowPC');
    const labelDisplayMode = document.getElementById('labelDisplayMode');
    const labelSourceFilter = document.getElementById('labelSourceFilter');

    // Export dialog elements
    const exportDisasmDialog = document.getElementById('exportDisasmDialog');
    const exportStartAddr = document.getElementById('exportStartAddr');
    const exportEndAddr = document.getElementById('exportEndAddr');
    const exportWithOrg = document.getElementById('exportWithOrg');
    const exportWithAddr = document.getElementById('exportWithAddr');
    const exportWithBytes = document.getElementById('exportWithBytes');
    const exportWithTstates = document.getElementById('exportWithTstates');
    const btnExportCancel = document.getElementById('btnExportCancel');
    const btnExportSave = document.getElementById('btnExportSave');

    // Right panel elements
    const rightDisasmAddressInput = document.getElementById('rightDisasmAddress');
    const rightDisassemblyView = document.getElementById('rightDisassemblyView');

    // ---- Disasm address navigation ----

    function goToDisasmAddr(addr) {
        // If history is empty, save current view position first
        if (getLeftHistory().history.length === 0 && getDisasmViewAddress() !== null) {
            navPushHistory(getDisasmViewAddress());
        }
        navPushHistory(addr & 0xffff);
        setDisasmViewAddress(addr & 0xffff);
        updateDebugger();
    }

    disasmAddressInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const addr = parseInt(disasmAddressInput.value, 16);
            if (!isNaN(addr)) goToDisasmAddr(addr);
        }
    });

    btnDisasmPC.addEventListener('click', () => {
        setDisasmViewAddress(null); // Follow PC
        disasmAddressInput.value = '';
        updateDebugger();
    });

    // Keyboard shortcuts for navigation (Alt+Left/Right)
    // preventDefault even while Follow PC blocks navigation — otherwise the
    // browser's own Alt+Left/Right history navigation would leave the page
    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.key === 'ArrowLeft') {
            e.preventDefault();
            if (!chkFollowPC.checked) navBack();
        } else if (e.altKey && e.key === 'ArrowRight') {
            e.preventDefault();
            if (!chkFollowPC.checked) navForward();
        }
    });

    btnDisasmPgUp.addEventListener('click', () => navBack());
    btnDisasmPgDn.addEventListener('click', () => navForward());
    updateNavButtons();  // Initialize disabled state

    // While Follow PC is on, manual address navigation has no effect — disable it
    function updateFollowPCControls() {
        const follow = chkFollowPC.checked;
        disasmAddressInput.disabled = follow;
        btnDisasmPC.disabled = follow;
        updateNavButtons();  // ◀ ▶ also factor in Follow PC
    }
    chkFollowPC.addEventListener('change', updateFollowPCControls);
    updateFollowPCControls();

    // ---- View options popover (⚙) ----

    const btnViewOpts = document.getElementById('btnDisasmViewOpts');
    const viewOptsPopover = document.getElementById('disasmViewOptsPopover');
    btnViewOpts.addEventListener('click', (e) => {
        e.stopPropagation();
        viewOptsPopover.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!viewOptsPopover.classList.contains('hidden') &&
            !viewOptsPopover.contains(e.target) && e.target !== btnViewOpts) {
            viewOptsPopover.classList.add('hidden');
        }
    });
    // Re-render immediately on display option changes (persistence lives in display-settings.js)
    document.getElementById('chkFlowBreakSpacing')?.addEventListener('change', () => updateDebugger());
    document.getElementById('chkShowPCCursor')?.addEventListener('change', () => updateDebugger());

    // ---- Export visible ----

    function exportVisible() {
        const disasm = getDisasm();
        if (!disasm) return;
        const spectrum = getSpectrum();

        let startAddr = getDisasmViewAddress();
        if (startAddr === null && spectrum.cpu) {
            startAddr = disasm.findStartForPosition(spectrum.cpu.pc, DISASM_PC_POSITION, DISASM_LINES);
        }
        if (startAddr === null) startAddr = 0;

        const endAddr = (getDisasmLastLineAddr()) & 0xffff;

        const output = generateAssemblyOutput(startAddr, endAddr, {
            withOrg: true,
            withAddr: true,
            withBytes: false
        });

        downloadFile(`disasm_${hex16(startAddr)}_${hex16(endAddr)}.asm`, output);
        showMessage(`Exported ${hex16(startAddr)}-${hex16(endAddr)}`);
    }

    // ---- Export range dialog ----

    function openExportRangeDialog() {
        const spectrum = getSpectrum();
        let startAddr = getDisasmViewAddress();
        if (startAddr === null && spectrum.cpu) {
            startAddr = spectrum.cpu.pc;
        }
        if (startAddr === null) startAddr = 0;

        exportStartAddr.value = hex16(startAddr);
        exportEndAddr.value = hex16((startAddr + 0x100) & 0xffff);
        exportDisasmDialog.classList.remove('hidden');
        exportStartAddr.focus();
        exportStartAddr.select();
    }

    // Export dropdown: placeholder stays selected, actions dispatch on change
    disasmExportSelect.addEventListener('change', () => {
        const action = disasmExportSelect.value;
        disasmExportSelect.selectedIndex = 0; // Reset to "Export" placeholder
        if (action === 'visible') {
            exportVisible();
        } else if (action === 'range') {
            openExportRangeDialog();
        }
    });

    btnExportCancel.addEventListener('click', () => {
        exportDisasmDialog.classList.add('hidden');
    });

    btnExportSave.addEventListener('click', () => {
        const startAddr = parseInt(exportStartAddr.value, 16);
        const endAddr = parseInt(exportEndAddr.value, 16);

        if (isNaN(startAddr) || isNaN(endAddr)) {
            showMessage('Invalid address', 'error');
            return;
        }

        const output = generateAssemblyOutput(startAddr & 0xffff, endAddr & 0xffff, {
            withOrg: exportWithOrg.checked,
            withAddr: exportWithAddr.checked,
            withBytes: exportWithBytes.checked,
            withTstates: exportWithTstates.checked
        });

        downloadFile(`disasm_${hex16(startAddr)}_${hex16(endAddr)}.asm`, output);
        exportDisasmDialog.classList.add('hidden');
        showMessage(`Exported ${hex16(startAddr)}-${hex16(endAddr)}`);
    });

    // Close export dialog on Escape
    exportStartAddr.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') exportDisasmDialog.classList.add('hidden');
        if (e.key === 'Enter') exportEndAddr.focus();
    });
    exportEndAddr.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') exportDisasmDialog.classList.add('hidden');
        if (e.key === 'Enter') btnExportSave.click();
    });

    // ---- Scroll wheel for left disasm view ----

    disassemblyView.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (chkFollowPC.checked) return;  // View tracks PC — scrolling has no effect
        const disasm = getDisasm();
        if (!disasm) return;
        const spectrum = getSpectrum();

        const scrollLines = e.deltaY > 0 ? 3 : -3;

        let viewAddr = getDisasmViewAddress();
        if (viewAddr === null && spectrum.cpu) {
            viewAddr = spectrum.cpu.pc;
        }
        if (viewAddr !== null) {
            if (scrollLines > 0) {
                viewAddr = (viewAddr + scrollLines * 2) & 0xffff;
            } else {
                viewAddr = (viewAddr + scrollLines * 2) & 0xffff;
            }
            setDisasmViewAddress(viewAddr);
            disasmAddressInput.value = hex16(viewAddr);
            updateDebugger();
        }
    }, { passive: false });

    // ---- T-states and label display mode change ----

    chkShowTstates.addEventListener('change', () => {
        updateDebugger();
    });

    labelDisplayMode.addEventListener('change', () => {
        updateDebugger();
    });

    labelSourceFilter.addEventListener('change', () => {
        // Update showRomLabels for disasm label resolution
        labelManager.showRomLabels = (labelSourceFilter.value === 'all' || labelSourceFilter.value === 'rom');
        updateLabelsList();
        updateDebugger();
    });

    // ---- Left disasm click handler ----

    disassemblyView.addEventListener('click', (e) => {
        const spectrum = getSpectrum();

        // Check if clicking on fold toggle or fold summary
        const foldToggle = e.target.closest('.disasm-fold-toggle, .disasm-fold-summary');
        if (foldToggle) {
            const addr = parseInt(foldToggle.dataset.foldAddr, 10);
            if (!isNaN(addr)) {
                foldManager.toggle(addr);
                updateDebugger();
            }
            return;
        }

        // Check if clicking on breakpoint marker
        const bpMarker = e.target.closest('.disasm-bp');
        if (bpMarker) {
            const addr = parseInt(bpMarker.dataset.addr, 10);
            const isSet = spectrum.toggleBreakpoint(addr);
            showMessage(isSet ? `Breakpoint set at ${hex16(addr)}` : `Breakpoint removed at ${hex16(addr)}`);
            updateDebugger();
            return;
        }

        // Check if clicking on address column
        // Click = go to memory, Ctrl+Click = center disasm on that line
        const addrSpan = e.target.closest('.disasm-addr');
        if (addrSpan) {
            const line = addrSpan.closest('.disasm-line');
            if (line) {
                const addr = parseInt(line.dataset.addr, 10);
                if (e.ctrlKey) {
                    goToAddress(addr);
                    updateDebugger();
                    showMessage(`Disasm: ${hex16(addr)}`);
                } else {
                    goToMemoryAddress(addr);
                    showMessage(`Memory: ${hex16(addr)}`);
                }
            }
            return;
        }

        // Check if clicking on operand address (e.g., JP 4000h)
        // Click = go to disasm, Ctrl+Click = go to memory
        const operandAddr = e.target.closest('.disasm-operand-addr');
        if (operandAddr) {
            const addr = parseInt(operandAddr.dataset.addr, 10);
            if (e.ctrlKey) {
                goToMemoryAddress(addr);
                showMessage(`Memory: ${hex16(addr)}`);
            } else {
                goToAddress(addr);
                updateDebugger();
                showMessage(`Disasm: ${hex16(addr)}`);
            }
            return;
        }

        // Otherwise, set run target
        const line = e.target.closest('.disasm-line');
        if (line) {
            const target = parseInt(line.dataset.addr, 10);
            stepControlsAPI.setRunToTarget(target);
            // Highlight selected line
            disassemblyView.querySelectorAll('.disasm-line').forEach(el => {
                el.classList.remove('target');
            });
            line.classList.add('target');
            showMessage(`Run target: ${hex16(target)}`);
        }
    });

    // ---- T-state selection: drag across disasm lines to sum instruction timings ----

    const tselPopup = document.createElement('div');
    tselPopup.className = 'disasm-tsel-popup hidden';
    document.body.appendChild(tselPopup);

    function tselIsFlow(mn) {
        return mn.startsWith('JP') || mn.startsWith('JR') || mn.startsWith('CALL') ||
               mn.startsWith('RET') || mn.startsWith('DJNZ') || mn.startsWith('RST') ||
               mn === 'HALT';
    }

    function initTstateSelection(viewEl) {
        let startAddr = null;            // drag anchor
        let selA = null, selB = null;    // current selection endpoints (addresses)
        let selLines = [];

        function lineRange(addrA, addrB) {
            const lines = Array.from(viewEl.querySelectorAll('.disasm-line'));
            let i1 = lines.findIndex(l => parseInt(l.dataset.addr) === addrA);
            let i2 = lines.findIndex(l => parseInt(l.dataset.addr) === addrB);
            if (i1 < 0 || i2 < 0) return [];
            if (i1 > i2) [i1, i2] = [i2, i1];
            return lines.slice(i1, i2 + 1);
        }

        function applySel() {
            selLines.forEach(l => l.classList.remove('tsel'));
            selLines = selA !== null ? lineRange(selA, selB) : [];
            selLines.forEach(l => l.classList.add('tsel'));
        }

        function clearSel() {
            selA = selB = null;
            applySel();
            tselPopup.classList.add('hidden');
        }

        // The view re-renders frequently (even while paused) and replaces all line
        // elements; restore the selection highlight from the addresses each time.
        new MutationObserver(() => {
            if (selA !== null) applySel();
        }).observe(viewEl, { childList: true });

        // Literal branch target of JR/JR cc/DJNZ/JP/JP cc, or null
        function branchTarget(addr, bytes) {
            const op = bytes[0];
            if (op === 0x18 || op === 0x10 || (op & 0xE7) === 0x20) {  // JR, DJNZ, JR cc
                if (bytes.length < 2) return null;
                return (addr + 2 + ((bytes[1] << 24) >> 24)) & 0xffff;
            }
            if (op === 0xC3 || (op & 0xC7) === 0xC2) {  // JP nn, JP cc,nn
                if (bytes.length < 3) return null;
                return bytes[1] | (bytes[2] << 8);
            }
            return null;
        }

        const BLOCK_REPEATS = new Set(['LDIR', 'LDDR', 'CPIR', 'CPDR', 'INIR', 'INDR', 'OTIR', 'OTDR']);

        function showResult(e) {
            const disasm = getDisasm();
            if (!disasm || selLines.length < 2) return;
            let total = 0;
            let dual = null;   // [taken, not taken] totals for a conditional last instruction
            let msg = null;
            let bad = false;
            const firstAddr = parseInt(selLines[0].dataset.addr);
            const lastIdx = selLines.length - 1;
            const lastAddr = parseInt(selLines[lastIdx].dataset.addr);
            for (let i = 0; i < selLines.length; i++) {
                const l = selLines[i];
                const addr = parseInt(l.dataset.addr);
                if (isNaN(addr) || l.classList.contains('data-line')) { bad = true; break; }
                const instr = disasm.disassemble(addr);
                const timing = disasm.getTiming(instr.bytes);
                const mn = (instr.mnemonic || '').toUpperCase();
                const op = mn.split(/[\s,]+/)[0];
                if (timing === '?') { bad = true; break; }
                if (i < lastIdx) {
                    // Mid-selection: any flow control or conditional timing aborts
                    if (timing.includes('/') || tselIsFlow(mn)) {
                        msg = `${op} in selection — exact T-states depend on the execution path`;
                        break;
                    }
                    total += parseInt(timing);
                    continue;
                }
                // Last line: execution simply leaving the selection is fine (JP/JR/RET),
                // but CALL/RST return after a subroutine of unknown duration
                if (op === 'HALT' || BLOCK_REPEATS.has(op)) {
                    msg = `${op} at the end — repeat count unknown, cannot sum exactly`;
                    break;
                }
                if (op === 'CALL' || op === 'RST') {
                    msg = `${op} at the end — subroutine duration unknown, cannot sum exactly`;
                    break;
                }
                const target = branchTarget(addr, instr.bytes);
                if (target !== null && target >= firstAddr && target <= lastAddr) {
                    msg = `${op} loops back into the selection — T-states depend on the iteration count`;
                    break;
                }
                if (timing.includes('/')) {
                    const [tTaken, tNot] = timing.split('/').map(Number);
                    dual = [total + tTaken, total + tNot];
                } else {
                    total += parseInt(timing);
                }
            }
            tselPopup.textContent = bad
                ? 'Selection contains data — cannot sum T-states'
                : msg ? msg
                : dual
                    ? `${selLines.length} instructions = ${dual[0]} / ${dual[1]} T-states (branch taken / not taken)`
                    : `${selLines.length} instructions = ${total} T-states`;
            tselPopup.classList.remove('hidden');
            tselPopup.style.left = Math.max(4, Math.min(e.clientX + 12, window.innerWidth - 380)) + 'px';
            tselPopup.style.top = Math.min(e.clientY + 14, window.innerHeight - 40) + 'px';
        }

        viewEl.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            clearSel();
            const line = e.target.closest('.disasm-line');
            startAddr = line ? parseInt(line.dataset.addr) : null;
            if (isNaN(startAddr)) startAddr = null;
        });

        viewEl.addEventListener('mousemove', (e) => {
            if (startAddr === null) return;
            if (!(e.buttons & 1)) { startAddr = null; return; }
            const line = e.target.closest('.disasm-line');
            if (!line) return;
            const endAddr = parseInt(line.dataset.addr);
            if (isNaN(endAddr)) return;
            if (endAddr === startAddr && selA === null) return;  // not a drag yet
            selA = startAddr;
            selB = endAddr;
            applySel();
            viewEl.classList.add('tselecting');
            e.preventDefault();
        });

        document.addEventListener('mouseup', (e) => {
            viewEl.classList.remove('tselecting');
            if (startAddr === null) return;
            const dragged = selLines.length >= 2;
            startAddr = null;
            if (!dragged) return;
            // Swallow the click that follows the drag — it would set a run-to target
            document.addEventListener('click', (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
            }, { capture: true, once: true });
            showResult(e);
        });

        // Any interaction elsewhere dismisses the selection/popup
        document.addEventListener('mousedown', (e) => {
            if (!viewEl.contains(e.target)) clearSel();
        });
        document.addEventListener('wheel', () => {
            if (!tselPopup.classList.contains('hidden')) clearSel();
        }, { passive: true });
        document.addEventListener('keydown', () => {
            if (!tselPopup.classList.contains('hidden')) clearSel();
        });
    }

    const disassemblyViewEl = document.getElementById('disassemblyView');
    if (disassemblyViewEl) initTstateSelection(disassemblyViewEl);
    if (rightDisassemblyView) initTstateSelection(rightDisassemblyView);

    // ---- Right panel disasm controls ----

    rightDisasmAddressInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const addr = parseInt(rightDisasmAddressInput.value, 16);
            if (!isNaN(addr)) goToRightDisasmAddress(addr);
        }
    });
    document.getElementById('btnRightDisasmPC')?.addEventListener('click', () => {
        const spectrum = getSpectrum();
        if (spectrum.cpu) goToRightDisasmAddress(spectrum.cpu.pc);
    });
    document.getElementById('btnRightDisasmPgUp')?.addEventListener('click', () => {
        navBack('right');
    });
    document.getElementById('btnRightDisasmPgDn')?.addEventListener('click', () => {
        navForward('right');
    });

    // Scroll wheel for right disasm view
    rightDisassemblyView.addEventListener('wheel', (e) => {
        if (getRightPanelType() !== 'disasm') return;
        e.preventDefault();
        const scrollLines = e.deltaY > 0 ? 3 : -3;
        const rightAddr = getRightDisasmViewAddress();
        if (rightAddr !== null) {
            goToRightDisasmAddress(rightAddr + scrollLines * 3);
        }
    }, { passive: false });

    // Click handler for right disasm view
    rightDisassemblyView.addEventListener('click', (e) => {
        if (getRightPanelType() !== 'disasm') return;
        const spectrum = getSpectrum();

        // Check if clicking on fold toggle or fold summary
        const foldToggle = e.target.closest('.disasm-fold-toggle, .disasm-fold-summary');
        if (foldToggle) {
            const addr = parseInt(foldToggle.dataset.foldAddr, 10);
            if (!isNaN(addr)) {
                foldManager.toggle(addr);
                updateDebugger();
                updateRightDisassemblyView();
            }
            return;
        }

        // Check if clicking on breakpoint marker
        const bpMarker = e.target.closest('.disasm-bp');
        if (bpMarker) {
            const addr = parseInt(bpMarker.dataset.addr, 10);
            const isSet = spectrum.toggleBreakpoint(addr);
            showMessage(isSet ? `Breakpoint set at ${hex16(addr)}` : `Breakpoint removed at ${hex16(addr)}`);
            updateDebugger();
            updateRightDisassemblyView();
            return;
        }

        // Check if clicking on operand address (e.g., JP 4000h)
        // Click = go to disasm in right panel, Ctrl+Click = go to memory
        const operandAddr = e.target.closest('.disasm-operand-addr');
        if (operandAddr) {
            const addr = parseInt(operandAddr.dataset.addr, 10);
            if (e.ctrlKey) {
                goToRightMemory(addr);
                showMessage(`Memory: ${hex16(addr)}`);
            } else {
                goToRightDisasm(addr);
                showMessage(`Disasm: ${hex16(addr)}`);
            }
            return;
        }

        // Otherwise, set right run target
        const line = e.target.closest('.disasm-line');
        if (line) {
            const target = parseInt(line.dataset.addr, 10);
            stepControlsAPI.setRightRunToTarget(target);
            // Highlight selected line
            rightDisassemblyView.querySelectorAll('.disasm-line').forEach(el => {
                el.classList.remove('target');
            });
            line.classList.add('target');
            showMessage(`Run target: ${hex16(target)}`);
        }
    });

    return {};
}
