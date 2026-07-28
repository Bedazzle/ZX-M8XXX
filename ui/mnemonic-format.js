// Mnemonic Syntax Coloring — pure string transformation, no external deps

// Does this instruction end a run of straight-line code? (used for blank-line
// spacing in the disassembly views and the Explorer's disasm)
export function isFlowBreak(mnemonic) {
    const mn = mnemonic.replace(/<[^>]+>/g, '').toUpperCase();
    return mn.startsWith('JP') || mn.startsWith('JR') ||
           mn.startsWith('RET') || mn.startsWith('DJNZ') ||
           mn.startsWith('RST') || mn.startsWith('CALL') ||
           mn === 'HALT';
}

export function formatMnemonic(mnemonic) {
    // Split into opcode and operands
    const spaceIdx = mnemonic.indexOf(' ');
    if (spaceIdx === -1) {
        return `<span class="op">${mnemonic}</span>`;
    }

    const opcode = mnemonic.substring(0, spaceIdx);
    let operands = mnemonic.substring(spaceIdx + 1);

    // Tokenize operands to avoid replacing inside HTML tags
    // Process each comma-separated operand
    const parts = operands.split(',');
    const coloredParts = parts.map(part => {
        let p = part.trim();

        // Character literals ('X' or "X")
        if (/^'.'$/.test(p) || /^".*"$/.test(p)) {
            return `<span class="disasm-char">${p}</span>`;
        }

        // Binary numbers (%...)
        if (p.startsWith('%')) {
            return `<span class="disasm-bin">${p}</span>`;
        }

        // Check for indirect addressing (...)
        const indirectMatch = p.match(/^\((.+)\)$/);
        if (indirectMatch) {
            const inner = colorOperand(indirectMatch[1]);
            return `<span class="disasm-ptr">(</span>${inner}<span class="disasm-ptr">)</span>`;
        }

        return colorOperand(p);
    });

    function colorOperand(p) {
        // Already has HTML (from replaceMnemonicAddresses)
        if (p.includes('<span')) {
            return p;
        }

        // Hex numbers (XXh or XXXXh)
        if (/^[0-9A-F]+h$/i.test(p)) {
            return `<span class="disasm-num">${p}</span>`;
        }

        // Decimal numbers
        if (/^\d+$/.test(p)) {
            return `<span class="disasm-num">${p}</span>`;
        }

        // IX+d or IY+d patterns
        const ixMatch = p.match(/^(IX|IY)([+-])(.+)$/i);
        if (ixMatch) {
            const reg = ixMatch[1].toUpperCase();
            const sign = ixMatch[2];
            const disp = colorOperand(ixMatch[3]);
            return `<span class="disasm-reg">${reg}</span>${sign}${disp}`;
        }

        // 16-bit registers
        if (/^(AF'|BC'|DE'|HL'|AF|BC|DE|HL|SP|IX|IY|PC)$/i.test(p)) {
            return `<span class="disasm-reg">${p}</span>`;
        }

        // 8-bit registers
        if (/^(A|B|C|D|E|H|L|I|R|IXH|IXL|IYH|IYL)$/i.test(p)) {
            return `<span class="disasm-reg">${p}</span>`;
        }

        // Condition flags
        if (/^(NZ|NC|PO|PE|Z|C|P|M)$/i.test(p)) {
            return `<span class="disasm-reg">${p}</span>`;
        }

        return p;
    }

    return `<span class="op">${opcode}</span> ${coloredParts.join(',')}`;
}
