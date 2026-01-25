/**
 * ZX-M8XXX - Memory Management
 * @version 0.6.5
 * @license GPL-3.0
 *
 * Supports 48K, 128K, and Pentagon memory banking.
 * Pentagon includes Beta Disk interface with separate TR-DOS ROM.
 */

(function(global) {
    'use strict';

    const VERSION = '0.6.5';

    class Memory {
        static get VERSION() { return VERSION; }

        constructor(machineType = '48k') {
            this.machineType = machineType;
            this.rom = null;
            this.ram = null;
            this.trdosRom = null;      // Separate TR-DOS ROM (16KB) for Beta Disk
            this.trdosActive = false;  // True when TR-DOS ROM is paged in
            this.pagingDisabled = false;
            this.currentRomBank = 0;
            this.currentRamBank = 0;
            this.screenBank = 5;
            this.contentionEnabled = false;
            this.allowRomEdit = false;

            // Watchpoint callbacks
            this.onRead = null;  // function(addr, val) - called on read
            this.onWrite = null; // function(addr, val) - called on write

            this.init();
        }

        init() {
            switch (this.machineType) {
                case '48k':
                    this.rom = [new Uint8Array(0x4000)];
                    this.ram = [new Uint8Array(0xC000)];
                    // TR-DOS ROM for Beta Disk interface (optional for 48K)
                    this.trdosRom = new Uint8Array(0x4000);
                    break;
                case '128k':
                case 'pentagon':
                    this.rom = [new Uint8Array(0x4000), new Uint8Array(0x4000)];
                    this.ram = [];
                    for (let i = 0; i < 8; i++) {
                        this.ram.push(new Uint8Array(0x4000));
                    }
                    // TR-DOS ROM for Beta Disk interface (128K and Pentagon)
                    this.trdosRom = new Uint8Array(0x4000);
                    break;
            }
            this.reset();
        }
        
        reset() {
            if (this.machineType === '48k') {
                this.ram[0].fill(0);
            } else {
                for (let bank of this.ram) {
                    bank.fill(0);
                }
            }
            this.pagingDisabled = false;
            this.currentRomBank = 0;
            this.currentRamBank = 0;
            this.screenBank = 5;
            this.trdosActive = false;
        }

        loadRom(data, bank = 0) {
            if (bank < this.rom.length) {
                const src = new Uint8Array(data);
                this.rom[bank].set(src.subarray(0, Math.min(src.length, 0x4000)));
            }
        }

        // Load TR-DOS ROM (separate 16KB ROM for Beta Disk interface)
        loadTrdosRom(data) {
            if (this.trdosRom) {
                const src = new Uint8Array(data);
                this.trdosRom.set(src.subarray(0, Math.min(src.length, 0x4000)));
            }
        }

        // Check if TR-DOS ROM is loaded
        hasTrdosRom() {
            if (!this.trdosRom) {
                return false;
            }
            // Check if ROM has any non-zero content
            for (let i = 0; i < 256; i++) {
                if (this.trdosRom[i] !== 0) return true;
            }
            return false;
        }

        read(addr) {
            // Note: addr is pre-masked by caller (z80.js readByte)
            let val;
            if (this.machineType === '48k') {
                if (addr < 0x4000) {
                    // When TR-DOS is active, read from TR-DOS ROM instead of main ROM
                    val = (this.trdosActive && this.trdosRom) ? this.trdosRom[addr] : this.rom[0][addr];
                } else {
                    val = this.ram[0][addr - 0x4000];
                }
            } else {
                if (addr < 0x4000) {
                    // When TR-DOS is active, read from TR-DOS ROM instead of main ROM
                    val = (this.trdosActive && this.trdosRom) ? this.trdosRom[addr] : this.rom[this.currentRomBank][addr];
                }
                else if (addr < 0x8000) val = this.ram[5][addr - 0x4000];
                else if (addr < 0xC000) val = this.ram[2][addr - 0x8000];
                else val = this.ram[this.currentRamBank][addr - 0xC000];
            }
            if (this.onRead) this.onRead(addr, val);
            return val;
        }

        write(addr, val) {
            // Note: addr and val are pre-masked by caller (z80.js writeByte)
            if (this.onWrite) this.onWrite(addr, val);
            if (addr < 0x4000) return;

            if (this.machineType === '48k') {
                this.ram[0][addr - 0x4000] = val;
                return;
            }
            if (addr < 0x8000) this.ram[5][addr - 0x4000] = val;
            else if (addr < 0xC000) this.ram[2][addr - 0x8000] = val;
            else this.ram[this.currentRamBank][addr - 0xC000] = val;
        }
        
        // Debug write - respects allowRomEdit flag
        writeDebug(addr, val) {
            addr &= 0xffff;
            val &= 0xff;
            if (addr < 0x4000) {
                if (!this.allowRomEdit) return false;
                if (this.machineType === '48k') {
                    this.rom[0][addr] = val;
                } else {
                    this.rom[this.currentRomBank][addr] = val;
                }
                return true;
            }
            this.write(addr, val);
            return true;
        }
        
        writePaging(val) {
            if (this.machineType === '48k' || this.pagingDisabled) return;
            this.currentRamBank = val & 0x07;
            this.screenBank = (val & 0x08) ? 7 : 5;
            this.currentRomBank = (val & 0x10) ? 1 : 0;
            if (val & 0x20) this.pagingDisabled = true;
        }
        
        getPagingState() {
            return {
                ramBank: this.currentRamBank,
                romBank: this.currentRomBank,
                screenBank: this.screenBank,
                pagingDisabled: this.pagingDisabled
            };
        }
        
        setPagingState(state) {
            this.currentRamBank = state.ramBank || 0;
            this.currentRomBank = state.romBank || 0;
            this.screenBank = state.screenBank || 5;
            this.pagingDisabled = state.pagingDisabled || false;
        }

        // Individual paging setters for debugger
        setRamBank(bank) {
            if (this.machineType === '48k') return;
            this.currentRamBank = bank & 0x07;
        }

        setRomBank(bank) {
            if (this.machineType === '48k') return;
            this.currentRomBank = bank & 0x01;
        }

        setScreenBank(bank) {
            if (this.machineType === '48k') return;
            this.screenBank = (bank === 5 || bank === 7) ? bank : 5;
        }

        setPagingDisabled(disabled) {
            if (this.machineType === '48k') return;
            this.pagingDisabled = !!disabled;
        }

        // Port I/O for 128K paging
        writePort(port, val) {
            // 128K paging port - responds to any port with A1=0 and A15=0
            if ((port & 0x8002) === 0) {
                this.writePaging(val);
            }
        }
        
        readPort(port) {
            // Memory doesn't handle port reads directly
            return 0xFF;
        }
        
        getScreenBase() {
            if (this.machineType === '48k') return { ram: this.ram[0], offset: 0 };
            return { ram: this.ram[this.screenBank], offset: 0 };
        }
        
        getRamBank(bank) {
            if (this.machineType === '48k') return this.ram[0];
            return this.ram[bank];
        }
        
        isContended(addr) {
            if (!this.contentionEnabled) return false;
            if (this.machineType === '48k') return addr >= 0x4000 && addr < 0x8000;
            if (addr >= 0x4000 && addr < 0x8000) return true;
            if (addr >= 0xC000) return (this.currentRamBank & 1) === 1;
            return false;
        }
        
        setBlock(startAddr, data) {
            for (let i = 0; i < data.length; i++) {
                this.write(startAddr + i, data[i]);
            }
        }
        
        getBlock(startAddr, length) {
            const result = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
                result[i] = this.read(startAddr + i);
            }
            return result;
        }

        // Get full memory snapshot (current 64K view for export)
        getFullSnapshot() {
            const snapshot = new Uint8Array(0x10000);
            for (let addr = 0; addr < 0x10000; addr++) {
                snapshot[addr] = this.read(addr);
            }
            return snapshot;
        }

        // Get full state including all banks (for complete snapshots)
        getFullState() {
            const state = {
                machineType: this.machineType,
                currentRomBank: this.currentRomBank,
                currentRamBank: this.currentRamBank,
                screenBank: this.screenBank,
                pagingDisabled: this.pagingDisabled,
                trdosActive: this.trdosActive
            };

            // Copy ROM banks
            state.rom = this.rom.map(bank => new Uint8Array(bank));

            // Copy RAM banks
            state.ram = this.ram.map(bank => new Uint8Array(bank));

            // Copy TR-DOS ROM if present
            if (this.trdosRom) {
                state.trdosRom = new Uint8Array(this.trdosRom);
            }

            return state;
        }
    }

    // Export for both browser and Node.js
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Memory;
    }
    if (typeof global !== 'undefined') {
        global.Memory = Memory;
    }
    if (typeof window !== 'undefined') {
        window.Memory = Memory;
    }

})(typeof window !== 'undefined' ? window : global);
