/**
 * ZX-M8XXX - Rewind buffer
 * @license GPL-3.0
 *
 * Keeps the last N machine states in a ring so the user can step back in time:
 * "I just died / I just missed the bug, go back three seconds". The states are
 * ordinary snapshots (SZX), so a rewind point is exactly what a quickload is.
 *
 * This module owns only the bookkeeping - when to capture, what to drop, where
 * "now" is while scrubbing. Taking and restoring a state is passed in, so it can
 * be tested without an emulator and can't accidentally reach into one.
 *
 *   const rw = createRewindBuffer({ capture, restore, intervalFrames: 100, maxStates: 30 });
 *   rw.onFrame(frameCount)   // called every frame; captures when due
 *   rw.stepBack()            // one state older; restores it, returns true if it moved
 *   rw.stepForward()         // back toward the present
 *   rw.resume()              // leave scrub mode, drop the abandoned future
 *
 * Scrubbing does not discard anything until the user resumes: stepping back and
 * forward again must land on the same states, or holding the key feels broken.
 */

export function createRewindBuffer({
    capture,
    restore,
    intervalFrames = 100,        // ~2s at 50fps
    maxStates = 30,              // ~60s of history
} = {}) {
    if (typeof capture !== 'function' || typeof restore !== 'function') {
        throw new Error('rewind buffer needs capture() and restore()');
    }
    if (!(intervalFrames > 0)) throw new Error('intervalFrames must be positive');
    if (!(maxStates > 1)) throw new Error('maxStates must be at least 2');

    let states = [];             // oldest first: [{ frame, data }]
    let nextCaptureAt = 0;       // frame count at which the next capture is due
    let cursor = -1;             // -1 = live; otherwise index being viewed
    let enabled = true;
    let dropped = 0;             // states aged out, for diagnostics

    function record(frame) {
        let data;
        try {
            data = capture();
        } catch (e) {
            // A failed capture must never break the frame loop; skip this one and
            // try again at the next interval.
            return false;
        }
        if (!data) return false;
        states.push({ frame, data });
        while (states.length > maxStates) { states.shift(); dropped++; }
        return true;
    }

    return {
        /** Call once per emulated frame with the machine's frame counter. */
        onFrame(frame) {
            if (!enabled || cursor !== -1) return false;      // not while scrubbing
            // A machine reset or snapshot load can move the counter backwards.
            // Re-anchor *before* the due check, or the buffer would go silent until
            // the counter climbed back past the old deadline.
            if (frame < nextCaptureAt - intervalFrames) nextCaptureAt = frame;
            if (frame < nextCaptureAt) return false;
            const did = record(frame);
            nextCaptureAt = frame + intervalFrames;
            return did;
        },

        /** Step one state further back. Returns false when there is no more history. */
        stepBack() {
            if (!states.length) return false;
            if (cursor === -1) {
                // Entering scrub mode: keep the live state so stepping forward
                // again returns to exactly where the user pressed the key.
                const live = capture();
                if (live) states.push({ frame: Infinity, data: live, live: true });
                cursor = states.length - 1;
            }
            if (cursor <= 0) return false;
            cursor--;
            restore(states[cursor].data);
            return true;
        },

        /** Step back toward the present. */
        stepForward() {
            if (cursor === -1 || cursor >= states.length - 1) return false;
            cursor++;
            restore(states[cursor].data);
            return true;
        },

        /**
         * Leave scrub mode and carry on from where the user stopped: the states
         * after that point are a future that no longer happened.
         */
        resume() {
            if (cursor === -1) return false;
            states = states.slice(0, cursor + 1);
            const last = states[states.length - 1];
            if (last) last.live = false;
            cursor = -1;
            nextCaptureAt = 0;         // capture again promptly on the new timeline
            return true;
        },

        /** Drop everything (machine change, media load, user turned it off). */
        clear() {
            states = [];
            cursor = -1;
            nextCaptureAt = 0;
            dropped = 0;
        },

        setEnabled(on) {
            enabled = !!on;
            if (!enabled) this.clear();
        },

        get enabled() { return enabled; },
        get scrubbing() { return cursor !== -1; },
        get count() { return states.length; },
        /** How far back the user currently is, in states (0 = live). */
        get depth() { return cursor === -1 ? 0 : (states.length - 1 - cursor); },
        get stats() {
            return {
                count: states.length, dropped, cursor,
                bytes: states.reduce((n, s) => n + (s.data.byteLength || s.data.length || 0), 0),
            };
        },
    };
}
