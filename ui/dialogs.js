// dialogs.js — Label, Region, Fold, and Comment dialogs (extracted from index.html)
import { hex16 } from '../core/utils.js';

export function initDialogs({
    labelManager, regionManager, commentManager, foldManager, undoManager,
    REGION_TYPES,
    showMessage, updateDebugger, updateLabelsList
}) {

    // Label context menu and dialog
    let labelContextMenu = null;
    let labelDialogAddr = null;
    const labelDialog = document.getElementById('labelDialog');
    const labelDialogTitle = document.getElementById('labelDialogTitle');
    const labelAddrInput = document.getElementById('labelAddrInput');
    const labelNameInput = document.getElementById('labelNameInput');
    const labelCommentInput = document.getElementById('labelCommentInput');
    const btnLabelCancel = document.getElementById('btnLabelCancel');
    const btnLabelSave = document.getElementById('btnLabelSave');

    function closeLabelContextMenu() {
        if (labelContextMenu) {
            labelContextMenu.remove();
            labelContextMenu = null;
        }
    }

    function showLabelDialog(addr, pageOrLabel = null) {
        // If addr is null, we're adding a new label with editable address
        // If pageOrLabel is an object, it's an existing label; if number/null, it's a page
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
        } else {
            labelNameInput.value = '';
            labelCommentInput.value = '';
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

    function closeLabelDialog() {
        labelDialog.classList.add('hidden');
        labelDialogAddr = null;
    }

    function saveLabelFromDialog() {
        let addr = labelDialogAddr;

        // If addr is null, parse from input
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

        // Validate label name: must start with letter/underscore, contain only letters/digits/underscores
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            showMessage('Invalid label: use letters, digits, _ (start with letter or _)', 'error');
            labelNameInput.focus();
            return;
        }

        // Check for duplicate name (case-insensitive, different address)
        const existing = labelManager.findByName(name);
        if (existing && existing.address !== addr) {
            showMessage(`Label "${existing.name}" already exists at ${hex16(existing.address)}`, 'error');
            labelNameInput.focus();
            return;
        }

        // Capture old label for undo
        const oldLabel = labelManager.get(addr);
        const newLabel = {
            address: addr,
            name: name,
            comment: labelCommentInput.value.trim()
        };

        labelManager.add(newLabel);

        // Push undo action
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

    btnLabelCancel.addEventListener('click', closeLabelDialog);
    btnLabelSave.addEventListener('click', saveLabelFromDialog);

    labelDialog.addEventListener('click', (e) => {
        if (e.target === labelDialog) closeLabelDialog();
    });

    labelNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveLabelFromDialog();
        if (e.key === 'Escape') closeLabelDialog();
    });

    // Region dialog
    const regionDialog = document.getElementById('regionDialog');
    const regionDialogTitle = document.getElementById('regionDialogTitle');
    const regionStartInput = document.getElementById('regionStartInput');
    const regionEndInput = document.getElementById('regionEndInput');
    const regionTypeSelect = document.getElementById('regionTypeSelect');
    const regionCommentInput = document.getElementById('regionCommentInput');
    const btnRegionSave = document.getElementById('btnRegionSave');
    const btnRegionCancel = document.getElementById('btnRegionCancel');
    let regionDialogStartAddr = null;

    function showRegionDialog(startAddr, type = REGION_TYPES.CODE, endAddr = null) {
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

    function closeRegionDialog() {
        regionDialog.classList.add('hidden');
        regionDialogStartAddr = null;
    }

    function saveRegionFromDialog() {
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

        // Check for overlapping regions
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
                regionManager.add(newRegion, true);  // allowOverwrite for redo
            }
        });

        showMessage(`Region ${hex16(startAddr)}-${hex16(endAddr)} marked as ${regionTypeSelect.value}`);
        closeRegionDialog();
        updateDebugger();
    }

    btnRegionSave.addEventListener('click', saveRegionFromDialog);
    btnRegionCancel.addEventListener('click', closeRegionDialog);

    regionDialog.addEventListener('click', (e) => {
        if (e.target === regionDialog) closeRegionDialog();
    });

    regionEndInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveRegionFromDialog();
        if (e.key === 'Escape') closeRegionDialog();
    });

    // Fold dialog elements and state
    const foldDialog = document.getElementById('foldDialog');
    const foldStartInput = document.getElementById('foldStartInput');
    const foldEndInput = document.getElementById('foldEndInput');
    const foldNameInput = document.getElementById('foldNameInput');
    const btnFoldSave = document.getElementById('btnFoldSave');
    const btnFoldCancel = document.getElementById('btnFoldCancel');
    let foldDialogStartAddr = null;

    function showFoldDialog(startAddr, endAddr = null) {
        foldDialogStartAddr = startAddr;
        foldStartInput.value = hex16(startAddr);
        foldEndInput.value = endAddr !== null ? hex16(endAddr) : '';
        foldNameInput.value = '';

        foldDialog.classList.remove('hidden');
        if (endAddr !== null) {
            foldNameInput.focus();
        } else {
            foldEndInput.focus();
        }
    }

    function closeFoldDialog() {
        foldDialog.classList.add('hidden');
        foldDialogStartAddr = null;
    }

    function saveFoldFromDialog() {
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

    // Comment dialog elements and state
    const commentDialog = document.getElementById('commentDialog');
    const commentDialogTitle = document.getElementById('commentDialogTitle');
    const commentAddrInput = document.getElementById('commentAddrInput');
    const commentSeparator = document.getElementById('commentSeparator');
    const commentBeforeInput = document.getElementById('commentBeforeInput');
    const commentInlineInput = document.getElementById('commentInlineInput');
    const commentAfterInput = document.getElementById('commentAfterInput');
    const btnCommentSave = document.getElementById('btnCommentSave');
    const btnCommentDelete = document.getElementById('btnCommentDelete');
    const btnCommentCancel = document.getElementById('btnCommentCancel');
    let commentDialogAddr = null;

    function showCommentDialog(addr) {
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

    function closeCommentDialog() {
        commentDialog.classList.add('hidden');
        commentDialogAddr = null;
    }

    function saveCommentFromDialog() {
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

    function deleteCommentFromDialog() {
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

    return {
        showLabelDialog,
        showRegionDialog,
        showFoldDialog,
        showCommentDialog,
        closeLabelContextMenu,
        get labelContextMenu() { return labelContextMenu; },
        set labelContextMenu(v) { labelContextMenu = v; }
    };
}
