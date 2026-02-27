// Emulator Control — step buttons, register editing, memory editing, status messages
// Extracted from index.html lines ~15258-15630, ~28137-28342, ~29490-29805

import { hex16 } from '../utils/format.js';

export function showMessage(text, type = 'success') {
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.textContent = text;
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 3000);
}

// Register edit functionality
let isEditingRegister = false;

export function startRegisterEdit(valueSpan, spectrum, updateDebugger) {
    if (!spectrum.cpu || isEditingRegister) return;

    isEditingRegister = true;
    const reg = valueSpan.dataset.reg;
    const bits = parseInt(valueSpan.dataset.bits) || 16;
    const originalValue = valueSpan.textContent;

    // Calculate max length based on register type
    // IFF is special: "1/1" format needs 3 chars
    // T-states: up to 5 digits (69888)
    // IM: 0-2 needs 1 char, I/R: 00-FF needs 2, 16-bit: 0000-FFFF needs 4
    const maxLen = reg === 'iff' ? 3 : reg === 'tstates' ? 5 : (bits <= 3 ? 1 : (bits <= 8 ? 2 : 4));

    // Lock width to prevent UI shift
    const originalWidth = valueSpan.offsetWidth;
    valueSpan.style.width = originalWidth + 'px';

    // Make span editable in place
    valueSpan.contentEditable = 'true';
    valueSpan.classList.add('editing');
    valueSpan.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(valueSpan);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    // Limit input length
    function limitInput() {
        const text = valueSpan.textContent;
        if (text.length > maxLen) {
            valueSpan.textContent = text.slice(0, maxLen);
            // Move cursor to end
            const range = document.createRange();
            range.selectNodeContents(valueSpan);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }
    valueSpan.addEventListener('input', limitInput);

    function finishEdit(save) {
        if (!isEditingRegister) return;
        isEditingRegister = false;
        valueSpan.removeEventListener('input', limitInput);
        valueSpan.contentEditable = 'false';
        valueSpan.classList.remove('editing');
        valueSpan.style.width = '';
        if (save) {
            applyRegisterValue(reg, valueSpan.textContent.trim(), bits, spectrum);
        } else {
            valueSpan.textContent = originalValue;
        }
        updateDebugger();
    }

    valueSpan.addEventListener('blur', () => finishEdit(true), { once: true });
    valueSpan.addEventListener('keydown', function handler(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            valueSpan.removeEventListener('keydown', handler);
            finishEdit(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            valueSpan.removeEventListener('keydown', handler);
            finishEdit(false);
        }
    });
}

export function applyRegisterValue(reg, valueStr, bits, spectrum) {
    const cpu = spectrum.cpu;
    if (!cpu) return;

    // Parse value (hex or decimal)
    let value;
    valueStr = valueStr.trim().toUpperCase();

    // Handle special cases for IFF and IM
    if (reg === 'iff') {
        // Toggle IFF1/IFF2: parse as "1/1", "0/0", "1/0", "0/1" or single value
        if (valueStr.includes('/')) {
            const parts = valueStr.split('/');
            cpu.iff1 = parts[0] === '1';
            cpu.iff2 = parts[1] === '1';
        } else {
            const v = valueStr === '1' || valueStr === 'ON' || valueStr === 'TRUE';
            cpu.iff1 = v;
            cpu.iff2 = v;
        }
        return;
    } else if (reg === 'im') {
        value = parseInt(valueStr, 10);
        if (value >= 0 && value <= 2) {
            cpu.im = value;
        }
        return;
    } else if (reg === 'rambank') {
        value = parseInt(valueStr, 10);
        if (value >= 0 && value <= 7) {
            spectrum.memory.setRamBank(value);
        }
        return;
    } else if (reg === 'scrbank') {
        value = parseInt(valueStr, 10);
        if (value === 0 || value === 1) {
            spectrum.memory.setScreenBank(value === 0 ? 5 : 7);
        }
        return;
    } else if (reg === 'rombank') {
        value = parseInt(valueStr, 10);
        if (value >= 0 && value <= 1) {
            spectrum.memory.setRomBank(value);
        }
        return;
    } else if (reg === 'paginglock') {
        value = valueStr === '1' || valueStr === 'ON' || valueStr === 'TRUE';
        spectrum.memory.setPagingDisabled(value);
        return;
    } else if (reg === 'tstates') {
        value = parseInt(valueStr, 10);
        if (!isNaN(value) && value >= 0) {
            cpu.tStates = value;
        }
        return;
    }

    // Parse hex (with or without suffix) or decimal
    if (valueStr.endsWith('H')) {
        value = parseInt(valueStr.slice(0, -1), 16);
    } else if (valueStr.startsWith('$') || valueStr.startsWith('0X')) {
        value = parseInt(valueStr.replace('$', '').replace('0X', ''), 16);
    } else if (/^[0-9A-F]+$/.test(valueStr) && valueStr.length > 2) {
        // Likely hex if all hex chars and longer than 2 chars
        value = parseInt(valueStr, 16);
    } else if (/^[0-9]+$/.test(valueStr)) {
        value = parseInt(valueStr, 10);
    } else {
        value = parseInt(valueStr, 16);
    }

    if (isNaN(value)) return;

    // Mask to appropriate bits
    const mask = bits === 8 ? 0xFF : 0xFFFF;
    value = value & mask;

    // Apply to registers
    switch (reg) {
        case 'af': cpu.a = (value >> 8) & 0xFF; cpu.f = value & 0xFF; break;
        case 'bc': cpu.b = (value >> 8) & 0xFF; cpu.c = value & 0xFF; break;
        case 'de': cpu.d = (value >> 8) & 0xFF; cpu.e = value & 0xFF; break;
        case 'hl': cpu.h = (value >> 8) & 0xFF; cpu.l = value & 0xFF; break;
        case 'af_': cpu.a_ = (value >> 8) & 0xFF; cpu.f_ = value & 0xFF; break;
        case 'bc_': cpu.b_ = (value >> 8) & 0xFF; cpu.c_ = value & 0xFF; break;
        case 'de_': cpu.d_ = (value >> 8) & 0xFF; cpu.e_ = value & 0xFF; break;
        case 'hl_': cpu.h_ = (value >> 8) & 0xFF; cpu.l_ = value & 0xFF; break;
        case 'ix': cpu.ix = value; break;
        case 'iy': cpu.iy = value; break;
        case 'sp': cpu.sp = value; break;
        case 'pc': cpu.pc = value; break;
        case 'i': cpu.i = value; break;
        case 'r': cpu.r = value & 0x7F; cpu.r7 = value & 0x80; break;
    }
}

// Event delegation for register editing
export function handleRegisterClick(e, spectrum, updateDebugger) {
    const target = e.target;
    if (target.classList.contains('editable') && target.classList.contains('register-value')) {
        startRegisterEdit(target, spectrum, updateDebugger);
    }
}

export function getIsEditingRegister() {
    return isEditingRegister;
}

// Open debugger panel helper
export function openDebuggerPanel() {
    const tabContainer = document.getElementById('tabContainer');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    // Expand tabs and switch to debugger tab
    tabContainer.classList.remove('collapsed');
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="debugger"]').classList.add('active');
    document.getElementById('tab-debugger').classList.add('active');
}

// XRef tooltip handlers
export function initXRefTooltips(disassemblyView, xrefManager, labelManager) {
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

    return { showXRefTooltip, hideXRefTooltip };
}
