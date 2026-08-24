/**
 * ZX-M8XXX - Tape formats: TAP, TZX, WAV + ROM load/save traps and MIC recording
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

import { xorChecksum } from './common.js';

    export class TapeLoader {
        constructor() {
            this.data = null;
            this.blocks = [];
            this.currentBlock = 0;
        }
        
        load(data) {
            this.data = new Uint8Array(data);
            this.blocks = [];
            this.currentBlock = 0;
            
            let offset = 0;
            while (offset < this.data.length - 1) {
                const length = this.data[offset] | (this.data[offset + 1] << 8);
                offset += 2;
                if (offset + length > this.data.length) break;
                this.blocks.push({
                    flag: this.data[offset],
                    data: this.data.slice(offset, offset + length),
                    length: length
                });
                offset += length;
            }
            return this.blocks.length > 0;
        }
        
        getNextBlock() {
            if (this.currentBlock >= this.blocks.length) return null;
            return this.blocks[this.currentBlock++];
        }
        
        rewind() { this.currentBlock = 0; }
        getBlockCount() { return this.blocks.length; }
        hasMoreBlocks() { return this.currentBlock < this.blocks.length; }
        getCurrentBlock() { return this.currentBlock; }
        setCurrentBlock(n) { this.currentBlock = Math.max(0, Math.min(n, this.blocks.length)); }

        /**
         * Get blocks in unified format for TapePlayer
         */
        getUnifiedBlocks() {
            return this.blocks.map(block => ({
                type: 'data',
                flag: block.flag,
                data: block.data,
                length: block.length,
                pilotPulse: 2168,
                pilotCount: (block.flag === 0x00) ? 8063 : 3223,
                sync1Pulse: 667,
                sync2Pulse: 735,
                zeroPulse: 855,
                onePulse: 1710,
                usedBits: 8,
                pauseMs: 1000
            }));
        }
    }

    /**
     * TapePlayer - Real-time tape playback with accurate timing
     * Generates EAR bit stream from TAP blocks at cycle-accurate timing
     */
    export class TapePlayer {
        // Standard ZX Spectrum tape timing constants (in T-states at 3.5MHz)
        static get PILOT_PULSE() { return 2168; }      // Pilot pulse length
        static get SYNC1_PULSE() { return 667; }       // First sync pulse
        static get SYNC2_PULSE() { return 735; }       // Second sync pulse
        static get ZERO_PULSE() { return 855; }        // Zero bit pulse length
        static get ONE_PULSE() { return 1710; }        // One bit pulse length
        static get HEADER_PILOT_COUNT() { return 8063; }  // Pilot pulses for header block
        static get DATA_PILOT_COUNT() { return 3223; }    // Pilot pulses for data block
        static get PAUSE_MS() { return 1000; }         // Pause between blocks (ms)
        static get TSTATES_PER_MS() { return 3500; }   // T-states per millisecond at 3.5MHz
        static get TAIL_PULSE() { return 945; }        // Final tail pulse after data (Swan compatibility)

        constructor() {
            this.blocks = [];           // Unified format blocks
            this.currentBlock = 0;      // Current block index
            this.playing = false;       // Playback state
            this.earBit = false;        // Current EAR output level

            // Playback position within current block
            this.blockTstates = 0;      // T-states elapsed in current block
            this.phase = 'idle';        // Current phase: idle, pilot, sync1, sync2, data, tail, pause, tone, pulses, directRecording
            this.pilotCount = 0;        // Remaining pilot pulses
            this.byteIndex = 0;         // Current byte index in block data
            this.bitIndex = 0;          // Current bit index (7-0) in byte
            this.pulseInBit = 0;        // Which pulse of the bit (0 or 1)
            this.pulseRemaining = 0;    // T-states remaining in current pulse

            // Per-block timing (set in startBlock from block properties)
            this.pilotPulse = TapePlayer.PILOT_PULSE;
            this.sync1Pulse = TapePlayer.SYNC1_PULSE;
            this.sync2Pulse = TapePlayer.SYNC2_PULSE;
            this.zeroPulse = TapePlayer.ZERO_PULSE;
            this.onePulse = TapePlayer.ONE_PULSE;
            this.pauseMs = TapePlayer.PAUSE_MS;
            this.usedBits = 8;

            // Loop support for TZX
            this.loopStack = [];        // Stack of {startBlock, remaining}

            // Pulse sequence support
            this.currentPulseIndex = 0;

            // Accumulated T-states for timing
            this.totalTstates = 0;

            // Edge transitions for audio generation
            this.edgeTransitions = [];  // Array of {tStates, level} recorded during update
            this.frameStartTstates = 0; // T-states at start of current frame

            // Callbacks
            this.onBlockStart = null;   // Called when block starts: (blockIndex, block)
            this.onBlockEnd = null;     // Called when block ends: (blockIndex)
            this.onTapeEnd = null;      // Called when all blocks played
        }

        /**
         * Load blocks from TapeLoader (converts to unified format)
         */
        loadFromTapeLoader(tapeLoader) {
            if (tapeLoader.getUnifiedBlocks) {
                this.blocks = tapeLoader.getUnifiedBlocks();
            } else {
                // Fallback: convert inline
                this.blocks = tapeLoader.blocks.map(block => ({
                    type: 'data',
                    flag: block.flag,
                    data: block.data,
                    length: block.length,
                    pilotPulse: TapePlayer.PILOT_PULSE,
                    pilotCount: (block.flag === 0x00) ? TapePlayer.HEADER_PILOT_COUNT : TapePlayer.DATA_PILOT_COUNT,
                    sync1Pulse: TapePlayer.SYNC1_PULSE,
                    sync2Pulse: TapePlayer.SYNC2_PULSE,
                    zeroPulse: TapePlayer.ZERO_PULSE,
                    onePulse: TapePlayer.ONE_PULSE,
                    usedBits: 8,
                    pauseMs: TapePlayer.PAUSE_MS
                }));
            }
            this.rewind();
        }

        /**
         * Load blocks directly (unified format from TZXLoader)
         */
        loadBlocks(blocks) {
            this.blocks = blocks.slice();
            this.rewind();
        }

        /**
         * Start playback
         */
        play() {
            if (this.blocks.length === 0) return false;
            if (this.currentBlock >= this.blocks.length) this.rewind();
            this.playing = true;
            if (this.phase === 'idle' || this.phase === 'pause') {
                this.startBlock();
            }
            return true;
        }

        /**
         * Stop playback
         */
        stop() {
            this.playing = false;
        }

        /**
         * Rewind to beginning
         */
        rewind() {
            this.currentBlock = 0;
            this.phase = 'idle';
            this.blockTstates = 0;
            this.earBit = false;
            this.totalTstates = 0;
            this.loopStack = [];
            this.currentPulseIndex = 0;
        }

        /**
         * Start playing current block
         */
        startBlock() {
            if (this.currentBlock >= this.blocks.length) {
                this.phase = 'idle';
                this.playing = false;
                if (this.onTapeEnd) this.onTapeEnd();
                return;
            }

            const block = this.blocks[this.currentBlock];
            this.blockTstates = 0;

            // Handle control blocks
            switch (block.type) {
                case 'loopStart':
                    this.loopStack.push({
                        startBlock: this.currentBlock,
                        remaining: block.repetitions - 1
                    });
                    this.currentBlock++;
                    this.startBlock();
                    return;

                case 'loopEnd':
                    this.handleLoopEnd();
                    return;

                case 'stop':
                    this.playing = false;
                    this.phase = 'idle';
                    if (this.onTapeEnd) this.onTapeEnd();
                    return;

                case 'pause':
                    this.phase = 'pause';
                    this.pulseRemaining = block.pauseMs * TapePlayer.TSTATES_PER_MS;
                    this.earBit = false;
                    if (this.onBlockStart) this.onBlockStart(this.currentBlock, block);
                    return;

                case 'directRecording':
                    this.phase = 'directRecording';
                    this.byteIndex = 0;
                    this.bitIndex = 7;
                    this.pauseMs = block.pauseMs || 0;
                    // Set earBit from first sample bit
                    this.earBit = !!((block.data[0] >> 7) & 1);
                    this.pulseRemaining = block.tStatesPerSample;
                    if (this.onBlockStart) this.onBlockStart(this.currentBlock, block);
                    return;

                case 'cswRecording':
                case 'generalizedData':
                    // Unsupported block types - skip to next block
                    this.currentBlock++;
                    this.startBlock();
                    return;

                case 'tone':
                    this.phase = 'tone';
                    this.pilotPulse = block.pulseLength;
                    this.pilotCount = block.pulseCount;
                    this.pulseRemaining = this.pilotPulse;
                    this.pauseMs = 0;  // No pause after pure tone blocks
                    // Swan approach: NO inversion at start, first pulse at current level
                    // Inversion happens in advancePhase before each subsequent pulse
                    if (this.onBlockStart) this.onBlockStart(this.currentBlock, block);
                    return;

                case 'pulses':
                    this.phase = 'pulses';
                    this.currentPulseIndex = 0;
                    this.pulseRemaining = block.pulses[0];
                    this.pauseMs = 0;  // No pause after pulse sequence blocks
                    // Swan approach: NO inversion at start, first pulse at current level
                    // Inversion happens in advancePhase before each subsequent pulse
                    if (this.onBlockStart) this.onBlockStart(this.currentBlock, block);
                    return;

                case 'data':
                default:
                    // Set per-block timing
                    this.pilotPulse = block.pilotPulse || TapePlayer.PILOT_PULSE;
                    this.sync1Pulse = block.sync1Pulse || TapePlayer.SYNC1_PULSE;
                    this.sync2Pulse = block.sync2Pulse || TapePlayer.SYNC2_PULSE;
                    this.zeroPulse = block.zeroPulse || TapePlayer.ZERO_PULSE;
                    this.onePulse = block.onePulse || TapePlayer.ONE_PULSE;
                    this.pauseMs = block.pauseMs !== undefined ? block.pauseMs : TapePlayer.PAUSE_MS;
                    this.usedBits = block.usedBits || 8;

                    // Log turbo block timing (non-standard timing)
                    const isNonStandard = this.pilotPulse !== TapePlayer.PILOT_PULSE ||
                                          this.zeroPulse !== TapePlayer.ZERO_PULSE ||
                                          this.onePulse !== TapePlayer.ONE_PULSE;
                    // Note: turbo timing detected when isNonStandard is true

                    this.byteIndex = 0;
                    this.bitIndex = 7;
                    this.pulseInBit = 0;

                    // Check for pure data (no pilot/sync)
                    if (block.noPilot) {
                        // Handle empty data blocks
                        if (!block.data || block.data.length === 0) {
                            this.phase = 'tail';
                            this.pulseRemaining = TapePlayer.TAIL_PULSE;
                            // Keep earBit as-is for empty blocks
                            return;
                        }
                        this.phase = 'data';
                        // Keep earBit as-is - continue from previous block's state
                        // (important for Speedlock and other protection schemes)
                        this.setupDataPulse(block);
                    } else {
                        // Standard data block with pilot
                        this.pilotCount = block.pilotCount ||
                            ((block.flag === 0x00) ? TapePlayer.HEADER_PILOT_COUNT : TapePlayer.DATA_PILOT_COUNT);
                        this.phase = 'pilot';
                        this.pulseRemaining = this.pilotPulse;
                        // Swan approach: NO inversion at start, first pulse at current level
                        // Inversion happens in advancePhase before each subsequent pulse
                    }

                    if (this.onBlockStart) {
                        this.onBlockStart(this.currentBlock, block);
                    }
            }
        }

        /**
         * Handle loop end block
         */
        handleLoopEnd() {
            if (this.loopStack.length > 0) {
                const loop = this.loopStack[this.loopStack.length - 1];
                if (loop.remaining > 0) {
                    loop.remaining--;
                    this.currentBlock = loop.startBlock + 1;
                } else {
                    this.loopStack.pop();
                    this.currentBlock++;
                }
            } else {
                this.currentBlock++;
            }
            this.startBlock();
        }

        /**
         * Start a new frame - reset edge transitions and record frame start T-states
         */
        startFrame(frameTstates) {
            this.edgeTransitions = [];
            this.frameStartTstates = frameTstates;
        }

        /**
         * Get edge transitions recorded during this frame
         */
        getEdgeTransitions() {
            return this.edgeTransitions;
        }

        /**
         * Record an edge transition at the current T-state position
         */
        recordEdge(absoluteTstates) {
            const frameTstates = absoluteTstates - this.frameStartTstates;
            this.edgeTransitions.push({
                tStates: frameTstates,
                level: this.earBit ? 1 : 0
            });
        }

        /**
         * Advance playback by given number of T-states
         * @param {number} tstates - T-states to advance
         * @param {number} currentAbsoluteTstates - Current absolute T-state (for edge recording)
         * Returns current EAR bit value
         */
        update(tstates, currentAbsoluteTstates = 0) {
            if (!this.playing || this.phase === 'idle') {
                return this.earBit;
            }

            this.totalTstates += tstates;

            while (tstates > 0 && this.playing) {
                if (this.pulseRemaining <= 0) {
                    // Current pulse finished, record edge and advance to next
                    // Edge occurs at: end_time - remaining_tstates
                    const edgeTstates = currentAbsoluteTstates - tstates;
                    if (!this.advancePhase(edgeTstates)) {
                        break;
                    }
                }

                const consumed = Math.min(tstates, this.pulseRemaining);
                this.pulseRemaining -= consumed;
                this.blockTstates += consumed;
                tstates -= consumed;
            }

            return this.earBit;
        }

        /**
         * Advance to next phase/pulse
         * @param {number} edgeTstates - Absolute T-state when this edge occurs
         * Returns false if playback should stop
         */
        advancePhase(edgeTstates = 0) {
            const block = this.blocks[this.currentBlock];

            switch (this.phase) {
                case 'pilot':
                    // Toggle EAR and count down pilot pulses
                    this.earBit = !this.earBit;
                    this.recordEdge(edgeTstates);
                    this.pilotCount--;
                    if (this.pilotCount <= 0) {
                        // Pilot done, move to sync (continue toggle pattern)
                        this.phase = 'sync1';
                        this.pulseRemaining = this.sync1Pulse;
                        // Don't change earBit - let the waveform continue naturally
                    } else {
                        this.pulseRemaining = this.pilotPulse;
                    }
                    break;

                case 'sync1':
                    // First sync pulse done, toggle and move to second
                    this.earBit = !this.earBit;
                    this.recordEdge(edgeTstates);
                    this.phase = 'sync2';
                    this.pulseRemaining = this.sync2Pulse;
                    break;

                case 'sync2':
                    // Sync done, toggle and start data
                    this.earBit = !this.earBit;
                    this.recordEdge(edgeTstates);
                    this.phase = 'data';
                    this.byteIndex = 0;
                    this.bitIndex = 7;
                    this.pulseInBit = 0;
                    this.setupDataPulse(block);
                    break;

                case 'data':
                    // Toggle EAR for data bits (each bit = 2 pulses)
                    this.earBit = !this.earBit;
                    this.recordEdge(edgeTstates);
                    this.pulseInBit++;

                    if (this.pulseInBit >= 2) {
                        // Bit complete, advance to next bit
                        this.pulseInBit = 0;
                        this.bitIndex--;

                        // Handle last byte with partial bits (usedBits < 8)
                        const isLastByte = (this.byteIndex === block.data.length - 1);
                        const minBit = isLastByte ? (8 - this.usedBits) : 0;

                        if (this.bitIndex < minBit) {
                            this.bitIndex = 7;
                            this.byteIndex++;
                            if (this.byteIndex >= block.data.length) {
                                // Block complete

                                // Only add tail pulse for standard data blocks (with pilot)
                                // Pure Data (noPilot) blocks: no tail pulse, respect pause from TZX
                                if (block.noPilot) {
                                    if (this.onBlockEnd) this.onBlockEnd(this.currentBlock);

                                    // If pause > 0, honor it; if 0, directly advance (no auto-pause)
                                    if (this.pauseMs > 0) {
                                        this.phase = 'pause';
                                        this.pulseRemaining = this.pauseMs * TapePlayer.TSTATES_PER_MS;
                                        this.earBit = false;
                                    } else {
                                        // Directly advance to next block (no pause for protection schemes)
                                        this.currentBlock++;
                                        if (this.currentBlock >= this.blocks.length) {
                                            this.phase = 'idle';
                                            this.playing = false;
                                            if (this.onTapeEnd) this.onTapeEnd();
                                        } else {
                                            this.startBlock();
                                        }
                                    }
                                } else {
                                    // Add a tail pulse (like Swan) to ensure clean termination
                                    this.phase = 'tail';
                                    this.pulseRemaining = TapePlayer.TAIL_PULSE;
                                }
                                return this.playing;
                            }
                        }
                    }
                    this.setupDataPulse(block);
                    break;

                case 'tail':
                    // Tail pulse complete - toggle and end block
                    this.earBit = !this.earBit;
                    this.recordEdge(edgeTstates);
                    this.endBlock();
                    break;

                case 'tone':
                    // Pure tone - toggle and count pulses
                    this.earBit = !this.earBit;
                    this.recordEdge(edgeTstates);
                    this.pilotCount--;
                    if (this.pilotCount <= 0) {
                        // Immediately advance to next block (no pause for tone blocks)
                        if (this.onBlockEnd) this.onBlockEnd(this.currentBlock);
                        this.currentBlock++;
                        if (this.currentBlock >= this.blocks.length) {
                            this.phase = 'idle';
                            this.playing = false;
                            if (this.onTapeEnd) this.onTapeEnd();
                        } else {
                            this.startBlock();
                        }
                    } else {
                        this.pulseRemaining = this.pilotPulse;
                    }
                    break;

                case 'pulses':
                    // Pulse sequence - advance through pulse array
                    this.earBit = !this.earBit;
                    this.recordEdge(edgeTstates);
                    this.currentPulseIndex++;
                    if (this.currentPulseIndex >= block.pulses.length) {
                        // Immediately advance to next block (no pause for pulse blocks)
                        if (this.onBlockEnd) this.onBlockEnd(this.currentBlock);
                        this.currentBlock++;
                        if (this.currentBlock >= this.blocks.length) {
                            this.phase = 'idle';
                            this.playing = false;
                            if (this.onTapeEnd) this.onTapeEnd();
                        } else {
                            this.startBlock();
                        }
                    } else {
                        this.pulseRemaining = block.pulses[this.currentPulseIndex];
                    }
                    break;

                case 'directRecording': {
                    // Advance to next sample bit
                    this.bitIndex--;
                    const isLastByte = (this.byteIndex === block.data.length - 1);
                    const minBit = isLastByte ? (8 - block.usedBits) : 0;

                    if (this.bitIndex < minBit) {
                        this.bitIndex = 7;
                        this.byteIndex++;
                        if (this.byteIndex >= block.data.length) {
                            // All samples consumed
                            if (this.onBlockEnd) this.onBlockEnd(this.currentBlock);
                            if (this.pauseMs > 0) {
                                this.phase = 'pause';
                                this.pulseRemaining = this.pauseMs * TapePlayer.TSTATES_PER_MS;
                                this.earBit = false;
                            } else {
                                this.currentBlock++;
                                if (this.currentBlock >= this.blocks.length) {
                                    this.phase = 'idle';
                                    this.playing = false;
                                    if (this.onTapeEnd) this.onTapeEnd();
                                } else {
                                    this.startBlock();
                                }
                            }
                            return this.playing;
                        }
                    }

                    // Set earBit from sample bit, record edge on level change
                    const sampleBit = !!((block.data[this.byteIndex] >> this.bitIndex) & 1);
                    if (sampleBit !== this.earBit) {
                        this.earBit = sampleBit;
                        this.recordEdge(edgeTstates);
                    }
                    this.pulseRemaining = block.tStatesPerSample;
                    break;
                }

                case 'pause':
                    // Pause complete, start next block
                    this.currentBlock++;
                    if (this.currentBlock >= this.blocks.length) {
                        this.phase = 'idle';
                        this.playing = false;
                        this.earBit = false;
                        if (this.onTapeEnd) this.onTapeEnd();
                        return false;
                    }
                    this.startBlock();
                    break;

                case 'idle':
                    return false;
            }

            return true;
        }

        /**
         * Setup pulse length for current data bit
         */
        setupDataPulse(block) {
            const byteVal = block.data[this.byteIndex];
            const bit = (byteVal >> this.bitIndex) & 1;
            this.pulseRemaining = bit ? this.onePulse : this.zeroPulse;
        }

        /**
         * Handle end of block
         */
        endBlock() {
            if (this.onBlockEnd) {
                this.onBlockEnd(this.currentBlock);
            }

            // Move to pause phase (use per-block pause from TZX)
            // When pauseMs=0, add a small automatic pause (~1 frame) to give the loader time to start
            // This synchronization is needed because the loader code needs CPU time to begin
            // looking for pilot after the previous block finishes loading
            const MIN_PAUSE_TSTATES = 1750000;  // ~500ms at 3.5MHz - gives loader time to start
            const effectivePause = this.pauseMs > 0 ?
                this.pauseMs * TapePlayer.TSTATES_PER_MS :
                MIN_PAUSE_TSTATES;

            this.phase = 'pause';
            this.pulseRemaining = effectivePause;
            this.earBit = false;
        }

        /**
         * Get current playback position info
         */
        getPosition() {
            // Calculate progress within current block
            const block = this.blocks[this.currentBlock];
            const blockBytes = block && block.data ? block.data.length : 0;
            let blockProgress = 0;

            if ((this.phase === 'data' || this.phase === 'directRecording') && blockBytes > 0) {
                // During data/directRecording phase, show byte progress
                blockProgress = Math.round((this.byteIndex / blockBytes) * 100);
            } else if (this.phase === 'pulses' && block && block.pulses && block.pulses.length > 0) {
                // During pulse sequence phase, show pulse progress
                blockProgress = Math.round((this.currentPulseIndex / block.pulses.length) * 100);
            } else if (this.phase === 'pilot' || this.phase === 'sync1' || this.phase === 'sync2') {
                // During pilot/sync, show 0%
                blockProgress = 0;
            } else if (this.phase === 'tail' || this.phase === 'pause' || this.phase === 'idle') {
                // After block complete (tail, pause, or idle)
                blockProgress = 100;
            }

            return {
                block: this.currentBlock,
                totalBlocks: this.blocks.length,
                phase: this.phase,
                playing: this.playing,
                totalTstates: this.totalTstates,
                blockBytes,
                byteIndex: this.byteIndex,
                blockProgress
            };
        }

        /**
         * Check if tape is playing
         */
        isPlaying() {
            return this.playing;
        }

        /**
         * Get current EAR bit
         */
        getEarBit() {
            return this.earBit;
        }

        /**
         * Skip to specific block
         */
        setBlock(n) {
            this.currentBlock = Math.max(0, Math.min(n, this.blocks.length));
            this.phase = 'idle';
            this.blockTstates = 0;
            if (this.playing && this.currentBlock < this.blocks.length) {
                this.startBlock();
            }
        }

        /**
         * Get block count
         */
        getBlockCount() {
            return this.blocks.length;
        }

        /**
         * Check if more blocks available
         */
        hasMoreBlocks() {
            return this.currentBlock < this.blocks.length;
        }
    }

    /**
     * TZXLoader - TZX tape format parser
     * Converts TZX blocks to unified format for TapePlayer
     */
    export class TZXLoader {
        constructor() {
            this.data = null;
            this.blocks = [];
            this.metadata = {};
            this.currentBlock = 0;
            this.version = { major: 0, minor: 0 };
        }

        /**
         * Check if data is a TZX file
         */
        static isTZX(data) {
            const bytes = new Uint8Array(data);
            if (bytes.length < 10) return false;
            const header = String.fromCharCode(...bytes.slice(0, 7));
            return header === 'ZXTape!' && bytes[7] === 0x1A;
        }

        /**
         * Load and parse TZX file
         */
        load(data) {
            this.data = new Uint8Array(data);
            this.blocks = [];
            this.metadata = {};
            this.currentBlock = 0;

            if (!TZXLoader.isTZX(data)) return false;

            this.version.major = this.data[8];
            this.version.minor = this.data[9];

            let offset = 10;
            while (offset < this.data.length) {
                const blockId = this.data[offset++];
                const result = this.parseBlock(blockId, offset);
                if (!result) break;

                if (result.block) {
                    this.blocks.push(result.block);
                }
                offset += result.length;
            }

            return this.blocks.length > 0;
        }

        /**
         * Parse a single TZX block
         */
        parseBlock(blockId, offset) {
            const data = this.data;

            // Blocks with no payload are valid as the last thing in the file, where
            // offset == data.length — so they're handled before the "any bytes left?"
            // guard that protects the parsers which do read a payload
            switch (blockId) {
                case 0x22: return { length: 0 }; // Group End
                case 0x25: return { block: { type: 'loopEnd' }, length: 0 };
                case 0x27: return { length: 0 }; // Return from sequence
            }

            if (offset >= data.length) return null;

            switch (blockId) {
                case 0x10: return this.parseStandardData(offset);
                case 0x11: return this.parseTurboData(offset);
                case 0x12: return this.parsePureTone(offset);
                case 0x13: return this.parsePulseSequence(offset);
                case 0x14: return this.parsePureData(offset);
                case 0x15: return this.parseDirectRecording(offset);
                case 0x18: return this.parseCSWRecording(offset);
                case 0x19: return this.parseGeneralizedData(offset);
                case 0x20: return this.parsePause(offset);
                case 0x21: return this.parseGroupStart(offset);
                case 0x23: return this.parseJump(offset);
                case 0x24: return this.parseLoopStart(offset);
                case 0x26: return this.parseCallSequence(offset);
                case 0x28: return this.parseSelect(offset);
                case 0x2A: return { length: 4 }; // Stop if 48K
                case 0x2B: return { length: 5 }; // Set signal level
                case 0x30: return this.parseTextDescription(offset);
                case 0x31: return this.parseMessage(offset);
                case 0x32: return this.parseArchiveInfo(offset);
                case 0x33: return this.parseHardwareType(offset);
                case 0x35: return this.parseCustomInfo(offset);
                case 0x5A: return { length: 9 }; // Glue block
                default:
                    // Unknown block - try to skip using length field
                    if (offset + 4 <= data.length) {
                        const len = data[offset] | (data[offset + 1] << 8) |
                                   (data[offset + 2] << 16) | (data[offset + 3] << 24);
                        return { length: 4 + len };
                    }
                    return null;
            }
        }

        /**
         * Block 0x10 - Standard Speed Data (like TAP)
         */
        parseStandardData(offset) {
            const data = this.data;
            const pause = data[offset] | (data[offset + 1] << 8);
            const dataLen = data[offset + 2] | (data[offset + 3] << 8);

            if (offset + 4 + dataLen > data.length) return null;

            const blockData = data.slice(offset + 4, offset + 4 + dataLen);
            const flag = blockData.length > 0 ? blockData[0] : 0;

            return {
                block: {
                    type: 'data',
                    flag: flag,
                    data: blockData,
                    length: dataLen,
                    pilotPulse: 2168,
                    pilotCount: (flag === 0x00) ? 8063 : 3223,
                    sync1Pulse: 667,
                    sync2Pulse: 735,
                    zeroPulse: 855,
                    onePulse: 1710,
                    usedBits: 8,
                    pauseMs: pause
                },
                length: 4 + dataLen
            };
        }

        /**
         * Block 0x11 - Turbo Speed Data
         */
        parseTurboData(offset) {
            const data = this.data;
            const pilotPulse = data[offset] | (data[offset + 1] << 8);
            const sync1Pulse = data[offset + 2] | (data[offset + 3] << 8);
            const sync2Pulse = data[offset + 4] | (data[offset + 5] << 8);
            const zeroPulse = data[offset + 6] | (data[offset + 7] << 8);
            const onePulse = data[offset + 8] | (data[offset + 9] << 8);
            const pilotCount = data[offset + 10] | (data[offset + 11] << 8);
            const usedBitsRaw = data[offset + 12];
            const usedBits = usedBitsRaw || 8;
            const pause = data[offset + 13] | (data[offset + 14] << 8);
            const dataLen = data[offset + 15] | (data[offset + 16] << 8) | (data[offset + 17] << 16);

            if (offset + 18 + dataLen > data.length) return null;

            const blockData = data.slice(offset + 18, offset + 18 + dataLen);

            return {
                block: {
                    type: 'data',
                    flag: blockData[0],
                    data: blockData,
                    length: dataLen,
                    pilotPulse,
                    pilotCount,
                    sync1Pulse,
                    sync2Pulse,
                    zeroPulse,
                    onePulse,
                    usedBits,
                    pauseMs: pause
                },
                length: 18 + dataLen
            };
        }

        /**
         * Block 0x12 - Pure Tone
         */
        parsePureTone(offset) {
            const data = this.data;
            return {
                block: {
                    type: 'tone',
                    pulseLength: data[offset] | (data[offset + 1] << 8),
                    pulseCount: data[offset + 2] | (data[offset + 3] << 8)
                },
                length: 4
            };
        }

        /**
         * Block 0x13 - Pulse Sequence
         */
        parsePulseSequence(offset) {
            const data = this.data;
            const count = data[offset];
            const pulses = [];

            for (let i = 0; i < count; i++) {
                pulses.push(data[offset + 1 + i * 2] | (data[offset + 2 + i * 2] << 8));
            }

            return {
                block: {
                    type: 'pulses',
                    pulses
                },
                length: 1 + count * 2
            };
        }

        /**
         * Block 0x14 - Pure Data (no pilot/sync)
         */
        parsePureData(offset) {
            const data = this.data;
            const zeroPulse = data[offset] | (data[offset + 1] << 8);
            const onePulse = data[offset + 2] | (data[offset + 3] << 8);
            const usedBits = data[offset + 4] || 8;
            const pause = data[offset + 5] | (data[offset + 6] << 8);
            const dataLen = data[offset + 7] | (data[offset + 8] << 8) | (data[offset + 9] << 16);

            if (offset + 10 + dataLen > data.length) return null;

            const blockData = data.slice(offset + 10, offset + 10 + dataLen);

            return {
                block: {
                    type: 'data',
                    flag: blockData.length > 0 ? blockData[0] : 0,
                    data: blockData,
                    length: dataLen,
                    zeroPulse,
                    onePulse,
                    usedBits,
                    pauseMs: pause,
                    noPilot: true
                },
                length: 10 + dataLen
            };
        }

        /**
         * Block 0x15 - Direct Recording
         */
        parseDirectRecording(offset) {
            const data = this.data;
            const tStatesPerSample = data[offset] | (data[offset + 1] << 8);
            const pauseMs = data[offset + 2] | (data[offset + 3] << 8);
            const usedBits = data[offset + 4] || 8;
            const dataLen = data[offset + 5] | (data[offset + 6] << 8) | (data[offset + 7] << 16);
            return {
                block: {
                    type: 'directRecording',
                    tStatesPerSample,
                    pauseMs,
                    usedBits,
                    dataLength: dataLen,
                    data: data.slice(offset + 8, offset + 8 + dataLen)
                },
                length: 8 + dataLen
            };
        }

        /**
         * Block 0x18 - CSW Recording (skip only, no playback)
         */
        parseCSWRecording(offset) {
            const data = this.data;
            const blockLen = data[offset] | (data[offset + 1] << 8) |
                             (data[offset + 2] << 16) | (data[offset + 3] << 24);
            return {
                block: { type: 'cswRecording', dataLength: blockLen },
                length: 4 + blockLen
            };
        }

        /**
         * Block 0x19 - Generalized Data (skip only, no playback)
         */
        parseGeneralizedData(offset) {
            const data = this.data;
            const blockLen = data[offset] | (data[offset + 1] << 8) |
                             (data[offset + 2] << 16) | (data[offset + 3] << 24);
            return {
                block: { type: 'generalizedData', dataLength: blockLen },
                length: 4 + blockLen
            };
        }

        /**
         * Block 0x20 - Pause/Stop
         */
        parsePause(offset) {
            const pause = this.data[offset] | (this.data[offset + 1] << 8);
            return {
                block: {
                    type: pause === 0 ? 'stop' : 'pause',
                    pauseMs: pause
                },
                length: 2
            };
        }

        /**
         * Block 0x21 - Group Start
         */
        parseGroupStart(offset) {
            const len = this.data[offset];
            return { length: 1 + len };
        }

        /**
         * Block 0x23 - Jump to Block
         */
        parseJump(offset) {
            return { length: 2 };
        }

        /**
         * Block 0x24 - Loop Start
         */
        parseLoopStart(offset) {
            const repetitions = this.data[offset] | (this.data[offset + 1] << 8);
            return {
                block: {
                    type: 'loopStart',
                    repetitions
                },
                length: 2
            };
        }

        /**
         * Block 0x26 - Call Sequence
         */
        parseCallSequence(offset) {
            const count = this.data[offset] | (this.data[offset + 1] << 8);
            return { length: 2 + count * 2 };
        }

        /**
         * Block 0x28 - Select Block
         */
        parseSelect(offset) {
            const len = this.data[offset] | (this.data[offset + 1] << 8);
            return { length: 2 + len };
        }

        /**
         * Block 0x30 - Text Description
         */
        parseTextDescription(offset) {
            const len = this.data[offset];
            return { length: 1 + len };
        }

        /**
         * Block 0x31 - Message
         */
        parseMessage(offset) {
            const len = this.data[offset + 1];
            return { length: 2 + len };
        }

        /**
         * Block 0x32 - Archive Info
         */
        parseArchiveInfo(offset) {
            const len = this.data[offset] | (this.data[offset + 1] << 8);
            return { length: 2 + len };
        }

        /**
         * Block 0x33 - Hardware Type
         */
        parseHardwareType(offset) {
            const count = this.data[offset];
            return { length: 1 + count * 3 };
        }

        /**
         * Block 0x35 - Custom Info
         */
        parseCustomInfo(offset) {
            const len = this.data[offset + 16] | (this.data[offset + 17] << 8) |
                       (this.data[offset + 18] << 16) | (this.data[offset + 19] << 24);
            return { length: 20 + len };
        }

        // Navigation methods (same interface as TapeLoader)
        getNextBlock() {
            if (this.currentBlock >= this.blocks.length) return null;
            return this.blocks[this.currentBlock++];
        }

        rewind() { this.currentBlock = 0; }
        getBlockCount() { return this.blocks.length; }
        hasMoreBlocks() { return this.currentBlock < this.blocks.length; }
        getCurrentBlock() { return this.currentBlock; }
        setCurrentBlock(n) { this.currentBlock = Math.max(0, Math.min(n, this.blocks.length)); }
    }

    /**
     * WAV file loader - converts PCM audio to edge-timed pulse sequence
     */
    export class WAVLoader {
        static isWAV(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            if (bytes.length < 12) return false;
            // RIFF....WAVE
            return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
                   bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
        }

        load(data) {
            // Ensure correct Uint8Array view (preserve offset/length for subarrays)
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            if (!WAVLoader.isWAV(bytes)) return false;

            // Parse RIFF chunks - scan for 'fmt ' and 'data'
            let fmtChunk = null;
            let dataChunk = null;
            let offset = 12; // skip RIFF header + WAVE

            while (offset + 8 <= bytes.length) {
                const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
                const chunkSize = bytes[offset + 4] | (bytes[offset + 5] << 8) |
                                  (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);

                if (chunkId === 'fmt ') {
                    fmtChunk = { offset: offset + 8, size: chunkSize };
                } else if (chunkId === 'data') {
                    dataChunk = { offset: offset + 8, size: chunkSize };
                }

                offset += 8 + chunkSize;
                // Chunks are word-aligned
                if (chunkSize & 1) offset++;
            }

            if (!fmtChunk || !dataChunk) {
                throw new Error('WAV: missing fmt or data chunk');
            }

            // Parse fmt chunk
            const fmt = fmtChunk.offset;
            const audioFormat = bytes[fmt] | (bytes[fmt + 1] << 8);
            if (audioFormat !== 1) {
                throw new Error('WAV: only PCM format supported (got ' + audioFormat + ')');
            }
            const channels = bytes[fmt + 2] | (bytes[fmt + 3] << 8);
            const sampleRate = bytes[fmt + 4] | (bytes[fmt + 5] << 8) |
                               (bytes[fmt + 6] << 16) | (bytes[fmt + 7] << 24);
            const bitsPerSample = bytes[fmt + 14] | (bytes[fmt + 15] << 8);

            if (bitsPerSample !== 8 && bitsPerSample !== 16) {
                throw new Error('WAV: only 8-bit and 16-bit PCM supported (got ' + bitsPerSample + ')');
            }

            // Convert PCM to edge-timed pulse sequence for precise turbo loading.
            // directRecording (1-bit packed) quantizes edges to sample boundaries (~79 T-states
            // at 44100Hz), causing up to ±79 T-state jitter per edge — fatal for turbo loaders
            // with ~200-300 T-state pulses. Instead, detect zero-crossings with linear
            // interpolation for sub-sample precision, then store as pulse durations.
            const bytesPerSample = bitsPerSample / 8;
            const frameSize = bytesPerSample * channels;
            const dataEnd = Math.min(dataChunk.offset + dataChunk.size, bytes.length);
            const totalSamples = Math.floor((dataEnd - dataChunk.offset) / frameSize);

            // Pass 1: find min/max for midpoint
            let minSample = Infinity, maxSample = -Infinity;
            let scanOffset = dataChunk.offset;
            for (let i = 0; i < totalSamples; i++) {
                let s;
                if (bitsPerSample === 8) {
                    s = bytes[scanOffset] - 128;
                } else {
                    s = (bytes[scanOffset] | (bytes[scanOffset + 1] << 8));
                    if (s >= 0x8000) s -= 0x10000;
                }
                if (s < minSample) minSample = s;
                if (s > maxSample) maxSample = s;
                scanOffset += frameSize;
            }

            const midpoint = (minSample + maxSample) / 2;
            const tStatesPerSampleFloat = 3500000 / sampleRate;
            const duration = totalSamples / sampleRate;

            // Pass 2: AC-coupled zero-crossing detection with linear interpolation.
            // The ZX Spectrum EAR circuit has AC coupling (capacitor removes DC offset)
            // followed by a Schmitt trigger. This means the effective threshold adapts
            // to the signal's local DC level. We simulate this with a high-pass filter:
            // ac_signal = raw_signal - low_pass(raw_signal), then detect zero crossings.
            // Time constant ~5ms balances DC tracking vs preserving turbo pulses (~80µs).
            const dcAlpha = 1.0 / (sampleRate * 0.005); // 5ms time constant

            // Read first sample
            let prevRaw;
            if (bitsPerSample === 8) {
                prevRaw = bytes[dataChunk.offset] - 128;
            } else {
                prevRaw = (bytes[dataChunk.offset] | (bytes[dataChunk.offset + 1] << 8));
                if (prevRaw >= 0x8000) prevRaw -= 0x10000;
            }
            let dc = prevRaw; // Initialize DC estimate to first sample
            let prevAC = prevRaw - dc; // AC-coupled value (0 at start)
            const initialLevel = prevRaw > midpoint; // Use global midpoint for initial level only

            const crossings = [];
            let sampleOffset = dataChunk.offset + frameSize;
            for (let i = 1; i < totalSamples; i++) {
                let sample;
                if (bitsPerSample === 8) {
                    sample = bytes[sampleOffset] - 128;
                } else {
                    sample = (bytes[sampleOffset] | (bytes[sampleOffset + 1] << 8));
                    if (sample >= 0x8000) sample -= 0x10000;
                }

                // Update DC estimate (exponential moving average)
                dc += dcAlpha * (sample - dc);
                // AC-coupled signal: remove DC component
                const ac = sample - dc;

                // Detect zero-crossing in AC-coupled signal
                if ((prevAC < 0 && ac >= 0) || (prevAC >= 0 && ac < 0)) {
                    // Linear interpolation for sub-sample crossing position
                    const denom = ac - prevAC;
                    const fraction = denom !== 0 ? (0 - prevAC) / denom : 0.5;
                    crossings.push((i - 1) + fraction);
                }

                prevAC = ac;
                sampleOffset += frameSize;
            }

            // Convert crossings to pulse durations (T-states)
            const pulses = [];
            let prevPos = 0;
            for (const pos of crossings) {
                const dur = Math.round((pos - prevPos) * tStatesPerSampleFloat);
                if (dur > 0) pulses.push(dur);
                prevPos = pos;
            }
            // Final pulse: from last crossing to end of WAV
            const finalDur = Math.round((totalSamples - prevPos) * tStatesPerSampleFloat);
            if (finalDur > 0) pulses.push(finalDur);

            // Use 'pulses' block type — TapePlayer toggles earBit at each pulse boundary.
            // The 'pulses' startBlock keeps earBit at its current level for pulses[0],
            // so we prepend a minimal setup block to establish the correct initial level.
            this.blocks = [];
            // Set initial EAR level with a tone block of 1 pulse (immediate)
            if (initialLevel) {
                // Need earBit = true before pulses block starts.
                // Tone block toggles earBit once, so if earBit starts false (default),
                // after tone of 1 pulse earBit = true.
                this.blocks.push({
                    type: 'tone',
                    pulseLength: 1,
                    pulseCount: 1
                });
            }
            this.blocks.push({
                type: 'pulses',
                pulses: pulses
            });

            this.metadata = { sampleRate, bitsPerSample, channels, duration, totalSamples };

            return true;
        }

        getBlockCount() { return this.blocks ? this.blocks.length : 0; }
    }

    // .z80 RLE decompression. `isV1` selects the version 1 end marker
    // (00 ED ED 00) — v2/v3 blocks are length-prefixed and that byte sequence is
    // ordinary data there, per the .z80 spec. Shared with ui/compare-tool.js.
    export class TapeTrapHandler {
        constructor(cpu, memory, tapeLoader) {
            this.cpu = cpu;
            this.memory = memory;
            this.tapeLoader = tapeLoader;
            this.enabled = true;
            this.onBlockLoaded = null;  // Callback(blockIndex) called after each successful flash load
        }

        checkTrap() {
            if (!this.enabled) return false;
            const pc = this.cpu.pc;
            // LD-BYTES entry points in 48K ROM / 128K ROM1
            // 0x0556 / 0x056C: standard entry — flag in A, carry in F
            // 0x0569: mid-routine entry used by custom loaders that do their own
            //         preamble (border color, EAR sampling) then CALL 0569h —
            //         flag in A' and carry in F' (caller already did EX AF,AF')
            if (pc === 0x056c || pc === 0x0556 || pc === 0x0569) {
                // In 128K mode, only trap when ROM 1 (48K BASIC) is active
                // ROM 0 is the 128K editor which has different code at these addresses
                if (this.memory.profile.ramPages > 1) {
                    // Check that the current ROM bank is the 48K BASIC ROM
                    const basicRomBank = this.memory.profile.basicRomBank;
                    if (this.memory.currentRomBank !== basicRomBank) {
                        return false;  // Don't trap - wrong ROM bank
                    }
                }
                // Also don't trap if TR-DOS ROM is active
                if (this.memory.trdosActive) {
                    return false;
                }
                // …or the +D, for the same reason. With its ROM paged in, $0556
                // is PUSH AF inside the +D's save-state routine, not LD-BYTES.
                // Trapping it returned through a stack holding a pushed AF, so
                // the +D jumped to a register pair, ran off into RAM and reset
                // the machine — which looked like +D disk emulation was broken.
                if (this.memory.plusDActive) {
                    return false;
                }
                // No tape data or no blocks - return error immediately (no EAR emulation)
                if (!this.tapeLoader || this.tapeLoader.getBlockCount() === 0 || !this.tapeLoader.hasMoreBlocks()) {
                    this.cpu.f &= ~0x01;  // Clear carry = error
                    this.returnFromTrap();
                    return true;
                }
                return this.handleLoadTrap(pc === 0x0569);
            }
            return false;
        }

        handleLoadTrap(midEntry = false) {
            const block = this.tapeLoader.getNextBlock();
            if (!block) {
                // All blocks consumed - return with error (carry clear)
                this.cpu.f &= ~0x01;
                this.returnFromTrap();
                return true;
            }

            const dest = this.cpu.ix;
            const length = this.cpu.de;
            // At 0x0569 mid-entry, the caller already did EX AF,AF' so flag/carry
            // are in the shadow registers; at standard entry they're in A/F
            const expectedFlag = midEntry ? this.cpu.a_ : this.cpu.a;
            const isLoad = midEntry ? (this.cpu.f_ & 0x01) !== 0 : (this.cpu.f & 0x01) !== 0;

            if (block.flag !== expectedFlag) {
                this.cpu.f &= ~0x01;
                this.returnFromTrap();
                return true;
            }
            
            if (xorChecksum(block.data) !== 0) {
                this.cpu.f &= ~0x01;
                this.returnFromTrap();
                return true;
            }
            
            if (isLoad) {
                const dataLength = Math.min(length, block.data.length - 2);
                for (let i = 0; i < dataLength; i++) {
                    this.memory.write(dest + i, block.data[1 + i]);
                }
                // Update IX to point past loaded data (as ROM does)
                this.cpu.ix = (dest + dataLength) & 0xffff;
                // Update DE to remaining bytes (should be 0 on success)
                this.cpu.de = (length - dataLength) & 0xffff;
            }
            this.cpu.f |= 0x01;

            // Notify that a block was successfully loaded (for turbo block handling)
            if (this.onBlockLoaded) {
                this.onBlockLoaded(this.tapeLoader.getCurrentBlock() - 1);
            }

            this.returnFromTrap();
            return true;
        }

        returnFromTrap() {
            const retAddr = this.memory.read(this.cpu.sp) | (this.memory.read(this.cpu.sp + 1) << 8);
            this.cpu.sp = (this.cpu.sp + 2) & 0xffff;
            this.cpu.pc = retAddr;
        }
        
        setTape(tapeLoader) { this.tapeLoader = tapeLoader; }
        setEnabled(enabled) { this.enabled = enabled; }
    }

    /**
     * Tape SAVE trap handler - intercepts SA_BYTES ROM call (0x04C2)
     * Captures saved data and builds TAP blocks for export
     */
    export class TapeSaveTrapHandler {
        constructor(cpu, memory) {
            this.cpu = cpu;
            this.memory = memory;
            this.enabled = true;
            this.onBlockSaved = null;  // Callback(tapBlock, flag)
        }

        checkTrap() {
            if (!this.enabled) return false;
            if (this.cpu.pc !== 0x04C2) return false;

            // In 128K mode, only trap in BASIC ROM
            if (this.memory.profile.ramPages > 1) {
                if (this.memory.currentRomBank !== this.memory.profile.basicRomBank) return false;
            }
            // Don't trap under TR-DOS, or with the +D ROM paged in (see LD-BYTES)
            if (this.memory.trdosActive) return false;
            if (this.memory.plusDActive) return false;

            // Note: no carry flag check. Unlike LD_BYTES (0x0556) which uses carry
            // to distinguish LOAD (carry set) from VERIFY (carry clear), SA_BYTES is
            // only called for SAVE operations. The ROM's header save does XOR A before
            // CALL SA_BYTES, which clears carry — but it's still a real save.

            return this.handleSaveTrap();
        }

        handleSaveTrap() {
            const flag = this.cpu.a;        // 0x00=header, 0xFF=data
            const start = this.cpu.ix;
            const length = this.cpu.de;

            // Read data from memory
            const data = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
                data[i] = this.memory.read((start + i) & 0xFFFF);
            }

            // Compute checksum (XOR of flag + all data bytes)
            const checksum = xorChecksum(data, flag, length);

            // Build TAP block: [length_lo][length_hi][flag][data...][checksum]
            const blockLen = length + 2;  // flag + data + checksum
            const tapBlock = new Uint8Array(blockLen + 2);
            tapBlock[0] = blockLen & 0xFF;
            tapBlock[1] = (blockLen >> 8) & 0xFF;
            tapBlock[2] = flag;
            tapBlock.set(data, 3);
            tapBlock[blockLen + 1] = checksum;

            if (this.onBlockSaved) this.onBlockSaved(tapBlock, flag);

            // Simulate register state as if SA_BYTES ran to completion.
            // SA_BYTES does INC DE / DEC IX at entry (to include flag byte),
            // then loops through all bytes. On exit: IX advanced past data,
            // DE = 0xFFFF (counter underflows from 0 to -1 after parity byte).
            this.cpu.ix = (start + length) & 0xFFFF;
            this.cpu.de = 0xFFFF;
            this.cpu.f |= 0x01;  // carry set = success

            // Pop return address from stack (same as load trap).
            // SA_BYTES is entered via CALL (header) or JP (data); in both cases
            // the correct return address is on the stack at this point.
            const retAddr = this.memory.read(this.cpu.sp) | (this.memory.read(this.cpu.sp + 1) << 8);
            this.cpu.sp = (this.cpu.sp + 2) & 0xFFFF;
            this.cpu.pc = retAddr;
            return true;
        }

        setEnabled(enabled) { this.enabled = enabled; }
    }

    /**
     * MIC bit recorder — captures port 0xFE bit 3 (MIC output) pulse timings
     * for games that use custom save routines bypassing the ROM.
     * Produces TZX Direct Recording blocks.
     */
    export class MicRecorder {
        constructor(tstatesPerFrame) {
            this.tstatesPerFrame = tstatesPerFrame;
            this.enabled = true;
            this.lastMicBit = 0;
            this.lastChangeAbsT = 0;
            this.totalFrames = 0;
            this.currentPulses = [];    // Pulse durations for current block
            this.initialLevel = 0;      // MIC level at start of current block
            this.inBlock = false;
            this.blocks = [];           // Completed { pulses, initialLevel } blocks
            this.silenceFrames = 50;    // ~1 second at 50fps = end of block
            this.minPulses = 100;       // Minimum pulses to consider a valid block (skip noise)
            this.onBlockRecorded = null;
        }

        _absT(cpuTStates) {
            return this.totalFrames * this.tstatesPerFrame + cpuTStates;
        }

        writeMic(micBit, cpuTStates) {
            if (!this.enabled) return;
            micBit = micBit & 1;
            if (micBit === this.lastMicBit) return;

            const absT = this._absT(cpuTStates);

            if (!this.inBlock) {
                // First transition after silence — start recording
                this.inBlock = true;
                this.initialLevel = micBit;  // Level after this transition
                this.currentPulses = [];
            } else {
                this.currentPulses.push(absT - this.lastChangeAbsT);
            }

            this.lastMicBit = micBit;
            this.lastChangeAbsT = absT;
        }

        onFrameEnd(cpuTStates) {
            this.totalFrames++;
            if (!this.inBlock) return;
            const absT = this._absT(cpuTStates);
            const silenceT = absT - this.lastChangeAbsT;
            if (silenceT > this.silenceFrames * this.tstatesPerFrame) {
                this._finalizeBlock();
            }
        }

        _finalizeBlock() {
            if (this.currentPulses.length >= this.minPulses) {
                const block = {
                    pulses: this.currentPulses,
                    initialLevel: this.initialLevel
                };
                this.blocks.push(block);
                if (this.onBlockRecorded) this.onBlockRecorded(block);
            }
            this.inBlock = false;
            this.currentPulses = [];
        }

        flush(cpuTStates) {
            if (this.inBlock && this.currentPulses.length > 0) {
                this._finalizeBlock();
            }
        }

        getBlockCount() { return this.blocks.length; }
        hasData() { return this.blocks.length > 0; }

        clear() {
            this.blocks = [];
            this.currentPulses = [];
            this.inBlock = false;
        }

        reset() {
            this.clear();
            this.lastMicBit = 0;
            this.lastChangeAbsT = 0;
            this.totalFrames = 0;
        }

        setTstatesPerFrame(tpf) {
            this.tstatesPerFrame = tpf;
        }
    }

    /**
     * Convert pulse durations to TZX Direct Recording (block 0x15) data.
     * @param {number[]} pulses - T-state durations between level toggles
     * @param {number} initialLevel - signal level (0 or 1) at start of first pulse
     * @param {number} tStatesPerSample - sampling resolution (default 79 ≈ 44.3kHz at 3.5MHz)
     */
    export function pulsesToDirectRecording(pulses, initialLevel, tStatesPerSample = 79) {
        let totalT = 0;
        for (const p of pulses) totalT += p;
        if (totalT === 0) return null;

        const numSamples = Math.ceil(totalT / tStatesPerSample);
        const numBytes = Math.ceil(numSamples / 8);
        const data = new Uint8Array(numBytes);

        // Build toggle timestamps
        const toggleTimes = [];
        let t = 0;
        for (const p of pulses) { t += p; toggleTimes.push(t); }

        let level = initialLevel;
        let toggleIdx = 0;

        for (let s = 0; s < numSamples; s++) {
            const sampleT = s * tStatesPerSample;
            while (toggleIdx < toggleTimes.length && sampleT >= toggleTimes[toggleIdx]) {
                level ^= 1;
                toggleIdx++;
            }
            if (level) data[s >> 3] |= (0x80 >> (s & 7));
        }

        return { data, tStatesPerSample, usedBitsInLastByte: (numSamples % 8) || 8 };
    }

    /**
     * Build a TZX file from TAP blocks (ROM trap) and/or MIC-recorded pulse blocks.
     * @param {Uint8Array[]} tapBlocks - TAP-format blocks (with 2-byte length prefix)
     * @param {Array<{pulses: number[], initialLevel: number}>} micBlocks - MIC-recorded blocks
     * @returns {Uint8Array} TZX file data
     */
    export function buildTZX(tapBlocks, micBlocks) {
        const parts = [];

        // TZX header: "ZXTape!" 0x1A, version 1.20
        parts.push(new Uint8Array([0x5A, 0x58, 0x54, 0x61, 0x70, 0x65, 0x21, 0x1A, 1, 20]));

        // TAP blocks → TZX block 0x10 (Standard Speed Data)
        for (const tap of tapBlocks) {
            const dataLen = tap.length - 2;  // Strip TAP length prefix
            const blk = new Uint8Array(5 + dataLen);
            blk[0] = 0x10;                             // Block ID
            blk[1] = 0xE8; blk[2] = 0x03;              // Pause 1000ms (LE)
            blk[3] = dataLen & 0xFF;                    // Data length (LE)
            blk[4] = (dataLen >> 8) & 0xFF;
            blk.set(tap.subarray(2), 5);                // Data (skip TAP length prefix)
            parts.push(blk);
        }

        // MIC blocks → TZX block 0x15 (Direct Recording)
        for (const mic of micBlocks) {
            const dr = pulsesToDirectRecording(mic.pulses, mic.initialLevel);
            if (!dr) continue;
            const dLen = dr.data.length;
            const blk = new Uint8Array(8 + dLen);
            blk[0] = 0x15;                             // Block ID
            blk[1] = dr.tStatesPerSample & 0xFF;       // T-states per sample (LE)
            blk[2] = (dr.tStatesPerSample >> 8) & 0xFF;
            blk[3] = 0xE8; blk[4] = 0x03;              // Pause 1000ms (LE)
            blk[5] = dr.usedBitsInLastByte;
            blk[6] = dLen & 0xFF;                       // Data length 3 bytes (LE)
            blk[7] = (dLen >> 8) & 0xFF;
            // blk[8] would be 3rd byte but we need to handle 3-byte length
            // Reallocate with correct size
            const blk2 = new Uint8Array(9 + dLen);
            blk2[0] = 0x15;
            blk2[1] = dr.tStatesPerSample & 0xFF;
            blk2[2] = (dr.tStatesPerSample >> 8) & 0xFF;
            blk2[3] = 0xE8; blk2[4] = 0x03;
            blk2[5] = dr.usedBitsInLastByte;
            blk2[6] = dLen & 0xFF;
            blk2[7] = (dLen >> 8) & 0xFF;
            blk2[8] = (dLen >> 16) & 0xFF;
            blk2.set(dr.data, 9);
            parts.push(blk2);
        }

        // Concatenate
        let total = 0;
        for (const p of parts) total += p.length;
        const tzx = new Uint8Array(total);
        let off = 0;
        for (const p of parts) { tzx.set(p, off); off += p.length; }
        return tzx;
    }

    /**
     * TR-DOS trap handler - intercepts TR-DOS ROM calls
     * Provides disk emulation without full Beta Disk hardware emulation
     */
