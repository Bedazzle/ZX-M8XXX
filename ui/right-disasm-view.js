// Right panel disassembly view (never auto-follows PC)
//
// The row markup lives in ui/disasm-line-render.js, shared with the main view.
// What is left here is the whole of what makes this view different: it does not
// follow PC, it has its own T-states checkbox, and it has no trace cursor.

export function initRightDisasmView({
    getSpectrum, getDisasm,
    disassembleWithFolding, renderDisasmLines,
    getRightDisasmViewAddress, getLabelDisplayMode,
    DISASM_LINES
}) {
    const rightDisassemblyView = document.getElementById('rightDisassemblyView');

    function updateRightDisassemblyView() {
        const spectrum = getSpectrum();
        const disasm = getDisasm();
        if (!spectrum.memory || !disasm) {
            rightDisassemblyView.innerHTML = '<div class="disasm-line">No code</div>';
            return;
        }

        // Right panel doesn't auto-follow - use set address or 0
        const rightDisasmViewAddress = getRightDisasmViewAddress();
        const viewAddr = rightDisasmViewAddress !== null ? rightDisasmViewAddress : 0;

        const lines = disassembleWithFolding(viewAddr, DISASM_LINES, true);

        rightDisassemblyView.innerHTML = renderDisasmLines(lines, {
            spectrum,
            disasm,
            pc: spectrum.cpu ? spectrum.cpu.pc : 0,
            showTstates: document.getElementById('chkRightShowTstates')?.checked || false,
            labelMode: getLabelDisplayMode(),
            // No trace cursor in this panel.
            traceViewAddress: null
        });
    }

    return { updateRightDisassemblyView };
}
