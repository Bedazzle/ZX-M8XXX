// Game map builder — extracted from index.html
import { MAPPER_DEFAULT_FONT, MAPPER_DEFAULT_FONT_SIZE } from '../core/constants.js';

export class GameMapper {
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
        this.textSlideDefaults = {
            font: MAPPER_DEFAULT_FONT,
            fontSize: MAPPER_DEFAULT_FONT_SIZE,
            color: '#ffffff',
            paper: '#000080'
        };
    }

    _key(x, y, z) { return x + ',' + y + ',' + z; }
    get currentRoom() { return this._key(this.currentX, this.currentY, this.currentFloor); }

    getRoom(key) { return this.rooms.get(key) || null; }
    getCurrentRoom() { return this.getRoom(this.currentRoom); }

    ensureRoom(key) {
        if (!this.rooms.has(key)) {
            this.rooms.set(key, { screenshots: [], selectedIndex: 0, blended: null, stamps: [], _baseBlend: null, mark: null, textSlide: null });
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
        if (room.textSlide) {
            room.textSlide = null;
            const removed = room.screenshots.splice(index, 1)[0];
            this._imageCache.delete(removed);
            this.rooms.delete(this.currentRoom);
            return;
        }
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

    deleteRoom() {
        const key = this.currentRoom;
        const room = this.rooms.get(key);
        if (!room) return false;
        for (const url of room.screenshots) this._imageCache.delete(url);
        if (room.blended) this._imageCache.delete(room.blended);
        if (room._baseBlend) this._imageCache.delete(room._baseBlend);
        this.rooms.delete(key);
        return true;
    }

    moveRoom(newX, newY, newFloor) {
        if (newFloor === undefined) newFloor = this.currentFloor;
        const oldKey = this.currentRoom;
        const newKey = this._key(newX, newY, newFloor);
        if (oldKey === newKey) return false;
        const room = this.rooms.get(oldKey);
        if (!room) return false;
        if (this.rooms.has(newKey)) return false;
        this.rooms.delete(oldKey);
        this.rooms.set(newKey, room);
        this.currentX = newX;
        this.currentY = newY;
        this.currentFloor = newFloor;
        return true;
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

    // Render text slide content onto a canvas and return it.
    // Used by both renderTextSlide (produces data URL) and live preview.
    static renderTextToCanvas(canvas, text, font, fontSize, color, paper) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = paper;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = color;
        ctx.font = fontSize + 'px ' + font;
        ctx.textBaseline = 'top';
        const lines = text.split('\n');
        const lineHeight = fontSize * 1.3;
        const padding = 8;
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], padding, padding + i * lineHeight);
        }
    }

    renderTextSlide(room) {
        if (!room || !room.textSlide) return;
        const pw = this.captureRegion.w * 8;
        const ph = this.captureRegion.h * 8;
        const ts = room.textSlide;

        const canvas = document.createElement('canvas');
        canvas.width = pw;
        canvas.height = ph;
        GameMapper.renderTextToCanvas(canvas, ts.text, ts.font, ts.fontSize, ts.color, ts.paper);

        const dataUrl = canvas.toDataURL('image/png');
        if (room.screenshots.length > 0) {
            this._imageCache.delete(room.screenshots[0]);
        }
        room.screenshots = [dataUrl];
        room.selectedIndex = 0;
        room.blended = null;
        room._baseBlend = null;
        room.stamps = [];
        this._imageCache.delete(dataUrl);
    }

    setTextSlide(text, options) {
        const room = this.ensureRoom(this.currentRoom);
        // Clear existing screenshots if converting from regular room
        if (!room.textSlide && room.screenshots.length > 0) {
            for (const url of room.screenshots) this._imageCache.delete(url);
            if (room.blended) this._imageCache.delete(room.blended);
            if (room._baseBlend) this._imageCache.delete(room._baseBlend);
            room.screenshots = [];
            room.blended = null;
            room._baseBlend = null;
            room.stamps = [];
        }
        room.textSlide = {
            text: text,
            font: options.font || this.textSlideDefaults.font,
            fontSize: options.fontSize || this.textSlideDefaults.fontSize,
            color: options.color || this.textSlideDefaults.color,
            paper: options.paper || this.textSlideDefaults.paper
        };
        this.renderTextSlide(room);
    }

    isTextSlide(room) {
        return room != null && room.textSlide != null;
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
                mark: room.mark || null,
                textSlide: room.textSlide || null
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
            overviewFollow: this.overviewFollow,
            textSlideDefaults: { ...this.textSlideDefaults }
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
        if (data.textSlideDefaults) {
            this.textSlideDefaults = { ...this.textSlideDefaults, ...data.textSlideDefaults };
        }
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
                    mark: room.mark || null,
                    textSlide: room.textSlide || null
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
        this.textSlideDefaults = {
            font: MAPPER_DEFAULT_FONT,
            fontSize: MAPPER_DEFAULT_FONT_SIZE,
            color: '#ffffff',
            paper: '#000080'
        };
    }
}
