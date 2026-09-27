// Memory view — right panel hex dump + left panel hex dump,
// inline byte editor, mouse selection, scroll wheel
// Extracted from index.html

import { fmtByte, parseByte, getValueBase, onNumberBaseChange } from '../core/addr-format.js';
import { createMemDumpRenderer } from './mem-dump-render.js';

export function initMemoryView({
    getSpectrum, getDisasm, regionManager,
    getMemoryViewAddress, getLeftMemoryViewAddress,
    getMemorySnapshot, updateDebugger, getGoToMemoryAddress,
    MEMORY_LINES, LEFT_MEMORY_LINES, BYTES_PER_LINE
}) {
    // Both dumps draw their rows with this — see ui/mem-dump-render.js.
    const { renderDump } = createMemDumpRenderer({
        getSpectrum, getDisasm, regionManager, getMemorySnapshot
    });
    // DOM elements
    const memoryView = document.getElementById('memoryView');
    const leftMemoryView = document.getElementById('leftMemoryView');

    // Internal state
    let memoryEditingAddr = null;
    let activeEditInput = null;
    let memSelectionStart = null;
    let memSelectionEnd = null;
    let memIsSelecting = false;

    // ASCII selection state
    let asciiSelectionStart = null;
    let asciiSelectionEnd = null;
    let asciiIsSelecting = false;

    // Bytes per line adapt to the view width (8/16/32 so line addresses stay round).
    // Hex cells are 18px wide (.memory-byte); the ASCII char width is measured once.
    let rightBytesPerLine = BYTES_PER_LINE;
    let leftBytesPerLine = BYTES_PER_LINE;
    let asciiCharWidth = 0;
    let addrColWidth = 0;
    let byteCellWidth = 0;

    function calcBytesPerLine(view, fixedExtra, current) {
        if (!view.clientWidth) return current;  // hidden view: keep last value
        if (!asciiCharWidth) {
            const probe = document.createElement('span');
            probe.className = 'memory-ascii';
            probe.style.position = 'absolute';
            probe.style.visibility = 'hidden';
            probe.innerHTML = '<span>0</span><span>0</span><span>0</span><span>0</span>';
            view.appendChild(probe);
            asciiCharWidth = probe.getBoundingClientRect().width / 4 || 7;
            probe.remove();
        }
        if (!addrColWidth) {
            // .memory-addr is sized in ch and holds ADDR_COL_WIDTH characters, so it is
            // the same box in hex and decimal. Measured, not assumed: it used to be a
            // hard-coded 36 that stopped matching the CSS the moment the column grew.
            const probe = document.createElement('span');
            probe.className = 'memory-addr';
            probe.style.position = 'absolute';
            probe.style.visibility = 'hidden';
            probe.textContent = '00000';
            view.appendChild(probe);
            addrColWidth = probe.getBoundingClientRect().width || 45;
            probe.remove();
        }
        const avail = view.clientWidth - addrColWidth - fixedExtra;  // minus address column + margins
        if (!byteCellWidth) {
            const probe = document.createElement('span');
            probe.className = 'memory-byte';
            probe.style.position = 'absolute';
            probe.style.visibility = 'hidden';
            probe.textContent = '000';
            view.appendChild(probe);
            byteCellWidth = probe.getBoundingClientRect().width || 18;
            probe.remove();
        }
        const perByte = byteCellWidth + asciiCharWidth;
        if (avail >= 32 * perByte) return 32;
        if (avail >= 16 * perByte) return 16;
        return 8;
    }

    function updateMemoryView() {
        const spectrum = getSpectrum();
        if (!spectrum.memory || memoryEditingAddr !== null) return;

        rightBytesPerLine = calcBytesPerLine(memoryView, 20, rightBytesPerLine);
        memoryView.innerHTML = renderDump({
            startAddr: getMemoryViewAddress(),
            lines: MEMORY_LINES,
            bytesPerLine: rightBytesPerLine,
            // The right panel is the full one: changed bytes, breakpoint and
            // watchpoint marks, and the per-byte tooltip.
            showChanged: true,
            showBreakpoints: true,
            showWatchpoints: true,
            showTooltips: true,
            asciiSelectionStart, asciiSelectionEnd
        });

        // Reapply selection if active
        if (memSelectionStart !== null) {
            updateMemSelection();
        }
    }

    function finishCurrentEdit(save = true) {
        if (activeEditInput && memoryEditingAddr !== null) {
            const spectrum = getSpectrum();
            if (save) {
                // Read in the base the cell was printed in -- a field that shows 255
                // must not read it as $255.
                const newValue = parseByte(activeEditInput.value);
                if (newValue !== null && newValue >= 0 && newValue <= 255) {
                    spectrum.memory.writeDebug(memoryEditingAddr, newValue);
                }
            }
            activeEditInput = null;
            memoryEditingAddr = null;
            updateDebugger(); // Refresh both memory and disassembly
        }
    }

    function startByteEdit(byteElement) {
        // Finish any current edit first (this rebuilds DOM via updateDebugger)
        if (memoryEditingAddr !== null) {
            const addr = parseInt(byteElement.dataset.addr);
            finishCurrentEdit(true);
            // Re-query: finishCurrentEdit triggers DOM rebuild, old element is detached
            byteElement = memoryView.querySelector(`.memory-byte[data-addr="${addr}"]`);
            if (!byteElement) return;
        }

        const spectrum = getSpectrum();
        const addr = parseInt(byteElement.dataset.addr);
        memoryEditingAddr = addr;
        const currentValue = spectrum.memory.read(addr);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'memory-edit-input';
        input.value = fmtByte(currentValue);
        input.maxLength = getValueBase() === 'dec' ? 3 : 2;
        activeEditInput = input;

        byteElement.textContent = '';
        byteElement.appendChild(input);

        // Use setTimeout to ensure focus happens after DOM update
        setTimeout(() => {
            input.focus();
            input.select();
        }, 0);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishCurrentEdit(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishCurrentEdit(false);
            } else if (e.key === 'Tab') {
                e.preventDefault();
                const nextAddr = e.shiftKey ? (addr - 1) & 0xffff : (addr + 1) & 0xffff;
                finishCurrentEdit(true);
                setTimeout(() => {
                    const nextByte = memoryView.querySelector(`[data-addr="${nextAddr}"]`);
                    if (nextByte) startByteEdit(nextByte);
                }, 0);
            }
        });

        input.addEventListener('blur', () => {
            // Save on blur (focus lost to non-byte click, etc.)
            // finishCurrentEdit is idempotent — safe if already called by mousedown
            finishCurrentEdit(true);
        });
    }

    function clearMemSelection() {
        memSelectionStart = null;
        memSelectionEnd = null;
        memIsSelecting = false;
        memoryView.querySelectorAll('.memory-byte.selected').forEach(el => {
            el.classList.remove('selected');
        });
    }

    function updateMemSelection() {
        if (memSelectionStart === null) return;

        const start = Math.min(memSelectionStart, memSelectionEnd ?? memSelectionStart);
        const end = Math.max(memSelectionStart, memSelectionEnd ?? memSelectionStart);

        memoryView.querySelectorAll('.memory-byte').forEach(el => {
            const addr = parseInt(el.dataset.addr, 10);
            if (addr >= start && addr <= end) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
    }

    function clearAsciiSelection() {
        asciiSelectionStart = null;
        asciiSelectionEnd = null;
        asciiIsSelecting = false;
        memoryView.querySelectorAll('.memory-ascii > span.ascii-selected').forEach(el => {
            el.classList.remove('ascii-selected');
        });
    }

    function updateAsciiSelection() {
        if (asciiSelectionStart === null) return;

        const start = Math.min(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart);
        const end = Math.max(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart);

        memoryView.querySelectorAll('.memory-ascii > span[data-addr]').forEach(el => {
            const addr = parseInt(el.dataset.addr, 10);
            if (addr >= start && addr <= end) {
                el.classList.add('ascii-selected');
            } else {
                el.classList.remove('ascii-selected');
            }
        });
    }

    function getAsciiSelectionText() {
        if (asciiSelectionStart === null) return '';
        const spectrum = getSpectrum();
        const start = Math.min(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart);
        const end = Math.max(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart);
        let text = '';
        for (let addr = start; addr <= end; addr++) {
            const byte = spectrum.memory.read(addr & 0xffff);
            text += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : byte === 0 ? '\u25A0' : '.';
        }
        return text;
    }

    // Mouse event handlers
    memoryView.addEventListener('mousedown', (e) => {
        // ASCII span mousedown
        const asciiSpan = e.target.closest('.memory-ascii > span[data-addr]');
        if (asciiSpan && e.button === 0) {
            e.preventDefault();
            clearMemSelection();
            const addr = parseInt(asciiSpan.dataset.addr, 10);
            asciiSelectionStart = addr;
            asciiSelectionEnd = addr;
            asciiIsSelecting = true;
            updateAsciiSelection();
            return;
        }

        const byteEl = e.target.closest('.memory-byte');
        if (byteEl && !e.target.classList.contains('memory-edit-input')) {
            // Right-click: don't start selection, let context menu handle it
            if (e.button === 2) return;

            // Left-click: start selection or edit on double-click
            if (e.button === 0) {
                e.preventDefault();
                clearAsciiSelection();

                // Finish any active edit before starting a new interaction
                if (memoryEditingAddr !== null) {
                    finishCurrentEdit(true);
                }

                const addr = parseInt(byteEl.dataset.addr, 10);

                // Start selection
                memSelectionStart = addr;
                memSelectionEnd = addr;
                memIsSelecting = true;
                updateMemSelection();
            }
        }
    });

    memoryView.addEventListener('mousemove', (e) => {
        if (asciiIsSelecting) {
            const asciiSpan = e.target.closest('.memory-ascii > span[data-addr]');
            if (asciiSpan) {
                const addr = parseInt(asciiSpan.dataset.addr, 10);
                asciiSelectionEnd = addr;
                updateAsciiSelection();
            }
            return;
        }

        if (!memIsSelecting) return;

        const byteEl = e.target.closest('.memory-byte');
        if (byteEl) {
            const addr = parseInt(byteEl.dataset.addr, 10);
            memSelectionEnd = addr;
            updateMemSelection();
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (asciiIsSelecting) {
            asciiIsSelecting = false;
        }
        if (memIsSelecting) {
            memIsSelecting = false;
            // If single click (no drag), treat as edit
            if (memSelectionStart === memSelectionEnd && e.button === 0) {
                const byteEl = memoryView.querySelector(`.memory-byte[data-addr="${memSelectionStart}"]`);
                if (byteEl && !e.target.classList.contains('memory-edit-input')) {
                    clearMemSelection();
                    startByteEdit(byteEl);
                }
            }
        }
    });

    // Ctrl+C to copy ASCII selection (e.code: layout-independent)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && asciiSelectionStart !== null) {
            const text = getAsciiSelectionText();
            if (text) {
                e.preventDefault();
                navigator.clipboard.writeText(text);
            }
        }
    });

    // Scroll wheel navigation
    memoryView.addEventListener('wheel', (e) => {
        e.preventDefault();
        const goToMemoryAddress = getGoToMemoryAddress();
        const memoryViewAddress = getMemoryViewAddress();
        // Scroll by 3 lines per wheel tick
        const scrollLines = e.deltaY > 0 ? 3 : -3;
        goToMemoryAddress(memoryViewAddress + scrollLines * rightBytesPerLine);
    }, { passive: false });

    // Left panel memory view
    function updateLeftMemoryView() {
        const spectrum = getSpectrum();
        if (!spectrum.memory) {
            leftMemoryView.innerHTML = '<div class="memory-line">No memory</div>';
            return;
        }

        leftBytesPerLine = calcBytesPerLine(leftMemoryView, 26, leftBytesPerLine);
        // The plain dump: regions and the four-byte rule, nothing else. It has never
        // shown changed bytes, breakpoint/watchpoint marks or the tooltip \u2014 stated
        // here by their absence rather than by which lines got copied across.
        leftMemoryView.innerHTML = renderDump({
            startAddr: getLeftMemoryViewAddress(),
            lines: LEFT_MEMORY_LINES,
            bytesPerLine: leftBytesPerLine,
            asciiSelectionStart, asciiSelectionEnd
        });
    }

    // Hex or decimal addresses: both dumps redraw their gutter, and the column
    // is measured again in case the switch changed its width.
    onNumberBaseChange(() => {
        addrColWidth = 0;
        byteCellWidth = 0;
        updateMemoryView();
        updateLeftMemoryView();
    });

    return {
        updateMemoryView,
        updateLeftMemoryView,
        getRightBytesPerLine: () => rightBytesPerLine,
        getLeftBytesPerLine: () => leftBytesPerLine,
        clearMemSelection,
        clearAsciiSelection,
        getMemSelection: () => ({ start: memSelectionStart, end: memSelectionEnd }),
        getAsciiSelection: () => ({ start: asciiSelectionStart, end: asciiSelectionEnd }),
        getMemoryEditingAddr: () => memoryEditingAddr,
        startByteEdit,
        finishCurrentEdit
    };
}
