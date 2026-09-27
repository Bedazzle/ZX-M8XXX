// Type an instruction straight into a disassembly row.
//
// The debugger could already edit a byte in the hex dump, which meant patching
// code by hand-assembling it first. Double-clicking the mnemonic on a row opens
// a box holding that row's text; what is typed there is assembled by the
// project's own assembler (core/asm-line.js) and written over the instruction.
// The box starts out holding exactly what the row printed, labels and all, so
// Enter on an unchanged row is a no-op and an edit is usually one word.
//
// Both disassembly views get it -- the main one and the right panel -- since the
// row markup is shared (ui/disasm-line-render.js) and so is this handler.
//
// Three decisions worth writing down:
//
//   - **Blur cancels, Enter applies.** The hex dump saves a byte on blur, which
//     is right for two hex digits; a half-typed instruction is not something to
//     write into a running program because the mouse moved. A failed assembly
//     keeps the box open with the message in the status line, so the typo can be
//     fixed instead of retyped.
//   - **The old instruction's length is passed to the assembler**, which prefers
//     an encoding of that size where one exists -- NOP over a two-byte
//     instruction is `DD 00`, not `00` with a stray byte after it. Nothing is
//     padded beyond that: a shorter instruction leaves the rest of the old one
//     alone and a longer one runs into the next, which is what the rows then
//     show, because a row is drawn from memory and nothing is cached.
//   - **The write is one undo entry**, so Ctrl+Z puts the old instruction back
//     whatever its length was.

import { hex16, hex8 } from '../core/utils.js';
import { assembleLine } from '../core/asm-line.js';

export function initDisasmAsmEdit({
    getSpectrum, getDisasm, labelManager, getCurrentPage,
    undoManager, showMessage, updateDebugger, updateLabelsList
}) {
    const views = [
        document.getElementById('disassemblyView'),
        document.getElementById('rightDisassemblyView')
    ];

    // { addr, input, host, original } while a box is open, else null.
    let editing = null;

    function isEditing() {
        return editing !== null;
    }

    // Every name the operands may use: the debugger's own labels, over the ROM
    // labels when those are shown. Built per edit -- it is a few hundred keys at
    // most and it has to see a label added a moment ago.
    function buildSymbols() {
        const syms = {};
        if (labelManager.showRomLabels) {
            for (const label of labelManager.romLabels.values()) {
                if (label && label.name) syms[label.name] = label.address;
            }
        }
        for (const label of labelManager.getAll()) {
            if (label && label.name) syms[label.name] = label.address;
        }
        return syms;
    }

    function closeBox(restore) {
        if (!editing) return;
        const { input, host, original } = editing;
        editing = null;
        input.remove();
        if (restore) host.textContent = original;
    }

    function readMemoryBytes(addr, count) {
        const spectrum = getSpectrum();
        const out = [];
        for (let i = 0; i < count; i++) out.push(spectrum.memory.read((addr + i) & 0xFFFF));
        return out;
    }

    function writeBytes(addr, bytes) {
        const spectrum = getSpectrum();
        for (let i = 0; i < bytes.length; i++) {
            if (!spectrum.memory.writeDebug((addr + i) & 0xFFFF, bytes[i])) return false;
        }
        return true;
    }

    function applyEdit() {
        const { addr, input } = editing;
        const spectrum = getSpectrum();
        const disasm = getDisasm();
        const oldLength = disasm ? disasm.disassemble(addr).length : 1;

        const result = assembleLine(input.value, {
            address: addr,
            symbols: buildSymbols(),
            replaceLength: oldLength
        });
        if (result.error) {
            input.classList.add('error');
            showMessage(result.error);
            return false;
        }

        const bytes = result.bytes;
        if (bytes.length) {
            // Refuse before writing anything: half an instruction is worse than
            // none. writeDebug turns a ROM write down unless the Settings box is
            // ticked, and an instruction can straddle the boundary.
            const inRom = bytes.some((_, i) => ((addr + i) & 0xFFFF) < 0x4000);
            if (inRom && !spectrum.memory.allowRomEdit) {
                input.classList.add('error');
                showMessage('ROM is protected — tick "Edit ROM" in the disasm ⚙ options');
                return false;
            }
            const before = readMemoryBytes(addr, bytes.length);
            const after = bytes.slice();
            if (!writeBytes(addr, after)) {
                writeBytes(addr, before);
                input.classList.add('error');
                showMessage('Could not write all bytes — nothing changed');
                return false;
            }
            undoManager.push({
                type: 'asm',
                description: `Assemble at ${hex16(addr)}`,
                undo: () => { writeBytes(addr, before); updateDebugger(); },
                redo: () => { writeBytes(addr, after); updateDebugger(); }
            });
        }

        if (result.label) {
            labelManager.add({ address: addr, page: getCurrentPage(addr), name: result.label });
            if (updateLabelsList) updateLabelsList();
        }

        closeBox(false);
        updateDebugger();

        const shown = bytes.map(b => hex8(b)).join(' ');
        let tail = '';
        if (bytes.length && bytes.length < oldLength) {
            const left = oldLength - bytes.length;
            tail = ` (${left} byte${left > 1 ? 's' : ''} of the old instruction left)`;
        } else if (bytes.length > oldLength) {
            tail = ' (ran into the next instruction)';
        } else if (result.note) {
            tail = ` (${result.note})`;
        }
        showMessage(bytes.length
            ? `${hex16(addr)}: ${shown}${tail}`
            : `Label "${result.label}" added at ${hex16(addr)}`);
        return true;
    }

    /**
     * Open the box on the row at `addr`. `view` is the panel holding it; with no
     * view the row is looked for in both, which is what the context menu wants.
     */
    function startEdit(addr, view = null) {
        if (editing) closeBox(true);
        const panels = view ? [view] : views;
        let host = null;
        for (const panel of panels) {
            if (!panel) continue;
            const row = panel.querySelector(`.disasm-line[data-addr="${addr}"]`);
            const mnemonic = row && row.querySelector('.disasm-mnemonic');
            if (mnemonic) { host = mnemonic; break; }
        }
        if (!host) return false;

        const original = host.textContent.trim();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'disasm-asm-input';
        input.spellcheck = false;
        input.value = original;
        input.title = 'Enter assembles it here, Esc cancels';
        input.setAttribute('aria-label', `Instruction at ${hex16(addr)}`);

        host.textContent = '';
        host.appendChild(input);
        editing = { addr, input, host, original };

        input.addEventListener('keydown', (e) => {
            // The disassembly's own keys (F7/F8, PgUp) already ignore an INPUT,
            // but the click handlers below it do not.
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                applyEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeBox(true);
            } else {
                input.classList.remove('error');
            }
        });
        input.addEventListener('blur', () => closeBox(true));
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('dblclick', (e) => e.stopPropagation());
        input.addEventListener('mousedown', (e) => e.stopPropagation());

        // Focus after the current event: the dblclick that opened the box would
        // otherwise take the selection back.
        setTimeout(() => { input.focus(); input.select(); }, 0);
        return true;
    }

    for (const view of views) {
        if (!view) continue;
        view.addEventListener('dblclick', (e) => {
            const mnemonic = e.target.closest('.disasm-mnemonic');
            if (!mnemonic) return;
            // An operand address is a link: one click follows it, and following it
            // redraws the view out from under the box. Edit from the mnemonic text
            // or from the context menu instead.
            if (e.target.closest('.disasm-operand-addr')) return;
            const row = mnemonic.closest('.disasm-line');
            if (!row) return;
            const addr = parseInt(row.dataset.addr, 10);
            if (isNaN(addr)) return;
            e.preventDefault();
            startEdit(addr, view);
        });
    }

    return { startEdit, isEditing };
}
