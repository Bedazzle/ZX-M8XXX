// tab-system.js — Main tabs, panel tabs, info/tools/settings sub-tabs, openDebuggerPanel (extracted from index.html)

import { storageGet, storageSet, storageRemove } from '../core/utils.js';

export function initTabSystem({ getTestRunner, getEnsureGraphicsViewer, getEnsureInfoPanel, getEnsureTextRipper, getUpdateTraceList }) {
    const tabContainer = document.getElementById('tabContainer');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            const isCurrentlyActive = btn.classList.contains('active');

            if (isCurrentlyActive) {
                // Toggle collapse when clicking active tab
                tabContainer.classList.toggle('collapsed');
            } else {
                // Switch to different tab and expand
                tabContainer.classList.remove('collapsed');
                tabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('tab-' + tabId).classList.add('active');
                storageSet('zxm8_activeTab', tabId);
                // Load tests when switching to tests tab
                const testRunner = getTestRunner();
                if (tabId === 'tests' && testRunner && testRunner.tests.length === 0) {
                    testRunner.loadTests();
                }
            }
        });
    });

    // ========== Panel Tabs (Breakpoints/Labels/Tools/Trace) ==========
    document.querySelectorAll('.panel-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.dataset.panel;
            // Update buttons
            document.querySelectorAll('.panel-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Update panels
            document.querySelectorAll('.panel-tab-content').forEach(p => p.classList.remove('active'));
            document.getElementById('panel-' + panelId).classList.add('active');
            storageSet('zxm8_activePanel', panelId);
            // Refresh trace list when trace panel is selected
            const updateTraceList = getUpdateTraceList();
            if (panelId === 'trace' && typeof updateTraceList === 'function') {
                updateTraceList();
            }
        });
    });

    // ========== Splitters (resizable debug areas) ==========
    // Each drag bar drives one CSS variable, persisted to localStorage; double-click resets.
    // axis 'y' = drag changes height, 'x' = drag changes width.
    // invert = the sized element is after the bar, so dragging down/right shrinks it.
    function initSplitter(id, cssVar, storageKey, getStartSize, minS, maxS, axis = 'y', invert = false) {
        const bar = document.getElementById(id);
        if (!bar) return;
        const applySize = (s) => {
            if (s) document.documentElement.style.setProperty(cssVar, s + 'px');
            else document.documentElement.style.removeProperty(cssVar);
        };
        let size = parseInt(storageGet(storageKey)) || null;
        if (size) size = Math.max(minS, Math.min(maxS, size));
        applySize(size);

        bar.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const startPos = axis === 'x' ? e.clientX : e.clientY;
            const startS = size || getStartSize();
            bar.classList.add('dragging');
            const onMove = (ev) => {
                const pos = axis === 'x' ? ev.clientX : ev.clientY;
                const delta = (pos - startPos) * (invert ? -1 : 1);
                size = Math.max(minS, Math.min(maxS, startS + delta));
                applySize(size);
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                bar.classList.remove('dragging');
                if (size) storageSet(storageKey, size);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        bar.addEventListener('dblclick', () => {
            size = null;
            applySize(null);
            storageRemove(storageKey);
        });
    }

    // Disasm/memory panel height (left + right column share --debug-row-h)
    initSplitter('debugRowSplitter', '--debug-row-h', 'zxm8_debugRowHeight', () => {
        const panel = document.getElementById('leftPanel');
        return panel ? panel.offsetHeight : 720;
    }, 300, 1400);

    // Left panel width (disasm/memory column); min 400 keeps the toolbar on one line
    initSplitter('debugColSplitter', '--left-panel-w', 'zxm8_leftPanelWidth', () => {
        const panel = document.getElementById('leftPanel');
        return panel ? panel.offsetWidth : 480;
    }, 400, 900, 'x');

    // Right column width (registers + memory panel) — landscape only, the bar is
    // hidden in portrait where the column auto-fills the remaining row width
    initSplitter('debugColSplitterRight', '--right-panel-w', 'zxm8_rightPanelWidth', () => {
        const col = document.querySelector('.right-column');
        return col ? col.offsetWidth : 600;
    }, 520, 1100, 'x');

    // Assembler area total height (bar at the bottom — drag down for a taller tab)
    initSplitter('asmHeightSplitter', '--asm-container-h', 'zxm8_asmContainerHeight', () => {
        const c = document.querySelector('.assembler-container');
        return c ? c.offsetHeight : 700;
    }, 500, 2000, 'y');

    // Assembler split-pane width (bar sits left of the second pane — inverted)
    initSplitter('asmPaneSplitter', '--asm-pane2-w', 'zxm8_asmPane2Width', () => {
        const p = document.getElementById('asmPane2');
        return p ? p.offsetWidth : 400;
    }, 240, 1200, 'x', true);

    // Assembler output pane height (bar sits above the output, so the drag is inverted)
    initSplitter('asmOutputSplitter', '--asm-output-h', 'zxm8_asmOutputHeight', () => {
        const out = document.querySelector('.asm-output-container');
        return out ? out.offsetHeight : 150;
    }, 60, 500, 'y', true);

    // Sub-panel list height; with no saved value, start from the active tab's current list
    const ACTIVE_LIST = '.panel-tab-content.active .breakpoint-list, ' +
                        '.panel-tab-content.active .watches-list, ' +
                        '.panel-tab-content.active .trace-list, ' +
                        '.panel-tab-content.active .poke-list';
    initSplitter('panelSplitter', '--subpanel-list-h', 'zxm8_subpanelHeight', () => {
        const list = document.querySelector(ACTIVE_LIST);
        return list ? list.offsetHeight : 100;
    }, 40, 800);

    // ========== Tools Sub-tabs (Explorer, Compare, Tests, Export, Mapper, GFX, Info) ==========
    let testsTabVisited = false;
    document.querySelectorAll('.tools-subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.toolstab;
            // Update buttons
            document.querySelectorAll('.tools-subtab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Update content
            document.querySelectorAll('.tools-subtab-content').forEach(c => c.classList.remove('active'));
            document.getElementById('tools-' + tabId).classList.add('active');
            storageSet('zxm8_activeUtilsTab', tabId);
            // Auto-load tests on first visit to Tests tab
            if (tabId === 'tests' && !testsTabVisited) {
                testsTabVisited = true;
                const testRunner = getTestRunner();
                if (testRunner) {
                    testRunner.loadTests();
                }
            }
            // Lazy-load graphics viewer on first visit to GFX tab
            if (tabId === 'graphics') {
                const ensureGfx = getEnsureGraphicsViewer();
                if (ensureGfx) ensureGfx();
            }
            // Lazy-load info panel on first visit to Info tab
            if (tabId === 'info') {
                const ensureInfo = getEnsureInfoPanel();
                if (ensureInfo) ensureInfo();
            }
            // Lazy-load text ripper on first visit to OCR tab
            if (tabId === 'ocr') {
                const ensureOcr = getEnsureTextRipper();
                if (ensureOcr) ensureOcr();
            }
        });
    });

    // ========== Settings Sub-tabs (Display, Input, Tape, Disk, Audio, Machines, Signatures) ==========
    document.querySelectorAll('.settings-subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.settingstab;
            // Update buttons
            document.querySelectorAll('.settings-subtab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Update content
            document.querySelectorAll('.settings-subtab-content').forEach(c => c.classList.remove('active'));
            document.getElementById('settings-' + tabId).classList.add('active');
            storageSet('zxm8_activeSettingsTab', tabId);
        });
    });

    // ========== Restore last active tabs ==========
    // Deferred so the lazy-load getters (tests, GFX, info, OCR) are assigned before
    // any restored click triggers them.
    setTimeout(() => {
        const restore = (key, selector) => {
            const saved = storageGet(key);
            if (!saved) return;
            const btn = document.querySelector(selector.replace('%', saved));
            if (btn && !btn.classList.contains('active')) btn.click();
        };
        restore('zxm8_activeTab', '.tab-btn[data-tab="%"]');
        restore('zxm8_activePanel', '.panel-tab-btn[data-panel="%"]');
        restore('zxm8_activeUtilsTab', '.tools-subtab-btn[data-toolstab="%"]');
        restore('zxm8_activeSettingsTab', '.settings-subtab-btn[data-settingstab="%"]');
    }, 0);

    function openDebuggerPanel() {
        // Expand tabs and switch to debugger tab
        tabContainer.classList.remove('collapsed');
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        document.querySelector('[data-tab="debugger"]').classList.add('active');
        document.getElementById('tab-debugger').classList.add('active');
    }

    return { openDebuggerPanel };
}
