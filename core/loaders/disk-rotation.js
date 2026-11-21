// =============================================================================
// The disk, going round (pure)
// =============================================================================
//
// A floppy is not a passive array of sectors: it turns at 300 rpm whether the
// host is ready or not, and almost everything a WD17xx controller does is timed
// by that rotation. Three consequences, all of which software can see:
//
//   - **The index pulse.** One per revolution, from a hole in the disk. It is a
//     bit in the Type I status register, and it is what ENDS a Write Track: the
//     chip writes from one pulse to the next and then stops, however much or
//     little the host fed it. A controller with no rotation has nothing to end
//     a format with, which is why `FORMAT` used to hang every TR-DOS SAVE.
//   - **The byte rate.** MFM at 250 kbit/s is one byte every 32us. DRQ comes on
//     that schedule and does not wait: service it late and the byte is gone
//     (LOST DATA). The schedule is ABSOLUTE -- the nth byte of a transfer is due
//     at `start + n * byteTime`, not `byteTime` after the host took the (n-1)th.
//     Restarting the clock on each service is what makes an emulated format
//     drift slower than the medium it is supposedly writing.
//   - **Which sector is under the head.** Read Address returns the next ID to
//     come round, so two reads a revolution apart give different answers. But it
//     is NOT a snapshot: the command waits for that ID, so reading one costs the
//     time to reach it and two commands in a row report consecutive sectors.
//     Commands here complete instantly, so the head is kept monotone in absolute
//     slots (`absoluteSlot`) rather than simply asked where it is. Modelled as
//     "what is under the head now" it gave the same sector twice — less realistic
//     than the round robin it replaced, and `opus-test` said so.
//
// The one number that makes this cheap: **a revolution is exactly ten frames.**
// 300 rpm is 5 rev/s and a PAL frame is 50 Hz, so one revolution is 10 frames of
// whatever the machine's T-states-per-frame happens to be -- 698880 on a 48K,
// 709080 on a 128K. No per-machine constant, no floating-point clock rate, and
// the figure stays right when the machine changes under us.
//
// Everything here is pure arithmetic on a T-state count. The count has to be
// monotonic across frames; `Spectrum` builds one from `totalFrames` and the
// in-frame `cpu.tStates`.

import { TRACK_BYTES_MFM } from './mfm-track.js';

/** 300 rpm against 50 Hz frames: a revolution is exactly ten frames. */
export const FRAMES_PER_REVOLUTION = 10;

/** One revolution in milliseconds, at 300 rpm. */
export const REVOLUTION_MS = 200;

/**
 * How long the index pulse is held. Real drives give 1-8 ms; the WD datasheets
 * assume at least 1 ms, and the shortest realistic figure is the safest choice
 * here because it is the one a polling ROM is least likely to see twice. At
 * 1.5 ms a pulse lasts ~5200 T-states, which a status-polling loop cannot miss.
 */
export const INDEX_PULSE_MS = 1.5;

/** One revolution in T-states, given the machine's frame length. */
export function revolutionTStates(tstatesPerFrame) {
    return FRAMES_PER_REVOLUTION * tstatesPerFrame;
}

/** The index pulse width in T-states, given a revolution. */
export function indexPulseTStates(rev) {
    return Math.max(1, Math.round(rev * INDEX_PULSE_MS / REVOLUTION_MS));
}

/**
 * How long one byte takes to pass the head: a revolution shared out over the
 * track. This is where the 112 T-states in `core/constants.js` comes from --
 * 698880 / 6250 = 111.8 -- except that here it follows from the geometry
 * instead of being written down for one machine.
 */
export function byteTStates(rev, trackBytes = TRACK_BYTES_MFM) {
    return rev / trackBytes;
}

/**
 * Where the disk is in its revolution, as a fraction in [0, 1). The index pulse
 * is at 0 by definition: there is no per-drive phase here, which keeps a test
 * able to say exactly where the head is.
 */
export function angle(now, rev) {
    if (!(rev > 0)) return 0;
    const a = (now % rev) / rev;
    return a < 0 ? a + 1 : a;
}

/** Is the index pulse asserted right now? */
export function indexActive(now, rev) {
    if (!(rev > 0)) return false;
    let p = now % rev;
    if (p < 0) p += rev;
    return p < indexPulseTStates(rev);
}

/** Which byte of the track is under the head, 0 .. trackBytes-1. */
export function headByte(now, rev, trackBytes = TRACK_BYTES_MFM) {
    return Math.min(trackBytes - 1, Math.floor(angle(now, rev) * trackBytes));
}

/**
 * Which of `count` equally spaced sectors is under the head. What Read Address
 * answers: the ID field the head will reach next.
 */
export function sectorUnderHead(now, rev, count) {
    if (!(count > 0)) return 0;
    return Math.min(count - 1, Math.floor(angle(now, rev) * count));
}

/**
 * Which sector slot the head is over counted from time 0 — so slot `count` is
 * the first of the second revolution, not the first of the first again.
 *
 * `sectorUnderHead` answers modulo a revolution, which cannot say whether two
 * answers are the same sector or the same sector a revolution apart. Read
 * Address needs the difference: the head only ever goes forward, and a command
 * that waits for the next ID field must not be given one the disk has already
 * passed.
 */
export function absoluteSlot(now, rev, count) {
    if (!(rev > 0) || !(count > 0)) return 0;
    return Math.floor(now / rev * count);
}

/** The time of the first index pulse strictly after `now`. */
export function nextIndexAt(now, rev) {
    if (!(rev > 0)) return now;
    return Math.floor(now / rev) * rev + rev;
}

/**
 * How many index pulses fall in (from, to]. A Write Track that began at `from`
 * is over as soon as this reaches 1, whatever the host has managed to feed.
 */
export function indexPulsesBetween(from, to, rev) {
    if (!(rev > 0) || to <= from) return 0;
    return Math.floor(to / rev) - Math.floor(from / rev);
}

/**
 * When the nth byte of a transfer that began at `start` is due. Absolute, so a
 * host that services a byte late does not push the rest of the track back: it
 * loses the bytes it was late for, which is what a real chip does and what
 * makes a whole track come to exactly one revolution.
 *
 * Rounded UP, never down: a byte is not available before its time, and that
 * choice is what makes this the exact inverse of `bytesSince` rather than one
 * byte out for every schedule whose byte time is not a whole number of
 * T-states — which is all of them.
 */
export function byteDueAt(start, n, rev, trackBytes = TRACK_BYTES_MFM) {
    return start + Math.ceil(n * byteTStates(rev, trackBytes));
}

/**
 * How many bytes should have gone past the head since `start`. A Write Track is
 * full when this reaches `trackBytes`.
 */
export function bytesSince(start, now, rev, trackBytes = TRACK_BYTES_MFM) {
    if (!(rev > 0) || now <= start) return 0;
    return Math.floor((now - start) / byteTStates(rev, trackBytes));
}

/**
 * A rotation clock for a controller: `now()` in T-states and the length of a
 * revolution, both read live so a machine change is picked up. Returns null
 * when there is nothing to read, which is how a controller built without a
 * machine (every unit test that constructs one directly) keeps its old
 * untimed behaviour instead of pretending to a rotation it cannot see.
 */
export function createRotationClock(nowFn, revFn) {
    if (typeof nowFn !== 'function') return null;
    const rev = typeof revFn === 'function' ? revFn : () => revFn;
    return {
        now: () => nowFn(),
        revolution: () => rev(),
        angle: () => angle(nowFn(), rev()),
        indexActive: () => indexActive(nowFn(), rev()),
        headByte: (trackBytes) => headByte(nowFn(), rev(), trackBytes),
        sectorUnderHead: (count) => sectorUnderHead(nowFn(), rev(), count),
        absoluteSlot: (count) => absoluteSlot(nowFn(), rev(), count),
        sinceIndex: (from) => indexPulsesBetween(from, nowFn(), rev()),
        /**
         * When the next index pulse comes round. A Write Track does not begin
         * where the command was issued — the chip waits for the index and writes
         * from there — so this is where a format's revolution actually starts.
         */
        nextIndex: () => nextIndexAt(nowFn(), rev()),
        /** How long one byte takes to pass the head, on this machine's clock. */
        byteTime: (trackBytes) => byteTStates(rev(), trackBytes),
        bytesSince: (from, trackBytes) => bytesSince(from, nowFn(), rev(), trackBytes),
        /**
         * How long since `from`, in revolutions. NOT the same question as
         * `sinceIndex`, and the difference is a bug waiting to happen: that
         * counts index pulses CROSSED, so an interval beginning at 0.95 of a
         * revolution reaches one pulse after a twentieth of a turn. A deadline
         * wants elapsed time — a whole revolution of it — which is this.
         */
        revolutionsSince: (from) => (nowFn() - from) / rev(),
    };
}
