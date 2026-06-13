// Disassembly generation — region-aware disassembly and code folding
import { hex8, hex16 } from '../core/utils.js';
import { REGION_TYPES } from '../debug/managers.js';
import { parseTextRegion, parseByteRegion, parseWordRegion } from './region-helpers.js';

export function initDisasmGenerator({
    getDisasm, getMemory, regionManager, subroutineManager,
    foldManager, labelManager, getCurrentPage
}) {

    // Generate disassembly lines with region support
    // Returns array of {addr, bytes, mnemonic, isData}
    function disassembleWithRegions(startAddr, numLines) {
        const disasm = getDisasm();
        const memory = getMemory();
        if (!disasm || !memory) return [];

        const lines = [];
        let addr = startAddr & 0xffff;

        while (lines.length < numLines && addr <= 0xffff) {
            const region = regionManager.get(addr);
            const lineAddr = addr;

            if (!region || region.type === REGION_TYPES.CODE || region.type === REGION_TYPES.SMC) {
                // Normal disassembly
                const instr = disasm.disassemble(addr);
                lines.push({
                    addr: addr,
                    bytes: instr.bytes,
                    mnemonic: instr.mnemonic,
                    isData: false
                });
                addr = (addr + instr.bytes.length) & 0xffff;
            } else if (region.type === REGION_TYPES.TEXT) {
                // Text region using helper
                const result = parseTextRegion(memory, addr, region.end);
                if (result.singleByte) {
                    lines.push({
                        addr: lineAddr,
                        bytes: result.bytes,
                        mnemonic: `DB $${hex8(result.bytes[0])}`,
                        isData: true
                    });
                } else if (result.text.length > 0) {
                    const suffix = result.bit7Terminated ? '+$80' : '';
                    lines.push({
                        addr: lineAddr,
                        bytes: result.bytes,
                        mnemonic: `DB "${result.text}"${suffix}`,
                        isData: true
                    });
                }
                addr = result.nextAddr & 0xffff;
            } else if (region.type === REGION_TYPES.DW) {
                // Word data using helper
                const result = parseWordRegion(memory, addr, region.end);
                if (result.wordStrs.length > 0) {
                    lines.push({
                        addr: lineAddr,
                        bytes: result.bytes,
                        mnemonic: `DW ${result.wordStrs.join(', ')}`,
                        isData: true
                    });
                }
                addr = result.nextAddr & 0xffff;
            } else if (region.type === REGION_TYPES.DB || region.type === REGION_TYPES.GRAPHICS) {
                // Byte data using helper
                const result = parseByteRegion(memory, addr, region.end);
                if (result.byteStrs.length > 0) {
                    lines.push({
                        addr: lineAddr,
                        bytes: result.bytes,
                        mnemonic: `DB ${result.byteStrs.join(', ')}`,
                        isData: true
                    });
                }
                addr = result.nextAddr & 0xffff;
            } else {
                // Unknown region type - fallback to normal disassembly
                const instr = disasm.disassemble(addr);
                lines.push({
                    addr: addr,
                    bytes: instr.bytes,
                    mnemonic: instr.mnemonic,
                    isData: false
                });
                addr = (addr + instr.bytes.length) & 0xffff;
            }

            // Safety check for infinite loops
            if (lines.length > 1000) break;
        }

        return lines;
    }

    // Apply code folding with dynamic line fetching to fill the view
    // Keeps fetching more lines until we have targetLines visible after folding
    // countInstructions: false = fast (byte count only), true = scan fold lines for byte+instr count
    function disassembleWithFolding(startAddr, targetLines, countInstructions = false) {
        const result = [];
        let currentAddr = startAddr & 0xffff;
        const maxIterations = targetLines * 10; // Safety limit
        let iterations = 0;

        while (result.length < targetLines && currentAddr <= 0xffff && iterations < maxIterations) {
            iterations++;

            // Check if this address starts a collapsed subroutine
            const sub = subroutineManager.get(currentAddr);
            if (sub && sub.endAddress !== null && foldManager.isCollapsed(currentAddr)) {
                let byteCount, instrCount;
                if (countInstructions) {
                    const foldLines = disassembleWithRegions(currentAddr, 500);
                    byteCount = 0;
                    instrCount = 0;
                    for (const fl of foldLines) {
                        if (fl.addr > sub.endAddress) break;
                        byteCount += fl.bytes.length;
                        instrCount++;
                    }
                } else {
                    byteCount = sub.endAddress - currentAddr + 1;
                    instrCount = null;
                }
                const subName = sub.name || labelManager.get(currentAddr, getCurrentPage(currentAddr))?.name || `sub_${hex16(currentAddr)}`;
                result.push({
                    addr: currentAddr,
                    bytes: [],
                    mnemonic: '',
                    isData: false,
                    isFoldSummary: true,
                    foldType: 'subroutine',
                    foldName: subName,
                    foldEnd: sub.endAddress,
                    byteCount: byteCount,
                    instrCount: instrCount
                });
                currentAddr = (sub.endAddress + 1) & 0xffff;
                continue;
            }

            // Check if this address starts a collapsed user fold
            const userFold = foldManager.getUserFold(currentAddr);
            if (userFold && foldManager.isCollapsed(currentAddr)) {
                let byteCount, instrCount;
                if (countInstructions) {
                    const foldLines = disassembleWithRegions(currentAddr, 500);
                    byteCount = 0;
                    instrCount = 0;
                    for (const fl of foldLines) {
                        if (fl.addr > userFold.endAddress) break;
                        byteCount += fl.bytes.length;
                        instrCount++;
                    }
                }
                // endAddress is the START of the last folded instruction;
                // resume after that full instruction so we don't land
                // mid-opcode for a multi-byte last line.
                const lastLine = disassembleWithRegions(userFold.endAddress, 1)[0];
                const resumeAddr = (userFold.endAddress + (lastLine ? lastLine.bytes.length : 1)) & 0xffff;
                if (!countInstructions) {
                    byteCount = resumeAddr - currentAddr;
                    instrCount = null;
                }
                const foldName = userFold.name || `fold_${hex16(currentAddr)}`;
                result.push({
                    addr: currentAddr,
                    bytes: [],
                    mnemonic: '',
                    isData: false,
                    isFoldSummary: true,
                    foldType: 'user',
                    foldName: foldName,
                    foldEnd: userFold.endAddress,
                    byteCount: byteCount,
                    instrCount: instrCount
                });
                currentAddr = resumeAddr;
                continue;
            }

            // Normal line - disassemble one instruction
            const lineArr = disassembleWithRegions(currentAddr, 1);
            if (lineArr.length === 0) break;
            const line = lineArr[0];
            result.push(line);
            currentAddr = (currentAddr + line.bytes.length) & 0xffff;
        }

        return result;
    }

    return { disassembleWithRegions, disassembleWithFolding };
}
