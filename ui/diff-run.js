// diff-run.js — the Code Path tab's "Diff run" row.
//
// The slots above it record a *set* of executed addresses and subtract one from
// another: what did this run reach that the other didn't. A set has no order, so
// it cannot say where the two runs parted company — and that is usually the
// question. This runs the same frames twice with one thing changed and reports
// the first instruction at which they stop agreeing, then what that decided:
// which bytes of memory ended up different, and which registers.
//
// The two runs must start from the same state or the answer is meaningless, so
// the panel takes a snapshot itself rather than trusting the machine to be where
// it was. core/divergence.js does the comparing; this drives the runs.

import { hex16, hex8 } from '../core/utils.js';
import { fmtAddr, fmtAddrSigil, fmtByteSigil, parseAddr, parseByte, onNumberBaseChange } from '../core/addr-format.js';
import { compareRuns, pcOf } from '../core/divergence.js';

export function initDiffRun({ getSpectrum, disassembleAt, getLabel, goToAddress,
                              showMessage, downloadFile }) {
    const drFrames = document.getElementById('drFrames');
    const drChange = document.getElementById('drChange');
    const btnDiffRun = document.getElementById('btnDiffRun');
    const btnDiffExport = document.getElementById('btnDiffExport');
    const drStatus = document.getElementById('drStatus');
    const drResults = document.getElementById('drResults');
    if (!btnDiffRun || !drResults) return {};

    let lastReport = null;

    // "8000=1, C000=FF" — hex address, hex value. The one variable to change.
    function parseChanges(text) {
        const out = [];
        for (const part of String(text || '').split(',')) {
            const t = part.trim();
            if (!t) continue;
            const m = /^(\S+)\s*=\s*(\S+)$/.exec(t);
            const addr = m && parseAddr(m[1]);
            const value = m && parseByte(m[2]);
            if (!m || addr === null || value === null) {
                return { error: `"${t}" is not addr=value` };
            }
            out.push({ addr: addr & 0xFFFF, value: value & 0xFF });
        }
        return { changes: out };
    }

    // One run: trace it, then keep what it left behind. runFrameHeadless because
    // a differential is worthless if the two runs don't step identically —
    // rendering and audio have no business deciding where they diverge.
    function recordRun(spectrum, frames, limit) {
        spectrum.startExecTrace({ limit });
        for (let i = 0; i < frames; i++) spectrum.runFrameHeadless();
        const trace = spectrum.stopExecTrace();
        const memory = new Uint8Array(0x10000);
        for (let a = 0; a < 0x10000; a++) memory[a] = spectrum.memory.read(a);
        const c = spectrum.cpu;
        const registers = {
            pc: c.pc, sp: c.sp, a: c.a, f: c.f,
            bc: (c.b << 8) | c.c, de: (c.d << 8) | c.e, hl: (c.h << 8) | c.l,
            ix: c.ix, iy: c.iy, i: c.i, im: c.im, iff1: c.iff1, iff2: c.iff2,
        };
        return { trace, memory, registers };
    }

    async function doRun() {
        const spectrum = getSpectrum();
        if (!spectrum || !spectrum.romLoaded) {
            showMessage('Load a ROM first', 'error');
            return;
        }
        const parsed = parseChanges(drChange.value);
        if (parsed.error) {
            drStatus.textContent = parsed.error;
            showMessage(parsed.error, 'error');
            return;
        }
        const frames = Math.max(1, Math.min(500, parseInt(drFrames.value, 10) || 25));
        // A frame is about 70,000 T-states, so a few thousand instructions.
        // Give the trace room for all of them rather than cutting it short —
        // a run that stopped early proves nothing about what came after.
        const limit = Math.min(1 << 22, Math.max(1 << 16, frames * 40000));

        const wasRunning = spectrum.running;
        btnDiffRun.disabled = true;
        drStatus.textContent = 'running…';
        drResults.innerHTML = '';
        await new Promise(r => setTimeout(r, 0));   // let the status paint

        try {
            if (wasRunning) spectrum.stop();
            // Snapshot first: the two runs have to start from the same place, or
            // the first divergence is only wherever they already differed.
            const state = spectrum.saveSnapshot('szx');
            const restore = async () => {
                await spectrum.loadFile(new File([new Uint8Array(state)], 'diffrun.szx'));
            };

            // Restore before the *first* run too, not just the second. Loading a
            // snapshot resets the frame's T-state counter into the interrupt
            // window, so a run from the live machine and a run from the restore
            // do not start at the same point in the frame — with nothing changed
            // at all they came out one instruction apart over two frames, which
            // would put a phantom divergence at the tail of every comparison.
            await restore();
            const a = recordRun(spectrum, frames, limit);

            await restore();
            for (const ch of parsed.changes) spectrum.memory.write(ch.addr, ch.value);
            const b = recordRun(spectrum, frames, limit);

            // Leave the machine where the second run ended, which is what the
            // reader is looking at in the other panels
            lastReport = {
                cmp: compareRuns(a, b),
                frames,
                changes: parsed.changes,
                counts: { a: a.trace.count, b: b.trace.count },
            };
            render(lastReport);
        } catch (e) {
            drStatus.textContent = 'failed';
            showMessage('Diff run failed: ' + e.message, 'error');
        } finally {
            btnDiffRun.disabled = false;
            if (wasRunning) spectrum.start();
        }
    }

    const pcLink = (pc) => {
        const label = getLabel ? getLabel(pc) : null;
        return `<span class="dr-pc" data-addr="${pc}">${fmtAddr(pc)}${label ? ' ' + label : ''}</span>`;
    };

    function instrLine(pc) {
        let text = '';
        try {
            const d = disassembleAt(pc);
            text = d && d.text ? d.text : (d && d.mnemonic ? d.mnemonic : '');
        } catch (e) { /* a PC in unmapped memory is still worth showing */ }
        return `${pcLink(pc)} <span class="dr-instr">${text}</span>`;
    }

    function render(report) {
        const { cmp, frames, changes, counts } = report;
        const changeText = changes.length
            ? changes.map(c => `${fmtAddrSigil(c.addr)}=${fmtByteSigil(c.value)}`).join(' ')
            : 'nothing';

        if (!cmp.diverged) {
            drStatus.textContent = 'no divergence';
            drResults.innerHTML =
                `<div class="search-info">The two runs executed the same ${counts.a} instructions` +
                ` over ${frames} frames with ${changeText} changed.` +
                (changes.length
                    ? ' Either the change does not reach this code, or it does not reach it yet — try more frames.'
                    : ' Which is what it should say with nothing changed: the run is deterministic.') +
                (cmp.truncated ? ' <b>The trace hit its limit, so this says nothing past that point.</b>' : '') +
                '</div>';
            return;
        }

        const at = cmp.at;
        drStatus.textContent = `diverged at instruction ${at.index}`;
        let html = '';

        html += `<div class="dr-head">Changed ${changeText} · ${frames} frames · ` +
                `${counts.a} vs ${counts.b} instructions</div>`;
        html += `<div class="dr-head">Parted company at instruction ${at.index} — ${at.reason}</div>`;

        if (cmp.context) {
            html += '<div class="dr-block"><div class="dr-sub">both ran</div>';
            for (const pc of cmp.context.common) html += `<div class="dr-line">${instrLine(pc)}</div>`;
            html += '</div>';
            html += '<div class="dr-block"><div class="dr-sub">then A went</div>';
            for (const pc of cmp.context.a) html += `<div class="dr-line dr-a">${instrLine(pc)}</div>`;
            html += '</div>';
            html += '<div class="dr-block"><div class="dr-sub">and B went</div>';
            for (const pc of cmp.context.b) html += `<div class="dr-line dr-b">${instrLine(pc)}</div>`;
            html += '</div>';
        }

        if (cmp.memory && cmp.memory.count) {
            const m = cmp.memory;
            html += `<div class="dr-block"><div class="dr-sub">memory: ${m.count} bytes differ` +
                    (m.truncated ? ', more runs than listed' : '') + '</div>';
            for (const run of m.runs.slice(0, 20)) {
                html += `<div class="dr-line">${pcLink(run.addr)}` +
                        `<span class="dr-instr">${run.length} byte${run.length === 1 ? '' : 's'}</span></div>`;
            }
            html += '</div>';
        }

        if (cmp.registers.length) {
            html += '<div class="dr-block"><div class="dr-sub">registers</div><div class="dr-line">' +
                cmp.registers.map(r => `${r.name} ${r.a}/${r.b}`).join('  ') + '</div></div>';
        }

        if (cmp.truncated) {
            html += '<div class="search-info">One trace hit its limit — nothing here speaks for what came after.</div>';
        }
        drResults.innerHTML = html;
    }

    function doExport() {
        if (!lastReport) { showMessage('Run a diff first', 'warning'); return; }
        const { cmp, frames, changes, counts } = lastReport;
        const lines = [
            '; ZX-M8XXX differential run',
            `; changed: ${changes.length ? changes.map(c => `$${hex16(c.addr)}=$${hex8(c.value)}`).join(' ') : 'nothing'}`,
            `; frames: ${frames}   instructions: ${counts.a} vs ${counts.b}`,
            '',
        ];
        if (!cmp.diverged) {
            lines.push('No divergence.');
        } else {
            lines.push(`Parted company at instruction ${cmp.at.index} — ${cmp.at.reason}`);
            lines.push(`  A: $${hex16(cmp.at.a ? cmp.at.a.pc : 0)}   B: $${hex16(cmp.at.b ? cmp.at.b.pc : 0)}`);
            lines.push('');
            if (cmp.context) {
                lines.push('both ran:');
                for (const pc of cmp.context.common) lines.push('  $' + hex16(pc));
                lines.push('then A went:');
                for (const pc of cmp.context.a) lines.push('  $' + hex16(pc));
                lines.push('and B went:');
                for (const pc of cmp.context.b) lines.push('  $' + hex16(pc));
                lines.push('');
            }
            if (cmp.memory && cmp.memory.count) {
                lines.push(`memory: ${cmp.memory.count} bytes differ`);
                for (const r of cmp.memory.runs) lines.push(`  $${hex16(r.addr)}  ${r.length}`);
                lines.push('');
            }
            if (cmp.registers.length) {
                lines.push('registers: ' + cmp.registers.map(r => `${r.name} ${r.a}/${r.b}`).join('  '));
            }
            if (cmp.truncated) lines.push('; a trace hit its limit — nothing above speaks for what came after');
        }
        downloadFile('diffrun.txt', lines.join('\n'));
    }

    btnDiffRun.addEventListener('click', doRun);
    btnDiffExport.addEventListener('click', doExport);
    drResults.addEventListener('click', (e) => {
        const el = e.target.closest('.dr-pc');
        if (el) goToAddress(parseInt(el.dataset.addr, 10));
    });

    // Hex or decimal: the report names the instruction the two runs disagreed on.
    onNumberBaseChange(() => { if (lastReport) render(lastReport); });

    return { doRun, getReport: () => lastReport };
}
