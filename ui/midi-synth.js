// midi-synth.js — a small built-in MIDI synth on Web Audio, so the 128's MIDI
// out (core/midi.js) is heard without any MIDI device. Not a General MIDI
// sound set: one voice per note, the waveform by program family, channel 10
// as noise drums. Note On / Note Off, Program Change, All Notes Off, pitch
// bend and the volume controller are understood; the rest is ignored.

const FAMILY_WAVE = ['triangle', 'sine', 'square', 'sawtooth', 'sawtooth', 'sawtooth', 'triangle', 'sawtooth',
                     'square', 'triangle', 'sine', 'square', 'sawtooth', 'triangle', 'square', 'triangle'];

export class MidiSynth {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.voices = new Map();          // `${ch}:${note}` -> { osc, gain }
        this.program = new Array(16).fill(0);
        this.chanVol = new Array(16).fill(100);
        this.bend = new Array(16).fill(0);  // semitones
        this.volume = 0.25;
        this.noise = null;
    }

    _ensure() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    resume() { this._ensure(); if (this.ctx.state === 'suspended') this.ctx.resume(); }

    setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

    _freq(ch, note) { return 440 * Math.pow(2, (note - 69 + this.bend[ch]) / 12); }

    _noteOn(ch, note, vel) {
        this._noteOff(ch, note);
        const ctx = this.ctx, t = ctx.currentTime;
        const amp = (vel / 127) * (this.chanVol[ch] / 127) * 0.3;
        const gain = ctx.createGain();
        gain.connect(this.master);
        if (ch === 9) {                    // drums: a short filtered noise burst
            const src = ctx.createBufferSource();
            src.buffer = this.noise;
            const f = ctx.createBiquadFilter();
            f.type = 'bandpass';
            f.frequency.value = 80 * Math.pow(2, (note - 35) / 8);
            f.Q.value = 1.5;
            src.connect(f); f.connect(gain);
            gain.gain.setValueAtTime(amp * 2, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            src.start(t); src.stop(t + 0.2);
            return;
        }
        const osc = ctx.createOscillator();
        osc.type = FAMILY_WAVE[(this.program[ch] >> 3) & 15];
        osc.frequency.value = this._freq(ch, note);
        osc.connect(gain);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(amp, t + 0.005);
        gain.gain.setTargetAtTime(amp * 0.6, t + 0.005, 0.3);
        osc.start(t);
        this.voices.set(ch + ':' + note, { osc, gain, ch, note });
    }

    _noteOff(ch, note) {
        const key = ch + ':' + note, v = this.voices.get(key);
        if (!v) return;
        this.voices.delete(key);
        const t = this.ctx.currentTime;
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setValueAtTime(v.gain.gain.value, t);
        v.gain.gain.linearRampToValueAtTime(0, t + 0.06);
        v.osc.stop(t + 0.07);
    }

    allOff(ch = -1) {
        for (const v of [...this.voices.values()]) if (ch < 0 || v.ch === ch) this._noteOff(v.ch, v.note);
    }

    /** One complete MIDI message (array of bytes) */
    send(msg) {
        if (!msg || !msg.length) return;
        this._ensure();
        const st = msg[0], ch = st & 0x0F, type = st & 0xF0;
        if (type === 0x90 && msg[2] > 0) this._noteOn(ch, msg[1], msg[2]);
        else if (type === 0x80 || (type === 0x90 && msg[2] === 0)) this._noteOff(ch, msg[1]);
        else if (type === 0xC0) this.program[ch] = msg[1] & 0x7F;
        else if (type === 0xB0) {
            if (msg[1] === 7) this.chanVol[ch] = msg[2];
            else if (msg[1] === 120 || msg[1] === 123) this.allOff(ch);
        } else if (type === 0xE0) {
            this.bend[ch] = (((msg[2] << 7) | msg[1]) - 8192) / 8192 * 2;
            for (const v of this.voices.values()) {
                if (v.ch === ch) v.osc.frequency.setValueAtTime(this._freq(ch, v.note), this.ctx.currentTime);
            }
        } else if (st === 0xFF) {
            this.allOff();
        }
    }
}
