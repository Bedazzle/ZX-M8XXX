// BASIC Copy/Paste — read/write ZX Spectrum BASIC programs via clipboard.
// Init-function pattern with DI.

import { decodeBasicProgram, parseBasicText, buildBasicProgram, buildTokenLookup } from '../core/basic-tokens.js';

export function initBasicEditor({ getSpectrum, readMemory, writePoke, isRunning, stopEmulator, showMessage, updateDebugger }) {

    const btnCopy = document.getElementById('btnBasicCopy');
    const btnPaste = document.getElementById('btnBasicPaste');
    const chkAsListed = document.getElementById('chkBasicAsListed');
    const dialog = document.getElementById('basicPasteDialog');
    const textarea = document.getElementById('basicPasteText');
    const btnConfirm = document.getElementById('btnBasicPasteConfirm');
    const btnCancel = document.getElementById('btnBasicPasteCancel');

    const tokenLookup = buildTokenLookup();

    function readWord(addr) {
        return readMemory(addr) | (readMemory(addr + 1) << 8);
    }

    function writeWord(addr, val) {
        writePoke(addr, val & 0xFF);
        writePoke(addr + 1, (val >> 8) & 0xFF);
    }

    // --- Copy ---
    if (btnCopy) {
        btnCopy.addEventListener('click', () => {
            const spectrum = getSpectrum();
            if (!spectrum) {
                showMessage('No machine loaded');
                return;
            }

            const prog = readWord(0x5C53);
            const vars = readWord(0x5C4B);

            if (prog < 0x4000) {
                showMessage('PROG outside RAM (' + prog.toString(16).toUpperCase() + ')');
                return;
            }
            if (vars <= prog) {
                showMessage('No BASIC program in memory');
                return;
            }

            const len = vars - prog;
            const data = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                data[i] = readMemory(prog + i);
            }

            const asListed = chkAsListed && chkAsListed.checked;
            const lines = decodeBasicProgram(data, { deobfuscate: !asListed });
            if (lines.length === 0) {
                showMessage('No BASIC lines found');
                return;
            }

            const text = lines.map(l => l.number + ' ' + l.text.replace(/\{\{|\}\}/g, '')).join('\n');

            navigator.clipboard.writeText(text).then(() => {
                showMessage('Copied ' + lines.length + ' line' + (lines.length !== 1 ? 's' : '') + ' to clipboard');
            }).catch(err => {
                showMessage('Clipboard error: ' + err.message);
            });
        });
    }

    // --- Paste ---
    if (btnPaste) {
        btnPaste.addEventListener('click', () => {
            const spectrum = getSpectrum();
            if (!spectrum) {
                showMessage('No machine loaded');
                return;
            }
            // Pre-fill from clipboard if available
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText().then(clipText => {
                    if (textarea) textarea.value = clipText;
                }).catch(() => {
                    // Permission denied or no text — leave textarea as-is
                });
            }
            if (dialog) dialog.classList.remove('hidden');
            if (textarea) textarea.focus();
        });
    }

    if (btnCancel) {
        btnCancel.addEventListener('click', () => {
            if (dialog) dialog.classList.add('hidden');
        });
    }

    if (btnConfirm) {
        btnConfirm.addEventListener('click', () => {
            const spectrum = getSpectrum();
            if (!spectrum) {
                showMessage('No machine loaded');
                return;
            }

            const text = textarea ? textarea.value : '';
            const lines = parseBasicText(text);
            if (lines.length === 0) {
                showMessage('No valid BASIC lines found');
                return;
            }

            const binary = buildBasicProgram(lines, tokenLookup);

            const prog = readWord(0x5C53);
            const ramtop = readWord(0x5CB2);

            if (prog < 0x4000) {
                showMessage('PROG outside RAM (' + prog.toString(16).toUpperCase() + ')');
                return;
            }

            // Program + vars end marker (0x80) + edit line (0x0D, 0x80) = binary.length + 3
            const totalNeeded = binary.length + 3;
            if (prog + totalNeeded >= ramtop) {
                showMessage('Program too large: ' + totalNeeded + ' bytes needed, ' + (ramtop - prog) + ' available');
                return;
            }

            // Auto-pause if running
            if (isRunning()) {
                stopEmulator();
            }

            // Write program binary
            for (let i = 0; i < binary.length; i++) {
                writePoke(prog + i, binary[i]);
            }

            const varsAddr = prog + binary.length;
            const eLineAddr = varsAddr + 1;

            // Write end-of-variables marker
            writePoke(varsAddr, 0x80);

            // Write empty edit line: 0x0D + 0x80
            writePoke(eLineAddr, 0x0D);
            writePoke(eLineAddr + 1, 0x80);

            const workspAddr = eLineAddr + 2;

            // Update system variables
            writeWord(0x5C4B, varsAddr);     // VARS
            writeWord(0x5C59, eLineAddr);    // E_LINE
            writeWord(0x5C5B, eLineAddr);    // CH_ADD
            writeWord(0x5C61, workspAddr);   // WORKSP
            writeWord(0x5C63, workspAddr);   // STKBOT
            writeWord(0x5C65, workspAddr);   // STKEND

            if (dialog) dialog.classList.add('hidden');
            updateDebugger();
            showMessage('Pasted ' + lines.length + ' BASIC line' + (lines.length !== 1 ? 's' : '') + ' (' + binary.length + ' bytes)');
        });
    }
}
