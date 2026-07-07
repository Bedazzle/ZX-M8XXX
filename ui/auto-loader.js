// auto-loader.js — Auto-load engine for tape and disk media (extracted from index.html)
//
// Timing is driven by EMULATED FRAMES, not wall-clock. The ZX keyboard is scanned
// once per maskable interrupt (one per frame), so key debounce / auto-repeat are
// counted in frames. Scheduling the typed LOAD sequence by emulated frame makes it
// behave identically at any emulation speed (10% … Max) and on any machine
// regardless of T-states-per-frame, and it pauses naturally when the emulator is
// paused. The schedule is pumped from the spectrum `onFrame` hook (fires once per
// emulated frame, even at Max) — an external rAF poll would batch many frames at
// high speed and skip a key's down→up window. Frame numbers use spectrum.totalFrames
// (monotonic).

// Frame-based timing constants (~50 frames/sec)
const AUTO_LOAD_ROM_WAIT      = 150; // ~3.0s  wait for ROM boot to the cursor
const AUTO_LOAD_128K_WAIT     = 75;  // ~1.5s  after choosing BASIC from the 128K menu
const AUTO_LOAD_SCORPION_WAIT = 200; // ~4.0s  Scorpion 256K RAM test on boot
const AUTO_LOAD_KEY_HOLD      = 10;  // ~200ms key held down
const AUTO_LOAD_KEY_GAP       = 8;   // ~150ms between keys
const AUTO_LOAD_KEY_HOLD_FAST = 5;   // ~100ms
const AUTO_LOAD_KEY_GAP_FAST  = 5;   // ~100ms

export function initAutoLoader({ getSpectrum }) {
    const chkAutoLoad = document.getElementById('chkAutoLoad');
    const chkFlashLoad = document.getElementById('chkFlashLoad');
    const tapeLoadModeEl = document.getElementById('tapeLoadMode');
    let autoLoadQueue = [];          // pending [{frame, fn}], sorted by absolute frame
    let autoLoadStartFrame = 0;      // spectrum.totalFrames when the sequence began
    let autoLoadActive = false;
    let autoLoadHooked = false;      // whether our frame listener is registered

    // The Disk tab mirrors the Auto Load checkbox; keep both in sync.
    // project-io dispatches 'change' on chkAutoLoad when restoring projects.
    const chkAutoLoadDisk = document.getElementById('chkAutoLoadDisk');
    if (chkAutoLoadDisk) {
        chkAutoLoadDisk.checked = chkAutoLoad.checked;
        chkAutoLoadDisk.addEventListener('change', () => {
            chkAutoLoad.checked = chkAutoLoadDisk.checked;
        });
        chkAutoLoad.addEventListener('change', () => {
            chkAutoLoadDisk.checked = chkAutoLoad.checked;
        });
    }

    // Register our per-frame pump (only while a sequence is active). Uses the
    // spectrum's multi-listener registry so it never clobbers other onFrame
    // consumers (second screen, profiler, …).
    function hookAutoLoadFrame() {
        if (autoLoadHooked) return;
        getSpectrum().addFrameListener(autoLoadTick);
        autoLoadHooked = true;
    }

    function unhookAutoLoadFrame() {
        if (!autoLoadHooked) return;
        getSpectrum().removeFrameListener(autoLoadTick);
        autoLoadHooked = false;
    }

    // Run every emulated frame: fire all actions whose target frame has been
    // reached. At high speed several frames elapse per tick, so more than one may
    // fire; each key still spans the intended number of frames because down/up are
    // scheduled at distinct frames and applied in order as those frames arrive.
    function autoLoadTick() {
        if (!autoLoadActive) return;
        const cur = getSpectrum().totalFrames;
        while (autoLoadQueue.length && autoLoadQueue[0].frame <= cur) {
            autoLoadQueue.shift().fn();
        }
        if (autoLoadQueue.length === 0) unhookAutoLoadFrame();
    }

    function beginAutoLoad() {
        autoLoadActive = true;
        autoLoadQueue = [];
        autoLoadStartFrame = getSpectrum().totalFrames;
        hookAutoLoadFrame();
    }

    function cancelAutoLoad() {
        const spectrum = getSpectrum();
        unhookAutoLoadFrame();
        autoLoadQueue = [];
        if (autoLoadActive) {
            spectrum.ula.keyboardState.fill(0xFF);
            autoLoadActive = false;
        }
    }

    // Schedule fn to run when the emulator reaches (sequence start + frameOffset).
    function autoLoadAt(fn, frameOffset) {
        autoLoadQueue.push({ frame: autoLoadStartFrame + frameOffset, fn });
        autoLoadQueue.sort((a, b) => a.frame - b.frame);
    }

    function startAutoLoadTape(isTzx) {
        const spectrum = getSpectrum();
        cancelAutoLoad();
        const machType = spectrum.machineType;
        const isAmsMenu = machType === '+2' || machType === '+2a' || machType === '+3';
        const is128K = machType !== '48k';
        const ula = spectrum.ula;

        // Reset (tape data survives reset - only rewinds)
        spectrum.stop();
        spectrum.reset();
        spectrum.start();
        beginAutoLoad();

        let t = 0;

        // For TZX + flash load: no wrapper needed. The loadTZX callback in
        // spectrum.js sets _turboBlockPending after the last standard block before
        // a turbo gap. The auto-start mechanism (portRead, line ~911) starts the
        // tapePlayer when the custom loader first reads port 0xFE. This is the
        // correct timing — the pilot starts exactly when the loader is ready.
        //
        // For pure turbo TZX (no standard blocks at all): disable flash load
        // so the ROM's real tape routine reads via port 0xFE from the start.
        if (isTzx && spectrum.getTapeFlashLoad() &&
            spectrum.tapeLoader.getBlockCount() === 0 &&
            spectrum.tapePlayer.hasMoreBlocks()) {
            spectrum.setTapeFlashLoad(false);
            chkFlashLoad.checked = false;
            tapeLoadModeEl.textContent = '(real-time)';
        }

        if (isAmsMenu) {
            // +2/+2A/+3 Amstrad menu — press Enter to select "Loader" (default option)
            // +2/+2A: runs LOAD "" automatically (tape only, no FDC)
            // +3: Loader auto-detects disk first, then tape. FDC disks must be
            // cleared by the caller before invoking this function so the ROM
            // Loader falls through to tape.
            t += AUTO_LOAD_ROM_WAIT;
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadAt(() => {
                if (!autoLoadActive) return;
                ula.keyUp('Enter');
                ula.keyboardState.fill(0xFF);
                if (!spectrum.getTapeFlashLoad()) {
                    if (!spectrum.tapePlayer.isPlaying()) {
                        spectrum.playTape();
                    }
                }
                autoLoadActive = false;
            }, t);
            return;
        }

        if (machType === 'scorpion') {
            // Scorpion menu: "128 TR-DOS" is first, "128 BASIC" is second.
            // Scorpion ROM does a 256KB RAM test on boot — needs extra wait.
            t += AUTO_LOAD_SCORPION_WAIT;
            // Down arrow to move from "128 TR-DOS" to "128 BASIC"
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('ArrowDown'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp('ArrowDown'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_KEY_GAP;
            // Enter to select "128 BASIC"
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp('Enter'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_128K_WAIT;

            // 128K BASIC uses letter-by-letter input (not 48K token mode)
            // Type: L, O, A, D, ", ", Enter
            const loadKeys = ['l', 'o', 'a', 'd'];
            for (const key of loadKeys) {
                autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown(key); }, t);
                t += AUTO_LOAD_KEY_HOLD;
                autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp(key); ula.keyboardState.fill(0xFF); }, t);
                t += AUTO_LOAD_KEY_GAP;
            }
            // Symbol+P = first "
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_KEY_GAP;
            // Symbol+P = second "
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_KEY_GAP;
            // Enter
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadAt(() => {
                if (!autoLoadActive) return;
                ula.keyUp('Enter');
                ula.keyboardState.fill(0xFF);
                if (!spectrum.getTapeFlashLoad()) {
                    if (!spectrum.tapePlayer.isPlaying()) {
                        spectrum.playTape();
                    }
                }
                autoLoadActive = false;
            }, t);
            return;
        } else if (is128K) {
            // Sinclair 128K/Pentagon menu: press "1" for BASIC
            t += AUTO_LOAD_ROM_WAIT;
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('1'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp('1'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_128K_WAIT;
        } else {
            t += AUTO_LOAD_ROM_WAIT;
        }

        // J = LOAD
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('j'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp('j'); ula.keyboardState.fill(0xFF); }, t);
        t += AUTO_LOAD_KEY_GAP;

        // Symbol+P = first "
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
        t += AUTO_LOAD_KEY_GAP;

        // Symbol+P = second "
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
        t += AUTO_LOAD_KEY_GAP;

        // Enter
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadAt(() => {
            if (!autoLoadActive) return;
            ula.keyUp('Enter');
            ula.keyboardState.fill(0xFF);
            if (!spectrum.getTapeFlashLoad()) {
                // Flash load off: start real-time tape playback
                if (!spectrum.tapePlayer.isPlaying()) {
                    spectrum.playTape();
                }
            }
            // For TZX + flash load on: standard blocks load via trap,
            // turbo blocks auto-start via _turboBlockPending in spectrum.js
            autoLoadActive = false;
        }, t);
    }

    // Frame-based key press helpers for typing sequences
    function pressKeyTimed(ula, key, t, hold = AUTO_LOAD_KEY_HOLD, gap = AUTO_LOAD_KEY_GAP) {
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown(key); }, t);
        t += hold;
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp(key); ula.keyboardState.fill(0xFF); }, t);
        return t + gap;
    }

    function pressSymbolKeyTimed(ula, key, t, hold = AUTO_LOAD_KEY_HOLD, gap = AUTO_LOAD_KEY_GAP) {
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown(key); }, t);
        t += hold;
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp(key); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
        return t + gap;
    }

    function pressShiftKeyTimed(ula, key, t, hold = AUTO_LOAD_KEY_HOLD, gap = AUTO_LOAD_KEY_GAP) {
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Shift'); ula.keyDown(key); }, t);
        t += hold;
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyUp(key); ula.keyUp('Shift'); ula.keyboardState.fill(0xFF); }, t);
        return t + gap;
    }

    function startAutoLoadDiskRun(filename) {
        const spectrum = getSpectrum();
        cancelAutoLoad();

        // Temporarily hide boot file in BetaDisk working copy so TR-DOS
        // doesn't auto-run it. The saved copy (loadedBetaDisks) is untouched.
        const diskData = spectrum.betaDisk && spectrum.betaDisk.drives[0].diskData;
        let bootEntryOffset = -1;
        let savedBootByte = 0;
        if (diskData) {
            for (let i = 0; i < 128; i++) {
                const off = i * 16;
                if (diskData[off] === 0x00) break;
                if (diskData[off] === 0x01) continue;
                let name = '';
                for (let j = 0; j < 8; j++) name += String.fromCharCode(diskData[off + j]);
                if (name.trimEnd().toLowerCase() === 'boot') {
                    bootEntryOffset = off;
                    savedBootByte = diskData[off];
                    diskData[off] = 0x01; // Mark as deleted
                    break;
                }
            }
        }

        if (!spectrum.bootTrdos()) {
            // Restore boot entry on failure
            if (bootEntryOffset >= 0) diskData[bootEntryOffset] = savedBootByte;
            return;
        }
        spectrum.start();
        beginAutoLoad();
        const ula = spectrum.ula;

        let t = AUTO_LOAD_ROM_WAIT;

        // Restore boot entry after TR-DOS has finished initialization
        if (bootEntryOffset >= 0) {
            autoLoadAt(() => { diskData[bootEntryOffset] = savedBootByte; }, t - 25);
        }

        const H = AUTO_LOAD_KEY_HOLD_FAST, G = AUTO_LOAD_KEY_GAP_FAST;

        // R = RUN keyword in TR-DOS
        t = pressKeyTimed(ula, 'r', t, H, G);

        // Space between RUN and "
        t = pressKeyTimed(ula, ' ', t, H, G);

        // Opening quote: Symbol + P
        t = pressSymbolKeyTimed(ula, 'p', t, H, G);

        // Symbol Shift character → base key mapping
        const symbolKeys = {
            '.': 'm', ',': 'n', ';': 'o', '/': 'v', '-': 'j', '+': 'k',
            '=': 'l', '*': 'b', '?': 'c', ':': 'z', '<': 'r', '>': 't',
            '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '&': '6',
            "'": '7', '(': '8', ')': '9', '_': '0', '^': 'h'
        };

        // Type filename characters
        for (const ch of filename) {
            if (ch >= 'A' && ch <= 'Z') {
                t = pressShiftKeyTimed(ula, ch.toLowerCase(), t, H, G);
            } else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === ' ') {
                t = pressKeyTimed(ula, ch, t, H, G);
            } else if (symbolKeys[ch]) {
                t = pressSymbolKeyTimed(ula, symbolKeys[ch], t, H, G);
            }
        }

        // Closing quote: Symbol + P
        t = pressSymbolKeyTimed(ula, 'p', t, H, G);

        // Enter
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
        t += H;
        autoLoadAt(() => {
            if (!autoLoadActive) return;
            ula.keyUp('Enter');
            ula.keyboardState.fill(0xFF);
            autoLoadActive = false;
        }, t);
    }

    function startAutoLoadDisk() {
        const spectrum = getSpectrum();
        cancelAutoLoad();
        if (spectrum.bootTrdos()) {
            spectrum.start();
        }
    }

    function startAutoLoadPlus3Disk() {
        const spectrum = getSpectrum();
        cancelAutoLoad();
        const ula = spectrum.ula;

        // Save all FDC drive disks before reset
        const savedDisks = spectrum.fdc ? spectrum.fdc.drives.map(d => d.disk) : [];

        // Reset machine (disk data survives via restore below)
        spectrum.stop();
        spectrum.reset();

        // Restore all drive disks after reset
        if (spectrum.fdc) {
            for (let i = 0; i < savedDisks.length; i++) {
                if (savedDisks[i]) spectrum.fdc.drives[i].disk = savedDisks[i];
            }
        }

        spectrum.start();
        beginAutoLoad();

        // +3 Amstrad menu: press Enter to select "Loader" (default option)
        // The +3 ROM's Loader routine auto-detects disk and boots from it
        let t = AUTO_LOAD_ROM_WAIT;
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadAt(() => {
            if (!autoLoadActive) return;
            ula.keyUp('Enter');
            ula.keyboardState.fill(0xFF);
            autoLoadActive = false;
        }, t);
    }

    return {
        cancelAutoLoad,
        startAutoLoadTape,
        startAutoLoadDisk,
        startAutoLoadDiskRun,
        startAutoLoadPlus3Disk,
        isAutoLoadEnabled: () => chkAutoLoad.checked
    };
}
