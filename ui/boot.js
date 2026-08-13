// boot.js — splice the markup partials into the page, then start the app.
//
// index.html used to hold every panel and dialog: ~3,900 lines and 1,161 ids in
// one file, so adding a control meant hunting for the right region. The markup now
// lives in html/, one file per area, and each <div data-include="..."> is replaced
// by its contents here.
//
// Why a loader rather than a build step: the project has no build tooling, and
// ui/help-content.html was already fetched at runtime, so this is the same trick.
//
// Ordering matters more than it looks. Every ui/ module resolves its elements with
// getElementById at init time, so app-init must not run until the DOM is complete —
// hence the dynamic import *after* the splice, instead of a second <script>.

const FALLBACK_MESSAGE =
    'ZX-M8XXX could not load its interface files (html/). Serve the folder over ' +
    'HTTP rather than opening index.html directly.';

async function splice(el) {
    const url = el.getAttribute('data-include');
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const html = await res.text();
    // Replacing outerHTML leaves no wrapper element behind, so CSS that depends on
    // direct-child relationships (.container > .tab-container and friends) is
    // unaffected.
    el.outerHTML = html;
}

// One pass: fetch every placeholder currently in the document and splice it in.
// Returns how many were replaced, so the caller can keep going while a partial
// brings in placeholders of its own (panel-utils pulls in the individual tools).
async function splicePass() {
    // Snapshot first: replacing one placeholder removes it from the document.
    const slots = Array.from(document.querySelectorAll('[data-include]'));
    if (!slots.length) return 0;
    const parts = await Promise.all(slots.map(el =>
        fetch(el.getAttribute('data-include'), { cache: 'no-cache' })
            .then(r => {
                if (!r.ok) throw new Error(`${el.getAttribute('data-include')}: HTTP ${r.status}`);
                return r.text();
            })));
    slots.forEach((el, i) => { el.outerHTML = parts[i]; });
    return slots.length;
}

async function boot() {
    try {
        // Nested includes are allowed; the cap turns a cycle into an error rather
        // than a hung page.
        for (let depth = 0; depth < 5; depth++) {
            if (await splicePass() === 0) break;
            if (depth === 4) throw new Error('include nesting too deep (a cycle?)');
        }
    } catch (err) {
        document.body.insertAdjacentHTML('afterbegin',
            `<div style="padding:16px;font-family:monospace;color:#f88">${FALLBACK_MESSAGE}<br>${err.message}</div>`);
        throw err;
    }

    await import('./app-init.js');
}

boot();
