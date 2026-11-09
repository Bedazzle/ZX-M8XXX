// memory-map.js — Memory Map / Heatmap dialog (extracted from index.html)
import { hex8, hex16 } from '../core/utils.js';
import { fmtAddr, fmtByte } from '../core/addr-format.js';
import { SLOT1_START, SCREEN_AFTER } from '../core/constants.js';
import { exportCtl, exportGhidraCsv, exportSym } from '../core/map-export.js';

export function initMemoryMap({ readMemory, getMemoryInfo, getRAMBanks, getAutoMapData, getAutoMapKey,
                                 parseAutoMapKey, downloadFile,
                                 regionManager, labelManager, commentManager,
                                 goToAddress, goToMemoryAddress, updateDebugger }) {

    // DOM lookups
    const memmapDialog = document.getElementById('memmapDialog');
    const memmapCanvas = document.getElementById('memmapCanvas');
    const memmapCtx = memmapCanvas.getContext('2d');
    const memmapTooltip = document.getElementById('memmapTooltip');
    const memmapStats = document.getElementById('memmapStats');
    const memmapBar = document.getElementById('memmapBar');
    const memmapAddrInfo = document.getElementById('memmapAddrInfo');
    const memmapCanvasScroll = document.getElementById('memmapCanvasScroll');
    const memmapCanvasBox = document.querySelector('.memmap-canvas-container');
    const memmapTitle = document.getElementById('memmapTitle');

    const MEMMAP_COLORS = {
        code: '#4080ff',
        smc: '#ff4040',
        db: '#ffcc00',
        dw: '#ff8800',
        text: '#40cc40',
        graphics: '#cc40cc',
        unmapped: '#606060',
        zero: '#000000'
    };

    let memmapViewMode = 'regions';
    let memmapBankMode = '64k';
    const btnMemmapRegions = document.getElementById('btnMemmapRegions');
    const btnMemmapHeatmap = document.getElementById('btnMemmapHeatmap');
    const memmapLegendRegions = document.getElementById('memmapLegendRegions');
    const memmapLegendHeatmap = document.getElementById('memmapLegendHeatmap');
    const memmapBankToggle = document.getElementById('memmapBankToggle');
    const btnMemmap64K = document.getElementById('btnMemmap64K');
    const btnMemmapBanks = document.getElementById('btnMemmapBanks');
    const memmapScale = document.querySelector('.memmap-scale');

    // One bank is 16KB: 8 of them on a 128K machine, 16 on a Scorpion and 64 on
    // a Pentagon 1024. The bank view used to draw the first 8 whatever the
    // machine had, so there was no way to look at the rest of a 256K or 1MB
    // machine at all.
    function ramPages(info) { return Math.max(1, info.ramPages || 8); }

    function ramSizeLabel(info) {
        const kb = ramPages(info) * 16;
        return kb >= 1024 ? (kb / 1024) + ' MB' : kb + 'KB';
    }

    function updateMemmapScale() {
        const romLabel = document.getElementById('memmapRomLabel');
        const bankLabel = document.getElementById('memmapBankLabel');
        const info = getMemoryInfo();
        if (!info) return;

        if (info.machineType === '48k') {
            memmapBankToggle.style.display = 'none';
            memmapBankMode = '64k';
        } else {
            memmapBankToggle.style.display = 'flex';
        }

        btnMemmapBanks.textContent = ramSizeLabel(info);
        memmapScale.style.display = (memmapBankMode === 'banks') ? 'none' : 'flex';
        if (memmapTitle) {
            memmapTitle.textContent = 'Memory Map (' +
                (memmapBankMode === 'banks' ? ramSizeLabel(info) : '64KB') + ')';
        }

        if (info.machineType === '48k') {
            romLabel.textContent = 'ROM';
            bankLabel.textContent = 'RAM';
        } else {
            romLabel.textContent = 'ROM ' + info.currentRomBank;
            bankLabel.textContent = 'Bank ' + info.currentRamBank;
        }
    }

    function openMemoryMap() {
        memmapDialog.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        memmapAddrInfo.textContent = 'Hover over map to see details\nClick to navigate';
        updateMemmapScale();
        renderCurrentMemmapView();
    }

    function renderCurrentMemmapView() {
        if (memmapBankMode === 'banks') {
            renderBankMap();
        } else {
            setCanvasBox(512, 512);
            if (memmapViewMode === 'heatmap') renderHeatmap();
            else renderMemoryMap();
        }
    }

    // The bank view is as tall as the machine has banks -- 4096 pixels on a
    // Pentagon 1024 -- so the canvas grows and its box scrolls. The box has to
    // reserve the scrollbar's width, else it would sit over the right-hand
    // column of banks; that width is measured rather than assumed, because it
    // is not the same on every platform.
    function setCanvasBox(w, h) {
        if (memmapCanvas.width !== w) memmapCanvas.width = w;
        if (memmapCanvas.height !== h) memmapCanvas.height = h;
        // offsetWidth - clientWidth is the box's frame plus its scrollbar, if one
        // is showing; the column of banks needs the full 512 inside that.
        const frame = memmapCanvasScroll.offsetWidth - memmapCanvasScroll.clientWidth;
        memmapCanvasBox.style.width = (memmapCanvas.offsetWidth + frame) + 'px';
    }

    function closeMemoryMap() {
        memmapDialog.classList.add('hidden');
        document.body.style.overflow = '';
    }

    function setMemmapView(mode) {
        memmapViewMode = mode;
        btnMemmapRegions.classList.toggle('active', mode === 'regions');
        btnMemmapHeatmap.classList.toggle('active', mode === 'heatmap');
        memmapLegendRegions.classList.toggle('hidden', mode !== 'regions');
        memmapLegendHeatmap.classList.toggle('hidden', mode !== 'heatmap');
        renderCurrentMemmapView();
    }

    function setMemmapBankMode(mode) {
        memmapBankMode = mode;
        btnMemmap64K.classList.toggle('active', mode === '64k');
        btnMemmapBanks.classList.toggle('active', mode === 'banks');
        memmapScale.style.display = (mode === 'banks') ? 'none' : 'flex';
        memmapLegendRegions.classList.toggle('hidden', memmapViewMode !== 'regions');
        memmapLegendHeatmap.classList.toggle('hidden', memmapViewMode !== 'heatmap');
        updateMemmapScale();
        renderCurrentMemmapView();
    }

    btnMemmapRegions.addEventListener('click', () => setMemmapView('regions'));
    btnMemmapHeatmap.addEventListener('click', () => setMemmapView('heatmap'));
    btnMemmap64K.addEventListener('click', () => setMemmapBankMode('64k'));
    btnMemmapBanks.addEventListener('click', () => setMemmapBankMode('banks'));

    function getMemoryMapData() {
        const data = new Array(65536);
        const stats = {
            code: 0, smc: 0, db: 0, dw: 0, text: 0, graphics: 0, unmapped: 0, zero: 0
        };

        for (let addr = 0; addr < 65536; addr++) {
            const val = readMemory(addr);
            const region = regionManager.get(addr);

            if (region) {
                data[addr] = region.type;
                stats[region.type]++;
            } else if (val === 0) {
                data[addr] = 'zero';
                stats.zero++;
            } else {
                data[addr] = 'unmapped';
                stats.unmapped++;
            }
        }

        return { data, stats };
    }

    function renderMemoryMap() {
        const { data, stats } = getMemoryMapData();
        const imageData = memmapCtx.createImageData(512, 512);

        for (let addr = 0; addr < 65536; addr++) {
            const type = data[addr];
            const color = MEMMAP_COLORS[type] || MEMMAP_COLORS.unmapped;

            const r = parseInt(color.slice(1, 3), 16);
            const g = parseInt(color.slice(3, 5), 16);
            const b = parseInt(color.slice(5, 7), 16);

            const srcX = addr & 0xFF;
            const srcY = addr >> 8;
            const dstX = srcX * 2;
            const dstY = srcY * 2;

            for (let dy = 0; dy < 2; dy++) {
                for (let dx = 0; dx < 2; dx++) {
                    const idx = ((dstY + dy) * 512 + (dstX + dx)) * 4;
                    imageData.data[idx] = r;
                    imageData.data[idx + 1] = g;
                    imageData.data[idx + 2] = b;
                    imageData.data[idx + 3] = 255;
                }
            }
        }

        memmapCtx.putImageData(imageData, 0, 0);

        const total = 65536;
        const mapped = stats.code + stats.smc + stats.db + stats.dw + stats.text + stats.graphics;

        memmapStats.innerHTML = `
            <table>
                <tr><td>Code</td><td>${stats.code.toLocaleString()}</td><td>${(stats.code/total*100).toFixed(1)}%</td></tr>
                <tr><td>SMC</td><td>${stats.smc.toLocaleString()}</td><td>${(stats.smc/total*100).toFixed(1)}%</td></tr>
                <tr><td>DB</td><td>${stats.db.toLocaleString()}</td><td>${(stats.db/total*100).toFixed(1)}%</td></tr>
                <tr><td>DW</td><td>${stats.dw.toLocaleString()}</td><td>${(stats.dw/total*100).toFixed(1)}%</td></tr>
                <tr><td>Text</td><td>${stats.text.toLocaleString()}</td><td>${(stats.text/total*100).toFixed(1)}%</td></tr>
                <tr><td>Graphics</td><td>${stats.graphics.toLocaleString()}</td><td>${(stats.graphics/total*100).toFixed(1)}%</td></tr>
                <tr><td>Unmapped</td><td>${stats.unmapped.toLocaleString()}</td><td>${(stats.unmapped/total*100).toFixed(1)}%</td></tr>
                <tr><td>Zeroes</td><td>${stats.zero.toLocaleString()}</td><td>${(stats.zero/total*100).toFixed(1)}%</td></tr>
                <tr class="total"><td>Mapped</td><td>${mapped.toLocaleString()}</td><td>${(mapped/total*100).toFixed(1)}%</td></tr>
            </table>
        `;

        const barParts = [
            { type: 'code', width: stats.code / total * 100 },
            { type: 'smc', width: stats.smc / total * 100 },
            { type: 'db', width: stats.db / total * 100 },
            { type: 'dw', width: stats.dw / total * 100 },
            { type: 'text', width: stats.text / total * 100 },
            { type: 'graphics', width: stats.graphics / total * 100 },
            { type: 'unmapped', width: stats.unmapped / total * 100 },
            { type: 'zero', width: stats.zero / total * 100 }
        ];

        memmapBar.innerHTML = '<div class="memmap-bar-fill">' +
            barParts.map(p => `<div style="width:${p.width}%;background:${MEMMAP_COLORS[p.type]}"></div>`).join('') +
            '</div>';
    }

    // Heatmap data for tooltip access
    let heatmapData = null;

    function renderHeatmap() {
        const autoMapData = getAutoMapData();
        const imageData = memmapCtx.createImageData(512, 512);

        let maxExec = 0, maxRead = 0, maxWrite = 0;
        for (const count of autoMapData.executed.values()) maxExec = Math.max(maxExec, count);
        for (const count of autoMapData.read.values()) maxRead = Math.max(maxRead, count);
        for (const count of autoMapData.written.values()) maxWrite = Math.max(maxWrite, count);

        const logScale = (count, max) => {
            if (count === 0 || max === 0) return 0;
            return Math.log(count + 1) / Math.log(max + 1);
        };

        heatmapData = {
            executed: autoMapData.executed,
            read: autoMapData.read,
            written: autoMapData.written,
            maxExec, maxRead, maxWrite
        };

        const stats = {
            executed: autoMapData.executed.size,
            read: autoMapData.read.size,
            written: autoMapData.written.size,
            totalExec: 0, totalRead: 0, totalWrite: 0
        };
        for (const count of autoMapData.executed.values()) stats.totalExec += count;
        for (const count of autoMapData.read.values()) stats.totalRead += count;
        for (const count of autoMapData.written.values()) stats.totalWrite += count;

        // Color channels: B=execute, G=read, R=write
        for (let addr = 0; addr < 65536; addr++) {
            const key = getAutoMapKey(addr);
            const execCount = autoMapData.executed.get(key) || 0;
            const readCount = autoMapData.read.get(key) || 0;
            const writeCount = autoMapData.written.get(key) || 0;

            const execIntensity = logScale(execCount, maxExec);
            const readIntensity = logScale(readCount, maxRead);
            const writeIntensity = logScale(writeCount, maxWrite);

            let r = Math.floor(writeIntensity * 255);
            let g = Math.floor(readIntensity * 255);
            let b = Math.floor(execIntensity * 255);

            const srcX = addr & 0xFF;
            const srcY = addr >> 8;
            const dstX = srcX * 2;
            const dstY = srcY * 2;

            for (let dy = 0; dy < 2; dy++) {
                for (let dx = 0; dx < 2; dx++) {
                    const idx = ((dstY + dy) * 512 + (dstX + dx)) * 4;
                    imageData.data[idx] = r;
                    imageData.data[idx + 1] = g;
                    imageData.data[idx + 2] = b;
                    imageData.data[idx + 3] = 255;
                }
            }
        }

        memmapCtx.putImageData(imageData, 0, 0);

        memmapStats.innerHTML = `
            <table>
                <tr><td>Executed addrs</td><td>${stats.executed.toLocaleString()}</td></tr>
                <tr><td>Total executions</td><td>${stats.totalExec.toLocaleString()}</td></tr>
                <tr><td>Read addrs</td><td>${stats.read.toLocaleString()}</td></tr>
                <tr><td>Total reads</td><td>${stats.totalRead.toLocaleString()}</td></tr>
                <tr><td>Written addrs</td><td>${stats.written.toLocaleString()}</td></tr>
                <tr><td>Total writes</td><td>${stats.totalWrite.toLocaleString()}</td></tr>
                <tr class="total"><td>Max exec</td><td>${maxExec.toLocaleString()}</td></tr>
                <tr class="total"><td>Max read</td><td>${maxRead.toLocaleString()}</td></tr>
                <tr class="total"><td>Max write</td><td>${maxWrite.toLocaleString()}</td></tr>
            </table>
        `;

        const totalAccesses = stats.executed + stats.read + stats.written;
        if (totalAccesses > 0) {
            const execWidth = stats.executed / totalAccesses * 100;
            const readWidth = stats.read / totalAccesses * 100;
            const writeWidth = stats.written / totalAccesses * 100;
            memmapBar.innerHTML = `<div class="memmap-bar-fill">
                <div style="width:${execWidth}%;background:#0066ff" title="Execute"></div>
                <div style="width:${readWidth}%;background:#00ff66" title="Read"></div>
                <div style="width:${writeWidth}%;background:#ff6600" title="Write"></div>
            </div>`;
        } else {
            memmapBar.innerHTML = '';
        }
    }

    // Bank view: every RAM bank the machine has, two to a row, each drawn as
    // 128-byte rows at x2 horizontal scale. Banks 5 and 2 are coloured for the
    // $4000/$8000 windows they always sit in; every other bank is coloured for
    // the $C000 window it is seen through, since regions are kept per CPU
    // address and not per bank.
    const BANK_CELL_W = 256, BANK_CELL_H = 128, BANK_ROW_BYTES = 128;

    function bankGrid(info) {
        const pages = ramPages(info);
        return { pages, rows: Math.ceil(pages / 2) };
    }

    // Where a bank's byte answers when that bank is paged in.
    function bankCpuAddr(bank, off) {
        if (bank === 5) return 0x4000 + off;
        if (bank === 2) return 0x8000 + off;
        return 0xC000 + off;
    }

    // Whether the debugger could show that byte now: the disassembly and the
    // dumps read the paged 64K, so a bank outside a window has no address to go
    // to. (Normal paging only -- the +2A/+3 special modes and the Scorpion's
    // extra bits move more than the $C000 window.)
    function bankIsPaged(info, bank) {
        return bank === 5 || bank === 2 || bank === info.currentRamBank;
    }

    function rgbOf(color) {
        return [parseInt(color.slice(1, 3), 16),
                parseInt(color.slice(3, 5), 16),
                parseInt(color.slice(5, 7), 16)];
    }

    function renderBankMap() {
        const info = getMemoryInfo();
        if (!info || info.machineType === '48k') return;
        const ramBanks = getRAMBanks();
        const grid = bankGrid(info);
        const width = 512, height = grid.rows * BANK_CELL_H;
        setCanvasBox(width, height);

        const imageData = memmapCtx.createImageData(width, height);

        let heatData = null, maxExec = 0, maxRead = 0, maxWrite = 0;
        if (memmapViewMode === 'heatmap') {
            const autoMapData = getAutoMapData();
            heatData = autoMapData;
            for (const count of autoMapData.executed.values()) maxExec = Math.max(maxExec, count);
            for (const count of autoMapData.read.values()) maxRead = Math.max(maxRead, count);
            for (const count of autoMapData.written.values()) maxWrite = Math.max(maxWrite, count);
            heatmapData = {
                executed: autoMapData.executed,
                read: autoMapData.read,
                written: autoMapData.written,
                maxExec, maxRead, maxWrite
            };
        } else {
            heatmapData = null;
        }

        const logScale = (count, max) => {
            if (count === 0 || max === 0) return 0;
            return Math.log(count + 1) / Math.log(max + 1);
        };

        // A region lookup per byte is 64 of them per bank-full on a Pentagon
        // 1024; the answer only depends on the window, so each window is asked
        // once and the rest is a table read.
        const windowRgb = {};
        if (memmapViewMode !== 'heatmap') {
            for (const base of [0x4000, 0x8000, 0xC000]) {
                const table = new Array(0x4000);
                for (let off = 0; off < 0x4000; off++) {
                    const region = regionManager.get(base + off);
                    table[off] = region
                        ? rgbOf(MEMMAP_COLORS[region.type] || MEMMAP_COLORS.unmapped)
                        : null;
                }
                windowRgb[base] = table;
            }
        }
        const zeroRgb = rgbOf(MEMMAP_COLORS.zero);
        const unmappedRgb = rgbOf(MEMMAP_COLORS.unmapped);

        for (let bank = 0; bank < grid.pages; bank++) {
            const baseX = (bank % 2) * BANK_CELL_W;
            const baseY = Math.floor(bank / 2) * BANK_CELL_H;
            const ramBank = ramBanks[bank];
            if (!ramBank) continue;
            const windowBase = bank === 5 ? 0x4000 : bank === 2 ? 0x8000 : 0xC000;
            const table = windowRgb[windowBase];

            for (let addr = 0; addr < 0x4000; addr++) {
                const val = ramBank[addr];
                let r, g, b2;

                if (memmapViewMode === 'heatmap' && heatData) {
                    const cpuAddr = windowBase + addr;
                    const key = (bank === 5 || bank === 2)
                        ? cpuAddr.toString()
                        : `${cpuAddr}:${bank}`;
                    r = Math.floor(logScale(heatData.written.get(key) || 0, maxWrite) * 255);
                    g = Math.floor(logScale(heatData.read.get(key) || 0, maxRead) * 255);
                    b2 = Math.floor(logScale(heatData.executed.get(key) || 0, maxExec) * 255);
                } else {
                    const rgb = table[addr] || (val === 0 ? zeroRgb : unmappedRgb);
                    r = rgb[0]; g = rgb[1]; b2 = rgb[2];
                }

                const px = baseX + (addr % BANK_ROW_BYTES) * 2;
                const py = baseY + Math.floor(addr / BANK_ROW_BYTES);
                let idx = (py * width + px) * 4;
                for (let dx = 0; dx < 2; dx++) {
                    imageData.data[idx] = r;
                    imageData.data[idx + 1] = g;
                    imageData.data[idx + 2] = b2;
                    imageData.data[idx + 3] = 255;
                    idx += 4;
                }
            }
        }

        memmapCtx.putImageData(imageData, 0, 0);

        // Grid lines
        memmapCtx.strokeStyle = '#444';
        memmapCtx.lineWidth = 1;
        memmapCtx.beginPath();
        memmapCtx.moveTo(BANK_CELL_W, 0);
        memmapCtx.lineTo(BANK_CELL_W, height);
        memmapCtx.stroke();
        for (let row = 1; row < grid.rows; row++) {
            memmapCtx.beginPath();
            memmapCtx.moveTo(0, row * BANK_CELL_H);
            memmapCtx.lineTo(width, row * BANK_CELL_H);
            memmapCtx.stroke();
        }

        // Bank labels: the window for the two that always have one, and green
        // for whichever bank is paged at $C000 right now.
        memmapCtx.font = '11px monospace';
        for (let bank = 0; bank < grid.pages; bank++) {
            if (!ramBanks[bank]) continue;
            const x = (bank % 2) * BANK_CELL_W + 4;
            const y = Math.floor(bank / 2) * BANK_CELL_H + 14;
            memmapCtx.fillStyle = (bank === info.currentRamBank) ? '#00ff00' : '#888';
            let text = 'Bank ' + bank;
            if (bank === 5) text += ' ($4000)';
            else if (bank === 2) text += ' ($8000)';
            memmapCtx.fillText(text, x, y);
        }

        // Stats
        let totalZero = 0, totalNonZero = 0;
        for (let bank = 0; bank < grid.pages; bank++) {
            const ramBank = ramBanks[bank];
            if (!ramBank) continue;
            for (let addr = 0; addr < 0x4000; addr++) {
                if (ramBank[addr] === 0) totalZero++;
                else totalNonZero++;
            }
        }
        const total = totalZero + totalNonZero;
        memmapStats.innerHTML = `
            <table>
                <tr><td>Total RAM</td><td>${ramSizeLabel(info)}</td></tr>
                <tr><td>Banks</td><td>${grid.pages}</td><td>16KB each</td></tr>
                <tr><td>Non-zero</td><td>${totalNonZero.toLocaleString()}</td><td>${(totalNonZero/total*100).toFixed(1)}%</td></tr>
                <tr><td>Zeroes</td><td>${totalZero.toLocaleString()}</td><td>${(totalZero/total*100).toFixed(1)}%</td></tr>
                <tr class="total"><td>Current</td><td colspan="2">Bank ${info.currentRamBank}</td></tr>
            </table>
        `;
        memmapBar.innerHTML = '';
    }

    function getAddrFromCanvasPos(x, y) {
        const rect = memmapCanvas.getBoundingClientRect();
        const scaleX = 512 / rect.width;
        const scaleY = 512 / rect.height;
        const px = Math.floor((x - rect.left) * scaleX / 2);
        const py = Math.floor((y - rect.top) * scaleY / 2);
        if (px < 0 || px >= 256 || py < 0 || py >= 256) return -1;
        return py * 256 + px;
    }

    // The inverse of the bank layout: which bank was pointed at, and how far
    // into it. Reading the hover as a flat 64K address (which is all there used
    // to be) named the wrong byte in every bank but the first.
    function getBankPosFromCanvasPos(x, y) {
        const info = getMemoryInfo();
        if (!info) return null;
        const grid = bankGrid(info);
        const rect = memmapCanvas.getBoundingClientRect();
        const cx = Math.floor((x - rect.left) * (memmapCanvas.width / rect.width));
        const cy = Math.floor((y - rect.top) * (memmapCanvas.height / rect.height));
        if (cx < 0 || cy < 0 || cx >= memmapCanvas.width || cy >= memmapCanvas.height) return null;
        const bank = Math.floor(cy / BANK_CELL_H) * 2 + Math.floor(cx / BANK_CELL_W);
        if (bank >= grid.pages) return null;
        const off = (cy % BANK_CELL_H) * BANK_ROW_BYTES +
                    Math.floor((cx % BANK_CELL_W) / 2);
        return { bank, off, cpuAddr: bankCpuAddr(bank, off) };
    }

    // The tooltip is placed against the scrolling box, not the canvas, so it
    // stays under the pointer once the bank view has been scrolled.
    function placeTooltip(e) {
        const box = memmapCanvasScroll.getBoundingClientRect();
        memmapTooltip.style.left = (e.clientX - box.left + 10) + 'px';
        memmapTooltip.style.top = (e.clientY - box.top - 20) + 'px';
    }

    function showBankInfo(e) {
        const pos = getBankPosFromCanvasPos(e.clientX, e.clientY);
        if (!pos) {
            memmapTooltip.style.display = 'none';
            return;
        }
        const info = getMemoryInfo();
        const ramBanks = getRAMBanks();
        const val = ramBanks[pos.bank] ? ramBanks[pos.bank][pos.off] : 0;
        const label = labelManager.get(pos.cpuAddr);
        const where = `Bank ${pos.bank} ${fmtAddr(pos.cpuAddr)}`;
        let short, long;

        if (memmapViewMode === 'heatmap' && heatmapData) {
            const key = (pos.bank === 5 || pos.bank === 2)
                ? String(pos.cpuAddr) : `${pos.cpuAddr}:${pos.bank}`;
            const execCount = heatmapData.executed.get(key) || 0;
            const readCount = heatmapData.read.get(key) || 0;
            const writeCount = heatmapData.written.get(key) || 0;
            short = `${where}: E:${execCount} R:${readCount} W:${writeCount}`;
            long = `${where}\nValue: ${hex8(val)} (${val})` +
                   `\nExecuted: ${execCount.toLocaleString()} times` +
                   `\nRead: ${readCount.toLocaleString()} times` +
                   `\nWritten: ${writeCount.toLocaleString()} times`;
        } else {
            const region = regionManager.get(pos.cpuAddr);
            const type = region ? region.type : (val === 0 ? 'Zero' : 'Unmapped');
            short = `${where}: ${fmtByte(val)} - ${type}`;
            long = `${where}\nValue: ${hex8(val)} (${val})\nType: ${type}`;
            if (region && region.comment) long += `\n${region.comment}`;
        }
        if (label) {
            short += ` [${label.name}]`;
            long += `\nLabel: ${label.name}`;
        }
        long += bankIsPaged(info, pos.bank)
            ? '\nClick to navigate'
            : '\nNot paged in - page the bank to navigate';

        memmapTooltip.textContent = short;
        memmapTooltip.style.display = 'block';
        placeTooltip(e);
        memmapAddrInfo.textContent = long;
    }

    memmapCanvas.addEventListener('mousemove', (e) => {
        if (memmapBankMode === 'banks') {
            showBankInfo(e);
            return;
        }
        const addr = getAddrFromCanvasPos(e.clientX, e.clientY);
        if (addr < 0) {
            memmapTooltip.style.display = 'none';
            return;
        }

        const val = readMemory(addr);
        const label = labelManager.get(addr);
        let info, infoText;

        if (memmapViewMode === 'heatmap' && heatmapData) {
            const key = getAutoMapKey(addr);
            const execCount = heatmapData.executed.get(key) || 0;
            const readCount = heatmapData.read.get(key) || 0;
            const writeCount = heatmapData.written.get(key) || 0;

            info = `${fmtAddr(addr)}: E:${execCount} R:${readCount} W:${writeCount}`;
            if (label) info += ` [${label.name}]`;

            const addrHi = hex8(addr >> 8);
            const addrLo = hex8(addr & 0xFF);
            infoText = `Address: ${fmtAddr(addr)} (${addrHi}xx + ${addrLo})\nValue: ${hex8(val)} (${val})`;
            infoText += `\nExecuted: ${execCount.toLocaleString()} times`;
            infoText += `\nRead: ${readCount.toLocaleString()} times`;
            infoText += `\nWritten: ${writeCount.toLocaleString()} times`;
            if (label) infoText += `\nLabel: ${label.name}`;
        } else {
            const region = regionManager.get(addr);
            const type = region ? region.type : (val === 0 ? 'Zero' : 'Unmapped');

            info = `${fmtAddr(addr)}: ${fmtByte(val)} - ${type}`;
            if (label) info += ` [${label.name}]`;

            const addrHi = hex8(addr >> 8);
            const addrLo = hex8(addr & 0xFF);
            infoText = `Address: ${fmtAddr(addr)} (${addrHi}xx + ${addrLo})\nValue: ${hex8(val)} (${val})\nType: ${type}`;
            if (region && region.comment) infoText += `\n${region.comment}`;
            if (label) infoText += `\nLabel: ${label.name}`;
        }

        memmapTooltip.textContent = info;
        memmapTooltip.style.display = 'block';
        placeTooltip(e);
        memmapAddrInfo.textContent = infoText;
    });

    memmapCanvas.addEventListener('mouseleave', () => {
        memmapTooltip.style.display = 'none';
    });

    memmapCanvas.addEventListener('click', (e) => {
        if (memmapBankMode === 'banks') {
            const pos = getBankPosFromCanvasPos(e.clientX, e.clientY);
            const info = getMemoryInfo();
            if (!pos || !info) return;
            if (!bankIsPaged(info, pos.bank)) {
                memmapAddrInfo.textContent = `Bank ${pos.bank} ${fmtAddr(pos.cpuAddr)}` +
                    '\nThat bank is not paged in, so there is no' +
                    '\naddress to go to. Page it at $C000 first.';
                return;
            }
            closeMemoryMap();
            goToAddress(pos.cpuAddr);
            goToMemoryAddress(pos.cpuAddr);
            updateDebugger();
            return;
        }
        const addr = getAddrFromCanvasPos(e.clientX, e.clientY);
        if (addr >= 0) {
            closeMemoryMap();
            goToAddress(addr);
            goToMemoryAddress(addr);
            updateDebugger();
        }
    });

    function exportHeatmapData() {
        const autoMapData = getAutoMapData();
        const skipRom = document.getElementById('chkHeatSkipRom').checked;
        const skipScreen = document.getElementById('chkHeatSkipScreen').checked;

        // Collect all unique keys from all 3 maps
        const allKeys = new Set();
        for (const key of autoMapData.executed.keys()) allKeys.add(key);
        for (const key of autoMapData.read.keys()) allKeys.add(key);
        for (const key of autoMapData.written.keys()) allKeys.add(key);

        // Parse, filter, and collect entries
        const entries = [];
        for (const key of allKeys) {
            const { addr, page } = parseAutoMapKey(key);
            const execCount = autoMapData.executed.get(key) || 0;
            const readCount = autoMapData.read.get(key) || 0;
            const writeCount = autoMapData.written.get(key) || 0;
            if (execCount === 0 && readCount === 0 && writeCount === 0) continue;

            // Skip ROM: addr < SLOT1_START with ROM page or no page (48K ROM)
            if (skipRom && addr < SLOT1_START && (page === null || page.startsWith('R'))) continue;
            // Skip screen: bitmap + attributes SLOT1_START-SCREEN_AFTER
            if (skipScreen && addr >= SLOT1_START && addr < SCREEN_AFTER && (page === null || page === '5')) continue;

            entries.push({ addr, page, execCount, readCount, writeCount });
        }

        // Sort: page (null first, then R0, R1, then numeric ascending), then addr
        entries.sort((a, b) => {
            const pa = a.page, pb = b.page;
            if (pa !== pb) {
                if (pa === null) return -1;
                if (pb === null) return 1;
                const aIsRom = pa.startsWith('R'), bIsRom = pb.startsWith('R');
                if (aIsRom && !bIsRom) return -1;
                if (!aIsRom && bIsRom) return 1;
                if (aIsRom && bIsRom) return pa.localeCompare(pb);
                return parseInt(pa) - parseInt(pb);
            }
            return a.addr - b.addr;
        });

        // Build TSV
        const lines = ['Address\tPage\tExec\tRead\tWrite'];
        for (const e of entries) {
            lines.push(`$${hex16(e.addr)}\t${e.page || ''}\t${e.execCount}\t${e.readCount}\t${e.writeCount}`);
        }
        downloadFile('heatmap.txt', lines.join('\n'));
    }

    function findFreeRanges(accessed, startAddr, endAddr, skipScreen, page) {
        const ranges = [];
        let runStart = -1;
        let prevAddr = -2;
        for (let addr = startAddr; addr <= endAddr; addr++) {
            if (skipScreen && addr >= SLOT1_START && addr < SCREEN_AFTER) continue;
            if (!accessed.has(addr)) {
                if (addr !== prevAddr + 1) {
                    if (runStart >= 0) ranges.push({ start: runStart, end: prevAddr, page });
                    runStart = addr;
                }
                prevAddr = addr;
            } else {
                if (runStart >= 0) {
                    ranges.push({ start: runStart, end: prevAddr, page });
                    runStart = -1;
                }
            }
        }
        if (runStart >= 0) ranges.push({ start: runStart, end: prevAddr, page });
        return ranges;
    }

    function exportFreeAddresses() {
        const autoMapData = getAutoMapData();
        const skipRom = document.getElementById('chkHeatSkipRom').checked;
        const skipScreen = document.getElementById('chkHeatSkipScreen').checked;
        const info = getMemoryInfo();
        const is128k = info && info.machineType !== '48k';
        const numBanks = is128k ? getRAMBanks().length : 0;

        // Flat accessed set for fixed memory (0x0000-0xBFFF, or full 64K on 48K)
        // Per-bank accessed sets for paged region (0xC000-0xFFFF on 128K)
        const flatAccessed = new Set();
        const bankAccessed = new Map(); // bank number -> Set of addresses

        function addAccess(key) {
            const { addr, page } = parseAutoMapKey(key);
            if (is128k && addr >= 0xC000 && page !== null && !page.startsWith('R')) {
                const bank = parseInt(page);
                if (!bankAccessed.has(bank)) bankAccessed.set(bank, new Set());
                bankAccessed.get(bank).add(addr);
            } else {
                flatAccessed.add(addr);
            }
        }

        for (const key of autoMapData.executed.keys()) addAccess(key);
        for (const key of autoMapData.read.keys()) addAccess(key);
        for (const key of autoMapData.written.keys()) addAccess(key);

        const startAddr = skipRom ? SLOT1_START : 0x0000;
        const flatEnd = is128k ? 0xBFFF : 0xFFFF;

        // Scan fixed region
        const ranges = findFreeRanges(flatAccessed, startAddr, flatEnd, skipScreen, '');

        // Scan each bank for 0xC000-0xFFFF (128K only)
        if (is128k) {
            for (let bank = 0; bank < numBanks; bank++) {
                const accessed = bankAccessed.get(bank) || new Set();
                const bankRanges = findFreeRanges(accessed, 0xC000, 0xFFFF, false, String(bank));
                ranges.push(...bankRanges);
            }
        }

        // Filter out runs shorter than 10 bytes, sort by length descending
        const filtered = ranges
            .map(r => ({ ...r, length: r.end - r.start + 1 }))
            .filter(r => r.length >= 10)
            .sort((a, b) => b.length - a.length);

        // Build TSV
        const lines = ['Start\tEnd\tLength\tPage'];
        for (const r of filtered) {
            lines.push(`$${hex16(r.start)}\t$${hex16(r.end)}\t${r.length}\t${r.page}`);
        }
        downloadFile('free-addresses.txt', lines.join('\n'));
    }

    document.getElementById('btnHeatmapExportFree').addEventListener('click', exportFreeAddresses);
    document.getElementById('btnHeatmapExport').addEventListener('click', exportHeatmapData);

    // ---- Disassembly-toolchain exports (.ctl / Ghidra CSV / .sym) ----
    // Turn the recorded Auto-Map + labels/regions/comments into the interchange
    // formats the ZX-disasm workflow consumes (see core/map-export.js).

    // Filter the raw auto-map to a plain {executed,read,written} of key→count,
    // honouring the same Skip ROM / Skip screen checkboxes as the heatmap export.
    function filteredMapData() {
        const src = getAutoMapData();
        const skipRom = document.getElementById('chkHeatSkipRom').checked;
        const skipScreen = document.getElementById('chkHeatSkipScreen').checked;
        const keep = (key) => {
            const { addr, page } = parseAutoMapKey(key);
            if (skipRom && addr < SLOT1_START && (page === null || page.startsWith('R'))) return false;
            if (skipScreen && addr >= SLOT1_START && addr < SCREEN_AFTER && (page === null || page === '5')) return false;
            return true;
        };
        const filt = (m) => {
            const out = new Map();
            if (m) for (const [k, v] of m) if (keep(k)) out.set(k, v);
            return out;
        };
        return { executed: filt(src.executed), read: filt(src.read), written: filt(src.written) };
    }

    function exportInputs() {
        return {
            mapData: filteredMapData(),
            regions: regionManager ? regionManager.getAll() : [],
            labels: labelManager ? labelManager.getAll() : [],
            comments: commentManager ? commentManager.getAll() : [],
            readByte: (addr) => readMemory(addr),
            title: 'Generated by ZX-M8XXX Auto-Map'
        };
    }

    document.getElementById('btnMapExportCtl').addEventListener('click', () => {
        downloadFile('automap.ctl', exportCtl(exportInputs()));
    });
    document.getElementById('btnMapExportCsv').addEventListener('click', () => {
        const { labels, comments } = exportInputs();
        downloadFile('labels.csv', exportGhidraCsv({ labels, comments }));
    });
    document.getElementById('btnMapExportSym').addEventListener('click', () => {
        downloadFile('labels.sym', exportSym({ labels: labelManager ? labelManager.getAll() : [] }));
    });
    document.getElementById('btnMemoryMap').addEventListener('click', openMemoryMap);
    document.getElementById('btnMemmapClose').addEventListener('click', closeMemoryMap);
    memmapDialog.addEventListener('click', (e) => {
        if (e.target === memmapDialog) closeMemoryMap();
    });
}
