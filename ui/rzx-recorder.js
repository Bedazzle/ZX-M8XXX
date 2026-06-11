// rzx-recorder.js — RZX record start/export/cancel buttons, recording status interval (extracted from index.html)

export function initRzxRecorder({ getSpectrum, getExportBaseName, showMessage }) {
    const btnRzxRecStart = document.getElementById('btnRzxRecStart');
    const btnRzxRecExport = document.getElementById('btnRzxRecExport');
    const btnRzxRecCancel = document.getElementById('btnRzxRecCancel');
    const rzxRecStatus = document.getElementById('rzxRecStatus');

    // Status poll only runs while a recording is active
    let statusInterval = null;

    function stopStatusInterval() {
        if (statusInterval) {
            clearInterval(statusInterval);
            statusInterval = null;
        }
    }

    function startStatusInterval() {
        if (statusInterval) return;
        statusInterval = setInterval(() => {
            const spectrum = getSpectrum();
            if (!spectrum.isRZXRecording()) {
                stopStatusInterval();
                return;
            }
            const frames = spectrum.getRZXRecordedFrameCount();
            if (spectrum.rzxRecordPending) {
                // Waiting for frame boundary
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
        }, 500);
    }

    btnRzxRecStart.addEventListener('click', () => {
        const spectrum = getSpectrum();
        if (spectrum.rzxStartRecording()) {
            btnRzxRecStart.disabled = true;
            btnRzxRecExport.disabled = false;
            btnRzxRecCancel.disabled = false;
            if (spectrum.running) {
                rzxRecStatus.textContent = 'Recording...';
            } else {
                rzxRecStatus.textContent = 'Recording (paused - press Start to run)';
            }
            startStatusInterval();
        } else {
            showMessage('Cannot start RZX recording (playback active?)', 'error');
        }
    });

    btnRzxRecExport.addEventListener('click', () => {
        const spectrum = getSpectrum();
        const result = spectrum.rzxStopRecording();
        stopStatusInterval();
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
        const spectrum = getSpectrum();
        spectrum.rzxCancelRecording();
        stopStatusInterval();
        btnRzxRecStart.disabled = false;
        btnRzxRecExport.disabled = true;
        btnRzxRecCancel.disabled = true;
        rzxRecStatus.textContent = 'Recording cancelled';
    });
}
