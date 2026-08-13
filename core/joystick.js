/**
 * ZX-M8XXX - Joystick types
 * @license GPL-3.0
 *
 * Only Kempston was emulated, which leaves out a large slice of the library:
 * plenty of games offer Sinclair or Cursor and nothing else. Those two aren't
 * hardware at all — the interface simply closes ZX keyboard contacts — so they
 * are implemented by pressing the matching keys.
 *
 * Directions use the Kempston bit numbering the input layer already speaks:
 *   bit 0 right, bit 1 left, bit 2 down, bit 3 up, bit 4 fire
 *
 * Key assignments (Sinclair ZX Interface 2 manual; Cursor = AGF/Protek):
 *   Sinclair 1 (right port):  left 6  right 7  down 8  up 9  fire 0
 *   Sinclair 2 (left port):   left 1  right 2  down 3  up 4  fire 5
 *   Cursor:                   left 5  right 8  down 6  up 7  fire 0
 *
 * Note Cursor's left/right/down/up are the ZX cursor keys (5678) and its fire is
 * 0 — the same key as Sinclair 1's fire, which is why some games accept either.
 */

export const JOY_RIGHT = 0x01;
export const JOY_LEFT  = 0x02;
export const JOY_DOWN  = 0x04;
export const JOY_UP    = 0x08;
export const JOY_FIRE  = 0x10;

// Key tokens are `KeyboardEvent.code` values, which is what ula.keyDown expects.
const KEYS = {
    sinclair1: { [JOY_LEFT]: 'Digit6', [JOY_RIGHT]: 'Digit7', [JOY_DOWN]: 'Digit8',
                 [JOY_UP]: 'Digit9', [JOY_FIRE]: 'Digit0' },
    sinclair2: { [JOY_LEFT]: 'Digit1', [JOY_RIGHT]: 'Digit2', [JOY_DOWN]: 'Digit3',
                 [JOY_UP]: 'Digit4', [JOY_FIRE]: 'Digit5' },
    cursor:    { [JOY_LEFT]: 'Digit5', [JOY_RIGHT]: 'Digit8', [JOY_DOWN]: 'Digit6',
                 [JOY_UP]: 'Digit7', [JOY_FIRE]: 'Digit0' },
};

// The classic keyboard layout games used before joysticks were common; also the
// starting point for the Custom type, which the user can rebind key by key.
export const DEFAULT_CUSTOM_KEYS = {
    [JOY_LEFT]: 'KeyO', [JOY_RIGHT]: 'KeyP', [JOY_UP]: 'KeyQ',
    [JOY_DOWN]: 'KeyA', [JOY_FIRE]: 'Space',
};

export const DIRECTIONS = [
    { bit: JOY_UP, id: 'up', name: 'Up' },
    { bit: JOY_DOWN, id: 'down', name: 'Down' },
    { bit: JOY_LEFT, id: 'left', name: 'Left' },
    { bit: JOY_RIGHT, id: 'right', name: 'Right' },
    { bit: JOY_FIRE, id: 'fire', name: 'Fire' },
];

export const JOYSTICK_TYPES = [
    { id: 'kempston',  name: 'Kempston',            hint: 'port $1F — the most common' },
    { id: 'sinclair1', name: 'Sinclair 1 (67890)',  hint: 'Interface 2 right port' },
    { id: 'sinclair2', name: 'Sinclair 2 (12345)',  hint: 'Interface 2 left port' },
    { id: 'cursor',    name: 'Cursor / Protek',     hint: 'keys 5678 + 0' },
    { id: 'custom',    name: 'Custom keys',         hint: 'bind any keys — e.g. QAOP + Space' },
];

export function isJoystickType(id) {
    return JOYSTICK_TYPES.some(t => t.id === id);
}

/** Keyboard-driven types press ZX keys; Kempston is read from a port instead. */
export function usesKeyboard(type) {
    return type === 'custom' || Object.prototype.hasOwnProperty.call(KEYS, type);
}

// Fill in anything the stored map is missing, and drop entries that aren't a
// direction, so a half-written setting can't leave a direction dead.
export function normalizeCustomKeys(map) {
    const out = {};
    for (const d of DIRECTIONS) {
        const v = map && map[d.bit] !== undefined ? map[d.bit] : (map && map[d.id]);
        out[d.bit] = (typeof v === 'string' && v) ? v : DEFAULT_CUSTOM_KEYS[d.bit];
    }
    return out;
}

/**
 * The key codes a direction mask corresponds to, for a keyboard-driven type.
 * A mask may hold several bits (diagonals), so this returns an array.
 * @returns {string[]} possibly empty — never null, so callers can just iterate
 */
export function joystickKeys(type, mask, customKeys = null) {
    const map = type === 'custom' ? normalizeCustomKeys(customKeys) : KEYS[type];
    if (!map || !mask) return [];
    const out = [];
    for (const bit of [JOY_RIGHT, JOY_LEFT, JOY_DOWN, JOY_UP, JOY_FIRE]) {
        if (mask & bit) {
            const key = map[bit];
            if (key && !out.includes(key)) out.push(key);
        }
    }
    return out;
}

/** Every key a type can press — used to release everything on a type change. */
export function allJoystickKeys(type, customKeys = null) {
    const map = type === 'custom' ? normalizeCustomKeys(customKeys) : KEYS[type];
    return map ? [...new Set(Object.values(map))] : [];
}
