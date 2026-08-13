// explorer-banks.js — snapshot/format info panels and RAM/ROM bank extraction
// for SNA/Z80/SZX, split out of ui/explorer.js.
//
// The Explorer holds its parsed-file state in closure variables that are
// reassigned on every load, so `ctx` passes them as getters: read
// ctx.explorerParsed at the point of use, never cache it.
import { hex8, hex16, escapeHtml, downloadFile } from '../core/utils.js';
import { SCREEN_SIZE, SCREEN_BITMAP_SIZE, SCREEN_ATTR_SIZE } from '../core/constants.js';

export function initExplorerBanks(ctx) {

    // === Bank extraction for SNA/Z80/SZX snapshots ===

    function explorerGetBankList() {
        if (!ctx.explorerParsed) return [];
        if (ctx.explorerParsed.is128) return [0, 1, 2, 3, 4, 5, 6, 7];
        return [5, 2, 0];
    }

    function explorerGetBankLogicalAddr(bankNum) {
        if (!ctx.explorerParsed) return 0;
        const port7FFD = ctx.explorerParsed.registers.port7FFD || 0;
        const pagedBank = port7FFD & 0x07;
        if (ctx.explorerParsed.is128) {
            if (bankNum === 5) return 0x4000;
            if (bankNum === 2) return 0x8000;
            if (bankNum === pagedBank) return 0xC000;
            return 0x0000; // not currently mapped — bank-relative only
        }
        // 48K
        if (bankNum === 5) return 0x4000;
        if (bankNum === 2) return 0x8000;
        if (bankNum === 0) return 0xC000;
        return 0x0000;
    }

    function explorerExtractSNABank(bankNum) {
        if (!ctx.explorerData || !ctx.explorerParsed || ctx.explorerParsed.type !== 'sna') return null;
        const is128 = ctx.explorerParsed.is128;
        if (!is128) {
            // 48K: banks 5/2/0 at offsets 27, 27+16384, 27+32768
            if (bankNum === 5) return ctx.explorerData.slice(27, 27 + 16384);
            if (bankNum === 2) return ctx.explorerData.slice(27 + 16384, 27 + 32768);
            if (bankNum === 0) return ctx.explorerData.slice(27 + 32768, 27 + 49152);
            return null;
        }
        // 128K SNA
        const port7FFD = ctx.explorerParsed.registers.port7FFD || 0;
        const pagedBank = port7FFD & 0x07;
        // Bank 5 always at offset 27
        if (bankNum === 5) return ctx.explorerData.slice(27, 27 + 16384);
        // Bank 2 always at offset 27+16384
        if (bankNum === 2) return ctx.explorerData.slice(27 + 16384, 27 + 32768);
        // Paged bank at offset 27+32768
        if (bankNum === pagedBank) return ctx.explorerData.slice(27 + 32768, 27 + 49152);
        // Remaining 5 banks at offset 49183
        const remainingBanks = [0, 1, 3, 4, 6, 7].filter(b => b !== pagedBank);
        const idx = remainingBanks.indexOf(bankNum);
        if (idx < 0) return null;
        const offset = 49183 + idx * 16384;
        if (offset + 16384 > ctx.explorerData.length) return null;
        return ctx.explorerData.slice(offset, offset + 16384);
    }

    function explorerExtractZ80Bank(bankNum) {
        if (!ctx.explorerData || !ctx.explorerParsed || ctx.explorerParsed.type !== 'z80') return null;
        if (ctx.explorerParsed.version === 1) {
            // V1 is always 48K — single 48KB block, extract banks 5/2/0
            let memory;
            if (ctx.explorerParsed.compressed) {
                let endMarker = ctx.explorerData.length;
                for (let i = 30; i < ctx.explorerData.length - 3; i++) {
                    if (ctx.explorerData[i] === 0x00 && ctx.explorerData[i + 1] === 0xED &&
                        ctx.explorerData[i + 2] === 0xED && ctx.explorerData[i + 3] === 0x00) {
                        endMarker = i;
                        break;
                    }
                }
                memory = ctx.explorerDecompressZ80(ctx.explorerData, 30, endMarker);
            } else {
                memory = ctx.explorerData.slice(30, 30 + 49152);
            }
            if (bankNum === 5) return memory.slice(0, 16384);
            if (bankNum === 2) return memory.slice(16384, 32768);
            if (bankNum === 0) return memory.slice(32768, 49152);
            return null;
        }
        // V2/V3: find page in parsed pages list
        let targetPageNum;
        if (ctx.explorerParsed.is128) {
            targetPageNum = bankNum + 3; // 128K: bank N = page N+3
        } else {
            // 48K page mapping: bank 5→page 8, bank 2→page 4, bank 0→page 5
            const mapping = { 5: 8, 2: 4, 0: 5 };
            targetPageNum = mapping[bankNum];
            if (targetPageNum === undefined) return null;
        }
        const page = ctx.explorerParsed.pages.find(p => p.num === targetPageNum);
        if (!page) return null;
        const dataOffset = page.offset + 3; // skip 3-byte page header
        if (page.compressed) {
            return ctx.explorerDecompressZ80(ctx.explorerData, dataOffset, dataOffset + page.compLen);
        }
        return ctx.explorerData.slice(dataOffset, dataOffset + 16384);
    }

    function explorerExtractSZXBank(bankNum) {
        if (!ctx.explorerData || !ctx.explorerParsed || ctx.explorerParsed.type !== 'szx') return null;
        return ctx.SZXLoader.extractRAMPage(ctx.explorerData, { chunks: ctx.explorerParsed.chunks }, bankNum);
    }

    function explorerExtractBank(bankNum) {
        if (ctx.explorerBankCache.has(bankNum)) return ctx.explorerBankCache.get(bankNum);
        let data = null;
        if (ctx.explorerParsed.type === 'sna') data = explorerExtractSNABank(bankNum);
        else if (ctx.explorerParsed.type === 'z80') data = explorerExtractZ80Bank(bankNum);
        else if (ctx.explorerParsed.type === 'szx') data = explorerExtractSZXBank(bankNum);
        if (data) {
            // Ensure it's a mutable copy in the cache
            const copy = new Uint8Array(data.length);
            copy.set(data);
            ctx.explorerBankCache.set(bankNum, copy);
            return copy;
        }
        return null;
    }

    function explorerReadSnapshotByte(addr) {
        if (addr < 0x4000) return 0; // ROM area — not available in snapshot
        let bankNum, offset;
        if (addr < 0x8000) {
            bankNum = 5; offset = addr - 0x4000;
        } else if (addr < 0xC000) {
            bankNum = 2; offset = addr - 0x8000;
        } else {
            const port7FFD = (ctx.explorerParsed.registers && ctx.explorerParsed.registers.port7FFD) || 0;
            bankNum = ctx.explorerParsed.is128 ? (port7FFD & 0x07) : 0;
            offset = addr - 0xC000;
        }
        const bank = explorerExtractBank(bankNum);
        if (!bank || offset >= bank.length) return 0;
        return bank[offset];
    }

    function explorerReadSnapshotWord(addr) {
        return explorerReadSnapshotByte(addr) | (explorerReadSnapshotByte(addr + 1) << 8);
    }

    function explorerReadSnapshotBlock(addr, length) {
        const result = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            result[i] = explorerReadSnapshotByte(addr + i);
        }
        return result;
    }

    function explorerRenderTAPInfo() {
        let html = `<div class="explorer-info-section"><div class="explorer-info-header">TAP File · ${ctx.explorerBlocks.length} blocks · ${ctx.explorerData.length} bytes</div><div class="explorer-block-list">`;

        for (let i = 0; i < ctx.explorerBlocks.length; i++) {
            const block = ctx.explorerBlocks[i];
            const data = block.data;

            // Calculate checksum (XOR of all bytes except the last one, which is the stored checksum)
            let calcChecksum = 0;
            for (let j = 0; j < data.length - 1; j++) {
                calcChecksum ^= data[j];
            }
            const storedChecksum = data[data.length - 1];
            const checksumOk = calcChecksum === storedChecksum;
            const checksumClass = checksumOk ? 'checksum-ok' : 'checksum-bad';
            const checksumMark = checksumOk ? '\u2713' : '\u2717';

            if (block.blockType === 'header') {
                // Header block - different colors for different types
                let blockClass = 'explorer-block';
                if (block.headerType === 0) blockClass += ' basic-block';
                else if (block.headerType === 3) blockClass += ' code-block';
                else if (block.headerType === 1 || block.headerType === 2) blockClass += ' array-block';

                html += `<div class="${blockClass}" data-block-index="${i}">`;
                html += `<div class="explorer-block-header">${i + 1}: ${block.typeName}</div>`;
                html += `<div class="explorer-block-meta">Flag: ${block.flag} ($${hex8(block.flag)}) | Length: ${block.length - 2} bytes | Checksum: ${hex8(storedChecksum)} <span class="${checksumClass}">${checksumMark}</span></div>`;
                html += `<div class="explorer-block-details">`;
                html += `<span class="label">Filename:</span> <span class="filename">"${block.name}"</span><br>`;
                const tapPreviewable = [SCREEN_SIZE, SCREEN_BITMAP_SIZE, 4096, 2048, SCREEN_ATTR_SIZE, 9216, 11136, 12288, 18432].includes(block.dataLength);
                const tapPreviewIcon = !tapPreviewable ? '' : block.dataLength === SCREEN_ATTR_SIZE ? ' 🔤' : ' 🖼️';
                html += `<span class="label">Data length:</span> ${block.dataLength} bytes<span class="explorer-tap-preview">${tapPreviewIcon}</span>`;

                if (block.headerType === 0) {
                    // Program
                    html += `<br><span class="label">Autostart:</span> ${block.autostart !== null ? block.autostart : 'None'}`;
                } else if (block.headerType === 3) {
                    // Bytes/CODE
                    html += `<br><span class="label">Start address:</span> <span class="value">$${hex16(block.startAddress)}</span>`;
                } else if (block.headerType === 1 || block.headerType === 2) {
                    // Number/Character array
                    html += `<br><span class="label">Variable name:</span> ${String.fromCharCode((block.param1 & 0x3F) + 0x40)}`;
                }

                html += `</div></div>`;
            } else {
                // Data block — indent under its header (when one precedes it) to show the pairing
                const afterHeader = i > 0 && ctx.explorerBlocks[i - 1].blockType === 'header';
                html += `<div class="explorer-block data-block" data-block-index="${i}"${afterHeader ? ' style="margin-left:18px"' : ''}>`;
                html += `<div class="explorer-block-header">${i + 1}: Data</div>`;
                html += `<div class="explorer-block-meta">Flag: ${block.flag} ($${hex8(block.flag)}) | Length: ${block.length - 2} bytes | Checksum: ${hex8(storedChecksum)} <span class="${checksumClass}">${checksumMark}</span></div>`;
                html += `</div>`;
            }
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderTZXInfo() {
        const p = ctx.explorerParsed;
        let html = `<div class="explorer-info-section"><div class="explorer-info-header">TZX File v${p.version} · ${ctx.explorerBlocks.length} blocks · ${ctx.explorerData.length.toLocaleString()} bytes</div><div class="explorer-block-list">`;

        for (let i = 0; i < ctx.explorerBlocks.length; i++) {
            const block = ctx.explorerBlocks[i];
            let blockClass = 'explorer-block';

            // Color code different block types
            if (block.id === 0x10 || block.id === 0x11 || block.id === 0x14) {
                if (block.headerType) blockClass += ' code-block';
                else if (block.dataBlock) blockClass += ' data-block';
                else blockClass += ' data-block';
            } else if (block.id === 0x30 || block.id === 0x31 || block.id === 0x32) {
                blockClass += ' basic-block'; // Text/info blocks
            } else if (block.id === 0x20 || block.id === 0x21 || block.id === 0x22 || block.id === 0x24 || block.id === 0x25) {
                blockClass += ' array-block'; // Control blocks
            }

            // Indent a data block that follows a header (a header has a fileName) to show pairing
            const tzxAfterHeader = block.dataBlock && i > 0 && ctx.explorerBlocks[i - 1].fileName != null;
            html += `<div class="${blockClass}" data-block-index="${i}"${tzxAfterHeader ? ' style="margin-left:18px"' : ''}>`;
            html += `<div class="explorer-block-header">${i + 1}: ${block.name}</div>`;
            let displayLen = block.dataLength !== undefined ? block.dataLength : block.length;
            if ((block.id === 0x10 || block.id === 0x11) && (block.headerType || block.dataBlock)) displayLen -= 2;
            html += `<div class="explorer-block-meta">Offset: ${block.offset} | ID: $${hex8(block.id)} | Length: ${displayLen} bytes</div>`;

            // Block-specific details
            let details = '';
            switch (block.id) {
                case 0x10: // Standard speed data
                    if (block.headerType) {
                        const tzxPreviewable = [SCREEN_SIZE, SCREEN_BITMAP_SIZE, 4096, 2048, SCREEN_ATTR_SIZE, 9216, 11136, 12288, 18432].includes(block.fileLength);
                        const tzxPreviewIcon = !tzxPreviewable ? '' : block.fileLength === SCREEN_ATTR_SIZE ? ' \uD83D\uDD24' : ' \uD83D\uDDBC\uFE0F';
                        details = `<span class="label">Type:</span> ${block.headerType}<br>`;
                        details += `<span class="label">Filename:</span> <span class="filename">"${block.fileName}"</span><br>`;
                        details += `<span class="label">Data length:</span> ${block.dataLength - 2} bytes<br>`;
                        details += `<span class="label">File length:</span> ${block.fileLength} bytes<span class="explorer-tap-preview">${tzxPreviewIcon}</span>`;
                        if (block.autostart !== undefined && block.autostart !== null) {
                            details += `<br><span class="label">Autostart:</span> ${block.autostart}`;
                        }
                        if (block.startAddress !== undefined) {
                            details += `<br><span class="label">Start address:</span> <span class="value">$${hex16(block.startAddress)}</span>`;
                        }
                    } else if (block.dataBlock) {
                        details = `<span class="label">Data length:</span> ${block.dataLength - 2} bytes`;
                    } else {
                        details = `<span class="label">Data length:</span> ${block.dataLength} bytes`;
                    }
                    if (block.pause) details += `<br><span class="label">Pause:</span> ${block.pause} ms`;
                    break;

                case 0x11: // Turbo speed data
                    if (block.headerType) {
                        const tzxPreviewable11 = [SCREEN_SIZE, SCREEN_BITMAP_SIZE, 4096, 2048, SCREEN_ATTR_SIZE, 9216, 11136, 12288, 18432].includes(block.fileLength);
                        const tzxPreviewIcon11 = !tzxPreviewable11 ? '' : block.fileLength === SCREEN_ATTR_SIZE ? ' \uD83D\uDD24' : ' \uD83D\uDDBC\uFE0F';
                        details = `<span class="label">Type:</span> ${block.headerType}<br>`;
                        details += `<span class="label">Filename:</span> <span class="filename">"${block.fileName}"</span><br>`;
                        details += `<span class="label">Data length:</span> ${block.dataLength - 2} bytes<br>`;
                        details += `<span class="label">File length:</span> ${block.fileLength} bytes<span class="explorer-tap-preview">${tzxPreviewIcon11}</span>`;
                        if (block.autostart !== undefined && block.autostart !== null) {
                            details += `<br><span class="label">Autostart:</span> ${block.autostart}`;
                        }
                        if (block.startAddress !== undefined) {
                            details += `<br><span class="label">Start address:</span> <span class="value">$${hex16(block.startAddress)}</span>`;
                        }
                    } else if (block.dataBlock) {
                        details = `<span class="label">Data length:</span> ${block.dataLength - 2} bytes`;
                    } else {
                        details = `<span class="label">Data length:</span> ${block.dataLength} bytes`;
                    }
                    if (block.pause) details += `<br><span class="label">Pause:</span> ${block.pause} ms`;
                    break;

                case 0x12: // Pure tone
                    details = `<span class="label">Pulse length:</span> ${block.pulseLength} T-states<br>`;
                    details += `<span class="label">Pulse count:</span> ${block.pulseCount}`;
                    break;

                case 0x14: // Pure data
                    details = `<span class="label">Data length:</span> ${block.dataLength} bytes`;
                    break;

                case 0x15: // Direct recording
                    details = `<span class="label">Data length:</span> ${block.dataLength} bytes`;
                    details += `<br><span class="label">T-states/sample:</span> ${block.tStatesPerSample}`;
                    details += `<br><span class="label">Last byte bits:</span> ${block.lastBits}`;
                    if (block.pause) details += `<br><span class="label">Pause:</span> ${block.pause} ms`;
                    break;

                case 0x20: // Pause/stop
                    if (block.stopTape) {
                        details = `<span class="label">Action:</span> Stop the tape`;
                    } else {
                        details = `<span class="label">Pause:</span> ${block.pause} ms`;
                    }
                    break;

                case 0x21: // Group start
                    details = `<span class="label">Group:</span> "${block.groupName}"`;
                    break;

                case 0x23: // Jump
                    details = `<span class="label">Jump:</span> ${block.jump} blocks`;
                    break;

                case 0x24: // Loop start
                    details = `<span class="label">Repetitions:</span> ${block.repetitions}`;
                    break;

                case 0x30: // Text description
                    details = `<span class="label">Text:</span> "${block.text}"`;
                    break;

                case 0x31: // Message
                    details = `<span class="label">Display time:</span> ${block.displayTime}s<br>`;
                    details += `<span class="label">Message:</span> "${block.message}"`;
                    break;

                case 0x32: // Archive info
                    if (block.archiveInfo && block.archiveInfo.length > 0) {
                        for (const info of block.archiveInfo) {
                            details += `<span class="label">${info.type}:</span> "${info.value}"<br>`;
                        }
                        details = details.slice(0, -4); // Remove trailing <br>
                    }
                    break;

                case 0x35: // Custom info
                    details = `<span class="label">Custom ID:</span> "${block.customId}"`;
                    break;
            }

            if (details) {
                html += `<div class="explorer-block-details">${details}</div>`;
            }

            if (block.error) {
                html += `<div class="explorer-block-details" style="color: var(--error);">${block.error}</div>`;
            }

            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderSNAInfo() {
        const r = ctx.explorerParsed.registers;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">SNA Snapshot (${ctx.explorerParsed.is128 ? '128K' : '48K'})</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Machine</th><td>${ctx.explorerParsed.is128 ? 'ZX Spectrum 128K' : 'ZX Spectrum 48K'}</td></tr>
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">Registers</div>
            ${ctx.explorerRenderRegsTable(r)}
        </div>`;

        return html;
    }

    function explorerRenderZ80Info() {
        const r = ctx.explorerParsed.registers;

        // Determine machine type name from hwMode
        let machineType = ctx.explorerParsed.is128 ? 'ZX Spectrum 128K' : 'ZX Spectrum 48K';
        if (ctx.explorerParsed.version >= 2) {
            const hwMode = ctx.explorerParsed.hwMode;
            if (ctx.explorerParsed.version === 2) {
                if (hwMode === 0) machineType = '48K';
                else if (hwMode === 1) machineType = '48K + IF1';
                else if (hwMode === 2) machineType = 'SamRam';
                else if (hwMode === 3) machineType = '128K';
                else if (hwMode === 4) machineType = '128K + IF1';
            } else {
                if (hwMode === 0) machineType = '48K';
                else if (hwMode === 1) machineType = '48K + IF1';
                else if (hwMode === 2) machineType = 'SamRam';
                else if (hwMode === 3) machineType = '48K + MGT';
                else if (hwMode === 4) machineType = '128K';
                else if (hwMode === 5) machineType = '128K + IF1';
                else if (hwMode === 6) machineType = '128K + MGT';
                else if (hwMode === 7) machineType = '+3';
                else if (hwMode === 9) machineType = 'Pentagon';
                else if (hwMode === 12) machineType = '+2';
                else if (hwMode === 13) machineType = '+2A';
            }
        }

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">Z80 Snapshot (v${ctx.explorerParsed.version})</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Version</th><td>${ctx.explorerParsed.version}</td></tr>
                <tr><th>Machine</th><td>${machineType} (hwMode=${ctx.explorerParsed.hwMode})</td></tr>
                <tr><th>Compressed</th><td>${ctx.explorerParsed.compressed ? 'Yes' : 'No'}</td></tr>
                ${ctx.explorerParsed.is128 ? `<tr><th>Port 7FFD</th><td>${hex8(ctx.explorerParsed.port7FFD)}</td></tr>` : ''}
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">Registers</div>
            <table class="explorer-info-table">
                <tr><th>PC</th><td>${hex16(r.PC)}</td><th>SP</th><td>${hex16(r.SP)}</td></tr>
                <tr><th>AF</th><td>${hex16(r.AF)}</td><th>AF'</th><td>${hex16(r.AFa)}</td></tr>
                <tr><th>BC</th><td>${hex16(r.BC)}</td><th>BC'</th><td>${hex16(r.BCa)}</td></tr>
                <tr><th>DE</th><td>${hex16(r.DE)}</td><th>DE'</th><td>${hex16(r.DEa)}</td></tr>
                <tr><th>HL</th><td>${hex16(r.HL)}</td><th>HL'</th><td>${hex16(r.HLa)}</td></tr>
                <tr><th>IX</th><td>${hex16(r.IX)}</td><th>IY</th><td>${hex16(r.IY)}</td></tr>
                <tr><th>I</th><td>${hex8(r.I)}</td><th>R</th><td>${hex8(r.R)}</td></tr>
                <tr><th>IM</th><td>${r.IM}</td><th>IFF1</th><td>${r.IFF1}</td></tr>
                <tr><th>Border</th><td>${r.border}</td><th>IFF2</th><td>${r.IFF2}</td></tr>
            </table>
        </div>`;

        // Show pages
        if (ctx.explorerParsed.pages && ctx.explorerParsed.pages.length > 0) {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Pages (${ctx.explorerParsed.pages.length})</div>
                <div class="explorer-block-list">`;

            for (const page of ctx.explorerParsed.pages) {
                const romClass = (page.num === 0 || page.num === 2) ? ' style="color: var(--cyan);"' : '';
                html += `<div class="explorer-block"${romClass}>
                    <span class="explorer-block-type">Page ${page.num}</span>
                    <span class="explorer-block-size">${page.desc} (${page.compLen} bytes${page.compressed ? ', compressed' : ''})</span>
                </div>`;
            }

            html += '</div></div>';
        }

        return html;
    }

    function explorerRenderSZXInfo() {
        if (ctx.explorerParsed.error) {
            return `<div class="explorer-info-section"><div class="explorer-info-header">SZX File</div><table class="explorer-info-table"><tr><th>Error</th><td>${ctx.explorerParsed.error}</td></tr></table></div>`;
        }

        const r = ctx.explorerParsed.registers;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">SZX Snapshot (v${ctx.explorerParsed.version}, ${ctx.explorerParsed.is128 ? '128K' : '48K'})</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Version</th><td>${ctx.explorerParsed.version}</td></tr>
                <tr><th>Machine</th><td>${ctx.explorerParsed.machineType} (ID: ${ctx.explorerParsed.machineId})</td></tr>
                <tr><th>Chunks</th><td>${ctx.explorerParsed.chunks.length}</td></tr>
            </table>
        </div>`;

        if (r && r.PC !== undefined) {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Registers</div>
                <table class="explorer-info-table">
                    <tr><th>PC</th><td>${hex16(r.PC)}</td><th>SP</th><td>${hex16(r.SP)}</td></tr>
                    <tr><th>AF</th><td>${hex16(r.AF)}</td><th>AF'</th><td>${hex16(r.AFa)}</td></tr>
                    <tr><th>BC</th><td>${hex16(r.BC)}</td><th>BC'</th><td>${hex16(r.BCa)}</td></tr>
                    <tr><th>DE</th><td>${hex16(r.DE)}</td><th>DE'</th><td>${hex16(r.DEa)}</td></tr>
                    <tr><th>HL</th><td>${hex16(r.HL)}</td><th>HL'</th><td>${hex16(r.HLa)}</td></tr>
                    <tr><th>IX</th><td>${hex16(r.IX)}</td><th>IY</th><td>${hex16(r.IY)}</td></tr>
                    <tr><th>I</th><td>${hex8(r.I)}</td><th>R</th><td>${hex8(r.R)}</td></tr>
                    <tr><th>IM</th><td>${r.IM}</td><th>IFF1</th><td>${r.IFF1}</td></tr>
                    <tr><th>Border</th><td>${r.border}</td><th>IFF2</th><td>${r.IFF2}</td></tr>
                </table>
            </div>`;
        }

        // Show chunk list
        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">Chunks</div>
            <div class="explorer-block-list">`;

        for (const chunk of ctx.explorerParsed.chunks) {
            html += `<div class="explorer-block">
                <span class="explorer-block-type">${chunk.id}</span>
                <span class="explorer-block-size">${chunk.size} bytes @ ${hex16(chunk.offset)}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderRZXInfo() {
        if (ctx.explorerParsed.error) {
            return `<div class="explorer-info-section"><div class="explorer-info-header">RZX File</div><table class="explorer-info-table"><tr><th>Error</th><td>${ctx.explorerParsed.error}</td></tr></table></div>`;
        }

        const stats = ctx.explorerParsed.stats;
        const creatorStr = ctx.explorerParsed.creatorInfo ?
            `${ctx.explorerParsed.creatorInfo.name} v${ctx.explorerParsed.creatorInfo.majorVersion}.${ctx.explorerParsed.creatorInfo.minorVersion}` :
            'Unknown';

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">RZX Input Recording</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Frames</th><td>${ctx.explorerParsed.totalFrames.toLocaleString()}</td></tr>
                <tr><th>Duration</th><td>${stats ? stats.durationSeconds + 's' : '?'} (@ 50fps)</td></tr>
                <tr><th>Snapshots</th><td>${ctx.explorerParsed.allSnapshots && ctx.explorerParsed.allSnapshots.length > 0
                    ? ctx.explorerParsed.allSnapshots.map((s, i) =>
                        `${s.ext.toUpperCase()}${i === 0 ? ' (start)' : i === ctx.explorerParsed.allSnapshots.length - 1 ? ' (end)' : ''} <button onclick="explorerExtractRZXSnapshot(${i})" class="small-btn">Extract</button>`
                      ).join('<br>')
                    : 'None'}</td></tr>
                <tr><th>Creator</th><td>${creatorStr}</td></tr>
            </table>
        </div>`;

        // Show frame statistics
        if (stats) {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Frame Statistics</div>
                <table class="explorer-info-table">
                    <tr><th>Total Inputs</th><td>${stats.totalInputs.toLocaleString()}</td></tr>
                    <tr><th>Total M1 Cycles</th><td>${stats.totalFetchCount.toLocaleString()}</td></tr>
                    <tr><th>Avg M1/Frame</th><td>${stats.avgFetchCount.toLocaleString()}</td></tr>
                    <tr><th>Avg Inputs/Frame</th><td>${stats.avgInputsPerFrame}</td></tr>
                    <tr><th>M1 Range</th><td>${stats.fetchRange.min} - ${stats.fetchRange.max}</td></tr>
                    <tr><th>Inputs Range</th><td>${stats.inputsRange.min} - ${stats.inputsRange.max}</td></tr>
                </table>
            </div>`;
        }

        // Show embedded snapshot registers if available
        if (ctx.explorerParsed.embeddedParsed && ctx.explorerParsed.embeddedParsed.registers) {
            const r = ctx.explorerParsed.embeddedParsed.registers;
            const snapType = ctx.explorerParsed.snapshotType.toUpperCase();
            const is128 = ctx.explorerParsed.embeddedParsed.is128;

            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Embedded ${snapType} Snapshot (${is128 ? '128K' : '48K'})</div>
                <table class="explorer-info-table">
                    <tr><th>PC</th><td>${hex16(r.PC)}</td><th>SP</th><td>${hex16(r.SP)}</td></tr>
                    <tr><th>AF</th><td>${hex16(r.AF)}</td><th>AF'</th><td>${hex16(r.AFa)}</td></tr>
                    <tr><th>BC</th><td>${hex16(r.BC)}</td><th>BC'</th><td>${hex16(r.BCa)}</td></tr>
                    <tr><th>DE</th><td>${hex16(r.DE)}</td><th>DE'</th><td>${hex16(r.DEa)}</td></tr>
                    <tr><th>HL</th><td>${hex16(r.HL)}</td><th>HL'</th><td>${hex16(r.HLa)}</td></tr>
                    <tr><th>IX</th><td>${hex16(r.IX)}</td><th>IY</th><td>${hex16(r.IY)}</td></tr>
                    <tr><th>I</th><td>${hex8(r.I)}</td><th>R</th><td>${hex8(r.R)}</td></tr>
                    <tr><th>IM</th><td>${r.IM}</td><th>Border</th><td>${r.border}</td></tr>
                </table>
            </div>`;

            // Show embedded snapshot pages
            const embPages = ctx.explorerParsed.embeddedParsed.pages;
            if (embPages && embPages.length > 0) {
                html += `<div class="explorer-info-section">
                    <div class="explorer-info-header">Snapshot Pages (${embPages.length})</div>
                    <div class="explorer-block-list">`;

                for (const page of embPages) {
                    const romClass = (page.num === 0 || page.num === 2) ? ' style="color: var(--cyan);"' : '';
                    html += `<div class="explorer-block"${romClass}>
                        <span class="explorer-block-type">Page ${page.num}</span>
                        <span class="explorer-block-size">${page.desc} (${page.compLen} bytes${page.compressed ? ', compressed' : ''})</span>
                    </div>`;
                }

                html += '</div></div>';
            }
        }

        // Show keypress timeline (human-readable)
        if (ctx.explorerParsed.frames && ctx.explorerParsed.frames.length > 0) {
            html += explorerRenderRZXKeyTimeline();
        }

        return html;
    }

    // Extract embedded snapshot from RZX and download it
    // index: which snapshot to extract (0 = first/start, default; higher = later/end)
    function explorerExtractRZXSnapshot(index = 0) {
        if (!ctx.explorerParsed || ctx.explorerParsed.type !== 'rzx') {
            alert('No RZX file loaded');
            return;
        }

        const allSnapshots = ctx.explorerParsed.allSnapshots;
        if (!allSnapshots || allSnapshots.length === 0) {
            alert('No embedded snapshots to extract');
            return;
        }

        if (index < 0 || index >= allSnapshots.length) {
            alert(`Invalid snapshot index: ${index}`);
            return;
        }

        const snapInfo = allSnapshots[index];
        const snapshot = snapInfo.data;
        const ext = snapInfo.ext || 'bin';
        const baseName = (ctx.explorerFileName.textContent || 'rzx_snapshot').replace(/\.rzx$/i, '');
        const suffix = allSnapshots.length > 1 ? `_snap${index + 1}` : '_embedded';
        const filename = baseName + suffix + '.' + ext;

        downloadFile(filename, snapshot);

    }
    // Make globally accessible for inline onclick in generated HTML
    window.explorerExtractRZXSnapshot = explorerExtractRZXSnapshot;

    // Decode RZX input value to human-readable format
    // NOTE: RZX only stores VALUES, not ports - so for keyboard we show all possible keys per bit
    function rzxDecodeInput(value) {
        // Kempston joystick: active HIGH, values 0x01-0x1F
        // Bits: 0=Right, 1=Left, 2=Down, 3=Up, 4=Fire
        if (value > 0 && value <= 0x1F) {
            const dirs = [];
            if (value & 0x01) dirs.push('Right');
            if (value & 0x02) dirs.push('Left');
            if (value & 0x04) dirs.push('Down');
            if (value & 0x08) dirs.push('Up');
            if (value & 0x10) dirs.push('Fire');
            return 'Kemp: ' + dirs.join('+');
        }

        // Keyboard: active LOW (0=pressed in bits 0-4)
        // All 8 possible keys for each bit (one per row):
        const keysPerBit = [
            'CS/A/Q/1/0/P/Ent/Spc',   // bit 0
            'Z/S/W/2/9/O/L/SS',        // bit 1
            'X/D/E/3/8/I/K/M',         // bit 2
            'C/F/R/4/7/U/J/N',         // bit 3
            'V/G/T/5/6/Y/H/B'          // bit 4
        ];

        const pressed = [];
        for (let bit = 0; bit < 5; bit++) {
            if ((value & (1 << bit)) === 0) {
                pressed.push(keysPerBit[bit]);
            }
        }

        if (pressed.length === 0) return '(none)';
        return pressed.join(' + ');
    }

    // Current RZX decode mode (for explorer)
    let rzxDecodeMode = 'all';

    // Decode pressed bits (already normalized: 1=pressed) to key names
    function rzxDecodeBits(bits, originalValue, mode = null) {
        mode = mode || rzxDecodeMode;

        // Check if Kempston (original value was low with bits SET)
        if (originalValue > 0 && originalValue <= 0x1F) {
            const dirs = [];
            if (bits & 0x01) dirs.push('Right');
            if (bits & 0x02) dirs.push('Left');
            if (bits & 0x04) dirs.push('Down');
            if (bits & 0x08) dirs.push('Up');
            if (bits & 0x10) dirs.push('Fire');
            return dirs.length > 0 ? dirs.join('+') : '(none)';
        }

        // Keyboard decode based on mode
        const decodeModes = {
            'all': [
                'CS/A/Q/1/0/P/Ent/Spc',   // bit 0
                'Z/S/W/2/9/O/L/SS',        // bit 1
                'X/D/E/3/8/I/K/M',         // bit 2
                'C/F/R/4/7/U/J/N',         // bit 3
                'V/G/T/5/6/Y/H/B'          // bit 4
            ],
            'if2p1': [  // Interface II Port 1 (1-5): 1=Left, 2=Right, 3=Down, 4=Up, 5=Fire
                'Left',   // bit 0 = 1
                'Right',  // bit 1 = 2
                'Down',   // bit 2 = 3
                'Up',     // bit 3 = 4
                'Fire'    // bit 4 = 5
            ],
            'if2p2': [  // Interface II Port 2 (6-0): 6=Left, 7=Right, 8=Down, 9=Up, 0=Fire
                'Fire',   // bit 0 = 0
                'Up',     // bit 1 = 9
                'Down',   // bit 2 = 8
                'Right',  // bit 3 = 7
                'Left'    // bit 4 = 6
            ],
            'cursors': [  // Cursor keys: 5=Left, 6=Down, 7=Up, 8=Right, 0=Fire
                'Fire',   // bit 0 = 0
                '?',      // bit 1 = 9
                'Right',  // bit 2 = 8
                'Up',     // bit 3 = 7
                'Left/Down' // bit 4 = 5 or 6
            ],
            'qaop': [  // QAOP + Space: Q=Up, A=Down, O=Left, P=Right, Space=Fire
                'Up/Fire',   // bit 0 = Q or Space
                'Down/Left', // bit 1 = A or O
                '?',         // bit 2
                '?',         // bit 3
                'Right'      // bit 4 = P (row 0xDF)
            ],
            'kempston': [
                'Right',  // bit 0
                'Left',   // bit 1
                'Down',   // bit 2
                'Up',     // bit 3
                'Fire'    // bit 4
            ]
        };

        const keysPerBit = decodeModes[mode] || decodeModes['all'];

        const pressed = [];
        for (let bit = 0; bit < 5; bit++) {
            if (bits & (1 << bit)) {
                pressed.push(keysPerBit[bit]);
            }
        }

        return pressed.length > 0 ? pressed.join('+') : '(none)';
    }

    // Check if a value indicates "no input" (all key bits = 1)
    function rzxIsNoInput(value) {
        return (value & 0x1F) === 0x1F || value === 0;
    }

    // Extract pressed key bits (0-4) from a value, ignoring upper bits
    function rzxGetPressedBits(value) {
        if (value > 0 && value <= 0x1F) {
            return value & 0x1F;
        }
        return (~value) & 0x1F;
    }

    function explorerRenderRZXKeyTimeline() {
        if (!ctx.explorerParsed.frames || ctx.explorerParsed.frames.length === 0) return '';

        const GAP_TOLERANCE = 5;  // frames

        const events = [];
        let currentBits = 0;
        let currentValue = 0xFF;
        let keyStartFrame = 0;
        let lastActiveFrame = 0;

        for (let i = 0; i < ctx.explorerParsed.frames.length; i++) {
            const frame = ctx.explorerParsed.frames[i];

            let frameBits = 0;
            let frameValue = 0xFF;

            for (const input of frame.inputs) {
                if (!rzxIsNoInput(input)) {
                    const bits = rzxGetPressedBits(input);
                    frameBits |= bits;
                    frameValue = input;
                }
            }

            if (frameBits !== 0 && currentBits === 0) {
                currentBits = frameBits;
                currentValue = frameValue;
                keyStartFrame = i;
                lastActiveFrame = i;
            } else if (frameBits === 0 && currentBits !== 0) {
                if (i - lastActiveFrame > GAP_TOLERANCE) {
                    events.push({
                        type: 'press',
                        startFrame: keyStartFrame,
                        endFrame: lastActiveFrame,
                        duration: lastActiveFrame - keyStartFrame + 1,
                        value: currentValue,
                        bits: currentBits
                    });
                    currentBits = 0;
                }
            } else if (frameBits !== 0 && currentBits !== 0) {
                if (frameBits === currentBits) {
                    lastActiveFrame = i;
                } else {
                    events.push({
                        type: 'press',
                        startFrame: keyStartFrame,
                        endFrame: lastActiveFrame,
                        duration: lastActiveFrame - keyStartFrame + 1,
                        value: currentValue,
                        bits: currentBits
                    });
                    currentBits = frameBits;
                    currentValue = frameValue;
                    keyStartFrame = i;
                    lastActiveFrame = i;
                }
            }
        }

        if (currentBits !== 0) {
            events.push({
                type: 'press',
                startFrame: keyStartFrame,
                endFrame: ctx.explorerParsed.frames.length - 1,
                duration: ctx.explorerParsed.frames.length - keyStartFrame,
                value: currentValue,
                bits: currentBits
            });
        }

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">Keypress Timeline (${events.length} keypresses)
                <select id="rzxDecodeMode" style="margin-left: 10px; font-size: 11px;">
                    <option value="all">All keys</option>
                    <option value="if2p1">Interface II Port 1 (1-5)</option>
                    <option value="if2p2">Interface II Port 2 (6-0)</option>
                    <option value="cursors">Cursor keys (5-8)</option>
                    <option value="qaop">QAOP + Space</option>
                    <option value="kempston">Kempston</option>
                </select>
            </div>
            <div class="explorer-file-list" style="max-height: 350px; font-size: 11px;">`;

        if (events.length === 0) {
            html += '<div style="color: var(--text-secondary); padding: 8px;">No keypresses detected</div>';
        } else {
            html += `<div class="explorer-file-entry" style="padding: 2px 4px; color: var(--text-secondary); border-bottom: 1px solid var(--border-color);">
                <span style="width: 55px; display: inline-block;">Start</span>
                <span style="width: 70px; display: inline-block;">Duration</span>
                <span>Keys (possible)</span>
            </div>`;

            const maxToShow = 200;
            for (let i = 0; i < Math.min(maxToShow, events.length); i++) {
                const e = events[i];
                const startMs = Math.round(e.startFrame * 20);
                const durMs = Math.round(e.duration * 20);
                const durStr = durMs >= 1000 ? `${(durMs/1000).toFixed(1)}s` : `${durMs}ms`;

                const keysStr = rzxDecodeBits(e.bits, e.value);

                const bitNums = [];
                for (let b = 0; b < 5; b++) {
                    if (e.bits & (1 << b)) bitNums.push(b);
                }
                const bitStr = bitNums.length > 0 ? `[b${bitNums.join(',')}]` : '';

                html += `<div class="explorer-file-entry" style="padding: 2px 4px;">
                    <span style="color: var(--cyan); width: 55px; display: inline-block;">F${e.startFrame}</span>
                    <span style="color: var(--text-secondary); width: 70px; display: inline-block;">${durStr}</span>
                    <span style="color: var(--text-primary);">${keysStr}</span>
                    <span style="color: var(--text-secondary); margin-left: 8px;">${bitStr}</span>
                </div>`;
            }

            if (events.length > maxToShow) {
                html += `<div style="color: var(--text-secondary); padding: 4px;">... and ${events.length - maxToShow} more keypresses</div>`;
            }
        }

        html += '</div></div>';

        html += explorerRenderRZXFrameDetails();

        return html;
    }

    function explorerRenderRZXFrameDetails() {
        const framesWithInput = [];
        for (let i = 0; i < ctx.explorerParsed.frames.length && framesWithInput.length < 30; i++) {
            const frame = ctx.explorerParsed.frames[i];
            const hasInput = frame.inputs.some(v => !rzxIsNoInput(v));
            if (hasInput) {
                framesWithInput.push({ index: i, frame });
            }
        }

        if (framesWithInput.length === 0) return '';

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">Frames with Input (first ${framesWithInput.length})</div>
            <div class="explorer-file-list" style="max-height: 250px; font-size: 11px;">`;

        for (const { index, frame } of framesWithInput) {
            const timeMs = Math.round(index * 20);

            const activeInputs = [...new Set(frame.inputs.filter(v => !rzxIsNoInput(v)))];
            const inputStr = activeInputs.map(v => rzxDecodeInput(v)).join('; ');

            html += `<div class="explorer-file-entry" style="padding: 2px 4px;">
                <span style="color: var(--cyan); width: 50px; display: inline-block;">F${index}</span>
                <span style="color: var(--text-secondary); width: 60px; display: inline-block;">${timeMs}ms</span>
                <span style="color: var(--text-secondary); width: 70px; display: inline-block;">M1:${frame.fetchCount}</span>
                <span style="color: #f80;">${inputStr}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    // TR-DOS BASIC autostart: stored in file data after $80 marker as $AA + LE16 line number
    // See https://sinclair.wiki.zxnet.co.uk/wiki/TR-DOS_filesystem
    function trdGetBasicAutostart(file) {
        if (file.ext !== 'B') return -1;
        // Editor files have .data, File Info tab files have .offset into explorerData
        const fileData = file.data
            ? file.data
            : (file.offset != null ? ctx.explorerData.slice(file.offset, file.offset + file.sectors * 256) : null);
        return trdBasicAutostartLine(fileData);
    }

    function explorerRenderTRDInfo() {
        const trdTypeNames = ctx.TRD_TYPE_NAMES;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">TRD Disk Image</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length} bytes</td></tr>
                <tr><th>Label</th><td>${ctx.explorerParsed.diskTitle || '(none)'}</td></tr>
                <tr><th>Files</th><td>${ctx.explorerParsed.files.length}</td></tr>
                <tr><th>Free</th><td>${ctx.explorerParsed.freeSectors} sectors</td></tr>
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">Files</div>
            <div class="explorer-file-list">`;

        for (let i = 0; i < ctx.explorerParsed.files.length; i++) {
            const file = ctx.explorerParsed.files[i];
            const typeName = trdTypeNames[file.ext] || file.ext;
            let detail = '';
            if (file.ext === 'C') {
                detail = `${file.startAddress} ($${hex16(file.startAddress)})`;
            } else if (file.ext === 'B') {
                const autostart = trdGetBasicAutostart(file);
                if (autostart >= 0) detail = `LINE ${autostart}`;
            }
            const len = file.length;
            const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                len === 11136 || len === 12288 || len === 18432;
            const previewIcon = !previewable ? '' : len === SCREEN_ATTR_SIZE ? '\uD83D\uDD24' : '\uD83D\uDDBC\uFE0F';
            const sizeAttr = explorerFileSizeAttr(file);
            html += `<div class="explorer-file-entry" data-index="${i}">
                <span class="explorer-file-num">${i + 1}</span>
                <span class="explorer-file-type" title="${typeName}">${typeName}</span>
                <span class="explorer-file-name">${file.name}</span>
                <span class="explorer-file-size"${sizeAttr}>${explorerFileSizeText(file)}</span>
                <span class="explorer-file-addr">${detail}</span>
                <span class="explorer-file-preview">${previewIcon}</span>
                <span class="explorer-file-sectors">${file.sectors} sector${file.sectors !== 1 ? 's' : ''}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    // A monoloader occupies more sectors than its declared length needs — a small
    // BASIC loader with CODE glued into the extra sectors. Its declared catalogue
    // length is then a misleading "size" (it's just the loader stub).
    function explorerIsMonoloader(file) {
        const needed = Math.ceil((file.length || 0) / 256);
        return !!file.sectors && file.sectors > needed;
    }

    // Size to show in the catalogue: the full on-disk allocation for a monoloader
    // (what's actually stored), else the declared length.
    function explorerFileSizeText(file) {
        return explorerIsMonoloader(file) ? file.sectors * 256 : (file.length || 0);
    }

    // Tooltip: for a monoloader, note the small declared loader length behind the
    // full size we now display.
    function explorerFileSizeAttr(file) {
        if (!explorerIsMonoloader(file)) return '';
        return ` title="${file.sectors} sectors on disk; declared length ${file.length} B (BASIC loader stub)"`;
    }

    function explorerRenderSCLInfo() {
        if (ctx.explorerParsed.error) {
            return `<div class="explorer-info-section">
                <div class="explorer-info-header">SCL File</div>
                <div style="color:#e74c3c">Error: ${ctx.explorerParsed.error}</div>
            </div>`;
        }

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">SCL Archive</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length} bytes</td></tr>
                <tr><th>Files</th><td>${ctx.explorerParsed.files.length}</td></tr>
            </table>
        </div>`;

        const trdTypeNames = ctx.TRD_TYPE_NAMES;
        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">Files</div>
            <div class="explorer-file-list">`;

        for (let i = 0; i < ctx.explorerParsed.files.length; i++) {
            const file = ctx.explorerParsed.files[i];
            const typeName = trdTypeNames[file.ext] || file.ext;
            let detail = '';
            if (file.ext === 'C') {
                detail = `${file.startAddress} ($${hex16(file.startAddress)})`;
            } else if (file.ext === 'B') {
                const autostart = trdGetBasicAutostart(file);
                if (autostart >= 0) detail = `LINE ${autostart}`;
            }
            const len = file.length;
            const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                len === 11136 || len === 12288 || len === 18432;
            const previewIcon = !previewable ? '' : len === SCREEN_ATTR_SIZE ? '\uD83D\uDD24' : '\uD83D\uDDBC\uFE0F';
            const sizeAttr = explorerFileSizeAttr(file);
            html += `<div class="explorer-file-entry" data-index="${i}">
                <span class="explorer-file-num">${i + 1}</span>
                <span class="explorer-file-type" title="${typeName}">${typeName}</span>
                <span class="explorer-file-name">${file.name}</span>
                <span class="explorer-file-size"${sizeAttr}>${explorerFileSizeText(file)}</span>
                <span class="explorer-file-addr">${detail}</span>
                <span class="explorer-file-preview">${previewIcon}</span>
                <span class="explorer-file-sectors">${file.sectors} sector${file.sectors !== 1 ? 's' : ''}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderMGTInfo() {
        const info = ctx.explorerParsed.info;
        const hasSAMDOS = ctx.explorerParsed.files.some(f => f.isSAMDOS);
        const hasGDOS = ctx.explorerParsed.files.some(f => !f.isSAMDOS);
        const dosLabel = hasSAMDOS && hasGDOS ? 'SAMDOS + G+DOS (mixed)' :
                         hasSAMDOS ? 'SAMDOS (SAM Coupé)' : '+D/DISCiPLE (G+DOS)';
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">MGT Disk Image — ${dosLabel}</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length} bytes</td></tr>
                <tr><th>Geometry</th><td>${info.tracks}T × ${info.sides}S × ${info.sectorsPerTrack}sec × ${info.bytesPerSector}B</td></tr>
                <tr><th>Files</th><td>${info.fileCount} / ${info.maxFiles}</td></tr>
                <tr><th>Free</th><td>${info.freeSectors} sectors (${info.freeSectors * 512} bytes)</td></tr>
            </table>
        </div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">Files</div>
            <div class="explorer-file-list">`;

        for (let i = 0; i < ctx.explorerParsed.files.length; i++) {
            const file = ctx.explorerParsed.files[i];
            const typeName = file.typeName;
            let detail = '';
            if (file.mgtType === 4 || file.mgtType === 7 || file.mgtType === 19 || file.mgtType === 20) {
                // CODE or SCREEN$ (G+DOS 4/7, SAMDOS 19/20)
                detail = `${file.startAddress} ($${hex16(file.startAddress)})`;
            } else if ((file.mgtType === 1 || file.mgtType === 16) && file.autostart != null && file.autostart < 0x8000) {
                detail = `LINE ${file.autostart}`;
            }
            const len = file.length;
            const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                len === 11136 || len === 12288 || len === 18432;
            const previewIcon = !previewable ? '' : len === SCREEN_ATTR_SIZE ? '\uD83D\uDD24' : '\uD83D\uDDBC\uFE0F';
            html += `<div class="explorer-file-entry" data-index="${i}">
                <span class="explorer-file-num">${i + 1}</span>
                <span class="explorer-file-type" title="${typeName}">${typeName}</span>
                <span class="explorer-file-name">${file.name}</span>
                <span class="explorer-file-size">${file.length}</span>
                <span class="explorer-file-addr">${detail}</span>
                <span class="explorer-file-preview">${previewIcon}</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    function explorerRenderMDRInfo() {
        const info = ctx.explorerParsed.info;
        const isOversized = info.totalSectors > 254;
        const sizeNote = isOversized ? ` <span style="color:var(--cyan)">(${Math.ceil(info.totalSectors / 254)} cartridges)</span>` : '';
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">MDR Cartridge Image (Interface 1 Microdrive)</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length} bytes</td></tr>
                <tr><th>Cartridge</th><td>${escapeHtml(info.cartridgeName || '(unnamed)')}</td></tr>
                <tr><th>Sectors</th><td>${info.totalSectors} (${info.usedSectors} used, ${info.freeSectors} free)${sizeNote}</td></tr>
                <tr><th>Files</th><td>${info.fileCount}${info.deletedCount ? ` + ${info.deletedCount} deleted` : ''}</td></tr>
                <tr><th>Write protect</th><td>${info.writeProtect ? 'Yes' : 'No'}</td></tr>
            </table>
        </div>`;

        const files = ctx.explorerParsed.files;
        if (files.length > 0) {
            html += '<div class="explorer-info-section"><div class="explorer-info-header">Files</div>';
            html += '<div class="explorer-file-list">';
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                let detail = '';
                if (f.ext === 'C') {
                    detail = `${f.startAddress} ($${hex16(f.startAddress)})`;
                } else if (f.ext === 'B' && f.autorunLine >= 0) {
                    detail = `LINE ${f.autorunLine}`;
                }
                const len = f.isPrint ? f.length : f.dataLength;
                const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                    len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                    len === 11136 || len === 12288 || len === 18432;
                const previewIcon = !previewable ? '' : len === SCREEN_ATTR_SIZE ? '\uD83D\uDD24' : '\uD83D\uDDBC\uFE0F';
                const deletedStyle = f.deleted ? ' style="opacity: 0.45"' : '';
                const deletedTag = f.deleted ? ' <span style="color:var(--accent);font-size:0.85em">[Deleted]</span>' : '';
                html += `<div class="explorer-file-entry" data-index="${i}"${deletedStyle}>
                    <span class="explorer-file-num">${i + 1}</span>
                    <span class="explorer-file-type" title="${f.typeName}">${f.typeName}</span>
                    <span class="explorer-file-name">${escapeHtml(f.name)}${deletedTag}</span>
                    <span class="explorer-file-size">${f.dataLength}</span>
                    <span class="explorer-file-addr">${detail}</span>
                    <span class="explorer-file-preview">${previewIcon}</span>
                    <span class="explorer-file-sectors">${f.sectors} sector${f.sectors !== 1 ? 's' : ''}</span>
                </div>`;
            }
            html += '</div></div>';
        }

        return html;
    }

    function explorerRenderOPDInfo() {
        const info = ctx.explorerParsed.info;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">OPD Disk Image (Opus Discovery)</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length} bytes</td></tr>
                <tr><th>Geometry</th><td>${info.tracks}T × ${info.sides}S × ${info.sectorsPerTrack}sec × ${info.bytesPerSector}B</td></tr>
                <tr><th>Capacity</th><td>${(info.totalSectors * info.bytesPerSector / 1024).toFixed(0)}KB (${info.totalSectors} sectors)</td></tr>`;
        if (info.diskLabel) {
            html += `<tr><th>Label</th><td>${escapeHtml(info.diskLabel)}</td></tr>`;
        }
        html += `<tr><th>Files</th><td>${info.fileCount}</td></tr>
                <tr><th>Used</th><td>${info.usedSectors} sectors (${info.usedSectors * info.bytesPerSector} bytes)</td></tr>
                <tr><th>Free</th><td>${info.freeSectors} sectors (${info.freeSectors * info.bytesPerSector} bytes)</td></tr>
            </table>
        </div>`;

        if (ctx.explorerParsed.files.length > 0) {
            html += '<div class="explorer-info-section"><div class="explorer-info-header">Files</div>';
            html += '<div class="explorer-file-list">';
            for (let i = 0; i < ctx.explorerParsed.files.length; i++) {
                const f = ctx.explorerParsed.files[i];
                let detail = '';
                if (f.type === 3) {
                    detail = `${f.startAddr} ($${hex16(f.startAddr)})`;
                } else if (f.type === 0 && f.autostart != null && f.autostart < 0x8000) {
                    detail = `LINE ${f.autostart}`;
                }
                const len = f.length || 0;
                const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                    len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                    len === 11136 || len === 12288 || len === 18432;
                const previewIcon = !previewable ? '' : len === SCREEN_ATTR_SIZE ? '\uD83D\uDD24' : '\uD83D\uDDBC\uFE0F';
                html += `<div class="explorer-file-entry" data-index="${i}">
                    <span class="explorer-file-num">${i + 1}</span>
                    <span class="explorer-file-type">${f.typeName}</span>
                    <span class="explorer-file-name">${escapeHtml(f.name || '(unnamed)')}</span>
                    <span class="explorer-file-size">${len}</span>
                    <span class="explorer-file-addr">${detail}</span>
                    <span class="explorer-file-preview">${previewIcon}</span>
                    <span class="explorer-file-sectors">${f.sectors} sector${f.sectors !== 1 ? 's' : ''}</span>
                </div>`;
            }
            html += '</div></div>';
        } else {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Files</div>
                <span class="dim">No files on disk.</span>
            </div>`;
        }

        return html;
    }

    function explorerRenderDidaktikInfo() {
        const info = ctx.explorerParsed.info;
        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">Didaktik 40/80 Disk Image (MDOS)</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${ctx.explorerData.length} bytes</td></tr>
                <tr><th>Geometry</th><td>${info.tracks}T × ${info.sides}S × ${info.sectorsPerTrack}sec × ${info.bytesPerSector}B</td></tr>
                <tr><th>Sectors</th><td>${info.totalSectors}</td></tr>`;
        if (info.diskLabel) {
            html += `<tr><th>Label</th><td>${escapeHtml(info.diskLabel)}</td></tr>`;
        }
        html += `<tr><th>Files</th><td>${info.fileCount}</td></tr>
            </table>
        </div>`;

        const files = ctx.explorerParsed.files;
        if (files.length > 0) {
            html += '<div class="explorer-info-section"><div class="explorer-info-header">Files</div>';
            html += '<div class="explorer-file-list">';
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                let detail = '';
                if (f.type === 'B') {
                    detail = `${f.startAddr} ($${hex16(f.startAddr)})`;
                } else if (f.type === 'P' && f.startAddr && f.startAddr < 0x8000) {
                    detail = `LINE ${f.startAddr}`;
                }
                const len = f.length || 0;
                const previewable = len === SCREEN_SIZE || len === SCREEN_BITMAP_SIZE || len === 4096 ||
                    len === 2048 || len === SCREEN_ATTR_SIZE || len === 9216 ||
                    len === 11136 || len === 12288 || len === 18432;
                const previewIcon = !previewable ? '' : len === SCREEN_ATTR_SIZE ? '🔤' : '🖼️';
                html += `<div class="explorer-file-entry" data-index="${i}">
                    <span class="explorer-file-num">${i + 1}</span>
                    <span class="explorer-file-type" title="${f.typeName}">${f.type}</span>
                    <span class="explorer-file-name">${escapeHtml(f.name || '(unnamed)')}</span>
                    <span class="explorer-file-size">${len}</span>
                    <span class="explorer-file-addr">${detail}</span>
                    <span class="explorer-file-preview">${previewIcon}</span>
                </div>`;
            }
            html += '</div></div>';
        } else {
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Files</div>
                <span class="dim">No files on disk.</span>
            </div>`;
        }

        return html;
    }

    function explorerRenderHobetaInfo() {
        if (ctx.explorerParsed.error) {
            return `<div class="explorer-info-section">
                <div class="explorer-info-header">Hobeta File</div>
                <div style="color:#e74c3c">Error: ${ctx.explorerParsed.error}</div>
            </div>`;
        }

        const f = ctx.explorerParsed.file;
        const len = f.length;
        const previewable = len === 6912 || len === 6144 || len === 4096 ||
            len === 2048 || len === 768 || len === 9216 ||
            len === 11136 || len === 12288 || len === 18432;
        const previewIcon = !previewable ? '' : len === 768 ? ' \uD83D\uDD24' : ' \uD83D\uDDBC\uFE0F';
        return `<div class="explorer-info-section">
            <div class="explorer-info-header">Hobeta File</div>
            <table class="explorer-info-table">
                <tr><th>File size</th><td>${ctx.explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Name</th><td>${f.name.replace(/\s+$/, '')}</td></tr>
                <tr><th>Extension</th><td>${f.ext} (${ctx.explorerParsed.typeName})</td></tr>
                <tr><th>Data length</th><td>${f.length.toLocaleString()} bytes</td></tr>
                <tr><th>Start address</th><td>$${hex16(f.startAddress)}</td></tr>
            </table>
        </div>`;
    }

    function findStringInSector(data, str) {
        if (!data || data.length < str.length) return -1;
        const len = data.length - str.length + 1;
        outer:
        for (let i = 0; i < len; i++) {
            for (let j = 0; j < str.length; j++) {
                if (data[i + j] !== str.charCodeAt(j)) continue outer;
            }
            return i;
        }
        return -1;
    }

    function detectDiskProtection(dskImage) {
        if (!dskImage || dskImage.numTracks === 0) return null;

        // Survey all tracks for uniformity and FDC errors
        let uniform = true;
        let hasErrors = false;
        const t0 = dskImage.getTrack(0, 0);
        if (!t0) return null;
        const refCount = t0.sectors.length;
        const refSize = refCount > 0 ? t0.sectors[0].sizeCode : -1;

        for (let cyl = 0; cyl < dskImage.numTracks; cyl++) {
            for (let head = 0; head < dskImage.numSides; head++) {
                const track = dskImage.getTrack(cyl, head);
                if (!track) { uniform = false; continue; }
                if (track.sectors.length !== refCount) uniform = false;
                for (const sec of track.sectors) {
                    if (sec.sizeCode !== refSize) uniform = false;
                    if (sec.st1 || sec.st2) hasErrors = true;
                }
            }
        }

        if (uniform && !hasErrors) return null;

        // Helper: get track data
        function getTrack(cyl, head) {
            if (cyl >= dskImage.numTracks) return null;
            if (head >= dskImage.numSides) return null;
            return dskImage.getTrack(cyl, head);
        }

        // Helper: search for string in all sectors of a track
        function findInTrack(cyl, head, str) {
            const t = getTrack(cyl, head);
            if (!t) return false;
            for (const sec of t.sectors) {
                if (sec.data && findStringInSector(sec.data, str) >= 0) return true;
            }
            return false;
        }

        // Helper: search in a specific sector index of a track
        function findInSectorIdx(cyl, head, idx, str) {
            const t = getTrack(cyl, head);
            if (!t || idx >= t.sectors.length) return false;
            return t.sectors[idx].data && findStringInSector(t.sectors[idx].data, str) >= 0;
        }

        // 1. Alkatraz
        function detectAlkatraz() {
            if (findInTrack(0, 0, 'THE ALKATRAZ PROTECTION SYSTEM')) return 'Alkatraz';
            // Structural: 18-sector track with 256B sectors
            for (let cyl = 0; cyl < dskImage.numTracks; cyl++) {
                for (let head = 0; head < dskImage.numSides; head++) {
                    const t = getTrack(cyl, head);
                    if (t && t.sectors.length === 18 && t.sectors[0].sizeCode === 1) return 'Alkatraz';
                }
            }
            return null;
        }

        // 2. Frontier
        function detectFrontier() {
            if (findInTrack(1, 0, 'W DISK PROTECTION SYSTEM. (C) 1990 BY NEW FRONTIER SOFT.'))
                return 'Frontier';
            // Structural: T9=1 sector + T0/S0 dataSize=4096
            const t9 = getTrack(9, 0);
            if (t9 && t9.sectors.length === 1 && t0.sectors.length > 0 && t0.sectors[0].data && t0.sectors[0].data.length === 4096)
                return 'Frontier';
            return null;
        }

        // 3. Hexagon
        function detectHexagon() {
            for (let cyl = 0; cyl <= 3 && cyl < dskImage.numTracks; cyl++) {
                if (findInTrack(cyl, 0, 'HEXAGON DISK PROTECTION c 1989')) return 'Hexagon';
                if (findInTrack(cyl, 0, 'HEXAGON Disk Protection c 1989')) return 'Hexagon';
            }
            // Structural: T0=10sec + track with 1 sector fdcSize=6 st1=32 st2=96
            if (t0.sectors.length === 10) {
                for (let cyl = 1; cyl < dskImage.numTracks; cyl++) {
                    const t = getTrack(cyl, 0);
                    if (t && t.sectors.length === 1 && t.sectors[0].sizeCode === 6
                        && t.sectors[0].st1 === 32 && t.sectors[0].st2 === 96)
                        return `Hexagon (T${cyl}/S0)`;
                }
            }
            return null;
        }

        // 4. Paul Owens
        function detectPaulOwens() {
            if (findInSectorIdx(0, 0, 2, 'PAUL OWENS\x80PROTECTION SYS')) return 'Paul Owens';
            // Structural: T0=9 T1=0 sectors T2=6 sectors 256B
            const t1 = getTrack(1, 0);
            const t2 = getTrack(2, 0);
            if (t0.sectors.length === 9 && t1 && t1.sectors.length === 0
                && t2 && t2.sectors.length === 6 && t2.sectors[0].sizeCode === 1)
                return 'Paul Owens';
            return null;
        }

        // 5. Speedlock
        function detectSpeedlock() {
            // Signature-based: 10 copyright strings
            const sigTests = [
                ['Speedlock 1985', 'Speedlock +3 Protection Systems  (C) 1985 Speedlock Associates'],
                ['Speedlock 1986', 'Speedlock +3 Protection System  (C) 1986 Speedlock Associates'],
                ['Speedlock 1986', 'SPEEDLOCK +3 PROTECTION SYSTEM (C) 1986 SPEEDLOCK ASSOCIATES'],
                ['Speedlock 1987', 'Speedlock +3 Protection Systems (C) 1987  D.Love & D.Maybury'],
                ['Speedlock 1987', 'SPEEDLOCK +3 PROTECTION SYSTEM (C) 1987 SPEEDLOCK ASSOCIATES'],
                ['Speedlock 1988', 'Speedlock +3 Protection System (C)1988 Speedlock Associates.'],
                ['Speedlock 1988', 'SPEEDLOCK +3 PROTECTION SYSTEM (C) 1988 SPEEDLOCK ASSOCIATES'],
                ['Speedlock 1989', 'SPEEDLOCK +3 DISC PROTECTION SYSTEMS (C) 1989 SPEEDLOCK ASSOC.'],
                ['Speedlock 1989', 'SPEEDLOCK +3 DISC PROTECTION SYSTEM(C) 1989 SPEEDLOCK ASSOCS.'],
                ['Speedlock 1990', 'SPEEDLOCK DISC PROTECTION SYSTEM (C)1990 SPEEDLOCK ASSOCIATES'],
            ];
            for (const [name, sig] of sigTests) {
                for (let cyl = 0; cyl < Math.min(dskImage.numTracks, 5); cyl++) {
                    if (findInTrack(cyl, 0, sig)) return name;
                }
            }
            // Structural: +3 1987 — T0=9sec T1=5sec×1024B T0/S6 st2=64 T0/S8 st2=0
            const t1 = getTrack(1, 0);
            if (t0.sectors.length === 9 && t1 && t1.sectors.length === 5 && t1.sectors[0].sizeCode === 3) {
                if (t0.sectors.length > 8 && t0.sectors[6].st2 === 64 && t0.sectors[8].st2 === 0)
                    return 'Speedlock +3 1987';
                // +3 1988 — same but T0/S8 st2=64
                if (t0.sectors.length > 8 && t0.sectors[6].st2 === 64 && t0.sectors[8].st2 === 64)
                    return 'Speedlock +3 1988';
            }
            // 1989/1990: T0>7sec T1=1sec ID=193 st1=32
            if (t0.sectors.length > 7 && t1 && t1.sectors.length === 1
                && t1.sectors[0].id === 193 && t1.sectors[0].st1 === 32)
                return 'Speedlock 1989/1990';
            return null;
        }

        // 6. Three Inch
        function detectThreeInch() {
            const sigs = [
                [0, 0, 0, '***Loader Copyright Three Inch Software 1988'],
                [0, 0, 7, '***Loader Copyright Three Inch Software 1988'],
                [1, 0, 4, '***Loader Copyright Three Inch Software 1988'],
                [0, 0, 0, '***Loader (c) Three Inch Software 1988'],
            ];
            for (const [cyl, head, idx, sig] of sigs) {
                if (findInSectorIdx(cyl, head, idx, sig)) return 'Three Inch Loader';
            }
            return null;
        }

        // 7. Laser Load
        function detectLaserLoad() {
            if (findInSectorIdx(0, 0, 2, 'Laser Load   By C.J.Pink For Consult Computer    Systems'))
                return 'Laser Load';
            return null;
        }

        // 8. W.R.M
        function detectWRM() {
            const t8 = getTrack(8, 0);
            if (t8 && t8.sectors.length > 9 && t8.sectors[9].data) {
                const d = t8.sectors[9].data;
                if (findStringInSector(d, 'W.R.M Disc') >= 0
                    && findStringInSector(d, 'Protection') >= 0
                    && findStringInSector(d, 'System (c) 1987') >= 0)
                    return 'W.R.M.';
            }
            return null;
        }

        // 9. P.M.S.
        function detectPMS() {
            if (findInTrack(0, 0, '[C] P.M.S. 1986')) return 'P.M.S.';
            if (findInTrack(0, 0, 'P.M.S. LOADER [C]1986')) return 'P.M.S.';
            if (findInTrack(0, 0, '[C]P.M.S.1986')) return 'P.M.S.';
            if (findInTrack(0, 0, 'P.M.S. PROTECTION [C]1986')) return 'P.M.S.';
            // Structural: T0 formatted, T1 unformatted, T2 formatted
            const t1 = getTrack(1, 0);
            const t2 = getTrack(2, 0);
            if (t0.sectors.length > 0 && t1 && t1.sectors.length === 0
                && t2 && t2.sectors.length > 0)
                return 'P.M.S.';
            return null;
        }

        // 10. Players
        function detectPlayers() {
            for (let cyl = 0; cyl < dskImage.numTracks; cyl++) {
                for (let head = 0; head < dskImage.numSides; head++) {
                    const t = getTrack(cyl, head);
                    if (!t || t.sectors.length !== 16) continue;
                    let match = true;
                    for (let i = 0; i < 16; i++) {
                        if (t.sectors[i].id !== i || t.sectors[i].sizeCode !== i) { match = false; break; }
                    }
                    if (match) return 'Players';
                }
            }
            return null;
        }

        // 11. Infogrames
        function detectInfogrames() {
            const t39 = getTrack(39, 0);
            if (t39) {
                for (const sec of t39.sectors) {
                    if (sec.sizeCode === 2 && sec.data && sec.data.length === 540)
                        return 'Infogrames';
                }
            }
            return null;
        }

        // 12. Rainbow Arts
        function detectRainbowArts() {
            const t40 = getTrack(40, 0);
            if (t40) {
                for (const sec of t40.sectors) {
                    if (sec.id === 198 && sec.st1 === 32 && sec.st2 === 32)
                        return 'Rainbow Arts';
                }
            }
            return null;
        }

        // 13. Remi + KBI
        function detectRemiKBI() {
            const parts = [];
            // Remi Herbulot signature
            for (let cyl = 0; cyl < dskImage.numTracks; cyl++) {
                if (findInTrack(cyl, 0, 'PROTECTION      Remi HERBULOT')) {
                    parts.push('Remi Herbulot');
                    break;
                }
            }
            // KBI signature
            for (let cyl = 0; cyl < dskImage.numTracks; cyl++) {
                if (findInTrack(cyl, 0, '(c) 1986 for KBI ')) {
                    parts.push('KBI-19');
                    break;
                }
            }
            // KBI-10 structural: T39=10sec T38=9sec, T39 sector with st1=32 st2=32
            if (parts.length === 0 || !parts.includes('KBI-19')) {
                const t39 = getTrack(39, 0);
                const t38 = getTrack(38, 0);
                if (t39 && t38 && t39.sectors.length === 10 && t38.sectors.length === 9) {
                    for (const sec of t39.sectors) {
                        if (sec.st1 === 32 && sec.st2 === 32) {
                            if (!parts.includes('KBI-10')) parts.push('KBI-10');
                            break;
                        }
                    }
                }
            }
            // CAAV
            for (let cyl = 0; cyl < dskImage.numTracks; cyl++) {
                if (findInTrack(cyl, 0, 'ALAIN LAURENT GENERATION 5 1989')) {
                    parts.push('CAAV');
                    break;
                }
            }
            return parts.length > 0 ? parts.join(' + ') : null;
        }

        // 14. DiscSYS
        function detectDiscSYS() {
            // Structural: 16-sector track where id=track=side=idx for all sectors
            for (let cyl = 0; cyl < dskImage.numTracks; cyl++) {
                for (let head = 0; head < dskImage.numSides; head++) {
                    const t = getTrack(cyl, head);
                    if (!t || t.sectors.length !== 16) continue;
                    let match = true;
                    for (let i = 0; i < 16; i++) {
                        const s = t.sectors[i];
                        if (s.id !== i || s.cylinder !== cyl || s.head !== head) { match = false; break; }
                    }
                    if (match) return 'DiscSYS';
                }
            }
            // Signature
            for (let cyl = 0; cyl < dskImage.numTracks; cyl++) {
                if (findInTrack(cyl, 0, 'discsys')) return 'DiscSYS';
                if (findInTrack(cyl, 0, 'MEAN PROTECTION SYSTEM')) return 'DiscSYS';
            }
            return null;
        }

        // 15. Amsoft
        function detectAmsoft() {
            const t3 = getTrack(3, 0);
            if (t3) {
                for (const sec of t3.sectors) {
                    if (sec.data && findStringInSector(sec.data, 'Amsoft disc protection system') >= 0
                        && findStringInSector(sec.data, 'EXOPAL') >= 0)
                        return 'Amsoft/EXOPAL';
                }
            }
            return null;
        }

        // 16. ARMOURLOC
        function detectArmourloc() {
            if (t0.sectors.length > 0 && t0.sectors[0].data && t0.sectors[0].data.length > 7) {
                if (findStringInSector(t0.sectors[0].data.subarray(0, 10), '0K free') === 2)
                    return 'ARMOURLOC';
            }
            return null;
        }

        // 17. Studio B
        function detectStudioB() {
            if (findInSectorIdx(0, 0, 0, 'Disc format (c) 1986 Studio B Ltd.')) return 'Studio B';
            if (findInSectorIdx(2, 0, 0, 'DISCLOC')) return 'Studio B/DiscLoc';
            // Structural: T0 formatted T1 unformatted T2 formatted
            const t1 = getTrack(1, 0);
            const t2 = getTrack(2, 0);
            if (t0.sectors.length > 0 && t1 && t1.sectors.length === 0
                && t2 && t2.sectors.length > 0) {
                // Only if not already matched by P.M.S.
                if (!findInTrack(0, 0, 'P.M.S.') && !findInTrack(0, 0, '[C] P.M.S.'))
                    return 'Studio B';
            }
            return null;
        }

        // Try detectors in order
        const detectors = [
            detectAlkatraz, detectFrontier, detectHexagon, detectPaulOwens,
            detectSpeedlock, detectThreeInch, detectLaserLoad, detectWRM,
            detectPMS, detectPlayers, detectInfogrames, detectRainbowArts,
            detectRemiKBI, detectDiscSYS, detectAmsoft, detectArmourloc,
            detectStudioB
        ];

        for (const detect of detectors) {
            const result = detect();
            if (result) return result;
        }

        // Fallback: non-uniform or has errors but no match
        return 'Unknown copy protection';
    }

    function detectBootloader(dskImage, diskSpec) {
        if (!dskImage) return null;
        const firstSectorId = diskSpec && diskSpec.firstSectorId !== undefined
            ? diskSpec.firstSectorId : 1;
        const bootSector = dskImage.readSector(0, 0, firstSectorId);
        if (!bootSector || bootSector.length <= 16) return null;
        const codeData = bootSector.slice(16);
        // Blank check: all same byte = no code
        const first = codeData[0];
        let blank = true;
        for (let i = 1; i < codeData.length; i++) {
            if (codeData[i] !== first) { blank = false; break; }
        }
        if (blank) return null;
        return { bootData: bootSector, codeData };
    }

    return {
        detectBootloader,
        detectDiskProtection,
        explorerExtractBank,
        explorerFileSizeAttr,
        explorerFileSizeText,
        explorerGetBankList,
        explorerGetBankLogicalAddr,
        explorerReadSnapshotBlock,
        explorerReadSnapshotWord,
        explorerRenderDidaktikInfo,
        explorerRenderHobetaInfo,
        explorerRenderMDRInfo,
        explorerRenderMGTInfo,
        explorerRenderOPDInfo,
        explorerRenderRZXInfo,
        explorerRenderSCLInfo,
        explorerRenderSNAInfo,
        explorerRenderSZXInfo,
        explorerRenderTAPInfo,
        explorerRenderTRDInfo,
        explorerRenderTZXInfo,
        explorerRenderZ80Info,
        trdGetBasicAutostart,
        // rzxDecodeMode is owned here but changed by the panel's dropdown handler
        getRzxDecodeMode: () => rzxDecodeMode,
        setRzxDecodeMode: (v) => { rzxDecodeMode = v; },
    };
}
