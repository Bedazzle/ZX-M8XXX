/**
 * ZX-M8XXX - Spectrum Machine Integration
 * @license GPL-3.0
 */

(function(global) {
    'use strict';

    class Spectrum {
        constructor(canvas, options = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.overlayCanvas = options.overlayCanvas || null;
            this.overlayCtx = this.overlayCanvas ? this.overlayCanvas.getContext('2d') : null;
            this.zoom = 1;
            this.machineType = options.machineType || '48k';
            this.profile = getMachineProfile(this.machineType);
            this.tapeTrapsEnabled = options.tapeTrapsEnabled !== false;

            this.memory = new Memory(this.machineType);
            this.cpu = new Z80(this.memory);
            this.ula = new ULA(this.memory, this.machineType);
            this.ula.cpu = this.cpu;  // For debug access to CPU state

            // Setup contention
            this.setupContention();
            
            this.tapeLoader = new TapeLoader();
            this.tapePlayer = new TapePlayer();
            this.snapshotLoader = new SnapshotLoader();
            this.tapeEarBit = false;  // EAR input state from tape (bit 6 of port 0xFE)
            this.tapeFlashLoad = true;  // Flash load mode (instant) vs real-time (with border/sound)
            this._turboBlockPending = false;  // Flag for auto-starting turbo block playback
            this._lastTapeUpdate = 0;  // T-state of last tape update (for accurate EAR timing)
            this.tapeTrap = new TapeTrapHandler(this.cpu, this.memory, null);
            this.tapeTrap.setEnabled(this.tapeTrapsEnabled);
            this.trdosTrap = new TRDOSTrapHandler(this.cpu, this.memory);
            this.trdosTrap.setEnabled(this.tapeTrapsEnabled);  // Use same setting as tape traps
            this.betaDisk = new BetaDisk();  // Beta Disk interface (WD1793)
            this.betaDiskEnabled = this.profile.betaDiskDefault;  // Beta Disk enabled by default for Pentagon machines
            this._betaDiskPagingEnabled = false;  // Cached flag for fast updateBetaDiskPaging check

            // µPD765 FDC (ZX Spectrum +3)
            this.fdc = this.profile.hasFDC ? new UPD765() : null;

            // AY-3-8910 sound chip
            this.ay = new AY(this.profile.ayClockHz);
            this.ayEnabled = this.profile.ayDefault;  // AY enabled by default for 128K/Pentagon
            this.ay48kEnabled = false;  // Optional AY for 48K (like Melodik interface)
            this.aySelectedRegister = 0;

            // Audio manager (initialized on user interaction due to browser autoplay policy)
            this.audio = null;

            // Beeper state tracking for audio generation
            this.beeperChanges = [];      // Array of {tStates, level} for frame
            this.beeperLevel = 0;         // Current beeper output level (0 or 1)

            // Tape audio setting (enable loading sounds)
            this.tapeAudioEnabled = true;
            
            this.cpu.portRead = this.portRead.bind(this);
            this.cpu.portWrite = this.portWrite.bind(this);
            
            this.timing = this.ula.getTiming();
            this.frameInterval = null;
            this.running = false;
            this.lastFrameTime = 0;
            this.frameCount = 0;
            this.actualFps = 0;
            
            this.updateDisplayDimensions();

            this.romLoaded = false;
            this.overlayMode = 'none';  // Overlay mode: none, grid, screen, reveal
            this.onFrame = null;
            this.onRomLoaded = null;
            this.onError = null;
            this.onBreakpoint = null; // Called when breakpoint hit
            this.pendingSnapCallback = null; // Called at next frame boundary for safe snapshots
            
            // Speed control (100 = normal, 0 = max)
            this.speed = 100;
            this.rafId = null;

            // Late timing model (affects ULA timing including INT, floating bus, contention)
            // Early = cold ULA, Late = warm ULA
            // Real hardware drifts from early to late as ULA warms up
            // Floating bus: +1 T-state offset in late mode
            // INT timing: +1 T-state in late mode (INT pulse starts at T=1 instead of T=0)
            // This causes CPU halted at T=0 to run one more HALT NOP before seeing INT
            this.lateTimings = true;  // Late timing (default - warmed ULA)
            this.INT_LATE_OFFSET = 1;  // Late INT timing offset (1 T-state)
            this._intDebugCount = 0;   // Debug counter for INT timing
            this._floatBusLogCount = 0; // Debug counter for floating bus
            this.debugFloatingBus = false; // Enable floating bus debug logging
            this._floatBusLogActive = false; // Only log after first halted INT (test running)
            this.debugBorderOut = false; // Border OUT timing debug logging
            this.lastDebugBorderColor = -1; // Track last logged border color
            this.pendingIntTstates = 0; // INT tstates to add at frame start
            this.INT_PULSE_DURATION = 32;  // INT signal active for 32 T-states (48K) or 36 (128K)
            this.pendingInt = false;   // INT waiting to fire
            this.pendingIntAt = 0;     // T-state when pending INT should fire
            this.pendingIntEnd = 0;    // T-state when pending INT pulse ends
            this._debugIntTiming = false; // Debug: log INT timing to console
            this.frameStartOffset = 0; // T-state overshoot at frame start (for border timing)
            this.accumulatedContention = 0; // Accumulated contention delays for ULA timing

            // Unified trigger system - replaces separate breakpoints/watchpoints/port breakpoints
            // Trigger types: 'exec', 'read', 'write', 'rw', 'port_in', 'port_out', 'port_io'
            this.triggers = [];
            this.triggerHit = false;
            this.lastTrigger = null; // {trigger, addr, val, port, direction}
            this.onTrigger = null; // Unified callback for all trigger types
            // Fast O(1) lookup Set for exec breakpoints (rebuilt when triggers change)
            this.execBreakpointSet = new Set();

            // Legacy arrays - now views into unified triggers for backward compatibility
            this.breakpoints = [];
            this.breakpointHit = false;

            this.portBreakpoints = [];
            this.portBreakpointHit = false;
            this.lastPortBreakpoint = null;

            this.watchpoints = [];
            this.watchpointHit = false;
            this.lastWatchpoint = null;
            this.onWatchpoint = null;
            this.onPortBreakpoint = null;
            this.onInstructionExecuted = null; // Called after each instruction (for xref tracking)
            this.xrefTrackingEnabled = false; // Enable xref runtime tracking
            this.onBeforeStep = null; // Called before each instruction (for trace recording)
            this.traceEnabled = false; // Enable execution trace recording (stepping)
            this.runtimeTraceEnabled = false; // Enable trace during full-speed execution
            this.tracePortOps = []; // Port operations during current instruction
            this.traceMemOps = []; // Memory write operations during current instruction
            this.traceMemOpsLimit = 8; // Max memory ops to record per instruction
            this.haltTraced = false; // Track if current HALT state has been traced

            // Media storage for project save/load
            // Stores original TAP/TRD/SCL data so programs can load additional files
            this.loadedMedia = null; // { type: 'tap'|'trd'|'scl', data: Uint8Array, name: string }

            // Callback for processing TRD data before loading (used for boot injection)
            this.onBeforeTrdLoad = null; // function(data, filename) => processedData

            // Auto memory mapping - tracks executed/read/written addresses
            this.autoMap = {
                enabled: false,
                inExecution: false,    // Only track during actual CPU execution
                // Maps store: key -> count (key format: "addr" or "addr:page")
                executed: new Map(),   // Instruction fetch addresses
                read: new Map(),       // Non-fetch read addresses
                written: new Map(),    // Written addresses
                currentFetchAddrs: new Set() // Addresses fetched in current instruction
            };

            // RZX playback state
            this.rzxPlayer = null;      // RZXLoader instance
            this.rzxFrame = 0;          // Current frame number
            this.rzxPlaying = false;    // Whether RZX playback is active
            this.rzxData = null;        // Original RZX file data for project save
            this.rzxInstructions = 0;   // Instruction count into current RZX frame
            this.rzxFrameStartInstr = 0; // CPU instruction count at start of emu frame
            this.rzxFirstInterrupt = true; // Skip first frame advance after snapshot
            this.onRZXEnd = null;       // Callback when playback ends
            this.rzxRecentInputs = [];  // Recent RZX inputs for debug display
            this.rzxLastPort = 0;       // Last port read for RZX
            this.rzxDebugAddr = 0;      // Address to log during RZX (0=disabled, e.g. 0x8F8C for RNG)
            this.rzxDebugFrames = 0;    // Log detailed info for first N frames (0=disabled)
            this.rzxDebugLog = [];      // Collected debug info for export
            this.portLog = [];          // Port I/O log for debugging
            this.portLogEnabled = false; // Whether to log port I/O

            // RZX recording state
            this.rzxRecording = false;      // Whether RZX recording is active
            this.rzxRecordPending = false;  // Recording starts at next frame boundary
            this.rzxRecordedFrames = [];    // Array of {fetchCount, inputs: []}
            this.rzxRecordCurrentFrame = null; // Current frame being recorded
            this.rzxRecordStartInstr = 0;   // CPU instruction count at start of recording frame
            this.rzxRecordTstates = 0;      // T-state position when recording started
            this.rzxRecordSnapshot = null;  // Initial snapshot (Uint8Array)
            this.rzxRecordSnapshotType = 'szx'; // Snapshot format (SZX preserves halted state)

            // Kempston joystick state (active high)
            // Bit 0: Right, Bit 1: Left, Bit 2: Down, Bit 3: Up, Bit 4: Fire
            this.kempstonState = 0;
            this.kempstonEnabled = false; // Disabled by default

            // Kempston Mouse state
            // Ports: FADF=buttons, FBDF=X, FFDF=Y
            // Buttons: bits 0-2 = right/left/middle (active low), bits 4-7 = wheel (0-15)
            this.kempstonMouseX = 0;
            this.kempstonMouseY = 0;
            this.kempstonMouseButtons = 0x07; // Buttons released (bits 0-2 high), wheel at 0
            this.kempstonMouseWheel = 0; // Wheel position 0-15
            this.kempstonMouseEnabled = false;
            this.kempstonMouseWheelEnabled = false;

            // Extended Kempston Joystick (bits 5-7: C, A, Start buttons)
            this.kempstonExtendedEnabled = false;
            this.kempstonExtendedState = 0; // Bits 5,6,7 for extra buttons

            // Hardware Gamepad support
            this.gamepadEnabled = false;
            this.gamepadIndex = null; // Connected gamepad index
            this.gamepadState = 0;    // Gamepad joystick state (separate from keyboard)
            this.gamepadExtState = 0; // Gamepad extended button state
            // Custom gamepad mapping (null = use default, otherwise { up: {type, index, threshold}, ... })
            this.gamepadMapping = null;

            // Memory/CPU callback functions (stored for enable/disable)
            this._memoryReadCallback = (addr, val) => {
                // Auto-map: track non-fetch reads (only during CPU execution)
                if (this.autoMap.enabled && this.autoMap.inExecution && !this.autoMap.currentFetchAddrs.has(addr)) {
                    const key = this.getAutoMapKey(addr);
                    this.autoMap.read.set(key, (this.autoMap.read.get(key) || 0) + 1);
                }
                if (this.triggers.length > 0) this.checkReadWatchpoint(addr, val);
            };
            this._memoryWriteCallback = (addr, val) => {
                // Auto-map: track writes (only during CPU execution)
                if (this.autoMap.enabled && this.autoMap.inExecution) {
                    const key = this.getAutoMapKey(addr);
                    this.autoMap.written.set(key, (this.autoMap.written.get(key) || 0) + 1);
                }
                // Trace: track memory writes (only during runtime tracing, not step tracing)
                if (this.runtimeTraceEnabled &&
                    this.traceMemOps.length < this.traceMemOpsLimit) {
                    this.traceMemOps.push({ addr, val });
                }
                // Multicolor: disabled (known limitation - see README)
                if (this.triggers.length > 0) this.checkWriteWatchpoint(addr, val);
            };
            this._cpuFetchCallback = (addr) => {
                if (this.autoMap.enabled && this.autoMap.inExecution) {
                    const key = this.getAutoMapKey(addr);
                    this.autoMap.executed.set(key, (this.autoMap.executed.get(key) || 0) + 1);
                    this.autoMap.currentFetchAddrs.add(addr);
                }
            };

            // Start with callbacks disabled (null = no overhead)
            this.memory.onRead = null;
            this.memory.onWrite = null;
            this.cpu.onFetch = null;

            this.boundKeyDown = this.handleKeyDown.bind(this);
            this.pressedKeys = new Map(); // Track e.code → e.key for proper release
            this.boundKeyUp = this.handleKeyUp.bind(this);
            this.keyboardHandlersRegistered = false;
        }

        // ========== Initialization ==========

        async init(romUrl) {
            try {
                if (romUrl) await this.loadRom(romUrl);
                this.reset();
                return true;
            } catch (e) {
                if (this.onError) this.onError(e);
                return false;
            }
        }
        
        async loadRom(source, bank = 0) {
            let data;
            if (typeof source === 'string') {
                const response = await fetch(source);
                if (!response.ok) throw new Error(`Failed to load ROM: ${response.status}`);
                data = await response.arrayBuffer();
            } else {
                data = source;
            }
            this.memory.loadRom(data, bank);
            this.romLoaded = true;
            if (this.onRomLoaded) this.onRomLoaded();
        }

        // Get ROM checksum for verification (call from console: spectrum.getRomChecksum())
        getRomChecksum() {
            let sum = 0;
            const romSize = this.profile.romSize;
            for (let i = 0; i < romSize; i++) {
                sum = (sum + this.memory.read(i)) & 0xFFFFFFFF;
            }
            // Also compute first 256 bytes separately (useful for quick check)
            let first256 = 0;
            for (let i = 0; i < 256; i++) {
                first256 = (first256 + this.memory.read(i)) & 0xFFFF;
            }
            console.log(`ROM checksum: full=${sum.toString(16)} first256=${first256.toString(16)} size=${romSize}`);
            console.log(`ROM[0x38]=${this.memory.read(0x38).toString(16)} (should be F5 for 48K)`);
            return { full: sum, first256, size: romSize };
        }

        // ========== Debug Properties ==========

        get debugIntTiming() { return this._debugIntTiming; }
        set debugIntTiming(val) {
            this._debugIntTiming = val;
            if (this.cpu) this.cpu.debugInterrupts = val;
        }

        // ========== Memory & Contention ==========

        setupContention() {
            // Machines without contention (Pentagon, Pentagon 1024)
            if (!this.profile.hasContention) {
                this.contentionFunc = null;
                this.cpu.contend = null;
                this.cpu.ioContend = null;
                this.contentionEnabled = false;

                // Multicolor tracking for Pentagon (no contention, simple tStates)
                this.ula.mcWriteAdjust = 5;
                this.cpu.onMemWrite = (addr, val) => {
                    if (addr >= 0x5800 && addr <= 0x5AFF) {
                        this.ula.setAttrAt(addr - 0x5800, val, this.cpu.tStates);
                        this.ula.hadAttrChanges = true;
                    }
                };
                return;
            }

            // For 48K: per-access contention for T-state accurate timing
            // This is essential for pixel-perfect border effects
            // Precompute contention delay table from profile
            if (this.profile.contentionPattern === '76543210') {
                // +2A/+3: delays at contentionFrom are (1,0,7,6,5,4,3,2)
                // The Amstrad gate array starts contention 6T into the 8-cycle ULA fetch
                this.contentionTable = [1, 0, 7, 6, 5, 4, 3, 2];
            } else {
                // 48K/128K/+2: delays at contentionFrom are (6,5,4,3,2,1,0,0)
                this.contentionTable = [6, 5, 4, 3, 2, 1, 0, 0];
            }

            if (this.profile.ulaProfile === '48k') {
                this.contentionFunc = null;
                // Memory contention: addresses 0x4000-0x7FFF during screen fetch
                // z80.js checks contention at instruction start, but real access is later
                // Track approximate M-cycle position (4T per access is reasonable average)
                let mcycleOffset = 0;

                // Track accumulated contention for ULA timing correction
                // ULA runs at fixed rate, CPU gets delayed - need to track the difference
                this.accumulatedContention = 0;
                this.memoryContentionDisabled = false;  // Set to true to disable memory contention

                // Track if current access is M1 (opcode fetch) = 4T, or subsequent = 3T
                let isFirstAccess = true;

                this.cpu.contend = (addr) => {
                    if (this.memoryContentionDisabled) {
                        mcycleOffset += isFirstAccess ? 4 : 3;
                        isFirstAccess = false;
                        return;
                    }
                    if (addr >= 0x4000 && addr <= 0x7FFF) {
                        // Check contention at estimated actual access time
                        const actualT = this.cpu.tStates + mcycleOffset;
                        const delay = this.checkContention(actualT);
                        if (delay > 0) {
                            if (this.debugContention) {
                                console.log(`CONTEND addr=${addr.toString(16)} tStates=${this.cpu.tStates} mcycle=${mcycleOffset} actualT=${actualT} delay=${delay} isM1=${isFirstAccess}`);
                            }
                            this.cpu.tStates += delay;
                            this.accumulatedContention += delay;
                        }
                    }
                    // M1 fetch = 4T, all other memory accesses = 3T
                    mcycleOffset += isFirstAccess ? 4 : 3;
                    isFirstAccess = false;
                };

                // Internal cycles callback - for instructions with internal cycles before memory ops
                // E.g., PUSH has 1T internal cycle before the two write cycles
                this.cpu.internalCycles = (cycles) => {
                    mcycleOffset += cycles;
                };

                // Reset at instruction boundaries
                const originalExecute = this.cpu.execute.bind(this.cpu);
                this.cpu.execute = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                    return originalExecute();
                };

                // For prefix instructions (CB, DD, ED, FD), the second opcode is also M1
                const originalIncR = this.cpu.incR.bind(this.cpu);
                this.cpu.incR = () => {
                    // incR is called before M1 fetches. If mcycleOffset > 0, we're in a prefix
                    if (mcycleOffset > 0) {
                        isFirstAccess = true;  // Next fetch is M1 (prefix opcode)
                    }
                    return originalIncR();
                };

                // Interrupt/NMI: set mcycleOffset to acknowledge cycle length, memory ops are not M1 fetches
                // IM1/IM2: 7T acknowledge (5T + 2 wait states) before push
                // NMI: 5T acknowledge before push
                const originalInterrupt = this.cpu.interrupt.bind(this.cpu);
                this.cpu.interrupt = () => {
                    mcycleOffset = 7;  // 7T acknowledge cycle before push
                    isFirstAccess = false;  // Interrupt push/read are not M1
                    return originalInterrupt();
                };
                const originalNmi = this.cpu.nmi.bind(this.cpu);
                this.cpu.nmi = () => {
                    mcycleOffset = 5;  // 5T acknowledge cycle before push
                    isFirstAccess = false;
                    return originalNmi();
                };

                // Internal cycle contention handler
                // For internal T-states (not memory accesses), apply contention if address is contended
                // This is critical for accurate timing of DJNZ loops and other instructions with internal cycles
                // Set spectrum.internalContentionDisabled = true to disable for testing
                this.internalContentionCalls = 0;
                this.internalContentionDelay = 0;
                this.internalNonContendedCalls = 0;  // Track calls with non-contended addresses
                this.internalContentionDisabled = false;  // Enable internal contention (needed for ULA48)
                this.cpu.contendInternal = (addr, tstates) => {
                    if (this.internalContentionDisabled) {
                        mcycleOffset += tstates;
                        return;
                    }
                    if (addr >= 0x4000 && addr <= 0x7FFF) {
                        this.internalContentionCalls++;
                        let totalDelay = 0;
                        // Swan/Fuse style: CheckContention; Inc(TStates) for each cycle
                        // Each check happens at current position, then 1T is added
                        let currentT = this.cpu.tStates + mcycleOffset;
                        for (let i = 0; i < tstates; i++) {
                            const delay = this.checkContention(currentT);
                            totalDelay += delay;
                            currentT += delay + 1;
                        }
                        if (totalDelay > 0) {
                            if (this.debugContention) {
                                console.log(`CONTEND_INTERNAL addr=${addr.toString(16)} tStates=${this.cpu.tStates} tstates=${tstates} totalDelay=${totalDelay}`);
                            }
                            this.cpu.tStates += totalDelay;
                            this.accumulatedContention += totalDelay;
                            this.internalContentionDelay += totalDelay;
                        }
                    } else {
                        this.internalNonContendedCalls++;
                    }
                    // Update mcycleOffset to account for internal cycles
                    mcycleOffset += tstates;
                };

                // Multicolor tracking: intercept attribute memory writes ($5800-$5AFF)
                // Call ula.setAttrAt() with the T-state when the write actually happens
                // mcWriteAdjust = 0 because we pass the actual write time (not instruction start)
                this.ula.mcWriteAdjust = 0;
                this.cpu.onMemWrite = (addr, val) => {
                    if (addr >= 0x5800 && addr <= 0x5AFF) {
                        // Calculate write time: cpu.tStates already has contention delays,
                        // mcycleOffset tracks position in instruction for accurate timing
                        const writeT = this.cpu.tStates + mcycleOffset;
                        this.ula.setAttrAt(addr - 0x5800, val, writeT);
                        this.ula.hadAttrChanges = true;
                    }
                };

                this.cpu.ioContend = null;
                this.contentionEnabled = true;
                return;
            }

            // For +2A/+3: similar contention framework but banks 4,5,6,7 are contended (not 1,3,5,7)
            // Key differences from 128K:
            //   - Memory contention uses pattern (7,6,5,4,3,2,1,0), not (6,5,4,3,2,1,0,0)
            //   - Non-MREQ contention (internal cycles) is NONE (FUSE: contend_delay_no_mreq = none)
            //   - IO contention is not applied (port 0xFE is not contended)
            // In special paging mode, all slots map to RAM, each slot's bank must be checked
            if (this.profile.pagingModel === '+2a') {
                this.contentionFunc = null;
                let mcycleOffset = 0;
                this.accumulatedContention = 0;
                this.memoryContentionDisabled = false;
                let isFirstAccess = true;

                // +2A contention: banks 4,5,6,7 are contended
                const isContendedAddr = (addr) => {
                    const mem = this.memory;
                    if (mem.specialPagingMode) {
                        // Special paging: check the bank mapped to this address range
                        const slot = addr >> 14;
                        const bank = mem.specialBanks[slot];
                        return bank >= 4;
                    }
                    // Normal mode: bank 5 at 0x4000-0x7FFF (contended), bank 2 at 0x8000-0xBFFF (not)
                    if (addr >= 0x4000 && addr <= 0x7FFF) return true;  // Bank 5 is always contended
                    if (addr >= 0xC000 && addr <= 0xFFFF) {
                        return mem.currentRamBank >= 4;
                    }
                    return false;
                };

                this.cpu.contend = (addr) => {
                    if (this.memoryContentionDisabled) {
                        mcycleOffset += isFirstAccess ? 4 : 3;
                        isFirstAccess = false;
                        return;
                    }
                    if (isContendedAddr(addr)) {
                        const actualT = this.cpu.tStates + mcycleOffset;
                        const delay = this.checkContention(actualT);
                        if (delay > 0) {
                            this.cpu.tStates += delay;
                            this.accumulatedContention += delay;
                        }
                    }
                    mcycleOffset += isFirstAccess ? 4 : 3;
                    isFirstAccess = false;
                };

                this.cpu.internalCycles = (cycles) => {
                    mcycleOffset += cycles;
                };

                const originalExecute = this.cpu.execute.bind(this.cpu);
                this.cpu.execute = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                    return originalExecute();
                };

                const originalIncR = this.cpu.incR.bind(this.cpu);
                this.cpu.incR = () => {
                    if (mcycleOffset > 0) {
                        isFirstAccess = true;
                    }
                    return originalIncR();
                };

                const originalInterrupt = this.cpu.interrupt.bind(this.cpu);
                this.cpu.interrupt = () => {
                    mcycleOffset = 7;
                    isFirstAccess = false;
                    return originalInterrupt();
                };
                const originalNmi = this.cpu.nmi.bind(this.cpu);
                this.cpu.nmi = () => {
                    mcycleOffset = 5;
                    isFirstAccess = false;
                    return originalNmi();
                };

                // +2A/+3: NO internal cycle contention (FUSE: contend_delay_no_mreq = none)
                // The Amstrad gate array only contends on MREQ, not on internal cycles
                this.internalContentionCalls = 0;
                this.internalContentionDelay = 0;
                this.internalNonContendedCalls = 0;
                this.internalContentionDisabled = false;
                this.cpu.contendInternal = (addr, tstates) => {
                    mcycleOffset += tstates;
                };

                this.ula.mcWriteAdjust = 0;
                this.cpu.onMemWrite = (addr, val) => {
                    if (addr >= 0x5800 && addr <= 0x5AFF) {
                        const writeT = this.cpu.tStates + mcycleOffset;
                        this.ula.setAttrAt(addr - 0x5800, val, writeT);
                        this.ula.hadAttrChanges = true;
                    }
                };

                this.cpu.ioContend = null;
                this.contentionEnabled = true;
                return;
            }

            // For 128K/+2: same contention as 48K, but also check contended banks at 0xC000
            // Contended banks: 1, 3, 5, 7 (odd-numbered banks)
            // Bank 5 is always at 0x4000-0x7FFF
            // Selected bank can be paged at 0xC000-0xFFFF
            if (this.machineType === '128k' || this.machineType === '+2') {
                this.contentionFunc = null;
                let mcycleOffset = 0;
                this.accumulatedContention = 0;
                this.memoryContentionDisabled = false;
                let isFirstAccess = true;

                // Check if address is in contended memory
                const isContendedAddr = (addr) => {
                    // Bank 5 at 0x4000-0x7FFF is always contended
                    if (addr >= 0x4000 && addr <= 0x7FFF) return true;
                    // Check if paged bank at 0xC000-0xFFFF is contended (banks 1,3,5,7)
                    if (addr >= 0xC000 && addr <= 0xFFFF) {
                        return (this.memory.currentRamBank & 1) === 1;
                    }
                    return false;
                };

                this.cpu.contend = (addr) => {
                    if (this.memoryContentionDisabled) {
                        mcycleOffset += isFirstAccess ? 4 : 3;
                        isFirstAccess = false;
                        return;
                    }
                    if (isContendedAddr(addr)) {
                        const actualT = this.cpu.tStates + mcycleOffset;
                        const delay = this.checkContention(actualT);
                        if (delay > 0) {
                            this.cpu.tStates += delay;
                            this.accumulatedContention += delay;
                        }
                    }
                    mcycleOffset += isFirstAccess ? 4 : 3;
                    isFirstAccess = false;
                };

                this.cpu.internalCycles = (cycles) => {
                    mcycleOffset += cycles;
                };

                const originalExecute = this.cpu.execute.bind(this.cpu);
                this.cpu.execute = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                    return originalExecute();
                };

                const originalIncR = this.cpu.incR.bind(this.cpu);
                this.cpu.incR = () => {
                    if (mcycleOffset > 0) {
                        isFirstAccess = true;
                    }
                    return originalIncR();
                };

                const originalInterrupt = this.cpu.interrupt.bind(this.cpu);
                this.cpu.interrupt = () => {
                    mcycleOffset = 7;
                    isFirstAccess = false;
                    return originalInterrupt();
                };
                const originalNmi = this.cpu.nmi.bind(this.cpu);
                this.cpu.nmi = () => {
                    mcycleOffset = 5;
                    isFirstAccess = false;
                    return originalNmi();
                };

                this.internalContentionCalls = 0;
                this.internalContentionDelay = 0;
                this.internalNonContendedCalls = 0;
                this.internalContentionDisabled = false;
                this.cpu.contendInternal = (addr, tstates) => {
                    if (this.internalContentionDisabled) {
                        mcycleOffset += tstates;
                        return;
                    }
                    if (isContendedAddr(addr)) {
                        this.internalContentionCalls++;
                        let totalDelay = 0;
                        let currentT = this.cpu.tStates + mcycleOffset;
                        for (let i = 0; i < tstates; i++) {
                            const delay = this.checkContention(currentT);
                            totalDelay += delay;
                            currentT += delay + 1;
                        }
                        if (totalDelay > 0) {
                            this.cpu.tStates += totalDelay;
                            this.accumulatedContention += totalDelay;
                            this.internalContentionDelay += totalDelay;
                        }
                    } else {
                        this.internalNonContendedCalls++;
                    }
                    mcycleOffset += tstates;
                };

                // Multicolor tracking with accurate timing (same as 48K)
                this.ula.mcWriteAdjust = 0;
                this.cpu.onMemWrite = (addr, val) => {
                    if (addr >= 0x5800 && addr <= 0x5AFF) {
                        const writeT = this.cpu.tStates + mcycleOffset;
                        this.ula.setAttrAt(addr - 0x5800, val, writeT);
                        this.ula.hadAttrChanges = true;
                    }
                };

                this.cpu.ioContend = null;
                this.contentionEnabled = true;
                return;
            }

            // Pentagon: no contention, simple multicolor tracking
            this.cpu.contend = null;
            this.cpu.ioContend = null;
            this.contentionEnabled = false;
            this.ula.mcWriteAdjust = 5;
            this.cpu.onMemWrite = (addr, val) => {
                if (addr >= 0x5800 && addr <= 0x5AFF) {
                    this.ula.setAttrAt(addr - 0x5800, val, this.cpu.tStates);
                    this.ula.hadAttrChanges = true;
                }
            };
        }

        // Contention check using precomputed delay table
        // Returns delay to add based on current T-state position
        // The contention pattern repeats every 8 T-states during screen fetch:
        //   48K/128K/+2: [6,5,4,3,2,1,0,0]   +2A/+3: [1,0,7,6,5,4,3,2]
        // CONTENTION_START_TSTATE is aligned with the FIRST SCREEN FETCH of the frame
        // (not the line start - that would include left border where no contention occurs).
        checkContention(tState) {
            if (!this.ula.IO_CONTENTION_ENABLED) return 0;

            // Contention timing is NOT offset for late timing mode.
            // The ULA fetches video RAM at the same absolute T-states regardless.
            // Debug: try shifting contention start to test if it fixes Comet
            const contentionOffset = this.contentionOffset || 0;
            const contentionFrom = this.ula.CONTENTION_START_TSTATE + contentionOffset;
            // ContentionTo = ContentionFrom + 191 paper lines + 128 T-states of last line
            const contentionTo = contentionFrom + (191 * this.ula.TSTATES_PER_LINE) + 128;
            const ticksPerLine = this.ula.TSTATES_PER_LINE;

            // Only apply contention within screen area
            if (tState < contentionFrom || tState >= contentionTo) {
                return 0;
            }

            // N = position within the 8-cycle contention pattern on the current line
            // The & 0x87 mask combines: bits 0-2 for 8-cycle position, bit 7 for past-paper detection
            // Positions 128+ (past paper area on the line) always return 0
            const N = ((tState - contentionFrom) % ticksPerLine) & 0x87;
            // Use precomputed delay table (set in setupContention based on profile.contentionPattern)
            // '65432100': [6,5,4,3,2,1,0,0] — 48K/128K/+2
            // '76543210': [1,0,7,6,5,4,3,2] — +2A/+3 (shifted: ULA contention starts 6T into cycle)
            return N < 8 ? this.contentionTable[N] : 0;
        }

        // Swan-style I/O timing for ULA ports
        // Applies contention and returns total T-states to add
        // instructionTiming: 11 for OUT (n),A / IN A,(n), 12 for OUT (C),r / IN r,(C)
        applyIOTimings(port, instructionTiming = 12) {
            if (!this.ula.IO_CONTENTION_ENABLED) return 0;
            // +2A/+3: no IO contention (ULA only contends on MREQ, not during IO)
            if (!this.profile.hasIOContention) return 0;

            const highByte = (port >> 8) & 0xFF;
            const lowByte = port & 0xFF;
            const isUlaPort = (lowByte & 0x01) === 0;
            const highByteContended = (highByte >= 0x40 && highByte <= 0x7F);

            // I/O contention check offset from instruction start
            // OUT (n),A / IN A,(n): opcode (4T) + port byte (3T) = 7T before I/O cycle
            // OUT (C),r / IN r,(C): opcode ED (4T) + opcode (4T) = 8T before I/O cycle
            const fetchOffset = (instructionTiming === 11) ? 7 : 8;
            let totalDelay = 0;

            if (highByteContended) {
                if (isUlaPort) {
                    // C:1, C:3 - both cycles contended
                    const check1T = this.cpu.tStates + fetchOffset + totalDelay;
                    const delay1 = this.checkContention(check1T);
                    totalDelay += delay1;
                    totalDelay += 1;
                    const check2T = this.cpu.tStates + fetchOffset + totalDelay;
                    const delay2 = this.checkContention(check2T);
                    totalDelay += delay2;
                    totalDelay += 3;
                    // Debug I/O contention near paper boundary
                    if (this.debugPaperContention && (check1T >= 14300 && check1T <= 14600)) {
                        console.log(`IO_CONTEND(C:1,C:3) tStates=${this.cpu.tStates} check1=${check1T} d1=${delay1} check2=${check2T} d2=${delay2}`);
                    }
                } else {
                    // C:1, C:1, C:1, C:1
                    for (let i = 0; i < 4; i++) {
                        totalDelay += this.checkContention(this.cpu.tStates + fetchOffset + totalDelay);
                        totalDelay += 1;
                    }
                }
            } else {
                if (isUlaPort) {
                    // N:1, C:3 - first cycle not contended, second cycle contended
                    totalDelay += 1;
                    const checkT = this.cpu.tStates + fetchOffset + totalDelay;
                    const contDelay = this.checkContention(checkT);
                    if (this.debugIOContention && contDelay > 0) {
                        console.log(`IO_CONTEND port=${port.toString(16)} tStates=${this.cpu.tStates} checkT=${checkT} delay=${contDelay}`);
                    }
                    // Debug I/O contention near paper boundary
                    if (this.debugPaperContention && (checkT >= 14300 && checkT <= 14600)) {
                        console.log(`IO_CONTEND(N:1,C:3) tStates=${this.cpu.tStates} checkT=${checkT} delay=${contDelay}`);
                    }
                    totalDelay += contDelay;
                    totalDelay += 3;
                } else {
                    // N:4 - no contention at all
                    totalDelay += 4;
                }
            }

            return totalDelay;
        }

        // I/O timing for IN operations (similar to applyIOTimings but with different fetch offset)
        // IN A,(n) is 11T with I/O starting at ~7T, IN r,(C) is 12T with I/O at ~8T
        applyIOTimingsForRead(port) {
            if (!this.ula.IO_CONTENTION_ENABLED) return 0;
            // +2A/+3: no IO contention (ULA only contends on MREQ, not during IO)
            if (!this.profile.hasIOContention) return 0;

            const highByte = (port >> 8) & 0xFF;
            const lowByte = port & 0xFF;
            const isUlaPort = (lowByte & 0x01) === 0;
            const highByteContended = (highByte >= 0x40 && highByte <= 0x7F);

            // For IN A,(n): fetch offset is 7T (4T opcode + 3T port number)
            const fetchOffset = 7;
            let totalDelay = 0;

            if (highByteContended) {
                if (isUlaPort) {
                    // C:1, C:3 - both cycles contended
                    const check1T = this.cpu.tStates + fetchOffset + totalDelay;
                    const delay1 = this.checkContention(check1T);
                    totalDelay += delay1;
                    totalDelay += 1;
                    const check2T = this.cpu.tStates + fetchOffset + totalDelay;
                    const delay2 = this.checkContention(check2T);
                    totalDelay += delay2;
                    totalDelay += 3;
                } else {
                    // C:1, C:1, C:1, C:1
                    for (let i = 0; i < 4; i++) {
                        totalDelay += this.checkContention(this.cpu.tStates + fetchOffset + totalDelay);
                        totalDelay += 1;
                    }
                }
            } else {
                if (isUlaPort) {
                    // N:1, C:3 - first cycle not contended, second cycle contended
                    totalDelay += 1;
                    const checkT = this.cpu.tStates + fetchOffset + totalDelay;
                    const contDelay = this.checkContention(checkT);
                    totalDelay += contDelay;
                    totalDelay += 3;
                } else {
                    // N:4 - no contention at all
                    totalDelay += 4;
                }
            }

            return totalDelay;
        }

        setContention(enabled) {
            this.contentionEnabled = enabled;
            // Per-line contention is handled in the run loop based on contentionEnabled flag
        }

        // Dump contention statistics to console
        dumpContentionStats() {
            console.log('=== Contention Statistics ===');
            console.log(`Contention enabled: ${this.contentionEnabled}`);
            console.log(`Internal contention calls (contended addr): ${this.internalContentionCalls || 0}`);
            console.log(`Internal contention total delay: ${this.internalContentionDelay || 0} T-states`);
            console.log(`Internal non-contended calls: ${this.internalNonContendedCalls || 0}`);
            console.log(`Accumulated contention this frame: ${this.accumulatedContention || 0}`);
            console.log(`contendInternal callback set: ${!!this.cpu.contendInternal}`);
            console.log(`contend callback set: ${!!this.cpu.contend}`);
        }

        // Reset contention statistics
        resetContentionStats() {
            this.internalContentionCalls = 0;
            this.internalContentionDelay = 0;
            this.internalNonContendedCalls = 0;
            this.accumulatedContention = 0;
        }

        // ========== Display Settings ==========

        updateDisplayDimensions() {
            const dims = this.ula.getDimensions();
            this.canvas.width = dims.width;
            this.canvas.height = dims.height;
            this.imageData = this.ctx.createImageData(dims.width, dims.height);
            // Store previous frame for beam visualization mode
            this.previousFrameBuffer = new Uint8ClampedArray(dims.width * dims.height * 4);
        }

        // Save current frame as previous (call at end of each frame)
        savePreviousFrame(frameBuffer) {
            if (this.previousFrameBuffer && frameBuffer) {
                this.previousFrameBuffer.set(frameBuffer);
            }
        }

        setGrid(enabled) {
            // Legacy support
            this.overlayMode = enabled ? 'grid' : 'none';
        }

        setOverlayMode(mode) {
            // mode: 'normal', 'grid', 'box', 'screen', 'reveal', 'beam', 'beamscreen', 'noattr', 'nobitmap'
            this.overlayMode = mode;
        }

        setZoom(zoom) {
            this.zoom = zoom;
            // Update overlay context reference after canvas resize
            if (this.overlayCanvas) {
                this.overlayCtx = this.overlayCanvas.getContext('2d');
            }
        }

        // ========== Machine Control ==========

        reset() {
            this.cpu.reset();
            this.memory.reset();
            this.ula.reset();
            this.tapeLoader.rewind();
            this.tapePlayer.rewind();
            this.tapePlayer.stop();
            this.tapeEarBit = false;
            this._turboBlockPending = false;
            this.rzxStop();
            if (this.ay) this.ay.reset();
            if (this.fdc) this.fdc.reset();

            // Reset frame timing
            this.frameStartOffset = 0;
            this.accumulatedContention = 0;
            this.pendingInt = false;
            this._intDebugCount = 0;  // Reset INT debug counter

            // Clear auto-map data
            this.autoMap.executed.clear();
            this.autoMap.read.clear();
            this.autoMap.written.clear();
            this.autoMap.currentFetchAddrs.clear();
        }

        // ========== Port I/O ==========

        portRead(port) {
            let result = 0xff;

            // Apply I/O contention for IN operations (same pattern as OUT)
            // IN A,(n) has I/O after 7T, IN r,(C) after 8T - use 7T as average
            if (this.profile.ulaProfile === '48k' && this.ula.IO_CONTENTION_ENABLED) {
                const ioDelay = this.applyIOTimingsForRead(port);
                if (ioDelay > 4) {
                    this.cpu.tStates += (ioDelay - 4);
                }
            }

            // Debug: log first 50 port reads after halted INT detected
            if (this.debugFloatingBus && this._floatBusLogActive && this._floatBusLogCount < 50) {
                const t = this.cpu.tStates;
                console.log(`[PORT-READ] T=${t} port=0x${port.toString(16).padStart(4,'0')}`);
            }

            // RZX playback - return recorded input for ALL port reads
            // RZX records ALL IN instruction results, not just keyboard ports
            // Frame advancement happens at interrupt time (1:1 sync)
            let rzxHandled = false;
            if (this.rzxPlaying && this.rzxPlayer) {
                const frameIdx = this.rzxFrame;
                const frameInfo = this.rzxPlayer.getFrameInfo(frameIdx);
                const inputIdxBefore = frameInfo ? frameInfo.inputIndex : -1;

                const input = this.rzxPlayer.getNextInput(frameIdx);
                result = (input !== null) ? input : 0xFF;
                rzxHandled = true;

                // Store recent input for debug overlay
                this.rzxLastPort = port;
                this.rzxRecentInputs.push({ port, value: result, frame: frameIdx });
                if (this.rzxRecentInputs.length > 10) {
                    this.rzxRecentInputs.shift();
                }
            }

            // Normal port emulation (also used for non-keyboard ports during RZX playback)
            if (!rzxHandled) {
                // Check port breakpoint using unified trigger system
                if (this.running && this.triggers.length > 0) {
                    const trigger = this.checkPortTriggers(port, 0xff, false);
                    if (trigger) {
                        this.portBreakpointHit = true;
                        this.triggerHit = true;
                        this.lastPortBreakpoint = { port, direction: 'in', breakpoint: trigger };
                        this.lastTrigger = { trigger, port, direction: 'in' };
                    }
                }

                const lowByte = port & 0xff;
                const highByte = (port >> 8) & 0xff;

                // Beta Disk ports (Pentagon with disk inserted)
                // Ports are accessible whenever disk is inserted, not just when ROM is paged in
                // (TR-DOS code runs in RAM but still needs disk access)
                // Beta Disk active when: enabled setting AND disk inserted AND TR-DOS ROM loaded
                const betaDiskActive = this.betaDiskEnabled &&
                    this.betaDisk && this.betaDisk.hasDisk() && this.memory.hasTrdosRom();


                if ((lowByte & 0x01) === 0) {
                    // Port 0xFE: keyboard + EAR input
                    // Bits 0-4: keyboard (active low)
                    // Bit 5: HIGH (pulled up)
                    // Bit 6: EAR input - LOW when no tape signal (Issue 2/3 behavior)
                    // Bit 7: HIGH (pulled up)
                    // Note: Real 48K has floating bus on bits 5,7 during screen fetch,
                    // but this causes issues with Z80 CPU tests that expect consistent 0xBF.
                    // Most software and tests expect bits 5,7 to be HIGH.
                    // Floating bus is still available via other port reads (else branch).
                    const keyboard = this.ula.readKeyboard(highByte) & 0x1f;
                    // EAR bit (bit 6) - LOW when no tape, HIGH when tape signal active
                    // Issue 2/3 ULA: reads LOW when no tape connected
                    // Issue 4+ ULA: reads HIGH when no tape connected
                    // We emulate Issue 2/3 behavior (most compatible with tests)

                    // Auto-start turbo block playback when custom loader reads port 0xFE.
                    // Only trigger from RAM (PC >= 0x4000) to avoid false triggers from
                    // ROM keyboard scan (ISR at ~0x0038→0x028E reads port 0xFE for all
                    // 8 half-rows). Without this check, the pilot starts playing during
                    // an interrupt BEFORE the custom loader runs, and short pilots expire
                    // before the loader can sync.
                    if (this._turboBlockPending && !this.tapePlayer.isPlaying() &&
                        this.cpu.pc >= 0x4000) {
                        this._lastTapeUpdate = this.cpu.tStates;  // Reset tape timing tracker
                        this.tapePlayer.play();
                        this._turboBlockPending = false;
                        console.log('[TZX] Auto-start turbo playback at PC=' +
                            this.cpu.pc.toString(16).padStart(4, '0') +
                            ', tStates=' + this.cpu.tStates +
                            ', block=' + this.tapePlayer.currentBlock +
                            ', phase=' + this.tapePlayer.phase +
                            ', flashLoad=' + this.tapeFlashLoad);
                    }

                    // CRITICAL: Update tape to the T-state when I/O actually occurs
                    // IN A,(n) is 11 T-states: fetch(4) + operand(3) + I/O(4)
                    // The actual port read happens at T-state ~7 within the instruction
                    // cpu.tStates is the count BEFORE this instruction, so add offset
                    if (this.tapePlayer.isPlaying()) {
                        const IO_OFFSET = 7;  // T-state within IN instruction when I/O read occurs
                        const tStatesNow = this.cpu.tStates + IO_OFFSET;
                        const elapsed = tStatesNow - this._lastTapeUpdate;
                        if (elapsed > 0) {
                            this.tapePlayer.update(elapsed, tStatesNow);
                            this._lastTapeUpdate = tStatesNow;
                        }
                        this.tapeEarBit = this.tapePlayer.getEarBit();
                    }

                    const ear = this.tapeEarBit ? 0x40 : 0x00;
                    result = keyboard | 0xa0 | ear; // Bits 5,7 always high
                } else if (this.fdc && (port & 0xF002) === 0x2000) {
                    // µPD765 FDC Main Status Register (0x2FFD) — ZX Spectrum +3
                    result = this.fdc.readMSR();
                } else if (this.fdc && (port & 0xF002) === 0x3000) {
                    // µPD765 FDC Data Register (0x3FFD) — ZX Spectrum +3
                    result = this.fdc.readData();
                } else if (betaDiskActive && (lowByte === 0x1f || lowByte === 0x3f ||
                           lowByte === 0x5f || lowByte === 0x7f)) {
                    // Beta Disk WD1793 registers
                    result = this.betaDisk.read(port);
                } else if (betaDiskActive && lowByte === 0xff) {
                    // Beta Disk system register
                    result = this.betaDisk.read(port);
                } else if (lowByte === 0x1f) {
                    // Port 0x1F: Kempston joystick (only when no Beta Disk)
                    // Bits 0-4: standard (Right, Left, Down, Up, Fire/B)
                    // Bits 5-7: extended (C, A, Start) - active high
                    if (this.kempstonEnabled) {
                        // Combine keyboard and gamepad states
                        result = (this.kempstonState | this.gamepadState) & 0x1f;
                        if (this.kempstonExtendedEnabled) {
                            result |= ((this.kempstonExtendedState | this.gamepadExtState) & 0xe0);
                        }
                    } else {
                        result = 0x00;
                    }
                } else if (lowByte === 0xdf && this.kempstonMouseEnabled) {
                    // Kempston Mouse ports (FADF=buttons, FBDF=X, FFDF=Y)
                    const mouseReg = highByte & 0x05;
                    if (mouseReg === 0x00) {
                        // FADF: Buttons (bits 0-2: right/left/middle active low)
                        // Bits 7:4 = wheel position (0-15) if wheel enabled
                        result = this.kempstonMouseButtons & 0x07;
                        if (this.kempstonMouseWheelEnabled) {
                            result |= (this.kempstonMouseWheel & 0x0f) << 4;
                        }
                    } else if (mouseReg === 0x01) {
                        // FBDF: X position (0-255)
                        result = this.kempstonMouseX & 0xff;
                    } else if (mouseReg === 0x05) {
                        // FFDF: Y position (0-255)
                        result = this.kempstonMouseY & 0xff;
                    }
                } else if (this.ula.ulaplus.enabled && port === 0xff3b) {
                    // ULAplus data port read
                    result = this.ula.ulaplusReadData();
                } else if ((port & 0xC002) === 0xC000) {
                    // Port 0xFFFD: AY register read (128K/Pentagon, or 48K with AY enabled)
                    if (this.ayEnabled || (this.machineType === '48k' && this.ay48kEnabled)) {
                        result = this.ay.readRegister();
                    }
                } else {
                    // Floating bus: return video data being read by ULA
                    // Only active during screen display on 48K
                    if (this.machineType === '48k') {
                        result = this.getFloatingBusValue();
                        // Debug: log floating bus reads - only after halted INT
                        if (this.debugFloatingBus && this._floatBusLogActive && this._floatBusLogCount < 500) {
                            const t = this.cpu.tStates;
                            const line = Math.floor(t / this.timing.tstatesPerLine);
                            const tInLine = t % this.timing.tstatesPerLine;
                            this._floatBusLogCount++;
                            console.log(`[FLOAT] T=${t} line=${line} tInLine=${tInLine} port=0x${port.toString(16)} result=0x${result.toString(16).padStart(2,'0')} late=${this.lateTimings}`);
                        }
                    }
                }
            }

            // Track port read for trace (only during runtime tracing, not step tracing)
            if (this.runtimeTraceEnabled && this.onBeforeStep) {
                this.tracePortOps.push({ dir: 'in', port, val: result });
            }

            // Port I/O logging for debugging
            if (this.portLogEnabled) {
                this.portLog.push({
                    dir: 'IN',
                    port: port,
                    value: result,
                    pc: this.cpu.pc,
                    frame: this.rzxPlaying ? this.rzxFrame : -1,
                    t: this.cpu.tStates
                });
            }

            // RZX recording - record all port read results
            if (this.rzxRecording && this.rzxRecordCurrentFrame) {
                this.rzxRecordCurrentFrame.inputs.push(result);
            }

            return result;
        }

        portWrite(port, val, instructionTiming = 12) {
            // Track port write for trace (only during runtime tracing, not step tracing)
            if (this.runtimeTraceEnabled && this.onBeforeStep) {
                this.tracePortOps.push({ dir: 'out', port, val });
            }

            // Port I/O logging for debugging
            if (this.portLogEnabled) {
                this.portLog.push({
                    dir: 'OUT',
                    port: port,
                    value: val,
                    pc: this.cpu.pc,
                    frame: this.rzxPlaying ? this.rzxFrame : -1,
                    t: this.cpu.tStates
                });
            }

            // Check port breakpoint using unified trigger system
            if (this.running && this.triggers.length > 0) {
                const trigger = this.checkPortTriggers(port, val, true);
                if (trigger) {
                    this.portBreakpointHit = true;
                    this.triggerHit = true;
                    this.lastPortBreakpoint = { port, direction: 'out', val, breakpoint: trigger };
                    this.lastTrigger = { trigger, port, val, direction: 'out' };
                }
            }

            const lowByte = port & 0xff;

            // Beta Disk ports (when enabled and disk inserted)
            // Ports are accessible whenever disk is inserted, not just when ROM is paged in
            const betaDiskActive = this.betaDiskEnabled &&
                this.betaDisk && this.betaDisk.hasDisk() && this.memory.hasTrdosRom();

            if ((lowByte & 0x01) === 0) {
                // Track border changes in T-states for pixel-perfect rendering
                const tStatesBefore = this.cpu.tStates;
                const ioDelay = this.applyIOTimings(port, instructionTiming);
                // ioDelay includes 4T base + contention
                const contentionOnly = Math.max(0, ioDelay - 4);

                // Add contention to cpu.tStates
                this.cpu.tStates += contentionOnly;

                if (this.debugIOTiming && contentionOnly > 0) {
                    console.log(`IO_TIMING port=${port.toString(16)} tBefore=${tStatesBefore} ioDelay=${ioDelay} contentionOnly=${contentionOnly}`);
                }

                // Border change timing
                // Calculate frame-relative T-state when border color changes
                // cpu.tStates accumulates from frameStartOffset, need to subtract to get frame-relative
                // The border color takes effect at a specific point during the OUT instruction
                // Based on racing-the-beam: "actual data is being sent on the 7th cycle of OUT"

                // I/O timing offset for border changes
                // OUT (C),r is 12T, OUT (n),A is 11T - different timing offsets needed
                // 48K: OUT (n),A offset depends on whether instruction is in contended memory
                //      Contended ($4000-$7FFF): offset 11 (Aquaplane) - contention adds to tStates
                //      Non-contended: offset 8 (Venom) - no extra delay
                //      OUT (C),r: offset 9 (ULA48)
                // 128K: base 9, +4 for OUT (C),r to match ULA128 test timing
                let ioOffset;
                if (this.profile.ulaProfile === 'pentagon') {
                    ioOffset = 11;
                } else if (this.profile.ulaProfile === '128k') {
                    // OUT (C),r (12T) needs +4 more than OUT (n),A for ULA128 test
                    ioOffset = (instructionTiming === 12) ? 13 : 9;
                } else {
                    // 48K: instruction location affects timing
                    if (instructionTiming === 12) {
                        ioOffset = 9;  // OUT (C),r
                    } else {
                        // OUT (n),A: check if instruction is in contended memory
                        // PC points to instruction after OUT, so PC-2 is the OUT opcode
                        const outPC = (this.cpu.pc - 2) & 0xffff;
                        const inContendedMem = (outPC >= 0x4000 && outPC <= 0x7FFF);
                        ioOffset = inContendedMem ? 11 : 8;
                    }
                }

                // Frame-relative T-state when the I/O write occurs
                // Note: cpu.tStates is already frame-relative (overshoot subtracted at frame start)
                const frameT = this.cpu.tStates + ioOffset;

                // Debug: log border timing (enable via console: spectrum.debugBorderOut = true)
                // For paper boundary debug: spectrum.debugPaperBoundary = true (only logs near line 64)
                const LINE_TIMES_BASE = this.ula.LINE_TIMES_BASE;
                const TSTATES_PER_LINE = this.ula.TSTATES_PER_LINE;
                const relT = frameT - LINE_TIMES_BASE;
                const visY = Math.floor(relT / TSTATES_PER_LINE);
                const lineT = relT - (visY * TSTATES_PER_LINE);
                const pixel = Math.floor(lineT * 2);
                // Pentagon: no quantization; 48K/128K: quantize to 4T boundaries
                const quantizedT = !this.profile.borderQuantization ? frameT : (frameT & ~3);
                const quantizedPixel = Math.floor(((quantizedT - LINE_TIMES_BASE) % TSTATES_PER_LINE) * 2);
                const nearPaperBoundary = visY >= 22 && visY <= 26;  // Around line 64 (paper start)

                if ((this.debugBorderOut || (this.debugPaperBoundary && nearPaperBoundary)) &&
                    (val & 0x07) !== this.lastDebugBorderColor) {
                    console.log(`OUT border=${val & 0x07} PC=$${this.cpu.pc.toString(16)} tStates=${this.cpu.tStates} frameT=${frameT}→${quantizedT} visY=${visY} px=${pixel}→${quantizedPixel} timing=${instructionTiming}T ioOff=${ioOffset}`);
                    this.lastDebugBorderColor = val & 0x07;
                }

                // Pass to ULA - it will calculate beam position internally
                this.ula.setBorderAt(val & 0x07, frameT);

                // Track beeper output for audio generation (bit 4 = EAR output)
                const newBeeperLevel = (val & 0x10) ? 1 : 0;
                if (newBeeperLevel !== this.beeperLevel) {
                    this.beeperLevel = newBeeperLevel;
                    this.beeperChanges.push({ tStates: frameT, level: newBeeperLevel });
                }

                // Don't return - port $7FFC triggers BOTH ULA AND paging for scroll17 effect
            }
            if (betaDiskActive && (lowByte === 0x1f || lowByte === 0x3f ||
                lowByte === 0x5f || lowByte === 0x7f)) {
                // Beta Disk WD1793 registers
                this.betaDisk.write(port, val);
                return;
            }
            if (betaDiskActive && lowByte === 0xff) {
                // Beta Disk system register
                this.betaDisk.write(port, val);
                return;
            }
            // Port 0x7FFD: memory paging
            // 128K/+2/Pentagon: (port & 0x8002) === 0 (A15=0, A1=0) — loose decode
            // +2A: (port & 0xC002) === 0x4000 (A15=0, A14=1, A1=0) — stricter decode
            // Without this, +2A port 0x1FFD writes also trigger 0x7FFD handler
            const is7FFD = this.profile.pagingModel === '+2a'
                ? (port & 0xC002) === 0x4000
                : (port & 0x8002) === 0;
            if (this.profile.pagingModel !== 'none' && is7FFD) {
                const oldScreenBank = this.memory.screenBank;
                this.memory.writePaging(val);
                // Track screen bank changes for scroll17-style effects
                const newScreenBank = this.memory.screenBank;
                if (newScreenBank !== oldScreenBank) {
                    // Screen bank changes use instruction_end - 2
                    // For +8px right shift compared to border timing (-8)
                    // OUTI (16T): bank change at tStates + 14
                    // cpu.tStates is already frame-relative
                    const bankChangeTime = this.cpu.tStates + (instructionTiming - 2);
                    this.ula.setScreenBankAt(newScreenBank, bankChangeTime);
                }
            }

            // +2A/+3 port 0x1FFD: special paging, ROM bank high bit, and FDC motor control
            if (this.profile.pagingModel === '+2a' && (port & 0xF002) === 0x1000) {
                this.memory.write1FFD(val);
                if (this.fdc) this.fdc.setMotor(!!(val & 0x08));
            }

            // µPD765 FDC data register write (port 0x3FFD)
            if (this.fdc && (port & 0xF002) === 0x3000) {
                this.fdc.writeData(val);
            }

            // Pentagon 1024 port 0xEFF7: extended memory control
            // Port decode: A12=0, A13=1, A14=1, A15=1 → (port & 0xF008) === 0xE000
            if (this.profile.pagingModel === 'pentagon1024' && (port & 0xF008) === 0xE000) {
                this.memory.writePortEFF7(val);
            }

            // AY-3-8910 ports (128K/Pentagon, or 48K with AY enabled)
            if (this.ayEnabled || (this.machineType === '48k' && this.ay48kEnabled)) {
                if ((port & 0xC002) === 0xC000) {
                    // Port 0xFFFD: AY register select
                    this.ay.selectRegister(val);
                } else if ((port & 0xC002) === 0x8000) {
                    // Port 0xBFFD: AY register write
                    this.ay.writeRegister(val);
                }
            }

            // ULAplus ports (when enabled)
            if (this.ula.ulaplus.enabled) {
                if (port === 0xbf3b) {
                    // ULAplus register select
                    this.ula.ulaplusWriteRegister(val);
                } else if (port === 0xff3b) {
                    // ULAplus data write - pass T-states for raster effect tracking
                    this.ula.ulaplusWriteData(val, this.cpu.tStates);
                }
            }
        }

        // ========== Frame Execution ==========

        runFrame() {
            const tstatesPerFrame = this.timing.tstatesPerFrame;
            const tstatesPerLine = this.timing.tstatesPerLine;

            // Preserve T-state overshoot from previous frame (Swan-style)
            // If instruction ended past frame boundary, carry over the excess
            if (this.cpu.tStates >= tstatesPerFrame) {
                this.cpu.tStates -= tstatesPerFrame;
                // Also adjust tape timing tracker to stay in sync
                if (this._lastTapeUpdate >= tstatesPerFrame) {
                    this._lastTapeUpdate -= tstatesPerFrame;
                } else {
                    this._lastTapeUpdate = this.cpu.tStates;
                }
            } else if (this.cpu.tStates < 0 || isNaN(this.cpu.tStates)) {
                // Safety: reset to 0 if invalid
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;
            }

            // Track frame start offset for border timing adjustment
            this.frameStartOffset = this.cpu.tStates;

            // Reset accumulated contention for new frame (ULA timing)
            this.accumulatedContention = 0;

            // Poll hardware gamepad at start of frame (disabled during RZX playback)
            if (!this.rzxPlaying) {
                this.pollGamepad();
            }

            this.ula.startFrame();
            this.ula.processExtendedMode(); // Process extended mode key sequences
            this.lastContentionLine = -1;  // Reset per-line contention tracking
            this.beeperChanges = [];       // Reset beeper changes for new frame

            // Start new frame for tape player (reset edge transitions)
            if (this.tapePlayer.isPlaying()) {
                this.tapePlayer.startFrame(this.cpu.tStates);
            }

            // RZX playback: reset T-states at frame start for proper scanline rendering
            // RZX frames end based on instruction count, not T-states, so T-states can drift
            // This ensures all scanlines are rendered from the beginning each frame
            if (this.rzxPlaying) {
                this.cpu.tStates = 0;
            }

            // Track which line to render next (account for overshoot)
            let nextLineToRender = Math.floor(this.cpu.tStates / tstatesPerLine);
            const totalLines = Math.floor(tstatesPerFrame / tstatesPerLine);

            // INT pulse duration from profile (32 T-states for 48K, 36 for 128K/Pentagon)
            const intPulseDuration = this.profile.intPulseDuration;
            let intFired = false;

            // Early/Late INT timing (Swan-style):
            // 48K only: Early at T-4, Late at frame boundary
            // 128K/Pentagon: always at frame boundary
            const earlyIntPoint = (this.profile.earlyIntTiming && !this.lateTimings) ?
                                   (tstatesPerFrame - 4) : tstatesPerFrame;

            // RZX recording: track instruction count before first interrupt
            let rzxRecInstrBeforeInt = this.rzxRecording ? this.cpu.instructionCount : 0;

            // Fire interrupt if within INT pulse window from previous frame overshoot
            // INT pulse started at earlyIntPoint and lasts intPulseDuration T-states
            // During RZX playback: fire early interrupt unconditionally if CPU is halted
            // (HALT can only exit via interrupt, and T-states may not be in sync during RZX)
            const rzxHaltedNeedsInt = this.rzxPlaying && this.cpu.halted && this.cpu.iff1 && !this.cpu.eiPending;
            const normalIntWindow = !this.rzxPlaying &&
                this.cpu.tStates >= 0 && this.cpu.tStates < intPulseDuration &&
                this.cpu.iff1 && !this.cpu.eiPending;
            if (rzxHaltedNeedsInt || normalIntWindow) {
                // RZX recording: capture instruction count BEFORE interrupt
                if (this.rzxRecording && !intFired) {
                    rzxRecInstrBeforeInt = this.cpu.instructionCount;
                }
                // If CPU is halted, count the final HALT NOP M1 before interrupt fires
                if (this.cpu.halted) {
                    this.cpu.incR();
                    this.cpu.instructionCount++;  // HALT NOP M1 cycle
                    // Update capture after HALT NOP
                    if (this.rzxRecording && !intFired) {
                        rzxRecInstrBeforeInt = this.cpu.instructionCount;
                    }
                }
                const intTstates = this.cpu.interrupt();
                this.cpu.tStates += intTstates;
                intFired = true;

                // RZX recording: start recording RIGHT AFTER interrupt fires
                // This ensures snapshot is at interrupt handler entry (PC=$0038, IFF1=false)
                // and Frame 0 captures the keyboard scan that follows
                if (this.rzxRecordPending) {
                    this.rzxStartRecordingNow();
                }
            }

            // RZX playback: cache expected fetch count for this frame
            let rzxExpectedFetchCount = 0;
            let rzxSafetyLimit = 0;  // Safety limit to prevent infinite loops
            if (this.rzxPlaying && this.rzxPlayer) {
                const frameInfo = this.rzxPlayer.getFrameInfo(this.rzxFrame);
                if (frameInfo) {
                    rzxExpectedFetchCount = frameInfo.fetchCount;
                    // Safety limit: 2x expected count - if exceeded, something is very wrong
                    rzxSafetyLimit = rzxExpectedFetchCount * 2;
                }
            }

            // Cache feature flags before the loop (avoid repeated property access)
            const hasBreakpoints = this.execBreakpointSet.size > 0;
            const tracing = this.runtimeTraceEnabled && this.onBeforeStep;
            const autoMapEnabled = this.autoMap.enabled;
            const xrefEnabled = this.xrefTrackingEnabled && this.onInstructionExecuted;
            const needsInstrPC = xrefEnabled || tracing;
            const contentionEnabled = this.profile.hasContention && this.contentionEnabled;
            const isPentagon = this.profile.ulaProfile === 'pentagon';
            const tapeTrapsEnabled = this.tapeTrapsEnabled;
            const tapeIsPlaying = this.tapePlayer.isPlaying();

            // Main frame loop - runs until tstatesPerFrame (or until instruction count during RZX)
            // During RZX playback, frame ends based on instruction count, not T-states (FUSE-style)
            while (this.rzxPlaying ? true : this.cpu.tStates < tstatesPerFrame) {

                // Render complete scanline (paper + border) at line END
                while (nextLineToRender < totalLines) {
                    const lineEndT = (nextLineToRender + 1) * tstatesPerLine;
                    if (this.cpu.tStates >= lineEndT) {
                        this.ula.renderScanline(nextLineToRender);
                        nextLineToRender++;
                    } else {
                        break;
                    }
                }

                // Beta Disk automatic ROM paging (Pentagon, or 48K/128K with Beta Disk enabled)
                if (this._betaDiskPagingEnabled) this.updateBetaDiskPaging();

                // Check breakpoint using unified trigger system (skip if no breakpoints)
                const execTrigger = hasBreakpoints ? this.checkExecTriggers(this.cpu.pc) : null;
                if (execTrigger) {
                    this.breakpointHit = true;
                    this.triggerHit = true;
                    this.lastTrigger = { trigger: execTrigger, addr: this.cpu.pc, type: 'exec' };
                    this.stop();
                    // Complete rendering of remaining lines
                    while (nextLineToRender < totalLines) {
                        this.ula.renderScanline(nextLineToRender++);
                    }
                    const frameBuffer = this.ula.endFrame();
                    // Don't overwrite previousFrameBuffer - keep the last complete frame for beam mode
                    this.imageData.data.set(frameBuffer);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.drawOverlay();
                    if (this.onBreakpoint) this.onBreakpoint(this.cpu.pc);
                    if (this.onTrigger) this.onTrigger(this.lastTrigger);
                    return;
                }
                if (tapeTrapsEnabled && this.tapeTrap.checkTrap()) continue;
                if (tapeTrapsEnabled && this.trdosTrap.checkTrap()) continue;

                // Apply ULA contention per-line for 48K and 128K
                if (contentionEnabled) {
                    const ulaContention = this.ula.ULA_CONTENTION_TSTATES || 0;
                    if (ulaContention > 0) {
                        const line = Math.floor(this.cpu.tStates / tstatesPerLine);
                        const firstScreenLine = this.ula.FIRST_SCREEN_LINE;
                        const screenLine = line - firstScreenLine;

                        if (screenLine >= 0 && screenLine < 192) {
                            if (this.lastContentionLine !== line) {
                                this.lastContentionLine = line;
                                this.cpu.tStates += ulaContention;
                            }
                        }
                    }
                }

                // Execute ONE instruction
                this.autoMap.inExecution = true;
                const tStatesBefore = this.cpu.tStates;
                if (this.cpu.halted) {
                    // Process eiPending during HALT NOP cycles (same as instruction boundary)
                    if (this.cpu.eiPending) {
                        this.cpu.eiPending = false;
                        this.cpu.iff1 = this.cpu.iff2 = true;
                    }

                    // Check if INT will fire during this HALT NOP cycle
                    // Skip during RZX playback - frame end controlled by instruction count (FUSE-style)
                    const nextT = this.cpu.tStates + 4;
                    const is48kEarly = this.profile.earlyIntTiming && !this.lateTimings;
                    if (!this.rzxPlaying && !intFired && is48kEarly &&
                        this.cpu.tStates < earlyIntPoint && nextT >= earlyIntPoint &&
                        this.cpu.iff1 && !this.cpu.eiPending) {
                        // Complete HALT NOP cycle + 4T alignment to match Swan timing
                        this.cpu.tStates = nextT + 4;
                        this.cpu.incR();
                        this.cpu.instructionCount++;  // HALT NOP is an M1 cycle
                        // RZX recording: capture instruction count BEFORE interrupt
                        if (this.rzxRecording) {
                            rzxRecInstrBeforeInt = this.cpu.instructionCount;
                        }
                        const intTstates = this.cpu.interrupt();
                        this.cpu.tStates += intTstates;
                        intFired = true;
                        // RZX recording: start recording RIGHT AFTER interrupt fires
                        if (this.rzxRecordPending) {
                            this.rzxStartRecordingNow();
                        }
                        this.autoMap.inExecution = false;
                        continue;
                    }

                    // Normal HALT NOP - no INT during this cycle
                    this.cpu.tStates += 4;
                    this.cpu.incR();
                    this.cpu.instructionCount++;  // HALT NOP is an M1 cycle for RZX

                    // Record trace for first HALT only (avoids flooding trace with repeated HALTs)
                    if (tracing && !this.haltTraced) {
                        this.haltTraced = true;
                        // HALT is always 0x76
                        this.onBeforeStep(this.cpu, this.memory, this.cpu.pc, null, null, [0x76, 0, 0, 0]);
                    }

                    // RZX playback: check if instruction count reached (FUSE-style frame end)
                    if (this.rzxPlaying && rzxExpectedFetchCount > 0) {
                        const m1Count = this.cpu.instructionCount - this.rzxFrameStartInstr;
                        if (m1Count >= rzxExpectedFetchCount) {
                            this.autoMap.inExecution = false;
                            break;  // End frame - instruction count reached
                        }
                        // Safety check: if way over expected count, break to prevent infinite loop
                        if (rzxSafetyLimit > 0 && m1Count > rzxSafetyLimit) {
                            console.error(`RZX F${this.rzxFrame}: safety limit exceeded (HALT)! M1=${m1Count} expected=${rzxExpectedFetchCount} limit=${rzxSafetyLimit}`);
                            this.autoMap.inExecution = false;
                            break;
                        }
                    }
                } else {
                    // Reset HALT traced flag when CPU exits HALT
                    this.haltTraced = false;
                    // Clear trace ops and capture state before execution
                    if (tracing) {
                        this.tracePortOps = [];
                        this.traceMemOps = [];
                    }
                    // Capture PC and instruction bytes before execution for xref/trace tracking
                    // (instruction may modify memory at its own address, e.g. LD (nn),IX)
                    const instrPC = needsInstrPC ? this.cpu.pc : 0;
                    let instrBytes = null;
                    if (tracing) {
                        instrBytes = [
                            this.memory.read(instrPC),
                            this.memory.read((instrPC + 1) & 0xffff),
                            this.memory.read((instrPC + 2) & 0xffff),
                            this.memory.read((instrPC + 3) & 0xffff)
                        ];
                    }
                    this.cpu.execute();
                    // If HALT instruction was just executed, mark as traced to avoid duplicate
                    if (this.cpu.halted) {
                        this.haltTraced = true;
                    }
                    // Record trace after execution (includes port/mem ops)
                    if (tracing) {
                        this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                    }
                    // Call xref tracking callback if enabled
                    if (xrefEnabled) {
                        this.onInstructionExecuted(instrPC);
                    }

                    // RZX playback: check if instruction count reached (FUSE-style frame end)
                    if (this.rzxPlaying && rzxExpectedFetchCount > 0) {
                        const m1Count = this.cpu.instructionCount - this.rzxFrameStartInstr;
                        if (m1Count >= rzxExpectedFetchCount) {
                            this.autoMap.inExecution = false;
                            break;  // End frame - instruction count reached
                        }
                        // Safety check: if way over expected count, break to prevent infinite loop
                        if (rzxSafetyLimit > 0 && m1Count > rzxSafetyLimit) {
                            console.error(`RZX F${this.rzxFrame}: safety limit exceeded! M1=${m1Count} expected=${rzxExpectedFetchCount} limit=${rzxSafetyLimit}`);
                            this.autoMap.inExecution = false;
                            break;
                        }
                    }
                }

                this.autoMap.inExecution = false;

                // Update tape player for real-time playback
                // Note: May have been partially updated during port reads for accurate timing
                if (tapeIsPlaying) {
                    const tStatesNow = this.cpu.tStates;
                    const elapsed = tStatesNow - this._lastTapeUpdate;
                    if (elapsed > 0) {
                        this.tapePlayer.update(elapsed, tStatesNow);
                        this._lastTapeUpdate = tStatesNow;
                    }
                    this.tapeEarBit = this.tapePlayer.getEarBit();
                }

                // Clear fetch tracking for auto-map (per instruction)
                if (autoMapEnabled) {
                    this.autoMap.currentFetchAddrs.clear();
                }

                // Check watchpoint (using unified trigger system)
                if (this.watchpointHit) {
                    this.watchpointHit = false;
                    this.triggerHit = false;
                    this.stop();
                    // Complete rendering of remaining lines
                    while (nextLineToRender < totalLines) {
                        this.ula.renderScanline(nextLineToRender++);
                    }
                    const frameBuffer = this.ula.endFrame();
                    // Don't overwrite previousFrameBuffer - keep the last complete frame for beam mode
                    this.imageData.data.set(frameBuffer);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.drawOverlay();
                    if (this.onWatchpoint) this.onWatchpoint(this.lastWatchpoint);
                    if (this.onTrigger) this.onTrigger(this.lastTrigger);
                    return;
                }

                // Check port breakpoint (using unified trigger system)
                if (this.portBreakpointHit) {
                    this.portBreakpointHit = false;
                    this.triggerHit = false;
                    this.stop();
                    // Complete rendering of remaining lines
                    while (nextLineToRender < totalLines) {
                        this.ula.renderScanline(nextLineToRender++);
                    }
                    const frameBuffer = this.ula.endFrame();
                    // Don't overwrite previousFrameBuffer - keep the last complete frame for beam mode
                    this.imageData.data.set(frameBuffer);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.drawOverlay();
                    if (this.onPortBreakpoint) this.onPortBreakpoint(this.lastPortBreakpoint);
                    if (this.onTrigger) this.onTrigger(this.lastTrigger);
                    return;
                }
            }

            // RZX playback: capture M1 count BEFORE interrupt (fetchCount excludes interrupt acknowledge)
            const rzxM1BeforeInt = this.rzxPlaying ? (this.cpu.instructionCount - this.rzxFrameStartInstr) : 0;

            // RZX recording: calculate fetchCount at end of frame (after all instructions)
            // This matches RZX playback which uses M1 count at frame boundary, not at early interrupt
            const rzxRecFetchCount = this.rzxRecording ?
                (this.cpu.instructionCount - this.rzxRecordStartInstr) : 0;

            // RZX playback: fire interrupt at frame end (FUSE-style)
            // During RZX playback, the frame ended when instruction count was reached
            // Now fire the interrupt to start the next frame's execution
            if (this.rzxPlaying && this.cpu.iff1 && !this.cpu.eiPending) {
                const intTstates = this.cpu.interrupt();
                this.cpu.tStates += intTstates;
            }

            // Render remaining lines
            while (nextLineToRender < totalLines) {
                this.ula.renderScanline(nextLineToRender++);
            }

            const frameBuffer = this.ula.endFrame();

            // Handle border-only modes: replace paper area with border color
            // Use proper T-state calculation to extend border into paper area
            const borderOnlyMode = this.overlayMode === 'screen' || this.overlayMode === 'beamscreen';
            if (borderOnlyMode) {
                const dims = this.ula.getDimensions();
                const changes = this.ula.borderChanges;
                const palette = this.ula.palette;

                // Fill paper area with border colors
                for (let y = dims.borderTop; y < dims.borderTop + dims.screenHeight; y++) {
                    // Calculate T-state range for this line
                    const lineStartTstate = this.ula.calculateLineStartTstate(y);

                    // Find starting color for this line
                    let currentColor = (changes && changes.length > 0) ? changes[0].color : this.ula.borderColor;
                    let changeIdx = 0;

                    if (changes && changes.length > 0) {
                        for (let i = 0; i < changes.length; i++) {
                            if (changes[i].tState <= lineStartTstate) {
                                currentColor = changes[i].color;
                                changeIdx = i + 1;
                            } else {
                                break;
                            }
                        }
                    }

                    // Fill paper area with proper border colors based on T-state
                    for (let x = dims.borderLeft; x < dims.borderLeft + dims.screenWidth; x++) {
                        // T-state for this pixel position
                        const pixelTstate = lineStartTstate + Math.floor(x / 2);

                        // Update color if there are changes before this T-state
                        if (changes) {
                            while (changeIdx < changes.length && changes[changeIdx].tState <= pixelTstate) {
                                currentColor = changes[changeIdx].color;
                                changeIdx++;
                            }
                        }

                        // Ensure color index is valid and get RGB from palette
                        const colorIdx = currentColor & 7;
                        const rgb = palette ? palette[colorIdx] : [0, 0, 0, 255];
                        const idx = (y * dims.width + x) * 4;
                        frameBuffer[idx] = rgb[0];
                        frameBuffer[idx + 1] = rgb[1];
                        frameBuffer[idx + 2] = rgb[2];
                        frameBuffer[idx + 3] = 255;
                    }
                }
            }

            // Save frame for beam visualization modes AFTER border-only modification
            // so previousFrameBuffer includes border lines in paper area
            this.savePreviousFrame(frameBuffer);

            this.imageData.data.set(frameBuffer);
            this.ctx.putImageData(this.imageData, 0, 0);

            // Draw overlay if enabled
            this.drawOverlay();

            this.frameCount++;
            if (this.onFrame) this.onFrame(this.frameCount);

            // Process AY + beeper + tape audio for this frame (skip at high speeds - audio would be meaningless)
            if (this.audio && this.audio.enabled && this.speed > 0 && this.speed <= 200) {
                // Get tape audio from tape player (if playing and enabled)
                // Also suppress tape audio briefly after returning from high speed
                const tapeAudioSuppressed = this._suppressTapeAudioUntil && Date.now() < this._suppressTapeAudioUntil;
                const tapeAudioChanges = (this.tapeAudioEnabled && this.tapePlayer.isPlaying() && !tapeAudioSuppressed)
                    ? this.tapePlayer.getEdgeTransitions() : [];

                // Pass tape audio changes (ROM doesn't echo tape signal to speaker)
                this.audio.processFrame(tstatesPerFrame, this.beeperChanges, this.beeperLevel, tapeAudioChanges);
            }

            // Advance AY logging frame counter
            if (this.ay) {
                this.ay.advanceLogFrame();
            }

            // RZX: advance 1 frame per emu frame (1:1 sync)
            if (this.rzxPlaying && this.rzxPlayer) {
                // Check input consumption before advancing (mismatch indicates desync)
                const frameInfo = this.rzxPlayer.getFrameInfo(this.rzxFrame);
                if (frameInfo) {
                    const m1Diff = rzxM1BeforeInt - frameInfo.fetchCount;
                    const inputsConsumed = frameInfo.inputIndex;
                    const inputsTotal = frameInfo.inputCount;

                    // Detailed debug logging for first N frames
                    if (this.rzxDebugFrames > 0 && this.rzxFrame < this.rzxDebugFrames) {
                        const debugEntry = {
                            frame: this.rzxFrame,
                            m1Actual: rzxM1BeforeInt,
                            m1Expected: frameInfo.fetchCount,
                            m1Diff: m1Diff,
                            inputsConsumed: inputsConsumed,
                            inputsTotal: inputsTotal,
                            inputs: frameInfo.inputs.slice(0, 20), // First 20 inputs
                            pc: this.cpu.pc,
                            sp: this.cpu.sp,
                            tStates: this.cpu.tStates
                        };
                        this.rzxDebugLog.push(debugEntry);
                        console.log(`RZX F${this.rzxFrame}: M1=${rzxM1BeforeInt}/${frameInfo.fetchCount} (${m1Diff >= 0 ? '+' : ''}${m1Diff}) IN=${inputsConsumed}/${inputsTotal} PC=${this.cpu.pc.toString(16)} T=${this.cpu.tStates}`);
                        if (inputsTotal > 0 && inputsTotal <= 10) {
                            console.log(`  inputs: [${frameInfo.inputs.map(v => v.toString(16).padStart(2,'0')).join(', ')}]`);
                        }
                    }

                    // Log M1 count mismatches (indicates instruction counting bug)
                    if (m1Diff !== 0) {
                        console.warn(`RZX F${this.rzxFrame}: M1 mismatch! actual=${rzxM1BeforeInt} expected=${frameInfo.fetchCount} diff=${m1Diff}`);
                    }
                    // Log input consumption mismatches (indicates code path divergence)
                    if (inputsConsumed !== inputsTotal) {
                        console.warn(`RZX F${this.rzxFrame}: input mismatch! consumed=${inputsConsumed}/${inputsTotal}`);
                    }
                }

                this.rzxFrameStartInstr = this.cpu.instructionCount;

                if (this.rzxFrame < this.rzxPlayer.getFrameCount() - 1) {
                    this.rzxFrame++;
                }

                if (this.rzxFrame >= this.rzxPlayer.getFrameCount()) {
                    this.rzxStop();
                    if (this.onRZXEnd) this.onRZXEnd();
                }
            }

            // RZX recording: finalize current frame and start new one
            // Note: recording now starts immediately after interrupt fires (earlier in this function)
            // This is just a fallback in case the interrupt didn't fire this frame
            if (this.rzxRecordPending) {
                // Fallback: start recording at frame boundary if interrupt hasn't fired yet
                this.rzxStartRecordingNow();
                console.warn('[RZX REC] Started at frame boundary (fallback) - interrupt may not have fired');
            } else if (this.rzxRecording) {
                // Use fetchCount captured BEFORE interrupt (rzxRecFetchCount from above)
                if (this.rzxRecordCurrentFrame) {
                    this.rzxRecordCurrentFrame.fetchCount = rzxRecFetchCount;
                    this.rzxRecordedFrames.push(this.rzxRecordCurrentFrame);
                }

                // Start new frame - capture instruction count AFTER interrupt for next frame's start
                this.rzxRecordCurrentFrame = { fetchCount: 0, inputs: [] };
                this.rzxRecordStartInstr = this.cpu.instructionCount;
            }

            // Call pending snap callback at frame boundary (safe state for snapshots)
            if (this.pendingSnapCallback) {
                const callback = this.pendingSnapCallback;
                this.pendingSnapCallback = null;
                callback();
            }
        }

        // ========== Headless Execution (for test suite) ==========

        /**
         * Run a frame without rendering - for fast test execution
         * Returns the number of T-states executed
         */
        runFrameHeadless() {
            const tstatesPerFrame = this.timing.tstatesPerFrame;
            const tstatesPerLine = this.timing.tstatesPerLine;

            // Preserve T-state overshoot from previous frame (Swan-style)
            if (this.cpu.tStates >= tstatesPerFrame) {
                this.cpu.tStates -= tstatesPerFrame;
                // Also adjust tape timing tracker to stay in sync
                if (this._lastTapeUpdate >= tstatesPerFrame) {
                    this._lastTapeUpdate -= tstatesPerFrame;
                } else {
                    this._lastTapeUpdate = this.cpu.tStates;
                }
            } else if (this.cpu.tStates < 0 || isNaN(this.cpu.tStates)) {
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;
            }

            // Track frame start offset for border timing adjustment
            this.frameStartOffset = this.cpu.tStates;

            // Reset accumulated contention for new frame (ULA timing)
            this.accumulatedContention = 0;

            this.ula.startFrame();
            this.ula.processExtendedMode(); // Process extended mode key sequences
            this.lastContentionLine = -1;
            this.beeperChanges = [];       // Reset beeper changes for new frame

            // Start new frame for tape player (reset edge transitions)
            if (this.tapePlayer.isPlaying()) {
                this.tapePlayer.startFrame(this.cpu.tStates);
            }

            // RZX playback: reset T-states at frame start for proper scanline rendering
            // RZX frames end based on instruction count, not T-states, so T-states can drift
            // This ensures all scanlines are rendered from the beginning each frame
            if (this.rzxPlaying) {
                this.cpu.tStates = 0;
            }

            // INT pulse duration from profile (32 T-states for 48K, 36 for 128K/Pentagon)
            const intPulseDuration = this.profile.intPulseDuration;
            let intFired = false;

            // Early/Late INT timing (Swan-style):
            // 48K only: Early at T-4, Late at frame boundary
            // 128K/Pentagon: always at frame boundary
            const earlyIntPoint = (this.profile.earlyIntTiming && !this.lateTimings) ?
                                   (tstatesPerFrame - 4) : tstatesPerFrame;

            // Fire interrupt if within INT pulse window from previous frame overshoot
            // Skip during RZX playback - frame boundaries controlled by instruction count (FUSE-style)
            if (!this.rzxPlaying &&
                this.cpu.tStates >= 0 && this.cpu.tStates < intPulseDuration &&
                this.cpu.iff1 && !this.cpu.eiPending) {
                // If CPU is halted, count the final HALT NOP M1 before interrupt fires
                if (this.cpu.halted) {
                    this.cpu.incR();
                    this.cpu.instructionCount++;  // HALT NOP M1 cycle
                }
                const intTstates = this.cpu.interrupt();
                this.cpu.tStates += intTstates;
                intFired = true;
            }

            // RZX playback: cache expected fetch count for this frame
            let rzxExpectedFetchCount = 0;
            let rzxSafetyLimit = 0;  // Safety limit to prevent infinite loops
            if (this.rzxPlaying && this.rzxPlayer) {
                const frameInfo = this.rzxPlayer.getFrameInfo(this.rzxFrame);
                if (frameInfo) {
                    rzxExpectedFetchCount = frameInfo.fetchCount;
                    // Safety limit: 2x expected count - if exceeded, something is very wrong
                    rzxSafetyLimit = rzxExpectedFetchCount * 2;
                }
            }

            // Track which line to render next (same as runFrame for consistent output)
            let nextLineToRender = Math.floor(this.cpu.tStates / tstatesPerLine);
            const totalLines = Math.floor(tstatesPerFrame / tstatesPerLine);

            // Main frame loop - runs until tstatesPerFrame (or until instruction count during RZX)
            // During RZX playback, frame ends based on instruction count, not T-states (FUSE-style)
            while (this.rzxPlaying ? true : this.cpu.tStates < tstatesPerFrame) {
                // Render complete scanlines as we pass them (same as runFrame)
                while (nextLineToRender < totalLines) {
                    const lineEndT = (nextLineToRender + 1) * tstatesPerLine;
                    if (this.cpu.tStates >= lineEndT) {
                        this.ula.renderScanline(nextLineToRender);
                        nextLineToRender++;
                    } else {
                        break;
                    }
                }

                // Beta Disk automatic ROM paging (Pentagon only)
                this.updateBetaDiskPaging();

                // Tape traps still active for test loading
                if (this.tapeTrapsEnabled && this.tapeTrap.checkTrap()) continue;
                if (this.tapeTrapsEnabled && this.trdosTrap.checkTrap()) continue;

                // Apply ULA contention per-line for 48K and 128K
                if (this.profile.hasContention && this.contentionEnabled) {
                    const ulaContention = this.ula.ULA_CONTENTION_TSTATES || 0;
                    if (ulaContention > 0) {
                        const line = Math.floor(this.cpu.tStates / tstatesPerLine);
                        const firstScreenLine = this.ula.FIRST_SCREEN_LINE;
                        const screenLine = line - firstScreenLine;

                        if (screenLine >= 0 && screenLine < 192) {
                            if (this.lastContentionLine !== line) {
                                this.lastContentionLine = line;
                                this.cpu.tStates += ulaContention;
                            }
                        }
                    }
                }

                // Execute ONE instruction
                const tStatesBefore = this.cpu.tStates;
                if (this.cpu.halted) {
                    // Process eiPending during HALT NOP cycles (same as instruction boundary)
                    if (this.cpu.eiPending) {
                        this.cpu.eiPending = false;
                        this.cpu.iff1 = this.cpu.iff2 = true;
                    }

                    // Check if INT will fire during this HALT NOP cycle
                    // INT acknowledged at end of HALT NOP cycle (instruction boundary)
                    // Only for 48K early timing: INT at T=69884
                    // 48K late and 128K/Pentagon use frame-start INT timing
                    // Skip during RZX playback - frame end controlled by instruction count (FUSE-style)
                    const nextT = this.cpu.tStates + 4;
                    const is48kEarly = this.profile.earlyIntTiming && !this.lateTimings;  // Cached in runFrame, needed here for runFrameHeadless
                    if (!this.rzxPlaying && !intFired && is48kEarly &&
                        this.cpu.tStates < earlyIntPoint && nextT >= earlyIntPoint &&
                        this.cpu.iff1 && !this.cpu.eiPending) {
                        // Complete HALT NOP cycle + 4T alignment to match Swan timing
                        // Swan shows T=60 at $805B, we had T=41, need +19T but only 4T affects quantized border
                        this.cpu.tStates = nextT + 4;
                        this.cpu.incR();
                        const intTstates = this.cpu.interrupt();
                        this.cpu.tStates += intTstates;
                        intFired = true;
                        continue;
                    }

                    // Normal HALT NOP - no INT during this cycle
                    this.cpu.tStates += 4;
                    this.cpu.incR();
                    this.cpu.instructionCount++;  // HALT NOP counts as M1 cycle

                    // RZX playback: check if instruction count reached (FUSE-style frame end)
                    if (this.rzxPlaying && rzxExpectedFetchCount > 0) {
                        const m1Count = this.cpu.instructionCount - this.rzxFrameStartInstr;
                        if (m1Count >= rzxExpectedFetchCount) {
                            break;  // End frame - instruction count reached
                        }
                        // Safety check: if way over expected count, break to prevent infinite loop
                        if (rzxSafetyLimit > 0 && m1Count > rzxSafetyLimit) {
                            console.error(`RZX F${this.rzxFrame}: safety limit exceeded (HALT)! M1=${m1Count} expected=${rzxExpectedFetchCount}`);
                            break;
                        }
                    }
                } else {
                    this.cpu.execute();

                    // RZX playback: check if instruction count reached (FUSE-style frame end)
                    if (this.rzxPlaying && rzxExpectedFetchCount > 0) {
                        const m1Count = this.cpu.instructionCount - this.rzxFrameStartInstr;
                        if (m1Count >= rzxExpectedFetchCount) {
                            break;  // End frame - instruction count reached
                        }
                        // Safety check: if way over expected count, break to prevent infinite loop
                        if (rzxSafetyLimit > 0 && m1Count > rzxSafetyLimit) {
                            console.error(`RZX F${this.rzxFrame}: safety limit exceeded! M1=${m1Count} expected=${rzxExpectedFetchCount}`);
                            break;
                        }
                    }
                }

                // Update tape player for real-time playback
                // Note: May have been partially updated during port reads for accurate timing
                if (this.tapePlayer.isPlaying()) {
                    const tStatesNow = this.cpu.tStates;
                    const elapsed = tStatesNow - this._lastTapeUpdate;
                    if (elapsed > 0) {
                        this.tapePlayer.update(elapsed, tStatesNow);
                        this._lastTapeUpdate = tStatesNow;
                    }
                    this.tapeEarBit = this.tapePlayer.getEarBit();
                }
            }

            // RZX playback: capture M1 count BEFORE interrupt (fetchCount excludes interrupt acknowledge)
            // (Note: runFrameHeadless doesn't log RZX mismatches but captures for consistency)
            const rzxM1BeforeInt = this.rzxPlaying ? (this.cpu.instructionCount - this.rzxFrameStartInstr) : 0;

            // RZX playback: fire interrupt at frame end (FUSE-style)
            if (this.rzxPlaying && this.cpu.iff1 && !this.cpu.eiPending) {
                const intTstates = this.cpu.interrupt();
                this.cpu.tStates += intTstates;
            }

            // Render any remaining scanlines (same as runFrame)
            while (nextLineToRender < totalLines) {
                this.ula.renderScanline(nextLineToRender++);
            }

            // Complete frame rendering (same as runFrame)
            this.ula.endFrame();

            this.frameCount++;

            // Process AY + beeper + tape audio for this frame (skip at high speeds - audio would be meaningless)
            if (this.audio && this.audio.enabled && this.speed > 0 && this.speed <= 200) {
                // Get tape audio from tape player (if playing and enabled)
                // Also suppress tape audio briefly after returning from high speed
                const tapeAudioSuppressed = this._suppressTapeAudioUntil && Date.now() < this._suppressTapeAudioUntil;
                const tapeAudioChanges = (this.tapeAudioEnabled && this.tapePlayer.isPlaying() && !tapeAudioSuppressed)
                    ? this.tapePlayer.getEdgeTransitions() : [];

                // Pass tape audio changes (ROM doesn't echo tape signal to speaker)
                this.audio.processFrame(tstatesPerFrame, this.beeperChanges, this.beeperLevel, tapeAudioChanges);
            }

            // Advance AY logging frame counter
            if (this.ay) {
                this.ay.advanceLogFrame();
            }

            // RZX: advance to next frame (same as runFrame)
            if (this.rzxPlaying && this.rzxPlayer) {
                this.rzxFrameStartInstr = this.cpu.instructionCount;

                if (this.rzxFrame < this.rzxPlayer.getFrameCount() - 1) {
                    this.rzxFrame++;
                }

                if (this.rzxFrame >= this.rzxPlayer.getFrameCount()) {
                    this.rzxStop();
                    if (this.onRZXEnd) this.onRZXEnd();
                }
            }

            return tstatesPerFrame;
        }

        /**
         * Render the current frame and return the screen buffer
         * Call after runFrameHeadless() to get the final screen state
         * @returns {Uint8ClampedArray} RGBA pixel data
         */
        renderAndCaptureScreen() {
            // Frame already rendered by runFrameHeadless() - just return the buffer
            return this.ula.frameBuffer;
        }

        /**
         * Get the current screen dimensions
         * @returns {{width: number, height: number, borderLeft: number, borderTop: number, screenWidth: number, screenHeight: number}}
         */
        getScreenDimensions() {
            return this.ula.getDimensions();
        }

        // ========== Overlay Drawing ==========

        drawOverlay() {
            // Note: borderOnly is set in renderToScreen() before renderFrame() is called
            switch (this.overlayMode) {
                case 'grid':
                    this.drawGrid();
                    break;
                case 'box':
                    this.drawBoxOverlay();
                    break;
                case 'screen':
                    this.drawScreenModeOverlay();
                    break;
                case 'reveal':
                    this.drawRevealOverlay();
                    break;
                case 'beam':
                    // Beam mode: grayscaled previous frame (paper+border), colored current (paper+border)
                    this.drawBeamOverlay(false);
                    break;
                case 'beamscreen':
                    // BeamScreen mode: grayscaled previous frame (border only), colored current (border only)
                    this.drawBeamOverlay(true);
                    break;
                case 'noattr':
                    // No Attr mode: monochrome display using only colors 0 and 7
                    this.drawNoAttrOverlay();
                    break;
                case 'nobitmap':
                    // No Bitmap mode: 8x8 cells with diagonal crosses using ink/paper colors
                    this.drawNoBitmapOverlay();
                    break;
                case 'none':
                default:
                    // Clear overlay canvas
                    if (this.overlayCtx) {
                        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
                    }
                    break;
            }
        }

        // Decode ZX Spectrum keyboard port read to key names
        decodeKeyboardInput(port, value) {
            // Keyboard matrix - high byte of port selects row
            const rows = {
                0xFE: ['Shift', 'Z', 'X', 'C', 'V'],
                0xFD: ['A', 'S', 'D', 'F', 'G'],
                0xFB: ['Q', 'W', 'E', 'R', 'T'],
                0xF7: ['1', '2', '3', '4', '5'],
                0xEF: ['0', '9', '8', '7', '6'],
                0xDF: ['P', 'O', 'I', 'U', 'Y'],
                0xBF: ['Enter', 'L', 'K', 'J', 'H'],
                0x7F: ['Space', 'Sym', 'M', 'N', 'B']
            };

            const highByte = (port >> 8) & 0xFF;
            const keys = [];

            // Check each row that's selected (active low in high byte)
            for (const [rowMask, rowKeys] of Object.entries(rows)) {
                const mask = parseInt(rowMask);
                // If this row is selected (bit is 0)
                if ((highByte & mask) !== mask) {
                    // Check bits 0-4 for pressed keys (0 = pressed)
                    for (let bit = 0; bit < 5; bit++) {
                        if ((value & (1 << bit)) === 0) {
                            keys.push(rowKeys[bit]);
                        }
                    }
                }
            }

            return keys;
        }

        drawBoxOverlay() {
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Scale coordinates by zoom
            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;

            // Draw rectangle around screen area (1px line regardless of zoom)
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        drawScreenModeOverlay() {
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Scale coordinates by zoom
            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;

            // Screen mode: border is already extended into paper area by main canvas
            // Just draw the grid overlay

            // Draw grid inside the paper area (cyan, every 8 pixels)
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
            ctx.lineWidth = 1;

            for (let row = 0; row <= dims.screenHeight; row += 8) {
                const y = Math.floor((dims.borderTop + row) * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(borderLeft, y);
                ctx.lineTo(borderLeft + screenWidth, y);
                ctx.stroke();
            }

            for (let col = 0; col <= dims.screenWidth; col += 8) {
                const x = Math.floor((dims.borderLeft + col) * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop);
                ctx.lineTo(x, borderTop + screenHeight);
                ctx.stroke();
            }

            // Draw thin yellow rectangle around paper area
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        drawRevealOverlay() {
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Scale coordinates by zoom
            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;

            // Reveal mode: show border extended OVER the paper (semi-transparent)
            // Use proper T-state calculation to extend border into paper area
            const changes = this.ula.borderChanges;
            const palette = this.ula.palette;

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = dims.width;
            tempCanvas.height = dims.height;
            const tempCtx = tempCanvas.getContext('2d');
            const tempImageData = tempCtx.createImageData(dims.width, dims.height);

            // For each line in paper area, extend border using proper T-state calculation
            for (let y = dims.borderTop; y < dims.borderTop + dims.screenHeight; y++) {
                // Calculate T-state range for this line
                const lineStartTstate = this.ula.calculateLineStartTstate(y);

                // Find starting color for this line
                let currentColor = (changes && changes.length > 0) ? changes[0].color : this.ula.borderColor;
                let changeIdx = 0;

                if (changes && changes.length > 0) {
                    for (let i = 0; i < changes.length; i++) {
                        if (changes[i].tState <= lineStartTstate) {
                            currentColor = changes[i].color;
                            changeIdx = i + 1;
                        } else {
                            break;
                        }
                    }
                }

                // Fill paper area with proper border colors based on T-state
                for (let x = dims.borderLeft; x < dims.borderLeft + dims.screenWidth; x++) {
                    // T-state for this pixel position
                    const pixelTstate = lineStartTstate + Math.floor(x / 2);

                    // Update color if there are changes before this T-state
                    if (changes) {
                        while (changeIdx < changes.length && changes[changeIdx].tState <= pixelTstate) {
                            currentColor = changes[changeIdx].color;
                            changeIdx++;
                        }
                    }

                    // Ensure color index is valid and get RGB from palette
                    const colorIdx = currentColor & 7;
                    const rgb = palette ? palette[colorIdx] : [0, 0, 0, 255];
                    const idx = (y * dims.width + x) * 4;
                    tempImageData.data[idx] = rgb[0];
                    tempImageData.data[idx + 1] = rgb[1];
                    tempImageData.data[idx + 2] = rgb[2];
                    tempImageData.data[idx + 3] = 180;  // Semi-transparent overlay
                }
            }
            tempCtx.putImageData(tempImageData, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tempCanvas, 0, 0, dims.width, dims.height,
                          0, 0, dims.width * zoom, dims.height * zoom);

            // Draw border around screen area for clarity (1px line)
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        drawGrid() {
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Scale all coordinates by zoom
            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;
            const totalWidth = dims.width * zoom;
            const totalHeight = dims.height * zoom;
            
            // Draw border grid (magenta, every 8 pixels) - complete grid in all border areas
            ctx.strokeStyle = 'rgba(255, 0, 255, 0.4)';
            ctx.lineWidth = 1;
            
            // Top border area: full grid
            for (let row = 0; row <= dims.borderTop; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(totalWidth, y);
                ctx.stroke();
            }
            for (let col = 0; col <= dims.width; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, borderTop);
                ctx.stroke();
            }
            
            // Bottom border area: full grid
            for (let row = dims.borderTop + dims.screenHeight; row <= dims.height; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(totalWidth, y);
                ctx.stroke();
            }
            for (let col = 0; col <= dims.width; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop + screenHeight);
                ctx.lineTo(x, totalHeight);
                ctx.stroke();
            }
            
            // Left border area (middle section): full grid
            for (let row = dims.borderTop; row <= dims.borderTop + dims.screenHeight; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(borderLeft, y);
                ctx.stroke();
            }
            for (let col = 0; col <= dims.borderLeft; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop);
                ctx.lineTo(x, borderTop + screenHeight);
                ctx.stroke();
            }

            // Right border area (middle section): full grid
            for (let row = dims.borderTop; row <= dims.borderTop + dims.screenHeight; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(borderLeft + screenWidth, y);
                ctx.lineTo(totalWidth, y);
                ctx.stroke();
            }
            for (let col = dims.borderLeft + dims.screenWidth; col <= dims.width; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop);
                ctx.lineTo(x, borderTop + screenHeight);
                ctx.stroke();
            }
            
            // Draw screen grid (gray)
            ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
            ctx.lineWidth = 1;
            const cellSize = 8 * zoom;

            // Draw vertical lines (every 8 pixels = 1 character column)
            for (let col = 0; col <= 32; col++) {
                const x = Math.floor(borderLeft + col * cellSize) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop);
                ctx.lineTo(x, borderTop + screenHeight);
                ctx.stroke();
            }

            // Draw horizontal lines (every 8 pixels = 1 character row)
            for (let row = 0; row <= 24; row++) {
                const y = Math.floor(borderTop + row * cellSize) + 0.5;
                ctx.beginPath();
                ctx.moveTo(borderLeft, y);
                ctx.lineTo(borderLeft + screenWidth, y);
                ctx.stroke();
            }

            // Draw thirds dividers (horizontal lines at 64 and 128 pixels) - extended to borders
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';  // Cyan
            ctx.lineWidth = 1;
            for (let third = 1; third < 3; third++) {
                const y = Math.floor(borderTop + third * 64 * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);  // Start from left edge
                ctx.lineTo(totalWidth, y);  // End at right edge
                ctx.stroke();
            }

            // Draw quarter dividers (vertical lines at 64, 128, 192 pixels) - extended to borders
            for (let quarter = 1; quarter < 4; quarter++) {
                const x = Math.floor(borderLeft + quarter * 64 * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, 0);  // Start from top edge
                ctx.lineTo(x, totalHeight);  // End at bottom edge
                ctx.stroke();
            }
            
            // Draw numbers using small bitmap digits (scaled by zoom)
            const drawDigit = (x, y, digit, color) => {
                ctx.fillStyle = color;
                // 3x5 pixel digits, scaled by zoom
                const patterns = {
                    '0': [0b111, 0b101, 0b101, 0b101, 0b111],
                    '1': [0b010, 0b110, 0b010, 0b010, 0b111],
                    '2': [0b111, 0b001, 0b111, 0b100, 0b111],
                    '3': [0b111, 0b001, 0b111, 0b001, 0b111],
                    '4': [0b101, 0b101, 0b111, 0b001, 0b001],
                    '5': [0b111, 0b100, 0b111, 0b001, 0b111],
                    '6': [0b111, 0b100, 0b111, 0b101, 0b111],
                    '7': [0b111, 0b001, 0b001, 0b001, 0b001],
                    '8': [0b111, 0b101, 0b111, 0b101, 0b111],
                    '9': [0b111, 0b101, 0b111, 0b001, 0b111],
                };
                const p = patterns[digit] || patterns['0'];
                for (let py = 0; py < 5; py++) {
                    for (let px = 0; px < 3; px++) {
                        if (p[py] & (4 >> px)) {
                            ctx.fillRect(x + px * zoom, y + py * zoom, zoom, zoom);
                        }
                    }
                }
            };

            const drawNumber = (x, y, num, color) => {
                const str = num.toString();
                for (let i = 0; i < str.length; i++) {
                    drawDigit(x + i * 4 * zoom, y, str[i], color);
                }
            };

            // Draw row numbers on left border (yellow)
            for (let row = 0; row < 24; row++) {
                const y = borderTop + row * cellSize + zoom;
                drawNumber(borderLeft - 10 * zoom, y, row, '#FFFF00');
            }

            // Draw column numbers on top border (every 4th)
            for (let col = 0; col < 32; col += 4) {
                const x = borderLeft + col * cellSize + zoom;
                drawNumber(x, borderTop - 7 * zoom, col, '#FFFF00');
            }

            // Draw scanline numbers on right (cyan)
            for (let line = 0; line < 192; line += 8) {
                const y = borderTop + line * zoom + zoom;
                drawNumber(borderLeft + screenWidth + 2 * zoom, y, line, '#00FFFF');
            }

            // Draw 256x192 boundary lines extending into border areas (yellow)
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;

            // Horizontal boundary lines - extend into left and right borders
            // Top edge of 256x192 area
            const topY = Math.floor(borderTop) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, topY);
            ctx.lineTo(borderLeft, topY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(borderLeft + screenWidth, topY);
            ctx.lineTo(totalWidth, topY);
            ctx.stroke();

            // Bottom edge of 256x192 area
            const bottomY = Math.floor(borderTop + screenHeight) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, bottomY);
            ctx.lineTo(borderLeft, bottomY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(borderLeft + screenWidth, bottomY);
            ctx.lineTo(totalWidth, bottomY);
            ctx.stroke();

            // Vertical boundary lines - extend into top and bottom borders
            // Left edge of 256x192 area
            const leftX = Math.floor(borderLeft) + 0.5;
            ctx.beginPath();
            ctx.moveTo(leftX, 0);
            ctx.lineTo(leftX, borderTop);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(leftX, borderTop + screenHeight);
            ctx.lineTo(leftX, totalHeight);
            ctx.stroke();

            // Right edge of 256x192 area
            const rightX = Math.floor(borderLeft + screenWidth) + 0.5;
            ctx.beginPath();
            ctx.moveTo(rightX, 0);
            ctx.lineTo(rightX, borderTop);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(rightX, borderTop + screenHeight);
            ctx.lineTo(rightX, totalHeight);
            ctx.stroke();

            // Draw yellow box around screen area (256x192)
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        // Beam visualization overlay - shows previous frame grayscaled, current progress colored
        // borderOnlyMode=false (Beam): grayscale prev frame (paper+border), color current (paper+border)
        // borderOnlyMode=true (BeamScreen): grayscale prev frame (border only), color current (border only)
        drawBeamOverlay(borderOnlyMode) {
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Calculate current beam position from tStates
            const tStates = this.cpu.tStates;
            const tstatesPerLine = this.ula.TSTATES_PER_LINE;
            const tstatesPerFrame = this.ula.TSTATES_PER_FRAME;

            // Current frame line and position within line
            const currentFrameLine = Math.floor(tStates / tstatesPerLine);
            const posInLine = tStates % tstatesPerLine;

            // Convert frame line to visible line using ULA's calculation
            const firstVisibleFrameLine = this.ula.FIRST_SCREEN_LINE - this.ula.BORDER_TOP;
            const lastVisibleFrameLine = this.ula.FIRST_SCREEN_LINE + this.ula.SCREEN_HEIGHT + this.ula.BORDER_BOTTOM - 1;

            // Calculate beam position in visible coordinates
            let beamVisY = currentFrameLine - firstVisibleFrameLine;

            // Calculate X position: convert T-state position to pixel position
            // Using the same logic as renderBorderPixels
            const lineStartTstate = this.ula.calculateLineStartTstate ?
                this.ula.calculateLineStartTstate(Math.max(0, beamVisY)) : 0;
            const currentTstate = currentFrameLine * tstatesPerLine + posInLine;
            const pixelX = Math.floor((currentTstate - lineStartTstate) * 2);

            // Clamp beam position to visible area
            const beamX = Math.max(0, Math.min(dims.width - 1, pixelX));
            const beamY = Math.max(0, Math.min(dims.height - 1, beamVisY));

            // Scale coordinates by zoom
            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;
            const totalWidth = dims.width * zoom;
            const totalHeight = dims.height * zoom;

            // Draw previous frame in grayscale
            if (this.previousFrameBuffer) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = dims.width;
                tempCanvas.height = dims.height;
                const tempCtx = tempCanvas.getContext('2d');
                const tempImageData = tempCtx.createImageData(dims.width, dims.height);

                // Convert entire previous frame to darkened grayscale
                // Both BeamScreen and Beam: grayscale everything (paper area has border colors in borderOnlyMode)
                // The previousFrameBuffer already contains border colors extended into paper area
                for (let i = 0; i < this.previousFrameBuffer.length; i += 4) {
                    // Calculate grayscale and darken by 50% for better contrast with current frame
                    const gray = Math.round(
                        (this.previousFrameBuffer[i] * 0.299 +
                         this.previousFrameBuffer[i + 1] * 0.587 +
                         this.previousFrameBuffer[i + 2] * 0.114) * 0.5
                    );
                    tempImageData.data[i] = gray;
                    tempImageData.data[i + 1] = gray;
                    tempImageData.data[i + 2] = gray;
                    tempImageData.data[i + 3] = 255;  // Fully opaque
                }
                tempCtx.putImageData(tempImageData, 0, 0);

                // Draw grayscale previous frame
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(tempCanvas, 0, 0, dims.width, dims.height,
                              0, 0, totalWidth, totalHeight);
            }

            // Draw current frame progress (colored) - lines that have been rendered
            // In running mode (beamVisY >= dims.height), draw entire frame
            const frameComplete = beamVisY >= dims.height;
            if (beamVisY >= 0 || frameComplete) {
                // Get current partial frame from ULA
                const currentFrame = this.ula.frameBuffer;
                if (currentFrame) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = dims.width;
                    tempCanvas.height = dims.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    const tempImageData = tempCtx.createImageData(dims.width, dims.height);

                    // Determine how much to draw
                    const maxDrawY = frameComplete ? dims.height - 1 : Math.min(beamY, dims.height - 1);
                    const maxDrawX = frameComplete ? dims.width : (beamX + 1);

                    // Copy already-rendered lines in color
                    for (let y = 0; y <= maxDrawY; y++) {
                        for (let x = 0; x < dims.width; x++) {
                            // For the current beam line (not complete), only draw up to beam X position
                            if (!frameComplete && y === beamY && x >= maxDrawX) break;

                            const idx = (y * dims.width + x) * 4;
                            const isScreen = x >= dims.borderLeft && x < dims.borderLeft + dims.screenWidth &&
                                             y >= dims.borderTop && y < dims.borderTop + dims.screenHeight;

                            // In borderOnly mode, skip screen area
                            if (borderOnlyMode && isScreen) continue;

                            tempImageData.data[idx] = currentFrame[idx];
                            tempImageData.data[idx + 1] = currentFrame[idx + 1];
                            tempImageData.data[idx + 2] = currentFrame[idx + 2];
                            tempImageData.data[idx + 3] = 255;
                        }
                    }
                    tempCtx.putImageData(tempImageData, 0, 0);

                    // Draw colored current progress
                    ctx.drawImage(tempCanvas, 0, 0, dims.width, dims.height,
                                  0, 0, totalWidth, totalHeight);
                }
            }

            // Draw grid overlay (8-pixel spacing, covers whole canvas)
            ctx.strokeStyle = 'rgba(255, 0, 255, 0.3)';
            ctx.lineWidth = 1;
            for (let row = 0; row <= dims.height; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(totalWidth, y);
                ctx.stroke();
            }
            for (let col = 0; col <= dims.width; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, totalHeight);
                ctx.stroke();
            }

            // Draw beam position marker (cyan crosshair)
            if (beamVisY >= 0 && beamVisY < dims.height && beamX >= 0 && beamX < dims.width) {
                const bx = beamX * zoom;
                const by = beamY * zoom;

                ctx.strokeStyle = '#00FFFF';
                ctx.lineWidth = 1;

                // Horizontal line through beam
                ctx.beginPath();
                ctx.moveTo(0, by + 0.5);
                ctx.lineTo(totalWidth, by + 0.5);
                ctx.stroke();

                // Vertical line through beam
                ctx.beginPath();
                ctx.moveTo(bx + 0.5, 0);
                ctx.lineTo(bx + 0.5, totalHeight);
                ctx.stroke();

                // Beam dot
                ctx.fillStyle = '#FF0000';
                ctx.beginPath();
                ctx.arc(bx, by, 2, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw beam info text
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `${12 * zoom}px monospace`;
            ctx.fillText(`T:${tStates} Line:${currentFrameLine} Pos:${posInLine}`, 4, 14 * zoom);
            ctx.fillText(`VisY:${beamY} X:${beamX}`, 4, 28 * zoom);

            // Draw screen area boundary (yellow box)
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        drawNoAttrOverlay() {
            // No Attr mode: Show monochrome picture using only colors 0 and 7 from palette
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;
            const palette = this.ula.palette;

            // Get colors 0 (black) and 7 (white) from palette
            const color0 = palette ? palette[0] : [0, 0, 0, 255];
            const color7 = palette ? palette[7] : [205, 205, 205, 255];

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Create temporary canvas at 1x scale
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = dims.width;
            tempCanvas.height = dims.height;
            const tempCtx = tempCanvas.getContext('2d');
            const tempImageData = tempCtx.createImageData(dims.width, dims.height);

            // Get current frame buffer
            const frameBuffer = this.ula.frameBuffer;
            if (!frameBuffer) return;

            // Process screen area only - convert to monochrome based on luminance
            for (let y = dims.borderTop; y < dims.borderTop + dims.screenHeight; y++) {
                for (let x = dims.borderLeft; x < dims.borderLeft + dims.screenWidth; x++) {
                    const idx = (y * dims.width + x) * 4;
                    const r = frameBuffer[idx];
                    const g = frameBuffer[idx + 1];
                    const b = frameBuffer[idx + 2];

                    // Calculate luminance (using perceived brightness formula)
                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                    // Use color 7 for bright pixels (ink), color 0 for dark (paper)
                    const color = lum > 64 ? color7 : color0;
                    tempImageData.data[idx] = color[0];
                    tempImageData.data[idx + 1] = color[1];
                    tempImageData.data[idx + 2] = color[2];
                    tempImageData.data[idx + 3] = 255;
                }
            }

            tempCtx.putImageData(tempImageData, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tempCanvas, dims.borderLeft, dims.borderTop, dims.screenWidth, dims.screenHeight,
                          dims.borderLeft * zoom, dims.borderTop * zoom, dims.screenWidth * zoom, dims.screenHeight * zoom);
        }

        drawNoBitmapOverlay() {
            // No Bitmap mode: Show cells with diagonal crosses using ink/paper colors
            // For multicolor support: extract ink/paper colors from the already-rendered frame buffer
            // (attribute memory has final values, but frame buffer has correct per-scanline colors)
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;
            const frameBuffer = this.ula.frameBuffer;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Create temporary canvas at 1x scale
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = dims.width;
            tempCanvas.height = dims.height;
            const tempCtx = tempCanvas.getContext('2d');
            const tempImageData = tempCtx.createImageData(dims.width, dims.height);

            // Copy border from frame buffer
            for (let y = 0; y < dims.height; y++) {
                for (let x = 0; x < dims.width; x++) {
                    const isScreen = x >= dims.borderLeft && x < dims.borderLeft + dims.screenWidth &&
                                     y >= dims.borderTop && y < dims.borderTop + dims.screenHeight;
                    if (!isScreen) {
                        const idx = (y * dims.width + x) * 4;
                        tempImageData.data[idx] = frameBuffer[idx];
                        tempImageData.data[idx + 1] = frameBuffer[idx + 1];
                        tempImageData.data[idx + 2] = frameBuffer[idx + 2];
                        tempImageData.data[idx + 3] = 255;
                    }
                }
            }

            // Process each scanline for multicolor support
            for (let y = 0; y < 192; y++) {
                const visY = dims.borderTop + y;
                const lineInCell = y % 8;

                for (let charCol = 0; charCol < 32; charCol++) {
                    const cellX = dims.borderLeft + charCol * 8;

                    // Extract ink and paper colors from frame buffer for this 8-pixel span
                    // Sample all 8 pixels and find the two unique colors
                    const colors = new Map();
                    for (let px = 0; px < 8; px++) {
                        const idx = (visY * dims.width + cellX + px) * 4;
                        const r = frameBuffer[idx];
                        const g = frameBuffer[idx + 1];
                        const b = frameBuffer[idx + 2];
                        const key = (r << 16) | (g << 8) | b;
                        colors.set(key, (colors.get(key) || 0) + 1);
                    }

                    // Get the two most common colors (paper usually more common than ink)
                    const sorted = [...colors.entries()].sort((a, b) => b[1] - a[1]);
                    const paperKey = sorted[0] ? sorted[0][0] : 0;
                    const inkKey = sorted[1] ? sorted[1][0] : paperKey;

                    const paperColor = [(paperKey >> 16) & 0xFF, (paperKey >> 8) & 0xFF, paperKey & 0xFF];
                    const inkColor = [(inkKey >> 16) & 0xFF, (inkKey >> 8) & 0xFF, inkKey & 0xFF];

                    // Draw 8 pixels of this scanline with diagonal cross pattern
                    for (let px = 0; px < 8; px++) {
                        const x = cellX + px;
                        const idx = (visY * dims.width + x) * 4;

                        // Draw X pattern: pixels on diagonals use ink, others use paper
                        const onDiagonal = (px === lineInCell) || (px === 7 - lineInCell);
                        const color = onDiagonal ? inkColor : paperColor;

                        tempImageData.data[idx] = color[0];
                        tempImageData.data[idx + 1] = color[1];
                        tempImageData.data[idx + 2] = color[2];
                        tempImageData.data[idx + 3] = 255;
                    }
                }
            }

            tempCtx.putImageData(tempImageData, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tempCanvas, 0, 0, dims.width, dims.height,
                          0, 0, dims.width * zoom, dims.height * zoom);
        }

        // ========== Start/Stop/Speed Control ==========

        start(force = false) {
            if (!force && (this.running || !this.romLoaded)) {
                return;
            }

            // If forcing, ensure we're stopped first to clear any stale timers
            if (force && this.running) {
                this.stop();
            }

            if (!this.romLoaded) {
                return;
            }

            this.running = true;
            this.lastFrameTime = performance.now();
            this.lastRafTime = null;  // Reset for accurate frame timing
            this.frameCount = 0;

            // Register keyboard handlers once
            if (!this.keyboardHandlersRegistered) {
                document.addEventListener('keydown', this.boundKeyDown);
                document.addEventListener('keyup', this.boundKeyUp);
                this.keyboardHandlersRegistered = true;
            }

            this.scheduleNextFrame();
        }
        
        scheduleNextFrame() {
            if (!this.running) return;

            if (this.speed === 0) {
                // Max speed - use requestAnimationFrame, run multiple frames
                this.rafId = requestAnimationFrame(() => {
                    try {
                        const startTime = performance.now();
                        // Run frames for up to 16ms (one display frame)
                        while (performance.now() - startTime < 16 && this.running) {
                            this.runFrame();
                        }
                        this.updateFps();
                        this.scheduleNextFrame();
                    } catch (e) {
                        console.error('Error in runFrame:', e);
                        this.running = false;
                        if (this.onError) this.onError(e);
                    }
                });
            } else if (this.speed >= 100) {
                // Normal or fast - use requestAnimationFrame with time tracking
                // Real Spectrum: 50.08 FPS (69888 T-states at 3.5MHz)
                const targetFrameTime = 1000 / 50.08 * (100 / this.speed);

                this.rafId = requestAnimationFrame((timestamp) => {
                    try {
                        if (!this.lastRafTime) this.lastRafTime = timestamp;

                        // Calculate how many frames we should have run
                        const elapsed = timestamp - this.lastRafTime;
                        const framesToRun = Math.floor(elapsed / targetFrameTime);

                        if (framesToRun > 0) {
                            // Run the appropriate number of frames (cap at 4 to prevent spiral)
                            const actualFrames = Math.min(framesToRun, 4);
                            for (let i = 0; i < actualFrames && this.running; i++) {
                                this.runFrame();
                            }
                            this.lastRafTime = timestamp - (elapsed % targetFrameTime);
                        }

                        this.updateFps();
                        this.scheduleNextFrame();
                    } catch (e) {
                        console.error('Error in runFrame:', e);
                        this.running = false;
                        if (this.onError) this.onError(e);
                    }
                });
            } else {
                // Slow - increase interval
                const interval = Math.round(20 * (100 / this.speed));
                this.frameInterval = setTimeout(() => {
                    try {
                        this.runFrame();
                        this.updateFps();
                        this.scheduleNextFrame();
                    } catch (e) {
                        console.error('Error in runFrame:', e);
                        this.running = false;
                        if (this.onError) this.onError(e);
                    }
                }, interval);
            }
        }
        
        updateFps() {
            const now = performance.now();
            if (now - this.lastFrameTime >= 1000) {
                this.actualFps = Math.round(this.frameCount * 1000 / (now - this.lastFrameTime));
                this.frameCount = 0;
                this.lastFrameTime = now;
            }
        }
        
        stop() {
            if (!this.running) return;
            this.running = false;
            if (this.frameInterval) {
                clearTimeout(this.frameInterval);
                this.frameInterval = null;
            }
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            // Keep keyboard handlers registered - user may type while paused
        }
        
        setSpeed(speed) {
            const wasHighSpeed = this.speed > 200;
            this.speed = speed;
            this.lastRafTime = null;  // Reset for new timing

            // Suspend audio at high speeds (> 200% or max speed)
            if (this.audio && this.audio.context) {
                if (speed === 0 || speed > 200) {
                    this.audio.context.suspend();
                } else if (this.audio.enabled) {
                    this.audio.context.resume();
                }
            }

            // Suppress tape audio briefly when returning from high speed
            // This prevents hearing unexpected loading sounds when game is loaded at max speed
            if (wasHighSpeed && speed > 0 && speed <= 200) {
                this._suppressTapeAudioUntil = Date.now() + 1000;  // 1 second grace period
            }

            // Restart timing if running
            if (this.running) {
                if (this.frameInterval) {
                    clearTimeout(this.frameInterval);
                    this.frameInterval = null;
                }
                if (this.rafId) {
                    cancelAnimationFrame(this.rafId);
                    this.rafId = null;
                }
                this.scheduleNextFrame();
            }
        }
        
        toggle() { this.running ? this.stop() : this.start(); }

        // Beta Disk automatic ROM paging
        // Update cached flag for Beta Disk paging (call when conditions change)
        updateBetaDiskPagingFlag() {
            this._betaDiskPagingEnabled =
                this.memory.hasTrdosRom() &&
                (this.profile.betaDiskDefault || this.betaDiskEnabled);
        }

        // Called before each instruction fetch to handle automatic TR-DOS ROM switching
        // The Beta Disk interface has its own ROM chip with TR-DOS, which is paged in
        // when executing code in the 3D00-3DFF "magic" address range, and paged out
        // when execution moves to RAM (>=4000h)
        // Works on Pentagon (always) and 48K/128K (when Beta Disk enabled in settings)
        updateBetaDiskPaging() {
            // Fast path: skip if Beta Disk paging not needed
            if (!this._betaDiskPagingEnabled) return;

            const pc = this.cpu.pc;
            if (pc >= 0x3D00 && pc <= 0x3DFF) {
                // Entering TR-DOS magic area (0x3D00-0x3DFF) - page in TR-DOS ROM
                // For 128K: only activate when ROM 1 (48K BASIC) is selected
                // For 48K: always activate (only one ROM)
                if (!this.memory.trdosActive) {
                    if (this.profile.pagingModel === 'none' || this.memory.currentRomBank === this.profile.basicRomBank) {
                        this.memory.trdosActive = true;
                    }
                }
            } else if (pc >= 0x4000) {
                // Entering RAM - page out TR-DOS ROM
                if (this.memory.trdosActive) {
                    this.memory.trdosActive = false;
                }
            }
        }

        // ========== Debugging - Stepping ==========

        stepInto() {
            if (this.running || !this.romLoaded) return false;

            // If CPU is halted, run until INT fires and CPU exits HALT
            if (this.cpu.halted) {
                return this.stepOutOfHalt();
            }

            // Beta Disk automatic ROM paging
            this.updateBetaDiskPaging();
            // Clear trace ops and capture PC/bytes before execution
            const tracing = this.traceEnabled && this.onBeforeStep;
            if (tracing) {
                this.tracePortOps = [];
                this.traceMemOps = [];
            }
            const instrPC = tracing ? this.cpu.pc : 0;
            let instrBytes = null;
            if (tracing) {
                instrBytes = [
                    this.memory.read(instrPC),
                    this.memory.read((instrPC + 1) & 0xffff),
                    this.memory.read((instrPC + 2) & 0xffff),
                    this.memory.read((instrPC + 3) & 0xffff)
                ];
            }
            this.autoMap.inExecution = true;
            this.cpu.step();
            this.autoMap.inExecution = false;

            // Handle frame boundary crossing during stepping (with late timing support)
            this.handleFrameBoundary();

            // Record trace after execution (includes port/mem ops)
            if (tracing) {
                this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
            }
            if (this.autoMap.enabled) this.autoMap.currentFetchAddrs.clear();
            this.renderToScreen();
            return true;
        }

        // Step out of HALT state by running to next INT
        stepOutOfHalt() {
            const tstatesPerFrame = this.getTstatesPerFrame();
            const maxCycles = tstatesPerFrame * 2; // Max 2 frames
            let cycles = 0;

            while (this.cpu.halted && cycles < maxCycles) {
                // Check for frame boundary and fire INT (with late timing support)
                if (this.handleFrameBoundary()) {
                    // INT was fired, CPU exits HALT
                    break;
                }
                this.cpu.tStates += 4;
                this.cpu.incR();
                cycles += 4;
            }

            this.renderToScreen();
            return !this.cpu.halted;
        }
        
        // Redraw current screen (for grid toggle when paused)
        redraw() {
            if (!this.romLoaded) return;
            this.renderToScreen();
        }
        
        // Helper to render current state without executing CPU
        renderToScreen() {
            // Set borderOnly BEFORE rendering so renderFrame uses correct mode
            const borderOnly = this.overlayMode === 'screen' || this.overlayMode === 'reveal' || this.overlayMode === 'beamscreen';
            this.ula.borderOnly = borderOnly;

            // In beam modes, preserve the scanline-by-scanline rendered frame buffer
            // (don't re-render entire screen which would lose per-scanline attribute changes)
            const isBeamMode = this.overlayMode === 'beam' || this.overlayMode === 'beamscreen';
            let frameBuffer;

            if (isBeamMode) {
                // Render scanlines up to current T-state position for accurate beam display
                this.ula.updateScanline(this.cpu.tStates);
                frameBuffer = this.ula.frameBuffer;
            } else {
                // Initialize border changes with current border color (for static rendering)
                this.ula.borderChanges = [{tState: 0, color: this.ula.borderColor}];
                frameBuffer = this.ula.renderFrame();
            }

            // Handle border-only modes: replace paper area with border color
            const borderOnlyMode = this.overlayMode === 'screen' || this.overlayMode === 'beamscreen';
            if (borderOnlyMode) {
                const dims = this.ula.getDimensions();
                const changes = this.ula.borderChanges;
                const palette = this.ula.palette;

                for (let y = dims.borderTop; y < dims.borderTop + dims.screenHeight; y++) {
                    const lineStartTstate = this.ula.calculateLineStartTstate(y);
                    let currentColor = (changes && changes.length > 0) ? changes[0].color : this.ula.borderColor;
                    let changeIdx = 0;

                    if (changes && changes.length > 0) {
                        for (let i = 0; i < changes.length; i++) {
                            if (changes[i].tState <= lineStartTstate) {
                                currentColor = changes[i].color;
                                changeIdx = i + 1;
                            } else {
                                break;
                            }
                        }
                    }

                    for (let x = dims.borderLeft; x < dims.borderLeft + dims.screenWidth; x++) {
                        const pixelTstate = lineStartTstate + Math.floor(x / 2);
                        if (changes) {
                            while (changeIdx < changes.length && changes[changeIdx].tState <= pixelTstate) {
                                currentColor = changes[changeIdx].color;
                                changeIdx++;
                            }
                        }
                        const colorIdx = currentColor & 7;
                        const rgb = palette ? palette[colorIdx] : [0, 0, 0, 255];
                        const idx = (y * dims.width + x) * 4;
                        frameBuffer[idx] = rgb[0];
                        frameBuffer[idx + 1] = rgb[1];
                        frameBuffer[idx + 2] = rgb[2];
                        frameBuffer[idx + 3] = 255;
                    }
                }
            }

            // Save frame for beam visualization modes AFTER border-only modification
            // so previousFrameBuffer includes border lines in paper area
            // But don't save in beam mode - we want to keep the last complete frame
            if (!isBeamMode) {
                this.savePreviousFrame(frameBuffer);
            }

            this.imageData.data.set(frameBuffer);
            this.ctx.putImageData(this.imageData, 0, 0);
            this.drawOverlay();
        }

        // Execute until past current instruction (skip over CALL/RST)
        stepOver() {
            if (this.running || !this.romLoaded) return false;
            const pc = this.cpu.pc;
            const opcode = this.memory.read(pc);
            
            // Check if it's a CALL or RST instruction
            const isCall = (opcode === 0xCD) || // CALL nn
                          (opcode & 0xC7) === 0xC4 || // CALL cc,nn
                          (opcode & 0xC7) === 0xC7;   // RST n
            
            if (isCall) {
                // Determine instruction length to find next PC
                let nextPC;
                if ((opcode & 0xC7) === 0xC7) {
                    // RST - 1 byte
                    nextPC = (pc + 1) & 0xffff;
                } else {
                    // CALL - 3 bytes
                    nextPC = (pc + 3) & 0xffff;
                }
                // Run until we return to nextPC
                this.runToAddress(nextPC, 1000000); // Max 1M cycles
            } else {
                this.stepInto();
            }
            return true;
        }
        
        // Run until PC reaches target address (or max cycles exceeded)
        runToAddress(targetAddr, maxCycles = 10000000) {
            if (this.running || !this.romLoaded) return false;
            this.autoMap.inExecution = true;
            const tracing = this.traceEnabled && this.onBeforeStep;
            const tstatesPerFrame = this.getTstatesPerFrame();
            let cycles = 0;
            const startPC = this.cpu.pc;  // Skip breakpoint at starting PC (for HALT)
            while (this.cpu.pc !== targetAddr && cycles < maxCycles) {
                // Beta Disk automatic ROM paging
                this.updateBetaDiskPaging();
                // Check breakpoint (skip at start PC and target PC)
                if (this.cpu.pc !== startPC && this.cpu.pc !== targetAddr && this.hasBreakpointAt(this.cpu.pc)) {
                    this.breakpointHit = true;
                    this.autoMap.inExecution = false;
                    this.renderToScreen();
                    if (this.onBreakpoint) this.onBreakpoint(this.cpu.pc);
                    return false;
                }
                // Clear trace ops and capture PC/bytes before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                let instrBytes = null;
                if (tracing) {
                    instrBytes = [
                        this.memory.read(instrPC),
                        this.memory.read((instrPC + 1) & 0xffff),
                        this.memory.read((instrPC + 2) & 0xffff),
                        this.memory.read((instrPC + 3) & 0xffff)
                    ];
                }
                cycles += this.cpu.step();

                // Handle frame boundary crossing (with late timing support)
                this.handleFrameBoundary();

                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                }
            }
            this.autoMap.inExecution = false;
            // Render current screen state
            this.renderToScreen();
            return this.cpu.pc === targetAddr;
        }
        
        // Get T-states per frame for current machine
        getTstatesPerFrame() {
            return this.timing.tstatesPerFrame;
        }

        // Get floating bus value based on current T-state
        // Returns the byte the ULA is currently reading from video memory
        // When not during active display, returns 0xFF
        // Reference: https://sinclair.wiki.zxnet.co.uk/wiki/Floating_bus
        getFloatingBusValue() {
            const t = this.cpu.tStates;
            const tstatesPerLine = this.timing.tstatesPerLine;  // 224 for 48K
            const line = Math.floor(t / tstatesPerLine);
            const tInLine = t % tstatesPerLine;

            // Screen display area: use ULA's first screen line
            const firstScreenLine = this.ula.FIRST_SCREEN_LINE;
            const screenLine = line - firstScreenLine;

            if (screenLine < 0 || screenLine >= 192) {
                return 0xff;  // Not in screen area
            }

            // Floating bus timing for 48K:
            // Swan: FloatBusFirstInterestingTick = ContentionFrom + 4 = 14335 + 4 = 14339
            // Line 64 starts at T=14336, so first read is at tInLine=3 (14336+3=14339)
            // For late timing: pattern shifts +1 T-state (first read at tInLine=4)
            // Pattern: 4 reads (bitmap,attr,bitmap,attr), 4 idle, repeating for 128 T-states
            const lateOffset = (this.lateTimings && this.profile.earlyIntTiming) ? 1 : 0;
            const floatStart = ((this.profile.ulaProfile === '48k') ? 3 : 0) + lateOffset;
            const floatEnd = floatStart + 128;

            if (tInLine < floatStart || tInLine >= floatEnd) {
                return 0xff;  // Not during active fetch
            }

            // Position within the fetch window
            const tInFetch = tInLine - floatStart;

            // Each 8 T-states: bitmap1, attr1, bitmap2, attr2, idle, idle, idle, idle
            const cyclePos = tInFetch % 8;
            if (cyclePos >= 4) {
                return 0xff;  // Idle cycles 4-7
            }

            // Calculate which character cell (0-31)
            // Each 8 T-states fetches 2 characters, so:
            // tInFetch 0-7 → columns 0,1; tInFetch 8-15 → columns 2,3; etc.
            const charColumn = Math.floor(tInFetch / 8) * 2 + Math.floor(cyclePos / 2);
            // Bitmap or attribute? 0,2 = bitmap; 1,3 = attribute
            const isBitmap = (cyclePos % 2) === 0;

            // Calculate screen address
            const y = screenLine;
            const x = charColumn;  // Column (0-31)

            if (isBitmap) {
                // Bitmap address: 010Y7Y6Y2Y1Y0Y5Y4Y3X4X3X2X1X0
                const addr = 0x4000 | ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | x;
                return this.memory.read(addr);
            } else {
                // Attribute address: 010110Y7Y6Y5Y4Y3X4X3X2X1X0
                const addr = 0x5800 | ((y >> 3) << 5) | x;
                return this.memory.read(addr);
            }
        }

        // Get interrupt timing offset (0 for early, 4 for late timing)
        getIntOffset() {
            return this.lateTimings ? this.INT_LATE_OFFSET : 0;
        }

        // Handle frame boundary crossing and interrupt firing with late timing support
        // Returns true if interrupt was fired
        handleFrameBoundary() {
            const tstatesPerFrame = this.getTstatesPerFrame();
            const intPulseDuration = this.profile.intPulseDuration;
            const intOffset = this.getIntOffset();

            // Set INT pending when we reach frame end
            if (!this.pendingInt && this.cpu.tStates >= tstatesPerFrame) {
                this.pendingInt = true;
                this.pendingIntAt = tstatesPerFrame + intOffset;
                this.pendingIntEnd = this.pendingIntAt + intPulseDuration;
            }

            // Check for pending INT
            if (this.pendingInt) {
                if (this.cpu.tStates >= this.pendingIntAt && this.cpu.iff1 && !this.cpu.eiPending) {
                    if (this.debugIntTiming) {
                        console.log(`[INT-step] FIRED at T=${this.cpu.tStates}, pendingIntAt=${this.pendingIntAt}, halted=${this.cpu.halted}`);
                    }
                    this.pendingInt = false;
                    this.cpu.interrupt();
                    // Adjust T-states for next frame
                    if (this.cpu.tStates >= tstatesPerFrame) {
                        this.cpu.tStates -= tstatesPerFrame;
                        this.frameStartOffset = this.cpu.tStates;
                        this.accumulatedContention = 0;  // Reset for new frame
                        this.ula.startFrame();
                    }
                    return true;
                } else if (this.cpu.tStates >= this.pendingIntEnd) {
                    if (this.debugIntTiming) {
                        console.log(`[INT-step] PULSE ENDED at T=${this.cpu.tStates}, IFF1=${this.cpu.iff1}, eiPending=${this.cpu.eiPending}`);
                    }
                    // INT pulse ended without firing
                    this.pendingInt = false;
                    // Adjust T-states for next frame
                    if (this.cpu.tStates >= tstatesPerFrame) {
                        this.cpu.tStates -= tstatesPerFrame;
                        this.frameStartOffset = this.cpu.tStates;
                        this.accumulatedContention = 0;  // Reset for new frame
                        this.ula.startFrame();
                    }
                }
            }

            return false;
        }

        // Set late timing mode
        // Late timing shifts ALL screen-related timings by 1T (ULA thermal drift)
        setLateTimings(late) {
            this.lateTimings = !!late;
            this._intDebugCount = 0;
            this._floatBusLogCount = 0;
            if (this.ula) {
                this.ula.setLateTimings(late);
            }
        }

        // Set early timing mode (convenience method for tests)
        setEarlyTimings(early) {
            this.setLateTimings(!early);
        }

        // Run until next interrupt
        runToInterrupt(maxCycles = 10000000) {
            if (this.running || !this.romLoaded) return false;
            this.autoMap.inExecution = true;
            const tracing = this.traceEnabled && this.onBeforeStep;
            let cycles = 0;
            const startPC = this.cpu.pc;  // Skip breakpoint check at starting PC (for HALT)

            while (cycles < maxCycles) {
                // Beta Disk automatic ROM paging
                this.updateBetaDiskPaging();

                // Check for frame boundary and interrupt (with late timing support)
                if (this.handleFrameBoundary()) {
                    // Interrupt was fired
                    this.autoMap.inExecution = false;
                    this.renderToScreen();
                    return true;
                }

                // Check breakpoint (skip if still at start PC - allows leaving current breakpoint/HALT)
                if (this.cpu.pc !== startPC && this.hasBreakpointAt(this.cpu.pc)) {
                    this.breakpointHit = true;
                    this.autoMap.inExecution = false;
                    this.renderToScreen();
                    if (this.onBreakpoint) this.onBreakpoint(this.cpu.pc);
                    return false;
                }

                // Clear trace ops and capture PC/bytes before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                let instrBytes = null;
                if (tracing) {
                    instrBytes = [
                        this.memory.read(instrPC),
                        this.memory.read((instrPC + 1) & 0xffff),
                        this.memory.read((instrPC + 2) & 0xffff),
                        this.memory.read((instrPC + 3) & 0xffff)
                    ];
                }
                cycles += this.cpu.step();
                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                }
            }

            this.autoMap.inExecution = false;
            this.renderToScreen();
            return false;
        }
        
        // Run until RET instruction is executed
        runToRet(maxCycles = 10000000) {
            if (this.running || !this.romLoaded) return false;
            this.autoMap.inExecution = true;
            const tracing = this.traceEnabled && this.onBeforeStep;
            const tstatesPerFrame = this.getTstatesPerFrame();
            let cycles = 0;

            while (cycles < maxCycles) {
                // Beta Disk automatic ROM paging
                this.updateBetaDiskPaging();

                const pc = this.cpu.pc;
                const opcode = this.memory.read(pc);

                // Check for RET instructions:
                // C9 = RET
                // C0/C8/D0/D8/E0/E8/F0/F8 = RET cc (conditional)
                // ED 45 = RETN, ED 4D = RETI
                const isRet = (opcode === 0xC9) ||
                              ((opcode & 0xC7) === 0xC0) ||
                              (opcode === 0xED && (this.memory.read((pc + 1) & 0xffff) === 0x45 ||
                                                   this.memory.read((pc + 1) & 0xffff) === 0x4D));

                if (isRet && cycles > 0) {
                    // Clear trace ops and capture PC/bytes before RET
                    if (tracing) {
                        this.tracePortOps = [];
                        this.traceMemOps = [];
                    }
                    const instrPC = tracing ? this.cpu.pc : 0;
                    let instrBytes = null;
                    if (tracing) {
                        instrBytes = [
                            this.memory.read(instrPC),
                            this.memory.read((instrPC + 1) & 0xffff),
                            this.memory.read((instrPC + 2) & 0xffff),
                            this.memory.read((instrPC + 3) & 0xffff)
                        ];
                    }
                    // Execute the RET and stop after
                    cycles += this.cpu.step();
                    // Record trace after execution
                    if (tracing) {
                        this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                    }
                    this.autoMap.inExecution = false;
                    this.renderToScreen();
                    return true;
                }

                // Check breakpoint
                if (this.hasBreakpointAt(this.cpu.pc)) {
                    this.breakpointHit = true;
                    this.autoMap.inExecution = false;
                    this.renderToScreen();
                    if (this.onBreakpoint) this.onBreakpoint(this.cpu.pc);
                    return false;
                }

                // Clear trace ops and capture PC/bytes before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                let instrBytes = null;
                if (tracing) {
                    instrBytes = [
                        this.memory.read(instrPC),
                        this.memory.read((instrPC + 1) & 0xffff),
                        this.memory.read((instrPC + 2) & 0xffff),
                        this.memory.read((instrPC + 3) & 0xffff)
                    ];
                }
                cycles += this.cpu.step();

                // Handle frame boundary crossing (with late timing support)
                this.handleFrameBoundary();

                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                }
            }

            this.autoMap.inExecution = false;
            this.renderToScreen();
            return false;
        }

        // Run for specified number of T-states (ignores breakpoints for precise timing)
        runTstates(tstates) {
            if (this.running || !this.romLoaded) return 0;
            this.autoMap.inExecution = true;
            const tracing = this.traceEnabled && this.onBeforeStep;
            let executed = 0;
            const target = this.cpu.tStates + tstates;

            while (this.cpu.tStates < target) {
                // Beta Disk automatic ROM paging
                this.updateBetaDiskPaging();

                // Clear trace ops and capture PC/bytes before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                let instrBytes = null;
                if (tracing) {
                    instrBytes = [
                        this.memory.read(instrPC),
                        this.memory.read((instrPC + 1) & 0xffff),
                        this.memory.read((instrPC + 2) & 0xffff),
                        this.memory.read((instrPC + 3) & 0xffff)
                    ];
                }
                const before = this.cpu.tStates;
                this.cpu.step();
                executed += this.cpu.tStates - before;
                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                }
            }

            this.autoMap.inExecution = false;
            this.renderToScreen();
            return executed;
        }

        // ========== Debugging - Breakpoints ==========

        parseAddressSpec(spec) {
            spec = spec.trim().toUpperCase();
            let page = null;
            
            // Check for page prefix (e.g., "5:" or "R0:")
            const colonIdx = spec.indexOf(':');
            if (colonIdx !== -1) {
                const pageSpec = spec.substring(0, colonIdx);
                spec = spec.substring(colonIdx + 1);
                if (pageSpec.startsWith('R')) {
                    page = pageSpec; // ROM page like 'R0' or 'R1'
                } else {
                    page = parseInt(pageSpec, 10);
                    if (isNaN(page) || page < 0 || page > 7) return null;
                }
            }
            
            // Check for range (e.g., "1234-5678")
            const dashIdx = spec.indexOf('-');
            if (dashIdx !== -1) {
                const startStr = spec.substring(0, dashIdx);
                const endStr = spec.substring(dashIdx + 1);
                const start = parseInt(startStr, 16);
                const end = parseInt(endStr, 16);
                if (isNaN(start) || isNaN(end)) return null;
                return { start: start & 0xffff, end: end & 0xffff, page };
            }
            
            // Single address
            const addr = parseInt(spec, 16);
            if (isNaN(addr)) return null;
            return { start: addr & 0xffff, end: addr & 0xffff, page };
        }
        
        // Get current page for an address based on memory mapping
        getCurrentPageForAddr(addr) {
            if (this.profile.pagingModel === 'none') {
                return null; // No paging in 48K
            }
            
            addr = addr & 0xffff;
            if (addr < 0x4000) {
                // ROM area - return current ROM page
                return this.memory.currentRomPage === 0 ? 'R0' : 'R1';
            } else if (addr < 0x8000) {
                return 5; // Always page 5
            } else if (addr < 0xC000) {
                return 2; // Always page 2
            } else {
                return this.memory.currentRamPage; // Switchable page
            }
        }
        
        // Check if breakpoint matches current state
        checkBreakpointMatch(bp, addr) {
            addr = addr & 0xffff;
            if (addr < bp.start || addr > bp.end) return false;
            if (bp.page !== null && bp.page !== this.getCurrentPageForAddr(addr)) return false;
            // Check condition if present
            if (bp.condition) {
                return this.evaluateCondition(bp.condition);
            }
            return true;
        }

        // Evaluate a breakpoint condition
        // Supports: A, B, C, D, E, H, L, F, AF, BC, DE, HL, IX, IY, SP, PC, I, R
        // Operators: ==, !=, <, >, <=, >=, &, |
        // Memory: (HL), (DE), (BC), (1234)
        // Flags: Z, NZ, C, NC, P, M, PE, PO
        // Context: val (for watchpoints), port (for port breakpoints)
        evaluateCondition(condition, context = {}) {
            if (!this.cpu) return false;
            try {
                const cpu = this.cpu;
                const mem = this.memory;
                const ctxVal = context.val;
                const ctxPort = context.port;

                // Get register value by name
                const getReg = (name) => {
                    name = name.toUpperCase();
                    switch (name) {
                        case 'A': return cpu.a;
                        case 'B': return cpu.b;
                        case 'C': return cpu.c;
                        case 'D': return cpu.d;
                        case 'E': return cpu.e;
                        case 'H': return cpu.h;
                        case 'L': return cpu.l;
                        case 'F': return cpu.f;
                        case 'I': return cpu.i;
                        case 'R': return cpu.r;
                        case 'AF': return (cpu.a << 8) | cpu.f;
                        case 'BC': return (cpu.b << 8) | cpu.c;
                        case 'DE': return (cpu.d << 8) | cpu.e;
                        case 'HL': return (cpu.h << 8) | cpu.l;
                        case 'IX': return cpu.ix;
                        case 'IY': return cpu.iy;
                        case 'SP': return cpu.sp;
                        case 'PC': return cpu.pc;
                        case "A'": return cpu.a_;
                        case "B'": return cpu.b_;
                        case "C'": return cpu.c_;
                        case "D'": return cpu.d_;
                        case "E'": return cpu.e_;
                        case "H'": return cpu.h_;
                        case "L'": return cpu.l_;
                        case "F'": return cpu.f_;
                        case "AF'": return (cpu.a_ << 8) | cpu.f_;
                        case "BC'": return (cpu.b_ << 8) | cpu.c_;
                        case "DE'": return (cpu.d_ << 8) | cpu.e_;
                        case "HL'": return (cpu.h_ << 8) | cpu.l_;
                        default: return null;
                    }
                };

                // Get flag value
                const getFlag = (name) => {
                    name = name.toUpperCase();
                    const f = cpu.f;
                    switch (name) {
                        case 'Z': return (f & 0x40) !== 0;
                        case 'NZ': return (f & 0x40) === 0;
                        case 'C': return (f & 0x01) !== 0;
                        case 'NC': return (f & 0x01) === 0;
                        case 'P': case 'PE': return (f & 0x04) !== 0;
                        case 'M': case 'PO': return (f & 0x04) === 0;
                        case 'N': return (f & 0x02) !== 0;
                        case 'H': return (f & 0x10) !== 0;
                        case 'S': return (f & 0x80) !== 0;
                        default: return null;
                    }
                };

                // Parse a value (register, memory, literal, or context)
                const parseValue = (s) => {
                    s = s.trim();
                    const upper = s.toUpperCase();

                    // Context variables for watchpoints/port breakpoints
                    if (upper === 'VAL' && ctxVal !== undefined) return ctxVal;
                    if (upper === 'PORT' && ctxPort !== undefined) return ctxPort;

                    // T-states counter
                    if (upper === 'T' || upper === 'TSTATES') return cpu.tStates;

                    // Memory access: (HL), (DE), (BC), (1234), (IX+n), (IY+n)
                    const memMatch = s.match(/^\(([^)]+)\)$/);
                    if (memMatch) {
                        const inner = memMatch[1].trim().toUpperCase();
                        let addr;
                        if (inner === 'HL') addr = getReg('HL');
                        else if (inner === 'DE') addr = getReg('DE');
                        else if (inner === 'BC') addr = getReg('BC');
                        else if (inner === 'SP') addr = getReg('SP');
                        else if (inner === 'IX') addr = cpu.ix;
                        else if (inner === 'IY') addr = cpu.iy;
                        else if (inner.match(/^IX[+-]\d+$/i)) {
                            const offset = parseInt(inner.slice(2));
                            addr = (cpu.ix + offset) & 0xffff;
                        } else if (inner.match(/^IY[+-]\d+$/i)) {
                            const offset = parseInt(inner.slice(2));
                            addr = (cpu.iy + offset) & 0xffff;
                        } else {
                            // Numeric address
                            addr = parseInt(inner, 16);
                        }
                        return mem.read(addr & 0xffff);
                    }
                    // Register
                    const regVal = getReg(s);
                    if (regVal !== null) return regVal;
                    // Decimal literal (pure digits, no letters)
                    if (s.match(/^\d+$/)) {
                        return parseInt(s, 10);
                    }
                    // Hex literal (with 'h' suffix or contains A-F)
                    if (s.match(/^[0-9A-Fa-f]+h$/i) || s.match(/^[0-9]*[A-Fa-f][0-9A-Fa-f]*$/)) {
                        return parseInt(s.replace(/h$/i, ''), 16);
                    }
                    return null;
                };

                // Check for simple flag test
                const cond = condition.trim();
                const flagVal = getFlag(cond);
                if (flagVal !== null) return flagVal;

                // Parse comparison: value op value
                const opMatch = cond.match(/^(.+?)\s*(==|!=|<>|<=|>=|<|>|&|\|)\s*(.+)$/);
                if (opMatch) {
                    const left = parseValue(opMatch[1]);
                    const op = opMatch[2];
                    const right = parseValue(opMatch[3]);
                    if (left === null || right === null) return false;
                    switch (op) {
                        case '==': return left === right;
                        case '!=': case '<>': return left !== right;
                        case '<': return left < right;
                        case '>': return left > right;
                        case '<=': return left <= right;
                        case '>=': return left >= right;
                        case '&': return (left & right) !== 0;
                        case '|': return (left | right) !== 0;
                    }
                }

                return false;
            } catch (e) {
                return false;
            }
        }
        
        // Check if any breakpoint matches
        hasBreakpointAt(addr) {
            // Use unified trigger system
            return this.checkExecTriggers(addr) !== null;
        }
        
        addBreakpoint(spec) {
            if (typeof spec === 'number') {
                spec = { start: spec & 0xffff, end: spec & 0xffff, page: null };
            } else if (typeof spec === 'string') {
                spec = this.parseAddressSpec(spec);
                if (!spec) return false;
            }
            // Use unified trigger system
            return this.addTrigger({
                type: 'exec',
                start: spec.start,
                end: spec.end,
                page: spec.page
            }) >= 0;
        }
        
        removeBreakpoint(index) {
            // Find the corresponding trigger in the unified array
            const execTriggers = this.triggers
                .map((t, i) => ({ ...t, triggerIndex: i }))
                .filter(t => t.type === 'exec');
            if (index >= 0 && index < execTriggers.length) {
                return this.removeTrigger(execTriggers[index].triggerIndex);
            }
            return false;
        }

        removeBreakpointByAddr(addr) {
            addr = addr & 0xffff;
            const idx = this.triggers.findIndex(t =>
                t.type === 'exec' && t.start === addr && t.end === addr && t.page === null);
            if (idx !== -1) {
                return this.removeTrigger(idx);
            }
            return false;
        }

        toggleBreakpoint(addr) {
            addr = addr & 0xffff;
            const idx = this.triggers.findIndex(t =>
                t.type === 'exec' && t.start === addr && t.end === addr && t.page === null);
            if (idx !== -1) {
                this.removeTrigger(idx);
                return false;
            } else {
                this.addTrigger({ type: 'exec', start: addr, end: addr, page: null });
                return true;
            }
        }

        hasBreakpoint(addr) {
            // For disassembly display - check if exact single-address breakpoint exists
            addr = addr & 0xffff;
            return this.triggers.some(t =>
                t.type === 'exec' && t.enabled && t.start === addr && t.end === addr);
        }

        getBreakpoints() {
            // Return from legacy array (synced from triggers)
            return this.breakpoints.map((bp, idx) => ({ ...bp, index: idx }));
        }

        clearBreakpoints() {
            this.clearTriggers('exec');
        }
        
        // Format breakpoint for display
        formatBreakpoint(bp) {
            let str = '';
            if (bp.page !== null) {
                str += (typeof bp.page === 'string' ? bp.page : bp.page.toString()) + ':';
            }
            str += bp.start.toString(16).toUpperCase().padStart(4, '0');
            if (bp.end !== bp.start) {
                str += '-' + bp.end.toString(16).toUpperCase().padStart(4, '0');
            }
            if (bp.condition) {
                str += ' if ' + bp.condition;
            }
            return str;
        }

        // Add breakpoint with optional condition
        addBreakpointWithCondition(addrSpec, condition) {
            let spec;
            if (typeof addrSpec === 'number') {
                spec = { start: addrSpec & 0xffff, end: addrSpec & 0xffff, page: null };
            } else if (typeof addrSpec === 'string') {
                spec = this.parseAddressSpec(addrSpec);
                if (!spec) return false;
            } else {
                spec = addrSpec;
            }
            // Use unified trigger system
            return this.addTrigger({
                type: 'exec',
                start: spec.start,
                end: spec.end,
                page: spec.page,
                condition: condition ? condition.trim() : ''
            }) >= 0;
        }

        // ========== Debugging - Port Breakpoints ==========

        parsePortSpec(spec) {
            spec = spec.trim().toUpperCase();
            // Format: "FE", "7FFD", "FE&FF", "7FFD&FFFF" (port & mask)
            const ampIdx = spec.indexOf('&');
            let port, mask;
            if (ampIdx !== -1) {
                port = parseInt(spec.substring(0, ampIdx), 16);
                mask = parseInt(spec.substring(ampIdx + 1), 16);
            } else {
                port = parseInt(spec, 16);
                // Default mask: 0xFF for 8-bit, 0xFFFF for 16-bit
                mask = port > 0xFF ? 0xFFFF : 0xFF;
            }
            if (isNaN(port) || isNaN(mask)) return null;
            // Determine if it's 16-bit based on port value or mask
            const is16bit = port > 0xFF || mask > 0xFF;
            return { 
                port: port & (is16bit ? 0xFFFF : 0xFF), 
                mask: mask & (is16bit ? 0xFFFF : 0xFF),
                is16bit 
            };
        }
        
        addPortBreakpoint(spec, direction = 'both') {
            if (typeof spec === 'string') {
                const parsed = this.parsePortSpec(spec);
                if (!parsed) return false;
                spec = parsed;
            }
            // Map direction to trigger type
            const typeMap = { 'in': 'port_in', 'out': 'port_out', 'both': 'port_io' };
            const type = typeMap[direction] || 'port_io';

            return this.addTrigger({
                type,
                start: spec.port,
                end: spec.port,
                mask: spec.mask
            }) >= 0;
        }

        removePortBreakpoint(index) {
            // Find the corresponding trigger in the unified array
            const portTriggers = this.triggers
                .map((t, i) => ({ ...t, triggerIndex: i }))
                .filter(t => t.type.startsWith('port'));
            if (index >= 0 && index < portTriggers.length) {
                return this.removeTrigger(portTriggers[index].triggerIndex);
            }
            return false;
        }

        getPortBreakpoints() {
            // Return from legacy array (synced from triggers)
            return this.portBreakpoints.map((pb, idx) => ({ ...pb, index: idx }));
        }

        clearPortBreakpoints() {
            this.clearTriggers(['port_in', 'port_out', 'port_io']);
        }
        
        formatPortBreakpoint(pb) {
            const padLen = pb.is16bit ? 4 : 2;
            const defaultMask = pb.is16bit ? 0xFFFF : 0xFF;
            let str = pb.port.toString(16).toUpperCase().padStart(padLen, '0');
            if (pb.mask !== defaultMask) {
                str += '&' + pb.mask.toString(16).toUpperCase().padStart(padLen, '0');
            }
            str += ' (' + pb.direction.toUpperCase() + ')';
            return str;
        }
        
        checkPortBreakpoint(port, direction) {
            // Use unified trigger system
            const isOut = direction === 'out';
            const trigger = this.checkPortTriggers(port, 0, isOut);
            if (trigger) {
                // Return in legacy format for compatibility
                return {
                    port: trigger.start,
                    mask: trigger.mask,
                    is16bit: trigger.start > 0xff || trigger.mask > 0xff,
                    direction: trigger.type === 'port_in' ? 'in' : trigger.type === 'port_out' ? 'out' : 'both'
                };
            }
            return null;
        }

        // ========== Debugging - Watchpoints ==========

        addWatchpoint(spec, type = 'both') {
            if (typeof spec === 'number') {
                spec = { start: spec & 0xffff, end: spec & 0xffff, page: null };
            } else if (typeof spec === 'string') {
                spec = this.parseAddressSpec(spec);
                if (!spec) return false;
            }
            // Map type to trigger type
            const typeMap = { 'read': 'read', 'write': 'write', 'both': 'rw' };
            const triggerType = typeMap[type] || 'rw';

            return this.addTrigger({
                type: triggerType,
                start: spec.start,
                end: spec.end,
                page: spec.page
            }) >= 0;
        }

        removeWatchpoint(index) {
            // Find the corresponding trigger in the unified array
            const memTriggers = this.triggers
                .map((t, i) => ({ ...t, triggerIndex: i }))
                .filter(t => ['read', 'write', 'rw'].includes(t.type));
            if (index >= 0 && index < memTriggers.length) {
                return this.removeTrigger(memTriggers[index].triggerIndex);
            }
            return false;
        }

        hasWatchpoint(addr) {
            addr = addr & 0xffff;
            return this.triggers.some(t =>
                ['read', 'write', 'rw'].includes(t.type) && t.enabled &&
                addr >= t.start && addr <= t.end);
        }

        getWatchpoint(addr) {
            addr = addr & 0xffff;
            for (const t of this.triggers) {
                if (!['read', 'write', 'rw'].includes(t.type) || !t.enabled) continue;
                if (addr >= t.start && addr <= t.end) {
                    if (t.page === null || t.page === this.getCurrentPageForAddr(addr)) {
                        // Return in legacy format
                        return {
                            start: t.start,
                            end: t.end,
                            page: t.page,
                            read: t.type === 'read' || t.type === 'rw',
                            write: t.type === 'write' || t.type === 'rw'
                        };
                    }
                }
            }
            return null;
        }

        getWatchpoints() {
            // Return from legacy array (synced from triggers)
            return this.watchpoints.map((wp, idx) => ({ ...wp, index: idx }));
        }

        clearWatchpoints() {
            this.clearTriggers(['read', 'write', 'rw']);
        }
        
        formatWatchpoint(wp) {
            let str = '';
            if (wp.page !== null) {
                str += (typeof wp.page === 'string' ? wp.page : wp.page.toString()) + ':';
            }
            str += wp.start.toString(16).toUpperCase().padStart(4, '0');
            if (wp.end !== wp.start) {
                str += '-' + wp.end.toString(16).toUpperCase().padStart(4, '0');
            }
            str += ' (';
            if (wp.read && wp.write) str += 'R/W';
            else if (wp.read) str += 'R';
            else if (wp.write) str += 'W';
            str += ')';
            return str;
        }
        
        checkReadWatchpoint(addr, val) {
            if (!this.running || this.triggers.length === 0) return;
            // Use unified trigger system
            const trigger = this.checkMemTriggers(addr, val, false);
            if (trigger) {
                this.watchpointHit = true;
                this.triggerHit = true;
                this.lastWatchpoint = { addr, type: 'read', val };
                this.lastTrigger = { trigger, addr, val, type: 'read' };
            }
        }

        checkWriteWatchpoint(addr, val) {
            if (!this.running || this.triggers.length === 0) return;
            // Use unified trigger system
            const trigger = this.checkMemTriggers(addr, val, true);
            if (trigger) {
                this.watchpointHit = true;
                this.triggerHit = true;
                this.lastWatchpoint = { addr, type: 'write', val };
                this.lastTrigger = { trigger, addr, val, type: 'write' };
            }
        }

        // ========== Memory Callback Optimization ==========

        /**
         * Update memory/CPU callbacks based on current feature state
         * Sets callbacks to null when not needed (zero overhead)
         * Call this when triggers, autoMap, or runtimeTraceEnabled changes
         */
        updateMemoryCallbacksFlag() {
            const needsMemoryCallbacks =
                this.triggers.length > 0 ||
                this.autoMap.enabled ||
                this.runtimeTraceEnabled;

            // Set callbacks to null when not needed (eliminates function call overhead)
            this.memory.onRead = needsMemoryCallbacks ? this._memoryReadCallback : null;
            this.memory.onWrite = needsMemoryCallbacks ? this._memoryWriteCallback : null;

            // CPU fetch callback only needed for autoMap
            this.cpu.onFetch = this.autoMap.enabled ? this._cpuFetchCallback : null;
        }

        // ========== Unified Trigger System ==========

        /**
         * Add a trigger (unified breakpoint/watchpoint/port breakpoint)
         * @param {Object} trigger - Trigger object with properties:
         *   type: 'exec'|'read'|'write'|'rw'|'port_in'|'port_out'|'port_io'
         *   start: number - Address or port number
         *   end: number - End of range (= start for single)
         *   page: number|string|null - Memory page (null = any)
         *   mask: number - Port mask (for port types)
         *   condition: string - Condition expression
         *   enabled: boolean - Whether trigger is active
         *   hitCount: number - Times triggered
         *   log: boolean - Log without breaking
         *   name: string - Optional description
         * @returns {number} Index of added trigger, or -1 if duplicate
         */
        addTrigger(trigger) {
            // Normalize trigger
            const t = {
                type: trigger.type || 'exec',
                start: trigger.start & 0xffff,
                end: (trigger.end !== undefined ? trigger.end : trigger.start) & 0xffff,
                page: trigger.page !== undefined ? trigger.page : null,
                mask: trigger.mask !== undefined ? trigger.mask : 0xffff,
                condition: trigger.condition || '',
                enabled: trigger.enabled !== false,
                hitCount: trigger.hitCount || 0,
                skipCount: trigger.skipCount || 0,
                log: trigger.log || false,
                name: trigger.name || ''
            };

            // For port types, default mask based on port value
            if (t.type.startsWith('port') && trigger.mask === undefined) {
                t.mask = t.start > 0xff ? 0xffff : 0xff;
            }

            // Check for duplicate
            for (const existing of this.triggers) {
                if (existing.type === t.type &&
                    existing.start === t.start &&
                    existing.end === t.end &&
                    existing.page === t.page &&
                    existing.mask === t.mask) {
                    // Update existing trigger's condition if different
                    if (t.condition && t.condition !== existing.condition) {
                        existing.condition = t.condition;
                    }
                    return this.triggers.indexOf(existing);
                }
            }

            this.triggers.push(t);
            this._syncLegacyArrays();
            this.updateMemoryCallbacksFlag();
            return this.triggers.length - 1;
        }

        /**
         * Remove a trigger by index
         */
        removeTrigger(index) {
            if (index >= 0 && index < this.triggers.length) {
                this.triggers.splice(index, 1);
                this._syncLegacyArrays();
                this.updateMemoryCallbacksFlag();
                return true;
            }
            return false;
        }

        /**
         * Toggle a trigger's enabled state
         */
        toggleTrigger(index) {
            if (index >= 0 && index < this.triggers.length) {
                this.triggers[index].enabled = !this.triggers[index].enabled;
                // Rebuild exec breakpoint Set if this is an exec trigger
                if (this.triggers[index].type === 'exec') {
                    this._rebuildExecBreakpointSet();
                }
                return this.triggers[index].enabled;
            }
            return null;
        }

        /**
         * Get all triggers, optionally filtered by type
         * @param {string|string[]} type - Optional type or array of types to filter
         */
        getTriggers(type = null) {
            if (!type) return this.triggers.map((t, i) => ({ ...t, index: i }));
            const types = Array.isArray(type) ? type : [type];
            return this.triggers
                .map((t, i) => ({ ...t, index: i }))
                .filter(t => types.includes(t.type));
        }

        /**
         * Clear all triggers, optionally filtered by type
         */
        clearTriggers(type = null) {
            if (!type) {
                this.triggers = [];
            } else {
                const types = Array.isArray(type) ? type : [type];
                this.triggers = this.triggers.filter(t => !types.includes(t.type));
            }
            this._syncLegacyArrays();
            this.updateMemoryCallbacksFlag();
        }

        /**
         * Format a trigger for display
         */
        formatTrigger(t) {
            let str = '';
            const isPort = t.type.startsWith('port');

            if (isPort) {
                // Port trigger
                const padLen = t.start > 0xff ? 4 : 2;
                const defaultMask = t.start > 0xff ? 0xffff : 0xff;
                str = t.start.toString(16).toUpperCase().padStart(padLen, '0');
                if (t.mask !== defaultMask) {
                    str += '&' + t.mask.toString(16).toUpperCase().padStart(padLen, '0');
                }
            } else {
                // Memory trigger
                if (t.page !== null) {
                    str += (typeof t.page === 'string' ? t.page : t.page.toString()) + ':';
                }
                str += t.start.toString(16).toUpperCase().padStart(4, '0');
                if (t.end !== t.start) {
                    str += '-' + t.end.toString(16).toUpperCase().padStart(4, '0');
                }
            }

            if (t.condition) {
                str += ' if ' + t.condition;
            }

            return str;
        }

        /**
         * Get trigger type display icon
         */
        getTriggerIcon(type) {
            const icons = {
                exec: '●',
                read: 'R',
                write: 'W',
                rw: 'RW',
                port_in: '⇐',
                port_out: '⇒',
                port_io: '⇔'
            };
            return icons[type] || '?';
        }

        /**
         * Get trigger type display label
         */
        getTriggerLabel(type) {
            const labels = {
                exec: 'Exec',
                read: 'Read',
                write: 'Write',
                rw: 'R/W',
                port_in: 'Port IN',
                port_out: 'Port OUT',
                port_io: 'Port I/O'
            };
            return labels[type] || type;
        }

        /**
         * Check if an execution trigger matches at the given PC
         */
        checkExecTriggers(pc) {
            // Fast O(1) check using Set - skip iteration if PC not in any breakpoint range
            if (!this.execBreakpointSet.has(pc)) return null;
            // PC is in a breakpoint range - do full check for conditions, page, etc.
            for (const t of this.triggers) {
                if (t.type !== 'exec' || !t.enabled) continue;
                if (this._matchesTrigger(t, pc)) {
                    t.hitCount++;
                    if (t.hitCount > t.skipCount) {
                        return t;
                    }
                }
            }
            return null;
        }

        /**
         * Check if a memory access trigger matches
         */
        checkMemTriggers(addr, val, isWrite) {
            const types = isWrite ? ['write', 'rw'] : ['read', 'rw'];
            for (const t of this.triggers) {
                if (!types.includes(t.type) || !t.enabled) continue;
                if (this._matchesTrigger(t, addr, val)) {
                    t.hitCount++;
                    if (t.hitCount > t.skipCount) {
                        return t;
                    }
                }
            }
            return null;
        }

        /**
         * Check if a port access trigger matches
         */
        checkPortTriggers(port, val, isOut) {
            if (this.triggers.length === 0) return null;
            const types = isOut ? ['port_out', 'port_io'] : ['port_in', 'port_io'];
            for (const t of this.triggers) {
                if (!types.includes(t.type) || !t.enabled) continue;
                if (this._matchesPortTrigger(t, port, val)) {
                    t.hitCount++;
                    if (t.hitCount > t.skipCount) {
                        return t;
                    }
                }
            }
            return null;
        }

        /**
         * Check if a trigger matches an address
         */
        _matchesTrigger(t, addr, val = undefined) {
            addr = addr & 0xffff;
            if (addr < t.start || addr > t.end) return false;
            if (t.page !== null && t.page !== this.getCurrentPageForAddr(addr)) return false;
            if (t.condition) {
                return this.evaluateCondition(t.condition, { val });
            }
            return true;
        }

        /**
         * Check if a port trigger matches
         */
        _matchesPortTrigger(t, port, val) {
            if ((port & t.mask) !== (t.start & t.mask)) return false;
            if (t.condition) {
                return this.evaluateCondition(t.condition, { port, val });
            }
            return true;
        }

        /**
         * Sync legacy arrays from unified triggers for backward compatibility
         */
        _syncLegacyArrays() {
            // Rebuild breakpoints array from exec triggers
            this.breakpoints = this.triggers
                .filter(t => t.type === 'exec')
                .map(t => ({
                    start: t.start,
                    end: t.end,
                    page: t.page,
                    condition: t.condition
                }));

            // Rebuild watchpoints array from read/write/rw triggers
            this.watchpoints = this.triggers
                .filter(t => ['read', 'write', 'rw'].includes(t.type))
                .map(t => ({
                    start: t.start,
                    end: t.end,
                    page: t.page,
                    read: t.type === 'read' || t.type === 'rw',
                    write: t.type === 'write' || t.type === 'rw'
                }));

            // Rebuild portBreakpoints array from port triggers
            this.portBreakpoints = this.triggers
                .filter(t => t.type.startsWith('port'))
                .map(t => ({
                    port: t.start,
                    mask: t.mask,
                    is16bit: t.start > 0xff || t.mask > 0xff,
                    direction: t.type === 'port_in' ? 'in' : t.type === 'port_out' ? 'out' : 'both'
                }));

            // Rebuild fast exec breakpoint Set
            this._rebuildExecBreakpointSet();
        }

        /**
         * Rebuild the exec breakpoint Set for O(1) lookup
         */
        _rebuildExecBreakpointSet() {
            this.execBreakpointSet.clear();
            for (const t of this.triggers) {
                if (t.type === 'exec' && t.enabled) {
                    // Add all addresses in range to the Set
                    const end = t.end !== undefined ? t.end : t.start;
                    for (let addr = t.start; addr <= end; addr++) {
                        this.execBreakpointSet.add(addr);
                    }
                }
            }
        }

        /**
         * Parse trigger from address input string
         * Format: "[TYPE:]ADDR[-END]" where TYPE is optional
         */
        parseTriggerSpec(spec, defaultType = 'exec') {
            spec = spec.trim().toUpperCase();

            // Check for type prefix
            let type = defaultType;
            const colonIdx = spec.indexOf(':');
            if (colonIdx !== -1) {
                const prefix = spec.substring(0, colonIdx);
                // Check if it's a type prefix (not a page prefix like "5:" or "R0:")
                const typeMap = {
                    'E': 'exec', 'EXEC': 'exec',
                    'R': 'read', 'READ': 'read',
                    'W': 'write', 'WRITE': 'write',
                    'RW': 'rw',
                    'PI': 'port_in', 'IN': 'port_in',
                    'PO': 'port_out', 'OUT': 'port_out',
                    'PIO': 'port_io', 'IO': 'port_io'
                };
                if (typeMap[prefix]) {
                    type = typeMap[prefix];
                    spec = spec.substring(colonIdx + 1);
                }
            }

            // Handle port types
            if (type.startsWith('port')) {
                const parsed = this.parsePortSpec(spec);
                if (!parsed) return null;
                return {
                    type,
                    start: parsed.port,
                    end: parsed.port,
                    mask: parsed.mask
                };
            }

            // Handle address types
            const parsed = this.parseAddressSpec(spec);
            if (!parsed) return null;
            return {
                type,
                start: parsed.start,
                end: parsed.end,
                page: parsed.page
            };
        }

        // ========== End Unified Trigger System ==========

        // ========== Keyboard Handling ==========

        handleKeyDown(e) {
            // Don't capture keys when typing in input fields or contentEditable
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                return;
            }
            if (e.target.isContentEditable) {
                return;
            }
            // Also check if any input has focus
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
                return;
            }
            if (active && active.isContentEditable) {
                return;
            }
            
            // Ignore real keyboard during RZX playback
            if (this.rzxPlaying) {
                return;
            }

            // Prevent browser shortcuts when emulator should capture them
            // Alt+key combinations for ZX Spectrum Symbol Shift
            if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const key = e.key.toLowerCase();
                // Prevent Alt+key browser shortcuts for Symbol Shift combinations
                if (['p', 's', 'o', 'n', 'w', 'r', 'f', 'h', 'j', 'k', 'l', 'u', 'i', 'b', 'd', 'g', 'a', 'z', 'x', 'c', 'v', 'e', 't', 'y', 'm', 'q', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(key)) {
                    e.preventDefault();
                }
            }

            // Check e.key first for punctuation/shifted characters
            // This must be before joystick checks so typing { } | etc works
            if (e.key.length === 1 && !e.key.match(/^[a-zA-Z0-9]$/)) {
                const mapping = this.ula.getKeyMapping(e.key);
                if (mapping) {
                    e.preventDefault();
                    this.pressedKeys.set(e.code, e.key); // Track for proper release
                    this.ula.keyDown(e.key);
                    return;
                }
            }

            // Kempston joystick on numpad (use e.code for cross-platform consistency)
            const kempstonBit = this.getKempstonBit(e.code);
            if (kempstonBit !== null) {
                e.preventDefault();
                this.kempstonState |= kempstonBit;
                return;
            }

            // Extended Kempston buttons: [ = C, ] = A, \ = Start (only when not typing punctuation)
            const extBit = this.getExtendedKempstonBit(e.code);
            if (extBit !== null && this.kempstonExtendedEnabled) {
                e.preventDefault();
                this.kempstonExtendedState |= (1 << extBit);
                return;
            }

            // Use e.code for layout-independent key detection (letters, digits, special keys)
            if (this.ula.keyMap[e.code]) {
                e.preventDefault();
                this.pressedKeys.set(e.code, e.code); // Track for proper release
                this.ula.keyDown(e.code);
            }
        }

        handleKeyUp(e) {
            // Don't capture keys when typing in input fields or contentEditable
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
                return;
            }
            if (e.target.isContentEditable) {
                return;
            }
            // Also check if any input has focus
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
                return;
            }
            if (active && active.isContentEditable) {
                return;
            }

            // Use tracked key for proper release (handles shifted chars where e.key changes on release)
            const trackedKey = this.pressedKeys.get(e.code);
            if (trackedKey) {
                e.preventDefault();
                this.ula.keyUp(trackedKey);
                this.pressedKeys.delete(e.code);
                return;
            }

            // Kempston joystick on numpad (use e.code for cross-platform consistency)
            const kempstonBit = this.getKempstonBit(e.code);
            if (kempstonBit !== null) {
                e.preventDefault();
                this.kempstonState &= ~kempstonBit;
                return;
            }

            // Extended Kempston buttons: [ = C, ] = A, \ = Start
            const extBit = this.getExtendedKempstonBit(e.code);
            if (extBit !== null && this.kempstonExtendedEnabled) {
                e.preventDefault();
                this.kempstonExtendedState &= ~(1 << extBit);
                return;
            }
        }

        getKempstonBit(code) {
            // Numpad mapping to Kempston joystick (using e.code for consistency)
            // Bit 0: Right, Bit 1: Left, Bit 2: Down, Bit 3: Up, Bit 4: Fire
            switch (code) {
                case 'Numpad8': return 0x08; // Up
                case 'Numpad2': return 0x04; // Down
                case 'Numpad4': return 0x02; // Left
                case 'Numpad6': return 0x01; // Right
                case 'Numpad5': return 0x10; // Fire
                case 'Numpad0': return 0x10; // Fire
                case 'Numpad1': return 0x06; // Down+Left
                case 'Numpad3': return 0x05; // Down+Right
                case 'Numpad7': return 0x0a; // Up+Left
                case 'Numpad9': return 0x09; // Up+Right
                default:  return null;
            }
        }

        getExtendedKempstonBit(code) {
            // Extended Kempston buttons: [ ] \
            // Returns the bit number (5, 6, 7) not the mask
            switch (code) {
                case 'BracketLeft':  return 5; // [ = C button (bit 5)
                case 'BracketRight': return 6; // ] = A button (bit 6)
                case 'Backslash':    return 7; // \ = Start button (bit 7)
                default:  return null;
            }
        }

        // Kempston Mouse update methods
        updateMousePosition(dx, dy) {
            // Clamp movement to prevent large jumps (max ±20 per update)
            dx = Math.max(-20, Math.min(20, dx));
            dy = Math.max(-20, Math.min(20, dy));

            // Update X/Y with wrapping (0-255)
            // X increases right, Y increases when mouse moves UP (hardware convention)
            this.kempstonMouseX = (this.kempstonMouseX + dx) & 0xff;
            this.kempstonMouseY = (this.kempstonMouseY - dy) & 0xff;
        }

        setMouseButton(button, pressed) {
            // Buttons are active low (0 = pressed, 1 = released)
            // button: 0=left, 1=middle, 2=right
            const bit = button === 0 ? 1 : (button === 1 ? 2 : 0); // left=bit1, middle=bit2, right=bit0
            if (pressed) {
                this.kempstonMouseButtons &= ~(1 << bit);
            } else {
                this.kempstonMouseButtons |= (1 << bit);
            }
        }

        // Mouse wheel update (0-15, wrapping)
        updateMouseWheel(delta) {
            // delta > 0 = scroll down, delta < 0 = scroll up
            // Scroll up increases wheel value
            if (delta < 0) {
                this.kempstonMouseWheel = (this.kempstonMouseWheel + 1) & 0x0f;
            } else if (delta > 0) {
                this.kempstonMouseWheel = (this.kempstonMouseWheel - 1) & 0x0f;
            }
        }

        // Extended Kempston joystick buttons (bits 5-7)
        setExtendedButton(bit, pressed) {
            // bit 5 = C, bit 6 = A, bit 7 = Start (active high)
            if (pressed) {
                this.kempstonExtendedState |= (1 << bit);
            } else {
                this.kempstonExtendedState &= ~(1 << bit);
            }
        }

        // Poll hardware gamepad and update Kempston state
        pollGamepad() {
            if (!this.gamepadEnabled || !navigator.getGamepads) {
                this.gamepadState = 0;
                this.gamepadExtState = 0;
                return;
            }

            const gamepads = navigator.getGamepads();
            let gp = null;

            // Find first connected gamepad
            for (let i = 0; i < gamepads.length; i++) {
                if (gamepads[i] && gamepads[i].connected) {
                    gp = gamepads[i];
                    break;
                }
            }

            if (!gp) {
                this.gamepadState = 0;
                this.gamepadExtState = 0;
                return;
            }

            // Reset state each frame
            let state = 0;
            let extState = 0;

            // Use custom mapping if available
            if (this.gamepadMapping) {
                const m = this.gamepadMapping;
                if (this.checkGamepadInput(gp, m.up)) state |= 0x08;
                if (this.checkGamepadInput(gp, m.down)) state |= 0x04;
                if (this.checkGamepadInput(gp, m.left)) state |= 0x02;
                if (this.checkGamepadInput(gp, m.right)) state |= 0x01;
                if (this.checkGamepadInput(gp, m.fire)) state |= 0x10;
                // Extended buttons (C=bit5, A=bit6, Start=bit7)
                if (this.checkGamepadInput(gp, m.c)) extState |= 0x20;
                if (this.checkGamepadInput(gp, m.a)) extState |= 0x40;
                if (this.checkGamepadInput(gp, m.start)) extState |= 0x80;
            } else {
                // Default mapping for standard gamepads
                const axisThreshold = 0.5;
                for (let i = 0; i < gp.axes.length; i += 2) {
                    if (gp.axes[i] !== undefined) {
                        if (gp.axes[i] < -axisThreshold) state |= 0x02; // Left
                        if (gp.axes[i] > axisThreshold) state |= 0x01;  // Right
                    }
                    if (gp.axes[i + 1] !== undefined) {
                        if (gp.axes[i + 1] < -axisThreshold) state |= 0x08; // Up
                        if (gp.axes[i + 1] > axisThreshold) state |= 0x04;  // Down
                    }
                }

                // D-pad buttons (buttons 12-15 on standard mapping)
                if (gp.buttons[12]?.pressed) state |= 0x08; // Up
                if (gp.buttons[13]?.pressed) state |= 0x04; // Down
                if (gp.buttons[14]?.pressed) state |= 0x02; // Left
                if (gp.buttons[15]?.pressed) state |= 0x01; // Right

                // Fire buttons - any of first 4 face buttons
                for (let i = 0; i < Math.min(4, gp.buttons.length); i++) {
                    if (gp.buttons[i]?.pressed) state |= 0x10;
                }

                // Extended buttons (standard gamepad mapping)
                if (gp.buttons[2]?.pressed) extState |= 0x20; // X/Square = C
                if (gp.buttons[1]?.pressed) extState |= 0x40; // B/Circle = A
                if (gp.buttons[9]?.pressed) extState |= 0x80; // Start
                if (gp.buttons[4]?.pressed) extState |= 0x20; // LB = C
                if (gp.buttons[5]?.pressed) extState |= 0x40; // RB = A
            }

            // Store gamepad state separately (will be ORed with keyboard when reading port)
            this.gamepadState = state;
            this.gamepadExtState = extState;
        }

        // Check if a gamepad input matches a mapping entry
        checkGamepadInput(gp, mapping) {
            if (!mapping) return false;
            if (mapping.type === 'axis') {
                const val = gp.axes[mapping.index];
                if (val === undefined) return false;
                if (mapping.direction > 0) return val > mapping.threshold;
                else return val < -mapping.threshold;
            } else if (mapping.type === 'button') {
                const btn = gp.buttons[mapping.index];
                return btn && btn.pressed;
            }
            return false;
        }

        // Debug: Show gamepad state in console (call from console: spectrum.debugGamepad())
        debugGamepad() {
            if (!navigator.getGamepads) {
                console.log('Gamepad API not available');
                return;
            }
            const gamepads = navigator.getGamepads();
            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (!gp) continue;
                console.log(`=== Gamepad ${i}: ${gp.id} ===`);
                console.log(`Connected: ${gp.connected}, Mapping: "${gp.mapping}", Axes: ${gp.axes.length}, Buttons: ${gp.buttons.length}`);
                console.log('Axes (showing all):');
                for (let a = 0; a < gp.axes.length; a++) {
                    const val = gp.axes[a].toFixed(3);
                    if (Math.abs(gp.axes[a]) > 0.1) {
                        console.log(`  [${a}] = ${val} <-- ACTIVE`);
                    } else {
                        console.log(`  [${a}] = ${val}`);
                    }
                }
                console.log('Buttons (showing all):');
                for (let b = 0; b < gp.buttons.length; b++) {
                    const btn = gp.buttons[b];
                    const active = btn.pressed || btn.value > 0.1;
                    console.log(`  [${b}] pressed=${btn.pressed} value=${btn.value.toFixed(3)}${active ? ' <-- ACTIVE' : ''}`);
                }
                if (gp.buttons.length === 0) {
                    console.log('  (no buttons reported)');
                }
            }
        }

        // ========== File Loading ==========

        async loadFile(file) {
            let data = await file.arrayBuffer();
            let fileName = file.name;

            // Check if it's a ZIP file
            if (ZipLoader.isZip(data)) {
                const spectrumFiles = await ZipLoader.findAllSpectrum(data);

                if (spectrumFiles.length === 0) {
                    throw new Error('No SNA, SZX, TAP, Z80, TRD, SCL, or DSK files found in ZIP');
                }

                if (spectrumFiles.length > 1) {
                    // Return file list for UI to show selection
                    return {
                        needsSelection: true,
                        files: spectrumFiles.map(f => ({ name: f.name, type: f.type })),
                        _zipFiles: spectrumFiles  // Internal: full data for loading
                    };
                }

                // Single file - load directly
                data = spectrumFiles[0].data;
                fileName = spectrumFiles[0].name;
            }

            // Check for RZX (needs async loading)
            const type = this.snapshotLoader.detectType(data, fileName);
            if (type === 'rzx') {
                return this.loadRZX(data);
            }

            // Check for DSK disk images (ZX Spectrum +3)
            if (type === 'dsk') {
                return this.loadDSKImage(data, fileName);
            }

            // Check for TRD/SCL disk images (contain multiple files)
            if (type === 'trd' || type === 'scl') {
                return this.loadDiskImage(data, type, fileName);
            }

            return this.loadFileData(data, fileName);
        }

        // Load TRD/SCL disk image - inserts disk into Beta Disk interface
        loadDiskImage(data, type, fileName) {
            const originalType = type;  // Preserve original format name for display
            let processedData = data;

            // For SCL files, convert to TRD first so boot injection can work
            if (type === 'scl') {
                processedData = this.betaDisk.sclToTrd(processedData);
                type = 'trd';
            }

            // Apply boot injection callback if configured
            if (this.onBeforeTrdLoad) {
                processedData = this.onBeforeTrdLoad(processedData, fileName);
            }

            const files = TRDLoader.listFiles(processedData);

            if (files.length === 0) {
                throw new Error('No files found in disk image');
            }

            // Store disk image for project save and TR-DOS trap access
            this.loadedMedia = {
                type: 'trd',
                data: new Uint8Array(processedData),
                name: fileName
            };
            this.loadedDiskFiles = files;  // Keep file list for TR-DOS operations

            // Load disk into Beta Disk interface (already TRD format)
            this.betaDisk.loadDisk(processedData, 'trd');

            // Set up TR-DOS trap handler with disk data (fallback)
            this.trdosTrap.setDisk(this.loadedMedia.data, files, type);

            // Request switch to Pentagon if Beta Disk not available on current machine
            // No switch needed if: Pentagon mode OR (Beta Disk enabled AND TR-DOS ROM loaded)
            const betaDiskAvailable = this.profile.betaDiskDefault ||
                (this.betaDiskEnabled && this.memory.hasTrdosRom());
            const needsMachineSwitch = !betaDiskAvailable;

            // Return disk inserted result - no file selection needed
            // User can use TR-DOS commands (LIST, LOAD, RUN) to interact with disk
            return {
                diskInserted: true,
                diskType: originalType,  // Original format name for display (SCL or TRD)
                _diskType: 'trd',        // Internal: always TRD (SCL converted)
                diskName: fileName,
                fileCount: files.length,
                _diskData: processedData,
                _diskFiles: files,
                needsMachineSwitch: needsMachineSwitch,
                targetMachine: 'pentagon'
            };
        }

        // Load DSK disk image - inserts disk into µPD765 FDC (+3)
        loadDSKImage(data, fileName) {
            if (!this.fdc) {
                throw new Error('DSK files require ZX Spectrum +3 (no FDC on this machine)');
            }

            const dskImage = DSKLoader.parse(data);
            const files = DSKLoader.listFiles(dskImage);

            // Insert disk into drive 0
            this.fdc.drives[0].disk = dskImage;

            // Store for project save and catalog display
            this.loadedMedia = {
                type: 'dsk',
                data: new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data)),
                name: fileName
            };
            this.loadedDiskFiles = files;

            return {
                isDSK: true,
                diskInserted: true,
                diskType: 'dsk',
                diskName: fileName,
                fileCount: files.length,
                _dskImage: dskImage,
                _diskFiles: files,
                needsMachineSwitch: this.machineType !== '+3',
                targetMachine: '+3'
            };
        }

        // Boot +3 from disk
        // Reset machine, preserve disk in FDC, and let +3 ROM auto-detect disk
        bootPlus3Disk() {
            if (!this.fdc) {
                console.warn('[+3] Cannot boot disk: no FDC');
                return false;
            }

            // Save disk state before reset
            const disk = this.fdc.drives[0].disk;

            // Full machine reset
            this.stop();
            this.reset();

            // Restore disk after reset
            if (disk) {
                this.fdc.drives[0].disk = disk;
            }

            // Turn motor on (bit 3 of port 0x1FFD)
            this.fdc.setMotor(true);

            // +3 ROM at address 0 auto-detects and boots from disk
            this.cpu.pc = 0;

            return true;
        }

        // Boot into TR-DOS mode
        // Uses the FUSE-style approach: reset machine, select ROM bank 1,
        // page in TR-DOS ROM, and let it run from address 0.
        // The TR-DOS ROM has its own initialization at address 0 that properly
        // sets up system variables, channels, and workspace — much more reliable
        // than manually constructing system variables.
        bootTrdos() {
            // Check if TR-DOS ROM is loaded
            if (!this.memory.hasTrdosRom()) {
                console.warn('[TR-DOS] Cannot boot TR-DOS: TR-DOS ROM not loaded');
                return false;
            }

            // Check if Beta Disk is available (Pentagon or enabled via setting)
            if (this.machineType !== 'pentagon' && !this.betaDiskEnabled) {
                console.warn('[TR-DOS] Cannot boot TR-DOS: Beta Disk not enabled');
                return false;
            }

            // Save disk state before reset (spectrum.reset() doesn't touch betaDisk,
            // but be safe in case that changes)
            const diskState = this.betaDisk ? {
                hasDisk: this.betaDisk.hasDisk(),
                diskData: this.betaDisk.diskImage,
                diskType: this.betaDisk.diskType
            } : null;

            // Full machine reset — clears CPU, memory, ULA, tape state
            this.stop();
            this.reset();

            // Restore disk after reset
            if (diskState && diskState.hasDisk && diskState.diskData) {
                this.betaDisk.diskImage = diskState.diskData;
                this.betaDisk.diskType = diskState.diskType;
            }

            // Select BASIC ROM bank as background ROM.
            // TR-DOS auto-paging only re-activates when currentRomBank === basicRomBank.
            // On real Pentagon, the 128K menu switches to ROM bank 1 before entering TR-DOS.
            // On +2A, BASIC ROM is bank 3 (not bank 1).
            this.memory.currentRomBank = this.profile.basicRomBank;

            // Page in TR-DOS ROM and start from address 0.
            // The TR-DOS ROM at address 0x0000 contains its own initialization code
            // (similar to the Spectrum ROM NEW routine) that properly sets up all
            // system variables, channels, streams, screen, and BASIC workspace.
            // This is the same approach FUSE uses (beta128_48boot mode).
            this.memory.trdosActive = true;
            this.cpu.pc = 0;

            return true;
        }

        // Load a specific file from disk image
        loadDiskFile(diskData, fileInfo, diskType) {
            const Loader = diskType === 'trd' ? TRDLoader : SCLLoader;
            const fileData = Loader.extractFile(diskData, fileInfo);

            // In Pentagon mode with TR-DOS ROM + disk, don't auto-boot
            // Just return info so user can select TR-DOS from menu manually
            // The disk is already loaded in betaDisk
            if (this.profile.betaDiskDefault && this.betaDisk.hasDisk() && this.memory.hasTrdosRom()) {
                // Start emulator if not running
                if (!this.running) {
                    this.start();
                }

                return {
                    diskFile: true,
                    diskType: diskType,
                    fileName: fileInfo.fullName,
                    fileType: fileInfo.type,
                    start: fileInfo.start,
                    length: fileData.length,
                    useTrdos: true,
                    manualBoot: true,  // Indicates user needs to select TR-DOS from menu
                    trdosCommand: fileInfo.name.toLowerCase().startsWith('boot') ?
                        'RUN' : `RUN "${fileInfo.name}"`
                };
            }

            // Fallback for non-Pentagon mode: CODE files load directly
            if (fileInfo.type === 'code') {
                const wasRunning = this.running;
                if (wasRunning) this.stop();

                // Load code directly at specified address
                for (let i = 0; i < fileData.length; i++) {
                    this.memory.write(fileInfo.start + i, fileData[i]);
                }

                // Render current screen
                const frameBuffer = this.ula.renderFrame();
                this.imageData.data.set(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);

                if (wasRunning) this.start();

                return {
                    diskFile: true,
                    diskType: diskType,
                    fileName: fileInfo.fullName,
                    fileType: fileInfo.type,
                    start: fileInfo.start,
                    length: fileData.length
                };
            }

            // Fallback for BASIC files without Pentagon: use TAP mechanism
            if (fileInfo.type === 'basic') {
                const wasRunning = this.running;
                if (wasRunning) this.stop();

                // Convert to TAP format for reliable loading via ROM
                const tapData = Loader.fileToTAP(fileData, fileInfo);
                this.tapeLoader.load(tapData.buffer);
                this.tapeTrap.setTape(this.tapeLoader);

                // Inject LOAD "" command into the input buffer to auto-trigger loading
                // The Spectrum's edit line is at E_LINE, we'll put LOAD "" there
                const elineAddr = this.memory.read(0x5C59) | (this.memory.read(0x5C5A) << 8);

                // LOAD "" in tokenized form: 0xEF (LOAD) 0x22 (") 0x22 (") 0x0D (ENTER)
                this.memory.write(elineAddr, 0xEF);     // LOAD token
                this.memory.write(elineAddr + 1, 0x22); // "
                this.memory.write(elineAddr + 2, 0x22); // "
                this.memory.write(elineAddr + 3, 0x0D); // ENTER

                // Update K_CUR to end of command (cursor position)
                this.memory.write(0x5C5B, (elineAddr + 3) & 0xFF);
                this.memory.write(0x5C5C, ((elineAddr + 3) >> 8) & 0xFF);

                // Trigger the command by setting PC to the LINE-RUN routine
                // The ROM's main loop at 0x1B76 checks for ENTER key
                // We'll jump to 0x0F2C (MAIN-2) which processes the edit line
                // Or use 0x1B17 (LINE-NEW) to execute the current line
                this.cpu.pc = 0x1B17;  // LINE-NEW: execute current edit line

                // Render current screen
                const frameBuffer = this.ula.renderFrame();
                this.imageData.data.set(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);

                if (wasRunning) this.start();

                return {
                    diskFile: true,
                    diskType: diskType,
                    fileName: fileInfo.fullName,
                    fileType: fileInfo.type,
                    start: autostart,
                    length: fileData.length,
                    autoload: true  // Auto-loading via injected LOAD ""
                };
            }

            // For other file types, convert to TAP (limited compatibility)
            const tapData = Loader.fileToTAP(fileData, fileInfo);
            this.tapeLoader.load(tapData.buffer);
            this.tapeTrap.setTape(this.tapeLoader);

            return {
                diskFile: true,
                diskType: diskType,
                fileName: fileInfo.fullName,
                fileType: fileInfo.type,
                start: fileInfo.start,
                length: fileData.length,
                blocks: this.tapeLoader.getBlockCount()
            };
        }

        // Load from disk image selection result
        loadFromDiskSelection(diskResult, index) {
            const fileInfo = diskResult._diskFiles[index];
            return this.loadDiskFile(diskResult._diskData, fileInfo, diskResult._diskType || diskResult.diskType);
        }

        // Load from pre-extracted data (used after ZIP selection)
        loadFileData(data, fileName) {
            const type = this.snapshotLoader.detectType(data, fileName);
            switch (type) {
                case 'sna': return this.loadSnapshot(data);
                case 'z80': return this.loadZ80Snapshot(data);
                case 'szx': return this.loadSZXSnapshot(data);
                case 'tap': return this.loadTape(data, fileName);  // Store TAP with name
                case 'tzx': return this.loadTZX(data, fileName);  // Store TZX with name
                case 'dsk':
                    return this.loadDSKImage(data, fileName);
                case 'trd':
                case 'scl':
                    return this.loadDiskImage(data, type, fileName);
                case 'rzx': throw new Error('Use loadRZX for RZX files');
                default: throw new Error('Unknown file format');
            }
        }

        // Load specific file from ZIP selection result
        loadFromZipSelection(zipResult, index) {
            const file = zipResult._zipFiles[index];
            return this.loadFileData(file.data, file.name);
        }
        
        loadZ80Snapshot(data) {
            const wasRunning = this.running;
            if (wasRunning) this.stop();
            
            try {
                // First pass to detect machine type
                const bytes = new Uint8Array(data);
                let targetType = '48k';

                // Check if v2/v3 by PC at offset 6
                const pc = bytes[6] | (bytes[7] << 8);
                if (pc === 0 && bytes.length > 34) {
                    const extHeaderLen = bytes[30] | (bytes[31] << 8);
                    const hwMode = bytes[34];
                    // Pentagon (hwMode 9) can appear in both V2 and V3
                    if (hwMode === 9) {
                        targetType = 'pentagon';
                    } else if (extHeaderLen === 23) {
                        // V2: hwMode 3=128K, 4=128K+IF1
                        if (hwMode === 3 || hwMode === 4) targetType = '128k';
                    } else {
                        // V3: 4=128K, 5=128K+IF1, 6=128K+MGT, 7=+3, 12=+2, 13=+2A
                        if (hwMode === 12) targetType = '+2';
                        else if (hwMode >= 4 && hwMode <= 7) targetType = '128k';
                        else if (hwMode === 13) targetType = '+2a';
                    }
                }

                // Switch machine type if needed
                if (targetType !== this.machineType) {
                    this.setMachineType(targetType, true);
                }

                const result = this.snapshotLoader.loadZ80(data, this.cpu, this.memory);
                result.machineType = targetType;  // Add machine type to result for ROM reload

                // Reset frame timing state to avoid stale state from previous program
                this.frameStartOffset = 0;
                this.accumulatedContention = 0;
                this.pendingInt = false;
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;

                // Reset ULA screen bank switching state to avoid frozen display
                this.ula.hadScreenBankChanges = false;
                this.ula.deferPaperRendering = false;
                this.ula.screenBankChanges = [{tState: 0, bank: this.memory.screenBank || 5}];

                this.ula.setBorder(result.border);
                // Initialize frame state for beam mode, but clear attrInitial
                // since we don't know the true frame-start values after loading a snapshot
                this.ula.startFrame();
                this.ula.attrInitial = null;  // Force use of current memory values
                const frameBuffer = this.ula.renderFrame();
                this.imageData.data.set(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);
                if (wasRunning) this.start();
                return result;
            } catch (e) {
                if (wasRunning) this.start();
                throw e;
            }
        }

        loadSZXSnapshot(data) {
            const wasRunning = this.running;
            if (wasRunning) this.stop();

            try {
                // Parse SZX to get machine type
                const info = SZXLoader.parse(data);

                // Determine target machine type
                let targetType = info.machineType;
                if (targetType === '+2A') {
                    targetType = '+2a';  // Map SZX name to internal type
                } else if (targetType === '+3' || targetType === '+3e') {
                    targetType = '+2a';  // +3 is hardware-identical to +2A (minus floppy)
                } else if (targetType === 'scorpion' || targetType === 'didaktik') {
                    targetType = '128k';  // Treat other 128K clones as 128K
                } else if (targetType === '16k') {
                    targetType = '48k';
                }

                // Switch machine type if needed
                if (targetType !== this.machineType) {
                    this.setMachineType(targetType, true);
                }

                // Load SZX
                const result = SZXLoader.load(data, this.cpu, this.memory, this.ula);
                result.machineType = targetType;  // Add machine type to result for ROM reload

                // Debug: verify ROM is correct (first byte at 0x38 should be F5 for 48K)
                const romCheck = this.memory.read(0x38);
                if (romCheck !== 0xF5) {
                    console.warn(`SZX: ROM may be wrong at 0x38: got ${romCheck.toString(16)}, expected f5`);
                }

                // Reset frame timing state to avoid stale state from previous program
                this.frameStartOffset = 0;
                this.accumulatedContention = 0;
                this.pendingInt = false;
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;

                // Reset ULA screen bank switching state to avoid frozen display
                // (previous program's deferred rendering state must not persist)
                this.ula.hadScreenBankChanges = false;
                this.ula.deferPaperRendering = false;
                this.ula.screenBankChanges = [{tState: 0, bank: this.memory.screenBank || 5}];

                // Initialize frame state for beam mode, but clear attrInitial
                // since we don't know the true frame-start values after loading a snapshot
                this.ula.startFrame();
                this.ula.attrInitial = null;  // Force use of current memory values
                // Update display
                const frameBuffer = this.ula.renderFrame();
                this.imageData.data.set(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);

                if (wasRunning) this.start();
                return result;
            } catch (e) {
                if (wasRunning) this.start();
                throw e;
            }
        }

        loadSnapshot(data) {
            const wasRunning = this.running;
            if (wasRunning) this.stop();

            // Detect snapshot type before loading
            const bytes = new Uint8Array(data);
            const is128k = bytes.length > 49179;

            // Determine target machine type
            // Pentagon uses same snapshot format as 128K, so preserve it
            let targetType;
            if (is128k) {
                // Keep Pentagon/+2 if already set, otherwise use 128K
                targetType = this.machineType === 'pentagon' ? 'pentagon' : (is128kCompat(this.machineType) ? this.machineType : '128k');
            } else {
                targetType = '48k';
            }

            // Switch machine type if needed
            if (targetType !== this.machineType) {
                this.setMachineType(targetType, true);
            }

            try {
                const result = this.snapshotLoader.loadSNA(data, this.cpu, this.memory);
                result.machineType = targetType; // Ensure correct type is returned

                // Reset frame timing state to avoid stale state from previous program
                this.frameStartOffset = 0;
                this.accumulatedContention = 0;
                this.pendingInt = false;
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;

                this.ula.setBorder(result.border);
                // Initialize frame state for beam mode, but clear attrInitial
                // since we don't know the true frame-start values after loading a snapshot
                this.ula.startFrame();
                this.ula.attrInitial = null;  // Force use of current memory values
                const frameBuffer = this.ula.renderFrame();
                this.imageData.data.set(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);
                if (wasRunning) this.start();
                return result;
            } catch (e) {
                if (wasRunning) this.start();
                throw e;
            }
        }

        loadTape(data, storeName = null) {
            if (!this.tapeLoader.load(data)) throw new Error('Failed to parse TAP file');
            this.tapeTrap.setTape(this.tapeLoader);

            // Initialize TapePlayer for real-time playback
            this.tapePlayer.loadFromTapeLoader(this.tapeLoader);

            // Reset debug counters for fresh logging after TAP load
            this._floatBusLogCount = 0;
            this._intDebugCount = 0;
            this._floatBusLogActive = false; // Wait for halted INT to activate

            // Store original TAP data for project save (if not from disk conversion)
            if (storeName) {
                this.loadedMedia = {
                    type: 'tap',
                    data: new Uint8Array(data),
                    name: storeName
                };
            }

            return { blocks: this.tapeLoader.getBlockCount() };
        }

        loadTZX(data, storeName = null) {
            // Clear any pending turbo block state from previous load
            this._turboBlockPending = false;

            if (!this.tzxLoader) {
                this.tzxLoader = new TZXLoader();
            }

            if (!this.tzxLoader.load(data)) {
                throw new Error('Failed to parse TZX file');
            }

            // TZXLoader provides blocks in unified format
            // Load directly into TapePlayer for real-time playback
            this.tapePlayer.loadBlocks(this.tzxLoader.blocks);

            // For flash load mode, only standard-timed data blocks can use ROM trap
            // Turbo blocks have non-standard timing and must use real-time playback
            const isStandardTiming = (b) => {
                // Standard ROM loader timing (with small tolerance)
                const stdPilot = 2168, stdZero = 855, stdOne = 1710;
                const tolerance = 50;  // Allow small variations
                return (!b.pilotPulse || Math.abs(b.pilotPulse - stdPilot) < tolerance) &&
                       (!b.zeroPulse || Math.abs(b.zeroPulse - stdZero) < tolerance) &&
                       (!b.onePulse || Math.abs(b.onePulse - stdOne) < tolerance);
            };

            // Convert compatible blocks to TapeLoader format, tracking their
            // positions in the full block array for correct tapePlayer positioning
            const allBlocks = this.tzxLoader.blocks;
            const tapCompatibleBlocks = [];
            const standardBlockMap = [];  // standardBlockMap[tapeLoaderIdx] = full array idx
            const standardBlockSet = new Set();
            for (let i = 0; i < allBlocks.length; i++) {
                const b = allBlocks[i];
                if (b.type === 'data' && !b.noPilot && isStandardTiming(b)) {
                    standardBlockSet.add(i);
                    standardBlockMap.push(i);
                    tapCompatibleBlocks.push({ flag: b.flag, data: b.data, length: b.length });
                }
            }

            if (tapCompatibleBlocks.length > 0) {
                this.tapeLoader.blocks = tapCompatibleBlocks;
                this.tapeLoader.currentBlock = 0;
                this.tapeTrap.setTape(this.tapeLoader);

                const hasTurboBlocks = allBlocks.length > tapCompatibleBlocks.length;

                if (hasTurboBlocks) {
                    // Set up callback to switch to real-time when next tape block is non-standard.
                    // Standard blocks can be interleaved with turbo (e.g. std,std,std,turbo,turbo,std)
                    // so we trigger as soon as the next block in tape order isn't standard.
                    this.tapeTrap.onBlockLoaded = (loadedBlockIndex) => {
                        const fullIdx = standardBlockMap[loadedBlockIndex];
                        const nextFullIdx = fullIdx + 1;
                        console.log('[TZX] onBlockLoaded: tapeLoader index', loadedBlockIndex,
                            '→ fullIdx', fullIdx, ', nextFullIdx', nextFullIdx,
                            ', nextIsStandard', standardBlockSet.has(nextFullIdx));
                        // Trigger if next block in tape sequence is non-standard
                        if (nextFullIdx < allBlocks.length && !standardBlockSet.has(nextFullIdx)) {
                            this.tapePlayer.setBlock(nextFullIdx);
                            this._turboBlockPending = true;
                            console.log('[TZX] Turbo pending! tapePlayer positioned at block', nextFullIdx);
                        }
                    };
                } else {
                    this.tapeTrap.onBlockLoaded = null;
                    this._turboBlockPending = false;
                }
            } else {
                this.tapeTrap.onBlockLoaded = null;
                this._turboBlockPending = false;
            }

            // Reset debug counters
            this._floatBusLogCount = 0;
            this._intDebugCount = 0;
            this._floatBusLogActive = false;

            // Store original TZX data for project save
            if (storeName) {
                this.loadedMedia = {
                    type: 'tzx',
                    data: new Uint8Array(data),
                    name: storeName
                };
            }

            return {
                blocks: this.tzxLoader.getBlockCount(),
                version: this.tzxLoader.version
            };
        }

        // ========== Media Management ==========

        getLoadedMedia() {
            return this.loadedMedia;
        }

        setLoadedMedia(media) {
            this.loadedMedia = media;
            // Restore tape/disk if present
            if (media && media.data) {
                if (media.type === 'tap') {
                    this.tapeLoader.load(media.data.buffer);
                    this.tapeTrap.setTape(this.tapeLoader);
                    this.tapePlayer.loadFromTapeLoader(this.tapeLoader);
                } else if (media.type === 'tzx') {
                    this.loadTZX(media.data.buffer, null);  // Don't re-store
                }
                // For TRD/SCL, data is stored but not pre-loaded
                // User can load additional files via ROM trap or manual selection
            }
        }

        clearLoadedMedia() {
            this.loadedMedia = null;
        }

        // Tape position for project save/restore
        getTapeBlock() {
            return this.tapeLoader.getCurrentBlock();
        }

        setTapeBlock(n) {
            this.tapeLoader.setCurrentBlock(n);
        }

        rewindTape() {
            this.tapeLoader.rewind();
            this.tapePlayer.rewind();
        }

        // ========== Real-time Tape Playback ==========

        /**
         * Set tape load mode
         * @param {boolean} flash - true for flash load (instant), false for real-time
         */
        setTapeFlashLoad(flash) {
            this.tapeFlashLoad = flash;
            // Disable tape trap when using real-time loading
            this.tapeTrap.setEnabled(this.tapeTrapsEnabled && flash);
        }

        /**
         * Get current tape load mode
         */
        getTapeFlashLoad() {
            return this.tapeFlashLoad;
        }

        /**
         * Start real-time tape playback
         */
        playTape() {
            if (this.tapeFlashLoad) return false;
            this._lastTapeUpdate = this.cpu.tStates;  // Reset tape timing tracker
            return this.tapePlayer.play();
        }

        /**
         * Stop real-time tape playback
         */
        stopTape() {
            this.tapePlayer.stop();
            this.tapeEarBit = false;
            this._turboBlockPending = false;
        }

        /**
         * Check if tape is playing
         */
        isTapePlaying() {
            return this.tapePlayer.isPlaying();
        }

        /**
         * Get tape playback position info
         */
        getTapePosition() {
            return this.tapePlayer.getPosition();
        }

        /**
         * Set tape block for real-time player
         */
        setTapePlayerBlock(n) {
            this.tapePlayer.setBlock(n);
        }
        
        saveSnapshot(format = 'sna') {
            switch (format.toLowerCase()) {
                case 'z80':
                    return this.snapshotLoader.createZ80(this.cpu, this.memory, this.ula.borderColor);
                case 'szx':
                    return SZXLoader.create(this.cpu, this.memory, this.ula.borderColor);
                case 'sna':
                default:
                    return this.snapshotLoader.createSNA(this.cpu, this.memory, this.ula.borderColor);
            }
        }
        
        getState() {
            return {
                cpu: {
                    pc: this.cpu.pc, sp: this.cpu.sp, af: this.cpu.af,
                    bc: this.cpu.bc, de: this.cpu.de, hl: this.cpu.hl,
                    ix: this.cpu.ix, iy: this.cpu.iy, i: this.cpu.i, r: this.cpu.r,
                    iff1: this.cpu.iff1, iff2: this.cpu.iff2, im: this.cpu.im, halted: this.cpu.halted
                },
                memory: this.memory.getPagingState(),
                ula: { border: this.ula.borderColor, flash: this.ula.flashState },
                running: this.running, fps: this.actualFps
            };
        }
        
        peek(addr) { return this.memory.read(addr); }
        poke(addr, val) { this.memory.write(addr, val); }

        // ========== Machine Type ==========

        setMachineType(type, preserveRom = false) {
            const wasRunning = this.running;
            if (wasRunning) this.stop();

            // Track old machine type for ROM compatibility check
            this._lastMachineType = this.machineType;

            // Save ROM data if preserving
            const oldRom = preserveRom && this.romLoaded ? this.memory.rom : null;

            // Save ULA settings before creating new ULA
            const oldFullBorderMode = this.ula ? this.ula.fullBorderMode : false;
            const oldPalette = this.ula ? this.ula.palette : null;
            const oldPaletteId = this.ula ? this.ula.paletteId : null;
            const oldUlaplusEnabled = this.ula ? this.ula.ulaplus.enabled : false;

            this.machineType = type;
            this.profile = getMachineProfile(type);
            this.ayEnabled = this.profile.ayDefault;  // Update AY enabled state for new machine type
            if (this.ay) this.ay.reset();  // Stop any playing AY sound
            this.memory = new Memory(type);
            this.ula = new ULA(this.memory, type);
            this.cpu = new Z80(this.memory);
            this.ula.cpu = this.cpu;  // For debug access to CPU state
            this.cpu.portRead = this.portRead.bind(this);
            this.cpu.portWrite = this.portWrite.bind(this);
            this.setupContention();  // Setup contention for new machine type
            this.timing = this.ula.getTiming();

            // Restore ULA settings to new ULA
            if (this.lateTimings !== undefined) {
                this.ula.setLateTimings(this.lateTimings);
            }
            if (oldFullBorderMode) {
                this.ula.setFullBorder(oldFullBorderMode);
            }
            if (oldPalette) {
                this.ula.palette = oldPalette;
                this.ula.paletteId = oldPaletteId;
            }
            // Restore ULAplus enabled state (checkbox) but reset palette to defaults
            this.ula.ulaplus.enabled = oldUlaplusEnabled;
            this.ula.resetULAplus();  // Reset palette, paletteEnabled, register to defaults
            this.updateDisplayDimensions();  // Recreate imageData for new ULA dimensions
            this.tapeTrap = new TapeTrapHandler(this.cpu, this.memory, this.tapeLoader);
            this.tapeTrap.setEnabled(this.tapeTrapsEnabled && this.tapeFlashLoad);

            // Recreate TR-DOS trap with new CPU/memory, preserve disk data
            const oldDiskData = this.trdosTrap ? this.trdosTrap.diskData : null;
            const oldDiskFiles = this.trdosTrap ? this.trdosTrap.diskFiles : null;
            const oldDiskType = this.trdosTrap ? this.trdosTrap.diskType : null;
            this.trdosTrap = new TRDOSTrapHandler(this.cpu, this.memory);
            this.trdosTrap.setEnabled(this.tapeTrapsEnabled);
            if (oldDiskData) {
                this.trdosTrap.setDisk(oldDiskData, oldDiskFiles, oldDiskType);
            }

            // Re-setup memory callbacks based on current feature state
            this.updateMemoryCallbacksFlag();

            // Update Beta Disk paging flag for new machine type
            this.updateBetaDiskPagingFlag();

            // Recreate FDC for new machine type
            this.fdc = this.profile.hasFDC ? new UPD765() : null;

            // Restore ROM data
            if (oldRom) {
                const machineTypeChanged = this._lastMachineType !== type;

                // When machine type changes, don't try to reuse ROMs - require proper reload
                // Different machine ROMs are not interchangeable (even 128K bank 1 vs 48K ROM can differ)
                if (machineTypeChanged) {
                    this.romLoaded = false;
                    // Don't auto-start without ROM
                } else {
                    // Same machine type - copy all ROM banks
                    for (let i = 0; i < this.memory.rom.length; i++) {
                        if (oldRom[i] && this.memory.rom[i]) {
                            this.memory.rom[i].set(oldRom[i]);
                        }
                    }
                    this.romLoaded = true;
                    if (wasRunning) this.start();
                }
            } else {
                this.romLoaded = false;
                // Don't auto-start without ROM - caller must load ROM and start manually
            }
        }

        // ========== RZX Playback ==========

        async loadRZX(data, skipSnapshot = false) {
            const rzx = new RZXLoader();
            await rzx.parse(data);

            if (!rzx.getSnapshot()) {
                throw new Error('RZX file has no embedded snapshot');
            }

            // Load the embedded snapshot (unless restoring from project)
            if (!skipSnapshot) {
                const snapData = rzx.getSnapshot();
                const snapType = rzx.getSnapshotType();

                // Create a proper ArrayBuffer (snapData might be a view with byteOffset)
                const snapBuffer = snapData.buffer.slice(
                    snapData.byteOffset,
                    snapData.byteOffset + snapData.byteLength
                );

                if (snapType === 'z80') {
                    this.loadZ80Snapshot(snapBuffer);
                } else if (snapType === 'sna') {
                    this.loadSnapshot(snapBuffer);
                } else if (snapType === 'szx') {
                    this.loadSZXSnapshot(snapBuffer);
                } else {
                    throw new Error('Unsupported snapshot type in RZX: ' + snapType);
                }

            }

            // Store original data for project save
            this.rzxData = new Uint8Array(data);

            // Setup RZX playback
            this.rzxPlayer = rzx;
            this.rzxPlayer.reset();  // Reset all frame inputIndex values
            this.rzxFrame = 0;
            this.rzxInstructions = 0;  // Start at beginning of frame 0
            this.rzxFrameStartInstr = this.cpu.instructionCount;
            this.rzxFirstInterrupt = true;  // Don't advance on first interrupt
            this.rzxPlaying = true;
            this.rzxDebugLog = [];  // Reset debug log for new playback

            // Reset input state to prevent stale inputs affecting playback
            this.kempstonState = 0;
            this.gamepadState = 0;
            this.gamepadExtState = 0;
            this.kempstonExtendedState = 0;

            this.rzxRecentInputs = [];
            this.portLog = [];
            this._rzxPcLogCount = 0;

            return {
                frames: rzx.getFrameCount(),
                creator: rzx.creatorInfo,
                machineType: this.machineType,
                needsRomReload: !this.romLoaded
            };
        }

        rzxStop() {
            this.rzxPlaying = false;
            this.rzxPlayer = null;
            this.rzxFrame = 0;
            this.rzxInstructions = 0;
            this.rzxFrameStartInstr = 0;
            this.rzxFirstInterrupt = true;
            this.rzxData = null;
            this.rzxRecentInputs = [];
        }

        // Enable detailed RZX debug logging for first N frames
        // Usage from console: spectrum.rzxEnableDebug(100)
        rzxEnableDebug(frames = 100) {
            this.rzxDebugFrames = frames;
            this.rzxDebugLog = [];
            console.log(`RZX debug enabled for first ${frames} frames. Reload RZX to start logging.`);
        }

        // Get collected debug log as JSON string (for comparison with other emulators)
        // Usage from console: spectrum.rzxGetDebugLog()
        rzxGetDebugLog() {
            return JSON.stringify(this.rzxDebugLog, null, 2);
        }

        // Export debug log to file
        rzxExportDebugLog() {
            const json = this.rzxGetDebugLog();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'rzx_debug_log.json';
            a.click();
            URL.revokeObjectURL(url);
            console.log(`Exported ${this.rzxDebugLog.length} frames to rzx_debug_log.json`);
        }

        isRZXPlaying() {
            return this.rzxPlaying;
        }

        getRZXFrame() {
            return this.rzxFrame;
        }

        setRZXFrame(frame) {
            this.rzxFrame = frame;
        }

        getRZXTotalFrames() {
            return this.rzxPlayer ? this.rzxPlayer.getFrameCount() : 0;
        }

        getRZXData() {
            return this.rzxData;
        }

        getRZXInstructions() {
            return this.rzxInstructions;
        }

        setRZXInstructions(count) {
            this.rzxInstructions = count;
            this.rzxFrameStartInstr = this.cpu.instructionCount;
        }

        // ========== RZX Recording ==========

        /**
         * Start RZX recording - recording actually begins at next frame boundary
         */
        rzxStartRecording() {
            // Stop any active RZX playback first
            if (this.rzxPlaying) {
                this.rzxStop();
            }

            // Set pending flag - actual recording starts after next interrupt fires
            this.rzxRecordPending = true;
            this.rzxRecordedFrames = [];
            this.rzxRecordSnapshot = null;
            this.rzxRecordSnapshotType = 'szx';  // SZX preserves halted state

            return true;
        }

        /**
         * Actually start recording (called at frame boundary)
         */
        rzxStartRecordingNow() {
            // Log CPU state for debugging RZX compatibility
            // Use SZX format for RZX recording - it properly preserves halted state
            this.rzxRecordSnapshot = this.createSZXSnapshot();
            this.rzxRecordSnapshotType = 'szx';
            this.rzxRecordTstates = this.cpu.tStates;

            // Initialize recording state
            this.rzxRecordCurrentFrame = { fetchCount: 0, inputs: [] };
            this.rzxRecordStartInstr = this.cpu.instructionCount;
            this.rzxRecording = true;
            this.rzxRecordPending = false;
        }

        /**
         * Stop RZX recording
         */
        rzxStopRecording() {
            if (!this.rzxRecording && !this.rzxRecordPending) {
                return null;
            }

            // If still pending (recording never actually started), just cancel
            if (this.rzxRecordPending && !this.rzxRecording) {
                this.rzxRecordPending = false;
                console.log('[RZX REC] Recording was pending, cancelled');
                return { frames: 0, snapshot: null, snapshotType: null };
            }

            // Finalize current frame if it has any content
            if (this.rzxRecordCurrentFrame && this.rzxRecordCurrentFrame.inputs.length > 0) {
                const fetchCount = this.cpu.instructionCount - this.rzxRecordStartInstr;
                this.rzxRecordCurrentFrame.fetchCount = fetchCount;
                this.rzxRecordedFrames.push(this.rzxRecordCurrentFrame);
            }

            this.rzxRecording = false;
            this.rzxRecordPending = false;
            this.rzxRecordCurrentFrame = null;

            console.log(`[RZX REC] Stopped recording. ${this.rzxRecordedFrames.length} frames captured.`);

            return {
                frames: this.rzxRecordedFrames.length,
                snapshot: this.rzxRecordSnapshot,
                snapshotType: this.rzxRecordSnapshotType
            };
        }

        /**
         * Cancel RZX recording without saving
         */
        rzxCancelRecording() {
            this.rzxRecording = false;
            this.rzxRecordPending = false;
            this.rzxRecordedFrames = [];
            this.rzxRecordCurrentFrame = null;
            this.rzxRecordSnapshot = null;
            this.rzxRecordStartInstr = 0;
            console.log('[RZX REC] Recording cancelled');
        }

        /**
         * Check if RZX recording is active or pending
         */
        isRZXRecording() {
            return this.rzxRecording || this.rzxRecordPending;
        }

        /**
         * Get recorded RZX frame count
         */
        getRZXRecordedFrameCount() {
            return this.rzxRecordedFrames.length;
        }

        /**
         * Save recorded RZX to file
         * @returns {Uint8Array} RZX file data
         */
        rzxSaveRecording() {
            if (this.rzxRecordedFrames.length === 0) {
                console.warn('No frames recorded');
                return null;
            }

            // Build RZX file
            const rzxData = this.buildRZXFile(
                this.rzxRecordSnapshot,
                this.rzxRecordSnapshotType,
                this.rzxRecordedFrames
            );

            console.log(`[RZX REC] Saved RZX: ${rzxData.length} bytes, ${this.rzxRecordedFrames.length} frames`);
            return rzxData;
        }

        /**
         * Build RZX file from recorded data
         */
        buildRZXFile(snapshot, snapshotType, frames) {
            // RZX file structure:
            // - Header (10 bytes): "RZX!" + version (0.13) + flags
            // - Creator block (29+ bytes)
            // - Snapshot block (variable)
            // - Input recording block (variable)

            const chunks = [];

            // 1. RZX Header
            const header = new Uint8Array(10);
            header[0] = 0x52; // 'R'
            header[1] = 0x5A; // 'Z'
            header[2] = 0x58; // 'X'
            header[3] = 0x21; // '!'
            header[4] = 0x00; // Major version
            header[5] = 0x0D; // Minor version (13 = 0.13)
            header[6] = 0x00; // Flags (little-endian DWORD)
            header[7] = 0x00;
            header[8] = 0x00;
            header[9] = 0x00;
            chunks.push(header);

            // 2. Creator block (ID = 0x10)
            const creatorName = 'ZX-M8XXX';
            const creatorBlock = new Uint8Array(29);
            creatorBlock[0] = 0x10; // Block ID
            // Block length INCLUDES the 5-byte header (ID + length field)
            const creatorLen = 29; // 5 (header) + 20 (name) + 2 (version) + 2 (custom data length = 0)
            creatorBlock[1] = creatorLen & 0xFF;
            creatorBlock[2] = (creatorLen >> 8) & 0xFF;
            creatorBlock[3] = (creatorLen >> 16) & 0xFF;
            creatorBlock[4] = (creatorLen >> 24) & 0xFF;
            // Creator ID (20 bytes, null-padded)
            for (let i = 0; i < 20; i++) {
                creatorBlock[5 + i] = i < creatorName.length ? creatorName.charCodeAt(i) : 0;
            }
            // Version (major, minor) - parse from APP_VERSION (defined in index.html)
            const versionParts = (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '0.0.0').split('.');
            creatorBlock[25] = parseInt(versionParts[0], 10) || 0; // Major
            creatorBlock[26] = parseInt(versionParts[1], 10) || 0; // Minor
            // Custom data length (2 bytes, 0 = none)
            creatorBlock[27] = 0;
            creatorBlock[28] = 0;
            chunks.push(creatorBlock);

            // 3. Snapshot block (ID = 0x30)
            // Structure: ID(1) + Length(4) + Flags(4) + Extension(4) + UncompLen(4) + data
            const extBytes = new Uint8Array(4);
            const ext = snapshotType.toLowerCase();
            for (let i = 0; i < 4; i++) {
                extBytes[i] = i < ext.length ? ext.charCodeAt(i) : 0;
            }

            // Snapshot block header: ID(1) + Length(4) + Flags(4) + Extension(4) + UncompLen(4) = 17 bytes
            // Note: UncompLen included even for uncompressed - most emulators expect it
            const snapBlockHeader = new Uint8Array(17);
            snapBlockHeader[0] = 0x30; // Block ID
            const snapBlockLen = 17 + snapshot.length;
            snapBlockHeader[1] = snapBlockLen & 0xFF;
            snapBlockHeader[2] = (snapBlockLen >> 8) & 0xFF;
            snapBlockHeader[3] = (snapBlockLen >> 16) & 0xFF;
            snapBlockHeader[4] = (snapBlockLen >> 24) & 0xFF;
            // Flags (DWORD): bit 0 = compressed, bit 1 = external
            snapBlockHeader[5] = 0x00;
            snapBlockHeader[6] = 0x00;
            snapBlockHeader[7] = 0x00;
            snapBlockHeader[8] = 0x00;
            // Extension (4 bytes)
            snapBlockHeader[9] = extBytes[0];
            snapBlockHeader[10] = extBytes[1];
            snapBlockHeader[11] = extBytes[2];
            snapBlockHeader[12] = extBytes[3];
            // Uncompressed length (included for compatibility)
            snapBlockHeader[13] = snapshot.length & 0xFF;
            snapBlockHeader[14] = (snapshot.length >> 8) & 0xFF;
            snapBlockHeader[15] = (snapshot.length >> 16) & 0xFF;
            snapBlockHeader[16] = (snapshot.length >> 24) & 0xFF;
            chunks.push(snapBlockHeader);
            chunks.push(snapshot);

            // 4. Input recording block (ID = 0x80)
            // Build frame data first
            const frameDataChunks = [];
            for (const frame of frames) {
                // Each frame: fetchCount (2 bytes) + inputCount (2 bytes) + inputs
                const frameSize = 4 + frame.inputs.length;
                const frameData = new Uint8Array(frameSize);
                frameData[0] = frame.fetchCount & 0xFF;
                frameData[1] = (frame.fetchCount >> 8) & 0xFF;
                frameData[2] = frame.inputs.length & 0xFF;
                frameData[3] = (frame.inputs.length >> 8) & 0xFF;
                for (let i = 0; i < frame.inputs.length; i++) {
                    frameData[4 + i] = frame.inputs[i];
                }
                frameDataChunks.push(frameData);
            }

            // Concatenate frame data
            let frameDataLen = 0;
            for (const fd of frameDataChunks) {
                frameDataLen += fd.length;
            }
            const uncompressedFrameData = new Uint8Array(frameDataLen);
            let offset = 0;
            for (const fd of frameDataChunks) {
                uncompressedFrameData.set(fd, offset);
                offset += fd.length;
            }

            // Compress frame data using pako (like eric.rzx)
            let frameData;
            let isCompressed = false;
            if (typeof pako !== 'undefined') {
                try {
                    frameData = pako.deflate(uncompressedFrameData);
                    isCompressed = true;
                } catch (e) {
                    console.warn('[RZX] Compression failed, using uncompressed:', e);
                    frameData = uncompressedFrameData;
                }
            } else {
                frameData = uncompressedFrameData;
            }

            // Input block header (18 bytes)
            const inputBlockHeader = new Uint8Array(18);
            inputBlockHeader[0] = 0x80; // Block ID
            // Block length INCLUDES 5-byte header: 5 + frames(4) + reserved(1) + tstates(4) + flags(4) + frameData
            const inputBlockLen = 18 + frameData.length;
            inputBlockHeader[1] = inputBlockLen & 0xFF;
            inputBlockHeader[2] = (inputBlockLen >> 8) & 0xFF;
            inputBlockHeader[3] = (inputBlockLen >> 16) & 0xFF;
            inputBlockHeader[4] = (inputBlockLen >> 24) & 0xFF;
            // Number of frames (DWORD)
            inputBlockHeader[5] = frames.length & 0xFF;
            inputBlockHeader[6] = (frames.length >> 8) & 0xFF;
            inputBlockHeader[7] = (frames.length >> 16) & 0xFF;
            inputBlockHeader[8] = (frames.length >> 24) & 0xFF;
            // Reserved byte
            inputBlockHeader[9] = 0;
            // T-states at start (DWORD) - use captured value from recording start
            const tstatesStart = this.rzxRecordTstates || 0;
            inputBlockHeader[10] = tstatesStart & 0xFF;
            inputBlockHeader[11] = (tstatesStart >> 8) & 0xFF;
            inputBlockHeader[12] = (tstatesStart >> 16) & 0xFF;
            inputBlockHeader[13] = (tstatesStart >> 24) & 0xFF;
            // Flags (DWORD): bit 0 = protected, bit 1 = compressed
            inputBlockHeader[14] = isCompressed ? 0x02 : 0x00; // bit 1 = compressed (like eric.rzx)
            inputBlockHeader[15] = 0x00;
            inputBlockHeader[16] = 0x00;
            inputBlockHeader[17] = 0x00;
            chunks.push(inputBlockHeader);
            chunks.push(frameData);

            // Combine all chunks
            let totalLen = 0;
            for (const chunk of chunks) {
                totalLen += chunk.length;
            }
            const result = new Uint8Array(totalLen);
            offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }

            return result;
        }

        /**
         * Create Z80 snapshot of current state
         * @returns {Uint8Array} Z80 v3 format snapshot
         */
        createZ80Snapshot() {
            return this.snapshotLoader.createZ80(this.cpu, this.memory, this.ula.borderColor);
        }

        /**
         * Create SZX snapshot for RZX recording (preserves halted state)
         * @returns {Uint8Array} SZX format snapshot
         */
        createSZXSnapshot() {
            return SZXLoader.create(this.cpu, this.memory, this.ula.borderColor);
        }

        /**
         * Verify RZX structure and try to parse it back
         * @returns {object} Verification result
         */
        rzxVerifyRecording() {
            const data = this.rzxSaveRecording();
            if (!data) return { valid: false, error: 'No data' };

            try {
                const hex = (arr, start, len) => Array.from(arr.slice(start, start + len))
                    .map(b => b.toString(16).padStart(2, '0')).join(' ');

                // Check header
                const header = String.fromCharCode(data[0], data[1], data[2], data[3]);
                if (header !== 'RZX!') {
                    return { valid: false, error: 'Invalid header: ' + header };
                }

                console.log('[RZX VERIFY] Header: OK');
                console.log('[RZX VERIFY] Version:', data[4] + '.' + data[5]);
                console.log('[RZX VERIFY] Total size:', data.length, 'bytes');
                console.log('[RZX VERIFY] Header bytes:', hex(data, 0, 10));

                // Parse blocks
                let offset = 10;
                const blocks = [];
                while (offset < data.length - 5) {
                    const blockId = data[offset];
                    const blockLen = data[offset + 1] | (data[offset + 2] << 8) |
                                    (data[offset + 3] << 16) | (data[offset + 4] << 24);

                    const blockName = blockId === 0x10 ? 'Creator' :
                                     blockId === 0x30 ? 'Snapshot' :
                                     blockId === 0x80 ? 'Input' : `Unknown(0x${blockId.toString(16)})`;

                    console.log(`[RZX VERIFY] Block at ${offset}: ${blockName}, len=${blockLen}`);
                    console.log(`[RZX VERIFY]   Header bytes: ${hex(data, offset, Math.min(20, blockLen))}`);

                    if (blockId === 0x30) {
                        // Snapshot block details
                        const flags = data[offset + 5] | (data[offset + 6] << 8) |
                                     (data[offset + 7] << 16) | (data[offset + 8] << 24);
                        const ext = String.fromCharCode(data[offset + 9], data[offset + 10],
                                                       data[offset + 11], data[offset + 12]).replace(/\0/g, '');
                        console.log(`[RZX VERIFY]   Snapshot: flags=${flags}, ext="${ext}"`);
                        console.log(`[RZX VERIFY]   Snapshot data starts at offset ${offset + 13}, first bytes: ${hex(data, offset + 13, 16)}`);
                    }

                    if (blockId === 0x80) {
                        // Input block details
                        const numFrames = data[offset + 5] | (data[offset + 6] << 8) |
                                         (data[offset + 7] << 16) | (data[offset + 8] << 24);
                        const tstates = data[offset + 10] | (data[offset + 11] << 8) |
                                       (data[offset + 12] << 16) | (data[offset + 13] << 24);
                        const flags = data[offset + 14] | (data[offset + 15] << 8) |
                                     (data[offset + 16] << 16) | (data[offset + 17] << 24);
                        console.log(`[RZX VERIFY]   Input: frames=${numFrames}, tstates=${tstates}, flags=${flags}`);
                        console.log(`[RZX VERIFY]   Frame data starts at ${offset + 18}, first bytes: ${hex(data, offset + 18, 16)}`);
                    }

                    blocks.push({ id: blockId, offset, len: blockLen, name: blockName });

                    if (blockLen < 5 || offset + blockLen > data.length) {
                        return { valid: false, error: `Invalid block length at offset ${offset}` };
                    }
                    offset += blockLen;
                }

                console.log('[RZX VERIFY] Blocks found:', blocks.length);
                return { valid: true, blocks, size: data.length };
            } catch (e) {
                return { valid: false, error: e.message };
            }
        }

        /**
         * Download recorded RZX as a file
         * @param {string} filename - Optional filename (default: recording.rzx)
         */
        rzxDownloadRecording(filename = 'recording.rzx') {
            const data = this.rzxSaveRecording();
            if (!data) {
                console.warn('No RZX data to download');
                return;
            }

            const blob = new Blob([data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log(`[RZX REC] Downloaded ${filename} (${data.length} bytes)`);
        }

        /**
         * Analyze RZX file structure (for debugging)
         * @param {Uint8Array} data - RZX file data, or uses last loaded RZX if not provided
         */
        rzxAnalyze(data) {
            // Use stored raw data from loaded RZX if no data provided
            if (!data && this.rzxData) {
                data = this.rzxData;
                console.log('[RZX ANALYZE] Using loaded RZX file data');
            } else if (!data && this.rzxPlayer && this.rzxPlayer.rawData) {
                data = this.rzxPlayer.rawData;
                console.log('[RZX ANALYZE] Using RZX player data');
            }

            if (!data) {
                console.log('[RZX ANALYZE] No data available - load an RZX file first');
                return;
            }

            const hex = (arr, start, len) => Array.from(arr.slice(start, start + len))
                .map(b => b.toString(16).padStart(2, '0')).join(' ');

            console.log('[RZX ANALYZE] File size:', data.length, 'bytes');
            console.log('[RZX ANALYZE] Header:', hex(data, 0, 10));
            console.log('[RZX ANALYZE] Signature:', String.fromCharCode(data[0], data[1], data[2], data[3]));
            console.log('[RZX ANALYZE] Version:', data[4], '.', data[5]);

            let offset = 10;
            let blockNum = 0;
            while (offset < data.length - 5) {
                const blockId = data[offset];
                const blockLen = data[offset + 1] | (data[offset + 2] << 8) |
                                (data[offset + 3] << 16) | (data[offset + 4] << 24);
                blockNum++;

                const blockName = blockId === 0x10 ? 'Creator' :
                                 blockId === 0x30 ? 'Snapshot' :
                                 blockId === 0x80 ? 'Input' : `Unknown(0x${blockId.toString(16)})`;

                console.log(`[RZX ANALYZE] Block #${blockNum}: ${blockName} at offset ${offset}, length ${blockLen}`);
                console.log(`[RZX ANALYZE]   Raw header: ${hex(data, offset, Math.min(24, blockLen))}`);

                if (blockId === 0x30) {
                    // Snapshot block - show structure
                    const flags = data[offset + 5] | (data[offset + 6] << 8) |
                                 (data[offset + 7] << 16) | (data[offset + 8] << 24);
                    const ext = String.fromCharCode(data[offset + 9], data[offset + 10],
                                                   data[offset + 11], data[offset + 12]).replace(/\0/g, '');
                    const compressed = (flags & 0x01) !== 0;
                    console.log(`[RZX ANALYZE]   Flags: ${flags} (compressed=${compressed})`);
                    console.log(`[RZX ANALYZE]   Extension: "${ext}"`);

                    // Check what's at offset 13 vs 17 (with/without UncompLen)
                    console.log(`[RZX ANALYZE]   Bytes at offset 13 (no UncompLen): ${hex(data, offset + 13, 8)}`);
                    console.log(`[RZX ANALYZE]   Bytes at offset 17 (with UncompLen): ${hex(data, offset + 17, 8)}`);

                    // If it's a Z80, show header
                    const snapStart = compressed ? offset + 17 : offset + 13;
                    console.log(`[RZX ANALYZE]   Snapshot data starts at file offset ${snapStart}`);
                    console.log(`[RZX ANALYZE]   Z80 header bytes: ${hex(data, snapStart, 32)}`);
                    // Check for v2/v3 (PC=0 at bytes 6-7)
                    const pc = data[snapStart + 6] | (data[snapStart + 7] << 8);
                    if (pc === 0) {
                        const extLen = data[snapStart + 30] | (data[snapStart + 31] << 8);
                        console.log(`[RZX ANALYZE]   Z80 v2/v3, extended header length: ${extLen}`);
                    } else {
                        console.log(`[RZX ANALYZE]   Z80 v1, PC=${pc.toString(16)}`);
                    }
                }

                if (blockId === 0x80) {
                    const numFrames = data[offset + 5] | (data[offset + 6] << 8) |
                                     (data[offset + 7] << 16) | (data[offset + 8] << 24);
                    const tstates = data[offset + 10] | (data[offset + 11] << 8) |
                                   (data[offset + 12] << 16) | (data[offset + 13] << 24);
                    const flags = data[offset + 14] | (data[offset + 15] << 8) |
                                 (data[offset + 16] << 16) | (data[offset + 17] << 24);
                    console.log(`[RZX ANALYZE]   Frames: ${numFrames}, T-states: ${tstates}, Flags: ${flags}`);
                    console.log(`[RZX ANALYZE]   Frame data starts at offset ${offset + 18}`);
                    // Show first few frames
                    let fOffset = offset + 18;
                    for (let i = 0; i < Math.min(3, numFrames) && fOffset < offset + blockLen; i++) {
                        const fetchCount = data[fOffset] | (data[fOffset + 1] << 8);
                        const inputCount = data[fOffset + 2] | (data[fOffset + 3] << 8);
                        console.log(`[RZX ANALYZE]   Frame ${i}: fetch=${fetchCount}, inputs=${inputCount}`);
                        fOffset += 4 + inputCount;
                    }
                }

                if (blockLen < 5 || offset + blockLen > data.length) {
                    console.log('[RZX ANALYZE] ERROR: Invalid block length!');
                    break;
                }
                offset += blockLen;
            }
        }

        // Port I/O logging for debugging
        setPortLogEnabled(enabled) {
            this.portLogEnabled = enabled;
            if (enabled) {
                this.portLog = []; // Clear log when enabling
            }
        }

        isPortLogEnabled() {
            return this.portLogEnabled;
        }

        getPortLogCount() {
            return this.portLog.length;
        }

        exportPortLog(filter = 'both') {
            const hex4 = v => v.toString(16).toUpperCase().padStart(4, '0');
            const hex2 = v => v.toString(16).toUpperCase().padStart(2, '0');
            const lines = ['Dir\tPort\tValue\tPC\tFrame\tT-states'];
            let count = 0;
            for (const entry of this.portLog) {
                // Apply filter
                if (filter === 'in' && entry.dir !== 'IN') continue;
                if (filter === 'out' && entry.dir !== 'OUT') continue;
                const frameStr = entry.frame >= 0 ? entry.frame : '-';
                lines.push(`${entry.dir}\t${hex4(entry.port)}\t${hex2(entry.value)}\t${hex4(entry.pc)}\t${frameStr}\t${entry.t}`);
                count++;
            }
            return { text: lines.join('\n'), count };
        }

        clearPortLog() {
            this.portLog = [];
        }

        // ========== Auto-Mapping ==========

        getAutoMapKey(addr) {
            addr &= 0xffff;
            if (this.memory.machineType === '48k') {
                return addr.toString();
            }
            // 128K/Pentagon: track pages for ROM and paged RAM
            if (addr < 0x4000) {
                // ROM area - track which ROM bank
                return `${addr}:R${this.memory.currentRomBank}`;
            } else if (addr >= 0xC000) {
                // Paged RAM at C000-FFFF
                return `${addr}:${this.memory.currentRamBank}`;
            }
            // Fixed RAM (4000-BFFF) - no page suffix
            return addr.toString();
        }

        // Parse auto-map key back to {addr, page}
        parseAutoMapKey(key) {
            const parts = key.split(':');
            const addr = parseInt(parts[0], 10);
            const page = parts.length > 1 ? parts[1] : null;
            return { addr, page };
        }

        // Enable/disable auto-mapping
        setAutoMapEnabled(enabled) {
            this.autoMap.enabled = enabled;
            this.updateMemoryCallbacksFlag();
        }

        isAutoMapEnabled() {
            return this.autoMap.enabled;
        }

        // Clear all auto-map tracking data
        clearAutoMap() {
            this.autoMap.executed.clear();
            this.autoMap.read.clear();
            this.autoMap.written.clear();
            this.autoMap.currentFetchAddrs.clear();
        }

        // Get auto-map statistics
        getAutoMapStats() {
            return {
                executed: this.autoMap.executed.size,
                read: this.autoMap.read.size,
                written: this.autoMap.written.size
            };
        }

        // Get all auto-map data for region generation
        getAutoMapData() {
            return {
                executed: new Map(this.autoMap.executed),
                read: new Map(this.autoMap.read),
                written: new Map(this.autoMap.written)
            };
        }

        // ========== Utility ==========

        getFps() { return this.actualFps; }
        isRunning() { return this.running; }

        // ========== Audio ==========

        /**
         * Initialize audio system (must be called from user interaction)
         */
        initAudio() {
            if (this.audio) return this.audio;
            this.audio = new AudioManager(this.ay, this.timing);
            return this.audio;
        }

        /**
         * Get audio manager (may be null if not initialized)
         */
        getAudio() {
            return this.audio;
        }
    }

    /**
     * AudioManager - Handles Web Audio output for AY chip using AudioWorklet
     */
    class AudioManager {
        constructor(ay, timing) {
            this.ay = ay;
            this.timing = timing;
            this.context = null;
            this.gainNode = null;
            this.workletNode = null;
            this.enabled = false;
            this.volume = 0.5;
            this.muted = false;

            // Buffer for batching samples to send to worklet
            this.sendBufferSize = 512;
            this.sendBufferL = new Float32Array(this.sendBufferSize);
            this.sendBufferR = new Float32Array(this.sendBufferSize);
            this.sendBufferPos = 0;

            // Timing
            this.sampleRate = 44100;
            this.cpuClock = timing.cpuClock || 3500000;
            this.ayClock = ay.clockRate;

            // Samples per frame at 50Hz
            this.samplesPerFrame = Math.floor(this.sampleRate / 50);

            // CPU cycles per audio sample
            this.cyclesPerSample = this.cpuClock / this.sampleRate;

            // AY cycles per CPU cycle (AY runs at ~half CPU speed)
            this.ayPerCpu = this.ayClock / this.cpuClock;
        }

        /**
         * Start audio output using AudioWorklet
         */
        async start() {
            if (this.context) return;

            try {
                this.context = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: this.sampleRate
                });

                // Update sample rate if browser chose different
                this.sampleRate = this.context.sampleRate;
                this.samplesPerFrame = Math.floor(this.sampleRate / 50);
                this.cyclesPerSample = this.cpuClock / this.sampleRate;

                // Create gain node for volume control
                this.gainNode = this.context.createGain();
                this.gainNode.gain.value = this.muted ? 0 : this.volume;
                this.gainNode.connect(this.context.destination);

                // Load AudioWorklet module
                await this.context.audioWorklet.addModule('audio-processor.js');

                // Create AudioWorkletNode
                this.workletNode = new AudioWorkletNode(this.context, 'zx-audio-processor', {
                    numberOfInputs: 0,
                    numberOfOutputs: 1,
                    outputChannelCount: [2]
                });
                this.workletNode.connect(this.gainNode);

                // Resume context (may be suspended due to autoplay policy)
                if (this.context.state === 'suspended') {
                    await this.context.resume();
                }

                this.enabled = true;
            } catch (e) {
                console.error('Failed to initialize audio:', e);
                this.enabled = false;
            }
        }

        /**
         * Stop audio output
         */
        stop() {
            if (this.workletNode) {
                this.workletNode.disconnect();
                this.workletNode = null;
            }
            if (this.gainNode) {
                this.gainNode.disconnect();
                this.gainNode = null;
            }
            if (this.context) {
                this.context.close();
                this.context = null;
            }
            this.enabled = false;
        }

        /**
         * Set volume (0-1)
         */
        setVolume(vol) {
            this.volume = Math.max(0, Math.min(1, vol));
            if (this.gainNode && !this.muted) {
                this.gainNode.gain.value = this.volume;
            }
        }

        /**
         * Set mute state
         */
        setMuted(muted) {
            this.muted = muted;
            if (this.gainNode) {
                this.gainNode.gain.value = muted ? 0 : this.volume;
            }
        }

        /**
         * Toggle mute
         */
        toggleMute() {
            this.setMuted(!this.muted);
            return this.muted;
        }

        /**
         * Send buffered samples to AudioWorklet
         */
        flushSamples() {
            if (!this.workletNode || this.sendBufferPos === 0) return;

            // Send samples to worklet
            this.workletNode.port.postMessage({
                left: this.sendBufferL.slice(0, this.sendBufferPos),
                right: this.sendBufferR.slice(0, this.sendBufferPos)
            });
            this.sendBufferPos = 0;
        }

        /**
         * Process one frame of audio
         * Called at end of each emulated frame
         * @param {number} frameTstates - T-states in this frame
         * @param {Array} beeperChanges - Array of {tStates, level} beeper state changes
         * @param {number} beeperLevel - Final beeper level at end of frame
         * @param {Array} tapeAudioChanges - Array of {tStates, level} tape signal changes
         */
        processFrame(frameTstates, beeperChanges = [], beeperLevel = 0, tapeAudioChanges = []) {
            if (!this.enabled || !this.workletNode) return;

            // Generate samples for this frame
            const samplesToGenerate = this.samplesPerFrame;

            // CPU cycles per sample for this frame
            const cyclesPerSample = frameTstates / samplesToGenerate;

            // AY steps per sample
            const ayStepsPerSample = this.ay ? cyclesPerSample * this.ayPerCpu : 0;

            // Audio levels
            const BEEPER_VOLUME = 0.5;
            const TAPE_VOLUME = 0.5;  // Tape loading sound

            // Only process beeper if there are changes (otherwise it's silent)
            const hasBeeperActivity = beeperChanges.length > 0;
            const hasTapeAudio = tapeAudioChanges.length > 0;

            // Track beeper state for this frame
            let beeperIdx = 0;
            let currentBeeperLevel = beeperLevel;
            if (hasBeeperActivity && beeperChanges[0].tStates === 0) {
                currentBeeperLevel = beeperChanges[0].level;
            }

            // Track tape audio state for this frame
            let tapeIdx = 0;
            let currentTapeLevel = 0;
            if (hasTapeAudio && tapeAudioChanges[0].tStates === 0) {
                currentTapeLevel = tapeAudioChanges[0].level;
            }

            for (let i = 0; i < samplesToGenerate; i++) {
                // Calculate T-state for this sample
                const sampleTstates = (i + 0.5) * cyclesPerSample;

                // Update beeper level based on changes
                while (beeperIdx < beeperChanges.length &&
                       beeperChanges[beeperIdx].tStates <= sampleTstates) {
                    currentBeeperLevel = beeperChanges[beeperIdx].level;
                    beeperIdx++;
                }

                // Update tape level based on changes
                while (tapeIdx < tapeAudioChanges.length &&
                       tapeAudioChanges[tapeIdx].tStates <= sampleTstates) {
                    currentTapeLevel = tapeAudioChanges[tapeIdx].level;
                    tapeIdx++;
                }

                // Get AY sample (if AY is available)
                let left = 0, right = 0;
                if (this.ay) {
                    this.ay.stepMultiple(Math.round(ayStepsPerSample));
                    [left, right] = this.ay.getAveragedSample();
                }

                // Add beeper to both channels (mono beeper) - only when active
                if (hasBeeperActivity) {
                    const beeperSample = (currentBeeperLevel * 2 - 1) * BEEPER_VOLUME;
                    left += beeperSample;
                    right += beeperSample;
                }

                // Add tape audio - only when tape is playing
                if (hasTapeAudio) {
                    const tapeSample = (currentTapeLevel * 2 - 1) * TAPE_VOLUME;
                    left += tapeSample;
                    right += tapeSample;
                }

                // Clamp to [-1, 1] range
                left = Math.max(-1, Math.min(1, left));
                right = Math.max(-1, Math.min(1, right));

                // Add to send buffer
                this.sendBufferL[this.sendBufferPos] = left;
                this.sendBufferR[this.sendBufferPos] = right;
                this.sendBufferPos++;

                // Flush when buffer is full
                if (this.sendBufferPos >= this.sendBufferSize) {
                    this.flushSamples();
                }
            }

            // Flush remaining samples at end of frame
            this.flushSamples();
        }

        /**
         * Resume audio context (call from user interaction)
         */
        async resume() {
            if (this.context && this.context.state === 'suspended') {
                await this.context.resume();
            }
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Spectrum;
    }
    if (typeof global !== 'undefined') {
        global.Spectrum = Spectrum;
    }

})(typeof window !== 'undefined' ? window : global);
