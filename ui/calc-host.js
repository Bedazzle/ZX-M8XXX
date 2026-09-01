// calc-host.js — where the programmer calculator currently lives.
//
// The calculator is a singleton. Its markup uses fixed ids (#calcInput, #calcDec,
// …) and initCalculator binds its buttons with document-wide selectors, so a
// second copy in the DOM would fight the first for every one of them. The
// debugger's right panel and the assembler's split pane therefore SHARE one
// calculator by moving its node, rather than each owning an instance.
//
// A host registers itself with a predicate saying whether it currently wants the
// calculator. On every switch that could change the answer — a panel type, the
// split pane, a main tab — refreshCalcHost() hands it to the first host that both
// wants it and is on screen. "On screen" is settled by offsetParent, which is null
// for anything inside an inactive tab, so no host needs to know about the others.

const hosts = [];     // [{ el, wants }] in priority order
let wrapper = null;   // the node that moves: .calc-wrapper
let home = null;      // #rightCalculatorView — where it sits when nobody wants it

export function initCalcHost() {
    home = document.getElementById('rightCalculatorView');
    wrapper = home && home.querySelector('.calc-wrapper');
    if (!wrapper) return;

    // A main-tab switch changes which host is on screen. The tab buttons swap the
    // .active classes in their own click handler, so re-home after that has run.
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => setTimeout(refreshCalcHost, 0));
    });
}

// el: the container to move the calculator into. wants: () => boolean.
export function registerCalcHost(el, wants) {
    if (el) hosts.push({ el, wants });
}

// Move the calculator to the first host that wants it and is visible, or park it
// back home. Safe to call at any time, and cheap when nothing changed.
export function refreshCalcHost() {
    if (!wrapper) return false;
    const owner = hosts.find(h => h.wants() && h.el.offsetParent !== null);
    const target = owner ? owner.el : home;
    if (wrapper.parentNode !== target) target.appendChild(wrapper);
    return !!owner;
}
