// PAL composite (RF / composite video) simulation — pure, DOM-free.
//
// A TV fed by RF or composite gets one wire carrying luminance and the colour
// subcarrier together, and can only separate them by filtering. Fine luminance
// detail whose frequency lands on the subcarrier is therefore demodulated as
// colour. That cross-colour is normally a nuisance; a program that picks its
// dither deliberately can use it as an extra palette.
//
// The frequencies decide whether that is usable. On a 128K/+2/+2A/+3 the master
// clock is 17.734475 MHz — exactly 4x the PAL subcarrier (4.43361875 MHz) — and
// the pixel clock is that over 2.5, so
//
//     f_subcarrier / f_pixel = 5/8   exactly
//
// Eight pixels are five subcarrier cycles: one bitmap byte is a whole number of
// cycles, so every character column starts at the same phase, every line starts
// at the same phase (456 pixels = 285 cycles) and so does every frame. The
// artifact colour of a byte is therefore fixed, and it is bin 5 (equivalently
// bin 3) of that byte's 8-point DFT. $A5 and $5A put *all* of their AC energy
// there and are 180 degrees apart, which is the whole trick behind "Chromatrons
// Attack" (Guesser / Gasman, 2013): two 50%-grey dithers that any pixel-exact
// emulator draws as the same flat grey come out of a TV as two complementary
// colours. A plain $AA/$55 checkerboard lands in bin 4 instead (Nyquist,
// 3.55 MHz) and produces no colour at all.
//
// The 48K has a 14 MHz crystal and a separate free-running subcarrier oscillator,
// so nothing is locked: that is its notorious dot crawl, and its artifact hue
// drifts instead of standing still. Sinclair fixed it on the 128K. The Pentagon
// and Scorpion clones are 14 MHz machines and are not locked either — hence the
// `ulaSubcarrierLock` profile field, in the spirit of `hasSnow` / `ulaInkSkew`.
//
// PAL, not NTSC, so the V (R-Y) axis is inverted line by line and the receiver's
// delay line averages neighbouring lines. For a dither that is identical on
// consecutive lines that cancels the artifact's V and leaves U (a blue/yellow
// axis); for a dither *inverted* every line — which is what Chromatrons does — it
// cancels U and leaves V, a magenta/green axis with the blue channel untouched.
// Hardware photographs of the game show exactly that: magenta (185, 91, 121)
// against green (57, 157, 121), the same blue to within one count.
//
// Implementation. The honest model is: encode Y/U/V to a composite waveform at
// 5 samples per pixel (so 8 samples per subcarrier cycle), notch the luminance,
// quadrature-demodulate the chroma, average the line pair, convert back. The whole
// chain is linear and, on a locked machine, periodic in 8 pixels — so it collapses
// exactly into a per-pixel 3x3 FIR whose coefficients depend only on the subcarrier
// phase at that pixel. `buildKernels` derives those coefficients from the
// sample-level chain by impulse response, so the fast path *is* the slow path.

// --- Physical constants -----------------------------------------------------

export const PAL_SUBCARRIER_HZ = 4433618.75;
export const PIXEL_CLOCK_LOCKED_HZ = 7093790;    // 17.734475 MHz / 2.5 (128K family)
export const PIXEL_CLOCK_FREE_HZ = 7000000;      // 14 MHz / 2 (48K, Pentagon, clones)

// 5 samples per pixel puts exactly 8 samples in a subcarrier cycle on a locked
// machine, which makes an 8-sample boxcar a perfect notch at the subcarrier.
export const SAMPLES_PER_PIXEL = 5;
export const SAMPLES_PER_CYCLE = 8;

// Degrees of subcarrier per pixel: 360 * 5/8 on a locked machine.
export const LOCKED_PIXEL_PHASE = 225;
export const FREE_PIXEL_PHASE = 360 * PAL_SUBCARRIER_HZ / PIXEL_CLOCK_FREE_HZ;

// Phase of the subcarrier at the left edge of the display, in degrees. Calibrated
// against the real-hardware photograph of Chromatrons Attack: at 180 the game's
// two fields come out magenta and green, in the layout the photo shows. Every
// border width is a multiple of 8 pixels, so paper and border share this origin.
export const DEFAULT_BURST_PHASE = 180;

// How many phases the kernel table holds. A locked machine only ever needs the 8
// multiples of 45 degrees; the finer grid exists so an unlocked machine's drifting
// phase can be followed.
export const PHASE_STEPS = 32;

// The chroma path is two 9-tap filters, so an output sample reaches 8 samples
// either side of itself: sample 5x+2 pulls on 5x-6 .. 5x+10, which is pixels
// x-2 .. x+2 and no further. Two taps each side is therefore exact, not a
// truncation, and the inner loop below is unrolled for exactly that width.
export const KERNEL_HALF = 2;
export const KERNEL_TAPS = KERNEL_HALF * 2 + 1;

export function defaultOptions() {
    return {
        burstPhase: DEFAULT_BURST_PHASE,
        saturation: 1,
        notch: 1,             // 1 = full luma notch; below 1 leaves dither texture
        delayLine: true,      // a receiver without one shows Hanover bars instead
        locked: true,         // pixel clock locked to the subcarrier (128K family)
        pixelsPerLine: 456,   // 228 T-states, for the unlocked phase drift
        linesPerFrame: 311,
    };
}

// Degrees of subcarrier per pixel for a machine profile.
export function pixelPhaseFor(profile) {
    return isLocked(profile) ? LOCKED_PIXEL_PHASE : FREE_PIXEL_PHASE;
}

export function isLocked(profile) {
    return !!(profile && profile.ulaSubcarrierLock);
}

// --- Colour space -----------------------------------------------------------

export function rgbToYuv(r, g, b) {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    return [y, 0.492 * (b - y), 0.877 * (r - y)];
}

export function yuvToRgb(y, u, v) {
    return [y + 1.140 * v, y - 0.395 * u - 0.581 * v, y + 2.032 * u];
}

// --- Sample-level reference chain -------------------------------------------

// Centred 9-tap boxcar over 8 samples: exactly one subcarrier cycle, so it is a
// perfect null at the subcarrier and every harmonic of it, and it is symmetric,
// so it adds no group delay.
const NOTCH = [0.5, 1, 1, 1, 1, 1, 1, 1, 0.5].map(w => w / 8);

function convolve(src, kernel) {
    const n = src.length, half = (kernel.length - 1) >> 1;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let k = 0; k < kernel.length; k++) {
            const j = i + k - half;
            if (j >= 0 && j < n) acc += src[j] * kernel[k];
        }
        out[i] = acc;
    }
    return out;
}

// Encode one line of per-pixel Y/U/V to composite, then decode it back.
// `pix` is an array of {y, u, v}; `phaseAt(sample)` returns the subcarrier phase in
// radians; `parity` is the PAL V-switch sign for this line (+1 or -1).
// Returns one {y, u, v} per *sample*.
export function encodeDecodeLine(pix, phaseAt, parity, options) {
    const opts = Object.assign(defaultOptions(), options);
    const n = pix.length * SAMPLES_PER_PIXEL;
    const comp = new Float64Array(n);
    const du = new Float64Array(n);
    const dv = new Float64Array(n);
    const sinT = new Float64Array(n);
    const cosT = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        const t = phaseAt(k);
        sinT[k] = Math.sin(t);
        cosT[k] = Math.cos(t);
        const p = pix[(k / SAMPLES_PER_PIXEL) | 0];
        comp[k] = p.y + p.u * sinT[k] + parity * p.v * cosT[k];
    }
    for (let k = 0; k < n; k++) {
        du[k] = 2 * comp[k] * sinT[k];
        dv[k] = 2 * parity * comp[k] * cosT[k];
    }
    const yl = convolve(comp, NOTCH);
    const u = convolve(convolve(du, NOTCH), NOTCH);
    const v = convolve(convolve(dv, NOTCH), NOTCH);
    const out = new Array(n);
    for (let k = 0; k < n; k++) {
        out[k] = {
            y: opts.notch * yl[k] + (1 - opts.notch) * comp[k],
            u: opts.saturation * u[k],
            v: opts.saturation * v[k],
        };
    }
    return out;
}

// --- Kernel derivation ------------------------------------------------------

// One 3x3 matrix per tap, derived by pushing a unit impulse of each of Y, U and V
// through the sample-level chain. `phaseDeg` is the subcarrier phase at the centre
// (output) pixel; `parity` the PAL V-switch sign of the line. Tap t multiplies the
// source pixel at offset t - KERNEL_HALF; each matrix is row-major
// (outY, outU, outV) x (inY, inU, inV).
export function buildKernel(phaseDeg, parity, pixelPhaseDeg = LOCKED_PIXEL_PHASE, options) {
    const half = KERNEL_HALF;
    const width = KERNEL_TAPS + 2 * half;      // pad so the filter tails stay inside
    const centre = (width - 1) >> 1;
    const centreSample = centre * SAMPLES_PER_PIXEL + ((SAMPLES_PER_PIXEL - 1) >> 1);
    const perSample = pixelPhaseDeg / SAMPLES_PER_PIXEL;
    const phaseAt = (k) => (phaseDeg + (k - centreSample) * perSample) * Math.PI / 180;

    const taps = [];
    for (let t = 0; t < KERNEL_TAPS; t++) taps.push(new Float64Array(9));

    for (let inC = 0; inC < 3; inC++) {
        for (let d = -half; d <= half; d++) {
            const pix = [];
            for (let i = 0; i < width; i++) pix.push({ y: 0, u: 0, v: 0 });
            const src = pix[centre + d];
            if (inC === 0) src.y = 1; else if (inC === 1) src.u = 1; else src.v = 1;
            const out = encodeDecodeLine(pix, phaseAt, parity, options)[centreSample];
            const m = taps[half + d];
            m[0 * 3 + inC] = out.y;
            m[1 * 3 + inC] = out.u;
            m[2 * 3 + inC] = out.v;
        }
    }
    return taps;
}

// Full table: PHASE_STEPS phases x 2 line parities, flattened for the fast path.
// Layout: kernels[((phase * 2) + parity) * KERNEL_TAPS * 9 + tap * 9 + i]
// `wanted`, if given, is a per-phase flag: a locked machine only ever reaches 8 of
// the 32 slots, and deriving a kernel is not free.
export function buildKernels(pixelPhaseDeg = LOCKED_PIXEL_PHASE, options, wanted = null) {
    const table = new Float32Array(PHASE_STEPS * 2 * KERNEL_TAPS * 9);
    for (let p = 0; p < PHASE_STEPS; p++) {
        if (wanted && !wanted[p]) continue;
        const deg = p * 360 / PHASE_STEPS;
        for (let s = 0; s < 2; s++) {
            const taps = buildKernel(deg, s === 0 ? 1 : -1, pixelPhaseDeg, options);
            const base = (p * 2 + s) * KERNEL_TAPS * 9;
            for (let t = 0; t < KERNEL_TAPS; t++) {
                for (let i = 0; i < 9; i++) table[base + t * 9 + i] = taps[t][i];
            }
        }
    }
    return table;
}

// --- Runtime filter ---------------------------------------------------------

// A reusable filter over a packed RGBA framebuffer. Storage is allocated once and
// grown only when the display width changes; the kernel table is rebuilt only when
// an option that shapes it changes.
export function createPalFilter(options) {
    const opts = Object.assign(defaultOptions(), options);
    let pixelPhase = opts.locked ? LOCKED_PIXEL_PHASE : FREE_PIXEL_PHASE;
    let kernels = null;
    let width = 0;
    let inY = null, inU = null, inV = null;
    let outY = null, curU = null, curV = null, prevU = null, prevV = null;
    let phaseIdx = null, phaseIdxFor = NaN;
    let runLeft = null;
    let view32 = null, view32Buffer = null;
    let frame = 0;

    // A 32-bit view of the caller's framebuffer, so a whole-row flatness test costs
    // one word compare per pixel instead of three float divides.
    function words32(rgba) {
        if (view32Buffer !== rgba.buffer || !view32) {
            view32Buffer = rgba.buffer;
            view32 = (rgba.byteOffset === 0) ? new Uint32Array(rgba.buffer, 0, rgba.length >> 2) : null;
        }
        return view32;
    }

    function ensure(w) {
        if (w === width) return;
        width = w;
        inY = new Float32Array(w); inU = new Float32Array(w); inV = new Float32Array(w);
        outY = new Float32Array(w); curU = new Float32Array(w); curV = new Float32Array(w);
        prevU = new Float32Array(w); prevV = new Float32Array(w);
        phaseIdx = new Uint8Array(w);
        runLeft = new Int32Array(w);
        phaseIdxFor = NaN;
    }

    // On a locked machine every line shares one phase ramp, so this runs once.
    // `burstPhase` is the phase at sample 0 of the line, but a kernel is indexed by
    // the phase at its centre *sample* — half a pixel in, hence the extra term.
    function phasesFor(lineOffset) {
        if (lineOffset === phaseIdxFor) return phaseIdx;
        const centre = ((SAMPLES_PER_PIXEL - 1) >> 1) * pixelPhase / SAMPLES_PER_PIXEL;
        for (let x = 0; x < width; x++) {
            const p = (lineOffset + centre + x * pixelPhase) % 360;
            phaseIdx[x] = Math.round(((p + 360) % 360) * PHASE_STEPS / 360) % PHASE_STEPS;
        }
        phaseIdxFor = lineOffset;
        return phaseIdx;
    }

    // Which of the PHASE_STEPS slots this configuration can ever reach. Locked:
    // eight, because the phase advances 225 degrees a pixel and repeats every byte.
    function wantedPhases() {
        if (!opts.locked) return null;
        const wanted = new Uint8Array(PHASE_STEPS);
        const centre = ((SAMPLES_PER_PIXEL - 1) >> 1) * pixelPhase / SAMPLES_PER_PIXEL;
        for (let x = 0; x < 8; x++) {
            const p = ((opts.burstPhase + centre + x * pixelPhase) % 360 + 360) % 360;
            wanted[Math.round(p * PHASE_STEPS / 360) % PHASE_STEPS] = 1;
        }
        return wanted;
    }

    function rebuild() {
        pixelPhase = opts.locked ? LOCKED_PIXEL_PHASE : FREE_PIXEL_PHASE;
        kernels = buildKernels(pixelPhase, opts, wantedPhases());
        phaseIdxFor = NaN;
    }

    rebuild();

    return {
        get options() { return opts; },
        get kernels() { return kernels; },
        get pixelPhase() { return pixelPhase; },
        resetPhase() { frame = 0; },

        configure(next) {
            let changed = false;
            for (const k of Object.keys(next || {})) {
                if (opts[k] !== next[k]) { opts[k] = next[k]; changed = true; }
            }
            if (changed) rebuild();
            return changed;
        },

        // Filter rows [y0, y1) of a packed RGBA buffer, in place. `lineParity` is
        // the PAL V-switch sign of row y0; rows alternate from there.
        apply(rgba, w, y0, y1, lineParity = 0) {
            if (w <= 0 || y1 <= y0) return;
            ensure(w);
            const half = KERNEL_HALF;
            // A locked machine repeats exactly every line and every frame, so both
            // of these come out zero; an unlocked one creeps, which is dot crawl.
            const perLine = (pixelPhase * opts.pixelsPerLine) % 360;
            const perFrame = (perLine * opts.linesPerFrame) % 360;
            const frameOffset = (frame * perFrame) % 360;
            let firstRow = true;
            const view = words32(rgba);
            let prevUniform = -1;            // previous row's colour, if it had just one
            const INV = 1 / 255;

            for (let y = y0; y < y1; y++) {
                const rowBase = y * w * 4;

                // A row of one colour, under a row of the same colour, comes out of
                // the filter unchanged — and most of the border is exactly that.
                let uniform = -1;
                if (view) {
                    const b32 = y * w, w0 = view[b32];
                    uniform = w0;
                    for (let x = 1; x < w; x++) {
                        if (view[b32 + x] !== w0) { uniform = -1; break; }
                    }
                    if (uniform !== -1 && uniform === prevUniform && !firstRow) {
                        continue;            // prevU/prevV already hold this colour
                    }
                }

                let prevWord = 0xFFFFFFFF, run = 0;
                for (let x = 0; x < w; x++) {
                    const o = rowBase + x * 4;
                    const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
                    const yy = (0.299 * r + 0.587 * g + 0.114 * b) * INV;
                    inY[x] = yy;
                    inU[x] = 0.492 * (b * INV - yy);
                    inV[x] = 0.877 * (r * INV - yy);
                    const word = (r << 16) | (g << 8) | b;
                    run = (x > 0 && word === prevWord) ? run + 1 : 1;
                    prevWord = word;
                    runLeft[x] = run;
                }

                const parityIndex = (y - y0 + lineParity) & 1;
                const idx = phasesFor((opts.burstPhase + frameOffset + (y - y0) * perLine) % 360);

                for (let x = 0; x < w; x++) {
                    // A pixel whose whole tap window is one colour comes out of the
                    // filter unchanged (DC passes at unity), so skip the taps. Border
                    // rows and large flat areas cost almost nothing this way.
                    const edge = x + half;
                    if (x >= half && edge < w && runLeft[edge] > 2 * half) {
                        outY[x] = inY[x]; curU[x] = inU[x]; curV[x] = inV[x];
                        continue;
                    }
                    const kb = (idx[x] * 2 + parityIndex) * KERNEL_TAPS * 9;
                    let oy = 0, ou = 0, ov = 0;
                    if (x >= half && edge < w) {
                        // unrolled hot path: KERNEL_TAPS is 5, no clamping needed
                        let k = kb, sx = x - half;
                        for (let t = 0; t < 5; t++, k += 9, sx++) {
                            const sy = inY[sx], su = inU[sx], sv = inV[sx];
                            oy += kernels[k] * sy + kernels[k + 1] * su + kernels[k + 2] * sv;
                            ou += kernels[k + 3] * sy + kernels[k + 4] * su + kernels[k + 5] * sv;
                            ov += kernels[k + 6] * sy + kernels[k + 7] * su + kernels[k + 8] * sv;
                        }
                    } else {
                        for (let t = 0; t < KERNEL_TAPS; t++) {
                            let sx = x + t - half;
                            if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
                            const sy = inY[sx], su = inU[sx], sv = inV[sx];
                            const k = kb + t * 9;
                            oy += kernels[k] * sy + kernels[k + 1] * su + kernels[k + 2] * sv;
                            ou += kernels[k + 3] * sy + kernels[k + 4] * su + kernels[k + 5] * sv;
                            ov += kernels[k + 6] * sy + kernels[k + 7] * su + kernels[k + 8] * sv;
                        }
                    }
                    outY[x] = oy; curU[x] = ou; curV[x] = ov;
                }

                // PAL delay line: average this line's chroma with the one above.
                for (let x = 0; x < w; x++) {
                    const o = rowBase + x * 4;
                    let u = curU[x], v = curV[x];
                    if (opts.delayLine && !firstRow) {
                        u = (u + prevU[x]) * 0.5;
                        v = (v + prevV[x]) * 0.5;
                    }
                    const yy = outY[x];
                    const r = (yy + 1.140 * v) * 255;
                    const g = (yy - 0.395 * u - 0.581 * v) * 255;
                    const b = (yy + 2.032 * u) * 255;
                    rgba[o] = r < 0 ? 0 : r > 255 ? 255 : r;
                    rgba[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
                    rgba[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
                }
                prevU.set(curU); prevV.set(curV);
                prevUniform = uniform;
                firstRow = false;
            }
            frame++;
        },
    };
}
