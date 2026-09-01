/**
 * ZX-M8XXX - Debug instrumentation for the Spectrum machine
 * @license GPL-3.0
 *
 * The observation side of the emulator: auto-map coverage recording (rich and
 * fast/paged bitset modes), read/write/exec provenance, resolved indirect jumps
 * and the runtime call graph. Split out of core/spectrum.js so "how the machine
 * works" and "how we watch it" are separate files.
 *
 * These are Spectrum methods, mixed into its prototype - they use `this` for
 * everything and are called exactly as before. The hot-path hooks themselves
 * (the memory/fetch callbacks and the exec loop) stay in spectrum.js; this is
 * the control and reporting surface they feed.
 */

export const DebugInstrumentation = {

    getAutoMapKey(addr) {
        addr &= 0xffff;
        const p = this._autoMapPage(addr);
        return p === null ? addr.toString() : addr + ':' + p;
    },

    // Cheap paging signature — everything _autoMapPage depends on, packed into one
    // int. Changes only on a paging port write, so the paged fast path recomputes
    // the per-slot bitset pointers (below) only when this changes.
    _pagingSignature() {
        const m = this.memory;
        return (m.currentRamBank & 63)
            | ((m.currentRomBank & 15) << 6)
            | ((m.specialPagingMode ? 1 : 0) << 10)
            | ((m.ramInRomMode ? 1 : 0) << 11)
            | ((m.scorpionRamInRomMode ? 1 : 0) << 12)
            // The special-paging config, not specialBanks[0]: configs 1-3 all start at
            // bank 4, so that byte cannot tell them apart and the per-slot cache went
            // stale across a config change.
            | ((((m.port1FFD >> 1) & 3)) << 13);
    },

    // Lazily allocate + return the touched-bitset triple for a page label.
    _pagedTriple(label) {
        let t = this.autoMap.pagedBits.get(label);
        if (!t) {
            t = {
                execBits: new Uint8Array(0x10000),
                readBits: new Uint8Array(0x10000),
                writeBits: new Uint8Array(0x10000)
            };
            this.autoMap.pagedBits.set(label, t);
        }
        return t;
    },

    // Hot path for paged fast mode: return the triple the given address currently
    // maps to, rebuilding the per-slot cache only when paging changed.
    _pagedTripleForAddr(addr) {
        const am = this.autoMap;
        const sig = this._pagingSignature();
        if (sig !== am._pgSig) {
            am._pgSig = sig;
            for (let slot = 0; slot < 4; slot++) {
                const p = this._autoMapPage(slot << 14);
                am._pgSlots[slot] = this._pagedTriple(p === null ? '' : p);
            }
        }
        return am._pgSlots[addr >> 14];
    },

    // Parse auto-map key back to {addr, page}
    parseAutoMapKey(key) {
        const parts = key.split(':');
        const addr = parseInt(parts[0], 10);
        const page = parts.length > 1 ? parts[1] : null;
        return { addr, page };
    },

    // Enable/disable auto-mapping
    setAutoMapEnabled(enabled) {
        this.autoMap.enabled = enabled;
        this.updateMemoryCallbacksFlag();
    },

    isAutoMapEnabled() {
        return this.autoMap.enabled;
    },

    // Enable/disable fast bitset recording (see autoMap struct). Allocates the
    // exec/read/write bitsets on first enable. Recording still requires
    // setAutoMapEnabled(true); when both are on, the hot callbacks set a bit
    // instead of updating the Map (much cheaper for long RZX replays).
    //
    // paged = true selects the per-page variant: one bitset triple per memory
    // page (keyed like getAutoMapKey), so a bank-switching game maps correctly
    // instead of unioning all banks into one flat 16-bit space. Per-page bitsets
    // are allocated lazily as pages are touched.
    setAutoMapFast(enabled, paged = false) {
        this.autoMap.paged = !!(enabled && paged);
        this.autoMap.fast = !!enabled;
        this.autoMap._pgSig = -1;   // force the per-slot cache to rebuild
        if (enabled && !paged && !this.autoMap.execBits) {
            this.autoMap.execBits = new Uint8Array(0x10000);
            this.autoMap.readBits = new Uint8Array(0x10000);
            this.autoMap.writeBits = new Uint8Array(0x10000);
        }
    },

    // Live fast-mode bitsets (Uint8Array(0x10000) each; 1 = touched). The flat
    // exec/read/write are null until setAutoMapFast(true) with paged=false. In
    // paged mode, `paged` is true and `pagedBits` is a Map<label,{execBits,
    // readBits,writeBits}> — one flat-16-bit triple per page (label per
    // getAutoMapKey; '' = unpaged fixed RAM / 48K).
    getAutoMapBits() {
        return {
            execBits: this.autoMap.execBits,
            readBits: this.autoMap.readBits,
            writeBits: this.autoMap.writeBits,
            paged: this.autoMap.paged,
            pagedBits: this.autoMap.pagedBits
        };
    },

    // Clear all auto-map tracking data (Map, flat bitset, and paged bitset modes)
    clearAutoMap() {
        this.autoMap.executed.clear();
        this.autoMap.read.clear();
        this.autoMap.written.clear();
        this.autoMap.currentFetchAddrs.clear();
        if (this.autoMap.execBits) this.autoMap.execBits.fill(0);
        if (this.autoMap.readBits) this.autoMap.readBits.fill(0);
        if (this.autoMap.writeBits) this.autoMap.writeBits.fill(0);
        this.autoMap.pagedBits.clear();
        this.autoMap._pgSig = -1;
    },

    // One provenance hit: count it against `pc`, remembering the call stack the
    // first time we see that pc (the callers rarely differ, and copying the stack
    // on every hit would cost more than the recording itself).
    _noteProvenance(prov, pc) {
        let e = prov.byPc.get(pc);
        if (!e) {
            e = {
                count: 0,
                // Routines entered to get here, outermost first…
                callers: this._debugCallStack.map(x => x.addr),
                // …and the CALL/RST instruction that entered each of them
                callSites: this._debugCallStack.map(x => x.caller),
            };
            prov.byPc.set(pc, e);
        }
        e.count++;
    },

    _provenanceList(prov) {
        const out = [];
        for (const [pc, e] of prov.byPc) {
            out.push({
                pc, count: e.count,
                callers: e.callers.slice(),
                callSites: (e.callSites || []).slice(),
            });
        }
        return out.sort((a, b) => b.count - a.count);
    },

    // Record which instructions READ from [lo, hi] — "who consumes this block?",
    // the counterpart of write provenance. Same cost profile: in-range work only.
    startReadProvenance(lo, hi) {
        this.readProvenance.lo = lo & 0xFFFF;
        this.readProvenance.hi = hi & 0xFFFF;
        this.readProvenance.byPc = new Map();
        this.readProvenance.enabled = true;
        this.updateMemoryCallbacksFlag();
    },

    stopReadProvenance() {
        this.readProvenance.enabled = false;
        this.updateMemoryCallbacksFlag();
        return this.getReadProvenance();
    },

    // [{ pc, count, callers:[addr] }], most-frequent reader first.
    getReadProvenance() {
        return this._provenanceList(this.readProvenance);
    },

    // Record which addresses inside [lo, hi] were EXECUTED, and who called them —
    // "is this block code, and who runs it?". `pc` here is the executed address.
    startExecProvenance(lo, hi) {
        this.execProvenance.lo = lo & 0xFFFF;
        this.execProvenance.hi = hi & 0xFFFF;
        this.execProvenance.byPc = new Map();
        this.execProvenance.enabled = true;
        this.updateMemoryCallbacksFlag();
    },

    stopExecProvenance() {
        this.execProvenance.enabled = false;
        this.updateMemoryCallbacksFlag();
        return this.getExecProvenance();
    },

    getExecProvenance() {
        return this._provenanceList(this.execProvenance);
    },

    // Record which instruction reads a PORT, and who called it. The memory
    // provenance above answers "who touches this address"; this answers the
    // question a controls or loader hunt actually asks, which is who reads the
    // hardware — and with *which* port, because for the keyboard the low byte is
    // always $FE and carries nothing: the half-row select in the high byte is the
    // entire content. So the key is (pc, port), not pc, and a scan loop comes back
    // as one entry per row it selected rather than one entry that lost them.
    //
    // `port` is null for "every port". `mask` is ANDed with both sides, so the
    // default $00FF matches on the low byte alone: watchPortReads(0xFE) is every
    // keyboard row, watchPortReads(0xFFFD, 0xFFFF) is exactly the AY register port.
    startPortReadProvenance(port = null, mask = 0x00FF, limit = 4096) {
        this.portReadProvenance = {
            enabled: true,
            port: port === null ? null : (port & 0xFFFF),
            mask: mask & 0xFFFF,
            limit: limit > 0 ? limit : 4096,
            truncated: false,
            byKey: new Map()      // pc * 0x10000 + port -> { count, lastValue, callers, callSites }
        };
    },

    stopPortReadProvenance() {
        const out = this.getPortReadProvenance();
        this.portReadProvenance.enabled = false;
        return out;
    },

    // [{ pc, port, high, low, bank, count, lastValue, callers, callSites }],
    // most-frequent first.
    getPortReadProvenance() {
        const prov = this.portReadProvenance;
        const out = [];
        for (const [key, e] of prov.byKey) {
            const port = key & 0xFFFF;
            out.push({
                pc: (key / 0x10000) | 0,
                port,
                high: (port >> 8) & 0xFF,
                low: port & 0xFF,
                bank: e.bank,
                count: e.count,
                lastValue: e.lastValue,
                callers: e.callers.slice(),
                callSites: e.callSites.slice(),
            });
        }
        return out.sort((a, b) => b.count - a.count);
    },

    // Called from Spectrum.portRead for every IN once enabled. The PC is the CPU's
    // own `_instrPC`, set on every instruction, rather than the debugger's
    // `_currentInstrPC`, which only the stepping paths maintain.
    _notePortRead(port, value) {
        const prov = this.portReadProvenance;
        if (prov.port !== null && (port & prov.mask) !== (prov.port & prov.mask)) return;
        const pc = this.cpu._instrPC & 0xFFFF;
        const key = pc * 0x10000 + (port & 0xFFFF);
        let e = prov.byKey.get(key);
        if (!e) {
            // Same trade as _noteProvenance: the call stack is copied once per
            // key, because it rarely differs and copying it per hit would cost
            // more than the recording.
            if (prov.byKey.size >= prov.limit) { prov.truncated = true; return; }
            e = {
                count: 0,
                lastValue: 0,
                bank: this._autoMapPage(pc),
                callers: this._debugCallStack.map(x => x.addr),
                callSites: this._debugCallStack.map(x => x.caller),
            };
            prov.byKey.set(key, e);
        }
        e.count++;
        e.lastValue = value & 0xFF;
    },

    // Record which instructions write into [lo, hi] (inclusive). Cheap enough
    // for a full RZX replay (work happens only for in-range writes).
    startWriteProvenance(lo, hi) {
        this.writeProvenance.lo = lo & 0xFFFF;
        this.writeProvenance.hi = hi & 0xFFFF;
        this.writeProvenance.byPc = new Map();
        this.writeProvenance.enabled = true;
        this.updateMemoryCallbacksFlag();
    },

    stopWriteProvenance() {
        this.writeProvenance.enabled = false;
        this.updateMemoryCallbacksFlag();
        return this.getWriteProvenance();
    },

    // [{ pc, count, callers:[addr] }], most-frequent writer first.
    getWriteProvenance() {
        return this._provenanceList(this.writeProvenance);
    },

    // Called after each instruction (when indirectJumps.enabled): if the just-
    // executed instruction at sitePC was JP (HL)/(IX)/(IY), record where it went.
    // cpu.pc now holds the resolved target (the jump doesn't touch the reg).
    _trackIndirectJump(sitePC) {
        const op = this.memory.read(sitePC);
        let kind;
        if (op === 0xE9) kind = 'JP (HL)';
        else if (op === 0xDD && this.memory.read((sitePC + 1) & 0xFFFF) === 0xE9) kind = 'JP (IX)';
        else if (op === 0xFD && this.memory.read((sitePC + 1) & 0xFFFF) === 0xE9) kind = 'JP (IY)';
        else return;
        let e = this.indirectJumps.sites.get(sitePC);
        if (!e) { e = { kind, targets: new Map() }; this.indirectJumps.sites.set(sitePC, e); }
        const t = this.cpu.pc & 0xFFFF;
        e.targets.set(t, (e.targets.get(t) || 0) + 1);
    },

    startIndirectJumps() {
        this.indirectJumps.sites = new Map();
        this.indirectJumps.enabled = true;
    },

    stopIndirectJumps() {
        this.indirectJumps.enabled = false;
        return this.getIndirectJumps();
    },

    // [{ site, kind, targets:[{target, count}] }], sorted by site.
    getIndirectJumps() {
        const out = [];
        for (const [site, e] of this.indirectJumps.sites) {
            const targets = [...e.targets.entries()]
                .map(([target, count]) => ({ target, count }))
                .sort((a, b) => a.target - b.target);
            out.push({ site, kind: e.kind, targets });
        }
        return out.sort((a, b) => a.site - b.site);
    },

    startCallGraph() {
        this.callGraph.edges = new Map();
        this.callGraph.enabled = true;
    },

    stopCallGraph() {
        this.callGraph.enabled = false;
        return this.getCallGraph();
    },

    // [{ caller, callees:[{callee, count}] }], sorted by caller.
    getCallGraph() {
        const out = [];
        for (const [caller, m] of this.callGraph.edges) {
            const callees = [...m.entries()]
                .map(([callee, count]) => ({ callee, count }))
                .sort((a, b) => a.callee - b.callee);
            out.push({ caller, callees });
        }
        return out.sort((a, b) => a.caller - b.caller);
    }
};
