/**
 * ZX-M8XXX - Audio Worklet Processor
 * Handles audio output using modern AudioWorklet API
 */

class ZXAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Ring buffer for audio samples
        this.bufferSize = 8192;
        this.bufferL = new Float32Array(this.bufferSize);
        this.bufferR = new Float32Array(this.bufferSize);
        this.writePos = 0;
        this.readPos = 0;

        // Receive samples from main thread
        this.port.onmessage = (event) => {
            const { left, right } = event.data;
            if (left && right) {
                for (let i = 0; i < left.length; i++) {
                    this.bufferL[this.writePos] = left[i];
                    this.bufferR[this.writePos] = right[i];
                    this.writePos = (this.writePos + 1) % this.bufferSize;
                }
            }
        };
    }

    process(inputs, outputs, parameters) {
        const outputL = outputs[0][0];
        const outputR = outputs[0][1];

        if (!outputL || !outputR) return true;

        for (let i = 0; i < outputL.length; i++) {
            if (this.readPos !== this.writePos) {
                outputL[i] = this.bufferL[this.readPos];
                outputR[i] = this.bufferR[this.readPos];
                this.readPos = (this.readPos + 1) % this.bufferSize;
            } else {
                // Buffer underrun - output silence
                outputL[i] = 0;
                outputR[i] = 0;
            }
        }

        return true; // Keep processor alive
    }
}

registerProcessor('zx-audio-processor', ZXAudioProcessor);
