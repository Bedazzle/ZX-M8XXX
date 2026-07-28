// profiler-analysis.js — pure analysis of profiler results: label generation and
// hotspot detection/classification. No DOM, no emulator handles — memory access
// and the "include ROM" choice come in as parameters, so the debugger's Profiler
// panel and the standalone profile-game.html page run the same logic.

import { hex16 } from '../core/utils.js';

export function generateProfilerLabels(results, { readByte, getMemoryInfo, includeRom = false }) {
    const labels = [];
    const usedNames = new Set();
    const framesProfiled = results.framesProfiled;

    function makeUniqueName(base) {
        if (!usedNames.has(base)) {
            usedNames.add(base);
            return base;
        }
        for (let i = 2; ; i++) {
            const name = `${base}_${i}`;
            if (!usedNames.has(name)) {
                usedNames.add(name);
                return name;
            }
        }
    }

    // Parse page from autoMapKey: "addr" | "addr:Rn" | "addr:n"
    function parseKey(key) {
        const parts = key.split(':');
        const addr = parseInt(parts[0], 10);
        let page = null;
        if (parts.length > 1) {
            const p = parts[1];
            if (p.startsWith('R')) page = p;
            else page = p;
        }
        return { addr, page };
    }

    // Helper: check if any port in set matches a mask/value pattern
    function hasPortMatch(portSet, mask, value) {
        for (const p of portSet) {
            if ((p & mask) === value) return true;
        }
        return false;
    }


    // Find main loop candidate: called in >90% of frames with most callees
    let mainLoopKey = null;
    let mainLoopMaxCallees = 0;
    for (const [key, stats] of results.subroutines) {
        if (!includeRom && stats.entryAddr < 0x4000) continue;
        const framePct = framesProfiled > 0 ? stats.framesCalled.size / framesProfiled : 0;
        if (framePct > 0.9 && stats.callees.size > mainLoopMaxCallees) {
            mainLoopMaxCallees = stats.callees.size;
            mainLoopKey = key;
        }
    }

    // IM 2 handler address (if detected)
    const im2HandlerAddr = results.im2 ? results.im2.handlerAddr : null;

    for (const [key, stats] of results.subroutines) {
        // Skip ROM subroutines (except ISR handler at $0038 and IM 2 handler)
        if (!includeRom && stats.entryAddr < 0x4000 && stats.entryAddr !== 0x0038 &&
            stats.entryAddr !== im2HandlerAddr) continue;

        const { addr, page } = parseKey(key);
        const addrHex = hex16(addr);
        let name = null;

        // Priority 1: ISR handler (IM 1 at $0038, or IM 2 at detected address)
        if (stats.calledFromISR &&
            (stats.entryAddr === 0x0038 || stats.entryAddr === im2HandlerAddr)) {
            name = makeUniqueName(stats.entryAddr === 0x0038 ? 'isr_handler' : 'isr_handler_im2');
        }
        // Priority 2: ISR routine (called from ISR context but not the handler itself)
        else if (stats.calledFromISR && stats.entryAddr !== 0x0038 &&
                 stats.entryAddr !== im2HandlerAddr) {
            name = makeUniqueName('isr_routine');
        }
        // Priority 3: Main loop
        else if (key === mainLoopKey) {
            name = makeUniqueName('main_loop');
        }
        // Priority 4: Keyboard reader
        else if (!name && stats.portsIn.size > 0 &&
                 hasPortMatch(stats.portsIn, 0x01, 0x00) &&
                 !stats.writesScreenBitmap && !stats.writesScreenAttr) {
            name = makeUniqueName('read_keyboard');
        }
        // Priority 5: Beeper
        else if (!name && stats.beeperOuts > 10) {
            name = makeUniqueName('play_beep');
        }
        // Priority 6: AY chip
        else if (!name && (hasPortMatch(stats.portsOut, 0xC002, 0xC000) ||
                           hasPortMatch(stats.portsOut, 0xC002, 0x8000))) {
            if (stats.callCount === 1) {
                name = makeUniqueName('ay_init');
            } else if (stats.callCount > 20) {
                name = makeUniqueName('play_music');
            } else {
                name = makeUniqueName('ay_write');
            }
        }
        // Priority 7: Screen bitmap only
        else if (!name && stats.writesScreenBitmap && !stats.writesScreenAttr) {
            name = makeUniqueName('draw_sprite');
        }
        // Priority 8: Screen attr only
        else if (!name && stats.writesScreenAttr && !stats.writesScreenBitmap) {
            name = makeUniqueName('set_attrs');
        }
        // Priority 9: Both bitmap and attr
        else if (!name && stats.writesScreenBitmap && stats.writesScreenAttr) {
            name = makeUniqueName('draw_screen');
        }
        // Priority 10: 128K paging
        else if (!name && hasPortMatch(stats.portsOut, 0x8002, 0x0000)) {
            name = makeUniqueName('page_memory');
        }
        // Priority 11: Disk I/O (WD1793 ports $1F/$3F/$5F/$7F or FDC $2FFD/$3FFD)
        else if (!name && (hasPortMatch(stats.portsIn, 0x00E3, 0x001F) ||
                           hasPortMatch(stats.portsOut, 0x00E3, 0x001F) ||
                           hasPortMatch(stats.portsIn, 0xF002, 0x2000) ||
                           hasPortMatch(stats.portsOut, 0xF002, 0x3000))) {
            // Distinguish read vs write
            if (hasPortMatch(stats.portsOut, 0x00FF, 0x007F) ||
                hasPortMatch(stats.portsOut, 0xF002, 0x3000)) {
                name = makeUniqueName('disk_write');
            } else {
                name = makeUniqueName('disk_read');
            }
        }
        // Priority 12: Init routine (called once, in frame 0)
        else if (!name && stats.callCount === 1 && stats.framesCalled.has(0)) {
            name = makeUniqueName('init_' + addrHex);
        }
        // Priority 13: Utility (leaf with many calls)
        else if (!name && stats.callees.size === 0 && stats.callCount > 10) {
            name = makeUniqueName('util_' + addrHex);
        }

        if (name) {
            labels.push({ address: addr, page: page, name: name });
        }
    }

    // IM 2: label vector table address
    if (results.im2) {
        const vtAddr = results.im2.vectorTableAddr;
        if (vtAddr >= 0x4000) {
            const memInfo = getMemoryInfo();
            const vtPage = (!memInfo || memInfo.machineType === '48k') ? null :
                           (vtAddr >= 0xC000 ? String(memInfo.currentRamBank) : null);
            labels.push({
                address: vtAddr,
                page: vtPage,
                name: makeUniqueName('im2_vector_table')
            });
        }
    }

    return labels;
}

export function classifyHotspot(hotspot, readByte) {
    const start = hotspot.startAddr;
    const end = hotspot.endAddr;
    // Scan for known opcode patterns
    for (let a = start; a <= end; a++) {
        const b0 = readByte(a);
        const b1 = (a + 1 <= 0xFFFF) ? readByte(a + 1) : 0;
        const b2 = (a + 2 <= 0xFFFF) ? readByte(a + 2) : 0;
        const b3 = (a + 3 <= 0xFFFF) ? readByte(a + 3) : 0;
        // HALT (0x76)
        if (b0 === 0x76) return 'frame_sync';
        // DJNZ (0x10 xx)
        if (b0 === 0x10) return 'delay_djnz';
        // LDIR (ED B0)
        if (b0 === 0xED && b1 === 0xB0) return 'block_ldir';
        // LDDR (ED B8)
        if (b0 === 0xED && b1 === 0xB8) return 'block_lddr';
        // LDI (ED A0) with branch back
        if (b0 === 0xED && b1 === 0xA0) return 'block_copy';
        // INIR (ED B2) / OTIR (ED B3)
        if (b0 === 0xED && (b1 === 0xB2 || b1 === 0xB3)) return 'io_block';
        // INDR (ED BA) / OTDR (ED BB)
        if (b0 === 0xED && (b1 === 0xBA || b1 === 0xBB)) return 'io_block';
        // DEC BC loop: 0B (DEC BC) + (78 B1 = LD A,B / OR C) or (79 B0 = LD A,C / OR B) + 20 xx (JR NZ)
        if (b0 === 0x0B && ((b1 === 0x78 && b2 === 0xB1) || (b1 === 0x79 && b2 === 0xB0)) && b3 === 0x20) return 'delay_bc';
        // IN A,(n) (DB xx) loop
        if (b0 === 0xDB) return 'io_poll';
        // ED 40-78 even = IN r,(C)
        if (b0 === 0xED && b1 >= 0x40 && b1 <= 0x78 && (b1 & 1) === 0) return 'io_poll';
        // OUT (n),A (D3 xx) loop
        if (b0 === 0xD3) return 'io_output';
        // ED 41-79 odd = OUT (C),r
        if (b0 === 0xED && b1 >= 0x41 && b1 <= 0x79 && (b1 & 1) === 1) return 'io_output';
        // POP/PUSH pairs for stack copy
        if ((b0 & 0xCF) === 0xC1 || (b0 & 0xCF) === 0xC5) return 'stack_copy';
        // EX (SP),HL (E3)
        if (b0 === 0xE3) return 'stack_copy';
    }
    return 'hotspot';
}

export function analyzeHotspots(results, { readByte, includeRom = false }) {
    const tStatesPerPC = results.tStatesPerPC;
    const totalTStates = results.totalTStates;
    if (!tStatesPerPC || tStatesPerPC.size === 0) return [];

    // Parse autoMapKey → {addr, page, tStates}
    const entries = [];
    for (const [key, tStates] of tStatesPerPC) {
        const parts = key.split(':');
        const addr = parseInt(parts[0], 10);
        const page = parts.length > 1 ? parts[1] : null;
        entries.push({ key, addr, page, tStates });
    }

    // Sort by page then address
    entries.sort((a, b) => {
        if ((a.page || '') !== (b.page || '')) return (a.page || '') < (b.page || '') ? -1 : 1;
        return a.addr - b.addr;
    });

    // Cluster consecutive addresses (max gap 4 bytes, same page)
    const clusters = [];
    let cur = null;
    for (const e of entries) {
        if (cur && e.page === cur.page && e.addr <= cur.endAddr + 5) {
            cur.entries.push(e);
            cur.endAddr = e.addr;
            cur.totalTStates += e.tStates;
        } else {
            if (cur) clusters.push(cur);
            cur = { startAddr: e.addr, endAddr: e.addr, page: e.page,
                    totalTStates: e.tStates, entries: [e] };
        }
    }
    if (cur) clusters.push(cur);

    // Filter: >1% of total T-states AND size ≤32 bytes AND not ROM
    const threshold = totalTStates * 0.01;
    const hotspots = clusters.filter(c =>
        c.totalTStates > threshold &&
        (c.endAddr - c.startAddr) <= 32 &&
        (includeRom || c.startAddr >= 0x4000)
    );

    // Classify each hotspot
    for (const hs of hotspots) {
        hs.percentage = (hs.totalTStates / totalTStates * 100).toFixed(1);
        hs.classification = classifyHotspot(hs, readByte);
    }

    hotspots.sort((a, b) => b.totalTStates - a.totalTStates);
    return hotspots;
}

export function generateHotspotLabels(hotspots, { includeRom = false } = {}) {
    const labels = [];
    const usedNames = new Set();
    for (const hs of hotspots) {
        if (!includeRom && hs.startAddr < 0x4000) continue;
        const addrHex = hex16(hs.startAddr);
        let name = `${hs.classification}_${addrHex}`;
        // Ensure unique
        if (usedNames.has(name)) {
            for (let i = 2; ; i++) {
                const n = `${name}_${i}`;
                if (!usedNames.has(n)) { name = n; break; }
            }
        }
        usedNames.add(name);
        labels.push({ address: hs.startAddr, page: hs.page, name });
    }
    return labels;
}
