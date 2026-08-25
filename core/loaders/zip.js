/**
 * ZX-M8XXX - ZIP archive reader
 * @license GPL-3.0
 *
 * Split out of core/loaders.js; that file re-exports everything here.
 */

    export class ZipLoader {
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
                    name.endsWith('.opd') || name.endsWith('.opu') ||
                    name.endsWith('.d80') || name.endsWith('.d40') || name.endsWith('.wav')) {
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
                    else if (name.endsWith('.d80') || name.endsWith('.d40')) type = 'd80';
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
