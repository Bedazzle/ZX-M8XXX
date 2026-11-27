// touch-joystick.js — an on-screen joystick for phones and tablets.
//
// A stick on the left (eight directions, dragged with a thumb) and fire
// buttons on the right, over the screen. It plays whichever joystick the
// program reads:
//   kempston    port $1F, one fire button
//   kempston8b  the extended 8-bit Kempston: bit 4 = B (the fire button),
//               bit 5 = C, bit 6 = A, bit 7 = Start (zxpress.ru, Info Guide
//               #13; core/input.js reads them the same way)
//   sinclair1 / sinclair2 / cursor  keys pressed in the keyboard matrix
//
// Each control follows its own finger (pointer capture), so moving and
// firing at once works.

import { JOY_RIGHT, JOY_LEFT, JOY_DOWN, JOY_UP, JOY_FIRE, joystickKeys, usesKeyboard } from '../core/joystick.js';

export const TOUCH_TYPES = [
    { id: 'kempston',   name: 'Kempston' },
    { id: 'kempston8b', name: 'Kempston 8-bit' },
    { id: 'sinclair1',  name: 'Sinclair 1' },
    { id: 'sinclair2',  name: 'Sinclair 2' },
    { id: 'cursor',     name: 'Cursor' },
];

const EXT_C = 0x20, EXT_A = 0x40, EXT_START = 0x80;

export function createTouchJoystick({ spectrum, parent, type = 'kempston' }) {
    const root = document.createElement('div');
    root.className = 'zxm8-touch';
    root.hidden = true;

    const stick = document.createElement('div');
    stick.className = 'zxm8-stick';
    const knob = document.createElement('div');
    knob.className = 'zxm8-knob';
    stick.append(knob);

    const buttons = document.createElement('div');
    buttons.className = 'zxm8-fire';
    // Keys most games ask for besides the stick: start, choose, pause
    const keys = document.createElement('div');
    keys.className = 'zxm8-keys';
    root.append(stick, buttons, keys);
    const heldKeys = new Set();
    parent.append(root);

    let stickMask = 0, buttonMask = 0, applied = 0;

    // ---- what the mask does on the machine ----
    function apply() {
        const mask = stickMask | buttonMask;
        if (mask === applied) return;
        if (type === 'kempston' || type === 'kempston8b') {
            spectrum.kempstonState = (spectrum.kempstonState & ~(applied & 0x1F)) | (mask & 0x1F);
            spectrum.kempstonExtendedState = (spectrum.kempstonExtendedState & ~(applied & 0xE0)) | (mask & 0xE0);
        } else if (usesKeyboard(type)) {
            const was = joystickKeys(type, applied & 0x1F), now = joystickKeys(type, mask & 0x1F);
            for (const k of was) if (!now.includes(k)) spectrum.ula.keyUp(k);
            for (const k of now) if (!was.includes(k)) spectrum.ula.keyDown(k);
        }
        applied = mask;
    }
    function releaseAll() {
        stickMask = 0; buttonMask = 0;
        apply();
        knob.style.transform = '';
        for (const b of buttons.children) b.classList.remove('down');
        for (const k of heldKeys) spectrum.ula.keyUp(k);
        heldKeys.clear();
        for (const b of keys.children) b.classList.remove('down');
    }

    // ---- the stick: eight sectors around the centre, a dead zone inside ----
    let stickId = null;
    function stickAt(e) {
        const r = stick.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = r.width / 2;
        let dx = e.clientX - cx, dy = e.clientY - cy;
        const d = Math.hypot(dx, dy);
        if (d > rad) { dx *= rad / d; dy *= rad / d; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        let m = 0;
        if (d > rad * 0.28) {
            const a = Math.atan2(dy, dx) * 180 / Math.PI;           // 0 = right, 90 = down
            const sector = Math.round(a / 45);                       // -4..4
            const dirs = { 0: JOY_RIGHT, 1: JOY_RIGHT | JOY_DOWN, 2: JOY_DOWN, 3: JOY_DOWN | JOY_LEFT,
                           4: JOY_LEFT, '-4': JOY_LEFT, '-3': JOY_LEFT | JOY_UP, '-2': JOY_UP, '-1': JOY_UP | JOY_RIGHT };
            m = dirs[sector];
        }
        stickMask = m;
        apply();
    }
    stick.addEventListener('pointerdown', (e) => {
        stickId = e.pointerId;
        try { stick.setPointerCapture(e.pointerId); } catch (err) { /* a pointer the browser no longer tracks */ }
        stickAt(e);
        e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) stickAt(e); });
    const stickUp = (e) => {
        if (e.pointerId !== stickId) return;
        stickId = null; stickMask = 0; apply();
        knob.style.transform = '';
    };
    stick.addEventListener('pointerup', stickUp);
    stick.addEventListener('pointercancel', stickUp);

    // ---- fire buttons ----
    function button(label, bit, cls = '') {
        const b = document.createElement('div');
        b.className = 'zxm8-btn ' + cls;
        b.textContent = label;
        const up = () => { b.classList.remove('down'); buttonMask &= ~bit; apply(); };
        b.addEventListener('pointerdown', (e) => {
            try { b.setPointerCapture(e.pointerId); } catch (err) { /* as above */ }
            b.classList.add('down'); buttonMask |= bit; apply();
            e.preventDefault();
        });
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        buttons.append(b);
    }
    // A key of the Spectrum's own keyboard, held while the finger is down
    function key(label, code) {
        const b = document.createElement('div');
        b.className = 'zxm8-key';
        b.textContent = label;
        const up = () => {
            b.classList.remove('down');
            if (heldKeys.delete(code)) spectrum.ula.keyUp(code);
        };
        b.addEventListener('pointerdown', (e) => {
            try { b.setPointerCapture(e.pointerId); } catch (err) { /* as above */ }
            b.classList.add('down');
            heldKeys.add(code); spectrum.ula.keyDown(code);
            e.preventDefault();
        });
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        keys.append(b);
    }

    function layout() {
        buttons.innerHTML = '';
        keys.innerHTML = '';
        // The 8-bit interface's buttons, as Sega-style pads label them: fire
        // is B (bit 4), then C (5), A (6) and Start (7)
        if (type === 'kempston8b') {
            button('A', EXT_A);
            button('B', JOY_FIRE, 'zxm8-btn-fire');
            button('C', EXT_C);
            button('START', EXT_START, 'zxm8-btn-start');
        } else {
            button('FIRE', JOY_FIRE, 'zxm8-btn-fire');
            // The 8-bit pad has its own Start; the others get the keys games
            // most often want: Space, Enter, 1 and 0
            key('SPACE', 'Space');
            key('ENTER', 'Enter');
            key('1', 'Digit1');
            key('0', 'Digit0');
        }
    }

    function setType(t) {
        releaseAll();
        type = TOUCH_TYPES.some(x => x.id === t) ? t : 'kempston';
        spectrum.kempstonExtendedEnabled = type === 'kempston8b' || spectrum.kempstonExtendedEnabled;
        layout();
    }
    function show(on) {
        if (!on) releaseAll();
        root.hidden = !on;
    }
    // A finger lifted outside the page (or the tab hidden) must not leave a
    // direction held
    const onHide = () => { if (document.hidden) releaseAll(); };
    document.addEventListener('visibilitychange', onHide);

    setType(type);
    return {
        setType, show,
        get type() { return type; },
        get visible() { return !root.hidden; },
        destroy() { releaseAll(); document.removeEventListener('visibilitychange', onHide); root.remove(); },
    };
}
