"use strict";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NULL_TOKENS = void 0;
exports.normalizedTicker = normalizedTicker;
exports.tryNormalizedTicker = tryNormalizedTicker;
exports.isValidCalendarDate = isValidCalendarDate;
exports.parseCleanText = parseCleanText;
exports.parseCleanNumber = parseCleanNumber;
exports.parseStrictPercentage = parseStrictPercentage;
exports.normalizeRfMethodology = normalizeRfMethodology;
exports.normalizeStrictCurrency = normalizeStrictCurrency;
exports.parseCleanBoolean = parseCleanBoolean;
exports.NULL_TOKENS = new Set([
    '',
    '-',
    '--',
    '—',
    '–',
    'BLANK',
    'NULL',
    'NONE',
    'NAN',
    'N/A',
    'NA',
    '#N/A',
]);
function normalizedTicker(value) {
    if (typeof value !== 'string')
        throw new Error('رمز السهم مطلوب.');
    const ticker = value.trim().toUpperCase().replace(/\.CA$/, '');
    if (!/^[A-Z0-9_-]{1,30}$/.test(ticker))
        throw new Error('رمز السهم غير صالح.');
    return ticker;
}
function tryNormalizedTicker(value) {
    try {
        return normalizedTicker(value);
    }
    catch {
        return null;
    }
}
function isValidCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const ms = Date.parse(value);
    if (!Number.isFinite(ms))
        return false;
    return new Date(ms).toISOString().slice(0, 10) === value;
}
function parseCleanText(val) {
    if (val === undefined || val === null)
        return null;
    const trimmed = String(val).trim();
    if (exports.NULL_TOKENS.has(trimmed.toUpperCase()))
        return null;
    return trimmed;
}
function normalizeArabicDigitsAndPunctuation(raw) {
    return raw
        .trim()
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/٪/g, '%')
        .replace(/[٬,]/g, '')
        .replace(/٫/g, '.')
        .replace(/^\((.*)\)$/, '-$1')
        .trim();
}
const ZERO_LITERAL_PATTERN = /^[+-]?0*(?:\.0*)?(?:e[+-]?\d+)?$/i;
function shiftDecimalStringExact(rawNumStr, powerOfTenShift) {
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(rawNumStr.trim());
    if (!match)
        return null;
    const sign = match[1] === '-' ? '-' : '';
    const intPart = match[2] ?? '';
    const fracPart = match[3] ?? match[4] ?? '';
    const expPart = match[5] ? parseInt(match[5], 10) : 0;
    if (!Number.isFinite(expPart))
        return null;
    const digits = `${intPart}${fracPart}`.replace(/^0+/, '');
    if (digits === '')
        return '0';
    const originalScale = intPart.length - (intPart.length + fracPart.length - digits.length);
    const exponent = originalScale + expPart + powerOfTenShift - 1;
    const mantissa = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1).replace(/0+$/, '')}`.replace(/\.$/, '');
    return `${sign}${mantissa}e${exponent >= 0 ? '+' : ''}${exponent}`;
}
function parseCleanNumber(val, contextLabel) {
    if (val === undefined || val === null || val === '') {
        return null;
    }
    if (typeof val === 'number') {
        if (!Number.isFinite(val)) {
            throw new Error(contextLabel ? `قيمة رقمية غير صالحة في (${contextLabel}): ${val}` : `قيمة رقمية غير صالحة: ${val}`);
        }
        return Object.is(val, -0) ? 0 : val;
    }
    if (typeof val !== 'string') {
        throw new Error(contextLabel ? `قيمة رقمية غير صالحة في (${contextLabel}).` : 'قيمة رقمية غير صالحة.');
    }
    const str = normalizeArabicDigitsAndPunctuation(val).replace(/%/g, '').trim();
    if (exports.NULL_TOKENS.has(str.toUpperCase())) {
        return null;
    }
    const num = Number(str);
    if (!Number.isFinite(num)) {
        throw new Error(contextLabel
            ? `قيمة رقمية غير صالحة في (${contextLabel}): ${val}`
            : `قيمة رقمية غير صالحة: ${val}`);
    }
    if (num === 0 && !ZERO_LITERAL_PATTERN.test(str)) {
        throw new Error(contextLabel
            ? `قيمة رقمية دقيقة جداً تنهار إلى صفر في (${contextLabel}): ${val}`
            : `قيمة رقمية دقيقة جداً تنهار إلى صفر: ${val}`);
    }
    return Object.is(num, -0) ? 0 : num;
}
/**
 * قواعد النسب المئوية الصارمة:
 * - 0.225 يعني 22.5% ولا يُقسم مرة أخرى.
 * - "22.5%" (أو "٢٢.٥٪") يتحول بإزاحة عشرية دقيقة (÷100) إلى 0.225 دون فقدان دقة.
 * - إدخال 22.5 بدون علامة % لحقل نسبته مئوية يُرفض أو يُعلَّم بوضوح لتجنب الالتباس ×100.
 */
function parseStrictPercentage(val, options) {
    if (val === undefined || val === null || val === '') {
        return { value: null, wasPercentLiteral: false };
    }
    let hasPercentSign = false;
    let numericValue = null;
    if (typeof val === 'number') {
        if (!Number.isFinite(val)) {
            throw new Error(options?.contextLabel
                ? `نسبة مئوية غير صالحة في (${options.contextLabel}): ${val}`
                : 'نسبة مئوية غير صالحة.');
        }
        numericValue = Object.is(val, -0) ? 0 : val;
    }
    else if (typeof val === 'string') {
        const normalized = normalizeArabicDigitsAndPunctuation(val);
        if (exports.NULL_TOKENS.has(normalized.toUpperCase())) {
            return { value: null, wasPercentLiteral: false };
        }
        hasPercentSign = normalized.includes('%');
        const stripped = normalized.replace(/%/g, '').trim();
        const parsed = Number(stripped);
        if (!Number.isFinite(parsed)) {
            throw new Error(options?.contextLabel
                ? `نسبة مئوية غير صالحة في (${options.contextLabel}): ${val}`
                : `نسبة مئوية غير صالحة: ${val}`);
        }
        if (parsed === 0 && !ZERO_LITERAL_PATTERN.test(stripped)) {
            throw new Error(options?.contextLabel
                ? `نسبة مئوية دقيقة جداً تنهار إلى صفر في (${options.contextLabel}): ${val}`
                : `نسبة مئوية دقيقة جداً تنهار إلى صفر: ${val}`);
        }
        if (hasPercentSign) {
            const shiftedText = shiftDecimalStringExact(stripped, -2);
            const shiftedNum = shiftedText !== null ? Number(shiftedText) : parsed / 100;
            if (!Number.isFinite(shiftedNum)) {
                throw new Error(options?.contextLabel
                    ? `نسبة مئوية غير صالحة في (${options.contextLabel}): ${val}`
                    : `نسبة مئوية غير صالحة: ${val}`);
            }
            if (shiftedNum === 0 && parsed !== 0) {
                throw new Error(options?.contextLabel
                    ? `النسبة المئوية (${val}) في (${options.contextLabel}) صغيرة جداً لدرجة انهيارها إلى صفر عند التحويل العشري.`
                    : `النسبة المئوية (${val}) صغيرة جداً لدرجة انهيارها إلى صفر عند التحويل العشري.`);
            }
            numericValue = shiftedNum;
        }
        else {
            numericValue = parsed;
        }
    }
    else {
        throw new Error(options?.contextLabel
            ? `قيمة نسبة مئوية غير مدعومة في (${options.contextLabel}).`
            : 'قيمة نسبة مئوية غير مدعومة.');
    }
    const label = options?.contextLabel ? ` (${options.contextLabel})` : '';
    let warning;
    if (!hasPercentSign && Math.abs(numericValue) > 1) {
        const msg = `قيمة ملتبسة لنسبة مئوية${label}: ${numericValue}. أدخل كسراً عشرياً (مثل 0.225) أو أضف علامة % صراحةً (مثل 22.5%).`;
        if (options?.rejectAmbiguousNumeric !== false) {
            throw new Error(msg);
        }
        warning = msg;
    }
    if (options?.min !== undefined && numericValue < options.min) {
        throw new Error(`القيمة${label} يجب أن لا تقل عن ${options.min}.`);
    }
    if (options?.max !== undefined && numericValue > options.max) {
        throw new Error(`القيمة${label} يجب أن لا تتجاوز ${options.max}.`);
    }
    return {
        value: Object.is(numericValue, -0) ? 0 : numericValue,
        wasPercentLiteral: hasPercentSign,
        warning,
    };
}
const ALLOWED_RF_METHODOLOGIES = new Set([
    'sovereign_yield',
    'default_free',
    'synthetic',
    'unspecified',
]);
function normalizeRfMethodology(value, options) {
    const cleaned = parseCleanText(value);
    if (!cleaned)
        return 'unspecified';
    const lower = cleaned.toLowerCase().replace(/[\s-]+/g, '_');
    if (lower === 'sovereign_raw' || lower === 'sovereign_yield') {
        return 'sovereign_yield';
    }
    if (ALLOWED_RF_METHODOLOGIES.has(lower)) {
        return lower;
    }
    if (options?.strict) {
        throw new Error(`تصنيف منهجية العائد الخالي من المخاطر غير صالح${options.contextLabel ? ` في (${options.contextLabel})` : ''}: ${cleaned}. القيم المسموحة: unspecified, sovereign_yield, default_free, synthetic.`);
    }
    return 'unspecified';
}
function normalizeStrictCurrency(value) {
    const cleaned = parseCleanText(value);
    if (!cleaned) {
        return { code: null, raw: null, status: 'missing' };
    }
    const upper = cleaned.toUpperCase();
    if (upper === 'EGP' || upper === 'EGP_MILLIONS' || upper === 'LE' || upper === 'ج.م' || upper === 'جنيه') {
        return { code: 'EGP', raw: cleaned, status: 'valid' };
    }
    if (upper === 'USD' || upper === 'USD_MILLIONS' || upper === '$') {
        return { code: 'USD', raw: cleaned, status: 'valid' };
    }
    return { code: null, raw: cleaned, status: 'unsupported' };
}
function parseCleanBoolean(value) {
    if (value === undefined || value === null || value === '')
        return null;
    if (typeof value === 'boolean')
        return value;
    const cleaned = parseCleanText(value);
    if (!cleaned)
        return null;
    const upper = cleaned.toUpperCase();
    if (['TRUE', 'YES', '1', 'نعم', 'معدل'].includes(upper))
        return true;
    if (['FALSE', 'NO', '0', 'لا', 'غير معدل'].includes(upper))
        return false;
    throw new Error(`قيمة منطقية غير صالحة: ${value}`);
}
//# sourceMappingURL=normalization.js.map