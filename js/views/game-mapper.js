// Game Mapper — room-by-room screen capture, blending, stamping, and PNG export.
// Extracted from monolith index.html v0.9.31.
//
// Source locations in upstream_index.html:
//   Class GameMapper:          lines 13144–13377
//   Instance creation:         line 13379
//   DOM refs & functions:      lines 40404–41131
//   Event listener wiring:     lines 41134–41366
//   Keyboard shortcuts:        lines 34251–34297 (in global keydown handler)
//
// External dependencies (injected via initGameMapper):
//   spectrum — emulator instance, used for getScreenDimensions()

// ========== GameMapper class ==========

class GameMapper {
    constructor() {
        this.version = 2;
        this.metadata = { author: '', game: '', level: '', created: '', modified: '' };
        this.captureRegion = { x: 0, y: 0, w: 32, h: 24 };
        this.rooms = new Map(); // keys: "x,y,z"
        this.currentX = 0;
        this.currentY = 0;
        this.currentFloor = 0;
        this.highlightColor = '#4ecdc4';
        this.gapH = 0; // horizontal gap between rooms in pixels
        this.gapV = 0; // vertical gap between rooms in pixels
        this.floorGap = 8; // gap between floors in composite export
        this.exportLayout = 'separate'; // 'separate' | '1x' | '2x' .. '5x' | 'x1' | 'x2' .. 'x5'
        this.overviewZoom = 'fit'; // 'fit' | 'x1' | 'x2'
        this.overviewFollow = false; // auto-scroll to current room in x1/x2
        this._imageCache = new Map();
    }

    _key(x, y, z) { return x + ',' + y + ',' + z; }
    get currentRoom() { return this._key(this.currentX, this.currentY, this.currentFloor); }

    getRoom(key) { return this.rooms.get(key) || null; }
    getCurrentRoom() { return this.getRoom(this.currentRoom); }

    ensureRoom(key) {
        if (!this.rooms.has(key)) {
            this.rooms.set(key, { screenshots: [], selectedIndex: 0, blended: null, stamps: [], _baseBlend: null, mark: null });
        }
        return this.rooms.get(key);
    }

    addScreenshot(dataUrl) {
        const room = this.ensureRoom(this.currentRoom);
        room.screenshots.push(dataUrl);
        room.selectedIndex = room.screenshots.length - 1;
        this._imageCache.delete(dataUrl);
    }

    deleteScreenshot(index) {
        const room = this.getCurrentRoom();
        if (!room || index < 0 || index >= room.screenshots.length) return;
        const removed = room.screenshots.splice(index, 1)[0];
        this._imageCache.delete(removed);
        if (room.screenshots.length === 0) {
            if (!room.blended) {
                this.rooms.delete(this.currentRoom);
            } else {
                room.selectedIndex = -1;
            }
        } else {
            if (room.selectedIndex >= room.screenshots.length) {
                room.selectedIndex = room.screenshots.length - 1;
            }
        }
        if (room && room.blended) {
            this._imageCache.delete(room.blended);
            room.blended = null;
            room._baseBlend = null;
            room.stamps = [];
            if (room.selectedIndex === -1 && room.screenshots.length > 0) {
                room.selectedIndex = 0;
            }
        }
    }

    deleteCurrentScreenshot() {
        const room = this.getCurrentRoom();
        if (!room) return;
        this.deleteScreenshot(room.selectedIndex);
    }

    move(dx, dy) {
        this.currentX += dx;
        this.currentY += dy;
    }

    moveFloor(dz) {
        this.currentFloor += dz;
    }

    selectRoom(x, y, z) {
        this.currentX = x;
        this.currentY = y;
        if (z !== undefined) this.currentFloor = z;
    }

    // Get 2D bounds for a specific floor (or all floors if floor is null)
    getBounds(floor) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let found = false;
        for (const key of this.rooms.keys()) {
            const parts = key.split(',').map(Number);
            const [x, y, z] = parts;
            if (floor != null && z !== floor) continue;
            found = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        if (!found) return null;
        return { minX, maxX, minY, maxY };
    }

    // Get sorted list of floors that have rooms
    getFloors() {
        const floors = new Set();
        for (const key of this.rooms.keys()) {
            const z = parseInt(key.split(',')[2]) || 0;
            floors.add(z);
        }
        return [...floors].sort((a, b) => a - b);
    }

    // Count rooms on a specific floor (or all if floor is null)
    getRoomCount(floor) {
        if (floor == null) return this.rooms.size;
        let count = 0;
        for (const key of this.rooms.keys()) {
            if ((parseInt(key.split(',')[2]) || 0) === floor) count++;
        }
        return count;
    }

    // Iterate rooms on a given floor
    getRoomsOnFloor(floor) {
        const result = [];
        for (const [key, room] of this.rooms) {
            const parts = key.split(',').map(Number);
            if (parts[2] === floor) result.push({ key, x: parts[0], y: parts[1], z: parts[2], room });
        }
        return result;
    }

    getDisplayImage(room) {
        if (!room) return null;
        if (room.selectedIndex === -1 && room.blended) return room.blended;
        if (room.selectedIndex >= 0 && room.selectedIndex < room.screenshots.length) {
            return room.screenshots[room.selectedIndex];
        }
        if (room.screenshots.length > 0) return room.screenshots[0];
        if (room.blended) return room.blended;
        return null;
    }

    loadCachedImage(dataUrl) {
        if (this._imageCache.has(dataUrl)) return Promise.resolve(this._imageCache.get(dataUrl));
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => { this._imageCache.set(dataUrl, img); resolve(img); };
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    exportJSON() {
        const roomsObj = {};
        for (const [key, room] of this.rooms) {
            roomsObj[key] = {
                screenshots: room.screenshots,
                selectedIndex: room.selectedIndex,
                blended: room.blended,
                stamps: room.stamps || [],
                _baseBlend: room._baseBlend || null,
                mark: room.mark || null
            };
        }
        return JSON.stringify({
            version: this.version,
            metadata: { ...this.metadata, modified: new Date().toISOString() },
            captureRegion: { ...this.captureRegion },
            rooms: roomsObj,
            currentRoom: this.currentRoom,
            highlightColor: this.highlightColor,
            gapH: this.gapH,
            gapV: this.gapV,
            floorGap: this.floorGap,
            exportLayout: this.exportLayout,
            overviewZoom: this.overviewZoom,
            overviewFollow: this.overviewFollow
        });
    }

    importJSON(json) {
        const data = typeof json === 'string' ? JSON.parse(json) : json;
        this.version = data.version || 1;
        this.metadata = data.metadata || { author: '', game: '', level: '', created: '', modified: '' };
        this.captureRegion = data.captureRegion || { x: 0, y: 0, w: 32, h: 24 };
        this.highlightColor = data.highlightColor || '#4ecdc4';
        this.gapH = data.gapH != null ? data.gapH : (data.gap || 0);
        this.gapV = data.gapV != null ? data.gapV : (data.gap || 0);
        this.floorGap = data.floorGap != null ? data.floorGap : 8;
        // Migrate old layout values
        const el = data.exportLayout || 'separate';
        this.exportLayout = el === 'horizontal' ? 'x1' : el === 'vertical' ? '1x' : el === 'grid' ? 'separate' : el;
        this.overviewZoom = data.overviewZoom || 'fit';
        this.overviewFollow = data.overviewFollow || false;
        this.rooms.clear();
        this._imageCache.clear();
        if (data.rooms) {
            for (const [key, room] of Object.entries(data.rooms)) {
                // Migrate v1 "x,y" keys to v2 "x,y,0"
                const normalKey = key.split(',').length === 2 ? key + ',0' : key;
                this.rooms.set(normalKey, {
                    screenshots: room.screenshots || [],
                    selectedIndex: room.selectedIndex != null ? room.selectedIndex : 0,
                    blended: room.blended || null,
                    stamps: room.stamps || [],
                    _baseBlend: room._baseBlend || null,
                    mark: room.mark || null
                });
            }
        }
        if (data.currentRoom) {
            const parts = data.currentRoom.split(',').map(Number);
            this.currentX = parts[0];
            this.currentY = parts[1];
            this.currentFloor = parts[2] || 0;
        }
    }

    clear() {
        this.metadata = { author: '', game: '', level: '', created: '', modified: '' };
        this.captureRegion = { x: 0, y: 0, w: 32, h: 24 };
        this.gapH = 0;
        this.gapV = 0;
        this.rooms.clear();
        this._imageCache.clear();
        this.currentX = 0;
        this.currentY = 0;
        this.currentFloor = 0;
    }
}

// ========== Singleton instance ==========

const gameMapper = new GameMapper();

// ========== UI functions ==========

// Injected dependency
let spectrum = null;

// DOM element references (set in initGameMapper)
let mapperOverviewCanvas, mapperOverviewCtx;
let mapperOverviewPlaceholder;
let mapperThumbStrip;
let mapperSettingsPanel;
let mapperOverviewLayout = null;

// Debounce guard for mapper button/key actions to prevent double-fire
let _mapperActionTime = 0;
function mapperAction(action) {
    const now = Date.now();
    if (now - _mapperActionTime < 150) return;
    _mapperActionTime = now;
    action();
}

// Capture the current emulator screen region as a screenshot for the current room.
function mapperCaptureScreen() {
    const screenCanvas = document.getElementById('screen');
    const dims = spectrum.getScreenDimensions();
    const reg = gameMapper.captureRegion;
    const px = reg.x * 8;
    const py = reg.y * 8;
    const pw = reg.w * 8;
    const ph = reg.h * 8;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = pw;
    tempCanvas.height = ph;
    const tempCtx = tempCanvas.getContext('2d');

    const sx = dims.borderLeft + px;
    const sy = dims.borderTop + py;
    tempCtx.drawImage(screenCanvas, sx, sy, pw, ph, 0, 0, pw, ph);

    const dataUrl = tempCanvas.toDataURL('image/png');
    gameMapper.addScreenshot(dataUrl);
    mapperUpdateUI();
}

// Refresh all mapper UI elements: room label, settings fields, thumbnails, overview.
function mapperUpdateUI() {
    document.getElementById('mapperRoomLabel').textContent =
        '(' + gameMapper.currentX + ', ' + gameMapper.currentY + ')';
    document.getElementById('mapperFloorLabel').textContent = gameMapper.currentFloor;

    document.getElementById('mapperRegionX').value = gameMapper.captureRegion.x;
    document.getElementById('mapperRegionY').value = gameMapper.captureRegion.y;
    document.getElementById('mapperRegionW').value = gameMapper.captureRegion.w;
    document.getElementById('mapperRegionH').value = gameMapper.captureRegion.h;
    const regionLocked = gameMapper.getRoomCount() > 0;
    document.getElementById('mapperRegionX').disabled = regionLocked;
    document.getElementById('mapperRegionY').disabled = regionLocked;
    document.getElementById('mapperRegionW').disabled = regionLocked;
    document.getElementById('mapperRegionH').disabled = regionLocked;
    document.getElementById('mapperGapH').value = gameMapper.gapH;
    document.getElementById('mapperGapV').value = gameMapper.gapV;
    document.getElementById('mapperFloorGap').value = gameMapper.floorGap;
    document.getElementById('mapperFollow').checked = gameMapper.overviewFollow;
    document.getElementById('mapperGame').value = gameMapper.metadata.game;
    document.getElementById('mapperLevel').value = gameMapper.metadata.level;
    document.getElementById('mapperAuthor').value = gameMapper.metadata.author;
    document.getElementById('mapperHighlightColor').value = gameMapper.highlightColor;
    document.getElementById('mapperExportLayout').value = gameMapper.exportLayout;
    document.getElementById('mapperOverviewZoom').value = gameMapper.overviewZoom;

    const room = gameMapper.getCurrentRoom();
    const hasShots = room && room.screenshots.length > 0;
    document.getElementById('btnMapperBlend').style.display = hasShots && room.screenshots.length > 1 ? '' : 'none';
    document.getElementById('btnMapperStamp').style.display = room && room.blended ? '' : 'none';
    document.getElementById('btnMapperDeleteShot').style.display = hasShots ? '' : 'none';
    document.getElementById('mapperRoomMark').value = (room && room.mark) || '';

    mapperRenderThumbnails(room);
    mapperRenderOverview();

    const floors = gameMapper.getFloors();
    const floorCount = floors.length;
    const n = gameMapper.getRoomCount();
    const fn = gameMapper.getRoomCount(gameMapper.currentFloor);
    document.getElementById('mapperStats').textContent =
        n + ' room' + (n !== 1 ? 's' : '') + (floorCount > 1 ? ' / ' + floorCount + ' floors' : '') +
        (floorCount > 1 ? ' (floor ' + gameMapper.currentFloor + ': ' + fn + ')' : '');
}

// Render the thumbnail strip for the current room's screenshots.
function mapperRenderThumbnails(room) {
    mapperThumbStrip.innerHTML = '';
    if (!room || room.screenshots.length === 0) return;

    room.screenshots.forEach((dataUrl, i) => {
        const img = document.createElement('img');
        img.className = 'mapper-thumb' + (room.selectedIndex === i ? ' selected' : '');
        img.src = dataUrl;
        img.title = 'Screenshot ' + (i + 1);
        img.addEventListener('click', () => {
            room.selectedIndex = i;
            mapperRenderThumbnails(room);
            mapperRenderOverview();
        });
        mapperThumbStrip.appendChild(img);
    });

    if (room.blended) {
        const img = document.createElement('img');
        img.className = 'mapper-thumb blended' + (room.selectedIndex === -1 ? ' selected' : '');
        img.src = room.blended;
        img.title = 'Blended';
        img.addEventListener('click', () => {
            room.selectedIndex = -1;
            mapperRenderThumbnails(room);
            mapperRenderOverview();
        });
        mapperThumbStrip.appendChild(img);
    }
}

// Draw a colored X mark on a room (for room marking feature).
function mapperDrawRoomMark(ctx, x, y, w, h, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y + h);
    ctx.moveTo(x + w, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();
    ctx.restore();
}

// Render the overview canvas showing all rooms on the current floor.
function mapperRenderOverview() {
    mapperOverviewLayout = null;
    const floor = gameMapper.currentFloor;
    const bounds = gameMapper.getBounds(floor);
    if (!bounds) {
        mapperOverviewCanvas.width = 1;
        mapperOverviewCanvas.height = 1;
        mapperOverviewPlaceholder.style.display = '';
        return;
    }
    mapperOverviewPlaceholder.style.display = 'none';

    const reg = gameMapper.captureRegion;
    const roomW = reg.w * 8;
    const roomH = reg.h * 8;
    const gapH = gameMapper.gapH;
    const gapV = gameMapper.gapV;
    const gridW = bounds.maxX - bounds.minX + 1;
    const gridH = bounds.maxY - bounds.minY + 1;
    const totalW = gridW * roomW + (gridW - 1) * gapH;
    const totalH = gridH * roomH + (gridH - 1) * gapV;

    const container = document.getElementById('mapperOverviewContainer');
    const zoom = gameMapper.overviewZoom;
    let scale;
    if (zoom === 'x1') {
        scale = 1;
    } else if (zoom === 'x2') {
        scale = 2;
    } else {
        const maxW = container.clientWidth - 2;
        const maxH = container.clientHeight - 2;
        scale = Math.min(maxW / totalW, maxH / totalH, 2);
        if (scale <= 0) scale = 1;
    }
    container.style.overflow = zoom === 'fit' ? 'hidden' : 'auto';

    const canvasW = Math.ceil(totalW * scale);
    const canvasH = Math.ceil(totalH * scale);
    mapperOverviewCanvas.width = canvasW;
    mapperOverviewCanvas.height = canvasH;
    mapperOverviewCtx.fillStyle = '#000';
    mapperOverviewCtx.fillRect(0, 0, canvasW, canvasH);
    mapperOverviewCtx.imageSmoothingEnabled = false;

    mapperOverviewLayout = { bounds, scale, roomW, roomH, gapH, gapV, floor };

    // Grid lines
    if (gapH === 0 && gapV === 0) {
        mapperOverviewCtx.strokeStyle = 'rgba(255,255,255,0.1)';
        mapperOverviewCtx.lineWidth = 1;
        for (let gx = 0; gx <= gridW; gx++) {
            const x = Math.floor(gx * roomW * scale) + 0.5;
            mapperOverviewCtx.beginPath();
            mapperOverviewCtx.moveTo(x, 0);
            mapperOverviewCtx.lineTo(x, canvasH);
            mapperOverviewCtx.stroke();
        }
        for (let gy = 0; gy <= gridH; gy++) {
            const y = Math.floor(gy * roomH * scale) + 0.5;
            mapperOverviewCtx.beginPath();
            mapperOverviewCtx.moveTo(0, y);
            mapperOverviewCtx.lineTo(canvasW, y);
            mapperOverviewCtx.stroke();
        }
    }

    // Draw rooms on current floor
    const drawPromises = [];
    const rooms = gameMapper.getRoomsOnFloor(floor);
    for (const { x: rx, y: ry, room } of rooms) {
        const dataUrl = gameMapper.getDisplayImage(room);
        if (!dataUrl) continue;
        const dx = (rx - bounds.minX) * (roomW + gapH) * scale;
        const dy = (ry - bounds.minY) * (roomH + gapV) * scale;
        const dw = roomW * scale;
        const dh = roomH * scale;
        drawPromises.push(
            gameMapper.loadCachedImage(dataUrl).then(img => {
                mapperOverviewCtx.drawImage(img, dx, dy, dw, dh);
            })
        );
    }

    Promise.all(drawPromises).then(() => {
        // Draw room marks (colored crosses)
        for (const { x: rx, y: ry, room } of rooms) {
            if (room.mark) {
                const mx = (rx - bounds.minX) * (roomW + gapH) * scale;
                const my = (ry - bounds.minY) * (roomH + gapV) * scale;
                mapperDrawRoomMark(mapperOverviewCtx, mx, my, roomW * scale, roomH * scale, room.mark);
            }
        }

        const cx = (gameMapper.currentX - bounds.minX) * (roomW + gapH) * scale;
        const cy = (gameMapper.currentY - bounds.minY) * (roomH + gapV) * scale;
        const cw = roomW * scale;
        const ch = roomH * scale;
        mapperOverviewCtx.strokeStyle = gameMapper.highlightColor;
        mapperOverviewCtx.lineWidth = 2;
        mapperOverviewCtx.strokeRect(cx + 1, cy + 1, cw - 2, ch - 2);

        // Follow mode: auto-scroll to current room
        if (gameMapper.overviewFollow && zoom !== 'fit') {
            const centerX = cx + cw / 2;
            const centerY = cy + ch / 2;
            container.scrollLeft = centerX - container.clientWidth / 2;
            container.scrollTop = centerY - container.clientHeight / 2;
        }
    });
}

// Handle click on overview canvas to select a room.
function mapperOverviewClick(event) {
    if (!mapperOverviewLayout || gameMapper.getRoomCount() === 0) return;
    const rect = mapperOverviewCanvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const { bounds, scale, roomW, roomH, gapH, gapV, floor } = mapperOverviewLayout;
    const cellW = (roomW + gapH) * scale;
    const cellH = (roomH + gapV) * scale;
    const gx = Math.floor(mx / cellW) + bounds.minX;
    const gy = Math.floor(my / cellH) + bounds.minY;
    const key = gx + ',' + gy + ',' + floor;
    if (gameMapper.rooms.has(key)) {
        gameMapper.selectRoom(gx, gy, floor);
        mapperUpdateUI();
    }
}

// Blend all screenshots in current room using per-pixel mode voting.
function mapperBlendScreenshots() {
    const room = gameMapper.getCurrentRoom();
    if (!room || room.screenshots.length < 2) return;

    const reg = gameMapper.captureRegion;
    const pw = reg.w * 8;
    const ph = reg.h * 8;
    const count = room.screenshots.length;

    Promise.all(room.screenshots.map(url => gameMapper.loadCachedImage(url))).then(images => {
        const blendCanvas = document.createElement('canvas');
        blendCanvas.width = pw;
        blendCanvas.height = ph;
        const blendCtx = blendCanvas.getContext('2d');

        const dataSets = images.map(img => {
            const tc = document.createElement('canvas');
            tc.width = pw;
            tc.height = ph;
            const tctx = tc.getContext('2d');
            tctx.drawImage(img, 0, 0, pw, ph);
            return tctx.getImageData(0, 0, pw, ph).data;
        });

        const result = blendCtx.createImageData(pw, ph);
        const rd = result.data;
        const len = pw * ph * 4;

        // Per-pixel mode: pick the most frequent RGB value across screenshots.
        // This extracts the static background and discards moving sprites.
        const freq = {};
        for (let i = 0; i < len; i += 4) {
            for (const k in freq) delete freq[k];

            let bestKey = 0, bestCount = 0;
            for (let j = 0; j < count; j++) {
                const key = (dataSets[j][i] << 16) | (dataSets[j][i + 1] << 8) | dataSets[j][i + 2];
                const c = (freq[key] || 0) + 1;
                freq[key] = c;
                if (c > bestCount) { bestCount = c; bestKey = key; }
            }
            rd[i]     = (bestKey >> 16) & 0xFF;
            rd[i + 1] = (bestKey >> 8) & 0xFF;
            rd[i + 2] = bestKey & 0xFF;
            rd[i + 3] = 255;
        }
        blendCtx.putImageData(result, 0, 0);
        const baseUrl = blendCanvas.toDataURL('image/png');
        room._baseBlend = baseUrl;
        room.blended = baseUrl;
        room.selectedIndex = -1;
        gameMapper._imageCache.delete(room.blended);
        if (room.stamps && room.stamps.length > 0) {
            mapperApplyStamps(room).then(() => mapperUpdateUI());
        } else {
            mapperUpdateUI();
        }
    });
}

// ========== Stamp tool ==========

let mapperStampSourceA = 0;      // index into screenshots, or -1 for blended
let mapperStampSourceB = 1;      // index into screenshots, or -1 for blended
let mapperStampActiveSource = 'A';  // 'A' or 'B'
let mapperStampDragging = false;
let mapperStampStartX = 0, mapperStampStartY = 0;
let mapperStampEndX = 0, mapperStampEndY = 0;
let mapperStampScale = 1;
let mapperStampSavedScroll = null;

function mapperPopulateStampDropdowns(room) {
    const selA = document.getElementById('mapperStampSourceA');
    const selB = document.getElementById('mapperStampSourceB');
    selA.innerHTML = '';
    selB.innerHTML = '';
    for (let i = 0; i < room.screenshots.length; i++) {
        const optA = document.createElement('option');
        optA.value = i;
        optA.textContent = 'Screenshot ' + (i + 1);
        selA.appendChild(optA);
        const optB = document.createElement('option');
        optB.value = i;
        optB.textContent = 'Screenshot ' + (i + 1);
        selB.appendChild(optB);
    }
    if (room.blended) {
        const optA = document.createElement('option');
        optA.value = -1;
        optA.textContent = 'Blended';
        selA.appendChild(optA);
        const optB = document.createElement('option');
        optB.value = -1;
        optB.textContent = 'Blended';
        selB.appendChild(optB);
    }
}

function mapperUpdateStampSourceHighlight() {
    const wrapA = document.getElementById('mapperStampSourceAWrap');
    const wrapB = document.getElementById('mapperStampSourceBWrap');
    wrapA.classList.toggle('selected', mapperStampActiveSource === 'A');
    wrapB.classList.toggle('selected', mapperStampActiveSource === 'B');
    document.getElementById('mapperStampInfo').textContent =
        'Drawing from ' + mapperStampActiveSource;
}

function mapperOpenStampDialog() {
    const room = gameMapper.getCurrentRoom();
    if (!room || !room.blended) return;
    const n = room.screenshots.length;
    // Default source A/B
    if (n >= 2) {
        mapperStampSourceA = 0;
        mapperStampSourceB = 1;
    } else if (n === 1) {
        mapperStampSourceA = 0;
        mapperStampSourceB = -1;  // blended
    } else {
        mapperStampSourceA = -1;
        mapperStampSourceB = -1;
    }
    mapperStampActiveSource = 'A';
    mapperPopulateStampDropdowns(room);
    document.getElementById('mapperStampSourceA').value = mapperStampSourceA;
    document.getElementById('mapperStampSourceB').value = mapperStampSourceB;
    mapperUpdateStampSourceHighlight();
    document.getElementById('mapperStampDialog').classList.remove('hidden');
    const stampContainer = document.getElementById('mapperOverviewContainer');
    mapperStampSavedScroll = { left: stampContainer.scrollLeft, top: stampContainer.scrollTop };
    stampContainer.scrollLeft = 0;
    stampContainer.scrollTop = 0;
    mapperStampDragging = false;
    mapperStampRender();
    mapperStampRenderSources();
}

function mapperCloseStampDialog() {
    document.getElementById('mapperStampDialog').classList.add('hidden');
    mapperStampDragging = false;
    const savedScroll = mapperStampSavedScroll;
    mapperStampSavedScroll = null;
    mapperUpdateUI();
    if (savedScroll) {
        const container = document.getElementById('mapperOverviewContainer');
        container.scrollLeft = savedScroll.left;
        container.scrollTop = savedScroll.top;
    }
}

function mapperGetStampSourceUrl(room, sourceIndex) {
    if (sourceIndex === -1) return room._baseBlend || room.blended;
    if (sourceIndex >= 0 && sourceIndex < room.screenshots.length) return room.screenshots[sourceIndex];
    return null;
}

// Render the stamp canvas showing the blended image with existing stamps and drag selection.
function mapperStampRender() {
    const room = gameMapper.getCurrentRoom();
    if (!room || !room.blended) return;
    const canvas = document.getElementById('mapperStampCanvas');
    const ctx = canvas.getContext('2d');
    const reg = gameMapper.captureRegion;
    const pw = reg.w * 8;
    const ph = reg.h * 8;
    mapperStampScale = 2;
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.width = (pw * mapperStampScale) + 'px';
    canvas.style.height = (ph * mapperStampScale) + 'px';
    ctx.imageSmoothingEnabled = false;

    const baseUrl = room._baseBlend || room.blended;
    gameMapper.loadCachedImage(baseUrl).then(blendImg => {
        ctx.drawImage(blendImg, 0, 0, pw, ph);

        // Apply existing stamps onto the canvas for display
        const validStamps = room.stamps.filter(s => mapperGetStampSourceUrl(room, s.sourceIndex));
        const stampPromises = validStamps.map(s =>
            gameMapper.loadCachedImage(mapperGetStampSourceUrl(room, s.sourceIndex))
        );
        Promise.all(stampPromises).then(stampImages => {
            validStamps.forEach((s, i) => {
                ctx.drawImage(stampImages[i], s.x, s.y, s.w, s.h, s.x, s.y, s.w, s.h);
            });

            // Draw existing stamp outlines (dashed cyan)
            ctx.save();
            ctx.strokeStyle = '#4ecdc4';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            validStamps.forEach(s => {
                ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
            });
            ctx.restore();

            // Draw current drag selection (dashed yellow)
            if (mapperStampDragging) {
                const x = Math.min(mapperStampStartX, mapperStampEndX);
                const y = Math.min(mapperStampStartY, mapperStampEndY);
                const w = Math.abs(mapperStampEndX - mapperStampStartX);
                const h = Math.abs(mapperStampEndY - mapperStampStartY);
                if (w > 0 && h > 0) {
                    ctx.save();
                    ctx.strokeStyle = '#ffd93d';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
                    ctx.restore();
                }
            }
        });
    });
}

// Render the A/B source preview canvases in the stamp dialog.
function mapperStampRenderSources() {
    const room = gameMapper.getCurrentRoom();
    if (!room) return;
    const reg = gameMapper.captureRegion;
    const pw = reg.w * 8;
    const ph = reg.h * 8;
    const sources = [
        { idx: mapperStampSourceA, canvasId: 'mapperStampCanvasA' },
        { idx: mapperStampSourceB, canvasId: 'mapperStampCanvasB' }
    ];
    sources.forEach(src => {
        const canvas = document.getElementById(src.canvasId);
        const ctx = canvas.getContext('2d');
        canvas.width = pw;
        canvas.height = ph;
        canvas.style.width = (pw * mapperStampScale) + 'px';
        canvas.style.height = (ph * mapperStampScale) + 'px';
        ctx.imageSmoothingEnabled = false;
        const url = mapperGetStampSourceUrl(room, src.idx);
        if (!url) { ctx.clearRect(0, 0, pw, ph); return; }
        gameMapper.loadCachedImage(url).then(img => {
            ctx.clearRect(0, 0, pw, ph);
            ctx.drawImage(img, 0, 0, pw, ph);
            // Draw drag selection rectangle on source canvas too
            if (mapperStampDragging) {
                const x = Math.min(mapperStampStartX, mapperStampEndX);
                const y = Math.min(mapperStampStartY, mapperStampEndY);
                const w = Math.abs(mapperStampEndX - mapperStampStartX);
                const h = Math.abs(mapperStampEndY - mapperStampStartY);
                if (w > 0 && h > 0) {
                    ctx.save();
                    ctx.strokeStyle = '#ffd93d';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
                    ctx.restore();
                }
            }
        });
    });
}

// Apply all stamps to the base blend, updating room.blended.
function mapperApplyStamps(room) {
    if (!room || !room._baseBlend || !room.stamps || room.stamps.length === 0) {
        return Promise.resolve();
    }
    const reg = gameMapper.captureRegion;
    const pw = reg.w * 8;
    const ph = reg.h * 8;

    const validStamps = room.stamps.filter(s => mapperGetStampSourceUrl(room, s.sourceIndex));
    if (validStamps.length === 0) return Promise.resolve();

    const imagesToLoad = [room._baseBlend, ...validStamps.map(s => mapperGetStampSourceUrl(room, s.sourceIndex))];
    return Promise.all(imagesToLoad.map(url => gameMapper.loadCachedImage(url))).then(images => {
        const baseImg = images[0];
        const tc = document.createElement('canvas');
        tc.width = pw;
        tc.height = ph;
        const tctx = tc.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.drawImage(baseImg, 0, 0, pw, ph);

        // Apply each stamp: copy rectangle from source screenshot or blended
        for (let i = 0; i < validStamps.length; i++) {
            const s = validStamps[i];
            const srcImg = images[1 + i];
            tctx.drawImage(srcImg, s.x, s.y, s.w, s.h, s.x, s.y, s.w, s.h);
        }

        gameMapper._imageCache.delete(room.blended);
        room.blended = tc.toDataURL('image/png');
    });
}

// Clear all stamps and re-blend from scratch.
function mapperClearStamps() {
    const room = gameMapper.getCurrentRoom();
    if (!room) return;
    room.stamps = [];
    if (room.screenshots.length >= 2) {
        mapperBlendScreenshots();
    } else if (room._baseBlend) {
        gameMapper._imageCache.delete(room.blended);
        room.blended = room._baseBlend;
    }
    mapperCloseStampDialog();
}

// Convert mouse event coordinates to stamp canvas pixel coordinates.
function mapperStampCanvasCoords(event) {
    const canvas = document.getElementById('mapperStampCanvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: Math.max(0, Math.min(canvas.width, Math.round((event.clientX - rect.left) * scaleX))),
        y: Math.max(0, Math.min(canvas.height, Math.round((event.clientY - rect.top) * scaleY)))
    };
}

// Save current map to a JSON file download.
function mapperSave() {
    gameMapper.metadata.game = document.getElementById('mapperGame').value;
    gameMapper.metadata.level = document.getElementById('mapperLevel').value;
    gameMapper.metadata.author = document.getElementById('mapperAuthor').value;
    gameMapper.gapH = Math.max(0, parseInt(document.getElementById('mapperGapH').value) || 0);
    gameMapper.gapV = Math.max(0, parseInt(document.getElementById('mapperGapV').value) || 0);
    gameMapper.floorGap = Math.max(0, parseInt(document.getElementById('mapperFloorGap').value) || 0);
    gameMapper.exportLayout = document.getElementById('mapperExportLayout').value;
    if (!gameMapper.metadata.created) {
        gameMapper.metadata.created = new Date().toISOString();
    }

    const json = gameMapper.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = (gameMapper.metadata.game || 'map').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = name + '_map.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

// Load a map from a JSON file.
function mapperLoad(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            gameMapper.importJSON(reader.result);
            mapperUpdateUI();
        } catch (e) {
            console.error('Failed to load mapper file:', e);
        }
    };
    reader.readAsText(file);
}

// Render one floor to a canvas, returns Promise<{ canvas, width, height }>.
function mapperRenderFloorToCanvas(floor) {
    const reg = gameMapper.captureRegion;
    const roomW = reg.w * 8;
    const roomH = reg.h * 8;
    const gapH = gameMapper.gapH;
    const gapV = gameMapper.gapV;
    const bounds = gameMapper.getBounds(floor);
    if (!bounds) return null;

    const gridW = bounds.maxX - bounds.minX + 1;
    const gridH = bounds.maxY - bounds.minY + 1;
    const totalW = gridW * roomW + (gridW - 1) * gapH;
    const totalH = gridH * roomH + (gridH - 1) * gapV;

    const c = document.createElement('canvas');
    c.width = totalW;
    c.height = totalH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, totalW, totalH);
    ctx.imageSmoothingEnabled = false;

    const rooms = gameMapper.getRoomsOnFloor(floor);
    const drawPromises = [];
    for (const { x: rx, y: ry, room } of rooms) {
        const dataUrl = gameMapper.getDisplayImage(room);
        if (!dataUrl) continue;
        const dx = (rx - bounds.minX) * (roomW + gapH);
        const dy = (ry - bounds.minY) * (roomH + gapV);
        drawPromises.push(
            gameMapper.loadCachedImage(dataUrl).then(img => {
                ctx.drawImage(img, dx, dy, roomW, roomH);
            })
        );
    }
    return Promise.all(drawPromises).then(() => {
        // Draw room marks (colored crosses)
        for (const { x: rx, y: ry, room } of rooms) {
            if (room.mark) {
                const mx = (rx - bounds.minX) * (roomW + gapH);
                const my = (ry - bounds.minY) * (roomH + gapV);
                mapperDrawRoomMark(ctx, mx, my, roomW, roomH, room.mark);
            }
        }
        return { canvas: c, width: totalW, height: totalH };
    });
}

// Export the map as PNG file(s).
function mapperExportPng() {
    if (gameMapper.getRoomCount() === 0) return;

    // Render only non-empty floors
    const floors = gameMapper.getFloors().filter(f => {
        const b = gameMapper.getBounds(f);
        return b != null;
    });
    if (floors.length === 0) return;

    const layout = gameMapper.exportLayout;
    const baseName = (gameMapper.metadata.game || 'map').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fGap = gameMapper.floorGap;

    if (floors.length <= 1 || layout === 'separate') {
        floors.forEach(floor => {
            mapperRenderFloorToCanvas(floor).then(result => {
                if (!result) return;
                const a = document.createElement('a');
                a.href = result.canvas.toDataURL('image/png');
                a.download = floors.length > 1
                    ? baseName + '_floor' + floor + '.png'
                    : baseName + '_map.png';
                a.click();
            });
        });
        return;
    }

    // Parse layout: "Nx" = N columns, "xN" = N rows
    let cols, rows;
    if (layout.startsWith('x')) {
        rows = parseInt(layout.slice(1));
        cols = Math.ceil(floors.length / rows);
    } else {
        cols = parseInt(layout);
        rows = Math.ceil(floors.length / cols);
    }

    Promise.all(floors.map(f => mapperRenderFloorToCanvas(f))).then(results => {
        results = results.filter(r => r);
        if (results.length === 0) return;

        const maxCellW = Math.max(...results.map(r => r.width));
        const maxCellH = Math.max(...results.map(r => r.height));
        const totalW = cols * maxCellW + (cols - 1) * fGap;
        const totalH = rows * maxCellH + (rows - 1) * fGap;

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = totalW;
        exportCanvas.height = totalH;
        const exportCtx = exportCanvas.getContext('2d');
        exportCtx.fillStyle = '#000';
        exportCtx.fillRect(0, 0, totalW, totalH);
        exportCtx.imageSmoothingEnabled = false;

        results.forEach((r, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            exportCtx.drawImage(r.canvas, col * (maxCellW + fGap), row * (maxCellH + fGap));
        });

        const a = document.createElement('a');
        a.href = exportCanvas.toDataURL('image/png');
        a.download = baseName + '_map.png';
        a.click();
    });
}

// Clear all rooms after confirmation.
function mapperClear() {
    if (gameMapper.getRoomCount() === 0) return;
    if (!confirm('Clear all mapped rooms?')) return;
    gameMapper.clear();
    mapperUpdateUI();
}

// ========== Event listener wiring ==========
// All listeners are registered in initGameMapper() below.
//
// Button click listeners:
//   btnMapperCapture     -> capture screen
//   btnMapperLeft        -> move(-1, 0)
//   btnMapperRight       -> move(1, 0)
//   btnMapperUp          -> move(0, -1)
//   btnMapperDown        -> move(0, 1)
//   btnMapperFloorUp     -> moveFloor(1)
//   btnMapperFloorDown   -> moveFloor(-1)
//   btnMapperSettings    -> toggle settings panel
//   btnMapperSave        -> save map JSON
//   btnMapperLoad        -> trigger file input
//   btnMapperExportPng   -> export PNG
//   btnMapperClear       -> clear all rooms
//   btnMapperBlend       -> blend screenshots
//   btnMapperStamp       -> open stamp dialog
//   btnMapperStampClose  -> close stamp dialog
//   btnMapperStampClear  -> clear stamps
//   btnMapperDeleteShot  -> delete current screenshot
//   mapperRoomMark       -> set room mark color
//   mapperOverviewCanvas -> click to select room
//
// Settings change listeners:
//   mapperRegionX/Y/W/H  -> capture region
//   mapperGapH/V         -> gap between rooms
//   mapperFloorGap       -> floor gap
//   mapperFollow         -> auto-follow checkbox
//   mapperHighlightColor -> highlight color select
//   mapperExportLayout   -> export layout select
//   mapperOverviewZoom   -> zoom level select
//   mapperGame/Level/Author -> metadata text fields (on blur)
//   mapperFileInput      -> file load input
//
// Stamp canvas mouse handlers:
//   mapperStampCanvas mousedown/mousemove/mouseup -> drag selection
//   mapperStampSourceAWrap/BWrap click -> select A/B source
//   mapperStampSourceA/B change -> dropdown source selection
//
// Overview canvas hover popup:
//   mapperOverviewCanvas mousemove -> show room popup
//   mapperOverviewCanvas mouseleave -> hide room popup
//
// Keyboard shortcuts (must be wired in the global keydown handler):
//   Ctrl+Space    -> capture screen (when mapper tab active)
//   Ctrl+Left     -> move left
//   Ctrl+Right    -> move right
//   Ctrl+Up       -> move up
//   Ctrl+Down     -> move down
//   Ctrl+PageUp   -> floor up
//   Ctrl+PageDown -> floor down
//   Escape        -> close stamp dialog (when open)

function initGameMapper(deps) {
    spectrum = deps.spectrum;

    // Cache DOM references
    mapperOverviewCanvas = document.getElementById('mapperOverviewCanvas');
    mapperOverviewCtx = mapperOverviewCanvas.getContext('2d');
    mapperOverviewPlaceholder = document.getElementById('mapperOverviewPlaceholder');
    mapperThumbStrip = document.getElementById('mapperThumbStrip');
    mapperSettingsPanel = document.getElementById('mapperSettingsPanel');

    // Navigation buttons
    document.getElementById('btnMapperCapture').addEventListener('click', function() { this.blur(); mapperAction(mapperCaptureScreen); });
    document.getElementById('btnMapperLeft').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.move(-1, 0); mapperUpdateUI(); }); });
    document.getElementById('btnMapperRight').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.move(1, 0); mapperUpdateUI(); }); });
    document.getElementById('btnMapperUp').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.move(0, -1); mapperUpdateUI(); }); });
    document.getElementById('btnMapperDown').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.move(0, 1); mapperUpdateUI(); }); });
    document.getElementById('btnMapperFloorUp').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.moveFloor(1); mapperUpdateUI(); }); });
    document.getElementById('btnMapperFloorDown').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.moveFloor(-1); mapperUpdateUI(); }); });

    // Settings panel toggle
    document.getElementById('btnMapperSettings').addEventListener('click', () => {
        mapperSettingsPanel.classList.toggle('hidden');
        setTimeout(mapperRenderOverview, 0);
    });

    // Capture region settings
    document.getElementById('mapperRegionX').addEventListener('change', function() {
        gameMapper.captureRegion.x = Math.max(0, Math.min(31, parseInt(this.value) || 0));
        this.value = gameMapper.captureRegion.x;
    });
    document.getElementById('mapperRegionY').addEventListener('change', function() {
        gameMapper.captureRegion.y = Math.max(0, Math.min(23, parseInt(this.value) || 0));
        this.value = gameMapper.captureRegion.y;
    });
    document.getElementById('mapperRegionW').addEventListener('change', function() {
        gameMapper.captureRegion.w = Math.max(1, Math.min(32, parseInt(this.value) || 32));
        this.value = gameMapper.captureRegion.w;
    });
    document.getElementById('mapperRegionH').addEventListener('change', function() {
        gameMapper.captureRegion.h = Math.max(1, Math.min(24, parseInt(this.value) || 24));
        this.value = gameMapper.captureRegion.h;
    });

    // Gap settings
    document.getElementById('mapperGapH').addEventListener('change', function() {
        gameMapper.gapH = Math.max(0, Math.min(32, parseInt(this.value) || 0));
        this.value = gameMapper.gapH;
        mapperRenderOverview();
    });
    document.getElementById('mapperGapV').addEventListener('change', function() {
        gameMapper.gapV = Math.max(0, Math.min(32, parseInt(this.value) || 0));
        this.value = gameMapper.gapV;
        mapperRenderOverview();
    });
    document.getElementById('mapperFloorGap').addEventListener('change', function() {
        gameMapper.floorGap = Math.max(0, Math.min(64, parseInt(this.value) || 0));
        this.value = gameMapper.floorGap;
    });
    document.getElementById('mapperFollow').addEventListener('change', function() {
        gameMapper.overviewFollow = this.checked;
        if (this.checked) mapperRenderOverview();
    });

    // Visual settings
    document.getElementById('mapperHighlightColor').addEventListener('change', function() {
        gameMapper.highlightColor = this.value;
        mapperRenderOverview();
    });
    document.getElementById('mapperExportLayout').addEventListener('change', function() {
        gameMapper.exportLayout = this.value;
    });
    document.getElementById('mapperOverviewZoom').addEventListener('change', function() {
        gameMapper.overviewZoom = this.value;
        mapperRenderOverview();
    });

    // Metadata text fields (save on blur)
    document.getElementById('mapperGame').addEventListener('blur', function() { gameMapper.metadata.game = this.value; });
    document.getElementById('mapperLevel').addEventListener('blur', function() { gameMapper.metadata.level = this.value; });
    document.getElementById('mapperAuthor').addEventListener('blur', function() { gameMapper.metadata.author = this.value; });

    // File operations
    document.getElementById('btnMapperSave').addEventListener('click', mapperSave);
    document.getElementById('btnMapperLoad').addEventListener('click', () => document.getElementById('mapperFileInput').click());
    document.getElementById('mapperFileInput').addEventListener('change', function() {
        if (this.files.length > 0) { mapperLoad(this.files[0]); this.value = ''; }
    });
    document.getElementById('btnMapperExportPng').addEventListener('click', mapperExportPng);
    document.getElementById('btnMapperClear').addEventListener('click', mapperClear);

    // Blend and stamp buttons
    document.getElementById('btnMapperBlend').addEventListener('click', mapperBlendScreenshots);
    document.getElementById('btnMapperStamp').addEventListener('click', mapperOpenStampDialog);
    document.getElementById('btnMapperStampClose').addEventListener('click', mapperCloseStampDialog);
    document.getElementById('btnMapperStampClear').addEventListener('click', mapperClearStamps);

    // Delete screenshot
    document.getElementById('btnMapperDeleteShot').addEventListener('click', () => {
        gameMapper.deleteCurrentScreenshot();
        mapperUpdateUI();
    });

    // Room mark select
    document.getElementById('mapperRoomMark').addEventListener('change', (e) => {
        const room = gameMapper.ensureRoom(gameMapper.currentRoom);
        room.mark = e.target.value || null;
        mapperUpdateUI();
    });

    // Overview canvas click to select room
    mapperOverviewCanvas.addEventListener('click', mapperOverviewClick);

    // Stamp canvas mouse handlers
    const mapperStampCanvas = document.getElementById('mapperStampCanvas');
    mapperStampCanvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const coords = mapperStampCanvasCoords(e);
        mapperStampStartX = coords.x;
        mapperStampStartY = coords.y;
        mapperStampEndX = coords.x;
        mapperStampEndY = coords.y;
        mapperStampDragging = true;
    });
    mapperStampCanvas.addEventListener('mousemove', (e) => {
        if (!mapperStampDragging) return;
        const coords = mapperStampCanvasCoords(e);
        mapperStampEndX = coords.x;
        mapperStampEndY = coords.y;
        mapperStampRender();
        mapperStampRenderSources();
    });
    mapperStampCanvas.addEventListener('mouseup', (e) => {
        if (!mapperStampDragging) return;
        mapperStampDragging = false;
        const coords = mapperStampCanvasCoords(e);
        mapperStampEndX = coords.x;
        mapperStampEndY = coords.y;
        const x = Math.min(mapperStampStartX, mapperStampEndX);
        const y = Math.min(mapperStampStartY, mapperStampEndY);
        const w = Math.abs(mapperStampEndX - mapperStampStartX);
        const h = Math.abs(mapperStampEndY - mapperStampStartY);
        if (w > 0 && h > 0) {
            const room = gameMapper.getCurrentRoom();
            const sourceIdx = mapperStampActiveSource === 'A' ? mapperStampSourceA : mapperStampSourceB;
            if (room && room.blended && mapperGetStampSourceUrl(room, sourceIdx)) {
                room.stamps.push({ sourceIndex: sourceIdx, x, y, w, h });
                mapperApplyStamps(room).then(() => {
                    mapperStampRender();
                    mapperStampRenderSources();
                });
            }
        } else {
            mapperStampRender();
            mapperStampRenderSources();
        }
    });

    // Stamp source canvas click handlers
    document.getElementById('mapperStampSourceAWrap').addEventListener('click', () => {
        mapperStampActiveSource = 'A';
        mapperUpdateStampSourceHighlight();
    });
    document.getElementById('mapperStampSourceBWrap').addEventListener('click', () => {
        mapperStampActiveSource = 'B';
        mapperUpdateStampSourceHighlight();
    });

    // Stamp source dropdown change handlers
    document.getElementById('mapperStampSourceA').addEventListener('change', (e) => {
        mapperStampSourceA = parseInt(e.target.value, 10);
        mapperStampRenderSources();
    });
    document.getElementById('mapperStampSourceB').addEventListener('change', (e) => {
        mapperStampSourceB = parseInt(e.target.value, 10);
        mapperStampRenderSources();
    });

    // Mapper room hover popup
    const mapperRoomPopup = document.getElementById('mapperRoomPopup');
    const mapperRoomPopupLabel = document.getElementById('mapperRoomPopupLabel');
    const mapperRoomPopupCanvas = document.getElementById('mapperRoomPopupCanvas');
    const mapperRoomPopupCtx = mapperRoomPopupCanvas.getContext('2d');
    let mapperHoveredRoom = null;

    mapperOverviewCanvas.addEventListener('mousemove', (event) => {
        if (!mapperOverviewLayout || gameMapper.getRoomCount() === 0) {
            mapperRoomPopup.classList.add('hidden');
            mapperHoveredRoom = null;
            return;
        }
        const rect = mapperOverviewCanvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        const { bounds, scale, roomW, roomH, gapH, gapV, floor } = mapperOverviewLayout;
        const cellW = (roomW + gapH) * scale;
        const cellH = (roomH + gapV) * scale;
        const gx = Math.floor(mx / cellW) + bounds.minX;
        const gy = Math.floor(my / cellH) + bounds.minY;
        const key = gx + ',' + gy + ',' + floor;
        const room = gameMapper.rooms.get(key);

        if (!room) {
            mapperRoomPopup.classList.add('hidden');
            mapperHoveredRoom = null;
            return;
        }

        const dataUrl = gameMapper.getDisplayImage(room);
        if (!dataUrl) {
            mapperRoomPopup.classList.add('hidden');
            mapperHoveredRoom = null;
            return;
        }

        if (mapperHoveredRoom !== key) {
            mapperHoveredRoom = key;
            mapperRoomPopupLabel.textContent = '(' + gx + ', ' + gy + ')  F' + floor;
            mapperRoomPopupCanvas.width = roomW;
            mapperRoomPopupCanvas.height = roomH;
            mapperRoomPopupCanvas.style.width = (roomW * 2) + 'px';
            mapperRoomPopupCanvas.style.height = (roomH * 2) + 'px';
            mapperRoomPopupCtx.imageSmoothingEnabled = false;
            gameMapper.loadCachedImage(dataUrl).then(img => {
                mapperRoomPopupCtx.drawImage(img, 0, 0, roomW, roomH);
                if (room.mark) {
                    mapperDrawRoomMark(mapperRoomPopupCtx, 0, 0, roomW, roomH, room.mark);
                }
            });
        }

        const container = document.getElementById('mapperOverviewContainer');
        const cRect = container.getBoundingClientRect();
        const popW = roomW * 2 + 2;
        const popH = roomH * 2 + 22;
        // Position in container's scroll coordinate space
        const cursorX = event.clientX - cRect.left + container.scrollLeft;
        const cursorY = event.clientY - cRect.top + container.scrollTop;
        // Visible viewport bounds in scroll coordinates
        const viewLeft = container.scrollLeft;
        const viewTop = container.scrollTop;
        const viewRight = viewLeft + container.clientWidth;
        const viewBottom = viewTop + container.clientHeight;
        let px = cursorX + 12;
        let py = cursorY + 12;
        // Flip to left/above cursor if overflowing visible area
        if (px + popW > viewRight) px = cursorX - popW - 8;
        if (py + popH > viewBottom) py = cursorY - popH - 8;
        // Clamp to visible viewport
        if (px < viewLeft) px = viewLeft;
        if (py < viewTop) py = viewTop;
        mapperRoomPopup.style.left = px + 'px';
        mapperRoomPopup.style.top = py + 'px';
        mapperRoomPopup.classList.remove('hidden');
    });

    mapperOverviewCanvas.addEventListener('mouseleave', () => {
        mapperRoomPopup.classList.add('hidden');
        mapperHoveredRoom = null;
    });
}

// ========== Keyboard shortcut handler ==========
// Call this from the global keydown handler. Returns true if the event was handled.
//
// Expected to be called with the condition:
//   if (mapperTab && mapperTab.classList.contains('active')) { ... }
// already checked by the caller.
//
// Original source: lines 34251-34297 of upstream_index.html

function handleMapperKeydown(e) {
    // Escape to close stamp dialog
    if (e.key === 'Escape' && !document.getElementById('mapperStampDialog').classList.contains('hidden')) {
        e.preventDefault();
        mapperCloseStampDialog();
        return true;
    }

    // Ctrl+key shortcuts (no Alt, no Shift, no repeat)
    if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat) {
        const mapperTab = document.getElementById('tools-mapper');
        if (mapperTab && mapperTab.classList.contains('active')) {
            if (e.code === 'Space') {
                e.preventDefault();
                mapperAction(mapperCaptureScreen);
                return true;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                mapperAction(() => { gameMapper.move(-1, 0); mapperUpdateUI(); });
                return true;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                mapperAction(() => { gameMapper.move(1, 0); mapperUpdateUI(); });
                return true;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                mapperAction(() => { gameMapper.move(0, -1); mapperUpdateUI(); });
                return true;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                mapperAction(() => { gameMapper.move(0, 1); mapperUpdateUI(); });
                return true;
            }
            if (e.key === 'PageUp') {
                e.preventDefault();
                mapperAction(() => { gameMapper.moveFloor(1); mapperUpdateUI(); });
                return true;
            }
            if (e.key === 'PageDown') {
                e.preventDefault();
                mapperAction(() => { gameMapper.moveFloor(-1); mapperUpdateUI(); });
                return true;
            }
        }
    }

    return false;
}

// ========== Exports ==========

export { GameMapper, gameMapper, initGameMapper, handleMapperKeydown, mapperUpdateUI, mapperAction, mapperCaptureScreen };
