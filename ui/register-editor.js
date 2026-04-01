// Register editing functionality — inline edit, flag toggle, EXA/EXX swap
import { hex16 } from '../core/utils.js';

export function initRegisterEditor({ getSpectrum, updateDebugger, addWatch, showMessage }) {
    const mainRegisters = document.getElementById('mainRegisters');
    const altRegisters = document.getElementById('altRegisters');
    const ixiyRegisters = document.getElementById('ixiyRegisters');
    const indexRegisters = document.getElementById('indexRegisters');
    const flagsDisplay = document.getElementById('flagsDisplay');
    const statusRegisters = document.getElementById('statusRegisters');
    const regRItem = document.getElementById('regRItem');
    const pagesInfo = document.getElementById('pagesInfo');

    let isEditingRegister = false;

    function startRegisterEdit(valueSpan) {
        const spectrum = getSpectrum();
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
                applyRegisterValue(reg, valueSpan.textContent.trim(), bits);
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

    function applyRegisterValue(reg, valueStr, bits) {
        const spectrum = getSpectrum();
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
    function handleRegisterClick(e) {
        const target = e.target;
        if (target.classList.contains('editable') && target.classList.contains('register-value')) {
            startRegisterEdit(target);
        }
    }

    mainRegisters.addEventListener('click', handleRegisterClick);
    altRegisters.addEventListener('click', handleRegisterClick);
    ixiyRegisters.addEventListener('click', handleRegisterClick);
    indexRegisters.addEventListener('click', handleRegisterClick);
    statusRegisters.addEventListener('click', handleRegisterClick);
    regRItem.addEventListener('click', handleRegisterClick);
    pagesInfo.addEventListener('click', handleRegisterClick);

    // Flag click handler - toggle individual flags
    flagsDisplay.addEventListener('click', (e) => {
        const target = e.target;
        const spectrum = getSpectrum();
        if (target.classList.contains('flag-item') && target.classList.contains('editable')) {
            const bit = parseInt(target.dataset.bit);
            if (!isNaN(bit) && spectrum.cpu) {
                spectrum.cpu.f ^= bit;  // Toggle the flag bit
                updateDebugger();
            }
        }
    });

    // EXA/EXX buttons - use event delegation since buttons are recreated
    ixiyRegisters.addEventListener('click', (e) => {
        const spectrum = getSpectrum();
        if (!spectrum.cpu) return;
        const btn = e.target.closest('.reg-swap-btn');
        if (!btn) return;

        const cpu = spectrum.cpu;

        if (btn.id === 'btnEXA') {
            // EX AF,AF' - swap A/A' and F/F'
            let tmp = cpu.a; cpu.a = cpu.a_; cpu.a_ = tmp;
            tmp = cpu.f; cpu.f = cpu.f_; cpu.f_ = tmp;
            updateDebugger();
        } else if (btn.id === 'btnEXX') {
            // EXX - swap BC,DE,HL with BC',DE',HL'
            let tmp = cpu.b; cpu.b = cpu.b_; cpu.b_ = tmp;
            tmp = cpu.c; cpu.c = cpu.c_; cpu.c_ = tmp;
            tmp = cpu.d; cpu.d = cpu.d_; cpu.d_ = tmp;
            tmp = cpu.e; cpu.e = cpu.e_; cpu.e_ = tmp;
            tmp = cpu.h; cpu.h = cpu.h_; cpu.h_ = tmp;
            tmp = cpu.l; cpu.l = cpu.l_; cpu.l_ = tmp;
            updateDebugger();
        }
    });

    // Double-click register name to add watch at current register value
    function getRegisterValue(reg) {
        const spectrum = getSpectrum();
        const cpu = spectrum.cpu;
        if (!cpu) return null;
        switch (reg) {
            case 'af': return cpu.af;
            case 'bc': return cpu.bc;
            case 'de': return cpu.de;
            case 'hl': return cpu.hl;
            case 'af_': return (cpu.a_ << 8) | cpu.f_;
            case 'bc_': return (cpu.b_ << 8) | cpu.c_;
            case 'de_': return (cpu.d_ << 8) | cpu.e_;
            case 'hl_': return (cpu.h_ << 8) | cpu.l_;
            case 'ix': return cpu.ix;
            case 'iy': return cpu.iy;
            case 'sp': return cpu.sp;
            case 'pc': return cpu.pc;
            default: return null;
        }
    }

    function handleRegisterDblClick(e) {
        if (!addWatch) return;
        const nameSpan = e.target.closest('.register-name');
        if (!nameSpan) return;
        const item = nameSpan.closest('.register-item');
        if (!item) return;
        const valueSpan = item.querySelector('.register-value[data-reg]');
        if (!valueSpan) return;
        const reg = valueSpan.dataset.reg;
        const bits = parseInt(valueSpan.dataset.bits) || 16;
        if (bits < 16) return; // Only 16-bit registers as watch addresses
        const value = getRegisterValue(reg);
        if (value === null) return;
        const name = nameSpan.textContent.trim();
        addWatch(value, name);
        if (showMessage) showMessage(`Watch added: $${hex16(value)} (${name})`);
    }

    mainRegisters.addEventListener('dblclick', handleRegisterDblClick);
    altRegisters.addEventListener('dblclick', handleRegisterDblClick);
    ixiyRegisters.addEventListener('dblclick', handleRegisterDblClick);
    indexRegisters.addEventListener('dblclick', handleRegisterDblClick);

    return { isEditingRegister: () => isEditingRegister };
}
