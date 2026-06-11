// Memory view — right panel hex dump + left panel hex dump,
// inline byte editor, mouse selection, scroll wheel
// Extracted from index.html

import { hex8, hex16 } from '../core/utils.js';
import { REGION_TYPES } from '../debug/managers.js';

export function initMemoryView({
    getSpectrum, getDisasm, regionManager,
    getMemoryViewAddress, getLeftMemoryViewAddress,
    getMemorySnapshot, updateDebugger, getGoToMemoryAddress,
    MEMORY_LINES, LEFT_MEMORY_LINES, BYTES_PER_LINE
}) {
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
        const avail = view.clientWidth - 36 - fixedExtra;  // minus address column + margins
        const perByte = 18 + asciiCharWidth;
        if (avail >= 32 * perByte) return 32;
        if (avail >= 16 * perByte) return 16;
        return 8;
    }

    function updateMemoryView() {
        const spectrum = getSpectrum();
        const memorySnapshot = getMemorySnapshot();
        const disasm = getDisasm();
        const memoryViewAddress = getMemoryViewAddress();
        if (!spectrum.memory || memoryEditingAddr !== null) return;

        rightBytesPerLine = calcBytesPerLine(memoryView, 20, rightBytesPerLine);
        let html = '';
        for (let line = 0; line < MEMORY_LINES; line++) {
            const lineAddr = (memoryViewAddress + line * rightBytesPerLine) & 0xffff;

            // Address
            html += `<div class="memory-line"><span class="memory-addr" data-addr="${lineAddr}">${hex16(lineAddr)}</span>`;

            // Hex bytes
            html += '<span class="memory-hex">';
            for (let i = 0; i < rightBytesPerLine; i++) {
                const addr = (lineAddr + i) & 0xffff;
                const byte = spectrum.memory.read(addr);
                const changed = memorySnapshot && memorySnapshot[addr] !== byte;
                let cls = changed ? 'memory-byte changed' : 'memory-byte';
                // Check for breakpoints
                if (spectrum.hasBreakpointAt(addr)) {
                    cls += ' has-bp';
                }
                // Check for watchpoints
                const wps = spectrum.getWatchpoints();
                for (const wp of wps) {
                    if (addr >= wp.start && addr <= wp.end) {
                        if (wp.read && wp.write) cls += ' has-wp';
                        else if (wp.read) cls += ' has-wp-r';
                        else if (wp.write) cls += ' has-wp-w';
                        break;
                    }
                }
                // Check for memory regions
                const region = regionManager.get(addr);
                if (region && region.type !== REGION_TYPES.CODE) {
                    cls += ` region-${region.type}`;
                }
                const lowByte = byte & 0x7F;
                const isPrintableLow = lowByte >= 32 && lowByte < 127;
                let asciiChar = '';
                if (byte >= 32 && byte < 127) {
                    asciiChar = ` '${String.fromCharCode(byte)}'`;
                } else if ((byte & 0x80) && isPrintableLow) {
                    asciiChar = ` '${String.fromCharCode(lowByte)}'+$80`;
                }
                let tip = `Addr: ${hex16(addr)} (${addr})\nValue: ${hex8(byte)} (${byte})${asciiChar}`;
                if (region && region.type !== REGION_TYPES.CODE) {
                    tip += `\nRegion: ${region.type}${region.comment ? ' - ' + region.comment : ''}`;
                }
                // Add disassembly (if disassembler available)
                if (disasm) {
                    const instr = disasm.disassemble(addr);
                    const bytes = instr.bytes.map(b => hex8(b)).join(' ');
                    tip += `\n${instr.mnemonic} [${bytes}]`;
                }
                html += `<span class="${cls}" data-addr="${addr}" title="${tip}">${hex8(byte)}</span>`;
            }
            html += '</span>';

            // ASCII representation
            html += '<span class="memory-ascii">';
            const asciiSelStart = asciiSelectionStart !== null ? Math.min(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart) : -1;
            const asciiSelEnd = asciiSelectionStart !== null ? Math.max(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart) : -1;
            for (let i = 0; i < rightBytesPerLine; i++) {
                const addr = (lineAddr + i) & 0xffff;
                const byte = spectrum.memory.read(addr);
                const isPrintable = byte >= 32 && byte < 127;
                const char = isPrintable ? String.fromCharCode(byte) : byte === 0 ? '\u25A0' : '.';
                const changed = memorySnapshot && memorySnapshot[addr] !== byte;
                const asciiRegion = regionManager.get(addr);
                let cls = isPrintable ? 'printable' : byte === 0 ? 'null-byte' : '';
                if (changed) cls += ' changed';
                if (asciiRegion && asciiRegion.type === REGION_TYPES.TEXT) {
                    cls += ' region-text';
                }
                if (asciiSelectionStart !== null && addr >= asciiSelStart && addr <= asciiSelEnd) {
                    cls += ' ascii-selected';
                }
                html += `<span class="${cls.trim()}" data-addr="${addr}">${char}</span>`;
            }
            html += '</span></div>';
        }

        memoryView.innerHTML = html;

        // Reapply selection if active
        if (memSelectionStart !== null) {
            updateMemSelection();
        }
    }

    function finishCurrentEdit(save = true) {
        if (activeEditInput && memoryEditingAddr !== null) {
            const spectrum = getSpectrum();
            if (save) {
                const newValue = parseInt(activeEditInput.value, 16);
                if (!isNaN(newValue) && newValue >= 0 && newValue <= 255) {
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
        input.value = hex8(currentValue);
        input.maxLength = 2;
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

    // Ctrl+C to copy ASCII selection
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && asciiSelectionStart !== null) {
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
        const leftMemoryViewAddress = getLeftMemoryViewAddress();
        if (!spectrum.memory) {
            leftMemoryView.innerHTML = '<div class="memory-line">No memory</div>';
            return;
        }

        leftBytesPerLine = calcBytesPerLine(leftMemoryView, 26, leftBytesPerLine);
        let html = '';
        for (let line = 0; line < LEFT_MEMORY_LINES; line++) {
            const lineAddr = (leftMemoryViewAddress + line * leftBytesPerLine) & 0xffff;

            // Address
            html += `<div class="memory-line"><span class="memory-addr" data-addr="${lineAddr}">${hex16(lineAddr)}</span>`;

            // Hex bytes
            html += '<span class="memory-hex">';
            for (let i = 0; i < leftBytesPerLine; i++) {
                const addr = (lineAddr + i) & 0xffff;
                const val = spectrum.memory.read(addr);
                let cls = 'memory-byte';
                // Check for memory regions
                const region = regionManager.get(addr);
                if (region && region.type !== REGION_TYPES.CODE) {
                    cls += ` region-${region.type}`;
                }
                html += `<span class="${cls}" data-addr="${addr}">${hex8(val)}</span>`;
            }
            html += '</span>';

            // ASCII representation (styled like right panel)
            html += '<span class="memory-ascii">';
            const asciiSelStart = asciiSelectionStart !== null ? Math.min(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart) : -1;
            const asciiSelEnd = asciiSelectionStart !== null ? Math.max(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart) : -1;
            for (let i = 0; i < leftBytesPerLine; i++) {
                const addr = (lineAddr + i) & 0xffff;
                const byte = spectrum.memory.read(addr);
                const isPrintable = byte >= 32 && byte < 127;
                const char = isPrintable ? String.fromCharCode(byte) : byte === 0 ? '\u25A0' : '.';
                const asciiRegion = regionManager.get(addr);
                let cls = isPrintable ? 'printable' : byte === 0 ? 'null-byte' : '';
                if (asciiRegion && asciiRegion.type === REGION_TYPES.TEXT) {
                    cls += ' region-text';
                }
                if (asciiSelectionStart !== null && addr >= asciiSelStart && addr <= asciiSelEnd) {
                    cls += ' ascii-selected';
                }
                html += `<span class="${cls.trim()}" data-addr="${addr}">${char}</span>`;
            }
            html += '</span></div>';
        }

        leftMemoryView.innerHTML = html;
    }

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
