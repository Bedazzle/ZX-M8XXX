// number-hints.js — the tooltips and placeholders follow the hex/decimal switch.
//
// A box that reads decimal while its tooltip says "hex" is the same lie as one
// that prints decimal and parses hex, just told in words. Rather than freezing
// the word into the markup, an element writes `{BASE}` where the base belongs
// and declares which switch it follows:
//
//     <input title="Start address ({BASE})" data-hint-base="addr">
//
// The original text is kept in a dataset entry, so the substitution is redone
// from the template each time and never compounds.

import {
    getAddrBase, getValueBase, onNumberBaseChange,
    parseAddr, parseByte, fmtAddr, fmtByte
} from '../core/addr-format.js';

const ATTRS = ['title', 'placeholder'];
const TOKEN = /\{BASE\}/g;
// A worked example has to move with the word. "Examples: 4000, FE&FF -- read as
// decimal" is worse than saying nothing: the sentence contradicts itself and the
// examples are unusable in the base it just named. {$4000} is written in hex and
// printed as typed in hex, or as its value in decimal.
const LITERAL = /\{\$([0-9A-Fa-f]+)\}/g;

function word(which) {
    const base = which === 'value' ? getValueBase() : getAddrBase();
    return base === 'dec' ? 'decimal' : 'hex';
}

export function refreshNumberHints(root = document) {
    for (const el of root.querySelectorAll('[data-hint-base]')) {
        const which = el.dataset.hintBase;
        const w = word(which);
        const dec = w === 'decimal';
        for (const attr of ATTRS) {
            const key = attr + 'Tpl';
            const tpl = el.dataset[key] ?? el.getAttribute(attr);
            if (tpl === null || tpl === undefined) continue;
            const hasToken = /\{BASE\}|\{\$[0-9A-Fa-f]+\}/.test(tpl);
            if (!hasToken) continue;
            el.dataset[key] = tpl;
            el.setAttribute(attr, tpl
                .replace(TOKEN, w)
                .replace(LITERAL, (_, h) => dec ? String(parseInt(h, 16)) : h));
        }
    }
}

// A box holding one number keeps its VALUE across a switch, not its digits.
// Without this, `16384` typed in decimal is read as $16384 the moment the
// switch is thrown -- the box says one base while the parser is in the other,
// which is the exact bug the whole rework exists to remove. Marked with
// data-hint-num, and converted from the base it was LAST rendered in.
let lastAddr = getAddrBase();
let lastValue = getValueBase();

function reformatNumberBoxes(root = document) {
    for (const el of root.querySelectorAll('[data-hint-num]')) {
        const isValue = el.dataset.hintNum === 'value';
        const from = isValue ? lastValue : lastAddr;
        const to = isValue ? getValueBase() : getAddrBase();
        if (from === to) continue;
        const raw = (el.value || '').trim();
        if (!raw) continue;
        // Anything that is not one plain number -- a range, a page prefix, a
        // comma list -- is left exactly as the user typed it.
        const v = isValue ? parseByte(raw, { base: from }) : parseAddr(raw, { base: from });
        if (v === null) continue;
        el.value = isValue ? fmtByte(v) : fmtAddr(v);
    }
}

export function initNumberHints() {
    refreshNumberHints();
    onNumberBaseChange(() => {
        reformatNumberBoxes();
        lastAddr = getAddrBase();
        lastValue = getValueBase();
        refreshNumberHints();
    });
}
