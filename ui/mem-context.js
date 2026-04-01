// Memory context menus (left + right panels) and click-outside handlers
import { hex16 } from '../core/utils.js';

export function initMemContext({
    labelManager, regionManager, undoManager,
    REGION_TYPES,
    getSpectrum,
    dialogs,
    showMessage, updateDebugger, updateLabelsList,
    goToLeftDisasm, goToRightDisasm, goToLeftMemory, goToRightMemory,
    addWatch, addFreezeEditor,
    getMemSelection, clearMemSelection,
    getMemoryEditingAddr, finishCurrentEdit
}) {
    const { showLabelDialog, showRegionDialog, closeLabelContextMenu } = dialogs;

    const memoryView = document.getElementById('memoryView');
    const leftMemoryView = document.getElementById('leftMemoryView');

    // ---- Menu state ----
    let memContextMenu = null;
    let leftMemContextMenu = null;

    function closeMemContextMenu() {
        if (memContextMenu) {
            memContextMenu.remove();
            memContextMenu = null;
        }
    }

    function closeLeftMemContextMenu() {
        if (leftMemContextMenu) {
            leftMemContextMenu.remove();
            leftMemContextMenu = null;
        }
    }

    // ---- Shared builders ----

    function buildMenuHtml(addr, existingLabel, existingRegion, rangeText) {
        let menuHtml = `<div class="menu-header">Address ${hex16(addr)}</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="disasm-left">Disasm left</div>`;
        menuHtml += `<div data-action="disasm-right">Disasm right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="mem-left">Memory left</div>`;
        menuHtml += `<div data-action="mem-right">Memory right</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        if (existingLabel) {
            menuHtml += `<div data-action="edit-label">Edit label "${existingLabel.name}"</div>`;
            menuHtml += `<div data-action="delete-label" class="danger">Delete label</div>`;
        } else {
            menuHtml += `<div data-action="add-label">Add label</div>`;
        }
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div class="menu-submenu">Mark as...${rangeText ? ' ' + rangeText : ''}
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
        return menuHtml;
    }

    function adjustMenuOverflow(menu) {
        const menuRect = menu.getBoundingClientRect();
        if (menuRect.bottom > window.innerHeight) {
            menu.style.top = Math.max(0, parseInt(menu.style.top) - menuRect.height) + 'px';
        }
        if (menuRect.right > window.innerWidth) {
            menu.style.left = Math.max(0, parseInt(menu.style.left) - menuRect.width) + 'px';
        }

        // Adjust submenu position
        const submenu = menu.querySelector('.menu-submenu');
        if (submenu) {
            const freshRect = menu.getBoundingClientRect();
            const submenuItems = submenu.querySelector('.menu-submenu-items');
            if (submenuItems) {
                submenuItems.style.display = 'block';
                const subRect = submenuItems.getBoundingClientRect();
                submenuItems.style.display = '';

                if (freshRect.right + subRect.width > window.innerWidth) {
                    submenu.classList.add('submenu-left');
                }
                if (freshRect.top + subRect.height > window.innerHeight) {
                    submenu.classList.add('submenu-up');
                }
            }
        }
    }

    function handleMenuAction(action, addr, endAddr, existingLabel) {
        if (action === 'disasm-left') {
            goToLeftDisasm(addr);
        } else if (action === 'disasm-right') {
            goToRightDisasm(addr);
        } else if (action === 'mem-left') {
            goToLeftMemory(addr);
        } else if (action === 'mem-right') {
            goToRightMemory(addr);
        } else if (action === 'add-label') {
            showLabelDialog(addr);
        } else if (action === 'edit-label') {
            showLabelDialog(addr, existingLabel);
        } else if (action === 'delete-label') {
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
            showMessage(`Label "${existingLabel.name}" deleted`);
            updateDebugger();
        } else if (action === 'mark-code') {
            showRegionDialog(addr, REGION_TYPES.CODE, endAddr);
        } else if (action === 'mark-db') {
            showRegionDialog(addr, REGION_TYPES.DB, endAddr);
        } else if (action === 'mark-dw') {
            showRegionDialog(addr, REGION_TYPES.DW, endAddr);
        } else if (action === 'mark-text') {
            showRegionDialog(addr, REGION_TYPES.TEXT, endAddr);
        } else if (action === 'mark-gfx') {
            showRegionDialog(addr, REGION_TYPES.GRAPHICS, endAddr);
        } else if (action === 'mark-smc') {
            showRegionDialog(addr, REGION_TYPES.SMC, endAddr);
        } else if (action === 'remove-region') {
            const oldRegion = regionManager.get(addr);
            if (oldRegion) {
                regionManager.remove(addr);
                undoManager.push({
                    type: 'region',
                    description: `Remove region ${hex16(oldRegion.start)}-${hex16(oldRegion.end)}`,
                    undo: () => {
                        regionManager.add(oldRegion, true);
                    },
                    redo: () => {
                        regionManager.remove(addr);
                    }
                });
                showMessage('Region mark removed');
                updateDebugger();
            }
        } else if (action === 'watch-read' || action === 'watch-write' || action === 'watch-rw') {
            const spectrum = getSpectrum();
            const wpType = action === 'watch-read' ? 'read' : action === 'watch-write' ? 'write' : 'rw';
            const wpEnd = endAddr !== null ? endAddr : addr;
            spectrum.addTrigger({ type: wpType, start: addr, end: wpEnd });
            const typeLabel = spectrum.getTriggerLabel(wpType);
            const rangeStr = wpEnd !== addr ? `${hex16(addr)}-${hex16(wpEnd)}` : hex16(addr);
            showMessage(`Break on ${typeLabel} at ${rangeStr}`);
            updateDebugger();
        } else if (action === 'add-watch') {
            const label = existingLabel ? existingLabel.name : '';
            if (addWatch(addr, label)) {
                showMessage(`Watch added: ${hex16(addr)}${label ? ' (' + label + ')' : ''}`);
            }
        } else if (action === 'freeze-value') {
            if (addFreezeEditor) {
                const label = existingLabel ? existingLabel.name : '';
                addFreezeEditor(addr, label);
                showMessage(`Freeze added: ${hex16(addr)}${label ? ' (' + label + ')' : ''}`);
            }
        }
    }

    // ---- Right memory panel context menu ----

    memoryView.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        closeMemContextMenu();
        closeLeftMemContextMenu();
        closeLabelContextMenu();

        const byteEl = e.target.closest('.memory-byte') || e.target.closest('.memory-addr');
        if (!byteEl || !byteEl.dataset.addr) return;

        const clickedAddr = parseInt(byteEl.dataset.addr, 10);

        // Determine selection range
        const sel = getMemSelection();
        let hasSelection = sel.start !== null && sel.end !== null && sel.start !== sel.end;
        let selStart, selEnd;

        if (hasSelection) {
            selStart = Math.min(sel.start, sel.end);
            selEnd = Math.max(sel.start, sel.end);
            if (clickedAddr < selStart || clickedAddr > selEnd) {
                hasSelection = false;
            }
        }

        const addr = hasSelection ? selStart : clickedAddr;
        const endAddr = hasSelection ? selEnd : null;
        const existingLabel = labelManager.get(addr);
        const existingRegion = regionManager.get(addr);

        memContextMenu = document.createElement('div');
        memContextMenu.className = 'label-context-menu';

        const rangeText = hasSelection ?
            `${hex16(selStart)}-${hex16(selEnd)} (${selEnd - selStart + 1} bytes)` :
            '';

        let menuHtml = buildMenuHtml(addr, existingLabel, existingRegion, rangeText);
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="watch-read">Break on read</div>`;
        menuHtml += `<div data-action="watch-write">Break on write</div>`;
        menuHtml += `<div data-action="watch-rw">Break on R/W</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="add-watch">Add watch</div>`;
        menuHtml += `<div data-action="freeze-value">Freeze value</div>`;
        memContextMenu.innerHTML = menuHtml;

        memContextMenu.style.left = e.clientX + 'px';
        memContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(memContextMenu);

        adjustMenuOverflow(memContextMenu);

        memContextMenu.addEventListener('click', (menuE) => {
            const action = menuE.target.dataset.action;
            handleMenuAction(action, addr, endAddr, existingLabel);
            clearMemSelection();
            closeMemContextMenu();
        });
    });

    // ---- Left memory panel context menu ----

    leftMemoryView.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        closeLeftMemContextMenu();
        closeMemContextMenu();
        closeLabelContextMenu();

        const byteEl = e.target.closest('.memory-byte') || e.target.closest('.memory-addr');
        if (!byteEl || !byteEl.dataset.addr) return;

        const addr = parseInt(byteEl.dataset.addr, 10);
        const existingLabel = labelManager.get(addr);
        const existingRegion = regionManager.get(addr);

        leftMemContextMenu = document.createElement('div');
        leftMemContextMenu.className = 'label-context-menu';

        let menuHtml = buildMenuHtml(addr, existingLabel, existingRegion, '');
        menuHtml += `<div class="menu-separator"></div>`;
        menuHtml += `<div data-action="add-watch">Add watch</div>`;
        menuHtml += `<div data-action="freeze-value">Freeze value</div>`;
        leftMemContextMenu.innerHTML = menuHtml;

        leftMemContextMenu.style.left = e.clientX + 'px';
        leftMemContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(leftMemContextMenu);

        leftMemContextMenu.addEventListener('click', (menuE) => {
            const action = menuE.target.dataset.action;
            handleMenuAction(action, addr, null, existingLabel);
            closeLeftMemContextMenu();
        });
    });

    // ---- Click-outside handlers ----

    document.addEventListener('click', (e) => {
        if (leftMemContextMenu && !leftMemContextMenu.contains(e.target)) {
            closeLeftMemContextMenu();
        }
        if (memContextMenu && !memContextMenu.contains(e.target)) {
            closeMemContextMenu();
        }
        // Clear memory selection when clicking outside memory view
        const sel = getMemSelection();
        if (sel.start !== null && !memoryView.contains(e.target) &&
            (!memContextMenu || !memContextMenu.contains(e.target))) {
            clearMemSelection();
        }
    });

    // Finish edit when clicking outside memory view
    document.addEventListener('mousedown', (e) => {
        if (getMemoryEditingAddr() !== null && !memoryView.contains(e.target)) {
            finishCurrentEdit(true);
        }
    });

    return { closeMemContextMenu, closeLeftMemContextMenu };
}
