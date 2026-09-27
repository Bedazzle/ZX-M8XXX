// explorer-editors.js — the Explorer's per-format disk/tape editors: TZX, TR-DOS
// (TRD/SCL), SPECSCII banners, MGT, Microdrive, Opus, Didaktik, +3 DSK and ZIP.
// Split out of ui/explorer.js.
//
// These live inside the Explorer's closure conceptually: `ctx` carries the shared
// panel state and helpers. explorerParsed/explorerData/explorerFileType/
// explorerZipFiles are *assigned* here as well as read, so those ctx entries are
// get/set pairs and `ctx.explorerParsed = x` writes through to the Explorer.

import { hex8, hex16, escapeHtml, downloadFile } from '../core/utils.js';
// A start address follows the switch. A BASIC file's LINE is not an address --
// it is a line number, decimal in every base -- so it keeps parseInt(.., 10).
import { fmtAddr, fmtAddrPair, parseAddr } from '../core/addr-format.js';
import { TRDLoader, SCLLoader, MGTLoader, MDRLoader, OPDLoader, DidaktikLoader } from '../core/loaders.js';
import { parseSpecscii, renderGrid, encodeBannerEntries, decodeBannerNames,
         bannerNamesToSpecscii, isBannerName, lastContentRow, BANNER_MAX_ROWS } from '../core/specscii.js';
import { shapeBasicEntry, isMonoloader, splitMonoloader, setTrdBasicAutostart } from './disk-file-copy.js';

export function initExplorerEditors(ctx) {

    // ========== TZX Editor Functions ==========

    function editorNewTzx(panel) {
        panel.blocks = [];
        panel.parsedFile = { type: 'tzx', blocks: panel.blocks, nonStandardBlocks: [], size: 0, version: '1.20' };
        panel.fileType = 'tzx';
        panel.rawData = new Uint8Array(0);
        panel.fileName = 'new.tzx';
        panel.selection.clear();
        panel.expandedBlock = -1;
        panel.diskFiles = [];
        panel.diskLabel = '        ';
        panel.pendingFileData = null;
        ctx.updatePanelHeader(panel);
        ctx.editorRenderBlockList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function editorImportTzxData(panel, tzxData) {
        const typeNames = ['Program', 'Number array', 'Character array', 'Bytes'];
        if (tzxData.length < 10) return;
        // Validate TZX header: "ZXTape!" + 0x1A
        const sig = String.fromCharCode(...tzxData.slice(0, 7));
        if (sig !== 'ZXTape!' || tzxData[7] !== 0x1A) return;
        const verMajor = tzxData[8];
        const verMinor = tzxData[9];
        if (panel.parsedFile) panel.parsedFile.version = `${verMajor}.${String(verMinor).padStart(2, '0')}`;

        let offset = 10;
        let blockIndex = 0;
        while (offset < tzxData.length) {
            const id = tzxData[offset];
            offset++;

            if (id === 0x10) {
                // Standard speed data block
                if (offset + 4 > tzxData.length) break;
                const pause = tzxData[offset] | (tzxData[offset + 1] << 8);
                const dataLen = tzxData[offset + 2] | (tzxData[offset + 3] << 8);
                offset += 4;
                if (offset + dataLen > tzxData.length) break;
                const blockData = new Uint8Array(tzxData.slice(offset, offset + dataLen));
                offset += dataLen;

                const flag = blockData[0];
                let blockInfo = { offset: -1, length: dataLen, flag: flag, data: blockData, tzxPause: pause };

                if (flag === 0 && dataLen === 19) {
                    const type = blockData[1];
                    const name = String.fromCharCode(...blockData.slice(2, 12)).trim();
                    const dLen = blockData[12] | (blockData[13] << 8);
                    const p1 = blockData[14] | (blockData[15] << 8);
                    const p2 = blockData[16] | (blockData[17] << 8);
                    blockInfo.blockType = 'header';
                    blockInfo.headerType = type;
                    blockInfo.typeName = typeNames[type] || 'Unknown';
                    blockInfo.name = name;
                    blockInfo.dataLength = dLen;
                    blockInfo.param1 = p1;
                    blockInfo.param2 = p2;
                    if (type === 0) { blockInfo.autostart = p1 < 32768 ? p1 : null; blockInfo.varsOffset = p2; }
                    else if (type === 3) { blockInfo.startAddress = p1; }
                } else {
                    blockInfo.blockType = 'data';
                }

                blockInfo._tzxOriginalIndex = blockIndex;
                panel.blocks.push(blockInfo);
            } else if (id === 0x11) {
                // Turbo speed data block. If its pulse timings are standard ROM speed
                // AND the payload is a ROM-format header/data block, treat it as a
                // first-class standard block (selectable, editable, and copyable to
                // other media) while remembering tzxId + timing params so it is
                // re-saved losslessly as $11. Genuine turbo blocks (custom timing) or
                // non-ROM payloads stay opaque/non-standard.
                if (offset + 0x12 > tzxData.length) { offset = tzxData.length; blockIndex++; continue; }
                const blockStart = offset - 1; // includes ID byte
                const params = new Uint8Array(tzxData.slice(offset, offset + 18));
                const dataLen = params[15] | (params[16] << 8) | (params[17] << 16);
                const blockEnd = Math.min(offset + 18 + dataLen, tzxData.length);
                const innerData = new Uint8Array(tzxData.slice(offset + 18, blockEnd));
                offset = blockEnd;
                const pilot = params[0] | (params[1] << 8), sync1 = params[2] | (params[3] << 8),
                      sync2 = params[4] | (params[5] << 8), zero = params[6] | (params[7] << 8),
                      one = params[8] | (params[9] << 8);
                const standardTiming = (pilot === 2168 && sync1 === 667 && sync2 === 735 && zero === 855 && one === 1710);
                const flag = innerData[0];
                const romFormat = (flag === 0x00 && dataLen === 19) || flag === 0xFF;
                if (standardTiming && romFormat) {
                    const pause = params[13] | (params[14] << 8);
                    let blockInfo = { offset: -1, length: dataLen, flag: flag, data: innerData, tzxPause: pause, tzxId: 0x11, tzxTurboParams: params };
                    if (flag === 0 && dataLen === 19) {
                        const type = innerData[1];
                        const name = String.fromCharCode(...innerData.slice(2, 12)).trim();
                        const dLen = innerData[12] | (innerData[13] << 8);
                        const p1 = innerData[14] | (innerData[15] << 8);
                        const p2 = innerData[16] | (innerData[17] << 8);
                        blockInfo.blockType = 'header';
                        blockInfo.headerType = type;
                        blockInfo.typeName = typeNames[type] || 'Unknown';
                        blockInfo.name = name;
                        blockInfo.dataLength = dLen;
                        blockInfo.param1 = p1;
                        blockInfo.param2 = p2;
                        if (type === 0) { blockInfo.autostart = p1 < 32768 ? p1 : null; blockInfo.varsOffset = p2; }
                        else if (type === 3) { blockInfo.startAddress = p1; }
                    } else {
                        blockInfo.blockType = 'data';
                    }
                    blockInfo._tzxOriginalIndex = blockIndex;
                    panel.blocks.push(blockInfo);
                } else {
                    const rawBytes = new Uint8Array(tzxData.slice(blockStart + 1, blockEnd));
                    panel.blocks.push({
                        blockType: 'nonstandard', tzxId: 0x11,
                        typeName: ctx.TZX_BLOCK_NAMES[0x11] || 'Turbo Speed Data',
                        rawBytes: rawBytes, dataLength: rawBytes.length, _tzxOriginalIndex: blockIndex
                    });
                }
            } else {
                // Non-standard block — read its full extent, store opaquely
                const blockStart = offset - 1; // includes ID byte
                let blockEnd = offset;

                switch (id) {
                    case 0x11: // Turbo speed data (handled above; kept for safety)
                        if (offset + 0x12 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 0x12 + (tzxData[offset + 0x0F] | (tzxData[offset + 0x10] << 8) | (tzxData[offset + 0x11] << 16));
                        break;
                    case 0x12: // Pure tone
                        blockEnd = offset + 4;
                        break;
                    case 0x13: // Pulse sequence
                        if (offset >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 1 + tzxData[offset] * 2;
                        break;
                    case 0x14: // Pure data
                        if (offset + 0x0A > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 0x0A + (tzxData[offset + 0x07] | (tzxData[offset + 0x08] << 8) | (tzxData[offset + 0x09] << 16));
                        break;
                    case 0x15: // Direct recording
                        if (offset + 8 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 8 + (tzxData[offset + 0x05] | (tzxData[offset + 0x06] << 8) | (tzxData[offset + 0x07] << 16));
                        break;
                    case 0x18: // CSW recording
                    case 0x19: // Generalized data
                        if (offset + 4 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 4 + (tzxData[offset] | (tzxData[offset + 1] << 8) | (tzxData[offset + 2] << 16) | (tzxData[offset + 3] << 24));
                        break;
                    case 0x20: // Pause
                        blockEnd = offset + 2;
                        break;
                    case 0x21: // Group start
                        if (offset >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 1 + tzxData[offset];
                        break;
                    case 0x22: // Group end
                        blockEnd = offset;
                        break;
                    case 0x23: // Jump
                        blockEnd = offset + 2;
                        break;
                    case 0x24: // Loop start
                        blockEnd = offset + 2;
                        break;
                    case 0x25: // Loop end
                        blockEnd = offset;
                        break;
                    case 0x26: // Call sequence
                        if (offset + 2 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 2 + (tzxData[offset] | (tzxData[offset + 1] << 8)) * 2;
                        break;
                    case 0x27: // Return
                        blockEnd = offset;
                        break;
                    case 0x28: // Select
                        if (offset + 2 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 2 + (tzxData[offset] | (tzxData[offset + 1] << 8));
                        break;
                    case 0x2A: // Stop if 48K
                        blockEnd = offset + 4;
                        break;
                    case 0x2B: // Signal level
                        blockEnd = offset + 5;
                        break;
                    case 0x30: // Text description
                        if (offset >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 1 + tzxData[offset];
                        break;
                    case 0x31: // Message
                        if (offset + 1 >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 2 + tzxData[offset + 1];
                        break;
                    case 0x32: // Archive info
                        if (offset + 2 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 2 + (tzxData[offset] | (tzxData[offset + 1] << 8));
                        break;
                    case 0x33: // Hardware type
                        if (offset >= tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 1 + tzxData[offset] * 3;
                        break;
                    case 0x35: // Custom info
                        if (offset + 0x14 > tzxData.length) { offset = tzxData.length; break; }
                        blockEnd = offset + 0x14 + (tzxData[offset + 0x10] | (tzxData[offset + 0x11] << 8) | (tzxData[offset + 0x12] << 16) | (tzxData[offset + 0x13] << 24));
                        break;
                    case 0x5A: // Glue
                        blockEnd = offset + 9;
                        break;
                    default:
                        // Unknown block — try reading 4-byte length at current offset
                        if (offset + 4 <= tzxData.length) {
                            blockEnd = offset + 4 + (tzxData[offset] | (tzxData[offset + 1] << 8) | (tzxData[offset + 2] << 16) | (tzxData[offset + 3] << 24));
                        } else {
                            blockEnd = tzxData.length;
                        }
                        break;
                }

                if (blockEnd > tzxData.length) blockEnd = tzxData.length;
                const rawBytes = new Uint8Array(tzxData.slice(blockStart + 1, blockEnd)); // without ID byte
                const typeName = ctx.TZX_BLOCK_NAMES[id] || `Unknown ($${hex8(id)})`;

                panel.blocks.push({
                    blockType: 'nonstandard',
                    tzxId: id,
                    typeName: typeName,
                    rawBytes: rawBytes,
                    dataLength: rawBytes.length,
                    _tzxOriginalIndex: blockIndex
                });

                offset = blockEnd;
            }
            blockIndex++;
        }
        panel.selection.clear();
        panel.expandedBlock = -1;
    }

    function editorBuildTzx(panel) {
        // TZX header: "ZXTape!" + 0x1A + version 1.20
        const header = new Uint8Array([0x5A, 0x58, 0x54, 0x61, 0x70, 0x65, 0x21, 0x1A, 0x01, 0x14]);

        // Calculate total size
        let totalSize = header.length;
        for (const block of panel.blocks) {
            if (block.deleted) continue; // flush soft-deleted blocks on save
            if (block.blockType === 'nonstandard') {
                totalSize += 1 + block.rawBytes.length; // ID byte + raw data
            } else if (block.tzxId === 0x11) {
                // Standard-timed $11 kept as $11: ID + 18 param bytes + data
                totalSize += 1 + 18 + block.data.length;
            } else {
                // ID 0x10: 1 (ID) + 2 (pause) + 2 (len) + data.length
                totalSize += 1 + 2 + 2 + block.data.length;
            }
        }

        const tzx = new Uint8Array(totalSize);
        tzx.set(header, 0);
        let offset = header.length;

        for (let i = 0; i < panel.blocks.length; i++) {
            const block = panel.blocks[i];
            if (block.deleted) continue; // flush soft-deleted blocks on save
            if (block.blockType === 'nonstandard') {
                tzx[offset] = block.tzxId;
                offset++;
                tzx.set(block.rawBytes, offset);
                offset += block.rawBytes.length;
            } else if (block.tzxId === 0x11 && block.tzxTurboParams) {
                // Standard-timed $11 kept as $11: re-emit timing params (first 15 bytes:
                // pilot/sync/zero/one/pilotCount/usedBits/pause), then the 3-byte data
                // length (updated to the current data), then the data.
                tzx[offset] = 0x11;
                offset++;
                tzx.set(block.tzxTurboParams.slice(0, 15), offset);
                offset += 15;
                const len = block.data.length;
                tzx[offset] = len & 0xFF;
                tzx[offset + 1] = (len >> 8) & 0xFF;
                tzx[offset + 2] = (len >> 16) & 0xFF;
                offset += 3;
                tzx.set(block.data, offset);
                offset += block.data.length;
            } else {
                // Standard speed data block (ID 0x10)
                tzx[offset] = 0x10;
                offset++;
                // Pause: use stored value, or default 1000ms (0 for last standard block)
                let pause = block.tzxPause !== undefined ? block.tzxPause : 1000;
                // Find if this is the last standard block
                let isLastStandard = true;
                for (let j = i + 1; j < panel.blocks.length; j++) {
                    if (panel.blocks[j].deleted) continue;
                    if (panel.blocks[j].blockType !== 'nonstandard') { isLastStandard = false; break; }
                }
                if (isLastStandard && block.tzxPause === undefined) pause = 0;
                tzx[offset] = pause & 0xFF;
                tzx[offset + 1] = (pause >> 8) & 0xFF;
                offset += 2;
                tzx[offset] = block.data.length & 0xFF;
                tzx[offset + 1] = (block.data.length >> 8) & 0xFF;
                offset += 2;
                tzx.set(block.data, offset);
                offset += block.data.length;
            }
        }

        return tzx;
    }

    function editorSaveTzx(panel) {
        if (!panel.blocks.length) return;
        const tzx = editorBuildTzx(panel);
        const baseName = (panel.fileName || 'output').replace(/\.tzx$/i, '');
        downloadFile(baseName + '.tzx', tzx);
    }

    // Build an 18-byte $11 turbo parameter header from pulse settings + data length.
    function editorBuildTurboParams(p, dataLen) {
        const a = new Uint8Array(18);
        const w = (off, v) => { a[off] = v & 0xFF; a[off + 1] = (v >> 8) & 0xFF; };
        w(0, p.pilot); w(2, p.sync1); w(4, p.sync2); w(6, p.zero); w(8, p.one);
        w(10, p.pilotLen); a[12] = p.usedBits & 0xFF; w(13, p.pause);
        a[15] = dataLen & 0xFF; a[16] = (dataLen >> 8) & 0xFF; a[17] = (dataLen >> 16) & 0xFF;
        return a;
    }

    // Read the current turbo pulse parameters from a block's $11 timing header,
    // wherever it lives: tzxTurboParams (header/data blocks) or the first 18 bytes of
    // rawBytes (raw non-standard $11). Returns null for blocks with no $11 timing.
    function editorReadTurboParams(b) {
        let p = null;
        if (b && b.tzxTurboParams && b.tzxTurboParams.length >= 15) p = b.tzxTurboParams;
        else if (b && b.blockType === 'nonstandard' && b.tzxId === 0x11 && b.rawBytes && b.rawBytes.length >= 18) p = b.rawBytes;
        if (!p) return null;
        const rd = (o) => p[o] | (p[o + 1] << 8);
        return { pilot: rd(0), sync1: rd(2), sync2: rd(4), zero: rd(6), one: rd(8), pilotLen: rd(10), usedBits: p[12], pause: rd(13) };
    }

    // True if a block can be (re)timed via the Turbo dialog: a standard/turbo
    // header/data block, or a raw non-standard $11 block.
    function editorBlockTurboable(b) {
        if (!b) return false;
        if ((b.blockType === 'header' || b.blockType === 'data') && b.data) return true;
        return b.blockType === 'nonstandard' && b.tzxId === 0x11 && !!b.rawBytes && b.rawBytes.length >= 18;
    }

    // Is this editor block a Turbo ($11) block with non-standard (faster) timing?
    function editorBlockIsTurbo(b) {
        if (!b || b.tzxId !== 0x11 || !b.tzxTurboParams) return false;
        const t = b.tzxTurboParams;
        const std = (t[0] | (t[1] << 8)) === 2168 && (t[2] | (t[3] << 8)) === 667 &&
                    (t[4] | (t[5] << 8)) === 735 && (t[6] | (t[7] << 8)) === 855 &&
                    (t[8] | (t[9] << 8)) === 1710;
        return !std;
    }

    // Convert selected standard (header/data) blocks to Turbo ($11) with the given
    // pulse params. The blocks keep their header/data structure (still editable and
    // copyable); only the on-tape encoding changes. editorBuildTzx emits them as $11.
    function editorConvertSelectionToTurbo(panel, p) {
        let count = 0;
        for (const idx of ctx.editorSelectedSorted(panel)) {
            const b = panel.blocks[idx];
            if (!editorBlockTurboable(b)) continue;
            if ((b.blockType === 'header' || b.blockType === 'data') && b.data) {
                // Standard or $11 header/data block → (re)set its turbo timing.
                b.tzxId = 0x11;
                b.tzxTurboParams = editorBuildTurboParams(p, b.data.length);
                b.tzxPause = p.pause;
            } else {
                // Raw non-standard $11 block → re-time in place: rewrite the 15-byte
                // timing header (pilot…pause), keep the data-length field + data.
                b.rawBytes.set(editorBuildTurboParams(p, 0).slice(0, 15), 0);
            }
            count++;
        }
        return count;
    }

    // ========== Disk Editor Functions (parameterized) ==========

    function diskEditorExtractFiles(panel) {
        if (panel.diskFiles.length > 0) return;
        if (panel.parsedFile && panel.parsedFile.type === 'mgt') {
            diskEditorExtractMgtFiles(panel);
            return;
        }
        if (panel.parsedFile && panel.parsedFile.type === 'mdr') {
            diskEditorExtractMdrFiles(panel);
            return;
        }
        if (!panel.parsedFile || (panel.parsedFile.type !== 'trd' && panel.parsedFile.type !== 'scl')) return;
        if (!panel.rawData || panel.rawData.length === 0) return;
        panel.bannerEntries = [];

        if (panel.parsedFile.type === 'trd') {
            for (let i = 0; i < 128; i++) {
                const entryOffset = i * 16;
                if (panel.rawData[entryOffset] === 0) break;
                const deleted = panel.rawData[entryOffset] === 1;
                const nameBytes = panel.rawData.slice(entryOffset, entryOffset + 8);
                if (!deleted && isBannerName(nameBytes)) {
                    // SPECSCII banner slice, not a real file (see core/specscii.js)
                    panel.bannerEntries.push(Uint8Array.from(nameBytes));
                    continue;
                }
                const name = String.fromCharCode(...nameBytes);
                const ext = String.fromCharCode(panel.rawData[entryOffset + 8]);
                const w9 = panel.rawData[entryOffset + 9] | (panel.rawData[entryOffset + 10] << 8);
                const w11 = panel.rawData[entryOffset + 11] | (panel.rawData[entryOffset + 12] << 8);
                const { startAddress: startAddr, length, programLength } = ctx.trdEntryFields(panel.rawData[entryOffset + 8], w9, w11);
                const sectors = panel.rawData[entryOffset + 13];
                const startSector = panel.rawData[entryOffset + 14];
                const startTrack = panel.rawData[entryOffset + 15];
                const fileOffset = (startTrack * 16 + startSector) * 256;
                const dataSize = sectors * 256;
                const data = new Uint8Array(dataSize);
                data.set(panel.rawData.slice(fileOffset, fileOffset + dataSize));
                panel.diskFiles.push({
                    name: (name + '        ').substring(0, 8),
                    ext: ext,
                    startAddress: startAddr,
                    length: length,
                    programLength: programLength,
                    sectors: sectors,
                    data: data,
                    deleted: deleted
                });
            }
        } else {
            const files = panel.parsedFile.files;
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const nameBytes = Uint8Array.from((f.name + '        ').substring(0, 8), ch => ch.charCodeAt(0) & 0xFF);
                if (isBannerName(nameBytes)) {
                    panel.bannerEntries.push(nameBytes);
                    continue;
                }
                const sectors = f.sectors;
                const dataSize = sectors * 256;
                const data = new Uint8Array(dataSize);
                const src = panel.rawData.slice(f.offset, f.offset + dataSize);
                data.set(src);
                panel.diskFiles.push({
                    name: (f.name + '        ').substring(0, 8),
                    ext: f.ext,
                    startAddress: f.startAddress,
                    length: f.length,
                    programLength: f.programLength,
                    sectors: sectors,
                    data: data,
                    deleted: false
                });
            }
        }

        if (panel.parsedFile.type === 'trd' && panel.rawData.length >= 0x800 + 0xFD) {
            const infoOffset = 8 * 256;
            panel.diskLabel = String.fromCharCode(
                ...panel.rawData.slice(infoOffset + 0xF5, infoOffset + 0xFD)
            );
        } else {
            panel.diskLabel = '        ';
        }
    }

    function diskEditorTotalSectors(panel) {
        let total = 0;
        for (const f of panel.diskFiles) total += f.sectors;
        return total;
    }

    function diskEditorRenderFileList(panel) {
        if (panel.fileType === 'mgt') {
            mgtEditorRenderFileList(panel);
            return;
        }
        if (panel.fileType === 'mdr') {
            mdrEditorRenderFileList(panel);
            return;
        }
        diskEditorExtractFiles(panel);

        if (panel.diskFiles.length === 0) {
            ctx.editorRenderLabelBar(panel);
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty disk. Use "Add File" to add files.</span>';
            panel.dom.statusSpan.textContent = '0 files';
            ctx.editorUpdateToolbar();
            return;
        }

        const totalSectors = diskEditorTotalSectors(panel);
        const freeSectors = ctx.TRD_TOTAL_SECTORS - totalSectors;
        const activeFiles = panel.diskFiles.filter(f => !f.deleted).length;
        const deletedFiles = panel.diskFiles.length - activeFiles;

        let html = '';
        ctx.editorRenderLabelBar(panel);
        html += ctx.editorColHeaderHtml('Sectors');

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const file = panel.diskFiles[i];
            const isSel = panel.selection.has(i);
            const isExpanded = panel.expandedBlock === i;

            let rowClasses = 'editor-block-row disk-row';
            if (file.deleted) rowClasses += ' disk-deleted';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            const trdTypeNames = ctx.TRD_TYPE_NAMES;
            const typeName = trdTypeNames[file.ext] || file.ext;
            let addrText = '';
            if (file.ext === 'C') {
                addrText = fmtAddrPair(file.startAddress);
            } else if (file.ext === 'B') {
                const autostart = ctx.trdGetBasicAutostart(file);
                if (autostart >= 0) addrText = `LINE ${autostart}`;
            }
            html += `<span class="dim">${i + 1}:</span>`;
            html += `<span class="file-name">${file.name.replace(/\s+$/, '')}</span>`;
            html += `<span class="file-flag"></span>`;
            html += `<span class="file-ext">${typeName}</span>`;
            html += `<span class="file-addr">${addrText}</span>`;
            html += `<span class="file-size"${ctx.explorerFileSizeAttr(file)}>${ctx.explorerFileSizeText(file)}</span>`;
            html += `<span class="file-sectors">${file.sectors}</span>`;
            if (file.deleted) html += ' <span class="bad">[DEL]</span>';
            html += '</span></div>';

            if (isExpanded) {
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<input type="text" maxlength="8" value="${file.name.replace(/\s+$/, '')}" data-field="name" placeholder="Name" class="editor-input">`;
                html += `<select data-field="ext" class="editor-input">`;
                for (const e of ['C', 'B', 'D', '#']) {
                    html += `<option value="${e}"${file.ext === e ? ' selected' : ''}>${e}</option>`;
                }
                html += '</select>';
                if (file.ext === 'B') {
                    // A BASIC file has no start address; the box is its autostart LINE
                    // (decimal in every base, empty = none).
                    const line = ctx.trdGetBasicAutostart(file);
                    html += `<input type="text" value="${line >= 0 ? line : ''}" data-field="line" maxlength="4" placeholder="LINE" title="Autostart line (empty = none)" class="editor-input editor-input-short">`;
                } else {
                    html += `<input type="text" value="${fmtAddr(file.startAddress)}" data-field="addr" maxlength="5" placeholder="Addr" class="editor-input editor-input-short">`;
                }
                html += `<button class="editor-apply-btn" data-action="disk-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${activeFiles} files, ${selCount} sel \u2014 ${freeSectors} free`;
        } else {
            panel.dom.statusSpan.textContent = `${activeFiles} files \u2014 ${freeSectors} free`;
        }
        ctx.editorUpdateToolbar();
    }

    function diskEditorMoveSelection(panel, dir) {
        const sorted = ctx.editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        if (dir === -1 && sorted[0] === 0) return;
        if (dir === 1 && sorted[sorted.length - 1] === panel.diskFiles.length - 1) return;

        const order = dir === -1 ? sorted : sorted.slice().reverse();
        const newSel = new Set();
        for (const idx of order) {
            const newIdx = idx + dir;
            const temp = panel.diskFiles[idx];
            panel.diskFiles[idx] = panel.diskFiles[newIdx];
            panel.diskFiles[newIdx] = temp;
            newSel.add(newIdx);
        }
        panel.selection = newSel;
        panel.expandedBlock = -1;
        ctx.editorRenderBlockList(panel);
    }

    function diskEditorDeleteSelection(panel) {
        if (panel.selection.size === 0) return;
        const sorted = ctx.editorSelectedSorted(panel).reverse();
        for (const idx of sorted) {
            panel.diskFiles.splice(idx, 1);
        }
        panel.selection.clear();
        panel.expandedBlock = -1;
        ctx.editorRenderBlockList(panel);
        if (panel.fileType === 'mgt') mgtEditorRefreshExplorer(panel);
        else if (panel.fileType === 'mdr') mdrEditorRefreshExplorer(panel);
        else if (panel.fileType === 'opd') opdEditorRefreshExplorer(panel);
        else diskEditorRefreshExplorer(panel);
    }

    // Split a monoloader (the single selected TR-DOS/SCL file) in place: replace
    // it with the loader (trimmed to its declared length) + the appended CODE as a
    // new 'C' entry, then select the CODE for immediate RE. Opt-in, non-lossy.
    function editorSplitMonoloader(panel) {
        if (panel.fileType !== 'trd' && panel.fileType !== 'scl') return;
        const sel = [...panel.selection];
        if (sel.length !== 1) return;
        const idx = sel[0];
        const f = panel.diskFiles[idx];
        if (!f || !isMonoloader(f.length, f.sectors)) return;

        const { loader, payload } = splitMonoloader(f);
        const newTotal = diskEditorTotalSectors(panel) - f.sectors + loader.sectors + payload.sectors;
        if (newTotal > ctx.TRD_TOTAL_SECTORS) { panel.dom.statusSpan.textContent = 'Split: not enough free sectors'; return; }
        if (diskEditorBannerCount(panel) + panel.diskFiles.length + 1 > 128) { panel.dom.statusSpan.textContent = 'Split: directory full (max 128)'; return; }

        panel.diskFiles.splice(idx, 1, loader, payload);
        panel.selection.clear();
        panel.selection.add(idx + 1);   // the new CODE payload — ready to disasm
        panel.expandedBlock = -1;
        ctx.editorRenderBlockList(panel);
        diskEditorRefreshExplorer(panel);
        panel.dom.statusSpan.textContent = `Split: loader ${loader.length} B + CODE ${payload.length} B (start addr unknown)`;
    }

    // ========== SPECSCII Catalogue Banner Dialog ==========
    // View a disk's existing banner or attach a new one from a .specscii file
    // (SpectraLab / zxart.ee). See core/specscii.js for the encoding model.

    const bannerDialog = document.getElementById('bannerDialog');
    const bannerCanvas = document.getElementById('bannerCanvas');
    const bannerRowsInput = document.getElementById('bannerRows');
    const bannerInfo = document.getElementById('bannerInfo');
    const btnBannerLoad = document.getElementById('btnBannerLoad');
    const btnBannerApply = document.getElementById('btnBannerApply');
    const btnBannerRemove = document.getElementById('btnBannerRemove');
    const btnBannerSave = document.getElementById('btnBannerSave');
    const btnBannerClose = document.getElementById('btnBannerClose');
    const bannerFileInput = document.getElementById('bannerFileInput');

    // Dialog state: the panel it operates on, the loaded picture and the
    // entries computed for the current row selection.
    const bannerDlg = { panel: null, grid: null, names: null };

    function bannerRenderPreview(grid, shadeFromRow) {
        const ctx = bannerCanvas.getContext('2d');
        // Font comes from the always-loaded 48.rom (via romData), NOT the current
        // machine's paged memory — so the Explorer edits any disk on any machine.
        renderGrid(grid, ctx, ctx.getZxCharset ? ctx.getZxCharset() : null);
        if (shadeFromRow != null && shadeFromRow < 24) {
            ctx.fillStyle = 'rgba(0,0,0,0.65)';
            ctx.fillRect(0, shadeFromRow * 8, 256, 192 - shadeFromRow * 8);
        }
    }

    // Recompute entries + capacity for the loaded picture and rows choice
    function bannerUpdateFromGrid() {
        const panel = bannerDlg.panel;
        const rows = Math.max(1, Math.min(BANNER_MAX_ROWS, parseInt(bannerRowsInput.value, 10) || 1));
        bannerRowsInput.value = rows;
        bannerRenderPreview(bannerDlg.grid, rows);
        let names = null, err = null;
        try {
            names = encodeBannerEntries(bannerDlg.grid, rows).names;
        } catch (e) { err = e.message; }
        bannerDlg.names = names;
        const freeEntries = 128 - panel.diskFiles.length;
        if (err) {
            bannerInfo.textContent = err;
            btnBannerApply.disabled = true;
        } else {
            const fits = names.length <= freeEntries;
            bannerInfo.textContent = `${names.length} catalogue entries (${freeEntries} free)` + (fits ? '' : ' — does not fit');
            btnBannerApply.disabled = !fits;
        }
    }

    function editorOpenBannerDialog(panel) {
        if (panel.fileType !== 'trd' && panel.fileType !== 'scl') return;
        diskEditorExtractFiles(panel);
        bannerDlg.panel = panel;
        bannerDlg.grid = null;
        bannerDlg.names = null;
        btnBannerApply.disabled = true;
        const existing = diskEditorBannerCount(panel);
        btnBannerRemove.style.display = existing ? '' : 'none';
        if (btnBannerSave) btnBannerSave.style.display = existing ? '' : 'none';
        if (existing) {
            const { grid } = decodeBannerNames(panel.bannerEntries);
            bannerRenderPreview(grid, null);
            bannerInfo.textContent = `Current banner: ${existing} entries — load a .specscii to replace it`;
        } else {
            const ctx = bannerCanvas.getContext('2d');
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, 256, 192);
            bannerInfo.textContent = 'No banner on this disk — load a .specscii file';
        }
        bannerDialog.classList.remove('hidden');
    }

    function bannerCloseDialog() {
        bannerDialog.classList.add('hidden');
        bannerDlg.panel = null;
        bannerDlg.grid = null;
        bannerDlg.names = null;
    }

    if (btnBannerLoad) {
        btnBannerLoad.addEventListener('click', () => bannerFileInput.click());
        bannerFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file || !bannerDlg.panel) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const bytes = new Uint8Array(ev.target.result);
                const { grid, cellCount, warnings } = parseSpecscii(bytes);
                if (!cellCount) { bannerInfo.textContent = 'Not a SPECSCII stream (no printable cells)'; return; }
                bannerDlg.grid = grid;
                const auto = Math.max(1, Math.min(BANNER_MAX_ROWS, lastContentRow(grid) + 1));
                bannerRowsInput.value = auto;
                bannerUpdateFromGrid();
                if (warnings.length) bannerInfo.textContent += ` — ${warnings.length} warning(s), see console`;
                if (warnings.length) console.warn('[specscii]', warnings);
            };
            reader.readAsArrayBuffer(file);
        });
        bannerRowsInput.addEventListener('change', () => { if (bannerDlg.grid) bannerUpdateFromGrid(); });
        btnBannerApply.addEventListener('click', () => {
            const panel = bannerDlg.panel;
            if (!panel || !bannerDlg.names) return;
            panel.bannerEntries = bannerDlg.names;
            ctx.editorRenderBlockList(panel);
            diskEditorRefreshExplorer(panel);
            ctx.editorUpdateToolbar();
            panel.dom.statusSpan.textContent = `Banner attached: ${bannerDlg.names.length} catalogue entries — save the disk to keep it`;
            bannerCloseDialog();
        });
        btnBannerRemove.addEventListener('click', () => {
            const panel = bannerDlg.panel;
            if (!panel) return;
            panel.bannerEntries = [];
            ctx.editorRenderBlockList(panel);
            diskEditorRefreshExplorer(panel);
            ctx.editorUpdateToolbar();
            panel.dom.statusSpan.textContent = 'Banner removed';
            bannerCloseDialog();
        });
        if (btnBannerSave) btnBannerSave.addEventListener('click', () => {
            const panel = bannerDlg.panel;
            if (!panel || !diskEditorBannerCount(panel)) return;
            const bytes = bannerNamesToSpecscii(panel.bannerEntries);
            const base = (panel.fileName || 'banner').replace(/\.(trd|scl)$/i, '');
            downloadFile(base + '.specscii', bytes);
            panel.dom.statusSpan.textContent = `Banner extracted → ${base}.specscii (${bytes.length} B)`;
        });
        btnBannerClose.addEventListener('click', bannerCloseDialog);
        bannerDialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') bannerCloseDialog(); });
    }

    function diskEditorMarkDeletedSelection(panel) {
        if (panel.selection.size === 0) return;
        const sorted = ctx.editorSelectedSorted(panel);
        const allDeleted = sorted.every(idx => panel.diskFiles[idx].deleted);
        for (const idx of sorted) {
            panel.diskFiles[idx].deleted = !allDeleted;
        }
        panel.expandedBlock = -1;
        ctx.editorRenderBlockList(panel);
    }

    // Extract clean file data from MGT editor raw sectors.
    // Raw data has 512-byte sectors: 510 bytes data + 2 bytes chain pointer.
    // G+DOS files have a 9-byte header (type+len+params); auto-detected and stripped if present.
    function mgtExtractCleanData(file) {
        // panel.diskFiles[].data holds clean file bytes (no chain pointers, no +D
        // header — stripped on import, never added on build), so return it directly.
        return file.data.slice(0, file.length);
    }

    // MDR non-print files store a 9-byte Spectrum header inside the data; Hobeta needs
    // the payload only, with the real length/type/address taken from that header
    // (already parsed into dataLength/ext/startAddress by mdrEditorParseHeader).
    function hobetaSourceFile(file) {
        if (file.mdrFile && !file.isPrint && file.data && file.data.length > 9) {
            return {
                name: file.name,
                ext: file.ext,
                startAddress: file.startAddress || 0,
                length: file.dataLength,
                data: file.data.slice(9)
            };
        }
        return file;
    }

    function diskEditorExtractSelection(panel, format) {
        const sorted = ctx.editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        const baseName = (panel.fileName || 'extract').replace(/\.(trd|scl|mgt|mdr|img)$/i, '');
        const asHobeta = format === 'hobeta';

        const isMgt = panel.fileType === 'mgt';
        // "Extract bin (full sectors)": dump the file's whole last-sector allocation
        // incl. unused slack (no header strip). Only TR-DOS/SCL keep full sectors in
        // the editor model; MGT (chain-stripped) has no slack to give, so it falls
        // back to its clean payload.
        const fullSectors = format === 'binfull';
        const diskFileExportData = (file) => {
            if (isMgt) return mgtExtractCleanData(file);
            if (fullSectors) {
                const secs = file.sectors || Math.ceil((file.length || 0) / 256);
                return file.data.slice(0, secs * 256);
            }
            let d = file.data.slice(0, file.length);
            if (file.mdrFile && !file.isPrint && d.length > 9) d = d.slice(9);
            return d;
        };

        if (sorted.length === 1) {
            const file = panel.diskFiles[sorted[0]];
            const trimName = file.name.replace(/\s+$/, '');
            let name, data;
            if (asHobeta) {
                name = trimName + '.' + ctx.trdExtToHobetaExt(file.ext);
                data = ctx.buildHobeta(hobetaSourceFile(file));
            } else {
                name = trimName + '.' + file.ext;
                data = diskFileExportData(file);
            }
            downloadFile(name, data);
            return;
        }

        const files = sorted.map(idx => {
            const file = panel.diskFiles[idx];
            const trimName = file.name.replace(/\s+$/, '');
            if (asHobeta) {
                return {
                    name: trimName + '.' + ctx.trdExtToHobetaExt(file.ext),
                    data: ctx.buildHobeta(hobetaSourceFile(file))
                };
            }
            const data = diskFileExportData(file);
            return {
                name: trimName + '.' + file.ext,
                data
            };
        });
        const zipData = ctx.editorCreateZip(files);
        downloadFile(baseName + '_extract.zip', zipData);
    }

    function diskEditorNewTrd(panel) {
        panel.diskFiles = [];
        panel.bannerEntries = [];
        panel.diskLabel = '        ';
        panel.blocks = [];
        panel.parsedFile = { type: 'trd', files: [], diskTitle: '', freeSectors: ctx.TRD_TOTAL_SECTORS, size: 0 };
        panel.fileType = 'trd';
        panel.rawData = new Uint8Array(0);
        panel.fileName = 'new.trd';
        panel.selection.clear();
        panel.expandedBlock = -1;
        ctx.updatePanelHeader(panel);
        diskEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    // basicInfo (optional, BASIC 'B' files): { autostart, varsOffset } from the source format
    function diskEditorAddFile(panel, data, name, ext, addr, basicInfo = null) {
        let fileData = data;
        // Semantic diskFiles model: startAddress = load address (0 for BASIC),
        // length = total data bytes to extract, programLength = variables offset
        // (BASIC only). diskEditorBuildTrd packs these into the 9-10 / 11-12 words.
        let startField = addr;
        let lengthField = data.length;
        let progLenField = null;

        if (ext === 'B') {
            // Monoloader-aware shaping (see ui/disk-file-copy.js): verbatim copy
            // for monoloaders, else build the program+vars + autostart trailer.
            const shaped = shapeBasicEntry(data, basicInfo);
            fileData = shaped.data;
            startField = 0;
            lengthField = shaped.length;
            progLenField = shaped.programLength;
        } else if (basicInfo && basicInfo.verbatim) {
            // Monoloader of a non-BASIC type: store the data exactly and keep the
            // source catalogue length/start — the appended payload lives past the
            // declared length, so re-measuring to the full allocation would lie.
            startField = (basicInfo.startAddress != null) ? basicInfo.startAddress : addr;
            lengthField = (basicInfo.length != null) ? basicInfo.length : data.length;
        }

        const sectors = Math.ceil(fileData.length / 256);
        if (sectors > 255) return 'File too large (max 255 sectors / 65,280 bytes)';
        if (diskEditorBannerCount(panel) + panel.diskFiles.length >= 128) return 'Directory full (max 128 entries)';
        if (diskEditorTotalSectors(panel) + sectors > ctx.TRD_TOTAL_SECTORS) return 'Disk full (not enough free sectors)';

        const paddedData = new Uint8Array(sectors * 256);
        paddedData.set(fileData);
        const paddedName = (name + '        ').substring(0, 8);

        panel.diskFiles.push({
            name: paddedName,
            ext: ext,
            startAddress: startField,
            length: lengthField,
            programLength: progLenField,
            sectors: sectors,
            data: paddedData,
            deleted: false
        });
        return null;
    }

    // Build TRD/SCL via the core loaders (so create/add/delete/compaction is shared
    // with the test suite). Rebuilding from the surviving files compacts the disk.
    // A SPECSCII banner (panel.bannerEntries) goes in front of the real files.
    function diskEditorBannerCount(panel) {
        return panel.bannerEntries ? panel.bannerEntries.length : 0;
    }

    function diskEditorBuildTrd(panel) {
        return TRDLoader.buildTRD(panel.diskFiles, panel.diskLabel,
            diskEditorBannerCount(panel) ? panel.bannerEntries : null);
    }

    function diskEditorBuildScl(panel) {
        return SCLLoader.buildSCL(panel.diskFiles,
            diskEditorBannerCount(panel) ? panel.bannerEntries : null);
    }

    function diskEditorSaveDisk(panel) {
        if (panel.diskFiles.length === 0 && diskEditorBannerCount(panel) === 0) return;
        const isSCL = panel.fileType === 'scl';
        const data = isSCL ? diskEditorBuildScl(panel) : diskEditorBuildTrd(panel);
        const ext = isSCL ? '.scl' : '.trd';
        const baseName = (panel.fileName || 'output').replace(/\.(trd|scl)$/i, '');
        downloadFile(baseName + ext, data);
    }

    function diskEditorApplyInlineEdit(panel, idx) {
        if (idx === -2) {
            const editRow = panel.dom.fileList.querySelector('.editor-inline-edit[data-edit-idx="-2"]');
            if (!editRow) return;
            const labelInput = editRow.querySelector('[data-field="label"]');
            const raw = labelInput ? labelInput.value : '';
            panel.diskLabel = (raw + '        ').substring(0, 8);
            panel.expandedBlock = -1;
            diskEditorRenderFileList(panel);
            diskEditorRefreshExplorer(panel);
            return;
        }

        if (idx < 0 || idx >= panel.diskFiles.length) return;
        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const extSelect = editRow.querySelector('[data-field="ext"]');
        const addrInput = editRow.querySelector('[data-field="addr"]');
        const lineInput = editRow.querySelector('[data-field="line"]');

        const file = panel.diskFiles[idx];
        // Refuse a bad LINE before changing anything, so Apply is all or nothing.
        let line = null;
        if (lineInput && lineInput.value.trim() !== '') {
            const v = lineInput.value.trim();
            line = /^\d{1,4}$/.test(v) ? parseInt(v, 10) : NaN;
            if (isNaN(line)) {
                panel.dom.statusSpan.textContent = 'LINE must be 0-9999, or empty for none';
                return;
            }
        }
        if (lineInput && file.ext === 'B') {
            const free = ctx.TRD_TOTAL_SECTORS - diskEditorTotalSectors(panel);
            const err = setTrdBasicAutostart(file, line, free);
            if (err) { panel.dom.statusSpan.textContent = err; return; }
        }
        if (nameInput) {
            file.name = (nameInput.value + '        ').substring(0, 8);
        }
        if (extSelect) {
            file.ext = extSelect.value;
        }
        // For BASIC ('B') files bytes 9-10 hold the program+vars length,
        // not a start address — don't let the addr field clobber it
        if (addrInput && file.ext !== 'B') {
            file.startAddress = parseAddr(addrInput.value) || 0;
        }

        panel.expandedBlock = -1;
        diskEditorRenderFileList(panel);
        diskEditorRefreshExplorer(panel);
    }

    function diskEditorRefreshExplorer(panel) {
        const trd = diskEditorBuildTrd(panel);
        panel.rawData = trd;
        panel.parsedFile = ctx.explorerParseTRD(trd);
        ctx.syncPanelToExplorer(panel);
    }

    // ========== MGT Disk Editor Functions ==========

    const MGT_TYPE_NAMES = {
        0: 'Erased', 1: 'BASIC', 2: 'Num array', 3: 'Str array', 4: 'Code',
        5: '48K Snap', 7: 'SCREEN$', 9: '128K Snap', 10: 'Opentype', 11: 'Execute'
    };

    function diskEditorExtractMgtFiles(panel) {
        if (panel.diskFiles.length > 0) return;
        if (!panel.parsedFile || panel.parsedFile.type !== 'mgt') return;
        if (!panel.rawData || panel.rawData.length === 0) return;

        const files = MGTLoader.listFiles(panel.rawData);
        for (const f of files) {
            // Store clean file bytes (chain pointers + any +D header stripped) — the model
            // the editor, exporters and buildMGT all expect. A raw full-sector read would
            // leave the 2-byte per-sector chain pointers interspersed, corrupting export/save.
            const cleanData = MGTLoader.extractFile(panel.rawData, f);
            panel.diskFiles.push({
                name: (f.name + '          ').substring(0, 10),
                ext: f.typeName.substring(0, 1).toUpperCase(),
                mgtType: f.type,
                tapeType: f.tapeType,
                typeName: f.typeName,
                startAddress: f.startAddress,
                length: f.length,
                sectors: Math.max(1, Math.ceil(f.length / 510)),
                data: new Uint8Array(cleanData),
                autostart: f.autostart,
                bodyLength: f.bodyLength,
                deleted: false
            });
        }
    }

    function mgtEditorTotalSectors(panel) {
        let total = 0;
        for (const f of panel.diskFiles) total += f.sectors;
        return total;
    }

    function mgtEditorRenderFileList(panel) {
        diskEditorExtractMgtFiles(panel);

        if (panel.diskFiles.length === 0) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty MGT disk. Use "Add File" to add files.</span>';
            panel.dom.statusSpan.textContent = '0 files';
            ctx.editorUpdateToolbar();
            return;
        }

        const totalSectors = mgtEditorTotalSectors(panel);
        // MGT: 80 tracks × 2 sides × 10 sectors = 1600 total; directory uses tracks 0-1 = 40 sectors
        const freeSectors = 1560 - totalSectors;
        const activeFiles = panel.diskFiles.filter(f => !f.deleted).length;
        const deletedFiles = panel.diskFiles.length - activeFiles;

        let html = '';
        ctx.editorRenderLabelBar(panel);
        html += ctx.editorColHeaderHtml('Sectors');

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const file = panel.diskFiles[i];
            const isSel = panel.selection.has(i);
            const isExpanded = panel.expandedBlock === i;
            const tName = file.typeName || MGT_TYPE_NAMES[file.mgtType] || 'Unknown';

            let rowClasses = 'editor-block-row disk-row';
            if (file.deleted) rowClasses += ' disk-deleted';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            let addrDetail = '<span class="file-addr"></span>';
            if (file.mgtType === 4 || file.mgtType === 7 || file.mgtType === 19 || file.mgtType === 20) {
                addrDetail = `<span class="file-addr">${fmtAddrPair(file.startAddress)}</span>`;
            } else if ((file.mgtType === 1 || file.mgtType === 16) && file.autostart != null && file.autostart < 0x8000) {
                addrDetail = `<span class="file-addr">LINE ${file.autostart}</span>`;
            }
            html += `<span class="dim">${i + 1}:</span>`;
            html += `<span class="file-name">${file.name.replace(/\s+$/, '')}</span>`;
            html += `<span class="file-flag"></span>`;
            html += `<span class="file-mgttype">${tName}</span>`;
            html += addrDetail;
            html += `<span class="file-size">${file.length}</span>`;
            html += `<span class="file-sectors">${file.sectors}</span>`;
            if (file.deleted) html += ' <span class="bad">[DEL]</span>';
            html += '</span></div>';

            if (isExpanded) {
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<input type="text" maxlength="10" value="${file.name.replace(/\s+$/, '')}" data-field="name" placeholder="Name" class="editor-input">`;
                html += `<select data-field="mgttype" class="editor-input">`;
                for (const [k, v] of Object.entries(MGT_TYPE_NAMES)) {
                    if (k === '0') continue; // skip Erased
                    html += `<option value="${k}"${file.mgtType === parseInt(k) ? ' selected' : ''}>${v}</option>`;
                }
                html += '</select>';
                html += `<input type="text" value="${fmtAddr(file.startAddress)}" data-field="addr" maxlength="5" placeholder="Addr" class="editor-input editor-input-short">`;
                html += `<button class="editor-apply-btn" data-action="mgt-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${activeFiles} files, ${selCount} sel \u2014 ${freeSectors} free`;
        } else {
            panel.dom.statusSpan.textContent = `${activeFiles} files \u2014 ${freeSectors} free`;
        }
        ctx.editorUpdateToolbar();
    }

    function diskEditorNewMgt(panel) {
        panel.diskFiles = [];
        panel.diskLabel = '';
        panel.blocks = [];
        panel.parsedFile = { type: 'mgt', files: [], info: null, size: 0 };
        panel.fileType = 'mgt';
        panel.rawData = new Uint8Array(0);
        panel.fileName = 'new.mgt';
        panel.selection.clear();
        panel.expandedBlock = -1;
        ctx.updatePanelHeader(panel);
        mgtEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function diskEditorAddMgtFile(panel, data, name, mgtType, addr, autostart, varsOffset) {
        const length = data.length;
        // BASIC: dir bytes 214-215 hold the PROG system variable (standard 23755),
        // bytes 216-217 the program body length (vars offset)
        const isBASICType = mgtType === 1 || mgtType === 16;
        if (isBASICType && !addr) addr = 23755;
        // G+DOS chain format stores 510 data bytes per sector (2-byte chain pointer).
        const sectors = Math.max(1, Math.ceil(length / 510));
        if (sectors > 195) return 'File too large (max 195 sectors)';
        if (panel.diskFiles.length >= 80) return 'Directory full (max 80 files)';
        if (mgtEditorTotalSectors(panel) + sectors > 1560) return 'Disk full (not enough free sectors)';

        // Store clean file bytes; buildMGT lays them out into the chain format.
        const cleanData = new Uint8Array(data.subarray(0, length));
        const paddedName = (name + '          ').substring(0, 10);

        // Map mgtType to tapeType and typeName
        const tapeTypeMap = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 3, 7: 3, 9: 3, 10: 3, 11: 3 };
        const tapeType = tapeTypeMap[mgtType] !== undefined ? tapeTypeMap[mgtType] : 3;
        const typeName = MGT_TYPE_NAMES[mgtType] || 'Code';

        panel.diskFiles.push({
            name: paddedName,
            ext: typeName.substring(0, 1).toUpperCase(),
            mgtType: mgtType,
            tapeType: tapeType,
            typeName: typeName,
            startAddress: addr,
            length: length,
            sectors: sectors,
            data: cleanData,
            autostart: autostart != null ? autostart : null,
            bodyLength: (isBASICType && varsOffset != null) ? Math.min(varsOffset, length) : null,
            deleted: false
        });
        return null;
    }

    function diskEditorBuildMgt(panel) {
        // Serialize via the core builder, which writes the proper G+DOS chain
        // format (510 data bytes + 2-byte chain pointer per sector). panel.diskFiles
        // hold clean file bytes (length-trimmed), which is what buildMGT expects.
        return MGTLoader.buildMGT(panel.diskFiles, panel.diskLabel);
    }

    function diskEditorSaveMgt(panel) {
        if (panel.diskFiles.length === 0) return;
        const data = diskEditorBuildMgt(panel);
        const nameMatch = (panel.fileName || 'output').match(/^(.*)\.(mgt|img)$/i);
        const baseName = nameMatch ? nameMatch[1] : (panel.fileName || 'output');
        const ext = nameMatch ? nameMatch[2].toLowerCase() : 'mgt';
        downloadFile(baseName + '.' + ext, data);
    }

    function mgtEditorApplyInlineEdit(panel, idx) {
        if (idx < 0 || idx >= panel.diskFiles.length) return;
        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const typeSelect = editRow.querySelector('[data-field="mgttype"]');
        const addrInput = editRow.querySelector('[data-field="addr"]');

        const file = panel.diskFiles[idx];
        if (nameInput) {
            file.name = (nameInput.value + '          ').substring(0, 10);
        }
        if (typeSelect) {
            const newType = parseInt(typeSelect.value);
            file.mgtType = newType;
            file.typeName = MGT_TYPE_NAMES[newType] || 'Code';
            file.ext = file.typeName.substring(0, 1).toUpperCase();
            // Update tapeType based on mgtType
            const tapeTypeMap = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 3, 7: 3, 9: 3, 10: 3, 11: 3 };
            file.tapeType = tapeTypeMap[newType] !== undefined ? tapeTypeMap[newType] : 3;
        }
        if (addrInput) {
            file.startAddress = parseAddr(addrInput.value) || 0;
        }

        panel.expandedBlock = -1;
        mgtEditorRenderFileList(panel);
        mgtEditorRefreshExplorer(panel);
    }

    function mgtEditorRefreshExplorer(panel) {
        const mgt = diskEditorBuildMgt(panel);
        panel.rawData = mgt;
        panel.parsedFile = ctx.explorerParseMGT(mgt);
        ctx.syncPanelToExplorer(panel);
    }

    // ========== MDR (Microdrive) Editor Functions (parameterized) ==========

    function mdrEditorParseHeader(file) {
        if (!file.isPrint && file.data && file.data.length >= 9) {
            const d = file.data;
            const hdrType = d[0];
            const hdrLen = d[1] | (d[2] << 8);
            const hdrStart = d[3] | (d[4] << 8);
            const hdrAutorun = d[7] | (d[8] << 8);
            file.dataLength = hdrLen;
            if (hdrType === 0) { file.ext = 'B'; file.typeName = 'BASIC'; file.autorunLine = hdrAutorun >= 0x8000 ? -1 : hdrAutorun; }
            else if (hdrType === 1) { file.ext = 'D'; file.typeName = 'Num array'; }
            else if (hdrType === 2) { file.ext = 'D'; file.typeName = 'Char array'; }
            else if (hdrType === 3) { file.ext = 'C'; file.typeName = 'Code'; file.startAddress = hdrStart; }
        }
        if (file.dataLength === undefined) file.dataLength = file.length;
        if (file.startAddress === undefined) file.startAddress = 0;
        if (file.autorunLine === undefined) file.autorunLine = -1;
    }

    function diskEditorExtractMdrFiles(panel) {
        if (panel.diskFiles.length > 0) return;
        if (!panel.parsedFile || panel.parsedFile.type !== 'mdr') return;
        if (!panel.rawData || panel.rawData.length === 0) return;

        const files = MDRLoader.listFiles(panel.rawData);
        for (const f of files) {
            const fileData = MDRLoader.extractFile(panel.rawData, f);
            const entry = {
                name: (f.name + '          ').substring(0, 10),
                ext: f.isPrint ? 'P' : 'F',
                typeName: f.type,
                length: f.length,
                sectors: f.sectors,
                sectorIndices: f.sectorIndices,
                isPrint: f.isPrint,
                mdrFile: true,
                data: fileData,
                deleted: false
            };
            mdrEditorParseHeader(entry);
            panel.diskFiles.push(entry);
        }
        panel.diskLabel = MDRLoader.getDiskInfo(panel.rawData).cartridgeName || '';
    }

    function mdrEditorRenderFileList(panel) {
        diskEditorExtractMdrFiles(panel);

        if (panel.diskFiles.length === 0) {
            ctx.editorRenderLabelBar(panel);
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty MDR cartridge. Use "Add File" to add files.</span>';
            panel.dom.statusSpan.textContent = '0 files';
            ctx.editorUpdateToolbar();
            return;
        }

        const info = MDRLoader.getDiskInfo(panel.rawData);
        const activeFiles = panel.diskFiles.filter(f => !f.deleted).length;
        const deletedFiles = panel.diskFiles.length - activeFiles;

        let html = '';
        ctx.editorRenderLabelBar(panel);
        html += ctx.editorColHeaderHtml('Sectors');

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const file = panel.diskFiles[i];
            const isSel = panel.selection.has(i);
            const isExpanded = panel.expandedBlock === i;

            let rowClasses = 'editor-block-row disk-row';
            if (file.deleted) rowClasses += ' disk-deleted';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span>`;
            html += `<span class="file-name">${file.name.replace(/\s+$/, '')}</span>`;
            html += `<span class="file-flag"></span>`;
            html += `<span class="file-mgttype">${file.typeName}</span>`;
            if (file.ext === 'C') html += `<span class="file-addr">${fmtAddrPair(file.startAddress)}</span>`;
            else if (file.ext === 'B' && file.autorunLine >= 0) html += `<span class="file-addr">LINE ${file.autorunLine}</span>`;
            else html += `<span class="file-addr"></span>`;
            html += `<span class="file-size">${file.dataLength}</span>`;
            html += `<span class="file-sectors">${file.sectors}</span>`;
            if (file.deleted) html += ' <span class="bad">[DEL]</span>';
            html += '</span></div>';

            if (isExpanded) {
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<input type="text" maxlength="10" value="${file.name.replace(/\s+$/, '')}" data-field="name" placeholder="Name" class="editor-input">`;
                html += `<select data-field="mdrtype" class="editor-input">`;
                html += `<option value="F"${!file.isPrint ? ' selected' : ''}>File</option>`;
                html += `<option value="P"${file.isPrint ? ' selected' : ''}>Data</option>`;
                html += '</select>';
                html += `<button class="editor-apply-btn" data-action="mdr-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${activeFiles} files, ${selCount} sel \u2014 ${info.freeSectors} free`;
        } else {
            panel.dom.statusSpan.textContent = `${activeFiles} files \u2014 ${info.freeSectors} free`;
        }
        ctx.editorUpdateToolbar();
    }

    function diskEditorNewMdr(panel) {
        panel.diskFiles = [];
        panel.diskLabel = '';
        panel.blocks = [];
        panel.parsedFile = { type: 'mdr', files: [], info: null, size: 0 };
        panel.fileType = 'mdr';
        panel.rawData = MDRLoader.createBlankMDR();
        panel.fileName = 'new.mdr';
        panel.selection.clear();
        panel.expandedBlock = -1;
        ctx.updatePanelHeader(panel);
        mdrEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function diskEditorAddMdrFile(panel, data, name, isPrint) {
        const length = data.length;
        const sectors = Math.ceil(length / MDRLoader.DATA_SIZE) || 1;
        const totalSectors = panel.rawData ? MDRLoader.getSectorCount(panel.rawData) : MDRLoader.SECTOR_COUNT;
        const usedSectors = panel.diskFiles.filter(f => !f.deleted).reduce((sum, f) => sum + f.sectors, 0);
        if (sectors > totalSectors - usedSectors) return 'File too large';

        const entry = {
            name: (name + '          ').substring(0, 10),
            ext: isPrint ? 'P' : 'F',
            typeName: isPrint ? 'Data' : 'File',
            length: length,
            sectors: sectors,
            sectorIndices: [],
            isPrint: isPrint,
            data: new Uint8Array(data),
            deleted: false
        };
        mdrEditorParseHeader(entry);
        panel.diskFiles.push(entry);
        return null;
    }

    function diskEditorBuildMdr(panel) {
        const files = panel.diskFiles.filter(f => !f.deleted).map(f => ({
            name: f.name.replace(/\s+$/, ''),
            data: f.data.slice(0, f.length),
            isPrint: f.isPrint
        }));
        const cartridgeName = panel.diskLabel || 'BLANK';
        const sectorCount = panel.rawData ? MDRLoader.getSectorCount(panel.rawData) : MDRLoader.SECTOR_COUNT;
        return MDRLoader.buildMDR(files, cartridgeName, sectorCount);
    }

    function diskEditorSaveMdr(panel) {
        if (panel.diskFiles.length === 0) return;
        const data = diskEditorBuildMdr(panel);
        const baseName = (panel.fileName || 'output').replace(/\.mdr$/i, '');
        downloadFile(baseName + '.mdr', data);
    }

    function mdrEditorApplyInlineEdit(panel, idx) {
        if (idx === -2) {
            const editRow = panel.dom.fileList.querySelector('.editor-inline-edit[data-edit-idx="-2"]');
            if (!editRow) return;
            const labelInput = editRow.querySelector('[data-field="label"]');
            panel.diskLabel = ((labelInput ? labelInput.value : '') + '          ').substring(0, 10);
            panel.expandedBlock = -1;
            panel.rawData = diskEditorBuildMdr(panel);
            panel.parsedFile = ctx.explorerParseMDR(panel.rawData);
            mdrEditorRenderFileList(panel);
            ctx.syncPanelToExplorer(panel);
            return;
        }
        if (idx < 0 || idx >= panel.diskFiles.length) return;
        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const typeSelect = editRow.querySelector('[data-field="mdrtype"]');

        const file = panel.diskFiles[idx];
        if (nameInput) {
            file.name = (nameInput.value + '          ').substring(0, 10);
        }
        if (typeSelect) {
            file.isPrint = typeSelect.value === 'P';
            file.ext = file.isPrint ? 'P' : 'F';
            file.typeName = file.isPrint ? 'Data' : 'File';
        }

        panel.expandedBlock = -1;
        // Rebuild MDR image and refresh
        const mdr = diskEditorBuildMdr(panel);
        panel.rawData = mdr;
        panel.parsedFile = ctx.explorerParseMDR(mdr);
        mdrEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function mdrEditorRefreshExplorer(panel) {
        const mdr = diskEditorBuildMdr(panel);
        panel.rawData = mdr;
        panel.parsedFile = ctx.explorerParseMDR(mdr);
        ctx.syncPanelToExplorer(panel);
    }

    // ========== OPD (Opus Discovery) Editor Functions ==========

    function diskEditorNewOpd(panel, sides = 1) {
        const blank = OPDLoader.createBlankOPD(sides);
        panel.diskFiles = [];
        panel.diskLabel = '';
        panel.blocks = [];
        panel.parsedFile = { type: 'opd', files: [], info: OPDLoader.getDiskInfo(blank), size: blank.length };
        panel.fileType = 'opd';
        panel.rawData = blank;
        panel.fileName = 'new.opd';
        panel.selection.clear();
        panel.expandedBlock = -1;
        ctx.updatePanelHeader(panel);
        opdEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function diskEditorNewDidaktik(panel, variant = 'd80') {
        panel.fileType = 'didaktik';
        panel.rawData = (variant === 'd40') ? DidaktikLoader.createBlankD40('') : DidaktikLoader.createBlankD80('');
        panel.parsedFile = ctx.explorerParseDidaktik(panel.rawData);
        panel.fileName = (variant === 'd40') ? 'new.d40' : 'new.d80';
        panel.selection.clear();
        panel.expandedBlock = -1;
        panel.diskFiles = [];        // fresh load → no carried-over soft-delete marks
        didaktikEditorExtractFiles(panel);
        ctx.updatePanelHeader(panel);
        didaktikEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function diskEditorExtractOpdFiles(panel) {
        const files = OPDLoader.listFiles(panel.rawData);
        panel.diskFiles = [];
        for (const f of files) {
            const raw = OPDLoader.extractFile(panel.rawData, f);
            const fileData = raw && f.length < raw.length ? raw.slice(0, f.length) : raw;
            panel.diskFiles.push({
                name: (f.name + '          ').substring(0, 10),
                ext: f.ext,
                type: f.type,
                typeName: f.typeName,
                length: f.length,
                sectors: f.sectors,
                startAddr: f.startAddr,
                autostart: f.autostart,
                data: fileData ? new Uint8Array(fileData) : new Uint8Array(0),
                deleted: false
            });
        }
        panel.blocks = panel.diskFiles;
        const info = OPDLoader.getDiskInfo(panel.rawData);
        panel.diskLabel = info.diskLabel || '';
    }

    function diskEditorAddOpdFile(panel, data, name, type, startAddr, autostart, varsOffset) {
        const sides = OPDLoader.isDoubleSided(panel.rawData) ? 2 : 1;
        const typeNames = { 0: 'BASIC', 1: 'Number array', 2: 'String array', 3: 'CODE' };
        const extMap = { 0: 'B', 1: 'D', 2: 'D', 3: 'C' };
        panel.diskFiles.push({
            name: (name + '          ').substring(0, 10),
            ext: extMap[type] || 'C',
            type: type,
            typeName: typeNames[type] || 'CODE',
            length: data.length,
            sectors: Math.ceil((data.length + OPDLoader.FILE_HEADER_SIZE) / 256),
            startAddr: startAddr || 0,
            autostart: autostart || 0,
            progLength: (type === 0 && varsOffset != null) ? Math.min(varsOffset, data.length) : null,
            data: new Uint8Array(data),
            deleted: false
        });
        // Rebuild the OPD image from diskFiles
        opdEditorRebuildImage(panel);
        return null;
    }

    function opdEditorRebuildImage(panel) {
        const sides = OPDLoader.isDoubleSided(panel.rawData) ? 2 : 1;
        const files = panel.diskFiles.filter(f => !f.deleted).map(f => ({
            name: f.name.replace(/\s+$/, ''),
            type: f.type >= 0 ? f.type : 3,
            length: f.data.length,
            startAddr: f.startAddr || 0,
            autostart: f.autostart || 0,
            progLength: f.progLength ?? null,
            data: f.data
        }));
        const newImage = OPDLoader.buildOPD(files, panel.diskLabel || '', sides, panel.rawData);
        panel.rawData = newImage;
        panel.parsedFile = ctx.explorerParseOPD(newImage);
        panel.blocks = panel.diskFiles;
    }

    function opdEditorRenderFileList(panel) {
        const info = OPDLoader.getDiskInfo(panel.rawData);
        const sides = OPDLoader.isDoubleSided(panel.rawData) ? 2 : 1;

        let html = '';
        ctx.editorRenderLabelBar(panel);
        html += ctx.editorColHeaderHtml('Sectors');

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const f = panel.diskFiles[i];
            const selected = panel.selection.has(i);
            const trimName = f.name.replace(/\s+$/, '');
            let addrDetail = '<span class="file-addr"></span>';
            if (f.type === 3) {
                addrDetail = `<span class="file-addr">${fmtAddrPair(f.startAddr || 0)}</span>`;
            } else if (f.type === 0 && f.autostart != null && f.autostart < 0x8000) {
                addrDetail = `<span class="file-addr">LINE ${f.autostart}</span>`;
            }

            html += `<div class="editor-block-row disk-row${f.deleted ? ' disk-deleted' : ''}${selected ? ' selected' : ''}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span>`;
            html += `<span class="file-name">${escapeHtml(trimName)}</span>`;
            html += `<span class="file-flag"></span>`;
            html += `<span class="file-ext">${f.typeName}</span>`;
            html += addrDetail;
            html += `<span class="file-size">${f.length}</span>`;
            html += `<span class="file-sectors">${f.sectors}</span>`;
            html += '</span></div>';

            if (panel.expandedBlock === i) {
                const typeOptions = [0, 3].map(t => {
                    const names = { 0: 'BASIC', 3: 'Code' };
                    return `<option value="${t}"${t === f.type ? ' selected' : ''}>${names[t]}</option>`;
                }).join('');
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<input type="text" data-field="name" value="${escapeHtml(trimName)}" maxlength="10" placeholder="Name" class="editor-input">`;
                html += `<select data-field="opdtype" class="editor-input">${typeOptions}</select>`;
                if (f.type === 3) {
                    html += `<input type="text" data-field="addr" value="${fmtAddr(f.startAddr || 0)}" maxlength="5" placeholder="Addr" class="editor-input editor-input-short">`;
                }
                html += `<button class="editor-apply-btn" data-action="opd-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;
        const opdActive = panel.diskFiles.filter(f => !f.deleted).length;
        const opdDeleted = panel.diskFiles.length - opdActive;
        const opdDelTag = opdDeleted > 0 ? ` (+${opdDeleted} deleted, flushed on save)` : '';
        panel.dom.statusSpan.textContent = `${sides === 2 ? 'DS' : 'SS'} ${opdActive} files, ${info.usedSectors}/${info.totalSectors} sectors${opdDelTag}`;
        ctx.editorUpdateToolbar();
    }

    function opdEditorApplyInlineEdit(panel, idx) {
        if (idx === -2) {
            const editRow = panel.dom.fileList.querySelector('.editor-inline-edit[data-edit-idx="-2"]');
            if (!editRow) return;
            const labelInput = editRow.querySelector('[data-field="label"]');
            panel.diskLabel = (labelInput ? labelInput.value : '').substring(0, 10);
            panel.expandedBlock = -1;
            opdEditorRebuildImage(panel);
            opdEditorRenderFileList(panel);
            ctx.syncPanelToExplorer(panel);
            return;
        }
        if (idx < 0 || idx >= panel.diskFiles.length) return;
        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const typeSelect = editRow.querySelector('[data-field="opdtype"]');
        const addrInput = editRow.querySelector('[data-field="addr"]');

        const file = panel.diskFiles[idx];
        if (nameInput) {
            file.name = (nameInput.value + '          ').substring(0, 10);
        }
        if (typeSelect) {
            const newType = parseInt(typeSelect.value);
            file.type = newType;
            const typeNames = { 0: 'BASIC', 1: 'Num array', 2: 'Str array', 3: 'Code' };
            const extMap = { 0: 'B', 1: 'D', 2: 'D', 3: 'C' };
            file.typeName = typeNames[newType] || 'Code';
            file.ext = extMap[newType] || 'C';
        }
        if (addrInput) {
            file.startAddr = parseAddr(addrInput.value) || 0;
        }

        panel.expandedBlock = -1;
        opdEditorRebuildImage(panel);
        opdEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function opdEditorRefreshExplorer(panel) {
        opdEditorRebuildImage(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function diskEditorSaveOpd(panel) {
        if (!panel.rawData || panel.rawData.length === 0) return;
        opdEditorRebuildImage(panel); // flush any soft-deleted (Mark Del) entries
        const baseName = (panel.fileName || 'output').replace(/\.opd$/i, '').replace(/\.opu$/i, '');
        downloadFile(baseName + '.opd', panel.rawData);
    }

    function opdEditorDeleteSelection(panel) {
        if (panel.selection.size === 0) return;
        // Hard delete (forever): drop the entries and compact. Use "Mark Del" for a
        // recoverable soft-delete that stays greyed in the list and is flushed on save.
        const sorted = ctx.editorSelectedSorted(panel).reverse();
        for (const idx of sorted) {
            panel.diskFiles.splice(idx, 1);
        }
        panel.selection.clear();
        panel.expandedBlock = -1;
        opdEditorRebuildImage(panel);
        opdEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function opdEditorExtractSelection(panel, format) {
        const sorted = ctx.editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        const baseName = (panel.fileName || 'extract').replace(/\.(opd|opu)$/i, '');
        const asHobeta = format === 'hobeta';
        const mk = (file) => {
            const body = file.data.slice(0, file.length);
            const trimName = file.name.replace(/\s+$/, '');
            if (asHobeta) {
                const ext = (file.ext && file.ext.length === 1) ? file.ext
                    : (file.type === 0 ? 'B' : file.type === 3 ? 'C' : 'D');
                const hob = ctx.buildHobeta({ name: trimName, ext, startAddress: file.startAddr || 0, length: file.length, data: body });
                return { name: trimName + '.' + ctx.trdExtToHobetaExt(ext), data: hob };
            }
            return { name: `${trimName}.${file.ext}`, data: body };
        };
        if (sorted.length === 1) {
            const { name, data } = mk(panel.diskFiles[sorted[0]]);
            downloadFile(name, data);
            return;
        }
        const files = sorted.map(idx => mk(panel.diskFiles[idx]));
        downloadFile(baseName + '_extract.zip', ctx.editorCreateZip(files));
    }

    // ========== Didaktik MDOS Editor (read-only: list + extract/copy only) ==========

    function didaktikEditorExtractFiles(panel) {
        // Preserve soft-delete marks across re-extraction (refresh): keyed by start sector,
        // which is stable across renames/edits. Empty on a fresh load (diskFiles reset there).
        const prevDeleted = new Set((panel.diskFiles || []).filter(f => f.deleted).map(f => f.firstSec));
        const files = DidaktikLoader.listFiles(panel.rawData);
        panel.diskFiles = [];
        for (const f of files) {
            const raw = DidaktikLoader.extractFile(panel.rawData, f);
            panel.diskFiles.push({
                name: f.name,
                ext: f.ext,
                type: f.type,            // MDOS type char ('P', 'B', 'N', 'C', ...)
                typeName: f.typeName,
                length: f.length,
                startAddr: f.startAddr,
                basicLength: f.basicLength,
                firstSec: f.firstSec,
                data: raw ? new Uint8Array(raw) : new Uint8Array(0),
                deleted: prevDeleted.has(f.firstSec)
            });
        }
        panel.blocks = panel.diskFiles;
        const info = DidaktikLoader.getDiskInfo(panel.rawData);
        panel.diskLabel = info.diskLabel || '';
    }

    function didaktikEditorRenderFileList(panel) {
        const info = DidaktikLoader.getDiskInfo(panel.rawData);
        const freeSec = DidaktikLoader._freeSectors(panel.rawData).length;
        let html = '';
        ctx.editorRenderLabelBar(panel);
        html += ctx.editorColHeaderHtml();

        for (let i = 0; i < panel.diskFiles.length; i++) {
            const f = panel.diskFiles[i];
            const selected = panel.selection.has(i);
            let addrDetail = '<span class="file-addr"></span>';
            if (f.type === 'B') {
                addrDetail = `<span class="file-addr">${fmtAddrPair(f.startAddr)}</span>`;
            } else if (f.type === 'P' && f.startAddr > 0 && f.startAddr < 0x8000) {
                addrDetail = `<span class="file-addr">LINE ${f.startAddr}</span>`;
            }
            html += `<div class="editor-block-row disk-row${f.deleted ? ' disk-deleted' : ''}${selected ? ' selected' : ''}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span>`;
            html += `<span class="file-name">${escapeHtml(f.name)}</span>`;
            html += `<span class="file-flag"></span>`;
            html += `<span class="file-ext">${escapeHtml(f.typeName)}</span>`;
            html += addrDetail;
            html += `<span class="file-size">${f.length}</span>`;
            html += '</span></div>';

            if (panel.expandedBlock === i) {
                const isBasic = f.type === 'P';
                const addrLabel = isBasic ? 'LINE' : 'Addr';
                const addrVal = isBasic ? String(f.startAddr) : fmtAddr(f.startAddr || 0);
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<input type="text" data-field="name" value="${escapeHtml(f.name)}" maxlength="10" placeholder="Name" class="editor-input">`;
                html += `<input type="text" data-field="addr" value="${addrVal}" maxlength="5" placeholder="${addrLabel}" class="editor-input editor-input-short">`;
                html += `<button class="editor-apply-btn" data-action="didaktik-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;
        const dkDeleted = panel.diskFiles.filter(f => f.deleted).length;
        const dkActive = panel.diskFiles.length - dkDeleted;
        const dkDelTag = dkDeleted > 0 ? ` (+${dkDeleted} deleted, flushed on save)` : '';
        panel.dom.statusSpan.textContent = `${dkActive} files — ${freeSec} free${dkDelTag}`;
        ctx.editorUpdateToolbar();
    }

    function didaktikEditorExtractSelection(panel, format) {
        const sorted = ctx.editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        const baseName = (panel.fileName || 'extract').replace(/\.(d40|d80)$/i, '');
        const asHobeta = format === 'hobeta';
        // MDOS type char → TR-DOS extension (Hobeta uses TR-DOS conventions)
        const mdosToTrd = { P: 'B', B: 'C', N: 'D', C: 'D', S: 'C', Q: '#' };
        const mk = (file) => {
            const body = file.data.slice(0, file.length);
            const trimName = file.name.replace(/\s+$/, '');
            if (asHobeta) {
                const trdExt = mdosToTrd[file.type] || 'C';
                const hob = ctx.buildHobeta({ name: trimName, ext: trdExt, startAddress: file.startAddr || 0, length: file.length, data: body });
                return { name: trimName + '.' + ctx.trdExtToHobetaExt(trdExt), data: hob };
            }
            return { name: `${trimName}.${file.ext}`, data: body };
        };
        if (sorted.length === 1) {
            const { name, data } = mk(panel.diskFiles[sorted[0]]);
            downloadFile(name, data);
            return;
        }
        const files = sorted.map(idx => mk(panel.diskFiles[idx]));
        const zipData = ctx.editorCreateZip(files);
        downloadFile(baseName + '_extract.zip', zipData);
    }

    // Re-derive editor state + explorer view after an in-place image mutation.
    function didaktikEditorRefresh(panel) {
        panel.parsedFile = ctx.explorerParseDidaktik(panel.rawData);
        didaktikEditorExtractFiles(panel);
        didaktikEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function didaktikEditorDeleteSelection(panel) {
        const sorted = ctx.editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        // Capture firstSec before mutating — indices shift as files are removed.
        const targets = sorted.map(idx => panel.diskFiles[idx]).filter(Boolean);
        for (const f of targets) {
            panel.rawData = DidaktikLoader.deleteFile(panel.rawData, { firstSec: f.firstSec });
        }
        panel.selection.clear();
        panel.expandedBlock = -1;
        didaktikEditorRefresh(panel);
    }

    // Soft-delete toggle (Mark Del): flag selected entries deleted (greyed) without touching
    // the image; flushed (0xE5) into a copy on save. Re-running undeletes. Marks survive
    // refresh via the firstSec-keyed preserve in didaktikEditorExtractFiles.
    function didaktikEditorMarkDeletedSelection(panel) {
        if (panel.selection.size === 0) return;
        const sorted = ctx.editorSelectedSorted(panel);
        const allDeleted = sorted.every(idx => panel.diskFiles[idx] && panel.diskFiles[idx].deleted);
        for (const idx of sorted) {
            if (panel.diskFiles[idx]) panel.diskFiles[idx].deleted = !allDeleted;
        }
        panel.expandedBlock = -1;
        didaktikEditorRenderFileList(panel);
    }

    function didaktikEditorMoveSelection(panel, dir) {
        const sorted = ctx.editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        if (dir === -1 && sorted[0] === 0) return;
        if (dir === 1 && sorted[sorted.length - 1] === panel.diskFiles.length - 1) return;
        // Process in an order that doesn't clobber not-yet-moved neighbours.
        const order = dir === -1 ? sorted : sorted.slice().reverse();
        const newSel = new Set();
        for (const idx of order) {
            const a = panel.diskFiles[idx];
            const b = panel.diskFiles[idx + dir];
            if (a && b) panel.rawData = DidaktikLoader.swapDirEntries(panel.rawData, a.firstSec, b.firstSec);
            newSel.add(idx + dir);
        }
        panel.expandedBlock = -1;
        didaktikEditorRefresh(panel);          // re-extracts diskFiles in the new order
        panel.selection = newSel;
        didaktikEditorRenderFileList(panel);   // re-render with restored selection
    }

    function didaktikEditorAddFile(panel, data, name, dialogExt, addr) {
        // Dialog convention: B = BASIC, C/other = Code. MDOS: P = BASIC, B = Code.
        const isBasic = dialogExt === 'B';
        const file = {
            name,
            type: isBasic ? 'P' : 'B',
            data: data,
            startAddr: addr,
            basicLength: isBasic ? data.length : undefined
        };
        panel.rawData = DidaktikLoader.addFile(panel.rawData, file); // throws on full disk/dir
        panel.selection.clear();
        panel.expandedBlock = -1;
        didaktikEditorRefresh(panel);
        return null;
    }

    function didaktikEditorApplyInlineEdit(panel, idx) {
        if (idx === -2) {
            const editRow = panel.dom.fileList.querySelector('.editor-inline-edit[data-edit-idx="-2"]');
            if (!editRow) return;
            const labelInput = editRow.querySelector('[data-field="label"]');
            panel.rawData = DidaktikLoader.setDiskLabel(panel.rawData, labelInput ? labelInput.value : '');
            panel.expandedBlock = -1;
            didaktikEditorRefresh(panel);
            return;
        }
        if (idx < 0 || idx >= panel.diskFiles.length) return;
        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;
        const f = panel.diskFiles[idx];
        const nameInput = editRow.querySelector('[data-field="name"]');
        const addrInput = editRow.querySelector('[data-field="addr"]');
        let bytes = panel.rawData;
        if (nameInput) bytes = DidaktikLoader.renameFile(bytes, f, nameInput.value);
        if (addrInput) {
            const v = f.type === 'P' ? parseInt(addrInput.value, 10)
                                     : (parseAddr(addrInput.value) ?? NaN);
            if (!isNaN(v)) bytes = DidaktikLoader.setStartAddr(bytes, f.firstSec, v);
        }
        panel.rawData = bytes;
        panel.expandedBlock = -1;
        didaktikEditorRefresh(panel);
    }

    function didaktikEditorSave(panel) {
        if (!panel.rawData || panel.rawData.length === 0) return;
        // Flush soft-deleted entries into a copy (in-place 0xE5 delete); the editor view keeps them.
        let out = panel.rawData;
        const del = panel.diskFiles.filter(f => f.deleted);
        if (del.length) {
            out = new Uint8Array(panel.rawData);
            for (const f of del) out = DidaktikLoader.deleteFile(out, { firstSec: f.firstSec });
        }
        const isD40 = /\.d40$/i.test(panel.fileName || '');
        const baseName = (panel.fileName || 'disk').replace(/\.(d40|d80)$/i, '');
        downloadFile(baseName + (isD40 ? '.d40' : '.d80'), out);
    }

    // ========== DSK (CP/M +3DOS) Editor Functions (parameterized) ==========

    const dskFileKey = (f) => `${f.user}:${f.name}:${f.ext}`;

    function dskEditorRefreshState(panel) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        // Preserve soft-delete marks across re-listing (keyed by user:name:ext).
        const prevDeleted = new Set((panel.parsedFile.files || []).filter(f => f.deleted).map(dskFileKey));
        const buf = panel.parsedFile.dskImage.toBuffer();
        panel.rawData = buf;
        let files = [];
        try {
            files = ctx.DSKLoader.listFiles(panel.parsedFile.dskImage);
        } catch (e) { /* non-CP/M */ }
        for (const f of files) if (prevDeleted.has(dskFileKey(f))) f.deleted = true;
        panel.parsedFile.files = files;
        panel.blocks = files;
        ctx.syncPanelToExplorer(panel);
    }

    function dskEditorRenderFileList(panel) {
        if (!panel.parsedFile || panel.parsedFile.type !== 'dsk') return;
        const dskImage = panel.parsedFile.dskImage;
        if (!dskImage) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">No valid DSK image loaded</span>';
            panel.dom.statusSpan.textContent = '';
            ctx.editorUpdateToolbar();
            return;
        }

        const spec = ctx.DSKLoader.getDiskSpec(dskImage);
        const files = panel.parsedFile.files || [];

        if (!spec.valid && !spec.recognized && files.length === 0) {
            const bootInfo = ctx.detectBootloader(dskImage, spec);
            if (bootInfo) {
                panel.dom.fileList.innerHTML = '<span class="explorer-empty">Non-CP/M disk \u2014 editing not supported for this format</span>'
                    + '<div style="margin-top:6px"><span class="explorer-boot-disasm-link" style="color:var(--accent);cursor:pointer;text-decoration:underline">Boot sector contains code \u2014 view in Disasm tab</span></div>';
                panel.dom.statusSpan.textContent = 'Non-CP/M disk (bootloader)';
            } else {
                panel.dom.fileList.innerHTML = '<span class="explorer-empty">Non-CP/M disk \u2014 editing not supported for this format</span>';
                panel.dom.statusSpan.textContent = 'Non-CP/M disk';
            }
            ctx.editorUpdateToolbar();
            return;
        }

        const allocMap = ctx.DSKLoader.getBlockAllocationMap(dskImage, spec);

        if (files.length === 0) {
            // Still surface the editable label row so a blank disk can be named.
            panel.diskLabel = ctx.DSKLoader.getDiskLabel(dskImage);
            ctx.editorRenderLabelBar(panel);
            let emptyHtml = ctx.editorColHeaderHtml('Blocks');
            emptyHtml += '<span class="explorer-empty">Empty disk. Use "Add File" to add files.</span>';
            panel.dom.fileList.innerHTML = emptyHtml;
            panel.dom.statusSpan.textContent = `0 files \u2014 ${allocMap.freeBlocks} free blocks (${allocMap.freeBlocks * spec.blockSize} bytes)`;
            ctx.editorUpdateToolbar();
            return;
        }

        let html = '';
        const typeNames = { 0: 'BASIC', 1: 'Num array', 2: 'Char array', 3: 'Code' };
        panel.diskLabel = ctx.DSKLoader.getDiskLabel(dskImage);
        ctx.editorRenderLabelBar(panel);
        html += ctx.editorColHeaderHtml('Blocks');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const isSel = panel.selection.has(i);
            const isExpanded = panel.expandedBlock === i;

            let rowClasses = 'editor-block-row dsk-row';
            if (file.deleted) rowClasses += ' disk-deleted';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span>`;
            if (file.user > 0) html += `<span class="file-user">[U${file.user}]</span> `;
            html += `<span class="file-name">${file.name}${file.ext ? '.' + file.ext : ''}</span>`;
            html += `<span class="file-flag"></span>`;
            const typeName = file.headerSize ? (typeNames[file.plus3Type] || '?') : '';
            html += `<span class="file-plus3type">${typeName}</span>`;
            let dskAddrText = '';
            if (file.plus3Type === 3 && file.loadAddress !== undefined) dskAddrText = fmtAddrPair(file.loadAddress);
            else if (file.plus3Type === 0 && file.autostart !== undefined && file.autostart < 0x8000) dskAddrText = `LINE ${file.autostart}`;
            html += `<span class="file-addr">${dskAddrText}</span>`;
            html += `<span class="file-size">${file.size}</span>`;
            html += `<span class="file-sectors">${file.blocks}</span>`;
            html += '</span></div>';

            if (isExpanded) {
                html += `<div class="editor-inline-edit" data-edit-idx="${i}">`;
                html += `<input type="text" maxlength="8" value="${file.name}" data-field="name" placeholder="Name" class="editor-input">`;
                html += `<input type="text" maxlength="3" value="${file.ext}" data-field="ext" placeholder="Ext" class="editor-input editor-input-short">`;
                html += `<button class="editor-apply-btn" data-action="dsk-apply" data-idx="${i}">Apply</button>`;
                html += '</div>';
            }
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        const dskDeleted = files.filter(f => f.deleted).length;
        const dskActive = files.length - dskDeleted;
        const dskDelTag = dskDeleted > 0 ? ` (+${dskDeleted} deleted, flushed on save)` : '';
        const freeTxt = `${allocMap.freeBlocks * spec.blockSize} bytes free`;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${dskActive} files, ${selCount} sel \u2014 ${freeTxt}${dskDelTag}`;
        } else {
            panel.dom.statusSpan.textContent = `${dskActive} files \u2014 ${freeTxt}${dskDelTag}`;
        }
        ctx.editorUpdateToolbar();
    }

    function dskEditorDeleteFiles(panel) {
        if (panel.selection.size === 0) return;
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;

        const dskImage = panel.parsedFile.dskImage;
        const spec = ctx.DSKLoader.getDiskSpec(dskImage);
        const dir = ctx.DSKLoader._readDirectory(dskImage, spec);
        if (!dir) return;

        const { dirData } = dir;
        const files = panel.parsedFile.files;
        const maxEntries = Math.floor(dirData.length / 32);

        const toDelete = new Set();
        for (const idx of panel.selection) {
            if (idx >= 0 && idx < files.length) {
                const f = files[idx];
                toDelete.add(`${f.user}:${f.name}:${f.ext}`);
            }
        }

        for (let i = 0; i < maxEntries; i++) {
            const entryBase = i * 32;
            const user = dirData[entryBase];
            if (user === 0xE5 || user > 15) continue;

            let name = '';
            for (let j = 1; j <= 8; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) name += String.fromCharCode(ch);
            }
            name = name.trimEnd();

            let ext = '';
            for (let j = 9; j <= 11; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) ext += String.fromCharCode(ch);
            }
            ext = ext.trimEnd();

            if (toDelete.has(`${user}:${name}:${ext}`)) {
                dirData[entryBase] = 0xE5;
            }
        }

        ctx.DSKLoader.writeDirectory(dskImage, spec, dirData);
        panel.selection.clear();
        panel.expandedBlock = -1;
        dskEditorRefreshState(panel);
        dskEditorRenderFileList(panel);
    }

    function dskEditorMoveSelection(panel, dir) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        const files = panel.parsedFile.files || [];
        const sorted = ctx.editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        if (dir === -1 && sorted[0] === 0) return;
        if (dir === 1 && sorted[sorted.length - 1] === files.length - 1) return;

        const dskImage = panel.parsedFile.dskImage;
        const spec = ctx.DSKLoader.getDiskSpec(dskImage);
        const d = ctx.DSKLoader._readDirectory(dskImage, spec);
        if (!d) return;
        const { dirData } = d;
        const maxEntries = Math.floor(dirData.length / 32);

        // Group the 32-byte directory entries by file key (user:name:ext); a file may
        // span several extent entries, which must stay grouped and in directory order.
        const keyOf = (base) => {
            const user = dirData[base];
            if (user === 0xE5 || user > 15) return null;
            let name = '', ext = '';
            for (let j = 1; j <= 8; j++) { const c = dirData[base + j] & 0x7F; if (c >= 0x20) name += String.fromCharCode(c); }
            for (let j = 9; j <= 11; j++) { const c = dirData[base + j] & 0x7F; if (c >= 0x20) ext += String.fromCharCode(c); }
            return `${user}:${name.trimEnd()}:${ext.trimEnd()}`;
        };
        const groups = new Map();
        for (let i = 0; i < maxEntries; i++) {
            const base = i * 32, k = keyOf(base);
            if (k === null) continue;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(dirData.slice(base, base + 32));
        }
        const fileKeys = files.map(f => `${f.user}:${f.name}:${f.ext}`);

        // Compute the new file order by the same adjacent-swap rule as the other formats.
        const newOrder = files.map((_, i) => i);
        const order = dir === -1 ? sorted : sorted.slice().reverse();
        const newSel = new Set();
        for (const idx of order) {
            const j = idx + dir;
            const t = newOrder[idx]; newOrder[idx] = newOrder[j]; newOrder[j] = t;
            newSel.add(j);
        }

        // Rebuild the directory: write each file's entry-group in the new order,
        // 0xE5-fill the remainder (data/allocation blocks are untouched).
        const newDir = new Uint8Array(dirData.length).fill(0xE5);
        let pos = 0;
        for (const fi of newOrder) {
            const g = groups.get(fileKeys[fi]) || [];
            for (const e of g) { if (pos + 32 <= newDir.length) { newDir.set(e, pos); pos += 32; } }
        }
        ctx.DSKLoader.writeDirectory(dskImage, spec, newDir);
        panel.selection = newSel;
        panel.expandedBlock = -1;
        dskEditorRefreshState(panel);
        dskEditorRenderFileList(panel);
    }

    function dskEditorAddFile(panel, data, name, ext, type, addr, autostart, varsOffset) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return 'No DSK image loaded';
        return ctx.DSKLoader.addFile(panel.parsedFile.dskImage,
            { data, name, ext, type, addr, autostart, varsOffset });
    }

    function dskEditorRenameFile(panel, idx, newName, newExt) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        const dskImage = panel.parsedFile.dskImage;
        const spec = ctx.DSKLoader.getDiskSpec(dskImage);
        const dir = ctx.DSKLoader._readDirectory(dskImage, spec);
        if (!dir) return;

        const { dirData } = dir;
        const files = panel.parsedFile.files;
        if (idx < 0 || idx >= files.length) return;

        const file = files[idx];
        const maxEntries = Math.floor(dirData.length / 32);

        const paddedName = (newName + '        ').substring(0, 8);
        const paddedExt = (newExt + '   ').substring(0, 3);

        for (let i = 0; i < maxEntries; i++) {
            const entryBase = i * 32;
            const user = dirData[entryBase];
            if (user === 0xE5 || user > 15) continue;
            if (user !== file.user) continue;

            let name = '';
            for (let j = 1; j <= 8; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) name += String.fromCharCode(ch);
            }
            name = name.trimEnd();

            let ext = '';
            for (let j = 9; j <= 11; j++) {
                const ch = dirData[entryBase + j] & 0x7F;
                if (ch >= 0x20) ext += String.fromCharCode(ch);
            }
            ext = ext.trimEnd();

            if (name !== file.name || ext !== file.ext) continue;

            for (let j = 0; j < 8; j++) {
                const highBit = dirData[entryBase + 1 + j] & 0x80;
                dirData[entryBase + 1 + j] = highBit | (j < paddedName.length ? paddedName.charCodeAt(j) & 0x7F : 0x20);
            }
            for (let j = 0; j < 3; j++) {
                const highBit = dirData[entryBase + 9 + j] & 0x80;
                dirData[entryBase + 9 + j] = highBit | (j < paddedExt.length ? paddedExt.charCodeAt(j) & 0x7F : 0x20);
            }
        }

        ctx.DSKLoader.writeDirectory(dskImage, spec, dirData);
    }

    function dskEditorExtractFiles(panel, format) {
        const sorted = ctx.editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        const asHobeta = format === 'hobeta';

        const dskImage = panel.parsedFile.dskImage;
        const files = panel.parsedFile.files;
        const baseName = (panel.fileName || 'extract').replace(/\.dsk$/i, '');

        const extractDskFile = (file) => {
            const data = ctx.DSKLoader.readFileData(dskImage, file.name, file.ext, file.user, file.rawSize);
            if (!data) return null;
            const hdr = file.headerSize || 0;
            const fileData = (hdr && data.length >= hdr) ? data.slice(hdr, hdr + file.size) : data.slice(0, file.size);
            const trimName = file.name.trimEnd();
            if (asHobeta) {
                const hdrType = hdr ? file.plus3Type : 3;
                const addr = file.loadAddress || 0;
                const hobData = ctx.buildHobetaGeneric(trimName, hdrType, addr, fileData);
                const ext = ctx.trdExtToHobetaExt(ctx.headerTypeToTrdExt(hdrType));
                return { name: trimName + '.' + ext, data: hobData };
            }
            const name = trimName + (file.ext ? '.' + file.ext.trimEnd() : '');
            return { name, data: fileData };
        };

        if (sorted.length === 1) {
            const file = files[sorted[0]];
            if (!file) return;
            const result = extractDskFile(file);
            if (!result) return;
            downloadFile(result.name, result.data);
            return;
        }

        const zipFiles = [];
        for (const idx of sorted) {
            const file = files[idx];
            if (!file) continue;
            const result = extractDskFile(file);
            if (result) zipFiles.push(result);
        }
        if (zipFiles.length === 0) return;
        const zipData = ctx.editorCreateZip(zipFiles);
        downloadFile(baseName + '_extract.zip', zipData);
    }

    function dskEditorNewDsk(panel, format = 'p3-ss40') {
        const dskImage = ctx.DSKLoader.createBlankDSK(format);
        const spec = ctx.DSKLoader.getDiskSpec(dskImage);
        panel.parsedFile = {
            type: 'dsk',
            dskImage: dskImage,
            diskSpec: spec,
            files: [],
            isExtended: true,
            numTracks: dskImage.numTracks,
            numSides: dskImage.numSides,
            size: 0
        };
        panel.blocks = [];
        panel.fileType = 'dsk';
        panel.rawData = dskImage.toBuffer();
        panel.fileName = 'new.dsk';
        panel.selection.clear();
        panel.expandedBlock = -1;
        panel.diskFiles = [];
        panel.diskLabel = '        ';
        ctx.updatePanelHeader(panel);
        dskEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    // Soft-delete (Mark Del) for DSK: toggle the in-memory `deleted` flag (greyed). The on-disk
    // entry is left intact until save, when matching entries are 0xE5'd in a cloned image
    // (flush on save). The flag survives refresh via the key preserve in dskEditorRefreshState.
    // Re-running on an already-deleted selection undeletes it.
    function dskEditorMarkDeletedSelection(panel) {
        const files = panel.parsedFile && panel.parsedFile.files;
        if (!files || panel.selection.size === 0) return;
        const sorted = ctx.editorSelectedSorted(panel);
        const allDeleted = sorted.every(idx => files[idx] && files[idx].deleted);
        for (const idx of sorted) if (files[idx]) files[idx].deleted = !allDeleted;
        panel.expandedBlock = -1;
        dskEditorRenderFileList(panel);
    }

    function dskEditorSaveDsk(panel) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        let img = panel.parsedFile.dskImage;
        const del = (panel.parsedFile.files || []).filter(f => f.deleted);
        if (del.length) {
            img = ctx.DSKLoader.parse(img.toBuffer());   // clone so the editor view keeps the entries
            ctx.DSKLoader.deleteFiles(img, del);
        }
        const buf = img.toBuffer();
        const baseName = (panel.fileName || 'output').replace(/\.dsk$/i, '');
        downloadFile(baseName + '.dsk', buf);
    }

    function dskEditorApplyInlineEdit(panel, idx) {
        if (!panel.parsedFile || !panel.parsedFile.dskImage) return;
        if (idx === -2) {
            const editRow = panel.dom.fileList.querySelector('.editor-inline-edit[data-edit-idx="-2"]');
            if (!editRow) return;
            const labelInput = editRow.querySelector('[data-field="label"]');
            ctx.DSKLoader.setDiskLabel(panel.parsedFile.dskImage, labelInput ? labelInput.value : '');
            panel.expandedBlock = -1;
            dskEditorRefreshState(panel);
            dskEditorRenderFileList(panel);
            return;
        }
        const files = panel.parsedFile.files;
        if (idx < 0 || idx >= files.length) return;

        const editRow = panel.dom.fileList.querySelector(`.editor-inline-edit[data-edit-idx="${idx}"]`);
        if (!editRow) return;

        const nameInput = editRow.querySelector('[data-field="name"]');
        const extInput = editRow.querySelector('[data-field="ext"]');

        const newName = nameInput ? nameInput.value.trimEnd() : files[idx].name;
        const newExt = extInput ? extInput.value.trimEnd() : files[idx].ext;

        dskEditorRenameFile(panel, idx, newName, newExt);
        panel.expandedBlock = -1;
        dskEditorRefreshState(panel);
        dskEditorRenderFileList(panel);
    }

    // ========== ZIP Transparent Unwrap ==========

    function zipParseInnerFile(innerData, innerExt) {
        let parsed = null;
        if (innerExt === 'tap') {
            // Parse fully so File Info (which uses parsed.blocks) shows the block list,
            // not just the Edit tab (which re-parses the raw data itself).
            parsed = ctx.explorerParseTAP(innerData);
        } else if (innerExt === 'tzx') {
            parsed = ctx.explorerParseTZX(innerData);
        } else if (innerExt === 'trd') {
            parsed = ctx.explorerParseTRD(innerData);
        } else if (innerExt === 'scl') {
            parsed = { type: 'scl', files: [], size: innerData.length };
            const sig = String.fromCharCode(...innerData.slice(0, 8));
            if (sig === 'SINCLAIR') {
                const fileCount = innerData[8];
                let off = 9;
                for (let i = 0; i < fileCount; i++) {
                    const name = String.fromCharCode(...innerData.slice(off, off + 8));
                    const fext = String.fromCharCode(innerData[off + 8]);
                    const startAddr = innerData[off + 9] | (innerData[off + 10] << 8);
                    const length = innerData[off + 11] | (innerData[off + 12] << 8);
                    const sectors = innerData[off + 13];
                    parsed.files.push({ name, ext: fext, startAddress: startAddr, length, sectors, offset: 0 });
                    off += 14;
                }
                let dataOff = off;
                for (const f of parsed.files) { f.offset = dataOff; dataOff += f.sectors * 256; }
            }
        } else if (innerExt === 'mgt' || (innerExt === 'img' && (innerData.length === 819200 || innerData.length === 409600))) {
            parsed = ctx.explorerParseMGT(innerData);
        } else if (innerExt === 'mdr') {
            parsed = ctx.explorerParseMDR(innerData);
        } else if (innerExt === 'opd' || innerExt === 'opu') {
            parsed = ctx.explorerParseOPD(innerData);
        } else if (innerExt === 'd40' || innerExt === 'd80') {
            parsed = ctx.explorerParseDidaktik(innerData);
        } else if (innerExt === 'dsk') {
            try {
                const dskImage = ctx.DSKLoader.parse(innerData);
                const spec = ctx.DSKLoader.getDiskSpec(dskImage);
                let dskFiles = [];
                try { dskFiles = ctx.DSKLoader.listFiles(dskImage); } catch (e) { /* non-CP/M */ }
                parsed = { type: 'dsk', dskImage, diskSpec: spec, files: dskFiles, size: innerData.length };
            } catch (e) { /* invalid DSK */ }
        }
        return parsed;
    }

    async function zipLoadInnerFile(panel, zipEntry) {
        const innerExt = zipEntry.name.split('.').pop().toLowerCase();
        const innerData = new Uint8Array(zipEntry.data);
        const parsed = zipParseInnerFile(innerData, innerExt);
        if (parsed) {
            await ctx.loadFileIntoPanel(panel, innerData, zipEntry.name, innerExt, parsed);
            // Sync explorer display so File Info drills into the selected file
            if (panel === ctx.editorPanels.left) {
                ctx.explorerFileName.textContent += ' > ' + zipEntry.name;
                ctx.explorerFileSize.textContent = `(${innerData.length.toLocaleString()} bytes)`;
                const isMgtSize = innerData.length === 819200 || innerData.length === 409600;
                ctx.explorerFileType = (innerExt === 'img' && isMgtSize) ? 'mgt' : innerExt;
                ctx.explorerZipFiles = [];
                // Some read-only formats (e.g. Didaktik D40/D80) have no editor branch in
                // loadFileIntoPanel, so panel.parsedFile stays at the outer ZIP parse. Point
                // the explorer globals directly at the inner parse for the File Info views.
                ctx.explorerParsed = parsed;
                ctx.explorerData = innerData;
                ctx.explorerRenderFileInfo();
            }
        }
    }

    const zipPickDialog = document.getElementById('zipPickDialog');
    const zipPickList = document.getElementById('zipPickList');
    const btnZipPickCancel = document.getElementById('btnZipPickCancel');

    function zipShowPickDialog(panel, candidates) {
        let html = '';
        for (let i = 0; i < candidates.length; i++) {
            const f = candidates[i];
            const ext = f.name.split('.').pop().toLowerCase().toUpperCase();
            const size = f.data ? f.data.length : 0;
            html += `<div class="editor-block-row zip-row" data-zip-idx="${i}" style="cursor:pointer">`;
            html += '<span class="editor-block-info">';
            html += `<span class="file-ext">${ext}</span>`;
            html += `<span class="file-name">${f.name}</span>`;
            html += `<span class="file-size">\u2014 ${size.toLocaleString()} bytes</span>`;
            html += '</span></div>';
        }
        zipPickList.innerHTML = html;
        zipPickDialog._panel = panel;
        zipPickDialog._candidates = candidates;
        zipPickDialog.classList.remove('hidden');
    }

    zipPickList.addEventListener('click', (e) => {
        const row = e.target.closest('[data-zip-idx]');
        if (!row) return;
        const idx = parseInt(row.dataset.zipIdx);
        const panel = zipPickDialog._panel;
        const candidates = zipPickDialog._candidates;
        if (idx >= 0 && idx < candidates.length && panel) {
            zipPickDialog.classList.add('hidden');
            zipLoadInnerFile(panel, candidates[idx]);
        }
    });

    btnZipPickCancel.addEventListener('click', () => {
        zipPickDialog.classList.add('hidden');
    });

    // ========== ZIP Editor Functions ==========
    // A loaded .zip is unwrapped transparently, so these are not reached by opening
    // a ZIP — they build one: New ZIP, Add/Delete/Extract/Save, and cross-format copy
    // into a ZIP panel. Called from ~10 sites below; not dead code.

    function zipEditorNewZip(panel) {
        panel.blocks = [];
        panel.parsedFile = { type: 'zip', files: [], size: 0 };
        panel.fileType = 'zip';
        panel.rawData = new Uint8Array(0);
        panel.fileName = 'new.zip';
        panel.selection.clear();
        panel.expandedBlock = -1;
        panel.diskFiles = [];
        panel.diskLabel = '        ';
        panel.pendingFileData = null;
        ctx.updatePanelHeader(panel);
        zipEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function zipEditorRenderFileList(panel) {
        const files = (panel.parsedFile && panel.parsedFile.files) || [];

        if (files.length === 0) {
            panel.dom.fileList.innerHTML = '<span class="explorer-empty">Empty ZIP. Use "Add File" to add container files.</span>';
            panel.dom.statusSpan.textContent = '0 files';
            ctx.editorUpdateToolbar();
            return;
        }

        let totalSize = 0;
        ctx.editorRenderLabelBar(panel);
        let html = ctx.editorColHeaderHtml();
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const isSel = panel.selection.has(i);
            const ext = file.name.split('.').pop().toLowerCase();
            const badge = ext.toUpperCase();
            const size = file.data ? file.data.length : 0;
            totalSize += size;

            let rowClasses = 'editor-block-row zip-row';
            if (isSel) rowClasses += ' selected';

            html += `<div class="${rowClasses}" data-block-idx="${i}">`;
            html += '<span class="editor-block-info">';
            html += `<span class="dim">${i + 1}:</span>`;
            html += `<span class="file-name">${file.name}</span>`;
            html += `<span class="file-flag"></span>`;
            html += `<span class="file-ext">${badge}</span>`;
            html += `<span class="file-addr"></span>`;
            html += `<span class="file-size">${size}</span>`;
            html += '</span></div>';
        }

        panel.dom.fileList.innerHTML = html;

        const selCount = panel.selection.size;
        if (selCount > 0) {
            panel.dom.statusSpan.textContent = `${files.length} files, ${selCount} sel \u2014 ${totalSize.toLocaleString()} bytes`;
        } else {
            panel.dom.statusSpan.textContent = `${files.length} files \u2014 ${totalSize.toLocaleString()} bytes`;
        }
        ctx.editorUpdateToolbar();
    }

    function zipEditorAddFile(panel, fileData, fileName) {
        panel.parsedFile.files.push({ name: fileName, data: new Uint8Array(fileData) });
        panel.blocks = panel.parsedFile.files;
        zipEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function zipEditorDeleteFiles(panel) {
        if (panel.selection.size === 0) return;
        const sorted = ctx.editorSelectedSorted(panel).reverse();
        for (const idx of sorted) {
            panel.parsedFile.files.splice(idx, 1);
        }
        panel.blocks = panel.parsedFile.files;
        panel.selection.clear();
        panel.expandedBlock = -1;
        zipEditorRenderFileList(panel);
        ctx.syncPanelToExplorer(panel);
    }

    function zipEditorExtractFiles(panel, format) {
        const sorted = ctx.editorSelectedSorted(panel);
        if (sorted.length === 0) return;
        const files = panel.parsedFile.files;
        const baseName = (panel.fileName || 'extract').replace(/\.zip$/i, '');

        if (sorted.length === 1) {
            const file = files[sorted[0]];
            if (!file) return;
            downloadFile(file.name, file.data);
            return;
        }

        const zipFiles = sorted.map(idx => files[idx]).filter(f => f);
        if (zipFiles.length === 0) return;
        const zipData = ctx.editorCreateZip(zipFiles.map(f => ({ name: f.name, data: f.data })));
        downloadFile(baseName + '_extract.zip', zipData);
    }

    function zipEditorSaveZip(panel) {
        const files = (panel.parsedFile && panel.parsedFile.files) || [];
        if (files.length === 0) return;
        const zipData = ctx.editorCreateZip(files.map(f => ({ name: f.name, data: f.data })));
        const baseName = (panel.fileName || 'output').replace(/\.zip$/i, '');
        downloadFile(baseName + '.zip', zipData);
    }

    function buildSingleFileTap(file) {
        // Build header block: flag(0x00) + type + name(10) + length + param1 + param2
        const header = new Uint8Array(19);
        header[0] = 0x00; // flag
        header[1] = file.type & 0xFF;
        const padded = ((file.name || 'untitled') + '          ').substring(0, 10);
        for (let i = 0; i < 10; i++) {
            header[2 + i] = padded.charCodeAt(i);
        }
        header[12] = file.rawData.length & 0xFF;
        header[13] = (file.rawData.length >> 8) & 0xFF;
        let param1 = 0;
        if (file.type === 0) {
            param1 = (file.autostart !== null && file.autostart !== undefined && file.autostart !== '') ? (parseInt(file.autostart) & 0xFFFF) : 0x8000;
        } else if (file.type === 3) {
            param1 = (file.addr || 0) & 0xFFFF;
        }
        header[14] = param1 & 0xFF;
        header[15] = (param1 >> 8) & 0xFF;
        let param2 = (file.type === 0) ? file.rawData.length : 0x8000;
        header[16] = param2 & 0xFF;
        header[17] = (param2 >> 8) & 0xFF;
        ctx.editorRecalcChecksum(header);

        // Build data block: flag(0xFF) + rawData + checksum
        const dataBlock = new Uint8Array(file.rawData.length + 2);
        dataBlock[0] = 0xFF;
        dataBlock.set(file.rawData, 1);
        ctx.editorRecalcChecksum(dataBlock);

        // Wrap in TAP format: length prefix + block data
        const totalSize = 2 + header.length + 2 + dataBlock.length;
        const tap = new Uint8Array(totalSize);
        let offset = 0;
        tap[offset] = header.length & 0xFF;
        tap[offset + 1] = (header.length >> 8) & 0xFF;
        offset += 2;
        tap.set(header, offset);
        offset += header.length;
        tap[offset] = dataBlock.length & 0xFF;
        tap[offset + 1] = (dataBlock.length >> 8) & 0xFF;
        offset += 2;
        tap.set(dataBlock, offset);
        return tap;
    }

    return {
        buildSingleFileTap,
        didaktikEditorAddFile,
        didaktikEditorApplyInlineEdit,
        didaktikEditorDeleteSelection,
        didaktikEditorExtractFiles,
        didaktikEditorExtractSelection,
        didaktikEditorMarkDeletedSelection,
        didaktikEditorMoveSelection,
        didaktikEditorRefresh,
        didaktikEditorRenderFileList,
        didaktikEditorSave,
        diskEditorAddFile,
        diskEditorAddMdrFile,
        diskEditorAddMgtFile,
        diskEditorAddOpdFile,
        diskEditorApplyInlineEdit,
        diskEditorBannerCount,
        diskEditorBuildMdr,
        diskEditorDeleteSelection,
        diskEditorExtractOpdFiles,
        diskEditorExtractSelection,
        diskEditorMarkDeletedSelection,
        diskEditorMoveSelection,
        diskEditorNewDidaktik,
        diskEditorNewMdr,
        diskEditorNewMgt,
        diskEditorNewOpd,
        diskEditorNewTrd,
        diskEditorRefreshExplorer,
        diskEditorRenderFileList,
        diskEditorSaveDisk,
        diskEditorSaveMdr,
        diskEditorSaveMgt,
        diskEditorSaveOpd,
        dskEditorAddFile,
        dskEditorApplyInlineEdit,
        dskEditorDeleteFiles,
        dskEditorExtractFiles,
        dskEditorMarkDeletedSelection,
        dskEditorMoveSelection,
        dskEditorNewDsk,
        dskEditorRefreshState,
        dskEditorRenderFileList,
        dskEditorSaveDsk,
        editorBlockIsTurbo,
        editorBlockTurboable,
        editorConvertSelectionToTurbo,
        editorImportTzxData,
        editorNewTzx,
        editorOpenBannerDialog,
        editorReadTurboParams,
        editorSaveTzx,
        editorSplitMonoloader,
        mdrEditorApplyInlineEdit,
        mdrEditorRefreshExplorer,
        mdrEditorRenderFileList,
        mgtEditorApplyInlineEdit,
        mgtEditorRefreshExplorer,
        mgtEditorRenderFileList,
        mgtExtractCleanData,
        opdEditorApplyInlineEdit,
        opdEditorDeleteSelection,
        opdEditorExtractSelection,
        opdEditorRebuildImage,
        opdEditorRefreshExplorer,
        opdEditorRenderFileList,
        zipEditorAddFile,
        zipEditorDeleteFiles,
        zipEditorExtractFiles,
        zipEditorNewZip,
        zipEditorRenderFileList,
        zipEditorSaveZip,
        zipLoadInnerFile,
        zipShowPickDialog,
    };
}
