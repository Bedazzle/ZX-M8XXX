// Disassembly context menus (left + right panels), XRef tooltip, and click-outside handler
import { hex16 } from '../core/utils.js';

function getConditionalInfo(opcode) {
    // Conditional JP cc,nn (3 bytes) → JP nn
    if ((opcode & 0xC7) === 0xC2) return { uncondOpcode: 0xC3, label: 'JP' };
    // Conditional CALL cc,nn (3 bytes) → CALL nn
    if ((opcode & 0xC7) === 0xC4) return { uncondOpcode: 0xCD, label: 'CALL' };
    // Conditional JR cc,e (2 bytes) → JR e
    if ((opcode & 0xE7) === 0x20) return { uncondOpcode: 0x18, label: 'JR' };
    // Conditional RET cc (1 byte) → RET
    if ((opcode & 0xC7) === 0xC0) return { uncondOpcode: 0xC9, label: 'RET' };
    return null;
}

export function initDisasmContext({
    labelManager, regionManager, commentManager, operandFormatManager,
    subroutineManager, foldManager, undoManager, xrefManager,
    REGION_TYPES, OPERAND_FORMATS,
    dialogs,
    closeMemContextMenu, closeLeftMemContextMenu,
    showMessage, updateDebugger, updateLabelsList,
    goToLeftDisasm, goToRightDisasm, goToLeftMemory, goToRightMemory,
    getRightPanelType,
    readMemory, addPoke, getInstrLength
}) {
    const { showLabelDialog, showRegionDialog, showFoldDialog,
            showCommentDialog, closeLabelContextMenu } = dialogs;

    const disassemblyView = document.getElementById('disassemblyView');
    const rightDisassemblyView = document.getElementById('rightDisassemblyView');

    // ---- XRef tooltip ----
    const xrefTooltip = document.getElementById('xrefTooltip');
    let xrefTooltipTimeout = null;

    function showXRefTooltip(addr, refs, x, y) {
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

        // Sort by address
        refs.sort((a, b) => a.fromAddr - b.fromAddr);

        // Limit display
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

        // Adjust if off-screen
        const rect = xrefTooltip.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            xrefTooltip.style.left = (x - rect.width - 5) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            xrefTooltip.style.top = (y - rect.height - 5) + 'px';
        }
    }

    function hideXRefTooltip() {
        xrefTooltip.style.display = 'none';
        if (xrefTooltipTimeout) {
            clearTimeout(xrefTooltipTimeout);
            xrefTooltipTimeout = null;
        }
    }

    // Left disasm XRef mouseover/mouseout
    disassemblyView.addEventListener('mouseover', (e) => {
        const operandAddr = e.target.closest('.disasm-operand-addr');
        if (!operandAddr) return;

        const addr = parseInt(operandAddr.dataset.addr, 10);
        if (isNaN(addr)) return;

        const refs = xrefManager.get(addr);
        if (refs.length === 0) return;

        // Delay showing tooltip
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

    // Right disasm XRef mouseover/mouseout
    rightDisassemblyView.addEventListener('mouseover', (e) => {
        if (getRightPanelType() !== 'disasm') return;
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

    rightDisassemblyView.addEventListener('mouseout', (e) => {
        if (getRightPanelType() !== 'disasm') return;
        const operandAddr = e.target.closest('.disasm-operand-addr');
        if (operandAddr) {
            hideXRefTooltip();
        }
    });

    // ---- Shared context menu builders ----

    function buildContextMenuHtml(addr, lineAddr) {
        const existingLabel = labelManager.get(addr);
        const existingRegion = regionManager.get(addr);
        const existingComment = commentManager.get(addr);
        const currentFormat = operandFormatManager.get(lineAddr);
        const existingSub = subroutineManager.get(addr);
        const existingUserFold = foldManager.getUserFold(addr);

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
        if (existingComment) {
            menuHtml += `<div data-action="edit-comment">Edit comment</div>`;
            menuHtml += `<div data-action="delete-comment" class="danger">Delete comment</div>`;
        } else {
            menuHtml += `<div data-action="add-comment">Add comment</div>`;
        }
        menuHtml += `<div class="menu-separator"></div>`;
        // Operand format submenu
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
        if (existingSub) {
            menuHtml += `<div data-action="remove-sub" class="danger">Remove subroutine mark</div>`;
        } else {
            menuHtml += `<div data-action="add-sub">Mark as subroutine</div>`;
        }
        // Fold options
        menuHtml += `<div class="menu-separator"></div>`;
        if (existingUserFold) {
            menuHtml += `<div data-action="remove-fold" class="danger">Remove fold block</div>`;
        } else {
            menuHtml += `<div data-action="add-fold">Create fold block...</div>`;
        }
        menuHtml += `<div data-action="collapse-all">Collapse all folds</div>`;
        menuHtml += `<div data-action="expand-all">Expand all folds</div>`;
        menuHtml += `<div class="menu-separator"></div>`;
        const opcode = readMemory ? readMemory(lineAddr) : 0;
        const condInfo = getConditionalInfo(opcode);
        if (condInfo && readMemory) {
            const len = getInstrLength ? getInstrLength(lineAddr) : 1;
            menuHtml += `<div class="menu-submenu">Add poke...
                <div class="menu-submenu-items">
                    <div data-action="add-poke-nop">NOP (${len} byte${len > 1 ? 's' : ''})</div>
                    <div data-action="add-poke-uncond">${condInfo.label} unconditional</div>
                </div>
            </div>`;
        } else {
            menuHtml += `<div data-action="add-poke">Add poke</div>`;
        }
        return menuHtml;
    }

    function adjustSubmenuOverflow(menu) {
        const submenu = menu.querySelector('.menu-submenu');
        if (submenu) {
            const menuRect = menu.getBoundingClientRect();
            const submenuItems = submenu.querySelector('.menu-submenu-items');
            if (submenuItems) {
                // Temporarily show to measure
                submenuItems.style.display = 'block';
                const subRect = submenuItems.getBoundingClientRect();
                submenuItems.style.display = '';

                // Check horizontal overflow
                if (menuRect.right + subRect.width > window.innerWidth) {
                    submenu.classList.add('submenu-left');
                }
                // Check vertical overflow
                if (menuRect.top + subRect.height > window.innerHeight) {
                    submenu.classList.add('submenu-up');
                }
            }
        }
    }

    function handleContextMenuAction(action, addr, lineAddr) {
        const existingLabel = labelManager.get(addr);

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
                    undo: () => {
                        regionManager.add(oldRegion, true);  // allowOverwrite for undo
                    },
                    redo: () => {
                        regionManager.remove(addr);
                    }
                });
                showMessage('Region mark removed');
                updateDebugger();
            }
        } else if (action === 'add-comment' || action === 'edit-comment') {
            showCommentDialog(addr);
        } else if (action === 'delete-comment') {
            const oldComment = commentManager.get(addr);
            if (oldComment) {
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
        } else if (action === 'add-poke' || action === 'add-poke-nop') {
            if (readMemory && addPoke) {
                const len = getInstrLength ? getInstrLength(lineAddr) : 1;
                const patches = [];
                for (let i = 0; i < len; i++) {
                    const a = (lineAddr + i) & 0xffff;
                    const val = readMemory(a);
                    patches.push({ addr: a, normal: val, poke: 0 });
                }
                addPoke(hex16(lineAddr), patches);
                showMessage(`Poke added at $${hex16(lineAddr)} (${len} byte${len > 1 ? 's' : ''})`);
            }
        } else if (action === 'add-poke-uncond') {
            if (readMemory && addPoke) {
                const opcode = readMemory(lineAddr);
                const condInfo = getConditionalInfo(opcode);
                if (condInfo) {
                    const patches = [{ addr: lineAddr, normal: opcode, poke: condInfo.uncondOpcode }];
                    addPoke(hex16(lineAddr) + ' uncond', patches);
                    showMessage(`Poke added: ${condInfo.label} unconditional at $${hex16(lineAddr)}`);
                }
            }
        }
        closeLabelContextMenu();
    }

    function showContextMenu(e, disasmView) {
        e.preventDefault();
        closeLabelContextMenu();
        closeMemContextMenu();
        closeLeftMemContextMenu();
        hideXRefTooltip();

        const line = e.target.closest('.disasm-line');
        if (!line) return;

        const lineAddr = parseInt(line.dataset.addr, 10);

        // Check if clicking on operand address (e.g., JP 4000h)
        const operandAddrEl = e.target.closest('.disasm-operand-addr');
        const targetAddr = operandAddrEl ? parseInt(operandAddrEl.dataset.addr, 10) : null;

        // Use target address if clicking on operand, otherwise use line address
        const addr = targetAddr !== null ? targetAddr : lineAddr;

        dialogs.labelContextMenu = document.createElement('div');
        dialogs.labelContextMenu.className = 'label-context-menu';

        dialogs.labelContextMenu.innerHTML = buildContextMenuHtml(addr, lineAddr);

        dialogs.labelContextMenu.style.left = e.clientX + 'px';
        dialogs.labelContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(dialogs.labelContextMenu);

        adjustSubmenuOverflow(dialogs.labelContextMenu);

        dialogs.labelContextMenu.addEventListener('click', (menuE) => {
            const action = menuE.target.dataset.action;
            handleContextMenuAction(action, addr, lineAddr);
        });
    }

    // ---- Context menu event listeners ----

    // Left disassembly context menu
    disassemblyView.addEventListener('contextmenu', (e) => {
        showContextMenu(e, disassemblyView);
    });

    // Right disassembly context menu
    rightDisassemblyView.addEventListener('contextmenu', (e) => {
        showContextMenu(e, rightDisassemblyView);
    });

    // Close context menu on click elsewhere
    document.addEventListener('click', (e) => {
        if (dialogs.labelContextMenu && !dialogs.labelContextMenu.contains(e.target)) {
            closeLabelContextMenu();
        }
    });

    return { hideXRefTooltip };
}
