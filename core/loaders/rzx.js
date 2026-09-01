/**
 * ZX-M8XXX - RZX input recordings
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
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
            // Normalize input to ArrayBuffer.
            //
            // Test the shape, not the constructor. `instanceof` compares against the
            // current realm's ArrayBuffer, so a buffer fetched by a host page and handed
            // to this module — the normal shape of a headless driver — failed the check
            // and a genuine recording was rejected. That took replayRZX() and
            // mapRun({rzxUrl}) with it, since both parse through here. isRZX() above and
            // every other loader in this tree already coerce; match them.
            let buffer;
            if (ArrayBuffer.isView(data)) {
                buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            } else if (data && typeof data.byteLength === 'number') {
                buffer = data;      // an ArrayBuffer from any realm — used as-is, no copy
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
