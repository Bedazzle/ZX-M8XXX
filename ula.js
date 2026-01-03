/**
 * ZX-M8XXX - ULA (Video and Keyboard)
 * @version 0.6.4
 * @license GPL-3.0
 * 
 * Cycle-accurate scanline-based rendering for multicolor effects.
 */

(function(global) {
    'use strict';
    
    const VERSION = '0.6.4';

    class ULA {
        static get VERSION() { return VERSION; }

        constructor(memory, machineType = '48k') {
            this.memory = memory;
            this.machineType = machineType;
            this.fullBorderMode = false;
            this.borderOnly = false;  // When true, don't draw paper area (256x192)
            this.debugBorderTiming = false;  // Enable to log border change timing
            this.debugScreenRendering = false;  // Enable to log screen vs border decisions
            this.debugMulticolor = false;  // Enable to log multicolor attribute changes
            this.mcTimingOffset = 0;  // Multicolor lookup offset (console: spectrum.ula.mcTimingOffset = X)
            this.mcWriteAdjust = 5;   // Write time adjustment - ADDED to recorded tStates (try 5-8 for PUSH)

            this.SCREEN_WIDTH = 256;
            this.SCREEN_HEIGHT = 192;

            // Full border sizes per machine type (actual hardware values)
            // 48K:  64 top, 48 left/right, 56 bottom (312 lines total)
            // 128K: 63 top, 48 left/right, 56 bottom (311 lines total)
            // Pentagon: 80 top, 48 left/right, 48 bottom (320 lines total)
            this.FULL_BORDER_SIZES = {
                '48k':     { top: 64, left: 48, right: 48, bottom: 56 },
                '128k':    { top: 63, left: 48, right: 48, bottom: 56 },
                'pentagon': { top: 80, left: 48, right: 48, bottom: 48 }
            };

            // Normal (cropped) border sizes
            // 128K: top increased from 24 to 26 (+4px) to match hardware alignment
            this.NORMAL_BORDER_SIZES = {
                '48k':     { top: 24, left: 32, right: 32, bottom: 24 },
                '128k':    { top: 26, left: 32, right: 32, bottom: 24 },
                'pentagon': { top: 24, left: 32, right: 32, bottom: 24 }
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
            if (machineType === 'pentagon') {
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
                // With borderOffset=4 in spectrum.js, TIMING_ADJUST compensates: 14 - 4 = 10
                this.TOP_LEFT_PIXEL_TSTATE = 80 * 224 + 68;  // = 17988
                this.TIMING_ADJUST = 10;  // Compensates for borderOffset=4
            } else if (machineType === '128k') {
                // 128K: 228 T-states/line × 311 lines = 70908 T-states/frame
                // Line structure (from libspectrum): 24 left + 128 screen + 24 right + 52 retrace = 228
                // Frame structure: 63 top + 192 screen + 56 bottom = 311
                this.TSTATES_PER_LINE = 228;
                this.LINES_PER_FRAME = 311;
                this.FIRST_SCREEN_LINE = 63;
                this.VISIBLE_LINE_OFFSET = 0;
                this.ULA_CONTENTION_TSTATES = 0;  // Per-line contention (not used, we do per-cycle)
                this.PAPER_START_TSTATE = 64;  // From ZXMAK2: c_ulaFirstPaperTact = 64
                // I/O Contention timing for 128K
                // Pattern 6,5,4,3,2,1,0,0 starts at T=14361, repeats every 8 T-states
                // Contention applies during screen lines (128 T-states of each line)
                this.CONTENTION_START_TSTATE = 14361;  // When contention pattern starts in frame
                this.CONTENTION_PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];  // Delays for each position
                this.CONTENTION_AREA_START = 24;  // Position within line where contention starts (after left border)
                this.CONTENTION_AREA_LENGTH = 128; // 128 T-states of paper area
                this.IO_CONTENTION_ENABLED = true;
                // 128K timing - INTERRUPT-RELATIVE (T=0 when interrupt fires):
                // Our emulator resets tStates=0 at interrupt, so we use interrupt-relative timing
                // Different emulators use different values:
                //   Fuse/libspectrum: 14362
                //   Swan: 14361 (CentralScreenStart)
                //   ZXMAK2: 14428 (used by some timing tests)
                // Using Swan value since we use Swan's border timing formula (tStates - 8)
                this.TOP_LEFT_PIXEL_TSTATE = 14361;
                // TIMING_ADJUST shifts the display grid
                //   INCREASE → shifts RIGHT, DECREASE → shifts LEFT
                //   Each 1 T-state = 2 pixels
                // Calibrated: was 15, now 15-12=3 for -24px shift
                this.TIMING_ADJUST = 3;
            } else {
                // 48K - pixel-perfect timing verified
                this.TSTATES_PER_LINE = 224;
                this.LINES_PER_FRAME = 312;
                this.FIRST_SCREEN_LINE = 64;
                this.VISIBLE_LINE_OFFSET = 0;
                this.ULA_CONTENTION_TSTATES = 32;     // Per-line contention
                this.PAPER_START_TSTATE = 14;
                // 48K timing - top-left PAPER pixel at T-state 14336
                // With borderOffset=4 in spectrum.js, TIMING_ADJUST compensates: 10 - 4 = 6
                this.TOP_LEFT_PIXEL_TSTATE = 14336;
                this.TIMING_ADJUST = 6;  // Compensates for borderOffset=4
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

            this.borderColor = 7;
            this.earOutput = 0;
            this.micOutput = 0;
            this.flashState = false;
            this.flashCounter = 0;
            this.frameCounter = 0;
            
            this.keyboardState = new Uint8Array(8);
            this.keyboardState.fill(0xff);
            
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
            
            this.frameBuffer = new Uint8ClampedArray(this.TOTAL_WIDTH * this.TOTAL_HEIGHT * 4);
            
            this.keyMap = {
                16: [0, 0], 90: [0, 1], 88: [0, 2], 67: [0, 3], 86: [0, 4],
                65: [1, 0], 83: [1, 1], 68: [1, 2], 70: [1, 3], 71: [1, 4],
                81: [2, 0], 87: [2, 1], 69: [2, 2], 82: [2, 3], 84: [2, 4],
                49: [3, 0], 50: [3, 1], 51: [3, 2], 52: [3, 3], 53: [3, 4],
                48: [4, 0], 57: [4, 1], 56: [4, 2], 55: [4, 3], 54: [4, 4],
                80: [5, 0], 79: [5, 1], 73: [5, 2], 85: [5, 3], 89: [5, 4],
                13: [6, 0], 76: [6, 1], 75: [6, 2], 74: [6, 3], 72: [6, 4],
                32: [7, 0], 17: [7, 1], 77: [7, 2], 78: [7, 3], 66: [7, 4],
                8: [[0, 0], [4, 0]], 37: [[0, 0], [4, 4]], 38: [[0, 0], [4, 3]],
                39: [[0, 0], [4, 2]], 40: [[0, 0], [4, 4]]
            };
        }

        // Update border dimensions based on current mode and machine type
        updateBorderDimensions() {
            const sizes = this.fullBorderMode
                ? this.FULL_BORDER_SIZES[this.machineType]
                : this.NORMAL_BORDER_SIZES[this.machineType];

            this.BORDER_TOP = sizes.top;
            this.BORDER_BOTTOM = sizes.bottom;
            this.BORDER_LEFT = sizes.left;
            this.BORDER_RIGHT = sizes.right;
            this.TOTAL_WIDTH = this.SCREEN_WIDTH + this.BORDER_LEFT + this.BORDER_RIGHT;
            this.TOTAL_HEIGHT = this.SCREEN_HEIGHT + this.BORDER_TOP + this.BORDER_BOTTOM;

            // Reallocate framebuffer for new dimensions
            this.frameBuffer = new Uint8ClampedArray(this.TOTAL_WIDTH * this.TOTAL_HEIGHT * 4);
        }

        // Toggle full border mode
        setFullBorder(enabled) {
            if (this.fullBorderMode !== enabled) {
                this.fullBorderMode = enabled;
                this.updateBorderDimensions();
                this.calculateLineTimes();
                return true; // Dimensions changed, caller should resize canvas
            }
            return false;
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
        }

        // Calculate T-state when a visible line starts being drawn
        // For 128K, uses region-based timing with different T-states per line for each region
        // For other machines, uses simple linear calculation
        calculateLineStartTstate(visY) {
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
            this.keyboardState.fill(0xff);
        }

        // Called at start of each frame
        startFrame() {
            // Track if previous frame had screen bank changes (for scroll17-style effects)
            // If so, we need to defer paper rendering to endFrame when all changes are known
            this.hadScreenBankChanges = this.screenBankChanges && this.screenBankChanges.length > 1;

            this.lastRenderedLine = -1;
            this.borderChanges = [{tState: 0, color: this.borderColor}];
            // Initialize screen bank from memory's current state
            const initialBank = this.memory.screenBank || 5;
            this.screenBankChanges = [{tState: 0, bank: initialBank}];

            // If previous frame had screen bank changes, we'll render paper at endFrame
            this.deferPaperRendering = this.hadScreenBankChanges;

            // Multicolor tracking disabled (known limitation - see README)
            this.hadAttrChanges = false;
            this.attrChanges = {};
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

            // Apply any changes that happened before or at the lookup T-state
            // mcLookupTolerance allows accepting writes slightly AFTER the nominal lookup time
            // This accounts for Nirvana+ style engines where later columns are written
            // after the ULA would nominally read them, but still affect the display
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
            return value;
        }

        // Called when border color changes
        setBorderAt(color, tStates) {
            color = color & 0x07;
            if (color !== this.borderColor) {
                this.borderChanges.push({tState: tStates, color: color});
                this.borderColor = color;
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
        
        // Called BEFORE screen memory writes to render up to current T-state
        // Swan approach: render everything that happened BEFORE this T-state
        // This ensures pixels see OLD values before writes change them
        renderBeforeWrite(tStates) {
            // Don't render during deferred mode (scroll17 effects)
            if (this.deferPaperRendering) return;

            // Calculate which screen line and column we're at
            const adjustedT = tStates - this.TOP_LEFT_PIXEL_TSTATE;
            if (adjustedT < 0) return;  // Before paper area

            const currentScreenLine = Math.floor(adjustedT / this.TSTATES_PER_LINE);
            if (currentScreenLine >= 192) return;  // Past paper area

            const lineT = adjustedT % this.TSTATES_PER_LINE;
            const currentCol = Math.floor(lineT / 4);  // 4 T-states per column

            const screen = this.memory.getScreenBase();
            const screenRam = screen.ram;

            // First, render all complete lines we haven't rendered yet
            while (this.mcLastRenderedLine < currentScreenLine) {
                const y = this.mcLastRenderedLine;
                if (y >= 0 && y < 192) {
                    this.renderPaperLineColumns(y, this.mcLastRenderedCol, 31, screenRam);
                }
                this.mcLastRenderedLine++;
                this.mcLastRenderedCol = 0;
            }

            // Then render columns of current line up to (but not including) current column
            if (currentScreenLine >= 0 && currentScreenLine < 192 && currentCol > this.mcLastRenderedCol) {
                this.renderPaperLineColumns(currentScreenLine, this.mcLastRenderedCol, currentCol - 1, screenRam);
                this.mcLastRenderedCol = currentCol;
            }
        }

        // Render specific columns of a paper line (for multicolor render-before-write)
        renderPaperLineColumns(y, startCol, endCol, screenRam) {
            if (startCol > endCol || startCol > 31 || endCol < 0) return;
            startCol = Math.max(0, startCol);
            endCol = Math.min(31, endCol);

            const visY = this.BORDER_TOP + y;
            const third = Math.floor(y / 64);
            const lineInThird = y & 0x07;
            const charRow = Math.floor((y & 0x38) / 8);
            const pixelAddr = (third << 11) | (lineInThird << 8) | (charRow << 5);
            const attrAddr = 0x1800 + Math.floor(y / 8) * 32;

            for (let col = startCol; col <= endCol; col++) {
                const pixelByte = screenRam[pixelAddr + col];
                const attr = screenRam[attrAddr + col];

                let ink = attr & 0x07;
                let paper = (attr >> 3) & 0x07;
                const bright = (attr & 0x40) ? 8 : 0;
                const flash = attr & 0x80;

                if (flash && this.flashState) {
                    const tmp = ink; ink = paper; paper = tmp;
                }
                ink += bright;
                paper += bright;

                for (let bit = 0; bit < 8; bit++) {
                    const pixel = (pixelByte & (0x80 >> bit)) ? ink : paper;
                    const screenX = this.BORDER_LEFT + col * 8 + bit;
                    this.setPixel(screenX, visY, pixel);
                }
            }
        }

        // Legacy method - kept for compatibility (no-op, multicolor disabled)
        updateToTState(tStates) {
            // Multicolor render-before-write disabled (known limitation)
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

            // Ensure borderChanges is sorted (should already be, but verify)
            // This is needed because the startColor loop assumes sorted order
            if (this.borderChanges.length > 1 && visY === 0) {
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

            // Is this a screen line (with paper) or pure border line?
            const screenLine = line - this.FIRST_SCREEN_LINE;

            // Apply -2 T-state offset only for scroll17-style effects (when screen bank switching is active)
            const borderLineOffset = this.hadScreenBankChanges ? 2 : 0;

            if (screenLine < 0 || screenLine >= 192) {
                // Pure border line (top/bottom border)
                if (lineChanges.length === 0) {
                    const borderColor = this.palette[startColor];
                    for (let x = 0; x < this.TOTAL_WIDTH; x++) {
                        this.setPixelRGBA(x, visY, borderColor);
                    }
                } else {
                    this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor, 0, this.TOTAL_WIDTH);
                }
            } else {
                // Screen line - left border, paper, right border
                const y = screenLine;

                // Left border
                if (lineChanges.length === 0) {
                    const borderColor = this.palette[startColor];
                    for (let x = 0; x < this.BORDER_LEFT; x++) {
                        this.setPixelRGBA(x, visY, borderColor);
                    }
                } else {
                    this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor, 0, this.BORDER_LEFT, true);
                }

                // Paper pixels (or border if borderOnly mode)
                if (this.borderOnly) {
                    // Draw border color instead of paper
                    if (lineChanges.length === 0) {
                        const borderColor = this.palette[startColor];
                        for (let x = this.BORDER_LEFT; x < this.BORDER_LEFT + this.SCREEN_WIDTH; x++) {
                            this.setPixelRGBA(x, visY, borderColor);
                        }
                    } else {
                        this.renderBorderPixels(visY, lineStartTstate, lineChanges, startColor,
                            this.BORDER_LEFT, this.BORDER_LEFT + this.SCREEN_WIDTH, true);
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

                    for (let col = 0; col < 32; col++) {
                        const pixelByte = screenRam[pixelAddr + col];
                        const attr = screenRam[attrAddr + col];

                        let ink = attr & 0x07;
                        let paper = (attr >> 3) & 0x07;
                        const bright = (attr & 0x40) ? 8 : 0;
                        const flash = attr & 0x80;

                        if (flash && this.flashState) {
                            const tmp = ink; ink = paper; paper = tmp;
                        }
                        ink += bright;
                        paper += bright;

                        for (let bit = 0; bit < 8; bit++) {
                            const pixel = (pixelByte & (0x80 >> bit)) ? ink : paper;
                            const screenX = this.BORDER_LEFT + col * 8 + bit;
                            this.setPixel(screenX, visY, pixel);
                        }
                    }
                }

                // Right border
                if (lineChanges.length === 0) {
                    const borderColor = this.palette[startColor];
                    for (let x = this.BORDER_LEFT + this.SCREEN_WIDTH; x < this.TOTAL_WIDTH; x++) {
                        this.setPixelRGBA(x, visY, borderColor);
                    }
                } else {
                    this.renderBorderPixels(visY, lineStartTstate, lineChanges, startColor,
                        this.BORDER_LEFT + this.SCREEN_WIDTH, this.TOTAL_WIDTH, true);
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

            if (!hasScreenBankChanges) {
                // Fast path: no screen bank changes, render from current screen
                for (let col = 0; col < 32; col++) {
                    const pixelByte = screenRam[pixelAddr + col];
                    const attr = screenRam[attrAddr + col];

                    let ink = attr & 0x07;
                    let paper = (attr >> 3) & 0x07;
                    const bright = (attr & 0x40) ? 8 : 0;
                    const flash = attr & 0x80;

                    if (flash && this.flashState) {
                        const tmp = ink; ink = paper; paper = tmp;
                    }
                    ink += bright;
                    paper += bright;

                    for (let bit = 0; bit < 8; bit++) {
                        const pixel = (pixelByte & (0x80 >> bit)) ? ink : paper;
                        const screenX = this.BORDER_LEFT + col * 8 + bit;
                        this.setPixel(screenX, visY, pixel);
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
                    const flash = attr & 0x80;

                    if (flash && this.flashState) {
                        const tmp = ink; ink = paper; paper = tmp;
                    }
                    ink += bright;
                    paper += bright;

                    const pixel = (pixelByte & (0x80 >> bit)) ? ink : paper;
                    const screenX = this.BORDER_LEFT + px;
                    this.setPixel(screenX, visY, pixel);
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

            if (screenLine < 0 || screenLine >= 192) {
                // Pure border line (top/bottom border) - render entire width
                if (lineChanges.length === 0) {
                    const borderColor = this.palette[startColor];
                    for (let x = 0; x < this.TOTAL_WIDTH; x++) {
                        this.setPixelRGBA(x, visY, borderColor);
                    }
                } else {
                    this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor, 0, this.TOTAL_WIDTH);
                }
            } else {
                // Screen line - render only left and right borders
                // Left border
                if (lineChanges.length === 0) {
                    const borderColor = this.palette[startColor];
                    for (let x = 0; x < this.BORDER_LEFT; x++) {
                        this.setPixelRGBA(x, visY, borderColor);
                    }
                    for (let x = this.BORDER_LEFT + this.SCREEN_WIDTH; x < this.TOTAL_WIDTH; x++) {
                        this.setPixelRGBA(x, visY, borderColor);
                    }
                } else {
                    this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor, 0, this.BORDER_LEFT, true);
                    this.renderBorderPixels(visY, lineStartTstate - borderLineOffset, lineChanges, startColor,
                        this.BORDER_LEFT + this.SCREEN_WIDTH, this.TOTAL_WIDTH, true);
                }

                // If borderOnly mode, also fill paper area with border
                if (this.borderOnly) {
                    if (lineChanges.length === 0) {
                        const borderColor = this.palette[startColor];
                        for (let x = this.BORDER_LEFT; x < this.BORDER_LEFT + this.SCREEN_WIDTH; x++) {
                            this.setPixelRGBA(x, visY, borderColor);
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
        renderBorderPixels(visY, lineStartTstate, changes, startColor, xStart, xEnd, isScreenLine = false) {
            let currentColor = startColor;
            let changeIdx = 0;

            for (let x = xStart; x < xEnd; x++) {
                // Calculate T-state for this pixel
                // Each pixel is 0.5 T-states (2 pixels per T-state)
                const pixelTstate = lineStartTstate + (x / 2);

                // Apply changes up to this T-state
                while (changeIdx < changes.length && changes[changeIdx].tState <= pixelTstate) {
                    currentColor = changes[changeIdx].color;
                    changeIdx++;
                }

                this.setPixelRGBA(x, visY, this.palette[currentColor]);
            }
        }
        
        // Called at end of frame
        endFrame() {
            // If paper rendering was deferred (scroll17-style effects), do it now
            // At this point all screen bank changes for the frame are known
            // KNOWN BUG: Left edge of screen shows thin vertical line artifact in scroll17
            if (this.deferPaperRendering && this.screenBankChanges.length > 1) {
                this.renderDeferredPaper();
            }
            // Normal paper rendering is handled by renderScanline during frame execution

            // Update flash state
            this.flashCounter++;
            if (this.flashCounter >= 16) {
                this.flashCounter = 0;
                this.flashState = !this.flashState;
            }

            this.frameCounter++;
            return this.frameBuffer;
        }

        // Render paper area with per-pixel screen bank switching
        // Called at endFrame when all screen bank changes are known
        renderDeferredPaper() {
            const screen = this.memory.getScreenBase();
            const screenRam = screen.ram;

            for (let y = 0; y < 192; y++) {
                const visY = this.BORDER_TOP + y;
                const lineStartTstate = this.calculateLineStartTstate(visY);
                const paperStartTstate = lineStartTstate + (this.BORDER_LEFT / 2);

                const third = Math.floor(y / 64);
                const lineInThird = y & 0x07;
                const charRow = Math.floor((y & 0x38) / 8);
                const pixelAddr = (third << 11) | (lineInThird << 8) | (charRow << 5);
                const attrAddr = 0x1800 + Math.floor(y / 8) * 32;

                // Per-pixel rendering with screen bank switching
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
                    const flash = attr & 0x80;

                    if (flash && this.flashState) {
                        const tmp = ink; ink = paper; paper = tmp;
                    }
                    ink += bright;
                    paper += bright;

                    const pixel = (pixelByte & (0x80 >> bit)) ? ink : paper;
                    const screenX = this.BORDER_LEFT + px;
                    this.setPixel(screenX, visY, pixel);
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
                ' ': [7, 0], 'Enter': [6, 0], 'Shift': [0, 0], 'Control': [7, 1]
            };
            return charMap[key] || charMap[key.toLowerCase()];
        }
        
        keyDown(key) {
            const mapping = typeof key === 'number' ? this.keyMap[key] : this.getKeyMapping(key);
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
            const mapping = typeof key === 'number' ? this.keyMap[key] : this.getKeyMapping(key);
            if (!mapping) return;
            if (Array.isArray(mapping[0])) {
                for (const [row, bit] of mapping) {
                    this.keyboardState[row] |= (1 << bit);
                }
            } else {
                this.keyboardState[mapping[0]] |= (1 << mapping[1]);
            }
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
            if (!this.borderOnly) {
                for (let y = 0; y < 192; y++) {
                    const screenY = y + this.BORDER_TOP;
                    const third = Math.floor(y / 64);
                    const lineInThird = y & 0x07;
                    const charRow = Math.floor((y & 0x38) / 8);
                    const pixelAddr = (third << 11) | (lineInThird << 8) | (charRow << 5);
                    const attrAddr = 0x1800 + Math.floor(y / 8) * 32;

                    for (let col = 0; col < 32; col++) {
                        const pixelByte = screenRam[pixelAddr + col];
                        const attr = screenRam[attrAddr + col];

                        let ink = attr & 0x07;
                        let paper = (attr >> 3) & 0x07;
                        const bright = (attr & 0x40) ? 8 : 0;
                        const flash = attr & 0x80;

                        if (flash && this.flashState) {
                            const tmp = ink; ink = paper; paper = tmp;
                        }
                        ink += bright;
                        paper += bright;

                        for (let bit = 0; bit < 8; bit++) {
                            const pixel = (pixelByte & (0x80 >> bit)) ? ink : paper;
                            const screenX = this.BORDER_LEFT + col * 8 + bit;
                            this.setPixel(screenX, screenY, pixel);
                        }
                    }
                }
            } else {
                // borderOnly mode: fill paper area with black (like Screen mode)
                const black = this.palette[0];
                for (let y = 0; y < 192; y++) {
                    const screenY = y + this.BORDER_TOP;
                    for (let x = 0; x < this.SCREEN_WIDTH; x++) {
                        const screenX = this.BORDER_LEFT + x;
                        this.setPixelRGBA(screenX, screenY, black);
                    }
                }
            }
            return this.frameBuffer;
        }
        
        renderBorderWithChanges(borderChanges) {
            // Border changes are stored in T-states
            // Build a sorted list of changes
            const changes = [{tState: 0, color: this.borderColor}].concat(borderChanges);
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

                if (lineChanges.length === 0) {
                    // No changes during this line - solid color
                    const color = this.palette[startColor];

                    if (!isScreenLine) {
                        // Pure border line - fill entire width
                        for (let x = 0; x < this.TOTAL_WIDTH; x++) {
                            this.setPixelRGBA(x, visY, color);
                        }
                    } else {
                        // Left and right border during screen area
                        for (let x = 0; x < this.BORDER_LEFT; x++) {
                            this.setPixelRGBA(x, visY, color);
                        }
                        for (let x = this.BORDER_LEFT + this.SCREEN_WIDTH; x < this.TOTAL_WIDTH; x++) {
                            this.setPixelRGBA(x, visY, color);
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

                this.setPixelRGBA(x, visY, this.palette[currentColor]);
            }
        }
        
        renderBorder() {
            const color = this.palette[this.borderColor];
            for (let y = 0; y < this.BORDER_TOP; y++) {
                for (let x = 0; x < this.TOTAL_WIDTH; x++) {
                    this.setPixelRGBA(x, y, color);
                }
            }
            for (let y = this.BORDER_TOP + this.SCREEN_HEIGHT; y < this.TOTAL_HEIGHT; y++) {
                for (let x = 0; x < this.TOTAL_WIDTH; x++) {
                    this.setPixelRGBA(x, y, color);
                }
            }
            for (let y = this.BORDER_TOP; y < this.BORDER_TOP + this.SCREEN_HEIGHT; y++) {
                for (let x = 0; x < this.BORDER_LEFT; x++) {
                    this.setPixelRGBA(x, y, color);
                }
                for (let x = this.BORDER_LEFT + this.SCREEN_WIDTH; x < this.TOTAL_WIDTH; x++) {
                    this.setPixelRGBA(x, y, color);
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
