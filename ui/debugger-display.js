// Debugger display — register rendering + disassembly view + sub-panel dispatch
// Extracted from index.html

import { fmtAddr, fmtByte } from '../core/addr-format.js';

export function initDebuggerDisplay({
    getSpectrum, getDisasm, setDisasm,
    DisassemblerClass,
    regEditorAPI, asmEditAPI, traceManager,
    subroutineManager, foldManager, xrefManager,
    // The row markup is shared with the right panel — ui/disasm-line-render.js.
    disassembleWithFolding, renderDisasmLines,
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
    const ayGroup = document.getElementById('ayGroup');
    const ayRegsView = document.getElementById('ayRegsView');
    const disassemblyView = document.getElementById('disassemblyView');
    const chkFollowPC = document.getElementById('chkFollowPC');

    function createRegisterItem(name, value, editable = null, bits = 16) {
        const editClass = editable ? ' editable' : '';
        const dataAttr = editable ? ` data-reg="${editable}" data-bits="${bits}"` : '';
        const nameTitle = bits === 16 ? ' title="Double-click to add watch"' : '';
        // reg16 gives the value a width floor in CSS, per base.
        const wide = bits === 16 ? ' reg16' : '';
        return `<div class="register-item"><span class="register-name"${nameTitle}>${name}</span><br><span class="register-value${wide}${editClass}"${dataAttr}>${value}</span></div>`;
    }

    // PC at the previous render — used so a fold is only auto-expanded when
    // execution moves PC into it, not while the user toggles folds at a
    // standstill (otherwise a manual collapse is undone on the next render).
    let foldPrevPc = null;

    function renderDebugger() {
        const spectrum = getSpectrum();
        if (!spectrum.cpu) return;
        if (regEditorAPI.isEditingRegister()) return; // Don't update while editing
        // Same for a row being assembled: a redraw throws the box away mid-word,
        // and the blur that follows cancels what was typed.
        if (asmEditAPI && asmEditAPI.isEditing()) return;
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
            createRegisterItem('AF', fmtAddr(regAF), canEdit ? 'af' : null) +
            createRegisterItem('BC', fmtAddr(regBC), canEdit ? 'bc' : null) +
            createRegisterItem('DE', fmtAddr(regDE), canEdit ? 'de' : null) +
            createRegisterItem('HL', fmtAddr(regHL), canEdit ? 'hl' : null);

        // Alternate registers
        altRegisters.innerHTML =
            createRegisterItem("AF'", fmtAddr(regAF_), canEdit ? 'af_' : null) +
            createRegisterItem("BC'", fmtAddr(regBC_), canEdit ? 'bc_' : null) +
            createRegisterItem("DE'", fmtAddr(regDE_), canEdit ? 'de_' : null) +
            createRegisterItem("HL'", fmtAddr(regHL_), canEdit ? 'hl_' : null);

        // IX, IY and swap buttons in same row
        ixiyRegisters.innerHTML =
            createRegisterItem('IX', fmtAddr(regIX), canEdit ? 'ix' : null) +
            createRegisterItem('IY', fmtAddr(regIY), canEdit ? 'iy' : null) +
            `<button class="reg-swap-btn" id="btnEXA" title="EX AF,AF'">exa</button>` +
            `<button class="reg-swap-btn" id="btnEXX" title="EXX">exx</button>`;

        // Index registers: SP, PC, I, IM, IFF
        indexRegisters.innerHTML =
            createRegisterItem('SP', fmtAddr(regSP), canEdit ? 'sp' : null) +
            createRegisterItem('PC', fmtAddr(regPC), canEdit ? 'pc' : null) +
            createRegisterItem('I', fmtByte(regI), canEdit ? 'i' : null, 8) +
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
        regRItem.innerHTML = `<span class="register-name">R</span><br><span class="register-value${rEditClass}"${rDataAttr}>${fmtByte(regR)}</span>`;

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

        // AY registers (two columns: R0-R6 | R7-R13)
        if (spectrum.ay && (spectrum.ayEnabled || spectrum.ay48kEnabled)) {
            ayGroup.style.display = '';
            const r = spectrum.ay.registers;
            let text = '';
            for (let i = 0; i < 7; i++) {
                const j = i + 7;
                const rn = j < 10 ? 'R' + j + ' ' : 'R' + j;
                text += 'R' + i + ' ' + fmtByte(r[i]) + '  ' + rn + ' ' + fmtByte(r[j]) + '\n';
            }
            ayRegsView.textContent = text;
        } else {
            ayGroup.style.display = 'none';
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

        // Auto-expand a fold only when execution has moved PC into it, so a
        // manual collapse of the fold the PC currently sits in isn't undone
        // on the very next render.
        if (pc !== foldPrevPc) {
            const pcFold = foldManager.getCollapsedRangeContaining(pc);
            if (pcFold) foldManager.expand(pcFold.start);
        }
        foldPrevPc = pc;

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

        disassemblyView.innerHTML = renderDisasmLines(lines, {
            spectrum,
            disasm,
            pc,
            showTstates,
            labelMode,
            traceViewAddress,
            // Viewing trace history: the row at the trace PC is redrawn from the
            // bytes recorded then, because paging may have moved since.
            prepareLine: traceEntry ? (line) => {
                if (line.addr !== traceEntry.pc) return;
                const fakeMemory = { read: (addr) => traceEntry.bytes[(addr - traceEntry.pc) & 3] || 0 };
                const traceInstr = new DisassemblerClass(fakeMemory).disassemble(traceEntry.pc);
                line.bytes = traceInstr.bytes;
                line.mnemonic = traceInstr.mnemonic;
            } : null
        });

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
