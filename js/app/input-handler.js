// Input Handler — gamepad polling, mouse input, keyboard handlers
// Extracted from index.html lines ~30787-31107

export function updateGamepadStatus(spectrum) {
    const chkGamepad = document.getElementById('chkGamepad');
    const gamepadStatus = document.getElementById('gamepadStatus');
    if (!chkGamepad.checked) {
        gamepadStatus.textContent = '';
        return;
    }
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let found = false;
    for (let gp of gamepads) {
        if (gp && gp.connected) {
            gamepadStatus.textContent = `(${gp.id.substring(0, 30)})`;
            gamepadStatus.style.color = 'var(--green)';
            found = true;
            break;
        }
    }
    if (!found) {
        gamepadStatus.textContent = '(No gamepad detected)';
        gamepadStatus.style.color = 'var(--text-dim)';
    }
}

export function updateGamepadCalibDisplay(spectrum) {
    const m = spectrum.gamepadMapping || {};
    const fmt = (entry) => {
        if (!entry) return '-';
        if (entry.type === 'axis') {
            return `Axis ${entry.index} ${entry.direction > 0 ? '+' : '-'}`;
        } else if (entry.type === 'button') {
            return `Button ${entry.index}`;
        }
        return '-';
    };
    document.getElementById('gamepadMapUp').textContent = fmt(m.up);
    document.getElementById('gamepadMapDown').textContent = fmt(m.down);
    document.getElementById('gamepadMapLeft').textContent = fmt(m.left);
    document.getElementById('gamepadMapRight').textContent = fmt(m.right);
    document.getElementById('gamepadMapFire').textContent = fmt(m.fire);
    document.getElementById('gamepadMapC').textContent = fmt(m.c);
    document.getElementById('gamepadMapA').textContent = fmt(m.a);
    document.getElementById('gamepadMapStart').textContent = fmt(m.start);
}

let gamepadBaseline = null;

export function captureGamepadBaseline() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let gp of gamepads) {
        if (gp && gp.connected) {
            gamepadBaseline = {
                axes: [...gp.axes],
                buttons: gp.buttons.map(b => b.pressed)
            };
            return;
        }
    }
    gamepadBaseline = null;
}

let gamepadCalibrating = null;
let gamepadCalibPollId = null;

export function pollGamepadForCalibration(spectrum) {
    if (!gamepadCalibrating) return;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (let g of gamepads) {
        if (g && g.connected) { gp = g; break; }
    }
    if (!gp || !gamepadBaseline) {
        gamepadCalibPollId = requestAnimationFrame(() => pollGamepadForCalibration(spectrum));
        return;
    }

    const gamepadCalibStatus = document.getElementById('gamepadCalibStatus');

    // Check for axis changes (threshold 0.4 difference from baseline)
    for (let i = 0; i < gp.axes.length; i++) {
        const diff = gp.axes[i] - (gamepadBaseline.axes[i] || 0);
        if (Math.abs(diff) > 0.4) {
            // Found an axis movement
            const mapping = {
                type: 'axis',
                index: i,
                direction: diff > 0 ? 1 : -1,
                threshold: 0.3
            };
            if (!spectrum.gamepadMapping) spectrum.gamepadMapping = {};
            spectrum.gamepadMapping[gamepadCalibrating] = mapping;
            gamepadCalibStatus.textContent = `Assigned: Axis ${i} ${diff > 0 ? '+' : '-'}`;
            gamepadCalibrating = null;
            updateGamepadCalibDisplay(spectrum);
            return;
        }
    }

    // Check for button presses
    for (let i = 0; i < gp.buttons.length; i++) {
        if (gp.buttons[i].pressed && !(gamepadBaseline.buttons[i])) {
            const mapping = { type: 'button', index: i };
            if (!spectrum.gamepadMapping) spectrum.gamepadMapping = {};
            spectrum.gamepadMapping[gamepadCalibrating] = mapping;
            gamepadCalibStatus.textContent = `Assigned: Button ${i}`;
            gamepadCalibrating = null;
            updateGamepadCalibDisplay(spectrum);
            return;
        }
    }

    gamepadCalibPollId = requestAnimationFrame(() => pollGamepadForCalibration(spectrum));
}

export function updateMouseStatus(spectrum) {
    const chkKempstonMouse = document.getElementById('chkKempstonMouse');
    const mouseStatus = document.getElementById('mouseStatus');
    const btnMouse = document.getElementById('btnMouse');
    const mouseCaptured = document.pointerLockElement === document.getElementById('screen');

    // Update settings panel status text
    if (!chkKempstonMouse.checked) {
        mouseStatus.textContent = '';
        btnMouse.style.display = 'none';
    } else if (mouseCaptured) {
        mouseStatus.textContent = '(Captured - Esc to release)';
        mouseStatus.style.color = 'var(--green)';
        btnMouse.style.display = '';
        btnMouse.textContent = '\uD83D\uDDB1\uFE0F\u2713';
        btnMouse.title = 'Mouse captured (Esc to release)';
    } else {
        mouseStatus.textContent = '(Click \uD83D\uDDB1\uFE0F to capture)';
        mouseStatus.style.color = 'var(--text-dim)';
        btnMouse.style.display = '';
        btnMouse.textContent = '\uD83D\uDDB1\uFE0F';
        btnMouse.title = 'Capture mouse (Kempston Mouse)';
    }
}

export function initInputHandler(spectrum, showMessage) {
    const chkKempston = document.getElementById('chkKempston');
    const chkKempstonExtended = document.getElementById('chkKempstonExtended');
    const chkGamepad = document.getElementById('chkGamepad');
    const chkKempstonMouse = document.getElementById('chkKempstonMouse');
    const chkMouseWheel = document.getElementById('chkMouseWheel');
    const canvas = document.getElementById('screen');
    const btnMouse = document.getElementById('btnMouse');
    let mouseCaptured = false;

    // Kempston joystick
    chkKempston.addEventListener('change', () => {
        spectrum.kempstonEnabled = chkKempston.checked;
        showMessage(chkKempston.checked ? 'Kempston joystick enabled (Numpad)' : 'Kempston joystick disabled');
    });

    // Extended Kempston Joystick (C/A/Start buttons)
    chkKempstonExtended.addEventListener('change', () => {
        spectrum.kempstonExtendedEnabled = chkKempstonExtended.checked;
        showMessage(chkKempstonExtended.checked ?
            'Extended Kempston enabled ([ = C, ] = A, \\ = Start)' :
            'Extended Kempston disabled');
    });

    // Hardware Gamepad
    chkGamepad.addEventListener('change', () => {
        spectrum.gamepadEnabled = chkGamepad.checked;
        if (chkGamepad.checked) {
            // Enable Kempston joystick automatically
            chkKempston.checked = true;
            spectrum.kempstonEnabled = true;
        }
        updateGamepadStatus(spectrum);
        showMessage(chkGamepad.checked ?
            'Hardware gamepad enabled' :
            'Hardware gamepad disabled');
    });

    // Listen for gamepad connect/disconnect
    window.addEventListener('gamepadconnected', (e) => {
        updateGamepadStatus(spectrum);
        if (chkGamepad.checked) {
            showMessage(`Gamepad connected: ${e.gamepad.id.substring(0, 40)}`);
        }
    });
    window.addEventListener('gamepaddisconnected', (e) => {
        updateGamepadStatus(spectrum);
        if (chkGamepad.checked) {
            showMessage('Gamepad disconnected');
        }
    });

    // Gamepad Calibration
    const gamepadCalibDialog = document.getElementById('gamepadCalibDialog');
    const gamepadCalibInfo = document.getElementById('gamepadCalibInfo');
    const gamepadCalibStatus = document.getElementById('gamepadCalibStatus');
    const btnCalibrateGamepad = document.getElementById('btnCalibrateGamepad');

    btnCalibrateGamepad.addEventListener('click', () => {
        // Show gamepad info
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let found = false;
        for (let gp of gamepads) {
            if (gp && gp.connected) {
                gamepadCalibInfo.textContent = gp.id;
                gamepadCalibInfo.style.color = 'var(--green)';
                found = true;
                break;
            }
        }
        if (!found) {
            gamepadCalibInfo.textContent = 'No gamepad detected - connect one first';
            gamepadCalibInfo.style.color = 'var(--text-dim)';
        }
        gamepadCalibStatus.textContent = '';
        gamepadCalibrating = null;
        updateGamepadCalibDisplay(spectrum);
        gamepadCalibDialog.classList.remove('hidden');
    });

    // Assign buttons
    document.querySelectorAll('.gamepad-assign-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const dir = btn.dataset.dir;
            gamepadCalibrating = dir;
            gamepadCalibStatus.textContent = `Move stick ${dir.toUpperCase()} or press button...`;
            captureGamepadBaseline();
            if (gamepadCalibPollId) cancelAnimationFrame(gamepadCalibPollId);
            gamepadCalibPollId = requestAnimationFrame(() => pollGamepadForCalibration(spectrum));
        });
    });

    document.getElementById('btnGamepadCalibReset').addEventListener('click', () => {
        spectrum.gamepadMapping = null;
        localStorage.removeItem('gamepadMapping');
        updateGamepadCalibDisplay(spectrum);
        gamepadCalibStatus.textContent = 'Mapping reset to default';
    });

    document.getElementById('btnGamepadCalibSave').addEventListener('click', () => {
        if (spectrum.gamepadMapping) {
            localStorage.setItem('gamepadMapping', JSON.stringify(spectrum.gamepadMapping));
            showMessage('Gamepad mapping saved');
        }
        gamepadCalibDialog.classList.add('hidden');
        if (gamepadCalibPollId) cancelAnimationFrame(gamepadCalibPollId);
        gamepadCalibrating = null;
    });

    document.getElementById('btnGamepadCalibClose').addEventListener('click', () => {
        gamepadCalibDialog.classList.add('hidden');
        if (gamepadCalibPollId) cancelAnimationFrame(gamepadCalibPollId);
        gamepadCalibrating = null;
    });

    // Load saved gamepad mapping
    try {
        const savedMapping = localStorage.getItem('gamepadMapping');
        if (savedMapping) {
            spectrum.gamepadMapping = JSON.parse(savedMapping);
        }
    } catch (e) {}

    // Mouse Wheel checkbox
    chkMouseWheel.addEventListener('change', () => {
        spectrum.kempstonMouseWheelEnabled = chkMouseWheel.checked;
        showMessage(chkMouseWheel.checked ?
            'Mouse wheel enabled (bits 7:4)' :
            'Mouse wheel disabled');
    });

    // Kempston Mouse
    chkKempstonMouse.addEventListener('change', () => {
        spectrum.kempstonMouseEnabled = chkKempstonMouse.checked;
        if (!chkKempstonMouse.checked && mouseCaptured) {
            document.exitPointerLock();
        }
        updateMouseStatus(spectrum);
        showMessage(chkKempstonMouse.checked ?
            'Kempston Mouse enabled - click \uD83D\uDDB1\uFE0F button to capture' :
            'Kempston Mouse disabled');
    });

    // Mouse button click to capture
    btnMouse.addEventListener('click', () => {
        if (!mouseCaptured) {
            canvas.requestPointerLock();
        }
    });

    // Pointer Lock for mouse capture (also works by clicking canvas)
    canvas.addEventListener('click', () => {
        if (chkKempstonMouse.checked && !mouseCaptured) {
            canvas.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        mouseCaptured = document.pointerLockElement === canvas;
        updateMouseStatus(spectrum);
        if (mouseCaptured) {
            showMessage('Mouse captured - press Escape to release');
        }
    });

    document.addEventListener('pointerlockerror', () => {
        showMessage('Failed to capture mouse', 'error');
    });

    // Mouse movement when captured
    document.addEventListener('mousemove', (e) => {
        if (mouseCaptured && spectrum.kempstonMouseEnabled) {
            // movementX/Y give relative movement
            spectrum.updateMousePosition(e.movementX, e.movementY);
        }
    });

    // Mouse buttons when captured
    canvas.addEventListener('mousedown', (e) => {
        if (mouseCaptured && spectrum.kempstonMouseEnabled) {
            spectrum.setMouseButton(e.button, true);
            e.preventDefault();
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (mouseCaptured && spectrum.kempstonMouseEnabled) {
            spectrum.setMouseButton(e.button, false);
            e.preventDefault();
        }
    });

    // Prevent context menu when mouse captured
    canvas.addEventListener('contextmenu', (e) => {
        if (mouseCaptured) {
            e.preventDefault();
        }
    });

    // Mouse wheel when captured
    document.addEventListener('wheel', (e) => {
        if (mouseCaptured && spectrum.kempstonMouseEnabled && spectrum.kempstonMouseWheelEnabled) {
            spectrum.updateMouseWheel(e.deltaY);
            e.preventDefault();
        }
    }, { passive: false });
}
