// What `window.zxDebug` offers — declared, so a tool can ask instead of guess.
//
// External tools kept reimplementing things the emulator already did, because
// nothing told them what was there. A document can't: a driver talks to whatever
// build happens to be deployed, and the answer to "does this one have an encoded
// search" depends on that build, not on the docs someone read once.
//
// So the surface describes itself. `zxDebug.capabilities()` returns this, and
// `zxDebug.require([...])` turns a missing feature into one clear error at
// startup instead of a silent workaround that grows into a second implementation.
//
// **Every member of zxDebug must appear here.** `tests/api-manifest-test.html`
// fails if one doesn't, and fails again if an entry names something that no
// longer exists — that test is what stops this list becoming fiction.
//
// `since` is the app version a member first appeared in, for `require()`. `null`
// means "older than this manifest": every build that has the manifest at all has
// the member, so a version check on it would be meaningless.

export const API_VERSION = 1;

export const API_CATEGORIES = {
    discovery:    'Asking this build what it can do',
    lifecycle:    'Getting a machine ready, and reporting back',
    memory:       'Reading and writing memory',
    search:       'Finding values and text in memory or in a file',
    tables:       'Recognising data tables by their shape',
    disasm:       'Disassembly, and handing a map to another toolchain',
    execution:    'Running, stepping, and running until something happens',
    breakpoints:  'Execution breakpoints',
    registers:    'The register file',
    map:          'The execution-based code/data map',
    provenance:   'Which instruction read, wrote, called or jumped where',
    differential: 'Running twice with one thing changed, and comparing',
    managers:     'The debugger\'s own labels, regions, comments, xrefs, pokes',
    keyboard:     'Pressing keys without a keyboard',
    media:        'Loading tapes, disks, snapshots and RZX',
    hooks:        'Raw per-access callbacks',
    ui:           'Handles onto UI subsystems',
};

// name: [category, signature, summary, since]
const E = (category, sig, summary, since = null) => ({ category, sig, summary, since });

export const API = {
    // --- discovery ---
    // Declared like everything else: capabilities() that did not list itself would
    // be telling a tool the surface is smaller than it is
    brief:            E('discovery', 'brief() → Promise<string>', 'The one call to start with: the rules a driver needs, then the whole surface of this build, as one markdown string ready to hand to a model.', '0.15.32'),
    capabilities:     E('discovery', 'capabilities() → {apiVersion, appVersion, categories, members}', 'Every member of this build with its signature, summary and the version it appeared in. Sorted and JSON-safe, so two builds diff cleanly.', '0.15.32'),
    help:             E('discovery', 'help(name?) → string', 'One member in prose, or the whole surface as markdown.', '0.15.32'),
    require:          E('discovery', 'require(names) → true', 'Throws one clear error naming what this build is missing and which version would have it. Call it at startup.', '0.15.32'),
    apiVersion:       E('discovery', 'apiVersion → number', 'Bumped when the shape of this surface changes, separately from the app version.', '0.15.32'),

    // --- lifecycle ---
    ready:            E('lifecycle', 'ready({machine, timeoutMs}) → Promise', 'Wait until a ROM is really in memory. Everything else assumes it; a driver that skips it runs a blank $0000-$3FFF and looks like a deep bug.'),
    ensureRom:        E('lifecycle', 'ensureRom(machineType) → Promise', 'Load a machine\'s ROM without switching to it.'),
    start:            E('lifecycle', 'start({machine, timeoutMs}) → Promise<true>', 'Start the machine the way the Start Emulator button does — without depending on its markup id. Resets, so call it before loading anything.', '0.16.0'),
    version:          E('lifecycle', 'version → string', 'The app version, matching APP_VERSION.'),
    spectrum:         E('lifecycle', 'spectrum → Spectrum', 'The emulator itself. The escape hatch: **not a stable interface**, and the planned refactor will move things under it. If you need something from here, it is a gap in this API — say so.'),
    testRunner:       E('lifecycle', 'testRunner → TestRunner', 'The application test runner (Tools → Tests).'),
    report:           E('lifecycle', 'report(data, kind, name) → Promise', 'Write a result to headless/<name>.json through serve.py, so a long run can hand back progress before it exits.'),
    checkpoint:       E('lifecycle', 'checkpoint(data)', 'The DOM-only variant of report(), for pages not served by serve.py.'),
    getCheckpoint:    E('lifecycle', 'getCheckpoint() → any', 'Read back the last checkpoint.'),
    emuClock:         E('lifecycle', 'emuClock() → {frames, tStates}', 'Emulated time. Wall-clock is frozen under --virtual-time-budget, so pace work by this.'),

    // --- memory ---
    peek:             E('memory', 'peek(addr) → byte', 'Read one byte through the current paging, as the CPU sees it.', '0.15.32'),
    poke:             E('memory', 'poke(addr, value)', 'Write one byte through the current paging.', '0.15.32'),
    peekWord:         E('memory', 'peekWord(addr) → word', 'Read a little-endian word.', '0.15.32'),
    pokeWord:         E('memory', 'pokeWord(addr, value)', 'Write a little-endian word.', '0.15.32'),
    peekBlock:        E('memory', 'peekBlock(addr, length) → Uint8Array', 'Read a run of bytes.', '0.15.32'),
    pokeBlock:        E('memory', 'pokeBlock(addr, bytes) → count', 'Write a run of bytes — patching a running program.', '0.15.32'),
    peekBank:         E('memory', 'peekBank(bank) → Uint8Array|null', 'A whole RAM bank whatever is paged in; null if the machine has no such bank.', '0.15.32'),
    snapshotMemory:   E('memory', 'snapshotMemory() → Uint8Array(65536)', 'A flat copy of the paged 64K as it stands.', '0.15.32'),

    // --- search ---
    findBytes:        E('search', 'findBytes(pattern, {from, to, limit, bank}) → addr[]', 'Find bytes or hex text ("CD ?? 00", ? = any byte), in the paged 64K or one bank.', '0.15.32'),
    findWord:         E('search', 'findWord(value, opts) → addr[]', 'Find a little-endian word.', '0.15.32'),
    searchEncodedText: E('search', 'searchEncodedText(text, opts) → match[]', 'Find a word however it is stored: plain, complemented, XOR/offset by any key, the position folded into the key, or nibble-packed.', '0.15.32'),
    searchEncodedBytes: E('search', 'searchEncodedBytes(bytes, text, opts) → match[]', 'The same over an arbitrary byte array — a file you loaded rather than ran.', '0.15.32'),
    decodeEncoded:    E('search', 'decodeEncoded(addr, encoding, key, length, startIndex) → byte[]', 'Undo a scheme so the record around a hit can be read, which is usually the point.', '0.15.32'),
    decodeEncodedBytes: E('search', 'decodeEncodedBytes(bytes, offset, encoding, key, length, startIndex) → byte[]', 'The same over a byte array.', '0.15.32'),
    encodings:        E('search', 'encodings → [{id, label, keys}]', 'The schemes the encoded search tries.', '0.15.32'),

    // --- tables ---
    findKeyScanTables: E('tables', 'findKeyScanTables(from, to, opts) → table[]', 'Find (half-row, key bit) records — a game\'s controls table.', '0.15.32'),
    findCharTables:   E('tables', 'findCharTables(from, to, opts) → table[]', 'Find runs of printable bytes of a key-table length.', '0.15.32'),
    findWordTables:   E('tables', 'findWordTables(from, to, opts) → table[]', 'Find fixed-record word tables — PAW/Quill vocabularies and their like.', '0.15.32'),
    vocabularyByValue: E('tables', 'vocabularyByValue(table, opts) → entry[]', 'A vocabulary in word-value order with the outliers marked, which is what makes it worth reading.', '0.15.32'),

    // --- disasm ---
    disassemble:      E('disasm', 'disassemble(addr, count) → [{addr, bytes, text, length}]', 'Disassemble instructions from an address.', '0.15.32'),
    disassembleRange: E('disasm', 'disassembleRange(from, to) → [{addr, bytes, text, length}]', 'Disassemble a range.', '0.15.32'),
    exportCtl:        E('disasm', 'exportCtl(opts) → string', 'The map as a SkoolKit control file.'),
    exportCsv:        E('disasm', 'exportCsv(opts) → string', 'The map as Ghidra CSV.'),
    exportSym:        E('disasm', 'exportSym(opts) → string', 'Labels as an sjasmplus .sym file.'),

    // --- execution ---
    runFrames:        E('execution', 'runFrames(n)', 'Run n frames through the normal per-frame chain.'),
    pause:            E('execution', 'pause() → bool', 'Stop the machine. Stepping and running-to need it stopped.', '0.15.32'),
    resume:           E('execution', 'resume() → bool', 'Start it again.', '0.15.32'),
    paused:           E('execution', 'paused → bool', 'Whether it is stopped.', '0.15.32'),
    step:             E('execution', 'step(n) → {steps, pc}', 'Step n instructions.', '0.15.32'),
    stepOver:         E('execution', 'stepOver(maxCycles) → {skipped, reached, pc}', 'Step, running a CALL/RST to completion.', '0.15.32'),
    runTo:            E('execution', 'runTo(addr, maxCycles) → {reached, pc}', 'Run until the PC reaches an address.', '0.15.32'),
    runToInterrupt:   E('execution', 'runToInterrupt(maxCycles) → {reached, pc}', 'Run until the next interrupt is taken.', '0.15.32'),
    runToRet:         E('execution', 'runToRet(maxCycles) → {reached, pc}', 'Run until the current routine returns.', '0.15.32'),
    callRoutine:      E('execution', 'callRoutine(addr, {regs, sp, …}) → result', 'Call a routine directly with a register set, and read back what it did.'),

    // --- breakpoints ---
    addBreakpoint:    E('breakpoints', 'addBreakpoint(spec) → bool', 'Break on execution at an address, a range, or an address spec.', '0.15.32'),
    removeBreakpoint: E('breakpoints', 'removeBreakpoint(index) → bool', 'Remove one by its index in breakpoints().', '0.15.32'),
    clearBreakpoints: E('breakpoints', 'clearBreakpoints()', 'Remove them all.', '0.15.32'),
    breakpoints:      E('breakpoints', 'breakpoints() → [{start, end, page, enabled}]', 'List them.', '0.15.32'),

    // --- registers ---
    captureRegisters: E('registers', 'captureRegisters() → {pc, sp, a, f, bc, …}', 'The register file as a plain object.', '0.15.32'),
    setRegisters:     E('registers', 'setRegisters({pc, hl, …}) → registers', 'Set registers by name; an unknown name is an error, not a silent no-op.', '0.15.32'),

    // --- map ---
    enableMap:        E('map', 'enableMap(on, {fast, paged})', 'Record what executes, reads and writes. fast = bitsets, paged = per-bank.'),
    clearMap:         E('map', 'clearMap()', 'Reset the recording.'),
    mapData:          E('map', 'mapData() → {executed, read, written}', 'The rich Map<key,count> form.'),
    mapBits:          E('map', 'mapBits() → {execBits, readBits, writeBits, paged, pagedBits}', 'The bitset form.'),
    ranges:           E('map', 'ranges(opts) → {ranges, pages}', 'Coalesced typed ranges: executed = code, touched = db, printable runs = text.'),
    rangesByPage:     E('map', 'rangesByPage(opts) → {page: ranges}', 'The same, per memory page.'),
    mapRun:           E('map', 'mapRun({url, rzxUrl, frames, smc, calls, report}) → Promise', 'Load, run, map, and report — the whole pipeline in one call.'),

    // --- provenance ---
    watchWrites:      E('provenance', 'watchWrites(lo, hi)', 'Record which instruction writes into a range, and who called it.'),
    stopWrites:       E('provenance', 'stopWrites() → hit[]', 'Stop and return them.'),
    getWrites:        E('provenance', 'getWrites() → hit[]', 'Read them without stopping.'),
    watchReads:       E('provenance', 'watchReads(lo, hi)', 'The same for reads.'),
    stopReads:        E('provenance', 'stopReads() → hit[]', 'Stop and return them.'),
    getReads:         E('provenance', 'getReads() → hit[]', 'Read them without stopping.'),
    watchExec:        E('provenance', 'watchExec(lo, hi)', 'The same for execution.'),
    stopExec:         E('provenance', 'stopExec() → hit[]', 'Stop and return them.'),
    getExec:          E('provenance', 'getExec() → hit[]', 'Read them without stopping.'),
    watchPortReads:   E('provenance', 'watchPortReads(port = null, mask = 0x00FF)', 'Record which instruction reads a port, and who called it. Keyed by (pc, port): for the keyboard the low byte is always $FE and carries nothing, and the half-row select in the high byte is the whole content.', '0.16.0'),
    stopPortReads:    E('provenance', 'stopPortReads() → hit[]', 'Stop and return them.', '0.16.0'),
    getPortReads:     E('provenance', 'getPortReads() → hit[]', 'Read them without stopping. [{pc, port, high, low, bank, count, lastValue, callers, callSites}].', '0.16.0'),
    watchIndirect:    E('provenance', 'watchIndirect()', 'Resolve indirect jumps as they are taken.'),
    stopIndirect:     E('provenance', 'stopIndirect()', 'Stop resolving them.'),
    getIndirect:      E('provenance', 'getIndirect() → target[]', 'The targets seen.'),
    exportIndirectCsv: E('provenance', 'exportIndirectCsv() → string', 'Those targets as CSV.'),
    getSmc:           E('provenance', 'getSmc() → hit[]', 'Self-modifying code: which instruction rewrote which instruction.'),
    exportSmcCsv:     E('provenance', 'exportSmcCsv() → string', 'The same as CSV.'),
    watchCalls:       E('provenance', 'watchCalls()', 'Record the runtime call graph.'),
    stopCalls:        E('provenance', 'stopCalls()', 'Stop recording it.'),
    getCalls:         E('provenance', 'getCalls() → edge[]', 'The edges seen.'),
    exportCallGraphCsv: E('provenance', 'exportCallGraphCsv() → string', 'The call graph as CSV.'),

    // --- differential ---
    recordRun:        E('differential', 'recordRun(fn, opts) → Promise<{trace, memory, registers}>', 'Trace a run, then keep what it left behind. Both runs must start from the same state.', '0.15.32'),
    startExecTrace:   E('differential', 'startExecTrace({limit, from, to})', 'The ordered PC recorder on its own.', '0.15.32'),
    stopExecTrace:    E('differential', 'stopExecTrace() → {pcs, count, truncated, limit}', 'Stop it and take the trace.', '0.15.32'),
    compareRuns:      E('differential', 'compareRuns(a, b, opts) → report', 'The first instruction two runs disagreed on, with the branches, memory and registers.', '0.15.32'),
    firstDivergence:  E('differential', 'firstDivergence(a, b) → at|null', 'Just the point of divergence.', '0.15.32'),
    divergenceContext: E('differential', 'divergenceContext(a, b, at, before, after) → {common, a, b}', 'The run-up they shared and where each went.', '0.15.32'),
    diffMemoryImages: E('differential', 'diffMemoryImages(a, b, opts) → {first, count, runs}', 'Where two memory images stop agreeing.', '0.15.32'),
    diffRegisters:    E('differential', 'diffRegisters(a, b) → [{name, a, b}]', 'Which registers differ.', '0.15.32'),

    // --- managers ---
    labels:           E('managers', 'labels → LabelManager', 'The debugger\'s labels.'),
    regions:          E('managers', 'regions → RegionManager', 'Code/data/text region marking.'),
    comments:         E('managers', 'comments → CommentManager', 'Per-address comments.'),
    xrefs:            E('managers', 'xrefs → XrefManager', 'Cross-references.'),
    pokes:            E('managers', 'pokes → PokeManagerAPI', 'Named poke sets (the cheat-file kind). For a bare write use poke().'),

    // --- keyboard ---
    keyDown:          E('keyboard', 'keyDown(key) → bool', 'Hold a matrix key. An unknown name throws — a chord is one call per key.'),
    keyUp:            E('keyboard', 'keyUp(key) → bool', 'Release one.'),
    keyNames:         E('keyboard', 'keyNames() → string[]', 'Every name the two above accept.', '0.15.32'),
    typeText:         E('keyboard', 'typeText(text, {hold, gap})', 'Type a string, pumping frames itself. \\n is ENTER.'),
    readKeyboardPort: E('keyboard', 'readKeyboardPort(port) → byte', 'Read a keyboard half-row.'),
    setKeyboardGhosting: E('keyboard', 'setKeyboardGhosting(on) → bool', 'The hardware phantom-key behaviour.'),
    keyboardGhosting: E('keyboard', 'keyboardGhosting → bool', 'Whether it is on.'),

    // --- media ---
    loadFile:         E('media', 'loadFile(fileOrBytes, name) → Promise', 'Load a tape, disk, snapshot or archive.'),
    loadUrl:          E('media', 'loadUrl(url, {name, cache}) → Promise', 'Fetch and load, bypassing the HTTP cache — a rebuilt file at the same URL otherwise replays the old bytes.'),
    autoLoad:         E('media', 'autoLoad({type, isTzx, diskRun, …}) → Promise', 'Deterministic boot and load.'),
    tapeState:        E('media', 'tapeState() → {loaded, name, blocks, playing, flashLoad, loaderBlock, playerBlock, phase}', 'Where the tape is: which block the flash loader and the real-time deck have each reached. {loaded:false} when there is no tape, so it can be polled every frame.', '0.16.0'),
    saveSnapshot:     E('media', "saveSnapshot(format = 'z80') → Uint8Array", 'The live machine as a snapshot: z80, sna or szx.', '0.16.0'),
    replayRZX:        E('media', 'replayRZX(bytes, opts) → Promise', 'Play an RZX recording to its true end.'),
    rzxPlaying:       E('media', 'rzxPlaying → bool', 'Whether a replay is running.'),
    rzxFrame:         E('media', 'rzxFrame → number', 'Which frame it is on.'),
    rzxFrameCount:    E('media', 'rzxFrameCount → number', 'How many there are.'),

    // --- hooks ---
    onAccess:         E('hooks', 'onAccess({onFetch, onRead, onWrite})', 'Raw per-access callbacks. Expensive; prefer the map or provenance.'),
    offAccess:        E('hooks', 'offAccess()', 'Remove them.'),

    // --- ui ---
    getDisplayAPI:    E('ui', 'getDisplayAPI() → api', 'Display settings, save slots, quicksave.'),
    getAsmAPI:        E('ui', 'getAsmAPI() → api', 'The assembler panel.'),
    vfs:              E('ui', 'vfs → VFS', 'The assembler\'s virtual filesystem.'),
    assembler:        E('ui', 'assembler → Assembler', 'The sjasmplus-compatible assembler.'),
};

// Newest-first is what a version comparison wants, and these are dotted strings
export function versionAtLeast(have, want) {
    if (!want) return true;
    const a = String(have || '').split('.').map(Number);
    const b = String(want).split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x !== y) return x > y;
    }
    return true;
}

// What a tool gets back from capabilities(): flat, sorted, and JSON-safe, so it
// can be logged, diffed between builds, or handed straight to a model.
export function buildCapabilities(appVersion, present) {
    const out = [];
    for (const name of Object.keys(API).sort()) {
        if (present && !present(name)) continue;
        out.push({ name, ...API[name] });
    }
    return { apiVersion: API_VERSION, appVersion, categories: API_CATEGORIES, members: out };
}

// The check a tool should make at startup: one clear error naming what is missing
// and what build would have it, instead of quietly growing a second implementation.
export function checkRequired(names, appVersion, present) {
    const missing = [], tooOld = [];
    for (const name of names) {
        const entry = API[name];
        if (!entry || (present && !present(name))) { missing.push(name); continue; }
        if (entry.since && !versionAtLeast(appVersion, entry.since)) {
            tooOld.push(`${name} (needs ${entry.since})`);
        }
    }
    if (!missing.length && !tooOld.length) return true;
    const parts = [];
    if (missing.length) parts.push(`not in this build: ${missing.join(', ')}`);
    if (tooOld.length) parts.push(`too old: ${tooOld.join(', ')}`);
    throw new Error(`zxDebug.require: this is ZX-M8XXX ${appVersion} — ${parts.join('; ')}`);
}
