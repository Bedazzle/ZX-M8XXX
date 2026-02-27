// Extracted from index.html inline script
// PSG recording + RZX recording + PSG player source download
// Lines ~34166-34421

// ── DOM references ──────────────────────────────────────────────────
const btnPsgStart      = document.getElementById('btnPsgStart');
const btnPsgStop       = document.getElementById('btnPsgStop');
const btnPsgCancel     = document.getElementById('btnPsgCancel');
const chkPsgChangedOnly = document.getElementById('chkPsgChangedOnly');
const psgStatus        = document.getElementById('psgStatus');

const btnRzxRecStart   = document.getElementById('btnRzxRecStart');
const btnRzxRecExport  = document.getElementById('btnRzxRecExport');
const btnRzxRecCancel  = document.getElementById('btnRzxRecCancel');
const rzxRecStatus     = document.getElementById('rzxRecStatus');

const btnPsgPlayer     = document.getElementById('btnPsgPlayer');

// ── Mutable state ───────────────────────────────────────────────────
let psgRecording     = false;
let psgFrameCount    = 0;
let psgWriteCount    = 0;
let psgUpdateInterval = null;

// ── External references (set via initRzxRecording) ──────────────────
let spectrum;
let showMessage;
let getExportBaseName;

// ── Initialisation ──────────────────────────────────────────────────
export function initRzxRecording(deps) {
    spectrum          = deps.spectrum;
    showMessage       = deps.showMessage;
    getExportBaseName = deps.getExportBaseName;

    _initEventListeners();
}

// ── PSG Recording ───────────────────────────────────────────────────

export function startPsgRecording() {
    spectrum.ay.startLogging();
    psgRecording = true;
    psgFrameCount = 0;
    psgWriteCount = 0;
    btnPsgStart.disabled = true;
    btnPsgStop.disabled = false;
    btnPsgCancel.disabled = false;
    psgStatus.textContent = 'Recording: 0 frames';
    showMessage('PSG recording started');

    // Update status periodically by reading AY properties directly
    psgUpdateInterval = setInterval(() => {
        if (psgRecording && spectrum.ay.loggingEnabled) {
            psgFrameCount = spectrum.ay.logFrameNumber;
            psgWriteCount = spectrum.ay.registerLog.length;
            const duration = (psgFrameCount / 50).toFixed(1);
            psgStatus.textContent = `Recording: ${psgFrameCount} frames, ${psgWriteCount} writes (${duration}s)`;
        }
    }, 200);
}

export function stopPsgRecording(cancel) {
    spectrum.ay.stopLogging();
    psgRecording = false;
    btnPsgStart.disabled = false;
    btnPsgStop.disabled = true;
    btnPsgCancel.disabled = true;

    if (psgUpdateInterval) {
        clearInterval(psgUpdateInterval);
        psgUpdateInterval = null;
    }

    if (cancel) {
        spectrum.ay.clearLog();
        psgStatus.textContent = 'Cancelled';
        showMessage('PSG recording cancelled');
        return;
    }

    // Export PSG file
    const changedOnly = chkPsgChangedOnly.checked;
    const psgData = spectrum.ay.exportPSG(changedOnly);

    if (!psgData || psgData.length <= 16) {
        psgStatus.textContent = 'No AY data recorded';
        showMessage('No AY data to export');
        spectrum.ay.clearLog();
        return;
    }

    const frames = psgFrameCount;
    const duration = (frames / 50).toFixed(1);
    const blob = new Blob([psgData], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `music_${frames}f.psg`;
    a.click();
    URL.revokeObjectURL(url);

    psgStatus.textContent = `Exported: ${psgData.length} bytes, ${frames} frames (${duration}s)`;
    showMessage(`Exported PSG: ${psgData.length} bytes`);
    spectrum.ay.clearLog();
}

// ── RZX Recording ───────────────────────────────────────────────────

function _initRzxButtons() {
    btnRzxRecStart.addEventListener('click', () => {
        if (spectrum.rzxStartRecording()) {
            btnRzxRecStart.disabled = true;
            btnRzxRecExport.disabled = false;
            btnRzxRecCancel.disabled = false;
            if (spectrum.running) {
                rzxRecStatus.textContent = 'Recording...';
            } else {
                rzxRecStatus.textContent = 'Recording (paused - press Start to run)';
            }
        } else {
            showMessage('Cannot start RZX recording (playback active?)', 'error');
        }
    });

    btnRzxRecExport.addEventListener('click', () => {
        const result = spectrum.rzxStopRecording();
        btnRzxRecStart.disabled = false;
        btnRzxRecExport.disabled = true;
        btnRzxRecCancel.disabled = true;
        if (result && result.frames > 0) {
            const baseName = getExportBaseName() || 'recording';
            spectrum.rzxDownloadRecording(`${baseName}.rzx`);
            rzxRecStatus.textContent = `Exported: ${result.frames} frames`;
        } else {
            rzxRecStatus.textContent = 'No frames recorded';
        }
    });

    btnRzxRecCancel.addEventListener('click', () => {
        spectrum.rzxCancelRecording();
        btnRzxRecStart.disabled = false;
        btnRzxRecExport.disabled = true;
        btnRzxRecCancel.disabled = true;
        rzxRecStatus.textContent = 'Recording cancelled';
    });

    // Update RZX recording status during recording
    setInterval(() => {
        if (spectrum.isRZXRecording()) {
            const frames = spectrum.getRZXRecordedFrameCount();
            if (spectrum.rzxRecordPending) {
                if (spectrum.running) {
                    rzxRecStatus.textContent = 'Starting...';
                } else {
                    rzxRecStatus.textContent = 'Pending (press Start to begin)';
                }
                btnRzxRecExport.disabled = true;
            } else if (spectrum.running) {
                rzxRecStatus.textContent = `Recording... ${frames} frames`;
                btnRzxRecExport.disabled = frames === 0;
            } else {
                rzxRecStatus.textContent = `Recording (paused) ${frames} frames`;
                btnRzxRecExport.disabled = frames === 0;
            }
            btnRzxRecCancel.disabled = false;
        }
    }, 500);
}

// ── PSG Player Source Download ───────────────────────────────────────

function _initPsgPlayerButton() {
    btnPsgPlayer.addEventListener('click', () => {
        const playerSource = `; PSG Player for ZX Spectrum
; Simple player for PSG files exported from ZX-M8XXX
; Assemble with sjasmplus
;
; Usage:
;   1. Include your PSG data at PSG_DATA label (INCBIN "music.psg")
;   2. Assemble: sjasmplus psg_player.asm
;   3. Load music.sna and run
;   4. Press Space to stop

        DEVICE ZXSPECTRUM128

        ORG #8000

AY_REG  EQU #FFFD       ; AY register select port
AY_DATA EQU #BFFD       ; AY data port

START:
        DI
        LD HL,PSG_DATA+16   ; Skip 16-byte header
        EI

PLAY_LOOP:
        LD A,(HL)
        INC HL

        CP #FD              ; End of music?
        JR Z,MUSIC_END

        CP #FF              ; End of frame?
        JR Z,WAIT_FRAME

        CP #FE              ; Multiple empty frames?
        JR Z,SKIP_FRAMES

        ; Register write: A = register, next byte = value
        LD BC,AY_REG
        OUT (C),A           ; Select register
        LD A,(HL)
        INC HL
        LD BC,AY_DATA
        OUT (C),A           ; Write value
        JR PLAY_LOOP

SKIP_FRAMES:
        ; 0xFE followed by count (frames = count * 4)
        LD A,(HL)
        INC HL
        LD B,A
        SLA B
        SLA B               ; B = count * 4
SKIP_LOOP:
        CALL WAIT_INT
        DJNZ SKIP_LOOP
        JR PLAY_LOOP

WAIT_FRAME:
        CALL WAIT_INT
        JR PLAY_LOOP

WAIT_INT:
        ; Wait for interrupt (50Hz frame sync)
        LD A,#7F
        IN A,(#FE)          ; Check keyboard
        RRA
        JR NC,KEY_PRESSED   ; Space pressed - exit

        HALT                ; Wait for next interrupt
        RET

KEY_PRESSED:
        POP AF              ; Remove return address

MUSIC_END:
        ; Silence AY
        XOR A
        LD BC,AY_REG
        LD E,13             ; 14 registers (0-13)
SILENCE:
        OUT (C),A
        LD D,A
        LD BC,AY_DATA
        OUT (C),D
        LD BC,AY_REG
        INC A
        DEC E
        JP P,SILENCE

        RET

; Include your PSG data here
PSG_DATA:
        INCBIN "music.psg"

        SAVESNA "music.sna", START
`;
        const blob = new Blob([playerSource], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'psg_player.asm';
        a.click();
        URL.revokeObjectURL(url);
        showMessage('Downloaded psg_player.asm');
    });
}

// ── Wire up all event listeners ─────────────────────────────────────

function _initEventListeners() {
    // PSG recording buttons
    btnPsgStart.addEventListener('click', startPsgRecording);
    btnPsgStop.addEventListener('click', () => stopPsgRecording(false));
    btnPsgCancel.addEventListener('click', () => stopPsgRecording(true));

    // RZX recording buttons
    _initRzxButtons();

    // PSG player download
    _initPsgPlayerButton();
}
