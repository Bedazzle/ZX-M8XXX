// sjasmplus-js v0.10.19 - Z80 Assembler for ZX Spectrum
// Memory Model - Handles DEVICE, SLOT, PAGE for ZX Spectrum memory banking

import { ErrorCollector } from './errors.js';

export const AsmMemory = {
    // Source location tracking for error messages
    currentLine: null,
    currentFile: null,

    // Device configurations
    devices: {
        'NONE': {
            pages: 1,
            pageSize: 0x10000,  // 64K flat
            slots: [{ start: 0x0000, size: 0x10000, page: 0 }]
        },
        'ZXSPECTRUM48': {
            pages: 4,
            pageSize: 0x4000,  // 16K pages
            slots: [
                { start: 0x0000, size: 0x4000, page: 0 },  // ROM
                { start: 0x4000, size: 0x4000, page: 1 },  // Screen
                { start: 0x8000, size: 0x4000, page: 2 },
                { start: 0xC000, size: 0x4000, page: 3 }
            ]
        },
        'ZXSPECTRUM128': {
            pages: 8,
            pageSize: 0x4000,  // 16K pages
            slots: [
                { start: 0x0000, size: 0x4000, page: 0 },  // ROM
                { start: 0x4000, size: 0x4000, page: 5 },  // Screen
                { start: 0x8000, size: 0x4000, page: 2 },
                { start: 0xC000, size: 0x4000, page: 0 }   // Switchable
            ]
        },
        'ZXSPECTRUM512': {
            pages: 32,
            pageSize: 0x4000,
            slots: [
                { start: 0x0000, size: 0x4000, page: 0 },
                { start: 0x4000, size: 0x4000, page: 5 },
                { start: 0x8000, size: 0x4000, page: 2 },
                { start: 0xC000, size: 0x4000, page: 0 }
            ]
        },
        'ZXSPECTRUM1024': {
            pages: 64,
            pageSize: 0x4000,
            slots: [
                { start: 0x0000, size: 0x4000, page: 0 },
                { start: 0x4000, size: 0x4000, page: 5 },
                { start: 0x8000, size: 0x4000, page: 2 },
                { start: 0xC000, size: 0x4000, page: 0 }
            ]
        }
    },

    // Current state
    device: null,
    pages: [],           // Array of Uint8Array, one per page
    slots: [],           // Current slot configuration
    currentSlot: 3,      // Default to slot 3 (0xC000-0xFFFF)

    // Initialize memory
    reset() {
        this.device = null;
        this.pages = [];
        this.slots = [];
        this.currentSlot = 3;
        this.currentLine = null;
        this.currentFile = null;
    },

    // Set device
    setDevice(deviceName) {
        const name = deviceName.toUpperCase();
        if (!(name in this.devices)) {
            ErrorCollector.error(`Unknown device: ${deviceName}`);
            return false;
        }

        const newDevice = this.devices[name];
        
        // If same device is already set, don't reinitialize memory
        if (this.device === newDevice && this.pages && this.pages.length > 0) {
            return true;
        }

        this.device = newDevice;
        
        // Initialize pages
        this.pages = [];
        for (let i = 0; i < this.device.pages; i++) {
            this.pages.push(new Uint8Array(this.device.pageSize));
        }

        // Initialize slots
        this.slots = this.device.slots.map(s => ({ ...s }));
        
        // Initialize ZX Spectrum memory to match sjasmplus USR 0 state
        if (name.startsWith('ZXSPECTRUM')) {
            // Attribute area $5800-$5AFF: 768 bytes of 0x38 (white paper, black ink)
            for (let i = 0x5800; i < 0x5B00; i++) {
                this.writeByte(i, 0x38);
            }

            // System variables $5C00-$5CFF (256 bytes, matches sjasmplus ZX_SYSVARS_DATA)
            const sysvars = [
                0xFF,0x00,0x00,0x00,0xFF,0x00,0x00,0x00,0x00,0x14,0x01,0x00,0x00,0x00,0x00,0x00,
                0x01,0x00,0x06,0x00,0x0B,0x00,0x01,0x00,0x01,0x00,0x06,0x00,0x10,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x3C,0x40,0x00,0xFF,0xCC,0x01,0x58,0x5D,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x38,0x00,0x00,0xCB,0x5C,0x00,0x00,0xB6,
                0x5C,0xB6,0x5C,0xCB,0x5C,0x00,0x00,0xCA,0x5C,0xCC,0x5C,0xCC,0x5C,0xCC,0x5C,0x00,
                0x00,0xCE,0x5C,0xCE,0x5C,0xCE,0x5C,0x00,0x92,0x5C,0x10,0x02,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x58,0xFF,0x00,0x00,0x21,
                0x5B,0x00,0x21,0x17,0x00,0x40,0xE0,0x50,0x21,0x18,0x21,0x17,0x01,0x38,0x00,0x38,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x5B,0x5D,0xFF,0xFF,0xF4,0x09,0xA8,0x10,0x4B,0xF4,0x09,0xC4,0x15,0x53,
                0x81,0x0F,0xC4,0x15,0x52,0xF4,0x09,0xC4,0x15,0x50,0x80,0x80,0x0D,0x80,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00
            ];
            for (let i = 0; i < sysvars.length; i++) {
                this.writeByte(0x5C00 + i, sysvars[i]);
            }

            // Default stack at $5D58-$5D5B (4 bytes: ZX_STACK_DATA)
            this.writeByte(0x5D58, 0x03);
            this.writeByte(0x5D59, 0x13);
            this.writeByte(0x5D5A, 0x00);
            this.writeByte(0x5D5B, 0x3E);

            // UDG data at $FF58-$FFFF (168 bytes: characters A-U)
            const udg = [
                0x00,0x3C,0x42,0x42,0x7E,0x42,0x42,0x00,  // A
                0x00,0x7C,0x42,0x7C,0x42,0x42,0x7C,0x00,  // B
                0x00,0x3C,0x42,0x40,0x40,0x42,0x3C,0x00,  // C
                0x00,0x78,0x44,0x42,0x42,0x44,0x78,0x00,  // D
                0x00,0x7E,0x40,0x7C,0x40,0x40,0x7E,0x00,  // E
                0x00,0x7E,0x40,0x7C,0x40,0x40,0x40,0x00,  // F
                0x00,0x3C,0x42,0x40,0x4E,0x42,0x3C,0x00,  // G
                0x00,0x42,0x42,0x7E,0x42,0x42,0x42,0x00,  // H
                0x00,0x3E,0x08,0x08,0x08,0x08,0x3E,0x00,  // I
                0x00,0x02,0x02,0x02,0x42,0x42,0x3C,0x00,  // J
                0x00,0x44,0x48,0x70,0x48,0x44,0x42,0x00,  // K
                0x00,0x40,0x40,0x40,0x40,0x40,0x7E,0x00,  // L
                0x00,0x42,0x66,0x5A,0x42,0x42,0x42,0x00,  // M
                0x00,0x42,0x62,0x52,0x4A,0x46,0x42,0x00,  // N
                0x00,0x3C,0x42,0x42,0x42,0x42,0x3C,0x00,  // O
                0x00,0x7C,0x42,0x42,0x7C,0x40,0x40,0x00,  // P
                0x00,0x3C,0x42,0x42,0x52,0x4A,0x3C,0x00,  // Q
                0x00,0x7C,0x42,0x42,0x7C,0x44,0x42,0x00,  // R
                0x00,0x3C,0x40,0x3C,0x02,0x42,0x3C,0x00,  // S
                0x00,0xFE,0x10,0x10,0x10,0x10,0x10,0x00,  // T
                0x00,0x42,0x42,0x42,0x42,0x42,0x3C,0x00   // U
            ];
            for (let i = 0; i < udg.length; i++) {
                this.writeByte(0xFF58 + i, udg[i]);
            }
        }
        
        return true;
    },

    // Get current device name
    getDeviceName() {
        for (const name in this.devices) {
            if (this.devices[name] === this.device) {
                return name;
            }
        }
        return 'NONE';
    },

    // Set slot to page
    setSlot(slotNum, pageNum) {
        if (!this.device) {
            ErrorCollector.error('No device set');
            return;
        }

        if (slotNum < 0 || slotNum >= this.slots.length) {
            ErrorCollector.error(`Invalid slot number: ${slotNum}`);
            return;
        }

        if (pageNum < 0 || pageNum >= this.device.pages) {
            ErrorCollector.error(`Invalid page number: ${pageNum}`);
            return;
        }

        this.slots[slotNum].page = pageNum;
    },

    // Set current slot for writes
    setCurrentSlot(slotNum) {
        if (!this.device) {
            this.currentSlot = 0;
            return;
        }

        if (slotNum < 0 || slotNum >= this.slots.length) {
            ErrorCollector.error(`Invalid slot number: ${slotNum}`);
            return;
        }

        this.currentSlot = slotNum;
    },

    // Find slot for address
    findSlot(addr) {
        if (!this.device) {
            return { slot: 0, page: 0, offset: addr };
        }

        for (let i = 0; i < this.slots.length; i++) {
            const slot = this.slots[i];
            if (addr >= slot.start && addr < slot.start + slot.size) {
                return {
                    slot: i,
                    page: slot.page,
                    offset: addr - slot.start
                };
            }
        }

        ErrorCollector.error(`Address ${addr.toString(16)} not in any slot`, this.currentLine, this.currentFile);
        return null;
    },

    // Write byte to memory
    writeByte(addr, value) {
        if (!this.device) {
            // No device - simple linear memory
            return;
        }

        const loc = this.findSlot(addr);
        if (loc) {
            this.pages[loc.page][loc.offset] = value & 0xFF;
        }
    },

    // Write bytes to memory
    writeBytes(addr, bytes) {
        for (let i = 0; i < bytes.length; i++) {
            this.writeByte(addr + i, bytes[i]);
        }
    },

    // Read byte from memory
    readByte(addr) {
        if (!this.device) {
            return 0;
        }

        const loc = this.findSlot(addr);
        if (loc) {
            return this.pages[loc.page][loc.offset];
        }
        return 0;
    },

    // Read byte using custom slot configuration
    readByteWithSlots(addr, customSlots) {
        if (!this.device || !customSlots) {
            return this.readByte(addr);
        }

        // Find slot in custom config
        for (let i = 0; i < customSlots.length; i++) {
            const slot = customSlots[i];
            if (addr >= slot.start && addr < slot.start + slot.size) {
                const offset = addr - slot.start;
                return this.pages[slot.page][offset];
            }
        }
        return 0;
    },

    // Get raw page data
    getPage(pageNum) {
        if (pageNum < 0 || pageNum >= this.pages.length) {
            return null;
        }
        return this.pages[pageNum];
    },

    // Get all memory as single array (for simple output)
    getAllMemory() {
        if (!this.device) {
            return new Uint8Array(0);
        }

        // For 48K, return 64K image
        if (this.getDeviceName() === 'ZXSPECTRUM48') {
            const mem = new Uint8Array(0x10000);
            for (let i = 0; i < this.slots.length; i++) {
                const slot = this.slots[i];
                const page = this.pages[slot.page];
                mem.set(page, slot.start);
            }
            return mem;
        }

        // For 128K+, return all pages concatenated
        const totalSize = this.device.pages * this.device.pageSize;
        const mem = new Uint8Array(totalSize);
        let offset = 0;
        for (const page of this.pages) {
            mem.set(page, offset);
            offset += page.length;
        }
        return mem;
    },

    // Get memory range
    getRange(start, length) {
        const result = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            result[i] = this.readByte(start + i);
        }
        return result;
    },

    // Check if address range is valid for current device
    isValidRange(start, end) {
        if (!this.device) {
            return start >= 0 && end <= 0x10000;
        }

        // Check all addresses are in valid slots
        for (let addr = start; addr < end; addr++) {
            const loc = this.findSlot(addr);
            if (!loc) return false;
        }
        return true;
    },

    // MMU command - set multiple slot/page mappings
    mmu(slotStart, slotEnd, pageStart) {
        if (!this.device) {
            ErrorCollector.error('No device set');
            return;
        }

        let page = pageStart;
        for (let slot = slotStart; slot <= slotEnd; slot++) {
            this.setSlot(slot, page++);
        }
    }
};

