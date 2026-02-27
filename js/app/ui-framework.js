// UI Framework — Tab system, help modal, collapse/expand behavior
// Extracted from index.html lines ~8477-8616

export function initUIFramework(deps = {}) {
    const { getTestRunner, updateGraphicsViewer, updateTraceList } = deps;
    // Help modal
    const helpModal = document.getElementById('helpModal');
    const btnHelpClose = document.getElementById('btnHelpClose');

    btnHelpClose.addEventListener('click', () => helpModal.classList.add('hidden'));
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) helpModal.classList.add('hidden');
    });

    // Full Help Dialog
    const fullHelpDialog = document.getElementById('fullHelpDialog');
    const btnHelpFull = document.getElementById('btnHelpFull');
    const btnFullHelpClose = document.getElementById('btnFullHelpClose');
    const helpNavBtns = fullHelpDialog.querySelectorAll('.fullhelp-nav-btn');
    const helpSections = fullHelpDialog.querySelectorAll('.fullhelp-section');

    function showHelpSection(sectionId) {
        helpNavBtns.forEach(btn => btn.classList.remove('active'));
        helpSections.forEach(sec => sec.classList.add('hidden'));
        const activeBtn = fullHelpDialog.querySelector(`.fullhelp-nav-btn[data-section="${sectionId}"]`);
        const activeSection = document.getElementById('help-' + sectionId);
        if (activeBtn) activeBtn.classList.add('active');
        if (activeSection) activeSection.classList.remove('hidden');
    }

    btnHelpFull.addEventListener('click', () => {
        fullHelpDialog.classList.remove('hidden');
        showHelpSection('overview');
    });

    btnFullHelpClose.addEventListener('click', () => fullHelpDialog.classList.add('hidden'));

    fullHelpDialog.addEventListener('click', (e) => {
        if (e.target === fullHelpDialog) fullHelpDialog.classList.add('hidden');
    });

    helpNavBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.getAttribute('data-section');
            showHelpSection(section);
        });
    });

    // ========== Tab System ==========
    const tabContainer = document.getElementById('tabContainer');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            const isCurrentlyActive = btn.classList.contains('active');
            const isCollapsed = tabContainer.classList.contains('collapsed');

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
                // Update graphics viewer when switching to its tab
                if (tabId === 'graphics' && updateGraphicsViewer) {
                    updateGraphicsViewer();
                }
                // Load tests when switching to tests tab
                if (tabId === 'tests' && getTestRunner?.() && getTestRunner().tests.length === 0) {
                    getTestRunner().loadTests();
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
            if (panelId === 'trace' && updateTraceList) {
                updateTraceList();
            }
        });
    });

    // ========== Info Sub-tabs (I/O, Timings, Opcodes) ==========
    document.querySelectorAll('.info-subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.infotab;
            // Update buttons
            document.querySelectorAll('.info-subtab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Update content
            document.querySelectorAll('.info-subtab-content').forEach(c => c.classList.remove('active'));
            document.getElementById('info-' + tabId).classList.add('active');
        });
    });

    // ========== Tools Sub-tabs (Explorer, Compare, Tests, Export) ==========
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
                if (getTestRunner?.()) {
                    getTestRunner().loadTests();
                }
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
}
