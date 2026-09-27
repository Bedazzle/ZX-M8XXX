// One disassembly row, rendered once.
//
// The debugger has two disassembly views -- the main one (ui/debugger-display.js)
// and the right panel (ui/right-disasm-view.js) -- and until now each carried its
// own copy of the row markup: region marker, comments, subroutine separators, fold
// start/end markers, the long-label variant. 125 of right-disasm-view's 171 lines
// were line-for-line identical to the other, so every disassembly feature had to be
// written twice or was silently missing from one panel. It already went wrong once:
// the right panel's breakpoint dot had no `title`, so the tooltip the left panel
// shows was absent there for no reason anyone chose. ui/comment-visibility.js exists
// for the same reason -- one rule lifted out of two renderers. This lifts the row.
//
// What actually differs between the two views is small and lives in `ctx`:
//   - the main view marks the trace line and can rewrite a row's bytes from the
//     trace record (paging may have moved since), so it passes `prepareLine`
//   - the right panel passes `traceViewAddress: null` and no `prepareLine`,
//     which turns both off without a branch here
// Everything else is one code path.

import { hex16, escapeHtml } from '../core/utils.js';
import { fmtOpcode } from '../core/addr-format.js';
import { REGION_TYPES } from '../debug/managers.js';
import { visibleComment } from './comment-visibility.js';

const REGION_MARKERS = {
    [REGION_TYPES.DB]: 'B',
    [REGION_TYPES.DW]: 'W',
    [REGION_TYPES.TEXT]: 'T',
    [REGION_TYPES.GRAPHICS]: 'G',
    [REGION_TYPES.SMC]: 'S'
};

export function createDisasmLineRenderer({
    subroutineManager, labelManager, foldManager, commentManager, regionManager,
    getCurrentPage, formatAddrColumn, replaceMnemonicAddresses,
    formatMnemonic, isFlowBreak
}) {
    // Resolved once, like every other module: boot.js has spliced the markup in
    // before any init runs. Both views read the same two checkboxes.
    const chkFlowBreakSpacing = document.getElementById('chkFlowBreakSpacing');
    const chkShowPCCursor = document.getElementById('chkShowPCCursor');

    function renderFoldSummary(line) {
        const typeClass = line.foldType === 'user' ? 'user-fold' : '';
        return `<div class="disasm-fold-summary ${typeClass}" data-fold-addr="${line.addr}">
                    <span class="disasm-fold-toggle" data-fold-addr="${line.addr}">▸</span>
                    <span class="fold-name">${escapeHtml(line.foldName)}</span>
                    <span class="fold-stats">(${line.byteCount} bytes)</span>
                </div>`;
    }

    // Escaped: a subroutine name is whatever the user typed, and it goes into the
    // row through innerHTML.
    function subName(addr) {
        const sub = subroutineManager.get(addr);
        const name = (sub && sub.name)
            || labelManager.get(addr, getCurrentPage(addr))?.name
            || `sub_${hex16(addr)}`;
        return escapeHtml(name);
    }

    // Everything printed above the row: subroutine banner, user fold start, and
    // the comment's separator/before lines, in that order.
    function renderBefore(addr, comment) {
        let html = '';

        const sub = subroutineManager.get(addr);
        if (sub) {
            const canFold = sub.endAddress !== null;
            const foldIcon = canFold
                ? `<span class="disasm-fold-toggle" data-fold-addr="${addr}" title="Click to collapse">▾</span>`
                : '';
            html += `<span class="disasm-sub-separator">; ═══════════════════════════════════════════════════════════════</span>`;
            html += `<span class="disasm-sub-name">; ${foldIcon}${subName(addr)}</span>`;
            if (sub.comment) {
                html += `<span class="disasm-sub-comment">; ${escapeHtml(sub.comment)}</span>`;
            }
            html += `<span class="disasm-sub-separator">; ───────────────────────────────────────────────────────────────</span>`;
        }

        const userFold = foldManager.getUserFold(addr);
        if (userFold) {
            const foldName = userFold.name || `fold_${hex16(addr)}`;
            const foldIcon = `<span class="disasm-fold-toggle" data-fold-addr="${addr}" title="Click to collapse">▾</span>`;
            html += `<span class="disasm-user-fold-start">; ┌─── ${foldIcon}${escapeHtml(foldName)} ───</span>`;
        }

        if (comment) {
            if (comment.separator) {
                html += `<span class="disasm-separator">; ----------</span>`;
            }
            if (comment.before) {
                const beforeLines = comment.before.split('\n').map(l => `; ${l}`).join('\n');
                html += `<span class="disasm-comment-line">${escapeHtml(beforeLines)}</span>`;
            }
        }
        return html;
    }

    // Everything printed below the row: the comment's after lines, subroutine end
    // markers, and user fold end markers.
    function renderAfter(addr, comment) {
        let html = '';

        if (comment && comment.after) {
            const afterLines = comment.after.split('\n').map(l => `; ${l}`).join('\n');
            html += `<span class="disasm-comment-line">${escapeHtml(afterLines)}</span>`;
        }

        const endingSubs = subroutineManager.getAllEndingAt(addr);
        if (endingSubs.length > 0) {
            for (const endingSub of endingSubs) {
                html += `<span class="disasm-sub-end">; end of ${subName(endingSub.address)}</span>`;
            }
            html += `<span class="disasm-sub-separator">; ═══════════════════════════════════════════════════════════════</span>`;
        }

        for (const [foldAddr, foldData] of foldManager.userFolds) {
            if (foldData.endAddress === addr) {
                const foldName = foldData.name || `fold_${hex16(foldAddr)}`;
                html += `<span class="disasm-user-fold-end">; └─── end of ${escapeHtml(foldName)} ───</span>`;
            }
        }
        return html;
    }

    function renderRegionMarker(addr) {
        const region = regionManager.get(addr);
        if (!region || region.type === REGION_TYPES.CODE) return '';
        const marker = REGION_MARKERS[region.type] || '?';
        // Escaped: a region comment went into this title raw, so a region commented
        // `a "quoted" note` closed the attribute early and the browser swallowed the
        // marker letter along with the rest of the row's tag. Both panels had it.
        const tip = `${region.type.toUpperCase()}${region.comment ? ': ' + escapeHtml(region.comment) : ''}`;
        return `<span class="disasm-region region-type-${region.type}" title="${tip}">${marker}</span>`;
    }

    /**
     * One row.
     *
     * ctx: { spectrum, disasm, pc, showTstates, labelMode, traceViewAddress }
     * traceViewAddress may be null -- the right panel has no trace cursor.
     */
    function renderLine(line, ctx) {
        if (line.isFoldSummary) return renderFoldSummary(line);

        const { spectrum, disasm, pc, showTstates, labelMode, traceViewAddress } = ctx;
        const addr = line.addr;

        const bytesStr = line.bytes.map(b => fmtOpcode(b)).join(' ');
        const hasBp = spectrum.hasBreakpoint(addr);
        const hasDisabledBp = !hasBp && spectrum.hasDisabledBreakpoint(addr);

        const classes = ['disasm-line'];
        if (addr === pc && (chkShowPCCursor.checked || !spectrum.running)) classes.push('current');
        // null (the right panel has no trace cursor) never equals a number.
        if (addr === traceViewAddress) classes.push('trace');
        if (hasBp) classes.push('breakpoint');
        if (line.isData) classes.push('data-line');
        if (chkFlowBreakSpacing.checked && isFlowBreak(line.mnemonic)) classes.push('flow-break');

        // Data lines get no timing: the bytes are not an instruction.
        const timing = (showTstates && !line.isData) ? disasm.getTiming(line.bytes) : '';
        const timingHtml = timing ? `<span class="disasm-tstates">${timing}</span>` : '';

        const addrInfo = formatAddrColumn(addr, labelMode);
        const mnemonicWithLabels = line.isData
            ? line.mnemonic
            : replaceMnemonicAddresses(line.mnemonic, labelMode, addr);

        const comment = visibleComment(commentManager.get(addr));
        const beforeHtml = renderBefore(addr, comment);
        const afterHtml = renderAfter(addr, comment);
        // title too: the row cuts a long comment off with an ellipsis
        const inlineHtml = (comment && comment.inline)
            ? `<span class="disasm-inline-comment" title="${escapeHtml(comment.inline)}">; ${escapeHtml(comment.inline)}</span>`
            : '';

        const bpClass = hasBp ? 'active' : hasDisabledBp ? 'disabled' : '';
        const bpDot = `<span class="disasm-bp ${bpClass}" data-addr="${addr}" title="Toggle breakpoint">•</span>`;
        const body = `${bpDot}
                ${renderRegionMarker(addr)}
                <span class="disasm-addr">${addrInfo.html}</span>
                <span class="disasm-bytes">${bytesStr}</span>
                ${timingHtml}
                <span class="disasm-mnemonic">${formatMnemonic(mnemonicWithLabels)}</span>${inlineHtml}`;

        // A label too long for the address column gets its own row above the code.
        if (addrInfo.isLong) {
            classes.push('has-long-label');
            return `${beforeHtml}<div class="${classes.join(' ')}" data-addr="${addr}">
                    <div class="disasm-label-row">${addrInfo.labelHtml}</div>
                    ${body}
                </div>${afterHtml}`;
        }

        return `${beforeHtml}<div class="${classes.join(' ')}" data-addr="${addr}">
                ${body}
            </div>${afterHtml}`;
    }

    /**
     * The whole view. `ctx.prepareLine(line)` runs on each real row before it is
     * rendered -- the main view uses it to substitute the bytes recorded in the
     * trace, which is the one thing it does that the right panel does not.
     */
    function renderLines(lines, ctx) {
        return lines.map(line => {
            if (!line.isFoldSummary && ctx.prepareLine) ctx.prepareLine(line);
            return renderLine(line, ctx);
        }).join('');
    }

    return { renderLine, renderLines };
}
