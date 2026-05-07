// bookmarks.js — Bookmark management for left/right debugger panels (extracted from index.html)

import { hex16 } from '../core/utils.js';

export function initBookmarks({
    getSpectrum,
    undoManager,
    getLeftPanelType, getRightPanelType,
    getDisasmViewAddress, getLeftMemoryViewAddress,
    getMemoryViewAddress, getRightDisasmViewAddress,
    getLeftBookmarks, setLeftBookmark,
    getRightBookmarks, setRightBookmark,
    switchLeftPanelType, switchRightPanelType,
    goToAddress, goToMemoryAddress,
    goToLeftMemoryAddress, goToRightDisasmAddress,
    getCalcValue, setCalcValue,
    showMessage
}) {
    const disasmBookmarksBar = document.getElementById('disasmBookmarks');
    const memoryBookmarksBar = document.getElementById('memoryBookmarks');

    // Bookmarks handling - updated to store type info with emoji indicators
    function updateBookmarkButtons(bar, bookmarks, panelSide) {
        const buttons = bar.querySelectorAll('.bookmark-btn');
        const currentType = panelSide === 'left' ? getLeftPanelType() : getRightPanelType();
        // Emoji indicators: 🔍 for disasm (code inspection), 📦 for memory (raw data), 🔢 for calculator
        const typeEmoji = { disasm: '🔍', memdump: '📦', calc: '🔢' };
        buttons.forEach((btn, i) => {
            const bm = bookmarks[i];
            if (bm !== null && typeof bm === 'object') {
                // New format: {addr, type}
                const emoji = typeEmoji[bm.type] || '';
                btn.textContent = `${emoji}${hex16(bm.addr)}`;
                btn.classList.add('set');
                btn.classList.toggle('type-mismatch', bm.type !== currentType);
                btn.title = `${bm.type}: ${hex16(bm.addr)} (Click: go, Right-click: set, Ctrl+click: clear)`;
            } else if (bm !== null) {
                // Legacy format: just address (assume current panel type)
                btn.textContent = hex16(bm);
                btn.classList.add('set');
                btn.classList.remove('type-mismatch');
            } else {
                btn.textContent = '-';
                btn.classList.remove('set');
                btn.classList.remove('type-mismatch');
            }
        });
    }

    function setupBookmarkHandlers(bar, bookmarks, panelSide) {
        const buttons = bar.querySelectorAll('.bookmark-btn');

        const getBookmarks = panelSide === 'left' ? getLeftBookmarks : getRightBookmarks;
        const setBookmark = panelSide === 'left' ? setLeftBookmark : setRightBookmark;

        buttons.forEach((btn) => {
            const idx = parseInt(btn.dataset.index);

            // Left click: navigate to bookmark (switch panel type if needed)
            // Ctrl+click: clear bookmark
            btn.addEventListener('click', (e) => {
                if (e.ctrlKey) {
                    const currentBookmarks = getBookmarks();
                    const oldBm = currentBookmarks[idx];
                    if (oldBm !== null) {
                        setBookmark(idx, null);
                        updateBookmarkButtons(bar, getBookmarks(), panelSide);
                        undoManager.push({
                            type: 'bookmark',
                            description: `Clear ${panelSide} bookmark ${idx + 1}`,
                            undo: () => {
                                setBookmark(idx, oldBm);
                                updateBookmarkButtons(bar, getBookmarks(), panelSide);
                            },
                            redo: () => {
                                setBookmark(idx, null);
                                updateBookmarkButtons(bar, getBookmarks(), panelSide);
                            }
                        });
                        showMessage(`${panelSide === 'left' ? 'Left' : 'Right'} bookmark ${idx + 1} cleared`);
                    }
                    return;
                }
                const currentBookmarks = getBookmarks();
                const bm = currentBookmarks[idx];
                if (bm !== null) {
                    const addr = typeof bm === 'object' ? bm.addr : bm;
                    const type = typeof bm === 'object' ? bm.type : (panelSide === 'left' ? 'disasm' : 'memdump');

                    if (panelSide === 'left') {
                        if (type !== getLeftPanelType()) {
                            switchLeftPanelType(type);
                        }
                        if (getLeftPanelType() === 'disasm') {
                            goToAddress(addr);
                        } else {
                            goToLeftMemoryAddress(addr);
                        }
                    } else {
                        // Right panel: handle calculator type
                        if (type === 'calc') {
                            if (getRightPanelType() !== 'calc') {
                                switchRightPanelType('calc');
                            }
                            setCalcValue(addr);
                        } else {
                            if (type !== getRightPanelType()) {
                                switchRightPanelType(type);
                            }
                            if (getRightPanelType() === 'memdump') {
                                goToMemoryAddress(addr);
                            } else if (getRightPanelType() === 'disasm') {
                                goToRightDisasmAddress(addr);
                            }
                        }
                    }
                    updateBookmarkButtons(bar, currentBookmarks, panelSide);
                }
            });

            // Right click: set bookmark to current address and type
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const spectrum = getSpectrum();
                let addr, type;

                if (panelSide === 'left') {
                    type = getLeftPanelType();
                    if (type === 'disasm') {
                        const dva = getDisasmViewAddress();
                        addr = dva !== null ? dva : (spectrum.cpu ? spectrum.cpu.pc : null);
                    } else {
                        addr = getLeftMemoryViewAddress();
                    }
                } else {
                    type = getRightPanelType();
                    if (type === 'calc') {
                        addr = getCalcValue();
                    } else if (type === 'memdump') {
                        addr = getMemoryViewAddress();
                    } else {
                        const rdva = getRightDisasmViewAddress();
                        addr = rdva !== null ? rdva : (spectrum.cpu ? spectrum.cpu.pc : null);
                    }
                }

                if (addr !== null) {
                    const currentBookmarks = getBookmarks();
                    const oldBm = currentBookmarks[idx];
                    setBookmark(idx, { addr, type });
                    updateBookmarkButtons(bar, currentBookmarks, panelSide);

                    undoManager.push({
                        type: 'bookmark',
                        description: oldBm !== null
                            ? `Update ${panelSide} bookmark ${idx + 1}`
                            : `Set ${panelSide} bookmark ${idx + 1}`,
                        undo: () => {
                            setBookmark(idx, oldBm);
                            updateBookmarkButtons(bar, getBookmarks(), panelSide);
                        },
                        redo: () => {
                            setBookmark(idx, { addr, type });
                            updateBookmarkButtons(bar, getBookmarks(), panelSide);
                        }
                    });
                }
            });
        });
    }

    // Setup left panel bookmarks
    setupBookmarkHandlers(disasmBookmarksBar, getLeftBookmarks(), 'left');

    // Setup right panel bookmarks
    setupBookmarkHandlers(memoryBookmarksBar, getRightBookmarks(), 'right');

    return { updateBookmarkButtons, setupBookmarkHandlers };
}
