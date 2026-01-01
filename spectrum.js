/**
 * ZX-M8XXX - Spectrum Machine Integration
 * @version 0.6.5
 * @license GPL-3.0
 */

(function(global) {
    'use strict';

    const VERSION = '0.6.5';

    class Spectrum {
        static get VERSION() { return VERSION; }
        
        constructor(canvas, options = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.overlayCanvas = options.overlayCanvas || null;
            this.overlayCtx = this.overlayCanvas ? this.overlayCanvas.getContext('2d') : null;
            this.zoom = 1;
            this.machineType = options.machineType || '48k';
            this.tapeTrapsEnabled = options.tapeTrapsEnabled !== false;
            
            this.memory = new Memory(this.machineType);
            this.cpu = new Z80(this.memory);
            this.ula = new ULA(this.memory, this.machineType);
            
            // Setup contention
            this.setupContention();
            
            this.tapeLoader = new TapeLoader();
            this.snapshotLoader = new SnapshotLoader();
            this.tapeTrap = new TapeTrapHandler(this.cpu, this.memory, null);
            this.tapeTrap.setEnabled(this.tapeTrapsEnabled);
            this.trdosTrap = new TRDOSTrapHandler(this.cpu, this.memory);
            this.trdosTrap.setEnabled(this.tapeTrapsEnabled);  // Use same setting as tape traps
            this.betaDisk = new BetaDisk();  // Beta Disk interface (WD1793)

            // AY-3-8910 sound chip
            this.ay = new AY(this.machineType === 'pentagon' ? 1750000 : 1773400);
            this.ayEnabled = this.machineType !== '48k';  // AY enabled by default for 128K/Pentagon
            this.ay48kEnabled = false;  // Optional AY for 48K (like Melodik interface)
            this.aySelectedRegister = 0;

            // Audio manager (initialized on user interaction due to browser autoplay policy)
            this.audio = null;
            
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
            
            // Speed control (100 = normal, 0 = max)
            this.speed = 100;
            this.rafId = null;
            
            // Unified trigger system - replaces separate breakpoints/watchpoints/port breakpoints
            // Trigger types: 'exec', 'read', 'write', 'rw', 'port_in', 'port_out', 'port_io'
            this.triggers = [];
            this.triggerHit = false;
            this.lastTrigger = null; // {trigger, addr, val, port, direction}
            this.onTrigger = null; // Unified callback for all trigger types

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

            // Media storage for project save/load
            // Stores original TAP/TRD/SCL data so programs can load additional files
            this.loadedMedia = null; // { type: 'tap'|'trd'|'scl', data: Uint8Array, name: string }

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
            this.rzxTstates = 0;        // T-states into current RZX frame (persists across emu frames)
            this.onRZXEnd = null;       // Callback when playback ends

            // Kempston joystick state (active high)
            // Bit 0: Right, Bit 1: Left, Bit 2: Down, Bit 3: Up, Bit 4: Fire
            this.kempstonState = 0;
            this.kempstonEnabled = false; // Disabled by default
            
            // Setup memory watchpoint callbacks (also used for auto-mapping)
            this.memory.onRead = (addr, val) => {
                // Auto-map: track non-fetch reads (only during CPU execution)
                if (this.autoMap.enabled && this.autoMap.inExecution && !this.autoMap.currentFetchAddrs.has(addr)) {
                    const key = this.getAutoMapKey(addr);
                    this.autoMap.read.set(key, (this.autoMap.read.get(key) || 0) + 1);
                }
                this.checkReadWatchpoint(addr, val);
            };
            this.memory.onWrite = (addr, val) => {
                // Auto-map: track writes (only during CPU execution)
                if (this.autoMap.enabled && this.autoMap.inExecution) {
                    const key = this.getAutoMapKey(addr);
                    this.autoMap.written.set(key, (this.autoMap.written.get(key) || 0) + 1);
                }
                // Trace: track memory writes
                if ((this.runtimeTraceEnabled || this.traceEnabled) &&
                    this.traceMemOps.length < this.traceMemOpsLimit) {
                    this.traceMemOps.push({ addr, val });
                }
                // Multicolor: disabled (known limitation - see README)
                this.checkWriteWatchpoint(addr, val);
            };

            // Setup CPU fetch callback for auto-mapping
            this.cpu.onFetch = (addr) => {
                if (this.autoMap.enabled && this.autoMap.inExecution) {
                    const key = this.getAutoMapKey(addr);
                    this.autoMap.executed.set(key, (this.autoMap.executed.get(key) || 0) + 1);
                    this.autoMap.currentFetchAddrs.add(addr);
                }
            };

            this.boundKeyDown = this.handleKeyDown.bind(this);
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

        // ========== Memory & Contention ==========

        setupContention() {
            // Pentagon has no contention
            if (this.machineType === 'pentagon') {
                this.contentionFunc = null;
                this.cpu.contend = null;
                this.cpu.ioContend = null;
                this.contentionEnabled = false;
                return;
            }

            // For 48K: use per-line contention (proven to work)
            if (this.machineType === '48k') {
                this.contentionFunc = null;
                this.cpu.contend = null;
                this.cpu.ioContend = null;
                this.contentionEnabled = true;
                return;
            }

            // For 128K: I/O contention enabled
            // The contention pattern [6,5,4,3,2,1,0,0] repeats every 8 T-states
            // Since 228 mod 8 = 4, the pattern shifts by 4 each line
            this.cpu.contend = null;
            this.cpu.ioContend = null;
            this.contentionEnabled = true;
        }

        // Swan-style contention check
        // Returns delay to add based on current T-state position
        checkContention(tState) {
            if (!this.ula.IO_CONTENTION_ENABLED) return 0;

            const contentionFrom = this.ula.CONTENTION_START_TSTATE;
            // Swan formula: ContentionFrom + (CentralScreenHeight - 1) * TicksPerScanLine + 128
            // = 14361 + 191 * 228 + 128 = 58037
            const contentionTo = contentionFrom + (191 * this.ula.TSTATES_PER_LINE) + 128;
            const ticksPerLine = this.ula.TSTATES_PER_LINE;

            // Only apply contention within screen area
            if (tState < contentionFrom || tState >= contentionTo) {
                return 0;
            }

            // Swan formula: N = ((tStates - ContentionFrom) mod TicksPerLine) and $87
            // $87 = 0x87 = 135 - this masks to get position within 8-cycle pattern
            // while also detecting if we're past the screen area (bit 7 set = position >= 128)
            // If N <= 5, delay = 6 - N
            const N = ((tState - contentionFrom) % ticksPerLine) & 0x87;
            if (N <= 5) {
                return 6 - N;
            }
            return 0;
        }

        // Swan-style I/O timing for ULA ports
        // Applies contention and returns total T-states to add
        applyIOTimings(port) {
            if (!this.ula.IO_CONTENTION_ENABLED) return 0;

            const highByte = (port >> 8) & 0xFF;
            const lowByte = port & 0xFF;
            const isUlaPort = (lowByte & 0x01) === 0;
            const highByteContended = (highByte >= 0x40 && highByte <= 0x7F);

            // In Swan, tStates already includes fetch timing (8T) when IOTimings runs
            // Our cpu.tStates has no fetch timing yet, so add 8 to match Swan's position
            const fetchOffset = 8;
            let totalDelay = 0;

            if (highByteContended) {
                if (isUlaPort) {
                    // C:1, C:3
                    totalDelay += this.checkContention(this.cpu.tStates + fetchOffset + totalDelay);
                    totalDelay += 1;
                    totalDelay += this.checkContention(this.cpu.tStates + fetchOffset + totalDelay);
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
                    // N:1, C:3
                    totalDelay += 1;
                    totalDelay += this.checkContention(this.cpu.tStates + fetchOffset + totalDelay);
                    totalDelay += 3;
                } else {
                    // N:4
                    totalDelay += 4;
                }
            }

            return totalDelay;
        }
        
        setContention(enabled) {
            this.contentionEnabled = enabled;
            // Per-line contention is handled in the run loop based on contentionEnabled flag
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
            // mode: 'none', 'grid', 'screen', 'reveal'
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
            this.rzxStop();
            if (this.ay) this.ay.reset();

            // Clear auto-map data
            this.autoMap.executed.clear();
            this.autoMap.read.clear();
            this.autoMap.written.clear();
            this.autoMap.currentFetchAddrs.clear();
        }

        // ========== Port I/O ==========

        portRead(port) {
            let result = 0xff;

            // RZX playback - return recorded input
            // NOTE: RZX support is partial. Recordings with non-standard fetchCount
            // (e.g., ~17750 instead of ~70000) may desync because our emulator fires
            // one interrupt per video frame while the recording may expect different timing.
            // TODO: Investigate proper RZX frame synchronization for all recording types.
            if (this.rzxPlaying && this.rzxPlayer) {
                // Calculate which RZX frame we should be in based on accumulated T-states
                let accum = this.rzxTstates + this.cpu.tStates;
                let frameIdx = this.rzxFrame;

                // Find the correct frame based on fetchCount boundaries
                while (frameIdx < this.rzxPlayer.getFrameCount()) {
                    const frame = this.rzxPlayer.getFrame(frameIdx);
                    if (!frame) break;
                    const fetchCount = frame.fetchCount > 0 ? frame.fetchCount : 17750;
                    if (accum < fetchCount) break;
                    accum -= fetchCount;
                    frameIdx++;
                }

                const input = this.rzxPlayer.getNextInput(frameIdx);
                result = (input !== null) ? input : 0xFF;
            } else {
                // Check port breakpoint using unified trigger system
                if (this.running) {
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
                const betaDiskActive = this.machineType === 'pentagon' &&
                    this.betaDisk && this.betaDisk.hasDisk();


                if ((lowByte & 0x01) === 0) {
                    // Port 0xFE: keyboard + EAR input
                    // Bits 0-4: keyboard (active low)
                    // Bit 5: unused (1)
                    // Bit 6: EAR input (0 when idle)
                    // Bit 7: unused (1)
                    result = (this.ula.readKeyboard(highByte) & 0x1f) | 0xa0;
                } else if (betaDiskActive && (lowByte === 0x1f || lowByte === 0x3f ||
                           lowByte === 0x5f || lowByte === 0x7f)) {
                    // Beta Disk WD1793 registers
                    result = this.betaDisk.read(port);
                } else if (betaDiskActive && lowByte === 0xff) {
                    // Beta Disk system register
                    result = this.betaDisk.read(port);
                } else if (lowByte === 0x1f) {
                    // Port 0x1F: Kempston joystick (only when no Beta Disk)
                    result = this.kempstonEnabled ? this.kempstonState : 0x00;
                } else if ((port & 0xC002) === 0xC000) {
                    // Port 0xFFFD: AY register read (128K/Pentagon, or 48K with AY enabled)
                    if (this.ayEnabled || (this.machineType === '48k' && this.ay48kEnabled)) {
                        result = this.ay.readRegister();
                    }
                }
            }

            // Track port read for trace (only if callback exists to consume the data)
            if ((this.runtimeTraceEnabled || this.traceEnabled) && this.onBeforeStep) {
                this.tracePortOps.push({ dir: 'in', port, val: result });
            }

            return result;
        }
        
        portWrite(port, val, instructionTiming = 12) {
            // Track port write for trace (only if callback exists to consume the data)
            if ((this.runtimeTraceEnabled || this.traceEnabled) && this.onBeforeStep) {
                this.tracePortOps.push({ dir: 'out', port, val });
            }

            // Check port breakpoint using unified trigger system
            if (this.running) {
                const trigger = this.checkPortTriggers(port, val, true);
                if (trigger) {
                    this.portBreakpointHit = true;
                    this.triggerHit = true;
                    this.lastPortBreakpoint = { port, direction: 'out', val, breakpoint: trigger };
                    this.lastTrigger = { trigger, port, val, direction: 'out' };
                }
            }

            const lowByte = port & 0xff;

            // Beta Disk ports (Pentagon with disk inserted)
            // Ports are accessible whenever disk is inserted, not just when ROM is paged in
            const betaDiskActive = this.machineType === 'pentagon' &&
                this.betaDisk && this.betaDisk.hasDisk();

            if ((lowByte & 0x01) === 0) {
                // Track border changes in T-states for pixel-perfect rendering
                // Swan approach: border change at instruction_end - 8
                // Our Z80 calls portWrite BEFORE adding instruction timing,
                // so we calculate: tStates + (instructionTiming - 8) + contention
                // - OUT (n),A (11T): tStates + 3
                // - OUT (C),r (12T): tStates + 4
                // - OUTI/OUTD/OTIR/OTDR (16T): tStates + 8
                const ioDelay = this.applyIOTimings(port);
                // ioDelay includes 4T base + contention
                const contentionOnly = Math.max(0, ioDelay - 4);

                // Add contention to cpu.tStates (Swan does this in IOTimings)
                // This affects timing of subsequent instructions
                this.cpu.tStates += contentionOnly;

                // Border change at instruction_start + (instructionTiming - 8) + contention
                const borderChangeTime = this.cpu.tStates + (instructionTiming - 8);
                this.ula.setBorderAt(val & 0x07, borderChangeTime);
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
            if (this.machineType !== '48k' && (port & 0x8002) === 0) {
                const oldScreenBank = this.memory.screenBank;
                this.memory.writePaging(val);
                // Track screen bank changes for scroll17-style effects
                const newScreenBank = this.memory.screenBank;
                if (newScreenBank !== oldScreenBank) {
                    // Screen bank changes use instruction_end - 2
                    // For +8px right shift compared to border timing (-8)
                    // OUTI (16T): bank change at tStates + 14
                    const bankChangeTime = this.cpu.tStates + (instructionTiming - 2);
                    this.ula.setScreenBankAt(newScreenBank, bankChangeTime);
                }
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
        }

        // ========== Frame Execution ==========

        runFrame() {
            const tstatesPerFrame = this.timing.tstatesPerFrame;
            const tstatesPerLine = this.timing.tstatesPerLine;

            // Reset T-states at frame start
            this.cpu.tStates = 0;

            this.ula.startFrame();
            this.lastContentionLine = -1;  // Reset per-line contention tracking

            // Track which line to render next
            let nextLineToRender = 0;
            const totalLines = Math.floor(tstatesPerFrame / tstatesPerLine);

            // Fire interrupt
            if (this.cpu.iff1) {
                const intTstates = this.cpu.interrupt();
                this.cpu.tStates += intTstates;
            }

            while (this.cpu.tStates < tstatesPerFrame) {

                // Render complete scanline (paper + border) at line END
                // This is simpler and matches how other emulators handle it
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

                // Check breakpoint using unified trigger system
                const execTrigger = this.checkExecTriggers(this.cpu.pc);
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
                if (this.tapeTrapsEnabled && this.tapeTrap.checkTrap()) continue;
                if (this.tapeTrapsEnabled && this.trdosTrap.checkTrap()) continue;

                // Apply ULA contention per-line for 48K and 128K
                if ((this.machineType === '48k' || this.machineType === '128k') && this.contentionEnabled) {
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
                    this.cpu.tStates += 4;
                    this.cpu.incR();
                } else {
                    // Clear trace ops and capture state before execution
                    const tracing = this.runtimeTraceEnabled && this.onBeforeStep;
                    if (tracing) {
                        this.tracePortOps = [];
                        this.traceMemOps = [];
                    }
                    // Capture PC before execution for xref/trace tracking
                    const instrPC = (this.xrefTrackingEnabled || tracing) ? this.cpu.pc : 0;
                    this.cpu.execute();
                    // Record trace after execution (includes port/mem ops)
                    if (tracing) {
                        this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps);
                    }
                    // Call xref tracking callback if enabled
                    if (this.xrefTrackingEnabled && this.onInstructionExecuted) {
                        this.onInstructionExecuted(instrPC);
                    }
                }

                this.autoMap.inExecution = false;

                // Clear fetch tracking for auto-map (per instruction)
                if (this.autoMap.enabled) {
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

            // Render remaining lines
            while (nextLineToRender < totalLines) {
                this.ula.renderScanline(nextLineToRender++);
            }

            const frameBuffer = this.ula.endFrame();

            // Handle border-only modes: replace paper area with border color
            // Use proper T-state calculation to extend border into paper area
            const borderOnlyMode = this.overlayMode === 'screen' || this.overlayMode === 'beamscreen';
            if (borderOnlyMode && this.ula.debugScreenRendering) {
                console.log(`[Spectrum WARNING] borderOnlyMode active: overlayMode='${this.overlayMode}' - paper area will be replaced with border colors`);
            }
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

            // Process AY audio for this frame
            if (this.audio && this.audio.enabled) {
                this.audio.processFrame(tstatesPerFrame);
            }

            // Advance AY logging frame counter
            if (this.ay) {
                this.ay.advanceLogFrame();
            }

            // RZX: advance frames based on accumulated T-states
            if (this.rzxPlaying && this.rzxPlayer) {
                this.rzxTstates += tstatesPerFrame;

                // Advance through RZX frames
                while (this.rzxPlaying && this.rzxFrame < this.rzxPlayer.getFrameCount()) {
                    const frame = this.rzxPlayer.getFrame(this.rzxFrame);
                    if (!frame) break;
                    const fetchCount = frame.fetchCount > 0 ? frame.fetchCount : 17750;

                    if (this.rzxTstates >= fetchCount) {
                        this.rzxTstates -= fetchCount;
                        this.rzxFrame++;
                    } else {
                        break;
                    }
                }

                if (this.rzxFrame >= this.rzxPlayer.getFrameCount()) {
                    this.rzxStop();
                    if (this.onRZXEnd) this.onRZXEnd();
                }
            }
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
                case 'none':
                default:
                    // Clear overlay canvas
                    if (this.overlayCtx) {
                        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
                    }
                    break;
            }
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

                // Convert entire previous frame to grayscale
                // Both BeamScreen and Beam: grayscale everything (paper area has border colors in borderOnlyMode)
                // The previousFrameBuffer already contains border colors extended into paper area
                for (let i = 0; i < this.previousFrameBuffer.length; i += 4) {
                    const gray = Math.round(
                        this.previousFrameBuffer[i] * 0.299 +
                        this.previousFrameBuffer[i + 1] * 0.587 +
                        this.previousFrameBuffer[i + 2] * 0.114
                    );
                    tempImageData.data[i] = gray;
                    tempImageData.data[i + 1] = gray;
                    tempImageData.data[i + 2] = gray;
                    tempImageData.data[i + 3] = 200;  // Semi-transparent
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
            this.speed = speed;
            this.lastRafTime = null;  // Reset for new timing
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

        // Beta Disk automatic ROM paging (Pentagon only)
        // Called before each instruction fetch to handle automatic TR-DOS ROM switching
        // The Beta Disk interface has its own ROM chip with TR-DOS, which is paged in
        // when executing code in the 3D00-3DFF "magic" address range, and paged out
        // when execution moves to RAM (>=4000h)
        // NOTE: ROM paging happens regardless of disk presence - it's a hardware address decode
        updateBetaDiskPaging() {
            // Only on Pentagon with TR-DOS ROM loaded
            if (this.machineType !== 'pentagon' || !this.memory.hasTrdosRom()) {
                return;
            }
            const pc = this.cpu.pc;
            if (pc >= 0x3D00 && pc <= 0x3DFF) {
                // Entering TR-DOS magic area - page in TR-DOS ROM
                // Only activate when ROM 1 (48K BASIC) is selected, not ROM 0 (128K editor)
                // This prevents spurious TR-DOS activation when running 128K BASIC
                if (!this.memory.trdosActive && this.memory.currentRomBank === 1) {
                    this.memory.trdosActive = true;
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
            // Clear trace ops and capture PC before execution
            const tracing = this.traceEnabled && this.onBeforeStep;
            if (tracing) {
                this.tracePortOps = [];
                this.traceMemOps = [];
            }
            const instrPC = tracing ? this.cpu.pc : 0;
            this.autoMap.inExecution = true;
            this.cpu.step();
            this.autoMap.inExecution = false;

            // Handle frame boundary crossing during stepping
            const tstatesPerFrame = this.getTstatesPerFrame();
            if (this.cpu.tStates >= tstatesPerFrame) {
                this.cpu.tStates -= tstatesPerFrame;
                this.ula.startFrame();  // Clear border changes for new frame
                // Fire INT if enabled
                if (this.cpu.iff1) {
                    this.cpu.interrupt();
                }
            }

            // Record trace after execution (includes port/mem ops)
            if (tracing) {
                this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps);
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
                // Check for frame boundary - fire INT
                if (this.cpu.tStates >= tstatesPerFrame) {
                    this.cpu.tStates -= tstatesPerFrame;  // Preserve overshoot for accurate timing
                    this.ula.startFrame();  // Clear border changes for new frame
                    if (this.cpu.iff1) {
                        this.cpu.interrupt();
                        // CPU is no longer halted after INT
                        break;
                    }
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

            const frameBuffer = this.ula.renderFrame();

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
            this.savePreviousFrame(frameBuffer);

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
                // Clear trace ops and capture PC before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                cycles += this.cpu.step();

                // Handle frame boundary crossing
                if (this.cpu.tStates >= tstatesPerFrame) {
                    this.cpu.tStates -= tstatesPerFrame;
                    this.ula.startFrame();  // Clear border changes for new frame
                    if (this.cpu.iff1) {
                        this.cpu.interrupt();
                    }
                }

                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps);
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
        
        // Run until next interrupt
        runToInterrupt(maxCycles = 10000000) {
            if (this.running || !this.romLoaded) return false;
            this.autoMap.inExecution = true;
            const tracing = this.traceEnabled && this.onBeforeStep;
            let cycles = 0;
            const tstatesPerFrame = this.getTstatesPerFrame();
            const startPC = this.cpu.pc;  // Skip breakpoint check at starting PC (for HALT)

            while (cycles < maxCycles) {
                // Beta Disk automatic ROM paging
                this.updateBetaDiskPaging();

                // Check if we've crossed a frame boundary (interrupt point)
                if (this.cpu.tStates >= tstatesPerFrame) {
                    // Reset for new frame and fire interrupt
                    this.cpu.tStates -= tstatesPerFrame;
                    this.ula.startFrame();  // Clear border changes for new frame
                    if (this.cpu.iff1) {
                        this.cpu.interrupt();
                    }
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

                // Clear trace ops and capture PC before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                cycles += this.cpu.step();
                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps);
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
                    // Clear trace ops and capture PC before RET
                    if (tracing) {
                        this.tracePortOps = [];
                        this.traceMemOps = [];
                    }
                    const instrPC = tracing ? this.cpu.pc : 0;
                    // Execute the RET and stop after
                    cycles += this.cpu.step();
                    // Record trace after execution
                    if (tracing) {
                        this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps);
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

                // Clear trace ops and capture PC before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                cycles += this.cpu.step();

                // Handle frame boundary crossing
                if (this.cpu.tStates >= tstatesPerFrame) {
                    this.cpu.tStates -= tstatesPerFrame;
                    this.ula.startFrame();  // Clear border changes for new frame
                    if (this.cpu.iff1) {
                        this.cpu.interrupt();
                    }
                }

                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps);
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

                // Clear trace ops and capture PC before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                const before = this.cpu.tStates;
                this.cpu.step();
                executed += this.cpu.tStates - before;
                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps);
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
            if (this.machineType === '48k') {
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
                    // Hex literal (with or without 'h' suffix)
                    if (s.match(/^[0-9A-Fa-f]+h?$/i)) {
                        return parseInt(s.replace(/h$/i, ''), 16);
                    }
                    // Decimal literal
                    if (s.match(/^\d+$/)) {
                        return parseInt(s, 10);
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
            if (!this.running) return;
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
            if (!this.running) return;
            // Use unified trigger system
            const trigger = this.checkMemTriggers(addr, val, true);
            if (trigger) {
                this.watchpointHit = true;
                this.triggerHit = true;
                this.lastWatchpoint = { addr, type: 'write', val };
                this.lastTrigger = { trigger, addr, val, type: 'write' };
            }
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
            return this.triggers.length - 1;
        }

        /**
         * Remove a trigger by index
         */
        removeTrigger(index) {
            if (index >= 0 && index < this.triggers.length) {
                this.triggers.splice(index, 1);
                this._syncLegacyArrays();
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
            
            // Prevent browser shortcuts when emulator should capture them
            // Ctrl+key combinations that conflict with browser shortcuts
            if (e.ctrlKey && !e.altKey && !e.metaKey) {
                const key = e.key.toLowerCase();
                // Common browser shortcuts we want to capture for ZX Spectrum Symbol Shift combinations
                // Include letters and digits (0-9 for symbols like _ = Ctrl+0)
                if (['p', 's', 'o', 'n', 'w', 'r', 'f', 'h', 'j', 'k', 'l', 'u', 'i', 'b', 'd', 'g', 'a', 'z', 'x', 'c', 'v', 'e', 't', 'y', 'm', 'q', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(key)) {
                    e.preventDefault();
                }
            }
            
            // Kempston joystick on numpad
            const kempstonBit = this.getKempstonBit(e.keyCode);
            if (kempstonBit !== null) {
                e.preventDefault();
                this.kempstonState |= kempstonBit;
                return;
            }
            
            if (this.ula.keyMap[e.keyCode]) {
                e.preventDefault();
                this.ula.keyDown(e.keyCode);
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
            
            // Kempston joystick on numpad
            const kempstonBit = this.getKempstonBit(e.keyCode);
            if (kempstonBit !== null) {
                e.preventDefault();
                this.kempstonState &= ~kempstonBit;
                return;
            }
            
            if (this.ula.keyMap[e.keyCode]) {
                e.preventDefault();
                this.ula.keyUp(e.keyCode);
            }
        }
        
        getKempstonBit(keyCode) {
            // Numpad mapping to Kempston joystick
            // Bit 0: Right, Bit 1: Left, Bit 2: Down, Bit 3: Up, Bit 4: Fire
            switch (keyCode) {
                case 104: return 0x08; // Numpad 8 - Up
                case 98:  return 0x04; // Numpad 2 - Down
                case 100: return 0x02; // Numpad 4 - Left
                case 102: return 0x01; // Numpad 6 - Right
                case 101: return 0x10; // Numpad 5 - Fire
                case 96:  return 0x10; // Numpad 0 - Fire
                case 97:  return 0x06; // Numpad 1 - Down+Left
                case 99:  return 0x05; // Numpad 3 - Down+Right
                case 103: return 0x0a; // Numpad 7 - Up+Left
                case 105: return 0x09; // Numpad 9 - Up+Right
                default:  return null;
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
                    throw new Error('No SNA, TAP, Z80, TRD, or SCL files found in ZIP');
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

            // Check for TRD/SCL disk images (contain multiple files)
            if (type === 'trd' || type === 'scl') {
                return this.loadDiskImage(data, type, fileName);
            }

            return this.loadFileData(data, fileName);
        }

        // Load TRD/SCL disk image - inserts disk into Beta Disk interface
        loadDiskImage(data, type, fileName) {
            const Loader = type === 'trd' ? TRDLoader : SCLLoader;
            const files = Loader.listFiles(data);

            if (files.length === 0) {
                throw new Error(`No files found in ${type.toUpperCase()} disk image`);
            }

            // Store disk image for project save and TR-DOS trap access
            this.loadedMedia = {
                type: type,
                data: new Uint8Array(data),
                name: fileName
            };
            this.loadedDiskFiles = files;  // Keep file list for TR-DOS operations

            // Load disk into Beta Disk interface (for WD1793 emulation)
            this.betaDisk.loadDisk(data, type);

            // Set up TR-DOS trap handler with disk data (fallback)
            this.trdosTrap.setDisk(this.loadedMedia.data, files, type);

            // Request switch to Pentagon + TR-DOS if not already in Pentagon mode
            const needsMachineSwitch = this.machineType !== 'pentagon';

            // Return disk inserted result - no file selection needed
            // User can use TR-DOS commands (LIST, LOAD, RUN) to interact with disk
            return {
                diskInserted: true,
                diskType: type,
                diskName: fileName,
                fileCount: files.length,
                _diskData: data,
                _diskFiles: files,
                needsMachineSwitch: needsMachineSwitch,
                targetMachine: 'pentagon'
            };
        }

        // Boot into TR-DOS mode (Pentagon only)
        // Jumps to TR-DOS entry point and lets automatic paging handle ROM switch
        bootTrdos() {
            if (this.machineType !== 'pentagon') {
                console.warn('[TR-DOS] Cannot boot TR-DOS: not in Pentagon mode');
                return false;
            }

            // Check if TR-DOS ROM is loaded
            if (!this.memory.hasTrdosRom()) {
                console.warn('[TR-DOS] Cannot boot TR-DOS: TR-DOS ROM not loaded');
                return false;
            }

            // Don't reset CPU - just jump to TR-DOS entry point
            // 0x3D13 is the TR-DOS command interpreter entry (not 0x3D00 which is "exit to BASIC")
            this.cpu.pc = 0x3D13;  // TR-DOS command entry point
            this.cpu.sp = 0x5D00;  // TR-DOS workspace stack
            this.cpu.af = 0x00FF;  // A=0 (drive A), F=default

            // Explicitly activate TR-DOS ROM (don't rely on auto-paging which checks ROM bank)
            this.memory.trdosActive = true;

            // Clear screen area for TR-DOS display
            for (let i = 0x4000; i < 0x5800; i++) {
                this.memory.write(i, 0);  // Clear pixel data
            }
            for (let i = 0x5800; i < 0x5B00; i++) {
                this.memory.write(i, 0x38);  // White ink on black paper (standard)
            }

            // Reset port read counter for debugging
            this._portReadCount = 0;

            return true;
        }

        // Load a specific file from disk image
        loadDiskFile(diskData, fileInfo, diskType) {
            const Loader = diskType === 'trd' ? TRDLoader : SCLLoader;
            const fileData = Loader.extractFile(diskData, fileInfo);

            // In Pentagon mode with TR-DOS ROM + disk, don't auto-boot
            // Just return info so user can select TR-DOS from menu manually
            // The disk is already loaded in betaDisk
            if (this.machineType === 'pentagon' && this.betaDisk.hasDisk() && this.memory.hasTrdosRom()) {
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
            return this.loadDiskFile(diskResult._diskData, fileInfo, diskResult.diskType);
        }

        // Load from pre-extracted data (used after ZIP selection)
        loadFileData(data, fileName) {
            const type = this.snapshotLoader.detectType(data, fileName);
            switch (type) {
                case 'sna': return this.loadSnapshot(data);
                case 'z80': return this.loadZ80Snapshot(data);
                case 'tap': return this.loadTape(data, fileName);  // Store TAP with name
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
                        if (hwMode >= 4 && hwMode <= 7) targetType = '128k';
                        else if (hwMode === 12 || hwMode === 13) targetType = '128k';
                    }
                }

                // Switch machine type if needed
                if (targetType !== this.machineType) {
                    this.setMachineType(targetType, true);
                }
                
                const result = this.snapshotLoader.loadZ80(data, this.cpu, this.memory);
                this.ula.setBorder(result.border);
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
                // Keep Pentagon if already set, otherwise use 128K
                targetType = (this.machineType === 'pentagon') ? 'pentagon' : '128k';
            } else {
                targetType = '48k';
            }

            // Switch machine type if needed, preserving ROM
            if (targetType !== this.machineType) {
                this.setMachineType(targetType, true);
            }
            
            try {
                const result = this.snapshotLoader.loadSNA(data, this.cpu, this.memory);
                result.machineType = targetType; // Ensure correct type is returned
                this.ula.setBorder(result.border);
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
        }
        
        saveSnapshot() {
            return this.snapshotLoader.createSNA(this.cpu, this.memory, this.ula.borderColor);
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
            
            // Save ROM data if preserving
            const oldRom = preserveRom && this.romLoaded ? this.memory.rom : null;
            
            this.machineType = type;
            this.memory = new Memory(type);
            this.ula = new ULA(this.memory, type);
            this.cpu = new Z80(this.memory);
            this.cpu.portRead = this.portRead.bind(this);
            this.cpu.portWrite = this.portWrite.bind(this);
            this.setupContention();  // Setup contention for new machine type
            this.timing = this.ula.getTiming();
            this.updateDisplayDimensions();  // Recreate imageData for new ULA dimensions
            this.tapeTrap = new TapeTrapHandler(this.cpu, this.memory, this.tapeLoader);
            this.tapeTrap.setEnabled(this.tapeTrapsEnabled);

            // Recreate TR-DOS trap with new CPU/memory, preserve disk data
            const oldDiskData = this.trdosTrap ? this.trdosTrap.diskData : null;
            const oldDiskFiles = this.trdosTrap ? this.trdosTrap.diskFiles : null;
            const oldDiskType = this.trdosTrap ? this.trdosTrap.diskType : null;
            this.trdosTrap = new TRDOSTrapHandler(this.cpu, this.memory);
            this.trdosTrap.setEnabled(this.tapeTrapsEnabled);
            if (oldDiskData) {
                this.trdosTrap.setDisk(oldDiskData, oldDiskFiles, oldDiskType);
            }

            // Re-setup memory callbacks (auto-map + trace + watchpoints)
            this.memory.onRead = (addr, val) => {
                // Auto-map: track non-fetch reads (only during CPU execution)
                if (this.autoMap.enabled && this.autoMap.inExecution && !this.autoMap.currentFetchAddrs.has(addr)) {
                    const key = this.getAutoMapKey(addr);
                    this.autoMap.read.set(key, (this.autoMap.read.get(key) || 0) + 1);
                }
                this.checkReadWatchpoint(addr, val);
            };
            this.memory.onWrite = (addr, val) => {
                // Auto-map: track writes (only during CPU execution)
                if (this.autoMap.enabled && this.autoMap.inExecution) {
                    const key = this.getAutoMapKey(addr);
                    this.autoMap.written.set(key, (this.autoMap.written.get(key) || 0) + 1);
                }
                // Trace: track memory writes
                if ((this.runtimeTraceEnabled || this.traceEnabled) &&
                    this.traceMemOps.length < this.traceMemOpsLimit) {
                    this.traceMemOps.push({ addr, val });
                }
                // Multicolor: disabled (known limitation - see README)
                this.checkWriteWatchpoint(addr, val);
            };
            // Re-setup CPU fetch callback for auto-mapping
            this.cpu.onFetch = (addr) => {
                if (this.autoMap.enabled && this.autoMap.inExecution) {
                    const key = this.getAutoMapKey(addr);
                    this.autoMap.executed.set(key, (this.autoMap.executed.get(key) || 0) + 1);
                    this.autoMap.currentFetchAddrs.add(addr);
                }
            };
            
            // Restore ROM data
            if (oldRom) {
                // Copy ROM bank 0 (always exists)
                if (oldRom[0]) {
                    this.memory.rom[0].set(oldRom[0]);
                }
                // Copy ROM bank 1 if both old and new have it
                if (oldRom[1] && this.memory.rom[1]) {
                    this.memory.rom[1].set(oldRom[1]);
                }
                this.romLoaded = true;
                // Only restart if ROM was preserved
                if (wasRunning) this.start();
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
                } else {
                    throw new Error('Unsupported snapshot type in RZX: ' + snapType);
                }
            }

            // Store original data for project save
            this.rzxData = new Uint8Array(data);

            // Setup RZX playback
            this.rzxPlayer = rzx;
            this.rzxFrame = 0;
            this.rzxTstates = 0;  // Start at beginning of frame 0
            this.rzxPlaying = true;

            return {
                frames: rzx.getFrameCount(),
                creator: rzx.creatorInfo
            };
        }

        rzxStop() {
            this.rzxPlaying = false;
            this.rzxPlayer = null;
            this.rzxFrame = 0;
            this.rzxTstates = 0;
            this.rzxData = null;
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

        getRZXTstates() {
            return this.rzxTstates;
        }

        setRZXTstates(tstates) {
            this.rzxTstates = tstates;
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
     * AudioManager - Handles Web Audio output for AY chip
     */
    class AudioManager {
        constructor(ay, timing) {
            this.ay = ay;
            this.timing = timing;
            this.context = null;
            this.gainNode = null;
            this.processor = null;
            this.enabled = false;
            this.volume = 0.5;
            this.muted = false;

            // Ring buffer for audio samples
            this.bufferSize = 8192;
            this.buffer = [
                new Float32Array(this.bufferSize),
                new Float32Array(this.bufferSize)
            ];
            this.writePos = 0;
            this.readPos = 0;

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
         * Start audio output
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

                // Create script processor for audio output
                // Note: ScriptProcessorNode is deprecated but widely supported
                // AudioWorklet is the modern replacement but more complex
                this.processor = this.context.createScriptProcessor(2048, 0, 2);
                this.processor.onaudioprocess = this.audioCallback.bind(this);
                this.processor.connect(this.gainNode);

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
            if (this.processor) {
                this.processor.disconnect();
                this.processor = null;
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
         * Process one frame of audio
         * Called at end of each emulated frame
         */
        processFrame(frameTstates) {
            if (!this.enabled || !this.ay) return;

            // Generate samples for this frame
            const samplesToGenerate = this.samplesPerFrame;

            // CPU cycles per sample for this frame
            const cyclesPerSample = frameTstates / samplesToGenerate;

            // AY steps per sample
            const ayStepsPerSample = cyclesPerSample * this.ayPerCpu;

            for (let i = 0; i < samplesToGenerate; i++) {
                // Step AY chip
                this.ay.stepMultiple(Math.round(ayStepsPerSample));

                // Get sample
                const [left, right] = this.ay.getAveragedSample();

                // Write to ring buffer
                const pos = this.writePos;
                this.buffer[0][pos] = left;
                this.buffer[1][pos] = right;
                this.writePos = (pos + 1) % this.bufferSize;
            }
        }

        /**
         * Audio callback - fills output buffer from ring buffer
         */
        audioCallback(event) {
            const outputL = event.outputBuffer.getChannelData(0);
            const outputR = event.outputBuffer.getChannelData(1);
            const length = outputL.length;

            for (let i = 0; i < length; i++) {
                // Read from ring buffer
                const pos = this.readPos;

                // Check if we have data
                if (pos !== this.writePos) {
                    outputL[i] = this.buffer[0][pos];
                    outputR[i] = this.buffer[1][pos];
                    this.readPos = (pos + 1) % this.bufferSize;
                } else {
                    // Buffer underrun - output silence
                    outputL[i] = 0;
                    outputR[i] = 0;
                }
            }
        }

        /**
         * Get buffer fill level (0-1)
         */
        getBufferLevel() {
            let fill = this.writePos - this.readPos;
            if (fill < 0) fill += this.bufferSize;
            return fill / this.bufferSize;
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
