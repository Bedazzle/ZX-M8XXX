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

        // Initialize ZX Spectrum screen attributes to default $38 (white on black)
        if (name.startsWith('ZXSPECTRUM')) {
            // Attribute area is $5800-$5AFF (768 bytes)
            // Find which page is mapped at $4000 (screen area)
            const screenSlot = this.slots.find(s => s.start === 0x4000);
            const screenPage = screenSlot ? screenSlot.page : 1;
            // In the screen page, offset $1800-$1AFF
            for (let i = 0x1800; i < 0x1B00; i++) {
                this.pages[screenPage][i] = 0x38;
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
