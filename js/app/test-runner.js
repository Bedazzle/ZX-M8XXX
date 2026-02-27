// Test Runner — automated test framework for ZX Spectrum emulator
// Extracted from index.html lines ~12261-13822

import { is128kCompat } from '../core/machines.js';
import { TapeTrapHandler, ZipLoader } from '../core/loaders.js';

class TestRunner {
    constructor(spectrum, deps = {}) {
        this.spectrum = spectrum;
        this._deps = deps;
        this.tests = [];
        this.results = [];
        this.running = false;
        this.aborted = false;
        this.currentTest = null;
        this.currentStep = 0;
        this.totalTstates = 0;

        // UI elements
        this.elements = {
            status: document.getElementById('testsStatus'),
            tableBody: document.getElementById('testsTableBody'),
            selectAll: document.getElementById('testsSelectAll'),
            btnRunSelected: document.getElementById('btnRunSelectedTests'),
            btnAbort: document.getElementById('btnAbortTests'),
            btnReload: document.getElementById('btnReloadTests'),
            progressSection: document.getElementById('testsProgressSection'),
            progressText: document.getElementById('testsProgressText'),
            progressPercent: document.getElementById('testsProgressPercent'),
            progressFill: document.getElementById('testsProgressFill'),
            frameCount: document.getElementById('testsFrameCount'),
            tstateCount: document.getElementById('testsTstateCount'),
            comparisonSection: document.getElementById('testsComparisonSection'),
            comparisonResult: document.getElementById('testsComparisonResult'),
            expectedCanvas: document.getElementById('testsExpectedCanvas'),
            actualCanvas: document.getElementById('testsActualCanvas'),
            chkHighlightDiff: document.getElementById('chkHighlightDiff'),
            summarySection: document.getElementById('testsSummarySection'),
            passed: document.getElementById('testsPassed'),
            failed: document.getElementById('testsFailed'),
            skipped: document.getElementById('testsSkipped'),
            time: document.getElementById('testsTime'),
            fps: document.getElementById('testsFps'),
            resultsBody: document.getElementById('testsResultsBody'),
            // Preview mode elements
            btnPreview: document.getElementById('btnPreviewTest'),
            btnPausePreview: document.getElementById('btnPausePreview'),
            btnCopyFrame: document.getElementById('btnCopyFrame'),
            btnScreenshot: document.getElementById('btnTestScreenshot'),
            btnStopPreview: document.getElementById('btnStopPreview'),
            previewSection: document.getElementById('testsPreviewSection'),
            previewFrame: document.getElementById('testsPreviewFrame'),
            previewCanvas: document.getElementById('testsPreviewCanvas'),
            previewInfo: document.getElementById('testsPreviewInfo')
        };

        // Preview mode state
        this.previewing = false;
        this.previewPaused = false;
        this.previewFrameCount = 0;

        // Category filtering
        this.currentCategory = 'all';
        this.categoryTabs = document.getElementById('testsCategoryTabs');

        // Keyboard map for special keys
        this.keyMap = {
            'ENTER': 'Enter', 'SPACE': ' ', 'SHIFT': 'Shift', 'CTRL': 'Control',
            'UP': 'ArrowUp', 'DOWN': 'ArrowDown', 'LEFT': 'ArrowLeft', 'RIGHT': 'ArrowRight',
            'BREAK': 'Escape', 'CAPS': 'CapsLock'
        };

        this.bindEvents();
    }

    bindEvents() {
        this.elements.btnReload?.addEventListener('click', () => this.loadTests());
        this.elements.btnRunSelected?.addEventListener('click', () => this.runSelected());
        this.elements.btnAbort?.addEventListener('click', () => this.abort());
        this.elements.selectAll?.addEventListener('change', (e) => this.toggleSelectAll(e.target.checked));
        this.elements.btnPreview?.addEventListener('click', () => this.startPreview());
        this.elements.btnPausePreview?.addEventListener('click', () => this.togglePausePreview());
        this.elements.btnCopyFrame?.addEventListener('click', () => this.copyFrameCount());
        this.elements.btnScreenshot?.addEventListener('click', () => this.saveScreenshot());
        this.elements.btnStopPreview?.addEventListener('click', () => this.stopPreview());

        // Category tab clicks
        this.categoryTabs?.addEventListener('click', (e) => {
            const tab = e.target.closest('.tests-category-tab');
            if (tab) {
                this.setCategory(tab.dataset.category);
            }
        });
    }

    async loadTests(url = 'tests.json') {
        this.updateStatus('Loading tests...');
        try {
            // Add cache-busting to ensure fresh data
            const cacheBuster = `?_=${Date.now()}`;
            const response = await fetch(url + cacheBuster);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.tests = data.tests || [];
            this.renderTestList();
            this.updateCategoryCounts();
            this.updateStatus(`${this.tests.length} tests loaded`);
            this.elements.btnRunSelected.disabled = false;
            this.elements.btnPreview.disabled = false;
        } catch (e) {
            this.updateStatus(`Failed to load tests: ${e.message}`);
            this.tests = [];
            this.renderTestList();
        }
    }

    renderTestList() {
        const tbody = this.elements.tableBody;
        tbody.innerHTML = '';

        for (const test of this.tests) {
            const isEnabled = test.enabled !== false; // Default to true
            const category = test.category || 'other';
            const isVisible = this.currentCategory === 'all' || category === this.currentCategory;

            const tr = document.createElement('tr');
            tr.dataset.testId = test.id;
            tr.dataset.category = category;
            if (!isEnabled) tr.classList.add('tests-row-disabled');
            if (!isVisible) tr.style.display = 'none';
            tr.innerHTML = `
                <td class="tests-col-check"><input type="checkbox" class="test-checkbox" ${isEnabled ? 'checked' : 'disabled'}></td>
                <td class="tests-col-name">${this.escapeHtml(test.name)}</td>
                <td class="tests-col-machine">${test.machine || '48k'}</td>
                <td class="tests-col-file">${this.escapeHtml(test.file)}</td>
                <td class="tests-col-result tests-result-pending">${isEnabled ? '-' : 'disabled'}</td>
            `;
            tbody.appendChild(tr);
        }
    }

    setCategory(category) {
        this.currentCategory = category;

        // Update tab styling
        const tabs = this.categoryTabs?.querySelectorAll('.tests-category-tab');
        tabs?.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === category);
        });

        // Filter visible rows
        const rows = this.elements.tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            const rowCategory = row.dataset.category;
            const isVisible = category === 'all' || rowCategory === category;
            row.style.display = isVisible ? '' : 'none';
        });

        // Update select-all checkbox state
        this.updateSelectAllState();
    }

    updateSelectAllState() {
        const visibleCheckboxes = Array.from(this.elements.tableBody.querySelectorAll('tr'))
            .filter(row => row.style.display !== 'none')
            .map(row => row.querySelector('.test-checkbox:not(:disabled)'))
            .filter(Boolean);

        const allChecked = visibleCheckboxes.length > 0 && visibleCheckboxes.every(cb => cb.checked);
        if (this.elements.selectAll) {
            this.elements.selectAll.checked = allChecked;
        }
    }

    updateCategoryCounts() {
        const counts = { all: this.tests.length };
        for (const test of this.tests) {
            const cat = test.category || 'other';
            counts[cat] = (counts[cat] || 0) + 1;
        }

        const tabs = this.categoryTabs?.querySelectorAll('.tests-category-tab');
        tabs?.forEach(tab => {
            const cat = tab.dataset.category;
            const count = counts[cat] || 0;
            const countSpan = tab.querySelector('.count');
            if (countSpan) {
                countSpan.textContent = `(${count})`;
            } else if (count > 0 || cat === 'all') {
                tab.innerHTML = `${tab.textContent.split('(')[0].trim()} <span class="count">(${count})</span>`;
            }
        });
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    toggleSelectAll(checked) {
        // Only toggle visible (filtered) tests
        const rows = this.elements.tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            if (row.style.display !== 'none') {
                const cb = row.querySelector('.test-checkbox:not(:disabled)');
                if (cb) cb.checked = checked;
            }
        });
    }

    getSelectedTests() {
        const selected = [];
        const rows = this.elements.tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            // Only include visible (filtered) rows
            if (row.style.display === 'none') return;
            const checkbox = row.querySelector('.test-checkbox');
            if (checkbox?.checked) {
                const testId = row.dataset.testId;
                const test = this.tests.find(t => t.id === testId);
                if (test) selected.push(test);
            }
        });
        return selected;
    }

    updateStatus(text) {
        if (this.elements.status) this.elements.status.textContent = text;
    }

    async runAll() {
        // Only run enabled tests
        const enabledTests = this.tests.filter(t => t.enabled !== false);
        await this.runTests(enabledTests);
    }

    async runSelected() {
        const selected = this.getSelectedTests();
        if (selected.length === 0) {
            this.updateStatus('No tests selected');
            return;
        }
        await this.runTests(selected);
    }

    async runTests(tests) {
        if (this.running) return;
        this.running = true;
        this.aborted = false;
        this.results = [];

        let passed = 0, failed = 0, skipped = 0;
        const startTime = performance.now();
        let totalFramesRun = 0;

        try {
            // UI updates
            this.elements.btnRunSelected.disabled = true;
            this.elements.btnAbort.classList.remove('hidden');
            this.elements.progressSection.classList.remove('hidden');
            this.elements.previewSection.classList.add('hidden');
            this.elements.comparisonSection.classList.add('hidden');
            this.elements.summarySection.classList.add('hidden');

            // Reset result column for enabled tests only
            this.elements.tableBody.querySelectorAll('tr').forEach(row => {
                const testId = row.dataset.testId;
                const test = this.tests.find(t => t.id === testId);
                const td = row.querySelector('.tests-col-result');
                if (td && test && test.enabled !== false) {
                    td.textContent = '-';
                    td.className = 'tests-col-result tests-result-pending';
                }
            });

            for (let i = 0; i < tests.length; i++) {
                if (this.aborted) {
                    skipped = tests.length - i;
                    break;
                }

                const test = tests[i];
                this.currentTest = test;
                this.updateProgress(i + 1, tests.length, test.name, 0, 1, 1, test.steps.length);

                // Update row to show running
                this.setTestResult(test.id, 'running', '...');

                try {
                    const result = await this.runSingleTest(test);
                    totalFramesRun += this.totalFrames;
                    this.results.push({ test, result });

                    if (result.passed) {
                        passed++;
                        this.setTestResult(test.id, 'pass', 'PASS');
                    } else {
                        failed++;
                        const detail = result.diff ? `${result.diff.diffCount} pixels` : result.error || 'FAIL';
                        this.setTestResult(test.id, 'fail', detail);
                    }
                } catch (e) {
                    failed++;
                    totalFramesRun += this.totalFrames;
                    this.results.push({ test, result: { passed: false, error: e.message } });
                    this.setTestResult(test.id, 'fail', e.message);
                }
            }

            // Show summary
            const elapsedMs = performance.now() - startTime;
            const elapsedSec = elapsedMs / 1000;
            const avgFps = totalFramesRun > 0 ? Math.round(totalFramesRun / elapsedSec) : 0;

            this.elements.passed.textContent = passed;
            this.elements.failed.textContent = failed;
            this.elements.skipped.textContent = skipped;
            this.elements.time.textContent = elapsedSec.toFixed(1);
            this.elements.fps.textContent = avgFps;
            this.renderResultsSummary();
            this.elements.summarySection.classList.remove('hidden');
            this.updateStatus(`Done: ${passed} passed, ${failed} failed, ${skipped} skipped (${elapsedSec.toFixed(1)}s, ${avgFps} fps)`);

        } finally {
            // Always reset state
            this.running = false;
            this.currentTest = null;
            this.elements.btnRunSelected.disabled = false;
            this.elements.btnPreview.disabled = false;
            this.elements.btnAbort.classList.add('hidden');
            this.elements.progressSection.classList.add('hidden');

            // Always update canvas size after tests (in case dimensions changed)
            this._deps.updateCanvasSize?.();

            // Refresh main canvas after tests complete
            this.spectrum.redraw();
        }
    }

    setTestResult(testId, status, text) {
        const row = this.elements.tableBody.querySelector(`tr[data-test-id="${testId}"]`);
        if (row) {
            const td = row.querySelector('.tests-col-result');
            td.textContent = text;
            td.className = `tests-col-result tests-result-${status}`;
        }
    }

    updateProgress(testNum, totalTests, testName, frame, totalFrames, stepNum, totalSteps) {
        const percent = Math.round((frame / totalFrames) * 100);
        const stepInfo = totalSteps > 1 ? ` (${stepNum}/${totalSteps})` : '';
        this.elements.progressText.textContent = `Test ${testNum}/${totalTests}: ${testName}${stepInfo}`;
        this.elements.progressPercent.textContent = `${percent}%`;
        this.elements.progressFill.style.width = `${percent}%`;
        this.elements.frameCount.textContent = `Frame: ${frame}/${totalFrames}`;
        this.elements.tstateCount.textContent = `T-states: ${this.totalTstates.toLocaleString()}`;
    }

    async runSingleTest(test) {
        // Save current machine state
        const savedMachine = this.spectrum.machineType;
        const savedPalette = paletteSelect?.value || 'default';
        const savedFullBorder = this.spectrum.ula.fullBorderMode;
        const savedLateTimings = this.spectrum.lateTimings;
        const wasRunning = this.spectrum.running;
        if (wasRunning) this.spectrum.stop();

        try {
            // Configure machine if needed
            if (test.machine && test.machine !== this.spectrum.machineType) {
                await this.switchMachine(test.machine);
            }

            // Apply timing settings if specified
            if (test.earlyTimings !== undefined) {
                this.spectrum.setEarlyTimings?.(test.earlyTimings);
            }

            // Apply full border mode if specified (default to true for tests)
            const useFullBorder = test.fullBorder !== undefined ? test.fullBorder : true;
            if (this.spectrum.ula.setFullBorder(useFullBorder)) {
                this.spectrum.updateDisplayDimensions();
            }

            // Reset and load file
            this.spectrum.reset();

            // Apply ULAplus AFTER reset (default: disabled)
            // Must be after reset to avoid being cleared
            // Always reset ULA+ first to clear palette from previous tests
            this.spectrum.ula.resetULAplus();
            const enableUlaplus = test.ulaplus === true;
            this.spectrum.ula.ulaplus.enabled = enableUlaplus;
            if (enableUlaplus) {
                this.spectrum.ula.ulaplus.paletteEnabled = true;  // Enable palette mode for tests
            }
            this._deps.updateULAplusStatus?.();

            // Apply palette if specified
            if (test.palette && this._deps.applyPalette) {
                this._deps.applyPalette(test.palette);
            }
            this.spectrum.tapeLoader.rewind();

            // Recreate tape trap to ensure clean state
            this.spectrum.tapeTrap = new TapeTrapHandler(
                this.spectrum.cpu,
                this.spectrum.memory,
                this.spectrum.tapeLoader
            );
            this.spectrum.tapeTrap.setEnabled(this.spectrum.tapeTrapsEnabled);

            // Ensure keyboard is fully released
            this.spectrum.ula.keyboardState.fill(0xFF);

            this.currentTest = test;
            await this.loadTestFile(test.file, test.zipEntry);

            this.totalTstates = 0;
            this.totalFrames = 0;

            // Execute each step (frames are absolute from test start)
            for (let stepIdx = 0; stepIdx < test.steps.length; stepIdx++) {
                if (this.aborted) return { passed: false, error: 'Aborted' };

                const step = test.steps[stepIdx];
                this.currentStep = stepIdx;

                const stepResult = await this.runStep(step, test, stepIdx);
                if (!stepResult.passed) {
                    return stepResult;
                }
            }

            return { passed: true };

        } finally {
            // Restore machine state FIRST (creates new ULA)
            if (test.machine && test.machine !== savedMachine) {
                await this.switchMachine(savedMachine);
            }
            // Restore full border mode AFTER machine switch (new ULA loses settings)
            if (this.spectrum.ula.setFullBorder(savedFullBorder)) {
                this.spectrum.updateDisplayDimensions();
            }
            // Restore palette if changed
            if (test.palette && this._deps.applyPalette) {
                this._deps.applyPalette(savedPalette);
            }
            // Restore timing settings
            this.spectrum.setLateTimings(savedLateTimings);
        }
    }

    async switchMachine(machineType) {
        // Map test machine types to spectrum machine types
        const machineMap = {
            '48k': '48k',
            '128k': '128k',
            '+2': '+2', 'plus2': '+2',
            '+2a': '+2a', 'plus2a': '+2a',
            '+3': '+3', 'plus3': '+3',
            'pentagon': 'pentagon', 'p128': 'pentagon',
            'pentagon1024': 'pentagon1024',
            'scorpion': 'scorpion'
        };
        const targetMachine = machineMap[machineType.toLowerCase()] || '48k';

        if (this.spectrum.machineType !== targetMachine) {
            this.spectrum.setMachineType(targetMachine);

            // Load appropriate ROM for the new machine type
            this._deps.loadRomsForMachineType(this.spectrum, targetMachine);

            this.spectrum.reset();

            // Reset disassembler to use fresh memory reference
            if (this._deps.resetDisasm) this._deps.resetDisasm();

            // Update ULAplus status UI
            this._deps.updateULAplusStatus?.();
        }
    }

    // Reload ROM if snapshot loading changed machine type and invalidated ROM
    reloadRomIfNeeded() {
        if (this.spectrum.romLoaded) return;
        this._deps.loadRomsForMachineType(this.spectrum, this.spectrum.machineType);
    }

    async loadTestFile(filePath, zipEntry) {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`Failed to load ${filePath}`);
        const data = new Uint8Array(await response.arrayBuffer());

        // Determine file type and load
        const ext = filePath.split('.').pop().toLowerCase();

        // Update filename display (extract just the filename from path)
        const displayName = zipEntry || filePath.split('/').pop();
        this._deps.updateMediaIndicator?.(displayName, ext === 'tap' ? 'tape' : (ext === 'trd' || ext === 'scl') ? 'disk' : null);

        if (ext === 'tap') {
            // Load TAP file and set trap BEFORE simulating LOAD command
            this.spectrum.tapeLoader.load(data);
            this.spectrum.tapeTrap.setTape(this.spectrum.tapeLoader);

            // Simulate LOAD "" keypresses (trap is now ready)
            await this.injectLoadCommand();
        } else if (ext === 'sna') {
            this.spectrum.loadSnapshot(data);  // Auto-switches machine
            this.reloadRomIfNeeded();
        } else if (ext === 'z80') {
            this.spectrum.loadZ80Snapshot(data);  // Auto-switches machine
            this.reloadRomIfNeeded();
        } else if (ext === 'szx') {
            this.spectrum.loadSZXSnapshot(data);
            this.reloadRomIfNeeded();
        } else if (ext === 'rzx') {
            await this.spectrum.loadRZX(data);
            this.reloadRomIfNeeded();
        } else if (ext === 'zip') {
            // Handle ZIP files - extract specific entry or first compatible file
            const spectrumFiles = await ZipLoader.findAllSpectrum(data.buffer);

            if (spectrumFiles.length === 0) {
                throw new Error('No compatible files found in ZIP');
            }

            let fileToLoad;
            if (zipEntry) {
                // Find specific entry by name
                fileToLoad = spectrumFiles.find(f =>
                    f.name === zipEntry ||
                    f.name.toLowerCase() === zipEntry.toLowerCase() ||
                    f.name.endsWith('/' + zipEntry) ||
                    f.name.toLowerCase().endsWith('/' + zipEntry.toLowerCase())
                );
                if (!fileToLoad) {
                    throw new Error(`ZIP entry not found: ${zipEntry}`);
                }
            } else {
                // Use first compatible file
                fileToLoad = spectrumFiles[0];
            }

            // Load the extracted file
            const innerExt = fileToLoad.name.split('.').pop().toLowerCase();
            await this.loadExtractedFile(fileToLoad.data, fileToLoad.name, innerExt);
        } else if (ext === 'trd' || ext === 'scl') {
            // Disk images - load disk, boot TR-DOS, run program
            this.spectrum.loadDiskImage(data.buffer, ext, filePath);
            const diskRun = this.currentTest ? (this.currentTest.diskRun || 'boot') : 'boot';
            await this.injectDiskRunCommand(diskRun);
        } else if (ext === 'dsk') {
            // DSK disk image - load into FDC, boot +3 from disk
            this.spectrum.loadDSKImage(new Uint8Array(data.buffer), filePath);
            await this.bootPlus3Disk();
        } else {
            throw new Error(`Unsupported file format: ${ext}`);
        }
    }

    async loadExtractedFile(data, fileName, ext) {
        // Update filename display for extracted file
        this._deps.updateMediaIndicator?.(fileName, ext === 'tap' ? 'tape' : (ext === 'trd' || ext === 'scl' || ext === 'dsk') ? 'disk' : null);

        if (ext === 'tap') {
            this.spectrum.tapeLoader.load(new Uint8Array(data));
            this.spectrum.tapeTrap.setTape(this.spectrum.tapeLoader);
            await this.injectLoadCommand();
        } else if (ext === 'sna') {
            this.spectrum.loadSnapshot(new Uint8Array(data));  // Auto-switches machine
            this.reloadRomIfNeeded();
        } else if (ext === 'z80') {
            this.spectrum.loadZ80Snapshot(new Uint8Array(data));  // Auto-switches machine
            this.reloadRomIfNeeded();
        } else if (ext === 'szx') {
            this.spectrum.loadSZXSnapshot(new Uint8Array(data));
            this.reloadRomIfNeeded();
        } else if (ext === 'rzx') {
            await this.spectrum.loadRZX(new Uint8Array(data));
            this.reloadRomIfNeeded();
        } else if (ext === 'trd' || ext === 'scl') {
            this.spectrum.loadDiskImage(data, ext, fileName);
            const diskRun = this.currentTest ? (this.currentTest.diskRun || 'boot') : 'boot';
            await this.injectDiskRunCommand(diskRun);
        } else if (ext === 'dsk') {
            this.spectrum.loadDSKImage(new Uint8Array(data), fileName);
            await this.bootPlus3Disk();
        } else {
            throw new Error(`Unsupported extracted file format: ${ext}`);
        }
    }

    // Helper to run frames with abort checking and UI yielding
    async runFramesWithAbortCheck(count, callback = null) {
        for (let i = 0; i < count; i++) {
            // Check if preview or test was stopped
            if (!this.previewing && !this.running) return false;

            if (callback) callback();
            this.spectrum.runFrame();

            // Yield every 10 frames to allow UI updates (Stop button)
            if (i % 10 === 9) {
                await new Promise(r => setTimeout(r, 0));
            }
        }
        return true;
    }

    // Inject LOAD "" command into edit line and trigger execution
    async injectLoadCommand() {
        const mem = this.spectrum.memory;
        const cpu = this.spectrum.cpu;
        const ula = this.spectrum.ula;
        const machType = this.spectrum.machineType;
        const isAmsMenu = machType === '+2' || machType === '+2a' || machType === '+3';
        const is128K = is128kCompat(machType);

        if (isAmsMenu) {
            // +2/+2A/+3: Amstrad menu — same approach as main auto-load:
            // wait for menu, press Enter to select "Tape Loader" (default option)
            // which runs LOAD "" automatically, no typing needed
            ula.keyboardState.fill(0xFF);

            // Wait for menu to fully appear (150 frames = 3000ms at 50fps)
            if (!await this.runFramesWithAbortCheck(150, () => ula.keyboardState.fill(0xFF))) return;

            // Press Enter to select Tape Loader
            ula.keyDown('Enter');
            for (let i = 0; i < 15; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp('Enter');
            ula.keyboardState.fill(0xFF);

            // Run frames for flash load to complete
            await this.runFramesWithAbortCheck(300, () => {
                ula.keyboardState.fill(0xFF);
            });
            return;
        }

        if (is128K) {
            // 128K/Pentagon: Sinclair menu — press "1" for BASIC, then type LOAD ""
            ula.keyboardState.fill(0xFF);

            // Run frames until menu is fully ready
            if (!await this.runFramesWithAbortCheck(200, () => ula.keyboardState.fill(0xFF))) return;

            // Press "1" to select 128 BASIC
            ula.keyDown('1');
            for (let i = 0; i < 15; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp('1');
            ula.keyboardState.fill(0xFF);

            // Wait for BASIC to initialize
            if (!await this.runFramesWithAbortCheck(100, () => ula.keyboardState.fill(0xFF))) return;

            // Now type LOAD "" just like 48K mode
            // In 128K BASIC, J key also gives LOAD in K mode

            // J = LOAD
            ula.keyDown('j');
            for (let i = 0; i < 15; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp('j');
            ula.keyboardState.fill(0xFF);
            for (let i = 0; i < 10; i++) {
                this.spectrum.runFrame();
            }

            // Symbol + P = "
            ula.keyDown('Alt');
            ula.keyDown('p');
            for (let i = 0; i < 15; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp('p');
            ula.keyUp('Alt');
            ula.keyboardState.fill(0xFF);
            for (let i = 0; i < 10; i++) {
                this.spectrum.runFrame();
            }

            // Symbol + P = " again
            ula.keyDown('Alt');
            ula.keyDown('p');
            for (let i = 0; i < 15; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp('p');
            ula.keyUp('Alt');
            ula.keyboardState.fill(0xFF);
            for (let i = 0; i < 10; i++) {
                this.spectrum.runFrame();
            }

            // ENTER
            ula.keyDown('Enter');
            for (let i = 0; i < 5; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp('Enter');
            ula.keyboardState.fill(0xFF);

            // Clear ROM keyboard variables
            for (let i = 0x5C00; i <= 0x5C08; i++) {
                mem.write(i, 0xFF);
            }

            // Run frames for loading with keyboard clear
            await this.runFramesWithAbortCheck(300, () => {
                ula.keyboardState.fill(0xFF);
                for (let j = 0x5C00; j <= 0x5C08; j++) {
                    mem.write(j, 0xFF);
                }
            });
            return;
        }

        // 48K mode: type LOAD "" and press ENTER
        // Run frames until ROM reaches main input loop
        let frameCount = 0;

        for (let i = 0; i < 200; i++) {
            // Check if preview or test was stopped
            if (!this.previewing && !this.running) return;

            this.spectrum.runFrame();
            frameCount++;

            // Yield every 10 frames
            if (i % 10 === 9) {
                await new Promise(r => setTimeout(r, 0));
            }

            const curDfSz = mem.read(0x5C6B);
            const curEline = mem.read(0x5C59) | (mem.read(0x5C5A) << 8);

            // Check if ROM has initialized
            if (curDfSz === 2 && curEline >= 0x5B00 && curEline < 0x6000) {
                break;
            }
        }

        // ROM init doesn't always CLS after setting ATTR_P - fix attrs manually
        const attrP = mem.read(0x5C8D);
        if (attrP !== 0 && mem.read(0x5800) === 0) {
            for (let i = 0x5800; i < 0x5B00; i++) {
                mem.write(i, attrP);
            }
        }

        // Get E_LINE address
        const elineAddr = mem.read(0x5C59) | (mem.read(0x5C5A) << 8);

        // Validate E_LINE
        if (elineAddr < 0x5B00 || elineAddr >= 0x6000) {
            console.warn('E_LINE not valid:', elineAddr.toString(16));
            return; // Can't inject, ROM not ready
        }

        // Run a few more frames to ensure ROM is fully in input loop
        if (!await this.runFramesWithAbortCheck(50)) return;

        // Ensure all keys are released before we start
        this.spectrum.ula.keyboardState.fill(0xFF);

        // Simulate typing LOAD "" and pressing ENTER
        await this.simulateLoadCommand();
    }

    // Simulate typing LOAD "" and ENTER using keyboard emulation
    async simulateLoadCommand() {
        const ula = this.spectrum.ula;

        // Helper to check if aborted
        const isAborted = () => !this.previewing && !this.running;

        // Helper to press a single key using ULA methods (with abort check)
        const pressKey = async (key, holdFrames = 25, releaseFrames = 15) => {
            if (isAborted()) return false;
            ula.keyDown(key);
            for (let i = 0; i < holdFrames; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp(key);
            for (let i = 0; i < releaseFrames; i++) {
                this.spectrum.runFrame();
            }
            // Yield after each key press
            await new Promise(r => setTimeout(r, 0));
            return !isAborted();
        };

        // Helper to press key with Symbol Shift (Alt in browser terms)
        const pressWithSymbol = async (key, holdFrames = 25, releaseFrames = 15) => {
            if (isAborted()) return false;
            ula.keyDown('Alt'); // Symbol Shift
            ula.keyDown(key);
            for (let i = 0; i < holdFrames; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp(key);
            ula.keyUp('Alt');
            for (let i = 0; i < releaseFrames; i++) {
                this.spectrum.runFrame();
            }
            // Yield after each key press
            await new Promise(r => setTimeout(r, 0));
            return !isAborted();
        };

        // J = LOAD in K mode
        if (!await pressKey('j')) return;

        // Symbol Shift + P = " (quote)
        if (!await pressWithSymbol('p')) return;

        // Symbol Shift + P again for closing "
        if (!await pressWithSymbol('p')) return;

        // Check abort before ENTER
        if (isAborted()) return;

        // ENTER - press briefly then clear keyboard immediately
        ula.keyDown('Enter');
        for (let i = 0; i < 5; i++) {
            this.spectrum.runFrame();
        }
        ula.keyUp('Enter');
        ula.keyboardState.fill(0xFF);

        // Clear ROM keyboard system variables
        const mem = this.spectrum.memory;
        for (let i = 0x5C00; i <= 0x5C07; i++) {
            mem.write(i, 0xFF);
        }
        mem.write(0x5C08, 0xFF);

        // Run frames with keyboard continuously cleared
        // The tape trap will load instantly, then BASIC autorun executes
        await this.runFramesWithAbortCheck(200, () => ula.keyboardState.fill(0xFF));
    }

    // Boot TR-DOS and type RUN "filename" (or just RUN for boot file)
    async injectDiskRunCommand(diskRun) {
        const ula = this.spectrum.ula;
        const isAborted = () => !this.previewing && !this.running;

        // Boot TR-DOS
        if (!this.spectrum.bootTrdos()) {
            console.warn('[TestRunner] Cannot boot TR-DOS');
            return;
        }

        // Run frames for TR-DOS to initialize
        if (!await this.runFramesWithAbortCheck(200, () => ula.keyboardState.fill(0xFF))) return;

        // Helper to press a single key
        const pressKey = async (key, holdFrames = 15, releaseFrames = 10) => {
            if (isAborted()) return false;
            ula.keyDown(key);
            for (let i = 0; i < holdFrames; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp(key);
            for (let i = 0; i < releaseFrames; i++) {
                this.spectrum.runFrame();
            }
            ula.keyboardState.fill(0xFF);
            await new Promise(r => setTimeout(r, 0));
            return !isAborted();
        };

        // Helper to press key with Symbol Shift
        const pressWithSymbol = async (key, holdFrames = 15, releaseFrames = 10) => {
            if (isAborted()) return false;
            ula.keyDown('Alt');
            ula.keyDown(key);
            for (let i = 0; i < holdFrames; i++) {
                this.spectrum.runFrame();
            }
            ula.keyUp(key);
            ula.keyUp('Alt');
            for (let i = 0; i < releaseFrames; i++) {
                this.spectrum.runFrame();
            }
            ula.keyboardState.fill(0xFF);
            await new Promise(r => setTimeout(r, 0));
            return !isAborted();
        };

        // Type R (in TR-DOS, R gives RUN keyword)
        if (!await pressKey('r')) return;

        // If diskRun is not empty/"boot", add "filename"
        if (diskRun && diskRun.toLowerCase() !== 'boot') {
            // Space between RUN and "
            if (!await pressKey(' ')) return;

            // Opening quote: Symbol + P
            if (!await pressWithSymbol('p')) return;

            // Type filename characters
            for (const ch of diskRun) {
                if (isAborted()) return;
                const lower = ch.toLowerCase();
                if (lower >= 'a' && lower <= 'z') {
                    if (!await pressKey(lower)) return;
                } else if (lower >= '0' && lower <= '9') {
                    if (!await pressKey(lower)) return;
                } else if (lower === '.') {
                    if (!await pressWithSymbol('m')) return;
                } else if (lower === ' ') {
                    if (!await pressKey(' ')) return;
                }
            }

            // Closing quote: Symbol + P
            if (!await pressWithSymbol('p')) return;
        }

        // Press Enter
        if (!await pressKey('Enter')) return;

        // Run frames for loading
        await this.runFramesWithAbortCheck(300, () => ula.keyboardState.fill(0xFF));
    }

    // Boot +3 from DSK disk image
    // Reset machine, preserve disk, press Enter at Amstrad menu to select "Loader"
    // The +3 ROM's Loader routine auto-detects disk and boots from it
    async bootPlus3Disk() {
        const ula = this.spectrum.ula;

        if (!this.spectrum.fdc) {
            console.warn('[TestRunner] Cannot boot +3 disk: no FDC');
            return;
        }

        // Save disk before reset
        const disk = this.spectrum.fdc.drives[0].disk;

        // Reset machine
        this.spectrum.reset();

        // Restore disk after reset
        if (disk) {
            this.spectrum.fdc.drives[0].disk = disk;
        }

        // Wait for +3 Amstrad menu to appear (150 frames = 3s at 50fps)
        ula.keyboardState.fill(0xFF);
        if (!await this.runFramesWithAbortCheck(150, () => ula.keyboardState.fill(0xFF))) return;

        // Press Enter to select "Loader" (default option)
        // ROM will detect disk and boot from it automatically
        ula.keyDown('Enter');
        for (let i = 0; i < 15; i++) {
            this.spectrum.runFrame();
        }
        ula.keyUp('Enter');
        ula.keyboardState.fill(0xFF);

        // Run frames for ROM to boot from disk
        await this.runFramesWithAbortCheck(500, () => ula.keyboardState.fill(0xFF));
    }

    // Directly load tape contents into memory, bypassing ROM (kept for reference)
    directTapeLoad() {
        const tape = this.spectrum.tapeLoader;
        const mem = this.spectrum.memory;
        const cpu = this.spectrum.cpu;

        if (!tape || tape.getBlockCount() === 0) {
            console.warn('No tape data to load');
            return;
        }

        tape.rewind();
        let pendingHeader = null;

        // Process ALL tape blocks - load CODE files directly, skip BASIC
        let lastCodeAddr = null;
        let lastCodeExec = null;

        while (tape.hasMoreBlocks()) {
            const block = tape.getNextBlock();
            if (!block || !block.data || block.data.length < 2) continue;

            const flag = block.flag;
            const data = block.data;

            if (flag === 0x00 && data.length >= 17) {
                // Header block
                const type = data[0];
                const name = String.fromCharCode(...data.slice(1, 11)).trim();
                const dataLen = data[11] | (data[12] << 8);
                const param1 = data[13] | (data[14] << 8);
                const param2 = data[15] | (data[16] << 8);

                pendingHeader = { type, name, dataLen, param1, param2 };

            } else if (flag === 0xFF && pendingHeader) {
                // Data block
                const h = pendingHeader;
                const dataBytes = data.slice(0, data.length - 1); // Remove checksum

                if (h.type === 3) {
                    // CODE file - load directly to memory
                    for (let i = 0; i < dataBytes.length; i++) {
                        mem.write(h.param1 + i, dataBytes[i]);
                    }
                    lastCodeAddr = h.param1;
                    lastCodeExec = h.param2;
                }
                pendingHeader = null;
            }
        }

        // Execute the last CODE file loaded
        if (lastCodeAddr !== null) {
            const execAddr = (lastCodeExec !== 0 && lastCodeExec < 0x10000) ? lastCodeExec : lastCodeAddr;
            cpu.pc = execAddr;
            cpu.iff1 = false;
            cpu.iff2 = false;
            cpu.sp = 0xFF40; // Set stack below screen
        }

        tape.rewind();
    }

    async runStep(step, test, stepIdx) {
        // Press keys if specified
        if (step.keys) {
            await this.pressKeys(step.keys);
        }

        // Calculate target frames (absolute from test start)
        const tstatesPerFrame = this.spectrum.timing.tstatesPerFrame;
        let targetFrames = step.frames || 0;
        if (step.tstates) {
            targetFrames = Math.ceil(step.tstates / tstatesPerFrame);
        }

        // Calculate how many frames to run (absolute - already run)
        const framesToRun = Math.max(0, targetFrames - this.totalFrames);

        // Run frames at full speed
        for (let f = 0; f < framesToRun; f++) {
            if (this.aborted) return { passed: false, error: 'Aborted' };

            const tstates = this.spectrum.runFrameHeadless();
            this.totalTstates += tstates;
            this.totalFrames++;

            // Update progress
            if (f % 10 === 0) {
                this.updateProgress(
                    this.tests.indexOf(test) + 1,
                    this.tests.length,
                    test.name,
                    this.totalFrames,
                    targetFrames,
                    stepIdx + 1,
                    test.steps.length
                );
                // Yield to UI
                await new Promise(r => setTimeout(r, 0));
            }
        }

        // Final progress update
        this.updateProgress(
            this.tests.indexOf(test) + 1,
            this.tests.length,
            test.name,
            this.totalFrames,
            targetFrames,
            stepIdx + 1,
            test.steps.length
        );

        // Compare screen if specified
        if (step.screen) {
            // Render final frame for comparison
            const frameBuffer = this.spectrum.renderAndCaptureScreen();
            const dims = this.spectrum.getScreenDimensions();

            // Create ImageData from frame buffer
            const actualImageData = new ImageData(
                new Uint8ClampedArray(frameBuffer),
                dims.width,
                dims.height
            );

            // Load pristine image
            let expectedImageData;
            try {
                expectedImageData = await this.loadPristineImage(step.screen);
            } catch (e) {
                return { passed: false, error: `Failed to load pristine: ${e.message}` };
            }

            // Compare
            const tolerance = step.tolerance || 0;
            const diff = this.compareScreens(actualImageData, expectedImageData, tolerance);

            // Display comparison
            this.displayComparison(expectedImageData, actualImageData, diff, this.totalFrames);

            if (!diff.matches) {
                return { passed: false, diff, step: stepIdx, frame: this.totalFrames };
            }
        }

        return { passed: true };
    }

    async pressKeys(keyString) {
        const parts = keyString.split(',');

        for (const part of parts) {
            const trimmed = part.trim();

            // Check for delay: "500ms"
            const delayMatch = trimmed.match(/^(\d+)ms$/);
            if (delayMatch) {
                const ms = parseInt(delayMatch[1]);
                const frames = Math.ceil(ms / 20); // ~50fps
                for (let f = 0; f < frames; f++) {
                    this.spectrum.runFrameHeadless();
                }
                continue;
            }

            // Simultaneous keys: "a+b"
            const keys = trimmed.split('+').map(k => this.mapKey(k.trim()));

            // Press all keys
            for (const key of keys) {
                this.spectrum.ula.keyDown(key);
            }

            // Hold for a few frames
            for (let f = 0; f < 5; f++) {
                this.spectrum.runFrameHeadless();
            }

            // Release all keys
            for (const key of keys) {
                this.spectrum.ula.keyUp(key);
            }

            // Wait a frame after release
            this.spectrum.runFrameHeadless();
        }
    }

    mapKey(key) {
        // Check special key names
        const upper = key.toUpperCase();
        if (this.keyMap[upper]) return this.keyMap[upper];
        // Return as-is for regular characters
        return key.toLowerCase();
    }

    async loadPristineImage(path) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(ctx.getImageData(0, 0, img.width, img.height));
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
            img.src = path;
        });
    }

    compareScreens(actual, expected, tolerance = 0) {
        // Handle size mismatch by comparing overlapping region
        const width = Math.min(actual.width, expected.width);
        const height = Math.min(actual.height, expected.height);
        let diffCount = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const aIdx = (y * actual.width + x) * 4;
                const eIdx = (y * expected.width + x) * 4;

                const dr = Math.abs(actual.data[aIdx] - expected.data[eIdx]);
                const dg = Math.abs(actual.data[aIdx + 1] - expected.data[eIdx + 1]);
                const db = Math.abs(actual.data[aIdx + 2] - expected.data[eIdx + 2]);

                if (dr > tolerance || dg > tolerance || db > tolerance) {
                    diffCount++;
                }
            }
        }

        const totalPixels = width * height;
        return {
            matches: diffCount === 0,
            diffCount,
            diffPercent: (diffCount / totalPixels * 100).toFixed(2),
            width,
            height
        };
    }

    displayComparison(expected, actual, diff, frame) {
        // Show comparison section
        this.elements.comparisonSection.classList.remove('hidden');

        // Draw expected
        const expCtx = this.elements.expectedCanvas.getContext('2d');
        this.elements.expectedCanvas.width = expected.width;
        this.elements.expectedCanvas.height = expected.height;
        expCtx.putImageData(expected, 0, 0);

        // Draw actual
        const actCtx = this.elements.actualCanvas.getContext('2d');
        this.elements.actualCanvas.width = actual.width;
        this.elements.actualCanvas.height = actual.height;
        actCtx.putImageData(actual, 0, 0);

        // Draw difference highlight overlay if enabled and there are differences
        if (this.elements.chkHighlightDiff?.checked && !diff.matches) {
            this.drawDiffHighlight(expCtx, actCtx, expected, actual, diff);
        }

        // Update result text
        const resultEl = this.elements.comparisonResult;
        if (diff.matches) {
            resultEl.textContent = 'MATCH - Screens are identical';
            resultEl.className = 'tests-comparison-result pass';
        } else {
            resultEl.textContent = `MISMATCH at frame ${frame} - ${diff.diffCount} pixels differ (${diff.diffPercent}%)`;
            resultEl.className = 'tests-comparison-result fail';
        }
    }

    // Draw soft cloud highlight around difference pixels
    drawDiffHighlight(expCtx, actCtx, expected, actual, diff) {
        const width = Math.min(expected.width, actual.width);
        const height = Math.min(expected.height, actual.height);
        const tolerance = diff.tolerance || 0;
        const cloudRadius = 5;

        // Find all diff pixels
        const diffPixels = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const aIdx = (y * actual.width + x) * 4;
                const eIdx = (y * expected.width + x) * 4;

                const dr = Math.abs(actual.data[aIdx] - expected.data[eIdx]);
                const dg = Math.abs(actual.data[aIdx + 1] - expected.data[eIdx + 1]);
                const db = Math.abs(actual.data[aIdx + 2] - expected.data[eIdx + 2]);

                if (dr > tolerance || dg > tolerance || db > tolerance) {
                    diffPixels.push({ x, y });
                }
            }
        }

        if (diffPixels.length === 0) return;

        // Create offscreen canvas for clouds to prevent opacity accumulation
        const offscreen = document.createElement('canvas');
        offscreen.width = width;
        offscreen.height = height;
        const offCtx = offscreen.getContext('2d');

        // Draw clouds to offscreen canvas (will accumulate here)
        for (const { x, y } of diffPixels) {
            const gradient = offCtx.createRadialGradient(x, y, 0, x, y, cloudRadius);
            gradient.addColorStop(0, 'rgba(255, 255, 0, 1)');
            gradient.addColorStop(1, 'rgba(255, 255, 0, 0)');
            offCtx.fillStyle = gradient;
            offCtx.fillRect(x - cloudRadius, y - cloudRadius, cloudRadius * 2, cloudRadius * 2);
        }

        // Composite offscreen canvas onto both canvases with limited opacity
        actCtx.globalAlpha = 0.4;
        actCtx.drawImage(offscreen, 0, 0);
        actCtx.globalAlpha = 1.0;

        expCtx.globalAlpha = 0.4;
        expCtx.drawImage(offscreen, 0, 0);
        expCtx.globalAlpha = 1.0;
    }

    renderResultsSummary() {
        const tbody = this.elements.resultsBody;
        tbody.innerHTML = '';

        for (const { test, result } of this.results) {
            const tr = document.createElement('tr');
            const status = result.passed ? 'PASS' : 'FAIL';
            const statusClass = result.passed ? 'tests-result-pass' : 'tests-result-fail';
            let detail = '-';
            if (!result.passed) {
                if (result.error) detail = result.error;
                else if (result.diff) detail = `Step ${(result.step || 0) + 1}, frame ${result.frame}: ${result.diff.diffCount} pixels differ`;
            }
            tr.innerHTML = `
                <td>${this.escapeHtml(test.name)}</td>
                <td class="${statusClass}">${status}</td>
                <td>${this.escapeHtml(detail)}</td>
            `;
            tbody.appendChild(tr);
        }
    }

    abort() {
        this.aborted = true;
        this.previewing = false;
        this.previewPaused = false;
        this.updateStatus('Aborting...');
    }

    // Preview mode - run test file and show live screen with frame counter
    async startPreview() {
        const selected = this.getSelectedTests();
        if (selected.length === 0) {
            this.updateStatus('Select a test to preview');
            return;
        }

        const test = selected[0]; // Preview first selected test
        if (this.running || this.previewing) return;

        // Save current state before any changes
        const savedMachine = this.spectrum.machineType;
        const savedPalette = paletteSelect?.value || 'default';
        const savedFullBorder = this.spectrum.ula.fullBorderMode;
        const savedLateTimings = this.spectrum.lateTimings;
        const wasRunning = this.spectrum.running;

        this.previewing = true;
        this.previewFrameCount = 0;

        try {
            if (wasRunning) this.spectrum.stop();

            // UI updates
            this.elements.btnRunSelected.disabled = true;
            this.elements.btnPreview.disabled = true;
            this.elements.previewSection.classList.remove('hidden');
            this.elements.progressSection.classList.add('hidden');
            this.elements.comparisonSection.classList.add('hidden');
            this.elements.summarySection.classList.add('hidden');
            this.elements.previewFrame.textContent = '0';
            this.updateStatus(`Preview: ${test.name}`);
            // Configure machine
            if (test.machine && test.machine !== this.spectrum.machineType) {
                await this.switchMachine(test.machine);
            }

            if (test.earlyTimings !== undefined) {
                this.spectrum.setEarlyTimings?.(test.earlyTimings);
            }

            if (test.palette && this._deps.applyPalette) {
                this._deps.applyPalette(test.palette);
            }

            // Apply full border mode if specified (default to true for tests)
            const useFullBorder = test.fullBorder !== undefined ? test.fullBorder : true;
            if (this.spectrum.ula.setFullBorder(useFullBorder)) {
                this.spectrum.updateDisplayDimensions();
            }

            // Setup preview canvas (after full border mode is set)
            const dims = this.spectrum.getScreenDimensions();
            const previewCanvas = this.elements.previewCanvas;
            previewCanvas.width = dims.width;
            previewCanvas.height = dims.height;
            const previewCtx = previewCanvas.getContext('2d');

            // Full reset including tape state
            this.spectrum.reset();
            this.spectrum.tapeLoader.rewind();

            // Apply ULAplus AFTER reset (default: disabled)
            // Must be after reset to avoid being cleared
            // Always reset ULA+ first to clear palette from previous tests
            this.spectrum.ula.resetULAplus();
            const enableUlaplus = test.ulaplus === true;
            this.spectrum.ula.ulaplus.enabled = enableUlaplus;
            if (enableUlaplus) {
                this.spectrum.ula.ulaplus.paletteEnabled = true;  // Enable palette mode for tests
            }
            this._deps.updateULAplusStatus?.();

            // Recreate tape trap to ensure clean state
            this.spectrum.tapeTrap = new TapeTrapHandler(
                this.spectrum.cpu,
                this.spectrum.memory,
                this.spectrum.tapeLoader
            );
            this.spectrum.tapeTrap.setEnabled(this.spectrum.tapeTrapsEnabled);

            // Ensure keyboard is fully released
            this.spectrum.ula.keyboardState.fill(0xFF);

            try {
                await this.loadTestFile(test.file, test.zipEntry);
            } catch (loadErr) {
                this.elements.previewInfo.textContent = `Load error: ${loadErr.message}`;
                this.updateStatus(`Load error: ${loadErr.message}`);
                this.previewing = false;
                return;
            }

            // Run frames with live display
            while (this.previewing) {
                // Wait while paused
                while (this.previewPaused && this.previewing) {
                    await new Promise(r => setTimeout(r, 100));
                }
                if (!this.previewing) break;

                // runFrame() does cycle-accurate scanline rendering including border changes
                // and already puts the result on spectrum.ctx.canvas
                this.spectrum.runFrame();
                this.previewFrameCount++;

                // Update frame counter every frame so Copy Frame# is accurate
                this.elements.previewFrame.textContent = this.previewFrameCount;

                // Update canvas every 2 frames for performance
                if (this.previewFrameCount % 2 === 0) {
                    // Use renderAndCaptureScreen for consistent border rendering
                    const frameBuffer = this.spectrum.renderAndCaptureScreen();
                    const imageData = new ImageData(
                        new Uint8ClampedArray(frameBuffer),
                        dims.width,
                        dims.height
                    );
                    previewCtx.putImageData(imageData, 0, 0);
                }

                // Yield to UI every frame so Stop button works
                await new Promise(r => setTimeout(r, 0));
            }

        } catch (err) {
            this.elements.previewInfo.textContent = `Error: ${err.message}`;
            this.updateStatus(`Preview error: ${err.message}`);
            console.error('Preview error:', err);
        } finally {
            // Always reset preview state
            this.previewing = false;
            this.previewPaused = false;

            // Restore machine state FIRST (creates new ULA)
            if (test.machine && test.machine !== savedMachine) {
                await this.switchMachine(savedMachine);
            }
            // Restore full border mode AFTER machine switch (new ULA loses settings)
            if (this.spectrum.ula.setFullBorder(savedFullBorder)) {
                this.spectrum.updateDisplayDimensions();
            }
            // Restore palette if changed
            if (test.palette && this._deps.applyPalette) {
                this._deps.applyPalette(savedPalette);
            }
            // Restore timing settings
            this.spectrum.setLateTimings(savedLateTimings);

            // Always update canvas size after preview (in case dimensions changed)
            this._deps.updateCanvasSize?.();

            // Refresh main canvas after preview ends
            this.spectrum.redraw();

            this.elements.btnRunSelected.disabled = false;
            this.elements.btnPreview.disabled = false;
        }
    }

    togglePausePreview() {
        if (!this.previewing) return;

        this.previewPaused = !this.previewPaused;

        if (this.previewPaused) {
            this.elements.btnPausePreview.textContent = 'Resume';
            this.elements.previewInfo.textContent =
                `Paused at frame ${this.previewFrameCount}. Copy frame#, then Resume or Stop.`;
            this.updateStatus(`Preview paused at frame ${this.previewFrameCount}`);
        } else {
            this.elements.btnPausePreview.textContent = 'Pause';
            this.elements.previewInfo.textContent = 'Running...';
            this.updateStatus(`Preview resumed from frame ${this.previewFrameCount}`);
        }
    }

    async copyFrameCount() {
        const frameCount = this.previewFrameCount;
        try {
            await navigator.clipboard.writeText(frameCount.toString());
            this.elements.previewInfo.textContent =
                `Frame ${frameCount} copied to clipboard!`;
            this.updateStatus(`Frame count ${frameCount} copied`);
        } catch (e) {
            this.elements.previewInfo.textContent =
                `Frame count: ${frameCount} (copy failed, note it manually)`;
        }
    }

    saveScreenshot() {
        const canvas = this.elements.previewCanvas;
        const frameCount = this.previewFrameCount;

        // Get selected test name for filename
        const selected = this.getSelectedTests();
        const testName = selected.length > 0 ? selected[0].id : 'preview';
        const filename = `${testName}_${frameCount}.png`;

        // Create download link and trigger download
        const link = document.createElement('a');
        link.download = filename;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.elements.previewInfo.textContent =
            `Screenshot saved: ${filename}`;
        this.updateStatus(`Screenshot saved: ${filename}`);
    }

    stopPreview() {
        if (!this.previewing) return;

        this.previewing = false;
        this.previewPaused = false;
        this.elements.btnPausePreview.textContent = 'Pause';
        this.elements.previewInfo.textContent =
            `Stopped at frame ${this.previewFrameCount}.`;
        this.updateStatus(`Preview stopped at frame ${this.previewFrameCount}`);

        // Keep preview section visible so user can see the final frame
    }
}

export { TestRunner };
