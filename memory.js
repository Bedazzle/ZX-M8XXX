/**
 * ZX-M8XXX - Memory Management
 * @version 0.6.5
 * @license GPL-3.0
 *
 * Supports 48K, 128K, +2A, and Pentagon memory banking.
 * +2A adds port 0x1FFD with special all-RAM paging and 4 ROM banks.
 * Pentagon includes Beta Disk interface with separate TR-DOS ROM.
 */

(function(global) {
    'use strict';

    const VERSION = '0.6.5';

    class Memory {
        static get VERSION() { return VERSION; }

        constructor(machineType = '48k') {
            this.machineType = machineType;
            this.profile = getMachineProfile(machineType);
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

            // +2A-specific state
            this.port1FFD = 0;             // Last value written to port 0x1FFD
            this.specialPagingMode = false; // True when port 0x1FFD bit 0 is set
            this.specialBanks = [0, 1, 2, 3]; // RAM banks mapped to each 16K slot in special mode

            // Pentagon 1024-specific state
            this.portEFF7 = 0;              // Last value written to port 0xEFF7
            this.pentagon1024Mode = false;   // true = 1MB mode (bit 5 of 7FFD = bank bit)
            this.ramInRomMode = false;       // true = RAM page 0 mapped at 0x0000-0x3FFF

            // Watchpoint callbacks
            this.onRead = null;  // function(addr, val) - called on read
            this.onWrite = null; // function(addr, val) - called on write

            this.init();
        }

        init() {
            const p = this.profile;
            // Allocate ROM banks
            this.rom = [];
            for (let i = 0; i < p.romBanks; i++) {
                this.rom.push(new Uint8Array(0x4000));
            }
            // Allocate RAM
            if (p.ramPages === 1) {
                // 48K special case: single 48K block
                this.ram = [new Uint8Array(0xC000)];
            } else {
                this.ram = [];
                for (let i = 0; i < p.ramPages; i++) {
                    this.ram.push(new Uint8Array(0x4000));
                }
            }
            // TR-DOS ROM (available for all machine types)
            this.trdosRom = new Uint8Array(0x4000);
            this.reset();
        }

        reset() {
            if (this.profile.ramPages === 1) {
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
            this.port1FFD = 0;
            this.specialPagingMode = false;
            this.specialBanks = [0, 1, 2, 3];
            this.portEFF7 = 0;
            this.pentagon1024Mode = false;
            this.ramInRomMode = false;
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
            } else if (this.specialPagingMode) {
                // +2A special paging: all 4 slots are RAM banks
                const slot = addr >> 14;
                val = this.ram[this.specialBanks[slot]][addr & 0x3FFF];
            } else {
                if (addr < 0x4000) {
                    if (this.trdosActive && this.trdosRom) {
                        val = this.trdosRom[addr];
                    } else if (this.ramInRomMode) {
                        // Pentagon 1024: RAM page 0 mapped over ROM
                        val = this.ram[0][addr];
                    } else {
                        val = this.rom[this.currentRomBank][addr];
                    }
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

            if (this.specialPagingMode) {
                // +2A special paging: all 4 slots are writable RAM
                const slot = addr >> 14;
                this.ram[this.specialBanks[slot]][addr & 0x3FFF] = val;
                return;
            }

            if (addr < 0x4000) {
                // Pentagon 1024: RAM page 0 mapped over ROM is writable
                if (this.ramInRomMode) {
                    this.ram[0][addr] = val;
                }
                return;
            }

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
                if (this.profile.ramPages === 1) {
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
            if (this.profile.pagingModel === 'none' || this.pagingDisabled) return;

            if (this.profile.pagingModel === 'pentagon1024') {
                // Pentagon 1024: extended bank selection using bits 0-2, 5, 6, 7
                let page = val & 0x07;              // bits 0-2
                page |= (val & 0xC0) >> 3;          // bits 6,7 → bank bits 3,4
                if (this.pentagon1024Mode) {
                    page |= (val & 0x20);            // bit 5 → bank bit 5 (value 32)
                }
                this.currentRamBank = page % this.profile.ramPages;
                this.screenBank = (val & 0x08) ? 7 : 5;
                this.currentRomBank = (val & 0x10) ? 1 : 0;
                // Bit 5 only locks paging in 128K mode (not in 1MB mode)
                if (!this.pentagon1024Mode && (val & 0x20)) {
                    this.pagingDisabled = true;
                }
                return;
            }

            this.currentRamBank = val & 0x07;
            this.screenBank = (val & 0x08) ? 7 : 5;
            if (this.profile.pagingModel === '+2a') {
                // +2A: ROM bank = ((port1FFD >> 2) & 1) << 1 | ((port7FFD >> 4) & 1)
                this.currentRomBank = ((this.port1FFD >> 2) & 1) << 1 | ((val >> 4) & 1);
            } else {
                this.currentRomBank = (val & 0x10) ? 1 : 0;
            }
            if (val & 0x20) this.pagingDisabled = true;
        }
        
        getPagingState() {
            const state = {
                ramBank: this.currentRamBank,
                romBank: this.currentRomBank,
                screenBank: this.screenBank,
                pagingDisabled: this.pagingDisabled
            };
            if (this.profile.pagingModel === '+2a') {
                state.port1FFD = this.port1FFD;
                state.specialPagingMode = this.specialPagingMode;
                state.specialBanks = this.specialBanks.slice();
            }
            if (this.profile.pagingModel === 'pentagon1024') {
                state.portEFF7 = this.portEFF7;
                state.pentagon1024Mode = this.pentagon1024Mode;
                state.ramInRomMode = this.ramInRomMode;
            }
            return state;
        }

        setPagingState(state) {
            this.currentRamBank = state.ramBank || 0;
            this.currentRomBank = state.romBank || 0;
            this.screenBank = state.screenBank || 5;
            this.pagingDisabled = state.pagingDisabled || false;
            if (this.profile.pagingModel === '+2a') {
                this.port1FFD = state.port1FFD || 0;
                this.specialPagingMode = state.specialPagingMode || false;
                this.specialBanks = state.specialBanks ? state.specialBanks.slice() : [0, 1, 2, 3];
            }
            if (this.profile.pagingModel === 'pentagon1024') {
                this.portEFF7 = state.portEFF7 || 0;
                this.pentagon1024Mode = state.pentagon1024Mode || false;
                this.ramInRomMode = state.ramInRomMode || false;
            }
        }

        // Port 0xEFF7 handler for Pentagon 1024
        // Bit 2: 0 = 1MB mode (extended paging), 1 = 128K compatibility mode
        // Bit 3: 1 = RAM page 0 mapped at 0x0000-0x3FFF instead of ROM
        writePortEFF7(val) {
            this.portEFF7 = val;
            this.pentagon1024Mode = !(val & 0x04);  // bit 2 = 0 means 1MB mode
            this.ramInRomMode = !!(val & 0x08);     // bit 3 = 1 means RAM replaces ROM
        }

        // Port 0x1FFD handler for +2A
        // Bit 0: special paging mode (1=all-RAM, 0=normal)
        // Bits 1-2: special paging config (when bit 0 set)
        // Bit 2: ROM bank high bit (when bit 0 clear)
        write1FFD(val) {
            if (this.profile.pagingModel !== '+2a' || this.pagingDisabled) return;
            this.port1FFD = val;

            if (val & 0x01) {
                // Special paging mode: all 4 slots are RAM
                this.specialPagingMode = true;
                const config = (val >> 1) & 0x03;
                // Config 0: banks 0,1,2,3
                // Config 1: banks 4,5,6,7
                // Config 2: banks 4,5,6,3
                // Config 3: banks 4,7,6,3
                switch (config) {
                    case 0: this.specialBanks = [0, 1, 2, 3]; break;
                    case 1: this.specialBanks = [4, 5, 6, 7]; break;
                    case 2: this.specialBanks = [4, 5, 6, 3]; break;
                    case 3: this.specialBanks = [4, 7, 6, 3]; break;
                }
            } else {
                // Normal paging mode
                this.specialPagingMode = false;
                // Update ROM bank: high bit from 0x1FFD bit 2, low bit from 0x7FFD bit 4
                this.currentRomBank = ((val >> 2) & 1) << 1 | (this.currentRomBank & 1);
            }
        }

        // Individual paging setters for debugger
        setRamBank(bank) {
            if (this.profile.pagingModel === 'none') return;
            this.currentRamBank = bank % this.profile.ramPages;
        }

        setRomBank(bank) {
            if (this.profile.pagingModel === 'none') return;
            this.currentRomBank = bank % this.profile.romBanks;
        }

        setScreenBank(bank) {
            if (this.profile.pagingModel === 'none') return;
            this.screenBank = (bank === 5 || bank === 7) ? bank : 5;
        }

        setPagingDisabled(disabled) {
            if (this.profile.pagingModel === 'none') return;
            this.pagingDisabled = !!disabled;
        }

        // Port I/O for 128K/+2A paging
        writePort(port, val) {
            // 128K paging port - responds to any port with A1=0 and A15=0
            if ((port & 0x8002) === 0) {
                this.writePaging(val);
            }
            // +2A port 0x1FFD - responds to any port with A1=0, A12=1, A13=0, A14=0, A15=0
            // Decoding: bits 15,14,13 = 0, bit 12 = 1, bit 1 = 0 → (port & 0xF002) === 0x1000
            if (this.profile.pagingModel === '+2a' && (port & 0xF002) === 0x1000) {
                this.write1FFD(val);
            }
        }
        
        readPort(port) {
            // Memory doesn't handle port reads directly
            return 0xFF;
        }
        
        getScreenBase() {
            if (this.profile.ramPages === 1) return { ram: this.ram[0], offset: 0 };
            return { ram: this.ram[this.screenBank], offset: 0 };
        }

        getRamBank(bank) {
            if (this.profile.ramPages === 1) return this.ram[0];
            if (bank >= 0 && bank < this.ram.length) return this.ram[bank];
            return null;
        }
        
        isContended(addr) {
            if (!this.contentionEnabled) return false;
            if (!this.profile.hasContention) return false;
            if (this.profile.ramPages === 1) return addr >= 0x4000 && addr < 0x8000;
            if (this.profile.pagingModel === '+2a') {
                if (this.specialPagingMode) {
                    const slot = addr >> 14;
                    return this.specialBanks[slot] >= 4;
                }
                if (addr >= 0x4000 && addr < 0x8000) return true;  // Bank 5 (contended)
                if (addr >= 0xC000) return this.currentRamBank >= 4;
                return false;
            }
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
                trdosActive: this.trdosActive,
                port1FFD: this.port1FFD,
                specialPagingMode: this.specialPagingMode,
                specialBanks: this.specialBanks.slice()
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
