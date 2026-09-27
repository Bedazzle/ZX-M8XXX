// watches.js — Memory Watches (extracted from index.html)
import { hex8, storageGet, storageSet } from '../core/utils.js';
import { fmtAddr, fmtByte, parseAddr, specToHex, onNumberBaseChange } from '../core/addr-format.js';

export function initWatches({ readMemory, getMemoryInfo, getRamBank, parseAddressSpec, getLabel, showMessage }) {
    // DOM lookups
    const watchesList = document.getElementById('watchesList');
    const watchAddrInput = document.getElementById('watchAddrInput');
    const watchNameInput = document.getElementById('watchNameInput');
    const btnWatchAdd = document.getElementById('btnWatchAdd');
    const btnWatchClear = document.getElementById('btnWatchClear');

    // State
    let watches = []; // Array of {addr: number, name: string, prevBytes: Uint8Array}
    const MAX_WATCHES = 10;
    const WATCH_BYTES = 8;

    function loadWatches() {
        const saved = storageGet('zxm8_watches');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                // Support old format (number), intermediate (addr only), and new format (addr+name+page)
                watches = data.map(item => {
                    if (typeof item === 'number') {
                        return { addr: item, name: '', page: null, prevBytes: new Uint8Array(WATCH_BYTES) };
                    }
                    return {
                        addr: item.addr,
                        name: item.name || '',
                        page: item.page !== undefined ? item.page : null,
                        prevBytes: new Uint8Array(WATCH_BYTES)
                    };
                });
            } catch (e) {
                watches = [];
            }
        }
    }

    function saveWatches() {
        const data = watches.map(w => ({ addr: w.addr, name: w.name, page: w.page }));
        storageSet('zxm8_watches', JSON.stringify(data));
    }

    function readWatchByte(watch, offset) {
        const addr = (watch.addr + offset) & 0xFFFF;
        // If page specified and address is in C000-FFFF range, read from specific bank
        if (watch.page !== null && addr >= 0xC000 && getMemoryInfo().machineType !== '48k') {
            const bank = getRamBank(watch.page);
            if (bank) {
                return bank[addr - 0xC000] & 0xFF;
            }
        }
        return readMemory(addr) & 0xFF;
    }

    function getWatchDisplayName(watch) {
        // Check if address matches a label
        const label = getLabel(watch.addr);
        if (label) {
            return { text: label.name, isLabel: true };
        }
        return { text: watch.name || '', isLabel: false };
    }

    function sortWatches() {
        watches.sort((a, b) => a.addr - b.addr);
    }

    function renderWatches() {
        watchesList.innerHTML = '';
        if (watches.length === 0) {
            watchesList.innerHTML = '<div class="no-breakpoints">No watches</div>';
            return;
        }
        sortWatches();
        watches.forEach((watch, index) => {
            const entry = document.createElement('div');
            entry.className = 'watch-entry';

            // Address display (with page if specified)
            const addrSpan = document.createElement('span');
            addrSpan.className = 'watch-addr';
            const pagePrefix = watch.page !== null ? `${watch.page}:` : '';
            addrSpan.textContent = pagePrefix + fmtAddr(watch.addr);

            // Name/label display
            const nameSpan = document.createElement('span');
            nameSpan.dataset.index = index;
            const displayName = getWatchDisplayName(watch);
            nameSpan.className = 'watch-name' + (displayName.isLabel ? ' label' : '');
            nameSpan.textContent = displayName.text;
            nameSpan.title = displayName.isLabel ? 'Label: ' + displayName.text : (watch.name || 'No name');

            const bytesSpan = document.createElement('span');
            bytesSpan.className = 'watch-bytes';
            bytesSpan.dataset.index = index;
            bytesSpan.textContent = '-- -- -- -- -- -- -- --';

            const asciiSpan = document.createElement('span');
            asciiSpan.className = 'watch-ascii';
            asciiSpan.dataset.index = index;
            asciiSpan.textContent = '........';

            const removeBtn = document.createElement('button');
            removeBtn.className = 'watch-remove';
            removeBtn.textContent = '\u00d7';
            removeBtn.title = 'Remove watch';
            removeBtn.addEventListener('click', () => {
                watches.splice(index, 1);
                saveWatches();
                renderWatches();
            });

            entry.appendChild(removeBtn);
            entry.appendChild(addrSpan);
            entry.appendChild(nameSpan);
            entry.appendChild(bytesSpan);
            entry.appendChild(asciiSpan);
            watchesList.appendChild(entry);
        });
        updateWatchValues();
    }

    function updateWatchValues() {
        if (!readMemory) return;
        watches.forEach((watch, index) => {
            const bytesSpan = watchesList.querySelector(`.watch-bytes[data-index="${index}"]`);
            const asciiSpan = watchesList.querySelector(`.watch-ascii[data-index="${index}"]`);
            const nameSpan = watchesList.querySelector(`.watch-name[data-index="${index}"]`);
            if (!bytesSpan || !asciiSpan) return;

            // Update name/label (may change after labels load)
            if (nameSpan) {
                const displayName = getWatchDisplayName(watch);
                nameSpan.className = 'watch-name' + (displayName.isLabel ? ' label' : '');
                nameSpan.textContent = displayName.text;
                nameSpan.title = displayName.isLabel ? 'Label: ' + displayName.text : (watch.name || 'No name');
            }

            let bytesHtml = '';
            let asciiStr = '';
            const currentBytes = new Uint8Array(WATCH_BYTES);

            for (let i = 0; i < WATCH_BYTES; i++) {
                const byte = readWatchByte(watch, i);
                currentBytes[i] = byte;
                const changed = watch.prevBytes[i] !== byte;
                const hexVal = fmtByte(byte);
                if (changed) {
                    bytesHtml += `<span class="changed">${hexVal}</span> `;
                } else {
                    bytesHtml += hexVal + ' ';
                }
                asciiStr += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
            }

            bytesSpan.innerHTML = bytesHtml;
            asciiSpan.textContent = asciiStr;
            watch.prevBytes = currentBytes;
        });
    }

    // Event bindings
    if (btnWatchAdd) {
        btnWatchAdd.addEventListener('click', () => {
            if (watches.length >= MAX_WATCHES) {
                showMessage(`Maximum ${MAX_WATCHES} watches allowed`);
                return;
            }
            // Parse address from input (supports P:ADDR format)
            const addrStr = watchAddrInput.value.trim();
            if (!addrStr) {
                showMessage('Enter address', 'error');
                watchAddrInput.focus();
                return;
            }

            let addr, page = null;
            const hexSpec = specToHex(addrStr);
            const parsed = hexSpec === null ? null : parseAddressSpec(hexSpec);
            if (parsed) {
                addr = parsed.start;
                page = parsed.page;
            } else {
                // Fallback: try simple hex parse
                addr = parseAddr(addrStr);
                if (addr === null) addr = NaN;
                if (isNaN(addr) || addr < 0 || addr > 0xFFFF) {
                    showMessage('Invalid address', 'error');
                    watchAddrInput.focus();
                    return;
                }
            }

            const name = watchNameInput.value.trim();
            watches.push({
                addr: addr,
                name: name,
                page: page,
                prevBytes: new Uint8Array(WATCH_BYTES)
            });
            saveWatches();
            renderWatches();
            // Clear inputs
            watchAddrInput.value = '';
            watchNameInput.value = '';
            const pageStr = page !== null ? `${page}:` : '';
            showMessage(`Watch added: ${pageStr}${fmtAddr(addr)}${name ? ' (' + name + ')' : ''}`);
        });
    } else {
        console.error('btnWatchAdd not found');
    }

    if (btnWatchClear) {
        btnWatchClear.addEventListener('click', () => {
            if (watches.length === 0) return;
            watches = [];
            saveWatches();
            renderWatches();
            showMessage('All watches cleared');
        });
    } else {
        console.error('btnWatchClear not found');
    }

    function setWatches(watchesData) {
        watches = watchesData.map(item => ({
            addr: item.addr,
            name: item.name || '',
            page: item.page !== undefined ? item.page : null,
            prevBytes: new Uint8Array(WATCH_BYTES)
        }));
    }

    function getWatchBytesCount() {
        return WATCH_BYTES;
    }

    function getWatches() {
        return watches.map(w => ({ addr: w.addr, name: w.name, page: w.page }));
    }

    function addWatch(addr, name, page) {
        if (watches.length >= MAX_WATCHES) {
            showMessage(`Maximum ${MAX_WATCHES} watches allowed`);
            return false;
        }
        watches.push({
            addr: addr,
            name: name || '',
            page: page !== undefined ? page : null,
            prevBytes: new Uint8Array(WATCH_BYTES)
        });
        saveWatches();
        renderWatches();
        return true;
    }

    // Load watches on startup
    loadWatches();
    renderWatches();

    // Hex or decimal: each row shows its address.
    onNumberBaseChange(() => renderWatches());

    return { updateWatchValues, renderWatches, saveWatches, setWatches, getWatchBytesCount, getWatches, addWatch };
}
