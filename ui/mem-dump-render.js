// One hex-dump row, rendered once.
//
// The debugger has two memory dumps -- the right panel and the left one -- and each
// carried its own copy of the markup. The ASCII column was eighteen identical lines
// in both, and the four-byte rule added in v1.0.0 had to be written into each of
// them separately. That is the tax this removes.
//
// The two panels are NOT identical in what they show, and that is deliberate here:
// the left dump has never shown changed-byte highlighting, breakpoint or watchpoint
// marks, or the per-byte tooltip. Rather than quietly grant it those (a visible
// change nobody asked for) each is an explicit flag, so what the panels differ in is
// stated in one place instead of being implied by which lines someone remembered to
// copy. Turning any of them on for the left panel is now a one-word edit.

import { hex8, hex16 } from '../core/utils.js';
import { fmtAddrCol, fmtByte, fmtOpcode } from '../core/addr-format.js';
import { REGION_TYPES } from '../debug/managers.js';

export function createMemDumpRenderer({ getSpectrum, getDisasm, regionManager, getMemorySnapshot }) {

    // The tooltip deliberately gives both bases at once -- it is the place you go to
    // find out what a byte IS, so it does not follow the display switch.
    function byteTooltip(addr, byte, region, disasm) {
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
        if (disasm) {
            const instr = disasm.disassemble(addr);
            const bytes = instr.bytes.map(b => fmtOpcode(b)).join(' ');
            tip += `\n${instr.mnemonic} [${bytes}]`;
        }
        return tip;
    }

    function watchpointClass(spectrum, addr) {
        for (const wp of spectrum.getWatchpoints()) {
            if (addr >= wp.start && addr <= wp.end) {
                if (wp.read && wp.write) return ' has-wp';
                if (wp.read) return ' has-wp-r';
                if (wp.write) return ' has-wp-w';
                return '';
            }
        }
        return '';
    }

    /**
     * The whole dump.
     *
     * opts: {
     *   startAddr, lines, bytesPerLine,
     *   showChanged, showBreakpoints, showWatchpoints, showTooltips,
     *   asciiSelectionStart, asciiSelectionEnd
     * }
     */
    function renderDump(opts) {
        const {
            startAddr, lines, bytesPerLine,
            showChanged = false, showBreakpoints = false,
            showWatchpoints = false, showTooltips = false,
            asciiSelectionStart = null, asciiSelectionEnd = null
        } = opts;

        const spectrum = getSpectrum();
        const disasm = showTooltips ? getDisasm() : null;
        const snapshot = showChanged ? getMemorySnapshot() : null;

        const selStart = asciiSelectionStart !== null
            ? Math.min(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart) : -1;
        const selEnd = asciiSelectionStart !== null
            ? Math.max(asciiSelectionStart, asciiSelectionEnd ?? asciiSelectionStart) : -1;

        let html = '';
        for (let line = 0; line < lines; line++) {
            const lineAddr = (startAddr + line * bytesPerLine) & 0xffff;

            html += `<div class="memory-line"><span class="memory-addr" data-addr="${lineAddr}">${fmtAddrCol(lineAddr)}</span>`;

            // ---- hex column ----
            html += '<span class="memory-hex">';
            for (let i = 0; i < bytesPerLine; i++) {
                const addr = (lineAddr + i) & 0xffff;
                const byte = spectrum.memory.read(addr);
                const changed = snapshot && snapshot[addr] !== byte;

                let cls = changed ? 'memory-byte changed' : 'memory-byte';
                // A rule every four bytes, so the eye can count a column without
                // counting cells. Drawn as a pseudo-element (see the CSS), so it
                // takes nothing from the cell the digits sit in.
                if (i % 4 === 0 && i > 0) cls += ' group-start';
                if (showBreakpoints && spectrum.hasBreakpointAt(addr)) cls += ' has-bp';
                if (showWatchpoints) cls += watchpointClass(spectrum, addr);

                const region = regionManager.get(addr);
                if (region && region.type !== REGION_TYPES.CODE) {
                    cls += ` region-${region.type}`;
                }

                const title = showTooltips
                    ? ` title="${byteTooltip(addr, byte, region, disasm)}"`
                    : '';
                html += `<span class="${cls}" data-addr="${addr}"${title}>${fmtByte(byte)}</span>`;
            }
            html += '</span>';

            // ---- ASCII column ----
            html += '<span class="memory-ascii">';
            for (let i = 0; i < bytesPerLine; i++) {
                const addr = (lineAddr + i) & 0xffff;
                const byte = spectrum.memory.read(addr);
                const isPrintable = byte >= 32 && byte < 127;
                const char = isPrintable ? String.fromCharCode(byte) : byte === 0 ? '\u25A0' : '.';

                let cls = isPrintable ? 'printable' : byte === 0 ? 'null-byte' : '';
                if (snapshot && snapshot[addr] !== byte) cls += ' changed';
                const asciiRegion = regionManager.get(addr);
                if (asciiRegion && asciiRegion.type === REGION_TYPES.TEXT) cls += ' region-text';
                if (asciiSelectionStart !== null && addr >= selStart && addr <= selEnd) {
                    cls += ' ascii-selected';
                }
                html += `<span class="${cls.trim()}" data-addr="${addr}">${char}</span>`;
            }
            html += '</span></div>';
        }
        return html;
    }

    return { renderDump };
}
