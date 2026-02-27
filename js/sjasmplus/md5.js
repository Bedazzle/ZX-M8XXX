// sjasmplus-js - MD5 hash implementation
// Based on RFC 1321

export const MD5 = {
    // Convert string/array to MD5 hex string
    hash(data) {
        let bytes;
        if (typeof data === 'string') {
            bytes = new Uint8Array(data.length);
            for (let i = 0; i < data.length; i++) {
                bytes[i] = data.charCodeAt(i) & 0xFF;
            }
        } else if (data instanceof Uint8Array) {
            bytes = data;
        } else if (Array.isArray(data)) {
            bytes = new Uint8Array(data);
        } else {
            return '';
        }

        // Initialize hash values
        let a0 = 0x67452301;
        let b0 = 0xEFCDAB89;
        let c0 = 0x98BADCFE;
        let d0 = 0x10325476;

        // Pre-computed shift amounts
        const s = [
            7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
            5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
            4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
            6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21
        ];

        // Pre-computed constants
        const K = new Uint32Array(64);
        for (let i = 0; i < 64; i++) {
            K[i] = Math.floor(0x100000000 * Math.abs(Math.sin(i + 1)));
        }

        // Padding
        const origLen = bytes.length;
        const bitLen = origLen * 8;

        // Pad to 56 mod 64 bytes, then add 8 bytes for length
        let padLen = 64 - ((origLen + 9) % 64);
        if (padLen === 64) padLen = 0;

        const padded = new Uint8Array(origLen + 1 + padLen + 8);
        padded.set(bytes);
        padded[origLen] = 0x80;

        // Append length in bits as 64-bit little-endian
        padded[padded.length - 8] = bitLen & 0xFF;
        padded[padded.length - 7] = (bitLen >>> 8) & 0xFF;
        padded[padded.length - 6] = (bitLen >>> 16) & 0xFF;
        padded[padded.length - 5] = (bitLen >>> 24) & 0xFF;
        // Upper 32 bits of length (always 0 for our purposes)

        // Process 64-byte chunks
        for (let offset = 0; offset < padded.length; offset += 64) {
            // Break chunk into 16 32-bit words
            const M = new Uint32Array(16);
            for (let i = 0; i < 16; i++) {
                const j = offset + i * 4;
                M[i] = padded[j] | (padded[j + 1] << 8) | (padded[j + 2] << 16) | (padded[j + 3] << 24);
            }

            let A = a0, B = b0, C = c0, D = d0;

            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16) {
                    F = (B & C) | (~B & D);
                    g = i;
                } else if (i < 32) {
                    F = (D & B) | (~D & C);
                    g = (5 * i + 1) % 16;
                } else if (i < 48) {
                    F = B ^ C ^ D;
                    g = (3 * i + 5) % 16;
                } else {
                    F = C ^ (B | ~D);
                    g = (7 * i) % 16;
                }

                F = (F + A + K[i] + M[g]) >>> 0;
                A = D;
                D = C;
                C = B;
                B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
            }

            a0 = (a0 + A) >>> 0;
            b0 = (b0 + B) >>> 0;
            c0 = (c0 + C) >>> 0;
            d0 = (d0 + D) >>> 0;
        }

        // Convert to hex string (little-endian)
        const toHex = (n) => {
            let hex = '';
            for (let i = 0; i < 4; i++) {
                hex += ((n >>> (i * 8)) & 0xFF).toString(16).padStart(2, '0');
            }
            return hex;
        };

        return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
    }
};
