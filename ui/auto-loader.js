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

// The wait for ROM boot is not a fixed guess: typing starts once the ROM is seen
// scanning the keyboard (ula.keyboardReads rising — a ROM only scans when it has
// reached an input loop), plus a short settle. Measured first-scan frames:
// 48K 83, 128K 54, Pentagon 49, +2 54 — versus the 150-frame wait this replaces.
// It also adapts to a slower or custom ROM instead of assuming Sinclair timings.
const AUTO_LOAD_READY_SETTLE  = 20;  // ~400ms after the ROM starts scanning
const AUTO_LOAD_READY_TIMEOUT = 300; // ~6.0s  give up waiting and type anyway
const AUTO_LOAD_SCORPION_FLOOR = 180; // Scorpion scans during its 256K RAM test, so
                                      // it needs a floor too (+ settle = the old 200)

// Frame-based timing constants (~50 frames/sec)
const AUTO_LOAD_KEY_HOLD      = 5;   // ~100ms key held down
const AUTO_LOAD_KEY_GAP       = 5;   // ~100ms between keys
const AUTO_LOAD_TRDOS_WAIT    = 150; // ~3.0s  TR-DOS boot before typing RUN "…"
// Scorpion keeps its original timings throughout — its boot couldn't be exercised
// in the timing harness, so nothing about that path is retuned on a guess.
const AUTO_LOAD_KEY_HOLD_SLOW = 10;  // ~200ms
const AUTO_LOAD_KEY_GAP_SLOW  = 8;   // ~150ms
const AUTO_LOAD_SCORPION_BASIC_WAIT = 75; // ~1.5s after choosing 128 BASIC

export function initAutoLoader({ getSpectrum }) {
    const chkAutoLoad = document.getElementById('chkAutoLoad');
    const chkFlashLoad = document.getElementById('chkFlashLoad');
    const tapeLoadModeEl = document.getElementById('tapeLoadMode');
    let autoLoadQueue = [];          // pending [{frame, fn}], sorted by absolute frame
    let autoLoadStartFrame = 0;      // spectrum.totalFrames when the sequence began
    let autoLoadActive = false;
    let autoLoadHooked = false;      // whether our frame listener is registered
    let autoLoadGate = null;         // pending "wait for ROM boot" check, or null

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
        if (autoLoadGate && !autoLoadGate()) return;
        const cur = getSpectrum().totalFrames;
        while (autoLoadQueue.length && autoLoadQueue[0].frame <= cur) {
            autoLoadQueue.shift().fn();
        }
        if (autoLoadQueue.length === 0 && !autoLoadGate) unhookAutoLoadFrame();
    }

    function beginAutoLoad() {
        autoLoadActive = true;
        autoLoadQueue = [];
        autoLoadGate = null;
        autoLoadStartFrame = getSpectrum().totalFrames;
        hookAutoLoadFrame();
    }

    // Hold the key sequence back until the machine can actually receive it, then
    // schedule it from that moment (offsets in `schedule` are relative to "ready").
    // Ready = the ROM is scanning the keyboard, past `floor`, plus a settle. If a
    // ROM never scans, the timeout fires the sequence anyway rather than hanging.
    function autoLoadWhenReady(schedule, { floor = 0 } = {}) {
        const spectrum = getSpectrum();
        const ula = spectrum.ula;
        const startFrame = spectrum.totalFrames;
        let lastReads = ula.keyboardReads;
        let readyAt = -1;
        autoLoadGate = () => {
            const elapsed = spectrum.totalFrames - startFrame;
            if (readyAt < 0) {
                const scanning = ula.keyboardReads > lastReads;
                lastReads = ula.keyboardReads;
                if ((scanning && elapsed >= floor) || elapsed >= AUTO_LOAD_READY_TIMEOUT) {
                    readyAt = elapsed;
                } else {
                    return false;
                }
            }
            if (elapsed < readyAt + AUTO_LOAD_READY_SETTLE) return false;
            autoLoadGate = null;
            autoLoadStartFrame = spectrum.totalFrames;
            schedule();
            return true;
        };
        hookAutoLoadFrame();
    }

    function cancelAutoLoad() {
        const spectrum = getSpectrum();
        unhookAutoLoadFrame();
        autoLoadQueue = [];
        autoLoadGate = null;
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

    // opts.headless: don't call spectrum.start() — the caller pumps runFrame()
    // itself (deterministic headless driving). The frame-scheduled key sequence
    // still fires because autoLoadTick runs inside runFrame via the listener.
    function startAutoLoadTape(isTzx, { headless = false } = {}) {
        const spectrum = getSpectrum();
        cancelAutoLoad();
        const machType = spectrum.machineType;
        // Every menu machine (Sinclair 128, +2/+2A/+3 Amstrad menu, Pentagon) loads a
        // tape from its menu's default entry — one Enter. The 128K path used to also
        // type LOAD "" afterwards; measured on 128.rom/pentagon.rom, it was the Enter
        // that started the load and the typed keys did nothing.
        const isMenuMachine = machType !== '48k' && machType !== 'scorpion';
        const ula = spectrum.ula;

        // Reset (tape data survives reset - only rewinds)
        spectrum.stop();
        spectrum.reset();
        if (!headless) spectrum.start();
        beginAutoLoad();

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

        // Common tail: release everything, and start real-time playback if the
        // flash-load trap isn't doing it for us.
        const finishTape = () => {
            ula.keyboardState.fill(0xFF);
            if (!spectrum.getTapeFlashLoad() && !spectrum.tapePlayer.isPlaying()) {
                spectrum.playTape();
            }
            autoLoadActive = false;
        };

        if (isMenuMachine) {
            // Sinclair 128 / Pentagon: menu default is the tape loader.
            // +2/+2A: "Loader" runs LOAD "" (tape only, no FDC).
            // +3: Loader auto-detects disk first, then tape — FDC disks must be
            // cleared by the caller so the ROM Loader falls through to tape.
            autoLoadWhenReady(() => {
                let t = 0;
                autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
                t += AUTO_LOAD_KEY_HOLD;
                autoLoadAt(() => {
                    if (!autoLoadActive) return;
                    ula.keyUp('Enter');
                    finishTape();
                }, t);
            });
            return;
        }

        if (machType === 'scorpion') {
            autoLoadWhenReady(() => scheduleScorpionTape(spectrum, ula, finishTape),
                              { floor: AUTO_LOAD_SCORPION_FLOOR });
            return;
        }

        // 48K: keyword entry — J is LOAD, then "" and Enter
        autoLoadWhenReady(() => {
            let t = 0;
            t = pressKeyTimed(ula, 'j', t);
            t = pressSymbolKeyTimed(ula, 'p', t);
            t = pressSymbolKeyTimed(ula, 'p', t);
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadAt(() => {
                if (!autoLoadActive) return;
                ula.keyUp('Enter');
                finishTape();
            }, t);
        });
    }

    // Scorpion menu: "128 TR-DOS" is first, "128 BASIC" is second, and 128 BASIC
    // takes letter-by-letter input (no 48K keyword mode). Timings here are the
    // pre-existing ones — the Scorpion boot couldn't be exercised in the timing
    // harness, so it keeps the slower, known-good key press/gap.
    function scheduleScorpionTape(spectrum, ula, finishTape) {
        const H = AUTO_LOAD_KEY_HOLD_SLOW, G = AUTO_LOAD_KEY_GAP_SLOW;
        let t = 0;

        // Down arrow to move from "128 TR-DOS" to "128 BASIC", then Enter
        t = pressKeyTimed(ula, 'ArrowDown', t, H, G);
        t = pressKeyTimed(ula, 'Enter', t, H, G);
        t += AUTO_LOAD_SCORPION_BASIC_WAIT;

        // Type LOAD "" letter by letter, then Enter
        for (const key of ['l', 'o', 'a', 'd']) t = pressKeyTimed(ula, key, t, H, G);
        t = pressSymbolKeyTimed(ula, 'p', t, H, G);
        t = pressSymbolKeyTimed(ula, 'p', t, H, G);
        autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
        t += H;
        autoLoadAt(() => {
            if (!autoLoadActive) return;
            ula.keyUp('Enter');
            finishTape();
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

    function startAutoLoadDiskRun(filename, { headless = false } = {}) {
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
        if (!headless) spectrum.start();
        beginAutoLoad();
        const ula = spectrum.ula;

        // No readiness gate here: TR-DOS scans the keyboard well before it can
        // accept a typed command, so gating on the scan types too early and the
        // RUN is lost (verified). This path keeps its fixed, known-good wait.
        let t = AUTO_LOAD_TRDOS_WAIT;

        // Restore boot entry after TR-DOS has finished initialization
        if (bootEntryOffset >= 0) {
            autoLoadAt(() => { diskData[bootEntryOffset] = savedBootByte; }, t - 25);
        }

        const H = AUTO_LOAD_KEY_HOLD, G = AUTO_LOAD_KEY_GAP;

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

    function startAutoLoadDisk({ headless = false } = {}) {
        const spectrum = getSpectrum();
        cancelAutoLoad();
        if (spectrum.bootTrdos()) {
            if (!headless) spectrum.start();
        }
    }

    function startAutoLoadPlus3Disk({ headless = false } = {}) {
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

        if (!headless) spectrum.start();
        beginAutoLoad();

        // +3 Amstrad menu: press Enter to select "Loader" (default option)
        // The +3 ROM's Loader routine auto-detects disk and boots from it
        autoLoadWhenReady(() => {
            let t = 0;
            autoLoadAt(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadAt(() => {
                if (!autoLoadActive) return;
                ula.keyUp('Enter');
                ula.keyboardState.fill(0xFF);
                autoLoadActive = false;
            }, t);
        });
    }

    return {
        cancelAutoLoad,
        startAutoLoadTape,
        startAutoLoadDisk,
        startAutoLoadDiskRun,
        startAutoLoadPlus3Disk,
        isAutoLoadEnabled: () => chkAutoLoad.checked,
        isActive: () => autoLoadActive
    };
}
