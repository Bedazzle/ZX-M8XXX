// Right panel disassembly view (never auto-follows PC)
// Extracted from index.html

import { hex8, hex16, escapeHtml } from '../core/utils.js';
import { REGION_TYPES } from '../debug/managers.js';

export function initRightDisasmView({
    getSpectrum, getDisasm,
    subroutineManager, labelManager, foldManager,
    commentManager, regionManager,
    getCurrentPage, formatAddrColumn, replaceMnemonicAddresses,
    formatMnemonic, isFlowBreak, disassembleWithFolding,
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
        let viewAddr = rightDisasmViewAddress !== null ? rightDisasmViewAddress : 0;

        const pc = spectrum.cpu ? spectrum.cpu.pc : 0;
        const showTstates = document.getElementById('chkRightShowTstates')?.checked || false;
        const labelMode = getLabelDisplayMode();

        const lines = disassembleWithFolding(viewAddr, DISASM_LINES, true);

        rightDisassemblyView.innerHTML = lines.map((line, idx) => {
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

            const bytesStr = line.bytes.map(b => hex8(b)).join(' ');
            const isCurrent = line.addr === pc;
            const hasBp = spectrum.hasBreakpoint(line.addr);
            const hasDisabledBp = !hasBp && spectrum.hasDisabledBreakpoint(line.addr);
            const classes = ['disasm-line'];
            if (isCurrent) classes.push('current');
            if (hasBp) classes.push('breakpoint');
            if (line.isData) classes.push('data-line');
            if (isFlowBreak(line.mnemonic)) classes.push('flow-break');

            const timing = (showTstates && !line.isData) ? disasm.getTiming(line.bytes) : '';
            const timingHtml = timing ? `<span class="disasm-tstates">${timing}</span>` : '';
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

            // Subroutine separator with fold toggle (same as left panel)
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
                if (comment.separator) {
                    beforeHtml += `<span class="disasm-separator">; ----------</span>`;
                }
                if (comment.before) {
                    const beforeLines = comment.before.split('\n').map(l => `; ${l}`).join('\n');
                    beforeHtml += `<span class="disasm-comment-line">${escapeHtml(beforeLines)}</span>`;
                }
                if (comment.inline) {
                    inlineHtml = `<span class="disasm-inline-comment">; ${escapeHtml(comment.inline)}</span>`;
                }
                if (comment.after) {
                    const afterLines = comment.after.split('\n').map(l => `; ${l}`).join('\n');
                    afterHtml = `<span class="disasm-comment-line">${escapeHtml(afterLines)}</span>`;
                }
            }

            // Subroutine end marker
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

            return `${beforeHtml}<div class="${classes.join(' ')}" data-addr="${line.addr}">
                <span class="disasm-bp ${hasBp ? 'active' : hasDisabledBp ? 'disabled' : ''}" data-addr="${line.addr}">•</span>
                ${regionMarker}
                <span class="disasm-addr">${addrInfo.html}</span>
                <span class="disasm-bytes">${bytesStr}</span>
                ${timingHtml}
                <span class="disasm-mnemonic">${formatMnemonic(mnemonicWithLabels)}</span>${inlineHtml}
            </div>${afterHtml}`;
        }).join('');
    }

    return { updateRightDisassemblyView };
}
