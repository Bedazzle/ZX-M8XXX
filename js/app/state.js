// Shared mutable state — populated by init.js, read by all modules
export let spectrum = null;
export let disasm = null;
export let labelManager = null;
export let regionManager = null;
export let commentManager = null;
export let operandFormatManager = null;
export let xrefManager = null;
export let subroutineManager = null;
export let foldManager = null;
export let undoManager = null;
export let traceManager = null;
export let testRunner = null;
export let romData = {};

export function setState(key, value) {
    switch(key) {
        case 'spectrum': spectrum = value; break;
        case 'disasm': disasm = value; break;
        case 'labelManager': labelManager = value; break;
        case 'regionManager': regionManager = value; break;
        case 'commentManager': commentManager = value; break;
        case 'operandFormatManager': operandFormatManager = value; break;
        case 'xrefManager': xrefManager = value; break;
        case 'subroutineManager': subroutineManager = value; break;
        case 'foldManager': foldManager = value; break;
        case 'undoManager': undoManager = value; break;
        case 'traceManager': traceManager = value; break;
        case 'testRunner': testRunner = value; break;
        case 'romData': romData = value; break;
    }
}
