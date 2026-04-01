// Trigger handlers — breakpoint/watchpoint/port/tape/disk trigger UI and callbacks
import { hex8, hex16 } from '../core/utils.js';

export function initTriggerHandlers({
    getSpectrum, setDisasmViewAddress, showMessage,
    updateDebugger, updateStatus, openDebuggerPanel,
    goToAddress, goToMemoryAddress
}) {

    // DOM elements (discovered internally)
    const triggerList = document.getElementById('triggerList');
    const triggerType = document.getElementById('triggerType');
    const triggerAddrInput = document.getElementById('triggerAddrInput');
    const triggerCondInput = document.getElementById('triggerCondInput');
    const btnAddTrigger = document.getElementById('btnAddTrigger');
    const btnClearTriggers = document.getElementById('btnClearTriggers');
    const triggerScreenSelect = document.getElementById('triggerScreenSelect');
    const triggerPxLabel = document.getElementById('triggerPxLabel');
    const triggerPxMode = document.getElementById('triggerPxMode');

    function updateScreenControls(type) {
        const isScreen = type === 'screen_bitmap' || type === 'screen_attr';
        triggerScreenSelect.classList.toggle('hidden', !isScreen);
        triggerPxLabel.classList.toggle('hidden', type !== 'screen_bitmap');
        if (type !== 'screen_bitmap') triggerPxMode.checked = false;
    }

    // Trigger type change handler
    triggerType.addEventListener('change', () => {
        const type = triggerType.value;
        updateScreenControls(type);
        if (type === 'tape_block') {
            triggerAddrInput.placeholder = 'TAPE';
            triggerAddrInput.disabled = true;
            triggerAddrInput.value = '';
        } else if (type === 'disk_read') {
            triggerAddrInput.placeholder = 'DISK';
            triggerAddrInput.disabled = true;
            triggerAddrInput.value = '';
        } else if (type === 'disk_sector') {
            triggerAddrInput.placeholder = 'TT:SS';
            triggerAddrInput.disabled = false;
        } else if (type.startsWith('port')) {
            triggerAddrInput.placeholder = 'PORT[&MASK]';
            triggerAddrInput.disabled = false;
        } else if (type === 'screen_bitmap') {
            triggerAddrInput.placeholder = triggerPxMode.checked ? 'X,Y,W,H' : 'C,R,W,H';
            triggerAddrInput.disabled = false;
        } else if (type === 'screen_attr') {
            triggerAddrInput.placeholder = 'C,R,W,H';
            triggerAddrInput.disabled = false;
        } else {
            triggerAddrInput.placeholder = '[P:]ADDR[-END]';
            triggerAddrInput.disabled = false;
        }
    });

    // Pixel mode checkbox toggles placeholder
    triggerPxMode.addEventListener('change', () => {
        if (triggerType.value === 'screen_bitmap') {
            triggerAddrInput.placeholder = triggerPxMode.checked ? 'X,Y,W,H' : 'C,R,W,H';
        }
    });

    // Add trigger button
    btnAddTrigger.addEventListener('click', () => {
        const spectrum = getSpectrum();
        const type = triggerType.value;
        const addrStr = triggerAddrInput.value.trim();
        const condition = triggerCondInput.value.trim();
        const skipCount = parseInt(document.getElementById('triggerSkipInput').value) || 0;

        // Parse address based on type
        let triggerSpec;
        if (type === 'tape_block') {
            triggerSpec = { type, start: 0, end: 0 };
        } else if (type === 'disk_read') {
            triggerSpec = { type, start: 0, end: 0 };
        } else if (type === 'disk_sector') {
            if (!addrStr) return;
            const parts = addrStr.split(':');
            const track = parseInt(parts[0], 10);
            const sector = parseInt(parts[1], 10);
            if (isNaN(track) || isNaN(sector)) {
                showMessage('Invalid track:sector (use TT:SS format)', 'error');
                return;
            }
            triggerSpec = { type, start: track, end: sector };
        } else if (type === 'screen_bitmap' || type === 'screen_attr') {
            if (!addrStr) return;
            const parts = addrStr.split(',').map(s => parseInt(s.trim(), 10));
            if (parts.length !== 4 || parts.some(isNaN)) {
                showMessage('Invalid format (use C,R,W,H or X,Y,W,H)', 'error');
                return;
            }
            let [col, row, w, h] = parts;
            const isPixel = type === 'screen_bitmap' && triggerPxMode.checked;
            if (isPixel) {
                // Pixel mode bounds: x 0-255, y 0-191, w 1-256, h 1-192
                if (col < 0 || col > 255 || row < 0 || row > 191) {
                    showMessage('Pixel X must be 0-255, Y must be 0-191', 'error');
                    return;
                }
                if (w < 1 || h < 1) { showMessage('Width and height must be >= 1', 'error'); return; }
                if (col + w > 256) w = 256 - col;
                if (row + h > 192) h = 192 - row;
            } else {
                // Cell mode bounds: col 0-31, row 0-23, w 1-32, h 1-24
                if (col < 0 || col > 31 || row < 0 || row > 23) {
                    showMessage('Column must be 0-31, row must be 0-23', 'error');
                    return;
                }
                if (w < 1 || h < 1) { showMessage('Width and height must be >= 1', 'error'); return; }
                if (col + w > 32) w = 32 - col;
                if (row + h > 24) h = 24 - row;
            }
            const screen = triggerScreenSelect.value;
            triggerSpec = { type, col, row, w, h, pixelMode: isPixel, screen, start: 0, end: 0 };
        } else if (type.startsWith('port')) {
            if (!addrStr) return;
            const parsed = spectrum.parsePortSpec(addrStr);
            if (!parsed) {
                showMessage('Invalid port address', 'error');
                return;
            }
            triggerSpec = { type, start: parsed.port, end: parsed.port, mask: parsed.mask };
        } else {
            if (!addrStr) return;
            const parsed = spectrum.parseAddressSpec(addrStr);
            if (!parsed) {
                showMessage('Invalid address', 'error');
                return;
            }
            triggerSpec = { type, start: parsed.start, end: parsed.end, page: parsed.page };
        }

        if (condition) triggerSpec.condition = condition;
        if (skipCount > 0) triggerSpec.skipCount = skipCount;

        if (spectrum.addTrigger(triggerSpec) < 0) {
            showMessage('Failed to add trigger', 'error');
            return;
        }

        triggerAddrInput.value = '';
        triggerAddrInput.disabled = false;
        triggerCondInput.value = '';
        document.getElementById('triggerSkipInput').value = '0';
        const typeLabel = spectrum.getTriggerLabel(type);
        const addrDisplay = type === 'tape_block' ? 'TAPE' : type === 'disk_read' ? 'DISK' : addrStr.toUpperCase();
        let msg = `${typeLabel} trigger set: ${addrDisplay}`;
        if (condition) msg += ` if ${condition}`;
        if (skipCount > 0) msg += ` (skip ${skipCount})`;
        showMessage(msg);
        updateDebugger();
    });

    // Enter key handlers
    triggerAddrInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnAddTrigger.click();
    });

    triggerCondInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnAddTrigger.click();
    });

    // Clear triggers button
    btnClearTriggers.addEventListener('click', () => {
        const spectrum = getSpectrum();
        const count = spectrum.getTriggers().length;
        if (count === 0) {
            showMessage('No triggers to clear', 'error');
            return;
        }
        spectrum.clearTriggers();
        showMessage(`Cleared ${count} trigger(s)`);
        updateDebugger();
    });

    // Trigger list click handler (remove, toggle, navigate)
    triggerList.addEventListener('click', (e) => {
        const spectrum = getSpectrum();
        const index = parseInt(e.target.dataset.index, 10);
        if (isNaN(index)) return;

        if (e.target.classList.contains('trigger-remove')) {
            const triggers = spectrum.getTriggers();
            const t = triggers.find(tr => tr.index === index);
            spectrum.removeTrigger(index);
            showMessage(`Trigger removed: ${t ? spectrum.formatTrigger(t) : index}`);
            updateDebugger();
        } else if (e.target.classList.contains('trigger-toggle')) {
            const enabled = spectrum.toggleTrigger(index);
            showMessage(`Trigger ${enabled ? 'enabled' : 'disabled'}`);
            updateDebugger();
        } else if (e.target.classList.contains('trigger-desc')) {
            // Navigate to address
            const triggers = spectrum.getTriggers();
            const t = triggers.find(tr => tr.index === index);
            if (t && !t.type.startsWith('port') && !t.type.startsWith('screen') &&
                t.type !== 'tape_block' && t.type !== 'disk_read' && t.type !== 'disk_sector') {
                goToAddress(t.start);
                goToMemoryAddress(t.start);
                updateDebugger();
            }
        }
    });

    // Breakpoint/Watchpoint/Port hit callbacks (for compatibility)
    getSpectrum().onBreakpoint = (addr) => {
        showMessage(`Breakpoint hit at ${hex16(addr)}`);
        setDisasmViewAddress(null); // Force disasm to show PC
        openDebuggerPanel();
        updateDebugger();
        updateStatus();
    };

    getSpectrum().onWatchpoint = (wp) => {
        const typeStr = wp.type === 'read' ? 'Read' : 'Write';
        const instrInfo = wp.instrPC !== undefined ? ` by ${hex16(wp.instrPC)}` : '';
        showMessage(`Break on ${typeStr} at ${hex16(wp.addr)} = ${hex8(wp.val)}${instrInfo}`);
        // Navigate disasm to the instruction that triggered the watchpoint (not current PC which may be in ISR)
        if (wp.instrPC !== undefined) {
            setDisasmViewAddress(wp.instrPC);
        } else {
            setDisasmViewAddress(null); // Fallback: show current PC
        }
        openDebuggerPanel();
        goToMemoryAddress(wp.addr);
        updateDebugger();
        updateStatus();
    };

    getSpectrum().onPortBreakpoint = (pb) => {
        const dirStr = pb.direction === 'in' ? 'IN' : 'OUT';
        const portHex = hex16(pb.port);
        let msg = `Port breakpoint: ${dirStr} ${portHex}`;
        if (pb.val !== undefined) msg += ` = ${hex8(pb.val)}`;
        showMessage(msg);
        setDisasmViewAddress(null); // Force disasm to show PC
        openDebuggerPanel();
        updateDebugger();
        updateStatus();
    };

    getSpectrum().onCodePathHit = (addr) => {
        showMessage(`Code path diverged at $${hex16(addr)}`);
        setDisasmViewAddress(null);
        openDebuggerPanel();
        updateDebugger();
        updateStatus();
    };

    // Unified trigger callback
    getSpectrum().onTrigger = (info) => {
        if (info && info.type === 'tape_block') {
            showMessage(`Tape block trigger hit (block ${info.blockIndex + 1})`);
            setDisasmViewAddress(null);
            openDebuggerPanel();
            updateDebugger();
            updateStatus();
            return;
        }
        if (info && info.type === 'disk_read') {
            showMessage('Disk read trigger hit');
            setDisasmViewAddress(null);
            openDebuggerPanel();
            updateDebugger();
            updateStatus();
            return;
        }
        if (info && info.type === 'disk_sector') {
            const t = String(info.track).padStart(2, '0');
            const s = String(info.sector).padStart(2, '0');
            showMessage(`Disk sector trigger: T${t}:S${s}`);
            setDisasmViewAddress(null);
            openDebuggerPanel();
            updateDebugger();
            updateStatus();
            return;
        }
        // Already handled by individual callbacks above for legacy types
        setDisasmViewAddress(null); // Force disasm to show PC
        updateDebugger();
    };
}
