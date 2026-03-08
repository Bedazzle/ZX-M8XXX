// tab-system.js — Main tabs, panel tabs, info/tools/settings sub-tabs, openDebuggerPanel (extracted from index.html)

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
            // Refresh trace list when trace panel is selected
            const updateTraceList = getUpdateTraceList();
            if (panelId === 'trace' && typeof updateTraceList === 'function') {
                updateTraceList();
            }
        });
    });

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

    // ========== Settings Sub-tabs (Display, Input, Media, Audio) ==========
    document.querySelectorAll('.settings-subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.settingstab;
            // Update buttons
            document.querySelectorAll('.settings-subtab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Update content
            document.querySelectorAll('.settings-subtab-content').forEach(c => c.classList.remove('active'));
            document.getElementById('settings-' + tabId).classList.add('active');
        });
    });

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
