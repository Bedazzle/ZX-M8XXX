// comment-visibility.js — which comments the disassembly shows.
//
// Comments carried over from an assembled source (`source: 'asm'`) and ones typed
// in the debugger are toggled separately, in the disasm ⚙ options. A build can
// bring in hundreds at once, so "show me only what I wrote" and "show me only
// what the source said" are different questions and each is worth asking.
//
// Both disassembly views (left `ui/debugger-display.js`, right
// `ui/right-disasm-view.js`) render comments with the same code, so the rule
// lives here rather than in each of them.

let els = null;

function checkbox(id) {
    if (!els) els = {};
    if (!(id in els)) els[id] = document.getElementById(id);
    return els[id];
}

// Absent checkbox = shown, so this is safe before the markup is spliced in.
const shown = (id) => {
    const el = checkbox(id);
    return !el || el.checked;
};

export const showAsmComments = () => shown('chkAsmComments');
export const showUserComments = () => shown('chkUserComments');

// The comment to render at an address, or null when its kind is switched off.
export function visibleComment(comment) {
    if (!comment) return null;
    const wanted = comment.source === 'asm' ? showAsmComments() : showUserComments();
    return wanted ? comment : null;
}
