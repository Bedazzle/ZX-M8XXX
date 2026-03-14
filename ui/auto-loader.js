// auto-loader.js — Auto-load engine for tape and disk media (extracted from index.html)

const AUTO_LOAD_ROM_WAIT     = 3000;
const AUTO_LOAD_128K_WAIT    = 1500;
const AUTO_LOAD_KEY_HOLD     = 200;
const AUTO_LOAD_KEY_GAP      = 150;
const AUTO_LOAD_KEY_HOLD_FAST = 100;
const AUTO_LOAD_KEY_GAP_FAST  = 100;

export function initAutoLoader({ getSpectrum }) {
    const chkAutoLoad = document.getElementById('chkAutoLoad');
    const chkFlashLoad = document.getElementById('chkFlashLoad');
    const tapeLoadModeEl = document.getElementById('tapeLoadMode');
    let autoLoadTimers = [];
    let autoLoadActive = false;

    function cancelAutoLoad() {
        const spectrum = getSpectrum();
        for (const id of autoLoadTimers) clearTimeout(id);
        autoLoadTimers = [];
        if (autoLoadActive) {
            spectrum.ula.keyboardState.fill(0xFF);
            autoLoadActive = false;
        }
    }

    function autoLoadTimeout(fn, delay) {
        const id = setTimeout(() => {
            const idx = autoLoadTimers.indexOf(id);
            if (idx >= 0) autoLoadTimers.splice(idx, 1);
            fn();
        }, delay);
        autoLoadTimers.push(id);
    }

    function startAutoLoadTape(isTzx) {
        const spectrum = getSpectrum();
        cancelAutoLoad();
        autoLoadActive = true;
        const machType = spectrum.machineType;
        const isAmsMenu = machType === '+2' || machType === '+2a' || machType === '+3';
        const is128K = machType !== '48k';
        const ula = spectrum.ula;

        // Reset (tape data survives reset - only rewinds)
        spectrum.stop();
        spectrum.reset();
        spectrum.start();

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
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadTimeout(() => {
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
            t += 4000;
            // Down arrow to move from "128 TR-DOS" to "128 BASIC"
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('ArrowDown'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('ArrowDown'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_KEY_GAP;
            // Enter to select "128 BASIC"
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('Enter'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_128K_WAIT;

            // 128K BASIC uses letter-by-letter input (not 48K token mode)
            // Type: L, O, A, D, ", ", Enter
            const loadKeys = ['l', 'o', 'a', 'd'];
            for (const key of loadKeys) {
                autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown(key); }, t);
                t += AUTO_LOAD_KEY_HOLD;
                autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp(key); ula.keyboardState.fill(0xFF); }, t);
                t += AUTO_LOAD_KEY_GAP;
            }
            // Symbol+P = first "
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_KEY_GAP;
            // Symbol+P = second "
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_KEY_GAP;
            // Enter
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadTimeout(() => {
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
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('1'); }, t);
            t += AUTO_LOAD_KEY_HOLD;
            autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('1'); ula.keyboardState.fill(0xFF); }, t);
            t += AUTO_LOAD_128K_WAIT;
        } else {
            t += AUTO_LOAD_ROM_WAIT;
        }

        // J = LOAD
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('j'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('j'); ula.keyboardState.fill(0xFF); }, t);
        t += AUTO_LOAD_KEY_GAP;

        // Symbol+P = first "
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
        t += AUTO_LOAD_KEY_GAP;

        // Symbol+P = second "
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown('p'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp('p'); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
        t += AUTO_LOAD_KEY_GAP;

        // Enter
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadTimeout(() => {
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

    // Timer-based key press helpers for typing sequences
    function pressKeyTimed(ula, key, t, hold = AUTO_LOAD_KEY_HOLD, gap = AUTO_LOAD_KEY_GAP) {
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown(key); }, t);
        t += hold;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp(key); ula.keyboardState.fill(0xFF); }, t);
        return t + gap;
    }

    function pressSymbolKeyTimed(ula, key, t, hold = AUTO_LOAD_KEY_HOLD, gap = AUTO_LOAD_KEY_GAP) {
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Alt'); ula.keyDown(key); }, t);
        t += hold;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp(key); ula.keyUp('Alt'); ula.keyboardState.fill(0xFF); }, t);
        return t + gap;
    }

    function pressShiftKeyTimed(ula, key, t, hold = AUTO_LOAD_KEY_HOLD, gap = AUTO_LOAD_KEY_GAP) {
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Shift'); ula.keyDown(key); }, t);
        t += hold;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyUp(key); ula.keyUp('Shift'); ula.keyboardState.fill(0xFF); }, t);
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
        autoLoadActive = true;
        const ula = spectrum.ula;

        let t = AUTO_LOAD_ROM_WAIT;

        // Restore boot entry after TR-DOS has finished initialization
        if (bootEntryOffset >= 0) {
            autoLoadTimeout(() => { diskData[bootEntryOffset] = savedBootByte; }, t - 500);
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
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
        t += H;
        autoLoadTimeout(() => {
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
        autoLoadActive = true;
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

        // +3 Amstrad menu: press Enter to select "Loader" (default option)
        // The +3 ROM's Loader routine auto-detects disk and boots from it
        let t = AUTO_LOAD_ROM_WAIT;
        autoLoadTimeout(() => { if (!autoLoadActive) return; ula.keyDown('Enter'); }, t);
        t += AUTO_LOAD_KEY_HOLD;
        autoLoadTimeout(() => {
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
