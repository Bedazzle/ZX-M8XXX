/**
 * AY-3-8910 PSG (Programmable Sound Generator) Emulation
 *
 * Features:
 * - 3 tone generators with 12-bit period counters
 * - Noise generator with 17-bit LFSR
 * - Envelope generator with 16 shapes
 * - Stereo output (ABC/ACB modes)
 * - State serialization for project save/load
 * - Register logging for PSG file export
 */

class AY {
    static VERSION = '1.0.0';

    // Volume table - logarithmic scale matching real AY chip
    // Values normalized to 0-1 range
    static VOLUME_TABLE = [
        0.0000, 0.0137, 0.0205, 0.0291,
        0.0423, 0.0618, 0.0847, 0.1369,
        0.1691, 0.2647, 0.3527, 0.4499,
        0.5704, 0.6873, 0.8482, 1.0000
    ];

    // Envelope shapes (16 shapes, 32 steps each)
    // Each shape is defined by: continue, attack, alternate, hold flags
    static ENVELOPE_SHAPES = [
        // 0-3: \___  (decay, then off)
        { attack: false, hold: true, alternate: false, holdLevel: 0 },
        { attack: false, hold: true, alternate: false, holdLevel: 0 },
        { attack: false, hold: true, alternate: false, holdLevel: 0 },
        { attack: false, hold: true, alternate: false, holdLevel: 0 },
        // 4-7: /___  (attack, then off)
        { attack: true, hold: true, alternate: false, holdLevel: 0 },
        { attack: true, hold: true, alternate: false, holdLevel: 0 },
        { attack: true, hold: true, alternate: false, holdLevel: 0 },
        { attack: true, hold: true, alternate: false, holdLevel: 0 },
        // 8: \\\\  (continuous decay)
        { attack: false, hold: false, alternate: false, repeat: true },
        // 9: \___  (decay, then off)
        { attack: false, hold: true, alternate: false, holdLevel: 0 },
        // 10: \/\/  (decay-attack alternating)
        { attack: false, hold: false, alternate: true, repeat: true },
        // 11: \‾‾‾  (decay, then max)
        { attack: false, hold: true, alternate: false, holdLevel: 15 },
        // 12: ////  (continuous attack)
        { attack: true, hold: false, alternate: false, repeat: true },
        // 13: /‾‾‾  (attack, then max)
        { attack: true, hold: true, alternate: false, holdLevel: 15 },
        // 14: /\/\  (attack-decay alternating)
        { attack: true, hold: false, alternate: true, repeat: true },
        // 15: /___  (attack, then off)
        { attack: true, hold: true, alternate: false, holdLevel: 0 }
    ];

    constructor(clockRate = 1773400) {
        // Clock rate in Hz (1.7734 MHz for 128K, 1.75 MHz for Pentagon)
        this.clockRate = clockRate;

        // 16 registers
        this.registers = new Uint8Array(16);
        this.selectedRegister = 0;

        // Register masks (valid bits for each register)
        this.registerMasks = [
            0xFF, // R0: Channel A tone period fine
            0x0F, // R1: Channel A tone period coarse (4 bits)
            0xFF, // R2: Channel B tone period fine
            0x0F, // R3: Channel B tone period coarse (4 bits)
            0xFF, // R4: Channel C tone period fine
            0x0F, // R5: Channel C tone period coarse (4 bits)
            0x1F, // R6: Noise period (5 bits)
            0xFF, // R7: Mixer control
            0x1F, // R8: Channel A amplitude (5 bits, bit 4 = envelope)
            0x1F, // R9: Channel B amplitude (5 bits, bit 4 = envelope)
            0x1F, // R10: Channel C amplitude (5 bits, bit 4 = envelope)
            0xFF, // R11: Envelope period fine
            0xFF, // R12: Envelope period coarse
            0x0F, // R13: Envelope shape (4 bits)
            0xFF, // R14: I/O Port A (unused in Spectrum)
            0xFF  // R15: I/O Port B (unused in Spectrum)
        ];

        // Tone generators (3 channels)
        this.toneCounters = [0, 0, 0];
        this.toneOutputs = [0, 0, 0];  // 0 or 1

        // Noise generator
        this.noiseCounter = 0;
        this.noiseShift = 0x1FFFF;  // 17-bit LFSR, initial state
        this.noiseOutput = 0;

        // Envelope generator
        this.envelopeCounter = 0;
        this.envelopePosition = 0;  // 0-31 (or 0-63 for alternating)
        this.envelopeShape = 0;
        this.envelopeHolding = false;
        this.envelopeAttacking = false;

        // Prescaler - AY divides master clock by 8 for tone/noise, by 16 for envelope
        this.prescaler = 0;

        // Sample accumulation for downsampling
        this.sampleAccumulator = [0, 0];  // Left, Right
        this.sampleCount = 0;

        // PSG logging for file export
        this.registerLog = [];
        this.loggingEnabled = false;
        this.logFrameNumber = 0;

        // Stereo mode: 'mono', 'abc', 'acb'
        // ABC: A=left, B=center, C=right
        // ACB: A=left, C=center, B=right
        this.stereoMode = 'abc';

        // Channel panning (0=left, 0.5=center, 1=right)
        this.updateStereoPanning();
    }

    /**
     * Update stereo panning based on mode
     */
    updateStereoPanning() {
        switch (this.stereoMode) {
            case 'abc':
                this.channelPan = [0.2, 0.5, 0.8];  // A=left, B=center, C=right
                break;
            case 'acb':
                this.channelPan = [0.2, 0.8, 0.5];  // A=left, B=right, C=center
                break;
            case 'mono':
            default:
                this.channelPan = [0.5, 0.5, 0.5];  // All center
                break;
        }
    }

    /**
     * Select register for read/write
     */
    selectRegister(reg) {
        this.selectedRegister = reg & 0x0F;
    }

    /**
     * Write to currently selected register
     */
    writeRegister(value) {
        const reg = this.selectedRegister;
        const maskedValue = value & this.registerMasks[reg];

        // Log register write if logging enabled
        if (this.loggingEnabled) {
            this.registerLog.push({
                frame: this.logFrameNumber,
                register: reg,
                value: maskedValue
            });
        }

        this.registers[reg] = maskedValue;

        // Handle envelope shape write - restart envelope
        if (reg === 13) {
            this.envelopePosition = 0;
            this.envelopeCounter = 0;
            this.envelopeHolding = false;
            this.envelopeShape = maskedValue;
            this.envelopeAttacking = AY.ENVELOPE_SHAPES[maskedValue].attack;
        }
    }

    /**
     * Read from currently selected register
     */
    readRegister() {
        return this.registers[this.selectedRegister];
    }

    /**
     * Write to specific register directly
     */
    writeRegisterDirect(reg, value) {
        this.selectedRegister = reg & 0x0F;
        this.writeRegister(value);
    }

    /**
     * Get tone period for a channel (12-bit value)
     */
    getTonePeriod(channel) {
        const fine = this.registers[channel * 2];
        const coarse = this.registers[channel * 2 + 1];
        return fine | (coarse << 8);
    }

    /**
     * Get noise period (5-bit value)
     */
    getNoisePeriod() {
        return this.registers[6] || 1;  // Avoid division by zero
    }

    /**
     * Get envelope period (16-bit value)
     */
    getEnvelopePeriod() {
        return this.registers[11] | (this.registers[12] << 8) || 1;
    }

    /**
     * Get channel amplitude (0-15 or envelope)
     */
    getChannelAmplitude(channel) {
        const amp = this.registers[8 + channel];
        if (amp & 0x10) {
            // Use envelope
            return this.getEnvelopeLevel();
        }
        return amp & 0x0F;
    }

    /**
     * Get current envelope level (0-15)
     */
    getEnvelopeLevel() {
        const shape = AY.ENVELOPE_SHAPES[this.envelopeShape];

        if (this.envelopeHolding) {
            return shape.holdLevel;
        }

        // Position within current cycle (0-31 for one direction)
        let pos = this.envelopePosition & 0x1F;

        // Determine direction based on current cycle
        let attacking = this.envelopeAttacking;
        if (shape.alternate && (this.envelopePosition & 0x20)) {
            attacking = !attacking;
        }

        if (attacking) {
            return pos >> 1;  // 0-15
        } else {
            return 15 - (pos >> 1);  // 15-0
        }
    }

    /**
     * Check if tone is enabled for channel
     */
    isToneEnabled(channel) {
        return !(this.registers[7] & (1 << channel));
    }

    /**
     * Check if noise is enabled for channel
     */
    isNoiseEnabled(channel) {
        return !(this.registers[7] & (8 << channel));
    }

    /**
     * Step the AY chip by one clock cycle
     * Called at AY clock rate (1.7734 MHz)
     *
     * The AY-3-8910 internally divides the master clock:
     * - Tone and noise counters run at clock/8
     * - Envelope counter runs at clock/16
     */
    step() {
        this.prescaler++;

        // Tone and noise update at clock/8
        if ((this.prescaler & 7) === 0) {
            // Update tone generators
            for (let ch = 0; ch < 3; ch++) {
                this.toneCounters[ch]++;
                const period = this.getTonePeriod(ch) || 1;
                if (this.toneCounters[ch] >= period) {
                    this.toneCounters[ch] = 0;
                    this.toneOutputs[ch] ^= 1;
                }
            }

            // Update noise generator
            this.noiseCounter++;
            const noisePeriod = this.getNoisePeriod() << 1;  // Noise period is doubled
            if (this.noiseCounter >= noisePeriod) {
                this.noiseCounter = 0;
                // 17-bit LFSR with taps at bits 0 and 3
                const bit = ((this.noiseShift ^ (this.noiseShift >> 3)) & 1);
                this.noiseShift = (this.noiseShift >> 1) | (bit << 16);
                this.noiseOutput = this.noiseShift & 1;
            }
        }

        // Envelope update at clock/16
        if ((this.prescaler & 15) === 0) {
            this.envelopeCounter++;
            const envPeriod = this.getEnvelopePeriod() || 1;
            if (this.envelopeCounter >= envPeriod) {
                this.envelopeCounter = 0;

                if (!this.envelopeHolding) {
                    this.envelopePosition++;

                    const shape = AY.ENVELOPE_SHAPES[this.envelopeShape];

                    // Check for end of cycle
                    if (this.envelopePosition >= 32) {
                        if (shape.hold) {
                            this.envelopeHolding = true;
                        } else if (shape.alternate) {
                            // Continue with next cycle
                        } else if (shape.repeat) {
                            this.envelopePosition = 0;
                        }
                    }

                    // For alternating shapes, wrap at 64
                    if (shape.alternate && this.envelopePosition >= 64) {
                        this.envelopePosition = 0;
                    }
                }
            }
        }
    }

    /**
     * Get current sample values for all channels
     * Returns [leftSample, rightSample] in range 0-1
     */
    getSample() {
        let left = 0;
        let right = 0;

        for (let ch = 0; ch < 3; ch++) {
            // Mix tone and noise
            const toneEnabled = this.isToneEnabled(ch);
            const noiseEnabled = this.isNoiseEnabled(ch);

            let output;
            if (!toneEnabled && !noiseEnabled) {
                // Both disabled - always high
                output = 1;
            } else {
                const toneOut = toneEnabled ? this.toneOutputs[ch] : 1;
                const noiseOut = noiseEnabled ? this.noiseOutput : 1;
                output = toneOut & noiseOut;
            }

            // Apply amplitude
            const amplitude = this.getChannelAmplitude(ch);
            const volume = AY.VOLUME_TABLE[amplitude] * output;

            // Apply stereo panning
            const pan = this.channelPan[ch];
            left += volume * (1 - pan);
            right += volume * pan;
        }

        // Normalize (max 3 channels at full volume)
        return [left / 1.5, right / 1.5];
    }

    /**
     * Step multiple times and accumulate samples
     * Used for downsampling from AY rate to audio rate
     */
    stepMultiple(steps) {
        for (let i = 0; i < steps; i++) {
            this.step();
            const [left, right] = this.getSample();
            this.sampleAccumulator[0] += left;
            this.sampleAccumulator[1] += right;
            this.sampleCount++;
        }
    }

    /**
     * Get averaged sample and reset accumulator
     */
    getAveragedSample() {
        if (this.sampleCount === 0) {
            return [0, 0];
        }

        const left = this.sampleAccumulator[0] / this.sampleCount;
        const right = this.sampleAccumulator[1] / this.sampleCount;

        this.sampleAccumulator[0] = 0;
        this.sampleAccumulator[1] = 0;
        this.sampleCount = 0;

        return [left, right];
    }

    /**
     * Reset the AY chip to initial state
     */
    reset() {
        this.registers.fill(0);
        this.selectedRegister = 0;

        this.toneCounters.fill(0);
        this.toneOutputs.fill(0);

        this.noiseCounter = 0;
        this.noiseShift = 0x1FFFF;
        this.noiseOutput = 0;

        this.envelopeCounter = 0;
        this.envelopePosition = 0;
        this.envelopeShape = 0;
        this.envelopeHolding = false;
        this.envelopeAttacking = false;

        this.prescaler = 0;

        this.sampleAccumulator = [0, 0];
        this.sampleCount = 0;
    }

    /**
     * Export full state for project save
     */
    exportState() {
        return {
            registers: Array.from(this.registers),
            selectedRegister: this.selectedRegister,
            toneCounters: [...this.toneCounters],
            toneOutputs: [...this.toneOutputs],
            noiseCounter: this.noiseCounter,
            noiseShift: this.noiseShift,
            noiseOutput: this.noiseOutput,
            envelopeCounter: this.envelopeCounter,
            envelopePosition: this.envelopePosition,
            envelopeShape: this.envelopeShape,
            envelopeHolding: this.envelopeHolding,
            envelopeAttacking: this.envelopeAttacking,
            prescaler: this.prescaler
        };
    }

    /**
     * Import state from project load
     */
    importState(state) {
        if (!state) return;

        if (state.registers) {
            for (let i = 0; i < 16; i++) {
                this.registers[i] = state.registers[i] || 0;
            }
        }

        this.selectedRegister = state.selectedRegister || 0;

        if (state.toneCounters) {
            this.toneCounters = [...state.toneCounters];
        }
        if (state.toneOutputs) {
            this.toneOutputs = [...state.toneOutputs];
        }

        this.noiseCounter = state.noiseCounter || 0;
        this.noiseShift = state.noiseShift || 0x1FFFF;
        this.noiseOutput = state.noiseOutput || 0;

        this.envelopeCounter = state.envelopeCounter || 0;
        this.envelopePosition = state.envelopePosition || 0;
        this.envelopeShape = state.envelopeShape || 0;
        this.envelopeHolding = state.envelopeHolding || false;
        this.envelopeAttacking = state.envelopeAttacking || false;
        this.prescaler = state.prescaler || 0;
    }

    // PSG Logging methods for future file export

    /**
     * Start logging register writes
     */
    startLogging() {
        this.registerLog = [];
        this.loggingEnabled = true;
        this.logFrameNumber = 0;
    }

    /**
     * Stop logging
     */
    stopLogging() {
        this.loggingEnabled = false;
    }

    /**
     * Clear the log
     */
    clearLog() {
        this.registerLog = [];
        this.logFrameNumber = 0;
    }

    /**
     * Advance frame counter (call once per emulated frame)
     */
    advanceLogFrame() {
        if (this.loggingEnabled) {
            this.logFrameNumber++;
        }
    }

    /**
     * Get the register log
     */
    getLog() {
        return this.registerLog;
    }

    /**
     * Set clock rate (for Pentagon compatibility)
     */
    setClockRate(rate) {
        this.clockRate = rate;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AY;
}
