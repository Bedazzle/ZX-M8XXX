// Labels & triggers list rendering — trigger list, breakpoints, watchpoints, labels

import { hex16, escapeHtml } from '../core/utils.js';

export function initLabelsTriggers({ getSpectrum, labelManager }) {
    const triggerList = document.getElementById('triggerList');
    const labelsList = document.getElementById('labelsList');
    const labelFilterInput = document.getElementById('labelFilterInput');
    const labelSourceFilter = document.getElementById('labelSourceFilter');

    function updateTriggerList() {
        const spectrum = getSpectrum();
        const triggers = spectrum.getTriggers();
        if (triggers.length === 0) {
            triggerList.innerHTML = '<div class="no-breakpoints">No breakpoints</div>';
        } else {
            triggerList.innerHTML = triggers.map(t => {
                const icon = spectrum.getTriggerIcon(t.type);
                const label = spectrum.getTriggerLabel(t.type);
                const desc = spectrum.formatTrigger(t);
                const disabledClass = t.enabled ? '' : ' disabled';
                const iconClass = t.type.startsWith('port') ? 'port' : t.type;
                const skipInfo = t.skipCount > 0 ? ` <span class="trigger-skip" title="Hit ${t.hitCount}/${t.skipCount + 1}">[${t.hitCount}/${t.skipCount + 1}]</span>` : '';
                return `<div class="trigger-item${disabledClass}" data-index="${t.index}">
                    <span class="trigger-icon ${iconClass}" title="${label}">${icon}</span>
                    <span class="trigger-toggle" data-index="${t.index}" title="${t.enabled ? 'Disable' : 'Enable'}">⏻</span>
                    <span class="trigger-desc" data-index="${t.index}">${desc}${skipInfo}</span>
                    <span class="trigger-remove" data-index="${t.index}" title="Remove">×</span>
                </div>`;
            }).join('');
        }
    }

    // Legacy function names for compatibility
    function updateBreakpointList() { updateTriggerList(); }
    function updateWatchpointList() { updateTriggerList(); }
    function updatePortBreakpointList() { updateTriggerList(); }

    function updateLabelsList() {
        const filter = labelFilterInput.value.toLowerCase().trim();
        const sourceFilter = labelSourceFilter.value;

        // Get user labels (non-ROM)
        const userLabels = labelManager.getAll().map(l => ({ ...l, isRom: false }));

        // Get ROM labels (those not overridden by user labels)
        const romLabels = [];
        for (const label of labelManager.romLabels.values()) {
            if (!labelManager.labels.has(labelManager._key(label.address, label.page))) {
                romLabels.push({ ...label, isRom: true });
            }
        }

        // Count by source for display
        let countUser = 0, countProfiled = 0;
        for (const l of userLabels) {
            if (l.source === 'profiler') countProfiled++;
            else countUser++;
        }
        const countRom = romLabels.length;

        // Update label count display
        const labelCountEl = document.getElementById('labelCount');
        if (labelCountEl) {
            const parts = [];
            if (countUser > 0) parts.push(`${countUser} user`);
            if (countProfiled > 0) parts.push(`${countProfiled} profiled`);
            if (countRom > 0) parts.push(`${countRom} rom`);
            labelCountEl.textContent = parts.length > 0 ? parts.join(', ') : '';
        }

        // Apply source filter
        let filtered;
        switch (sourceFilter) {
            case 'user':
                filtered = userLabels.filter(l => l.source !== 'profiler');
                break;
            case 'profiled':
                filtered = userLabels.filter(l => l.source === 'profiler');
                break;
            case 'rom':
                filtered = romLabels;
                break;
            default: // 'all'
                filtered = [...userLabels, ...romLabels];
        }

        // Sort by address
        filtered.sort((a, b) => a.address - b.address);

        // Apply text filter
        const labels = filter
            ? filtered.filter(l => l.name.toLowerCase().includes(filter) ||
                                    (l.comment && l.comment.toLowerCase().includes(filter)))
            : filtered;

        if (labels.length === 0) {
            labelsList.innerHTML = filter
                ? '<div class="no-breakpoints">No matching labels</div>'
                : '<div class="no-breakpoints">No labels</div>';
            return;
        }

        labelsList.innerHTML = labels.map(label => {
            const addrStr = label.page !== null ? `${label.page}:${hex16(label.address)}` : hex16(label.address);
            const commentHtml = label.comment ? `<span class="label-comment">${escapeHtml(label.comment)}</span>` : '';
            const sourceTag = label.source === 'profiler' ? '<span class="label-source-tag">P</span>' :
                              label.source === 'asm' ? '<span class="label-source-tag">A</span>' : '';
            const itemClass = label.isRom ? 'label-item rom-label' : 'label-item';
            const actionsHtml = label.isRom ? '' : `
                <div class="label-actions">
                    <button class="label-btn label-edit" data-addr="${label.address}" data-page="${label.page}" title="Edit">✎</button>
                    <button class="label-btn label-remove" data-addr="${label.address}" data-page="${label.page}" title="Remove">×</button>
                </div>`;
            return `<div class="${itemClass}" data-addr="${label.address}" data-page="${label.page}">
                <div class="label-info">
                    <span class="label-addr">${addrStr}</span>
                    ${sourceTag}<span class="label-item-name">${escapeHtml(label.name)}</span>
                    ${commentHtml}
                </div>
                ${actionsHtml}
            </div>`;
        }).join('');
    }

    return { updateTriggerList, updateBreakpointList, updateWatchpointList,
             updatePortBreakpointList, updateLabelsList };
}
