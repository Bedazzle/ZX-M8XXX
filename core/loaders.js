/**
 * ZX-M8XXX - File Loaders (TAP, SNA, Z80, TRD, SCL)
 * @version 0.6.4
 * @license GPL-3.0
 */

import { getMachineByZ80HwMode, getMachineBySzxId } from './machines.js';
import {
    PAGE_SIZE, SLOT1_START, SLOT2_START, SLOT3_START,
    SNA_HEADER_SIZE, SNA_48K_RAM, SNA_48K_SIZE,
    SNA_128K_EXT, SNA_128K_MIN, SNA_128K_SIZE, SNA_P1024_SIZE,
    P7FFD_RAM_MASK, P7FFD_SCREEN_BIT, P7FFD_ROM_BIT, P7FFD_LOCK_BIT
} from './constants.js';

const VERSION = '0.6.4';

// XOR checksum over data[0..length-1], seeded with `seed` (tape flag byte or 0)
export function xorChecksum(data, seed = 0, length = data.length) {
    let checksum = seed;
    for (let i = 0; i < length; i++) checksum ^= data[i];
    return checksum;
}

// Write `str` into `bytes` at `offset` as a fixed `length`-byte field: the
// string's char codes (truncated to `length`), the remainder filled with `pad`
// (default 0x20 space; pass 0x00 for null-padded fields). Used by the disk
// catalog writers for file names and disk labels.
function writeField(bytes, offset, str, length, pad = 0x20) {
    str = str || '';
    for (let i = 0; i < length; i++) {
        bytes[offset + i] = i < str.length ? str.charCodeAt(i) : pad;
    }
}

// SCL trailing checksum: 32-bit sum of all bytes before the checksum itself
export function sclChecksum(data, length = data.length) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum = (sum + data[i]) >>> 0;
    return sum;
}

    export class TapeLoader {
        static get VERSION() { return VERSION; }
        
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
        static get VERSION() { return VERSION; }

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
        static get VERSION() { return VERSION; }

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
                case 0x22: return { length: 0 }; // Group End - no data
                case 0x23: return this.parseJump(offset);
                case 0x24: return this.parseLoopStart(offset);
                case 0x25: return { block: { type: 'loopEnd' }, length: 0 };
                case 0x26: return this.parseCallSequence(offset);
                case 0x27: return { length: 0 }; // Return
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
        static get VERSION() { return VERSION; }

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

    export class SnapshotLoader {
        static get VERSION() { return VERSION; }
        
        constructor() {
            this.machineType = '48k';
        }
        
        detectType(data, filename = '') {
            const ext = filename.toLowerCase().split('.').pop();
            if (ext === 'sna') return 'sna';
            if (ext === 'tap') return 'tap';
            if (ext === 'tzx') return 'tzx';
            if (ext === 'z80') return 'z80';
            if (ext === 'szx') return 'szx';
            if (ext === 'rzx') return 'rzx';
            if (ext === 'trd') return 'trd';
            if (ext === 'scl') return 'scl';
            if (ext === 'dsk') return 'dsk';
            if (ext === 'mgt' || ext === 'img') return 'mgt';
            if (ext === 'mdr') return 'mdr';
            if (ext === 'opd' || ext === 'opu') return 'opd';
            if (ext === 'wav') return 'wav';

            const bytes = new Uint8Array(data);

            // Check for DSK signature (before other checks)
            if (typeof DSKLoader !== 'undefined' && DSKLoader.isDSK(data)) return 'dsk';

            // Check for SZX signature
            if (SZXLoader.isSZX(data)) return 'szx';

            // Check for RZX signature
            if (RZXLoader.isRZX(data)) return 'rzx';

            // Check for TZX signature (must check before TAP)
            if (TZXLoader.isTZX(data)) return 'tzx';

            // Check for SCL signature
            if (SCLLoader.isSCL(data)) return 'scl';

            // Check for TRD format
            if (TRDLoader.isTRD(data)) return 'trd';

            // Check for MDR format (Interface 1 Microdrive)
            if (MDRLoader.isMDR(data)) return 'mdr';

            // Check for MGT format
            if (MGTLoader.isMGT(data)) return 'mgt';

            // Check for OPD format (Opus Discovery)
            if (OPDLoader.isOPD(data)) return 'opd';

            // Check for WAV format (RIFF/WAVE audio)
            if (WAVLoader.isWAV(data)) return 'wav';

            if (bytes.length === SNA_48K_SIZE || bytes.length === SNA_128K_SIZE || bytes.length === SNA_P1024_SIZE) return 'sna';
            if (bytes.length > 30 && (bytes[6] === 0 || bytes[6] === 0xff)) return 'z80';
            if (bytes.length > 2) {
                const len = bytes[0] | (bytes[1] << 8);
                if (len > 0 && len < bytes.length) return 'tap';
            }
            return null;
        }
        
        loadSNA48(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length < SNA_48K_SIZE) throw new Error('Invalid SNA file');

            cpu.i = bytes[0];
            cpu.l_ = bytes[1]; cpu.h_ = bytes[2];
            cpu.e_ = bytes[3]; cpu.d_ = bytes[4];
            cpu.c_ = bytes[5]; cpu.b_ = bytes[6];
            cpu.f_ = bytes[7]; cpu.a_ = bytes[8];
            cpu.l = bytes[9]; cpu.h = bytes[10];
            cpu.e = bytes[11]; cpu.d = bytes[12];
            cpu.c = bytes[13]; cpu.b = bytes[14];
            cpu.iy = bytes[15] | (bytes[16] << 8);
            cpu.ix = bytes[17] | (bytes[18] << 8);
            cpu.iff2 = (bytes[19] & 0x04) !== 0;
            cpu.iff1 = cpu.iff2;
            cpu.rFull = bytes[20];
            cpu.f = bytes[21]; cpu.a = bytes[22];
            cpu.sp = bytes[23] | (bytes[24] << 8);
            cpu.im = bytes[25];
            const border = bytes[26] & 0x07;

            // Reset CPU state flags not stored in SNA format
            cpu.halted = false;
            cpu.eiPending = false;

            for (let i = 0; i < SNA_48K_RAM; i++) {
                memory.write(SLOT1_START + i, bytes[SNA_HEADER_SIZE + i]);
            }

            cpu.pc = memory.read(cpu.sp) | (memory.read(cpu.sp + 1) << 8);
            cpu.sp = (cpu.sp + 2) & 0xffff;
            this.machineType = '48k';
            return { border, machineType: '48k' };
        }

        loadSNA128(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length < SNA_128K_MIN) return this.loadSNA48(data, cpu, memory);

            // For 128K, we need to set paging BEFORE loading 48KB section
            // Otherwise the wrong bank gets written at C000
            const offset = SNA_48K_SIZE;
            const pagingByte = bytes[offset + 2];
            const currentBank = pagingByte & P7FFD_RAM_MASK;

            // Reset paging lock before setting paging state from snapshot
            memory.pagingDisabled = false;
            // Apply paging first so 48KB section writes to correct banks
            memory.writePaging(pagingByte);

            // Load header (same as 48K)
            cpu.i = bytes[0];
            cpu.l_ = bytes[1]; cpu.h_ = bytes[2];
            cpu.e_ = bytes[3]; cpu.d_ = bytes[4];
            cpu.c_ = bytes[5]; cpu.b_ = bytes[6];
            cpu.f_ = bytes[7]; cpu.a_ = bytes[8];
            cpu.l = bytes[9]; cpu.h = bytes[10];
            cpu.e = bytes[11]; cpu.d = bytes[12];
            cpu.c = bytes[13]; cpu.b = bytes[14];
            cpu.iy = bytes[15] | (bytes[16] << 8);
            cpu.ix = bytes[17] | (bytes[18] << 8);
            cpu.iff2 = (bytes[19] & 0x04) !== 0;
            cpu.iff1 = cpu.iff2;
            cpu.rFull = bytes[20];
            cpu.f = bytes[21]; cpu.a = bytes[22];
            cpu.sp = bytes[23] | (bytes[24] << 8);
            cpu.im = bytes[25];
            const border = bytes[26] & 0x07;

            // Reset CPU state flags not stored in SNA format
            cpu.halted = false;
            cpu.eiPending = false;

            // Now load 48KB section (banks 5, 2, and currently paged bank)
            for (let i = 0; i < SNA_48K_RAM; i++) {
                memory.write(SLOT1_START + i, bytes[SNA_HEADER_SIZE + i]);
            }

            // Load PC from 128K extension
            cpu.pc = bytes[offset] | (bytes[offset + 1] << 8);

            // Load remaining banks (excluding the current one which is in 48KB section)
            const banksToLoad = [0, 1, 3, 4, 6, 7].filter(b => b !== currentBank);
            // Only load as many banks as are present in the file (max 5)
            const availableBanks = Math.floor((bytes.length - offset - SNA_128K_EXT) / PAGE_SIZE);
            const banksToActuallyLoad = banksToLoad.slice(0, Math.min(banksToLoad.length, availableBanks));
            let bankOffset = offset + SNA_128K_EXT;
            for (const bankNum of banksToActuallyLoad) {
                if (bankOffset + PAGE_SIZE > bytes.length) break;
                const ramBank = memory.getRamBank(bankNum);
                ramBank.set(bytes.slice(bankOffset, bankOffset + PAGE_SIZE));
                bankOffset += PAGE_SIZE;
            }
            this.machineType = '128k';
            return { border, machineType: '128k' };
        }
        
        loadSNA(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length === SNA_48K_SIZE) return this.loadSNA48(data, cpu, memory);
            if (bytes.length > SNA_48K_SIZE) return this.loadSNA128(data, cpu, memory);
            throw new Error('Invalid SNA file');
        }
        
        createSNA(cpu, memory, border = 7) {
            const is128k = memory.profile.ramPages > 1;
            const size = is128k ? SNA_128K_SIZE : SNA_48K_SIZE;
            const bytes = new Uint8Array(size);
            
            bytes[0] = cpu.i;
            bytes[1] = cpu.l_; bytes[2] = cpu.h_;
            bytes[3] = cpu.e_; bytes[4] = cpu.d_;
            bytes[5] = cpu.c_; bytes[6] = cpu.b_;
            bytes[7] = cpu.f_; bytes[8] = cpu.a_;
            bytes[9] = cpu.l; bytes[10] = cpu.h;
            bytes[11] = cpu.e; bytes[12] = cpu.d;
            bytes[13] = cpu.c; bytes[14] = cpu.b;
            bytes[15] = cpu.iy & 0xff; bytes[16] = (cpu.iy >> 8) & 0xff;
            bytes[17] = cpu.ix & 0xff; bytes[18] = (cpu.ix >> 8) & 0xff;
            bytes[19] = cpu.iff2 ? 0x04 : 0x00;
            bytes[20] = cpu.rFull;
            bytes[21] = cpu.f; bytes[22] = cpu.a;
            
            let sp = cpu.sp;
            if (!is128k) {
                sp = (sp - 2) & 0xffff;
                memory.write(sp, cpu.pc & 0xff);
                memory.write(sp + 1, (cpu.pc >> 8) & 0xff);
            }
            bytes[23] = sp & 0xff; bytes[24] = (sp >> 8) & 0xff;
            bytes[25] = cpu.im;
            bytes[26] = border & 0x07;
            
            for (let i = 0; i < SNA_48K_RAM; i++) {
                bytes[SNA_HEADER_SIZE + i] = memory.read(SLOT1_START + i);
            }

            if (is128k) {
                const offset = SNA_48K_SIZE;
                bytes[offset] = cpu.pc & 0xff;
                bytes[offset + 1] = (cpu.pc >> 8) & 0xff;
                const ps = memory.getPagingState();
                bytes[offset + 2] = (ps.ramBank & P7FFD_RAM_MASK) | (ps.screenBank === 7 ? P7FFD_SCREEN_BIT : 0x00) |
                                    (ps.romBank ? P7FFD_ROM_BIT : 0x00) | (ps.pagingDisabled ? P7FFD_LOCK_BIT : 0x00);
                bytes[offset + 3] = 0;
                // Save remaining banks (excluding those in the 48KB section)
                // 48KB section always has: bank 5 (4000-7FFF), bank 2 (8000-BFFF), and current bank (C000-FFFF)
                const currentBank = ps.ramBank;
                // Banks 2 and 5 are always in 48KB, plus the current bank at C000
                // Only save banks from [0,1,3,4,6,7] that aren't the current bank
                const banksToSave = [0, 1, 3, 4, 6, 7].filter(b => b !== currentBank);
                // Limit to 5 banks max to fit in SNA_128K_SIZE format
                const banksToActuallySave = banksToSave.slice(0, 5);
                let bankOffset = offset + SNA_128K_EXT;
                for (const bankNum of banksToActuallySave) {
                    bytes.set(memory.getRamBank(bankNum), bankOffset);
                    bankOffset += PAGE_SIZE;
                }
            }
            return bytes;
        }

        // Z80 v3 format saver
        createZ80(cpu, memory, border = 7) {
            const is128k = memory.profile.ramPages > 1;
            const chunks = [];

            // Build v3 header (30 + 54 = 84 bytes header)
            const header = new Uint8Array(86);  // 30 + 2 (len) + 54

            // Standard header (bytes 0-29)
            header[0] = cpu.a;
            header[1] = cpu.f;
            header[2] = cpu.c; header[3] = cpu.b;
            header[4] = cpu.l; header[5] = cpu.h;
            header[6] = 0; header[7] = 0;  // PC=0 indicates v2/v3
            header[8] = cpu.sp & 0xff; header[9] = (cpu.sp >> 8) & 0xff;
            header[10] = cpu.i;
            header[11] = cpu.rFull & 0x7f;
            header[12] = ((cpu.rFull >> 7) & 0x01) | ((border & 0x07) << 1);
            header[13] = cpu.e; header[14] = cpu.d;
            header[15] = cpu.c_; header[16] = cpu.b_;
            header[17] = cpu.e_; header[18] = cpu.d_;
            header[19] = cpu.h_; header[20] = cpu.l_;
            header[21] = cpu.a_; header[22] = cpu.f_;
            header[23] = cpu.iy & 0xff; header[24] = (cpu.iy >> 8) & 0xff;
            header[25] = cpu.ix & 0xff; header[26] = (cpu.ix >> 8) & 0xff;
            header[27] = cpu.iff1 ? 1 : 0;
            header[28] = cpu.iff2 ? 1 : 0;
            header[29] = cpu.im & 0x03;

            // Extended header length (54 bytes for v3)
            header[30] = 54; header[31] = 0;

            // Extended header (bytes 32-85)
            header[32] = cpu.pc & 0xff; header[33] = (cpu.pc >> 8) & 0xff;
            // Hardware mode from profile (0=48k, 4=128k, 9=Pentagon, 12=+2, 13=+2A)
            header[34] = memory.profile.z80HwMode;

            // Port 7FFD for 128K
            if (is128k) {
                const ps = memory.getPagingState();
                header[35] = (ps.ramBank & 0x07) | (ps.screenBank === 7 ? 0x08 : 0x00) |
                             (ps.romBank ? 0x10 : 0x00) | (ps.pagingDisabled ? 0x20 : 0x00);
            } else {
                header[35] = 0;
            }
            header[36] = 0;  // Interface I paged (no)
            header[37] = memory.profile.ayDefault ? 0x04 : 0x00;  // Bit 2: AY sound in use
            header[38] = 0;  // Last OUT to port $FFFD (AY register)
            // Bytes 39-54: AY registers (16 bytes) - leave as 0 for now
            // Bytes 55-56: Low T-state counter, 57: Hi T-state counter
            // Leave at 0 (not critical for loading)

            chunks.push(header);

            // Save memory pages (uncompressed for maximum compatibility)
            if (is128k) {
                // 128K: save all 8 RAM banks as pages 3-10
                for (let bank = 0; bank < 8; bank++) {
                    const pageData = memory.getRamBank(bank);
                    // Use 0xFFFF to indicate uncompressed PAGE_SIZE bytes
                    const pageChunk = new Uint8Array(3 + PAGE_SIZE);
                    pageChunk[0] = 0xFF;
                    pageChunk[1] = 0xFF;
                    pageChunk[2] = bank + 3;  // Page number (3-10 for banks 0-7)
                    pageChunk.set(pageData.subarray(0, PAGE_SIZE), 3);
                    chunks.push(pageChunk);
                }
            } else {
                // 48K: save 3 pages (8, 4, 5 -> $4000, $8000, $C000)
                const pages = [
                    { num: 8, start: SLOT1_START },  // Slot 1
                    { num: 4, start: SLOT2_START },  // Slot 2
                    { num: 5, start: SLOT3_START }   // Slot 3
                ];
                for (const page of pages) {
                    const pageData = new Uint8Array(PAGE_SIZE);
                    for (let i = 0; i < PAGE_SIZE; i++) {
                        pageData[i] = memory.read(page.start + i);
                    }
                    // Use 0xFFFF to indicate uncompressed PAGE_SIZE bytes
                    const pageChunk = new Uint8Array(3 + PAGE_SIZE);
                    pageChunk[0] = 0xFF;
                    pageChunk[1] = 0xFF;
                    pageChunk[2] = page.num;
                    pageChunk.set(pageData, 3);
                    chunks.push(pageChunk);
                }
            }

            // Combine all chunks
            const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
            const result = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }
            return result;
        }

        // Z80 RLE compression (ED ED nn xx = repeat xx nn times)
        compressZ80Block(data) {
            const result = [];
            let i = 0;
            while (i < data.length) {
                // Look for runs of same byte
                let runLen = 1;
                while (i + runLen < data.length &&
                       data[i + runLen] === data[i] && runLen < 255) {
                    runLen++;
                }

                if (runLen >= 5 || (runLen >= 2 && data[i] === 0xED)) {
                    // Use RLE encoding: ED ED count byte
                    result.push(0xED, 0xED, runLen, data[i]);
                    i += runLen;
                } else {
                    // Output literal bytes, but escape ED ED sequences
                    if (data[i] === 0xED && i + 1 < data.length && data[i + 1] === 0xED) {
                        // Escape ED ED as ED ED 02 ED
                        result.push(0xED, 0xED, 0x02, 0xED);
                        i += 2;
                    } else {
                        result.push(data[i]);
                        i++;
                    }
                }
            }
            return new Uint8Array(result);
        }

        // Z80 format loader
        loadZ80(data, cpu, memory) {
            const bytes = new Uint8Array(data);
            if (bytes.length < 30) throw new Error('Invalid Z80 file');
            
            // Read v1 header
            cpu.a = bytes[0];
            cpu.f = bytes[1];
            cpu.c = bytes[2]; cpu.b = bytes[3];
            cpu.l = bytes[4]; cpu.h = bytes[5];
            let pc = bytes[6] | (bytes[7] << 8);
            cpu.sp = bytes[8] | (bytes[9] << 8);
            cpu.i = bytes[10];
            // Compatibility: a byte-12 value of 255 must be treated as 1 (per the .z80
            // spec, for very old files). Affects R bit 7, border, and the "compressed" flag.
            let byte12 = bytes[12];
            if (byte12 === 255) byte12 = 1;
            cpu.rFull = (bytes[11] & 0x7f) | ((byte12 & 0x01) << 7);

            const border = (byte12 >> 1) & 0x07;
            const compressed = (byte12 & 0x20) !== 0;
            
            cpu.e = bytes[13]; cpu.d = bytes[14];
            cpu.c_ = bytes[15]; cpu.b_ = bytes[16];
            cpu.e_ = bytes[17]; cpu.d_ = bytes[18];
            cpu.h_ = bytes[19]; cpu.l_ = bytes[20];
            cpu.a_ = bytes[21]; cpu.f_ = bytes[22];
            cpu.iy = bytes[23] | (bytes[24] << 8);
            cpu.ix = bytes[25] | (bytes[26] << 8);
            cpu.iff1 = bytes[27] !== 0;
            cpu.iff2 = bytes[28] !== 0;
            cpu.im = bytes[29] & 0x03;

            // Reset CPU state flags not stored in Z80 format
            cpu.halted = false;
            cpu.eiPending = false;

            // Determine version
            if (pc !== 0) {
                // Version 1 - 48K only
                cpu.pc = pc;
                const memData = this.decompressZ80Block(bytes.subarray(30), SNA_48K_RAM, compressed, true);
                for (let i = 0; i < memData.length; i++) {
                    memory.write(SLOT1_START + i, memData[i]);
                }
                this.machineType = '48k';
                return { border, machineType: '48k' };
            }
            
            // Version 2 or 3
            const extHeaderLen = bytes[30] | (bytes[31] << 8);
            cpu.pc = bytes[32] | (bytes[33] << 8);

            const hwMode = bytes[34];
            // Determine machine type from hardware mode using profile lookup
            let machineType = getMachineByZ80HwMode(hwMode, extHeaderLen);

            // Read 128K port 0x7FFD if applicable
            if (machineType !== '48k' && bytes.length > 35) {
                const port7FFD = bytes[35];
                // Reset paging lock before setting paging state from snapshot
                memory.pagingDisabled = false;
                // +2A/+3: restore port 0x1FFD before 0x7FFD. Byte 86 holds 1FFD only when
                // the extended-header length word (offset 30) is exactly 55 (per .z80 spec).
                if ((memory.machineType === '+2a' || memory.machineType === '+3') && extHeaderLen === 55) {
                    memory.write1FFD(bytes[86]);
                }
                memory.writePaging(port7FFD);
            }
            
            // Load memory pages
            let offset = 32 + extHeaderLen;
            while (offset < bytes.length - 3) {
                const blockLen = bytes[offset] | (bytes[offset + 1] << 8);
                const pageNum = bytes[offset + 2];
                offset += 3;
                
                if (offset + (blockLen === 0xffff ? PAGE_SIZE : blockLen) > bytes.length) break;

                const isCompressed = blockLen !== 0xffff;
                const rawLen = isCompressed ? blockLen : PAGE_SIZE;
                const blockData = bytes.subarray(offset, offset + rawLen);
                const pageData = isCompressed ?
                    this.decompressZ80Block(blockData, PAGE_SIZE, true, false) : blockData;
                
                this.loadZ80Page(pageNum, pageData, memory, machineType);
                offset += rawLen;
            }
            
            this.machineType = machineType;
            return { border, machineType };
        }
        
        decompressZ80Block(data, maxLen, compressed, isV1) {
            if (!compressed) {
                return data.slice(0, maxLen);
            }

            const result = new Uint8Array(maxLen);
            let srcIdx = 0;
            let dstIdx = 0;

            while (srcIdx < data.length && dstIdx < maxLen) {
                if (srcIdx + 3 < data.length &&
                    data[srcIdx] === 0xED && data[srcIdx + 1] === 0xED) {
                    // ED ED nn xx = repeat byte xx nn times
                    const count = data[srcIdx + 2];
                    const value = data[srcIdx + 3];
                    for (let i = 0; i < count && dstIdx < maxLen; i++) {
                        result[dstIdx++] = value;
                    }
                    srcIdx += 4;
                } else if (isV1 && data[srcIdx] === 0x00 && srcIdx + 3 < data.length &&
                           data[srcIdx + 1] === 0xED && data[srcIdx + 2] === 0xED &&
                           data[srcIdx + 3] === 0x00) {
                    // End marker — present ONLY in version 1 (v2/v3 blocks are
                    // length-prefixed and have no end marker, per the .z80 spec).
                    break;
                } else {
                    result[dstIdx++] = data[srcIdx++];
                }
            }

            return result.slice(0, dstIdx);
        }
        
        loadZ80Page(pageNum, data, memory, machineType) {
            // Map page numbers to memory addresses/banks
            // Page numbers differ between 48K and 128K modes
            if (machineType === '48k') {
                switch (pageNum) {
                    case 4: // Slot 2 (bank 2)
                        for (let i = 0; i < data.length && i < PAGE_SIZE; i++) {
                            memory.write(SLOT2_START + i, data[i]);
                        }
                        break;
                    case 5: // Slot 3 (bank 0)
                        for (let i = 0; i < data.length && i < PAGE_SIZE; i++) {
                            memory.write(SLOT3_START + i, data[i]);
                        }
                        break;
                    case 8: // Slot 1 (bank 5)
                        for (let i = 0; i < data.length && i < PAGE_SIZE; i++) {
                            memory.write(SLOT1_START + i, data[i]);
                        }
                        break;
                }
            } else {
                // 128K/Pentagon mode
                // Page numbers 3-10 map to RAM banks 0-7
                // Page 0 = 48K ROM (bank 1 for 128K/Pentagon)
                // Page 2 = 128K ROM (bank 0 for 128K/Pentagon)
                if (pageNum === 0) {
                    // 48K ROM modifications - load into ROM bank 1
                    const romBank = memory.rom[1];
                    if (romBank) {
                        romBank.set(data.subarray(0, Math.min(data.length, PAGE_SIZE)));
                    }
                } else if (pageNum === 2) {
                    // 128K ROM modifications - load into ROM bank 0
                    const romBank = memory.rom[0];
                    if (romBank) {
                        romBank.set(data.subarray(0, Math.min(data.length, PAGE_SIZE)));
                    }
                } else {
                    const bankNum = pageNum - 3;
                    const maxBanks = memory.profile ? memory.profile.ramPages : 8;
                    if (bankNum >= 0 && bankNum < maxBanks) {
                        const ramBank = memory.getRamBank(bankNum);
                        if (ramBank) {
                            ramBank.set(data.subarray(0, Math.min(data.length, PAGE_SIZE)));
                        }
                    }
                }
            }
        }
    }

    export class TapeTrapHandler {
        static get VERSION() { return VERSION; }

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
        static get VERSION() { return VERSION; }

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
            // Don't trap under TR-DOS
            if (this.memory.trdosActive) return false;

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
    export class TRDOSTrapHandler {
        static get VERSION() { return VERSION; }

        constructor(cpu, memory) {
            this.cpu = cpu;
            this.memory = memory;
            this.diskData = null;
            this.diskFiles = null;
            this.diskType = null;
            this.enabled = true;
            this.lastLoadedFile = null;
            this._hasTrdosRom = false;  // Cached flag to avoid hasTrdosRom() loop per instruction
        }

        // Update cached TR-DOS ROM flag - call when TR-DOS ROM is loaded/changed
        updateTrdosRomFlag() {
            this._hasTrdosRom = this.memory.hasTrdosRom ? this.memory.hasTrdosRom() : false;
        }

        setDisk(data, files, type) {
            this.diskData = data;
            this.diskFiles = files;
            this.diskType = type;
        }

        clearDisk() {
            this.diskData = null;
            this.diskFiles = null;
            this.diskType = null;
        }

        setEnabled(enabled) { this.enabled = enabled; }

        // Check for TR-DOS ROM traps
        // Returns true if trap was handled
        // NOTE: When real TR-DOS ROM is loaded, we let it handle everything
        // This trap is only for fallback when no TR-DOS ROM is available
        checkTrap() {
            if (!this.enabled) return false;
            if (!this.diskData) return false;

            // If TR-DOS ROM is loaded, don't trap - let real TR-DOS handle everything
            // The trap is only useful as a fallback when TR-DOS ROM isn't available
            // Use cached flag to avoid expensive hasTrdosRom() check per instruction
            if (this._hasTrdosRom) {
                return false;
            }

            // Only trigger trap when TR-DOS ROM is paged in (via automatic Beta Disk paging)
            // This prevents false triggers when main ROM is active
            if (this.memory.machineType !== '48k' && !this.memory.trdosActive) {
                return false;
            }

            // TR-DOS entry point #3D13 (RANDOMIZE USR 15619)
            // This is called by BASIC when executing TR-DOS commands
            if (this.cpu.pc === 0x3D13) {
                return this.handleTRDOSCommand();
            }

            return false;
        }

        // Handle TR-DOS command from BASIC (RANDOMIZE USR 15619: REM : command)
        handleTRDOSCommand() {
            // Try to parse command from current BASIC line
            // The command is typically after "REM :" or "REM:" in the current line
            const filename = this.parseFilenameFromBasicLine();

            if (filename) {
                // Find file on disk
                const file = this.findFile(filename);
                if (file) {
                    return this.loadFile(file);
                }
            }

            // If we can't parse the command, just return success
            // (some programs just use USR 15619 to enter TR-DOS)
            this.cpu.f |= 0x01;  // Success
            this.returnFromTrap();
            return true;
        }

        // Parse filename from current BASIC line
        // Looks for pattern: REM : LOAD "filename" or similar
        parseFilenameFromBasicLine() {
            // Get current BASIC line address from CH_ADD (0x5C5D) - current position in BASIC
            const chAdd = this.memory.read(0x5C5D) | (this.memory.read(0x5C5E) << 8);

            // Search backwards and forwards from CH_ADD for a quoted filename
            // TR-DOS command format: LOAD "filename" or RUN "filename"
            let searchStart = Math.max(0x5C00, chAdd - 50);
            let searchEnd = Math.min(0xFFFF, chAdd + 100);

            let inQuote = false;
            let filename = '';

            for (let addr = searchStart; addr < searchEnd; addr++) {
                const byte = this.memory.read(addr);

                if (byte === 0x22) {  // Quote character
                    if (inQuote) {
                        // End of filename
                        if (filename.length > 0) {
                            return filename.trim();
                        }
                        filename = '';
                    }
                    inQuote = !inQuote;
                } else if (inQuote && byte >= 0x20 && byte < 0x80) {
                    filename += String.fromCharCode(byte);
                } else if (byte === 0x0D) {  // End of line
                    break;
                }
            }

            return null;
        }

        // Load a file from disk into memory
        loadFile(fileInfo) {
            const Loader = this.diskType === 'trd' ? TRDLoader : SCLLoader;
            const fileData = Loader.extractFile(this.diskData, fileInfo);

            if (fileInfo.type === 'code') {
                // CODE file - load at specified address
                for (let i = 0; i < fileData.length; i++) {
                    this.memory.write(fileInfo.start + i, fileData[i]);
                }
                this.lastLoadedFile = fileInfo;
                this.cpu.f |= 0x01;  // Success
                this.returnFromTrap();
                return true;
            }

            if (fileInfo.type === 'basic') {
                // BASIC program - load into BASIC area
                // Read current PROG address from system variables (usually 0x5CCB = 23755)
                let progAddr = this.memory.read(0x5C53) | (this.memory.read(0x5C54) << 8);
                // Sanity check: PROG should be in RAM (>=0x5CCB and <0xFFFF)
                if (progAddr < 0x5CCB || progAddr > 0xFF00) {
                    progAddr = 0x5CCB;  // Use default PROG address
                }

                // Load BASIC program
                for (let i = 0; i < fileData.length; i++) {
                    this.memory.write(progAddr + i, fileData[i]);
                }

                // VARS points to end of program (start of variables)
                const varsAddr = progAddr + fileData.length;
                // Write end-of-variables marker (0x80)
                this.memory.write(varsAddr, 0x80);
                // E_LINE points after the marker
                const elineAddr = varsAddr + 1;
                // Write end-of-line marker for edit area
                this.memory.write(elineAddr, 0x0D);

                // Update BASIC system variables
                this.memory.write(0x5C4B, varsAddr & 0xFF);          // VARS low
                this.memory.write(0x5C4C, (varsAddr >> 8) & 0xFF);   // VARS high
                this.memory.write(0x5C59, elineAddr & 0xFF);         // E_LINE low
                this.memory.write(0x5C5A, (elineAddr >> 8) & 0xFF);  // E_LINE high

                // Set up autostart if specified (fileInfo.start is line number)
                if (fileInfo.start && fileInfo.start < 10000) {
                    this.memory.write(0x5C42, fileInfo.start & 0xFF);        // NEWPPC low
                    this.memory.write(0x5C43, (fileInfo.start >> 8) & 0xFF); // NEWPPC high
                    this.memory.write(0x5C44, 0x00);  // NSPPC = 0 triggers jump to NEWPPC
                }

                this.lastLoadedFile = fileInfo;
                this.cpu.f |= 0x01;  // Success
                this.returnFromTrap();
                return true;
            }

            // Unknown type - fail
            this.cpu.f &= ~0x01;
            this.returnFromTrap();
            return true;
        }

        // Find file by name (for LOAD "filename" operations)
        findFile(name) {
            if (!this.diskFiles) return null;
            const searchName = name.toLowerCase().trim();
            return this.diskFiles.find(f =>
                f.name.toLowerCase().trim() === searchName ||
                f.fullName.toLowerCase().trim() === searchName
            );
        }

        returnFromTrap() {
            const retAddr = this.memory.read(this.cpu.sp) | (this.memory.read(this.cpu.sp + 1) << 8);
            this.cpu.sp = (this.cpu.sp + 2) & 0xffff;
            this.cpu.pc = retAddr;
        }
    }

    /**
     * Beta Disk Interface emulation (WD1793 floppy controller)
     * Used by TR-DOS ROM for disk operations
     *
     * Ports:
     *   #1F - Command/Status register
     *   #3F - Track register
     *   #5F - Sector register
     *   #7F - Data register
     *   #FF - System register (active drive, side, etc.)
     */
    export class BetaDisk {
        static get VERSION() { return VERSION; }

        constructor() {
            // Per-drive state: each drive has its own disk image and head position
            // WD1793 is a single controller — track/sector/side registers are shared
            this.drives = [
                { diskData: null, diskType: null, headTrack: 0 },
                { diskData: null, diskType: null, headTrack: 0 },
                { diskData: null, diskType: null, headTrack: 0 },
                { diskData: null, diskType: null, headTrack: 0 },
            ];

            // WD1793 registers
            this.command = 0;
            this.status = 0;
            this.track = 0;
            this.sector = 1;           // Sectors are 1-based in TR-DOS
            this.data = 0;

            // Disk activity callback: function(type, track, sector, side, drive)
            // type: 'read', 'write', 'seek', 'idle'
            this.onDiskActivity = null;

            // System register (#FF)
            this.system = 0x3F;        // Initial state: no disk, motor off
            this.drive = 0;            // Current drive (0-3)
            this.side = 0;             // Current side (0-1)

            // Disk geometry (standard TRD)
            this.sectorsPerTrack = 16;
            this.bytesPerSector = 256;
            this.tracks = 80;
            this.sides = 2;

            // Data transfer state
            this.dataBuffer = null;
            this.dataPos = 0;
            this.dataLen = 0;
            this.reading = false;
            this.writing = false;

            // Index pulse simulation (for disk presence detection)
            this.indexCounter = 0;

            // Track last command type for status bit interpretation
            this.lastCmdType = 0;  // 1=Type I, 2=Type II/III

            // Status bits
            this.BUSY = 0x01;
            this.INDEX = 0x02;         // Type I: index pulse / Type II-III: DRQ
            this.DRQ = 0x02;           // Data request
            this.TRACK0 = 0x04;        // Type I: track 0
            this.LOST_DATA = 0x04;     // Type II-III: lost data
            this.CRC_ERROR = 0x08;
            this.SEEK_ERROR = 0x10;    // Type I: seek error
            this.RNF = 0x10;           // Type II-III: record not found
            this.HEAD_LOADED = 0x20;   // Type I
            this.RECORD_TYPE = 0x20;   // Type II-III: deleted data mark
            this.WRITE_PROTECT = 0x40;
            this.NOT_READY = 0x80;

            this.intrq = false;        // Interrupt request
            this.multiSector = false;  // Multi-sector flag (m bit in Type II commands)
        }

        // Load disk image into specified drive (default: drive 0)
        loadDisk(data, type, driveIndex = 0) {
            const drv = this.drives[driveIndex & 0x03];
            if (type === 'scl') {
                // Convert SCL to TRD format
                drv.diskData = this.sclToTrd(data);
            } else {
                drv.diskData = new Uint8Array(data);
            }
            drv.diskType = 'trd';
            drv.headTrack = 0;
            // Reset WD1793 state only if loading into current drive
            if ((driveIndex & 0x03) === this.drive) {
                this.status = 0;           // Disk ready
                this.track = 0;
                this.sector = 1;
            }
        }

        // Convenience getter for current drive's state
        get currentDisk() {
            return this.drives[this.drive];
        }

        // Create and insert a blank formatted TRD disk into specified drive
        createBlankDisk(label = 'BLANK', driveIndex = 0) {
            // Create blank TRD image (640KB = 2560 sectors)
            const trd = new Uint8Array(655360);
            trd.fill(0);

            // Set up disk info sector (sector 9 of track 0, offset 0x800)
            const sector9 = 8 * 256;

            // First free position: track 1, sector 0 (after directory)
            trd[sector9 + 0xE1] = 0;     // First free sector (0)
            trd[sector9 + 0xE2] = 1;     // First free track (1)
            trd[sector9 + 0xE3] = 0x16;  // Disk type (80 tracks, double-sided)
            trd[sector9 + 0xE4] = 0;     // File count (0 = empty)
            // Free sectors: 2560 (total) - 16 (track 0) = 2544
            trd[sector9 + 0xE5] = 0xF0;  // Free sectors low (2544 & 0xFF)
            trd[sector9 + 0xE6] = 0x09;  // Free sectors high (2544 >> 8)
            trd[sector9 + 0xE7] = 0x10;  // TR-DOS ID

            // Disk label at 0xF5-0xFC (8 bytes, space-padded)
            writeField(trd, sector9 + 0xF5, label, 8, 0x20);

            // Load the blank disk into specified drive
            const drv = this.drives[driveIndex & 0x03];
            drv.diskData = trd;
            drv.diskType = 'trd';
            drv.headTrack = 0;
            if ((driveIndex & 0x03) === this.drive) {
                this.status = 0;
                this.track = 0;
                this.sector = 1;
            }

            return true;
        }

        // Convert SCL to TRD format
        sclToTrd(sclData) {
            const scl = new Uint8Array(sclData);

            // Check SCL signature
            const sig = String.fromCharCode(...scl.slice(0, 8));
            if (sig !== 'SINCLAIR') {
                throw new Error('Invalid SCL signature');
            }

            // Create blank TRD image (640KB = 2560 sectors)
            const trd = new Uint8Array(655360);
            trd.fill(0);

            const fileCount = scl[8];

            // SCL format: signature(8) + count(1) + ALL headers(14*n) + ALL data
            // First pass: read all directory entries
            const files = [];
            let headerOffset = 9;  // After signature + file count
            for (let i = 0; i < fileCount && i < 128; i++) {
                const file = {
                    name: scl.slice(headerOffset, headerOffset + 8),
                    type: scl[headerOffset + 8],
                    start: scl[headerOffset + 9] | (scl[headerOffset + 10] << 8),
                    length: scl[headerOffset + 11] | (scl[headerOffset + 12] << 8),
                    sectorCount: scl[headerOffset + 13]
                };
                files.push(file);
                headerOffset += 14;
            }

            // File data starts after all headers
            let dataOffset = headerOffset;

            // First free data sector on TRD - start at logical track 1, sector 0
            // TR-DOS uses logical tracks 0-159 (each side is a separate logical track)
            // Track 0 = directory/system (physical track 0, side 0)
            // Track 1 = first data track (physical track 0, side 1)
            // Each logical track has 16 sectors (0-15)
            let trdSector = 16;  // = track 1 * 16 sectors + sector 0

            // Second pass: write TRD directory entries and copy file data
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const nameStr = String.fromCharCode(...file.name).trim();

                // Write TRD directory entry (16 bytes at track 0)
                const dirOffset = i * 16;
                trd.set(file.name, dirOffset);           // Filename (8 bytes)
                trd[dirOffset + 8] = file.type;          // File type
                trd[dirOffset + 9] = file.start & 0xFF;  // Start address low
                trd[dirOffset + 10] = (file.start >> 8) & 0xFF;
                trd[dirOffset + 11] = file.length & 0xFF; // Length low
                trd[dirOffset + 12] = (file.length >> 8) & 0xFF;
                trd[dirOffset + 13] = file.sectorCount;  // Sector count

                // Convert linear sector to logical track/sector for directory
                // TR-DOS uses logical tracks 0-159 (160 total: 80 physical tracks × 2 sides)
                // Sectors are 0-based (0-15) in directory entries
                const logTrack = Math.floor(trdSector / 16);  // 16 sectors per logical track
                const logSector = trdSector % 16;  // Sector 0-15

                trd[dirOffset + 14] = logSector;   // First sector (0-15)
                trd[dirOffset + 15] = logTrack;    // First logical track (0-159)

                // Copy file data from SCL to TRD
                // TRD uses interleaved format: linear sector number maps directly to byte offset
                const fileSize = file.sectorCount * 256;

                // Verify source data bounds
                if (dataOffset + fileSize > scl.length) {
                    console.error(`[SCL] ERROR: File "${nameStr}" data extends past SCL end! dataOffset=${dataOffset} fileSize=${fileSize} sclLen=${scl.length}`);
                }

                // In interleaved TRD, byte offset = linear sector * 256
                const trdDataOffset = trdSector * 256;
                trd.set(scl.slice(dataOffset, dataOffset + fileSize), trdDataOffset);

                dataOffset += fileSize;
                trdSector += file.sectorCount;
            }

            // Set up disk info sector (sector 9 of track 0)
            // Sector 9 starts at offset 8 * 256 = 2048
            const sector9 = 8 * 256;

            // Fill sector 9 with standard TR-DOS values
            // First free position: sector (0-15), logical track (0-159)
            const freeSector = trdSector % 16;                 // Sector 0-15
            const freeTrack = Math.floor(trdSector / 16);      // Logical track 0-159
            trd[sector9 + 0xE1] = freeSector;
            trd[sector9 + 0xE2] = freeTrack;
            trd[sector9 + 0xE3] = 0x16;       // Disk type (80 tracks, DS)
            trd[sector9 + 0xE4] = files.length;   // File count
            const freeSectors = 2560 - trdSector;
            trd[sector9 + 0xE5] = freeSectors & 0xFF;
            trd[sector9 + 0xE6] = (freeSectors >> 8) & 0xFF;
            trd[sector9 + 0xE7] = 0x10;       // TR-DOS ID

            // Disk label at 0xF5-0xFC (8 bytes, space-padded)
            const label = "        ";  // 8 spaces
            for (let i = 0; i < 8; i++) {
                trd[sector9 + 0xF5 + i] = label.charCodeAt(i);
            }

            return trd;
        }

        // Convert TRD back to SCL format (inverse of sclToTrd).
        // The first 14 bytes of a TRD directory entry (name 8, type 1, start 2,
        // length 2, sector count 1) have the same layout as an SCL header.
        // Deleted entries (first byte 0x01) are skipped: TR-DOS erase only marks
        // the entry and overwrites the name's first character, so including them
        // would resurrect files with corrupt names. End marker 0x00 stops the scan.
        trdToScl(trdData) {
            const trd = new Uint8Array(trdData);

            // Scan directory: track 0, sectors 0-7, 128 entries of 16 bytes
            const files = [];
            for (let i = 0; i < 128; i++) {
                const off = i * 16;
                if (off + 16 > trd.length) break;
                const firstByte = trd[off];
                if (firstByte === 0x00) break;     // End of directory
                if (firstByte === 0x01) continue;  // Deleted file — never include
                const sectorCount = trd[off + 13];
                const startSector = trd[off + 14];
                const startTrack = trd[off + 15];
                files.push({
                    header: trd.slice(off, off + 14),
                    dataOffset: (startTrack * 16 + startSector) * 256,
                    dataSize: sectorCount * 256
                });
            }

            let totalData = 0;
            for (const f of files) totalData += f.dataSize;

            // signature(8) + count(1) + headers(14*n) + data + checksum(4)
            const scl = new Uint8Array(9 + files.length * 14 + totalData + 4);
            const sig = 'SINCLAIR';
            for (let i = 0; i < 8; i++) scl[i] = sig.charCodeAt(i);
            scl[8] = files.length;

            let offset = 9;
            for (const f of files) {
                scl.set(f.header, offset);
                offset += 14;
            }
            for (const f of files) {
                const end = Math.min(f.dataOffset + f.dataSize, trd.length);
                if (f.dataOffset < end) {
                    scl.set(trd.subarray(f.dataOffset, end), offset);
                }
                offset += f.dataSize;  // Short reads stay zero-padded
            }

            // Trailing 32-bit little-endian checksum over all preceding bytes
            const sum = sclChecksum(scl, offset);
            scl[offset] = sum & 0xFF;
            scl[offset + 1] = (sum >> 8) & 0xFF;
            scl[offset + 2] = (sum >> 16) & 0xFF;
            scl[offset + 3] = (sum >>> 24) & 0xFF;

            return scl;
        }

        ejectDisk(driveIndex) {
            if (driveIndex !== undefined) {
                const drv = this.drives[driveIndex & 0x03];
                drv.diskData = null;
                drv.diskType = null;
                drv.headTrack = 0;
            } else {
                // Eject current drive
                const drv = this.currentDisk;
                drv.diskData = null;
                drv.diskType = null;
                drv.headTrack = 0;
            }
            this.status = this.NOT_READY;
        }

        hasDisk(driveIndex) {
            if (driveIndex !== undefined) {
                return this.drives[driveIndex & 0x03].diskData !== null;
            }
            // Check current drive (backward compat)
            return this.currentDisk.diskData !== null;
        }

        // Check if any drive has a disk inserted
        hasAnyDisk() {
            return this.drives.some(d => d.diskData !== null);
        }

        // Calculate sector offset in disk image
        getSectorOffset(track, side, sector) {
            // TRD layout: interleaved (track 0 side 0, track 0 side 1, track 1 side 0, ...)
            // Each track-side has 16 sectors of 256 bytes = 4096 bytes
            const logicalTrack = track * 2 + side;
            // WD1793 sectors are 1-16, convert to 0-based index
            const sectorIndex = (logicalTrack * this.sectorsPerTrack) + (sector - 1);
            // Sector range is 1-16 on TRD
            return sectorIndex * this.bytesPerSector;
        }

        // Port read
        read(port) {
            const reg = port & 0xFF;

            switch (reg) {
                case 0x1F: // Status register
                    // Note: on real WD1793, reading status clears INTRQ.
                    // But in our instant-completion model, clearing here causes
                    // TR-DOS to miss INTRQ when it reads status (error check)
                    // before polling port $FF. INTRQ is already cleared when
                    // a new command is issued (executeCommand), which is sufficient.
                    if (!this.currentDisk.diskData) {
                        return this.NOT_READY;
                    }
                    let st = this.status;
                    if (this.reading && this.dataPos < this.dataLen) {
                        st |= this.DRQ;
                    }
                    // TRACK0 only applies to Type I commands
                    // For Type II/III, bit 2 is LOST_DATA (which should be 0 on success)
                    if (this.lastCmdType === 1 && this.track === 0) {
                        st |= this.TRACK0;
                    }
                    // Simulate INDEX pulse - ONLY for Type I commands!
                    // For Type II/III, bit 1 is DRQ (already handled above)
                    if (this.lastCmdType === 1) {
                        this.indexCounter = (this.indexCounter + 1) % 16;
                        if (this.indexCounter === 0) {
                            st |= this.INDEX;
                        }
                    }
                    return st;

                case 0x3F: // Track register
                    return this.track;

                case 0x5F: // Sector register
                    return this.sector;

                case 0x7F: // Data register
                    if (this.reading && this.dataBuffer && this.dataPos < this.dataLen) {
                        this._sysReadsSinceData = 0;  // Reset lost data counter
                        this.data = this.dataBuffer[this.dataPos++];
                        if (this.dataPos >= this.dataLen) {
                            if (this.multiSector) {
                                // Multi-sector: advance to next sector and continue reading
                                this.sector++;
                                if (this.sector > this.sectorsPerTrack) {
                                    // Past last sector on this side — stop
                                    this.reading = false;
                                    this.multiSector = false;
                                    this.status &= ~(this.BUSY | this.DRQ);
                                    this.intrq = true;
                                } else {
                                    // Read next sector
                                    this.readSector();
                                }
                            } else {
                                this.reading = false;
                                this.status &= ~(this.BUSY | this.DRQ);
                                this.intrq = true;
                            }
                        }
                    }
                    return this.data;

                case 0xFF: // System register
                    // Lost Data simulation: On real WD1793, data bytes arrive at the
                    // disk rotation rate. If the CPU polls the system register instead
                    // of reading data from port $7F, bytes are "lost" and the sector
                    // eventually completes with INTRQ. In our instant-completion model,
                    // we detect this by tracking consecutive system register polls
                    // without any port $7F data reads. After enough polls without data
                    // reads, we auto-complete the sector. This handles games/loaders
                    // that issue Read Sector and only poll for INTRQ.
                    if (this.reading && this.dataBuffer && this.dataPos < this.dataLen) {
                        this._sysReadsSinceData = (this._sysReadsSinceData || 0) + 1;
                        // After 2+ consecutive system register reads without a data read,
                        // treat remaining bytes as lost and complete the sector.
                        // The threshold of 2 allows the normal read loop pattern
                        // (check $FF → read $7F → check $FF) to work correctly,
                        // while catching loops that only poll $FF without reading $7F.
                        if (this._sysReadsSinceData >= 2) {
                            // Complete current sector (lost data)
                            this.dataPos = this.dataLen;
                            this.status |= this.LOST_DATA;
                            if (this.multiSector) {
                                this.sector++;
                                if (this.sector > this.sectorsPerTrack) {
                                    this.reading = false;
                                    this.multiSector = false;
                                    this.status &= ~(this.BUSY | this.DRQ);
                                    this.intrq = true;
                                } else {
                                    this.readSector();
                                }
                            } else {
                                this.reading = false;
                                this.status &= ~(this.BUSY | this.DRQ);
                                this.intrq = true;
                            }
                        }
                    }
                    let sys = 0;
                    if (this.intrq) sys |= 0x80;        // INTRQ
                    if (this.reading || this.writing) sys |= 0x40;  // DRQ
                    return sys;

                default:
                    return 0xFF;
            }
        }

        // Port write
        write(port, value) {
            const reg = port & 0xFF;

            switch (reg) {
                case 0x1F: // Command register
                    this.executeCommand(value);
                    break;

                case 0x3F: // Track register
                    this.track = value;
                    break;

                case 0x5F: // Sector register
                    this.sector = value;
                    break;

                case 0x7F: // Data register
                    this.data = value;
                    if (this.writing && this.dataBuffer && this.dataPos < this.dataLen) {
                        this.dataBuffer[this.dataPos++] = value;
                        if (this.dataPos >= this.dataLen) {
                            // Write buffer to disk
                            this.flushWriteBuffer();
                            if (this.multiSector) {
                                // Multi-sector: advance to next sector and continue writing
                                this.sector++;
                                if (this.sector > this.sectorsPerTrack) {
                                    this.writing = false;
                                    this.multiSector = false;
                                    // Clear DRQ along with BUSY: TR-DOS checks the final
                                    // status with AND 7Fh — a leftover DRQ bit reads as
                                    // a failed write ("Disc error")
                                    this.status &= ~(this.BUSY | this.DRQ);
                                    this.intrq = true;
                                } else {
                                    this.writeSector();
                                }
                            } else {
                                this.writing = false;
                                this.status &= ~(this.BUSY | this.DRQ);
                                this.intrq = true;
                            }
                        }
                    }
                    break;

                case 0xFF: // System register
                    this.system = value;
                    this.drive = value & 0x03;
                    // Side bit is active-low: bit 4 = 1 means side 0, bit 4 = 0 means side 1
                    this.side = (value & 0x10) ? 0 : 1;
                    // Bit 0x04 = reset (active low)
                    if (!(value & 0x04)) {
                        this.reset();
                    }
                    break;
            }
        }

        reset() {
            this.command = 0;
            this.status = 0;
            this.track = 0;
            this.sector = 1;
            this.reading = false;
            this.writing = false;
            this.dataBuffer = null;
            this.intrq = false;
        }

        executeCommand(cmd) {
            this.command = cmd;
            this.status = 0;
            this.intrq = false;
            this._sysReadsSinceData = 0;  // Reset lost data counter for new command

            if (!this.currentDisk.diskData) {
                this.status = this.NOT_READY;
                this.intrq = true;
                return;
            }

            const cmdType = cmd >> 4;

            // Type I commands (restore, seek, step)
            // Update both WD1793 track register AND per-drive headTrack
            if ((cmd & 0x80) === 0) {
                this.lastCmdType = 1;
                this.status |= this.BUSY;

                if ((cmd & 0xF0) === 0x00) {
                    // Restore (seek to track 0)
                    this.track = 0;
                    this.currentDisk.headTrack = 0;
                    this.status |= this.TRACK0;
                } else if ((cmd & 0xF0) === 0x10) {
                    // Seek to track in data register
                    this.track = this.data;
                    this.currentDisk.headTrack = this.data;
                    if (this.track === 0) this.status |= this.TRACK0;
                } else if ((cmd & 0xE0) === 0x20) {
                    // Step (keep direction)
                    // Not commonly used, skip for now
                } else if ((cmd & 0xE0) === 0x40) {
                    // Step in
                    if (this.track < 79) this.track++;
                    this.currentDisk.headTrack = this.track;
                } else if ((cmd & 0xE0) === 0x60) {
                    // Step out
                    if (this.track > 0) this.track--;
                    this.currentDisk.headTrack = this.track;
                    if (this.track === 0) this.status |= this.TRACK0;
                }

                this.status &= ~this.BUSY;
                this.status |= this.HEAD_LOADED;
                this.intrq = true;
                return;
            }

            // Type II commands (read/write sector)
            if ((cmd & 0xC0) === 0x80) {
                this.lastCmdType = 2;
                this.multiSector = !!(cmd & 0x10);  // Bit 4 = multiple sectors
                this.status = this.BUSY;  // Clear all status bits except BUSY (no HEAD_LOADED for Type II)

                if ((cmd & 0x20) === 0) {
                    // Read sector
                    this.readSector();
                } else {
                    // Write sector
                    this.writeSector();
                }
                return;
            }

            // Type IV command (force interrupt) - check BEFORE Type III!
            if ((cmd & 0xF0) === 0xD0) {
                // Don't change lastCmdType - Force Interrupt preserves previous type
                this.reading = false;
                this.writing = false;
                this.multiSector = false;
                this.status &= ~this.BUSY;
                this.status |= this.HEAD_LOADED;  // Head stays loaded
                if (this.track === 0) this.status |= this.TRACK0;
                if (cmd & 0x08) this.intrq = true;  // Immediate interrupt
                return;
            }

            // Type III commands (read/write track, read address)
            if ((cmd & 0xC0) === 0xC0) {
                this.lastCmdType = 2;
                if ((cmd & 0xF0) === 0xC0) {
                    // Read address - return track/side/sector/size
                    this.dataBuffer = new Uint8Array([
                        this.currentDisk.headTrack, this.side, this.sector, 1, 0, 0
                    ]);
                    this.dataPos = 0;
                    this.dataLen = 6;
                    this.reading = true;
                    this.status |= this.BUSY | this.DRQ;
                } else if ((cmd & 0xF0) === 0xE0) {
                    // Read Track - not implemented, signal completion
                    this.status = 0;
                    this.intrq = true;
                } else if ((cmd & 0xF0) === 0xF0) {
                    // Write Track - not implemented, signal completion
                    this.status = 0;
                    this.intrq = true;
                }
                return;
            }
        }

        readSector() {
            const drv = this.currentDisk;
            const offset = this.getSectorOffset(this.track, this.side, this.sector);

            // Notify disk activity (include drive number)
            if (this.onDiskActivity) {
                this.onDiskActivity('read', this.track, this.sector, this.side, this.drive);
            }

            if (offset + this.bytesPerSector > drv.diskData.length) {
                this.status |= this.RNF;
                this.status &= ~this.BUSY;
                this.intrq = true;
                return;
            }

            this.dataBuffer = drv.diskData.slice(offset, offset + this.bytesPerSector);

            this.dataPos = 0;
            this.dataLen = this.bytesPerSector;
            this.reading = true;
            this.status |= this.DRQ | this.BUSY;
        }

        writeSector() {
            const drv = this.currentDisk;
            const offset = this.getSectorOffset(this.track, this.side, this.sector);

            // Notify disk activity (include drive number)
            if (this.onDiskActivity) {
                this.onDiskActivity('write', this.track, this.sector, this.side, this.drive);
            }

            if (offset + this.bytesPerSector > drv.diskData.length) {
                this.status |= this.RNF;
                this.status &= ~this.BUSY;
                this.intrq = true;
                return;
            }

            this.writeOffset = offset;
            this.dataBuffer = new Uint8Array(this.bytesPerSector);
            this.dataPos = 0;
            this.dataLen = this.bytesPerSector;
            this.writing = true;
            this.status |= this.DRQ;
        }

        flushWriteBuffer() {
            if (this.writeOffset !== undefined && this.dataBuffer) {
                this.currentDisk.diskData.set(this.dataBuffer, this.writeOffset);
            }
        }

        // Get INTRQ state (directly accessible for memory mapping)
        getIntrq() {
            return this.intrq;
        }
    }

    /**
     * ZIP archive loader - extracts SNA/TAP files from ZIP archives
     */
    export class ZipLoader {
        static get VERSION() { return VERSION; }
        
        /**
         * Check if data is a ZIP file
         */
        static isZip(data) {
            const view = new Uint8Array(data);
            // ZIP signature: PK\x03\x04
            return view[0] === 0x50 && view[1] === 0x4B && 
                   view[2] === 0x03 && view[3] === 0x04;
        }
        
        /**
         * Extract files from ZIP archive
         * Returns array of {name, data} objects
         */
        static async extract(zipData) {
            const data = new Uint8Array(zipData);
            const files = [];

            // First, find the central directory to get accurate file sizes
            // (some ZIPs use data descriptors and have 0 in local header sizes)
            const centralDir = ZipLoader.findCentralDirectory(data);

            let offset = 0;

            while (offset < data.length - 4) {
                // Check for local file header signature
                if (data[offset] !== 0x50 || data[offset + 1] !== 0x4B ||
                    data[offset + 2] !== 0x03 || data[offset + 3] !== 0x04) {
                    break; // End of local file headers
                }

                // Parse local file header
                const gpFlag = data[offset + 6] | (data[offset + 7] << 8);
                const compression = data[offset + 8] | (data[offset + 9] << 8);
                let compressedSize = data[offset + 18] | (data[offset + 19] << 8) |
                                      (data[offset + 20] << 16) | (data[offset + 21] << 24);
                let uncompressedSize = data[offset + 22] | (data[offset + 23] << 8) |
                                        (data[offset + 24] << 16) | (data[offset + 25] << 24);
                const nameLength = data[offset + 26] | (data[offset + 27] << 8);
                const extraLength = data[offset + 28] | (data[offset + 29] << 8);

                // Get filename
                const nameBytes = data.slice(offset + 30, offset + 30 + nameLength);
                const name = new TextDecoder().decode(nameBytes);

                // If data descriptor flag is set (bit 3) and sizes are 0, get from central directory
                if ((gpFlag & 0x08) && (compressedSize === 0 || uncompressedSize === 0)) {
                    const cdEntry = centralDir.get(name);
                    if (cdEntry) {
                        compressedSize = cdEntry.compressedSize;
                        uncompressedSize = cdEntry.uncompressedSize;
                    }
                }

                // Get compressed data
                const dataStart = offset + 30 + nameLength + extraLength;
                const compressedData = data.slice(dataStart, dataStart + compressedSize);

                // Decompress if needed
                let fileData;
                if (compression === 0) {
                    // Stored (no compression)
                    fileData = compressedData;
                } else if (compression === 8) {
                    // Deflate
                    fileData = await ZipLoader.inflate(compressedData, uncompressedSize);
                } else {
                    console.warn(`Unsupported compression method ${compression} for ${name}`);
                    offset = dataStart + compressedSize;
                    continue;
                }

                // Skip directories
                if (!name.endsWith('/')) {
                    files.push({ name, data: fileData });
                }

                // Move past data, and data descriptor if present
                offset = dataStart + compressedSize;
                if (gpFlag & 0x08) {
                    // Skip data descriptor (may have optional signature + crc + sizes)
                    if (data[offset] === 0x50 && data[offset + 1] === 0x4B &&
                        data[offset + 2] === 0x07 && data[offset + 3] === 0x08) {
                        offset += 16;  // Signature + CRC + compressed + uncompressed
                    } else {
                        offset += 12;  // CRC + compressed + uncompressed (no signature)
                    }
                }
            }

            return files;
        }

        /**
         * Find and parse central directory for accurate file sizes
         */
        static findCentralDirectory(data) {
            const entries = new Map();

            // Find End of Central Directory (search from end)
            let eocdOffset = -1;
            for (let i = data.length - 22; i >= 0; i--) {
                if (data[i] === 0x50 && data[i + 1] === 0x4B &&
                    data[i + 2] === 0x05 && data[i + 3] === 0x06) {
                    eocdOffset = i;
                    break;
                }
            }

            if (eocdOffset < 0) return entries;

            // Get central directory offset
            const cdOffset = data[eocdOffset + 16] | (data[eocdOffset + 17] << 8) |
                            (data[eocdOffset + 18] << 16) | (data[eocdOffset + 19] << 24);
            const cdSize = data[eocdOffset + 12] | (data[eocdOffset + 13] << 8) |
                          (data[eocdOffset + 14] << 16) | (data[eocdOffset + 15] << 24);

            // Parse central directory entries
            let offset = cdOffset;
            while (offset < cdOffset + cdSize && offset < data.length - 4) {
                // Check for central directory signature
                if (data[offset] !== 0x50 || data[offset + 1] !== 0x4B ||
                    data[offset + 2] !== 0x01 || data[offset + 3] !== 0x02) {
                    break;
                }

                const compressedSize = data[offset + 20] | (data[offset + 21] << 8) |
                                      (data[offset + 22] << 16) | (data[offset + 23] << 24);
                const uncompressedSize = data[offset + 24] | (data[offset + 25] << 8) |
                                        (data[offset + 26] << 16) | (data[offset + 27] << 24);
                const nameLength = data[offset + 28] | (data[offset + 29] << 8);
                const extraLength = data[offset + 30] | (data[offset + 31] << 8);
                const commentLength = data[offset + 32] | (data[offset + 33] << 8);

                const nameBytes = data.slice(offset + 46, offset + 46 + nameLength);
                const name = new TextDecoder().decode(nameBytes);

                entries.set(name, { compressedSize, uncompressedSize });

                offset += 46 + nameLength + extraLength + commentLength;
            }

            return entries;
        }
        
        /**
         * Inflate (decompress) deflate data
         */
        static async inflate(compressedData, expectedSize) {
            // Try using DecompressionStream API (modern browsers)
            if (typeof DecompressionStream !== 'undefined') {
                try {
                    // ZIP uses raw deflate, so use 'deflate-raw'
                    const ds = new DecompressionStream('deflate-raw');
                    const writer = ds.writable.getWriter();
                    writer.write(compressedData);
                    writer.close();
                    
                    const reader = ds.readable.getReader();
                    const chunks = [];
                    let totalLength = 0;
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        totalLength += value.length;
                    }
                    
                    const result = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        result.set(chunk, offset);
                        offset += chunk.length;
                    }
                    return result;
                } catch (e) {
                    console.warn('DecompressionStream failed, trying fallback:', e);
                }
            }
            
            // Fallback: manual inflate (basic implementation)
            return ZipLoader.inflateRaw(compressedData, expectedSize);
        }
        
        /**
         * Basic raw inflate implementation for deflate data
         */
        static inflateRaw(data, expectedSize) {
            const output = new Uint8Array(expectedSize);
            let inPos = 0;
            let outPos = 0;
            let bitBuf = 0;
            let bitCount = 0;
            
            function readBits(n) {
                while (bitCount < n) {
                    if (inPos >= data.length) return 0;
                    bitBuf |= data[inPos++] << bitCount;
                    bitCount += 8;
                }
                const val = bitBuf & ((1 << n) - 1);
                bitBuf >>= n;
                bitCount -= n;
                return val;
            }
            
            // Fixed Huffman code lengths
            const fixedLitLen = new Uint8Array(288);
            for (let i = 0; i <= 143; i++) fixedLitLen[i] = 8;
            for (let i = 144; i <= 255; i++) fixedLitLen[i] = 9;
            for (let i = 256; i <= 279; i++) fixedLitLen[i] = 7;
            for (let i = 280; i <= 287; i++) fixedLitLen[i] = 8;
            
            const fixedDistLen = new Uint8Array(32);
            fixedDistLen.fill(5);
            
            function buildTree(lengths) {
                const maxLen = Math.max(...lengths);
                const counts = new Uint16Array(maxLen + 1);
                const nextCode = new Uint16Array(maxLen + 1);
                const tree = new Uint16Array(1 << maxLen);
                
                for (const len of lengths) if (len) counts[len]++;
                
                let code = 0;
                for (let i = 1; i <= maxLen; i++) {
                    code = (code + counts[i - 1]) << 1;
                    nextCode[i] = code;
                }
                
                for (let i = 0; i < lengths.length; i++) {
                    const len = lengths[i];
                    if (len) {
                        const c = nextCode[len]++;
                        const reversed = parseInt(c.toString(2).padStart(len, '0').split('').reverse().join(''), 2);
                        for (let j = reversed; j < (1 << maxLen); j += (1 << len)) {
                            tree[j] = (i << 4) | len;
                        }
                    }
                }
                return { tree, maxLen };
            }
            
            function readSymbol(huffTree) {
                const bits = readBits(huffTree.maxLen);
                const entry = huffTree.tree[bits];
                const len = entry & 0xF;
                const sym = entry >> 4;
                // Put back unused bits
                const unused = huffTree.maxLen - len;
                bitBuf = (bitBuf << unused) | (bits >> len);
                bitCount += unused;
                bitBuf &= (1 << bitCount) - 1;
                return sym;
            }
            
            const lenBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
            const lenExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
            const distBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
            const distExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
            
            while (inPos < data.length || bitCount > 0) {
                const bfinal = readBits(1);
                const btype = readBits(2);
                
                if (btype === 0) {
                    // Stored block
                    bitBuf = 0;
                    bitCount = 0;
                    const len = data[inPos] | (data[inPos + 1] << 8);
                    inPos += 4; // Skip len and nlen
                    for (let i = 0; i < len && outPos < expectedSize; i++) {
                        output[outPos++] = data[inPos++];
                    }
                } else {
                    // Compressed block
                    let litTree, distTree;
                    
                    if (btype === 1) {
                        // Fixed Huffman
                        litTree = buildTree(fixedLitLen);
                        distTree = buildTree(fixedDistLen);
                    } else {
                        // Dynamic Huffman - simplified, may not work for all files
                        const hlit = readBits(5) + 257;
                        const hdist = readBits(5) + 1;
                        const hclen = readBits(4) + 4;
                        
                        const codeLenOrder = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
                        const codeLens = new Uint8Array(19);
                        for (let i = 0; i < hclen; i++) {
                            codeLens[codeLenOrder[i]] = readBits(3);
                        }
                        const codeTree = buildTree(codeLens);
                        
                        const allLens = new Uint8Array(hlit + hdist);
                        let i = 0;
                        while (i < hlit + hdist) {
                            const sym = readSymbol(codeTree);
                            if (sym < 16) {
                                allLens[i++] = sym;
                            } else if (sym === 16) {
                                const repeat = readBits(2) + 3;
                                for (let j = 0; j < repeat; j++) allLens[i++] = allLens[i - 1];
                            } else if (sym === 17) {
                                i += readBits(3) + 3;
                            } else {
                                i += readBits(7) + 11;
                            }
                        }
                        
                        litTree = buildTree(allLens.slice(0, hlit));
                        distTree = buildTree(allLens.slice(hlit));
                    }
                    
                    // Decode symbols
                    while (outPos < expectedSize) {
                        const sym = readSymbol(litTree);
                        if (sym < 256) {
                            output[outPos++] = sym;
                        } else if (sym === 256) {
                            break; // End of block
                        } else {
                            // Length-distance pair
                            const lenIdx = sym - 257;
                            const length = lenBase[lenIdx] + readBits(lenExtra[lenIdx]);
                            const distSym = readSymbol(distTree);
                            const distance = distBase[distSym] + readBits(distExtra[distSym]);
                            
                            for (let i = 0; i < length && outPos < expectedSize; i++) {
                                output[outPos] = output[outPos - distance];
                                outPos++;
                            }
                        }
                    }
                }
                
                if (bfinal) break;
            }
            
            return output.slice(0, outPos);
        }
        
        /**
         * Find and extract first SNA/TAP file from ZIP
         */
        static async extractSpectrum(zipData) {
            const files = await ZipLoader.extract(zipData);

            // Look for SNA, TAP, Z80, or RZX files
            for (const file of files) {
                const name = file.name.toLowerCase();
                if (name.endsWith('.sna') || name.endsWith('.tap') || name.endsWith('.z80') || name.endsWith('.rzx')) {
                    return {
                        name: file.name,
                        data: file.data,  // Keep as Uint8Array, not .buffer (slice issue)
                        type: name.endsWith('.sna') ? 'sna' :
                              name.endsWith('.z80') ? 'z80' :
                              name.endsWith('.rzx') ? 'rzx' : 'tap'
                    };
                }
            }

            // If no supported files found, list what's in the archive
            const fileNames = files.map(f => f.name).join(', ');
            throw new Error(`No SNA, TAP, Z80, RZX, TRD, SCL, MGT, DSK, or MDR file found in ZIP. Contents: ${fileNames}`);
        }

        /**
         * Find all Spectrum files in ZIP
         * Returns array of {name, data, type} objects
         */
        static async findAllSpectrum(zipData) {
            const files = await ZipLoader.extract(zipData);
            const spectrumFiles = [];

            for (const file of files) {
                const name = file.name.toLowerCase();
                if (name.endsWith('.sna') || name.endsWith('.tap') || name.endsWith('.tzx') ||
                    name.endsWith('.z80') || name.endsWith('.szx') || name.endsWith('.rzx') ||
                    name.endsWith('.trd') || name.endsWith('.scl') || name.endsWith('.dsk') ||
                    name.endsWith('.mgt') || name.endsWith('.img') || name.endsWith('.mdr') ||
                    name.endsWith('.opd') || name.endsWith('.opu') || name.endsWith('.wav')) {
                    let type;
                    if (name.endsWith('.sna')) type = 'sna';
                    else if (name.endsWith('.tzx')) type = 'tzx';
                    else if (name.endsWith('.z80')) type = 'z80';
                    else if (name.endsWith('.szx')) type = 'szx';
                    else if (name.endsWith('.rzx')) type = 'rzx';
                    else if (name.endsWith('.trd')) type = 'trd';
                    else if (name.endsWith('.scl')) type = 'scl';
                    else if (name.endsWith('.dsk')) type = 'dsk';
                    else if (name.endsWith('.mdr')) type = 'mdr';
                    else if (name.endsWith('.mgt') || name.endsWith('.img')) type = 'mgt';
                    else if (name.endsWith('.opd') || name.endsWith('.opu')) type = 'opd';
                    else if (name.endsWith('.wav')) type = 'wav';
                    else type = 'tap';

                    spectrumFiles.push({
                        name: file.name,
                        data: file.data,  // Keep as Uint8Array, not .buffer (slice issue)
                        type
                    });
                }
            }

            return spectrumFiles;
        }
    }

    /**
     * RZX file loader - handles RZX input recording format
     * RZX stores initial snapshot + frame-by-frame input recordings
     */
    export class RZXLoader {
        constructor() {
            this.frames = [];           // [{fetchCount, inputs: [value, ...]}]
            this.snapshot = null;       // Uint8Array of first embedded snapshot (for playback)
            this.snapshotExt = null;    // 'z80' or 'sna' or 'szx'
            this.allSnapshots = [];     // All snapshots: [{data: Uint8Array, ext: string, index: number}]
            this.totalFrames = 0;
            this.creatorInfo = null;
            this.rawData = null;        // Store raw file for analysis
        }

        static isRZX(data) {
            if (data.byteLength < 10) return false;
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            return bytes[0] === 0x52 && bytes[1] === 0x5A &&
                   bytes[2] === 0x58 && bytes[3] === 0x21; // "RZX!"
        }

        async parse(data) {
            // Normalize input to ArrayBuffer
            let buffer;
            if (data instanceof ArrayBuffer) {
                buffer = data;
            } else if (data instanceof Uint8Array) {
                buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            } else {
                throw new Error('RZX parse: expected ArrayBuffer or Uint8Array');
            }

            const bytes = new Uint8Array(buffer);
            this.rawData = bytes;  // Store for analysis
            if (!RZXLoader.isRZX(buffer)) {
                throw new Error('Invalid RZX signature');
            }

            const view = new DataView(buffer);
            const majorVersion = bytes[4];
            const minorVersion = bytes[5];
            // const flags = view.getUint32(6, true);

            let offset = 10;
            this.frames = [];
            this.snapshot = null;
            this.allSnapshots = [];

            while (offset < bytes.length - 5) {
                const blockId = bytes[offset];
                const blockLen = view.getUint32(offset + 1, true);

                // blockLen includes the 5-byte header (ID + length)
                if (blockLen < 5 || offset + blockLen > bytes.length) break;

                // Block data starts after the 5-byte header
                const blockData = bytes.slice(offset + 5, offset + blockLen);

                switch (blockId) {
                    case 0x10: // Creator info
                        this.parseCreatorBlock(blockData);
                        break;
                    case 0x30: // Snapshot block
                        // Parse and store ALL snapshots for exploration
                        const snapInfo = await this.parseSnapshotBlockToObject(blockData);
                        if (snapInfo) {
                            this.allSnapshots.push({
                                data: snapInfo.data,
                                ext: snapInfo.ext,
                                index: this.allSnapshots.length
                            });
                            // Use FIRST snapshot for playback
                            if (!this.snapshot) {
                                this.snapshot = snapInfo.data;
                                this.snapshotExt = snapInfo.ext;
                            }
                        }
                        break;
                    case 0x80: // Input recording block
                        await this.parseInputBlock(blockData);
                        break;
                    // Other blocks (security, etc.) are skipped
                }

                offset += blockLen;
            }

            this.totalFrames = this.frames.length;
            return true;
        }

        parseCreatorBlock(data) {
            // Creator ID (20 bytes) + major/minor version (2 bytes)
            let name = '';
            for (let i = 0; i < 20 && data[i] !== 0; i++) {
                name += String.fromCharCode(data[i]);
            }
            this.creatorInfo = {
                name: name.trim(),
                majorVersion: data[20] || 0,
                minorVersion: data[21] || 0
            };
        }

        // Parse snapshot block and return as object (for tracking multiple snapshots)
        async parseSnapshotBlockToObject(data) {
            if (data.length < 12) {
                console.warn('Snapshot block too short');
                return null;
            }

            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const flags = view.getUint32(0, true);
            // Note: Spectaculator/FUSE use bit 1 for compression (not bit 0 as spec might suggest)
            const compressed = (flags & 0x02) !== 0;

            // Extension is 4 bytes at offset 4 (e.g., "z80\0" or "sna\0" or "szx\0")
            let ext = '';
            for (let i = 0; i < 4 && data[4 + i] !== 0; i++) {
                ext += String.fromCharCode(data[4 + i]);
            }
            ext = ext.toLowerCase().replace('.', '') || 'z80';

            // UncompLen at offset 8, snapshot data at offset 12 (always present in practice)
            const uncompLen = view.getUint32(8, true);
            const snapData = data.slice(12);

            let snapBytes;
            if (compressed && snapData.length > 0) {
                snapBytes = await this.decompress(snapData, uncompLen);
            } else {
                snapBytes = new Uint8Array(snapData);
            }

            return { data: snapBytes, ext };
        }

        async parseSnapshotBlock(data) {
            if (data.length < 12) {
                throw new Error('Snapshot block too short');
            }

            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const flags = view.getUint32(0, true);
            // Note: Spectaculator/FUSE use bit 1 for compression (not bit 0 as spec might suggest)
            const compressed = (flags & 0x02) !== 0;

            // Extension is 4 bytes at offset 4 (e.g., "z80\0" or "sna\0")
            let ext = '';
            for (let i = 0; i < 4 && data[4 + i] !== 0; i++) {
                ext += String.fromCharCode(data[4 + i]);
            }
            this.snapshotExt = ext.toLowerCase().replace('.', '') || 'z80';

            // UncompLen at offset 8, snapshot data at offset 12 (always present in practice)
            const uncompLen = view.getUint32(8, true);
            const snapData = data.slice(12);

            if (compressed && snapData.length > 0) {
                this.snapshot = await this.decompress(snapData, uncompLen);
            } else {
                this.snapshot = new Uint8Array(snapData);
            }
        }

        async parseInputBlock(data) {
            if (data.length < 18) {
                console.warn('Input block too short, skipping');
                return;
            }

            const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
            const numFrames = view.getUint32(0, true);
            // const reserved = data[4];
            // const tstatesPerInt = view.getUint32(5, true);
            const flags = view.getUint32(9, true);
            const compressed = (flags & 0x02) !== 0;

            let frameData;
            if (compressed) {
                // Uncompressed size not stored - decompress and see
                try {
                    frameData = await this.decompress(data.slice(13));
                } catch (e) {
                    console.warn('RZX: Decompression failed, trying raw data:', e.message);
                    // Only use raw data if it looks reasonable (not too small)
                    if (data.length > 17) {
                        frameData = data.slice(13);
                    } else {
                        throw new Error('RZX decompression failed and raw data too small');
                    }
                }
            } else {
                frameData = data.slice(13);
            }

            // Parse frame data
            let offset = 0;
            const frameView = new DataView(frameData.buffer, frameData.byteOffset, frameData.byteLength);
            let lastInputs = [];

            for (let i = 0; i < numFrames && offset < frameData.length; i++) {
                if (offset + 4 > frameData.length) break;

                const fetchCount = frameView.getUint16(offset, true);
                const inCount = frameView.getUint16(offset + 2, true);
                offset += 4;

                let inputs;
                if (inCount === 0xFFFF) {
                    // Repeat previous frame's inputs
                    inputs = lastInputs.slice();
                } else {
                    inputs = [];
                    for (let j = 0; j < inCount && offset < frameData.length; j++) {
                        inputs.push(frameData[offset++]);
                    }
                    lastInputs = inputs;
                }

                this.frames.push({
                    fetchCount,
                    inputs,
                    inputIndex: 0
                });
            }
        }

        async decompress(data, expectedSize) {
            // Prefer pako if available (more reliable error handling)
            if (typeof pako !== 'undefined') {
                // Try zlib format first (with header), then raw deflate
                try {
                    return pako.inflate(data);
                } catch (e1) {
                    try {
                        return pako.inflateRaw(data);
                    } catch (e2) {
                        // Both failed - throw combined error
                        throw new Error('Decompression failed');
                    }
                }
            }

            // Fallback to DecompressionStream (modern browsers without pako)
            if (typeof DecompressionStream !== 'undefined') {
                try {
                    const ds = new DecompressionStream('deflate-raw');
                    const writer = ds.writable.getWriter();
                    writer.write(data);
                    writer.close();

                    const reader = ds.readable.getReader();
                    const chunks = [];
                    let totalLen = 0;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                        totalLen += value.length;
                    }

                    const result = new Uint8Array(totalLen);
                    let offset = 0;
                    for (const chunk of chunks) {
                        result.set(chunk, offset);
                        offset += chunk.length;
                    }
                    return result;
                } catch (e) {
                    throw new Error('Decompression failed');
                }
            }

            throw new Error('No decompression method available. Include pako.js for RZX support.');
        }

        getSnapshot() {
            return this.snapshot;
        }

        getSnapshotType() {
            return this.snapshotExt;
        }

        getFrameCount() {
            return this.totalFrames;
        }

        getFrame(frameNum) {
            if (frameNum < 0 || frameNum >= this.frames.length) return null;
            return this.frames[frameNum];
        }

        // Get all frames for analysis
        getFrames() {
            return this.frames;
        }

        // Analyze keypresses across all frames
        // Returns array of keypress events with timing info
        analyzeKeypresses() {
            const events = [];
            const currentKeys = new Map(); // key -> startFrame

            // Keyboard matrix rows
            const keyRows = {
                0xFE: ['Shift', 'Z', 'X', 'C', 'V'],
                0xFD: ['A', 'S', 'D', 'F', 'G'],
                0xFB: ['Q', 'W', 'E', 'R', 'T'],
                0xF7: ['1', '2', '3', '4', '5'],
                0xEF: ['0', '9', '8', '7', '6'],
                0xDF: ['P', 'O', 'I', 'U', 'Y'],
                0xBF: ['Enter', 'L', 'K', 'J', 'H'],
                0x7F: ['Space', 'Sym', 'M', 'N', 'B']
            };

            // Helper to decode a single port/value pair
            const decodeInput = (port, value) => {
                const keys = [];
                const highByte = (port >> 8) & 0xFF;
                for (const [rowMask, rowKeys] of Object.entries(keyRows)) {
                    const mask = parseInt(rowMask);
                    if ((highByte & mask) !== mask) {
                        for (let bit = 0; bit < 5; bit++) {
                            if ((value & (1 << bit)) === 0) {
                                keys.push(rowKeys[bit]);
                            }
                        }
                    }
                }
                return keys;
            };

            // Track pressed keys per frame (simplified - assumes 0xFExx port reads)
            for (let frameNum = 0; frameNum < this.frames.length; frameNum++) {
                const frame = this.frames[frameNum];
                const frameKeys = new Set();

                // Decode all inputs in this frame
                for (const input of frame.inputs) {
                    // Assume keyboard reads (port 0xFEFE typically, but we'll check all rows)
                    // Since we don't track the port in inputs, assume full keyboard scan
                    // A value of 0xBF or similar means some keys pressed
                    for (let bit = 0; bit < 5; bit++) {
                        if ((input & (1 << bit)) === 0) {
                            // This bit indicates a key pressed, but we don't know which row
                            // For analysis, we'll track the raw bit pattern
                            frameKeys.add(`bit${bit}`);
                        }
                    }
                }

                // Check for key state changes
                for (const [key, startFrame] of currentKeys) {
                    if (!frameKeys.has(key)) {
                        // Key released
                        events.push({
                            key,
                            startFrame,
                            endFrame: frameNum - 1,
                            duration: frameNum - startFrame
                        });
                        currentKeys.delete(key);
                    }
                }
                for (const key of frameKeys) {
                    if (!currentKeys.has(key)) {
                        // Key pressed
                        currentKeys.set(key, frameNum);
                    }
                }
            }

            // Close any remaining held keys
            for (const [key, startFrame] of currentKeys) {
                events.push({
                    key,
                    startFrame,
                    endFrame: this.frames.length - 1,
                    duration: this.frames.length - startFrame
                });
            }

            return events;
        }

        // Get frame statistics
        getStats() {
            if (this.frames.length === 0) return null;

            let totalInputs = 0;
            let totalFetchCount = 0;
            let minFetch = Infinity, maxFetch = 0;
            let minInputs = Infinity, maxInputs = 0;

            for (const frame of this.frames) {
                totalInputs += frame.inputs.length;
                totalFetchCount += frame.fetchCount;
                minFetch = Math.min(minFetch, frame.fetchCount);
                maxFetch = Math.max(maxFetch, frame.fetchCount);
                minInputs = Math.min(minInputs, frame.inputs.length);
                maxInputs = Math.max(maxInputs, frame.inputs.length);
            }

            return {
                frameCount: this.frames.length,
                totalInputs,
                totalFetchCount,
                avgFetchCount: Math.round(totalFetchCount / this.frames.length),
                avgInputsPerFrame: (totalInputs / this.frames.length).toFixed(1),
                fetchRange: { min: minFetch, max: maxFetch },
                inputsRange: { min: minInputs, max: maxInputs },
                durationSeconds: (this.frames.length / 50).toFixed(1) // 50 fps
            };
        }

        // Get next input for current frame
        getNextInput(frameNum) {
            const frame = this.frames[frameNum];
            if (!frame) return null;
            if (frame.inputIndex >= frame.inputs.length) {
                // Inputs exhausted - return last valid input to avoid sudden value changes
                return frame.inputs.length > 0 ? frame.inputs[frame.inputs.length - 1] : 0xBF;
            }
            return frame.inputs[frame.inputIndex++];
        }

        // Reset input index for a frame
        resetFrameInputs(frameNum) {
            const frame = this.frames[frameNum];
            if (frame) frame.inputIndex = 0;
        }

        // Get frame info for debugging
        getFrameInfo(frameNum) {
            const frame = this.frames[frameNum];
            if (!frame) return null;
            return {
                fetchCount: frame.fetchCount,
                inputCount: frame.inputs.length,
                inputIndex: frame.inputIndex,
                inputs: frame.inputs  // Include actual input data for debugging
            };
        }

        // Reset all frames
        reset() {
            for (const frame of this.frames) {
                frame.inputIndex = 0;
            }
        }
    }

    /**
     * TRD file loader - TR-DOS disk image format
     * Used by Beta Disk interface (Pentagon, Scorpion, etc.)
     */
    export class TRDLoader {
        static get VERSION() { return VERSION; }

        /**
         * Check if data is a TRD file
         * TRD files are typically 640KB (80 tracks * 2 sides * 16 sectors * 256 bytes)
         * or 655360 bytes. Can also be 40-track single-sided (163840 bytes)
         */
        static isTRD(data) {
            const bytes = new Uint8Array(data);
            // Check common TRD sizes
            const validSizes = [163840, 327680, 655360, 640 * 1024];
            if (!validSizes.includes(bytes.length) && bytes.length < 163840) {
                return false;
            }
            // Check disk info sector (track 0, sector 8, offset 0x8E0)
            // Byte 0xE7 should be 0x10 (TR-DOS signature)
            if (bytes.length > 0x8E7 && bytes[0x8E7] === 0x10) {
                return true;
            }
            // Also accept if first file entry looks valid
            if (bytes.length > 16 && bytes[0] !== 0x00 && bytes[0] !== 0x01) {
                const firstChar = bytes[0];
                // First char should be printable ASCII or deleted marker (0x01)
                return firstChar >= 0x20 && firstChar < 0x80;
            }
            return false;
        }

        /**
         * Decode the start/length pair of a TR-DOS catalogue entry by file type.
         * BASIC (B, 0x42): bytes 9-10 = total length (program + variables),
         *   bytes 11-12 = program length (the offset where variables begin).
         * CODE/others: bytes 9-10 = start/load address, bytes 11-12 = data length.
         * (TR-DOS catalogue convention; Sinclair Wiki + Kaitai tr_dos_image spec.)
         * Returns { start, length, programLength }, where `length` is always the
         * number of data bytes to extract and `programLength` is null for non-BASIC.
         */
        static decodeEntryLen(extByte, w9, w11) {
            if (extByte === 0x42) return { start: 0, length: w9, programLength: w11 };
            return { start: w9, length: w11, programLength: null };
        }

        /**
         * Encode a TR-DOS catalogue entry's 9-10 / 11-12 words for a file being
         * written. Inverse of decodeEntryLen. For BASIC, `total` is the full data
         * length (program + variables) and `programLength` the variables offset
         * (defaults to total = "no variables"). For others, `start` is the load
         * address and `total` the data length.
         */
        static encodeEntryLen(extByte, total, start, programLength) {
            if (extByte === 0x42) return { w9: total, w11: (programLength != null ? programLength : total) };
            return { w9: start || 0, w11: total };
        }

        /**
         * List files in TRD image
         * Returns array of {name, ext, start, length, programLength, sectors, track, sector}
         */
        static listFiles(data) {
            const bytes = new Uint8Array(data);
            const files = [];

            // Directory is in track 0, sectors 0-7 (offsets 0x000-0x7FF)
            // Each entry is 16 bytes, max 128 entries
            for (let i = 0; i < 128; i++) {
                const offset = i * 16;
                if (offset + 16 > bytes.length) break;

                const firstByte = bytes[offset];
                // 0x00 = end of directory, 0x01 = deleted file
                if (firstByte === 0x00) break;
                if (firstByte === 0x01) continue;

                // Read filename (8 bytes, space-padded)
                let name = '';
                for (let j = 0; j < 8; j++) {
                    const ch = bytes[offset + j];
                    if (ch >= 0x20 && ch < 0x80) {
                        name += String.fromCharCode(ch);
                    }
                }
                name = name.trimEnd();

                // File extension/type
                const extByte = bytes[offset + 8];
                let ext = String.fromCharCode(extByte);
                let type = 'unknown';
                if (extByte === 0x42) type = 'basic';      // 'B'
                else if (extByte === 0x43) type = 'code';  // 'C'
                else if (extByte === 0x44) type = 'data';  // 'D'
                else if (extByte === 0x23) type = 'seq';   // '#'

                // BASIC: 9-10 = total length, 11-12 = program length; CODE: 9-10 =
                // load address, 11-12 = length. (see decodeEntryLen)
                const w9 = bytes[offset + 9] | (bytes[offset + 10] << 8);
                const w11 = bytes[offset + 11] | (bytes[offset + 12] << 8);
                const { start, length, programLength } = TRDLoader.decodeEntryLen(extByte, w9, w11);
                // Length in sectors
                const sectors = bytes[offset + 13];
                // Starting position
                const sector = bytes[offset + 14];
                const track = bytes[offset + 15];

                if (name && length > 0) {
                    files.push({
                        name,
                        ext,
                        type,
                        start,
                        length,
                        programLength,
                        sectors,
                        sector,
                        track,
                        fullName: `${name}.${ext}`
                    });
                }
            }

            return files;
        }

        /**
         * Extract file data from TRD image
         */
        static extractFile(data, fileInfo) {
            const bytes = new Uint8Array(data);
            const sectorSize = 256;
            const sectorsPerTrack = 16;

            // Calculate offset: track * 16 sectors * 256 + sector * 256
            const startOffset = (fileInfo.track * sectorsPerTrack + fileInfo.sector) * sectorSize;

            if (startOffset + fileInfo.length > bytes.length) {
                throw new Error(`File extends beyond disk image: ${fileInfo.fullName}`);
            }

            return bytes.slice(startOffset, startOffset + fileInfo.length);
        }

        /**
         * Convert TRD file to TAP format for loading
         */
        static fileToTAP(fileData, fileInfo) {
            const blocks = [];

            if (fileInfo.type === 'basic') {
                // BASIC program: header + data
                // Header block
                const header = new Uint8Array(19);
                header[0] = 0x00;  // Header flag
                header[1] = 0x00;  // Type: Program
                // Filename (10 bytes, space-padded)
                writeField(header, 2, fileInfo.name, 10, 0x20);
                // Data length = total (program + variables)
                header[12] = fileData.length & 0xFF;
                header[13] = (fileData.length >> 8) & 0xFF;
                // Autostart line — the TR-DOS catalogue has no autostart field, so
                // emit "no auto-run" (>= 32768) rather than a bogus line number.
                header[14] = 0x00;
                header[15] = 0x80;
                // Program length (param 2) = offset where variables begin; falls back
                // to the full length when no variables area is present.
                const progLen = (fileInfo.programLength != null) ? fileInfo.programLength : fileData.length;
                header[16] = progLen & 0xFF;
                header[17] = (progLen >> 8) & 0xFF;
                // Checksum
                header[18] = xorChecksum(header, 0, 18);

                blocks.push(header);

                // Data block
                const dataBlock = new Uint8Array(fileData.length + 2);
                dataBlock[0] = 0xFF;  // Data flag
                dataBlock.set(fileData, 1);
                dataBlock[dataBlock.length - 1] = xorChecksum(fileData, 0xFF);

                blocks.push(dataBlock);
            } else if (fileInfo.type === 'code') {
                // Code file: header + data
                const header = new Uint8Array(19);
                header[0] = 0x00;  // Header flag
                header[1] = 0x03;  // Type: Bytes
                for (let i = 0; i < 10; i++) {
                    header[2 + i] = i < fileInfo.name.length ? fileInfo.name.charCodeAt(i) : 0x20;
                }
                header[12] = fileInfo.length & 0xFF;
                header[13] = (fileInfo.length >> 8) & 0xFF;
                header[14] = fileInfo.start & 0xFF;
                header[15] = (fileInfo.start >> 8) & 0xFF;
                header[16] = 0x00;
                header[17] = 0x80;
                header[18] = xorChecksum(header, 0, 18);

                blocks.push(header);

                const dataBlock = new Uint8Array(fileData.length + 2);
                dataBlock[0] = 0xFF;
                dataBlock.set(fileData, 1);
                dataBlock[dataBlock.length - 1] = xorChecksum(fileData, 0xFF);

                blocks.push(dataBlock);
            } else {
                // Other types: just data block
                const dataBlock = new Uint8Array(fileData.length + 2);
                dataBlock[0] = 0xFF;
                dataBlock.set(fileData, 1);
                dataBlock[dataBlock.length - 1] = xorChecksum(fileData, 0xFF);

                blocks.push(dataBlock);
            }

            // Build TAP file
            let totalLen = 0;
            for (const block of blocks) totalLen += block.length + 2;

            const tap = new Uint8Array(totalLen);
            let offset = 0;
            for (const block of blocks) {
                tap[offset] = block.length & 0xFF;
                tap[offset + 1] = (block.length >> 8) & 0xFF;
                tap.set(block, offset + 2);
                offset += block.length + 2;
            }

            return tap;
        }

        /**
         * Build a 640KB TRD image from a file list. Files are written sequentially
         * from logical track 1 — so rebuilding from the surviving files after a delete
         * compacts the disk (reclaims the removed files' sectors). Each file:
         * { name, ext, length, startAddress, programLength, sectors, data, deleted }.
         * A `deleted` file keeps its slot/data but its dir entry is marked 0x01 and it
         * is excluded from the file count (TR-DOS soft delete).
         */
        // bannerNames: optional array of 8-byte name buffers, written as fake
        // zero-length catalogue entries BEFORE the real files — a SPECSCII
        // banner drawn by TR-DOS LIST (see core/specscii.js).
        static buildTRD(files, diskLabel = '', bannerNames = null) {
            const trd = new Uint8Array(655360);
            let trdSector = 16;          // data starts at logical track 1
            let activeFileCount = 0;
            let entryBase = 0;
            if (bannerNames) {
                for (const nm of bannerNames) {
                    const off = entryBase * 16;
                    for (let c = 0; c < 8; c++) trd[off + c] = nm[c];
                    trd[off + 8] = 0x20;   // type: space, like real banner disks
                    // length/start address/sectors/position stay zero
                    entryBase++;
                    activeFileCount++;     // counted like Deja Vu #0A does
                }
            }
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const off = (entryBase + i) * 16;
                writeField(trd, off, f.name || '', 8, 0x20);
                if (f.deleted) trd[off] = 0x01;
                else activeFileCount++;
                const extByte = (f.ext || 'C').charCodeAt(0);
                trd[off + 8] = extByte;
                const { w9, w11 } = TRDLoader.encodeEntryLen(extByte, f.length, f.startAddress, f.programLength);
                trd[off + 9] = w9 & 0xFF; trd[off + 10] = (w9 >> 8) & 0xFF;
                trd[off + 11] = w11 & 0xFF; trd[off + 12] = (w11 >> 8) & 0xFF;
                trd[off + 13] = f.sectors;
                trd[off + 14] = trdSector % 16;
                trd[off + 15] = Math.floor(trdSector / 16);
                trd.set(f.data.subarray(0, f.sectors * 256), trdSector * 256);
                trdSector += f.sectors;
            }
            const info = 0x800;          // sysinfo sector (track 0, sector 8)
            trd[info + 0xE1] = trdSector % 16;
            trd[info + 0xE2] = Math.floor(trdSector / 16);
            trd[info + 0xE3] = 0x16;     // 80-track DS
            trd[info + 0xE4] = activeFileCount;
            const freeSectors = 2560 - trdSector;
            trd[info + 0xE5] = freeSectors & 0xFF;
            trd[info + 0xE6] = (freeSectors >> 8) & 0xFF;
            trd[info + 0xE7] = 0x10;     // TR-DOS id
            for (let c = 0xEA; c <= 0xF2; c++) trd[info + c] = 0x20; // sysinfo: 9 spaces (per real TR-DOS)
            const label = (diskLabel || '') + '        ';
            for (let c = 0; c < 8; c++) trd[info + 0xF5 + c] = label.charCodeAt(c) || 0x20;
            return trd;
        }
    }

    /**
     * SCL file loader - TR-DOS file archive format
     * More compact than TRD - only stores files, not empty sectors
     */
    export class SCLLoader {
        static get VERSION() { return VERSION; }

        /**
         * Check if data is an SCL file
         */
        static isSCL(data) {
            const bytes = new Uint8Array(data);
            if (bytes.length < 9) return false;
            // Check "SINCLAIR" signature
            const sig = String.fromCharCode(...bytes.slice(0, 8));
            return sig === 'SINCLAIR';
        }

        /**
         * List files in SCL archive
         */
        static listFiles(data) {
            const bytes = new Uint8Array(data);
            if (!SCLLoader.isSCL(data)) {
                throw new Error('Invalid SCL signature');
            }

            const numFiles = bytes[8];
            const files = [];
            let dataOffset = 9 + numFiles * 14;  // Header + descriptors

            for (let i = 0; i < numFiles; i++) {
                const descOffset = 9 + i * 14;

                // Read filename (8 bytes)
                let name = '';
                for (let j = 0; j < 8; j++) {
                    const ch = bytes[descOffset + j];
                    if (ch >= 0x20 && ch < 0x80) {
                        name += String.fromCharCode(ch);
                    }
                }
                name = name.trimEnd();

                const extByte = bytes[descOffset + 8];
                let ext = String.fromCharCode(extByte);
                let type = 'unknown';
                if (extByte === 0x42) type = 'basic';
                else if (extByte === 0x43) type = 'code';
                else if (extByte === 0x44) type = 'data';
                else if (extByte === 0x23) type = 'seq';

                // BASIC: 9-10 = total length, 11-12 = program length; CODE: 9-10 =
                // load address, 11-12 = length. (see TRDLoader.decodeEntryLen)
                const w9 = bytes[descOffset + 9] | (bytes[descOffset + 10] << 8);
                const w11 = bytes[descOffset + 11] | (bytes[descOffset + 12] << 8);
                const { start, length, programLength } = TRDLoader.decodeEntryLen(extByte, w9, w11);
                const sectors = bytes[descOffset + 13];

                files.push({
                    name,
                    ext,
                    type,
                    start,
                    length,
                    programLength,
                    sectors,
                    dataOffset,
                    fullName: `${name}.${ext}`
                });

                // Next file's data starts after this file's sectors
                dataOffset += sectors * 256;
            }

            return files;
        }

        /**
         * Extract file data from SCL archive
         */
        static extractFile(data, fileInfo) {
            const bytes = new Uint8Array(data);

            if (fileInfo.dataOffset + fileInfo.length > bytes.length) {
                throw new Error(`File extends beyond archive: ${fileInfo.fullName}`);
            }

            return bytes.slice(fileInfo.dataOffset, fileInfo.dataOffset + fileInfo.length);
        }

        /**
         * Convert SCL file to TAP format (reuse TRD logic)
         */
        static fileToTAP(fileData, fileInfo) {
            return TRDLoader.fileToTAP(fileData, fileInfo);
        }

        /**
         * Build an SCL archive from a file list (deleted files are dropped — SCL has no
         * erase marker, so rebuilding compacts). Same per-file fields as buildTRD; uses
         * the TR-DOS catalogue convention for the 9-10/11-12 words (BASIC-aware).
         */
        static buildSCL(files, bannerNames = null) {
            const active = files.filter(f => !f.deleted);
            const bannerCount = bannerNames ? bannerNames.length : 0;
            let totalData = 0;
            for (const f of active) totalData += f.sectors * 256;
            const scl = new Uint8Array(9 + (bannerCount + active.length) * 14 + totalData + 4);
            const sig = 'SINCLAIR';
            for (let i = 0; i < 8; i++) scl[i] = sig.charCodeAt(i);
            scl[8] = bannerCount + active.length;
            let offset = 9;
            if (bannerNames) {
                for (const nm of bannerNames) {
                    for (let c = 0; c < 8; c++) scl[offset + c] = nm[c];
                    scl[offset + 8] = 0x20; // fake banner entry: type space, no data
                    offset += 14;
                }
            }
            for (const f of active) {
                const name = ((f.name || '') + '        ').substring(0, 8);
                for (let c = 0; c < 8; c++) scl[offset + c] = name.charCodeAt(c) || 0x20;
                const extByte = (f.ext || 'C').charCodeAt(0);
                scl[offset + 8] = extByte;
                const { w9, w11 } = TRDLoader.encodeEntryLen(extByte, f.length, f.startAddress, f.programLength);
                scl[offset + 9] = w9 & 0xFF; scl[offset + 10] = (w9 >> 8) & 0xFF;
                scl[offset + 11] = w11 & 0xFF; scl[offset + 12] = (w11 >> 8) & 0xFF;
                scl[offset + 13] = f.sectors;
                offset += 14;
            }
            for (const f of active) { scl.set(f.data.subarray(0, f.sectors * 256), offset); offset += f.sectors * 256; }
            const sum = sclChecksum(scl, offset);
            scl[offset] = sum & 0xFF; scl[offset + 1] = (sum >> 8) & 0xFF;
            scl[offset + 2] = (sum >> 16) & 0xFF; scl[offset + 3] = (sum >>> 24) & 0xFF;
            return scl;
        }
    }

    /**
     * MGT file loader - DISCiPLE/+D disk image format
     * 80 tracks × 2 sides × 10 sectors/track × 512 bytes/sector = 819200 bytes
     * Directory in tracks 0-1 (both sides): 80 entries × 256 bytes
     */
    export class MGTLoader {
        static get VERSION() { return VERSION; }

        /**
         * Check if data is an MGT file
         * Standard: 819200 bytes (80 tracks, 2 sides, 10 sectors, 512 bytes)
         * 40-track: 409600 bytes (40 tracks variant)
         */
        static isMGT(data) {
            const bytes = new Uint8Array(data);
            if (bytes.length !== 819200 && bytes.length !== 409600) return false;

            // Validate directory: check first few slots have valid file types
            // G+DOS types 1-11, SAMDOS types 16-20
            let validCount = 0;
            let emptyCount = 0;
            for (let i = 0; i < 20; i++) {
                const slotOffset = MGTLoader._slotOffset(i);
                if (slotOffset + 256 > bytes.length) break;
                const fileType = bytes[slotOffset];
                if (fileType === 0) {
                    emptyCount++;
                } else if ((fileType >= 1 && fileType <= 11) || (fileType >= 16 && fileType <= 20)) {
                    validCount++;
                } else {
                    // Invalid file type — not MGT
                    return false;
                }
            }
            // Need at least one valid file, or all empty (blank disk)
            return validCount > 0 || emptyCount >= 5;
        }

        /**
         * Calculate byte offset of directory slot N in the disk image.
         * Directory: tracks 0-1, both sides = 40 sectors × 512 bytes.
         * 2 entries per sector (256 bytes each).
         * Sector layout: T0S0 S0, T0S0 S1, T0S1 S0, T0S1 S1, ... interleaved.
         *
         * Slot N:
         *   sectorIndex = floor(N / 2)
         *   entryInSector = N % 2
         *   Track-side mapping: sectors 0-9 = T0/S0, 10-19 = T0/S1, 20-29 = T1/S0, 30-39 = T1/S1
         *   imageOffset = ((track * 2 + side) * 10 + sectorInTrack) * 512 + entryInSector * 256
         */
        static _slotOffset(slotIndex) {
            const sectorIndex = Math.floor(slotIndex / 2);
            const entryInSector = slotIndex % 2;
            // sectorIndex 0-9: track 0 side 0
            // sectorIndex 10-19: track 0 side 1
            // sectorIndex 20-29: track 1 side 0
            // sectorIndex 30-39: track 1 side 1
            return sectorIndex * 512 + entryInSector * 256;
        }

        /**
         * Calculate image offset for a given track/side/sector.
         * Track: physical cylinder (0-79), Side: 0 or 1, Sector: 1-10 (1-based).
         * If track has bit 7 set, it encodes side 1 (track 0x80 = cyl 0 side 1).
         * MGT image layout: cyl0/s0, cyl0/s1, cyl1/s0, cyl1/s1, ...
         */
        static getSectorOffset(track, side, sector) {
            const physTrack = track & 0x7F;
            const physSide = (track & 0x80) ? 1 : side;
            return ((physTrack * 2 + physSide) * 10 + (sector - 1)) * 512;
        }

        /**
         * Convert G+DOS track byte to image offset.
         * Directory entries (firstTrack), sector maps, and chain pointers
         * encode the track as: cylinder (bits 0-6), side (bit 7).
         *   track 0-79 = cylinder 0-79 side 0
         *   track 128-207 = cylinder 0-79 side 1
         * Sectors are 1-10 (1-based).
         * Image layout: cyl0/s0, cyl0/s1, cyl1/s0, cyl1/s1, ...
         */
        static logicalTrackOffset(track, sector) {
            const cyl = track & 0x7F;
            const side = (track >> 7) & 1;
            return ((cyl * 2 + side) * 10 + (sector - 1)) * 512;
        }

        /**
         * List files in MGT image
         * Returns array of {name, type, typeName, length, startAddress, sectors,
         *                    firstTrack, firstSector, sectorMap, autostart, bodyLength,
         *                    tapeType, slotIndex}
         */
        static listFiles(data) {
            const bytes = new Uint8Array(data);
            const files = [];
            const typeNames = {
                0: 'Erased', 1: 'BASIC', 2: 'Num array', 3: 'Str array',
                4: 'Code', 5: '48K Snap', 6: 'Microdrive', 7: 'SCREEN$',
                8: 'Special', 9: '128K Snap', 10: 'Opentype', 11: 'Execute',
                // SAMDOS (SAM Coupé) types — compatible MGT disk format
                16: 'BASIC', 17: 'Num array', 18: 'Str array',
                19: 'Code', 20: 'SCREEN$'
            };

            for (let i = 0; i < 80; i++) {
                const offset = MGTLoader._slotOffset(i);
                if (offset + 256 > bytes.length) break;

                const fileType = bytes[offset];
                if (fileType === 0) continue;  // Empty/erased slot
                // Valid types: 1-11 (G+DOS), 16-20 (SAMDOS/SAM Coupé)
                // Mixed disks exist (SAMDOS loader + G+DOS data files)
                if (fileType > 20 || (fileType > 11 && fileType < 16)) continue;

                // First sector location — validate before accepting
                const firstTrack = bytes[offset + 13];
                const firstSector = bytes[offset + 14];
                if (firstSector < 1 || firstSector > 10) continue;  // Invalid sector (1-10 only)
                const firstCyl = firstTrack & 0x7F;
                if (firstCyl >= 80) continue;                        // Invalid cylinder (0-79 only)
                // Directory occupies cylinders 0-1 (both sides); data never starts there
                if (firstCyl < 2) continue;

                // Sector count (big-endian at offsets 11-12)
                const sectors = (bytes[offset + 11] << 8) | bytes[offset + 12];
                if (sectors === 0) continue;  // Empty entry

                // Read filename (10 bytes, space-padded)
                let name = '';
                for (let j = 1; j <= 10; j++) {
                    const ch = bytes[offset + j];
                    if (ch >= 0x20 && ch < 0x80) {
                        name += String.fromCharCode(ch);
                    }
                }
                name = name.trimEnd();

                // Sector address map (bitmap): bytes 15-209 (1560-bit bitmap)
                const sectorMap = [];
                for (let j = 0; j < sectors && j < 97; j++) {
                    const mapOffset = offset + 15 + j * 2;
                    if (mapOffset + 1 < offset + 210) {
                        sectorMap.push({
                            track: bytes[mapOffset],
                            sector: bytes[mapOffset + 1]
                        });
                    }
                }

                let tapeType, length, param1, param2, param3;
                // Per-file SAMDOS detection: types 16-20 use SAMDOS metadata layout
                const isSAMDOS = fileType >= 16;

                if (isSAMDOS) {
                    // SAMDOS metadata at bytes 236-244 of directory entry
                    // Length: pages * 16384 + modulo (supports files > 64KB)
                    const pages = bytes[offset + 239];
                    const modLen = bytes[offset + 240] | (bytes[offset + 241] << 8);
                    length = pages * 16384 + modLen;

                    // Start address: page (byte 236 bits 0-4) + offset (bytes 237-238 LE)
                    // Page offset uses REL PAGE FORM encoding (section bits + offset)
                    const startPage = bytes[offset + 236] & 0x1F;
                    const pageOffset = bytes[offset + 237] | (bytes[offset + 238] << 8);
                    param1 = pageOffset; // Full REL PAGE FORM address for display

                    // Execution address / autostart (bytes 242-244)
                    const execPage = bytes[offset + 242];
                    const execOffset = bytes[offset + 243] | (bytes[offset + 244] << 8);
                    param3 = (execPage === 0xFF) ? 0xFFFF : execOffset;

                    // SAMDOS type → equivalent tape type for compatibility
                    tapeType = fileType - 16; // 16→0 BASIC, 17→1 NumArr, 18→2 StrArr, 19→3 Code
                    param2 = 0;

                    // For BASIC: program body length from FileTypeInfo (bytes 221-223)
                    if (fileType === 16) {
                        // 3-byte page-form triplet: byte 221 = pages, bytes 222-223 = offset
                        const bPages = bytes[offset + 221];
                        const bOff = bytes[offset + 222] | (bytes[offset + 223] << 8);
                        param2 = bPages * 16384 + (bOff & 0x3FFF);
                    }
                } else {
                    // G+DOS metadata at bytes 210-219
                    tapeType = bytes[offset + 211];
                    length = bytes[offset + 212] | (bytes[offset + 213] << 8);
                    param1 = bytes[offset + 214] | (bytes[offset + 215] << 8);
                    param2 = bytes[offset + 216] | (bytes[offset + 217] << 8);
                    param3 = bytes[offset + 218] | (bytes[offset + 219] << 8);
                }

                const typeName = typeNames[fileType] || `Type ${fileType}`;

                files.push({
                    name,
                    type: fileType,
                    typeName,
                    tapeType,
                    length,
                    startAddress: param1,
                    bodyLength: param2,
                    sectors,
                    firstTrack,
                    firstSector,
                    sectorMap,
                    autostart: (fileType === 1 || fileType === 16) ? param3 : null,
                    isSAMDOS,
                    slotIndex: i
                });
            }

            return files;
        }

        /**
         * Extract file data from MGT image by following sector chain.
         * Each sector stores 510 bytes of file data + 2-byte chain pointer
         * (track, sector of next sector) in the last 2 bytes.
         * Track numbers use G+DOS encoding: cylinder in bits 0-6, side in bit 7
         * (0-79 = side 0, 128-207 = side 1), matching directory and chain pointer format.
         * SPECIAL (type 8) files use contiguous 512-byte sectors without chain.
         * Non-SPECIAL files saved by G+DOS have a 9-byte file header prepended
         * (type + length + params, mirroring the Spectrum tape header);
         * some third-party utilities omit this header. The header is auto-detected
         * by checking if byte 0 matches the expected tape type and bytes 1-2
         * match the directory length — if valid, it is stripped.
         */
        static extractFile(data, fileInfo) {
            const bytes = new Uint8Array(data);
            const sectorSize = 512;
            const isContig = fileInfo.type === 8; // SPECIAL uses full 512-byte sectors
            const dataPerSector = isContig ? 512 : 510;
            const result = new Uint8Array(fileInfo.sectors * dataPerSector);
            let destPos = 0;

            let curTrack = fileInfo.firstTrack;
            let curSector = fileInfo.firstSector;

            for (let i = 0; i < fileInfo.sectors; i++) {
                // firstTrack and chain pointers use G+DOS track encoding (cyl | side<<7)
                const offset = MGTLoader.logicalTrackOffset(curTrack, curSector);

                if (offset >= 0 && offset + sectorSize <= bytes.length) {
                    result.set(bytes.slice(offset, offset + dataPerSector), destPos);

                    if (!isContig) {
                        // Last 2 bytes of sector = chain pointer (track, sector)
                        curTrack = bytes[offset + 510];
                        curSector = bytes[offset + 511];
                    }
                }
                destPos += dataPerSector;

                if (isContig) {
                    // Advance sequentially: sectors 1-10 side 0, then side 1, then next cylinder
                    curSector++;
                    if (curSector > 10) {
                        curSector = 1;
                        if ((curTrack & 0x80) === 0) {
                            curTrack |= 0x80; // switch to side 1 of same cylinder
                        } else {
                            curTrack = (curTrack & 0x7F) + 1; // next cylinder, side 0
                        }
                    }
                }
            }

            if (isContig) {
                return result.slice(0, fileInfo.length);
            }

            // SAMDOS files: 9-byte header with SAM-specific format
            // Byte 0: SAMDOS type (16-20), bytes 1-2: modulo length, byte 7: pages
            if (fileInfo.isSAMDOS) {
                if (result.length >= 9) {
                    const hdrType = result[0];
                    const hdrModLen = result[1] | (result[2] << 8);
                    const hdrPages = result[7];
                    const hdrLen = hdrPages * 16384 + hdrModLen;
                    if (hdrType === fileInfo.type && hdrLen === fileInfo.length) {
                        return result.slice(9, 9 + fileInfo.length);
                    }
                }
                return result.slice(0, fileInfo.length);
            }

            // Detect 9-byte file header: GDOS type → Spectrum tape type mapping
            // GDOS: 1=BASIC→0, 2=NumArr→1, 3=ChrArr→2, 4=Code→3, 7=SCREEN$→3
            const gdosToTape = { 1: 0, 2: 1, 3: 2, 4: 3, 7: 3 };
            const expectedTape = gdosToTape[fileInfo.type];
            if (expectedTape !== undefined && result.length >= 9) {
                const hdrType = result[0];
                const hdrLen = result[1] | (result[2] << 8);
                if (hdrType === expectedTape && hdrLen === fileInfo.length) {
                    return result.slice(9, 9 + fileInfo.length);
                }
            }
            // No valid header — return raw data trimmed to directory length
            return result.slice(0, fileInfo.length);
        }

        /**
         * Build an MGT (+D/DISCiPLE G+DOS) disk image from a list of files.
         * Uses the G+DOS chain format that extractFile expects (and real +D uses):
         * each 512-byte sector holds 510 data bytes + a 2-byte chain pointer
         * (next track | side<<7, next sector; 0,0 = end of chain).
         *
         * files: [{ name, mgtType (1-11/16-20) | type, tapeType, length,
         *           data (Uint8Array, first `length` bytes used), startAddress,
         *           bodyLength, autostart, deleted }]
         *
         * Directory occupies cylinders 0-1 (4 logical tracks, 80 slots); data
         * starts at cylinder 2 (matching the reader's `firstCyl >= 2` check).
         * The sector-allocation map (bytes 15-209) is written as a best-effort
         * 1560-bit bitmap over the data area — note: the reader follows the chain
         * and ignores this map, and the exact real-+D bit ordering is not
         * spec-verified, so it is informational for external tools only.
         */
        static buildMGT(files, diskLabel = '') {
            const img = new Uint8Array(819200); // 80 cyl x 2 sides x 10 sec x 512 (DS)
            let curCyl = 4, curSide = 0, curSec = 1; // data starts at cyl 4 (cyl 0-3 reserved), per real +D
            const advance = () => {
                // +D allocation order: fill side 0 of every cylinder (track byte 4,5,…,79) first,
                // then side 1 — matching real +D images (see tests/pristine/ref-mgt-80ds.mgt).
                if (++curSec > 10) { curSec = 1; if (++curCyl > 79) { curCyl = 4; curSide++; } }
            };

            let slot = 0;
            for (const f of (files || [])) {
                if (!f || f.deleted) continue;
                if (slot >= 80) break;
                const length = (f.length != null) ? f.length : (f.data ? f.data.length : 0);
                const raw = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data || 0);
                const mgtType = f.mgtType || f.type || 4;

                // File-type metadata, mirrored both in the directory (bytes 211-219) and in the
                // 9-byte header that prefixes the file DATA on real +D disks.
                const GDOS_TO_TAPE = { 1: 0, 2: 1, 3: 2, 4: 3, 7: 3 };
                const hdrTape = GDOS_TO_TAPE[mgtType];
                const tapeType = (f.tapeType != null) ? f.tapeType : (hdrTape != null ? hdrTape : 3);
                const startAddr = f.startAddress || 0;
                const isBASIC = mgtType === 1 || mgtType === 16;
                const param2 = isBASIC ? (f.bodyLength || length) : 0x8000;
                const autostart = isBASIC
                    ? ((f.autostart != null && f.autostart >= 0 && f.autostart < 0x8000) ? f.autostart : 0x8000)
                    : 0;

                // Real +D/G+DOS stores a 9-byte file header at the START of the data for standard
                // BASIC/array/CODE/SCREEN$ files (extractFile strips it on read). Re-add it here so
                // the saved image is readable by real +D and other tools. Other types (snapshots,
                // Opentype, …) carry no data header, so their content is written as-is.
                let payload = raw.subarray(0, length);
                if (hdrTape != null) {
                    const withHdr = new Uint8Array(9 + length);
                    withHdr[0] = hdrTape;
                    withHdr[1] = length & 0xFF; withHdr[2] = (length >> 8) & 0xFF;
                    withHdr[3] = startAddr & 0xFF; withHdr[4] = (startAddr >> 8) & 0xFF;
                    withHdr[5] = param2 & 0xFF; withHdr[6] = (param2 >> 8) & 0xFF;
                    withHdr[7] = autostart & 0xFF; withHdr[8] = (autostart >> 8) & 0xFF;
                    withHdr.set(raw.subarray(0, length), 9);
                    payload = withHdr;
                }
                const sectors = Math.max(1, Math.ceil(payload.length / 510));

                const firstCyl = curCyl, firstSide = curSide, firstSec = curSec;
                const used = [];
                let dataPos = 0;
                for (let s = 0; s < sectors; s++) {
                    const off = ((curCyl * 2 + curSide) * 10 + (curSec - 1)) * 512;
                    used.push({ cyl: curCyl, side: curSide, sector: curSec });
                    img.set(payload.subarray(dataPos, dataPos + 510), off);
                    dataPos += 510;
                    advance();
                    if (s < sectors - 1) {
                        img[off + 510] = (curCyl & 0x7F) | (curSide << 7); // next track (G+DOS encoding)
                        img[off + 511] = curSec;                           // next sector
                    } else {
                        img[off + 510] = 0; img[off + 511] = 0;            // end of chain
                    }
                }

                const dirOff = MGTLoader._slotOffset(slot);
                img[dirOff] = mgtType;
                const name = (f.name || '').toString();
                for (let c = 0; c < 10; c++) img[dirOff + 1 + c] = c < name.length ? (name.charCodeAt(c) & 0xFF) : 0x20;
                img[dirOff + 11] = (sectors >> 8) & 0xFF;   // sector count, big-endian
                img[dirOff + 12] = sectors & 0xFF;
                img[dirOff + 13] = (firstCyl & 0x7F) | (firstSide << 7);
                img[dirOff + 14] = firstSec;
                // best-effort allocation bitmap (informational; reader ignores it)
                for (const u of used) {
                    // Bitmap is indexed in allocation order: side-0 tracks (cyl 4-79) first, then
                    // side-1. bit0 = cyl4 side0 sec1. (76 = data cylinders per side, cyl 4-79.)
                    const ti = (u.side === 0) ? (u.cyl - 4) : (76 + (u.cyl - 4));
                    const bit = ti * 10 + (u.sector - 1);
                    if (bit >= 0 && bit < 1560) img[dirOff + 15 + (bit >> 3)] |= (1 << (bit & 7));
                }
                // G+DOS metadata copy (bytes 211-219)
                img[dirOff + 211] = tapeType;
                img[dirOff + 212] = length & 0xFF;
                img[dirOff + 213] = (length >> 8) & 0xFF;
                img[dirOff + 214] = startAddr & 0xFF;
                img[dirOff + 215] = (startAddr >> 8) & 0xFF;
                img[dirOff + 216] = param2 & 0xFF;
                img[dirOff + 217] = (param2 >> 8) & 0xFF;
                img[dirOff + 218] = autostart & 0xFF;
                img[dirOff + 219] = (autostart >> 8) & 0xFF;
                slot++;
            }
            return img;
        }

        /**
         * Convert MGT file to TAP format for loading
         */
        static fileToTAP(fileData, fileInfo) {
            // Reuse TRDLoader's TAP builder with mapped type info
            const mappedInfo = {
                name: fileInfo.name.substring(0, 10),
                type: fileInfo.type === 1 || fileInfo.type === 16 ? 'basic' :
                      fileInfo.type === 4 || fileInfo.type === 19 ? 'code' :
                      fileInfo.type === 7 || fileInfo.type === 20 ? 'code' :
                      fileInfo.type === 2 || fileInfo.type === 17 ? 'data' :
                      fileInfo.type === 3 || fileInfo.type === 18 ? 'data' : 'code',
                start: fileInfo.startAddress,
                length: fileInfo.length,
                fullName: fileInfo.name
            };
            return TRDLoader.fileToTAP(fileData, mappedInfo);
        }

        /**
         * Get disk statistics (total/used/free sectors)
         */
        static getDiskInfo(data) {
            const bytes = new Uint8Array(data);
            const totalSectors = (bytes.length / 512);
            // Directory occupies tracks 0-1 (both sides) = 4 track-sides × 10 sectors = 40 sectors
            const dirSectors = 40;
            let usedSectors = dirSectors;

            const files = MGTLoader.listFiles(data);
            for (const f of files) {
                usedSectors += f.sectors;
            }

            return {
                totalSectors,
                usedSectors,
                freeSectors: totalSectors - usedSectors,
                fileCount: files.length,
                maxFiles: 80,
                tracks: bytes.length === 819200 ? 80 : 40,
                sides: 2,
                sectorsPerTrack: 10,
                bytesPerSector: 512,
                totalSize: bytes.length
            };
        }
    }

    /**
     * +D WD1772 Floppy Disk Controller
     * DISCiPLE/+D interface: 2 drives, 80 tracks × 2 sides × 10 sectors × 512 bytes
     * Port addresses: 0xE3 (cmd/status), 0xEB (track), 0xF3 (sector),
     *                 0xFB (data), 0xEF (control), 0xE7 (paging)
     */
    export class PlusDDisk {
        static get VERSION() { return VERSION; }

        constructor() {
            // Per-drive state: each drive has its own disk image and head position
            this.drives = [
                { diskData: null, diskType: null, headTrack: 0 },
                { diskData: null, diskType: null, headTrack: 0 }
            ];

            // WD1772 registers
            this.command = 0;
            this.status = 0;
            this.track = 0;
            this.sector = 1;       // Sectors are 1-based in MGT
            this.data = 0;

            // Disk activity callback: function(type, track, sector, side, drive)
            this.onDiskActivity = null;

            // Page-out callback: called when control register bit 6 set
            this.onPageOut = null;

            // Control register state
            this.drive = 0;        // Current drive (0-1)
            this.side = 0;         // Current side (0-1)

            // Disk geometry (standard MGT)
            this.sectorsPerTrack = 10;
            this.bytesPerSector = 512;
            this.tracks = 80;
            this.sides = 2;

            // Data transfer state
            this.dataBuffer = null;
            this.dataPos = 0;
            this.dataLen = 0;
            this.reading = false;
            this.writing = false;

            // Index pulse simulation
            this.indexCounter = 0;

            // Track last command type for status bit interpretation
            // WD1772: after power-on/reset, status register uses Type I format
            this.lastCmdType = 1;

            // Status bits (same as WD1793)
            this.BUSY = 0x01;
            this.INDEX = 0x02;
            this.DRQ = 0x02;
            this.TRACK0 = 0x04;
            this.LOST_DATA = 0x04;
            this.CRC_ERROR = 0x08;
            this.SEEK_ERROR = 0x10;
            this.RNF = 0x10;
            this.HEAD_LOADED = 0x20;
            this.RECORD_TYPE = 0x20;
            this.WRITE_PROTECT = 0x40;
            this.NOT_READY = 0x80;

            this.intrq = false;
            this.multiSector = false;
            this._sysReadsSinceData = 0;
        }

        // Load disk image into specified drive
        loadDisk(data, type, driveIndex = 0) {
            const drv = this.drives[driveIndex & 0x01];
            drv.diskData = new Uint8Array(data);
            drv.diskType = type || 'mgt';
            drv.headTrack = 0;
            if ((driveIndex & 0x01) === this.drive) {
                this.status = 0;
                this.track = 0;
                this.sector = 1;
            }
        }

        get currentDisk() {
            return this.drives[this.drive];
        }

        // Create and insert a blank MGT disk
        createBlankDisk(label = 'BLANK', driveIndex = 0) {
            const mgt = new Uint8Array(819200);
            mgt.fill(0);
            // Directory is all zeros = all empty slots (file type 0 = unused)
            // No disk info sector like TRD — directory structure IS the format

            const drv = this.drives[driveIndex & 0x01];
            drv.diskData = mgt;
            drv.diskType = 'mgt';
            drv.headTrack = 0;
            if ((driveIndex & 0x01) === this.drive) {
                this.status = 0;
                this.track = 0;
                this.sector = 1;
            }
            return true;
        }

        ejectDisk(driveIndex) {
            if (driveIndex !== undefined) {
                const drv = this.drives[driveIndex & 0x01];
                drv.diskData = null;
                drv.diskType = null;
                drv.headTrack = 0;
            } else {
                const drv = this.currentDisk;
                drv.diskData = null;
                drv.diskType = null;
                drv.headTrack = 0;
            }
            this.status = this.NOT_READY;
        }

        hasDisk(driveIndex) {
            if (driveIndex !== undefined) {
                return this.drives[driveIndex & 0x01].diskData !== null;
            }
            return this.currentDisk.diskData !== null;
        }

        hasAnyDisk() {
            return this.drives.some(d => d.diskData !== null);
        }

        // Calculate sector offset in disk image from physical cylinder, side, sector.
        // Used by WD1772 emulation (port read/write commands) where track = cylinder
        // and side comes from the control register.
        // MGT image layout: cyl0/s0, cyl0/s1, cyl1/s0, cyl1/s1, ...
        getSectorOffset(track, side, sector) {
            return ((track * 2 + side) * this.sectorsPerTrack + (sector - 1)) * this.bytesPerSector;
        }

        // Port read (port mapping per FUSE plusd.c)
        read(port) {
            const reg = port & 0xFF;

            switch (reg) {
                case 0xE3: // Status register (WD1772 command/status)
                    if (!this.currentDisk.diskData) {
                        return this.NOT_READY;
                    }
                    {
                        let st = this.status;
                        if (this.reading && this.dataPos < this.dataLen) {
                            st |= this.DRQ;
                        }
                        if (this.lastCmdType === 1 && this.track === 0) {
                            st |= this.TRACK0;
                        }
                        if (this.lastCmdType === 1) {
                            this.indexCounter = (this.indexCounter + 1) % 16;
                            if (this.indexCounter === 0) {
                                st |= this.INDEX;
                            }
                        }
                        return st;
                    }

                case 0xEB: // Track register
                    return this.track;

                case 0xF3: // Sector register
                    return this.sector;

                case 0xFB: // Data register
                    if (this.reading && this.dataBuffer && this.dataPos < this.dataLen) {
                        this._sysReadsSinceData = 0;
                        this.data = this.dataBuffer[this.dataPos++];
                        if (this.dataPos >= this.dataLen) {
                            if (this.multiSector) {
                                this.sector++;
                                if (this.sector > this.sectorsPerTrack) {
                                    this.reading = false;
                                    this.multiSector = false;
                                    this.status &= ~(this.BUSY | this.DRQ);
                                    this.intrq = true;
                                } else {
                                    this.readSector();
                                }
                            } else {
                                this.reading = false;
                                this.status &= ~(this.BUSY | this.DRQ);
                                this.intrq = true;
                            }
                        }
                    }
                    return this.data;

                case 0xEF: // Control register read: INTRQ/DRQ status
                    {
                        let ctrl = 0;
                        if (this.intrq) ctrl |= 0x80;
                        if (this.reading || this.writing) ctrl |= 0x40;
                        // Lost data simulation (same as BetaDisk system register)
                        if (this.reading && this.dataBuffer && this.dataPos < this.dataLen) {
                            this._sysReadsSinceData = (this._sysReadsSinceData || 0) + 1;
                            if (this._sysReadsSinceData >= 2) {
                                this.dataPos = this.dataLen;
                                this.status |= this.LOST_DATA;
                                if (this.multiSector) {
                                    this.sector++;
                                    if (this.sector > this.sectorsPerTrack) {
                                        this.reading = false;
                                        this.multiSector = false;
                                        this.status &= ~(this.BUSY | this.DRQ);
                                        this.intrq = true;
                                    } else {
                                        this.readSector();
                                    }
                                } else {
                                    this.reading = false;
                                    this.status &= ~(this.BUSY | this.DRQ);
                                    this.intrq = true;
                                }
                            }
                        }
                        return ctrl;
                    }

                default:
                    return 0xFF;
            }
        }

        // Port write (port mapping per FUSE plusd.c)
        write(port, value) {
            const reg = port & 0xFF;

            switch (reg) {
                case 0xE3: // Command register
                    this.executeCommand(value);
                    break;

                case 0xEB: // Track register
                    this.track = value;
                    break;

                case 0xF3: // Sector register
                    this.sector = value;
                    break;

                case 0xFB: // Data register
                    this.data = value;
                    if (this.writing && this.dataBuffer && this.dataPos < this.dataLen) {
                        this.dataBuffer[this.dataPos++] = value;
                        if (this.dataPos >= this.dataLen) {
                            this.flushWriteBuffer();
                            if (this.multiSector) {
                                this.sector++;
                                if (this.sector > this.sectorsPerTrack) {
                                    this.writing = false;
                                    this.multiSector = false;
                                    this.status &= ~this.BUSY;
                                    this.intrq = true;
                                } else {
                                    this.writeSector();
                                }
                            } else {
                                this.writing = false;
                                this.status &= ~this.BUSY;
                                this.intrq = true;
                            }
                        }
                    }
                    break;

                case 0xEF: // Control register (per FUSE: bits 0-1=drive, bit 7=side, bit 6=printer)
                    this.drive = (value & 0x03) === 2 ? 1 : 0;  // Drive select (FUSE convention)
                    this.side = (value & 0x80) ? 1 : 0;  // Bit 7: side select
                    break;
            }
        }

        reset() {
            this.command = 0;
            this.status = 0;
            this.track = 0;
            this.sector = 1;
            this.reading = false;
            this.writing = false;
            this.dataBuffer = null;
            this.intrq = false;
            this._sysReadsSinceData = 0;
        }

        executeCommand(cmd) {
            this.command = cmd;
            this.status = 0;
            this.intrq = false;
            this._sysReadsSinceData = 0;

            if (!this.currentDisk.diskData) {
                this.status = this.NOT_READY;
                this.intrq = true;
                return;
            }

            // Type I commands (restore, seek, step)
            if ((cmd & 0x80) === 0) {
                this.lastCmdType = 1;
                this.status |= this.BUSY;

                if ((cmd & 0xF0) === 0x00) {
                    // Restore
                    this.track = 0;
                    this.currentDisk.headTrack = 0;
                    this.status |= this.TRACK0;
                } else if ((cmd & 0xF0) === 0x10) {
                    // Seek
                    this.track = this.data;
                    this.currentDisk.headTrack = this.data;
                    if (this.track === 0) this.status |= this.TRACK0;
                } else if ((cmd & 0xE0) === 0x40) {
                    // Step in — logical tracks 0-159 (80 cylinders × 2 sides)
                    if (this.track < 159) this.track++;
                    this.currentDisk.headTrack = this.track;
                } else if ((cmd & 0xE0) === 0x60) {
                    // Step out
                    if (this.track > 0) this.track--;
                    this.currentDisk.headTrack = this.track;
                    if (this.track === 0) this.status |= this.TRACK0;
                }

                this.status &= ~this.BUSY;
                this.status |= this.HEAD_LOADED;
                this.intrq = true;
                return;
            }

            // Type II commands (read/write sector)
            if ((cmd & 0xC0) === 0x80) {
                this.lastCmdType = 2;
                this.multiSector = !!(cmd & 0x10);
                this.status = this.BUSY;

                if ((cmd & 0x20) === 0) {
                    this.readSector();
                } else {
                    this.writeSector();
                }
                return;
            }

            // Type IV command (force interrupt)
            // WD1772: "rest of Status Register is updated according to Type I commands"
            if ((cmd & 0xF0) === 0xD0) {
                this.lastCmdType = 1;  // Status uses Type I format after Force Interrupt
                this.reading = false;
                this.writing = false;
                this.multiSector = false;
                this.status &= ~this.BUSY;
                this.status |= this.HEAD_LOADED;
                if (this.track === 0) this.status |= this.TRACK0;
                if (cmd & 0x08) this.intrq = true;
                return;
            }

            // Type III commands (read/write track, read address)
            if ((cmd & 0xC0) === 0xC0) {
                this.lastCmdType = 2;
                if ((cmd & 0xF0) === 0xC0) {
                    // Read address
                    this.dataBuffer = new Uint8Array([
                        this.currentDisk.headTrack, this.side, this.sector, 2, 0, 0
                    ]);  // size=2 for 512-byte sectors
                    this.dataPos = 0;
                    this.dataLen = 6;
                    this.reading = true;
                    this.status |= this.BUSY | this.DRQ;
                } else if ((cmd & 0xF0) === 0xE0) {
                    // Read Track — not implemented
                    this.status = 0;
                    this.intrq = true;
                } else if ((cmd & 0xF0) === 0xF0) {
                    // Write Track — not implemented
                    this.status = 0;
                    this.intrq = true;
                }
                return;
            }
        }

        readSector() {
            const drv = this.currentDisk;
            const offset = this.getSectorOffset(this.track, this.side, this.sector);

            if (this.onDiskActivity) {
                this.onDiskActivity('read', this.track, this.sector, this.side, this.drive);
            }

            if (offset + this.bytesPerSector > drv.diskData.length) {
                this.status |= this.RNF;
                this.status &= ~this.BUSY;
                this.intrq = true;
                return;
            }

            this.dataBuffer = drv.diskData.slice(offset, offset + this.bytesPerSector);
            this.dataPos = 0;
            this.dataLen = this.bytesPerSector;
            this.reading = true;
            this.status |= this.DRQ | this.BUSY;

            // DEBUG: dump first 16 bytes of sector
            const preview = Array.from(this.dataBuffer.subarray(0, 16))
                .map(b => b.toString(16).padStart(2, '0')).join(' ');
            const ascii = Array.from(this.dataBuffer.subarray(0, 16))
                .map(b => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.').join('');
            console.log(`+D RdSec T${this.track}:S${this.sector} @${offset}: ${preview} |${ascii}|`);
        }

        writeSector() {
            const drv = this.currentDisk;
            const offset = this.getSectorOffset(this.track, this.side, this.sector);

            if (this.onDiskActivity) {
                this.onDiskActivity('write', this.track, this.sector, this.side, this.drive);
            }

            if (offset + this.bytesPerSector > drv.diskData.length) {
                this.status |= this.RNF;
                this.status &= ~this.BUSY;
                this.intrq = true;
                return;
            }

            this.writeOffset = offset;
            this.dataBuffer = new Uint8Array(this.bytesPerSector);
            this.dataPos = 0;
            this.dataLen = this.bytesPerSector;
            this.writing = true;
            this.status |= this.DRQ;
        }

        flushWriteBuffer() {
            if (this.writeOffset !== undefined && this.dataBuffer) {
                this.currentDisk.diskData.set(this.dataBuffer, this.writeOffset);
            }
        }

        getIntrq() {
            return this.intrq;
        }
    }

    /**
     * MDR Loader - Interface 1 Microdrive cartridge format
     * 254 sectors × 543 bytes + 1 write-protect flag = 137923 bytes
     */
    export class MDRLoader {
        static get VERSION() { return VERSION; }

        static get SECTOR_COUNT() { return 254; }
        static get SECTOR_SIZE() { return 543; }
        static get HEADER_SIZE() { return 15; }
        static get RECORD_SIZE() { return 528; }
        static get DATA_SIZE() { return 512; }
        static get IMAGE_SIZE() { return 254 * 543 + 1; }  // 137923
        static get IMAGE_SIZE_NO_WP() { return 254 * 543; } // 137922

        /**
         * Get number of sectors from data length.
         * Supports oversized MDR images (multi-cartridge compilations).
         * Standard cartridge: 254 sectors. Oversized: floor(length / 543).
         */
        static getSectorCount(data) {
            const len = data.length || data.byteLength || 0;
            return Math.floor(len / MDRLoader.SECTOR_SIZE);
        }

        /**
         * Check if data is an MDR file
         * Standard: 137923 bytes (254×543 + 1 write-protect flag)
         * Some images omit the write-protect byte: 137922 bytes
         */
        static isMDR(data) {
            const bytes = new Uint8Array(data);
            if (bytes.length !== MDRLoader.IMAGE_SIZE && bytes.length !== MDRLoader.IMAGE_SIZE_NO_WP) return false;

            // Validate: check a few sector headers have reasonable values
            let validCount = 0;
            let freeCount = 0;
            for (let i = 0; i < 10 && i < MDRLoader.SECTOR_COUNT; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                const hdflag = bytes[off];
                const hdnumb = bytes[off + 1];
                if (hdflag === 0 && bytes[off + 15] === 0) {
                    freeCount++;  // Free sector
                } else if ((hdflag & 0x01) === 1 && hdnumb >= 1 && hdnumb <= 254) {
                    validCount++;  // Valid header block
                }
            }
            return validCount > 0 || freeCount >= 3;
        }

        /**
         * Compute the Interface 1 sector checksum: the sum of the bytes modulo 255
         * (per the IF1 ROM — this can never produce 255). Used when writing/building
         * MDR images so the checksums match what real hardware / FUSE expect.
         */
        static mdrChecksum(data, start, len) {
            let sum = 0;
            for (let i = 0; i < len; i++) {
                sum += data[start + i];
            }
            return sum % 255;
        }

        /**
         * List files in MDR image
         * Groups sectors by RECNAM, sorts by RECNUM, calculates file sizes
         * Returns array of {name, length, sectors, sectorIndices, isPrint, type}
         */
        static listFiles(data) {
            const bytes = new Uint8Array(data);
            const sectorCount = MDRLoader.getSectorCount(bytes);
            // Collect all sectors grouped by filename
            // Each sector is tagged as active (RECFLG != 0) or stale (RECFLG == 0)
            const fileMap = new Map();  // name → [{recnum, reclen, recflg, sectorIdx}]

            for (let i = 0; i < sectorCount; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                const hdflag = bytes[off];

                // Skip sectors without a valid header
                if ((hdflag & 0x01) !== 1) continue;

                // Validate RECNAM — all 10 bytes must be printable ASCII or trailing spaces
                // Reject garbage sectors (e.g. format/init records with machine code in name field)
                let recnam = '';
                let validName = true;
                for (let j = 0; j < 10; j++) {
                    const ch = bytes[off + 19 + j];
                    if (ch >= 0x20 && ch < 0x80) {
                        recnam += String.fromCharCode(ch);
                    } else {
                        validName = false;
                        break;
                    }
                }
                if (!validName) continue;
                recnam = recnam.trimEnd();
                if (!recnam) continue;

                const recflg = bytes[off + 15];
                const recnum = bytes[off + 16];
                const reclen = bytes[off + 17] | (bytes[off + 18] << 8);

                if (!fileMap.has(recnam)) {
                    fileMap.set(recnam, []);
                }
                fileMap.get(recnam).push({
                    recnum,
                    reclen,
                    recflg,
                    sectorIdx: i
                });
            }

            // Build file list
            const files = [];
            for (const [name, sectors] of fileMap) {
                // Separate active sectors (RECFLG != 0) from stale/erased ones (RECFLG == 0)
                const activeSectors = sectors.filter(s => s.recflg !== 0);
                const deleted = activeSectors.length === 0;

                // Use active sectors for live files, all sectors for deleted files
                const fileSectors = deleted ? sectors : activeSectors;

                // Sort by record number; for duplicate recnums, prefer sectors with
                // RECFLG bit 2 set (standard SAVE records) over padding/PRINT sectors
                fileSectors.sort((a, b) => a.recnum - b.recnum || ((b.recflg & 0x04) - (a.recflg & 0x04)));

                // Calculate total data length
                let totalLen = 0;
                for (let j = 0; j < fileSectors.length; j++) {
                    const sec = fileSectors[j];
                    if (sec.recflg & 0x02) {
                        // EOF sector — use actual reclen
                        totalLen += sec.reclen;
                    } else {
                        totalLen += MDRLoader.DATA_SIZE;
                    }
                }

                // Check if ANY active sector has bit 2 set (non-PRINT/SAVE type)
                // Some MDR creation tools don't set bit 2 on all sectors
                const isPrint = !fileSectors.some(s => (s.recflg & 0x04) !== 0);

                files.push({
                    name,
                    length: totalLen,
                    sectors: fileSectors.length,
                    sectorIndices: fileSectors.map(s => s.sectorIdx),
                    isPrint,
                    type: isPrint ? 'Data' : 'File',
                    deleted
                });
            }

            // Active files first, deleted files at the end
            files.sort((a, b) => (a.deleted ? 1 : 0) - (b.deleted ? 1 : 0));

            return files;
        }

        /**
         * Extract file data from MDR image
         * Follows sector sequence, concatenates data, trims last sector to RECLEN
         */
        static extractFile(data, fileInfo) {
            const bytes = new Uint8Array(data);
            const result = new Uint8Array(fileInfo.length);
            let destPos = 0;

            for (const sectorIdx of fileInfo.sectorIndices) {
                const off = sectorIdx * MDRLoader.SECTOR_SIZE;
                const recflg = bytes[off + 15];
                const reclen = bytes[off + 17] | (bytes[off + 18] << 8);
                const dataStart = off + 30;  // Data starts at byte 30

                const copyLen = (recflg & 0x02) ? reclen : MDRLoader.DATA_SIZE;
                const actualCopy = Math.min(copyLen, result.length - destPos);
                if (actualCopy > 0) {
                    result.set(bytes.slice(dataStart, dataStart + actualCopy), destPos);
                    destPos += actualCopy;
                }
            }

            return result.slice(0, destPos);
        }

        /**
         * Get cartridge info: name, used/free sectors, file count
         */
        static getDiskInfo(data) {
            const bytes = new Uint8Array(data);
            const sectorCount = MDRLoader.getSectorCount(bytes);
            let cartridgeName = '';
            let usedSectors = 0;
            let freeSectors = 0;

            // Get cartridge name from first valid sector header
            for (let i = 0; i < sectorCount; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                const hdflag = bytes[off];
                if ((hdflag & 0x01) === 1) {
                    // Read HDNAME (10 bytes at offset 4)
                    for (let j = 0; j < 10; j++) {
                        const ch = bytes[off + 4 + j];
                        if (ch >= 0x20 && ch < 0x80) {
                            cartridgeName += String.fromCharCode(ch);
                        }
                    }
                    cartridgeName = cartridgeName.trimEnd();
                    break;
                }
            }

            const files = MDRLoader.listFiles(data);

            // Count used sectors from active (non-deleted) files only
            let deletedCount = 0;
            for (const f of files) {
                if (f.deleted) {
                    deletedCount++;
                } else {
                    usedSectors += f.sectors;
                }
            }
            freeSectors = sectorCount - usedSectors;
            const writeProtect = bytes.length >= MDRLoader.IMAGE_SIZE ? bytes[MDRLoader.IMAGE_SIZE - 1] : 0;

            return {
                cartridgeName,
                totalSectors: sectorCount,
                usedSectors,
                freeSectors,
                fileCount: files.length - deletedCount,
                deletedCount,
                writeProtect: writeProtect !== 0,
                totalSize: bytes.length
            };
        }

        /**
         * Convert MDR file to TAP format (reuses TRDLoader.fileToTAP)
         */
        static fileToTAP(fileData, fileInfo) {
            const mappedInfo = {
                name: fileInfo.name.substring(0, 10),
                type: fileInfo.isPrint ? 'data' : 'code',
                start: 0,
                length: fileInfo.length,
                fullName: fileInfo.name
            };
            return TRDLoader.fileToTAP(fileData, mappedInfo);
        }

        /**
         * Create a blank formatted MDR image
         * @param {string} cartridgeName - cartridge name (max 10 chars)
         * @param {number} sectorCount - number of sectors (default 254 = standard cartridge)
         */
        static createBlankMDR(cartridgeName = 'BLANK', sectorCount = MDRLoader.SECTOR_COUNT) {
            const imageSize = sectorCount * MDRLoader.SECTOR_SIZE + 1;
            const image = new Uint8Array(imageSize);
            image.fill(0);

            // Format each sector with proper header structure
            for (let i = 0; i < sectorCount; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                // HDFLAG = 1 (valid header block)
                image[off] = 0x01;
                // HDNUMB = sector number (wraps within 254-sector cartridge boundaries)
                image[off + 1] = (sectorCount <= MDRLoader.SECTOR_COUNT)
                    ? sectorCount - i
                    : MDRLoader.SECTOR_COUNT - (i % MDRLoader.SECTOR_COUNT);
                // HDNAME (10 bytes at offset 4)
                writeField(image, off + 4, cartridgeName, 10);
                // HDCHK — header checksum (bytes 0-13)
                image[off + 14] = MDRLoader.mdrChecksum(image, off, 14);
                // Record area: all zeros = free sector (RECFLG=0, RECNUM=0, etc.)
                // DESCHK — descriptor checksum (bytes 15-28)
                image[off + 29] = MDRLoader.mdrChecksum(image, off + 15, 14);
                // DCHK — data checksum (all zeros)
                image[off + 542] = MDRLoader.mdrChecksum(image, off + 30, 512);
            }
            // Write-protect flag (last byte): 0 = not write-protected
            image[imageSize - 1] = 0;
            return image;
        }

        /**
         * Build MDR image from file list
         * files: [{name, data, isPrint}]
         * @param {number} sectorCount - total sectors (default 254 = standard cartridge)
         */
        static buildMDR(files, cartridgeName = 'BLANK', sectorCount = MDRLoader.SECTOR_COUNT) {
            const image = MDRLoader.createBlankMDR(cartridgeName, sectorCount);
            let nextSector = 0;  // Next free sector to allocate

            for (const file of files) {
                const fileData = new Uint8Array(file.data);
                const numSectors = Math.ceil(fileData.length / MDRLoader.DATA_SIZE) || 1;

                if (nextSector + numSectors > sectorCount) {
                    break;  // No more room
                }


                for (let rec = 0; rec < numSectors; rec++) {
                    const secIdx = nextSector++;
                    const off = secIdx * MDRLoader.SECTOR_SIZE;
                    const dataStart = rec * MDRLoader.DATA_SIZE;
                    const isLast = (rec === numSectors - 1);
                    const chunkLen = isLast
                        ? fileData.length - dataStart
                        : MDRLoader.DATA_SIZE;

                    // Header is already formatted by createBlankMDR

                    // Record descriptor (bytes 15-28)
                    image[off + 15] = isLast ? 0x06 : 0x04;  // RECFLG: bit 2=regular file, bit 1=EOF
                    if (file.isPrint) {
                        image[off + 15] = isLast ? 0x02 : 0x00;  // PRINT file: bit 2=0
                    }
                    image[off + 16] = rec;  // RECNUM
                    image[off + 17] = chunkLen & 0xFF;  // RECLEN low
                    image[off + 18] = (chunkLen >> 8) & 0xFF;  // RECLEN high
                    // RECNAM (10 bytes)
                    writeField(image, off + 19, file.name, 10);
                    // DESCHK
                    image[off + 29] = MDRLoader.mdrChecksum(image, off + 15, 14);

                    // Data (512 bytes at offset 30)
                    const dataOff = off + 30;
                    for (let j = 0; j < MDRLoader.DATA_SIZE; j++) {
                        image[dataOff + j] = (dataStart + j < fileData.length) ? fileData[dataStart + j] : 0;
                    }
                    // DCHK
                    image[off + 542] = MDRLoader.mdrChecksum(image, off + 30, 512);
                }
            }

            // Mark remaining sectors as free (HDFLAG=0, RECFLG=0)
            for (let i = nextSector; i < sectorCount; i++) {
                const off = i * MDRLoader.SECTOR_SIZE;
                // Keep sector number but clear HDFLAG to mark as free
                image[off] = 0x00;
                image[off + 15] = 0x00;
                image[off + 14] = MDRLoader.mdrChecksum(image, off, 14);
                image[off + 29] = MDRLoader.mdrChecksum(image, off + 15, 14);
                image[off + 542] = MDRLoader.mdrChecksum(image, off + 30, 512);
            }

            return image;
        }
    }

    /**
     * Microdrive — Interface 1 Microdrive hardware emulation
     * Instant-completion model (same as BetaDisk/PlusDDisk).
     * Up to 8 Microdrives, each with its own cartridge image.
     * Port $E7: data register, Port $EF: status/control register.
     */
    export class Microdrive {
        static get VERSION() { return VERSION; }

        constructor() {
            // 8 Microdrive slots, each with cartridge data and state
            this.drives = [];
            for (let i = 0; i < 8; i++) {
                this.drives.push({
                    cartridge: null,      // Uint8Array — raw MDR image (254×543 bytes)
                    writeProtect: false,
                    motorOn: false,
                    headPos: 0            // Byte position within the cartridge tape
                });
            }

            // COMMS shift register for drive selection (8-bit)
            this.commsShiftReg = 0;
            this.commsData = 0;           // COMMS DATA line (bit 0 of control port write)
            this.commsClk = 0;            // COMMS CLK line (bit 1 — for rising edge detect)

            // Control state
            this.writing = false;
            this.erasing = false;

            // Disk activity callback: function(type, drive, pos)
            this.onDiskActivity = null;

            // Track gap state for status reads
            this._gapCounter = 0;
        }

        /**
         * Get the currently selected (motor-on) drive index, or -1 if none
         */
        get activeDrive() {
            for (let i = 0; i < 8; i++) {
                if ((this.commsShiftReg & (1 << i)) && this.drives[i].motorOn) {
                    return i;
                }
            }
            return -1;
        }

        /**
         * Get the currently active drive object, or null
         */
        get currentDrive() {
            const idx = this.activeDrive;
            return idx >= 0 ? this.drives[idx] : null;
        }

        /**
         * Read port $E7 — Microdrive data register
         * Returns next byte from selected drive's tape
         */
        readData() {
            const drv = this.currentDrive;
            if (!drv || !drv.cartridge) return 0xFF;

            const tapeLen = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;
            const val = drv.cartridge[drv.headPos % tapeLen];
            drv.headPos = (drv.headPos + 1) % tapeLen;

            if (this.onDiskActivity) {
                this.onDiskActivity('read', this.activeDrive, drv.headPos);
            }
            return val;
        }

        /**
         * Write port $E7 — Microdrive data register
         * Writes byte to selected drive's tape
         */
        writeData(val) {
            const drv = this.currentDrive;
            if (!drv || !drv.cartridge || drv.writeProtect) return;
            if (!this.writing && !this.erasing) return;

            const tapeLen = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;
            drv.cartridge[drv.headPos % tapeLen] = val;
            drv.headPos = (drv.headPos + 1) % tapeLen;

            if (this.onDiskActivity) {
                this.onDiskActivity('write', this.activeDrive, drv.headPos);
            }
        }

        /**
         * Read port $EF — Status register
         * Bit 0: write protect (1=protected)
         * Bit 1: sync (1=sync pulse detected)
         * Bit 2: gap (1=in inter-record gap)
         * Bit 3: DTR (always 0 for Microdrive)
         * Bit 4: busy (1=no cartridge or no motor)
         * Bits 5-7: unused (1)
         */
        readStatus() {
            const drv = this.currentDrive;
            if (!drv || !drv.cartridge) {
                return 0xEF | 0x10;  // Not busy is wrong — if no drive, bit 4 = busy = 1... actually bit 4 = 0 means "ready"
                // Actually, when no drive: return $FF (all bits high, including busy)
            }

            let status = 0xE0;  // Bits 5-7 high (unused)

            // Bit 0: write protect
            if (drv.writeProtect) status |= 0x01;

            // Bit 4: not ready (no cartridge inserted or motor off)
            if (!drv.motorOn) {
                status |= 0x10;
                return status;
            }

            // Derive sync and gap from head position within sector
            const tapeLen = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;
            const posInSector = drv.headPos % MDRLoader.SECTOR_SIZE;

            // Gap between header and record (bytes 14-15 area)
            // Sync at the start of header (byte 0) and start of record (byte 15)
            if (posInSector === 0 || posInSector === MDRLoader.HEADER_SIZE) {
                status |= 0x02;  // Sync
            }
            if (posInSector >= MDRLoader.HEADER_SIZE - 1 && posInSector <= MDRLoader.HEADER_SIZE) {
                status |= 0x04;  // Gap
            }

            // Gap at end of sector (last few bytes before next sector)
            if (posInSector >= MDRLoader.SECTOR_SIZE - 2) {
                status |= 0x04;  // Gap
            }

            return status;
        }

        /**
         * Write port $EF — Control register
         * Bit 0: COMMS DATA
         * Bit 1: COMMS CLK (rising edge shifts data into shift register)
         * Bit 2: R/W mode (0=read, 1=write)
         * Bit 3: Erase (1=erase head active)
         * Bit 4: CTS (not used for Microdrive)
         * Bit 5: Wait (not emulated)
         */
        writeControl(val) {
            const newCommsData = val & 0x01;
            const newCommsClk = (val >> 1) & 0x01;

            // Detect rising edge on COMMS CLK
            if (newCommsClk && !this.commsClk) {
                // Shift data bit into shift register (MSB first → LSB)
                this.commsShiftReg = ((this.commsShiftReg << 1) | newCommsData) & 0xFF;

                // Update motor state for all drives
                for (let i = 0; i < 8; i++) {
                    this.drives[i].motorOn = !!(this.commsShiftReg & (1 << i));
                }
            }

            this.commsData = newCommsData;
            this.commsClk = newCommsClk;

            // R/W mode
            this.writing = !!(val & 0x04);

            // Erase
            this.erasing = !!(val & 0x08);
        }

        /**
         * Load cartridge into specified drive
         */
        loadCartridge(data, driveIndex = 0) {
            const idx = driveIndex & 0x07;
            const bytes = new Uint8Array(data);
            const tapeLen = MDRLoader.SECTOR_COUNT * MDRLoader.SECTOR_SIZE;

            this.drives[idx].cartridge = new Uint8Array(tapeLen);
            this.drives[idx].cartridge.set(bytes.subarray(0, Math.min(bytes.length, tapeLen)));
            this.drives[idx].writeProtect = bytes.length >= MDRLoader.IMAGE_SIZE ? bytes[MDRLoader.IMAGE_SIZE - 1] !== 0 : false;
            this.drives[idx].headPos = 0;
        }

        /**
         * Eject cartridge from specified drive
         */
        ejectCartridge(driveIndex = 0) {
            const idx = driveIndex & 0x07;
            this.drives[idx].cartridge = null;
            this.drives[idx].writeProtect = false;
            this.drives[idx].headPos = 0;
            this.drives[idx].motorOn = false;
        }

        /**
         * Check if specified drive has a cartridge
         */
        hasCartridge(driveIndex) {
            return this.drives[driveIndex & 0x07].cartridge !== null;
        }

        /**
         * Check if any drive has a cartridge
         */
        hasAnyCartridge() {
            return this.drives.some(d => d.cartridge !== null);
        }

        /**
         * Get cartridge data from specified drive (for project save)
         */
        getCartridgeData(driveIndex) {
            const drv = this.drives[driveIndex & 0x07];
            if (!drv.cartridge) return null;
            // Return full MDR image with write-protect flag
            const image = new Uint8Array(MDRLoader.IMAGE_SIZE);
            image.set(drv.cartridge);
            image[MDRLoader.IMAGE_SIZE - 1] = drv.writeProtect ? 1 : 0;
            return image;
        }

        /**
         * Reset all drives
         */
        reset() {
            this.commsShiftReg = 0;
            this.commsData = 0;
            this.commsClk = 0;
            this.writing = false;
            this.erasing = false;
            for (const drv of this.drives) {
                drv.motorOn = false;
                drv.headPos = 0;
                // Cartridge data persists across reset
            }
        }
    }

    /**
     * OPD Loader - Opus Discovery disk format
     * Raw sector dump: 40 tracks × 18 sectors × 256 bytes/sector
     * Single-sided: 184,320 bytes / Double-sided: 368,640 bytes
     */
    export class OPDLoader {
        static get VERSION() { return VERSION; }

        static get SECTORS_PER_TRACK() { return 18; }
        static get BYTES_PER_SECTOR() { return 256; }
        // Track count is derived from image size in getDiskInfo (SS = 40, DS DD = 80).
        static get SS_SIZE() { return 184320; }   // 40 × 18 × 256
        static get DS_SIZE() { return 737280; }   // 80 × 2 × 18 × 256 (real Opus DS DD)

        // Directory layout: sector 0 = disk descriptor, sectors 1-7 = directory (7 sectors)
        static get DIR_START_SECTOR() { return 1; }
        static get DIR_SECTORS() { return 7; }
        static get DIR_ENTRY_SIZE() { return 16; }
        static get MAX_DIR_ENTRIES() { return 112; }  // 7 * 256 / 16
        static get DATA_START_SECTOR() { return 8; }  // first data sector

        // File header (7 bytes at start of file data on disk)
        // Layout: type(1), length(2 LE), param1(2 LE), param2(2 LE)
        // BASIC: param1=autostart line, param2=program length (VARS-PROG)
        // CODE:  param1=start address, param2=32768
        static get FILE_HEADER_SIZE() { return 7; }

        static isOPD(data) {
            const len = data instanceof Uint8Array ? data.length : data.byteLength;
            return len === OPDLoader.SS_SIZE || len === OPDLoader.DS_SIZE;
        }

        static isDoubleSided(data) {
            const len = data instanceof Uint8Array ? data.length : data.byteLength;
            return len > OPDLoader.SS_SIZE;
        }

        static getSectorOffset(track, side, sector, sides) {
            return ((track * sides + side) * OPDLoader.SECTORS_PER_TRACK + sector) * OPDLoader.BYTES_PER_SECTOR;
        }

        /**
         * Read a directory entry from the raw directory data.
         * Entry format (16 bytes): bytes_in_last_block(2), first_block(2), last_block(2), name(10)
         * All integers are little-endian.
         */
        static _readDirEntry(dirData, index) {
            const off = index * 16;
            const bytesInLast = dirData[off] | (dirData[off + 1] << 8);
            const firstBlock = dirData[off + 2] | (dirData[off + 3] << 8);
            const lastBlock = dirData[off + 4] | (dirData[off + 5] << 8);
            let name = '';
            for (let i = 0; i < 10; i++) {
                const ch = dirData[off + 6 + i];
                if (ch >= 0x20 && ch < 0x7F) name += String.fromCharCode(ch);
                else name += ' ';
            }
            return { bytesInLast, firstBlock, lastBlock, name };
        }

        /**
         * Read the 7-byte file header from the start of a file's data area.
         * Header: type(1), length(2 LE), param1(2 LE), param2(2 LE)
         * BASIC: param1=autostart line, param2=program length (VARS-PROG)
         * CODE:  param1=start address, param2=32768
         */
        static _readFileHeader(data, sectorOffset) {
            if (sectorOffset + 7 > data.length) return null;
            const type = data[sectorOffset];
            const length = data[sectorOffset + 1] | (data[sectorOffset + 2] << 8);
            const param1 = data[sectorOffset + 3] | (data[sectorOffset + 4] << 8);
            const param2 = data[sectorOffset + 5] | (data[sectorOffset + 6] << 8);
            return { type, length, param1, param2 };
        }

        static getDiskInfo(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const sides = OPDLoader.isDoubleSided(bytes) ? 2 : 1;
            // Total sectors from the actual image size; track count follows (SS = 40,
            // DS DD = 80 — the real Opus DS is 80-track, not 40).
            const totalSectors = Math.floor(bytes.length / OPDLoader.BYTES_PER_SECTOR);
            const tracks = totalSectors / (sides * OPDLoader.SECTORS_PER_TRACK);

            // Read directory to count used sectors and files properly
            const files = OPDLoader.listFiles(bytes);
            let usedDataSectors = 0;
            for (const f of files) {
                usedDataSectors += f.sectors;
            }
            // Sectors 0-7 are always "used" (descriptor + directory)
            const usedSectors = OPDLoader.DATA_START_SECTOR + usedDataSectors;

            // Disk label from directory entry 0
            const dirOffset = OPDLoader.DIR_START_SECTOR * OPDLoader.BYTES_PER_SECTOR;
            const entry0 = OPDLoader._readDirEntry(bytes.subarray(dirOffset, dirOffset + OPDLoader.DIR_SECTORS * OPDLoader.BYTES_PER_SECTOR), 0);
            const diskLabel = entry0.name.trim();

            return {
                tracks,
                sides,
                sectorsPerTrack: OPDLoader.SECTORS_PER_TRACK,
                bytesPerSector: OPDLoader.BYTES_PER_SECTOR,
                totalSectors,
                usedSectors,
                freeSectors: totalSectors - usedSectors,
                totalSize: bytes.length,
                fileCount: files.length,
                diskLabel
            };
        }

        /**
         * Parse directory entries and return file list.
         * Directory is at sectors 1-7 (offset 256-2047).
         * Entry 0 = disk label, entries 1+ = files until last_block == 0xFFFF.
         */
        static listFiles(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            if (bytes.length < OPDLoader.DATA_START_SECTOR * OPDLoader.BYTES_PER_SECTOR) return [];

            const dirOffset = OPDLoader.DIR_START_SECTOR * OPDLoader.BYTES_PER_SECTOR;
            const dirData = bytes.subarray(dirOffset, dirOffset + OPDLoader.DIR_SECTORS * OPDLoader.BYTES_PER_SECTOR);
            const files = [];

            // Skip entry 0 (disk label), iterate entries 1-111
            for (let i = 1; i < OPDLoader.MAX_DIR_ENTRIES; i++) {
                const entry = OPDLoader._readDirEntry(dirData, i);

                // End of directory: last_block == 0xFFFF
                if (entry.lastBlock === 0xFFFF) break;

                // Skip empty entries (both blocks zero and no name)
                if (entry.firstBlock === 0 && entry.lastBlock === 0 && entry.bytesInLast === 0) continue;

                const sectors = entry.lastBlock - entry.firstBlock + 1;
                // bytesInLast: low 12 bits = bytes used in last sector minus 1 (per Opus manual)
                const rawLength = (entry.lastBlock - entry.firstBlock) * OPDLoader.BYTES_PER_SECTOR + (entry.bytesInLast & 0x0FFF) + 1;
                // Block numbers in directory are 0-based from sector 1 (sector 0 is descriptor)
                // image_sector = block + 1, per EXTRACT.C: fseek(infile, (first_block + 1) * BPS, SEEK_SET)
                const dataOffset = (entry.firstBlock + 1) * OPDLoader.BYTES_PER_SECTOR;

                // Read the 7-byte file header from the start of the file data
                const header = OPDLoader._readFileHeader(bytes, dataOffset);

                const typeNames = { 0: 'BASIC', 1: 'Num array', 2: 'Str array', 3: 'Code' };
                const extMap = { 0: 'B', 1: 'D', 2: 'D', 3: 'C' };

                files.push({
                    name: entry.name.replace(/\s+$/, ''),
                    dirIndex: i,
                    firstBlock: entry.firstBlock,
                    lastBlock: entry.lastBlock,
                    bytesInLast: entry.bytesInLast,
                    sectors,
                    rawLength,
                    length: header ? header.length : rawLength,
                    type: header ? header.type : -1,
                    typeName: header ? (typeNames[header.type] || 'Unknown') : 'Unknown',
                    ext: header ? (extMap[header.type] || 'C') : 'C',
                    startAddr: header ? (header.type === 0 ? 0 : header.param1) : 0,
                    autostart: header ? (header.type === 0 ? header.param1 : 0) : 0,
                    progLength: header && header.type === 0 ? header.param2 : null,
                    dataOffset
                });
            }

            return files;
        }

        /**
         * Extract file data from OPD image (without the 7-byte Opus file header).
         * Uses directory-derived rawLength rather than the header's length field,
         * which may not represent the total data size on real Opus disks.
         * Returns Uint8Array of file content, or null on error.
         */
        static extractFile(data, fileInfo) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const dataStart = fileInfo.dataOffset + OPDLoader.FILE_HEADER_SIZE;
            const dataLen = fileInfo.rawLength - OPDLoader.FILE_HEADER_SIZE;
            if (dataLen <= 0 || dataStart + dataLen > bytes.length) return null;
            return bytes.slice(dataStart, dataStart + dataLen);
        }

        /**
         * Convert an extracted Opus file to a TAP block (header + data).
         */
        static fileToTAP(fileData, fileInfo) {
            // Build a standard TAP: header block + data block
            const header = new Uint8Array(21);
            header[0] = 0x00; // header flag
            header[1] = fileInfo.type >= 0 ? fileInfo.type : 3; // file type
            writeField(header, 2, fileInfo.name, 10);
            const len = fileData.length;
            header[12] = len & 0xFF;
            header[13] = (len >> 8) & 0xFF;
            if (fileInfo.type === 0) {
                // BASIC: param1 = autostart, param2 = program length
                const autostart = fileInfo.autostart || 0x8000;
                header[14] = autostart & 0xFF;
                header[15] = (autostart >> 8) & 0xFF;
                header[16] = len & 0xFF;
                header[17] = (len >> 8) & 0xFF;
            } else {
                // CODE: param1 = start address, param2 = 32768
                header[14] = fileInfo.startAddr & 0xFF;
                header[15] = (fileInfo.startAddr >> 8) & 0xFF;
                header[16] = 0x00;
                header[17] = 0x80;
            }
            // Checksum
            let chk = 0;
            for (let i = 0; i < 18; i++) chk ^= header[i];
            header[18] = chk;

            // Data block
            const dataBlock = new Uint8Array(len + 2);
            dataBlock[0] = 0xFF; // data flag
            dataBlock.set(fileData, 1);
            chk = 0;
            for (let i = 0; i < len + 1; i++) chk ^= dataBlock[i];
            dataBlock[len + 1] = chk;

            // TAP: length word + header, length word + data
            const tap = new Uint8Array(4 + 19 + 2 + len + 2);
            tap[0] = 19; tap[1] = 0; // header block length
            tap.set(header.subarray(0, 19), 2);
            const dataLen = len + 2;
            tap[21] = dataLen & 0xFF; tap[22] = (dataLen >> 8) & 0xFF;
            tap.set(dataBlock, 23);
            return tap;
        }

        // Opus boot sector (sector 0), base64-encoded, keyed by total image size.
        // Captured from genuine blank Opus disks (geometry-specific). Real Opus tools
        // and hardware require a valid boot sector to recognise the disk; M8XXX's own
        // reader ignores sector 0, but strict readers (e.g. HCDisk) reject a disk
        // without it. 184320 = 40T SS, 737280 = 80T DS.
        static get OPD_BOOT_SECTORS() {
            return {
                184320: 'GAUoEkC6A37ddwAjft13Ad1+AuYvVyN+5tCy3XcCydXNYwh/ANoCCeEjZgYGPnHD5Q9GEkYSHACUHOUGIvcS8XfJzbIcd91OAt1GA91uBN1mBd1eBhYAyfUGJPcS8cnlzbIcd+HAw4AnKnhcERQA7VLYzVQVBiL3EjYBIzYDIRRA5QH3GE4MAAP1Af4BJwEAAQcBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BJwEAAQgBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BJwEAAQkBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BJwEAAQoBAQ==',
                737280: 'GAVQElAqDn7ddwAjft13Ad1+AuYvVyN+5tCy3XcCydXNYwh/ANoCCeEjZgYGPnHD5Q9GEkYSHACUHOUGIvcS8XfJzbIcd91OAt1GA91uBN1mBd1eBhYAyfUGJPcS8cnlzbIcd+HAw4AnKnhcERQA7VLYzVQVBiL3EjYBIzYDIRRA5QH3GE4MAAP1Af4BTwEAAQUBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BTwEAAQYBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BTwEAAQcBAQH3Fk4MAAP1AftA5UDlQOVA5QH3GE4MAAP1Af4BTwEAAQgBAQ==',
            };
        }

        // Write the Opus boot sector for this disk size into sector 0 (if available).
        static _writeOpdBoot(disk) {
            const b64 = OPDLoader.OPD_BOOT_SECTORS[disk.length];
            if (!b64) return false;
            const boot = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            disk.set(boot.subarray(0, OPDLoader.BYTES_PER_SECTOR), 0);
            return true;
        }

        // Write a 16-byte directory entry: bytesInLast/first/last (LE) + 10-char name.
        static _writeOpdDirEntry(disk, off, label, bytesInLast, first, last) {
            disk[off] = bytesInLast & 0xFF; disk[off + 1] = (bytesInLast >> 8) & 0xFF;
            disk[off + 2] = first & 0xFF; disk[off + 3] = (first >> 8) & 0xFF;
            disk[off + 4] = last & 0xFF; disk[off + 5] = (last >> 8) & 0xFF;
            writeField(disk, off + 6, label || '', 10);
        }

        static createBlankOPD(sides = 1) {
            const size = sides >= 2 ? OPDLoader.DS_SIZE : OPDLoader.SS_SIZE;
            const BPS = OPDLoader.BYTES_PER_SECTOR;
            const disk = new Uint8Array(size);
            OPDLoader._writeOpdBoot(disk);                                  // sector 0 (boot)
            const dirOffset = OPDLoader.DIR_START_SECTOR * BPS;
            disk.fill(0xE5, dirOffset);                                     // dir + data = formatted-empty
            const totalSectors = size / BPS;
            // entry 0 = disk label (occupies directory blocks 0..6); entry 1 = end marker
            OPDLoader._writeOpdDirEntry(disk, dirOffset, '', 0x00FF, 0, 6);
            OPDLoader._writeOpdDirEntry(disk, dirOffset + 16, '', 0x00FF, totalSectors - 1, 0xFFFF);
            return disk;
        }

        /**
         * Build an OPD image from a file list.
         * Each file must have: name, type, length, startAddr, autostart, data (Uint8Array).
         * @param {Array} files - File list
         * @param {string} diskName - Disk label (10 chars max)
         * @param {number} sides - 1 (SS) or 2 (DS)
         * @param {Uint8Array} [baseImage] - Original disk image to preserve sector 0 descriptor
         */
        static buildOPD(files, diskName, sides = 1, baseImage = null) {
            const size = sides >= 2 ? OPDLoader.DS_SIZE : OPDLoader.SS_SIZE;
            const totalSectors = size / OPDLoader.BYTES_PER_SECTOR;
            const BPS = OPDLoader.BYTES_PER_SECTOR;
            const disk = new Uint8Array(size);
            if (baseImage) {
                // Editing an existing disk: preserve its real sector 0 (boot).
                disk.set(baseImage.subarray(0, Math.min(size, baseImage.length)));
            } else {
                // Creating from scratch: embed the Opus boot sector for this geometry.
                OPDLoader._writeOpdBoot(disk);
            }

            const dirOffset = OPDLoader.DIR_START_SECTOR * BPS;
            // Reset directory + data area to formatted-empty (0xE5), then rewrite.
            disk.fill(0xE5, dirOffset);
            // entry 0 = disk label (occupies directory blocks 0..6)
            OPDLoader._writeOpdDirEntry(disk, dirOffset, diskName, 0x00FF, 0, 6);

            // Allocate files into entries 1..N starting at the data area
            let nextSector = OPDLoader.DATA_START_SECTOR;
            let written = 0;
            for (let fi = 0; fi < files.length && fi < OPDLoader.MAX_DIR_ENTRIES - 2; fi++) {
                const f = files[fi];
                const fileData = f.data;
                const headerLen = OPDLoader.FILE_HEADER_SIZE;
                const totalBytes = headerLen + fileData.length;
                const sectorsNeeded = Math.ceil(totalBytes / BPS);

                if (nextSector + sectorsNeeded > totalSectors) break; // disk full

                // Block numbers: block = image_sector - 1
                // (per EXTRACT.C: fseek(infile, (first_block + 1) * BPS, SEEK_SET))
                const firstBlock = nextSector - 1;
                const lastBlock = nextSector + sectorsNeeded - 2;
                // bytesInLast stores (actual bytes in last sector) - 1
                const bytesInLast = totalBytes - (sectorsNeeded - 1) * BPS - 1;

                // Write directory entry (entry written+1, since entry 0 is the label)
                const entryOff = dirOffset + (written + 1) * 16;
                disk[entryOff + 0] = bytesInLast & 0xFF;
                disk[entryOff + 1] = (bytesInLast >> 8) & 0xFF;
                disk[entryOff + 2] = firstBlock & 0xFF;
                disk[entryOff + 3] = (firstBlock >> 8) & 0xFF;
                disk[entryOff + 4] = lastBlock & 0xFF;
                disk[entryOff + 5] = (lastBlock >> 8) & 0xFF;
                writeField(disk, entryOff + 6, f.name || '', 10);

                // Write file header (7 bytes) at the image sector
                // Layout: type(1), length(2 LE), param1(2 LE), param2(2 LE)
                const dataOff = nextSector * BPS;
                const ftype = f.type !== undefined ? f.type : 3; // default CODE
                disk[dataOff + 0] = ftype;
                const len = fileData.length;
                disk[dataOff + 1] = len & 0xFF;
                disk[dataOff + 2] = (len >> 8) & 0xFF;
                // BASIC: param1=autostart, param2=program length
                // CODE:  param1=start address, param2=32768
                const param1 = ftype === 0 ? (f.autostart || 0x8000) : (f.startAddr || 0);
                disk[dataOff + 3] = param1 & 0xFF;
                disk[dataOff + 4] = (param1 >> 8) & 0xFF;
                const param2 = ftype === 0 ? (f.progLength || len) : 0x8000;
                disk[dataOff + 5] = param2 & 0xFF;
                disk[dataOff + 6] = (param2 >> 8) & 0xFF;

                // Write file data
                disk.set(fileData, dataOff + headerLen);

                nextSector += sectorsNeeded;
                written++;
            }

            // End-of-directory terminator after the last file (last_block=0xFFFF;
            // free pointer = last block, matching a real blank Opus disk)
            OPDLoader._writeOpdDirEntry(disk, dirOffset + (written + 1) * 16, diskName, 0x00FF, totalSectors - 1, 0xFFFF);

            return disk;
        }
    }

    /**
     * Didaktik 40/80 MDOS disk loader (read-only).
     * D40/D80 images are raw, header-less sector dumps (sector N at offset
     * N*512). Algorithms ported from the zxspectrumutils tools d802tap.cpp /
     * dird80.c. Supported: list catalog, extract files.
     */
    export class DidaktikLoader {
        static get VERSION() { return VERSION; }

        static get SECTOR_SIZE() { return 512; }
        static get FAT_OFFSET() { return 512; }          // FAT starts at sector 1
        static get FAT_ENTRIES_PER_SECTOR() { return 341; }
        // Directory occupies these physical sectors, in catalog order
        static get DIR_SECTORS() { return [6, 8, 10, 12, 7, 9, 11, 13]; }
        static get DIR_ENTRY_SIZE() { return 32; }
        static get TYPE_NAMES() {
            return { P: 'BASIC', B: 'Code', N: 'Num array', C: 'Char array', S: 'Snapshot', Q: 'Sequence' };
        }

        // Known raw image sizes (track × sides × sectors × 512)
        static isDidaktik(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            if (bytes.length < 14 * 512) return false;
            // MDOS boot sector carries an "SDOS" identifier at offset 204
            if (bytes[204] === 0x53 && bytes[205] === 0x44 &&
                bytes[206] === 0x4F && bytes[207] === 0x53) {
                return true;
            }
            // Fallback: a plausible D40/D80 size with a sane-looking catalog
            const sizes = [184320, 368640, 409600, 737280, 819200];
            if (!sizes.includes(bytes.length)) return false;
            return DidaktikLoader.listFiles(bytes).length > 0;
        }

        // MDOS 12-bit FAT entry decode (own nibble packing, not standard FAT12)
        static getFATnum(bytes, sector) {
            const sec = sector % DidaktikLoader.FAT_ENTRIES_PER_SECTOR;
            const base = DidaktikLoader.FAT_OFFSET +
                Math.floor(sector / DidaktikLoader.FAT_ENTRIES_PER_SECTOR) * 512 +
                Math.floor(sec * 3 / 2);
            const b0 = bytes[base] || 0;
            const b1 = bytes[base + 1] || 0;
            return (sec % 2 === 0)
                ? (b0 | ((b1 >> 4) << 8))        // even entry
                : (b1 | ((b0 & 0x0F) << 8));     // odd entry
        }

        static _readName(bytes, off) {
            let name = '';
            for (let i = 0; i < 10; i++) {
                const ch = bytes[off + i];
                if (ch === 0 || ch === 0xE5) break;
                if (ch >= 0x20 && ch < 0x7F) name += String.fromCharCode(ch);
            }
            return name.trimEnd();
        }

        static listFiles(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const files = [];
            for (const physSec of DidaktikLoader.DIR_SECTORS) {
                const base = physSec * 512;
                if (base + 512 > bytes.length) break;
                for (let i = 0; i < 16; i++) {
                    const off = base + i * 32;
                    const t = bytes[off];
                    if (t === 0x00 || t === 0xE5) continue;   // empty / deleted
                    const typeChar = (t >= 0x20 && t < 0x7F) ? String.fromCharCode(t) : '?';
                    const name = DidaktikLoader._readName(bytes, off + 1);
                    if (!name) continue;
                    const length = bytes[off + 11] | (bytes[off + 12] << 8) | (bytes[off + 21] << 16);
                    const startAddr = bytes[off + 13] | (bytes[off + 14] << 8);
                    const basicLength = bytes[off + 15] | (bytes[off + 16] << 8);
                    const firstSec = bytes[off + 17] | (bytes[off + 18] << 8);
                    const attributes = bytes[off + 20];
                    files.push({
                        name,
                        type: typeChar,
                        typeName: DidaktikLoader.TYPE_NAMES[typeChar] || 'Unknown',
                        ext: typeChar,
                        length,
                        startAddr,
                        basicLength,
                        firstSec,
                        attributes,
                        fullName: `${name}.${typeChar}`
                    });
                }
            }
            return files;
        }

        /**
         * Extract a file's data by walking its FAT sector chain.
         * Returns Uint8Array, or null on a bad/unreadable chain.
         */
        static extractFile(data, fileInfo) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const sectors = [];
            let sec = fileInfo.firstSec;
            let endVal = 0;
            let guard = 0;
            const maxGuard = Math.floor(bytes.length / 512) + 4;
            while (guard++ < maxGuard) {
                sectors.push(sec);
                const nv = DidaktikLoader.getFATnum(bytes, sec);
                if (nv >= 0xC00) { endVal = nv; break; }
                sec = nv;
            }
            if ((endVal & 0xF00) === 0xD00) return null;   // bad/unavailable sector

            let total = (sectors.length - 1) * 512;
            if (endVal > 0xE00) {
                total += (endVal & 0x1FF);                 // bytes used in final sector
            } else if (endVal === 0xE00) {
                if (total < fileInfo.length) total += 512; // 0xE00-as-EOF workaround
            } else if (endVal === 0xC00) {
                // proper end marker — final sector's used bytes come from the
                // declared length (length mod 512, or a full sector)
                const rem = fileInfo.length - total;
                total += (rem > 0 && rem <= 512) ? rem : 512;
            }
            if (total <= 0) return new Uint8Array(0);

            const out = new Uint8Array(total);
            let pos = 0;
            for (const s of sectors) {
                if (pos >= total) break;
                const o = s * 512;
                const n = Math.min(512, total - pos, Math.max(0, bytes.length - o));
                if (n <= 0) break;
                out.set(bytes.subarray(o, o + n), pos);
                pos += n;
            }
            return out;
        }

        static getDiskInfo(data) {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const hasBoot = bytes.length > 207;
            let diskLabel = '';
            if (hasBoot) {
                for (let i = 192; i < 202; i++) {
                    const ch = bytes[i];
                    if (ch >= 0x20 && ch < 0x7F) diskLabel += String.fromCharCode(ch);
                }
                diskLabel = diskLabel.trimEnd();
            }
            const tracksPerSide = hasBoot ? bytes[178] : 0;
            const sectorsPerTrack = hasBoot ? bytes[179] : 0;
            const doubleSided = hasBoot ? !!(bytes[177] & 0x10) : true;
            const files = DidaktikLoader.listFiles(bytes);
            return {
                diskLabel,
                tracks: tracksPerSide,
                sides: doubleSided ? 2 : 1,
                sectorsPerTrack,
                bytesPerSector: 512,
                totalSize: bytes.length,
                totalSectors: Math.floor(bytes.length / 512),
                fileCount: files.length
            };
        }

        /**
         * Write the 10-byte MDOS disk label into the boot sector (offset 192-201,
         * space-padded). Returns a new array; no-op if the disk has no boot sector.
         */
        static setDiskLabel(data, label) {
            const bytes = new Uint8Array(data);
            if (bytes.length <= 207) return bytes; // no boot sector → no label area
            writeField(bytes, 192, label || '', 10);
            return bytes;
        }

        /**
         * Fill a blank MDOS image's FAT + directory/data area (shared by D40/D80).
         * The directory (sectors 6-13) and data area (14..) get the 0xE5 format
         * byte; the FAT (image sectors 1..fatSectors) marks system sectors 0-13 and
         * the non-existent sectors past the disk (totalSectors..fatSectors*341-1) as
         * 0xDDD, leaving the data sectors free (0x000). The unused low nibble of each
         * FAT sector's last byte is forced to 0xD (→ 0x0D where the high nibble is a
         * free entry, 0xDD where it completes a 0xDDD non-existent entry).
         */
        static _writeMdosFatAndFill(bytes, totalSectors, fatSectors) {
            bytes.fill(0xE5, 6 * 512);
            for (let s = 0; s <= 13; s++) DidaktikLoader.setFATnum(bytes, s, 0xDDD);
            for (let s = totalSectors; s <= fatSectors * 341 - 1; s++) DidaktikLoader.setFATnum(bytes, s, 0xDDD);
            for (let s = 1; s <= fatSectors; s++) bytes[s * 512 + 511] = (bytes[s * 512 + 511] & 0xF0) | 0x0D;
        }

        /**
         * Build a blank, MDOS-formatted Didaktik D80 image — 80 track, double-sided,
         * 9 sectors/track, 512 B = 737280 B. Byte-reproduces a real greaseweazle/MDOS_2
         * format (tests/pristine/ref-d80-blank.d80), parameterised only by the label.
         * @param {string} label  up to 10 chars (null-padded, like a real format)
         * @returns {Uint8Array}
         */
        static createBlankD80(label = '') {
            const bytes = new Uint8Array(80 * 2 * 9 * 512);   // 737280
            DidaktikLoader._writeMdosFatAndFill(bytes, 80 * 2 * 9, 5);

            // Sector 0: MDOS boot/system descriptor (captured from a real MDOS_2
            // format). Parameter blocks at 0x80/0xB0 encode the geometry MDOS reads
            // back (byte 178=0x50 → 80 tracks, 179=0x09 → 9 sectors).
            const sig = 'Formated with MDOS_2 (MTs edition).';
            for (let i = 0; i < sig.length; i++) bytes[i] = sig.charCodeAt(i);
            const PARAM_80 = [0x01, 0x18, 0x28, 0x50, 0x00, 0x18, 0x50, 0x09, 0x00, 0x00, 0x00, 0x00,
                              0x81, 0x14, 0x50, 0x09, 0x00, 0x14, 0x50, 0x09];
            const PARAM_B0 = [0x81, 0x14, 0x50, 0x09, 0x00, 0x14, 0x50, 0x09];
            for (let i = 0; i < PARAM_80.length; i++) bytes[0x80 + i] = PARAM_80[i];
            for (let i = 0; i < PARAM_B0.length; i++) bytes[0xB0 + i] = PARAM_B0[i];
            writeField(bytes, 192, label || '', 10, 0x00);   // null-padded (real-format style)
            bytes[202] = 0x09; bytes[203] = 0x3A;             // format/serial word
            bytes[204] = 0x53; bytes[205] = 0x44;             // "SDOS" identifier (read by isDidaktik)
            bytes[206] = 0x4F; bytes[207] = 0x53;
            bytes[208] = 0x25;                                // '%'
            return bytes;
        }

        /**
         * Build a blank, MDOS-formatted Didaktik D40 image — 40 track, double-sided,
         * 9 sectors/track, 512 B = 368640 B (the standard 360K D40 per FlashFloppy
         * issue #335). Byte-reproduces a real D40 format (tests/pristine/ref-d40-blank.d40),
         * parameterised only by the label. (A different formatter than the D80 ref:
         * no signature string, its own parameter block and serial word.)
         * @param {string} label  up to 10 chars (null-padded)
         * @returns {Uint8Array}
         */
        static createBlankD40(label = '') {
            const bytes = new Uint8Array(40 * 2 * 9 * 512);   // 368640
            // FAT region is a fixed 5 image-sectors (1-5) as on D80; the
            // non-existent sectors past the disk (720..1704) are all marked 0xDDD.
            DidaktikLoader._writeMdosFatAndFill(bytes, 40 * 2 * 9, 5);

            // Sector 0: MDOS descriptor (no signature string for this formatter).
            // Parameter blocks at 0x80/0xB0 encode 40 tracks (0x28) / 9 sectors.
            const PARAM_80 = [0x81, 0x18, 0x28, 0x09, 0x00, 0x18, 0x28, 0x09, 0x00, 0x00, 0x00, 0x00,
                              0x01, 0x14, 0x50, 0x28, 0x00, 0x14, 0x28, 0x09];
            const PARAM_B0 = [0x81, 0x18, 0x28, 0x09, 0x00, 0x18, 0x28, 0x09];
            for (let i = 0; i < PARAM_80.length; i++) bytes[0x80 + i] = PARAM_80[i];
            for (let i = 0; i < PARAM_B0.length; i++) bytes[0xB0 + i] = PARAM_B0[i];
            writeField(bytes, 192, label || '', 10);  // space-padded (this formatter's style)
            bytes[202] = 0x51; bytes[203] = 0x79;             // format/serial word
            bytes[204] = 0x53; bytes[205] = 0x44;             // "SDOS" identifier
            bytes[206] = 0x4F; bytes[207] = 0x53;
            return bytes;
        }

        /**
         * Convert an extracted MDOS file to a TAP block pair (header + data).
         * BASIC (P) and Code (B) map to standard ZX header types.
         */
        static fileToTAP(fileData, fileInfo) {
            const header = new Uint8Array(21);
            header[0] = 0x00; // header flag
            // type byte: 0=BASIC, 3=CODE (others approximated as CODE)
            const tapType = fileInfo.type === 'P' ? 0 : fileInfo.type === 'N' ? 1
                : fileInfo.type === 'C' ? 2 : 3;
            header[1] = tapType;
            writeField(header, 2, fileInfo.name, 10);
            const len = fileData.length;
            header[12] = len & 0xFF; header[13] = (len >> 8) & 0xFF;
            const p1 = fileInfo.type === 'P' ? (fileInfo.basicLength || len) : fileInfo.startAddr;
            const p2 = fileInfo.type === 'P' ? (fileInfo.startAddr || 0x8000) : 0x8000;
            header[14] = p1 & 0xFF; header[15] = (p1 >> 8) & 0xFF;
            header[16] = p2 & 0xFF; header[17] = (p2 >> 8) & 0xFF;
            let parity = 0;
            for (let i = 0; i < 18; i++) parity ^= header[i];
            header[18] = parity;
            // (TAP block = 2-byte length + flag + payload + checksum)
            const mkBlock = (flag, payload) => {
                const blk = new Uint8Array(2 + 1 + payload.length + 1);
                const inner = 1 + payload.length + 1;
                blk[0] = inner & 0xFF; blk[1] = (inner >> 8) & 0xFF;
                blk[2] = flag;
                blk.set(payload, 3);
                let chk = flag;
                for (let i = 0; i < payload.length; i++) chk ^= payload[i];
                blk[blk.length - 1] = chk;
                return blk;
            };
            const hdrBlock = mkBlock(0x00, header.subarray(1, 18));
            const dataBlock = mkBlock(0xFF, fileData);
            const tap = new Uint8Array(hdrBlock.length + dataBlock.length);
            tap.set(hdrBlock, 0);
            tap.set(dataBlock, hdrBlock.length);
            return tap;
        }

        // ---- Write support (in-place edits; format per zxspectrumutils tap2d80.cpp) ----

        // Inverse of getFATnum: write a 12-bit FAT entry, preserving the shared nibble.
        static setFATnum(bytes, sector, value) {
            value &= 0xFFF;
            const sec = sector % DidaktikLoader.FAT_ENTRIES_PER_SECTOR;
            const base = DidaktikLoader.FAT_OFFSET +
                Math.floor(sector / DidaktikLoader.FAT_ENTRIES_PER_SECTOR) * 512 +
                Math.floor(sec * 3 / 2);
            if (sec % 2 === 0) {
                bytes[base] = value & 0xFF;
                bytes[base + 1] = (bytes[base + 1] & 0x0F) | (((value >> 8) & 0x0F) << 4);
            } else {
                bytes[base + 1] = value & 0xFF;
                bytes[base] = (bytes[base] & 0xF0) | ((value >> 8) & 0x0F);
            }
        }

        static _totalSectors(bytes) { return Math.floor(bytes.length / DidaktikLoader.SECTOR_SIZE); }

        // Free data sectors (FAT entry 0x000), data area starts at sector 14.
        static _freeSectors(bytes) {
            const total = DidaktikLoader._totalSectors(bytes);
            const free = [];
            for (let s = 14; s < total; s++) {
                if (DidaktikLoader.getFATnum(bytes, s) === 0x000) free.push(s);
            }
            return free;
        }

        // Find an empty directory slot offset, or -1 if the directory is full.
        static _findFreeDirEntry(bytes) {
            for (const physSec of DidaktikLoader.DIR_SECTORS) {
                const base = physSec * 512;
                if (base + 512 > bytes.length) break;
                for (let i = 0; i < 16; i++) {
                    const off = base + i * 32;
                    const t = bytes[off];
                    if (t === 0x00 || t === 0xE5) return off;
                }
            }
            return -1;
        }

        // Locate a file's directory entry by its (unique) first sector, or -1.
        static _findDirEntry(bytes, firstSec) {
            for (const physSec of DidaktikLoader.DIR_SECTORS) {
                const base = physSec * 512;
                if (base + 512 > bytes.length) break;
                for (let i = 0; i < 16; i++) {
                    const off = base + i * 32;
                    const t = bytes[off];
                    if (t === 0x00 || t === 0xE5) continue;
                    const fs = bytes[off + 17] | (bytes[off + 18] << 8);
                    if (fs === firstSec) return off;
                }
            }
            return -1;
        }

        /**
         * Add a file to a copy of the image. Returns the new Uint8Array.
         * file: { name, type ('P'/'B'/'N'/'C'/...), data:Uint8Array, startAddr, basicLength }
         * Throws on a full disk or full directory.
         */
        static addFile(data, file) {
            const bytes = new Uint8Array(data);
            const payload = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || 0);
            const len = payload.length;
            const numSec = Math.max(1, Math.ceil(len / 512));
            const free = DidaktikLoader._freeSectors(bytes);
            if (free.length < numSec) throw new Error(`Disk full (need ${numSec} sectors, ${free.length} free)`);
            const dirOff = DidaktikLoader._findFreeDirEntry(bytes);
            if (dirOff < 0) throw new Error('Directory full (max 128 files)');

            const chain = free.slice(0, numSec);
            // Write payload across the allocated sectors, zero-padding the final one.
            for (let i = 0; i < numSec; i++) {
                const o = chain[i] * 512;
                const start = i * 512;
                const end = Math.min(start + 512, len);
                bytes.set(payload.subarray(start, end), o);
                for (let p = end - start; p < 512; p++) bytes[o + p] = 0;
            }
            // FAT links + last-sector terminator (0xE00 + length%512, per tap2d80.cpp).
            for (let i = 0; i < numSec - 1; i++) DidaktikLoader.setFATnum(bytes, chain[i], chain[i + 1]);
            DidaktikLoader.setFATnum(bytes, chain[numSec - 1], 0xE00 | (len % 512));

            // Directory entry.
            const typeChar = (file.type || 'B').charAt(0);
            bytes[dirOff] = typeChar.charCodeAt(0);
            writeField(bytes, dirOff + 1, file.name || 'untitled', 10, 0x00);
            bytes[dirOff + 11] = len & 0xFF;
            bytes[dirOff + 12] = (len >> 8) & 0xFF;
            // bytes 13-14: P → autostart LINE, B/others → load address
            const startField = file.startAddr || 0;
            bytes[dirOff + 13] = startField & 0xFF;
            bytes[dirOff + 14] = (startField >> 8) & 0xFF;
            // bytes 15-16: P → BASIC program length, B/others → 0x8000 (per real disks)
            const bl = typeChar === 'P' ? (file.basicLength || len) : 0x8000;
            bytes[dirOff + 15] = bl & 0xFF;
            bytes[dirOff + 16] = (bl >> 8) & 0xFF;
            bytes[dirOff + 17] = chain[0] & 0xFF;
            bytes[dirOff + 18] = (chain[0] >> 8) & 0xFF;
            bytes[dirOff + 19] = 0x00;
            bytes[dirOff + 20] = 0x0F;                 // attributes (constant on real disks)
            bytes[dirOff + 21] = (len >> 16) & 0xFF;   // extended length (3rd byte)
            for (let i = 22; i < 32; i++) bytes[dirOff + i] = 0xE5;  // tail fill (matches tap2d80.cpp / real disks)
            return bytes;
        }

        /** Delete a file (free its FAT chain, clear the directory slot). Returns a new Uint8Array. */
        static deleteFile(data, fileInfo) {
            const bytes = new Uint8Array(data);
            const total = DidaktikLoader._totalSectors(bytes);
            let s = fileInfo.firstSec, guard = 0;
            const maxGuard = total + 4;
            while (guard++ < maxGuard && s >= 14 && s < total) {
                const nv = DidaktikLoader.getFATnum(bytes, s);
                DidaktikLoader.setFATnum(bytes, s, 0x000);
                if (nv >= 0xC00) break;
                s = nv;
            }
            const off = DidaktikLoader._findDirEntry(bytes, fileInfo.firstSec);
            if (off >= 0) bytes[off] = 0x00;
            return bytes;
        }

        /** Rename a file in place. Returns a new Uint8Array. */
        static renameFile(data, fileInfo, newName) {
            const bytes = new Uint8Array(data);
            const off = DidaktikLoader._findDirEntry(bytes, fileInfo.firstSec);
            if (off < 0) return bytes;
            writeField(bytes, off + 1, newName || '', 10, 0x00);
            return bytes;
        }

        /**
         * Update a file's start-address field (dir bytes 13-14) in place: the load
         * address for Code (B) files, or the autostart LINE for BASIC (P) files.
         * Returns a new Uint8Array.
         */
        static setStartAddr(data, firstSec, value) {
            const bytes = new Uint8Array(data);
            const off = DidaktikLoader._findDirEntry(bytes, firstSec);
            if (off < 0) return bytes;
            bytes[off + 13] = value & 0xFF;
            bytes[off + 14] = (value >> 8) & 0xFF;
            return bytes;
        }

        /**
         * Swap two files' 32-byte directory entries (located by their first sector),
         * changing catalog order without touching file data or the FAT. Returns a
         * new Uint8Array. Used to reorder files (Move Up/Down).
         */
        static swapDirEntries(data, firstSecA, firstSecB) {
            const bytes = new Uint8Array(data);
            const a = DidaktikLoader._findDirEntry(bytes, firstSecA);
            const b = DidaktikLoader._findDirEntry(bytes, firstSecB);
            if (a < 0 || b < 0 || a === b) return bytes;
            for (let i = 0; i < 32; i++) {
                const t = bytes[a + i];
                bytes[a + i] = bytes[b + i];
                bytes[b + i] = t;
            }
            return bytes;
        }
    }

    /**
     * SZX Loader - Modern ZX Spectrum snapshot format
     * Used by Spectaculator, ZXSpin, Fuse, etc.
     */
    export class SZXLoader {
        static get VERSION() { return VERSION; }

        static isSZX(data) {
            const bytes = new Uint8Array(data);
            return bytes.length >= 8 &&
                   bytes[0] === 0x5A && bytes[1] === 0x58 &&  // "ZX"
                   bytes[2] === 0x53 && bytes[3] === 0x54;    // "ST"
        }

        static getMachineType(machineId) {
            // Use profile-based lookup when available
            const profileType = getMachineBySzxId(machineId);
            if (profileType !== 'unknown') return profileType;
            // Fallback for IDs not in our profiles
            const types = {
                0: '16k', 5: '+3', 6: '+3e',
                8: 'scorpion', 9: 'didaktik', 10: '+2c', 11: '+2cs'
            };
            return types[machineId] || 'unknown';
        }

        /**
         * Parse SZX file and return structure info
         */
        static parse(data) {
            const bytes = new Uint8Array(data);
            if (!this.isSZX(data)) throw new Error('Not a valid SZX file');

            const info = {
                majorVersion: bytes[4],
                minorVersion: bytes[5],
                machineId: bytes[6],
                machineType: this.getMachineType(bytes[6]),
                flags: bytes[7],
                chunks: [],
                is128: bytes[6] >= 2 && bytes[6] <= 8
            };

            let offset = 8;
            while (offset < bytes.length - 8) {
                const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
                const size = bytes[offset + 4] | (bytes[offset + 5] << 8) |
                            (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);

                if (offset + 8 + size > bytes.length) break;

                info.chunks.push({
                    id: id,
                    offset: offset + 8,
                    size: size
                });

                offset += 8 + size;
            }

            return info;
        }

        /**
         * Decompress zlib data (requires pako)
         */
        static decompress(data) {
            if (typeof pako !== 'undefined') {
                return pako.inflate(data);
            }
            throw new Error('pako library required for SZX decompression');
        }

        /**
         * Extract RAM page from SZX (handles RAMP chunks)
         */
        static extractRAMPage(data, info, pageNum) {
            const bytes = new Uint8Array(data);

            for (const chunk of info.chunks) {
                if (chunk.id === 'RAMP') {
                    const flags = bytes[chunk.offset] | (bytes[chunk.offset + 1] << 8);
                    const page = bytes[chunk.offset + 2];

                    if (page === pageNum) {
                        const compressed = (flags & 1) !== 0;
                        const pageData = bytes.slice(chunk.offset + 3, chunk.offset + chunk.size);

                        if (compressed) {
                            return this.decompress(pageData);
                        }
                        return pageData;
                    }
                }
            }
            return null;
        }

        /**
         * Extract screen data (6912 bytes) from SZX
         */
        static extractScreen(data) {
            const info = this.parse(data);

            // Screen is in page 5 for 128K, or page 5 equivalent for 48K
            // In SZX, 48K uses pages 0,2,5 mapped to 16K-48K range
            // Page 5 is always at $4000-$7FFF
            const screenPage = info.is128 ? 5 : 5;
            const pageData = this.extractRAMPage(data, info, screenPage);

            if (pageData && pageData.length >= 6912) {
                return pageData.slice(0, 6912);
            }
            return null;
        }

        /**
         * Load SZX into emulator
         */
        static load(data, cpu, memory, ula) {
            const bytes = new Uint8Array(data);
            const info = this.parse(data);

            // Determine machine type
            const machineType = info.is128 ? '128k' : '48k';

            // Load Z80 registers (Z80R chunk)
            for (const chunk of info.chunks) {
                if (chunk.id === 'Z80R') {
                    const r = bytes.slice(chunk.offset, chunk.offset + chunk.size);
                    // Debug: log raw Z80R bytes for iff1/iff2/halted/tStates
                    const tStates = r[29] | (r[30] << 8) | (r[31] << 16) | (r[32] << 24);
                    cpu.f = r[0]; cpu.a = r[1];
                    cpu.c = r[2]; cpu.b = r[3];
                    cpu.e = r[4]; cpu.d = r[5];
                    cpu.l = r[6]; cpu.h = r[7];
                    cpu.f_ = r[8]; cpu.a_ = r[9];
                    cpu.c_ = r[10]; cpu.b_ = r[11];
                    cpu.e_ = r[12]; cpu.d_ = r[13];
                    cpu.l_ = r[14]; cpu.h_ = r[15];
                    cpu.ixl = r[16]; cpu.ixh = r[17];
                    cpu.iyl = r[18]; cpu.iyh = r[19];
                    cpu.sp = r[20] | (r[21] << 8);
                    cpu.pc = r[22] | (r[23] << 8);
                    cpu.i = r[24];
                    cpu.r = r[25];
                    cpu.iff1 = r[26] & 1;
                    cpu.iff2 = r[27] & 1;
                    cpu.im = r[28];
                    // r[29-32] are T-states
                    cpu.tStates = r[29] | (r[30] << 8) | (r[31] << 16) | (r[32] << 24);
                    // HALT state is ZXSTZF_HALTED (bit 1, 0x02) of chFlags at offset 34
                    // (offset 33 is chHoldIntReqCycles), per the SZX spec.
                    // Don't trust it if PC indicates interrupt-handler execution
                    // (PC=0x38 IM1 or PC=0x66 NMI means the CPU is in a handler, not halted).
                    const pc = cpu.pc;
                    if (r.length > 34 && (r[34] & 0x02) && pc !== 0x0038 && pc !== 0x0066) {
                        cpu.halted = true;
                    } else {
                        cpu.halted = false;
                    }
                    break;
                }
            }

            // Load Spectrum state (SPCR chunk)
            let port7FFD = 0;
            let port1FFD = 0;
            for (const chunk of info.chunks) {
                if (chunk.id === 'SPCR') {
                    const border = bytes[chunk.offset];
                    port7FFD = bytes[chunk.offset + 1];
                    // bytes[chunk.offset + 2] is port $FE (not needed)
                    port1FFD = bytes[chunk.offset + 3] || 0;  // Port 0x1FFD (+2A/+3)
                    if (ula) ula.setBorder(border);
                    break;
                }
            }

            // Load RAM pages
            if (info.is128) {
                // Load all RAM pages (8 for 128K, 16 for Scorpion, 64 for Pentagon 1024)
                const pageCount = memory.profile.ramPages;
                for (let page = 0; page < pageCount; page++) {
                    const pageData = this.extractRAMPage(data, info, page);
                    if (pageData) {
                        const bank = memory.getRamBank(page);
                        if (bank) bank.set(pageData.slice(0, PAGE_SIZE));
                    }
                }
                // Reset paging lock before setting paging state from snapshot
                // (otherwise writePaging returns early if previous program locked paging)
                memory.pagingDisabled = false;
                // Set paging state — apply secondary port before 0x7FFD so ROM bank combines correctly
                if (memory.profile.pagingModel === '+2a') {
                    memory.write1FFD(port1FFD);
                } else if (memory.profile.pagingModel === 'scorpion') {
                    memory.writeScorpion1FFD(port1FFD);
                } else if (memory.profile.pagingModel === 'pentagon1024') {
                    memory.writePortEFF7(port1FFD);
                }
                memory.writePaging(port7FFD);
            } else {
                // 48K: pages 0, 2, 5 map to $C000, $8000, $4000
                const page5 = this.extractRAMPage(data, info, 5);
                const page2 = this.extractRAMPage(data, info, 2);
                const page0 = this.extractRAMPage(data, info, 0);

                if (page5) memory.setBlock(SLOT1_START, page5.slice(0, PAGE_SIZE));
                if (page2) memory.setBlock(SLOT2_START, page2.slice(0, PAGE_SIZE));
                if (page0) memory.setBlock(SLOT3_START, page0.slice(0, PAGE_SIZE));
            }

            return { machineType, info };
        }

        /**
         * Create SZX snapshot
         */
        static create(cpu, memory, border = 7) {
            const is128k = memory.machineType !== '48k';
            const chunks = [];

            // Header (8 bytes): "ZXST" + version + machine ID + flags
            const header = new Uint8Array(8);
            header[0] = 0x5A; header[1] = 0x58;  // "ZX"
            header[2] = 0x53; header[3] = 0x54;  // "ST"
            header[4] = 1;    // Major version
            header[5] = 4;    // Minor version
            header[6] = memory.profile.szxMachineId;  // Machine ID from profile
            header[7] = 0;    // Flags
            chunks.push(header);

            // Z80R chunk - CPU registers (37 bytes)
            const z80rData = new Uint8Array(37);
            z80rData[0] = cpu.f; z80rData[1] = cpu.a;
            z80rData[2] = cpu.c; z80rData[3] = cpu.b;
            z80rData[4] = cpu.e; z80rData[5] = cpu.d;
            z80rData[6] = cpu.l; z80rData[7] = cpu.h;
            z80rData[8] = cpu.f_; z80rData[9] = cpu.a_;
            z80rData[10] = cpu.c_; z80rData[11] = cpu.b_;
            z80rData[12] = cpu.e_; z80rData[13] = cpu.d_;
            z80rData[14] = cpu.l_; z80rData[15] = cpu.h_;
            z80rData[16] = cpu.ix & 0xff; z80rData[17] = (cpu.ix >> 8) & 0xff;
            z80rData[18] = cpu.iy & 0xff; z80rData[19] = (cpu.iy >> 8) & 0xff;
            z80rData[20] = cpu.sp & 0xff; z80rData[21] = (cpu.sp >> 8) & 0xff;
            z80rData[22] = cpu.pc & 0xff; z80rData[23] = (cpu.pc >> 8) & 0xff;
            z80rData[24] = cpu.i;
            z80rData[25] = cpu.rFull;
            z80rData[26] = cpu.iff1 ? 1 : 0;
            z80rData[27] = cpu.iff2 ? 1 : 0;
            z80rData[28] = cpu.im;
            // T-states (bytes 29-32) - leave as 0
            // byte 33 = chHoldIntReqCycles (not tracked → 0)
            // byte 34 = chFlags: ZXSTZF_HALTED is bit 1 (0x02), per the SZX spec
            z80rData[34] = cpu.halted ? 0x02 : 0;
            // bytes 35-36 = wMemPtr - leave as 0
            chunks.push(this.makeChunk('Z80R', z80rData));

            // SPCR chunk - Spectrum state (8 bytes)
            const spcrData = new Uint8Array(8);
            spcrData[0] = border & 0x07;
            if (is128k) {
                const ps = memory.getPagingState();
                // Byte 1: port 0x7FFD value — reconstruct from paging state
                let port7FFD = (ps.ramBank & P7FFD_RAM_MASK) | (ps.screenBank === 7 ? P7FFD_SCREEN_BIT : 0x00) |
                              ((ps.romBank & 1) ? P7FFD_ROM_BIT : 0x00) | (ps.pagingDisabled ? P7FFD_LOCK_BIT : 0x00);
                // Pentagon 1024: bits 6-7 carry RAM bank bits 3-4, bit 5 carries bit 5 in 1MB mode
                if (memory.profile.pagingModel === 'pentagon1024') {
                    port7FFD |= (ps.ramBank & 0x18) << 3;  // bits 3,4 → 6,7
                    if (ps.pentagon1024Mode) {
                        port7FFD |= (ps.ramBank & 0x20);   // bit 5 → 5
                    }
                }
                spcrData[1] = port7FFD;
            }
            spcrData[2] = border & 0x07;  // Port $FE
            // Byte 3: port 0x1FFD (+2A/+3/Scorpion) or portEFF7 (Pentagon 1024)
            if (memory.profile.pagingModel === '+2a') {
                spcrData[3] = memory.port1FFD || 0;
            } else if (memory.profile.pagingModel === 'scorpion') {
                spcrData[3] = memory.scorpionPort1FFD || 0;
            } else if (memory.profile.pagingModel === 'pentagon1024') {
                spcrData[3] = memory.portEFF7 || 0;
            }
            // Bytes 4-7: reserved
            chunks.push(this.makeChunk('SPCR', spcrData));

            // RAMP chunks - RAM pages
            if (is128k) {
                // Save all RAM pages (8 for 128K, 64 for Pentagon 1024, etc.)
                const pageCount = memory.profile.ramPages;
                for (let page = 0; page < pageCount; page++) {
                    const pageData = memory.getRamBank(page);
                    if (pageData) chunks.push(this.makeRAMPChunk(page, pageData));
                }
            } else {
                // 48K: save pages 5, 2, 0 (for slot 1, slot 2, slot 3)
                const pageMap = [
                    { page: 5, start: SLOT1_START },
                    { page: 2, start: SLOT2_START },
                    { page: 0, start: SLOT3_START }
                ];
                for (const { page, start } of pageMap) {
                    const pageData = new Uint8Array(PAGE_SIZE);
                    for (let i = 0; i < PAGE_SIZE; i++) {
                        pageData[i] = memory.read(start + i);
                    }
                    chunks.push(this.makeRAMPChunk(page, pageData));
                }
            }

            // Combine all chunks
            const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
            const result = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }
            return result;
        }

        /**
         * Create a generic SZX chunk
         */
        static makeChunk(id, data) {
            const chunk = new Uint8Array(8 + data.length);
            // Chunk ID (4 bytes)
            for (let i = 0; i < 4; i++) {
                chunk[i] = id.charCodeAt(i);
            }
            // Size (4 bytes, little endian)
            chunk[4] = data.length & 0xff;
            chunk[5] = (data.length >> 8) & 0xff;
            chunk[6] = (data.length >> 16) & 0xff;
            chunk[7] = (data.length >> 24) & 0xff;
            // Data
            chunk.set(data, 8);
            return chunk;
        }

        /**
         * Create a RAMP (RAM Page) chunk with optional compression
         */
        static makeRAMPChunk(pageNum, pageData) {
            // Try to compress with pako if available
            let compressed = null;
            let useCompression = false;

            if (typeof pako !== 'undefined') {
                try {
                    compressed = pako.deflate(pageData);
                    // Only use compression if it actually saves space
                    if (compressed.length < pageData.length - 100) {
                        useCompression = true;
                    }
                } catch (e) {
                    // Compression failed, use uncompressed
                }
            }

            const data = useCompression ? compressed : pageData;
            const rampData = new Uint8Array(3 + data.length);

            // Flags (2 bytes): bit 0 = compressed
            rampData[0] = useCompression ? 1 : 0;
            rampData[1] = 0;
            // Page number
            rampData[2] = pageNum;
            // Page data
            rampData.set(data, 3);

            return this.makeChunk('RAMP', rampData);
        }
    }

