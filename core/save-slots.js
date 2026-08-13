/**
 * ZX-M8XXX - Save-state slots
 * @license GPL-3.0
 *
 * The emulator had exactly one quicksave, so F2 overwrote whatever was there.
 * This keeps several, with enough metadata to tell them apart (machine, time,
 * what was loaded) and without losing the single slot people already have saved.
 *
 * Storage is injected rather than reaching for localStorage, so the logic is
 * testable and the quota behaviour can be exercised: a browser throws when the
 * store is full, and a save state is big (a 128K SZX is ~100KB before base64),
 * so "the store is full" is a normal outcome here, not an exceptional one.
 *
 *   const slots = createSaveSlots({ storage, count: 9 });
 *   slots.save(2, bytes, { machine: '128k', title: 'Manic Miner' });
 *   slots.load(2)      -> { bytes, machine, time, title } | null
 *   slots.list()       -> [{ index, used, machine, time, title, bytes }]
 */

const PREFIX = 'zxm8_slot';
const LEGACY = 'zxm8_quicksave';        // the original single quicksave

function toBase64(bytes) {
    let s = '';
    const chunk = 0x8000;               // avoid apply() blowing the stack on ~100KB
    for (let i = 0; i < bytes.length; i += chunk) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
}

function fromBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function createSaveSlots({ storage, count = 9, encode = toBase64, decode = fromBase64 } = {}) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
        throw new Error('save slots need a storage with get/set/remove');
    }
    if (!(count >= 1)) throw new Error('count must be at least 1');

    const key = (i) => `${PREFIX}${i}`;
    const metaKey = (i) => `${PREFIX}${i}_meta`;
    const valid = (i) => Number.isInteger(i) && i >= 1 && i <= count;

    function readMeta(i) {
        try {
            const raw = storage.get(metaKey(i));
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;                // corrupt metadata shouldn't hide the state
        }
    }

    const api = {
        get count() { return count; },

        /** Move a pre-slots quicksave into slot 1, once, so it isn't orphaned. */
        migrateLegacy() {
            const old = storage.get(LEGACY);
            if (!old || storage.get(key(1))) return false;
            storage.set(key(1), old);
            storage.set(metaKey(1), JSON.stringify({
                machine: storage.get(LEGACY + '-machine') || '',
                time: storage.get(LEGACY + '-time') || '',
                title: 'Quicksave',
            }));
            return true;
        },

        /**
         * Save bytes into a slot.
         * @returns {{ok: true} | {ok: false, error: string, full?: boolean}}
         */
        save(i, bytes, meta = {}) {
            if (!valid(i)) return { ok: false, error: `slot ${i} does not exist` };
            if (!bytes || !bytes.length) return { ok: false, error: 'nothing to save' };
            let encoded;
            try {
                encoded = encode(bytes);
            } catch (e) {
                return { ok: false, error: 'could not encode the snapshot' };
            }
            try {
                storage.set(key(i), encoded);
                storage.set(metaKey(i), JSON.stringify({
                    machine: meta.machine || '',
                    time: meta.time || new Date().toLocaleString(),
                    title: meta.title || '',
                    size: bytes.length,
                }));
                return { ok: true };
            } catch (e) {
                // Out of space: leave the slot as it was rather than half-written.
                try { storage.remove(key(i)); storage.remove(metaKey(i)); } catch (e2) { /* ignore */ }
                const full = /quota|exceeded|full/i.test(e && e.message || '') ||
                             (e && (e.name === 'QuotaExceededError' ||
                                    e.name === 'NS_ERROR_DOM_QUOTA_REACHED'));
                return {
                    ok: false, full,
                    error: full ? 'browser storage is full — free a slot and try again'
                                : `could not save: ${e && e.message}`,
                };
            }
        },

        /** @returns {{bytes, machine, time, title} | null} */
        load(i) {
            if (!valid(i)) return null;
            const raw = storage.get(key(i));
            if (!raw) return null;
            let bytes;
            try {
                bytes = decode(raw);
            } catch (e) {
                return null;            // corrupt slot reads as empty rather than throwing
            }
            const meta = readMeta(i) || {};
            return { bytes, machine: meta.machine || '', time: meta.time || '', title: meta.title || '' };
        },

        clear(i) {
            if (!valid(i)) return false;
            const had = !!storage.get(key(i));
            storage.remove(key(i));
            storage.remove(metaKey(i));
            return had;
        },

        used(i) { return valid(i) && !!storage.get(key(i)); },

        /** All slots, empty ones included, so a UI can render a fixed list. */
        list() {
            const out = [];
            for (let i = 1; i <= count; i++) {
                const raw = storage.get(key(i));
                const meta = readMeta(i) || {};
                out.push({
                    index: i,
                    used: !!raw,
                    machine: meta.machine || '',
                    time: meta.time || '',
                    title: meta.title || '',
                    bytes: meta.size || (raw ? Math.floor(raw.length * 3 / 4) : 0),
                });
            }
            return out;
        },

        /** The next slot after `from`, wrapping — for cycling with a hotkey. */
        next(from) {
            const start = valid(from) ? from : 0;
            return (start % count) + 1;
        },
    };
    return api;
}
