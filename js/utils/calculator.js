// ========== Programmer Calculator ==========
// Extracted from index.html inline script

// --- DOM element references (lazy) ---
const calcInput = document.getElementById('calcInput');
const calcInputBase = document.getElementById('calcInputBase');
const calcDec = document.getElementById('calcDec');
const calcHex = document.getElementById('calcHex');
const calcOct = document.getElementById('calcOct');
const calcBin = document.getElementById('calcBin');
const calcSigned = document.getElementById('calcSigned');
const calcAscii = document.getElementById('calcAscii');
const calcBitSize = document.getElementById('calcBitSize');
const calcBitsPanel = document.getElementById('calcBitsPanel');
const calcBitsGrid = document.getElementById('calcBitsGrid');
const calcBitsLabels = document.getElementById('calcBitsLabels');
const calcClear = document.getElementById('calcClear');
const calcDel = document.getElementById('calcDel');
const calcEquals = document.getElementById('calcEquals');
const calcNegate = document.getElementById('calcNegate');
const calcLogContent = document.getElementById('calcLogContent');
const calcLogClear = document.getElementById('calcLogClear');

// --- State ---
let calcValue = 0n;  // Use BigInt for precision
let calcBitSizeValue = 16;  // 8, 16, 32
let calcPendingOp = null;
let calcPendingValue = 0n;
let calcNewInput = true;
let calcLogEntries = [];
let calcExpressionParts = [];  // Track full expression for logging

// --- Constants ---
export const CALC_BIT_MASKS = {
    8: 0xFFn,
    16: 0xFFFFn,
    32: 0xFFFFFFFFn
};

// --- Core functions ---

// Global key handler for calculator input (called from inline onkeydown)
export function calcHandleKey(e) {
    e.stopPropagation();
    if (e.key === 'Enter' || e.code === 'NumpadEnter') {
        document.getElementById('calcEquals').click();
        e.preventDefault();
        return false;
    }
    return true;  // Allow other keys (Backspace, typing, etc.)
}

// Expression parser for formulas like "25*(3+2)"
export function calcParseExpression(expr, base) {
    // Tokenize: numbers, operators, parentheses
    const tokens = [];
    let i = 0;
    expr = expr.replace(/\s/g, '').toUpperCase();

    while (i < expr.length) {
        const ch = expr[i];

        // Number (hex, dec, oct, bin based on current base)
        if (/[0-9A-F]/i.test(ch)) {
            let num = '';
            while (i < expr.length && /[0-9A-F]/i.test(expr[i])) {
                num += expr[i++];
            }
            try {
                let val;
                if (base === 16) val = BigInt('0x' + num);
                else if (base === 8) val = BigInt('0o' + num);
                else if (base === 2) val = BigInt('0b' + num);
                else val = BigInt(num);
                tokens.push({ type: 'num', value: val });
            } catch (e) {
                return null;  // Parse error
            }
            continue;
        }

        // Operators
        if ('+-*/%&|^'.includes(ch)) {
            tokens.push({ type: 'op', value: ch });
            i++;
            continue;
        }

        // Parentheses
        if (ch === '(') {
            tokens.push({ type: 'lparen' });
            i++;
            continue;
        }
        if (ch === ')') {
            tokens.push({ type: 'rparen' });
            i++;
            continue;
        }

        // Unknown character
        i++;
    }

    if (tokens.length === 0) return null;

    // Shunting-yard algorithm for operator precedence
    const output = [];
    const opStack = [];
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '&': 0, '|': 0, '^': 0 };

    for (const token of tokens) {
        if (token.type === 'num') {
            output.push(token.value);
        } else if (token.type === 'op') {
            while (opStack.length > 0 && opStack[opStack.length - 1].type === 'op' &&
                   precedence[opStack[opStack.length - 1].value] >= precedence[token.value]) {
                output.push(opStack.pop().value);
            }
            opStack.push(token);
        } else if (token.type === 'lparen') {
            opStack.push(token);
        } else if (token.type === 'rparen') {
            while (opStack.length > 0 && opStack[opStack.length - 1].type !== 'lparen') {
                output.push(opStack.pop().value);
            }
            if (opStack.length > 0) opStack.pop();  // Remove lparen
        }
    }
    while (opStack.length > 0) {
        output.push(opStack.pop().value);
    }

    // Evaluate RPN
    const evalStack = [];
    for (const item of output) {
        if (typeof item === 'bigint') {
            evalStack.push(item);
        } else {
            if (evalStack.length < 2) return null;
            const b = evalStack.pop();
            const a = evalStack.pop();
            let result;
            switch (item) {
                case '+': result = a + b; break;
                case '-': result = a - b; break;
                case '*': result = a * b; break;
                case '/': result = b !== 0n ? a / b : 0n; break;
                case '%': result = b !== 0n ? a % b : 0n; break;
                case '&': result = a & b; break;
                case '|': result = a | b; break;
                case '^': result = a ^ b; break;
                default: return null;
            }
            evalStack.push(result);
        }
    }

    return evalStack.length === 1 ? { result: evalStack[0], expr: expr } : null;
}

export function calcFormatValue(val) {
    val = val & CALC_BIT_MASKS[calcBitSizeValue];
    return val.toString(16).toUpperCase() + 'h (' + val.toString() + ')';
}

export function calcAddLog(entry) {
    calcLogEntries.push(entry);
    const div = document.createElement('div');
    div.className = 'calc-log-entry';
    div.innerHTML = entry;
    div.dataset.index = calcLogEntries.length - 1;
    calcLogContent.appendChild(div);
    calcLogContent.scrollTop = calcLogContent.scrollHeight;
}

export function calcLogBinaryOp(a, op, b, result) {
    const opSymbol = op === 'and' ? '&' : op === 'or' ? '|' : op === 'xor' ? '^' : op === 'mod' ? '%' : op;
    calcAddLog(`<span class="calc-log-val">${calcFormatValue(a)}</span> <span class="calc-log-op">${opSymbol}</span> <span class="calc-log-val">${calcFormatValue(b)}</span> = <span class="calc-log-result">${calcFormatValue(result)}</span>`);
}

export function calcLogUnaryOp(op, before, after) {
    calcAddLog(`<span class="calc-log-op">${op}</span> <span class="calc-log-val">${calcFormatValue(before)}</span> = <span class="calc-log-result">${calcFormatValue(after)}</span>`);
}

export function calcLogExpression(parts, result) {
    // Format expression like: 25 + 5 + 3 - 7 = 26
    let html = '';
    for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 0) {
            // Value
            html += `<span class="calc-log-val">${calcFormatValue(parts[i])}</span>`;
        } else {
            // Operator
            const op = parts[i];
            const opSymbol = op === 'and' ? '&' : op === 'or' ? '|' : op === 'xor' ? '^' : op === 'mod' ? '%' : op;
            html += ` <span class="calc-log-op">${opSymbol}</span> `;
        }
    }
    html += ` = <span class="calc-log-result">${calcFormatValue(result)}</span>`;
    calcAddLog(html);
}

export function calcMask(val) {
    return val & CALC_BIT_MASKS[calcBitSizeValue];
}

export function calcToSigned(val) {
    const mask = CALC_BIT_MASKS[calcBitSizeValue];
    const signBit = 1n << BigInt(calcBitSizeValue - 1);
    val = val & mask;
    if (val & signBit) {
        return val - (mask + 1n);
    }
    return val;
}

export function calcFormatBin(val) {
    val = calcMask(val);
    const bits = val.toString(2).padStart(calcBitSizeValue, '0');
    // Group by 4 bits
    let result = '';
    for (let i = 0; i < bits.length; i += 4) {
        if (i > 0) result += ' ';
        result += bits.substr(i, 4);
    }
    return result;
}

export function calcFormatDec(val) {
    val = calcMask(val);
    const str = val.toString();
    // Add thousand separators
    let result = '';
    for (let i = str.length - 1, c = 0; i >= 0; i--, c++) {
        if (c > 0 && c % 3 === 0) result = ' ' + result;
        result = str[i] + result;
    }
    return result;
}

export function calcFormatOct(val) {
    val = calcMask(val);
    const str = val.toString(8);
    // Group by 3 digits
    let result = '';
    const padLen = Math.ceil(str.length / 3) * 3;
    const padded = str.padStart(padLen, '0');
    for (let i = 0; i < padded.length; i += 3) {
        if (i > 0) result += ' ';
        result += padded.substr(i, 3);
    }
    return result.replace(/^0+\s*/, '') || '0';
}

export function calcUpdateDisplay() {
    const val = calcMask(calcValue);
    calcDec.textContent = calcFormatDec(val);
    calcHex.textContent = val.toString(16).toUpperCase();
    calcOct.textContent = calcFormatOct(val);
    calcBin.textContent = calcFormatBin(val);

    // Show signed value if negative (high bit set)
    const signedVal = calcToSigned(val);
    if (signedVal < 0n) {
        calcSigned.textContent = signedVal.toString();
    } else {
        calcSigned.textContent = '';
    }

    // Show ASCII if byte-sized and printable
    if (calcBitSizeValue === 8 || val <= 0xFFn) {
        const byteVal = Number(val & 0xFFn);
        if (byteVal >= 32 && byteVal < 127) {
            calcAscii.textContent = `'${String.fromCharCode(byteVal)}'`;
        } else if (byteVal >= 0x80) {
            const lowByte = byteVal & 0x7F;
            if (lowByte >= 32 && lowByte < 127) {
                calcAscii.textContent = `'${String.fromCharCode(lowByte)}'+$80`;
            } else {
                calcAscii.textContent = '';
            }
        } else {
            calcAscii.textContent = '';
        }
    } else {
        calcAscii.textContent = '';
    }

    // Update input field only if it doesn't contain a formula
    const currentInput = calcInput.value;
    const hasFormula = /[+\-*/%&|^()]/.test(currentInput);
    calcInputBase.disabled = hasFormula;
    if (!hasFormula) {
        const base = parseInt(calcInputBase.value);
        if (base === 16) calcInput.value = val.toString(16).toUpperCase();
        else if (base === 10) calcInput.value = val.toString();
        else if (base === 8) calcInput.value = val.toString(8);
        else if (base === 2) calcInput.value = val.toString(2);
    }

    // Always update bits panel
    calcRenderBits();
}

export function calcUpdateDigitButtons() {
    const base = parseInt(calcInputBase.value);
    // Define valid digits for each base
    const validDigits = {
        2: ['0', '1'],
        8: ['0', '1', '2', '3', '4', '5', '6', '7'],
        10: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
        16: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F']
    };
    const valid = validDigits[base] || validDigits[16];

    // Update all digit and hex-digit buttons
    document.querySelectorAll('.calc-btn.digit, .calc-btn.hex-digit').forEach(btn => {
        const ch = btn.dataset.char;
        if (ch) {
            const isValid = valid.includes(ch);
            btn.disabled = !isValid;
            btn.classList.toggle('calc-btn-disabled', !isValid);
        }
    });
}

export function calcRenderBits() {
    if (!calcBitsLabels || !calcBitsGrid) return;
    const val = calcMask(calcValue);

    // Render labels (show key bit positions)
    let labelsHtml = '';
    for (let i = calcBitSizeValue - 1; i >= 0; i--) {
        // Show labels at positions: 31, 23, 15, 7, 0 (or subset based on bit size)
        if (i === calcBitSizeValue - 1 || i === 0 || (i + 1) % 8 === 0) {
            labelsHtml += `<div class="calc-bits-label">${i}</div>`;
        } else {
            labelsHtml += `<div class="calc-bits-label"></div>`;
        }
        if (i > 0 && i % 4 === 0) labelsHtml += '<div class="calc-bits-label-sep"></div>';
    }
    calcBitsLabels.innerHTML = labelsHtml;

    // Render bits
    let html = '';
    for (let i = calcBitSizeValue - 1; i >= 0; i--) {
        const bitSet = (val >> BigInt(i)) & 1n;
        html += `<div class="calc-bit${bitSet ? ' set' : ''}" data-bit="${i}">${bitSet}</div>`;
        if (i > 0 && i % 4 === 0) html += '<div class="calc-bit-separator"></div>';
    }
    calcBitsGrid.innerHTML = html;
}

export function calcParseInput() {
    const base = parseInt(calcInputBase.value);
    const text = calcInput.value.trim().replace(/\s/g, '');
    try {
        if (base === 16) calcValue = BigInt('0x' + (text || '0'));
        else if (base === 8) calcValue = BigInt('0o' + (text || '0'));
        else if (base === 2) calcValue = BigInt('0b' + (text || '0'));
        else calcValue = BigInt(text || '0');
        calcValue = calcMask(calcValue);
    } catch (e) {
        // Invalid input, ignore
    }
}

export function calcApplyOp(op, a, b) {
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b !== 0n ? a / b : 0n;
        case 'mod': return b !== 0n ? a % b : 0n;
        case 'and': return a & b;
        case 'or': return a | b;
        case 'xor': return a ^ b;
        default: return b;
    }
}

export function calcApplyUnary(op) {
    const mask = CALC_BIT_MASKS[calcBitSizeValue];
    const before = calcValue;
    switch (op) {
        case 'not': calcValue = ~calcValue & mask; break;
        case 'inc': calcValue = (calcValue + 1n) & mask; break;
        case 'dec': calcValue = (calcValue - 1n) & mask; break;
        case 'lsl': calcValue = (calcValue << 1n) & mask; break;
        case 'lsr': calcValue = calcValue >> 1n; break;
        case 'asr': {
            const signBit = 1n << BigInt(calcBitSizeValue - 1);
            const sign = calcValue & signBit;
            calcValue = (calcValue >> 1n) | sign;
            break;
        }
        case 'rol': {
            const topBit = (calcValue >> BigInt(calcBitSizeValue - 1)) & 1n;
            calcValue = ((calcValue << 1n) | topBit) & mask;
            break;
        }
        case 'ror': {
            const bottomBit = calcValue & 1n;
            calcValue = (calcValue >> 1n) | (bottomBit << BigInt(calcBitSizeValue - 1));
            break;
        }
        case 'rand': calcValue = BigInt(Math.floor(Math.random() * Number(mask + 1n))); break;
    }
    calcLogUnaryOp(op, before, calcValue);
    calcUpdateDisplay();
}

// Helper to update base select disabled state
export function calcUpdateBaseSelectState() {
    const hasFormula = /[+\-*/%&|^()]/.test(calcInput.value);
    calcInputBase.disabled = hasFormula;
}

export function isCalcTabActive() {
    const calcView = document.getElementById('rightCalculatorView');
    return calcView && calcView.style.display !== 'none';
}

// --- Event listeners (wiring) ---

calcLogClear.addEventListener('click', () => {
    calcLogEntries = [];
    calcLogContent.innerHTML = '';
});

calcLogContent.addEventListener('click', (e) => {
    const entry = e.target.closest('.calc-log-entry');
    if (entry) {
        // Extract result value from the entry and load it
        const resultEl = entry.querySelector('.calc-log-result');
        if (resultEl) {
            const text = resultEl.textContent;
            const match = text.match(/([0-9A-F]+)h/i);
            if (match) {
                calcValue = BigInt('0x' + match[1]);
                calcUpdateDisplay();
                calcNewInput = true;
            }
        }
    }
});

// Button handlers
document.querySelectorAll('.calc-btn[data-char]').forEach(btn => {
    btn.addEventListener('click', () => {
        const ch = btn.dataset.char;
        const isParen = (ch === '(' || ch === ')');
        // Don't clear for parentheses - append to existing expression
        if (calcNewInput && !isParen) {
            calcInput.value = '';
            calcNewInput = false;
        }
        calcInput.value += ch;
        calcUpdateBaseSelectState();
        // Only parse as number if no operators/parens in input
        if (!/[+\-*/%&|^()]/.test(calcInput.value)) {
            calcParseInput();
            calcUpdateDisplay();
        }
    });
});

document.querySelectorAll('.calc-btn[data-op]').forEach(btn => {
    btn.addEventListener('click', () => {
        const op = btn.dataset.op;
        // Unary operators - always apply immediately
        if (['not', 'inc', 'dec', 'lsl', 'lsr', 'asr', 'rol', 'ror', 'rand'].includes(op)) {
            calcApplyUnary(op);
            calcNewInput = true;
            return;
        }
        // For +, -, *, /, %, &, |, ^ - append to input as formula
        const opSymbol = op === 'and' ? '&' : op === 'or' ? '|' : op === 'xor' ? '^' : op === 'mod' ? '%' : op;
        if ('+-*/%&|^'.includes(opSymbol)) {
            calcInput.value += opSymbol;
            calcNewInput = false;
            calcUpdateBaseSelectState();
        }
    });
});

calcEquals.addEventListener('click', () => {
    const inputText = calcInput.value.trim();
    const base = parseInt(calcInputBase.value);

    // Try to parse as expression if it contains operators or parentheses
    if (/[+\-*/%&|^()]/.test(inputText)) {
        const parsed = calcParseExpression(inputText, base);
        if (parsed) {
            calcValue = calcMask(parsed.result);
            calcAddLog(`<span class="calc-log-val">${inputText}</span> = <span class="calc-log-result">${calcFormatValue(calcValue)}</span>`);
            calcExpressionParts = [];
            calcPendingOp = null;
            calcPendingValue = 0n;
            // Update input to show result (clear formula first so calcUpdateDisplay updates it)
            calcInput.value = '';
            calcUpdateDisplay();
            calcNewInput = true;
            return;
        }
    }

    // Original button-based calculation
    if (calcPendingOp) {
        // Add final part to expression
        if (calcExpressionParts.length === 0) {
            calcExpressionParts.push(calcPendingValue);
        }
        calcExpressionParts.push(calcPendingOp);
        calcExpressionParts.push(calcValue);

        // Calculate final result
        calcValue = calcMask(calcApplyOp(calcPendingOp, calcPendingValue, calcValue));

        // Log full expression
        calcLogExpression(calcExpressionParts, calcValue);

        calcExpressionParts = [];
        calcPendingOp = null;
        calcPendingValue = 0n;
        calcUpdateDisplay();
    }
    calcNewInput = true;
});

calcClear.addEventListener('click', () => {
    calcValue = 0n;
    calcPendingOp = null;
    calcPendingValue = 0n;
    calcExpressionParts = [];
    calcNewInput = true;
    calcInput.value = '0';  // Clear input directly
    calcUpdateDisplay();
});

calcDel.addEventListener('click', () => {
    const text = calcInput.value;
    if (text.length > 0) {
        calcInput.value = text.slice(0, -1) || '0';
        calcParseInput();
        calcUpdateDisplay();
    }
});

calcNegate.addEventListener('click', () => {
    const before = calcValue;
    calcValue = calcMask(-calcValue);
    calcLogUnaryOp('neg', before, calcValue);
    calcUpdateDisplay();
    calcNewInput = true;
});

calcBitSize.addEventListener('click', () => {
    if (calcBitSizeValue === 8) calcBitSizeValue = 16;
    else if (calcBitSizeValue === 16) calcBitSizeValue = 32;
    else calcBitSizeValue = 8;
    calcBitSize.textContent = 'u' + calcBitSizeValue;
    calcValue = calcMask(calcValue);
    calcUpdateDisplay();
});

let lastValidBase = calcInputBase.value;
calcInputBase.addEventListener('change', () => {
    // Only allow base change if input is a plain number (no operators/parens)
    if (/[+\-*/%&|^()]/.test(calcInput.value)) {
        calcInputBase.value = lastValidBase;
        return;
    }
    lastValidBase = calcInputBase.value;
    calcUpdateDisplay();
    calcUpdateDigitButtons();
});

calcInput.addEventListener('input', () => {
    // Disable base change when formula is present
    const hasFormula = /[+\-*/%&|^()]/.test(calcInput.value);
    calcInputBase.disabled = hasFormula;

    // Only parse as number if no operators/parens (pure number input)
    if (!hasFormula) {
        calcParseInput();
        calcUpdateDisplay();
    }
});

calcBitsGrid.addEventListener('click', (e) => {
    const bitEl = e.target.closest('.calc-bit');
    if (bitEl) {
        const bitNum = parseInt(bitEl.dataset.bit);
        calcValue ^= (1n << BigInt(bitNum));
        calcUpdateDisplay();
    }
});

// Keyboard support for calculator
document.addEventListener('keydown', (e) => {
    if (!isCalcTabActive()) return;
    // Don't capture if typing in other inputs (except calcInput)
    if (e.target.tagName === 'INPUT' && e.target.id !== 'calcInput') return;
    if (e.target.tagName === 'TEXTAREA') return;
    if (e.target.tagName === 'SELECT') return;

    const isInCalcInput = (e.target.id === 'calcInput');

    // Handle Enter first - before anything else
    if (e.key === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        e.stopPropagation();
        calcEquals.click();
        return;
    }

    // Handle Backspace
    if (e.key === 'Backspace') {
        e.stopPropagation();
        if (isInCalcInput) {
            // Let browser handle backspace in input, but stop emulator
            return;
        }
        e.preventDefault();
        calcDel.click();
        return;
    }

    // If in calcInput, let other keys work naturally
    if (isInCalcInput) {
        e.stopPropagation();
        return;
    }

    // Below is for when NOT focused on calcInput
    let handled = false;
    const base = parseInt(calcInputBase.value);

    // Only handle single character keys for digits
    if (e.key.length === 1) {
        const key = e.key.toUpperCase();

        // Digits 0-9 (check if valid for current base)
        if (key >= '0' && key <= '9') {
            const digit = parseInt(key);
            // Only allow digits valid for current base
            if (digit < base) {
                if (calcNewInput) {
                    calcInput.value = '';
                    calcNewInput = false;
                }
                calcInput.value += key;
                calcUpdateBaseSelectState();
                if (!/[+\-*/%&|^()]/.test(calcInput.value)) {
                    calcParseInput();
                    calcUpdateDisplay();
                }
                handled = true;
            }
        }

        // Hex digits A-F (only in hex mode)
        if (!handled && base === 16 && key >= 'A' && key <= 'F') {
            if (calcNewInput) {
                calcInput.value = '';
                calcNewInput = false;
            }
            calcInput.value += key;
            calcUpdateBaseSelectState();
            if (!/[+\-*/%&|^()]/.test(calcInput.value)) {
                calcParseInput();
                calcUpdateDisplay();
            }
            handled = true;
        }
    }

    // Operations
    if (!handled) {
        switch (e.key) {
            case '+':
                document.querySelector('.calc-btn[data-op="+"]').click();
                handled = true;
                break;
            case '-':
                document.querySelector('.calc-btn[data-op="-"]').click();
                handled = true;
                break;
            case '*':
                document.querySelector('.calc-btn[data-op="*"]').click();
                handled = true;
                break;
            case '/':
                document.querySelector('.calc-btn[data-op="/"]').click();
                handled = true;
                break;
            case '%':
                document.querySelector('.calc-btn[data-op="mod"]').click();
                handled = true;
                break;
            case '&':
                document.querySelector('.calc-btn[data-op="and"]').click();
                handled = true;
                break;
            case '|':
                document.querySelector('.calc-btn[data-op="or"]').click();
                handled = true;
                break;
            case '^':
                document.querySelector('.calc-btn[data-op="xor"]').click();
                handled = true;
                break;
            case '~':
                document.querySelector('.calc-btn[data-op="not"]').click();
                handled = true;
                break;
            case '=':
                calcEquals.click();
                handled = true;
                break;
            case 'Escape':
                calcClear.click();
                handled = true;
                break;
            case '<':
                document.querySelector('.calc-btn[data-op="lsl"]').click();
                handled = true;
                break;
            case '>':
                document.querySelector('.calc-btn[data-op="lsr"]').click();
                handled = true;
                break;
            case '(':
            case ')':
                calcInput.value += e.key;
                calcNewInput = false;
                calcUpdateBaseSelectState();
                handled = true;
                break;
        }
    }

    if (handled) {
        e.preventDefault();
        e.stopPropagation();
    }
}, true);  // Use capture phase

// Initial display
calcUpdateDisplay();
calcUpdateDigitButtons();
