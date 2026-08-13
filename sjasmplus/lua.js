// lua.js — LUA/ENDLUA scripting for the assembler, as sjasmplus does it
//
// sjasmplus embeds a full standard Lua (5.1 up to v1.19, 5.4 from v1.20, 5.5 in
// v1.21.1) and exposes the compiler through `_c`/`_pc`/`_pl` and the `sj` table.
// We embed fengari (Lua 5.3 in pure JS, MIT, lib/fengari-web.js) — close enough to
// 5.4/5.5 for assembler glue scripts, and the same stdlib those scripts use
// (string.format/pack, bitwise operators, integer division, table, math, os).
//
// Deliberate compatibility notes:
//   * The engine is loaded ON DEMAND — only a source containing a LUA block pays
//     the ~220 KB. Call `loadLuaEngine()` before assembling such a source.
//   * ONE Lua state per assembly, kept across passes: sjasmplus documents that
//     variables set in `LUA PASS1` are still there in `LUA PASS2`/`PASS3`.
//   * `unpack`, `math.pow` and the old `bit`/`hex` libraries are NOT provided —
//     current sjasmplus doesn't have them either (5.4 made them native or dropped
//     them). Scripts using them get an error naming the replacement.
//   * `io` is missing from fengari (no filesystem in a browser), so we provide a
//     small `io` over the assembler's VFS — enough for the documented pattern of
//     writing a binary with `io.open(name,"wb")` + `f:write(string.pack(...))`.

const FENGARI_URL = new URL('../lib/fengari-web.js', import.meta.url).href;

let loadPromise = null;

// Is the engine already in the page?
export function isLuaEngineLoaded() {
    return typeof window !== 'undefined' && !!window.fengari;
}

// Load fengari once. Safe to call repeatedly; resolves immediately when loaded.
export function loadLuaEngine() {
    if (isLuaEngineLoaded()) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
        if (typeof document === 'undefined') {
            reject(new Error('LUA needs a browser environment (fengari)'));
            return;
        }
        const tag = document.createElement('script');
        tag.src = FENGARI_URL;
        tag.async = true;
        tag.onload = () => resolve(true);
        tag.onerror = () => reject(new Error(
            `LUA support needs lib/fengari-web.js (failed to load ${FENGARI_URL})`));
        document.head.appendChild(tag);
    });
    return loadPromise;
}

// Does this source use LUA blocks? (cheap pre-check so the editor knows whether
// to load the engine before assembling)
export function sourceUsesLua(text) {
    return /^[ \t]*LUA\b/im.test(text || '');
}

// Pass filter from the `LUA [pass]` argument. Default is PASS3 — the last pass —
// which is why code-generating blocks must say ALLPASS.
export function parseLuaPass(arg) {
    const a = (arg || '').trim().toUpperCase();
    if (a === '' || a === 'PASS3') return 'PASS3';
    if (a === 'PASS1' || a === 'PASS2' || a === 'ALLPASS') return a;
    return null;                       // caller reports "unknown LUA pass"
}

// Should a block with this filter run in this pass? `isLast` marks the emitting
// pass (sjasmplus pass 3).
export function luaPassMatches(filter, pass, isLast) {
    switch (filter) {
        case 'ALLPASS': return true;
        case 'PASS1': return pass === 1;
        case 'PASS2': return pass === 2;
        case 'PASS3': return !!isLast;
        default: return false;
    }
}

// Build a Lua runtime bound to one assembly run.
//
// `host` supplies everything the bindings need, so this module never reaches into
// the assembler directly:
//   calc(expr) -> number            parseCode(text)      parseLine(text)
//   error(msg, bad)                 warning(msg, bad)
//   getLabel(name) -> number        insertLabel(name, addr) -> boolean
//   getDefine(name, macroArgs)      insertDefine(id, value) -> boolean
//   getAddress() / setAddress(a)    addByte(b) / addWord(w)
//   getByte(a) / getWord(a)         getPass() -> 1..3
//   errorCount() / warningCount()   getDevice() / setDevice(id, ramtop)
//   setPage(n) / setSlot(n)         getModules() -> string
//   fileExists(name) -> boolean     print(text)
//   exit(code)                      vfsRead(name) / vfsWrite(name, Uint8Array)
//   zxTrdCreate(name, label)        zxTrdAddFile(trd, trdosName, start, len,
//   zxSaveSna(name, startAddr)                   autostart, replace)
export function createLuaRuntime(host) {
    if (!isLuaEngineLoaded()) {
        throw new Error('LUA engine not loaded — call loadLuaEngine() first');
    }
    const { lua, lauxlib, lualib, to_luastring, to_jsstring } = window.fengari;

    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);

    // ---- helpers ----------------------------------------------------------
    const str = (i) => to_jsstring(lauxlib.luaL_checkstring(L, i));
    const optStr = (i, dflt) => (lua.lua_isnoneornil(L, i) ? dflt : str(i));
    const num = (i) => lauxlib.luaL_checkinteger(L, i);
    const pushStr = (s) => lua.lua_pushstring(L, to_luastring(String(s)));
    const pushBool = (b) => lua.lua_pushboolean(L, b ? 1 : 0);

    const fn = (name, f) => {
        lua.lua_pushcfunction(L, (LL) => {
            try {
                return f(LL);
            } catch (e) {
                // Turn a host-side throw into a Lua error, so scripts can pcall it
                // and the message carries the script location.
                return lauxlib.luaL_error(L, to_luastring(`${name}: ${e.message}`));
            }
        });
    };
    const setGlobalFn = (name, f) => { fn(name, f); lua.lua_setglobal(L, to_luastring(name)); };
    const setField = (name, f) => { fn(name, f); lua.lua_setfield(L, -2, to_luastring(name)); };

    // ---- globals: _c / _pc / _pl -----------------------------------------
    setGlobalFn('_c', () => { lua.lua_pushinteger(L, host.calc(str(1)) | 0); return 1; });
    setGlobalFn('_pc', () => { host.parseCode(str(1)); return 0; });
    setGlobalFn('_pl', () => { host.parseLine(str(1)); return 0; });

    // print() goes to the assembler's message list, not the browser console
    setGlobalFn('print', () => {
        const n = lua.lua_gettop(L);
        const parts = [];
        for (let i = 1; i <= n; i++) {
            lua.lua_pushvalue(L, i);
            parts.push(to_jsstring(lauxlib.luaL_tolstring(L, -1, null)));
            lua.lua_pop(L, 2);
        }
        host.print(parts.join('\t'));
        return 0;
    });

    // ---- the sj table -----------------------------------------------------
    // Functions live in a plain table; the read/write "variables" (current_address,
    // pass, error_count, warning_count) go through a metatable so they behave like
    // sjasmplus's properties (sj.current_address = X acts as ORG X).
    lua.lua_newtable(L);                                  // sj (function table)

    setField('calc', () => { lua.lua_pushinteger(L, host.calc(str(1)) | 0); return 1; });
    setField('parse_code', () => { host.parseCode(str(1)); return 0; });
    setField('parse_line', () => { host.parseLine(str(1)); return 0; });
    setField('error', () => { host.error(str(1), optStr(2, null)); return 0; });
    setField('warning', () => { host.warning(str(1), optStr(2, null)); return 0; });
    setField('file_exists', () => { pushBool(host.fileExists(str(1))); return 1; });
    setField('get_define', () => {
        const v = host.getDefine(str(1), lua.lua_toboolean(L, 2));
        if (v === null || v === undefined) lua.lua_pushnil(L); else pushStr(v);
        return 1;
    });
    setField('insert_define', () => { pushBool(host.insertDefine(str(1), optStr(2, ''))); return 1; });
    setField('get_label', () => { lua.lua_pushinteger(L, host.getLabel(str(1)) | 0); return 1; });
    setField('insert_label', () => { pushBool(host.insertLabel(str(1), num(2))); return 1; });
    setField('add_byte', () => { host.addByte(num(1) & 0xFF); return 0; });
    setField('add_word', () => { host.addWord(num(1) & 0xFFFF); return 0; });
    setField('get_byte', () => { lua.lua_pushinteger(L, host.getByte(num(1)) & 0xFF); return 1; });
    setField('get_word', () => { lua.lua_pushinteger(L, host.getWord(num(1)) & 0xFFFF); return 1; });
    setField('get_device', () => { pushStr(host.getDevice()); return 1; });
    setField('set_device', () => { pushBool(host.setDevice(optStr(1, 'NONE'), lua.lua_isnoneornil(L, 2) ? 0 : num(2))); return 1; });
    setField('set_page', () => { pushBool(host.setPage(num(1))); return 1; });
    setField('set_slot', () => { pushBool(host.setSlot(num(1))); return 1; });
    setField('get_modules', () => { pushStr(host.getModules()); return 1; });
    setField('get_page_at', () => { lua.lua_pushinteger(L, host.getPageAt(num(1)) | 0); return 1; });
    setField('exit', () => { host.exit(lua.lua_isnoneornil(L, 1) ? 1 : num(1)); return 0; });
    setField('shellexec', () => {
        host.warning('sj.shellexec is not available in the browser', str(1));
        return 0;
    });

    // Properties via metatable: keep the function table as the "store" and add
    // __index/__newindex that answer the four documented variables.
    lua.lua_newtable(L);                                  // metatable
    fn('sj.__index', (LL) => {
        const key = to_jsstring(lauxlib.luaL_checkstring(L, 2));
        switch (key) {
            case 'current_address': lua.lua_pushinteger(L, host.getAddress() & 0xFFFF); return 1;
            case 'pass': lua.lua_pushinteger(L, host.getPass()); return 1;
            case 'error_count': lua.lua_pushinteger(L, host.errorCount()); return 1;
            case 'warning_count': lua.lua_pushinteger(L, host.warningCount()); return 1;
            default: lua.lua_pushnil(L); return 1;
        }
    });
    lua.lua_setfield(L, -2, to_luastring('__index'));
    fn('sj.__newindex', (LL) => {
        const key = to_jsstring(lauxlib.luaL_checkstring(L, 2));
        if (key === 'current_address') {          // documented: same as ORG value
            host.setAddress(lauxlib.luaL_checkinteger(L, 3) & 0xFFFF);
            return 0;
        }
        if (['pass', 'error_count', 'warning_count'].includes(key)) {
            return lauxlib.luaL_error(L, to_luastring(`sj.${key} is read-only`));
        }
        lua.lua_rawset(L, 1);                     // anything else: ordinary field
        return 0;
    });
    lua.lua_setfield(L, -2, to_luastring('__newindex'));
    lua.lua_setmetatable(L, -2);
    lua.lua_setglobal(L, to_luastring('sj'));

    // ---- zx table ---------------------------------------------------------
    // The ZX-specific output helpers. Each returns a boolean like sjasmplus does,
    // and routes to the same save commands as EMPTYTRD / SAVETRD / SAVESNA, so a
    // script produces byte-identical files to the directives.
    const optNum = (i, dflt) => (lua.lua_isnoneornil(L, i) ? dflt : num(i));
    lua.lua_newtable(L);
    setField('trdimage_create', () => {
        pushBool(host.zxTrdCreate(str(1), optStr(2, '')));
        return 1;
    });
    setField('trdimage_add_file', () => {
        pushBool(host.zxTrdAddFile(str(1), str(2), num(3), num(4),
                                   optNum(5, -1), lua.lua_toboolean(L, 6)));
        return 1;
    });
    setField('save_snapshot_sna', () => {
        pushBool(host.zxSaveSna(str(1), optNum(2, null)));
        return 1;
    });
    lua.lua_setglobal(L, to_luastring('zx'));

    // ---- io over the VFS --------------------------------------------------
    // fengari has no io library (no filesystem). Scripts in the sjasmplus docs
    // write binaries with io.open(name,"wb") + f:write(string.pack(...)), so map
    // that onto the assembler's virtual filesystem.
    installIo(L, window.fengari, host);

    // ---- run --------------------------------------------------------------
    return {
        // Execute one LUA block. Returns null on success, or an error message.
        run(code, chunkName = 'LUA') {
            const buf = to_luastring(code);
            const status = lauxlib.luaL_loadbuffer(L, buf, buf.length, to_luastring('@' + chunkName));
            if (status !== lua.LUA_OK) {
                const msg = to_jsstring(lauxlib.luaL_tolstring(L, -1, null));
                lua.lua_pop(L, 2);
                return msg;
            }
            // Run under a message handler so a runtime error carries a Lua
            // traceback (which line of the script, through which calls) instead of
            // a bare message with no location.
            const fnIndex = lua.lua_gettop(L);
            lua.lua_pushcfunction(L, (LL) => {
                let msg = lua.lua_tostring(L, 1);
                if (msg === null) {                       // non-string error value
                    msg = lauxlib.luaL_tolstring(L, 1, null);
                    lua.lua_pop(L, 1);
                }
                lauxlib.luaL_traceback(L, L, msg, 1);
                return 1;
            });
            lua.lua_insert(L, fnIndex);                   // handler below the chunk
            const st = lua.lua_pcall(L, 0, 0, fnIndex);
            if (st !== lua.LUA_OK) {
                const msg = to_jsstring(lauxlib.luaL_tolstring(L, -1, null));
                lua.lua_pop(L, 2);                        // message + tolstring copy
                lua.lua_remove(L, fnIndex);               // the handler
                return msg;
            }
            lua.lua_remove(L, fnIndex);
            return null;
        },
        // Free the state (called when an assembly finishes)
        close() {
            try { lua.lua_close(L); } catch (e) { /* nothing useful to do */ }
        },
    };
}

// A minimal `io` for scripts that write build artefacts. Files land in the
// assembler's VFS, which is where SAVEBIN/SAVETAP output goes too.
function installIo(L, fengari, host) {
    const { lua, lauxlib, to_luastring, to_jsstring } = fengari;
    const handles = new Map();
    let nextId = 1;

    const pushHandle = (id) => {
        lua.lua_newtable(L);
        lua.lua_pushinteger(L, id);
        lua.lua_setfield(L, -2, to_luastring('__id'));

        const method = (name, f) => {
            lua.lua_pushcfunction(L, (LL) => {
                lua.lua_getfield(L, 1, to_luastring('__id'));
                const hid = lua.lua_tointeger(L, -1);
                lua.lua_pop(L, 1);
                const h = handles.get(hid);
                if (!h) return lauxlib.luaL_error(L, to_luastring(`io: ${name} on a closed file`));
                try {
                    return f(h);
                } catch (e) {
                    // Without this a JS throw escapes as a bare, location-less error
                    const where = (e.stack || '').split('\n')[1] || '';
                    return lauxlib.luaL_error(L, to_luastring(`io:${name}: ${e.message} [${where.trim()}]`));
                }
            });
            lua.lua_setfield(L, -2, to_luastring(name));
        };

        method('write', (h) => {
            const n = lua.lua_gettop(L);
            for (let i = 2; i <= n; i++) {
                const s = to_jsstring(lauxlib.luaL_tolstring(L, i, null));
                lua.lua_pop(L, 1);
                for (let c = 0; c < s.length; c++) h.bytes.push(s.charCodeAt(c) & 0xFF);
            }
            lua.lua_pushvalue(L, 1);                 // returns the file, as Lua does
            return 1;
        });
        // Only a write handle flushes its buffer — closing a file opened "rb"
        // must not replace it with the (empty) write buffer. An ALLPASS block that
        // opens a file for reading runs once per pass, so getting this wrong
        // truncates the file on the first pass and reads nothing thereafter.
        const isWriting = (h) => /[wa]/.test(h.mode || '');
        method('close', (h) => {
            if (isWriting(h)) host.vfsWrite(h.name, new Uint8Array(h.bytes));
            handles.delete(h.id);
            lua.lua_pushboolean(L, 1);
            return 1;
        });
        method('flush', (h) => {
            if (isWriting(h)) host.vfsWrite(h.name, new Uint8Array(h.bytes));
            lua.lua_pushvalue(L, 1);
            return 1;
        });
        method('seek', (h) => {
            // Enough of Lua's seek for the common "how big is this file?" idiom:
            // f:seek("end") returns the size. Only VFS-backed reads are sized.
            const whence = lua.lua_isnoneornil(L, 2) ? 'cur' : to_jsstring(lauxlib.luaL_checkstring(L, 2));
            const data = host.vfsRead(h.name);
            const size = data ? data.length : h.bytes.length;
            let pos = h.pos || 0;
            if (whence === 'end') pos = size;
            else if (whence === 'set') pos = lua.lua_isnoneornil(L, 3) ? 0 : lauxlib.luaL_checkinteger(L, 3);
            h.pos = pos;
            lua.lua_pushinteger(L, pos);
            return 1;
        });
        method('read', (h) => {
            const data = host.vfsRead(h.name);
            if (!data) { lua.lua_pushnil(L); return 1; }
            let s = '';
            for (const b of data) s += String.fromCharCode(b);
            lua.lua_pushstring(L, to_luastring(s));
            return 1;
        });
    };

    lua.lua_newtable(L);                                       // io
    lua.lua_pushcfunction(L, (LL) => {
        const name = to_jsstring(lauxlib.luaL_checkstring(L, 1));
        const mode = lua.lua_isnoneornil(L, 2) ? 'r' : to_jsstring(lauxlib.luaL_checkstring(L, 2));
        const writing = /[wa]/.test(mode);
        if (!writing && !host.vfsRead(name)) {
            lua.lua_pushnil(L);
            lua.lua_pushstring(L, to_luastring(`${name}: No such file`));
            return 2;                                          // nil, err — as Lua does
        }
        const id = nextId++;
        handles.set(id, { id, name, mode, bytes: [] });
        pushHandle(id);
        return 1;
    });
    lua.lua_setfield(L, -2, to_luastring('open'));

    lua.lua_pushcfunction(L, (LL) => {                          // io.write -> print
        const n = lua.lua_gettop(L);
        const parts = [];
        for (let i = 1; i <= n; i++) {
            parts.push(to_jsstring(lauxlib.luaL_tolstring(L, i, null)));
            lua.lua_pop(L, 1);
        }
        host.print(parts.join(''));
        return 0;
    });
    lua.lua_setfield(L, -2, to_luastring('write'));
    lua.lua_setglobal(L, to_luastring('io'));

    // os.remove / os.rename over the VFS — scripts use them to clean up build
    // artefacts. fengari's os library has no filesystem at all.
    lua.lua_getglobal(L, to_luastring('os'));
    if (lua.lua_isnil(L, -1)) { lua.lua_pop(L, 1); lua.lua_newtable(L); }
    lua.lua_pushcfunction(L, (LL) => {
        const name = to_jsstring(lauxlib.luaL_checkstring(L, 1));
        const existed = host.vfsRemove(name);
        if (existed) { lua.lua_pushboolean(L, 1); return 1; }
        lua.lua_pushnil(L);
        lua.lua_pushstring(L, to_luastring());
        return 2;
    });
    lua.lua_setfield(L, -2, to_luastring('remove'));
    lua.lua_setglobal(L, to_luastring('os'));
}
