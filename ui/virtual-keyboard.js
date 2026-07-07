// virtual-keyboard.js — clickable on-screen ZX Spectrum keyboard.
//
// Clicking a key injects the matching keypress via `spectrum.ula.keyDown/keyUp`
// (key codes match the ULA `keyMap`, e.g. 'KeyP', 'Digit1', 'Enter'). What appears
// depends on the current BASIC cursor mode (K/L/C/E/G) — handled by the ROM, exactly
// like real hardware: in K mode a letter yields its keyword (P → PRINT).
//
// CAPS SHIFT / SYMBOL SHIFT are sticky: click to arm (highlighted), click a key to
// combine, then they auto-release. Pressed keys are highlighted live by reading
// `ula.keyboardState` each frame (reflects both virtual and real key presses).
//
// DI: getSpectrum

// Legend data per key: code (ULA keyMap), main glyph, kw (BASIC keyword, K mode),
// sym (symbol-shift, red), ext (extended mode, green). Rows top→bottom.
const LAYOUT = [
    [
        { code: 'Digit1', main: '1', kw: 'EDIT',    extSym: 'DEF FN', sym: '!', colour: 'BLUE',    clr: '#6a8bff' },
        { code: 'Digit2', main: '2', kw: 'CAPS LK', extSym: 'FN',     sym: '@', colour: 'RED',     clr: '#ff6b6b' },
        { code: 'Digit3', main: '3', kw: 'TRU VID', extSym: 'LINE',   sym: '#', colour: 'MAGENTA', clr: '#ff6bff' },
        { code: 'Digit4', main: '4', kw: 'INV VID', extSym: 'OPEN#',  sym: '$', colour: 'GREEN',   clr: '#5bd75b' },
        { code: 'Digit5', main: '5', kw: '←',  extSym: 'CLOSE#', sym: '%', colour: 'CYAN',    clr: '#5bd7d7' },
        { code: 'Digit6', main: '6', kw: '↓',  extSym: 'MOVE',   sym: '&', colour: 'YELLOW',  clr: '#e0e060' },
        { code: 'Digit7', main: '7', kw: '↑',  extSym: 'ERASE',  sym: "'", colour: 'WHITE',   clr: '#ffffff' },
        { code: 'Digit8', main: '8', kw: '→',  extSym: 'POINT',  sym: '(' },
        { code: 'Digit9', main: '9', kw: 'GRAPH',   extSym: 'CAT',    sym: ')' },
        { code: 'Digit0', main: '0', kw: 'DELETE',  extSym: 'FORMAT', sym: '_', colour: 'BLACK',   clr: '#999' }
    ],
    [
        { code: 'KeyQ', main: 'Q', kw: 'PLOT',  ext: 'SIN',  sym: '<=', extSym: 'ASN' },
        { code: 'KeyW', main: 'W', kw: 'DRAW',  ext: 'COS',  sym: '<>', extSym: 'ACS' },
        { code: 'KeyE', main: 'E', kw: 'REM',   ext: 'TAN',  sym: '>=', extSym: 'ATN' },
        { code: 'KeyR', main: 'R', kw: 'RUN',   ext: 'INT',  sym: '<',  extSym: 'VERIFY' },
        { code: 'KeyT', main: 'T', kw: 'RAND',  ext: 'RND',  sym: '>',  extSym: 'MERGE' },
        { code: 'KeyY', main: 'Y', kw: 'RETURN',ext: 'STR$', sym: 'AND', extSym: '[' },
        { code: 'KeyU', main: 'U', kw: 'IF',    ext: 'CHR$', sym: 'OR',  extSym: ']' },
        { code: 'KeyI', main: 'I', kw: 'INPUT', ext: 'CODE', sym: 'AT',  extSym: 'IN' },
        { code: 'KeyO', main: 'O', kw: 'POKE',  ext: 'PEEK', sym: ';',   extSym: 'OUT' },
        { code: 'KeyP', main: 'P', kw: 'PRINT', ext: 'TAB',  sym: '"',   extSym: '©' }
    ],
    [
        { code: 'KeyA', main: 'A', kw: 'NEW',   ext: 'READ',    sym: 'STOP', extSym: '~' },
        { code: 'KeyS', main: 'S', kw: 'SAVE',  ext: 'RESTORE', sym: 'NOT',  extSym: '|' },
        { code: 'KeyD', main: 'D', kw: 'DIM',   ext: 'DATA',    sym: 'STEP', extSym: '\\' },
        { code: 'KeyF', main: 'F', kw: 'FOR',   ext: 'SGN',     sym: 'TO',   extSym: '{' },
        { code: 'KeyG', main: 'G', kw: 'GOTO',  ext: 'ABS',     sym: 'THEN', extSym: '}' },
        { code: 'KeyH', main: 'H', kw: 'GOSUB', ext: 'SQR',     sym: '^', extSym: 'CIRCLE' },
        { code: 'KeyJ', main: 'J', kw: 'LOAD',  ext: 'VAL',     sym: '-', extSym: 'VAL$' },
        { code: 'KeyK', main: 'K', kw: 'LIST',  ext: 'LEN',     sym: '+', extSym: 'SCREEN$' },
        { code: 'KeyL', main: 'L', kw: 'LET',   ext: 'USR',     sym: '=', extSym: 'ATTR' },
        { code: 'Enter', main: 'ENTER', wide: true }
    ],
    [
        { code: 'CAPS', main: 'CAPS', mod: true, wide: true },
        { code: 'KeyZ', main: 'Z', kw: 'COPY',   ext: 'LN',     sym: ':', extSym: 'BEEP' },
        { code: 'KeyX', main: 'X', kw: 'CLEAR',  ext: 'EXP',    sym: '£', extSym: 'INK' },
        { code: 'KeyC', main: 'C', kw: 'CONT',   ext: 'LPRINT', sym: '?', extSym: 'PAPER' },
        { code: 'KeyV', main: 'V', kw: 'CLS',    ext: 'LLIST',  sym: '/', extSym: 'FLASH' },
        { code: 'KeyB', main: 'B', kw: 'BORDER', ext: 'BIN',    sym: '*', extSym: 'BRIGHT' },
        { code: 'KeyN', main: 'N', kw: 'NEXT',   ext: 'INKEY$', sym: ',', extSym: 'OVER' },
        { code: 'KeyM', main: 'M', kw: 'PAUSE',  ext: 'PI',     sym: '.', extSym: 'INVERSE' },
        { code: 'SYM', main: 'SYM', mod: true, wide: true },
        { code: 'Space', main: 'SPACE', kw: 'BREAK', wide: true }
    ]
];

export function initVirtualKeyboard({ getSpectrum, appVersion }) {
    const panel = document.getElementById('virtualKeyboard');
    const btn = document.getElementById('btnVKbd');
    if (!panel || !btn) return;

    const keyEls = [];        // { el, code, matrix } for live highlight
    const heldMods = new Set(); // latched modifier codes (CAPS / SYMBOL shift)
    let built = false;

    function ula() { return getSpectrum().ula; }

    // Single-position matrix for a key (null for compound/modifier-combo codes)
    function matrixOf(code) {
        const m = ula().keyMap[code];
        return (Array.isArray(m) && !Array.isArray(m[0])) ? m : null;
    }

    // CAPS / SYMBOL shift latch: click to hold down, click again to release.
    // Stays held across multiple key clicks (so you can type several uppercase
    // letters / symbols), and CAPS+SYM together gives extended mode.
    function toggleMod(code, el) {
        const u = ula();
        if (heldMods.has(code)) { heldMods.delete(code); u.keyUp(code); el.classList.remove('armed'); }
        else { heldMods.add(code); u.keyDown(code); el.classList.add('armed'); }
    }

    function releaseAllMods() {
        const u = ula();
        for (const code of heldMods) u.keyUp(code);
        heldMods.clear();
        for (const k of keyEls) if (k.mod) k.el.classList.remove('armed');
    }

    // Normal key: a latched modifier (if any) is already held, so just tap the key.
    function pressKey(code) { ula().keyDown(code); }
    function releaseKey(code) { ula().keyUp(code); }

    // Layout mirrors the physical key faces: keyword (and number colour) ABOVE the
    // key, the green extended word top-left and red symbol-shift top-right INSIDE the
    // key, and the secondary word (BEEP/INK on letters, DEF FN… on numbers) BELOW it.
    function makeKey(def) {
        const cell = document.createElement('div');
        cell.className = 'vkbd-cell' + (def.wide ? ' wide' : '');

        const box = document.createElement('div');
        box.className = 'vkbd-key' + (def.mod ? ' mod' : '');
        box.title = def.kw ? `${def.main}  —  ${def.kw}${def.ext ? ' / ' + def.ext : ''}` : def.main;

        const above = document.createElement('div');
        above.className = 'vk-above';
        const below = document.createElement('div');
        below.className = 'vk-below';

        if (def.mod) {
            box.innerHTML = `<span class="vk-main vk-word">${def.main}<br>SHIFT</span>`;
        } else {
            const isNum = def.code.startsWith('Digit');
            const hasGreen = !!def.ext && !isNum; // letters carry a green extended word
            // ABOVE the key: number colour, then the green extended word (letters) or
            // the keyword (numbers/space, e.g. EDIT / BREAK).
            if (def.colour) above.innerHTML += `<span class="vk-colour" style="color:${def.clr}">${def.colour}</span>`;
            if (hasGreen) above.innerHTML += `<span class="vk-aboveext">${def.ext}</span>`;
            else if (def.kw) above.innerHTML += `<span class="vk-keyword">${def.kw}</span>`;

            // ON the key: keyword top-left (letters), symbol-shift top-right, main centered.
            const kwCorner = (hasGreen && def.kw) ? `<span class="vk-corner vk-kw">${def.kw}</span>` : '';
            const symCorner = def.sym ? `<span class="vk-corner vk-sym">${def.sym}</span>` : '';
            const mainCls = 'vk-main' + (def.main.length > 2 ? ' vk-word' : '');
            box.innerHTML = kwCorner + symCorner + `<span class="${mainCls}">${def.main}</span>`;

            below.textContent = def.extSym || '';        // extended+symbol word, below the key
            if (def.extSym) below.classList.add('vk-extsym'); // shown in red
        }

        if (def.mod) {
            box.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleMod(def.code, box); });
        } else {
            box.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                pressKey(def.code);
                box.setPointerCapture?.(e.pointerId);
            });
            const up = () => releaseKey(def.code);
            box.addEventListener('pointerup', up);
            box.addEventListener('pointercancel', up);
            box.addEventListener('pointerleave', (e) => { if (e.buttons) up(); });
        }

        cell.appendChild(above);
        cell.appendChild(box);
        cell.appendChild(below);
        keyEls.push({ el: box, code: def.code, matrix: matrixOf(def.code), mod: !!def.mod });
        return cell;
    }

    // Position the panel explicitly (px), clamped to the viewport, dropping the
    // default centered/bottom anchoring once the user starts dragging.
    function setPos(left, top) {
        const w = panel.offsetWidth, h = panel.offsetHeight;
        left = Math.max(0, Math.min(left, window.innerWidth - w));
        top = Math.max(0, Math.min(top, window.innerHeight - h));
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.bottom = 'auto';
        panel.style.transform = 'none';
    }

    function applySavedPos() {
        let p = null;
        try { p = JSON.parse(localStorage.getItem('zxm8_vkbd_pos') || 'null'); } catch {}
        if (p && typeof p.left === 'number') setPos(p.left, p.top);
    }

    function enableDrag(handle) {
        let dragging = false, ox = 0, oy = 0;
        handle.addEventListener('pointerdown', (e) => {
            dragging = true;
            const r = panel.getBoundingClientRect();
            ox = e.clientX - r.left; oy = e.clientY - r.top;
            setPos(r.left, r.top);                 // convert from centered anchor to px
            handle.setPointerCapture?.(e.pointerId);
            e.preventDefault();
        });
        handle.addEventListener('pointermove', (e) => {
            if (dragging) setPos(e.clientX - ox, e.clientY - oy);
        });
        const end = () => {
            if (!dragging) return;
            dragging = false;
            const r = panel.getBoundingClientRect();
            try { localStorage.setItem('zxm8_vkbd_pos', JSON.stringify({ left: r.left, top: r.top })); } catch {}
        };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    }

    function build() {
        const header = document.createElement('div');
        header.className = 'vkbd-header';
        const title = 'ZX-M8XXX' + (appVersion ? ' v' + appVersion : '');
        header.innerHTML = `<span class="vkbd-title">${title}</span><span class="vkbd-close" title="Hide keyboard">×</span>`;
        const close = header.querySelector('.vkbd-close');
        close.addEventListener('pointerdown', (e) => e.stopPropagation()); // don't start a drag
        close.addEventListener('click', () => toggle(false));
        enableDrag(header);
        panel.appendChild(header);
        for (const row of LAYOUT) {
            const rowEl = document.createElement('div');
            rowEl.className = 'vkbd-row';
            for (const def of row) rowEl.appendChild(makeKey(def));
            panel.appendChild(rowEl);
        }
        built = true;
    }

    // Live highlight: light keys whose matrix bit is low (pressed), virtual or real.
    getSpectrum().addFrameListener(() => {
        if (!built || panel.classList.contains('hidden')) return;
        const ks = ula().keyboardState;
        for (const k of keyEls) {
            if (!k.matrix) continue;
            const down = (ks[k.matrix[0]] & (1 << k.matrix[1])) === 0;
            k.el.classList.toggle('pressed', down);
        }
    });

    function toggle(show) {
        if (show && !built) build();
        if (!show) releaseAllMods(); // don't leave CAPS/SYMBOL latched when hidden
        panel.classList.toggle('hidden', !show);
        btn.classList.toggle('active', show);
        if (show) applySavedPos(); // restore dragged position once visible (real size known)
        try { localStorage.setItem('zxm8_vkbd', show ? '1' : '0'); } catch {}
    }

    btn.addEventListener('click', () => toggle(panel.classList.contains('hidden')));

    let visible = false;
    try { visible = localStorage.getItem('zxm8_vkbd') === '1'; } catch {}
    if (visible) toggle(true);
}
