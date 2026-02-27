// ========== Text Scanner ==========
// Extracted from index.html inline script
// Scans ZX Spectrum memory for text strings with dictionary matching.

// --- DOM element references ---
const btnTextScan = document.getElementById('btnTextScan');
const textScanMode = document.getElementById('textScanMode');
const textScanCustom = document.getElementById('textScanCustom');
const textScanMinLen = document.getElementById('textScanMinLen');
const textScanROM = document.getElementById('textScanROM');
const textScanAllBanks = document.getElementById('textScanAllBanks');
const textScanMax = document.getElementById('textScanMax');
const textScanStatus = document.getElementById('textScanStatus');
const textScanResults = document.getElementById('textScanResults');
const textScanPagination = document.getElementById('textScanPagination');
const textScanPrev = document.getElementById('textScanPrev');
const textScanNext = document.getElementById('textScanNext');
const textScanPage = document.getElementById('textScanPage');

// --- State ---
let textScanAllResults = [];  // Store all results for pagination
let textScanCurrentPage = 0;

// --- Dictionary ---
// Dictionary of common ZX Spectrum game/computer words
export const TEXT_DICTIONARY = [
    // Game terms
    'SCORE', 'LIVES', 'LEVEL', 'LIFE', 'TIME', 'BONUS', 'POINTS', 'ENERGY',
    'GAME', 'OVER', 'PLAYER', 'PRESS', 'START', 'PLAY', 'PAUSE', 'CONTINUE',
    'HIGH', 'ENTER', 'NAME', 'TABLE', 'BEST', 'TOP', 'NEW', 'RECORD',
    // Controls
    'FIRE', 'JUMP', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'SPACE', 'ENTER',
    'KEYBOARD', 'JOYSTICK', 'KEMPSTON', 'SINCLAIR', 'CURSOR', 'KEYS',
    'CONTROL', 'SELECT', 'OPTION', 'MENU', 'QUIT', 'EXIT', 'ABORT',
    // Messages
    'LOADING', 'SAVING', 'LOAD', 'SAVE', 'BYTES', 'READY', 'ERROR',
    'PRESS ANY KEY', 'WAIT', 'PLEASE', 'INSERT', 'TAPE', 'DISK',
    'CONGRATULATIONS', 'WELL DONE', 'TRY AGAIN', 'GET READY',
    // Credits
    'COPYRIGHT', 'WRITTEN', 'PROGRAMMED', 'GRAPHICS', 'MUSIC', 'SOUND',
    'PRESENTS', 'PRODUCTIONS', 'SOFTWARE', 'GAMES', 'CODE',
    // Status
    'SHIELD', 'AMMO', 'FUEL', 'POWER', 'HEALTH', 'MAGIC', 'GOLD', 'COINS',
    'WEAPON', 'ARMOR', 'ITEM', 'INVENTORY', 'MAP', 'STAGE', 'ROUND', 'WAVE',
    // Common words
    'THE', 'AND', 'YOU', 'ARE', 'FOR', 'NOT', 'ALL', 'CAN', 'HAS', 'HER',
    'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'HAD', 'HOT', 'HIS', 'HOW', 'ITS',
    'MAY', 'OLD', 'SEE', 'NOW', 'WAY', 'WHO', 'DID', 'GET', 'HIM', 'HIS',
    'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'YES', 'FROM', 'HAVE', 'INTO',
    'KILL', 'DEAD', 'DIED', 'HELP', 'FIND', 'OPEN', 'DOOR', 'ROOM', 'LOCK',
    'TAKE', 'DROP', 'GIVE', 'LOOK', 'WALK', 'MOVE', 'STOP', 'TURN', 'BACK',
    'NORTH', 'SOUTH', 'EAST', 'WEST', 'EXAMINE', 'ATTACK', 'DEFEND',
    // ZX Spectrum specific
    'SPECTRUM', 'SINCLAIR', 'BASIC', 'RETURN', 'BREAK', 'STOP',
    'PRINT', 'INPUT', 'GOTO', 'GOSUB', 'THEN', 'ELSE', 'NEXT', 'DATA',
    'POKE', 'PEEK', 'BEEP', 'BORDER', 'PAPER', 'INK', 'FLASH', 'BRIGHT'
];

// Convert dictionary to lowercase Set for fast lookup
const dictSet = new Set(TEXT_DICTIONARY.map(w => w.toLowerCase()));

// --- External dependencies ---
// These are injected via init() to avoid circular imports
let _spectrum = null;
let _escapeHtml = null;
let _hex16 = null;
let _goToMemoryAddress = null;
let _showMessage = null;

/**
 * Initialize text scanner with external dependencies.
 * @param {object} deps - { spectrum, escapeHtml, hex16, goToMemoryAddress, showMessage }
 */
export function initTextScanner(deps) {
    _spectrum = deps.spectrum;
    _escapeHtml = deps.escapeHtml;
    _hex16 = deps.hex16;
    _goToMemoryAddress = deps.goToMemoryAddress;
    _showMessage = deps.showMessage;
}

// --- Core functions ---

/**
 * Extract string from raw buffer at offset.
 * @param {Uint8Array} buffer
 * @param {number} startOffset
 * @param {number} minLen
 * @returns {{ text: string, len: number, termType: string } | null}
 */
export function extractStringFromBuffer(buffer, startOffset, minLen) {
    let text = '';
    let offset = startOffset;
    let termType = null;

    while (offset < buffer.length) {
        const byte = buffer[offset];

        if (byte === 0) {
            if (text.length >= minLen) {
                termType = 'null';
                return { text, len: offset - startOffset + 1, termType };
            }
            return null;
        }

        const char = byte & 0x7F;
        const bit7set = (byte & 0x80) !== 0;

        const isLetter = (char >= 65 && char <= 90) || (char >= 97 && char <= 122);
        const isPunct = char === 32 || char === 33 || char === 44 || char === 45 ||
                        char === 58 || char === 59 || char === 63;
        if (isLetter || isPunct) {
            text += String.fromCharCode(char);
            offset++;

            if (bit7set) {
                if (text.length >= minLen) {
                    termType = 'bit7';
                    return { text, len: offset - startOffset, termType };
                }
                return null;
            }

        } else {
            if (text.length >= minLen) {
                termType = 'nonprint';
                return { text, len: offset - startOffset, termType };
            }
            return null;
        }
    }

    if (text.length >= minLen) {
        termType = 'eof';
        return { text, len: offset - startOffset, termType };
    }
    return null;
}

/**
 * Scan a buffer for strings and add to results.
 * @param {Uint8Array} buffer
 * @param {number} baseAddr
 * @param {string} bankLabel
 * @param {string} mode - 'all', 'dict', or 'custom'
 * @param {number} minLen
 * @param {string} customSearch
 */
export function scanBufferForStrings(buffer, baseAddr, bankLabel, mode, minLen, customSearch) {
    let offset = 0;
    while (offset < buffer.length) {
        const str = extractStringFromBuffer(buffer, offset, minLen);
        if (str) {
            let include = false;
            let dictMatches = [];

            if (mode === 'all') {
                include = true;
                dictMatches = findDictWords(str.text);
            } else if (mode === 'dict') {
                dictMatches = findDictWords(str.text);
                include = dictMatches.length > 0;
            } else if (mode === 'custom') {
                include = str.text.toLowerCase().includes(customSearch);
            }

            if (include) {
                textScanAllResults.push({
                    addr: baseAddr + offset,
                    text: str.text,
                    len: str.len,
                    termType: str.termType,
                    dictMatches: dictMatches,
                    bank: bankLabel
                });
            }
            offset += str.len;
        } else {
            offset++;
        }
    }
}

/**
 * Extract a string from memory address using spectrum.memory.read().
 * Returns {text, len, termType} or null if not a valid string.
 * @param {number} startAddr
 * @param {number} minLen
 */
export function extractString(startAddr, minLen) {
    let text = '';
    let addr = startAddr;
    let termType = null;

    while (addr < 0x10000) {
        const byte = _spectrum.memory.read(addr);

        // Check for null terminator
        if (byte === 0) {
            if (text.length >= minLen) {
                termType = 'null';
                return { text, len: addr - startAddr + 1, termType };
            }
            return null;
        }

        // Check for bit 7 set (last char marker)
        const char = byte & 0x7F;
        const bit7set = (byte & 0x80) !== 0;

        // Check if letter or limited punctuation
        const isLetter = (char >= 65 && char <= 90) || (char >= 97 && char <= 122);
        // Only: space(32), !(33), ,(44), -(45), :(58), ;(59), ?(63)
        const isPunct = char === 32 || char === 33 || char === 44 || char === 45 ||
                        char === 58 || char === 59 || char === 63;
        if (isLetter || isPunct) {
            text += String.fromCharCode(char);
            addr++;

            if (bit7set) {
                // Bit 7 terminator
                if (text.length >= minLen) {
                    termType = 'bit7';
                    return { text, len: addr - startAddr, termType };
                }
                return null;
            }

        } else {
            // Non-printable character
            if (text.length >= minLen) {
                termType = 'nonprint';
                return { text, len: addr - startAddr, termType };
            }
            return null;
        }
    }

    // End of memory
    if (text.length >= minLen) {
        termType = 'eof';
        return { text, len: addr - startAddr, termType };
    }
    return null;
}

/**
 * Find dictionary words in a string.
 * @param {string} text
 * @returns {string[]}
 */
export function findDictWords(text) {
    const found = [];
    const textLower = text.toLowerCase();
    const words = textLower.split(/[^a-z]+/);

    for (const word of words) {
        if (word.length >= 3 && dictSet.has(word)) {
            found.push(word);
        }
    }

    // Also check for multi-word matches without spaces
    for (const dictWord of TEXT_DICTIONARY) {
        const lower = dictWord.toLowerCase();
        if (lower.length >= 4 && textLower.includes(lower) && !found.includes(lower)) {
            found.push(lower);
        }
    }

    return found;
}

/**
 * Render the current page of text scan results.
 */
export function renderTextScanPage() {
    const escapeHtml = _escapeHtml || ((s) => s);
    const hex16 = _hex16 || ((v) => (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'));

    const perPage = parseInt(textScanMax.value) || 0;  // 0 = all
    const total = textScanAllResults.length;

    if (total === 0) {
        textScanResults.innerHTML = '<div style="color:var(--text-secondary);padding:5px;">No strings found</div>';
        textScanPagination.style.display = 'none';
        return;
    }

    let startIdx, endIdx, totalPages;
    if (perPage === 0) {
        // Show all
        startIdx = 0;
        endIdx = total;
        totalPages = 1;
        textScanCurrentPage = 0;
        textScanPagination.style.display = 'none';
    } else {
        totalPages = Math.ceil(total / perPage);
        if (textScanCurrentPage >= totalPages) textScanCurrentPage = totalPages - 1;
        if (textScanCurrentPage < 0) textScanCurrentPage = 0;
        startIdx = textScanCurrentPage * perPage;
        endIdx = Math.min(startIdx + perPage, total);
        textScanPagination.style.display = totalPages > 1 ? '' : 'none';
        textScanPage.textContent = `${textScanCurrentPage + 1}/${totalPages}`;
        textScanPrev.disabled = textScanCurrentPage === 0;
        textScanNext.disabled = textScanCurrentPage >= totalPages - 1;
    }

    let html = '';
    for (let i = startIdx; i < endIdx; i++) {
        const r = textScanAllResults[i];
        let textHtml = escapeHtml(r.text);
        // Highlight dictionary matches
        if (r.dictMatches.length > 0) {
            for (const word of r.dictMatches) {
                const re = new RegExp('(' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
                textHtml = textHtml.replace(re, '<span class="dict-match">$1</span>');
            }
        }
        const termIcon = r.termType === 'bit7' ? '\u2077' : r.termType === 'null' ? '\u2205' : '';
        const bankLabel = r.bank ? `<span class="bank">${r.bank}</span>` : '';
        html += `<div class="text-scan-result" data-addr="${r.addr}" data-bank="${r.bank || ''}" title="${r.termType}-terminated${r.bank ? ' (' + r.bank + ')' : ''}">
            <span class="addr">${hex16(r.addr)}</span>${bankLabel}
            <span class="len">${r.len}${termIcon}</span>
            <span class="text">${textHtml}</span>
        </div>`;
    }
    textScanResults.innerHTML = html;
}

// --- Event listeners (wiring) ---

textScanMode.addEventListener('change', () => {
    textScanCustom.style.display = textScanMode.value === 'custom' ? '' : 'none';
});

textScanPrev.addEventListener('click', () => {
    if (textScanCurrentPage > 0) {
        textScanCurrentPage--;
        renderTextScanPage();
    }
});

textScanNext.addEventListener('click', () => {
    const perPage = parseInt(textScanMax.value) || 0;
    const totalPages = perPage > 0 ? Math.ceil(textScanAllResults.length / perPage) : 1;
    if (textScanCurrentPage < totalPages - 1) {
        textScanCurrentPage++;
        renderTextScanPage();
    }
});

textScanMax.addEventListener('change', () => {
    textScanCurrentPage = 0;
    renderTextScanPage();
});

btnTextScan.addEventListener('click', () => {
    if (!_spectrum || !_spectrum.memory) {
        if (_showMessage) _showMessage('No memory available');
        return;
    }

    const mode = textScanMode.value;
    const minLen = parseInt(textScanMinLen.value) || 4;
    const customSearch = textScanCustom.value.toLowerCase();
    const includeROM = textScanROM.checked;
    const scanAllBanks = textScanAllBanks.checked && _spectrum.memory.machineType !== '48k';
    textScanAllResults = [];

    if (scanAllBanks) {
        // Scan all 8 RAM banks directly (128K mode)
        for (let bank = 0; bank < 8; bank++) {
            const buffer = _spectrum.memory.getRamBank(bank);
            scanBufferForStrings(buffer, 0xC000, `bank${bank}`, mode, minLen, customSearch);
        }
        // Optionally scan ROM
        if (includeROM) {
            const rom0 = _spectrum.memory.rom[0];
            if (rom0) scanBufferForStrings(rom0, 0x0000, 'ROM0', mode, minLen, customSearch);
            const rom1 = _spectrum.memory.rom[1];
            if (rom1) scanBufferForStrings(rom1, 0x0000, 'ROM1', mode, minLen, customSearch);
        }
    } else {
        // Scan mapped memory only
        let addr = includeROM ? 0x0000 : 0x4000;
        while (addr < 0x10000) {
            const str = extractString(addr, minLen);
            if (str) {
                let include = false;
                let dictMatches = [];

                if (mode === 'all') {
                    include = true;
                    dictMatches = findDictWords(str.text);
                } else if (mode === 'dict') {
                    dictMatches = findDictWords(str.text);
                    include = dictMatches.length > 0;
                } else if (mode === 'custom') {
                    include = str.text.toLowerCase().includes(customSearch);
                }

                if (include) {
                    textScanAllResults.push({
                        addr: addr,
                        text: str.text,
                        len: str.len,
                        termType: str.termType,
                        dictMatches: dictMatches,
                        bank: null
                    });
                }
                addr += str.len;
            } else {
                addr++;
            }
        }
    }

    // Display results
    textScanStatus.textContent = `(${textScanAllResults.length} strings)`;
    textScanCurrentPage = 0;
    renderTextScanPage();

    if (_showMessage) _showMessage(`Found ${textScanAllResults.length} text strings`);
});

textScanResults.addEventListener('click', (e) => {
    const resultEl = e.target.closest('.text-scan-result');
    if (resultEl) {
        const addr = parseInt(resultEl.dataset.addr);
        if (_goToMemoryAddress) _goToMemoryAddress(addr);
    }
});
