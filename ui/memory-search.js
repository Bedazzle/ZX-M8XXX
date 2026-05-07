// memory-search.js — Memory Search for right and left panels (extracted from index.html)
import { hex8, hex16 } from '../core/utils.js';

export function initMemorySearch({ readMemory, showMessage, goToMemoryAddress, goToLeftMemoryAddress }) {

    // Right panel DOM elements
    const memSearchInput = document.getElementById('memSearchInput');
    const memSearchType = document.getElementById('memSearchType');
    const btnMemSearch = document.getElementById('btnMemSearch');
    const btnMemSearchNext = document.getElementById('btnMemSearchNext');
    const searchResults = document.getElementById('searchResults');
    const chkSearchCase = document.getElementById('chkSearchCase');
    const chkSearch7bit = document.getElementById('chkSearch7bit');

    // Left panel DOM elements
    const leftMemSearchInput = document.getElementById('leftMemSearchInput');
    const leftMemSearchType = document.getElementById('leftMemSearchType');
    const btnLeftMemSearch = document.getElementById('btnLeftMemSearch');
    const btnLeftMemSearchNext = document.getElementById('btnLeftMemSearchNext');
    const leftSearchResults = document.getElementById('leftSearchResults');
    const chkLeftSearchCase = document.getElementById('chkLeftSearchCase');
    const chkLeftSearch7bit = document.getElementById('chkLeftSearch7bit');

    // Search state (right panel)
    let searchPattern = null;
    let searchResultAddrs = [];
    let searchResultIndex = -1;

    // Search state (left panel)
    let leftSearchPattern = null;
    let leftSearchResultAddrs = [];
    let leftSearchResultIndex = -1;

    // ========== Core search functions ==========

    // Returns {pattern: number[], mask: number[]} where mask[i]=0xFF for exact, 0x00 for wildcard
    function parseSearchPattern(input, type) {
        if (type === 'hex') {
            // Parse hex bytes like "CD 21 00" with wildcards ?? or **
            const tokens = input.trim().split(/\s+/).filter(s => s.length > 0);
            if (tokens.length === 0) return null;

            const pattern = [];
            const mask = [];

            for (const token of tokens) {
                if (token === '?' || token === '??' || token === '*' || token === '**') {
                    // Wildcard - match any byte
                    pattern.push(0);
                    mask.push(0x00);
                } else if (/^[0-9A-Fa-f]{2}$/.test(token)) {
                    // Single hex byte
                    pattern.push(parseInt(token, 16));
                    mask.push(0xFF);
                } else if (/^[0-9A-Fa-f]{4}$/.test(token)) {
                    // 4-digit hex = 16-bit word, store as little-endian
                    const val = parseInt(token, 16);
                    pattern.push(val & 0xFF, (val >> 8) & 0xFF);
                    mask.push(0xFF, 0xFF);
                } else if (/^[0-9A-Fa-f]+$/.test(token) && token.length % 2 === 0) {
                    // Concatenated hex bytes like "CD2100" - split into byte pairs
                    for (let i = 0; i < token.length; i += 2) {
                        pattern.push(parseInt(token.substr(i, 2), 16));
                        mask.push(0xFF);
                    }
                } else {
                    return null; // Invalid token
                }
            }
            return pattern.length > 0 ? { pattern, mask } : null;
        } else if (type === 'dec') {
            // Parse decimal bytes like "205 33 0" or "205,33,0"
            const parts = input.split(/[\s,]+/).filter(s => s.length > 0);
            if (parts.length === 0) return null;
            const pattern = [];
            const mask = [];
            for (const part of parts) {
                const val = parseInt(part, 10);
                if (isNaN(val) || val < 0 || val > 65535) return null;
                if (val > 255) {
                    // 16-bit word — store as little-endian
                    pattern.push(val & 0xFF, (val >> 8) & 0xFF);
                    mask.push(0xFF, 0xFF);
                } else {
                    pattern.push(val);
                    mask.push(0xFF);
                }
            }
            return pattern.length > 0 ? { pattern, mask } : null;
        } else {
            // Text search - convert to bytes
            if (input.length === 0) return null;
            const pattern = Array.from(input).map(c => c.charCodeAt(0) & 0xff);
            const mask = pattern.map(() => 0xFF);
            return { pattern, mask };
        }
    }

    function searchMemory(searchData, startAddr = 0, options = {}) {
        if (!readMemory || !searchData) return [];

        // Support both old format (array) and new format ({pattern, mask})
        const pattern = Array.isArray(searchData) ? searchData : searchData.pattern;
        const mask = Array.isArray(searchData) ? null : searchData.mask;

        if (!pattern || pattern.length === 0) return [];

        const { caseInsensitive = false, lastChar7bit = false } = options;
        const results = [];
        const maxResults = 100;
        const memSize = 0x10000;
        const patternLen = pattern.length;

        // Prepare pattern for matching
        const matchPattern = caseInsensitive
            ? pattern.map(b => (b >= 0x41 && b <= 0x5a) ? b | 0x20 : (b >= 0x61 && b <= 0x7a) ? b : b)
            : pattern;

        for (let addr = startAddr; addr < memSize && results.length < maxResults; addr++) {
            let match = true;
            for (let i = 0; i < patternLen && match; i++) {
                // Skip wildcards (mask = 0x00)
                if (mask && mask[i] === 0x00) continue;

                let memByte = readMemory((addr + i) & 0xffff);
                let patByte = matchPattern[i];

                // Last character with 7-bit set: match both normal and +128 versions
                if (lastChar7bit && i === patternLen - 1) {
                    const memByteLow = memByte & 0x7f;
                    if (caseInsensitive) {
                        const memLower = (memByteLow >= 0x41 && memByteLow <= 0x5a) ? memByteLow | 0x20 : memByteLow;
                        const patLower = (patByte >= 0x41 && patByte <= 0x5a) ? patByte | 0x20 : patByte;
                        if (memLower !== patLower) match = false;
                    } else {
                        if (memByteLow !== patByte) match = false;
                    }
                } else if (caseInsensitive) {
                    // Case-insensitive: convert both to lowercase for comparison
                    const memLower = (memByte >= 0x41 && memByte <= 0x5a) ? memByte | 0x20 : memByte;
                    const patLower = (patByte >= 0x41 && patByte <= 0x5a) ? patByte | 0x20 : patByte;
                    if (memLower !== patLower) match = false;
                } else {
                    if (memByte !== patByte) match = false;
                }
            }
            if (match) {
                results.push(addr);
            }
        }
        return results;
    }

    // ========== Right panel search ==========

    function displaySearchResults(results, searchData) {
        if (results.length === 0) {
            searchResults.innerHTML = '<div class="search-info">No results found</div>';
            return;
        }

        const patternLen = searchData.pattern ? searchData.pattern.length : searchData.length;
        searchResults.innerHTML = results.slice(0, 20).map((addr, idx) => {
            // Show preview of bytes at this address
            let preview = '';
            for (let i = 0; i < Math.min(8, patternLen + 4); i++) {
                preview += hex8(readMemory((addr + i) & 0xffff)) + ' ';
            }
            return `<div class="search-result" data-addr="${addr}" data-idx="${idx}">
                    <span class="addr">${hex16(addr)}</span>
                    <span class="preview">${preview.trim()}</span>
                </div>`;
        }).join('') + (results.length > 20 ? `<div class="search-info">...and ${results.length - 20} more</div>` : '');
    }

    function doSearch() {
        const input = memSearchInput.value.trim();
        if (!input) {
            searchResults.innerHTML = '';
            return;
        }

        searchPattern = parseSearchPattern(input, memSearchType.value);
        if (!searchPattern) {
            searchResults.innerHTML = '<div class="search-info">Invalid pattern (hex: use ? for wildcard)</div>';
            return;
        }

        const isTextSearch = memSearchType.value === 'text';
        const searchOptions = {
            caseInsensitive: isTextSearch && chkSearchCase.checked,
            lastChar7bit: isTextSearch && chkSearch7bit.checked
        };

        searchResultAddrs = searchMemory(searchPattern, 0, searchOptions);
        searchResultIndex = searchResultAddrs.length > 0 ? 0 : -1;

        displaySearchResults(searchResultAddrs, searchPattern);

        if (searchResultAddrs.length > 0) {
            goToMemoryAddress(searchResultAddrs[0]);
            showMessage(`Found ${searchResultAddrs.length} result(s)`);
        } else {
            showMessage('No results found', 'error');
        }
    }

    function doSearchNext() {
        if (searchResultAddrs.length === 0) {
            doSearch();
            return;
        }

        searchResultIndex = (searchResultIndex + 1) % searchResultAddrs.length;
        goToMemoryAddress(searchResultAddrs[searchResultIndex]);
        showMessage(`Result ${searchResultIndex + 1} of ${searchResultAddrs.length}`);
    }

    btnMemSearch.addEventListener('click', doSearch);

    btnMemSearchNext.addEventListener('click', doSearchNext);

    memSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                doSearchNext();
            } else {
                doSearch();
            }
        }
    });

    // Show/hide text search options and update placeholder based on search type
    const searchOptionsDiv = document.querySelector('.right-memory-search .search-options');
    function updateSearchOptions() {
        const mode = memSearchType.value;
        if (searchOptionsDiv) searchOptionsDiv.style.display = mode === 'text' ? 'flex' : 'none';

        // Update placeholder and tooltip based on mode
        if (mode === 'hex') {
            memSearchInput.placeholder = 'CD ? 00 or ABCD...';
            memSearchInput.title = 'Hex bytes (? = wildcard, 4 digits = word little-endian)';
        } else if (mode === 'dec') {
            memSearchInput.placeholder = '205 33 0...';
            memSearchInput.title = 'Decimal values (0-255 = byte, 256-65535 = word little-endian)';
        } else {
            memSearchInput.placeholder = 'text...';
            memSearchInput.title = 'Text string to search';
        }
    }
    memSearchType.addEventListener('change', updateSearchOptions);
    updateSearchOptions(); // Initial state

    searchResults.addEventListener('click', (e) => {
        const resultEl = e.target.closest('.search-result');
        if (resultEl) {
            const addr = parseInt(resultEl.dataset.addr);
            const idx = parseInt(resultEl.dataset.idx);
            searchResultIndex = idx;
            goToMemoryAddress(addr);
        }
    });

    // ========== Left panel search ==========

    function displayLeftSearchResults(results, pattern) {
        if (results.length === 0) {
            leftSearchResults.innerHTML = '<div class="search-info">No results</div>';
            return;
        }
        const patternLen = pattern.length;
        leftSearchResults.innerHTML = results.slice(0, 20).map((addr, idx) => {
            let preview = '';
            for (let i = 0; i < Math.min(8, patternLen + 4); i++) {
                preview += hex8(readMemory((addr + i) & 0xffff)) + ' ';
            }
            return `<div class="search-result" data-addr="${addr}" data-idx="${idx}">
                    <span class="addr">${hex16(addr)}</span>
                    <span class="preview">${preview.trim()}</span>
                </div>`;
        }).join('') + (results.length > 20 ? `<div class="search-info">...and ${results.length - 20} more</div>` : '');
    }

    function doLeftSearch() {
        const input = leftMemSearchInput.value.trim();
        if (!input) {
            leftSearchResults.innerHTML = '';
            return;
        }

        leftSearchPattern = parseSearchPattern(input, leftMemSearchType.value);
        if (!leftSearchPattern) {
            leftSearchResults.innerHTML = '<div class="search-info">Invalid pattern (hex: use ? for wildcard)</div>';
            return;
        }

        const isTextSearch = leftMemSearchType.value === 'text';
        const searchOptions = {
            caseInsensitive: isTextSearch && chkLeftSearchCase.checked,
            lastChar7bit: isTextSearch && chkLeftSearch7bit.checked
        };

        leftSearchResultAddrs = searchMemory(leftSearchPattern, 0, searchOptions);
        leftSearchResultIndex = leftSearchResultAddrs.length > 0 ? 0 : -1;

        displayLeftSearchResults(leftSearchResultAddrs, leftSearchPattern);

        if (leftSearchResultAddrs.length > 0) {
            goToLeftMemoryAddress(leftSearchResultAddrs[0]);
            showMessage(`Found ${leftSearchResultAddrs.length} result(s)`);
        } else {
            showMessage('No results found', 'error');
        }
    }

    function doLeftSearchNext() {
        if (leftSearchResultAddrs.length === 0) {
            doLeftSearch();
            return;
        }

        leftSearchResultIndex = (leftSearchResultIndex + 1) % leftSearchResultAddrs.length;
        goToLeftMemoryAddress(leftSearchResultAddrs[leftSearchResultIndex]);
        showMessage(`Result ${leftSearchResultIndex + 1} of ${leftSearchResultAddrs.length}`);
    }

    btnLeftMemSearch.addEventListener('click', doLeftSearch);
    btnLeftMemSearchNext.addEventListener('click', doLeftSearchNext);

    leftMemSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                doLeftSearchNext();
            } else {
                doLeftSearch();
            }
        }
    });

    // Left panel search options update
    const leftSearchOptionsDiv = document.querySelector('.left-memory-search .search-options');
    function updateLeftSearchOptions() {
        const mode = leftMemSearchType.value;
        if (leftSearchOptionsDiv) leftSearchOptionsDiv.style.display = mode === 'text' ? 'flex' : 'none';

        if (mode === 'hex') {
            leftMemSearchInput.placeholder = 'CD ? 00 or ABCD...';
            leftMemSearchInput.title = 'Hex bytes (? = wildcard, 4 digits = word little-endian)';
        } else if (mode === 'dec') {
            leftMemSearchInput.placeholder = '205 33 0...';
            leftMemSearchInput.title = 'Decimal values (0-255 = byte, 256-65535 = word little-endian)';
        } else {
            leftMemSearchInput.placeholder = 'text...';
            leftMemSearchInput.title = 'Text string to search';
        }
    }
    leftMemSearchType.addEventListener('change', updateLeftSearchOptions);
    updateLeftSearchOptions();

    leftSearchResults.addEventListener('click', (e) => {
        const resultEl = e.target.closest('.search-result');
        if (resultEl) {
            const addr = parseInt(resultEl.dataset.addr);
            const idx = parseInt(resultEl.dataset.idx);
            leftSearchResultIndex = idx;
            goToLeftMemoryAddress(addr);
        }
    });
}
