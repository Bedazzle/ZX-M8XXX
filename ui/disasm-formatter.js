// Disassembly formatting — address/label display, operand formatting
import { fmtAddr, fmtAddrCol, fmtAddrH, getValueBase, ADDR_COL_WIDTH } from '../core/addr-format.js';
import { OPERAND_FORMATS } from '../debug/managers.js';

export const LABEL_MAX_CHARS = 12; // Max chars before wrapping to own row

export function initDisasmFormatter({ getMemory, labelManager, operandFormatManager }) {

    // Get the current memory page for an address (for paged label lookup)
    function getCurrentPage(addr) {
        const memory = getMemory();
        if (!memory || memory.machineType === '48k') return null;
        if (addr < 0x4000) return 'R' + memory.currentRomBank;
        if (addr >= 0xC000) return String(memory.currentRamBank);
        return null;
    }

    // Format address with label based on display mode
    function formatAddrWithLabel(addr, mode) {
        const label = labelManager.get(addr, getCurrentPage(addr));
        if (!label) return fmtAddr(addr);

        switch (mode) {
            case 'addr': return fmtAddr(addr);
            case 'label': return label.name;
            case 'both': return `${label.name}`;
            default: return fmtAddr(addr);
        }
    }

    // Format address column (may include both address and label)
    // Returns { html, isLong, labelHtml } where isLong means label needs its own row
    function formatAddrColumn(addr, mode) {
        const a = fmtAddrCol(addr);
        const label = labelManager.get(addr, getCurrentPage(addr));
        if (!label) return { html: a, isLong: false, labelHtml: null };

        switch (mode) {
            case 'addr':
                return { html: a, isLong: false, labelHtml: null };
            case 'label': {
                const isLong = label.name.length > LABEL_MAX_CHARS;
                return {
                    html: isLong ? a : `<span class="label-name">${label.name}</span>`,
                    isLong,
                    labelHtml: isLong ? `<span class="label-name">${label.name}:</span>` : null
                };
            }
            case 'both': {
                // The address is padded to a fixed width, so the label starts in the
                // same column whichever base is on and the length test means the same
                // thing in both: a name longer than LABEL_MAX_CHARS gets its own row.
                const combined = `${a} ${label.name}`;
                const isLong = combined.length > LABEL_MAX_CHARS + ADDR_COL_WIDTH + 1;
                return {
                    html: isLong ? a : `${a} <span class="label-name">${label.name}</span>`,
                    isLong,
                    labelHtml: isLong ? `<span class="label-name">${label.name}:</span>` : null
                };
            }
            default:
                return { html: a, isLong: false, labelHtml: null };
        }
    }

    // Apply operand format to mnemonic based on instruction address
    function applyOperandFormat(mnemonic, instrAddr) {
        const format = operandFormatManager.get(instrAddr);
        if (format === OPERAND_FORMATS.HEX) {
            // HEX means "no per-instruction override", so the default is whatever the
            // Settings switches say. A 2-digit operand is a VALUE and follows the value
            // base; the 4-digit one is address-shaped and is handled further down, where
            // its label and click target are already known.
            if (getValueBase() === 'hex') return mnemonic;
            return mnemonic.replace(/\b([0-9A-F]{2})h\b/gi,
                                    (m, hexVal) => String(parseInt(hexVal, 16)));
        }

        // Replace 16-bit hex values first (4 digits), then 8-bit (2 digits)
        // Match 4-digit hex addresses (e.g., 1234h)
        let result = mnemonic.replace(/\b([0-9A-F]{4})h\b/gi, (match, hexVal) => {
            const val = parseInt(hexVal, 16);
            return operandFormatManager.formatValue(val, format, true);
        });

        // Match 2-digit hex values (e.g., FFh) but not in addresses we already converted
        result = result.replace(/\b([0-9A-F]{2})h\b/gi, (match, hexVal) => {
            const val = parseInt(hexVal, 16);
            return operandFormatManager.formatValue(val, format, false);
        });

        return result;
    }

    // Replace addresses in mnemonic with labels and make them clickable
    function replaceMnemonicAddresses(mnemonic, mode, instrAddr) {
        // First apply operand format if set
        let processed = applyOperandFormat(mnemonic, instrAddr);

        // Match 4-digit hex addresses (e.g., 1234h or 0010h). A 16-bit operand is
        // address-shaped, so it follows the hex/decimal switch; an 8-bit one is a
        // value and is left alone -- `LD A,FFh` says more about a bit pattern than
        // `LD A,255`. A per-instruction format (DEC/BIN/CHAR) has already rewritten
        // its operand above, so nothing here can override one.
        processed = processed.replace(/\b([0-9A-F]{4})h\b/gi, (match, hexAddr) => {
            const addr = parseInt(hexAddr, 16);
            const label = labelManager.get(addr, getCurrentPage(addr));
            const shown = fmtAddrH(addr);

            if (mode === 'addr' || !label) {
                // No label mode or no label - show address as clickable
                return `<span class="disasm-operand-addr" data-addr="${addr}">${shown}</span>`;
            }

            // Label mode - show label as clickable
            return `<span class="disasm-label-operand disasm-operand-addr" data-addr="${addr}">${label.name}</span>`;
        });

        // Also make decimal addresses clickable (for dec format)
        // Match standalone numbers that could be addresses (4-5 digits, likely to be 256-65535)
        processed = processed.replace(/\b(6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[0-9]{1,4})\b/g, (match, num) => {
            const addr = parseInt(num, 10);
            // Only make clickable if it's a reasonable address (not a small immediate)
            // and the format is decimal
            const format = operandFormatManager.get(instrAddr);
            if (format === OPERAND_FORMATS.DEC && addr >= 256) {
                const label = labelManager.get(addr, getCurrentPage(addr));
                if (mode !== 'addr' && label) {
                    return `<span class="disasm-label-operand disasm-operand-addr" data-addr="${addr}">${label.name}</span>`;
                }
                return `<span class="disasm-operand-addr" data-addr="${addr}">${match}</span>`;
            }
            return match;
        });

        return processed;
    }

    return { getCurrentPage, formatAddrWithLabel, formatAddrColumn,
             applyOperandFormat, replaceMnemonicAddresses };
}
