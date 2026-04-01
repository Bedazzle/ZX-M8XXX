// Keyboard Shortcuts — global keydown handler (init-function pattern, DI)

import { hex16 } from '../core/utils.js';

export function initKeyboardShortcuts({
    getSpectrum,
    getDisasm,
    undoManager, traceManager,
    getMapperAPI, getGameMapper, getRegEditorAPI, getAutofireAPI,
    getDisasmViewAddress, setDisasmViewAddress,
    getRightDisasmViewAddress, setRightDisasmViewAddress,
    getLeftPanelType, getRightPanelType,
    getLeftBookmarks, setLeftBookmark,
    getRightBookmarks, setRightBookmark,
    getLeftMemoryViewAddress, getMemoryViewAddress,
    getTraceViewAddress, setTraceViewAddress,
    getRunToTarget,
    showMessage, updateStatus, updateDebugger,
    openDebuggerPanel,
    goToAddress, goToMemoryAddress,
    goToLeftMemoryAddress, goToRightDisasmAddress,
    switchLeftPanelType, switchRightPanelType,
    updateBookmarkButtons,
    showTraceEntry, updateTraceStatus, updateTraceList,
    setZoom, getCurrentZoom,
    DISASM_LINES, BYTES_PER_LINE, MEMORY_LINES, LEFT_MEMORY_LINES
}) {
    // DOM elements discovered internally
    const disasmAddressInput = document.getElementById('disasmAddress');
    const disasmBookmarksBar = document.getElementById('disasmBookmarks');
    const memoryBookmarksBar = document.getElementById('memoryBookmarks');

    // Track which panel the mouse is over for PgUp/PgDn dispatch
    let lastActivePanel = 'left'; // default to left
    const leftPanel = document.getElementById('leftPanel');
    const rightPanel = document.getElementById('rightPanel');
    leftPanel.addEventListener('mouseenter', () => { lastActivePanel = 'left'; });
    rightPanel.addEventListener('mouseenter', () => { lastActivePanel = 'right'; });

    document.addEventListener('keydown', (e) => {
        const spectrum = getSpectrum();
        const disasm = getDisasm();
        const mapperAPI = getMapperAPI();
        const gameMapper = getGameMapper();
        const regEditorAPI = getRegEditorAPI();

        // Don't capture if typing in input fields or editing registers
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.target.isContentEditable || regEditorAPI.isEditingRegister()) return;

        // Ctrl+F - Toggle autofire
        if (e.ctrlKey && e.key === 'f' && !e.altKey && !e.repeat) {
            e.preventDefault();
            getAutofireAPI().toggleAutofire();
            return;
        }

        // Mapper stamp dialog: Escape to close
        if (e.key === 'Escape' && mapperAPI.isStampDialogOpen()) {
            e.preventDefault();
            mapperAPI.closeStampDialog();
            return;
        }

        // Mapper text slide dialog: Escape to close
        if (e.key === 'Escape' && mapperAPI.isTextSlideDialogOpen()) {
            e.preventDefault();
            mapperAPI.closeTextSlideDialog();
            return;
        }

        // Mapper hotkeys (Ctrl+Space = capture, Ctrl+Arrows = navigate, Ctrl+Shift+Up/Down = floor)
        if (e.ctrlKey && !e.altKey && !e.repeat) {
            const mapperTab = document.getElementById('tools-mapper');
            if (mapperTab && mapperTab.classList.contains('active')) {
                // Ctrl+Shift+Up/Down = change floor
                if (e.shiftKey && e.key === 'ArrowUp') {
                    e.preventDefault();
                    mapperAPI.action(() => { gameMapper.moveFloor(1); mapperAPI.updateUI(); });
                    return;
                }
                if (e.shiftKey && e.key === 'ArrowDown') {
                    e.preventDefault();
                    mapperAPI.action(() => { gameMapper.moveFloor(-1); mapperAPI.updateUI(); });
                    return;
                }
                // Ctrl (no Shift) shortcuts
                if (!e.shiftKey) {
                    if (e.code === 'Space') {
                        e.preventDefault();
                        mapperAPI.action(mapperAPI.captureScreen);
                        return;
                    }
                    if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        mapperAPI.action(() => { gameMapper.move(-1, 0); mapperAPI.updateUI(); });
                        return;
                    }
                    if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        mapperAPI.action(() => { gameMapper.move(1, 0); mapperAPI.updateUI(); });
                        return;
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        mapperAPI.action(() => { gameMapper.move(0, -1); mapperAPI.updateUI(); });
                        return;
                    }
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        mapperAPI.action(() => { gameMapper.move(0, 1); mapperAPI.updateUI(); });
                        return;
                    }
                    if (e.key === 'Delete') {
                        e.preventDefault();
                        mapperAPI.action(() => mapperAPI.deleteRoom());
                        return;
                    }
                }
            }
        }

        // Ctrl+Z - Undo (only when emulator is paused to not interfere with BASIC)
        if (e.ctrlKey && e.key === 'z' && !spectrum.isRunning()) {
            e.preventDefault();
            undoManager.undo();
            return;
        }
        // Ctrl+Y - Redo (only when emulator is paused)
        if (e.ctrlKey && e.key === 'y' && !spectrum.isRunning()) {
            e.preventDefault();
            undoManager.redo();
            return;
        }

        // Alt+Left - Trace back
        if (e.altKey && e.key === 'ArrowLeft' && !spectrum.isRunning()) {
            e.preventDefault();
            const entry = traceManager.goBack();
            if (entry) {
                showTraceEntry(entry);
            }
            return;
        }
        // Alt+Right - Trace forward
        if (e.altKey && e.key === 'ArrowRight' && !spectrum.isRunning()) {
            e.preventDefault();
            const entry = traceManager.goForward();
            if (entry) {
                showTraceEntry(entry);
            } else {
                traceManager.goToLive();
                updateTraceStatus();
                updateTraceList();
                showMessage('Returned to live view');
            }
            return;
        }

        // PageUp/PageDown - Scroll last-clicked panel (disasm or memory view)
        if (e.key === 'PageUp' || e.key === 'PageDown') {
            e.preventDefault();
            const leftPanelType = getLeftPanelType();
            const rightPanelType = getRightPanelType();
            const down = e.key === 'PageDown';

            // Determine target: prefer last-clicked panel, fall back to other
            let target = lastActivePanel;
            const targetType = target === 'left' ? leftPanelType : rightPanelType;
            const otherType = target === 'left' ? rightPanelType : leftPanelType;
            // If target panel has no scrollable view, try the other
            if (targetType !== 'disasm' && targetType !== 'memdump') {
                target = target === 'left' ? 'right' : 'left';
            }

            const panelType = target === 'left' ? leftPanelType : rightPanelType;

            if (panelType === 'disasm') {
                if (!disasm) return;
                const delta = down ? DISASM_LINES * 2 : -(DISASM_LINES * 2);
                if (target === 'left') {
                    let addr = getDisasmViewAddress();
                    if (addr === null && spectrum.cpu) addr = spectrum.cpu.pc;
                    if (addr !== null) {
                        addr = (addr + delta) & 0xffff;
                        setDisasmViewAddress(addr);
                        disasmAddressInput.value = hex16(addr);
                        updateDebugger();
                    }
                } else {
                    let addr = getRightDisasmViewAddress();
                    if (addr === null && spectrum.cpu) addr = spectrum.cpu.pc;
                    if (addr !== null) goToRightDisasmAddress(addr + delta);
                }
            } else if (panelType === 'memdump') {
                if (target === 'left') {
                    const lines = down ? LEFT_MEMORY_LINES : -LEFT_MEMORY_LINES;
                    goToLeftMemoryAddress(getLeftMemoryViewAddress() + lines * BYTES_PER_LINE);
                } else {
                    const lines = down ? MEMORY_LINES : -MEMORY_LINES;
                    goToMemoryAddress(getMemoryViewAddress() + lines * BYTES_PER_LINE);
                }
            }
            return;
        }

        // Paused-mode hotkeys: bookmarks and tilde-run
        if (!spectrum.isRunning() && !e.ctrlKey && !e.altKey) {
            // Tilde (`) - Resume emulation
            if (e.key === '`' || e.key === '~') {
                e.preventDefault();
                if (spectrum.romLoaded) {
                    spectrum.start();
                    updateStatus();
                    showMessage('Resumed');
                }
                return;
            }

            // ArrowUp/ArrowDown - scroll last-clicked panel by 1 line (disasm or memory)
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const leftPanelType = getLeftPanelType();
                const rightPanelType = getRightPanelType();
                const down = e.key === 'ArrowDown';

                let target = lastActivePanel;
                const targetType = target === 'left' ? leftPanelType : rightPanelType;
                if (targetType !== 'disasm' && targetType !== 'memdump') {
                    target = target === 'left' ? 'right' : 'left';
                }

                const panelType = target === 'left' ? leftPanelType : rightPanelType;

                if (panelType === 'disasm') {
                    if (!disasm) return;
                    const delta = down ? 2 : -2;
                    if (target === 'left') {
                        let addr = getDisasmViewAddress();
                        if (addr === null && spectrum.cpu) addr = spectrum.cpu.pc;
                        if (addr !== null) {
                            addr = (addr + delta) & 0xffff;
                            setDisasmViewAddress(addr);
                            disasmAddressInput.value = hex16(addr);
                            updateDebugger();
                        }
                    } else {
                        let addr = getRightDisasmViewAddress();
                        if (addr === null && spectrum.cpu) addr = spectrum.cpu.pc;
                        if (addr !== null) goToRightDisasmAddress(addr + delta);
                    }
                } else if (panelType === 'memdump') {
                    const delta = down ? BYTES_PER_LINE : -BYTES_PER_LINE;
                    if (target === 'left') {
                        goToLeftMemoryAddress(getLeftMemoryViewAddress() + delta);
                    } else {
                        goToMemoryAddress(getMemoryViewAddress() + delta);
                    }
                }
                return;
            }

            // ArrowLeft/ArrowRight - scroll hovered panel by +/-1 byte
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const leftPanelType = getLeftPanelType();
                const rightPanelType = getRightPanelType();
                const delta = e.key === 'ArrowRight' ? 1 : -1;

                let target = lastActivePanel;
                const targetType = target === 'left' ? leftPanelType : rightPanelType;
                if (targetType !== 'disasm' && targetType !== 'memdump') {
                    target = target === 'left' ? 'right' : 'left';
                }

                const panelType = target === 'left' ? leftPanelType : rightPanelType;

                if (panelType === 'disasm') {
                    if (!disasm) return;
                    if (target === 'left') {
                        let addr = getDisasmViewAddress();
                        if (addr === null && spectrum.cpu) addr = spectrum.cpu.pc;
                        if (addr !== null) {
                            addr = (addr + delta) & 0xffff;
                            setDisasmViewAddress(addr);
                            disasmAddressInput.value = hex16(addr);
                            updateDebugger();
                        }
                    } else {
                        let addr = getRightDisasmViewAddress();
                        if (addr === null && spectrum.cpu) addr = spectrum.cpu.pc;
                        if (addr !== null) goToRightDisasmAddress(addr + delta);
                    }
                } else if (panelType === 'memdump') {
                    if (target === 'left') {
                        goToLeftMemoryAddress(getLeftMemoryViewAddress() + delta);
                    } else {
                        goToMemoryAddress(getMemoryViewAddress() + delta);
                    }
                }
                return;
            }

            // Digit code to index mapping (works regardless of Shift)
            const digitCode = e.code;  // 'Digit1'..'Digit0'
            const digitMatch = digitCode && digitCode.match(/^Digit(\d)$/);
            if (digitMatch) {
                const digit = digitMatch[1]; // '0'..'9'
                const leftMap = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4 };
                const rightMap = { '6': 0, '7': 1, '8': 2, '9': 3, '0': 4 };
                const leftPanelType = getLeftPanelType();
                const rightPanelType = getRightPanelType();

                if (!e.shiftKey) {
                    // Jump to bookmark
                    if (digit in leftMap && leftPanelType !== 'calc') {
                        e.preventDefault();
                        const leftBookmarks = getLeftBookmarks();
                        const bm = leftBookmarks[leftMap[digit]];
                        if (bm !== null) {
                            const addr = typeof bm === 'object' ? bm.addr : bm;
                            const type = typeof bm === 'object' ? bm.type : 'disasm';
                            if (type !== leftPanelType) switchLeftPanelType(type);
                            if (leftPanelType === 'disasm') goToAddress(addr);
                            else goToLeftMemoryAddress(addr);
                        }
                        return;
                    }
                    if (digit in rightMap && rightPanelType !== 'calc') {
                        e.preventDefault();
                        const rightBookmarks = getRightBookmarks();
                        const bm = rightBookmarks[rightMap[digit]];
                        if (bm !== null) {
                            const addr = typeof bm === 'object' ? bm.addr : bm;
                            const type = typeof bm === 'object' ? bm.type : 'memdump';
                            if (type !== rightPanelType) switchRightPanelType(type);
                            if (rightPanelType === 'memdump') goToMemoryAddress(addr);
                            else goToRightDisasmAddress(addr);
                        }
                        return;
                    }
                } else {
                    // Shift+digit: set bookmark at current address
                    if (digit in leftMap && leftPanelType !== 'calc') {
                        e.preventDefault();
                        const idx = leftMap[digit];
                        let addr, type = leftPanelType;
                        if (type === 'disasm') {
                            const dva = getDisasmViewAddress();
                            addr = dva !== null ? dva : (spectrum.cpu ? spectrum.cpu.pc : null);
                        } else {
                            addr = getLeftMemoryViewAddress();
                        }
                        if (addr !== null) {
                            const leftBookmarks = getLeftBookmarks();
                            const oldBm = leftBookmarks[idx];
                            setLeftBookmark(idx, { addr, type });
                            updateBookmarkButtons(disasmBookmarksBar, getLeftBookmarks(), 'left');
                            undoManager.push({
                                type: 'bookmark',
                                description: oldBm !== null ? `Update left bookmark ${idx + 1}` : `Set left bookmark ${idx + 1}`,
                                undo: () => { setLeftBookmark(idx, oldBm); updateBookmarkButtons(disasmBookmarksBar, getLeftBookmarks(), 'left'); },
                                redo: () => { setLeftBookmark(idx, { addr, type }); updateBookmarkButtons(disasmBookmarksBar, getLeftBookmarks(), 'left'); }
                            });
                            showMessage(`Left bookmark ${idx + 1} set to ${hex16(addr)}`);
                        }
                        return;
                    }
                    if (digit in rightMap && rightPanelType !== 'calc') {
                        e.preventDefault();
                        const idx = rightMap[digit];
                        let addr, type = rightPanelType;
                        if (type === 'memdump') {
                            addr = getMemoryViewAddress();
                        } else {
                            const rdva = getRightDisasmViewAddress();
                            addr = rdva !== null ? rdva : (spectrum.cpu ? spectrum.cpu.pc : null);
                        }
                        if (addr !== null) {
                            const rightBookmarks = getRightBookmarks();
                            const oldBm = rightBookmarks[idx];
                            setRightBookmark(idx, { addr, type });
                            updateBookmarkButtons(memoryBookmarksBar, getRightBookmarks(), 'right');
                            undoManager.push({
                                type: 'bookmark',
                                description: oldBm !== null ? `Update right bookmark ${idx + 1}` : `Set right bookmark ${idx + 1}`,
                                undo: () => { setRightBookmark(idx, oldBm); updateBookmarkButtons(memoryBookmarksBar, getRightBookmarks(), 'right'); },
                                redo: () => { setRightBookmark(idx, { addr, type }); updateBookmarkButtons(memoryBookmarksBar, getRightBookmarks(), 'right'); }
                            });
                            showMessage(`Right bookmark ${idx + 1} set to ${hex16(addr)}`);
                        }
                        return;
                    }
                }
            }
        }

        // F1 - Cycle zoom (x1 -> x2 -> x3 -> x1)
        if (e.key === 'F1') {
            e.preventDefault();
            const nextZoom = getCurrentZoom() >= 3 ? 1 : getCurrentZoom() + 1;
            setZoom(nextZoom);
            showMessage(`Zoom x${nextZoom}`);
            return;
        }

        // F10 - Cycle overlay mode
        if (e.key === 'F10') {
            e.preventDefault();
            const modes = ['normal', 'grid', 'box', 'screen', 'reveal', 'beam', 'beamscreen', 'noattr', 'nobitmap'];
            const oSel = document.getElementById('overlaySelect');
            const curIdx = modes.indexOf(oSel.value);
            const nextIdx = (curIdx + 1) % modes.length;
            oSel.value = modes[nextIdx];
            spectrum.setOverlayMode(modes[nextIdx]);
            spectrum.redraw();
            showMessage(`Overlay: ${oSel.options[oSel.selectedIndex].text}`);
            return;
        }

        // F6 - Pause/Resume
        if (e.code === 'F6' || e.key === 'F6' || e.key === 'Pause') {
            e.preventDefault();
            if (spectrum.romLoaded) {
                spectrum.toggle();
                updateStatus();
                showMessage(spectrum.isRunning() ? 'Resumed' : 'Paused');
            }
            return;
        }
        // F7 - Step Into
        if (e.code === 'F7' || e.key === 'F7') {
            e.preventDefault();
            if (!spectrum.romLoaded) return;
            if (spectrum.isRunning()) {
                spectrum.stop();
                updateStatus();
            }
            traceManager.goToLive();
            setTraceViewAddress(null);
            spectrum.stepInto();
            openDebuggerPanel();
            updateDebugger();
            updateStatus();
            return;
        }
        // F8 - Step Over
        if (e.code === 'F8' || e.key === 'F8') {
            e.preventDefault();
            if (!spectrum.romLoaded) return;
            if (spectrum.isRunning()) {
                spectrum.stop();
                updateStatus();
            }
            traceManager.goToLive();
            setTraceViewAddress(null);
            spectrum.stepOver();
            openDebuggerPanel();
            updateDebugger();
            updateStatus();
            return;
        }
        // F4 - Run to Cursor
        if (e.key === 'F4') {
            e.preventDefault();
            if (!spectrum.romLoaded) return;
            const runToTarget = getRunToTarget();
            if (runToTarget === null) {
                showMessage('Click a disassembly line first', 'error');
                return;
            }
            if (spectrum.isRunning()) {
                spectrum.stop();
            }
            traceManager.goToLive();
            setTraceViewAddress(null);
            const reached = spectrum.runToAddress(runToTarget);
            if (reached) {
                showMessage(`Reached ${hex16(runToTarget)}`);
            } else {
                showMessage('Target not reached', 'error');
            }
            openDebuggerPanel();
            updateDebugger();
            updateStatus();
            return;
        }
        // F9 - Toggle Breakpoint at PC
        if (e.key === 'F9') {
            e.preventDefault();
            if (!spectrum.romLoaded) return;
            const pc = spectrum.cpu.pc;
            const isSet = spectrum.toggleBreakpoint(pc);
            showMessage(isSet ? `Breakpoint set at ${hex16(pc)}` : `Breakpoint removed at ${hex16(pc)}`);
            openDebuggerPanel();
            updateDebugger();
            return;
        }
    });

    return {};
}
