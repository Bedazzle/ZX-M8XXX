// Navigation History (per-panel) — back/forward navigation for disasm panels

export function initNavHistory({ goToAddressNoHistory }) {
    const NAV_HISTORY_MAX = 50;

    // Left panel history
    const leftNavHistory = [];
    let leftNavHistoryIndex = -1;

    // Right panel history
    const rightNavHistory = [];
    let rightNavHistoryIndex = -1;

    function navPushHistory(addr, panel = 'left') {
        if (addr === null || addr === undefined) return;
        addr = addr & 0xffff;
        const history = panel === 'right' ? rightNavHistory : leftNavHistory;
        let index = panel === 'right' ? rightNavHistoryIndex : leftNavHistoryIndex;

        // Don't push if same as current
        if (index >= 0 && history[index] === addr) return;
        // Truncate forward history
        history.length = index + 1;
        history.push(addr);
        // Limit size
        if (history.length > NAV_HISTORY_MAX) {
            history.shift();
        }
        if (panel === 'right') {
            rightNavHistoryIndex = history.length - 1;
        } else {
            leftNavHistoryIndex = history.length - 1;
        }
        updateNavButtons();
    }

    function navBack(panel = 'left') {
        const history = panel === 'right' ? rightNavHistory : leftNavHistory;
        let index = panel === 'right' ? rightNavHistoryIndex : leftNavHistoryIndex;

        if (index > 0) {
            index--;
            if (panel === 'right') {
                rightNavHistoryIndex = index;
            } else {
                leftNavHistoryIndex = index;
            }
            const addr = history[index];
            goToAddressNoHistory(addr, panel);
            updateNavButtons();
        }
    }

    function navForward(panel = 'left') {
        const history = panel === 'right' ? rightNavHistory : leftNavHistory;
        let index = panel === 'right' ? rightNavHistoryIndex : leftNavHistoryIndex;

        if (index < history.length - 1) {
            index++;
            if (panel === 'right') {
                rightNavHistoryIndex = index;
            } else {
                leftNavHistoryIndex = index;
            }
            const addr = history[index];
            goToAddressNoHistory(addr, panel);
            updateNavButtons();
        }
    }

    function updateNavButtons() {
        // Left panel buttons — also disabled while Follow PC is on
        // (manual navigation has no effect when the view tracks PC)
        const followPC = !!document.getElementById('chkFollowPC')?.checked;
        const btnLeftBack = document.getElementById('btnDisasmPgUp');
        const btnLeftFwd = document.getElementById('btnDisasmPgDn');
        if (btnLeftBack) btnLeftBack.disabled = followPC || leftNavHistoryIndex <= 0;
        if (btnLeftFwd) btnLeftFwd.disabled = followPC || leftNavHistoryIndex >= leftNavHistory.length - 1;

        // Right panel buttons
        const btnRightBack = document.getElementById('btnRightDisasmPgUp');
        const btnRightFwd = document.getElementById('btnRightDisasmPgDn');
        if (btnRightBack) btnRightBack.disabled = rightNavHistoryIndex <= 0;
        if (btnRightFwd) btnRightFwd.disabled = rightNavHistoryIndex >= rightNavHistory.length - 1;
    }

    return {
        navPushHistory,
        navBack,
        navForward,
        updateNavButtons,
        getLeftHistory: () => ({ history: leftNavHistory, index: leftNavHistoryIndex }),
        getRightHistory: () => ({ history: rightNavHistory, index: rightNavHistoryIndex })
    };
}
