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

    // Check if instruction should have a blank line after it
    function isFlowBreak(mnemonic) {
        const mn = mnemonic.replace(/<[^>]+>/g, '').toUpperCase();
        return mn.startsWith('JP') || mn.startsWith('JR') ||
               mn.startsWith('RET') || mn.startsWith('DJNZ') ||
               mn.startsWith('RST') || mn.startsWith('CALL') ||
               mn === 'HALT';
    }

    return { isDebuggerVisible, isFlowBreak };
}
