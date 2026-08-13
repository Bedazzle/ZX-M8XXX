/**
 * ZX-M8XXX - .pok cheat file support
 * @license GPL-3.0
 *
 * The .pok format is what the community POKE databases distribute (Spectrum
 * Computing, the old RZX archive). One file holds several named trainers, each a
 * list of pokes:
 *
 *     N Infinite lives
 *     M 8 34765 0 12
 *     Z 8 34766 0 3
 *     N Infinite ammo
 *     Z 8 39321 255 1
 *     Y
 *
 *   N <name>                     starts a trainer
 *   M <bank> <addr> <val> <orig>  a poke; more follow
 *   Z <bank> <addr> <val> <orig>  the last poke of this trainer
 *   Y                            end of file
 *
 * bank  0-7 selects a 128K RAM page, 8 means "no bank" (48K / currently paged).
 *       Values above 8 carry paging flags in the high bits; the low 3 bits are
 *       the page and bit 3 (8) means unbanked, which is how the databases write it.
 * val   0-255, or 256 meaning "ask the user for a value" (lives, ammo, …).
 * orig  the byte to restore on disable, or 0 when the author didn't record one.
 *
 * Real-world files are untidy: CRLF, blank lines, a missing trailing Y, comment
 * lines, extra columns, and pokes before any N line. The parser keeps going and
 * reports what it skipped rather than throwing, because a file that is 90%
 * readable is still worth loading.
 */

const MAX_TRAINERS = 2000;      // sanity bound for a hand-edited or corrupt file

// One poke line: M/Z bank addr value original
function parsePokeLine(parts) {
    if (parts.length < 5) return null;
    const nums = parts.slice(1, 5).map(n => parseInt(n, 10));
    if (nums.some(n => !Number.isFinite(n))) return null;
    const [bankRaw, addr, value, original] = nums;
    if (addr < 0 || addr > 0xFFFF) return null;
    if (value < 0 || value > 256) return null;          // 256 = prompt the user
    return {
        bank: bankRaw & 0x08 ? null : (bankRaw & 0x07),  // null = no specific bank
        addr,
        poke: value === 256 ? null : (value & 0xFF),     // null = user supplies it
        normal: original & 0xFF,
        userValue: value === 256,
    };
}

/**
 * Parse .pok text.
 * @returns {{trainers: Array<{name, patches: Array}>, warnings: string[]}}
 */
export function parsePok(text) {
    if (typeof text !== 'string') throw new Error('.pok data must be text');
    const trainers = [];
    const warnings = [];
    let current = null;
    let ended = false;
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || ended) continue;
        const tag = line[0].toUpperCase();
        const rest = line.slice(1).trim();

        if (tag === 'Y') { ended = true; continue; }

        if (tag === 'N') {
            if (trainers.length >= MAX_TRAINERS) {
                warnings.push(`stopped after ${MAX_TRAINERS} trainers`);
                break;
            }
            current = { name: rest || `Trainer ${trainers.length + 1}`, patches: [] };
            trainers.push(current);
            continue;
        }

        if (tag === 'M' || tag === 'Z') {
            const patch = parsePokeLine(line.split(/\s+/));
            if (!patch) { warnings.push(`line ${i + 1}: malformed poke`); continue; }
            if (!current) {
                // pokes before any N: keep them under a generated name rather than drop them
                current = { name: 'Unnamed trainer', patches: [] };
                trainers.push(current);
                warnings.push(`line ${i + 1}: poke before any trainer name`);
            }
            current.patches.push(patch);
            if (tag === 'Z') current = null;             // Z closes the trainer
            continue;
        }

        warnings.push(`line ${i + 1}: ignored "${line.slice(0, 20)}"`);
    }

    const empty = trainers.filter(t => t.patches.length === 0).length;
    if (empty) warnings.push(`${empty} trainer(s) had no pokes`);
    return { trainers: trainers.filter(t => t.patches.length > 0), warnings };
}

/** True if the text looks like a .pok file (cheap check before parsing). */
export function looksLikePok(text) {
    if (typeof text !== 'string') return false;
    return /^[ \t]*[NMZ][ \t]+\S/m.test(text.slice(0, 4000));
}

/**
 * .pok trainers -> the POKE manager's entry shape.
 * `askValue` is called for pokes the file leaves to the user (value 256); if it
 * returns null the patch is dropped, which is what "Cancel" should do.
 */
export function pokTrainersToEntries(trainers, askValue = null) {
    const entries = [];
    for (const t of trainers) {
        const patches = [];
        for (const p of t.patches) {
            let value = p.poke;
            if (p.userValue) {
                if (!askValue) continue;
                const got = askValue(t.name, p.addr);
                if (got === null || got === undefined) continue;
                value = got & 0xFF;
            }
            const patch = { addr: p.addr, normal: p.normal, poke: value };
            if (p.bank !== null && p.bank !== undefined) {
                patch.hint = `RAM bank ${p.bank}`;
            }
            patches.push(patch);
        }
        if (patches.length) entries.push({ name: t.name, enabled: false, patches });
    }
    return entries;
}
