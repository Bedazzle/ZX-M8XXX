// Stack view & call stack display — value highlighting, context menus, navigation

import { fmtAddr } from '../core/addr-format.js';

export function initStackView({
    getSpectrum, labelManager, traceManager, getCurrentPage,
    navigateToAddress, goToMemoryAddress, goToRightMemoryAddress,
    setDisasmViewAddress, setRightDisasmViewAddress,
    updateDebugger, updateRightDisassemblyView
}) {
    const stackView = document.getElementById('stackView');
    const callStackView = document.getElementById('callStackView');

    // Stack view state
    let previousSP = null;
    let previousStackValues = {};
    let stackContextMenu = null;

    function updateStackView() {
        const spectrum = getSpectrum();
        if (!spectrum.cpu) {
            stackView.innerHTML = '<div class="stack-entry">No CPU</div>';
            return;
        }

        // Check if viewing trace history - use historical SP
        const tracePos = traceManager.getCurrentPosition();
        const traceEntry = tracePos >= 0 ? traceManager.getEntry(tracePos) : null;
        const sp = traceEntry ? traceEntry.sp : spectrum.cpu.sp;
        const spChanged = previousSP !== null && previousSP !== sp;

        let html = '';
        // Show 3 entries before SP, SP itself, and 3 entries after
        for (let offset = -6; offset <= 6; offset += 2) {
            const addr = (sp + offset) & 0xffff;
            const lo = spectrum.memory.read(addr);
            const hi = spectrum.memory.read((addr + 1) & 0xffff);
            const value = lo | (hi << 8);

            const isCurrent = offset === 0;
            const valueKey = addr.toString();
            const valueChanged = previousStackValues[valueKey] !== undefined &&
                                previousStackValues[valueKey] !== value;

            let classes = 'stack-entry';
            if (isCurrent) classes += ' current';
            if (valueChanged && !spChanged) classes += ' changed';

            const pointer = isCurrent ? '<span class="stack-pointer">◄</span>' : '';

            html += `<div class="${classes}" data-addr="${addr}" data-value="${value}">` +
                    `<span class="stack-addr">${fmtAddr(addr)}</span>` +
                    `<span class="stack-value">${fmtAddr(value)}</span>` +
                    `${pointer}</div>`;

            previousStackValues[valueKey] = value;
        }

        stackView.innerHTML = html;
        previousSP = sp;
    }

    // Call stack analysis — reconstruct call chain from stack contents
    function updateCallStack() {
        const spectrum = getSpectrum();
        if (!spectrum.cpu || !spectrum.romLoaded) {
            callStackView.innerHTML = '';
            return;
        }

        const stack = spectrum._debugCallStack;
        if (!stack) {
            callStackView.innerHTML = '';
            return;
        }
        let html = '';

        // Show call stack from deepest (most recent) to shallowest
        // Most recent call at top
        for (let i = stack.length - 1; i >= 0; i--) {
            const entry = stack[i];
            const addr = entry.addr;
            const label = labelManager.get(addr, getCurrentPage(addr));
            const labelStr = label ? ` <span class="call-label">${label.name}</span>` : '';
            const intMark = entry.isInt ? ' <span class="call-label">INT</span>' : '';
            const cls = i === stack.length - 1 ? 'stack-entry current' : 'stack-entry';
            html += `<div class="${cls}" data-value="${addr}">` +
                    `<span class="stack-value">${fmtAddr(addr)}</span>${intMark}${labelStr}</div>`;
        }

        if (!html) {
            html = '<div class="stack-entry" style="opacity:0.4">—</div>';
        }

        callStackView.innerHTML = html;
    }

    // Call stack click — navigate to address
    callStackView.addEventListener('click', (e) => {
        const entry = e.target.closest('.stack-entry');
        if (!entry) return;
        const value = parseInt(entry.dataset.value, 10);
        if (!isNaN(value)) {
            navigateToAddress(value);
        }
    });

    // Call stack context menu
    callStackView.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const entry = e.target.closest('.stack-entry');
        if (!entry) return;
        const value = parseInt(entry.dataset.value, 10);
        if (isNaN(value)) return;

        if (stackContextMenu) stackContextMenu.remove();
        stackContextMenu = document.createElement('div');
        stackContextMenu.className = 'stack-context-menu';
        stackContextMenu.innerHTML = `
            <div data-action="disasm-left">Disasm left → ${fmtAddr(value)}</div>
            <div data-action="disasm-right">Disasm right → ${fmtAddr(value)}</div>
            <div data-action="memory-left">Memory left → ${fmtAddr(value)}</div>
            <div data-action="memory-right">Memory right → ${fmtAddr(value)}</div>
        `;
        stackContextMenu.style.left = e.clientX + 'px';
        stackContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(stackContextMenu);

        stackContextMenu.addEventListener('click', (ev) => {
            const action = ev.target.dataset.action;
            if (action === 'disasm-left') {
                setDisasmViewAddress(value);
                updateDebugger();
            } else if (action === 'disasm-right') {
                setRightDisasmViewAddress(value);
                updateRightDisassemblyView();
            } else if (action === 'memory-left') {
                goToMemoryAddress(value);
            } else if (action === 'memory-right') {
                goToRightMemoryAddress(value);
            }
            stackContextMenu.remove();
            stackContextMenu = null;
        });
    });

    // Stack view click — navigate to the value stored at that stack address
    stackView.addEventListener('click', (e) => {
        const entry = e.target.closest('.stack-entry');
        if (!entry) return;
        const value = parseInt(entry.dataset.value, 10);
        if (!isNaN(value)) {
            navigateToAddress(value);
        }
    });

    // Stack view context menu
    stackView.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const entry = e.target.closest('.stack-entry');
        if (!entry) return;

        const addr = parseInt(entry.dataset.addr, 10);
        const value = parseInt(entry.dataset.value, 10);

        // Remove existing menu
        if (stackContextMenu) {
            stackContextMenu.remove();
        }

        stackContextMenu = document.createElement('div');
        stackContextMenu.className = 'stack-context-menu';
        stackContextMenu.innerHTML = `
            <div data-action="disasm-addr">Disassembly → ${fmtAddr(addr)}</div>
            <div data-action="disasm-value">Disassembly → ${fmtAddr(value)}</div>
            <div data-action="memory-addr">Memory → ${fmtAddr(addr)}</div>
            <div data-action="memory-value">Memory → ${fmtAddr(value)}</div>
        `;
        stackContextMenu.style.left = e.clientX + 'px';
        stackContextMenu.style.top = e.clientY + 'px';
        document.body.appendChild(stackContextMenu);

        stackContextMenu.addEventListener('click', (ev) => {
            const action = ev.target.dataset.action;
            if (action === 'disasm-addr') {
                setDisasmViewAddress(addr);
                updateDebugger();
            } else if (action === 'disasm-value') {
                setDisasmViewAddress(value);
                updateDebugger();
            } else if (action === 'memory-addr') {
                goToMemoryAddress(addr);
            } else if (action === 'memory-value') {
                goToMemoryAddress(value);
            }
            stackContextMenu.remove();
            stackContextMenu = null;
        });
    });

    // Close context menu on click elsewhere
    document.addEventListener('click', (e) => {
        if (stackContextMenu && !stackContextMenu.contains(e.target)) {
            stackContextMenu.remove();
            stackContextMenu = null;
        }
    });

    return { updateStackView, updateCallStack };
}
