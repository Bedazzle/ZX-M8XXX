import { isFlowBreak } from './mnemonic-format.js';
// layout-helpers.js — Layout detection and flow break utilities (extracted from index.html)

export function initLayoutHelpers() {
    const debuggerPanel = document.getElementById('debuggerPanel');
    const tabContainer = document.getElementById('tabContainer');

    // Check if in landscape mode (side-by-side layout)
    function isLandscapeMode() {
        return window.innerWidth >= 1400;
    }

    // Check if debugger panel is visible
    function isDebuggerVisible() {
        return debuggerPanel.classList.contains('open') || isLandscapeMode();
    }

    // Auto-expand tabs in landscape mode
    function checkLandscapeMode() {
        if (isLandscapeMode() && tabContainer.classList.contains('collapsed')) {
            tabContainer.classList.remove('collapsed');
        }
    }

    // Check on page load and resize
    checkLandscapeMode();
    window.addEventListener('resize', checkLandscapeMode);

    return { isDebuggerVisible, isFlowBreak };
}
