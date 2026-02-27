/**
 * ZX-M8XXX - Undo Manager
 * Provides undo/redo functionality for debugger actions.
 * @license GPL-3.0
 *
 * External dependencies (passed via constructor callbacks):
 * - updateDebugger(): Called after undo/redo to refresh the debugger view
 * - showMessage(): Called to display undo/redo status messages
 */

// Lines 11917-11968 of index.html

export class UndoManager {
    constructor(maxHistory = 50, callbacks = {}) {
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = maxHistory;
        this._onUpdate = callbacks.onUpdate || null;    // called after undo/redo (replaces updateDebugger)
        this._onMessage = callbacks.onMessage || null;  // called to show messages (replaces showMessage)
    }

    push(action) {
        // action = {type, description, undo(), redo()}
        this.undoStack.push(action);
        this.redoStack = [];
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.updateButtons();
    }

    undo() {
        if (this.undoStack.length === 0) return false;
        const action = this.undoStack.pop();
        action.undo();
        this.redoStack.push(action);
        this.updateButtons();
        if (this._onUpdate) this._onUpdate();
        if (this._onMessage) this._onMessage(`Undo: ${action.description}`);
        return true;
    }

    redo() {
        if (this.redoStack.length === 0) return false;
        const action = this.redoStack.pop();
        action.redo();
        this.undoStack.push(action);
        this.updateButtons();
        if (this._onUpdate) this._onUpdate();
        if (this._onMessage) this._onMessage(`Redo: ${action.description}`);
        return true;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.updateButtons();
    }

    updateButtons() {
        const btnUndo = document.getElementById('btnUndo');
        const btnRedo = document.getElementById('btnRedo');
        if (btnUndo) btnUndo.disabled = this.undoStack.length === 0;
        if (btnRedo) btnRedo.disabled = this.redoStack.length === 0;
    }
}
