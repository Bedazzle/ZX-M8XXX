/**
 * ZX-M8XXX - Spectrum Machine Integration
 * @license GPL-3.0
 */

import { getMachineProfile, is128kCompat } from './machines.js';
import { looksLikeMarkup } from './utils.js';
import { normalizeCustomKeys, DEFAULT_CUSTOM_KEYS, kempstonToTimex } from './joystick.js';
import { DebugInstrumentation } from './debug-instrument.js';
import { InputHandling } from './input.js';
import {
    SCREEN_BITMAP, SCREEN_ATTR, SCREEN_END,
    SLOT1_START, SLOT2_START, SLOT3_START,
    PORT_1FFD, PORT_ULAPLUS_REG, PORT_ULAPLUS_DATA,
    PORT_WD_CMD, PORT_WD_TRACK, PORT_WD_SECTOR, PORT_WD_DATA, PORT_WD_SYS,
    PORT_PLUSD_CMD, PORT_PLUSD_TRACK, PORT_PLUSD_SEC, PORT_PLUSD_DATA, PORT_PLUSD_CTRL, PORT_PLUSD_PAGE,
    PORT_PLUSD_PRINT,
    DECODE_128K_MASK, DECODE_PLUS2A_MASK, DECODE_PLUS2A_MASK2,
    DECODE_7FFD_PLUS2A, DECODE_1FFD_PLUS2A,
    DECODE_FDC_MSR, DECODE_FDC_DATA,
    DECODE_AY_MASK, DECODE_AY_REG, DECODE_AY_DATA,
    DECODE_KEMPSTON_MASK, DECODE_KEMPSTON,
    DECODE_P1024_MASK, DECODE_P1024_VAL,
    IF1_PORT_MASK, IF1_PORT_DATA, IF1_PORT_CTL,
    IF1_PAGE_IN_RST8, IF1_PAGE_IN_CLOSE, IF1_PAGE_OUT_ADDR,
    PLUSD_PAGE_IN_RST8, PLUSD_PAGE_IN_KEYNEXT, PLUSD_PAGE_IN_NMI, PLUSD_PAGE_IN_KEYSCAN,
    OPUS_PAGE_IN_RST8, OPUS_PAGE_IN_KEYINT, OPUS_PAGE_IN_CLOSE, OPUS_PAGE_OUT_ADDR,
    OPUS_DRQ_BYTE_TSTATES, OPUS_DRQ_FIRST_TSTATES,
    DIDAKTIK_PAGE_IN_RESET, DIDAKTIK_PAGE_IN_RST8, DIDAKTIK_PAGE_OUT_ADDR,
    DIDAKTIK_PORT_COMMAND, DIDAKTIK_PORT_TRACK, DIDAKTIK_PORT_SECTOR,
    DIDAKTIK_PORT_DATA, DIDAKTIK_PORT_AUX, DIDAKTIK_PORT_AUX_MASK
} from './constants.js';
import { hex8, hex16, storageGet } from './utils.js';
import { fmtAddr, fmtPort } from './addr-format.js';

// Ticks from the start of an I/O instruction to its I/O cycle, keyed by the
// instruction's total length. The two 16T forms differ because OUTI reads memory
// before it writes the port while INI reads the port before it writes memory, so
// the length alone does not say where the cycle is — only the direction does.
// Z80 variants, by the two behaviours software can tell apart. See setCpuVariant.
export const CPU_VARIANT_DEFAULT = 'zilog-nmos';
export const CPU_VARIANTS = {
    'zilog-nmos': { label: 'Zilog NMOS',  xcfMask: 0x28, outVc255: false },
    'zilog-cmos': { label: 'Zilog CMOS',  xcfMask: 0x28, outVc255: true  },
    'nec-nmos':   { label: 'NEC NMOS',    xcfMask: 0x00, outVc255: false },
    'st-cmos':    { label: 'ST CMOS',     xcfMask: 0x20, outVc255: false }
};

const IO_OFFSET_READ  = { 11: 7, 12: 8, 16: 9 };   // IN A,(n) / IN r,(C) / INI
const IO_OFFSET_WRITE = { 11: 7, 12: 8, 16: 12 };  // OUT (n),A / OUT (C),r / OUTI

// Where inside the 4T I/O cycle the data is taken off the bus, which is what the
// floating bus returns. FITTED to ctprobe's P-02 and cross-checked against
// Woodmass's Float48K, not derived — the two agree, which is the point of having
// both. With the I/O cycle starting 7T into IN A,(n), this puts the sample at
// 7 + 4 = 11T, exactly the lateness both instruments measured before.
const IO_CYCLE_READ_T = 4;
import { Z80 } from './z80.js';
import { Memory } from './memory.js';
import { ULA } from './ula.js';
import { AY } from './ay.js';
import {
    TapeLoader, TapePlayer, TZXLoader, WAVLoader, SnapshotLoader,
    TapeTrapHandler, TapeSaveTrapHandler, MicRecorder, buildTZX,
    TRDOSTrapHandler, BetaDisk,
    ZipLoader, RZXLoader, TRDLoader, SCLLoader, SZXLoader, UDILoader,
    MGTLoader, PlusDDisk, MDRLoader, Microdrive,
    OPDLoader, OpusDisk, DidaktikLoader, DidaktikDisk,
    revolutionTStates, byteTStates
} from './loaders.js';
import { UPD765, DSKImage, DSKLoader } from './fdc.js';
import { prepareBeta48Rom } from './beta48.js';
import { HcIf1 } from './hc-if1.js';
import { HcDiskLoader } from './loaders/disk-hc.js';
import { Fdd3000 } from './fdd3000.js';
import { KempstonDisc, KEMPDISC_A6_ROMS, KEMPDISC_128_ROMS } from './kempdisc.js';
import { KdosLoader } from './loaders/disk-kdos.js';
import { parseDck, DCK_BANK_DOCK, DCK_BANK_EXROM } from './timex.js';
import { UartDecoder, MidiAssembler, MIDI_BAUD, MIDI_TX_BIT } from './midi.js';
import { SAA1099, SAA_CLOCK } from './saa1099.js';
import { GeneralSound } from './gs.js';
import { YM2203FM, YM2203Timers } from './ym2203.js';
import { Disassembler } from './disasm.js';

    export class Spectrum {
        constructor(canvas, options = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.overlayCanvas = options.overlayCanvas || null;
            this.overlayCtx = this.overlayCanvas ? this.overlayCanvas.getContext('2d') : null;
            this.zoom = 1;
            this.machineType = options.machineType || '48k';
            this.profile = getMachineProfile(this.machineType);
            this.tapeTrapsEnabled = options.tapeTrapsEnabled !== false;

            this.memory = new Memory(this.machineType);
            this.cpu = new Z80(this.memory);
            this.ula = new ULA(this.memory, this.machineType);
            this.ula.cpu = this.cpu;  // For debug access to CPU state

            // Setup contention
            this.setupContention();
            
            this.tapeLoader = new TapeLoader();
            this.tapePlayer = new TapePlayer();
            this.snapshotLoader = new SnapshotLoader();
            this.tapeEarBit = false;  // EAR input state from tape (bit 6 of port 0xFE)
            this.tapeFlashLoad = true;  // Flash load mode (instant) vs real-time (with border/sound)
            this._turboBlockPending = false;  // Flag for auto-starting turbo block playback
            this._lastTapeUpdate = 0;  // T-state of last tape update (for accurate EAR timing)
            this.tapeTrap = new TapeTrapHandler(this.cpu, this.memory, null);
            this.tapeTrap.setEnabled(this.tapeTrapsEnabled);
            this.tapeSaveTrap = new TapeSaveTrapHandler(this.cpu, this.memory);
            this.tapeSaveTrap.setEnabled(this.tapeTrapsEnabled);
            this.tapeSaveTrap.onBlockSaved = (tapBlock, flag) => {
                this.tapeRecordings[this.activeTapeSlot].push(tapBlock);
            };
            this.micRecorder = new MicRecorder(0);  // tstatesPerFrame set after this.timing init
            this.micRecorder.onBlockRecorded = (block) => {
                this.micRecordings[this.activeTapeSlot].push(block);
            };
            this.trdosTrap = new TRDOSTrapHandler(this.cpu, this.memory);
            this.trdosTrap.setEnabled(this.tapeTrapsEnabled);  // Use same setting as tape traps
            this.betaDisk = new BetaDisk();  // Beta Disk interface (WD1793)
            this.betaDiskEnabled = this.profile.betaDiskDefault;  // Beta Disk enabled by default for Pentagon machines
            this._betaDiskPagingEnabled = false;  // Cached flag for fast updateBetaDiskPaging check
            // Which Beta Disk an add-on Beta is: '128' (TR-DOS 5.x, the default), or
            // a Beta 48 — 'auto' (from its ROM), 'plus' (Beta Disk plus / Vision),
            // 'cbi' (Brazilian CBI-95 / IDS / AR-20). See core/beta48.js.
            this.betaVariant = storageGet('zxm8_betaVariant') || '128';
            this.beta48Info = null;       // what prepareBeta48Rom() made of the ROM
            // TKMEM-128 II on a 48K: 0 (none), 128 or 512 (KB). See Memory.setTkmem.
            this.tkmemSize = parseInt(storageGet('zxm8_tkmem') || '0', 10) || 0;
            // Port decode: 'a14' (A15=0, A14=1, A5=1, A1=0; works with a Beta 48)
            // or 'gal' (A15=0, A5=1, A1=0, exactly as the board's GAL equation)
            this.tkmemDecode = storageGet('zxm8_tkmemDecode') === 'gal' ? 'gal' : 'a14';
            // Timex FDD 3000 disk station (core/fdd3000.js): 48K/128K/+2 only,
            // not with the +D (both on port $EF)
            this.fdd3000 = new Fdd3000();
            this.fdd3000Enabled = storageGet('zxm8_fdd3000') === 'true';
            // Interface ROM: fdd3stavi.rom (Spectrum, the FUSE default) or fdd3timex.rom
            this.fdd3000RomFile = storageGet('zxm8_fdd3000Rom') || 'fdd3stavi.rom';
            this._fdd3000PagingEnabled = false;
            this.memory.fdd3000 = this.fdd3000;
            // Kempston Disc Interface (core/kempdisc.js): K-DOS, a WD1770 on
            // $E5/$E7/$ED/$EF, drive select $DF, ROM in $FD / out $D7; 48K only
            this.kempdisc = new KempstonDisc();
            this.kempdiscEnabled = storageGet('zxm8_kempdisc') === 'true';
            this.kempdiscRomFile = storageGet('zxm8_kempdiscRom') || 'kdos21.rom';
            this._kempdiscEnabledFlag = false;
            this.memory.kempdisc = this.kempdisc;
            this.loadedKempdiscDisks = [null, null, null, null];       // { name, data } per drive
            this.loadedKempdiscDiskFiles = [null, null, null, null];   // the K-DOS directory
            this.memory.setTkmem(this.tkmemSize);
            this._beta48Master = 0;       // last write to a port xxxxxx00
            // CPU turbo: the Z80 runs `_turboMul` times faster than the machine
            // clock (the screen, sound, tape and disks keep theirs). turboHw is
            // what the machine itself has switched on (Scorpion TURBO+: IN from
            // $7FFD / $1FFD); turboForce, from the settings, overrides it (0 =
            // follow the machine).
            this.turboHw = 1;
            this.turboForce = [1, 2, 4].includes(+storageGet('zxm8_turbo')) ? +storageGet('zxm8_turbo') : 0;
            this._turboMul = 1;
            this._turboAcc = 0;

            // µPD765 FDC (ZX Spectrum +3)
            this.fdc = this.profile.hasFDC ? new UPD765() : null;
            this.hcIf1 = null;
            // The HC IF1 came with most HC-2000s, but the machine exists without
            // it too (and an HC-91 ROM runs on it): on by default, switchable
            this.hcIf1Enabled = storageGet('zxm8_hcIf1') !== 'false';
            this._setupHcIf1();

            // AY-3-8910 sound chip
            this.ay = new AY(this.profile.ayClockHz);
            // TurboSound (NedoPC): a second AY on the same ports; OUT ($FFFD),$FF
            // selects chip 0 and $FE chip 1, any other value is a register number
            // for the selected chip. Off by default.
            this.ay2 = new AY(this.profile.ayClockHz);
            this.turboSound = storageGet('zxm8_turboSound') === 'true';
            this._aySel = 0;
            // TurboSound FM (NedoPC TS-FM, as Unreal-NG): the two AYs become two
            // YM2203s -- the AY is their SSG half, core/ym2203.js their FM half.
            // OUT $FFFD,%11111xyz: z chip ($FF/$FE as TurboSound), y=0 status
            // reads on IN $FFFD, x=0 FM on. An address >= $10 is an FM register.
            this.tsfm = storageGet('zxm8_tsfm') === 'true';
            this.fm = [new YM2203FM(), new YM2203FM()];
            this.fmTimers = [new YM2203Timers(), new YM2203Timers()];
            this._fmAddr = [0, 0];
            this._fmStatusRead = false;
            this._fmOn = true;
            this._fmT = 0;
            this.fmChanges = [];
            this.ay2StateSnapshot = null;
            // DAC: 'none' | 'covox' (one port, settable, $FB by default) |
            // 'specdrum' ($DF) | Soundrive 1.05, set by jumper to one of two port
            // sets: 'soundrive1' ($0F/$1F left, $4F/$5F right) or 'soundrive2'
            // ($F1/$F3 left, $F9/$FB right). Four 8-bit channels, $80 = silence;
            // writes are kept per frame with their T-state, as the beeper's are.
            this.dacType = storageGet('zxm8_dacType') || 'none';
            if (this.dacType === 'soundrive') this.dacType = 'soundrive1';
            this.covoxPort = parseInt(storageGet('zxm8_covoxPort') || 'FB', 16) & 0xFF;
            // 'stereocovox': two ports, left and right (both settable; $0F/$4F
            // by default, Soundrive mode 1's left and right channels)
            this.stereoCovoxPorts = [
                parseInt(storageGet('zxm8_stereoCovoxL') || '0F', 16) & 0xFF,
                parseInt(storageGet('zxm8_stereoCovoxR') || '4F', 16) & 0xFF];
            this.dacLevels = [0x80, 0x80, 0x80, 0x80];
            this.dacChanges = [];
            this._dacStart = this.dacLevels.slice();
            // SAA1099 (ZXM-SoundCard, as in Xpeccy / Unreal Speccy): $01FF
            // selects a register, $00FF writes it. The writes are kept per frame
            // with their T-state and played into the chip by the audio, which
            // owns its state (core/saa1099.js).
            this.saa = new SAA1099();
            this.saaOn = storageGet('zxm8_saa') === 'true';
            this.saaChanges = [];
            // General Sound (core/gs.js): its own Z80 at 12 MHz, ports $BB/$B3.
            // The ROM (gs104 / gs105a / gs105b) is loaded by the UI.
            this.gs = new GeneralSound(parseInt(storageGet('zxm8_gsRam') || '512', 10));
            this.gsOn = storageGet('zxm8_gs') === 'true';
            this.gsRomFile = storageGet('zxm8_gsRom') || 'gs105b.rom';
            // 128 MIDI out (core/midi.js): AY R14 bit 2 at 31250 baud, decoded
            // into MIDI messages for onMidiMessage (Web MIDI in the UI)
            this.midiEnabled = false;
            this.onMidiMessage = null;
            this.midiBytes = 0;
            this.midiLog = [];            // the last bytes, for a monitor
            this._midiLevel = 1;
            this.ayEnabled = this.profile.ayDefault;  // AY enabled by default for 128K/Pentagon
            this.ay48kEnabled = false;  // Optional AY for 48K (like Melodik interface)
            this.aySelectedRegister = 0;

            // Audio manager (initialized on user interaction due to browser autoplay policy)
            this.audio = null;
            // True while automated tests run: no samples are generated. It lives here,
            // not on this.audio, because the audio is created lazily on the first
            // click -- which can be the click that starts the tests.
            this.audioSuppressed = false;

            // Beeper state tracking for audio generation
            this.beeperChanges = [];      // Array of {tStates, level} for frame
            this.beeperLevel = 0;         // Current beeper output level (0 or 1)

            // AY register write tracking for audio generation. Writes are timestamped
            // (frame-relative T-state) and replayed in processFrame so intra-frame
            // volume changes — digitized speech / sample playback via R8-R10 — are
            // reproduced instead of being collapsed to the last value of the frame.
            this.ayChanges = [];          // Array of {tStates, reg, value} for frame
            this.ayStateSnapshot = null;  // AY state at frame start (replay baseline)

            // Tape audio setting (enable loading sounds)
            this.tapeAudioEnabled = true;
            
            this.cpu.portRead = this.portRead.bind(this);
            this.cpu.portWrite = this.portWrite.bind(this);
            
            this.timing = this.ula.getTiming();
            this.micRecorder.setTstatesPerFrame(this.timing.tstatesPerFrame);
            this.frameInterval = null;
            this.running = false;
            this.lastFrameTime = 0;
            this.frameCount = 0;
            this.totalFrames = 0;       // Monotonic frame counter (never reset, for port I/O log)
            // The disk clock's whole-frames part, advanced wherever a frame is
            // subtracted from cpu.tStates so that diskClockNow() only ever moves
            // forward. NOT totalFrames * tstatesPerFrame — see diskClockNow().
            this._diskClockBase = 0;
            this.actualFps = 0;
            
            this.updateDisplayDimensions();

            this.romLoaded = false;
            this.overlayMode = 'none';  // Overlay mode: none, grid, screen, reveal
            this.onFrame = null;        // Single primary per-frame callback (legacy)
            this.frameListeners = [];   // Additional per-frame listeners (addFrameListener)
            this.onRomLoaded = null;
            this.onError = null;
            this.onBreakpoint = null; // Called when breakpoint hit
            this.onCodePathHit = null; // Called when code path trace diverges
            this.breakpointTStates = 0; // T-states accumulated since last breakpoint
            this._bpTStatesResetPending = false; // Deferred reset: stays visible until next action
            this._debugCallStack = []; // Runtime call stack: [{addr, caller}] tracked via SP changes
            this._debugCallStackMaxDepth = 32; // Max tracked depth
            this.pendingSnapCallback = null; // Called at next frame boundary for safe snapshots
            
            // Speed control (100 = normal, 0 = max)
            this.speed = 100;
            this.rafId = null;

            // Late timing model (affects ULA timing including INT, floating bus, contention)
            // Early = cold ULA, Late = warm ULA
            // Real hardware drifts from early to late as ULA warms up
            // Floating bus: +1 T-state offset in late mode
            // INT timing: +1 T-state in late mode (INT pulse starts at T=1 instead of T=0)
            // This causes CPU halted at T=0 to run one more HALT NOP before seeing INT
            this.lateTimings = true;  // Late timing (default - warmed ULA)
            this.INT_LATE_OFFSET = 1;  // Late INT timing offset (1 T-state)
            this._intDebugCount = 0;   // Debug counter for INT timing
            this._floatBusLogCount = 0; // Debug counter for floating bus
            this.debugFloatingBus = false; // Enable floating bus debug logging
            this._floatBusLogActive = false; // Only log after first halted INT (test running)
            this.debugBorderOut = false; // Border OUT timing debug logging
            this.lastDebugBorderColor = -1; // Track last logged border color
            this.pendingIntTstates = 0; // INT tstates to add at frame start
            this.INT_PULSE_DURATION = 32;  // INT signal active for 32 T-states (48K) or 36 (128K)
            this.pendingInt = false;   // INT waiting to fire
            this.pendingIntAt = 0;     // T-state when pending INT should fire
            this.pendingIntEnd = 0;    // T-state when pending INT pulse ends
            this._debugIntTiming = false; // Debug: log INT timing to console
            this.frameStartOffset = 0; // T-state overshoot at frame start (for border timing)
            this.accumulatedContention = 0; // Accumulated contention delays for ULA timing

            // Unified trigger system - replaces separate breakpoints/watchpoints/port breakpoints
            // Trigger types: 'exec', 'read', 'write', 'rw', 'port_in', 'port_out', 'port_io',
            //                'tape_block', 'disk_read', 'disk_sector'
            this.triggers = [];
            this.triggerHit = false;
            this.lastTrigger = null; // {trigger, addr, val, port, direction}
            this.onTrigger = null; // Unified callback for all trigger types
            // Fast O(1) lookup Set for exec breakpoints (rebuilt when triggers change)
            this.execBreakpointSet = new Set();
            // Fast O(1) lookup Sets for screen region write breakpoints
            this.screenNormalBitmapSet = new Set();
            this.screenNormalAttrSet = new Set();
            this.screenShadowBitmapSet = new Set();
            this.screenShadowAttrSet = new Set();
            this._hasScreenTriggers = false;

            // Legacy arrays - now views into unified triggers for backward compatibility
            this.breakpoints = [];
            this.breakpointHit = false;

            this.portBreakpoints = [];
            this.portBreakpointHit = false;
            this.lastPortBreakpoint = null;

            this.watchpoints = [];
            this.watchpointHit = false;
            this._suppressWatchpoints = false; // Suppress during trace pre-reads and diagnostic reads
            this._inCpuExecution = false; // True only during cpu.execute()/cpu.step() — gates read watchpoints
            this._currentInstrPC = 0; // PC of currently executing instruction (for watchpoint reporting)
            this.lastWatchpoint = null;
            this.onWatchpoint = null;
            this.onPortBreakpoint = null;

            // Tape/disk trigger hit flags
            this.tapeBlockHit = false;
            this.diskTriggerHit = false;

            this.onInstructionExecuted = null; // Called after each instruction (for xref tracking)
            this.xrefTrackingEnabled = false; // Enable xref runtime tracking
            this.onBeforeStep = null; // Called before each instruction (for trace recording)
            this.traceEnabled = false; // Enable execution trace recording (stepping)
            this.runtimeTraceEnabled = false; // Enable trace during full-speed execution
            this.tracePortOps = []; // Port operations during current instruction
            this.traceMemOps = []; // Memory write operations during current instruction
            this.traceMemOpsLimit = 8; // Max memory ops to record per instruction
            this.haltTraced = false; // Track if current HALT state has been traced

            // Media storage for project save/load — multi-tape slots and per-drive disk state
            this.loadedTapes = [null, null];        // Per-slot { type, data, name }
            this.activeTapeSlot = 0;
            this.tapeSlotStates = [null, null];     // Per-slot { loaderBlock, playerBlock }
            this.tapeRecordings = [[], []];         // Per-slot arrays of TAP block Uint8Arrays
            this.micRecordings = [[], []];          // Per-slot arrays of MIC-recorded { pulses, initialLevel }
            this.loadedBetaDisks = [null, null, null, null];  // Per-drive { data: Uint8Array, name: string }
            this.loadedFDCDisks = [null, null];               // Per-drive { data: Uint8Array, name: string }
            this.loadedBetaDiskFiles = [null, null, null, null];  // Per-drive file listings for Beta Disk
            this.loadedFDCDiskFiles = [null, null];               // Per-drive file listings for FDC
            this.loadedPlusDDisks = [null, null];                 // Per-drive { data: Uint8Array, name: string }
            this.loadedPlusDDiskFiles = [null, null];             // Per-drive file listings for +D

            // +D (DISCiPLE/+D) interface
            this.plusD = new PlusDDisk();
            this.plusDEnabled = false;
            this._plusDPagingEnabled = false;
            // DISCiPLE: the same WD1772 model, other ports and paging
            this.disciple = new PlusDDisk();
            this.discipleEnabled = false;
            this._disciplePagingEnabled = false;

            // Interface 1 (Microdrive)
            this.microdrive = new Microdrive();
            this.if1Enabled = false;
            this._if1PagingEnabled = false;
            this._if1PageOutPending = false;
            this.loadedIF1Cartridges = new Array(8).fill(null);   // Per-drive { data: Uint8Array, name: string }
            this.loadedIF1CartridgeFiles = new Array(8).fill(null); // Per-drive file listings

            // Opus Discovery
            this.opus = new OpusDisk();
            this.opusEnabled = false;
            this._opusPagingEnabled = false;
            this.loadedOpusDisks = [null, null];                 // Per-drive { data: Uint8Array, name: string }
            this.loadedOpusDiskFiles = [null, null];             // Per-drive file listings
            // The Opus transfers sector data by NMI, not by polling: DRQ is wired
            // to the Z80's NMI line. Our FDC has no timing of its own — a command
            // completes instantly — so the delay has to be added here, or the NMI
            // lands on the instruction after the command write and preempts the
            // ROM before it has set up the transfer. Real figures: MFM at
            // 250 kbit/s is one byte every 32us, which is 112 T-states at 3.5 MHz;
            // the first byte also waits for the head to settle and the sector to
            // come round.
            // Didaktik 80
            this.didaktik = new DidaktikDisk();
            this.didaktikEnabled = false;
            // The 48-to-128K hardware patch some upgrade services fitted, which
            // is what let a D40/D80 drive a 128K at all. Off by default: a STOCK
            // 128K cannot do this. See _didaktikMachineOk().
            this.didaktik128Patch = false;
            this._didaktikPagingEnabled = false;
            this.loadedDidaktikDisks = [null, null];
            this.loadedDidaktikDiskFiles = [null, null];
            // Both the FDC's DRQ and its INTRQ can pull NMI, each gated by a bit
            // of the aux register. Same instant-FDC problem as the Opus, so the
            // same delay applies.
            this._didaktikNmiPending = false;
            this._didaktikDrqDue = 0;
            this.didaktik.onDataRequest = (first) => {
                this._didaktikNmiPending = true;
                this._didaktikDrqDue =
                    this._drqDueAt(this._didaktikDrqDue, first, this.didaktik);
            };
            this.didaktik.onIntRequest = () => {
                this._didaktikNmiPending = true;
                // Command completion, not a byte of a stream: a one-off delay.
                this._didaktikDrqDue = this.diskClockNow() + this.diskByteTStates();
            };

            this._opusNmiPending = false;
            this._opusDrqDue = 0;
            this.opus.onDataRequest = (first) => {
                this._opusNmiPending = true;
                this._opusDrqDue =
                    this._drqDueAt(this._opusDrqDue, first, this.opus);
            };
            // The Opus registers live in the memory map, so Memory needs the
            // controller itself, not just a ROM image.
            this.memory.opusDisk = this.opus;
            this.memory.fdd3000 = this.fdd3000;
            this.memory.kempdisc = this.kempdisc;

            // Every WD17xx here gets the disk's own clock, now that all four
            // exist. Without it a controller has no rotation and falls back to
            // faking an index pulse — see setRotationClock().
            this._wireDiskRotation();

            // Callback for processing TRD data before loading (used for boot injection)
            this.onBeforeTrdLoad = null; // function(data, filename) => processedData

            // Auto memory mapping - tracks executed/read/written addresses
            this.autoMap = {
                enabled: false,
                inExecution: false,    // Only track during actual CPU execution
                // Maps store: key -> count (key format: "addr" or "addr:page")
                executed: new Map(),   // Instruction fetch addresses
                read: new Map(),       // Non-fetch read addresses
                written: new Map(),    // Written addresses
                currentFetchAddrs: new Set(), // Addresses fetched in current instruction
                // Fast mode: flat 16-bit touched bitsets instead of the Map<key,count>.
                // ~10x cheaper per access (a byte write vs Map.set of a string key), at
                // the cost of counts and page granularity — for long RZX playthroughs
                // where only coverage (code vs data) matters. Allocated on demand.
                fast: false,
                execBits: null,        // Uint8Array(0x10000) | null
                readBits: null,
                writeBits: null,
                // Paged fast mode: like fast, but keeps a separate touched-bitset triple
                // per memory page (keyed by the same label getAutoMapKey uses), so a
                // bank-switching game maps correctly instead of unioning all banks into
                // one flat 16-bit space. Still counts-free. The hot path resolves the
                // current page via a cheap paging signature cache (_pgSig/_pgSlots) so it
                // only builds a label / touches the Map when paging actually changes.
                paged: false,
                pagedBits: new Map(),  // label -> { execBits, readBits, writeBits } (lazy)
                _pgSig: -1,            // last paging signature (invalidates _pgSlots)
                _pgSlots: [null, null, null, null] // cached triple per 16K slot
            };

            // Indirect-jump resolution: records the runtime targets of `JP (HL)` /
            // `JP (IX)` / `JP (IY)` — the dispatch-table / state-machine edges that
            // static disassembly (Ghidra) can't resolve. site PC → {kind, targets}.
            this.indirectJumps = {
                enabled: false,
                sites: new Map()   // sitePC -> { kind, targets: Map<targetPC, count> }
            };

            // Runtime call graph: observed caller→callee edges from CALL/RST (incl.
            // self-modified CALL targets and remapped RST vectors static tools miss).
            this.callGraph = {
                enabled: false,
                edges: new Map()   // callerPC -> Map<calleePC, count>
            };

            // Write provenance: records, for writes landing in a watched range,
            // which instruction PC did the write (+ its call stack) and how often.
            // A first-class, range-scoped replacement for hand-wrapping the write
            // callback — fast enough for a full RZX replay (work only in-range).
            this.writeProvenance = {
                enabled: false,
                lo: 0,
                hi: -1,
                byPc: new Map()        // pc -> { count, callers:[addr] }
            };

            // Same, for reads of a range ("who consumes this data block?") and for
            // execution inside a range ("what runs here, and who called it?").
            this.readProvenance = { enabled: false, lo: 0, hi: -1, byPc: new Map() };
            this.execProvenance = { enabled: false, lo: 0, hi: -1, byPc: new Map() };

            // And for port reads, keyed by (pc, port) rather than pc alone —
            // see startPortReadProvenance in core/debug-instrument.js.
            this.portReadProvenance = {
                enabled: false, port: null, mask: 0x00FF,
                limit: 4096, truncated: false, byKey: new Map()
            };

            // Runtime behavior profiler - tracks per-subroutine behavior for auto-labeling
            this.profiler = {
                enabled: false,
                maxFrames: 200,
                framesRemaining: 0,
                startFrame: 0,
                subroutines: new Map(),   // autoMapKey → SubroutineStats
                onComplete: null,         // callback(results)
                im2: null,               // { handlerAddr, vectorTableAddr, iReg } — detected IM 2 info
                tStatesPerPC: new Map()   // autoMapKey → total T-states spent (hotspot detection)
            };

            // POKE write trace (blacklist collection for POKE search)
            this.pokeWriteTraceEnabled = false;
            this.pokeWriteTraceAddrs = null;  // Set<number> when active

            // Write monitor (collision finder)
            this.writeMonitor = {
                enabled: false,
                addr: -1,       // address to watch
                hits: []        // { pc, callStack, oldVal, newVal, frame }
            };

            // Read monitor (collision detection finder)
            this.readMonitor = {
                enabled: false,
                addr: -1,       // address to watch
                hits: []        // { pc, callStack, val, frame }
            };

            // Memory freeze: rewrite locked addresses at frame end
            this.frozenAddresses = [];  // array of { addr, value }

            // Comparison breakpoint: break when (addrA) op (addrB) becomes true
            this.comparisonBreakpoint = {
                enabled: false, addrA: -1, addrB: -1,
                op: '==',  // ==, !=, <, >, <=, >=
                hit: false
            };

            // Register tracker: log register value when PC hits a specific address
            this.registerTracker = {
                enabled: false, pc: -1, register: 'A',
                values: [],  // { value, frame }
                maxSamples: 10000
            };

            // Struct mapper: monitor reads/writes at offsets from a base address
            this.structMapper = {
                enabled: false, baseAddr: 0, baseReg: null,  // 'IX'|'IY'|null
                maxOffset: 255,
                fields: new Map()  // offset → { reads: Map<pc,count>, writes: Map<pc,count> }
            };

            // RZX playback state
            this.rzxPlayer = null;      // RZXLoader instance
            this.rzxFrame = 0;          // Current frame number
            this.rzxPlaying = false;    // Whether RZX playback is active
            this.rzxData = null;        // Original RZX file data for project save
            this.rzxInstructions = 0;   // Instruction count into current RZX frame
            this.rzxFrameStartInstr = 0; // CPU instruction count at start of emu frame
            this.rzxFirstInterrupt = true; // Skip first frame advance after snapshot
            this.onRZXEnd = null;       // Callback when playback ends
            this.rzxRecentInputs = [];  // Recent RZX inputs for debug display
            this.rzxLastPort = 0;       // Last port read for RZX
            this.rzxDebugAddr = 0;      // Address to log during RZX (0=disabled, e.g. 0x8F8C for RNG)
            this.rzxDebugFrames = 0;    // Log detailed info for first N frames (0=disabled)
            this.rzxDebugLog = [];      // Collected debug info for export
            this.portLog = [];          // Port I/O log for debugging
            this.portLogEnabled = false; // Whether to log port I/O
            this.portTraceFilters = [];  // Array of {port, mask} — empty = trace all

            // RZX recording state
            this.rzxRecording = false;      // Whether RZX recording is active
            this.rzxRecordPending = false;  // Recording starts at next frame boundary
            this.rzxRecordedFrames = [];    // Array of {fetchCount, inputs: []}
            this.rzxRecordCurrentFrame = null; // Current frame being recorded
            this.rzxRecordStartInstr = 0;   // CPU instruction count at start of recording frame
            this.rzxRecordTstates = 0;      // T-state position when recording started
            this.rzxRecordSnapshot = null;  // Initial snapshot (Uint8Array)
            this.rzxRecordSnapshotType = 'szx'; // Snapshot format (SZX preserves halted state)

            // Kempston joystick state (active high)
            // Bit 0: Right, Bit 1: Left, Bit 2: Down, Bit 3: Up, Bit 4: Fire
            this.kempstonState = 0;
            // Which joystick the numpad/gamepad pretends to be. Sinclair and
            // Cursor are keyboard interfaces, so they press ZX keys instead of
            // feeding the Kempston port.
            this.joystickType = 'kempston';
            this.joystickCustomKeys = normalizeCustomKeys(DEFAULT_CUSTOM_KEYS);
            // Fitted by default: the port now reads as an empty slot when it isn't,
            // and a Kempston game that skips detection would see every direction held.
            this.kempstonEnabled = true;

            // Kempston Mouse state
            // Ports: FADF=buttons, FBDF=X, FFDF=Y
            // Buttons: bits 0-2 = right/left/middle (active low), bits 4-7 = wheel (0-15)
            this.kempstonMouseX = 0;
            this.kempstonMouseY = 0;
            this.kempstonMouseButtons = 0x07; // Buttons released (bits 0-2 high), wheel at 0
            this.kempstonMouseWheel = 0; // Wheel position 0-15
            this.kempstonMouseEnabled = false;
            this.kempstonMouseWheelEnabled = false;
            this.kempstonMouseSwapButtons = false; // Swap left/right buttons (bit0↔bit1)
            this.kempstonMouseSwapWheel = false; // Invert wheel direction

            // Extended Kempston Joystick (bits 5-7: C, A, Start buttons)
            this.kempstonExtendedEnabled = false;
            this.kempstonExtendedState = 0; // Bits 5,6,7 for extra buttons

            // Hardware Gamepad support
            this.gamepadEnabled = false;
            this.gamepadIndex = null; // Connected gamepad index
            this.gamepadState = 0;    // Gamepad joystick state (separate from keyboard)
            this.gamepadExtState = 0; // Gamepad extended button state
            // Custom gamepad mapping (null = use default, otherwise { up: {type, index, threshold}, ... })
            this.gamepadMapping = null;

            // External access hooks (headless automation): fire on every CPU opcode
            // fetch / memory read / memory write, independent of any monitor. A
            // documented registration point (setAccessHooks) so drivers don't have to
            // wrap the live cpu.onFetch / memory.onRead — those are managed and null
            // unless a feature needs them (see updateMemoryCallbacksFlag). Each hook
            // gets (addr[, val]) and may read spectrum state (cpu.pc, memory
            // currentRamBank, …) synchronously.
            this._accessHooks = { fetch: null, read: null, write: null };

            // Memory/CPU callback functions (stored for enable/disable)
            this._memoryReadCallback = (addr, val) => {
                if (this._accessHooks.read) this._accessHooks.read(addr, val);
                // Auto-map: track non-fetch reads (only during CPU execution)
                if (this.autoMap.enabled && this.autoMap.inExecution) {
                    if (this.autoMap.paged) {
                        this._pagedTripleForAddr(addr).readBits[addr & 0xFFFF] = 1;
                    } else if (this.autoMap.fast) {
                        this.autoMap.readBits[addr & 0xFFFF] = 1;
                    } else if (!this.autoMap.currentFetchAddrs.has(addr)) {
                        const key = this.getAutoMapKey(addr);
                        this.autoMap.read.set(key, (this.autoMap.read.get(key) || 0) + 1);
                    }
                }
                // Read provenance: which instruction read from the watched range
                if (this.readProvenance.enabled && addr >= this.readProvenance.lo && addr <= this.readProvenance.hi) {
                    this._noteProvenance(this.readProvenance, this._currentInstrPC);
                }
                // Profiler: track screen reads
                if (this.profiler.enabled && (addr >= SCREEN_BITMAP && addr <= SCREEN_END)) {
                    const sub = this._profilerCurrentSub();
                    if (sub) {
                        const skey = this.getAutoMapKey(sub.addr);
                        const stats = this.profiler.subroutines.get(skey);
                        if (stats) {
                            if (addr < SCREEN_ATTR) stats.readsScreenBitmap = true;
                            else stats.readsScreenAttr = true;
                        }
                    }
                }
                // Read monitor: capture reads from watched address
                if (this.readMonitor.enabled && this._inCpuExecution && !this.cpu.isFetching && addr === this.readMonitor.addr) {
                    this.readMonitor.hits.push({
                        pc: this._currentInstrPC,
                        callStack: this._debugCallStack.map(e => ({addr: e.addr, caller: e.caller, isInt: e.isInt || false})),
                        val: val,
                        frame: this.totalFrames
                    });
                }
                // Struct mapper: track reads at offsets from base
                if (this.structMapper.enabled && this._inCpuExecution && !this.cpu.isFetching) {
                    const base = this._getStructBase();
                    const offset = (addr - base) & 0xFFFF;
                    if (offset < this.structMapper.maxOffset) {
                        let field = this.structMapper.fields.get(offset);
                        if (!field) { field = { reads: new Map(), writes: new Map() }; this.structMapper.fields.set(offset, field); }
                        const pc = this._currentInstrPC;
                        field.reads.set(pc, (field.reads.get(pc) || 0) + 1);
                    }
                }
                if (this.triggers.length > 0 && this._inCpuExecution && !this.cpu.isFetching && !this._suppressWatchpoints) this.checkReadWatchpoint(addr, val);
            };
            this._memoryWriteCallback = (addr, val) => {
                if (this._accessHooks.write) this._accessHooks.write(addr, val);
                // Auto-map: track writes (only during CPU execution)
                if (this.autoMap.enabled && this.autoMap.inExecution) {
                    if (this.autoMap.paged) {
                        this._pagedTripleForAddr(addr).writeBits[addr & 0xFFFF] = 1;
                    } else if (this.autoMap.fast) {
                        this.autoMap.writeBits[addr & 0xFFFF] = 1;
                    } else {
                        const key = this.getAutoMapKey(addr);
                        this.autoMap.written.set(key, (this.autoMap.written.get(key) || 0) + 1);
                    }
                }
                // Write provenance: which instruction wrote into the watched range
                if (this.writeProvenance.enabled && addr >= this.writeProvenance.lo && addr <= this.writeProvenance.hi) {
                    this._noteProvenance(this.writeProvenance, this._currentInstrPC);
                }
                // Profiler: track screen writes
                if (this.profiler.enabled && (addr >= SCREEN_BITMAP && addr <= SCREEN_END)) {
                    const sub = this._profilerCurrentSub();
                    if (sub) {
                        const skey = this.getAutoMapKey(sub.addr);
                        const stats = this.profiler.subroutines.get(skey);
                        if (stats) {
                            if (addr < SCREEN_ATTR) stats.writesScreenBitmap = true;
                            else stats.writesScreenAttr = true;
                        }
                    }
                }
                // Trace: track memory writes (runtime or step tracing)
                if ((this.runtimeTraceEnabled || this.traceEnabled) &&
                    this.traceMemOps.length < this.traceMemOpsLimit) {
                    this.traceMemOps.push({ addr, old: this.memory.read(addr), val });
                }
                // POKE write trace: collect written addresses for blacklist
                if (this.pokeWriteTraceEnabled) {
                    this.pokeWriteTraceAddrs.add(addr);
                }
                // Write monitor: capture writes to watched address
                if (this.writeMonitor.enabled && addr === this.writeMonitor.addr) {
                    this.writeMonitor.hits.push({
                        pc: this._currentInstrPC,
                        callStack: this._debugCallStack.map(e => ({addr: e.addr, caller: e.caller, isInt: e.isInt || false})),
                        oldVal: this.memory.read(addr),
                        newVal: val,
                        frame: this.totalFrames
                    });
                }
                // Comparison breakpoint: check when either watched address is written
                if (this.comparisonBreakpoint.enabled &&
                    (addr === this.comparisonBreakpoint.addrA || addr === this.comparisonBreakpoint.addrB)) {
                    this._checkComparisonBreakpoint();
                }
                // Struct mapper: track writes at offsets from base
                if (this.structMapper.enabled && this._inCpuExecution) {
                    const base = this._getStructBase();
                    const offset = (addr - base) & 0xFFFF;
                    if (offset < this.structMapper.maxOffset) {
                        let field = this.structMapper.fields.get(offset);
                        if (!field) { field = { reads: new Map(), writes: new Map() }; this.structMapper.fields.set(offset, field); }
                        const pc = this._currentInstrPC;
                        field.writes.set(pc, (field.writes.get(pc) || 0) + 1);
                    }
                }
                // Screen region write breakpoints
                if (this._hasScreenTriggers && !this._suppressWatchpoints) {
                    if (this.screenNormalBitmapSet.has(addr) || this.screenNormalAttrSet.has(addr)) {
                        this._checkScreenTrigger(addr, val, false);
                    } else if ((this.screenShadowBitmapSet.has(addr) || this.screenShadowAttrSet.has(addr)) &&
                               this._isWritingToPage7(addr)) {
                        this._checkScreenTrigger(addr, val, true);
                    }
                }
                // Multicolor: disabled (known limitation - see README)
                if (this.triggers.length > 0 && !this._suppressWatchpoints) this.checkWriteWatchpoint(addr, val);
            };
            this._cpuFetchCallback = (addr) => {
                if (this._accessHooks.fetch) this._accessHooks.fetch(addr);
                // Exec provenance: an instruction fetched inside the watched range —
                // record the instruction's own address and who called it
                if (this.execProvenance.enabled && addr >= this.execProvenance.lo && addr <= this.execProvenance.hi) {
                    this._noteProvenance(this.execProvenance, addr);
                }
                if (this.autoMap.enabled && this.autoMap.inExecution) {
                    if (this.autoMap.paged) {
                        this._pagedTripleForAddr(addr).execBits[addr & 0xFFFF] = 1;
                    } else if (this.autoMap.fast) {
                        this.autoMap.execBits[addr & 0xFFFF] = 1;
                    } else {
                        const key = this.getAutoMapKey(addr);
                        this.autoMap.executed.set(key, (this.autoMap.executed.get(key) || 0) + 1);
                        this.autoMap.currentFetchAddrs.add(addr);
                    }
                }
                if (this.codePath.enabled) {
                    this.codePath.executed.add(this.getAutoMapKey(addr));
                }
                if (this.execTrace.enabled) {
                    const t = this.execTrace;
                    // onFetch fires for every byte read through PC, operands
                    // included — the auto-map wants that, a divergence trace does
                    // not. _instrByteCount is 0 only at the opcode fetch, so this
                    // is one entry per instruction and the index means something.
                    if (this.cpu._instrByteCount === 0 &&
                        (!t.filtered || (addr >= t.lo && addr <= t.hi))) {
                        if (t.count < t.limit) {
                            // The paged bank rides in the high bits: two runs that
                            // reach the same address through different paging have
                            // not agreed, and a bare PC would say they had
                            t.pcs[t.count++] = ((this.memory.currentRamBank & 0xFF) << 16) | addr;
                        } else {
                            t.truncated = true;
                        }
                    }
                }
                if (this.codePath.tracing) {
                    const key = this.getAutoMapKey(addr);
                    if (!this.codePath.baselineSet.has(key)) {
                        this.codePath.traceHit = true;
                        this.codePath.traceAddr = addr;
                    }
                }
                if (this.registerTracker.enabled && addr === this.registerTracker.pc) {
                    this._captureRegisterValue();
                }
            };

            // Ordered execution trace, for a differential run. The Code Path tool
            // records a *set* of executed addresses, which answers what a run
            // reached but not where two runs parted company — a set has no order.
            this.execTrace = {
                enabled: false,
                pcs: null,        // Uint32Array: (bank << 16) | pc
                count: 0,
                limit: 0,
                truncated: false,
                lo: 0, hi: 0xFFFF,   // only record fetches in this range
                filtered: false,
            };

            this.codePath = {
                enabled: false,
                executed: null,       // Set<string> of autoMapKeys when recording
                tracing: false,       // true when trace-break mode active
                baselineSet: null,    // Set<string> — baseline to compare against
                traceHit: false,      // flag checked in runFrame()
                traceAddr: 0          // PC that triggered the break
            };

            // Start with callbacks disabled (null = no overhead)
            this.memory.onRead = null;
            this.memory.onWrite = null;
            this.cpu.onFetch = null;

            this.boundKeyDown = this.handleKeyDown.bind(this);
            this.pressedKeys = new Map(); // Track e.code → e.key for proper release
            this.boundKeyUp = this.handleKeyUp.bind(this);
            this.keyboardHandlersRegistered = false;
        }

        // ========== Initialization ==========

        async init(romUrl) {
            try {
                if (romUrl) await this.loadRom(romUrl);
                this.reset();
                return true;
            } catch (e) {
                if (this.onError) this.onError(e);
                return false;
            }
        }
        
        async loadRom(source, bank = 0) {
            let data;
            if (typeof source === 'string') {
                const response = await fetch(source);
                if (!response.ok) throw new Error(`Failed to load ROM: ${response.status}`);
                data = await response.arrayBuffer();
            } else {
                data = source;
            }
            this.memory.loadRom(data, bank);
            this.romLoaded = true;
            if (this.onRomLoaded) this.onRomLoaded();
        }

        // Get ROM checksum for verification (call from console: spectrum.getRomChecksum())
        getRomChecksum() {
            let sum = 0;
            const romSize = this.profile.romSize;
            for (let i = 0; i < romSize; i++) {
                sum = (sum + this.memory.read(i)) & 0xFFFFFFFF;
            }
            // Also compute first 256 bytes separately (useful for quick check)
            let first256 = 0;
            for (let i = 0; i < 256; i++) {
                first256 = (first256 + this.memory.read(i)) & 0xFFFF;
            }
            console.log(`ROM checksum: full=${sum.toString(16)} first256=${first256.toString(16)} size=${romSize}`);
            console.log(`ROM[0x38]=${this.memory.read(0x38).toString(16)} (should be F5 for 48K)`);
            return { full: sum, first256, size: romSize };
        }

        // ========== Debug Properties ==========

        get debugIntTiming() { return this._debugIntTiming; }
        set debugIntTiming(val) {
            this._debugIntTiming = val;
            if (this.cpu) this.cpu.debugInterrupts = val;
        }

        // ========== Memory & Contention ==========

        setupContention() {
            // Machines without contention (Pentagon, Pentagon 1024, Scorpion)
            // Still need cycle-accurate write tracking for multicolor effects
            if (!this.profile.hasContention) {
                this.contentionFunc = null;
                this.cpu.ioContend = null;
                this.contentionEnabled = false;

                // Track M-cycle position within instruction (same as contended machines,
                // but without contention delays). This gives accurate write T-states for
                // multicolor effects like Eye Ache.
                let mcycleOffset = 0;
                let isFirstAccess = true;

                // Even M1 (Scorpion): the machine holds an opcode fetch from RAM
                // until an even T-state, so an instruction run from RAM takes its
                // length rounded UP to an even number -- LD A,n is 8, not 7. The wait
                // belongs to the fetch, so it lands on the next instruction's first
                // M1; that is what makes every span come out even. ROM is not held.
                const evenM1 = !!this.profile.evenM1;

                this.cpu.contend = (addr) => {
                    if (evenM1 && isFirstAccess &&
                        ((this.cpu.tStates + mcycleOffset) & 1) &&
                        !this.memory.isRomAt(addr)) {
                        this.cpu.tStates += 1;
                    }
                    // No contention delays — just track M-cycle offset
                    mcycleOffset += isFirstAccess ? 4 : 3;
                    isFirstAccess = false;
                };

                this.cpu.internalCycles = (cycles) => {
                    mcycleOffset += cycles;
                };

                this.cpu.contendInternal = (addr, tstates) => {
                    // No contention delays — just track internal cycles
                    mcycleOffset += tstates;
                };

                this.cpu.resetContend = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                };

                const originalExecute = this.cpu.execute.bind(this.cpu);
                this.cpu.execute = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                    return originalExecute();
                };

                const originalIncR = this.cpu.incR.bind(this.cpu);
                this.cpu.incR = () => {
                    if (mcycleOffset > 0) {
                        isFirstAccess = true;  // Next fetch is M1 (prefix opcode)
                    }
                    return originalIncR();
                };

                const originalInterrupt = this.cpu.interrupt.bind(this.cpu);
                this.cpu.interrupt = () => {
                    mcycleOffset = 7;  // 7T acknowledge cycle before push
                    isFirstAccess = false;
                    return originalInterrupt();
                };
                const originalNmi = this.cpu.nmi.bind(this.cpu);
                this.cpu.nmi = () => {
                    mcycleOffset = 5;  // 5T acknowledge cycle before push
                    isFirstAccess = false;
                    return originalNmi();
                };

                // Multicolor tracking with accurate write timing
                // Only track when displaying bank 5 — $5800 writes always go to bank 5,
                // so when displaying bank 7 these writes affect the back buffer, not the display
                // The write timestamp uses mcycleOffset - 3: contend() has already added the 3T
                // write cycle, but the effective point where the new value becomes visible to the
                // ULA is at the START of the write cycle, not the end. This matches JSSpeccy3's
                // model where updateFramebuffer() runs before t += 3 in writeMem().
                this.ula.mcWriteAdjust = 0;
                this.cpu.onMemWrite = (addr, val) => {
                    if (addr >= SCREEN_ATTR && addr <= SCREEN_END && this.memory.screenBank === 5) {
                        const writeT = this.cpu.tStates + mcycleOffset - 3;
                        this.ula.setAttrAt(addr - SCREEN_ATTR, val, writeT);
                        this.ula.hadAttrChanges = true;
                    }
                };
                return;
            }

            // For 48K: per-access contention for T-state accurate timing
            // This is essential for pixel-perfect border effects
            // Precompute contention delay table from profile
            if (this.profile.contentionPattern === '76543210') {
                // +2A/+3: delays at contentionFrom are (1,0,7,6,5,4,3,2)
                // The Amstrad gate array starts contention 6T into the 8-cycle ULA fetch
                this.contentionTable = [1, 0, 7, 6, 5, 4, 3, 2];
            } else {
                // 48K/128K/+2: delays at contentionFrom are (6,5,4,3,2,1,0,0)
                this.contentionTable = [6, 5, 4, 3, 2, 1, 0, 0];
            }

            if (this.profile.ulaProfile === '48k') {
                this.contentionFunc = null;
                // Memory contention: addresses SLOT1_START-0x7FFF during screen fetch
                // z80.js checks contention at instruction start, but real access is later
                // Track approximate M-cycle position (4T per access is reasonable average)
                let mcycleOffset = 0;

                // Track accumulated contention for ULA timing correction
                // ULA runs at fixed rate, CPU gets delayed - need to track the difference
                this.accumulatedContention = 0;
                this.memoryContentionDisabled = false;  // Set to true to disable memory contention

                // Track if current access is M1 (opcode fetch) = 4T, or subsequent = 3T
                let isFirstAccess = true;

                this.cpu.contend = (addr) => {
                    if (this.memoryContentionDisabled) {
                        mcycleOffset += isFirstAccess ? 4 : 3;
                        isFirstAccess = false;
                        return;
                    }
                    if (addr >= SLOT1_START && addr < SLOT2_START) {
                        // Check contention at estimated actual access time
                        const actualT = this.cpu.tStates + mcycleOffset;
                        const delay = this.checkContention(actualT);
                        if (delay > 0) {
                            if (this.debugContention) {
                                console.log(`CONTEND addr=${addr.toString(16)} tStates=${this.cpu.tStates} mcycle=${mcycleOffset} actualT=${actualT} delay=${delay} isM1=${isFirstAccess}`);
                            }
                            this.cpu.tStates += delay;
                            this.accumulatedContention += delay;
                        }
                    }
                    // M1 fetch = 4T, all other memory accesses = 3T
                    mcycleOffset += isFirstAccess ? 4 : 3;
                    isFirstAccess = false;
                };

                // Internal cycles callback - for instructions with internal cycles before memory ops
                // E.g., PUSH has 1T internal cycle before the two write cycles
                this.cpu.internalCycles = (cycles) => {
                    mcycleOffset += cycles;
                };

                // Reset contention tracking at instruction boundaries
                // Exposed as resetContend() for HALT NOP contention in main loop
                this.cpu.resetContend = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                };

                const originalExecute = this.cpu.execute.bind(this.cpu);
                this.cpu.execute = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                    return originalExecute();
                };

                // For prefix instructions (CB, DD, ED, FD), the second opcode is also M1
                const originalIncR = this.cpu.incR.bind(this.cpu);
                this.cpu.incR = () => {
                    // incR is called before M1 fetches. If mcycleOffset > 0, we're in a prefix
                    if (mcycleOffset > 0) {
                        isFirstAccess = true;  // Next fetch is M1 (prefix opcode)
                    }
                    return originalIncR();
                };

                // Interrupt/NMI: set mcycleOffset to acknowledge cycle length, memory ops are not M1 fetches
                // IM1/IM2: 7T acknowledge (5T + 2 wait states) before push
                // NMI: 5T acknowledge before push
                const originalInterrupt = this.cpu.interrupt.bind(this.cpu);
                this.cpu.interrupt = () => {
                    mcycleOffset = 7;  // 7T acknowledge cycle before push
                    isFirstAccess = false;  // Interrupt push/read are not M1
                    return originalInterrupt();
                };
                const originalNmi = this.cpu.nmi.bind(this.cpu);
                this.cpu.nmi = () => {
                    mcycleOffset = 5;  // 5T acknowledge cycle before push
                    isFirstAccess = false;
                    return originalNmi();
                };

                // Internal cycle contention handler
                // For internal T-states (not memory accesses), apply contention if address is contended
                // This is critical for accurate timing of DJNZ loops and other instructions with internal cycles
                // Set spectrum.internalContentionDisabled = true to disable for testing
                this.internalContentionDisabled = false;  // Enable internal contention (needed for ULA48)
                this.cpu.contendInternal = (addr, tstates) => {
                    if (this.internalContentionDisabled) {
                        mcycleOffset += tstates;
                        return;
                    }
                    if (addr >= SLOT1_START && addr < SLOT2_START) {
                        let totalDelay = 0;
                        // Swan/Fuse style: CheckContention; Inc(TStates) for each cycle
                        // Each check happens at current position, then 1T is added
                        let currentT = this.cpu.tStates + mcycleOffset;
                        for (let i = 0; i < tstates; i++) {
                            const delay = this.checkContention(currentT);
                            totalDelay += delay;
                            currentT += delay + 1;
                        }
                        if (totalDelay > 0) {
                            if (this.debugContention) {
                                console.log(`CONTEND_INTERNAL addr=${addr.toString(16)} tStates=${this.cpu.tStates} tstates=${tstates} totalDelay=${totalDelay}`);
                            }
                            this.cpu.tStates += totalDelay;
                            this.accumulatedContention += totalDelay;
                        }
                    }
                    // Update mcycleOffset to account for internal cycles
                    mcycleOffset += tstates;
                };

                // Multicolor tracking: intercept attribute memory writes ($5800-$5AFF)
                // Call ula.setAttrAt() with the T-state when the write actually happens
                // mcWriteAdjust = 0 because we pass the actual write time (not instruction start)
                this.ula.mcWriteAdjust = 0;
                this.cpu.onMemWrite = (addr, val) => {
                    if (addr >= SCREEN_ATTR && addr <= SCREEN_END) {
                        // Calculate write time: cpu.tStates already has contention delays,
                        // mcycleOffset tracks position in instruction for accurate timing
                        const writeT = this.cpu.tStates + mcycleOffset;
                        this.ula.setAttrAt(addr - SCREEN_ATTR, val, writeT);
                        this.ula.hadAttrChanges = true;
                    }
                };

                this.cpu.ioContend = null;
                this.contentionEnabled = true;
                return;
            }

            // For +2A/+3: similar contention framework but banks 4,5,6,7 are contended (not 1,3,5,7)
            // Key differences from 128K:
            //   - Memory contention uses pattern (7,6,5,4,3,2,1,0), not (6,5,4,3,2,1,0,0)
            //   - Non-MREQ contention (internal cycles) is NONE (FUSE: contend_delay_no_mreq = none)
            //   - IO contention is not applied (port 0xFE is not contended)
            // In special paging mode, all slots map to RAM, each slot's bank must be checked
            if (this.profile.pagingModel === '+2a') {
                this.contentionFunc = null;
                let mcycleOffset = 0;
                this.accumulatedContention = 0;
                this.memoryContentionDisabled = false;
                let isFirstAccess = true;

                // +2A contention: banks 4,5,6,7 are contended
                const isContendedAddr = (addr) => {
                    const mem = this.memory;
                    if (mem.specialPagingMode) {
                        // Special paging: check the bank mapped to this address range
                        const slot = addr >> 14;
                        const bank = mem.specialBanks[slot];
                        return bank >= 4;
                    }
                    // Normal mode: bank 5 at slot 1 (contended), bank 2 at slot 2 (not)
                    if (addr >= SLOT1_START && addr < SLOT2_START) return true;  // Bank 5 is always contended
                    if (addr >= SLOT3_START) {
                        return mem.currentRamBank >= 4;
                    }
                    return false;
                };

                this.cpu.contend = (addr) => {
                    if (this.memoryContentionDisabled) {
                        mcycleOffset += isFirstAccess ? 4 : 3;
                        isFirstAccess = false;
                        return;
                    }
                    if (isContendedAddr(addr)) {
                        const actualT = this.cpu.tStates + mcycleOffset;
                        const delay = this.checkContention(actualT);
                        if (delay > 0) {
                            this.cpu.tStates += delay;
                            this.accumulatedContention += delay;
                        }
                    }
                    mcycleOffset += isFirstAccess ? 4 : 3;
                    isFirstAccess = false;
                };

                this.cpu.internalCycles = (cycles) => {
                    mcycleOffset += cycles;
                };

                this.cpu.resetContend = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                };

                const originalExecute = this.cpu.execute.bind(this.cpu);
                this.cpu.execute = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                    return originalExecute();
                };

                const originalIncR = this.cpu.incR.bind(this.cpu);
                this.cpu.incR = () => {
                    if (mcycleOffset > 0) {
                        isFirstAccess = true;
                    }
                    return originalIncR();
                };

                const originalInterrupt = this.cpu.interrupt.bind(this.cpu);
                this.cpu.interrupt = () => {
                    mcycleOffset = 7;
                    isFirstAccess = false;
                    return originalInterrupt();
                };
                const originalNmi = this.cpu.nmi.bind(this.cpu);
                this.cpu.nmi = () => {
                    mcycleOffset = 5;
                    isFirstAccess = false;
                    return originalNmi();
                };

                // +2A/+3: NO internal cycle contention (FUSE: contend_delay_no_mreq = none)
                // The Amstrad gate array only contends on MREQ, not on internal cycles
                this.internalContentionDisabled = false;
                this.cpu.contendInternal = (addr, tstates) => {
                    mcycleOffset += tstates;
                };

                this.ula.mcWriteAdjust = 0;
                this.cpu.onMemWrite = (addr, val) => {
                    if (addr >= SCREEN_ATTR && addr <= SCREEN_END && this.memory.screenBank === 5) {
                        const writeT = this.cpu.tStates + mcycleOffset;
                        this.ula.setAttrAt(addr - SCREEN_ATTR, val, writeT);
                        this.ula.hadAttrChanges = true;
                    }
                };

                this.cpu.ioContend = null;
                this.contentionEnabled = true;
                return;
            }

            // For 128K/+2: same contention as 48K, but also check contended banks at slot 3
            // Contended banks: 1, 3, 5, 7 (odd-numbered banks)
            // Bank 5 is always at slot 1 (SLOT1_START-SLOT2_START)
            // Selected bank can be paged at slot 3 (SLOT3_START+)
            if (this.machineType === '128k' || this.machineType === '+2') {
                this.contentionFunc = null;
                let mcycleOffset = 0;
                this.accumulatedContention = 0;
                this.memoryContentionDisabled = false;
                let isFirstAccess = true;

                // Check if address is in contended memory
                const isContendedAddr = (addr) => {
                    // Bank 5 at slot 1 is always contended
                    if (addr >= SLOT1_START && addr < SLOT2_START) return true;
                    // Check if paged bank at slot 3 is contended (banks 1,3,5,7)
                    if (addr >= SLOT3_START) {
                        return (this.memory.currentRamBank & 1) === 1;
                    }
                    return false;
                };

                this.cpu.contend = (addr) => {
                    if (this.memoryContentionDisabled) {
                        mcycleOffset += isFirstAccess ? 4 : 3;
                        isFirstAccess = false;
                        return;
                    }
                    if (isContendedAddr(addr)) {
                        const actualT = this.cpu.tStates + mcycleOffset;
                        const delay = this.checkContention(actualT);
                        if (delay > 0) {
                            this.cpu.tStates += delay;
                            this.accumulatedContention += delay;
                        }
                    }
                    mcycleOffset += isFirstAccess ? 4 : 3;
                    isFirstAccess = false;
                };

                this.cpu.internalCycles = (cycles) => {
                    mcycleOffset += cycles;
                };

                this.cpu.resetContend = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                };

                const originalExecute = this.cpu.execute.bind(this.cpu);
                this.cpu.execute = () => {
                    mcycleOffset = 0;
                    isFirstAccess = true;
                    return originalExecute();
                };

                const originalIncR = this.cpu.incR.bind(this.cpu);
                this.cpu.incR = () => {
                    if (mcycleOffset > 0) {
                        isFirstAccess = true;
                    }
                    return originalIncR();
                };

                const originalInterrupt = this.cpu.interrupt.bind(this.cpu);
                this.cpu.interrupt = () => {
                    mcycleOffset = 7;
                    isFirstAccess = false;
                    return originalInterrupt();
                };
                const originalNmi = this.cpu.nmi.bind(this.cpu);
                this.cpu.nmi = () => {
                    mcycleOffset = 5;
                    isFirstAccess = false;
                    return originalNmi();
                };

                this.internalContentionDisabled = false;
                this.cpu.contendInternal = (addr, tstates) => {
                    if (this.internalContentionDisabled) {
                        mcycleOffset += tstates;
                        return;
                    }
                    if (isContendedAddr(addr)) {
                        let totalDelay = 0;
                        let currentT = this.cpu.tStates + mcycleOffset;
                        for (let i = 0; i < tstates; i++) {
                            const delay = this.checkContention(currentT);
                            totalDelay += delay;
                            currentT += delay + 1;
                        }
                        if (totalDelay > 0) {
                            this.cpu.tStates += totalDelay;
                            this.accumulatedContention += totalDelay;
                        }
                    }
                    mcycleOffset += tstates;
                };

                // Multicolor tracking with accurate timing (same as 48K)
                // Only track when displaying bank 5 — $5800 writes always target bank 5
                this.ula.mcWriteAdjust = 0;
                this.cpu.onMemWrite = (addr, val) => {
                    if (addr >= SCREEN_ATTR && addr <= SCREEN_END && this.memory.screenBank === 5) {
                        const writeT = this.cpu.tStates + mcycleOffset;
                        this.ula.setAttrAt(addr - SCREEN_ATTR, val, writeT);
                        this.ula.hadAttrChanges = true;
                    }
                };

                this.cpu.ioContend = null;
                this.contentionEnabled = true;
                return;
            }

        }

        // Contention check using precomputed delay table
        // Returns delay to add based on current T-state position
        // The contention pattern repeats every 8 T-states during screen fetch:
        //   48K/128K/+2: [6,5,4,3,2,1,0,0]   +2A/+3: [1,0,7,6,5,4,3,2]
        // CONTENTION_START_TSTATE is aligned with the FIRST SCREEN FETCH of the frame
        // (not the line start - that would include left border where no contention occurs).
        checkContention(tState) {
            if (!this.ula.IO_CONTENTION_ENABLED) return 0;

            // Contention timing is NOT offset for late timing mode.
            // The ULA fetches video RAM at the same absolute T-states regardless.
            // Debug: try shifting contention start to test if it fixes Comet
            const contentionOffset = this.contentionOffset || 0;
            const contentionFrom = this.ula.CONTENTION_START_TSTATE + contentionOffset;
            // ContentionTo = ContentionFrom + 191 paper lines + 128 T-states of last line
            const contentionTo = contentionFrom + (191 * this.ula.TSTATES_PER_LINE) + 128;
            const ticksPerLine = this.ula.TSTATES_PER_LINE;

            // Only apply contention within screen area
            if (tState < contentionFrom || tState >= contentionTo) {
                return 0;
            }

            // N = position within the 8-cycle contention pattern on the current line
            // The & 0x87 mask combines: bits 0-2 for 8-cycle position, bit 7 for past-paper detection
            // Positions 128+ (past paper area on the line) always return 0
            const N = ((tState - contentionFrom) % ticksPerLine) & 0x87;
            // Use precomputed delay table (set in setupContention based on profile.contentionPattern)
            // '65432100': [6,5,4,3,2,1,0,0] — 48K/128K/+2
            // '76543210': [1,0,7,6,5,4,3,2] — +2A/+3 (shifted: ULA contention starts 6T into cycle)
            return N < 8 ? this.contentionTable[N] : 0;
        }

        // Swan-style I/O timing for ULA ports
        // Applies contention and returns total T-states to add
        // instructionTiming: 11 for OUT (n),A / IN A,(n), 12 for OUT (C),r / IN r,(C)
        applyIOTimings(port, instructionTiming = 12) {
            if (!this.ula.IO_CONTENTION_ENABLED) return 0;
            // +2A/+3: no IO contention (ULA only contends on MREQ, not during IO)
            if (!this.profile.hasIOContention) return 0;

            const highByte = (port >> 8) & 0xFF;
            const lowByte = port & 0xFF;
            // Timex: the SCLD answers $F4, $FE and $FF only (full decoding)
            const isUlaPort = this.profile.timex
                ? (lowByte === 0xFE || lowByte === 0xFF || lowByte === 0xF4)
                : (lowByte & 0x01) === 0;
            const highByteContended = (highByte >= 0x40 && highByte <= 0x7F);

            // Where the I/O cycle sits inside the instruction, which is the tick the
            // wait is looked up at:
            //   OUT (n),A  11T: pc:4, pc+1:3, IO:4            -> 7
            //   OUT (C),r  12T: pc:4, pc+1:4, IO:4            -> 8
            //   OUTI/OTIR  16T: pc:4, pc+1:5, hl:3, IO:4      -> 12
            // The block form reads memory BEFORE it writes the port, so it is 12 and
            // not the 9 its input twin uses (see applyIOTimingsForRead).
            const fetchOffset = IO_OFFSET_WRITE[instructionTiming] || 8;
            let totalDelay = 0;

            if (highByteContended) {
                if (isUlaPort) {
                    // C:1, C:3 - both cycles contended
                    const check1T = this.cpu.tStates + fetchOffset + totalDelay;
                    const delay1 = this.checkContention(check1T);
                    totalDelay += delay1;
                    totalDelay += 1;
                    const check2T = this.cpu.tStates + fetchOffset + totalDelay;
                    const delay2 = this.checkContention(check2T);
                    totalDelay += delay2;
                    totalDelay += 3;
                    // Debug I/O contention near paper boundary
                    if (this.debugPaperContention && (check1T >= 14300 && check1T <= 14600)) {
                        console.log(`IO_CONTEND(C:1,C:3) tStates=${this.cpu.tStates} check1=${check1T} d1=${delay1} check2=${check2T} d2=${delay2}`);
                    }
                } else {
                    // C:1, C:1, C:1, C:1
                    for (let i = 0; i < 4; i++) {
                        totalDelay += this.checkContention(this.cpu.tStates + fetchOffset + totalDelay);
                        totalDelay += 1;
                    }
                }
            } else {
                if (isUlaPort) {
                    // N:1, C:3 - first cycle not contended, second cycle contended
                    totalDelay += 1;
                    const checkT = this.cpu.tStates + fetchOffset + totalDelay;
                    const contDelay = this.checkContention(checkT);
                    if (this.debugIOContention && contDelay > 0) {
                        console.log(`IO_CONTEND port=${port.toString(16)} tStates=${this.cpu.tStates} checkT=${checkT} delay=${contDelay}`);
                    }
                    // Debug I/O contention near paper boundary
                    if (this.debugPaperContention && (checkT >= 14300 && checkT <= 14600)) {
                        console.log(`IO_CONTEND(N:1,C:3) tStates=${this.cpu.tStates} checkT=${checkT} delay=${contDelay}`);
                    }
                    totalDelay += contDelay;
                    totalDelay += 3;
                } else {
                    // N:4 - no contention at all
                    totalDelay += 4;
                }
            }

            return totalDelay;
        }

        // I/O timing for IN operations (similar to applyIOTimings but with different fetch offset)
        // IN A,(n) is 11T with I/O starting at ~7T, IN r,(C) is 12T with I/O at ~8T
        applyIOTimingsForRead(port, instructionTiming = 12) {
            if (!this.ula.IO_CONTENTION_ENABLED) return 0;
            // +2A/+3: no IO contention (ULA only contends on MREQ, not during IO)
            if (!this.profile.hasIOContention) return 0;

            const highByte = (port >> 8) & 0xFF;
            const lowByte = port & 0xFF;
            // Timex: the SCLD answers $F4, $FE and $FF only (full decoding)
            const isUlaPort = this.profile.timex
                ? (lowByte === 0xFE || lowByte === 0xFF || lowByte === 0xF4)
                : (lowByte & 0x01) === 0;
            const highByteContended = (highByte >= 0x40 && highByte <= 0x7F);

            //   IN A,(n)   11T: pc:4, pc+1:3, IO:4            -> 7
            //   IN r,(C)   12T: pc:4, pc+1:4, IO:4            -> 8
            //   INI/INIR   16T: pc:4, pc+1:5, IO:4, hl:3      -> 9
            // It used to be 7 for all three: right for IN A,(n), a tick early for
            // IN r,(C) and two early for the block forms (ctprobe P-01, P-04).
            const fetchOffset = IO_OFFSET_READ[instructionTiming] || 8;
            let totalDelay = 0;

            if (highByteContended) {
                if (isUlaPort) {
                    // C:1, C:3 - both cycles contended
                    const check1T = this.cpu.tStates + fetchOffset + totalDelay;
                    const delay1 = this.checkContention(check1T);
                    totalDelay += delay1;
                    totalDelay += 1;
                    const check2T = this.cpu.tStates + fetchOffset + totalDelay;
                    const delay2 = this.checkContention(check2T);
                    totalDelay += delay2;
                    totalDelay += 3;
                } else {
                    // C:1, C:1, C:1, C:1
                    for (let i = 0; i < 4; i++) {
                        totalDelay += this.checkContention(this.cpu.tStates + fetchOffset + totalDelay);
                        totalDelay += 1;
                    }
                }
            } else {
                if (isUlaPort) {
                    // N:1, C:3 - first cycle not contended, second cycle contended
                    totalDelay += 1;
                    const checkT = this.cpu.tStates + fetchOffset + totalDelay;
                    const contDelay = this.checkContention(checkT);
                    totalDelay += contDelay;
                    totalDelay += 3;
                } else {
                    // N:4 - no contention at all
                    totalDelay += 4;
                }
            }

            return totalDelay;
        }

        setContention(enabled) {
            this.contentionEnabled = enabled;
            // Per-line contention is handled in the run loop based on contentionEnabled flag
        }

        // ========== Display Settings ==========

        updateDisplayDimensions() {
            const dims = this.ula.getDimensions();
            // Timex: the canvas is twice as wide so 512-pixel hi-res rows fit;
            // the frame buffer and everything that reads it stay as they are
            this.canvasScaleX = this.profile.timex ? 2 : 1;
            this.canvas.width = dims.width * this.canvasScaleX;
            this.canvas.height = dims.height;
            this.imageData = this.ctx.createImageData(dims.width * this.canvasScaleX, dims.height);
            this._wide32 = null;
            // Store previous frame for beam visualization mode
            this.previousFrameBuffer = new Uint8ClampedArray(dims.width * dims.height * 4);
        }

        /**
         * Frame buffer -> canvas image. Timex: each pixel twice across, then the
         * rows the SCLD drew in hi-res replaced by their 512 real pixels.
         */
        blitFrame(fb) {
            if (this.canvasScaleX !== 2) { this.imageData.data.set(fb); return; }
            const dims = this.ula.getDimensions();
            const W = dims.width, H = dims.height, W2 = W * 2;
            if (!this._wide32 || this._wide32.buffer !== this.imageData.data.buffer) {
                this._wide32 = new Uint32Array(this.imageData.data.buffer);
            }
            const dst = this._wide32;
            const src = new Uint32Array(fb.buffer, fb.byteOffset, W * H);
            for (let y = 0; y < H; y++) {
                const s0 = y * W, d0 = y * W2;
                for (let x = 0; x < W; x++) {
                    const c = src[s0 + x];
                    dst[d0 + 2 * x] = c;
                    dst[d0 + 2 * x + 1] = c;
                }
            }
            const ula = this.ula;
            if (ula.hiresBuf) {
                for (let y = 0; y < 192; y++) {
                    const vy = dims.borderTop + y;
                    if (ula.hiresRows[y] && vy >= 0 && vy < H) {
                        dst.set(ula.hiresBuf.subarray(y * 512, y * 512 + 512), vy * W2 + 2 * dims.borderLeft);
                    }
                }
            }
        }

        // Save current frame as previous (call at end of each frame)
        savePreviousFrame(frameBuffer) {
            if (this.previousFrameBuffer && frameBuffer) {
                this.previousFrameBuffer.set(frameBuffer);
            }
        }

        setGrid(enabled) {
            // Legacy support
            this.overlayMode = enabled ? 'grid' : 'none';
        }

        setOverlayMode(mode) {
            // mode: 'normal', 'grid', 'box', 'screen', 'reveal', 'beam', 'beamscreen', 'noattr', 'nobitmap'
            this.overlayMode = mode;
            this.ula.borderOnly = (mode === 'screen' || mode === 'reveal' || mode === 'beamscreen');
        }

        setZoom(zoom) {
            this.zoom = zoom;
            // Update overlay context reference after canvas resize
            if (this.overlayCanvas) {
                this.overlayCtx = this.overlayCanvas.getContext('2d');
            }
        }

        // ========== Machine Control ==========

        reset() {
            this.cpu.reset();
            this.setHwTurbo(1);
            this.memory.reset();
            this.ula.reset();
            this.tapeLoader.rewind();
            this.tapePlayer.rewind();
            this.tapePlayer.stop();
            this.tapeEarBit = false;
            this._turboBlockPending = false;
            this.rzxStop();
            if (this.ay) this.ay.reset();
            if (this.ay2) { this.ay2.reset(); this._aySel = 0; }
            if (this.fm) this._fmReset();
            if (this.saa) { this.saa.reset(); this.saaChanges = []; }
            // General Sound has a reset line of its own (port $33, power-on):
            // a Spectrum reset leaves it running, as Unreal does (GSReset=0),
            // so a program started after a reset finds it past its RAM test
            // (0.5 s on 128KB, 2.5 s on 512KB, 10 s on 2MB). Only its clock
            // follows the Spectrum's frame again.
            if (this.gs) {
                this.gs.specClock = this._gsSpecClock();
                this.gs.t = 0; this.gs._ended = false; this.gs.changes = [];
            }
            this._gamaMode = 0x9B; this._gamaPortC = 0;     // Didaktik Gama 8255: all inputs
            if (this.dacLevels) this.dacLevels.fill(0x80);
            // MIDI out: a note held at reset would never get its Note Off, so
            // All Notes Off on every channel, and the UART starts afresh
            if (this.midiEnabled) {
                if (this.onMidiMessage) for (let ch = 0; ch < 16; ch++) this.onMidiMessage([0xB0 | ch, 123, 0]);
                this.setMidiOut(true);
            }
            if (this.fdc) this.fdc.reset();
            // HC IF1: select latch and motors drop; its static RAM keeps its contents
            if (this.hcIf1) this.hcIf1.reset(false);
            // Beta 48: reset clears the system port, so the ROM latch is set and the
            // DOS runs from $0000; the master register clears too (I/O on).
            this.memory.beta48Latch = this.memory.beta48On;
            // FDD 3000: interface paged out (it pages in at the $0000 fetch).
            // The station is a separate box with its own power: a Spectrum reset
            // leaves it running, as in FUSE (only switching it on resets it).
            this.memory.fdd3000Active = false;
            // Kempston Disc: its ROM is paged in at reset; K-DOS starts first
            if (this._kempdiscEnabledFlag) {
                this.kempdisc.reset();
                this.memory.kempdiscActive = true;
            }
            this._beta48Master = 0;
            this.memory.beta48WindowOff = false;

            // Reset frame timing
            this.frameStartOffset = 0;
            this.accumulatedContention = 0;
            this.pendingInt = false;
            this._intDebugCount = 0;  // Reset INT debug counter

            // Clear auto-map data
            this.autoMap.executed.clear();
            this.autoMap.read.clear();
            this.autoMap.written.clear();
            this.autoMap.currentFetchAddrs.clear();

            // Clear runtime call stack
            this._debugCallStack = [];

            // Clear write monitor
            this.writeMonitor.enabled = false;
            this.writeMonitor.hits = [];

            // Clear frozen addresses
            this.frozenAddresses = [];

            // Clear comparison breakpoint
            this.comparisonBreakpoint.enabled = false;
            this.comparisonBreakpoint.hit = false;

            // Clear register tracker
            this.registerTracker.enabled = false;
            this.registerTracker.values = [];

            // Clear struct mapper
            this.structMapper.enabled = false;
            this.structMapper.fields = new Map();

            // +D reset (per FUSE plusd_reset):
            // - Reset WD1772 FDC
            // - Page in +D ROM so boot code at $0000 runs and initializes workspace
            if (this.plusDEnabled && this.memory.hasPlusDRom() &&
                this.profile.pagingModel !== '+2a' && !this.hcIf1 && !this._fdd3000PagingEnabled) {
                this.plusD.reset();
                this.memory.plusDActive = true;
            }

            // DISCiPLE reset: FDC reset, ROM low, paged out; the Spectrum ROM's
            // DI at $0000 runs, the fetch at $0001 pages the DISCiPLE in
            if (this.discipleEnabled) {
                this.disciple.reset();
            }

            // Opus reset (per FUSE opus_reset): reset the WD1770 and the PIA, and
            // leave the interface paged OUT. The +D above pages itself in at reset
            // to run its boot code; the Opus does not — it waits to be entered
            // through one of its hook addresses, the first of which is normally
            // the $0048 KEY-INT on the first maskable interrupt.
            if (this.opusEnabled && this.memory.hasOpusRom() &&
                this.profile.pagingModel !== '+2a' && !this.hcIf1) {
                this.opus.reset();
                this.memory.opusActive = false;
            }

            // Didaktik reset: the FDC and aux register go back to zero. Nothing
            // is paged in here — it happens on its own, because the very first
            // instruction after a reset is at $0000, which is a page-in trigger.
            if (this.didaktikEnabled && this.memory.hasDidaktikRom() &&
                this._didaktikMachineOk()) {
                this.didaktik.reset();
                this.memory.didaktikActive = false;
            }
        }

        /**
         * Timex FDD 3000: switched on, both ROMs loaded, and a 48K or a
         * 128K/+2 (FUSE offers it on those two families). There is no HC-2000
         * test here because its paging model is neither 'none' nor '128k' --
         * and this tree states that rule as `!this.hcIf1`, the collision being
         * with the HC IF1 on the bus rather than the badge on the case.
         */
        _fdd3000Ok() {
            return this.fdd3000Enabled && this.fdd3000.hasRoms() &&
                (this.profile.pagingModel === 'none' || this.profile.pagingModel === '128k');
        }

        /**
         * Kempston Disc: switched on, its ROM loaded, and a machine the board
         * fits. The stock board is a 48K one -- its ROM-in port is `$xxFD`,
         * which is the 128K's own `$7FFD` -- so only the three ROMs built for
         * a 128K (128A6, A6J, and A1J, which locks the machine to 48K) are
         * offered there. No HC-2000 test, for the same reason `_fdd3000Ok`
         * has none: its paging model is neither 'none' nor '128k'.
         */
        _kempdiscOk() {
            this.kempdisc.setA6(KEMPDISC_A6_ROMS.includes(this.kempdiscRomFile));
            return this.kempdiscEnabled && this.kempdisc.hasRom() && !this.profile.timex &&
                (this.profile.pagingModel === 'none' ||
                 (KEMPDISC_128_ROMS.includes(this.kempdiscRomFile) && this.profile.pagingModel === '128k'));
        }

        /**
         * FDD 3000 boot, the way it is done by hand: "FDD3000 reset" (the
         * station loads its system from drive A — run at once, see
         * Fdd3000.boot), then reset the Spectrum. A CP/M disk in A needs the
         * Spectrum to run the Monitor Emulator terminal first: if a Monitor
         * disk is in B-D it goes into A for the first boot, and once Monitor
         * is up and waiting, CP/M goes back into A and only the station is
         * reset. Returns { ok, msg }.
         */
        fdd3000AutoBoot() {
            if (!this._fdd3000PagingEnabled) return { ok: false, msg: 'Timex FDD 3000 is off' };
            const fdc = this.fdd3000.fdc;
            const a = fdc.drives[0];
            if (!a.dsk) return { ok: false, msg: 'FDD 3000: no disk in drive A' };
            if (this._fdd3000AutoBootOff) { this._fdd3000AutoBootOff(); this._fdd3000AutoBootOff = null; }
            const kind = Fdd3000.diskKind(a.dsk);
            if (kind !== 'cpm') {
                this.fdd3000.boot();
                this.reset();
                return { ok: true, msg: kind === 'tos' ? 'FDD 3000: TOS boot' : 'FDD 3000: no system on the disk in A' };
            }
            const mi = [1, 2, 3].find(i => fdc.drives[i].dsk && Fdd3000.isMonitorDisk(fdc.drives[i].dsk));
            if (mi === undefined) {
                return { ok: false, msg: 'CP/M needs the Monitor Emulator terminal: put its disk in drive B' };
            }
            const swap = () => { const t = fdc.drives[0]; fdc.drives[0] = fdc.drives[mi]; fdc.drives[mi] = t; };
            swap();                                 // Monitor into A
            this.fdd3000.boot();
            this.reset();
            let frames = 0, inMonitor = 0;
            const done = () => { if (this._fdd3000AutoBootOff) { this._fdd3000AutoBootOff(); this._fdd3000AutoBootOff = null; } };
            this._fdd3000AutoBootOff = this.addFrameListener(() => {
                frames++;
                // Monitor is up when the Spectrum runs it ($8000 on) and the
                // station waits; give up after ~30 s of emulated time (the
                // interface's start-up code also runs up there, from a copy at
                // $7FFD-$8022, while the machine boots)
                inMonitor = this.cpu.pc >= 0x8040 ? inMonitor + 1 : 0;
                const ready = frames > 50 && inMonitor > 10 && this.fdd3000.isIdle();
                if (ready || frames > 1500) {
                    done();
                    swap();                         // CP/M back into A
                    this.fdd3000.boot();            // station only
                }
            });
            return { ok: true, msg: `FDD 3000: CP/M — Monitor Emulator from drive ${String.fromCharCode(65 + mi)} first` };
        }

        /**
         * 128 MIDI out on or off. The bit time follows the machine's clock:
         * 3.5469 MHz on the 128K family, 3.5 MHz elsewhere.
         */
        setMidiOut(on) {
            this.midiEnabled = !!on;
            if (this._midiFlushOff) { this._midiFlushOff(); this._midiFlushOff = null; }
            if (!this.midiEnabled) return;
            const clock = is128kCompat(this.machineType) ? 3546900 : 3500000;
            this._midiAsm = new MidiAssembler((msg) => {
                if (this.onMidiMessage) this.onMidiMessage(msg);
            });
            this._midiUart = new UartDecoder(clock / MIDI_BAUD, (b) => {
                this.midiBytes++;
                this.midiLog.push(b);
                if (this.midiLog.length > 64) this.midiLog.shift();
                this._midiAsm.push(b);
            });
            // start from the line as it is now, not from idle: a low line is
            // not a start bit until it has been high
            const r = this.ay.registers;
            this._midiLevel = (r[7] & 0x40) ? ((r[14] & MIDI_TX_BIT) ? 1 : 0) : 1;
            this._midiUart.level = this._midiLevel;
            // a byte whose last bits change nothing is finished by the clock
            this._midiFlushOff = this.addFrameListener(() => this._midiUart.flush(this.absTStates()));
        }

        // The MIDI OUT line: R14 bit 2 while R7 makes port A an output, else idle
        _midiLine() {
            const r = this.ay.registers;
            const level = (r[7] & 0x40) ? ((r[14] & MIDI_TX_BIT) ? 1 : 0) : 1;
            if (level !== this._midiLevel) {
                this._midiLevel = level;
                this._midiUart.edge(this.absTStates(), level);
            }
        }

        /** The multiplier in force: the settings' if set, else the machine's */
        turboMultiplier() { return this.turboForce || this.turboHw; }

        _updateTurbo() {
            const m = this.turboMultiplier();
            if (m !== this._turboMul) { this._turboMul = m; this._turboAcc = 0; }
        }

        /** The machine's own turbo (1 = off): Scorpion TURBO+ switches 1 / 2 */
        setHwTurbo(m) { this.turboHw = m > 1 ? m : 1; this._updateTurbo(); }

        /** From the settings: 0 follows the machine, 1 forces it off, 2 / 4 force it on */
        setTurboForce(m) { this.turboForce = [1, 2, 4].includes(m) ? m : 0; this._updateTurbo(); }

        /**
         * Called after an instruction under turbo: the instruction took `spent`
         * CPU cycles, which are spent / mul cycles of the machine clock. The
         * remainder carries over, so in the long run it is exact.
         */
        /** CPU time outside an instruction (INT / NMI acceptance), turbo applied */
        _addCpuT(t) {
            const before = this.cpu.tStates;
            this.cpu.tStates += t;
            if (this._turboMul > 1) this._turboSpend(before);
        }

        _turboSpend(before) {
            const spent = this.cpu.tStates - before;
            if (spent <= 0) return;
            const m = this._turboMul;
            this._turboAcc += spent * (m - 1);
            const back = Math.floor(this._turboAcc / m);
            this._turboAcc -= back * m;
            this.cpu.tStates -= back;
        }

        // ========== Port I/O ==========

        // The Beta Disk answers its ports only while the TR-DOS ROM is paged in
        // (the DOS signal), as on a real Beta 128 / Pentagon. Answering them
        // whenever a disk was in the drive took port $1F from the Kempston
        // joystick ($1F is also the WD1793's command/status register), so no
        // game could read a joystick on a Pentagon with its disk inserted.
        // TR-DOS code in RAM reaches the ports through the ROM ($3D2F), which
        // pages it in.
        _isBetaDiskActive() {
            return this.betaDiskEnabled && !this.memory.beta48On && !this.hcIf1 &&
                this.memory.trdosActive &&
                this.betaDisk && this.betaDisk.hasAnyDisk() && this.memory.hasTrdosRom();
        }

        /** The Beta 48 flavour in use: 'plus' or 'cbi' (auto follows the ROM). */
        _beta48Variant() {
            if (this.betaVariant === 'cbi') return 'cbi';
            if (this.betaVariant === 'auto' && this.beta48Info) {
                return this.beta48Info.variant === 'cbi' ? 'cbi' : 'plus';
            }
            return 'plus';
        }

        /**
         * Load a Beta 48 ROM image (TR-DOS 4.x, Vision, CBI-95...): identified,
         * D0/D7 straightened and an 8KB ROM doubled by core/beta48.js.
         */
        loadBeta48Rom(data) {
            const info = prepareBeta48Rom(data);
            this.beta48Info = info;
            this.memory.loadBeta48Rom(info.rom);
            this.updateBetaDiskPagingFlag();
            return info;
        }

        // Beta 48 port read; undefined when not its port (or its I/O is off)
        _beta48Read(lowByte) {
            if ((this._beta48Master & 0x80) || (lowByte & 0x07) !== 0x07) return undefined;
            if ((lowByte & 0x87) === 0x07) {
                return this.betaDisk.read([0x1F, 0x3F, 0x5F, 0x7F][(lowByte >> 5) & 3]);
            }
            // System port: bit 7 INTRQ, bit 6 DRQ; the rest is open bus on the
            // Beta plus, a jumper (bit 4 = 1) and printer BUSY (bit 5) on the CBI
            const st = this.betaDisk.read(0xFF) & 0xC0;
            return this._beta48Variant() === 'cbi' ? (st | 0x1F) : (st | 0x3F);
        }

        // Beta 48 port write; true when the interface took it (it then blocks
        // the I/O cycle for the rest of the bus)
        _beta48Write(lowByte, val) {
            if ((this._beta48Master & 0x80) || (lowByte & 0x07) !== 0x07) return false;
            if ((lowByte & 0x87) === 0x07) {
                this.betaDisk.write([0x1F, 0x3F, 0x5F, 0x7F][(lowByte >> 5) & 3], val);
            } else {
                this.betaDisk.write(0xFF, val);
                this.memory.beta48Latch = (val & 0x80) === 0;   // ROM latch: 0 = paged
            }
            return true;
        }

        /**
         * The Beta Disk "magic button": NMI with the DOS ROM paged in, so the
         * DOS can save the machine to disk. Beta 48: the latch is set as well
         * (MAME betaplus); Beta 128: the TR-DOS ROM is paged (MAME beta128).
         */
        triggerBetaMagic() {
            if (this.memory.beta48On) {
                this.memory.beta48Latch = true;
            } else if (this._betaDiskPagingEnabled) {
                this.memory.trdosActive = true;
            } else {
                return false;
            }
            this.cpu.nmi();
            return true;
        }

        _isPlusDActive() {
            // Per FUSE: +D ports always respond when hardware is available
            // (not gated by memory paging state or disk presence)
            return this.plusDEnabled && this.plusD && this.memory.hasPlusDRom() &&
                this.profile.pagingModel !== '+2a' && !this.hcIf1 &&
                !this._fdd3000PagingEnabled;      // both claim port $EF
        }

        _isIF1Active() {
            return this.if1Enabled && this.microdrive && this.microdrive.hasAnyCartridge() &&
                this.memory.hasIF1Rom() && !this.hcIf1;
        }

        /**
         * HC-2000: its Interface 1 with the floppy controller is built in (FUSE
         * marks it PERIPH_PRESENT_ALWAYS). Its µPD765 *is* this.fdc on this
         * machine, so DSK loading, the drive letters, project save and the disk
         * activity light all work through the +3 paths; only the ports differ.
         */
        _setupHcIf1() {
            if (this.profile.pagingModel === 'hc2000' && this.hcIf1Enabled) {
                if (!this.hcIf1) this.hcIf1 = new HcIf1();
                this.fdc = this.hcIf1.fdc;
                this.memory.hcIf1Ram = this.hcIf1.ram;
            } else {
                // An HC-2000 without it is a plain Spectrum-compatible: no FDC,
                // and the add-on interfaces become available again
                if (this.profile.pagingModel === 'hc2000') this.fdc = null;
                this.hcIf1 = null;
                this.memory.hcIf1Rom = null;
                this.memory.hcIf1Ram = null;
            }
        }

        /**
         * Switch the HC-2000's HC IF1 in or out (Settings). The caller loads
         * its ROM (romData lives in the UI) and resets the machine.
         */
        setHcIf1Enabled(on) {
            this.hcIf1Enabled = !!on;
            this.memory.if1Active = false;
            this._setupHcIf1();
            this.updateBetaDiskPagingFlag();
        }

        /**
         * Does the AY answer on its ports? Built in (128K and up), or the
         * "AY in 48K" add-on (Melodik-style) on a 48K-class machine — the 48K
         * itself, the HC-2000 and the TC2048, which have no AY of their own
         * ("Timex 2048 + AY" is what demos like Timmy ask for).
         */
        _ayOnPorts() {
            return this.ayEnabled || (this.ay48kEnabled &&
                (this.machineType === '48k' || this.profile.pagingModel === 'hc2000' ||
                 this.machineType === 'tc2048' || this.machineType === 'tk90x' || this.machineType === 'tk95'));
        }

        /**
         * Didaktik Gama 8255 write: reg 0 A, 1 B, 2 C, 3 control (mode set with
         * D7=1 -- it clears the outputs; bit set/reset of port C with D7=0).
         * Bank = PC0 while the lower half of C is an output, else 0 (pulled low).
         */
        _gama8255Write(reg, val) {
            if (reg === 3) {
                if (val & 0x80) { this._gamaMode = val; this._gamaPortC = 0; }
                else {
                    const bit = (val >> 1) & 7;
                    if (val & 1) this._gamaPortC |= (1 << bit);
                    else this._gamaPortC &= ~(1 << bit);
                }
            } else if (reg === 2) {
                this._gamaPortC = val;
            }
            const cLowOut = ((this._gamaMode ?? 0x9B) & 0x01) === 0;
            this.memory.gamaBank = (cLowOut && (this._gamaPortC & 1)) ? 1 : 0;
        }

        /** The AY that $FFFD/$BFFD talk to: the second one when TurboSound selects it */
        _curAy() {
            return (this.turboSound && this._aySel) ? this.ay2 : this.ay;
        }

        /** Turn TurboSound on or off (the second AY starts silent) */
        setTurboSound(on) {
            this.turboSound = !!on;
            this._aySel = 0;
            this.ay2.reset();
        }

        /** TurboSound FM on or off (it brings TurboSound with it) */
        setTsfm(on) {
            this.tsfm = !!on;
            if (this.tsfm && !this.turboSound) this.setTurboSound(true);
            this._fmReset();
        }

        _fmReset() {
            for (const f of this.fm) f.reset();
            for (const t of this.fmTimers) t.reset();
            this.fmTimers[0].onCsm = () => this.fmChanges.push({ tStates: this.cpu.tStates, chip: 0, reg: -1, value: 0 });
            this.fmTimers[1].onCsm = () => this.fmChanges.push({ tStates: this.cpu.tStates, chip: 1, reg: -1, value: 0 });
            this._fmAddr = [0, 0];
            this._fmStatusRead = false;
            this._fmOn = true;
            this._fmT = this.absTStates();
            this.fmChanges = [];
        }

        /**
         * Bring both chips' timers and busy flags up to now (a T-state is a
         * TS-FM master clock).
         *
         * The clock must be `absTStates()`, the monotonic one, for the reason
         * the disk byte rate and the MIDI bit rate need it: timer A's shortest
         * period is 72 T-states, and a clock rebuilt from `totalFrames` sits a
         * whole frame off by an amount that CHANGES, so it steps forward by a
         * frame at some point and the catch-up loop below would run a thousand
         * periods in one go. See the note on `absTStates`.
         */
        _fmSync() {
            const now = this.absTStates();
            const d = now - this._fmT;
            this._fmT = now;
            if (d > 0) { this.fmTimers[0].advance(d); this.fmTimers[1].advance(d); }
        }

        // FM writes the audio did not take: straight into the chips
        _fmFlush() {
            for (const c of this.fmChanges) {
                if (c.reg < 0) this.fm[c.chip].csmKeyOn(); else this.fm[c.chip].write(c.reg, c.value);
            }
            this.fmChanges.length = 0;
        }

        // SAA1099 writes the audio did not take (no sound, high speed, or
        // made between frames): straight into the chip, so it keeps its registers
        _saaFlush() {
            for (const c of this.saaChanges) { if (c.addr) this.saa.writeAddress(c.value); else this.saa.writeData(c.value); }
            this.saaChanges.length = 0;
        }

        /** The Spectrum's clock, for the General Sound's time base */
        _gsSpecClock() { return is128kCompat(this.machineType) ? 3546900 : 3500000; }

        /**
         * The YM2203s' master clock. TS-FM is documented as clocking them at
         * 3.5 MHz, which is what the ZX-Bus carries on a Pentagon -- its usual
         * home -- so this is the bus clock, the same one the GS is given. The
         * timers already count in T-states; taking the sample rate from the
         * same clock keeps the board on one time base instead of two.
         */
        _fmMasterClock() { return this._gsSpecClock(); }

        /** General Sound on or off, its RAM (128 / 512 / 2048 KB) and ROM data */
        setGs(on, ramKB = this.gs.ramKB, romData = null) {
            this.gsOn = !!on;
            if (ramKB !== this.gs.ramKB) this.gs.setRamSize(ramKB);
            if (romData) this.gs.loadRom(romData);
            this.gs.reset();
            this.gs.specClock = this._gsSpecClock();
        }

        /** SAA1099 on or off (it starts silent) */
        setSaa(on) {
            this.saaOn = !!on;
            this.saa.reset();
            this.saaChanges = [];
        }

        /** DAC type and Covox port (see the constructor) */
        setDac(type, covoxPort = this.covoxPort, stereoPorts = this.stereoCovoxPorts) {
            if (type === 'soundrive') type = 'soundrive1';
            this.dacType = ['covox', 'stereocovox', 'specdrum', 'soundrive1', 'soundrive2'].includes(type) ? type : 'none';
            this.covoxPort = covoxPort & 0xFF;
            this.stereoCovoxPorts = [stereoPorts[0] & 0xFF, stereoPorts[1] & 0xFF];
            this.dacLevels.fill(0x80);
        }

        // A DAC port write: channel 0-3, or all four for the mono DACs.
        // While TR-DOS is paged in the ports belong to the Beta Disk (Soundrive
        // mode 1's $1F/$5F are its command and sector registers): the DAC
        // does not hear them, as in Unreal Speccy. A Beta 48's ports are live
        // whenever its I/O is on.
        _dacWrite(low, val) {
            if (this.memory.trdosActive) return;
            if (this.memory.beta48On && !(this._beta48Master & 0x80) && (low & 0x07) === 0x07) return;
            let ch = -1;
            if (this.dacType === 'covox') { if (low === this.covoxPort) ch = 4; }
            else if (this.dacType === 'stereocovox') {
                if (low === this.stereoCovoxPorts[0]) ch = 5;          // left pair
                else if (low === this.stereoCovoxPorts[1]) ch = 6;     // right pair
            }
            else if (this.dacType === 'specdrum') { if (low === 0xDF) ch = 4; }
            else if (this.dacType === 'soundrive1') {
                ch = { 0x0F: 0, 0x1F: 1, 0x4F: 2, 0x5F: 3 }[low];
                if (ch === undefined) ch = -1;
            } else if (this.dacType === 'soundrive2') {
                ch = { 0xF1: 0, 0xF3: 1, 0xF9: 2, 0xFB: 3 }[low];
                if (ch === undefined) ch = -1;
            }
            if (ch < 0) return;
            if (ch === 4) this.dacLevels.fill(val);
            else if (ch === 5) { this.dacLevels[0] = this.dacLevels[1] = val; }
            else if (ch === 6) { this.dacLevels[2] = this.dacLevels[3] = val; }
            else this.dacLevels[ch] = val;
            this.dacChanges.push({ tStates: this.cpu.tStates, ch, value: val });
        }

        /** Numpad/gamepad set to a Timex joystick (not the Kempston port) */
        _joystickIsTimex() {
            return this.joystickType === 'timex1' || this.joystickType === 'timex2';
        }

        /** Timex joystick port byte (active high) for joystick 0 or 1 */
        _timexJoystick(which) {
            if (this.joystickType !== (which ? 'timex2' : 'timex1')) return 0;
            return kempstonToTimex(this.kempstonState | this.gamepadState);
        }

        /** Is the HC IF1 usable: HC-2000 with hc-if1.rom loaded. */
        _isHcIf1Present() {
            return this.hcIf1 !== null && this.memory.hasHcIf1Rom();
        }

        /**
         * Which machines may have a Didaktik at all.
         *
         * A 48K always may. A 128K may only with `didaktik128Patch`, the
         * hardware modification some 48-to-128K upgrade services fitted
         * (VELESOFT: "Some 48to128kB upgrades also contain hardware patch for
         * enable use D40 or D80"). Without it the interface's ports collide
         * with the 128K paging port and the AY, and its ROM finds the 128
         * editor beneath it instead of 48K BASIC -- so a stock 128K cannot.
         *
         * Limited to the Sinclair-compatible 128K/+2. The +2A/+3 decode $7FFD
         * differently and VELESOFT rules them out by name; Pentagon and
         * Scorpion ship their own disk interface (`betaDiskDefault`), so the
         * patch is not a thing that was ever fitted to them.
         */
        _didaktikMachineOk() {
            if (this.profile.pagingModel === 'none') return true;
            return this.didaktik128Patch &&
                this.profile.pagingModel === '128k' &&
                !this.profile.betaDiskDefault;
        }

        _isDidaktikActive() {
            // Like the +D: the ports answer whenever the hardware is there, not
            // only while its ROM happens to be paged in
            return this.didaktikEnabled && this.didaktik &&
                this.memory.hasDidaktikRom() &&
                this._didaktikMachineOk();
        }

        _isDiscipleActive() {
            return this.discipleEnabled && this.memory.hasDiscipleRom() &&
                this.profile.pagingModel !== '+2a' && !this.hcIf1;
        }

        triggerDiscipleNmi() {
            if (!this._isDiscipleActive()) return;
            this.memory.discipleActive = true;
            this._addCpuT(this.cpu.nmi());
        }

        // DISCiPLE port read: FDC $1B/$5B/$9B/$DB, $BB pages in, $7B sets the
        // ROM low. Returns undefined for ports it does not own ($1F reads the
        // Kempston joystick as usual).
        _discipleRead(lowByte) {
            switch (lowByte) {
                case 0x1B: return this.disciple.readRegister(0);
                case 0x5B: return this.disciple.readRegister(1);
                case 0x9B: return this.disciple.readRegister(2);
                case 0xDB: return this.disciple.readRegister(3);
                case 0xBB: this.memory.discipleActive = true; return 0xFF;
                case 0x7B: this.memory.discipleRomLow = true; return 0xFF;
                case 0x1F:
                    // Joystick 1 (Kempston-compatible, bits 0-4) plus the network
                    // line (bit 7) and printer BUSY (bit 6), both active low: idle
                    // = 1. GDOS polls bit 7 on every interrupt (NET_SERVER); read
                    // as 0 it waits out two timeout loops each frame.
                    return ((this.kempstonState | this.gamepadState) & 0x1F) | 0xC0;
            }
            return undefined;
        }

        // DISCiPLE port write; true when the port was the DISCiPLE's
        _discipleWrite(lowByte, val) {
            switch (lowByte) {
                case 0x1B: this.disciple.writeRegister(0, val); return true;
                case 0x5B: this.disciple.writeRegister(1, val); return true;
                case 0x9B: this.disciple.writeRegister(2, val); return true;
                case 0xDB: this.disciple.writeRegister(3, val); return true;
                case 0x1F:  // control: b0 1 = drive 1 / 0 = drive 2, b1 side, b3 ROM bank
                    this.disciple.drive = (val & 0x01) ? 0 : 1;
                    this.disciple.side = (val & 0x02) ? 1 : 0;
                    this.memory.discipleRomBank = (val >> 3) & 1;
                    return true;
                case 0xBB: this.memory.discipleActive = false; return true;
                case 0x7B: this.memory.discipleRomLow = false; return true;
                case 0x3B: case 0xFB: return true;      // net wait, printer data: no-ops
            }
            return false;
        }

        triggerPlusDNmi() {
            if (!this._isPlusDActive()) return;
            this.memory.plusDActive = true;
            // An NMI acknowledge is 11 T-states and the CPU does not charge them
            // itself — `nmi()` returns them the way `interrupt()` does, and every
            // one of these six call sites used to drop the number on the floor,
            // so an NMI cost the machine nothing at all. Invisible at the scale
            // of a frame; not invisible against a DRQ due 112 T out.
            this._addCpuT(this.cpu.nmi());
        }

        portRead(port, instructionTiming = 12) {
            let result = 0xff;

            // I/O contention for IN. This used to be gated on ulaProfile === '48k',
            // so a 128K or +2 never waited on a port at all although its ULA contends
            // exactly as the 48K's does (ctprobe P-01, P-03D, P-04, P-05). The gate
            // that belongs here is the profile's own hasIOContention, which
            // applyIOTimingsForRead already applies — it is false on the +2A/+3,
            // whose gate array does not contend I/O, and on the clones.
            {
                // When the I/O cycle happens, before any wait is added. The floating
                // bus needs this: the byte it returns is whatever the ULA has on the
                // bus at that moment, and `cpu.tStates` is still the INSTRUCTION's
                // start tick (the length is added after the instruction runs). Reading
                // it there put our bytes 11 ticks late — the one thing ctprobe P-02
                // still complained about, and visible in Woodmass's Float48K as data
                // appearing at tick 14350 instead of 14339.
                this._ioCycleT = this.cpu.tStates + (IO_OFFSET_READ[instructionTiming] || 8);
                const ioDelay = this.applyIOTimingsForRead(port, instructionTiming);
                if (ioDelay > 4) {
                    this.cpu.tStates += (ioDelay - 4);
                }
            }

            // Scorpion TURBO+: reading the paging ports switches the turbo, IN
            // from $1FFD off and from $7FFD on (decode 00/01xxxxxxxx1xxx01)
            if (this.profile.scorpionTurbo) {
                const dec = port & 0xC023;
                if (dec === 0x0021) this.setHwTurbo(1);
                else if (dec === 0x4021) this.setHwTurbo(2);
            }

            // Debug: log first 50 port reads after halted INT detected
            if (this.debugFloatingBus && this._floatBusLogActive && this._floatBusLogCount < 50) {
                const t = this.cpu.tStates;
                console.log(`[PORT-READ] T=${t} port=0x${port.toString(16).padStart(4,'0')}`);
            }

            // RZX playback - return recorded input for ALL port reads
            // RZX records ALL IN instruction results, not just keyboard ports
            // Frame advancement happens at interrupt time (1:1 sync)
            let rzxHandled = false;
            if (this.rzxPlaying && this.rzxPlayer) {
                const frameIdx = this.rzxFrame;
                const frameInfo = this.rzxPlayer.getFrameInfo(frameIdx);
                const inputIdxBefore = frameInfo ? frameInfo.inputIndex : -1;

                const input = this.rzxPlayer.getNextInput(frameIdx);
                result = (input !== null) ? input : 0xFF;
                rzxHandled = true;

                // Store recent input for debug overlay
                this.rzxLastPort = port;
                this.rzxRecentInputs.push({ port, value: result, frame: frameIdx });
                if (this.rzxRecentInputs.length > 10) {
                    this.rzxRecentInputs.shift();
                }
            }

            // Normal port emulation (also used for non-keyboard ports during RZX playback)
            if (!rzxHandled) {
                // Check port breakpoint using unified trigger system
                if (this.running && this.triggers.length > 0) {
                    const trigger = this.checkPortTriggers(port, 0xff, false);
                    if (trigger) {
                        this.portBreakpointHit = true;
                        this.triggerHit = true;
                        this.lastPortBreakpoint = { port, direction: 'in', breakpoint: trigger };
                        this.lastTrigger = { trigger, port, direction: 'in' };
                    }
                }

                const lowByte = port & 0xff;
                const highByte = (port >> 8) & 0xff;

                // Interface 1 (Microdrive) ports — checked before +D (port conflict on $E7/$EF)
                const if1Active = this._isIF1Active();

                // +D interface ports (when enabled and ROM paged in or disk inserted)
                const plusDActive = this._isPlusDActive();

                // Didaktik 80 ports
                const didaktikActive = this._isDidaktikActive();

                // Beta Disk ports (Pentagon with disk inserted)
                // Ports are accessible whenever any disk is inserted, not just when ROM is paged in
                // (TR-DOS code runs in RAM but still needs disk access)
                const betaDiskActive = this._isBetaDiskActive();


                if (this.gsOn && this.gs.rom && (lowByte & 0xF7) === 0xB3) {
                    // General Sound: $BB status, $B3 data from the GS
                    this.gs.syncTo(this.cpu.tStates);
                    result = this.gs.portIn(lowByte);
                } else if (this.profile.gama80k && (lowByte === 0x7F || lowByte === 0x5F) && !this.memory.trdosActive) {
                    // Didaktik Gama 8255: control reads $FF (MHB8255), port C its latch
                    result = lowByte === 0x7F ? 0xFF : this._gamaPortC;
                } else if (this.profile.timex && (lowByte === 0xFF || lowByte === 0xF4)) {
                    // Timex SCLD: DEC (display mode) and HSR read back
                    result = lowByte === 0xFF ? this.memory.timexDec : this.memory.timexHsr;
                } else if (this.profile.timexAy && (lowByte === 0xF5 || lowByte === 0xF6)) {
                    // TC2068 AY (FUSE tc2068_ay_*port_read): register 14 is the
                    // joystick port -- reads $FF via $F5; via $F6 its latch when
                    // R7 bit 6 makes it an output, else $FF (no joystick fitted)
                    const reg = this.ay.selectedRegister;
                    if (reg !== 14) result = this.ay.readRegister();
                    else if (lowByte === 0xF5) result = 0xFF;
                    else {
                        // FUSE tc2068_ay_dataport_read: the port latch if R7 bit 6
                        // makes it an output, else $FF; A8 selects joystick 1 and
                        // A9 joystick 2 onto it, a pressed direction pulling its
                        // bit low
                        result = (this.ay.registers[7] & 0x40) ? this.ay.registers[14] : 0xFF;
                        if (port & 0x0100) result &= ~this._timexJoystick(0);
                        if (port & 0x0200) result &= ~this._timexJoystick(1);
                    }
                } else if (this.profile.pagingModel === 'hc2000' && (lowByte & 0x81) === 0) {
                    // HC-2000 config latch $7E (A7=0, A0=0). The HC decodes its
                    // ULA port with A7=1 too ("HC Ports", A. D. Ioan), so the
                    // keyboard does not answer here; FUSE reads the latch back.
                    result = this.memory.hcConfig;
                } else if (this.profile.profRomPlanes && this.memory.trdosActive && lowByte === 0xBE) {
                    // SMUC's IDE registers ($F8BE-$FFBE, DOS on; the ULA does not
                    // answer then) with no drive on the cable: the ATA pull-down
                    // on D7 reads as not busy, so the ProfROM says "HDD not
                    // found" at once instead of waiting a minute for BUSY to
                    // drop off a floating bus
                    result = 0x7F;
                } else if ((lowByte & 0x01) === 0 && !(this.profile.timex && lowByte !== 0xFE)) {
                    // Port 0xFE: keyboard + EAR input
                    // Bits 0-4: keyboard (active low)
                    // Bit 5: HIGH (pulled up)
                    // Bit 6: EAR input - LOW when no tape signal (Issue 2/3 behavior)
                    // Bit 7: HIGH (pulled up)
                    // Note: Real 48K has floating bus on bits 5,7 during screen fetch,
                    // but this causes issues with Z80 CPU tests that expect consistent 0xBF.
                    // Most software and tests expect bits 5,7 to be HIGH.
                    // Floating bus is still available via other port reads (else branch).
                    const keyboard = this.ula.readKeyboard(highByte) & 0x1f;
                    // EAR bit (bit 6) - LOW when no tape, HIGH when tape signal active
                    // Issue 2/3 ULA: reads LOW when no tape connected
                    // Issue 4+ ULA: reads HIGH when no tape connected
                    // We emulate Issue 2/3 behavior (most compatible with tests)

                    // Auto-start turbo block playback when custom loader reads port 0xFE.
                    // Only trigger from RAM (PC >= SLOT1_START) to avoid false triggers from
                    // ROM keyboard scan (ISR at ~0x0038→0x028E reads port 0xFE for all
                    // 8 half-rows). Without this check, the pilot starts playing during
                    // an interrupt BEFORE the custom loader runs, and short pilots expire
                    // before the loader can sync.
                    if (this._turboBlockPending && !this.tapePlayer.isPlaying() &&
                        this.cpu.pc >= SLOT1_START) {
                        this._lastTapeUpdate = this.cpu.tStates;  // Reset tape timing tracker
                        this.tapePlayer.play();
                        this._turboBlockPending = false;
                        console.log('[TZX] Auto-start turbo playback at PC=' +
                            this.cpu.pc.toString(16).padStart(4, '0') +
                            ', tStates=' + this.cpu.tStates +
                            ', block=' + this.tapePlayer.currentBlock +
                            ', phase=' + this.tapePlayer.phase +
                            ', flashLoad=' + this.tapeFlashLoad);
                    }

                    // CRITICAL: Update tape to the T-state when I/O actually occurs
                    // IN A,(n) is 11 T-states: fetch(4) + operand(3) + I/O(4)
                    // The actual port read happens at T-state ~7 within the instruction
                    // cpu.tStates is the count BEFORE this instruction, so add offset
                    if (this.tapePlayer.isPlaying()) {
                        const IO_OFFSET = 7;  // T-state within IN instruction when I/O read occurs
                        const tStatesNow = this.cpu.tStates + IO_OFFSET;
                        const elapsed = tStatesNow - this._lastTapeUpdate;
                        if (elapsed > 0) {
                            this.tapePlayer.update(elapsed, tStatesNow);
                            this._lastTapeUpdate = tStatesNow;
                        }
                        this.tapeEarBit = this.tapePlayer.getEarBit();
                    }

                    const ear = this.tapeEarBit ? 0x40 : 0x00;
                    result = keyboard | 0xa0 | ear; // Bits 5,7 always high
                } else if (this.hcIf1 && HcIf1.isFdcPort(lowByte)) {
                    // HC IF1 floppy controller ($85/$87) and select latch ($05/$07).
                    // Ahead of Kempston, which would otherwise answer $05/$07.
                    result = this.hcIf1.read(lowByte, this.diskClockNow());
                } else if (this.fdc && this.profile.hasFDC && (port & DECODE_PLUS2A_MASK2) === DECODE_FDC_MSR) {
                    // µPD765 FDC Main Status Register (0x2FFD) — ZX Spectrum +3
                    result = this.fdc.readMSR();
                } else if (this.fdc && this.profile.hasFDC && (port & DECODE_PLUS2A_MASK2) === DECODE_FDC_DATA) {
                    // µPD765 FDC Data Register (0x3FFD) — ZX Spectrum +3
                    result = this.fdc.readData();
                } else if (if1Active && (lowByte & 0x01) === 1 && ((lowByte & IF1_PORT_MASK) === IF1_PORT_DATA ||
                           (lowByte & IF1_PORT_MASK) === IF1_PORT_CTL)) {
                    // Interface 1 Microdrive ports (data $E7 or status $EF)
                    const if1Reg = lowByte & IF1_PORT_MASK;
                    if (if1Reg === IF1_PORT_DATA) {
                        result = this.microdrive.readData();
                    } else {
                        result = this.microdrive.readStatus();
                    }
                } else if (this._isDiscipleActive() &&
                           (this._discipleIn = this._discipleRead(lowByte)) !== undefined) {
                    result = this._discipleIn;      // DISCiPLE ports
                } else if (plusDActive && (lowByte === PORT_PLUSD_CMD || lowByte === PORT_PLUSD_TRACK ||
                           lowByte === PORT_PLUSD_SEC || lowByte === PORT_PLUSD_DATA)) {
                    // +D WD1772 registers ($E3/$EB/$F3/$FB) — $EF is write-only per FUSE
                    result = this.plusD.read(port);
                } else if (plusDActive && lowByte === PORT_PLUSD_PAGE) {
                    // +D paging register read ($E7) — pages in +D ROM/RAM
                    this.memory.plusDActive = true;
                    result = 0;
                } else if (plusDActive && lowByte === PORT_PLUSD_PRINT) {
                    // +D Centronics status ($F7): bit 7 = printer busy. No printer
                    // is attached, so never busy — see the constant for why this
                    // cannot just fall through to the floating bus.
                    result = 0;
                } else if (didaktikActive && (lowByte === DIDAKTIK_PORT_COMMAND ||
                           lowByte === DIDAKTIK_PORT_TRACK || lowByte === DIDAKTIK_PORT_SECTOR ||
                           lowByte === DIDAKTIK_PORT_DATA)) {
                    // Didaktik 80 WD2797 registers ($81/$83/$85/$87)
                    result = this.didaktik.read(port);
                } else if (this._kempdiscEnabledFlag && this.kempdisc.isFdcPort(lowByte)) {
                    result = this.kempdisc.portIn(lowByte);     // Kempston Disc WD1770
                } else if (this._fdd3000PagingEnabled && lowByte === 0xEF) {
                    result = this.fdd3000.portIn();     // FDD 3000: station -> Spectrum
                } else if (this.memory.beta48On &&
                           (this._beta48In = this._beta48Read(lowByte)) !== undefined) {
                    result = this._beta48In;        // Beta 48 FDC / system port
                } else if (betaDiskActive && (lowByte === PORT_WD_CMD || lowByte === PORT_WD_TRACK ||
                           lowByte === PORT_WD_SECTOR || lowByte === PORT_WD_DATA)) {
                    // Beta Disk WD1793 registers
                    result = this.betaDisk.read(port);
                } else if (betaDiskActive && lowByte === PORT_WD_SYS) {
                    // Beta Disk system register
                    result = this.betaDisk.read(port);
                } else if (this.profile.pagingModel === 'scorpion' && !this.memory.trdosActive &&
                           (port & 0x00A3) === 0x0003) {
                    // Scorpion, DOS off: $1F (xxxxxxxx0x0xxx11) gives the Beta
                    // Disk's INTRQ / DRQ in bits 7-6 (MAME scorpion_io); the
                    // ProfROM waits on them from its service ROM. The Kempston
                    // stick, when fitted, in bits 0-4.
                    result = this.betaDisk ? (this.betaDisk.read(0xFF) & 0xC0) : 0;
                    if (this.kempstonEnabled && !this._joystickIsTimex()) {
                        result |= (this.kempstonState | this.gamepadState) & 0x1f;
                    }
                } else if (this.kempstonEnabled && !this._joystickIsTimex() &&
                           (lowByte & DECODE_KEMPSTON_MASK) === DECODE_KEMPSTON) {
                    // Port 0x1F: Kempston joystick (only when no Beta Disk)
                    // Bits 0-4: standard (Right, Left, Down, Up, Fire/B)
                    // Bits 5-7: extended (C, A, Start) - active high
                    //
                    // The port is claimed only when the interface is fitted. With no
                    // card in the slot nothing drives the bus, so the read must fall
                    // through to the floating-bus/idle value below — returning 0x00
                    // here would read as "Kempston present, stick centred", which is
                    // exactly what detection routines look for.
                    result = (this.kempstonState | this.gamepadState) & 0x1f;
                    if (this.kempstonExtendedEnabled) {
                        result |= ((this.kempstonExtendedState | this.gamepadExtState) & 0xe0);
                    }
                } else if (lowByte === 0xdf && this.kempstonMouseEnabled && !this.hcIf1) {
                    // Kempston Mouse ports (FADF=buttons, FBDF=X, FFDF=Y)
                    const mouseReg = highByte & 0x05;
                    if (mouseReg === 0x00) {
                        // FADF: Buttons (bits 0-2: right/left/middle active low)
                        // Bits 7:4 = wheel position (0-15) if wheel enabled
                        result = this.kempstonMouseButtons & 0x07;
                        if (this.kempstonMouseWheelEnabled) {
                            result |= (this.kempstonMouseWheel & 0x0f) << 4;
                        }
                    } else if (mouseReg === 0x01) {
                        // FBDF: X position (0-255)
                        result = this.kempstonMouseX & 0xff;
                    } else if (mouseReg === 0x05) {
                        // FFDF: Y position (0-255)
                        result = this.kempstonMouseY & 0xff;
                    }
                } else if (this.ula.ulaplus.enabled && port === PORT_ULAPLUS_REG) {
                    // ULAplus data port read
                    result = this.ula.ulaplusReadData();
                } else if ((port & DECODE_AY_MASK) === DECODE_AY_REG && !this.profile.timexAy) {
                    // Port 0xFFFD: AY register read (128K/Pentagon, or 48K with AY enabled)
                    if (this._ayOnPorts()) {
                        if (this.tsfm && this._fmStatusRead) {
                            // TS-FM status mode: busy | timer B | timer A
                            this._fmSync();
                            result = this.fmTimers[this._aySel].readStatus();
                        } else if (this.tsfm && this._fmAddr[this._aySel] >= 0x10) {
                            result = 0xFF;      // an FM address latched: nothing to read
                        } else if (this.profile.scorpionTurbo && this._curAy().selectedRegister === 14) {
                            // TURBO+: register 14 reads the paging back (MAME
                            // ay_data_r): 7FFD bit 4 -> bit 5, 1FFD bit 4, 7FFD bits 0-3
                            const m = this.memory, p7 = m.scorpionPort7FFD, p1 = m.scorpionPort1FFD;
                            result = ((p7 & 0x10) << 1) | (p1 & 0x10) | (p7 & 0x0F);
                        } else {
                            result = this._curAy().readRegister();
                        }
                    }
                } else {
                    // Floating bus: the byte the ULA has on the bus right now.
                    // The 48K and the 128K/+2 both have one (ctprobe P-02 read 255 for
                    // every tick on the 128K, and so did Woodmass's Float128K); the
                    // +2A/+3 gate array does not, and nor do the clones, which is what
                    // hasFloatingBus says.
                    if (this.profile.attrBusPorts) {
                        // Scorpion: an unused port reads the ATTRIBUTE the screen
                        // hardware is fetching (its programmer's manual), not the
                        // alternating bitmap/attribute of a Ferranti floating bus.
                        result = this.getAttrBusValue();
                    } else if (this.profile.hasFloatingBus) {
                        result = this.getFloatingBusValue();
                        // Debug: log floating bus reads - only after halted INT
                        if (this.debugFloatingBus && this._floatBusLogActive && this._floatBusLogCount < 500) {
                            const t = this.cpu.tStates;
                            const line = Math.floor(t / this.timing.tstatesPerLine);
                            const tInLine = t % this.timing.tstatesPerLine;
                            this._floatBusLogCount++;
                            console.log(`[FLOAT] T=${t} line=${line} tInLine=${tInLine} port=0x${port.toString(16)} result=0x${result.toString(16).padStart(2,'0')} late=${this.lateTimings}`);
                        }
                    }
                }
            }

            // Track port read for trace (only during runtime tracing, not step tracing)
            if (this.runtimeTraceEnabled && this.onBeforeStep && this.matchesPortTraceFilter(port)) {
                this.tracePortOps.push({ dir: 'in', port, val: result });
            }

            // Port I/O logging for debugging
            if (this.portLogEnabled && this.matchesPortTraceFilter(port)) {
                this.portLog.push({
                    dir: 'IN',
                    port: port,
                    value: result,
                    pc: this.cpu.pc,
                    src: this.getPortSource(),
                    frame: this.totalFrames,
                    rzxFrame: this.rzxPlaying ? this.rzxFrame : -1,
                    t: this.cpu.tStates
                });
            }

            // Profiler: track port reads per subroutine
            if (this.profiler.enabled) {
                const sub = this._profilerCurrentSub();
                if (sub) {
                    const key = this.getAutoMapKey(sub.addr);
                    const stats = this.profiler.subroutines.get(key);
                    if (stats) stats.portsIn.add(port);
                }
            }

            // RZX recording - record all port read results
            if (this.rzxRecording && this.rzxRecordCurrentFrame) {
                this.rzxRecordCurrentFrame.inputs.push(result);
            }

            // Port-read provenance: which instruction reads which port. Last, so
            // `result` is the value the CPU actually gets (RZX playback included).
            if (this.portReadProvenance.enabled) {
                this._notePortRead(port, result);
            }

            return result;
        }

        portWrite(port, val, instructionTiming = 12) {
            // Track port write for trace (only during runtime tracing, not step tracing)
            if (this.runtimeTraceEnabled && this.onBeforeStep && this.matchesPortTraceFilter(port)) {
                this.tracePortOps.push({ dir: 'out', port, val });
            }

            // Port I/O logging for debugging
            if (this.portLogEnabled && this.matchesPortTraceFilter(port)) {
                this.portLog.push({
                    dir: 'OUT',
                    port: port,
                    value: val,
                    pc: this.cpu.pc,
                    src: this.getPortSource(),
                    frame: this.totalFrames,
                    rzxFrame: this.rzxPlaying ? this.rzxFrame : -1,
                    t: this.cpu.tStates
                });
            }

            // Profiler: track port writes per subroutine
            if (this.profiler.enabled) {
                const sub = this._profilerCurrentSub();
                if (sub) {
                    const key = this.getAutoMapKey(sub.addr);
                    const stats = this.profiler.subroutines.get(key);
                    if (stats) {
                        stats.portsOut.add(port);
                        if ((port & 0x01) === 0) stats.beeperOuts++;
                    }
                }
            }

            // Check port breakpoint using unified trigger system
            if (this.running && this.triggers.length > 0) {
                const trigger = this.checkPortTriggers(port, val, true);
                if (trigger) {
                    this.portBreakpointHit = true;
                    this.triggerHit = true;
                    this.lastPortBreakpoint = { port, direction: 'out', val, breakpoint: trigger };
                    this.lastTrigger = { trigger, port, val, direction: 'out' };
                }
            }

            const lowByte = port & 0xff;

            // Interface 1 (Microdrive) ports — checked before +D (port conflict on $E7/$EF)
            const if1Active = this._isIF1Active();

            // +D interface ports (when enabled and ROM paged in or disk inserted)
            const plusDActive = this._isPlusDActive();

            // Didaktik 80 ports
            const didaktikActive = this._isDidaktikActive();

            // Beta Disk ports (when enabled and any disk inserted)
            const betaDiskActive = this._isBetaDiskActive();

            // DAC (Covox / Specdrum / Soundrive): write-only, not exclusive
            if (this.dacType !== 'none') this._dacWrite(lowByte, val);
            // General Sound: $BB command, $B3 data to the GS, $33 control
            if (this.gsOn && this.gs.rom && (lowByte & 0xF7) === 0xB3) {
                this.gs.syncTo(this.cpu.tStates);
                this.gs.portOut(lowByte, val);
            } else if (this.gsOn && this.gs.rom && lowByte === 0x33) {
                this.gs.syncTo(this.cpu.tStates);
                this.gs.control(val);           // $33: bit 7 card reset, bit 6 NMI
            }
            // SAA1099: $01FF address, $00FF data (not on a Timex, whose $FF is
            // the SCLD's, nor while TR-DOS is paged in, as in Xpeccy)
            if (this.saaOn && lowByte === 0xFF && !this.profile.timex && !this.memory.trdosActive) {
                this.saaChanges.push({ tStates: this.cpu.tStates, addr: (port >> 8) & 1, value: val });
            }

            // Didaktik Gama: its 8255 (ports xxx11111, A6-A5 pick A/B/C/control);
            // PC0 selects the 32KB bank at $8000. Not while TR-DOS owns the ports.
            if (this.profile.gama80k && (lowByte & 0x9F) === 0x1F && !this.memory.trdosActive) {
                this._gama8255Write((lowByte >> 5) & 3, val);
            }

            // TKMEM-128 II latch. The board's GAL decodes A15=0, A5=1, A1=0 only,
            // so the Beta 48 DOS trampoline (OUT ($FC),A with A = 0 / 7, i.e. ports
            // $00FC / $07FC, in every TR-DOS 4.x, CAS, Vision and CBI ROM) pages
            // bank 0/7 in under the DOS's own stack and hangs it. 'a14' adds
            // A14=1 to the decode, which 7FFD has and $xxFC with B < $40 has not.
            // Write-only, not exclusive (the port carries on to the rest).
            if (this.memory.tkmemRam &&
                (this.tkmemDecode === 'gal' ? (port & 0x8022) === 0x0020
                                            : (port & 0xC022) === 0x4020)) {
                this.memory.writeTkmem(val);
            }

            // Beta 48 master register: any port xxxxxx00 ($FC is the border as
            // well). Bit 7 = 1 switches its I/O off; on the CBI clones bit 6 = 1
            // switches the $3Cxx ROM window off.
            if (this.memory.beta48On && (lowByte & 0x03) === 0) {
                this._beta48Master = val;
                this.memory.beta48WindowOff = this._beta48Variant() === 'cbi' && (val & 0x40) !== 0;
            }

            // The wait is decided by the port's HIGH byte, not by whether the ULA
            // answers: a port in $40xx-$7Fxx is contended whatever its low byte, and
            // an odd one waits four times over. This used to sit inside the
            // even-port branch below, so `OUT ($40FF),A` never waited at all
            // (ctprobe P-03C). Only the BORDER is the ULA's business, and that stays
            // where it was.
            const tStatesBefore = this.cpu.tStates;
            const ioDelay = this.applyIOTimings(port, instructionTiming);
            const contentionOnly = Math.max(0, ioDelay - 4);   // ioDelay includes the 4T base
            this.cpu.tStates += contentionOnly;

            if (this.debugIOTiming && contentionOnly > 0) {
                console.log(`IO_TIMING port=${port.toString(16)} tBefore=${tStatesBefore} ioDelay=${ioDelay} contentionOnly=${contentionOnly}`);
            }

            // HC-2000: the ULA port is A7=1, A0=0 — $7E (A7=0) is the config
            // latch alone and leaves border and beeper alone
            // Timex SCLD: DEC ($FF, display mode / INT mask) and HSR ($F4)
            if (this.profile.timex && (lowByte === 0xFF || lowByte === 0xF4)) {
                if (lowByte === 0xFF) this.ula.setTimexDec(val, this.cpu.tStates + 8);
                else this.memory.timexHsr = val;
                return;
            }
            if ((lowByte & 0x01) === 0 &&
                !(this.profile.pagingModel === 'hc2000' && (lowByte & 0x80) === 0) &&
                !(this.profile.timex && lowByte !== 0xFE)) {
                // Border change timing
                // Calculate frame-relative T-state when border color changes
                // cpu.tStates accumulates from frameStartOffset, need to subtract to get frame-relative
                // The border color takes effect at a specific point during the OUT instruction
                // Based on racing-the-beam: "actual data is being sent on the 7th cycle of OUT"

                // I/O timing offset for border changes
                // OUT (C),r is 12T, OUT (n),A is 11T - different timing offsets needed
                // 48K: OUT (n),A offset depends on whether instruction is in contended memory
                //      Contended ($4000-$7FFF): offset 11 (Aquaplane) - contention adds to tStates
                //      Non-contended: offset 8 (Venom) - no extra delay
                //      OUT (C),r: offset 9 (ULA48)
                // 128K: base 9, +4 for OUT (C),r to match ULA128 test timing
                let ioOffset;
                if (this.profile.ulaProfile === 'pentagon') {
                    ioOffset = 11;
                } else if (this.profile.ulaProfile === '128k') {
                    // OUT (C),r (12T) needs +4 more than OUT (n),A for ULA128 test.
                    // MEASURED, not derived, and the obvious derivation is WRONG: the
                    // +4 looks like the port contention a 128K never applied (its
                    // portRead/portWrite were gated to the 48K until that was fixed),
                    // but making it the port offset plus one, as the 48K does, breaks
                    // ULA128 by 6728 px and scroll17 by 5760. Whatever these two
                    // encode, it is not that. Re-derive only with evidence.
                    ioOffset = (instructionTiming === 12) ? 13 : 9;
                } else {
                    // 48K: instruction location affects timing
                    if (instructionTiming === 12) {
                        ioOffset = 9;  // OUT (C),r
                    } else {
                        // OUT (n),A: check if instruction is in contended memory
                        // PC points to instruction after OUT, so PC-2 is the OUT opcode
                        const outPC = (this.cpu.pc - 2) & 0xffff;
                        const inContendedMem = (outPC >= SLOT1_START && outPC < SLOT2_START);
                        ioOffset = inContendedMem ? 11 : 8;
                    }
                }

                // Frame-relative T-state when the I/O write occurs
                // Note: cpu.tStates is already frame-relative (overshoot subtracted at frame start)
                const frameT = this.cpu.tStates + ioOffset;

                // Debug: log border timing (enable via console: spectrum.debugBorderOut = true)
                // For paper boundary debug: spectrum.debugPaperBoundary = true (only logs near line 64)
                const LINE_TIMES_BASE = this.ula.LINE_TIMES_BASE;
                const TSTATES_PER_LINE = this.ula.TSTATES_PER_LINE;
                const relT = frameT - LINE_TIMES_BASE;
                const visY = Math.floor(relT / TSTATES_PER_LINE);
                const lineT = relT - (visY * TSTATES_PER_LINE);
                const pixel = Math.floor(lineT * 2);
                // Pentagon: no quantization; 48K/128K: quantize to 4T boundaries
                const quantizedT = !this.profile.borderQuantization ? frameT : (frameT & ~3);
                const quantizedPixel = Math.floor(((quantizedT - LINE_TIMES_BASE) % TSTATES_PER_LINE) * 2);
                const nearPaperBoundary = visY >= 22 && visY <= 26;  // Around line 64 (paper start)

                if ((this.debugBorderOut || (this.debugPaperBoundary && nearPaperBoundary)) &&
                    (val & 0x07) !== this.lastDebugBorderColor) {
                    console.log(`OUT border=${val & 0x07} PC=$${this.cpu.pc.toString(16)} tStates=${this.cpu.tStates} frameT=${frameT}→${quantizedT} visY=${visY} px=${pixel}→${quantizedPixel} timing=${instructionTiming}T ioOff=${ioOffset}`);
                    this.lastDebugBorderColor = val & 0x07;
                }

                // Pass to ULA - it will calculate beam position internally.
                // Timex hi-res: the border shows the hi-res paper; port $FE's
                // colour is kept for when hi-res ends.
                if (this.profile.timex) this.ula.timexLoresBorder = val & 0x07;
                if (!(this.profile.timex && (this.memory.timexDec & 0x04))) this.ula.setBorderAt(val & 0x07, frameT);

                // Track beeper output for audio generation (bit 4 = EAR output)
                const newBeeperLevel = (val & 0x10) ? 1 : 0;
                if (newBeeperLevel !== this.beeperLevel) {
                    this.beeperLevel = newBeeperLevel;
                    this.beeperChanges.push({ tStates: frameT, level: newBeeperLevel });
                }

                // Track MIC output (bit 3) for tape save recording
                this.micRecorder.writeMic((val >> 3) & 1, this.cpu.tStates);

                // Don't return - port $7FFC triggers BOTH ULA AND paging for scroll17 effect
            }
            if (if1Active && (lowByte & 0x01) === 1 && ((lowByte & IF1_PORT_MASK) === IF1_PORT_DATA ||
                (lowByte & IF1_PORT_MASK) === IF1_PORT_CTL)) {
                // Interface 1 Microdrive ports (data $E7 or control $EF)
                const if1Reg = lowByte & IF1_PORT_MASK;
                if (if1Reg === IF1_PORT_DATA) {
                    this.microdrive.writeData(val);
                } else {
                    this.microdrive.writeControl(val);
                }
                return;
            }
            if (this._isDiscipleActive() && this._discipleWrite(lowByte, val)) {
                return;
            }
            if (plusDActive && (lowByte === PORT_PLUSD_CMD || lowByte === PORT_PLUSD_TRACK ||
                lowByte === PORT_PLUSD_SEC || lowByte === PORT_PLUSD_DATA ||
                lowByte === PORT_PLUSD_CTRL)) {
                // +D WD1772 registers + control ($E3/$EB/$F3/$FB/$EF)
                this.plusD.write(port, val);
                return;
            }
            if (plusDActive && lowByte === PORT_PLUSD_PAGE) {
                // +D paging register write ($E7) — pages out +D ROM/RAM
                this.memory.plusDActive = false;
                return;
            }
            if (plusDActive && lowByte === PORT_PLUSD_PRINT) {
                // +D Centronics data ($F7) — no printer attached, discard
                return;
            }
            if (didaktikActive && (lowByte === DIDAKTIK_PORT_COMMAND ||
                lowByte === DIDAKTIK_PORT_TRACK || lowByte === DIDAKTIK_PORT_SECTOR ||
                lowByte === DIDAKTIK_PORT_DATA ||
                (lowByte & DIDAKTIK_PORT_AUX_MASK) === DIDAKTIK_PORT_AUX)) {
                // Didaktik 80 WD2797 registers plus the aux register at $89
                this.didaktik.write(port, val);
                return;
            }
            if (this._fdd3000PagingEnabled && lowByte === 0xEF) {
                this.fdd3000.portOut(val);              // FDD 3000: Spectrum -> station
                return;
            }
            // Kempston Disc: WD1770, drive select $DF, ROM in $FD / out $D7
            if (this._kempdiscEnabledFlag && this.kempdisc.portOut(port & 0xFFFF, val)) {
                this.memory.kempdiscActive = this.kempdisc.active;
                if (this.kempdisc.isFdcPort(lowByte)) return;
            }
            if (this.memory.beta48On && this._beta48Write(lowByte, val)) {
                return;
            }
            if (betaDiskActive && (lowByte === PORT_WD_CMD || lowByte === PORT_WD_TRACK ||
                lowByte === PORT_WD_SECTOR || lowByte === PORT_WD_DATA)) {
                // Beta Disk WD1793 registers
                this.betaDisk.write(port, val);
                return;
            }
            if (betaDiskActive && lowByte === PORT_WD_SYS) {
                // Beta Disk system register
                this.betaDisk.write(port, val);
                return;
            }
            // Port 0x7FFD: memory paging
            // 128K/+2/Pentagon: (port & DECODE_128K_MASK) === 0 (A15=0, A1=0) — loose decode
            // +2A/+3/Scorpion: (port & DECODE_PLUS2A_MASK) === DECODE_7FFD_PLUS2A (A15=0, A14=1, A1=0) — stricter decode
            // Scorpion uses +3-style decode per FUSE (PERIPH_TYPE_PLUS3_MEMORY)
            //   prevents OUT ($FD),A writes (port=$xxFD where A≠$7F) from triggering 7FFD
            const is7FFD = (this.profile.pagingModel === '+2a' || this.profile.pagingModel === 'scorpion')
                ? (port & DECODE_PLUS2A_MASK) === DECODE_7FFD_PLUS2A
                : (port & DECODE_128K_MASK) === 0;
            // HC-2000: config latch at $7E (A7=0, A0=0) and the CPM signal on $C5/$C7
            if (this.profile.pagingModel === 'hc2000') {
                if ((port & 0x81) === 0) {
                    if (this.memory.writeHcConfig(val)) {
                        this.ula.setScreenBankAt(this.memory.screenBank,
                            this.cpu.tStates + (instructionTiming - 2));
                    }
                } else if (lowByte === 0xC5 || lowByte === 0xC7) {
                    this.memory.writeHcMemPort(lowByte);
                }
            }
            if (this.profile.pagingModel !== 'none' && this.profile.pagingModel !== 'hc2000' && is7FFD) {
                const oldScreenBank = this.memory.screenBank;
                this.memory.writePaging(val);
                // Track screen bank changes for scroll17-style effects
                const newScreenBank = this.memory.screenBank;
                if (newScreenBank !== oldScreenBank) {
                    // Screen bank changes use instruction_end - 2
                    // For +8px right shift compared to border timing (-8)
                    // OUTI (16T): bank change at tStates + 14
                    // cpu.tStates is already frame-relative
                    const bankChangeTime = this.cpu.tStates + (instructionTiming - 2);
                    this.ula.setScreenBankAt(newScreenBank, bankChangeTime);
                }
            }

            // +2A/+3 port 0x1FFD: special paging, ROM bank high bit, and FDC motor control
            if (this.profile.pagingModel === '+2a' && (port & DECODE_PLUS2A_MASK2) === DECODE_1FFD_PLUS2A) {
                this.memory.write1FFD(val);
                if (this.fdc) this.fdc.setMotor(!!(val & 0x08));
            }

            // HC IF1 floppy controller and select latch. 3.5 MHz is the HC's
            // clock; the 555 monostable does not care about the odd part per mille.
            if (this.hcIf1 && HcIf1.isFdcPort(lowByte)) {
                this.hcIf1.write(lowByte, val, this.diskClockNow(), 3500000);
            }

            // µPD765 FDC data register write (port 0x3FFD)
            if (this.fdc && this.profile.hasFDC && (port & DECODE_PLUS2A_MASK2) === DECODE_FDC_DATA) {
                this.fdc.writeData(val);
            }

            // Scorpion port 0x1FFD: extended paging (RAM page high bit, ROM bank high bit, RAM-over-ROM)
            // Uses +3-style decode (per FUSE): (port & 0xF002) === 0x1000
            if (this.profile.pagingModel === 'scorpion' && (port & DECODE_PLUS2A_MASK2) === DECODE_1FFD_PLUS2A) {
                this.memory.writeScorpion1FFD(val);
            }

            // Pentagon 1024 port 0xEFF7: extended memory control
            // Port decode: A12=0, A13=1, A14=1, A15=1
            if (this.profile.pagingModel === 'pentagon1024' && (port & DECODE_P1024_MASK) === DECODE_P1024_VAL) {
                this.memory.writePortEFF7(val);
            }

            // AY-3-8910 ports (128K/Pentagon, or 48K with AY enabled)
            // (not on the HC IF1's own ports: OUT ($87),A with A15 set would
            // otherwise also hit an add-on AY's decode)
            // TC2068: its AY sits on $F5 (register select) and $F6 (data)
            if (this.profile.timexAy && (lowByte === 0xF5 || lowByte === 0xF6)) {
                if (lowByte === 0xF5) {
                    this.ay.selectRegister(val);
                } else {
                    const reg = this.ay.selectedRegister;
                    this.ay.writeRegister(val);
                    this.ayChanges.push({ tStates: this.cpu.tStates, reg, value: this.ay.registers[reg] });
                }
                return;
            }
            if (this._ayOnPorts() && !this.profile.timexAy && !(this.hcIf1 && HcIf1.isFdcPort(lowByte))) {
                if ((port & DECODE_AY_MASK) === DECODE_AY_REG) {
                    // Port 0xFFFD: AY register select (TurboSound: $FF/$FE pick the chip)
                    if (this.tsfm && (val & 0xF8) === 0xF8) {
                        // TS-FM control word: chip, status mode, FM on
                        this._aySel = (val & 1) ? 0 : 1;
                        this._fmStatusRead = !(val & 2);
                        this._fmOn = !(val & 4);
                    } else if (this.tsfm) {
                        // an address: < $10 the SSG's register, >= $10 an FM one
                        // (the SSG keeps its previous register then)
                        this._fmAddr[this._aySel] = val;
                        if (val < 0x10) this._curAy().selectRegister(val);
                    } else if (this.turboSound && (val & 0xFE) === 0xFE) this._aySel = (val & 1) ? 0 : 1;
                    else this._curAy().selectRegister(val);
                } else if ((port & DECODE_AY_MASK) === DECODE_AY_DATA) {
                    // Port 0xBFFD: AY register write. Applied immediately (so register
                    // readback / AY-detection see the value), and also recorded with its
                    // frame-relative T-state so processFrame can replay intra-frame
                    // volume changes (digitized speech) at the right moment.
                    if (this.tsfm) {
                        this._fmSync();
                        const chip = this._aySel, a = this._fmAddr[chip];
                        this.fmTimers[chip].write(a, val);       // busy, and the timer registers
                        if (a >= 0x10) {
                            this.fmChanges.push({ tStates: this.cpu.tStates, chip, reg: a, value: val });
                            return;
                        }
                    }
                    const ay = this._curAy();
                    const reg = ay.selectedRegister;
                    ay.writeRegister(val);
                    this.ayChanges.push({ tStates: this.cpu.tStates, reg, value: ay.registers[reg],
                        chip: ay === this.ay2 ? 1 : 0 });
                    // 128 MIDI out: R14 bit 2 (or R7 turning port A round), and the
                    // FIRST chip only -- MIDI OUT is the 128K's own AY port A.
                    // `ay === this.ay` is belt-and-braces rather than the thing
                    // that makes it so: _midiLine() reads this.ay whatever is
                    // selected, and acts only on a CHANGE of level, so a write to
                    // a TurboSound second chip could not move the line even
                    // without this test (measured -- removing it alters nothing
                    // either suite can see). It stays because it says what is
                    // meant and saves the call; what would really break MIDI is
                    // _midiLine() reading _curAy(), which midi-test pins.
                    if (this.midiEnabled && ay === this.ay && (reg === 14 || reg === 7)) this._midiLine();
                }
            }

            // ULAplus ports (when enabled)
            if (this.ula.ulaplus.enabled) {
                if (port === PORT_ULAPLUS_DATA) {
                    // ULAplus register select
                    this.ula.ulaplusWriteRegister(val);
                } else if (port === PORT_ULAPLUS_REG) {
                    // ULAplus data write - pass T-states for raster effect tracking
                    this.ula.ulaplusWriteData(val, this.cpu.tStates);
                }
            }
        }

        // ========== Frame Execution ==========

        runFrame() {
            const tstatesPerFrame = this.timing.tstatesPerFrame;
            const tstatesPerLine = this.timing.tstatesPerLine;

            // Preserve T-state overshoot from previous frame (Swan-style)
            // If instruction ended past frame boundary, carry over the excess
            if (this.cpu.tStates >= tstatesPerFrame) {
                this.breakpointTStates += tstatesPerFrame;
                this.cpu.tStates -= tstatesPerFrame;
                this._diskClockBase += tstatesPerFrame;
                // Also adjust tape timing tracker to stay in sync
                if (this._lastTapeUpdate >= tstatesPerFrame) {
                    this._lastTapeUpdate -= tstatesPerFrame;
                } else {
                    this._lastTapeUpdate = this.cpu.tStates;
                }
            } else if (this.cpu.tStates < 0 || isNaN(this.cpu.tStates)) {
                // Safety: reset to 0 if invalid
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;
            }

            // Track frame start offset for border timing adjustment
            this.frameStartOffset = this.cpu.tStates;

            // Reset accumulated contention for new frame (ULA timing)
            this.accumulatedContention = 0;

            // Poll hardware gamepad at start of frame (disabled during RZX playback)
            if (!this.rzxPlaying) {
                this.pollGamepad();
            }

            this.ula.startFrame();
            this.ula.processExtendedMode(); // Process extended mode key sequences
            this.lastContentionLine = -1;  // Reset per-line contention tracking
            this.beeperChanges = [];       // Reset beeper changes for new frame
            // Snapshot AY state (replay baseline) and clear this frame's writes
            this.ayStateSnapshot = this.ay ? this.ay.exportState() : null;
            this.ayChanges = [];
            this.ay2StateSnapshot = this.turboSound ? this.ay2.exportState() : null;
            this.dacChanges = [];
            this._dacStart = this.dacLevels.slice();
            this._saaFlush();
            this._fmFlush();
            if (this.gsOn) this.gs.beginFrame(tstatesPerFrame);

            // Start new frame for tape player (reset edge transitions)
            if (this.tapePlayer.isPlaying()) {
                this.tapePlayer.startFrame(this.cpu.tStates);
            }

            // RZX playback: reset T-states at frame start for proper scanline rendering
            // RZX frames end based on instruction count, not T-states, so T-states can drift
            // This ensures all scanlines are rendered from the beginning each frame
            if (this.rzxPlaying) {
                this.cpu.tStates = 0;
            }

            // Track which line to render next (account for overshoot)
            let nextLineToRender = Math.floor(this.cpu.tStates / tstatesPerLine);
            const totalLines = Math.floor(tstatesPerFrame / tstatesPerLine);

            // INT pulse duration from profile (32 T-states for 48K, 36 for 128K/Pentagon)
            const intPulseDuration = this.profile.intPulseDuration;
            let intFired = false;

            // INT pulse window: [intStart, intEnd)
            // Early 48K: [0, 32), Late 48K: [1, 33), 128K/Pentagon: [0, 36)
            const intOffset = (this.profile.earlyIntTiming && this.lateTimings) ? 1 : 0;
            const intStart = intOffset;
            // Timex: DEC bit 6 masks the frame interrupt
            const intEnd = (this.profile.timex && (this.memory.timexDec & 0x40))
                ? intStart : intOffset + intPulseDuration;

            // RZX recording: track instruction count before first interrupt
            let rzxRecInstrBeforeInt = this.rzxRecording ? this.cpu.instructionCount : 0;

            // Fire interrupt if within INT pulse window from previous frame overshoot
            // During RZX playback: fire early interrupt unconditionally if CPU is halted
            // (HALT can only exit via interrupt, and T-states may not be in sync during RZX)
            const rzxHaltedNeedsInt = this.rzxPlaying && this.cpu.halted && this.cpu.iff1 && !this.cpu.eiPending;
            const normalIntWindow = !this.rzxPlaying &&
                this.cpu.tStates >= intStart && this.cpu.tStates < intEnd &&
                this.cpu.iff1 && !this.cpu.eiPending;
            // A real Z80 executes the instruction at PC before accepting an interrupt.
            // If PC sits on a not-yet-executed HALT, enter the halt state first so
            // interrupt() returns to the instruction AFTER the HALT (PC+1). Otherwise
            // the INT pushes the HALT's own address and a handler that re-enables
            // interrupts only in its post-HALT loop body halts forever — which froze
            // demos resumed from a snapshot whose PC was saved on an EI/HALT main loop
            // (snapshot load resets frame-start tStates to 0, landing in the INT window).
            if (normalIntWindow && !this.cpu.halted && this.memory.read(this.cpu.pc) === 0x76) {
                this.cpu.halted = true;
            }
            if (rzxHaltedNeedsInt || normalIntWindow) {
                // RZX recording: capture instruction count BEFORE interrupt
                if (this.rzxRecording && !intFired) {
                    rzxRecInstrBeforeInt = this.cpu.instructionCount;
                }
                const _intOldPC = this.cpu.pc, _intOldSP = this.cpu.sp;
                this._suppressWatchpoints = true;
                const intTstates = this.cpu.interrupt();
                this._suppressWatchpoints = false;
                this._addCpuT(intTstates);
                this._trackInterruptCall(_intOldPC, _intOldSP);
                intFired = true;

                // RZX recording: start recording RIGHT AFTER interrupt fires
                // This ensures snapshot is at interrupt handler entry (PC=$0038, IFF1=false)
                // and Frame 0 captures the keyboard scan that follows
                if (this.rzxRecordPending) {
                    this.rzxStartRecordingNow();
                }
            }

            // RZX playback: cache expected fetch count for this frame
            let rzxExpectedFetchCount = 0;
            let rzxSafetyLimit = 0;  // Safety limit to prevent infinite loops
            if (this.rzxPlaying && this.rzxPlayer) {
                const frameInfo = this.rzxPlayer.getFrameInfo(this.rzxFrame);
                if (frameInfo) {
                    rzxExpectedFetchCount = frameInfo.fetchCount;
                    // Safety limit: 2x expected count - if exceeded, something is very wrong
                    rzxSafetyLimit = rzxExpectedFetchCount * 2;
                }
            }

            // Cache feature flags before the loop (avoid repeated property access)
            const hasBreakpoints = this.execBreakpointSet.size > 0;
            const tracing = this.runtimeTraceEnabled && this.onBeforeStep;
            const autoMapEnabled = this.autoMap.enabled;
            const xrefEnabled = this.xrefTrackingEnabled && this.onInstructionExecuted;
            const needsInstrPC = xrefEnabled || tracing;
            const contentionEnabled = this.profile.hasContention && this.contentionEnabled;
            const isPentagon = this.profile.ulaProfile === 'pentagon';
            // (noRomTraps: not at the 48K addresses; exromTapeTraps: the TC2068's own)
            const tapeTrapsEnabled = this.tapeTrapsEnabled && (!this.profile.noRomTraps || !!this.profile.exromTapeTraps);
            const trdosTrapEnabled = this.tapeTrapsEnabled && !this.profile.noRomTraps;
            const tapeIsPlaying = this.tapePlayer.isPlaying();

            // Main frame loop - runs until tstatesPerFrame (or until instruction count during RZX)
            // During RZX playback, frame ends based on instruction count, not T-states (FUSE-style)
            while (this.rzxPlaying ? true : this.cpu.tStates < tstatesPerFrame) {

                // Render complete scanline (paper + border) at line END
                // Line-end rendering ensures all beam-racing attribute writes (e.g. Nirvana
                // multicolor engine) are captured in attrChanges before the T-state lookup
                // resolves them per-column. Paper-start rendering would fire before the CPU
                // has executed those writes, breaking multicolor effects.
                while (nextLineToRender < totalLines) {
                    const lineEndT = (nextLineToRender + 1) * tstatesPerLine;
                    if (this.cpu.tStates >= lineEndT) {
                        this.ula.renderScanline(nextLineToRender);
                        nextLineToRender++;
                    } else {
                        break;
                    }
                }

                // Beta Disk automatic ROM paging (Pentagon, or 48K/128K with Beta Disk enabled)
                if (this._betaDiskPagingEnabled) this.updateBetaDiskPaging();
                // Interface 1 ROM auto-paging ($0008/$1708 page in, $0700 page out)
                if (this._if1PagingEnabled) this.updateIF1Paging();
                // +D ROM auto-paging ($0008/$003A/$0066/$028E page in, port $E3 bit 6 page out)
                if (this._plusDPagingEnabled) this.updatePlusDPaging();
                // DISCiPLE auto-paging ($0001/$0008/$0066/$028E page in, port $BB page out)
                if (this._disciplePagingEnabled) this.updateDisciplePaging();
                // Didaktik 80 ROM auto-paging ($0000/$0008 page in, $1700 page out)
                if (this._didaktikPagingEnabled) this.updateDidaktikPaging();
                // Timex FDD 3000 interface ROM ($0000/$0008 in, after $0604 out)
                if (this._fdd3000PagingEnabled && !this.memory.fdd3000Active &&
                    (this.cpu.pc === 0x0000 || this.cpu.pc === 0x0008)) this.memory.fdd3000Active = true;
                // Check breakpoint using unified trigger system (skip if no breakpoints)
                const execTrigger = hasBreakpoints ? this.checkExecTriggers(this.cpu.pc) : null;
                if (execTrigger) {
                    this.breakpointHit = true;
                    this.triggerHit = true;
                    this.lastTrigger = { trigger: execTrigger, addr: this.cpu.pc, type: 'exec' };
                    this.breakpointTStates += this.cpu.tStates;
                    this.stop();
                    // Complete rendering of remaining lines
                    while (nextLineToRender < totalLines) {
                        this.ula.renderScanline(nextLineToRender++);
                    }
                    const frameBuffer = this.ula.endFrame();
                    // Don't overwrite previousFrameBuffer - keep the last complete frame for beam mode
                    this.blitFrame(frameBuffer);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.drawOverlay();
                    if (this.onBreakpoint) this.onBreakpoint(this.cpu.pc);
                    if (this.onTrigger) this.onTrigger(this.lastTrigger);
                    this._bpTStatesResetPending = true;
                    return;
                }
                if (tapeTrapsEnabled && this.tapeTrap.checkTrap()) continue;
                if (tapeTrapsEnabled && this.tapeSaveTrap.checkTrap()) continue;
                if (trdosTrapEnabled && this.trdosTrap.checkTrap()) continue;

                // Apply ULA contention per-line for 48K and 128K
                if (contentionEnabled) {
                    const ulaContention = this.ula.ULA_CONTENTION_TSTATES || 0;
                    if (ulaContention > 0) {
                        const line = Math.floor(this.cpu.tStates / tstatesPerLine);
                        const firstScreenLine = this.ula.FIRST_SCREEN_LINE;
                        const screenLine = line - firstScreenLine;

                        if (screenLine >= 0 && screenLine < 192) {
                            if (this.lastContentionLine !== line) {
                                this.lastContentionLine = line;
                                this.cpu.tStates += ulaContention;
                            }
                        }
                    }
                }

                // Execute ONE instruction
                this.autoMap.inExecution = true;
                const tStatesBefore = this.cpu.tStates;
                if (this.cpu.halted) {
                    // Process eiPending during HALT NOP cycles (same as instruction boundary)
                    if (this.cpu.eiPending) {
                        this.cpu.eiPending = false;
                        this.cpu.iff1 = this.cpu.iff2 = true;
                    }

                    // Normal HALT NOP — M1 fetch from (PC+1), subject to contention
                    if (contentionEnabled && this.cpu.contend) {
                        this.cpu.resetContend();
                        this.cpu.contend((this.cpu.pc + 1) & 0xffff);
                    }
                    const _haltTsBefore = this.cpu.tStates;
                    this.cpu.tStates += 4;
                    if (this._turboMul > 1) this._turboSpend(_haltTsBefore);
                    this.cpu.incR();
                    if (this._fdd3000PagingEnabled) this.fdd3000.step();   // the station keeps going
                    this.cpu.instructionCount++;  // HALT NOP is an M1 cycle for RZX
                    if (this.profiler.enabled) {
                        const _pcKey = this.getAutoMapKey(this.cpu.pc);
                        const _haltTsCost = this.cpu.tStates - _haltTsBefore;
                        this.profiler.tStatesPerPC.set(_pcKey, (this.profiler.tStatesPerPC.get(_pcKey) || 0) + _haltTsCost);
                    }

                    // Check if INT should fire after this HALT NOP
                    if (!this.rzxPlaying && !intFired &&
                        this.cpu.tStates >= intStart && this.cpu.tStates < intEnd &&
                        this.cpu.iff1 && !this.cpu.eiPending) {
                        if (this.rzxRecording) {
                            rzxRecInstrBeforeInt = this.cpu.instructionCount;
                        }
                        const _hintOldPC = this.cpu.pc, _hintOldSP = this.cpu.sp;
                        this._suppressWatchpoints = true;
                        const intTstates = this.cpu.interrupt();
                        this._suppressWatchpoints = false;
                        this._addCpuT(intTstates);
                        this._trackInterruptCall(_hintOldPC, _hintOldSP);
                        intFired = true;
                        if (this.rzxRecordPending) {
                            this.rzxStartRecordingNow();
                        }
                        this.autoMap.inExecution = false;
                        continue;
                    }

                    // Record trace for first HALT only (avoids flooding trace with repeated HALTs)
                    if (tracing && !this.haltTraced) {
                        this.haltTraced = true;
                        // HALT is always 0x76
                        this.onBeforeStep(this.cpu, this.memory, this.cpu.pc, null, null, [0x76, 0, 0, 0]);
                    }

                    // RZX playback: check if instruction count reached (FUSE-style frame end)
                    if (this.rzxPlaying && rzxExpectedFetchCount > 0) {
                        const m1Count = this.cpu.instructionCount - this.rzxFrameStartInstr;
                        if (m1Count >= rzxExpectedFetchCount) {
                            this.autoMap.inExecution = false;
                            break;  // End frame - instruction count reached
                        }
                        // Safety check: if way over expected count, break to prevent infinite loop
                        if (rzxSafetyLimit > 0 && m1Count > rzxSafetyLimit) {
                            console.error(`RZX F${this.rzxFrame}: safety limit exceeded (HALT)! M1=${m1Count} expected=${rzxExpectedFetchCount} limit=${rzxSafetyLimit}`);
                            this.autoMap.inExecution = false;
                            break;
                        }
                    }
                } else {
                    // Reset HALT traced flag when CPU exits HALT
                    this.haltTraced = false;
                    // Clear trace ops and capture state before execution
                    if (tracing) {
                        this.tracePortOps = [];
                        this.traceMemOps = [];
                    }
                    // Capture PC and instruction bytes before execution for xref/trace tracking
                    // (instruction may modify memory at its own address, e.g. LD (nn),IX)
                    const instrPC = needsInstrPC ? this.cpu.pc : 0;
                    let instrBytes = null;
                    if (tracing) {
                        this._suppressWatchpoints = true;
                        instrBytes = [
                            this.memory.read(instrPC),
                            this.memory.read((instrPC + 1) & 0xffff),
                            this.memory.read((instrPC + 2) & 0xffff),
                            this.memory.read((instrPC + 3) & 0xffff)
                        ];
                        this._suppressWatchpoints = false;
                    }
                    const _csOldPC = this.cpu.pc, _csOldSP = this.cpu.sp;
                    this._currentInstrPC = _csOldPC;
                    const _tsBefore = this.cpu.tStates;
                    this._inCpuExecution = true;
                    this.cpu.execute();
                    this._inCpuExecution = false;
                    if (this._turboMul > 1) this._turboSpend(_tsBefore);
                    // FDD 3000: out once the RET at $0604 has run; its station's
                    // Z80 runs along, one instruction per ours (two every fifth)
                    if (this._fdd3000PagingEnabled) {
                        if (this._currentInstrPC === 0x0604) this.memory.fdd3000Active = false;
                        this.fdd3000.step();
                    }
                    // IF1 page-out: deferred to after RET at $0700 executes
                    if (this._if1PageOutPending) {
                        this.memory.if1Active = false;
                        this._if1PageOutPending = false;
                    }
                    // Opus DRQ is wired to NMI, delayed to the chip's byte rate
                    if (this._opusNmiPending) {
                        if (this.diskClockNow() >= this._opusDrqDue) {
                            this._opusNmiPending = false;
                            // DRQ is a level, not a pulse: if the transfer
                            // finished while the NMI was queued there is no
                            // edge left to deliver.
                            if (this.opus.hasDataRequest()) this._addCpuT(this.cpu.nmi());
                        }
                    }
                    // Didaktik DRQ/INTRQ, same deal
                    if (this._didaktikNmiPending) {
                        if (this.diskClockNow() >= this._didaktikDrqDue) {
                            this._didaktikNmiPending = false;
                            this._addCpuT(this.cpu.nmi());
                        }
                    }
                    // Opus paging is checked AFTER the instruction, not before it
                    if (this._opusPagingEnabled) this.updateOpusPaging(_csOldPC);
                    this._trackCallStack(_csOldPC, _csOldSP);
                    if (this.indirectJumps.enabled) this._trackIndirectJump(_csOldPC);
                    // Profiler: track CALL/RST entries and per-PC T-states
                    if (this.profiler.enabled) {
                        this._profilerTrackCallRet(_csOldPC, _csOldSP);
                        const _tsCost = this.cpu.tStates - _tsBefore;
                        const _pcKey = this.getAutoMapKey(_csOldPC);
                        this.profiler.tStatesPerPC.set(_pcKey, (this.profiler.tStatesPerPC.get(_pcKey) || 0) + _tsCost);
                    }
                    // If HALT instruction was just executed, mark as traced to avoid duplicate
                    if (this.cpu.halted) {
                        this.haltTraced = true;
                    }
                    // Record trace after execution (includes port/mem ops)
                    if (tracing) {
                        this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                    }
                    // Call xref tracking callback if enabled
                    if (xrefEnabled) {
                        this.onInstructionExecuted(instrPC);
                    }

                    // RZX playback: check if instruction count reached (FUSE-style frame end)
                    if (this.rzxPlaying && rzxExpectedFetchCount > 0) {
                        const m1Count = this.cpu.instructionCount - this.rzxFrameStartInstr;
                        if (m1Count >= rzxExpectedFetchCount) {
                            this.autoMap.inExecution = false;
                            break;  // End frame - instruction count reached
                        }
                        // Safety check: if way over expected count, break to prevent infinite loop
                        if (rzxSafetyLimit > 0 && m1Count > rzxSafetyLimit) {
                            console.error(`RZX F${this.rzxFrame}: safety limit exceeded! M1=${m1Count} expected=${rzxExpectedFetchCount} limit=${rzxSafetyLimit}`);
                            this.autoMap.inExecution = false;
                            break;
                        }
                    }

                    // Check if INT should fire after this instruction
                    if (!this.rzxPlaying && !intFired &&
                        this.cpu.tStates >= intStart && this.cpu.tStates < intEnd &&
                        this.cpu.iff1 && !this.cpu.eiPending) {
                        if (this.rzxRecording) {
                            rzxRecInstrBeforeInt = this.cpu.instructionCount;
                        }
                        const _mintOldPC = this.cpu.pc, _mintOldSP = this.cpu.sp;
                        this._suppressWatchpoints = true;
                        const intTstates = this.cpu.interrupt();
                        this._suppressWatchpoints = false;
                        this._addCpuT(intTstates);
                        this._trackInterruptCall(_mintOldPC, _mintOldSP);
                        intFired = true;
                        if (this.rzxRecordPending) {
                            this.rzxStartRecordingNow();
                        }
                    }
                }

                this.autoMap.inExecution = false;

                // Update tape player for real-time playback
                // Note: May have been partially updated during port reads for accurate timing
                if (tapeIsPlaying) {
                    const tStatesNow = this.cpu.tStates;
                    const elapsed = tStatesNow - this._lastTapeUpdate;
                    if (elapsed > 0) {
                        this.tapePlayer.update(elapsed, tStatesNow);
                        this._lastTapeUpdate = tStatesNow;
                    }
                    this.tapeEarBit = this.tapePlayer.getEarBit();
                }

                // Clear fetch tracking for auto-map (per instruction)
                if (autoMapEnabled) {
                    this.autoMap.currentFetchAddrs.clear();
                }

                // Check watchpoint (using unified trigger system)
                if (this.watchpointHit) {
                    this.watchpointHit = false;
                    this.triggerHit = false;
                    this.breakpointTStates += this.cpu.tStates;
                    this.stop();
                    // Complete rendering of remaining lines
                    while (nextLineToRender < totalLines) {
                        this.ula.renderScanline(nextLineToRender++);
                    }
                    const frameBuffer = this.ula.endFrame();
                    // Don't overwrite previousFrameBuffer - keep the last complete frame for beam mode
                    this.blitFrame(frameBuffer);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.drawOverlay();
                    if (this.onWatchpoint) this.onWatchpoint(this.lastWatchpoint);
                    if (this.onTrigger) this.onTrigger(this.lastTrigger);
                    this._bpTStatesResetPending = true;
                    return;
                }

                // Check port breakpoint (using unified trigger system)
                if (this.portBreakpointHit) {
                    this.portBreakpointHit = false;
                    this.triggerHit = false;
                    this.breakpointTStates += this.cpu.tStates;
                    this.stop();
                    // Complete rendering of remaining lines
                    while (nextLineToRender < totalLines) {
                        this.ula.renderScanline(nextLineToRender++);
                    }
                    const frameBuffer = this.ula.endFrame();
                    // Don't overwrite previousFrameBuffer - keep the last complete frame for beam mode
                    this.blitFrame(frameBuffer);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.drawOverlay();
                    if (this.onPortBreakpoint) this.onPortBreakpoint(this.lastPortBreakpoint);
                    if (this.onTrigger) this.onTrigger(this.lastTrigger);
                    this._bpTStatesResetPending = true;
                    return;
                }

                // Check code path trace hit
                if (this.codePath.traceHit) {
                    this.codePath.traceHit = false;
                    this.breakpointTStates += this.cpu.tStates;
                    this.stop();
                    while (nextLineToRender < totalLines) {
                        this.ula.renderScanline(nextLineToRender++);
                    }
                    const frameBuffer = this.ula.endFrame();
                    this.blitFrame(frameBuffer);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.drawOverlay();
                    if (this.onCodePathHit) this.onCodePathHit(this.codePath.traceAddr);
                    this._bpTStatesResetPending = true;
                    return;
                }

                // Check tape block trigger hit
                if (this.tapeBlockHit) {
                    this.tapeBlockHit = false;
                    this.triggerHit = false;
                    this.breakpointTStates += this.cpu.tStates;
                    this.stop();
                    while (nextLineToRender < totalLines) {
                        this.ula.renderScanline(nextLineToRender++);
                    }
                    const frameBuffer = this.ula.endFrame();
                    this.blitFrame(frameBuffer);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.drawOverlay();
                    if (this.onTrigger) this.onTrigger(this.lastTrigger);
                    this._bpTStatesResetPending = true;
                    return;
                }

                // Check disk trigger hit
                if (this.diskTriggerHit) {
                    this.diskTriggerHit = false;
                    this.triggerHit = false;
                    this.breakpointTStates += this.cpu.tStates;
                    this.stop();
                    while (nextLineToRender < totalLines) {
                        this.ula.renderScanline(nextLineToRender++);
                    }
                    const frameBuffer = this.ula.endFrame();
                    this.blitFrame(frameBuffer);
                    this.ctx.putImageData(this.imageData, 0, 0);
                    this.drawOverlay();
                    if (this.onTrigger) this.onTrigger(this.lastTrigger);
                    this._bpTStatesResetPending = true;
                    return;
                }
            }

            // RZX playback: capture M1 count BEFORE interrupt (fetchCount excludes interrupt acknowledge)
            const rzxM1BeforeInt = this.rzxPlaying ? (this.cpu.instructionCount - this.rzxFrameStartInstr) : 0;

            // RZX recording: calculate fetchCount at end of frame (after all instructions)
            // This matches RZX playback which uses M1 count at frame boundary, not at early interrupt
            const rzxRecFetchCount = this.rzxRecording ?
                (this.cpu.instructionCount - this.rzxRecordStartInstr) : 0;

            // RZX playback: fire interrupt at frame end (FUSE-style)
            // During RZX playback, the frame ended when instruction count was reached
            // Now fire the interrupt to start the next frame's execution
            if (this.rzxPlaying && this.cpu.iff1 && !this.cpu.eiPending) {
                const _rzxIntOldPC = this.cpu.pc, _rzxIntOldSP = this.cpu.sp;
                this._suppressWatchpoints = true;
                const intTstates = this.cpu.interrupt();
                this._suppressWatchpoints = false;
                this._addCpuT(intTstates);
                this._trackInterruptCall(_rzxIntOldPC, _rzxIntOldSP);
            }

            // Render remaining lines
            while (nextLineToRender < totalLines) {
                this.ula.renderScanline(nextLineToRender++);
            }

            const frameBuffer = this.ula.endFrame();

            // Handle border-only modes: replace paper area with border color
            // Use proper T-state calculation to extend border into paper area
            const borderOnlyMode = this.overlayMode === 'screen' || this.overlayMode === 'reveal' || this.overlayMode === 'beamscreen';
            if (borderOnlyMode) {
                const dims = this.ula.getDimensions();
                const changes = this.ula.borderChanges;
                const palette = this.ula.palette;

                // Fill paper area with border colors
                for (let y = dims.borderTop; y < dims.borderTop + dims.screenHeight; y++) {
                    // Calculate T-state range for this line
                    const lineStartTstate = this.ula.calculateLineStartTstate(y);

                    // Find starting color for this line
                    let currentColor = (changes && changes.length > 0) ? changes[0].color : this.ula.borderColor;
                    let changeIdx = 0;

                    if (changes && changes.length > 0) {
                        for (let i = 0; i < changes.length; i++) {
                            if (changes[i].tState <= lineStartTstate) {
                                currentColor = changes[i].color;
                                changeIdx = i + 1;
                            } else {
                                break;
                            }
                        }
                    }

                    // Fill paper area with proper border colors based on T-state
                    for (let x = dims.borderLeft; x < dims.borderLeft + dims.screenWidth; x++) {
                        // T-state for this pixel position
                        const pixelTstate = lineStartTstate + Math.floor(x / 2);

                        // Update color if there are changes before this T-state
                        if (changes) {
                            while (changeIdx < changes.length && changes[changeIdx].tState <= pixelTstate) {
                                currentColor = changes[changeIdx].color;
                                changeIdx++;
                            }
                        }

                        // Ensure color index is valid and get RGB from palette
                        const colorIdx = currentColor & 7;
                        const rgb = palette ? palette[colorIdx] : [0, 0, 0, 255];
                        const idx = (y * dims.width + x) * 4;
                        frameBuffer[idx] = rgb[0];
                        frameBuffer[idx + 1] = rgb[1];
                        frameBuffer[idx + 2] = rgb[2];
                        frameBuffer[idx + 3] = 255;
                    }
                }
            }

            // Save frame for beam visualization modes AFTER border-only modification
            // so previousFrameBuffer includes border lines in paper area
            this.savePreviousFrame(frameBuffer);

            this.blitFrame(frameBuffer);
            this.ctx.putImageData(this.imageData, 0, 0);

            // Draw overlay if enabled
            this.drawOverlay();

            // Memory freeze: rewrite locked addresses at frame end
            if (this.frozenAddresses.length > 0) {
                this._suppressWatchpoints = true;
                for (const f of this.frozenAddresses) this.memory.write(f.addr, f.value);
                this._suppressWatchpoints = false;
            }

            this.frameCount++;
            this.totalFrames++;
            this.micRecorder.onFrameEnd(this.cpu.tStates);
            if (this.onFrame) this.onFrame(this.frameCount);
            for (let i = 0; i < this.frameListeners.length; i++) this.frameListeners[i](this.frameCount);

            // Profiler: count down frames
            if (this.profiler.enabled) {
                this.profiler.framesRemaining--;
                if (this.profiler.framesRemaining <= 0) {
                    this.stopProfiling();
                }
            }

            // General Sound: run it to the end of the frame
            if (this.gsOn) this.gs.endFrame(tstatesPerFrame);

            // Process AY + beeper + tape audio for this frame (skip at high speeds - audio would be meaningless)
            if (this.audio && this.audio.enabled && !this.audioSuppressed && this.speed > 0 && this.speed <= 200) {
                // Get tape audio from tape player (if playing and enabled)
                // Also suppress tape audio briefly after returning from high speed
                const tapeAudioSuppressed = this._suppressTapeAudioUntil && Date.now() < this._suppressTapeAudioUntil;
                // Suppress tape audio in flash load mode — tape player may still run
                // for turbo block EAR bit generation, but audio output is muted
                const tapeAudioChanges = (this.tapeAudioEnabled && !this.tapeFlashLoad &&
                    this.tapePlayer.isPlaying() && !tapeAudioSuppressed)
                    ? this.tapePlayer.getEdgeTransitions() : [];

                // Pass tape audio changes (ROM doesn't echo tape signal to speaker)
                this.audio.processFrame(tstatesPerFrame, this.beeperChanges, this.beeperLevel, tapeAudioChanges, this.ayChanges, this.ayStateSnapshot,
                    { ay2: this.turboSound ? this.ay2 : null, ay2Snapshot: this.ay2StateSnapshot,
                      dacChanges: this.dacChanges, dacStart: this._dacStart, dacOn: this.dacType !== 'none',
                      saa: this.saaOn ? this.saa : null, saaChanges: this.saaChanges,
                      gs: this.gsOn && this.gs.rom ? this.gs : null,
                      fm: this.tsfm && this.turboSound ? this.fm : null, fmOn: this._fmOn, fmChanges: this.fmChanges, fmClock: this._fmMasterClock() });
            }

            // Advance AY logging frame counter
            if (this.ay) {
                this.ay.advanceLogFrame();
            }

            // RZX: advance 1 frame per emu frame (1:1 sync)
            if (this.rzxPlaying && this.rzxPlayer) {
                // Check input consumption before advancing (mismatch indicates desync)
                const frameInfo = this.rzxPlayer.getFrameInfo(this.rzxFrame);
                if (frameInfo) {
                    const m1Diff = rzxM1BeforeInt - frameInfo.fetchCount;
                    const inputsConsumed = frameInfo.inputIndex;
                    const inputsTotal = frameInfo.inputCount;

                    // Detailed debug logging for first N frames
                    if (this.rzxDebugFrames > 0 && this.rzxFrame < this.rzxDebugFrames) {
                        const debugEntry = {
                            frame: this.rzxFrame,
                            m1Actual: rzxM1BeforeInt,
                            m1Expected: frameInfo.fetchCount,
                            m1Diff: m1Diff,
                            inputsConsumed: inputsConsumed,
                            inputsTotal: inputsTotal,
                            inputs: frameInfo.inputs.slice(0, 20), // First 20 inputs
                            pc: this.cpu.pc,
                            sp: this.cpu.sp,
                            tStates: this.cpu.tStates
                        };
                        this.rzxDebugLog.push(debugEntry);
                        console.log(`RZX F${this.rzxFrame}: M1=${rzxM1BeforeInt}/${frameInfo.fetchCount} (${m1Diff >= 0 ? '+' : ''}${m1Diff}) IN=${inputsConsumed}/${inputsTotal} PC=${this.cpu.pc.toString(16)} T=${this.cpu.tStates}`);
                        if (inputsTotal > 0 && inputsTotal <= 10) {
                            console.log(`  inputs: [${frameInfo.inputs.map(v => v.toString(16).padStart(2,'0')).join(', ')}]`);
                        }
                    }

                    // Log M1 count mismatches (indicates instruction counting bug)
                    if (m1Diff !== 0) {
                        console.warn(`RZX F${this.rzxFrame}: M1 mismatch! actual=${rzxM1BeforeInt} expected=${frameInfo.fetchCount} diff=${m1Diff}`);
                    }
                    // Log input consumption mismatches (indicates code path divergence)
                    if (inputsConsumed !== inputsTotal) {
                        console.warn(`RZX F${this.rzxFrame}: input mismatch! consumed=${inputsConsumed}/${inputsTotal}`);
                    }
                }

                this.rzxFrameStartInstr = this.cpu.instructionCount;

                this.rzxFrame++;

                if (this.rzxFrame >= this.rzxPlayer.getFrameCount()) {
                    this.rzxStop();
                    if (this.onRZXEnd) this.onRZXEnd();
                }
            }

            // RZX recording: finalize current frame and start new one
            // Note: recording now starts immediately after interrupt fires (earlier in this function)
            // This is just a fallback in case the interrupt didn't fire this frame
            if (this.rzxRecordPending) {
                // Fallback: start recording at frame boundary if interrupt hasn't fired yet
                this.rzxStartRecordingNow();
                console.warn('[RZX REC] Started at frame boundary (fallback) - interrupt may not have fired');
            } else if (this.rzxRecording) {
                // Use fetchCount captured BEFORE interrupt (rzxRecFetchCount from above)
                if (this.rzxRecordCurrentFrame) {
                    this.rzxRecordCurrentFrame.fetchCount = rzxRecFetchCount;
                    this.rzxRecordedFrames.push(this.rzxRecordCurrentFrame);
                }

                // Start new frame - capture instruction count AFTER interrupt for next frame's start
                this.rzxRecordCurrentFrame = { fetchCount: 0, inputs: [] };
                this.rzxRecordStartInstr = this.cpu.instructionCount;
            }

            // Call pending snap callback at frame boundary (safe state for snapshots)
            if (this.pendingSnapCallback) {
                const callback = this.pendingSnapCallback;
                this.pendingSnapCallback = null;
                callback();
            }
        }

        // ========== Headless Execution (for test suite) ==========

        /**
         * Run a frame without rendering - for fast test execution
         * Returns the number of T-states executed
         */
        runFrameHeadless() {
            const tstatesPerFrame = this.timing.tstatesPerFrame;
            const tstatesPerLine = this.timing.tstatesPerLine;

            // Preserve T-state overshoot from previous frame (Swan-style)
            if (this.cpu.tStates >= tstatesPerFrame) {
                this.cpu.tStates -= tstatesPerFrame;
                this._diskClockBase += tstatesPerFrame;
                // Also adjust tape timing tracker to stay in sync
                if (this._lastTapeUpdate >= tstatesPerFrame) {
                    this._lastTapeUpdate -= tstatesPerFrame;
                } else {
                    this._lastTapeUpdate = this.cpu.tStates;
                }
            } else if (this.cpu.tStates < 0 || isNaN(this.cpu.tStates)) {
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;
            }

            // Track frame start offset for border timing adjustment
            this.frameStartOffset = this.cpu.tStates;

            // Reset accumulated contention for new frame (ULA timing)
            this.accumulatedContention = 0;

            this.ula.startFrame();
            this.ula.processExtendedMode(); // Process extended mode key sequences
            this.lastContentionLine = -1;
            this.beeperChanges = [];       // Reset beeper changes for new frame
            // Snapshot AY state (replay baseline) and clear this frame's writes
            this.ayStateSnapshot = this.ay ? this.ay.exportState() : null;
            this.ayChanges = [];
            this.ay2StateSnapshot = this.turboSound ? this.ay2.exportState() : null;
            this.dacChanges = [];
            this._dacStart = this.dacLevels.slice();
            this._saaFlush();
            this._fmFlush();
            if (this.gsOn) this.gs.beginFrame(tstatesPerFrame);

            // Start new frame for tape player (reset edge transitions)
            if (this.tapePlayer.isPlaying()) {
                this.tapePlayer.startFrame(this.cpu.tStates);
            }

            // RZX playback: reset T-states at frame start for proper scanline rendering
            // RZX frames end based on instruction count, not T-states, so T-states can drift
            // This ensures all scanlines are rendered from the beginning each frame
            if (this.rzxPlaying) {
                this.cpu.tStates = 0;
            }

            // INT pulse duration from profile (32 T-states for 48K, 36 for 128K/Pentagon)
            const intPulseDuration = this.profile.intPulseDuration;
            let intFired = false;

            // INT pulse window: [intStart, intEnd)
            // Early 48K: [0, 32), Late 48K: [1, 33), 128K/Pentagon: [0, 36)
            const intOffset = (this.profile.earlyIntTiming && this.lateTimings) ? 1 : 0;
            const intStart = intOffset;
            // Timex: DEC bit 6 masks the frame interrupt
            const intEnd = (this.profile.timex && (this.memory.timexDec & 0x40))
                ? intStart : intOffset + intPulseDuration;

            // Fire interrupt if within INT pulse window from previous frame overshoot
            // Skip during RZX playback - frame boundaries controlled by instruction count (FUSE-style)
            const hlNormalIntWindow = !this.rzxPlaying &&
                this.cpu.tStates >= intStart && this.cpu.tStates < intEnd &&
                this.cpu.iff1 && !this.cpu.eiPending;
            // Same HALT handling as runFrame: a real Z80 executes the instruction at
            // PC before accepting an interrupt, so a PC sitting on a not-yet-executed
            // HALT must enter the halt state first — otherwise the INT pushes the
            // HALT's own address and a handler that re-enables interrupts after the
            // HALT halts forever. Snapshots saved on an EI/HALT main loop land exactly
            // there, because loading one resets frame-start tStates into the INT
            // window. Without this, such a demo runs its first frame and then freezes,
            // which is invisible unless you look at the border (see tests/halt-int-test).
            if (hlNormalIntWindow && !this.cpu.halted && this.memory.read(this.cpu.pc) === 0x76) {
                this.cpu.halted = true;
            }
            if (hlNormalIntWindow) {
                const _hlIntOldPC = this.cpu.pc, _hlIntOldSP = this.cpu.sp;
                this._suppressWatchpoints = true;
                const intTstates = this.cpu.interrupt();
                this._suppressWatchpoints = false;
                this._addCpuT(intTstates);
                this._trackInterruptCall(_hlIntOldPC, _hlIntOldSP);
                intFired = true;
            }

            // RZX playback: cache expected fetch count for this frame
            let rzxExpectedFetchCount = 0;
            let rzxSafetyLimit = 0;  // Safety limit to prevent infinite loops
            if (this.rzxPlaying && this.rzxPlayer) {
                const frameInfo = this.rzxPlayer.getFrameInfo(this.rzxFrame);
                if (frameInfo) {
                    rzxExpectedFetchCount = frameInfo.fetchCount;
                    // Safety limit: 2x expected count - if exceeded, something is very wrong
                    rzxSafetyLimit = rzxExpectedFetchCount * 2;
                }
            }

            // Track which line to render next (same as runFrame for consistent output)
            let nextLineToRender = Math.floor(this.cpu.tStates / tstatesPerLine);
            const totalLines = Math.floor(tstatesPerFrame / tstatesPerLine);

            // Main frame loop - runs until tstatesPerFrame (or until instruction count during RZX)
            // During RZX playback, frame ends based on instruction count, not T-states (FUSE-style)
            while (this.rzxPlaying ? true : this.cpu.tStates < tstatesPerFrame) {
                // Render complete scanlines at line END (same as runFrame)
                while (nextLineToRender < totalLines) {
                    const lineEndT = (nextLineToRender + 1) * tstatesPerLine;
                    if (this.cpu.tStates >= lineEndT) {
                        this.ula.renderScanline(nextLineToRender);
                        nextLineToRender++;
                    } else {
                        break;
                    }
                }

                // Beta Disk automatic ROM paging (Pentagon only)
                this.updateBetaDiskPaging();
                // Interface 1 ROM auto-paging
                if (this._if1PagingEnabled) this.updateIF1Paging();
                // +D ROM auto-paging
                if (this._plusDPagingEnabled) this.updatePlusDPaging();
                // DISCiPLE auto-paging ($0001/$0008/$0066/$028E page in, port $BB page out)
                if (this._disciplePagingEnabled) this.updateDisciplePaging();
                // Didaktik 80 ROM auto-paging ($0000/$0008 page in, $1700 page out)
                if (this._didaktikPagingEnabled) this.updateDidaktikPaging();
                // Timex FDD 3000 interface ROM ($0000/$0008 in, after $0604 out)
                if (this._fdd3000PagingEnabled && !this.memory.fdd3000Active &&
                    (this.cpu.pc === 0x0000 || this.cpu.pc === 0x0008)) this.memory.fdd3000Active = true;
                // Tape traps still active for test loading
                const _traps = this.tapeTrapsEnabled && (!this.profile.noRomTraps || !!this.profile.exromTapeTraps);
                if (_traps && this.tapeTrap.checkTrap()) continue;
                if (_traps && this.tapeSaveTrap.checkTrap()) continue;
                if (_traps && !this.profile.noRomTraps && this.trdosTrap.checkTrap()) continue;

                // Apply ULA contention per-line for 48K and 128K
                if (this.profile.hasContention && this.contentionEnabled) {
                    const ulaContention = this.ula.ULA_CONTENTION_TSTATES || 0;
                    if (ulaContention > 0) {
                        const line = Math.floor(this.cpu.tStates / tstatesPerLine);
                        const firstScreenLine = this.ula.FIRST_SCREEN_LINE;
                        const screenLine = line - firstScreenLine;

                        if (screenLine >= 0 && screenLine < 192) {
                            if (this.lastContentionLine !== line) {
                                this.lastContentionLine = line;
                                this.cpu.tStates += ulaContention;
                            }
                        }
                    }
                }

                // Execute ONE instruction
                const tStatesBefore = this.cpu.tStates;
                if (this.cpu.halted) {
                    // Process eiPending during HALT NOP cycles (same as instruction boundary)
                    if (this.cpu.eiPending) {
                        this.cpu.eiPending = false;
                        this.cpu.iff1 = this.cpu.iff2 = true;
                    }

                    // Normal HALT NOP — M1 fetch from (PC+1), subject to contention
                    if (this.profile.hasContention && this.contentionEnabled && this.cpu.contend) {
                        this.cpu.resetContend();
                        this.cpu.contend((this.cpu.pc + 1) & 0xffff);
                    }
                    const _hlHaltTsBefore = this.cpu.tStates;
                    this.cpu.tStates += 4;
                    if (this._turboMul > 1) this._turboSpend(_hlHaltTsBefore);
                    this.cpu.incR();
                    if (this._fdd3000PagingEnabled) this.fdd3000.step();   // the station keeps going
                    this.cpu.instructionCount++;  // HALT NOP counts as M1 cycle
                    if (this.profiler.enabled) {
                        const _pcKey = this.getAutoMapKey(this.cpu.pc);
                        const _hlHaltTsCost = this.cpu.tStates - _hlHaltTsBefore;
                        this.profiler.tStatesPerPC.set(_pcKey, (this.profiler.tStatesPerPC.get(_pcKey) || 0) + _hlHaltTsCost);
                    }

                    // Check if INT should fire after this HALT NOP
                    if (!this.rzxPlaying && !intFired &&
                        this.cpu.tStates >= intStart && this.cpu.tStates < intEnd &&
                        this.cpu.iff1 && !this.cpu.eiPending) {
                        const _hlHintOldPC = this.cpu.pc, _hlHintOldSP = this.cpu.sp;
                        this._suppressWatchpoints = true;
                        const intTstates = this.cpu.interrupt();
                        this._suppressWatchpoints = false;
                        this._addCpuT(intTstates);
                        this._trackInterruptCall(_hlHintOldPC, _hlHintOldSP);
                        intFired = true;
                        continue;
                    }

                    // RZX playback: check if instruction count reached (FUSE-style frame end)
                    if (this.rzxPlaying && rzxExpectedFetchCount > 0) {
                        const m1Count = this.cpu.instructionCount - this.rzxFrameStartInstr;
                        if (m1Count >= rzxExpectedFetchCount) {
                            break;  // End frame - instruction count reached
                        }
                        // Safety check: if way over expected count, break to prevent infinite loop
                        if (rzxSafetyLimit > 0 && m1Count > rzxSafetyLimit) {
                            console.error(`RZX F${this.rzxFrame}: safety limit exceeded (HALT)! M1=${m1Count} expected=${rzxExpectedFetchCount}`);
                            break;
                        }
                    }
                } else {
                    const _hlCsOldPC = this.cpu.pc, _hlCsOldSP = this.cpu.sp;
                    this._currentInstrPC = _hlCsOldPC;
                    const _hlTsBefore = this.cpu.tStates;
                    this._inCpuExecution = true;
                    this.cpu.execute();
                    this._inCpuExecution = false;
                    if (this._turboMul > 1) this._turboSpend(_hlTsBefore);
                    // FDD 3000: out once the RET at $0604 has run; its station's
                    // Z80 runs along, one instruction per ours (two every fifth)
                    if (this._fdd3000PagingEnabled) {
                        if (this._currentInstrPC === 0x0604) this.memory.fdd3000Active = false;
                        this.fdd3000.step();
                    }
                    // IF1 page-out: deferred to after RET at $0700 executes
                    if (this._if1PageOutPending) {
                        this.memory.if1Active = false;
                        this._if1PageOutPending = false;
                    }
                    // Opus DRQ is wired to NMI, delayed to the chip's byte rate
                    if (this._opusNmiPending) {
                        if (this.diskClockNow() >= this._opusDrqDue) {
                            this._opusNmiPending = false;
                            // see runFrame: a request that has gone away
                            // delivers no NMI
                            if (this.opus.hasDataRequest()) this._addCpuT(this.cpu.nmi());
                        }
                    }
                    // Didaktik DRQ/INTRQ, same deal
                    if (this._didaktikNmiPending) {
                        if (this.diskClockNow() >= this._didaktikDrqDue) {
                            this._didaktikNmiPending = false;
                            this._addCpuT(this.cpu.nmi());
                        }
                    }
                    // Opus paging is checked AFTER the instruction, not before it
                    if (this._opusPagingEnabled) this.updateOpusPaging(_hlCsOldPC);
                    this._trackCallStack(_hlCsOldPC, _hlCsOldSP);
                    if (this.indirectJumps.enabled) this._trackIndirectJump(_hlCsOldPC);
                    // Profiler: track CALL/RST entries and per-PC T-states
                    if (this.profiler.enabled) {
                        this._profilerTrackCallRet(_hlCsOldPC, _hlCsOldSP);
                        const _hlTsCost = this.cpu.tStates - _hlTsBefore;
                        const _pcKey = this.getAutoMapKey(_hlCsOldPC);
                        this.profiler.tStatesPerPC.set(_pcKey, (this.profiler.tStatesPerPC.get(_pcKey) || 0) + _hlTsCost);
                    }

                    // RZX playback: check if instruction count reached (FUSE-style frame end)
                    if (this.rzxPlaying && rzxExpectedFetchCount > 0) {
                        const m1Count = this.cpu.instructionCount - this.rzxFrameStartInstr;
                        if (m1Count >= rzxExpectedFetchCount) {
                            break;  // End frame - instruction count reached
                        }
                        // Safety check: if way over expected count, break to prevent infinite loop
                        if (rzxSafetyLimit > 0 && m1Count > rzxSafetyLimit) {
                            console.error(`RZX F${this.rzxFrame}: safety limit exceeded! M1=${m1Count} expected=${rzxExpectedFetchCount}`);
                            break;
                        }
                    }

                    // Check if INT should fire after this instruction
                    if (!this.rzxPlaying && !intFired &&
                        this.cpu.tStates >= intStart && this.cpu.tStates < intEnd &&
                        this.cpu.iff1 && !this.cpu.eiPending) {
                        const _hlMintOldPC = this.cpu.pc, _hlMintOldSP = this.cpu.sp;
                        this._suppressWatchpoints = true;
                        const intTstates = this.cpu.interrupt();
                        this._suppressWatchpoints = false;
                        this._addCpuT(intTstates);
                        this._trackInterruptCall(_hlMintOldPC, _hlMintOldSP);
                        intFired = true;
                    }
                }

                // Update tape player for real-time playback
                // Note: May have been partially updated during port reads for accurate timing
                if (this.tapePlayer.isPlaying()) {
                    const tStatesNow = this.cpu.tStates;
                    const elapsed = tStatesNow - this._lastTapeUpdate;
                    if (elapsed > 0) {
                        this.tapePlayer.update(elapsed, tStatesNow);
                        this._lastTapeUpdate = tStatesNow;
                    }
                    this.tapeEarBit = this.tapePlayer.getEarBit();
                }
            }

            // RZX playback: capture M1 count BEFORE interrupt (fetchCount excludes interrupt acknowledge)
            // (Note: runFrameHeadless doesn't log RZX mismatches but captures for consistency)
            const rzxM1BeforeInt = this.rzxPlaying ? (this.cpu.instructionCount - this.rzxFrameStartInstr) : 0;

            // RZX playback: fire interrupt at frame end (FUSE-style)
            if (this.rzxPlaying && this.cpu.iff1 && !this.cpu.eiPending) {
                const _hlRzxIntOldPC = this.cpu.pc, _hlRzxIntOldSP = this.cpu.sp;
                this._suppressWatchpoints = true;
                const intTstates = this.cpu.interrupt();
                this._suppressWatchpoints = false;
                this._addCpuT(intTstates);
                this._trackInterruptCall(_hlRzxIntOldPC, _hlRzxIntOldSP);
            }

            // Render any remaining scanlines (same as runFrame)
            while (nextLineToRender < totalLines) {
                this.ula.renderScanline(nextLineToRender++);
            }

            // Complete frame rendering (same as runFrame)
            this.ula.endFrame();

            // Memory freeze: rewrite locked addresses at frame end
            if (this.frozenAddresses.length > 0) {
                this._suppressWatchpoints = true;
                for (const f of this.frozenAddresses) this.memory.write(f.addr, f.value);
                this._suppressWatchpoints = false;
            }

            this.frameCount++;
            this.totalFrames++;
            this.micRecorder.onFrameEnd(this.cpu.tStates);

            // Profiler: count down frames (headless path)
            if (this.profiler.enabled) {
                this.profiler.framesRemaining--;
                if (this.profiler.framesRemaining <= 0) {
                    this.stopProfiling();
                }
            }

            // General Sound: run it to the end of the frame
            if (this.gsOn) this.gs.endFrame(tstatesPerFrame);

            // Process AY + beeper + tape audio for this frame (skip at high speeds - audio would be meaningless)
            if (this.audio && this.audio.enabled && !this.audioSuppressed && this.speed > 0 && this.speed <= 200) {
                // Get tape audio from tape player (if playing and enabled)
                // Also suppress tape audio briefly after returning from high speed
                const tapeAudioSuppressed = this._suppressTapeAudioUntil && Date.now() < this._suppressTapeAudioUntil;
                // Suppress tape audio in flash load mode — tape player may still run
                // for turbo block EAR bit generation, but audio output is muted
                const tapeAudioChanges = (this.tapeAudioEnabled && !this.tapeFlashLoad &&
                    this.tapePlayer.isPlaying() && !tapeAudioSuppressed)
                    ? this.tapePlayer.getEdgeTransitions() : [];

                // Pass tape audio changes (ROM doesn't echo tape signal to speaker)
                this.audio.processFrame(tstatesPerFrame, this.beeperChanges, this.beeperLevel, tapeAudioChanges, this.ayChanges, this.ayStateSnapshot,
                    { ay2: this.turboSound ? this.ay2 : null, ay2Snapshot: this.ay2StateSnapshot,
                      dacChanges: this.dacChanges, dacStart: this._dacStart, dacOn: this.dacType !== 'none',
                      saa: this.saaOn ? this.saa : null, saaChanges: this.saaChanges,
                      gs: this.gsOn && this.gs.rom ? this.gs : null,
                      fm: this.tsfm && this.turboSound ? this.fm : null, fmOn: this._fmOn, fmChanges: this.fmChanges, fmClock: this._fmMasterClock() });
            }

            // Advance AY logging frame counter
            if (this.ay) {
                this.ay.advanceLogFrame();
            }

            // RZX: advance to next frame (same as runFrame)
            if (this.rzxPlaying && this.rzxPlayer) {
                this.rzxFrameStartInstr = this.cpu.instructionCount;

                this.rzxFrame++;

                if (this.rzxFrame >= this.rzxPlayer.getFrameCount()) {
                    this.rzxStop();
                    if (this.onRZXEnd) this.onRZXEnd();
                }
            }

            return tstatesPerFrame;
        }

        /**
         * Render the current frame and return the screen buffer
         * Call after runFrameHeadless() to get the final screen state
         * @returns {Uint8ClampedArray} RGBA pixel data
         */
        renderAndCaptureScreen() {
            // Frame already rendered by runFrameHeadless() - just return the buffer
            return this.ula.frameBuffer;
        }

        /**
         * Get the current screen dimensions
         * @returns {{width: number, height: number, borderLeft: number, borderTop: number, screenWidth: number, screenHeight: number}}
         */
        getScreenDimensions() {
            return this.ula.getDimensions();
        }

        // ========== Overlay Drawing ==========

        drawOverlay() {
            // Note: borderOnly is set in renderToScreen() before renderFrame() is called
            switch (this.overlayMode) {
                case 'grid':
                    this.drawGrid();
                    break;
                case 'box':
                    this.drawBoxOverlay();
                    break;
                case 'screen':
                    this.drawScreenModeOverlay();
                    break;
                case 'reveal':
                    this.drawRevealOverlay();
                    break;
                case 'beam':
                    // Beam mode: grayscaled previous frame (paper+border), colored current (paper+border)
                    this.drawBeamOverlay(false);
                    break;
                case 'beamscreen':
                    // BeamScreen mode: grayscaled previous frame (border only), colored current (border only)
                    this.drawBeamOverlay(true);
                    break;
                case 'noattr':
                    // No Attr mode: monochrome display using only colors 0 and 7
                    this.drawNoAttrOverlay();
                    break;
                case 'nobitmap':
                    // No Bitmap mode: 8x8 cells with diagonal crosses using ink/paper colors
                    this.drawNoBitmapOverlay();
                    break;
                case 'none':
                default:
                    // Clear overlay canvas
                    if (this.overlayCtx) {
                        this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
                    }
                    break;
            }
        }

        // Decode ZX Spectrum keyboard port read to key names
        decodeKeyboardInput(port, value) {
            // Keyboard matrix - high byte of port selects row
            const rows = {
                0xFE: ['Shift', 'Z', 'X', 'C', 'V'],
                0xFD: ['A', 'S', 'D', 'F', 'G'],
                0xFB: ['Q', 'W', 'E', 'R', 'T'],
                0xF7: ['1', '2', '3', '4', '5'],
                0xEF: ['0', '9', '8', '7', '6'],
                0xDF: ['P', 'O', 'I', 'U', 'Y'],
                0xBF: ['Enter', 'L', 'K', 'J', 'H'],
                0x7F: ['Space', 'Sym', 'M', 'N', 'B']
            };

            const highByte = (port >> 8) & 0xFF;
            const keys = [];

            // Check each row that's selected (active low in high byte)
            for (const [rowMask, rowKeys] of Object.entries(rows)) {
                const mask = parseInt(rowMask);
                // If this row is selected (bit is 0)
                if ((highByte & mask) !== mask) {
                    // Check bits 0-4 for pressed keys (0 = pressed)
                    for (let bit = 0; bit < 5; bit++) {
                        if ((value & (1 << bit)) === 0) {
                            keys.push(rowKeys[bit]);
                        }
                    }
                }
            }

            return keys;
        }

        drawBoxOverlay() {
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Scale coordinates by zoom
            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;

            // Draw rectangle around screen area (1px line regardless of zoom)
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        drawScreenModeOverlay() {
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Scale coordinates by zoom
            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;

            // Screen mode: border is already extended into paper area by main canvas
            // Just draw the grid overlay

            // Draw grid inside the paper area (cyan, every 8 pixels)
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
            ctx.lineWidth = 1;

            for (let row = 0; row <= dims.screenHeight; row += 8) {
                const y = Math.floor((dims.borderTop + row) * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(borderLeft, y);
                ctx.lineTo(borderLeft + screenWidth, y);
                ctx.stroke();
            }

            for (let col = 0; col <= dims.screenWidth; col += 8) {
                const x = Math.floor((dims.borderLeft + col) * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop);
                ctx.lineTo(x, borderTop + screenHeight);
                ctx.stroke();
            }

            // Draw thin yellow rectangle around paper area
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        drawRevealOverlay() {
            // Reveal mode: main canvas shows border-only (borderOnly=true), overlay draws
            // the normal screen picture (paper area) semi-transparently on top so you can
            // see border effects underneath the screen content.
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;

            // Render the normal screen content (bitmaps + attributes) into a temp canvas
            const screen = this.ula.memory.getScreenBase();
            const screenRam = screen.ram;
            const pal = this.ula.palette;
            const ulaplus = this.ula.ulaplus;
            const ulaPlusActive = ulaplus && ulaplus.enabled && ulaplus.paletteEnabled;
            const flashActive = this.ula.flashState;

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = dims.width;
            tempCanvas.height = dims.height;
            const tempCtx = tempCanvas.getContext('2d');
            const tempImageData = tempCtx.createImageData(dims.width, dims.height);
            const data = tempImageData.data;

            for (let y = 0; y < 192; y++) {
                const third = Math.floor(y / 64);
                const lineInThird = y & 0x07;
                const charRow = Math.floor((y & 0x38) / 8);
                const pixelAddr = (third << 11) | (lineInThird << 8) | (charRow << 5);
                const attrAddr = 0x1800 + Math.floor(y / 8) * 32;
                const screenY = y + dims.borderTop;

                for (let col = 0; col < 32; col++) {
                    const pixelByte = screenRam[pixelAddr + col];
                    const attr = screenRam[attrAddr + col];

                    let inkR, inkG, inkB, paperR, paperG, paperB;
                    if (ulaPlusActive) {
                        const clut = ((attr >> 6) & 0x03) << 4;
                        const inkIdx = clut + (attr & 0x07);
                        const paperIdx = clut + 8 + ((attr >> 3) & 0x07);
                        // Decode GRB 332 palette entries to RGB
                        const inkGrb = ulaplus.palette[inkIdx];
                        const paperGrb = ulaplus.palette[paperIdx];
                        const ig3 = (inkGrb >> 5) & 7, ir3 = (inkGrb >> 2) & 7, ib2 = inkGrb & 3;
                        inkR = (ir3 << 5) | (ir3 << 2) | (ir3 >> 1);
                        inkG = (ig3 << 5) | (ig3 << 2) | (ig3 >> 1);
                        inkB = (ib2 << 6) | (ib2 << 4) | (ib2 << 2) | ib2;
                        const pg3 = (paperGrb >> 5) & 7, pr3 = (paperGrb >> 2) & 7, pb2 = paperGrb & 3;
                        paperR = (pr3 << 5) | (pr3 << 2) | (pr3 >> 1);
                        paperG = (pg3 << 5) | (pg3 << 2) | (pg3 >> 1);
                        paperB = (pb2 << 6) | (pb2 << 4) | (pb2 << 2) | pb2;
                    } else {
                        let ink = attr & 0x07;
                        let paper = (attr >> 3) & 0x07;
                        const bright = (attr & 0x40) ? 8 : 0;
                        if ((attr & 0x80) && flashActive) {
                            const tmp = ink; ink = paper; paper = tmp;
                        }
                        const inkRgb = pal[ink + bright];
                        const paperRgb = pal[paper + bright];
                        inkR = inkRgb[0]; inkG = inkRgb[1]; inkB = inkRgb[2];
                        paperR = paperRgb[0]; paperG = paperRgb[1]; paperB = paperRgb[2];
                    }

                    for (let bit = 7; bit >= 0; bit--) {
                        const px = dims.borderLeft + col * 8 + (7 - bit);
                        const idx = (screenY * dims.width + px) * 4;
                        if (pixelByte & (1 << bit)) {
                            data[idx] = inkR; data[idx + 1] = inkG; data[idx + 2] = inkB;
                        } else {
                            data[idx] = paperR; data[idx + 1] = paperG; data[idx + 2] = paperB;
                        }
                        data[idx + 3] = 128;  // 50% transparent — border shows through
                    }
                }
            }

            tempCtx.putImageData(tempImageData, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tempCanvas, 0, 0, dims.width, dims.height,
                          0, 0, dims.width * zoom, dims.height * zoom);

            // Draw border around screen area for clarity
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        drawGrid() {
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Scale all coordinates by zoom
            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;
            const totalWidth = dims.width * zoom;
            const totalHeight = dims.height * zoom;
            
            // Draw border grid (magenta, every 8 pixels) - complete grid in all border areas
            ctx.strokeStyle = 'rgba(255, 0, 255, 0.4)';
            ctx.lineWidth = 1;
            
            // Top border area: full grid
            for (let row = 0; row <= dims.borderTop; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(totalWidth, y);
                ctx.stroke();
            }
            for (let col = 0; col <= dims.width; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, borderTop);
                ctx.stroke();
            }
            
            // Bottom border area: full grid
            for (let row = dims.borderTop + dims.screenHeight; row <= dims.height; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(totalWidth, y);
                ctx.stroke();
            }
            for (let col = 0; col <= dims.width; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop + screenHeight);
                ctx.lineTo(x, totalHeight);
                ctx.stroke();
            }
            
            // Left border area (middle section): full grid
            for (let row = dims.borderTop; row <= dims.borderTop + dims.screenHeight; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(borderLeft, y);
                ctx.stroke();
            }
            for (let col = 0; col <= dims.borderLeft; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop);
                ctx.lineTo(x, borderTop + screenHeight);
                ctx.stroke();
            }

            // Right border area (middle section): full grid
            for (let row = dims.borderTop; row <= dims.borderTop + dims.screenHeight; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(borderLeft + screenWidth, y);
                ctx.lineTo(totalWidth, y);
                ctx.stroke();
            }
            for (let col = dims.borderLeft + dims.screenWidth; col <= dims.width; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop);
                ctx.lineTo(x, borderTop + screenHeight);
                ctx.stroke();
            }
            
            // Draw screen grid (gray)
            ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)';
            ctx.lineWidth = 1;
            const cellSize = 8 * zoom;

            // Draw vertical lines (every 8 pixels = 1 character column)
            for (let col = 0; col <= 32; col++) {
                const x = Math.floor(borderLeft + col * cellSize) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, borderTop);
                ctx.lineTo(x, borderTop + screenHeight);
                ctx.stroke();
            }

            // Draw horizontal lines (every 8 pixels = 1 character row)
            for (let row = 0; row <= 24; row++) {
                const y = Math.floor(borderTop + row * cellSize) + 0.5;
                ctx.beginPath();
                ctx.moveTo(borderLeft, y);
                ctx.lineTo(borderLeft + screenWidth, y);
                ctx.stroke();
            }

            // Draw thirds dividers (horizontal lines at 64 and 128 pixels) - extended to borders
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';  // Cyan
            ctx.lineWidth = 1;
            for (let third = 1; third < 3; third++) {
                const y = Math.floor(borderTop + third * 64 * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);  // Start from left edge
                ctx.lineTo(totalWidth, y);  // End at right edge
                ctx.stroke();
            }

            // Draw quarter dividers (vertical lines at 64, 128, 192 pixels) - extended to borders
            for (let quarter = 1; quarter < 4; quarter++) {
                const x = Math.floor(borderLeft + quarter * 64 * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, 0);  // Start from top edge
                ctx.lineTo(x, totalHeight);  // End at bottom edge
                ctx.stroke();
            }
            
            // Draw numbers using small bitmap digits (scaled by zoom)
            const drawDigit = (x, y, digit, color) => {
                ctx.fillStyle = color;
                // 3x5 pixel digits, scaled by zoom
                const patterns = {
                    '0': [0b111, 0b101, 0b101, 0b101, 0b111],
                    '1': [0b010, 0b110, 0b010, 0b010, 0b111],
                    '2': [0b111, 0b001, 0b111, 0b100, 0b111],
                    '3': [0b111, 0b001, 0b111, 0b001, 0b111],
                    '4': [0b101, 0b101, 0b111, 0b001, 0b001],
                    '5': [0b111, 0b100, 0b111, 0b001, 0b111],
                    '6': [0b111, 0b100, 0b111, 0b101, 0b111],
                    '7': [0b111, 0b001, 0b001, 0b001, 0b001],
                    '8': [0b111, 0b101, 0b111, 0b101, 0b111],
                    '9': [0b111, 0b101, 0b111, 0b001, 0b111],
                };
                const p = patterns[digit] || patterns['0'];
                for (let py = 0; py < 5; py++) {
                    for (let px = 0; px < 3; px++) {
                        if (p[py] & (4 >> px)) {
                            ctx.fillRect(x + px * zoom, y + py * zoom, zoom, zoom);
                        }
                    }
                }
            };

            const drawNumber = (x, y, num, color) => {
                const str = num.toString();
                for (let i = 0; i < str.length; i++) {
                    drawDigit(x + i * 4 * zoom, y, str[i], color);
                }
            };

            // Draw row numbers on left border (yellow)
            for (let row = 0; row < 24; row++) {
                const y = borderTop + row * cellSize + zoom;
                drawNumber(borderLeft - 10 * zoom, y, row, '#FFFF00');
            }

            // Draw column numbers on top border (every 4th)
            for (let col = 0; col < 32; col += 4) {
                const x = borderLeft + col * cellSize + zoom;
                drawNumber(x, borderTop - 7 * zoom, col, '#FFFF00');
            }

            // Draw scanline numbers on right (cyan)
            for (let line = 0; line < 192; line += 8) {
                const y = borderTop + line * zoom + zoom;
                drawNumber(borderLeft + screenWidth + 2 * zoom, y, line, '#00FFFF');
            }

            // Draw 256x192 boundary lines extending into border areas (yellow)
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;

            // Horizontal boundary lines - extend into left and right borders
            // Top edge of 256x192 area
            const topY = Math.floor(borderTop) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, topY);
            ctx.lineTo(borderLeft, topY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(borderLeft + screenWidth, topY);
            ctx.lineTo(totalWidth, topY);
            ctx.stroke();

            // Bottom edge of 256x192 area
            const bottomY = Math.floor(borderTop + screenHeight) + 0.5;
            ctx.beginPath();
            ctx.moveTo(0, bottomY);
            ctx.lineTo(borderLeft, bottomY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(borderLeft + screenWidth, bottomY);
            ctx.lineTo(totalWidth, bottomY);
            ctx.stroke();

            // Vertical boundary lines - extend into top and bottom borders
            // Left edge of 256x192 area
            const leftX = Math.floor(borderLeft) + 0.5;
            ctx.beginPath();
            ctx.moveTo(leftX, 0);
            ctx.lineTo(leftX, borderTop);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(leftX, borderTop + screenHeight);
            ctx.lineTo(leftX, totalHeight);
            ctx.stroke();

            // Right edge of 256x192 area
            const rightX = Math.floor(borderLeft + screenWidth) + 0.5;
            ctx.beginPath();
            ctx.moveTo(rightX, 0);
            ctx.lineTo(rightX, borderTop);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(rightX, borderTop + screenHeight);
            ctx.lineTo(rightX, totalHeight);
            ctx.stroke();

            // Draw yellow box around screen area (256x192)
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        // Beam visualization overlay - shows previous frame grayscaled, current progress colored
        // borderOnlyMode=false (Beam): grayscale prev frame (paper+border), color current (paper+border)
        // borderOnlyMode=true (BeamScreen): grayscale prev frame (border only), color current (border only)
        drawBeamOverlay(borderOnlyMode) {
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Calculate current beam position from tStates
            const tStates = this.cpu.tStates;
            const tstatesPerLine = this.ula.TSTATES_PER_LINE;
            const tstatesPerFrame = this.ula.TSTATES_PER_FRAME;

            // Current frame line and position within line
            const currentFrameLine = Math.floor(tStates / tstatesPerLine);
            const posInLine = tStates % tstatesPerLine;

            // Convert frame line to visible line using ULA's calculation
            const firstVisibleFrameLine = this.ula.FIRST_SCREEN_LINE - this.ula.BORDER_TOP;
            const lastVisibleFrameLine = this.ula.FIRST_SCREEN_LINE + this.ula.SCREEN_HEIGHT + this.ula.BORDER_BOTTOM - 1;

            // Calculate beam position in visible coordinates
            let beamVisY = currentFrameLine - firstVisibleFrameLine;

            // Calculate X position: convert T-state position to pixel position
            // Using the same logic as renderBorderPixels
            const lineStartTstate = this.ula.calculateLineStartTstate ?
                this.ula.calculateLineStartTstate(Math.max(0, beamVisY)) : 0;
            const currentTstate = currentFrameLine * tstatesPerLine + posInLine;
            const pixelX = Math.floor((currentTstate - lineStartTstate) * 2);

            // Clamp beam position to visible area
            const beamX = Math.max(0, Math.min(dims.width - 1, pixelX));
            const beamY = Math.max(0, Math.min(dims.height - 1, beamVisY));

            // Scale coordinates by zoom
            const borderTop = dims.borderTop * zoom;
            const borderLeft = dims.borderLeft * zoom;
            const screenWidth = dims.screenWidth * zoom;
            const screenHeight = dims.screenHeight * zoom;
            const totalWidth = dims.width * zoom;
            const totalHeight = dims.height * zoom;

            // Draw previous frame in grayscale
            if (this.previousFrameBuffer) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = dims.width;
                tempCanvas.height = dims.height;
                const tempCtx = tempCanvas.getContext('2d');
                const tempImageData = tempCtx.createImageData(dims.width, dims.height);

                // Convert entire previous frame to darkened grayscale
                // Both BeamScreen and Beam: grayscale everything (paper area has border colors in borderOnlyMode)
                // The previousFrameBuffer already contains border colors extended into paper area
                for (let i = 0; i < this.previousFrameBuffer.length; i += 4) {
                    // Calculate grayscale and darken by 50% for better contrast with current frame
                    const gray = Math.round(
                        (this.previousFrameBuffer[i] * 0.299 +
                         this.previousFrameBuffer[i + 1] * 0.587 +
                         this.previousFrameBuffer[i + 2] * 0.114) * 0.5
                    );
                    tempImageData.data[i] = gray;
                    tempImageData.data[i + 1] = gray;
                    tempImageData.data[i + 2] = gray;
                    tempImageData.data[i + 3] = 255;  // Fully opaque
                }
                tempCtx.putImageData(tempImageData, 0, 0);

                // Draw grayscale previous frame
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(tempCanvas, 0, 0, dims.width, dims.height,
                              0, 0, totalWidth, totalHeight);
            }

            // Draw current frame progress (colored) - lines that have been rendered
            // In running mode (beamVisY >= dims.height), draw entire frame
            const frameComplete = beamVisY >= dims.height;
            if (beamVisY >= 0 || frameComplete) {
                // Get current partial frame from ULA
                const currentFrame = this.ula.frameBuffer;
                if (currentFrame) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = dims.width;
                    tempCanvas.height = dims.height;
                    const tempCtx = tempCanvas.getContext('2d');
                    const tempImageData = tempCtx.createImageData(dims.width, dims.height);

                    // Determine how much to draw
                    const maxDrawY = frameComplete ? dims.height - 1 : Math.min(beamY, dims.height - 1);
                    const maxDrawX = frameComplete ? dims.width : (beamX + 1);

                    // Copy already-rendered lines in color
                    for (let y = 0; y <= maxDrawY; y++) {
                        for (let x = 0; x < dims.width; x++) {
                            // For the current beam line (not complete), only draw up to beam X position
                            if (!frameComplete && y === beamY && x >= maxDrawX) break;

                            const idx = (y * dims.width + x) * 4;
                            const isScreen = x >= dims.borderLeft && x < dims.borderLeft + dims.screenWidth &&
                                             y >= dims.borderTop && y < dims.borderTop + dims.screenHeight;

                            // In borderOnly mode, skip screen area
                            if (borderOnlyMode && isScreen) continue;

                            tempImageData.data[idx] = currentFrame[idx];
                            tempImageData.data[idx + 1] = currentFrame[idx + 1];
                            tempImageData.data[idx + 2] = currentFrame[idx + 2];
                            tempImageData.data[idx + 3] = 255;
                        }
                    }
                    tempCtx.putImageData(tempImageData, 0, 0);

                    // Draw colored current progress
                    ctx.drawImage(tempCanvas, 0, 0, dims.width, dims.height,
                                  0, 0, totalWidth, totalHeight);
                }
            }

            // Draw grid overlay (8-pixel spacing, covers whole canvas)
            ctx.strokeStyle = 'rgba(255, 0, 255, 0.3)';
            ctx.lineWidth = 1;
            for (let row = 0; row <= dims.height; row += 8) {
                const y = Math.floor(row * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(totalWidth, y);
                ctx.stroke();
            }
            for (let col = 0; col <= dims.width; col += 8) {
                const x = Math.floor(col * zoom) + 0.5;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, totalHeight);
                ctx.stroke();
            }

            // Draw beam position marker (cyan crosshair)
            if (beamVisY >= 0 && beamVisY < dims.height && beamX >= 0 && beamX < dims.width) {
                const bx = beamX * zoom;
                const by = beamY * zoom;

                ctx.strokeStyle = '#00FFFF';
                ctx.lineWidth = 1;

                // Horizontal line through beam
                ctx.beginPath();
                ctx.moveTo(0, by + 0.5);
                ctx.lineTo(totalWidth, by + 0.5);
                ctx.stroke();

                // Vertical line through beam
                ctx.beginPath();
                ctx.moveTo(bx + 0.5, 0);
                ctx.lineTo(bx + 0.5, totalHeight);
                ctx.stroke();

                // Beam dot
                ctx.fillStyle = '#FF0000';
                ctx.beginPath();
                ctx.arc(bx, by, 2, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw beam info text
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `${12 * zoom}px monospace`;
            ctx.fillText(`T:${tStates} Line:${currentFrameLine} Pos:${posInLine}`, 4, 14 * zoom);
            ctx.fillText(`VisY:${beamY} X:${beamX}`, 4, 28 * zoom);

            // Draw screen area boundary (yellow box)
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.lineWidth = 1;
            ctx.strokeRect(borderLeft + 0.5, borderTop + 0.5, screenWidth - 1, screenHeight - 1);
        }

        drawNoAttrOverlay() {
            // No Attr mode: Show monochrome picture using only colors 0 and 7 from palette
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;
            const palette = this.ula.palette;

            // Get colors 0 (black) and 7 (white) from palette
            const color0 = palette ? palette[0] : [0, 0, 0, 255];
            const color7 = palette ? palette[7] : [205, 205, 205, 255];

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Create temporary canvas at 1x scale
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = dims.width;
            tempCanvas.height = dims.height;
            const tempCtx = tempCanvas.getContext('2d');
            const tempImageData = tempCtx.createImageData(dims.width, dims.height);

            // Get current frame buffer
            const frameBuffer = this.ula.frameBuffer;
            if (!frameBuffer) return;

            // Process screen area only - convert to monochrome based on luminance
            for (let y = dims.borderTop; y < dims.borderTop + dims.screenHeight; y++) {
                for (let x = dims.borderLeft; x < dims.borderLeft + dims.screenWidth; x++) {
                    const idx = (y * dims.width + x) * 4;
                    const r = frameBuffer[idx];
                    const g = frameBuffer[idx + 1];
                    const b = frameBuffer[idx + 2];

                    // Calculate luminance (using perceived brightness formula)
                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

                    // Use color 7 for bright pixels (ink), color 0 for dark (paper)
                    const color = lum > 64 ? color7 : color0;
                    tempImageData.data[idx] = color[0];
                    tempImageData.data[idx + 1] = color[1];
                    tempImageData.data[idx + 2] = color[2];
                    tempImageData.data[idx + 3] = 255;
                }
            }

            tempCtx.putImageData(tempImageData, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tempCanvas, dims.borderLeft, dims.borderTop, dims.screenWidth, dims.screenHeight,
                          dims.borderLeft * zoom, dims.borderTop * zoom, dims.screenWidth * zoom, dims.screenHeight * zoom);
        }

        drawNoBitmapOverlay() {
            // No Bitmap mode: each 8x8 cell shows paper color with a diagonal
            // ink-colored X cross so you can see where ink differs from paper.
            // Per-cell color sampling for multicolor support.
            if (!this.overlayCtx) return;
            const ctx = this.overlayCtx;
            const dims = this.ula.getDimensions();
            const zoom = this.zoom;
            const frameBuffer = this.ula.frameBuffer;
            if (!frameBuffer) return;

            // Clear overlay canvas
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

            // Create temporary canvas at 1x scale
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = dims.width;
            tempCanvas.height = dims.height;
            const tempCtx = tempCanvas.getContext('2d');
            const tempImageData = tempCtx.createImageData(dims.width, dims.height);
            const data = tempImageData.data;

            // Copy border from frame buffer
            for (let y = 0; y < dims.height; y++) {
                for (let x = 0; x < dims.width; x++) {
                    const isScreen = x >= dims.borderLeft && x < dims.borderLeft + dims.screenWidth &&
                                     y >= dims.borderTop && y < dims.borderTop + dims.screenHeight;
                    if (!isScreen) {
                        const idx = (y * dims.width + x) * 4;
                        data[idx] = frameBuffer[idx];
                        data[idx + 1] = frameBuffer[idx + 1];
                        data[idx + 2] = frameBuffer[idx + 2];
                        data[idx + 3] = 255;
                    }
                }
            }

            // For each 8x8 cell, detect ink/paper from the top scanline of the cell,
            // then fill the entire cell with paper + centered cross in ink.
            for (let charRow = 0; charRow < 24; charRow++) {
                for (let charCol = 0; charCol < 32; charCol++) {
                    const cellX = dims.borderLeft + charCol * 8;
                    const cellY = dims.borderTop + charRow * 8;

                    // Sample all 64 pixels to find paper and ink colors
                    const colors = new Map();
                    for (let ly = 0; ly < 8; ly++) {
                        for (let px = 0; px < 8; px++) {
                            const idx = ((cellY + ly) * dims.width + cellX + px) * 4;
                            const key = (frameBuffer[idx] << 16) | (frameBuffer[idx + 1] << 8) | frameBuffer[idx + 2];
                            colors.set(key, (colors.get(key) || 0) + 1);
                        }
                    }

                    const sorted = [...colors.entries()].sort((a, b) => b[1] - a[1]);
                    const paperKey = sorted[0] ? sorted[0][0] : 0;
                    const inkKey = sorted[1] ? sorted[1][0] : paperKey;
                    const paperR = (paperKey >> 16) & 0xFF, paperG = (paperKey >> 8) & 0xFF, paperB = paperKey & 0xFF;
                    const inkR = (inkKey >> 16) & 0xFF, inkG = (inkKey >> 8) & 0xFF, inkB = inkKey & 0xFF;
                    const sameColor = (paperKey === inkKey);

                    // Fill entire cell with paper
                    for (let ly = 0; ly < 8; ly++) {
                        for (let px = 0; px < 8; px++) {
                            const idx = ((cellY + ly) * dims.width + cellX + px) * 4;
                            data[idx] = paperR;
                            data[idx + 1] = paperG;
                            data[idx + 2] = paperB;
                            data[idx + 3] = 255;
                        }
                    }

                    // Draw diagonal X cross in ink (only if ink differs from paper)
                    if (!sameColor) {
                        for (let d = 0; d < 8; d++) {
                            // Top-left to bottom-right diagonal
                            const idx1 = ((cellY + d) * dims.width + cellX + d) * 4;
                            data[idx1] = inkR; data[idx1 + 1] = inkG; data[idx1 + 2] = inkB;
                            // Top-right to bottom-left diagonal
                            const idx2 = ((cellY + d) * dims.width + cellX + 7 - d) * 4;
                            data[idx2] = inkR; data[idx2 + 1] = inkG; data[idx2 + 2] = inkB;
                        }
                    }
                }
            }

            tempCtx.putImageData(tempImageData, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(tempCanvas, 0, 0, dims.width, dims.height,
                          0, 0, dims.width * zoom, dims.height * zoom);
        }

        // ========== Start/Stop/Speed Control ==========

        start(force = false) {
            if (!force && (this.running || !this.romLoaded)) {
                return;
            }
            if (this._bpTStatesResetPending) {
                this.breakpointTStates = 0;
                this._bpTStatesResetPending = false;
            }

            // If forcing, ensure we're stopped first to clear any stale timers
            if (force && this.running) {
                this.stop();
            }

            if (!this.romLoaded) {
                return;
            }

            this.running = true;
            this.lastFrameTime = performance.now();
            this.lastRafTime = null;  // Reset for accurate frame timing
            this.frameCount = 0;

            // Register keyboard handlers once
            if (!this.keyboardHandlersRegistered) {
                document.addEventListener('keydown', this.boundKeyDown);
                document.addEventListener('keyup', this.boundKeyUp);
                this.keyboardHandlersRegistered = true;
            }

            this.scheduleNextFrame();
        }
        
        // Register an additional per-frame listener fn(frameCount), called once per
        // emulated frame after onFrame (at every speed including Max). Multiple
        // consumers can coexist without clobbering each other's onFrame. Returns an
        // unsubscribe function; removeFrameListener(fn) also works.
        addFrameListener(fn) {
            if (typeof fn === 'function' && !this.frameListeners.includes(fn)) {
                this.frameListeners.push(fn);
            }
            return () => this.removeFrameListener(fn);
        }

        removeFrameListener(fn) {
            const i = this.frameListeners.indexOf(fn);
            if (i >= 0) this.frameListeners.splice(i, 1);
        }

        scheduleNextFrame() {
            if (!this.running) return;

            if (this.speed === 0) {
                // Max speed - use requestAnimationFrame, run multiple frames
                this.rafId = requestAnimationFrame(() => {
                    try {
                        const startTime = performance.now();
                        // Run frames for up to 16ms (one display frame)
                        while (performance.now() - startTime < 16 && this.running) {
                            this.runFrame();
                        }
                        this.updateFps();
                        this.scheduleNextFrame();
                    } catch (e) {
                        console.error('Error in runFrame:', e);
                        this.running = false;
                        if (this.onError) this.onError(e);
                    }
                });
            } else if (this.speed >= 100) {
                // Normal or fast - use requestAnimationFrame with time tracking
                // Real Spectrum: 50.08 FPS (69888 T-states at 3.5MHz)
                const targetFrameTime = 1000 / 50.08 * (100 / this.speed);

                this.rafId = requestAnimationFrame((timestamp) => {
                    try {
                        if (!this.lastRafTime) this.lastRafTime = timestamp;

                        // Calculate how many frames we should have run
                        const elapsed = timestamp - this.lastRafTime;
                        const framesToRun = Math.floor(elapsed / targetFrameTime);

                        if (framesToRun > 0) {
                            // Run the appropriate number of frames (cap at 4 to prevent spiral)
                            const actualFrames = Math.min(framesToRun, 4);
                            for (let i = 0; i < actualFrames && this.running; i++) {
                                this.runFrame();
                            }
                            this.lastRafTime = timestamp - (elapsed % targetFrameTime);
                        }

                        this.updateFps();
                        this.scheduleNextFrame();
                    } catch (e) {
                        console.error('Error in runFrame:', e);
                        this.running = false;
                        if (this.onError) this.onError(e);
                    }
                });
            } else {
                // Slow - increase interval
                const interval = Math.round(20 * (100 / this.speed));
                this.frameInterval = setTimeout(() => {
                    try {
                        this.runFrame();
                        this.updateFps();
                        this.scheduleNextFrame();
                    } catch (e) {
                        console.error('Error in runFrame:', e);
                        this.running = false;
                        if (this.onError) this.onError(e);
                    }
                }, interval);
            }
        }
        
        updateFps() {
            const now = performance.now();
            if (now - this.lastFrameTime >= 1000) {
                this.actualFps = Math.round(this.frameCount * 1000 / (now - this.lastFrameTime));
                this.frameCount = 0;
                this.lastFrameTime = now;
            }
        }
        
        stop() {
            if (!this.running) return;
            this.running = false;
            if (this.frameInterval) {
                clearTimeout(this.frameInterval);
                this.frameInterval = null;
            }
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            // Keep keyboard handlers registered - user may type while paused
        }

        // Release document-level listeners and audio so a discarded instance can be GC'd.
        // Call before dropping the reference (e.g. when creating a replacement instance).
        destroy() {
            this.stop();
            if (this.keyboardHandlersRegistered) {
                document.removeEventListener('keydown', this.boundKeyDown);
                document.removeEventListener('keyup', this.boundKeyUp);
                this.keyboardHandlersRegistered = false;
            }
            if (this.audio) {
                this.audio.stop();
                this.audio = null;
            }
        }

        setSpeed(speed) {
            const wasHighSpeed = this.speed > 200;
            this.speed = speed;
            this.lastRafTime = null;  // Reset for new timing

            // Suspend audio at high speeds (> 200% or max speed)
            if (this.audio && this.audio.context) {
                if (speed === 0 || speed > 200) {
                    this.audio.context.suspend();
                } else if (this.audio.enabled) {
                    this.audio.context.resume();
                }
            }

            // Suppress tape audio briefly when returning from high speed
            // This prevents hearing unexpected loading sounds when game is loaded at max speed
            if (wasHighSpeed && speed > 0 && speed <= 200) {
                this._suppressTapeAudioUntil = Date.now() + 1000;  // 1 second grace period
            }

            // Restart timing if running
            if (this.running) {
                if (this.frameInterval) {
                    clearTimeout(this.frameInterval);
                    this.frameInterval = null;
                }
                if (this.rafId) {
                    cancelAnimationFrame(this.rafId);
                    this.rafId = null;
                }
                this.scheduleNextFrame();
            }
        }
        
        toggle() { this.running ? this.stop() : this.start(); }

        /**
         * The machine's T-state count, spanning frames. `cpu.tStates` has a
         * frame subtracted from it fifty times a second, so on its own it would
         * put the index pulse back where it was ten times a revolution and make
         * every disk deadline nonsense.
         *
         * **`_diskClockBase`, not `totalFrames`** — and that distinction cost an
         * afternoon. `totalFrames` is incremented at the END of a frame while the
         * subtraction from `cpu.tStates` happens at the START of the next one, so
         * a clock built from the pair leaps a whole frame forward between the two
         * and drops back afterwards. At revolution scale (69888 against 698880)
         * that is a wobble nothing noticed; for a DRQ due 112 T-states out it
         * meant a byte scheduled a whole frame late, which stalled every Opus
         * transfer and `opus-test` caught as a retry storm. The base is advanced
         * in lockstep with the subtraction instead, at all four places it
         * happens, so this only ever moves forward.
         *
         * **Not only the disk wants it.** The 128's MIDI out times its bits off
         * this too, and at 31250 baud a bit is ~113 T-states — the same order as
         * the 112 above. Measured here, the `totalFrames` pair does not go
         * backwards at the two points MIDI reads the clock (a frame listener and
         * an AY port write); it sits a whole frame above this one. But the offset
         * is not stable — a frame in one run, two in another — so it steps
         * FORWARD by a frame at some point, and a byte that is mid-flight when it
         * does has one bit stretched by 70908 T: the UART then samples the rest
         * at whatever the line happens to hold and every edge after arrives in
         * the past. `absTStates()` is the neutral name for anything that needs
         * this clock; `diskClockNow()` is kept for the callers that read better
         * that way.
         */
        absTStates() {
            return this._diskClockBase + this.cpu.tStates;
        }

        diskClockNow() {
            return this.absTStates();
        }

        /**
         * When the next DRQ→NMI is due, for the two interfaces that transfer by
         * NMI. **An absolute schedule, not a delay.**
         *
         * The chip asserts DRQ on the medium's own clock: one byte per byte-time,
         * taken from the rotation (`byteTStates`) rather than from the rounded
         * 112 in `core/constants.js`, so it is right on a Pentagon's 716800-T
         * revolution as well as a 48K's 698880.
         *
         * **Absolute, from the previous DUE time, not from now.** Restarting the
         * interval when the host gets round to servicing the previous byte adds
         * the handler's own cost to every byte instead of letting it hide inside
         * the interval. The measurement is unambiguous — T-states a byte, against
         * the 111.8 the medium allows:
         *
         *     from the service   from the previous due
         *     Opus write  130.1            112.2    a track 1.15 rev -> 1.003
         *     MDOS write  127.9            112.2
         *     Opus read   135.7            111.9    512 bytes of a CAT
         *
         * **Reads and writes alike, and the symmetry was hard won.** A read looks
         * as though it must be serviced before the next DRQ — the chip has a byte
         * in the register and the next one will land on it — so this took a
         * `writing` argument and left reads measured from the service. That was
         * wrong, and wrong for an embarrassing reason: the retry storm that seemed
         * to prove reads could not be absolute was `opus-test` restoring a stubbed
         * `onDataRequest` by re-implementing it, which left the NMI permanently
         * due. Measured afterwards, the Opus read handler is **11 instructions and
         * 76 T-states** from NMI to RETN, 16 of them before it takes the byte — it
         * fits inside a byte time with a third to spare, and on real hardware it
         * has to. Nothing nests.
         *
         * A host that falls behind does not get the schedule pushed back: the byte
         * is simply overdue and the NMI is delivered at once, which is the point
         * at which a real chip would report lost data. We do not report it, and
         * now that the host CAN be late by construction that omission is real
         * rather than unreachable — see `TODO.md`.
         *
         * The first byte of a transfer is different either way — the ROM has
         * housekeeping to do before it can take an interrupt, and the head has to
         * settle and the sector come round — so it gets the longer one-off delay.
         */
        _drqDueAt(prevDue, first, ctrl) {
            const now = this.diskClockNow();
            // The FIRST byte is deliberately not held back by the floor. A chip
            // waiting for the index still asserts DRQ the moment the command is
            // written, so the host can have that byte in the register before the
            // pulse arrives — on real hardware, failing to is lost data. It is
            // the stream from the second byte on that starts at the index.
            if (first) return now + OPUS_DRQ_FIRST_TSTATES;
            const floor = (ctrl && ctrl.drqNotBefore) || 0;
            return Math.max(now, floor, prevDue + this.diskByteTStates());
        }

        /** How long one byte takes to pass the head, on this machine's clock. */
        diskByteTStates() {
            return byteTStates(revolutionTStates(this.timing.tstatesPerFrame));
        }

        /**
         * Hand every WD17xx controller the disk's own clock.
         *
         * Two things it needs, and neither belongs in a controller: a monotonic
         * T-state count, and how long a revolution is. Both are read live, as
         * functions, so a machine change is picked up: a revolution is ten frames
         * whatever the machine, which is 698880 T on a 48K and 709080 on a 128K.
         * See core/loaders/disk-rotation.js.
         */
        _wireDiskRotation() {
            const now = () => this.diskClockNow();
            const rev = () => revolutionTStates(this.timing.tstatesPerFrame);
            for (const ctrl of [this.betaDisk, this.plusD, this.opus, this.didaktik]) {
                if (ctrl && typeof ctrl.setRotationClock === 'function') {
                    ctrl.setRotationClock(now, rev);
                }
            }
        }

        // Beta Disk automatic ROM paging
        // Update cached flag for Beta Disk paging (call when conditions change)
        updateBetaDiskPagingFlag() {
            // Beta 48: an add-on Beta Disk (not the built-in one of a Pentagon or
            // Scorpion) set to a Beta 48 variant, with its ROM loaded. Never on an
            // HC-2000: a Beta 48 claims any port xxxxx111, which takes $07 and $87
            // from the HC IF1, and the two were never fitted together anyway.
            const beta48 = !this.profile.betaDiskDefault && this.betaDiskEnabled &&
                this.betaVariant !== '128' && this.memory.hasBeta48Rom() && !this.hcIf1;
            if (beta48 !== this.memory.beta48On) {
                this.memory.beta48On = beta48;
                this.memory.beta48Latch = false;
                this.memory.trdosActive = false;
            }
            // DECISION, not an omission: there is no `pagingModel !== '+2a'`
            // here, the way there is on all four below. A Beta Disk wired to a
            // +2A/+3 is a Frankenstein, but it is a buildable one, so TR-DOS
            // stays on offer wherever trdos.rom is loaded and the interface is
            // on -- including on a +3, which then shows both +3DOS and TR-DOS.
            // The other four overlay $0000-$3FFF, which +2A/+3 paging owns.
            // Not beside an HC IF1 either: it pages in at the same $0008 and
            // TR-DOS overlays $0000-$3FFF. Only the Beta 48 was guarded before.
            this._betaDiskPagingEnabled = !beta48 && !this.hcIf1 &&
                this.memory.hasTrdosRom() &&
                (this.profile.betaDiskDefault || this.betaDiskEnabled);
            // Interface 1 ROM paging flag: IF1 enabled + ROM loaded + compatible machine
            // IF1 is NOT compatible with +2A/+3 (they have their own extended paging)
            this._if1PagingEnabled = this._isHcIf1Present() || (
                this.if1Enabled &&
                this.memory.hasIF1Rom() &&
                this.profile.pagingModel !== '+2a' &&
                !this.hcIf1);
            // +D ROM auto-paging flag: +D enabled + ROM loaded + compatible machine
            // +D is NOT compatible with +2A/+3 (they have their own extended paging)
            // An HC-2000 with its HC IF1 pages that in at the same $0008, so
            // none of the add-on interfaces go with it (without it, they do).
            const hc = !!this.hcIf1;
            const kd = this._kempdiscOk();
            if (kd !== this._kempdiscEnabledFlag) {
                this._kempdiscEnabledFlag = kd;
                this.kempdisc.reset();
                this.memory.kempdiscActive = false;
            }
            // The FDD 3000's TI-397 board overlays $0000-$3FFF and shares port
            // $EF with the +D, so the two are mutually exclusive
            const fdd3 = this._fdd3000Ok();
            if (fdd3 !== this._fdd3000PagingEnabled) {
                this._fdd3000PagingEnabled = fdd3;
                this.memory.fdd3000Active = false;
                if (fdd3) this.fdd3000.reset(true);
            }
            this._plusDPagingEnabled = !fdd3 &&
                this.plusDEnabled &&
                this.memory.hasPlusDRom() &&
                this.profile.pagingModel !== '+2a' && !hc;
            // _isDiscipleActive() already excludes the HC IF1, for the same $0008
            this._disciplePagingEnabled = this._isDiscipleActive();
            // Opus Discovery paging flag: same machine restriction as the +D and
            // IF1 — it overlays $0000-$3FFF, which +2A/+3 paging already owns.
            this._opusPagingEnabled =
                this.opusEnabled &&
                this.memory.hasOpusRom() &&
                this.profile.pagingModel !== '+2a' && !hc;
            // Didaktik 80 is 48K ONLY, matching stock hardware — two independent
            // blockers, and the port collision is the first. The 128K paging port
            // decodes as `port & 0x8002 == 0` and OUT (n),A puts the written byte
            // on A15-A8, so a WD2797 command sent to $81 also pages memory ($00,
            // $20) or hits the AY ($88/$A8 data, $C4/$D0/$E4/$F4 register select).
            // Second, it pages itself in at $0000 and its ROM wants 48K BASIC
            // underneath, but paging out on a 128K gives ROM 0, the 128 editor:
            // red screen, no boot. Verified on 128K and Pentagon.
            // Real hardware managed it only with the A5 decoder patch (paging
            // becomes `port & 0x8022 == 0x0020`) plus ROM forced to page 1; we do
            // not offer that opt-in. See docs/peripherals.md.
            this._didaktikPagingEnabled =
                this.didaktikEnabled &&
                this.memory.hasDidaktikRom() &&
                this._didaktikMachineOk();
            // On a patched 128K the ROM is hardwired to page 1. Set here rather
            // than in memory.js so one call keeps the gate and the ROM hold in
            // step -- a 128K left on bank 0 boots the editor and MDOS dies.
            this.memory.didaktikForceRom1 =
                this._didaktikPagingEnabled && this.profile.pagingModel !== 'none';
        }

        // Called before each instruction fetch to handle automatic TR-DOS ROM switching
        // The Beta Disk interface has its own ROM chip with TR-DOS, which is paged in
        // when executing code in the 3D00-3DFF "magic" address range, and paged out
        // when execution moves to RAM (>=4000h)
        // Works on Pentagon (always) and 48K/128K (when Beta Disk enabled in settings)
        updateBetaDiskPaging() {
            // Fast path: skip if Beta Disk paging not needed
            if (!this._betaDiskPagingEnabled) return;

            const pc = this.cpu.pc;
            if (pc >= 0x3D00 && pc <= 0x3DFF) {
                // Entering TR-DOS magic area (0x3D00-0x3DFF) - page in TR-DOS ROM
                // For 128K: only activate when ROM 1 (48K BASIC) is selected
                // For 48K: always activate (only one ROM)
                if (!this.memory.trdosActive) {
                    // Scorpion: the 48K ROM SELECTED (7FFD bit 4), even with the
                    // service ROM over it (1FFD bit 1) -- MAME beta_enable_r
                    const rom1 = this.profile.pagingModel === 'scorpion'
                        ? (this.memory.scorpionPort7FFD & 0x10) !== 0
                        : this.memory.currentRomBank === this.profile.basicRomBank;
                    if (this.profile.pagingModel === 'none' || rom1) {
                        this.memory.trdosActive = true;
                    }
                }
            } else if (pc >= SLOT1_START) {
                // Entering RAM - page out TR-DOS ROM
                if (this.memory.trdosActive) {
                    this.memory.trdosActive = false;
                }
            }
        }

        /**
         * Interface 1 ROM auto-paging
         * Page IN: opcode fetch at $0008 (RST 8) or $1708 (CLOSE#)
         * Page OUT: after executing RET at $0700
         */
        updateIF1Paging() {
            if (!this._if1PagingEnabled) return;

            const pc = this.cpu.pc;
            if (!this.memory.if1Active) {
                // Page IN conditions
                if (pc === IF1_PAGE_IN_RST8 || pc === IF1_PAGE_IN_CLOSE) {
                    // Only page in when BASIC ROM is selected. The HC IF1 pages in
                    // whatever ROM is there, as in FUSE (its overlay is simply not
                    // visible under CP/M decoding, see Memory._hcIf1Visible).
                    if (this.profile.pagingModel === 'none' || this.profile.pagingModel === 'hc2000' ||
                        this.memory.currentRomBank === this.profile.basicRomBank) {
                        this.memory.if1Active = true;
                    }
                }
            } else {
                // Page OUT: set pending flag at $0700; actual unpage after RET executes
                if (pc === IF1_PAGE_OUT_ADDR) {
                    this._if1PageOutPending = true;
                }
            }
        }

        /**
         * DISCiPLE ROM auto-paging. Same mechanism as the +D below at different
         * addresses: page IN on an opcode fetch at $0001 (the byte after the
         * Spectrum ROM's DI, which is how GDOS gets control at reset), $0008,
         * $0066 and $028E; page OUT by writing port $BB. It has no $003A entry.
         */
        updateDisciplePaging() {
            if (!this._disciplePagingEnabled) return;
            if (this.memory.discipleActive) return;  // Already paged in
            const pc = this.cpu.pc;
            if (pc === 0x0001 || pc === 0x0008 || pc === 0x0066 || pc === 0x028E) {
                this.memory.discipleActive = true;
            }
        }

        /**
         * +D (DISCiPLE/+D) ROM auto-paging (per FUSE z80_ops.c)
         * Page IN: opcode fetch at $0008 (RST 8), $003A (KEY-NEXT),
         *          $0066 (NMI), $028E (KEY-SCAN)
         * Page OUT: via writing to paging port $E7
         * Note: FUSE does NOT restrict page-in to BASIC ROM only — the +D
         * intercepts these addresses regardless of which ROM bank is selected.
         */
        updatePlusDPaging() {
            if (!this._plusDPagingEnabled) return;
            if (this.memory.plusDActive) return;  // Already paged in

            const pc = this.cpu.pc;
            if (pc === PLUSD_PAGE_IN_RST8 || pc === PLUSD_PAGE_IN_KEYNEXT ||
                pc === PLUSD_PAGE_IN_NMI || pc === PLUSD_PAGE_IN_KEYSCAN) {
                this.memory.plusDActive = true;
            }
        }

        /**
         * Didaktik 80 ROM auto-paging (per FUSE z80_ops.c), checked BEFORE the
         * opcode fetch like the +D and IF1.
         *
         * Page IN at $0000 or $0008, page OUT at $1700. The `$0000` is what makes
         * this interface different from every other one here: it takes the
         * machine over from the moment of reset rather than waiting to be entered
         * through a hook, so its ROM — not the Spectrum's — is what boots.
         */
        updateDidaktikPaging() {
            if (!this._didaktikPagingEnabled) return;

            const pc = this.cpu.pc;
            if (!this.memory.didaktikActive) {
                if (pc === DIDAKTIK_PAGE_IN_RESET || pc === DIDAKTIK_PAGE_IN_RST8) {
                    this.memory.didaktikActive = true;
                }
            } else if (pc === DIDAKTIK_PAGE_OUT_ADDR) {
                this.memory.didaktikActive = false;
            }
        }

        /**
         * Opus Discovery ROM auto-paging (per FUSE z80_ops.c).
         * Page IN at $0008 (RST 8), $0048 (the ROM's KEY-INT hook) and $1708
         * (CLOSE#); page OUT at $1748.
         *
         * The ordering is what makes this one different. FUSE checks the +D and
         * IF1 BEFORE the opcode fetch, but checks the Opus AFTER it — so the
         * opcode comes from the Spectrum ROM while the operands come from the
         * Opus ROM. Our cpu.execute() is atomic and cannot page mid-instruction,
         * so this is called after the instruction with the PC it started at.
         *
         * That is equivalent here, and the ROMs say why. Of the four addresses
         * only $0008 takes operands: the 48K ROM has LD HL,($5C5D) there, so we
         * load HL from $5C5D where FUSE loads it from $0168. Either way the very
         * next instruction is the Opus ROM's POP HL at $000B, which overwrites
         * HL. The other three are one-byte instructions (PUSH BC, INC HL, RET),
         * so no operand is fetched and there is nothing to disagree about.
         */
        updateOpusPaging(oldPC) {
            if (!this._opusPagingEnabled) return;

            if (this.memory.opusActive) {
                if (oldPC === OPUS_PAGE_OUT_ADDR) {
                    this.memory.opusActive = false;
                }
            } else if (oldPC === OPUS_PAGE_IN_RST8 || oldPC === OPUS_PAGE_IN_KEYINT ||
                       oldPC === OPUS_PAGE_IN_CLOSE) {
                this.memory.opusActive = true;
            }
        }

        // ========== Debugging - Call Stack Tracking ==========

        // Track CALL/RST/INT (push) and RET/RETI/RETN (pop) by observing SP changes.
        // oldPC = PC before instruction, oldSP = SP before instruction.
        // After instruction: this.cpu.pc = new PC, this.cpu.sp = new SP.
        _trackCallStack(oldPC, oldSP) {
            const newSP = this.cpu.sp;
            const newPC = this.cpu.pc;
            const spDelta = (oldSP - newSP) & 0xFFFF;

            if (spDelta === 0) return; // No SP change

            // Suppress watchpoints during diagnostic memory reads
            this._suppressWatchpoints = true;
            if (spDelta === 2) {
                // SP decreased by 2 — possible CALL/RST (PUSH also decreases by 2)
                // Read the value that was pushed onto the stack (return address)
                const pushed = this.memory.read(newSP) | (this.memory.read((newSP + 1) & 0xFFFF) << 8);
                this._suppressWatchpoints = false;
                // For CALL nn: return addr = oldPC+3; for RST: return addr = oldPC+1
                // For CALL with DD/FD prefix: return addr = oldPC+4
                // Check if pushed value is a plausible return address (within 1-4 bytes of oldPC)
                // PUSH reg pushes register values, not return addresses — filtered out here
                const diff = (pushed - oldPC) & 0xFFFF;
                if (diff >= 1 && diff <= 4) {
                    // CALL/RST detected — newPC is the target, oldPC the call site
                    if (this.callGraph.enabled) {
                        let e = this.callGraph.edges.get(oldPC);
                        if (!e) { e = new Map(); this.callGraph.edges.set(oldPC, e); }
                        e.set(newPC, (e.get(newPC) || 0) + 1);
                    }
                    if (this._debugCallStack.length < this._debugCallStackMaxDepth) {
                        this._debugCallStack.push({ addr: newPC, caller: oldPC });
                    }
                }
            } else if (spDelta === 0xFFFE) {
                // SP increased by 2 — possible RET (POP also increases by 2)
                // Verify: for RET, newPC equals the value popped from [oldSP]
                // For POP reg, newPC = oldPC+1/+2 which won't match the popped data value
                const popped = this.memory.read(oldSP) | (this.memory.read((oldSP + 1) & 0xFFFF) << 8);
                this._suppressWatchpoints = false;
                if (newPC === popped && this._debugCallStack.length > 0) {
                    this._debugCallStack.pop();
                }
            } else {
                this._suppressWatchpoints = false;
                // SP changed by something other than ±2 (LD SP,nn / LD SP,HL / etc.)
                // Stack frame is no longer valid — reset call stack
                this._debugCallStack = [];
            }
        }

        // Track interrupt as a call (pushes PC onto stack, jumps to handler)
        _trackInterruptCall(oldPC, oldSP) {
            const newSP = this.cpu.sp;
            const newPC = this.cpu.pc;
            if (((oldSP - newSP) & 0xFFFF) === 2) {
                if (this._debugCallStack.length < this._debugCallStackMaxDepth) {
                    this._debugCallStack.push({ addr: newPC, caller: oldPC, isInt: true });
                }
                // Profiler: detect IM 2 handler and vector table address
                if (this.profiler.enabled && this.cpu.im === 2 && !this.profiler.im2) {
                    const iReg = this.cpu.i;
                    const vectorTableAddr = (iReg << 8);
                    this.profiler.im2 = {
                        handlerAddr: newPC,
                        vectorTableAddr: vectorTableAddr,
                        iReg: iReg
                    };
                }
            }
        }

        // ========== Runtime Behavior Profiler ==========

        startProfiling(maxFrames = 200) {
            this.profiler.enabled = true;
            this.profiler.maxFrames = maxFrames;
            this.profiler.framesRemaining = maxFrames;
            this.profiler.startFrame = this.totalFrames;
            this.profiler.subroutines.clear();
            this.profiler.im2 = null;
            this.profiler.tStatesPerPC.clear();
            this.updateMemoryCallbacksFlag();
        }

        stopProfiling() {
            if (!this.profiler.enabled) return;
            this.profiler.enabled = false;
            const framesProfiled = this.profiler.maxFrames - this.profiler.framesRemaining;
            const results = {
                framesProfiled,
                subroutines: new Map(this.profiler.subroutines),
                im2: this.profiler.im2,
                tStatesPerPC: new Map(this.profiler.tStatesPerPC),
                totalTStates: framesProfiled * this.getTstatesPerFrame()
            };
            // Analyze register signatures for subroutines in RAM
            this._analyzeRegSignatures(results);
            this.updateMemoryCallbacksFlag();
            if (this.profiler.onComplete) this.profiler.onComplete(results);
        }

        _analyzeRegSignatures(results) {
            const disasm = new Disassembler(this.memory);
            for (const [key, stats] of results.subroutines) {
                if (stats.entryAddr < 0x4000) continue;
                const accessed = new Map(); // reg → 'read'|'write' (first access)
                let pc = stats.entryAddr;
                for (let i = 0; i < 16; i++) {
                    if (pc > 0xFFFF) break;
                    let info;
                    try { info = disasm.disassemble(pc); } catch (e) { break; }
                    if (!info) break;
                    const m = (info.mnemonic || '').toUpperCase();
                    // Stop at unconditional control flow
                    if (/^(RET|JP [0-9$]|JP \(|RETI|RETN)\b/.test(m) && !/^(JP [A-Z]{1,2},)/.test(m)) break;
                    if (/^(CALL [0-9$]|RST )\b/.test(m) && !/^(CALL [A-Z]{1,2},)/.test(m)) break;

                    const regAccess = this._getRegAccess(m);
                    // Record first access per register: reads first, then writes
                    for (const r of regAccess.reads) {
                        if (!accessed.has(r)) accessed.set(r, 'read');
                    }
                    for (const w of regAccess.writes) {
                        if (!accessed.has(w)) accessed.set(w, 'write');
                    }
                    pc += info.length || 1;
                }
                // Build inputs (first-read) and outputs (first-write)
                const inputs = new Set();
                const outputs = new Set();
                for (const [reg, mode] of accessed) {
                    if (mode === 'read') inputs.add(reg);
                    else outputs.add(reg);
                }
                stats.regInputs = inputs;
                stats.regOutputs = outputs;
            }
        }

        _getRegAccess(mnemonic) {
            const reads = [];
            const writes = [];
            const m = mnemonic.toUpperCase().trim();
            const parts = m.split(/[\s,]+/);
            const op = parts[0];

            // Helper: expand pair to individual regs
            const expand = (r) => {
                switch (r) {
                    case 'BC': return ['B', 'C'];
                    case 'DE': return ['D', 'E'];
                    case 'HL': return ['H', 'L'];
                    case 'AF': return ['A', 'F'];
                    default: return [r];
                }
            };
            const isReg = (r) => /^[A-Z]{1,2}$/.test(r) && !['LD','ADD','ADC','SUB','SBC','AND','OR','XOR','CP','INC','DEC','PUSH','POP','EX','IN','OUT','BIT','SET','RES','JP','JR','CALL','RET','RST','NOP','HALT','DI','EI','IM','RLC','RRC','RL','RR','SLA','SRA','SRL','DJNZ','NEG','CCF','SCF','CPL','DAA','RLA','RRA','RLCA','RRCA','LDIR','LDDR','CPIR','CPDR','INIR','INDR','OTIR','OTDR','RETI','RETN','NOP'].includes(r);

            switch (op) {
                case 'LD': {
                    const dst = parts[1];
                    const src = parts.length > 2 ? parts.slice(2).join(',') : '';
                    // Writes to destination
                    if (isReg(dst)) writes.push(...expand(dst));
                    else if (dst === '(HL)') reads.push('H', 'L');
                    else if (dst.match(/^\(IX/)) reads.push('IX');
                    else if (dst.match(/^\(IY/)) reads.push('IY');
                    // Reads from source
                    const srcClean = src.replace(/[()]/g, '');
                    if (isReg(srcClean)) reads.push(...expand(srcClean));
                    else if (src.includes('(HL)')) reads.push('H', 'L');
                    else if (src.includes('(BC)')) reads.push('B', 'C');
                    else if (src.includes('(DE)')) reads.push('D', 'E');
                    else if (src.match(/\(IX/)) reads.push('IX');
                    else if (src.match(/\(IY/)) reads.push('IY');
                    break;
                }
                case 'ADD': case 'ADC': case 'SUB': case 'SBC':
                case 'AND': case 'OR': case 'XOR': case 'CP': {
                    reads.push('A');
                    if (op !== 'CP') writes.push('A', 'F'); else writes.push('F');
                    const operand = parts.length > 2 ? parts[2] : parts[1];
                    if (operand && isReg(operand)) reads.push(...expand(operand));
                    if (operand === '(HL)') reads.push('H', 'L');
                    // ADD HL,rr
                    if (parts[1] === 'HL' && parts.length > 2) {
                        reads.push('H', 'L');
                        writes.push('H', 'L', 'F');
                        if (isReg(parts[2])) reads.push(...expand(parts[2]));
                    }
                    break;
                }
                case 'INC': case 'DEC': {
                    const r = parts[1];
                    if (isReg(r)) { reads.push(...expand(r)); writes.push(...expand(r)); writes.push('F'); }
                    if (r === '(HL)') reads.push('H', 'L');
                    break;
                }
                case 'PUSH': {
                    const r = parts[1];
                    if (isReg(r)) reads.push(...expand(r));
                    break;
                }
                case 'POP': {
                    const r = parts[1];
                    if (isReg(r)) writes.push(...expand(r));
                    break;
                }
                case 'EX': {
                    if (m.includes('DE') && m.includes('HL')) {
                        reads.push('D', 'E', 'H', 'L');
                        writes.push('D', 'E', 'H', 'L');
                    }
                    break;
                }
                case 'LDIR': case 'LDDR':
                    reads.push('B', 'C', 'D', 'E', 'H', 'L');
                    writes.push('B', 'C', 'D', 'E', 'H', 'L', 'F');
                    break;
                case 'CPIR': case 'CPDR':
                    reads.push('A', 'B', 'C', 'H', 'L');
                    writes.push('B', 'C', 'H', 'L', 'F');
                    break;
                case 'DJNZ':
                    reads.push('B'); writes.push('B', 'F');
                    break;
                case 'NEG':
                    reads.push('A'); writes.push('A', 'F');
                    break;
                case 'CPL': case 'DAA':
                case 'RLA': case 'RRA': case 'RLCA': case 'RRCA':
                    reads.push('A'); writes.push('A', 'F');
                    break;
                case 'CCF': case 'SCF':
                    writes.push('F');
                    break;
                case 'BIT': {
                    const r = parts[parts.length - 1];
                    if (isReg(r)) reads.push(r);
                    writes.push('F');
                    break;
                }
                case 'SET': case 'RES': {
                    const r = parts[parts.length - 1];
                    if (isReg(r)) { reads.push(r); writes.push(r); }
                    break;
                }
                case 'RLC': case 'RRC': case 'RL': case 'RR':
                case 'SLA': case 'SRA': case 'SRL': {
                    const r = parts[1];
                    if (isReg(r)) { reads.push(r); writes.push(r, 'F'); }
                    break;
                }
                case 'IN': {
                    const dst = parts[1];
                    if (isReg(dst)) writes.push(dst);
                    break;
                }
                case 'OUT': {
                    const src = parts.length > 2 ? parts[2] : parts[1];
                    const srcClean = (src || '').replace(/[()]/g, '');
                    if (isReg(srcClean)) reads.push(srcClean);
                    break;
                }
            }
            // Deduplicate
            return {
                reads: [...new Set(reads)],
                writes: [...new Set(writes)]
            };
        }

        startPokeWriteTrace() {
            this.pokeWriteTraceAddrs = new Set();
            this.pokeWriteTraceEnabled = true;
            this.updateMemoryCallbacksFlag();
        }

        stopPokeWriteTrace() {
            this.pokeWriteTraceEnabled = false;
            this.updateMemoryCallbacksFlag();
            return this.pokeWriteTraceAddrs;
        }

        startWriteMonitor(addr) {
            this.writeMonitor.addr = addr & 0xFFFF;
            this.writeMonitor.hits = [];
            this.writeMonitor.enabled = true;
            this.updateMemoryCallbacksFlag();
        }

        stopWriteMonitor() {
            this.writeMonitor.enabled = false;
            const results = this.writeMonitor.hits;
            this.writeMonitor.hits = [];
            this.updateMemoryCallbacksFlag();
            return results;
        }

        startReadMonitor(addr) {
            this.readMonitor.addr = addr & 0xFFFF;
            this.readMonitor.hits = [];
            this.readMonitor.enabled = true;
            this.updateMemoryCallbacksFlag();
        }

        stopReadMonitor() {
            this.readMonitor.enabled = false;
            const results = this.readMonitor.hits;
            this.readMonitor.hits = [];
            this.updateMemoryCallbacksFlag();
            return results;
        }

        startCodePathRecording() {
            this.codePath.executed = new Set();
            this.codePath.enabled = true;
            this.updateMemoryCallbacksFlag();
        }

        stopCodePathRecording() {
            this.codePath.enabled = false;
            const result = this.codePath.executed;
            this.codePath.executed = null;
            this.updateMemoryCallbacksFlag();
            return result;  // Set<string> of autoMapKeys
        }

        // ========== Ordered execution trace (differential runs) ==========

        // `limit` is a hard ceiling on entries, not a ring: a differential run
        // compares from the start, so the beginning is what must be kept. Four
        // bytes an instruction, so a million entries is 4MB and about a third of
        // a second of 48K execution — enough to reach a decision, not enough to
        // record a game. Past it the trace says it was cut short, because a run
        // that stopped early proves nothing about what came after.
        startExecTrace({ limit = 1 << 20, from = 0, to = 0xFFFF } = {}) {
            const t = this.execTrace;
            t.limit = Math.max(1, limit | 0);
            t.pcs = new Uint32Array(t.limit);
            t.count = 0;
            t.truncated = false;
            t.lo = from & 0xFFFF;
            t.hi = to & 0xFFFF;
            t.filtered = !(t.lo === 0 && t.hi === 0xFFFF);
            t.enabled = true;
            this.updateMemoryCallbacksFlag();
        }

        stopExecTrace() {
            const t = this.execTrace;
            t.enabled = false;
            this.updateMemoryCallbacksFlag();
            const result = {
                pcs: t.pcs ? t.pcs.subarray(0, t.count) : new Uint32Array(0),
                count: t.count,
                truncated: t.truncated,
                limit: t.limit,
            };
            t.pcs = null;
            return result;
        }

        startCodePathTracing(baselineSet) {
            this.codePath.baselineSet = baselineSet;
            this.codePath.traceHit = false;
            this.codePath.traceAddr = 0;
            this.codePath.tracing = true;
            this.updateMemoryCallbacksFlag();
        }

        stopCodePathTracing() {
            this.codePath.tracing = false;
            this.codePath.baselineSet = null;
            this.codePath.traceHit = false;
            this.updateMemoryCallbacksFlag();
        }

        // ========== Memory Freeze ==========

        setFrozenAddresses(list) {
            this.frozenAddresses = list;
        }

        // ========== Comparison Breakpoint ==========

        startComparisonBreakpoint(addrA, addrB, op) {
            this.comparisonBreakpoint.addrA = addrA & 0xFFFF;
            this.comparisonBreakpoint.addrB = addrB & 0xFFFF;
            this.comparisonBreakpoint.op = op;
            this.comparisonBreakpoint.hit = false;
            this.comparisonBreakpoint.enabled = true;
            this.updateMemoryCallbacksFlag();
            // Check immediately in case the condition is already true
            this._checkComparisonBreakpoint();
        }

        stopComparisonBreakpoint() {
            this.comparisonBreakpoint.enabled = false;
            this.comparisonBreakpoint.hit = false;
            this.updateMemoryCallbacksFlag();
        }

        _checkComparisonBreakpoint() {
            const bp = this.comparisonBreakpoint;
            const a = this.memory.read(bp.addrA);
            const b = this.memory.read(bp.addrB);
            let match = false;
            switch (bp.op) {
                case '==': match = a === b; break;
                case '!=': match = a !== b; break;
                case '<':  match = a < b;   break;
                case '>':  match = a > b;   break;
                case '<=': match = a <= b;  break;
                case '>=': match = a >= b;  break;
            }
            if (match) {
                this.watchpointHit = true;
                this.lastWatchpoint = {
                    addr: bp.addrA, type: 'comparison',
                    message: `Compare: ($${hex16(bp.addrA)})=${a} ${bp.op} ($${hex16(bp.addrB)})=${b}`
                };
            }
        }

        // ========== Register Tracker ==========

        startRegisterTracker(pc, reg) {
            this.registerTracker.pc = pc & 0xFFFF;
            this.registerTracker.register = reg;
            this.registerTracker.values = [];
            this.registerTracker.enabled = true;
            this.updateMemoryCallbacksFlag();
        }

        stopRegisterTracker() {
            this.registerTracker.enabled = false;
            const results = this.registerTracker.values;
            this.registerTracker.values = [];
            this.updateMemoryCallbacksFlag();
            return results;
        }

        _captureRegisterValue() {
            if (this.registerTracker.values.length >= this.registerTracker.maxSamples) return;
            const value = this._getRegisterValue(this.registerTracker.register);
            this.registerTracker.values.push({ value, frame: this.totalFrames });
        }

        _getRegisterValue(name) {
            const cpu = this.cpu;
            switch (name) {
                case 'A': return cpu.a;
                case 'B': return cpu.b;
                case 'C': return cpu.c;
                case 'D': return cpu.d;
                case 'E': return cpu.e;
                case 'H': return cpu.h;
                case 'L': return cpu.l;
                case 'F': return cpu.f;
                case 'BC': return (cpu.b << 8) | cpu.c;
                case 'DE': return (cpu.d << 8) | cpu.e;
                case 'HL': return (cpu.h << 8) | cpu.l;
                case 'IX': return cpu.ix;
                case 'IY': return cpu.iy;
                case 'SP': return cpu.sp;
                default: return 0;
            }
        }

        // ========== Struct Mapper ==========

        startStructMapper(baseAddr, baseReg, maxOffset) {
            this.structMapper.baseAddr = baseAddr & 0xFFFF;
            this.structMapper.baseReg = baseReg;
            this.structMapper.maxOffset = maxOffset;
            this.structMapper.fields = new Map();
            this.structMapper.enabled = true;
            this.updateMemoryCallbacksFlag();
        }

        stopStructMapper() {
            this.structMapper.enabled = false;
            const results = new Map(this.structMapper.fields);
            this.structMapper.fields = new Map();
            this.updateMemoryCallbacksFlag();
            return results;
        }

        _getStructBase() {
            if (this.structMapper.baseReg === 'IX') return this.cpu.ix;
            if (this.structMapper.baseReg === 'IY') return this.cpu.iy;
            return this.structMapper.baseAddr;
        }

        _profilerCurrentSub() {
            const stack = this._debugCallStack;
            if (stack.length === 0) return null;
            return stack[stack.length - 1];
        }

        _profilerGetOrCreateStats(entryAddr) {
            const key = this.getAutoMapKey(entryAddr);
            let stats = this.profiler.subroutines.get(key);
            if (!stats) {
                stats = {
                    entryAddr,
                    page: (this.memory.machineType === '48k') ? null :
                          (entryAddr >= SLOT3_START ? String(this.memory.currentRamBank) :
                           entryAddr < SLOT1_START ? 'R' + this.memory.currentRomBank : null),
                    callCount: 0,
                    portsIn: new Set(),
                    portsOut: new Set(),
                    writesScreenBitmap: false,
                    writesScreenAttr: false,
                    readsScreenBitmap: false,
                    readsScreenAttr: false,
                    calledFromISR: false,
                    callees: new Set(),
                    callers: new Set(),
                    framesCalled: new Set(),
                    beeperOuts: 0
                };
                this.profiler.subroutines.set(key, stats);
            }
            return stats;
        }

        _profilerTrackCallRet(oldPC, oldSP) {
            const newSP = this.cpu.sp;
            const newPC = this.cpu.pc;
            const spDelta = (oldSP - newSP) & 0xFFFF;
            const frame = this.totalFrames - this.profiler.startFrame;

            if (spDelta === 2) {
                // Possible CALL/RST — verify via return address
                this._suppressWatchpoints = true;
                const pushed = this.memory.read(newSP) | (this.memory.read((newSP + 1) & 0xFFFF) << 8);
                this._suppressWatchpoints = false;
                const diff = (pushed - oldPC) & 0xFFFF;
                if (diff >= 1 && diff <= 4) {
                    // CALL/RST confirmed — record entry
                    const stats = this._profilerGetOrCreateStats(newPC);
                    stats.callCount++;
                    stats.callers.add(this.getAutoMapKey(oldPC));
                    stats.framesCalled.add(frame);

                    // Check ISR context — walk up call stack
                    for (const entry of this._debugCallStack) {
                        if (entry.isInt) { stats.calledFromISR = true; break; }
                    }

                    // Record callee relationship with caller
                    const parentEntry = this._debugCallStack.length >= 2
                        ? this._debugCallStack[this._debugCallStack.length - 2]
                        : null;
                    if (parentEntry) {
                        const parentKey = this.getAutoMapKey(parentEntry.addr);
                        const parentStats = this.profiler.subroutines.get(parentKey);
                        if (parentStats) parentStats.callees.add(this.getAutoMapKey(newPC));
                    }
                }
            }
            // RET handled implicitly — _debugCallStack pop already happened
        }

        // ========== Debugging - Stepping ==========

        stepInto() {
            if (this.running || !this.romLoaded) return false;
            if (this._bpTStatesResetPending) {
                this.breakpointTStates = 0;
                this._bpTStatesResetPending = false;
            }

            // If CPU is halted, run until INT fires and CPU exits HALT
            if (this.cpu.halted) {
                return this.stepOutOfHalt();
            }

            // Beta Disk automatic ROM paging
            this.updateBetaDiskPaging();
            // Clear trace ops and capture PC/bytes before execution
            const tracing = this.traceEnabled && this.onBeforeStep;
            if (tracing) {
                this.tracePortOps = [];
                this.traceMemOps = [];
            }
            const instrPC = tracing ? this.cpu.pc : 0;
            let instrBytes = null;
            if (tracing) {
                this._suppressWatchpoints = true;
                instrBytes = [
                    this.memory.read(instrPC),
                    this.memory.read((instrPC + 1) & 0xffff),
                    this.memory.read((instrPC + 2) & 0xffff),
                    this.memory.read((instrPC + 3) & 0xffff)
                ];
                this._suppressWatchpoints = false;
            }
            this.autoMap.inExecution = true;
            const tBefore = this.cpu.tStates;
            const _siOldPC = this.cpu.pc, _siOldSP = this.cpu.sp;
            this._currentInstrPC = _siOldPC;
            this._inCpuExecution = true;
            this.cpu.step();
            this._inCpuExecution = false;
            this._trackCallStack(_siOldPC, _siOldSP);
            this.autoMap.inExecution = false;

            // Handle frame boundary crossing during stepping (with late timing support)
            const frameCrossed = this.handleFrameBoundary();
            // Accumulate T-states for breakpoint counter (account for frame wrap)
            if (frameCrossed) {
                this.breakpointTStates += (this.getTstatesPerFrame() - tBefore) + this.cpu.tStates;
            } else {
                this.breakpointTStates += this.cpu.tStates - tBefore;
            }

            // Record trace after execution (includes port/mem ops)
            if (tracing) {
                this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
            }
            if (this.autoMap.enabled) this.autoMap.currentFetchAddrs.clear();
            this.renderToScreen();
            return true;
        }

        // Step out of HALT state by running to next INT
        stepOutOfHalt() {
            const tstatesPerFrame = this.getTstatesPerFrame();
            const maxCycles = tstatesPerFrame * 2; // Max 2 frames
            let cycles = 0;

            while (this.cpu.halted && cycles < maxCycles) {
                // Check for frame boundary and fire INT (with late timing support)
                if (this.handleFrameBoundary()) {
                    // INT was fired, CPU exits HALT
                    break;
                }
                this.cpu.tStates += 4;
                this.cpu.incR();
                cycles += 4;
            }

            this.breakpointTStates += cycles;
            this.renderToScreen();
            return !this.cpu.halted;
        }

        // Redraw current screen (for grid toggle when paused)
        redraw() {
            if (!this.romLoaded) return;
            this.renderToScreen();
        }
        
        // Helper to render current state without executing CPU
        renderToScreen() {
            // Set borderOnly BEFORE rendering so renderFrame uses correct mode
            const borderOnly = this.overlayMode === 'screen' || this.overlayMode === 'reveal' || this.overlayMode === 'beamscreen';
            this.ula.borderOnly = borderOnly;

            // In beam modes, preserve the scanline-by-scanline rendered frame buffer
            // (don't re-render entire screen which would lose per-scanline attribute changes)
            const isBeamMode = this.overlayMode === 'beam' || this.overlayMode === 'beamscreen';
            let frameBuffer;

            if (isBeamMode) {
                // Render scanlines up to current T-state position for accurate beam display
                this.ula.updateScanline(this.cpu.tStates);
                frameBuffer = this.ula.frameBuffer;
            } else {
                // Initialize border changes with current border color (for static rendering)
                this.ula.borderChanges = [{tState: 0, color: this.ula.borderColor}];
                frameBuffer = this.ula.renderFrame();
            }

            // Handle border-only modes: replace paper area with border color
            const borderOnlyMode = this.overlayMode === 'screen' || this.overlayMode === 'reveal' || this.overlayMode === 'beamscreen';
            if (borderOnlyMode) {
                const dims = this.ula.getDimensions();
                const changes = this.ula.borderChanges;
                const palette = this.ula.palette;

                for (let y = dims.borderTop; y < dims.borderTop + dims.screenHeight; y++) {
                    const lineStartTstate = this.ula.calculateLineStartTstate(y);
                    let currentColor = (changes && changes.length > 0) ? changes[0].color : this.ula.borderColor;
                    let changeIdx = 0;

                    if (changes && changes.length > 0) {
                        for (let i = 0; i < changes.length; i++) {
                            if (changes[i].tState <= lineStartTstate) {
                                currentColor = changes[i].color;
                                changeIdx = i + 1;
                            } else {
                                break;
                            }
                        }
                    }

                    for (let x = dims.borderLeft; x < dims.borderLeft + dims.screenWidth; x++) {
                        const pixelTstate = lineStartTstate + Math.floor(x / 2);
                        if (changes) {
                            while (changeIdx < changes.length && changes[changeIdx].tState <= pixelTstate) {
                                currentColor = changes[changeIdx].color;
                                changeIdx++;
                            }
                        }
                        const colorIdx = currentColor & 7;
                        const rgb = palette ? palette[colorIdx] : [0, 0, 0, 255];
                        const idx = (y * dims.width + x) * 4;
                        frameBuffer[idx] = rgb[0];
                        frameBuffer[idx + 1] = rgb[1];
                        frameBuffer[idx + 2] = rgb[2];
                        frameBuffer[idx + 3] = 255;
                    }
                }
            }

            // Save frame for beam visualization modes AFTER border-only modification
            // so previousFrameBuffer includes border lines in paper area
            // But don't save in beam mode - we want to keep the last complete frame
            if (!isBeamMode) {
                this.savePreviousFrame(frameBuffer);
            }

            this.blitFrame(frameBuffer);
            this.ctx.putImageData(this.imageData, 0, 0);
            this.drawOverlay();
        }

        // Execute until past current instruction (skip over CALL/RST/DJNZ)
        stepOver(maxCycles = 80000) {
            if (this.running || !this.romLoaded) return { skipped: false, reached: true };
            const pc = this.cpu.pc;
            const opcode = this.memory.read(pc);

            // Check if it's a CALL or RST instruction
            const isCall = (opcode === 0xCD) || // CALL nn
                          (opcode & 0xC7) === 0xC4 || // CALL cc,nn
                          (opcode & 0xC7) === 0xC7;   // RST n

            // Check if it's a repeating block instruction (ED prefix)
            // LDIR(B0) CPIR(B1) INIR(B2) OTIR(B3) LDDR(B8) CPDR(B9) INDR(BA) OTDR(BB)
            let isBlockRepeat = false;
            if (opcode === 0xED) {
                const byte2 = this.memory.read((pc + 1) & 0xffff);
                if ((byte2 & 0xF4) === 0xB0) isBlockRepeat = true;
            }

            // Check if it's DJNZ (0x10)
            const isDJNZ = (opcode === 0x10);

            if (isCall || isBlockRepeat || isDJNZ) {
                // Determine instruction length to find next PC
                let nextPC;
                if (isBlockRepeat || isDJNZ) {
                    // ED xx - 2 bytes / DJNZ e - 2 bytes
                    nextPC = (pc + 2) & 0xffff;
                } else if ((opcode & 0xC7) === 0xC7) {
                    // RST - 1 byte
                    nextPC = (pc + 1) & 0xffff;
                } else {
                    // CALL - 3 bytes
                    nextPC = (pc + 3) & 0xffff;
                }
                // Block repeats (LDIR etc.) always complete; CALL/RST use configurable limit
                // DJNZ: if loop body is safe (no branches/B-modifying), always complete; else use limit
                let limit;
                if (isBlockRepeat) {
                    limit = 10000000;
                } else if (isDJNZ) {
                    const disp = this.memory.read((pc + 1) & 0xffff);
                    const signedDisp = disp < 128 ? disp : disp - 256;
                    const target = (pc + 2 + signedDisp) & 0xffff;
                    limit = (signedDisp < 0 && this._isDjnzLoopSafe(target, pc)) ? 10000000 : maxCycles;
                } else {
                    limit = maxCycles;
                }
                const reached = this.runToAddress(nextPC, limit);
                return { skipped: true, reached, isDJNZ };
            } else {
                this.stepInto();
                return { skipped: false, reached: true, isDJNZ: false };
            }
        }

        // Check if a DJNZ loop body (from loopStart to djnzAddr-1) is safe to run
        // without a T-state limit: no branches, no B-modifying instructions.
        // Returns true if the loop is guaranteed to terminate (B decrements to 0).
        _isDjnzLoopSafe(loopStart, djnzAddr) {
            const mem = this.memory;

            // Is this unprefixed opcode a branch or B-modifying instruction?
            function isUnsafe(op) {
                // Flow control
                if (op === 0xC3 || (op & 0xC7) === 0xC2) return true;  // JP nn / JP cc,nn
                if (op === 0x18 || (op & 0xE7) === 0x20) return true;  // JR e / JR cc,e
                if (op === 0xCD || (op & 0xC7) === 0xC4) return true;  // CALL nn / CALL cc,nn
                if ((op & 0xC7) === 0xC7) return true;                 // RST n
                if (op === 0xC9 || (op & 0xC7) === 0xC0) return true;  // RET / RET cc
                if (op === 0xE9) return true;                           // JP (HL)
                if (op === 0x10) return true;                           // nested DJNZ
                if (op === 0x76) return true;                           // HALT
                // B-modifying
                if (op === 0x01) return true;                           // LD BC,nn
                if (op === 0x03) return true;                           // INC BC
                if (op === 0x04) return true;                           // INC B
                if (op === 0x05) return true;                           // DEC B
                if (op === 0x06) return true;                           // LD B,n
                if (op === 0x0B) return true;                           // DEC BC
                if ((op & 0xF8) === 0x40 && op !== 0x40) return true;  // LD B,r (skip LD B,B)
                if (op === 0xC1) return true;                           // POP BC
                if (op === 0xD9) return true;                           // EXX
                return false;
            }

            // Unprefixed instruction length (1, 2, or 3 bytes)
            function instrLen(op) {
                if (op < 0x40) {
                    if ((op & 0x07) === 6) return 2;                    // LD r,n
                    if ((op & 0x0F) === 1 && !(op & 0x08)) return 3;   // LD rr,nn
                    if (op === 0x10 || op === 0x18) return 2;           // DJNZ / JR
                    if ((op & 0xE7) === 0x20) return 2;                 // JR cc
                    if (op === 0x22 || op === 0x2A || op === 0x32 || op === 0x3A) return 3;
                    return 1;
                }
                if (op < 0xC0) return 1;                                // LD r,r' / ALU A,r
                if ((op & 0x07) === 6) return 2;                        // ALU A,n
                if ((op & 0x07) === 2 || (op & 0x07) === 4) return 3;  // JP cc,nn / CALL cc,nn
                if (op === 0xC3 || op === 0xCD) return 3;               // JP nn / CALL nn
                if (op === 0xD3 || op === 0xDB) return 2;               // OUT (n),A / IN A,(n)
                return 1;
            }

            // Does this unprefixed opcode reference (HL)? (DD/FD adds displacement byte)
            function usesHL(op) {
                if (op === 0x34 || op === 0x35 || op === 0x36) return true; // INC/DEC/LD (HL),n
                if (op >= 0x40 && op < 0x80 && op !== 0x76) {
                    if ((op & 0x07) === 0x06 || (op & 0x38) === 0x30) return true;
                }
                if (op >= 0x80 && op < 0xC0 && (op & 0x07) === 0x06) return true;
                return false;
            }

            let addr = loopStart;
            for (let n = 0; n < 256 && addr !== djnzAddr; n++) {
                const op = mem.read(addr);

                // DD/FD prefix (IX/IY)
                if (op === 0xDD || op === 0xFD) {
                    const op2 = mem.read((addr + 1) & 0xffff);
                    if (op2 === 0xCB) {
                        // DD CB d op — 4 bytes; check if result stored in B
                        const op4 = mem.read((addr + 3) & 0xffff);
                        if ((op4 & 0x07) === 0 && (op4 & 0xC0) !== 0x40) return false;
                        addr = (addr + 4) & 0xffff;
                        continue;
                    }
                    if (op2 === 0xDD || op2 === 0xFD || op2 === 0xED) {
                        // Chained prefix — skip this one
                        addr = (addr + 1) & 0xffff;
                        continue;
                    }
                    if (isUnsafe(op2)) return false;
                    addr = (addr + 1 + instrLen(op2) + (usesHL(op2) ? 1 : 0)) & 0xffff;
                    continue;
                }

                // CB prefix (bit/rotate/shift) — 2 bytes
                if (op === 0xCB) {
                    const op2 = mem.read((addr + 1) & 0xffff);
                    // Target register B (bits 0-2 = 0), excluding BIT (read-only)
                    if ((op2 & 0x07) === 0 && (op2 & 0xC0) !== 0x40) return false;
                    addr = (addr + 2) & 0xffff;
                    continue;
                }

                // ED prefix
                if (op === 0xED) {
                    const op2 = mem.read((addr + 1) & 0xffff);
                    if (op2 === 0x45 || op2 === 0x4D) return false;     // RETN / RETI
                    if (op2 === 0x40) return false;                     // IN B,(C)
                    if (op2 === 0x4B) return false;                     // LD BC,(nn)
                    if ((op2 & 0xE4) === 0xA0) return false;           // block ops (LDI/LDIR/CPI/etc.)
                    addr = (addr + (((op2 & 0xC7) === 0x43) ? 4 : 2)) & 0xffff;
                    continue;
                }

                // Unprefixed
                if (isUnsafe(op)) return false;
                addr = (addr + instrLen(op)) & 0xffff;
            }
            return addr === djnzAddr;
        }

        // Run until PC reaches target address (or max cycles exceeded)
        runToAddress(targetAddr, maxCycles = 10000000) {
            if (this.running || !this.romLoaded) return false;
            if (this._bpTStatesResetPending) {
                this.breakpointTStates = 0;
                this._bpTStatesResetPending = false;
            }
            this.autoMap.inExecution = true;
            const tracing = this.traceEnabled && this.onBeforeStep;
            const tstatesPerFrame = this.getTstatesPerFrame();
            let cycles = 0;
            const startPC = this.cpu.pc;  // Skip breakpoint at starting PC (for HALT)
            while (this.cpu.pc !== targetAddr && cycles < maxCycles) {
                // Beta Disk automatic ROM paging
                this.updateBetaDiskPaging();
                // Check breakpoint (skip at start PC and target PC)
                if (this.cpu.pc !== startPC && this.cpu.pc !== targetAddr && this.hasBreakpointAt(this.cpu.pc)) {
                    this.breakpointHit = true;
                    this.autoMap.inExecution = false;
                    this.breakpointTStates += cycles;
                    this.renderToScreen();
                    if (this.onBreakpoint) this.onBreakpoint(this.cpu.pc);
                    this._bpTStatesResetPending = true;
                    return false;
                }
                // Clear trace ops and capture PC/bytes before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                let instrBytes = null;
                if (tracing) {
                    this._suppressWatchpoints = true;
                    instrBytes = [
                        this.memory.read(instrPC),
                        this.memory.read((instrPC + 1) & 0xffff),
                        this.memory.read((instrPC + 2) & 0xffff),
                        this.memory.read((instrPC + 3) & 0xffff)
                    ];
                    this._suppressWatchpoints = false;
                }
                const _rtaOldPC = this.cpu.pc, _rtaOldSP = this.cpu.sp;
                this._currentInstrPC = _rtaOldPC;
                this._inCpuExecution = true;
                cycles += this.cpu.step();
                this._inCpuExecution = false;
                this._trackCallStack(_rtaOldPC, _rtaOldSP);

                // Handle frame boundary crossing (with late timing support)
                this.handleFrameBoundary();

                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                }
            }
            this.autoMap.inExecution = false;
            this.breakpointTStates += cycles;
            // Render current screen state
            this.renderToScreen();
            return this.cpu.pc === targetAddr;
        }
        
        // Get T-states per frame for current machine
        getTstatesPerFrame() {
            return this.timing.tstatesPerFrame;
        }

        // Get floating bus value based on current T-state
        // Returns the byte the ULA is currently reading from video memory
        // When not during active display, returns 0xFF
        // Reference: https://sinclair.wiki.zxnet.co.uk/wiki/Floating_bus
        // What the Scorpion puts on the bus for a port nobody answers: the
        // attribute being fetched. The ULA reads one attribute per character cell,
        // and a cell is 4 T-states, so the tick picks the cell directly -- there is
        // no 4-on/4-off idle pattern as on a Ferranti machine.
        //
        // NOT verified against real hardware: the behaviour is documented, the exact
        // tick alignment is not. ctprobe checks it against unreal-ng's grid, which
        // its own README calls unconfirmed. Treat a disagreement as open.
        getAttrBusValue() {
            const t = (this._ioCycleT || this.cpu.tStates) + IO_CYCLE_READ_T;
            const perLine = this.timing.tstatesPerLine;
            const screenLine = Math.floor(t / perLine) - this.ula.FIRST_SCREEN_LINE;
            if (screenLine < 0 || screenLine >= 192) return 0xff;
            const tInLine = t % perLine;
            // FITTED to ctprobe's Scorpion grid, which is the only reference that
            // exists and which its own README calls unconfirmed on real hardware.
            // The attribute leads the 48K bitmap window by two ticks. This is the
            // single knob if a real Scorpion ever says otherwise.
            const start = -1;
            if (tInLine < start || tInLine >= start + 128) return 0xff;
            const col = Math.floor((tInLine - start) / 4);
            if (col < 0 || col > 31) return 0xff;
            return this.memory.read(SCREEN_ATTR | ((screenLine >> 3) << 5) | col);
        }

        getFloatingBusValue() {
            // The I/O cycle's own tick, set by portRead, not the instruction's start.
            // IO_CYCLE_READ_T is where in that 4T cycle the byte is actually taken.
            const t = (this._ioCycleT || this.cpu.tStates) + IO_CYCLE_READ_T;
            const tstatesPerLine = this.timing.tstatesPerLine;  // 224 for 48K
            const line = Math.floor(t / tstatesPerLine);
            const tInLine = t % tstatesPerLine;

            // Screen display area: use ULA's first screen line
            const firstScreenLine = this.ula.FIRST_SCREEN_LINE;
            const screenLine = line - firstScreenLine;

            if (screenLine < 0 || screenLine >= 192) {
                return 0xff;  // Not in screen area
            }

            // Floating bus timing for 48K:
            // Swan: FloatBusFirstInterestingTick = ContentionFrom + 4 = 14335 + 4 = 14339
            // Line 64 starts at T=14336, so first read is at tInLine=3 (14336+3=14339)
            // For late timing: pattern shifts +1 T-state (first read at tInLine=4)
            // Pattern: 4 reads (bitmap,attr,bitmap,attr), 4 idle, repeating for 128 T-states
            const lateOffset = (this.lateTimings && this.profile.earlyIntTiming) ? 1 : 0;
            // Where in the line the ULA's fetch window starts, per machine. Both
            // fitted to ctprobe P-02: the 128K was 0 and came out exactly one tick
            // early once the sample moved to the I/O cycle. Only the 48K has the
            // late/early switch (earlyIntTiming), and there it moves the window with
            // the interrupt.
            const floatStart = ((this.profile.ulaProfile === '48k') ? 3 : 1) + lateOffset;
            const floatEnd = floatStart + 128;

            if (tInLine < floatStart || tInLine >= floatEnd) {
                return 0xff;  // Not during active fetch
            }

            // Position within the fetch window
            const tInFetch = tInLine - floatStart;

            // Each 8 T-states: bitmap1, attr1, bitmap2, attr2, idle, idle, idle, idle
            const cyclePos = tInFetch % 8;
            if (cyclePos >= 4) {
                return 0xff;  // Idle cycles 4-7
            }

            // Calculate which character cell (0-31)
            // Each 8 T-states fetches 2 characters, so:
            // tInFetch 0-7 → columns 0,1; tInFetch 8-15 → columns 2,3; etc.
            const charColumn = Math.floor(tInFetch / 8) * 2 + Math.floor(cyclePos / 2);
            // Bitmap or attribute? 0,2 = bitmap; 1,3 = attribute
            const isBitmap = (cyclePos % 2) === 0;

            // Calculate screen address
            const y = screenLine;
            const x = charColumn;  // Column (0-31)

            if (isBitmap) {
                // Bitmap address: 010Y7Y6Y2Y1Y0Y5Y4Y3X4X3X2X1X0
                const addr = SCREEN_BITMAP | ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | x;
                return this.memory.read(addr);
            } else {
                // Attribute address: 010110Y7Y6Y5Y4Y3X4X3X2X1X0
                const addr = SCREEN_ATTR | ((y >> 3) << 5) | x;
                return this.memory.read(addr);
            }
        }

        // Get interrupt timing offset (0 for early, 1 for late timing on 48K only)
        getIntOffset() {
            return (this.lateTimings && this.profile.earlyIntTiming) ? this.INT_LATE_OFFSET : 0;
        }

        // Handle frame boundary crossing and interrupt firing with late timing support
        // Returns true if interrupt was fired
        handleFrameBoundary() {
            const tstatesPerFrame = this.getTstatesPerFrame();
            const intPulseDuration = this.profile.intPulseDuration;
            const intOffset = this.getIntOffset();

            // Set INT pending when we reach frame end
            if (!this.pendingInt && this.cpu.tStates >= tstatesPerFrame) {
                this.pendingInt = true;
                this.pendingIntAt = tstatesPerFrame + intOffset;
                this.pendingIntEnd = this.pendingIntAt + intPulseDuration;
            }

            // Check for pending INT
            if (this.pendingInt) {
                if (this.cpu.tStates >= this.pendingIntAt && this.cpu.iff1 && !this.cpu.eiPending) {
                    if (this.debugIntTiming) {
                        console.log(`[INT-step] FIRED at T=${this.cpu.tStates}, pendingIntAt=${this.pendingIntAt}, halted=${this.cpu.halted}`);
                    }
                    this.pendingInt = false;
                    const _fbOldPC = this.cpu.pc, _fbOldSP = this.cpu.sp;
                    this._suppressWatchpoints = true;
                    this.cpu.interrupt();
                    this._suppressWatchpoints = false;
                    this._trackInterruptCall(_fbOldPC, _fbOldSP);
                    // Adjust T-states for next frame
                    if (this.cpu.tStates >= tstatesPerFrame) {
                        this.cpu.tStates -= tstatesPerFrame;
                        this._diskClockBase += tstatesPerFrame;
                        this.frameStartOffset = this.cpu.tStates;
                        this.accumulatedContention = 0;  // Reset for new frame
                        this.ula.startFrame();
                    }
                    return true;
                } else if (this.cpu.tStates >= this.pendingIntEnd) {
                    if (this.debugIntTiming) {
                        console.log(`[INT-step] PULSE ENDED at T=${this.cpu.tStates}, IFF1=${this.cpu.iff1}, eiPending=${this.cpu.eiPending}`);
                    }
                    // INT pulse ended without firing
                    this.pendingInt = false;
                    // Adjust T-states for next frame
                    if (this.cpu.tStates >= tstatesPerFrame) {
                        this.cpu.tStates -= tstatesPerFrame;
                        this._diskClockBase += tstatesPerFrame;
                        this.frameStartOffset = this.cpu.tStates;
                        this.accumulatedContention = 0;  // Reset for new frame
                        this.ula.startFrame();
                    }
                }
            }

            return false;
        }

        // Set late timing mode
        // Late timing shifts ALL screen-related timings by 1T (ULA thermal drift)
        // Which Z80 a machine was fitted with. Not a machine property -- any
        // Spectrum could have either -- so it is a setting, not a profile field.
        //
        // Only two behaviours differ in a way software can see, and they are
        // independent of each other, so a single enum would be a lie. The named
        // variants below are the documented COMBINATIONS, nothing invented:
        //
        //   zilog-nmos  SCF/CCF Zilog    OUT (C),0 -> 0     the usual Spectrum
        //   zilog-cmos  SCF/CCF Zilog    OUT (C),0 -> 255
        //   nec-nmos    SCF/CCF NEC      OUT (C),0 -> 0     NEC D780C second source
        //   st-cmos     SCF/CCF ST CMOS  OUT (C),0 -> 0
        //
        // st-cmos keeps OUT (C),0 -> 0 deliberately: the 255 behaviour is reported
        // for the ZILOG CMOS part, and no source here extends it to ST, so claiming
        // it would be a guess dressed as a fact.
        setCpuVariant(variant) {
            const v = CPU_VARIANTS[variant] ? variant : CPU_VARIANT_DEFAULT;
            this.cpuVariant = v;
            this.cpu.xcfMask = CPU_VARIANTS[v].xcfMask;
            this.cpu.outVc255 = CPU_VARIANTS[v].outVc255;
            return v;
        }

        getCpuVariant() { return this.cpuVariant || CPU_VARIANT_DEFAULT; }

        setLateTimings(late) {
            this.lateTimings = !!late;
            this._intDebugCount = 0;
            this._floatBusLogCount = 0;
            if (this.ula) {
                this.ula.setLateTimings(late);
            }
        }

        // Set early timing mode (convenience method for tests)
        setEarlyTimings(early) {
            this.setLateTimings(!early);
        }

        // Set Pentagon attribute read offset in T-states
        // Negative = ULA reads earlier (prefetch). 0 = default (matches Unreal/FUSE)
        setPentagonAttrOffset(offset) {
            this.pentagonAttrOffset = offset | 0;
            if (this.ula) {
                this.ula.setPentagonAttrOffset(offset);
            }
        }

        // Run until next interrupt
        runToInterrupt(maxCycles = 10000000) {
            if (this.running || !this.romLoaded) return false;
            if (this._bpTStatesResetPending) {
                this.breakpointTStates = 0;
                this._bpTStatesResetPending = false;
            }
            this.autoMap.inExecution = true;
            const tracing = this.traceEnabled && this.onBeforeStep;
            let cycles = 0;
            const startPC = this.cpu.pc;  // Skip breakpoint check at starting PC (for HALT)

            while (cycles < maxCycles) {
                // Beta Disk automatic ROM paging
                this.updateBetaDiskPaging();

                // Check for frame boundary and interrupt (with late timing support)
                if (this.handleFrameBoundary()) {
                    // Interrupt was fired
                    this.autoMap.inExecution = false;
                    this.breakpointTStates += cycles;
                    this.renderToScreen();
                    return true;
                }

                // Check breakpoint (skip if still at start PC - allows leaving current breakpoint/HALT)
                if (this.cpu.pc !== startPC && this.hasBreakpointAt(this.cpu.pc)) {
                    this.breakpointHit = true;
                    this.autoMap.inExecution = false;
                    this.breakpointTStates += cycles;
                    this.renderToScreen();
                    if (this.onBreakpoint) this.onBreakpoint(this.cpu.pc);
                    this._bpTStatesResetPending = true;
                    return false;
                }

                // Clear trace ops and capture PC/bytes before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                let instrBytes = null;
                if (tracing) {
                    this._suppressWatchpoints = true;
                    instrBytes = [
                        this.memory.read(instrPC),
                        this.memory.read((instrPC + 1) & 0xffff),
                        this.memory.read((instrPC + 2) & 0xffff),
                        this.memory.read((instrPC + 3) & 0xffff)
                    ];
                    this._suppressWatchpoints = false;
                }
                const _rtiOldPC = this.cpu.pc, _rtiOldSP = this.cpu.sp;
                this._currentInstrPC = _rtiOldPC;
                this._inCpuExecution = true;
                cycles += this.cpu.step();
                this._inCpuExecution = false;
                this._trackCallStack(_rtiOldPC, _rtiOldSP);
                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                }
            }

            this.autoMap.inExecution = false;
            this.breakpointTStates += cycles;
            this.renderToScreen();
            return false;
        }
        
        // Run until RET instruction is executed
        runToRet(maxCycles = 10000000) {
            if (this.running || !this.romLoaded) return false;
            if (this._bpTStatesResetPending) {
                this.breakpointTStates = 0;
                this._bpTStatesResetPending = false;
            }
            this.autoMap.inExecution = true;
            const tracing = this.traceEnabled && this.onBeforeStep;
            const tstatesPerFrame = this.getTstatesPerFrame();
            let cycles = 0;

            while (cycles < maxCycles) {
                // Beta Disk automatic ROM paging
                this.updateBetaDiskPaging();

                const pc = this.cpu.pc;
                const opcode = this.memory.read(pc);

                // Check for RET instructions:
                // C9 = RET
                // C0/C8/D0/D8/E0/E8/F0/F8 = RET cc (conditional)
                // ED 45 = RETN, ED 4D = RETI
                const isRet = (opcode === 0xC9) ||
                              ((opcode & 0xC7) === 0xC0) ||
                              (opcode === 0xED && (this.memory.read((pc + 1) & 0xffff) === 0x45 ||
                                                   this.memory.read((pc + 1) & 0xffff) === 0x4D));

                if (isRet && cycles > 0) {
                    // Clear trace ops and capture PC/bytes before RET
                    if (tracing) {
                        this.tracePortOps = [];
                        this.traceMemOps = [];
                    }
                    const instrPC = tracing ? this.cpu.pc : 0;
                    let instrBytes = null;
                    if (tracing) {
                        this._suppressWatchpoints = true;
                        instrBytes = [
                            this.memory.read(instrPC),
                            this.memory.read((instrPC + 1) & 0xffff),
                            this.memory.read((instrPC + 2) & 0xffff),
                            this.memory.read((instrPC + 3) & 0xffff)
                        ];
                        this._suppressWatchpoints = false;
                    }
                    // Execute the RET and stop after
                    const _rtrOldPC = this.cpu.pc, _rtrOldSP = this.cpu.sp;
                    this._currentInstrPC = _rtrOldPC;
                    this._inCpuExecution = true;
                    cycles += this.cpu.step();
                    this._inCpuExecution = false;
                    this._trackCallStack(_rtrOldPC, _rtrOldSP);
                    // Record trace after execution
                    if (tracing) {
                        this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                    }
                    this.autoMap.inExecution = false;
                    this.breakpointTStates += cycles;
                    this.renderToScreen();
                    return true;
                }

                // Check breakpoint
                if (this.hasBreakpointAt(this.cpu.pc)) {
                    this.breakpointHit = true;
                    this.autoMap.inExecution = false;
                    this.breakpointTStates += cycles;
                    this.renderToScreen();
                    if (this.onBreakpoint) this.onBreakpoint(this.cpu.pc);
                    this._bpTStatesResetPending = true;
                    return false;
                }

                // Clear trace ops and capture PC/bytes before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                let instrBytes = null;
                if (tracing) {
                    this._suppressWatchpoints = true;
                    instrBytes = [
                        this.memory.read(instrPC),
                        this.memory.read((instrPC + 1) & 0xffff),
                        this.memory.read((instrPC + 2) & 0xffff),
                        this.memory.read((instrPC + 3) & 0xffff)
                    ];
                    this._suppressWatchpoints = false;
                }
                const _rtrlOldPC = this.cpu.pc, _rtrlOldSP = this.cpu.sp;
                this._currentInstrPC = _rtrlOldPC;
                this._inCpuExecution = true;
                cycles += this.cpu.step();
                this._inCpuExecution = false;
                this._trackCallStack(_rtrlOldPC, _rtrlOldSP);

                // Handle frame boundary crossing (with late timing support)
                this.handleFrameBoundary();

                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                }
            }

            this.autoMap.inExecution = false;
            this.renderToScreen();
            return false;
        }

        // Run for specified number of T-states (ignores breakpoints for precise timing)
        runTstates(tstates) {
            if (this.running || !this.romLoaded) return 0;
            if (this._bpTStatesResetPending) {
                this.breakpointTStates = 0;
                this._bpTStatesResetPending = false;
            }
            this.autoMap.inExecution = true;
            const tracing = this.traceEnabled && this.onBeforeStep;
            let executed = 0;
            const target = this.cpu.tStates + tstates;

            while (this.cpu.tStates < target) {
                // Beta Disk automatic ROM paging
                this.updateBetaDiskPaging();

                // Clear trace ops and capture PC/bytes before execution
                if (tracing) {
                    this.tracePortOps = [];
                    this.traceMemOps = [];
                }
                const instrPC = tracing ? this.cpu.pc : 0;
                let instrBytes = null;
                if (tracing) {
                    this._suppressWatchpoints = true;
                    instrBytes = [
                        this.memory.read(instrPC),
                        this.memory.read((instrPC + 1) & 0xffff),
                        this.memory.read((instrPC + 2) & 0xffff),
                        this.memory.read((instrPC + 3) & 0xffff)
                    ];
                    this._suppressWatchpoints = false;
                }
                const before = this.cpu.tStates;
                const _rtsOldPC = this.cpu.pc, _rtsOldSP = this.cpu.sp;
                this._currentInstrPC = _rtsOldPC;
                this._inCpuExecution = true;
                this.cpu.step();
                this._inCpuExecution = false;
                this._trackCallStack(_rtsOldPC, _rtsOldSP);
                executed += this.cpu.tStates - before;
                // Record trace after execution
                if (tracing) {
                    this.onBeforeStep(this.cpu, this.memory, instrPC, this.tracePortOps, this.traceMemOps, instrBytes);
                }
            }

            this.autoMap.inExecution = false;
            this.breakpointTStates += executed;
            this.renderToScreen();
            return executed;
        }

        // ========== Debugging - Breakpoints ==========

        parseAddressSpec(spec) {
            spec = spec.trim().toUpperCase();
            let page = null;
            
            // Check for page prefix (e.g., "5:" or "R0:")
            const colonIdx = spec.indexOf(':');
            if (colonIdx !== -1) {
                const pageSpec = spec.substring(0, colonIdx);
                spec = spec.substring(colonIdx + 1);
                if (pageSpec.startsWith('R')) {
                    page = pageSpec; // ROM page like 'R0' or 'R1'
                } else {
                    page = parseInt(pageSpec, 10);
                    if (isNaN(page) || page < 0 || page > 7) return null;
                }
            }
            
            // Check for range (e.g., "1234-5678")
            const dashIdx = spec.indexOf('-');
            if (dashIdx !== -1) {
                const startStr = spec.substring(0, dashIdx);
                const endStr = spec.substring(dashIdx + 1);
                const start = parseInt(startStr, 16);
                const end = parseInt(endStr, 16);
                if (isNaN(start) || isNaN(end)) return null;
                return { start: start & 0xffff, end: end & 0xffff, page };
            }
            
            // Single address
            const addr = parseInt(spec, 16);
            if (isNaN(addr)) return null;
            return { start: addr & 0xffff, end: addr & 0xffff, page };
        }
        
        // Get current page for an address based on memory mapping
        getCurrentPageForAddr(addr) {
            if (this.profile.pagingModel === 'none') {
                return null; // No paging in 48K
            }
            
            addr = addr & 0xFFFF;
            if (addr < SLOT1_START) {
                // ROM area - return current ROM page
                return this.memory.currentRomPage === 0 ? 'R0' : 'R1';
            } else if (addr < SLOT2_START) {
                return 5; // Always page 5
            } else if (addr < SLOT3_START) {
                return 2; // Always page 2
            } else {
                return this.memory.currentRamPage; // Switchable page
            }
        }
        
        // Check if breakpoint matches current state
        checkBreakpointMatch(bp, addr) {
            addr = addr & 0xffff;
            if (addr < bp.start || addr > bp.end) return false;
            if (bp.page !== null && bp.page !== this.getCurrentPageForAddr(addr)) return false;
            // Check condition if present
            if (bp.condition) {
                return this.evaluateCondition(bp.condition);
            }
            return true;
        }

        // Evaluate a breakpoint condition
        // Supports: A, B, C, D, E, H, L, F, AF, BC, DE, HL, IX, IY, SP, PC, I, R
        // Operators: ==, !=, <, >, <=, >=, &, |
        // Memory: (HL), (DE), (BC), (1234)
        // Flags: Z, NZ, C, NC, P, M, PE, PO
        // Context: val (for watchpoints), port (for port breakpoints)
        evaluateCondition(condition, context = {}) {
            if (!this.cpu) return false;
            try {
                const cpu = this.cpu;
                const mem = this.memory;
                const ctxVal = context.val;
                const ctxPort = context.port;

                // Get register value by name
                const getReg = (name) => {
                    name = name.toUpperCase();
                    switch (name) {
                        case 'A': return cpu.a;
                        case 'B': return cpu.b;
                        case 'C': return cpu.c;
                        case 'D': return cpu.d;
                        case 'E': return cpu.e;
                        case 'H': return cpu.h;
                        case 'L': return cpu.l;
                        case 'F': return cpu.f;
                        case 'I': return cpu.i;
                        case 'R': return cpu.r;
                        case 'AF': return (cpu.a << 8) | cpu.f;
                        case 'BC': return (cpu.b << 8) | cpu.c;
                        case 'DE': return (cpu.d << 8) | cpu.e;
                        case 'HL': return (cpu.h << 8) | cpu.l;
                        case 'IX': return cpu.ix;
                        case 'IY': return cpu.iy;
                        case 'SP': return cpu.sp;
                        case 'PC': return cpu.pc;
                        case "A'": return cpu.a_;
                        case "B'": return cpu.b_;
                        case "C'": return cpu.c_;
                        case "D'": return cpu.d_;
                        case "E'": return cpu.e_;
                        case "H'": return cpu.h_;
                        case "L'": return cpu.l_;
                        case "F'": return cpu.f_;
                        case "AF'": return (cpu.a_ << 8) | cpu.f_;
                        case "BC'": return (cpu.b_ << 8) | cpu.c_;
                        case "DE'": return (cpu.d_ << 8) | cpu.e_;
                        case "HL'": return (cpu.h_ << 8) | cpu.l_;
                        default: return null;
                    }
                };

                // Get flag value
                const getFlag = (name) => {
                    name = name.toUpperCase();
                    const f = cpu.f;
                    switch (name) {
                        case 'Z': return (f & 0x40) !== 0;
                        case 'NZ': return (f & 0x40) === 0;
                        case 'C': return (f & 0x01) !== 0;
                        case 'NC': return (f & 0x01) === 0;
                        case 'P': case 'PE': return (f & 0x04) !== 0;
                        case 'M': case 'PO': return (f & 0x04) === 0;
                        case 'N': return (f & 0x02) !== 0;
                        case 'H': return (f & 0x10) !== 0;
                        case 'S': return (f & 0x80) !== 0;
                        default: return null;
                    }
                };

                // Parse a value (register, memory, literal, or context)
                const parseValue = (s) => {
                    s = s.trim();
                    const upper = s.toUpperCase();

                    // Context variables for watchpoints/port breakpoints
                    if (upper === 'VAL' && ctxVal !== undefined) return ctxVal;
                    if (upper === 'PORT' && ctxPort !== undefined) return ctxPort;

                    // T-states counter
                    if (upper === 'T' || upper === 'TSTATES') return cpu.tStates;

                    // Memory access: (HL), (DE), (BC), (1234), (IX+n), (IY+n)
                    const memMatch = s.match(/^\(([^)]+)\)$/);
                    if (memMatch) {
                        const inner = memMatch[1].trim().toUpperCase();
                        let addr;
                        if (inner === 'HL') addr = getReg('HL');
                        else if (inner === 'DE') addr = getReg('DE');
                        else if (inner === 'BC') addr = getReg('BC');
                        else if (inner === 'SP') addr = getReg('SP');
                        else if (inner === 'IX') addr = cpu.ix;
                        else if (inner === 'IY') addr = cpu.iy;
                        else if (inner.match(/^IX[+-]\d+$/i)) {
                            const offset = parseInt(inner.slice(2));
                            addr = (cpu.ix + offset) & 0xffff;
                        } else if (inner.match(/^IY[+-]\d+$/i)) {
                            const offset = parseInt(inner.slice(2));
                            addr = (cpu.iy + offset) & 0xffff;
                        } else {
                            // Numeric address
                            addr = parseInt(inner, 16);
                        }
                        return mem.read(addr & 0xffff);
                    }
                    // Register
                    const regVal = getReg(s);
                    if (regVal !== null) return regVal;
                    // Decimal literal (pure digits, no letters)
                    if (s.match(/^\d+$/)) {
                        return parseInt(s, 10);
                    }
                    // Hex literal (with 'h' suffix or contains A-F)
                    if (s.match(/^[0-9A-Fa-f]+h$/i) || s.match(/^[0-9]*[A-Fa-f][0-9A-Fa-f]*$/)) {
                        return parseInt(s.replace(/h$/i, ''), 16);
                    }
                    return null;
                };

                // Check for simple flag test
                const cond = condition.trim();
                const flagVal = getFlag(cond);
                if (flagVal !== null) return flagVal;

                // Parse comparison: value op value
                const opMatch = cond.match(/^(.+?)\s*(==|!=|<>|<=|>=|<|>|&|\|)\s*(.+)$/);
                if (opMatch) {
                    const left = parseValue(opMatch[1]);
                    const op = opMatch[2];
                    const right = parseValue(opMatch[3]);
                    if (left === null || right === null) return false;
                    switch (op) {
                        case '==': return left === right;
                        case '!=': case '<>': return left !== right;
                        case '<': return left < right;
                        case '>': return left > right;
                        case '<=': return left <= right;
                        case '>=': return left >= right;
                        case '&': return (left & right) !== 0;
                        case '|': return (left | right) !== 0;
                    }
                }

                return false;
            } catch (e) {
                return false;
            }
        }
        
        // Check if any breakpoint matches
        hasBreakpointAt(addr) {
            // Use unified trigger system
            return this.checkExecTriggers(addr) !== null;
        }
        
        addBreakpoint(spec) {
            if (typeof spec === 'number') {
                spec = { start: spec & 0xffff, end: spec & 0xffff, page: null };
            } else if (typeof spec === 'string') {
                spec = this.parseAddressSpec(spec);
                if (!spec) return false;
            }
            // Use unified trigger system
            return this.addTrigger({
                type: 'exec',
                start: spec.start,
                end: spec.end,
                page: spec.page
            }) >= 0;
        }
        
        removeBreakpoint(index) {
            // Find the corresponding trigger in the unified array
            const execTriggers = this.triggers
                .map((t, i) => ({ ...t, triggerIndex: i }))
                .filter(t => t.type === 'exec');
            if (index >= 0 && index < execTriggers.length) {
                return this.removeTrigger(execTriggers[index].triggerIndex);
            }
            return false;
        }

        removeBreakpointByAddr(addr) {
            addr = addr & 0xffff;
            const idx = this.triggers.findIndex(t =>
                t.type === 'exec' && t.start === addr && t.end === addr && t.page === null);
            if (idx !== -1) {
                return this.removeTrigger(idx);
            }
            return false;
        }

        toggleBreakpoint(addr) {
            addr = addr & 0xffff;
            const idx = this.triggers.findIndex(t =>
                t.type === 'exec' && t.start === addr && t.end === addr && t.page === null);
            if (idx !== -1) {
                this.removeTrigger(idx);
                return false;
            } else {
                this.addTrigger({ type: 'exec', start: addr, end: addr, page: null });
                return true;
            }
        }

        hasBreakpoint(addr) {
            // For disassembly display - check if exact single-address breakpoint exists (enabled only)
            addr = addr & 0xffff;
            return this.triggers.some(t =>
                t.type === 'exec' && t.enabled && t.start === addr && t.end === addr);
        }

        hasDisabledBreakpoint(addr) {
            // For disassembly display - check if a disabled breakpoint exists at this address
            addr = addr & 0xffff;
            return this.triggers.some(t =>
                t.type === 'exec' && !t.enabled && t.start === addr && t.end === addr);
        }

        getBreakpoints() {
            // Return from legacy array (synced from triggers)
            return this.breakpoints.map((bp, idx) => ({ ...bp, index: idx }));
        }

        clearBreakpoints() {
            this.clearTriggers('exec');
        }
        
        // Format breakpoint for display
        formatBreakpoint(bp) {
            let str = '';
            if (bp.page !== null) {
                str += (typeof bp.page === 'string' ? bp.page : bp.page.toString()) + ':';
            }
            str += hex16(bp.start);
            if (bp.end !== bp.start) {
                str += '-' + hex16(bp.end);
            }
            if (bp.condition) {
                str += ' if ' + bp.condition;
            }
            return str;
        }

        // Add breakpoint with optional condition
        addBreakpointWithCondition(addrSpec, condition) {
            let spec;
            if (typeof addrSpec === 'number') {
                spec = { start: addrSpec & 0xffff, end: addrSpec & 0xffff, page: null };
            } else if (typeof addrSpec === 'string') {
                spec = this.parseAddressSpec(addrSpec);
                if (!spec) return false;
            } else {
                spec = addrSpec;
            }
            // Use unified trigger system
            return this.addTrigger({
                type: 'exec',
                start: spec.start,
                end: spec.end,
                page: spec.page,
                condition: condition ? condition.trim() : ''
            }) >= 0;
        }

        // ========== Debugging - Port Breakpoints ==========

        parsePortSpec(spec) {
            spec = spec.trim().toUpperCase();
            // Format: "FE", "7FFD", "FE&FF", "7FFD&FFFF" (port & mask)
            const ampIdx = spec.indexOf('&');
            let port, mask;
            if (ampIdx !== -1) {
                port = parseInt(spec.substring(0, ampIdx), 16);
                mask = parseInt(spec.substring(ampIdx + 1), 16);
            } else {
                port = parseInt(spec, 16);
                // Default mask: 0xFF for 8-bit, 0xFFFF for 16-bit
                mask = port > 0xFF ? 0xFFFF : 0xFF;
            }
            if (isNaN(port) || isNaN(mask)) return null;
            // Determine if it's 16-bit based on port value or mask
            const is16bit = port > 0xFF || mask > 0xFF;
            return { 
                port: port & (is16bit ? 0xFFFF : 0xFF), 
                mask: mask & (is16bit ? 0xFFFF : 0xFF),
                is16bit 
            };
        }
        
        addPortBreakpoint(spec, direction = 'both') {
            if (typeof spec === 'string') {
                const parsed = this.parsePortSpec(spec);
                if (!parsed) return false;
                spec = parsed;
            }
            // Map direction to trigger type
            const typeMap = { 'in': 'port_in', 'out': 'port_out', 'both': 'port_io' };
            const type = typeMap[direction] || 'port_io';

            return this.addTrigger({
                type,
                start: spec.port,
                end: spec.port,
                mask: spec.mask
            }) >= 0;
        }

        removePortBreakpoint(index) {
            // Find the corresponding trigger in the unified array
            const portTriggers = this.triggers
                .map((t, i) => ({ ...t, triggerIndex: i }))
                .filter(t => t.type.startsWith('port'));
            if (index >= 0 && index < portTriggers.length) {
                return this.removeTrigger(portTriggers[index].triggerIndex);
            }
            return false;
        }

        getPortBreakpoints() {
            // Return from legacy array (synced from triggers)
            return this.portBreakpoints.map((pb, idx) => ({ ...pb, index: idx }));
        }

        clearPortBreakpoints() {
            this.clearTriggers(['port_in', 'port_out', 'port_io']);
        }
        
        formatPortBreakpoint(pb) {
            const hexFn = (v) => fmtPort(v, pb.is16bit);
            const defaultMask = pb.is16bit ? 0xFFFF : 0xFF;
            let str = hexFn(pb.port);
            if (pb.mask !== defaultMask) {
                str += '&' + hexFn(pb.mask);
            }
            str += ' (' + pb.direction.toUpperCase() + ')';
            return str;
        }
        
        checkPortBreakpoint(port, direction) {
            // Use unified trigger system
            const isOut = direction === 'out';
            const trigger = this.checkPortTriggers(port, 0, isOut);
            if (trigger) {
                // Return in legacy format for compatibility
                return {
                    port: trigger.start,
                    mask: trigger.mask,
                    is16bit: trigger.start > 0xff || trigger.mask > 0xff,
                    direction: trigger.type === 'port_in' ? 'in' : trigger.type === 'port_out' ? 'out' : 'both'
                };
            }
            return null;
        }

        // ========== Debugging - Watchpoints ==========

        addWatchpoint(spec, type = 'both') {
            if (typeof spec === 'number') {
                spec = { start: spec & 0xffff, end: spec & 0xffff, page: null };
            } else if (typeof spec === 'string') {
                spec = this.parseAddressSpec(spec);
                if (!spec) return false;
            }
            // Map type to trigger type
            const typeMap = { 'read': 'read', 'write': 'write', 'both': 'rw' };
            const triggerType = typeMap[type] || 'rw';

            return this.addTrigger({
                type: triggerType,
                start: spec.start,
                end: spec.end,
                page: spec.page
            }) >= 0;
        }

        removeWatchpoint(index) {
            // Find the corresponding trigger in the unified array
            const memTriggers = this.triggers
                .map((t, i) => ({ ...t, triggerIndex: i }))
                .filter(t => ['read', 'write', 'rw'].includes(t.type));
            if (index >= 0 && index < memTriggers.length) {
                return this.removeTrigger(memTriggers[index].triggerIndex);
            }
            return false;
        }

        hasWatchpoint(addr) {
            addr = addr & 0xffff;
            return this.triggers.some(t =>
                ['read', 'write', 'rw'].includes(t.type) && t.enabled &&
                addr >= t.start && addr <= t.end);
        }

        getWatchpoint(addr) {
            addr = addr & 0xffff;
            for (const t of this.triggers) {
                if (!['read', 'write', 'rw'].includes(t.type) || !t.enabled) continue;
                if (addr >= t.start && addr <= t.end) {
                    if (t.page === null || t.page === this.getCurrentPageForAddr(addr)) {
                        // Return in legacy format
                        return {
                            start: t.start,
                            end: t.end,
                            page: t.page,
                            read: t.type === 'read' || t.type === 'rw',
                            write: t.type === 'write' || t.type === 'rw'
                        };
                    }
                }
            }
            return null;
        }

        getWatchpoints() {
            // Return from legacy array (synced from triggers)
            return this.watchpoints.map((wp, idx) => ({ ...wp, index: idx }));
        }

        clearWatchpoints() {
            this.clearTriggers(['read', 'write', 'rw']);
        }
        
        formatWatchpoint(wp) {
            let str = '';
            if (wp.page !== null) {
                str += (typeof wp.page === 'string' ? wp.page : wp.page.toString()) + ':';
            }
            str += hex16(wp.start);
            if (wp.end !== wp.start) {
                str += '-' + hex16(wp.end);
            }
            str += ' (';
            if (wp.read && wp.write) str += 'R/W';
            else if (wp.read) str += 'R';
            else if (wp.write) str += 'W';
            str += ')';
            return str;
        }
        
        checkReadWatchpoint(addr, val) {
            if (!this.running || this.triggers.length === 0) return;
            // Use unified trigger system
            const trigger = this.checkMemTriggers(addr, val, false);
            if (trigger) {
                this.watchpointHit = true;
                this.triggerHit = true;
                this.lastWatchpoint = { addr, type: 'read', val, instrPC: this._currentInstrPC };
                this.lastTrigger = { trigger, addr, val, type: 'read', instrPC: this._currentInstrPC };
            }
        }

        checkWriteWatchpoint(addr, val) {
            if (!this.running || this.triggers.length === 0) return;
            // Use unified trigger system
            const trigger = this.checkMemTriggers(addr, val, true);
            if (trigger) {
                this.watchpointHit = true;
                this.triggerHit = true;
                this.lastWatchpoint = { addr, type: 'write', val, instrPC: this._currentInstrPC };
                this.lastTrigger = { trigger, addr, val, type: 'write', instrPC: this._currentInstrPC };
            }
        }

        // ========== Memory Callback Optimization ==========

        /**
         * Update memory/CPU callbacks based on current feature state
         * Sets callbacks to null when not needed (zero overhead)
         * Call this when triggers, autoMap, or runtimeTraceEnabled changes
         */
        updateMemoryCallbacksFlag() {
            const needsRead =
                this.triggers.length > 0 ||
                this.autoMap.enabled ||
                this.runtimeTraceEnabled ||
                this.traceEnabled ||
                this.profiler.enabled ||
                this.pokeWriteTraceEnabled ||
                this.writeMonitor.enabled ||
                this.readMonitor.enabled ||
                this.comparisonBreakpoint.enabled ||
                this.structMapper.enabled ||
                this.writeProvenance.enabled ||
                this.readProvenance.enabled;

            // Set callbacks to null when not needed (eliminates function call overhead).
            // External access hooks keep the relevant callback live on their own.
            this.memory.onRead = (needsRead || this._accessHooks.read) ? this._memoryReadCallback : null;
            this.memory.onWrite = (needsRead || this._accessHooks.write) ? this._memoryWriteCallback : null;

            // CPU fetch callback needed for autoMap, codePath recording/tracing, register tracker, or a fetch hook
            this.cpu.onFetch = (this.autoMap.enabled || this.codePath.enabled || this.codePath.tracing || this.execTrace.enabled || this.registerTracker.enabled || this.execProvenance.enabled || this._accessHooks.fetch) ? this._cpuFetchCallback : null;
        }

        // ========== External access hooks (headless automation) ==========

        /**
         * Register hooks fired on every CPU opcode fetch / memory read / memory write,
         * independent of any monitor or the auto-map. A documented, stable registration
         * point so external drivers don't wrap the managed cpu.onFetch / memory.onRead
         * (which are null unless a feature needs them). Any subset may be supplied;
         * omitted keys are cleared. Each hook receives (addr) for fetch and (addr, val)
         * for read/write, and may read spectrum state (cpu.pc, memory.currentRamBank, …)
         * synchronously. Fetch fires for opcode M1 fetches; read/write fire for ALL
         * reads/writes (gate on cpu.isFetching / _inCpuExecution if you need CPU-only).
         * @param {{onFetch?:Function, onRead?:Function, onWrite?:Function}} hooks
         */
        setAccessHooks(hooks = {}) {
            this._accessHooks.fetch = hooks.onFetch || null;
            this._accessHooks.read = hooks.onRead || null;
            this._accessHooks.write = hooks.onWrite || null;
            this.updateMemoryCallbacksFlag();
        }

        // Remove all external access hooks.
        clearAccessHooks() {
            this._accessHooks.fetch = this._accessHooks.read = this._accessHooks.write = null;
            this.updateMemoryCallbacksFlag();
        }

        // ========== Unified Trigger System ==========

        /**
         * Add a trigger (unified breakpoint/watchpoint/port breakpoint)
         * @param {Object} trigger - Trigger object with properties:
         *   type: 'exec'|'read'|'write'|'rw'|'port_in'|'port_out'|'port_io'
         *   start: number - Address or port number
         *   end: number - End of range (= start for single)
         *   page: number|string|null - Memory page (null = any)
         *   mask: number - Port mask (for port types)
         *   condition: string - Condition expression
         *   enabled: boolean - Whether trigger is active
         *   hitCount: number - Times triggered
         *   log: boolean - Log without breaking
         *   name: string - Optional description
         * @returns {number} Index of added trigger, or -1 if duplicate
         */
        addTrigger(trigger) {
            const isMedia = trigger.type === 'tape_block' || trigger.type === 'disk_read' || trigger.type === 'disk_sector';
            const isScreen = trigger.type === 'screen_bitmap' || trigger.type === 'screen_attr';

            // Normalize trigger
            const t = {
                type: trigger.type || 'exec',
                start: isMedia || isScreen ? (trigger.start || 0) : trigger.start & 0xffff,
                end: isMedia || isScreen ? (trigger.end !== undefined ? trigger.end : 0) : (trigger.end !== undefined ? trigger.end : trigger.start) & 0xffff,
                page: trigger.page !== undefined ? trigger.page : null,
                mask: trigger.mask !== undefined ? trigger.mask : 0xffff,
                condition: trigger.condition || '',
                enabled: trigger.enabled !== false,
                hitCount: trigger.hitCount || 0,
                skipCount: trigger.skipCount || 0,
                log: trigger.log || false,
                name: trigger.name || ''
            };

            // Screen trigger properties
            if (isScreen) {
                t.col = trigger.col || 0;
                t.row = trigger.row || 0;
                t.w = trigger.w || 1;
                t.h = trigger.h || 1;
                t.pixelMode = trigger.pixelMode || false;
                t.screen = trigger.screen || 'normal';
                t.start = 0;
                t.end = 0;
            }

            // For port types, default mask based on port value
            if (t.type.startsWith('port') && trigger.mask === undefined) {
                t.mask = t.start > 0xff ? 0xffff : 0xff;
            }

            // Check for duplicate
            for (const existing of this.triggers) {
                if (existing.type !== t.type) continue;
                // tape_block and disk_read: only one of each type
                if (t.type === 'tape_block' || t.type === 'disk_read') {
                    if (t.skipCount !== existing.skipCount) {
                        existing.skipCount = t.skipCount;
                        existing.hitCount = 0;
                    }
                    return this.triggers.indexOf(existing);
                }
                // disk_sector: same track + sector = duplicate
                if (t.type === 'disk_sector') {
                    if (existing.start === t.start && existing.end === t.end) {
                        if (t.skipCount !== existing.skipCount) {
                            existing.skipCount = t.skipCount;
                            existing.hitCount = 0;
                        }
                        return this.triggers.indexOf(existing);
                    }
                    continue;
                }
                // Screen triggers: same col/row/w/h/screen = duplicate
                if (isScreen) {
                    if (existing.col === t.col && existing.row === t.row &&
                        existing.w === t.w && existing.h === t.h &&
                        existing.screen === t.screen && existing.pixelMode === t.pixelMode) {
                        if (t.condition && t.condition !== existing.condition) {
                            existing.condition = t.condition;
                        }
                        return this.triggers.indexOf(existing);
                    }
                    continue;
                }
                // Original duplicate check for other types
                if (existing.start === t.start &&
                    existing.end === t.end &&
                    existing.page === t.page &&
                    existing.mask === t.mask) {
                    // Update existing trigger's condition if different
                    if (t.condition && t.condition !== existing.condition) {
                        existing.condition = t.condition;
                    }
                    return this.triggers.indexOf(existing);
                }
            }

            this.triggers.push(t);
            this._syncLegacyArrays();
            this.updateMemoryCallbacksFlag();
            return this.triggers.length - 1;
        }

        /**
         * Remove a trigger by index
         */
        removeTrigger(index) {
            if (index >= 0 && index < this.triggers.length) {
                this.triggers.splice(index, 1);
                this._syncLegacyArrays();
                this.updateMemoryCallbacksFlag();
                return true;
            }
            return false;
        }

        /**
         * Toggle a trigger's enabled state
         */
        toggleTrigger(index) {
            if (index >= 0 && index < this.triggers.length) {
                this.triggers[index].enabled = !this.triggers[index].enabled;
                // Rebuild exec breakpoint Set if this is an exec trigger
                if (this.triggers[index].type === 'exec') {
                    this._rebuildExecBreakpointSet();
                }
                // Rebuild screen breakpoint Sets if this is a screen trigger
                if (this.triggers[index].type === 'screen_bitmap' || this.triggers[index].type === 'screen_attr') {
                    this._rebuildScreenBreakpointSets();
                }
                return this.triggers[index].enabled;
            }
            return null;
        }

        /**
         * Get all triggers, optionally filtered by type
         * @param {string|string[]} type - Optional type or array of types to filter
         */
        getTriggers(type = null) {
            if (!type) return this.triggers.map((t, i) => ({ ...t, index: i }));
            const types = Array.isArray(type) ? type : [type];
            return this.triggers
                .map((t, i) => ({ ...t, index: i }))
                .filter(t => types.includes(t.type));
        }

        /**
         * Clear all triggers, optionally filtered by type
         */
        clearTriggers(type = null) {
            if (!type) {
                this.triggers = [];
            } else {
                const types = Array.isArray(type) ? type : [type];
                this.triggers = this.triggers.filter(t => !types.includes(t.type));
            }
            this._syncLegacyArrays();
            this.updateMemoryCallbacksFlag();
        }

        /**
         * Format a trigger for display
         */
        formatTrigger(t) {
            let str = '';

            if (t.type === 'tape_block') {
                str = 'TAPE';
                if (t.condition) str += ' if ' + t.condition;
                return str;
            }
            if (t.type === 'disk_read') {
                str = 'DISK';
                if (t.condition) str += ' if ' + t.condition;
                return str;
            }
            if (t.type === 'disk_sector') {
                str = 'T' + String(t.start).padStart(2, '0') + ':S' + String(t.end).padStart(2, '0');
                if (t.condition) str += ' if ' + t.condition;
                return str;
            }
            if (t.type === 'screen_bitmap') {
                str = t.pixelMode
                    ? `SCR px:${t.col},${t.row} ${t.w}\u00D7${t.h}`
                    : `SCR ${t.col},${t.row} ${t.w}\u00D7${t.h}`;
                if (t.screen === 'shadow') str += ' (shadow)';
                else if (t.screen === 'both') str += ' (both)';
                if (t.condition) str += ' if ' + t.condition;
                return str;
            }
            if (t.type === 'screen_attr') {
                str = `ATTR ${t.col},${t.row} ${t.w}\u00D7${t.h}`;
                if (t.screen === 'shadow') str += ' (shadow)';
                else if (t.screen === 'both') str += ' (both)';
                if (t.condition) str += ' if ' + t.condition;
                return str;
            }

            const isPort = t.type.startsWith('port');

            if (isPort) {
                // Port trigger
                const hexFn = (v) => fmtPort(v, t.start > 0xff);
                const defaultMask = t.start > 0xff ? 0xffff : 0xff;
                str = hexFn(t.start);
                if (t.mask !== defaultMask) {
                    str += '&' + hexFn(t.mask);
                }
            } else {
                // Memory trigger
                if (t.page !== null) {
                    str += (typeof t.page === 'string' ? t.page : t.page.toString()) + ':';
                }
                // Display only -- parseAddressSpec still reads and the API still
                // takes hex, so a script's addBreakpoint('8000') never changes meaning.
                str += fmtAddr(t.start);
                if (t.end !== t.start) {
                    str += '-' + fmtAddr(t.end);
                }
            }

            if (t.condition) {
                str += ' if ' + t.condition;
            }

            return str;
        }

        /**
         * Get trigger type display icon
         */
        getTriggerIcon(type) {
            const icons = {
                exec: '●',
                read: 'R',
                write: 'W',
                rw: 'RW',
                port_in: '⇐',
                port_out: '⇒',
                port_io: '⇔',
                tape_block: 'T',
                disk_read: 'D',
                disk_sector: 'S',
                screen_bitmap: '\u25A6',
                screen_attr: '\u25A4'
            };
            return icons[type] || '?';
        }

        /**
         * Get trigger type display label
         */
        getTriggerLabel(type) {
            const labels = {
                exec: 'Exec',
                read: 'Read',
                write: 'Write',
                rw: 'R/W',
                port_in: 'Port IN',
                port_out: 'Port OUT',
                port_io: 'Port I/O',
                tape_block: 'Tape Block',
                disk_read: 'Disk Read',
                disk_sector: 'Disk Sector',
                screen_bitmap: 'Write Bitmap',
                screen_attr: 'Write Attr'
            };
            return labels[type] || type;
        }

        /**
         * Check if an execution trigger matches at the given PC
         */
        checkExecTriggers(pc) {
            // Fast O(1) check using Set - skip iteration if PC not in any breakpoint range
            if (!this.execBreakpointSet.has(pc)) return null;
            // PC is in a breakpoint range - do full check for conditions, page, etc.
            for (const t of this.triggers) {
                if (t.type !== 'exec' || !t.enabled) continue;
                if (this._matchesTrigger(t, pc)) {
                    t.hitCount++;
                    if (t.hitCount > t.skipCount) {
                        return t;
                    }
                }
            }
            return null;
        }

        /**
         * Check if a memory access trigger matches
         */
        checkMemTriggers(addr, val, isWrite) {
            const types = isWrite ? ['write', 'rw'] : ['read', 'rw'];
            for (const t of this.triggers) {
                if (!types.includes(t.type) || !t.enabled) continue;
                if (this._matchesTrigger(t, addr, val)) {
                    t.hitCount++;
                    if (t.hitCount > t.skipCount) {
                        return t;
                    }
                }
            }
            return null;
        }

        /**
         * Check if a port access trigger matches
         */
        checkPortTriggers(port, val, isOut) {
            if (this.triggers.length === 0) return null;
            const types = isOut ? ['port_out', 'port_io'] : ['port_in', 'port_io'];
            for (const t of this.triggers) {
                if (!types.includes(t.type) || !t.enabled) continue;
                if (this._matchesPortTrigger(t, port, val)) {
                    t.hitCount++;
                    if (t.hitCount > t.skipCount) {
                        return t;
                    }
                }
            }
            return null;
        }

        /**
         * Check if a tape block trigger should fire
         */
        checkTapeBlockTrigger(blockIndex) {
            for (const t of this.triggers) {
                if (t.type !== 'tape_block' || !t.enabled) continue;
                t.hitCount++;
                if (t.hitCount > t.skipCount) {
                    return t;
                }
            }
            return null;
        }

        /**
         * Check if a disk read trigger should fire
         */
        checkDiskReadTrigger() {
            for (const t of this.triggers) {
                if (t.type !== 'disk_read' || !t.enabled) continue;
                t.hitCount++;
                if (t.hitCount > t.skipCount) {
                    return t;
                }
            }
            return null;
        }

        /**
         * Check if a disk sector trigger should fire for specific track/sector
         */
        checkDiskSectorTrigger(track, sector) {
            for (const t of this.triggers) {
                if (t.type !== 'disk_sector' || !t.enabled) continue;
                if (t.start === track && t.end === sector) {
                    t.hitCount++;
                    if (t.hitCount > t.skipCount) {
                        return t;
                    }
                }
            }
            return null;
        }

        /**
         * Check if a trigger matches an address
         */
        _matchesTrigger(t, addr, val = undefined) {
            addr = addr & 0xffff;
            if (addr < t.start || addr > t.end) return false;
            if (t.page !== null && t.page !== this.getCurrentPageForAddr(addr)) return false;
            if (t.condition) {
                return this.evaluateCondition(t.condition, { val });
            }
            return true;
        }

        /**
         * Check if a port trigger matches
         */
        _matchesPortTrigger(t, port, val) {
            if ((port & t.mask) !== (t.start & t.mask)) return false;
            if (t.condition) {
                return this.evaluateCondition(t.condition, { port, val });
            }
            return true;
        }

        /**
         * Sync legacy arrays from unified triggers for backward compatibility
         */
        _syncLegacyArrays() {
            // Rebuild breakpoints array from exec triggers
            this.breakpoints = this.triggers
                .filter(t => t.type === 'exec')
                .map(t => ({
                    start: t.start,
                    end: t.end,
                    page: t.page,
                    condition: t.condition
                }));

            // Rebuild watchpoints array from read/write/rw triggers
            this.watchpoints = this.triggers
                .filter(t => ['read', 'write', 'rw'].includes(t.type))
                .map(t => ({
                    start: t.start,
                    end: t.end,
                    page: t.page,
                    read: t.type === 'read' || t.type === 'rw',
                    write: t.type === 'write' || t.type === 'rw'
                }));

            // Rebuild portBreakpoints array from port triggers
            this.portBreakpoints = this.triggers
                .filter(t => t.type.startsWith('port'))
                .map(t => ({
                    port: t.start,
                    mask: t.mask,
                    is16bit: t.start > 0xff || t.mask > 0xff,
                    direction: t.type === 'port_in' ? 'in' : t.type === 'port_out' ? 'out' : 'both'
                }));

            // Rebuild fast exec breakpoint Set
            this._rebuildExecBreakpointSet();

            // Rebuild screen breakpoint Sets
            this._rebuildScreenBreakpointSets();
        }

        /**
         * Rebuild the exec breakpoint Set for O(1) lookup
         */
        _rebuildExecBreakpointSet() {
            this.execBreakpointSet.clear();
            for (const t of this.triggers) {
                if (t.type === 'exec' && t.enabled) {
                    // Add all addresses in range to the Set
                    const end = t.end !== undefined ? t.end : t.start;
                    for (let addr = t.start; addr <= end; addr++) {
                        this.execBreakpointSet.add(addr);
                    }
                }
            }
        }

        /**
         * Rebuild the screen breakpoint address Sets from screen triggers
         */
        _rebuildScreenBreakpointSets() {
            this.screenNormalBitmapSet.clear();
            this.screenNormalAttrSet.clear();
            this.screenShadowBitmapSet.clear();
            this.screenShadowAttrSet.clear();
            this._hasScreenTriggers = false;

            for (const t of this.triggers) {
                if (!t.enabled) continue;
                if (t.type === 'screen_bitmap') {
                    this._addBitmapAddresses(t);
                    this._hasScreenTriggers = true;
                } else if (t.type === 'screen_attr') {
                    this._addAttrAddresses(t);
                    this._hasScreenTriggers = true;
                }
            }

            // Enable memory write callback if screen triggers exist
            if (this._hasScreenTriggers) {
                this.updateMemoryCallbacksFlag();
            }
        }

        /**
         * Compute and add bitmap addresses for a screen_bitmap trigger
         */
        _addBitmapAddresses(t) {
            const addNormal = t.screen === 'normal' || t.screen === 'both';
            const addShadow = t.screen === 'shadow' || t.screen === 'both';

            if (t.pixelMode) {
                // Pixel mode: col=x, row=y, w=pixel width, h=pixel height
                const startCol = t.col >> 3;
                const endCol = (t.col + t.w - 1) >> 3;
                for (let y = t.row; y < t.row + t.h; y++) {
                    for (let col = startCol; col <= endCol; col++) {
                        const offset = ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | col;
                        if (addNormal) this.screenNormalBitmapSet.add(0x4000 + offset);
                        if (addShadow) this.screenShadowBitmapSet.add(0xC000 + offset);
                    }
                }
            } else {
                // Cell mode: col/row are character cells, iterate all 8 pixel rows per cell row
                for (let cellRow = t.row; cellRow < t.row + t.h; cellRow++) {
                    for (let pixRow = 0; pixRow < 8; pixRow++) {
                        const y = cellRow * 8 + pixRow;
                        for (let col = t.col; col < t.col + t.w; col++) {
                            const offset = ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | col;
                            if (addNormal) this.screenNormalBitmapSet.add(0x4000 + offset);
                            if (addShadow) this.screenShadowBitmapSet.add(0xC000 + offset);
                        }
                    }
                }
            }
        }

        /**
         * Compute and add attribute addresses for a screen_attr trigger
         */
        _addAttrAddresses(t) {
            const addNormal = t.screen === 'normal' || t.screen === 'both';
            const addShadow = t.screen === 'shadow' || t.screen === 'both';

            for (let row = t.row; row < t.row + t.h; row++) {
                for (let col = t.col; col < t.col + t.w; col++) {
                    const offset = row * 32 + col;
                    if (addNormal) this.screenNormalAttrSet.add(0x5800 + offset);
                    if (addShadow) this.screenShadowAttrSet.add(0xD800 + offset);
                }
            }
        }

        /**
         * Check if a logical address write is going to physical RAM page 7
         */
        _isWritingToPage7(addr) {
            const mem = this.memory;
            if (mem.specialPagingMode) {
                const slot = addr >> 14;
                return mem.specialBanks[slot] === 7;
            }
            // Shadow screen at $C000 only when page 7 is banked in at slot 3
            return addr >= SLOT3_START && mem.currentRamBank === 7;
        }

        /**
         * Check screen trigger match and fire watchpoint hit
         */
        _checkScreenTrigger(addr, val, isShadow) {
            if (!this.running) return;
            const isBitmap = isShadow
                ? this.screenShadowBitmapSet.has(addr)
                : this.screenNormalBitmapSet.has(addr);

            // Decode address back to coordinates for per-trigger region check
            const base = isShadow ? (isBitmap ? 0xC000 : 0xD800) : (isBitmap ? 0x4000 : 0x5800);
            const offset = addr - base;
            let addrCol, addrRow;
            if (isBitmap) {
                // Reverse bitmap address: offset = ((y&0xC0)<<5)|((y&0x07)<<8)|((y&0x38)<<2)|col
                addrCol = offset & 0x1F;
                addrRow = ((offset >> 5) & 0xC0) | ((offset >> 8) & 0x07) | ((offset >> 2) & 0x38);
            } else {
                // Reverse attr address: offset = row*32 + col
                addrCol = offset & 0x1F;
                addrRow = offset >> 5;
            }

            for (const t of this.triggers) {
                if (!t.enabled) continue;
                if (isBitmap && t.type !== 'screen_bitmap') continue;
                if (!isBitmap && t.type !== 'screen_attr') continue;
                // Check screen match
                if (isShadow && t.screen === 'normal') continue;
                if (!isShadow && t.screen === 'shadow') continue;
                // Check if address falls within this trigger's region
                if (isBitmap && t.type === 'screen_bitmap') {
                    if (t.pixelMode) {
                        // Pixel mode: addrCol is byte column (0-31), addrRow is pixel row (0-191)
                        const startCol = t.col >> 3;
                        const endCol = (t.col + t.w - 1) >> 3;
                        if (addrCol < startCol || addrCol > endCol) continue;
                        if (addrRow < t.row || addrRow >= t.row + t.h) continue;
                    } else {
                        // Cell mode: addrCol is column (0-31), addrRow is pixel row (0-191)
                        if (addrCol < t.col || addrCol >= t.col + t.w) continue;
                        const cellRow = addrRow >> 3;
                        if (cellRow < t.row || cellRow >= t.row + t.h) continue;
                    }
                } else {
                    // Attr: addrCol/addrRow are cell coordinates
                    if (addrCol < t.col || addrCol >= t.col + t.w) continue;
                    if (addrRow < t.row || addrRow >= t.row + t.h) continue;
                }
                // Evaluate condition
                if (t.condition && !this.evaluateCondition(t.condition, { val })) continue;
                t.hitCount++;
                if (t.hitCount > t.skipCount) {
                    this.watchpointHit = true;
                    this.triggerHit = true;
                    this.lastWatchpoint = { addr, type: 'write', val, instrPC: this._currentInstrPC };
                    this.lastTrigger = { trigger: t, addr, val, type: 'write', instrPC: this._currentInstrPC };
                    return;
                }
            }
        }

        /**
         * Parse trigger from address input string
         * Format: "[TYPE:]ADDR[-END]" where TYPE is optional
         */
        parseTriggerSpec(spec, defaultType = 'exec') {
            spec = spec.trim().toUpperCase();

            // Check for type prefix
            let type = defaultType;
            const colonIdx = spec.indexOf(':');
            if (colonIdx !== -1) {
                const prefix = spec.substring(0, colonIdx);
                // Check if it's a type prefix (not a page prefix like "5:" or "R0:")
                const typeMap = {
                    'E': 'exec', 'EXEC': 'exec',
                    'R': 'read', 'READ': 'read',
                    'W': 'write', 'WRITE': 'write',
                    'RW': 'rw',
                    'PI': 'port_in', 'IN': 'port_in',
                    'PO': 'port_out', 'OUT': 'port_out',
                    'PIO': 'port_io', 'IO': 'port_io'
                };
                if (typeMap[prefix]) {
                    type = typeMap[prefix];
                    spec = spec.substring(colonIdx + 1);
                }
            }

            // Handle port types
            if (type.startsWith('port')) {
                const parsed = this.parsePortSpec(spec);
                if (!parsed) return null;
                return {
                    type,
                    start: parsed.port,
                    end: parsed.port,
                    mask: parsed.mask
                };
            }

            // Handle address types
            const parsed = this.parseAddressSpec(spec);
            if (!parsed) return null;
            return {
                type,
                start: parsed.start,
                end: parsed.end,
                page: parsed.page
            };
        }

        // ========== End Unified Trigger System ==========

        // ========== Keyboard Handling ==========

        // Keyboard, joysticks, Kempston mouse and gamepad live in core/input.js
        // and are mixed into this prototype below.


        async loadFile(file, driveIndex = 0) {
            let data = await file.arrayBuffer();
            let fileName = file.name;

            // A headless driver that fetches a path that isn't there gets the
            // server's 404 page, and "Failed to parse TAP file" sends people
            // hunting for a format bug. Say what the bytes actually are.
            const htmlKind = looksLikeMarkup(data);
            if (htmlKind) {
                throw new Error(
                    `${fileName || 'File'} is ${htmlKind}, not a Spectrum file — ` +
                    `if it was fetched, the URL probably returned an error page (404)`);
            }

            // Timex DCK cartridge
            if (/\.dck$/i.test(fileName || '')) return this.loadDCK(data, fileName);

            // Check if it's a ZIP file
            if (ZipLoader.isZip(data)) {
                const spectrumFiles = await ZipLoader.findAllSpectrum(data);

                if (spectrumFiles.length === 0) {
                    // The old wording named seven formats and had gone stale twice over
                    // -- MGT, MDR, OPD, D40/D80, TZX, RZX and WAV all load and none were
                    // listed -- so it read as "this format is not supported" when the
                    // real answer was usually "that is not what is in the archive". Name
                    // the contents instead: that is the thing you cannot see from here.
                    const names = (await ZipLoader.extract(data)).map(f => f.name).join(', ');
                    throw new Error(`No Spectrum file found in ZIP. Contents: ${names || '(empty archive)'}`);
                }

                if (spectrumFiles.length > 1) {
                    // Return file list for UI to show selection
                    return {
                        needsSelection: true,
                        files: spectrumFiles.map(f => ({ name: f.name, type: f.type })),
                        _zipFiles: spectrumFiles,  // Internal: full data for loading
                        _driveIndex: driveIndex     // Pass through drive index
                    };
                }

                // Single file - load directly
                data = spectrumFiles[0].data;
                fileName = spectrumFiles[0].name;
            }

            // Check for RZX (needs async loading)
            const type = this.snapshotLoader.detectType(data, fileName);
            if (type === 'rzx') {
                return this.loadRZX(data);
            }

            // HC-2000: every disk goes to the HC IF1 (DSK, or a raw IMG/MGT)
            const hcDisk = this._hcDiskRoute(data, fileName, type, driveIndex);
            if (hcDisk) return hcDisk;

            // Check for DSK disk images (ZX Spectrum +3)
            if (type === 'dsk') {
                return this.loadDSKImage(data, fileName, driveIndex);
            }

            // Check for MGT disk images (+D interface)
            if (type === 'mgt') {
                return this.loadMGTImage(data, fileName, driveIndex);
            }

            // Check for MDR cartridge images (Interface 1 Microdrive)
            if (type === 'mdr') {
                return this.loadMDRImage(data, fileName, driveIndex);
            }

            // Check for OPD disk images (Opus Discovery)
            if (type === 'opd') {
                return this.loadOPDImage(data, fileName, driveIndex);
            }

            // Check for Didaktik D40/D80 MDOS images
            if (type === 'd80' || type === 'd40' || type === 'didaktik') {
                return this.loadD80Image(data, fileName, driveIndex);
            }

            // Check for TRD/SCL/UDI disk images (contain multiple files)
            if (type === 'trd' || type === 'scl' || type === 'udi') {
                return this.loadDiskImage(data, type, fileName, driveIndex);
            }

            return this.loadFileData(data, fileName);
        }

        // Load TRD/SCL disk image - inserts disk into Beta Disk interface
        loadDiskImage(data, type, fileName, driveIndex = 0) {
            const originalType = type;  // Preserve original format name for display
            let processedData = data;
            this.lastUdiInfo = null;    // never report the previous disk's losses
            this.udiTrackImage = null;  // nor hand its raw tracks to this one

            // For SCL files, convert to TRD first so boot injection can work
            if (type === 'scl') {
                processedData = this.betaDisk.sclToTrd(processedData);
                type = 'trd';
            }

            // UDI keeps raw track bytes -- gaps, address marks and sector CRCs
            // -- not sector payloads, so flatten it the same way: everything
            // downstream (boot injection, the catalogue, the TR-DOS trap, the
            // project save) speaks TRD.
            //
            // That flattening is lossy, and the loss is real rather than
            // theoretical: of five sample images one mixes 512-byte sectors
            // with 590 deleted-data marks, one carries a 17-sector track whose
            // data CRC is deliberately wrong, and two disagree with their own
            // stored checksum. So say what could not be carried instead of
            // dropping it quietly, and never refuse the disk over a checksum
            // that real files get wrong.
            if (type === 'udi') {
                const udi = UDILoader.load(processedData);
                processedData = udi.trd;
                type = 'trd';
                this.lastUdiInfo = udi;
                for (const w of udi.warnings) console.warn(`UDI ${fileName}: ${w}`);
                if (!udi.crcOk) {
                    console.warn(`UDI ${fileName}: stored checksum 0x`
                        + `${udi.parsed.crcStored.toString(16).toUpperCase()} is not the computed 0x`
                        + `${udi.parsed.crcComputed.toString(16).toUpperCase()}; loading anyway`);
                }
                const lost = udi.lost;
                if (lost.wrongSize || lost.outOfRange || lost.badCrc || lost.deleted || lost.weak) {
                    console.warn(`UDI ${fileName}: ${udi.sectorsPlaced} sectors placed; a TRD cannot hold `
                        + `${lost.wrongSize} non-256-byte, ${lost.outOfRange} out-of-range, `
                        + `${lost.badCrc} bad-CRC, ${lost.deleted} deleted-data, ${lost.weak} weak`);
                }
                if (udi.trailerText) console.info(`UDI ${fileName}: ${udi.trailerText}`);

                // What the flattening dropped is a fact about the CATALOGUE view
                // only. The controller is handed the raw tracks below, so a sector a
                // TRD cannot express is still there to be read.
                this.udiTrackImage = udi.trackImage;
            }

            // Apply boot injection callback if configured (drive 0 only)
            if (driveIndex === 0 && this.onBeforeTrdLoad) {
                processedData = this.onBeforeTrdLoad(processedData, fileName);
            }

            const files = TRDLoader.listFiles(processedData);

            if (files.length === 0 && !this.udiTrackImage) {
                // A UDI is exempt. The catalogue above is read from the FLATTENED
                // image, and a protected disk mangles that on purpose: POP.udi's
                // info sector is all zeroes and 231 of its sectors carry no data
                // field at all, so judging it by the flattened view refuses a disk
                // whose tracks the controller can read perfectly well.
                //
                // A catalogue can legitimately list no real files and still be a
                // valid TR-DOS disk — e.g. one holding only SPECSCII banner
                // entries (fake zero-length names of print control codes, like
                // Adventurer #13 disk 2). Accept it if the sysinfo sector
                // carries the TR-DOS id byte; reject anything else as garbage.
                const u8 = processedData instanceof Uint8Array ? processedData : new Uint8Array(processedData);
                if (u8.length <= 0x8E7 || u8[0x800 + 0xE7] !== 0x10) {
                    throw new Error('No files found in disk image');
                }
            }

            // Store disk image for project save (per-drive)
            const diskData = new Uint8Array(processedData);
            this.loadedBetaDisks[driveIndex & 0x03] = {
                data: diskData,
                name: fileName
            };
            this.loadedBetaDiskFiles[driveIndex & 0x03] = files;

            // Load disk into Beta Disk interface (already TRD format)
            this.betaDisk.loadDisk(processedData, 'trd', driveIndex);

            // ...and, for a UDI, the raw tracks the controller actually reads from.
            // Must follow loadDisk, which clears any track image the drive had.
            if (this.udiTrackImage) {
                this.betaDisk.attachTrackImage(this.udiTrackImage, driveIndex);
                this.udiTrackImage = null;
            }

            // Set up TR-DOS trap handler with disk data (drive 0 only — boot drive)
            if (driveIndex === 0) {
                this.trdosTrap.setDisk(diskData, files, type);
            }

            // Request switch to Pentagon if Beta Disk not available on current machine
            // No switch needed if: Pentagon mode OR (Beta Disk enabled AND TR-DOS ROM loaded)
            const betaDiskAvailable = this.profile.betaDiskDefault ||
                (this.betaDiskEnabled && this.memory.hasTrdosRom()) || this.memory.beta48On;
            const needsMachineSwitch = !betaDiskAvailable;

            // Return disk inserted result - no file selection needed
            // User can use TR-DOS commands (LIST, LOAD, RUN) to interact with disk
            return {
                diskInserted: true,
                diskType: originalType,  // Original format name for display (SCL or TRD)
                _diskType: 'trd',        // Internal: always TRD (SCL converted)
                diskName: fileName,
                fileCount: files.length,
                _diskData: processedData,
                _diskFiles: files,
                _driveIndex: driveIndex,
                needsMachineSwitch: needsMachineSwitch,
                targetMachine: 'pentagon'
            };
        }

        /**
         * Timex DCK cartridge into the DOCK (and EXROM, if the file has it) of a
         * TC2068; the machine restarts, so the ROM finds it. FUSE dck_reset.
         */
        loadDCK(data, fileName) {
            if (!this.profile.timexAy) {
                throw new Error('DCK cartridges need a Timex TC2068 (Machine)');
            }
            const blocks = parseDck(new Uint8Array(data));
            const dock = new Array(8).fill(null), exrom = new Array(8).fill(null);
            for (const blk of blocks) {
                const dest = blk.bank === DCK_BANK_DOCK ? dock : blk.bank === DCK_BANK_EXROM ? exrom : null;
                if (!dest) continue;            // HOME blocks: not supported here
                blk.chunks.forEach((c, i) => { if (c) dest[i] = c; });
            }
            this.timexCartridge = { dock, exrom, name: fileName };
            this._applyTimexCartridge();
            this.reset();
            if (!this.isRunning()) this.start();
            return { cartridgeInserted: true, cartridgeName: fileName,
                chunks: dock.filter(Boolean).length + exrom.filter(Boolean).length };
        }

        ejectDCK() {
            this.timexCartridge = null;
            this._applyTimexCartridge();
            this.reset();
        }

        _applyTimexCartridge() {
            const c = this.profile.timexAy ? this.timexCartridge : null;
            this.memory.timexDock = c ? c.dock : null;
            this.memory.timexExrom = c && c.exrom.some(Boolean) ? c.exrom : null;
        }

        /**
         * HC-2000 disk routing: a DSK, or a raw .img, or any other file whose
         * size is a raw HC geometry and which is not a tape or snapshot. (.mgt
         * is the +D/DISCiPLE format and is not offered on the HC; a TRD of the
         * same size is the user's call, as on the real machine.) Returns null
         * when the file is not for the HC IF1.
         */
        _hcDiskRoute(data, fileName, type, driveIndex) {
            if (!this.hcIf1) return null;
            if (type === 'dsk') return this.loadDSKImage(data, fileName, driveIndex);
            const ext = ((fileName || '').split('.').pop() || '').toLowerCase();
            const notMedia = !['sna', 'z80', 'szx', 'tap', 'tzx', 'wav', 'rzx', 'pok'].includes(type);
            if (HcDiskLoader.isRaw(data) && (ext === 'img' || notMedia)) {
                return this.loadHcRawImage(data, fileName, driveIndex);
            }
            return null;
        }

        /**
         * Raw HC image (.img): converted to a DSKImage with real geometry
         * (core/loaders/disk-hc.js), so it behaves exactly as the same disk in
         * DSK form. It is kept as EDSK from here on.
         */
        loadHcRawImage(data, fileName, driveIndex = 0) {
            const conv = HcDiskLoader.fromRaw(data, fileName);
            this.hcLastRawLayout = { layout: conv.layout, reason: conv.reason, fileName };
            const res = this.loadDSKImage(conv.image.toBuffer(), fileName, driveIndex);
            res.hcRawLayout = conv.layout;
            res.hcRawLayoutReason = conv.reason;
            return res;
        }

        // Load DSK disk image - inserts disk into µPD765 FDC (+3, or the HC IF1)
        loadDSKImage(data, fileName, driveIndex = 0) {
            // Kempston Disc: DSK / .kdi (EDSK) into its four drives
            if (!this.fdc && this._kempdiscEnabledFlag) {
                const bytes = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
                this.kempdisc.fdc.loadDisk(bytes, 'dsk', driveIndex & 3);
                this.kempdisc.fdc.drives[driveIndex & 3].name = fileName;
                const files = KdosLoader.listFiles(this.kempdisc.fdc.drives[driveIndex & 3].dsk);
                this.loadedKempdiscDisks[driveIndex & 3] = { name: fileName, data: bytes };
                this.loadedKempdiscDiskFiles[driveIndex & 3] = files;
                return {
                    diskInserted: true, diskType: 'kdi', diskName: fileName,
                    fileCount: files.length, _driveIndex: driveIndex & 3, needsMachineSwitch: false
                };
            }
            // Timex FDD 3000: DSK images go to the station's four drives
            if (!this.fdc && this._fdd3000PagingEnabled) {
                const bytes = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
                this.fdd3000.fdc.loadDisk(bytes, 'dsk', driveIndex & 3);
                this.fdd3000.fdc.drives[driveIndex & 3].name = fileName;
                return {
                    diskInserted: true, diskType: 'fdd3', diskName: fileName,
                    fileCount: 0, _driveIndex: driveIndex & 3, needsMachineSwitch: false
                };
            }
            if (!this.fdc && this.profile.pagingModel === 'hc2000') {
                throw new Error('HC-2000: the HC IF1 disk interface is switched off ' +
                    '(Settings → Disk interfaces → HC IF1)');
            }
            // A `.dsk` names a container, not a machine. The double-density
            // Opus format (80 x 2 x 10 x 512) is only ever circulated in one,
            // because 512-byte sectors are what a PC drive can image, so a
            // machine with no FDC still has somewhere to put this file -- and
            // refusing it as "+3 only" was wrong about the disk, not just
            // unhelpful. The disk itself decides: its anchor sector accounts
            // for the whole image only when it really is an Opus disk.
            if (!this.fdc) {
                const opd = OPDLoader.fromDSK(data);
                if (opd) return this.loadOPDImage(opd, fileName, driveIndex);
                throw new Error('DSK files require ZX Spectrum +3 (no FDC on this machine)');
            }

            const dskImage = DSKLoader.parse(data);
            // On the HC-2000 the disk is read with the HC file systems
            if (this.hcIf1) dskImage.hcFormat = true;
            let files = [];
            try { files = DSKLoader.listFiles(dskImage); } catch (e) { /* non-CP/M disk */ }

            // Insert disk into specified drive
            this.fdc.drives[driveIndex & 0x01].disk = dskImage;

            // Store for project save and catalog display (per-drive)
            const rawData = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
            this.loadedFDCDisks[driveIndex & 0x01] = {
                data: rawData,
                name: fileName
            };
            this.loadedFDCDiskFiles[driveIndex & 0x01] = files;

            return {
                isDSK: true,
                diskInserted: true,
                diskType: 'dsk',
                diskName: fileName,
                fileCount: files.length,
                _dskImage: dskImage,
                _diskFiles: files,
                _driveIndex: driveIndex,
                needsMachineSwitch: this.machineType !== '+3' && !this.hcIf1,
                targetMachine: this.hcIf1 ? 'hc2000' : '+3'
            };
        }

        // Load MGT disk image - inserts disk into +D interface
        loadMGTImage(data, fileName, driveIndex = 0) {
            const files = MGTLoader.listFiles(data);

            // Store disk image for project save (per-drive)
            const diskData = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
            this.loadedPlusDDisks[driveIndex & 0x01] = {
                data: diskData,
                name: fileName
            };
            this.loadedPlusDDiskFiles[driveIndex & 0x01] = files;

            // Load disk into +D interface (or the DISCiPLE when that is the one enabled)
            (this.discipleEnabled ? this.disciple : this.plusD).loadDisk(diskData, 'mgt', driveIndex);

            // Check if +D is available
            const plusDAvailable = (this.plusDEnabled && this.memory.hasPlusDRom()) ||
                (this.discipleEnabled && this.memory.hasDiscipleRom());

            return {
                diskInserted: true,
                diskType: 'mgt',
                diskName: fileName,
                fileCount: files.length,
                _diskData: diskData,
                _diskFiles: files,
                _driveIndex: driveIndex,
                needsMachineSwitch: false,  // +D works with any machine
                plusDRequired: !plusDAvailable
            };
        }

        // Load OPD image - inserts disk into the Opus Discovery
        loadOPDImage(data, fileName, driveIndex = 0) {
            const files = OPDLoader.listFiles(data);

            // Store disk image for project save (per-drive)
            const diskData = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
            this.loadedOpusDisks[driveIndex & 0x01] = {
                data: diskData,
                name: fileName
            };
            this.loadedOpusDiskFiles[driveIndex & 0x01] = files;

            this.opus.loadDisk(diskData, 'opd', driveIndex);

            const opusAvailable = this.opusEnabled && this.memory.hasOpusRom() &&
                this.profile.pagingModel !== '+2a' && !this.hcIf1;

            return {
                diskInserted: true,
                diskType: 'opd',
                diskName: fileName,
                fileCount: files.length,
                _diskData: diskData,
                _diskFiles: files,
                _driveIndex: driveIndex,
                needsMachineSwitch: false,
                opusRequired: !opusAvailable
            };
        }

        // Load a Didaktik D40/D80 MDOS image
        loadD80Image(data, fileName, driveIndex = 0) {
            const diskData = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
            let files = [];
            try { files = DidaktikLoader.listFiles(diskData); } catch (e) { /* unreadable catalogue */ }

            this.loadedDidaktikDisks[driveIndex & 0x01] = { data: diskData, name: fileName };
            this.loadedDidaktikDiskFiles[driveIndex & 0x01] = files;
            this.didaktik.loadDisk(diskData, 'd80', driveIndex);

            const available = this.didaktikEnabled && this.memory.hasDidaktikRom() &&
                this._didaktikMachineOk();

            return {
                diskInserted: true,
                diskType: 'd80',
                diskName: fileName,
                fileCount: files.length,
                _diskData: diskData,
                _diskFiles: files,
                _driveIndex: driveIndex,
                needsMachineSwitch: false,
                didaktikRequired: !available
            };
        }

        // Load MDR cartridge image - inserts cartridge into Interface 1 Microdrive
        loadMDRImage(data, fileName, driveIndex = 0) {
            const files = MDRLoader.listFiles(data);

            // Store cartridge for project save (per-drive)
            const cartData = new Uint8Array(data instanceof Uint8Array ? data : new Uint8Array(data));
            const idx = driveIndex & 0x07;
            this.loadedIF1Cartridges[idx] = {
                data: cartData,
                name: fileName
            };
            this.loadedIF1CartridgeFiles[idx] = files;

            // Load into Microdrive hardware
            this.microdrive.loadCartridge(cartData, driveIndex);

            // Update paging flag (IF1 may now be activatable)
            this.updateBetaDiskPagingFlag();

            // Check if IF1 is available
            const if1Available = this.if1Enabled && this.memory.hasIF1Rom();

            return {
                diskInserted: true,
                diskType: 'mdr',
                diskName: fileName,
                fileCount: files.length,
                _diskData: cartData,
                _diskFiles: files,
                _driveIndex: driveIndex,
                needsMachineSwitch: false,  // IF1 works with 48K/128K/+2/Pentagon
                if1Required: !if1Available
            };
        }

        // Boot +3 from disk
        // Reset machine, preserve disk in FDC, and let +3 ROM auto-detect disk
        bootPlus3Disk() {
            if (!this.fdc) {
                console.warn('[+3] Cannot boot disk: no FDC');
                return false;
            }

            // Save disk state before reset
            const disk = this.fdc.drives[0].disk;

            // Full machine reset
            this.stop();
            this.reset();

            // Restore disk after reset
            if (disk) {
                this.fdc.drives[0].disk = disk;
            }

            // Turn motor on (bit 3 of port 0x1FFD)
            this.fdc.setMotor(true);

            // +3 ROM at address 0 auto-detects and boots from disk
            this.cpu.pc = 0;

            return true;
        }

        // Boot into TR-DOS mode
        // Uses the FUSE-style approach: reset machine, select ROM bank 1,
        // page in TR-DOS ROM, and let it run from address 0.
        // The TR-DOS ROM has its own initialization at address 0 that properly
        // sets up system variables, channels, and workspace — much more reliable
        // than manually constructing system variables.
        bootTrdos() {
            // Beta 48: the DOS runs from reset (latch set), so a reset is the boot
            if (this.memory.beta48On) {
                const keep = this.betaDisk ? this.betaDisk.drives.map(d => ({
                    diskData: d.diskData, diskType: d.diskType })) : null;
                this.stop();
                this.reset();
                if (keep) keep.forEach((d, i) => {
                    if (d.diskData) {
                        this.betaDisk.drives[i].diskData = d.diskData;
                        this.betaDisk.drives[i].diskType = d.diskType;
                        this.betaDisk.drives[i].headTrack = 0;
                    }
                });
                return true;
            }
            // Check if TR-DOS ROM is loaded
            if (!this.memory.hasTrdosRom()) {
                console.warn('[TR-DOS] Cannot boot TR-DOS: TR-DOS ROM not loaded');
                return false;
            }

            // Check if Beta Disk is available (built-in on Pentagon/Scorpion, or enabled via setting)
            if (!this.profile.betaDiskDefault && !this.betaDiskEnabled) {
                console.warn('[TR-DOS] Cannot boot TR-DOS: Beta Disk not enabled');
                return false;
            }

            // Save per-drive disk state before reset (spectrum.reset() doesn't touch betaDisk,
            // but be safe in case that changes)
            const savedDrives = this.betaDisk ? this.betaDisk.drives.map(d => ({
                diskData: d.diskData,
                diskType: d.diskType,
                headTrack: d.headTrack,
                trackImage: d.trackImage
            })) : null;

            // Full machine reset — clears CPU, memory, ULA, tape state
            this.stop();
            this.reset();

            // Restore all drive disk data after reset
            if (savedDrives && this.betaDisk) {
                for (let i = 0; i < 4; i++) {
                    if (savedDrives[i].diskData) {
                        this.betaDisk.drives[i].diskData = savedDrives[i].diskData;
                        this.betaDisk.drives[i].diskType = savedDrives[i].diskType;
                        this.betaDisk.drives[i].trackImage = savedDrives[i].trackImage;
                        this.betaDisk.drives[i].headTrack = 0; // Reset head position
                        this.betaDisk.drives[i].addrIndex = 0;
                    }
                }
            }

            // Select BASIC ROM bank as background ROM.
            // TR-DOS auto-paging only re-activates when currentRomBank === basicRomBank.
            // On real Pentagon, the 128K menu switches to ROM bank 1 before entering TR-DOS.
            // On +2A, BASIC ROM is bank 3 (not bank 1).
            this.memory.currentRomBank = this.profile.basicRomBank;
            // Scorpion: the DOS shows TR-DOS over the 48K ROM only when 7FFD
            // bit 4 selects it (else the service ROM), as OUT (#7FFD),#10 does
            if (this.profile.pagingModel === 'scorpion') this.memory.scorpionPort7FFD = 0x10;

            // Page in TR-DOS ROM and start from address 0.
            // The TR-DOS ROM at address 0x0000 contains its own initialization code
            // (similar to the Spectrum ROM NEW routine) that properly sets up all
            // system variables, channels, streams, screen, and BASIC workspace.
            // This is the same approach FUSE uses (beta128_48boot mode).
            this.memory.trdosActive = true;
            this.cpu.pc = 0;

            return true;
        }

        // Load a specific file from disk image
        loadDiskFile(diskData, fileInfo, diskType) {
            const Loader = diskType === 'trd' ? TRDLoader : SCLLoader;
            const fileData = Loader.extractFile(diskData, fileInfo);

            // In Pentagon mode with TR-DOS ROM + disk, don't auto-boot
            // Just return info so user can select TR-DOS from menu manually
            // The disk is already loaded in betaDisk
            if (this.profile.betaDiskDefault && this.betaDisk.hasAnyDisk() && this.memory.hasTrdosRom()) {
                // Start emulator if not running
                if (!this.running) {
                    this.start();
                }

                return {
                    diskFile: true,
                    diskType: diskType,
                    fileName: fileInfo.fullName,
                    fileType: fileInfo.type,
                    start: fileInfo.start,
                    length: fileData.length,
                    useTrdos: true,
                    manualBoot: true,  // Indicates user needs to select TR-DOS from menu
                    trdosCommand: fileInfo.name.toLowerCase().startsWith('boot') ?
                        'RUN' : `RUN "${fileInfo.name}"`
                };
            }

            // Fallback for non-Pentagon mode: CODE files load directly
            if (fileInfo.type === 'code') {
                const wasRunning = this.running;
                if (wasRunning) this.stop();

                // Load code directly at specified address
                for (let i = 0; i < fileData.length; i++) {
                    this.memory.write(fileInfo.start + i, fileData[i]);
                }

                // Render current screen
                const frameBuffer = this.ula.renderFrame();
                this.blitFrame(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);

                if (wasRunning) this.start();

                return {
                    diskFile: true,
                    diskType: diskType,
                    fileName: fileInfo.fullName,
                    fileType: fileInfo.type,
                    start: fileInfo.start,
                    length: fileData.length
                };
            }

            // Fallback for BASIC files without Pentagon: use TAP mechanism
            if (fileInfo.type === 'basic') {
                const wasRunning = this.running;
                if (wasRunning) this.stop();

                // Convert to TAP format for reliable loading via ROM
                const tapData = Loader.fileToTAP(fileData, fileInfo);
                this.tapeLoader.load(tapData.buffer);
                this.tapeTrap.setTape(this.tapeLoader);

                // Inject LOAD "" command into the input buffer to auto-trigger loading
                // The Spectrum's edit line is at E_LINE, we'll put LOAD "" there
                const elineAddr = this.memory.read(0x5C59) | (this.memory.read(0x5C5A) << 8);

                // LOAD "" in tokenized form: 0xEF (LOAD) 0x22 (") 0x22 (") 0x0D (ENTER)
                this.memory.write(elineAddr, 0xEF);     // LOAD token
                this.memory.write(elineAddr + 1, 0x22); // "
                this.memory.write(elineAddr + 2, 0x22); // "
                this.memory.write(elineAddr + 3, 0x0D); // ENTER

                // Update K_CUR to end of command (cursor position)
                this.memory.write(0x5C5B, (elineAddr + 3) & 0xFF);
                this.memory.write(0x5C5C, ((elineAddr + 3) >> 8) & 0xFF);

                // Trigger the command by setting PC to the LINE-RUN routine
                // The ROM's main loop at 0x1B76 checks for ENTER key
                // We'll jump to 0x0F2C (MAIN-2) which processes the edit line
                // Or use 0x1B17 (LINE-NEW) to execute the current line
                this.cpu.pc = 0x1B17;  // LINE-NEW: execute current edit line

                // Render current screen
                const frameBuffer = this.ula.renderFrame();
                this.blitFrame(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);

                if (wasRunning) this.start();

                return {
                    diskFile: true,
                    diskType: diskType,
                    fileName: fileInfo.fullName,
                    fileType: fileInfo.type,
                    start: autostart,
                    length: fileData.length,
                    autoload: true  // Auto-loading via injected LOAD ""
                };
            }

            // For other file types, convert to TAP (limited compatibility)
            const tapData = Loader.fileToTAP(fileData, fileInfo);
            this.tapeLoader.load(tapData.buffer);
            this.tapeTrap.setTape(this.tapeLoader);

            return {
                diskFile: true,
                diskType: diskType,
                fileName: fileInfo.fullName,
                fileType: fileInfo.type,
                start: fileInfo.start,
                length: fileData.length,
                blocks: this.tapeLoader.getBlockCount()
            };
        }

        // Load from disk image selection result
        loadFromDiskSelection(diskResult, index) {
            const fileInfo = diskResult._diskFiles[index];
            return this.loadDiskFile(diskResult._diskData, fileInfo, diskResult._diskType || diskResult.diskType);
        }

        // Load from pre-extracted data (used after ZIP selection)
        loadFileData(data, fileName, driveIndex = 0) {
            const type = this.snapshotLoader.detectType(data, fileName);
            const hcDisk = this._hcDiskRoute(data, fileName, type, driveIndex);
            if (hcDisk) return hcDisk;
            switch (type) {
                case 'sna': return this.loadSnapshot(data);
                case 'z80': return this.loadZ80Snapshot(data);
                case 'szx': return this.loadSZXSnapshot(data);
                case 'tap': return this.loadTape(data, fileName);  // Store TAP with name
                case 'tzx': return this.loadTZX(data, fileName);  // Store TZX with name
                case 'wav': return this.loadWAV(data, fileName);  // Store WAV with name
                case 'dsk':
                    return this.loadDSKImage(data, fileName, driveIndex);
                case 'trd':
                case 'scl':
                case 'udi':
                    return this.loadDiskImage(data, type, fileName, driveIndex);
                case 'mgt':
                    return this.loadMGTImage(data, fileName, driveIndex);
                case 'mdr':
                    return this.loadMDRImage(data, fileName, driveIndex);
                case 'opd':
                    return this.loadOPDImage(data, fileName, driveIndex);
                case 'd80':
                case 'd40':
                case 'didaktik':
                    return this.loadD80Image(data, fileName, driveIndex);
                case 'rzx': throw new Error('Use loadRZX for RZX files');
                default: throw new Error('Unknown file format');
            }
        }

        // Load specific file from ZIP selection result
        loadFromZipSelection(zipResult, index) {
            const file = zipResult._zipFiles[index];
            return this.loadFileData(file.data, file.name, zipResult._driveIndex || 0);
        }
        
        loadZ80Snapshot(data) {
            const wasRunning = this.running;
            if (wasRunning) this.stop();
            
            try {
                // First pass to detect machine type
                const bytes = new Uint8Array(data);
                let targetType = '48k';

                // Check if v2/v3 by PC at offset 6
                const pc = bytes[6] | (bytes[7] << 8);
                if (pc === 0 && bytes.length > 34) {
                    const extHeaderLen = bytes[30] | (bytes[31] << 8);
                    const hwMode = bytes[34];
                    // Pentagon (hwMode 9) can appear in both V2 and V3
                    if (hwMode === 9) {
                        targetType = 'pentagon';
                    } else if (extHeaderLen === 23) {
                        // V2: hwMode 3=128K, 4=128K+IF1
                        if (hwMode === 3 || hwMode === 4) targetType = '128k';
                    } else {
                        // V3: 4=128K, 5=128K+IF1, 6=128K+MGT, 7=+3, 12=+2, 13=+2A
                        if (hwMode === 12) targetType = '+2';
                        else if (hwMode >= 4 && hwMode <= 7) targetType = '128k';
                        else if (hwMode === 13) targetType = '+2a';
                    }
                }

                // Switch machine type if needed
                if (targetType !== this.machineType) {
                    this.setMachineType(targetType, true);
                }

                const result = this.snapshotLoader.loadZ80(data, this.cpu, this.memory);
                result.machineType = targetType;  // Add machine type to result for ROM reload
                result.wasRunning = wasRunning;    // Preserve pre-load running state for caller

                // Reset frame timing state to avoid stale state from previous program
                this.frameStartOffset = 0;
                this.accumulatedContention = 0;
                this.pendingInt = false;
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;

                // Reset ULA screen bank switching state to avoid frozen display
                this.ula.hadScreenBankChanges = false;
                this.ula.deferPaperRendering = false;
                this.ula.screenBankChanges = [{tState: 0, bank: this.memory.screenBank || 5}];

                this.ula.setBorder(result.border);
                // Initialize frame state for beam mode, but clear attrInitial
                // since we don't know the true frame-start values after loading a snapshot
                this.ula.startFrame();
                this.ula.attrInitial = null;  // Force use of current memory values
                const frameBuffer = this.ula.renderFrame();
                this.blitFrame(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);
                if (wasRunning) this.start();
                return result;
            } catch (e) {
                if (wasRunning) this.start();
                throw e;
            }
        }

        loadSZXSnapshot(data) {
            const wasRunning = this.running;
            if (wasRunning) this.stop();

            try {
                // Parse SZX to get machine type
                const info = SZXLoader.parse(data);

                // Determine target machine type
                let targetType = info.machineType;
                if (targetType === '+2A') {
                    targetType = '+2a';  // Map SZX name to internal type
                } else if (targetType === '+3' || targetType === '+3e') {
                    // The +3 used to be mapped to +2A ("hardware-identical minus
                    // floppy") - but the floppy is the point for +3 software, and a
                    // +2A has no FDC, so loading a +3 state left the machine without
                    // a disk controller. There is a real +3 profile; use it.
                    targetType = '+3';
                } else if (targetType === 'scorpion') {
                    // Native Scorpion support
                } else if (targetType === 'didaktik') {
                    targetType = '128k';  // Treat other 128K clones as 128K
                } else if (targetType === '16k') {
                    targetType = '48k';
                }

                // Switch machine type if needed
                if (targetType !== this.machineType) {
                    this.setMachineType(targetType, true);
                }

                // Load SZX
                const result = SZXLoader.load(data, this.cpu, this.memory, this.ula,
                                              this._restorePeripherals());
                result.machineType = targetType;  // Add machine type to result for ROM reload
                result.wasRunning = wasRunning;    // Preserve pre-load running state for caller

                // Debug: verify ROM is correct (first byte at 0x38 should be F5 for 48K)
                const romCheck = this.memory.read(0x38);
                if (romCheck !== 0xF5) {
                    console.warn(`SZX: ROM may be wrong at 0x38: got ${romCheck.toString(16)}, expected f5`);
                }

                // Reset frame timing state to avoid stale state from previous program
                this.frameStartOffset = 0;
                this.accumulatedContention = 0;
                this.pendingInt = false;
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;

                // Reset ULA screen bank switching state to avoid frozen display
                // (previous program's deferred rendering state must not persist)
                this.ula.hadScreenBankChanges = false;
                this.ula.deferPaperRendering = false;
                this.ula.screenBankChanges = [{tState: 0, bank: this.memory.screenBank || 5}];

                // Initialize frame state for beam mode, but clear attrInitial
                // since we don't know the true frame-start values after loading a snapshot
                this.ula.startFrame();
                this.ula.attrInitial = null;  // Force use of current memory values
                // Update display
                const frameBuffer = this.ula.renderFrame();
                this.blitFrame(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);

                if (wasRunning) this.start();
                return result;
            } catch (e) {
                if (wasRunning) this.start();
                throw e;
            }
        }

        loadSnapshot(data) {
            const wasRunning = this.running;
            if (wasRunning) this.stop();

            // Detect snapshot type before loading
            const bytes = new Uint8Array(data);
            const is128k = bytes.length > 49179;

            // Determine target machine type
            // Pentagon uses same snapshot format as 128K, so preserve it
            let targetType;
            if (is128k) {
                // Keep Pentagon/+2 if already set, otherwise use 128K
                targetType = (this.machineType === 'pentagon' || this.machineType === 'pentagon1024' || this.machineType === 'scorpion') ? this.machineType : (is128kCompat(this.machineType) ? this.machineType : '128k');
            } else {
                targetType = '48k';
            }

            // Switch machine type if needed
            if (targetType !== this.machineType) {
                this.setMachineType(targetType, true);
            }

            try {
                const result = this.snapshotLoader.loadSNA(data, this.cpu, this.memory);
                result.machineType = targetType; // Ensure correct type is returned
                result.wasRunning = wasRunning;  // Preserve pre-load running state for caller

                // Reset frame timing state to avoid stale state from previous program
                this.frameStartOffset = 0;
                this.accumulatedContention = 0;
                this.pendingInt = false;
                this.cpu.tStates = 0;
                this._lastTapeUpdate = 0;

                this.ula.setBorder(result.border);
                // Initialize frame state for beam mode, but clear attrInitial
                // since we don't know the true frame-start values after loading a snapshot
                this.ula.startFrame();
                this.ula.attrInitial = null;  // Force use of current memory values
                const frameBuffer = this.ula.renderFrame();
                this.blitFrame(frameBuffer);
                this.ctx.putImageData(this.imageData, 0, 0);
                if (wasRunning) this.start();
                return result;
            } catch (e) {
                if (wasRunning) this.start();
                throw e;
            }
        }

        loadTape(data, storeName = null) {
            if (!this.tapeLoader.load(data)) throw new Error('Failed to parse TAP file');
            this.tapeTrap.setTape(this.tapeLoader);

            // Set up tape block trigger callback for flash loads
            this.tapeTrap.onBlockLoaded = (loadedBlockIndex) => {
                const tapeTrigger = this.checkTapeBlockTrigger(loadedBlockIndex);
                if (tapeTrigger) {
                    this.tapeBlockHit = true;
                    this.triggerHit = true;
                    this.lastTrigger = { trigger: tapeTrigger, blockIndex: loadedBlockIndex, type: 'tape_block' };
                }
            };

            // Initialize TapePlayer for real-time playback
            this.tapePlayer.loadFromTapeLoader(this.tapeLoader);

            // Reset debug counters for fresh logging after TAP load
            this._floatBusLogCount = 0;
            this._intDebugCount = 0;
            this._floatBusLogActive = false; // Wait for halted INT to activate

            // Store original TAP data for project save (if not from disk conversion)
            if (storeName) {
                this.loadedTapes[this.activeTapeSlot] = {
                    type: 'tap',
                    data: new Uint8Array(data),
                    name: storeName
                };
                this.tapeSlotStates[this.activeTapeSlot] = null;
                this.tapeRecordings[this.activeTapeSlot] = [];
            }

            return { blocks: this.tapeLoader.getBlockCount() };
        }

        loadTZX(data, storeName = null) {
            // Clear any pending turbo block state from previous load
            this._turboBlockPending = false;

            if (!this.tzxLoader) {
                this.tzxLoader = new TZXLoader();
            }

            if (!this.tzxLoader.load(data)) {
                throw new Error('Failed to parse TZX file');
            }

            // TZXLoader provides blocks in unified format
            // Load directly into TapePlayer for real-time playback
            this.tapePlayer.loadBlocks(this.tzxLoader.blocks);

            // For flash load mode, only standard-timed data blocks can use ROM trap
            // Turbo blocks have non-standard timing and must use real-time playback
            const isStandardTiming = (b) => {
                // Standard ROM loader timing (with small tolerance)
                const stdPilot = 2168, stdZero = 855, stdOne = 1710;
                const tolerance = 50;  // Allow small variations
                return (!b.pilotPulse || Math.abs(b.pilotPulse - stdPilot) < tolerance) &&
                       (!b.zeroPulse || Math.abs(b.zeroPulse - stdZero) < tolerance) &&
                       (!b.onePulse || Math.abs(b.onePulse - stdOne) < tolerance);
            };

            // Convert compatible blocks to TapeLoader format, tracking their
            // positions in the full block array for correct tapePlayer positioning
            const allBlocks = this.tzxLoader.blocks;
            const tapCompatibleBlocks = [];
            const standardBlockMap = [];  // standardBlockMap[tapeLoaderIdx] = full array idx
            const standardBlockSet = new Set();
            for (let i = 0; i < allBlocks.length; i++) {
                const b = allBlocks[i];
                if (b.type === 'data' && !b.noPilot && isStandardTiming(b)) {
                    standardBlockSet.add(i);
                    standardBlockMap.push(i);
                    tapCompatibleBlocks.push({ flag: b.flag, data: b.data, length: b.length });
                }
            }

            if (tapCompatibleBlocks.length > 0) {
                this.tapeLoader.blocks = tapCompatibleBlocks;
                this.tapeLoader.currentBlock = 0;
                this.tapeTrap.setTape(this.tapeLoader);

                const hasTurboBlocks = allBlocks.length > tapCompatibleBlocks.length;

                if (hasTurboBlocks) {
                    // Set up callback to switch to real-time when next tape block is non-standard.
                    // Standard blocks can be interleaved with turbo (e.g. std,std,std,turbo,turbo,std)
                    // so we trigger as soon as the next block in tape order isn't standard.
                    this.tapeTrap.onBlockLoaded = (loadedBlockIndex) => {
                        const fullIdx = standardBlockMap[loadedBlockIndex];
                        const nextFullIdx = fullIdx + 1;
                        console.log('[TZX] onBlockLoaded: tapeLoader index', loadedBlockIndex,
                            '→ fullIdx', fullIdx, ', nextFullIdx', nextFullIdx,
                            ', nextIsStandard', standardBlockSet.has(nextFullIdx));
                        // Trigger if next block in tape sequence is non-standard
                        if (nextFullIdx < allBlocks.length && !standardBlockSet.has(nextFullIdx)) {
                            this.tapePlayer.setBlock(nextFullIdx);
                            this._turboBlockPending = true;
                            console.log('[TZX] Turbo pending! tapePlayer positioned at block', nextFullIdx);
                        }
                        // Check tape block trigger
                        const tapeTrigger = this.checkTapeBlockTrigger(fullIdx);
                        if (tapeTrigger) {
                            this.tapeBlockHit = true;
                            this.triggerHit = true;
                            this.lastTrigger = { trigger: tapeTrigger, blockIndex: fullIdx, type: 'tape_block' };
                        }
                    };
                } else {
                    this.tapeTrap.onBlockLoaded = (loadedBlockIndex) => {
                        const tapeTrigger = this.checkTapeBlockTrigger(loadedBlockIndex);
                        if (tapeTrigger) {
                            this.tapeBlockHit = true;
                            this.triggerHit = true;
                            this.lastTrigger = { trigger: tapeTrigger, blockIndex: loadedBlockIndex, type: 'tape_block' };
                        }
                    };
                    this._turboBlockPending = false;
                }
            } else {
                this.tapeTrap.onBlockLoaded = (loadedBlockIndex) => {
                    const tapeTrigger = this.checkTapeBlockTrigger(loadedBlockIndex);
                    if (tapeTrigger) {
                        this.tapeBlockHit = true;
                        this.triggerHit = true;
                        this.lastTrigger = { trigger: tapeTrigger, blockIndex: loadedBlockIndex, type: 'tape_block' };
                    }
                };
                this._turboBlockPending = false;
            }

            // Reset debug counters
            this._floatBusLogCount = 0;
            this._intDebugCount = 0;
            this._floatBusLogActive = false;

            // Store original TZX data for project save
            if (storeName) {
                this.loadedTapes[this.activeTapeSlot] = {
                    type: 'tzx',
                    data: new Uint8Array(data),
                    name: storeName
                };
                this.tapeSlotStates[this.activeTapeSlot] = null;
                this.tapeRecordings[this.activeTapeSlot] = [];
            }

            return {
                blocks: this.tzxLoader.getBlockCount(),
                version: this.tzxLoader.version
            };
        }

        loadWAV(data, storeName = null) {
            this._turboBlockPending = false;

            const wavLoader = new WAVLoader();
            if (!wavLoader.load(data)) {
                throw new Error('Failed to parse WAV file');
            }

            // WAV provides directRecording blocks — load into TapePlayer
            this.tapePlayer.loadBlocks(wavLoader.blocks);

            // No ROM trap for WAV — direct recording only, must use real-time playback
            this.tapeLoader.blocks = [];
            this.tapeLoader.currentBlock = 0;
            this.tapeTrap.setTape(null);

            // Reset debug counters
            this._floatBusLogCount = 0;
            this._intDebugCount = 0;
            this._floatBusLogActive = false;

            // Store original WAV data for project save
            if (storeName) {
                this.loadedTapes[this.activeTapeSlot] = {
                    type: 'wav',
                    data: new Uint8Array(data),
                    name: storeName
                };
                this.tapeSlotStates[this.activeTapeSlot] = null;
                this.tapeRecordings[this.activeTapeSlot] = [];
            }

            return {
                blocks: wavLoader.getBlockCount(),
                metadata: wavLoader.metadata
            };
        }

        // ========== Media Management ==========

        /**
         * A drive's live image rather than the copy taken when the file was
         * loaded. The controller writes into its own buffer, so the `loaded*`
         * entry goes stale the moment a program saves anything -- which is
         * exactly when storing it matters. FDC disks and IF1 cartridges were
         * already refreshed; these four were not, so a project saved after a
         * game wrote to a disk restored it as it was BEFORE the write.
         */
        _liveDiskImages(entries, controller) {
            if (!controller || !controller.drives) return entries;
            return entries.map((entry, i) => {
                if (!entry) return null;
                const drv = controller.drives[i];
                return (drv && drv.diskData) ? { data: drv.diskData, name: entry.name } : entry;
            });
        }

        /**
         * Everything currently inserted, as something that offers to save it
         * needs to see it: where it is, what it would be written as, whether the
         * program has written to it since it was loaded, and how to get the
         * bytes.
         *
         * The bytes come from a function rather than up front because some of
         * these are megabytes and most will never be asked for.
         */
        getSaveableMedia() {
            const out = [];
            const base = (name, fallback) => (name || fallback || 'disk')
                .replace(/[\[\]]/g, '').replace(/\.[a-z0-9#$]+$/i, '');
            const extOf = (name, allowed, fallback) => {
                const m = /\.([a-z0-9#$]+)$/i.exec(name || '');
                const e = m ? m[1].toLowerCase() : '';
                return allowed.includes(e) ? e : fallback;
            };
            const add = (o) => out.push(o);

            // --- Beta Disk: four drives, A-D -----------------------------
            for (let i = 0; i < 4; i++) {
                const entry = this.loadedBetaDisks[i];
                const drv = this.betaDisk && this.betaDisk.drives[i];
                if (!entry || !drv || !drv.diskData) continue;
                // A UDI is served from its tracks and cannot be written back --
                // there is no UDI writer -- so what can be saved is the flattened
                // sector image, and it must not claim to be a .udi.
                const fromUdi = !!drv.trackImage;
                const scl = !fromUdi && extOf(entry.name, ['scl'], '') === 'scl';
                const ext = scl ? 'scl' : 'trd';
                add({
                    id: `beta${i}`, group: 'Beta Disk',
                    label: `Beta ${String.fromCharCode(65 + i)}`,
                    name: entry.name, filename: base(entry.name, 'disk') + '.' + ext, ext,
                    modified: !!drv.modified,
                    note: fromUdi ? 'UDI is read-only — saves as TRD' : '',
                    getData: () => scl ? this.betaDisk.trdToScl(drv.diskData) : drv.diskData,
                });
            }

            // --- +3 FDC: two drives --------------------------------------
            for (let i = 0; i < 2; i++) {
                const entry = this.loadedFDCDisks[i];
                const disk = this.fdc && this.fdc.drives[i] && this.fdc.drives[i].disk;
                if (!entry || !disk) continue;
                add({
                    id: `fdc${i}`, group: '+3',
                    label: `+3 ${String.fromCharCode(65 + i)}`,
                    name: entry.name, filename: base(entry.name, 'disk') + '.dsk', ext: 'dsk',
                    modified: !!disk.modified, note: '',
                    getData: () => disk.toBuffer(),
                });
            }

            // --- +D, Opus and Didaktik: two drives each -------------------
            for (const [ctl, entries, group, label, allowed, fallback] of [
                [this.plusD, this.loadedPlusDDisks, '+D', '+D', ['mgt', 'img'], 'mgt'],
                [this.opus, this.loadedOpusDisks, 'Opus', 'Opus', ['opd', 'opu'], 'opd'],
                [this.didaktik, this.loadedDidaktikDisks, 'Didaktik', 'Didaktik', ['d40', 'd80'], 'd80'],
            ]) {
                for (let i = 0; i < 2; i++) {
                    const entry = entries && entries[i];
                    const drv = ctl && ctl.drives && ctl.drives[i];
                    if (!entry || !drv || !drv.diskData) continue;
                    const ext = extOf(entry.name, allowed, fallback);
                    add({
                        id: `${group.toLowerCase()}${i}`, group,
                        label: `${label} ${i + 1}`,
                        name: entry.name, filename: base(entry.name, 'disk') + '.' + ext, ext,
                        modified: !!drv.modified, note: '',
                        getData: () => drv.diskData,
                    });
                }
            }

            // --- Microdrive: eight cartridges ----------------------------
            for (let i = 0; i < 8; i++) {
                const entry = this.loadedIF1Cartridges[i];
                const drv = this.microdrive && this.microdrive.drives && this.microdrive.drives[i];
                if (!entry || !drv || !drv.cartridge) continue;
                add({
                    id: `mdr${i}`, group: 'Microdrive',
                    label: `Microdrive ${i + 1}`,
                    name: entry.name, filename: base(entry.name, 'cart') + '.mdr', ext: 'mdr',
                    modified: !!drv.modified, note: '',
                    getData: () => this.microdrive.getCartridgeData(i),
                });
            }

            return out;
        }

        getLoadedMedia() {
            // Return structured state for project save
            // For FDC disks, serialize current in-memory state (may have been modified by game writes)
            let fdcDisks = this.loadedFDCDisks;
            if (this.fdc) {
                fdcDisks = this.loadedFDCDisks.map((entry, i) => {
                    if (!entry) return null;
                    const disk = this.fdc.drives[i].disk;
                    if (disk && disk.toBuffer) {
                        return { data: disk.toBuffer(), name: entry.name };
                    }
                    return entry;
                });
            }
            // For IF1 cartridges, serialize current in-memory state (may have been modified)
            const if1Cartridges = this.loadedIF1Cartridges.map((entry, i) => {
                if (!entry) return null;
                const cartData = this.microdrive.getCartridgeData(i);
                if (cartData) {
                    return { data: cartData, name: entry.name };
                }
                return entry;
            });
            return {
                tape: this.loadedTapes[this.activeTapeSlot],
                tapes: this.loadedTapes,
                activeTapeSlot: this.activeTapeSlot,
                tapeSlotStates: this.tapeSlotStates,
                tapeRecordings: this.tapeRecordings,
                micRecordings: this.micRecordings,
                betaDisks: this._liveDiskImages(this.loadedBetaDisks, this.betaDisk),
                fdcDisks: fdcDisks,
                plusDDisks: this._liveDiskImages(this.loadedPlusDDisks, this.plusD),
                opusDisks: this._liveDiskImages(this.loadedOpusDisks, this.opus),
                didaktikDisks: this._liveDiskImages(this.loadedDidaktikDisks, this.didaktik),
                if1Cartridges: if1Cartridges,
                tapeBlock: this.getTapeBlock()
            };
        }

        setLoadedMedia(media) {
            if (!media) return;

            // New multi-drive format (mediaVersion 2)
            if (media.tape !== undefined) {
                // Restore multi-tape state if available
                if (media.tapes) {
                    this.loadedTapes = media.tapes;
                    this.activeTapeSlot = media.activeTapeSlot || 0;
                    this.tapeSlotStates = media.tapeSlotStates || [null, null];
                    this.tapeRecordings = media.tapeRecordings || [[], []];
                    this.micRecordings = media.micRecordings || [[], []];
                } else if (media.tape) {
                    // Legacy: single tape → slot 0
                    this.loadedTapes = [media.tape ? { ...media.tape } : null, null];
                    this.activeTapeSlot = 0;
                    this.tapeSlotStates = [null, null];
                    this.tapeRecordings = [[], []];
                }
                // Load the active slot's tape into the engine
                const activeTape = this.loadedTapes[this.activeTapeSlot];
                if (activeTape && activeTape.data) {
                    if (activeTape.type === 'tap') {
                        this.tapeLoader.load(activeTape.data.buffer);
                        this.tapeTrap.setTape(this.tapeLoader);
                        this.tapePlayer.loadFromTapeLoader(this.tapeLoader);
                    } else if (activeTape.type === 'tzx') {
                        this.loadTZX(activeTape.data.buffer, null);
                    } else if (activeTape.type === 'wav') {
                        this.loadWAV(activeTape.data.buffer, null);
                    }
                }
                // Restore Beta Disk drives
                if (media.betaDisks) {
                    for (let i = 0; i < 4; i++) {
                        if (media.betaDisks[i] && media.betaDisks[i].data) {
                            this.betaDisk.loadDisk(media.betaDisks[i].data, 'trd', i);
                            this.loadedBetaDisks[i] = media.betaDisks[i];
                            // Rebuild file listing for this drive
                            try {
                                this.loadedBetaDiskFiles[i] = TRDLoader.listFiles(media.betaDisks[i].data);
                            } catch (e) { /* ignore */ }
                            // Set up trap for drive 0
                            if (i === 0 && this.loadedBetaDiskFiles[0]) {
                                this.trdosTrap.setDisk(media.betaDisks[i].data, this.loadedBetaDiskFiles[0], 'trd');
                            }
                        }
                    }
                }
                // Restore FDC drives
                if (media.fdcDisks && this.fdc) {
                    for (let i = 0; i < 2; i++) {
                        if (media.fdcDisks[i] && media.fdcDisks[i].data) {
                            const dskImage = DSKLoader.parse(media.fdcDisks[i].data.buffer || media.fdcDisks[i].data);
                            this.fdc.drives[i].disk = dskImage;
                            this.loadedFDCDisks[i] = media.fdcDisks[i];
                            try {
                                this.loadedFDCDiskFiles[i] = DSKLoader.listFiles(dskImage);
                            } catch (e) { /* non-CP/M disk */ }
                        }
                    }
                }
                // Restore +D drives
                if (media.plusDDisks) {
                    for (let i = 0; i < 2; i++) {
                        if (media.plusDDisks[i] && media.plusDDisks[i].data) {
                            this.plusD.loadDisk(media.plusDDisks[i].data, 'mgt', i);
                            this.loadedPlusDDisks[i] = media.plusDDisks[i];
                            try {
                                this.loadedPlusDDiskFiles[i] = MGTLoader.listFiles(media.plusDDisks[i].data);
                            } catch (e) { /* ignore */ }
                        }
                    }
                }
                // Restore Didaktik 80 drives
                if (media.didaktikDisks) {
                    for (let i = 0; i < 2; i++) {
                        if (media.didaktikDisks[i] && media.didaktikDisks[i].data) {
                            this.didaktik.loadDisk(media.didaktikDisks[i].data, 'd80', i);
                            this.loadedDidaktikDisks[i] = media.didaktikDisks[i];
                            try {
                                this.loadedDidaktikDiskFiles[i] = DidaktikLoader.listFiles(media.didaktikDisks[i].data);
                            } catch (e) { /* ignore */ }
                        }
                    }
                }
                // Restore Opus Discovery drives
                if (media.opusDisks) {
                    for (let i = 0; i < 2; i++) {
                        if (media.opusDisks[i] && media.opusDisks[i].data) {
                            this.opus.loadDisk(media.opusDisks[i].data, 'opd', i);
                            this.loadedOpusDisks[i] = media.opusDisks[i];
                            try {
                                this.loadedOpusDiskFiles[i] = OPDLoader.listFiles(media.opusDisks[i].data);
                            } catch (e) { /* ignore */ }
                        }
                    }
                }
                // Restore IF1 Microdrive cartridges
                if (media.if1Cartridges) {
                    for (let i = 0; i < 8; i++) {
                        if (media.if1Cartridges[i] && media.if1Cartridges[i].data) {
                            this.microdrive.loadCartridge(media.if1Cartridges[i].data, i);
                            this.loadedIF1Cartridges[i] = media.if1Cartridges[i];
                            try {
                                this.loadedIF1CartridgeFiles[i] = MDRLoader.listFiles(media.if1Cartridges[i].data);
                            } catch (e) { /* ignore */ }
                        }
                    }
                    this.updateBetaDiskPagingFlag();
                }
            } else if (media.data) {
                // Legacy single-media format (backward compat with old projects)
                if (media.type === 'tap') {
                    this.loadedTapes = [media, null];
                    this.activeTapeSlot = 0;
                    this.tapeSlotStates = [null, null];
                    this.tapeRecordings = [[], []];
                    this.tapeLoader.load(media.data.buffer);
                    this.tapeTrap.setTape(this.tapeLoader);
                    this.tapePlayer.loadFromTapeLoader(this.tapeLoader);
                } else if (media.type === 'tzx') {
                    this.loadedTapes = [media, null];
                    this.activeTapeSlot = 0;
                    this.tapeSlotStates = [null, null];
                    this.tapeRecordings = [[], []];
                    this.loadTZX(media.data.buffer, null);
                } else if (media.type === 'trd') {
                    this.loadedBetaDisks[0] = media;
                    this.betaDisk.loadDisk(media.data, 'trd', 0);
                    try {
                        this.loadedBetaDiskFiles[0] = TRDLoader.listFiles(media.data);
                        this.trdosTrap.setDisk(media.data, this.loadedBetaDiskFiles[0], 'trd');
                    } catch (e) { /* ignore */ }
                } else if (media.type === 'dsk' && this.fdc) {
                    this.loadedFDCDisks[0] = media;
                    const dskImage = DSKLoader.parse(media.data.buffer || media.data);
                    this.fdc.drives[0].disk = dskImage;
                    try {
                        this.loadedFDCDiskFiles[0] = DSKLoader.listFiles(dskImage);
                    } catch (e) { /* non-CP/M disk */ }
                }
            }
        }

        clearLoadedMedia() {
            this.loadedTapes = [null, null];
            this.activeTapeSlot = 0;
            this.tapeSlotStates = [null, null];
            this.tapeRecordings = [[], []];
            this.loadedBetaDisks = [null, null, null, null];
            this.loadedFDCDisks = [null, null];
            this.loadedPlusDDisks = [null, null];
            this.loadedIF1Cartridges = new Array(8).fill(null);
            this.loadedBetaDiskFiles = [null, null, null, null];
            this.loadedFDCDiskFiles = [null, null];
            this.loadedPlusDDiskFiles = [null, null];
            this.loadedIF1CartridgeFiles = new Array(8).fill(null);
        }

        clearTape() {
            this.loadedTapes = [null, null];
            this.activeTapeSlot = 0;
            this.tapeSlotStates = [null, null];
            this.tapeRecordings = [[], []];
        }

        // --- Tape slot switching ---
        getActiveTapeSlot() { return this.activeTapeSlot; }

        setActiveTapeSlot(slot) {
            slot = slot & 1;
            if (slot === this.activeTapeSlot) return;
            this.tapePlayer.stop();
            // Save current slot state
            this.tapeSlotStates[this.activeTapeSlot] = {
                loaderBlock: this.tapeLoader.getCurrentBlock(),
                playerBlock: this.tapePlayer.currentBlock
            };
            this.activeTapeSlot = slot;
            this._loadActiveTapeSlot();
        }

        _loadActiveTapeSlot() {
            const tape = this.loadedTapes[this.activeTapeSlot];
            const saved = this.tapeSlotStates[this.activeTapeSlot];
            if (!tape || !tape.data) {
                this.tapeLoader.blocks = [];
                this.tapeLoader.currentBlock = 0;
                this.tapePlayer.blocks = [];
                this.tapePlayer.currentBlock = 0;
                this.tapeTrap.setTape(null);
                return;
            }
            // Re-load tape data into engine (storeName=null to avoid overwriting loadedTapes)
            if (tape.type === 'tap') this.loadTape(tape.data.buffer || tape.data, null);
            else if (tape.type === 'tzx') this.loadTZX(tape.data.buffer || tape.data, null);
            else if (tape.type === 'wav') this.loadWAV(tape.data.buffer || tape.data, null);
            // Restore position
            if (saved) {
                this.tapeLoader.setCurrentBlock(saved.loaderBlock);
                this.tapePlayer.setBlock(saved.playerBlock);
            }
        }

        // --- Recording export ---
        getTapeRecording(slot) {
            const idx = (slot !== undefined ? slot : this.activeTapeSlot) & 1;
            const tapBlocks = this.tapeRecordings[idx];
            const micBlocks = this.micRecordings[idx];
            const hasTap = tapBlocks && tapBlocks.length > 0;
            const hasMic = micBlocks && micBlocks.length > 0;
            if (!hasTap && !hasMic) return null;
            // MIC data present → export as TZX (supports both standard + custom blocks)
            if (hasMic) {
                return { data: buildTZX(tapBlocks || [], micBlocks), ext: 'tzx' };
            }
            // TAP only → export as TAP
            let total = 0;
            for (const b of tapBlocks) total += b.length;
            const tap = new Uint8Array(total);
            let off = 0;
            for (const b of tapBlocks) { tap.set(b, off); off += b.length; }
            return { data: tap, ext: 'tap' };
        }

        clearTapeRecording(slot) {
            const idx = (slot !== undefined ? slot : this.activeTapeSlot) & 1;
            this.tapeRecordings[idx] = [];
            this.micRecordings[idx] = [];
            this.micRecorder.clear();
        }

        getTapeRecordingBlockCount(slot) {
            const idx = (slot !== undefined ? slot : this.activeTapeSlot) & 1;
            return this.tapeRecordings[idx].length + this.micRecordings[idx].length;
        }

        clearDisk(driveIndex, type) {
            if (type === 'fdc') {
                if (this.fdc) this.fdc.ejectDisk(driveIndex & 0x01);
                this.loadedFDCDisks[driveIndex & 0x01] = null;
                this.loadedFDCDiskFiles[driveIndex & 0x01] = null;
            } else if (type === 'plusd') {
                this.plusD.ejectDisk(driveIndex & 0x01);
                this.disciple.ejectDisk(driveIndex & 0x01);
                this.loadedPlusDDisks[driveIndex & 0x01] = null;
                this.loadedPlusDDiskFiles[driveIndex & 0x01] = null;
            } else if (type === 'if1') {
                this.microdrive.ejectCartridge(driveIndex & 0x07);
                this.loadedIF1Cartridges[driveIndex & 0x07] = null;
                this.loadedIF1CartridgeFiles[driveIndex & 0x07] = null;
            } else {
                this.betaDisk.ejectDisk(driveIndex & 0x03);
                this.loadedBetaDisks[driveIndex & 0x03] = null;
                this.loadedBetaDiskFiles[driveIndex & 0x03] = null;
            }
        }

        // Tape position for project save/restore
        getTapeBlock() {
            return this.tapeLoader.getCurrentBlock();
        }

        setTapeBlock(n) {
            this.tapeLoader.setCurrentBlock(n);
        }

        rewindTape() {
            this.tapeLoader.rewind();
            this.tapePlayer.rewind();
        }

        // ========== Real-time Tape Playback ==========

        /**
         * Set tape load mode
         * @param {boolean} flash - true for flash load (instant), false for real-time
         */
        setTapeFlashLoad(flash) {
            this.tapeFlashLoad = flash;
            // Disable tape trap when using real-time loading
            this.tapeTrap.setEnabled(this.tapeTrapsEnabled && flash);
        }

        /**
         * Get current tape load mode
         */
        getTapeFlashLoad() {
            // A machine whose ROM the traps do not know loads in real time
            return this.tapeFlashLoad && (!this.profile.noRomTraps || !!this.profile.exromTapeTraps);
        }

        /**
         * Where the tape is — the single most diagnostic thing about a multiload.
         *
         * There are two decks, and they move independently: the flash loader
         * (`tapeLoader`, driven by the ROM trap) and the real-time player
         * (`tapePlayer`, driven by T-states). A driver that can only see one of
         * them cannot tell "the game is waiting for a block" from "the deck ran
         * 25 blocks past the one it is asking for", and ends up retiming
         * keystrokes to fix a positioning problem.
         *
         * The two block counts differ on purpose: a TZX gives the player every
         * block and the loader only the TAP-compatible subset, so `loaderBlock`
         * and `playerBlock` must each be read against their own total. Returns
         * `{ loaded: false }` rather than throwing when there is no tape, since
         * this is meant to be polled every frame.
         */
        getTapeState() {
            const tape = this.loadedTapes[this.activeTapeSlot];
            const loaderBlocks = this.tapeLoader.blocks.length;
            const playerBlocks = this.tapePlayer.blocks.length;
            if (!tape && !loaderBlocks && !playerBlocks) return { loaded: false };
            return {
                loaded: true,
                name: tape ? tape.name : null,
                type: tape ? tape.type : null,
                slot: this.activeTapeSlot,
                blocks: playerBlocks || loaderBlocks,
                loaderBlock: this.tapeLoader.currentBlock,
                loaderBlocks,
                playerBlock: this.tapePlayer.currentBlock,
                playerBlocks,
                playing: this.tapePlayer.isPlaying(),
                phase: this.tapePlayer.phase,
                flashLoad: this.tapeFlashLoad,
            };
        }

        /**
         * Start real-time tape playback
         */
        playTape() {
            if (this.getTapeFlashLoad()) return false;
            this._lastTapeUpdate = this.cpu.tStates;  // Reset tape timing tracker
            return this.tapePlayer.play();
        }

        /**
         * Stop real-time tape playback
         */
        stopTape() {
            this.tapePlayer.stop();
            this.tapeEarBit = false;
            this._turboBlockPending = false;
        }

        /**
         * Check if tape is playing
         */
        isTapePlaying() {
            return this.tapePlayer.isPlaying();
        }

        /**
         * Get tape playback position info
         */
        getTapePosition() {
            return this.tapePlayer.getPosition();
        }

        /**
         * Set tape block for real-time player
         */
        setTapePlayerBlock(n) {
            this.tapePlayer.setBlock(n);
        }
        
        // Where the media is *positioned*, as opposed to what is in it. The tape,
        // disks and cartridges themselves stay loaded; a snapshot only needs the
        // playback/seek state, or restoring mid-load resumes reading from wherever
        // the tape had since reached. Scalars only, kept small: a rewind buffer
        // holds ~30 of these.
        //
        // Field lists are explicit rather than a blanket copy, so adding a field to
        // a device can't silently start dragging a megabyte into every snapshot.
        static get MEDIA_FIELDS() {
            return {
                tape: ['currentBlock', 'playing', 'earBit', 'blockTstates', 'phase',
                       'pilotCount', 'byteIndex', 'bitIndex', 'pulseInBit', 'pulseRemaining',
                       'currentPulseIndex', 'usedBits', 'pilotPulse', 'sync1Pulse',
                       'sync2Pulse', 'zeroPulse', 'onePulse', 'pauseMs'],
                plusD: ['command', 'status', 'track', 'sector', 'data', 'drive', 'side'],
                microdrive: ['commsShiftReg', 'commsData', 'commsClk', 'writing', 'erasing'],
                // +3 uPD765: the command/result/data phase machinery, so a restore
                // mid-sector doesn't strand the CPU waiting on a controller that
                // has forgotten the command.
                fdc: ['phase', 'commandBytesExpected', 'currentCommand', 'resultIndex',
                      'dataIndex', 'dataDirection', 'opCylinder', 'opHead', 'opSector',
                      'opSectorEnd', 'opSizeCode', 'opDTL', 'opMultiTrack', 'opMFM',
                      'opSkipDeleted', 'interruptPending', 'seekTrack', 'driveBusy'],
            };
        }

        _snapshotMedia() {
            const out = {};
            const grab = (obj, fields) => {
                const o = {};
                for (const f of fields) if (obj[f] !== undefined) o[f] = obj[f];
                return o;
            };
            const F = Spectrum.MEDIA_FIELDS;
            if (this.tapePlayer) {
                out.tape = grab(this.tapePlayer, F.tape);
                // The loop stack is small and matters for TZX loops
                out.tape.loopStack = (this.tapePlayer.loopStack || []).slice(0, 16);
            }
            if (this.plusD) {
                out.plusD = grab(this.plusD, F.plusD);
                out.plusD.headTracks = (this.plusD.drives || []).map(d => d.headTrack | 0);
            }
            if (this.microdrive) {
                out.microdrive = grab(this.microdrive, F.microdrive);
                out.microdrive.positions = (this.microdrive.drives || []).map(d => d && d.headPos | 0);
            }
            if (this.fdc) {
                out.fdc = grab(this.fdc, F.fdc);
                out.fdc.tracks = (this.fdc.drives || []).map(d => d.track | 0);
                out.fdc.motors = (this.fdc.drives || []).map(d => !!d.motorOn);
                // The in-flight buffers decide whether a command can carry on
                out.fdc.commandBuffer = Array.from(this.fdc.commandBuffer || []);
                out.fdc.resultBuffer = Array.from(this.fdc.resultBuffer || []);
                out.fdc.dataBuffer = Array.from(this.fdc.dataBuffer || []);
            }
            // HC IF1: its 1KB RAM, the select latch and whether it is paged in.
            // The FDC itself is this.fdc above.
            if (this.hcIf1) {
                out.hcIf1 = this.hcIf1.getState();
                out.hcIf1.paged = !!this.memory.if1Active;
            }
            // Beta 48: its ROM latch and master register (the WD1793 goes with
            // the Beta Disk chunks as on the Beta 128)
            if (this.memory.beta48On) {
                out.beta48 = { latch: !!this.memory.beta48Latch, master: this._beta48Master,
                    windowOff: !!this.memory.beta48WindowOff };
            }
            // TKMEM-128 II: its RAM is not in the 48K image, so it travels here
            const m = this.memory;
            if (m.tkmemRam) {
                out.tkmem = { ram: m.tkmemRam.slice(), latch: m.tkmemLatch,
                    bank: m.tkmemBank, locked: m.tkmemLocked };
            }
            return out;
        }

        _restoreMedia(state) {
            if (!state) return;
            const put = (obj, fields, src) => {
                if (!obj || !src) return;
                for (const f of fields) if (src[f] !== undefined) obj[f] = src[f];
            };
            const F = Spectrum.MEDIA_FIELDS;
            if (state.tape && this.tapePlayer) {
                put(this.tapePlayer, F.tape, state.tape);
                if (Array.isArray(state.tape.loopStack)) this.tapePlayer.loopStack = state.tape.loopStack;
                // The tape may have been changed since: keep the index in range
                const n = (this.tapePlayer.blocks || []).length;
                if (this.tapePlayer.currentBlock > n) this.tapePlayer.currentBlock = n;
            }
            if (state.plusD && this.plusD) {
                put(this.plusD, F.plusD, state.plusD);
                const ht = state.plusD.headTracks || [];
                (this.plusD.drives || []).forEach((d, i) => { if (ht[i] !== undefined) d.headTrack = ht[i]; });
            }
            if (state.microdrive && this.microdrive) {
                put(this.microdrive, F.microdrive, state.microdrive);
                const pos = state.microdrive.positions || [];
                (this.microdrive.drives || []).forEach((d, i) => {
                    if (d && pos[i] !== undefined) d.headPos = pos[i];
                });
            }
            if (state.fdc && this.fdc) {
                put(this.fdc, F.fdc, state.fdc);
                const tr = state.fdc.tracks || [], mo = state.fdc.motors || [];
                (this.fdc.drives || []).forEach((d, i) => {
                    if (tr[i] !== undefined) d.track = tr[i];
                    if (mo[i] !== undefined) d.motorOn = mo[i];
                });
                if (state.fdc.commandBuffer) this.fdc.commandBuffer = state.fdc.commandBuffer.slice();
                if (state.fdc.resultBuffer) this.fdc.resultBuffer = state.fdc.resultBuffer.slice();
                if (state.fdc.dataBuffer) this.fdc.dataBuffer = state.fdc.dataBuffer.slice();
            }
            if (state.hcIf1 && this.hcIf1) {
                this.hcIf1.setState(state.hcIf1);
                this.memory.if1Active = !!state.hcIf1.paged;
            }
            if (state.beta48 && this.memory.beta48On) {
                this.memory.beta48Latch = !!state.beta48.latch;
                this._beta48Master = state.beta48.master | 0;
                this.memory.beta48WindowOff = !!state.beta48.windowOff;
            }
            const m = this.memory;
            if (state.tkmem && m.tkmemRam && state.tkmem.ram &&
                state.tkmem.ram.length === m.tkmemRam.length) {
                m.tkmemRam.set(state.tkmem.ram);
                m.tkmemLatch = state.tkmem.latch | 0;
                m.tkmemBank = state.tkmem.bank | 0;
                m.tkmemLocked = !!state.tkmem.locked;
            }
        }

        // State a snapshot must carry beyond CPU/RAM/paging, so quicksave, a save
        // slot and a rewind step don't leave the sound chip and the disk controller
        // where they happened to be. Field names are the machine's own.
        _snapshotPeripherals() {
            const p = {};
            if (this.ay && (is128kCompat(this.machineType) || this.ay48kEnabled)) p.ay = this.ay;
            if (this.betaDisk) {
                const bd = this.betaDisk;
                p.betaDisk = {
                    numDrives: bd.drives ? bd.drives.length : 1,
                    systemReg: bd.system, track: bd.track, sector: bd.sector,
                    data: bd.data, status: bd.status,
                };
                p.betaDiskPaged = !!this.memory.trdosActive;
                // B128 has no room for the parts that decide whether a command in
                // flight can continue: which drive/side, where each head is, and the
                // sector buffer being transferred. Those go in a private chunk.
                p.betaDiskExtra = {
                    command: bd.command, drive: bd.drive, side: bd.side,
                    headTracks: (bd.drives || []).map(d => d.headTrack | 0),
                    dataPos: bd.dataPos | 0,
                    dataBuffer: bd.dataBuffer ? new Uint8Array(bd.dataBuffer) : null,
                };
            }
            p.media = this._snapshotMedia();
            if (this.ula && this.ula.ulaplus) {
                p.ulaPlus = {
                    enabled: this.ula.ulaplus.paletteEnabled,
                    mode: this.ula.ulaplus.register,
                    palette: this.ula.ulaplus.palette,
                };
            }
            return p;
        }

        // The restoring counterpart: setters so the loader writes through to the
        // real objects without knowing their shape.
        _restorePeripherals() {
            const self = this;
            const p = {};
            if (this.ay && (is128kCompat(this.machineType) || this.ay48kEnabled)) p.ay = this.ay;
            if (this.betaDisk) {
                const bd = this.betaDisk;
                p.betaDisk = {
                    set systemReg(v) { bd.system = v; },
                    set track(v) { bd.track = v; },
                    set sector(v) { bd.sector = v; },
                    set data(v) { bd.data = v; },
                    set status(v) { bd.status = v; },
                };
                p.setBetaDiskPaged = (paged) => { self.memory.trdosActive = !!paged; };
                p.setBetaDiskExtra = (x) => {
                    bd.command = x.command;
                    bd.drive = x.drive;
                    bd.side = x.side;
                    if (bd.drives) {
                        for (let i = 0; i < bd.drives.length && i < x.headTracks.length; i++) {
                            bd.drives[i].headTrack = x.headTracks[i];
                        }
                    }
                    bd.dataPos = x.dataPos;
                    bd.dataBuffer = x.dataBuffer ? new Uint8Array(x.dataBuffer) : null;
                };
            }
            p.setMedia = (state) => self._restoreMedia(state);
            if (this.ula && this.ula.ulaplus) {
                const u = this.ula;
                p.ulaPlus = {
                    setState(enabled, mode, palette) {
                        u.ulaplus.paletteEnabled = !!enabled;
                        u.ulaplus.register = mode & 0xFF;
                        for (let i = 0; i < 64 && i < palette.length; i++) u.ulaplus.palette[i] = palette[i];
                        u.ulaplus.paletteModified = true;
                        u.updateULAplusPalette32();
                    },
                };
            }
            return p;
        }

        saveSnapshot(format = 'sna') {
            switch (format.toLowerCase()) {
                case 'z80':
                    return this.snapshotLoader.createZ80(this.cpu, this.memory, this.ula.borderColor);
                case 'szx':
                    return SZXLoader.create(this.cpu, this.memory, this.ula.borderColor,
                                            this._snapshotPeripherals());
                case 'sna':
                default:
                    return this.snapshotLoader.createSNA(this.cpu, this.memory, this.ula.borderColor);
            }
        }
        
        getState() {
            return {
                cpu: {
                    pc: this.cpu.pc, sp: this.cpu.sp, af: this.cpu.af,
                    bc: this.cpu.bc, de: this.cpu.de, hl: this.cpu.hl,
                    ix: this.cpu.ix, iy: this.cpu.iy, i: this.cpu.i, r: this.cpu.r,
                    iff1: this.cpu.iff1, iff2: this.cpu.iff2, im: this.cpu.im, halted: this.cpu.halted
                },
                memory: this.memory.getPagingState(),
                ula: { border: this.ula.borderColor, flash: this.ula.flashState },
                running: this.running, fps: this.actualFps
            };
        }
        
        peek(addr) { return this.memory.read(addr); }
        poke(addr, val) { this.memory.write(addr, val); }

        // ========== Machine Type ==========

        setMachineType(type, preserveRom = false) {
            const wasRunning = this.running;
            if (wasRunning) this.stop();

            // Track old machine type for ROM compatibility check
            this._lastMachineType = this.machineType;

            // Save ROM data if preserving
            const oldRom = preserveRom && this.romLoaded ? this.memory.rom : null;

            // Save ULA settings before creating new ULA
            const oldFullBorderMode = this.ula ? this.ula.fullBorderMode : false;
            const oldPalette = this.ula ? this.ula.palette : null;
            const oldPaletteId = this.ula ? this.ula.paletteId : null;
            const oldCapsOption = this.ula ? this.ula.capsShiftOption : null;
            const oldSymbolOption = this.ula ? this.ula.symbolShiftOption : null;
            const oldKeyboardGhosting = this.ula ? this.ula.keyboardGhosting : undefined;
            const oldSnow = this.ula ? this.ula.snowEnabled : undefined;
            // null means "whatever the new machine's profile says", which is the point
            const oldInkSkew = this.ula ? this.ula.inkSkewOverride : undefined;
            const oldPalComposite = this.ula ? this.ula.palCompositeEnabled : undefined;
            // Use persistent setting, not runtime state (which may be modified by test runner)
            const ulaplusSetting = storageGet('zxm8_ulaplus') === 'true';

            this.machineType = type;
            this.profile = getMachineProfile(type);
            this.ayEnabled = this.profile.ayDefault;  // Update AY enabled state for new machine type
            // Beta Disk follows the machine: built into Pentagon/Scorpion,
            // otherwise whatever the user ticked in Settings. This used to only
            // ever switch it ON, so Pentagon → +3 left the +3 with a Beta Disk
            // nobody had asked for — and the TR-DOS disk still sitting in a
            // drive A that the +3's own drive A was also claiming.
            this.betaDiskEnabled = this.profile.betaDiskDefault ||
                storageGet('zxm8_betaDisk') === 'true';
            if (this.ay) this.ay.reset();  // Stop any playing AY sound
            this.memory = new Memory(type);
            this.memory.setTkmem(this.tkmemSize);   // 48K only; a no-op elsewhere
            // The new Memory needs the Opus controller re-linked — its registers
            // are read through the memory map, so a fresh Memory without this
            // reference would return $FF for every FDC and PIA access.
            this.memory.opusDisk = this.opus;
            this.memory.fdd3000 = this.fdd3000;
            this.memory.kempdisc = this.kempdisc;
            this._applyTimexCartridge();
            this.ula = new ULA(this.memory, type);
            this.cpu = new Z80(this.memory);
            this.ula.cpu = this.cpu;  // For debug access to CPU state
            this.cpu.portRead = this.portRead.bind(this);
            this.cpu.portWrite = this.portWrite.bind(this);
            this.setupContention();  // Setup contention for new machine type
            this.timing = this.ula.getTiming();
            this.micRecorder.setTstatesPerFrame(this.timing.tstatesPerFrame);
            this.micRecorder.reset();

            // Restore ULA settings to new ULA
            if (oldCapsOption) {
                this.ula.setModifierKeys(oldCapsOption, oldSymbolOption);
            }
            if (oldKeyboardGhosting !== undefined) {
                this.ula.setKeyboardGhosting(oldKeyboardGhosting);
            }
            if (oldSnow !== undefined) {
                this.ula.setSnowEffect(oldSnow);
            }
            if (oldInkSkew !== undefined) {
                this.ula.setInkSkew(oldInkSkew);
            }
            if (oldPalComposite !== undefined) {
                this.ula.setPalComposite(oldPalComposite);
            }
            if (this.lateTimings !== undefined) {
                this.ula.setLateTimings(this.lateTimings);
            }
            if (this.pentagonAttrOffset !== undefined) {
                this.ula.setPentagonAttrOffset(this.pentagonAttrOffset);
            }
            if (oldFullBorderMode) {
                this.ula.setFullBorder(oldFullBorderMode);
            }
            if (oldPalette) {
                this.ula.palette = oldPalette;
                this.ula.paletteId = oldPaletteId;
            }
            // Restore ULAplus enabled state from user setting, not runtime state
            this.ula.ulaplus.enabled = ulaplusSetting;
            this.ula.resetULAplus();  // Reset palette, paletteEnabled, register to defaults
            this.updateDisplayDimensions();  // Recreate imageData for new ULA dimensions
            this.tapeTrap = new TapeTrapHandler(this.cpu, this.memory, this.tapeLoader);
            this.tapeTrap.setEnabled(this.tapeTrapsEnabled && this.tapeFlashLoad);

            // Recreate TR-DOS trap with new CPU/memory, preserve disk data
            const oldDiskData = this.trdosTrap ? this.trdosTrap.diskData : null;
            const oldDiskFiles = this.trdosTrap ? this.trdosTrap.diskFiles : null;
            const oldDiskType = this.trdosTrap ? this.trdosTrap.diskType : null;
            this.trdosTrap = new TRDOSTrapHandler(this.cpu, this.memory);
            this.trdosTrap.setEnabled(this.tapeTrapsEnabled);
            if (oldDiskData) {
                this.trdosTrap.setDisk(oldDiskData, oldDiskFiles, oldDiskType);
            }

            // Re-setup memory callbacks based on current feature state
            this.updateMemoryCallbacksFlag();

            // Update Beta Disk paging flag for new machine type
            this.updateBetaDiskPagingFlag();

            // Recreate FDC for new machine type
            this.fdc = this.profile.hasFDC ? new UPD765() : null;
            // ...and on the HC-2000 the FDC is the HC IF1's, not the +3's. This
            // runs on every machine change, so it also drops the HC IF1 when
            // leaving the HC-2000 and builds it when arriving.
            this._setupHcIf1();

            // Restore ROM data
            if (oldRom) {
                const machineTypeChanged = this._lastMachineType !== type;

                // When machine type changes, don't try to reuse ROMs - require proper reload
                // Different machine ROMs are not interchangeable (even 128K bank 1 vs 48K ROM can differ)
                if (machineTypeChanged) {
                    this.romLoaded = false;
                    // Don't auto-start without ROM
                } else {
                    // Same machine type - copy all ROM banks
                    for (let i = 0; i < this.memory.rom.length; i++) {
                        if (oldRom[i] && this.memory.rom[i]) {
                            this.memory.rom[i].set(oldRom[i]);
                        }
                    }
                    this.romLoaded = true;
                    if (wasRunning) this.start();
                }
            } else {
                this.romLoaded = false;
                // Don't auto-start without ROM - caller must load ROM and start manually
            }
        }

        // ========== RZX Playback ==========

        async loadRZX(data, skipSnapshot = false) {
            const rzx = new RZXLoader();
            await rzx.parse(data);

            if (!rzx.getSnapshot()) {
                throw new Error('RZX file has no embedded snapshot');
            }

            // Load the embedded snapshot (unless restoring from project)
            if (!skipSnapshot) {
                const snapData = rzx.getSnapshot();
                const snapType = rzx.getSnapshotType();

                // Create a proper ArrayBuffer (snapData might be a view with byteOffset)
                const snapBuffer = snapData.buffer.slice(
                    snapData.byteOffset,
                    snapData.byteOffset + snapData.byteLength
                );

                if (snapType === 'z80') {
                    this.loadZ80Snapshot(snapBuffer);
                } else if (snapType === 'sna') {
                    this.loadSnapshot(snapBuffer);
                } else if (snapType === 'szx') {
                    this.loadSZXSnapshot(snapBuffer);
                } else {
                    throw new Error('Unsupported snapshot type in RZX: ' + snapType);
                }

            }

            // Store original data for project save
            this.rzxData = new Uint8Array(data);

            // Setup RZX playback
            this.rzxPlayer = rzx;
            this.rzxPlayer.reset();  // Reset all frame inputIndex values
            this.rzxFrame = 0;
            this.rzxInstructions = 0;  // Start at beginning of frame 0
            this.rzxFrameStartInstr = this.cpu.instructionCount;
            this.rzxFirstInterrupt = true;  // Don't advance on first interrupt
            this.rzxPlaying = true;
            this.rzxDebugLog = [];  // Reset debug log for new playback

            // Reset input state to prevent stale inputs affecting playback
            this.kempstonState = 0;
            this.gamepadState = 0;
            this.gamepadExtState = 0;
            this.kempstonExtendedState = 0;

            this.rzxRecentInputs = [];
            this.portLog = [];
            this._rzxPcLogCount = 0;

            return {
                frames: rzx.getFrameCount(),
                creator: rzx.creatorInfo,
                machineType: this.machineType,
                needsRomReload: !this.romLoaded
            };
        }

        rzxStop() {
            this.rzxPlaying = false;
            this.rzxPlayer = null;
            this.rzxFrame = 0;
            this.rzxInstructions = 0;
            this.rzxFrameStartInstr = 0;
            this.rzxFirstInterrupt = true;
            this.rzxData = null;
            this.rzxRecentInputs = [];
        }

        // Enable detailed RZX debug logging for first N frames
        // Usage from console: spectrum.rzxEnableDebug(100)
        rzxEnableDebug(frames = 100) {
            this.rzxDebugFrames = frames;
            this.rzxDebugLog = [];
            console.log(`RZX debug enabled for first ${frames} frames. Reload RZX to start logging.`);
        }

        // Get collected debug log as JSON string (for comparison with other emulators)
        // Usage from console: spectrum.rzxGetDebugLog()
        rzxGetDebugLog() {
            return JSON.stringify(this.rzxDebugLog, null, 2);
        }

        // Export debug log to file
        rzxExportDebugLog() {
            const json = this.rzxGetDebugLog();
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'rzx_debug_log.json';
            a.click();
            URL.revokeObjectURL(url);
            console.log(`Exported ${this.rzxDebugLog.length} frames to rzx_debug_log.json`);
        }

        isRZXPlaying() {
            return this.rzxPlaying;
        }

        getRZXFrame() {
            return this.rzxFrame;
        }

        setRZXFrame(frame) {
            this.rzxFrame = frame;
        }

        getRZXTotalFrames() {
            return this.rzxPlayer ? this.rzxPlayer.getFrameCount() : 0;
        }

        getRZXData() {
            return this.rzxData;
        }

        getRZXInstructions() {
            return this.rzxInstructions;
        }

        setRZXInstructions(count) {
            this.rzxInstructions = count;
            this.rzxFrameStartInstr = this.cpu.instructionCount;
        }

        // ========== RZX Recording ==========

        /**
         * Start RZX recording - recording actually begins at next frame boundary
         */
        rzxStartRecording() {
            // Stop any active RZX playback first
            if (this.rzxPlaying) {
                this.rzxStop();
            }

            // Set pending flag - actual recording starts after next interrupt fires
            this.rzxRecordPending = true;
            this.rzxRecordedFrames = [];
            this.rzxRecordSnapshot = null;
            this.rzxRecordSnapshotType = 'szx';  // SZX preserves halted state

            return true;
        }

        /**
         * Actually start recording (called at frame boundary)
         */
        rzxStartRecordingNow() {
            // Log CPU state for debugging RZX compatibility
            // Use SZX format for RZX recording - it properly preserves halted state
            this.rzxRecordSnapshot = this.createSZXSnapshot();
            this.rzxRecordSnapshotType = 'szx';
            this.rzxRecordTstates = this.cpu.tStates;

            // Initialize recording state
            this.rzxRecordCurrentFrame = { fetchCount: 0, inputs: [] };
            this.rzxRecordStartInstr = this.cpu.instructionCount;
            this.rzxRecording = true;
            this.rzxRecordPending = false;
        }

        /**
         * Stop RZX recording
         */
        rzxStopRecording() {
            if (!this.rzxRecording && !this.rzxRecordPending) {
                return null;
            }

            // If still pending (recording never actually started), just cancel
            if (this.rzxRecordPending && !this.rzxRecording) {
                this.rzxRecordPending = false;
                console.log('[RZX REC] Recording was pending, cancelled');
                return { frames: 0, snapshot: null, snapshotType: null };
            }

            // Finalize current frame if it has any content
            if (this.rzxRecordCurrentFrame && this.rzxRecordCurrentFrame.inputs.length > 0) {
                const fetchCount = this.cpu.instructionCount - this.rzxRecordStartInstr;
                this.rzxRecordCurrentFrame.fetchCount = fetchCount;
                this.rzxRecordedFrames.push(this.rzxRecordCurrentFrame);
            }

            this.rzxRecording = false;
            this.rzxRecordPending = false;
            this.rzxRecordCurrentFrame = null;

            console.log(`[RZX REC] Stopped recording. ${this.rzxRecordedFrames.length} frames captured.`);

            return {
                frames: this.rzxRecordedFrames.length,
                snapshot: this.rzxRecordSnapshot,
                snapshotType: this.rzxRecordSnapshotType
            };
        }

        /**
         * Cancel RZX recording without saving
         */
        rzxCancelRecording() {
            this.rzxRecording = false;
            this.rzxRecordPending = false;
            this.rzxRecordedFrames = [];
            this.rzxRecordCurrentFrame = null;
            this.rzxRecordSnapshot = null;
            this.rzxRecordStartInstr = 0;
            console.log('[RZX REC] Recording cancelled');
        }

        /**
         * Check if RZX recording is active or pending
         */
        isRZXRecording() {
            return this.rzxRecording || this.rzxRecordPending;
        }

        /**
         * Get recorded RZX frame count
         */
        getRZXRecordedFrameCount() {
            return this.rzxRecordedFrames.length;
        }

        /**
         * Save recorded RZX to file
         * @returns {Uint8Array} RZX file data
         */
        rzxSaveRecording() {
            if (this.rzxRecordedFrames.length === 0) {
                console.warn('No frames recorded');
                return null;
            }

            // Build RZX file
            const rzxData = this.buildRZXFile(
                this.rzxRecordSnapshot,
                this.rzxRecordSnapshotType,
                this.rzxRecordedFrames
            );

            console.log(`[RZX REC] Saved RZX: ${rzxData.length} bytes, ${this.rzxRecordedFrames.length} frames`);
            return rzxData;
        }

        /**
         * Build RZX file from recorded data
         */
        buildRZXFile(snapshot, snapshotType, frames) {
            // RZX file structure:
            // - Header (10 bytes): "RZX!" + version (0.13) + flags
            // - Creator block (29+ bytes)
            // - Snapshot block (variable)
            // - Input recording block (variable)

            const chunks = [];

            // 1. RZX Header
            const header = new Uint8Array(10);
            header[0] = 0x52; // 'R'
            header[1] = 0x5A; // 'Z'
            header[2] = 0x58; // 'X'
            header[3] = 0x21; // '!'
            header[4] = 0x00; // Major version
            header[5] = 0x0D; // Minor version (13 = 0.13)
            header[6] = 0x00; // Flags (little-endian DWORD)
            header[7] = 0x00;
            header[8] = 0x00;
            header[9] = 0x00;
            chunks.push(header);

            // 2. Creator block (ID = 0x10)
            const creatorName = 'ZX-M8XXX';
            const creatorBlock = new Uint8Array(29);
            creatorBlock[0] = 0x10; // Block ID
            // Block length INCLUDES the 5-byte header (ID + length field)
            const creatorLen = 29; // 5 (header) + 20 (name) + 2 (version) + 2 (custom data length = 0)
            creatorBlock[1] = creatorLen & 0xFF;
            creatorBlock[2] = (creatorLen >> 8) & 0xFF;
            creatorBlock[3] = (creatorLen >> 16) & 0xFF;
            creatorBlock[4] = (creatorLen >> 24) & 0xFF;
            // Creator ID (20 bytes, null-padded)
            for (let i = 0; i < 20; i++) {
                creatorBlock[5 + i] = i < creatorName.length ? creatorName.charCodeAt(i) : 0;
            }
            // Version (major, minor) - parse from APP_VERSION (defined in index.html)
            const versionParts = (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '0.0.0').split('.');
            creatorBlock[25] = parseInt(versionParts[0], 10) || 0; // Major
            creatorBlock[26] = parseInt(versionParts[1], 10) || 0; // Minor
            // Custom data length (2 bytes, 0 = none)
            creatorBlock[27] = 0;
            creatorBlock[28] = 0;
            chunks.push(creatorBlock);

            // 3. Snapshot block (ID = 0x30)
            // Structure: ID(1) + Length(4) + Flags(4) + Extension(4) + UncompLen(4) + data
            const extBytes = new Uint8Array(4);
            const ext = snapshotType.toLowerCase();
            for (let i = 0; i < 4; i++) {
                extBytes[i] = i < ext.length ? ext.charCodeAt(i) : 0;
            }

            // Snapshot block header: ID(1) + Length(4) + Flags(4) + Extension(4) + UncompLen(4) = 17 bytes
            // Note: UncompLen included even for uncompressed - most emulators expect it
            const snapBlockHeader = new Uint8Array(17);
            snapBlockHeader[0] = 0x30; // Block ID
            const snapBlockLen = 17 + snapshot.length;
            snapBlockHeader[1] = snapBlockLen & 0xFF;
            snapBlockHeader[2] = (snapBlockLen >> 8) & 0xFF;
            snapBlockHeader[3] = (snapBlockLen >> 16) & 0xFF;
            snapBlockHeader[4] = (snapBlockLen >> 24) & 0xFF;
            // Flags (DWORD): bit 0 = compressed, bit 1 = external
            snapBlockHeader[5] = 0x00;
            snapBlockHeader[6] = 0x00;
            snapBlockHeader[7] = 0x00;
            snapBlockHeader[8] = 0x00;
            // Extension (4 bytes)
            snapBlockHeader[9] = extBytes[0];
            snapBlockHeader[10] = extBytes[1];
            snapBlockHeader[11] = extBytes[2];
            snapBlockHeader[12] = extBytes[3];
            // Uncompressed length (included for compatibility)
            snapBlockHeader[13] = snapshot.length & 0xFF;
            snapBlockHeader[14] = (snapshot.length >> 8) & 0xFF;
            snapBlockHeader[15] = (snapshot.length >> 16) & 0xFF;
            snapBlockHeader[16] = (snapshot.length >> 24) & 0xFF;
            chunks.push(snapBlockHeader);
            chunks.push(snapshot);

            // 4. Input recording block (ID = 0x80)
            // Build frame data first
            const frameDataChunks = [];
            for (const frame of frames) {
                // Each frame: fetchCount (2 bytes) + inputCount (2 bytes) + inputs
                const frameSize = 4 + frame.inputs.length;
                const frameData = new Uint8Array(frameSize);
                frameData[0] = frame.fetchCount & 0xFF;
                frameData[1] = (frame.fetchCount >> 8) & 0xFF;
                frameData[2] = frame.inputs.length & 0xFF;
                frameData[3] = (frame.inputs.length >> 8) & 0xFF;
                for (let i = 0; i < frame.inputs.length; i++) {
                    frameData[4 + i] = frame.inputs[i];
                }
                frameDataChunks.push(frameData);
            }

            // Concatenate frame data
            let frameDataLen = 0;
            for (const fd of frameDataChunks) {
                frameDataLen += fd.length;
            }
            const uncompressedFrameData = new Uint8Array(frameDataLen);
            let offset = 0;
            for (const fd of frameDataChunks) {
                uncompressedFrameData.set(fd, offset);
                offset += fd.length;
            }

            // Compress frame data using pako (like eric.rzx)
            let frameData;
            let isCompressed = false;
            if (typeof pako !== 'undefined') {
                try {
                    frameData = pako.deflate(uncompressedFrameData);
                    isCompressed = true;
                } catch (e) {
                    console.warn('[RZX] Compression failed, using uncompressed:', e);
                    frameData = uncompressedFrameData;
                }
            } else {
                frameData = uncompressedFrameData;
            }

            // Input block header (18 bytes)
            const inputBlockHeader = new Uint8Array(18);
            inputBlockHeader[0] = 0x80; // Block ID
            // Block length INCLUDES 5-byte header: 5 + frames(4) + reserved(1) + tstates(4) + flags(4) + frameData
            const inputBlockLen = 18 + frameData.length;
            inputBlockHeader[1] = inputBlockLen & 0xFF;
            inputBlockHeader[2] = (inputBlockLen >> 8) & 0xFF;
            inputBlockHeader[3] = (inputBlockLen >> 16) & 0xFF;
            inputBlockHeader[4] = (inputBlockLen >> 24) & 0xFF;
            // Number of frames (DWORD)
            inputBlockHeader[5] = frames.length & 0xFF;
            inputBlockHeader[6] = (frames.length >> 8) & 0xFF;
            inputBlockHeader[7] = (frames.length >> 16) & 0xFF;
            inputBlockHeader[8] = (frames.length >> 24) & 0xFF;
            // Reserved byte
            inputBlockHeader[9] = 0;
            // T-states at start (DWORD) - use captured value from recording start
            const tstatesStart = this.rzxRecordTstates || 0;
            inputBlockHeader[10] = tstatesStart & 0xFF;
            inputBlockHeader[11] = (tstatesStart >> 8) & 0xFF;
            inputBlockHeader[12] = (tstatesStart >> 16) & 0xFF;
            inputBlockHeader[13] = (tstatesStart >> 24) & 0xFF;
            // Flags (DWORD): bit 0 = protected, bit 1 = compressed
            inputBlockHeader[14] = isCompressed ? 0x02 : 0x00; // bit 1 = compressed (like eric.rzx)
            inputBlockHeader[15] = 0x00;
            inputBlockHeader[16] = 0x00;
            inputBlockHeader[17] = 0x00;
            chunks.push(inputBlockHeader);
            chunks.push(frameData);

            // Combine all chunks
            let totalLen = 0;
            for (const chunk of chunks) {
                totalLen += chunk.length;
            }
            const result = new Uint8Array(totalLen);
            offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }

            return result;
        }

        /**
         * Create Z80 snapshot of current state
         * @returns {Uint8Array} Z80 v3 format snapshot
         */
        createZ80Snapshot() {
            return this.snapshotLoader.createZ80(this.cpu, this.memory, this.ula.borderColor);
        }

        /**
         * Create SZX snapshot for RZX recording (preserves halted state)
         * @returns {Uint8Array} SZX format snapshot
         */
        createSZXSnapshot() {
            return SZXLoader.create(this.cpu, this.memory, this.ula.borderColor,
                                            this._snapshotPeripherals());
        }

        /**
         * Verify RZX structure and try to parse it back
         * @returns {object} Verification result
         */
        rzxVerifyRecording() {
            const data = this.rzxSaveRecording();
            if (!data) return { valid: false, error: 'No data' };

            try {
                const hex = (arr, start, len) => Array.from(arr.slice(start, start + len))
                    .map(b => b.toString(16).padStart(2, '0')).join(' ');

                // Check header
                const header = String.fromCharCode(data[0], data[1], data[2], data[3]);
                if (header !== 'RZX!') {
                    return { valid: false, error: 'Invalid header: ' + header };
                }

                console.log('[RZX VERIFY] Header: OK');
                console.log('[RZX VERIFY] Version:', data[4] + '.' + data[5]);
                console.log('[RZX VERIFY] Total size:', data.length, 'bytes');
                console.log('[RZX VERIFY] Header bytes:', hex(data, 0, 10));

                // Parse blocks
                let offset = 10;
                const blocks = [];
                while (offset < data.length - 5) {
                    const blockId = data[offset];
                    const blockLen = data[offset + 1] | (data[offset + 2] << 8) |
                                    (data[offset + 3] << 16) | (data[offset + 4] << 24);

                    const blockName = blockId === 0x10 ? 'Creator' :
                                     blockId === 0x30 ? 'Snapshot' :
                                     blockId === 0x80 ? 'Input' : `Unknown(0x${blockId.toString(16)})`;

                    console.log(`[RZX VERIFY] Block at ${offset}: ${blockName}, len=${blockLen}`);
                    console.log(`[RZX VERIFY]   Header bytes: ${hex(data, offset, Math.min(20, blockLen))}`);

                    if (blockId === 0x30) {
                        // Snapshot block details
                        const flags = data[offset + 5] | (data[offset + 6] << 8) |
                                     (data[offset + 7] << 16) | (data[offset + 8] << 24);
                        const ext = String.fromCharCode(data[offset + 9], data[offset + 10],
                                                       data[offset + 11], data[offset + 12]).replace(/\0/g, '');
                        console.log(`[RZX VERIFY]   Snapshot: flags=${flags}, ext="${ext}"`);
                        console.log(`[RZX VERIFY]   Snapshot data starts at offset ${offset + 13}, first bytes: ${hex(data, offset + 13, 16)}`);
                    }

                    if (blockId === 0x80) {
                        // Input block details
                        const numFrames = data[offset + 5] | (data[offset + 6] << 8) |
                                         (data[offset + 7] << 16) | (data[offset + 8] << 24);
                        const tstates = data[offset + 10] | (data[offset + 11] << 8) |
                                       (data[offset + 12] << 16) | (data[offset + 13] << 24);
                        const flags = data[offset + 14] | (data[offset + 15] << 8) |
                                     (data[offset + 16] << 16) | (data[offset + 17] << 24);
                        console.log(`[RZX VERIFY]   Input: frames=${numFrames}, tstates=${tstates}, flags=${flags}`);
                        console.log(`[RZX VERIFY]   Frame data starts at ${offset + 18}, first bytes: ${hex(data, offset + 18, 16)}`);
                    }

                    blocks.push({ id: blockId, offset, len: blockLen, name: blockName });

                    if (blockLen < 5 || offset + blockLen > data.length) {
                        return { valid: false, error: `Invalid block length at offset ${offset}` };
                    }
                    offset += blockLen;
                }

                console.log('[RZX VERIFY] Blocks found:', blocks.length);
                return { valid: true, blocks, size: data.length };
            } catch (e) {
                return { valid: false, error: e.message };
            }
        }

        /**
         * Download recorded RZX as a file
         * @param {string} filename - Optional filename (default: recording.rzx)
         */
        rzxDownloadRecording(filename = 'recording.rzx') {
            const data = this.rzxSaveRecording();
            if (!data) {
                console.warn('No RZX data to download');
                return;
            }

            const blob = new Blob([data], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log(`[RZX REC] Downloaded ${filename} (${data.length} bytes)`);
        }

        /**
         * Analyze RZX file structure (for debugging)
         * @param {Uint8Array} data - RZX file data, or uses last loaded RZX if not provided
         */
        rzxAnalyze(data) {
            // Use stored raw data from loaded RZX if no data provided
            if (!data && this.rzxData) {
                data = this.rzxData;
                console.log('[RZX ANALYZE] Using loaded RZX file data');
            } else if (!data && this.rzxPlayer && this.rzxPlayer.rawData) {
                data = this.rzxPlayer.rawData;
                console.log('[RZX ANALYZE] Using RZX player data');
            }

            if (!data) {
                console.log('[RZX ANALYZE] No data available - load an RZX file first');
                return;
            }

            const hex = (arr, start, len) => Array.from(arr.slice(start, start + len))
                .map(b => b.toString(16).padStart(2, '0')).join(' ');

            console.log('[RZX ANALYZE] File size:', data.length, 'bytes');
            console.log('[RZX ANALYZE] Header:', hex(data, 0, 10));
            console.log('[RZX ANALYZE] Signature:', String.fromCharCode(data[0], data[1], data[2], data[3]));
            console.log('[RZX ANALYZE] Version:', data[4], '.', data[5]);

            let offset = 10;
            let blockNum = 0;
            while (offset < data.length - 5) {
                const blockId = data[offset];
                const blockLen = data[offset + 1] | (data[offset + 2] << 8) |
                                (data[offset + 3] << 16) | (data[offset + 4] << 24);
                blockNum++;

                const blockName = blockId === 0x10 ? 'Creator' :
                                 blockId === 0x30 ? 'Snapshot' :
                                 blockId === 0x80 ? 'Input' : `Unknown(0x${blockId.toString(16)})`;

                console.log(`[RZX ANALYZE] Block #${blockNum}: ${blockName} at offset ${offset}, length ${blockLen}`);
                console.log(`[RZX ANALYZE]   Raw header: ${hex(data, offset, Math.min(24, blockLen))}`);

                if (blockId === 0x30) {
                    // Snapshot block - show structure
                    const flags = data[offset + 5] | (data[offset + 6] << 8) |
                                 (data[offset + 7] << 16) | (data[offset + 8] << 24);
                    const ext = String.fromCharCode(data[offset + 9], data[offset + 10],
                                                   data[offset + 11], data[offset + 12]).replace(/\0/g, '');
                    const compressed = (flags & 0x01) !== 0;
                    console.log(`[RZX ANALYZE]   Flags: ${flags} (compressed=${compressed})`);
                    console.log(`[RZX ANALYZE]   Extension: "${ext}"`);

                    // Check what's at offset 13 vs 17 (with/without UncompLen)
                    console.log(`[RZX ANALYZE]   Bytes at offset 13 (no UncompLen): ${hex(data, offset + 13, 8)}`);
                    console.log(`[RZX ANALYZE]   Bytes at offset 17 (with UncompLen): ${hex(data, offset + 17, 8)}`);

                    // If it's a Z80, show header
                    const snapStart = compressed ? offset + 17 : offset + 13;
                    console.log(`[RZX ANALYZE]   Snapshot data starts at file offset ${snapStart}`);
                    console.log(`[RZX ANALYZE]   Z80 header bytes: ${hex(data, snapStart, 32)}`);
                    // Check for v2/v3 (PC=0 at bytes 6-7)
                    const pc = data[snapStart + 6] | (data[snapStart + 7] << 8);
                    if (pc === 0) {
                        const extLen = data[snapStart + 30] | (data[snapStart + 31] << 8);
                        console.log(`[RZX ANALYZE]   Z80 v2/v3, extended header length: ${extLen}`);
                    } else {
                        console.log(`[RZX ANALYZE]   Z80 v1, PC=${pc.toString(16)}`);
                    }
                }

                if (blockId === 0x80) {
                    const numFrames = data[offset + 5] | (data[offset + 6] << 8) |
                                     (data[offset + 7] << 16) | (data[offset + 8] << 24);
                    const tstates = data[offset + 10] | (data[offset + 11] << 8) |
                                   (data[offset + 12] << 16) | (data[offset + 13] << 24);
                    const flags = data[offset + 14] | (data[offset + 15] << 8) |
                                 (data[offset + 16] << 16) | (data[offset + 17] << 24);
                    console.log(`[RZX ANALYZE]   Frames: ${numFrames}, T-states: ${tstates}, Flags: ${flags}`);
                    console.log(`[RZX ANALYZE]   Frame data starts at offset ${offset + 18}`);
                    // Show first few frames
                    let fOffset = offset + 18;
                    for (let i = 0; i < Math.min(3, numFrames) && fOffset < offset + blockLen; i++) {
                        const fetchCount = data[fOffset] | (data[fOffset + 1] << 8);
                        const inputCount = data[fOffset + 2] | (data[fOffset + 3] << 8);
                        console.log(`[RZX ANALYZE]   Frame ${i}: fetch=${fetchCount}, inputs=${inputCount}`);
                        fOffset += 4 + inputCount;
                    }
                }

                if (blockLen < 5 || offset + blockLen > data.length) {
                    console.log('[RZX ANALYZE] ERROR: Invalid block length!');
                    break;
                }
                offset += blockLen;
            }
        }

        // Port I/O logging for debugging
        setPortLogEnabled(enabled) {
            this.portLogEnabled = enabled;
            if (enabled) {
                this.portLog = []; // Clear log when enabling
            }
        }

        isPortLogEnabled() {
            return this.portLogEnabled;
        }

        getPortLogCount() {
            return this.portLog.length;
        }

        exportPortLog(filter = 'both') {
            const lines = ['Dir\tPort\tValue\tPC\tSrc\tFrame\tT-states'];
            let count = 0;
            for (const entry of this.portLog) {
                // Apply filter
                if (filter === 'in' && entry.dir !== 'IN') continue;
                if (filter === 'out' && entry.dir !== 'OUT') continue;
                const frameStr = entry.frame >= 0 ? entry.frame : '-';
                const src = entry.src || '';
                lines.push(`${entry.dir}\t${hex16(entry.port)}\t${hex8(entry.value)}\t${hex16(entry.pc)}\t${src}\t${frameStr}\t${entry.t}`);
                count++;
            }
            return { text: lines.join('\n'), count };
        }

        clearPortLog() {
            this.portLog = [];
        }

        // ========== Port Trace Filters ==========

        addPortTraceFilter(spec) {
            if (typeof spec === 'string') {
                const parsed = this.parsePortSpec(spec);
                if (!parsed) return null;
                spec = parsed;
            }
            // Dedup: don't add if same port+mask already exists
            for (const f of this.portTraceFilters) {
                if (f.port === spec.port && f.mask === spec.mask) return f;
            }
            const entry = { port: spec.port, mask: spec.mask };
            this.portTraceFilters.push(entry);
            return entry;
        }

        removePortTraceFilter(index) {
            if (index >= 0 && index < this.portTraceFilters.length) {
                this.portTraceFilters.splice(index, 1);
            }
        }

        clearPortTraceFilters() {
            this.portTraceFilters = [];
        }

        getPortTraceFilters() {
            return this.portTraceFilters;
        }

        getPortSource() {
            const pc = this.cpu.pc;
            if (pc >= SLOT1_START) return '';
            const mem = this.memory;
            if (mem.specialPagingMode) return 'RAM';
            if (mem.if1Active) return 'IF1';
            if (mem.trdosActive) return 'TRDOS';
            if (mem.isBeta48RomAt && mem.isBeta48RomAt(pc)) return 'TRDOS';
            if (mem.ramInRomMode || mem.scorpionRamInRomMode) return 'RAM';
            return 'ROM:' + mem.currentRomBank;
        }

        matchesPortTraceFilter(port) {
            if (this.portTraceFilters.length === 0) return true;
            for (const f of this.portTraceFilters) {
                if ((port & f.mask) === (f.port & f.mask)) return true;
            }
            return false;
        }

        // ========== Auto-Mapping ==========

        // Page label for an address under the current paging (or null = unpaged, i.e.
        // fixed RAM 0x4000-0xBFFF and all of 48K). The single source of truth shared by
        // getAutoMapKey (rich mode) and the paged fast bitsets, so their page identity
        // can never diverge. ROM banks are prefixed 'R'; RAM pages are bare numbers.
        //
        // Slots 1 and 2 are normally banks 5 and 2 and never move, so they get no suffix
        // and their coverage lands in the default entry. Under +2A/+3 special paging
        // every slot comes from specialBanks and they DO move — config 3 puts bank 7 at
        // 0x4000 where configs 1-2 put bank 5 — so all four are labelled there, or the
        // default entry would union two different banks at one address, which is the
        // exact collapse paged mode exists to stop.
        _autoMapPage(addr) {
            const mem = this.memory;
            if (mem.machineType === '48k') return null;
            // +2A/+3 special paging: all 4 slots are RAM, none of them fixed
            if (mem.specialPagingMode) return String(mem.specialBanks[addr >> 14]);
            // 128K/Pentagon: track pages for ROM and paged RAM
            if (addr < SLOT1_START) {
                // Pentagon 1024 / Scorpion: RAM page 0 mapped over ROM
                if (mem.ramInRomMode || mem.scorpionRamInRomMode) return '0';
                // ROM (includes TR-DOS, IF1, +D, Opus overlays — all are ROM code)
                return 'R' + mem.currentRomBank;
            } else if (addr >= SLOT3_START) {
                // Paged RAM at slot 3
                return String(mem.currentRamBank);
            }
            // Fixed RAM (4000-BFFF) - no page suffix
            return null;
        }

        // Auto-map, provenance, indirect jumps and the call graph live in
        // core/debug-instrument.js and are mixed into this prototype below.

        getAutoMapStats() {
            return {
                executed: this.autoMap.executed.size,
                read: this.autoMap.read.size,
                written: this.autoMap.written.size
            };
        }

        // Get all auto-map data for region generation
        getAutoMapData() {
            return {
                executed: new Map(this.autoMap.executed),
                read: new Map(this.autoMap.read),
                written: new Map(this.autoMap.written)
            };
        }

        // Restore auto-map data (from project load)
        setAutoMapData(data) {
            this.autoMap.executed = new Map(data.executed);
            this.autoMap.read = new Map(data.read);
            this.autoMap.written = new Map(data.written);
        }

        // ========== Static Code-Flow Analysis ==========

        /**
         * Classify a disassembled instruction's control flow.
         * @param {string} mnemonic - Instruction mnemonic string
         * @param {Array} refs - Refs array from disassembler (may be undefined)
         * @returns {{ flow: string, unconditional: boolean, target: number|null, indirect: boolean }}
         */
        _classifyInstruction(mnemonic, refs) {
            const m = mnemonic.trim();
            const target = (refs && refs.length > 0) ? refs[0].target : null;

            // RET / RETI / RETN
            if (m === 'RET' || m === 'RETI' || m === 'RETN') {
                return { flow: 'ret', unconditional: true, target: null, indirect: false };
            }
            if (m.startsWith('RET ')) {
                return { flow: 'ret', unconditional: false, target: null, indirect: false };
            }

            // HALT
            if (m === 'HALT') {
                return { flow: 'halt', unconditional: true, target: null, indirect: false };
            }

            // JP (HL) / JP (IX) / JP (IY)
            if (m === 'JP (HL)' || m === 'JP (IX)' || m === 'JP (IY)') {
                return { flow: 'branch', unconditional: true, target: null, indirect: true };
            }

            // RST xx
            if (m.startsWith('RST ')) {
                return { flow: 'rst', unconditional: true, target: target, indirect: false };
            }

            // DJNZ
            if (m.startsWith('DJNZ')) {
                return { flow: 'branch', unconditional: false, target: target, indirect: false };
            }

            const ccRegex = /^(NZ|Z|NC|C|PO|PE|P|M),/i;

            // JP / JR
            if (m.startsWith('JP ') || m.startsWith('JR ')) {
                const keyword = m.startsWith('JP') ? 'JP ' : 'JR ';
                const rest = m.substring(keyword.length);
                const conditional = ccRegex.test(rest);
                return { flow: 'branch', unconditional: !conditional, target: target, indirect: false };
            }

            // CALL
            if (m.startsWith('CALL ')) {
                const rest = m.substring(5);
                const conditional = ccRegex.test(rest);
                return { flow: 'call', unconditional: !conditional, target: target, indirect: false };
            }

            // Everything else
            return { flow: 'linear', unconditional: true, target: null, indirect: false };
        }

        /**
         * Check if an address should be skipped during code-flow analysis.
         */
        _cfaShouldSkip(addr, skipRom, visited, isDataRegion) {
            if (addr < 0 || addr > 0xFFFF) return true;  // 0xFFFF = 16-bit address space limit
            if (visited.has(addr)) return true;
            if (skipRom && addr < SLOT1_START) return true;
            if (isDataRegion && isDataRegion(addr)) return true;
            return false;
        }

        /**
         * Static code-flow analysis via recursive descent disassembly.
         * Follows control flow from entry points to identify code regions,
         * subroutine entries, and cross-references.
         *
         * @param {Object} options
         * @param {number[]} options.entryPoints - Starting addresses
         * @param {boolean} [options.skipRom=true] - Skip ROM area (0x0000-0x3FFF)
         * @param {function} [options.isDataRegion] - Callback: addr => bool
         * @param {function} [options.onProgress] - Callback: (processed, queued) => void
         * @param {number} [options.maxInstructions=100000] - Safety limit
         * @returns {Promise<{codeAddresses: Set, callTargets: Set, xrefs: Array, indirectJumps: Array, warnings: Array}>}
         */
        async analyzeCodeFlow(options) {
            const {
                entryPoints = [],
                skipRom = true,
                isDataRegion = null,
                onProgress = null,
                maxInstructions = 100000
            } = options;

            const visited = new Set();
            const codeAddresses = new Set();
            const callTargets = new Set();
            const xrefs = [];
            const indirectJumps = [];
            const warnings = [];

            // BFS queue — seed with entry points
            const queue = [];
            for (const ep of entryPoints) {
                const addr = ep & 0xFFFF;
                if (!this._cfaShouldSkip(addr, skipRom, visited, isDataRegion)) {
                    queue.push(addr);
                }
            }

            const disasm = new Disassembler(this.memory);
            let processed = 0;
            let lastYield = Date.now();

            while (queue.length > 0) {
                if (processed >= maxInstructions) {
                    warnings.push(`Stopped after ${maxInstructions} instructions (safety limit)`);
                    break;
                }

                const startAddr = queue.shift();
                if (this._cfaShouldSkip(startAddr, skipRom, visited, isDataRegion)) {
                    continue;
                }

                // Walk linearly from startAddr
                let pc = startAddr;
                while (pc <= 0xFFFF) {
                    if (this._cfaShouldSkip(pc, skipRom, visited, isDataRegion)) {
                        break;
                    }
                    if (processed >= maxInstructions) break;

                    visited.add(pc);
                    const result = disasm.disassemble(pc, true);
                    processed++;

                    // Mark all instruction bytes as code
                    for (let i = 0; i < result.length; i++) {
                        codeAddresses.add((pc + i) & 0xFFFF);
                    }

                    // Collect refs as xrefs
                    if (result.refs) {
                        for (const ref of result.refs) {
                            xrefs.push({ from: pc, target: ref.target, type: ref.type });
                        }
                    }

                    const classified = this._classifyInstruction(result.mnemonic, result.refs);

                    if (classified.flow === 'ret') {
                        // Unconditional ret: end path; conditional ret: continue fall-through
                        if (classified.unconditional) break;
                        pc = (pc + result.length) & 0xFFFF;
                    } else if (classified.flow === 'halt') {
                        break;
                    } else if (classified.indirect) {
                        // JP (HL)/(IX)/(IY) — cannot follow
                        indirectJumps.push(pc);
                        warnings.push(`Indirect jump at $${hex16(pc)}: ${result.mnemonic}`);
                        break;
                    } else if (classified.flow === 'branch') {
                        if (classified.target !== null && !this._cfaShouldSkip(classified.target, skipRom, visited, isDataRegion)) {
                            queue.push(classified.target);
                        }
                        if (classified.unconditional) {
                            break; // No fall-through
                        }
                        pc = (pc + result.length) & 0xFFFF;
                    } else if (classified.flow === 'call') {
                        if (classified.target !== null) {
                            callTargets.add(classified.target);
                            if (!this._cfaShouldSkip(classified.target, skipRom, visited, isDataRegion)) {
                                queue.push(classified.target);
                            }
                        }
                        pc = (pc + result.length) & 0xFFFF;
                    } else if (classified.flow === 'rst') {
                        if (classified.target !== null) {
                            callTargets.add(classified.target);
                            if (classified.target === 0) {
                                // RST 0 = reset, end path
                                break;
                            }
                            if (!this._cfaShouldSkip(classified.target, skipRom, visited, isDataRegion)) {
                                queue.push(classified.target);
                            }
                        }
                        pc = (pc + result.length) & 0xFFFF;
                    } else {
                        // Linear
                        pc = (pc + result.length) & 0xFFFF;
                    }

                    // Yield to UI every 20ms
                    const now = Date.now();
                    if (now - lastYield >= 20) {
                        if (onProgress) onProgress(processed, queue.length);
                        await new Promise(r => setTimeout(r, 0));
                        lastYield = Date.now();
                    }
                }
            }

            if (onProgress) onProgress(processed, 0);

            return { codeAddresses, callTargets, xrefs, indirectJumps, warnings };
        }

        // ========== Utility ==========

        getFps() { return this.actualFps; }
        isRunning() { return this.running; }

        // ========== Audio ==========

        /**
         * Initialize audio system (must be called from user interaction)
         */
        initAudio() {
            if (this.audio) return this.audio;
            this.audio = new AudioManager(this.ay, this.timing);
            return this.audio;
        }

        /**
         * Get audio manager (may be null if not initialized)
         */
        getAudio() {
            return this.audio;
        }
    }

    /**
     * AudioManager - Handles Web Audio output for AY chip using AudioWorklet
     */
    class AudioManager {
        constructor(ay, timing) {
            this.ay = ay;
            this.timing = timing;
            this.context = null;
            this.gainNode = null;
            this.workletNode = null;
            this.enabled = false;
            this.volume = 0.5;
            this.muted = false;

            // Buffer for batching samples to send to worklet
            this.sendBufferSize = 512;
            this.sendBufferL = new Float32Array(this.sendBufferSize);
            this.sendBufferR = new Float32Array(this.sendBufferSize);
            this.sendBufferPos = 0;

            // Timing
            this.sampleRate = 44100;
            this.cpuClock = timing.cpuClock || 3500000;
            this.ayClock = ay.clockRate;

            // Samples per frame at 50Hz
            this.samplesPerFrame = Math.floor(this.sampleRate / 50);

            // CPU cycles per audio sample
            this.cyclesPerSample = this.cpuClock / this.sampleRate;

            // AY cycles per CPU cycle (AY runs at ~half CPU speed)
            this.ayPerCpu = this.ayClock / this.cpuClock;
        }

        /**
         * Start audio output using AudioWorklet (or ScriptProcessorNode fallback)
         */
        async start() {
            if (this.context) return;

            try {
                this.context = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: this.sampleRate
                });

                // Update sample rate if browser chose different
                this.sampleRate = this.context.sampleRate;
                this.samplesPerFrame = Math.floor(this.sampleRate / 50);
                this.cyclesPerSample = this.cpuClock / this.sampleRate;

                // Create gain node for volume control
                this.gainNode = this.context.createGain();
                this.gainNode.gain.value = this.muted ? 0 : this.volume;
                this.gainNode.connect(this.context.destination);

                if (this.context.audioWorklet) {
                    // Modern path: AudioWorklet (requires secure context)
                    await this.context.audioWorklet.addModule('core/audio-processor.js');
                    this.workletNode = new AudioWorkletNode(this.context, 'zx-audio-processor', {
                        numberOfInputs: 0,
                        numberOfOutputs: 1,
                        outputChannelCount: [2]
                    });
                    this.workletNode.connect(this.gainNode);
                } else {
                    // Fallback: ScriptProcessorNode (works over plain HTTP)
                    this._initScriptProcessor();
                }

                // Resume context (may be suspended due to autoplay policy)
                if (this.context.state === 'suspended') {
                    await this.context.resume();
                }

                this.enabled = true;
            } catch (e) {
                console.error('Failed to initialize audio:', e);
                this.enabled = false;
            }
        }

        /**
         * Initialize ScriptProcessorNode fallback for non-secure contexts
         */
        _initScriptProcessor() {
            const bufferSize = 8192;
            const ringL = new Float32Array(bufferSize);
            const ringR = new Float32Array(bufferSize);
            let writePos = 0;
            let readPos = 0;

            this.scriptNode = this.context.createScriptProcessor(2048, 0, 2);
            this.scriptNode.onaudioprocess = (e) => {
                const outL = e.outputBuffer.getChannelData(0);
                const outR = e.outputBuffer.getChannelData(1);
                for (let i = 0; i < outL.length; i++) {
                    if (readPos !== writePos) {
                        outL[i] = ringL[readPos];
                        outR[i] = ringR[readPos];
                        readPos = (readPos + 1) % bufferSize;
                    } else {
                        outL[i] = 0;
                        outR[i] = 0;
                    }
                }
            };
            this.scriptNode.connect(this.gainNode);

            // Expose write function for flushSamples
            this._scriptRing = { ringL, ringR, bufferSize };
            this._scriptWritePos = () => writePos;
            this._scriptWrite = (left, right) => {
                for (let i = 0; i < left.length; i++) {
                    ringL[writePos] = left[i];
                    ringR[writePos] = right[i];
                    writePos = (writePos + 1) % bufferSize;
                }
            };
        }

        /**
         * Stop audio output
         */
        stop() {
            if (this.workletNode) {
                this.workletNode.disconnect();
                this.workletNode = null;
            }
            if (this.scriptNode) {
                this.scriptNode.disconnect();
                this.scriptNode = null;
                this._scriptWrite = null;
                this._scriptRing = null;
                this._scriptWritePos = null;
            }
            if (this.gainNode) {
                this.gainNode.disconnect();
                this.gainNode = null;
            }
            if (this.context) {
                this.context.close();
                this.context = null;
            }
            this.enabled = false;
        }

        /**
         * Set volume (0-1)
         */
        setVolume(vol) {
            this.volume = Math.max(0, Math.min(1, vol));
            if (this.gainNode && !this.muted) {
                this.gainNode.gain.value = this.volume;
            }
        }

        /**
         * Set mute state
         */
        setMuted(muted) {
            this.muted = muted;
            if (this.gainNode) {
                this.gainNode.gain.value = muted ? 0 : this.volume;
            }
        }

        /**
         * Toggle mute
         */
        toggleMute() {
            this.setMuted(!this.muted);
            return this.muted;
        }

        /**
         * Send buffered samples to audio output
         */
        flushSamples() {
            if (this.sendBufferPos === 0) return;

            if (this.workletNode) {
                this.workletNode.port.postMessage({
                    left: this.sendBufferL.slice(0, this.sendBufferPos),
                    right: this.sendBufferR.slice(0, this.sendBufferPos)
                });
            } else if (this._scriptWrite) {
                this._scriptWrite(
                    this.sendBufferL.slice(0, this.sendBufferPos),
                    this.sendBufferR.slice(0, this.sendBufferPos)
                );
            } else {
                this.sendBufferPos = 0;
                return;
            }
            this.sendBufferPos = 0;
        }

        /**
         * Process one frame of audio
         * Called at end of each emulated frame
         * @param {number} frameTstates - T-states in this frame
         * @param {Array} beeperChanges - Array of {tStates, level} beeper state changes
         * @param {number} beeperLevel - Final beeper level at end of frame
         * @param {Array} tapeAudioChanges - Array of {tStates, level} tape signal changes
         */
        processFrame(frameTstates, beeperChanges = [], beeperLevel = 0, tapeAudioChanges = [], ayChanges = [], aySnapshot = null, extra = null) {
            // TurboSound's second AY and the DAC channels (see Spectrum constructor)
            const ay2 = extra && extra.ay2;
            const dacChanges = (extra && extra.dacChanges) || [];
            const dacOn = !!(extra && extra.dacOn);
            const dac = extra && extra.dacStart ? extra.dacStart.slice() : [0x80, 0x80, 0x80, 0x80];
            let dacIdx = 0;
            const DAC_VOLUME = 0.5;
            // SAA1099: its writes are played into the chip here, at their T-state
            const saa = extra && extra.saa;
            const saaChanges = (extra && extra.saaChanges) || [];
            let saaIdx = 0;
            const SAA_VOLUME = 1.0;
            const saaWrite = (c) => { if (c.addr) saa.writeAddress(c.value); else saa.writeData(c.value); };
            // General Sound: its DAC levels, changed at Spectrum frame T-states
            const gs = extra && extra.gs;
            const gsChanges = gs ? gs.changes : [];
            let gsIdx = 0, gsL = gs ? gs.startLevel[0] : 0, gsR = gs ? gs.startLevel[1] : 0;
            const GS_VOLUME = 1.0;
            if (ay2 && extra.ay2Snapshot) ay2.importState(extra.ay2Snapshot);
            if (!this.enabled || (!this.workletNode && !this.scriptNode)) {
                return;                 // (Spectrum._saaFlush gives the chip its writes)
            }

            // Restore the AY to its start-of-frame state so the timestamped register
            // writes can be replayed at the right T-state during the sample loop. The
            // chip is only stepped here, so without this the whole frame would render
            // with the final register values (which destroys digitized speech).
            if (this.ay && aySnapshot) {
                this.ay.importState(aySnapshot);
            }
            let ayIdx = 0;

            // Generate samples for this frame
            const samplesToGenerate = this.samplesPerFrame;

            // CPU cycles per sample for this frame
            const cyclesPerSample = frameTstates / samplesToGenerate;

            // AY steps per sample
            const ayStepsPerSample = this.ay ? cyclesPerSample * this.ayPerCpu : 0;
            const saaClocksPerSample = SAA_CLOCK / this.sampleRate;
            // TurboSound FM: two YM2203 FM halves, one FM sample per 72 master
            // clocks (12 operator slots x the /6 prescale); their writes played
            // in at their T-state, as the AY's and the SAA's are
            const fm = extra && extra.fm, fmOn = !!(extra && extra.fmOn);
            const fmChanges = (extra && extra.fmChanges) || [];
            let fmIdx = 0, fmAcc = this._fmAcc || 0, fmLast = this._fmLast || 0;
            // The master clock follows the machine, so it is handed over in `extra`
            // like every other value here: `this` is the AUDIO object, which has no
            // _fmMasterClock -- reaching for one threw on every frame, with or
            // without TS-FM, and only where audio is really running (so no suite saw it).
            const fmPerSample = fm ? (extra.fmClock || 3546900) / 72 / this.sampleRate : 0;
            const FM_GAIN = 0.7 * 0.333 / 16382;     // a TL 0 carrier = one AY channel at 15

            // Audio levels
            const BEEPER_VOLUME = 0.5;
            const TAPE_VOLUME = 0.5;  // Tape loading sound

            // Only process beeper if there are changes (otherwise it's silent)
            const hasBeeperActivity = beeperChanges.length > 0;
            const hasTapeAudio = tapeAudioChanges.length > 0;

            // Track beeper state for this frame
            let beeperIdx = 0;
            let currentBeeperLevel = beeperLevel;
            if (hasBeeperActivity && beeperChanges[0].tStates === 0) {
                currentBeeperLevel = beeperChanges[0].level;
            }

            // Track tape audio state for this frame
            let tapeIdx = 0;
            let currentTapeLevel = 0;
            if (hasTapeAudio && tapeAudioChanges[0].tStates === 0) {
                currentTapeLevel = tapeAudioChanges[0].level;
            }

            for (let i = 0; i < samplesToGenerate; i++) {
                // Calculate T-state for this sample
                const sampleTstates = (i + 0.5) * cyclesPerSample;

                // Update beeper level based on changes
                while (beeperIdx < beeperChanges.length &&
                       beeperChanges[beeperIdx].tStates <= sampleTstates) {
                    currentBeeperLevel = beeperChanges[beeperIdx].level;
                    beeperIdx++;
                }

                // Update tape level based on changes
                while (tapeIdx < tapeAudioChanges.length &&
                       tapeAudioChanges[tapeIdx].tStates <= sampleTstates) {
                    currentTapeLevel = tapeAudioChanges[tapeIdx].level;
                    tapeIdx++;
                }

                // Get AY sample (if AY is available)
                let left = 0, right = 0;
                if (this.ay) {
                    // Apply any AY register writes that occurred up to this sample's
                    // T-state, then step. This reproduces intra-frame volume changes.
                    while (ayIdx < ayChanges.length && ayChanges[ayIdx].tStates <= sampleTstates) {
                        const c = ayChanges[ayIdx];
                        if (c.chip === 1) { if (ay2) ay2.setRegisterForReplay(c.reg, c.value); }
                        else this.ay.setRegisterForReplay(c.reg, c.value);
                        ayIdx++;
                    }
                    this.ay.stepMultiple(Math.round(ayStepsPerSample));
                    [left, right] = this.ay.getAveragedSample();
                    if (ay2) {
                        // two chips: each at 0.7, so a pair at full tilt stays in range
                        ay2.stepMultiple(Math.round(ayStepsPerSample));
                        const [l2, r2] = ay2.getAveragedSample();
                        left = (left + l2) * 0.7;
                        right = (right + r2) * 0.7;
                    }
                }

                if (saa) {
                    while (saaIdx < saaChanges.length && saaChanges[saaIdx].tStates <= sampleTstates) saaWrite(saaChanges[saaIdx++]);
                    const [sl, sr] = saa.run(saaClocksPerSample);
                    left += sl * SAA_VOLUME;
                    right += sr * SAA_VOLUME;
                }

                if (fm) {
                    while (fmIdx < fmChanges.length && fmChanges[fmIdx].tStates <= sampleTstates) {
                        const c = fmChanges[fmIdx++];
                        if (c.reg < 0) fm[c.chip].csmKeyOn(); else fm[c.chip].write(c.reg, c.value);
                    }
                    fmAcc += fmPerSample;
                    let sum = 0, n = 0;
                    while (fmAcc >= 1) { sum += fm[0].clock() + fm[1].clock(); n++; fmAcc -= 1; }
                    if (n) fmLast = sum / n;
                    if (fmOn) { left += fmLast * FM_GAIN; right += fmLast * FM_GAIN; }
                }

                if (gs) {
                    while (gsIdx < gsChanges.length && gsChanges[gsIdx].t <= sampleTstates) {
                        gsL = gsChanges[gsIdx].l; gsR = gsChanges[gsIdx].r; gsIdx++;
                    }
                    left += gsL * GS_VOLUME;
                    right += gsR * GS_VOLUME;
                }

                // DAC: channels 0/1 left, 2/3 right; $80 is silence
                if (dacOn) {
                    while (dacIdx < dacChanges.length && dacChanges[dacIdx].tStates <= sampleTstates) {
                        const d = dacChanges[dacIdx++];
                        if (d.ch === 4) dac.fill(d.value);
                        else if (d.ch === 5) { dac[0] = dac[1] = d.value; }
                        else if (d.ch === 6) { dac[2] = dac[3] = d.value; }
                        else dac[d.ch] = d.value;
                    }
                    left += ((dac[0] - 128) + (dac[1] - 128)) / 256 * DAC_VOLUME;
                    right += ((dac[2] - 128) + (dac[3] - 128)) / 256 * DAC_VOLUME;
                }

                // Add beeper to both channels (mono beeper) - only when active
                if (hasBeeperActivity) {
                    const beeperSample = (currentBeeperLevel * 2 - 1) * BEEPER_VOLUME;
                    left += beeperSample;
                    right += beeperSample;
                }

                // Add tape audio - only when tape is playing
                if (hasTapeAudio) {
                    const tapeSample = (currentTapeLevel * 2 - 1) * TAPE_VOLUME;
                    left += tapeSample;
                    right += tapeSample;
                }

                // Clamp to [-1, 1] range
                left = Math.max(-1, Math.min(1, left));
                right = Math.max(-1, Math.min(1, right));

                // Add to send buffer
                this.sendBufferL[this.sendBufferPos] = left;
                this.sendBufferR[this.sendBufferPos] = right;
                this.sendBufferPos++;

                // Flush when buffer is full
                if (this.sendBufferPos >= this.sendBufferSize) {
                    this.flushSamples();
                }
            }

            // Apply any AY writes that landed after the last sample point, so the chip
            // ends the frame at the final register state (matches immediate-write state).
            if (this.ay) {
                while (ayIdx < ayChanges.length) {
                    const c = ayChanges[ayIdx];
                    if (c.chip === 1) { if (ay2) ay2.setRegisterForReplay(c.reg, c.value); }
                    else this.ay.setRegisterForReplay(c.reg, c.value);
                    ayIdx++;
                }
            }

            if (saa) { while (saaIdx < saaChanges.length) saaWrite(saaChanges[saaIdx++]); saaChanges.length = 0; }
            if (fm) {
                while (fmIdx < fmChanges.length) {
                    const c = fmChanges[fmIdx++];
                    if (c.reg < 0) fm[c.chip].csmKeyOn(); else fm[c.chip].write(c.reg, c.value);
                }
                fmChanges.length = 0;
                this._fmAcc = fmAcc; this._fmLast = fmLast;
            }

            // Flush remaining samples at end of frame
            this.flushSamples();
        }

        /**
         * Play a short burst of AY sound from current register state.
         * Used during debug stepping to hear AY output.
         * @param {number} durationMs - Duration in milliseconds (default 20)
         */
        playAyBurst(durationMs = 40) {
            if (!this.ay || !this.enabled || (!this.workletNode && !this.scriptNode)) return;
            // Resume audio context if suspended (browser autoplay policy)
            if (this.context && this.context.state === 'suspended') {
                this.context.resume();
            }
            const samples = Math.floor(this.sampleRate * durationMs / 1000);
            const ayStepsPerSample = this.cyclesPerSample * this.ayPerCpu;
            // Save AY state so we don't advance it permanently
            const savedState = this.ay.exportState();
            // Clear stale accumulator from previous processFrame
            this.ay.sampleAccumulator[0] = 0;
            this.ay.sampleAccumulator[1] = 0;
            this.ay.sampleCount = 0;
            for (let i = 0; i < samples; i++) {
                this.ay.stepMultiple(Math.round(ayStepsPerSample));
                const [left, right] = this.ay.getAveragedSample();
                this.sendBufferL[this.sendBufferPos] = Math.max(-1, Math.min(1, left));
                this.sendBufferR[this.sendBufferPos] = Math.max(-1, Math.min(1, right));
                this.sendBufferPos++;
                if (this.sendBufferPos >= this.sendBufferSize) {
                    this.flushSamples();
                }
            }
            this.flushSamples();
            // Restore AY state
            this.ay.importState(savedState);
        }

        /**
         * Resume audio context (call from user interaction)
         */
        async resume() {
            if (this.context && this.context.state === 'suspended') {
                await this.context.resume();
            }
        }
    }


// The observation surface — auto-map coverage, read/write/exec provenance,
// resolved indirect jumps and the runtime call graph — lives in
// debug-instrument.js. Mixed into the prototype here, so every call site
// (including window.zxDebug) keeps calling them as ordinary Spectrum methods.
Object.assign(Spectrum.prototype, DebugInstrumentation);

// Keyboard, joysticks, mouse and gamepad - see core/input.js.
Object.assign(Spectrum.prototype, InputHandling);
