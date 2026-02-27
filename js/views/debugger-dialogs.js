// Extracted from index.html inline script
// Debugger dialog UI: xref tooltips, label/region/fold/comment dialogs, disasm context menu
// Lines ~28259-28897

import { hex8, hex16, escapeHtml } from '../utils/format.js';

// ── DOM references ──────────────────────────────────────────────────
const xrefTooltip = document.getElementById('xrefTooltip');

// Label dialog elements
const labelDialog       = document.getElementById('labelDialog');
const labelDialogTitle  = document.getElementById('labelDialogTitle');
const labelAddrInput    = document.getElementById('labelAddrInput');
const labelNameInput    = document.getElementById('labelNameInput');
const labelCommentInput = document.getElementById('labelCommentInput');
const labelSizeInput    = document.getElementById('labelSizeInput');
const btnLabelCancel    = document.getElementById('btnLabelCancel');
const btnLabelSave      = document.getElementById('btnLabelSave');

// Region dialog elements
const regionDialog       = document.getElementById('regionDialog');
const regionDialogTitle  = document.getElementById('regionDialogTitle');
const regionStartInput   = document.getElementById('regionStartInput');
const regionEndInput     = document.getElementById('regionEndInput');
const regionTypeSelect   = document.getElementById('regionTypeSelect');
const regionCommentInput = document.getElementById('regionCommentInput');
const btnRegionSave      = document.getElementById('btnRegionSave');
const btnRegionCancel    = document.getElementById('btnRegionCancel');

// Fold dialog elements
const foldDialog    = document.getElementById('foldDialog');
const foldStartInput = document.getElementById('foldStartInput');
const foldEndInput   = document.getElementById('foldEndInput');
const foldNameInput  = document.getElementById('foldNameInput');
const btnFoldSave    = document.getElementById('btnFoldSave');
const btnFoldCancel  = document.getElementById('btnFoldCancel');

// Comment dialog elements
const commentDialog       = document.getElementById('commentDialog');
const commentDialogTitle  = document.getElementById('commentDialogTitle');
const commentAddrInput    = document.getElementById('commentAddrInput');
const commentSeparator    = document.getElementById('commentSeparator');
const commentBeforeInput  = document.getElementById('commentBeforeInput');
const commentInlineInput  = document.getElementById('commentInlineInput');
const commentAfterInput   = document.getElementById('commentAfterInput');
const btnCommentSave      = document.getElementById('btnCommentSave');
const btnCommentDelete    = document.getElementById('btnCommentDelete');
const btnCommentCancel    = document.getElementById('btnCommentCancel');

// ── Mutable state ───────────────────────────────────────────────────
let xrefTooltipTimeout    = null;
let labelContextMenu      = null;
let labelDialogAddr       = null;
let regionDialogStartAddr = null;
let foldDialogStartAddr   = null;
let commentDialogAddr     = null;

// ── External references (set via initDebuggerDialogs) ───────────────
let spectrum;
let labelManager, regionManager, foldManager, commentManager;
let subroutineManager, xrefManager, operandFormatManager, undoManager;
let REGION_TYPES, OPERAND_FORMATS;
let showMessage;
let updateDebugger, updateLabelsList;
let goToLeftDisasm, goToRightDisasm, goToLeftMemory, goToRightMemory;
let disassemblyView, rightDisassemblyView;
let showFoldDialog_fn; // self-reference for context menu calling showFoldDialog

// ── Initialisation ──────────────────────────────────────────────────
export function initDebuggerDialogs(deps) {
    spectrum            = deps.spectrum;
    labelManager        = deps.labelManager;
    regionManager       = deps.regionManager;
    foldManager         = deps.foldManager;
    commentManager      = deps.commentManager;
    subroutineManager   = deps.subroutineManager;
    xrefManager         = deps.xrefManager;
    operandFormatManager = deps.operandFormatManager;
    undoManager         = deps.undoManager;
    REGION_TYPES        = deps.REGION_TYPES;
    OPERAND_FORMATS     = deps.OPERAND_FORMATS;
    showMessage         = deps.showMessage;
    updateDebugger      = deps.updateDebugger;
    updateLabelsList    = deps.updateLabelsList;
    goToLeftDisasm      = deps.goToLeftDisasm;
    goToRightDisasm     = deps.goToRightDisasm;
    goToLeftMemory      = deps.goToLeftMemory;
    goToRightMemory     = deps.goToRightMemory;
    disassemblyView     = deps.disassemblyView;
    rightDisassemblyView = deps.rightDisassemblyView;

    _initEventListeners();
}

// ── XRef tooltip ────────────────────────────────────────────────────

export function showXRefTooltip(addr, refs, x, y) {
    const typeNames = {
        'call': 'CALL',
        'jp': 'JP',
        'jr': 'JR',
        'djnz': 'DJNZ',
        'rst': 'RST',
        'ld_imm': 'LD',
        'ld_ind': 'LD'
    };

    let html = `<div class="xref-tooltip-header">XRefs to ${hex16(addr)} (${refs.length})</div>`;

    refs.sort((a, b) => a.fromAddr - b.fromAddr);

    const maxShow = 20;
    const shown = refs.slice(0, maxShow);

    for (const ref of shown) {
        const label = labelManager.get(ref.fromAddr);
        const labelStr = label ? ` [${label.name}]` : '';
        const typeClass = ref.type.startsWith('ld') ? 'ld' : ref.type;
        html += `<div class="xref-tooltip-item">
            <span class="xref-type-${typeClass}">${typeNames[ref.type] || ref.type}</span>
            from ${hex16(ref.fromAddr)}${labelStr}
        </div>`;
    }

    if (refs.length > maxShow) {
        html += `<div class="xref-tooltip-item">...and ${refs.length - maxShow} more</div>`;
    }

    xrefTooltip.innerHTML = html;
    xrefTooltip.style.display = 'block';
    xrefTooltip.style.left = (x + 15) + 'px';
    xrefTooltip.style.top = (y + 10) + 'px';

    const rect = xrefTooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        xrefTooltip.style.left = (x - rect.width - 5) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        xrefTooltip.style.top = (y - rect.height - 5) + 'px';
    }
}

export function hideXRefTooltip() {
    xrefTooltip.style.display = 'none';
    if (xrefTooltipTimeout) {
        clearTimeout(xrefTooltipTimeout);
        xrefTooltipTimeout = null;
    }
}

// ── Label context menu ──────────────────────────────────────────────

export function closeLabelContextMenu() {
    if (labelContextMenu) {
        labelContextMenu.remove();
        labelContextMenu = null;
    }
}

// ── Label dialog ────────────────────────────────────────────────────

export function showLabelDialog(addr, pageOrLabel = null) {
    let existingLabel = null;
    let page = null;

    if (pageOrLabel !== null && typeof pageOrLabel === 'object') {
        existingLabel = pageOrLabel;
        page = existingLabel.page;
    } else if (addr !== null) {
        page = pageOrLabel;
        existingLabel = labelManager.get(addr, page);
    }

    labelDialogAddr = addr;
    labelAddrInput.value = addr !== null ? hex16(addr) : '';
    labelAddrInput.readOnly = addr !== null;
    labelDialogTitle.textContent = existingLabel ? 'Edit Label' : 'Add Label';

    if (existingLabel) {
        labelNameInput.value = existingLabel.name;
        labelCommentInput.value = existingLabel.comment || '';
        labelSizeInput.value = existingLabel.size || 1;
    } else {
        labelNameInput.value = '';
        labelCommentInput.value = '';
        labelSizeInput.value = 1;
    }

    labelDialog.classList.remove('hidden');
    if (addr === null) {
        labelAddrInput.focus();
        labelAddrInput.select();
    } else {
        labelNameInput.focus();
        labelNameInput.select();
    }
}

export function closeLabelDialog() {
    labelDialog.classList.add('hidden');
    labelDialogAddr = null;
}

export function saveLabelFromDialog() {
    let addr = labelDialogAddr;

    if (addr === null) {
        const addrStr = labelAddrInput.value.trim().toUpperCase();
        if (!addrStr || !/^[0-9A-F]{1,4}$/.test(addrStr)) {
            showMessage('Valid hex address required (0000-FFFF)', 'error');
            labelAddrInput.focus();
            return;
        }
        addr = parseInt(addrStr, 16);
    }

    const name = labelNameInput.value.trim();
    if (!name) {
        showMessage('Label name is required', 'error');
        labelNameInput.focus();
        return;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        showMessage('Invalid label: use letters, digits, _ (start with letter or _)', 'error');
        labelNameInput.focus();
        return;
    }

    const existing = labelManager.findByName(name);
    if (existing && existing.address !== addr) {
        showMessage(`Label "${existing.name}" already exists at ${hex16(existing.address)}`, 'error');
        labelNameInput.focus();
        return;
    }

    const oldLabel = labelManager.get(addr);
    const newLabel = {
        address: addr,
        name: name,
        comment: labelCommentInput.value.trim(),
        size: parseInt(labelSizeInput.value, 10) || 1
    };

    labelManager.add(newLabel);

    undoManager.push({
        type: 'label',
        description: oldLabel ? `Update label "${name}"` : `Add label "${name}"`,
        undo: () => {
            if (oldLabel) {
                labelManager.add(oldLabel);
            } else {
                labelManager.remove(addr);
            }
            updateLabelsList();
        },
        redo: () => {
            labelManager.add(newLabel);
            updateLabelsList();
        }
    });

    showMessage(`Label "${name}" saved at ${hex16(addr)}`);
    closeLabelDialog();
    updateLabelsList();
    updateDebugger();
}

// ── Region dialog ───────────────────────────────────────────────────

export function showRegionDialog(startAddr, type = REGION_TYPES.CODE, endAddr = null) {
    regionDialogStartAddr = startAddr;
    regionStartInput.value = hex16(startAddr);
    regionEndInput.value = hex16(endAddr !== null ? endAddr : startAddr);
    regionTypeSelect.value = type;
    regionCommentInput.value = '';

    const typeNames = {
        [REGION_TYPES.CODE]: 'Code',
        [REGION_TYPES.DB]: 'DB (bytes)',
        [REGION_TYPES.DW]: 'DW (words)',
        [REGION_TYPES.TEXT]: 'Text',
        [REGION_TYPES.GRAPHICS]: 'Graphics',
        [REGION_TYPES.SMC]: 'SMC'
    };
    regionDialogTitle.textContent = `Mark Region as ${typeNames[type] || 'Unknown'}`;

    regionDialog.classList.remove('hidden');
    regionEndInput.focus();
    regionEndInput.select();
}

export function closeRegionDialog() {
    regionDialog.classList.add('hidden');
    regionDialogStartAddr = null;
}

export function saveRegionFromDialog() {
    const startAddr = regionDialogStartAddr;
    const endStr = regionEndInput.value.trim().toUpperCase();

    if (!/^[0-9A-F]{1,4}$/.test(endStr)) {
        showMessage('Valid hex end address required', 'error');
        regionEndInput.focus();
        return;
    }

    const endAddr = parseInt(endStr, 16);

    if (endAddr < startAddr) {
        showMessage('End address must be >= start address', 'error');
        regionEndInput.focus();
        return;
    }

    const overlapping = regionManager.getOverlapping(startAddr, endAddr);
    if (overlapping.length > 0) {
        const r = overlapping[0];
        const existingRange = `${r.start.toString(16).toUpperCase()}-${r.end.toString(16).toUpperCase()}`;
        const existingType = r.type.toUpperCase();
        showMessage(`Overlap with existing ${existingType} region at ${existingRange}. Remove it first.`, 'error');
        return;
    }

    const newRegion = {
        start: startAddr,
        end: endAddr,
        type: regionTypeSelect.value,
        comment: regionCommentInput.value.trim()
    };

    regionManager.add(newRegion);

    undoManager.push({
        type: 'region',
        description: `Add region ${hex16(startAddr)}-${hex16(endAddr)}`,
        undo: () => {
            regionManager.remove(startAddr);
        },
        redo: () => {
            regionManager.add(newRegion, true);
        }
    });

    showMessage(`Region ${hex16(startAddr)}-${hex16(endAddr)} marked as ${regionTypeSelect.value}`);
    closeRegionDialog();
    updateDebugger();
}

// ── Fold dialog ─────────────────────────────────────────────────────

export function showFoldDialog(startAddr) {
    foldDialogStartAddr = startAddr;
    foldStartInput.value = hex16(startAddr);
    foldEndInput.value = '';
    foldNameInput.value = '';

    foldDialog.classList.remove('hidden');
    foldEndInput.focus();
}

export function closeFoldDialog() {
    foldDialog.classList.add('hidden');
    foldDialogStartAddr = null;
}

export function saveFoldFromDialog() {
    const startAddr = foldDialogStartAddr;
    const endStr = foldEndInput.value.trim().toUpperCase();

    if (!/^[0-9A-F]{1,4}$/.test(endStr)) {
        showMessage('Valid hex end address required', 'error');
        foldEndInput.focus();
        return;
    }

    const endAddr = parseInt(endStr, 16);

    if (endAddr < startAddr) {
        showMessage('End address must be >= start address', 'error');
        foldEndInput.focus();
        return;
    }

    const foldName = foldNameInput.value.trim() || null;

    foldManager.addUserFold(startAddr, endAddr, foldName);

    undoManager.push({
        type: 'fold',
        description: `Create fold block ${hex16(startAddr)}-${hex16(endAddr)}`,
        undo: () => {
            foldManager.removeUserFold(startAddr);
        },
        redo: () => {
            foldManager.addUserFold(startAddr, endAddr, foldName);
        }
    });

    showMessage(`Fold block created: ${hex16(startAddr)}-${hex16(endAddr)}`);
    closeFoldDialog();
    updateDebugger();
}

// ── Comment dialog ──────────────────────────────────────────────────

export function showCommentDialog(addr) {
    commentDialogAddr = addr;
    commentAddrInput.value = hex16(addr);

    const existing = commentManager.get(addr);
    if (existing) {
        commentDialogTitle.textContent = 'Edit Comment';
        commentSeparator.checked = existing.separator || false;
        commentBeforeInput.value = existing.before || '';
        commentInlineInput.value = existing.inline || '';
        commentAfterInput.value = existing.after || '';
        btnCommentDelete.style.display = 'inline-block';
    } else {
        commentDialogTitle.textContent = 'Add Comment';
        commentSeparator.checked = false;
        commentBeforeInput.value = '';
        commentInlineInput.value = '';
        commentAfterInput.value = '';
        btnCommentDelete.style.display = 'none';
    }

    commentDialog.classList.remove('hidden');
    commentInlineInput.focus();
}

export function closeCommentDialog() {
    commentDialog.classList.add('hidden');
    commentDialogAddr = null;
}

export function saveCommentFromDialog() {
    const addr = commentDialogAddr;
    if (addr === null) return;

    const oldComment = commentManager.get(addr);
    const newComment = {
        separator: commentSeparator.checked,
        before: commentBeforeInput.value,
        inline: commentInlineInput.value,
        after: commentAfterInput.value
    };

    commentManager.set(addr, newComment);

    undoManager.push({
        type: 'comment',
        description: oldComment ? `Update comment at ${hex16(addr)}` : `Add comment at ${hex16(addr)}`,
        undo: () => {
            if (oldComment) {
                commentManager.set(addr, oldComment);
            } else {
                commentManager.remove(addr);
            }
        },
        redo: () => {
            commentManager.set(addr, newComment);
        }
    });

    showMessage(`Comment ${commentManager.get(addr) ? 'saved' : 'removed'} at ${hex16(addr)}`);
    closeCommentDialog();
    updateDebugger();
}

export function deleteCommentFromDialog() {
    const addr = commentDialogAddr;
    if (addr === null) return;

    const oldComment = commentManager.get(addr);
    if (!oldComment) return;

    commentManager.remove(addr);

    undoManager.push({
        type: 'comment',
        description: `Delete comment at ${hex16(addr)}`,
        undo: () => {
            commentManager.set(addr, oldComment);
        },
        redo: () => {
            commentManager.remove(addr);
        }
    });

    showMessage(`Comment removed at ${hex16(addr)}`);
    closeCommentDialog();
    updateDebugger();
}

// ── Event listeners (wired up in init) ──────────────────────────────

function _initEventListeners() {
    // XRef tooltip on disasm hover
    disassemblyView.addEventListener('mouseover', (e) => {
        const operandAddr = e.target.closest('.disasm-operand-addr');
        if (!operandAddr) return;

        const addr = parseInt(operandAddr.dataset.addr, 10);
        if (isNaN(addr)) return;

        const refs = xrefManager.get(addr);
        if (refs.length === 0) return;

        if (xrefTooltipTimeout) clearTimeout(xrefTooltipTimeout);
        xrefTooltipTimeout = setTimeout(() => {
            showXRefTooltip(addr, refs, e.clientX, e.clientY);
        }, 300);
    });

    disassemblyView.addEventListener('mouseout', (e) => {
        const operandAddr = e.target.closest('.disasm-operand-addr');
        if (operandAddr) {
            hideXRefTooltip();
        }
    });

    // Label dialog buttons
    btnLabelCancel.addEventListener('click', closeLabelDialog);
    btnLabelSave.addEventListener('click', saveLabelFromDialog);

    labelDialog.addEventListener('click', (e) => {
        if (e.target === labelDialog) closeLabelDialog();
    });

    labelNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveLabelFromDialog();
        if (e.key === 'Escape') closeLabelDialog();
    });

    labelAddrInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            labelNameInput.focus();
            labelNameInput.select();
        }
        if (e.key === 'Escape') closeLabelDialog();
    });

    labelCommentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveLabelFromDialog();
        if (e.key === 'Escape') closeLabelDialog();
    });

    // Region dialog buttons
    btnRegionSave.addEventListener('click', saveRegionFromDialog);
    btnRegionCancel.addEventListener('click', closeRegionDialog);

    regionDialog.addEventListener('click', (e) => {
        if (e.target === regionDialog) closeRegionDialog();
    });

    regionEndInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveRegionFromDialog();
        if (e.key === 'Escape') closeRegionDialog();
    });

    // Fold dialog buttons
    btnFoldSave.addEventListener('click', saveFoldFromDialog);
    btnFoldCancel.addEventListener('click', closeFoldDialog);

    foldDialog.addEventListener('click', (e) => {
        if (e.target === foldDialog) closeFoldDialog();
    });

    foldEndInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveFoldFromDialog();
        if (e.key === 'Escape') closeFoldDialog();
    });

    foldNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveFoldFromDialog();
        if (e.key === 'Escape') closeFoldDialog();
    });

    // Comment dialog buttons
    btnCommentSave.addEventListener('click', saveCommentFromDialog);
    btnCommentDelete.addEventListener('click', deleteCommentFromDialog);
    btnCommentCancel.addEventListener('click', closeCommentDialog);

    commentDialog.addEventListener('click', (e) => {
        if (e.target === commentDialog) closeCommentDialog();
    });

    commentInlineInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveCommentFromDialog();
        if (e.key === 'Escape') closeCommentDialog();
    });

    // Disassembly right-click context menu for labels
    disassemblyView.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        closeLabelContextMenu();

        const line = e.target.closest('.disasm-line');
        if (!line) return;

        const lineAddr = parseInt(line.dataset.addr, 10);

        const operandAddrEl = e.target.closest('.disasm-operand-addr');
        const targetAddr = operandAddrEl ? parseInt(operandAddrEl.dataset.addr, 10) : null;

        const addr = targetAddr !== null ? targetAddr : lineAddr;
        const existingLabel = labelManager.get(addr);

        labelContextMenu = document.createElement('div');
        labelContextMenu.className = 'label-context-menu';

        const existingRegion = regionManager.get(addr);

        let menuHtml = `<div class="menu-header">Address ${hex16(addr)}</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="disasm-left">Disasm left</div>`;
        menuHtml += `<div data-action="disasm-right">Disasm right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="mem-left">Memory left</div>`;
        menuHtml += `<div data-action="mem-right">Memory right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        if (existingLabel) {
            menuHtml += `<div data-action="edit">Edit label "${existingLabel.name}"</div>`;
            menuHtml += `<div data-action="delete" class="danger">Delete label</div>`;
        } else {
            menuHtml += `<div data-action="add">Add label</div>`;
        }
        // Comment option
        const existingComment = commentManager.get(addr);
        if (existingComment) {
            menuHtml += `<div data-action="edit-comment">Edit comment</div>`;
            menuHtml += `<div data-action="delete-comment" class="danger">Delete comment</div>`;
        } else {
            menuHtml += `<div data-action="add-comment">Add comment</div>`;
        }
        menuHtml += `<div class="menu-separator"></div>`;
        // Operand format submenu
        const currentFormat = operandFormatManager.get(lineAddr);
        menuHtml += `<div class="menu-submenu">Operand format...
            <div class="menu-submenu-items">
                <div data-action="format-hex"${currentFormat === 'hex' ? ' class="selected"' : ''}>Hex (FFh)</div>
                <div data-action="format-dec"${currentFormat === 'dec' ? ' class="selected"' : ''}>Decimal (255)</div>
                <div data-action="format-bin"${currentFormat === 'bin' ? ' class="selected"' : ''}>Binary (%11111111)</div>
                <div data-action="format-char"${currentFormat === 'char' ? ' class="selected"' : ''}>Char ('A')</div>
            </div>
        </div>`;
        menuHtml += `<div class="menu-submenu">Mark as...
            <div class="menu-submenu-items">
                <div data-action="mark-code">Code</div>
                <div data-action="mark-db">DB (bytes)</div>
                <div data-action="mark-dw">DW (words)</div>
                <div data-action="mark-text">Text (ASCII)</div>
                <div data-action="mark-gfx">Graphics</div>
                <div data-action="mark-smc">SMC (self-mod)</div>
            </div>
        </div>`;
        if (existingRegion) {
            menuHtml += `<div data-action="remove-region" class="danger">Remove region mark</div>`;
        }
        menuHtml += `<div class="menu-separator"></div>`;
        const existingSub = subroutineManager.get(addr);
        if (existingSub) {
            menuHtml += `<div data-action="remove-sub" class="danger">Remove subroutine mark</div>`;
        } else {
            menuHtml += `<div data-action="add-sub">Mark as subroutine</div>`;
        }
        // Fold options
        menuHtml += `<div class="menu-separator"></div>`;
        const existingUserFold = foldManager.getUserFold(addr);
        if (existingUserFold) {
            menuHtml += `<div data-action="remove-fold" class="danger">Remove fold block</div>`;
        } else {
            menuHtml += `<div data-action="add-fold">Create fold block...</div>`;
        }
        menuHtml += `<div data-action="collapse-all">Collapse all folds</div>`;
        menuHtml += `<div data-action="expand-all">Expand all folds</div>`;
        labelContextMenu.innerHTML = menuHtml;

        labelContextMenu.style.left = e.clientX + 'px';
        labelContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(labelContextMenu);

        // Adjust submenu position if it would overflow viewport
        const submenu = labelContextMenu.querySelector('.menu-submenu');
        if (submenu) {
            const menuRect = labelContextMenu.getBoundingClientRect();
            const submenuItems = submenu.querySelector('.menu-submenu-items');
            if (submenuItems) {
                submenuItems.style.display = 'block';
                const subRect = submenuItems.getBoundingClientRect();
                submenuItems.style.display = '';

                if (menuRect.right + subRect.width > window.innerWidth) {
                    submenu.classList.add('submenu-left');
                }
                if (menuRect.top + subRect.height > window.innerHeight) {
                    submenu.classList.add('submenu-up');
                }
            }
        }

        labelContextMenu.addEventListener('click', (menuE) => {
            const action = menuE.target.dataset.action;
            if (!action) return;

            if (action === 'disasm-left') {
                goToLeftDisasm(addr);
            } else if (action === 'disasm-right') {
                goToRightDisasm(addr);
            } else if (action === 'mem-left') {
                goToLeftMemory(addr);
            } else if (action === 'mem-right') {
                goToRightMemory(addr);
            } else if (action === 'add') {
                showLabelDialog(addr);
            } else if (action === 'edit') {
                showLabelDialog(addr, existingLabel);
            } else if (action === 'delete') {
                const oldLabel = existingLabel;
                labelManager.remove(addr);
                undoManager.push({
                    type: 'label',
                    description: `Delete label "${oldLabel.name}"`,
                    undo: () => {
                        labelManager.add(oldLabel);
                        updateLabelsList();
                    },
                    redo: () => {
                        labelManager.remove(addr);
                        updateLabelsList();
                    }
                });
                showMessage(`Label "${oldLabel.name}" deleted`);
                updateDebugger();
            } else if (action === 'add-comment') {
                showCommentDialog(addr);
            } else if (action === 'edit-comment') {
                showCommentDialog(addr);
            } else if (action === 'delete-comment') {
                const oldComment = commentManager.get(addr);
                if (oldComment) {
                    commentManager.remove(addr);
                    undoManager.push({
                        type: 'comment',
                        description: `Delete comment at ${hex16(addr)}`,
                        undo: () => commentManager.set(addr, oldComment),
                        redo: () => commentManager.remove(addr)
                    });
                    showMessage(`Comment removed at ${hex16(addr)}`);
                    updateDebugger();
                }
            } else if (action === 'format-hex') {
                operandFormatManager.set(lineAddr, OPERAND_FORMATS.HEX);
                updateDebugger();
            } else if (action === 'format-dec') {
                operandFormatManager.set(lineAddr, OPERAND_FORMATS.DEC);
                updateDebugger();
            } else if (action === 'format-bin') {
                operandFormatManager.set(lineAddr, OPERAND_FORMATS.BIN);
                updateDebugger();
            } else if (action === 'format-char') {
                operandFormatManager.set(lineAddr, OPERAND_FORMATS.CHAR);
                updateDebugger();
            } else if (action === 'mark-code') {
                showRegionDialog(addr, REGION_TYPES.CODE);
            } else if (action === 'mark-db') {
                showRegionDialog(addr, REGION_TYPES.DB);
            } else if (action === 'mark-dw') {
                showRegionDialog(addr, REGION_TYPES.DW);
            } else if (action === 'mark-text') {
                showRegionDialog(addr, REGION_TYPES.TEXT);
            } else if (action === 'mark-gfx') {
                showRegionDialog(addr, REGION_TYPES.GRAPHICS);
            } else if (action === 'mark-smc') {
                showRegionDialog(addr, REGION_TYPES.SMC);
            } else if (action === 'remove-region') {
                const oldRegion = regionManager.get(addr);
                if (oldRegion) {
                    regionManager.remove(addr);
                    undoManager.push({
                        type: 'region',
                        description: `Remove region ${hex16(oldRegion.start)}-${hex16(oldRegion.end)}`,
                        undo: () => regionManager.add(oldRegion, true),
                        redo: () => regionManager.remove(addr)
                    });
                    showMessage('Region mark removed');
                    updateDebugger();
                }
            } else if (action === 'add-sub') {
                subroutineManager.add(addr);
                undoManager.push({
                    type: 'subroutine',
                    description: `Mark subroutine at ${hex16(addr)}`,
                    undo: () => {
                        subroutineManager.remove(addr);
                    },
                    redo: () => {
                        subroutineManager.add(addr);
                    }
                });
                showMessage(`Marked as subroutine at ${hex16(addr)}`);
                updateDebugger();
            } else if (action === 'remove-sub') {
                const oldSub = subroutineManager.get(addr);
                subroutineManager.remove(addr);
                undoManager.push({
                    type: 'subroutine',
                    description: `Remove subroutine at ${hex16(addr)}`,
                    undo: () => {
                        subroutineManager.add(addr, oldSub?.name, oldSub?.comment, oldSub?.auto);
                    },
                    redo: () => {
                        subroutineManager.remove(addr);
                    }
                });
                showMessage(`Subroutine mark removed at ${hex16(addr)}`);
                updateDebugger();
            } else if (action === 'add-fold') {
                showFoldDialog(addr);
            } else if (action === 'remove-fold') {
                const oldFold = foldManager.getUserFold(addr);
                if (oldFold) {
                    foldManager.removeUserFold(addr);
                    undoManager.push({
                        type: 'fold',
                        description: `Remove fold block at ${hex16(addr)}`,
                        undo: () => {
                            foldManager.addUserFold(addr, oldFold.endAddress, oldFold.name);
                        },
                        redo: () => {
                            foldManager.removeUserFold(addr);
                        }
                    });
                    showMessage(`Fold block removed at ${hex16(addr)}`);
                    updateDebugger();
                }
            } else if (action === 'collapse-all') {
                foldManager.collapseAll();
                showMessage('All folds collapsed');
                updateDebugger();
            } else if (action === 'expand-all') {
                foldManager.expandAll();
                showMessage('All folds expanded');
                updateDebugger();
            }

            closeLabelContextMenu();
        });
    });

    // Right panel disassembly right-click context menu (same as left panel)
    rightDisassemblyView.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        closeLabelContextMenu();

        const line = e.target.closest('.disasm-line');
        if (!line) return;

        const lineAddr = parseInt(line.dataset.addr, 10);
        const operandAddrEl = e.target.closest('.disasm-operand-addr');
        const targetAddr = operandAddrEl ? parseInt(operandAddrEl.dataset.addr, 10) : null;
        const addr = targetAddr !== null ? targetAddr : lineAddr;
        const existingLabel = labelManager.get(addr);

        labelContextMenu = document.createElement('div');
        labelContextMenu.className = 'label-context-menu';

        const existingRegion = regionManager.get(addr);

        let menuHtml = `<div class="menu-header">Address ${hex16(addr)}</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="disasm-left">Disasm left</div>`;
        menuHtml += `<div data-action="disasm-right">Disasm right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="mem-left">Memory left</div>`;
        menuHtml += `<div data-action="mem-right">Memory right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        if (existingLabel) {
            menuHtml += `<div data-action="edit">Edit label "${existingLabel.name}"</div>`;
            menuHtml += `<div data-action="delete" class="danger">Delete label</div>`;
        } else {
            menuHtml += `<div data-action="add">Add label</div>`;
        }
        const existingComment = commentManager.get(addr);
        if (existingComment) {
            menuHtml += `<div data-action="edit-comment">Edit comment</div>`;
            menuHtml += `<div data-action="delete-comment" class="danger">Delete comment</div>`;
        } else {
            menuHtml += `<div data-action="add-comment">Add comment</div>`;
        }
        menuHtml += `<div class="menu-separator"></div>`;
        const currentFormat = operandFormatManager.get(lineAddr);
        menuHtml += `<div class="menu-submenu">Operand format...
            <div class="menu-submenu-items">
                <div data-action="format-hex"${currentFormat === 'hex' ? ' class="selected"' : ''}>Hex (FFh)</div>
                <div data-action="format-dec"${currentFormat === 'dec' ? ' class="selected"' : ''}>Decimal (255)</div>
                <div data-action="format-bin"${currentFormat === 'bin' ? ' class="selected"' : ''}>Binary (%11111111)</div>
                <div data-action="format-char"${currentFormat === 'char' ? ' class="selected"' : ''}>Char ('A')</div>
            </div>
        </div>`;
        menuHtml += `<div class="menu-submenu">Mark as...
            <div class="menu-submenu-items">
                <div data-action="mark-code">Code</div>
                <div data-action="mark-db">DB (bytes)</div>
                <div data-action="mark-dw">DW (words)</div>
                <div data-action="mark-text">Text (ASCII)</div>
                <div data-action="mark-gfx">Graphics</div>
                <div data-action="mark-smc">SMC (self-mod)</div>
            </div>
        </div>`;
        if (existingRegion) {
            menuHtml += `<div data-action="remove-region" class="danger">Remove region mark</div>`;
        }
        menuHtml += `<div class="menu-separator"></div>`;
        const existingSub = subroutineManager.get(addr);
        if (existingSub) {
            menuHtml += `<div data-action="remove-sub" class="danger">Remove subroutine mark</div>`;
        } else {
            menuHtml += `<div data-action="add-sub">Mark as subroutine</div>`;
        }
        menuHtml += `<div class="menu-separator"></div>`;
        const existingUserFold = foldManager.getUserFold(addr);
        if (existingUserFold) {
            menuHtml += `<div data-action="remove-fold" class="danger">Remove fold block</div>`;
        } else {
            menuHtml += `<div data-action="add-fold">Create fold block...</div>`;
        }
        menuHtml += `<div data-action="collapse-all">Collapse all folds</div>`;
        menuHtml += `<div data-action="expand-all">Expand all folds</div>`;
        labelContextMenu.innerHTML = menuHtml;

        labelContextMenu.style.left = e.clientX + 'px';
        labelContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(labelContextMenu);

        labelContextMenu.addEventListener('click', (menuE) => {
            const action = menuE.target.dataset.action;
            if (action === 'disasm-left') {
                goToLeftDisasm(addr);
            } else if (action === 'disasm-right') {
                goToRightDisasm(addr);
            } else if (action === 'mem-left') {
                goToLeftMemory(addr);
            } else if (action === 'mem-right') {
                goToRightMemory(addr);
            } else if (action === 'add') {
                showLabelDialog(addr);
            } else if (action === 'edit') {
                showLabelDialog(addr, existingLabel);
            } else if (action === 'delete') {
                labelManager.remove(addr);
                showMessage(`Label "${existingLabel.name}" deleted`);
                updateDebugger();
            } else if (action === 'format-hex') {
                operandFormatManager.set(lineAddr, OPERAND_FORMATS.HEX);
                updateDebugger();
            } else if (action === 'format-dec') {
                operandFormatManager.set(lineAddr, OPERAND_FORMATS.DEC);
                updateDebugger();
            } else if (action === 'format-bin') {
                operandFormatManager.set(lineAddr, OPERAND_FORMATS.BIN);
                updateDebugger();
            } else if (action === 'format-char') {
                operandFormatManager.set(lineAddr, OPERAND_FORMATS.CHAR);
                updateDebugger();
            } else if (action === 'mark-code') {
                showRegionDialog(addr, REGION_TYPES.CODE);
            } else if (action === 'mark-db') {
                showRegionDialog(addr, REGION_TYPES.DB);
            } else if (action === 'mark-dw') {
                showRegionDialog(addr, REGION_TYPES.DW);
            } else if (action === 'mark-text') {
                showRegionDialog(addr, REGION_TYPES.TEXT);
            } else if (action === 'mark-gfx') {
                showRegionDialog(addr, REGION_TYPES.GRAPHICS);
            } else if (action === 'mark-smc') {
                showRegionDialog(addr, REGION_TYPES.SMC);
            } else if (action === 'remove-region') {
                regionManager.remove(addr);
                showMessage('Region mark removed');
                updateDebugger();
            } else if (action === 'add-comment' || action === 'edit-comment') {
                showCommentDialog(addr);
            } else if (action === 'delete-comment') {
                commentManager.remove(addr);
                showMessage(`Comment removed at ${hex16(addr)}`);
                updateDebugger();
            } else if (action === 'add-sub') {
                subroutineManager.add(addr);
                showMessage(`Marked as subroutine at ${hex16(addr)}`);
                updateDebugger();
            } else if (action === 'remove-sub') {
                subroutineManager.remove(addr);
                showMessage(`Subroutine mark removed at ${hex16(addr)}`);
                updateDebugger();
            } else if (action === 'add-fold') {
                showFoldDialog(addr);
            } else if (action === 'remove-fold') {
                foldManager.removeUserFold(addr);
                showMessage(`Fold block removed at ${hex16(addr)}`);
                updateDebugger();
            } else if (action === 'collapse-all') {
                foldManager.collapseAll();
                showMessage('All folds collapsed');
                updateDebugger();
            } else if (action === 'expand-all') {
                foldManager.expandAll();
                showMessage('All folds expanded');
                updateDebugger();
            }
            closeLabelContextMenu();
        });
    });

    // Close context menu on click elsewhere
    document.addEventListener('click', (e) => {
        if (labelContextMenu && !labelContextMenu.contains(e.target)) {
            closeLabelContextMenu();
        }
    });
}
