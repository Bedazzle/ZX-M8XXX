// disk-file-copy.js — pure helpers for copying TR-DOS/SCL files between disk
// panels in the Explorer editor.
//
// No DOM and no module-global state, so this is imported by both ui/explorer.js
// (the Edit-tab Copy path) and tests/disk-test.html (regression coverage).
//
// Centralises the "monoloader" rule, which is NOT BASIC-specific: any file whose
// declared catalogue `length` is smaller than its sector allocation
// (`sectors × 256`) has appended CODE/data living past the declared length — a
// BASIC loader + glued CODE is the common case, but CODE/DATA files can carry a
// payload tail too. On copy the whole allocation must be carried verbatim,
// keeping the source catalogue entry — slicing to the declared length drops the
// tail (the v0.15.13 bug this guards). This matches what the Hex Dump / File
// Info viewers already show (`sectors × 256` for every TR-DOS/SCL type).

// Scan a BASIC file's data for the 0x80 0xAA autostart trailer.
// Returns the line number, or -1 for "no autostart" (line >= 32768 or absent).
export function trdBasicAutostartLine(data) {
    if (!data || data.length < 4) return -1;
    for (let i = 0; i < data.length - 3; i++) {
        if (data[i] === 0x80 && data[i + 1] === 0xAA) {
            const line = data[i + 2] | (data[i + 3] << 8);
            return line < 32768 ? line : -1;  // >= 32768 = no autostart
        }
    }
    return -1;
}

// True when a file's sector allocation exceeds what its declared length needs —
// i.e. a monoloader (any type) with appended CODE/data in the extra sectors.
export function isMonoloader(length, sectors) {
    return sectors > Math.ceil((length || 0) / 256);
}

// Build the cross-format copy descriptor for a TR-DOS/SCL panel file (any type).
// `f` = { name, ext, startAddress, length, programLength, sectors, data }.
// `opts` = { keepSlack }.
// Returns { name, ext, type, addr, autostart, varsOffset, rawData[, slack][, verbatim] }.
export function extractTrdFileDescriptor(f, opts = {}) {
    const name = f.name.replace(/\s+$/, '');
    const isBasic = f.ext === 'B';

    if (isMonoloader(f.length, f.sectors)) {
        // Monoloader (any type): carry the whole allocation verbatim and keep the
        // source catalogue entry (length/start/programLength) so the copy is byte-
        // and directory-identical to the source.
        const line = isBasic ? trdBasicAutostartLine(f.data) : -1;
        return {
            name,
            ext: f.ext,
            type: isBasic ? 0 : 3,
            addr: isBasic ? 0 : (f.startAddress || 0),
            autostart: (line >= 0 && line < 32768) ? line : null,
            varsOffset: isBasic ? f.programLength : null,
            rawData: f.data.slice(0, f.sectors * 256),
            verbatim: {
                length: f.length,
                startAddress: f.startAddress || 0,
                programLength: f.programLength
            }
        };
    }

    if (isBasic) {
        // Normal BASIC: length = program+vars total, programLength = vars offset.
        const line = trdBasicAutostartLine(f.data);
        return {
            name, ext: f.ext, type: 0, addr: 0,
            autostart: (line >= 0 && line < 32768) ? line : null,
            varsOffset: (f.programLength != null) ? Math.min(f.length, f.programLength) : f.length,
            rawData: f.data.slice(0, f.length)
        };
    }

    // Normal CODE / DATA / # : extract the declared length; optionally carry the
    // last-sector slack (Keep slack) for byte-faithful round-trips.
    const desc = {
        name, ext: f.ext, type: 3, addr: f.startAddress || 0, autostart: null,
        rawData: f.data.slice(0, f.length)
    };
    if (opts.keepSlack && f.data && f.data.length > f.length) {
        desc.slack = f.data.slice(f.length, f.sectors * 256);
    }
    return desc;
}

// Split a monoloader into its loader + appended payload, for reverse-
// engineering. The loader keeps the original catalogue entry trimmed to its
// declared length; the appended bytes (everything past the declared length, to
// the end of the allocation) become a separate CODE ('C') entry with an unknown
// load address (0 — the framing is known only to the original loader, so it
// isn't guessed; the user sets it once they read the loader). The split point is
// the declared catalogue length. Returns { loader, payload } as panel diskFile
// models. Caller should guard with isMonoloader(f.length, f.sectors).
export function splitMonoloader(f) {
    const declared = f.length || 0;

    const loaderSectors = Math.max(1, Math.ceil(declared / 256));
    const loaderData = new Uint8Array(loaderSectors * 256);
    loaderData.set(f.data.subarray(0, Math.min(declared, f.data.length)));
    const loader = {
        name: f.name,
        ext: f.ext,
        startAddress: f.startAddress || 0,
        length: declared,
        programLength: (f.programLength != null) ? Math.min(f.programLength, declared) : null,
        sectors: loaderSectors,
        data: loaderData,
        deleted: false
    };

    const payloadBytes = f.data.subarray(declared, f.sectors * 256);
    const payloadSectors = Math.max(1, Math.ceil(payloadBytes.length / 256));
    const payloadData = new Uint8Array(payloadSectors * 256);
    payloadData.set(payloadBytes);
    const payload = {
        name: f.name,
        ext: 'C',               // appended bytes are raw CODE
        startAddress: 0,        // unknown — the framing lives in the loader
        length: payloadBytes.length,
        programLength: null,
        sectors: payloadSectors,
        data: payloadData,
        deleted: false
    };

    return { loader, payload };
}

// Map a copy descriptor to the `meta` a destination disk-add expects.
// Harmless for plain descriptors (no `verbatim` → just autostart/varsOffset).
export function addMetaFromDescriptor(file) {
    const meta = { autostart: file.autostart, varsOffset: file.varsOffset };
    if (file.verbatim) {
        meta.verbatim = true;
        meta.length = file.verbatim.length;
        meta.startAddress = file.verbatim.startAddress;
        // shapeBasicEntry (BASIC dest) reads varsOffset for the program/vars split.
        if (file.verbatim.programLength != null) meta.varsOffset = file.verbatim.programLength;
    }
    return meta;
}

// Shape a BASIC ('B') file's bytes + catalogue length/programLength for a
// destination disk entry. `meta` = { autostart, varsOffset, verbatim?, length? }.
// Returns { data, length, programLength } (start address is always 0 for BASIC).
export function shapeBasicEntry(data, meta) {
    const info = meta || {};
    if (info.verbatim) {
        // Byte-faithful copy (monoloaders): keep the data and the source
        // catalogue length/programLength exactly — re-trailering / re-measuring
        // would corrupt the appended CODE living in the extra sectors.
        const length = (info.length != null) ? info.length : data.length;
        const programLength = (info.varsOffset != null) ? info.varsOffset : length;
        return { data, length, programLength };
    }
    // TR-DOS BASIC layout (per TR-DOS SAVE): file data = program+variables, then
    // 0x80 end marker, 0xAA, and the autostart line as LE16 (0x8000 = none).
    let progVars = data;
    if (progVars.length > 0 && progVars[progVars.length - 1] === 0x80) {
        progVars = progVars.slice(0, progVars.length - 1); // 0x80 re-added below
    }
    const line = (info.autostart != null && info.autostart >= 0 && info.autostart < 32768)
        ? info.autostart : 0x8000;
    const fileData = new Uint8Array(progVars.length + 4);
    fileData.set(progVars, 0);
    fileData[progVars.length] = 0x80;
    fileData[progVars.length + 1] = 0xAA;
    fileData[progVars.length + 2] = line & 0xFF;
    fileData[progVars.length + 3] = (line >> 8) & 0xFF;
    const programLength = (info.varsOffset != null)
        ? Math.min(info.varsOffset, progVars.length)
        : progVars.length;
    return { data: fileData, length: progVars.length, programLength };
}
