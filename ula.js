/**
 * ZX-M8XXX - ULA (Video and Keyboard)
 * @version 0.9.0
 * @license GPL-3.0
 *
 * Cycle-accurate scanline-based rendering for multicolor effects.
 */

(function(global) {
    'use strict';

    const VERSION = '0.9.0';

    class ULA {
        static get VERSION() { return VERSION; }

        constructor(memory, machineType = '48k') {
            this.memory = memory;
            this.machineType = machineType;
            this.profile = getMachineProfile(machineType);
            this.borderPreset = 'full';  // Current border preset
            this.fullBorderMode = true;  // Derived from preset for backwards compatibility
            this.borderOnly = false;  // When true, don't draw paper area (256x192)
            this.debugBorderTiming = false;  // Enable to log border change timing
            this.debugScreenRendering = false;  // Enable to log screen vs border decisions
            this.debugMulticolor = false;  // Enable to log multicolor attribute changes
            this.debugPaperBoundary = false;  // Enable to log paper boundary (line 64) timing
            this.mcTimingOffset = 0;  // Multicolor lookup offset (console: spectrum.ula.mcTimingOffset = X)
            this.mcWriteAdjust = 5;   // Write time adjustment - ADDED to recorded tStates (try 5-8 for PUSH)
            this.mc128kOffset = 0;    // 128K-specific colTstate offset (console: spectrum.ula.mc128kOffset = X)
            this.SCREEN_WIDTH = 256;
            this.SCREEN_HEIGHT = 192;

            // Border size presets (machine-independent display sizes)
            // Full: uses actual machine hardware sizes
            // Normal: standard cropped view (uses machine-specific normal sizes)
            // Others: fixed sizes regardless of machine type
            this.BORDER_PRESETS = {
                'full':   null,  // Uses FULL_BORDER_SIZES (machine-specific)
                'normal': null,  // Uses NORMAL_BORDER_SIZES (machine-specific)
                'thick':  { top: 48, left: 48, right: 48, bottom: 48 },   // 352x288
                'medium': { top: 32, left: 32, right: 32, bottom: 32 },   // 320x256
                'small':  { top: 16, left: 16, right: 16, bottom: 16 },   // 288x224
                'none':   { top: 0, left: 0, right: 0, bottom: 0 }        // 256x192
            };

            // Full border sizes per machine type (actual hardware values)
            // 48K:  64 top, 48 left/right, 56 bottom (312 lines total)
            // 128K: 63 top, 48 left/right, 56 bottom (311 lines total)
            // Pentagon: 80 top, 48 left/right, 48 bottom (320 lines total)
            this.FULL_BORDER_SIZES = {
                '48k':     { top: 64, left: 48, right: 48, bottom: 56 },
                '128k':    { top: 63, left: 48, right: 48, bottom: 56 },
                '+2':      { top: 63, left: 48, right: 48, bottom: 56 },
                '+2a':     { top: 63, left: 48, right: 48, bottom: 56 },
                '+3':      { top: 63, left: 48, right: 48, bottom: 56 },
                'pentagon': { top: 80, left: 48, right: 48, bottom: 48 },
                'pentagon1024': { top: 80, left: 48, right: 48, bottom: 48 }
            };

            // Normal (cropped) border sizes
            // 128K: top increased from 24 to 26 (+4px) to match hardware alignment
            this.NORMAL_BORDER_SIZES = {
                '48k':     { top: 24, left: 32, right: 32, bottom: 24 },
                '128k':    { top: 26, left: 32, right: 32, bottom: 24 },
                '+2':      { top: 26, left: 32, right: 32, bottom: 24 },
                '+2a':     { top: 26, left: 32, right: 32, bottom: 24 },
                '+3':      { top: 26, left: 32, right: 32, bottom: 24 },
                'pentagon': { top: 24, left: 32, right: 32, bottom: 24 },
                'pentagon1024': { top: 24, left: 32, right: 32, bottom: 24 }
            };

            // Set initial border dimensions
            this.updateBorderDimensions();

            // Timing varies by machine:
            // 48K: 224 T-states/line × 312 lines = 69888 T-states/frame
            // 128K: 228 T-states/line × 311 lines = 70908 T-states/frame
            // Pentagon: 224 T-states/line × 320 lines = 71680 T-states/frame
            // Pixel-perfect timing model
            // Within each line: [left border][paper][right border][h-blank]
            // 2 pixels per T-state for visible area
            // Machine-specific timing configuration
            // All timing parameters consolidated in one place
            if (this.profile.ulaProfile === 'pentagon') {
                // Pentagon: 224 T-states/line × 320 lines = 71680 T-states/frame
                // Line: 32 (H-blank) + 36 (left border) + 128 (screen) + 28 (right border) = 224
                // Frame: 16 (V-blank) + 64 (top border) + 192 (screen) + 48 (bottom border) = 320
                this.TSTATES_PER_LINE = 224;
                this.LINES_PER_FRAME = 320;
                this.FIRST_SCREEN_LINE = 80;  // 16 V-blank + 64 top border
                this.VISIBLE_LINE_OFFSET = 0;
                this.ULA_CONTENTION_TSTATES = 0;     // Pentagon has no contention
                this.PAPER_START_TSTATE = 68;  // H-blank(32) + left border(36)
                // Pentagon timing - top-left PAPER pixel at line 80, T-state 68 within line
                // Reference: JSSpeccy3 mainScreenStartTstate = 17988
                this.TOP_LEFT_PIXEL_TSTATE = 80 * 224 + 68;  // = 17988
                this.TIMING_ADJUST = 0;  // No adjustment - using reference values directly
                this.VERTICAL_LINE_DRIFT = 0;  // No drift correction needed for Pentagon
                this.BORDER_TIMING_OFFSET = 0;  // No border offset needed for Pentagon
                this.BORDER_PHASE = 0;  // Pentagon has no 4T quantization
                this.ULA_READ_AHEAD = 0;  // Pentagon has no contention, no read-ahead needed
            } else if (this.profile.ulaProfile === '128k') {
                // 128K: 228 T-states/line × 311 lines = 70908 T-states/frame
                // Line structure (from libspectrum): 24 left + 128 screen + 24 right + 52 retrace = 228
                // Frame structure: 63 top + 192 screen + 56 bottom = 311
                this.TSTATES_PER_LINE = 228;
                this.LINES_PER_FRAME = 311;
                this.FIRST_SCREEN_LINE = 63;
                this.VISIBLE_LINE_OFFSET = 0;
                this.ULA_CONTENTION_TSTATES = 0;  // Per-line contention (not used, we do per-cycle)
                this.PAPER_START_TSTATE = 64;  // From ZXMAK2: c_ulaFirstPaperTact = 64
                // I/O Contention timing for 128K - contention pattern starts at 14361
                // (sinclair.wiki.zxnet.co.uk/wiki/Contended_memory)
                this.CONTENTION_START_TSTATE = 14361;
                this.CONTENTION_PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];
                this.CONTENTION_AREA_START = 24;  // Position within line where contention starts (after left border)
                this.CONTENTION_AREA_LENGTH = 128; // 128 T-states of paper area
                this.IO_CONTENTION_ENABLED = true;
                // 128K timing: top-left pixel displayed 14364 T-states after interrupt
                // Reference: sinclair.wiki.zxnet.co.uk/wiki/Contended_memory
                // 14364 = 63 * 228 (start of line 63, first paper line)
                this.TOP_LEFT_PIXEL_TSTATE = 14364;
                this.TIMING_ADJUST = 0;
                this.VERTICAL_LINE_DRIFT = 0;
                // Border timing offset: 0 for aligned border/paper rendering
                this.BORDER_TIMING_OFFSET = 0;
                this.BORDER_PHASE = 0;  // 128K border phase (testing)
                // ULA read-ahead: how many T-states before display the ULA reads attribute
                // This is a hardware characteristic independent of TOP_LEFT_PIXEL_TSTATE
                this.ULA_READ_AHEAD = 3;
            } else {
                // 48K timing
                this.TSTATES_PER_LINE = 224;
                this.LINES_PER_FRAME = 312;
                this.FIRST_SCREEN_LINE = 64;
                this.VISIBLE_LINE_OFFSET = 0;
                this.ULA_CONTENTION_TSTATES = 0;
                this.PAPER_START_TSTATE = 14;
                // 48K timing constants
                this.TOP_LEFT_PIXEL_TSTATE = 14336;
                this.BORDER_TIMING_OFFSET = 0;
                this.TIMING_ADJUST = 0;
                this.VERTICAL_LINE_DRIFT = 0;
                // Border phase: offset added after 4T quantization (like ZXMAK2 c_ulaBorder4Tstage)
                this.BORDER_PHASE = 0;
                // Memory contention pattern starts at 14335
                this.CONTENTION_START_TSTATE = 14335;
                this.CONTENTION_PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];
                this.IO_CONTENTION_ENABLED = true;  // Enable I/O contention for 48K
                // ULA read-ahead: ULA reads attribute before pixel is displayed
                // = TOP_LEFT_PIXEL_TSTATE - CONTENTION_START_TSTATE = 14336 - 14335 = 1
                this.ULA_READ_AHEAD = 1;
            }

            // Calculate line timing base (when first visible line's left border starts)
            // Left border is 24 T-states (48 pixels) before paper
            // Our visible area starts BORDER_TOP lines before the first paper line
            this.LEFT_BORDER_TSTATES = 24;  // 48 pixels / 2
            this.calculateLineTimes();

            // Derived timing values
            this.TSTATES_PER_FRAME = this.TSTATES_PER_LINE * this.LINES_PER_FRAME;
            this.INT_LENGTH = 32;
            this.LINE_VISIBLE_START = 0;

            // Border width in T-states: left border = 24 T-states (48 pixels)
            // Right border = 24 T-states (48 pixels), Paper = 128 T-states (256 pixels)
            this.BORDER_WIDTH_TSTATES = 24;
            
            // For scanline rendering
            this.lastRenderedLine = -1;
            this.borderChanges = [{tState: 0, color: 7}];
            // Screen bank changes for scroll17-style effects (port $7FFC triggers both ULA and paging)
            this.screenBankChanges = [{tState: 0, bank: 5}];

            // Per-scanline rendering: track beam position for immediate border rendering
            // Instead of recording changes and replaying, we render as changes happen
            this.beamRendering = true;  // Enable beam rendering mode
            this.lastRenderedBeamT = 0;  // T-state up to which we've rendered border

            this.borderColor = 7;
            this.earOutput = 0;
            this.micOutput = 0;
            this.flashState = false;
            this.flashCounter = 0;
            this.frameCounter = 0;
            
            this.keyboardState = new Uint8Array(8);
            this.keyboardState.fill(0xff);

            // Extended mode key sequence support
            // Extended mode requires: Caps+Symbol first, then Symbol+letter
            this.extendedModeActive = false;

            this.palette = [
                [0x00, 0x00, 0x00, 0xff], [0x00, 0x00, 0xd7, 0xff],
                [0xd7, 0x00, 0x00, 0xff], [0xd7, 0x00, 0xd7, 0xff],
                [0x00, 0xd7, 0x00, 0xff], [0x00, 0xd7, 0xd7, 0xff],
                [0xd7, 0xd7, 0x00, 0xff], [0xd7, 0xd7, 0xd7, 0xff],
                [0x00, 0x00, 0x00, 0xff], [0x00, 0x00, 0xff, 0xff],
                [0xff, 0x00, 0x00, 0xff], [0xff, 0x00, 0xff, 0xff],
                [0x00, 0xff, 0x00, 0xff], [0x00, 0xff, 0xff, 0xff],
                [0xff, 0xff, 0x00, 0xff], [0xff, 0xff, 0xff, 0xff]
            ];
            // Pre-compute 32-bit packed RGBA values for faster rendering
            this.updatePalette32();

            // ULAplus extended palette support
            // Port $BF3B: register select, Port $FF3B: data
            // Register 0-63: palette entries (4 CLUTs × 16 colors)
            // Register 64: mode register (bit 0 = palette enabled)
            this.ulaplus = {
                enabled: false,           // ULAplus hardware present
                paletteEnabled: false,    // Palette mode active (register 64, bit 0)
                paletteModified: false,   // True if any palette entry was written
                register: 0,              // Currently selected register (0-64)
                palette: new Uint8Array(64),  // 64 palette entries (GRB 332 format)
                palette32: new Uint32Array(64) // Pre-computed 32-bit RGBA
            };
            this.initULAplusPalette();

            this.frameBuffer = new Uint8ClampedArray(this.TOTAL_WIDTH * this.TOTAL_HEIGHT * 4);
            // Create Uint32Array view for faster pixel writes (4 bytes at once)
            this.frameBuffer32 = new Uint32Array(this.frameBuffer.buffer);

            // Pre-allocated typed arrays for multicolor attribute tracking (avoids GC)
            // Max 8 writes per attribute per frame (sufficient for most effects)
            this.ATTR_MAX_CHANGES = 8;
            this.attrChangeTStates = new Uint32Array(768 * this.ATTR_MAX_CHANGES);
            this.attrChangeValues = new Uint8Array(768 * this.ATTR_MAX_CHANGES);
            this.attrChangeCount = new Uint8Array(768);
            this.attrInitial = new Uint8Array(768);

            // ULAplus palette change tracking for raster effects (HAM256, etc.)
            // Track palette writes with T-states to apply per-scanline
            this.PALETTE_MAX_CHANGES = 1024;  // Max palette writes per frame (HAM256 does 768)
            this.paletteChanges = [];        // Array of {tState, reg, value}
            this.paletteInitial = new Uint8Array(64);  // Palette state at frame start
            this.paletteInitial32 = new Uint32Array(64);  // Palette32 state at frame start
            this.paletteTempLine = new Uint32Array(64);  // Temp palette for per-scanline rendering
            this.hadPaletteChanges = false;
            this.paletteUniqueCount = 0;  // Count of unique entries changed this frame
            this._paletteEntrySeen = new Uint8Array(64);  // Track which entries changed
            this._debugPaletteCount = 0;
            this.debugPalette = false;  // Set to true to enable palette debug logging
            this.cpu = null;  // CPU reference for debug (set by spectrum.js)

            // Keyboard mapping: e.code → [row, bit]
            // Uses physical key positions - works with any keyboard layout
            // Ctrl = Caps Shift, Alt = Symbol Shift
            // PC Shift is free for regular shifted characters (!@#$%^&*etc)
            this.keyMap = {
                // Row 0: Caps Shift, Z, X, C, V
                'ControlLeft': [0, 0], 'ControlRight': [0, 0],
                'KeyZ': [0, 1], 'KeyX': [0, 2], 'KeyC': [0, 3], 'KeyV': [0, 4],
                // Row 1: A, S, D, F, G
                'KeyA': [1, 0], 'KeyS': [1, 1], 'KeyD': [1, 2], 'KeyF': [1, 3], 'KeyG': [1, 4],
                // Row 2: Q, W, E, R, T
                'KeyQ': [2, 0], 'KeyW': [2, 1], 'KeyE': [2, 2], 'KeyR': [2, 3], 'KeyT': [2, 4],
                // Row 3: 1, 2, 3, 4, 5
                'Digit1': [3, 0], 'Digit2': [3, 1], 'Digit3': [3, 2], 'Digit4': [3, 3], 'Digit5': [3, 4],
                // Row 4: 0, 9, 8, 7, 6
                'Digit0': [4, 0], 'Digit9': [4, 1], 'Digit8': [4, 2], 'Digit7': [4, 3], 'Digit6': [4, 4],
                // Row 5: P, O, I, U, Y
                'KeyP': [5, 0], 'KeyO': [5, 1], 'KeyI': [5, 2], 'KeyU': [5, 3], 'KeyY': [5, 4],
                // Row 6: Enter, L, K, J, H
                'Enter': [6, 0], 'KeyL': [6, 1], 'KeyK': [6, 2], 'KeyJ': [6, 3], 'KeyH': [6, 4],
                // Row 7: Space, Symbol Shift, M, N, B
                'Space': [7, 0], 'AltLeft': [7, 1], 'AltRight': [7, 1],
                'KeyM': [7, 2], 'KeyN': [7, 3], 'KeyB': [7, 4],
                // Compound keys (Caps Shift + key)
                'Backspace': [[0, 0], [4, 0]],    // Caps + 0 = Delete
                'ArrowLeft': [[0, 0], [3, 4]],    // Caps + 5
                'ArrowDown': [[0, 0], [4, 4]],    // Caps + 6
                'ArrowUp': [[0, 0], [4, 3]],      // Caps + 7
                'ArrowRight': [[0, 0], [4, 2]],   // Caps + 8
                // Punctuation keys (Symbol Shift + key)
                'Period': [[7, 1], [7, 2]],       // Symbol + M = .
                'Comma': [[7, 1], [7, 3]],        // Symbol + N = ,
                'Semicolon': [[7, 1], [5, 1]],    // Symbol + O = ;
                'Quote': [[7, 1], [5, 0]],        // Symbol + P = "
                'Slash': [[7, 1], [0, 4]],        // Symbol + V = /
                'Minus': [[7, 1], [6, 3]],        // Symbol + J = -
                'Equal': [[7, 1], [6, 1]],        // Symbol + L = =
                'IntlHash': [[7, 1], [3, 2]],     // Symbol + 3 = # (UK keyboards)
                // Extended mode keys (Caps Shift + Symbol Shift + key)
                'Backslash': [[0, 0], [7, 1], [1, 2]],    // Caps + Symbol + D = \
                'IntlBackslash': [[0, 0], [7, 1], [1, 2]], // Caps + Symbol + D = \ (ISO keyboards)
                'BracketLeft': [[0, 0], [7, 1], [5, 4]],  // Caps + Symbol + Y = [
                'BracketRight': [[0, 0], [7, 1], [5, 3]], // Caps + Symbol + U = ]
                'Backquote': [[0, 0], [7, 1], [1, 0]]     // Caps + Symbol + A = ~
            };
        }

        // Update border dimensions based on current preset and machine type
        updateBorderDimensions() {
            let sizes;
            if (this.borderPreset === 'full') {
                sizes = this.FULL_BORDER_SIZES[this.machineType];
            } else if (this.borderPreset === 'normal') {
                sizes = this.NORMAL_BORDER_SIZES[this.machineType];
            } else {
                sizes = this.BORDER_PRESETS[this.borderPreset] || this.FULL_BORDER_SIZES[this.machineType];
            }

            this.BORDER_TOP = sizes.top;
            this.BORDER_BOTTOM = sizes.bottom;
            this.BORDER_LEFT = sizes.left;
            this.BORDER_RIGHT = sizes.right;
            this.TOTAL_WIDTH = this.SCREEN_WIDTH + this.BORDER_LEFT + this.BORDER_RIGHT;
            this.TOTAL_HEIGHT = this.SCREEN_HEIGHT + this.BORDER_TOP + this.BORDER_BOTTOM;

            // Reallocate framebuffer for new dimensions
            this.frameBuffer = new Uint8ClampedArray(this.TOTAL_WIDTH * this.TOTAL_HEIGHT * 4);
            this.frameBuffer32 = new Uint32Array(this.frameBuffer.buffer);
        }

        // Set border preset
        setBorderPreset(preset) {
            if (!this.BORDER_PRESETS.hasOwnProperty(preset)) {
                preset = 'full';  // Default to full if invalid
            }
            if (this.borderPreset !== preset) {
                this.borderPreset = preset;
                // Update fullBorderMode for backwards compatibility
                this.fullBorderMode = (preset === 'full');
                this.updateBorderDimensions();
                this.calculateLineTimes();
                return true; // Dimensions changed, caller should resize canvas
            }
            return false;
        }

        // Toggle full border mode (backwards compatibility)
        setFullBorder(enabled) {
            return this.setBorderPreset(enabled ? 'full' : 'normal');
        }

        // Pre-compute 32-bit packed RGBA values for faster rendering
        updatePalette32() {
            this.palette32 = new Uint32Array(16);

            // Detect system endianness
            const testBuffer = new ArrayBuffer(4);
            const testView8 = new Uint8Array(testBuffer);
            const testView32 = new Uint32Array(testBuffer);
            testView32[0] = 0x01020304;
            // Little-endian: bytes are [4, 3, 2, 1]
            // Big-endian: bytes are [1, 2, 3, 4]
            const isLittleEndian = (testView8[0] === 0x04);

            for (let i = 0; i < 16; i++) {
                const c = this.palette[i];
                if (isLittleEndian) {
                    // Little-endian: pack as ABGR so bytes in memory are RGBA
                    this.palette32[i] = (c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
                } else {
                    // Big-endian: pack as RGBA directly
                    this.palette32[i] = (c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3];
                }
            }
        }

        // Initialize ULAplus palette to match standard Spectrum colors
        // ULAplus uses GRB 332 format: G2G1G0 R2R1R0 B1B0
        initULAplusPalette() {
            // Convert standard 16-color palette to ULAplus format for 4 CLUTs
            // CLUT 0-3 each have 16 entries, but we initialize all 64 to defaults
            const stdColors = [
                // Normal colors (CLUT entries for non-bright)
                0x00, 0x02, 0x18, 0x1a, 0xc0, 0xc2, 0xd8, 0xda,
                // Bright colors
                0x00, 0x03, 0x1c, 0x1f, 0xe0, 0xe3, 0xfc, 0xff
            ];
            // Fill all 4 CLUTs with the same standard colors initially
            for (let clut = 0; clut < 4; clut++) {
                for (let i = 0; i < 16; i++) {
                    this.ulaplus.palette[clut * 16 + i] = stdColors[i];
                }
            }
            this.updateULAplusPalette32();
        }

        // Convert GRB 332 to RGBA and update 32-bit palette
        updateULAplusPalette32() {
            // Detect system endianness
            const testBuffer = new ArrayBuffer(4);
            const testView8 = new Uint8Array(testBuffer);
            const testView32 = new Uint32Array(testBuffer);
            testView32[0] = 0x01020304;
            const isLittleEndian = (testView8[0] === 0x04);

            for (let i = 0; i < 64; i++) {
                const grb = this.ulaplus.palette[i];
                // GRB 332: G2G1G0 R2R1R0 B1B0
                const g3 = (grb >> 5) & 0x07;  // 3 bits green
                const r3 = (grb >> 2) & 0x07;  // 3 bits red
                const b2 = grb & 0x03;         // 2 bits blue
                // Expand to 8 bits: 3-bit colors use top 3 bits + replicate
                // 2-bit blue uses top 2 bits + replicate
                const r = (r3 << 5) | (r3 << 2) | (r3 >> 1);
                const g = (g3 << 5) | (g3 << 2) | (g3 >> 1);
                const b = (b2 << 6) | (b2 << 4) | (b2 << 2) | b2;

                if (isLittleEndian) {
                    this.ulaplus.palette32[i] = (0xff << 24) | (b << 16) | (g << 8) | r;
                } else {
                    this.ulaplus.palette32[i] = (r << 24) | (g << 16) | (b << 8) | 0xff;
                }
            }
        }

        // ULAplus register write (port $BF3B)
        ulaplusWriteRegister(val) {
            this.ulaplus.register = val & 0x7f;  // 7-bit register number
        }

        // ULAplus data write (port $FF3B)
        // tStates parameter for tracking raster palette changes
        ulaplusWriteData(val, tStates) {
            const reg = this.ulaplus.register;
            if (reg < 64) {
                // Palette entry (0-63)
                // Track change for raster effects if T-states provided
                if (tStates !== undefined && this.paletteChanges && this.paletteChanges.length < this.PALETTE_MAX_CHANGES) {
                    this.paletteChanges.push({tState: tStates, reg: reg, value: val});
                    this.hadPaletteChanges = true;
                    // Track unique entries for pattern detection
                    if (!this._paletteEntrySeen[reg]) {
                        this._paletteEntrySeen[reg] = 1;
                        this.paletteUniqueCount++;
                    }
                }

                // If writing to entry 8 (border color in ULAplus mode), trigger border rendering
                // This ensures border stripes work for demos like ULAplusDemo
                if (reg === 8 && this.ulaplus.paletteEnabled && this.beamRendering && tStates !== undefined) {
                    // Render border up to this point with OLD color, then update palette
                    this.renderBorderUpToT(tStates);
                }

                this.ulaplus.palette[reg] = val;
                this.ulaplus.paletteModified = true;
                this.updateULAplusPalette32();
            } else if (reg === 64) {
                // Mode register: bit 0 = palette enabled
                this.ulaplus.paletteEnabled = (val & 0x01) !== 0;
            }
        }

        // ULAplus data read (port $FF3B)
        ulaplusReadData() {
            const reg = this.ulaplus.register;
            if (reg < 64) {
                return this.ulaplus.palette[reg];
            } else if (reg === 64) {
                return this.ulaplus.paletteEnabled ? 0x01 : 0x00;
            }
            return 0xff;
        }

        // Get ULAplus color for attribute byte
        // attr format: F B B B P P P I (Flash, Background 3-bit, Paper/Ink CLUT, Ink)
        // In ULAplus mode, attribute selects from 4 CLUTs:
        // CLUT = (attr >> 6) & 3 for bright/flash bits reinterpreted
        // Ink = CLUT * 16 + (attr & 7)
        // Paper = CLUT * 16 + 8 + ((attr >> 3) & 7)
        getULAplusColors(attr) {
            // CLUT selection from bits 7,6 (flash, bright)
            const clut = ((attr >> 6) & 0x03) * 16;
            const ink = clut + (attr & 0x07);
            const paper = clut + 8 + ((attr >> 3) & 0x07);
            return { ink: this.ulaplus.palette32[ink], paper: this.ulaplus.palette32[paper] };
        }

        // Reset ULAplus state
        resetULAplus() {
            this.ulaplus.paletteEnabled = false;
            this.ulaplus.paletteModified = false;
            this.ulaplus.register = 0;
            this.initULAplusPalette();
            // Reset debug counter for new file loads
            this._paletteDebugFrames = 0;
        }

        // Build palette32 for a specific T-state by applying all changes up to that point
        // Used for raster effects like HAM256 that change palette mid-frame
        getPalette32AtTState(tState, outPalette32) {
            // Start from initial palette captured at frame start
            outPalette32.set(this.paletteInitial32);

            // Apply all changes that happened before or at the given T-state
            const changes = this.paletteChanges;
            let appliedCount = 0;
            for (let i = 0; i < changes.length; i++) {
                const change = changes[i];
                if (change.tState <= tState) {
                    // Convert single GRB332 value to RGBA and update
                    const grb = change.value;
                    const g3 = (grb >> 5) & 0x07;
                    const r3 = (grb >> 2) & 0x07;
                    const b2 = grb & 0x03;
                    const r = (r3 << 5) | (r3 << 2) | (r3 >> 1);
                    const g = (g3 << 5) | (g3 << 2) | (g3 >> 1);
                    const b = (b2 << 6) | (b2 << 4) | (b2 << 2) | b2;
                    // Assume little-endian (most common)
                    outPalette32[change.reg] = (0xff << 24) | (b << 16) | (g << 8) | r;
                    appliedCount++;
                }
            }

            // Debug logging (enable via spectrum.ula.debugPalette = true)
            if (this.debugPalette && this._debugPaletteCount < 10) {
                console.log(`[Palette] tState=${tState}, total=${changes.length}, applied=${appliedCount}`);
                if (changes.length > 0) {
                    console.log(`  First change: tState=${changes[0].tState}, Last change: tState=${changes[changes.length-1].tState}`);
                }
                this._debugPaletteCount++;
            }
        }

        // Reset debug counter at frame start
        _resetPaletteDebug() {
            this._debugPaletteCount = 0;
        }

        // Build palette32 for a specific 16-line group by applying changes by index
        // HAM256 writes entries 0-63 twelve times (once per group), so for group G
        // we apply the first (G+1)*64 changes to get the correct palette state.
        // This is more accurate than T-state based lookup for raster effects.
        getPalette32ForGroup(group, outPalette32) {
            // Start from initial palette
            outPalette32.set(this.paletteInitial32);

            const changes = this.paletteChanges;
            if (changes.length === 0) return;

            // For group G, we need the state after (G+1)*64 writes
            // e.g., group 0 = first 64 writes, group 1 = first 128 writes, etc.
            const maxIndex = Math.min((group + 1) * 64, changes.length);

            for (let i = 0; i < maxIndex; i++) {
                const change = changes[i];
                // Convert single GRB332 value to RGBA and update
                const grb = change.value;
                const g3 = (grb >> 5) & 0x07;
                const r3 = (grb >> 2) & 0x07;
                const b2 = grb & 0x03;
                const r = (r3 << 5) | (r3 << 2) | (r3 >> 1);
                const g = (g3 << 5) | (g3 << 2) | (g3 >> 1);
                const b = (b2 << 6) | (b2 << 4) | (b2 << 2) | b2;
                outPalette32[change.reg] = (0xff << 24) | (b << 16) | (g << 8) | r;
            }
        }

        // Calculate T-state when each visible line's left border starts
        // Based on Fuse's line_times[] approach for pixel-perfect border timing
        // IMPORTANT: Always uses FULL border dimensions for timing calculations
        // regardless of display mode (full/normal border is just viewport cropping)
        calculateLineTimes() {
            // Always use full border dimensions for internal timing calculations
            const fullSizes = this.FULL_BORDER_SIZES[this.machineType];
            const fullBorderTop = fullSizes.top;
            const fullBorderLeft = fullSizes.left;  // 48 pixels = 24 T-states

            // T-state when the first paper line's left border starts
            // TOP_LEFT_PIXEL_TSTATE is when PAPER starts, left border is LEFT_BORDER_TSTATES earlier
            const firstPaperLineBorderStart = this.TOP_LEFT_PIXEL_TSTATE - this.LEFT_BORDER_TSTATES;

            // T-state when first FULL visible line starts (FULL_BORDER_TOP lines before first paper line)
            const fullLineTimesBase = firstPaperLineBorderStart - (fullBorderTop * this.TSTATES_PER_LINE);

            // Now adjust for current display mode's viewport offset
            // When in cropped mode, we skip some top lines and left border pixels
            const topCropLines = fullBorderTop - this.BORDER_TOP;
            const leftCropTstates = (fullBorderLeft - this.BORDER_LEFT) / 2;

            // LINE_TIMES_BASE is the T-state when the DISPLAYED top-left pixel starts
            this.LINE_TIMES_BASE = fullLineTimesBase + (topCropLines * this.TSTATES_PER_LINE) + leftCropTstates;

            // Apply machine-specific timing correction
            // These values are calibrated against hardware timing tests
            this.LINE_TIMES_BASE -= this.TIMING_ADJUST || 0;

            // Apply late timing offset if enabled (1T shift for warmed ULA)
            // Base values are for EARLY timing (cold ULA)
            // Late timing (warm ULA) = display starts 1T later = ADD 1 to TOP_LEFT_PIXEL_TSTATE
            // This shifts border LEFT (earlier in relative frame position)
            // Only applies to Ferranti ULA machines (48K, 128K), not Pentagon
            if (this.lateTimings && this.profile.ulaProfile !== 'pentagon') {
                this.LINE_TIMES_BASE += 1;
            }

            // Pre-compute line start T-states lookup table for faster rendering
            this.precomputeLineTimesTable();
        }

        // Pre-compute lookup table for line start T-states
        precomputeLineTimesTable() {
            const maxLines = this.TOTAL_HEIGHT;
            this.lineStartTstates = new Int32Array(maxLines);

            for (let visY = 0; visY < maxLines; visY++) {
                // Use the full calculation method
                this.lineStartTstates[visY] = this._calculateLineStartTstateFull(visY);
            }
        }

        // Fast lookup for line start T-states
        calculateLineStartTstate(visY) {
            // Use pre-computed lookup table if available
            if (this.lineStartTstates && visY >= 0 && visY < this.lineStartTstates.length) {
                return this.lineStartTstates[visY];
            }
            // Fallback to full calculation
            return this._calculateLineStartTstateFull(visY);
        }

        // Full calculation (used for pre-computing and fallback)
        // For 128K, uses region-based timing with different T-states per line for each region
        // For other machines, uses simple linear calculation
        _calculateLineStartTstateFull(visY) {
            if (this.REGION_TIMING) {
                // Region-based timing (128K)
                const rt = this.REGION_TIMING;

                // Simple 3-region model: top, screen, bottom
                if (rt.screen && !rt.screen1) {
                    if (visY < this.BORDER_TOP) {
                        // Top border region
                        const offset = rt.top.offset || 0;
                        return this.LINE_TIMES_BASE + (visY * rt.top.tstatesPerLine) + offset;
                    } else if (visY < this.BORDER_TOP + this.SCREEN_HEIGHT) {
                        // Screen region
                        const topTstates = this.BORDER_TOP * rt.top.tstatesPerLine;
                        const screenY = visY - this.BORDER_TOP;
                        const offset = rt.screen.offset || 0;
                        return this.LINE_TIMES_BASE + topTstates + (screenY * rt.screen.tstatesPerLine) + offset;
                    } else {
                        // Bottom border region
                        const topTstates = this.BORDER_TOP * rt.top.tstatesPerLine;
                        const screenTstates = this.SCREEN_HEIGHT * rt.screen.tstatesPerLine;
                        const bottomY = visY - this.BORDER_TOP - this.SCREEN_HEIGHT;
                        const offset = rt.bottom.offset || 0;
                        return this.LINE_TIMES_BASE + topTstates + screenTstates + (bottomY * rt.bottom.tstatesPerLine) + offset;
                    }
                }

                // Legacy multi-region model (screen1, screen2, screen3, screen4)
                const screen1Lines = rt.screen1 ? rt.screen1.lines : 0;
                const screen2Lines = rt.screen2 ? rt.screen2.lines : 0;
                const screen3Lines = rt.screen3 ? rt.screen3.lines : 0;
                const screen4Lines = rt.screen4 ? rt.screen4.lines : 0;

                // Map visY to region
                if (visY < this.BORDER_TOP) {
                    // Top border region
                    const offset = rt.top.offset || 0;
                    return this.LINE_TIMES_BASE + (visY * rt.top.tstatesPerLine) + offset;
                } else if (visY < this.BORDER_TOP + screen1Lines) {
                    // Screen1 region
                    const topTstates = this.BORDER_TOP * rt.top.tstatesPerLine;
                    const screenY = visY - this.BORDER_TOP;
                    const offset = rt.screen1.offset || 0;
                    return this.LINE_TIMES_BASE + topTstates + (screenY * rt.screen1.tstatesPerLine) + offset;
                } else if (visY < this.BORDER_TOP + screen1Lines + screen2Lines) {
                    // Screen2 region
                    const topTstates = this.BORDER_TOP * rt.top.tstatesPerLine;
                    const screen1Tstates = screen1Lines * rt.screen1.tstatesPerLine;
                    const screenY = visY - this.BORDER_TOP - screen1Lines;
                    const offset = rt.screen2.offset || 0;
                    return this.LINE_TIMES_BASE + topTstates + screen1Tstates + (screenY * rt.screen2.tstatesPerLine) + offset;
                } else if (visY < this.BORDER_TOP + screen1Lines + screen2Lines + screen3Lines) {
                    // Screen3 region
                    const topTstates = this.BORDER_TOP * rt.top.tstatesPerLine;
                    const screen1Tstates = screen1Lines * rt.screen1.tstatesPerLine;
                    const screen2Tstates = screen2Lines * rt.screen2.tstatesPerLine;
                    const screenY = visY - this.BORDER_TOP - screen1Lines - screen2Lines;
                    const offset = rt.screen3.offset || 0;
                    return this.LINE_TIMES_BASE + topTstates + screen1Tstates + screen2Tstates + (screenY * rt.screen3.tstatesPerLine) + offset;
                } else if (visY < this.BORDER_TOP + screen1Lines + screen2Lines + screen3Lines + screen4Lines) {
                    // Screen4 region
                    const topTstates = this.BORDER_TOP * rt.top.tstatesPerLine;
                    const screen1Tstates = screen1Lines * rt.screen1.tstatesPerLine;
                    const screen2Tstates = screen2Lines * rt.screen2.tstatesPerLine;
                    const screen3Tstates = screen3Lines * rt.screen3.tstatesPerLine;
                    const screenY = visY - this.BORDER_TOP - screen1Lines - screen2Lines - screen3Lines;
                    const offset = rt.screen4.offset || 0;
                    return this.LINE_TIMES_BASE + topTstates + screen1Tstates + screen2Tstates + screen3Tstates + (screenY * rt.screen4.tstatesPerLine) + offset;
                } else {
                    // Bottom border region
                    const topTstates = this.BORDER_TOP * rt.top.tstatesPerLine;
                    const screen1Tstates = screen1Lines * rt.screen1.tstatesPerLine;
                    const screen2Tstates = screen2Lines * rt.screen2.tstatesPerLine;
                    const screen3Tstates = screen3Lines * (rt.screen3 ? rt.screen3.tstatesPerLine : 0);
                    const screen4Tstates = screen4Lines * (rt.screen4 ? rt.screen4.tstatesPerLine : 0);
                    const bottomY = visY - this.BORDER_TOP - this.SCREEN_HEIGHT;
                    const offset = rt.bottom.offset || 0;
                    return this.LINE_TIMES_BASE + topTstates + screen1Tstates + screen2Tstates + screen3Tstates + screen4Tstates + (bottomY * rt.bottom.tstatesPerLine) + offset;
                }
            } else {
                // Simple linear timing (48K, Pentagon, 128K without REGION_TIMING)
                let tstate = this.LINE_TIMES_BASE + (visY * this.TSTATES_PER_LINE);

                // Apply screen line drift correction for 128K
                if (this.SCREEN_LINE_DRIFT && visY >= this.BORDER_TOP) {
                    const screenLine = visY - this.BORDER_TOP;
                    tstate += screenLine * this.SCREEN_LINE_DRIFT;
                }

                return tstate;
            }
        }

        reset() {
            this.borderColor = 7;
            this.earOutput = 0;
            this.micOutput = 0;
            this.flashState = false;
            this.flashCounter = 0;
            this.frameCounter = 0;
            this.lastRenderedLine = -1;
            this.lastRenderedBeamT = 0;
            this.keyboardState.fill(0xff);
        }

        // Convert frame T-state to visible pixel coordinates
        // Returns {visY, x, visible} where visible is false if outside visible area
        // For beam rendering: this tells us where the ULA beam is at a given T-state
        frameT2Pixel(frameT) {
            // Calculate position relative to first visible pixel
            const relT = frameT - this.LINE_TIMES_BASE;

            // Calculate visible line and position within line
            const visY = Math.floor(relT / this.TSTATES_PER_LINE);
            const lineT = relT - (visY * this.TSTATES_PER_LINE);

            // Convert T-state within line to pixel position (2 pixels per T-state)
            const x = Math.floor(lineT * 2);

            // Check if within visible area
            const visible = visY >= 0 && visY < this.TOTAL_HEIGHT && x >= 0 && x < this.TOTAL_WIDTH;

            return { visY, x, visible, lineT };
        }

        // Get border color as 32-bit RGBA value
        // When ULAplus paletteEnabled=true, uses palette entry 8 (PAPER 0 from CLUT 0)
        // Otherwise uses standard palette with borderColor index
        getBorderColor32() {
            if (this.ulaplus.enabled && this.ulaplus.paletteEnabled) {
                return this.ulaplus.palette32[8];  // PAPER 0 from CLUT 0
            }
            return this.palette32[this.borderColor];
        }

        // Get border color at specific T-state (for raster effects)
        // Looks up palette entry 8 at the given T-state if ULAplus is active
        getBorderColor32AtTState(tState) {
            if (this.ulaplus.enabled && this.ulaplus.paletteEnabled && this.hadPaletteChanges) {
                // Build palette at this T-state and return entry 8
                this.getPalette32AtTState(tState, this.paletteTempLine);
                return this.paletteTempLine[8];
            }
            return this.getBorderColor32();
        }

        // Render border pixels from lastRenderedBeamT to toT
        // This is called when border color changes to fill in pixels with the current color
        // Optimized: render line by line for efficiency, using 32-bit writes for consistency
        renderBorderUpToT(toT) {
            if (!this.beamRendering) return;

            const fromT = this.lastRenderedBeamT;
            if (toT <= fromT) return;  // Nothing to render

            // Use ULAplus palette entry 8 when active, otherwise standard palette
            const color32 = this.getBorderColor32();
            const fb32 = this.frameBuffer32;
            const totalWidth = this.TOTAL_WIDTH;
            const tstatesPerLine = this.TSTATES_PER_LINE;
            // Apply border timing offset: shifts border rendering down by BORDER_TIMING_OFFSET T-states
            // This compensates for the difference between paper timing and border timing
            const borderOffset = this.BORDER_TIMING_OFFSET || 0;
            const lineBase = this.LINE_TIMES_BASE - borderOffset;

            // Vertical-only drift correction: shifts later lines down without affecting horizontal position
            // This compensates for ~2-3 lines of accumulated timing drift from top to bottom of screen
            // Drift factor: how many extra lines to add per line (e.g., 0.012 = ~2.3 lines over 192 paper lines)
            const verticalDrift = this.VERTICAL_LINE_DRIFT || 0;

            const fromRelT = fromT - lineBase;
            const toRelT = toT - lineBase;

            // Calculate line and X position using standard T-states per line
            // This keeps horizontal position accurate
            const fromLineRaw = Math.floor(fromRelT / tstatesPerLine);
            const fromLineT = fromRelT - (fromLineRaw * tstatesPerLine);
            const fromX = Math.floor(fromLineT * 2);

            // Apply vertical-only drift: shift line number down for later lines
            const fromLine = Math.floor(fromLineRaw + fromLineRaw * verticalDrift);

            const toLineRaw = Math.floor(toRelT / tstatesPerLine);
            const toLineT = toRelT - (toLineRaw * tstatesPerLine);
            const toX = Math.floor(toLineT * 2);

            const toLine = Math.floor(toLineRaw + toLineRaw * verticalDrift);

            // Render lines from fromLine to toLine
            for (let line = fromLine; line <= toLine; line++) {
                if (line < 0 || line >= this.TOTAL_HEIGHT) continue;

                // Calculate x range for this line
                const startX = (line === fromLine) ? Math.max(0, fromX) : 0;
                const endX = (line === toLine) ? Math.min(this.TOTAL_WIDTH, toX) : this.TOTAL_WIDTH;

                if (startX >= endX) continue;

                // Determine if this is a border-only line or has paper
                const isTopBorder = line < this.BORDER_TOP;
                const isBottomBorder = line >= this.BORDER_TOP + this.SCREEN_HEIGHT;

                if (isTopBorder || isBottomBorder) {
                    // Pure border line - render all pixels using 32-bit writes
                    const rowOffset = line * totalWidth;
                    for (let x = startX; x < endX; x++) {
                        fb32[rowOffset + x] = color32;
                    }
                } else {
                    // Line with paper - render only border regions
                    const paperStart = this.BORDER_LEFT;
                    const paperEnd = this.BORDER_LEFT + this.SCREEN_WIDTH;
                    const rowOffset = line * totalWidth;

                    // Left border
                    if (startX < paperStart) {
                        const leftEnd = Math.min(endX, paperStart);
                        for (let x = startX; x < leftEnd; x++) {
                            fb32[rowOffset + x] = color32;
                        }
                    }

                    // Right border
                    if (endX > paperEnd) {
                        const rightStart = Math.max(startX, paperEnd);
                        for (let x = rightStart; x < endX; x++) {
                            fb32[rowOffset + x] = color32;
                        }
                    }
                }
            }

            this.lastRenderedBeamT = toT;
        }

        // Complete border rendering for end of frame
        // Renders from lastRenderedBeamT to end of visible area
        finishBorderRendering() {
            if (!this.beamRendering) return;

            // Calculate T-state at end of visible area
            const endT = this.LINE_TIMES_BASE + (this.TOTAL_HEIGHT * this.TSTATES_PER_LINE);
            this.renderBorderUpToT(endT);
        }

        // Called at start of each frame
        startFrame() {
            // Track if previous frame had screen bank changes (for scroll17-style effects)
            // If so, we need to defer paper rendering to endFrame when all changes are known
            this.hadScreenBankChanges = this.screenBankChanges && this.screenBankChanges.length > 1;
            // Count changes for distinguishing scroll17 from simple double-buffering
            this.previousScreenBankChangeCount = this.screenBankChanges ? this.screenBankChanges.length : 0;

            this.lastRenderedLine = -1;

            // Initialize beam tracking for per-scanline rendering
            // Start rendering from the first visible pixel's T-state
            // Account for BORDER_TIMING_OFFSET so top lines get rendered
            const borderOffset = this.BORDER_TIMING_OFFSET || 0;
            this.lastRenderedBeamT = this.LINE_TIMES_BASE - borderOffset;

            // Initialize border at LINE_TIMES_BASE to cover all visible lines
            // (LINE_TIMES_BASE can be negative when first visible line is before T=0)
            const initialT = Math.min(0, this.LINE_TIMES_BASE - 100);
            this.borderChanges = [{tState: initialT, color: this.borderColor}];
            // Initialize screen bank from memory's current state
            const initialBank = this.memory.screenBank || 5;
            this.screenBankChanges = [{tState: 0, bank: initialBank}];

            // Only defer paper rendering for scroll17-style effects (many rapid bank
            // alternations per frame). Simple double-buffering (1 swap = 2 entries) is
            // handled correctly by normal scanline rendering which reads the current bank
            // at each line's render time. Deferred rendering reads at end-of-frame, which
            // is wrong for double-buffering because the back buffer has been cleared/redrawn
            // by then, causing flicker on the pre-swap scanlines.
            this.deferPaperRendering = this.previousScreenBankChangeCount > 2;

            // Multicolor tracking: capture initial attribute values at frame start
            // This allows getAttrAt to return correct values for columns where writes
            // happen AFTER the ULA scan time (the "initial" value is what the ULA sees)
            this.hadAttrChanges = false;
            // Use object-based tracking (old implementation that worked with Shock)
            this.attrChanges = {};
            // Capture initial attrs NOW, before any writes happen this frame
            const screen = this.memory.getScreenBase();
            if (!this.attrInitial) {
                this.attrInitial = new Uint8Array(768);
            }
            this.attrInitial.set(screen.ram.subarray(0x1800, 0x1B00));

            // ULAplus palette tracking: capture initial palette and clear changes
            // This enables raster effects like HAM256 that change palette mid-frame
            this.paletteChanges = [];
            this.hadPaletteChanges = false;
            this.paletteUniqueCount = 0;
            this._paletteEntrySeen.fill(0);
            this._resetPaletteDebug();
            // Capture initial palette state
            if (!this.paletteInitial) {
                this.paletteInitial = new Uint8Array(64);
            }
            this.paletteInitial.set(this.ulaplus.palette);
            // Also capture initial 32-bit palette for fast rendering
            if (!this.paletteInitial32) {
                this.paletteInitial32 = new Uint32Array(64);
            }
            this.paletteInitial32.set(this.ulaplus.palette32);

            // Debug: log palette changes info once per session
            if (this._paletteDebugFrames === undefined) {
                this._paletteDebugFrames = 0;
            }
        }

        // Called at end of frame to log palette debug info
        endFramePaletteDebug() {
            // Only start counting frames once paletteEnabled is true (demo has activated ULAplus)
            if (!this.ulaplus.enabled || !this.ulaplus.paletteEnabled) {
                return;
            }

            if (this._paletteDebugFrames < 10) {
                this._paletteDebugFrames++;
            }
        }

        // Called when attribute memory is written (for multicolor tracking)
        // attrOffset is 0-767 (relative to 0x5800)
        setAttrAt(attrOffset, value, tStates) {
            if (!this.attrChanges[attrOffset]) {
                this.attrChanges[attrOffset] = [];
            }
            // Adjust for CPU timing: tStates is at instruction START (before timing added)
            // For PUSH instructions (used by Nirvana+), actual memory write happens ~5-8 T-states later
            // For LD (HL),A type instructions, write happens ~4 T-states after instruction start
            // mcWriteAdjust is ADDED to compensate for this
            const writeAdjust = this.mcWriteAdjust !== undefined ? this.mcWriteAdjust : 5;
            this.attrChanges[attrOffset].push({tState: tStates + writeAdjust, value: value});
        }

        // Get attribute value at a specific T-state
        // Returns the attribute value as it would be seen by the ULA at the given T-state
        getAttrAt(attrOffset, tState, currentValue) {
            // Start with initial value from frame start
            let value = this.attrInitial ? this.attrInitial[attrOffset] : currentValue;
            const initialValue = value;

            // Compare write times against the display T-state
            // mcLookupTolerance allows fine-tuning if needed (default 0)
            const tolerance = this.mcLookupTolerance !== undefined ? this.mcLookupTolerance : 0;
            const effectiveTstate = tState + tolerance;

            const changes = this.attrChanges[attrOffset];
            if (changes) {
                // Ensure changes are sorted by T-state (should be, but verify)
                if (changes.length > 1 && !changes._sorted) {
                    for (let i = 1; i < changes.length; i++) {
                        if (changes[i].tState < changes[i-1].tState) {
                            changes.sort((a, b) => a.tState - b.tState);
                            break;
                        }
                    }
                    changes._sorted = true;
                }
                for (const change of changes) {
                    if (change.tState <= effectiveTstate) {
                        value = change.value;
                    } else {
                        break;
                    }
                }
            }

            // Debug: log multicolor timing (enable via spectrum.ula.debugMulticolor = true)
            // debugMulticolor=true: show col 0-7 for first line only
            // debugMulticolor=2: show col 0 and 16 for multiple lines
            if (this.debugMulticolor) {
                const showThis = (this.debugMulticolor === 2)
                    ? ((attrOffset === 0 || attrOffset === 16) && tState < 16000)
                    : (attrOffset < 8 && tState < 14600);  // First 8 cols, first pixel line only
                if (showThis) {
                    const machType = this.machineType;
                    let appliedWrite = 'initial';
                    if (changes) {
                        for (const change of changes) {
                            if (change.tState <= effectiveTstate) {
                                appliedWrite = `@${change.tState}`;
                            }
                        }
                    }
                    console.log(`[MC-${machType}] col${attrOffset}: T=${tState} val=${value.toString(16)} ${appliedWrite}`);
                }
            }

            return value;
        }

        // Called when border color changes
        // 48K/128K: ULA updates border color once every 4 T-states (8 pixels), borderTimeMask = 0xfc
        // Pentagon: Border color changes every T-state (2 pixels), borderTimeMask = 0xff
        setBorderAt(color, tStates) {
            color = color & 0x07;
            // Pentagon uses no quantization, 48K/128K quantize to 4T boundaries (round DOWN)
            // BORDER_PHASE shifts the quantization phase (like ZXMAK2's c_ulaBorder4Tstage)
            const borderPhase = this.BORDER_PHASE || 0;
            const quantizedTStates = !this.profile.borderQuantization ? tStates : ((tStates & ~3) + borderPhase);
            if (color !== this.borderColor) {
                // Beam rendering: render all border pixels up to this point with the OLD color
                // before changing to the new color
                if (this.beamRendering) {
                    this.renderBorderUpToT(quantizedTStates);
                }

                // Record the change (for fallback/debugging)
                this.borderChanges.push({tState: quantizedTStates, color: color});
                this.borderColor = color;

                // Debug output if enabled (enable via console: spectrum.ula.debugBorderTiming = true)
                if (this.debugBorderTiming || this.debugPaperBoundary) {
                    // Calculate which visible line this change affects (with border offset)
                    const borderOffset = this.BORDER_TIMING_OFFSET || 0;
                    const offsetT = quantizedTStates - (this.LINE_TIMES_BASE - borderOffset);
                    const visY = Math.floor(offsetT / this.TSTATES_PER_LINE);
                    const lineT = offsetT % this.TSTATES_PER_LINE;
                    const pixel = Math.floor(lineT * 2);
                    // Visible line width is TOTAL_WIDTH pixels (176 T-states), rest is horizontal blanking
                    const visibleTstates = this.TOTAL_WIDTH / 2;
                    const inHBlank = lineT >= visibleTstates;

                    // Determine which border region (left/paper/right/hblank)
                    let region = 'hblank';
                    if (!inHBlank) {
                        if (pixel < this.BORDER_LEFT) region = 'left';
                        else if (pixel < this.BORDER_LEFT + this.SCREEN_WIDTH) region = 'paper';
                        else region = 'right';
                    }
                    const status = inHBlank ? `HBlank→line${visY+1}start` : `line${visY}@px${pixel}[${region}]`;

                    // For paper boundary debug, only log around line 24 (first paper line, frame line 64)
                    const isPaperBoundaryLine = visY >= 22 && visY <= 26;
                    if (this.debugBorderTiming || (this.debugPaperBoundary && isPaperBoundaryLine)) {
                        console.log(`[BORDER] color=${color} rawT=${tStates} quantT=${quantizedTStates} → ${status} (leftBorder=0-${this.BORDER_LEFT-1}, paper=${this.BORDER_LEFT}-${this.BORDER_LEFT+this.SCREEN_WIDTH-1}, rightBorder=${this.BORDER_LEFT+this.SCREEN_WIDTH}-${this.TOTAL_WIDTH-1})`);
                    }
                }
            }
        }

        // Called when screen bank changes (for scroll17-style effects)
        setScreenBankAt(bank, tStates) {
            const lastBank = this.screenBankChanges[this.screenBankChanges.length - 1].bank;
            if (bank !== lastBank) {
                this.screenBankChanges.push({tState: tStates, bank: bank});
            }
        }

        // Get screen bank at a specific T-state
        getScreenBankAt(tState) {
            let bank = this.screenBankChanges[0].bank;
            for (const change of this.screenBankChanges) {
                if (change.tState <= tState) {
                    bank = change.bank;
                } else {
                    break;
                }
            }
            return bank;
        }

        // Get border color at a specific T-state
        getBorderColorAt(tState) {
            let color = this.borderChanges[0].color;
            for (const change of this.borderChanges) {
                if (change.tState <= tState) {
                    color = change.color;
                } else {
                    break;
                }
            }
            return color;
        }
        // Called during frame execution to render scanlines up to current T-state
        updateScanline(tStates) {
            // Calculate which line the beam is currently on
            // For multicolor, we render each line at its paper START (T14)
            // so attributes are read before the program changes them for the next line
            
            const tstatesPerLine = this.TSTATES_PER_LINE;
            const paperStart = this.PAPER_START_TSTATE;
            
            // What line are we on?
            const currentLine = Math.floor(tStates / tstatesPerLine);
            const posInLine = tStates % tstatesPerLine;
            
            // Render all lines whose paper area has started
            // Line N's paper starts at T-state: N * tstatesPerLine + paperStart
            let lineToRender = currentLine;
            if (posInLine < paperStart) {
                lineToRender = currentLine - 1;
            }
            
            // Render all lines up to lineToRender that we haven't rendered yet
            while (this.lastRenderedLine < lineToRender) {
                this.lastRenderedLine++;
                if (this.lastRenderedLine < this.LINES_PER_FRAME) {
                    this.renderScanline(this.lastRenderedLine);
                }
            }
        }
        
        // Render a single scanline with pixel-perfect border timing
        // Uses T-state based timing with LINE_TIMES_BASE for accurate positioning
        renderScanline(line) {
            const screen = this.memory.getScreenBase();
            const screenRam = screen.ram;

            // Convert frame line to visible line
            const offset = this.VISIBLE_LINE_OFFSET || 0;
            const firstVisibleLine = this.FIRST_SCREEN_LINE - this.BORDER_TOP + offset;
            const lastVisibleLine = this.FIRST_SCREEN_LINE + this.SCREEN_HEIGHT + this.BORDER_BOTTOM - 1 + offset;

            if (line < firstVisibleLine || line > lastVisibleLine) return;

            const visY = line - firstVisibleLine;
            if (visY < 0 || visY >= this.TOTAL_HEIGHT) return;

            // If beam rendering is active, skip border rendering here - it's handled by setBorderAt/finishBorderRendering
            const skipBorderRendering = this.beamRendering;

            // Ensure borderChanges is sorted (should already be, but verify)
            // This is needed because the startColor loop assumes sorted order
            if (!skipBorderRendering && this.borderChanges.length > 1 && visY === 0) {
                let needsSort = false;
                for (let i = 1; i < this.borderChanges.length; i++) {
                    if (this.borderChanges[i].tState < this.borderChanges[i-1].tState) {
                        needsSort = true;
                        break;
                    }
                }
                if (needsSort) {
                    this.borderChanges.sort((a, b) => a.tState - b.tState);
                }
            }

            // Calculate T-state for this line using region-based timing (128K) or linear (others)
            const lineStartTstate = this.calculateLineStartTstate(visY);

            // T-state range for visible pixels on this line
            // Total visible width = TOTAL_WIDTH pixels = TOTAL_WIDTH/2 T-states
            const lineEndTstate = lineStartTstate + (this.TOTAL_WIDTH / 2);

            // Debug output if enabled (only for first few lines with changes)
            if (this.debugBorderTiming && visY < 5 && this.borderChanges.length > 1) {
                console.log(`[LINE] visY=${visY} line=${line} start=${lineStartTstate} end=${lineEndTstate} changes=${this.borderChanges.length}`);
            }

            // Find border color at the start of this line's visible area
            let startColor = this.borderChanges[0].color;
            for (const change of this.borderChanges) {
                if (change.tState <= lineStartTstate) {
                    startColor = change.color;
                } else {
                    break;
                }
            }

            // Find changes during this line's visible range
            const lineChanges = skipBorderRendering ? [] : this.borderChanges.filter(c =>
                c.tState > lineStartTstate && c.tState <= lineEndTstate
            );

            // Debug: log if changes are found
            if (this.debugBorderTiming && lineChanges.length > 0) {
                console.log(`[LINE] visY=${visY} lineChanges: ${lineChanges.map(c => `T=${c.tState},c=${c.color}`).join(', ')}`);
            }

            // Is this a screen line (with paper) or pure border line?
            const screenLine = line - this.FIRST_SCREEN_LINE;

            // Apply -2 T-state offset only for scroll17-style effects (when screen bank switching is active)
            const borderLineOffset = this.hadScreenBankChanges ? 2 : 0;

            // ULAplus: border uses palette entry 8 when enabled
            const ulaPlusBorder = this.ulaplus.enabled && this.ulaplus.paletteEnabled;

            if (screenLine < 0 || screenLine >= 192) {
                // Pure border line (top/bottom border)
                // Skip if beam rendering is handling border
                if (!skipBorderRendering) {
                    if (lineChanges.length === 0) {
                        // Optimized: fill entire line using 32-bit writes
                        const borderColor32 = ulaPlusBorder ? this.getBorderColor32AtTState(lineStartTstate) : this.palette32[startColor];
                        const rowOffset = visY * this.TOTAL_WIDTH;
                        const fb32 = this.frameBuffer32;
                        for (let x = 0; x < this.TOTAL_WIDTH; x++) {
                            fb32[rowOffset + x] = borderColor32;
                        }
                    } else {
                        this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor, 0, this.TOTAL_WIDTH);
                    }
                }
            } else {
                // Screen line - left border, paper, right border
                const y = screenLine;

                // Left border - skip if beam rendering
                if (!skipBorderRendering) {
                    if (lineChanges.length === 0) {
                        // Optimized: fill left border using 32-bit writes
                        const borderColor32 = ulaPlusBorder ? this.getBorderColor32AtTState(lineStartTstate) : this.palette32[startColor];
                        const rowOffset = visY * this.TOTAL_WIDTH;
                        const fb32 = this.frameBuffer32;
                        for (let x = 0; x < this.BORDER_LEFT; x++) {
                            fb32[rowOffset + x] = borderColor32;
                        }
                    } else {
                        this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor, 0, this.BORDER_LEFT, true);
                    }
                }

                // Paper pixels (or border if borderOnly mode)
                if (this.borderOnly) {
                    // Draw border color instead of paper - skip if beam rendering
                    if (!skipBorderRendering) {
                        if (lineChanges.length === 0) {
                            // Optimized: fill paper area using 32-bit writes
                            const borderColor32 = ulaPlusBorder ? this.getBorderColor32AtTState(lineStartTstate) : this.palette32[startColor];
                            const rowOffset = visY * this.TOTAL_WIDTH;
                            const fb32 = this.frameBuffer32;
                            for (let x = this.BORDER_LEFT; x < this.BORDER_LEFT + this.SCREEN_WIDTH; x++) {
                                fb32[rowOffset + x] = borderColor32;
                            }
                        } else {
                            this.renderBorderPixels(visY, lineStartTstate, lineChanges, startColor,
                                this.BORDER_LEFT, this.BORDER_LEFT + this.SCREEN_WIDTH, true);
                        }
                    }
                } else if (this.deferPaperRendering) {
                    // Skip paper rendering - will be done at endFrame with all screen bank changes known
                    // Just fill with placeholder (will be overwritten at endFrame)
                } else {
                    // Render paper with current memory values
                    const third = Math.floor(y / 64);
                    const lineInThird = y & 0x07;
                    const charRow = Math.floor((y & 0x38) / 8);
                    const pixelAddr = (third << 11) | (lineInThird << 8) | (charRow << 5);
                    const attrAddr = 0x1800 + Math.floor(y / 8) * 32;

                    // Calculate attribute row offset for multicolor tracking
                    const attrRowOffset = Math.floor(y / 8) * 32;

                    // Check if multicolor tracking detected attribute changes
                    if (this.hadAttrChanges) {
                        // Use palette32 for consistency with other rendering paths
                        const fb32 = this.frameBuffer32;
                        const pal32 = this.palette32;
                        const ulaplus = this.ulaplus;
                        const ulaPlusActive = ulaplus.enabled && ulaplus.paletteEnabled;
                        const rowOffset = visY * this.TOTAL_WIDTH + this.BORDER_LEFT;
                        const flashActive = this.flashState;
                        const attrChanges = this.attrChanges;
                        const attrInitial = this.attrInitial;

                        // Accurate multicolor: use per-write tracking with T-state timing
                        const paperStartTstate = lineStartTstate + (this.BORDER_LEFT / 2);

                        // Use per-scanline palette if palette changes detected (ULAplus raster effects)
                        // Few unique entries (<=8): T-state based (per-scanline effects like ULAplusDemo)
                        // Many unique entries (>8): group-based (HAM256 writes 64 entries per group)
                        const paperLine = visY - this.BORDER_TOP;
                        const group = Math.floor(paperLine / 16);
                        let ulaPal32;
                        if (ulaPlusActive && this.hadPaletteChanges) {
                            if (this.paletteUniqueCount <= 8) {
                                // Few entries changed - use T-state based (matches border timing)
                                this.getPalette32AtTState(lineStartTstate, this.paletteTempLine);
                            } else {
                                // Many entries changed - use group-based (HAM256 pattern)
                                this.getPalette32ForGroup(group, this.paletteTempLine);
                            }
                            ulaPal32 = this.paletteTempLine;
                        } else {
                            ulaPal32 = ulaplus.palette32;
                        }
                        const machineOffset = is128kCompat(this.machineType) ? (this.mc128kOffset || 0) : 0;

                        for (let col = 0; col < 32; col++) {
                            const pixelByte = screenRam[pixelAddr + col];
                            const attrOffset = attrRowOffset + col;
                            const currentAttr = screenRam[attrAddr + col];

                            // Fast path: if no changes for this column, use initial value directly
                            let attr;
                            const changes = attrChanges[attrOffset];
                            if (changes) {
                                // Has changes - use full lookup
                                const colTstate = paperStartTstate + (col * 4) + machineOffset;
                                attr = attrInitial ? attrInitial[attrOffset] : currentAttr;
                                for (const change of changes) {
                                    if (change.tState <= colTstate) {
                                        attr = change.value;
                                    } else {
                                        break;
                                    }
                                }
                            } else {
                                // No changes - use initial value
                                attr = attrInitial ? attrInitial[attrOffset] : currentAttr;
                            }

                            let inkColor, paperColor;
                            if (ulaPlusActive) {
                                // ULAplus: CLUT from bits 7,6; ink from bits 2-0; paper from bits 5-3
                                const clut = ((attr >> 6) & 0x03) << 4;
                                inkColor = ulaPal32[clut + (attr & 0x07)];
                                paperColor = ulaPal32[clut + 8 + ((attr >> 3) & 0x07)];
                            } else {
                                let ink = attr & 0x07;
                                let paper = (attr >> 3) & 0x07;
                                const bright = (attr & 0x40) ? 8 : 0;
                                if ((attr & 0x80) && flashActive) {
                                    const tmp = ink; ink = paper; paper = tmp;
                                }
                                inkColor = pal32[ink + bright];
                                paperColor = pal32[paper + bright];
                            }

                            const baseOffset = rowOffset + (col << 3);
                            fb32[baseOffset]     = (pixelByte & 0x80) ? inkColor : paperColor;
                            fb32[baseOffset + 1] = (pixelByte & 0x40) ? inkColor : paperColor;
                            fb32[baseOffset + 2] = (pixelByte & 0x20) ? inkColor : paperColor;
                            fb32[baseOffset + 3] = (pixelByte & 0x10) ? inkColor : paperColor;
                            fb32[baseOffset + 4] = (pixelByte & 0x08) ? inkColor : paperColor;
                            fb32[baseOffset + 5] = (pixelByte & 0x04) ? inkColor : paperColor;
                            fb32[baseOffset + 6] = (pixelByte & 0x02) ? inkColor : paperColor;
                            fb32[baseOffset + 7] = (pixelByte & 0x01) ? inkColor : paperColor;
                        }
                    } else {
                        // Fast path: no attribute changes, use optimized 32-bit writes
                        const rowOffset = visY * this.TOTAL_WIDTH + this.BORDER_LEFT;
                        const fb32 = this.frameBuffer32;
                        const pal32 = this.palette32;
                        const ulaplus = this.ulaplus;
                        const ulaPlusActive = ulaplus.enabled && ulaplus.paletteEnabled;
                        const flashActive = this.flashState;
                        // For raster effects: detect pattern by unique entries count
                        // Few unique entries (<=8): T-state based (per-scanline effects)
                        // Many unique entries (>8): group-based (HAM256 pattern)
                        let ulaPal32ForLine;
                        if (ulaPlusActive && this.hadPaletteChanges) {
                            const lineStartTstate = this.calculateLineStartTstate(visY);
                            if (this.paletteUniqueCount <= 8) {
                                this.getPalette32AtTState(lineStartTstate, this.paletteTempLine);
                            } else {
                                const paperLine = visY - this.BORDER_TOP;
                                const group = Math.floor(paperLine / 16);
                                this.getPalette32ForGroup(group, this.paletteTempLine);
                            }
                            ulaPal32ForLine = this.paletteTempLine;
                        }

                        for (let col = 0; col < 32; col++) {
                            const pixelByte = screenRam[pixelAddr + col];
                            const attr = screenRam[attrAddr + col];

                            let inkColor, paperColor;
                            if (ulaPlusActive) {
                                // ULAplus: CLUT from bits 7,6; ink from bits 2-0; paper from bits 5-3
                                const clut = ((attr >> 6) & 0x03) << 4;
                                const ulaPal32 = this.hadPaletteChanges ? ulaPal32ForLine : ulaplus.palette32;
                                inkColor = ulaPal32[clut + (attr & 0x07)];
                                paperColor = ulaPal32[clut + 8 + ((attr >> 3) & 0x07)];
                            } else {
                                let ink = attr & 0x07;
                                let paper = (attr >> 3) & 0x07;
                                const bright = (attr & 0x40) ? 8 : 0;
                                if ((attr & 0x80) && flashActive) {
                                    const tmp = ink; ink = paper; paper = tmp;
                                }
                                inkColor = pal32[ink + bright];
                                paperColor = pal32[paper + bright];
                            }

                            // Write 8 pixels using 32-bit array
                            const baseOffset = rowOffset + (col << 3);
                            fb32[baseOffset]     = (pixelByte & 0x80) ? inkColor : paperColor;
                            fb32[baseOffset + 1] = (pixelByte & 0x40) ? inkColor : paperColor;
                            fb32[baseOffset + 2] = (pixelByte & 0x20) ? inkColor : paperColor;
                            fb32[baseOffset + 3] = (pixelByte & 0x10) ? inkColor : paperColor;
                            fb32[baseOffset + 4] = (pixelByte & 0x08) ? inkColor : paperColor;
                            fb32[baseOffset + 5] = (pixelByte & 0x04) ? inkColor : paperColor;
                            fb32[baseOffset + 6] = (pixelByte & 0x02) ? inkColor : paperColor;
                            fb32[baseOffset + 7] = (pixelByte & 0x01) ? inkColor : paperColor;
                        }
                    }
                }

                // Right border - skip if beam rendering
                if (!skipBorderRendering) {
                    if (lineChanges.length === 0) {
                        // Optimized: fill right border using 32-bit writes
                        const borderColor32 = ulaPlusBorder ? this.getBorderColor32AtTState(lineStartTstate) : this.palette32[startColor];
                        const rowOffset = visY * this.TOTAL_WIDTH;
                        const fb32 = this.frameBuffer32;
                        for (let x = this.BORDER_LEFT + this.SCREEN_WIDTH; x < this.TOTAL_WIDTH; x++) {
                            fb32[rowOffset + x] = borderColor32;
                        }
                    } else {
                        this.renderBorderPixels(visY, lineStartTstate, lineChanges, startColor,
                            this.BORDER_LEFT + this.SCREEN_WIDTH, this.TOTAL_WIDTH, true);
                    }
                }
            }
        }

        // Render ONLY the paper portion of a screen line (256 pixels)
        // Called at paper START for multicolor timing accuracy
        // Returns true if this was a valid screen line, false otherwise
        renderPaperLine(line) {
            // Skip if deferring paper rendering (scroll17-style effects need all changes first)
            if (this.deferPaperRendering) return false;

            const screen = this.memory.getScreenBase();
            const screenRam = screen.ram;

            // Convert frame line to screen line (0-191)
            const screenLine = line - this.FIRST_SCREEN_LINE;
            if (screenLine < 0 || screenLine >= 192) return false;

            // Convert to visible Y coordinate
            const offset = this.VISIBLE_LINE_OFFSET || 0;
            const firstVisibleLine = this.FIRST_SCREEN_LINE - this.BORDER_TOP + offset;
            const visY = line - firstVisibleLine;
            if (visY < 0 || visY >= this.TOTAL_HEIGHT) return false;

            // Skip if borderOnly mode
            if (this.borderOnly) return true;

            const y = screenLine;
            const third = Math.floor(y / 64);
            const lineInThird = y & 0x07;
            const charRow = Math.floor((y & 0x38) / 8);
            const pixelAddr = (third << 11) | (lineInThird << 8) | (charRow << 5);
            const attrAddr = 0x1800 + Math.floor(y / 8) * 32;

            // Check if we have screen bank changes for scroll17-style effects
            const hasScreenBankChanges = this.screenBankChanges.length > 1;

            // Calculate attribute row offset (0-767) for this screen line
            const attrRowOffset = Math.floor(y / 8) * 32;

            // Use palette32 for consistency with other rendering paths
            const fb32 = this.frameBuffer32;
            const pal32 = this.palette32;
            const ulaplus = this.ulaplus;
            const ulaPlusActive = ulaplus.enabled && ulaplus.paletteEnabled;
            // Use per-scanline palette if palette changes detected (raster effects)
            // Few unique entries (<=8): T-state based (per-scanline effects)
            // Many unique entries (>8): group-based (HAM256 pattern)
            const paperLine = visY - this.BORDER_TOP;
            const group = Math.floor(paperLine / 16);
            const lineStartTstate = this.calculateLineStartTstate(visY);
            let ulaPal32;
            if (ulaPlusActive && this.hadPaletteChanges) {
                if (this.paletteUniqueCount <= 8) {
                    this.getPalette32AtTState(lineStartTstate, this.paletteTempLine);
                } else {
                    this.getPalette32ForGroup(group, this.paletteTempLine);
                }
                ulaPal32 = this.paletteTempLine;
            } else {
                ulaPal32 = ulaplus.palette32;
            }
            const rowOffset = visY * this.TOTAL_WIDTH + this.BORDER_LEFT;
            const flashActive = this.flashState;

            if (!hasScreenBankChanges) {
                // Check if multicolor tracking detected any attribute changes this frame
                if (this.hadAttrChanges) {
                    // Multicolor path: read attributes at ULA scan time
                    // 128K-specific offset tuning (adjustable via console: spectrum.ula.mc128kOffset)
                    const machineOffset = is128kCompat(this.machineType) ? (this.mc128kOffset || 0) : 0;
                    const attrChanges = this.attrChanges;
                    const attrInitial = this.attrInitial;

                    for (let col = 0; col < 32; col++) {
                        const pixelByte = screenRam[pixelAddr + col];
                        const attrOffset = attrRowOffset + col;
                        const currentAttr = screenRam[attrAddr + col];

                        // Fast path: if no changes for this column, use initial value directly
                        let attr;
                        const changes = attrChanges[attrOffset];
                        if (changes) {
                            // Has changes - use full lookup
                            const colTstate = paperStartTstate + (col * 4) + machineOffset;
                            attr = attrInitial ? attrInitial[attrOffset] : currentAttr;
                            for (const change of changes) {
                                if (change.tState <= colTstate) {
                                    attr = change.value;
                                } else {
                                    break;
                                }
                            }
                        } else {
                            // No changes - use initial value
                            attr = attrInitial ? attrInitial[attrOffset] : currentAttr;
                        }

                        let inkColor, paperColor;
                        if (ulaPlusActive) {
                            const clut = ((attr >> 6) & 0x03) << 4;
                            inkColor = ulaPal32[clut + (attr & 0x07)];
                            paperColor = ulaPal32[clut + 8 + ((attr >> 3) & 0x07)];
                        } else {
                            let ink = attr & 0x07;
                            let paper = (attr >> 3) & 0x07;
                            const bright = (attr & 0x40) ? 8 : 0;
                            if ((attr & 0x80) && flashActive) {
                                const tmp = ink; ink = paper; paper = tmp;
                            }
                            inkColor = pal32[ink + bright];
                            paperColor = pal32[paper + bright];
                        }

                        const baseOffset = rowOffset + (col << 3);
                        fb32[baseOffset]     = (pixelByte & 0x80) ? inkColor : paperColor;
                        fb32[baseOffset + 1] = (pixelByte & 0x40) ? inkColor : paperColor;
                        fb32[baseOffset + 2] = (pixelByte & 0x20) ? inkColor : paperColor;
                        fb32[baseOffset + 3] = (pixelByte & 0x10) ? inkColor : paperColor;
                        fb32[baseOffset + 4] = (pixelByte & 0x08) ? inkColor : paperColor;
                        fb32[baseOffset + 5] = (pixelByte & 0x04) ? inkColor : paperColor;
                        fb32[baseOffset + 6] = (pixelByte & 0x02) ? inkColor : paperColor;
                        fb32[baseOffset + 7] = (pixelByte & 0x01) ? inkColor : paperColor;
                    }
                } else {
                    // Fast path: no attribute changes, render from current screen
                    for (let col = 0; col < 32; col++) {
                        const pixelByte = screenRam[pixelAddr + col];
                        const attr = screenRam[attrAddr + col];

                        let inkColor, paperColor;
                        if (ulaPlusActive) {
                            const clut = ((attr >> 6) & 0x03) << 4;
                            inkColor = ulaPal32[clut + (attr & 0x07)];
                            paperColor = ulaPal32[clut + 8 + ((attr >> 3) & 0x07)];
                        } else {
                            let ink = attr & 0x07;
                            let paper = (attr >> 3) & 0x07;
                            const bright = (attr & 0x40) ? 8 : 0;
                            if ((attr & 0x80) && flashActive) {
                                const tmp = ink; ink = paper; paper = tmp;
                            }
                            inkColor = pal32[ink + bright];
                            paperColor = pal32[paper + bright];
                        }

                        const baseOffset = rowOffset + (col << 3);
                        fb32[baseOffset]     = (pixelByte & 0x80) ? inkColor : paperColor;
                        fb32[baseOffset + 1] = (pixelByte & 0x40) ? inkColor : paperColor;
                        fb32[baseOffset + 2] = (pixelByte & 0x20) ? inkColor : paperColor;
                        fb32[baseOffset + 3] = (pixelByte & 0x10) ? inkColor : paperColor;
                        fb32[baseOffset + 4] = (pixelByte & 0x08) ? inkColor : paperColor;
                        fb32[baseOffset + 5] = (pixelByte & 0x04) ? inkColor : paperColor;
                        fb32[baseOffset + 6] = (pixelByte & 0x02) ? inkColor : paperColor;
                        fb32[baseOffset + 7] = (pixelByte & 0x01) ? inkColor : paperColor;
                    }
                }
            } else {
                // Slow path: per-pixel screen bank switching for scroll17 effects
                const lineStartTstate = this.calculateLineStartTstate(visY);
                const paperStartTstate = lineStartTstate + (this.BORDER_LEFT / 2);

                for (let px = 0; px < 256; px++) {
                    const pixelTstate = paperStartTstate + (px / 2);
                    const bank = this.getScreenBankAt(pixelTstate);
                    const currentScreenRam = this.memory.getRamBank(bank);

                    const col = Math.floor(px / 8);
                    const bit = px & 7;

                    const pixelByte = currentScreenRam[pixelAddr + col];
                    const attr = currentScreenRam[attrAddr + col];

                    let ink = attr & 0x07;
                    let paper = (attr >> 3) & 0x07;
                    const bright = (attr & 0x40) ? 8 : 0;

                    if ((attr & 0x80) && flashActive) {
                        const tmp = ink; ink = paper; paper = tmp;
                    }

                    const pixel = (pixelByte & (0x80 >> bit)) ? ink + bright : paper + bright;
                    fb32[rowOffset + px] = pal32[pixel];
                }
            }
            return true;
        }

        // Render ONLY the border portions of a line (top/bottom full line, or left+right for screen lines)
        // Called at line END for border timing accuracy
        renderBorderLine(line) {
            // Convert frame line to visible line
            const offset = this.VISIBLE_LINE_OFFSET || 0;
            const firstVisibleLine = this.FIRST_SCREEN_LINE - this.BORDER_TOP + offset;
            const lastVisibleLine = this.FIRST_SCREEN_LINE + this.SCREEN_HEIGHT + this.BORDER_BOTTOM - 1 + offset;

            if (line < firstVisibleLine || line > lastVisibleLine) return;

            const visY = line - firstVisibleLine;
            if (visY < 0 || visY >= this.TOTAL_HEIGHT) return;

            // Calculate T-state for this line
            const lineStartTstate = this.calculateLineStartTstate(visY);
            const lineEndTstate = lineStartTstate + (this.TOTAL_WIDTH / 2);

            // Find border color at the start of this line's visible area
            let startColor = this.borderChanges[0].color;
            for (const change of this.borderChanges) {
                if (change.tState <= lineStartTstate) {
                    startColor = change.color;
                } else {
                    break;
                }
            }

            // Find changes during this line's visible range
            const lineChanges = this.borderChanges.filter(c =>
                c.tState > lineStartTstate && c.tState <= lineEndTstate
            );

            const screenLine = line - this.FIRST_SCREEN_LINE;
            const borderLineOffset = this.hadScreenBankChanges ? 2 : 0;

            const fb32 = this.frameBuffer32;
            // ULAplus: border uses palette entry 8 when enabled
            const ulaPlusBorder = this.ulaplus.enabled && this.ulaplus.paletteEnabled;
            const borderColor32 = ulaPlusBorder ? this.getBorderColor32AtTState(lineStartTstate) : this.palette32[startColor];
            const rowOffset = visY * this.TOTAL_WIDTH;

            if (screenLine < 0 || screenLine >= 192) {
                // Pure border line (top/bottom border) - render entire width
                if (lineChanges.length === 0) {
                    for (let x = 0; x < this.TOTAL_WIDTH; x++) {
                        fb32[rowOffset + x] = borderColor32;
                    }
                } else {
                    this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor, 0, this.TOTAL_WIDTH);
                }
            } else {
                // Screen line - render only left and right borders
                if (lineChanges.length === 0) {
                    for (let x = 0; x < this.BORDER_LEFT; x++) {
                        fb32[rowOffset + x] = borderColor32;
                    }
                    for (let x = this.BORDER_LEFT + this.SCREEN_WIDTH; x < this.TOTAL_WIDTH; x++) {
                        fb32[rowOffset + x] = borderColor32;
                    }
                } else {
                    this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor, 0, this.BORDER_LEFT, true);
                    this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor,
                        this.BORDER_LEFT + this.SCREEN_WIDTH, this.TOTAL_WIDTH, true);
                }

                // If borderOnly mode, also fill paper area with border
                if (this.borderOnly) {
                    if (lineChanges.length === 0) {
                        for (let x = this.BORDER_LEFT; x < this.BORDER_LEFT + this.SCREEN_WIDTH; x++) {
                            fb32[rowOffset + x] = borderColor32;
                        }
                    } else {
                        this.renderBorderPixels(visY, lineStartTstate, lineChanges, startColor,
                            this.BORDER_LEFT, this.BORDER_LEFT + this.SCREEN_WIDTH, true);
                    }
                }
            }
        }

        // Render border pixels with horizontal stripe support
        // Uses T-state based timing for pixel-perfect positioning
        // All timing quantized to 4T boundaries (ULA updates every 8 pixels)
        // Pentagon has no quantization (0xff mask = every 2 pixels)
        renderBorderPixels(visY, lineStartTstate, changes, startColor, xStart, xEnd, isScreenLine = false) {
            let currentColor = startColor;
            let changeIdx = 0;

            // Pentagon uses 0xff mask (no quantization), 48K/128K use 0xfc (4T quantization)
            const noQuantization = !this.profile.borderQuantization;
            const timingMask = noQuantization ? ~0 : ~3;  // ~0 = no mask, ~3 = clear lower 2 bits

            // ULAplus: border uses palette entry 8 when enabled
            const ulaPlusBorder = this.ulaplus.enabled && this.ulaplus.paletteEnabled;

            // Use palette32 for consistency with paper fast path
            const fb32 = this.frameBuffer32;
            const pal32 = this.palette32;
            const rowOffset = visY * this.TOTAL_WIDTH;

            for (let x = xStart; x < xEnd; x++) {
                // Calculate T-state for this pixel
                // Each pixel is 0.5 T-states (2 pixels per T-state)
                // Floor to integer then apply mask for quantization
                const rawTstate = Math.floor(lineStartTstate + (x / 2));
                const pixelTstate = rawTstate & timingMask;

                // Apply changes when pixel T-state reaches change T-state
                while (changeIdx < changes.length && changes[changeIdx].tState <= pixelTstate) {
                    currentColor = changes[changeIdx].color;
                    changeIdx++;
                }

                // ULAplus: use palette entry 8 at current T-state, otherwise standard palette
                fb32[rowOffset + x] = ulaPlusBorder ? this.getBorderColor32AtTState(pixelTstate) : pal32[currentColor];
            }
        }
        
        // Called at end of frame
        endFrame() {
            // Beam rendering: finish rendering any remaining border pixels after the last color change
            if (this.beamRendering) {
                this.finishBorderRendering();
            }

            // If paper rendering was deferred (scroll17-style effects), do it now
            // At this point all screen bank changes for the frame are known
            // KNOWN BUG: Left edge of screen shows thin vertical line artifact in scroll17
            if (this.deferPaperRendering && this.screenBankChanges.length > 1) {
                this.renderDeferredPaper();
            }
            // Normal paper rendering is handled by renderScanline during frame execution

            // Debug: log ULAplus palette raster info
            this.endFramePaletteDebug();

            // Update flash state
            this.flashCounter++;
            if (this.flashCounter >= 16) {
                this.flashCounter = 0;
                this.flashState = !this.flashState;
            }

            this.frameCounter++;
            return this.frameBuffer;
        }

        // Render paper area with per-column screen bank switching
        // Called at endFrame when all screen bank changes are known
        renderDeferredPaper() {
            const fb32 = this.frameBuffer32;
            const pal32 = this.palette32;
            const ulaplus = this.ulaplus;
            const ulaPlusActive = ulaplus.enabled && ulaplus.paletteEnabled;
            const hasPaletteChanges = this.hadPaletteChanges;
            const totalWidth = this.TOTAL_WIDTH;
            const flashActive = this.flashState;
            const changes = this.screenBankChanges;
            const numChanges = changes.length;
            const memory = this.memory;

            // Pre-fetch RAM banks for all used screen banks (typically just 5 and 7)
            const bankCache = new Map();
            for (const change of changes) {
                if (!bankCache.has(change.bank)) {
                    bankCache.set(change.bank, memory.getRamBank(change.bank));
                }
            }

            for (let y = 0; y < 192; y++) {
                const visY = this.BORDER_TOP + y;
                const lineStartTstate = this.calculateLineStartTstate(visY);
                const paperStartTstate = lineStartTstate + (this.BORDER_LEFT / 2);
                const rowOffset = visY * totalWidth + this.BORDER_LEFT;

                // Use per-scanline palette if palette changes detected (raster effects)
                // Few unique entries (<=8): T-state based (per-scanline effects)
                // Many unique entries (>8): group-based (HAM256 pattern)
                const group = Math.floor(y / 16);
                let ulaPal32;
                if (ulaPlusActive && hasPaletteChanges) {
                    if (this.paletteUniqueCount <= 8) {
                        this.getPalette32AtTState(lineStartTstate, this.paletteTempLine);
                    } else {
                        this.getPalette32ForGroup(group, this.paletteTempLine);
                    }
                    ulaPal32 = this.paletteTempLine;
                } else {
                    ulaPal32 = ulaplus.palette32;
                }

                const third = Math.floor(y / 64);
                const lineInThird = y & 0x07;
                const charRow = Math.floor((y & 0x38) / 8);
                const pixelAddr = (third << 11) | (lineInThird << 8) | (charRow << 5);
                const attrAddr = 0x1800 + Math.floor(y / 8) * 32;

                // Per-column rendering (8 pixels share same bank lookup)
                let changeIdx = 0;
                let currentBank = changes[0].bank;

                for (let col = 0; col < 32; col++) {
                    // T-state at column start (each column = 4 T-states = 8 pixels at 2 pixels/T-state)
                    const colTstate = paperStartTstate + (col * 4);

                    // Update bank if there are changes before this column
                    while (changeIdx < numChanges && changes[changeIdx].tState <= colTstate) {
                        currentBank = changes[changeIdx].bank;
                        changeIdx++;
                    }

                    const screenRam = bankCache.get(currentBank);
                    const pixelByte = screenRam[pixelAddr + col];
                    const attr = screenRam[attrAddr + col];

                    let inkColor, paperColor;
                    if (ulaPlusActive) {
                        const clut = ((attr >> 6) & 0x03) << 4;
                        inkColor = ulaPal32[clut + (attr & 0x07)];
                        paperColor = ulaPal32[clut + 8 + ((attr >> 3) & 0x07)];
                    } else {
                        let ink = attr & 0x07;
                        let paper = (attr >> 3) & 0x07;
                        const bright = (attr & 0x40) ? 8 : 0;
                        if ((attr & 0x80) && flashActive) {
                            const tmp = ink; ink = paper; paper = tmp;
                        }
                        inkColor = pal32[ink + bright];
                        paperColor = pal32[paper + bright];
                    }

                    const baseOffset = rowOffset + (col << 3);
                    fb32[baseOffset]     = (pixelByte & 0x80) ? inkColor : paperColor;
                    fb32[baseOffset + 1] = (pixelByte & 0x40) ? inkColor : paperColor;
                    fb32[baseOffset + 2] = (pixelByte & 0x20) ? inkColor : paperColor;
                    fb32[baseOffset + 3] = (pixelByte & 0x10) ? inkColor : paperColor;
                    fb32[baseOffset + 4] = (pixelByte & 0x08) ? inkColor : paperColor;
                    fb32[baseOffset + 5] = (pixelByte & 0x04) ? inkColor : paperColor;
                    fb32[baseOffset + 6] = (pixelByte & 0x02) ? inkColor : paperColor;
                    fb32[baseOffset + 7] = (pixelByte & 0x01) ? inkColor : paperColor;
                }
            }
        }

        setBorder(color) { this.borderColor = color & 0x07; }
        
        // Port I/O
        writePort(port, val) {
            if ((port & 0x01) === 0) {  // ULA port (even ports)
                this.borderColor = val & 0x07;
                this.micOutput = (val & 0x08) ? 1 : 0;
                this.earOutput = (val & 0x10) ? 1 : 0;
            }
        }
        
        readPort(port) {
            if ((port & 0x01) === 0) {  // ULA port (even ports)
                const highByte = (port >> 8) & 0xff;
                // Bits 5,7 set, bit 6 mirrors bit 5 (returns 0xBF for FUSE compatibility)
                return this.readKeyboard(highByte) | 0xA0;
            }
            return 0xFF;
        }
        
        readKeyboard(highByte) {
            let result = 0xff;
            for (let row = 0; row < 8; row++) {
                if ((highByte & (1 << row)) === 0) {
                    result &= this.keyboardState[row];
                }
            }
            return result;
        }
        
        // Map for string-based key lookup
        getKeyMapping(key) {
            // If already a number (keyCode), use keyMap directly
            if (typeof key === 'number') {
                return this.keyMap[key];
            }
            // String-based lookup
            const charMap = {
                'a': [1, 0], 's': [1, 1], 'd': [1, 2], 'f': [1, 3], 'g': [1, 4],
                'q': [2, 0], 'w': [2, 1], 'e': [2, 2], 'r': [2, 3], 't': [2, 4],
                '1': [3, 0], '2': [3, 1], '3': [3, 2], '4': [3, 3], '5': [3, 4],
                '0': [4, 0], '9': [4, 1], '8': [4, 2], '7': [4, 3], '6': [4, 4],
                'p': [5, 0], 'o': [5, 1], 'i': [5, 2], 'u': [5, 3], 'y': [5, 4],
                'l': [6, 1], 'k': [6, 2], 'j': [6, 3], 'h': [6, 4],
                'm': [7, 2], 'n': [7, 3], 'b': [7, 4],
                'z': [0, 1], 'x': [0, 2], 'c': [0, 3], 'v': [0, 4],
                ' ': [7, 0], 'Enter': [6, 0], 'Control': [0, 0], 'Alt': [7, 1]
            };
            // Punctuation map (Symbol Shift + key, or Extended mode for special chars)
            const punctMap = {
                '.': [[7, 1], [7, 2]],       // Symbol + M
                ',': [[7, 1], [7, 3]],       // Symbol + N
                ';': [[7, 1], [5, 1]],       // Symbol + O
                '"': [[7, 1], [5, 0]],       // Symbol + P
                '/': [[7, 1], [0, 4]],       // Symbol + V
                '-': [[7, 1], [6, 3]],       // Symbol + J
                '+': [[7, 1], [6, 2]],       // Symbol + K
                '=': [[7, 1], [6, 1]],       // Symbol + L
                '*': [[7, 1], [7, 4]],       // Symbol + B
                '?': [[7, 1], [0, 3]],       // Symbol + C
                ':': [[7, 1], [0, 1]],       // Symbol + Z
                '<': [[7, 1], [2, 3]],       // Symbol + R
                '>': [[7, 1], [2, 4]],       // Symbol + T
                '!': [[7, 1], [3, 0]],       // Symbol + 1
                '@': [[7, 1], [3, 1]],       // Symbol + 2
                '#': [[7, 1], [3, 2]],       // Symbol + 3
                '$': [[7, 1], [3, 3]],       // Symbol + 4
                '%': [[7, 1], [3, 4]],       // Symbol + 5
                '&': [[7, 1], [4, 4]],       // Symbol + 6
                "'": [[7, 1], [4, 3]],       // Symbol + 7
                '(': [[7, 1], [4, 2]],       // Symbol + 8
                ')': [[7, 1], [4, 1]],       // Symbol + 9
                '_': [[7, 1], [4, 0]],       // Symbol + 0
                '^': [[7, 1], [6, 4]],       // Symbol + H
                // Extended mode characters (Caps Shift + Symbol Shift + key)
                '`': [[0, 0], [7, 1], [1, 0]],  // Caps + Symbol + A = ~
                '~': [[0, 0], [7, 1], [1, 0]],  // Caps + Symbol + A = ~
                '|': [[0, 0], [7, 1], [1, 1]],  // Caps + Symbol + S = |
                '\\': [[0, 0], [7, 1], [1, 2]], // Caps + Symbol + D = \
                '{': [[0, 0], [7, 1], [1, 3]],  // Caps + Symbol + F = {
                '}': [[0, 0], [7, 1], [1, 4]],  // Caps + Symbol + G = }
                '[': [[0, 0], [7, 1], [5, 4]],  // Caps + Symbol + Y = [
                ']': [[0, 0], [7, 1], [5, 3]]   // Caps + Symbol + U = ]
            };
            return charMap[key] || charMap[key.toLowerCase()] || punctMap[key];
        }
        
        keyDown(key) {
            // Check if this is an extended mode character (needs Caps+Symbol, then Symbol+letter)
            if (typeof key === 'string' && key.length === 1 && this.isExtendedModeChar(key)) {
                this.startExtendedMode(key);
                return;
            }

            // Check keyMap first (handles e.code strings like 'Space', 'ArrowUp', etc.)
            // Then fall back to getKeyMapping for character-based lookups
            const mapping = this.keyMap[key] || this.getKeyMapping(key);
            if (!mapping) return;
            if (Array.isArray(mapping[0])) {
                for (const [row, bit] of mapping) {
                    this.keyboardState[row] &= ~(1 << bit);
                }
            } else {
                this.keyboardState[mapping[0]] &= ~(1 << mapping[1]);
            }
        }
        
        keyUp(key) {
            // Cancel any active extended mode sequence for this key
            if (this.extendedModeActive && this.extendedModeKey === key) {
                this.cancelExtendedMode();
                return;
            }
            // Check keyMap first (handles e.code strings like 'Space', 'ArrowUp', etc.)
            // Then fall back to getKeyMapping for character-based lookups
            const mapping = this.keyMap[key] || this.getKeyMapping(key);
            if (!mapping) return;
            if (Array.isArray(mapping[0])) {
                for (const [row, bit] of mapping) {
                    this.keyboardState[row] |= (1 << bit);
                }
            } else {
                this.keyboardState[mapping[0]] |= (1 << mapping[1]);
            }
        }

        // Extended mode characters that need Caps+Symbol, then Symbol+letter sequence
        isExtendedModeChar(key) {
            return '`~|\\{}[]'.includes(key);
        }

        // Get the letter key for an extended mode character
        getExtendedModeLetter(key) {
            const extendedMap = {
                '`': [1, 0],  // A
                '~': [1, 0],  // A
                '|': [1, 1],  // S
                '\\': [1, 2], // D
                '{': [1, 3],  // F
                '}': [1, 4],  // G
                '[': [5, 4],  // Y
                ']': [5, 3]   // U
            };
            return extendedMap[key];
        }

        // Start extended mode sequence: Caps+Symbol first, then Symbol+letter
        startExtendedMode(key) {
            const letter = this.getExtendedModeLetter(key);
            if (!letter) return false;

            this.extendedModeActive = true;
            this.extendedModeKey = key;
            this.extendedModeLetter = letter;
            this.extendedModeStep = 0;
            this.extendedModeFrames = 0;

            // Step 0: Press Caps Shift + Symbol Shift (enter E-mode)
            this.keyboardState[0] &= ~(1 << 0);  // Caps Shift
            this.keyboardState[7] &= ~(1 << 1);  // Symbol Shift
            return true;
        }

        // Process extended mode sequence (call each frame)
        processExtendedMode() {
            if (!this.extendedModeActive) return;

            this.extendedModeFrames++;

            // After 2 frames, move to step 1: release Caps, press letter
            if (this.extendedModeStep === 0 && this.extendedModeFrames >= 2) {
                this.extendedModeStep = 1;
                // Release Caps Shift
                this.keyboardState[0] |= (1 << 0);
                // Press the letter (keep Symbol Shift pressed)
                this.keyboardState[this.extendedModeLetter[0]] &= ~(1 << this.extendedModeLetter[1]);
            }
        }

        // Cancel extended mode and release all keys
        cancelExtendedMode() {
            if (!this.extendedModeActive) return;

            // Release all extended mode keys
            this.keyboardState[0] |= (1 << 0);   // Caps Shift
            this.keyboardState[7] |= (1 << 1);   // Symbol Shift
            if (this.extendedModeLetter) {
                this.keyboardState[this.extendedModeLetter[0]] |= (1 << this.extendedModeLetter[1]);
            }

            this.extendedModeActive = false;
            this.extendedModeKey = null;
            this.extendedModeLetter = null;
        }
        
        renderFrame(borderChanges = null) {
            this.frameCounter++;
            if (this.frameCounter >= 16) {
                this.frameCounter = 0;
                this.flashState = !this.flashState;
            }
            
            const screen = this.memory.getScreenBase();
            const screenRam = screen.ram;
            
            // Use internal borderChanges if no parameter provided
            const changes = borderChanges || this.borderChanges;
            
            // Render border with timing-accurate changes if available
            if (changes && changes.length > 0) {
                this.renderBorderWithChanges(changes);
            } else {
                this.renderBorder();
            }
            
            // Skip paper rendering if borderOnly mode
            const fb32 = this.frameBuffer32;
            const pal32 = this.palette32;
            const ulaplus = this.ulaplus;
            const ulaPlusActive = ulaplus.enabled && ulaplus.paletteEnabled;
            const hasPaletteChanges = this.hadPaletteChanges;
            const totalWidth = this.TOTAL_WIDTH;

            if (!this.borderOnly) {
                const flashActive = this.flashState;

                for (let y = 0; y < 192; y++) {
                    const screenY = y + this.BORDER_TOP;
                    const third = Math.floor(y / 64);
                    const lineInThird = y & 0x07;
                    const charRow = Math.floor((y & 0x38) / 8);
                    const pixelAddr = (third << 11) | (lineInThird << 8) | (charRow << 5);
                    const attrAddr = 0x1800 + Math.floor(y / 8) * 32;
                    const rowOffset = screenY * totalWidth + this.BORDER_LEFT;

                    // Use per-scanline palette if palette changes detected (raster effects)
                    // Few unique entries (<=8): T-state based (per-scanline effects)
                    // Many unique entries (>8): group-based (HAM256 pattern)
                    const group = Math.floor(y / 16);
                    let ulaPal32;
                    if (ulaPlusActive && hasPaletteChanges) {
                        const lineStartTstate = this.calculateLineStartTstate(screenY);
                        if (this.paletteUniqueCount <= 8) {
                            this.getPalette32AtTState(lineStartTstate, this.paletteTempLine);
                        } else {
                            this.getPalette32ForGroup(group, this.paletteTempLine);
                        }
                        ulaPal32 = this.paletteTempLine;
                    } else {
                        ulaPal32 = ulaplus.palette32;
                    }

                    for (let col = 0; col < 32; col++) {
                        const pixelByte = screenRam[pixelAddr + col];
                        const attr = screenRam[attrAddr + col];

                        let inkColor, paperColor;
                        if (ulaPlusActive) {
                            const clut = ((attr >> 6) & 0x03) << 4;
                            inkColor = ulaPal32[clut + (attr & 0x07)];
                            paperColor = ulaPal32[clut + 8 + ((attr >> 3) & 0x07)];
                        } else {
                            let ink = attr & 0x07;
                            let paper = (attr >> 3) & 0x07;
                            const bright = (attr & 0x40) ? 8 : 0;
                            if ((attr & 0x80) && flashActive) {
                                const tmp = ink; ink = paper; paper = tmp;
                            }
                            inkColor = pal32[ink + bright];
                            paperColor = pal32[paper + bright];
                        }

                        const baseOffset = rowOffset + (col << 3);
                        fb32[baseOffset]     = (pixelByte & 0x80) ? inkColor : paperColor;
                        fb32[baseOffset + 1] = (pixelByte & 0x40) ? inkColor : paperColor;
                        fb32[baseOffset + 2] = (pixelByte & 0x20) ? inkColor : paperColor;
                        fb32[baseOffset + 3] = (pixelByte & 0x10) ? inkColor : paperColor;
                        fb32[baseOffset + 4] = (pixelByte & 0x08) ? inkColor : paperColor;
                        fb32[baseOffset + 5] = (pixelByte & 0x04) ? inkColor : paperColor;
                        fb32[baseOffset + 6] = (pixelByte & 0x02) ? inkColor : paperColor;
                        fb32[baseOffset + 7] = (pixelByte & 0x01) ? inkColor : paperColor;
                    }
                }
            } else {
                // borderOnly mode: fill paper area with black (like Screen mode)
                const black32 = pal32[0];
                for (let y = 0; y < 192; y++) {
                    const screenY = y + this.BORDER_TOP;
                    const rowOffset = screenY * totalWidth + this.BORDER_LEFT;
                    for (let x = 0; x < this.SCREEN_WIDTH; x++) {
                        fb32[rowOffset + x] = black32;
                    }
                }
            }
            return this.frameBuffer;
        }
        
        renderBorderWithChanges(borderChanges) {
            // Border changes are stored in T-states
            // borderChanges already contains initial color from startFrame(), just sort
            const changes = borderChanges.slice(); // Copy to avoid mutating original
            changes.sort((a, b) => a.tState - b.tState);

            // For each visible line, render using same logic as renderScanline
            for (let visY = 0; visY < this.TOTAL_HEIGHT; visY++) {
                // Calculate T-state range for this line's visible area
                const lineStartTstate = this.calculateLineStartTstate(visY);
                const lineEndTstate = lineStartTstate + (this.TOTAL_WIDTH / 2);

                // Find starting color
                let startColor = this.borderColor;
                for (const change of changes) {
                    if (change.tState <= lineStartTstate) {
                        startColor = change.color;
                    } else {
                        break;
                    }
                }

                // Find changes during this line's visible range
                const lineChanges = changes.filter(c =>
                    c.tState > lineStartTstate && c.tState <= lineEndTstate
                );

                const isScreenLine = visY >= this.BORDER_TOP && visY < this.BORDER_TOP + this.SCREEN_HEIGHT;

                // ULAplus: border uses palette entry 8 when enabled
                const ulaPlusBorder = this.ulaplus.enabled && this.ulaplus.paletteEnabled;

                if (lineChanges.length === 0) {
                    // No changes during this line - solid color using 32-bit writes
                    const color32 = ulaPlusBorder ? this.getBorderColor32AtTState(lineStartTstate) : this.palette32[startColor];
                    const fb32 = this.frameBuffer32;
                    const rowOffset = visY * this.TOTAL_WIDTH;

                    if (!isScreenLine) {
                        // Pure border line - fill entire width
                        for (let x = 0; x < this.TOTAL_WIDTH; x++) {
                            fb32[rowOffset + x] = color32;
                        }
                    } else {
                        // Left and right border during screen area
                        for (let x = 0; x < this.BORDER_LEFT; x++) {
                            fb32[rowOffset + x] = color32;
                        }
                        for (let x = this.BORDER_LEFT + this.SCREEN_WIDTH; x < this.TOTAL_WIDTH; x++) {
                            fb32[rowOffset + x] = color32;
                        }
                    }
                } else {
                    // Render with horizontal color changes
                    this.renderBorderLineWithChanges(visY, lineStartTstate, lineChanges, startColor, isScreenLine);
                }
            }
        }

        renderBorderLineWithChanges(visY, lineStartTstate, changes, startColor, isScreenLine) {
            let currentColor = startColor;
            let changeIdx = 0;

            // ULAplus: border uses palette entry 8 when enabled
            const ulaPlusBorder = this.ulaplus.enabled && this.ulaplus.paletteEnabled;

            // Use palette32 for consistency
            const fb32 = this.frameBuffer32;
            const pal32 = this.palette32;
            const rowOffset = visY * this.TOTAL_WIDTH;

            for (let x = 0; x < this.TOTAL_WIDTH; x++) {
                // Skip screen area (paper is rendered separately)
                if (isScreenLine && x >= this.BORDER_LEFT && x < this.BORDER_LEFT + this.SCREEN_WIDTH) {
                    continue;
                }

                // Calculate T-state for this pixel
                const pixelTstate = lineStartTstate + (x / 2);

                // Check for color changes up to this T-state
                while (changeIdx < changes.length && changes[changeIdx].tState <= pixelTstate) {
                    currentColor = changes[changeIdx].color;
                    changeIdx++;
                }

                // ULAplus: use palette entry 8 at current T-state, otherwise standard palette
                fb32[rowOffset + x] = ulaPlusBorder ? this.getBorderColor32AtTState(pixelTstate) : pal32[currentColor];
            }
        }
        
        renderBorder() {
            // ULAplus: border uses palette entry 8 when enabled
            const color32 = this.getBorderColor32();
            const fb32 = this.frameBuffer32;
            const totalWidth = this.TOTAL_WIDTH;

            // Top border
            for (let y = 0; y < this.BORDER_TOP; y++) {
                const rowOffset = y * totalWidth;
                for (let x = 0; x < totalWidth; x++) {
                    fb32[rowOffset + x] = color32;
                }
            }
            // Bottom border
            for (let y = this.BORDER_TOP + this.SCREEN_HEIGHT; y < this.TOTAL_HEIGHT; y++) {
                const rowOffset = y * totalWidth;
                for (let x = 0; x < totalWidth; x++) {
                    fb32[rowOffset + x] = color32;
                }
            }
            // Left and right borders
            for (let y = this.BORDER_TOP; y < this.BORDER_TOP + this.SCREEN_HEIGHT; y++) {
                const rowOffset = y * totalWidth;
                for (let x = 0; x < this.BORDER_LEFT; x++) {
                    fb32[rowOffset + x] = color32;
                }
                for (let x = this.BORDER_LEFT + this.SCREEN_WIDTH; x < totalWidth; x++) {
                    fb32[rowOffset + x] = color32;
                }
            }
        }
        
        setPixel(x, y, colorIndex) {
            this.setPixelRGBA(x, y, this.palette[colorIndex]);
        }
        
        setPixelRGBA(x, y, color) {
            const offset = (y * this.TOTAL_WIDTH + x) * 4;
            this.frameBuffer[offset] = color[0];
            this.frameBuffer[offset + 1] = color[1];
            this.frameBuffer[offset + 2] = color[2];
            this.frameBuffer[offset + 3] = color[3];
        }
        
        // Calculate memory contention delay for a given T-state and address
        // Returns the number of T-states to delay (0-6)
        getMemoryContention(tStates, addr) {
            // Only contended memory (0x4000-0x7FFF) is affected
            if (addr < 0x4000 || addr >= 0x8000) return 0;

            // No contention pattern defined (Pentagon has no contention)
            if (!this.CONTENTION_PATTERN) return 0;

            // Calculate which line we're on
            const line = Math.floor(tStates / this.TSTATES_PER_LINE);

            // Only screen lines have contention (lines 64-255 for 48K, 63-254 for 128K)
            if (line < this.FIRST_SCREEN_LINE || line >= this.FIRST_SCREEN_LINE + 192) return 0;

            // Calculate position within the line
            const tInLine = tStates % this.TSTATES_PER_LINE;

            // Only the paper area (128 T-states) has contention
            const contentionStart = this.CONTENTION_AREA_START || 14;
            const contentionEnd = contentionStart + (this.CONTENTION_AREA_LENGTH || 128);

            if (tInLine < contentionStart || tInLine >= contentionEnd) return 0;

            // Get delay from contention pattern (repeats every 8 T-states)
            const patternPos = (tInLine - contentionStart) % 8;
            return this.CONTENTION_PATTERN[patternPos];
        }

        getTiming() {
            return {
                tstatesPerLine: this.TSTATES_PER_LINE,
                linesPerFrame: this.LINES_PER_FRAME,
                tstatesPerFrame: this.TSTATES_PER_FRAME,
                intLength: this.INT_LENGTH
            };
        }
        
        getDimensions() {
            return {
                width: this.TOTAL_WIDTH,
                height: this.TOTAL_HEIGHT,
                screenWidth: this.SCREEN_WIDTH,
                screenHeight: this.SCREEN_HEIGHT,
                borderLeft: this.BORDER_LEFT,
                borderTop: this.BORDER_TOP
            };
        }
        
        getBorderColor() {
            return this.borderColor;
        }

        // Set late timing mode
        // Late timing (warmed ULA) is 1T later than early timing (cold ULA)
        // Only applies to Ferranti ULA machines (48K, 128K), not Pentagon
        setLateTimings(late) {
            if (this.profile.ulaProfile === 'pentagon') return;
            this.lateTimings = !!late;
            // Recalculate LINE_TIMES_BASE with new timing mode
            this.calculateLineTimes();
        }

        // Diagnostic: dump all border changes with their line/pixel positions
        dumpBorderChanges() {
            const borderOffset = this.BORDER_TIMING_OFFSET || 0;
            const lineBase = this.LINE_TIMES_BASE - borderOffset;
            console.log(`[BORDER_DUMP] offset=${borderOffset}, LINE_TIMES_BASE=${this.LINE_TIMES_BASE}, lineBase=${lineBase}`);
            console.log(`[BORDER_DUMP] TOTAL_WIDTH=${this.TOTAL_WIDTH}, BORDER_LEFT=${this.BORDER_LEFT}, SCREEN_WIDTH=${this.SCREEN_WIDTH}`);
            for (const change of this.borderChanges) {
                const relT = change.tState - lineBase;
                const line = Math.floor(relT / this.TSTATES_PER_LINE);
                const lineT = relT - (line * this.TSTATES_PER_LINE);
                const x = Math.floor(lineT * 2);
                let region = 'hblank';
                if (x < this.TOTAL_WIDTH) {
                    if (x < this.BORDER_LEFT) region = 'left';
                    else if (x < this.BORDER_LEFT + this.SCREEN_WIDTH) region = 'paper';
                    else region = 'right';
                }
                console.log(`  T=${change.tState} → line=${line} x=${x} [${region}] color=${change.color}`);
            }
        }

        // Get border color at specific canvas Y coordinate
        getBorderColorAtLine(canvasY) {
            // Convert canvas Y to actual frame line
            // Apply VISIBLE_LINE_OFFSET to match rendering
            let actualLine;
            if (this.fullBorderMode) {
                actualLine = canvasY + (this.VISIBLE_LINE_OFFSET || 0);
            } else {
                actualLine = (this.FIRST_SCREEN_LINE - this.BORDER_TOP) + canvasY + (this.VISIBLE_LINE_OFFSET || 0);
            }
            const tState = actualLine * this.TSTATES_PER_LINE;
            return this.getBorderColorAt(tState);
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = ULA;
    }
    if (typeof global !== 'undefined') {
        global.ULA = ULA;
    }
    if (typeof window !== 'undefined') {
        window.ULA = ULA;
    }

})(typeof window !== 'undefined' ? window : global);
