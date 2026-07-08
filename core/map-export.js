/**
 * ZX-M8XXX - Auto-Map export for disassembly toolchains
 * @license GPL-3.0
 *
 * Converts the runtime Auto-Map (which addresses were executed / read / written)
 * plus user labels, regions and comments into the interchange formats the
 * ZX-disasm workflow consumes:
 *
 *   exportCtl()       SkoolKit control file (.ctl) — c/b/t/w blocks from the
 *                     execution map (executed = code, read-only = data), plus
 *                     `@ ADDR label=NAME` and `N ADDR comment` lines.
 *   exportGhidraCsv() Ghidra `address,name,comment` CSV — the exact shape the
 *                     zx-disasm ghidra/apply_labels.py imports.
 *   exportSym()       sjasmplus symbol file — `NAME: EQU 0x0000AAAA` lines,
 *                     matching a build's regenerated .sym.
 *
 * Pure and DOM-free so it can run headless and be unit-tested. All inputs are
 * plain data (Maps/arrays/objects), never DOM or manager instances.
 */

// Auto-map keys are decimal addresses ("49152") on 48K, "addr:page" on 128K
// (see Spectrum.getAutoMapKey / parseAutoMapKey). Return { addr, page }.
export function parseAutoMapKey(key) {
    const s = String(key);
    const i = s.indexOf(':');
    if (i < 0) return { addr: parseInt(s, 10) & 0xFFFF, page: null };
    return { addr: parseInt(s.slice(0, i), 10) & 0xFFFF, page: s.slice(i + 1) };
}

// Normalise a Map | Array<[key,count]> | plain object into a Set of 16-bit
// addresses (pages are unioned into the flat 16-bit space — .ctl/.sym/CSV are
// single-address-space formats; pages seen are reported separately).
function keysToAddrSet(mapLike, pagesSeen) {
    const set = new Set();
    if (!mapLike) return set;
    const entries = mapLike instanceof Map ? mapLike.keys()
        : Array.isArray(mapLike) ? mapLike.map(e => Array.isArray(e) ? e[0] : e)
        : Object.keys(mapLike);
    for (const k of entries) {
        const { addr, page } = parseAutoMapKey(k);
        set.add(addr);
        if (page !== null && pagesSeen) pagesSeen.add(page);
    }
    return set;
}

// SkoolKit block letter per source classification.
const CTL_LETTER = {
    code: 'c', db: 'b', dw: 'w', text: 't', graphics: 'b', smc: 'c'
};

function hex4(n) { return (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }
function hex8(n) { return (n >>> 0).toString(16).toUpperCase().padStart(8, '0'); }

// A byte counts as text if it's printable ASCII (or common ZX string bytes).
function isPrintable(b) { return b === 0x0D || (b >= 0x20 && b <= 0x7E); }

/**
 * Coalesce the auto-map into sorted, typed ranges.
 *   mapData: { executed, read, written }  (any Map | Array | object shape)
 *   opts.readByte(addr)  optional — enables printable-run text ('t') detection
 *   opts.textMinRun      min consecutive printable bytes to call a range text (default 6)
 * Returns { ranges: [{start, end, type}], pages: string[] }
 *   type ∈ 'code' | 'db' | 'text'  (executed wins over data at any address).
 */
export function buildRanges(mapData, opts = {}) {
    const pagesSeen = new Set();
    const exec = keysToAddrSet(mapData.executed, pagesSeen);
    const read = keysToAddrSet(mapData.read, pagesSeen);
    const written = keysToAddrSet(mapData.written, pagesSeen);

    // Per-address class: code if executed, else data if read or written.
    const cls = new Map(); // addr -> 'code' | 'db'
    for (const a of exec) cls.set(a, 'code');
    for (const a of read) if (!cls.has(a)) cls.set(a, 'db');
    for (const a of written) if (!cls.has(a)) cls.set(a, 'db');

    const addrs = [...cls.keys()].sort((x, y) => x - y);

    // Optional text refinement: a data byte that's printable becomes 'text'
    // so runs of it coalesce into a 't' block. Code is never reclassified.
    const readByte = typeof opts.readByte === 'function' ? opts.readByte : null;
    const typeOf = (a) => {
        const c = cls.get(a);
        if (c === 'code') return 'code';
        if (readByte && isPrintable(readByte(a) & 0xFF)) return 'text';
        return 'db';
    };

    // Coalesce contiguous same-type addresses into ranges.
    const raw = [];
    for (const a of addrs) {
        const t = typeOf(a);
        const last = raw[raw.length - 1];
        if (last && last.type === t && a === last.end + 1) last.end = a;
        else raw.push({ start: a, end: a, type: t });
    }

    // Demote too-short 'text' runs back to 'db' (printable bytes appear inside
    // real data all the time; only a sustained run is worth a 't' block).
    const minRun = opts.textMinRun || 6;
    const ranges = raw.map(r =>
        (r.type === 'text' && (r.end - r.start + 1) < minRun) ? { ...r, type: 'db' } : r
    );
    // Merge adjacent same-type ranges created by the demotion.
    const merged = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && last.type === r.type && r.start === last.end + 1) last.end = r.end;
        else merged.push({ ...r });
    }

    return { ranges: merged, pages: [...pagesSeen].sort() };
}

// Coalesce ranges from fast-mode bitsets (Uint8Array(0x10000), 1 = touched):
// bits = { execBits, readBits, writeBits }. Same output as buildRanges.
export function buildRangesFromBits(bits, opts = {}) {
    const toKeys = (b) => {
        const out = [];
        if (b) for (let a = 0; a < 0x10000; a++) if (b[a]) out.push(a);
        return out;
    };
    return buildRanges({
        executed: toKeys(bits.execBits),
        read: toKeys(bits.readBits),
        written: toKeys(bits.writeBits)
    }, opts);
}

// Overlay user-defined regions on top of auto-map ranges. A region fully
// reclassifies the addresses it covers (the user knows better than the trace).
// Regions: [{start, end, type, page, comment}] with type ∈ REGION_TYPES.
export function applyRegions(ranges, regions) {
    if (!regions || !regions.length) return ranges;
    // Cut existing ranges at each region's boundaries and replace the covered
    // middle with the region's own type (user classification wins).
    const normType = (t) => (CTL_LETTER[t] ? t : 'db');
    let out = ranges.map(r => ({ ...r }));
    for (const reg of regions) {
        const rs = reg.start & 0xFFFF, re = reg.end & 0xFFFF;
        if (re < rs) continue;
        const next = [];
        for (const r of out) {
            if (r.end < rs || r.start > re) { next.push(r); continue; }
            if (r.start < rs) next.push({ start: r.start, end: rs - 1, type: r.type }); // left slice kept
            if (r.end > re) next.push({ start: re + 1, end: r.end, type: r.type });      // right slice kept
            // covered middle dropped — replaced below
        }
        next.push({ start: rs, end: re, type: normType(reg.type || 'code') });
        out = next.sort((a, b) => a.start - b.start);
    }
    return out;
}

// Normalise a labels input (Map | Array of {address,page,name}) to a sorted
// [{address, name}] list, skipping empties. Page is folded away (16-bit space).
function normLabels(labels) {
    const arr = labels instanceof Map ? [...labels.values()] : (labels || []);
    return arr
        .filter(l => l && l.name && Number.isFinite(l.address))
        .map(l => ({ address: l.address & 0xFFFF, name: String(l.name) }))
        .sort((a, b) => a.address - b.address);
}

// Pull a single comment string from a CommentManager-style entry
// ({before, inline, after}) or a plain string.
function commentText(c) {
    if (!c) return '';
    if (typeof c === 'string') return c;
    const parts = [c.before, c.inline, c.after].filter(s => s && s.trim());
    return parts.join(' | ').replace(/\s*\n\s*/g, ' ').trim();
}

// Accepts a Map<address, {before,inline,after}> (CommentManager.comments),
// an array of {address, before/inline/after} (CommentManager.getAll()), or an
// array of {address, text}. Returns sorted [{address, text}] with text non-empty.
function normComments(comments) {
    let arr;
    if (comments instanceof Map) {
        arr = [...comments.entries()].map(([address, v]) => ({ address, text: commentText(v) }));
    } else {
        arr = (comments || []).map(c => ({
            address: c.address,
            text: c.text !== undefined ? commentText(c.text) : commentText(c)
        }));
    }
    return arr
        .filter(c => Number.isFinite(c.address) && c.text)
        .map(c => ({ address: c.address & 0xFFFF, text: c.text }))
        .sort((a, b) => a.address - b.address);
}

/**
 * SkoolKit control file. opts:
 *   mapData   { executed, read, written }   (required for block geometry)
 *   regions   user regions to overlay       (optional)
 *   labels    [{address,name}] | Map        (optional → `@ ADDR label=NAME`)
 *   comments  CommentManager map/array      (optional → `N ADDR text`)
 *   readByte  (addr)=>byte                   (optional → text detection)
 *   title     string                         (optional header)
 */
export function exportCtl(opts = {}) {
    // Accept pre-built ranges (e.g. from buildRangesFromBits in fast mode) or
    // build them from a raw mapData.
    let ranges, pages;
    if (opts.ranges) { ranges = opts.ranges; pages = opts.pages || []; }
    else { ({ ranges, pages } = buildRanges(opts.mapData || {}, opts)); }
    const finalRanges = applyRegions(ranges, opts.regions);
    const labels = normLabels(opts.labels);
    const comments = normComments(opts.comments);

    const lines = [];
    const first = finalRanges.length ? finalRanges[0].start : 0x4000;
    lines.push(`> $${hex4(first)} ; ${opts.title || 'Generated by ZX-M8XXX from the Auto-Map'}`);
    lines.push(`> $${hex4(first)} ; executed = code (c), read/written = data (b/t)` +
        (pages.length ? `; pages seen: ${pages.join(',')}` : ''));

    // Interleave block controls with labels/comments in address order.
    const labelAt = new Map(labels.map(l => [l.address, l.name]));
    const commentAt = new Map(comments.map(c => [c.address, c.text]));

    for (const r of finalRanges) {
        const letter = CTL_LETTER[r.type] || 'b';
        lines.push(`${letter} $${hex4(r.start)}`);
        // labels + comments that fall inside this block
        for (let a = r.start; a <= r.end; a++) {
            if (labelAt.has(a)) lines.push(`@ $${hex4(a)} label=${labelAt.get(a)}`);
            if (commentAt.has(a)) lines.push(`N $${hex4(a)} ${commentAt.get(a)}`);
        }
    }

    // Labels/comments outside any mapped block still get emitted as directives.
    const covered = (a) => finalRanges.some(r => a >= r.start && a <= r.end);
    for (const l of labels) if (!covered(l.address)) lines.push(`@ $${hex4(l.address)} label=${l.name}`);
    for (const c of comments) if (!covered(c.address)) lines.push(`N $${hex4(c.address)} ${c.text}`);

    return lines.join('\n') + '\n';
}

/**
 * Ghidra CSV — header `address,name,comment`, one row per label and/or
 * commented address (the shape zx-disasm ghidra/apply_labels.py reads).
 */
export function exportGhidraCsv(opts = {}) {
    const labels = normLabels(opts.labels);
    const comments = normComments(opts.comments);
    const commentAt = new Map(comments.map(c => [c.address, c.text]));
    const nameAt = new Map(labels.map(l => [l.address, l.name]));
    const addrs = [...new Set([...nameAt.keys(), ...commentAt.keys()])].sort((a, b) => a - b);

    const esc = (s) => {
        s = String(s == null ? '' : s);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const rows = ['address,name,comment'];
    for (const a of addrs) {
        rows.push([`$${hex4(a)}`, esc(nameAt.get(a) || ''), esc(commentAt.get(a) || '')].join(','));
    }
    return rows.join('\n') + '\n';
}

/**
 * Resolved indirect jumps → Ghidra `address,name,comment` CSV. Each dispatch
 * site (`JP (HL)`/`(IX)`/`(IY)`) becomes one row whose comment lists the runtime
 * targets — the edges static analysis can't recover. Feeds zx-disasm's
 * apply_labels.py directly. `jumps` = Spectrum.getIndirectJumps() output.
 */
export function exportIndirectCsv(jumps = []) {
    const esc = (s) => {
        s = String(s == null ? '' : s);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = ['address,name,comment'];
    for (const j of (jumps || []).slice().sort((a, b) => a.site - b.site)) {
        const targets = j.targets.map(t => `$${hex4(t.target)}` + (t.count > 1 ? `(${t.count})` : '')).join(' ');
        const comment = `${j.kind} → ${targets} [${j.targets.length} target${j.targets.length === 1 ? '' : 's'}]`;
        rows.push([`$${hex4(j.site)}`, '', esc(comment)].join(','));
    }
    return rows.join('\n') + '\n';
}

// Normalise executed/written input (Uint8Array bitset | Set | Map | array of
// keys) to a Set<addr>, for SMC intersection.
function toAddrSet(x) {
    if (x instanceof Uint8Array) {
        const s = new Set();
        for (let a = 0; a < 0x10000; a++) if (x[a]) s.add(a);
        return s;
    }
    if (x instanceof Set) return x;
    return keysToAddrSet(x);
}

/**
 * Self-modifying code = addresses both executed AND written at runtime. Returns
 * coalesced [{start,end}] ranges. `exec`/`written` accept fast-mode bitsets, the
 * rich Maps, Sets, or key arrays.
 */
export function findSmcRanges(exec, written) {
    const e = toAddrSet(exec), wr = toAddrSet(written);
    const common = [...e].filter(a => wr.has(a)).sort((x, y) => x - y);
    const ranges = [];
    for (const a of common) {
        const last = ranges[ranges.length - 1];
        if (last && a === last.end + 1) last.end = a;
        else ranges.push({ start: a, end: a });
    }
    return ranges;
}

/** SMC ranges → Ghidra `address,name,comment` (one row per range). */
export function exportSmcCsv(ranges = []) {
    const rows = ['address,name,comment'];
    for (const r of ranges) {
        const n = r.end - r.start + 1;
        rows.push([`$${hex4(r.start)}`, '', `self-modifying code: ${n} byte${n === 1 ? '' : 's'} executed & written`].join(','));
    }
    return rows.join('\n') + '\n';
}

/**
 * Runtime call graph → Ghidra `address,name,comment`, pivoted to be callee-indexed
 * ("who calls this routine") — the form the naming workflow wants. `callGraph` =
 * Spectrum.getCallGraph() output ([{caller, callees:[{callee,count}]}]).
 */
export function exportCallGraphCsv(callGraph = []) {
    const byCallee = new Map(); // callee -> Map<caller, count>
    for (const c of callGraph) {
        for (const t of c.callees) {
            let m = byCallee.get(t.callee);
            if (!m) { m = new Map(); byCallee.set(t.callee, m); }
            m.set(c.caller, (m.get(c.caller) || 0) + t.count);
        }
    }
    const esc = (s) => { s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = ['address,name,comment'];
    for (const callee of [...byCallee.keys()].sort((a, b) => a - b)) {
        const m = byCallee.get(callee);
        const callers = [...m.entries()].sort((a, b) => a[0] - b[0])
            .map(([caller, count]) => `$${hex4(caller)}` + (count > 1 ? `(${count})` : '')).join(' ');
        rows.push([`$${hex4(callee)}`, '', esc(`called from ${callers} [${m.size} caller${m.size === 1 ? '' : 's'}]`)].join(','));
    }
    return rows.join('\n') + '\n';
}

/**
 * sjasmplus .sym — `NAME: EQU 0x0000AAAA`, sorted by name (case-insensitive),
 * matching a build's regenerated symbol file.
 */
export function exportSym(opts = {}) {
    const labels = normLabels(opts.labels)
        .sort((a, b) => a.name.toLowerCase() < b.name.toLowerCase() ? -1
            : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
    const lines = labels.map(l => `${l.name}: EQU 0x${hex8(l.address)}`);
    return lines.join('\n') + (lines.length ? '\n' : '');
}
