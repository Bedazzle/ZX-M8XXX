// Assembly output generation — sjasmplus format export from disassembly

import { hex8, hex16 } from '../core/utils.js';
import { REGION_TYPES } from '../debug/managers.js';
import { parseTextRegion, parseByteRegion, parseWordRegion } from './region-helpers.js';

export function initAssemblyOutput({
    getSpectrum, getDisasm, labelManager, regionManager,
    commentManager, appVersion
}) {
    function generateAssemblyOutput(startAddr, endAddr, options = {}) {
        const disasm = getDisasm();
        const spectrum = getSpectrum();
        if (!disasm || !spectrum.memory) return '';

        const withOrg = options.withOrg !== false;
        const withAddr = options.withAddr !== false;
        const withBytes = options.withBytes === true;
        const withTstates = options.withTstates === true;
        const withHeader = options.withHeader !== false;

        let output = '';

        if (withHeader) {
            // Format current datetime
            const now = new Date();
            const datetime = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0') + ' ' +
                String(now.getHours()).padStart(2, '0') + ':' +
                String(now.getMinutes()).padStart(2, '0') + ':' +
                String(now.getSeconds()).padStart(2, '0');

            output += '; Disassembly exported from ZX-M8XXX v' + appVersion + '\n';
            output += `; Date: ${datetime}\n`;
            if (labelManager.currentFile) {
                output += `; Source: ${labelManager.currentFile}\n`;
            }
            output += `; Range: $${hex16(startAddr)} - $${hex16(endAddr)}\n\n`;
        }

        if (withOrg) {
            output += `        ORG $${hex16(startAddr)}\n\n`;
        }

        let addr = startAddr;
        while (addr <= endAddr && addr < 0x10000) {
            const region = regionManager.get(addr);
            const label = labelManager.get(addr);
            const comment = commentManager.get(addr);
            const instrStartAddr = addr;

            // Output comments before instruction
            if (comment) {
                if (comment.separator) {
                    output += `; ----------\n`;
                }
                if (comment.before) {
                    const beforeLines = comment.before.split('\n');
                    for (const line of beforeLines) {
                        output += `; ${line}\n`;
                    }
                }
            }

            // Output label on its own line if exists
            if (label) {
                output += `${label.name}:\n`;
            }

            let mnemonic = '';
            let bytes = [];
            let isData = false;
            let addBlankAfter = false;

            if (!region || region.type === REGION_TYPES.CODE || region.type === REGION_TYPES.SMC) {
                // Normal disassembly
                const instr = disasm.disassemble(addr);
                if (!instr) break;

                mnemonic = instr.mnemonic;
                bytes = instr.bytes;

                // Check for flow control
                const mnemonicUpper = mnemonic.toUpperCase();
                if (mnemonicUpper.startsWith('RET') || mnemonicUpper.startsWith('JP ') ||
                    mnemonicUpper.startsWith('JR ') || mnemonicUpper.startsWith('CALL ') ||
                    mnemonicUpper.startsWith('DJNZ') || mnemonicUpper.startsWith('RST') ||
                    mnemonicUpper === 'HALT') {
                    addBlankAfter = true;
                }

                addr += bytes.length;
            } else if (region.type === REGION_TYPES.TEXT) {
                // Text region - use shared helper
                const regionEnd = Math.min(region.end, endAddr);
                const result = parseTextRegion(spectrum.memory, addr, regionEnd);
                bytes = result.bytes;

                if (result.singleByte) {
                    mnemonic = `DB $${hex8(bytes[0])}`;
                } else if (result.text.length > 0) {
                    const suffix = result.bit7Terminated ? '+$80' : '';
                    mnemonic = `DB "${result.text}"${suffix}`;
                }
                addr = result.nextAddr;
                isData = true;
            } else if (region.type === REGION_TYPES.DW) {
                // Word data - use shared helper
                const regionEnd = Math.min(region.end, endAddr);
                const result = parseWordRegion(spectrum.memory, addr, regionEnd);
                bytes = result.bytes;
                mnemonic = `DW ${result.wordStrs.join(', ')}`;
                addr = result.nextAddr;
                isData = true;
            } else if (region.type === REGION_TYPES.DB || region.type === REGION_TYPES.GRAPHICS) {
                // Byte data - use shared helper
                const regionEnd = Math.min(region.end, endAddr);
                const result = parseByteRegion(spectrum.memory, addr, regionEnd);
                bytes = result.bytes;
                mnemonic = `DB ${result.byteStrs.join(', ')}`;
                addr = result.nextAddr;
                isData = true;
            } else {
                // Unknown region - fallback
                const instr = disasm.disassemble(addr);
                if (!instr) break;
                mnemonic = instr.mnemonic;
                bytes = instr.bytes;
                addr += bytes.length;
            }

            // Build instruction line
            let line = '        '; // 8 spaces for indentation

            // Convert mnemonic to sjasmplus format (for code lines)
            if (!isData) {
                mnemonic = mnemonic.replace(/([0-9A-F]{4})h/gi, (m, hex) => `$${hex}`);
                mnemonic = mnemonic.replace(/([0-9A-F]{2})h/gi, (m, hex) => `$${hex}`);
            }

            line += mnemonic;

            // Add aligned comments
            const hasMetaComments = withAddr || withBytes || (withTstates && !isData);
            if (hasMetaComments) {
                line = line.padEnd(40);
                line += '; ';

                if (withAddr) {
                    line += `$${hex16(instrStartAddr)} `;
                }
                if (withBytes) {
                    const bytesStr = bytes.map(b => hex8(b)).join(' ');
                    if (withAddr) line += '| ';
                    line += bytesStr.padEnd(24);
                }
                if (withTstates && !isData) {
                    const timing = disasm.getTiming(bytes);
                    if (timing) {
                        if (withAddr || withBytes) line += '| ';
                        line += timing;
                    }
                }
            }

            // Add inline comment
            if (comment && comment.inline) {
                if (!hasMetaComments) {
                    line = line.padEnd(40);
                }
                line += (hasMetaComments ? ' | ' : '; ') + comment.inline;
            }

            output += line + '\n';

            // Add after comments
            if (comment && comment.after) {
                const afterLines = comment.after.split('\n');
                for (const afterLine of afterLines) {
                    output += `; ${afterLine}\n`;
                }
            }

            if (addBlankAfter) {
                output += '\n';
            }
        }

        return output;
    }

    return { generateAssemblyOutput };
}
