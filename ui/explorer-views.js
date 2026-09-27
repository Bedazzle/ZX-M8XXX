// explorer-views.js — the Explorer's Disk Map plus the hex, text, disassembly,
// ZIP and DSK views. Split out of ui/explorer.js.
//
// `ctx` carries the Explorer's shared state: getters for what this code reads,
// get/set pairs for the handful it writes (the current file, the basic-view mode,
// the disk-map selection), so `xp.explorerData = x` still writes through to the
// Explorer rather than to a copy.

import { hex8, hex16, escapeHtml, downloadFile } from '../core/utils.js';
// The Explorer shows two kinds of number that both follow the address switch: a
// load/start address, and an OFFSET into a .tap/.trd/.dsk. They are not the same
// thing, but a user who asked for decimal wants both -- an offset column left in
// hex beside a decimal load address reads as a bug. Bytes follow the value switch
// and the disassembly's byte column the opcode one, exactly as in the debugger.
// hex16 stays where a number is written OUT (an export filename), never shown.
import {
    fmtAddr, fmtAddrCol, fmtAddrH, fmtAddrSigil, fmtByte, fmtByteCol, byteColWidth,
    fmtOpcode, parseAddr, onNumberBaseChange
} from '../core/addr-format.js';
import { isFlowBreak } from './mnemonic-format.js';
import { BASIC_TOKENS, decodeBasicProgram } from '../core/basic-tokens.js';
import { SLOT1_START, SCREEN_SIZE, SCREEN_BITMAP_SIZE, SCREEN_ATTR_SIZE } from '../core/constants.js';
import { MGTLoader, MDRLoader, OPDLoader, DidaktikLoader } from '../core/loaders.js';
import { searchEncoded, searchNibblePacked, decodeAt } from '../core/encoded-search.js';

// The parameter is `xp`, not `ctx`: the disk-map drawing code has its own
// `const ctx = canvas.getContext(...)` in several functions, and that shadowed
// the state object - reads silently went to a 2D context.
export function initExplorerViews(xp) {

    // ========== Disk Map ==========

    // Curated file palette chosen to stay clear of the fixed sector-type colors
    // (gray reserved, gold directory, red error, dark free/empty) so a file is
    // never confused with a reserved/error sector.
    const DISKMAP_FILE_PALETTE = [
        '#3a9bdc', // sky blue
        '#5fbf60', // green
        '#a974d6', // lavender
        '#2fb6a8', // teal
        '#e066b3', // magenta
        '#5fd0e0', // light cyan
        '#b6d44a', // chartreuse
        '#8089e8', // periwinkle
        '#d98cc4', // orchid
        '#4fc3a1'  // mint
    ];

    function diskMapFileColor(index) {
        const pal = DISKMAP_FILE_PALETTE;
        const base = pal[index % pal.length];
        const cycle = Math.floor(index / pal.length);
        if (cycle === 0) return base;
        // For disks with more files than palette entries, shift lightness so the
        // repeated hue is still distinguishable from its first use.
        const delta = (cycle % 2 === 1) ? 22 : -22;
        const r = parseInt(base.slice(1, 3), 16);
        const g = parseInt(base.slice(3, 5), 16);
        const b = parseInt(base.slice(5, 7), 16);
        const adj = (v) => Math.max(0, Math.min(255, v + delta)).toString(16).padStart(2, '0');
        return `#${adj(r)}${adj(g)}${adj(b)}`;
    }

    function diskMapTypeColor(type) {
        switch (type) {
            case 'reserved': return '#555';
            case 'directory': return '#c89b2a';
            case 'file': return '#2a6'; // fallback, should use fileColor
            case 'free': return '#1a1a2e';
            case 'empty': return '#111';
            case 'data': return '#2a6';
            case 'error': return '#c33';
            default: return '#222';
        }
    }

    function buildTRDSectorMap(data, files) {
        const sectorsPerTrack = 16;
        const sectorSize = 256;
        const totalSectors = Math.floor(data.length / sectorSize);
        const numSides = 2;
        const numCylinders = Math.ceil(totalSectors / (sectorsPerTrack * numSides));
        const tracks = [];
        const fileNames = [];
        const fileColors = [];

        // Build sector-to-file reverse map
        // TRD: files have contiguous sectors starting at startTrack/startSector
        const sectorOwner = new Int16Array(totalSectors).fill(-1);
        const sectorFileIndex = new Int16Array(totalSectors).fill(-1);

        // Mark directory sectors (track 0, sectors 0-8 = first 9 sectors)
        // Sectors 0-7: directory entries, sector 8: disk info
        for (let s = 0; s < 9; s++) sectorOwner[s] = -2; // -2 = directory

        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            fileNames.push(f.name + '.' + f.ext);
            fileColors.push(diskMapFileColor(i));
            const startAbsolute = f.startTrack * sectorsPerTrack + f.startSector;
            for (let s = 0; s < f.sectors; s++) {
                const absIdx = startAbsolute + s;
                if (absIdx < totalSectors) {
                    sectorOwner[absIdx] = 0; // file
                    sectorFileIndex[absIdx] = i;
                }
            }
        }

        for (let cyl = 0; cyl < numCylinders; cyl++) {
            const trackEntry = { sides: [] };
            for (let head = 0; head < numSides; head++) {
                const sideEntry = { sectors: [] };
                for (let sec = 0; sec < sectorsPerTrack; sec++) {
                    // TRD layout: track 0 = cyl 0 side 0, track 1 = cyl 0 side 1, etc.
                    const logicalTrack = cyl * numSides + head;
                    const absIdx = logicalTrack * sectorsPerTrack + sec;
                    if (absIdx >= totalSectors) break;

                    const offset = absIdx * sectorSize;
                    // Check empty
                    let isEmpty = true;
                    if (offset + sectorSize <= data.length) {
                        const first = data[offset];
                        for (let b = 1; b < sectorSize; b++) {
                            if (data[offset + b] !== first) { isEmpty = false; break; }
                        }
                    }

                    let type, fileIndex = -1, fileName = '', blockNum = -1;
                    if (sectorOwner[absIdx] === -2) {
                        type = absIdx < 8 ? 'directory' : 'reserved';
                    } else if (sectorFileIndex[absIdx] >= 0) {
                        type = 'file';
                        fileIndex = sectorFileIndex[absIdx];
                        fileName = fileNames[fileIndex];
                    } else {
                        type = 'free';
                    }

                    sideEntry.sectors.push({
                        id: sec,
                        type,
                        fileIndex,
                        fileName,
                        blockNum,
                        hasError: false,
                        isEmpty,
                        diskOffset: offset
                    });
                }
                trackEntry.sides.push(sideEntry);
            }
            tracks.push(trackEntry);
        }

        return {
            tracks, numCylinders, numSides,
            maxSectorsPerTrack: sectorsPerTrack,
            isCPM: false, isFlat: true, flatSectorSize: sectorSize,
            fileColors, fileNames
        };
    }

    function buildMGTSectorMap(data, files, info) {
        const sectorsPerTrack = 10;
        const sectorSize = 512;
        const numSides = 2;
        const numCylinders = info ? info.tracks : (data.length === 819200 ? 80 : 40);
        const totalSectors = numCylinders * numSides * sectorsPerTrack;
        const tracks = [];
        const fileNames = [];
        const fileColors = [];

        // Build sector-to-file reverse map
        // G+DOS track byte: cylinder in bits 0-6, side in bit 7
        // Absolute sector index = (cyl * numSides + side) * sectorsPerTrack + (sector - 1)
        const sectorOwner = new Int16Array(totalSectors).fill(-1);
        const sectorFileIndex = new Int16Array(totalSectors).fill(-1);

        // Mark directory sectors (cyl 0-1, both sides = 40 sectors)
        for (let s = 0; s < 40; s++) sectorOwner[s] = -2; // directory

        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            fileNames.push(f.name);
            fileColors.push(diskMapFileColor(i));
            // Follow sector chain to map file sectors (SAM bitmap is unreliable for pairs)
            let curTrack = f.firstTrack;
            let curSector = f.firstSector;
            const isContig = f.type === 8; // SPECIAL uses contiguous sectors
            for (let s = 0; s < f.sectors && s < 2000; s++) {
                const cyl = curTrack & 0x7F;
                const side = (curTrack >> 7) & 1;
                const absIdx = (cyl * numSides + side) * sectorsPerTrack + (curSector - 1);
                if (absIdx >= 0 && absIdx < totalSectors) {
                    sectorOwner[absIdx] = 0;
                    sectorFileIndex[absIdx] = i;
                }
                const off = ((cyl * 2 + side) * 10 + (curSector - 1)) * sectorSize;
                if (isContig) {
                    curSector++;
                    if (curSector > 10) {
                        curSector = 1;
                        if ((curTrack & 0x80) === 0) curTrack |= 0x80;
                        else curTrack = (curTrack & 0x7F) + 1;
                    }
                } else if (off >= 0 && off + sectorSize <= data.length) {
                    curTrack = data[off + 510];
                    curSector = data[off + 511];
                    if (curTrack === 0 && curSector === 0) break; // end of chain
                } else {
                    break;
                }
            }
        }

        for (let cyl = 0; cyl < numCylinders; cyl++) {
            const trackEntry = { sides: [] };
            for (let head = 0; head < numSides; head++) {
                const sideEntry = { sectors: [] };
                for (let sec = 0; sec < sectorsPerTrack; sec++) {
                    const absIdx = (cyl * numSides + head) * sectorsPerTrack + sec;
                    if (absIdx >= totalSectors) break;
                    const offset = absIdx * sectorSize;

                    let isEmpty = true;
                    if (offset + sectorSize <= data.length) {
                        const first = data[offset];
                        for (let b = 1; b < sectorSize; b++) {
                            if (data[offset + b] !== first) { isEmpty = false; break; }
                        }
                    }

                    let type, fileIndex = -1, fileName = '';
                    if (sectorOwner[absIdx] === -2) {
                        type = 'directory';
                    } else if (sectorFileIndex[absIdx] >= 0) {
                        type = 'file';
                        fileIndex = sectorFileIndex[absIdx];
                        fileName = fileNames[fileIndex];
                    } else {
                        type = 'free';
                    }

                    sideEntry.sectors.push({
                        id: sec + 1, // MGT sectors are 1-based
                        type,
                        fileIndex,
                        fileName,
                        blockNum: -1,
                        hasError: false,
                        isEmpty,
                        diskOffset: offset
                    });
                }
                trackEntry.sides.push(sideEntry);
            }
            tracks.push(trackEntry);
        }

        return {
            tracks, numCylinders, numSides,
            maxSectorsPerTrack: sectorsPerTrack,
            isCPM: false, isFlat: true, flatSectorSize: sectorSize,
            fileColors, fileNames
        };
    }

    function buildOPDSectorMap(data, files, info) {
        const sectorsPerTrack = 18;
        const sectorSize = 256;
        const numSides = info ? info.sides : (data.length >= 368640 ? 2 : 1);
        const numCylinders = 40;
        const totalSectors = numCylinders * numSides * sectorsPerTrack;
        const tracks = [];
        const fileNames = [];
        const fileColors = [];

        const sectorOwner = new Int16Array(totalSectors).fill(-1);
        const sectorFileIndex = new Int16Array(totalSectors).fill(-1);

        // OPD: sector 0 = descriptor, sectors 1-7 = directory, sectors 8+ = data
        sectorOwner[0] = -3; // boot/descriptor
        for (let s = 1; s <= 7; s++) sectorOwner[s] = -2; // directory

        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            fileNames.push(f.name);
            fileColors.push(diskMapFileColor(i));
            // OPD files are contiguous: sectors from firstBlock+1 to lastBlock+1
            // block = sector - 1, so sector = block + 1
            if (f.firstBlock !== undefined && f.lastBlock !== undefined) {
                for (let blk = f.firstBlock; blk <= f.lastBlock; blk++) {
                    const sector = blk + 1; // block 7 = sector 8
                    if (sector < totalSectors) {
                        sectorOwner[sector] = 0;
                        sectorFileIndex[sector] = i;
                    }
                }
            }
        }

        for (let cyl = 0; cyl < numCylinders; cyl++) {
            const trackEntry = { sides: [] };
            for (let head = 0; head < numSides; head++) {
                const sideEntry = { sectors: [] };
                for (let sec = 0; sec < sectorsPerTrack; sec++) {
                    const absIdx = (cyl * numSides + head) * sectorsPerTrack + sec;
                    if (absIdx >= totalSectors) break;
                    const offset = absIdx * sectorSize;

                    let isEmpty = true;
                    if (offset + sectorSize <= data.length) {
                        const first = data[offset];
                        for (let b = 1; b < sectorSize; b++) {
                            if (data[offset + b] !== first) { isEmpty = false; break; }
                        }
                    }

                    let type, fileIndex = -1, fileName = '';
                    if (sectorOwner[absIdx] === -3) {
                        type = 'reserved'; // boot/descriptor
                    } else if (sectorOwner[absIdx] === -2) {
                        type = 'directory';
                    } else if (sectorFileIndex[absIdx] >= 0) {
                        type = 'file';
                        fileIndex = sectorFileIndex[absIdx];
                        fileName = fileNames[fileIndex];
                    } else {
                        type = 'free';
                    }

                    sideEntry.sectors.push({
                        id: sec,
                        type,
                        fileIndex,
                        fileName,
                        blockNum: -1,
                        hasError: false,
                        isEmpty,
                        diskOffset: offset
                    });
                }
                trackEntry.sides.push(sideEntry);
            }
            tracks.push(trackEntry);
        }

        return {
            tracks, numCylinders, numSides,
            maxSectorsPerTrack: sectorsPerTrack,
            isCPM: false, isFlat: true, flatSectorSize: sectorSize,
            fileColors, fileNames
        };
    }

    function buildDidaktikSectorMap(data, files, info) {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const sectorSize = 512;
        const sectorsPerTrack = (info && info.sectorsPerTrack) || 9;
        const numSides = (info && info.sides) || 2;
        const numCylinders = (info && info.tracks) || Math.floor((bytes.length / sectorSize) / (sectorsPerTrack * numSides)) || 1;
        const totalSectors = numCylinders * numSides * sectorsPerTrack;
        const tracks = [];
        const fileNames = [];
        const fileColors = [];

        const sectorOwner = new Int16Array(totalSectors).fill(-1);
        const sectorFileIndex = new Int16Array(totalSectors).fill(-1);
        const sectorBlock = new Int16Array(totalSectors).fill(-1);

        // MDOS layout: sector 0 = boot, sectors 1..(firstDir-1) = FAT, then the
        // directory sectors, then file data. The directory occupies sectors 6-13,
        // so sectors 1-5 hold the FAT.
        const dirSectors = DidaktikLoader.DIR_SECTORS;
        const firstDir = Math.min.apply(null, dirSectors);
        if (totalSectors > 0) sectorOwner[0] = -3; // boot
        for (let s = 1; s < firstDir && s < totalSectors; s++) sectorOwner[s] = -3; // FAT
        for (const ds of dirSectors) { if (ds < totalSectors) sectorOwner[ds] = -2; } // directory

        const maxG = Math.floor(bytes.length / sectorSize) + 4;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            fileNames.push(f.name);
            fileColors.push(diskMapFileColor(i));
            let sec = f.firstSec, guard = 0, block = 0;
            while (guard++ < maxG && sec >= 0 && sec < totalSectors) {
                if (sectorFileIndex[sec] < 0) {
                    sectorOwner[sec] = 0;
                    sectorFileIndex[sec] = i;
                    sectorBlock[sec] = block;
                }
                const nv = DidaktikLoader.getFATnum(bytes, sec);
                if (nv >= 0xC00) break;
                sec = nv; block++;
            }
        }

        for (let cyl = 0; cyl < numCylinders; cyl++) {
            const trackEntry = { sides: [] };
            for (let head = 0; head < numSides; head++) {
                const sideEntry = { sectors: [] };
                for (let sec = 0; sec < sectorsPerTrack; sec++) {
                    const absIdx = (cyl * numSides + head) * sectorsPerTrack + sec;
                    if (absIdx >= totalSectors) break;
                    const offset = absIdx * sectorSize;

                    let isEmpty = true;
                    if (offset + sectorSize <= bytes.length) {
                        const first = bytes[offset];
                        for (let b = 1; b < sectorSize; b++) {
                            if (bytes[offset + b] !== first) { isEmpty = false; break; }
                        }
                    }

                    let type, fileIndex = -1, fileName = '';
                    if (sectorOwner[absIdx] === -3) {
                        type = 'reserved';
                    } else if (sectorOwner[absIdx] === -2) {
                        type = 'directory';
                    } else if (sectorFileIndex[absIdx] >= 0) {
                        type = 'file';
                        fileIndex = sectorFileIndex[absIdx];
                        fileName = fileNames[fileIndex];
                    } else {
                        type = 'free';
                    }

                    sideEntry.sectors.push({
                        id: sec + 1,
                        type,
                        fileIndex,
                        fileName,
                        blockNum: sectorBlock[absIdx],
                        hasError: false,
                        isEmpty,
                        diskOffset: offset
                    });
                }
                trackEntry.sides.push(sideEntry);
            }
            tracks.push(trackEntry);
        }

        return {
            tracks, numCylinders, numSides,
            maxSectorsPerTrack: sectorsPerTrack,
            isCPM: false, isFlat: true, flatSectorSize: sectorSize,
            fileColors, fileNames
        };
    }

    function buildMDRSectorMap(data, files) {
        const bytes = new Uint8Array(data);
        const sectorCount = Math.floor(bytes.length / 543);
        // Split into rows of 32 sectors for a compact grid layout
        const sectorsPerTrack = 32;
        const numCylinders = Math.ceil(sectorCount / sectorsPerTrack);
        const numSides = 1;
        const tracks = [];
        const fileNames = [];
        const fileColors = [];

        // Build sector-to-file map from file list
        const sectorOwner = new Int16Array(sectorCount).fill(-1);
        const deletedFiles = new Set();
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            fileNames.push(f.name);
            fileColors.push(diskMapFileColor(i));
            if (f.deleted) deletedFiles.add(i);
            if (f.sectorIndices) {
                for (const si of f.sectorIndices) {
                    if (si >= 0 && si < sectorCount) {
                        sectorOwner[si] = i;
                    }
                }
            }
        }

        for (let cyl = 0; cyl < numCylinders; cyl++) {
            const trackEntry = { sides: [] };
            const sideEntry = { sectors: [] };
            const base = cyl * sectorsPerTrack;
            const count = Math.min(sectorsPerTrack, sectorCount - base);

            for (let sec = 0; sec < count; sec++) {
                const absIdx = base + sec;
                const off = absIdx * 543;
                const hdflag = bytes[off];
                const hdnumb = bytes[off + 1];
                const recflg = bytes[off + 15];

                // Determine sector type
                let type, fileIndex = -1, fileName = '';

                if (sectorOwner[absIdx] >= 0) {
                    type = 'file';
                    fileIndex = sectorOwner[absIdx];
                    fileName = fileNames[fileIndex];
                } else if (hdflag === 0 && recflg === 0) {
                    type = 'free';
                } else {
                    // Unowned MDR sector — treat as free (garbage/erased sectors not in any file)
                    type = 'free';
                }

                // Check if sector data is empty (all same byte)
                let isEmpty = true;
                const dataStart = off + 30;
                if (dataStart + 512 <= bytes.length) {
                    const first = bytes[dataStart];
                    for (let b = 1; b < 512; b++) {
                        if (bytes[dataStart + b] !== first) { isEmpty = false; break; }
                    }
                }

                sideEntry.sectors.push({
                    id: hdnumb,
                    type,
                    fileIndex,
                    fileName,
                    blockNum: -1,
                    hasError: false,
                    isEmpty,
                    mdrSectorIdx: absIdx
                });
            }
            trackEntry.sides.push(sideEntry);
            tracks.push(trackEntry);
        }

        return {
            tracks, numCylinders, numSides,
            maxSectorsPerTrack: sectorsPerTrack,
            totalSectors: sectorCount,
            isCPM: false, isMDR: true, flatSectorSize: 543,
            fileColors, fileNames, deletedFiles
        };
    }

    function buildDSKSectorMap(dskImage, spec, files) {
        const numCylinders = dskImage.numTracks;
        const numSides = dskImage.numSides;
        const isCPM = spec && (spec.valid || spec.recognized);
        const tracks = [];
        let maxSectorsPerTrack = 0;

        // Build block-to-file reverse map for CP/M disks
        const blockToFile = new Map();
        const fileNames = [];

        if (isCPM) {
            const dir = xp.DSKLoader._readDirectory(dskImage, spec);
            if (dir && dir.dirData) {
                const dirData = dir.dirData;
                const maxEntries = Math.floor(dirData.length / 32);
                const use16bit = spec.use16bit;

                // Collect unique files and their blocks
                const fileMap = new Map(); // "user:name.ext" -> index
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

                    const fileKey = `${user}:${name}.${ext}`;
                    if (!fileMap.has(fileKey)) {
                        fileMap.set(fileKey, fileNames.length);
                        fileNames.push(name + (ext ? '.' + ext : ''));
                    }
                    const fileIndex = fileMap.get(fileKey);

                    // Read allocation block numbers
                    if (use16bit) {
                        for (let j = 16; j < 32; j += 2) {
                            const blk = dirData[entryBase + j] | (dirData[entryBase + j + 1] << 8);
                            if (blk !== 0) blockToFile.set(blk, fileIndex);
                        }
                    } else {
                        for (let j = 16; j < 32; j++) {
                            if (dirData[entryBase + j] !== 0) {
                                blockToFile.set(dirData[entryBase + j], fileIndex);
                            }
                        }
                    }
                }
            }
        }

        // Calculate CP/M layout parameters
        const sectorSize = (spec && spec.sectorSize) || 512;
        const blockSize = (spec && spec.blockSize) || 1024;
        const sectorsPerBlock = Math.max(1, Math.round(blockSize / sectorSize));
        const reservedTracks = (spec && spec.reservedTracks) || 0;
        const sectorsPerTrack = (spec && spec.sectorsPerTrack) || 9;
        const dirBlocks = (spec && spec.dirBlocks) || 2;
        const sides = (spec && spec.sides) || 1;

        const firstDirBlock = 0;
        const lastDirBlock = dirBlocks - 1;

        // Iterate all physical cylinders and heads
        for (let cyl = 0; cyl < numCylinders; cyl++) {
            const trackEntry = { sides: [] };
            for (let head = 0; head < numSides; head++) {
                const track = dskImage.getTrack(cyl, head);
                const sideEntry = { sectors: [] };

                if (!track || track.sectors.length === 0) {
                    trackEntry.sides.push(sideEntry);
                    continue;
                }

                const sorted = [...track.sectors].sort((a, b) => a.id - b.id);
                if (sorted.length > maxSectorsPerTrack) maxSectorsPerTrack = sorted.length;

                for (let si = 0; si < sorted.length; si++) {
                    const sector = sorted[si];
                    const hasError = (sector.st1 !== 0) || (sector.st2 !== 0);

                    // Check if sector is empty (all same byte)
                    let isEmpty = true;
                    if (sector.data && sector.data.length > 0) {
                        const first = sector.data[0];
                        for (let b = 1; b < sector.data.length; b++) {
                            if (sector.data[b] !== first) { isEmpty = false; break; }
                        }
                    }

                    let type = 'free';
                    let fileIndex = -1;
                    let fileName = '';
                    let blockNum = -1;

                    if (isCPM) {
                        // Determine logical track from physical cylinder/head
                        const logicalTrack = (sides > 1) ? (cyl * sides + head) : cyl;

                        if (logicalTrack < reservedTracks) {
                            type = 'reserved';
                        } else {
                            // Map this sector to an allocation block
                            const logicalSectorIndex = sorted.indexOf(sector);
                            // Find which logical sector index this sector ID corresponds to
                            let logSec = -1;
                            const baseId = (spec && spec.firstSectorId !== undefined) ? spec.firstSectorId : sorted[0].id;
                            if (spec && spec.skewTable) {
                                for (let sk = 0; sk < spec.skewTable.length; sk++) {
                                    if (baseId + spec.skewTable[sk] === sector.id) { logSec = sk; break; }
                                }
                            } else {
                                logSec = sector.id - baseId;
                            }

                            if (logSec >= 0) {
                                const dataTrack = logicalTrack - reservedTracks;
                                const absoluteSector = dataTrack * sectorsPerTrack + logSec;
                                blockNum = Math.floor(absoluteSector / sectorsPerBlock);

                                if (blockNum >= firstDirBlock && blockNum <= lastDirBlock) {
                                    type = 'directory';
                                } else if (blockToFile.has(blockNum)) {
                                    type = 'file';
                                    fileIndex = blockToFile.get(blockNum);
                                    fileName = fileNames[fileIndex] || '';
                                } else {
                                    type = 'free';
                                }
                            }
                        }
                    } else {
                        // Non-CP/M disk
                        if (hasError) {
                            type = 'error';
                        } else if (isEmpty) {
                            type = 'empty';
                        } else {
                            type = 'data';
                        }
                        // Mark boot sector
                        if (cyl === 0 && head === 0 && si === 0) {
                            type = hasError ? 'error' : (isEmpty ? 'empty' : 'reserved');
                        }
                    }

                    // Override: FDC errors always shown
                    if (hasError && isCPM) {
                        // Keep the file assignment but flag the error
                    }

                    sideEntry.sectors.push({
                        id: sector.id,
                        type,
                        fileIndex,
                        fileName,
                        blockNum,
                        hasError,
                        isEmpty
                    });
                }
                trackEntry.sides.push(sideEntry);
            }
            tracks.push(trackEntry);
        }

        // Generate file colors
        const fileColors = [];
        for (let i = 0; i < fileNames.length; i++) {
            fileColors.push(diskMapFileColor(i));
        }

        return {
            tracks,
            numCylinders,
            numSides,
            maxSectorsPerTrack,
            isCPM,
            fileColors,
            fileNames
        };
    }

    function diskmapRenderSideGrid(tracks, numCylinders, side, maxSectorsPerTrack, fileColors, isMDR, deletedFiles) {
        let html = `<div class="diskmap-grid" style="grid-template-columns: 40px repeat(${maxSectorsPerTrack}, 18px)">`;

        // Column headers
        html += '<div class="diskmap-row-label"></div>';
        for (let s = 0; s < maxSectorsPerTrack; s++) {
            html += `<div class="diskmap-col-label">${s}</div>`;
        }

        for (let cyl = 0; cyl < numCylinders; cyl++) {
            const trackData = tracks[cyl];
            const sideData = trackData.sides[side];
            const rowLabel = isMDR ? `${cyl * maxSectorsPerTrack}` : `T${cyl}`;
            html += `<div class="diskmap-row-label">${rowLabel}</div>`;

            if (!sideData || sideData.sectors.length === 0) {
                for (let s = 0; s < maxSectorsPerTrack; s++) {
                    html += `<div class="diskmap-cell" style="background:#0a0a0a" data-cyl="${cyl}" data-head="${side}" data-sec="-1"></div>`;
                }
            } else {
                for (let si = 0; si < maxSectorsPerTrack; si++) {
                    if (si < sideData.sectors.length) {
                        const sec = sideData.sectors[si];
                        let color;
                        if (sec.type === 'file' && sec.fileIndex >= 0) {
                            color = fileColors[sec.fileIndex];
                        } else {
                            color = diskMapTypeColor(sec.type);
                        }
                        const errorBorder = sec.hasError ? '; outline: 1px solid #c33' : '';
                        const isDeleted = deletedFiles && deletedFiles.has(sec.fileIndex);
                        const dimStyle = isDeleted ? '; opacity: 0.35' : '';
                        const cellTitle = isMDR
                            ? `Sector ${cyl * maxSectorsPerTrack + si}${isDeleted ? ' [Deleted]' : ''}`
                            : `T${cyl} S${side} #$${hex8(sec.id)}`;
                        html += `<div class="diskmap-cell" style="background:${color}${errorBorder}${dimStyle}" data-cyl="${cyl}" data-head="${side}" data-sec="${si}" data-type="${sec.type}" data-file="${sec.fileIndex}" data-sid="${hex8(sec.id)}" title="${cellTitle}"></div>`;
                    } else {
                        html += `<div class="diskmap-cell" style="background:#0a0a0a"></div>`;
                    }
                }
            }
        }

        html += '</div>';
        return html;
    }

    function explorerRenderDiskMapGrid(sectorMap) {
        const { tracks, numCylinders, numSides, maxSectorsPerTrack, fileColors, isMDR, deletedFiles } = sectorMap;

        if (numSides > 1) {
            // Two-sided: render side-by-side columns
            let html = '<div class="diskmap-grid-wrapper">';
            html += `<div class="diskmap-grid-side"><div class="diskmap-side-label">Side 0</div>`;
            html += diskmapRenderSideGrid(tracks, numCylinders, 0, maxSectorsPerTrack, fileColors, isMDR, deletedFiles);
            html += '</div>';
            html += '<div class="diskmap-side-divider"></div>';
            html += `<div class="diskmap-grid-side"><div class="diskmap-side-label">Side 1</div>`;
            html += diskmapRenderSideGrid(tracks, numCylinders, 1, maxSectorsPerTrack, fileColors, isMDR, deletedFiles);
            html += '</div>';
            html += '</div>';
            xp.diskmapGridContainer.innerHTML = html;
        } else {
            // Single-sided: one grid
            xp.diskmapGridContainer.innerHTML = diskmapRenderSideGrid(tracks, numCylinders, 0, maxSectorsPerTrack, fileColors, isMDR, deletedFiles);
        }
    }

    function explorerRenderDiskMapRadial(sectorMap) {
        const { tracks, numCylinders, numSides, maxSectorsPerTrack, fileColors, deletedFiles } = sectorMap;
        const dpr = window.devicePixelRatio || 1;
        const diskSize = Math.min(380, Math.max(200, numCylinders * 4 + 80));
        const totalWidth = numSides > 1 ? diskSize * 2 + 20 : diskSize;

        xp.diskmapCanvas.width = totalWidth * dpr;
        xp.diskmapCanvas.height = diskSize * dpr;
        xp.diskmapCanvas.style.width = totalWidth + 'px';
        xp.diskmapCanvas.style.height = diskSize + 'px';

        const ctx = xp.diskmapCanvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, totalWidth, diskSize);

        for (let side = 0; side < numSides; side++) {
            const cx = numSides > 1 ? (side * (diskSize + 20) + diskSize / 2) : diskSize / 2;
            const cy = diskSize / 2;
            const outerRadius = diskSize / 2 - 4;
            const innerRadius = outerRadius * 0.2;
            const ringWidth = (outerRadius - innerRadius) / numCylinders;

            for (let cyl = 0; cyl < numCylinders; cyl++) {
                const trackData = tracks[cyl];
                const sideData = trackData.sides[side];
                // Outer ring = cylinder 0
                const rOuter = outerRadius - cyl * ringWidth;
                const rInner = rOuter - ringWidth + 0.5;

                if (!sideData || sideData.sectors.length === 0) continue;

                const numSec = sideData.sectors.length;
                const gapAngle = 0.02;
                const arcAngle = (2 * Math.PI - numSec * gapAngle) / numSec;

                for (let si = 0; si < numSec; si++) {
                    const sec = sideData.sectors[si];
                    const startAngle = -Math.PI / 2 + si * (arcAngle + gapAngle);
                    const endAngle = startAngle + arcAngle;

                    let color;
                    if (sec.type === 'file' && sec.fileIndex >= 0) {
                        color = fileColors[sec.fileIndex];
                    } else {
                        color = diskMapTypeColor(sec.type);
                    }

                    // Dim non-highlighted and deleted-file sectors
                    const isDeletedSec = deletedFiles && deletedFiles.has(sec.fileIndex);
                    if (xp.diskmapHighlightFile >= 0 && sec.fileIndex !== xp.diskmapHighlightFile) {
                        ctx.globalAlpha = 0.2;
                    } else if (isDeletedSec) {
                        ctx.globalAlpha = 0.35;
                    } else {
                        ctx.globalAlpha = 1;
                    }

                    ctx.beginPath();
                    ctx.arc(cx, cy, rOuter, startAngle, endAngle);
                    ctx.arc(cx, cy, rInner, endAngle, startAngle, true);
                    ctx.closePath();
                    ctx.fillStyle = color;
                    ctx.fill();

                    // Error indicator
                    if (sec.hasError) {
                        ctx.strokeStyle = '#c33';
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }

            ctx.globalAlpha = 1;

            // Center label
            ctx.fillStyle = '#888';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(numSides > 1 ? `Side ${side}` : '', cx, cy);

            // Center hole
            ctx.beginPath();
            ctx.arc(cx, cy, innerRadius * 0.6, 0, 2 * Math.PI);
            ctx.fillStyle = '#0a0a0a';
            ctx.fill();
        }
    }

    function explorerRenderDiskMapLegend(sectorMap) {
        const { isCPM, fileColors, fileNames, deletedFiles } = sectorMap;
        const hasFiles = fileNames && fileNames.length > 0;
        let html = '';

        if (hasFiles) {
            // Filesystem disk (CP/M, TR-DOS, MGT, OPD) — show structure + per-file colors
            html += `<span class="diskmap-legend-item" data-legend="reserved"><span class="diskmap-legend-swatch" style="background:#555"></span>Reserved</span>`;
            html += `<span class="diskmap-legend-item" data-legend="directory"><span class="diskmap-legend-swatch" style="background:#c89b2a"></span>Directory</span>`;
            html += `<span class="diskmap-legend-item" data-legend="free"><span class="diskmap-legend-swatch" style="background:#1a1a2e"></span>Free</span>`;
            if (!isCPM) {
                html += `<span class="diskmap-legend-item" data-legend="error"><span class="diskmap-legend-swatch" style="background:#c33"></span>Error</span>`;
            }
            for (let i = 0; i < fileNames.length; i++) {
                const isDeleted = deletedFiles && deletedFiles.has(i);
                const dimAttr = isDeleted ? ' style="opacity:0.45"' : '';
                const delTag = isDeleted ? ' <span style="color:var(--accent);font-size:0.85em">[Del]</span>' : '';
                html += `<span class="diskmap-legend-item" data-legend="file" data-file="${i}"${dimAttr}><span class="diskmap-legend-swatch" style="background:${fileColors[i]}"></span>${escapeHtml(fileNames[i])}${delTag}</span>`;
            }
        } else {
            // Non-filesystem disk (copy-protected games, raw data)
            html += `<span class="diskmap-legend-item" data-legend="reserved"><span class="diskmap-legend-swatch" style="background:#555"></span>Boot</span>`;
            html += `<span class="diskmap-legend-item" data-legend="data"><span class="diskmap-legend-swatch" style="background:#2a6"></span>Data</span>`;
            html += `<span class="diskmap-legend-item" data-legend="empty"><span class="diskmap-legend-swatch" style="background:#111"></span>Empty</span>`;
            html += `<span class="diskmap-legend-item" data-legend="error"><span class="diskmap-legend-swatch" style="background:#c33"></span>Error</span>`;
        }

        xp.diskmapLegend.innerHTML = html;
    }

    const DISKMAP_TYPES = ['dsk', 'trd', 'mgt', 'opd', 'mdr', 'didaktik'];

    function explorerRenderDiskMap() {
        if (!xp.explorerParsed || !DISKMAP_TYPES.includes(xp.explorerParsed.type)) {
            xp.diskmapGridContainer.innerHTML = '<div class="explorer-empty">Load a disk image (DSK, TRD, MGT, MDR, OPD, D40/D80) to view disk map</div>';
            xp.diskmapDiskContainer.style.display = 'none';
            xp.diskmapLegend.innerHTML = '';
            xp.diskmapInfo.textContent = '';
            xp.diskmapStatus.textContent = '';
            xp.diskmapSectorMap = null;
            return;
        }

        let sectorMap;
        const t = xp.explorerParsed.type;
        if (t === 'dsk') {
            if (!xp.explorerParsed.dskImage) {
                xp.diskmapGridContainer.innerHTML = '<div class="explorer-empty">DSK image could not be parsed</div>';
                xp.diskmapSectorMap = null;
                return;
            }
            sectorMap = buildDSKSectorMap(xp.explorerParsed.dskImage, xp.explorerParsed.diskSpec, xp.explorerParsed.files);
        } else if (t === 'trd') {
            sectorMap = buildTRDSectorMap(xp.explorerData, xp.explorerParsed.files);
        } else if (t === 'mgt') {
            sectorMap = buildMGTSectorMap(xp.explorerData, xp.explorerParsed.files, xp.explorerParsed.info);
        } else if (t === 'opd') {
            sectorMap = buildOPDSectorMap(xp.explorerData, xp.explorerParsed.files, xp.explorerParsed.info);
        } else if (t === 'mdr') {
            sectorMap = buildMDRSectorMap(xp.explorerData, xp.explorerParsed.files);
        } else if (t === 'didaktik') {
            sectorMap = buildDidaktikSectorMap(xp.explorerData, xp.explorerParsed.files, xp.explorerParsed.info);
        }

        xp.diskmapSectorMap = sectorMap;
        xp.diskmapHighlightFile = -1;

        explorerRenderDiskMapGrid(sectorMap);
        explorerRenderDiskMapRadial(sectorMap);
        explorerRenderDiskMapLegend(sectorMap);

        if (sectorMap.isMDR) {
            const total = sectorMap.totalSectors;
            const carts = total > 254 ? ` (${Math.ceil(total / 254)} cartridges)` : '';
            xp.diskmapStatus.textContent = `${total} sectors${carts}`;
        } else {
            xp.diskmapStatus.textContent = `${sectorMap.numCylinders} cyl \u00d7 ${sectorMap.numSides} side${sectorMap.numSides > 1 ? 's' : ''} \u00d7 ${sectorMap.maxSectorsPerTrack} sec/trk`;
        }
        xp.diskmapInfo.textContent = '';

        // Show correct view
        if (xp.diskmapCurrentView === 'grid') {
            xp.diskmapGridContainer.style.display = '';
            xp.diskmapDiskContainer.style.display = 'none';
        } else {
            xp.diskmapGridContainer.style.display = 'none';
            xp.diskmapDiskContainer.style.display = '';
        }
    }

    function diskmapGetSectorInfo(cyl, head, secIdx) {
        if (!xp.diskmapSectorMap || cyl < 0 || cyl >= xp.diskmapSectorMap.numCylinders) return null;
        const track = xp.diskmapSectorMap.tracks[cyl];
        if (!track || head < 0 || head >= track.sides.length) return null;
        const side = track.sides[head];
        if (!side || secIdx < 0 || secIdx >= side.sectors.length) return null;
        return side.sectors[secIdx];
    }

    function diskmapFormatInfo(sec, cyl, head) {
        if (!sec) return '';
        let info = (xp.diskmapSectorMap && xp.diskmapSectorMap.isMDR)
            ? `Sector ${sec.mdrSectorIdx !== undefined ? sec.mdrSectorIdx : cyl * 254 + head}, #${sec.id}`
            : `Track ${cyl}, Side ${head}, Sector $${hex8(sec.id)}`;
        if (sec.type === 'file' && sec.fileName) {
            info += ` \u2014 ${sec.fileName}`;
            if (sec.blockNum >= 0) info += ` (block ${sec.blockNum})`;
        } else if (sec.type === 'directory') {
            info += ' \u2014 Directory';
        } else if (sec.type === 'reserved') {
            info += ' \u2014 Reserved/Boot';
        } else if (sec.type === 'free') {
            info += ' \u2014 Free';
        } else if (sec.type === 'error') {
            info += ' \u2014 FDC Error';
        } else if (sec.type === 'empty') {
            info += ' \u2014 Empty';
        } else if (sec.type === 'data') {
            info += ' \u2014 Data';
        }
        if (sec.hasError) info += ' [ERROR]';
        return info;
    }

    function diskmapApplyHighlight(fileIndex) {
        // Grid highlight
        const cells = xp.diskmapGridContainer.querySelectorAll('.diskmap-cell');
        cells.forEach(cell => {
            const f = parseInt(cell.dataset.file);
            if (fileIndex < 0) {
                cell.classList.remove('dimmed');
            } else {
                cell.classList.toggle('dimmed', f !== fileIndex);
            }
        });

        // Legend highlight
        const items = xp.diskmapLegend.querySelectorAll('.diskmap-legend-item');
        items.forEach(item => {
            if (fileIndex < 0) {
                item.classList.remove('dimmed');
            } else {
                const itemFile = item.dataset.file !== undefined ? parseInt(item.dataset.file) : -2;
                item.classList.toggle('dimmed', itemFile !== fileIndex);
            }
        });

        // Radial highlight
        xp.diskmapHighlightFile = fileIndex;
        if (xp.diskmapSectorMap) explorerRenderDiskMapRadial(xp.diskmapSectorMap);
    }

    function diskmapNavigateToSector(cyl, head, secIdx) {
        if (!xp.explorerParsed || !xp.diskmapSectorMap) return;
        const sec = diskmapGetSectorInfo(cyl, head, secIdx);
        if (!sec) return;

        let sectorData = null;
        let sectorValue, label;

        if (xp.diskmapSectorMap.isMDR && xp.explorerData && sec.mdrSectorIdx !== undefined) {
            // MDR cartridge: each sector is 543 bytes (15 hdr + 528 record)
            const offset = sec.mdrSectorIdx * 543;
            const size = 543;
            if (offset + size <= xp.explorerData.length) {
                sectorData = xp.explorerData.slice(offset, offset + size);
            }
            sectorValue = `sector:mdr:${sec.mdrSectorIdx}`;
            label = `MDR Sector ${sec.mdrSectorIdx} #${sec.id} (543 bytes)`;
        } else if (xp.diskmapSectorMap.isFlat && xp.explorerData) {
            // Flat image (TRD/MGT/OPD): read sector by byte offset
            const offset = sec.diskOffset;
            const size = xp.diskmapSectorMap.flatSectorSize;
            if (offset + size <= xp.explorerData.length) {
                sectorData = xp.explorerData.slice(offset, offset + size);
            }
            sectorValue = `sector:flat:${offset}:${size}`;
            label = `Sector T${cyl} S${head} #${sec.id} (${size} bytes @ ${fmtAddrSigil(offset)})`;
        } else if (xp.explorerParsed.dskImage) {
            // DSK: use C/H/R addressing
            sectorData = xp.explorerParsed.dskImage.readSector(cyl, head, sec.id);
            sectorValue = `sector:${cyl}:${head}:${sec.id}`;
            label = `Sector T${cyl} S${head} #$${hex8(sec.id)} (${sectorData ? sectorData.length : 0} bytes)`;
        }

        if (!sectorData) return;

        // Add a temporary sector source option to the hex source selector
        for (let i = xp.explorerHexSource.options.length - 1; i >= 0; i--) {
            if (xp.explorerHexSource.options[i].value.startsWith('sector:')) {
                xp.explorerHexSource.remove(i);
            }
        }
        const opt = document.createElement('option');
        opt.value = sectorValue;
        opt.textContent = label;
        xp.explorerHexSource.appendChild(opt);
        xp.explorerHexSource.value = sectorValue;

        xp.explorerHexAddr.value = '0000';
        xp.explorerHexLen.value = sectorData.length.toString();

        // Switch to hex dump tab and render
        document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
        explorerRenderHexDump();
    }

    function explorerRenderDSKInfo() {
        if (xp.explorerParsed.error) {
            return `<div class="explorer-info-section">
                <div class="explorer-info-header">DSK Disk Image</div>
                <div style="color:#e74c3c">Error: ${xp.explorerParsed.error}</div>
            </div>`;
        }

        const dskContainer = xp.explorerParsed.isExtended ? 'Extended' : 'Standard';
        const spec = xp.explorerParsed.diskSpec;
        const diskSystem = spec && spec.isTOS ? 'Timex FDD3000' : 'CPC';
        const formatType = `${dskContainer} ${diskSystem} DSK`;
        const geometry = `${xp.explorerParsed.numTracks} tracks, ${xp.explorerParsed.numSides} side${xp.explorerParsed.numSides > 1 ? 's' : ''}`;

        let sectorInfo = '';
        if (xp.explorerParsed.dskImage) {
            const t0 = xp.explorerParsed.dskImage.getTrack(0, 0);
            if (t0 && t0.sectors.length > 0) {
                const sectorSize = t0.sectors[0].data.length;
                sectorInfo = `${t0.sectors.length} sectors/track, ${sectorSize} bytes/sector`;
            }
        }

        let specRows = '';
        if (spec) {
            specRows += `<tr><th>Block size</th><td>${spec.blockSize} bytes</td></tr>`;
            specRows += `<tr><th>Reserved</th><td>${spec.reservedTracks} track${spec.reservedTracks !== 1 ? 's' : ''}</td></tr>`;
        }

        const protection = xp.detectDiskProtection(xp.explorerParsed.dskImage);

        // Extract disk label from CP/M directory (user=0xFF for TOS, user=0x20 for CP/M 3.0)
        let diskLabel = null;
        if (spec && (spec.valid || spec.recognized) && xp.explorerParsed.dskImage) {
            const dir = xp.DSKLoader._readDirectory(xp.explorerParsed.dskImage, spec);
            if (dir && dir.dirData) {
                const maxEntries = Math.floor(dir.dirData.length / 32);
                for (let i = 0; i < maxEntries; i++) {
                    const user = dir.dirData[i * 32];
                    if (user === 0xFF || user === 0x20) {
                        let lbl = '';
                        for (let j = 1; j <= 11; j++) {
                            const ch = dir.dirData[i * 32 + j] & 0x7F;
                            if (j === 9 && lbl.trimEnd().length > 0) lbl = lbl.trimEnd() + '.';
                            if (ch >= 0x20) lbl += String.fromCharCode(ch);
                        }
                        diskLabel = lbl.trimEnd();
                        if (diskLabel.endsWith('.')) diskLabel = diskLabel.slice(0, -1);
                        break;
                    }
                }
            }
        }

        const bootInfo = xp.explorerParsed.files.length === 0 && !(spec && (spec.valid || spec.recognized))
            ? xp.detectBootloader(xp.explorerParsed.dskImage, spec)
            : null;

        const filesLabel = xp.explorerParsed.files.length === 0
            ? (spec && (spec.valid || spec.recognized)
                ? ' <span style="color:var(--text-secondary)">(empty disk)</span>'
                : (bootInfo
                    ? ' <span style="color:var(--text-secondary)">(non-CP/M disk)</span>'
                    : ' <span style="color:var(--text-secondary)">(non-CP/M or empty disk)</span>'))
            : '';

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">DSK Disk Image</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${xp.explorerData.length} bytes</td></tr>
                <tr><th>Format</th><td>${formatType}</td></tr>
                <tr><th>Geometry</th><td>${geometry}</td></tr>
                ${sectorInfo ? `<tr><th>Sectors</th><td>${sectorInfo}</td></tr>` : ''}
                ${specRows}
                ${diskLabel ? `<tr><th>Label</th><td>${escapeHtml(diskLabel)}</td></tr>` : ''}
                ${protection ? `<tr><th>Protection</th><td style="color:var(--yellow)">${escapeHtml(protection)}</td></tr>` : ''}
                <tr><th>Files</th><td>${xp.explorerParsed.files.length}${filesLabel}</td></tr>
            </table>
        </div>`;

        if (bootInfo) {
            const bootData = bootInfo.codeData;
            const baseAddr = 0xFE10;
            const fakeMemory = { read: (a) => {
                const off = a - baseAddr;
                return off >= 0 && off < bootData.length ? bootData[off] : 0;
            }};
            const disasm = new xp.Disassembler(fakeMemory);
            const romLabels = xp.getRomLabels();
            let bootHtml = '';
            let offset = 0;
            let instrCount = 0;
            while (offset < bootData.length && instrCount < 8) {
                const currentAddr = baseAddr + offset;
                const result = disasm.disassemble(currentAddr);
                const instrLen = result.length || 1;
                const bytesHex = result.bytes.map(b => fmtOpcode(b)).join(' ');
                let mnemonic = result.mnemonic || '???';
                const addrMatch = mnemonic.match(/([0-9A-F]{4})h/i);
                if (addrMatch) {
                    const targetAddr = parseInt(addrMatch[1], 16);
                    const label = romLabels[targetAddr];
                    if (label) {
                        mnemonic = mnemonic.replace(addrMatch[0], `<span class="dl">${label}</span>`);
                    }
                }
                bootHtml += `<span class="da">${fmtAddrCol(currentAddr)}</span>  <span class="dm">${mnemonic.padEnd(20)}</span> <span class="db">; ${bytesHex}</span>\n`;
                instrCount++;
                offset += instrLen;
                // Stop after unconditional JP or JR (not conditional)
                const plain = mnemonic.replace(/<[^>]+>/g, '').trim().toUpperCase();
                if (/^JP\s+[0-9A-F]{4}H$/i.test(plain) || /^JR\s+[0-9A-F]{4}H$/i.test(plain) ||
                    /^JP\s+\(HL\)$/i.test(plain) || /^JP\s+\(IX\)$/i.test(plain) || /^JP\s+\(IY\)$/i.test(plain)) {
                    break;
                }
                // Also stop on JP/JR to a label
                if (/^JP\s+<span/i.test(mnemonic.trim()) || /^JR\s+<span/i.test(mnemonic.trim())) {
                    break;
                }
            }

            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Boot Sector</div>
                <div style="margin-bottom:4px">Boot sector contains executable code</div>
                <pre class="explorer-disasm" style="margin:0 0 6px 0">${bootHtml}</pre>
                <span class="explorer-boot-disasm-link" style="color:var(--accent);cursor:pointer;text-decoration:underline">View in Disasm tab</span>
            </div>`;
        }

        if (xp.explorerParsed.files.length > 0) {
            const plus3TypeNames = { 0: 'BASIC', 1: 'Num array', 2: 'Char array', 3: 'Code' };
            html += `<div class="explorer-info-section">
                <div class="explorer-info-header">Files</div>
                <div class="explorer-file-list">`;

            let afterDir = false;
            for (let i = 0; i < xp.explorerParsed.files.length; i++) {
                const file = xp.explorerParsed.files[i];
                const isDir = file.ext && file.ext.toUpperCase() === 'DIR';
                if (isDir) afterDir = true;

                let typeStr;
                if (isDir) {
                    typeStr = 'DIR';
                } else if (file.headerSize) {
                    typeStr = plus3TypeNames[file.plus3Type] || 'File';
                } else {
                    typeStr = file.ext || 'File';
                }

                let detail = '';
                if (file.plus3Type === 3 && file.loadAddress !== undefined) {
                    // "1234 ($04D2)" gives the value both ways; in decimal that is the same
                    // number twice, so the pair collapses to one.
                    detail = fmtAddr(file.loadAddress) === String(file.loadAddress)
                        ? `${file.loadAddress}`
                        : `${file.loadAddress} ($${hex16(file.loadAddress)})`;
                } else if (file.plus3Type === 0 && file.autostart !== undefined && file.autostart < 32768) {
                    detail = 'LINE ' + file.autostart;
                }

                const sectors = file.blocks * Math.max(1, Math.round((spec ? spec.blockSize : 1024) / (spec ? spec.sectorSize : 512)));
                const previewable = file.size === SCREEN_SIZE || file.size === SCREEN_BITMAP_SIZE || file.size === 4096 ||
                    file.size === 2048 || file.size === SCREEN_ATTR_SIZE || file.size === 9216 ||
                    file.size === 11136 || file.size === 12288 || file.size === 18432;
                const previewIcon = !previewable ? '' : file.size === SCREEN_ATTR_SIZE ? '\uD83D\uDD24' : '\uD83D\uDDBC\uFE0F';
                const dirChildClass = (afterDir && !isDir) ? ' dir-child' : '';

                const displayName = isDir ? file.name : `${file.name}${file.ext ? '.' + file.ext : ''}`;

                html += `<div class="explorer-file-entry${dirChildClass}" data-index="${i}">
                    <span class="explorer-file-num">${i + 1}</span>
                    <span class="explorer-file-type" title="${typeStr}">${typeStr}</span>
                    <span class="explorer-file-name">${displayName}</span>
                    <span class="explorer-file-size">${isDir ? '' : file.size}</span>
                    <span class="explorer-file-addr">${detail}</span>
                    <span class="explorer-file-preview">${previewIcon}</span>
                    <span class="explorer-file-sectors">${isDir ? '' : sectors + ' sector' + (sectors !== 1 ? 's' : '')}</span>
                </div>`;
            }

            html += '</div></div>';
        }

        return html;
    }

    function explorerRenderZIPInfo() {
        if (xp.explorerParsed.error) {
            return `<div class="explorer-info-section">
                <div class="explorer-info-header">ZIP Archive</div>
                <div style="color:#e74c3c">Error: ${xp.explorerParsed.error}</div>
            </div>`;
        }

        let html = `<div class="explorer-info-section">
            <div class="explorer-info-header">ZIP Archive</div>
            <table class="explorer-info-table">
                <tr><th>Size</th><td>${xp.explorerData.length.toLocaleString()} bytes</td></tr>
                <tr><th>Files</th><td>${xp.explorerParsed.files.length}</td></tr>
            </table>`;
        if (xp.explorerParsed.warning) {
            html += `<div style="color:#e7a33c;margin-top:6px">${escapeHtml(xp.explorerParsed.warning)}</div>`;
        }
        html += `</div>`;

        html += `<div class="explorer-info-section">
            <div class="explorer-info-header">File List <span style="font-size:10px;color:var(--text-secondary)">(click to open)</span></div>
            <div class="explorer-block-list">`;

        const supportedZipExts = ['tap', 'tzx', 'sna', 'z80', 'trd', 'scl', 'mgt', 'img', 'mdr', 'opd', 'opu', 'dsk', 'rzx'];
        for (let i = 0; i < xp.explorerParsed.files.length; i++) {
            const file = xp.explorerParsed.files[i];
            const ext = file.name.split('.').pop().toLowerCase();
            if (!supportedZipExts.includes(ext)) continue;
            if (ext === 'img' && file.size !== 819200 && file.size !== 409600) continue;

            let extraInfo = '';
            if (ext === 'rzx' && file.data && file.data.length > 10) {
                extraInfo = ' <span style="color:var(--cyan)">[RZX]</span>';
            }

            html += `<div class="explorer-block explorer-zip-file" data-zip-index="${i}" style="cursor:pointer">
                <span class="explorer-block-num">${i + 1}</span>
                <span class="explorer-block-type">${ext.toUpperCase()}</span>
                <span class="explorer-block-name">${file.name}${extraInfo}</span>
                <span class="explorer-block-size">${file.size.toLocaleString()} bytes</span>
            </div>`;
        }

        html += '</div></div>';
        return html;
    }

    // Handle RZX decode mode change
    xp.explorerInfoOutput.addEventListener('change', (e) => {
        if (e.target.id === 'rzxDecodeMode') {
            setRzxDecodeMode(e.target.value);
            if (xp.explorerParsed && xp.explorerParsed.type === 'rzx') {
                xp.explorerInfoOutput.innerHTML = xp.explorerRenderRZXInfo();
                const dropdown = document.getElementById('rzxDecodeMode');
                if (dropdown) dropdown.value = getRzxDecodeMode();
            }
        }
    });

    // Handle clicking on ZIP file entries and TAP blocks
    xp.explorerInfoOutput.addEventListener('click', async (e) => {
        // Packed screen (📦-marked): clicking the row re-shows it from the cache the
        // marking pass built — works for both tape (data-block-index) and disk (data-index)
        // rows, and lets the user switch between multiple packed screens.
        const packedRow = e.target.closest('.explorer-block[data-block-index], .explorer-file-entry[data-index]');
        if (packedRow) {
            const pIdx = parseInt(packedRow.dataset.blockIndex ?? packedRow.dataset.index);
            const cached = xp.explorerPackedCache.get(pIdx);
            if (cached) { xp.explorerShowPackedScreen(cached.hit, cached.label); return; }
        }

        const bootLink = e.target.closest('.explorer-boot-disasm-link');
        if (bootLink && xp.explorerParsed && xp.explorerParsed.type === 'dsk') {
            document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
            xp.explorerDisasmSource.value = 'boot';
            xp.explorerDisasmAddr.value = 'FE10';
            xp.explorerDisasmLen.value = 496;
            explorerRenderDisasm();
            return;
        }

        const zipEntry = e.target.closest('.explorer-zip-file');
        if (zipEntry) {
            const idx = parseInt(zipEntry.dataset.zipIndex);
            if (isNaN(idx) || !xp.explorerZipFiles[idx]) return;

            const zipFile = xp.explorerZipFiles[idx];
            const ext = zipFile.name.split('.').pop().toLowerCase();

            if (!['tap', 'tzx', 'sna', 'z80', 'trd', 'scl', 'mgt', 'img', 'mdr', 'opd', 'opu', 'd40', 'd80', 'dsk', 'rzx'].includes(ext)) return;

            xp.explorerZipParentName = xp.explorerFileName.textContent;
            xp.explorerData = new Uint8Array(zipFile.data);
            xp.explorerFileName.textContent = `${xp.explorerZipParentName} > ${zipFile.name}`;
            xp.explorerFileSize.textContent = `(${xp.explorerData.length.toLocaleString()} bytes)`;
            const isMgtSize = xp.explorerData.length === 819200 || xp.explorerData.length === 409600;
            xp.explorerFileType = (ext === 'img' && isMgtSize) ? 'mgt' : ext;

            await xp.explorerParseFile(zipFile.name, ext);

            xp.explorerBasicOutput.innerHTML = '<div class="explorer-empty">Select a BASIC program source</div>';
            xp.explorerDisasmOutput.innerHTML = '<div class="explorer-empty">Select a source to disassemble</div>';
            xp.explorerHexOutput.innerHTML = '';
            xp.explorerTextOutput.innerHTML = '<span class="explorer-empty">Select a source and click View</span>';

            xp.explorerRenderFileInfo();
            return;
        }

        const blockEntry = e.target.closest('.explorer-block[data-block-index]');
        if (blockEntry && xp.explorerParsed && xp.explorerParsed.type === 'tap') {
            const idx = parseInt(blockEntry.dataset.blockIndex);
            if (isNaN(idx) || !xp.explorerBlocks[idx]) return;

            const block = xp.explorerBlocks[idx];

            // Resolve the data block: the clicked data block, or the data block following a
            // clicked header — so clicking the header OR the data row previews the screen.
            const dataIdx = block.blockType === 'data' ? idx
                : (idx + 1 < xp.explorerBlocks.length && xp.explorerBlocks[idx + 1].blockType === 'data') ? idx + 1 : -1;
            if (dataIdx >= 0 && xp.explorerBlocks[dataIdx].data && xp.explorerBlocks[dataIdx].data.length > 2) {
                const content = xp.explorerBlocks[dataIdx].data.slice(1, xp.explorerBlocks[dataIdx].data.length - 1);
                const contentLen = content.length;
                if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                    contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                    contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                    const hdr = dataIdx > 0 ? xp.explorerBlocks[dataIdx - 1] : null;
                    const fLabel = (hdr && hdr.name) ? hdr.name : `#${dataIdx + 1}`;
                    xp.explorerUpdatePreview(content, null, fLabel);
                    return;
                }
            }

            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();

            if (block.blockType === 'data') {
                xp.explorerHexSource.value = idx.toString();
            } else {
                if (idx + 1 < xp.explorerBlocks.length && xp.explorerBlocks[idx + 1].blockType === 'data') {
                    xp.explorerHexSource.value = (idx + 1).toString();
                }
            }

            const dataLen = block.length - 2;
            xp.explorerHexLen.value = Math.min(dataLen, 65536);
            xp.explorerHexAddr.value = '0000';

            explorerRenderHexDump();
        }

        if (blockEntry && xp.explorerParsed && xp.explorerParsed.type === 'tzx') {
            const idx = parseInt(blockEntry.dataset.blockIndex);
            if (isNaN(idx) || !xp.explorerBlocks[idx]) return;

            const block = xp.explorerBlocks[idx];

            // Only handle standard speed data blocks (0x10)
            if (block.id !== 0x10) return;

            // Screen-size data → preview
            if (block.dataBlock && block.data && block.data.length > 2) {
                const content = block.data.slice(1, block.data.length - 1);
                const contentLen = content.length;
                if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                    contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                    contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                    const prevBlock = idx > 0 ? xp.explorerBlocks[idx - 1] : null;
                    const fLabel = (prevBlock && prevBlock.fileName) ? prevBlock.fileName : `#${idx + 1}`;
                    xp.explorerUpdatePreview(content, null, fLabel);
                    return;
                }
            }

            // Header whose following data block is a screen → preview too, so clicking the
            // named header behaves the same as clicking its data block.
            if ((block.headerTypeId === 0 || block.headerTypeId === 3) && idx + 1 < xp.explorerBlocks.length) {
                const db = xp.explorerBlocks[idx + 1];
                if (db && db.dataBlock && db.data && db.data.length > 2) {
                    const content = db.data.slice(1, db.data.length - 1);
                    const contentLen = content.length;
                    if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                        contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                        contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                        xp.explorerUpdatePreview(content, null, block.fileName || `#${idx + 1}`);
                        return;
                    }
                }
            }

            // Program header → BASIC tab
            if (block.headerTypeId === 0) {
                document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
                xp.explorerBasicSource.value = idx.toString();
                explorerRenderBASIC();
                return;
            }

            // Bytes header → Disasm tab
            if (block.headerTypeId === 3) {
                document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
                xp.explorerDisasmSource.value = idx.toString();
                xp.explorerDisasmAddr.value = fmtAddr(block.startAddress);
                xp.explorerDisasmLen.value = Math.min(block.fileLength, 4096);
                explorerRenderDisasm();
                return;
            }

            // Data block → hex dump
            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
            if (block.dataBlock) {
                xp.explorerHexSource.value = idx.toString();
            } else if (idx + 1 < xp.explorerBlocks.length && (xp.explorerBlocks[idx + 1].id === 0x10 || xp.explorerBlocks[idx + 1].id === 0x11) && xp.explorerBlocks[idx + 1].dataBlock) {
                xp.explorerHexSource.value = (idx + 1).toString();
            }
            xp.explorerHexLen.value = Math.min(block.dataLength || block.length, 65536);
            xp.explorerHexAddr.value = '0000';
            explorerRenderHexDump();
        }

        const trdEntry = e.target.closest('.explorer-file-entry[data-index]');
        if (trdEntry && xp.explorerParsed && (xp.explorerParsed.type === 'trd' || xp.explorerParsed.type === 'scl' || xp.explorerParsed.type === 'mgt' || xp.explorerParsed.type === 'mdr')) {
            const idx = parseInt(trdEntry.dataset.index);
            if (isNaN(idx) || !xp.explorerParsed.files[idx]) return;

            const file = xp.explorerParsed.files[idx];
            let fileData = xp.explorerParsed.type === 'mgt'
                ? MGTLoader.extractFile(xp.explorerData, file)
                : xp.explorerParsed.type === 'mdr'
                ? MDRLoader.extractFile(xp.explorerData, file)
                : xp.explorerData.slice(file.offset, file.offset + file.length);

            // MDR extractFile returns raw data including 9-byte Spectrum header — strip it
            if (xp.explorerParsed.type === 'mdr' && !file.isPrint && fileData.length > 9) {
                fileData = fileData.slice(9);
            }

            const contentLen = fileData.length;
            if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                const fLabel = file.name ? (file.ext && !['C','B','D','F','P'].includes(file.ext) ? `${file.name}.${file.ext}` : file.name) : `#${idx + 1}`;
                xp.explorerUpdatePreview(fileData, null, fLabel);
                return;
            }

            if (file.ext === 'B') {
                document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
                xp.explorerBasicSource.value = idx.toString();
                explorerRenderBASIC();
                return;
            }

            if (file.ext === 'C') {
                document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
                xp.explorerDisasmSource.value = idx.toString();
                xp.explorerDisasmAddr.value = fmtAddr(file.startAddress);
                xp.explorerDisasmLen.value = Math.min(file.length, 4096);
                explorerRenderDisasm();
                return;
            }

            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
            xp.explorerHexSource.value = idx.toString();
            // TR-DOS/SCL: default to the full sector allocation so monoloaders
            // (BASIC loader + appended CODE) show their whole payload, not just
            // the declared BASIC length.
            const hexFullLen = (xp.explorerParsed.type === 'trd' || xp.explorerParsed.type === 'scl')
                ? file.sectors * 256 : file.length;
            xp.explorerHexLen.value = Math.min(hexFullLen, 65536);
            xp.explorerHexAddr.value = '0000';
            explorerRenderHexDump();
        }

        const opdEntry = e.target.closest('.explorer-file-entry[data-index]');
        if (opdEntry && xp.explorerParsed && xp.explorerParsed.type === 'opd') {
            const idx = parseInt(opdEntry.dataset.index);
            if (isNaN(idx) || !xp.explorerParsed.files[idx]) return;

            const file = xp.explorerParsed.files[idx];
            const rawData = OPDLoader.extractFile(xp.explorerData, file);
            if (!rawData || rawData.length === 0) return;
            const fileData = file.length < rawData.length ? rawData.slice(0, file.length) : rawData;

            const contentLen = fileData.length;
            if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                const fLabel = file.name ? (file.ext && !['C','B','D','F','P'].includes(file.ext) ? `${file.name}.${file.ext}` : file.name) : `#${idx + 1}`;
                xp.explorerUpdatePreview(fileData, null, fLabel);
                return;
            }

            if (file.ext === 'B') {
                document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
                xp.explorerBasicSource.value = idx.toString();
                explorerRenderBASIC();
                return;
            }

            if (file.ext === 'C') {
                document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
                xp.explorerDisasmSource.value = idx.toString();
                xp.explorerDisasmAddr.value = fmtAddr(file.startAddr);
                xp.explorerDisasmLen.value = Math.min(file.length, 4096);
                explorerRenderDisasm();
                return;
            }

            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
            xp.explorerHexSource.value = idx.toString();
            xp.explorerHexLen.value = Math.min(file.length, 65536);
            xp.explorerHexAddr.value = '0000';
            explorerRenderHexDump();
            return;
        }

        const didaktikEntry = e.target.closest('.explorer-file-entry[data-index]');
        if (didaktikEntry && xp.explorerParsed && xp.explorerParsed.type === 'didaktik') {
            const idx = parseInt(didaktikEntry.dataset.index);
            if (isNaN(idx) || !xp.explorerParsed.files[idx]) return;

            const file = xp.explorerParsed.files[idx];
            const rawData = DidaktikLoader.extractFile(xp.explorerData, file);
            if (!rawData || rawData.length === 0) return;
            const fileData = file.length < rawData.length ? rawData.slice(0, file.length) : rawData;

            const contentLen = fileData.length;
            if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                xp.explorerUpdatePreview(fileData, null, file.name || `#${idx + 1}`);
                return;
            }
            // MDOS: P = BASIC, B = Code
            if (file.type === 'P') {
                document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
                xp.explorerBasicSource.value = idx.toString();
                explorerRenderBASIC();
                return;
            }
            if (file.type === 'B') {
                document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
                xp.explorerDisasmSource.value = idx.toString();
                xp.explorerDisasmAddr.value = fmtAddr(file.startAddr);
                xp.explorerDisasmLen.value = Math.min(file.length, 4096);
                explorerRenderDisasm();
                return;
            }
            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
            xp.explorerHexSource.value = idx.toString();
            xp.explorerHexLen.value = Math.min(file.length, 65536);
            xp.explorerHexAddr.value = '0000';
            explorerRenderHexDump();
            return;
        }

        const dskEntry = e.target.closest('.explorer-file-entry[data-index]');
        if (dskEntry && xp.explorerParsed && xp.explorerParsed.type === 'dsk') {
            const idx = parseInt(dskEntry.dataset.index);
            if (isNaN(idx) || !xp.explorerParsed.files[idx]) return;

            const file = xp.explorerParsed.files[idx];

            const fileData = xp.DSKLoader.readFileData(
                xp.explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
            );
            if (!fileData || fileData.length === 0) return;

            const hdrSize = file.headerSize || 0;
            const contentData = hdrSize ? fileData.slice(hdrSize) : fileData;
            const contentLen = contentData.length;

            if (contentLen === SCREEN_SIZE || contentLen === SCREEN_BITMAP_SIZE || contentLen === 4096 ||
                contentLen === 2048 || contentLen === SCREEN_ATTR_SIZE || contentLen === 9216 ||
                contentLen === 11136 || contentLen === 12288 || contentLen === 18432) {
                const fLabel = file.name ? (file.ext ? `${file.name}.${file.ext}` : file.name) : `#${idx + 1}`;
                xp.explorerUpdatePreview(contentData, null, fLabel);
                return;
            }

            if (file.plus3Type === 0) {
                document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
                xp.explorerBasicSource.value = idx.toString();
                explorerRenderBASIC();
                return;
            }

            if (file.plus3Type === 3 && file.loadAddress !== undefined) {
                document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();
                xp.explorerDisasmSource.value = idx.toString();
                xp.explorerDisasmAddr.value = fmtAddr(file.loadAddress);
                xp.explorerDisasmLen.value = Math.min(file.size, 4096);
                explorerRenderDisasm();
                return;
            }

            document.querySelector('.explorer-subtab[data-subtab="hexdump"]').click();
            xp.explorerHexSource.value = idx.toString();
            xp.explorerHexLen.value = Math.min(file.size, 65536);
            xp.explorerHexAddr.value = '0000';
            explorerRenderHexDump();
        }
    });

    // Update source selectors based on file type
    function explorerUpdateSourceSelectors(autoSwitchTab = true) {
        const basicOpts = [];
        const disasmOpts = [];
        const hexOpts = [];
        let basicSources = [];

        if (xp.explorerParsed.type === 'tap') {
            for (let i = 0; i < xp.explorerBlocks.length; i++) {
                const block = xp.explorerBlocks[i];
                if (block.blockType === 'header' && block.headerType === 0) {
                    basicOpts.push(`<option value="${i}">Block ${i + 1}: ${block.name}</option>`);
                    basicSources.push(i.toString());
                }
            }
            for (let i = 0; i < xp.explorerBlocks.length; i++) {
                const block = xp.explorerBlocks[i];
                if (block.blockType === 'header' && block.headerType === 3) {
                    disasmOpts.push(`<option value="${i}">Block ${i + 1}: ${block.name} @ ${fmtAddr(block.startAddress)}</option>`);
                }
            }
            for (let i = 0; i < xp.explorerBlocks.length; i++) {
                const block = xp.explorerBlocks[i];
                if (block.blockType === 'data') {
                    const prevBlock = i > 0 ? xp.explorerBlocks[i - 1] : null;
                    const name = prevBlock && prevBlock.blockType === 'header' ? prevBlock.name : `Block ${i + 1}`;
                    const addr = prevBlock && prevBlock.startAddress !== undefined ? ` @ ${fmtAddr(prevBlock.startAddress)}` : '';
                    if (!prevBlock || prevBlock.headerType !== 3) {
                        disasmOpts.push(`<option value="data:${i}">${name} data${addr} (${block.length} bytes)</option>`);
                    }
                }
            }
            for (let i = 0; i < xp.explorerBlocks.length; i++) {
                const block = xp.explorerBlocks[i];
                if (block.blockType === 'data') {
                    const prevBlock = i > 0 ? xp.explorerBlocks[i - 1] : null;
                    const name = prevBlock && prevBlock.blockType === 'header' ? prevBlock.name : `Block ${i + 1}`;
                    hexOpts.push(`<option value="${i}">${name} (${block.length} bytes)</option>`);
                }
            }
        } else if (xp.explorerParsed.type === 'tzx') {
            // TZX standard speed (0x10) and turbo speed (0x11) blocks — same inner structure as TAP
            for (let i = 0; i < xp.explorerBlocks.length; i++) {
                const block = xp.explorerBlocks[i];
                if ((block.id === 0x10 || block.id === 0x11) && block.headerTypeId === 0) {
                    // Program header — BASIC source
                    basicOpts.push(`<option value="${i}">Block ${i + 1}: ${block.fileName}</option>`);
                    basicSources.push(i.toString());
                }
            }
            for (let i = 0; i < xp.explorerBlocks.length; i++) {
                const block = xp.explorerBlocks[i];
                if ((block.id === 0x10 || block.id === 0x11) && block.headerTypeId === 3) {
                    // Bytes header — disasm source
                    disasmOpts.push(`<option value="${i}">Block ${i + 1}: ${block.fileName} @ ${fmtAddr(block.startAddress)}</option>`);
                }
            }
            for (let i = 0; i < xp.explorerBlocks.length; i++) {
                const block = xp.explorerBlocks[i];
                if ((block.id === 0x10 || block.id === 0x11) && block.dataBlock) {
                    // Data block — disasm + hex source
                    const prevBlock = i > 0 ? xp.explorerBlocks[i - 1] : null;
                    const name = prevBlock && (prevBlock.id === 0x10 || prevBlock.id === 0x11) && prevBlock.headerType ? prevBlock.fileName : `Block ${i + 1}`;
                    const addr = prevBlock && prevBlock.startAddress !== undefined ? ` @ ${fmtAddr(prevBlock.startAddress)}` : '';
                    if (!prevBlock || prevBlock.headerTypeId !== 3) {
                        disasmOpts.push(`<option value="data:${i}">${name} data${addr} (${block.dataLength} bytes)</option>`);
                    }
                }
            }
            for (let i = 0; i < xp.explorerBlocks.length; i++) {
                const block = xp.explorerBlocks[i];
                if ((block.id === 0x10 || block.id === 0x11) && block.dataBlock) {
                    const prevBlock = i > 0 ? xp.explorerBlocks[i - 1] : null;
                    const name = prevBlock && (prevBlock.id === 0x10 || prevBlock.id === 0x11) && prevBlock.headerType ? prevBlock.fileName : `Block ${i + 1}`;
                    hexOpts.push(`<option value="${i}">${name} (${block.dataLength} bytes)</option>`);
                }
            }
        } else if (xp.explorerParsed.type === 'trd' || xp.explorerParsed.type === 'scl' || xp.explorerParsed.type === 'mgt') {
            const files = xp.explorerParsed.files;
            const isMgt = xp.explorerParsed.type === 'mgt';
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayName = isMgt ? `${file.name} [${file.typeName}]` : `${file.name}.${file.ext}`;
                if (file.ext === 'B') {
                    basicOpts.push(`<option value="${i}">${displayName}</option>`);
                    basicSources.push(i.toString());
                    disasmOpts.push(`<option value="basic:${i}">${displayName} (BASIC @ 5CCB)</option>`);
                } else if (file.ext === 'C') {
                    disasmOpts.push(`<option value="${i}">${displayName} @ ${fmtAddr(file.startAddress)}</option>`);
                } else if (file.ext === 'D') {
                    disasmOpts.push(`<option value="${i}">${displayName} @ ${fmtAddr(file.startAddress)}</option>`);
                }
                hexOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
            }
        } else if (xp.explorerParsed.type === 'mdr') {
            const files = xp.explorerParsed.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayName = `${file.name} [${file.typeName}]`;
                if (file.ext === 'B') {
                    basicOpts.push(`<option value="${i}">${displayName}</option>`);
                    basicSources.push(i.toString());
                    disasmOpts.push(`<option value="basic:${i}">${displayName} (BASIC @ 5CCB)</option>`);
                } else {
                    disasmOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
                }
                hexOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
            }
        } else if (xp.explorerParsed.type === 'opd') {
            const files = xp.explorerParsed.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayName = `${file.name} [${file.typeName}]`;
                if (file.ext === 'B') {
                    basicOpts.push(`<option value="${i}">${displayName}</option>`);
                    basicSources.push(i.toString());
                    disasmOpts.push(`<option value="basic:${i}">${displayName} (BASIC @ 5CCB)</option>`);
                } else if (file.ext === 'C') {
                    disasmOpts.push(`<option value="${i}">${displayName} @ ${fmtAddr(file.startAddr)} (${file.length} bytes)</option>`);
                } else {
                    disasmOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
                }
                hexOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
            }
        } else if (xp.explorerParsed.type === 'didaktik') {
            // MDOS type chars: P=BASIC, B=Code, N/C=arrays, S=snap, Q=seq
            const files = xp.explorerParsed.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayName = `${file.name} [${file.typeName}]`;
                if (file.type === 'P') {
                    basicOpts.push(`<option value="${i}">${displayName}</option>`);
                    basicSources.push(i.toString());
                    disasmOpts.push(`<option value="basic:${i}">${displayName} (BASIC @ 5CCB)</option>`);
                } else if (file.type === 'B') {
                    disasmOpts.push(`<option value="${i}">${displayName} @ ${fmtAddr(file.startAddr)} (${file.length} bytes)</option>`);
                } else {
                    disasmOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
                }
                hexOpts.push(`<option value="${i}">${displayName} (${file.length} bytes)</option>`);
            }
        } else if (xp.explorerParsed.type === 'hobeta') {
            if (!xp.explorerParsed.error) {
                const f = xp.explorerParsed.file;
                const trimName = f.name.replace(/\s+$/, '');
                if (f.ext === 'B') {
                    basicOpts.push(`<option value="0">${trimName}.${f.ext}</option>`);
                    basicSources.push('0');
                }
                disasmOpts.push(`<option value="0">${trimName}.${f.ext} @ ${fmtAddr(f.startAddress)}</option>`);
                hexOpts.push(`<option value="0">${trimName}.${f.ext} (${f.length} bytes)</option>`);
            }
        } else if (xp.explorerParsed.type === 'dsk') {
            disasmOpts.push('<option value="boot">Boot sector @ $FE10</option>');
            hexOpts.push('<option value="boot">Boot sector (512 bytes)</option>');
            const files = xp.explorerParsed.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const displayName = file.name + (file.ext ? '.' + file.ext : '');
                const addrStr = file.loadAddress !== undefined ? ` @ ${fmtAddr(file.loadAddress)}` : '';
                if (file.plus3Type === 0) {
                    basicOpts.push(`<option value="${i}">${displayName}</option>`);
                    basicSources.push(i.toString());
                }
                if (file.plus3Type === 3 || file.plus3Type === undefined) {
                    disasmOpts.push(`<option value="${i}">${displayName}${addrStr} (${file.size} bytes)</option>`);
                }
                hexOpts.push(`<option value="${i}">${displayName} (${file.size} bytes)</option>`);
            }
        } else if (xp.explorerParsed.type === 'sna' || xp.explorerParsed.type === 'z80' || xp.explorerParsed.type === 'szx') {
            basicOpts.push('<option value="snapshot-memory">Memory (BASIC)</option>');
            basicSources.push('snapshot-memory');
            disasmOpts.push('<option value="memory">Full memory</option>');
            hexOpts.push('<option value="memory">Full memory</option>');
            const bankList = xp.explorerGetBankList();
            for (const bankNum of bankList) {
                const suffix = bankNum === 5 ? ' (screen)' : bankNum === 7 ? ' (shadow)' : '';
                disasmOpts.push(`<option value="bank:${bankNum}">Bank ${bankNum}${suffix}</option>`);
                hexOpts.push(`<option value="bank:${bankNum}">Bank ${bankNum}${suffix}</option>`);
            }
        }

        xp.explorerBasicSource.innerHTML = '<option value="">Select source...</option>' + basicOpts.join('');
        xp.explorerBasicLines = null; // Invalidate cached decode when source list changes
        xp.explorerBasicRawData = null;
        xp.explorerDisasmSource.innerHTML = '<option value="">Select source...</option>' + disasmOpts.join('');
        xp.explorerHexSource.innerHTML = '<option value="">Whole file</option>' + hexOpts.join('');
        xp.explorerTextSource.innerHTML = '<option value="">Whole file</option>' + hexOpts.join('');

        if (basicSources.length === 1) {
            xp.explorerBasicSource.value = basicSources[0];
            explorerRenderBASIC();
            if (autoSwitchTab) document.querySelector('.explorer-subtab[data-subtab="basic"]').click();
        }

        if (xp.explorerDisasmSource.options.length > 1) {
            xp.explorerDisasmSource.selectedIndex = 1;
            xp.explorerDisasmSource.dispatchEvent(new Event('change'));
        }

        const dataLen = xp.explorerData ? xp.explorerData.length : 0;
        if (dataLen > 0 && dataLen <= 4096) {
            xp.explorerDisasmLen.value = dataLen;
        } else {
            xp.explorerDisasmLen.value = 256;
        }
        if (dataLen > 0 && dataLen <= 65536) {
            xp.explorerHexLen.value = dataLen;
        } else {
            xp.explorerHexLen.value = 256;
        }
        if (xp.explorerHexSource.options.length > 1) {
            xp.explorerHexSource.selectedIndex = 1;
        }
        if (xp.explorerTextSource.options.length > 1) {
            xp.explorerTextSource.selectedIndex = 1;
        }
    }

    xp.btnExplorerDisasm.addEventListener('click', () => {
        explorerRenderDisasm();
    });

    xp.explorerDisasmSource.addEventListener('change', () => {
        const source = xp.explorerDisasmSource.value;
        if (!source) return;

        if (xp.explorerParsed.type === 'tap') {
            if (source.startsWith('data:')) {
                const blockIdx = parseInt(source.slice(5));
                const prevBlock = blockIdx > 0 ? xp.explorerBlocks[blockIdx - 1] : null;
                if (prevBlock && prevBlock.blockType === 'header' && prevBlock.startAddress !== undefined) {
                    xp.explorerDisasmAddr.value = fmtAddr(prevBlock.startAddress);
                }
            } else {
                const blockIdx = parseInt(source);
                const headerBlock = xp.explorerBlocks[blockIdx];
                if (headerBlock && headerBlock.startAddress !== undefined) {
                    xp.explorerDisasmAddr.value = fmtAddr(headerBlock.startAddress);
                }
            }
        } else if (xp.explorerParsed.type === 'tzx') {
            if (source.startsWith('data:')) {
                const blockIdx = parseInt(source.slice(5));
                const prevBlock = blockIdx > 0 ? xp.explorerBlocks[blockIdx - 1] : null;
                if (prevBlock && (prevBlock.id === 0x10 || prevBlock.id === 0x11) && prevBlock.startAddress !== undefined) {
                    xp.explorerDisasmAddr.value = fmtAddr(prevBlock.startAddress);
                }
            } else {
                const blockIdx = parseInt(source);
                const headerBlock = xp.explorerBlocks[blockIdx];
                if (headerBlock && headerBlock.startAddress !== undefined) {
                    xp.explorerDisasmAddr.value = fmtAddr(headerBlock.startAddress);
                }
            }
        } else if (xp.explorerParsed.type === 'trd' || xp.explorerParsed.type === 'scl' || xp.explorerParsed.type === 'mgt' || xp.explorerParsed.type === 'mdr') {
            if (source.startsWith('basic:')) {
                xp.explorerDisasmAddr.value = '5CCB';
            } else {
                const fileIdx = parseInt(source);
                const file = xp.explorerParsed.files[fileIdx];
                if (file && file.startAddress !== undefined) {
                    xp.explorerDisasmAddr.value = fmtAddr(file.startAddress);
                }
            }
        } else if (xp.explorerParsed.type === 'opd' || xp.explorerParsed.type === 'didaktik') {
            if (source.startsWith('basic:')) {
                xp.explorerDisasmAddr.value = '5CCB';
            } else {
                const fileIdx = parseInt(source);
                const file = xp.explorerParsed.files[fileIdx];
                if (file && file.startAddr !== undefined) {
                    xp.explorerDisasmAddr.value = fmtAddr(file.startAddr);
                }
            }
        } else if (xp.explorerParsed.type === 'dsk') {
            if (source === 'boot') {
                xp.explorerDisasmAddr.value = 'FE10';
            } else {
                const fileIdx = parseInt(source);
                const file = xp.explorerParsed.files[fileIdx];
                if (file && file.loadAddress !== undefined) {
                    xp.explorerDisasmAddr.value = fmtAddr(file.loadAddress);
                } else {
                    xp.explorerDisasmAddr.value = '0000';
                }
            }
        } else if (source === 'memory') {
            xp.explorerDisasmAddr.value = '4000';
        } else if (source && source.startsWith('bank:')) {
            const bankNum = parseInt(source.slice(5));
            if (xp.explorerBankAddressMode === 'logical') {
                xp.explorerDisasmAddr.value = fmtAddr(xp.explorerGetBankLogicalAddr(bankNum));
            } else {
                xp.explorerDisasmAddr.value = '0000';
            }
        }

        explorerRenderDisasm();
    });

    function explorerRenderDisasm() {
        const addr = parseAddr(xp.explorerDisasmAddr.value) || 0;
        const len = parseInt(xp.explorerDisasmLen.value, 10) || 256;
        const source = xp.explorerDisasmSource.value;

        let data = null;
        let baseAddr = addr;

        if (source && source.startsWith('bank:') && (xp.explorerParsed.type === 'sna' || xp.explorerParsed.type === 'z80' || xp.explorerParsed.type === 'szx')) {
            const bankNum = parseInt(source.slice(5));
            data = xp.explorerExtractBank(bankNum);
            if (xp.explorerBankAddressMode === 'logical') {
                baseAddr = xp.explorerGetBankLogicalAddr(bankNum);
            } else {
                baseAddr = 0;
            }
        } else if (source === 'memory' && (xp.explorerParsed.type === 'sna' || xp.explorerParsed.type === 'z80' || xp.explorerParsed.type === 'szx')) {
            // Reconstruct full 48K from decompressed banks
            const port7FFD = xp.explorerParsed.registers.port7FFD || 0;
            const pagedBank = xp.explorerParsed.is128 ? (port7FFD & 0x07) : 0;
            const bank5 = xp.explorerExtractBank(5);
            const bank2 = xp.explorerExtractBank(2);
            const bankC = xp.explorerExtractBank(xp.explorerParsed.is128 ? pagedBank : 0);
            const mem = new Uint8Array(49152);
            if (bank5) mem.set(bank5, 0);
            if (bank2) mem.set(bank2, 16384);
            if (bankC) mem.set(bankC, 32768);
            data = mem;
            baseAddr = SLOT1_START;
        } else if (source && xp.explorerParsed.type === 'tap') {
            if (source.startsWith('data:')) {
                const blockIdx = parseInt(source.slice(5));
                const dataBlock = xp.explorerBlocks[blockIdx];
                if (dataBlock && dataBlock.blockType === 'data') {
                    data = dataBlock.data.slice(1, -1);
                    const prevBlock = blockIdx > 0 ? xp.explorerBlocks[blockIdx - 1] : null;
                    if (prevBlock && prevBlock.blockType === 'header' && prevBlock.startAddress !== undefined) {
                        baseAddr = prevBlock.startAddress;
                    } else {
                        baseAddr = 0;
                    }
                }
            } else {
                const blockIdx = parseInt(source);
                const headerBlock = xp.explorerBlocks[blockIdx];
                if (headerBlock && headerBlock.blockType === 'header' && blockIdx + 1 < xp.explorerBlocks.length) {
                    const dataBlock = xp.explorerBlocks[blockIdx + 1];
                    data = dataBlock.data.slice(1, -1);
                    baseAddr = headerBlock.startAddress || 0;
                    xp.explorerDisasmAddr.value = fmtAddr(baseAddr);
                }
            }
        } else if (source && xp.explorerParsed.type === 'tzx') {
            if (source.startsWith('data:')) {
                const blockIdx = parseInt(source.slice(5));
                const dataBlock = xp.explorerBlocks[blockIdx];
                if (dataBlock && (dataBlock.id === 0x10 || dataBlock.id === 0x11) && dataBlock.dataBlock && dataBlock.data) {
                    data = dataBlock.data.slice(1, -1);
                    const prevBlock = blockIdx > 0 ? xp.explorerBlocks[blockIdx - 1] : null;
                    if (prevBlock && (prevBlock.id === 0x10 || prevBlock.id === 0x11) && prevBlock.startAddress !== undefined) {
                        baseAddr = prevBlock.startAddress;
                    } else {
                        baseAddr = 0;
                    }
                }
            } else {
                const blockIdx = parseInt(source);
                const headerBlock = xp.explorerBlocks[blockIdx];
                if (headerBlock && (headerBlock.id === 0x10 || headerBlock.id === 0x11) && headerBlock.headerTypeId === 3 && blockIdx + 1 < xp.explorerBlocks.length) {
                    const dataBlock = xp.explorerBlocks[blockIdx + 1];
                    if (dataBlock && dataBlock.data) {
                        data = dataBlock.data.slice(1, -1);
                        baseAddr = headerBlock.startAddress || 0;
                        xp.explorerDisasmAddr.value = fmtAddr(baseAddr);
                    }
                }
            }
        } else if (source && (xp.explorerParsed.type === 'trd' || xp.explorerParsed.type === 'scl' || xp.explorerParsed.type === 'mgt' || xp.explorerParsed.type === 'mdr')) {
            if (source.startsWith('basic:')) {
                const fileIdx = parseInt(source.slice(6));
                const file = xp.explorerParsed.files[fileIdx];
                if (file) {
                    if (xp.explorerParsed.type === 'mgt') {
                        data = MGTLoader.extractFile(xp.explorerData, file);
                    } else if (xp.explorerParsed.type === 'mdr') {
                        data = MDRLoader.extractFile(xp.explorerData, file);
                        if (data && data.length > 9 && !file.isPrint) data = data.slice(9);
                    } else {
                        const fullSize = file.sectors * 256;
                        data = xp.explorerData.slice(file.offset, file.offset + fullSize);
                    }
                    // Match the address field set by the source-change handler and the
                    // option label ("@ 5CCB" = 48K PROG). The previous 0x5D3B disagreed
                    // with the 0x5CCB in the field, making (addr - baseAddr) negative so
                    // the disassembly loop emitted nothing.
                    baseAddr = 0x5CCB;
                }
            } else {
                const fileIdx = parseInt(source);
                const file = xp.explorerParsed.files[fileIdx];
                if (file) {
                    if (xp.explorerParsed.type === 'mgt') {
                        data = MGTLoader.extractFile(xp.explorerData, file);
                    } else if (xp.explorerParsed.type === 'mdr') {
                        data = MDRLoader.extractFile(xp.explorerData, file);
                        if (data && data.length > 9 && !file.isPrint) data = data.slice(9);
                    } else {
                        const fullSize = file.sectors * 256;
                        data = xp.explorerData.slice(file.offset, file.offset + fullSize);
                    }
                    baseAddr = file.startAddress || 0;
                    xp.explorerDisasmAddr.value = fmtAddr(baseAddr);
                }
            }
        } else if (source && xp.explorerParsed.type === 'opd') {
            if (source.startsWith('basic:')) {
                const fileIdx = parseInt(source.slice(6));
                const file = xp.explorerParsed.files[fileIdx];
                if (file) {
                    const raw = OPDLoader.extractFile(xp.explorerData, file);
                    data = raw && file.length < raw.length ? raw.slice(0, file.length) : raw;
                    baseAddr = 0x5CCB;
                }
            } else {
                const fileIdx = parseInt(source);
                const file = xp.explorerParsed.files[fileIdx];
                if (file) {
                    const raw = OPDLoader.extractFile(xp.explorerData, file);
                    data = raw && file.length < raw.length ? raw.slice(0, file.length) : raw;
                    baseAddr = file.startAddr || 0;
                    xp.explorerDisasmAddr.value = fmtAddr(baseAddr);
                }
            }
        } else if (source && xp.explorerParsed.type === 'didaktik') {
            const fileIdx = parseInt(source.startsWith('basic:') ? source.slice(6) : source);
            const file = xp.explorerParsed.files[fileIdx];
            if (file) {
                const raw = DidaktikLoader.extractFile(xp.explorerData, file);
                data = raw && file.length < raw.length ? raw.slice(0, file.length) : raw;
                baseAddr = source.startsWith('basic:') ? 0x5CCB : (file.startAddr || 0);
                if (!source.startsWith('basic:')) xp.explorerDisasmAddr.value = fmtAddr(baseAddr);
            }
        } else if (source && xp.explorerParsed.type === 'hobeta') {
            const f = xp.explorerParsed.file;
            if (f) {
                data = f.data;
                baseAddr = f.startAddress;
                xp.explorerDisasmAddr.value = fmtAddr(baseAddr);
            }
        } else if (source && xp.explorerParsed.type === 'dsk') {
            if (source === 'boot') {
                const bootSector = xp.explorerParsed.dskImage.readSector(0, 0,
                    xp.explorerParsed.diskSpec && xp.explorerParsed.diskSpec.firstSectorId !== undefined
                        ? xp.explorerParsed.diskSpec.firstSectorId : 1);
                if (bootSector && bootSector.length > 16) {
                    data = bootSector.slice(16);
                    baseAddr = 0xFE10;
                    xp.explorerDisasmAddr.value = 'FE10';
                }
            } else {
                const fileIdx = parseInt(source);
                const file = xp.explorerParsed.files[fileIdx];
                if (file) {
                    const rawData = xp.DSKLoader.readFileData(
                        xp.explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
                    );
                    const hdr = file.headerSize || 0;
                    if (rawData && hdr && rawData.length > hdr) {
                        data = rawData.slice(hdr, hdr + file.size);
                    } else {
                        data = rawData ? rawData.slice(0, file.size) : rawData;
                    }
                    baseAddr = (file.loadAddress !== undefined) ? file.loadAddress : 0;
                    xp.explorerDisasmAddr.value = fmtAddr(baseAddr);
                }
            }
        } else if (!source && xp.explorerData) {
            data = xp.explorerData;
        }

        if (!data || data.length === 0) {
            xp.explorerDisasmOutput.innerHTML = '<div class="explorer-empty">No data to disassemble</div>';
            return;
        }

        const fakeMemory = {
            read: (a) => {
                const offset = a - baseAddr;
                if (offset >= 0 && offset < data.length) {
                    return data[offset];
                }
                return 0;
            }
        };

        const disasm = new xp.Disassembler(fakeMemory);

        let html = '';
        let offset = addr - baseAddr;
        const endOffset = Math.min(offset + len, data.length);

        const romLabels = xp.getRomLabels();

        while (offset < endOffset && offset >= 0) {
            const currentAddr = baseAddr + offset;

            const result = disasm.disassemble(currentAddr);
            const instrLen = result.length || 1;
            const bytesHex = result.bytes.map(b => fmtOpcode(b)).join(' ');

            let mnemonic = result.mnemonic || '???';
            const addrMatch = mnemonic.match(/([0-9A-F]{4})h/i);
            if (addrMatch) {
                const targetAddr = parseInt(addrMatch[1], 16);
                const label = romLabels[targetAddr];
                if (label) {
                    mnemonic = mnemonic.replace(addrMatch[0], `<span class="dl">${label}</span>`);
                }
            }

            html += `<span class="da">${fmtAddrCol(currentAddr)}</span>  <span class="dm">${mnemonic.padEnd(20)}</span> <span class="db">; ${bytesHex}</span>\n`;

            if (isFlowBreak(mnemonic)) {
                html += '\n';
            }

            offset += instrLen;
        }

        xp.explorerDisasmOutput.innerHTML = html || '<div class="explorer-empty">No instructions</div>';
    }

    xp.btnExplorerHex.addEventListener('click', () => {
        explorerRenderHexDump();
    });

    // Bank tools visibility: show when bank source selected, hide otherwise
    xp.explorerHexSource.addEventListener('change', () => {
        const source = xp.explorerHexSource.value;
        if (source && source.startsWith('bank:')) {
            xp.explorerBankTools.style.display = '';
            // Set address/length defaults for bank
            const bankNum = parseInt(source.slice(5));
            if (xp.explorerBankAddressMode === 'logical') {
                xp.explorerHexAddr.value = fmtAddr(xp.explorerGetBankLogicalAddr(bankNum));
            } else {
                xp.explorerHexAddr.value = '0000';
            }
            xp.explorerHexLen.value = '16384';
        } else {
            xp.explorerBankTools.style.display = 'none';
        }
    });

    // Address mode toggle
    xp.explorerBankAddrMode.addEventListener('change', () => {
        xp.explorerBankAddressMode = xp.explorerBankAddrMode.value;
        const source = xp.explorerHexSource.value;
        if (source && source.startsWith('bank:')) {
            const bankNum = parseInt(source.slice(5));
            if (xp.explorerBankAddressMode === 'logical') {
                xp.explorerHexAddr.value = fmtAddr(xp.explorerGetBankLogicalAddr(bankNum));
            } else {
                xp.explorerHexAddr.value = '0000';
            }
            explorerRenderHexDump();
        }
    });

    // Export bank as .bin
    xp.btnExplorerExportBank.addEventListener('click', () => {
        const source = xp.explorerHexSource.value;
        if (!source || !source.startsWith('bank:')) return;
        const bankNum = parseInt(source.slice(5));
        const bankData = xp.explorerExtractBank(bankNum);
        if (!bankData) return;

        const addr = parseAddr(xp.explorerHexAddr.value) || 0;
        const len = parseInt(xp.explorerHexLen.value, 10) || 16384;
        let startOffset, exportLen;
        if (xp.explorerBankAddressMode === 'logical') {
            const logicalBase = xp.explorerGetBankLogicalAddr(bankNum);
            startOffset = Math.max(0, addr - logicalBase);
        } else {
            startOffset = addr;
        }
        exportLen = Math.min(len, bankData.length - startOffset);
        if (exportLen <= 0) return;

        const exportData = bankData.slice(startOffset, startOffset + exportLen);
        const baseName = (xp.explorerFileName.textContent || 'snapshot').replace(/\.[^.]+$/, '');
        const addrSuffix = startOffset > 0 || exportLen < 16384 ? `_${hex16(addr)}` : '';
        downloadFile(`${baseName}_bank${bankNum}${addrSuffix}.bin`, exportData);
    });

    // Import .bin into bank
    xp.btnExplorerImportBank.addEventListener('click', () => {
        xp.explorerBankImportInput.click();
    });

    xp.explorerBankImportInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const source = xp.explorerHexSource.value;
        if (!source || !source.startsWith('bank:')) return;
        const bankNum = parseInt(source.slice(5));

        const reader = new FileReader();
        reader.onload = () => {
            const imported = new Uint8Array(reader.result);
            // Ensure bank is in cache
            const bankData = xp.explorerExtractBank(bankNum);
            if (!bankData) return;

            const addr = parseAddr(xp.explorerHexAddr.value) || 0;
            let writeOffset;
            if (xp.explorerBankAddressMode === 'logical') {
                const logicalBase = xp.explorerGetBankLogicalAddr(bankNum);
                writeOffset = Math.max(0, addr - logicalBase);
            } else {
                writeOffset = addr;
            }

            const writeLen = Math.min(imported.length, 16384 - writeOffset);
            bankData.set(imported.slice(0, writeLen), writeOffset);
            xp.explorerBankDirty.add(bankNum);

            // Show save button and status
            xp.btnExplorerSaveModified.style.display = '';
            const dirtyList = Array.from(xp.explorerBankDirty).sort().join(', ');
            xp.explorerBankStatus.textContent = `Imported ${writeLen} bytes into bank ${bankNum}. Modified: ${dirtyList}`;

            // Re-render hex dump
            explorerRenderHexDump();

            // Refresh preview if screen bank modified
            if (bankNum === 5 || bankNum === 7) {
                xp.explorerUpdatePreviewForFile();
            }
        };
        reader.readAsArrayBuffer(file);
        xp.explorerBankImportInput.value = '';
    });

    // Save Modified snapshot
    xp.btnExplorerSaveModified.addEventListener('click', () => {
        if (!xp.explorerParsed || !xp.explorerData || xp.explorerBankDirty.size === 0) return;
        const baseName = (xp.explorerFileName.textContent || 'snapshot').replace(/\.[^.]+$/, '');
        const ext = xp.explorerFileType || 'sna';

        if (xp.explorerParsed.type === 'sna') {
            const result = new Uint8Array(xp.explorerData.length);
            result.set(xp.explorerData);
            const port7FFD = xp.explorerParsed.registers.port7FFD || 0;
            const pagedBank = port7FFD & 0x07;

            for (const bankNum of xp.explorerBankDirty) {
                const bankData = xp.explorerBankCache.get(bankNum);
                if (!bankData) continue;
                if (!xp.explorerParsed.is128) {
                    // 48K: banks 5/2/0
                    if (bankNum === 5) result.set(bankData, 27);
                    else if (bankNum === 2) result.set(bankData, 27 + 16384);
                    else if (bankNum === 0) result.set(bankData, 27 + 32768);
                } else {
                    // 128K
                    if (bankNum === 5) result.set(bankData, 27);
                    else if (bankNum === 2) result.set(bankData, 27 + 16384);
                    else if (bankNum === pagedBank) result.set(bankData, 27 + 32768);
                    else {
                        const remainingBanks = [0, 1, 3, 4, 6, 7].filter(b => b !== pagedBank);
                        const idx = remainingBanks.indexOf(bankNum);
                        if (idx >= 0) result.set(bankData, 49183 + idx * 16384);
                    }
                }
            }
            downloadFile(`${baseName}_modified.sna`, result);
        } else if (xp.explorerParsed.type === 'z80') {
            // Rebuild Z80 as V3 uncompressed
            const parsed = xp.explorerParsed;
            let headerLen;
            if (parsed.version === 1) {
                // Upgrade V1 to V3: 30-byte base + 54-byte extended header
                headerLen = 30 + 2 + 54;
                const header = new Uint8Array(headerLen);
                // Copy original 30-byte header
                header.set(xp.explorerData.slice(0, 30));
                // Set PC=0 in bytes 6-7 to indicate V2/V3
                header[6] = 0; header[7] = 0;
                // Clear V1 compression flag (bit 5 of byte 12)
                header[12] = header[12] & ~0x20;
                // Extended header length = 54
                header[30] = 54; header[31] = 0;
                // PC in extended header bytes 32-33
                const origPC = xp.explorerData[6] | (xp.explorerData[7] << 8);
                header[32] = origPC & 0xFF; header[33] = (origPC >> 8) & 0xFF;
                // hwMode = 0 (48K)
                header[34] = 0;

                // Calculate total size: header + pages
                const bankList = xp.explorerGetBankList();
                const totalSize = headerLen + bankList.length * (3 + 16384);
                const result = new Uint8Array(totalSize);
                result.set(header);
                let offset = headerLen;
                // 48K page mapping: bank 5→page 8, bank 2→page 4, bank 0→page 5
                const pageMapping = { 5: 8, 2: 4, 0: 5 };
                for (const bankNum of bankList) {
                    const bankData = xp.explorerExtractBank(bankNum);
                    if (!bankData) continue;
                    // Write uncompressed page: length=0xFFFF, pageNum
                    result[offset] = 0xFF; result[offset + 1] = 0xFF;
                    result[offset + 2] = pageMapping[bankNum] || (bankNum + 3);
                    result.set(bankData.slice(0, 16384), offset + 3);
                    offset += 3 + 16384;
                }
                downloadFile(`${baseName}_modified.z80`, result);
            } else {
                // V2/V3: copy header, rewrite all pages uncompressed
                const extLen = xp.explorerData[30] | (xp.explorerData[31] << 8);
                headerLen = 32 + extLen;
                const header = new Uint8Array(headerLen);
                header.set(xp.explorerData.slice(0, headerLen));

                const bankList = xp.explorerGetBankList();
                const totalSize = headerLen + bankList.length * (3 + 16384);
                const result = new Uint8Array(totalSize);
                result.set(header);
                let offset = headerLen;
                for (const bankNum of bankList) {
                    const bankData = xp.explorerExtractBank(bankNum);
                    if (!bankData) continue;
                    const pageNum = parsed.is128 ? (bankNum + 3) : ({ 5: 8, 2: 4, 0: 5 })[bankNum];
                    if (pageNum === undefined) continue;
                    result[offset] = 0xFF; result[offset + 1] = 0xFF;
                    result[offset + 2] = pageNum;
                    result.set(bankData.slice(0, 16384), offset + 3);
                    offset += 3 + 16384;
                }
                downloadFile(`${baseName}_modified.z80`, result.slice(0, offset));
            }
        } else if (xp.explorerParsed.type === 'szx') {
            // Copy non-RAMP chunks, rebuild RAMP chunks with modified data
            const bytes = new Uint8Array(xp.explorerData);
            const chunks = [];

            // Copy 8-byte header
            chunks.push(bytes.slice(0, 8));

            // Copy all non-RAMP chunks from original
            for (const chunk of xp.explorerParsed.chunks) {
                if (chunk.id !== 'RAMP') {
                    // Chunk header is 8 bytes before chunk.offset
                    const chunkStart = chunk.offset - 8;
                    const chunkEnd = chunk.offset + chunk.size;
                    if (chunkStart >= 8 && chunkEnd <= bytes.length) {
                        chunks.push(bytes.slice(chunkStart, chunkEnd));
                    }
                }
            }

            // Write RAMP chunks for all banks
            const bankList = xp.explorerGetBankList();
            for (const bankNum of bankList) {
                const bankData = xp.explorerExtractBank(bankNum);
                if (!bankData) continue;

                // Try compression
                let compressed = null;
                let useCompression = false;
                if (typeof xp.pako !== 'undefined') {
                    try {
                        compressed = xp.pako.deflate(bankData);
                        if (compressed.length < bankData.length - 100) {
                            useCompression = true;
                        }
                    } catch (e) { /* fall back to uncompressed */ }
                }

                const pageBytes = useCompression ? compressed : bankData;
                const rampData = new Uint8Array(3 + pageBytes.length);
                rampData[0] = useCompression ? 1 : 0;
                rampData[1] = 0;
                rampData[2] = bankNum;
                rampData.set(pageBytes, 3);

                // Build chunk: 4-byte ID + 4-byte size + data
                const chunkBuf = new Uint8Array(8 + rampData.length);
                chunkBuf[0] = 0x52; chunkBuf[1] = 0x41; // "RA"
                chunkBuf[2] = 0x4D; chunkBuf[3] = 0x50; // "MP"
                chunkBuf[4] = rampData.length & 0xFF;
                chunkBuf[5] = (rampData.length >> 8) & 0xFF;
                chunkBuf[6] = (rampData.length >> 16) & 0xFF;
                chunkBuf[7] = (rampData.length >> 24) & 0xFF;
                chunkBuf.set(rampData, 8);
                chunks.push(chunkBuf);
            }

            // Combine
            const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
            const result = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }
            downloadFile(`${baseName}_modified.szx`, result);
        }
    });

    function explorerRenderHexDump() {
        const addr = parseAddr(xp.explorerHexAddr.value) || 0;
        const len = parseInt(xp.explorerHexLen.value, 10) || 256;
        const source = xp.explorerHexSource.value;

        let data = null;
        let baseAddr = addr;

        // Universal sector source handler (Disk Map click-to-hex for any format)
        if (source && source.startsWith('sector:')) {
            const parts = source.split(':');
            if (parts[1] === 'flat') {
                const sOff = parseInt(parts[2]);
                const sSize = parseInt(parts[3]);
                if (xp.explorerData && sOff + sSize <= xp.explorerData.length) {
                    data = xp.explorerData.slice(sOff, sOff + sSize);
                    baseAddr = 0;
                }
            } else if (xp.explorerParsed && xp.explorerParsed.dskImage) {
                const sCyl = parseInt(parts[1]);
                const sHead = parseInt(parts[2]);
                const sSid = parseInt(parts[3]);
                const secData = xp.explorerParsed.dskImage.readSector(sCyl, sHead, sSid);
                if (secData) {
                    data = secData;
                    baseAddr = 0;
                }
            }
        } else if (source && source.startsWith('bank:') && (xp.explorerParsed.type === 'sna' || xp.explorerParsed.type === 'z80' || xp.explorerParsed.type === 'szx')) {
            const bankNum = parseInt(source.slice(5));
            data = xp.explorerExtractBank(bankNum);
            if (xp.explorerBankAddressMode === 'logical') {
                baseAddr = xp.explorerGetBankLogicalAddr(bankNum);
            } else {
                baseAddr = 0;
            }
        } else if (source === 'memory' && (xp.explorerParsed.type === 'sna' || xp.explorerParsed.type === 'z80' || xp.explorerParsed.type === 'szx')) {
            // Reconstruct full 48K from decompressed banks
            const port7FFD = xp.explorerParsed.registers.port7FFD || 0;
            const pagedBank = xp.explorerParsed.is128 ? (port7FFD & 0x07) : 0;
            const bank5 = xp.explorerExtractBank(5);
            const bank2 = xp.explorerExtractBank(2);
            const bankC = xp.explorerExtractBank(xp.explorerParsed.is128 ? pagedBank : 0);
            const mem = new Uint8Array(49152);
            if (bank5) mem.set(bank5, 0);
            if (bank2) mem.set(bank2, 16384);
            if (bankC) mem.set(bankC, 32768);
            data = mem;
            baseAddr = SLOT1_START;
        } else if (source && xp.explorerParsed.type === 'tap') {
            const blockIdx = parseInt(source);
            const block = xp.explorerBlocks[blockIdx];
            if (block && block.blockType === 'data') {
                data = block.data.slice(1, -1);
                baseAddr = 0;
            }
        } else if (source && xp.explorerParsed.type === 'tzx') {
            const blockIdx = parseInt(source);
            const block = xp.explorerBlocks[blockIdx];
            if (block && (block.id === 0x10 || block.id === 0x11) && block.data) {
                data = block.data.slice(1, -1);
                baseAddr = 0;
            }
        } else if (source && (xp.explorerParsed.type === 'trd' || xp.explorerParsed.type === 'scl' || xp.explorerParsed.type === 'mgt' || xp.explorerParsed.type === 'mdr')) {
            const fileIdx = parseInt(source);
            const file = xp.explorerParsed.files[fileIdx];
            if (file) {
                // TR-DOS/SCL: dump the full sector allocation, not just the declared
                // length. Monoloaders (a small BASIC loader + CODE glued into the
                // file's extra sectors) declare length = BASIC length only; the real
                // payload lives in sectors*256.
                data = xp.explorerParsed.type === 'mgt'
                    ? MGTLoader.extractFile(xp.explorerData, file)
                    : xp.explorerParsed.type === 'mdr'
                    ? MDRLoader.extractFile(xp.explorerData, file)
                    : xp.explorerData.slice(file.offset, file.offset + file.sectors * 256);
                if (xp.explorerParsed.type === 'mdr' && data && data.length > 9 && !file.isPrint) data = data.slice(9);
                baseAddr = 0;
            }
        } else if (source && (xp.explorerParsed.type === 'opd' || xp.explorerParsed.type === 'didaktik')) {
            const fileIdx = parseInt(source);
            const file = xp.explorerParsed.files[fileIdx];
            if (file) {
                const raw = xp.explorerParsed.type === 'opd'
                    ? OPDLoader.extractFile(xp.explorerData, file)
                    : DidaktikLoader.extractFile(xp.explorerData, file);
                data = raw && file.length < raw.length ? raw.slice(0, file.length) : raw;
                baseAddr = 0;
            }
        } else if (source && xp.explorerParsed.type === 'hobeta') {
            const f = xp.explorerParsed.file;
            if (f) {
                data = f.data;
                baseAddr = 0;
            }
        } else if (source && xp.explorerParsed.type === 'dsk') {
            if (source === 'boot') {
                const bootSector = xp.explorerParsed.dskImage.readSector(0, 0,
                    xp.explorerParsed.diskSpec && xp.explorerParsed.diskSpec.firstSectorId !== undefined
                        ? xp.explorerParsed.diskSpec.firstSectorId : 1);
                if (bootSector) {
                    data = bootSector;
                    baseAddr = 0xFE00;
                }
            } else {
                const fileIdx = parseInt(source);
                const file = xp.explorerParsed.files[fileIdx];
                if (file) {
                    const rawData = xp.DSKLoader.readFileData(
                        xp.explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
                    );
                    const hdr = file.headerSize || 0;
                    if (rawData && hdr && rawData.length > hdr) {
                        data = rawData.slice(hdr, hdr + file.size);
                    } else {
                        data = rawData ? rawData.slice(0, file.size) : rawData;
                    }
                    baseAddr = 0;
                }
            }
        } else if (xp.explorerData) {
            data = xp.explorerData;
        }

        if (!data || data.length === 0) {
            xp.explorerHexOutput.innerHTML = '<div class="explorer-empty">No data</div>';
            return;
        }

        let html = '';
        const startOffset = Math.max(0, addr - baseAddr);
        const endOffset = Math.min(startOffset + len, data.length);

        for (let offset = startOffset; offset < endOffset; offset += 16) {
            const lineAddr = baseAddr + offset;
            let bytesHex = '';
            let ascii = '';

            // A gap in the byte column costs whatever a byte costs in this base.
            const gap = ' '.repeat(byteColWidth() + 1);
            for (let i = 0; i < 16; i++) {
                if (offset + i < data.length) {
                    const b = data[offset + i];
                    bytesHex += fmtByteCol(b) + ' ';
                    ascii += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
                } else {
                    bytesHex += gap;
                    ascii += ' ';
                }
                if (i === 7) bytesHex += ' ';
            }

            html += `<span class="ha">${fmtAddrCol(lineAddr)}</span>  <span class="hb">${bytesHex}</span>  <span class="hc">${escapeHtml(ascii)}</span>\n`;
        }

        xp.explorerHexOutput.innerHTML = html || '<div class="explorer-empty">No data</div>';
    }

    // ========== Find in the selected source ==========
    //
    // The Explorer had no find at all: a file could be opened, catalogued and
    // dumped, but not asked whether a word was in it. Text and Hex are the two
    // obvious modes; Encoded is the one that matters, because game text is very
    // often not stored as text and looking only for the plaintext reports the
    // same "nothing" whether the word is absent or merely enciphered.
    //
    // Clicking a hit scrolls the dump to it, so a find leads into the bytes
    // rather than being a dead end.

    function explorerFindBytes(needle, data) {
        const hits = [];
        for (let i = 0; i + needle.length <= data.length && hits.length < 200; i++) {
            let ok = true;
            for (let j = 0; j < needle.length; j++) {
                if (needle[j] !== null && data[i + j] !== needle[j]) { ok = false; break; }
            }
            if (ok) hits.push({ addr: i, length: needle.length, label: '' });
        }
        return hits;
    }

    // Where the selected source's byte 0 sits in the dump's addresses — the same
    // rule explorerRenderHexDump applies, and 0 for every other source
    function explorerFindBaseAddr() {
        const source = xp.explorerHexSource.value;
        const type = xp.explorerParsed && xp.explorerParsed.type;
        const isSnap = type === 'sna' || type === 'z80' || type === 'szx';
        if (source === 'memory' && isSnap) return SLOT1_START;
        if (source && source.startsWith('bank:') && isSnap &&
            xp.explorerBankAddressMode === 'logical') {
            return xp.explorerGetBankLogicalAddr(parseInt(source.slice(5)));
        }
        if (source === 'boot' && type === 'dsk') return 0xFE00;
        return 0;
    }

    function explorerParseHexNeedle(text) {
        const out = [];
        for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
            if (tok === '?' || tok === '??') { out.push(null); continue; }
            if (!/^[0-9a-fA-F]{2}$/.test(tok)) return null;
            out.push(parseInt(tok, 16));
        }
        return out.length ? out : null;
    }

    function explorerRunFind() {
        const text = xp.explorerFindText.value.trim();
        const mode = xp.explorerFindMode.value;
        const results = xp.explorerFindResults;
        const status = xp.explorerFindStatus;
        results.innerHTML = '';
        status.textContent = '';
        if (!text) return;

        const data = explorerGetSourceData(xp.explorerHexSource.value);
        if (!data || !data.length) { status.textContent = 'no data in this source'; return; }

        const read = (a) => data[a];
        let hits = [];
        if (mode === 'hex') {
            const needle = explorerParseHexNeedle(text);
            if (!needle) { status.textContent = 'not hex bytes (use "CD 21 00", ? for any)'; return; }
            hits = explorerFindBytes(needle, data);
        } else if (mode === 'text') {
            const needle = Array.from(text, c => c.charCodeAt(0) & 0xff);
            hits = explorerFindBytes(needle, data);
        } else {
            const truncate = xp.chkExplorerFind5ch.checked ? 5 : 0;
            const a = searchEncoded(read, 0, data.length, text, { truncate, limit: 200 });
            const b = searchNibblePacked(read, 0, data.length,
                                         truncate ? text.slice(0, 5) : text, { limit: 200 });
            hits = a.matches.concat(b.matches).sort((x, y) => x.addr - y.addr);
        }

        if (!hits.length) {
            status.textContent = mode === 'encoded' ? 'not found in any of the encodings' : 'not found';
            return;
        }
        status.textContent = `${hits.length} hit${hits.length === 1 ? '' : 's'}` +
                             (hits.length >= 200 ? ' (stopped at the limit)' : '');

        results.innerHTML = hits.slice(0, 40).map(h => {
            let preview;
            if (h.encoding && h.encoding !== 'nibble') {
                const decoded = decodeAt(read, h.addr, h.encoding, h.key, h.length + 12, 0) || [];
                preview = decoded.map(b => {
                    const c = b & 0x7f;
                    return (c >= 0x20 && c < 0x7f) ? String.fromCharCode(c) : '.';
                }).join('');
            } else {
                preview = Array.from(data.slice(h.addr, h.addr + h.length + 12))
                    .map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.').join('');
            }
            return `<div class="explorer-find-hit" data-off="${h.addr}">` +
                   `<span class="ha">${fmtAddrCol(h.addr)}</span> ` +
                   `<span class="hc">${escapeHtml(preview)}</span>` +
                   (h.label ? ` <span class="he">${escapeHtml(h.label)}</span>` : '') +
                   `</div>`;
        }).join('') + (hits.length > 40 ? `<div class="explorer-empty">...and ${hits.length - 40} more</div>` : '');
    }

    if (xp.btnExplorerFind) {
        xp.btnExplorerFind.addEventListener('click', explorerRunFind);
        xp.explorerFindText.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') explorerRunFind();
        });
        // A hit is a way into the dump, so clicking one shows the bytes there
        xp.explorerFindResults.addEventListener('click', (e) => {
            const hit = e.target.closest('.explorer-find-hit');
            if (!hit) return;
            const off = parseInt(hit.dataset.off, 10);
            // The dump is addressed, the search is offset-based: two sources put
            // their first byte somewhere other than 0
            const addr = explorerFindBaseAddr() + off;
            xp.explorerHexAddr.value = fmtAddr(Math.max(0, addr - (addr % 16)));
            explorerRenderHexDump();
        });
    }

    // Text viewer
    xp.btnExplorerText.addEventListener('click', () => {
        explorerRenderText();
    });

    function explorerGetSourceData(source) {
        if (source && source.startsWith('bank:') && (xp.explorerParsed.type === 'sna' || xp.explorerParsed.type === 'z80' || xp.explorerParsed.type === 'szx')) {
            const bankNum = parseInt(source.slice(5));
            return xp.explorerExtractBank(bankNum);
        } else if (source === 'memory' && (xp.explorerParsed.type === 'sna' || xp.explorerParsed.type === 'z80' || xp.explorerParsed.type === 'szx')) {
            const port7FFD = xp.explorerParsed.registers.port7FFD || 0;
            const pagedBank = xp.explorerParsed.is128 ? (port7FFD & 0x07) : 0;
            const bank5 = xp.explorerExtractBank(5);
            const bank2 = xp.explorerExtractBank(2);
            const bankC = xp.explorerExtractBank(xp.explorerParsed.is128 ? pagedBank : 0);
            const mem = new Uint8Array(49152);
            if (bank5) mem.set(bank5, 0);
            if (bank2) mem.set(bank2, 16384);
            if (bankC) mem.set(bankC, 32768);
            return mem;
        } else if (source && xp.explorerParsed.type === 'tap') {
            const blockIdx = parseInt(source);
            const block = xp.explorerBlocks[blockIdx];
            if (block && block.blockType === 'data' && block.data.length > 2) return block.data.slice(1, -1);
        } else if (source && xp.explorerParsed.type === 'tzx') {
            const blockIdx = parseInt(source);
            const block = xp.explorerBlocks[blockIdx];
            if (block && (block.id === 0x10 || block.id === 0x11) && block.data && block.data.length > 2) return block.data.slice(1, -1);
        } else if (source && (xp.explorerParsed.type === 'trd' || xp.explorerParsed.type === 'scl' || xp.explorerParsed.type === 'mgt' || xp.explorerParsed.type === 'mdr')) {
            const fileIdx = parseInt(source);
            const file = xp.explorerParsed.files[fileIdx];
            if (file) {
                let result = xp.explorerParsed.type === 'mgt'
                    ? MGTLoader.extractFile(xp.explorerData, file)
                    : xp.explorerParsed.type === 'mdr'
                    ? MDRLoader.extractFile(xp.explorerData, file)
                    : xp.explorerData.slice(file.offset, file.offset + file.sectors * 256);
                if (xp.explorerParsed.type === 'mdr' && result && result.length > 9 && !file.isPrint) result = result.slice(9);
                return result;
            }
        } else if (source && (xp.explorerParsed.type === 'opd' || xp.explorerParsed.type === 'didaktik')) {
            const fileIdx = parseInt(source);
            const file = xp.explorerParsed.files[fileIdx];
            if (file) {
                const raw = xp.explorerParsed.type === 'opd'
                    ? OPDLoader.extractFile(xp.explorerData, file)
                    : DidaktikLoader.extractFile(xp.explorerData, file);
                return raw && file.length < raw.length ? raw.slice(0, file.length) : raw;
            }
        } else if (source && xp.explorerParsed.type === 'hobeta') {
            const f = xp.explorerParsed.file;
            if (f) return f.data;
        } else if (source && xp.explorerParsed.type === 'dsk') {
            if (source === 'boot') {
                const bootSector = xp.explorerParsed.dskImage.readSector(0, 0,
                    xp.explorerParsed.diskSpec && xp.explorerParsed.diskSpec.firstSectorId !== undefined
                        ? xp.explorerParsed.diskSpec.firstSectorId : 1);
                if (bootSector) return bootSector;
            } else {
                const fileIdx = parseInt(source);
                const file = xp.explorerParsed.files[fileIdx];
                if (file) {
                    const rawData = xp.DSKLoader.readFileData(
                        xp.explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
                    );
                    const hdr = file.headerSize || 0;
                    if (rawData && hdr && rawData.length > hdr) {
                        return rawData.slice(hdr, hdr + file.size);
                    }
                    return rawData ? rawData.slice(0, file.size) : rawData;
                }
            }
        } else if (xp.explorerData) {
            return xp.explorerData;
        }
        return null;
    }

    function decodeByteToText(b, codepage) {
        if (b === 0x0A) return '\n';
        if (b === 0x0D) return '\r';
        if (b === 0x09) return '\t';
        if (b < 0x20) return '\u00B7';
        if (b >= 0x20 && b <= 0x7E) return String.fromCharCode(b);
        if (b === 0x7F) return '\u00B7';
        // 0x80-0xFF
        if (codepage === 'ascii') return '\u00B7';
        if (codepage === 'iso88591') return String.fromCharCode(b);
        const table = xp.CODEPAGE_TABLES[codepage];
        if (table) return table[b - 0x80] || '\u00B7';
        return '\u00B7';
    }

    function explorerRenderText() {
        const source = xp.explorerTextSource.value;
        const codepage = xp.explorerTextCodepage.value;

        if (!xp.explorerData && !source) {
            xp.explorerTextOutput.innerHTML = '<div class="explorer-empty">No data</div>';
            return;
        }

        const data = explorerGetSourceData(source);
        if (!data || data.length === 0) {
            xp.explorerTextOutput.innerHTML = '<div class="explorer-empty">No data</div>';
            return;
        }

        let text = '';
        for (let i = 0; i < data.length; i++) {
            text += decodeByteToText(data[i], codepage);
        }

        // Escape HTML entities
        text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        xp.explorerTextOutput.innerHTML = text || '<div class="explorer-empty">No data</div>';
    }

    // Unicode block graphics for ZX Spectrum bytes 0x80-0x8F
    const BLOCK_GRAPHICS = [
        ' ',      // 0x80 empty
        '\u2598', // 0x81 ▘ upper-left
        '\u259D', // 0x82 ▝ upper-right
        '\u2580', // 0x83 ▀ upper half
        '\u2596', // 0x84 ▖ lower-left
        '\u258C', // 0x85 ▌ left half
        '\u259E', // 0x86 ▞ diagonal
        '\u259B', // 0x87 ▛ three-quarter top-left
        '\u2597', // 0x88 ▗ lower-right
        '\u259A', // 0x89 ▚ anti-diagonal
        '\u2590', // 0x8A ▐ right half
        '\u259C', // 0x8B ▜ three-quarter top-right
        '\u2584', // 0x8C ▄ lower half
        '\u2599', // 0x8D ▙ three-quarter bottom-left
        '\u259F', // 0x8E ▟ three-quarter bottom-right
        '\u2588', // 0x8F █ full block
    ];

    // BASIC view button handler
    const btnExplorerBasic = document.getElementById('btnExplorerBasic');
    if (btnExplorerBasic) {
        btnExplorerBasic.addEventListener('click', () => {
            xp.explorerBasicLines = null; // Force re-decode
            explorerRenderBASIC();
        });
    }

    // BASIC copy button handler
    const btnExplorerBasicCopy = document.getElementById('btnExplorerBasicCopy');
    const chkExplorerBasicAsListed = document.getElementById('chkExplorerBasicAsListed');
    if (btnExplorerBasicCopy) {
        btnExplorerBasicCopy.addEventListener('click', () => {
            if (!xp.explorerBasicRawData) {
                return; // Nothing decoded yet
            }
            const asListed = chkExplorerBasicAsListed && chkExplorerBasicAsListed.checked;
            const lines = decodeBasicProgram(xp.explorerBasicRawData, { deobfuscate: !asListed });
            if (lines.length === 0) return;
            // Format: strip {{}} markers from deobfuscated text
            const text = lines.map(l => l.number + ' ' + l.text.replace(/\{\{|\}\}/g, '')).join('\n');
            navigator.clipboard.writeText(text).then(() => {
                // Brief visual feedback
                const orig = btnExplorerBasicCopy.textContent;
                btnExplorerBasicCopy.textContent = 'Copied!';
                setTimeout(() => { btnExplorerBasicCopy.textContent = orig; }, 1000);
            }).catch(() => {});
        });
    }

    // View toggle handler — re-renders from cache without re-decoding
    if (xp.explorerBasicView) {
        xp.explorerBasicView.addEventListener('change', () => {
            xp.explorerBasicViewMode = xp.explorerBasicView.value;
            if (xp.explorerBasicLines) {
                xp.explorerBasicOutput.innerHTML = (xp.explorerBasicViewMode === 'screen')
                    ? renderBasicScreenMode(xp.explorerBasicLines)
                    : renderBasicCodeMode(xp.explorerBasicLines);
            }
        });
    }

    function renderBasicCodeMode(lines) {
        let html = '';
        for (const line of lines) {
            let highlighted = highlightBasicLine(line.text);

            html += `<div class="explorer-basic-line">`;
            html += `<span class="explorer-basic-linenum">${line.number}</span>`;
            html += `<span>${highlighted}</span>`;
            html += `</div>`;

            if (line.obfuscations && line.obfuscations.length > 0) {
                for (const obf of line.obfuscations) {
                    html += `<div style="color:#e67e22;font-size:10px;margin-left:60px;">`;
                    const actualNum = typeof obf.actual === 'number' ? obf.actual : parseFloat(obf.actual);
                    if (Number.isInteger(actualNum) && actualNum >= 16384 && actualNum <= 65535) {
                        html += `\u26A0 Obfuscated: "${obf.ascii}" \u2192 <span class="explorer-basic-addr" data-addr="${actualNum}" style="cursor:pointer;text-decoration:underline;color:var(--cyan)" title="Click to disassemble">${obf.actual}</span>`;
                    } else {
                        html += `\u26A0 Obfuscated: "${obf.ascii}" \u2192 ${obf.actual}`;
                    }
                    html += `</div>`;
                }
            }
        }
        return html;
    }

    function renderBasicScreenMode(lines) {
        let html = '<div class="explorer-basic-screen">';
        for (const line of lines) {
            html += '<div class="sb-line">';
            html += `<span class="sb-linenum">${line.number}</span>`;
            if (line.tokens) {
                for (const tok of line.tokens) {
                    switch (tok.type) {
                    case 'text':
                    case 'string_char':
                        html += escapeHtml(tok.value);
                        break;
                    case 'keyword':
                        html += escapeHtml(tok.value);
                        break;
                    case 'space':
                        html += ' ';
                        break;
                    case 'colon':
                        html += ':';
                        break;
                    case 'string_delim':
                        html += '"';
                        break;
                    case 'block':
                        html += BLOCK_GRAPHICS[tok.byte - 0x80] || ' ';
                        break;
                    case 'udg':
                        html += `<span class="sb-udg">${escapeHtml(tok.letter)}</span>`;
                        break;
                    case 'control':
                        break;
                    case 'hex':
                        break;
                    case 'number':
                        html += escapeHtml(tok.value);
                        break;
                    }
                }
            } else {
                html += escapeHtml(line.text);
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    }

    function explorerRenderBASIC() {
        const source = xp.explorerBasicSource.value;
        if (!source) {
            xp.explorerBasicOutput.innerHTML = '<div class="explorer-empty">Select a BASIC program source</div>';
            return;
        }

        let data = null;
        let explorerBasicInfoHeader = '';

        if (xp.explorerParsed.type === 'tap') {
            const blockIdx = parseInt(source);
            const headerBlock = xp.explorerBlocks[blockIdx];
            if (headerBlock && headerBlock.blockType === 'header' && headerBlock.headerType === 0 && blockIdx + 1 < xp.explorerBlocks.length) {
                const dataBlock = xp.explorerBlocks[blockIdx + 1];
                data = dataBlock.data.slice(1, -1);
                // Trim to program body length (varsOffset) to exclude variables area
                if (data && headerBlock.varsOffset > 0 && headerBlock.varsOffset < data.length) {
                    data = data.slice(0, headerBlock.varsOffset);
                }
            }
        } else if (xp.explorerParsed.type === 'tzx') {
            const blockIdx = parseInt(source);
            const headerBlock = xp.explorerBlocks[blockIdx];
            if (headerBlock && (headerBlock.id === 0x10 || headerBlock.id === 0x11) && headerBlock.headerTypeId === 0 && blockIdx + 1 < xp.explorerBlocks.length) {
                const dataBlock = xp.explorerBlocks[blockIdx + 1];
                if (dataBlock && (dataBlock.id === 0x10 || dataBlock.id === 0x11) && dataBlock.data) {
                    data = dataBlock.data.slice(1, -1);
                    // Trim to program body length (varsOffset) to exclude variables area
                    if (data && headerBlock.varsOffset > 0 && headerBlock.varsOffset < data.length) {
                        data = data.slice(0, headerBlock.varsOffset);
                    }
                }
            }
        } else if (xp.explorerParsed.type === 'trd' || xp.explorerParsed.type === 'scl' || xp.explorerParsed.type === 'mgt' || xp.explorerParsed.type === 'mdr') {
            const fileIdx = parseInt(source);
            const file = xp.explorerParsed.files[fileIdx];
            if (file) {
                if (xp.explorerParsed.type === 'mgt') {
                    data = MGTLoader.extractFile(xp.explorerData, file);
                    // Trim to program body length (excludes variables area)
                    if (data && (file.mgtType === 1 || file.mgtType === 16) && file.bodyLength > 0 && file.bodyLength < data.length) {
                        data = data.slice(0, file.bodyLength);
                    }
                } else if (xp.explorerParsed.type === 'mdr') {
                    data = MDRLoader.extractFile(xp.explorerData, file);
                    // MDR files include a 9-byte Spectrum header (type, length, start, etc.)
                    // Strip it so the BASIC decoder sees raw BASIC data
                    if (data && data.length > 9 && !file.isPrint) data = data.slice(9);
                } else {
                    data = xp.explorerData.slice(file.offset, file.offset + file.length);
                }
            }
        } else if (xp.explorerParsed.type === 'opd' || xp.explorerParsed.type === 'didaktik') {
            const fileIdx = parseInt(source);
            const file = xp.explorerParsed.files[fileIdx];
            if (file) {
                const raw = xp.explorerParsed.type === 'opd'
                    ? OPDLoader.extractFile(xp.explorerData, file)
                    : DidaktikLoader.extractFile(xp.explorerData, file);
                data = raw && file.length < raw.length ? raw.slice(0, file.length) : raw;
            }
        } else if (xp.explorerParsed.type === 'hobeta') {
            const f = xp.explorerParsed.file;
            if (f && f.ext === 'B') {
                data = f.data;
            }
        } else if (xp.explorerParsed.type === 'dsk') {
            const fileIdx = parseInt(source);
            const file = xp.explorerParsed.files[fileIdx];
            if (file && xp.explorerParsed.dskImage) {
                const rawData = xp.DSKLoader.readFileData(
                    xp.explorerParsed.dskImage, file.name, file.ext, file.user, file.rawSize || file.size
                );
                if (rawData) {
                    const hdr = file.headerSize || 0;
                    if (hdr && rawData.length > hdr) {
                        data = rawData.slice(hdr, hdr + file.size);
                    } else {
                        data = rawData.slice(0, file.size);
                    }
                    // Trim to program body length (varsOffset) to exclude variables area
                    if (data && file.plus3Type === 0 && file.varsOffset > 0 && file.varsOffset < data.length) {
                        data = data.slice(0, file.varsOffset);
                    }
                }
            }
        } else if (source === 'snapshot-memory' && (xp.explorerParsed.type === 'sna' || xp.explorerParsed.type === 'z80' || xp.explorerParsed.type === 'szx')) {
            const prog = xp.explorerReadSnapshotWord(0x5C53); // PROG sysvar
            const vars = xp.explorerReadSnapshotWord(0x5C4B); // VARS sysvar

            if (prog < 0x4000 || prog >= 0xFFFF) {
                xp.explorerBasicOutput.innerHTML = '<div class="explorer-empty">PROG system variable points outside RAM (' + fmtAddrSigil(prog) + ')</div>';
                return;
            }

            let basicLen = vars > prog ? vars - prog : 0;
            if (basicLen === 0 || basicLen > 0xC000) {
                basicLen = Math.min(0xFFFF - prog, 0xC000);
            }

            data = xp.explorerReadSnapshotBlock(prog, basicLen);
            explorerBasicInfoHeader = `<div style="font-size:10px;color:var(--text-secondary);margin-bottom:8px">` +
                `PROG=${fmtAddrH(prog)} ` +
                `VARS=${fmtAddrH(vars)} ` +
                `(${basicLen} bytes)</div>`;
        }

        if (!data || data.length === 0) {
            xp.explorerBasicOutput.innerHTML = '<div class="explorer-empty">No BASIC data found</div>';
            return;
        }

        try {
            xp.explorerBasicRawData = data instanceof Uint8Array ? data : new Uint8Array(data);
            const lines = decodeBasicProgram(data);

            if (lines.length === 0) {
                const hexBytes = Array.from(data.slice(0, 16)).map(b => fmtByte(b)).join(' ');
                xp.explorerBasicOutput.innerHTML = `<div class="explorer-empty">No BASIC lines found<br><span style="font-size:10px;color:var(--text-secondary)">First 16 bytes: ${hexBytes}</span></div>`;
                xp.explorerBasicRawData = null;
                return;
            }

            xp.explorerBasicLines = lines;
            xp.explorerBasicViewMode = xp.explorerBasicView ? xp.explorerBasicView.value : 'code';
            xp.explorerBasicOutput.innerHTML = explorerBasicInfoHeader + ((xp.explorerBasicViewMode === 'screen')
                ? renderBasicScreenMode(lines)
                : renderBasicCodeMode(lines));

        } catch (err) {
            xp.explorerBasicOutput.innerHTML = `<div class="explorer-empty">Error decoding BASIC: ${err.message}</div>`;
        }
    }

    function highlightBasicLine(text) {
        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        html = html.replace(/"([^"]*)"/g, '<span class="explorer-basic-string">"$1"</span>');

        const keywords = Object.values(BASIC_TOKENS).map(t => t[0]).sort((a, b) => b.length - a.length);
        for (const kw of keywords) {
            const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp('\\b(' + escaped + ')\\b', 'g');
            html = html.replace(regex, '<span class="explorer-basic-keyword">$1</span>');
        }

        html = html.replace(/(USR|PEEK|POKE|RANDOMIZE\s+USR)(\s*<[^>]+>)?\s*(\d{4,5})/gi, (match, keyword, span, addr) => {
            const addrNum = parseInt(addr);
            if (addrNum >= 16384 && addrNum <= 65535) {
                return `${keyword}${span || ''} <span class="explorer-basic-addr" data-addr="${addrNum}" style="cursor:pointer;text-decoration:underline;color:var(--cyan)" title="Click to disassemble">${addr}</span>`;
            }
            return match;
        });

        html = html.replace(/(USR|PEEK|POKE)(<\/span>)?\s*(<span[^>]*>)?VAL(<\/span>)?\s*"([\d.]+(?:[Ee][+\-]?\d+)?)"/gi, (match, keyword, kwClose, valOpen, valClose, numStr) => {
            const addrNum = Math.round(parseFloat(numStr));
            if (addrNum >= 16384 && addrNum <= 65535) {
                return `${keyword}${kwClose || ''} ${valOpen || ''}VAL${valClose || ''} "<span class="explorer-basic-addr" data-addr="${addrNum}" style="cursor:pointer;text-decoration:underline;color:var(--cyan)" title="Click to disassemble at ${addrNum}">${numStr}</span>"`;
            }
            return match;
        });

        html = html.replace(/\b(\d+(?:\.\d+)?)\b(?![^<]*>)/g, '<span class="explorer-basic-number">$1</span>');

        html = html.replace(/\{\{([^}]+)\}\}/g, '<span style="color:#e67e22;font-weight:bold">{{$1}}</span>');

        return html;
    }

    // Handle clicking on addresses in BASIC listing
    xp.explorerBasicOutput.addEventListener('click', (e) => {
        const addrSpan = e.target.closest('.explorer-basic-addr');
        if (!addrSpan) return;

        let addr = parseInt(addrSpan.dataset.addr);
        if (isNaN(addr)) return;

        document.querySelector('.explorer-subtab[data-subtab="disasm"]').click();

        let foundSource = '';

        if (xp.explorerParsed.type === 'tap') {
            for (let i = 0; i < xp.explorerBlocks.length; i++) {
                const block = xp.explorerBlocks[i];
                if (block.blockType === 'header' && block.headerType === 3) {
                    const startAddr = block.startAddress;
                    const dataBlock = xp.explorerBlocks[i + 1];
                    if (dataBlock && dataBlock.blockType === 'data') {
                        const endAddr = startAddr + dataBlock.length - 2;
                        if (addr >= startAddr && addr < endAddr) {
                            foundSource = i.toString();
                            break;
                        }
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < xp.explorerBlocks.length; i++) {
                    const block = xp.explorerBlocks[i];
                    if (block.blockType === 'data' && i > 0) {
                        const prevBlock = xp.explorerBlocks[i - 1];
                        if (prevBlock.blockType === 'header' && prevBlock.startAddress !== undefined) {
                            const startAddr = prevBlock.startAddress;
                            const endAddr = startAddr + block.length - 2;
                            if (addr >= startAddr && addr < endAddr) {
                                foundSource = 'data:' + i.toString();
                                break;
                            }
                        }
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < xp.explorerBlocks.length; i++) {
                    if (xp.explorerBlocks[i].blockType === 'data') {
                        foundSource = 'data:' + i.toString();
                        break;
                    }
                }
            }
        } else if (xp.explorerParsed.type === 'trd' || xp.explorerParsed.type === 'scl' || xp.explorerParsed.type === 'mgt' || xp.explorerParsed.type === 'mdr') {
            for (let i = 0; i < xp.explorerParsed.files.length; i++) {
                const file = xp.explorerParsed.files[i];
                if (file.ext === 'C' || file.ext === 'D' || file.ext === 'F') {
                    const endAddr = (file.startAddress || 0) + file.length;
                    if (addr >= (file.startAddress || 0) && addr < endAddr) {
                        foundSource = i.toString();
                        break;
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < xp.explorerParsed.files.length; i++) {
                    const file = xp.explorerParsed.files[i];
                    if (file.ext === 'B') {
                        const basicBase = 0x5CCB;
                        const fullSize = file.sectors * 256;
                        const endAddr = basicBase + fullSize;
                        if (addr >= basicBase && addr < endAddr) {
                            foundSource = 'basic:' + i.toString();
                            break;
                        }
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < xp.explorerParsed.files.length; i++) {
                    const file = xp.explorerParsed.files[i];
                    if (file.ext === 'C') {
                        const endAddr = file.startAddress + file.length;
                        if (addr >= file.startAddress && addr < endAddr) {
                            foundSource = i.toString();
                            break;
                        }
                    }
                }
            }

            if (!foundSource) {
                for (let i = 0; i < xp.explorerParsed.files.length; i++) {
                    const file = xp.explorerParsed.files[i];
                    if (file.ext === 'C') {
                        foundSource = i.toString();
                        if (addr < file.startAddress || addr >= file.startAddress + file.length) {
                            addr = file.startAddress;
                        }
                        break;
                    }
                }
            }
        } else if (xp.explorerParsed.type === 'sna' || xp.explorerParsed.type === 'z80') {
            foundSource = 'memory';
        }

        if (foundSource) {
            xp.explorerDisasmSource.value = foundSource;
        }

        xp.explorerDisasmAddr.value = fmtAddr(addr);
        xp.explorerDisasmLen.value = 256;

        explorerRenderDisasm();
    });

    // The views hold rendered text, so they have to be drawn again when the switch
    // is thrown -- otherwise the dump stays in the base it happened to be built in
    // until something else reloads it. Only what is actually on screen: rendering
    // a hidden panel would read boxes belonging to a file that is no longer open.
    onNumberBaseChange(() => {
        // Only a view that has already drawn something: an empty one has no file
        // behind it, and rendering it would read boxes belonging to nothing.
        const drawn = (el) => el && el.textContent && el.textContent.trim().length > 0
                              && !el.querySelector('.explorer-empty');
        if (drawn(xp.explorerHexOutput)) explorerRenderHexDump();
        if (drawn(xp.explorerDisasmOutput)) explorerRenderDisasm();
    });

    return {
        diskmapApplyHighlight,
        diskmapFormatInfo,
        diskmapGetSectorInfo,
        diskmapNavigateToSector,
        explorerRenderDSKInfo,
        explorerRenderDisasm,
        explorerRenderDiskMap,
        explorerRenderZIPInfo,
        explorerUpdateSourceSelectors,
    };
}
