// Debugger display — register rendering + disassembly view + sub-panel dispatch
// Extracted from index.html

import { hex8, hex16, escapeHtml } from '../core/utils.js';
import { REGION_TYPES } from '../debug/managers.js';

export function initDebuggerDisplay({
    getSpectrum, getDisasm, setDisasm,
    DisassemblerClass,
    regEditorAPI, traceManager,
    regionManager, commentManager, subroutineManager, foldManager, labelManager,
    xrefManager,
    getCurrentPage, formatAddrColumn, replaceMnemonicAddresses,
    formatMnemonic, isFlowBreak, disassembleWithFolding,
    getDisasmViewAddress, setDisasmViewAddress,
    getDisasmLastLineAddr, setDisasmLastLineAddr,
    getTraceViewAddress, getLeftPanelType, getRightPanelType,
    getLabelDisplayMode, getShowTstates,
    DISASM_LINES, DISASM_PC_POSITION,
    // Sub-update callbacks
    updateBreakpointList, updateWatchpointList, updatePortBreakpointList,
    updateLabelsList, updateLeftMemoryView, updateMemoryView,
    updateRightDisassemblyView, updateStackView, updateCallStack,
    getUpdateTraceStatus, getUpdateTraceList, getUpdateWatchValues
}) {
    // DOM elements
    const mainRegisters = document.getElementById('mainRegisters');
    const altRegisters = document.getElementById('altRegisters');
    const ixiyRegisters = document.getElementById('ixiyRegisters');
    const indexRegisters = document.getElementById('indexRegisters');
    const flagsDisplay = document.getElementById('flagsDisplay');
    const statusRegisters = document.getElementById('statusRegisters');
    const regRItem = document.getElementById('regRItem');
    const pagesGroup = document.getElementById('pagesGroup');
    const pagesInfo = document.getElementById('pagesInfo');
    const disassemblyView = document.getElementById('disassemblyView');
    const chkFollowPC = document.getElementById('chkFollowPC');
    const chkFlowBreakSpacing = document.getElementById('chkFlowBreakSpacing');
    const chkShowPCCursor = document.getElementById('chkShowPCCursor');

    function createRegisterItem(name, value, editable = null, bits = 16) {
        const editClass = editable ? ' editable' : '';
        const dataAttr = editable ? ` data-reg="${editable}" data-bits="${bits}"` : '';
        const nameTitle = bits === 16 ? ' title="Double-click to add watch"' : '';
        return `<div class="register-item"><span class="register-name"${nameTitle}>${name}</span><br><span class="register-value${editClass}"${dataAttr}>${value}</span></div>`;
    }

    function renderDebugger() {
        const spectrum = getSpectrum();
        if (!spectrum.cpu) return;
        if (regEditorAPI.isEditingRegister()) return; // Don't update while editing
        const cpu = spectrum.cpu;

        // Check if viewing trace history
        const tracePos = traceManager.getCurrentPosition();
        const traceEntry = tracePos >= 0 ? traceManager.getEntry(tracePos) : null;

        // Use trace entry values if viewing history, otherwise use current CPU state
        const regAF = traceEntry ? traceEntry.af : cpu.af;
        const regBC = traceEntry ? traceEntry.bc : cpu.bc;
        const regDE = traceEntry ? traceEntry.de : cpu.de;
        const regHL = traceEntry ? traceEntry.hl : cpu.hl;
        const regIX = traceEntry ? traceEntry.ix : cpu.ix;
        const regIY = traceEntry ? traceEntry.iy : cpu.iy;
        const regSP = traceEntry ? traceEntry.sp : cpu.sp;
        const regPC = traceEntry ? traceEntry.pc : cpu.pc;
        const regI = traceEntry ? traceEntry.i : cpu.i;
        const regR = traceEntry ? traceEntry.r : cpu.rFull;
        const regIM = traceEntry ? traceEntry.im : cpu.im;
        const regIFF1 = traceEntry ? traceEntry.iff1 : cpu.iff1;
        const regIFF2 = traceEntry ? traceEntry.iff2 : cpu.iff2;
        const regTstates = traceEntry ? traceEntry.tStates : cpu.tStates;
        const regAF_ = traceEntry ? traceEntry.af_ : (cpu.a_ << 8) | cpu.f_;
        const regBC_ = traceEntry ? traceEntry.bc_ : (cpu.b_ << 8) | cpu.c_;
        const regDE_ = traceEntry ? traceEntry.de_ : (cpu.d_ << 8) | cpu.e_;
        const regHL_ = traceEntry ? traceEntry.hl_ : (cpu.h_ << 8) | cpu.l_;

        // Main registers (editable when not viewing trace history)
        const canEdit = !traceEntry;
        mainRegisters.innerHTML =
            createRegisterItem('AF', hex16(regAF), canEdit ? 'af' : null) +
            createRegisterItem('BC', hex16(regBC), canEdit ? 'bc' : null) +
            createRegisterItem('DE', hex16(regDE), canEdit ? 'de' : null) +
            createRegisterItem('HL', hex16(regHL), canEdit ? 'hl' : null);

        // Alternate registers
        altRegisters.innerHTML =
            createRegisterItem("AF'", hex16(regAF_), canEdit ? 'af_' : null) +
            createRegisterItem("BC'", hex16(regBC_), canEdit ? 'bc_' : null) +
            createRegisterItem("DE'", hex16(regDE_), canEdit ? 'de_' : null) +
            createRegisterItem("HL'", hex16(regHL_), canEdit ? 'hl_' : null);

        // IX, IY and swap buttons in same row
        ixiyRegisters.innerHTML =
            createRegisterItem('IX', hex16(regIX), canEdit ? 'ix' : null) +
            createRegisterItem('IY', hex16(regIY), canEdit ? 'iy' : null) +
            `<button class="reg-swap-btn" id="btnEXA" title="EX AF,AF'">exa</button>` +
            `<button class="reg-swap-btn" id="btnEXX" title="EXX">exx</button>`;

        // Index registers: SP, PC, I, IM, IFF
        indexRegisters.innerHTML =
            createRegisterItem('SP', hex16(regSP), canEdit ? 'sp' : null) +
            createRegisterItem('PC', hex16(regPC), canEdit ? 'pc' : null) +
            createRegisterItem('I', hex8(regI), canEdit ? 'i' : null, 8) +
            createRegisterItem('IM', regIM.toString(), canEdit ? 'im' : null, 2) +
            createRegisterItem('IFF', (regIFF1 ? '1' : '0') + '/' + (regIFF2 ? '1' : '0'), canEdit ? 'iff' : null, 2);

        // Timing registers: T-st, ΔT
        const bpT = spectrum.breakpointTStates;
        const bpTStr = bpT > 0 ? bpT.toLocaleString() : '0';
        statusRegisters.innerHTML =
            createRegisterItem('T-st', regTstates.toString(), canEdit ? 'tstates' : null, 17) +
            createRegisterItem('ΔT', bpTStr, null, 0);

        // R register (on flags row)
        const rEditClass = canEdit ? ' editable' : '';
        const rDataAttr = canEdit ? ' data-reg="r" data-bits="8"' : '';
        regRItem.innerHTML = `<span class="register-name">R</span><br><span class="register-value${rEditClass}"${rDataAttr}>${hex8(regR)}</span>`;

        // Flags (clickable to toggle when not viewing trace)
        const f = regAF & 0xFF;
        const flags = [
            { name: 'S', bit: 0x80, desc: 'Sign' },
            { name: 'Z', bit: 0x40, desc: 'Zero' },
            { name: 'y', bit: 0x20, desc: 'Undocumented (bit 5)' },
            { name: 'H', bit: 0x10, desc: 'Half Carry' },
            { name: 'x', bit: 0x08, desc: 'Undocumented (bit 3)' },
            { name: 'P/V', bit: 0x04, desc: 'Parity/Overflow' },
            { name: 'N', bit: 0x02, desc: 'Subtract' },
            { name: 'C', bit: 0x01, desc: 'Carry' }
        ];
        flagsDisplay.innerHTML = flags.map(flag =>
            `<div class="flag-item ${(f & flag.bit) ? 'set' : ''}${canEdit ? ' editable' : ''}" title="${flag.desc} (click to toggle)" data-bit="${flag.bit}">${flag.name}</div>`
        ).join('');

        // Paging info (128K/Pentagon only)
        if (spectrum.memory.machineType !== '48k') {
            pagesGroup.style.display = '';
            const paging = spectrum.memory.getPagingState();
            const screenNum = paging.screenBank === 5 ? '0' : '1';
            pagesInfo.innerHTML =
                createRegisterItem('C000', paging.ramBank.toString(), canEdit ? 'rambank' : null, 3) +
                createRegisterItem('Scr', screenNum, canEdit ? 'scrbank' : null, 1) +
                createRegisterItem('ROM', paging.romBank.toString(), canEdit ? 'rombank' : null, 1) +
                (paging.pagingDisabled ? createRegisterItem('Lock', '1', canEdit ? 'paginglock' : null, 1) : '');
        } else {
            pagesGroup.style.display = 'none';
        }

        // Disassembly view
        let disasm = getDisasm();
        if (!disasm) {
            disasm = new DisassemblerClass(spectrum.memory);
            setDisasm(disasm);
            // Wire DI dependencies for extracted managers
            xrefManager.setDisassembler(disasm);
            subroutineManager.setDependencies(disasm, spectrum);
            foldManager.setSubroutineManager(subroutineManager);
        }

        const pc = cpu.pc;

        // Auto-expand fold if PC is inside collapsed range
        const pcFold = foldManager.getCollapsedRangeContaining(pc);
        if (pcFold) foldManager.expand(pcFold.start);

        let viewAddr;

        if (chkFollowPC.checked) {
            // Follow PC - show PC at position from top
            viewAddr = disasm.findStartForPosition(pc, DISASM_PC_POSITION, DISASM_LINES);
            setDisasmViewAddress(null);
        } else {
            const disasmViewAddress = getDisasmViewAddress();
            if (disasmViewAddress !== null) {
                // Follow is off, use stored address
                viewAddr = disasmViewAddress;
            } else {
                // Follow is off but no address set - stay at current PC, store it
                viewAddr = disasm.findStartForPosition(pc, DISASM_PC_POSITION, DISASM_LINES);
                setDisasmViewAddress(viewAddr);
            }
        }

        const lines = disassembleWithFolding(viewAddr, DISASM_LINES);

        // Store last line address for page down
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            setDisasmLastLineAddr(lastLine.isFoldSummary ? lastLine.foldEnd : lastLine.addr);
        }

        const showTstates = getShowTstates();
        const labelMode = getLabelDisplayMode();
        const traceViewAddress = getTraceViewAddress();

        disassemblyView.innerHTML = lines.map((line, idx) => {
            // Handle fold summary lines
            if (line.isFoldSummary) {
                const icon = '▸';
                const typeClass = line.foldType === 'user' ? 'user-fold' : '';
                return `<div class="disasm-fold-summary ${typeClass}" data-fold-addr="${line.addr}">
                    <span class="disasm-fold-toggle" data-fold-addr="${line.addr}">${icon}</span>
                    <span class="fold-name">${escapeHtml(line.foldName)}</span>
                    <span class="fold-stats">(${line.byteCount} bytes)</span>
                </div>`;
            }

            // When viewing trace history, override the line at trace PC with stored bytes
            // (current memory may have different paging state than when the instruction ran)
            if (traceEntry && line.addr === traceEntry.pc) {
                const fakeMemory = { read: (addr) => traceEntry.bytes[(addr - traceEntry.pc) & 3] || 0 };
                const traceDisasm = new DisassemblerClass(fakeMemory);
                const traceInstr = traceDisasm.disassemble(traceEntry.pc);
                line.bytes = traceInstr.bytes;
                line.mnemonic = traceInstr.mnemonic;
            }

            const bytesStr = line.bytes.map(b => hex8(b)).join(' ');
            const isCurrent = line.addr === pc;
            const isTrace = traceViewAddress !== null && line.addr === traceViewAddress;
            const hasBp = spectrum.hasBreakpoint(line.addr);
            const hasDisabledBp = !hasBp && spectrum.hasDisabledBreakpoint(line.addr);
            const classes = ['disasm-line'];
            if (isCurrent && (chkShowPCCursor.checked || !spectrum.running)) classes.push('current');
            if (isTrace) classes.push('trace');
            if (hasBp) classes.push('breakpoint');
            if (line.isData) classes.push('data-line');

            // Add spacing after flow control instructions
            if (chkFlowBreakSpacing.checked && isFlowBreak(line.mnemonic)) {
                classes.push('flow-break');
            }

            // Don't show T-states for data lines
            const timing = (showTstates && !line.isData) ? disasm.getTiming(line.bytes) : '';
            const timingHtml = timing ? `<span class="disasm-tstates">${timing}</span>` : '';

            // Apply label formatting to address and mnemonic (not for data lines)
            const addrInfo = formatAddrColumn(line.addr, labelMode);
            const mnemonicWithLabels = line.isData ? line.mnemonic : replaceMnemonicAddresses(line.mnemonic, labelMode, line.addr);

            // Region type indicator
            const region = regionManager.get(line.addr);
            let regionMarker = '';
            if (region && region.type !== REGION_TYPES.CODE) {
                const markers = {
                    [REGION_TYPES.DB]: 'B',
                    [REGION_TYPES.DW]: 'W',
                    [REGION_TYPES.TEXT]: 'T',
                    [REGION_TYPES.GRAPHICS]: 'G',
                    [REGION_TYPES.SMC]: 'S'
                };
                const marker = markers[region.type] || '?';
                regionMarker = `<span class="disasm-region region-type-${region.type}" title="${region.type.toUpperCase()}${region.comment ? ': ' + region.comment : ''}">${marker}</span>`;
            }

            // Get comments for this address
            const comment = commentManager.get(line.addr);
            let beforeHtml = '';
            let inlineHtml = '';
            let afterHtml = '';

            // Subroutine separator (IDA-style) with fold toggle
            const sub = subroutineManager.get(line.addr);
            if (sub) {
                const subName = sub.name || labelManager.get(line.addr, getCurrentPage(line.addr))?.name || `sub_${hex16(line.addr)}`;
                const canFold = sub.endAddress !== null;
                const foldIcon = canFold ? `<span class="disasm-fold-toggle" data-fold-addr="${line.addr}" title="Click to collapse">▾</span>` : '';
                beforeHtml += `<span class="disasm-sub-separator">; ═══════════════════════════════════════════════════════════════</span>`;
                beforeHtml += `<span class="disasm-sub-name">; ${foldIcon}${subName}</span>`;
                if (sub.comment) {
                    beforeHtml += `<span class="disasm-sub-comment">; ${escapeHtml(sub.comment)}</span>`;
                }
                beforeHtml += `<span class="disasm-sub-separator">; ───────────────────────────────────────────────────────────────</span>`;
            }

            // User fold start marker
            const userFold = foldManager.getUserFold(line.addr);
            if (userFold) {
                const foldName = userFold.name || `fold_${hex16(line.addr)}`;
                const foldIcon = `<span class="disasm-fold-toggle" data-fold-addr="${line.addr}" title="Click to collapse">▾</span>`;
                beforeHtml += `<span class="disasm-user-fold-start">; ┌─── ${foldIcon}${escapeHtml(foldName)} ───</span>`;
            }

            if (comment) {
                // Separator line
                if (comment.separator) {
                    beforeHtml += `<span class="disasm-separator">; ----------</span>`;
                }
                // Before comments (each line prefixed with ;)
                if (comment.before) {
                    const beforeLines = comment.before.split('\n').map(l => `; ${l}`).join('\n');
                    beforeHtml += `<span class="disasm-comment-line">${escapeHtml(beforeLines)}</span>`;
                }
                // Inline comment
                if (comment.inline) {
                    inlineHtml = `<span class="disasm-inline-comment">; ${escapeHtml(comment.inline)}</span>`;
                }
                // After comments
                if (comment.after) {
                    const afterLines = comment.after.split('\n').map(l => `; ${l}`).join('\n');
                    afterHtml = `<span class="disasm-comment-line">${escapeHtml(afterLines)}</span>`;
                }
            }

            // Subroutine end marker (after RET/JP that ends a subroutine)
            const endingSubs = subroutineManager.getAllEndingAt(line.addr);
            if (endingSubs.length > 0) {
                for (const endingSub of endingSubs) {
                    const subName = endingSub.name || labelManager.get(endingSub.address, getCurrentPage(endingSub.address))?.name || `sub_${hex16(endingSub.address)}`;
                    afterHtml += `<span class="disasm-sub-end">; end of ${subName}</span>`;
                }
                afterHtml += `<span class="disasm-sub-separator">; ═══════════════════════════════════════════════════════════════</span>`;
            }

            // User fold end marker
            for (const [foldAddr, foldData] of foldManager.userFolds) {
                if (foldData.endAddress === line.addr) {
                    const foldName = foldData.name || `fold_${hex16(foldAddr)}`;
                    afterHtml += `<span class="disasm-user-fold-end">; └─── end of ${escapeHtml(foldName)} ───</span>`;
                }
            }

            if (addrInfo.isLong) {
                classes.push('has-long-label');
                return `${beforeHtml}<div class="${classes.join(' ')}" data-addr="${line.addr}">
                    <div class="disasm-label-row">${addrInfo.labelHtml}</div>
                    <span class="disasm-bp ${hasBp ? 'active' : hasDisabledBp ? 'disabled' : ''}" data-addr="${line.addr}" title="Toggle breakpoint">•</span>
                    ${regionMarker}
                    <span class="disasm-addr">${addrInfo.html}</span>
                    <span class="disasm-bytes">${bytesStr}</span>
                    ${timingHtml}
                    <span class="disasm-mnemonic">${formatMnemonic(mnemonicWithLabels)}</span>${inlineHtml}
                </div>${afterHtml}`;
            }

            return `${beforeHtml}<div class="${classes.join(' ')}" data-addr="${line.addr}">
                <span class="disasm-bp ${hasBp ? 'active' : hasDisabledBp ? 'disabled' : ''}" data-addr="${line.addr}" title="Toggle breakpoint">•</span>
                ${regionMarker}
                <span class="disasm-addr">${addrInfo.html}</span>
                <span class="disasm-bytes">${bytesStr}</span>
                ${timingHtml}
                <span class="disasm-mnemonic">${formatMnemonic(mnemonicWithLabels)}</span>${inlineHtml}
            </div>${afterHtml}`;
        }).join('');

        // Update breakpoint list
        updateBreakpointList();

        // Update watchpoint list
        updateWatchpointList();

        // Update port breakpoint list
        updatePortBreakpointList();

        // Update labels list
        updateLabelsList();

        // Update panels based on their types
        if (getLeftPanelType() === 'memdump') {
            updateLeftMemoryView();
        }
        if (getRightPanelType() === 'memdump') {
            updateMemoryView();
        } else {
            updateRightDisassemblyView();
        }

        // Update stack view
        updateStackView();
        updateCallStack();

        // Update trace status (functions defined later, check existence)
        const updateTraceStatus = getUpdateTraceStatus();
        if (typeof updateTraceStatus === 'function') {
            updateTraceStatus();
            const updateTraceList = getUpdateTraceList();
            updateTraceList();
        }

        // Update watches (function defined later, check existence)
        const updateWatchValues = getUpdateWatchValues();
        if (typeof updateWatchValues === 'function') {
            updateWatchValues();
        }
    }

    return { renderDebugger };
}
