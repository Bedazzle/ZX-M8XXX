// =====================================================================
// Game Browser (ZXInfo API / Spectrum Computing)
// =====================================================================
// Extracted from index.html inline script

// --- DOM element references ---
const gameBrowserDialog = document.getElementById('gameBrowserDialog');
const btnGameBrowserClose = document.getElementById('btnGameBrowserClose');
const gameBrowserSearch = document.getElementById('gameBrowserSearch');
const btnGameBrowserSearchGo = document.getElementById('btnGameBrowserSearchGo');
const gameBrowserResults = document.getElementById('gameBrowserResults');
const gameBrowserDetail = document.getElementById('gameBrowserDetail');
const gameBrowserDetailTitle = document.getElementById('gameBrowserDetailTitle');
const gameBrowserDetailScreen = document.getElementById('gameBrowserDetailScreen');
const gameBrowserDetailInfo = document.getElementById('gameBrowserDetailInfo');
const gameBrowserReleasesList = document.getElementById('gameBrowserReleasesList');
const gameBrowserExternal = document.getElementById('gameBrowserExternal');
const btnGameBrowserPrev = document.getElementById('btnGameBrowserPrev');
const btnGameBrowserNext = document.getElementById('btnGameBrowserNext');
const gameBrowserPageInfo = document.getElementById('gameBrowserPageInfo');

// --- Game browser state ---
export const gameBrowser = {
    allResults: [],  // All fetched results for client-side pagination
    results: [],     // Current page results
    selectedGame: null,
    page: 0,
    pageSize: 10,
    totalResults: 0,
    loading: false,
    lastQuery: '',
    jsonpCounter: 0
};

// --- External dependencies ---
let _escapeHtml = null;

/**
 * Initialize game browser with external dependencies.
 * @param {object} deps - { escapeHtml }
 */
export function initGameBrowser(deps) {
    _escapeHtml = deps.escapeHtml;
}

// --- Helpers ---

// JSONP helper - creates script tag to bypass CORS
export function jsonp(url) {
    return new Promise((resolve, reject) => {
        const callbackName = `wosCallback_${++gameBrowser.jsonpCounter}_${Date.now()}`;
        const script = document.createElement('script');

        // Timeout handler
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Request timeout'));
        }, 15000);

        function cleanup() {
            clearTimeout(timeout);
            delete window[callbackName];
            if (script.parentNode) script.parentNode.removeChild(script);
        }

        window[callbackName] = (data) => {
            cleanup();
            resolve(data);
        };

        script.onerror = () => {
            cleanup();
            reject(new Error('Network error'));
        };

        script.src = url + (url.includes('?') ? '&' : '?') + `callback=${callbackName}`;
        document.head.appendChild(script);
    });
}

// --- Core functions ---

// Search handler - fetches results and paginates client-side
export async function gameBrowserDoSearch(resetPage = true) {
    const escapeHtml = _escapeHtml || ((s) => s);
    const query = gameBrowserSearch.value.trim();
    if (!query) return;

    if (resetPage) {
        gameBrowser.page = 0;
        gameBrowser.lastQuery = query;
        gameBrowser.allResults = [];
    }

    // If we already have results and just changing page, use cached results
    if (!resetPage && gameBrowser.allResults.length > 0) {
        gameBrowserRenderCurrentPage();
        return;
    }

    gameBrowser.loading = true;
    gameBrowserResults.innerHTML = '<div class="gamebrowser-status"><div class="gamebrowser-loading"><div class="gamebrowser-spinner"></div><div>Searching...</div></div></div>';
    gameBrowserDetail.classList.add('hidden');

    // Search using ZXInfo API
    try {
        const url = `https://api.zxinfo.dk/v3/search?query=${encodeURIComponent(query)}&mode=compact&size=100&titlesonly=true&sort=title_asc`;

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const hitsArray = data.hits?.hits || [];

        gameBrowser.allResults = hitsArray.map(hit => {
            const src = hit._source || {};
            let screenshotUrl = '';
            if (src.screens && src.screens.length > 0) {
                screenshotUrl = `https://zxinfo.dk/media${src.screens[0].url}`;
            }
            return {
                id: hit._id,
                title: src.title || 'Unknown',
                year: src.originalYearOfRelease || src.yearOfRelease || '',
                publisher: src.publishers?.[0]?.name || '',
                genre: src.genreType || src.type || '',
                screenshotUrl: screenshotUrl,
                source: 'zxinfo'
            };
        });

        gameBrowser.totalResults = gameBrowser.allResults.length;
        gameBrowserRenderCurrentPage();
        gameBrowser.loading = false;
    } catch (error) {
        console.error('Game browser search error:', error);
        gameBrowserResults.innerHTML = `<div class="gamebrowser-status gamebrowser-error">Search failed: ${error.message}</div>`;
        gameBrowser.loading = false;
    }
}

// Render current page from cached results
export function gameBrowserRenderCurrentPage() {
    const start = gameBrowser.page * gameBrowser.pageSize;
    const end = start + gameBrowser.pageSize;
    gameBrowser.results = gameBrowser.allResults.slice(start, end);
    gameBrowserRenderResults();
    gameBrowserResults.scrollTop = 0;
}

// Render search results
export function gameBrowserRenderResults() {
    const escapeHtml = _escapeHtml || ((s) => s);

    if (gameBrowser.results.length === 0) {
        gameBrowserResults.innerHTML = '<div class="gamebrowser-status">No results found</div>';
        gameBrowserUpdatePagination();
        return;
    }

    // Helper to safely convert values to strings
    const str = (v) => typeof v === 'string' ? v : (Array.isArray(v) ? v.join(', ') : String(v || ''));

    let html = '';
    for (const game of gameBrowser.results) {
        const thumbContent = game.screenshotUrl
            ? `<img src="${game.screenshotUrl}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'gamebrowser-thumb-placeholder\\'></div>'">`
            : '<div class="gamebrowser-thumb-placeholder"></div>';
        const unavailable = game.availability_id && game.availability_id !== '1' ? '<span class="gamebrowser-unavailable">N/A</span>' : '';
        const yearStr = game.year ? `<span>${game.year}</span>` : '';
        const votesStr = game.votes ? `<span class="gamebrowser-score">\u2605${game.votes}</span>` : '';

        html += `
            <div class="gamebrowser-item" data-id="${game.id}" data-source="${game.source}">
                <div class="gamebrowser-thumb">${thumbContent}</div>
                <div class="gamebrowser-info">
                    <div class="gamebrowser-title">${escapeHtml(str(game.title))}</div>
                    <div class="gamebrowser-meta">
                        ${yearStr}
                        <span>${escapeHtml(str(game.publisher) || 'Unknown')}</span>
                        <span>${escapeHtml(str(game.genre))}</span>
                        ${votesStr}
                        ${unavailable}
                    </div>
                </div>
            </div>
        `;
    }

    gameBrowserResults.innerHTML = html;
    gameBrowserUpdatePagination();

    // Add click handlers
    gameBrowserResults.querySelectorAll('.gamebrowser-item').forEach(item => {
        item.addEventListener('click', () => {
            gameBrowserResults.querySelectorAll('.gamebrowser-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
            gameBrowserSelectGame(item.dataset.id, item.dataset.source);
        });
    });
}

// Update pagination
export function gameBrowserUpdatePagination() {
    const totalPages = Math.ceil(gameBrowser.totalResults / gameBrowser.pageSize);
    const currentPage = gameBrowser.page + 1;

    gameBrowserPageInfo.textContent = `Page ${currentPage} of ${totalPages || 1} (${gameBrowser.totalResults} results)`;
    btnGameBrowserPrev.disabled = gameBrowser.page === 0;
    btnGameBrowserNext.disabled = currentPage >= totalPages;
}

// Select a game and show details
export async function gameBrowserSelectGame(id, source) {
    const escapeHtml = _escapeHtml || ((s) => s);

    gameBrowser.selectedGame = { id, source };
    gameBrowserDetail.classList.remove('hidden');
    gameBrowserDetailTitle.textContent = 'Loading...';
    gameBrowserDetailScreen.style.display = 'none';
    gameBrowserDetailScreen.innerHTML = '';
    gameBrowserDetailInfo.innerHTML = '<div class="gamebrowser-spinner"></div>';
    gameBrowserReleasesList.innerHTML = '';
    gameBrowserExternal.innerHTML = '';

    try {
        if (source === 'zxinfo') {
            const url = `https://api.zxinfo.dk/v3/games/${encodeURIComponent(id)}?mode=full`;
            const response = await fetch(url, {
                headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) throw new Error(`API error: ${response.status}`);
            const data = await response.json();

            if (!data._source) {
                throw new Error('Game not found');
            }

            const game = data._source;

            // Title
            gameBrowserDetailTitle.textContent = game.title || 'Unknown';

            // Screenshot
            gameBrowserDetailScreen.style.display = '';
            if (game.screens && game.screens.length > 0) {
                const screenUrl = `https://zxinfo.dk/media${game.screens[0].url}`;
                gameBrowserDetailScreen.innerHTML = `<img src="${screenUrl}" alt="${escapeHtml(game.title || '')}" onerror="this.parentElement.innerHTML='<div class=\\'gamebrowser-thumb-placeholder\\'></div>'">`;
            } else {
                gameBrowserDetailScreen.innerHTML = '<div class="gamebrowser-thumb-placeholder"></div>';
            }

            // Build info
            let infoHtml = '';
            const year = game.originalYearOfRelease || game.yearOfRelease;
            if (year) infoHtml += `<p><strong>Year:</strong> ${year}</p>`;
            if (game.publishers?.length) {
                const pubs = game.publishers.map(p => p.name).filter(Boolean);
                if (pubs.length) infoHtml += `<p><strong>Publisher:</strong> ${pubs.map(n => escapeHtml(n)).join(', ')}</p>`;
            }
            if (game.genreType) infoHtml += `<p><strong>Genre:</strong> ${escapeHtml(game.genreType)}</p>`;
            if (game.authors?.length) {
                const auths = game.authors.map(a => a.name).filter(Boolean);
                if (auths.length) infoHtml += `<p><strong>Authors:</strong> ${auths.map(n => escapeHtml(n)).join(', ')}</p>`;
            }
            if (game.score?.votes) infoHtml += `<p><strong>Rating:</strong> \u2605${game.score.score} (${game.score.votes} votes)</p>`;
            if (game.machineType) infoHtml += `<p><strong>Machine:</strong> ${escapeHtml(game.machineType)}</p>`;
            gameBrowserDetailInfo.innerHTML = infoHtml;

            // Build releases list with direct load buttons
            const scUrl = `https://spectrumcomputing.co.uk/entry/${encodeURIComponent(id)}`;
            let releasesHtml = '';

            const loadableFiles = [];
            if (game.releases) {
                for (const rel of game.releases) {
                    if (rel.files) {
                        for (const f of rel.files) {
                            if (f.path && /\.(tap|tzx|z80|sna|szx)(\.zip)?$/i.test(f.path)) {
                                const filename = f.path.split('/').pop();
                                const format = f.format || filename.replace(/\.zip$/i, '').split('.').pop().toUpperCase();
                                loadableFiles.push({
                                    path: f.path,
                                    filename: filename,
                                    format: format,
                                    release: rel.releaseTitle || rel.publishers?.[0]?.name || ''
                                });
                            }
                        }
                    }
                }
            }

            if (loadableFiles.length > 0) {
                const filesToShow = loadableFiles.slice(0, 10);
                for (const f of filesToShow) {
                    const releaseInfo = f.release ? ` <span class="gamebrowser-release-info">(${escapeHtml(f.release)})</span>` : '';
                    const downloadUrl = `https://spectrumcomputing.co.uk${f.path}`;
                    releasesHtml += `<div class="gamebrowser-release">
                        <span class="gamebrowser-release-format">${escapeHtml(f.format)}</span>
                        <a href="${downloadUrl}" download="${escapeHtml(f.filename)}" class="gamebrowser-download-btn">Download</a>
                        ${releaseInfo}
                    </div>`;
                }
                releasesHtml += `<div class="gamebrowser-release-note">Download, then drag file into emulator</div>`;
                if (loadableFiles.length > 10) {
                    releasesHtml += `<div class="gamebrowser-release-note">${loadableFiles.length - 10} more files on Spectrum Computing</div>`;
                }
            }

            releasesHtml += `<div class="gamebrowser-release gamebrowser-release-link">
                <a href="${scUrl}" target="_blank">View all on Spectrum Computing \u2192</a>
            </div>`;

            gameBrowserReleasesList.innerHTML = releasesHtml;

        } else {
            throw new Error('Unknown source');
        }

    } catch (error) {
        console.error('Failed to load game details:', error);
        gameBrowserDetailTitle.textContent = 'Error loading details';
        gameBrowserDetailScreen.innerHTML = '';
        gameBrowserDetailInfo.innerHTML = `<p class="gamebrowser-error">${error.message}</p>`;
    }
}

// --- Event listeners (wiring) ---

// Close game browser dialog
btnGameBrowserClose.addEventListener('click', () => {
    gameBrowserDialog.classList.add('hidden');
});

gameBrowserDialog.addEventListener('click', (e) => {
    if (e.target === gameBrowserDialog) {
        gameBrowserDialog.classList.add('hidden');
    }
});

// Search button and enter key
btnGameBrowserSearchGo.addEventListener('click', () => gameBrowserDoSearch());
gameBrowserSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') gameBrowserDoSearch();
});

// Pagination
btnGameBrowserPrev.addEventListener('click', () => {
    if (gameBrowser.page > 0) {
        gameBrowser.page--;
        gameBrowserDoSearch(false);
    }
});

btnGameBrowserNext.addEventListener('click', () => {
    gameBrowser.page++;
    gameBrowserDoSearch(false);
});
