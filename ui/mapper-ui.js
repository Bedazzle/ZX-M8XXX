// mapper-ui.js — Game Mapper UI (extracted from index.html)
import { GameMapper } from '../tools/game-mapper.js';

export function initMapperUI({ gameMapper, getScreenCanvas, getScreenDimensions }) {

    // DOM lookups
    const mapperOverviewCanvas = document.getElementById('mapperOverviewCanvas');
    const mapperOverviewCtx = mapperOverviewCanvas.getContext('2d');
    const mapperOverviewPlaceholder = document.getElementById('mapperOverviewPlaceholder');
    const mapperThumbStrip = document.getElementById('mapperThumbStrip');
    const mapperSettingsPanel = document.getElementById('mapperSettingsPanel');
    const mapperOverviewContainer = document.getElementById('mapperOverviewContainer');
    const mapperStampDialog = document.getElementById('mapperStampDialog');
    const mapperStampCanvas = document.getElementById('mapperStampCanvas');
    const mapperRegionX = document.getElementById('mapperRegionX');
    const mapperRegionY = document.getElementById('mapperRegionY');
    const mapperRegionW = document.getElementById('mapperRegionW');
    const mapperRegionH = document.getElementById('mapperRegionH');
    const mapperGapH = document.getElementById('mapperGapH');
    const mapperGapV = document.getElementById('mapperGapV');
    const mapperFloorGap = document.getElementById('mapperFloorGap');
    const mapperFollow = document.getElementById('mapperFollow');
    const mapperGame = document.getElementById('mapperGame');
    const mapperLevel = document.getElementById('mapperLevel');
    const mapperAuthor = document.getElementById('mapperAuthor');
    const mapperHighlightColor = document.getElementById('mapperHighlightColor');
    const mapperExportLayout = document.getElementById('mapperExportLayout');
    const mapperOverviewZoom = document.getElementById('mapperOverviewZoom');
    const mapperRoomLabel = document.getElementById('mapperRoomLabel');
    const mapperFloorLabel = document.getElementById('mapperFloorLabel');
    const btnMapperBlend = document.getElementById('btnMapperBlend');
    const btnMapperStamp = document.getElementById('btnMapperStamp');
    const btnMapperDeleteShot = document.getElementById('btnMapperDeleteShot');
    const btnMapperRemoveRoom = document.getElementById('btnMapperRemoveRoom');
    const btnMapperMoveRoom = document.getElementById('btnMapperMoveRoom');
    const mapperRoomMark = document.getElementById('mapperRoomMark');
    const mapperStats = document.getElementById('mapperStats');
    const selStampSourceA = document.getElementById('mapperStampSourceA');
    const selStampSourceB = document.getElementById('mapperStampSourceB');
    const mapperStampSourceAWrap = document.getElementById('mapperStampSourceAWrap');
    const mapperStampSourceBWrap = document.getElementById('mapperStampSourceBWrap');
    const mapperStampInfo = document.getElementById('mapperStampInfo');
    const mapperStampCanvasA = document.getElementById('mapperStampCanvasA');
    const mapperStampCanvasB = document.getElementById('mapperStampCanvasB');
    const btnMapperCapture = document.getElementById('btnMapperCapture');
    const btnMapperTextSlide = document.getElementById('btnMapperTextSlide');
    const mapperTextSlideDialog = document.getElementById('mapperTextSlideDialog');
    const mapperTsFont = document.getElementById('mapperTsFont');
    const mapperTsFontSize = document.getElementById('mapperTsFontSize');
    const mapperTsColor = document.getElementById('mapperTsColor');
    const mapperTsPaper = document.getElementById('mapperTsPaper');
    const mapperTsText = document.getElementById('mapperTsText');
    const mapperTsPreviewCanvas = document.getElementById('mapperTsPreviewCanvas');
    let mapperOverviewLayout = null;
    let _movingRoom = false;

    // Debounce guard for mapper button/key actions to prevent double-fire
    let _mapperActionTime = 0;
    function mapperAction(action) {
        const now = Date.now();
        if (now - _mapperActionTime < 150) return;
        _mapperActionTime = now;
        action();
    }

    function mapperCaptureScreen() {
        const room = gameMapper.getCurrentRoom();
        if (room && gameMapper.isTextSlide(room)) return;
        const screenCanvas = getScreenCanvas();
        const dims = getScreenDimensions();
        const reg = gameMapper.captureRegion;
        const px = reg.x * 8;
        const py = reg.y * 8;
        const pw = reg.w * 8;
        const ph = reg.h * 8;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = pw;
        tempCanvas.height = ph;
        const tempCtx = tempCanvas.getContext('2d');

        const sx = dims.borderLeft + px;
        const sy = dims.borderTop + py;
        tempCtx.drawImage(screenCanvas, sx, sy, pw, ph, 0, 0, pw, ph);

        const dataUrl = tempCanvas.toDataURL('image/png');
        gameMapper.addScreenshot(dataUrl);
        mapperUpdateUI();
    }

    function mapperUpdateUI() {
        if (_movingRoom) {
            _movingRoom = false;
            btnMapperMoveRoom.classList.remove('active');
            btnMapperMoveRoom.textContent = 'Move';
        }
        mapperRoomLabel.textContent =
            '(' + gameMapper.currentX + ', ' + gameMapper.currentY + ')';
        mapperFloorLabel.textContent = gameMapper.currentFloor;

        mapperRegionX.value = gameMapper.captureRegion.x;
        mapperRegionY.value = gameMapper.captureRegion.y;
        mapperRegionW.value = gameMapper.captureRegion.w;
        mapperRegionH.value = gameMapper.captureRegion.h;
        const regionLocked = gameMapper.getRoomCount() > 0;
        mapperRegionX.disabled = regionLocked;
        mapperRegionY.disabled = regionLocked;
        mapperRegionW.disabled = regionLocked;
        mapperRegionH.disabled = regionLocked;
        mapperGapH.value = gameMapper.gapH;
        mapperGapV.value = gameMapper.gapV;
        mapperFloorGap.value = gameMapper.floorGap;
        mapperFollow.checked = gameMapper.overviewFollow;
        mapperGame.value = gameMapper.metadata.game;
        mapperLevel.value = gameMapper.metadata.level;
        mapperAuthor.value = gameMapper.metadata.author;
        mapperHighlightColor.value = gameMapper.highlightColor;
        mapperExportLayout.value = gameMapper.exportLayout;
        mapperOverviewZoom.value = gameMapper.overviewZoom;

        const room = gameMapper.getCurrentRoom();
        const isTs = gameMapper.isTextSlide(room);
        const hasShots = room && room.screenshots.length > 0;
        btnMapperBlend.style.display = !isTs && hasShots && room.screenshots.length > 1 ? '' : 'none';
        btnMapperStamp.style.display = !isTs && room && room.blended ? '' : 'none';
        btnMapperDeleteShot.style.display = hasShots ? '' : 'none';
        const hasRoom = !!room;
        btnMapperRemoveRoom.style.display = hasRoom ? '' : 'none';
        btnMapperMoveRoom.style.display = hasRoom ? '' : 'none';
        btnMapperTextSlide.textContent = isTs ? 'Edit text' : 'Text';
        btnMapperCapture.style.display = isTs ? 'none' : '';
        mapperRoomMark.value = (room && room.mark) || '';

        mapperRenderThumbnails(room);
        mapperRenderOverview();

        const floors = gameMapper.getFloors();
        const floorCount = floors.length;
        const n = gameMapper.getRoomCount();
        const fn = gameMapper.getRoomCount(gameMapper.currentFloor);
        mapperStats.textContent =
            n + ' room' + (n !== 1 ? 's' : '') + (floorCount > 1 ? ' / ' + floorCount + ' floors' : '') +
            (floorCount > 1 ? ' (floor ' + gameMapper.currentFloor + ': ' + fn + ')' : '');
    }

    function mapperRenderThumbnails(room) {
        mapperThumbStrip.innerHTML = '';
        if (!room || room.screenshots.length === 0) return;

        if (gameMapper.isTextSlide(room)) {
            const span = document.createElement('span');
            span.className = 'mapper-thumb-label';
            span.textContent = 'Text slide';
            span.style.cursor = 'pointer';
            span.style.color = 'var(--cyan)';
            span.style.fontSize = '11px';
            span.style.padding = '2px 6px';
            span.addEventListener('click', mapperOpenTextSlideDialog);
            mapperThumbStrip.appendChild(span);
            return;
        }

        room.screenshots.forEach((dataUrl, i) => {
            const img = document.createElement('img');
            img.className = 'mapper-thumb' + (room.selectedIndex === i ? ' selected' : '');
            img.src = dataUrl;
            img.title = 'Screenshot ' + (i + 1);
            img.addEventListener('click', () => {
                room.selectedIndex = i;
                mapperRenderThumbnails(room);
                mapperRenderOverview();
            });
            mapperThumbStrip.appendChild(img);
        });

        if (room.blended) {
            const img = document.createElement('img');
            img.className = 'mapper-thumb blended' + (room.selectedIndex === -1 ? ' selected' : '');
            img.src = room.blended;
            img.title = 'Blended';
            img.addEventListener('click', () => {
                room.selectedIndex = -1;
                mapperRenderThumbnails(room);
                mapperRenderOverview();
            });
            mapperThumbStrip.appendChild(img);
        }
    }

    function mapperDrawRoomMark(ctx, x, y, w, h, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        ctx.moveTo(x + w, y);
        ctx.lineTo(x, y + h);
        ctx.stroke();
        ctx.restore();
    }

    function mapperRenderOverview() {
        mapperOverviewLayout = null;
        const floor = gameMapper.currentFloor;
        const bounds = gameMapper.getBounds(floor);
        if (!bounds) {
            mapperOverviewCanvas.width = 1;
            mapperOverviewCanvas.height = 1;
            mapperOverviewPlaceholder.style.display = '';
            return;
        }
        mapperOverviewPlaceholder.style.display = 'none';

        const reg = gameMapper.captureRegion;
        const roomW = reg.w * 8;
        const roomH = reg.h * 8;
        const gapH = gameMapper.gapH;
        const gapV = gameMapper.gapV;
        const gridW = bounds.maxX - bounds.minX + 1;
        const gridH = bounds.maxY - bounds.minY + 1;
        const totalW = gridW * roomW + (gridW - 1) * gapH;
        const totalH = gridH * roomH + (gridH - 1) * gapV;

        const zoom = gameMapper.overviewZoom;
        let scale;
        if (zoom === 'x1') {
            scale = 1;
        } else if (zoom === 'x2') {
            scale = 2;
        } else {
            const maxW = mapperOverviewContainer.clientWidth - 2;
            const maxH = mapperOverviewContainer.clientHeight - 2;
            scale = Math.min(maxW / totalW, maxH / totalH, 2);
            if (scale <= 0) scale = 1;
        }
        mapperOverviewContainer.style.overflow = zoom === 'fit' ? 'hidden' : 'auto';

        const canvasW = Math.ceil(totalW * scale);
        const canvasH = Math.ceil(totalH * scale);
        mapperOverviewCanvas.width = canvasW;
        mapperOverviewCanvas.height = canvasH;
        mapperOverviewCtx.fillStyle = '#000';
        mapperOverviewCtx.fillRect(0, 0, canvasW, canvasH);
        mapperOverviewCtx.imageSmoothingEnabled = false;

        mapperOverviewLayout = { bounds, scale, roomW, roomH, gapH, gapV, floor };

        // Grid lines
        if (gapH === 0 && gapV === 0) {
            mapperOverviewCtx.strokeStyle = 'rgba(255,255,255,0.1)';
            mapperOverviewCtx.lineWidth = 1;
            for (let gx = 0; gx <= gridW; gx++) {
                const x = Math.floor(gx * roomW * scale) + 0.5;
                mapperOverviewCtx.beginPath();
                mapperOverviewCtx.moveTo(x, 0);
                mapperOverviewCtx.lineTo(x, canvasH);
                mapperOverviewCtx.stroke();
            }
            for (let gy = 0; gy <= gridH; gy++) {
                const y = Math.floor(gy * roomH * scale) + 0.5;
                mapperOverviewCtx.beginPath();
                mapperOverviewCtx.moveTo(0, y);
                mapperOverviewCtx.lineTo(canvasW, y);
                mapperOverviewCtx.stroke();
            }
        }

        // Draw rooms on current floor
        const drawPromises = [];
        const rooms = gameMapper.getRoomsOnFloor(floor);
        for (const { x: rx, y: ry, room } of rooms) {
            const dataUrl = gameMapper.getDisplayImage(room);
            if (!dataUrl) continue;
            const dx = (rx - bounds.minX) * (roomW + gapH) * scale;
            const dy = (ry - bounds.minY) * (roomH + gapV) * scale;
            const dw = roomW * scale;
            const dh = roomH * scale;
            drawPromises.push(
                gameMapper.loadCachedImage(dataUrl).then(img => {
                    mapperOverviewCtx.drawImage(img, dx, dy, dw, dh);
                })
            );
        }

        Promise.all(drawPromises).then(() => {
            // Draw room marks (colored crosses)
            for (const { x: rx, y: ry, room } of rooms) {
                if (room.mark) {
                    const mx = (rx - bounds.minX) * (roomW + gapH) * scale;
                    const my = (ry - bounds.minY) * (roomH + gapV) * scale;
                    mapperDrawRoomMark(mapperOverviewCtx, mx, my, roomW * scale, roomH * scale, room.mark);
                }
            }

            const cx = (gameMapper.currentX - bounds.minX) * (roomW + gapH) * scale;
            const cy = (gameMapper.currentY - bounds.minY) * (roomH + gapV) * scale;
            const cw = roomW * scale;
            const ch = roomH * scale;
            mapperOverviewCtx.strokeStyle = gameMapper.highlightColor;
            mapperOverviewCtx.lineWidth = 2;
            mapperOverviewCtx.strokeRect(cx + 1, cy + 1, cw - 2, ch - 2);

            // Follow mode: auto-scroll to current room
            if (gameMapper.overviewFollow && zoom !== 'fit') {
                const centerX = cx + cw / 2;
                const centerY = cy + ch / 2;
                mapperOverviewContainer.scrollLeft = centerX - mapperOverviewContainer.clientWidth / 2;
                mapperOverviewContainer.scrollTop = centerY - mapperOverviewContainer.clientHeight / 2;
            }
        });
    }

    function mapperOverviewClick(event) {
        if (!mapperOverviewLayout || gameMapper.getRoomCount() === 0) return;
        const rect = mapperOverviewCanvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        const { bounds, scale, roomW, roomH, gapH, gapV, floor } = mapperOverviewLayout;
        const cellW = (roomW + gapH) * scale;
        const cellH = (roomH + gapV) * scale;
        const gx = Math.floor(mx / cellW) + bounds.minX;
        const gy = Math.floor(my / cellH) + bounds.minY;
        if (_movingRoom) {
            if (gameMapper.moveRoom(gx, gy, floor)) {
                _movingRoom = false;
                btnMapperMoveRoom.classList.remove('active');
                btnMapperMoveRoom.textContent = 'Move';
                mapperUpdateUI();
            }
            return;
        }
        const key = gx + ',' + gy + ',' + floor;
        if (gameMapper.rooms.has(key)) {
            gameMapper.selectRoom(gx, gy, floor);
            mapperUpdateUI();
        }
    }

    function mapperBlendScreenshots() {
        const room = gameMapper.getCurrentRoom();
        if (!room || room.screenshots.length < 2) return;

        const reg = gameMapper.captureRegion;
        const pw = reg.w * 8;
        const ph = reg.h * 8;
        const count = room.screenshots.length;

        Promise.all(room.screenshots.map(url => gameMapper.loadCachedImage(url))).then(images => {
            const blendCanvas = document.createElement('canvas');
            blendCanvas.width = pw;
            blendCanvas.height = ph;
            const blendCtx = blendCanvas.getContext('2d');

            const dataSets = images.map(img => {
                const tc = document.createElement('canvas');
                tc.width = pw;
                tc.height = ph;
                const tctx = tc.getContext('2d');
                tctx.drawImage(img, 0, 0, pw, ph);
                return tctx.getImageData(0, 0, pw, ph).data;
            });

            const result = blendCtx.createImageData(pw, ph);
            const rd = result.data;
            const len = pw * ph * 4;

            // Per-pixel mode: pick the most frequent RGB value across screenshots.
            // This extracts the static background and discards moving sprites.
            const freq = {};
            for (let i = 0; i < len; i += 4) {
                for (const k in freq) delete freq[k];

                let bestKey = 0, bestCount = 0;
                for (let j = 0; j < count; j++) {
                    const key = (dataSets[j][i] << 16) | (dataSets[j][i + 1] << 8) | dataSets[j][i + 2];
                    const c = (freq[key] || 0) + 1;
                    freq[key] = c;
                    if (c > bestCount) { bestCount = c; bestKey = key; }
                }
                rd[i]     = (bestKey >> 16) & 0xFF;
                rd[i + 1] = (bestKey >> 8) & 0xFF;
                rd[i + 2] = bestKey & 0xFF;
                rd[i + 3] = 255;
            }
            blendCtx.putImageData(result, 0, 0);
            const baseUrl = blendCanvas.toDataURL('image/png');
            room._baseBlend = baseUrl;
            room.blended = baseUrl;
            room.selectedIndex = -1;
            gameMapper._imageCache.delete(room.blended);
            if (room.stamps && room.stamps.length > 0) {
                mapperApplyStamps(room).then(() => mapperUpdateUI());
            } else {
                mapperUpdateUI();
            }
        });
    }

    // --- Stamp tool ---
    let mapperStampSourceA = 0;      // index into screenshots, or -1 for blended
    let mapperStampSourceB = 1;      // index into screenshots, or -1 for blended
    let mapperStampActiveSource = 'A';  // 'A' or 'B'
    let mapperStampDragging = false;
    let mapperStampStartX = 0, mapperStampStartY = 0;
    let mapperStampEndX = 0, mapperStampEndY = 0;
    let mapperStampScale = 1;
    let mapperStampSavedScroll = null;

    function mapperPopulateStampDropdowns(room) {
        selStampSourceA.innerHTML = '';
        selStampSourceB.innerHTML = '';
        for (let i = 0; i < room.screenshots.length; i++) {
            const optA = document.createElement('option');
            optA.value = i;
            optA.textContent = 'Screenshot ' + (i + 1);
            selStampSourceA.appendChild(optA);
            const optB = document.createElement('option');
            optB.value = i;
            optB.textContent = 'Screenshot ' + (i + 1);
            selStampSourceB.appendChild(optB);
        }
        if (room.blended) {
            const optA = document.createElement('option');
            optA.value = -1;
            optA.textContent = 'Blended';
            selStampSourceA.appendChild(optA);
            const optB = document.createElement('option');
            optB.value = -1;
            optB.textContent = 'Blended';
            selStampSourceB.appendChild(optB);
        }
    }

    function mapperUpdateStampSourceHighlight() {
        mapperStampSourceAWrap.classList.toggle('selected', mapperStampActiveSource === 'A');
        mapperStampSourceBWrap.classList.toggle('selected', mapperStampActiveSource === 'B');
        mapperStampInfo.textContent = 'Drawing from ' + mapperStampActiveSource;
    }

    function mapperOpenStampDialog() {
        const room = gameMapper.getCurrentRoom();
        if (!room || !room.blended) return;
        const n = room.screenshots.length;
        // Default source A/B
        if (n >= 2) {
            mapperStampSourceA = 0;
            mapperStampSourceB = 1;
        } else if (n === 1) {
            mapperStampSourceA = 0;
            mapperStampSourceB = -1;  // blended
        } else {
            mapperStampSourceA = -1;
            mapperStampSourceB = -1;
        }
        mapperStampActiveSource = 'A';
        mapperPopulateStampDropdowns(room);
        selStampSourceA.value = mapperStampSourceA;
        selStampSourceB.value = mapperStampSourceB;
        mapperUpdateStampSourceHighlight();
        mapperStampDialog.classList.remove('hidden');
        mapperStampSavedScroll = { left: mapperOverviewContainer.scrollLeft, top: mapperOverviewContainer.scrollTop };
        mapperOverviewContainer.scrollLeft = 0;
        mapperOverviewContainer.scrollTop = 0;
        mapperStampDragging = false;
        mapperStampRender();
        mapperStampRenderSources();
    }

    function mapperCloseStampDialog() {
        mapperStampDialog.classList.add('hidden');
        mapperStampDragging = false;
        const savedScroll = mapperStampSavedScroll;
        mapperStampSavedScroll = null;
        mapperUpdateUI();
        if (savedScroll) {
            mapperOverviewContainer.scrollLeft = savedScroll.left;
            mapperOverviewContainer.scrollTop = savedScroll.top;
        }
    }

    function mapperGetStampSourceUrl(room, sourceIndex) {
        if (sourceIndex === -1) return room._baseBlend || room.blended;
        if (sourceIndex >= 0 && sourceIndex < room.screenshots.length) return room.screenshots[sourceIndex];
        return null;
    }

    function mapperStampRender() {
        const room = gameMapper.getCurrentRoom();
        if (!room || !room.blended) return;
        const ctx = mapperStampCanvas.getContext('2d');
        const reg = gameMapper.captureRegion;
        const pw = reg.w * 8;
        const ph = reg.h * 8;
        mapperStampScale = 2;
        mapperStampCanvas.width = pw;
        mapperStampCanvas.height = ph;
        mapperStampCanvas.style.width = (pw * mapperStampScale) + 'px';
        mapperStampCanvas.style.height = (ph * mapperStampScale) + 'px';
        ctx.imageSmoothingEnabled = false;

        const baseUrl = room._baseBlend || room.blended;
        gameMapper.loadCachedImage(baseUrl).then(blendImg => {
            ctx.drawImage(blendImg, 0, 0, pw, ph);

            // Apply existing stamps onto the canvas for display
            const validStamps = room.stamps.filter(s => mapperGetStampSourceUrl(room, s.sourceIndex));
            const stampPromises = validStamps.map(s =>
                gameMapper.loadCachedImage(mapperGetStampSourceUrl(room, s.sourceIndex))
            );
            Promise.all(stampPromises).then(stampImages => {
                validStamps.forEach((s, i) => {
                    ctx.drawImage(stampImages[i], s.x, s.y, s.w, s.h, s.x, s.y, s.w, s.h);
                });

                // Draw existing stamp outlines (dashed cyan)
                ctx.save();
                ctx.strokeStyle = '#4ecdc4';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                validStamps.forEach(s => {
                    ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
                });
                ctx.restore();

                // Draw current drag selection (dashed yellow)
                if (mapperStampDragging) {
                    const x = Math.min(mapperStampStartX, mapperStampEndX);
                    const y = Math.min(mapperStampStartY, mapperStampEndY);
                    const w = Math.abs(mapperStampEndX - mapperStampStartX);
                    const h = Math.abs(mapperStampEndY - mapperStampStartY);
                    if (w > 0 && h > 0) {
                        ctx.save();
                        ctx.strokeStyle = '#ffd93d';
                        ctx.lineWidth = 1;
                        ctx.setLineDash([3, 3]);
                        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
                        ctx.restore();
                    }
                }
            });
        });
    }

    function mapperStampRenderSources() {
        const room = gameMapper.getCurrentRoom();
        if (!room) return;
        const reg = gameMapper.captureRegion;
        const pw = reg.w * 8;
        const ph = reg.h * 8;
        const sources = [
            { idx: mapperStampSourceA, canvas: mapperStampCanvasA },
            { idx: mapperStampSourceB, canvas: mapperStampCanvasB }
        ];
        sources.forEach(src => {
            const canvas = src.canvas;
            const ctx = canvas.getContext('2d');
            canvas.width = pw;
            canvas.height = ph;
            canvas.style.width = (pw * mapperStampScale) + 'px';
            canvas.style.height = (ph * mapperStampScale) + 'px';
            ctx.imageSmoothingEnabled = false;
            const url = mapperGetStampSourceUrl(room, src.idx);
            if (!url) { ctx.clearRect(0, 0, pw, ph); return; }
            gameMapper.loadCachedImage(url).then(img => {
                ctx.clearRect(0, 0, pw, ph);
                ctx.drawImage(img, 0, 0, pw, ph);
                // Draw drag selection rectangle on source canvas too
                if (mapperStampDragging) {
                    const x = Math.min(mapperStampStartX, mapperStampEndX);
                    const y = Math.min(mapperStampStartY, mapperStampEndY);
                    const w = Math.abs(mapperStampEndX - mapperStampStartX);
                    const h = Math.abs(mapperStampEndY - mapperStampStartY);
                    if (w > 0 && h > 0) {
                        ctx.save();
                        ctx.strokeStyle = '#ffd93d';
                        ctx.lineWidth = 1;
                        ctx.setLineDash([3, 3]);
                        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
                        ctx.restore();
                    }
                }
            });
        });
    }

    function mapperApplyStamps(room) {
        if (!room || !room._baseBlend || !room.stamps || room.stamps.length === 0) {
            return Promise.resolve();
        }
        const reg = gameMapper.captureRegion;
        const pw = reg.w * 8;
        const ph = reg.h * 8;

        const validStamps = room.stamps.filter(s => mapperGetStampSourceUrl(room, s.sourceIndex));
        if (validStamps.length === 0) return Promise.resolve();

        const imagesToLoad = [room._baseBlend, ...validStamps.map(s => mapperGetStampSourceUrl(room, s.sourceIndex))];
        return Promise.all(imagesToLoad.map(url => gameMapper.loadCachedImage(url))).then(images => {
            const baseImg = images[0];
            const tc = document.createElement('canvas');
            tc.width = pw;
            tc.height = ph;
            const tctx = tc.getContext('2d');
            tctx.imageSmoothingEnabled = false;
            tctx.drawImage(baseImg, 0, 0, pw, ph);

            // Apply each stamp: copy rectangle from source screenshot or blended
            for (let i = 0; i < validStamps.length; i++) {
                const s = validStamps[i];
                const srcImg = images[1 + i];
                tctx.drawImage(srcImg, s.x, s.y, s.w, s.h, s.x, s.y, s.w, s.h);
            }

            gameMapper._imageCache.delete(room.blended);
            room.blended = tc.toDataURL('image/png');
        });
    }

    function mapperClearStamps() {
        const room = gameMapper.getCurrentRoom();
        if (!room) return;
        room.stamps = [];
        if (room.screenshots.length >= 2) {
            mapperBlendScreenshots();
        } else if (room._baseBlend) {
            gameMapper._imageCache.delete(room.blended);
            room.blended = room._baseBlend;
        }
        mapperCloseStampDialog();
    }

    function mapperStampCanvasCoords(event) {
        const rect = mapperStampCanvas.getBoundingClientRect();
        const scaleX = mapperStampCanvas.width / rect.width;
        const scaleY = mapperStampCanvas.height / rect.height;
        return {
            x: Math.max(0, Math.min(mapperStampCanvas.width, Math.round((event.clientX - rect.left) * scaleX))),
            y: Math.max(0, Math.min(mapperStampCanvas.height, Math.round((event.clientY - rect.top) * scaleY)))
        };
    }

    function mapperSave() {
        gameMapper.metadata.game = mapperGame.value;
        gameMapper.metadata.level = mapperLevel.value;
        gameMapper.metadata.author = mapperAuthor.value;
        gameMapper.gapH = Math.max(0, parseInt(mapperGapH.value) || 0);
        gameMapper.gapV = Math.max(0, parseInt(mapperGapV.value) || 0);
        gameMapper.floorGap = Math.max(0, parseInt(mapperFloorGap.value) || 0);
        gameMapper.exportLayout = mapperExportLayout.value;
        if (!gameMapper.metadata.created) {
            gameMapper.metadata.created = new Date().toISOString();
        }

        const json = gameMapper.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const name = (gameMapper.metadata.game || 'map').replace(/[^a-zA-Z0-9_-]/g, '_');
        a.download = name + '_map.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function mapperLoad(file) {
        const reader = new FileReader();
        reader.onerror = () => console.error('Failed to read mapper file: ' + file.name);
        reader.onload = () => {
            try {
                gameMapper.importJSON(reader.result);
                mapperUpdateUI();
            } catch (e) {
                console.error('Failed to load mapper file:', e);
            }
        };
        reader.readAsText(file);
    }

    // Render one floor to a canvas, returns { canvas, width, height }
    function mapperRenderFloorToCanvas(floor) {
        const reg = gameMapper.captureRegion;
        const roomW = reg.w * 8;
        const roomH = reg.h * 8;
        const gapH = gameMapper.gapH;
        const gapV = gameMapper.gapV;
        const bounds = gameMapper.getBounds(floor);
        if (!bounds) return null;

        const gridW = bounds.maxX - bounds.minX + 1;
        const gridH = bounds.maxY - bounds.minY + 1;
        const totalW = gridW * roomW + (gridW - 1) * gapH;
        const totalH = gridH * roomH + (gridH - 1) * gapV;

        const c = document.createElement('canvas');
        c.width = totalW;
        c.height = totalH;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, totalW, totalH);
        ctx.imageSmoothingEnabled = false;

        const rooms = gameMapper.getRoomsOnFloor(floor);
        const drawPromises = [];
        for (const { x: rx, y: ry, room } of rooms) {
            const dataUrl = gameMapper.getDisplayImage(room);
            if (!dataUrl) continue;
            const dx = (rx - bounds.minX) * (roomW + gapH);
            const dy = (ry - bounds.minY) * (roomH + gapV);
            drawPromises.push(
                gameMapper.loadCachedImage(dataUrl).then(img => {
                    ctx.drawImage(img, dx, dy, roomW, roomH);
                })
            );
        }
        return Promise.all(drawPromises).then(() => {
            // Draw room marks (colored crosses)
            for (const { x: rx, y: ry, room } of rooms) {
                if (room.mark) {
                    const mx = (rx - bounds.minX) * (roomW + gapH);
                    const my = (ry - bounds.minY) * (roomH + gapV);
                    mapperDrawRoomMark(ctx, mx, my, roomW, roomH, room.mark);
                }
            }
            return { canvas: c, width: totalW, height: totalH };
        });
    }

    function mapperExportPng() {
        if (gameMapper.getRoomCount() === 0) return;

        // Render only non-empty floors
        const floors = gameMapper.getFloors().filter(f => {
            const b = gameMapper.getBounds(f);
            return b != null;
        });
        if (floors.length === 0) return;

        const layout = gameMapper.exportLayout;
        const baseName = (gameMapper.metadata.game || 'map').replace(/[^a-zA-Z0-9_-]/g, '_');
        const fGap = gameMapper.floorGap;

        if (floors.length <= 1 || layout === 'separate') {
            floors.forEach(floor => {
                mapperRenderFloorToCanvas(floor).then(result => {
                    if (!result) return;
                    const a = document.createElement('a');
                    a.href = result.canvas.toDataURL('image/png');
                    a.download = floors.length > 1
                        ? baseName + '_floor' + floor + '.png'
                        : baseName + '_map.png';
                    a.click();
                });
            });
            return;
        }

        // Parse layout: "Nx" = N columns, "xN" = N rows
        let cols, rows;
        if (layout.startsWith('x')) {
            rows = parseInt(layout.slice(1));
            cols = Math.ceil(floors.length / rows);
        } else {
            cols = parseInt(layout);
            rows = Math.ceil(floors.length / cols);
        }

        Promise.all(floors.map(f => mapperRenderFloorToCanvas(f))).then(results => {
            results = results.filter(r => r);
            if (results.length === 0) return;

            const maxCellW = Math.max(...results.map(r => r.width));
            const maxCellH = Math.max(...results.map(r => r.height));
            const totalW = cols * maxCellW + (cols - 1) * fGap;
            const totalH = rows * maxCellH + (rows - 1) * fGap;

            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = totalW;
            exportCanvas.height = totalH;
            const exportCtx = exportCanvas.getContext('2d');
            exportCtx.fillStyle = '#000';
            exportCtx.fillRect(0, 0, totalW, totalH);
            exportCtx.imageSmoothingEnabled = false;

            results.forEach((r, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                exportCtx.drawImage(r.canvas, col * (maxCellW + fGap), row * (maxCellH + fGap));
            });

            const a = document.createElement('a');
            a.href = exportCanvas.toDataURL('image/png');
            a.download = baseName + '_map.png';
            a.click();
        });
    }

    function mapperClear() {
        if (gameMapper.getRoomCount() === 0) return;
        if (!confirm('Clear all mapped rooms?')) return;
        gameMapper.clear();
        mapperUpdateUI();
    }

    // ========== Text Slide Dialog ==========

    function mapperRenderTextSlidePreview() {
        const reg = gameMapper.captureRegion;
        const pw = reg.w * 8;
        const ph = reg.h * 8;
        const canvas = mapperTsPreviewCanvas;
        canvas.width = pw;
        canvas.height = ph;
        const scale = Math.min(256 / pw, 256 / ph, 2);
        canvas.style.width = Math.round(pw * scale) + 'px';
        canvas.style.height = Math.round(ph * scale) + 'px';

        const opts = mapperReadTextSlideForm();
        GameMapper.renderTextToCanvas(canvas, mapperTsText.value, opts.font, opts.fontSize, opts.color, opts.paper);
    }

    function mapperOpenTextSlideDialog() {
        const room = gameMapper.getCurrentRoom();
        const ts = room && room.textSlide;
        const defaults = gameMapper.textSlideDefaults;

        mapperTsFont.value = ts ? ts.font : defaults.font;
        mapperTsFontSize.value = ts ? ts.fontSize : defaults.fontSize;
        mapperTsColor.value = ts ? ts.color : defaults.color;
        mapperTsPaper.value = ts ? ts.paper : defaults.paper;
        mapperTsText.value = ts ? ts.text : '';

        mapperTextSlideDialog.classList.remove('hidden');
        mapperRenderTextSlidePreview();
        mapperTsText.focus();
    }

    function mapperCloseTextSlideDialog() {
        mapperTextSlideDialog.classList.add('hidden');
        mapperUpdateUI();
    }

    function mapperReadTextSlideForm() {
        return {
            font: mapperTsFont.value || gameMapper.textSlideDefaults.font,
            fontSize: parseInt(mapperTsFontSize.value) || gameMapper.textSlideDefaults.fontSize,
            color: mapperTsColor.value,
            paper: mapperTsPaper.value
        };
    }

    function mapperApplyTextSlide() {
        const text = mapperTsText.value;
        if (!text.trim()) {
            // Empty text = remove text slide
            const room = gameMapper.getCurrentRoom();
            if (room && room.textSlide) {
                gameMapper.deleteCurrentScreenshot();
            }
            mapperCloseTextSlideDialog();
            return;
        }
        gameMapper.setTextSlide(text, mapperReadTextSlideForm());
        mapperCloseTextSlideDialog();
    }

    function mapperSetTextSlideDefaults() {
        Object.assign(gameMapper.textSlideDefaults, mapperReadTextSlideForm());
    }

    // ========== Event wiring ==========

    btnMapperCapture.addEventListener('click', function() { this.blur(); mapperAction(mapperCaptureScreen); });
    document.getElementById('btnMapperLeft').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.move(-1, 0); mapperUpdateUI(); }); });
    document.getElementById('btnMapperRight').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.move(1, 0); mapperUpdateUI(); }); });
    document.getElementById('btnMapperUp').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.move(0, -1); mapperUpdateUI(); }); });
    document.getElementById('btnMapperDown').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.move(0, 1); mapperUpdateUI(); }); });
    document.getElementById('btnMapperFloorUp').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.moveFloor(1); mapperUpdateUI(); }); });
    document.getElementById('btnMapperFloorDown').addEventListener('click', function() { this.blur(); mapperAction(() => { gameMapper.moveFloor(-1); mapperUpdateUI(); }); });

    document.getElementById('btnMapperSettings').addEventListener('click', () => {
        mapperSettingsPanel.classList.toggle('hidden');
        setTimeout(mapperRenderOverview, 0);
    });

    mapperRegionX.addEventListener('change', function() {
        gameMapper.captureRegion.x = Math.max(0, Math.min(31, parseInt(this.value) || 0));
        this.value = gameMapper.captureRegion.x;
    });
    mapperRegionY.addEventListener('change', function() {
        gameMapper.captureRegion.y = Math.max(0, Math.min(23, parseInt(this.value) || 0));
        this.value = gameMapper.captureRegion.y;
    });
    mapperRegionW.addEventListener('change', function() {
        gameMapper.captureRegion.w = Math.max(1, Math.min(32, parseInt(this.value) || 32));
        this.value = gameMapper.captureRegion.w;
    });
    mapperRegionH.addEventListener('change', function() {
        gameMapper.captureRegion.h = Math.max(1, Math.min(24, parseInt(this.value) || 24));
        this.value = gameMapper.captureRegion.h;
    });
    mapperGapH.addEventListener('change', function() {
        gameMapper.gapH = Math.max(0, Math.min(32, parseInt(this.value) || 0));
        this.value = gameMapper.gapH;
        mapperRenderOverview();
    });
    mapperGapV.addEventListener('change', function() {
        gameMapper.gapV = Math.max(0, Math.min(32, parseInt(this.value) || 0));
        this.value = gameMapper.gapV;
        mapperRenderOverview();
    });
    mapperFloorGap.addEventListener('change', function() {
        gameMapper.floorGap = Math.max(0, Math.min(64, parseInt(this.value) || 0));
        this.value = gameMapper.floorGap;
    });
    mapperFollow.addEventListener('change', function() {
        gameMapper.overviewFollow = this.checked;
        if (this.checked) mapperRenderOverview();
    });

    mapperHighlightColor.addEventListener('change', function() {
        gameMapper.highlightColor = this.value;
        mapperRenderOverview();
    });
    mapperExportLayout.addEventListener('change', function() {
        gameMapper.exportLayout = this.value;
    });
    mapperOverviewZoom.addEventListener('change', function() {
        gameMapper.overviewZoom = this.value;
        mapperRenderOverview();
    });

    mapperGame.addEventListener('blur', function() { gameMapper.metadata.game = this.value; });
    mapperLevel.addEventListener('blur', function() { gameMapper.metadata.level = this.value; });
    mapperAuthor.addEventListener('blur', function() { gameMapper.metadata.author = this.value; });

    document.getElementById('btnMapperSave').addEventListener('click', mapperSave);
    document.getElementById('btnMapperLoad').addEventListener('click', () => document.getElementById('mapperFileInput').click());
    document.getElementById('mapperFileInput').addEventListener('change', function() {
        if (this.files.length > 0) { mapperLoad(this.files[0]); this.value = ''; }
    });
    document.getElementById('btnMapperExportPng').addEventListener('click', mapperExportPng);
    document.getElementById('btnMapperClear').addEventListener('click', mapperClear);
    btnMapperBlend.addEventListener('click', mapperBlendScreenshots);
    btnMapperStamp.addEventListener('click', mapperOpenStampDialog);
    document.getElementById('btnMapperStampClose').addEventListener('click', mapperCloseStampDialog);
    document.getElementById('btnMapperStampClear').addEventListener('click', mapperClearStamps);
    btnMapperDeleteShot.addEventListener('click', () => {
        gameMapper.deleteCurrentScreenshot();
        mapperUpdateUI();
    });
    btnMapperRemoveRoom.addEventListener('click', function() {
        this.blur();
        mapperAction(() => { if (gameMapper.deleteRoom()) mapperUpdateUI(); });
    });
    btnMapperMoveRoom.addEventListener('click', function() {
        this.blur();
        _movingRoom = !_movingRoom;
        btnMapperMoveRoom.classList.toggle('active', _movingRoom);
        btnMapperMoveRoom.textContent = _movingRoom ? 'Click target...' : 'Move';
    });
    mapperRoomMark.addEventListener('change', (e) => {
        const room = gameMapper.ensureRoom(gameMapper.currentRoom);
        room.mark = e.target.value || null;
        mapperUpdateUI();
    });
    mapperOverviewCanvas.addEventListener('click', mapperOverviewClick);

    // Text slide dialog events
    btnMapperTextSlide.addEventListener('click', function() { this.blur(); mapperOpenTextSlideDialog(); });
    document.getElementById('btnMapperTsApply').addEventListener('click', mapperApplyTextSlide);
    document.getElementById('btnMapperTsClose').addEventListener('click', mapperCloseTextSlideDialog);
    document.getElementById('btnMapperTsSetDefault').addEventListener('click', function() { this.blur(); mapperSetTextSlideDefaults(); });
    mapperTsText.addEventListener('input', mapperRenderTextSlidePreview);
    mapperTsFont.addEventListener('input', mapperRenderTextSlidePreview);
    mapperTsFontSize.addEventListener('input', mapperRenderTextSlidePreview);
    mapperTsColor.addEventListener('input', mapperRenderTextSlidePreview);
    mapperTsPaper.addEventListener('input', mapperRenderTextSlidePreview);

    // Stamp canvas mouse handlers
    mapperStampCanvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const coords = mapperStampCanvasCoords(e);
        mapperStampStartX = coords.x;
        mapperStampStartY = coords.y;
        mapperStampEndX = coords.x;
        mapperStampEndY = coords.y;
        mapperStampDragging = true;
    });
    mapperStampCanvas.addEventListener('mousemove', (e) => {
        if (!mapperStampDragging) return;
        const coords = mapperStampCanvasCoords(e);
        mapperStampEndX = coords.x;
        mapperStampEndY = coords.y;
        mapperStampRender();
        mapperStampRenderSources();
    });
    mapperStampCanvas.addEventListener('mouseup', (e) => {
        if (!mapperStampDragging) return;
        mapperStampDragging = false;
        const coords = mapperStampCanvasCoords(e);
        mapperStampEndX = coords.x;
        mapperStampEndY = coords.y;
        const x = Math.min(mapperStampStartX, mapperStampEndX);
        const y = Math.min(mapperStampStartY, mapperStampEndY);
        const w = Math.abs(mapperStampEndX - mapperStampStartX);
        const h = Math.abs(mapperStampEndY - mapperStampStartY);
        if (w > 0 && h > 0) {
            const room = gameMapper.getCurrentRoom();
            const sourceIdx = mapperStampActiveSource === 'A' ? mapperStampSourceA : mapperStampSourceB;
            if (room && room.blended && mapperGetStampSourceUrl(room, sourceIdx)) {
                room.stamps.push({ sourceIndex: sourceIdx, x, y, w, h });
                mapperApplyStamps(room).then(() => {
                    mapperStampRender();
                    mapperStampRenderSources();
                });
            }
        } else {
            mapperStampRender();
            mapperStampRenderSources();
        }
    });

    // Stamp source canvas click handlers
    mapperStampSourceAWrap.addEventListener('click', () => {
        mapperStampActiveSource = 'A';
        mapperUpdateStampSourceHighlight();
    });
    mapperStampSourceBWrap.addEventListener('click', () => {
        mapperStampActiveSource = 'B';
        mapperUpdateStampSourceHighlight();
    });

    // Stamp source dropdown change handlers
    selStampSourceA.addEventListener('change', (e) => {
        mapperStampSourceA = parseInt(e.target.value, 10);
        mapperStampRenderSources();
    });
    selStampSourceB.addEventListener('change', (e) => {
        mapperStampSourceB = parseInt(e.target.value, 10);
        mapperStampRenderSources();
    });

    // Mapper room hover popup
    const mapperRoomPopup = document.getElementById('mapperRoomPopup');
    const mapperRoomPopupLabel = document.getElementById('mapperRoomPopupLabel');
    const mapperRoomPopupCanvas = document.getElementById('mapperRoomPopupCanvas');
    const mapperRoomPopupCtx = mapperRoomPopupCanvas.getContext('2d');
    let mapperHoveredRoom = null;

    mapperOverviewCanvas.addEventListener('mousemove', (event) => {
        if (!mapperOverviewLayout || gameMapper.getRoomCount() === 0) {
            mapperRoomPopup.classList.add('hidden');
            mapperHoveredRoom = null;
            return;
        }
        const rect = mapperOverviewCanvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        const { bounds, scale, roomW, roomH, gapH, gapV, floor } = mapperOverviewLayout;
        const cellW = (roomW + gapH) * scale;
        const cellH = (roomH + gapV) * scale;
        const gx = Math.floor(mx / cellW) + bounds.minX;
        const gy = Math.floor(my / cellH) + bounds.minY;
        const key = gx + ',' + gy + ',' + floor;
        const room = gameMapper.rooms.get(key);

        if (!room) {
            mapperRoomPopup.classList.add('hidden');
            mapperHoveredRoom = null;
            return;
        }

        const dataUrl = gameMapper.getDisplayImage(room);
        if (!dataUrl) {
            mapperRoomPopup.classList.add('hidden');
            mapperHoveredRoom = null;
            return;
        }

        if (mapperHoveredRoom !== key) {
            mapperHoveredRoom = key;
            mapperRoomPopupLabel.textContent = '(' + gx + ', ' + gy + ')  F' + floor;
            mapperRoomPopupCanvas.width = roomW;
            mapperRoomPopupCanvas.height = roomH;
            mapperRoomPopupCanvas.style.width = (roomW * 2) + 'px';
            mapperRoomPopupCanvas.style.height = (roomH * 2) + 'px';
            mapperRoomPopupCtx.imageSmoothingEnabled = false;
            gameMapper.loadCachedImage(dataUrl).then(img => {
                mapperRoomPopupCtx.drawImage(img, 0, 0, roomW, roomH);
                if (room.mark) {
                    mapperDrawRoomMark(mapperRoomPopupCtx, 0, 0, roomW, roomH, room.mark);
                }
            });
        }

        const cRect = mapperOverviewContainer.getBoundingClientRect();
        const popW = roomW * 2 + 2;
        const popH = roomH * 2 + 22;
        // Position in container's scroll coordinate space
        const cursorX = event.clientX - cRect.left + mapperOverviewContainer.scrollLeft;
        const cursorY = event.clientY - cRect.top + mapperOverviewContainer.scrollTop;
        // Visible viewport bounds in scroll coordinates
        const viewLeft = mapperOverviewContainer.scrollLeft;
        const viewTop = mapperOverviewContainer.scrollTop;
        const viewRight = viewLeft + mapperOverviewContainer.clientWidth;
        const viewBottom = viewTop + mapperOverviewContainer.clientHeight;
        let px = cursorX + 12;
        let py = cursorY + 12;
        // Flip to left/above cursor if overflowing visible area
        if (px + popW > viewRight) px = cursorX - popW - 8;
        if (py + popH > viewBottom) py = cursorY - popH - 8;
        // Clamp to visible viewport
        if (px < viewLeft) px = viewLeft;
        if (py < viewTop) py = viewTop;
        mapperRoomPopup.style.left = px + 'px';
        mapperRoomPopup.style.top = py + 'px';
        mapperRoomPopup.classList.remove('hidden');
    });

    mapperOverviewCanvas.addEventListener('mouseleave', () => {
        mapperRoomPopup.classList.add('hidden');
        mapperHoveredRoom = null;
    });

    // Public API for keyboard shortcuts
    return {
        action: mapperAction,
        captureScreen: mapperCaptureScreen,
        updateUI: mapperUpdateUI,
        deleteRoom() { if (gameMapper.deleteRoom()) mapperUpdateUI(); },
        closeStampDialog: mapperCloseStampDialog,
        isStampDialogOpen() {
            return !mapperStampDialog.classList.contains('hidden');
        },
        closeTextSlideDialog: mapperCloseTextSlideDialog,
        isTextSlideDialogOpen() {
            return !mapperTextSlideDialog.classList.contains('hidden');
        }
    };
}
