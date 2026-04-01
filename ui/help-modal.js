// help-modal.js — Full help dialog with lazy-loaded content and section navigation (extracted from index.html)

export function initHelpModal() {
    const fullHelpDialog = document.getElementById('fullHelpDialog');
    const btnHelpFull = document.getElementById('btnHelpFull');

    let contentLoaded = false;

    function showHelpSection(sectionId) {
        const navBtns = fullHelpDialog.querySelectorAll('.fullhelp-nav-btn');
        const sections = fullHelpDialog.querySelectorAll('.fullhelp-section');
        navBtns.forEach(btn => btn.classList.remove('active'));
        sections.forEach(sec => sec.classList.add('hidden'));
        const activeBtn = fullHelpDialog.querySelector(`.fullhelp-nav-btn[data-section="${sectionId}"]`);
        const activeSection = document.getElementById('help-' + sectionId);
        if (activeBtn) activeBtn.classList.add('active');
        if (activeSection) activeSection.classList.remove('hidden');
    }

    function bindContentEvents() {
        const btnFullHelpClose = document.getElementById('btnFullHelpClose');
        btnFullHelpClose.addEventListener('click', () => fullHelpDialog.classList.add('hidden'));

        fullHelpDialog.addEventListener('click', (e) => {
            if (e.target === fullHelpDialog) fullHelpDialog.classList.add('hidden');
        });

        fullHelpDialog.addEventListener('wheel', (e) => {
            const content = fullHelpDialog.querySelector('.fullhelp-body');
            if (!content || !content.contains(e.target)) {
                e.preventDefault();
            }
        });

        fullHelpDialog.querySelectorAll('.fullhelp-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                showHelpSection(btn.getAttribute('data-section'));
            });
        });
    }

    btnHelpFull.addEventListener('click', () => {
        if (contentLoaded) {
            fullHelpDialog.classList.remove('hidden');
            showHelpSection('overview');
            return;
        }
        fetch('ui/help-content.html')
            .then(resp => resp.text())
            .then(html => {
                fullHelpDialog.innerHTML = html;
                contentLoaded = true;
                bindContentEvents();
                fullHelpDialog.classList.remove('hidden');
                showHelpSection('overview');
            })
            .catch(err => {
                console.error('Failed to load help content:', err);
            });
    });
}
