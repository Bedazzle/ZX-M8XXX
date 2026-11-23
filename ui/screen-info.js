// screen-info.js — Screen click inspector popup (extracted from index.html)
import { hex8, hex16 } from '../core/utils.js';
import { SCREEN_BITMAP, SCREEN_ATTR } from '../core/constants.js';

export function initScreenInfo({ getSpectrum }) {
    const canvas = document.getElementById('screen');
    const screenInfoPopup = document.getElementById('screenInfoPopup');

    canvas.addEventListener('click', (e) => {
        canvas.focus();
        const spectrum = getSpectrum();

        // Only show popup when paused
        if (spectrum.isRunning()) return;

        // Get click position relative to canvas
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / (spectrum.canvasScaleX || 1) / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = Math.floor((e.clientX - rect.left) * scaleX);
        const canvasY = Math.floor((e.clientY - rect.top) * scaleY);

        // Get ULA dimensions
        const dims = spectrum.ula.getDimensions();
        const borderLeft = dims.borderLeft;
        const borderTop = dims.borderTop;
        const screenWidth = dims.screenWidth;
        const screenHeight = dims.screenHeight;

        // Calculate position relative to screen area
        const screenX = canvasX - borderLeft;
        const screenY = canvasY - borderTop;

        // Check if in screen area
        const inScreen = screenX >= 0 && screenX < screenWidth &&
                         screenY >= 0 && screenY < screenHeight;

        let infoHtml = '';

        if (inScreen) {
            const col = Math.floor(screenX / 8);
            const row = Math.floor(screenY / 8);
            const pixelX = screenX;
            const pixelY = screenY;

            // Calculate base Y for this character row (top of char cell)
            const charBaseY = row * 8;

            // Read 8 bitmap bytes (one per scanline in char cell)
            const bitmapBytes = [];
            const bitmapAddrs = [];
            for (let line = 0; line < 8; line++) {
                const y = charBaseY + line;
                const addr = SCREEN_BITMAP +
                    ((y & 0xC0) << 5) +
                    ((y & 0x07) << 8) +
                    ((y & 0x38) << 2) +
                    col;
                bitmapAddrs.push(addr);
                bitmapBytes.push(spectrum.memory.read(addr));
            }

            // Calculate attribute address
            const attrAddr = SCREEN_ATTR + row * 32 + col;

            // Read 8 attribute bytes for 8 consecutive rows (multicolor check)
            const attrBytes = [];
            const attrAddrs = [];
            for (let r = 0; r < 8; r++) {
                const checkRow = row + r;
                if (checkRow < 24) {
                    const addr = SCREEN_ATTR + checkRow * 32 + col;
                    attrAddrs.push(addr);
                    attrBytes.push(spectrum.memory.read(addr));
                }
            }

            // Check if all attributes are the same
            const allSame = attrBytes.every(b => b === attrBytes[0]);

            // Format attribute byte as f_b_ppp_iii
            function formatAttr(b) {
                const flash = (b >> 7) & 1;
                const bright = (b >> 6) & 1;
                const paper = (b >> 3) & 7;
                const ink = b & 7;
                return `${flash}_${bright}_${paper.toString(2).padStart(3,'0')}_${ink.toString(2).padStart(3,'0')}`;
            }

            infoHtml = `
                <div><span class="info-label">X:</span> <span class="info-value">${hex8(pixelX)}</span> <span class="info-dec">(${pixelX})</span> &nbsp; <span class="info-label">Y:</span> <span class="info-value">${hex8(pixelY)}</span> <span class="info-dec">(${pixelY})</span></div>
                <div><span class="info-label">Col:</span> <span class="info-value">${hex8(col)}</span> <span class="info-dec">(${col})</span> &nbsp; <span class="info-label">Row:</span> <span class="info-value">${hex8(row)}</span> <span class="info-dec">(${row})</span></div>
                <div><span class="info-label">Bitmap:</span> <span class="info-value">${hex16(bitmapAddrs[0])}</span></div>
            `;

            // Format bitmap bytes as binary with hex/dec and address
            for (let i = 0; i < bitmapBytes.length; i++) {
                const b = bitmapBytes[i];
                const bin = b.toString(2).padStart(8, '0');
                infoHtml += `<div><span class="info-value">${bin}</span> <span class="info-dec">(${hex8(b)}/${b})</span> <span class="info-label">${hex16(bitmapAddrs[i])}</span></div>`;
            }

            infoHtml += `<div><span class="info-label">Attr:</span> <span class="info-value">${hex16(attrAddr)}</span></div>`;

            if (allSame) {
                // Single attribute
                infoHtml += `<div><span class="info-value">${hex8(attrBytes[0])}</span> <span class="info-dec">${formatAttr(attrBytes[0])}</span></div>`;
            } else {
                // Multiple different attributes - show all 8
                for (let i = 0; i < attrBytes.length; i++) {
                    infoHtml += `<div><span class="info-value">${hex8(attrBytes[i])}</span> <span class="info-dec">${formatAttr(attrBytes[i])}</span></div>`;
                }
            }
        } else {
            // In border area - show position and border color at this scanline
            const borderColor = spectrum.ula.getBorderColorAtLine(canvasY);
            const colorNames = ['black', 'blue', 'red', 'magenta', 'green', 'cyan', 'yellow', 'white'];
            infoHtml = `
                <div><span class="info-label">X:</span> <span class="info-value">${hex8(canvasX)}</span> <span class="info-dec">(${canvasX})</span> &nbsp; <span class="info-label">Y:</span> <span class="info-value">${hex8(canvasY)}</span> <span class="info-dec">(${canvasY})</span></div>
                <div><span class="info-label">Border:</span> <span class="info-value">${borderColor}</span> <span class="info-dec">(${colorNames[borderColor]})</span></div>
            `;
        }

        screenInfoPopup.innerHTML = infoHtml;

        // Position popup off-screen first to measure, then position correctly
        screenInfoPopup.style.left = '-9999px';
        screenInfoPopup.style.top = '-9999px';
        screenInfoPopup.classList.remove('hidden');

        // Get popup dimensions after content is set
        const popupRect = screenInfoPopup.getBoundingClientRect();
        const popupWidth = popupRect.width;
        const popupHeight = popupRect.height;

        // Position popup near click, keep within container to avoid scrollbars
        const container = canvas.parentElement;
        const containerRect = container.getBoundingClientRect();

        let popupX = e.clientX - containerRect.left + 15;
        let popupY = e.clientY - containerRect.top + 15;

        // Adjust to keep popup within visible area
        const maxX = container.clientWidth - popupWidth - 5;
        const maxY = container.clientHeight - popupHeight - 5;

        if (popupX > maxX) popupX = Math.max(5, e.clientX - containerRect.left - popupWidth - 15);
        if (popupY > maxY) popupY = Math.max(5, e.clientY - containerRect.top - popupHeight - 15);

        screenInfoPopup.style.left = popupX + 'px';
        screenInfoPopup.style.top = popupY + 'px';
    });

    // Hide popup when mouse leaves canvas (with small delay)
    let hideTimeout = null;

    canvas.addEventListener('mouseleave', () => {
        hideTimeout = setTimeout(() => {
            screenInfoPopup.classList.add('hidden');
        }, 200);
    });

    canvas.addEventListener('mouseenter', () => {
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
    });

    // Hide popup when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (e.target !== canvas && !screenInfoPopup.contains(e.target)) {
            screenInfoPopup.classList.add('hidden');
        }
    });
}
