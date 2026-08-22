// Differential runs — pure: nothing here touches an emulator.
//
// The methodology every verification here uses is the decoy: run the same thing
// twice with one variable changed, and look at where the two runs stop agreeing.
// A set difference of executed addresses (which the Code Path tool already does)
// answers "what did this run reach that the other didn't"; it cannot answer
// "where did they part company", because a set has no order.
//
// So an execution trace is an ordered stream of program counters, and the first
// index at which two streams differ is the instruction that decided everything
// after it. Memory is then compared at that moment to say what it decided on.

// A trace entry packs the paged bank into the high bits, so two runs that reach
// the same address through different paging are not mistaken for agreeing.
export const PC_MASK = 0xFFFF;
export const bankOf = (entry) => (entry >>> 16) & 0xFF;
export const pcOf = (entry) => entry & PC_MASK;

// The first index at which two traces disagree, or null if one is a prefix of
// the other and they agree as far as both go.
//
// A trace that was cut short at its limit cannot prove agreement past its end,
// so the caller is told which side ran out and how long each was — "no
// divergence" over 1000 instructions of a 3-million-instruction run means very
// little, and the difference matters more than the answer.
export function firstDivergence(a, b) {
    const ta = a && a.pcs ? a.pcs : a;
    const tb = b && b.pcs ? b.pcs : b;
    if (!ta || !tb) return null;
    const na = a && a.count !== undefined ? a.count : ta.length;
    const nb = b && b.count !== undefined ? b.count : tb.length;
    const n = Math.min(na, nb);

    for (let i = 0; i < n; i++) {
        if (ta[i] !== tb[i]) {
            return {
                index: i,
                a: { pc: pcOf(ta[i]), bank: bankOf(ta[i]) },
                b: { pc: pcOf(tb[i]), bank: bankOf(tb[i]) },
                reason: pcOf(ta[i]) === pcOf(tb[i]) ? 'different bank at the same address'
                                                    : 'different address',
                lengths: { a: na, b: nb },
            };
        }
    }
    if (na !== nb) {
        return {
            index: n,
            a: na > n ? { pc: pcOf(ta[n]), bank: bankOf(ta[n]) } : null,
            b: nb > n ? { pc: pcOf(tb[n]), bank: bankOf(tb[n]) } : null,
            reason: 'one run is longer than the other',
            lengths: { a: na, b: nb },
        };
    }
    return null;
}

// The instructions either side of a divergence, which is what makes it readable:
// the shared run-up, then where the two go.
export function divergenceContext(a, b, at, before = 8, after = 8) {
    if (!at) return null;
    const ta = a && a.pcs ? a.pcs : a;
    const tb = b && b.pcs ? b.pcs : b;
    const from = Math.max(0, at.index - before);
    const common = [];
    for (let i = from; i < at.index; i++) common.push(pcOf(ta[i]));
    const branch = (t, n) => {
        const out = [];
        for (let i = at.index; i < Math.min(at.index + after, n); i++) out.push(pcOf(t[i]));
        return out;
    };
    return {
        index: at.index,
        common,
        a: branch(ta, at.lengths.a),
        b: branch(tb, at.lengths.b),
    };
}

// Where two memory images stop agreeing. Both the first address (the one to look
// at) and the runs (what actually changed), because one differing byte in a
// counter and a differing sprite buffer read very differently.
export function diffMemoryImages(a, b, { from = 0, to = 0x10000, maxRuns = 64 } = {}) {
    if (!a || !b) return null;
    const end = Math.min(to, a.length, b.length);
    const runs = [];
    let first = null, count = 0, runStart = -1;

    for (let addr = from; addr < end; addr++) {
        if (a[addr] !== b[addr]) {
            if (first === null) first = addr;
            count++;
            if (runStart < 0) runStart = addr;
        } else if (runStart >= 0) {
            if (runs.length < maxRuns) runs.push({ addr: runStart, length: addr - runStart });
            runStart = -1;
        }
    }
    if (runStart >= 0 && runs.length < maxRuns) runs.push({ addr: runStart, length: end - runStart });

    return { first, count, runs, truncated: count > 0 && runs.length >= maxRuns };
}

// Registers that differ between two captures, in a fixed order so a report reads
// the same way every time.
const REG_ORDER = ['pc', 'sp', 'a', 'f', 'bc', 'de', 'hl', 'ix', 'iy',
                   'a_', 'f_', 'bc_', 'de_', 'hl_', 'i', 'r', 'im', 'iff1', 'iff2'];

export function diffRegisters(a, b) {
    if (!a || !b) return [];
    const out = [];
    for (const name of REG_ORDER) {
        if (a[name] === undefined && b[name] === undefined) continue;
        if (a[name] !== b[name]) out.push({ name, a: a[name], b: b[name] });
    }
    return out;
}

// The whole comparison in one shape, for a driver that wants to log it.
export function compareRuns(runA, runB, opts = {}) {
    const at = firstDivergence(runA.trace, runB.trace);
    return {
        diverged: !!at,
        at,
        context: at ? divergenceContext(runA.trace, runB.trace, at,
                                        opts.before, opts.after) : null,
        memory: (runA.memory && runB.memory)
            ? diffMemoryImages(runA.memory, runB.memory, opts) : null,
        registers: diffRegisters(runA.registers, runB.registers),
        // Neither run proves anything past the point it was cut short at
        truncated: !!(runA.trace && runA.trace.truncated) || !!(runB.trace && runB.trace.truncated),
    };
}
