// Disk activity indicator — LED + track/sector status display
// Extracted from index.html

export function initDiskActivity({ getSpectrum }) {
    const diskActivityEl = document.getElementById('diskActivity');
    const diskLedEl = document.getElementById('diskLed');
    const diskStatusEl = document.getElementById('diskStatus');
    let diskActivityTimeout = null;

    function setup() {
        const spectrum = getSpectrum();

        const activityHandler = (type, track, sector, side, driveNum) => {
            // Show disk activity indicator
            diskActivityEl.style.display = 'inline-block';

            // Update LED color based on operation
            if (type === 'read') {
                diskLedEl.style.color = '#0f0';  // Green for read
                diskLedEl.title = 'Reading from disk';
            } else if (type === 'write') {
                diskLedEl.style.color = '#f80';  // Orange for write
                diskLedEl.title = 'Writing to disk';
            }

            // Show drive letter + track/sector info (padded to fixed width)
            const driveLetter = String.fromCharCode(65 + (driveNum || 0));
            const sideStr = side ? 'B' : 'A';
            const trackStr = String(track).padStart(2, '0');
            const sectorStr = String(sector).padStart(2, '0');
            diskStatusEl.textContent = `${driveLetter}:T${trackStr}:S${sectorStr}:${sideStr}`;

            // Clear timeout and set new one to show idle state
            if (diskActivityTimeout) clearTimeout(diskActivityTimeout);
            diskActivityTimeout = setTimeout(() => {
                diskLedEl.style.color = '';  // Reset color
                diskLedEl.title = 'Disk idle';
                diskStatusEl.textContent = 'idle';
            }, 200);

            // Check disk triggers on read operations
            if (type === 'read' && spectrum.running) {
                let trigger = spectrum.checkDiskSectorTrigger(track, sector);
                if (trigger) {
                    spectrum.diskTriggerHit = true;
                    spectrum.triggerHit = true;
                    spectrum.lastTrigger = { trigger, track, sector, type: 'disk_sector' };
                }
                trigger = spectrum.checkDiskReadTrigger();
                if (trigger) {
                    spectrum.diskTriggerHit = true;
                    spectrum.triggerHit = true;
                    spectrum.lastTrigger = { trigger, type: 'disk_read' };
                }
            }
        };

        if (spectrum.betaDisk) {
            spectrum.betaDisk.onDiskActivity = activityHandler;
        }
        if (spectrum.fdc) {
            spectrum.fdc.onDiskActivity = activityHandler;
        }
        if (spectrum.plusD) {
            spectrum.plusD.onDiskActivity = activityHandler;
        }
    }

    setup(); // Run immediately
    return { setup }; // Expose for re-wiring after machine change
}
