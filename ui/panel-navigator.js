// Panel navigation — switching panel types, address navigation, go-to functions
import { fmtAddr, onNumberBaseChange } from '../core/addr-format.js';
import { registerCalcHost, refreshCalcHost } from './calc-host.js';

export function initPanelNavigator({
    getSpectrum, getDisasm,
    getLeftPanelType, setLeftPanelType,
    getRightPanelType, setRightPanelType,
    getDisasmViewAddress, setDisasmViewAddress,
    getRightDisasmViewAddress, setRightDisasmViewAddress,
    getMemoryViewAddress, setMemoryViewAddress,
    getLeftMemoryViewAddress, setLeftMemoryViewAddress,
    getLeftBookmarks, getRightBookmarks,
    navPushHistory, getLeftHistory, getRightHistory,
    getUpdateBookmarkButtons,
    updateDebugger, getUpdateRightDisassemblyView,
    getUpdateMemoryView, getUpdateLeftMemoryView,
    DISASM_LINES, DISASM_PC_POSITION
}) {
    // Late-bound wrappers for memory view functions (initialized after this module)
    const updateMemoryView = (...args) => getUpdateMemoryView()(...args);
    const updateLeftMemoryView = (...args) => getUpdateLeftMemoryView()(...args);

    // DOM elements (discovered internally)
    const leftPanelTypeSelect = document.getElementById('leftPanelType');
    const rightPanelTypeSelect = document.getElementById('rightPanelType');
    const leftMemAddressInput = document.getElementById('leftMemAddress');
    const leftMemoryView = document.getElementById('leftMemoryView');
    const rightDisasmAddressInput = document.getElementById('rightDisasmAddress');
    const rightDisassemblyView = document.getElementById('rightDisassemblyView');
    const disasmAddressInput = document.getElementById('disasmAddress');
    const memoryAddressInput = document.getElementById('memoryAddress');
    const disasmBookmarksBar = document.getElementById('disasmBookmarks');
    const memoryBookmarksBar = document.getElementById('memoryBookmarks');

    // This panel is the calculator's home. Registering first makes it the winner
    // when both hosts are somehow on screen, which is also where it parks.
    registerCalcHost(document.getElementById('rightCalculatorView'),
                     () => getRightPanelType() === 'calc');

    // ========== Panel Type Switching ==========
    function switchLeftPanelType(type) {
        setLeftPanelType(type);
        leftPanelTypeSelect.value = type;

        const disasmControls = document.querySelector('.left-disasm-controls');
        const memdumpControls = document.querySelector('.left-memdump-controls');
        const disasmView = document.getElementById('disassemblyView');
        const leftStepControls = document.querySelector('.left-debugger-controls');
        const leftSearch = document.querySelector('.left-memory-search');

        if (type === 'disasm') {
            disasmControls.style.display = '';
            memdumpControls.style.display = 'none';
            disasmView.style.display = '';
            leftMemoryView.style.display = 'none';
            if (leftStepControls) leftStepControls.style.display = '';
            if (leftSearch) leftSearch.style.display = 'none';
        } else {
            disasmControls.style.display = 'none';
            memdumpControls.style.display = '';
            disasmView.style.display = 'none';
            leftMemoryView.style.display = '';
            if (leftStepControls) leftStepControls.style.display = 'none';
            if (leftSearch) leftSearch.style.display = '';
        }

        updateLeftPanel();
        getUpdateBookmarkButtons()(disasmBookmarksBar, getLeftBookmarks(), 'left');
    }

    function switchRightPanelType(type) {
        setRightPanelType(type);
        rightPanelTypeSelect.value = type;

        const memdumpControls = document.querySelector('.right-memdump-controls');
        const disasmControls = document.querySelector('.right-disasm-controls');
        const memView = document.getElementById('memoryView');
        const rightSearch = document.querySelector('.right-memory-search');
        const rightStepControls = document.querySelector('.right-debugger-controls');
        const calcView = document.getElementById('rightCalculatorView');
        const bookmarksBar = document.getElementById('memoryBookmarks');

        // Hide all views first
        memView.style.display = 'none';
        rightDisassemblyView.style.display = 'none';
        calcView.style.display = 'none';
        memdumpControls.style.display = 'none';
        disasmControls.style.display = 'none';
        if (rightSearch) rightSearch.style.display = 'none';
        if (rightStepControls) rightStepControls.style.display = 'none';

        if (type === 'memdump') {
            memdumpControls.style.display = '';
            memView.style.display = '';
            if (rightSearch) rightSearch.style.display = '';
            if (bookmarksBar) bookmarksBar.style.display = '';
        } else if (type === 'disasm') {
            disasmControls.style.display = '';
            rightDisassemblyView.style.display = '';
            if (rightStepControls) rightStepControls.style.display = '';
            if (bookmarksBar) bookmarksBar.style.display = '';
            // Initialize to current PC if not set
            const spectrum = getSpectrum();
            if (getRightDisasmViewAddress() === null && spectrum.cpu) {
                setRightDisasmViewAddress(spectrum.cpu.pc);
                rightDisasmAddressInput.value = fmtAddr(spectrum.cpu.pc);
            }
        } else if (type === 'calc') {
            calcView.style.display = '';
            if (bookmarksBar) bookmarksBar.style.display = '';
        }

        // The assembler's split pane may be holding the calculator — claim it back
        refreshCalcHost();
        updateRightPanel();
        getUpdateBookmarkButtons()(memoryBookmarksBar, getRightBookmarks(), 'right');
    }

    // Update left panel content based on type
    function updateLeftPanel() {
        if (getLeftPanelType() === 'disasm') {
            // Handled by existing updateDisassemblyView
        } else {
            updateLeftMemoryView();
        }
    }

    // Update right panel content based on type
    function updateRightPanel() {
        if (getRightPanelType() === 'memdump') {
            updateMemoryView();
        } else {
            getUpdateRightDisassemblyView()();
        }
    }

    // Panel-specific navigation functions
    function goToLeftMemory(addr) {
        addr = addr & 0xffff;
        switchLeftPanelType('memdump');
        setLeftMemoryViewAddress(addr);
        leftMemAddressInput.value = fmtAddr(addr);
        updateLeftMemoryView();
    }

    function goToRightMemory(addr) {
        addr = addr & 0xffff;
        switchRightPanelType('memdump');
        setMemoryViewAddress(addr);
        memoryAddressInput.value = fmtAddr(addr);
        updateMemoryView();
    }

    function goToLeftDisasm(addr) {
        addr = addr & 0xffff;
        if (getLeftHistory().history.length === 0) {
            const currentAddr = getDisasmViewAddress();
            const spectrum = getSpectrum();
            if (currentAddr !== null) {
                navPushHistory(currentAddr, 'left');
            } else if (spectrum && spectrum.cpu) {
                navPushHistory(spectrum.cpu.pc, 'left');
            }
        }
        navPushHistory(addr, 'left');
        const disasm = getDisasm();
        if (disasm) {
            setDisasmViewAddress(disasm.findStartForPosition(addr, DISASM_PC_POSITION, DISASM_LINES));
        } else {
            setDisasmViewAddress(addr);
        }
        disasmAddressInput.value = fmtAddr(addr);
        switchLeftPanelType('disasm');
        updateDebugger();
    }

    function goToRightDisasm(addr) {
        addr = addr & 0xffff;
        if (getRightHistory().history.length === 0) {
            const currentAddr = getRightDisasmViewAddress();
            const spectrum = getSpectrum();
            if (currentAddr !== null) {
                navPushHistory(currentAddr, 'right');
            } else if (spectrum && spectrum.cpu) {
                navPushHistory(spectrum.cpu.pc, 'right');
            }
        }
        navPushHistory(addr, 'right');
        setRightDisasmViewAddress(addr);
        rightDisasmAddressInput.value = fmtAddr(addr);
        switchRightPanelType('disasm');
        getUpdateRightDisassemblyView()();
    }

    // "Here" = same panel, "Other" = other panel
    function goToMemoryHere(addr, panelSide) {
        if (panelSide === 'left') goToLeftMemory(addr);
        else goToRightMemory(addr);
    }

    function goToMemoryOther(addr, panelSide) {
        if (panelSide === 'left') goToRightMemory(addr);
        else goToLeftMemory(addr);
    }

    function goToDisasmHere(addr, panelSide) {
        if (panelSide === 'left') goToLeftDisasm(addr);
        else goToRightDisasm(addr);
    }

    function goToDisasmOther(addr, panelSide) {
        if (panelSide === 'left') goToRightDisasm(addr);
        else goToLeftDisasm(addr);
    }

    // Legacy functions for compatibility
    function goToMemoryAddress(addr) {
        // Default: prefer right memory panel
        if (getRightPanelType() === 'memdump') {
            goToRightMemory(addr);
        } else if (getLeftPanelType() === 'memdump') {
            goToLeftMemory(addr);
        } else {
            goToRightMemory(addr);
        }
    }

    function goToAddressNoHistory(addr, panel = 'left') {
        // Navigate disasm without adding to history
        addr = addr & 0xffff;
        if (panel === 'right') {
            setRightDisasmViewAddress(addr);
            rightDisasmAddressInput.value = fmtAddr(addr);
            getUpdateRightDisassemblyView()();
        } else {
            const disasm = getDisasm();
            if (disasm) {
                setDisasmViewAddress(disasm.findStartForPosition(addr, DISASM_PC_POSITION, DISASM_LINES));
            } else {
                setDisasmViewAddress(addr);
            }
            disasmAddressInput.value = fmtAddr(addr);
            updateDebugger();
        }
    }

    function goToAddress(addr) {
        // Default: prefer left disasm panel
        if (getLeftPanelType() === 'disasm') {
            goToLeftDisasm(addr);
        } else if (getRightPanelType() === 'disasm') {
            goToRightDisasm(addr);
        } else {
            goToLeftDisasm(addr);
        }
    }

    // Smart navigation: prefer disasm panel, fall back to memory view
    function navigateToAddress(addr) {
        if (getLeftPanelType() === 'disasm') {
            goToLeftDisasm(addr);
        } else if (getRightPanelType() === 'disasm') {
            goToRightDisasm(addr);
        } else if (getLeftPanelType() === 'memdump') {
            goToLeftMemory(addr);
        } else if (getRightPanelType() === 'memdump') {
            goToRightMemory(addr);
        } else {
            // Both are calc or something else — force left disasm
            goToLeftDisasm(addr);
        }
    }

    // Go to address in left memory view
    function goToLeftMemoryAddress(addr) {
        setLeftMemoryViewAddress(addr & 0xffff);
        leftMemAddressInput.value = fmtAddr(addr & 0xffff);
        updateLeftMemoryView();
    }

    // Go to address in right disasm view
    function goToRightDisasmAddress(addr) {
        setRightDisasmViewAddress(addr & 0xffff);
        rightDisasmAddressInput.value = fmtAddr(addr & 0xffff);
        getUpdateRightDisassemblyView()();
    }

    // Hex or decimal: the four navigation boxes are rewritten in the new base.
    // Their contents are an address the user can edit, so they are unpadded --
    // a leading NBSP would be selected and typed over.
    //
    // Called once here as well as on every change, because the base is restored
    // from storage by display-settings.js and the two modules do not initialise in
    // a guaranteed order: the boxes carry a literal value="0000" from the markup.
    function refreshAddressInputs() {
        if (disasmAddressInput) disasmAddressInput.value = fmtAddr(getDisasmViewAddress());
        if (rightDisasmAddressInput) rightDisasmAddressInput.value = fmtAddr(getRightDisasmViewAddress());
        if (memoryAddressInput) memoryAddressInput.value = fmtAddr(getMemoryViewAddress());
        if (leftMemAddressInput) leftMemAddressInput.value = fmtAddr(getLeftMemoryViewAddress());
    }
    onNumberBaseChange(refreshAddressInputs);
    refreshAddressInputs();

    return {
        switchLeftPanelType, switchRightPanelType,
        updateLeftPanel, updateRightPanel,
        goToLeftMemory, goToRightMemory,
        goToLeftDisasm, goToRightDisasm,
        goToMemoryHere, goToMemoryOther,
        goToDisasmHere, goToDisasmOther,
        goToMemoryAddress, goToAddressNoHistory, goToAddress,
        navigateToAddress,
        goToLeftMemoryAddress, goToRightDisasmAddress
    };
}
