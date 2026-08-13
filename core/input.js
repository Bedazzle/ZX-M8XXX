/**
 * ZX-M8XXX - Input: keyboard, joysticks, Kempston mouse, gamepad
 * @license GPL-3.0
 *
 * How the outside world reaches the machine. Split out of core/spectrum.js and
 * mixed into Spectrum.prototype, so these stay ordinary Spectrum methods - the UI
 * still calls spectrum.setJoystickType(...) and the DOM handlers are unchanged.
 *
 * Note the keyboard listeners are attached by spectrum.start(); a harness that
 * dispatches key events before the machine runs sees nothing.
 */

import { usesKeyboard, joystickKeys, allJoystickKeys, isJoystickType,
         normalizeCustomKeys } from './joystick.js';

export const InputHandling = {

    handleKeyDown(e) {
        // Don't capture keys when typing in input fields or contentEditable
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            return;
        }
        if (e.target.isContentEditable) {
            return;
        }
        // Also check if any input has focus
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
            return;
        }
        if (active && active.isContentEditable) {
            return;
        }
        
        // Ignore real keyboard during RZX playback
        if (this.rzxPlaying) {
            return;
        }

        // Prevent browser shortcuts when a held Alt/Ctrl acts as a ZX modifier
        // (e.g. Alt+P for Symbol+P, or Ctrl+S when Ctrl is Symbol Shift).
        // AltGr reports Ctrl+Alt together: only prevent then if BOTH families are
        // mapped, so AltGr national-character typing keeps working otherwise.
        // Note: the browser reserves some Ctrl combos (Ctrl+W/T/N) at a level
        // preventDefault can't reach.
        if (!e.metaKey && (e.altKey || e.ctrlKey)) {
            const codes = this.ula.capsShiftCodes.concat(this.ula.symbolShiftCodes);
            const altMapped = codes.some(c => c.startsWith('Alt'));
            const ctrlMapped = codes.some(c => c.startsWith('Control'));
            const altActs = e.altKey && altMapped && (!e.ctrlKey || ctrlMapped);
            const ctrlActs = e.ctrlKey && ctrlMapped && (!e.altKey || altMapped);
            if ((altActs || ctrlActs) && /^[a-z0-9]$/.test(e.key.toLowerCase())) {
                e.preventDefault();
            }
        }

        // Check e.key first for punctuation/shifted characters
        // This must be before joystick checks so typing { } | etc works
        if (e.key.length === 1 && !e.key.match(/^[a-zA-Z0-9]$/)) {
            const mapping = this.ula.getKeyMapping(e.key);
            if (mapping) {
                e.preventDefault();
                // If PC Shift is held, acts as Caps Shift, and mapping is a Symbol Shift
                // compound (e.g. Shift+1 → '!'), temporarily release Caps Shift to
                // avoid Extended Mode (Caps+Symbol+key)
                if (e.shiftKey && Array.isArray(mapping[0]) &&
                    this.ula.capsShiftCodes.some(c => c.startsWith('Shift'))) {
                    this.ula.keyboardState[0] |= (1 << 0); // Release Caps Shift
                }
                this.pressedKeys.set(e.code, e.key); // Track for proper release
                this.ula.keyDown(e.key);
                return;
            }
        }

        // Kempston joystick on numpad (use e.code for cross-platform consistency)
        const kempstonBit = this.getKempstonBit(e.code);
        if (kempstonBit !== null) {
            e.preventDefault();
            if (usesKeyboard(this.joystickType)) {
                for (const key of joystickKeys(this.joystickType, kempstonBit,
                                               this.joystickCustomKeys)) {
                    this.ula.keyDown(key);
                }
            } else {
                this.kempstonState |= kempstonBit;
            }
            return;
        }

        // Extended Kempston buttons: [ = C, ] = A, \ = Start (only when not typing punctuation)
        const extBit = this.getExtendedKempstonBit(e.code);
        if (extBit !== null && this.kempstonExtendedEnabled) {
            e.preventDefault();
            this.kempstonExtendedState |= (1 << extBit);
            return;
        }

        // Use e.code for layout-independent key detection (letters, digits, special keys)
        if (this.ula.keyMap[e.code]) {
            e.preventDefault();
            this.pressedKeys.set(e.code, e.code); // Track for proper release
            this.ula.keyDown(e.code);
        }
    },

    handleKeyUp(e) {
        // Don't capture keys when typing in input fields or contentEditable
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            return;
        }
        if (e.target.isContentEditable) {
            return;
        }
        // Also check if any input has focus
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
            return;
        }
        if (active && active.isContentEditable) {
            return;
        }

        // Use tracked key for proper release (handles shifted chars where e.key changes on release)
        const trackedKey = this.pressedKeys.get(e.code);
        if (trackedKey) {
            e.preventDefault();
            this.ula.keyUp(trackedKey);
            this.pressedKeys.delete(e.code);
            // Re-press Caps Shift if PC Shift is still held and acts as Caps Shift.
            // Handles: Shift+1 (!) suppressed Caps Shift → release 1 → Caps Shift must return
            // for subsequent Shift+letter to produce uppercase.
            if (e.shiftKey && this.ula.capsShiftCodes.some(c => c.startsWith('Shift'))) {
                this.ula.keyboardState[0] &= ~(1 << 0); // Caps Shift
            }
            return;
        }

        // Kempston joystick on numpad (use e.code for cross-platform consistency)
        const kempstonBit = this.getKempstonBit(e.code);
        if (kempstonBit !== null) {
            e.preventDefault();
            if (usesKeyboard(this.joystickType)) {
                for (const key of joystickKeys(this.joystickType, kempstonBit,
                                               this.joystickCustomKeys)) {
                    this.ula.keyUp(key);
                }
                return;
            }
            this.kempstonState &= ~kempstonBit;
            return;
        }

        // Extended Kempston buttons: [ = C, ] = A, \ = Start
        const extBit = this.getExtendedKempstonBit(e.code);
        if (extBit !== null && this.kempstonExtendedEnabled) {
            e.preventDefault();
            this.kempstonExtendedState &= ~(1 << extBit);
            return;
        }
    },

    // Switching type must let go of whatever the old one was holding, or a
    // key stays stuck down in the matrix.
    setJoystickType(type) {
        if (!isJoystickType(type)) return false;
        for (const key of allJoystickKeys(this.joystickType, this.joystickCustomKeys)) {
            this.ula.keyUp(key);
        }
        this.kempstonState = 0;
        this.joystickType = type;
        return true;
    },

    getJoystickType() { return this.joystickType; },

    // Custom bindings, e.g. QAOP + Space. Missing directions fall back to the
    // defaults so a partly-filled setting can't leave one dead.
    setJoystickCustomKeys(map) {
        for (const key of allJoystickKeys('custom', this.joystickCustomKeys)) this.ula.keyUp(key);
        this.joystickCustomKeys = normalizeCustomKeys(map);
        return this.joystickCustomKeys;
    },

    getJoystickCustomKeys() { return { ...this.joystickCustomKeys }; },

    getKempstonBit(code) {
        // Numpad mapping to Kempston joystick (using e.code for consistency)
        // Bit 0: Right, Bit 1: Left, Bit 2: Down, Bit 3: Up, Bit 4: Fire
        switch (code) {
            case 'Numpad8': return 0x08; // Up
            case 'Numpad2': return 0x04; // Down
            case 'Numpad4': return 0x02; // Left
            case 'Numpad6': return 0x01; // Right
            case 'Numpad5': return 0x10; // Fire
            case 'Numpad0': return 0x10; // Fire
            case 'Numpad1': return 0x06; // Down+Left
            case 'Numpad3': return 0x05; // Down+Right
            case 'Numpad7': return 0x0a; // Up+Left
            case 'Numpad9': return 0x09; // Up+Right
            default:  return null;
        }
    },

    getExtendedKempstonBit(code) {
        // Extended Kempston buttons: [ ] \
        // Returns the bit number (5, 6, 7) not the mask
        switch (code) {
            case 'BracketLeft':  return 5; // [ = C button (bit 5)
            case 'BracketRight': return 6; // ] = A button (bit 6)
            case 'Backslash':    return 7; // \ = Start button (bit 7)
            default:  return null;
        }
    },

    // Kempston Mouse update methods
    updateMousePosition(dx, dy) {
        // Clamp movement to prevent large jumps (max ±20 per update)
        dx = Math.max(-20, Math.min(20, dx));
        dy = Math.max(-20, Math.min(20, dy));

        // Update X/Y with wrapping (0-255)
        // X increases right, Y increases when mouse moves UP (hardware convention)
        this.kempstonMouseX = (this.kempstonMouseX + dx) & 0xff;
        this.kempstonMouseY = (this.kempstonMouseY - dy) & 0xff;
    },

    setMouseButton(button, pressed) {
        // Buttons are active low (0 = pressed, 1 = released)
        // button: 0=left, 1=middle, 2=right
        // Default: left=bit1, right=bit0. Swap: left=bit0, right=bit1
        const swap = this.kempstonMouseSwapButtons;
        const bit = button === 0 ? (swap ? 0 : 1) : (button === 1 ? 2 : (swap ? 1 : 0));
        if (pressed) {
            this.kempstonMouseButtons &= ~(1 << bit);
        } else {
            this.kempstonMouseButtons |= (1 << bit);
        }
    },

    // Mouse wheel update (0-15, wrapping)
    updateMouseWheel(delta) {
        // delta > 0 = scroll down, delta < 0 = scroll up
        if (this.kempstonMouseSwapWheel) delta = -delta;
        // Scroll up increases wheel value
        if (delta < 0) {
            this.kempstonMouseWheel = (this.kempstonMouseWheel + 1) & 0x0f;
        } else if (delta > 0) {
            this.kempstonMouseWheel = (this.kempstonMouseWheel - 1) & 0x0f;
        }
    },

    // Extended Kempston joystick buttons (bits 5-7)
    setExtendedButton(bit, pressed) {
        // bit 5 = C, bit 6 = A, bit 7 = Start (active high)
        if (pressed) {
            this.kempstonExtendedState |= (1 << bit);
        } else {
            this.kempstonExtendedState &= ~(1 << bit);
        }
    },

    // Poll hardware gamepad and update Kempston state
    pollGamepad() {
        if (!this.gamepadEnabled || !navigator.getGamepads) {
            this.gamepadState = 0;
            this.gamepadExtState = 0;
            return;
        }

        const gamepads = navigator.getGamepads();
        let gp = null;

        // Find first connected gamepad
        for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i] && gamepads[i].connected) {
                gp = gamepads[i];
                break;
            }
        }

        if (!gp) {
            this.gamepadState = 0;
            this.gamepadExtState = 0;
            return;
        }

        // Reset state each frame
        let state = 0;
        let extState = 0;

        // Use custom mapping if available
        if (this.gamepadMapping) {
            const m = this.gamepadMapping;
            if (this.checkGamepadInput(gp, m.up)) state |= 0x08;
            if (this.checkGamepadInput(gp, m.down)) state |= 0x04;
            if (this.checkGamepadInput(gp, m.left)) state |= 0x02;
            if (this.checkGamepadInput(gp, m.right)) state |= 0x01;
            if (this.checkGamepadInput(gp, m.fire)) state |= 0x10;
            // Extended buttons (C=bit5, A=bit6, Start=bit7)
            if (this.checkGamepadInput(gp, m.c)) extState |= 0x20;
            if (this.checkGamepadInput(gp, m.a)) extState |= 0x40;
            if (this.checkGamepadInput(gp, m.start)) extState |= 0x80;
        } else {
            // Default mapping for standard gamepads
            const axisThreshold = 0.5;
            for (let i = 0; i < gp.axes.length; i += 2) {
                if (gp.axes[i] !== undefined) {
                    if (gp.axes[i] < -axisThreshold) state |= 0x02; // Left
                    if (gp.axes[i] > axisThreshold) state |= 0x01;  // Right
                }
                if (gp.axes[i + 1] !== undefined) {
                    if (gp.axes[i + 1] < -axisThreshold) state |= 0x08; // Up
                    if (gp.axes[i + 1] > axisThreshold) state |= 0x04;  // Down
                }
            }

            // D-pad buttons (buttons 12-15 on standard mapping)
            if (gp.buttons[12]?.pressed) state |= 0x08; // Up
            if (gp.buttons[13]?.pressed) state |= 0x04; // Down
            if (gp.buttons[14]?.pressed) state |= 0x02; // Left
            if (gp.buttons[15]?.pressed) state |= 0x01; // Right

            // Fire buttons - any of first 4 face buttons
            for (let i = 0; i < Math.min(4, gp.buttons.length); i++) {
                if (gp.buttons[i]?.pressed) state |= 0x10;
            }

            // Extended buttons (standard gamepad mapping)
            if (gp.buttons[2]?.pressed) extState |= 0x20; // X/Square = C
            if (gp.buttons[1]?.pressed) extState |= 0x40; // B/Circle = A
            if (gp.buttons[9]?.pressed) extState |= 0x80; // Start
            if (gp.buttons[4]?.pressed) extState |= 0x20; // LB = C
            if (gp.buttons[5]?.pressed) extState |= 0x40; // RB = A
        }

        // Store gamepad state separately (will be ORed with keyboard when reading port)
        this.gamepadState = state;
        this.gamepadExtState = extState;
    },

    // Check if a gamepad input matches a mapping entry
    checkGamepadInput(gp, mapping) {
        if (!mapping) return false;
        if (mapping.type === 'axis') {
            const val = gp.axes[mapping.index];
            if (val === undefined) return false;
            if (mapping.direction > 0) return val > mapping.threshold;
            else return val < -mapping.threshold;
        } else if (mapping.type === 'button') {
            const btn = gp.buttons[mapping.index];
            return btn && btn.pressed;
        }
        return false;
    },

    // Debug: Show gamepad state in console (call from console: spectrum.debugGamepad())
    debugGamepad() {
        if (!navigator.getGamepads) {
            console.log('Gamepad API not available');
            return;
        }
        const gamepads = navigator.getGamepads();
        for (let i = 0; i < gamepads.length; i++) {
            const gp = gamepads[i];
            if (!gp) continue;
            console.log(`=== Gamepad ${i}: ${gp.id} ===`);
            console.log(`Connected: ${gp.connected}, Mapping: "${gp.mapping}", Axes: ${gp.axes.length}, Buttons: ${gp.buttons.length}`);
            console.log('Axes (showing all):');
            for (let a = 0; a < gp.axes.length; a++) {
                const val = gp.axes[a].toFixed(3);
                if (Math.abs(gp.axes[a]) > 0.1) {
                    console.log(`  [${a}] = ${val} <-- ACTIVE`);
                } else {
                    console.log(`  [${a}] = ${val}`);
                }
            }
            console.log('Buttons (showing all):');
            for (let b = 0; b < gp.buttons.length; b++) {
                const btn = gp.buttons[b];
                const active = btn.pressed || btn.value > 0.1;
                console.log(`  [${b}] pressed=${btn.pressed} value=${btn.value.toFixed(3)}${active ? ' <-- ACTIVE' : ''}`);
            }
            if (gp.buttons.length === 0) {
                console.log('  (no buttons reported)');
            }
        }
    },
};
